# Change: Refactor diagnostics and output contract

## Why

Claude Code plugin metadata can change shape across versions, and ccski currently treats that external shape too strictly while printing raw parser errors from core discovery. This pollutes the most important user path (`ccski list`) and risks contaminating JSON and MCP output.

## What Changes

- Add a structured diagnostics contract for discovery, plugin scanning, and registry refresh.
- Keep core discovery side-effect free: no direct `console.*` from core modules.
- Normalize Claude plugin manifest entries from a tolerant external shape into ccski's internal `PluginEntry` model.
- Render diagnostics only at CLI/MCP boundaries, without raw Zod stacks for expected compatibility drift.
- Restore strict TypeScript, test, and build gates.

## Impact

- Affected specs: `skill-discovery`, `plugin-support`, `cli-interface`, `mcp-interface`
- Affected code: core discovery/registry/plugin scanning, CLI rendering, tests, TypeScript strictness fixes
