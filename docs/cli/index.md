# CLI Documentation

ccski provides a CLI to manage skills across Claude and Codex runtimes. All commands accept `--json` for typed output.

3.0 model: every installed skill is an **entity** (a real directory under the scope's `.agents/skills/` root) plus explicit **projections** (symlinks by default) into agent roots. CLI mutations default to the `project` scope; pass `--global` to target the user-global scope.

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

| Command                       | Purpose                                                              | Docs                        |
| ----------------------------- | -------------------------------------------------------------------- | --------------------------- |
| `ccski list`                  | List discovered skills (with mode/ownership/provenance)               | [List](/cli/list)           |
| `ccski info <name>`           | Show metadata and content preview                                     | [Info](/cli/info)           |
| `ccski search <query>`        | Search by name/description (optional `--content`)                     | [Search](/cli/search)       |
| `ccski validate <path>`       | Validate a SKILL.md or skill directory                                | [Validate](/cli/validate)   |
| `ccski install`               | Install ccski workflow instructions into agent prompt files           | [Install](/cli/install)     |
| `ccski install <dir>`         | Install a local skill directory as entity + agent projections         | [Install](/cli/install)     |
| `ccski enable [names...]`     | Enable projections (link: rebuild after the `ENTITY_REVISED` gate)    | [Enable/Disable](/cli/toggle) |
| `ccski disable [names...]`    | Disable projections (link: unlink — physically effective)             | [Enable/Disable](/cli/toggle) |
| `ccski migrate`               | Adopt legacy materialized copies (dry-run by default)                 | [Migrate](/cli/migrate)     |
| `ccski gc`                    | Propose retiring state records whose roots vanished (dry-run only)    | [GC](/cli/gc)               |
| `ccski state repair`          | Diff + repair the sidecar state (`--confirm` required)                | [State](/cli/state)         |
| `ccski import <path> --claim` | Adopt an unregistered symlink (inode + hash guarded)                  | [Import](/cli/import)       |
| `ccski mcp`                   | Start MCP server (stdio/http/sse)                                     | [MCP](/cli/mcp)             |

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

# Install a local skill directory (project scope by default)
ccski install ./my-skill

# ...targeting the global scope and explicit agents
ccski install ./my-skill --global --agent claude-code --agent codex

# Preview the plan without writing
ccski install ./my-skill --dry-run --json

# Adopt pre-3.0 materialized copies (dry-run first)
ccski migrate
ccski migrate --execute

# Install the ccski workflow into user agent prompts
npx -y ccski install
```

Git/URL/marketplace install sources were removed in 3.0 (`SOURCE_UNSUPPORTED`).
Clone with your own tooling, then `ccski install <dir>`.

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
