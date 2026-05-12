## Context

The old discovery model encoded `claude`, `codex`, and `file` as the complete provider universe. That made `.agents/skills`, Gemini, OpenClaw, and future agent roots look like special cases instead of first-class providers.

## Goals

- Keep provider-specific skills orthogonal by making roots declarative metadata.
- Preserve strong built-in provider knowledge for common agents.
- Allow unknown agents to appear without a ccski release.
- Keep default discovery quiet for missing roots and shallow for unknown hidden directories.

## Non-Goals

- Change install destination defaults.
- Rework Claude plugin discovery beyond provider/filter compatibility.
- Introduce deep hidden-directory crawling.

## Decisions

### Provider Model

`SkillProvider` becomes a built-in enum plus string extension. Built-ins are `agents`, `claude`, `codex`, `gemini`, `openclaw`, and `file`. Discovered `.<agent>/skills` roots use the hidden directory name without the leading dot as provider.

### Root Priority

Default discovery assigns each root a priority rank. Larger rank wins in auto dedup:

1. custom `--skill-dir` / `customDirs`
2. workspace agent-specific roots
3. workspace shared roots (`skills`, `.agents/skills`)
4. user agent-specific roots
5. user shared roots (`~/.agents/skills`)
6. plugin skills

Within the same priority rank, the newer `SKILL.md` / `.SKILL.md` mtime wins. If still tied, built-in providers sort before dynamic providers and dynamic providers sort alphabetically.

### Unknown Agent Discovery

Unknown agents are discovered only by checking immediate hidden child directories named `.<agent>` that contain a direct `skills` child. ccski must not recursively crawl arbitrary hidden trees looking for skills.
