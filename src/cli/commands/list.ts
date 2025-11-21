import type { ArgumentsCamelCase } from "yargs";
import { renderTable, setColorEnabled } from "../../utils/format.js";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface ListArgs extends SkillRegistryOptions {
  format: "table" | "json";
  noPlugins?: boolean;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
  json?: boolean;
  noColor?: boolean;
}

export async function listCommand(argv: ArgumentsCamelCase<ListArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }

  const registry = new SkillRegistry(buildRegistryOptions(argv));

  const skills = registry.getAll().sort((a, b) => a.name.localeCompare(b.name));

  const format = argv.json ? "json" : argv.format;

  if (format === "json") {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  const groups: Record<string, typeof skills> = {
    project: [],
    user: [],
    plugin: [],
  };

  skills.forEach((skill) => groups[skill.location]?.push(skill));

  for (const [location, entries] of Object.entries(groups)) {
    if (entries.length === 0) continue;
    const header = `${location.toUpperCase()} (${entries.length})`;
    console.log(`\n${header}`);
    const rows = entries.map((skill) => [skill.name, skill.description, skill.location]);
    console.log(renderTable(["NAME", "DESCRIPTION", "LOCATION"], rows));
  }
  console.log();
}
