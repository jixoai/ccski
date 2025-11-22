import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
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
  noColor?: boolean;
  color?: boolean;
}

function resolveSourceSkill(source: string): { dir: string; skillFile: string } {
  const normalized = source.startsWith("file://") ? new URL(source).pathname : source;
  const resolved = resolve(normalized);
  const stats = statSync(resolved);

  if (stats.isFile()) {
    if (!resolved.toLowerCase().endsWith("skill.md")) {
      throw new Error(`Source file must be SKILL.md, got ${resolved}`);
    }
    return { dir: dirname(resolved), skillFile: resolved };
  }

  if (stats.isDirectory()) {
    const skillFile = join(resolved, "SKILL.md");
    if (!existsSync(skillFile)) {
      throw new Error(`No SKILL.md found in ${resolved}`);
    }
    return { dir: resolved, skillFile };
  }

  throw new Error(`Unsupported source: ${resolved}`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function installSkill(source: string, targetRoot: string, force = false): string {
  const { dir, skillFile } = resolveSourceSkill(source);
  const parsed = parseSkillFile(skillFile);
  const skillName = parsed.frontmatter.name;

  const destDir = join(targetRoot, skillName);
  ensureDir(targetRoot);

  if (!force && existsSync(destDir)) {
    throw new Error(`Skill '${skillName}' already exists at ${destDir} (use --force to overwrite)`);
  }

  cpSync(dir, destDir, { recursive: true, force: true });
  return destDir;
}

export async function installCommand(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  try {
    const targetRoot = argv.global
      ? join(process.env.HOME ?? "~", ".claude/skills")
      : join(process.cwd(), ".claude/skills");
    const localPath = await materializeSource(argv.source);
    const dest = installSkill(localPath, targetRoot, argv.force === true || argv.override === true);
    console.log(success(`Installed skill to ${dest}`));
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

async function materializeSource(source: string): Promise<string> {
  if (source.startsWith("file://")) return new URL(source).pathname;

  if (source.startsWith("http://") || source.startsWith("https://") || source.endsWith(".git")) {
    let repo = source;
    let ref: string | undefined;
    let subdir: string | undefined;

    try {
      const url = new URL(source);
      const gh = parseGithubTree(url);
      if (gh) {
        repo = gh.repo;
        ref = gh.ref;
        subdir = gh.subdir;
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

    return subdir ? join(tmp, subdir) : tmp;
  }

  return source;
}
