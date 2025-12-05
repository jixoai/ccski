# Capability: Skill Discovery

## Requirements

### Requirement: Discover default skill roots
- The system SHALL scan, in priority order, `.agent/skills` and `.claude/skills` under the current working directory, then `~/.agent/skills` and `~/.claude/skills` in the user's home directory; it SHALL also scan `.codex/skills` and `~/.codex/skills`.
- Missing directories MUST NOT fail discovery; they are skipped while diagnostics record the attempted path.
- When duplicate skill names exist, the higher-priority directory MUST win and later duplicates MUST be recorded as conflicts; provider tags are preserved.
#### Scenario: duplicate name in project and home
- GIVEN `./.claude/skills/foo/SKILL.md` and `~/.claude/skills/foo/SKILL.md`
- WHEN discovery runs with default options
- THEN the project skill is kept and diagnostics list the skipped home copy as a conflict.

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
- Directory read or parse failures MUST NOT abort discovery; warnings are collected and exposed via diagnostics.
#### Scenario: unreadable directory
- GIVEN a skill directory cannot be read due to permissions
- WHEN discovery runs
- THEN discovery continues, adds a warning entry, and returns other skills.

### Requirement: Skill metadata includes provider
- Discovery MUST attach a `provider` field to each skill: `claude` for `.claude/.agent` roots and plugin skills, `codex` for `.codex` roots, `file` for custom roots.
- Diagnostics SHOULD report counts per provider.
#### Scenario: mixed providers
- GIVEN one skill under `.claude/skills` and one under `.codex/skills`
- WHEN discovery completes
- THEN each result carries the correct provider and diagnostics expose per-provider counts.

### Requirement: User directory override for discovery
- Discovery SHALL resolve user-level default roots (e.g., `~/.agent/skills`, `~/.claude/skills`, `~/.codex/skills`) relative to a configurable user directory parameter (defaulting to the actual home directory). When provided, diagnostics MUST record the resolved paths and scanning behavior MUST honor the override.
#### Scenario: custom user dir
- GIVEN `userDir=/tmp/fakehome` and default scanning enabled
- WHEN discovery runs
- THEN user roots are scanned at `/tmp/fakehome/.agent/skills`, `/tmp/fakehome/.claude/skills`, and `/tmp/fakehome/.codex/skills`.
