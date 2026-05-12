import {
  parseFilters,
  type ExcludeToken,
  type IncludeToken,
  type ParseFilterOptions,
  type StateFilter,
} from "../utils/filters.js";

export interface FilterOptions {
  include?: string[];
  exclude?: string[];
  all?: boolean;
  disabled?: boolean;
}

export interface ResolvedFilters {
  includes: IncludeToken[];
  excludes: ExcludeToken[];
  state: StateFilter;
  includeDisabled: boolean;
}

export function resolveFilters(
  options: FilterOptions,
  parseOptions: ParseFilterOptions = {}
): ResolvedFilters {
  const includeArgs = options.include as string[] | undefined;
  const includeFallback = !includeArgs?.length && options.all ? ["all"] : includeArgs;
  const { includes, excludes } = parseFilters(
    includeFallback,
    options.exclude as string[] | undefined,
    parseOptions
  );
  const state: StateFilter = options.disabled ? "disabled" : options.all ? "all" : "enabled";
  const includeDisabled = state === "all" || state === "disabled";
  return { includes, excludes, state, includeDisabled };
}
