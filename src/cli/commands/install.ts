import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { checkbox } from "@inquirer/prompts";
import type { ArgumentsCamelCase } from "yargs";
import { parseSkillFile } from "../../core/parser.js";
import { colors, error, renderList, setColorEnabled, success } from "../../utils/format.js";
import { rankStrings } from "../../utils/search.js";

export interface InstallArgs {
  source: string;
  global?: boolean;
  force?: boolean;
  override?: boolean;
  use?: string;
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
    throw new Error(`Skill '${skillName}' already exists at ${destDir} (use --force/--override to overwrite)`);
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
  constructor(message: string, public listing: string) {
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
    const materialized = await materializeSource(argv.source);
    const targets = resolveInstallTargets(materialized.base, argv.use ?? materialized.useHint);

    if (targets.length === 0) {
      throw new Error(`No skills found to install in ${materialized.base}`);
    }

    const force = argv.force === true || argv.override === true;
    const selection = await selectSkills(targets, argv, argv.source);

    const installed: string[] = [];
    for (const entry of selection) {
      installed.push(installSkillDir(entry.dir, targetRoot, force));
    }

    console.log(success(`Installed ${installed.length} skill(s):`));
    installed.forEach((d) => console.log(` - ${d}`));
  } catch (err) {
    if (err instanceof MultiSkillSelectionError) {
      console.error(error(`Install failed: ${err.message}`));
      console.log(err.listing);
    } else {
      console.error(error(`Install failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    process.exitCode = 1;
  }
}

function parseGithubTree(url: URL): { repo: string; ref?: string; subdir?: string } | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 4 && parts[2] === "tree") {
    const [owner, repo, , ref, ...rest] = parts;
    return {
      repo: `https://github.com/${owner}/${repo}.git`,
      ref,
      subdir: rest.length ? rest.join("/") : undefined,
    };
  }
  return null;
}

function parseGithubBlob(url: URL): { repo: string; ref?: string; path: string } | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 5 && parts[2] === "blob") {
    const [owner, repo, , ref, ...rest] = parts;
    return {
      repo: `https://github.com/${owner}/${repo}.git`,
      ref,
      path: rest.join("/"),
    };
  }
  return null;
}

interface MaterializedSource {
  base: string;
  useHint?: string;
}

async function materializeSource(source: string): Promise<MaterializedSource> {
  if (source.startsWith("file://")) return { base: new URL(source).pathname };

  if (source.startsWith("http://") || source.startsWith("https://") || source.endsWith(".git")) {
    let repo = source;
    let ref: string | undefined;
    let subdir: string | undefined;
    let useHint: string | undefined;

    try {
      const url = new URL(source);
      const ghTree = parseGithubTree(url);
      if (ghTree) {
        repo = ghTree.repo;
        ref = ghTree.ref;
        subdir = ghTree.subdir;
      } else {
        const ghBlob = parseGithubBlob(url);
        if (ghBlob) {
          repo = ghBlob.repo;
          ref = ghBlob.ref;
          useHint = ghBlob.path;
        }
      }
    } catch {
      // fall through, treat as raw git URL
    }

    const tmp = mkdtempSync(join(tmpdir(), "ccski-install-"));

    const clone = ["git", "clone", "--depth", "1"];
    if (ref) {
      clone.push("--branch", ref);
    }
    clone.push(repo, tmp);

    execSync(clone.join(" "), { stdio: "ignore" });

    return { base: subdir ? join(tmp, subdir) : tmp, useHint };
  }

  return { base: normalizeSourcePath(source) };
}

function resolveSkillPath(baseDir: string, rel: string): string | null {
  const cleaned = rel.replace(/^\.\//, "");

  const candidates: string[] = [];
  if (cleaned.endsWith("SKILL.md")) {
    candidates.push(dirname(join(baseDir, cleaned)));
    candidates.push(dirname(join(baseDir, "..", cleaned)));
  } else {
    candidates.push(join(baseDir, cleaned));
    candidates.push(join(baseDir, "..", cleaned));
  }

  for (const dir of candidates) {
    if (existsSync(join(dir, "SKILL.md"))) return dir;
  }

  return null;
}

function marketplaceSkills(marketplacePath: string): string[] {
  const data = JSON.parse(readFileSync(marketplacePath, "utf8"));
  const dir = dirname(marketplacePath);
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];

  const skillPaths = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin || !Array.isArray(plugin.skills)) continue;
    for (const rel of plugin.skills) {
      if (typeof rel !== "string") continue;
      const resolved = resolveSkillPath(dir, rel);
      if (resolved) skillPaths.add(resolve(resolved));
    }
  }
  return Array.from(skillPaths);
}

function resolveInstallTargets(root: string, usePath?: string): string[] {
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
  if ((usePath || !statSync(base).isDirectory()) && existsSync(candidatePath) && candidatePath.endsWith("marketplace.json")) {
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

  throw new Error(`No SKILL.md or marketplace.json found in ${base}${usePath ? ` (use: ${usePath})` : ""}`);
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

async function promptSelectSkills(entries: SkillEntry[]): Promise<SkillEntry[]> {
  const pickedNames = await checkbox({
    message: "Select skills to install",
    pageSize: Math.min(12, Math.max(6, entries.length)),
    loop: false,
    choices: entries.map((e) => ({
      name: `${e.name} — ${e.description}`,
      value: e.name,
      checked: true,
    })),
    validate: (value) => (Array.isArray(value) && value.length > 0 ? true : "Pick at least one skill"),
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
    console.log(listing + "\n");
    const picked = await promptSelectSkills(entries);
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
      const ranked = (rankedIdx.length ? rankedIdx : names.map((_, idx) => idx)).slice(0, 3).map((i) => names[i]!);
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
  return `${colors.underline(colors.bold(`Available skills from ${label}`))} (${entries.length})\n` +
    renderList(entries.map((e) => ({ title: e.name, description: e.description })));
}
