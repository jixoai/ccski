/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「migrate --dry-run（列名称碰撞/hash/目标实体/将建投影/
 * 影响 roots）+ 执行（expected hash 守卫；冲突保留原件 typed；backup/journal 可回滚）；
 * legacy 实目录 → entity+link 转换走 ensureEntity/projectEntity 原语」（批 5
 * tasks.md:43；spec: Versioned breaking release and legacy migration + Scenario:
 * Migration conflict keeps the original）
 * 正交意图：
 *   [1] dry-run 计划面：纯读扫描（实体根 legacy 候选 + 显式 roots 上的实体副本）→
 *       targetEntities / plannedProjections / collisions（hash 钉值）/ affectedRoots；
 *       dry-run 后磁盘与 state 字节零变化（G5 门不变性收据）
 *   [2] 执行守卫：逐候选重 hash 对齐计划值（漂移 → HASH_MISMATCH 原件不动）；
 *       名称碰撞（NAME_COLLISION/记录已占位）保留原件 typed，其余候选继续（spec
 *       Scenario 钉值）；实体收编与投影转换走 ensureEntity/projectEntity 原语
 *   [3] backup/journal 回滚：候选先 rename 进 `<scopeBase>/.ccski-backup-migrate-*`
 *       并写 journal（`.ccski-migrate-journal.json`）；ensureEntity/projectEntity
 *       失败 → rename 回原件 + journal 收敛；崩溃残留由下次 migrate 执行半区启动的
 *       journal replay 收敛（原件缺失 → 备份还原；原件已在 → 备份清理）
 *   [4] legacy 身份诚实化：provenance source = 原路径（sourceType "legacy-migrate"）；
 *       换名候选（目录名 ≠ sanitize(逻辑名)）经 backup→ensureEntity 重落位到
 *       冻结 sanitize 的 folderName
 * 妥协声明：实体收编用 ensureEntity 而非直写记录（原语单源；代价 = 备份位置到实体
 * 根的一次真实复制）；投影转换在摘位后调用 projectEntity（建链/降级/记账全部复用其
 * 语义，migrate 不自建第二条投影路径）；计划期与执行期之间的并发窗口由重 hash 守卫 +
 * ensureEntity/projectEntity 自身 CAS 收窄，残余竞态以 typed 冲突如实呈现。
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  type EntityScope,
  entityRootFor,
  parseEntityTable,
  parseProjectionTable,
  projectionRootId,
  resolveScopeBase,
  sanitizeEntityFolderName,
} from "../core/entity-state.js";
import { computeSkillFolderHash } from "../core/folder-hash.js";
import { parseSkillFile } from "../core/parser.js";
import { StateStore, emptyState } from "../core/state-store.js";
import { lstatSafe } from "./entity-guards.js";
import { ensureEntity, projectEntity } from "./entity.js";

export type MigrateFailureCode =
  | "SCOPE_REQUIRED"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

/** 逐候选冲突码（finite；冲突 = 原件不动，其余候选继续） */
export type MigrateConflictCode =
  | "NAME_COLLISION"
  | "HASH_MISMATCH"
  | "PATH_OCCUPIED"
  | "ENTITY_SWAP_FAILED"
  | "PROJECTION_FAILED"
  | "IO";

export interface MigrateConflict {
  code: MigrateConflictCode;
  /** 冲突原件路径（保持不动） */
  path: string;
  message: string;
}

export interface MigrateCandidatePlan {
  kind: "entity-adoption" | "projection-conversion";
  /** legacy 原件路径（实体根候选目录 / 投影根副本目录） */
  path: string;
  logicalName: string;
  folderName: string;
  /** 计划期内容 hash（执行期 expected hash 守卫基准） */
  hash: string;
  /** projection-conversion 的投影根 */
  root?: string;
  /** 计划期目标 folderName 与现目录名不同（冻结 sanitize 重落位） */
  sanitizeTarget: string;
}

