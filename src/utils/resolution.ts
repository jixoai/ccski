import { AmbiguousSkillNameError, SkillNotFoundError } from "../types/errors.js";
import type { SkillMetadata, SkillProvider } from "../types/skill.js";
import { parseProviderQualifiedName, providerNamesFromSkills } from "./providers.js";
import { rankStrings } from "./search.js";
import { formatSkillId, skillAliases } from "./skill-id.js";

function matchesName(skill: SkillMetadata, target: string): boolean {
  const lowerTarget = target.toLowerCase();
  return skillAliases(skill).includes(lowerTarget);
}

function suggestions(
  skills: SkillMetadata[],
  query: string,
  provider?: SkillProvider,
  limit = 3
): string[] {
  const pool = skills
    .filter((s) => (provider ? s.provider === provider : true))
    .map((s) => formatSkillId(s));
  const ranked = rankStrings(pool, query);
  return ranked.slice(0, limit).map((idx) => pool[idx]!);
}

export function resolveSkill(skills: SkillMetadata[], name: string): SkillMetadata {
  const { provider, target } = parseProviderQualifiedName(name, providerNamesFromSkills(skills));
  const matches = skills.filter(
    (skill) => matchesName(skill, target) && (!provider || skill.provider === provider)
  );

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const prefs = matches.map((m) => formatSkillId(m));
    throw new AmbiguousSkillNameError(
      name,
      matches.map((m) => m.name),
      prefs
    );
  }

  throw new SkillNotFoundError(name, suggestions(skills, name, provider));
}

export function resolveSelectors(skills: SkillMetadata[], selectors: string[]): SkillMetadata[] {
  const selected: SkillMetadata[] = [];

  for (const raw of selectors) {
    const skill = resolveSkill(skills, raw);
    if (!selected.some((s) => s.path === skill.path)) {
      selected.push(skill);
    }
  }

  return selected;
}
