## Context

ccski's platform law is "filesystem and installed agent surfaces are inputs; ccski exposes a stable skill registry." That law breaks when an unstable external file, such as Claude Code's `installed_plugins.json`, is parsed with a single strict schema and raw validation errors are printed from core code.

## Goals / Non-Goals

- Goals: core modules return structured diagnostics, tolerate known Claude plugin manifest drift, preserve existing public metadata shapes, keep JSON/MCP output clean.
- Non-goals: redesign the skill file format, change MCP tool names, or make plugin parsing fail-fast by default.

## Decisions

- Core diagnostics are data, not output. Discovery functions collect warning/error facts and callers decide whether to render them.
- External plugin manifests are parsed as `unknown`, then normalized. Missing optional fields receive conservative defaults; missing required install paths become diagnostics.
- Compatibility warnings are concise by default. Raw parser details are only retained in diagnostics details for programmatic inspection or future verbose rendering.
- Existing `warnings` and `conflicts` arrays remain available while structured diagnostics are added, so current API consumers are not forced into a breaking migration.

## Risks

- Too much tolerance can hide real plugin corruption. Mitigation: diagnostics include skipped entry counts and source paths.
- Removing core console output may make debugging harder. Mitigation: preserve detailed messages in `getDiagnostics()`.
