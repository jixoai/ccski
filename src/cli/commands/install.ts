import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { parseSkillFile } from "../../core/parser.js";
import {
  error,
  heading,
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

export interface InstallArgs {
  source: string;
  global?: boolean;
  force?: boolean;
  override?: boolean;
  path?: string;
  mode?: "git" | "file";
  branch?: string;
  interactive?: boolean;
  all?: boolean;
  noColor?: boolean;
  color?: boolean;
}

function normalizeSourcePath(source: string): string {
  return source.startsWith("file://") ? new URL(source).pathname : source;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function installSkillDir(skillDir: string, targetRoot: string, force = false): string {
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(`No SKILL.md found in ${skillDir}`);
  }

  const parsed = parseSkillFile(skillFile);
  const skillName = parsed.frontmatter.name;

  const destDir = join(targetRoot, skillName);
  ensureDir(targetRoot);

  if (!force && existsSync(destDir)) {
    throw new Error(
      `Skill '${skillName}' already exists at ${destDir} (use --force/--override to overwrite)`
    );
  }

  cpSync(skillDir, destDir, { recursive: true, force: true });
  return destDir;
}

interface SkillEntry {
  name: string;
  description: string;
  dir: string;
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

  try {
    const targetRoot = argv.global
      ? join(process.env.HOME ?? "~", ".claude/skills")
      : join(process.cwd(), ".claude/skills");
    const materialized = await materializeSource(argv.source, {
      ...(argv.mode ? { mode: argv.mode } : {}),
      ...(argv.branch ? { branch: argv.branch } : {}),
    });
    const explicitPath = argv.path ?? materialized.useHint;
    const sourceLabel = formatSourceLabel(
      argv.source,
      materialized.branch ?? argv.branch,
      explicitPath,
      materialized.repo
    );
    const targets = resolveInstallTargets(materialized.base, explicitPath, sourceLabel);

    if (targets.length === 0) {
      throw new Error(
        `No skills found for ${sourceLabel}. Resolved directory: ${materialized.base}`
      );
    }

    const force = argv.force === true || argv.override === true;
    const selection = await selectSkills(targets, argv, sourceLabel);

    const installed: string[] = [];
    for (const entry of selection) {
      installed.push(installSkillDir(entry.dir, targetRoot, force));
    }

    console.log(success(`Installed ${installed.length} skill(s):`));
    installed.forEach((d) => console.log(` - ${d}`));
  } catch (err) {
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
}

function formatSourceLabel(input: string, branch?: string, path?: string, repo?: string): string {
  const pieces = [repo ?? input];
  if (branch) pieces.push(`branch=${branch}`);
  if (path) pieces.push(`path=${path}`);
  return pieces.join(" ");
}

function defaultMode(source: string, explicit?: "git" | "file"): "git" | "file" {
  if (explicit) return explicit;
  if (source.endsWith(".git")) return "git";
  return source.startsWith("http://") || source.startsWith("https://") ? "git" : "file";
}

async function materializeSource(
  source: string,
  options: { mode?: "git" | "file"; branch?: string }
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
  const tmp = mkdtempSync(join(tmpdir(), "ccski-install-"));

  const clone = ["git", "clone", "--depth", "1"];
  if (branch) {
    clone.push("--branch", branch);
  }
  clone.push(repo, tmp);

  execSync(clone.join(" "), { stdio: "ignore" });

  const useHint = parsed?.type === "blob" ? parsed.path : undefined;
  const base = parsed?.type === "tree" && parsed.path ? join(tmp, parsed.path) : tmp;

  const result: MaterializedSource = {
    base,
    label: formatSourceLabel(source, branch, useHint, repo),
    mode,
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
  sourceLabel: string
): Promise<SkillEntry[]> {
  const pickedNames = await promptMultiSelect({
    message: `Select skills to install from ${sourceLabel}`,
    choices: entries.map((e) => {
      return {
        value: e.name,
        label: formatChoiceLabel(e),
        description: e.description,
        checked: true,
      } satisfies Choice;
    }),
    defaultChecked: true,
    // pageSize: Math.max(process.stdout.rows - 10, 15),
    command: { base: "ccski install", staticArgs: [sourceLabel] },
  });

  if (!Array.isArray(pickedNames) || pickedNames.length === 0) {
    throw new Error("No skills selected.");
  }

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

async function selectSkills(
  targetDirs: string[],
  argv: ArgumentsCamelCase<InstallArgs>,
  sourceLabel: string
): Promise<SkillEntry[]> {
  const entries = buildSkillEntries(targetDirs);
  if (entries.length === 1) return entries;

  const listing = formatSkillListing(entries, sourceLabel);

  const selectors = parseSelectors(argv);

  if (argv.all) return entries;
  if (argv.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new MultiSkillSelectionError(
        `Interactive mode requires a TTY. Specify names or use --all instead for ${sourceLabel}.`,
        listing
      );
    }
    const picked = await promptSelectSkills(entries, sourceLabel);
    return picked;
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

  return selected;
}

function formatSkillListing(entries: SkillEntry[], label: string): string {
  return (
    `${heading(`Available skills from ${label}`)} (${entries.length})\n` +
    renderList(entries.map((e) => ({ title: e.name, description: e.description })))
  );
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
