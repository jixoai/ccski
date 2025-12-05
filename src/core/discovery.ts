import type { Dirent } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Skill, SkillLocation, SkillMetadata, SkillProvider } from "../types/skill.js";
import { colors } from "../utils/format.js";
import { parseSkillFile } from "./parser.js";

export function getDefaultSkillDirectories(userDir: string): ReadonlyArray<{ path: string; provider: SkillProvider }> {
  return [
    { path: ".agent/skills", provider: "claude" }, // Project universal
    { path: ".claude/skills", provider: "claude" }, // Project Claude Code
    { path: join(userDir, ".agent/skills"), provider: "claude" }, // User universal
    { path: join(userDir, ".claude/skills"), provider: "claude" }, // User Claude Code
    { path: ".codex/skills", provider: "codex" }, // Project Codex
    { path: join(userDir, ".codex/skills"), provider: "codex" }, // User Codex
  ];
}

export interface DiscoveryDiagnostics {
  scannedDirectories: string[];
  warnings: string[];
  conflicts: string[];
  byProvider: Record<SkillProvider, number>;
}

export interface DiscoveryResult {
  skills: SkillMetadata[];
  diagnostics: DiscoveryDiagnostics;
}

/**
 * Options for skill discovery
 */
interface CustomDirScopeEntry {
  path: string;
  scope?: string;
}

export interface DiscoveryOptions {
  /** Additional custom directories to scan */
  customDirs?: Array<string | CustomDirScopeEntry>;
  /** Provider to tag custom directories with (defaults to "file") */
  customProvider?: SkillProvider;
  /** Skip plugin skills */
  skipPlugins?: boolean;
  /** Whether to scan built-in directories (.agent/.claude). Defaults to true. */
  scanDefaultDirs?: boolean;
  /** Include disabled skills (.SKILL.md) in results */
  includeDisabled?: boolean;
  /** Base directory used for user-level default roots; defaults to OS home */
  userDir?: string;
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
function determineLocation(dirPath: string, userDir: string): SkillLocation {
  const normalizedPath = resolve(dirPath);
  const cwd = process.cwd();
  const home = userDir;

  if (
    normalizedPath.startsWith(join(cwd, ".agent")) ||
    normalizedPath.startsWith(join(cwd, ".claude")) ||
    normalizedPath.startsWith(join(cwd, ".codex"))
  ) {
    return "project";
  }

  if (
    normalizedPath.startsWith(join(home, ".agent")) ||
    normalizedPath.startsWith(join(home, ".claude")) ||
    normalizedPath.startsWith(join(home, ".codex"))
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
  { location, recursive = true, diagnostics, includeDisabled = false }: ScanOptions,
  provider: SkillProvider,
  userDir: string = homedir(),
  scope?: string
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
        const baseName = parsed.frontmatter.name;
        const scopedName =
          scope && !baseName.includes(":") ? `${scope}:${baseName}` : baseName;
        const resources = checkBundledResources(skillDir);
        const skillLocation = location ?? determineLocation(skillDir, userDir);

        skills.push({
          name: scopedName,
          description: parsed.frontmatter.description,
          provider,
          location: skillLocation,
          path: skillDir,
          disabled: candidate.disabled,
          ...resources,
        });
        diagnostics.byProvider[provider] = (diagnostics.byProvider[provider] ?? 0) + 1;
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
    byProvider: {
      claude: 0,
      codex: 0,
      file: 0,
    },
  };

  const userDir = options.userDir ? resolve(options.userDir) : homedir();

  const directories: Array<{ path: string; provider: SkillProvider; scope?: string }> = [];

  if (options.customDirs?.length) {
    for (const entry of options.customDirs) {
      const provider = options.customProvider ?? "file";
      if (typeof entry === "string") {
        directories.push({
          path: entry,
          provider,
          scope: provider === "file" ? "other" : undefined,
        });
      } else {
        directories.push({
          path: entry.path,
          provider,
          scope: entry.scope ?? (provider === "file" ? "other" : undefined),
        });
      }
    }
  }

  if (options.scanDefaultDirs !== false) {
    directories.push(...getDefaultSkillDirectories(userDir));
  }

  const skills: SkillMetadata[] = [];
  const firstPathByName = new Map<string, string>();

  for (const entry of directories) {
    const { path: dir, provider, scope } = entry;
    const absoluteDir = dir.startsWith("/") ? dir : resolve(process.cwd(), dir);
    const skillsFromDir = scanSkillDirectory(
      absoluteDir,
      {
        diagnostics,
        recursive: true,
        includeDisabled: options.includeDisabled === true,
      },
      provider,
      userDir,
      scope
    );

    for (const skill of skillsFromDir) {
      if (firstPathByName.has(skill.name)) {
        diagnostics.conflicts.push(
          `Duplicate skill '${skill.name}' found at ${skill.path} (first seen at ${firstPathByName.get(skill.name)})`
        );
      } else {
        firstPathByName.set(skill.name, skill.path);
      }
      skills.push(skill);
    }
  }

  return {
    skills,
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
