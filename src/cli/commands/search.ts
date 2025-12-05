import type { ArgumentsCamelCase } from "yargs";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { SkillRegistry } from "../../core/registry.js";
import { colors, highlight, type ListItem, renderList, setColorEnabled, tone } from "../../utils/format.js";
import { containsCaseInsensitive, rankStrings } from "../../utils/search.js";
import { buildRegistryOptions } from "../registry-options.js";
import { applyFilters, parseFilters, type StateFilter } from "../../utils/filters.js";
import { resolveSkill } from "../../utils/resolution.js";
import { formatSkillLabel } from "../../utils/skill-id.js";

export interface SearchArgs extends SkillRegistryOptions {
  query: string;
  content?: boolean;
  noPlugins?: boolean;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  format?: "plain" | "json";
  include?: string[];
  exclude?: string[];
  limit?: number;
  all?: boolean;
  disabled?: boolean;
}

export async function searchCommand(argv: ArgumentsCamelCase<SearchArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }
  if (argv.color) {
    setColorEnabled(true);
  }

  const includeDisabled = Boolean(argv.all || argv.disabled);
  const registry = new SkillRegistry(buildRegistryOptions(argv, { includeDisabled }));
  const includeArgs = argv.include as string[] | undefined;
  const includeFallback = !includeArgs?.length && argv.all ? ["all"] : includeArgs;
  const { includes, excludes } = parseFilters(includeFallback, argv.exclude as string[] | undefined);
  const state: StateFilter = argv.disabled ? "disabled" : argv.all ? "all" : "enabled";
  const skills = applyFilters(registry.getAll(), includes, excludes, state);
  const haystack = skills.map((skill) => `${skill.name} ${skill.description}`);
  const ranked = rankStrings(haystack, argv.query);

  const picked = ranked.length > 0 ? ranked.map((i) => skills[i]!) : skills;

  const filtered = argv.content
    ? picked.filter((skill) => {
        const resolved = resolveSkill(skills, skill.name);
        const content = registry.load(`${resolved.provider}:${resolved.name}`).content;
        return containsCaseInsensitive(content, argv.query);
      })
    : picked.filter((skill) =>
        containsCaseInsensitive(`${skill.name} ${skill.description}`, argv.query)
      );

  const format = argv.json ? "json" : (argv.format ?? "plain");

  if (format === "json") {
    const payload = filtered.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location,
      provider: skill.provider,
      disabled: skill.disabled ?? false,
      path: skill.path,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log("No skills matched your query.");
    return;
  }

  const limit = argv.limit ?? 10;
  const limited = filtered.slice(0, limit);
  console.log(`${colors.underline(colors.bold("Matches"))} (${limited.length}${filtered.length > limit ? ` of ${filtered.length}` : ""})\n`);
  console.log(
    renderList(
      limited.map((skill) => {
        const item: ListItem = {
          title: highlight(formatSkillLabel(skill, { includeProvider: true }), argv.query),
          color: (text: string) => text,
          meta: `(${skill.location})`,
          description: highlight(skill.description, argv.query),
        };
        if (skill.disabled) {
          item.badge = tone.danger("[disabled]");
          item.color = tone.danger;
        }
        return item;
      })
    )
  );

  if (argv.content) {
    console.log();
    for (const skill of filtered.slice(0, 5)) {
      const resolved = resolveSkill(skills, skill.name);
      const content = registry.load(`${resolved.provider}:${resolved.name}`).content;
      const snippet = extractSnippet(content, argv.query, 120);
      if (snippet) {
        console.log(`${skill.name}: ${highlight(snippet, argv.query)}`);
      }
    }
  }
}

function extractSnippet(content: string, query: string, length: number): string | null {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - Math.floor(length / 2));
  const end = Math.min(content.length, start + length);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}