export interface MigratePlan {
  dryRun: true;
  scope: EntityScope;
  /** 目标实体（entity-adoption 候选） */
  targetEntities: MigrateCandidatePlan[];
  /** 将建投影（projection-conversion 候选） */
  plannedProjections: MigrateCandidatePlan[];
  /** 名称碰撞（typed，原件保留；执行期跳过） */
  collisions: MigrateConflict[];
  /** 受影响 roots（实体根 ∪ 显式 roots 中含候选者） */
  affectedRoots: string[];
}

export interface MigrateAdopted {
  logicalName: string;
  folderName: string;
  entityPath: string;
  revision: string;
  warnings: string[];
}

export interface MigrateConverted {
  logicalName: string;
  folderName: string;
  root: string;
  path: string;
  mode: "link" | "materialized";
  reason?: string;
}

export type MigrateResult =
  | (MigratePlan & { kind: "ok" })
  | {
      kind: "ok";
      dryRun: false;
      scope: EntityScope;
      adopted: MigrateAdopted[];
      converted: MigrateConverted[];
      conflicts: MigrateConflict[];
      affectedRoots: string[];
      journalPath: string;
      generation: number;
      warnings: string[];
    }
  | { kind: "error"; code: MigrateFailureCode; message: string };

const MIGRATE_BACKUP_PREFIX = ".ccski-backup-migrate-";
const JOURNAL_FILENAME = ".ccski-migrate-journal.json";

interface JournalEntry {
  id: string;
  kind: "entity" | "projection";
  /** 原件路径（回滚目标） */
  originalPath: string;
  /** 备份路径（replay 还原源） */
  backupPath: string;
  createdAt: string;
}

interface MigrateJournal {
  entries: JournalEntry[];
}

function readJournal(scopeBase: string): MigrateJournal {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(scopeBase, JOURNAL_FILENAME), "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as MigrateJournal).entries)
    ) {
      return parsed as MigrateJournal;
    }
  } catch {
    // 缺失/损坏 = 空 journal（启动零残留）
  }
  return { entries: [] };
}

