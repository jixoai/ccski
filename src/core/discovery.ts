import type { Dirent } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Skill, SkillLocation, SkillMetadata } from "../types/skill.js";
import { colors } from "../utils/format.js";
import { parseSkillFile } from "./parser.js";

/**
 * Skill directories in priority order (highest to lowest)
 */
export const SKILL_DIRECTORIES = [
  ".agent/skills", // Project universal
  ".claude/skills", // Project Claude Code
  `${homedir()}/.agent/skills`, // Global universal
  `${homedir()}/.claude/skills`, // Global Claude Code
] as const;

export interface DiscoveryDiagnostics {
  scannedDirectories: string[];
  warnings: string[];
  conflicts: string[];
}

export interface DiscoveryResult {
  skills: SkillMetadata[];
  diagnostics: DiscoveryDiagnostics;
}

/**
 * Options for skill discovery
 */
export interface DiscoveryOptions {
  /** Additional custom directories to scan */
  customDirs?: string[];
  /** Skip plugin skills */
  skipPlugins?: boolean;
  /** Whether to scan built-in directories (.agent/.claude). Defaults to true. */
  scanDefaultDirs?: boolean;
  /** Include disabled skills (.SKILL.md) in results */
  includeDisabled?: boolean;
}

/**
 * Check if a directory has bundled resources
 */
function checkBundledResources(skillDir: string): {
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
} {
  return {
    hasReferences: existsSync(join(skillDir, "references")),
    hasScripts: existsSync(join(skillDir, "scripts")),
    hasAssets: existsSync(join(skillDir, "assets")),
  };
}

/**
 * Determine skill location type based on directory path
 */
function determineLocation(dirPath: string): SkillLocation {
  const normalizedPath = resolve(dirPath);
  const cwd = process.cwd();
  const home = homedir();

  if (
    normalizedPath.startsWith(join(cwd, ".agent")) ||
    normalizedPath.startsWith(join(cwd, ".claude"))
  ) {
    return "project";
  }

  if (
    normalizedPath.startsWith(join(home, ".agent")) ||
    normalizedPath.startsWith(join(home, ".claude"))
  ) {
    return "user";
  }

  // Custom directories default to user
  return "user";
}

function collectSkillDirectories(
  root: string,
  recursive: boolean,
  diagnostics: DiscoveryDiagnostics,
  accumulator: Set<string>,
  includeDisabled: boolean
): void {
  diagnostics.scannedDirectories.push(root);

  if (!existsSync(root)) {
    return;
  }

  let entries: Array<Dirent<string>>;
  try {
    entries = readdirSync(root, { withFileTypes: true }) as Array<Dirent<string>>;
  } catch (error) {
    console.warn(
      colors.yellow(
        `Warning: Failed to scan directory ${root}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    diagnostics.warnings.push(
      `Failed to scan directory ${root}: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(root, entry.name);
    const skillFilePath = join(skillDir, "SKILL.md");
    const disabledFilePath = join(skillDir, ".SKILL.md");

    if (existsSync(skillFilePath) || (includeDisabled && existsSync(disabledFilePath))) {
      accumulator.add(skillDir);
    }

    if (recursive) {
      collectSkillDirectories(skillDir, true, diagnostics, accumulator, includeDisabled);
    }
  }
}

interface ScanOptions {
  location?: SkillLocation;
  recursive?: boolean;
  diagnostics: DiscoveryDiagnostics;
  includeDisabled?: boolean;
}

/**
 * Scan a single skill directory and return found skills
 */
export function scanSkillDirectory(
  dirPath: string,
  { location, recursive = true, diagnostics, includeDisabled = false }: ScanOptions
): SkillMetadata[] {
  const skills: SkillMetadata[] = [];
  const skillDirectories = new Set<string>();

  collectSkillDirectories(dirPath, recursive, diagnostics, skillDirectories, includeDisabled);

  for (const skillDir of skillDirectories) {
    const skillFilePath = join(skillDir, "SKILL.md");
    const disabledFilePath = join(skillDir, ".SKILL.md");
    const hasSkill = existsSync(skillFilePath);
    const hasDisabled = includeDisabled && existsSync(disabledFilePath);

    if (hasSkill && hasDisabled) {
      diagnostics.conflicts.push(`Both SKILL.md and .SKILL.md found in ${skillDir}.`);
    }

    const candidates: Array<{ path: string; disabled: boolean }> = [];
    if (hasSkill) candidates.push({ path: skillFilePath, disabled: false });
    if (hasDisabled) candidates.push({ path: disabledFilePath, disabled: true });

    if (candidates.length === 0) continue;

    for (const candidate of candidates) {
      try {
        const parsed = parseSkillFile(candidate.path);
        const resources = checkBundledResources(skillDir);
        const skillLocation = location ?? determineLocation(skillDir);

        skills.push({
          name: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          location: skillLocation,
          path: skillDir,
          disabled: candidate.disabled,
          ...resources,
        });
      } catch (error) {
        console.warn(
          colors.yellow(
            `Warning: Failed to parse ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        diagnostics.warnings.push(
          `Failed to parse ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return skills;
}

/**
 * Discover all skills from standard directories
 */
export function discoverSkills(options: DiscoveryOptions = {}): DiscoveryResult {
  const diagnostics: DiscoveryDiagnostics = {
    scannedDirectories: [],
    warnings: [],
    conflicts: [],
  };

  const directories: string[] = [];

  if (options.customDirs?.length) {
    directories.push(...options.customDirs);
  }

  if (options.scanDefaultDirs !== false) {
    directories.push(...SKILL_DIRECTORIES);
  }

  const skillMap = new Map<string, SkillMetadata>();

  for (const dir of directories) {
    const absoluteDir = dir.startsWith("/") ? dir : resolve(process.cwd(), dir);
    const skills = scanSkillDirectory(absoluteDir, {
      diagnostics,
      recursive: true,
      includeDisabled: options.includeDisabled === true,
    });

    for (const skill of skills) {
      if (!skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill);
      } else {
        const existing = skillMap.get(skill.name);
        diagnostics.conflicts.push(
          `Keeping ${existing?.path ?? "unknown"} and skipping ${skill.path} for skill '${skill.name}' (higher priority already loaded).`
        );
      }
    }
  }

  return {
    skills: Array.from(skillMap.values()),
    diagnostics,
  };
}

/**
 * Load full skill content
 */
export function loadSkill(metadata: SkillMetadata): Skill {
  const skillFilePath = join(metadata.path, metadata.disabled ? ".SKILL.md" : "SKILL.md");
  const parsed = parseSkillFile(skillFilePath);

  return {
    ...metadata,
    content: parsed.fullContent,
    fullName: metadata.name, // Will be updated by plugin support
  };
}
