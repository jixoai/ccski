## MODIFIED Requirements

### Requirement: MCP respects source filters
- The MCP server SHALL accept the same include/exclude options as the CLI and apply them when building the `skill` tool description and when loading a skill.
- Filters MUST be re-applied on each refresh cycle so added/removed skills stay consistent with configured sources.
#### Scenario: codex-only MCP
- WHEN starting `ccski mcp --include=codex`
- THEN the `<available_skills>` block lists only Codex-provider skills and tool calls to Claude-only names return not-found errors with suggestions.

### Requirement: Provider-aware resolution
- The `skill` tool MUST accept provider-prefixed names to disambiguate duplicates and surface an ambiguity error when a short name matches multiple providers.
- Loaded content MUST include provider metadata in the header returned to the client.
#### Scenario: duplicate short name
- GIVEN `pdf` exists for both providers
- WHEN calling the tool with `{ name: "pdf" }`
- THEN the server returns an ambiguity error instructing the caller to specify `codex:pdf` or `claude:pdf`.
