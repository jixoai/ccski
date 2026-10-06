import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { InteractiveCommandBuilder, skillsShortRender } from "../cli/prompts/commandBuilder.js";
import {
  Choice,
  promptMultiSelect,
  promptMultiSelect as promptMultiSelectTargets,
} from "../cli/prompts/multiSelect.js";
import { parseSkillFile } from "../core/parser.js";
import { CcskiError, InvalidSkillNameError } from "../types/errors.js";
import { RestrictedSkillNameSchema } from "../types/schemas.js";
import { parseFilters } from "../utils/filters.js";
import { dim, heading, info, renderList, tone } from "../utils/format.js";
import { parseGitUrl } from "../utils/git-url-parser.js";
import { rankStrings } from "../utils/search.js";
import { formatSkillChoiceLabel } from "../utils/skill-render.js";
import type {
  InstallOptions,
  InstallPreview,
  InstallResult,
  InstallResultEntry,
  InstallSummary,
} from "./types.js";

const GIT_CLONE_TIMEOUT_MS = 120_000; // 2 minutes
const tempDirs: string[] = []; // Track temp dirs for cleanup
const CLONE_CACHE_DIR = join(tmpdir(), "ccski-cache"); // Persistent cache directory
let cleanupHandlersRegistered = false;

export interface InstallOutput {
  log: (message?: string) => void;
  error: (message?: string) => void;
  isTTY: boolean;
  write: (message: string) => void;
  clearLine: () => void;
}

const silentOutput: InstallOutput = {
  log: () => {},
  error: () => {},
  isTTY: false,
  write: () => {},
  clearLine: () => {},
};

