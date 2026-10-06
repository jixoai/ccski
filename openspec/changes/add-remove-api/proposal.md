# Change: Add safe `removeSkills` primitive and harden `installSkillDir`

## Why
- ccski's public API can install and toggle skills but cannot remove them, so every host that needs removal reimplements unsafe `rm -rf` logic against paths it barely controls.
- `installSkillDir` currently joins the frontmatter name onto the target root and `cpSync` merges in place: an unchecked name can escape the root, a symlinked source/destination is silently followed, and a failed overwrite leaves a partially merged directory.
- This change is the ccski-side deliverable (Δ4) of the cross-repo `skills-tabs-redesign` design: a safe, host-guarded remove primitive plus symmetric install audit hardening.

## What Changes
- Add `removeSkills` SDK function: restricted skill name schema + already-resolved target root + direct-child containment + lstat/symlink policy + idempotent typed per-item status (`removed`/`skipped`/`failed` with finite reason codes) + optional expected content-hash/inode guard against check-then-delete body swaps.
- Add `RemoveSelectionError`/`RemoveCancelledError`/`RemoveTargetRootError` following the existing `MultiSelectError` (toggle) error pattern.
- Harden `installSkillDir`: source/destination/target-root lstat audits, restricted-name audit, defense-in-depth path containment, and staged-copy + rename-swap overwrite with backup restore (partial-overwrite failure recovery). Existing `installed`/`skipped`/`overwritten` idempotent status semantics are preserved.
- Add `RestrictedSkillNameSchema` (shared by install audit and remove validation) and typed audit error classes.
- **Not in scope:** atomic `reinstallSkills`, update/check migration (host-owned), third-party lock writes, version bump/publish. npm:skills compatibility is semantic alignment only (directory layout / idempotency / result shape), not CLI protocol imitation.

## Impact
- Affected specs: `programmatic-api` (new removal requirements; hardened install requirements).
- Affected code: `src/api/remove.ts` (new), `src/api/install.ts` (audit hardening), `src/api/types.ts` (remove result types), `src/types/schemas.ts` (restricted name schema), `src/types/errors.ts` (invalid-name error), `src/api/index.ts` (exports), `tests/remove.test.ts` + `tests/install-hardening.test.ts` (new).
- Host repo (skill-creator-v2) is unaffected until it adopts the primitive; adoption notes live in `design.md` (Host adoption section).
