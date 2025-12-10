# ccski – Claude Code Skills Manager

ccski is a CLI + MCP server to discover, install, enable/disable, and serve Claude Code-compatible skills. This README covers install and usage. For architecture and UX philosophy, see `SPEC.md`.

## Install

Requires Node.js >= 20.

```bash
# run directly
npx ccski --help

# or install locally
pnpm install ccski
ccski --help
```

## Quick start

### Run MCP server

```bash
npx ccski mcp
```

- Add extra skill roots: `npx ccski mcp --skill-dir /extra/skills`
- Disable auto refresh: `npx ccski mcp --no-refresh`

MCP plugin config example (Codex/Cursor/Windsurf/VS Code):

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

### Core CLI commands

| Command | Purpose |
| --- | --- |
| `ccski list` | List discovered skills (project, user, plugin) |
| `ccski info <name>` | Show metadata and content preview |
| `ccski install <source> [-i|--all|--path]` | Install from git/dir/marketplace/SKILL.md; interactive picker available |
| `ccski enable [names...] [-i|--all]` | Enable skills (`.SKILL.md` -> `SKILL.md`) |
| `ccski disable [names...] [-i|--all]` | Disable skills (`SKILL.md` -> `.SKILL.md`) |
| `ccski validate <path>` | Validate SKILL.md or skill directory |
| `ccski mcp` | Start MCP server (stdio/http/sse) |

### Install examples

- Git repo (auto-detect marketplace):
  `ccski install https://github.com/wshobson/agents`
- Specific branch or path:
  `ccski install https://github.com/wshobson/agents/tree/main --branch main`
  `ccski install https://github.com/wshobson/agents --path skills/foo/SKILL.md`
- Local directory or single file:
  `ccski install /path/to/skills --mode file`
  `ccski install ./plugins/foo/SKILL.md`
- Overwrite existing skill: add `--force` (or `--override`).

### Enable/disable

```bash
# Enable via interactive picker
ccski enable -i

# Disable all enabled skills
ccski disable --all
```

## More

- Claude users: prefer `ccski mcp --exclude=claude` to avoid echoing built-in Claude skills.
- Codex users: prefer `ccski mcp --exclude=codex` when avoid echoing built-in Codex skills.
- All commands support `--json` for scripting.
- Use `--no-color` to disable colors or `--color` to force them.
- Read `SPEC.md` for deep technical details and design philosophy.

## Acknowledgements

- [openskills](https://github.com/numman-ali/openskills) — established the SKILL.md authoring pattern; ccski aligns with that spec.
- [universal-skills](https://github.com/klaudworks/universal-skills) — MCP-first skill set; ccski focuses on management, not bundling content.