export function createConsoleInstallOutput(): InstallOutput {
  return {
    log: (message?: string) => {
      if (typeof message === "string") console.log(message);
      else console.log();
    },
    error: (message?: string) => {
      if (typeof message === "string") console.error(message);
      else console.error();
    },
    isTTY: process.stderr.isTTY === true,
    write: (message: string) => process.stderr.write(message),
    clearLine: () => process.stderr.write("\r" + " ".repeat(60) + "\r"),
  };
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

export function registerInstallCleanupHandlers(): void {
  if (cleanupHandlersRegistered) return;
  cleanupHandlersRegistered = true;
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
        const hash = stdout.trim().split(/\s+/)[0];
        if (hash && hash.length >= 7) {
          resolve(hash.slice(0, 12));
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
  const match = repoUrl.match(/([^\/]+?)(?:\.git)?$/);
  const repoName = match?.[1] ?? "repo";
  return join(CLONE_CACHE_DIR, `${repoName}@${commitHash}`);
}

async function gitCloneWithTimeout(
  repo: string,
  dest: string,
  branch: string | undefined,
  timeoutMs: number,
  output: InstallOutput
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

      const lines = text.split(/[\r\n]+/);
      for (const line of lines) {
        if (
          line.includes("%") ||
          line.includes("Cloning") ||
          line.includes("Receiving") ||
          line.includes("Resolving")
        ) {
          lastProgress = line.trim();
          if (output.isTTY) {
            output.write(`\r${dim(lastProgress.slice(0, 60).padEnd(60))}`);
          }
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(`Git clone timed out after ${timeoutMs / 1000}s. Check your network connection.`)
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (output.isTTY) output.clearLine();
      reject(new Error(`Git clone failed: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (output.isTTY) output.clearLine();

      if (code === 0) {
        resolve();
      } else {
        let message = `Git clone failed (exit code ${code})`;
        if (stderr.includes("Could not resolve host") || stderr.includes("unable to access")) {
          message =
            "Network error: Could not connect to repository. Check your internet connection.";
        } else if (stderr.includes("not found") || stderr.includes("does not exist")) {
          message = `Repository not found: ${repo}`;
        } else if (
          stderr.includes("Authentication failed") ||
          stderr.includes("Permission denied")
        ) {
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

interface InternalInstallResult {
  path: string;
  name: string;
  status: "installed" | "skipped" | "overwritten";
  warning?: string;
}

/** Finite audit codes for typed installation failures (clients never parse strings). */
export type InstallAuditCode =
  | "SOURCE_NOT_FOUND"
  | "SOURCE_SYMLINK"
  | "SOURCE_NOT_DIRECTORY"
  | "TARGET_ROOT_SYMLINK"
  | "TARGET_ROOT_NOT_DIRECTORY"
  | "PATH_ESCAPE"
  | "DEST_SYMLINK"
  | "DEST_NOT_DIRECTORY"
  | "COPY_FAILED"
  | "SWAP_FAILED";

const installAuditSuggestions: Record<InstallAuditCode, string[]> = {
  SOURCE_NOT_FOUND: ["Verify the skill source directory exists."],
  SOURCE_SYMLINK: ["Install from a real directory; resolve symbolic links first."],
  SOURCE_NOT_DIRECTORY: ["The source path exists but is not a directory."],
  TARGET_ROOT_SYMLINK: ["Provide a real target root directory, not a symbolic link."],
  TARGET_ROOT_NOT_DIRECTORY: ["The target root path exists but is not a directory."],
  PATH_ESCAPE: ["The resolved destination must stay a direct child of the target root."],
  DEST_SYMLINK: ["Remove the symbolic link at the destination explicitly, then reinstall."],
  DEST_NOT_DIRECTORY: ["A non-directory occupies the destination path; remove it explicitly."],
  COPY_FAILED: ["Check source readability and target disk space; the destination was left untouched."],
  SWAP_FAILED: ["The previous installation was restored or left as a .ccski-backup-* residual; inspect the target root."],
};

/** Typed installation audit/recovery failure carrying a machine-readable code. */
export class InstallAuditError extends CcskiError {
  constructor(
    public code: InstallAuditCode,
    message: string,
    public path?: string
  ) {
    super(`${message} [${code}]`, installAuditSuggestions[code]);
    this.name = "InstallAuditError";
  }
}

function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Staging/backup prefix; hidden, always removed on handled failure paths. */
const STAGING_PREFIX = ".ccski-staging-";
const BACKUP_PREFIX = ".ccski-backup-";

/** Copy source into a staging dir inside the root (same FS, rename-safe). */
function stageCopy(skillDir: string, targetRoot: string): string {
  const staging = mkdtempSync(join(targetRoot, STAGING_PREFIX));
  try {
    cpSync(skillDir, staging, { recursive: true, force: true });
    return staging;
  } catch (err) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure; staging is hidden and inert
    }
    throw new InstallAuditError(
      "COPY_FAILED",
      `Failed to stage copy of ${skillDir}: ${err instanceof Error ? err.message : String(err)}`,
      skillDir
    );
  }
}

/**
 * Swap a staged copy into place. Fresh install: single atomic rename.
 * Overwrite: dest -> backup, staging -> dest, backup removed; a failed swap
 * restores the backup (best effort) and reports residual state when it cannot.
 */
function swapIntoPlace(
  staging: string,
  destDir: string,
  targetRoot: string,
  overwrite: boolean
): string | undefined {
  if (!overwrite) {
    try {
      renameSync(staging, destDir);
    } catch (err) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
      throw new InstallAuditError(
        "SWAP_FAILED",
        `Failed to move staged install into place: ${err instanceof Error ? err.message : String(err)}`,
        destDir
      );
    }
    return undefined;
  }

  const backup = mkdtempSync(join(targetRoot, BACKUP_PREFIX));
  renameSync(destDir, backup);
  try {
    renameSync(staging, destDir);
  } catch (err) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
    try {
      renameSync(backup, destDir);
      throw new InstallAuditError(
        "SWAP_FAILED",
        `Failed to move staged install into place (previous installation restored): ${err instanceof Error ? err.message : String(err)}`,
        destDir
      );
    } catch (restoreErr) {
      if (restoreErr instanceof InstallAuditError) throw restoreErr;
      throw new InstallAuditError(
        "SWAP_FAILED",
        `Failed to move staged install into place AND restore failed; previous installation remains at ${backup}: ${err instanceof Error ? err.message : String(err)}`,
        destDir
      );
    }
  }

  try {
    rmSync(backup, { recursive: true, force: true });
  } catch {
    return `Previous installation backup could not be deleted: ${backup}`;
  }
  return undefined;
}

export function installSkillDir(
  skillDir: string,
  targetRoot: string,
  force = false
): InternalInstallResult {
  const sourceSt = lstatSafe(skillDir);
  if (sourceSt === null) {
    throw new InstallAuditError("SOURCE_NOT_FOUND", `Source skill directory not found`, skillDir);
  }
  if (sourceSt.isSymbolicLink()) {
    throw new InstallAuditError("SOURCE_SYMLINK", `Source skill directory is a symbolic link`, skillDir);
  }
  if (!sourceSt.isDirectory()) {
    throw new InstallAuditError("SOURCE_NOT_DIRECTORY", `Source is not a directory`, skillDir);
  }

  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(`No SKILL.md found in ${skillDir}`);
  }

  const parsed = parseSkillFile(skillFile);
  const skillName = parsed.frontmatter.name;

  const nameValidation = RestrictedSkillNameSchema.safeParse(skillName);
  if (!nameValidation.success) {
    const issue = nameValidation.error.errors[0]?.message ?? "invalid skill name";
    throw new InvalidSkillNameError(skillName, issue);
  }

  const resolvedRoot = resolve(targetRoot);
  const rootSt = lstatSafe(resolvedRoot);
  if (rootSt === null) {
    mkdirSync(resolvedRoot, { recursive: true });
  } else if (rootSt.isSymbolicLink()) {
    throw new InstallAuditError("TARGET_ROOT_SYMLINK", `Target root is a symbolic link`, resolvedRoot);
  } else if (!rootSt.isDirectory()) {
    throw new InstallAuditError(
      "TARGET_ROOT_NOT_DIRECTORY",
      `Target root is not a directory`,
      resolvedRoot
    );
  }

  // Defense in depth behind the name schema: joined dest must stay in the root.
  const destDir = join(resolvedRoot, nameValidation.data);
  const rel = relative(resolvedRoot, resolve(destDir));
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new InstallAuditError("PATH_ESCAPE", `Destination escapes target root`, destDir);
  }

  const destSt = lstatSafe(destDir);
  const alreadyExists = destSt !== null;

  if (destSt?.isSymbolicLink()) {
    throw new InstallAuditError("DEST_SYMLINK", `Destination is a symbolic link`, destDir);
  }
  if (destSt !== null && !destSt.isDirectory()) {
    throw new InstallAuditError("DEST_NOT_DIRECTORY", `Destination exists but is not a directory`, destDir);
  }

  if (!force && alreadyExists) {
    return { path: destDir, name: skillName, status: "skipped" };
  }

  const staging = stageCopy(skillDir, resolvedRoot);
  const warning = swapIntoPlace(staging, destDir, resolvedRoot, alreadyExists);
  return {
    path: destDir,
    name: skillName,
    status: alreadyExists ? "overwritten" : "installed",
    ...(warning !== undefined ? { warning } : {}),
  };
}

interface SkillEntry {
  name: string;
  description: string;
  dir: string;
}

export class MultiSkillSelectionError extends Error {
  constructor(
    message: string,
    public listing: string
  ) {
    super(message);
    this.name = "MultiSkillSelectionError";
  }
}

export class InstallCancelledError extends Error {
  constructor() {
    super("Installation cancelled.");
    this.name = "InstallCancelledError";
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
    ...(branch ? { branch } : {}),
    ...(path ? { path } : {}),
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
  options: { mode?: "git" | "file"; branch?: string; timeout?: number },
  output: InstallOutput
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

  output.log(info(`Resolving ${repo}${branch ? ` (${branch})` : ""}...`));
  const commitHash = await getRemoteCommitHash(repo, ref);

  const cacheDir = getCacheDir(repo, commitHash);
  let cloneDir: string;

  if (existsSync(cacheDir) && existsSync(join(cacheDir, ".git"))) {
    output.log(dim(`Using cached clone: ${cacheDir}`));
    cloneDir = cacheDir;
  } else {
    ensureDir(CLONE_CACHE_DIR);
    cloneDir = cacheDir;

    output.log(info(`Cloning to ${cloneDir}...`));

    try {
      await gitCloneWithTimeout(
        repo,
        cloneDir,
        branch,
        options.timeout ?? GIT_CLONE_TIMEOUT_MS,
        output
      );
    } catch (err) {
      try {
        rmSync(cloneDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
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

  if (!usePath && base.toLowerCase().endsWith("skill.md") && existsSync(base)) {
    return [dirname(base)];
  }

  if (usePath && candidatePath.toLowerCase().endsWith("skill.md") && existsSync(candidatePath)) {
    return [dirname(candidatePath)];
  }

  if (usePath && existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
    if (existsSync(join(candidatePath, "SKILL.md"))) return [candidatePath];
    if (existsSync(join(candidatePath, "marketplace.json"))) {
      return marketplaceSkills(join(candidatePath, "marketplace.json"));
    }
  }

  if (
    (usePath || !statSync(base).isDirectory()) &&
    existsSync(candidatePath) &&
    candidatePath.endsWith("marketplace.json")
  ) {
    return marketplaceSkills(candidatePath);
  }

  if (existsSync(join(base, ".claude-plugin", "marketplace.json"))) {
    return marketplaceSkills(join(base, ".claude-plugin", "marketplace.json"));
  }

  if (existsSync(join(base, "SKILL.md"))) {
    return [base];
  }

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
  cmdBuilder.addArg(
    "skills",
    entries.map((e) => e.name),
    {
      shortRender: skillsShortRender,
      totalChoices: totalSkills,
      positional: true,
    }
  );

  const pickedNames = await promptMultiSelect({
    message: "Select skills to install",
    choices: entries.map((e) => {
      return {
        value: e.name,
        label: formatSkillChoiceLabel(e),
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

  cmdBuilder.updateArg("skills", pickedNames);

  const pickedSet = new Set(pickedNames.map((n) => n.toLowerCase()));
  return entries.filter((e) => pickedSet.has(e.name.toLowerCase()));
}

function parseSelectors(argv: InstallOptions): string[] {
  const raw = Array.isArray(argv.skills) ? argv.skills : [];
  return raw
    .flatMap((val) => val.split(/[\\/,]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

interface SelectSkillsResult {
  selection: SkillEntry[];
  totalSkills: number;
}

async function selectSkills(
  targetDirs: string[],
  argv: InstallOptions,
  cmdBuilder: InteractiveCommandBuilder
): Promise<SelectSkillsResult> {
  const entries = buildSkillEntries(targetDirs);
  const totalSkills = entries.length;

  if (entries.length === 1) return { selection: entries, totalSkills };

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

function filterTargetsByIncludeExclude(
  targets: string[],
  include?: string[],
  exclude?: string[]
): string[] {
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
  argv: InstallOptions,
  cmdBuilder?: InteractiveCommandBuilder,
  output: InstallOutput = silentOutput
): Promise<string[]> {
  const dests: string[] = [];
  const userDir = argv.userDir ? resolve(argv.userDir) : homedir();
  if (argv.outDir && argv.outDir.length) {
    dests.push(...(argv.outDir as string[]).map((p) => resolve(p)));
  }

  const scopeMap: Record<string, string> = {
    claude: join(process.cwd(), ".claude/skills"),
    "claude:@project": join(process.cwd(), ".claude/skills"),
    "claude:@user": join(userDir, ".claude/skills"),
    codex: join(userDir, ".codex/skills"),
    "codex:@user": join(userDir, ".codex/skills"),
  };

  if (argv.outScope) {
    for (const scope of argv.outScope as string[]) {
      if (scope === "codex:@project") {
        throw new Error(
          "codex:@project is not supported. Codex skills must be installed to user scope (codex or codex:@user)."
        );
      }
      const mapped = scopeMap[scope];
      if (!mapped)
        throw new Error(
          `Invalid out-scope: ${scope}. Valid values: ${Object.keys(scopeMap).join(", ")}`
        );
      dests.push(mapped);
    }
  }

  const unique = Array.from(new Set(dests));
  if (unique.length > 0) return unique;

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

  output.log(dim("\nTip: Use --out-dir to specify custom directories, e.g.:"));
  output.log(dim("  ccski install <source> --out-dir=/path/to/skills\n"));

  const picked = await promptMultiSelectTargets({
    message: "Select destination(s)",
    choices,
    defaultChecked: false,
    ...(cmdBuilder ? { commandBuilder: cmdBuilder } : {}),
    commandArgKey: "out-dir",
  });

  if (!picked || picked.length === 0) throw new Error("No destination selected");

  if (cmdBuilder && picked.length > 0) {
    cmdBuilder.addArg("out-dir", picked);
  }

  return Array.from(new Set(picked));
}

function buildPreview(selection: SkillEntry[], destinations: string[]): InstallPreview {
  return {
    dryRun: true,
    skills: selection.map((entry) => ({ name: entry.name, description: entry.description })),
    destinations: destinations.map((dest) => ({ path: dest, exists: existsSync(dest) })),
    totalInstalls: selection.length * destinations.length,
  };
}

export async function installSkills(
  options: InstallOptions,
  output: InstallOutput = silentOutput
): Promise<InstallResult> {
  try {
    if (!options.source) {
      throw new Error(
        "installSkills requires a source. Use installCcskiWorkflow for workflow setup."
      );
    }

    const source = options.source;
    const parsed = parseGitUrl(source);
    const resolvedSource = parsed?.repo ?? source;
    const resolvedBranch = options.branch ?? parsed?.branch;
    const resolvedPath = options.path ?? (parsed?.type === "blob" ? parsed.path : undefined);

    const cmdBuilder = new InteractiveCommandBuilder("ccski install");
    cmdBuilder.addPositional(resolvedSource);
    if (resolvedBranch) cmdBuilder.addArg("branch", resolvedBranch);
    if (resolvedPath) cmdBuilder.addArg("path", resolvedPath);
    if (options.force || options.override) cmdBuilder.addFlag("force");

    const destinations = await resolveDestinations(options, cmdBuilder, output);
    const materialized = await materializeSource(
      source,
      {
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.branch ? { branch: options.branch } : {}),
        ...(options.timeout ? { timeout: options.timeout } : {}),
      },
      output
    );
    const explicitPath = options.path ?? materialized.useHint;

    if (materialized.useHint && !resolvedPath) {
      cmdBuilder.addArg("path", materialized.useHint);
    }

    const sourceArgs = buildSourceArgs(
      source,
      materialized.branch ?? options.branch,
      explicitPath,
      materialized.repo
    );
    const sourceLabel = formatSourceLabel(sourceArgs.source, sourceArgs.branch, sourceArgs.path);
    const targets = resolveInstallTargets(materialized.base, explicitPath, sourceLabel);

    if (targets.length === 0) {
      throw new Error(
        `No skills found for ${sourceLabel}. Resolved directory: ${materialized.base}`
      );
    }

    const force = options.force === true || options.override === true;
    const filteredTargets = filterTargetsByIncludeExclude(
      targets,
      options.include,
      options.exclude
    );
    const { selection, totalSkills } = await selectSkills(filteredTargets, options, cmdBuilder);

    if (options.dryRun) {
      return buildPreview(selection, destinations);
    }

    if (options.interactive && selection.length > 0 && !options.yes) {
      cmdBuilder.addArg(
        "skills",
        selection.map((s) => s.name),
        {
          shortRender: skillsShortRender,
          totalChoices: totalSkills,
          positional: true,
        }
      );

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
        ...(conflicts.length > 0 ? { conflicts } : {}),
        force,
      });
      if (!confirmed) {
        throw new InstallCancelledError();
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

    return summary;
  } finally {
    cleanupTempDirs();
  }
}
