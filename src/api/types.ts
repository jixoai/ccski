import type { SkillMetadata } from "../types/skill.js";
import type { RegistryInput } from "../utils/registry-options.js";

export interface FilterOptions {
  include?: string[];
  exclude?: string[];
  all?: boolean;
  disabled?: boolean;
}

export interface ListOptions extends RegistryInput, FilterOptions {}

export interface InfoOptions extends RegistryInput, FilterOptions {
  name: string;
  full?: boolean;
}

export interface SearchOptions extends RegistryInput, FilterOptions {
  query: string;
  content?: boolean;
  limit?: number;
}

export interface ValidateOptions extends RegistryInput, FilterOptions {
  path: string;
}

export interface ToggleOptions extends RegistryInput, FilterOptions {
  names?: string[];
  force?: boolean;
  override?: boolean;
  interactive?: boolean;
  yes?: boolean;
}

export interface InstallOptions {
  source?: string;
  skills?: string[];
  force?: boolean;
  override?: boolean;
  path?: string;
  mode?: "git" | "file";
  branch?: string;
  interactive?: boolean;
  all?: boolean;
  disabled?: boolean;
  include?: string[];
  exclude?: string[];
  outDir?: string[];
  outScope?: string[];
  userDir?: string;
  dryRun?: boolean;
  timeout?: number;
  yes?: boolean;
}

export type AgentInstructionScope = "user" | "project";

export interface AgentInstructionTarget {
  id: string;
  label: string;
  aliases: readonly string[];
  userPath: readonly string[];
  projectPath: readonly string[];
}

export interface WorkflowInstallOptions {
  agents?: string[];
  scope?: AgentInstructionScope;
  userDir?: string;
  projectDir?: string;
  dryRun?: boolean;
}

export interface WorkflowInstallResultEntry {
  agent: string;
  label: string;
  scope: AgentInstructionScope;
  path: string;
  status: "installed" | "updated" | "unchanged" | "failed";
  error?: string;
}

export interface WorkflowInstallResult {
  scope: AgentInstructionScope;
  dryRun: boolean;
  results: WorkflowInstallResultEntry[];
  installed: number;
  updated: number;
  unchanged: number;
  failed: number;
}

export interface SkillInfoResult {
  name: string;
  description: string;
  provider: SkillMetadata["provider"];
  location: SkillMetadata["location"];
  path: string;
  size: number;
  disabled: boolean;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo: SkillMetadata["pluginInfo"] | null;
  content: string;
}

export interface SearchResultItem {
  name: string;
  description: string;
  location: SkillMetadata["location"];
  provider: SkillMetadata["provider"];
  disabled: boolean;
  path: string;
}

export interface ValidateResult {
  file: string;
  success: boolean;
  errors: string[];
  warnings: string[];
}

export interface InstallResultEntry {
  skill: string;
  destination: string;
  path: string;
  status: "installed" | "skipped" | "overwritten" | "failed";
  error?: string;
}

export interface InstallSummary {
  results: InstallResultEntry[];
  installed: number;
  skipped: number;
  overwritten: number;
  failed: number;
}

export interface InstallPreview {
  dryRun: true;
  skills: Array<{ name: string; description: string }>;
  destinations: Array<{ path: string; exists: boolean }>;
  totalInstalls: number;
}

export type InstallResult = InstallSummary | InstallPreview;

export interface ToggleResultEntry {
  skill: string;
  path: string;
  status: "enabled" | "disabled" | "skipped" | "failed";
  error?: string;
}

export interface ToggleSummary {
  mode: "enable" | "disable";
  results: ToggleResultEntry[];
  succeeded: number;
  skipped: number;
  failed: number;
}

/** Why a removal item was skipped (finite vocabulary; clients never parse strings). */
export type RemoveSkipReason = "NOT_FOUND";

/** Why a removal item failed (finite vocabulary; clients never parse strings). */
export type RemoveFailureCode =
  | "INVALID_NAME"
  | "PATH_ESCAPE"
  | "NOT_DIRECTORY"
  | "NOT_A_SKILL"
  | "SYMLINK_TARGET"
  | "GUARD_INVALID"
  | "GUARD_MISMATCH"
  | "GUARD_UNREADABLE"
  | "DELETE_FAILED";

/** Guarded removal request: a name plus optional check-then-delete swap guards. */
export interface RemoveSkillRequest {
  name: string;
  /** Expected sha256 hex of the active identity file (SKILL.md, else .SKILL.md). */
  expectedContentHash?: string;
  /** Expected inode of the skill directory from a prior lstat. */
  expectedInode?: number;
}

export interface RemoveResultEntry {
  skill: string;
  path: string;
  status: "removed" | "skipped" | "failed";
  reason?: RemoveSkipReason;
  errorCode?: RemoveFailureCode;
  error?: string;
}

export interface RemoveSummary {
  results: RemoveResultEntry[];
  removed: number;
  skipped: number;
  failed: number;
}

export interface RemovePreview {
  dryRun: true;
  skills: Array<{ name: string; path: string; exists: boolean }>;
  totalRemovals: number;
}

export type RemoveResult = RemoveSummary | RemovePreview;

export interface RemoveOptions {
  /** Already-resolved target root (host-guarded); must be a real directory. */
  targetRoot: string;
  /** Explicit names or guarded requests. Required unless `all` or `interactive`. */
  requests?: Array<string | RemoveSkillRequest>;
  /** Remove every discovered direct-child skill directory. */
  all?: boolean;
  interactive?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}
