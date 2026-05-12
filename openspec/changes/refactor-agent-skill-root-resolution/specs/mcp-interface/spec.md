## MODIFIED Requirements

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
