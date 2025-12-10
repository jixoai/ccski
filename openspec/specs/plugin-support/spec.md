# Capability: Plugin Support

## Purpose
Ensure ccski can discover and register skills shipped via Claude plugins or plugin marketplaces while keeping local/project skills authoritative.
## Requirements
### Requirement: Load installed_plugins manifest
- The default path `~/.claude/plugins/installed_plugins.json` MUST be parsed when present.
- The manifest MUST be validated against the expected schema `{ version: number, plugins: record }`; invalid or missing files trigger a warning and plugin discovery is skipped without throwing.
- `pluginsFile` / `--plugins-file` MAY override the manifest path.
#### Scenario: missing manifest
- GIVEN the plugins file is absent
- WHEN plugin discovery runs
- THEN diagnostics include a warning and zero plugin skills are returned.

### Requirement: Resolve install paths and scan recursively
- For each plugin entry in `installed_plugins.json`, the tool SHALL attempt to locate the corresponding `marketplace.json` file (either at `<installPath>/../.claude-plugin/marketplace.json` or `<installPath>/.claude-plugin/marketplace.json`).
- When `marketplace.json` is found and valid, the tool SHALL:
  - Parse the `plugins` array to find the plugin matching the entry's plugin name
  - Resolve each path in the plugin's `skills` array relative to `installPath`
  - Only discover skills explicitly declared in the `skills` configuration
- When `marketplace.json` is not found or invalid, the tool SHALL fall back to recursively scanning `installPath` for all `SKILL.md` files.
- Each discovered skill MUST be named `pluginName:skillName`, include plugin metadata (pluginName, marketplace, version), and carry resource flags for `references/`, `scripts/`, and `assets/`.
- `installPath` MUST be resolved against `pluginsRoot` (default `~/.claude/plugins`) when it is a relative path.

#### Scenario: marketplace.json with explicit skills configuration
- GIVEN `example-skills@anthropic-agent-skills` with `installPath=/Users/.../.claude/plugins/marketplaces/anthropic-agent-skills/` and `marketplace.json` containing `{ "plugins": [{ "name": "example-skills", "source": "./", "skills": ["./skills/canvas-design", "./skills/pdf"] }] }`
- WHEN discovery runs
- THEN only `canvas-design` and `pdf` skills are discovered (not the entire directory tree), names are `example-skills:canvas-design` and `example-skills:pdf`, and `pluginInfo.marketplace` equals `anthropic-agent-skills`.

#### Scenario: marketplace.json not found
- GIVEN a plugin entry with `installPath` pointing to a directory without `marketplace.json`
- WHEN discovery runs
- THEN the tool falls back to recursive scanning and diagnostics note the fallback.

#### Scenario: namespaced plugin skill
- GIVEN `example@claude` with an installPath containing `pdf/SKILL.md` whose frontmatter name is `pdf`
- WHEN discovery runs
- THEN the returned skill name is `example:pdf` and `pluginInfo.marketplace` equals `claude`.

### Requirement: Priority and conflicts
- Plugin skills REMAIN the lowest priority for auto selection, but they MUST NOT be dropped when a non-plugin skill shares the same name. Instead, discovery/registry records a conflict and keeps both so filter choices like `--include=all` can surface every copy. During automatic deduplication, non-plugin copies MUST win over plugin copies when names collide, regardless of mtime, to keep local/project skills authoritative.
#### Scenario: duplicate plugin skill retained
- GIVEN a project skill `user` and a plugin skill `user`
- WHEN the registry refreshes
- THEN diagnostics record the duplicate and both skills are available for filtering; running `ccski list --all` shows both.

### Requirement: Opt-out of plugins
- Setting `skipPlugins` or CLI `--no-plugins` MUST disable plugin discovery entirely.
#### Scenario: plugins disabled by flag
- GIVEN a valid plugin manifest
- WHEN running with `--no-plugins`
- THEN no plugin skills are loaded and diagnostics note that plugins were skipped.

### Requirement: Fallback scan when manifest is missing, unusable, or empty
- If `installed_plugins.json` is missing, invalid, or resolves to install paths that do not exist or produce zero `SKILL.md` files, plugin discovery SHALL still scan `<pluginsRoot>/skills` (default `~/.claude/plugins/skills`, respecting `--user-dir`) recursively for `SKILL.md` files when the environment variable `CCSKI_CLAUDE_PLUGINS_FALLBACK=true` is set. Default behavior is to skip fallback when the env is absent or false.
- Skills found via this fallback MUST use provider `claude`, location `plugin`, and be named by prefixing the first path segment under `skills` (`{pluginDir}`), except when the frontmatter name already contains a namespace or exactly equals `{pluginDir}`—in those cases keep the frontmatter name to avoid double prefixes. `pluginInfo` MUST be set with `pluginName=pluginDir`, `marketplace="local"`, and `version="unknown"`. Diagnostics MUST record the fallback path and any missing/empty install paths derived from the manifest. Debug logging MUST be available via the `DEBUG=ccski:plugins*` namespace to show manifest vs fallback decisions.
#### Scenario: manifest valid but installPath missing with fallback enabled
- GIVEN `CCSKI_CLAUDE_PLUGINS_FALLBACK=true`, a valid `installed_plugins.json` that references `installPath=/missing/plugin`, and `~/.claude/plugins/skills/canvas-design/SKILL.md` exists
- WHEN discovery runs
- THEN diagnostics note the missing install path, fallback scanning occurs, and `canvas-design:canvas-design` (assuming frontmatter name `canvas-design`) is returned with provider `claude` and location `plugin`; DEBUG logs show the missing path and fallback scan.

### Requirement: Parse marketplace.json structure
- The tool SHALL support parsing `marketplace.json` files with the following structure:
  - `name`: string (marketplace name)
  - `plugins`: array of plugin objects, each containing:
    - `name`: string (plugin name)
    - `source`: string (relative path from marketplace root)
    - `skills`: array of strings (relative paths to skill directories)
- Invalid or malformed `marketplace.json` files MUST trigger a warning and fall back to recursive scanning.

#### Scenario: valid marketplace.json parsing
- GIVEN a `marketplace.json` with multiple plugins each having distinct skills arrays
- WHEN the tool parses the file
- THEN each plugin's skills are resolved correctly and only declared skills are discovered.

#### Scenario: malformed marketplace.json
- GIVEN a `marketplace.json` with invalid JSON or missing required fields
- WHEN the tool attempts to parse it
- THEN a warning is logged and recursive scanning is used as fallback.

