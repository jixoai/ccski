# `ccski import`

Adopt an unregistered symlink as a ccski link projection. `--claim` touches
**state only** — the filesystem is unchanged and the adoption is reversible by a
state revert.

## Usage

```bash
ccski import <path> --observe                 # print target inode/hash, no state change
ccski import <path> --claim --inode <ino> --hash <hex>
```

## Identity guards

A claim requires the target's **exact inode and content hash** (64-hex folder
hash). Observe them first with `--observe`:

```bash
ccski import .claude/skills/my-skill --observe
#   link:   .claude/skills/my-skill
#   target: /abs/path/to/.claude/skills/my-skill
#   inode:  1234567
#   hash:   9f2c...  (computeSkillFolderHash of the link target)
```

If either guard differs at claim time, the claim fails typed `CLAIM_CONFLICT`
(with a `reason` distinguishing name conflicts from identity mismatches) and **no
state change occurs**. Name conflicts against an existing entity also fail
`CLAIM_CONFLICT`.

## Options

- `<path>`: symlink path to adopt (a projection-root link position)
- `--claim`: adopt the link as a ccski projection (state-only change)
- `--inode <number>`: expected target directory inode (identity guard)
- `--hash <hex>`: expected target content hash, 64 hex (identity guard)
- `--observe`: print the target's inode/hash without changing state
- `--global` / `-g`: claim against the global scope (default: project)
- `--json`: output typed receipts as JSON

## Examples

```bash
ccski import .claude/skills/my-skill --observe
ccski import .claude/skills/my-skill --claim --inode 1234567 --hash 9f2c...
ccski import .claude/skills/my-skill --claim --inode 1234567 --hash 9f2c... --json
```
