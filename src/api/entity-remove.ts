/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「remove 内核化：投影先行——link 投影只 unlink（绝不穿链
 * 递归删）；物化投影删目录带自身 revision/inode guard（不符 → GUARD_PROJECTION，
 * mid-flight 换体拒删路径不动）；FOREIGN_OWNERSHIP（external 链）；canonical root
 * （entity-local）不参与投影 remove——实体删除走实体 mutation 受 GUARD_ENTITY。实体
 * GC 条件：state 无 active 投影 ∧ 全注册 roots lstat/realpath 复核无 ccski-owned
 * 引用 ∧ 无未知引用（有 → 实体保留 + GC_UNKNOWN_REFERENCE warning）」（E4）
 * 正交意图：
 *   [1] 投影先行 remove：link 只 unlink（symlink unlink 天然不穿链）；物化删目录前
 *       过副本自身 hash/inode guard（entity-guards），换体/不符 = GUARD_PROJECTION
 *       路径不动；记录随磁盘事实一并退役（NOT_FOUND 幂等 skip 对齐 2.x parity）
 *   [2] 实体 GC（spec: Ownership-first removal and entity GC）：零投影记录 ∧ 全注册
 *       roots（∪ 显式 roots）lstat/realpath 复核无 ccski-owned 引用 ∧ 无未知引用；
 *       未知引用保留实体 + GC_UNKNOWN_REFERENCE warning；external live-link 不计入
 *       删除权限也不阻塞（非引用）；GC 永不猜路径（只扫 state 登记过的 roots 与本次
 *       显式 roots）；state 退役先行（CAS 内复核零记录 + guarded revision）、目录删除随后
 *   [3] deleteEntity（canonical root 的实体 mutation 半区）：expectedRevision guard
 *       （GUARD_ENTITY）+ 零投影记录（PROJECTIONS_REMAIN）+ 无引用复核后退役实体
 *   [4] 实体销毁绑定磁盘真相（终审 P0-3）：deleteEntity 与末投影 GC 在退役/销毁前重算
 *       磁盘实体 revision（computeSkillFolderHash）与调用方 expectedRevision + state
 *       记录双重比对（deleteEntity）或与 state 记录比对（GC），不符 → typed 拒绝/
 *       GC 拒绝且零磁盘副作用；「重算 → 销毁」窗口由 entity-disk-guard 的目录 inode +
 *       SKILL.md fd 身份判据守卫（防重算与销毁之间换体）
 *   [5] 终审第三轮（P0-A/P0-B/P1-D/P1-E）：absent 门 = 只退役 dangling state 记录、
 *       绝不触碰磁盘路径（路径在场 = 同名重建，entityPresentOnDisk 如实诊断）；
 *       销毁哈希复读通过后追加第二次身份复核（哈希读取屏障内的整目录换体由 inode
 *       判据拦截）；expectedEntityRevision 可选贯穿 GC 退役（入口比对 + CAS 复核，
 *       不符 typed GUARD_ENTITY 实体零副作用）；pin fd 生命周期 = 覆盖退役 + 销毁
 *       全流程的 finally（recovery/conflict/rejected 提前返回不再泄漏）
 * 妥协声明：GC 的引用复核是时点快照（scan 与 commit 之间的外部链竞态由 CAS 内零记录
 * 复核 + 发现层 broken omission 兜底可见）；「复核通过 → rmSync」的微窗口是 Node API
 * 边界（无按 fd 销毁），闭合级与物化副本 guard 同一语义环（design.md 终审回流节）；
 * state 退役成功而销毁被换体守卫拒绝或删除失败时残留未记录目录（后续 ensure 报
 * ENTITY_PATH_OCCUPIED typed 可见，收编归批 5 repair/migrate）。
 */
import { realpathSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  type EntityRecord,
  type EntityScope,
  entityRootFor,
  parseEntityTable,
  parseProjectionTable,
  projectionRecordKey,
  projectionRootId,
  resolveScopeBase,
} from "../core/entity-state.js";
import { computeSkillFolderHash } from "../core/folder-hash.js";
import { emptyState, StateStore } from "../core/state-store.js";
import { type EntityDiskGuardHandle, openEntityDiskGuard } from "./entity-disk-guard.js";
import { lstatSafe, materializedCopyGuard, symlinkTargetsEntity } from "./entity-guards.js";
import {
  type EntitySnapshot,
  commitTransform,
  isCanonicalEntityRoot,
  toSnapshot,
} from "./entity.js";

export interface EntityRemoveOptions {
  /** 显式 scope（缺省/非法 = SCOPE_REQUIRED） */
  scope?: EntityScope;
  /** 实体逻辑名（frontmatter name；经 state 实体记录解析） */
  name: string;
  /** 显式投影根（SDK 永不环境推断；逐根独立处理与收据；空 = INVALID_ROOTS） */
  roots: readonly string[];
  /**
   * 可选实体 revision 守卫（终审第三轮 P1-D，未发布 3.0.0 发版前演进）：调用方
   * 观察到的实体 revision。在场时末投影 GC 的实体退役以它为基准——入口即比对
   * （不符 typed GUARD_ENTITY，投影与实体零副作用），CAS 退役 transform 内复核
   * （门与提交之间被并发换新 → typed GUARD_ENTITY，实体保留零副作用；投影删除
   * 已发生的磁盘事实在 message 如实说明）。缺省 = 既有语义（以 state 记录为基准）。
   */
  expectedEntityRevision?: string;
  /** global scopeBase 解析（默认 homedir；测试/宿主注入） */
  userDir?: string;
  /** project scopeBase 解析（默认 process.cwd()；测试/宿主注入） */
  workspaceDir?: string;
}

