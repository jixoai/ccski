# Design

## Context
Cross-repo ruling (skills-tabs-redesign design Δ4, 2026-10-06): ccski adds only a safe `removeSkills` primitive; update check/reinstall policy stays in the host. The primitive is public SDK but **host-guarded semantics**: the host resolves Workspace Provider targets to real roots and passes them in; ccski never learns about workspaces. `installSkillDir` must be hardened in the same change so the pair is symmetric (a safe remove next to an unsafe install would be an asymmetric primitive).

Current evidence (`src/api/install.ts:254-282`): `installSkillDir` builds `join(targetRoot, frontmatterName)` with no name audit, `existsSync` (symlink-following) for conflict detection, and in-place `cpSync` merge on overwrite.

## Goals / Non-Goals
- Goals:
  - Removal can only target a direct child of an already-resolved root, validated by a restricted name schema.
  - Symlink targets, escapes, and guard mismatches fail with typed, machine-readable reasons; missing targets are idempotent skips.
  - Overwrite installs recover from partial failure instead of leaving merged debris; status taxonomy unchanged.
  - Multi-selection UX errors follow the existing toggle `MultiSelectError(message, listing)` pattern.
- Non-Goals:
  - Atomic `reinstallSkills` (cross-filesystem remove+install is not naturally atomic; staged-dir/journal is a future, separate decision).
  - Update check / lock write ownership (host assets: Registry, probe, GitHub Trees, hash overlay).
  - Workspace/provider concepts inside ccski; CLI subcommand or MCP tool surface for removal (host adoption first).
  - npm:skills CLI protocol imitation — alignment is semantic only: same directory layout (root/<name> with SKILL.md/.SKILL.md), idempotent remove, per-item result summary shape.

## Decisions

