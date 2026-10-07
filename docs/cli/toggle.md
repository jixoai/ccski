# `ccski enable` / `ccski disable`

Enable or disable ccski projections. Disabling is physical, not a sidecar flag.

## Semantics (3.0)

- **Link projections**: `disable` unlinks the symlink from that root and records
  `disabled: true` in the scope's `.ccski-state.json`. `enable` recreates the
  link only after verifying the recorded entity revision still matches — if the
  entity changed, the call fails typed `ENTITY_REVISED` (update the entity
  first). Links never carry a second identity file.
- **Materialized copies**: keep the legacy `.SKILL.md` rename convention, labeled
  `convention: "ccski-legacy"` (not an npm:skills semantic).
- **External live-links** (targets outside ccski's records) are read-only and
  fail typed `FOREIGN_OWNERSHIP`.
- CLI scope defaults to `project`; `--global` targets the user-global scope.

## Usage

```bash
ccski enable [names...] [options]
ccski disable [names...] [options]
```

## Options

- `--global` / `-g`: operate on the global scope (default: project)
- `--all` / `-a`: operate on all recorded entities in scope
- `--interactive` / `-i`: interactive picker
- `--yes` / `-y`: skip confirmation prompt
- `--json`: output typed receipts as JSON

## Examples

```bash
ccski enable pdf
ccski disable --all
ccski disable -i
ccski disable my-skill --global
ccski disable my-skill --json
```
