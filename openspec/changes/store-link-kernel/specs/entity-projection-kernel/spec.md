# Capability: Entity-Projection Kernel

## ADDED Requirements

### Requirement: Scope-aware entity layer
The package SHALL maintain a canonical entity layer per scope: global entities under `$HOME/.agents/skills/<folderName>`, project entities under `<workspace>/.agents/skills/<folderName>`. `folderName` SHALL be derived from the logical skill name by a frozen sanitize algorithm (lowercase; spaces/underscores to hyphens; other characters to hyphens; matching npm:skills behavior). Two logical names sanitizing to the same folderName MUST be rejected with typed `NAME_COLLISION`. Mutations without an explicit scope MUST be rejected with typed `SCOPE_REQUIRED`; no implicit scope precedence or dual view exists in the SDK.

#### Scenario: Scope required for mutation
- **WHEN** a consumer calls any mutating API without an explicit `scope`
- **THEN** the call fails with typed `SCOPE_REQUIRED` and no filesystem or state change occurs.

#### Scenario: Sanitize collision rejection
- **WHEN** two distinct logical names sanitize to the same folder name within one scope
- **THEN** the second install attempt fails with typed `NAME_COLLISION` and the first entity is untouched.

### Requirement: Layered single writers for lock and state
The package MUST NOT write npm:skills `.skill-lock.json` (sole writer: skills CLI); it MAY read it for provenance with raw pass-through of unknown fields (parse must preserve unknown keys; unknown lock versions degrade read-only and MUST NOT be treated as empty). ccski-owned accounting lives in `scopeBase/.ccski-state.json` (sole writer: ccski) recording entity ownership, projections (`scope`/`rootId`/`path`/`mode`/`entityRevision`/`disabled`/`ownership`), folder hash, and a monotonic generation. State writes MUST use same-directory temp file + fsync + rename with generation compare-and-swap: a writer observing a changed generation MUST re-read and refuse blind overwrite. Corrupt or unknown-version state degrades read-only with typed `STATE_RECOVERY_REQUIRED`.

#### Scenario: Unknown lock version is a read-only opaque view
- **WHEN** the npm lock file reports an unknown `version`
- **THEN** provenance reading returns an opaque read-only view marked `LOCK_VERSION_UNSUPPORTED` that MUST NOT be usable for mutation and MUST NOT be mistakable for an empty, replaceable lock.

#### Scenario: Concurrent state write loses cleanly
- **WHEN** two ccski processes mutate state and the second commits with a stale generation
- **THEN** the second writer fails with typed `STATE_GENERATION_CONFLICT`, re-reads, and no interleaved write is lost silently.

### Requirement: Two-phase install with explicit projections
`ensureEntity({scope, source…})` SHALL materialize the entity and record ownership in state; `projectEntity({entity, roots[], mode})` SHALL create projections only for explicitly provided roots. The SDK MUST NOT infer projection roots from the environment. Default `mode` is `link` (symlink to the entity path); `materialized` requires an explicit reason from the frozen set. Automatic downgrade to materialized is allowed ONLY for `symlink-unavailable` (symlink syscall failure classes: `EPERM`/`ENOSYS`/`EXDEV`/unsupported junction); target-level permission failures (`EACCES` on the projection root) MUST fail with typed `TARGET_DENIED` and no silent copy. Results MUST return the normalized `mode` and `reason`; reporting `link` with a failed symlink is forbidden. A strict option MUST fail link-only without fallback.

#### Scenario: EPERM on symlink syscall downgrades honestly
- **WHEN** `symlink()` fails with `EPERM` in a default-mode projection
- **THEN** the result reports `mode="materialized", reason="symlink-unavailable"` and the state records the same.

#### Scenario: Target denial does not silently copy
- **WHEN** writing into the projection root fails with `EACCES`
- **THEN** the projection fails with typed `TARGET_DENIED` and no materialized copy is created.

### Requirement: First-class symlink discovery
The discovery layer SHALL treat top-level directory symlinks as first-class entries: `lstat` detection, single-level `realpath` resolution, and metadata carrying `canonicalPath`, `entryKind`, and `ownership` (`ccski`/`external`/`unknown`). Recursive descent MUST NOT follow symlinks below the top level. Broken links produce typed omissions with diagnostics, never silent misses. Reserved names `.ccski-staging-*` and `.ccski-backup-*` are skipped by discovery; startup cleanup deletes only residues carrying a ccski ownership marker and satisfying age/generation conditions. Mutation surfaces MUST distinguish projection paths from entity paths via `canonicalPath`.

#### Scenario: Broken projection link is a typed omission
- **WHEN** a root contains a top-level symlink whose target no longer exists
- **THEN** list reports a diagnostic omission entry (not a silent gap) and mutation of it fails typed.

