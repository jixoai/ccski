## ADDED Requirements

### Requirement: Codex compatibility validation
- The validator SHALL provide a Codex mode that enforces: name length ≤100 characters, description length ≤500 characters, both fields single-line, and emits warnings for SKILL.md files or directories that are symlinks.
- Codex mode MUST run alongside existing frontmatter checks; failures MUST be reported with explicit Codex rule references.
#### Scenario: multiline description
- WHEN validating a skill in Codex mode whose description spans multiple lines
- THEN validation fails and the error cites the single-line Codex requirement.
