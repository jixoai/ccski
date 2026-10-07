# API Documentation

The package exports a programmatic API. Alignment faces (`listSkills`,
`getSkillInfo`, `searchSkills`, `validateSkill`) mirror the CLI `--json`
output; the kernel faces return typed results with finite failure codes
instead of throwing for domain failures.

## Import

```ts
// kernel (3.0): entities + projections
import {
  ensureEntity,
  projectEntity,
  removeEntityProjections,
  deleteEntity,
  toggleEntityProjection,
  updateEntity,
} from "ccski";

// command face (3.0): migrate / gc / repair / claim
import { migrateLegacyEntries, gcPropose, repairState, claimLink } from "ccski";

// alignment face (retained)
import { listSkills, getSkillInfo, searchSkills, validateSkill } from "ccski";

// workflow + server (retained)
import { installCcskiWorkflow, startMCPServer } from "ccski";
```

Removed in 3.0: `installSkills`, `installSkillDir`, `removeSkills`,
`toggleSkills` and their option/result types — no aliases, no shims.

## Sections

- [Skill APIs](/api/skills)
- [Kernel APIs](/api/kernel)
- [Install APIs](/api/install)
- [Toggle APIs](/api/toggle)
- [MCP APIs](/api/mcp)
- [Types](/api/types)

## List

```ts
const skills = await listSkills({
  include: ["all"],
  scanDefaultDirs: true,
});
```

## Info

```ts
const info = await getSkillInfo({
  name: "codex:pdf",
  full: false,
});
```

## Search

```ts
const matches = await searchSkills({
  query: "api",
  content: true,
  limit: 10,
});
```

## Validate

```ts
const result = await validateSkill({
  path: "./skills/pdf",
});
```

## Kernel install (two-phase)

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

See [Kernel APIs](/api/kernel) for the full contract (typed failures, downgrade
rules, entity-local receipts, guards).

## Workflow install

```ts
const workflow = installCcskiWorkflow({
  agents: ["codex"],
  scope: "user",
});
```

## Toggle

```ts
import { toggleEntityProjection } from "ccski";

await toggleEntityProjection({
  scope: "project",
  name: "pdf",
  root: "/abs/workspace/.claude/skills",
  action: "disable",
});
```

## MCP

```ts
await startMCPServer({
  transport: "http",
  port: 3333,
});
```

## Types

All result types and option interfaces are exported from the package. See
[Types](/api/types) for the common ones.
