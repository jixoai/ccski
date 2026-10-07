# Toggle APIs

The 2.x `toggleSkills` API was removed in 3.0. Projection toggling is now the
kernel API `toggleEntityProjection` — one call per projection root, scoped and
guarded. Full details: [Kernel APIs](/api/kernel).

## `toggleEntityProjection`

```ts
import { toggleEntityProjection } from "ccski";

// disable: link = unlink + state record (physically effective)
await toggleEntityProjection({
  scope: "project",
  name: "pdf",
  root: "/abs/workspace/.claude/skills",
  action: "disable",
});

// enable: rebuild the link after the ENTITY_REVISED gate
await toggleEntityProjection({
  scope: "project",
  name: "pdf",
  root: "/abs/workspace/.claude/skills",
  action: "enable",
});
```

## Semantics

- Link projections: disable physically unlinks; enable verifies the recorded
  entity revision first (mismatch fails typed `ENTITY_REVISED`).
- Materialized copies keep the legacy `.SKILL.md` rename convention, labeled
  `convention: "ccski-legacy"`.
- External live-links fail typed `FOREIGN_OWNERSHIP` — they are read-only.

## Errors

Domain failures are typed results (`kind: "error"` + finite codes), not throws:
`SCOPE_REQUIRED`, `ENTITY_REVISED`, `FOREIGN_OWNERSHIP`, and friends.
