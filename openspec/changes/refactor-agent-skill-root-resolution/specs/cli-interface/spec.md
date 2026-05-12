## MODIFIED Requirements

### Requirement: Source include/exclude filters and order

- CLI commands `list`, `info`, `search`, `validate`, `mcp`, `install`, `enable`, and `disable` SHALL accept repeatable `--include` and `--exclude` options together with state flags `--disabled` and `--all`; any command offering include/exclude MUST also surface these state flags in help and honour them.
- Each option value MAY contain comma-separated entries using syntax `auto|all|file|agents|claude|codex|gemini|openclaw|<discoveredProvider>` with optional `:<skillName>`. Bare names default to `auto`.
- Dynamic provider tokens MUST be accepted when the provider name exists in the discovered registry. Unknown provider-looking tokens that are not discovered providers MAY remain bare skill names to preserve namespaced skill compatibility.
- Skill identifiers MUST also support plugin-qualified forms `@<pluginName>:<skillName>` and scope+plugin forms `<scopeName>@<pluginName>:<skillName>`. Group tokens MUST be supported: `@plugins` and `@plugins:<pluginName>` (Claude only). Wildcards `*`/`?` are allowed in skill names and plugin scopes. Tokens that target unsupported provider groups (e.g., `codex:@plugins`) MUST error with guidance. `file:<path>` and `--skill-dir` inject skills from arbitrary paths.
- Filtering order MUST be: state selection (`--all`/`--disabled`/default) → ordered includes (each token contributes; `auto` dedups only within that token) → path dedup → exclude (final removal). Because includes are ordered, `--include=auto,codex:foo` yields the auto-chosen `foo` plus the explicit codex `foo` unless they point to the same path. Excluded skills MUST NOT reappear via state flags.

#### Scenario: dynamic provider include

- GIVEN discovery returns provider `myagent` with skill `review`
- WHEN running `ccski list --include=myagent:review`
- THEN output lists only `myagent:review`.

### Requirement: Auto deduplication

- In `auto` mode (within include handling), when multiple skills share the same base name across providers, the CLI MUST deduplicate by source priority first: custom roots > workspace agent-specific roots > workspace shared roots > user agent-specific roots > user shared roots > plugin skills.
- If source priority ties, the newer `SKILL.md` or `.SKILL.md` mtime MUST win.
- If mtime ties, the CLI MUST use deterministic provider ordering where built-in providers sort before dynamic providers and dynamic providers sort by provider name.
- Dedup applies only when `auto` is present in include set; `all` preserves duplicates.

#### Scenario: workspace agent-specific beats newer user shared

- GIVEN `review` exists in `<workspace>/.gemini/skills/review/SKILL.md`
- AND `review` exists in `~/.agents/skills/review/SKILL.md` with a newer mtime
- WHEN running `ccski list` with default filters
- THEN only the workspace Gemini `review` appears.

### Requirement: Provider-aware naming and display

- CLI commands MUST accept provider-prefixed names (`agents:foo`, `gemini:foo`, `openclaw:foo`, `codex:foo`, `claude:foo`, `<discoveredProvider>:foo`) to disambiguate lookups when multiple providers contain the same skill name; they MUST also accept plugin-qualified ids (`claude:@canvas-design:webapp-testing`) wherever names are parsed.
- Human-readable outputs MUST group results by provider then location, show provider badges or coloring, and show a `[disabled]` badge for disabled entries; group headers SHALL include counts. When rendering individual entries, the displayed skill-id MUST include the provider plus any plugin segment as `provider:@plugin:name` so users can copy/paste into `info`/`include`. JSON outputs MUST include `provider`, `disabled`, and `pluginInfo.pluginName` when present.

#### Scenario: info with shared provider prefix

- WHEN running `ccski info agents:review`
- THEN metadata reflects provider `agents` and resolves even if an agent-specific `review` also exists.

### Requirement: User directory override

- CLI SHALL accept a global `--user-dir <path>` option (default: user's home directory) that overrides the base directory used for user-level skill roots and plugin defaults. All default user-scope paths (including `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`, `~/.openclaw/skills`, shallow dynamic `~/.<agent>/skills`, and `~/.claude/plugins`) MUST be resolved relative to this directory when provided. Command-specific overrides (e.g., `--claude-plugins-root`) still take precedence when set. `--skill-dir` entries SHOULD also resolve relative segments against the current working directory unless absolute.

#### Scenario: temporary home for tests

- GIVEN `--user-dir=/tmp/fakehome` and no other path overrides
- WHEN running `ccski list --scan-default-dirs`
- THEN user roots are resolved under `/tmp/fakehome` (e.g., `/tmp/fakehome/.agents/skills`, `/tmp/fakehome/.claude/skills`, `/tmp/fakehome/.codex/skills`, `/tmp/fakehome/.gemini/skills`, and `/tmp/fakehome/.openclaw/skills`) and skills there are discoverable.
