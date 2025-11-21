import UFuzzy from "@leeoniya/ufuzzy";

export type UFuzzyOptions = ConstructorParameters<typeof UFuzzy>[0];

export function rankStrings(haystack: string[], needle: string, options?: UFuzzyOptions): number[] {
  if (!needle.trim()) return [];

  const u = new UFuzzy(options);
  const result = u.search(haystack, needle);
  if (!result || result[0] === null || result[2] === null) {
    return [];
  }

  const [idxs, , order] = result;
  return order.map((orderIndex) => idxs[orderIndex]!);
}

export function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
