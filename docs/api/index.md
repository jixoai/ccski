# API Documentation

The package exports a programmatic API that mirrors CLI functionality. Each function returns the same structure as the CLI `--json` output.

## Import

```ts
import {
  listSkills,
  getSkillInfo,
  searchSkills,
  validateSkill,
  installSkills,
  installCcskiWorkflow,
  toggleSkills,
  startMCPServer,
} from "ccski";
```

## Error and warning behavior

- If the CLI would error/exit, the API throws.
- If the CLI would only warn, the API returns warnings in the result payload.

## Sections

- [Skill APIs](/api/skills)
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

## Install

```ts
const result = await installSkills({
  source: "https://github.com/wshobson/agents",
  outDir: ["./.claude/skills"],
  all: true,
});
```

Dry-run preview:

```ts
const preview = await installSkills({
  source: "./local-skill",
  outDir: ["./.claude/skills"],
  dryRun: true,
});
```

Workflow install:

```ts
const workflow = installCcskiWorkflow({
  agents: ["codex"],
  scope: "user",
});
```

## Toggle

```ts
await toggleSkills("disable", { names: ["pdf"] });
await toggleSkills("enable", { names: ["pdf"] });
```

## MCP

```ts
await startMCPServer({
  transport: "http",
  port: 3333,
});
```

## Types

All result types and option interfaces are exported from the package. See `src/api/types.ts` for the full list.
