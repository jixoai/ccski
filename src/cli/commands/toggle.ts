import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ArgumentsCamelCase } from "yargs";

import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import type { SkillMetadata } from "../../types/skill.js";
import { dim, error, heading, renderList, setColorEnabled, success, tone, warn } from "../../utils/format.js";
import { formatSkillChoiceLabel, skillsToListItems } from "../../utils/skill-render.js";
import { promptMultiSelect } from "../prompts/multiSelect.js";
import { buildRegistryOptions } from "../registry-options.js";
import { applyFilters, parseFilters, type StateFilter } from "../../utils/filters.js";
import { resolveSelectors as resolveNamedSelectors } from "../../utils/resolution.js";
import { AmbiguousSkillNameError, SkillNotFoundError } from "../../types/errors.js";
import { skillAliases } from "../../utils/skill-id.js";
import { InteractiveCommandBuilder } from "../prompts/commandBuilder.js";

export interface ToggleArgs extends SkillRegistryOptions {
  names?: string[];
  force?: boolean;
  override?: boolean;
  interactive?: boolean;
  all?: boolean;
  noColor?: boolean;
  color?: boolean;
  include?: string[];
  exclude?: string[];
  yes?: boolean;
  json?: boolean;
}

export interface ToggleResultEntry {
  skill: string;
  path: string;
  status: "enabled" | "disabled" | "skipped" | "failed";
  error?: string;
}

export interface ToggleSummary {
  mode: "enable" | "disable";
  results: ToggleResultEntry[];
  succeeded: number;
  skipped: number;
  failed: number;
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
  const { includes, excludes } = parseFilters(argv.include as string[] | undefined, argv.exclude as string[] | undefined);
  const state: StateFilter = "all";
  const skills = applyFilters(registry.getAll(), includes, excludes, state);

  const candidates =
    mode === "disable" ? skills.filter((s) => !s.disabled) : skills.filter((s) => s.disabled);

  if (candidates.length === 0) {
    const emptyResult: ToggleSummary = { mode, results: [], succeeded: 0, skipped: 0, failed: 0 };
    if (argv.json) {
      console.log(JSON.stringify(emptyResult, null, 2));
    } else {
      console.log(
        mode === "disable"
          ? warn("No enabled skills found to disable.")
          : warn("No disabled skills found to enable.")
      );
    }
    return;
  }

  // Create command builder for interactive mode
  const cmdBuilder = new InteractiveCommandBuilder(`ccski ${mode}`);
  if (argv.include?.length) {
    cmdBuilder.addArg("include", argv.include as string[]);
  }
  if (argv.exclude?.length) {
    cmdBuilder.addArg("exclude", argv.exclude as string[]);
  }
  const force = argv.force === true || argv.override === true;
  if (force) cmdBuilder.addFlag("force");

  try {
    const selected = await pickSkills(mode, candidates, argv, cmdBuilder);

    // Detect conflicts (skills that need --force)
    const conflicts = detectConflicts(mode, selected);

    // Interactive mode: show confirmation (skip with --yes)
    if (argv.interactive && selected.length > 0 && !argv.yes) {
      const confirmed = await confirmToggle(mode, cmdBuilder, selected, conflicts, force);
      if (!confirmed) {
        console.log(warn(`${capitalize(mode)} cancelled.`));
        return;
      }
    }

    // Execute toggle operations
    const results: ToggleResultEntry[] = [];
    for (const skill of selected) {
      const result = executeToggle(mode, skill, force);
      results.push(result);
    }

    const summary: ToggleSummary = {
      mode,
      results,
      succeeded: results.filter((r) => r.status === mode + "d").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
    };

    // Output results
    if (argv.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printToggleSummary(summary);
    }

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof MultiSelectError) {
      if (argv.json) {
        console.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        const advisory = warn(`Input needed: ${err.message}`);
        console.log(advisory);
        console.log(err.listing.trimEnd());
        console.log(`\n${advisory}`);
      }
      process.exitCode = 1;
      return;
    }
    if (err instanceof SkillNotFoundError || err instanceof AmbiguousSkillNameError) {
      if (argv.json) {
        console.log(JSON.stringify({ error: err.message, suggestions: err.suggestions }, null, 2));
      } else {
        console.error(error(err.message));
        if (err.suggestions.length) {
          console.error(dim(`Did you mean: ${err.suggestions.join(", ")}?`));
        }
      }
      process.exitCode = 1;
      return;
    }
    if (argv.json) {
      console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2));
    } else {
      console.error(error(err instanceof Error ? err.message : String(err)));
    }
    process.exitCode = 1;
  }
}

class MultiSelectError extends Error {
  constructor(message: string, public listing: string) {
    super(message);
    this.name = "MultiSelectError";
  }
}

interface ConflictInfo {
  skill: string;
  path: string;
  reason: string;
}

