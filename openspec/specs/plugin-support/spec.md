# Capability: Plugin Support

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
- For each plugin entry, `installPath` MUST be resolved against `pluginsRoot` (default `~/.claude/plugins`).
- The tool SHALL recursively find all `SKILL.md` files under each install path.
- Each discovered skill MUST be named `pluginName:skillName`, include plugin metadata (pluginName, marketplace, version), and carry resource flags for `references/`, `scripts/`, and `assets/`.
#### Scenario: namespaced plugin skill
- GIVEN `example@claude` with an installPath containing `pdf/SKILL.md` whose frontmatter name is `pdf`
- WHEN discovery runs
- THEN the returned skill name is `example:pdf` and `pluginInfo.marketplace` equals `claude`.

### Requirement: Priority and conflicts
- Plugin skills MUST be treated as lowest priority; when a non-plugin skill with the same name exists, the plugin skill is skipped and a conflict recorded.
#### Scenario: duplicate plugin skill
- GIVEN a project skill `user` and a plugin skill `user`
- WHEN the registry refreshes
- THEN the plugin `user` is skipped and diagnostics record the skip reason.

### Requirement: Opt-out of plugins
- Setting `skipPlugins` or CLI `--no-plugins` MUST disable plugin discovery entirely.
#### Scenario: plugins disabled by flag
- GIVEN a valid plugin manifest
- WHEN running with `--no-plugins`
- THEN no plugin skills are loaded and diagnostics note that plugins were skipped.
