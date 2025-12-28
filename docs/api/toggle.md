# Toggle APIs

## `toggleSkills`

```ts
await toggleSkills("disable", { names: ["pdf"] });
await toggleSkills("enable", { names: ["pdf"] });
```

## Errors

- Selection errors throw `ToggleMultiSelectError`.
- Interactive cancel throws `ToggleCancelledError`.
