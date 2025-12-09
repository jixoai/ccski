import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { parseSkillFile } from "../../core/parser.js";
import {
  dim,
  error,
  heading,
  info,
  renderList,
  setColorEnabled,
  success,
  tone,
  warn,
} from "../../utils/format.js";
import { parseGitUrl } from "../../utils/git-url-parser.js";
import { rankStrings } from "../../utils/search.js";
import { wrap } from "../../word-wrap/index.js";
import { Choice, promptMultiSelect } from "../prompts/multiSelect.js";
import { parseFilters } from "../../utils/filters.js";
import { promptMultiSelect as promptMultiSelectTargets } from "../prompts/multiSelect.js";
import { InteractiveCommandBuilder, skillsShortRender } from "../prompts/commandBuilder.js";

const GIT_CLONE_TIMEOUT_MS = 120_000; // 2 minutes
const tempDirs: string[] = []; // Track temp dirs for cleanup
const CLONE_CACHE_DIR = join(tmpdir(), "ccski-cache"); // Persistent cache directory

export interface InstallArgs {
  source: string;
  force?: boolean;
  override?: boolean;
  path?: string;
  mode?: "git" | "file";
  branch?: string;
  interactive?: boolean;
  all?: boolean;
  disabled?: boolean;
  noColor?: boolean;
  color?: boolean;
  include?: string[];
  exclude?: string[];
  outDir?: string[];
  outScope?: string[];
  userDir?: string;
  dryRun?: boolean;
  timeout?: number;
  yes?: boolean;
  json?: boolean;
}

function cleanupTempDirs(): void {
  for (const dir of tempDirs) {
    try {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs.length = 0;
}

function registerCleanupHandlers(): void {
  const cleanup = (): void => {
    cleanupTempDirs();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

/**
 * Get the remote ref (branch/HEAD) commit hash using git ls-remote
 */
async function getRemoteCommitHash(
  repo: string,
  ref: string = "HEAD",
  timeoutMs: number = 30_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["ls-remote", repo, ref], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Git ls-remote timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Git ls-remote failed: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        // Format: "<hash>\t<ref>"
        const hash = stdout.trim().split(/\s+/)[0];
        if (hash && hash.length >= 7) {
          resolve(hash.slice(0, 12)); // Use short hash
        } else {
          reject(new Error(`Could not parse commit hash from: ${stdout}`));
        }
      } else {
        let message = `Git ls-remote failed (exit code ${code})`;
        if (stderr.includes("Could not resolve host")) {
          message = "Network error: Could not connect to repository.";
        } else if (stderr.includes("not found")) {
          message = `Repository or ref not found: ${repo} ${ref}`;
        }
        reject(new Error(message));
      }
    });
  });
}

/**
 * Get the cache directory path for a repo@commit
 */
function getCacheDir(repoUrl: string, commitHash: string): string {
  // Extract repo name from URL
  const match = repoUrl.match(/([^\/]+?)(?:\.git)?$/);
  const repoName = match?.[1] ?? "repo";
  return join(CLONE_CACHE_DIR, `${repoName}@${commitHash}`);
}

async function gitCloneWithTimeout(
  repo: string,
  dest: string,
  branch?: string,
  timeoutMs: number = GIT_CLONE_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["clone", "--depth", "1", "--progress"];
    if (branch) {
      args.push("--branch", branch);
    }
    args.push(repo, dest);

    const child = spawn("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let lastProgress = "";

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;

      // Parse git progress output
      const lines = text.split(/[\r\n]+/);
      for (const line of lines) {
        if (line.includes("%") || line.includes("Cloning") || line.includes("Receiving") || line.includes("Resolving")) {
          lastProgress = line.trim();
          // Update progress on same line
          if (process.stderr.isTTY) {
            process.stderr.write(`\r${dim(lastProgress.slice(0, 60).padEnd(60))}`);
          }
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Git clone timed out after ${timeoutMs / 1000}s. Check your network connection.`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");
      reject(new Error(`Git clone failed: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");

      if (code === 0) {
        resolve();
      } else {
        // Parse common git errors
        let message = `Git clone failed (exit code ${code})`;
        if (stderr.includes("Could not resolve host") || stderr.includes("unable to access")) {
          message = "Network error: Could not connect to repository. Check your internet connection.";
        } else if (stderr.includes("not found") || stderr.includes("does not exist")) {
          message = `Repository not found: ${repo}`;
        } else if (stderr.includes("Authentication failed") || stderr.includes("Permission denied")) {
          message = "Authentication failed. Check your credentials or repository access.";
        } else if (stderr.includes("Remote branch") && stderr.includes("not found")) {
          message = `Branch '${branch}' not found in repository.`;
        } else if (stderr.trim()) {
          message = `Git clone failed: ${stderr.trim().split("\n").pop()}`;
        }
        reject(new Error(message));
      }
    });
  });
}

