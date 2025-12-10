# ccski - Claude Code Skills Manager

## Project Overview

**ccski** is a CLI + MCP server for SKILL.md-based capabilities. It discovers, installs, toggles, and serves skills for humans (CLI) and agents (MCP/stdio/http/sse). MCP is the contract; CLI is ergonomics.

## Architecture Philosophy

- **Filesystem as truth**: Enabled = `SKILL.md`, disabled = `.SKILL.md`. No opaque registries.
- **Deterministic agent surface**: MCP output and SKILL content are immutable by CLI niceties.
- **Progressive disclosure**: Discover widely, load on demand; keep SKILL.md authoritative.
- **Separation of stages**: Discovery → Materialization (git/file, cache) → Selection (filters, interactive) → Installation/Toggle → Serve.
- **Automation-first UX**: Every interactive flow exposes a copyable one-shot command; `--json` everywhere; calm output, actionable errors.

## UX Considerations

- Safe defaults: never overwrite without `--force/--override`; toggle skips dual-file conflicts unless forced.
- Predictable interactivity: shared picker layout/colors with live `Command:` preview; honors TTY checks.
- Scriptable: stable JSON, `--no-color` respected when not TTY or explicit, summaries grouped by skill.
- Actionable errors: similar-name suggestions, resolved directories/branch/path shown for git sources.
- Minimal noise: terse progress for git clone; clear summaries for install/toggle.

## Skill Lifecycle (Mental Model)

1. **Discovery**: Prioritized roots (`.agent/.claude/.codex` project+user) plus `--skill-dir` scoped entries; optional plugin scan via `installed_plugins.json`.
2. **Materialization**: Git/file; cached clones keyed by commit; supports tree/blob and marketplace.json resolution; timeouts and cleanup of temp dirs.
3. **Selection**: Include/exclude grammar, state filter (enabled/disabled/all), short-name resolution with ambiguity checks; interactive multi-select.
4. **Installation/Toggle**: Copy skill dirs to scopes (claude project/user, codex user); enable/disable via rename with conflict detection and force gate; dry-run summaries.
5. **Serve**: MCP registry refreshes on interval (default 30s) unless `--no-refresh`; `skill` tool description lists discovered skills; supports stdio/http/sse transports.

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

Skills are discovered from multiple directories:

- Project roots: `.agent/skills`, `.claude/skills`, `.codex/skills`
- User roots: `~/.agent/skills`, `~/.claude/skills`, `~/.codex/skills`
- Custom: `--skill-dir /path?scope=name` (defaults to scope `other` for custom provider)
- Plugins: from `installed_plugins.json` (Claude) with optional fallback scan when `CCSKI_CLAUDE_PLUGINS_FALLBACK=true`

**Resolution notes:** Discovery collects all; conflict handling happens later via filters/selection (auto mode prefers fresher and non-plugin copies).

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
ccski list [--format=json]

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
ccski list                  # Human-friendly list output (with spacing)
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
- bun: Bun(js runtime) documents
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
- **Language:** TypeScript (strict)
- **Runtime:** Node.js (>=20)
- **Build Tool:** tsdown/rolldown
- **Package Manager:** pnpm
- **Testing:** vitest (+jsdom), coverage via `vitest --coverage`

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
- Recursively scan skill roots; include disabled optionally
- Detect dual SKILL/.SKILL conflicts
- Determine location (project/user/plugin/custom) and bundled resources

**`core/parser.ts`**
- Enforce UTF-8, YAML frontmatter with name/description
- Normalize description whitespace; surface Parse/Validation errors with suggestions

**`core/plugins.ts`**
- Load `installed_plugins.json`; validate shape
- Recursively find SKILL.md in plugin install paths; namespace as `<plugin>:<skill>`
- Optional fallback scan at `<pluginsRoot>/skills` when env enables

**`core/registry.ts`**
- Aggregate discovery + plugin skills; track diagnostics
- Resolve skills (full/short/provider) with suggestions; load content respecting disabled

**`utils/filters.ts`**
- Include/exclude grammar (provider, @plugins, wildcards, file: path)
- State filter (enabled/disabled/all); auto-dedup prefers fresher/non-plugin copies

**`utils/resolution.ts`**
- Alias-aware resolution; ambiguity and not-found errors with fuzzy hints

**`cli/commands/*.ts`**
- List/info/search/validate/install/toggle wired to registry + filters; `install` handles materialization, caching, marketplaces, destinations; toggles rename SKILL ↔ .SKILL with conflicts + force gate

**`cli/prompts/commandBuilder.ts`**
- Interactive command preview/confirmation; renders copyable one-shot command

**`mcp/server.ts`**
- MCP transports (stdio/http/sse); dynamic `skill` tool description from filtered registry
- Auto-refresh interval; formats skill content with header

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
- **MUST** pass linting: `pnpm lint` (stubbed currently)
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
