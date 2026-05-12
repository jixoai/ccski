/**
 * Skill location types
 */
export type SkillLocation = "user" | "project" | "plugin";

export const BUILT_IN_SKILL_PROVIDERS = [
  "agents",
  "claude",
  "codex",
  "gemini",
  "openclaw",
  "file",
] as const;

export type BuiltInSkillProvider = (typeof BUILT_IN_SKILL_PROVIDERS)[number];
export type SkillProvider = BuiltInSkillProvider | (string & {});

export const SKILL_SOURCE_PRIORITIES = {
  plugin: 0,
  "user-shared": 100,
  "user-agent": 200,
  "workspace-root": 300,
  "workspace-shared": 400,
  "workspace-agent": 500,
  custom: 600,
} as const;

export type SkillSourceKind = keyof typeof SKILL_SOURCE_PRIORITIES;

/**
 * Core skill metadata interface
 */
export interface SkillMetadata {
  /** Skill name (from frontmatter) */
  name: string;
  /** Skill description (from frontmatter) */
  description: string;
  /** Whether the skill is disabled (.SKILL.md) */
  disabled?: boolean;
  /** Provider (built-in agent/shared provider or discovered dynamic provider) */
  provider: SkillProvider;
  /** Location type */
  location: SkillLocation;
  /** Source priority used by auto deduplication; higher wins */
  sourcePriority?: number;
  /** Source class used to explain discovery precedence */
  sourceKind?: SkillSourceKind;
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
  scope?: string;
}

/**
 * Installed plugins JSON structure
 */
export interface InstalledPlugins {
  version: number;
  plugins: Record<string, PluginEntry | PluginEntry[]>;
}
