import type { ArgumentsCamelCase } from "yargs";
import { renderList, setColorEnabled } from "../../utils/format.js";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface ListArgs extends SkillRegistryOptions {
  format?: "plain" | "json";
  noPlugins?: boolean;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
}

export async function listCommand(argv: ArgumentsCamelCase<ListArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const registry = new SkillRegistry(buildRegistryOptions(argv));

  const skills = registry.getAll().sort((a, b) => a.name.localeCompare(b.name));

  const format = argv.json ? "json" : argv.format ?? "plain";

  if (format === "json") {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }

  console.log(`Skills (${skills.length})\n`);
  console.log(
    renderList(
      skills.map((skill) => ({
        title: skill.name,
        meta: `(${skill.location})`,
        description: skill.description,
      }))
    )
  );
}