#### Scenario: External live-link is read-only
- **WHEN** discovery finds a symlink whose target is not a ccski-owned entity
- **THEN** the entry is listed with `ownership:"external"` and any remove/update/toggle against it fails typed `FOREIGN_OWNERSHIP`.

### Requirement: Physical disable semantics
For link projections, `disable(root, name)` SHALL verify ccski ownership, unlink the projection, and record `disabled=true` in state — a sidecar boolean alone is never a disable proof. `enable` SHALL recreate the link after verifying the recorded `entityRevision` still matches the entity (mismatch returns typed `ENTITY_REVISED` suggesting update). Shared entities always keep enabled-form `SKILL.md`; link-mode toggle MUST NOT create a second identity file. Materialized copies MAY keep the legacy `.SKILL.md` rename convention, and results MUST label it `convention:"ccski-legacy"` (not an npm:skills semantic).

#### Scenario: Link disable is physically effective
- **WHEN** a link projection is disabled
- **THEN** the symlink no longer exists in that root, state marks it disabled, and other roots' projections are unaffected.

#### Scenario: Enable after entity replacement
- **WHEN** enabling a projection whose recorded entity revision no longer matches the entity
- **THEN** the call fails typed `ENTITY_REVISED` and the projection remains disabled.

### Requirement: Ownership-first removal and entity GC
`remove` SHALL operate projection-first: link projections are unlinked (never recursively removed through a link), materialized projections delete their directory with the copy's own revision/inode guard failing typed `GUARD_PROJECTION` on mismatch (external replacement of a projection path mid-flight MUST be detected, never deleted as if owned). Entity replacement and entity-affecting mutations MUST be guarded by the entity's expected revision, failing typed `GUARD_ENTITY` on mismatch. Entity and provenance cleanup happens only when state has no active projection AND no ccski-owned reference exists among all registered roots (lstat/realpath verified) AND no unknown reference exists (unknown references keep the entity with a typed warning). External live-links never count toward deletion authority.

#### Scenario: Replaced projection path is refused
- **WHEN** a materialized projection's on-disk inode/content no longer matches its recorded guard
- **THEN** deletion fails typed `GUARD_PROJECTION` and the path is left untouched.

#### Scenario: Entity revision guard on replace
- **WHEN** a replace is requested with an `expectedRevision` that no longer matches the entity
- **THEN** the mutation fails typed `GUARD_ENTITY` and the entity is untouched.

#### Scenario: Last projection removal GCs the entity
- **WHEN** the final ccski-owned projection of an entity is removed and no references remain
- **THEN** the entity directory is deleted and state/provenance entries are retired.

#### Scenario: Unknown reference blocks GC
- **WHEN** an unregistered root contains a symlink to the entity
- **THEN** the entity is preserved, the removal result carries a typed warning, and the projection removal itself still succeeds.

### Requirement: Stable-path entity update
Entity update SHALL swap the entity directory in place (staging + same-scope rename) so existing link projections resolve to the new content without recreation. Materialized projections are NOT affected by entity swap; their update is per-copy re-materialization guarded by the copy's own hash, and projections pinned to a source ref + folder hash are skipped with typed `PINNED`. Partial success is the norm; the word "atomic reinstall" MUST NOT appear in API or docs.

#### Scenario: Entity swap preserves projections
- **WHEN** an entity is updated via directory swap
- **THEN** existing symlinks require no recreation and resolve to the new revision.

#### Scenario: Pinned projection is skipped
- **WHEN** updating a materialized projection recorded as pinned
- **THEN** the item is skipped with typed `PINNED` and the copy is untouched.

### Requirement: Frozen same-name replace state machine
Installing a logical name that already exists with a different source MUST fail typed `NAME_EXISTS` unless an explicit `replace` with `expectedRevision` of the current entity is provided. A replace: swaps entity content at the stable path (with backup restore on failure — the old entity remains usable), refreshes state revision/provenance, preserves per-projection `disabled` records, marks link projections' recorded revisions stale (next verify reports `STALE_PROJECTION`; links resolve to new content by path semantics), leaves materialized and pinned copies untouched, never touches external live-links, and does not write npm lock (host update flows report `lockSyncPending`).

#### Scenario: Unforced same-name install is rejected
- **WHEN** installing an existing logical name from a different source without `replace`
- **THEN** the call fails typed `NAME_EXISTS` and the existing entity is untouched.

#### Scenario: Replace failure restores
- **WHEN** an entity swap fails mid-replace
- **THEN** the backup is restored, the old entity remains usable, and state records the failed generation.

