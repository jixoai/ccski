## MODIFIED Requirements

### Requirement: Load installed_plugins manifest

The system SHALL load Claude Code's `installed_plugins.json` as an external compatibility input, normalize supported entry shapes into internal plugin entries, and report unsupported entries through diagnostics instead of printing parser stacks.

#### Scenario: missing manifest

- **WHEN** the installed plugins manifest is absent
- **THEN** plugin discovery returns no plugin skills
- **AND** diagnostics record the missing manifest
- **AND** no core module writes directly to stdout or stderr

#### Scenario: manifest format drift

- **WHEN** plugin entries are arrays or omit fields that ccski can safely default
- **THEN** plugin discovery normalizes the entries and scans their install paths
- **AND** skipped entries are recorded as diagnostics
- **AND** `ccski list` does not print a raw validation stack
