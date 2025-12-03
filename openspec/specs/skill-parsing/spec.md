# Capability: Skill Parsing

## Requirements

### Requirement: Validate YAML frontmatter
- SKILL files MUST start with YAML frontmatter containing non-empty `name` and `description` fields.
- Additional frontmatter fields MUST be accepted without error, and descriptions SHOULD have whitespace normalised.
#### Scenario: missing required fields
- GIVEN frontmatter missing `description`
- WHEN `validateSkillFile` runs
- THEN the result reports `success=false` with an error mentioning the missing description.

### Requirement: Enforce UTF-8 decoding
- The parser MUST decode SKILL files using UTF-8 with fatal errors; invalid byte sequences cause parsing to fail.
#### Scenario: invalid encoding
- GIVEN `SKILL.md` contains invalid UTF-8 bytes
- WHEN `parseSkillFile` runs
- THEN a `ParseError` is thrown with a suggestion to save the file as UTF-8.

### Requirement: Error reporting with suggestions
- Validation or parse failures MUST include machine-readable errors and human suggestions via `ValidationError` or `ParseError`.
#### Scenario: malformed YAML
- GIVEN frontmatter with incorrect indentation
- WHEN `parseSkillFile` runs
- THEN a `ParseError` is thrown and suggestions prompt to check the YAML fence and syntax.

### Requirement: Preserve content fidelity
- Successful parses MUST return both parsed frontmatter and the full original markdown (including frontmatter) so CLI and MCP outputs can stream the file verbatim.
#### Scenario: load skill content
- WHEN `parseSkillFile` succeeds
- THEN `content` equals the body-only markdown and `fullContent` matches the exact file text.
