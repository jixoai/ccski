# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/); versions follow [Semantic Versioning](https://semver.org/).

## [3.0.0] - 2026-10-07

Breaking release (major). The 2.x skill manager is replaced by the **entity + projection kernel**: every installed skill is a canonical entity directory in the scope's `.agents/skills/` root plus explicit projections (symlinks by default) into named agent roots, with ccski-owned accounting in `<scopeBase>/.ccski-state.json`. Breaking boundaries are not backported into 2.x. Migration path for existing installs: [Migrating from 2.x](./README.md#migrating-from-2x).

### Platform verification statement (Windows)

**Windows behavior is an explicitly unverified surface in this release.** The Windows-specific failure classification (`symlink-unavailable` for `EPERM`/`ENOSYS`/`EXDEV`/unsupported junctions; `TARGET_DENIED` for target-level permission failures) is implemented and covered by tests against constructible surfaces — a typed syscall injection seam driving real errno values, plus real-kernel constructions available on the development platform (flag checks such as `uchg`, `chmod`). **No real Windows machine or CI runner was available for the 3.0.0 release gate.** Real-Windows behavior — genuine `EPERM` from policy, junction semantics, `EXDEV` across volumes — has not been observed on the platform itself. Per the release platform gate, absence of a runnable environment is recorded as *not verified* and is **not treated as a pass**; honesty over progress. A follow-up verification pass on a Windows runner is required before Windows support can be claimed.

### Removed (breaking)

- **2.x mutation APIs**: `installSkills`, `installSkillDir`, `removeSkills`, `toggleSkills` and their option/result types (16 exports, 9 types) — removed with no aliases, no compatibility shims. Their semantics are carried by the kernel API and CLI commands.
- **Git/URL/marketplace install sources** (CLI): `ccski install <git-url|marketplace>` and the `--mode`/`--branch`/`--path`/`--all` source-selection flags are retired. Git-based acquisition moves to host tooling (clone, then `ccski install <dir>`); the CLI fails typed `SOURCE_UNSUPPORTED` for retired sources.
- **Install model**: single-root materialization copies are gone. Installation is the two-phase `ensureEntity` + `projectEntity` kernel.
- **Toggle semantics on link projections**: disable no longer renames `SKILL.md` files. Link disable is physical (`unlink` + state record); the `.SKILL.md` rename survives only for materialized copies, labeled `convention: "ccski-legacy"`.
- **Silent overwrite installs**: installing an existing logical name from a different source fails typed `NAME_EXISTS` unless an explicit `replace: { expectedRevision }` is provided (no last-write-wins).
- **npm lock writes**: ccski never writes `.skill-lock.json` (layered single-writer); receipts report `lockSyncPending: true` instead of pretending lock sync happened.

### Added

- **Two-phase install kernel**: `ensureEntity({ scope, source, replace? })` and `projectEntity({ scope, name, roots, mode?, strict? })`. Frozen npm:skills 1.7.1 sanitize for folder names (underscores/dots preserved); typed `NAME_COLLISION`; explicit replace state machine with backup rollback (`GUARD_ENTITY`); automatic downgrade to `materialized` only for `symlink-unavailable`; `TARGET_DENIED` never silently copies; strict link-only mode; the fourth `entity-local` form for canonical roots (`targetKind: "entity"`, idempotent, no duplicate records).
- **First-class symlink discovery**: `canonicalPath` / `entryKind` / `ownership` (`ccski` | `external` | `unknown`) / `mode` / `provenance` (`legacy-unknown`) / `stale` metadata; broken links reported as typed omissions, never silent misses; recursive descent never follows symlinks below the top level; reserved names `.ccski-staging-*` / `.ccski-backup-*` swept only with an ownership marker plus age/generation conditions.
- **Entity mutations**: `removeEntityProjections` (projection-first; entity GC only after all-roots reference re-verification, `GC_UNKNOWN_REFERENCE` keeps the entity), `deleteEntity` (revision-guarded), `toggleEntityProjection` (physical disable; `ENTITY_REVISED` gate on enable), `updateEntity` (stable-path entity swap; per-copy re-materialization; typed `PINNED` skips; partial success is the norm — there is no "atomic reinstall").
- **Layered single writers**: ccski state writes use same-directory temp file + fsync + rename with generation CAS (`STATE_GENERATION_CONFLICT`, kill-safe recovery, `STATE_RECOVERY_REQUIRED` degraded read-only); npm lock is read-only with raw pass-through of unknown fields and `LOCK_VERSION_UNSUPPORTED` opaque views for unknown versions.
- **CLI command face** (all with typed `--json` receipts; mutation scope defaults to `project`, `--global` switches):
  - `ccski install <dir>` — local skill directory as entity + projections; agent target set mirrors the npm:skills 1.7.1 parity fixtures (explicit `--agent`/`*`, detected + universal with registry visibility filtering, no-detection `--yes` registry fallback, per-agent partial-success receipts, `NO_GLOBAL_INSTALL` failure entries).
  - `ccski migrate` — adopt pre-3.0 materialized copies; dry-run by default; `--execute` is expected-hash guarded (`HASH_MISMATCH` keeps originals untouched; `NAME_COLLISION` keeps conflicts) with pre-repair backup and crash-recovery journal; `--plan` pins guard hashes to a saved dry-run plan.
  - `ccski gc` — proposes retiring state records whose roots vanished; **3.0 ships the dry-run half only** (`DRY_RUN_REQUIRED` otherwise); never deletes automatically.
  - `ccski state repair` — scan-vs-sidecar diff; `REPAIR_CONFIRM_REQUIRED` without `--confirm`; pre-repair state backup; idempotent (second run reports clean); conservative deep cleanup of crash residues (no-marker entries are kept).
  - `ccski import <path> --claim` — adopt an unregistered symlink behind exact inode + content-hash guards (`CLAIM_CONFLICT` distinguishes name conflicts from identity mismatches); state-only change, reversible; `--observe` prints the target's inode/hash.
