import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { InstalledPlugins, SkillMetadata } from "../types/index.js";
import { InstalledPluginsSchema } from "../types/schemas.js";
import { parseSkillFile } from "./parser.js";

const PLUGINS_FILE = join(homedir(), ".claude/plugins/installed_plugins.json");
const PLUGINS_ROOT = join(homedir(), ".claude/plugins");

export interface PluginDiscoveryDiagnostics {
  scannedPlugins: string[];
  warnings: string[];
}

export interface PluginDiscoveryOptions {
  pluginsFile?: string;
  pluginsRoot?: string;
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
  pluginsFile: string = PLUGINS_FILE,
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
      console.warn(`Warning: Invalid installed_plugins.json format:`, validation.error);
      diagnostics?.warnings.push("Invalid installed_plugins.json format");
      return null;
    }

    return validation.data;
  } catch (error) {
    console.warn(`Warning: Failed to load installed_plugins.json:`, error);
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
    console.warn(`Warning: Failed to scan plugin directory ${dir}:`, error);
    diagnostics.warnings.push(
      `Failed to scan plugin directory ${dir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return skillFiles;
}

/**
 * Discover skills from installed plugins
 */
export function discoverPluginSkills(
  options: PluginDiscoveryOptions = {}
): PluginDiscoveryResult {
  const diagnostics: PluginDiscoveryDiagnostics = {
    scannedPlugins: [],
    warnings: [],
  };

  const pluginsFile = options.pluginsFile ?? PLUGINS_FILE;
  diagnostics.scannedPlugins.push(pluginsFile);

  const plugins = loadInstalledPlugins(pluginsFile, diagnostics);
  if (!plugins) {
    return { skills: [], diagnostics };
  }

  const skills: SkillMetadata[] = [];
  const pluginsRoot = options.pluginsRoot ?? PLUGINS_ROOT;

  for (const [pluginKey, plugin] of Object.entries(plugins.plugins)) {
    const [pluginName, marketplace] = pluginKey.split("@");

    if (!pluginName || !marketplace) {
      continue;
    }

    const installPath = resolveInstallPath(plugin.installPath, pluginsRoot);
    const skillFiles = findSkillFiles(installPath, diagnostics);

    diagnostics.scannedPlugins.push(installPath);

    for (const skillFile of skillFiles) {
      try {
        const parsed = parseSkillFile(skillFile);
        const skillDir = dirname(skillFile);

        skills.push({
          name: `${pluginName}:${parsed.frontmatter.name}`,
          description: parsed.frontmatter.description,
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
      } catch (error) {
        console.warn(`Warning: Failed to parse plugin skill ${skillFile}:`, error);
        diagnostics.warnings.push(
          `Failed to parse plugin skill ${skillFile}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return { skills, diagnostics };
}
