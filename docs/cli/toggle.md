# `ccski enable` / `ccski disable`

Enable or disable skills by renaming `SKILL.md` <-> `.SKILL.md`.

## Usage

```bash
ccski enable [names...] [options]
ccski disable [names...] [options]
```

## Options

- `--all`: operate on all candidates
- `--interactive` / `-i`: interactive picker
- `--force` / `--override`: override file conflicts
- `--json`: output JSON summary
- `--include <token>` / `--exclude <token>`: filter by provider/plugin/name

## Examples

```bash
ccski enable pdf
ccski disable --all
ccski disable -i
```
