## 1. Specification

- [ ] 1.1 Add skill discovery deltas for shared/agent-specific roots, dynamic providers, and root priority.
- [ ] 1.2 Add CLI deltas for provider filters, display, and auto dedup.
- [ ] 1.3 Add MCP deltas for provider filters and resolution.
- [ ] 1.4 Validate the OpenSpec change.

## 2. Implementation

- [ ] 2.1 Add typed provider/root resolution primitives.
- [ ] 2.2 Update discovery to scan shared, built-in agent-specific, and shallow dynamic agent roots.
- [ ] 2.3 Update filter parsing, resolution, and display to support built-in plus dynamic providers.
- [ ] 2.4 Update auto dedup to use root priority before mtime.

## 3. Verification

- [ ] 3.1 Add tests for root ordering, dynamic providers, and auto dedup priority.
- [ ] 3.2 Run typecheck, tests, build, OpenSpec validation, and CLI JSON sanity checks.
- [ ] 3.3 Archive the change and validate all specs.