### Requirement: Explicit claim, repair, and gc contracts
`import --claim` SHALL adopt a foreign symlink as a ccski projection only with the target's expected inode and content hash; name conflicts MUST fail typed `CLAIM_CONFLICT`; a claim MUST touch state only (filesystem unchanged) and MUST be reversible by state revert. `state repair` MUST compare a filesystem scan against sidecar, print a diff, require `--confirm` (absent confirmation it fails typed `REPAIR_CONFIRM_REQUIRED`), write a pre-repair state backup, and be idempotent (a second run is a no-op reporting clean). `gc --dry-run` MUST propose cleaning state records whose roots vanished and MUST NOT delete automatically; GC-blocking unknown references surface as typed `GC_UNKNOWN_REFERENCE` warnings. These commands MUST return typed results with finite failure vocabularies.

#### Scenario: Repair is idempotent
- **WHEN** `state repair --confirm` runs twice
- **THEN** the second run reports clean without writing state.

#### Scenario: Claim requires exact identity
- **WHEN** claiming a foreign link whose target inode or hash differs from expectations
- **THEN** the claim fails typed and no state change occurs.

### Requirement: Field visibility contract
Surfaces (CLI stdout, MCP tools, list/info projections) SHALL return only domain fields: name, description, folder/scope identities, paths, source provenance (source/sourceType/sourceUrl/skillPath/updatedAt), mode/ownership/revision markers. Source URLs in any provenance subset MUST be sanitized: credentials/userinfo and query strings stripped before leaving the kernel. They MUST NOT return: environment or home metadata beyond explicit path fields, raw lock content beyond the provenance subset, tokens, or file contents (file contents only via explicit file-read paths). Frontmatter fields appear only through document/file-read surfaces, never duplicated into list projections. CLI provides `--redact-paths` producing relative-path-only output for paste/log scenarios. MCP tool results carry the same field set as RPC (transport gating is not a privacy boundary and is documented as such).

#### Scenario: List projection omits frontmatter payload
- **WHEN** list/info projections are rendered on any surface
- **THEN** only identity/provenance/mode fields appear; SKILL.md frontmatter body is not embedded.

#### Scenario: Redacted CLI output
- **WHEN** `--redact-paths` is passed to list/info
- **THEN** output contains no absolute paths.

#### Scenario: Source URL sanitization
- **WHEN** a source URL recorded in provenance contains userinfo/credentials (e.g. `https://user:token@github.com/org/repo.git`) or query strings (e.g. `https://github.com/org/repo.git?token=abc`)
- **THEN** the surfaced `sourceUrl` strips userinfo and query string, leaving the sanitized origin URL.

### Requirement: npm:skills parity pinned by versioned fixtures
The four empirical behaviors (default projection set with all branches: detected+universal, universal filtered by registry visibility fields (e.g. `showInUniversalList`), no-detection `--yes` registry fallback, per-agent partial success with typed per-agent receipts, and no-global-install agent failure entries; projection-scoped remove with entity/lock GC on last reference; lock unknown-field pass-through; `.SKILL.md` not being an npm semantic) SHALL be frozen as parity tests pinned to skills@1.7.1, re-run on npm CLI upgrades. Folder-hash parity SHALL use frozen fixture trees with pinned inputs and expected digests (algorithm: sorted relative paths + path bytes + file bytes, regular files only, skip `.git`/`node_modules`, matching npm 1.7.1), and ccski SHALL export the single folder-hash implementation for host consumption.

#### Scenario: Registry visibility filtering is pinned
- **WHEN** the parity suite projects to universal agents under a registry where visibility fields exclude one
- **THEN** the excluded agent receives no projection and the per-agent receipts match the frozen 1.7.1-observed semantics.

#### Scenario: Parity fixture pins projection fallback
- **WHEN** the parity suite simulates no-detection non-interactive install
- **THEN** the CLI's per-agent receipts match the frozen 1.7.1-observed semantics including registry fallback and partial success.

#### Scenario: Hash fixture digest match
- **WHEN** the frozen fixture tree is hashed
- **THEN** the digest equals the pinned expected value derived from npm 1.7.1 output.

### Requirement: Versioned breaking release and legacy migration
The kernel change SHALL ship as a major version (3.0.0): install from single-root materialization to entity+projection, first-class symlink discovery, and link-mode toggle/remove behavior changes are breaking boundaries that MUST NOT be backported into 2.x. Pre-existing materialized directories SHALL, on first discovery, be marked `materialized + legacy-unknown` and preserved as-is without auto-conversion. A `migrate` command SHALL provide `--dry-run` output listing name collisions, hashes, target entities, planned projections, and affected roots; execution MUST require matching expected hashes, MUST keep conflicting originals untouched with typed results, and MUST be recoverable from backup/journal.

#### Scenario: Legacy directory is never auto-converted
- **WHEN** discovery finds a pre-3.0 materialized skill directory
- **THEN** it is listed as `materialized` with provenance `legacy-unknown` and no link or entity is created without an explicit migrate.

#### Scenario: Migration conflict keeps the original
- **WHEN** a migrate execution encounters a name collision or hash mismatch on a legacy copy
- **THEN** that copy is left untouched with a typed result and other migrations continue.
