/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「ensureEntity：{scope, source}（scope = global|project +
 * base 路径由内部按 design 解析）→ 写实体到 scope 实体根（staging→rename，含
 * frontmatter 解析/folderName sanitize 冻结算法）；state 记账（entities 表 +
 * generation CAS）」+「projectEntity state projections 记账（path/mode/
 * entityRevision/disabled=false）」
 * 正交意图：
 *   [1] 冻结 sanitize 算法（E1）：folderName 由逻辑名派生，逐字符镜像
 *       skills@1.7.1 dist/cli.mjs sanitizeName（本仓 npx 缓存实读钉值：
 *       toLowerCase → [^a-z0-9._]+ 连字符化 → 首尾 ./- 裁剪 → 255 截断 →
 *       空则 "unnamed-skill"）；NAME_COLLISION 的事实依据（同 folderName 不同
 *       逻辑名）
 *   [2] scope 实体根解析（E1）：global = <userDir>/.agents/skills、project =
 *       <workspace>/.agents/skills；userDir/workspaceDir 可注入（测试/宿主）
 *   [3] state 记录 schema（批 3 正式化批 1 留出的 Record<string, unknown> 表）：
 *       entity 记录（logicalName/folderName/path/revision/provenance）与
 *       projection 记录（scope/rootId/rootPath/path/mode/reason/entityRevision/
 *       disabled/ownership/stale）；形状与批 2 发现层只读视图契约兼容（string
 *       path 字段 + mode:"link" 判定）
 *   [4] 投影根身份 rootId：resolve(root) 的 sha256 前 16 hex（跨进程稳定、不泄
 *       路径语义），投影记录键 = <rootId>:<folderName>
 * 妥协声明：records 表读取采用「集合读取丢弃不兼容条目」（style 法则）；损坏
 * 条目键名回传给调用方如实呈现，不在本层静默修复。revision 语义 = 安装内容树
 * 的 computeSkillFolderHash（folder-hash 单源，G0 F1-F7 钉值）。
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import { CCSKI_RESIDUE_MARKER_FILENAME, type CcskiResidueMarker } from "./discovery.js";

/** skills 目录名（scopeBase 下的实体根/投影根一级） */
export const SKILLS_DIRNAME = "skills";

export type EntityScope = "global" | "project";

/**
 * 冻结 sanitize 算法（E1）：**逐字符对齐 skills@1.7.1 dist 的 sanitizeName**——
 * lowercase；`[^a-z0-9._]+` 游程（集合外字符连续段）→ 连字符；首尾 `.`/`-` 剥离；
 * 255 截断；空结果落 "unnamed-skill"。下划线与点**保留**。
 *
 * 出处钉值（2026-10-07 MainAgent 亲验 dist 源码 cli.mjs:2183，本仓
 * ~/.npm/_npx/ac0ed6aa23b37c1e 实读，package.json version = 1.7.1）：
 * `name.toLowerCase().replace(/[^a-z0-9._]+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "")
 * .substring(0, 255) || "unnamed-skill"`。spec「Scope-aware entity layer」正文已按
 * dist 语义修正（评审转述的「underscores to hyphens」系原句错误，design「实现期
 * 契约修正」节有裁决记录）。npm 升级重跑 parity 时同步更新本函数与出处锚点。
 */
export function sanitizeEntityFolderName(logicalName: string): string {
  return (
    logicalName
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, "-")
      .replace(/^[.\-]+|[.\-]+$/g, "")
      .substring(0, 255) || "unnamed-skill"
  );
}

/** scopeBase 解析（E1）：global = <userDir>/.agents；project = <workspaceDir>/.agents */
export function resolveScopeBase(
  scope: EntityScope,
  dirs: { userDir?: string; workspaceDir?: string } = {}
): string {
  if (scope === "global") {
    return join(resolve(dirs.userDir ?? homedir()), ".agents");
  }
  return join(resolve(dirs.workspaceDir ?? process.cwd()), ".agents");
}

/** scope 实体根（canonical store）：与投影根是两个概念，投影根永不被推断 */
export function entityRootFor(scopeBase: string): string {
  return join(resolve(scopeBase), SKILLS_DIRNAME);
}

/** 投影根身份：resolve(root) 的 sha256 前 16 hex（确定性、跨进程稳定） */
export function projectionRootId(rootPath: string): string {
  return createHash("sha256").update(resolve(rootPath)).digest("hex").slice(0, 16);
}

/** state projections 表的记录键 */
export function projectionRecordKey(rootId: string, folderName: string): string {
  return `${rootId}:${folderName}`;
}

// ---------------------------------------------------------------------------
// state 记录 schema（批 3 正式化）
// ---------------------------------------------------------------------------

