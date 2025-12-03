# Capability: MCP Interface

## Requirements

### Requirement: Skill tool listing
- The MCP server MUST expose a single `skill` tool whose description embeds an `<available_skills>` block listing every discovered skill with name, description, and location.
- The description MUST include basic usage instructions and discovery notes so agents understand how to invoke the tool.
#### Scenario: no skills found
- WHEN the registry is empty
- THEN the description still returns `<available_skills>` with a `none` placeholder entry.

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
