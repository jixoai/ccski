/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「state-store recovery primitive 收据（G1 门）：测试 = 双真进程并发写竞争（child_process 对打，恰一方 CAS 胜出）、kill -9 中断恢复、损坏 JSON 降级。真信号真进程，不 mock」
 * 正交意图：
 *   [1] CAS 语义收据：过期 generation 提交 → STATE_GENERATION_CONFLICT + 重读重试
 *   [2] 崩溃收据（真 SIGKILL 真进程）：rename 前 SIGKILL → 旧态完好 + tmp/lock 残留
 *       回收；半截写 SIGKILL → STATE_RECOVERY_REQUIRED 且拒绝盲覆盖；多写者风暴
 *       中状态文件任意瞬时可见字节均完整且 generation 单调
 *   [3] 数据不兼容降级矩阵（corrupt-json / unknown-version / schema-invalid）与
 *       锁超时、tmp 残留清扫的单元面
 * 妥协声明：crash 点由 tests/helpers/state-worker.ts 组合生产原语（stageStateWrite
 * 后 SIGKILL 自身）实现，生产代码零测试钩子；G1 门的 repair CLI 归批 5（tasks.md）。
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  acquireStateLock,
  CCSKI_STATE_FILENAME,
  emptyState,
  StateStore,
  StateStoreError,
  type CcskiStateData,
} from "../src/core/state-store.js";

function newScope(): string {
  return mkdtempSync(join(tmpdir(), "ccski-state-"));
}

function renderState(data: CcskiStateData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function writeRawState(scope: string, text: string): string {
  const statePath = join(scope, CCSKI_STATE_FILENAME);
  writeFileSync(statePath, text);
  return statePath;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxEntry = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const workerPath = join(repoRoot, "tests", "helpers", "state-worker.ts");

interface WorkerOutcome {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

/**
 * 本运行时（vite-plus node shim）下 SIGKILL 死亡实测上报为 code 137 / signal null
 * （tests 仓内探针 2026-10-07：spawn 直接 exit 137）；两种形态都视作 SIGKILL 死亡。
 */
function diedBySigkill(outcome: WorkerOutcome): boolean {
  return outcome.signal === "SIGKILL" || outcome.code === 137;
}

async function runWorker(job: string, args: unknown, timeoutMs = 30_000): Promise<WorkerOutcome> {
  expect(existsSync(tsxEntry)).toBe(true);
  const child = spawn(process.execPath, [tsxEntry, workerPath, job, JSON.stringify(args)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function parseWorkerStdout(outcome: WorkerOutcome): unknown {
  const lines = outcome.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1] ?? "") as unknown;
}

async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("StateStore basics", () => {
  it("reads absent as a baseline and commits the first generation", async () => {
    const store = new StateStore(newScope());
    expect(await store.read()).toEqual({ kind: "absent" });

    const result = await store.commit(emptyState(), { entities: { seed: true }, projections: {} });
    expect(result).toMatchObject({ kind: "committed", data: { generation: 1 } });
    expect(existsSync(store.statePath)).toBe(true);

    const reread = await store.read();
    expect(reread).toMatchObject({ kind: "ok", data: { generation: 1, entities: { seed: true } } });
  });

  it("advances generation monotonically across sequential commits", async () => {
    const store = new StateStore(newScope());
    const first = await store.commit(emptyState(), { entities: { a: 1 }, projections: {} });
    expect(first.kind).toBe("committed");

    const reread = await store.read();
    expect(reread.kind).toBe("ok");
    if (reread.kind !== "ok") return;
    const second = await store.commit(reread.data, {
      entities: { ...reread.data.entities, b: 2 },
      projections: {},
    });
    expect(second).toMatchObject({ kind: "committed", data: { generation: 2 } });
  });

  it("rejects a stale expected generation with typed conflict and re-read", async () => {
    const store = new StateStore(newScope());
    const first = await store.commit(emptyState(), { entities: { v: 1 }, projections: {} });
    expect(first.kind).toBe("committed");

    const stale = await store.read();
    expect(stale.kind).toBe("ok");
    if (stale.kind !== "ok") return;

    const bump = await store.commit(stale.data, { entities: { v: 2 }, projections: {} });
    expect(bump.kind).toBe("committed");

    const conflict = await store.commit(stale.data, { entities: { v: 3 }, projections: {} });
    expect(conflict).toMatchObject({
      kind: "conflict",
      code: "STATE_GENERATION_CONFLICT",
      reread: { kind: "ok", data: { generation: 2 } },
    });

    // 调用方重读重试：以 reread 数据为基线提交成功，无静默丢写
    if (conflict.kind !== "conflict") return;
    const reread = conflict.reread;
    expect(reread.kind).toBe("ok");
    if (reread.kind !== "ok") return;
    const retry = await store.commit(reread.data, {
      entities: { ...reread.data.entities, v: 3 },
      projections: reread.data.projections,
    });
    expect(retry).toMatchObject({ kind: "committed", data: { generation: 3 } });
    const final = await store.read();
    expect(final).toMatchObject({ kind: "ok", data: { generation: 3, entities: { v: 3 } } });
  });

  it("throws typed INVALID_EXPECTED for baselines not obtained from this version", async () => {
    const store = new StateStore(newScope());
    const bogus = { ...emptyState(), schemaVersion: 99 };
    await expect(store.commit(bogus, { entities: {}, projections: {} })).rejects.toMatchObject({
      name: "StateStoreError",
      code: "INVALID_EXPECTED",
    });
  });
});

describe("StateStore read degradation (STATE_RECOVERY_REQUIRED)", () => {
  it("degrades corrupt JSON, unknown version, and schema-invalid payloads read-only", async () => {
    const scope = newScope();
    const store = new StateStore(scope);

    writeRawState(scope, '{"schemaVersion":1,');
    expect(await store.read()).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "corrupt-json",
    });

    writeRawState(scope, renderState({ ...emptyState(), schemaVersion: 99, generation: 4 }));
    expect(await store.read()).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "unknown-version",
    });

    writeRawState(scope, '{"schemaVersion":1,"generation":0}');
    expect(await store.read()).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "schema-invalid",
    });

    writeRawState(scope, "[1,2,3]");
    expect(await store.read()).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "schema-invalid",
    });
  });

  it("refuses blind overwrite against a recovery-required state", async () => {
    const scope = newScope();
    const store = new StateStore(scope);
    const corrupt = '{"schemaVersion":1,"generat';
    writeRawState(scope, corrupt);

    const commitAttempt = await store.commit(emptyState(), { entities: { x: 1 }, projections: {} });
    expect(commitAttempt).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "corrupt-json",
    });
    expect(readFileSync(store.statePath, "utf8")).toBe(corrupt);
  });
});

