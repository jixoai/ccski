import { existsSync, lstatSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { dim, error, setColorEnabled, success } from "../../utils/format.js";
import { parseSkillFile, validateSkillFile } from "../../core/parser.js";
import { applyFilters, parseFilters, type StateFilter } from "../../utils/filters.js";
import { SkillRegistry } from "../../core/registry.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface ValidateArgs {
  path: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  include?: string[];
  exclude?: string[];
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
  all?: boolean;
  disabled?: boolean;
}

export async function validateCommand(argv: ArgumentsCamelCase<ValidateArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }
  if (argv.color) {
    setColorEnabled(true);
  }

  // Filter-aware validation: build registry to align with other commands
  const registry = new SkillRegistry(buildRegistryOptions(argv));
  const includeArgs = argv.include as string[] | undefined;
  const includeFallback = !includeArgs?.length && argv.all ? ["all"] : includeArgs;
  const { includes, excludes } = parseFilters(includeFallback, argv.exclude as string[] | undefined);
  const state: StateFilter = argv.disabled ? "disabled" : argv.all ? "all" : "enabled";
  const filtered = applyFilters(registry.getAll(), includes, excludes, state);

  const target = resolve(argv.path);
  const skillFile = resolveSkillFile(target);

  if (!skillFile) {
    console.error(error(`Error: Could not find SKILL.md at ${target}`));
    process.exitCode = 1;
    return;
  }

  const result = validateSkillFile(skillFile);
  const provider = inferProvider(skillFile, filtered);
  const codexIssues: string[] = [];
  const codexWarnings: string[] = [];

  if (result.success && provider === "codex") {
    try {
      const parsed = parseSkillFile(skillFile);
      codexIssues.push(...codexRuleViolations(parsed.frontmatter.name, parsed.frontmatter.description));
      const stats = lstatSync(skillFile);
      if (stats.isSymbolicLink()) {
        codexWarnings.push(`SKILL.md is a symlink (${skillFile})`);
      }
      const dirStats = lstatSync(resolve(skillFile, ".."));
      if (dirStats.isSymbolicLink()) {
        codexWarnings.push(`Skill directory is a symlink (${resolve(skillFile, "..")})`);
      }
    } catch {
      // fall back to base validation errors
    }
  }

  const errors = [...result.errors, ...codexIssues];
  const warnings = [...result.suggestions, ...codexWarnings];
  if (argv.json) {
    console.log(
      JSON.stringify(
        {
          file: skillFile,
          success: errors.length === 0,
          errors,
          warnings,
        },
        null,
        2
      )
    );
    process.exitCode = errors.length === 0 ? 0 : 1;
    return;
  }

  if (errors.length === 0) {
    console.log(`${success("✓ Skill is valid")} (${skillFile})`);
    if (warnings.length) {
      warnings.forEach((w) => console.log(dim(` - ${w}`)));
    }
    return;
  }

  console.error(error(`Validation failed for ${skillFile}`));
  errors.forEach((err) => console.error(` - ${err}`));
  if (warnings.length) {
    console.error(dim("Warnings:"));
    warnings.forEach((w) => console.error(dim(`   • ${w}`)));
  }
  process.exitCode = 1;
}

function resolveSkillFile(input: string): string | null {
  if (!existsSync(input)) return null;
  const stats = statSync(input);

  if (stats.isDirectory()) {
    const candidate = join(input, "SKILL.md");
    return existsSync(candidate) ? candidate : null;
  }

  if (stats.isFile() && input.toLowerCase().endsWith("skill.md")) {
    return input;
  }

  return null;
}

function inferProvider(skillPath: string, filtered: Array<{ path: string; provider: "claude" | "codex" | "file" }>): "claude" | "codex" | "file" {
  const lower = skillPath.toLowerCase();
  const match = filtered.find((s) => s.path === resolve(skillPath, ".."));
  if (match) return match.provider;
  if (lower.includes("/.codex/skills")) return "codex";
  if (lower.includes("/.claude/skills") || lower.includes("/.agent/skills")) return "claude";
  return "file";
}

function codexRuleViolations(name: string, description: string): string[] {
  const issues: string[] = [];
  if (name.length > 100) issues.push("Codex rule: name exceeds 100 characters");
  if (description.length > 500) issues.push("Codex rule: description exceeds 500 characters");
  if (name.includes("\n")) issues.push("Codex rule: name must be single-line");
  if (description.includes("\n")) issues.push("Codex rule: description must be single-line");
  return issues;
}
