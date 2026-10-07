# `ccski state`

ccski state maintenance. The scope's sidecar state lives at
`<scopeBase>/.ccski-state.json` and is the sole writer domain of ccski.

## Usage

```bash
ccski state repair [options]              # diff only
ccski state repair --confirm [options]    # apply the repair
```

## `state repair`

Compares a filesystem scan against the sidecar state:

1. Prints the diff (missing entries, extra entries, drift).
2. Without `--confirm`, stops there and fails typed `REPAIR_CONFIRM_REQUIRED`.
3. With `--confirm`, writes a **pre-repair state backup**, then applies the repair.
4. Is **idempotent**: a second `--confirm` run reports clean without writing.

Deep cleanup also collects crash residues: staging/backup directories are removed
when they carry a ccski ownership marker; entries without a marker (possibly
user data) are conservatively kept.

## Options

- `--global` / `-g`: repair the global scope (default: project)
- `--confirm`: apply the repair (absent: diff only + typed
  `REPAIR_CONFIRM_REQUIRED`)
- `--root <path>` (repeatable): extra roots to include in the scan
- `--json`: output the diff/receipt as JSON

## Examples

```bash
ccski state repair
ccski state repair --confirm
ccski state repair --confirm --global
ccski state repair --json
```
