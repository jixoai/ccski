/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「SkillMetadata 增 canonicalPath/entryKind/ownership（ccski|external|unknown）」+
 * 「legacy 标注：无 state 记录的存量实目录 = materialized + provenance:"legacy-unknown"」
 * 正交意图：
 *   [1] 技能元数据与来源优先级类型（既有面：provider/location/sourceKind/插件信息）
 *   [2] store-link-kernel 批 2（E6/E7）：发现层内核标注增量类型——canonicalPath/
 *       entryKind/ownership/mode/provenance；全部可选（3.0 破坏边界内的增量形状，
 *       plugin 等非内核发现面不标注）
 * 妥协声明：内核字段保持可选而非判别 union——插件技能与递归子层条目不标注，
 * 强制化随批 3/4 API 面一起收口。
 */

/** Skill location types */
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
 * store-link-kernel 批 2（E6）：发现层顶层条目形态。
 * 仅顶层条目标注；递归子层条目不标注（递归不跟随 symlink，现状保持）。
 */
export type SkillEntryKind = "directory" | "symlink";

/**
 * store-link-kernel 批 2（E6）：发现层归属三态。
 * ccski = state 记录命中（canonicalPath 或条目路径命中 entities/projections）；
 * external = 顶层 symlink 的 canonicalPath 未命中 state 记录（外部 live-link，
 * 对其 mutation typed FOREIGN_OWNERSHIP 的拒绝面在批 4）；
 * unknown = 非 symlink 条目且 state 未记录（含 legacy 存量物化目录）。
 */
export type SkillOwnership = "ccski" | "external" | "unknown";

/**
 * store-link-kernel 批 2：发现层观察到的投影形态（只观察，不制造）。
 * symlink 条目 = link；目录条目 = materialized（含 legacy）；
 * "entity-local" = 目录条目命中 state ENTITY 记录（2026-10-07 G3 裁决第四形态：
 * 实体本体 ≠ 物化投影副本，实体记录是唯一权威）。
 */
export type SkillProjectionMode = "link" | "materialized" | "entity-local";

/**
 * store-link-kernel 批 2（E7）：legacy 标注。无 state 记录的存量物化目录 =
 * "legacy-unknown"；只标注不转换（spec Scenario: Legacy directory is never
 * auto-converted），转换只经批 5 migrate。
 */
export type SkillProvenance = "legacy-unknown";

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
  /**
   * store-link-kernel 批 2（E6）：canonical 实体路径。目录条目 = 自身绝对路径；
   * 顶层 symlink 条目 = 单层 realpath 解析目标。mutation 面以它区分投影路径
   * （path）与实体路径。
   */
  canonicalPath?: string;
  /** 顶层条目形态标注（仅发现层顶层；子层与 plugin 条目不标注） */
  entryKind?: SkillEntryKind;
  /** 归属三态（仅发现层顶层条目；判定规则见 SkillOwnership 注释） */
  ownership?: SkillOwnership;
  /** 发现层观察到的投影形态（仅发现层顶层条目） */
  mode?: SkillProjectionMode;
  /** legacy 标注：无 state 记录的存量物化目录 = "legacy-unknown" */
  provenance?: SkillProvenance;
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
