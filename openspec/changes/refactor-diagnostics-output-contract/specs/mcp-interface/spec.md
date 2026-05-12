## MODIFIED Requirements

### Requirement: Skill tool listing

The MCP server SHALL build the skill tool listing from the shared registry and SHALL NOT expose raw discovery parser stacks in the tool description.

#### Scenario: no skills found

- **WHEN** the registry contains no skills
- **THEN** the tool description still includes an empty available-skills block

#### Scenario: plugin manifest drift

- **WHEN** plugin discovery records compatibility diagnostics
- **THEN** the skill tool description lists available skills without raw parser stacks
