# Tasks

## 1. Discovery & metadata
- [ ] Add `provider` type and tag discovered skills (claude, codex); extend discovery to scan `.codex/skills` roots (project + user) with diagnostics.
- [ ] Update registry diagnostics to surface provider/location counts.

## 2. Filter parsing & application
- [ ] Implement include/exclude parser (multi-flag, comma-separated, source:name syntax, group tokens `@plugins`/`@plugins:<plugin>`; default include=auto; bare names → auto).
- [ ] Implement filter application order: state (`--disabled/--all`) → include (auto dedup inside when `auto` present) → path dedup → exclude (final removal); tie-break mtime then location.
- [ ] Unit tests for parser and filter application covering interaction with state flags and group tokens.

- [ ] Add shared filter options to CLI commands (list, info, search, validate, mcp, install, enable, disable).
- [ ] Apply filters to registry results; ensure provider-prefixed names resolve; ambiguity errors suggest prefixes.
- [ ] Enhance outputs: provider badge, disabled badge, grouped by provider then location with per-group totals; JSON includes `provider` and `disabled`.
- [ ] Add `--out-dir` (multi) and `--out-scope` (claude/claude:@user/claude:@project/codex/codex:@user) to install; combine by appending scope-derived paths to out-dir; resolve defaults (auto), invalid combinations (codex:@project), and conflict messaging with provider context.
- [ ] Scope include/exclude for install to source skill selection (no auto dedup), and update interactive picker to show provider badges, destination checklist (with missing-path warnings and creation), and command preview.
- [ ] Add Codex compatibility flag to validate (length, single-line, symlink warning); surface rule names in errors.
- [ ] Rescope options: only color/help/version stay global; move discovery/registry/install/validate options to per-command with provider-neutral wording; rename plugin-related flags to provider-explicit forms (e.g., `--claude-plugins-file/root`) and document help output grouping.

## 4. MCP integration
- [ ] Ensure MCP tool description and load path honor filters; refresh re-applies include/exclude; ambiguity errors mention provider prefixes.

## 5. Docs & tests
- [ ] Update README usage examples for include/exclude interplay with `--disabled/--all`, install targets, and Codex validate.
- [ ] Integration tests for list/search/info/validate/toggle/install with filters, provider prefixes, and state flags; MCP description reflects filtered set.

## 6. Validation
- [ ] Run `openspec validate add-codex-skills-support --strict` and fix any issues.
