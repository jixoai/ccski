# ccski - Claude Code Skills Manager

## Project Overview

**ccski** is a command-line tool that provides Claude Code's skills management capabilities for any AI coding agent. It supports both CLI and MCP (Model Context Protocol) interfaces to enable skill discovery, loading, and management.

## Core Concepts

### What are Skills?

Skills are markdown files (SKILL.md) containing specialized knowledge, workflows, and instructions that can be dynamically loaded into an AI agent's context when needed. This follows the "progressive disclosure" pattern - skills are discovered but not loaded until actually needed, preserving context window.

### Skill Structure

```
skill-name/
 SKILL.md           # Main skill file with frontmatter
 references/        # Optional: supporting documentation
 scripts/          # Optional: helper scripts
 assets/           # Optional: templates, configs
```

**SKILL.md Format:**
```markdown
---
name: skill-name
description: Brief description of what this skill does
---

# Skill Instructions

Detailed instructions for the AI agent...
```

## Skill Discovery Directories

Skills are discovered from multiple directories in priority order (first match wins):

1. `$PWD/.agent/skills/` - Project-specific universal skills
2. `$PWD/.claude/skills/` - Project-specific Claude Code skills
3. `~/.agent/skills/` - Global universal skills
4. `~/.claude/skills/` - Global Claude Code skills
5. `~/.claude/plugins/marketplaces/*/skills/` - Plugin marketplace skills (only for list, read from installPath)

**Priority Resolution:** If the same skill name exists in multiple directories, the one from the higher priority directory wins.

## Plugin Marketplace Skills

Plugin skills are managed through Claude Code's plugin system:

- **Location:** `~/.claude/plugins/`
- **Registry:** `~/.claude/plugins/installed_plugins.json`
- **Structure:** Each plugin has:
  ```json
  {
    "plugin-name@marketplace": {
      "version": "...",
      "installPath": "/path/to/plugin/",
      "gitCommitSha": "...",
      "isLocal": true
    }
  }
  ```
- **Skills Discovery:** Recursively search `<installPath>/**/SKILL.md`
- **Naming Convention:** `<skill-name>` or `<plugin-name>:<skill-name>` (fully qualified)

## Command-Line Interface

CLI commands are designed for **human users** to manage and inspect skills. For AI agent consumption, use `ccski mcp`.

### Core Commands

```bash
# List all available skills
ccski list [--format=table|json]

# Show skill details (metadata + content preview)
ccski info <skill-name>

# Search for skills by keyword
ccski search <query>

# Validate skill format
ccski validate <path-to-SKILL.md>

# Start MCP server (for AI agents)
ccski mcp [--skill-dir <additional-dir>]
```

### Command Details

**`ccski list`** - List all discovered skills
```bash
ccski list                  # Table format (default)
ccski list --format=json    # JSON format for scripting
```

**`ccski info <skill-name>`** - Show skill details
```bash
ccski info user             # Show metadata + content preview
ccski info --full user      # Show full content (for debugging)
```

Output includes:
- Name, description, location, path
- File size, has references/scripts/assets
- Content preview (first 20 lines)

**`ccski search <query>`** - Search skills by keyword
```bash
ccski search "pdf"          # Search in name and description
ccski search --content "api"  # Also search in skill content
```

**`ccski validate <path>`** - Validate skill format
```bash
ccski validate ./my-skill/SKILL.md
ccski validate ~/.claude/skills/user/
```

Checks:
- YAML frontmatter syntax
- Required fields (name, description)
- File encoding (UTF-8)

### Output Formats

**Table Format (default):**
```
NAME                    DESCRIPTION                           LOCATION
────────────────────────────────────────────────────────────────────────
user                    用户的全局技能，必读！                  user
bun                     Bun 文档增强技能                       user
example-skills:pdf      PDF manipulation toolkit              plugin
```

**JSON Format:**
```json
{
  "skills": [
    {
      "name": "user",
      "description": "用户的全局技能，必读！",
      "location": "user",
      "path": "/Users/kzf/.claude/skills/user",
      "hasReferences": false,
      "hasScripts": false,
      "hasAssets": false
    }
  ]
}
```

