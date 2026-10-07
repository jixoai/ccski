/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「3.0 移除 2.x mutation 入口——不造兼容胶层（§8）；
 * 保留面：listSkills/getSkillInfo/validateSkill/searchSkills」（批 5 2.x 入口迁移
 * 裁决；退役符号名不在注释中复述，避免进入发版产物）
 * 正交意图：
 *   [1] 保留面的选项/结果类型（list/info/search/validate + 过滤器）
 *   [2] workflow 安装类型（3.0 边界外，随 workflow-install.ts 保留）
 *   [3] 内核 mutation 的类型已迁至各自模块（entity 家族 / migrate / gc / repair /
 *       claim）——本文件不再承载 mutation 载荷（2.x Install/Remove/Toggle 类型族随
 *       入口退役）
 * 妥协声明：无（无兼容策略 §8：不保留 alias、不保留胶水类型）。
 */
import type { SkillMetadata } from "../types/skill.js";
import type { RegistryInput } from "../utils/registry-options.js";

export interface FilterOptions {
  include?: string[];
  exclude?: string[];
  all?: boolean;
  disabled?: boolean;
}

export interface ListOptions extends RegistryInput, FilterOptions {}

/** info 投影面选项（Field visibility contract：投影恒不含正文；正文走 readSkillContent） */
export interface InfoOptions extends RegistryInput, FilterOptions {
  name: string;
}

/** 显式文件读取面选项（spec: file contents only via explicit file-read paths） */
export interface SkillContentOptions extends RegistryInput, FilterOptions {
  name: string;
}

export interface SearchOptions extends RegistryInput, FilterOptions {
  query: string;
  content?: boolean;
  limit?: number;
}

export interface ValidateOptions extends RegistryInput, FilterOptions {
  path: string;
}

export type AgentInstructionScope = "user" | "project";

export interface AgentInstructionTarget {
  id: string;
  label: string;
  aliases: readonly string[];
  userPath: readonly string[];
  projectPath: readonly string[];
}

export interface WorkflowInstallOptions {
  agents?: string[];
  scope?: AgentInstructionScope;
  userDir?: string;
  projectDir?: string;
  dryRun?: boolean;
}

export interface WorkflowInstallResultEntry {
  agent: string;
  label: string;
  scope: AgentInstructionScope;
  path: string;
  status: "installed" | "updated" | "unchanged" | "failed";
  error?: string;
}

export interface WorkflowInstallResult {
  scope: AgentInstructionScope;
  dryRun: boolean;
  results: WorkflowInstallResultEntry[];
  installed: number;
  updated: number;
  unchanged: number;
  failed: number;
}

/**
 * info 投影 DTO（Field visibility contract）：只含领域字段——identity/mode/路径/
 * 结构标记；SKILL.md 正文与 frontmatter 载荷不进本 DTO（显式读取走
 * readSkillContent → SkillContentResult）。
 */
export interface SkillInfoResult {
  name: string;
  description: string;
  provider: SkillMetadata["provider"];
  location: SkillMetadata["location"];
  path: string;
  size: number;
  disabled: boolean;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo: SkillMetadata["pluginInfo"] | null;
}

/** 显式文件读取 DTO（SKILL.md 全文，含 frontmatter；仅本面携带正文） */
export interface SkillContentResult {
  name: string;
  path: string;
  size: number;
  disabled: boolean;
  content: string;
}

export interface SearchResultItem {
  name: string;
  description: string;
  location: SkillMetadata["location"];
  provider: SkillMetadata["provider"];
  disabled: boolean;
  path: string;
}

export interface ValidateResult {
  file: string;
  success: boolean;
  errors: string[];
  warnings: string[];
}
