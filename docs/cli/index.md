# CLI Documentation

ccski provides a CLI to manage skills across Claude and Codex runtimes. All commands accept `--json` for structured output.

## Install

```bash
# Run directly
npx ccski --help

# Or install locally
pnpm install ccski
ccski --help
```

## Global options

- `--skill-dir <path>` (repeatable): additional skill roots (default scope `other`)
- `--user-dir <path>`: override user directory for default roots
- `--no-color` / `--color`: control ANSI output

## Commands

| Command                    | Purpose                                                     | Docs                          |
| -------------------------- | ----------------------------------------------------------- | ----------------------------- |
| `ccski list`               | List discovered skills (project/user/plugin)                | [List](/cli/list)             |
| `ccski info <name>`        | Show metadata and content preview                           | [Info](/cli/info)             |
| `ccski search <query>`     | Search by name/description (optional `--content`)           | [Search](/cli/search)         |
| `ccski validate <path>`    | Validate a SKILL.md or skill directory                      | [Validate](/cli/validate)     |
| `ccski install`            | Install ccski workflow instructions into agent prompt files | [Install](/cli/install)       |
| `ccski install <source>`   | Install from git/dir/marketplace/SKILL.md                   | [Install](/cli/install)       |
| `ccski enable [names...]`  | Enable skills (`.SKILL.md` -> `SKILL.md`)                   | [Enable/Disable](/cli/toggle) |
| `ccski disable [names...]` | Disable skills (`SKILL.md` -> `.SKILL.md`)                  | [Enable/Disable](/cli/toggle) |
| `ccski mcp`                | Start MCP server (stdio/http/sse)                           | [MCP](/cli/mcp)               |

## Common examples

```bash
# List all skills
ccski list

# List disabled only
ccski list --disabled

# Inspect a skill
ccski info codex:pdf

# Search by content
ccski search api --content

# Validate
ccski validate ./skills/pdf

# Install from a repo
ccski install https://github.com/wshobson/agents

# Install with explicit path
ccski install https://github.com/wshobson/agents --path skills/foo/SKILL.md

# Install the ccski workflow into user agent prompts
npx -y ccski install
```

## MCP server

```bash
ccski mcp --transport http --port 3333
```

MCP config example:

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
