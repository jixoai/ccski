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
  source: string;
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
