import { SkillRegistry } from "../core/registry.js";
import { applyFilters } from "../utils/filters.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { resolveFilters } from "./filters.js";
import type { ListOptions } from "./types.js";
import type { SkillMetadata } from "../types/skill.js";

export async function listSkills(options: ListOptions = {}): Promise<SkillMetadata[]> {
  const { includes, excludes, state, includeDisabled } = resolveFilters(options);
  const registry = new SkillRegistry(buildRegistryOptions(options, { includeDisabled }));

  const skills = applyFilters(registry.getAll(), includes, excludes, state).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return skills;
}
