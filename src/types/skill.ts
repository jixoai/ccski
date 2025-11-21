/**
 * Skill location types
 */
export type SkillLocation = "user" | "project" | "plugin";

/**
 * Core skill metadata interface
 */
export interface SkillMetadata {
  /** Skill name (from frontmatter) */
  name: string;
  /** Skill description (from frontmatter) */
  description: string;
  /** Location type */
  location: SkillLocation;
  /** Absolute path to skill directory */
  path: string;
  /** Whether the skill has a references/ directory */
  hasReferences: boolean;
  /** Whether the skill has a scripts/ directory */
  hasScripts: boolean;
  /** Whether the skill has an assets/ directory */
  hasAssets: boolean;
  /** Plugin information (only for plugin skills) */
  pluginInfo?: {
    pluginName: string;
    marketplace: string;
    version: string;
  };
}

/**
 * Complete skill interface with content
 */
export interface Skill extends SkillMetadata {
  /** Full markdown content (including frontmatter) */
  content: string;
  /** Full qualified name (e.g., "plugin:skill" for plugin skills) */
  fullName: string;
}

/**
 * SKILL.md frontmatter interface
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  [key: string]: unknown; // Allow additional fields
}

/**
 * Plugin registry entry from installed_plugins.json
 */
export interface PluginEntry {
  version: string;
  installedAt: string;
  lastUpdated: string;
  installPath: string;
  gitCommitSha: string;
  isLocal: boolean;
}

/**
 * Installed plugins JSON structure
 */
export interface InstalledPlugins {
  version: number;
  plugins: Record<string, PluginEntry>;
}
