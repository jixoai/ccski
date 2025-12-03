# Change: Add Codex Skills source filtering and compatibility

## Why
- Codex introduces its own `~/.codex/skills` ecosystem and filtering semantics; ccski currently only understands Claude-style skills and lacks source-level include/exclude controls.
- CLI/MCP users need a consistent way to view, search, validate, install, enable/disable, and serve both Claude and Codex skills without name conflicts.
- Validation must optionally enforce Codex constraints (length, single-line fields, symlink avoidance) so users know when a skill is Codex-ready.

## What Changes
- Add Codex skill discovery roots and provider labeling across registry, CLI, and MCP surfaces.
- Introduce include/exclude source filters (`auto|claude|codex|all` with optional per-skill selectors) applied consistently across commands and MCP tool output.
- Extend install to target Codex roots; extend validate to support Codex compatibility checks.
- Update outputs to surface provider information and keep auto-dedup semantics explicit.

## Impact
- Specs affected: `skill-discovery`, `cli-interface`, `mcp-interface`, `skill-parsing` (validation rules).
- No code changes yet; this proposal scopes the work and acceptance criteria.
