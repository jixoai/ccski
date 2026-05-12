import debug from "debug";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CcskiDiagnostic } from "../types/diagnostics.js";
import { diagnosticToWarning } from "../types/diagnostics.js";
import type { InstalledPlugins, PluginEntry, SkillMetadata } from "../types/index.js";
import { ClaudeSettingsSchema } from "../types/schemas.js";
import { parseSkillFile } from "./parser.js";

function defaultPluginsFile(userDir: string): string {
  return join(userDir, ".claude/plugins/installed_plugins.json");
}

function defaultPluginsRoot(userDir: string): string {
  return join(userDir, ".claude/plugins");
}

function defaultSettingsFile(userDir: string): string {
  return join(userDir, ".claude/settings.json");
}

export interface PluginDiscoveryDiagnostics {
  scannedPlugins: string[];
  warnings: string[];
  events: CcskiDiagnostic[];
}

export interface PluginDiscoveryOptions {
  pluginsFile?: string;
  pluginsRoot?: string;
  settingsFile?: string;
  userDir?: string;
}

export interface PluginDiscoveryResult {
  skills: SkillMetadata[];
  diagnostics: PluginDiscoveryDiagnostics;
}

function resolveInstallPath(rawPath: string, pluginsRoot: string): string {
  return isAbsolute(rawPath) ? rawPath : join(pluginsRoot, rawPath);
}

function normalizePluginEntries(entry: PluginEntry | PluginEntry[]): PluginEntry[] {
  return Array.isArray(entry) ? entry : [entry];
}

