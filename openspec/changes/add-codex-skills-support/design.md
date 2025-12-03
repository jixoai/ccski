# Design: Codex skills source support

## Context
- ccski today scans Claude-style roots (`.agent/.claude`, plugins) and exposes them via CLI + MCP.
- Codex skills live under `.codex/skills` and `~/.codex/skills`; Codex validation requires stricter length and single-line constraints.
- We need one filtering model that spans discovery, registry, CLI commands, and MCP tool output without duplicating logic.
- **Reference**: see `openspec/changes/add-codex-skills-support/chat.md` for the authoritative conversation trail guiding this change.

## Approach
1) **Provider tagging**: extend skill metadata with `provider: claude|codex`. Discovery assigns provider from its root set; plugin skills remain `claude`.
2) **Source roots**: add Codex roots (project + user). Keep location priority per provider: project > user > plugin; when auto-dedup compares across providers, it uses mtime first, then this location priority to stay deterministic.
3) **Filter grammar & groups**: parse `--include/--exclude` values into structured filters. Multiple flags allowed; commas separate entries; `source:name` syntax; bare names default to `auto`. Default include is `auto`. Add group tokens: `@plugins` (all plugin skills for provider—Claude only), `@plugins:<pluginName>` (specific plugin; Claude only), and allow chaining with skill name (`claude:@plugins:foo:skill`). Support simple wildcards (`*` and `?`) on skill names and plugin scopes; if a token targets a provider that does not support the group (e.g., `codex:@plugins`), the parser MUST error with guidance.
4) **Application order (list/search/info/validate/toggle)**:
   - **State**: decide whether to load disabled skills (`--disabled`), all (`--all`), or enabled-only (default). State gates discovery of `.SKILL.md` vs `SKILL.md`.
   - **Include (ordered)**: process include tokens in the order provided. Each token contributes candidates; `auto` performs dedup *within that token* (mtime → location priority). Later tokens can reintroduce a name chosen differently (e.g., `auto,codex:foo` yields both the auto-chosen `foo` and explicit `codex:foo`).
   - **Path dedup**: if the same physical path appears multiple times (e.g., due to overlapping tokens), keep one copy; different providers/paths coexist.
   - **Exclude**: remove candidates matching exclude filters; excludes are final.
5) **Output UX**: human output shows badges for provider (`[claude]`/`[codex]`) and state (`[disabled]`), grouped by provider then location, with per-group counts and a total after filtering. JSON includes `provider` and `disabled` fields.
6) **Option scoping**: global options limited to color/help/version. Discovery/control options (include/exclude, skill-dir, plugin manifests, target, etc.) become per-command with provider-neutral wording (e.g., `--claude-plugins-file`, `--claude-plugins-root`; no default “plugins” flag that implies Claude). A shared builder wires only the relevant options for each command.
7) **Install flow (destinations)**: retire `--target/--global`; introduce `--out-dir` (string[], repeatable) and `--out-scope` (enum list: `claude`, `claude:@project`, `claude:@user`, `codex`, `codex:@user`).
   - Resolution order: collect all `--out-dir` values first; then expand any `--out-scope` tokens into concrete paths and append. Mappings: `claude`/`claude:@project` → `./.claude/skills`; `claude:@user` → `~/.claude/skills`; `codex`/`codex:@user` → `~/.codex/skills`; `codex:@project` is invalid and must error. If after expansion no destinations remain, default auto applies: if only one standard root exists, use it; if multiple exist, interactive mode shows a destination checkbox (claude project, claude user, codex user) with missing roots dimmed and creatable on selection; non-interactive must error asking for explicit `--out-scope` or `--out-dir`.
   - Include/exclude (and group tokens) filter the *source selection list*; auto dedup is **not** applied during install. Interactive picker shows provider badge, destination list (from out-dir + expanded out-scope), and a command preview reflecting inferred paths. Missing destination paths MAY be created when selected and must be stated in the preview.
  - Destination conflicts honor `--force/--override` and log provider + path context.
8) **Validate**: no flag needed—validation applies provider-specific rules automatically (Codex skills: length/single-line/symlink warn). Output follows tsc-style: list each error, then a summary block of totals (errors/warnings) per provider.
9) **MCP**: tool description and resolution honour the same filters; refresh re-applies; ambiguity across providers yields an error prompting provider-prefixed names. Add `--debug` to print the active filters/roots at startup for parity with CLI.

## UX specifics to address pain points
- **Grouping & totals**: list/search output grouped by provider, then location, with per-group counts and global count after filters & state are applied.
- **State visibility**: disabled skills always display `[disabled]` and are dimmed; enabled omit the badge; `--disabled` shows only disabled; `--all` shows both with badges.
- **Install interaction**: interactive picker should show provider badge, target root preview, and a “Command preview” with resolved `--target/--global` flags to reduce confusion.
- **Name resolution prompts**: when include/exclude removes all matches for a requested name (info/toggle), surface suggestions that mention provider prefixes.

## Open Questions / Risks
- Symlink handling: Codex spec discourages symlinks; propose warning-only unless target unreachable.
- Auto dedup tie-breaking: mtime first, fallback to location priority for deterministic results.
- Wildcards in include/exclude (e.g., `claude:public-*`) are out of scope for MVP; treat as literal names unless later requested.
