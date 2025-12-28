import { SkillRegistry } from "../core/registry.js";
import { applyFilters } from "../utils/filters.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { containsCaseInsensitive, rankStrings } from "../utils/search.js";
import { resolveSkill } from "../utils/resolution.js";
import { resolveFilters } from "./filters.js";
import type { SearchOptions, SearchResultItem } from "./types.js";
import type { SkillMetadata } from "../types/skill.js";

interface SearchContext {
  registry: SkillRegistry;
  matches: SkillMetadata[];
}

function buildSearchContext(options: SearchOptions): SearchContext {
  const { includes, excludes, state, includeDisabled } = resolveFilters(options);
  const registry = new SkillRegistry(buildRegistryOptions(options, { includeDisabled }));
  const skills = applyFilters(registry.getAll(), includes, excludes, state);
  const haystack = skills.map((skill) => `${skill.name} ${skill.description}`);
  const ranked = rankStrings(haystack, options.query);
  const picked = ranked.length > 0 ? ranked.map((i) => skills[i]!) : skills;

  const matches = options.content
    ? picked.filter((skill) => {
        const resolved = resolveSkill(skills, skill.name);
        const content = registry.load(`${resolved.provider}:${resolved.name}`).content;
        return containsCaseInsensitive(content, options.query);
      })
    : picked.filter((skill) =>
        containsCaseInsensitive(`${skill.name} ${skill.description}`, options.query)
      );

  return { registry, matches };
}

export function searchSkillsDetailed(options: SearchOptions): SkillMetadata[] {
  const { matches } = buildSearchContext(options);
  return matches;
}

export async function searchSkills(options: SearchOptions): Promise<SearchResultItem[]> {
  const matches = searchSkillsDetailed(options);

  return matches.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: skill.location,
    provider: skill.provider,
    disabled: skill.disabled ?? false,
    path: skill.path,
  }));
}
