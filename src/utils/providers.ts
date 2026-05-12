import type { SkillMetadata, SkillProvider } from "../types/skill.js";
import { BUILT_IN_SKILL_PROVIDERS } from "../types/skill.js";

const BUILT_IN_PROVIDER_ORDER = new Map<string, number>(
  BUILT_IN_SKILL_PROVIDERS.map((provider, index) => [provider, index])
);

export function normalizeProviderName(provider: string): SkillProvider {
  return provider.trim().toLowerCase() as SkillProvider;
}

export function providerNamesFromSkills(skills: readonly SkillMetadata[]): string[] {
  return Array.from(new Set(skills.map((skill) => normalizeProviderName(skill.provider))));
}

export function buildKnownProviderSet(providers?: Iterable<string>): Set<string> {
  const known = new Set<string>(BUILT_IN_SKILL_PROVIDERS);
  for (const provider of providers ?? []) {
    const normalized = normalizeProviderName(provider);
    if (normalized) known.add(normalized);
  }
  return known;
}

export function isKnownProviderName(provider: string, providers?: Iterable<string>): boolean {
  return buildKnownProviderSet(providers).has(normalizeProviderName(provider));
}

export function parseProviderQualifiedName(
  input: string,
  providers?: Iterable<string>
): { provider?: SkillProvider; target: string } {
  const lower = input.toLowerCase();
  const parts = lower.split(":");
  if (parts.length <= 1) return { target: lower };

  const head = parts[0]!;
  if (!isKnownProviderName(head, providers)) {
    return { target: lower };
  }

  return {
    provider: normalizeProviderName(head),
    target: parts.slice(1).join(":"),
  };
}

export function compareSkillProviders(a: SkillProvider, b: SkillProvider): number {
  const normalizedA = normalizeProviderName(a);
  const normalizedB = normalizeProviderName(b);
  const orderA = BUILT_IN_PROVIDER_ORDER.get(normalizedA);
  const orderB = BUILT_IN_PROVIDER_ORDER.get(normalizedB);

  if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
  if (orderA !== undefined) return -1;
  if (orderB !== undefined) return 1;
  return normalizedA.localeCompare(normalizedB);
}
