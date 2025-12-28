# Skill APIs

APIs for listing, inspecting, searching, and validating skills.

## `listSkills`

```ts
const skills = await listSkills({
  include: ["all"],
  scanDefaultDirs: true,
});
```

## `getSkillInfo`

```ts
const info = await getSkillInfo({
  name: "codex:pdf",
  full: false,
});
```

## `searchSkills`

```ts
const matches = await searchSkills({
  query: "api",
  content: true,
  limit: 10,
});
```

## `validateSkill`

```ts
const result = await validateSkill({
  path: "./skills/pdf",
});
```
