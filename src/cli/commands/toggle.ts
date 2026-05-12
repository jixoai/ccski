import type { ArgumentsCamelCase } from "yargs";

import {
  MultiSelectError,
  ToggleCancelledError,
  toggleSkills,
  type ToggleMode,
} from "../../api/toggle.js";
import type { ToggleOptions, ToggleSummary } from "../../api/types.js";
import { AmbiguousSkillNameError, SkillNotFoundError } from "../../types/errors.js";
import { dim, error, setColorEnabled, tone, warn } from "../../utils/format.js";

export interface ToggleArgs extends ToggleOptions {
  noColor?: boolean;
  color?: boolean;
  json?: boolean;
}

export async function enableCommand(argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  await toggleCommand("enable", argv);
}

export async function disableCommand(argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  await toggleCommand("disable", argv);
}

async function toggleCommand(
  mode: ToggleMode,
  argv: ArgumentsCamelCase<ToggleArgs>
): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  try {
    const summary = await toggleSkills(mode, argv, { log: console.log });

    if (summary.results.length === 0) {
      if (argv.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(
          mode === "disable"
            ? warn("No enabled skills found to disable.")
            : warn("No disabled skills found to enable.")
        );
      }
      return;
    }

    if (argv.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printToggleSummary(summary);
    }

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof ToggleCancelledError) {
      if (argv.json) {
        console.log(JSON.stringify({ error: err.message }, null, 2));
      } else {
        console.log(warn(`${capitalize(err.mode)} cancelled.`));
      }
      return;
    }
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
      console.log(
        JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2)
      );
    } else {
      console.error(error(err instanceof Error ? err.message : String(err)));
    }
    process.exitCode = 1;
  }
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
        status = tone.danger(`✗ failed${r.error ? `: ${r.error}` : ""}`);
        break;
    }
    console.log(`${tone.bold(r.skill)}: ${status}`);
  }

  console.log();
  const parts: string[] = [];
  if (succeeded > 0) parts.push(tone.success(`${succeeded} ${successStatus}`));
  if (skipped > 0) parts.push(dim(`${skipped} skipped`));
  if (failed > 0) parts.push(tone.danger(`${failed} failed`));

  if (parts.length === 0) {
    console.log(warn("No skills were processed."));
  } else {
    console.log(`Summary: ${parts.join(", ")}`);
  }

  if (skipped > 0 && failed === 0 && succeeded === 0) {
    console.log(dim("Use --force to override existing files."));
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
