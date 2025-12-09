import { statSync } from "node:fs";
import { join } from "node:path";
import type { SkillLocation, SkillMetadata, SkillProvider } from "../types/skill.js";

export type GroupToken = "plugins";

export interface IncludeToken {
  provider: "auto" | "all" | SkillProvider | "file";
  namePattern?: string; // may include wildcards
  group?: GroupToken;
  pluginNamePattern?: string;
  path?: string;
}

export type ExcludeToken = IncludeToken;

export interface FilterParseResult {
  includes: IncludeToken[];
  excludes: ExcludeToken[];
}

export type StateFilter = "enabled" | "disabled" | "all";

const WILDCARD_REGEX = /[\*\?]/;

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[-/\\^$+?.()|{}]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function parseToken(raw: string): IncludeToken {
  const token = raw.trim();
  if (!token) throw new Error("Empty include/exclude token");

  // file: path alias
  if (token.startsWith("file:")) {
    const path = token.slice("file:".length).trim();
    return { provider: "file", path };
  }

  // plugin-qualified skill: @plugin:skill or provider@plugin:skill (requires a skill segment after plugin)
  const atIndex = token.indexOf("@");
  const hasPluginSkill = atIndex >= 0 && token.slice(atIndex + 1).includes(":");
  if (hasPluginSkill && !token.includes("@plugins")) {
    const [prefix, rest] = token.split("@", 2);
    const pluginAndSkill = rest ?? "";
    const [pluginNameRaw, ...skillParts] = pluginAndSkill.split(":").filter(Boolean);
    const skillName = skillParts.length ? skillParts.join(":") : undefined;
    const providerScope = prefix || "claude";

    if (providerScope !== "claude") {
      throw new Error("Only claude provider supports plugin-qualified skill ids");
    }
    if (!pluginNameRaw) {
      throw new Error("Plugin name is required when using @plugin:skill syntax");
    }

    const obj: IncludeToken = {
      provider: "claude",
      group: "plugins",
      pluginNamePattern: pluginNameRaw,
    };
    if (skillName) obj.namePattern = skillName;
    return obj;
  }

  // group-only defaults to claude
  if (token.startsWith("@")) {
    const parts = token.split(":").filter(Boolean);
    const group = parts.shift();
    const pluginName = parts.shift();
    if (group !== "@plugins") {
      throw new Error(`Unsupported group token '${group}'`);
    }
    const obj: IncludeToken = {
      provider: "claude",
      group: "plugins",
    };
    if (pluginName) obj.pluginNamePattern = pluginName;
    return obj;
  }

  const [head, ...rest] = token.split(":");

  // provider specified
  if (["claude", "codex", "all", "auto", "file"].includes(head)) {
    if (rest.length === 0) {
      return { provider: head as IncludeToken["provider"] };
    }

    // group token
    if (rest[0]?.startsWith("@")) {
      const groupToken = rest[0];
      if (groupToken !== "@plugins") {
        throw new Error(`Unsupported group token '${groupToken}'`);
      }
      if (head === "codex") {
        throw new Error("codex provider does not support @plugins");
      }
      const pluginName = rest[1];
      const skillName = rest.slice(2).join(":") || undefined;
      const obj: IncludeToken = {
        provider: "claude",
        group: "plugins",
      };
      if (pluginName) obj.pluginNamePattern = pluginName;
      if (skillName) obj.namePattern = skillName;
      return obj;
    }

    const namePattern = rest.join(":");
    return { provider: head as IncludeToken["provider"], namePattern };
  }

  // bare name defaults to auto provider
  return { provider: "auto", namePattern: token };
}

export function parseFilters(
  includeArgs: string[] | undefined,
  excludeArgs: string[] | undefined
): FilterParseResult {
  const includes: IncludeToken[] = [];
  const excludes: ExcludeToken[] = [];

  const includeList = includeArgs && includeArgs.length ? includeArgs : ["auto"];
  for (const raw of includeList.flatMap((s) => s.split(","))) {
    includes.push(parseToken(raw));
  }

  for (const raw of (excludeArgs ?? []).flatMap((s) => s.split(","))) {
    excludes.push(parseToken(raw));
  }

  return { includes, excludes };
}

function matchesPattern(value: string, pattern?: string): boolean {
  if (!pattern) return true;
  if (!WILDCARD_REGEX.test(pattern)) return value.toLowerCase() === pattern.toLowerCase();
  return globToRegex(pattern).test(value);
}

/**
 * Extract the base skill name (the last segment after all colons).
 * e.g., "example-skills:webapp-testing" -> "webapp-testing"
 *       "webapp-testing" -> "webapp-testing"
 */
function getBaseSkillName(name: string): string {
  return name.split(":").pop() ?? name;
}

