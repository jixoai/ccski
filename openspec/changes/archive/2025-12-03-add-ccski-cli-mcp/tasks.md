# Implementation Tasks (final status 2025-12-03)

## Completed
- Project scaffolding (package/tsconfig/tsdown/vitest/prettier) with strict TypeScript.
- Core skill parsing and validation with Zod and UTF-8 guardrails.
- Skill discovery + registry (priority dirs, custom dirs, disabled support, diagnostics, fuzzy suggestions).
- Plugin discovery via `installed_plugins.json` with namespaced skills and `--no-plugins` opt-out.
- CLI surface: `list`, `info`, `search`, `validate`, `install`, `enable`, `disable`, `mcp` with JSON & color controls, interactive pickers, and git/file/marketplace install modes.
- MCP server: `skill` tool with dynamic description, stdio/http/sse transports, and configurable auto-refresh.
- Shared utilities: formatting helpers, ufuzzy ranking, word wrap, and multi-select prompt shared across commands.

## Pending / Follow-ups
- Broaden test coverage (plugins, install failure paths, HTTP/SSE MCP flows) and add CI pipeline with coverage gating.
- Documentation additions: README-zh, CONTRIBUTING, CHANGELOG, release workflow.
- Performance & DX polish (colored error formatting, JSON parity where useful).
- Deferred: MCP resources endpoint and any telemetry/metrics work.