export type EntityRemoveRootCode =
  | "NOT_FOUND"
  | "FOREIGN_OWNERSHIP"
  | "GUARD_PROJECTION"
  | "GC_UNKNOWN_REFERENCE"
  | "TARGET_DENIED"
  | "DELETE_FAILED"
  | "IO";

export interface EntityRemoveRootResult {
  /** resolve 归一后的投影根 */
  root: string;
  rootId: string;
  /** 投影绝对路径；entity-local 收据 = 实体路径 */
  path: string;
  status: "removed" | "skipped" | "failed";
  mode?: "link" | "materialized" | "entity-local";
  targetKind?: "entity" | "projection";
  reason?: "canonical-root";
  errorCode?: EntityRemoveRootCode;
  error?: string;
  detail?: string;
}

export interface EntityRemoveGcReport {
  /** GC 条件是否被评估（实体记录存在即评估；投影删除提交失败时 false） */
  attempted: boolean;
  entityDeleted: boolean;
  /** 阻塞类：仍有投影记录 / 注册根存在 ccski-owned 引用 / 未知引用 */
  blockedBy?: "PROJECTIONS" | "OWNED_REFERENCE" | "UNKNOWN_REFERENCE";
  /**
   * 磁盘路径在场诊断（终审第三轮 P0-A）：absent 门退役 dangling 记录后发现
   * 实体路径在场（CAS 等待窗口内同名重建，非 ccski 守卫内容）——目录原样保留。
   * 仅诊断用途，不驱动决策。
   */
  entityPresentOnDisk?: boolean;
  warnings: string[];
}

export type EntityRemoveFailureCode =
  | "SCOPE_REQUIRED"
  | "INVALID_ROOTS"
  | "ENTITY_NOT_FOUND"
  | "GUARD_ENTITY"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

export type EntityRemoveResult =
  | {
      kind: "ok";
      /** 移除前的实体快照；GC 已删除实体时 removed=true */
      entity: EntitySnapshot;
      entityRemoved: boolean;
      results: EntityRemoveRootResult[];
      removed: number;
      skipped: number;
      failed: number;
      gc: EntityRemoveGcReport;
      generation: number;
    }
  | { kind: "error"; code: EntityRemoveFailureCode; message: string };

/**
 * removeEntityProjections：投影先行 remove（E4）。逐显式根处理（unlink/守卫删目录/
 * typed 拒绝/幂等 skip），记录随磁盘事实退役；随后按 GC 三条件评估实体退役——
 * 条件不满足即保留实体（blockedBy 如实），未知引用以 GC_UNKNOWN_REFERENCE warning
 * 呈现且不影响本次投影 remove 的成功。
 */
