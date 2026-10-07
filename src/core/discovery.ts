/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「顶层 symlink 一等（lstat→realpath 单层、canonicalPath/entryKind/ownership）+
 * 递归拒绝 + broken typed omission」+「保留名精确 glob（.ccski-staging-* 与
 * .ccski-backup-*）+ marker+age/generation 条件清扫」+「legacy 物化目录
 * materialized + legacy-unknown 标注」+「G2 发现矩阵：人工磁盘 fixture」
 * 正交意图：
 *   [1] 技能发现扫描（既有面）：默认 roots + customDirs → SKILL.md 解析 → metadata
 *   [2] store-link-kernel 批 2（E6）：顶层 symlink 一等——Dirent（lstat 语义）检测 +
 *       单层 realpath；canonicalPath/entryKind/ownership/mode 标注；broken link =
 *       typed omission + diagnostic（列表可见占位，非静默缺失）；递归子层不跟随
 *       symlink（现状保持）
 *   [3] store-link-kernel 批 2（E6/E7）：ownership 判定的 state 只读同步读取面；
 *       无 state 记录的存量实目录 = materialized + legacy-unknown（只标注不转换，
 *       转换只经批 5 migrate）；批 3 G3 裁决增量：entities 表命中 = entity-local
 *       （实体本体与物化投影在发现面显式区分）
 *   [4] 保留名精确 glob 发现层跳过 + 残留清扫（marker + pid 活性/龄期条件，
 *       禁前缀盲删；无 marker 的同名用户目录不删）
 * 妥协声明：清扫以显式导出函数 sweepReservedResidues 交付，发现扫描保持只读
 * 零副作用（spec「startup cleanup」的内核启动挂载点随批 3/5 API/CLI 面接线）；
 * mutation 对 broken/external 条目的 typed 拒绝面（FOREIGN_OWNERSHIP 族）在批 4，
 * 本文件只钉发现面观察。
 */
