# Project Context

## Purpose
ccski is a TypeScript CLI and MCP server that discovers, installs, enables/disable, and serves Claude Code–compatible SKILL.md skills so any AI agent can reuse them.

## Tech Stack
- TypeScript (strict) targeting Node.js 20+, built with tsdown (ESM + types output).
- CLI: yargs + shared color/render helpers in `src/utils/format.ts`; interactive pickers via `@inquirer/*`.
- MCP server: `@modelcontextprotocol/sdk` with stdio/http/sse transports.
- Scripts/tests run with `tsx`/`bun`; package manager `pnpm`.

## Project Conventions

### Code Style
- No `any`/`as any`; prefer small, focused files (< ~200 lines) and shared helpers over duplication.
- Use color utilities (`tone`, `renderList`, `heading`) instead of ad-hoc ANSI escapes.
- Prettier with organize-imports + tailwindcss plugins; keep functions single-responsibility.

### Architecture Patterns
- Core skill logic in `src/core` (parsing, discovery, plugins, registry) reused by CLI and MCP.
- CLI commands live in `src/cli/commands`; registry options are built centrally in `src/cli/registry-options.ts`.
- MCP server (`src/mcp/server.ts`) reuses the registry to keep CLI and MCP views consistent.

### Testing Strategy
- Vitest unit and integration tests (`tests/*.test.ts`); fixtures under `tests/fixtures`.
- Goals: keep coverage healthy; add CI (type check, test, build) when capacity allows.

### Git Workflow
- Standard feature branches; follow `/Users/kzf/.claude/agents/git-committer.md` for commit style when committing.

## Domain Context
- SKILL.md format with YAML frontmatter (`name`, `description`) plus optional references/scripts/assets folders.
- Skills are discovered from project/user roots and Claude plugin installs in `~/.claude/plugins`.

## Important Constraints
- Favor KISS/YAGNI; avoid destructive filesystem commands; keep behaviour type-safe and consistent between CLI and MCP outputs.

## External Dependencies
- Git must be available for `ccski install` when cloning remote sources.
- Relies on Claude plugin layout (`installed_plugins.json`) when loading marketplace skills.