export async function removeEntityProjections(
  options: EntityRemoveOptions
): Promise<EntityRemoveResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'removeEntityProjections requires an explicit scope: "global" | "project".',
    };
  }
  if (!Array.isArray(options.roots) || options.roots.length === 0) {
    return {
      kind: "error",
      code: "INVALID_ROOTS",
      message:
        "removeEntityProjections requires at least one explicit projection root; the SDK never infers roots",
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
      message: `no ccski entity record for logical name "${options.name}" in ${scope} scope`,
    };
  }
  const entityPath = entityRecord.path;
  const folderName = entityRecord.folderName;

  // P1-D 入口比对：调用方观察 revision 与 state 实体记录不符 → typed GUARD_ENTITY，
  // 投影与实体零副作用（「验证后更新再删除」竞态的内核半区闸门）
  if (
    typeof options.expectedEntityRevision === "string" &&
    options.expectedEntityRevision !== entityRecord.revision
  ) {
    return {
      kind: "error",
      code: "GUARD_ENTITY",
      message: `remove expectedEntityRevision ${options.expectedEntityRevision} does not match entity revision ${entityRecord.revision}; projections and entity untouched`,
    };
  }

  const results: EntityRemoveRootResult[] = [];
  const removedRecordKeys: string[] = [];
  const gcWarnings: string[] = [];

  for (const rawRoot of options.roots) {
    if (typeof rawRoot !== "string" || rawRoot.length === 0) {
      results.push({
        root: String(rawRoot),
        rootId: "",
        path: "",
        status: "failed",
        errorCode: "IO",
        error: "projection root must be a non-empty path string",
      });
      continue;
    }
    const rootPath = resolve(rawRoot);
    const rootId = projectionRootId(rootPath);
    const projPath = resolve(rootPath, folderName);
    const rootBase = { root: rootPath, rootId, path: projPath };

    // canonical root（entity-local）：实体本体不是投影，remove 走实体 mutation（GUARD_ENTITY）
    if (isCanonicalEntityRoot(rootPath, entityRoot)) {
      results.push({
        ...rootBase,
        status: "skipped",
        mode: "entity-local",
        targetKind: "entity",
        reason: "canonical-root",
        detail:
          "canonical entity root does not participate in projection remove; entity deletion goes through deleteEntity (GUARD_ENTITY)",
      });
      continue;
    }

    const recordKey = projectionRecordKey(rootId, folderName);
    const record = parseProjectionTable(base.projections).records.get(recordKey);
    let st: ReturnType<typeof lstatSafe>;
    try {
      st = lstatSafe(projPath);
    } catch (error) {
      // P1-E：投影位「无法观察」≠ 缺席——typed 失败，记录不退役、路径不动
      results.push({
        ...rootBase,
        status: "failed",
        errorCode: "IO",
        error: `failed to inspect the projection path ${projPath} (${detailOf(error)})`,
      });
      continue;
    }

    if (record === undefined) {
      // 无记录：external live-link typed 只读；同目标链/未知条目 = 未知引用（保留实体）
      if (st === null) {
        results.push({
          ...rootBase,
          status: "skipped",
          errorCode: "NOT_FOUND",
          detail: "nothing on disk and no projection record",
        });
        continue;
      }
      if (st.isSymbolicLink() && !symlinkTargetsEntity(projPath, entityPath)) {
        results.push({
          ...rootBase,
          status: "failed",
          errorCode: "FOREIGN_OWNERSHIP",
          error:
            "external live-link (target is not a ccski-owned entity); external links are read-only and never count toward deletion authority",
        });
        continue;
      }
      results.push({
        ...rootBase,
        status: "skipped",
        errorCode: "GC_UNKNOWN_REFERENCE",
        detail: st.isSymbolicLink()
          ? "unregistered link to this entity (unknown reference; adoption belongs to import --claim, batch 5); blocks entity GC"
          : "unregistered directory entry at the projection path (unknown reference; adoption belongs to migrate, batch 5); blocks entity GC",
      });
      gcWarnings.push(`GC_UNKNOWN_REFERENCE: ${projPath}`);
      continue;
    }

    if (record.mode === "link") {
      if (st !== null && !(st.isSymbolicLink() && symlinkTargetsEntity(projPath, entityPath))) {
        results.push({
          ...rootBase,
          status: "failed",
          errorCode: "GUARD_PROJECTION",
          error: `the recorded link projection path is now ${
            st.isSymbolicLink()
              ? "a symlink to a different target"
              : st.isDirectory()
                ? "a real directory"
                : "a non-directory entry"
          }; refusing to remove it as a ccski link (path untouched, never removed through a link)`,
        });
        continue;
      }
      if (st !== null) {
        try {
          rmSync(projPath);
        } catch (error) {
          results.push(removeFsFailure(rootBase, error, "unlink"));
          continue;
        }
      }
      removedRecordKeys.push(recordKey);
      results.push({
        ...rootBase,
        status: "removed",
        mode: "link",
        targetKind: "projection",
        detail:
          st === null
            ? "link was already absent; projection record retired"
            : "link unlinked (never recursively); projection record retired",
      });
      continue;
    }

    // materialized：副本自身 hash/inode guard → 换体/不符 GUARD_PROJECTION 路径不动
    if (st === null) {
      removedRecordKeys.push(recordKey);
      results.push({
        ...rootBase,
        status: "removed",
        mode: "materialized",
        targetKind: "projection",
        detail: "copy was already absent; projection record retired",
      });
      continue;
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      results.push({
        ...rootBase,
        status: "failed",
        errorCode: "GUARD_PROJECTION",
        error:
          "the recorded materialized projection path is now a symlink or non-directory entry; refusing to remove it as a ccski copy (path untouched)",
      });
      continue;
    }
    const guard = await materializedCopyGuard(record, projPath, st);
    if (!guard.ok) {
      results.push({
        ...rootBase,
        status: "failed",
        errorCode: "GUARD_PROJECTION",
        error: `materialized copy guard mismatch (expected ${guard.expected.slice(0, 12)}${
          guard.actual !== undefined ? `, on disk ${guard.actual.slice(0, 12)}` : ""
        }${guard.reason !== undefined ? `; ${guard.reason}` : ""}); external replacement detected — path untouched`,
      });
      continue;
    }
    try {
      rmSync(projPath, { recursive: true });
    } catch (error) {
      results.push(removeFsFailure(rootBase, error, "remove copy directory"));
      continue;
    }
    removedRecordKeys.push(recordKey);
    results.push({
      ...rootBase,
      status: "removed",
      mode: "materialized",
      targetKind: "projection",
      detail: "copy deleted after its own revision/inode guard passed; projection record retired",
    });
  }

  const removed = results.filter((r) => r.status === "removed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  let generation = base.generation;
  if (removedRecordKeys.length > 0) {
    const commit = await commitTransform(store, (tables) => {
      for (const key of removedRecordKeys) tables.projections.delete(key);
      return { kind: "apply", deleteProjectionKeys: removedRecordKeys };
    });
    if (commit.kind === "committed") {
      generation = commit.generation;
    } else if (commit.kind === "recovery-required") {
      return {
        kind: "error",
        code: "STATE_RECOVERY_REQUIRED",
        message: `projection paths were mutated on disk but state was not updated (degraded read-only: ${commit.detail}); re-run the same remove to reconcile records`,
      };
    } else {
      const reconcile =
        commit.kind === "rejected" ? commit.message : "state commit exhausted generation retries";
      return {
        kind: "error",
        code: "STATE_GENERATION_CONFLICT",
        message: `projection paths were mutated on disk but state was not updated (${reconcile}); re-run the same remove to reconcile records`,
      };
    }
  }

  // ---- 实体 GC 评估（E4 三条件；磁盘复核 = 注册 roots ∪ 显式 roots，永不猜路径）----
  // 仅当本次调用确有投影记录退役（removed > 0）时评估：canonical-root-only 或全
  // NOT_FOUND 的调用不得绕过 deleteEntity 的 GUARD_ENTITY 删实体（G3 裁决——实体
  // 删除走实体 mutation）；历史残留的收敛归批 5 gc --dry-run/repair。
  const gc: EntityRemoveGcReport = { attempted: false, entityDeleted: false, warnings: gcWarnings };
  if (removedRecordKeys.length === 0) {
    return {
      kind: "ok",
      entity: toSnapshot(entityRecord),
      entityRemoved: false,
      results,
      removed,
      skipped,
      failed,
      gc,
      generation,
    };
  }
  const fresh = await store.read();
  if (fresh.kind === "recovery-required") {
    gc.blockedBy = "PROJECTIONS";
    gc.warnings.push(`GC not evaluated: state degraded read-only (${fresh.detail})`);
    return {
      kind: "ok",
      entity: toSnapshot(entityRecord),
      entityRemoved: false,
      results,
      removed,
      skipped,
      failed,
      gc,
      generation,
    };
  }
  const freshBase = fresh.kind === "ok" ? fresh.data : emptyState();
  const freshProjections = parseProjectionTable(freshBase.projections).records;
  const remainingForFolder = [...freshProjections.values()].filter(
    (r) => r.folderName === folderName
  );
  if (remainingForFolder.length > 0) {
    gc.blockedBy = "PROJECTIONS";
    return {
      kind: "ok",
      entity: toSnapshot(entityRecord),
      entityRemoved: false,
      results,
      removed,
      skipped,
      failed,
      gc,
      generation,
    };
  }

  gc.attempted = true;
  const scanRoots = new Set<string>(options.roots.map((r) => resolve(r)));
  for (const record of freshProjections.values()) {
    scanRoots.add(resolve(record.rootPath));
  }
  const entityReal = realpathOrNull(entityPath);
  const referenceVerdict = classifyReferences({
    scanRoots,
    folderName,
    entityPath,
    entityReal,
  });
  gc.warnings.push(...referenceVerdict.warnings);
  if (referenceVerdict.verdict !== "clean") {
    gc.blockedBy = referenceVerdict.verdict === "owned" ? "OWNED_REFERENCE" : "UNKNOWN_REFERENCE";
    return {
      kind: "ok",
      entity: toSnapshot(entityRecord),
      entityRemoved: false,
      results,
      removed,
      skipped,
      failed,
      gc,
      generation,
    };
  }

  // 磁盘绑定门（终审 P0-3）：末投影 GC 的实体销毁同样绑定磁盘实体 revision（基准 =
  // 实体记录）；磁盘被并发改写/换体 → 实体保留（记录与磁盘原样，零销毁副作用），
  // 投影 remove 的成功结果不受影响。
  const gcGate = await gateEntityDestruction(entityPath, [entityRecord.revision]);
  if (gcGate.kind === "refused") {
    gc.warnings.push(
      `GC_ENTITY_DISK_GUARD: ${gcGate.reason}; entity kept (state record and disk content preserved)`
    );
    return {
      kind: "ok",
      entity: toSnapshot(entityRecord),
      entityRemoved: false,
      results,
      removed,
      skipped,
      failed,
      gc,
      generation,
    };
  }

  // 条件满足：state 退役先行（CAS 内复核零记录 + guarded revision + 调用方观察
  // revision），目录销毁随后。pin fd 生命周期覆盖退役 + 销毁全流程（P1-E：拒绝/
  // 降级提前返回不泄漏）。
  try {
    const retire = await commitTransform(store, (tables) => {
      for (const record of tables.projections.values()) {
        if (record.folderName === folderName) {
          return {
            kind: "reject" as const,
            code: "PROJECTIONS",
            message: `a projection record for "${folderName}" appeared concurrently; entity kept`,
          };
        }
      }
      const record = tables.entities.get(folderName);
      if (record === undefined) {
        return {
          kind: "reject" as const,
          code: "ALREADY_GONE",
          message: `entity record for "${folderName}" already retired`,
        };
      }
      // P1-D CAS 复核（先于 guarded-revision：调用方观察的 revision 在场时是更强
      // 授权基准）：门通过后、提交前实体被并发换新 → typed GUARD_ENTITY（实体保留
      // 零副作用；投影删除的磁盘事实在返回 message 如实说明）
      if (
        typeof options.expectedEntityRevision === "string" &&
        record.revision !== options.expectedEntityRevision
      ) {
        return {
          kind: "reject" as const,
          code: "GUARD_ENTITY",
          message: `entity "${folderName}" was revised concurrently (state revision ${record.revision.slice(0, 12)} vs caller-observed ${options.expectedEntityRevision.slice(0, 12)}); entity kept`,
        };
      }
      if (record.revision !== entityRecord.revision) {
        return {
          kind: "reject" as const,
          code: "REVISION",
          message: `entity "${folderName}" was revised concurrently (revision ${record.revision.slice(0, 12)} vs guarded ${entityRecord.revision.slice(0, 12)}); entity kept`,
        };
      }
      tables.entities.delete(folderName);
      return { kind: "apply" as const, deleteEntityKeys: [folderName] };
    });
    if (retire.kind === "committed") {
      generation = retire.generation;
      const destroyed = await destroyGuardedEntity(entityPath, gcGate);
      gc.entityDeleted = destroyed.deleted;
      if (destroyed.entityPresentOnDisk) gc.entityPresentOnDisk = true;
      if (destroyed.warning !== undefined) gc.warnings.push(destroyed.warning);
    } else if (retire.kind === "rejected") {
      if (retire.code === "PROJECTIONS") {
        gc.blockedBy = "PROJECTIONS";
        gc.warnings.push(retire.message);
      } else if (retire.code === "GUARD_ENTITY") {
        // P1-D：投影已删（磁盘事实）+ 实体被并发换新 → typed GUARD_ENTITY 如实
        // 返回（调用方重读 state 重试；实体与磁盘内容零副作用）
        return {
          kind: "error",
          code: "GUARD_ENTITY",
          message: `projections were removed on disk but the entity was revised concurrently (${retire.message}); entity kept — re-read state and retry`,
        };
      } else if (retire.code === "REVISION") {
        // 实体被并发 ccski mutation 换新：销毁拒绝（blockedBy 词表三态均不适用，
        // warning 如实承载；GC 的 blockedBy 联合不为本拒绝类扩面）
        gc.warnings.push(`GC_ENTITY_DISK_GUARD: ${retire.message}`);
      }
      // ALREADY_GONE = 并发 GC 已退役（entityDeleted=false 如实）
    } else if (retire.kind === "recovery-required") {
      gc.warnings.push(`GC not committed: state degraded read-only (${retire.detail})`);
    } else if (retire.kind === "conflict-exhausted") {
      gc.warnings.push("GC not committed: state commit exhausted generation retries");
    }
    // ALREADY_GONE = 并发 GC 已退役；committed 分支的删除失败以 warning + entityDeleted=false 如实呈现
  } finally {
    if (gcGate.kind === "pinned") gcGate.handle.close();
  }

  return {
    kind: "ok",
    entity: toSnapshot(entityRecord),
    entityRemoved: gc.entityDeleted,
    results,
    removed,
    skipped,
    failed,
    gc,
    generation,
  };
}

