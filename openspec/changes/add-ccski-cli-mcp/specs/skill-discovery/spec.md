# Skill Discovery Specification

## ADDED Requirements

### Requirement: Multi-Directory Skill Discovery

The system SHALL discover skills from multiple directories in a prioritized order to support both user-level and project-level skills, as well as universal and Claude-specific skills.

#### Scenario: Discover skills from all standard directories

- **WHEN** the system initializes or refreshes
- **THEN** it SHALL scan the following directories in priority order:
  1. `$PWD/.agent/skills/` (project universal, highest priority)
  2. `$PWD/.claude/skills/` (project Claude Code)
  3. `~/.agent/skills/` (global universal)
  4. `~/.claude/skills/` (global Claude Code, lowest priority)

#### Scenario: Handle non-existent directories gracefully

- **WHEN** a skill directory does not exist
- **THEN** the system SHALL skip it without error
- **AND** continue scanning remaining directories

#### Scenario: Handle permission errors gracefully

- **WHEN** a skill directory exists but is not readable
- **THEN** the system SHALL log a warning
- **AND** continue scanning remaining directories
- **AND** include the error in the diagnostic output

### Requirement: Priority-Based Skill Resolution

The system SHALL resolve skill name conflicts using directory priority to ensure project-level skills can override global skills.

#### Scenario: Same skill name in multiple directories

- **WHEN** a skill named "foo" exists in both `$PWD/.claude/skills/foo/` and `~/.claude/skills/foo/`
- **THEN** the system SHALL use the project-level version
- **AND** ignore the global-level version

#### Scenario: Project universal overrides project Claude

- **WHEN** a skill named "bar" exists in both `$PWD/.agent/skills/bar/` and `$PWD/.claude/skills/bar/`
- **THEN** the system SHALL use the `.agent` version
- **AND** mark it with location "project"

### Requirement: Skill Detection in Subdirectories

The system SHALL detect SKILL.md files in skill directories to identify valid skills.

#### Scenario: Detect SKILL.md in skill directory

- **WHEN** scanning directory `~/.claude/skills/my-skill/`
- **AND** the file `~/.claude/skills/my-skill/SKILL.md` exists
- **THEN** the system SHALL recognize it as a valid skill
- **AND** parse the SKILL.md file

#### Scenario: Ignore directories without SKILL.md

- **WHEN** scanning directory `~/.claude/skills/not-a-skill/`
- **AND** no SKILL.md file exists in that directory
- **THEN** the system SHALL skip that directory
- **AND** NOT register it as a skill

#### Scenario: Detect bundled resources

- **WHEN** a skill directory contains `references/`, `scripts/`, or `assets/` subdirectories
- **THEN** the system SHALL mark the skill as having those resources
- **AND** include resource availability in skill metadata

### Requirement: Custom Skill Directories

The system SHALL support additional custom skill directories via CLI option to enable flexible skill organization.

#### Scenario: Add custom skill directory via CLI flag

- **WHEN** the user runs `ccski mcp --skill-dir ~/my-custom-skills`
- **THEN** the system SHALL scan `~/my-custom-skills` recursively for SKILL.md files
- **AND** include discovered skills in the registry

#### Scenario: Multiple custom directories

- **WHEN** the user specifies multiple `--skill-dir` flags
- **THEN** the system SHALL scan all specified directories
- **AND** apply priority based on the order they appear (first = highest priority)

### Requirement: Skill Registry

The system SHALL maintain a registry of all discovered skills with metadata to enable efficient lookup and listing.

#### Scenario: Build skill registry on initialization

- **WHEN** the system initializes
- **THEN** it SHALL scan all skill directories
- **AND** build a Map of skill name to skill metadata
- **AND** include: name, description, location, path, hasReferences, hasScripts, hasAssets

#### Scenario: Provide diagnostic information

- **WHEN** the system completes a scan
- **THEN** it SHALL provide diagnostic output including:
  - Total number of skills discovered
  - List of directories scanned
  - Any errors or warnings encountered
  - Skill conflicts resolved by priority
