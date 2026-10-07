/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「info/list 默认不含正文；正文仅显式 full/file-read
 * 面——域字段 DTO 与文件读取 DTO 分离」（spec: Field visibility contract）
 * 正交意图：
 *   [1] getSkillInfo = 投影面：只返回领域字段（identity/mode/路径/结构标记），
 *       恒不携带 SKILL.md 正文（frontmatter 载荷不进投影）
 *   [2] readSkillContent = 显式文件读取面：唯一携带 SKILL.md 全文（含
 *       frontmatter）的 DTO；调用即显式读取请求
 * 妥协声明：无。
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { SkillRegistry } from "../core/registry.js";
import { applyFilters } from "../utils/filters.js";
import { providerNamesFromSkills } from "../utils/providers.js";
import { buildRegistryOptions } from "../utils/registry-options.js";
import { resolveSkill } from "../utils/resolution.js";
import { resolveFilters } from "./filters.js";
import type {
  InfoOptions,
  SkillContentOptions,
  SkillContentResult,
  SkillInfoResult,
} from "./types.js";

interface ResolvedSkillEntry {
  name: string;
  description: string;
  provider: SkillInfoResult["provider"];
  location: SkillInfoResult["location"];
  path: string;
  size: number;
  disabled: boolean;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo: SkillInfoResult["pluginInfo"];
  content: string;
}

function resolveSkillEntry(
  options: InfoOptions | SkillContentOptions
): ResolvedSkillEntry {
  const includeDisabled = Boolean(options.all || options.disabled);
  const registry = new SkillRegistry(buildRegistryOptions(options, { includeDisabled }));
  const { includes, excludes, state } = resolveFilters(options, {
    providers: providerNamesFromSkills(registry.getAll()),
  });
  const filtered = applyFilters(registry.getAll(), includes, excludes, state);
  const resolved = resolveSkill(filtered, options.name);
  const skill = registry.load(`${resolved.provider}:${resolved.name}`);
  const skillFile = join(skill.path, "SKILL.md");
  const stats = statSync(skillFile);
  return {
    name: skill.name,
    description: skill.description,
    provider: skill.provider,
    location: skill.location,
    path: skillFile,
    size: stats.size,
    disabled: skill.disabled ?? false,
    hasReferences: skill.hasReferences,
    hasScripts: skill.hasScripts,
    hasAssets: skill.hasAssets,
    pluginInfo: skill.pluginInfo ?? null,
    content: skill.content,
  };
}

/** info 投影面：领域字段 DTO，恒无正文（Field visibility contract） */
export async function getSkillInfo(options: InfoOptions): Promise<SkillInfoResult> {
  const entry = resolveSkillEntry(options);
  return {
    name: entry.name,
    description: entry.description,
    provider: entry.provider,
    location: entry.location,
    path: entry.path,
    size: entry.size,
    disabled: entry.disabled,
    hasReferences: entry.hasReferences,
    hasScripts: entry.hasScripts,
    hasAssets: entry.hasAssets,
    pluginInfo: entry.pluginInfo,
  };
}

/** 显式文件读取面：SKILL.md 全文 DTO（唯一携带正文的 info 家族返回值） */
export async function readSkillContent(options: SkillContentOptions): Promise<SkillContentResult> {
  const entry = resolveSkillEntry(options);
  return {
    name: entry.name,
    path: entry.path,
    size: entry.size,
    disabled: entry.disabled,
    content: entry.content,
  };
}
