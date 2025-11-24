# ccski – Claude Code Skills Manager

ccski is a CLI + MCP server that lets any AI coding assistant discover, install, enable/disable, and serve Claude Code-compatible skills. It is purpose-built to be lightweight, type-safe, and easy to embed in your editor or agent toolchain.

## 1) Positioning & MCP quick start

- **What it is**: a thin, batteries-included manager for SKILL.md–based skill packs (local folders, git repos, plugin marketplaces).
- **Who it’s for**: humans running CLI workflows and agents connecting over MCP.

### Start MCP in one line

```bash
npx ccski mcp
```

Common MCP registrations:

- **Codex CLI**: `codex mcp add skills -- npx ccski mcp`
- **Cursor / Windsurf / VS Code MCP plugins** (config excerpt):

```json
{
  "mcpServers": {
    "ccski": {
      "command": "npx",
      "args": ["ccski", "mcp"]
    }
  }
}
```

Run with `--skill-dir` to add extra roots, or `--no-refresh` to disable live reload.

## 2) Core CLI surface (human-friendly)

| Command                                     | Purpose                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ccski list`                                | Show discovered skills (projects, home, plugin marketplace) with status badges           |
| `ccski info <name>`                         | Inspect metadata and preview content                                                     |
| `ccski install <source> [-i\|--all\|--use]` | Install skills from git/dir/marketplace; interactive picker shows final one-shot command |
| `ccski enable [names...] [-i\|--all]`       | Restore `.SKILL.md` → `SKILL.md`; interactive defaults **unchecked**                     |
| `ccski disable [names...] [-i\|--all]`      | Disable skills by flipping to `.SKILL.md`                                                |
| `ccski mcp`                                 | Start MCP server (stdio/http/sse)                                                        |
| `ccski validate <path>`                     | Validate SKILL.md or directory structure                                                 |

Interactive pickers across install/enable/disable share the same layout, colors, and live “Command:” preview so you can copy/paste the equivalent non-interactive invocation.

## 3) Thanks & lineage

- **openskills** — established the SKILL.md authoring pattern; we align with that spec for compatibility.
- **universal-skills** — offers a curated, ready-to-use skill set; ccski focuses on management and transport, not bundling content.

Key differences: ccski is a manager/server (no baked-in skill corpus), MCP-first, and optimized for multi-root discovery plus install/enable/disable ergonomics.

## 4) Contributing & architecture at a glance

### Fast start

- `pnpm install`
- `pnpm test` (Vitest)
- `pnpm ts` (type-check)
- `pnpm build` (tsdown)

### Architecture map

- Entry: `src/cli.ts` (yargs CLI, shared color flags)
- Commands: `src/cli/commands/*.ts`
- Interactive UI: `src/cli/prompts/multiSelect.ts` (shared checkbox with live command preview)
- Formatting: `src/utils/format.ts` (tone helpers; avoid ad-hoc colors)
- Skill core: `src/core/*` (discovery, registry, parsing)
- Tests: `tests/*.test.ts` (Vitest + bun runtime for CLI e2e)

Suggested reading order: `src/utils/format.ts` → `src/cli/prompts/multiSelect.ts` → command files (install, toggle) → `src/core/registry.ts`.

### Code style highlights

- TypeScript strict; no `any`/`as any`/`@ts-nocheck` unless unavoidable for third-party types.
- Keep CLI colors via `tone/heading/warn/info/success/error`; don’t hardcode colorette directly.
- Prefer small files (<200 lines) or refactor into folders when complexity grows.
- Tests: Vitest with jsdom where needed; integration tests exercise CLI via bun runner.
- Package manager: pnpm; scripts live in `package.json`.

### Development scripts

```bash
pnpm install       # deps
pnpm test          # full test suite
pnpm ts            # type check
pnpm build         # bundle with tsdown
pnpm fmt           # prettier + organize imports + tailwind plugin
```

Happy hacking — PRs welcome!
