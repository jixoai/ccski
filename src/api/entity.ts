/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「ensureEntity：{scope, source} → 写实体到 scope 实体根
 * （staging→rename）；NAME_COLLISION；同名不同 source 无 replace → NAME_EXISTS；
 * 显式 replace（expectedRevision guard → GUARD_ENTITY）按 design 冻结状态机全步
 * 执行」+「projectEntity：{entity, roots[], mode}——显式 roots（SDK 永不环境推断）；
 * 默认 link；materialized 需显式 reason；自动降级仅 symlink 系统调用族失败 → 如实
 * 返回 mode:"materialized", reason:"symlink-unavailable"；TARGET_DENIED 不降级；
 * strict link-only 失败不降级；结果恒返回规范化 mode+reason；投影路径被占 typed
 * 拒绝不清障」+ G3 裁决中继（2026-10-07 commit a465dc1）：「投影根 === scope 实体根
 * 的退化形态 = 第四形态 entity-local（严格化 A）：收据 targetKind:"entity" /
 * mode:"entity-local" / reason:"canonical-root"，path === canonicalPath ===
 * entityPath；不建链不复制不写 projection 记录（实体记录唯一权威）幂等；混合 roots
 * 各自独立处理；requestedMode 保留禁自拷贝伪装；canonical root 不参与投影
 * disable/remove」
 * 正交意图：
 *   [1] ensureEntity（E1/P1-3）：scope-aware 实体写入 + 冻结 sanitize + 同名 replace
 *       状态机（R1-R11 逐步对齐 g0/state-machine-consistency-checklist.md）——
 *       staging→backup→swap→回滚原语 + state 刷新（revision/provenance、link 投影
 *       stale 标注、disabled 保留、物化/pinned 不动、外部 live-link 不触碰、npm lock
 *       不写 lockSyncPending:true）
 *   [2] projectEntity（E5/P1-5）：显式 roots 投影 + 降级分类（EPERM/ENOSYS/EXDEV →
 *       symlink-unavailable 可降级；EACCES/EROFS → TARGET_DENIED 不降级）+ strict
 *       link-only + 投影路径占用 typed 拒绝（不清障）+ 物化记录落 copy guard 基准
 *       （批 4：copyHash/copyIno）与 pin 记录（reason:"pinned" → ref+folderHash，
 *       update 据此产 PINNED skip 收据）
 *   [3] entity-local 第四形态（G3 裁决冻结）：canonical root 收据、零副作用、幂等
 *   [4] CAS 提交原语 commitTransform：读→纯变换→commit 三轮重试（conflict 重读重
 *       建，禁盲覆盖；批 4 增显式键删除，raw 不兼容条目仍原样保留）；磁盘先行的
 *       补偿语义（create 提交失败回滚删除；replace 提交失败诚实上报磁盘已换新）。
 *       本原语与 stageEntityCopy/swapEntityIntoPlace/materializeCopy 为批 4
 *       update/remove/toggle 内核家族的共用原语（导出面限 entity 家族内部）。
 * 妥协声明：replace 的 swap 中断失败注入不经生产代码测试钩子——swap 拆为导出原语
 * swapEntityIntoPlace，测试以真实 rename 失败（staging 消失/EPERM）组合原语验证回滚
 * （与批 1 state-worker 同法：生产零钩子）。投影记录同键并发写收敛为最后写入（双方
 * 语义记录一致，漂移由批 4 verify 面暴露）。
 */
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  type Stats,
} from "node:fs";
import { join, resolve } from "node:path";

import { computeSkillFolderHash } from "../core/folder-hash.js";
import {
  type EntityProvenance,
  type EntityRecord,
  type EntityScope,
  MATERIALIZE_REASONS,
  type MaterializeReason,
  type ProjectionReason,
  type ProjectionRecord,
  entityRootFor,
  parseEntityTable,
  parseProjectionTable,
  projectionRecordKey,
  projectionRootId,
  resolveScopeBase,
  sanitizeEntityFolderName,
  writeResidueMarker,
} from "../core/entity-state.js";
import { CCSKI_RESIDUE_MARKER_FILENAME } from "../core/discovery.js";
import { emptyState, StateStore } from "../core/state-store.js";
import { parseSkillFile } from "../core/parser.js";

/** 与发现层保留名精确 glob 对齐（E6：.ccski-staging-* / .ccski-backup-*） */
const STAGING_PREFIX = ".ccski-staging-";
const BACKUP_PREFIX = ".ccski-backup-";

