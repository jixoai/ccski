# Capability Delta: Plugin Support

## MODIFIED Requirements

### Requirement: Priority and conflicts
- Plugin skills REMAIN the lowest priority for auto selection, but they MUST NOT be dropped when a non-plugin skill shares the same name. Instead, discovery/registry records a conflict and keeps both so filter choices like `--include=all` can surface every copy.
 - During automatic deduplication, non-plugin copies MUST win over plugin copies when names collide, regardless of mtime, to keep local/project skills authoritative.
#### Scenario: duplicate plugin skill retained
- GIVEN a project skill `user` and a plugin skill `user`
- WHEN the registry refreshes
- THEN diagnostics record the duplicate and both skills are available for filtering; running `ccski list --all` shows both.

### Requirement: Fallback scan when manifest is missing, unusable, or empty
- If `installed_plugins.json` is missing, invalid, or resolves to install paths that do not exist **or produce zero `SKILL.md` files**, plugin discovery SHALL still scan `<pluginsRoot>/skills` (default `~/.claude/plugins/skills`, respecting `--user-dir`) recursively for `SKILL.md` files **when the environment variable `CCSKI_CLAUDE_PLUGINS_FALLBACK=true` is set**. Default behavior is to skip fallback when the env is absent or false.
- Skills found via this fallback MUST use provider `claude`, location `plugin`, and be named by prefixing the first path segment under `skills` (`{pluginDir}`), **except** when the frontmatter name already contains a namespace or exactly equals `{pluginDir}`—in those cases keep the frontmatter name to avoid double prefixes. `pluginInfo` MUST be set with `pluginName=pluginDir`, `marketplace="local"`, and `version="unknown"`. Diagnostics MUST record the fallback path **and** any missing/empty install paths derived from the manifest. Debug logging MUST be available via the `DEBUG=ccski:plugins*` namespace to show manifest vs fallback decisions.
#### Scenario: manifest valid but installPath missing with fallback enabled
- GIVEN `CCSKI_CLAUDE_PLUGINS_FALLBACK=true`, a valid `installed_plugins.json` that references `installPath=/missing/plugin`, and `~/.claude/plugins/skills/canvas-design/SKILL.md` exists
- WHEN discovery runs
- THEN diagnostics note the missing install path, fallback scanning occurs, and `canvas-design:canvas-design` (assuming frontmatter name `canvas-design`) is returned with provider `claude` and location `plugin`; DEBUG logs show the missing path and fallback scan.
