## ADDED Requirements

### Requirement: Discover Codex skill roots
- The system SHALL scan `.codex/skills` in the current working directory and `~/.codex/skills` in the home directory when discovery runs.
- Missing Codex roots MUST be skipped without failing discovery, while diagnostics record attempted paths.
#### Scenario: project codex skills present
- GIVEN `./.codex/skills/pdf/SKILL.md`
- WHEN discovery executes with default options
- THEN `pdf` is included with location `project` and provider `codex` in the results.

## MODIFIED Requirements

### Requirement: Skill metadata includes provider
- Discovery MUST attach a `provider` field to each skill: `claude` for existing Claude roots and plugin skills, `codex` for Codex roots.
- Diagnostics SHOULD report counts per provider.
#### Scenario: mixed providers
- GIVEN one skill under `.claude/skills` and one under `.codex/skills`
- WHEN discovery completes
- THEN each result carries the correct provider and diagnostics expose per-provider counts.
