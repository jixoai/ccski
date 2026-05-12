# `ccski install`

Install the ccski workflow into agent instruction files, or install skills from git,
local directories, marketplace.json, or explicit SKILL.md paths.

## Usage

```bash
ccski install [--agent <target>] [--user|--project]
ccski install <source> [options]
```

## Workflow install

Omit `<source>` to inject a managed English `<workflow name="ccski">` block into
agent prompt files.

```bash
npx -y ccski install
npx -y ccski install --agent=codex
npx -y ccski install --agent=gemini --project
```

- Default scope is user.
- `--project` targets the current directory.
- `--agent` can be repeated. Known targets: `codex`, `claude-code`, `gemini`,
  `opencode`.
- The block is idempotent; only the managed ccski workflow block is replaced.

## Options (common)

- `--agent <target>`: workflow target when no source is provided
- `--scope user|project`: workflow scope
- `--user` / `--project`: workflow scope shortcuts
- `--all`: install all discovered skills
- `--interactive` / `-i`: interactive picker
- `--path <path>`: explicit SKILL.md or marketplace.json within source
- `--mode git|file`: source mode (default: git for http/https)
- `--branch <name>`: git branch
- `--force` / `--override`: overwrite existing skills
- `--out-dir <path>` (repeatable): destination directory
- `--out-scope <scope>`: `claude|claude:@project|claude:@user|codex|codex:@user`
- `--json`: output JSON summary
- `--dry-run`: preview without installing

## Examples

```bash
ccski install https://github.com/wshobson/agents
ccski install https://github.com/wshobson/agents --path skills/foo/SKILL.md
ccski install ./local-skill --mode file --out-dir ./skills
```
