# ccski – Claude Code Skills Manager

ccski is a CLI + MCP server to discover, install, enable/disable, and serve Claude/Codex-compatible skills. It also exports a small “kernel” API so you can embed entity management, discovery, and validation in your own scripts. This README covers install and usage. For architecture and UX philosophy, see `SPEC.md`.

Documentation site: https://jixoai-labs.github.io/ccski/

## Table of contents

- [Install](#install)
- [3.0 in one paragraph](#30-in-one-paragraph)
- [Quick start](#quick-start)
  - [Connect ccski to your agent prompt](#connect-ccski-to-your-agent-prompt)
  - [Run MCP server](#run-mcp-server)
  - [Core CLI commands](#core-cli-commands)
  - [Install a skill](#install-a-skill)
  - [Enable/disable](#enabledisable)
  - [Maintenance: migrate / gc / state repair / import --claim](#maintenance-migrate--gc--state-repair--import---claim)
  - [Scopes, entities, and projections](#scopes-entities-and-projections)
- [Platform support](#platform-support)
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

## 3.0 in one paragraph

3.0 is a breaking release. ccski no longer copies skills around: every installed skill becomes an **entity** (a real directory under the scope's `.agents/skills/` root) plus explicit **projections** (symlinks by default) into the agent roots you name. Discovery treats symlinks as first-class entries and reports `canonicalPath` / `entryKind` / `ownership` / `mode` / `provenance` for each skill; pre-3.0 materialized copies are preserved and labeled `materialized + legacy-unknown` until you migrate them explicitly. The 2.x mutation APIs (`installSkills`, `installSkillDir`, `removeSkills`, `toggleSkills`) and the git/marketplace install sources are removed without compatibility shims — see [Migrating from 2.x](#migrating-from-2x) and the [CHANGELOG](./CHANGELOG.md).

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

| Command                          | Purpose                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `ccski list`                     | List discovered skills with mode/ownership/provenance metadata                     |
| `ccski info <name>`              | Show metadata and content preview                                                  |
| `ccski search <query>`           | Search by name/description (optional `--content`)                                  |
| `ccski validate <path>`          | Validate SKILL.md or skill directory                                               |
| `ccski install`                  | Install the ccski workflow block into agent instruction files (unchanged in 3.0)   |
| `ccski install <dir>`            | Install a local skill directory as entity + agent projections (link by default)    |
| `ccski enable [names...]`        | Enable projections (link: rebuild after an `ENTITY_REVISED` gate)                  |
| `ccski disable [names...]`       | Disable projections (link: unlink — physically effective)                          |
| `ccski migrate`                  | Adopt legacy materialized copies as entities + projections (dry-run by default)    |
| `ccski gc`                       | Propose retiring state records whose roots vanished (dry-run only in 3.0)          |
| `ccski state repair`             | Diff filesystem vs sidecar state, then repair with `--confirm`                     |
| `ccski import <path> --claim`    | Adopt an unregistered symlink as a ccski projection (inode + hash guarded)         |
| `ccski mcp`                      | Start MCP server (stdio/http/sse)                                                  |

All commands support `--json` for typed, scriptable output.

### Install a skill

3.0 installs one skill per invocation from a **local directory containing `SKILL.md`**.
The skill becomes an entity in the chosen scope, then is projected into the target
agent roots. CLI mutation scope defaults to `project` (the current directory);
pass `--global` to target the user-global scope instead.

```bash
# project scope (default): entity under <cwd>/.agents/skills + links into detected
# agents' project roots (detected + universal set)
ccski install ./my-skill

# global scope: entity under ~/.agents/skills + links into agents' global roots
ccski install ./my-skill --global

# explicit targets (repeatable; * = full registry)
ccski install ./my-skill --agent claude-code --agent codex
ccski install ./my-skill --agent '*'

# preview the plan without writing anything
ccski install ./my-skill --dry-run --json

# replace an existing same-name entity (explicit expectedRevision replace)
ccski install ./my-skill --force
```

Behavior you can rely on:

- Projection default is `link` (a symlink to the entity); `materialized` copies
  are only created on explicit request, never silently.
- When no agent is detected, non-interactive installs need `--yes` to fall back
  to the full agent registry.
- Agents without global install capability produce typed failure entries
  (`NO_GLOBAL_INSTALL`) instead of being silently skipped; partial success is
  reported per agent and exits non-zero only if something failed.
- npm's `.skill-lock.json` is never written by ccski; receipts carry
  `lockSyncPending: true` so host flows can report lock sync honestly.
- Git/URL/marketplace sources are retired: they fail with typed
  `SOURCE_UNSUPPORTED`. Git-based acquisition belongs to your host tooling
  (clone, then `ccski install <dir>`).

### Enable/disable

Disabling is physical, not a sidecar flag: a link projection is removed from the
filesystem (`unlink`); materialized copies keep the legacy `.SKILL.md` rename
convention, labeled `convention: "ccski-legacy"` (this is not an npm semantic).
Enabling a link verifies the recorded entity revision first — if the entity
changed since, the call fails typed `ENTITY_REVISED` and suggests `update`.

```bash
# interactive picker
ccski enable -i

# disable all recorded entities in scope
ccski disable --all

# operate on the global scope (default is project)
ccski disable my-skill --global
```

### Maintenance: migrate / gc / state repair / import --claim

```bash
# 1) Adopt pre-3.0 materialized copies as entities + projections.
#    Dry-run is the default and changes nothing.
ccski migrate --dry-run
ccski migrate --execute              # expected-hash guarded; backup/journal rollback
ccski migrate --execute --plan plan.json   # guard against a saved dry-run plan's hashes

# 2) Propose retiring state records whose roots vanished (3.0 is dry-run only;
#    execution without --dry-run fails typed DRY_RUN_REQUIRED and never deletes).
ccski gc --dry-run

# 3) Repair the sidecar state (.ccski-state.json) when it drifted from disk.
ccski state repair                    # diff only; fails typed REPAIR_CONFIRM_REQUIRED
ccski state repair --confirm          # pre-repair backup, then apply; idempotent
ccski state repair --confirm          # second run reports clean, no write

# 4) Adopt a symlink you created by hand as a ccski projection (state-only change).
ccski import .claude/skills/my-skill --observe          # print target inode/hash
ccski import .claude/skills/my-skill --claim \
  --inode 1234567 --hash 64hexhash                      # guarded adoption
```

Guards are typed: migrate keeps conflicting originals untouched (`NAME_COLLISION`,
`HASH_MISMATCH`), claims require exact inode + content hash (`CLAIM_CONFLICT`),
and gc surfaces unknown external references as `GC_UNKNOWN_REFERENCE` warnings.

### Scopes, entities, and projections

```text
global  scope:  $HOME/.agents/skills/<folder>            (entity)  + agent global roots
project scope:  <workspace>/.agents/skills/<folder>      (entity)  + agent project roots
accounting:     <scopeBase>/.ccski-state.json            (sole writer: ccski)
npm lock:       .skill-lock.json                         (sole writer: skills CLI; read-only here)
```

- `folderName` is derived from the SKILL.md `name` by a sanitize algorithm that
  matches npm:skills 1.7.1 exactly (lowercase, runs of characters outside
  `[a-z0-9._]` become hyphens, underscores/dots preserved). Two names that
  sanitize to the same folder fail typed `NAME_COLLISION`.
- Discovery reports each entry's `entryKind`, `canonicalPath`, `ownership`
  (`ccski` / `external` / `unknown`), projection `mode`, and source provenance.
  Broken symlinks are reported as typed omissions, never silently dropped.
- External symlinks (targets outside ccski's records) are read-only:
  mutations against them fail typed `FOREIGN_OWNERSHIP`.
- Projection roots are explicit. The SDK never infers them from the
  environment; the CLI derives its default target set from agent detection
  (detected + universal agents, per the npm:skills 1.7.1 parity fixtures).
- Entity paths are stable: `update` swaps the entity directory in place, so
  existing links resolve to new content without recreation. Pinned materialized
  copies are skipped with typed `PINNED`.

### Migrating from 2.x

- Pre-existing materialized skill directories are **never auto-converted**.
  Discovery labels them `materialized + legacy-unknown`; run `ccski migrate`
  (dry-run first) to adopt them as entities + projections.
- 2.x CLI semantics are gone: `install` no longer clones git repos or reads
  marketplace.json, and enable/disable no longer rename `SKILL.md` on link
  projections (links are unlinked instead).
- The programmatic mutation APIs `installSkills` / `installSkillDir` /
  `removeSkills` / `toggleSkills` were removed. Use the kernel API
  (`ensureEntity` / `projectEntity` / `removeEntityProjections` / `deleteEntity`
  / `toggleEntityProjection` / `updateEntity`) or the CLI commands.

## Platform support

3.0 was developed and verified on macOS. Windows-specific failure classes
(`symlink-unavailable` for `EPERM`/`ENOSYS`/`EXDEV`/unsupported junctions,
`TARGET_DENIED` for target-level permission errors) are implemented and covered
by tests against constructible syscall surfaces, but **no real Windows machine
or CI runner was available for this release**, so Windows behavior is an
explicitly unverified surface — see the [CHANGELOG](./CHANGELOG.md) platform
statement. Honesty over progress: absence of a verified environment is not
treated as a pass.

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
- [npm:skills CLI](https://www.npmjs.com/package/skills) (1.7.1) — projection-set and folder-hash parity reference; ccski freezes these behaviors in versioned fixtures.

## API Reference

Public exports from `import ... from "ccski"`.

Notes:

- Package is ESM (`"type": "module"`). Use `import` in Node.js >= 20.
- Discovery/registry surfaces return **metadata**; `loadSkill()` /
  `SkillRegistry.load()` read full SKILL.md content.
- Mutations without an explicit `scope` fail typed `SCOPE_REQUIRED` (SDK has no
  implicit scope precedence; the CLI defaults to `project`).

### Importing

```ts
// kernel (3.0)
import {
  ensureEntity,
  projectEntity,
  removeEntityProjections,
  deleteEntity,
  toggleEntityProjection,
  updateEntity,
} from "ccski";

// command face (3.0)
import { migrateLegacyEntries, gcPropose, repairState, claimLink } from "ccski";

// alignment face (retained)
import { listSkills, getSkillInfo, searchSkills, validateSkill } from "ccski";

// discovery face (retained)
import { discoverSkills, SkillRegistry, validateSkillFile } from "ccski";
import type { Skill, SkillMetadata } from "ccski";
```

Removed in 3.0: `installSkills`, `installSkillDir`, `removeSkills`,
`toggleSkills` and their option/result types. There are no aliases or shims.

### Kernel API (entities + projections)

Mutations are scoped, revision-guarded, and return typed results
(`kind: "ok" | "error"` with finite failure codes) instead of throwing for
domain failures.

```ts
import { ensureEntity, projectEntity } from "ccski";

// 1) ensureEntity: materialize the entity in the scope and record ownership
let ensured = await ensureEntity({
  scope: "project",                 // explicit; missing => SCOPE_REQUIRED
  source: { dir: "/abs/path/to/my-skill" },
});
if (
  ensured.kind === "error" &&
  ensured.code === "NAME_EXISTS" &&
  ensured.existing
) {
  // explicit same-name replace: requires the current entity's revision
  // (NAME_COLLISION instead means another logical name maps to the same folder)
  ensured = await ensureEntity({
    scope: "project",
    source: { dir: "/abs/path/to/my-skill" },
    replace: { expectedRevision: ensured.existing.expectedRevision },
  });
}
if (ensured.kind === "error") throw new Error(`${ensured.code}: ${ensured.message}`);

// 2) projectEntity: create projections ONLY into roots you name (never inferred)
const projected = await projectEntity({
  scope: "project",
  name: ensured.entity.logicalName,
  roots: ["/abs/workspace/.claude/skills", "/abs/workspace/.codex/skills"],
  // mode: "link" is the default; "materialized" requires an explicit reason
  // ("pinned" | "imported-root" | "user-request"); strict: true forbids downgrade
});
```

Per-root receipts carry the normalized `mode` (`link` | `materialized` |
`entity-local`) and `reason`; a root that normalizes to the scope's own entity
root returns `targetKind: "entity"`, `mode: "entity-local"` — no symlink, no
copy, no duplicate record. Automatic downgrade to `materialized` happens only
for `symlink-unavailable` (`EPERM`/`ENOSYS`/`EXDEV`/junction unsupported);
target permission failures fail typed `TARGET_DENIED` without a silent copy.

The remaining kernel mutations:

- `removeEntityProjections({ scope, name, roots })` — projection-first removal
  (links are unlinked, never deleted through); entity GC only when no ccski
  reference remains among all registered roots; unknown references keep the
  entity with a typed `GC_UNKNOWN_REFERENCE` warning.
- `deleteEntity({ scope, name, expectedRevision, roots? })` — delete the entity
  itself behind a `GUARD_ENTITY` revision guard.
- `toggleEntityProjection({ scope, name, root, action: "enable" | "disable" })` —
  physical disable (unlink + state record) and gated re-enable
  (`ENTITY_REVISED` when the entity moved on).
- `updateEntity({ scope, name, source, expectedRevision? })` — stable-path
  entity swap; materialized copies are re-materialized per copy; pinned copies
  are skipped with typed `PINNED`. Partial success is the norm; there is no
  "atomic reinstall".

### Command API (migrate / gc / repair / claim)

- `migrateLegacyEntries({ scope, dryRun, roots?, plan? })` — adopt
  legacy materialized directories; dry-run plans list collisions/hashes/targets;
  execution (`dryRun: false`; the CLI's `--execute`) is expected-hash guarded
  (`HASH_MISMATCH` keeps originals untouched) with backup/journal rollback.
- `gcPropose({ scope, dryRun })` — propose retiring state records whose roots
  vanished; 3.0 ships the dry-run half only (`DRY_RUN_REQUIRED` otherwise).
- `repairState({ scope, confirm?, roots? })` — scan vs sidecar diff; requires
  `--confirm`; writes a pre-repair backup; idempotent (second run reports clean).
- `claimLink({ scope, link, expectedInode, expectedHash })` — adopt a foreign
  symlink; touches state only; reversible by state revert; identity mismatches
  fail typed `CLAIM_CONFLICT`.

### Discovery face (retained)

- `discoverSkills(options?: DiscoveryOptions): { skills; diagnostics }` — scan
  built-in directories (unless `scanDefaultDirs: false`) plus `customDirs`.
  Metadata now carries `canonicalPath`, `entryKind`, `ownership`, projection
  `mode`, and source provenance; broken symlinks appear as typed omissions in
  `diagnostics`.
- `SkillRegistry` — discovery + fuzzy resolution (`getAll` / `find` / `has` /
  `load` / `refresh` / `getDiagnostics`).
- `parseSkillFile(filePath)` / `validateSkillFile(filePath)` — frontmatter
  parsing and safe validation.
- `getDefaultSkillDirectories(userDir)` / `scanSkillDirectory(...)` — lower-level
  scanning primitives.

Reference shapes (simplified):

```ts
export interface SkillMetadata {
  name: string;
  description: string;
  disabled?: boolean;
  provider: "claude" | "codex" | "file" | (string & {});
  location: "user" | "project" | "plugin";
  path: string;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo?: { pluginName: string; marketplace: string; version: string };
  // --- 3.0 additions (top-level discovery entries only; optional) ---
  /** Entity path: the entry itself for directories, single-level realpath for symlinks */
  canonicalPath?: string;
  /** Top-level entry form */
  entryKind?: "directory" | "symlink";
  /** Ownership: recorded by ccski / external live-link / unrecorded */
  ownership?: "ccski" | "external" | "unknown";
  /** Observed projection form */
  mode?: "link" | "materialized" | "entity-local";
  /** Legacy marker: pre-3.0 materialized copies without a state record */
  provenance?: "legacy-unknown";
  /** Link projection whose recorded revision went stale after an entity replace */
  stale?: boolean;
}

export interface Skill extends SkillMetadata {
  content: string; // full markdown (including frontmatter)
  fullName: string;
}
```

### Folder hash (host consumption interface)

`computeSkillFolderHash(skillDir): Promise<string>` — the single frozen
implementation of the npm:skills 1.7.1 folder hash (sorted relative paths +
path bytes + file bytes, regular files only, skips `.git`/`node_modules`).
ccski exports it so hosts compute the same digest instead of re-implementing
the algorithm.

### Errors

Domain failures come back as typed results with finite codes rather than
throws: `SCOPE_REQUIRED`, `NAME_COLLISION`, `NAME_EXISTS`, `ENTITY_REVISED`,
`GUARD_ENTITY`, `GUARD_PROJECTION`, `STALE_PROJECTION`, `PINNED`,
`FOREIGN_OWNERSHIP`, `TARGET_DENIED`, `SYMLINK_FAILED`, `HASH_MISMATCH`,
`CLAIM_CONFLICT`, `DRY_RUN_REQUIRED`, `REPAIR_CONFIRM_REQUIRED`,
`GC_UNKNOWN_REFERENCE`, `NO_GLOBAL_INSTALL`, `SOURCE_UNSUPPORTED`,
`STATE_GENERATION_CONFLICT`, `STATE_RECOVERY_REQUIRED`,
`LOCK_VERSION_UNSUPPORTED`.

Parser/registry errors extend `CcskiError` and include a `suggestions: string[]`
field for UX-friendly guidance:

- `SkillNotFoundError`: thrown when a skill name cannot be resolved
- `AmbiguousSkillNameError`: thrown when multiple skills match; includes `matches: string[]`
- `ParseError`: SKILL.md read/UTF-8/frontmatter parsing failures; includes `filePath`, `reason`
- `ValidationError`: frontmatter schema validation failures; includes `filePath`, `issues: string[]`

### Schemas (Zod)

These are exported for validating/parsing external JSON and frontmatter in a type-safe way:

- `SkillFrontmatterSchema` / `SkillFrontmatterType`
- `PluginEntrySchema` / `PluginEntryType`
- `InstalledPluginsSchema` / `InstalledPluginsType`
- `ClaudeSettingsSchema` / `ClaudeSettingsType`