describe("StateStore maintenance", () => {
  it("sweeps tmp residue of dead writers and keeps live-writer and foreign files", async () => {
    const scope = newScope();
    const store = new StateStore(scope);
    const deadTmp = join(scope, ".ccski-state.json.tmp-4000000-dead01");
    const liveTmp = join(scope, ".ccski-state.json.tmp-1-face00");
    const foreignTmp = join(scope, "unrelated.tmp-4000000-dead02");
    writeFileSync(deadTmp, "residue");
    writeFileSync(liveTmp, "residue");
    writeFileSync(foreignTmp, "residue");
    // 兜底龄期分支：活 pid 但文件早已腐龄 → 也应被清扫（后缀必须全 hex 以匹配命名模式）
    const agedTmp = join(scope, ".ccski-state.json.tmp-1-0dead0");
    writeFileSync(agedTmp, "residue");
    const ancient = new Date("2000-01-01T00:00:00Z");
    utimesSync(agedTmp, ancient, ancient);

    expect(await store.read()).toEqual({ kind: "absent" });

    expect(existsSync(deadTmp)).toBe(false);
    expect(existsSync(agedTmp)).toBe(false);
    expect(existsSync(liveTmp)).toBe(true); // pid 1（launchd）存活：非本 writer 不动
    expect(existsSync(foreignTmp)).toBe(true); // 命名不匹配：非 state tmp 不动
  });

  it(
    "times out against a live in-process lock holder and recovers after release",
    { timeout: 10_000 },
    async () => {
      const scope = newScope();
      const store = new StateStore(scope, { lockTimeoutMs: 300, lockStaleMs: 60_000 });
      const seeded = await store.commit(emptyState(), { entities: {}, projections: {} });
      expect(seeded.kind).toBe("committed");

      const lock = await acquireStateLock(`${store.statePath}.lock`, {
        lockTimeoutMs: 5_000,
        lockStaleMs: 10_000,
      });

      const current = await store.read();
      expect(current.kind).toBe("ok");
      if (current.kind !== "ok") return;
      const rejection: unknown = await store
        .commit(current.data, { entities: {}, projections: {} })
        .catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(StateStoreError);
      expect((rejection as StateStoreError).code).toBe("LOCK_TIMEOUT");

      await lock.release();
      const after = await store.read();
      expect(after.kind).toBe("ok");
      if (after.kind !== "ok") return;
      await expect(
        store.commit(after.data, { entities: { freed: true }, projections: {} })
      ).resolves.toMatchObject({ kind: "committed", data: { generation: 2 } });
    }
  );
});

