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

### Requirement: Search options
- `ccski search` SHALL honor include/exclude/state filters and support `--limit` (default 10) to cap displayed matches. Query text is treated as today (substring/fuzzy); wildcards apply only in include/exclude tokens, not in the query text.
#### Scenario: search with limit
- WHEN running `ccski search api --limit=2 --include=auto`
- THEN only the top 2 matched skills are shown, respecting include filters and current state (enabled by default).

### Requirement: Validate SKILL files
- `ccski validate <path>` MUST resolve directories to contained `SKILL.md`, accept direct file paths, and exit non-zero on failure.
- JSON output MUST include `success`, `errors`, and `suggestions` alongside the resolved file path.
#### Scenario: missing SKILL in dir
- WHEN running `ccski validate ./tmp/missing`
- THEN the command exits with code 1 and prints an error about the missing SKILL.md.

### Requirement: Install destination selection and selection filters
- `ccski install` SHALL support `--out-dir` (string, repeatable) and `--out-scope` (values: `claude`, `claude:@project`, `claude:@user`, `codex`, `codex:@user`). `--out-dir` has highest priority and may specify multiple absolute/relative destinations. `codex:@project` is invalid and MUST error. Default (no out-dir/out-scope) is auto: if only one standard root exists, use it; if multiple roots exist, non-interactive MUST error asking for explicit out-scope/dir, while interactive MUST show a destination checkbox (claude project, claude user, codex user) with missing roots dimmed and creatable when selected.
- When a source contains multiple skills, include/exclude (and group tokens) MUST filter the source skill list before interactive or non-interactive selection; auto dedup MUST NOT drop duplicates during install. Destination conflicts honor `--force/--override` and the resulting path MUST reflect chosen destinations.
- Interactive picker MUST display provider badges, destination list (derived from out-scope/out-dir), missing-path warnings ("will create"), and a command preview reflecting inferred paths. For multi-destination installs, the preview MUST list each path.
#### Scenario: install to codex user with filters
- WHEN running `ccski install repo --out-scope=codex --include=codex:pdf --exclude=codex:beta`
- THEN the selection list only shows Codex provider skills, excludes `beta`, and installed skills land in `~/.codex/skills`.
#### Scenario: auto destination with single provider
- GIVEN only `~/.claude/skills` exists
- WHEN running `ccski install repo` with no `--out-*`
- THEN the skills install to `~/.claude/skills` without prompting.
#### Scenario: auto destination with multiple providers (non-interactive)
- GIVEN both `~/.claude/skills` and `~/.codex/skills` exist
- WHEN running `ccski install repo` with no `--out-*` in non-interactive mode
- THEN the CLI fails asking to specify `--out-scope` or `--out-dir`.
#### Scenario: auto destination with multiple providers (interactive)
- GIVEN both `~/.claude/skills` and `~/.codex/skills` exist
- WHEN running `ccski install repo -i` with no `--out-*`
- THEN the picker shows checkboxes for claude project, claude user, codex user, marking missing roots dimmed but selectable, and will create selected missing roots before install.

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

### Requirement: Source include/exclude filters and order
- CLI commands `list`, `info`, `search`, `validate`, `mcp`, `install`, `enable`, and `disable` SHALL accept repeatable `--include` and `--exclude` options together with state flags `--disabled` and `--all`; any command offering include/exclude MUST also surface these state flags in help and honour them.
- Each option value MAY contain comma-separated entries using syntax `auto|claude|codex|all|file` with optional `:<skillName>`. Bare names default to `auto`. Skill identifiers MUST also support plugin-qualified forms `@<pluginName>:<skillName>` and scope+plugin forms `<scopeName>@<pluginName>:<skillName>`. Group tokens MUST be supported: `@plugins` and `@plugins:<pluginName>` (Claude only). Wildcards `*`/`?` are allowed in skill names and plugin scopes. Tokens that target unsupported provider groups (e.g., `codex:@plugins`) MUST error with guidance. `file:<path>` and `--skill-dir` inject skills from arbitrary paths.
- Filtering order MUST be: state selection (`--all`/`--disabled`/default) → ordered includes (each token contributes; `auto` dedups only within that token) → path dedup → exclude (final removal). Because includes are ordered, `--include=auto,codex:foo` yields the auto-chosen `foo` plus the explicit codex `foo` unless they point to the same path. Excluded skills MUST NOT reappear via state flags.
#### Scenario: mixed include, exclude, and state
- GIVEN skills from both providers and at least one disabled Claude plugin skill
- WHEN running `ccski list --include=all --include=codex:foo --exclude=codex --exclude=claude:@plugins --disabled`
- THEN output lists disabled Claude project/user skills and still includes `codex:foo` (unless the same path was excluded), while omitting other Codex and Claude plugin skills; `ccski info --all --include=@canvas-design:webapp-testing` behaves consistently.

