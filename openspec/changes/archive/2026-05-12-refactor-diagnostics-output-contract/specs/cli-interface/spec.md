## MODIFIED Requirements

### Requirement: List skills

The CLI SHALL list discovered skills using the shared registry, keep ordinary compatibility diagnostics quiet by default, and keep machine-readable output free of non-JSON diagnostics.

#### Scenario: list disabled only

- **WHEN** the user runs `ccski list --disabled`
- **THEN** only disabled skills are displayed

#### Scenario: plugin compatibility warning

- **WHEN** Claude Code plugin metadata contains entries ccski cannot fully normalize
- **THEN** `ccski list` still displays discovered skills
- **AND** raw parser errors and stack traces are not printed

#### Scenario: JSON output remains parseable

- **WHEN** the user runs `ccski list --json`
- **THEN** stdout contains only valid JSON for the list result