## MCP Server Interface

MCP (Model Context Protocol) is the **primary interface for AI agents** to discover and load skills. The server communicates via stdio protocol and requires no authentication.

```bash
# Start MCP server
ccski mcp [--skill-dir <additional-dir>]

# Example: Add custom skill directory
ccski mcp --skill-dir ~/.claude/plugins

# Example: Integration with Claude Code
claude mcp add --transport stdio ccski -- npx ccski mcp
```

### MCP Tools

**Tool: `skill`**

The skill tool dynamically generates its description to include all available skills, enabling AI agents to discover capabilities without additional calls.

```typescript
{
  name: "skill",
  description: `Load a skill by name to get specialized instructions.

Available skills:
- user: 用户的全局技能，必读！
- bun: Bun 文档增强技能
- example-skills:pdf: PDF manipulation toolkit
...

Usage: Invoke with the skill name to load its full content.`,
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The skill name to load (case-insensitive)"
      }
    },
    required: ["name"]
  }
}
```

**Response Format:**
```
Loading: user
Base directory: /Users/kzf/.claude/skills/user

---
name: user
description: 用户的全局技能，必读！
---

[Full SKILL.md content...]
```

### MCP Resources (Optional)

Resources provide an alternative way to access skills:

**`skill://list`** - List all available skills
```xml
<available_skills>
<skill>
<name>user</name>
<description>用户的全局技能，必读！</description>
<location>user</location>
<path>/Users/kzf/.claude/skills/user</path>
</skill>
...
</available_skills>
```

**`skill://<skill-name>`** - Read skill content directly
- URI: `skill://user`, `skill://example-skills:pdf`
- Returns: Full SKILL.md content with base directory

### Skill Refresh

- Skills are cached at server startup
- Cache refreshes every **30 seconds** to detect changes
- New skills, modifications, and deletions are automatically detected

## Functional Requirements

### FR-001: Skill Discovery
- MUST scan directories in priority order
- MUST skip non-existent directories gracefully
- MUST handle permission errors gracefully
- MUST detect SKILL.md files in subdirectories
- MUST support plugins from installed_plugins.json

### FR-002: Skill Parsing
- MUST parse YAML frontmatter (between `---` markers)
- MUST extract `name` and `description` fields
- MUST reject skills missing required fields
- MUST support multi-line descriptions
- MUST preserve skill content exactly (no modifications)

### FR-003: Name Matching
- MUST perform case-insensitive matching (Git = git = GIT)
- MUST support plugin namespace (`example-skills:pdf`)
- MUST support short names when unambiguous (`pdf` → `example-skills:pdf`)
- MUST error on ambiguous short names

### FR-004: MCP Interface (Primary for AI Agents)
- MUST communicate via stdio protocol
- MUST NOT require authentication
- MUST provide `skill` tool with dynamic description listing all skills
- MUST refresh skill list every 30 seconds
- MUST handle concurrent requests safely
- MUST include base directory in skill response
- SHOULD provide MCP resources as alternative access method

### FR-005: CLI Interface (For Human Users)
- MUST provide clear error messages
- MUST support `--help` for all commands
- MUST support `--version` flag
- MUST output to stdout (content) and stderr (diagnostics)
- MUST exit with appropriate codes (0=success, 1=error)
- Commands: `list`, `info`, `search`, `validate`, `mcp`

### FR-006: Skill Content
- MUST return full markdown content
- MUST include base directory path
- MUST preserve original formatting
- MUST support bundled resources (references/, scripts/, assets/)

### FR-007: Error Handling
- MUST provide helpful error messages
- MUST suggest similar skill names on "not found"
- MUST validate frontmatter format
- MUST report file read errors clearly

## Technical Architecture

### Technology Stack
- **Language:** TypeScript
- **Runtime:** Node.js (via tsx for development)
- **Build Tool:** tsdown/rolldown for bundling
- **Package Manager:** pnpm
- **Testing:** vitest + jsdom

