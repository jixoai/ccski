import { statSync } from "node:fs";
import { join } from "node:path";
import { SkillRegistry } from "../core/registry.js";
import { applyFilters } from "../utils/filters.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { resolveSkill } from "../utils/resolution.js";
import { resolveFilters } from "./filters.js";
import type { InfoOptions, SkillInfoResult } from "./types.js";

export async function getSkillInfo(options: InfoOptions): Promise<SkillInfoResult> {
  const { includes, excludes, state, includeDisabled } = resolveFilters(options);
  const registry = new SkillRegistry(buildRegistryOptions(options, { includeDisabled }));
  const filtered = applyFilters(registry.getAll(), includes, excludes, state);
  const resolved = resolveSkill(filtered, options.name);
  const skill = registry.load(`${resolved.provider}:${resolved.name}`);
  const skillFile = join(skill.path, "SKILL.md");
  const stats = statSync(skillFile);
  const content = options.full ? skill.content : skill.content.split("\n").slice(0, 20).join("\n");

  return {
    name: skill.name,
    description: skill.description,
    provider: skill.provider,
    location: skill.location,
    path: skillFile,
    size: stats.size,
    disabled: skill.disabled ?? false,
    hasReferences: skill.hasReferences,
    hasScripts: skill.hasScripts,
    hasAssets: skill.hasAssets,
    pluginInfo: skill.pluginInfo ?? null,
    content,
  };
}
