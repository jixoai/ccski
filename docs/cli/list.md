# `ccski list`

List discovered skills across project, user, and plugin locations.

3.0 metadata: `--json` output carries the kernel annotations per top-level entry
(`canonicalPath`, `entryKind`, `ownership`, `mode`, `provenance` — e.g.
`materialized + legacy-unknown` for pre-3.0 copies — and `stale`). Plain output
appends a `[stale STALE_PROJECTION]` badge to link projections whose recorded
entity revision went stale after a replace.

## Usage

```bash
ccski list [options]
```

## Options

- `--json`: output JSON (same structure as API list)
- `--all`: include enabled + disabled
- `--disabled`: show only disabled
- `--include <token>` / `--exclude <token>`: filter by provider, plugin, or name
- `--skill-dir <path>`: add extra roots (repeatable)
- `--scan-default-dirs`: enable default root scanning (default: true)
- `--claude-plugins-file` / `--claude-plugins-root`: override plugin discovery paths

## Examples

```bash
ccski list
ccski list --disabled
ccski list --include=codex --json
```