function detectConflicts(mode: Mode, skills: SkillMetadata[]): ConflictInfo[] {
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

function executeToggle(mode: Mode, skill: SkillMetadata, force: boolean): ToggleResultEntry {
  const skillFile = join(skill.path, "SKILL.md");
  const disabledFile = join(skill.path, ".SKILL.md");
  const hasSkill = existsSync(skillFile);
  const hasDisabled = existsSync(disabledFile);

  try {
    if (mode === "disable") {
      if (!hasSkill && hasDisabled) {
        return { skill: skill.name, path: skill.path, status: "skipped", error: "Already disabled" };
      }
      if (hasSkill && hasDisabled && !force) {
        return { skill: skill.name, path: skill.path, status: "skipped", error: "Both files exist, use --force" };
      }
      if (hasDisabled && force) {
        rmSync(disabledFile);
      }
      if (hasSkill) {
        renameSync(skillFile, disabledFile);
      }
      return { skill: skill.name, path: skill.path, status: "disabled" };
    } else {
      if (hasSkill && !hasDisabled) {
        return { skill: skill.name, path: skill.path, status: "skipped", error: "Already enabled" };
      }
      if (hasSkill && hasDisabled && !force) {
        return { skill: skill.name, path: skill.path, status: "skipped", error: "Both files exist, use --force" };
      }
      if (hasSkill && force) {
        rmSync(skillFile);
      }
      if (!hasDisabled) {
        return { skill: skill.name, path: skill.path, status: "failed", error: "No .SKILL.md found" };
      }
      renameSync(disabledFile, skillFile);
      return { skill: skill.name, path: skill.path, status: "enabled" };
    }
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
  mode: Mode,
  cmdBuilder: InteractiveCommandBuilder,
  selected: SkillMetadata[],
  conflicts: ConflictInfo[],
  force: boolean
): Promise<boolean> {
  console.log();
  console.log(heading(`${capitalize(mode)} Summary`));
  console.log();

  console.log(`${tone.bold("Skills:")} ${selected.length} selected`);
  for (const skill of selected) {
    console.log(`  ${tone.primary("•")} ${skill.name} ${dim(`(${skill.location})`)}`);
  }
  console.log();

  if (conflicts.length > 0) {
    if (force) {
      console.log(`${tone.warning("Will overwrite:")} ${conflicts.length} skill(s) with conflicts`);
    } else {
      console.log(`${tone.warning("Will skip:")} ${conflicts.length} skill(s) with conflicts`);
    }
    for (const c of conflicts.slice(0, 5)) {
      console.log(`  ${tone.warning("•")} ${c.skill}: ${dim(c.reason)}`);
    }
    if (conflicts.length > 5) {
      console.log(dim(`  ... and ${conflicts.length - 5} more`));
    }
    console.log();
  }

  console.log(`${tone.bold("Command:")}`);
  console.log(`  ${tone.accent(cmdBuilder.buildFull())}`);
  console.log();

  const { confirm } = await import("@inquirer/prompts");
  return confirm({ message: "Proceed?", default: true });
}

function printToggleSummary(summary: ToggleSummary): void {
  const { mode, results, succeeded, skipped, failed } = summary;
  const successStatus = mode === "disable" ? "disabled" : "enabled";

  for (const r of results) {
    let status: string;
    switch (r.status) {
      case "enabled":
      case "disabled":
        status = tone.success(`✓ ${r.status}`);
        break;
      case "skipped":
        status = dim(`○ skipped${r.error ? `: ${r.error}` : ""}`);
        break;
      case "failed":
        status = tone.error(`✗ failed${r.error ? `: ${r.error}` : ""}`);
        break;
    }
    console.log(`${tone.bold(r.skill)}: ${status}`);
  }

  console.log();
  const parts: string[] = [];
  if (succeeded > 0) parts.push(tone.success(`${succeeded} ${successStatus}`));
  if (skipped > 0) parts.push(dim(`${skipped} skipped`));
  if (failed > 0) parts.push(tone.error(`${failed} failed`));

  if (parts.length === 0) {
    console.log(warn("No skills were processed."));
  } else {
    console.log(`Summary: ${parts.join(", ")}`);
  }

  if (skipped > 0 && failed === 0 && succeeded === 0) {
    console.log(dim("Use --force to override existing files."));
  }
}

async function pickSkills(
  mode: Mode,
  candidates: SkillMetadata[],
  argv: ArgumentsCamelCase<ToggleArgs>,
  cmdBuilder: InteractiveCommandBuilder
): Promise<SkillMetadata[]> {
  const selectors = parseNames(argv);
  const headingLabel = heading(mode === "disable" ? "Enabled skills" : "Disabled skills");
  const listing = `${headingLabel} (${candidates.length})\n${renderList(skillsToListItems(candidates))}`;

  if (argv.all) {
    cmdBuilder.addFlag("all");
    return candidates;
  }

  if (selectors.length > 0) {
    // Add selected names to builder
    cmdBuilder.addArg("names", selectors, { positional: true });
    return resolveNamedSelectors(candidates, selectors);
  }

  if (argv.interactive) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new MultiSelectError("Interactive mode requires a TTY.", listing);
    }

    // Configure command builder for skill selection
    cmdBuilder.addArg("names", candidates.map((c) => c.name), {
      positional: true,
      totalChoices: candidates.length,
      shortRender: (values, total) => {
        if (total && values.length === total && values.length > 1) return ["--all"];
        if (values.length <= 3) return values;
        return [...values.slice(0, 3), `... (+${values.length - 3} more)`];
      },
    });

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

    // Update builder with final selection
    cmdBuilder.updateArg("names", names);

    const pickedSet = new Set(names.map((n) => n.toLowerCase()));
    return candidates.filter((c) => skillAliases(c).some((alias) => pickedSet.has(alias)));
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