function selectByToken(skills: SkillMetadata[], token: IncludeToken, includeDisabled: boolean): SkillMetadata[] {
  if (token.provider === "auto") {
    // auto: dedup by base skill name across all providers/locations
    const map = new Map<string, SkillMetadata>();
    for (const skill of skills) {
      if (!includeDisabled && skill.disabled) continue;
      const baseName = getBaseSkillName(skill.name);
      const existing = map.get(baseName);
      if (!existing) {
        map.set(baseName, skill);
        continue;
      }
      // pick newer by mtime then location priority
      const next = chooseByFreshness(existing, skill);
      map.set(baseName, next);
    }
    return Array.from(map.values());
  }

  const providerFilter = token.provider === "all" ? undefined : token.provider;
  return skills.filter((skill) => {
    if (!includeDisabled && skill.disabled) return false;
    if (providerFilter && skill.provider !== providerFilter) return false;

    if (token.group === "plugins") {
      if (skill.location !== "plugin") return false;
      if (token.pluginNamePattern && !matchesPattern(skill.pluginInfo?.pluginName ?? "", token.pluginNamePattern)) {
        return false;
      }
    }

    if (token.path) {
      return skill.path === token.path;
    }

    if (token.namePattern) {
      const shortName = skill.name.split(":").pop() ?? skill.name;
      return matchesPattern(skill.name, token.namePattern) || matchesPattern(shortName, token.namePattern);
    }
    return true;
  });
}

function chooseByFreshness(a: SkillMetadata, b: SkillMetadata): SkillMetadata {
  // Prefer non-plugin copies when names collide
  if (a.location === "plugin" && b.location !== "plugin") return b;
  if (b.location === "plugin" && a.location !== "plugin") return a;

  const mtimeA = safeMTime(a.path);
  const mtimeB = safeMTime(b.path);
  if (mtimeA !== mtimeB) {
    return mtimeB > mtimeA ? b : a;
  }
  const priority: SkillLocation[] = ["project", "user", "plugin"];
  const score = (s: SkillMetadata) => priority.indexOf(s.location);
  return score(a) <= score(b) ? a : b;
}

function safeMTime(dirPath: string): number {
  try {
    const skillFile = statSync(join(dirPath, "SKILL.md"));
    return skillFile.mtimeMs;
  } catch {
    try {
      const disabledFile = statSync(join(dirPath, ".SKILL.md"));
      return disabledFile.mtimeMs;
    } catch {
      try {
        return statSync(dirPath).mtimeMs;
      } catch {
        return 0;
      }
    }
  }
}

export function applyFilters(
  allSkills: SkillMetadata[],
  includes: IncludeToken[],
  excludes: ExcludeToken[],
  state: StateFilter
): SkillMetadata[] {
  const includeDisabled = state === "all" || state === "disabled";

  // state filter (enabled/disabled)
  const stateFiltered = allSkills.filter((s) => {
    if (state === "all") return true;
    if (state === "disabled") return s.disabled === true;
    return !s.disabled;
  });

  // ordered includes
  const included: SkillMetadata[] = [];
  for (const token of includes) {
    included.push(...selectByToken(stateFiltered, token, includeDisabled));
  }

  // path dedup
  const byPath = new Map<string, SkillMetadata>();
  for (const skill of included) {
    if (!byPath.has(skill.path)) byPath.set(skill.path, skill);
  }

  // excludes final
  const excluded = new Set<string>();
  for (const token of excludes) {
    for (const skill of selectByToken(Array.from(byPath.values()), token, true)) {
      excluded.add(skill.path);
    }
  }

  return Array.from(byPath.values()).filter((s) => !excluded.has(s.path));
}

export interface DuplicateGroup {
  baseName: string;
  groupIndex: number;
  primary: SkillMetadata;
  duplicates: SkillMetadata[];
}

/**
 * Compute duplicate groups for skills that share the same base name.
 * Returns a map from skill path to its duplicate group info.
 */
export function computeDuplicateGroups(skills: SkillMetadata[]): Map<string, { groupIndex: number; isPrimary: boolean }> {
  const byBaseName = new Map<string, SkillMetadata[]>();

  for (const skill of skills) {
    const baseName = getBaseSkillName(skill.name);
    const group = byBaseName.get(baseName) ?? [];
    group.push(skill);
    byBaseName.set(baseName, group);
  }

  const result = new Map<string, { groupIndex: number; isPrimary: boolean }>();
  let groupIndex = 1;

  for (const [, group] of byBaseName) {
    if (group.length <= 1) continue;

    // Sort to find primary: prefer non-plugin, then newer mtime, then location priority
    const sorted = [...group].sort((a, b) => {
      const freshness = chooseByFreshness(a, b);
      return freshness === a ? -1 : 1;
    });

    const primary = sorted[0]!;
    result.set(primary.path, { groupIndex, isPrimary: true });

    for (let i = 1; i < sorted.length; i++) {
      result.set(sorted[i]!.path, { groupIndex, isPrimary: false });
    }

    groupIndex++;
  }

  return result;
}

export { getBaseSkillName };
