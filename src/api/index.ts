/**
 * API 导出面（store-link-kernel 批 5 收口）：
 * - 保留面（对齐面，随发现层增量字段自然增强）：listSkills / getSkillInfo /
 *   validateSkill / searchSkills
 * - 内核面（批 3/4）：ensureEntity / projectEntity / removeEntityProjections /
 *   deleteEntity / toggleEntityProjection / updateEntity
 * - 批 5 命令面：migrateLegacyEntries / gcPropose / repairState / claimLink
 * - 2.x mutation 入口（installSkills / installSkillDir / removeSkills / toggleSkills）
 *   按 3.0 裁决移除，不造兼容胶层（§8）；其语义由内核面 + CLI 命令承载
 */
export {
  claimLink,
  observeClaimTarget,
  type ClaimConflictReason,
  type ClaimFailureCode,
  type ClaimResult,
} from "./claim.js";
export {
  deleteEntity,
  removeEntityProjections,
  type DeleteEntityFailureCode,
  type DeleteEntityOptions,
  type DeleteEntityResult,
  type EntityRemoveFailureCode,
  type EntityRemoveGcReport,
  type EntityRemoveOptions,
  type EntityRemoveResult,
  type EntityRemoveRootCode,
  type EntityRemoveRootResult,
} from "./entity-remove.js";
export {
  toggleEntityProjection,
  type EntityToggleAction,
  type EntityToggleFailureCode,
  type EntityToggleOptions,
  type EntityToggleResult,
  type EntityToggleStatus,
} from "./entity-toggle.js";
export {
  updateEntity,
  type EntityUpdateFailureCode,
  type EntityUpdateItemCode,
  type EntityUpdateItemStatus,
  type EntityUpdateOptions,
  type EntityUpdateProjectionResult,
  type EntityUpdateResult,
} from "./entity-update.js";
export {
  ensureEntity,
  projectEntity,
  stageEntityCopy,
  swapEntityIntoPlace,
  type EnsureEntityExisting,
  type EnsureEntityFailureCode,
  type EnsureEntityOptions,
  type EnsureEntityResult,
  type EntitySnapshot,
  type EntitySourceInput,
  type EntitySwapOutcome,
  type ProjectEntityCommon,
  type ProjectEntityOptions,
  type ProjectEntityResult,
  type ProjectEntityTopErrorCode,
  type ProjectRootFailureCode,
  type ProjectRootResult,
  type ProjectRootStatus,
} from "./entity.js";
export {
  gcPropose,
  type GcFailureCode,
  type GcProposal,
  type GcResult,
  type GcUnknownReference,
} from "./gc.js";
export { getSkillInfo } from "./info.js";
export { listSkills } from "./list.js";
export { startMCPServer } from "./mcp.js";
export type { MCPServerOptions } from "./mcp.js";
export {
  migrateLegacyEntries,
  type MigrateAdopted,
  type MigrateCandidatePlan,
  type MigrateConflict,
  type MigrateConflictCode,
  type MigrateConverted,
  type MigrateFailureCode,
  type MigratePlan,
  type MigrateResult,
} from "./migrate.js";
export {
  repairState,
  type RepairAction,
  type RepairDiffCode,
  type RepairDiffItem,
  type RepairFailureCode,
  type RepairResult,
} from "./repair.js";
export { searchSkills, searchSkillsDetailed } from "./search.js";
export type {
  AgentInstructionScope,
  AgentInstructionTarget,
  FilterOptions,
  InfoOptions,
  ListOptions,
  SearchOptions,
  SearchResultItem,
  SkillInfoResult,
  ValidateOptions,
  ValidateResult,
  WorkflowInstallOptions,
  WorkflowInstallResult,
  WorkflowInstallResultEntry,
} from "./types.js";
export { validateSkill } from "./validate.js";
export {
  AGENT_INSTRUCTION_TARGETS,
  getCcskiWorkflowBlock,
  installCcskiWorkflow,
  listAgentInstructionTargets,
  resolveAgentInstructionTarget,
} from "./workflow-install.js";
