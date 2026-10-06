# Tasks

## 1. Contracts and schemas
- [x] 1.1 Add `RestrictedSkillNameSchema` to `src/types/schemas.ts` and `InvalidSkillNameError` to `src/types/errors.ts`.
- [x] 1.2 Add remove result types (`RemoveSummary`, `RemoveResultEntry`, `RemovePreview`, options/request types, finite reason/error-code unions) to `src/api/types.ts`.

## 2. Remove primitive
- [x] 2.1 Implement `src/api/remove.ts`: target-root precondition, direct-child containment, lstat/symlink policy, idempotent skips, guard verification, per-item typed statuses.
- [x] 2.2 Selection modes: explicit requests, `all`, interactive prompt, `RemoveSelectionError`/`RemoveCancelledError` parity with toggle; `dryRun` preview.
- [x] 2.3 Export `removeSkills`, error classes, and types from `src/api/index.ts`.

## 3. Install audit hardening
- [x] 3.1 Add `InstallAuditError` (finite code union) and lstat audits for source dir, target root, and destination.
- [x] 3.2 Staged copy + rename swap overwrite with backup restore and `warning` reporting; name audit via `RestrictedSkillNameSchema`.
- [x] 3.3 Verify existing install behavior/tests remain compatible (statuses and idempotency unchanged).

## 4. Tests and validation
- [x] 4.1 `tests/remove.test.ts`: positive, idempotency, name pollution, path/symlink/not-skill/not-directory negatives, guard pass/mismatch/invalid/unreadable, disabled-only and conflict identity files, `all`, listing error, non-TTY interactive, dry-run, root preconditions.
- [x] 4.2 `tests/install-hardening.test.ts`: source/dest/root symlink audits, invalid names, clean-swap overwrite (stale file removed), copy-failure preserves destination.
- [x] 4.3 Run `pnpm test` and `pnpm ts` clean; run `openspec validate add-remove-api --strict`.