export const MATERIALIZE_REASONS = ["pinned", "imported-root", "user-request"] as const;
/** 显式物化触发（E5）：永不自动 */
export type MaterializeReason = (typeof MATERIALIZE_REASONS)[number];
/** 唯一自动降级 reason（E5）：仅 symlink 系统调用族失败 */
export type SymlinkUnavailableReason = "symlink-unavailable";
/** 投影记录落账的完整 reason 词表（显式三类 + 唯一自动降级一类） */
export type ProjectionReason = MaterializeReason | SymlinkUnavailableReason;

export const EntityProvenanceSchema = z
  .object({
    source: z.string().min(1),
    sourceType: z.string().min(1).optional(),
    sourceUrl: z.string().min(1).optional(),
    skillPath: z.string().min(1).optional(),
    installedAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type EntityProvenance = z.infer<typeof EntityProvenanceSchema>;

export const EntityRecordSchema = z
  .object({
    kind: z.literal("entity"),
    scope: z.enum(["global", "project"]),
    logicalName: z.string().min(1),
    folderName: z.string().min(1),
    /** 实体绝对路径（resolve 归一；realpath 形态由发现层读取时并集比对） */
    path: z.string().min(1),
    /** 安装内容树的 computeSkillFolderHash（hex） */
    revision: z.string().min(1),
    provenance: EntityProvenanceSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    /** replace 换新失败后的诚实记录（R4：state 记失败 generation） */
    lastFailure: z
      .object({
        operation: z.literal("replace"),
        at: z.string().min(1),
        detail: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EntityRecord = z.infer<typeof EntityRecordSchema>;

export const ProjectionRecordSchema = z
  .object({
    kind: z.literal("projection"),
    scope: z.enum(["global", "project"]),
    rootId: z.string().min(1),
    /** 投影根 resolve 归一路径（批 4 lstat/realpath 复核依据） */
    rootPath: z.string().min(1),
    folderName: z.string().min(1),
    logicalName: z.string().min(1),
    /** 投影绝对路径 */
    path: z.string().min(1),
    mode: z.enum(["link", "materialized"]),
    reason: z.enum(["pinned", "imported-root", "user-request", "symlink-unavailable"]).optional(),
    /** 投影建立/记账时的实体 revision；replace 后 link 记录保留旧值并标 stale */
    entityRevision: z.string().min(1),
    disabled: z.boolean(),
    ownership: z.literal("ccski"),
    /** replace 换新后 link 投影的 stale 标注（R8；下次 verify 报 STALE_PROJECTION） */
    stale: z.boolean().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type ProjectionRecord = z.infer<typeof ProjectionRecordSchema>;

export interface ParsedRecordTable<T> {
  records: Map<string, T>;
  /** 不兼容条目键名（如实回传，不静默） */
  invalidKeys: string[];
}

/** 集合读取：逐条 safeParse，不兼容条目丢弃并登记键名（style 法则） */
export function parseEntityTable(
  table: Record<string, unknown>
): ParsedRecordTable<EntityRecord> {
  const parsed: ParsedRecordTable<EntityRecord> = { records: new Map(), invalidKeys: [] };
  for (const [key, value] of Object.entries(table)) {
    const result = EntityRecordSchema.safeParse(value);
    if (result.success) parsed.records.set(key, result.data);
    else parsed.invalidKeys.push(key);
  }
  return parsed;
}

export function parseProjectionTable(
  table: Record<string, unknown>
): ParsedRecordTable<ProjectionRecord> {
  const parsed: ParsedRecordTable<ProjectionRecord> = { records: new Map(), invalidKeys: [] };
  for (const [key, value] of Object.entries(table)) {
    const result = ProjectionRecordSchema.safeParse(value);
    if (result.success) parsed.records.set(key, result.data);
    else parsed.invalidKeys.push(key);
  }
  return parsed;
}

/** Map → plain record（state commit 的表载荷） */
export function recordTableToObject<T>(records: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of records) out[key] = value;
  return out;
}

// ---------------------------------------------------------------------------
// staging/backup 残留 marker（与批 2 sweepReservedResidues 的条件清扫对齐）
// ---------------------------------------------------------------------------

/**
 * 向 staging/backup 目录写入 ccski 所有权 marker（尽力而为；写失败不影响主
 * 流程——清扫还有龄期兜底条件）。
 */
export function writeResidueMarker(dir: string, kind: "staging" | "backup"): void {
  const marker: CcskiResidueMarker = { pid: process.pid, createdAt: Date.now(), kind };
  try {
    writeFileSync(
      join(dir, CCSKI_RESIDUE_MARKER_FILENAME),
      `${JSON.stringify(marker)}\n`,
      "utf8"
    );
  } catch {
    // marker 是清扫加速元数据；失败不阻断安装/回滚主流程
  }
}
