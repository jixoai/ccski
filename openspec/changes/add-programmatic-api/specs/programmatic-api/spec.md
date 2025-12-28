# Capability: Programmatic API

## ADDED Requirements

### Requirement: API exports mirror CLI commands
The package SHALL export a programmatic API from `src/index.ts` that mirrors every CLI command: list, info, search, validate, install, enable, disable, and mcp.

#### Scenario: list returns structured data
- **WHEN** a consumer calls the list API with the same options as `ccski list --json`
- **THEN** the returned value is the same structure as the CLI JSON output (an array of skill metadata).

### Requirement: JSON-equivalent return shapes
Each API function MUST return the same shape as the CLI `--json` success output for the corresponding command, without writing to stdout.

#### Scenario: validate returns success payload
- **WHEN** a consumer validates a skill path
- **THEN** the return value contains `file`, `success`, `errors`, and `warnings` fields matching the CLI JSON output.

### Requirement: Warning parity with CLI
When the CLI emits warnings but still succeeds, the API SHALL return those warnings in the corresponding result payload.

#### Scenario: validate returns warnings
- **WHEN** a Codex skill passes validation with symlink warnings
- **THEN** the API result includes those warnings in the `warnings` field while still indicating success.

### Requirement: Typed results
API function return types SHALL be exported for reuse by callers, and the types must align with the CLI JSON structures.

#### Scenario: install returns summary
- **WHEN** a consumer installs a skill source programmatically
- **THEN** the result includes `results`, `installed`, `skipped`, `overwritten`, and `failed` fields matching the CLI JSON output.
