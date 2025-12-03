# Capability: CLI Interface

## Requirements

### Requirement: Shared registry and color options
- All commands MUST honour global registry flags: `--skill-dir` (highest-priority custom roots), `--no-plugins`, `--plugins-file`, `--plugins-root`, and `--scan-default-dirs`.
- Color handling MUST respect `--no-color`, `--color`, and `FORCE_COLOR` for consistent output, and JSON modes must suppress ANSI sequences.
#### Scenario: custom skill dir overrides default
- GIVEN `ccski list --skill-dir ./extra`
- WHEN a skill named `foo` exists in both `./extra` and `~/.claude/skills`
- THEN the version from `./extra` is listed and the home copy is skipped.

### Requirement: List skills
- `ccski list` MUST group results by location (project, user, plugin) and badge disabled skills; `--all` includes both, `--disabled` filters only disabled.
- Output formats: human-friendly plain text (default) or JSON via `--format json`/`--json`.
- When no skills match, it MUST print a friendly message instead of empty output.
#### Scenario: list disabled only
- GIVEN at least one `.SKILL.md`
- WHEN running `ccski list --disabled`
- THEN only disabled skills appear in the list.

### Requirement: Inspect skill info
- `ccski info <name>` MUST resolve names case-insensitively, support short names with priority ordering, and surface suggestions on not-found errors.
- Output MUST include name, description, location, path, size, resource flags, plugin info, and a 20-line preview unless `--full` or `--json` is requested.
#### Scenario: request full content
- WHEN running `ccski info user --full`
- THEN the full SKILL.md content is printed after metadata.

### Requirement: Search skills
- `ccski search <query>` MUST fuzzy-rank skills by name/description; `--content` additionally filters by SKILL body.
- Formats: plain (rendered list with highlighting) or JSON via `--format json`/`--json`.
- When `--content` is set, snippets of matched content SHOULD be emitted for the first few hits.
#### Scenario: content search
- GIVEN a skill whose body contains "api"
- WHEN running `ccski search api --content`
- THEN that skill is returned and a body snippet highlights the term.

### Requirement: Validate SKILL files
- `ccski validate <path>` MUST resolve directories to contained `SKILL.md`, accept direct file paths, and exit non-zero on failure.
- JSON output MUST include `success`, `errors`, and `suggestions` alongside the resolved file path.
#### Scenario: missing SKILL in dir
- WHEN running `ccski validate ./tmp/missing`
- THEN the command exits with code 1 and prints an error about the missing SKILL.md.

### Requirement: Install skills
- `ccski install <source>` MUST support git URLs (default for http/https or `.git`), local directories/files (`--mode file`), `marketplace.json` inputs, and explicit SKILL.md paths via `--path`.
- Target defaults to `.claude/skills` in the current project; `--global` installs to `~/.claude/skills`.
- For multiple skills, the command MUST require selection via names, `--all`, or `-i/--interactive`; otherwise it errors with a hint and shows the available skills.
- `--force/--override` MUST overwrite existing skills; `--branch` selects the git branch when cloning.
#### Scenario: multiple skills without selection
- GIVEN a source containing three skills
- WHEN running `ccski install <source>` without selectors
- THEN the command errors and prints a selectable listing instead of installing.

### Requirement: Enable and disable skills
- `ccski disable` MUST rename `SKILL.md` to `.SKILL.md`; `ccski enable` MUST perform the inverse, respecting `--force/--override` when both files exist.
- Both commands MUST support name filters, comma/slash-separated selectors, `--all`, and `-i/--interactive` prompts; they operate only on currently enabled or disabled candidates respectively.
#### Scenario: force enable collision
- GIVEN both `SKILL.md` and `.SKILL.md` exist
- WHEN running `ccski enable foo --force`
- THEN `.SKILL.md` replaces `SKILL.md` and the operation succeeds.

### Requirement: MCP launcher
- `ccski mcp` MUST start the MCP server with options `--refresh-interval`, `--no-refresh`, `--transport stdio|http|sse`, `--host`, and `--port`, forwarding registry flags to keep CLI and MCP skill views aligned.
#### Scenario: HTTP transport
- WHEN running `ccski mcp --transport http --port 3333`
- THEN the server listens on `http://127.0.0.1:3333/mcp` using the streamable HTTP transport.