/** CAS 提交的重读重建轮数上限（超出 → STATE_GENERATION_CONFLICT 诚实失败） */
const COMMIT_RETRIES = 3;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function errnoOf(error: unknown): string | undefined {
  return isErrnoException(error) ? error.code : undefined;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lstatSafe(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function readlinkSafe(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ensureEntity
// ---------------------------------------------------------------------------

/** 安装源（本批 = 本地真实目录；git 物化入口的迁移裁决在批 5） */
export interface EntitySourceInput {
  /** 含 SKILL.md 的本地目录；必须是真实目录（symlink typed 拒绝） */
  dir: string;
  /** provenance source 身份（NAME_EXISTS 的比较基准）；缺省 = dir 的 resolve 形态原样字符串 */
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
}

export interface EnsureEntityOptions {
  /** 显式 scope（缺省/非法 = SCOPE_REQUIRED；SDK 无隐式 precedence） */
  scope?: EntityScope;
  source: EntitySourceInput;
  /**
   * 显式 replace（P1-3 冻结状态机）：必须携带当前实体的 expectedRevision
   * （缺失或不符 = GUARD_ENTITY，实体不动）。
   */
  replace?: { expectedRevision: string };
  /** global scopeBase 解析（默认 homedir；测试/宿主注入） */
  userDir?: string;
  /** project scopeBase 解析（默认 process.cwd()；测试/宿主注入） */
  workspaceDir?: string;
}

export interface EntitySnapshot {
  scope: EntityScope;
  logicalName: string;
  folderName: string;
  path: string;
  revision: string;
  provenance: EntityProvenance;
  createdAt: string;
  updatedAt: string;
}

/** ensureEntity 的有限失败词表（G0 词表冻结码 + 输入校验/IO 族） */
export type EnsureEntityFailureCode =
  | "SCOPE_REQUIRED"
  | "NAME_COLLISION"
  | "NAME_EXISTS"
  | "GUARD_ENTITY"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_SYMLINK"
  | "SOURCE_NOT_DIRECTORY"
  | "SOURCE_INVALID"
  | "ENTITY_PATH_OCCUPIED"
  | "ENTITY_SWAP_FAILED"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

export interface EnsureEntityExisting {
  logicalName: string;
  folderName: string;
  source: string;
  revision: string;
  /** 构造 replace 请求所需的 expectedRevision 取值（= 当前实体 revision） */
  expectedRevision: string;
}

export type EnsureEntityResult =
  | {
      kind: "ok";
      status: "created" | "exists" | "replaced";
      entity: EntitySnapshot;
      generation: number;
      /** ccski 永不写 npm lock（分层单写者 E2）；宿主流程必须诚实上报 lock 同步未发生 */
      lockSyncPending: true;
      warnings: string[];
    }
  | {
      kind: "error";
      code: EnsureEntityFailureCode;
      message: string;
      /** NAME_COLLISION / NAME_EXISTS / GUARD_ENTITY 时附当前实体描述（调用方据此构造 replace） */
      existing?: EnsureEntityExisting;
    };

function toSnapshot(record: EntityRecord): EntitySnapshot {
  return {
    scope: record.scope,
    logicalName: record.logicalName,
    folderName: record.folderName,
    path: record.path,
    revision: record.revision,
    provenance: record.provenance,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
export { toSnapshot };

function describeExisting(record: EntityRecord): EnsureEntityExisting {
  return {
    logicalName: record.logicalName,
    folderName: record.folderName,
    source: record.provenance.source,
    revision: record.revision,
    expectedRevision: record.revision,
  };
}

/**
 * 把 source staging 目录复制进实体根（同 scope rename 安全）。复制完成后摘除残留
 * marker（批 4 修正：marker 字节含 pid/时间戳，留在内容树里会让 folder-hash revision
 * 不可复现——同内容换新恒误判 updated、崩溃恢复的 hash 一致性断言失真）。摘除后到
 * rename 之间的崩溃窗口留下无 marker 的保留名残留，由清扫的保守面保留（no-marker
 * 不删）并归批 5 repair 收敛。失败时清理 staging 并原样重抛底层错误（调用方按 errno
 * 分类）。供 ensureEntity/updateEntity 与回滚收据测试组合。
 */
export function stageEntityCopy(sourceDir: string, entityRoot: string): string {
  const staging = mkdtempSync(join(entityRoot, STAGING_PREFIX));
  writeResidueMarker(staging, "staging");
  try {
    cpSync(sourceDir, staging, { recursive: true, force: true });
    rmSync(join(staging, CCSKI_RESIDUE_MARKER_FILENAME), { force: true });
    return staging;
  } catch (error) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // staging 残留交给保留名清扫（marker + 龄期条件）
    }
    throw error;
  }
}

export interface EntitySwapOutcome {
  ok: boolean;
  /** swap 失败时旧实体是否已回到实体路径（含「未发生任何移动」） */
  restored: boolean;
  /** 残留 backup 路径（备份删除失败或恢复失败时非空） */
  residualBackupPath?: string;
  warning?: string;
  message: string;
}

/**
 * 实体稳路径换新原语（P1-3 R4）：旧实体 → `.ccski-backup-*` → staging rename 上位 →
 * 备份删除。最终 rename 失败时 backup 回滚（旧实体保持可用）；恢复也失败时如实上报
 * 残留位置，绝不静默。实体不存在（dangling record）时跳过备份直接上位。
 */
export function swapEntityIntoPlace(
  staging: string,
  entityPath: string,
  entityRoot: string
): EntitySwapOutcome {
  const existingSt = lstatSafe(entityPath);
  let backup: string | undefined;
  if (existingSt !== null) {
    backup = mkdtempSync(join(entityRoot, BACKUP_PREFIX));
    // marker 必须在 rename 成功后写入：rename(dir → 非空目录) 会 ENOTEMPTY
    try {
      renameSync(entityPath, backup);
    } catch (error) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch {
        // 空 backup 目录残留交给保留名清扫
      }
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        // 同上
      }
      return {
        ok: false,
        restored: true,
        message: `entity swap failed before any mutation (backup rename: ${detailOf(error)}); old entity untouched at ${entityPath}`,
      };
    }
    writeResidueMarker(backup, "backup");
  }

  try {
    renameSync(staging, entityPath);
  } catch (error) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // 残留交保留名清扫
    }
    if (backup === undefined) {
      return {
        ok: false,
        restored: true,
        message: `entity swap failed at final rename (${detailOf(error)}); no old entity existed, entity path left free`,
      };
    }
    try {
      renameSync(backup, entityPath);
      return {
        ok: false,
        restored: true,
        message: `entity swap failed at final rename (${detailOf(error)}); backup restored — old entity remains usable`,
      };
    } catch (restoreError) {
      return {
        ok: false,
        restored: false,
        residualBackupPath: backup,
        message: `entity swap failed at final rename (${detailOf(error)}) AND restore failed (${detailOf(
          restoreError
        )}); old entity remains at ${backup}`,
      };
    }
  }

  if (backup !== undefined) {
    try {
      rmSync(backup, { recursive: true, force: true });
    } catch {
      return {
        ok: true,
        restored: false,
        residualBackupPath: backup,
        warning: `previous entity backup could not be deleted: ${backup}`,
        message: "entity swapped at the stable path",
      };
    }
  }
  return { ok: true, restored: false, message: "entity swapped at the stable path" };
}

interface TransformTables {
  entities: Map<string, EntityRecord>;
  projections: Map<string, ProjectionRecord>;
}

