# Design

## Context
The repository currently exposes a CLI and MCP server but no programmatic API. The CLI supports `--json` outputs for several commands, and consumers want the same structured data directly from `index.ts`.

## Goals / Non-Goals
- Goals:
  - Provide a stable, typed API that mirrors every CLI command.
  - Return JSON-equivalent structures without writing to stdout.
  - Reuse logic to avoid divergence between CLI and API.
- Non-Goals:
  - Changing existing CLI human-readable output.
  - Introducing new behavior beyond the CLI feature set.

## Decisions
- Introduce `src/api/*` with one function per CLI command.
- Each function returns the same data shape as the CLI `--json` success output.
- Error handling mirrors CLI behavior: if the CLI would error/exit, the API throws; if the CLI would only warn, the API returns warnings in its result payload.

## Risks / Trade-offs
- Partial refactors could leave duplicated logic; mitigate by centralizing JSON paths first.
- Error-shape parity with CLI JSON is incomplete today (some commands emit text on errors); the API will surface errors via exceptions unless we extend CLI JSON error behavior.

## Migration Plan
- Add API module and export types.
- Refactor CLI command JSON paths to use API results.
- Incrementally share more core logic as safe.

## Open Questions
- Should the programmatic API return error objects (matching CLI JSON error cases) instead of throwing?
- Should we expose a single `runCommand` wrapper or keep per-command functions only?