function addPluginDiagnostic(
  diagnostics: PluginDiscoveryDiagnostics | undefined,
  diagnostic: CcskiDiagnostic
): void {
  diagnostics?.events.push(diagnostic);
  diagnostics?.warnings.push(diagnosticToWarning(diagnostic));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizePluginEntry(
  pluginKey: string,
  value: unknown,
  index: number,
  diagnostics?: PluginDiscoveryDiagnostics
): PluginEntry | null {
  if (!isRecord(value)) {
    addPluginDiagnostic(diagnostics, {
      severity: "warning",
      source: "plugin",
      code: "invalid-plugin-entry",
      message: `Skipped plugin entry ${pluginKey}[${index}] because it is not an object.`,
      details: { pluginKey, index },
    });
    return null;
  }

  const installPath = readString(value.installPath);
  if (!installPath) {
    addPluginDiagnostic(diagnostics, {
      severity: "warning",
      source: "plugin",
      code: "missing-plugin-install-path",
      message: `Skipped plugin entry ${pluginKey}[${index}] because installPath is missing.`,
      details: { pluginKey, index },
    });
    return null;
  }

  return {
    version: readString(value.version) ?? "unknown",
    installedAt: readString(value.installedAt) ?? "",
    lastUpdated: readString(value.lastUpdated) ?? "",
    installPath,
    gitCommitSha: readString(value.gitCommitSha) ?? "",
    isLocal: typeof value.isLocal === "boolean" ? value.isLocal : false,
    ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
  };
}

function normalizeInstalledPlugins(
  json: unknown,
  diagnostics?: PluginDiscoveryDiagnostics
): InstalledPlugins | null {
  if (!isRecord(json) || !isRecord(json.plugins)) {
    addPluginDiagnostic(diagnostics, {
      severity: "warning",
      source: "plugin",
      code: "invalid-installed-plugins",
      message: "installed_plugins.json does not contain a valid plugins object.",
    });
    return null;
  }

  const plugins: InstalledPlugins["plugins"] = {};

  for (const [pluginKey, rawEntry] of Object.entries(json.plugins)) {
    const rawEntries = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
    const entries = rawEntries
      .map((entry, index) => normalizePluginEntry(pluginKey, entry, index, diagnostics))
      .filter((entry): entry is PluginEntry => entry !== null);

    if (entries.length === 1) {
      plugins[pluginKey] = entries[0]!;
    } else if (entries.length > 1) {
      plugins[pluginKey] = entries;
    }
  }

  return {
    version: typeof json.version === "number" ? json.version : 0,
    plugins,
  };
}

function loadClaudeSettings(
  settingsFile: string,
  diagnostics?: PluginDiscoveryDiagnostics
): { enabledPlugins?: Record<string, boolean> } | null {
  if (!existsSync(settingsFile)) {
    diagnostics?.warnings.push(`Settings file not found at ${settingsFile}`);
    return null;
  }

  try {
    const content = readFileSync(settingsFile, "utf-8");
    const json = JSON.parse(content);
    const validation = ClaudeSettingsSchema.safeParse(json);

    if (!validation.success) {
      addPluginDiagnostic(diagnostics, {
        severity: "warning",
        source: "plugin",
        code: "invalid-claude-settings",
        message: "Invalid settings.json format.",
        details: { file: settingsFile, issues: validation.error.issues },
      });
      return null;
    }

    return validation.data as { enabledPlugins?: Record<string, boolean> };
  } catch (error) {
    addPluginDiagnostic(diagnostics, {
      severity: "warning",
      source: "plugin",
      code: "failed-to-load-claude-settings",
      message: `Failed to load settings.json: ${error instanceof Error ? error.message : String(error)}`,
      details: { file: settingsFile },
    });
    return null;
  }
}

function resolveEnabledPlugins(
  settings: { enabledPlugins?: Record<string, boolean> } | null
): Set<string> | null {
  const enabledPlugins = settings?.enabledPlugins;
  if (!enabledPlugins) return null;
  const enabled = Object.entries(enabledPlugins)
    .filter(([, isEnabled]) => isEnabled)
    .map(([pluginKey]) => pluginKey);
  return new Set(enabled);
}

/**
 * Parse installed_plugins.json
 */
export function loadInstalledPlugins(
  pluginsFile: string,
  diagnostics?: PluginDiscoveryDiagnostics
): InstalledPlugins | null {
  if (!existsSync(pluginsFile)) {
    addPluginDiagnostic(diagnostics, {
      severity: "info",
      source: "plugin",
      code: "plugins-file-not-found",
      message: `Plugins file not found at ${pluginsFile}`,
      details: { file: pluginsFile },
    });
    return null;
  }

  try {
    const content = readFileSync(pluginsFile, "utf-8");
    const json = JSON.parse(content);
    return normalizeInstalledPlugins(json, diagnostics);
  } catch (error) {
    addPluginDiagnostic(diagnostics, {
      severity: "warning",
      source: "plugin",
      code: "failed-to-load-installed-plugins",
      message: `Failed to load installed_plugins.json: ${error instanceof Error ? error.message : String(error)}`,
      details: { file: pluginsFile },
    });
    return null;
  }
}

/**
 * Recursively find SKILL.md files in a directory
 */
function findSkillFiles(dir: string, diagnostics: PluginDiscoveryDiagnostics): string[] {
  const skillFiles: string[] = [];

  if (!existsSync(dir)) {
    return skillFiles;
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories
        skillFiles.push(...findSkillFiles(fullPath, diagnostics));
      } else if (entry.name === "SKILL.md") {
        skillFiles.push(fullPath);
      }
    }
  } catch (error) {
    addPluginDiagnostic(diagnostics, {
      severity: "warning",
      source: "plugin",
      code: "failed-to-scan-plugin-directory",
      message: `Failed to scan plugin directory ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      details: { directory: dir },
    });
  }

  return skillFiles;
}

/**
 * Discover skills from installed plugins
 */
export function discoverPluginSkills(options: PluginDiscoveryOptions = {}): PluginDiscoveryResult {
  const log = debug("ccski:plugins");
  const diagnostics: PluginDiscoveryDiagnostics = {
    scannedPlugins: [],
    warnings: [],
    events: [],
  };

  const userDir = options.userDir ? resolve(options.userDir) : homedir();

  const pluginsFile = options.pluginsFile ?? defaultPluginsFile(userDir);
  diagnostics.scannedPlugins.push(pluginsFile);
  const settingsFile = options.settingsFile ?? defaultSettingsFile(userDir);

  const skills: SkillMetadata[] = [];
  const seenPaths = new Set<string>();
  const pluginsRoot = options.pluginsRoot ?? defaultPluginsRoot(userDir);
  let missingOrEmpty = false;

  const plugins = loadInstalledPlugins(pluginsFile, diagnostics);
  const settings = loadClaudeSettings(settingsFile, diagnostics);
  const enabledPlugins = resolveEnabledPlugins(settings);
  log("plugins file=%s loaded=%s", pluginsFile, Boolean(plugins));
  log("settings file=%s enabledPlugins=%s", settingsFile, enabledPlugins?.size ?? "all");

  if (plugins) {
    for (const [pluginKey, plugin] of Object.entries(plugins.plugins)) {
      if (enabledPlugins && !enabledPlugins.has(pluginKey)) {
        log("plugin %s disabled by settings", pluginKey);
        continue;
      }

      const [pluginName, marketplace] = pluginKey.split("@");

      if (!pluginName || !marketplace) {
        continue;
      }

      const entries = normalizePluginEntries(plugin);
      for (const entry of entries) {
        const installPath = resolveInstallPath(entry.installPath, pluginsRoot);
        const skillFiles = findSkillFiles(installPath, diagnostics);

        if (!skillFiles.length) {
          if (!existsSync(installPath)) {
            addPluginDiagnostic(diagnostics, {
              severity: "warning",
              source: "plugin",
              code: "plugin-install-path-not-found",
              message: `Plugin install path not found: ${installPath}`,
              details: { installPath, pluginKey },
            });
            log("missing installPath: %s", installPath);
          } else {
            addPluginDiagnostic(diagnostics, {
              severity: "info",
              source: "plugin",
              code: "no-skills-in-plugin-install-path",
              message: `No skills found in plugin install path: ${installPath}`,
              details: { installPath, pluginKey },
            });
            log("empty installPath: %s", installPath);
          }
          missingOrEmpty = true;
        }

        diagnostics.scannedPlugins.push(installPath);
        log("scanned manifest plugin=%s skills=%d", pluginName, skillFiles.length);

        for (const skillFile of skillFiles) {
          try {
            const parsed = parseSkillFile(skillFile);
            const skillDir = dirname(skillFile);
            if (seenPaths.has(skillDir)) continue;

            const skillName = parsed.frontmatter.name;
            const namespaced = skillName.includes(":")
              ? skillName
              : pluginName === skillName
                ? skillName
                : `${pluginName}:${skillName}`;

            skills.push({
              name: namespaced,
              description: parsed.frontmatter.description,
              provider: "claude",
              location: "plugin",
              sourceKind: "plugin",
              sourcePriority: 0,
              path: skillDir,
              hasReferences: existsSync(join(skillDir, "references")),
              hasScripts: existsSync(join(skillDir, "scripts")),
              hasAssets: existsSync(join(skillDir, "assets")),
              pluginInfo: {
                pluginName,
                marketplace,
                version: entry.version,
              },
            });
            seenPaths.add(skillDir);
          } catch (error) {
            addPluginDiagnostic(diagnostics, {
              severity: "warning",
              source: "plugin",
              code: "failed-to-parse-plugin-skill",
              message: `Failed to parse plugin skill ${skillFile}: ${error instanceof Error ? error.message : String(error)}`,
              details: { file: skillFile },
            });
          }
        }
      }
    }
  }

  // Fallback: scan <pluginsRoot>/skills when enabled via env and manifest missing/invalid/empty
  const fallbackEnabled = process.env.CCSKI_CLAUDE_PLUGINS_FALLBACK === "true";
  if (!fallbackEnabled) {
    log("fallback scan skipped (CCSKI_CLAUDE_PLUGINS_FALLBACK!=true)");
    return { skills, diagnostics };
  }
  if (enabledPlugins) {
    log("fallback scan skipped (enabledPlugins present)");
    return { skills, diagnostics };
  }

  if (!plugins || skills.length === 0 || missingOrEmpty) {
    const fallbackRoot = join(pluginsRoot, "skills");
    diagnostics.scannedPlugins.push(fallbackRoot);
    log("running fallback scan at %s", fallbackRoot);
    const skillFiles = findSkillFiles(fallbackRoot, diagnostics);

    for (const skillFile of skillFiles) {
      try {
        const parsed = parseSkillFile(skillFile);
        const skillDir = dirname(skillFile);
        if (seenPaths.has(skillDir)) continue;

        const rel = relative(fallbackRoot, skillDir).split(sep).filter(Boolean);
        const pluginName = rel[0] ?? "local";
        const skillName = parsed.frontmatter.name;
        const namespaced = skillName.includes(":")
          ? skillName
          : pluginName === skillName
            ? skillName
            : `${pluginName}:${skillName}`;

        skills.push({
          name: namespaced,
          description: parsed.frontmatter.description,
          provider: "claude",
          location: "plugin",
          sourceKind: "plugin",
          sourcePriority: 0,
          path: skillDir,
          hasReferences: existsSync(join(skillDir, "references")),
          hasScripts: existsSync(join(skillDir, "scripts")),
          hasAssets: existsSync(join(skillDir, "assets")),
          pluginInfo: {
            pluginName,
            marketplace: "local",
            version: "unknown",
          },
        });
        seenPaths.add(skillDir);
        log("fallback skill added %s (%s)", namespaced, skillDir);
      } catch (error) {
        addPluginDiagnostic(diagnostics, {
          severity: "warning",
          source: "plugin",
          code: "failed-to-parse-plugin-skill",
          message: `Failed to parse plugin skill ${skillFile}: ${error instanceof Error ? error.message : String(error)}`,
          details: { file: skillFile },
        });
      }
    }
  }

  return { skills, diagnostics };
}