type TransformOutcome =
  | {
      kind: "apply";
      /** 本轮提交中要退役的表键（批 4 remove/GC 的记录删除；raw 不兼容条目仍按键原样保留） */
      deleteEntityKeys?: readonly string[];
      deleteProjectionKeys?: readonly string[];
    }
  | { kind: "reject"; code: string; message: string };

export type CommitTransformResult =
  | { kind: "committed"; generation: number }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "recovery-required"; detail: string }
  | { kind: "conflict-exhausted" };

/**
 * generation CAS 提交原语：读 → 纯变换（对 fresh 表重建决策，冲突即拒绝）→
 * commit；STATE_GENERATION_CONFLICT 时重读重建再试（禁盲覆盖）。raw 表中本层
 * 不识别的条目原样保留（集合读取丢弃≠改写持久化的破坏性清理）；删除只按
 * transform 显式给出的键退役。批 4 remove/GC/deleteEntity 与 ensure/project 共用。
 */
export async function commitTransform(
  store: StateStore,
  transform: (tables: TransformTables) => TransformOutcome
): Promise<CommitTransformResult> {
  for (let attempt = 0; attempt < COMMIT_RETRIES; attempt++) {
    const read = await store.read();
    if (read.kind === "recovery-required") {
      return { kind: "recovery-required", detail: read.detail };
    }
    const base = read.kind === "ok" ? read.data : emptyState();
    const tables: TransformTables = {
      entities: parseEntityTable(base.entities).records,
      projections: parseProjectionTable(base.projections).records,
    };
    const outcome = transform(tables);
    if (outcome.kind === "reject") {
      return { kind: "rejected", code: outcome.code, message: outcome.message };
    }
    const nextEntities = { ...base.entities, ...Object.fromEntries(tables.entities) };
    for (const key of outcome.deleteEntityKeys ?? []) delete nextEntities[key];
    const nextProjections = { ...base.projections, ...Object.fromEntries(tables.projections) };
    for (const key of outcome.deleteProjectionKeys ?? []) delete nextProjections[key];
    const result = await store.commit(base, {
      entities: nextEntities,
      projections: nextProjections,
    });
    if (result.kind === "committed") {
      return { kind: "committed", generation: result.data.generation };
    }
    if (result.kind === "recovery-required") {
      return { kind: "recovery-required", detail: result.detail };
    }
    // conflict → 循环重读重建
  }
  return { kind: "conflict-exhausted" };
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * ensureEntity：两阶段安装的实体半区（E1）。写实体到 scope 实体根
 * （`<scopeBase>/skills/<folderName>`，staging→rename），state 记账（entities 表 +
 * generation CAS）。同逻辑名同 source = 幂等 exists；不同 source 无 replace =
 * NAME_EXISTS；显式 replace 走冻结状态机（R1-R11）。
 */
export async function ensureEntity(options: EnsureEntityOptions): Promise<EnsureEntityResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'ensureEntity requires an explicit scope: "global" | "project".',
    };
  }
  const scope: EntityScope = options.scope;
  const sourceDir = resolve(options.source.dir);
  const sourceSt = lstatSafe(sourceDir);
  if (sourceSt === null) {
    return {
      kind: "error",
      code: "SOURCE_NOT_FOUND",
      message: `source directory not found: ${sourceDir}`,
    };
  }
  if (sourceSt.isSymbolicLink()) {
    return {
      kind: "error",
      code: "SOURCE_SYMLINK",
      message: `source is a symbolic link: ${sourceDir}; resolve it to a real directory first`,
    };
  }
  if (!sourceSt.isDirectory()) {
    return {
      kind: "error",
      code: "SOURCE_NOT_DIRECTORY",
      message: `source exists but is not a directory: ${sourceDir}`,
    };
  }
  let logicalName: string;
  try {
    logicalName = parseSkillFile(join(sourceDir, "SKILL.md")).frontmatter.name;
  } catch (error) {
    return {
      kind: "error",
      code: "SOURCE_INVALID",
      message: `source has no parseable SKILL.md (${detailOf(error)})`,
    };
  }
  const folderName = sanitizeEntityFolderName(logicalName);
  const scopeBase = resolveScopeBase(scope, options);
  const entityRoot = entityRootFor(scopeBase);
  const entityPath = join(entityRoot, folderName);
  // source 身份 = provenance.source 字符串原样比较（本地缺省 = resolve(dir)）；
  // 非 URL/路径形态的 source 原样保留，不做 resolve 改写。
  const sourceIdentity = options.source.source ?? sourceDir;
  const provenance: EntityProvenance = {
    source: sourceIdentity,
    ...(options.source.sourceType !== undefined ? { sourceType: options.source.sourceType } : {}),
    ...(options.source.sourceUrl !== undefined ? { sourceUrl: options.source.sourceUrl } : {}),
    ...(options.source.skillPath !== undefined ? { skillPath: options.source.skillPath } : {}),
    installedAt: isoNow(),
    updatedAt: isoNow(),
  };

  const store = new StateStore(scopeBase);

  for (let attempt = 0; attempt < COMMIT_RETRIES; attempt++) {
    const read = await store.read();
    if (read.kind === "recovery-required") {
      return {
        kind: "error",
        code: "STATE_RECOVERY_REQUIRED",
        message: `ccski state at ${store.statePath} degraded read-only: ${read.detail}`,
      };
    }
    const base = read.kind === "ok" ? read.data : emptyState();
    const entities = parseEntityTable(base.entities);
    const existing = entities.records.get(folderName);
    const generation = base.generation;

    // ---- 纯决策（零副作用）----
    if (existing && existing.logicalName !== logicalName) {
      return {
        kind: "error",
        code: "NAME_COLLISION",
        message: `logical name "${logicalName}" sanitizes to folder "${folderName}", already owned by logical name "${existing.logicalName}" (frozen sanitize; collision is typed, never silent overwrite)`,
        existing: describeExisting(existing),
      };
    }
    if (existing && existing.provenance.source !== sourceIdentity) {
      if (!options.replace) {
        return {
          kind: "error",
          code: "NAME_EXISTS",
          message: `logical name "${logicalName}" already installed from source "${existing.provenance.source}"; pass replace.expectedRevision to replace explicitly`,
          existing: describeExisting(existing),
        };
      }
      const expected = options.replace.expectedRevision;
      if (typeof expected !== "string" || expected.length === 0 || expected !== existing.revision) {
        return {
          kind: "error",
          code: "GUARD_ENTITY",
          message: `replace expectedRevision ${
            typeof expected === "string" && expected.length > 0 ? expected : "(missing)"
          } does not match entity revision ${existing.revision}; entity untouched`,
          existing: describeExisting(existing),
        };
      }
    } else if (existing) {
      // 同逻辑名 + 同 source：幂等 ensure；dangling record（磁盘缺失）走修复重建
      const diskSt = lstatSafe(entityPath);
      if (diskSt !== null && (diskSt.isSymbolicLink() || !diskSt.isDirectory())) {
        return {
          kind: "error",
          code: "ENTITY_PATH_OCCUPIED",
          message: `entity path ${entityPath} is occupied by a non-directory entry`,
        };
      }
      if (diskSt !== null) {
        return {
          kind: "ok",
          status: "exists",
          entity: toSnapshot(existing),
          generation,
          lockSyncPending: true,
          warnings: [],
        };
      }
    } else {
      const diskSt = lstatSafe(entityPath);
      if (diskSt !== null) {
        return {
          kind: "error",
          code: "ENTITY_PATH_OCCUPIED",
          message: `entity path ${entityPath} is occupied by an entry with no ccski entity record; adoption of legacy/foreign directories belongs to migrate (batch 5)`,
        };
      }
    }

    const replaceTarget =
      existing !== undefined && existing.provenance.source !== sourceIdentity ? existing : undefined;

    // ---- 变更半区 ----
    try {
      mkdirSync(entityRoot, { recursive: true });
    } catch (error) {
      return {
        kind: "error",
        code: "IO",
        message: `failed to ensure entity root ${entityRoot}: ${detailOf(error)}`,
      };
    }
    let staging: string;
    let newRevision: string;
    try {
      staging = stageEntityCopy(sourceDir, entityRoot);
    } catch (error) {
      return {
        kind: "error",
        code: "IO",
        message: `failed to stage entity copy from ${sourceDir}: ${detailOf(error)}`,
      };
    }
    try {
      newRevision = await computeSkillFolderHash(staging);
    } catch (error) {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        // 残留交保留名清扫
      }
      return { kind: "error", code: "IO", message: `failed to hash staged entity: ${detailOf(error)}` };
    }

    const buildRecord = (createdAt: string): EntityRecord => ({
      kind: "entity",
      scope,
      logicalName,
      folderName,
      path: entityPath,
      revision: newRevision,
      provenance,
      createdAt,
      updatedAt: provenance.updatedAt,
    });

    if (replaceTarget !== undefined) {
      // P1-3 冻结 replace 状态机（R4-R11）
      const outcome = swapEntityIntoPlace(staging, entityPath, entityRoot);
      if (!outcome.ok) {
        // R4：state 记失败 generation（尽力而为；失败并入上报）
        const marked = await commitTransform(store, (tables) => {
          const rec = tables.entities.get(folderName);
          if (rec) {
            tables.entities.set(folderName, {
              ...rec,
              lastFailure: { operation: "replace", at: isoNow(), detail: outcome.message },
            });
          }
          return { kind: "apply" };
        });
        const stateNote =
          marked.kind === "committed"
            ? "state recorded the failed generation"
            : `state failure note was not committed (${marked.kind})`;
        return {
          kind: "error",
          code: "ENTITY_SWAP_FAILED",
          message: `${outcome.message}; ${stateNote}`,
        };
      }
      const warnings = outcome.warning !== undefined ? [outcome.warning] : [];
      // R6-R10：state 刷新 revision/provenance（installedAt 保留）；link 投影标
      // stale（保留旧 entityRevision）；disabled 保留；物化/pinned 不动；外部
      // live-link 不在 state 记录内，天然不触碰。
      const refreshedProvenance: EntityProvenance = {
        ...provenance,
        installedAt: replaceTarget.provenance.installedAt,
      };
      const refreshed = await commitTransform(store, (tables) => {
        const rec = tables.entities.get(folderName);
        tables.entities.set(
          folderName,
          rec
            ? {
                ...rec,
                revision: newRevision,
                provenance: refreshedProvenance,
                updatedAt: provenance.updatedAt,
                lastFailure: undefined,
              }
            : buildRecord(isoNow())
        );
        for (const [key, projection] of tables.projections) {
          if (projection.folderName !== folderName) continue;
          if (projection.mode !== "link") continue; // R9：物化/pinned 副本不动
          tables.projections.set(key, { ...projection, stale: true }); // R8：旧 revision 保留 + stale
        }
        return { kind: "apply" };
      });
      if (refreshed.kind === "committed") {
        return {
          kind: "ok",
          status: "replaced",
          entity: {
            scope,
            logicalName,
            folderName,
            path: entityPath,
            revision: newRevision,
            provenance: refreshedProvenance,
            createdAt: replaceTarget.createdAt,
            updatedAt: provenance.updatedAt,
          },
          generation: refreshed.generation,
          lockSyncPending: true,
          warnings,
        };
      }
      const reconcile =
        refreshed.kind === "recovery-required"
          ? refreshed.detail
          : "state commit exhausted generation retries";
      return {
        kind: "error",
        code: refreshed.kind === "recovery-required" ? "STATE_RECOVERY_REQUIRED" : "STATE_GENERATION_CONFLICT",
        message: `entity content was swapped at ${entityPath} but state was not refreshed (${reconcile}); re-run ensureEntity with replace.expectedRevision=${replaceTarget.revision} to reconcile`,
      };
    }

    // create / dangling-record 修复重建：磁盘先行，state 提交失败则补偿删除
    let renamed = false;
    try {
      renameSync(staging, entityPath);
      renamed = true;
    } catch {
      try {
        rmSync(staging, { recursive: true, force: true });
      } catch {
        // 残留交保留名清扫
      }
    }
    if (!renamed) {
      // rename 失败 = 路径被并发占据：一次重读对账（exists/碰撞/同名异源）
      const fresh = await store.read();
      if (fresh.kind === "recovery-required") {
        return {
          kind: "error",
          code: "STATE_RECOVERY_REQUIRED",
          message: `entity path ${entityPath} is occupied and state degraded read-only: ${fresh.detail}`,
        };
      }
      const freshEntities = parseEntityTable(
        fresh.kind === "ok" ? fresh.data.entities : emptyState().entities
      );
      const freshRecord = freshEntities.records.get(folderName);
      if (freshRecord && freshRecord.logicalName !== logicalName) {
        return {
          kind: "error",
          code: "NAME_COLLISION",
          message: `logical name "${logicalName}" sanitizes to folder "${folderName}", now owned by "${freshRecord.logicalName}"`,
          existing: describeExisting(freshRecord),
        };
      }
      if (freshRecord && freshRecord.provenance.source !== sourceIdentity) {
        return {
          kind: "error",
          code: "NAME_EXISTS",
          message: `entity path ${entityPath} is occupied by "${freshRecord.provenance.source}"; pass replace.expectedRevision to replace`,
          existing: describeExisting(freshRecord),
        };
      }
      if (freshRecord) {
        return {
          kind: "ok",
          status: "exists",
          entity: toSnapshot(freshRecord),
          generation: fresh.kind === "ok" ? fresh.data.generation : 0,
          lockSyncPending: true,
          warnings: [],
        };
      }
      return {
        kind: "error",
        code: "ENTITY_PATH_OCCUPIED",
        message: `entity path ${entityPath} is occupied by an entry with no ccski record`,
      };
    }

    const created = await commitTransform(store, (tables) => {
      const rec = tables.entities.get(folderName);
      if (rec && rec.logicalName !== logicalName) {
        return {
          kind: "reject" as const,
          code: "NAME_COLLISION",
          message: `folder "${folderName}" is now owned by logical name "${rec.logicalName}"`,
        };
      }
      if (rec && rec.provenance.source !== sourceIdentity) {
        return {
          kind: "reject" as const,
          code: "NAME_EXISTS",
          message: `folder "${folderName}" is now owned by source "${rec.provenance.source}"`,
        };
      }
      tables.entities.set(folderName, rec ? buildRecord(rec.createdAt) : buildRecord(isoNow()));
      return { kind: "apply" };
    });

    if (created.kind === "committed") {
      return {
        kind: "ok",
        status: "created",
        entity: {
          scope,
          logicalName,
          folderName,
          path: entityPath,
          revision: newRevision,
          provenance,
          createdAt: isoNow(),
          updatedAt: provenance.updatedAt,
        },
        generation: created.generation,
        lockSyncPending: true,
        warnings: [],
      };
    }

    // 补偿：刚 rename 上位的实体目录是本调用产物，提交失败即回滚删除
    let compensated = true;
    try {
      rmSync(entityPath, { recursive: true, force: true });
    } catch {
      compensated = false;
    }
    if (created.kind === "rejected") {
      return { kind: "error", code: created.code as EnsureEntityFailureCode, message: created.message };
    }
    const reason =
      created.kind === "recovery-required"
        ? `state degraded read-only: ${created.detail}`
        : "state commit exhausted generation retries";
    return {
      kind: "error",
      code: created.kind === "recovery-required" ? "STATE_RECOVERY_REQUIRED" : "STATE_GENERATION_CONFLICT",
      message: `entity was staged but the state commit failed (${reason})${
        compensated ? "; the staged entity directory was removed" : `; residual entity directory remains unrecorded at ${entityPath}`
      }`,
    };
  }
  return {
    kind: "error",
    code: "STATE_GENERATION_CONFLICT",
    message: "ensureEntity exhausted its decision retries under concurrent state writers",
  };
}

