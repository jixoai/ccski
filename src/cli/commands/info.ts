import { statSync } from "node:fs";
import { join } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { getSkillInfo } from "../../api/info.js";
import type { InfoOptions } from "../../api/types.js";
import { SkillRegistry } from "../../core/registry.js";
import { AmbiguousSkillNameError, SkillNotFoundError } from "../../types/errors.js";
import { applyFilters, parseFilters, type StateFilter } from "../../utils/filters.js";
import { dim, formatBytes, setColorEnabled, success } from "../../utils/format.js";
import { providerNamesFromSkills } from "../../utils/providers.js";
import { resolveSkill } from "../../utils/resolution.js";
import { formatSkillLabel } from "../../utils/skill-id.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface InfoArgs extends InfoOptions {
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
}

export async function infoCommand(argv: ArgumentsCamelCase<InfoArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }
  if (argv.color) {
    setColorEnabled(true);
  }

  const includeDisabled = Boolean(argv.all || argv.disabled);
  const registry = new SkillRegistry(buildRegistryOptions(argv, { includeDisabled }));

  try {
    const includeArgs = argv.include as string[] | undefined;
    const includeFallback = !includeArgs?.length && argv.all ? ["all"] : includeArgs;
    const { includes, excludes } = parseFilters(
      includeFallback,
      argv.exclude as string[] | undefined,
      { providers: providerNamesFromSkills(registry.getAll()) }
    );
    const state: StateFilter = argv.disabled ? "disabled" : argv.all ? "all" : "enabled";
    const filtered = applyFilters(registry.getAll(), includes, excludes, state);
    const resolved = resolveSkill(filtered, argv.name);
    const skill = registry.load(`${resolved.provider}:${resolved.name}`);
    const skillFile = join(skill.path, "SKILL.md");
    const stats = statSync(skillFile);

    if (argv.json) {
      const payload = await getSkillInfo(argv);
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(`\n${formatSkillLabel(skill, { includeProvider: true })}`);
    console.log(skill.description);
    console.log(dim(`Location: ${skill.location}`));
    console.log(dim(`Provider: ${skill.provider}`));
    console.log(dim(`Path: ${skillFile}`));
    console.log(dim(`Size: ${formatBytes(stats.size)}`));
    console.log(dim(`Has references: ${skill.hasReferences}`));
    console.log(dim(`Has scripts: ${skill.hasScripts}`));
    console.log(dim(`Has assets: ${skill.hasAssets}`));

    if (skill.pluginInfo) {
      const info = skill.pluginInfo;
      console.log(dim(`Plugin: ${info.pluginName}@${info.marketplace} (v${info.version})`));
    }

    console.log();
    if (argv.full) {
      console.log(skill.content);
    } else {
      const preview = skill.content.split("\n").slice(0, 20).join("\n");
      console.log(preview);
      const remaining = skill.content.split("\n").length - 20;
      if (remaining > 0) {
        console.log(dim(`\n… (${remaining} more lines, use --full to show all)`));
      }
    }
    console.log();
  } catch (error) {
    if (error instanceof SkillNotFoundError) {
      console.error(`Error: ${error.message}`);
      if (error.suggestions.length > 0) {
        console.error(success(`Did you mean: ${error.suggestions.join(", ")}`));
      }
      process.exitCode = 1;
      return;
    }
    if (error instanceof AmbiguousSkillNameError) {
      console.error(`Error: ${error.message}`);
      if (error.suggestions.length > 0) {
        console.error(success(`Try specifying: ${error.suggestions.join(", ")}`));
      }
      process.exitCode = 1;
      return;
    }
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exitCode = 1;
  }
}
