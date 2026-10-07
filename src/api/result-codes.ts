/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「P0-5 词表机械闭合：公共面 error/result code 全集收进
 * 一个导出的 frozen union/常量表；机械对账测试断言 union 值集 == CHANGELOG 列出的
 * 集合 == 各 API 返回类型的成员」
 * 正交意图：
 *   [1] 公共词表单源：PUBLIC_RESULT_CODES（frozen、排序、去重）+ ResultCode 类型——
 *       spec「closed vocabulary」声明处与 CHANGELOG「Typed failure vocabulary」
 *       码表的唯一重生成源
 *   [2] 编译期闭合（tsc --noEmit 门）：各 API result/error union ⊆ ResultCode，且
 *       ResultCode ⊆ (各 API union ∪ CLI 收据码 ∪ STALE_PROJECTION 报告标注)——
 *       任何一侧漂移立即 tsc 报错（tests/result-codes.test.ts 做运行时对账）
 * 妥协声明：STALE_PROJECTION 是 list 报告标注（非 kind:"error" union 成员）但属于
 * spec 冻结词表；CLI 收据码（AGENT_UNKNOWN/TARGET_SET_REQUIRED/NO_PROJECTIONS/
 * NO_GLOBAL_INSTALL/SOURCE_UNSUPPORTED）是 CLI 命令面的 typed 收据字面量，与内核
 * API union 共同构成公共词表，均收录进表。discovery/plugin 的 kebab-case 诊断标签
 * 属诊断命名空间（getDiagnostics/omissions），不在本词表。
 */
import type { ClaimFailureCode } from "./claim.js";
import type {
  DeleteEntityFailureCode,
  EntityRemoveFailureCode,
  EntityRemoveRootCode,
} from "./entity-remove.js";
import type { EntityToggleFailureCode } from "./entity-toggle.js";
import type {
  EnsureEntityFailureCode,
  ProjectEntityTopErrorCode,
  ProjectRootFailureCode,
} from "./entity.js";
import type { EntityUpdateFailureCode, EntityUpdateItemCode } from "./entity-update.js";
import type { GcFailureCode } from "./gc.js";
import type { MigrateConflictCode, MigrateFailureCode } from "./migrate.js";
import type { RepairDiffCode, RepairFailureCode } from "./repair.js";

export const PUBLIC_RESULT_CODES = Object.freeze([
  "AGENT_UNKNOWN",
  "CLAIM_CONFLICT",
  "COPY_FAILED",
  "DELETE_FAILED",
  "DRY_RUN_REQUIRED",
  "ENTITY_DIR_MISSING",
  "ENTITY_MISSING",
  "ENTITY_NOT_FOUND",
  "ENTITY_PATH_OCCUPIED",
  "ENTITY_RECORD_DANGLING",
  "ENTITY_REVISED",
  "ENTITY_SWAP_FAILED",
  "FOREIGN_OWNERSHIP",
  "GC_UNKNOWN_REFERENCE",
  "GUARD_ENTITY",
  "GUARD_PROJECTION",
  "HASH_MISMATCH",
  "INVALID_MODE",
  "INVALID_ROOT",
  "INVALID_ROOTS",
  "IO",
  "LEGACY_DIR_NEEDS_MIGRATE",
  "LINK_NOT_FOUND",
  "LINK_NOT_SYMLINK",
  "LOCK_VERSION_UNSUPPORTED",
  "MODE_CONFLICT",
  "NAME_COLLISION",
  "NAME_EXISTS",
  "NOT_FOUND",
  "NO_GLOBAL_INSTALL",
  "NO_PROJECTIONS",
  "PATH_OCCUPIED",
  "PINNED",
  "PROJECTIONS_REMAIN",
  "PROJECTION_DISABLED",
  "PROJECTION_FAILED",
  "PROJECTION_NOT_FOUND",
  "PROJECTION_PATH_OCCUPIED",
  "PROJECTION_RECORD_ORPHANED",
  "REPAIR_CONFIRM_REQUIRED",
  "RESIDUE_MARKER",
  "RESIDUE_UNMARKED",
  "ROOT_NOT_DIRECTORY",
  "ROOT_SYMLINK",
  "ROOT_VANISHED",
  "SCOPE_REQUIRED",
  "SOURCE_INVALID",
  "SOURCE_NAME_MISMATCH",
  "SOURCE_NOT_DIRECTORY",
  "SOURCE_NOT_FOUND",
  "SOURCE_SYMLINK",
  "SOURCE_UNSUPPORTED",
  "STALE_PROJECTION",
  "STATE_GENERATION_CONFLICT",
  "STATE_RECOVERY_REQUIRED",
  "SYMLINK_FAILED",
  "TARGET_DENIED",
  "TARGET_INVALID",
  "TARGET_SET_REQUIRED",
  "UNREGISTERED_LINK_CLAIMABLE",
] as const);

/** 公共词表类型（frozen 常量表的成员 union；spec「closed vocabulary」声明处） */
export type ResultCode = (typeof PUBLIC_RESULT_CODES)[number];

/** 内核 API 面 result/error union 全集（RepairResult/LockReadResult 的内联字面量并入） */
type ApiResultCode =
  | EnsureEntityFailureCode
  | ProjectRootFailureCode
  | ProjectEntityTopErrorCode
  | EntityUpdateFailureCode
  | EntityUpdateItemCode
  | EntityToggleFailureCode
  | EntityRemoveFailureCode
  | EntityRemoveRootCode
  | DeleteEntityFailureCode
  | GcFailureCode
  | MigrateFailureCode
  | MigrateConflictCode
  | RepairFailureCode
  | RepairDiffCode
  | "REPAIR_CONFIRM_REQUIRED"
  | ClaimFailureCode
  | "LOCK_VERSION_UNSUPPORTED";

/** CLI 收据面 code 字面量（install/toggle receipts + AgentTargetError） */
type CliReceiptCode =
  | "AGENT_UNKNOWN"
  | "TARGET_SET_REQUIRED"
  | "NO_PROJECTIONS"
  | "NO_GLOBAL_INSTALL"
  | "SOURCE_UNSUPPORTED";

type AssertTrue<T extends true> = T;

/** 每个 API union 成员都进了公共词表 */
type _ApiSubsetOfTable = AssertTrue<ApiResultCode extends ResultCode ? true : false>;
/** 词表每个成员都可归属到 API union / CLI 收据码 / STALE_PROJECTION 报告标注 */
type _TableClosedOverApi = AssertTrue<
  ResultCode extends ApiResultCode | CliReceiptCode | "STALE_PROJECTION" ? true : false
>;

/** 编译期闭合收据（两字段仅在两侧都闭合时才为 true；漂移 = tsc 报错） */
export interface ResultCodeClosureReceipt {
  apiSubsetOfTable: _ApiSubsetOfTable;
  tableClosedOverApi: _TableClosedOverApi;
}