### Project Structure
```
ccski/
 src/
    cli/           # CLI commands implementation
    mcp/           # MCP server implementation
    core/          # Core skill discovery & parsing
    types/         # TypeScript type definitions
    utils/         # Shared utilities
 tests/
    unit/          # Unit tests
    integration/   # Integration tests
 references/        # Reference implementations
    openskills/
    universal-skills/
 SPEC.md           # This file
 CHAT.md           # Change history
 package.json
```

### Core Modules

**`core/discovery.ts`**
- Scan skill directories
- Parse SKILL.md files
- Build skill registry
- Handle priority resolution

**`core/parser.ts`**
- Parse YAML frontmatter
- Validate required fields
- Extract skill metadata

**`core/plugins.ts`**
- Read installed_plugins.json
- Discover plugin skills
- Resolve plugin paths

**`cli/index.ts`**
- Parse CLI arguments
- Route to command handlers
- Format output

**`mcp/server.ts`**
- Implement MCP protocol
- Provide skill tool
- Handle stdio communication

## Quality Requirements

### Type Safety
- **MUST** maintain 100% type safety (no `any`, `@ts-nocheck`)
- **MUST** use Zod for runtime validation where needed
- **MUST** use `ts-pattern` for type-safe branching

### Testing
- **MUST** achieve >80% code coverage
- **MUST** include unit tests for all core modules
- **MUST** include integration tests for CLI and MCP
- **MUST** test error scenarios

### Code Quality
- **MUST** follow SOLID principles
- **MUST** keep files under 200 lines (prefer modular structure)
- **MUST** use meaningful names (no abbreviations)
- **MUST** document public APIs with JSDoc

### Build & Development
- **MUST** pass type checking: `pnpm ts`
- **MUST** pass linting: `pnpm lint`
- **MUST** pass tests: `pnpm test`
- **MUST** format code: `pnpm fmt` (prettier + organize-imports + tailwindcss)

## Implementation Plan

### Phase 1: Core Discovery (P0)
- [ ] Implement skill directory scanning
- [ ] Implement SKILL.md parsing (YAML frontmatter)
- [ ] Implement priority resolution
- [ ] Write unit tests for core logic

### Phase 2: Plugin Support (P0)
- [ ] Parse installed_plugins.json
- [ ] Discover plugin skills recursively
- [ ] Support namespaced skill names (`plugin:skill`)
- [ ] Handle plugin priorities

### Phase 3: MCP Server (P1)
- [ ] Implement MCP stdio protocol
- [ ] Provide `skill` tool with dynamic description
- [ ] Implement skill refresh mechanism (30s interval)
- [ ] Provide MCP resources (optional)
- [ ] Write MCP integration tests

### Phase 4: CLI Interface (P2)
- [ ] Implement `list` command
- [ ] Implement `info` command
- [ ] Implement `search` command
- [ ] Write CLI integration tests

### Phase 5: Polish (P3)
- [ ] Add `validate` command
- [ ] Improve error messages with suggestions
- [ ] Add fuzzy search for skill names
- [ ] Write comprehensive documentation
- [ ] Create README.md and README-zh.md

## Success Criteria

✅ **Must Have:**
- List all skills from user and plugin directories
- Read skill content with base directory
- Support both CLI and MCP interfaces
- Type-safe implementation
- >80% test coverage

✅ **Should Have:**
- Helpful error messages with suggestions
- Support for plugin namespaces
- Fuzzy search for skill names
- Comprehensive documentation

✅ **Nice to Have:**
- Skill validation command
- Performance optimization (caching)
- Skill creation wizard
- Integration with skill-creator

## Verification Checklist

Before marking this spec as complete:

- [ ] All FR requirements implemented
- [ ] Type checking passes: `pnpm ts`
- [ ] Tests pass: `pnpm test:coverage`
- [ ] Linting passes: `pnpm lint`
- [ ] Code formatted: `pnpm fmt`
- [ ] Documentation complete (README.md, README-zh.md)
- [ ] Can list all user skills correctly
- [ ] Can read skill content with base directory
- [ ] MCP server works with Claude Code
- [ ] Error handling provides helpful messages

## References

- [universal-skills](./references/universal-skills/) - MCP-based implementation
- [openskills](./references/openskills/) - CLI-based implementation
- Claude Code official documentation
- MCP Protocol specification
