/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「state repair = 扫描 vs sidecar diff 报告 + --confirm
 * （缺省 REPAIR_CONFIRM_REQUIRED）+ 预修复 state 备份 + 幂等（二跑 no-op 报 clean）
 * + 深度清扫（批 4 移交：无 marker staging/backup 残留的 repair 面收编，保守法则
 * 不破）」（批 5 tasks.md:44；spec: Explicit claim, repair, and gc contracts）
 * 正交意图：
 *   [1] diff 报告面：文件系统扫描 vs sidecar 逐类差异（孤儿记录/根消失/实体悬空/
 *       可认领链/legacy 目录/投影位被占/保留名残留）；扫描集 = 实体根 ∪ state 注册
 *       根 ∪ 显式 roots（永不猜路径）
 *   [2] 修复边界（g0 核对表 P5）：只写 ccski state（记录退役）+ 保留名残留清扫
 *       （维护面）；磁盘内容永不动——投影位被占/实体目录缺失/未注册链/legacy 目录
 *       全部 report-only（收编走 claim/migrate/remove 专属面）
 *   [3] --confirm 闸 + 预修复 state 备份（`.ccski-state-backup-<ts>.json`）+
 *       幂等（修复后二跑零修复零写入报 clean）；未确认路径零副作用（纯读 diff）
 *   [4] 深度清扫收编（批 4 移交）：--confirm 下删除「无 marker 且无 SKILL.md/
 *       .SKILL.md 身份文件」的保留名残留目录；携带身份文件的保留名目录 = 用户内容
 *       保守保留 report-only（保守法则不破）；marker 残留沿用批 2 条件（写者死/
 *       超龄），非目录残留一律不动
 * 妥协声明：实体悬空但有投影记录时不在 state 侧收敛（记录退役会让投影变孤儿，
 * 需人类决策），report-only；备份不自动轮转清理（量级 = 修复次数，人为管理）。
 */
import {
  type Dirent,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  CCSKI_RESIDUE_MARKER_FILENAME,
  type SweepReservedResult,
  isCcskiReservedName,
  sweepReservedResidues,
} from "../core/discovery.js";
import {
  type EntityRecord,
  type EntityScope,
  entityRootFor,
  parseEntityTable,
  parseProjectionTable,
  projectionRootId,
  resolveScopeBase,
} from "../core/entity-state.js";
import { CCSKI_STATE_FILENAME, StateStore, emptyState } from "../core/state-store.js";
import { lstatSafe, realpathSafe } from "./entity-guards.js";

export type RepairFailureCode =
  | "SCOPE_REQUIRED"
  | "STATE_RECOVERY_REQUIRED"
  | "STATE_GENERATION_CONFLICT"
  | "IO";

/** 差异条目码（finite；action = 修复器将采取的动作） */
export type RepairDiffCode =
  | "PROJECTION_RECORD_ORPHANED"
  | "ROOT_VANISHED"
  | "ENTITY_RECORD_DANGLING"
  | "UNREGISTERED_LINK_CLAIMABLE"
  | "LEGACY_DIR_NEEDS_MIGRATE"
  | "PROJECTION_PATH_OCCUPIED"
  | "ENTITY_DIR_MISSING"
  | "RESIDUE_MARKER"
  | "RESIDUE_UNMARKED";

export type RepairAction = "retire-record" | "delete-residue" | "none";

export interface RepairDiffItem {
  code: RepairDiffCode;
  path: string;
  detail: string;
  action: RepairAction;
  /** 修复执行后回填；report-only 条目恒 false/缺省 */
  fixed?: boolean;
  /** 残留清扫的形态来源 */
  sweepReason?: string;
}

