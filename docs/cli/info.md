# `ccski info`

Show metadata and a content preview for a skill.

## Usage

```bash
ccski info <name> [options]
```

## Options

- `--full`: show full SKILL.md
- `--json`: output JSON (same structure as API info)
- `--include <token>` / `--exclude <token>`: filter by provider/plugin/name
- `--all`: include disabled skills
- `--disabled`: search only disabled skills

## Examples

```bash
ccski info codex:pdf
ccski info pdf --full
ccski info @canvas-design:webapp-testing --json
```
