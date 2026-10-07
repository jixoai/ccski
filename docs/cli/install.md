# `ccski install`

Install the ccski workflow into agent instruction files, or install a local
skill directory as an entity + agent projections (the 3.0 kernel model).

## Usage

```bash
ccski install [--agent <target>] [--user|--project]      # workflow install (no source)
ccski install <dir> [options]                             # skill install (local directory)
```

## Workflow install

Omit `<source>` to inject a managed English `<workflow name="ccski">` block into
agent prompt files.

```bash
npx -y ccski install
npx -y ccski install --agent=codex
npx -y ccski install --agent=gemini --project
```

- Default scope is user.
- `--project` targets the current directory.
- `--agent` can be repeated. Known targets: `codex`, `claude-code`, `gemini`,
  `opencode`.
- The block is idempotent; only the managed ccski workflow block is replaced.

## Skill install (3.0)

Pass a **local directory containing `SKILL.md`**. The skill becomes an entity in
the chosen scope, then is projected into the target agent roots.

```bash
ccski install ./my-skill                                   # project scope (default)
ccski install ./my-skill --global                          # global scope
ccski install ./my-skill --agent claude-code --agent codex # explicit targets
ccski install ./my-skill --agent '*'                       # full agent registry
ccski install ./my-skill --dry-run --json                  # preview, zero writes
ccski install ./my-skill --force                           # explicit replace (expectedRevision)
```

Behavior:

- CLI mutation scope defaults to `project` (current directory); `--global` / `-g`
  switches scope.
- Projection default is `link` (symlink to the entity); `materialized` copies are
  only created on explicit request, never automatically.
- Target-set branches mirror the npm:skills 1.7.1 parity fixtures: explicit
  `--agent`, `*`, detected + universal, and no-detection `--yes` registry
  fallback. Without detection and without `--yes`, the command fails typed.
- Agents without global install capability produce typed `NO_GLOBAL_INSTALL`
  failure entries; partial success is reported per agent and exits non-zero only
  if something failed.
- npm's `.skill-lock.json` is never written; JSON receipts carry
  `lockSyncPending: true`.

## Retired sources

Git/URL/marketplace/`SKILL.md`-file sources were removed in 3.0. They fail with
typed `SOURCE_UNSUPPORTED`:

```bash
$ ccski install https://github.com/org/repo
SOURCE_UNSUPPORTED: git/marketplace sources are retired in 3.0: pass a local
skill directory (contains SKILL.md). Git materialization moves to the host's
repository install (entity/projection API).
```

Clone with your own tooling, then install the local directory.

## Options (skill install)

- `<dir>`: local skill directory containing `SKILL.md` (one skill per invocation)
- `--agent <id>` / `-A <id>` (repeatable, `*` = full registry): projection targets
- `--global` / `-g`: target the global scope (default: project)
- `--force` / `--override`: replace an existing same-name entity (explicit
  expectedRevision replace; the `NAME_EXISTS` payload carries the revision)
- `--dry-run`: preview the planned entity + per-agent projections without writing
- `--yes` / `-y`: fall back to the full agent registry when no agent is detected
- `--json`: output typed receipts as JSON

## Options (workflow install, no source)

- `--agent <target>`: workflow target when no source is provided
- `--scope user|project`: workflow scope
- `--user` / `--project`: workflow scope shortcuts
- `--interactive` / `-i`: interactive picker (requires TTY)
- `--json`: output JSON summary
- `--dry-run`: preview without installing
