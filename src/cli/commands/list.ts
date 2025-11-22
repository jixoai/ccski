import type { ArgumentsCamelCase } from "yargs";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import type { SkillLocation } from "../../types/skill.js";
import { colors, dim, renderList, setColorEnabled } from "../../utils/format.js";
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

  const format = argv.json ? "json" : (argv.format ?? "plain");

  if (format === "json") {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  const groups: Record<SkillLocation, typeof skills> = { project: [], user: [], plugin: [] };
  skills.forEach((skill) => {
    groups[skill.location]?.push(skill);
  });

  const labels: Record<SkillLocation, string> = {
    project: "Project skills",
    user: "User skills",
    plugin: "Plugin skills",
  };

  const sections: string[] = [];
  const order: SkillLocation[] = ["project", "user", "plugin"];

  for (const location of order) {
    const list = groups[location];
    if (!list.length) continue;

    sections.push(`${colors.underline(colors.bold(labels[location]))} (${list.length})`);
    sections.push(
      renderList(
        list.map((skill) => ({
          title: skill.name,
          meta:
            location === "plugin" ? (skill.pluginInfo?.pluginName ?? dim(location)) : dim(location),
          description: skill.description,
        }))
      )
    );
  }

  if (sections.length === 0) {
    console.log("No skills found.");
    return;
  }

  console.log(`${colors.bold("Skills")} (${skills.length})\n` + sections.join("\n\n"));
}
