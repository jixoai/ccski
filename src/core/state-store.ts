/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「.ccski-state.json 写入协议（tmp+fsync+rename + generation CAS + STATE_GENERATION_CONFLICT）」+「部分写/损坏/未知版本 → 只读降级 STATE_RECOVERY_REQUIRED（repair CLI 批 5，本批只做检测与 typed 错误）」
 * 正交意图：
 *   [1] ccski 单写者 state 读写层（spec: Layered single writers for lock and state）：
 *       同目录 tmp + fsync + rename 原子提交；generation 单调递增 CAS
 *   [2] 损坏/未知版本/部分写的只读降级检测（STATE_RECOVERY_REQUIRED）——
 *       本批只做检测与 typed 错误，repair CLI 在批 5
 *   [3] 跨进程互斥锁（O_EXCL + pid 活性窃取）：关闭「CAS 校验 → rename」之间的
 *       竞态窗口，保证并发提交无静默丢写
 * 妥协声明：state 载荷仅本批最小面（generation + 空 entities/projections 表骨架），
 * 领域字段批 3/4 随 API 扩——不做提前抽象。文件系统故障（EACCES/EIO 等）硬失败，
 * 不降级为空态（safeParse 只识别数据不兼容，不吞 IO 故障）。
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

import { CcskiError } from "../types/errors.js";

/** state 文件名（置于 scopeBase 下：global `$HOME/.agents` | project `<workspace>/.agents`） */
export const CCSKI_STATE_FILENAME = ".ccski-state.json";

/** 当前 state schema 版本；破坏性更新只在此值上前进（无兼容策略） */
export const CCSKI_STATE_SCHEMA_VERSION = 1;

/** ccski-owned state 载荷（本批最小面；领域字段批 3/4 随 API 扩） */
export interface CcskiStateData {
  schemaVersion: number;
  /** 单调递增代次；CAS 的比较基准 */
  generation: number;
  entities: Record<string, unknown>;
  projections: Record<string, unknown>;
}

export type StateRecoveryReason = "corrupt-json" | "unknown-version" | "schema-invalid";

export type StateReadResult =
  | { kind: "ok"; data: CcskiStateData }
  /** 文件不存在（首次写入前的合法基线，不是损坏） */
  | { kind: "absent" }
  | {
      kind: "recovery-required";
      code: "STATE_RECOVERY_REQUIRED";
      reason: StateRecoveryReason;
      detail: string;
    };

export interface StateCommitUpdate {
  entities: Record<string, unknown>;
  projections: Record<string, unknown>;
}

export type StateCommitResult =
  | { kind: "committed"; data: CcskiStateData }
  | {
      kind: "conflict";
      code: "STATE_GENERATION_CONFLICT";
      /** 冲突后的重读结果；调用方以 `reread` 重读重试，禁止盲覆盖 */
      reread: StateReadResult;
    }
  | {
      kind: "recovery-required";
      code: "STATE_RECOVERY_REQUIRED";
      reason: StateRecoveryReason;
      detail: string;
    };

export interface StateStoreOptions {
  /** 锁获取总预算（毫秒）；默认 5000 */
  lockTimeoutMs?: number;
  /** 锁残留兜底龄期（毫秒）；持有进程 pid 已死则立即窃取，此龄期兜底。默认 10000 */
  lockStaleMs?: number;
}

/** state-store 的硬失败（IO 故障、锁超时、非法入参）；数据不兼容不走此通道 */
export class StateStoreError extends CcskiError {
  constructor(
    public readonly code: "IO" | "LOCK_TIMEOUT" | "INVALID_EXPECTED" | "INVALID_UPDATE",
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "StateStoreError";
  }
}

const stateDataSchema = z
  .object({
    schemaVersion: z.number().int(),
    generation: z.number().int().nonnegative(),
    entities: z.record(z.string(), z.unknown()),
    projections: z.record(z.string(), z.unknown()),
  })
  .strict();