export type RepairResult =
  | {
      kind: "confirm-required";
      code: "REPAIR_CONFIRM_REQUIRED";
      scope: EntityScope;
      diff: RepairDiffItem[];
      /** action !== "none" 的条目数（--confirm 后将被修复的数量） */
      repairable: number;
    }
  | {
      kind: "ok";
      scope: EntityScope;
      /** true = 无可修复差异（幂等二跑形态；未发生任何 state 写入） */
      clean: boolean;
      diff: RepairDiffItem[];
      repaired: number;
      /** 预修复 state 备份路径（仅实际提交修复时存在） */
      backupPath?: string;
      generation: number;
      warnings: string[];
    }
  | { kind: "error"; code: RepairFailureCode; message: string };

interface ScanEntry {
  name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
}

interface RepairScanTables {
  entities: Map<string, EntityRecord>;
  projections: ReturnType<typeof parseProjectionTable>["records"];
}

/** 扫描集：实体根 ∪ 注册 roots ∪ 显式 roots（永不猜路径） */
function collectScanRoots(
  tables: RepairScanTables,
  entityRoot: string,
  extraRoots: readonly string[]
): Set<string> {
  const roots = new Set<string>([resolve(entityRoot)]);
  for (const record of tables.projections.values()) {
    roots.add(resolve(record.rootPath));
  }
  for (const raw of extraRoots) {
    if (typeof raw === "string" && raw.length > 0) roots.add(resolve(raw));
  }
  return roots;
}

/** 保留名残留目录是否携带技能身份文件（保守法则：身份内容永不自动删除） */
function residueHasIdentityFile(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md")) || existsSync(join(dir, ".SKILL.md"));
}