### D1 Restricted name schema (`RestrictedSkillNameSchema`)
Allow-list: `/^[A-Za-z0-9][A-Za-z0-9._+@-]*$/`, trimmed, 1..128 chars. Rejects separators (`/`, `\`), NUL, `:` (plugin scope prefix is a discovery-layer concept, never an on-disk direct child), leading dots, and `.`/`..`. This is stricter than the frontmatter schema (`non-empty`) because remove/install act on the filesystem: the name *is* the directory name. Previously "installable" names outside this set become typed `INVALID_NAME` rejections — intentional breaking hardening under the no-compat policy (§8-style), not a regression to be aliased.

### D2 Containment and lstat policy (symmetric for install/remove)
- Resolve root once; per item `dest = resolve(join(root, name))`; verify `relative(root, dest)` neither absolute nor `..`-prefixed (defense in depth behind D1).
- `lstat` (never `existsSync`/`stat`) decides shape: symlink → typed refusal (`SYMLINK_TARGET` for remove, `SOURCE_SYMLINK`/`DEST_SYMLINK`/`TARGET_ROOT_SYMLINK` for install); non-directory → typed refusal; ENOENT → idempotent skip (remove) or copy target (install).
- Top-level skill-directory symlinks are a host product feature (self-skill symlink); this primitive refuses them and the host resolves policy before calling. Host-guarded, documented.
- Install additionally creates a missing root (existing behavior) but refuses an existing root that is a symlink or non-directory — `cpSync` would otherwise follow it out of the root.

### D3 Optional guard (`expectedContentHash` / `expectedInode`) — check-then-delete swap defense
- `expectedContentHash`: lowercase sha256 hex of the *active identity file* bytes — `SKILL.md` if present (even alongside `.SKILL.md`), else `.SKILL.md`. Format-validated (64 hex) → `GUARD_INVALID` on mismatch of format.
- `expectedInode`: compared against `lstat(dest).ino`; `GUARD_MISMATCH` when different.
- Guard checks run after the lstat shape checks, immediately before `rmSync`; identity file read goes through its own `lstat` (non-regular → `GUARD_UNREADABLE`, never read through a link).
- Residual race between guard verification and `rmSync` remains (Node cannot pin a directory fd for recursive unlink portably). Accepted: the guard narrows the check-then-delete window and the host keeps its own re-discovery + per-field match defenses (per Δ4 ruling, host defenses stay).

### D4 Per-item typed status (aligned summary shape)
`RemoveSummary { results, removed, skipped, failed }` mirrors `InstallSummary`/`ToggleSummary`. Entries: `{ skill, path, status: "removed"|"skipped"|"failed", reason?, errorCode?, error? }` with finite vocabularies: skip `NOT_FOUND`; failure `INVALID_NAME | PATH_ESCAPE | NOT_DIRECTORY | NOT_A_SKILL | SYMLINK_TARGET | GUARD_INVALID | GUARD_MISMATCH | GUARD_UNREADABLE | DELETE_FAILED`. A directory without any identity file is `NOT_A_SKILL` (refuse to delete unknown dirs); `rmSync` failure → `DELETE_FAILED`. Clients never parse strings.

### D5 Selection and multi errors
Explicit `requests` win. `all: true` removes every discovered direct-child skill dir (identity file present), leaving non-skill entries untouched. Neither given → `RemoveSelectionError(message, listing)` even for a single candidate: deletion is destructive, so explicit selection is mandatory (deliberately stricter than install's single-candidate auto-select). `interactive: true` without a TTY throws the same error with the listing (toggle pattern); with a TTY it runs the `promptMultiSelect` + confirm flow; cancellation → `RemoveCancelledError`. Missing/invalid target root throws `RemoveTargetRootError` before any per-item work (root failure invalidates all items; not a per-item status).

### D6 Install overwrite = staged copy + rename swap with backup restore
Chosen over pre-copy snapshot/restore (double copy cost) and over in-place merge (unrecoverable partial state):
1. `cpSync` source → hidden staging dir *inside the target root* (same filesystem, rename-safe); copy failure → staging removed, destination untouched, `COPY_FAILED`.
2. Fresh install: atomic `rename(staging, dest)` — a failed install can no longer leave a half-visible skill directory.
3. Overwrite (`force`, dest exists as real dir): `rename(dest, backup)` → `rename(staging, dest)` → `rm(backup)`. If the second rename fails, the backup is renamed back (best effort) and `SWAP_FAILED` is thrown; if restore also fails, the error names the residual backup path. Backup cleanup failure does not fail the install; it is reported as `warning` on the internal result.
- Semantics note: overwrite becomes a clean swap — files that existed only in the old destination no longer survive reinstall. This is the intended hardening (deterministic post-install state for host re-verification); `installed`/`skipped`/`overwritten` statuses and idempotency are unchanged.
- Residual: a process crash between the two renames leaves `.ccski-backup-*` (and a crashed copy leaves `.ccski-staging-*`) inside the root; both are hidden, always-cleaned on every handled failure path, and documented rather than journaled (journal is future atomic-update territory, out of scope per Δ4).

### D7 Where things live
Name schema in `src/types/schemas.ts` (shared by install/remove), `InvalidSkillNameError` in `src/types/errors.ts` (shared family), install audit errors (`InstallAuditError` with finite `code`) and remove errors (`RemoveSelectionError`, `RemoveCancelledError`, `RemoveTargetRootError`) in their API modules — matching the existing toggle/install error placement. Removal types in `src/api/types.ts`; exports via `src/api/index.ts`.

## Risks / Trade-offs
- Stricter name schema rejects exotic-but-previously-"working" install names → typed error with suggestion; no alias (no-compat policy).
- Symlink refusal may surprise hosts that relied on link-following → documented host-guarded contract; host resolves or removes links explicitly.
- Staging/backup dirs inside the root can be discovered if a crash leaves them → hidden names, all handled paths clean up, residual documented; discovery of an empty/backup dir is inert.
- Guard-based TOCTOU narrowing is not elimination → host defenses (re-discovery, per-field match) remain the outer boundary per Δ4.

## Migration Plan
- Pure additive SDK + install hardening; no data migration. Host adoption: resolve provider target → call `removeSkills({ targetRoot, requests: [{ name, expectedContentHash, expectedInode }] })`; keep host-side re-discovery verification after both install and remove.

## Open Questions
- None blocking. Future (explicitly out of scope): atomic reinstall journal, third-party lock writer ruling, CLI/MCP remove surface.