// ---------------------------------------------------------------------------
// projectEntity
// ---------------------------------------------------------------------------

export interface ProjectEntityCommon {
  /** 显式 scope（缺省/非法 = SCOPE_REQUIRED） */
  scope?: EntityScope;
  /** 实体逻辑名（frontmatter name；经 state 实体记录解析） */
  name: string;
  /** 显式投影根（SDK 永不环境推断；逐根独立处理与收据） */
  roots: readonly string[];
  /** link-only：link 失败不降级（E5 strict 选项） */
  strict?: boolean;
  /**
   * symlink 系统调用注入 seam（G3 降级分类收据用，brief 授权「注入 seam 构造」）：
   * 生产调用方恒缺省 = node:fs symlinkSync。仅测试矩阵以真实 errno 构造平台
   * 不可直接构造的降级类（ENOSYS/EXDEV）；除此之外无任何测试钩子。
   */
  symlinkImpl?: (target: string, path: string) => void;
  /** global scopeBase 解析（默认 homedir；测试/宿主注入） */
  userDir?: string;
  /** project scopeBase 解析（默认 process.cwd()；测试/宿主注入） */
  workspaceDir?: string;
}

export type ProjectEntityOptions = ProjectEntityCommon &
  (
    | {
        /** 默认 link（symlink 到实体路径） */
        mode?: "link";
        reason?: never;
      }
    | {
        mode: "materialized";
        /** 显式物化触发（E5：pinned | imported-root | user-request；永不自动） */
        reason: MaterializeReason;
      }
  );

