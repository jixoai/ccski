# Plugin Support Specification

## ADDED Requirements

### Requirement: Plugin Registry Parsing

The system SHALL parse Claude Code's installed_plugins.json file to discover plugin-based skills.

#### Scenario: Parse installed_plugins.json

- **WHEN** the system initializes
- **THEN** it SHALL read `~/.claude/plugins/installed_plugins.json`
- **AND** parse the JSON structure
- **AND** extract plugin metadata (name, marketplace, installPath)

#### Scenario: Handle missing plugins file gracefully

- **WHEN** `installed_plugins.json` does not exist
- **THEN** the system SHALL continue without error
- **AND** log an info message: "No plugin marketplace skills found"

#### Scenario: Handle malformed plugins file

- **WHEN** `installed_plugins.json` contains invalid JSON
- **THEN** the system SHALL log a warning
- **AND** continue without plugin skills
- **AND** NOT crash the application

### Requirement: Plugin Skill Discovery

The system SHALL recursively search plugin installation directories for SKILL.md files.

#### Scenario: Discover skills in plugin directory

- **WHEN** a plugin has installPath `/path/to/plugin/`
- **THEN** the system SHALL recursively search for `**/SKILL.md` files
- **AND** parse each SKILL.md found
- **AND** register skills with plugin namespace

#### Scenario: Handle multiple skills in one plugin

- **WHEN** a plugin directory contains multiple SKILL.md files (e.g., `skills/pdf/SKILL.md`, `skills/xlsx/SKILL.md`)
- **THEN** the system SHALL register each skill separately
- **AND** use the same plugin namespace for all skills from that plugin

### Requirement: Namespaced Skill Names

The system SHALL support namespaced skill names to avoid conflicts between plugins and user skills.

#### Scenario: Register plugin skill with full name

- **WHEN** a skill named "pdf" is found in plugin "example-skills@anthropic-agent-skills"
- **THEN** the system SHALL register it as "example-skills:pdf"
- **AND** store the plugin name in metadata

#### Scenario: Support short names when unambiguous

- **WHEN** a user requests skill "pdf"
- **AND** only one skill named "pdf" exists (e.g., "example-skills:pdf")
- **THEN** the system SHALL resolve to "example-skills:pdf"
- **AND** load that skill

#### Scenario: Reject short names when ambiguous

- **WHEN** a user requests skill "pdf"
- **AND** multiple skills exist with name "pdf" (e.g., "example-skills:pdf", "custom-plugin:pdf")
- **THEN** the system SHALL return an error
- **AND** list all matching full names
- **AND** suggest using the full namespaced name

### Requirement: Plugin Skill Metadata

The system SHALL include plugin-specific metadata for plugin-based skills.

#### Scenario: Include plugin metadata in skill info

- **WHEN** a plugin skill is registered
- **THEN** its metadata SHALL include:
  - `location: "plugin"`
  - `pluginName: "example-skills"`
  - `marketplace: "anthropic-agent-skills"`
  - `pluginVersion: "unknown"` (or actual version if available)

### Requirement: Plugin Priority

The system SHALL treat plugin skills as lowest priority to allow user skills to override them.

#### Scenario: User skill overrides plugin skill

- **WHEN** a user skill named "pdf" exists in `~/.claude/skills/pdf/`
- **AND** a plugin skill named "pdf" exists in a plugin
- **THEN** the user skill SHALL take precedence
- **AND** the plugin skill SHALL be hidden (not listed)

#### Scenario: Plugin skills shown when no override

- **WHEN** no user skill with the same name exists
- **THEN** plugin skills SHALL be included in listings
- **AND** accessible via both short name and full name

### Requirement: Plugin Installation Path Resolution

The system SHALL correctly resolve relative and absolute plugin installation paths.

#### Scenario: Resolve absolute paths

- **WHEN** a plugin has `installPath: "/Users/alice/.claude/plugins/marketplaces/foo/"`
- **THEN** the system SHALL use that path directly

#### Scenario: Resolve paths relative to plugins directory

- **WHEN** a plugin has `installPath: "marketplaces/foo/"`
- **THEN** the system SHALL resolve it relative to `~/.claude/plugins/`
- **AND** use the absolute path for skill discovery

### Requirement: Plugin Skill Filtering

The system SHALL provide options to exclude plugin skills when desired.

#### Scenario: Skip plugin skills via CLI flag

- **WHEN** the user runs `ccski list --no-plugins`
- **THEN** the system SHALL NOT scan plugin directories
- **AND** NOT include plugin skills in the output

#### Scenario: Skip plugin skills in MCP server

- **WHEN** the user runs `ccski mcp --no-plugins`
- **THEN** the system SHALL NOT load plugin skills
- **AND** only provide user and project skills