/** 只读读取残留 marker（批 2 定义的 `.ccski-residue.json` 形态） */
function readResidueMarker(dir: string): { pid: number; createdAt: number } | null {
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const pid = (parsed as Record<string, unknown>).pid;
  const createdAt = (parsed as Record<string, unknown>).createdAt;
  if (typeof pid !== "number" || !Number.isInteger(pid)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  return { pid, createdAt };
}

function readlinkSafeOrNull(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 只读残留分类（未确认路径的纯读报告；确认路径复用批 2 sweep 执行删除） */
function classifyResiduesReadOnly(
  rootPath: string,
  maxAgeMs: number
): Array<{
  path: string;
  name: string;
  kind: "staging" | "backup";
  outcome: "sweepable" | "deep-candidate" | "kept";
  reason: string;
}> {
  const out: Array<{
    path: string;
    name: string;
    kind: "staging" | "backup";
    outcome: "sweepable" | "deep-candidate" | "kept";
    reason: string;
  }> = [];
  let entries: Array<Dirent>;
  try {
    entries = readdirSync(rootPath, { withFileTypes: true }) as never;
  } catch {
    return out;
  }
  for (const entry of entries) {
    const kind = entry.name.startsWith(".ccski-staging-")
      ? "staging"
      : entry.name.startsWith(".ccski-backup-")
        ? "backup"
        : null;
    if (kind === null || !isCcskiReservedName(entry.name)) continue;
    const fullPath = join(rootPath, entry.name);
    let st: ReturnType<typeof lstatSafe>;
    try {
      st = lstatSafe(fullPath);
    } catch {
      // P1-E：无法观察 → kept（清扫面永不对读不了的条目下手）
      out.push({
        path: fullPath,
        name: entry.name,
        kind,
        outcome: "kept",
        reason: "unreadable",
      });
      continue;
    }
    if (st === null || !st.isDirectory()) {
      out.push({
        path: fullPath,
        name: entry.name,
        kind,
        outcome: "kept",
        reason: "non-directory",
      });
      continue;
    }
    const marker = readResidueMarker(fullPath);
    if (marker === null) {
      if (residueHasIdentityFile(fullPath)) {
        out.push({
          path: fullPath,
          name: entry.name,
          kind,
          outcome: "kept",
          reason: "no-marker-identity",
        });
      } else {
        out.push({
          path: fullPath,
          name: entry.name,
          kind,
          outcome: "deep-candidate",
          reason: "no-marker",
        });
      }
      continue;
    }
    const writerDead = marker.pid !== process.pid && !isPidAlive(marker.pid);
    const aged = Date.now() - marker.createdAt > maxAgeMs;
    out.push({
      path: fullPath,
      name: entry.name,
      kind,
      outcome: writerDead || aged ? "sweepable" : "kept",
      reason: writerDead ? "writer-dead" : aged ? "aged" : "writer-alive",
    });
  }
  return out;
}

/** P1-E：路径无法观察（EACCES/EIO 上抛）→ typed IO 拒绝整个 repair——不可验证的
 * 路径绝不产生「记录退役」提案（无法观察 ≠ 消失/缺席）。 */
function unreadableRepairResult(
  path: string,
  error: unknown
): { kind: "error"; code: "IO"; message: string } {
  return {
    kind: "error",
    code: "IO",
    message: `failed to inspect ${path} (${error instanceof Error ? error.message : String(error)}); repair refused — unverifiable paths never produce retirement diffs`,
  };
}

/**
 * state repair（spec: Explicit claim, repair, and gc contracts）。扫描 vs sidecar
 * diff → 报告；有可修复差异且未 --confirm → confirm-required（REPAIR_CONFIRM_
 * REQUIRED，纯读零副作用）；--confirm → 预修复 state 备份 + 单次 CAS 退役记录 +
 * 保留名残留清扫（marker 条件 + 无 marker 无身份文件的深度清扫收编）；修复后二跑
 * clean 零写入（幂等钉值）。
 */
export async function repairState(options: {
  scope?: EntityScope;
  confirm?: boolean;
  /** 显式补充扫描 roots（SDK/CLI 注入；缺省 = 实体根 ∪ 注册 roots） */
  roots?: readonly string[];
  /** 残留龄期兜底（毫秒；沿用批 2 清扫语义。默认 10000） */
  residueMaxAgeMs?: number;
  userDir?: string;
  workspaceDir?: string;
}): Promise<RepairResult> {
  if (options.scope !== "global" && options.scope !== "project") {
    return {
      kind: "error",
      code: "SCOPE_REQUIRED",
      message: 'state repair requires an explicit scope: "global" | "project".',
    };
  }
  const scope: EntityScope = options.scope;
  const scopeBase = resolveScopeBase(scope, options);
  const entityRoot = entityRootFor(scopeBase);
  const entityRootResolved = resolve(entityRoot);
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
  const tables: RepairScanTables = {
    entities: parseEntityTable(base.entities).records,
    projections: parseProjectionTable(base.projections).records,
  };

  const diff: RepairDiffItem[] = [];
  const recordRetireKeys: string[] = [];
  const entityRetireKeys: string[] = [];
  const residueDeletes: string[] = [];
  const foldersWithProjections = new Set<string>();
  for (const record of tables.projections.values()) {
    foldersWithProjections.add(record.folderName);
  }

  // ---- 投影记录 vs 磁盘 ----
  for (const [key, record] of tables.projections) {
    let rootSt: ReturnType<typeof lstatSafe>;
    try {
      rootSt = lstatSafe(record.rootPath);
    } catch (error) {
      // P1-E：根无法观察 ≠ 消失——绝不据此退役记录，typed IO 拒绝整个 repair
      return unreadableRepairResult(record.rootPath, error);
    }
    if (rootSt === null) {
      diff.push({
        code: "ROOT_VANISHED",
        path: record.rootPath,
        detail: `projection root vanished; retiring ${record.mode} record for "${record.logicalName}"`,
        action: "retire-record",
      });
      recordRetireKeys.push(key);
      continue;
    }
    let projSt: ReturnType<typeof lstatSafe>;
    try {
      projSt = lstatSafe(record.path);
    } catch (error) {
      return unreadableRepairResult(record.path, error);
    }
    if (projSt !== null) continue; // 投影位有内容：形态核对在下方（report-only）
    if (record.mode === "link" && record.disabled) continue; // 禁用链缺席 = 禁用的物理形态
    diff.push({
      code: "PROJECTION_RECORD_ORPHANED",
      path: record.path,
      detail: `enabled ${record.mode} projection record exists but the path is absent; retiring the record`,
      action: "retire-record",
    });
    recordRetireKeys.push(key);
  }

  // ---- 投影位被占（report-only：磁盘内容永不动）----
  for (const record of tables.projections.values()) {
    let projSt: ReturnType<typeof lstatSafe>;
    try {
      projSt = lstatSafe(record.path);
    } catch (error) {
      return unreadableRepairResult(record.path, error);
    }
    if (projSt === null || record.mode !== "link") continue;
    const raw = readlinkSafeOrNull(record.path);
    if (projSt.isSymbolicLink() && raw !== null) continue; // 链在位：归属判定属 remove/update 面
    diff.push({
      code: "PROJECTION_PATH_OCCUPIED",
      path: record.path,
      detail: `recorded link projection path is now ${
        projSt.isDirectory()
          ? "a real directory"
          : projSt.isSymbolicLink()
            ? "a symlink to a different target"
            : "a non-directory entry"
      }; not auto-touched (repair never deletes disk content; removal goes through remove with GUARD_PROJECTION semantics)`,
      action: "none",
    });
  }

  // ---- 实体记录 vs 磁盘 ----
  for (const [key, entity] of tables.entities) {
    let entitySt: ReturnType<typeof lstatSafe>;
    try {
      entitySt = lstatSafe(entity.path);
    } catch (error) {
      // P1-E：实体路径无法观察 ≠ 缺席——不判 dangling，typed IO 拒绝
      return unreadableRepairResult(entity.path, error);
    }
    if (entitySt !== null && !entitySt.isSymbolicLink() && entitySt.isDirectory()) continue;
    if (!foldersWithProjections.has(entity.folderName)) {
      diff.push({
        code: "ENTITY_RECORD_DANGLING",
        path: entity.path,
        detail: `entity record for "${entity.logicalName}" has no directory and no projection records; retiring the record`,
        action: "retire-record",
      });
      entityRetireKeys.push(key);
    } else {
      diff.push({
        code: "ENTITY_DIR_MISSING",
        path: entity.path,
        detail: `entity directory for "${entity.logicalName}" is missing while projection records remain; not auto-repaired (retiring the entity record would orphan projections — decide via remove/migrate)`,
        action: "none",
      });
    }
  }

  // ---- 磁盘 vs sidecar（扫描集上的未注册条目，report-only）----
  const scanRoots = collectScanRoots(tables, entityRoot, options.roots ?? []);
  for (const rootPath of scanRoots) {
    let rootScanable: boolean;
    try {
      rootScanable = lstatSafe(rootPath) !== null;
    } catch (error) {
      return unreadableRepairResult(rootPath, error);
    }
    if (!rootScanable) continue;
    let entries: ScanEntry[];
    try {
      entries = readdirSync(rootPath, { withFileTypes: true }) as never;
    } catch {
      continue;
    }
    const isEntityRoot = rootPath === entityRootResolved;
    for (const entry of entries) {
      const entryPath = join(rootPath, entry.name);
      if (isCcskiReservedName(entry.name)) continue; // 残留面在下方统一处理
      const entity = tables.entities.get(entry.name);
      if (entity !== undefined) {
        const entityReal = realpathSafe(entity.path);
        if (entry.isSymbolicLink()) {
          const rawTarget = readlinkSafeOrNull(entryPath);
          const linkReal = realpathSafe(entryPath);
          const matches =
            (entityReal !== null && linkReal !== null && linkReal === entityReal) ||
            (rawTarget !== null && resolve(rootPath, rawTarget) === resolve(entity.path));
          if (!matches) continue;
          const recordKey = `${projectionRootId(rootPath)}:${entity.folderName}`;
          if (tables.projections.has(recordKey)) continue; // 已注册；stale 呈现属发现层报告面
          diff.push({
            code: "UNREGISTERED_LINK_CLAIMABLE",
            path: entryPath,
            detail: `unregistered symlink pointing at ccski entity "${entity.logicalName}"; adopt via import --claim with inode+hash guards (repair never claims implicitly)`,
            action: "none",
          });
        } else if (
          !isEntityRoot &&
          entry.isDirectory() &&
          entityReal !== null &&
          realpathSafe(entryPath) === entityReal
        ) {
          diff.push({
            code: "LEGACY_DIR_NEEDS_MIGRATE",
            path: entryPath,
            detail: `unregistered real directory matching ccski entity "${entity.logicalName}" at a projection root; adoption belongs to migrate`,
            action: "none",
          });
        }
        continue;
      }
      // 无实体记录：实体根上的真实技能目录 = migrate 收编候选（永不自动转换）
      if (isEntityRoot && entry.isDirectory() && existsSync(join(entryPath, "SKILL.md"))) {
        diff.push({
          code: "LEGACY_DIR_NEEDS_MIGRATE",
          path: entryPath,
          detail:
            "unregistered legacy skill directory at the entity root; adoption belongs to migrate (legacy directories are never auto-converted)",
          action: "none",
        });
      }
    }
  }

  // ---- 保留名残留（未确认 = 纯读分类；确认 = 批 2 sweep + 深度清扫）----
  const maxAgeMs = options.residueMaxAgeMs ?? 10_000;
  const warnings: string[] = [];
  if (options.confirm === true) {
    for (const rootPath of scanRoots) {
      if (lstatSafe(rootPath) === null) continue;
      const swept: SweepReservedResult = sweepReservedResidues(rootPath, { maxAgeMs });
      for (const removed of swept.removed) {
        diff.push({
          code: "RESIDUE_MARKER",
          path: removed.path,
          detail: `ccski-marked residue met sweep conditions and was swept by the maintenance pass`,
          action: "none",
          fixed: true,
          sweepReason: "marker-condition-sweep",
        });
      }
      for (const kept of swept.kept) {
        if (kept.reason === "no-marker") {
          const st = lstatSafe(kept.path);
          if (st !== null && st.isDirectory() && !residueHasIdentityFile(kept.path)) {
            diff.push({
              code: "RESIDUE_UNMARKED",
              path: kept.path,
              detail:
                "reserved-name residue without ccski marker and without SKILL.md identity; deep sweep deletes it under --confirm (identity-carrying residues are always preserved)",
              action: "delete-residue",
              sweepReason: "no-marker-deep-sweep",
            });
            residueDeletes.push(kept.path);
          } else {
            diff.push({
              code: "RESIDUE_UNMARKED",
              path: kept.path,
              detail:
                "reserved-name entry carries no ccski marker but holds skill identity files; conservative law keeps it (never deleted without an explicit human decision)",
              action: "none",
            });
          }
        } else if (kept.reason !== "writer-alive") {
          diff.push({
            code: "RESIDUE_MARKER",
            path: kept.path,
            detail: `ccski-marked residue kept by sweep conditions (${kept.reason}${kept.detail !== undefined ? `: ${kept.detail}` : ""}); not forced by repair`,
            action: "none",
          });
        }
      }
    }
  } else {
    for (const rootPath of scanRoots) {
      if (lstatSafe(rootPath) === null) continue;
      for (const residue of classifyResiduesReadOnly(rootPath, maxAgeMs)) {
        if (residue.outcome === "deep-candidate") {
          diff.push({
            code: "RESIDUE_UNMARKED",
            path: residue.path,
            detail:
              "reserved-name residue without ccski marker and without SKILL.md identity; deep sweep would delete it under --confirm",
            action: "delete-residue",
            sweepReason: "no-marker-deep-sweep",
          });
          residueDeletes.push(residue.path);
        } else if (residue.outcome === "sweepable") {
          diff.push({
            code: "RESIDUE_MARKER",
            path: residue.path,
            detail: `ccski-marked residue satisfies sweep conditions (${residue.reason}); swept when repair runs with --confirm`,
            action: "none",
            sweepReason: "marker-condition-sweep",
          });
        } else {
          diff.push({
            code: "RESIDUE_UNMARKED",
            path: residue.path,
            detail: `reserved-name entry kept by conservative sweep law (${residue.reason}); repair never forces it`,
            action: "none",
          });
        }
      }
    }
  }

  const repairable = recordRetireKeys.length + entityRetireKeys.length + residueDeletes.length;

  if (repairable === 0) {
    return {
      kind: "ok",
      scope,
      clean: true,
      diff,
      repaired: 0,
      generation: base.generation,
      warnings,
    };
  }

  if (options.confirm !== true) {
    return {
      kind: "confirm-required",
      code: "REPAIR_CONFIRM_REQUIRED",
      scope,
      diff,
      repairable,
    };
  }

  // ---- 预修复 state 备份（spec: write a pre-repair state backup）----
  const statePath = join(scopeBase, CCSKI_STATE_FILENAME);
  const backupPath = `${statePath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (existsSync(statePath)) {
    try {
      copyFileSync(statePath, backupPath);
    } catch (error) {
      return {
        kind: "error",
        code: "IO",
        message: `failed to write pre-repair state backup ${backupPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  } else {
    warnings.push(
      "state file absent; repair retires records from an in-memory empty baseline (nothing to back up)"
    );
  }

  // ---- 残留清扫（磁盘半区；失败逐条如实保留）----
  let fixedResidues = 0;
  for (const residuePath of residueDeletes) {
    try {
      rmSync(residuePath, { recursive: true });
      fixedResidues += 1;
      const item = diff.find((d) => d.path === residuePath && d.action === "delete-residue");
      if (item) item.fixed = true;
    } catch (error) {
      warnings.push(
        `residue deletion failed (${residuePath}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // ---- state 退役（单次 CAS）----
  const commit = await commitRetire(store, recordRetireKeys, entityRetireKeys);
  let generation = base.generation;
  if (commit.kind === "committed") {
    generation = commit.generation;
    for (const item of diff) {
      if (item.action === "retire-record") item.fixed = true;
    }
  } else if (commit.kind === "recovery-required") {
    return {
      kind: "error",
      code: "STATE_RECOVERY_REQUIRED",
      message: `repair did not commit: state degraded read-only (${commit.detail}); residue cleanup already applied (${fixedResidues}/${residueDeletes.length})`,
    };
  } else {
    return {
      kind: "error",
      code: "STATE_GENERATION_CONFLICT",
      message: `repair did not commit: ${
        commit.kind === "rejected" ? commit.message : "state commit exhausted generation retries"
      }; residue cleanup already applied (${fixedResidues}/${residueDeletes.length}); re-run repair`,
    };
  }

  const repaired = fixedResidues + recordRetireKeys.length + entityRetireKeys.length;
  return {
    kind: "ok",
    scope,
    clean: false,
    diff,
    repaired,
    backupPath,
    generation,
    warnings,
  };
}

/** state 退役 CAS：显式键删除（raw 不兼容条目仍原样保留）；冲突重读重试 */
async function commitRetire(
  store: StateStore,
  recordKeys: readonly string[],
  entityKeys: readonly string[]
): Promise<
  | { kind: "committed"; generation: number }
  | { kind: "recovery-required"; detail: string }
  | { kind: "conflict-exhausted" }
  | { kind: "rejected"; message: string }
> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await store.read();
    if (read.kind === "recovery-required") {
      return { kind: "recovery-required", detail: read.detail };
    }
    const base = read.kind === "ok" ? read.data : emptyState();
    const entities = { ...base.entities };
    const projections = { ...base.projections };
    for (const key of recordKeys) delete projections[key];
    for (const key of entityKeys) delete entities[key];
    const result = await store.commit(base, { entities, projections });
    if (result.kind === "committed") {
      return { kind: "committed", generation: result.data.generation };
    }
    if (result.kind === "recovery-required") {
      return { kind: "recovery-required", detail: result.detail };
    }
    // conflict → 重读重建再试（禁盲覆盖）
  }
  return { kind: "conflict-exhausted" };
}
