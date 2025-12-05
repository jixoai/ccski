import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import debug from "debug";
import type { InstalledPlugins, SkillMetadata } from "../types/index.js";
import { InstalledPluginsSchema } from "../types/schemas.js";
import { colors } from "../utils/format.js";
import { parseSkillFile } from "./parser.js";

function defaultPluginsFile(userDir: string): string {
  return join(userDir, ".claude/plugins/installed_plugins.json");
}

function defaultPluginsRoot(userDir: string): string {
  return join(userDir, ".claude/plugins");
}

export interface PluginDiscoveryDiagnostics {
  scannedPlugins: string[];
  warnings: string[];
}

export interface PluginDiscoveryOptions {
  pluginsFile?: string;
  pluginsRoot?: string;
  userDir?: string;
}

export interface PluginDiscoveryResult {
  skills: SkillMetadata[];
  diagnostics: PluginDiscoveryDiagnostics;
}

function resolveInstallPath(rawPath: string, pluginsRoot: string): string {
  return isAbsolute(rawPath) ? rawPath : join(pluginsRoot, rawPath);
}

/**
 * Parse installed_plugins.json
 */
export function loadInstalledPlugins(
  pluginsFile: string,
  diagnostics?: PluginDiscoveryDiagnostics
): InstalledPlugins | null {
  if (!existsSync(pluginsFile)) {
    console.info(`[ccski] No plugin marketplace skills found at ${pluginsFile}`);
    diagnostics?.warnings.push(`Plugins file not found at ${pluginsFile}`);
    return null;
  }

  try {
    const content = readFileSync(pluginsFile, "utf-8");
    const json = JSON.parse(content);
    const validation = InstalledPluginsSchema.safeParse(json);

    if (!validation.success) {
      console.warn(
        colors.yellow(`Warning: Invalid installed_plugins.json format:`),
        validation.error
      );
      diagnostics?.warnings.push("Invalid installed_plugins.json format");
      return null;
    }

    return validation.data;
  } catch (error) {
    console.warn(colors.yellow(`Warning: Failed to load installed_plugins.json:`), error);
    diagnostics?.warnings.push(
      `Failed to load installed_plugins.json: ${error instanceof Error ? error.message : String(error)}`
    );
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
    console.warn(colors.yellow(`Warning: Failed to scan plugin directory ${dir}:`), error);
    diagnostics.warnings.push(
      `Failed to scan plugin directory ${dir}: ${error instanceof Error ? error.message : String(error)}`
    );
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
  };

  const userDir = options.userDir ? resolve(options.userDir) : homedir();

  const pluginsFile = options.pluginsFile ?? defaultPluginsFile(userDir);
  diagnostics.scannedPlugins.push(pluginsFile);

  const skills: SkillMetadata[] = [];
  const seenPaths = new Set<string>();
  const pluginsRoot = options.pluginsRoot ?? defaultPluginsRoot(userDir);
  let missingOrEmpty = false;

  const plugins = loadInstalledPlugins(pluginsFile, diagnostics);
  log("plugins file=%s loaded=%s", pluginsFile, Boolean(plugins));

  if (plugins) {
    for (const [pluginKey, plugin] of Object.entries(plugins.plugins)) {
      const [pluginName, marketplace] = pluginKey.split("@");

      if (!pluginName || !marketplace) {
        continue;
      }

      const installPath = resolveInstallPath(plugin.installPath, pluginsRoot);
      const skillFiles = findSkillFiles(installPath, diagnostics);

      if (!skillFiles.length) {
        if (!existsSync(installPath)) {
          diagnostics.warnings.push(`Plugin install path not found: ${installPath}`);
          log("missing installPath: %s", installPath);
        } else {
          diagnostics.warnings.push(`No skills found in plugin install path: ${installPath}`);
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
            path: skillDir,
            hasReferences: existsSync(join(skillDir, "references")),
            hasScripts: existsSync(join(skillDir, "scripts")),
            hasAssets: existsSync(join(skillDir, "assets")),
            pluginInfo: {
              pluginName,
              marketplace,
              version: plugin.version,
            },
          });
          seenPaths.add(skillDir);
        } catch (error) {
          console.warn(colors.yellow(`Warning: Failed to parse plugin skill ${skillFile}:`), error);
          diagnostics.warnings.push(
            `Failed to parse plugin skill ${skillFile}: ${error instanceof Error ? error.message : String(error)}`
          );
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
        console.warn(colors.yellow(`Warning: Failed to parse plugin skill ${skillFile}:`), error);
        diagnostics.warnings.push(
          `Failed to parse plugin skill ${skillFile}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return { skills, diagnostics };
}
