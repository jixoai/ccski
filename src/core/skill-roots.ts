import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SkillLocation, SkillProvider, SkillSourceKind } from "../types/skill.js";
import { SKILL_SOURCE_PRIORITIES } from "../types/skill.js";
import { normalizeProviderName } from "../utils/providers.js";

const BUILT_IN_AGENT_PROVIDERS = ["claude", "codex", "gemini", "openclaw"] as const;
const RESERVED_HIDDEN_DIRS = new Set([
  ".agent",
  ".agents",
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ...BUILT_IN_AGENT_PROVIDERS.map((provider) => `.${provider}`),
]);

export interface SkillDirectoryEntry {
  path: string;
  provider: SkillProvider;
  location: SkillLocation;
  sourceKind: SkillSourceKind;
  sourcePriority: number;
  scope?: string;
}

function sourcePriority(sourceKind: SkillSourceKind): number {
  return SKILL_SOURCE_PRIORITIES[sourceKind];
}

function isAgentDirName(name: string): boolean {
  if (!name.startsWith(".") || name.length <= 1) return false;
  if (RESERVED_HIDDEN_DIRS.has(name)) return false;
  return /^\.[a-z][a-z0-9_-]*$/i.test(name);
}

function discoverDynamicAgentRoots(
  baseDir: string,
  location: SkillLocation,
  sourceKind: SkillSourceKind
): SkillDirectoryEntry[] {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && isAgentDirName(entry.name))
    .map((entry) => {
      const provider = normalizeProviderName(entry.name.slice(1));
      const skillsPath = join(baseDir, entry.name, "skills");
      return {
        path: skillsPath,
        provider,
        location,
        sourceKind,
        sourcePriority: sourcePriority(sourceKind),
      };
    })
    .filter((entry) => existsSync(entry.path))
    .sort((a, b) => String(a.provider).localeCompare(String(b.provider)));
}

function builtInAgentRoots(
  baseDir: string,
  location: SkillLocation,
  sourceKind: SkillSourceKind
): SkillDirectoryEntry[] {
  return BUILT_IN_AGENT_PROVIDERS.map((provider) => ({
    path: join(baseDir, `.${provider}`, "skills"),
    provider,
    location,
    sourceKind,
    sourcePriority: sourcePriority(sourceKind),
  }));
}

function sharedRoot(
  path: string,
  location: SkillLocation,
  sourceKind: SkillSourceKind
): SkillDirectoryEntry {
  return {
    path,
    provider: "agents",
    location,
    sourceKind,
    sourcePriority: sourcePriority(sourceKind),
  };
}

function legacySharedRoot(
  baseDir: string,
  location: SkillLocation,
  sourceKind: SkillSourceKind
): SkillDirectoryEntry[] {
  const path = join(baseDir, ".agent", "skills");
  if (!existsSync(path)) return [];
  return [sharedRoot(path, location, sourceKind)];
}

function uniqueByPath(entries: SkillDirectoryEntry[]): SkillDirectoryEntry[] {
  const seen = new Set<string>();
  const unique: SkillDirectoryEntry[] = [];
  for (const entry of entries) {
    const key = resolve(entry.path);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

export function getDefaultSkillDirectories(
  userDir: string,
  workspaceDir: string = process.cwd()
): SkillDirectoryEntry[] {
  const workspace = resolve(workspaceDir);
  const user = resolve(userDir);

  return uniqueByPath([
    ...builtInAgentRoots(workspace, "project", "workspace-agent"),
    ...discoverDynamicAgentRoots(workspace, "project", "workspace-agent"),
    sharedRoot(join(workspace, "skills"), "project", "workspace-root"),
    sharedRoot(join(workspace, ".agents", "skills"), "project", "workspace-shared"),
    ...legacySharedRoot(workspace, "project", "workspace-shared"),
    ...builtInAgentRoots(user, "user", "user-agent"),
    ...discoverDynamicAgentRoots(user, "user", "user-agent"),
    sharedRoot(join(user, ".agents", "skills"), "user", "user-shared"),
    ...legacySharedRoot(user, "user", "user-shared"),
  ]);
}