/** 投影根收据 status */
export type ProjectRootStatus = "projected" | "unchanged" | "failed";

/** 逐根失败词表（G0 词表冻结码 TARGET_DENIED + 形态/占用/输入族） */
export type ProjectRootFailureCode =
  | "TARGET_DENIED"
  | "PROJECTION_PATH_OCCUPIED"
  | "PROJECTION_DISABLED"
  | "MODE_CONFLICT"
  | "ROOT_SYMLINK"
  | "ROOT_NOT_DIRECTORY"
  | "SYMLINK_FAILED"
  | "COPY_FAILED"
  | "IO";

export interface ProjectRootResult {
  /** resolve 归一后的投影根 */
  root: string;
  rootId: string;
  /** 投影绝对路径；entity-local 收据上 === canonicalPath === entityPath */
  path: string;
  status: ProjectRootStatus;
  /**
   * 规范化最终形态：link | materialized | entity-local（G3 第四形态）。
   * 禁止「报 link 附失败」——失败条目无 mode。
   */
  mode?: "link" | "materialized" | "entity-local";
  /** 落账 reason：显式三类 / 唯一自动降级 symlink-unavailable / canonical-root */
  reason?: ProjectionReason | "canonical-root";
  /** G3 第四形态标注：canonical root 收据 targetKind:"entity"；普通投影根 = "projection" */
  targetKind?: "entity" | "projection";
  /** 实体路径（entity-local 收据携带；spec: path === canonicalPath === entityPath） */
  canonicalPath?: string;
  /** 请求 mode（entity-local 收据保留：禁悄悄声称存在独立副本） */
  requestedMode?: "link" | "materialized";
  errorCode?: ProjectRootFailureCode;
  error?: string;
}

