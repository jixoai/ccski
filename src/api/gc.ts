/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「gc --dry-run（不自动删）——提案清单不自动删；roots
 * 消失等 state 记录清理提案 + GC_UNKNOWN_REFERENCE warning」（批 5 tasks.md:44，
 * design G0 回流裁决 #2：3.0 只交付 gc --dry-run，执行协议如需另立 change）
 * 正交意图：
 *   [1] gc 提案面（spec: Explicit claim, repair, and gc contracts）：只扫 state
 *       登记过的 roots（GC 永不猜路径），roots 消失 → 记录退役提案；禁自动删除
 *       （dry-run 之外无执行半区 → DRY_RUN_REQUIRED typed 拒绝）
 *   [2] GC_UNKNOWN_REFERENCE warning：注册根上指向实体的未注册链/未注册条目——
 *       阻塞实体 GC 的引用以 typed warning 呈现（收编走 import --claim / migrate）
 *   [3] 提案 = 纯读报告（state 字节零变化），供人决策后走 repair/remove 收敛
 * 妥协声明：提案不含实体退役（实体删除走 deleteEntity 受 GUARD_ENTITY，提案无法
 * 携带 expectedRevision 的授权语义）；disabled link 投影路径缺席是禁用的物理形态
 * 而非漂移，不入提案。
 */
import { readdirSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCcskiReservedName } from "../core/discovery.js";
import {
  type EntityRecord,
  type EntityScope,
  entityRootFor,
  parseEntityTable,
  parseProjectionTable,
  resolveScopeBase,
} from "../core/entity-state.js";
import { emptyState, StateStore } from "../core/state-store.js";
import { lstatSafe, realpathSafe } from "./entity-guards.js";

/** gc 无执行半区（3.0 冻结范围）：dry-run 之外一律 typed 拒绝 */
export type GcFailureCode =
  | "SCOPE_REQUIRED"
  | "DRY_RUN_REQUIRED"
  | "STATE_RECOVERY_REQUIRED"
  | "IO";

/** 单条退役提案（纯报告；删除须经后续 repair/remove 人类确认面） */
export interface GcProposal {
  kind: "retire-projection";
  rootId: string;
  rootPath: string;
  folderName: string;
  logicalName: string;
  path: string;
  mode: "link" | "materialized";
  disabled: boolean;
  /** 提案 reason（spec 冻结面：roots vanished） */
  reason: "root-vanished";
}

export interface GcUnknownReference {
  code: "GC_UNKNOWN_REFERENCE";
  /** 未注册条目所在根（state 登记过的根，永不猜路径） */
  root: string;
  /** 实体 folderName / 逻辑名 */
  folderName: string;
  logicalName: string;
  /** 未注册条目路径 */
  path: string;
  detail: string;
}

export type GcResult =
  | {
      kind: "ok";
      dryRun: true;
      scope: EntityScope;
      /** 记录退役提案（含全部记录随根消失的聚合根） */
      proposals: GcProposal[];
      /** 阻塞实体 GC 的未知引用（typed warning；不阻塞本次提案本身） */
      unknownReferences: GcUnknownReference[];
      /** proposals 为空 = state 与注册根一致，无清理需求 */
      clean: boolean;
      generation: number;
    }
  | { kind: "error"; code: GcFailureCode; message: string };

/** 注册根上指向实体目录的未注册条目观察（symlink 与实目录两形态） */
function findUnknownReferencesAtRoot(
  rootPath: string,
  entities: Map<string, EntityRecord>
): GcUnknownReference[] {
  const found: GcUnknownReference[] = [];
  let entries: Array<DirentLike>;
  try {
    entries = readdirSync(rootPath, { withFileTypes: true }) as unknown as Array<DirentLike>;
  } catch {
    return found; // 根不可读 = 无观察面（提案面另行按 root-vanished 处理 lstat 语义）
  }
  for (const entry of entries) {
    if (isCcskiReservedName(entry.name)) continue;
    const entryPath = join(rootPath, entry.name);
    const entity = entities.get(entry.name);
    if (entity === undefined) continue; // 只关心指向 ccski 实体的条目
    const entityReal = realpathSafe(entity.path);
    let unknown = false;
    let detail: string;
    if (entry.isSymbolicLink()) {
      let rawTarget: string | null = null;
      try {
        rawTarget = readlinkSync(entryPath);
      } catch {
        rawTarget = null;
      }
      const linkReal = realpathSafe(entryPath);
      const matches =
        (entityReal !== null && linkReal !== null && linkReal === entityReal) ||
        (rawTarget !== null && resolve(rootPath, rawTarget) === resolve(entity.path));
      if (!matches) continue; // 指向别处 = 与本实体无关
      unknown = true;
      detail = `unregistered symlink ${entryPath} -> ${rawTarget ?? "?"} points at ccski entity; adoption belongs to import --claim; blocks entity GC`;
    } else if (entry.isDirectory()) {
      const entryReal = realpathSafe(entryPath);
      if (entityReal === null || entryReal !== entityReal) continue;
      unknown = true;
      detail = `unregistered real directory ${entryPath} occupies the entity path shape; adoption belongs to migrate; blocks entity GC`;
    } else {
      continue;
    }
    if (unknown) {
      found.push({
        code: "GC_UNKNOWN_REFERENCE",
        root: rootPath,
        folderName: entity.folderName,
        logicalName: entity.logicalName,
        path: entryPath,
        detail,
      });
    }
  }
  return found;
}

