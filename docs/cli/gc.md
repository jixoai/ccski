# `ccski gc`

Propose retiring state records whose roots vanished. **3.0 is dry-run only** —
gc never deletes anything.

## Usage

```bash
ccski gc --dry-run [options]
```

Without `--dry-run` the command fails typed `DRY_RUN_REQUIRED` (exit 1) rather
than pretending to have executed.

## Output

- **Proposals**: state records whose projection root no longer exists, with the
  record's mode, logical name, folder name, and vanished root path. Nothing is
  removed; apply decisions via `ccski state repair` or the entity removal APIs.
- **Unknown references** (`GC_UNKNOWN_REFERENCE`): external references to an
  entity that gc cannot attribute — surfaced as warnings that block unsafe GC.

## Options

- `--global` / `-g`: inspect the global scope (default: project)
- `--dry-run`: required; gc is proposal-only in 3.0 and never deletes
- `--json`: output proposals as JSON

## Examples

```bash
ccski gc --dry-run
ccski gc --dry-run --global
ccski gc --dry-run --json
```
