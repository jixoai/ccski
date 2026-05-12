## MODIFIED Requirements

### Requirement: Diagnostic resilience

The system SHALL continue discovery when a scanned root, skill file, or external registry entry cannot be read or parsed, and SHALL expose the problem as structured diagnostics without writing directly to stdout or stderr from core discovery modules.

#### Scenario: unreadable directory

- **WHEN** a configured skill directory cannot be scanned
- **THEN** discovery continues for remaining roots
- **AND** diagnostics include the failed directory and reason
- **AND** core discovery does not call `console.warn`, `console.info`, or `console.error`

#### Scenario: programmatic diagnostics

- **WHEN** a caller reads registry diagnostics
- **THEN** diagnostics include severity, source, code, message, and optional details for structured inspection
