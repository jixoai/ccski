# CLI Interface Specification

## ADDED Requirements

### Requirement: List Command

The system SHALL provide a `list` command to display all available skills in human-readable format.

#### Scenario: List skills in table format (default)

- **WHEN** the user runs `ccski list`
- **THEN** the system SHALL output a table with columns: NAME, DESCRIPTION, LOCATION
- **AND** sort skills alphabetically by name
- **AND** use UTF-8 box-drawing characters for table borders

#### Scenario: List skills in JSON format

- **WHEN** the user runs `ccski list --format=json`
- **THEN** the system SHALL output a JSON array of skill objects
- **AND** each object SHALL contain: name, description, location, path, hasReferences, hasScripts, hasAssets
- **AND** pretty-print the JSON with 2-space indentation

#### Scenario: Group skills by location

- **WHEN** the user runs `ccski list` (table format)
- **THEN** the system SHALL group skills by location (user, project, plugin)
- **AND** display a section header for each group
- **AND** show plugin namespace in the name column

### Requirement: Info Command

The system SHALL provide an `info` command to display detailed information about a specific skill.

#### Scenario: Show skill info with content preview

- **WHEN** the user runs `ccski info user`
- **THEN** the system SHALL display:
  - Skill name
  - Description
  - Location (user/project/plugin)
  - Full file path
  - File size
  - Whether it has references/scripts/assets
  - Content preview (first 20 lines)

#### Scenario: Show full skill content

- **WHEN** the user runs `ccski info user --full`
- **THEN** the system SHALL display the complete SKILL.md content
- **AND** include the YAML frontmatter
- **AND** NOT truncate the output

#### Scenario: Handle skill not found

- **WHEN** the user runs `ccski info nonexistent`
- **THEN** the system SHALL display an error: "Skill 'nonexistent' not found"
- **AND** suggest similar skill names (fuzzy matching)
- **AND** exit with code 1

### Requirement: Search Command

The system SHALL provide a `search` command to find skills by keyword.

#### Scenario: Search in name and description

- **WHEN** the user runs `ccski search pdf`
- **THEN** the system SHALL search for "pdf" in skill names and descriptions
- **AND** display matching skills in table format
- **AND** highlight the matching keyword

#### Scenario: Search in skill content

- **WHEN** the user runs `ccski search api --content`
- **THEN** the system SHALL also search in SKILL.md content
- **AND** display matching skills with context (surrounding lines)
- **AND** highlight the matching keyword

#### Scenario: Case-insensitive search

- **WHEN** the user searches with any case (e.g., `ccski search PDF`)
- **THEN** the system SHALL perform case-insensitive matching
- **AND** find "pdf", "PDF", "Pdf", etc.

### Requirement: Validate Command

The system SHALL provide a `validate` command to check SKILL.md file format.

#### Scenario: Validate a skill directory

- **WHEN** the user runs `ccski validate ~/.claude/skills/my-skill`
- **THEN** the system SHALL check for SKILL.md existence
- **AND** validate YAML frontmatter syntax
- **AND** verify required fields (name, description)
- **AND** check UTF-8 encoding
- **AND** display validation results

#### Scenario: Validate a SKILL.md file directly

- **WHEN** the user runs `ccski validate ./my-skill/SKILL.md`
- **THEN** the system SHALL validate the file
- **AND** provide the same checks as directory validation

#### Scenario: Show validation errors with suggestions

- **WHEN** validation fails
- **THEN** the system SHALL display specific error messages
- **AND** provide suggestions to fix each error
- **AND** exit with code 1

#### Scenario: Show validation success

- **WHEN** validation passes
- **THEN** the system SHALL display "✓ Skill is valid"
- **AND** show a summary of skill metadata
- **AND** exit with code 0

### Requirement: MCP Command

The system SHALL provide an `mcp` command to start the MCP server for AI agents.

#### Scenario: Start MCP server

- **WHEN** the user runs `ccski mcp`
- **THEN** the system SHALL start an MCP server on stdio
- **AND** scan all skill directories
- **AND** log startup information to stderr
- **AND** wait for MCP protocol messages on stdin

#### Scenario: Start MCP server with custom directories

- **WHEN** the user runs `ccski mcp --skill-dir ~/my-skills`
- **THEN** the system SHALL include the custom directory in the scan
- **AND** apply appropriate priority for custom directories

### Requirement: Help and Version

The system SHALL provide help and version information.

#### Scenario: Show version

- **WHEN** the user runs `ccski --version`
- **THEN** the system SHALL display the version number
- **AND** exit with code 0

#### Scenario: Show general help

- **WHEN** the user runs `ccski --help` or `ccski`
- **THEN** the system SHALL display usage information
- **AND** list all available commands
- **AND** show common flags

#### Scenario: Show command-specific help

- **WHEN** the user runs `ccski list --help`
- **THEN** the system SHALL display help for the `list` command
- **AND** show available flags and options

### Requirement: Error Handling and Exit Codes

The system SHALL use appropriate exit codes and provide clear error messages.

#### Scenario: Success exit code

- **WHEN** any command completes successfully
- **THEN** the system SHALL exit with code 0

#### Scenario: Error exit code

- **WHEN** any command fails (validation error, skill not found, etc.)
- **THEN** the system SHALL exit with code 1

#### Scenario: User error messages

- **WHEN** an error occurs
- **THEN** the system SHALL write error messages to stderr
- **AND** use red color for error text (when stdout is a TTY)
- **AND** provide actionable suggestions

#### Scenario: Diagnostic output

- **WHEN** a command runs successfully
- **THEN** the system SHALL write diagnostic info to stderr
- **AND** write main output to stdout
- **AND** allow piping stdout to other commands
