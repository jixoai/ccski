import { existsSync, lstatSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSkillFile, validateSkillFile } from "../core/parser.js";
import { SkillRegistry } from "../core/registry.js";
import type { SkillProvider } from "../types/skill.js";
import { applyFilters } from "../utils/filters.js";
import { providerNamesFromSkills } from "../utils/providers.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { resolveFilters } from "./filters.js";
import type { ValidateOptions, ValidateResult } from "./types.js";

export async function validateSkill(options: ValidateOptions): Promise<ValidateResult> {
  const registry = new SkillRegistry(buildRegistryOptions(options));
  const { includes, excludes, state } = resolveFilters(options, {
    providers: providerNamesFromSkills(registry.getAll()),
  });
  const filtered = applyFilters(registry.getAll(), includes, excludes, state);

  const target = resolve(options.path);
  const skillFile = resolveSkillFile(target);

  if (!skillFile) {
    throw new Error(`Could not find SKILL.md at ${target}`);
  }

  const result = validateSkillFile(skillFile);
  const provider = inferProvider(skillFile, filtered);
  const codexIssues: string[] = [];
  const codexWarnings: string[] = [];

  if (result.success && provider === "codex") {
    try {
      const parsed = parseSkillFile(skillFile);
      codexIssues.push(
        ...codexRuleViolations(parsed.frontmatter.name, parsed.frontmatter.description)
      );
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

  return {
    file: skillFile,
    success: errors.length === 0,
    errors,
    warnings,
  };
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

function inferProvider(
  skillPath: string,
  filtered: Array<{ path: string; provider: SkillProvider }>
): SkillProvider {
  const lower = skillPath.toLowerCase();
  const match = filtered.find((s) => s.path === resolve(skillPath, ".."));
  if (match) return match.provider;
  const hiddenAgent = lower.split("/").find((segment) => segment.startsWith("."));
  const provider = hiddenAgent?.slice(1);
  if (provider === "agent" || provider === "agents") return "agents";
  if (provider && lower.includes(`/.${provider}/skills`)) return provider;
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
