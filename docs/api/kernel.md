# Kernel APIs

The 3.0 kernel API: scoped entities + explicit projections. Domain failures come
back as typed results (`kind: "ok" | "error"` with finite failure codes), not
throws. Mutations without an explicit `scope` fail typed `SCOPE_REQUIRED`; the
SDK never infers projection roots from the environment.

```ts
import {
  ensureEntity,
  projectEntity,
  removeEntityProjections,
  deleteEntity,
  toggleEntityProjection,
  updateEntity,
  computeSkillFolderHash,
} from "ccski";
```

## `ensureEntity`

Materialize an entity in a scope and record ownership in the sidecar state.

```ts
let ensured = await ensureEntity({
  scope: "project", // explicit; missing => SCOPE_REQUIRED
  source: { dir: "/abs/path/to/my-skill" },
});
if (ensured.kind === "error" && ensured.code === "NAME_EXISTS" && ensured.existing) {
  // explicit same-name replace: requires the current entity's revision
  ensured = await ensureEntity({
    scope: "project",
    source: { dir: "/abs/path/to/my-skill" },
    replace: { expectedRevision: ensured.existing.expectedRevision },
  });
}
```

- `folderName` derives from the SKILL.md `name` via the frozen npm:skills 1.7.1
  sanitize; collisions fail typed `NAME_COLLISION`.
- Successful results carry `status: "created" | "exists" | "replaced"`, the
  entity snapshot, the state generation, and `lockSyncPending: true` (ccski
  never writes npm's lock).
- Replace failures roll back from backup — the old entity remains usable.

## `projectEntity`

Create projections only into the roots you name.

```ts
const projected = await projectEntity({
  scope: "project",
  name: ensured.kind === "ok" ? ensured.entity.logicalName : "my-skill",
  roots: ["/abs/workspace/.claude/skills", "/abs/workspace/.codex/skills"],
  // mode defaults to "link"; "materialized" requires an explicit reason:
  // "pinned" | "imported-root" | "user-request" (never automatic)
  // strict: true fails link-only without downgrade
});
```

Per-root receipts report the normalized `mode` (`link` | `materialized` |
`entity-local`) and `reason`:

- Automatic downgrade happens only for `symlink-unavailable`
  (`EPERM`/`ENOSYS`/`EXDEV`/unsupported junction). Target-level permission
  failures fail typed `TARGET_DENIED` with no silent copy.
- A root that normalizes to the scope's own entity root returns
  `targetKind: "entity"`, `mode: "entity-local"`, `reason: "canonical-root"`,
  with `path === canonicalPath === entityPath`: no symlink, no copy, no extra
  projection record; repeated calls are idempotent.
- Reporting `link` with a failed symlink is forbidden — failed roots carry no
  `mode`.

## `removeEntityProjections`

Projection-first removal. Link projections are unlinked (never deleted
through); materialized copies are deleted behind their own inode/content guard
(`GUARD_PROJECTION`). Entity GC happens only when no ccski-owned reference
remains among all registered roots; unknown references keep the entity with a
typed `GC_UNKNOWN_REFERENCE` warning while the projection removal still
succeeds.

```ts
const removed = await removeEntityProjections({
  scope: "project",
  name: "my-skill",
  roots: ["/abs/workspace/.claude/skills"],
});
```

## `deleteEntity`

Delete the entity itself behind a revision guard (`GUARD_ENTITY`).

```ts
const deleted = await deleteEntity({
  scope: "project",
  name: "my-skill",
  expectedRevision: entityRevision, // mismatch keeps the entity untouched
  // roots: optional extra roots for reference re-verification
});
```

## `toggleEntityProjection`

Physical disable / gated re-enable of a single projection.

```ts
await toggleEntityProjection({
  scope: "project",
  name: "my-skill",
  root: "/abs/workspace/.claude/skills",
  action: "disable", // link: unlink + state record; physically effective
});
await toggleEntityProjection({
  scope: "project",
  name: "my-skill",
  root: "/abs/workspace/.claude/skills",
  action: "enable", // fails typed ENTITY_REVISED if the entity moved on
});
```

Materialized copies keep the legacy `.SKILL.md` rename convention, labeled
`convention: "ccski-legacy"`. Link projections never carry a second identity
file.

## `updateEntity`

Swap the entity at its stable path (staging + same-scope rename), so existing
link projections resolve to new content without recreation. Materialized copies
are re-materialized per copy behind their own hash guard; pinned copies are
skipped with typed `PINNED`. Partial success is the norm — there is no "atomic
reinstall".

```ts
const updated = await updateEntity({
  scope: "project",
  name: "my-skill",
  source: { dir: "/abs/path/to/my-skill-v2" },
  expectedRevision: entityRevision, // optional guard; mismatch => GUARD_ENTITY
});
```

## `computeSkillFolderHash`

The single frozen npm:skills 1.7.1 folder-hash implementation, exported for host
consumption (sorted relative paths + path bytes + file bytes, regular files
only, skips `.git`/`node_modules`).

```ts
const hash = await computeSkillFolderHash("/abs/path/to/skill-dir");
```
