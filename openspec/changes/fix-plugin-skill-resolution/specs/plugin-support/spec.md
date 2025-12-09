## MODIFIED Requirements

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
