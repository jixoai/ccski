import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { InteractiveCommandBuilder } from "../cli/prompts/commandBuilder.js";
import { promptMultiSelect } from "../cli/prompts/multiSelect.js";
import { SkillRegistry } from "../core/registry.js";
import type { SkillMetadata } from "../types/skill.js";
import { applyFilters, parseFilters, type StateFilter } from "../utils/filters.js";
import { dim, heading, renderList, tone } from "../utils/format.js";
import { providerNamesFromSkills } from "../utils/providers.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { resolveSelectors as resolveNamedSelectors } from "../utils/resolution.js";
import { skillAliases } from "../utils/skill-id.js";
import { formatSkillChoiceLabel, skillsToListItems } from "../utils/skill-render.js";
import type { ToggleOptions, ToggleResultEntry, ToggleSummary } from "./types.js";

export type ToggleMode = "enable" | "disable";

interface ToggleOutput {
  log: (message?: string) => void;
}

const silentOutput: ToggleOutput = { log: () => {} };

export async function toggleSkills(
  mode: ToggleMode,
  options: ToggleOptions,
  output: ToggleOutput = silentOutput
): Promise<ToggleSummary> {
  const registry = new SkillRegistry(buildRegistryOptions(options, { includeDisabled: true }));
  const { includes, excludes } = parseFilters(
    options.include as string[] | undefined,
    options.exclude as string[] | undefined,
    { providers: providerNamesFromSkills(registry.getAll()) }
  );
  const state: StateFilter = "all";
  const skills = applyFilters(registry.getAll(), includes, excludes, state);

  const candidates =
    mode === "disable" ? skills.filter((s) => !s.disabled) : skills.filter((s) => s.disabled);

  if (candidates.length === 0) {
    return { mode, results: [], succeeded: 0, skipped: 0, failed: 0 };
  }

  const cmdBuilder = new InteractiveCommandBuilder(`ccski ${mode}`);
  if (options.include?.length) {
    cmdBuilder.addArg("include", options.include as string[]);
  }
  if (options.exclude?.length) {
    cmdBuilder.addArg("exclude", options.exclude as string[]);
  }
  const force = options.force === true || options.override === true;
  if (force) cmdBuilder.addFlag("force");

  const selected = await pickSkills(mode, candidates, options, cmdBuilder);

  const conflicts = detectConflicts(selected);

  if (options.interactive && selected.length > 0 && !options.yes) {
    const confirmed = await confirmToggle(mode, cmdBuilder, selected, conflicts, force, output);
    if (!confirmed) {
      throw new ToggleCancelledError(mode);
    }
  }

  const results: ToggleResultEntry[] = [];
  for (const skill of selected) {
    results.push(executeToggle(mode, skill, force));
  }

  return {
    mode,
    results,
    succeeded: results.filter((r) => r.status === `${mode}d`).length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}

export class MultiSelectError extends Error {
  constructor(
    message: string,
    public listing: string
  ) {
    super(message);
    this.name = "MultiSelectError";
  }
}

export class ToggleCancelledError extends Error {
  constructor(public mode: ToggleMode) {
    super(`${mode} cancelled`);
    this.name = "ToggleCancelledError";
  }
}

interface ConflictInfo {
  skill: string;
  path: string;
  reason: string;
}

function detectConflicts(skills: SkillMetadata[]): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  for (const skill of skills) {
    const skillFile = join(skill.path, "SKILL.md");
    const disabledFile = join(skill.path, ".SKILL.md");
    const hasSkill = existsSync(skillFile);
    const hasDisabled = existsSync(disabledFile);

    if (hasSkill && hasDisabled) {
      conflicts.push({
        skill: skill.name,
        path: skill.path,
        reason: "Both SKILL.md and .SKILL.md exist",
      });
    }
  }
  return conflicts;
}

