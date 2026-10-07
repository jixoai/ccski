# Install APIs

## `installCcskiWorkflow` (workflow instructions, unchanged in 3.0)

```ts
import { installCcskiWorkflow } from "ccski";

const result = installCcskiWorkflow({
  agents: ["codex", "gemini"],
  scope: "user",
});
```

Use `scope: "project"` with `projectDir` to target project instruction files.
The install is idempotent: only the managed `<workflow name="ccski">` block is
replaced.

## Skill install: the kernel two-phase API (3.0)

The 2.x `installSkills` / `installSkillDir` mutation APIs were removed. Skill
installation is now the two-phase kernel: `ensureEntity` (materialize the entity
in a scope) then `projectEntity` (link into the roots you name). Full details:
[Kernel APIs](/api/kernel).

```ts
import { ensureEntity, projectEntity } from "ccski";

const ensured = await ensureEntity({
  scope: "project",
  source: { dir: "/abs/path/to/my-skill" },
});
if (ensured.kind === "error") throw new Error(`${ensured.code}: ${ensured.message}`);

const projected = await projectEntity({
  scope: "project",
  name: ensured.entity.logicalName,
  roots: ["/abs/workspace/.claude/skills"],
});
```

Notes:

- The SDK never infers projection roots; pass them explicitly.
- Git/URL/marketplace sources are retired in 3.0 — there is no API surface for
  them (the CLI fails typed `SOURCE_UNSUPPORTED`). Acquire the directory with
  your own tooling first.
- ccski never writes npm's `.skill-lock.json`; successful receipts carry
  `lockSyncPending: true` so host flows can report lock sync honestly.

## Errors

- Domain failures are typed results (`kind: "error"` + finite codes), not
  throws: `SCOPE_REQUIRED`, `NAME_COLLISION`, `NAME_EXISTS`, `GUARD_ENTITY`,
  `TARGET_DENIED`, `SYMLINK_FAILED`, and friends.
- Workflow install without a TTY throws a plain `Error` asking for `--agent`
  instead of the interactive picker.
