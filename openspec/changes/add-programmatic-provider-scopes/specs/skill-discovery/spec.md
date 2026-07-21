## ADDED Requirements

### Requirement: Programmatic provider-scoped custom roots

The programmatic discovery API SHALL accept explicit `customDirs` and
`customProvider` registry inputs. Explicit provider-scoped roots SHALL preserve the
provided provider label and SHALL take precedence over the legacy `skillDir`
shorthand when both are supplied.

#### Scenario: embedded provider root

- **GIVEN** an application calls `listSkills` with one custom root and
  `customProvider="codex"`
- **WHEN** discovery completes
- **THEN** every discovered skill from that root has provider `codex`
- **AND** the root is scanned without default roots when requested
