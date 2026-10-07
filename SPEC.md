# ccski — Technical Overview (3.0)

**ccski** is a CLI + MCP server for SKILL.md-based capabilities. In 3.0 it is an
**entity + projection kernel**: every installed skill is a canonical entity
directory in a scope's `.agents/skills/` root plus explicit projections
(symlinks by default) into named agent roots, with ccski-owned accounting in a
per-scope sidecar state file. MCP is the agent contract; CLI is ergonomics.

Normative behavior lives in the OpenSpec capabilities under
`openspec/specs/` (the `store-link-kernel` change carries the 3.0 kernel
contract: `openspec/changes/store-link-kernel/specs/entity-projection-kernel/spec.md`).
This document is the orientation map; README.md is the user guide; CHANGELOG.md
records the 2.x → 3.0 breaking boundaries.

## Architecture Model

- **Entity layer**: `ensureEntity({ scope, source, replace? })` materializes a
  skill as a real directory at `<scopeBase>/skills/<folderName>` (global =
  `~/.agents`, project = `<cwd>/.agents`). `folderName` derives from the
  logical name by a frozen sanitize algorithm pinned to npm:skills 1.7.1.
  Same-name different-source installs fail typed `NAME_EXISTS` unless an
  explicit `replace: { expectedRevision }` is provided.
- **Projection layer**: `projectEntity({ scope, name, roots, mode?, strict? })`
  creates projections ONLY into explicitly provided roots — the SDK never
  infers roots from the environment. Default mode is `link` (symlink);
  `materialized` requires an explicit reason; automatic downgrade is allowed
  only for `symlink-unavailable`; target permission failures are typed
  `TARGET_DENIED` with no silent copy. A projection root that resolves to the
  scope's own entity root yields the fourth `entity-local` receipt form.
- **State layer**: ccski-owned accounting in `<scopeBase>/.ccski-state.json`
  (sole writer: ccski) records entities, projections, folder hashes, and a
  monotonic generation. Writes use same-directory temp file + fsync + rename
  with generation CAS. Corrupt or unknown-version state degrades read-only
  (`STATE_RECOVERY_REQUIRED`).
- **Lock layer**: npm:skills `.skill-lock.json` is read-only provenance for
  ccski (sole writer: skills CLI) — raw pass-through of unknown fields,
  unknown versions degrade to opaque `LOCK_VERSION_UNSUPPORTED` views. ccski
  never writes it; receipts report `lockSyncPending: true` instead.
- **Discovery layer**: top-level directory symlinks are first-class entries
  (`lstat` + single-level `realpath`), metadata carries `canonicalPath`,
  `entryKind`, `ownership` (`ccski`/`external`/`unknown`), `mode`, and
  `provenance`. Recursive descent never follows symlinks below the top level;
  broken links are typed omissions. Pre-3.0 materialized directories are
  labeled `materialized + legacy-unknown` and never auto-converted — adoption
  goes through `ccski migrate`.

## Surfaces

- **CLI (human face)**: `list`, `info`, `search`, `validate`, `install`,
  `enable`/`disable`, `migrate`, `gc`, `state repair`, `import --claim`, `mcp`.
  Receipt-bearing commands take `--json`; `search` uses `--format=json`;
  `mcp` is a long-running server. `list`/`info` accept `--redact-paths`
  (relative-path-only output for paste/log scenarios).
- **MCP (agent face)**: stdio/http/sse transports; one `skill` tool whose
  description lists discovered skills. Tool results carry the same domain
  field set as the API; the skill body is served without the raw frontmatter
  block. Transport gating is not a privacy boundary.
- **Programmatic API (package export)**: kernel mutations (`ensureEntity`,
  `projectEntity`, `removeEntityProjections`, `deleteEntity`,
  `toggleEntityProjection`, `updateEntity`), command face (`migrateLegacyEntries`,
  `gcPropose`, `repairState`, `claimLink`), alignment face (`listSkills`,
  `getSkillInfo`, `searchSkills`, `validateSkill`), explicit file-read face
  (`readSkillContent`), and `computeSkillFolderHash` (single-source folder hash
  for hosts). All failures are typed results with finite code vocabularies; the
  full public code set is the exported `PUBLIC_RESULT_CODES` table.

## Field visibility contract

Projections (CLI stdout/JSON, MCP tools, `listSkills`/`getSkillInfo`) return
only domain fields: identity, description, folder/scope identities, paths,
provenance subset, mode/ownership/revision markers. SKILL.md bodies and
frontmatter payloads appear only through explicit document/file-read surfaces
(`readSkillContent`, `ccski info --full`, the MCP `skill` tool's body output).
Provenance `sourceUrl` is sanitized (userinfo/credentials and query strings
stripped) before leaving the kernel — on both the save path and every
projection path.

## Technology Stack

- **Language:** TypeScript (strict)
- **Runtime:** Node.js (>=20)
- **Build:** tsdown (Node ESM bundles in `dist/`)
- **Package Manager:** pnpm
- **Testing:** vitest (real-disk fixtures; kernel tests construct true
  rename/inode/errno surfaces, no fs mocks)

## Project Structure

```
ccski/
  src/
    api/           # Public API: kernel mutations, command face, DTOs, result codes
    cli/           # yargs command modules + agent registry + redaction
    core/          # discovery, parsing, entity/state/lock layers, folder hash
    mcp/           # MCP server (stdio/http/sse)
    types/         # shared type definitions
    utils/         # filters, formatting, resolution
  tests/           # vitest suites + real-disk kernel fixtures (tests/helpers)
  openspec/        # capability specs + change history (source of truth)
  docs/            # docs site
  references/      # reference implementations (openskills, universal-skills)
```

### Core Modules

- **`core/entity-state.ts`** — frozen sanitize algorithm, scope/entity-root
  resolution, strict state record schemas, projection root identity.
- **`core/state-store.ts`** — CAS state store (temp + fsync + rename,
  generation compare-and-swap, kill-safe recovery).
- **`core/lock-reader.ts`** — read-only npm lock provenance (raw pass-through,
  sanitizer-applied subset projection, opaque unsupported versions).
- **`core/discovery.ts`** — first-class symlink discovery, ownership/canonical
  metadata, reserved-name residue sweep, `loadSkill` document read.
- **`core/folder-hash.ts`** — frozen npm:skills 1.7.1 folder-hash algorithm
  (exported single source for hosts).
- **`api/*.ts`** — kernel mutations and command face with typed result unions;
  `api/result-codes.ts` freezes the public code vocabulary
  (`PUBLIC_RESULT_CODES` + compile-time closure receipt).
- **`cli/commands/*.ts`** — yargs command modules bridging the kernel; typed
  `--json` receipts; `--redact-paths` via `cli/redact.ts`.
- **`mcp/server.ts`** — transports, dynamic `skill` tool description,
  frontmatter-stripped tool output, auto-refresh interval.

## Quality Gates

- `pnpm ts` — strict type checking (`tsc --noEmit`), zero errors.
- `pnpm lint` — static analysis gate (strict `tsc`; see package.json).
- `pnpm test` — full vitest suite (kernel, parity, CLI receipt contracts).
- `pnpm build` — tsdown production bundles.
- `openspec validate <change> --strict` — spec conformance for open changes.
- npm:skills 1.7.1 parity is pinned by versioned fixtures and re-run on npm CLI
  upgrades.

## References

- [openskills](./references/openskills/) — SKILL.md authoring pattern
- [universal-skills](./references/universal-skills/) — MCP-first skill set
- npm:skills CLI (1.7.1) — projection-set and folder-hash parity reference
- MCP Protocol specification
