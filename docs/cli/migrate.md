# `ccski migrate`

Adopt pre-3.0 materialized skill directories as ccski entities + projections.
**Dry-run is the default** — nothing is written until you pass `--execute`.

## Usage

```bash
ccski migrate [options]                 # dry-run plan (default)
ccski migrate --execute                 # guarded execution
ccski migrate --execute --plan plan.json
```

## Dry-run plan

The plan lists, per legacy copy: name collisions, content hashes, target
entities, planned projections, and affected roots. The output is written to
stdout (JSON with `--json`) and can be saved for a later guarded execution.

## Execution

`--execute` is expected-hash guarded:

- Each legacy copy is converted only if its content hash still matches the
  expected value (from the same-call scan, or from a `--plan` file). On mismatch
  the copy fails typed `HASH_MISMATCH` and the **original stays untouched**.
- Name collisions fail typed `NAME_COLLISION` and keep the original; other
  migrations continue.
- Every execution writes a backup and journal; a crash mid-migration is
  recovered from the journal on the next run.
- Conflicting originals are never overwritten — partial success is the norm and
  reported per item.

## Options

- `--global` / `-g`: migrate the global scope (default: project)
- `--dry-run`: print the migration plan without writing (default when `--execute`
  is absent)
- `--execute`: execute the migration (expected-hash guarded, backup/journal
  rollback)
- `--root <path>` (repeatable): extra projection roots to scan for legacy copies
- `--plan <file>`: path to a dry-run plan JSON; execution guards against its
  pinned hashes
- `--json`: output the plan/receipts as JSON

## Examples

```bash
ccski migrate --dry-run
ccski migrate --dry-run --json > plan.json
ccski migrate --execute
ccski migrate --execute --plan plan.json
ccski migrate --execute --global
```
