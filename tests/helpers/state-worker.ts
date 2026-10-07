/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「state-store recovery primitive 收据：双进程竞争、kill -9 恢复、部分写降级——真信号真进程，不 mock」
 * 正交意图：
 *   [1] G1 门跨进程 worker：由 vitest 测试以 tsx 拉起的独立进程，执行四类任务
 *       （cas 双进程对打 / crash-before-rename 定点 SIGKILL / partial-write 半截写
 *       SIGKILL / spin 连续提交风暴），stdout 回 JSON 收据
 *   [2] 崩溃点注入在 worker 侧（组合生产原语 stageStateWrite 后自杀），
 *       生产代码零测试钩子
 * 妥协声明：无。任务名 = argv[2]，任务参数 = argv[3]（JSON）。
 */
import { closeSync, existsSync, openSync, writeFileSync, writeSync } from "node:fs";

import {
  StateStore,
  acquireStateLock,
  emptyState,
  readCcskiStateFile,
  stageStateWrite,
} from "../../src/core/state-store.js";

interface CasArgs {
  scopeBase: string;
  marker: string;
  readyFile: string;
  goFile: string;
}

interface CrashArgs {
  scopeBase: string;
  crashedFile: string;
}

interface PartialWriteArgs {
  statePath: string;
  fullText: string;
  halfBytes: number;
  crashedFile: string;
}

interface SpinArgs {
  scopeBase: string;
  /** 到点即对自身 SIGKILL（模拟风暴中的写者死亡）；安全上限 20s */
  dieAtMs: number;
}

function fail(message: string): never {
  process.stderr.write(`state-worker failure: ${message}\n`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) fail(`timed out waiting for ${path}`);
    await sleep(5);
  }
}

/** cas：读基线 → ready 屏障 → go 信号后对打提交；冲突则重读重试（上限 5 次） */
async function runCas(args: CasArgs): Promise<void> {
  const store = new StateStore(args.scopeBase);
  const initial = await store.read();
  if (initial.kind !== "ok") fail(`cas baseline not ok: ${initial.kind}`);

  writeFileSync(args.readyFile, String(initial.data.generation));
  await waitForFile(args.goFile, 15_000);

  let firstOutcome: string | null = null;
  let attempts = 0;
  let generation = -1;
  while (attempts < 5) {
    const current = attempts === 0 ? initial : await store.read();
    if (current.kind !== "ok") fail(`cas re-read not ok: ${current.kind}`);
    const result = await store.commit(current.data, {
      entities: { ...current.data.entities, [args.marker]: true },
      projections: current.data.projections,
    });
    if (firstOutcome === null) firstOutcome = result.kind;
    attempts += 1;
    if (result.kind === "committed") {
      generation = result.data.generation;
      break;
    }
    if (result.kind === "conflict") continue;
    fail(`cas hit recovery-required: ${result.detail}`);
  }
  if (generation < 0) fail("cas never committed within retry budget");
  process.stdout.write(`${JSON.stringify({ firstOutcome, attempts, generation })}\n`);
}

/** crash-before-rename：锁内 stage 真实 tmp（含 fsync）后 SIGKILL——rename 永不发生 */
async function runCrashBeforeRename(args: CrashArgs): Promise<void> {
  const store = new StateStore(args.scopeBase);
  const initial = await store.read();
  if (initial.kind !== "ok") fail(`crash baseline not ok: ${initial.kind}`);
  const lock = await acquireStateLock(`${store.statePath}.lock`, {
    lockTimeoutMs: 5_000,
    lockStaleMs: 10_000,
  });
  try {
    const fresh = await readCcskiStateFile(store.statePath);
    if (fresh.kind !== "ok") fail(`crash re-read not ok: ${fresh.kind}`);
    const staged = await stageStateWrite(store.statePath, {
      schemaVersion: 1,
      generation: fresh.data.generation + 1,
      entities: { ghost: true },
      projections: {},
    });
    writeFileSync(args.crashedFile, JSON.stringify({ tmpPath: staged.tmpPath }));
  } finally {
    // 不释放锁：SIGKILL 模拟持有者死亡（lock 残留由窃取协议回收）
    void lock;
  }
  process.kill(process.pid, "SIGKILL");
}

/** partial-write：对 state 文件直接写半截字节后 SIGKILL——真实磁盘部分写形态 */
async function runPartialWrite(args: PartialWriteArgs): Promise<void> {
  // 必须走 Buffer 重载（offset/length）；string 重载的第三参是 position，会整串写入
  const buffer = Buffer.from(args.fullText, "utf8");
  const handle = openSync(args.statePath, "w");
  try {
    writeSync(handle, buffer, 0, args.halfBytes);
  } finally {
    closeSync(handle);
  }
  writeFileSync(args.crashedFile, "partial");
  process.kill(process.pid, "SIGKILL");
}

/**
 * spin：连续读-改-写直到 dieAtMs，然后对自身 SIGKILL——死亡落在提交循环中途
 * （介于任意两次提交之间或提交内部），kill -9 风暴的中断语义由本进程自证。
 */
async function runSpin(args: SpinArgs): Promise<void> {
  const store = new StateStore(args.scopeBase);
  const dieAt = Math.min(Date.now() + Math.max(0, args.dieAtMs), Date.now() + 20_000);
  for (;;) {
    const current = await store.read();
    const baseline = current.kind === "ok" ? current.data : emptyState();
    const prior = typeof baseline.entities.spins === "number" ? baseline.entities.spins : 0;
    const result = await store.commit(baseline, {
      entities: { ...baseline.entities, spins: prior + 1 },
      projections: baseline.projections,
    });
    if (result.kind !== "committed") {
      if (result.kind === "conflict") continue;
      fail(`spin hit recovery-required: ${result.detail}`);
    }
    if (Date.now() >= dieAt) {
      process.kill(process.pid, "SIGKILL");
      return; // SIGKILL 不可拦截；此行仅为类型收窄
    }
  }
}

async function main(): Promise<void> {
  const job = process.argv[2];
  const rawArgs = process.argv[3];
  if (job === undefined || rawArgs === undefined) fail("usage: state-worker <job> <json-args>");
  const args: unknown = JSON.parse(rawArgs);

  switch (job) {
    case "cas":
      return runCas(args as CasArgs);
    case "crash-before-rename":
      return runCrashBeforeRename(args as CrashArgs);
    case "partial-write":
      return runPartialWrite(args as PartialWriteArgs);
    case "spin":
      return runSpin(args as SpinArgs);
    default:
      fail(`unknown job: ${job}`);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
