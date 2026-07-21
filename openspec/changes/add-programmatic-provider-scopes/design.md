## Context

`DiscoveryOptions` already accepts `customDirs` and `customProvider`, but
programmatic API calls only expose `RegistryInput`, which converts `skillDir` into
generic `file` roots.

## Decision

Expose the existing core option pair unchanged on `RegistryInput`. When explicit
custom roots are supplied, they take precedence over `skillDir`; callers have made
the provider identity explicit, so the legacy shorthand must not override it.

## Non-Goals

- No Agent catalog belongs in ccski.
- No CLI flag or default-root behavior changes.

## Risk

An embedder can tag a custom root with any provider string. This is intentional:
ccski's provider type is open and discovery already supports dynamic providers.
