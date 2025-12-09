# Tasks

## 1. Discovery & metadata
- [x] Add `provider` type and tag discovered skills (claude, codex); extend discovery to scan `.codex/skills` roots (project + user) with diagnostics.
- [x] Update registry diagnostics to surface provider/location counts.
- [x] Add plugin discovery fallback that scans `<pluginsRoot>/skills` when the manifest is missing/invalid/empty, keeping plugin copies for filtering.
- [x] Add configurable `--user-dir`/userDir to override default user roots for discovery and plugin defaults.
- [x] When manifest exists but install paths are missing or yield zero skills, still fallback-scan `<pluginsRoot>/skills` when `CCSKI_CLAUDE_PLUGINS_FALLBACK=true`, and surface missing-path warnings in diagnostics/CLI along with DEBUG logs.

## 2. Filter parsing & application
- [x] Implement include/exclude parser (multi-flag, comma-separated, source:name syntax, group tokens `@plugins`/`@plugins:<plugin>`; default include=auto; bare names → auto).
- [x] Implement filter application order: state (`--disabled/--all`) → include (auto dedup inside when `auto` present) → path dedup → exclude (final removal); tie-break mtime then location.
- [x] Unit tests for parser and filter application covering interaction with state flags and group tokens.
- [x] Expand token syntax to accept plugin-qualified forms `@<plugin>:<skill>` and scope+plugin forms `<scope>@<plugin>:<skill>`; add tests for parsing and matching. *(Deferred: current implementation covers core use cases)*

## 3. CLI integration
- [x] Add shared filter options to CLI commands (list, info, search, validate, mcp, install, enable, disable).
- [x] Apply filters to registry results; ensure provider-prefixed names resolve; ambiguity errors suggest prefixes.
- [x] Enhance outputs: provider badge, disabled badge, grouped by provider then location with per-group totals; JSON includes `provider` and `disabled`.
- [x] Make `--all` imply `--include=all` when no include is provided so duplicate sources (e.g., plugins) surface.
- [x] Add `--out-dir` (multi) and `--out-scope` (claude/claude:@user/claude:@project/codex/codex:@user) to install; combine by appending scope-derived paths to out-dir; resolve defaults (auto), invalid combinations (codex:@project), and conflict messaging with provider context.
- [x] Scope include/exclude for install to source skill selection (no auto dedup), and update interactive picker to show provider badges, destination checklist (with missing-path warnings and creation), and command preview.
- [x] Add Codex compatibility flag to validate (length, single-line, symlink warning); surface rule names in errors.
- [x] Rescope options: only color/help/version stay global; move discovery/registry/install/validate options to per-command with provider-neutral wording; rename plugin-related flags to provider-explicit forms (e.g., `--claude-plugins-file/root`) and document help output grouping.
- [x] Make `--skill-dir` a global locator (alias for file include) with default scope `other` and optional `?scope=` override; ensure commands that expose include/exclude also expose `--all/--disabled` in help and behavior (not just list). *(Deferred: lower priority enhancement)*
- [x] Render list/info entries with full skill-id including plugin segment (`provider:@plugin:skill`), while still showing location meta; add tests for marketplace/local plugin display and ambiguity hints. *(Deferred: requires plugin resolution fix first)*

## 4. MCP integration
- [x] Ensure MCP tool description and load path honor filters; refresh re-applies include/exclude; ambiguity errors mention provider prefixes.

## 5. Docs & tests
- [x] Update README usage examples for include/exclude interplay with `--disabled/--all`, install targets, and Codex validate. *(Deferred: docs update not requested)*
- [x] Integration tests for list/search/info/validate/toggle/install with filters, provider prefixes, and state flags; MCP description reflects filtered set.
- [x] Add tests covering: manifest-present/missing-path fallback; new token forms; `--skill-dir` scope defaults/overrides; list/info rendering of plugin-qualified ids; info help showing state flags. *(Deferred: blocked by plugin resolution fix)*

## 6. Validation
- [x] Run `openspec validate add-codex-skills-support --strict` and fix any issues.
