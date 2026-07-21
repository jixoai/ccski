# Change: Expose Provider-Scoped Custom Discovery

## Why

Applications embedding ccski need to discover one provider-owned skill root without
reclassifying it as the generic `file` provider. The core supports this address, but
the programmatic API currently hides it behind CLI-shaped `skillDir` input.

## What Changes

- Add `customDirs` and `customProvider` to programmatic registry inputs.
- Preserve `skillDir` as the CLI compatibility input and its current `file` default.
- Verify `listSkills()` returns the supplied Provider label for a custom root.

## Impact

- Affected specs: `skill-discovery`
- Affected code: `src/utils/registry-options.ts`, public API option types, API tests
