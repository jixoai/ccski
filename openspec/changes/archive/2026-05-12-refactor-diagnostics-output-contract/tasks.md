## 1. Specification

- [x] 1.1 Document diagnostic purity and tolerant plugin manifest parsing.

## 2. Implementation

- [x] 2.1 Add structured diagnostics types and aggregate them in the registry.
- [x] 2.2 Remove `console.*` side effects from core discovery/plugin modules.
- [x] 2.3 Normalize Claude plugin manifest entries from a permissive external shape.
- [x] 2.4 Fix strict TypeScript errors without weakening compiler options.

## 3. Tests

- [x] 3.1 Add plugin manifest compatibility and output suppression regressions.
- [x] 3.2 Add JSON cleanliness and core console purity regressions.
- [x] 3.3 Run `openspec validate refactor-diagnostics-output-contract --strict`, `pnpm ts`, `pnpm test`, and `pnpm build`.
