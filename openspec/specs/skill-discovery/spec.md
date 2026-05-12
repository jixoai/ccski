# Capability: Skill Discovery

## Purpose

Define how ccski discovers SKILL.md directories across project, user, custom, and provider-specific roots while preserving deterministic metadata and diagnostics.

## Requirements

### Requirement: Discover default skill roots

- The system SHALL scan default roots as declarative provider roots rather than a fixed Claude/Codex-only list.
- The system SHALL include user shared skills at `~/.agents/skills` with provider `agents`.
- The system SHALL include user agent-specific roots `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`, and `~/.openclaw/skills` with providers matching the directory name.
- The system SHALL include workspace shared roots `<workspace>/skills` and `<workspace>/.agents/skills` with provider `agents`.
- The system SHALL include workspace agent-specific roots `<workspace>/.claude/skills`, `<workspace>/.codex/skills`, `<workspace>/.gemini/skills`, and `<workspace>/.openclaw/skills` with providers matching the directory name.
- Workspace source priority SHALL rank `<workspace>/.<agent>/skills` above `<workspace>/.agents/skills`, and `<workspace>/.agents/skills` above `<workspace>/skills`.
- The system SHALL discover unknown agent providers by scanning only immediate hidden children named `.<agent>/skills` under the workspace and user directory; it MUST NOT recursively crawl hidden directories looking for skills.
- Missing directories MUST NOT fail discovery; they are skipped while diagnostics record the attempted path.
- Discovery MUST collect all matching skills. Duplicate selection is resolved by include/filter logic, while discovery diagnostics record duplicate skill names as conflicts.

#### Scenario: default roots include shared and popular agents

- GIVEN skills exist at `~/.agents/skills/shared/SKILL.md`, `~/.gemini/skills/planner/SKILL.md`, and `<workspace>/.openclaw/skills/review/SKILL.md`
- WHEN discovery runs with default options
- THEN all three skills are returned
- AND their providers are `agents`, `gemini`, and `openclaw`.

#### Scenario: shallow unknown agent discovery

- GIVEN `<workspace>/.myagent/skills/a/SKILL.md` exists
- AND `<workspace>/.cache/nested/skills/b/SKILL.md` exists
- WHEN discovery runs with default options
- THEN provider `myagent` skill `a` is returned
- AND the nested cache skill is not discovered.

### Requirement: Custom directories

- The tool SHALL accept `customDirs`/`--skill-dir` to prepend additional roots ahead of defaults. Custom directories default to provider `file` and scope `other:<name>` unless overridden.
- Custom directories MUST be treated as highest priority and scanned recursively for nested skills.

#### Scenario: custom dir overrides default

- GIVEN `--skill-dir /tmp/skills` containing `bar`
- AND a lower-priority `bar` in `~/.claude/skills`
- WHEN discovery runs
- THEN `bar` from `/tmp/skills` is returned and the home copy is recorded as a conflict.

### Requirement: Disabled skills handling

- Discovery SHALL recognise both `SKILL.md` and `.SKILL.md` (disabled) files within a skill folder.
- When both exist, a conflict MUST be recorded; inclusion of disabled entries is controlled by the `includeDisabled` flag used by CLI `--all/--disabled`.
- By default disabled skills are excluded from results.

#### Scenario: disabled skill listing

- GIVEN `.SKILL.md` exists in a skill folder and `includeDisabled` is true
- WHEN discovery runs
- THEN the skill is returned with `disabled=true` while enabled skills remain present.

### Requirement: Bundled resource flags

- Discovery SHALL set boolean flags for `references/`, `scripts/`, and `assets/` subdirectories on each skill.

#### Scenario: resource detection

- GIVEN `foo/scripts` and `foo/assets` exist
- WHEN discovery runs
- THEN the returned metadata has `hasScripts=true`, `hasAssets=true`, `hasReferences=false`.

### Requirement: Diagnostic resilience

The system SHALL continue discovery when a scanned root, skill file, or external registry entry cannot be read or parsed, and SHALL expose the problem as structured diagnostics without writing directly to stdout or stderr from core discovery modules.

#### Scenario: unreadable directory

- **WHEN** a configured skill directory cannot be scanned
- **THEN** discovery continues for remaining roots
- **AND** diagnostics include the failed directory and reason
- **AND** core discovery does not call `console.warn`, `console.info`, or `console.error`

#### Scenario: programmatic diagnostics

- **WHEN** a caller reads registry diagnostics
- **THEN** diagnostics include severity, source, code, message, and optional details for structured inspection

### Requirement: Skill metadata includes provider

- Discovery MUST attach a `provider` field to each skill using built-in providers `agents`, `claude`, `codex`, `gemini`, `openclaw`, and `file` when applicable.
- Dynamically discovered `.<agent>/skills` roots MUST use the agent directory name without the leading dot as provider.
- Claude plugin skills continue to use provider `claude` and location `plugin`.
- Diagnostics SHOULD report counts per provider without assuming a closed provider set.

#### Scenario: mixed built-in and dynamic providers

- GIVEN skills exist under `.agents/skills`, `.gemini/skills`, and `.myagent/skills`
- WHEN discovery completes
- THEN each result carries provider `agents`, `gemini`, or `myagent`
- AND diagnostics expose per-provider counts for all three providers.

### Requirement: User directory override for discovery

- Discovery SHALL resolve user-level default roots relative to a configurable user directory parameter (defaulting to the actual home directory). This includes `~/.agents/skills`, built-in user agent roots such as `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`, `~/.openclaw/skills`, and shallow dynamic `~/.<agent>/skills` roots.
- When provided, diagnostics MUST record the resolved paths and scanning behavior MUST honor the override.

#### Scenario: custom user dir

- GIVEN `userDir=/tmp/fakehome` and default scanning enabled
- WHEN discovery runs
- THEN user roots are scanned at `/tmp/fakehome/.agents/skills`, `/tmp/fakehome/.claude/skills`, `/tmp/fakehome/.codex/skills`, `/tmp/fakehome/.gemini/skills`, and `/tmp/fakehome/.openclaw/skills`.
