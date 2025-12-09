import type { ArgumentsCamelCase } from "yargs";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import type { SkillLocation } from "../../types/skill.js";
import { colors, dim, duplicateBadge, renderList, setColorEnabled, tone } from "../../utils/format.js";
import { buildRegistryOptions } from "../registry-options.js";
import { applyFilters, computeDuplicateGroups, parseFilters, type StateFilter } from "../../utils/filters.js";
import { formatSkillLabel } from "../../utils/skill-id.js";

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
  all?: boolean;
  disabled?: boolean;
  include?: string[];
  exclude?: string[];
}

export async function listCommand(argv: ArgumentsCamelCase<ListArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const includeDisabled = Boolean(argv.all || argv.disabled);
  const registry = new SkillRegistry(buildRegistryOptions(argv, { includeDisabled }));

  let skills = registry.getAll();
  const state: StateFilter = argv.disabled ? "disabled" : argv.all ? "all" : "enabled";
  const includeArgs = argv.include as string[] | undefined;
  const includeFallback = !includeArgs?.length && argv.all ? ["all"] : includeArgs;
  const { includes, excludes } = parseFilters(includeFallback, argv.exclude as string[] | undefined);
  skills = applyFilters(skills, includes, excludes, state).sort((a, b) => a.name.localeCompare(b.name));

  const format = argv.json ? "json" : (argv.format ?? "plain");

  if (format === "json") {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  const sections: string[] = [];
  const providers = ["claude", "codex", "file"] as const;
  const locations: SkillLocation[] = ["project", "user", "plugin"];

  // Compute duplicate groups for --all mode
  const duplicateGroups = computeDuplicateGroups(skills);

  for (const provider of providers) {
    const providerSkills = skills.filter((s) => s.provider === provider);
    if (!providerSkills.length) continue;
    sections.push(colors.underline(colors.bold(`${provider} (${providerSkills.length})`)));

    for (const location of locations) {
      const list = providerSkills.filter((s) => s.location === location);
      if (!list.length) continue;
      sections.push(`${colors.bold(` ${location}`)} (${list.length})`);
      const listItems = list.map((skill) => {
        const coloredId = formatSkillLabel(skill, { includeProvider: true });
        const dupInfo = duplicateGroups.get(skill.path);
        const badges: string[] = [];

        // Add duplicate badge if applicable
        if (dupInfo) {
          badges.push(duplicateBadge(dupInfo.groupIndex, dupInfo.isPrimary));
        }

        const base = {
          title: coloredId,
          color: (text: string) => text,
          meta: dim(location),
          ...(skill.description ? { description: skill.description } : {}),
        };

        if (skill.disabled) {
          badges.push(tone.danger("[disabled]"));
          const disabledId = formatSkillLabel(skill, {
            includeProvider: true,
            providerColor: colors.red,
          });
          return {
            ...base,
            title: disabledId,
            color: (text: string) => text,
            badge: badges.join(" "),
          };
        }

        return {
          ...base,
          badge: badges.length ? badges.join(" ") : undefined,
        };
      });
      sections.push(renderList(listItems));
    }
  }

  if (sections.length === 0) {
    console.log(argv.disabled ? "No disabled skills found." : "No skills found.");
    return;
  }

  const heading = argv.disabled
    ? "Disabled skills"
    : argv.all
      ? "All skills"
      : "Skills";

  console.log(`${colors.bold(heading)} (${skills.length})\n` + sections.join("\n\n"));
}
