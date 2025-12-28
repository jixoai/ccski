# Change: Add programmatic API surface for CLI features

## Why
- ccski is currently CLI-first; downstream tooling needs a stable, typed API to call the same functionality programmatically.
- The CLI already exposes JSON output for many commands; exposing those structures directly reduces parsing and keeps integrations reliable.
- Refactoring shared logic improves maintainability and keeps CLI/MCP behavior consistent (KISS/DRY).

## What Changes
- Add a programmatic API module exported from `src/index.ts` that mirrors CLI commands and returns structured results equivalent to `--json` outputs.
- Refactor CLI commands to reuse the new API functions for their JSON paths (and core logic where sensible) while keeping human output unchanged.
- Define explicit result types for each API surface (list/info/search/validate/install/toggle/mcp) and document error handling behavior.

## Impact
- Specs affected: new capability `programmatic-api` (plus minor alignment with `cli-interface`).
- Affected code: `src/index.ts`, new `src/api/*`, selected `src/cli/commands/*`, and type exports.
- No code changes yet; this proposal scopes the work and acceptance criteria.