export interface DeleteEntityOptions {
  scope?: EntityScope;
  name: string;
  /** 实体期望 revision（GUARD_ENTITY；缺失/不符 = 拒绝实体不动） */
  expectedRevision: string;
  /**
   * 可选显式引用复核 roots（SDK 永不环境推断）：提供时逐根 lstat/realpath 复核指向
   * 实体的引用（owned/unknown 均拒绝删除）；缺省只复核 state 注册 roots——未注册
   * roots 的引用内核不可见（删除后呈 broken typed omission，可见可恢复）。
   */
  roots?: readonly string[];
  userDir?: string;
  workspaceDir?: string;
}

export type DeleteEntityFailureCode =
  | "SCOPE_REQUIRED"
  | "ENTITY_NOT_FOUND"
  | "GUARD_ENTITY"
  | "PROJECTIONS_REMAIN"
  | "GC_UNKNOWN_REFERENCE"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

export type DeleteEntityResult =
  | {
      kind: "ok";
      entity: EntitySnapshot;
      /** 实体目录是否已删除（state 已退役但目录删除失败时 false + warning） */
      directoryDeleted: boolean;
      /**
       * 磁盘路径在场诊断（终审第三轮 P0-A）：absent 门退役 dangling 记录后发现
       * 实体路径在场（CAS 等待窗口内同名重建，非 ccski 守卫内容）——目录原样保留。
       * 仅诊断用途，不驱动决策。
       */
      entityPresentOnDisk?: boolean;
      generation: number;
      warnings: string[];
    }
  | { kind: "error"; code: DeleteEntityFailureCode; message: string };