function normalizeSourcePath(source: string): string {
  return source.startsWith("file://") ? new URL(source).pathname : source;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface InstallResultEntry {
  skill: string;
  destination: string;
  path: string;
  status: "installed" | "skipped" | "overwritten" | "failed";
  error?: string;
}

export interface InstallSummary {
  results: InstallResultEntry[];
  installed: number;
  skipped: number;
  overwritten: number;
  failed: number;
}

interface InternalInstallResult {
  path: string;
  name: string;
  status: "installed" | "skipped" | "overwritten";
}

export function installSkillDir(skillDir: string, targetRoot: string, force = false): InternalInstallResult {
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(`No SKILL.md found in ${skillDir}`);
  }

  const parsed = parseSkillFile(skillFile);
  const skillName = parsed.frontmatter.name;

  const destDir = join(targetRoot, skillName);
  ensureDir(targetRoot);

  const alreadyExists = existsSync(destDir);

  if (!force && alreadyExists) {
    return { path: destDir, name: skillName, status: "skipped" };
  }

  cpSync(skillDir, destDir, { recursive: true, force: true });
  return {
    path: destDir,
    name: skillName,
    status: alreadyExists ? "overwritten" : "installed",
  };
}

interface SkillEntry {
  name: string;
  description: string;
  dir: string;
}

function printInstallSummary(summary: InstallSummary): void {
  const { results, installed, skipped, overwritten, failed } = summary;

  // Group results by skill
  const bySkill = new Map<string, InstallResultEntry[]>();
  for (const r of results) {
    const existing = bySkill.get(r.skill) ?? [];
    existing.push(r);
    bySkill.set(r.skill, existing);
  }

  // Print results by skill
  for (const [skill, entries] of bySkill) {
    const statuses = entries.map((e) => {
      const destName = e.destination.split("/").slice(-2).join("/"); // Show last 2 path segments
      switch (e.status) {
        case "installed":
          return tone.success(`✓ ${destName}`);
        case "overwritten":
          return tone.warning(`↻ ${destName}`);
        case "skipped":
          return dim(`○ ${destName}`);
        case "failed":
          return tone.error(`✗ ${destName}`);
      }
    });
    console.log(`${tone.bold(skill)}: ${statuses.join(", ")}`);
  }

  // Print summary line
  console.log();
  const parts: string[] = [];
  if (installed > 0) parts.push(tone.success(`${installed} installed`));
  if (overwritten > 0) parts.push(tone.warning(`${overwritten} overwritten`));
  if (skipped > 0) parts.push(dim(`${skipped} skipped`));
  if (failed > 0) parts.push(tone.error(`${failed} failed`));

  if (parts.length === 0) {
    console.log(warn("No skills were processed."));
  } else {
    console.log(`Summary: ${parts.join(", ")}`);
  }

  // Print hint for skipped
  if (skipped > 0 && failed === 0 && installed === 0 && overwritten === 0) {
    console.log(dim("Use --force to overwrite existing skills."));
  }
}

class MultiSkillSelectionError extends Error {
  constructor(
    message: string,
    public listing: string
  ) {
    super(message);
    this.name = "MultiSkillSelectionError";
  }
}

