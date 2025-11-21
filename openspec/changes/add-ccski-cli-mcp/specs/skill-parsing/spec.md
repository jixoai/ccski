# Skill Parsing Specification

## ADDED Requirements

### Requirement: YAML Frontmatter Parsing

The system SHALL parse YAML frontmatter from SKILL.md files to extract skill metadata.

#### Scenario: Parse valid YAML frontmatter

- **WHEN** a SKILL.md file contains valid YAML frontmatter between `---` markers
- **THEN** the system SHALL extract the frontmatter as an object
- **AND** parse the `name` field as a string
- **AND** parse the `description` field as a string

#### Scenario: Handle multi-line descriptions

- **WHEN** the `description` field spans multiple lines
- **THEN** the system SHALL preserve the full description text
- **AND** normalize whitespace (collapse multiple spaces/newlines to single spaces)

#### Scenario: Reject missing frontmatter

- **WHEN** a SKILL.md file does not contain YAML frontmatter
- **THEN** the system SHALL reject the file
- **AND** log an error with the file path
- **AND** NOT register the skill

### Requirement: Required Field Validation

The system SHALL validate that required fields are present in the YAML frontmatter.

#### Scenario: Validate required fields are present

- **WHEN** parsing a SKILL.md file
- **THEN** the system SHALL verify `name` field is present and non-empty
- **AND** verify `description` field is present and non-empty
- **AND** reject the file if either field is missing or empty

#### Scenario: Provide helpful error for missing name

- **WHEN** a SKILL.md file has frontmatter but no `name` field
- **THEN** the system SHALL log an error: "Missing required field 'name' in {path}"
- **AND** suggest adding the name field

#### Scenario: Provide helpful error for missing description

- **WHEN** a SKILL.md file has frontmatter but no `description` field
- **THEN** the system SHALL log an error: "Missing required field 'description' in {path}"
- **AND** suggest adding the description field

### Requirement: Optional Field Handling

The system SHALL allow optional fields in the YAML frontmatter without rejection.

#### Scenario: Allow additional frontmatter fields

- **WHEN** a SKILL.md file contains extra fields like `license`, `version`, `author`
- **THEN** the system SHALL NOT reject the file
- **AND** MAY store these fields in skill metadata for future use

### Requirement: Skill Content Preservation

The system SHALL preserve the full markdown content of SKILL.md files for delivery to agents.

#### Scenario: Extract full markdown content

- **WHEN** parsing a SKILL.md file
- **THEN** the system SHALL extract everything after the closing `---` of frontmatter
- **AND** preserve the exact formatting (whitespace, line breaks, code blocks)
- **AND** store it as the skill's content

#### Scenario: Include frontmatter in content delivery

- **WHEN** delivering a skill to an agent or user
- **THEN** the system SHALL include the original YAML frontmatter
- **AND** include the markdown content
- **AND** separate them with the original `---` markers

### Requirement: UTF-8 Encoding

The system SHALL support UTF-8 encoded SKILL.md files to handle international characters.

#### Scenario: Parse UTF-8 content correctly

- **WHEN** a SKILL.md file contains UTF-8 characters (Chinese, emoji, etc.)
- **THEN** the system SHALL parse the content correctly
- **AND** preserve all Unicode characters
- **AND** NOT corrupt or mangle the text

#### Scenario: Reject invalid encoding

- **WHEN** a SKILL.md file has invalid UTF-8 encoding
- **THEN** the system SHALL log an error
- **AND** NOT register the skill

### Requirement: Error Recovery

The system SHALL provide detailed error messages and suggestions to help users fix invalid skills.

#### Scenario: Provide detailed parse errors

- **WHEN** YAML frontmatter parsing fails
- **THEN** the system SHALL log the specific YAML syntax error
- **AND** include the file path
- **AND** include the line number if available

#### Scenario: Suggest fixes for common errors

- **WHEN** a skill fails validation
- **THEN** the system SHALL provide actionable suggestions
- **AND** include examples of correct format
- **AND** reference the SKILL.md specification