- **Folder-hash single source for hosts**: `computeSkillFolderHash(skillDir)` exports the frozen npm:skills 1.7.1 algorithm (sorted relative paths + path bytes + file bytes, regular files only, skips `.git`/`node_modules`), pinned by versioned fixtures.
- **Field visibility contract**: list/info/MCP surfaces return domain fields only (identity/paths/provenance subset/mode/ownership/revision markers); frontmatter stays behind document-read surfaces; `--redact-paths` produces relative-path output; source URLs are sanitized (userinfo/credentials and query strings stripped) before leaving the kernel.
- **`STALE_PROJECTION` reporting**: link projections whose recorded entity revision went stale after a replace are badged in `list` and visible across surfaces.
- **Typed failure vocabulary** (finite, closed): `SCOPE_REQUIRED`, `NAME_COLLISION`, `NAME_EXISTS`, `ENTITY_REVISED`, `GUARD_ENTITY`, `GUARD_PROJECTION`, `STALE_PROJECTION`, `PINNED`, `FOREIGN_OWNERSHIP`, `TARGET_DENIED`, `SYMLINK_FAILED`, `PROJECTION_PATH_OCCUPIED`, `HASH_MISMATCH`, `CLAIM_CONFLICT`, `DRY_RUN_REQUIRED`, `REPAIR_CONFIRM_REQUIRED`, `GC_UNKNOWN_REFERENCE`, `NO_GLOBAL_INSTALL`, `SOURCE_UNSUPPORTED`, `SOURCE_NOT_FOUND`, `SOURCE_INVALID`, `STATE_GENERATION_CONFLICT`, `STATE_RECOVERY_REQUIRED`, `LOCK_VERSION_UNSUPPORTED`.

### Unchanged

- Read face: `list` / `info` / `search` / `validate` / `mcp` and the discovery API surface (`discoverSkills`, `SkillRegistry`, `parseSkillFile`, `validateSkillFile`, `loadSkill`) keep their roles, with additive kernel metadata on discovery results.
- Workflow prompt injection (`ccski install` without a source) keeps its 2.x behavior and targets.
- npm:skills 1.7.1 parity is pinned by versioned fixtures (default projection set with all branches, projection-scoped remove, lock pass-through, folder hash) and is re-run on npm CLI upgrades.

### Verification receipts (3.0.0 release gate)

- `openspec validate store-link-kernel --strict`: pass.
- `pnpm ts` (tsc --noEmit): 0 errors.
- `pnpm test`: full suite green, two consecutive runs.
- `pnpm build`: pass.
- `npm pack --dry-run`: exports surface verified (`.`, `import`, `types`; no 2.x retired export references in `dist`).
- Parity matrix: covered by the pinned fixture suite (see `pnpm test` receipts above).
- Windows runnable-environment receipt: **not obtained** — see the platform statement above.

[3.0.0]: https://github.com/jixoai/ccski/compare/v2.5.0...v3.0.0