function executeToggle(mode: ToggleMode, skill: SkillMetadata, force: boolean): ToggleResultEntry {
  const skillFile = join(skill.path, "SKILL.md");
  const disabledFile = join(skill.path, ".SKILL.md");
  const hasSkill = existsSync(skillFile);
  const hasDisabled = existsSync(disabledFile);

  try {
    if (mode === "disable") {
      if (!hasSkill && hasDisabled) {
        return {
          skill: skill.name,
          path: skill.path,
          status: "skipped",
          error: "Already disabled",
        };
      }
      if (hasSkill && hasDisabled && !force) {
        return {
          skill: skill.name,
          path: skill.path,
          status: "skipped",
          error: "Both files exist, use --force",
        };
      }
      if (hasDisabled && force) {
        rmSync(disabledFile);
      }
      if (hasSkill) {
        renameSync(skillFile, disabledFile);
      }
      return { skill: skill.name, path: skill.path, status: "disabled" };
    }

    if (hasSkill && !hasDisabled) {
      return { skill: skill.name, path: skill.path, status: "skipped", error: "Already enabled" };
    }
    if (hasSkill && hasDisabled && !force) {
      return {
        skill: skill.name,
        path: skill.path,
        status: "skipped",
        error: "Both files exist, use --force",
      };
    }
    if (hasSkill && force) {
      rmSync(skillFile);
    }
    if (!hasDisabled) {
      return { skill: skill.name, path: skill.path, status: "failed", error: "No .SKILL.md found" };
    }
    renameSync(disabledFile, skillFile);
    return { skill: skill.name, path: skill.path, status: "enabled" };
  } catch (err) {
    return {
      skill: skill.name,
      path: skill.path,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function confirmToggle(
  mode: ToggleMode,
  cmdBuilder: InteractiveCommandBuilder,
  selected: SkillMetadata[],
  conflicts: ConflictInfo[],
  force: boolean,
  output: ToggleOutput
): Promise<boolean> {
  output.log();
  output.log(heading(`${capitalize(mode)} Summary`));
  output.log();

  output.log(`${tone.bold("Skills:")} ${selected.length} selected`);
  for (const skill of selected) {
    output.log(`  ${tone.primary("•")} ${skill.name} ${dim(`(${skill.location})`)}`);
  }
  output.log();

  if (conflicts.length > 0) {
    if (force) {
      output.log(`${tone.warning("Will overwrite:")} ${conflicts.length} skill(s) with conflicts`);
    } else {
      output.log(`${tone.warning("Will skip:")} ${conflicts.length} skill(s) with conflicts`);
    }
    for (const c of conflicts.slice(0, 5)) {
      output.log(`  ${tone.warning("•")} ${c.skill}: ${dim(c.reason)}`);
    }
    if (conflicts.length > 5) {
      output.log(dim(`  ... and ${conflicts.length - 5} more`));
    }
    output.log();
  }

  output.log(`${tone.bold("Command:")}`);
  output.log(`  ${tone.accent(cmdBuilder.buildFull())}`);
  output.log();

  const { confirm } = await import("@inquirer/prompts");
  return confirm({ message: "Proceed?", default: true });
}

async function pickSkills(
  mode: ToggleMode,
  candidates: SkillMetadata[],
  options: ToggleOptions,
  cmdBuilder: InteractiveCommandBuilder
): Promise<SkillMetadata[]> {
  const selectors = parseNames(options);
  const headingLabel = heading(mode === "disable" ? "Enabled skills" : "Disabled skills");
  const listing = `${headingLabel} (${candidates.length})\n${renderList(skillsToListItems(candidates))}`;

  if (options.all) {
    cmdBuilder.addFlag("all");
    return candidates;
  }

  if (selectors.length > 0) {
    cmdBuilder.addArg("names", selectors, { positional: true });
    return resolveNamedSelectors(candidates, selectors);
  }

  if (options.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new MultiSelectError("Interactive mode requires a TTY.", listing);
    }

    cmdBuilder.addArg(
      "names",
      candidates.map((c) => c.name),
      {
        positional: true,
        totalChoices: candidates.length,
        shortRender: (values, total) => {
          if (total && values.length === total && values.length > 1) return ["--all"];
          if (values.length <= 3) return values;
          return [...values.slice(0, 3), `... (+${values.length - 3} more)`];
        },
      }
    );

    const names = await promptMultiSelect({
      message: mode === "disable" ? "Select skills to disable" : "Select skills to enable",
      choices: candidates.map((skill) => ({
        value: skill.name,
        label: formatSkillChoiceLabel(skill),
        description: skill.description,
        checked: false,
      })),
      defaultChecked: false,
      commandBuilder: cmdBuilder,
      commandArgKey: "names",
    });

    if (!Array.isArray(names) || names.length === 0) {
      throw new MultiSelectError("No skills selected.", listing);
    }

    cmdBuilder.updateArg("names", names);

    const pickedSet = new Set(names.map((n) => n.toLowerCase()));
    return candidates.filter((c) => skillAliases(c).some((alias) => pickedSet.has(alias)));
  }

  throw new MultiSelectError(
    "Multiple skills available. Provide names, use --all, or enable interactive mode (-i).",
    listing
  );
}

function parseNames(options: ToggleOptions): string[] {
  const raw = ([] as string[]).concat(Array.isArray(options.names) ? options.names : []);

  return raw
    .flatMap((item) => item.split(/[\\/,]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
