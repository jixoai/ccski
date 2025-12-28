# Install APIs

## `installSkills`

```ts
const result = await installSkills({
  source: "https://github.com/wshobson/agents",
  outDir: ["./.claude/skills"],
  all: true,
});
```

### Dry-run preview

```ts
const preview = await installSkills({
  source: "./local-skill",
  outDir: ["./.claude/skills"],
  dryRun: true,
});
```

## Errors

- Throws for invalid sources or selection requirements.
- If interactive confirmation is cancelled, the CLI prints a warning; API throws `InstallCancelledError`.
