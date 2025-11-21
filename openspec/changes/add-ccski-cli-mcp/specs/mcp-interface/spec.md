# MCP Interface Specification

## ADDED Requirements

### Requirement: MCP Server Initialization

The system SHALL implement an MCP server that communicates via stdio protocol.

#### Scenario: Start MCP server on stdio

- **WHEN** the MCP server starts
- **THEN** it SHALL listen for JSON-RPC messages on stdin
- **AND** send responses to stdout
- **AND** send diagnostic logs to stderr
- **AND** follow the MCP protocol specification

#### Scenario: Initialize skill registry on startup

- **WHEN** the MCP server starts
- **THEN** it SHALL scan all skill directories
- **AND** build the skill registry
- **AND** log initialization progress to stderr

### Requirement: Skill Tool

The system SHALL provide a single `skill` tool that lists all available skills in its description and loads skill content.

#### Scenario: Provide skill tool definition

- **WHEN** an MCP client requests tool list
- **THEN** the system SHALL return a tool definition with:
  - `name: "skill"`
  - `description` containing a list of all available skills (name + description)
  - `inputSchema` requiring a `name` parameter (string)

#### Scenario: Dynamic skill list in description

- **WHEN** the skill registry is updated (on refresh)
- **THEN** the tool description SHALL be updated with the current skill list
- **AND** include all user, project, and plugin skills
- **AND** use the format:
  ```
  Load a skill by name to get specialized instructions.

  Available skills:
  - user: 用户的全局技能,必读!
  - bun: Enhanced documentation skill for 'bun'
  - example-skills:pdf: Comprehensive PDF manipulation toolkit
  ...
  ```

#### Scenario: Load skill by name

- **WHEN** an agent invokes the skill tool with `{ "name": "user" }`
- **THEN** the system SHALL find the skill "user" (case-insensitive)
- **AND** return the full SKILL.md content with frontmatter
- **AND** prepend the base directory path for reference resolution

#### Scenario: Load skill by full namespaced name

- **WHEN** an agent invokes the skill tool with `{ "name": "example-skills:pdf" }`
- **THEN** the system SHALL find the plugin skill
- **AND** return its full content

#### Scenario: Load skill by short name (unambiguous)

- **WHEN** an agent invokes the skill tool with `{ "name": "pdf" }`
- **AND** only one skill named "pdf" exists
- **THEN** the system SHALL resolve to that skill
- **AND** return its content

#### Scenario: Error on ambiguous short name

- **WHEN** an agent invokes the skill tool with `{ "name": "pdf" }`
- **AND** multiple skills have name "pdf"
- **THEN** the system SHALL return an error
- **AND** list all matching full names
- **AND** suggest using the full namespaced name

#### Scenario: Error on skill not found

- **WHEN** an agent invokes the skill tool with a non-existent skill name
- **THEN** the system SHALL return an error
- **AND** suggest similar skill names (fuzzy matching)
- **AND** use MCP error format

### Requirement: Skill Content Format

The system SHALL format skill content for agent consumption.

#### Scenario: Include base directory in response

- **WHEN** returning skill content
- **THEN** the system SHALL prepend:
  ```
  Loading: {skill-name}
  Base directory: {absolute-path-to-skill-directory}

  ```
- **AND** follow with the full SKILL.md content (including frontmatter)

#### Scenario: Preserve exact formatting

- **WHEN** returning skill content
- **THEN** the system SHALL preserve all formatting:
  - Line breaks
  - Code block formatting
  - Indentation
  - Special characters (UTF-8)

### Requirement: Auto-Refresh

The system SHALL periodically refresh the skill registry to detect changes without requiring server restart.

#### Scenario: Refresh on 30-second interval

- **WHEN** the MCP server has been running for 30 seconds
- **THEN** it SHALL rescan all skill directories
- **AND** update the skill registry
- **AND** update the skill tool description

#### Scenario: Detect new skills

- **WHEN** a new SKILL.md file is added to a skill directory
- **AND** the next refresh occurs
- **THEN** the new skill SHALL appear in the registry
- **AND** be available via the skill tool

#### Scenario: Detect modified skills

- **WHEN** a SKILL.md file is modified
- **AND** the next refresh occurs
- **THEN** the updated content SHALL be loaded
- **AND** subsequent tool calls SHALL return the new content

#### Scenario: Detect removed skills

- **WHEN** a SKILL.md file is deleted
- **AND** the next refresh occurs
- **THEN** the skill SHALL be removed from the registry
- **AND** tool calls SHALL return "not found" error

### Requirement: Concurrent Request Handling

The system SHALL handle concurrent skill tool requests safely.

#### Scenario: Handle multiple simultaneous requests

- **WHEN** multiple agents invoke the skill tool concurrently
- **THEN** the system SHALL process each request independently
- **AND** return correct content for each skill requested
- **AND** NOT corrupt the skill registry

#### Scenario: Handle requests during refresh

- **WHEN** a skill tool request arrives during a registry refresh
- **THEN** the system SHALL use the current registry state
- **AND** NOT block the request
- **AND** apply the refresh after the request completes

<!-- MCP Resources feature is deferred to a future iteration
     See design.md Open Questions for discussion
-->

### Requirement: Error Responses

The system SHALL provide informative error responses following MCP protocol.

#### Scenario: Invalid tool call parameter

- **WHEN** the skill tool is invoked without the required `name` parameter
- **THEN** the system SHALL return an MCP error
- **AND** indicate that `name` is required
- **AND** use error code for invalid params

#### Scenario: Internal errors

- **WHEN** an internal error occurs (file read error, etc.)
- **THEN** the system SHALL return an MCP error
- **AND** include the error message
- **AND** log the full error to stderr

### Requirement: Graceful Shutdown

The system SHALL handle shutdown signals gracefully.

#### Scenario: Handle SIGINT

- **WHEN** the server receives SIGINT (Ctrl+C)
- **THEN** it SHALL clean up resources (clear refresh interval)
- **AND** log shutdown message to stderr
- **AND** exit with code 0

#### Scenario: Handle SIGTERM

- **WHEN** the server receives SIGTERM
- **THEN** it SHALL perform the same cleanup as SIGINT
- **AND** exit with code 0
