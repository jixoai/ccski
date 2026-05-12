# Change: Refactor agent skill root resolution

## Why

The skill ecosystem now has a shared `~/.agents/skills` convention and multiple agent-specific homes beyond Claude and Codex. ccski must discover these roots through a provider-neutral resolution law instead of hard-coding a narrow provider pair.

## What Changes

- Add a shared `agents` provider for `.agents/skills` roots.
- Promote `gemini` and `openclaw` to built-in providers while keeping dynamically discovered `.<agent>/skills` providers.
- Replace default root ordering with explicit root priority: custom roots highest, then workspace agent-specific, workspace shared, user agent-specific, and user shared.
- Make `auto` dedup use root priority first, then skill mtime, then deterministic provider ordering.
- Update CLI/MCP provider filters and display contracts to accept built-in and discovered providers.

## Impact

- Affected specs: `skill-discovery`, `cli-interface`, `mcp-interface`
- Affected code: discovery roots, provider types, filtering, resolution, list rendering, tests