/** projectEntity 顶层失败词表 */
export type ProjectEntityTopErrorCode =
  | "SCOPE_REQUIRED"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_MISSING"
  | "INVALID_ROOTS"
  | "INVALID_MODE"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

export type ProjectEntityResult =
  | {
      kind: "ok";
      entity: EntitySnapshot;
      results: ProjectRootResult[];
      projected: number;
      unchanged: number;
      failed: number;
      generation: number;
    }
  | {
      kind: "error";
      code: ProjectEntityTopErrorCode;
      message: string;
      /** 失败前已在磁盘落下的投影逐根收据（诚实部分态；重跑同调用可对账） */
      results?: ProjectRootResult[];
    };

function isMaterializeReason(value: unknown): value is MaterializeReason {
  return typeof value === "string" && (MATERIALIZE_REASONS as readonly string[]).includes(value);
}

/** canonical root 判定（G3 第四形态）：resolve 双形态 + realpath 对齐（macOS /var 族） */
function isCanonicalEntityRoot(rootPath: string, entityRoot: string): boolean {
  const a = resolve(rootPath);
  const b = resolve(entityRoot);
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
export { isCanonicalEntityRoot };

export interface MaterializeOutcome {
  ok: boolean;
  code?: "TARGET_DENIED" | "COPY_FAILED" | "IO";
  error?: string;
}

/**
 * 物化复制（staging→rename，装在投影根内）。EACCES/EROFS = 目标级权限 →
 * TARGET_DENIED；其余复制/换名失败 = COPY_FAILED；staging 建立失败按 errno 分类。
 * 批 4 update 的逐副本重物化复用本原语（换旧副本走 swapEntityIntoPlace）。
 */
export function materializeCopy(
  entityPath: string,
  rootPath: string,
  projPath: string
): MaterializeOutcome {
  let staging: string;
  try {
    staging = mkdtempSync(join(rootPath, STAGING_PREFIX));
    writeResidueMarker(staging, "staging");
  } catch (error) {
    const code = errnoOf(error);
    if (code === "EACCES" || code === "EROFS" || code === "EPERM") {
      return { ok: false, code: "TARGET_DENIED", error: `projection root denies staging (${code}): ${rootPath}` };
    }
    return { ok: false, code: "IO", error: `failed to stage materialized copy in ${rootPath}: ${detailOf(error)}` };
  }
  try {
    cpSync(entityPath, staging, { recursive: true, force: true });
    // 与 stageEntityCopy 同法：摘除 marker 后才上位（副本内容 = 实体内容，copyHash
    // guard 的基准恒可复现）
    rmSync(join(staging, CCSKI_RESIDUE_MARKER_FILENAME), { force: true });
    renameSync(staging, projPath);
    return { ok: true };
  } catch (error) {
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // 残留交保留名清扫
    }
    const code = errnoOf(error);
    // EPERM（如 macOS uchg 不可变目录）与 EACCES/EROFS 同属目标级权限/ownership
    // 拒绝——降级半区（复制）被目标拒绝时如实 TARGET_DENIED，绝不静默。
    if (code === "EACCES" || code === "EROFS" || code === "EPERM") {
      return { ok: false, code: "TARGET_DENIED", error: `projection root denied copy (${code}): ${projPath}` };
    }
    return { ok: false, code: "COPY_FAILED", error: `failed to materialize ${projPath}: ${detailOf(error)}` };
  }
}

function failedRoot(
  base: { root: string; rootId: string; path: string },
  errorCode: ProjectRootFailureCode,
  error: string
): ProjectRootResult {
  return { ...base, status: "failed", errorCode, error };
}

/**
 * projectEntity：两阶段安装的投影半区（E5 + G3 第四形态）。只对显式 roots 建
 * 投影；默认 link；materialized 需显式 reason；自动降级仅 symlink 系统调用族
 * （EPERM/ENOSYS/EXDEV）→ mode:"materialized", reason:"symlink-unavailable"；
 * 目标级权限（EACCES/EROFS）→ TARGET_DENIED 不降级；strict link-only 失败不
 * 降级；投影路径被占 typed 拒绝不清障。canonical root = entity-local 收据
 * （零副作用、幂等、不写投影记录）。
 */