interface DirentLike {
  name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
}

/**
 * gc：3.0 只交付 `--dry-run` 提案面（design G0 回流裁决 #2）。只扫 state 登记
 * 过的 roots 与 scope 实体根（GC 永不猜路径）；roots 消失 → 记录退役提案；注册
 * 根上指向实体的未注册条目 → GC_UNKNOWN_REFERENCE warning。纯读：state 与磁盘
 * 字节零变化。dryRun !== true 时 typed DRY_RUN_REQUIRED（执行协议不属 3.0）。
 */
export async function gcPropose(options: {
  scope?: EntityScope;
  dryRun?: boolean;
  userDir?: string;
  workspaceDir?: string;
}): Promise<GcResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'gc requires an explicit scope: "global" | "project".',
    };
  }
  if (options.dryRun !== true) {
    return {
      kind: "error",
      code: "DRY_RUN_REQUIRED",
      message:
        "gc is proposal-only in 3.0: re-run with --dry-run. Automatic deletion is out of the frozen 3.0 scope (design G0 ruling #2).",
    };
  }
  const scope: EntityScope = options.scope;
  const scopeBase = resolveScopeBase(scope, options);
  const store = new StateStore(scopeBase);
  const read = await store.read();
  if (read.kind === "recovery-required") {
    return {
      kind: "error",
      code: "STATE_RECOVERY_REQUIRED",
      message: `ccski state at ${store.statePath} degraded read-only: ${read.detail}`,
    };
  }
  const base = read.kind === "ok" ? read.data : emptyState();
  const entities = parseEntityTable(base.entities).records;
  const projections = parseProjectionTable(base.projections).records;

  const proposals: GcProposal[] = [];
  /** 已判定消失的根（聚合提案，避免逐记录重复 lstat） */
  const vanishedRoots = new Set<string>();
  /** 已观察过的根（未知引用扫描去重） */
  const scannedRoots = new Set<string>();
  const unknownReferences: GcUnknownReference[] = [];

  for (const record of projections.values()) {
    const rootPath = resolve(record.rootPath);
    let rootMissing = vanishedRoots.has(rootPath);
    if (!rootMissing && !vanishedRoots.has(`!${rootPath}`)) {
      // `!` 前缀缓存「根存在」判定，避免重复 lstat
      const rootSt = lstatSafe(rootPath);
      if (rootSt === null) {
        vanishedRoots.add(rootPath);
        rootMissing = true;
      } else {
        vanishedRoots.add(`!${rootPath}`);
      }
      if (!rootMissing && !scannedRoots.has(rootPath)) {
        scannedRoots.add(rootPath);
        unknownReferences.push(...findUnknownReferencesAtRoot(rootPath, entities));
      }
    }
    if (rootMissing) {
      proposals.push({
        kind: "retire-projection",
        rootId: record.rootId,
        rootPath,
        folderName: record.folderName,
        logicalName: record.logicalName,
        path: record.path,
        mode: record.mode,
        disabled: record.disabled,
        reason: "root-vanished",
      });
    }
  }

  // scope 实体根本身也是注册观察面（entity-local 的家）；只做未知引用观察
  const entityRoot = entityRootFor(scopeBase);
  const entityRootResolved = resolve(entityRoot);
  if (!scannedRoots.has(entityRootResolved) && lstatSafe(entityRootResolved) !== null) {
    unknownReferences.push(...findUnknownReferencesAtRoot(entityRootResolved, entities));
  }

  return {
    kind: "ok",
    dryRun: true,
    scope,
    proposals,
    unknownReferences,
    clean: proposals.length === 0,
    generation: base.generation,
  };
}
