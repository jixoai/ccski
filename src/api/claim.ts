/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「import --claim = 目标 inode+content hash 守卫 +
 * CLAIM_CONFLICT（reason 区分 name-conflict/identity-mismatch 双触发）+ 只动 state
 * 可回滚 + 批 4 移交：未注册同目标链的收编面」（批 5 tasks.md:44；spec: Explicit
 * claim, repair, and gc contracts + design G0 回流裁决 #1）
 * 正交意图：
 *   [1] claim 身份守卫（spec: Claim requires exact identity）：期望 inode +
 *       content hash 双判据不符 → CLAIM_CONFLICT reason:"identity-mismatch"，零
 *       state 变更（TOCTOU 防线：dry-run 观察与 claim 执行之间的换体拒绝）
 *   [2] CLAIM_CONFLICT 单码双触发类（G0 回流裁决 #1）：identity-mismatch 之外，
 *       名字冲突（链接名 ≠ 实体 folderName / 投影键已被他者登记）→ reason:
 *       "name-conflict"；两类以 finite reason 区分，fixture 各钉一例
 *   [3] 只动 state（spec: a claim MUST touch state only）：收编 = 写一条投影记录
 *       （CAS），文件系统零变化 → 天然可由 state revert 回滚
 *   [4] 收编对象（批 4 移交闭环）：未注册同目标链——realpath 命中本 scope 已记录
 *       的 ccski 实体；指向非实体目标的链收编归 migrate（claim 不猜实体身份）
 * 妥协声明：claim 不接管「外部 live-link → 新实体」的整链迁移（那需要实体收编 +
 * 路径重写，属 migrate 面）；已注册记录幂等 unchanged（重复 claim 不改写既有记账）。
 */
import { lstatSync } from "node:fs";
import { resolve } from "node:path";

import {
  parseEntityTable,
  parseProjectionTable,
  projectionRecordKey,
  projectionRootId,
  resolveScopeBase,
  type EntityRecord,
  type EntityScope,
} from "../core/entity-state.js";
import { computeSkillFolderHash } from "../core/folder-hash.js";
import { emptyState, StateStore } from "../core/state-store.js";
import { lstatSafe, realpathSafe } from "./entity-guards.js";
import { commitTransform, toSnapshot, type EntitySnapshot } from "./entity.js";

export type ClaimFailureCode =
  | "SCOPE_REQUIRED"
  | "LINK_NOT_FOUND"
  | "LINK_NOT_SYMLINK"
  | "TARGET_INVALID"
  | "ENTITY_NOT_FOUND"
  | "CLAIM_CONFLICT"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

/** CLAIM_CONFLICT 的双触发类（G0 回流裁决 #1：单码 + finite reason 区分） */
export type ClaimConflictReason = "name-conflict" | "identity-mismatch";

export type ClaimResult =
  | {
      kind: "ok";
      /** claimed = 新写投影记录；unchanged = 记录已在（幂等重放，零写入） */
      status: "claimed" | "unchanged";
      entity: EntitySnapshot;
      projection: {
        rootId: string;
        rootPath: string;
        path: string;
        mode: "link";
        entityRevision: string;
      };
      /** identity guard 的实测值（收据自证） */
      verified: { inode: number; contentHash: string };
      generation: number;
      warnings: string[];
    }
  | {
      kind: "error";
      code: ClaimFailureCode;
      message: string;
      /** CLAIM_CONFLICT 专属：双触发类（name-conflict | identity-mismatch） */
      reason?: ClaimConflictReason;
    };

/**
 * import --claim（收编半区）：把一条指向本 scope 已记录 ccski 实体的未注册
 * symlink 收编为 link 投影。目标 inode + content hash 双守卫；冲突 typed
 * CLAIM_CONFLICT（reason 区分 name-conflict / identity-mismatch）；只写 state
 * （CAS），文件系统零变化、可由 state revert 回滚。
 */