export async function installCommand(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  // Register cleanup handlers for temp directories
  registerCleanupHandlers();

  try {
    // Parse source URL first to normalize arguments for command preview
    const parsed = parseGitUrl(argv.source);
    const resolvedSource = parsed?.repo ?? argv.source;
    const resolvedBranch = argv.branch ?? parsed?.branch;
    const resolvedPath = argv.path ?? (parsed?.type === "blob" ? parsed.path : undefined);

    // Create command builder with normalized arguments
    const cmdBuilder = new InteractiveCommandBuilder("ccski install");
    cmdBuilder.addPositional(resolvedSource);
    if (resolvedBranch) cmdBuilder.addArg("branch", resolvedBranch);
    if (resolvedPath) cmdBuilder.addArg("path", resolvedPath);
    if (argv.force || argv.override) cmdBuilder.addFlag("force");

    const destinations = await resolveDestinations(argv, cmdBuilder);
    const materialized = await materializeSource(argv.source, {
      ...(argv.mode ? { mode: argv.mode } : {}),
      ...(argv.branch ? { branch: argv.branch } : {}),
      ...(argv.timeout ? { timeout: argv.timeout } : {}),
    });
    const explicitPath = argv.path ?? materialized.useHint;

    // Update builder if materialized source provided additional info
    if (materialized.useHint && !resolvedPath) {
      cmdBuilder.addArg("path", materialized.useHint);
    }

    const sourceArgs = buildSourceArgs(
      argv.source,
      materialized.branch ?? argv.branch,
      explicitPath,
      materialized.repo
    );
    const sourceLabel = formatSourceLabel(
      sourceArgs.source,
      sourceArgs.branch,
      sourceArgs.path
    );
    const targets = resolveInstallTargets(materialized.base, explicitPath, sourceLabel);

    if (targets.length === 0) {
      throw new Error(
        `No skills found for ${sourceLabel}. Resolved directory: ${materialized.base}`
      );
    }

    const force = argv.force === true || argv.override === true;
    const filteredTargets = filterTargetsByIncludeExclude(targets, argv.include, argv.exclude);
    const { selection, totalSkills } = await selectSkills(filteredTargets, argv, cmdBuilder, destinations);

    // Dry-run mode: show what would be installed without actually installing
    if (argv.dryRun) {
      console.log(info("Dry-run mode: showing what would be installed\n"));
      console.log(heading("Skills to install:"));
      for (const entry of selection) {
        console.log(`  - ${tone.primary(entry.name)}`);
        if (entry.description) {
          console.log(`    ${dim(entry.description.slice(0, 80))}`);
        }
      }
      console.log();
      console.log(heading("Destinations:"));
      for (const dest of destinations) {
        const exists = existsSync(dest);
        console.log(`  - ${dest}${exists ? "" : dim(" (will create)")}`);
      }
      console.log();
      console.log(dim(`Total: ${selection.length} skill(s) × ${destinations.length} destination(s) = ${selection.length * destinations.length} installation(s)`));
      cleanupTempDirs();
      return;
    }

    // Interactive mode: show confirmation before proceeding (skip with --yes)
    if (argv.interactive && selection.length > 0 && !argv.yes) {
      // Update builder with selected skills for confirmation
      cmdBuilder.addArg("skills", selection.map(s => s.name), {
        shortRender: skillsShortRender,
        totalChoices: totalSkills,
        positional: true,
      });

      // Detect conflicts (skills that already exist in destinations)
      const conflicts: Array<{ skill: string; destination: string }> = [];
      for (const dest of destinations) {
        for (const entry of selection) {
          const skillName = entry.name;
          const destPath = join(dest, skillName);
          if (existsSync(destPath)) {
            conflicts.push({ skill: skillName, destination: dest });
          }
        }
      }

      const confirmed = await cmdBuilder.confirm({
        skills: selection,
        destinations,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        force,
      });
      if (!confirmed) {
        console.log(warn("Installation cancelled."));
        cleanupTempDirs();
        return;
      }
    }

    const results: InstallResultEntry[] = [];
    for (const dest of destinations) {
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
      for (const entry of selection) {
        try {
          const result = installSkillDir(entry.dir, dest, force);
          results.push({
            skill: entry.name,
            destination: dest,
            path: result.path,
            status: result.status,
          });
        } catch (err) {
          results.push({
            skill: entry.name,
            destination: dest,
            path: join(dest, entry.name),
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const summary: InstallSummary = {
      results,
      installed: results.filter((r) => r.status === "installed").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      overwritten: results.filter((r) => r.status === "overwritten").length,
      failed: results.filter((r) => r.status === "failed").length,
    };

    // Output results
    if (argv.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printInstallSummary(summary);
    }

    if (summary.failed > 0) {
      process.exitCode = 1;
    }

    // Cleanup temp directories after successful install
    cleanupTempDirs();
  } catch (err) {
    // Cleanup temp directories on error
    cleanupTempDirs();

    if (err instanceof MultiSkillSelectionError) {
      const advisory = warn(`Input needed: ${err.message}`);
      console.log(advisory);
      console.log(err.listing.trimEnd());
      console.log(`\n${advisory}`);
    } else {
      console.error(error(`Install failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exitCode = 1;
  }
}

interface MaterializedSource {
  base: string;
  useHint?: string;
  label: string;
  branch?: string;
  repo?: string;
  mode: "git" | "file";
  commitHash?: string;
}

interface SourceArgs {
  source: string;
  branch?: string;
  path?: string;
}

function buildSourceArgs(input: string, branch?: string, path?: string, repo?: string): SourceArgs {
  return {
    source: repo ?? input,
    branch,
    path,
  };
}

function formatSourceLabel(input: string, branch?: string, path?: string, repo?: string): string {
  const source = repo ?? input;
  const pieces = [source];
  if (branch) pieces.push(`--branch=${branch}`);
  if (path) pieces.push(`--path=${path}`);
  return pieces.join(" ");
}

function defaultMode(source: string, explicit?: "git" | "file"): "git" | "file" {
  if (explicit) return explicit;
  if (source.endsWith(".git")) return "git";
  return source.startsWith("http://") || source.startsWith("https://") ? "git" : "file";
}

async function materializeSource(
  source: string,
  options: { mode?: "git" | "file"; branch?: string; timeout?: number }
): Promise<MaterializedSource> {
  const mode = defaultMode(source, options.mode);

  if (mode === "file") {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      throw new Error(
        "mode=file requires a local path; http(s) sources must use --mode git (default)."
      );
    }
    const base = normalizeSourcePath(source);
    return { base, label: formatSourceLabel(source, undefined, undefined), mode };
  }

  const parsed = parseGitUrl(source);
  const repo = parsed?.repo ?? source;
  const branch = options.branch ?? parsed?.branch;
  const ref = branch ?? "HEAD";

  // Get the commit hash for caching
  console.log(info(`Resolving ${repo}${branch ? ` (${branch})` : ""}...`));
  const commitHash = await getRemoteCommitHash(repo, ref);

  // Check if we have a cached clone
  const cacheDir = getCacheDir(repo, commitHash);
  let cloneDir: string;

  if (existsSync(cacheDir) && existsSync(join(cacheDir, ".git"))) {
    console.log(dim(`Using cached clone: ${cacheDir}`));
    cloneDir = cacheDir;
  } else {
    // Clone to cache directory
    ensureDir(CLONE_CACHE_DIR);
    cloneDir = cacheDir;

    console.log(info(`Cloning to ${cloneDir}...`));

    try {
      await gitCloneWithTimeout(repo, cloneDir, branch, options.timeout);
    } catch (err) {
      // Clean up failed clone directory
      try {
        rmSync(cloneDir, { recursive: true, force: true });
      } catch { /* ignore */ }
      throw err;
    }
  }

  const useHint = parsed?.type === "blob" ? parsed.path : undefined;
  const base = parsed?.type === "tree" && parsed.path ? join(cloneDir, parsed.path) : cloneDir;

  const result: MaterializedSource = {
    base,
    label: formatSourceLabel(source, branch, useHint, repo),
    mode,
    commitHash,
  };
  if (useHint) result.useHint = useHint;
  if (branch) result.branch = branch;
  if (repo) result.repo = repo;

  return result;
}

function resolveSkillPath(baseDirs: string | string[], rel: string): string | null {
  const cleaned = rel.replace(/^\.\//, "");
  const bases = Array.isArray(baseDirs) ? baseDirs : [baseDirs];

  const candidates: string[] = [];
  for (const baseDir of bases) {
    const resolvedBase = resolve(baseDir);
    if (cleaned.endsWith("SKILL.md")) {
      candidates.push(dirname(join(resolvedBase, cleaned)));
      candidates.push(dirname(join(resolvedBase, "..", cleaned)));
    } else {
      candidates.push(join(resolvedBase, cleaned));
      candidates.push(join(resolvedBase, "..", cleaned));
    }
  }

  for (const dir of candidates) {
    if (existsSync(join(dir, "SKILL.md"))) return dir;
  }

  return null;
}

function marketplaceSkills(marketplacePath: string): string[] {
  const data = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const marketplaceDir = dirname(marketplacePath);
  const repoRoot = resolve(marketplaceDir, "..");
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];

  const skillPaths = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin || !Array.isArray(plugin.skills)) continue;

    const pluginSource = typeof plugin.source === "string" ? plugin.source : undefined;
    const baseCandidates = new Set<string>([marketplaceDir, repoRoot]);

    if (pluginSource) {
      const cleanedSource = pluginSource.replace(/^\.\//, "");
      baseCandidates.add(resolve(marketplaceDir, cleanedSource));
      baseCandidates.add(resolve(repoRoot, cleanedSource));
    }

    for (const rel of plugin.skills) {
      if (typeof rel !== "string") continue;
      const resolved = resolveSkillPath(Array.from(baseCandidates), rel);
      if (resolved) skillPaths.add(resolve(resolved));
    }
  }
  return Array.from(skillPaths);
}

function resolveInstallTargets(root: string, usePath: string | undefined, label: string): string[] {
  const base = resolve(root);
  const candidatePath = usePath ? resolve(base, usePath) : base;

  // base is directly a SKILL.md file
  if (!usePath && base.toLowerCase().endsWith("skill.md") && existsSync(base)) {
    return [dirname(base)];
  }

  // explicit SKILL.md file
  if (usePath && candidatePath.toLowerCase().endsWith("skill.md") && existsSync(candidatePath)) {
    return [dirname(candidatePath)];
  }

  // explicit directory with SKILL.md
  if (usePath && existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
    if (existsSync(join(candidatePath, "SKILL.md"))) return [candidatePath];
    if (existsSync(join(candidatePath, "marketplace.json"))) {
      return marketplaceSkills(join(candidatePath, "marketplace.json"));
    }
  }

  // explicit marketplace file
  if (
    (usePath || !statSync(base).isDirectory()) &&
    existsSync(candidatePath) &&
    candidatePath.endsWith("marketplace.json")
  ) {
    return marketplaceSkills(candidatePath);
  }

  // auto-detect within base
  if (existsSync(join(base, ".claude-plugin", "marketplace.json"))) {
    return marketplaceSkills(join(base, ".claude-plugin", "marketplace.json"));
  }

  if (existsSync(join(base, "SKILL.md"))) {
    return [base];
  }

  // fallback: if base is marketplace dir
  if (existsSync(join(base, "marketplace.json"))) {
    return marketplaceSkills(join(base, "marketplace.json"));
  }

  throw new Error(
    `No SKILL.md or marketplace.json found for ${label}${usePath ? ` (path: ${usePath})` : ""}. Resolved directory: ${base}`
  );
}

function buildSkillEntries(dirs: string[]): SkillEntry[] {
  return dirs.map((dir) => {
    const parsed = parseSkillFile(join(dir, "SKILL.md"));
    return {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description ?? "",
      dir,
    };
  });
}

async function promptSelectSkills(
  entries: SkillEntry[],
  cmdBuilder: InteractiveCommandBuilder,
  totalSkills: number
): Promise<SkillEntry[]> {
  // Configure skills arg with custom short render (positional, not --skills=)
  cmdBuilder.addArg("skills", entries.map(e => e.name), {
    shortRender: skillsShortRender,
    totalChoices: totalSkills,
    positional: true,
  });

  const pickedNames = await promptMultiSelect({
    message: "Select skills to install",
    choices: entries.map((e) => {
      return {
        value: e.name,
        label: formatChoiceLabel(e),
        description: e.description,
        checked: true,
      } satisfies Choice;
    }),
    defaultChecked: true,
    commandBuilder: cmdBuilder,
    commandArgKey: "skills",
  });

  if (!Array.isArray(pickedNames) || pickedNames.length === 0) {
    throw new Error("No skills selected.");
  }

  // Update builder with final selection
  cmdBuilder.updateArg("skills", pickedNames);

  const pickedSet = new Set(pickedNames.map((n) => n.toLowerCase()));
  return entries.filter((e) => pickedSet.has(e.name.toLowerCase()));
}

function parseSelectors(argv: ArgumentsCamelCase<InstallArgs>): string[] {
  const extras = argv._ ? argv._.slice(1) : [];
  return extras
    .flatMap((val) => String(val).split(/[\/,]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

interface SelectSkillsResult {
  selection: SkillEntry[];
  totalSkills: number;
}

async function selectSkills(
  targetDirs: string[],
  argv: ArgumentsCamelCase<InstallArgs>,
  cmdBuilder: InteractiveCommandBuilder,
  destinations: string[]
): Promise<SelectSkillsResult> {
  const entries = buildSkillEntries(targetDirs);
  const totalSkills = entries.length;

  if (entries.length === 1) return { selection: entries, totalSkills };

  // Build sourceLabel from cmdBuilder's current state
  const source = cmdBuilder.getArg("source")[0] ?? argv.source;
  const branch = cmdBuilder.getArg("branch")[0];
  const path = cmdBuilder.getArg("path")[0];
  const sourceLabel = formatSourceLabel(source, branch, path);
  const listing = formatSkillListing(entries, sourceLabel);

  const selectors = parseSelectors(argv);

  if (argv.all) return { selection: entries, totalSkills };
  if (argv.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new MultiSkillSelectionError(
        `Interactive mode requires a TTY. Specify names or use --all instead for ${sourceLabel}.`,
        listing
      );
    }
    const picked = await promptSelectSkills(entries, cmdBuilder, totalSkills);
    return { selection: picked, totalSkills };
  }

  if (selectors.length === 0) {
    throw new MultiSkillSelectionError(
      `Multiple skills found (${entries.length}) in ${sourceLabel}. Specify names, use --all, or --interactive.`,
      listing
    );
  }

  const selected: SkillEntry[] = [];
  const names = entries.map((e) => e.name);

  for (const raw of selectors) {
    const sel = raw.trim();
    const lower = sel.toLowerCase();

    let match: SkillEntry | undefined;
    const exact = entries.find((e) => e.name.toLowerCase() === lower);
    if (exact) {
      match = exact;
    } else {
      const partial = entries.filter((e) => e.name.toLowerCase().includes(lower));
      if (partial.length === 1) match = partial[0];
    }

    if (!match) {
      const rankedIdx = rankStrings(names, sel);
      const ranked = (rankedIdx.length ? rankedIdx : names.map((_, idx) => idx))
        .slice(0, 3)
        .map((i) => names[i]!);
      const hint = ranked.length ? ` Did you mean: ${ranked.join(", ")}?` : "";
      throw new Error(`Skill '${sel}' not found.${hint}`);
    }

    if (!selected.some((s) => s.name === match!.name)) {
      selected.push(match);
    }
  }

  return { selection: selected, totalSkills };
}

function formatSkillListing(entries: SkillEntry[], label: string): string {
  return (
    `${heading(`Available skills from ${label}`)} (${entries.length})\n` +
    renderList(entries.map((e) => ({ title: e.name, description: e.description })))
  );
}

function filterTargetsByIncludeExclude(targets: string[], include?: string[], exclude?: string[]): string[] {
  const annotated = targets.map((dir) => {
    const parsed = parseSkillFile(join(dir, "SKILL.md"));
    return { dir, name: parsed.frontmatter.name };
  });

  const { includes, excludes } = parseFilters(include, exclude);
  const collected: string[] = [];

  const matchName = (skillName: string, pattern?: string): boolean => {
    if (!pattern) return true;
    return skillName.toLowerCase().includes(pattern.toLowerCase());
  };

  if (includes.length === 0) {
    collected.push(...annotated.map((a) => a.dir));
  } else {
    for (const token of includes) {
      annotated.forEach((entry) => {
        if (matchName(entry.name, token.namePattern)) collected.push(entry.dir);
      });
    }
  }

  const byPath = Array.from(new Set(collected));

  if (!excludes || excludes.length === 0) return byPath;

  const excludeSet = new Set<string>();
  for (const token of excludes) {
    annotated.forEach((entry) => {
      if (matchName(entry.name, token.namePattern)) excludeSet.add(entry.dir);
    });
  }

  return byPath.filter((p) => !excludeSet.has(p));
}

async function resolveDestinations(
  argv: ArgumentsCamelCase<InstallArgs>,
  cmdBuilder?: InteractiveCommandBuilder
): Promise<string[]> {
  const dests: string[] = [];
  const userDir = argv.userDir ? resolve(argv.userDir) : homedir();
  if (argv.outDir && argv.outDir.length) {
    dests.push(...(argv.outDir as string[]).map((p) => resolve(p)));
  }

  const scopeMap: Record<string, string> = {
    "claude": join(process.cwd(), ".claude/skills"),
    "claude:@project": join(process.cwd(), ".claude/skills"),
    "claude:@user": join(userDir, ".claude/skills"),
    "codex": join(userDir, ".codex/skills"),
    "codex:@user": join(userDir, ".codex/skills"),
  };

  if (argv.outScope) {
    for (const scope of argv.outScope as string[]) {
      if (scope === "codex:@project") {
        throw new Error("codex:@project is not supported. Codex skills must be installed to user scope (codex or codex:@user).");
      }
      const mapped = scopeMap[scope];
      if (!mapped) throw new Error(`Invalid out-scope: ${scope}. Valid values: ${Object.keys(scopeMap).join(", ")}`);
      dests.push(mapped);
    }
  }

  const unique = Array.from(new Set(dests));
  if (unique.length > 0) return unique;

  // Define default destinations with labels
  const defaultDests = [
    { path: scopeMap["claude"], label: "claude-project", scope: "claude:@project" },
    { path: scopeMap["claude:@user"], label: "claude-user", scope: "claude:@user" },
    { path: scopeMap["codex"], label: "codex-user", scope: "codex:@user" },
  ].filter((d) => d.path) as Array<{ path: string; label: string; scope: string }>;

  const existing = defaultDests.filter((d) => existsSync(d.path));
  if (existing.length === 1) return [existing[0]!.path];

  if (!argv.interactive) {
    throw new Error(
      "Multiple destination roots available. Use --out-scope (claude:@project|claude:@user|codex:@user) or --out-dir to specify, or -i for interactive selection."
    );
  }

  // Default: select only the first existing directory, or first if none exist
  const defaultSelection = existing.length > 0 ? existing[0]!.path : defaultDests[0]?.path;

  const choices = defaultDests.map((d) => {
    const exists = existsSync(d.path);
    const badge = exists ? tone.success("✓") : tone.warning("○");
    return {
      value: d.path,
      label: `${badge} ${tone.bold(d.label)} ${dim(d.path)}${exists ? "" : dim(" (will create)")}`,
      description: `Scope: ${d.scope}`,
      checked: d.path === defaultSelection,
    } satisfies Choice;
  });

  console.log(dim("\nTip: Use --out-dir to specify custom directories, e.g.:"));
  console.log(dim("  ccski install <source> --out-dir=/path/to/skills\n"));

  const picked = await promptMultiSelectTargets({
    message: "Select destination(s)",
    choices,
    defaultChecked: false,
    commandBuilder: cmdBuilder,
    commandArgKey: "out-dir",
  });

  if (!picked || picked.length === 0) throw new Error("No destination selected");

  // Update builder with selected destinations
  if (cmdBuilder && picked.length > 0) {
    cmdBuilder.addArg("out-dir", picked);
  }

  return Array.from(new Set(picked));
}

function formatChoiceLabel(entry: SkillEntry): string {
  const wrapWidth = Math.max(24, Math.min(process.stdout?.columns ?? 80, 120) - 6);
  const descriptionText = entry.description ?? "";
  const wrapped = descriptionText
    ? wrap(descriptionText, {
        width: wrapWidth,
        indent: "",
        newline: "\n",
        trim: true,
        cut: false,
      })
    : "";
  const description =
    wrapped && wrapped.length > 0 ? "\n    " + wrapped.replace(/\n/g, "\n    ") : "";

  return `${tone.primary(entry.name)}${description}`;
}
