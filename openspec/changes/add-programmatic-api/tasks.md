# Tasks

## 1. Spec & API surface definition
- [x] Define `programmatic-api` requirements and scenarios for each CLI-equivalent function.
- [x] Decide error handling contract (throw vs return error objects) and document it.

## 2. API implementation
- [x] Introduce `src/api` module with typed functions mirroring CLI commands.
- [x] Ensure functions return structures equivalent to CLI `--json` outputs.
- [x] Export API types + functions from `src/index.ts`.

## 3. CLI reuse
- [x] Refactor CLI commands to delegate JSON logic (and core logic when practical) to API functions.
- [x] Keep human-readable output identical to current behavior.

## 4. Tests & validation
- [x] Add unit tests for API outputs (list/info/search/validate/install/toggle).
- [x] Update existing CLI tests (if any) to ensure JSON paths still match.
- [x] Run `openspec validate add-programmatic-api --strict`.
