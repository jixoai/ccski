/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「toggle 内核化：link disable = 校验 ownership → unlink +
 * state disabled（物理禁用）；enable = state 的 entityRevision 校验（不符 →
 * ENTITY_REVISED）→ 重建链；物化保留 .SKILL.md rename + 结果标注
 * convention:"ccski-legacy"；link 模式禁止制造第二身份文件（typed 拒绝）」（E3）
 * 正交意图：
 *   [1] link 物理禁用（spec: Physical disable semantics）：disable = ownership 校验
 *       → unlink（绝不穿链递归）→ state disabled；磁盘事实恒先于 sidecar 布尔；
 *       共享实体的 SKILL.md 永不换名——link 面任何会写出 .SKILL.md 的形态都是换体
 *       （实目录/异向链占据投影路径），typed GUARD_PROJECTION 拒绝路径不动
 *   [2] link 重建（ENTITY_REVISED 闸）：enable 先校验记录 entityRevision === 当前实体
 *       revision（不符 → ENTITY_REVISED，投影保持 disabled，提示 update），再重建
 *       symlink；物化副本 enable 不做实体 revision 校验（副本合法滞后，R9）
 *   [3] 物化 ccski-legacy 约定（E3）：disable/enable 走 .SKILL.md rename，结果标注
 *       convention:"ccski-legacy"（实证非 npm 语义）；换名后刷新 copyHash guard 基准
 *   [4] canonical root 不参与投影 toggle（G3 裁决）：entity-local skipped 收据
 * 妥协声明：外部 live-link（无记录且目标非实体）typed FOREIGN_OWNERSHIP 只读；无记录
 * 的同目标链 = 未注册引用（adoption 归批 5 claim）、实目录 = 未注册条目（归批 5
 * migrate），PROJECTION_NOT_FOUND 拒绝。生产代码零测试钩子；磁盘 mutation 先行、
 * state CAS 随后，提交失败诚实上报并给出重跑对账入口。
 */
import { existsSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import {
  entityRootFor,
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
import { lstatSafe, materializedCopyGuard, symlinkTargetsEntity } from "./entity-guards.js";
import {
  commitTransform,
  isCanonicalEntityRoot,
  toSnapshot,
  type EntitySnapshot,
} from "./entity.js";

export type EntityToggleAction = "enable" | "disable";

export interface EntityToggleOptions {
  /** 显式 scope（缺省/非法 = SCOPE_REQUIRED） */
  scope?: EntityScope;
  /** 实体逻辑名（frontmatter name；经 state 实体记录解析） */
  name: string;
  /** 显式单一投影根（SDK 永不环境推断；多根由调用方循环） */
  root: string;
  action: EntityToggleAction;
  /** global scopeBase 解析（默认 homedir；测试/宿主注入） */
  userDir?: string;
  /** project scopeBase 解析（默认 process.cwd()；测试/宿主注入） */
  workspaceDir?: string;
}

export type EntityToggleFailureCode =
  | "SCOPE_REQUIRED"
  | "INVALID_ROOT"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_MISSING"
  | "PROJECTION_NOT_FOUND"
  | "ENTITY_REVISED"
  | "FOREIGN_OWNERSHIP"
  | "GUARD_PROJECTION"
  | "TARGET_DENIED"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

export type EntityToggleStatus = "toggled" | "unchanged" | "skipped";

export type EntityToggleResult =
  | {
      kind: "ok";
      action: EntityToggleAction;
      status: EntityToggleStatus;
      /** 规范化形态（entity-local 收据 = "entity-local"） */
      mode: "link" | "materialized" | "entity-local";
      /** 投影路径；entity-local 收据 = 实体路径 */
      path: string;
      /** state 终态 disabled 标注（entity-local 收据恒 false——实体无禁用语义） */
      disabled: boolean;
      /** E3：物化 .SKILL.md rename 约定标注（非 npm 语义） */
      convention?: "ccski-legacy";
      /** entity-local 收据标注（G3 第四形态） */
      targetKind?: "entity";
      reason?: "canonical-root";
      detail?: string;
      generation: number;
      warnings: string[];
    }
  | { kind: "error"; code: EntityToggleFailureCode; message: string };

function isoNow(): string {
  return new Date().toISOString();
}

function unchangedReceipt(
  action: EntityToggleAction,
  mode: "link" | "materialized",
  path: string,
  disabled: boolean,
  generation: number,
  detail: string,
  convention?: "ccski-legacy"
): EntityToggleResult {
  return {
    kind: "ok",
    action,
    status: "unchanged",
    mode,
    path,
    disabled,
    ...(convention !== undefined ? { convention } : {}),
    detail,
    generation,
    warnings: [],
  };
}

/**
 * toggleEntityProjection：单根投影启停内核（E3）。link = 摘链/重建的物理语义；
 * materialized = .SKILL.md rename 的 ccski-legacy 约定；canonical root = entity-local
 * skipped 收据。磁盘 mutation 先行，state CAS 随后（失败诚实上报重跑入口）。
 */
export async function toggleEntityProjection(
  options: EntityToggleOptions
): Promise<EntityToggleResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'toggleEntityProjection requires an explicit scope: "global" | "project".',
    };
  }
  if (typeof options.root !== "string" || options.root.length === 0) {
    return {
      kind: "error",
      code: "INVALID_ROOT",
      message: "toggleEntityProjection requires an explicit projection root",
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
  const entityTable = parseEntityTable(base.entities);
  let entityRecord: EntityRecord | undefined;
  for (const record of entityTable.records.values()) {
    if (record.logicalName === options.name) {
      entityRecord = record;
      break;
    }
  }
  if (entityRecord === undefined) {
    if (entityTable.invalidKeys.length > 0) {
      return {
        kind: "error",
        code: "STATE_RECOVERY_REQUIRED",
        message: `entity table degraded (${entityTable.invalidKeys.length} invalid record(s)); cannot prove logical name "${options.name}" is unregistered; run ccski state repair`,
      };
    }
    return {
      kind: "error",
      code: "ENTITY_NOT_FOUND",
      message: `no ccski entity record for logical name "${options.name}" in ${scope} scope`,
    };
  }

  const rootPath = resolve(options.root);
  const entityPath = entityRecord.path;

  // G3 第四形态：canonical root 不参与投影 toggle（实体恒 enabled 形态）
  if (isCanonicalEntityRoot(rootPath, entityRoot)) {
    return {
      kind: "ok",
      action: options.action,
      status: "skipped",
      mode: "entity-local",
      path: entityPath,
      disabled: false,
      targetKind: "entity",
      reason: "canonical-root",
      detail:
        "canonical entity root does not participate in projection toggle; the entity itself has no disabled form",
      generation: base.generation,
      warnings: [],
    };
  }

  const recordKey = projectionRecordKey(projectionRootId(rootPath), entityRecord.folderName);
  const projPath = resolve(rootPath, entityRecord.folderName);
  const projection = parseProjectionTable(base.projections).records.get(recordKey);
  if (projection === undefined) {
    // 无记录：external live-link typed 只读；同目标未注册链/未注册条目如实区分
    let st: ReturnType<typeof lstatSafe>;
    try {
      st = lstatSafe(projPath);
    } catch (error) {
      // P1-E：无法观察 ≠ 缺席——typed 拒绝（不落入「nothing to toggle」误判）
      return {
        kind: "error",
        code: "IO",
        message: `failed to inspect the projection path ${projPath} (${error instanceof Error ? error.message : String(error)})`,
      };
    }
    if (st?.isSymbolicLink() && !symlinkTargetsEntity(projPath, entityPath)) {
      return {
        kind: "error",
        code: "FOREIGN_OWNERSHIP",
        message: `the entry at ${projPath} is an external live-link (target is not a ccski-owned entity); external links are read-only`,
      };
    }
    return {
      kind: "error",
      code: "PROJECTION_NOT_FOUND",
      message: `no ccski projection record for "${entityRecord.folderName}" at root ${rootPath}${
        st !== null
          ? st.isSymbolicLink()
            ? "; an unregistered link to this entity exists here (adoption belongs to import --claim, batch 5)"
            : "; an unregistered directory entry occupies the path (adoption belongs to migrate, batch 5)"
          : "; nothing to toggle"
      }`,
    };
  }

  if (projection.mode === "link") {
    return toggleLink({
      options,
      projection,
      recordKey,
      projPath,
      entityPath,
      baseGeneration: base.generation,
      store,
    });
  }
  return toggleMaterialized({
    options,
    projection,
    recordKey,
    projPath,
    entityPath,
    baseGeneration: base.generation,
    store,
  });
}

interface ToggleArgs {
  options: EntityToggleOptions;
  projection: {
    disabled: boolean;
    entityRevision: string;
    mode: "link" | "materialized";
    copyHash?: string | undefined;
    copyIno?: number | undefined;
  };
  recordKey: string;
  projPath: string;
  /** 实体路径（link 面归属判定的比对基准） */
  entityPath: string;
  baseGeneration: number;
  store: StateStore;
}

/** link 面启停（E3）：disable = ownership 校验 + unlink；enable = ENTITY_REVISED 闸 + 重建链 */
async function toggleLink(args: ToggleArgs): Promise<EntityToggleResult> {
  const { options, projection, recordKey, projPath, entityPath, baseGeneration, store } = args;
  let st: ReturnType<typeof lstatSafe>;
  try {
    st = lstatSafe(projPath);
  } catch (error) {
    return {
      kind: "error",
      code: "IO",
      message: `failed to inspect the link projection path ${projPath} (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  if (options.action === "disable") {
    // 磁盘形态守卫：非「symlink 且指向本实体」的形态 = 换体——link 面绝不写
    // .SKILL.md、绝不穿链递归，typed 拒绝路径不动。
    if (st !== null && !(st.isSymbolicLink() && symlinkTargetsEntity(projPath, entityPath))) {
      return {
        kind: "error",
        code: "GUARD_PROJECTION",
        message: `the recorded link projection path ${projPath} is now ${
          st.isSymbolicLink()
            ? "a symlink to a different target"
            : st.isDirectory()
              ? "a real directory"
              : "a non-directory entry"
        }; refusing to treat it as a ccski link projection (path untouched; second identity files are never created through links)`,
      };
    }
    if (projection.disabled && st === null) {
      return unchangedReceipt(
        "disable",
        "link",
        projPath,
        true,
        baseGeneration,
        "projection is already physically disabled (no link on disk, state disabled)"
      );
    }
    if (st !== null) {
      // ownership 已验证（symlink 指向本实体）：unlink 只摘链
      try {
        unlinkSync(projPath);
      } catch (error) {
        return toggleFsError(
          error,
          `projection root denied unlink`,
          `failed to unlink link projection ${projPath}`
        );
      }
    }
    const commit = await commitTransform(store, (tables) => {
      const record = tables.projections.get(recordKey);
      if (record === undefined) {
        return {
          kind: "reject",
          code: "PROJECTION_NOT_FOUND",
          message: `projection record ${recordKey} vanished concurrently`,
        };
      }
      tables.projections.set(recordKey, { ...record, disabled: true, updatedAt: isoNow() });
      return { kind: "apply" };
    });
    if (commit.kind === "committed") {
      return {
        kind: "ok",
        action: "disable",
        status: "toggled",
        mode: "link",
        path: projPath,
        disabled: true,
        detail:
          st === null
            ? "link was already absent; state now records the physical disable"
            : "link unlinked (physical disable); other roots' projections unaffected",
        generation: commit.generation,
        warnings: [],
      };
    }
    return toggleStateError(
      commit,
      `the link at ${projPath} was removed on disk but state was not updated`
    );
  }

  // enable：先 ENTITY_REVISED 闸（记录 revision vs 当前实体 revision），再重建链
  let entitySt: ReturnType<typeof lstatSafe>;
  try {
    entitySt = lstatSafe(entityPath);
  } catch (error) {
    return {
      kind: "error",
      code: "IO",
      message: `failed to inspect the entity directory ${entityPath} (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (entitySt === null || entitySt.isSymbolicLink() || !entitySt.isDirectory()) {
    return {
      kind: "error",
      code: "ENTITY_MISSING",
      message: `recorded entity directory is missing or invalid at ${entityPath}; update or reinstall the entity first`,
    };
  }
  const currentRevision = await hashDirectory(entityPath);
  if (currentRevision === null) {
    return { kind: "error", code: "IO", message: `failed to hash entity at ${entityPath}` };
  }
  if (projection.entityRevision !== currentRevision) {
    return {
      kind: "error",
      code: "ENTITY_REVISED",
      message: `recorded entity revision ${projection.entityRevision.slice(0, 12)} no longer matches the entity (${currentRevision.slice(
        0,
        12
      )}); run update to converge — the projection remains disabled`,
    };
  }
  if (st !== null && !(st.isSymbolicLink() && symlinkTargetsEntity(projPath, entityPath))) {
    return {
      kind: "error",
      code: "GUARD_PROJECTION",
      message: `the projection path ${projPath} is occupied by ${
        st.isSymbolicLink()
          ? "a foreign symlink"
          : st.isDirectory()
            ? "a real directory"
            : "a non-directory entry"
      }; refusing to enable over it`,
    };
  }
  if (st === null) {
    try {
      symlinkSync(entityPath, projPath);
    } catch (error) {
      return toggleFsError(
        error,
        "projection root denied symlink creation",
        `failed to recreate link projection ${projPath}`
      );
    }
  }
  const commit = await commitTransform(store, (tables) => {
    const record = tables.projections.get(recordKey);
    if (record === undefined) {
      return {
        kind: "reject",
        code: "PROJECTION_NOT_FOUND",
        message: `projection record ${recordKey} vanished concurrently`,
      };
    }
    tables.projections.set(recordKey, {
      ...record,
      disabled: false,
      entityRevision: currentRevision,
      stale: undefined,
      updatedAt: isoNow(),
    });
    return { kind: "apply" };
  });
  if (commit.kind === "committed") {
    return {
      kind: "ok",
      action: "enable",
      status: "toggled",
      mode: "link",
      path: projPath,
      disabled: false,
      detail:
        st === null
          ? "link recreated after the entity revision check"
          : "link already present and pointing at the entity; state now records it enabled",
      generation: commit.generation,
      warnings: [],
    };
  }
  return toggleStateError(
    commit,
    `the link at ${projPath} was recreated on disk but state was not updated`
  );
}

/**
 * 物化面启停（E3 ccski-legacy 约定）：.SKILL.md rename + copyHash guard 刷新；
 * 不做实体 revision 校验（副本合法滞后）；守卫不符 = GUARD_PROJECTION 路径不动。
 */
async function toggleMaterialized(args: ToggleArgs): Promise<EntityToggleResult> {
  const { options, projection, recordKey, projPath, baseGeneration, store } = args;
  let st: ReturnType<typeof lstatSafe>;
  try {
    st = lstatSafe(projPath);
  } catch (error) {
    return {
      kind: "error",
      code: "IO",
      message: `failed to inspect the copy projection path ${projPath} (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  if (st !== null && (st.isSymbolicLink() || !st.isDirectory())) {
    return {
      kind: "error",
      code: "GUARD_PROJECTION",
      message: `the recorded materialized projection path ${projPath} is now ${
        st.isSymbolicLink() ? "a symlink" : "a non-directory entry"
      }; refusing to treat it as a ccski copy (path untouched)`,
    };
  }
  if (st === null) {
    return {
      kind: "error",
      code: "GUARD_PROJECTION",
      message: `the recorded materialized copy is absent at ${projPath}; re-materialize via update/projectEntity instead of toggling`,
    };
  }

  const guard = await materializedCopyGuard(projection, projPath, st);
  if (!guard.ok) {
    return {
      kind: "error",
      code: "GUARD_PROJECTION",
      message: `materialized copy guard mismatch at ${projPath} (expected ${guard.expected.slice(0, 12)}${
        guard.actual !== undefined ? `, on disk ${guard.actual.slice(0, 12)}` : ""
      }${guard.reason !== undefined ? `; ${guard.reason}` : ""}); the copy was replaced or modified externally — path untouched`,
    };
  }

  const enabledFile = resolve(projPath, "SKILL.md");
  const disabledFile = resolve(projPath, ".SKILL.md");
  const enabledExists = existsSync(enabledFile);
  const disabledExists = existsSync(disabledFile);

  if (options.action === "disable") {
    if (!enabledExists) {
      if (disabledExists && projection.disabled) {
        return unchangedReceipt(
          "disable",
          "materialized",
          projPath,
          true,
          baseGeneration,
          "copy is already in the disabled .SKILL.md form and state records it disabled",
          "ccski-legacy"
        );
      }
      return {
        kind: "error",
        code: "GUARD_PROJECTION",
        message: `the copy at ${projPath} carries no SKILL.md identity file; refusing to toggle (form not recorded by ccski)`,
      };
    }
    if (disabledExists) {
      return {
        kind: "error",
        code: "GUARD_PROJECTION",
        message: `the copy at ${projPath} carries both SKILL.md and .SKILL.md (second identity file); refusing to toggle`,
      };
    }
    try {
      renameSync(enabledFile, disabledFile);
    } catch (error) {
      return toggleFsError(
        error,
        "projection root denied the disable rename",
        `failed to rename SKILL.md to .SKILL.md at ${projPath}`
      );
    }
    const refreshedHash = await hashDirectory(projPath);
    const commit = await commitTransform(store, (tables) => {
      const record = tables.projections.get(recordKey);
      if (record === undefined) {
        return {
          kind: "reject",
          code: "PROJECTION_NOT_FOUND",
          message: `projection record ${recordKey} vanished concurrently`,
        };
      }
      tables.projections.set(recordKey, {
        ...record,
        disabled: true,
        ...(refreshedHash !== null ? { copyHash: refreshedHash } : {}),
        updatedAt: isoNow(),
      });
      return { kind: "apply" };
    });
    if (commit.kind === "committed") {
      return {
        kind: "ok",
        action: "disable",
        status: "toggled",
        mode: "materialized",
        path: projPath,
        disabled: true,
        convention: "ccski-legacy",
        detail:
          "SKILL.md renamed to .SKILL.md (ccski-legacy convention, not an npm:skills semantic); copyHash guard refreshed",
        generation: commit.generation,
        warnings: [],
      };
    }
    return toggleStateError(
      commit,
      `the copy at ${projPath} was disabled on disk but state was not updated`
    );
  }

  // enable：guard 已过 → 换回启用形态（无实体 revision 闸，副本合法滞后）
  if (!disabledExists) {
    if (enabledExists && !projection.disabled) {
      return unchangedReceipt(
        "enable",
        "materialized",
        projPath,
        false,
        baseGeneration,
        "copy is already in the enabled form and state records it enabled"
      );
    }
    return {
      kind: "error",
      code: "GUARD_PROJECTION",
      message: `the copy at ${projPath} carries no .SKILL.md to re-enable; refusing to toggle`,
    };
  }
  if (enabledExists) {
    return {
      kind: "error",
      code: "GUARD_PROJECTION",
      message: `the copy at ${projPath} carries both SKILL.md and .SKILL.md (second identity file); refusing to toggle`,
    };
  }
  try {
    renameSync(disabledFile, enabledFile);
  } catch (error) {
    return toggleFsError(
      error,
      "projection root denied the enable rename",
      `failed to rename .SKILL.md to SKILL.md at ${projPath}`
    );
  }
  const refreshedHash = await hashDirectory(projPath);
  const commit = await commitTransform(store, (tables) => {
    const record = tables.projections.get(recordKey);
    if (record === undefined) {
      return {
        kind: "reject",
        code: "PROJECTION_NOT_FOUND",
        message: `projection record ${recordKey} vanished concurrently`,
      };
    }
    tables.projections.set(recordKey, {
      ...record,
      disabled: false,
      ...(refreshedHash !== null ? { copyHash: refreshedHash } : {}),
      updatedAt: isoNow(),
    });
    return { kind: "apply" };
  });
  if (commit.kind === "committed") {
    return {
      kind: "ok",
      action: "enable",
      status: "toggled",
      mode: "materialized",
      path: projPath,
      disabled: false,
      convention: "ccski-legacy",
      detail:
        ".SKILL.md renamed back to SKILL.md (ccski-legacy convention); copyHash guard refreshed",
      generation: commit.generation,
      warnings: [],
    };
  }
  return toggleStateError(
    commit,
    `the copy at ${projPath} was enabled on disk but state was not updated`
  );
}

function toggleFsError(
  error: unknown,
  deniedLabel: string,
  fallbackLabel: string
): EntityToggleResult {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return {
      kind: "error",
      code: "TARGET_DENIED",
      message: `${deniedLabel} (${code}); ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    kind: "error",
    code: "IO",
    message: `${fallbackLabel}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function toggleStateError(
  commit: Exclude<Awaited<ReturnType<typeof commitTransform>>, { kind: "committed" }>,
  diskFact: string
): EntityToggleResult {
  const reconcile =
    commit.kind === "recovery-required"
      ? `state degraded read-only: ${commit.detail}`
      : commit.kind === "rejected"
        ? commit.message
        : "state commit exhausted generation retries";
  return {
    kind: "error",
    code:
      commit.kind === "recovery-required"
        ? "STATE_RECOVERY_REQUIRED"
        : commit.kind === "rejected"
          ? "IO"
          : "STATE_GENERATION_CONFLICT",
    message: `${diskFact} (${reconcile}); re-run the same toggle to reconcile records`,
  };
}

/** 实体/副本内容 hash（folder-hash 单源）；读取失败返回 null（调用方 typed 处理） */
async function hashDirectory(dir: string): Promise<string | null> {
  try {
    return await computeSkillFolderHash(dir);
  } catch {
    return null;
  }
}

// re-export 便于宿主单点导入（entity 家族同源类型）
export { toSnapshot, type EntityScope, type EntitySnapshot };
