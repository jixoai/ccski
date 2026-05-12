import type { ArgumentsCamelCase } from "yargs";
import {
  createConsoleInstallOutput,
  InstallCancelledError,
  installSkills,
  MultiSkillSelectionError,
  registerInstallCleanupHandlers,
} from "../../api/install.js";
import type {
  AgentInstructionScope,
  InstallOptions,
  InstallPreview,
  InstallResult,
  InstallSummary,
} from "../../api/types.js";
import { dim, error, heading, info, setColorEnabled, tone, warn } from "../../utils/format.js";
import { installWorkflowCommand } from "./install-workflow.js";

export interface InstallArgs extends InstallOptions {
  noColor?: boolean;
  color?: boolean;
  json?: boolean;
  agents?: string[];
  agent?: string[];
  scope?: AgentInstructionScope;
  project?: boolean;
  user?: boolean;
}

export async function installCommand(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  registerInstallCleanupHandlers();

  const skills = Array.isArray(argv._) ? argv._.slice(1).map(String) : [];
  const source = typeof argv.source === "string" ? argv.source : skills.shift();

  if (!source) {
    await installWorkflowCommand(argv);
    return;
  }

  const options: InstallOptions = {
    source,
    skills,
    ...(argv.force !== undefined ? { force: argv.force } : {}),
    ...(argv.override !== undefined ? { override: argv.override } : {}),
    ...(argv.path !== undefined ? { path: argv.path } : {}),
    ...(argv.mode !== undefined ? { mode: argv.mode } : {}),
    ...(argv.branch !== undefined ? { branch: argv.branch } : {}),
    ...(argv.interactive !== undefined ? { interactive: argv.interactive } : {}),
    ...(argv.all !== undefined ? { all: argv.all } : {}),
    ...(argv.disabled !== undefined ? { disabled: argv.disabled } : {}),
    ...(argv.include !== undefined ? { include: argv.include as string[] } : {}),
    ...(argv.exclude !== undefined ? { exclude: argv.exclude as string[] } : {}),
    ...(argv.outDir !== undefined ? { outDir: argv.outDir as string[] } : {}),
    ...(argv.outScope !== undefined ? { outScope: argv.outScope as string[] } : {}),
    ...(argv.userDir !== undefined ? { userDir: argv.userDir } : {}),
    ...(argv.dryRun !== undefined ? { dryRun: argv.dryRun } : {}),
    ...(argv.timeout !== undefined ? { timeout: argv.timeout } : {}),
    ...(argv.yes !== undefined ? { yes: argv.yes } : {}),
  };

  try {
    const result = await installSkills(options, createConsoleInstallOutput());

    if (isInstallPreview(result)) {
      if (argv.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printDryRunPreview(result);
      }
      return;
    }

    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printInstallSummary(result);
    }

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof InstallCancelledError) {
      console.log(warn("Installation cancelled."));
      return;
    }
    if (err instanceof MultiSkillSelectionError) {
      const advisory = warn(`Input needed: ${err.message}`);
      console.log(advisory);
      console.log(err.listing.trimEnd());
      console.log(`\n${advisory}`);
      process.exitCode = 1;
      return;
    }
    console.error(error(`Install failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}

function isInstallPreview(result: InstallResult): result is InstallPreview {
  return (result as InstallPreview).dryRun === true;
}

function printDryRunPreview(preview: InstallPreview): void {
  console.log(info("Dry-run mode: showing what would be installed\n"));
  console.log(heading("Skills to install:"));
  for (const entry of preview.skills) {
    console.log(`  - ${tone.primary(entry.name)}`);
    if (entry.description) {
      console.log(`    ${dim(entry.description.slice(0, 80))}`);
    }
  }
  console.log();
  console.log(heading("Destinations:"));
  for (const dest of preview.destinations) {
    console.log(`  - ${dest.path}${dest.exists ? "" : dim(" (will create)")}`);
  }
  console.log();
  console.log(
    dim(
      `Total: ${preview.skills.length} skill(s) × ${preview.destinations.length} destination(s) = ${preview.totalInstalls} installation(s)`
    )
  );
}

function printInstallSummary(summary: InstallSummary): void {
  const { results, installed, skipped, overwritten, failed } = summary;

  const bySkill = new Map<string, InstallSummary["results"]>();
  for (const r of results) {
    const existing = bySkill.get(r.skill) ?? [];
    existing.push(r);
    bySkill.set(r.skill, existing);
  }

  for (const [skill, entries] of bySkill) {
    const statuses = entries.map((e) => {
      const destName = e.destination.split("/").slice(-2).join("/");
      switch (e.status) {
        case "installed":
          return tone.success(`✓ ${destName}`);
        case "overwritten":
          return tone.warning(`↻ ${destName}`);
        case "skipped":
          return dim(`○ ${destName}`);
        case "failed":
          return tone.danger(`✗ ${destName}`);
      }
    });
    console.log(`${tone.bold(skill)}: ${statuses.join(", ")}`);
  }

  console.log();
  const parts: string[] = [];
  if (installed > 0) parts.push(tone.success(`${installed} installed`));
  if (overwritten > 0) parts.push(tone.warning(`${overwritten} overwritten`));
  if (skipped > 0) parts.push(dim(`${skipped} skipped`));
  if (failed > 0) parts.push(tone.danger(`${failed} failed`));

  if (parts.length === 0) {
    console.log(warn("No skills were processed."));
  } else {
    console.log(`Summary: ${parts.join(", ")}`);
  }

  if (skipped > 0 && failed === 0 && installed === 0 && overwritten === 0) {
    console.log(dim("Use --force to overwrite existing skills."));
  }
}
