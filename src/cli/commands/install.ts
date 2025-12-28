import type { ArgumentsCamelCase } from "yargs";
import { dim, error, heading, info, renderList, setColorEnabled, tone, warn } from "../../utils/format.js";
import {
  createConsoleInstallOutput,
  installSkills,
  InstallCancelledError,
  MultiSkillSelectionError,
  registerInstallCleanupHandlers,
} from "../../api/install.js";
import type { InstallOptions, InstallPreview, InstallResult, InstallSummary } from "../../api/types.js";

export interface InstallArgs extends InstallOptions {
  noColor?: boolean;
  color?: boolean;
  json?: boolean;
}

export async function installCommand(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  registerInstallCleanupHandlers();

  const skills = Array.isArray(argv._) ? argv._.slice(1).map(String) : [];

  const options: InstallOptions = {
    source: argv.source,
    skills,
    force: argv.force,
    override: argv.override,
    path: argv.path,
    mode: argv.mode,
    branch: argv.branch,
    interactive: argv.interactive,
    all: argv.all,
    disabled: argv.disabled,
    include: argv.include as string[] | undefined,
    exclude: argv.exclude as string[] | undefined,
    outDir: argv.outDir as string[] | undefined,
    outScope: argv.outScope as string[] | undefined,
    userDir: argv.userDir,
    dryRun: argv.dryRun,
    timeout: argv.timeout,
    yes: argv.yes,
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
          return tone.error(`✗ ${destName}`);
      }
    });
    console.log(`${tone.bold(skill)}: ${statuses.join(", ")}`);
  }

  console.log();
  const parts: string[] = [];
  if (installed > 0) parts.push(tone.success(`${installed} installed`));
  if (overwritten > 0) parts.push(tone.warning(`${overwritten} overwritten`));
  if (skipped > 0) parts.push(dim(`${skipped} skipped`));
  if (failed > 0) parts.push(tone.error(`${failed} failed`));

  if (parts.length === 0) {
    console.log(warn("No skills were processed."));
  } else {
    console.log(`Summary: ${parts.join(", ")}`);
  }

  if (skipped > 0 && failed === 0 && installed === 0 && overwritten === 0) {
    console.log(dim("Use --force to overwrite existing skills."));
  }
}