import type { Dirent } from "node:fs";
import {
  existsSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { CcskiDiagnostic } from "../types/diagnostics.js";
import { diagnosticToWarning } from "../types/diagnostics.js";
import { CCSKI_STATE_FILENAME, readCcskiStateFileSync } from "./state-store.js";
import type {
  Skill,
  SkillEntryKind,
  SkillLocation,
  SkillMetadata,
  SkillOwnership,
  SkillProvider,
  SkillProvenance,
  SkillSourceKind,
} from "../types/skill.js";
import { parseSkillFile } from "./parser.js";
import { getDefaultSkillDirectories } from "./skill-roots.js";

export { getDefaultSkillDirectories } from "./skill-roots.js";

export interface DiscoveryDiagnostics {
  scannedDirectories: string[];
  warnings: string[];
  conflicts: string[];
  /** typed omission 占位条目（broken link 等）；与 warnings/events 同步可见 */
  omissions: DiscoveryOmission[];
  byProvider: Record<string, number>;
  events: CcskiDiagnostic[];
}

export type DiscoveryOmissionCode = "broken-symlink" | "symlink-target-not-directory";

/**
 * typed omission 占位条目：发现层遇到不可作为技能条目的顶层 symlink 时产出
 * （spec Scenario: Broken projection link is a typed omission——列表可见诊断条目，
 * 非静默缺失）。对其的 mutation typed 失败面在批 4。
 */
export interface DiscoveryOmission {
  code: DiscoveryOmissionCode;
  /** 扫描根 */
  root: string;
  /** 条目名 */
  name: string;
  /** 链接路径（占位身份） */
  path: string;
  /** readlink 原文（可读时） */
  target?: string;
  message: string;
}

export interface DiscoveryResult {
  skills: SkillMetadata[];
  diagnostics: DiscoveryDiagnostics;
}

/**
 * 保留名精确 glob（E6）：`.ccski-staging-*` / `.ccski-backup-*`（前缀 + 非空
 * 后缀）。发现层跳过；清扫只认 marker + 条件（禁前缀盲删）。
 */
const CCSKI_STAGING_PATTERN = /^\.ccski-staging-.+$/;
const CCSKI_BACKUP_PATTERN = /^\.ccski-backup-.+$/;

export function isCcskiReservedName(name: string): boolean {
  return CCSKI_STAGING_PATTERN.test(name) || CCSKI_BACKUP_PATTERN.test(name);
}

function residueKindOf(name: string): "staging" | "backup" | null {
  if (CCSKI_STAGING_PATTERN.test(name)) return "staging";
  if (CCSKI_BACKUP_PATTERN.test(name)) return "backup";
  return null;
}

/**
 * ccski 残留所有权 marker（批 2 约定）：staging/backup 残留目录内的
 * `.ccski-residue.json`。清扫只删「携带可解析 marker +（写者已死 或 超龄期）」
 * 的残留；无 marker 的同名用户目录永不删。
 */
export const CCSKI_RESIDUE_MARKER_FILENAME = ".ccski-residue.json";

export interface CcskiResidueMarker {
  /** 创建残留的写者进程 pid（活性 = 清扫条件之一） */
  pid: number;
  /** 创建时刻（epoch ms；龄期条件基准） */
  createdAt: number;
  kind?: "staging" | "backup";
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
  /**
   * store-link-kernel 批 2：项目 scope 基目录（默认 `process.cwd()`）；
   * 决定项目侧默认 roots 与默认 state 读取面之一。
   */
  workspaceDir?: string;
  /**
   * store-link-kernel 批 2：显式 state scopeBase 列表（`.ccski-state.json` 所在
   * 目录）；默认 `[<workspaceDir>/.agents, <userDir>/.agents]`。ownership 判定
   * 只读这些 state，发现层绝不写。
   */
  stateBases?: string[];
}

/**
 * ownership 判定的 state 只读视图（批 2）。
 * ownedPaths = entities ∪ projections 记录的 path（resolve 归一）；
 * linkProjectionPaths = 记录 mode:"link" 的投影 path（投影路径被占用观察）。
 * state 记录的领域字段由批 3/4 正式化；本视图防御性窄化（只认带 string path
 * 的记录条目），record 形状变化时安全降级为「无记录」。
 */
export interface DiscoveryKernelState {
  /** 读过的 scopeBase（resolve 归一） */
  bases: string[];
  ownedPaths: Set<string>;
  /** entities 表记录的实体路径（resolve + realpath 双形态；entity-local 区分依据） */
  entityPaths: Set<string>;
  linkProjectionPaths: Set<string>;
  /** state 只读降级诊断（每损坏 base 一条；发现层不硬失败） */
  recovery: CcskiDiagnostic[];
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 归属判定的路径登记：resolve 归一 + realpath 典范化双形态。state 记录的是
 * canonical（realpath）路径，而发现扫描得到的条目路径可能携带符号链接祖先
 * （如 macOS /var → /private/var）；canonical 身份命中要求两侧都按 realpath
 * 对齐（spec: Ownership-first removal 的 lstat/realpath verified 同语义）。
 * 记录路径已消失时保留 resolve 形态（realpath 复核失败不致命）。
 */
function addOwnedPath(set: Set<string>, rawPath: string): void {
  const normalized = resolve(rawPath);
  set.add(normalized);
  try {
    set.add(realpathSync(normalized));
  } catch {
    // 记录目标已消失：保留 resolve 形态
  }
}

function collectStateRecordPaths(
  table: Record<string, unknown>,
  owned: Set<string>,
  links?: Set<string>,
  entityPaths?: Set<string>
): void {
  for (const value of Object.values(table)) {
    if (!isRecordValue(value)) continue;
    if (typeof value.path !== "string" || value.path.length === 0) continue;
    addOwnedPath(owned, value.path);
    if (links && value.mode === "link") addOwnedPath(links, value.path);
    if (entityPaths) addOwnedPath(entityPaths, value.path);
  }
}

/** 默认 state scopeBase：`<userDir>/.agents`（global）+ `process.cwd()/.agents`（project） */
function defaultKernelStateBases(userDir: string): string[] {
  return [join(resolve(userDir), ".agents"), join(resolve(process.cwd()), ".agents")];
}

/**
 * 读取 scopeBase 列表上的 `.ccski-state.json` 构建 ownership 视图（只读）。
 * absent → 无记录；损坏/未知版本 → STATE_RECOVERY_REQUIRED 降级诊断 + 视为
 * 无记录（发现层按磁盘形态标注 unknown/external，绝不硬失败）。
 */
export function readKernelStateView(stateBases: string[]): DiscoveryKernelState {
  const view: DiscoveryKernelState = {
    bases: stateBases.map((base) => resolve(base)),
    ownedPaths: new Set(),
    entityPaths: new Set(),
    linkProjectionPaths: new Set(),
    recovery: [],
  };
  for (const base of view.bases) {
    const statePath = join(base, CCSKI_STATE_FILENAME);
    const read = readCcskiStateFileSync(statePath);
    if (read.kind === "absent") continue;
    if (read.kind === "recovery-required") {
      view.recovery.push({
        severity: "warning",
        source: "discovery",
        code: "state-recovery-required",
        message: `ccski state ${statePath} degraded read-only: ${read.detail}`,
        details: { base, code: read.code, reason: read.reason },
      });
      continue;
    }
    collectStateRecordPaths(read.data.entities, view.ownedPaths, undefined, view.entityPaths);
    collectStateRecordPaths(read.data.projections, view.ownedPaths, view.linkProjectionPaths);
  }
  return view;
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

function addDiscoveryDiagnostic(
  diagnostics: DiscoveryDiagnostics,
  diagnostic: CcskiDiagnostic
): void {
  diagnostics.events.push(diagnostic);
  diagnostics.warnings.push(diagnosticToWarning(diagnostic));
}

function pushOmission(
  diagnostics: DiscoveryDiagnostics,
  omission: DiscoveryOmission
): void {
  diagnostics.omissions.push(omission);
  addDiscoveryDiagnostic(diagnostics, {
    severity: "warning",
    source: "discovery",
    code: omission.code,
    message: omission.message,
    details: {
      root: omission.root,
      name: omission.name,
      path: omission.path,
      ...(omission.target ? { target: omission.target } : {}),
    },
  });
}

/**
 * Determine skill location type based on directory path
 */
function determineLocation(dirPath: string, userDir: string): SkillLocation {
  const normalizedPath = resolve(dirPath);
  const cwd = resolve(process.cwd());
  const home = resolve(userDir);
  const relativeToCwd = normalizedPath.startsWith(cwd) ? normalizedPath.slice(cwd.length) : "";
  const relativeToHome = normalizedPath.startsWith(home) ? normalizedPath.slice(home.length) : "";

  if (relativeToCwd.startsWith("/skills") || /^\/\.[^/]+\/skills(?:\/|$)/.test(relativeToCwd)) {
    return "project";
  }

  if (/^\/\.[^/]+\/skills(?:\/|$)/.test(relativeToHome)) {
    return "user";
  }

  // Custom directories default to user
  return "user";
}

/** 顶层收集条目：path = 发现位置（symlink 条目 = 链接路径）；contentDir = 内容读取目录 */
interface CollectedSkillEntry {
  path: string;
  contentDir: string;
  /** 顶层条目形态标注；递归子层条目不标注 */
  entryKind?: SkillEntryKind;
}

function collectSkillDirectories(
  root: string,
  recursive: boolean,
  diagnostics: DiscoveryDiagnostics,
  accumulator: Map<string, CollectedSkillEntry>,
  includeDisabled: boolean,
  depth = 0
): void {
  diagnostics.scannedDirectories.push(root);

  if (!existsSync(root)) {
    return;
  }

  let entries: Array<Dirent<string>>;
  try {
    entries = readdirSync(root, { withFileTypes: true }) as Array<Dirent<string>>;
  } catch (error) {
    addDiscoveryDiagnostic(diagnostics, {
      severity: "warning",
      source: "discovery",
      code: "failed-to-scan-directory",
      message: `Failed to scan directory ${root}: ${error instanceof Error ? error.message : String(error)}`,
      details: { directory: root },
    });
    return;
  }

  for (const entry of entries) {
    // 保留名（.ccski-staging-*/.ccski-backup-*）发现层跳过（E6）；清扫走 sweepReservedResidues
    if (isCcskiReservedName(entry.name)) continue;

    const entryPath = join(root, entry.name);

    // 顶层 symlink 一等（E6）：lstat 语义检测 + 单层 realpath；typed omission
    if (depth === 0 && entry.isSymbolicLink()) {
      collectTopLevelSymlink(entry.name, entryPath, root, diagnostics, accumulator, includeDisabled);
      continue;
    }

    if (!entry.isDirectory()) continue;

    const skillFilePath = join(entryPath, "SKILL.md");
    const disabledFilePath = join(entryPath, ".SKILL.md");

    if (existsSync(skillFilePath) || (includeDisabled && existsSync(disabledFilePath))) {
      accumulator.set(entryPath, {
        path: entryPath,
        contentDir: entryPath,
        ...(depth === 0 ? { entryKind: "directory" as const } : {}),
      });
    }

    if (recursive) {
      collectSkillDirectories(entryPath, true, diagnostics, accumulator, includeDisabled, depth + 1);
    }
  }
}

/**
 * 顶层 symlink 一等条目（E6）：单层 realpath 解析 canonical 目标；broken /
 * 指向非目录 → typed omission 占位（非静默缺失）；有 SKILL.md 则以链接路径为
 * path、canonical 目标为内容目录收集。不递归进链接（递归不跟随 symlink）。
 */
function collectTopLevelSymlink(
  name: string,
  linkPath: string,
  root: string,
  diagnostics: DiscoveryDiagnostics,
  accumulator: Map<string, CollectedSkillEntry>,
  includeDisabled: boolean
): void {
  let rawTarget: string | undefined;
  try {
    rawTarget = readlinkSync(linkPath);
  } catch {
    rawTarget = undefined; // readlink 失败细节并入 broken 诊断
  }

  const targetDetail = rawTarget !== undefined ? ` -> ${rawTarget}` : "";
  let canonical: string;
  try {
    const resolved = realpathSync(linkPath);
    const stats = statSync(linkPath);
    if (!stats.isDirectory()) {
      pushOmission(diagnostics, {
        code: "symlink-target-not-directory",
        root,
        name,
        path: linkPath,
        ...(rawTarget !== undefined ? { target: rawTarget } : {}),
        message: `Top-level symlink ${linkPath}${targetDetail} resolves to a non-directory; recorded as typed omission.`,
      });
      return;
    }
    canonical = resolved;
  } catch (error) {
    pushOmission(diagnostics, {
      code: "broken-symlink",
      root,
      name,
      path: linkPath,
      ...(rawTarget !== undefined ? { target: rawTarget } : {}),
      message: `Top-level symlink ${linkPath}${targetDetail} is broken (realpath failed: ${
        error instanceof Error ? error.message : String(error)
      }); recorded as typed omission, never a silent gap.`,
    });
    return;
  }

  const skillFilePath = join(canonical, "SKILL.md");
  const disabledFilePath = join(canonical, ".SKILL.md");
  if (existsSync(skillFilePath) || (includeDisabled && existsSync(disabledFilePath))) {
    accumulator.set(linkPath, { path: linkPath, contentDir: canonical, entryKind: "symlink" });
  }
}

/** 条目的 canonical 身份：realpath 优先（符号链接祖先对齐 state 记录形态），消失时回退 resolve */
function canonicalIdentityOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * 批 2（E6/E7）+ 批 3 G3 裁决：顶层条目的内核标注。归属判定（state 只读视图）：
 * - symlink：canonicalPath 或链接路径命中 state 记录 → ccski；否则 external。
 * - directory：命中 entities 表记录 → ccski + entity-local（实体本体≠投影副本）；
 *   仅命中 projections 记录 → ccski + materialized；未记录 → unknown +
 *   legacy-unknown（只标注不转换）。state 记录 mode:"link" 的路径被实体目录
 *   占据 → 投影路径被占用观察诊断（guard 处理在批 4）。
 */
function kernelAnnotation(
  entry: CollectedSkillEntry,
  kernel: DiscoveryKernelState,
  diagnostics: DiscoveryDiagnostics
): Pick<SkillMetadata, "canonicalPath" | "entryKind" | "ownership" | "mode" | "provenance"> {
  const canonicalPath = canonicalIdentityOf(entry.contentDir);
  const entryPath = resolve(entry.path);
  const occupied = canonicalIdentityOf(entry.path);
  const owned =
    kernel.ownedPaths.has(canonicalPath) ||
    kernel.ownedPaths.has(entryPath) ||
    kernel.ownedPaths.has(occupied);

  if (entry.entryKind === "symlink") {
    const ownership: SkillOwnership = owned ? "ccski" : "external";
    return { canonicalPath, entryKind: "symlink", ownership, mode: "link" };
  }

  if (kernel.linkProjectionPaths.has(entryPath) || kernel.linkProjectionPaths.has(occupied)) {
    addDiscoveryDiagnostic(diagnostics, {
      severity: "warning",
      source: "discovery",
      code: "projection-path-occupied",
      message: `State records a link projection at ${entryPath}, but a real directory occupies the path (observed only; guard enforcement is a later batch).`,
      details: { path: entryPath },
    });
  }

  if (owned) {
    // entity-local 第四形态（2026-10-07 G3 裁决）：目录条目命中 entities 表记录 =
    // 实体本体，不是物化投影副本——实体记录是唯一权威，禁与 materialized 混淆。
    if (
      kernel.entityPaths.has(canonicalPath) ||
      kernel.entityPaths.has(entryPath) ||
      kernel.entityPaths.has(occupied)
    ) {
      return {
        canonicalPath,
        entryKind: "directory",
        ownership: "ccski",
        mode: "entity-local",
      };
    }
    return { canonicalPath, entryKind: "directory", ownership: "ccski", mode: "materialized" };
  }
  const provenance: SkillProvenance = "legacy-unknown";
  return {
    canonicalPath,
    entryKind: "directory",
    ownership: "unknown",
    mode: "materialized",
    provenance,
  };
}

interface ScanOptions {
  location?: SkillLocation;
  recursive?: boolean;
  diagnostics: DiscoveryDiagnostics;
  includeDisabled?: boolean;
  sourceKind?: SkillSourceKind;
  sourcePriority?: number;
  /** ownership 判定的 state 视图；缺省 = 默认 stateBases（userDir/.agents + cwd/.agents） */
  kernelState?: DiscoveryKernelState;
}

/**
 * Scan a single skill directory and return found skills
 */
export function scanSkillDirectory(
  dirPath: string,
  {
    location,
    recursive = true,
    diagnostics,
    includeDisabled = false,
    sourceKind,
    sourcePriority,
    kernelState,
  }: ScanOptions,
  provider: SkillProvider,
  userDir: string = homedir(),
  scope?: string
): SkillMetadata[] {
  const skills: SkillMetadata[] = [];
  const kernel = kernelState ?? readKernelStateView(defaultKernelStateBases(userDir));
  const collected = new Map<string, CollectedSkillEntry>();

  collectSkillDirectories(dirPath, recursive, diagnostics, collected, includeDisabled);

  for (const entry of collected.values()) {
    const skillDir = entry.contentDir;
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

    const kernelFields = entry.entryKind
      ? kernelAnnotation(entry, kernel, diagnostics)
      : {};

    for (const candidate of candidates) {
      try {
        const parsed = parseSkillFile(candidate.path);
        const baseName = parsed.frontmatter.name;
        const scopedName = scope && !baseName.includes(":") ? `${scope}:${baseName}` : baseName;
        const resources = checkBundledResources(skillDir);
        const skillLocation = location ?? determineLocation(entry.path, userDir);

        skills.push({
          name: scopedName,
          description: parsed.frontmatter.description,
          provider,
          location: skillLocation,
          ...(sourceKind ? { sourceKind } : {}),
          ...(sourcePriority !== undefined ? { sourcePriority } : {}),
          path: entry.path,
          disabled: candidate.disabled,
          ...resources,
          ...kernelFields,
        });
        diagnostics.byProvider[provider] = (diagnostics.byProvider[provider] ?? 0) + 1;
      } catch (error) {
        addDiscoveryDiagnostic(diagnostics, {
          severity: "warning",
          source: "discovery",
          code: "failed-to-parse-skill",
          message: `Failed to parse ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`,
          details: { file: candidate.path },
        });
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
    omissions: [],
    byProvider: {
      file: 0,
    },
    events: [],
  };

  const userDir = options.userDir ? resolve(options.userDir) : homedir();
  const workspaceDir = resolve(options.workspaceDir ?? process.cwd());

  const kernel = readKernelStateView(
    (options.stateBases ?? [
      join(workspaceDir, ".agents"),
      join(userDir, ".agents"),
    ]).map((base) => resolve(base))
  );
  for (const recovery of kernel.recovery) {
    addDiscoveryDiagnostic(diagnostics, recovery);
  }

  const directories: Array<{
    path: string;
    provider: SkillProvider;
    scope?: string;
    location?: SkillLocation;
    sourceKind?: SkillSourceKind;
    sourcePriority?: number;
  }> = [];

  if (options.customDirs?.length) {
    for (const entry of options.customDirs) {
      const provider = options.customProvider ?? "file";
      if (typeof entry === "string") {
        const scope = provider === "file" ? "other" : undefined;
        directories.push({
          path: entry,
          provider,
          sourceKind: "custom",
          sourcePriority: 500,
          ...(scope ? { scope } : {}),
        });
      } else {
        const scope = entry.scope ?? (provider === "file" ? "other" : undefined);
        directories.push({
          path: entry.path,
          provider,
          sourceKind: "custom",
          sourcePriority: 500,
          ...(scope ? { scope } : {}),
        });
      }
    }
  }

  if (options.scanDefaultDirs !== false) {
    directories.push(...getDefaultSkillDirectories(userDir, workspaceDir));
  }

  const skills: SkillMetadata[] = [];
  const firstPathByName = new Map<string, string>();

  for (const entry of directories) {
    const { path: dir, provider, scope, location, sourceKind, sourcePriority } = entry;
    const absoluteDir = dir.startsWith("/") ? dir : resolve(process.cwd(), dir);
    const skillsFromDir = scanSkillDirectory(
      absoluteDir,
      {
        ...(location ? { location } : {}),
        diagnostics,
        recursive: true,
        includeDisabled: options.includeDisabled === true,
        kernelState: kernel,
        ...(sourceKind ? { sourceKind } : {}),
        ...(sourcePriority !== undefined ? { sourcePriority } : {}),
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

// ---------------------------------------------------------------------------
// 保留名残留清扫（E6）：marker + pid 活性/龄期条件；禁前缀盲删
// ---------------------------------------------------------------------------

export interface SweepReservedOptions {
  /** 兜底龄期（毫秒）：写者存活但残留超过此龄期同样可清扫。默认 10000 */
  maxAgeMs?: number;
  /** 时钟注入（测试钉龄期分支）；默认 Date.now */
  now?: () => number;
}

export type SweepKeptReason =
  | "no-marker"
  | "marker-unreadable"
  | "writer-alive"
  | "non-directory"
  | "delete-failed";

export interface SweepReservedKeptEntry {
  path: string;
  name: string;
  kind: "staging" | "backup";
  reason: SweepKeptReason;
  detail?: string;
}

export interface SweepReservedRemovedEntry {
  path: string;
  name: string;
  kind: "staging" | "backup";
}

export interface SweepReservedResult {
  removed: SweepReservedRemovedEntry[];
  kept: SweepReservedKeptEntry[];
}

/** pid 活性检查（与 state-store 锁窃取同语义：EPERM 视为存活） */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

function readResidueMarker(dir: string): CcskiResidueMarker | null {
  let text: string;
  try {
    text = readFileSync(join(dir, CCSKI_RESIDUE_MARKER_FILENAME), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecordValue(parsed)) return null;
  const pid = parsed.pid;
  const createdAt = parsed.createdAt;
  if (typeof pid !== "number" || !Number.isInteger(pid)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const kind = parsed.kind === "staging" || parsed.kind === "backup" ? parsed.kind : undefined;
  return { pid, createdAt, ...(kind ? { kind } : {}) };
}

/**
 * 清扫单个 skills root 下的 ccski 残留（`.ccski-staging-*` / `.ccski-backup-*`）。
 * 可清扫 = 精确 glob 命名 + 目录 + 携带可解析 ccski marker +（写者已死 或 残留
 * 超过 maxAgeMs）。无 marker 的同名用户目录永不删（禁前缀盲删的钉面）；保留名
 * symlink/文件一律不动（防穿链删除）；单条目删除失败 typed 如实保留，不抛出。
 *
 * spec 的「startup cleanup」内核启动挂载点在批 3/5 API/CLI 面接线；本函数是
 * 显式维护入口，发现扫描本身保持只读。
 */
export function sweepReservedResidues(
  root: string,
  options: SweepReservedOptions = {}
): SweepReservedResult {
  const maxAgeMs = options.maxAgeMs ?? 10_000;
  const now = options.now ?? Date.now;
  const result: SweepReservedResult = { removed: [], kept: [] };

  let entries: Array<Dirent<string>>;
  try {
    entries = readdirSync(root, { withFileTypes: true }) as Array<Dirent<string>>;
  } catch {
    return result; // 根不可读 = 无可清扫面（扫描面另行诊断）
  }

  for (const entry of entries) {
    const kind = residueKindOf(entry.name);
    if (!kind) continue;
    const fullPath = join(root, entry.name);

    if (!entry.isDirectory()) {
      result.kept.push({ path: fullPath, name: entry.name, kind, reason: "non-directory" });
      continue;
    }

    const markerPath = join(fullPath, CCSKI_RESIDUE_MARKER_FILENAME);
    const marker = readResidueMarker(fullPath);
    if (!marker) {
      result.kept.push({
        path: fullPath,
        name: entry.name,
        kind,
        reason: existsSync(markerPath) ? "marker-unreadable" : "no-marker",
      });
      continue;
    }

    const writerDead = marker.pid !== process.pid && !isProcessAlive(marker.pid);
    const aged = now() - marker.createdAt > maxAgeMs;
    if (!writerDead && !aged) {
      result.kept.push({ path: fullPath, name: entry.name, kind, reason: "writer-alive" });
      continue;
    }

    try {
      rmSync(fullPath, { recursive: true });
      result.removed.push({ path: fullPath, name: entry.name, kind });
    } catch (error) {
      result.kept.push({
        path: fullPath,
        name: entry.name,
        kind,
        reason: "delete-failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
