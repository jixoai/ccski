import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkbox } from "@inquirer/prompts";
import type { ArgumentsCamelCase } from "yargs";

import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import type { SkillMetadata } from "../../types/skill.js";
import { colors, dim, error, renderList, setColorEnabled, success } from "../../utils/format.js";
import { rankStrings } from "../../utils/search.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface ToggleArgs extends SkillRegistryOptions {
  names?: string[];
  force?: boolean;
  override?: boolean;
  interactive?: boolean;
  all?: boolean;
  noColor?: boolean;
  color?: boolean;
}

type Mode = "enable" | "disable";

export async function enableCommand(argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  await toggleCommand("enable", argv);
}

export async function disableCommand(argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  await toggleCommand("disable", argv);
}

async function toggleCommand(mode: Mode, argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const registry = new SkillRegistry(buildRegistryOptions(argv, { includeDisabled: true }));
  const skills = registry.getAll();

  const candidates =
    mode === "disable" ? skills.filter((s) => !s.disabled) : skills.filter((s) => s.disabled);

  if (candidates.length === 0) {
    console.log(mode === "disable" ? "No enabled skills found to disable." : "No disabled skills found to enable.");
    return;
  }

  try {
    const selected = await pickSkills(mode, candidates, argv);
    const force = argv.force === true || argv.override === true;

    const succeeded: string[] = [];
    const failures: string[] = [];

    for (const skill of selected) {
      try {
        if (mode === "disable") {
          disableSkill(skill, force);
        } else {
          enableSkill(skill, force);
        }
        succeeded.push(skill.name);
      } catch (err) {
        failures.push(skill.name);
        console.error(
          error(
            `${capitalize(mode)} ${skill.name} failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    }

    if (succeeded.length) {
      console.log(success(`${capitalize(mode)}d ${succeeded.length} skill(s):`));
      succeeded.forEach((name) => console.log(` - ${name}`));
    }

    if (failures.length) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof MultiSelectError) {
      console.error(error(err.message));
      console.log(err.listing);
      process.exitCode = 1;
      return;
    }
    console.error(error(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
}

class MultiSelectError extends Error {
  constructor(message: string, public listing: string) {
    super(message);
    this.name = "MultiSelectError";
  }
}

async function pickSkills(
  mode: Mode,
  candidates: SkillMetadata[],
  argv: ArgumentsCamelCase<ToggleArgs>
): Promise<SkillMetadata[]> {
  const selectors = parseNames(argv);
  const heading =
    mode === "disable"
      ? `${colors.underline(colors.bold("Enabled skills"))} (${candidates.length})`
      : `${colors.underline(colors.bold("Disabled skills"))} (${candidates.length})`;
  const listing = `${heading}\n${renderList(toListItems(candidates))}`;

  if (argv.all) return candidates;

  if (selectors.length > 0) {
    return resolveSelectors(selectors, candidates);
  }

  if (argv.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new MultiSelectError("Interactive mode requires a TTY.", listing);
    }
    console.log(listing + "\n");
    const names = await checkbox({
      message: mode === "disable" ? "Select skills to disable" : "Select skills to enable",
      pageSize: Math.min(12, Math.max(6, candidates.length)),
      loop: false,
      choices: candidates.map((skill) => ({
        name: `${skill.name} — ${skill.description}`,
        value: skill.name,
        checked: true,
      })),
      validate: (value) => (Array.isArray(value) && value.length > 0 ? true : "Pick at least one skill"),
    });

    if (!Array.isArray(names) || names.length === 0) {
      throw new MultiSelectError("No skills selected.", listing);
    }
    const pickedSet = new Set(names.map((n) => n.toLowerCase()));
    return candidates.filter((c) => pickedSet.has(c.name.toLowerCase()));
  }

  throw new MultiSelectError(
    `Multiple skills available. Provide names, use --all, or enable interactive mode (-i).`,
    listing
  );
}

function parseNames(argv: ArgumentsCamelCase<ToggleArgs>): string[] {
  const raw = ([] as string[]).concat(
    Array.isArray(argv.names) ? (argv.names as string[]) : [],
    (argv._ ?? []).slice(1).map(String)
  );

  return raw
    .flatMap((item) => item.split(/[\\/,]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveSelectors(selectors: string[], candidates: SkillMetadata[]): SkillMetadata[] {
  const names = candidates.map((c) => c.name);
  const picked: SkillMetadata[] = [];

  for (const raw of selectors) {
    const lower = raw.toLowerCase();
    const exact = candidates.find((c) => c.name.toLowerCase() === lower);
    if (exact) {
      if (!picked.some((p) => p.name === exact.name)) picked.push(exact);
      continue;
    }

    const partial = candidates.filter((c) => c.name.toLowerCase().includes(lower));
    if (partial.length === 1) {
      picked.push(partial[0]!);
      continue;
    }

    const rankedIdx = rankStrings(names, raw);
    const suggestions = (rankedIdx.length ? rankedIdx : names.map((_, idx) => idx)).slice(0, 3).map((i) => names[i]!);
    const hint = suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : "";
    throw new Error(`Skill '${raw}' not found among candidates.${hint}`);
  }

  return picked;
}

function disableSkill(skill: SkillMetadata, force: boolean): void {
  const skillFile = join(skill.path, "SKILL.md");
  const disabledFile = join(skill.path, ".SKILL.md");
  const hasSkill = existsSync(skillFile);
  const hasDisabled = existsSync(disabledFile);

  if (!hasSkill && !hasDisabled) {
    throw new Error("No SKILL.md found in directory.");
  }

  if (!hasSkill && hasDisabled) {
    throw new Error("Skill is already disabled.");
  }

  if (hasSkill && hasDisabled && !force) {
    throw new Error("Both SKILL.md and .SKILL.md exist. Use --force to overwrite the disabled copy.");
  }

  if (hasDisabled && force) {
    rmSync(disabledFile);
  }

  if (hasSkill) {
    renameSync(skillFile, disabledFile);
  }
}

function enableSkill(skill: SkillMetadata, force: boolean): void {
  const skillFile = join(skill.path, "SKILL.md");
  const disabledFile = join(skill.path, ".SKILL.md");
  const hasSkill = existsSync(skillFile);
  const hasDisabled = existsSync(disabledFile);

  if (!hasSkill && !hasDisabled) {
    throw new Error("No .SKILL.md found to enable.");
  }

  if (hasSkill && !hasDisabled) {
    throw new Error("Skill is already enabled.");
  }

  if (hasSkill && hasDisabled && !force) {
    throw new Error("Both SKILL.md and .SKILL.md exist. Use --force to replace SKILL.md with the disabled copy.");
  }

  if (hasSkill && force) {
    rmSync(skillFile);
  }

  if (!hasDisabled) {
    throw new Error("No .SKILL.md found to enable.");
  }

  renameSync(disabledFile, skillFile);
}

function toListItems(skills: SkillMetadata[]) {
  return skills.map((skill) => ({
    title: skill.name,
    color: skill.disabled ? colors.red : undefined,
    badge: skill.disabled ? colors.red("[disabled]") : undefined,
    meta:
      skill.location === "plugin"
        ? skill.pluginInfo?.pluginName ?? dim(skill.location)
        : dim(skill.location),
    description: skill.description,
  }));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
