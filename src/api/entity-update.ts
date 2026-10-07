/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「update 内核化：实体 = 稳路径换新（复用批 3 原语，投影
 * symlink 不破）；物化副本逐份重物化（自身 hash guard）；pinned（ref+hash 组合，
 * state 记录）→ PINNED skip 收据」（E4/P1-3）
 * 正交意图：
 *   [1] 实体稳路径换新（spec: Stable-path entity update）：staging + 同 scope rename
 *       复用 stageEntityCopy/swapEntityIntoPlace（失败 backup 回滚旧实体可用、state 记
 *       lastFailure）；既有 link 投影按路径语义自然解析新内容，零重建；可选
 *       expectedRevision guard（GUARD_ENTITY，实体不动）
 *   [2] 物化逐副本重物化：逐份以副本自身 hash/inode guard（copyHash ?? entityRevision
 *       回退）——guard 过 → swapEntityIntoPlace 换新副本（backup 回滚语义同实体）并刷
 *       entityRevision/copyHash/copyIno；pinned → PINNED skip 副本不动；disabled →
 *       PROJECTION_DISABLED skip（副本保持禁用形态，enable 后再跑 update 收敛）；
 *       guard 不符 → GUARD_PROJECTION 副本不动；更新按副本逐份收敛，部分成功是常态
 *       （不宣称整装一步到位）。实体内容未变时跳过 swap 但副本收敛照常（滞后副本的
 *       收敛入口）；实体与全部记录已收敛时零 state 写入（status unchanged）
 *   [3] 记录收敛（disabled-after-update）：link 记录（含 disabled）entityRevision 刷新
 *       + stale 清除 + disabled 保留——update 后 enable 直接可用；物化 disabled 记录
 *       不动（保持旧 revision，enable 后 update 收敛）
 * 妥协声明：重物化的磁盘半区在 state CAS 之外（并发投影创建的记录冲突由 commit 时
 * fresh 表复核暴露为 reconcile 错误）；swap 与 state 提交之间的崩溃窗收据归 G4
 * （tests/helpers/swap-worker.ts 组合生产原语 + 真 SIGKILL，生产零钩子）。
 */
import { lstatSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { computeSkillFolderHash } from "../core/folder-hash.js";
import {
  type EntityRecord,
  type EntityScope,
  entityRootFor,
  parseEntityTable,
  parseProjectionTable,
  resolveScopeBase,
} from "../core/entity-state.js";
import { emptyState, StateStore } from "../core/state-store.js";
import { parseSkillFile } from "../core/parser.js";
import { sanitizeSourceUrl } from "../core/source-url.js";
import {
  commitTransform,
  materializeCopy,
  stageEntityCopy,
  swapEntityIntoPlace,
  toSnapshot,
  type EntitySnapshot,
  type EntitySourceInput,
} from "./entity.js";
import { lstatSafe, materializedCopyGuard } from "./entity-guards.js";

export interface EntityUpdateOptions {
  /** 显式 scope（缺省/非法 = SCOPE_REQUIRED） */
  scope?: EntityScope;
  /** 实体逻辑名（frontmatter name；经 state 实体记录解析） */
  name: string;
  /** 新内容源（含 SKILL.md 的本地目录；frontmatter 逻辑名必须与实体一致） */
  source: EntitySourceInput;
  /**
   * 可选实体 guard：提供时不符即 GUARD_ENTITY（实体与投影全不动）；缺省时换新仍受
   * state CAS 与磁盘 swap 原语保护（崩溃窗收据见 G4）。
   */
  expectedRevision?: string;
  /** global scopeBase 解析（默认 homedir；测试/宿主注入） */
  userDir?: string;
  /** project scopeBase 解析（默认 process.cwd()；测试/宿主注入） */
  workspaceDir?: string;
}

export type EntityUpdateFailureCode =
  | "SCOPE_REQUIRED"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_MISSING"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_SYMLINK"
  | "SOURCE_NOT_DIRECTORY"
  | "SOURCE_INVALID"
  | "SOURCE_NAME_MISMATCH"
  | "GUARD_ENTITY"
  | "ENTITY_SWAP_FAILED"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

export type EntityUpdateItemStatus = "updated" | "unchanged" | "skipped" | "failed";

/** 逐投影收据的 typed 标注（PINNED/GUARD_PROJECTION/PROJECTION_DISABLED 为冻结词表码） */
export type EntityUpdateItemCode =
  | "PINNED"
  | "GUARD_PROJECTION"
  | "PROJECTION_DISABLED"
  | "TARGET_DENIED"
  | "COPY_FAILED"
  | "IO";

export interface EntityUpdateProjectionResult {
  rootId: string;
  rootPath: string;
  path: string;
  mode: "link" | "materialized";
  disabled: boolean;
  status: EntityUpdateItemStatus;
  code?: EntityUpdateItemCode;
  detail?: string;
}

export type EntityUpdateResult =
  | {
      kind: "ok";
      /** unchanged = 新内容与当前 revision 相同，零磁盘/state 变更 */
      status: "updated" | "unchanged";
      entity: EntitySnapshot;
      projections: EntityUpdateProjectionResult[];
      updated: number;
      unchanged: number;
      skipped: number;
      failed: number;
      generation: number;
      /** ccski 永不写 npm lock（分层单写者）；宿主流程诚实上报 */
      lockSyncPending: true;
      warnings: string[];
    }
  | { kind: "error"; code: EntityUpdateFailureCode; message: string };

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * updateEntity：稳路径实体换新 + 物化逐副本重物化（E4）。link 投影零重建（路径语义
 * 自然解析）；pinned/disabled 物化副本 typed skip；guard 不符 typed 拒绝且副本不动；
 * 磁盘先行、state CAS 收官（失败诚实 reconcile：携带 state 旧 revision 重跑即收敛）。
 */
export async function updateEntity(options: EntityUpdateOptions): Promise<EntityUpdateResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'updateEntity requires an explicit scope: "global" | "project".',
    };
  }
  const scope: EntityScope = options.scope;
  const scopeBase = resolveScopeBase(scope, options);
  const entityRoot = entityRootFor(scopeBase);
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
  let entityRecord: EntityRecord | undefined;
  for (const record of parseEntityTable(base.entities).records.values()) {
    if (record.logicalName === options.name) {
      entityRecord = record;
      break;
    }
  }
  if (entityRecord === undefined) {
    return {
      kind: "error",
      code: "ENTITY_NOT_FOUND",
      message: `no ccski entity record for logical name "${options.name}" in ${scope} scope; ensureEntity owns entity creation`,
    };
  }
  const entityPath = entityRecord.path;
  const entitySt = lstatSafe(entityPath);
  if (entitySt !== null && (entitySt.isSymbolicLink() || !entitySt.isDirectory())) {
    return {
      kind: "error",
      code: "ENTITY_MISSING",
      message: `recorded entity path is occupied by a symlink or non-directory at ${entityPath}; repair first`,
    };
  }
  // entitySt === null（记录在、磁盘缺）= dangling record：允许换新上位（swap 原语
  // 无旧实体时跳过备份直接上位）——R5 崩溃恢复的「重跑 update 即收敛」入口

  // ---- source 校验（与 ensureEntity 同管线）----
  const sourceDir = resolve(options.source.dir);
  const sourceSt = lstatSafe(sourceDir);
  if (sourceSt === null) {
    return { kind: "error", code: "SOURCE_NOT_FOUND", message: `source directory not found: ${sourceDir}` };
  }
  if (sourceSt.isSymbolicLink()) {
    return {
      kind: "error",
      code: "SOURCE_SYMLINK",
      message: `source is a symbolic link: ${sourceDir}; resolve it to a real directory first`,
    };
  }
  if (!sourceSt.isDirectory()) {
    return { kind: "error", code: "SOURCE_NOT_DIRECTORY", message: `source exists but is not a directory: ${sourceDir}` };
  }
  let sourceName: string;
  try {
    sourceName = parseSkillFile(resolve(sourceDir, "SKILL.md")).frontmatter.name;
  } catch (error) {
    return {
      kind: "error",
      code: "SOURCE_INVALID",
      message: `source has no parseable SKILL.md (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (sourceName !== entityRecord.logicalName) {
    return {
      kind: "error",
      code: "SOURCE_NAME_MISMATCH",
      message: `source logical name "${sourceName}" does not match entity "${entityRecord.logicalName}"; identity changes go through ensureEntity (install) not update`,
    };
  }

  if (typeof options.expectedRevision === "string" && options.expectedRevision !== entityRecord.revision) {
    return {
      kind: "error",
      code: "GUARD_ENTITY",
      message: `update expectedRevision ${options.expectedRevision} does not match entity revision ${entityRecord.revision}; entity and projections untouched`,
    };
  }

  // ---- 实体换新（磁盘先行）----
  let staging: string;
  try {
    staging = stageEntityCopy(sourceDir, entityRoot);
  } catch (error) {
    return { kind: "error", code: "IO", message: `failed to stage entity copy from ${sourceDir}: ${detail(error)}` };
  }
  let newRevision: string;
  try {
    newRevision = await computeSkillFolderHash(staging);
  } catch (error) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // 残留交保留名清扫
    }
    return { kind: "error", code: "IO", message: `failed to hash staged entity: ${detail(error)}` };
  }

  const contentChanged = newRevision !== entityRecord.revision;
  const warnings: string[] = [];
  if (contentChanged) {
    // 实体内容有变：稳路径换新（磁盘先行；失败 backup 回滚旧实体可用）
    const swap = swapEntityIntoPlace(staging, entityPath, entityRoot);
    if (!swap.ok) {
      const marked = await commitTransform(store, (tables) => {
        const record = tables.entities.get(entityRecord.folderName);
        if (record) {
          tables.entities.set(entityRecord.folderName, {
            ...record,
            lastFailure: { operation: "update", at: isoNow(), detail: swap.message },
          });
        }
        return { kind: "apply" };
      });
      const stateNote =
        marked.kind === "committed" ? "state recorded the failed generation" : `state failure note was not committed (${marked.kind})`;
      return {
        kind: "error",
        code: "ENTITY_SWAP_FAILED",
        message: `${swap.message}; ${stateNote}`,
      };
    }
    if (swap.warning !== undefined) warnings.push(swap.warning);
  } else {
    // 实体内容未变：不做 swap（零实体磁盘变更），但物化副本仍走逐份收敛——
    // 副本可能滞后于实体（disable→enable 回路），update 是它们的收敛入口
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // 残留交保留名清扫
    }
  }

  // ---- 物化逐副本重物化 + link 记录收敛（磁盘半区，随后一次 CAS 提交）----
  const projections = parseProjectionTable(base.projections).records;
  const receipts: EntityUpdateProjectionResult[] = [];
  const pendingRecordUpdates = new Map<string, Record<string, unknown>>();

  for (const [key, record] of projections) {
    if (record.folderName !== entityRecord.folderName) continue;
    const baseFields = {
      rootId: record.rootId,
      rootPath: record.rootPath,
      path: record.path,
      mode: record.mode,
      disabled: record.disabled,
    };
    if (record.mode === "link") {
      // link：按路径语义自然解析新内容，零磁盘操作；记录相对实体发散（revision 旧/
      // stale 标注）即收敛——replace 换新后跑 update 同样清除 stale（disabled 保留）
      const diverged = contentChanged || record.entityRevision !== newRevision || record.stale === true;
      if (diverged) {
        pendingRecordUpdates.set(key, {
          entityRevision: newRevision,
          stale: undefined,
          updatedAt: isoNow(),
        });
        receipts.push({
          ...baseFields,
          status: "updated",
          detail: record.disabled
            ? "record revision refreshed; disabled preserved (link stays unlinked until enable)"
            : "record revision refreshed; symlink resolves to the new revision by path semantics (no recreation)",
        });
      } else {
        receipts.push({
          ...baseFields,
          status: "unchanged",
          detail: "entity content unchanged; link record already at the current revision",
        });
      }
      continue;
    }
    // materialized：pinned → PINNED skip；disabled → PROJECTION_DISABLED skip
    if (record.reason === "pinned" || record.pin !== undefined) {
      receipts.push({
        ...baseFields,
        status: "skipped",
        code: "PINNED",
        detail: "projection is pinned (source ref + folder hash in state); the copy is never re-materialized by update",
      });
      continue;
    }
    if (record.disabled) {
      receipts.push({
        ...baseFields,
        status: "skipped",
        code: "PROJECTION_DISABLED",
        detail: "disabled copy is left at its disabled form; enable it and re-run update to converge",
      });
      continue;
    }
    const copySt = lstatSafe(record.path);
    if (copySt === null) {
      // 副本缺席：重物化重建（无可破坏内容）
      const rebuilt = materializeCopy(entityPath, record.rootPath, record.path);
      if (!rebuilt.ok) {
        receipts.push({
          ...baseFields,
          status: "failed",
          code: rebuilt.code === "COPY_FAILED" ? "COPY_FAILED" : rebuilt.code === "TARGET_DENIED" ? "TARGET_DENIED" : "IO",
          detail: rebuilt.error ?? "re-materialization failed",
        });
        continue;
      }
      const freshSt = lstatSync(record.path);
      pendingRecordUpdates.set(key, {
        entityRevision: newRevision,
        stale: undefined,
        copyHash: newRevision,
        copyIno: freshSt.ino,
        updatedAt: isoNow(),
      });
      receipts.push({ ...baseFields, status: "updated", detail: "copy was absent; re-materialized from the new entity" });
      continue;
    }
    if (copySt.isSymbolicLink() || !copySt.isDirectory()) {
      receipts.push({
        ...baseFields,
        status: "failed",
        code: "GUARD_PROJECTION",
        detail: "the recorded copy path is now a symlink or non-directory entry; refusing to re-materialize over it",
      });
      continue;
    }
    const guard = await materializedCopyGuard(record, record.path, copySt);
    if (!guard.ok) {
      receipts.push({
        ...baseFields,
        status: "failed",
        code: "GUARD_PROJECTION",
        detail: `copy guard mismatch (expected ${guard.expected.slice(0, 12)}${
          guard.actual !== undefined ? `, on disk ${guard.actual.slice(0, 12)}` : ""
        }${guard.reason !== undefined ? `; ${guard.reason}` : ""}); the copy changed externally — untouched`,
      });
      continue;
    }
    if (guard.actual === newRevision) {
      // guard 已证副本字节即为当前 revision：已收敛，免 swap（不做无谓 inode 翻动）；
      // 记录面仅在确有漂移时对账（避免 no-op update 的 state 写放大）
      const drifted =
        record.entityRevision !== newRevision || record.copyHash !== newRevision || record.copyIno !== copySt.ino;
      if (drifted) {
        pendingRecordUpdates.set(key, {
          entityRevision: newRevision,
          stale: undefined,
          copyHash: newRevision,
          copyIno: copySt.ino,
          updatedAt: isoNow(),
        });
      }
      receipts.push({
        ...baseFields,
        status: "unchanged",
        detail: "copy already at the current revision (guard verified)",
      });
      continue;
    }
    // guard 过：staging → backup → swap 换新副本（失败回滚旧副本可用）
    const staged = stageEntityCopy(entityPath, record.rootPath);
    const copySwap = swapEntityIntoPlace(staged, record.path, record.rootPath);
    if (!copySwap.ok) {
      receipts.push({
        ...baseFields,
        status: "failed",
        code: "IO",
        detail: `re-materialization swap failed (old copy remains usable): ${copySwap.message}`,
      });
      continue;
    }
    if (copySwap.warning !== undefined) warnings.push(copySwap.warning);
    const freshSt = lstatSync(record.path);
    pendingRecordUpdates.set(key, {
      entityRevision: newRevision,
      stale: undefined,
      copyHash: newRevision,
      copyIno: freshSt.ino,
      updatedAt: isoNow(),
    });
    receipts.push({ ...baseFields, status: "updated", detail: "copy re-materialized from the new entity after its own guard passed" });
  }

  // ---- state 收官（一次 CAS：实体刷新 + link/副本记录收敛）----
  if (!contentChanged && pendingRecordUpdates.size === 0) {
    // 实体与全部记录已收敛：零 state 写入（generation 不动）
    return {
      kind: "ok",
      status: "unchanged",
      entity: toSnapshot(entityRecord),
      projections: receipts,
      updated: 0,
      unchanged: receipts.length,
      skipped: 0,
      failed: 0,
      generation: base.generation,
      lockSyncPending: true,
      warnings,
    };
  }
  const updatedAt = isoNow();
  const sourceIdentity = options.source.source ?? sourceDir;
  const refreshedProvenance = {
    source: sourceIdentity,
    ...(options.source.sourceType !== undefined ? { sourceType: options.source.sourceType } : {}),
    // Field visibility contract：sourceUrl 保存前清洗（userinfo/query 不落 state）
    ...(options.source.sourceUrl !== undefined
      ? { sourceUrl: sanitizeSourceUrl(options.source.sourceUrl) }
      : {}),
    ...(options.source.skillPath !== undefined ? { skillPath: options.source.skillPath } : {}),
    installedAt: entityRecord.provenance.installedAt,
    updatedAt,
  };
  const commit = await commitTransform(store, (tables) => {
    const record = tables.entities.get(entityRecord.folderName);
    if (record === undefined) {
      return { kind: "reject" as const, code: "ENTITY_NOT_FOUND", message: `entity record vanished concurrently` };
    }
    if (record.revision !== entityRecord.revision) {
      return {
        kind: "reject" as const,
        code: "GUARD_ENTITY",
        message: `entity was revised concurrently (revision ${record.revision}); update refused — re-read state and retry`,
      };
    }
    if (contentChanged) {
      tables.entities.set(entityRecord.folderName, {
        ...record,
        revision: newRevision,
        provenance: refreshedProvenance,
        updatedAt,
        lastFailure: undefined,
      });
    }
    for (const [key, patch] of pendingRecordUpdates) {
      const record2 = tables.projections.get(key);
      if (record2 === undefined) continue; // 并发删除：以 fresh 表为准，收据如实
      tables.projections.set(key, { ...record2, ...patch });
    }
    return { kind: "apply" };
  });

  if (commit.kind === "committed") {
    const updated = receipts.filter((r) => r.status === "updated").length;
    const unchangedCount = receipts.filter((r) => r.status === "unchanged").length;
    const skippedCount = receipts.filter((r) => r.status === "skipped").length;
    const failedCount = receipts.filter((r) => r.status === "failed").length;
    return {
      kind: "ok",
      status: contentChanged ? "updated" : "unchanged",
      entity: toSnapshot(
        contentChanged
          ? { ...entityRecord, revision: newRevision, provenance: refreshedProvenance, updatedAt }
          : entityRecord
      ),
      projections: receipts,
      updated,
      unchanged: unchangedCount,
      skipped: skippedCount,
      failed: failedCount,
      generation: commit.generation,
      lockSyncPending: true,
      warnings,
    };
  }
  const reconcile =
    commit.kind === "recovery-required"
      ? commit.detail
      : commit.kind === "rejected"
        ? commit.message
        : "state commit exhausted generation retries";
  return {
    kind: "error",
    code:
      commit.kind === "recovery-required"
        ? "STATE_RECOVERY_REQUIRED"
        : commit.kind === "rejected"
          ? commit.code === "GUARD_ENTITY"
            ? "GUARD_ENTITY"
            : "IO"
          : "STATE_GENERATION_CONFLICT",
    message: `the entity content was swapped at ${entityPath} (and copies may have been re-materialized) but state was not refreshed (${reconcile}); re-run updateEntity with expectedRevision=${entityRecord.revision} to reconcile`,
  };
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