/**
 * deleteEntity：canonical root 的实体删除半区（E4 裁决——实体 mutation 受
 * GUARD_ENTITY）。要求零投影记录（PROJECTIONS_REMAIN）与全注册 roots 无引用复核
 * （owned/unknown 引用均拒绝，unknown 以 GC_UNKNOWN_REFERENCE 呈现）；expectedRevision
 * 与 state 记录之外还必须绑定磁盘实体树（重算 revision 双重比对 + 销毁窗口身份守卫，
 * 终审 P0-3——宿主校验后实体被并发改写时拒绝销毁、零磁盘副作用）；state 退役
 * （CAS 内复核 guard 与零记录）先行，守卫销毁随后。
 */
export async function deleteEntity(options: DeleteEntityOptions): Promise<DeleteEntityResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'deleteEntity requires an explicit scope: "global" | "project".',
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
      message: `no ccski entity record for logical name "${options.name}" in ${scope} scope`,
    };
  }
  const folderName = entityRecord.folderName;
  const entityPath = entityRecord.path;

  if (
    typeof options.expectedRevision !== "string" ||
    options.expectedRevision !== entityRecord.revision
  ) {
    return {
      kind: "error",
      code: "GUARD_ENTITY",
      message: `deleteEntity expectedRevision ${
        typeof options.expectedRevision === "string" && options.expectedRevision.length > 0
          ? options.expectedRevision
          : "(missing)"
      } does not match entity revision ${entityRecord.revision}; entity untouched`,
    };
  }

  const projections = parseProjectionTable(base.projections).records;
  const remaining = [...projections.values()].filter((r) => r.folderName === folderName);
  if (remaining.length > 0) {
    return {
      kind: "error",
      code: "PROJECTIONS_REMAIN",
      message: `entity "${options.name}" still has ${remaining.length} projection record(s); remove them first (projection-first removal)`,
    };
  }

  const entityReal = realpathOrNull(entityPath);
  const scanRoots = new Set<string>();
  for (const record of projections.values()) {
    scanRoots.add(resolve(record.rootPath));
  }
  for (const rawRoot of options.roots ?? []) {
    if (typeof rawRoot === "string" && rawRoot.length > 0) scanRoots.add(resolve(rawRoot));
  }
  const verdict = classifyReferences({ scanRoots, folderName, entityPath, entityReal });
  if (verdict.verdict !== "clean") {
    return {
      kind: "error",
      // owned/unknown 引用统一以 GC_UNKNOWN_REFERENCE 拒绝（finite vocabulary）；
      // 具体形态在 warnings/detail 中区分（owned = 记录丢失的 ours 链，unknown = 未注册条目）。
      code: "GC_UNKNOWN_REFERENCE",
      message: `references to the entity still exist; deletion refused — ${
        verdict.warnings.join("; ") || `${verdict.verdict} reference found at a registered root`
      }`,
    };
  }

  // 磁盘绑定门（终审 P0-3）：expectedRevision 必须同时绑定 state 记录与磁盘实体树
  // （重算 computeSkillFolderHash 双重比对）；磁盘被并发改写/换体 → GUARD_ENTITY，
  // state 记录与磁盘内容零副作用。销毁窗口由 fd/inode 身份判据守卫（entity-disk-guard）。
  const gate = await gateEntityDestruction(entityPath, [
    options.expectedRevision,
    entityRecord.revision,
  ]);
  if (gate.kind === "refused") {
    return {
      kind: "error",
      code: "GUARD_ENTITY",
      message: `deleteEntity refused by the on-disk entity guard: ${gate.reason}; entity untouched (state record and disk content preserved)`,
    };
  }

  // state 退役 + 守卫销毁：pin fd 生命周期覆盖全流程（P1-E——recovery/conflict/
  // rejected 提前返回不再泄漏；destroyGuardedEntity 内部的幂等 close 保留）
  try {
    const retire = await commitTransform(store, (tables) => {
      const record = tables.entities.get(folderName);
      if (record === undefined) {
        return {
          kind: "reject" as const,
          code: "ENTITY_NOT_FOUND",
          message: `entity record for "${folderName}" vanished concurrently`,
        };
      }
      if (record.revision !== options.expectedRevision) {
        return {
          kind: "reject" as const,
          code: "GUARD_ENTITY",
          message: `entity was revised concurrently (revision ${record.revision}); deletion refused`,
        };
      }
      for (const projection of tables.projections.values()) {
        if (projection.folderName === folderName) {
          return {
            kind: "reject" as const,
            code: "PROJECTIONS_REMAIN",
            message: `a projection for "${folderName}" appeared concurrently; deletion refused`,
          };
        }
      }
      tables.entities.delete(folderName);
      return { kind: "apply" as const, deleteEntityKeys: [folderName] };
    });
    if (retire.kind === "recovery-required") {
      return {
        kind: "error",
        code: "STATE_RECOVERY_REQUIRED",
        message: `state degraded read-only: ${retire.detail}`,
      };
    }
    if (retire.kind === "conflict-exhausted") {
      return {
        kind: "error",
        code: "STATE_GENERATION_CONFLICT",
        message: "state commit exhausted generation retries; entity untouched",
      };
    }
    if (retire.kind === "rejected") {
      const code: DeleteEntityFailureCode =
        retire.code === "GUARD_ENTITY"
          ? "GUARD_ENTITY"
          : retire.code === "PROJECTIONS_REMAIN"
            ? "PROJECTIONS_REMAIN"
            : "ENTITY_NOT_FOUND";
      return { kind: "error", code, message: `${retire.message} (entity untouched on disk)` };
    }

    // state 已退役：销毁前过第二道守卫（身份复核 + 全树哈希复核；换体拒绝销毁）
    const destroyed = await destroyGuardedEntity(entityPath, gate);
    return {
      kind: "ok",
      entity: toSnapshot(entityRecord),
      directoryDeleted: destroyed.deleted,
      ...(destroyed.entityPresentOnDisk ? { entityPresentOnDisk: true } : {}),
      generation: retire.generation,
      warnings: destroyed.warning !== undefined ? [destroyed.warning] : [],
    };
  } finally {
    if (gate.kind === "pinned") gate.handle.close();
  }
}