### Requirement: `--all` expands include scope
- For commands that expose the state flag, passing `--all` SHALL also default the include set to `all` only when no `--include` value is provided, so duplicate sources (including plugins) are surfaced instead of being auto-deduped.
#### Scenario: all without includes
- WHEN running `ccski list --all` with both a user skill `pdf` and a plugin skill `pdf`
- THEN both copies are listed because the implicit include becomes `all`.

### Requirement: Auto deduplication
- In `auto` mode (within include handling), when multiple skills share the same name across providers, the CLI MUST deduplicate by latest directory mtime; if tied, fall back to location priority `project > user > plugin`. Dedup applies only when `auto` is present in include set; `all` preserves duplicates.
#### Scenario: same name across providers
- GIVEN `pdf` exists in `.claude/skills` (mtime older) and `.codex/skills` (mtime newer)
- WHEN running `ccski list` with default filters
- THEN only the Codex `pdf` appears.

### Requirement: Provider-aware naming and display
- CLI commands MUST accept provider-prefixed names (`codex:foo`, `claude:foo`) to disambiguate lookups when multiple providers contain the same skill name; they MUST also accept plugin-qualified ids (`claude:@canvas-design:webapp-testing`) and scope+plugin ids (`codex:@myplugin:foo`) wherever names are parsed.
- Human-readable outputs MUST group results by provider then location, show provider badges or coloring, and show a `[disabled]` badge for disabled entries; group headers SHALL include counts. When rendering individual entries, the displayed skill-id MUST include the provider plus any plugin segment as `provider:@plugin:name` so users can copy/paste into `info`/`include`. JSON outputs MUST include `provider`, `disabled`, and `pluginInfo.pluginName` when present.
#### Scenario: info with provider prefix
- WHEN running `ccski info codex:@shop:pdf`
- THEN metadata reflects provider `codex`, plugin `shop`, and resolves even if a Claude `pdf` also exists.

### Requirement: Option scoping and neutrality
- Global options SHALL be limited to color/help/version plus locators `--user-dir` and `--skill-dir` (repeatable). `--skill-dir` is an alias for file injection and defaults to scope `other:<name>`; it MAY be overridden per entry via a query parameter (`--skill-dir=./custom?scope=docs`) to set the scope prefix. All other discovery/registry/install/validate options MUST be declared per-command. Provider-neutral wording is required; provider-specific file/root options MUST be explicit (e.g., `--claude-plugins-file`, `--claude-plugins-root`) and no default option may imply a single provider.
#### Scenario: help output clarity
- WHEN running `ccski list --help`
- THEN help shows only options relevant to `list` (include/exclude, state, skill-dir, claude-plugins-file/root), and global color/help/version flags are documented separately.

### Requirement: User directory override
- CLI SHALL accept a global `--user-dir <path>` option (default: user's home directory) that overrides the base directory used for user-level skill roots and plugin defaults. All default user-scope paths (e.g., `~/.claude/skills`, `~/.codex/skills`, `~/.claude/plugins`) MUST be resolved relative to this directory when provided. Command-specific overrides (e.g., `--claude-plugins-root`) still take precedence when set. `--skill-dir` entries SHOULD also resolve relative segments against the current working directory unless absolute.
#### Scenario: temporary home for tests
- GIVEN `--user-dir=/tmp/fakehome` and no other path overrides
- WHEN running `ccski list --scan-default-dirs`
- THEN user roots are resolved under `/tmp/fakehome` (e.g., `/tmp/fakehome/.claude/skills`, `/tmp/fakehome/.codex/skills`) and skills there are discoverable.
