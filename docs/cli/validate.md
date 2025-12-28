# `ccski validate`

Validate a SKILL.md file or a skill directory.

## Usage

```bash
ccski validate <path> [options]
```

## Options

- `--json`: output JSON result
- `--include <token>` / `--exclude <token>`: filters for provider detection
- `--all` / `--disabled`: control disabled visibility

## Examples

```bash
ccski validate ./skills/pdf
ccski validate ./skills/pdf --json
```
