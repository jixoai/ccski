# ccski – Claude Code Skills Manager

ccski is a CLI + MCP server to discover, install, enable/disable, and serve Claude/Codex-compatible skills. It also exports a small “kernel” API so you can embed discovery/validation in your own scripts. This README covers install and usage. For architecture and UX philosophy, see `SPEC.md`.

Documentation site: https://jixoai-labs.github.io/ccski/

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
  - [Connect ccski to your agent prompt](#connect-ccski-to-your-agent-prompt)
  - [Run MCP server](#run-mcp-server)
  - [Core CLI commands](#core-cli-commands)
  - [Install examples](#install-examples)
  - [Enable/disable](#enabledisable)
  - [Discovery roots and priority](#discovery-roots-and-priority)
- [More](#more)
- [Acknowledgements](#acknowledgements)
- [API Reference](#api-reference)

## Install

Requires Node.js >= 20.

```bash
# run directly
npx ccski --help

# or install locally
pnpm install ccski
ccski --help
```

## Quick start

### Connect ccski to your agent prompt

ccski works best when your agent is told how to discover local skills at the
start of a new context. The installer writes a managed English workflow block
into common agent instruction files:

```bash
npx -y ccski install
```

By default this installs at user scope for known agents:

- Codex: `~/.codex/AGENTS.md`
- Claude Code: `~/.claude/CLAUDE.md`
- Gemini CLI: `~/.gemini/GEMINI.md`
- OpenCode: `~/.config/opencode/AGENTS.md`

Limit the target or install only into the current project:

```bash
# one agent, user scope
npx -y ccski install --agent=codex

# one project file in the current directory
npx -y ccski install --agent=gemini --project

# preview changes
npx -y ccski install --dry-run --json
```

The installer is idempotent. It replaces only the managed
`<workflow name="ccski">...</workflow>` block and preserves the rest of your
prompt file.

Manual install is also fine. Add this block to your user or project instruction
file, such as `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`, or
`~/.gemini/GEMINI.md`:

```md
<workflow name="ccski">
When starting a new context, run `bunx ccski list --no-color` to discover extra local skills available on this machine, especially shared `agents:user` skills and agent-specific skills such as `claude:user`, `codex:user`, and `gemini:user`.
If the user names a skill, or a task clearly matches a skill that is not already exposed in the current session, do not assume the skill is unavailable. First run `bunx ccski list --no-color`, then run `bunx ccski info <name>` and load the `SKILL.md` path reported by the output.
`ccski` may emit compatibility warnings while reading local agent or plugin metadata, such as `installed_plugins.json`. These warnings do not necessarily block `list` or `info`; prefer `--no-color` for readable output and downstream parsing.
</workflow>
```

### Run MCP server

```bash
npx ccski mcp
```

- Add extra skill roots: `npx ccski mcp --skill-dir /extra/skills`
- Disable auto refresh: `npx ccski mcp --no-refresh`

MCP plugin config example (Codex/Cursor/Windsurf/VS Code):

```json
{
  "mcpServers": {
    "ccski": {
      "command": "npx",
      "args": ["ccski", "mcp"]
    }
  }
}
```

### Core CLI commands

| Command                                      | Purpose                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `ccski list`                                 | List discovered skills (project, user, plugin)                          |
| `ccski info <name>`                          | Show metadata and content preview                                       |
| `ccski install`                              | Install the ccski workflow block into agent instruction files           |
| `ccski install <source> [-i\|--all\|--path]` | Install from git/dir/marketplace/SKILL.md; interactive picker available |
| `ccski enable [names...] [-i\|--all]`        | Enable skills (`.SKILL.md` -> `SKILL.md`)                               |
| `ccski disable [names...] [-i\|--all]`       | Disable skills (`SKILL.md` -> `.SKILL.md`)                              |
| `ccski validate <path>`                      | Validate SKILL.md or skill directory                                    |
| `ccski mcp`                                  | Start MCP server (stdio/http/sse)                                       |

### Install examples

- Git repo (auto-detect marketplace):
  `ccski install https://github.com/wshobson/agents`
- Specific branch or path:
  `ccski install https://github.com/wshobson/agents/tree/main --branch main`
  `ccski install https://github.com/wshobson/agents --path skills/foo/SKILL.md`
- Local directory or single file:
  `ccski install /path/to/skills --mode file`
  `ccski install ./plugins/foo/SKILL.md`
- Overwrite existing skill: add `--force` (or `--override`).

### Enable/disable

```bash
# Enable via interactive picker
ccski enable -i

# Disable all enabled skills
ccski disable --all
```

### Discovery roots and priority

By default ccski scans shared and agent-specific skill roots in the workspace and user
home directory. Built-in agent roots include `.claude/skills`, `.codex/skills`,
`.gemini/skills`, and `.openclaw/skills`; ccski also discovers shallow dynamic
agent roots such as `.<agent>/skills`.

When `auto` selection sees the same skill name in multiple roots, ccski keeps every
copy internally but chooses one by source priority:

1. `--skill-dir` custom roots
2. `<workspace>/.<agent>/skills`
3. `<workspace>/.agents/skills`
4. `<workspace>/skills`
5. `~/.<agent>/skills`
6. `~/.agents/skills`
7. Claude plugin skills

If two copies have the same source priority, the newer `SKILL.md` or `.SKILL.md`
mtime wins. If mtimes also tie, provider ordering is deterministic.

## More

- Programmatic API is available from the package export; see [API Reference](#api-reference) (or the docs site) for usage examples.
- Claude users: prefer `ccski mcp --exclude=claude` to avoid echoing built-in Claude skills.
- Codex users: prefer `ccski mcp --exclude=codex` when avoid echoing built-in Codex skills.
- All commands support `--json` for scripting.
- Use `--no-color` to disable colors or `--color` to force them.
- Read `SPEC.md` for deep technical details and design philosophy.

## Acknowledgements

- [openskills](https://github.com/numman-ali/openskills) — established the SKILL.md authoring pattern; ccski aligns with that spec.
- [universal-skills](https://github.com/klaudworks/universal-skills) — MCP-first skill set; ccski focuses on management, not bundling content.

## API Reference

Public exports from `import ... from "ccski"`.

Notes:

- Package is ESM (`"type": "module"`). Use `import` in Node.js >= 20.
- `discoverSkills()` / `SkillRegistry.getAll()` return **metadata**. Use `loadSkill()` / `SkillRegistry.load()` to read full SKILL.md content.

### Importing

```ts
import { discoverSkills, SkillRegistry, validateSkillFile } from "ccski";
import type { Skill, SkillMetadata } from "ccski";
```

### Types

- `SkillProvider`: built-ins `"agents" | "claude" | "codex" | "gemini" | "openclaw" | "file"` plus discovered `.<agent>/skills` providers
- `SkillLocation`: `"user" | "project" | "plugin"`
- `SkillFrontmatter`: required SKILL.md frontmatter shape (`name`, `description`, plus extra fields)
- `SkillMetadata`: discovered skill summary (name/description/provider/location/path + bundled resources flags)
- `Skill`: `SkillMetadata` + `content` (full markdown, including frontmatter) + `fullName`
- `ParseResult`: `{ frontmatter, content, fullContent }`
- `DiscoveryOptions`: configure default roots, custom directories, provider tagging, and disabled-skill handling
- `SkillRegistryOptions`: `DiscoveryOptions` + plugin discovery options (`pluginsFile`, `pluginsRoot`, `settingsFile`, `userDir`)

Reference shapes (simplified):

```ts
export interface SkillMetadata {
  name: string;
  description: string;
  disabled?: boolean;
  provider: "claude" | "codex" | "file";
  location: "user" | "project" | "plugin";
  path: string;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo?: { pluginName: string; marketplace: string; version: string };
}

export interface Skill extends SkillMetadata {
  content: string; // full markdown (including frontmatter)
  fullName: string;
}
```

### Errors

All errors extend `CcskiError` and include a `suggestions: string[]` field for UX-friendly guidance.

- `SkillNotFoundError`: thrown when a skill name cannot be resolved
- `AmbiguousSkillNameError`: thrown when multiple skills match; includes `matches: string[]`
- `ParseError`: SKILL.md read/UTF-8/frontmatter parsing failures; includes `filePath`, `reason`
- `ValidationError`: frontmatter schema validation failures; includes `filePath`, `issues: string[]`

### Parser

#### `parseSkillFile(filePath: string): ParseResult`

Parse a `SKILL.md` (or `.SKILL.md`) file and return:

- `frontmatter`: validated & normalized (`description` whitespace is normalized)
- `content`: markdown body **without** frontmatter
- `fullContent`: original file content **including** frontmatter

Throws `ParseError` (IO/encoding/YAML) and `ValidationError` (schema).

#### `validateSkillFile(filePath: string): { success; errors; suggestions }`

Safe validator wrapper around `parseSkillFile()`:

- `success: true` when file is valid
- otherwise returns `errors` and `suggestions` without throwing

```ts
import { validateSkillFile } from "ccski";

const result = validateSkillFile("/abs/path/to/SKILL.md");
if (!result.success) {
  console.error(result.errors);
  console.error(result.suggestions);
}
```

### Discovery

#### `getDefaultSkillDirectories(userDir: string)`

Return the default search roots (project + user) with provider tagging (Claude/Codex).

#### `discoverSkills(options?: DiscoveryOptions): { skills; diagnostics }`

Scan built-in directories (unless `scanDefaultDirs: false`) plus `customDirs`.

- `skills`: `SkillMetadata[]`
- `diagnostics`: scanned paths, warnings, conflicts, and counts by provider

```ts
import { discoverSkills } from "ccski";

const { skills, diagnostics } = discoverSkills({
  includeDisabled: true,
  customDirs: ["/extra/skills"],
  customProvider: "file",
});
```

#### `loadSkill(metadata: SkillMetadata): Skill`

Load a discovered skill’s full content (reads `SKILL.md` or `.SKILL.md` based on `metadata.disabled`).

#### `scanSkillDirectory(dirPath, options, provider, userDir?, scope?)`

Lower-level scanner used by `discoverSkills()`. Useful when you want full control over:

- root path + recursion
- provider tagging (`"claude" | "codex" | "file"`)
- optional `scope` prefixing for names

### Registry

#### `new SkillRegistry(options?: SkillRegistryOptions)`

Convenience wrapper around discovery + fuzzy resolution.

```ts
import { SkillRegistry } from "ccski";

const registry = new SkillRegistry({ includeDisabled: true });

const all = registry.getAll(); // SkillMetadata[]
const full = registry.load("some-skill"); // Skill (with content)
```

Methods:

- `refresh()`: rescan directories (and plugins unless `skipPlugins: true`)
- `getAll()`: list all discovered skills
- `find(name)`: resolve a name (case-insensitive, supports short name and `provider:name`)
- `has(name)`: boolean existence check
- `load(name)`: resolve + read full content
- `getDiagnostics()`: totals + scanned roots + warnings/conflicts

### Schemas (Zod)

These are exported for validating/parsing external JSON and frontmatter in a type-safe way:

- `SkillFrontmatterSchema` / `SkillFrontmatterType`
- `PluginEntrySchema` / `PluginEntryType`
- `InstalledPluginsSchema` / `InstalledPluginsType`
- `ClaudeSettingsSchema` / `ClaudeSettingsType`
