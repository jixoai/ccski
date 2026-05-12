## MODIFIED Requirements

### Requirement: Discover default skill roots

- The system SHALL scan default roots as declarative provider roots rather than a fixed Claude/Codex-only list.
- The system SHALL include user shared skills at `~/.agents/skills` with provider `agents`.
- The system SHALL include user agent-specific roots `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`, and `~/.openclaw/skills` with providers matching the directory name.
- The system SHALL include workspace shared roots `<workspace>/skills` and `<workspace>/.agents/skills` with provider `agents`.
- The system SHALL include workspace agent-specific roots `<workspace>/.claude/skills`, `<workspace>/.codex/skills`, `<workspace>/.gemini/skills`, and `<workspace>/.openclaw/skills` with providers matching the directory name.
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