const stateTablesSchema = z.object({
  entities: z.record(z.string(), z.unknown()),
  projections: z.record(z.string(), z.unknown()),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 首次写入前的合法基线（generation 0） */
export function emptyState(): CcskiStateData {
  return {
    schemaVersion: CCSKI_STATE_SCHEMA_VERSION,
    generation: 0,
    entities: {},
    projections: {},
  };
}

/**
 * 读取单个 state 文件（无清扫副作用）。ENOENT → absent；JSON/Zod 不兼容 →
 * 只读降级（STATE_RECOVERY_REQUIRED）；其余 IO 故障 → StateStoreError 硬失败。
 */
export async function readCcskiStateFile(statePath: string): Promise<StateReadResult> {
  let text: string;
  try {
    text = await readFile(statePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "absent" };
    throw new StateStoreError("IO", `failed to read state file ${statePath}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return recovery("corrupt-json", `state file is not valid JSON: ${statePath} (${detail})`);
  }
  if (!isRecord(parsed)) {
    return recovery("schema-invalid", "state payload is not a JSON object");
  }
  const version = parsed.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return recovery("schema-invalid", "state payload has no integer schemaVersion");
  }
  if (version !== CCSKI_STATE_SCHEMA_VERSION) {
    return recovery(
      "unknown-version",
      `state schemaVersion ${version} is not supported (supported: ${CCSKI_STATE_SCHEMA_VERSION})`
    );
  }
  const parsedState = stateDataSchema.safeParse(parsed);
  if (!parsedState.success) {
    return recovery(
      "schema-invalid",
      `state payload does not match schema v${CCSKI_STATE_SCHEMA_VERSION}: ${parsedState.error.message}`
    );
  }
  return { kind: "ok", data: parsedState.data };
}

function recovery(
  reason: StateRecoveryReason,
  detail: string
): {
  kind: "recovery-required";
  code: "STATE_RECOVERY_REQUIRED";
  reason: StateRecoveryReason;
  detail: string;
} {
  return { kind: "recovery-required", code: "STATE_RECOVERY_REQUIRED", reason, detail };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

// ---------------------------------------------------------------------------
// 跨进程锁：O_EXCL 独占创建 + pid 活性窃取
// ---------------------------------------------------------------------------

interface StateLockPayload {
  pid: number;
  acquiredAt: number;
}

export interface StateLockHandle {
  path: string;
  release(): Promise<void>;
}

/** holder 进程是否存活；EPERM（无权信号）视为存活 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "EPERM") return true;
    return false;
  }
}

async function readLockPayload(lockPath: string): Promise<StateLockPayload | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lockPath, "utf8"));
    if (!isRecord(parsed)) return null;
    const pid = parsed.pid;
    const acquiredAt = parsed.acquiredAt;
    if (typeof pid !== "number" || typeof acquiredAt !== "number") return null;
    return { pid, acquiredAt };
  } catch {
    return null; // 锁文件残缺 = 无主残留，可窃取
  }
}

/**
 * 独占锁（`<state>.lock`，O_EXCL 原子创建）。持锁者死亡（如 kill -9 残留）由
 * pid 活性检查立即窃取，龄期兜底；预算耗尽抛 StateStoreError("LOCK_TIMEOUT")。
 * 供 StateStore 内部与批 1 崩溃收据测试（crash-point 组合）使用；不在包根导出。
 */
export async function acquireStateLock(
  lockPath: string,
  options: Required<Pick<StateStoreOptions, "lockTimeoutMs" | "lockStaleMs">>
): Promise<StateLockHandle> {
  const deadline = Date.now() + options.lockTimeoutMs;
  for (;;) {
    const payload: StateLockPayload = { pid: process.pid, acquiredAt: Date.now() };
    try {
      const fh = await open(lockPath, "wx");
      try {
        await fh.writeFile(JSON.stringify(payload), "utf8");
      } finally {
        await fh.close();
      }
      return {
        path: lockPath,
        release: async () => {
          await unlink(lockPath).catch((error: unknown) => {
            if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
          });
        },
      };
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw new StateStoreError("IO", `failed to acquire state lock ${lockPath}`, error);
      }
    }

    const holder = await readLockPayload(lockPath);
    const ageMs = holder ? Date.now() - holder.acquiredAt : Infinity;
    // 持有者存活（含本进程的其他并发操作）即等待——同进程互斥同样不可豁免，
    // 否则两条并发 commit 的「校验 → rename」窗口会交叠、静默丢写。
    // 只有 holder 死亡（kill -9 残留）、锁文件残缺或超龄才窃取。
    const holderStale = holder === null || !isPidAlive(holder.pid) || ageMs > options.lockStaleMs;
    if (holderStale) {
      await unlink(lockPath).catch((staleError: unknown) => {
        if (!(isNodeError(staleError) && staleError.code === "ENOENT")) {
          throw new StateStoreError(
            "IO",
            `failed to steal stale state lock ${lockPath}`,
            staleError
          );
        }
      });
      continue;
    }

    if (Date.now() >= deadline) {
      throw new StateStoreError(
        "LOCK_TIMEOUT",
        `state lock ${lockPath} held by live pid ${holder?.pid ?? "unknown"}; gave up after ${options.lockTimeoutMs}ms`
      );
    }
    await sleep(10);
  }
}

// ---------------------------------------------------------------------------
// 原子写入原语：stage（tmp + fsync）→ finalize（rename + 目录 fsync）
// 分两段导出供崩溃收据测试在真实代码路径内注入 SIGKILL 点；不在包根导出。
// ---------------------------------------------------------------------------

function serializeState(data: CcskiStateData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

const TMP_NAME_PATTERN = /^\.ccski-state\.json\.tmp-(\d+)-[0-9a-f]+$/;

/** 段一：序列化写同目录 tmp 文件并 fsync；rename 前的崩溃只会留下可清扫的 tmp 残留 */
export async function stageStateWrite(
  statePath: string,
  data: CcskiStateData
): Promise<{ tmpPath: string }> {
  const tmpPath = join(
    dirname(statePath),
    `${CCSKI_STATE_FILENAME}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`
  );
  const fh = await open(tmpPath, "wx").catch((error: unknown) => {
    throw new StateStoreError("IO", `failed to create state temp file ${tmpPath}`, error);
  });
  try {
    await fh.writeFile(serializeState(data), "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  return { tmpPath };
}

/** 段二：rename 原子生效 + 目录 fsync（目录 fsync 在不支持的平台尽力而为） */
export async function finalizeStateWrite(
  statePath: string,
  staged: { tmpPath: string }
): Promise<void> {
  await rename(staged.tmpPath, statePath).catch((error: unknown) => {
    throw new StateStoreError("IO", `failed to commit state file ${statePath}`, error);
  });
  try {
    const dirHandle = await open(dirname(statePath), "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // win32 等平台不允许对目录 fsync；rename 已对同机后续进程可见，
    // 掉电持久性由文件级 fsync + 同目录 rename 尽力保证（批 6 Windows 门复核）。
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `.ccski-state.json` 单写者读写层。scopeBase = global `$HOME/.agents` |
 * project `<workspace>/.agents`；state 文件固定为 `<scopeBase>/.ccski-state.json`。
 */
export class StateStore {
  readonly statePath: string;
  private readonly lockPath: string;
  private readonly options: Required<StateStoreOptions>;

  constructor(
    readonly scopeBase: string,
    options: StateStoreOptions = {}
  ) {
    this.statePath = join(scopeBase, CCSKI_STATE_FILENAME);
    this.lockPath = `${this.statePath}.lock`;
    this.options = {
      lockTimeoutMs: options.lockTimeoutMs ?? 5_000,
      lockStaleMs: options.lockStaleMs ?? 10_000,
    };
  }

  /**
   * 读取 state。先清扫死进程留下的 tmp 残留（kill -9 中断写后下次读的恢复入口），
   * 再读文件。数据不兼容 → 只读降级结果，绝不抛出；IO 故障 → 硬失败。
   */
  async read(): Promise<StateReadResult> {
    await this.sweepTmpResidue();
    return readCcskiStateFile(this.statePath);
  }

  /**
   * generation CAS 提交：锁内校验 on-disk generation === expected.generation，
   * 以 expected.generation + 1 原子写入。代次变化 → STATE_GENERATION_CONFLICT
   * （附重读结果，调用方重读重试）；on-disk 数据不兼容 → STATE_RECOVERY_REQUIRED，
   * 拒绝盲覆盖。expected 必须来自同版本的一次真实读取（首次写入用 emptyState()）。
   */
  async commit(expected: CcskiStateData, update: StateCommitUpdate): Promise<StateCommitResult> {
    const expectedCheck = stateDataSchema.safeParse(expected);
    if (!expectedCheck.success || expectedCheck.data.schemaVersion !== CCSKI_STATE_SCHEMA_VERSION) {
      throw new StateStoreError(
        "INVALID_EXPECTED",
        "commit baseline must be a v1 state previously obtained from read()/commit()"
      );
    }
    const updateCheck = stateTablesSchema.safeParse(update);
    if (!updateCheck.success) {
      throw new StateStoreError(
        "INVALID_UPDATE",
        "commit update must carry entities/projections records"
      );
    }

    await mkdir(this.scopeBase, { recursive: true }).catch((error: unknown) => {
      throw new StateStoreError("IO", `failed to ensure scope base ${this.scopeBase}`, error);
    });
    await this.sweepTmpResidue();

    const lock = await acquireStateLock(this.lockPath, this.options);
    try {
      const fresh = await readCcskiStateFile(this.statePath);
      if (fresh.kind === "recovery-required") {
        return {
          kind: "recovery-required",
          code: fresh.code,
          reason: fresh.reason,
          detail: fresh.detail,
        };
      }
      const onDiskGeneration = fresh.kind === "ok" ? fresh.data.generation : 0;
      if (onDiskGeneration !== expected.generation) {
        return { kind: "conflict", code: "STATE_GENERATION_CONFLICT", reread: fresh };
      }
      const next: CcskiStateData = {
        schemaVersion: CCSKI_STATE_SCHEMA_VERSION,
        generation: expected.generation + 1,
        entities: update.entities,
        projections: update.projections,
      };
      const staged = await stageStateWrite(this.statePath, next);
      await finalizeStateWrite(this.statePath, staged);
      return { kind: "committed", data: next };
    } finally {
      await lock.release();
    }
  }

  /** 清扫 kill -9 残留 tmp：仅精确命名、写者 pid 已死或超过兜底龄期的文件 */
  private async sweepTmpResidue(): Promise<void> {
    const entries = await readdir(this.scopeBase, { withFileTypes: true }).catch(
      () => null // scopeBase 尚不存在 = 无残留
    );
    if (entries === null) return;
    for (const entry of entries) {
      const match = TMP_NAME_PATTERN.exec(entry.name);
      if (!match || !entry.isFile()) continue;
      const tmpPath = join(this.scopeBase, entry.name);
      const writerPid = Number(match[1]);
      const residue = await stat(tmpPath).catch(() => null);
      if (residue === null) continue;
      const writerDead = writerPid !== process.pid && !isPidAlive(writerPid);
      const aged = Date.now() - residue.mtimeMs > this.options.lockStaleMs;
      if (writerDead || aged) {
        await unlink(tmpPath).catch(() => undefined); // 尽力而为的维护
      }
    }
  }
}