export async function projectEntity(options: ProjectEntityOptions): Promise<ProjectEntityResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'projectEntity requires an explicit scope: "global" | "project".',
    };
  }
  if (!Array.isArray(options.roots) || options.roots.length === 0) {
    return {
      kind: "error",
      code: "INVALID_ROOTS",
      message: "projectEntity requires at least one explicit projection root; the SDK never infers roots from the environment",
    };
  }
  const requestedMode = options.mode ?? "link";
  if (requestedMode !== "link" && requestedMode !== "materialized") {
    return {
      kind: "error",
      code: "INVALID_MODE",
      message: 'mode must be "link" (default) or "materialized"',
    };
  }
  const requestedReason = (options as { reason?: unknown }).reason;
  if (requestedMode === "materialized") {
    if (!isMaterializeReason(requestedReason)) {
      return {
        kind: "error",
        code: "INVALID_MODE",
        message: 'materialized requires an explicit reason: "pinned" | "imported-root" | "user-request"',
      };
    }
  } else if (requestedReason !== undefined) {
    return {
      kind: "error",
      code: "INVALID_MODE",
      message: 'reason is only valid with mode "materialized"',
    };
  }
  const scope: EntityScope = options.scope;
  const materializeReason =
    requestedMode === "materialized" ? (requestedReason as MaterializeReason) : undefined;

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
  const entities = parseEntityTable(base.entities).records;
  const projections = parseProjectionTable(base.projections).records;

  let entityRecord: EntityRecord | undefined;
  for (const record of entities.values()) {
    if (record.logicalName === options.name) {
      entityRecord = record;
      break;
    }
  }
  if (entityRecord === undefined) {
    return {
      kind: "error",
      code: "ENTITY_NOT_FOUND",
      message: `no ccski entity record for logical name "${options.name}" in ${options.scope} scope; ensureEntity owns entity creation`,
    };
  }
  const entityPath = entityRecord.path;
  const entitySt = lstatSafe(entityPath);
  if (entitySt === null || entitySt.isSymbolicLink() || !entitySt.isDirectory()) {
    return {
      kind: "error",
      code: "ENTITY_MISSING",
      message: `recorded entity directory is missing or invalid at ${entityPath}; recovery belongs to update/repair (batch 4/5)`,
    };
  }

  const results: ProjectRootResult[] = [];
  /** 待落账的新建/修复投影记录（一次 CAS 提交） */
  const pendingRecords = new Map<string, ProjectionRecord>();

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
    const recordKey = projectionRecordKey(rootId, entityRecord.folderName);
    const projPath = join(rootPath, entityRecord.folderName);
    const rootBase = { root: rootPath, rootId, path: projPath };

    // ---- G3 第四形态：canonical root = entity-local 收据（零副作用、幂等）----
    if (isCanonicalEntityRoot(rootPath, entityRoot)) {
      results.push({
        ...rootBase,
        status: "unchanged",
        mode: "entity-local",
        reason: "canonical-root",
        targetKind: "entity",
        canonicalPath: entityPath,
        requestedMode,
      });
      continue;
    }

    const existingRecord = projections.get(recordKey);
    if (existingRecord && existingRecord.disabled) {
      results.push(
        failedRoot(
          rootBase,
          "PROJECTION_DISABLED",
          "projection is disabled; re-enable goes through toggle with entity revision check (batch 4)"
        )
      );
      continue;
    }
    if (existingRecord && existingRecord.mode !== requestedMode) {
      results.push(
        failedRoot(
          rootBase,
          "MODE_CONFLICT",
          `recorded mode "${existingRecord.mode}" differs from requested "${requestedMode}"; mode switching is an update/toggle operation (batch 4)`
        )
      );
      continue;
    }

    // 投影根校验（缺失即建；symlink/文件根 typed 拒绝）
    const rootSt = lstatSafe(rootPath);
    if (rootSt === null) {
      try {
        mkdirSync(rootPath, { recursive: true });
      } catch (error) {
        const code = errnoOf(error);
        if (code === "EACCES" || code === "EROFS") {
          results.push(failedRoot(rootBase, "TARGET_DENIED", `projection root cannot be created (${code}): ${rootPath}`));
        } else {
          results.push(failedRoot(rootBase, "IO", `failed to create projection root ${rootPath}: ${detailOf(error)}`));
        }
        continue;
      }
    } else if (rootSt.isSymbolicLink()) {
      results.push(failedRoot(rootBase, "ROOT_SYMLINK", `projection root is a symbolic link: ${rootPath}`));
      continue;
    } else if (!rootSt.isDirectory()) {
      results.push(failedRoot(rootBase, "ROOT_NOT_DIRECTORY", `projection root exists but is not a directory: ${rootPath}`));
      continue;
    }

    const newRecord = (
      mode: "link" | "materialized",
      reason: ProjectionReason | undefined,
      /** 物化副本 guard 基准（copyHash = 副本自身 hash；copyIno = 副本目录 inode） */
      copy?: { copyHash?: string; copyIno: number }
    ): ProjectionRecord => ({
      kind: "projection",
      scope,
      rootId,
      rootPath,
      folderName: entityRecord.folderName,
      logicalName: entityRecord.logicalName,
      path: projPath,
      mode,
      ...(reason !== undefined ? { reason } : {}),
      entityRevision: entityRecord.revision,
      disabled: false,
      ownership: "ccski",
      ...(mode === "materialized" && copy !== undefined && copy.copyHash !== undefined
        ? { copyHash: copy.copyHash }
        : {}),
      ...(mode === "materialized" && copy !== undefined ? { copyIno: copy.copyIno } : {}),
      ...(mode === "materialized" && reason === "pinned"
        ? {
            // E4/裁决表 #11：pin = source ref + folder hash 组合落 state（update 据此产 PINNED skip）
            pin: {
              ref: entityRecord.provenance.source,
              folderHash: copy?.copyHash ?? entityRecord.revision,
            },
          }
        : {}),
      createdAt: isoNow(),
      updatedAt: isoNow(),
    });

    const projSt = lstatSafe(projPath);
    if (projSt !== null) {
      // 既有磁盘形态：ours（且与请求一致）→ unchanged（补记 state）；否则占用拒绝不清障
      if (requestedMode === "link") {
        if (projSt.isSymbolicLink()) {
          const rawTarget = readlinkSafe(projPath);
          const target = rawTarget !== null ? resolve(rootPath, rawTarget) : null;
          if (target !== null && target === resolve(entityPath)) {
            if (!existingRecord) {
              pendingRecords.set(recordKey, newRecord("link", undefined));
            }
            results.push({ ...rootBase, status: "unchanged", mode: "link", targetKind: "projection" });
          } else {
            results.push(
              failedRoot(rootBase, "PROJECTION_PATH_OCCUPIED", "a foreign symlink occupies the projection path; refusing to clear it")
            );
          }
        } else {
          results.push(
            failedRoot(
              rootBase,
              "PROJECTION_PATH_OCCUPIED",
              projSt.isDirectory()
                ? "a real directory occupies the projection path; refusing to clear it"
                : "a non-directory file occupies the projection path; refusing to clear it"
            )
          );
        }
      } else {
        if (projSt.isDirectory() && !projSt.isSymbolicLink()) {
          if (!existingRecord) {
            // 补记既有副本：copyHash = 副本实际内容 hash（可能与实体已分叉，guard 基准以副本为准）
            let adoptedHash: string | undefined;
            try {
              adoptedHash = await computeSkillFolderHash(projPath);
            } catch {
              adoptedHash = undefined; // hash 失败 → 无 guard 基准（remove/update 回退 entityRevision 保守拒绝）
            }
            pendingRecords.set(
              recordKey,
              newRecord("materialized", materializeReason, {
                ...(adoptedHash !== undefined ? { copyHash: adoptedHash } : {}),
                copyIno: projSt.ino,
              })
            );
          }
          results.push({
            ...rootBase,
            status: "unchanged",
            mode: "materialized",
            ...(materializeReason !== undefined ? { reason: materializeReason } : {}),
            targetKind: "projection",
          });
        } else {
          results.push(
            failedRoot(rootBase, "PROJECTION_PATH_OCCUPIED", "the projection path is occupied by a non-directory entry; refusing to clear it")
          );
        }
      }
      continue;
    }

    // 磁盘缺席 → 建投影
    if (requestedMode === "link") {
      const createSymlink = options.symlinkImpl ?? symlinkSync;
      try {
        createSymlink(entityPath, projPath);
      } catch (error) {
        const code = errnoOf(error);
        if (code === "EPERM" || code === "ENOSYS" || code === "EXDEV") {
          // E5 唯一自动降级类：symlink 系统调用族失败 → materialized + symlink-unavailable
          if (options.strict === true) {
            results.push(
              failedRoot(
                rootBase,
                "SYMLINK_FAILED",
                `symlink() failed with ${code}; strict link-only mode suppresses the symlink-unavailable downgrade`
              )
            );
            continue;
          }
          const materialized = materializeCopy(entityPath, rootPath, projPath);
          if (!materialized.ok) {
            results.push(failedRoot(rootBase, materialized.code ?? "IO", materialized.error ?? "materialization failed"));
            continue;
          }
          const copySt = lstatSafe(projPath);
          pendingRecords.set(
            recordKey,
            newRecord(
              "materialized",
              "symlink-unavailable",
              copySt ? { copyHash: entityRecord.revision, copyIno: copySt.ino } : undefined
            )
          );
          results.push({
            ...rootBase,
            status: "projected",
            mode: "materialized",
            reason: "symlink-unavailable",
            targetKind: "projection",
          });
          continue;
        }
        if (code === "EACCES" || code === "EROFS") {
          // 目标级权限错误：直接失败，禁止静默 copy
          results.push(failedRoot(rootBase, "TARGET_DENIED", `projection root denied symlink creation (${code}): ${projPath}`));
          continue;
        }
        results.push(failedRoot(rootBase, "IO", `symlink creation failed at ${projPath}: ${detailOf(error)}`));
        continue;
      }
      pendingRecords.set(recordKey, newRecord("link", undefined));
      results.push({ ...rootBase, status: "projected", mode: "link", targetKind: "projection" });
      continue;
    }

    const materialized = materializeCopy(entityPath, rootPath, projPath);
    if (!materialized.ok) {
      results.push(failedRoot(rootBase, materialized.code ?? "IO", materialized.error ?? "materialization failed"));
      continue;
    }
    const copySt = lstatSafe(projPath);
    pendingRecords.set(
      recordKey,
      newRecord(
        "materialized",
        materializeReason,
        copySt ? { copyHash: entityRecord.revision, copyIno: copySt.ino } : undefined
      )
    );
    results.push({
      ...rootBase,
      status: "projected",
      mode: "materialized",
      ...(materializeReason !== undefined ? { reason: materializeReason } : {}),
      targetKind: "projection",
    });
  }

  const projected = results.filter((r) => r.status === "projected").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const entity = toSnapshot(entityRecord);

  if (pendingRecords.size === 0) {
    return { kind: "ok", entity, results, projected, unchanged, failed, generation: base.generation };
  }

  const commit = await commitTransform(store, (tables) => {
    // 同键并发写收敛为最后写入：记录语义一致（同一实体/根），漂移由批 4 verify 面暴露
    for (const [key, record] of pendingRecords) {
      tables.projections.set(key, record);
    }
    return { kind: "apply" };
  });
  if (commit.kind === "committed") {
    return { kind: "ok", entity, results, projected, unchanged, failed, generation: commit.generation };
  }
  const reconcile =
    commit.kind === "recovery-required"
      ? `state degraded read-only: ${commit.detail}`
      : "state commit exhausted generation retries";
  return {
    kind: "error",
    code: commit.kind === "recovery-required" ? "STATE_RECOVERY_REQUIRED" : "STATE_GENERATION_CONFLICT",
    message: `projections were created on disk but state was not updated (${reconcile}); re-run projectEntity with the same roots to reconcile records`,
    results,
  };
}

// re-export 便于宿主单点导入（entity-state 为内核内部模块，不入包根）
export {
  sanitizeEntityFolderName,
  resolveScopeBase,
  entityRootFor,
  projectionRootId,
  projectionRecordKey,
  type EntityScope,
  type EntityRecord,
  type ProjectionRecord,
  type MaterializeReason,
  type ProjectionReason,
} from "../core/entity-state.js";
