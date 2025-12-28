# `ccski install`

Install skills from git, local directories, marketplace.json, or explicit SKILL.md paths.

## Usage

```bash
ccski install <source> [options]
```

## Options (common)

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
