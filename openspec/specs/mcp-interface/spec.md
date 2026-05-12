# Capability: MCP Interface

## Purpose

Define the MCP server surface that exposes discovered skills to AI agents through a stable tool interface.

## Requirements

### Requirement: Skill tool listing

The MCP server SHALL build the skill tool listing from the shared registry and SHALL NOT expose raw discovery parser stacks in the tool description.

#### Scenario: no skills found

- **WHEN** the registry contains no skills
- **THEN** the tool description still includes an empty available-skills block

#### Scenario: plugin manifest drift

- **WHEN** plugin discovery records compatibility diagnostics
- **THEN** the skill tool description lists available skills without raw parser stacks

### Requirement: Tool invocation loads skill content

- Calling the `skill` tool with `name` MUST load the matching SKILL using registry priority and short-name resolution; ambiguous short names MUST raise an error.
- The response MUST return text containing a header (name, path, location, plugin info if present) followed by the full SKILL markdown content.

#### Scenario: plugin short name ambiguous

- GIVEN both `example:pdf` and `other:pdf`
- WHEN calling the tool with `name: "pdf"`
- THEN an ambiguity error is thrown.

### Requirement: Transports

- The server MUST support `stdio` transport by default, streamable HTTP at `/mcp`, and SSE fallback using `/mcp` plus `/messages` endpoints.
- CLI options `--transport`, `--host`, and `--port` MUST configure the chosen transport.

#### Scenario: SSE session

- WHEN starting with `--transport sse`
- THEN `GET /mcp` establishes an SSE session and `POST /messages?sessionId=<id>` delivers messages for that session.

### Requirement: Auto-refresh

- Unless `autoRefresh` is false or `--no-refresh` is passed, the registry MUST refresh on an interval (default 30 seconds) and log a refresh notice to stderr.
- `--refresh-interval` MUST override the default interval.

#### Scenario: refresh interval override

- WHEN started with `--refresh-interval 10000`
- THEN the registry refreshes roughly every 10 seconds and logs each refresh.

### Requirement: Registry configuration passthrough

- The MCP server MUST honour registry options including `skill-dir`, `skipPlugins`, `pluginsFile`, `pluginsRoot`, and `scanDefaultDirs` so CLI and MCP share the same skill view.

#### Scenario: plugins skipped

- WHEN starting `ccski mcp --no-plugins`
- THEN the skill tool description lists only project/user skills and excludes plugin sources.

### Requirement: MCP respects source filters

- The MCP server SHALL accept the same include/exclude options as the CLI, including built-in providers `agents`, `claude`, `codex`, `gemini`, `openclaw`, `file`, and discovered dynamic providers, and apply them when building the `skill` tool description and when loading a skill.
- Filters MUST be re-applied on each refresh cycle so added/removed skills stay consistent with configured sources.

#### Scenario: gemini-only MCP

- WHEN starting `ccski mcp --include=gemini`
- THEN the `<available_skills>` block lists only Gemini-provider skills and tool calls to other provider-only names return not-found errors with suggestions.

### Requirement: Provider-aware resolution

- The `skill` tool MUST accept provider-prefixed names for built-in and dynamic providers to disambiguate duplicates and surface an ambiguity error when a short name matches multiple providers.
- Loaded content MUST include provider metadata in the header returned to the client.

#### Scenario: duplicate short name

- GIVEN `pdf` exists for `agents`, `codex`, and `claude`
- WHEN calling the tool with `{ name: "pdf" }`
- THEN the server returns an ambiguity error instructing the caller to specify a provider-prefixed name such as `agents:pdf`, `codex:pdf`, or `claude:pdf`.