// ---------------------------------------------------------------------------
// 共享判定：实体销毁的磁盘绑定守卫（终审 P0-3）
// ---------------------------------------------------------------------------

type EntityDestructionGate =
  | { kind: "absent" }
  | { kind: "pinned"; handle: EntityDiskGuardHandle; diskRevision: string }
  | { kind: "refused"; reason: string };

/**
 * 销毁前磁盘门（P0-3）：pin 实体磁盘身份（entity-disk-guard）→ 重算磁盘实体
 * revision（computeSkillFolderHash，entityRevision 的唯一表示）→ 与基准集双重比对
 * → 身份复核。任一不符 → refused（零 state/磁盘副作用：调用方在 retire 之前拒绝）。
 * absent = dangling record（磁盘无实体内容，无需守卫）：退役即收敛，磁盘路径
 * 绝不由本门处置（P0-A——后续 destroy 半区只诊断，不删除）。
 */
async function gateEntityDestruction(
  entityPath: string,
  expectedRevisions: readonly string[]
): Promise<EntityDestructionGate> {
  const opened = openEntityDiskGuard(entityPath);
  if (opened.kind !== "pinned") return opened;
  const { handle } = opened;
  let diskRevision: string;
  try {
    diskRevision = await computeSkillFolderHash(entityPath);
  } catch (error) {
    handle.close();
    return {
      kind: "refused",
      reason: `entity revision unreadable at ${entityPath} (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
  for (const expected of expectedRevisions) {
    if (diskRevision !== expected) {
      handle.close();
      return {
        kind: "refused",
        reason: `on-disk entity revision ${diskRevision.slice(0, 12)} does not match ${
          expected.length > 0 ? expected.slice(0, 12) : "(missing)"
        } (entity content was rewritten concurrently)`,
      };
    }
  }
  const pinned = handle.verify(entityPath);
  if (!pinned.ok) {
    handle.close();
    return { kind: "refused", reason: pinned.reason };
  }
  return { kind: "pinned", handle, diskRevision };
}

/**
 * 带守卫的实体销毁：state 退役提交之后调用。pinned 门 → 身份复核（目录 inode +
 * SKILL.md fd；换体拒绝销毁）→ 全树哈希复核（内容在门后又被改写拒绝销毁）→
 * **哈希通过后的第二次身份复核（P0-B：哈希读取屏障内整目录换体由 inode/fd 判据
 * 拦截——哈希值等值不等于磁盘还是同一目录）** → rmSync。残余窗口收敛到「第二次
 * 复核 → rmSync」微窗口（Node 无按 fd 销毁，与物化守卫同级，design.md 声明）。
 * refused/失败一律不碰目录，残留以 warning 如实呈现（与既有 rm 失败同一报告形态）。
 *
 * absent 门（P0-A）：dangling state 记录的退役是唯一合法动作——磁盘路径绝不被
 * 触碰。gate 时点缺席之后路径再现 = CAS 等待窗口内同名重建（非 ccski 守卫内容），
 * 以 entityPresentOnDisk 诊断如实上报（残留交 ENTITY_PATH_OCCUPIED typed 可见）。
 */
async function destroyGuardedEntity(
  entityPath: string,
  gate: Exclude<EntityDestructionGate, { kind: "refused" }>
): Promise<{ deleted: boolean; entityPresentOnDisk?: boolean; warning?: string }> {
  if (gate.kind === "absent") {
    let reappeared: boolean;
    try {
      reappeared = lstatSafe(entityPath) !== null;
    } catch (error) {
      return {
        deleted: false,
        warning: residualDirectoryWarning(
          entityPath,
          new Error(`the entity path became unreadable (${detailOf(error)})`)
        ),
      };
    }
    if (reappeared) {
      return {
        deleted: false,
        entityPresentOnDisk: true,
        warning: `entity record was retired (dangling) but the path reappeared on disk at ${entityPath} — not ccski-guarded content, left untouched (typed ENTITY_PATH_OCCUPIED on next install; repair belongs to batch 5)`,
      };
    }
    return { deleted: true };
  }
  const { handle, diskRevision } = gate;
  try {
    const post = handle.verify(entityPath);
    if (!post.ok) {
      return {
        deleted: false,
        warning: `entity record was retired but the on-disk entity no longer matches the guarded identity (${post.reason}); directory left untouched at ${entityPath} and is unrecorded (typed ENTITY_PATH_OCCUPIED on next install; repair belongs to batch 5)`,
      };
    }
    if (!post.present) {
      return { deleted: true }; // 路径已消失：无可销毁内容；同名重建会被 inode 复核拦下
    }
    let rehashed: string;
    try {
      rehashed = await computeSkillFolderHash(entityPath);
    } catch (error) {
      return {
        deleted: false,
        warning: `entity record was retired but the entity tree became unreadable (${
          error instanceof Error ? error.message : String(error)
        }); directory left untouched at ${entityPath} and is unrecorded (typed ENTITY_PATH_OCCUPIED on next install; repair belongs to batch 5)`,
      };
    }
    if (rehashed !== diskRevision) {
      return {
        deleted: false,
        warning: `entity record was retired but the entity content changed concurrently (revision ${diskRevision.slice(
          0,
          12
        )} → ${rehashed.slice(0, 12)}); directory left untouched at ${entityPath} and is unrecorded (typed ENTITY_PATH_OCCUPIED on next install; repair belongs to batch 5)`,
      };
    }
    // P0-B 第二次身份复核：哈希复读是异步读取屏障——期间整目录换体（同内容新目录）
    // 会让哈希等值通过；目录 inode / 身份源 inode / fd digest 任一漂移即拒绝销毁。
    const final = handle.verify(entityPath);
    if (!final.ok) {
      return {
        deleted: false,
        warning: `entity record was retired and the tree hash still matched, but the entity identity changed while re-hashing (${final.reason}); directory left untouched at ${entityPath} and is unrecorded (typed ENTITY_PATH_OCCUPIED on next install; repair belongs to batch 5)`,
      };
    }
    if (!final.present) {
      return { deleted: true }; // 复核时点路径已消失：无可销毁内容；换体内容从未被删
    }
    try {
      rmSync(entityPath, { recursive: true, force: true });
      return { deleted: true };
    } catch (error) {
      return { deleted: false, warning: residualDirectoryWarning(entityPath, error) };
    }
  } finally {
    handle.close();
  }
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function residualDirectoryWarning(entityPath: string, error: unknown): string {
  return `entity record was retired but the directory could not be deleted: ${
    error instanceof Error ? error.message : String(error)
  }; residual directory at ${entityPath} is unrecorded (typed ENTITY_PATH_OCCUPIED on next install; repair belongs to batch 5)`;
}

// ---------------------------------------------------------------------------
// 共享判定：注册根引用分类（GC 永不猜路径）
// ---------------------------------------------------------------------------

interface ReferenceScanArgs {
  scanRoots: ReadonlySet<string>;
  folderName: string;
  entityPath: string;
  entityReal: string | null;
}

type ReferenceVerdict =
  | { verdict: "clean"; warnings: string[] }
  | { verdict: "owned" | "unknown"; warnings: string[] };

/**
 * 逐注册/显式根复核（lstat + readlink/realpath dual-form）。symlink 判定必须先于
 * 「实体本体」跳过：指向实体的未注册链是 ccski-owned 引用（阻塞 GC），绝不能因
 * realpath 落在实体上而被当作实体自身跳过——否则 GC 会删掉仍被引用的实体。
 * - absent → clean
 * - symlink 指向实体 → ccski-owned 引用（阻塞 GC，无 warning——记录丢失的 ours 形态）
 * - symlink 指向他处 → external（非引用：不阻塞也不计入删除权限）
 * - 非链条目且路径即实体本体 → 跳过（entity root 进入扫描集时避免自判未知条目）
 * - 其余（实目录/普通文件）→ 未知引用（阻塞 + GC_UNKNOWN_REFERENCE warning）
 * - 条目无法观察（P1-E：EACCES/EIO 上抛）→ 未知引用保守阻塞（无法验证 ≠ 无引用）
 */
function classifyReferences(args: ReferenceScanArgs): ReferenceVerdict {
  const warnings: string[] = [];
  let verdict: "clean" | "owned" | "unknown" = "clean";
  for (const root of args.scanRoots) {
    const entryPath = resolve(root, args.folderName);
    let st: ReturnType<typeof lstatSafe>;
    try {
      st = lstatSafe(entryPath);
    } catch (error) {
      verdict = "unknown";
      warnings.push(
        `GC_UNKNOWN_REFERENCE: ${entryPath} (reference check unreadable: ${detailOf(error)}; treated as a blocking unknown reference)`
      );
      continue;
    }
    if (st === null) continue;
    if (st.isSymbolicLink()) {
      if (symlinkTargetsEntity(entryPath, args.entityPath)) {
        if (verdict === "clean") verdict = "owned";
        continue;
      }
      continue; // external link：非引用
    }
    if (entryPath === resolve(args.entityPath)) continue;
    const entryReal = realpathOrNull(entryPath);
    if (entryReal !== null && args.entityReal !== null && entryReal === args.entityReal) continue;
    verdict = "unknown";
    warnings.push(`GC_UNKNOWN_REFERENCE: ${entryPath} (unregistered entry at a registered root)`);
  }
  return { verdict, warnings };
}

function removeFsFailure(
  rootBase: { root: string; rootId: string; path: string },
  error: unknown,
  action: string
): EntityRemoveRootResult {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return {
      ...rootBase,
      status: "failed",
      errorCode: "TARGET_DENIED",
      error: `projection root denied ${action} (${code}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    ...rootBase,
    status: "failed",
    errorCode: "DELETE_FAILED",
    error: `failed to ${action}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

/** realpath 典范化（消失/断链 → null；dual-form 身份比对的另一半） */
function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
