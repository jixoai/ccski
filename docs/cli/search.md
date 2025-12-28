# `ccski search`

Search skills by name/description and optionally by content.

## Usage

```bash
ccski search <query> [options]
```

## Options

- `--content`: search inside SKILL.md body
- `--limit <n>`: cap results (default 10)
- `--json`: output JSON (same structure as API search)
- `--include <token>` / `--exclude <token>`: filter by provider/plugin/name
- `--all` / `--disabled`: control disabled visibility

## Examples

```bash
ccski search api
ccski search api --content --limit=5
```
