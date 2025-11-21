import { statSync } from "node:fs";
import { join } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { dim, formatBytes, setColorEnabled, success } from "../../utils/format.js";
import { SkillRegistry } from "../../core/registry.js";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillNotFoundError } from "../../types/errors.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface InfoArgs extends SkillRegistryOptions {
  name: string;
  full?: boolean;
  noPlugins?: boolean;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
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

  const registry = new SkillRegistry(buildRegistryOptions(argv));

  try {
    const skill = registry.load(argv.name);
    const skillFile = join(skill.path, "SKILL.md");
    const stats = statSync(skillFile);

    if (argv.json) {
      console.log(
        JSON.stringify(
          {
            name: skill.name,
            description: skill.description,
            location: skill.location,
            path: skillFile,
            size: stats.size,
            hasReferences: skill.hasReferences,
            hasScripts: skill.hasScripts,
            hasAssets: skill.hasAssets,
            pluginInfo: skill.pluginInfo ?? null,
            content: argv.full ? skill.content : skill.content.split("\n").slice(0, 20).join("\n"),
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`\n${skill.name}`);
    console.log(skill.description);
    console.log(dim(`Location: ${skill.location}`));
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
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exitCode = 1;
  }
}