describe("G1 gate: real-process crash and concurrency receipts", () => {
  it("dual-process CAS contention: exactly one first-attempt winner, loser re-reads and commits", async () => {
    const scope = newScope();
    const store = new StateStore(scope);
    const seeded = await store.commit(emptyState(), { entities: { seed: true }, projections: {} });
    expect(seeded).toMatchObject({ kind: "committed", data: { generation: 1 } });

    const readyA = join(scope, "ready-a");
    const readyB = join(scope, "ready-b");
    const goFile = join(scope, "go");
    const workerA = runWorker("cas", { scopeBase: scope, marker: "wA", readyFile: readyA, goFile });
    const workerB = runWorker("cas", { scopeBase: scope, marker: "wB", readyFile: readyB, goFile });
    const outcomes = await (async () => {
      // 两个 worker 都持有 gen-1 基线后才放行 go，制造确定的 CAS 对撞
      await Promise.all([waitForFile(readyA), waitForFile(readyB)]);
      writeFileSync(goFile, "go");
      return await Promise.all([workerA, workerB]);
    })();

    for (const outcome of outcomes) {
      expect(outcome.code).toBe(0);
      if (outcome.code !== 0) {
        throw new Error(`cas worker failed: ${outcome.stderr}`);
      }
    }
    const receipts = outcomes.map(parseWorkerStdout) as Array<{
      firstOutcome: string;
      attempts: number;
      generation: number;
    }>;
    expect(receipts.map((r) => r.firstOutcome).sort()).toEqual(["committed", "conflict"]);
    expect(receipts.map((r) => r.generation).sort()).toEqual([2, 3]);

    const final = await store.read();
    expect(final).toMatchObject({
      kind: "ok",
      data: { generation: 3, entities: { seed: true, wA: true, wB: true } },
    });
  }, 60_000);

  it("SIGKILL between tmp-stage and rename: previous state intact, residues recovered, next commit succeeds", async () => {
    const scope = newScope();
    const store = new StateStore(scope);
    const seeded = await store.commit(emptyState(), { entities: { v: 1 }, projections: {} });
    expect(seeded).toMatchObject({ kind: "committed", data: { generation: 1 } });
    const intactBytes = readFileSync(store.statePath, "utf8");

    const crashedFile = join(scope, "crashed-marker");
    const outcome = await runWorker("crash-before-rename", { scopeBase: scope, crashedFile });
    expect(diedBySigkill(outcome)).toBe(true);
    const marker = JSON.parse(readFileSync(crashedFile, "utf8")) as { tmpPath: string };

    // 崩溃现场：state 仍是旧 generation；tmp 残留与 lock 残留都在
    expect(JSON.parse(readFileSync(store.statePath, "utf8"))).toMatchObject({
      generation: 1,
      entities: { v: 1 },
    });
    expect(readFileSync(store.statePath, "utf8")).toBe(intactBytes);
    expect(existsSync(marker.tmpPath)).toBe(true);
    expect(existsSync(`${store.statePath}.lock`)).toBe(true);

    // 下次读：旧态完好（写入方被杀 = 提交未发生），并回收 tmp 残留
    const recovered = await store.read();
    expect(recovered).toMatchObject({ kind: "ok", data: { generation: 1, entities: { v: 1 } } });
    expect(existsSync(marker.tmpPath)).toBe(false);

    // 下次写：死持有者的 lock 被窃取，提交照常推进
    expect(recovered.kind).toBe("ok");
    if (recovered.kind !== "ok") return;
    await expect(
      store.commit(recovered.data, { entities: { v: 2 }, projections: {} })
    ).resolves.toMatchObject({ kind: "committed", data: { generation: 2 } });
  }, 60_000);

  it("SIGKILL mid-write of the state file itself: partial bytes detected, read-only recovery-required, blind overwrite refused", async () => {
    const scope = newScope();
    const store = new StateStore(scope);
    const fullText = renderState({
      schemaVersion: 1,
      generation: 5,
      entities: { keeper: true },
      projections: {},
    });
    const statePath = writeRawState(scope, fullText);

    const crashedFile = join(scope, "crashed-marker");
    const outcome = await runWorker("partial-write", {
      statePath,
      fullText,
      halfBytes: Math.floor(Buffer.byteLength(fullText, "utf8") / 2),
      crashedFile,
    });
    expect(diedBySigkill(outcome)).toBe(true);

    const partialBytes = readFileSync(statePath, "utf8");
    expect(partialBytes.length).toBeLessThan(fullText.length);
    expect(Buffer.byteLength(partialBytes, "utf8")).toBe(
      Math.floor(Buffer.byteLength(fullText, "utf8") / 2)
    );

    expect(await store.read()).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "corrupt-json",
    });

    // 只读降级：任何 commit 都不得覆盖损坏现场（repair 归批 5）
    const commitAttempt = await store.commit(emptyState(), { entities: {}, projections: {} });
    expect(commitAttempt).toMatchObject({
      kind: "recovery-required",
      code: "STATE_RECOVERY_REQUIRED",
      reason: "corrupt-json",
    });
    expect(readFileSync(statePath, "utf8")).toBe(partialBytes);
  }, 60_000);

  it("kill -9 storm: writers die mid-commit-loop; state bytes stay parseable and generation monotonic throughout; state remains usable after the storm", async () => {
    const scope = newScope();
    const statePath = join(scope, CCSKI_STATE_FILENAME);
    expect(existsSync(tsxEntry)).toBe(true);

    interface CloseInfo {
      code: number | null;
      signal: string | null;
      stderr: string;
    }
    // 三个写者在提交循环中途对自身 SIGKILL（dieAtMs = 相对启动的延迟，落在循环进行时）
    const children = [0, 1, 2].map(() => {
      const child = spawn(
        process.execPath,
        [tsxEntry, workerPath, "spin", JSON.stringify({ scopeBase: scope, dieAtMs: 600 })],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      return child;
    });
    const closes = children.map(
      (child) =>
        new Promise<CloseInfo>((resolve) => {
          let stderr = "";
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
          child.on("close", (code, signal) => resolve({ code, signal, stderr }));
        })
    );

    // 风暴窗口：任意瞬时可见的 state 字节必须完整可解析且 generation 单调
    let resolvedCount = 0;
    children.forEach((child) =>
      child.on("close", () => {
        resolvedCount += 1;
      })
    );
    let lastGeneration = 0;
    let observedTicks = 0;
    const startedAt = Date.now();
    while (resolvedCount < children.length && Date.now() - startedAt < 30_000) {
      if (existsSync(statePath)) {
        const text = readFileSync(statePath, "utf8");
        // tmp+rename 原子性收据：永不出现半截 JSON，generation 永不回退
        const parsed = JSON.parse(text) as { generation: number };
        expect(Number.isInteger(parsed.generation)).toBe(true);
        expect(parsed.generation).toBeGreaterThanOrEqual(lastGeneration);
        lastGeneration = parsed.generation;
        observedTicks += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const closeInfos = await Promise.all(closes);
    for (const info of closeInfos) {
      expect(diedBySigkill(info)).toBe(true);
      expect(info.stderr).toBe("");
    }
    expect(observedTicks).toBeGreaterThan(0);

    // 风暴后：state 永不处于损坏/降级态；死写者的 tmp 残留被清扫
    const store = new StateStore(scope);
    const after = await store.read();
    expect(after.kind === "ok" || after.kind === "absent").toBe(true);
    const residuePattern = /^\.ccski-state\.json\.tmp-\d+-[0-9a-f]+$/;
    const leftover = readdirSync(scope).filter((name) => residuePattern.test(name));
    expect(leftover).toEqual([]);

    if (after.kind === "ok") {
      expect(after.data.generation).toBeGreaterThanOrEqual(1);
      const next = await store.commit(after.data, { entities: { after: true }, projections: {} });
      expect(next).toMatchObject({ kind: "committed" });
    }
  }, 60_000);
});