export async function claimLink(options: {
  scope?: EntityScope;
  /** 待收编 symlink 的绝对路径（= 投影根下的链接位） */
  link: string;
  /** 期望的目标目录 inode（收编前 dry-run 观察的 lstat(realpath(link)).ino） */
  expectedInode: number;
  /** 期望的目标内容 hash（computeSkillFolderHash(realpath(link))，64 hex） */
  expectedHash: string;
  userDir?: string;
  workspaceDir?: string;
}): Promise<ClaimResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'claim requires an explicit scope: "global" | "project".',
    };
  }
  const scope: EntityScope = options.scope;
  const linkPath = resolve(options.link);

  const linkSt = lstatSafe(linkPath);
  if (linkSt === null) {
    return { kind: "error", code: "LINK_NOT_FOUND", message: `link not found: ${linkPath}` };
  }
  if (!linkSt.isSymbolicLink()) {
    return {
      kind: "error",
      code: "LINK_NOT_SYMLINK",
      message: `claim adopts symlinks only; the path is not a symbolic link: ${linkPath}`,
    };
  }

  // ---- 目标身份守卫（spec: only with the target's expected inode and content hash）----
  const targetReal = realpathSafe(linkPath);
  if (targetReal === null) {
    return {
      kind: "error",
      code: "TARGET_INVALID",
      message: `link target is broken (realpath failed): ${linkPath}`,
    };
  }
  const targetSt = lstatSync(targetReal);
  if (!targetSt.isDirectory()) {
    return {
      kind: "error",
      code: "TARGET_INVALID",
      message: `link target is not a directory: ${targetReal}`,
    };
  }
  if (!Number.isInteger(options.expectedInode) || options.expectedInode < 0) {
    return {
      kind: "error",
      code: "IO",
      message: "expectedInode must be a non-negative integer",
    };
  }
  if (typeof options.expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(options.expectedHash)) {
    return {
      kind: "error",
      code: "IO",
      message: "expectedHash must be 64 hex chars (sha256 folder hash)",
    };
  }
  let actualHash: string;
  try {
    actualHash = await computeSkillFolderHash(targetReal);
  } catch (error) {
    return {
      kind: "error",
      code: "TARGET_INVALID",
      message: `target content hash unreadable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (targetSt.ino !== options.expectedInode || actualHash !== options.expectedHash.toLowerCase()) {
    // 单码双触发（裁决 #1）：身份不符 = reason:"identity-mismatch"，零 state 变更
    return {
      kind: "error",
      code: "CLAIM_CONFLICT",
      reason: "identity-mismatch",
      message: `claim identity guard failed: expected inode ${options.expectedInode}/hash ${options.expectedHash.toLowerCase().slice(0, 12)}, found inode ${targetSt.ino}/hash ${actualHash.slice(0, 12)}; no state change occurred`,
    };
  }

  // ---- state 解析（实体命中 + 名字冲突判定）----
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

  let entityRecord: EntityRecord | undefined;
  for (const record of entities.values()) {
    if (resolve(record.path) === resolve(targetReal) || record.path === targetReal) {
      entityRecord = record;
      break;
    }
    const recordReal = realpathSafe(record.path);
    if (recordReal !== null && recordReal === targetReal) {
      entityRecord = record;
      break;
    }
  }
  if (entityRecord === undefined) {
    return {
      kind: "error",
      code: "ENTITY_NOT_FOUND",
      message: `link target ${targetReal} is not a recorded ccski entity in ${scope} scope; adoption of non-entity targets belongs to migrate`,
    };
  }

  const rootPath = resolve(linkPath, "..");
  const rootId = projectionRootId(rootPath);
  const folderName = entityRecord.folderName;

  // 名字冲突触发类（裁决 #1）：链接名必须与实体 folderName 一致（ccski 投影恒为
  // <root>/<folderName>），否则投影键/发现层身份分裂
  if (linkPath !== resolve(rootPath, folderName)) {
    return {
      kind: "error",
      code: "CLAIM_CONFLICT",
      reason: "name-conflict",
      message: `claim name conflict: link is named "${linkPath.slice(linkPath.lastIndexOf("/") + 1)}" but entity "${entityRecord.logicalName}" projects as "${folderName}"; rename the link or migrate instead`,
    };
  }

  const recordKey = projectionRecordKey(rootId, folderName);
  const existing = projections.get(recordKey);
  if (existing !== undefined) {
    // 已注册：幂等 unchanged（claim 不改写既有记账；stale/disabled 语义属 toggle/update 面）
    return {
      kind: "ok",
      status: "unchanged",
      entity: toSnapshot(entityRecord),
      projection: {
        rootId,
        rootPath,
        path: linkPath,
        mode: "link",
        entityRevision: existing.entityRevision,
      },
      verified: { inode: targetSt.ino, contentHash: actualHash },
      generation: base.generation,
      warnings: [
        `projection record already registered at this root (mode ${existing.mode}, disabled=${existing.disabled}); claim left it untouched`,
      ],
    };
  }

  // ---- 只动 state：单条投影记录 CAS 写入（文件系统零变化）----
  const now = new Date().toISOString();
  const commit = await commitTransform(store, (tables) => {
    const freshEntity = [...tables.entities.values()].find(
      (record) => record.folderName === folderName
    );
    if (freshEntity === undefined) {
      return {
        kind: "reject" as const,
        code: "ENTITY_NOT_FOUND",
        message: `entity "${entityRecord.logicalName}" disappeared concurrently; nothing claimed`,
      };
    }
    if (tables.projections.has(recordKey)) {
      return {
        kind: "reject" as const,
        code: "CLAIM_CONFLICT",
        message: `a projection record for "${folderName}" appeared concurrently; claim aborted without change`,
      };
    }
    tables.projections.set(recordKey, {
      kind: "projection",
      scope,
      rootId,
      rootPath,
      folderName,
      logicalName: freshEntity.logicalName,
      path: linkPath,
      mode: "link",
      entityRevision: freshEntity.revision,
      disabled: false,
      ownership: "ccski",
      createdAt: now,
      updatedAt: now,
    });
    return { kind: "apply" };
  });

  if (commit.kind === "committed") {
    return {
      kind: "ok",
      status: "claimed",
      entity: toSnapshot(entityRecord),
      projection: {
        rootId,
        rootPath,
        path: linkPath,
        mode: "link",
        entityRevision: entityRecord.revision,
      },
      verified: { inode: targetSt.ino, contentHash: actualHash },
      generation: commit.generation,
      warnings: [],
    };
  }
  if (commit.kind === "rejected") {
    const isNameConflict = commit.code === "CLAIM_CONFLICT";
    return {
      kind: "error",
      code: commit.code as ClaimFailureCode,
      ...(isNameConflict ? { reason: "name-conflict" as const } : {}),
      message: commit.message,
    };
  }
  return {
    kind: "error",
    code:
      commit.kind === "recovery-required" ? "STATE_RECOVERY_REQUIRED" : "STATE_GENERATION_CONFLICT",
    message:
      commit.kind === "recovery-required"
        ? `claim did not commit: state degraded read-only (${commit.detail})`
        : "claim did not commit: state CAS exhausted generation retries; no state change occurred",
  };
}

/** claim 的 dry-run 观察（供 CLI 生成 --inode/--hash 守卫值；纯读零写入） */
export async function observeClaimTarget(link: string): Promise<
  | {
      kind: "ok";
      link: string;
      target: string;
      inode: number;
      contentHash: string;
    }
  | {
      kind: "error";
      code: "LINK_NOT_FOUND" | "LINK_NOT_SYMLINK" | "TARGET_INVALID";
      message: string;
    }
> {
  const linkPath = resolve(link);
  const linkSt = lstatSafe(linkPath);
  if (linkSt === null) {
    return { kind: "error", code: "LINK_NOT_FOUND", message: `link not found: ${linkPath}` };
  }
  if (!linkSt.isSymbolicLink()) {
    return {
      kind: "error",
      code: "LINK_NOT_SYMLINK",
      message: `claim adopts symlinks only; the path is not a symbolic link: ${linkPath}`,
    };
  }
  const targetReal = realpathSafe(linkPath);
  if (targetReal === null) {
    return { kind: "error", code: "TARGET_INVALID", message: `link target is broken: ${linkPath}` };
  }
  const targetSt = lstatSync(targetReal);
  if (!targetSt.isDirectory()) {
    return {
      kind: "error",
      code: "TARGET_INVALID",
      message: `link target is not a directory: ${targetReal}`,
    };
  }
  try {
    const contentHash = await computeSkillFolderHash(targetReal);
    return { kind: "ok", link: linkPath, target: targetReal, inode: targetSt.ino, contentHash };
  } catch (error) {
    return {
      kind: "error",
      code: "TARGET_INVALID",
      message: `target content hash unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
