import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import type { ArgumentsCamelCase } from "yargs";
import { parseSkillFile } from "../../core/parser.js";
import { error, setColorEnabled, success } from "../../utils/format.js";

export interface InstallArgs {
  source: string;
  global?: boolean;
  force?: boolean;
  override?: boolean;
  use?: string;
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
      throw new Error(`No skills found to install in ${localPath}`);
    }

    const force = argv.force === true || argv.override === true;
    const installed: string[] = [];
    for (const dir of targets) {
      installed.push(installSkillDir(dir, targetRoot, force));
    }

    console.log(success(`Installed ${installed.length} skill(s):`));
    installed.forEach((d) => console.log(` - ${d}`));
  } catch (err) {
    console.error(error(`Install failed: ${err instanceof Error ? err.message : String(err)}`));
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
