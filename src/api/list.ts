import { SkillRegistry } from "../core/registry.js";
import type { SkillMetadata } from "../types/skill.js";
import { applyFilters } from "../utils/filters.js";
import { providerNamesFromSkills } from "../utils/providers.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { resolveFilters } from "./filters.js";
import type { ListOptions } from "./types.js";

export async function listSkills(options: ListOptions = {}): Promise<SkillMetadata[]> {
  const initialFilters = resolveFilters(options);
  const registry = new SkillRegistry(
    buildRegistryOptions(options, { includeDisabled: initialFilters.includeDisabled })
  );
  const { includes, excludes, state } = resolveFilters(options, {
    providers: providerNamesFromSkills(registry.getAll()),
  });

  const skills = applyFilters(registry.getAll(), includes, excludes, state).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return skills;
}