function writeJournal(scopeBase: string, journal: MigrateJournal): void {
  writeFileSync(join(scopeBase, JOURNAL_FILENAME), `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}

interface ParsedLegacyDir {
  logicalName: string;
}

function parseLegacyDir(dir: string): ParsedLegacyDir | null {
  if (!existsSync(join(dir, "SKILL.md"))) return null;
  try {
    return { logicalName: parseSkillFile(join(dir, "SKILL.md")).frontmatter.name };
  } catch {
    return null; // 不可解析 = 非 migrate 面（validate/repair 的诊断面负责呈现）
  }
}

interface DirEntryLike {
  name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
}

function readDirEntries(root: string): DirEntryLike[] {
  try {
    return readdirSync(root, { withFileTypes: true }) as never;
  } catch {
    return [];
  }
}

/** 崩溃残留收敛（journal replay）：原件缺失 → 备份还原；原件已在 → 备份清理 */
function replayJournal(scopeBase: string, warnings: string[]): void {
  const journal = readJournal(scopeBase);
  if (journal.entries.length === 0) return;
  const remaining: JournalEntry[] = [];
  for (const entry of journal.entries) {
    const originalSt = lstatSafe(entry.originalPath);
    const backupSt = lstatSafe(entry.backupPath);
    if (originalSt === null && backupSt !== null) {
      // 崩溃于「backup rename 之后、转换完成之前」：原件复位
      try {
        renameSync(entry.backupPath, entry.originalPath);
        warnings.push(`journal replay restored ${entry.originalPath} from ${entry.backupPath}`);
      } catch (error) {
        warnings.push(
          `journal replay failed for ${entry.originalPath}: ${
            error instanceof Error ? error.message : String(error)
          }; backup remains at ${entry.backupPath}`
        );
        remaining.push(entry);
      }
      continue;
    }
    if (originalSt !== null && backupSt !== null) {
      // 原件已在（转换完成后备份删除前的崩溃）：清理备份
      try {
        rmSync(entry.backupPath, { recursive: true, force: true });
        warnings.push(`journal replay removed completed backup ${entry.backupPath}`);
      } catch {
        remaining.push(entry);
      }
      continue;
    }
    // 原件与备份都缺失：条目过期，直接收敛
  }
  if (remaining.length !== journal.entries.length) {
    writeJournal(scopeBase, { entries: remaining });
  }
}

/**
 * migrate（spec: Versioned breaking release and legacy migration）。dry-run =
 * 纯读计划（碰撞/hash/目标实体/将建投影/影响 roots；字节零变化）；执行 =
 * expected hash 守卫 + backup/journal 回滚的实体收编与投影转换（ensureEntity/
 * projectEntity 原语）。冲突保留原件 typed，其余候选继续（spec Scenario 钉值）。
 */
export async function migrateLegacyEntries(options: {
  scope?: EntityScope;
  dryRun?: boolean;
  /**
   * 显式投影根（投影转换扫描面；SDK 永不环境推断）。缺省 = 只做实体根收编。
   * CLI 默认注入 detected agent roots。
   */
  roots?: readonly string[];
  /**
   * dry-run 计划回传（spec: execution MUST require matching expected hashes）：
   * 提供时执行半区以计划内的 hash 为 expected 基准（计划后内容漂移 → HASH_MISMATCH
   * 原件不动）；缺省 = 自计划自执行（同调用内 scan→execute 的并发窗由重 hash 守卫）。
   */
  plan?: MigratePlan;
  userDir?: string;
  workspaceDir?: string;
}): Promise<MigrateResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'migrate requires an explicit scope: "global" | "project".',
    };
  }
  const scope: EntityScope = options.scope;
  const scopeBase = resolveScopeBase(scope, options);
  const entityRoot = entityRootFor(scopeBase);
  const store = new StateStore(scopeBase);

  // ---- journal replay 前置（崩溃残留收敛先于计划扫描，避免漏掉被备份带走的候选）----
  const replayWarnings: string[] = [];
  replayJournal(scopeBase, replayWarnings);

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

  // ---- 计划半区（纯读；dry-run 到此为止）----
  const collisions: MigrateConflict[] = [];
  const targetEntities: MigrateCandidatePlan[] = [];
  const plannedProjections: MigrateCandidatePlan[] = [];
  const affectedRoots = new Set<string>();

  /** 已收编实体的 folderName -> logicalName */
  const recordedFolders = new Map<string, string>();
  for (const record of entities.values()) {
    recordedFolders.set(record.folderName, record.logicalName);
  }
  /** 候选间 sanitize 目标占用（候选间碰撞） */
  const claimedByCandidates = new Map<string, string>();

  if (lstatSafe(entityRoot) !== null) {
    for (const entry of readDirEntries(entityRoot)) {
      if (entry.name.startsWith(".")) continue; // 保留名/点目录不收编
      const dir = join(entityRoot, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const parsed = parseLegacyDir(dir);
      if (parsed === null) continue;
      if (recordedFolders.has(entry.name)) continue; // 已收编（entity-local 本体）
      const sanitizeTarget = sanitizeEntityFolderName(parsed.logicalName);
      const recorded = recordedFolders.get(sanitizeTarget);
      if (recorded !== undefined && recorded !== parsed.logicalName) {
        collisions.push({
          code: "NAME_COLLISION",
          path: dir,
          message: `logical name "${parsed.logicalName}" sanitizes to "${sanitizeTarget}", owned by entity "${recorded}"; original untouched`,
        });
        continue;
      }
      const rival = claimedByCandidates.get(sanitizeTarget);
      if (rival !== undefined) {
        collisions.push({
          code: "NAME_COLLISION",
          path: dir,
          message: `two legacy directories sanitize to "${sanitizeTarget}" (${rival}, ${dir}); both untouched — resolve manually`,
        });
        continue;
      }
      let hash: string;
      try {
        hash = await computeSkillFolderHash(dir);
      } catch (error) {
        collisions.push({
          code: "IO",
          path: dir,
          message: `legacy directory hash failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      claimedByCandidates.set(sanitizeTarget, dir);
      targetEntities.push({
        kind: "entity-adoption",
        path: dir,
        logicalName: parsed.logicalName,
        folderName: entry.name,
        hash,
        sanitizeTarget,
      });
      affectedRoots.add(entityRoot);
    }
  }

  // 投影根副本候选：显式 roots 上与候选/已收编实体同 folderName 的真实目录
  const convertibleFolders = new Set<string>([
    ...targetEntities.map((candidate) => candidate.folderName),
    ...recordedFolders.keys(),
  ]);
  for (const rawRoot of options.roots ?? []) {
    if (typeof rawRoot !== "string" || rawRoot.length === 0) continue;
    const rootPath = resolve(rawRoot);
    if (rootPath === resolve(entityRoot)) continue; // 实体根已在上面扫过
    if (lstatSafe(rootPath) === null) continue;
    for (const entry of readDirEntries(rootPath)) {
      if (!convertibleFolders.has(entry.name)) continue;
      const copyPath = join(rootPath, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      // 已注册 link 记录位上的真实目录 = 换体面（remove/GUARD_PROJECTION 管辖），
      // migrate 不收编换体内容；已注册 materialized 副本亦非 legacy
      const recordKey = `${projectionRootId(rootPath)}:${entry.name}`;
      if (projections.has(recordKey)) continue;
      const parsed = parseLegacyDir(copyPath);
      if (parsed === null) continue; // 无身份文件的目录 = 非 migrate 面
      let hash: string;
      try {
        hash = await computeSkillFolderHash(copyPath);
      } catch (error) {
        collisions.push({
          code: "IO",
          path: copyPath,
          message: `legacy copy hash failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      plannedProjections.push({
        kind: "projection-conversion",
        path: copyPath,
        logicalName: parsed.logicalName,
        folderName: entry.name,
        hash,
        root: rootPath,
        sanitizeTarget: sanitizeEntityFolderName(parsed.logicalName),
      });
      affectedRoots.add(rootPath);
    }
  }

  if (options.dryRun === true) {
    return {
      kind: "ok",
      dryRun: true,
      scope,
      targetEntities,
      plannedProjections,
      collisions,
      affectedRoots: [...affectedRoots].sort(),
    };
  }

  // ---- 执行半区：journal replay 已在计划前收敛 → 逐候选受守卫转换 ----
  const warnings: string[] = [...replayWarnings];

  const journal = readJournal(scopeBase);
  const adopted: MigrateAdopted[] = [];
  const converted: MigrateConverted[] = [];
  /** 计划回传优先（expected hash 守卫基准 = 计划值）；缺省 = 本次自计划 */
  const execTargetEntities = options.plan?.targetEntities ?? targetEntities;
  const execPlannedProjections = options.plan?.plannedProjections ?? plannedProjections;
  const conflicts: MigrateConflict[] = [...(options.plan?.collisions ?? collisions)];

  const newBackupPath = (): string =>
    join(scopeBase, `${MIGRATE_BACKUP_PREFIX}${Date.now()}-${randomBytes(4).toString("hex")}`);

  const addJournalEntry = (entry: JournalEntry): void => {
    journal.entries.push(entry);
    writeJournal(scopeBase, journal);
  };
  const removeJournalEntry = (id: string): void => {
    journal.entries = journal.entries.filter((e) => e.id !== id);
    writeJournal(scopeBase, journal);
  };

  // ---- 实体收编 ----
  for (const candidate of execTargetEntities) {
    // expected hash 守卫：执行期重 hash 对齐计划值（漂移 = 原件不动）
    const currentSt = lstatSafe(candidate.path);
    if (currentSt === null || currentSt.isSymbolicLink() || !currentSt.isDirectory()) {
      conflicts.push({
        code: "PATH_OCCUPIED",
        path: candidate.path,
        message: "legacy directory vanished or changed shape since plan; untouched",
      });
      continue;
    }
    let currentHash: string;
    try {
      currentHash = await computeSkillFolderHash(candidate.path);
    } catch (error) {
      conflicts.push({
        code: "IO",
        path: candidate.path,
        message: `hash failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (currentHash !== candidate.hash) {
      conflicts.push({
        code: "HASH_MISMATCH",
        path: candidate.path,
        message: `content changed since plan (plan ${candidate.hash.slice(0, 12)}, now ${currentHash.slice(0, 12)}); original untouched`,
      });
      continue;
    }
    // 换名候选的目标位检查（同名候选目标位 = 自身路径，由 ensureEntity 的 CAS 复核）
    const entityTargetPath = join(entityRoot, candidate.sanitizeTarget);
    if (candidate.sanitizeTarget !== candidate.folderName && lstatSafe(entityTargetPath) !== null) {
      conflicts.push({
        code: "PATH_OCCUPIED",
        path: candidate.path,
        message: `entity path ${entityTargetPath} is occupied; original untouched`,
      });
      continue;
    }

    // backup → ensureEntity（原语收编）→ 失败回滚
    const backupPath = newBackupPath();
    try {
      mkdirSync(scopeBase, { recursive: true });
      renameSync(candidate.path, backupPath);
    } catch (error) {
      conflicts.push({
        code: "IO",
        path: candidate.path,
        message: `backup rename failed (${error instanceof Error ? error.message : String(error)}); original untouched`,
      });
      continue;
    }
    const entryId = `${candidate.folderName}-${randomBytes(4).toString("hex")}`;
    addJournalEntry({
      id: entryId,
      kind: "entity",
      originalPath: candidate.path,
      backupPath,
      createdAt: new Date().toISOString(),
    });

    const ensured = await ensureEntity({
      scope,
      source: {
        dir: backupPath,
        source: candidate.path,
        sourceType: "legacy-migrate",
      },
      ...(options.userDir !== undefined ? { userDir: options.userDir } : {}),
      ...(options.workspaceDir !== undefined ? { workspaceDir: options.workspaceDir } : {}),
    });
    if (ensured.kind === "error") {
      // 回滚：原件复位，journal 收敛
      try {
        renameSync(backupPath, candidate.path);
      } catch (restoreError) {
        warnings.push(
          `rollback failed for ${candidate.path}: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }; legacy copy remains at ${backupPath}`
        );
      }
      removeJournalEntry(entryId);
      conflicts.push({
        code:
          ensured.code === "NAME_COLLISION"
            ? "NAME_COLLISION"
            : ensured.code === "ENTITY_SWAP_FAILED"
              ? "ENTITY_SWAP_FAILED"
              : "PROJECTION_FAILED",
        path: candidate.path,
        message: `ensureEntity failed (${ensured.code}): ${ensured.message}; original restored`,
      });
      continue;
    }
    // journal 收敛 + 备份清理（内容已复制进实体）
    removeJournalEntry(entryId);
    try {
      rmSync(backupPath, { recursive: true, force: true });
    } catch (error) {
      warnings.push(
        `legacy backup could not be deleted: ${backupPath} (${
          error instanceof Error ? error.message : String(error)
        })`
      );
    }
    adopted.push({
      logicalName: ensured.entity.logicalName,
      folderName: ensured.entity.folderName,
      entityPath: ensured.entity.path,
      revision: ensured.entity.revision,
      warnings: ensured.warnings,
    });
    recordedFolders.set(ensured.entity.folderName, ensured.entity.logicalName);
  }

  // ---- 投影转换：摘位（backup+journal）→ projectEntity 原语 → 失败回滚 ----
  for (const candidate of execPlannedProjections) {
    const entityLogical = recordedFolders.get(candidate.folderName);
    if (entityLogical === undefined) {
      conflicts.push({
        code: "PATH_OCCUPIED",
        path: candidate.path,
        message: `no known entity for folder "${candidate.folderName}" (adoption did not complete); copy untouched`,
      });
      continue;
    }
    const currentSt = lstatSafe(candidate.path);
    if (currentSt === null || currentSt.isSymbolicLink() || !currentSt.isDirectory()) {
      conflicts.push({
        code: "PATH_OCCUPIED",
        path: candidate.path,
        message: "legacy copy vanished or changed shape since plan; untouched",
      });
      continue;
    }
    let currentHash: string;
    try {
      currentHash = await computeSkillFolderHash(candidate.path);
    } catch (error) {
      conflicts.push({
        code: "IO",
        path: candidate.path,
        message: `hash failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (currentHash !== candidate.hash) {
      conflicts.push({
        code: "HASH_MISMATCH",
        path: candidate.path,
        message: `copy content changed since plan (plan ${candidate.hash.slice(0, 12)}, now ${currentHash.slice(0, 12)}); copy untouched`,
      });
      continue;
    }

    const backupPath = newBackupPath();
    try {
      renameSync(candidate.path, backupPath);
    } catch (error) {
      conflicts.push({
        code: "IO",
        path: candidate.path,
        message: `backup rename failed (${error instanceof Error ? error.message : String(error)}); copy untouched`,
      });
      continue;
    }
    const entryId = `proj-${candidate.folderName}-${randomBytes(4).toString("hex")}`;
    addJournalEntry({
      id: entryId,
      kind: "projection",
      originalPath: candidate.path,
      backupPath,
      createdAt: new Date().toISOString(),
    });

    const projected = await projectEntity({
      scope,
      name: entityLogical,
      roots: [candidate.root ?? candidate.path],
      ...(options.userDir !== undefined ? { userDir: options.userDir } : {}),
      ...(options.workspaceDir !== undefined ? { workspaceDir: options.workspaceDir } : {}),
    });
    const failedReceipt =
      projected.kind === "ok" ? projected.results.find((r) => r.status === "failed") : undefined;
    if (projected.kind === "error" || failedReceipt !== undefined) {
      // 回滚：副本复位
      try {
        renameSync(backupPath, candidate.path);
      } catch (restoreError) {
        warnings.push(
          `rollback failed for ${candidate.path}: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }; copy remains at ${backupPath}`
        );
      }
      removeJournalEntry(entryId);
      conflicts.push({
        code: "PROJECTION_FAILED",
        path: candidate.path,
        message: `projectEntity failed: ${
          projected.kind === "error" ? projected.message : (failedReceipt?.error ?? "unknown")
        }; copy restored`,
      });
      continue;
    }
    removeJournalEntry(entryId);
    try {
      rmSync(backupPath, { recursive: true, force: true });
    } catch (error) {
      warnings.push(
        `legacy copy backup could not be deleted: ${backupPath} (${
          error instanceof Error ? error.message : String(error)
        })`
      );
    }
    const receipt = projected.results[0];
    if (receipt !== undefined && receipt.mode !== undefined) {
      converted.push({
        logicalName: entityLogical,
        folderName: candidate.folderName,
        root: receipt.root,
        path: receipt.path,
        mode: receipt.mode === "entity-local" ? "materialized" : receipt.mode,
        ...(receipt.reason !== undefined ? { reason: receipt.reason } : {}),
      });
    }
  }

  const fresh = await store.read();
  const generation = fresh.kind === "ok" ? fresh.data.generation : base.generation;
  return {
    kind: "ok",
    dryRun: false,
    scope,
    adopted,
    converted,
    conflicts,
    affectedRoots: [...affectedRoots].sort(),
    journalPath: join(scopeBase, JOURNAL_FILENAME),
    generation,
    warnings,
  };
}
