import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { parseSkillFile } from "../../core/parser.js";
import { colors, error, setColorEnabled, success } from "../../utils/format.js";

export interface InstallArgs {
  source: string;
  global?: boolean;
  force?: boolean;
  noColor?: boolean;
  color?: boolean;
}

function resolveSourceSkill(source: string): { dir: string; skillFile: string } {
  const resolved = resolve(source);
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
    const targetRoot = argv.global ? join(process.env.HOME ?? "~", ".claude/skills") : join(process.cwd(), ".claude/skills");
    const dest = installSkill(argv.source, targetRoot, argv.force === true);
    console.log(success(`Installed skill to ${dest}`));
  } catch (err) {
    console.error(error(`Install failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
