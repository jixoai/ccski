/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「update 实体稳路径换新 + 物化逐副本重物化（自身 hash
 * guard）+ PINNED skip 收据 + replace 崩溃窗口恢复测试」——批 4 任务 2 的 G4 门收据
 * （E4/P1-3，含批 3 暂缓的 R5 崩溃窗）
 * 正交意图：
 *   [1] 稳路径换新收据：实体在原路径换新（staging→backup→swap），link 投影零重建
 *       （同一 symlink 原样解析新内容）；state revision/provenance 刷新；可选
 *       expectedRevision guard（GUARD_ENTITY 全不动）；ENTITY_SWAP_FAILED + 旧实体
 *       可用（uchg 真构造）
 *   [2] 物化逐副本收据：guard 过 → 副本原地换新（swap 原语复用，backup 回滚语义）；
 *       PINNED skip（reason+pin 双判定）；disabled skip；guard 不符 → GUARD_PROJECTION
 *       副本不动；部分成功是常态
 *   [3] R5 崩溃窗收据（真 SIGKILL 真进程，tests/helpers/swap-worker.ts 组合生产原语，
 *       生产零钩子）：mid-swap（旧实体入 backup、新未上位）→ 实体缺席 + backup 残留
 *       + state 一致（旧 revision）→ 恢复双路（backup 复位 / 清扫+重跑 update）；
 *       post-swap（新实体上位、state 未刷）→ 磁盘新/state 旧的诚实中间态 + 以
 *       expectedRevision=旧值重跑收敛
 * 妥协声明：swap 两次 rename 之间无法进程内定点自杀（生产零钩子），崩溃窗由 worker
 * 以镜像序列构造（与批 1 state-worker 同法）；镜像一致性由 R4 回滚测试与崩溃后磁盘
 * 形态断言双面钉住。恢复也失败（backup 丢失）形态无特权环境不可确定构造，如实留白。
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ensureEntity,
  projectEntity,
  toggleEntityProjection,
  updateEntity,
  type EntityUpdateResult,
} from "../src/api/index.js";
import {
  cleanupSandbox,
  hashOf,
  makeSandbox,
  readState,
  rewriteSkillBody,
  scopeOpts,
  writeSkillSource,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";
import { sweepReservedResidues } from "../src/core/discovery.js";
import { projectionRootId } from "../src/core/entity-state.js";
import { CCSKI_STATE_FILENAME } from "../src/core/state-store.js";

function expectUpdateOk(result: EntityUpdateResult): Extract<EntityUpdateResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
  return result as Extract<EntityUpdateResult, { kind: "ok" }>;
}

async function setupUpdateFixture(prefix: string) {
  const sandbox = makeSandbox(prefix, "project");
  const source = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
  const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
  expect(created.kind).toBe("ok");
  const oldRevision = created.kind === "ok" ? created.entity.revision : "";
  const rootLink = join(sandbox.workspace, "agents-link", "skills");
  await projectEntity({ scope: "project", name: "alpha", roots: [rootLink], ...scopeOpts(sandbox) });
  return { sandbox, source, oldRevision, entityPath: join(sandbox.entityRoot, "alpha"), rootLink, linkPath: join(rootLink, "alpha") };
}

function updateSource(sandbox: Sandbox, source: string): void {
  rewriteSkillBody(source, "alpha", `v2-${Math.random().toString(36).slice(2, 8)}\n`);
}

describe("updateEntity：实体稳路径换新（E4）", () => {
  it("换新：实体原路径换新内容；link 投影零重建解析新 revision；state/provenance 刷新；lockSyncPending", async () => {
    const fx = await setupUpdateFixture("upd-basic");
    updateSource(fx.sandbox, fx.source);
    const linkInoBefore = lstatSync(fx.linkPath).ino;
    const linkTargetBefore = readlinkSync(fx.linkPath);

    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(ok).toMatchObject({ status: "updated", lockSyncPending: true, failed: 0 });
    expect(ok.entity.revision).not.toBe(fx.oldRevision);
    expect(ok.entity.revision).toBe(await hashOf(fx.entityPath));

    // link 投影零重建：同一 symlink（同 inode 同目标）解析新内容
    expect(lstatSync(fx.linkPath).ino).toBe(linkInoBefore);
    expect(readlinkSync(fx.linkPath)).toBe(linkTargetBefore);
    expect(readFileSync(join(fx.linkPath, "SKILL.md"), "utf8")).not.toContain("v1\n");
    expect(readFileSync(join(fx.linkPath, "SKILL.md"), "utf8")).toBe(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8"));

    const record = readState(fx.sandbox.scopeBase).entities["alpha"];
    expect(record.revision).toBe(ok.entity.revision);
    const projection = readState(fx.sandbox.scopeBase).projections[`${projectionRootId(fx.rootLink)}:alpha`];
    expect(projection.entityRevision).toBe(ok.entity.revision);
    // 实体根无 staging/backup 残留
    expect(readdirSync(fx.sandbox.entityRoot).filter((n) => n.startsWith(".ccski-"))).toEqual([]);
    cleanupSandbox(fx.sandbox);
  });

  it("内容未变 → status unchanged（零磁盘/state 变更，generation 不动）", async () => {
    const fx = await setupUpdateFixture("upd-unchanged");
    const stateBefore = readFileSync(join(fx.sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8");
    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(ok.status).toBe("unchanged");
    expect(ok.generation).toBe(readState(fx.sandbox.scopeBase).generation);
    expect(readFileSync(join(fx.sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8")).toBe(stateBefore);
    cleanupSandbox(fx.sandbox);
  });

  it("GUARD_ENTITY：expectedRevision 不符 → 全不动（实体/投影/state）", async () => {
    const fx = await setupUpdateFixture("upd-guard");
    updateSource(fx.sandbox, fx.source);
    const entityBefore = readFileSync(join(fx.entityPath, "SKILL.md"), "utf8");
    const generationBefore = readState(fx.sandbox.scopeBase).generation;

    const result = await updateEntity({
      scope: "project",
      name: "alpha",
      source: { dir: fx.source },
      expectedRevision: "deadbeef",
      ...scopeOpts(fx.sandbox),
    });
    expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    expect(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8")).toBe(entityBefore);
    expect(readState(fx.sandbox.scopeBase).generation).toBe(generationBefore);
    cleanupSandbox(fx.sandbox);
  });

  it("SOURCE_NAME_MISMATCH / SOURCE_SYMLINK / 实体缺席重建 / ENTITY_MISSING（非法形态）", async () => {
    const fx = await setupUpdateFixture("upd-vocab");
    const other = writeSkillSource(fx.sandbox.workspace, "beta", "other\n");
    const mismatch = await updateEntity({ scope: "project", name: "alpha", source: { dir: other }, ...scopeOpts(fx.sandbox) });
    expect(mismatch).toMatchObject({ kind: "error", code: "SOURCE_NAME_MISMATCH" });

    const link = join(fx.sandbox.workspace, "src-link");
    symlinkSync(fx.source, link);
    const symlinked = await updateEntity({ scope: "project", name: "alpha", source: { dir: link }, ...scopeOpts(fx.sandbox) });
    expect(symlinked).toMatchObject({ kind: "error", code: "SOURCE_SYMLINK" });

    // 实体目录被外部删除（dangling record）：update = 换新上位重建（R5 可恢复路径）
    updateSource(fx.sandbox, fx.source);
    rmSync(fx.entityPath, { recursive: true });
    const rebuilt = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(rebuilt.entity.revision).toBe(await hashOf(fx.entityPath));
    expect(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8")).not.toContain("v1\n");

    // 非法形态（实体路径被文件占据）→ ENTITY_MISSING
    rmSync(fx.entityPath, { recursive: true });
    writeFileSync(fx.entityPath, "not-a-dir");
    const invalid = await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
    expect(invalid).toMatchObject({ kind: "error", code: "ENTITY_MISSING" });
    cleanupSandbox(fx.sandbox);
  });

  it.skipIf(process.platform !== "darwin")(
    "ENTITY_SWAP_FAILED（uchg 真构造）：旧实体保持可用 + state 记 lastFailure(update)",
    async () => {
      const fx = await setupUpdateFixture("upd-swapfail");
      updateSource(fx.sandbox, fx.source);
      execSync(`chflags uchg ${JSON.stringify(fx.entityPath)}`);
      try {
        const result = await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
        expect(result).toMatchObject({ kind: "error", code: "ENTITY_SWAP_FAILED" });
        expect(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8")).toContain("v1");
        const record = readState(fx.sandbox.scopeBase).entities["alpha"];
        expect((record.lastFailure as Record<string, unknown> | undefined)?.operation).toBe("update");
      } finally {
        execSync(`chflags nouchg ${JSON.stringify(fx.entityPath)}`);
      }
      cleanupSandbox(fx.sandbox);
    }
  );
});

describe("updateEntity：物化逐副本重物化（E4）", () => {
  it("guard 过 → 副本原地换新 + copyHash/copyIno/entityRevision 刷新；link 照常收敛", async () => {
    const fx = await setupUpdateFixture("upd-mat");
    const rootMat = join(fx.sandbox.workspace, "agents-mat", "skills");
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [rootMat],
      mode: "materialized",
      reason: "user-request",
      ...scopeOpts(fx.sandbox),
    } as never);
    updateSource(fx.sandbox, fx.source);

    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(ok.updated).toBe(2);
    expect(ok.failed).toBe(0);
    const copyPath = join(rootMat, "alpha");
    expect(readFileSync(join(copyPath, "SKILL.md"), "utf8")).toBe(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8"));
    const record = readState(fx.sandbox.scopeBase).projections[`${projectionRootId(rootMat)}:alpha`];
    expect(record).toMatchObject({ entityRevision: ok.entity.revision, copyHash: ok.entity.revision });
    expect(record.copyIno).toBe(lstatSync(copyPath).ino);
    cleanupSandbox(fx.sandbox);
  });

  it("PINNED skip：pinned 物化副本不动（reason 与 pin 记录双面）", async () => {
    const fx = await setupUpdateFixture("upd-pinned");
    const rootPin = join(fx.sandbox.workspace, "agents-pin", "skills");
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [rootPin],
      mode: "materialized",
      reason: "pinned",
      ...scopeOpts(fx.sandbox),
    } as never);
    const pinRecord = readState(fx.sandbox.scopeBase).projections[`${projectionRootId(rootPin)}:alpha`];
    // E4/裁决表 #11：pin = source ref + folder hash 组合落 state
    expect(pinRecord.pin).toMatchObject({ folderHash: fx.oldRevision });
    updateSource(fx.sandbox, fx.source);
    const copyBefore = readFileSync(join(rootPin, "alpha", "SKILL.md"), "utf8");

    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    const pinReceipt = ok.projections.find((p) => p.rootPath === rootPin);
    expect(pinReceipt).toMatchObject({ status: "skipped", code: "PINNED" });
    expect(readFileSync(join(rootPin, "alpha", "SKILL.md"), "utf8")).toBe(copyBefore);
    expect(readState(fx.sandbox.scopeBase).projections[`${projectionRootId(rootPin)}:alpha`]).toEqual(pinRecord);
    cleanupSandbox(fx.sandbox);
  });

  it("guard 不符 → GUARD_PROJECTION 副本不动；另一副本照常更新（部分成功是常态）", async () => {
    const fx = await setupUpdateFixture("upd-part");
    const rootMat = join(fx.sandbox.workspace, "agents-mat", "skills");
    const rootOk = join(fx.sandbox.workspace, "agents-ok", "skills");
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [rootMat],
      mode: "materialized",
      reason: "user-request",
      ...scopeOpts(fx.sandbox),
    } as never);
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [rootOk],
      mode: "materialized",
      reason: "user-request",
      ...scopeOpts(fx.sandbox),
    } as never);
    writeFileSync(join(rootMat, "alpha", "local-edit.md"), "hands off\n");
    updateSource(fx.sandbox, fx.source);

    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    const diverged = ok.projections.find((p) => p.rootPath === rootMat);
    const converged = ok.projections.find((p) => p.rootPath === rootOk);
    expect(diverged).toMatchObject({ status: "failed", code: "GUARD_PROJECTION" });
    expect(converged).toMatchObject({ status: "updated" });
    expect(existsSync(join(rootMat, "alpha", "local-edit.md"))).toBe(true);
    expect(readFileSync(join(rootOk, "alpha", "SKILL.md"), "utf8")).toBe(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8"));
    cleanupSandbox(fx.sandbox);
  });

  it("disabled 物化副本 skip；enable（旧内容）→ 再 update 收敛（收敛回路）", async () => {
    const fx = await setupUpdateFixture("upd-disable-loop");
    const rootMat = join(fx.sandbox.workspace, "agents-mat", "skills");
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [rootMat],
      mode: "materialized",
      reason: "user-request",
      ...scopeOpts(fx.sandbox),
    } as never);
    expect(
      (
        await toggleEntityProjection({ scope: "project", name: "alpha", root: rootMat, action: "disable", ...scopeOpts(fx.sandbox) })
      ).kind
    ).toBe("ok");
    updateSource(fx.sandbox, fx.source);

    const first = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(first.projections.find((p) => p.rootPath === rootMat)).toMatchObject({ status: "skipped", code: "PROJECTION_DISABLED" });
    // 副本保持禁用形态与旧内容；记录 revision 不动
    expect(existsSync(join(rootMat, "alpha", ".SKILL.md"))).toBe(true);
    expect(readState(fx.sandbox.scopeBase).projections[`${projectionRootId(rootMat)}:alpha`].entityRevision).toBe(fx.oldRevision);

    // enable（旧内容，guard 以 copyHash 自洽）→ 再 update 收敛到新内容
    expect(
      (
        await toggleEntityProjection({ scope: "project", name: "alpha", root: rootMat, action: "enable", ...scopeOpts(fx.sandbox) })
      ).kind
    ).toBe("ok");
    const second = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(second.projections.find((p) => p.rootPath === rootMat)).toMatchObject({ status: "updated" });
    expect(readFileSync(join(rootMat, "alpha", "SKILL.md"), "utf8")).toBe(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8"));
    cleanupSandbox(fx.sandbox);
  });

  it("缺席副本重建：记录 enabled 但副本被删 → update 重建为最新内容", async () => {
    const fx = await setupUpdateFixture("upd-rebuild");
    const rootMat = join(fx.sandbox.workspace, "agents-mat", "skills");
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [rootMat],
      mode: "materialized",
      reason: "user-request",
      ...scopeOpts(fx.sandbox),
    } as never);
    rmSync(join(rootMat, "alpha"), { recursive: true });
    updateSource(fx.sandbox, fx.source);

    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(ok.projections.find((p) => p.rootPath === rootMat)).toMatchObject({ status: "updated" });
    expect(readFileSync(join(rootMat, "alpha", "SKILL.md"), "utf8")).toBe(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8"));
    cleanupSandbox(fx.sandbox);
  });
});

// ---------------------------------------------------------------------------
// R5 崩溃窗收据（真 SIGKILL 真进程；G4 门承接批 3 暂缓项）
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxEntry = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const workerPath = join(repoRoot, "tests", "helpers", "swap-worker.ts");

interface WorkerOutcome {
  code: number | null;
  signal: string | null;
}

/** 本运行时下 SIGKILL 死亡实测上报为 code 137 / signal null（state-store 同探针结论） */
function diedBySigkill(outcome: WorkerOutcome): boolean {
  return outcome.signal === "SIGKILL" || outcome.code === 137;
}

async function runCrashWorker(
  job: "crash-mid-swap" | "crash-post-swap",
  args: { entityRoot: string; entityPath: string; sourceDir: string; receiptFile: string }
): Promise<WorkerOutcome> {
  const child = spawn(process.execPath, [tsxEntry, workerPath, job, JSON.stringify(args)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe("R5 崩溃窗收据（G4；spec: Replace failure restores + Stable-path update 共同覆盖）", () => {
  it("mid-swap SIGKILL：实体缺席 + backup 残留 + state 一致（旧 revision）；恢复双路 = backup 复位 / 清扫+重跑 update", async () => {
    const fx = await setupUpdateFixture("crash-mid");
    updateSource(fx.sandbox, fx.source);
    const receiptFile = join(tmpdir(), `ccski-crash-receipt-${process.pid}-${Date.now()}.json`);

    const outcome = await runCrashWorker("crash-mid-swap", {
      entityRoot: fx.sandbox.entityRoot,
      entityPath: fx.entityPath,
      sourceDir: fx.source,
      receiptFile,
    });
    expect(diedBySigkill(outcome)).toBe(true);
    expect(existsSync(receiptFile)).toBe(true);

    // 崩溃后形态：实体路径空、backup 带旧内容与 marker、staging 残留、state 原样
    expect(existsSync(fx.entityPath)).toBe(false);
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8")) as { backup: string };
    expect(lstatSync(receipt.backup).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(receipt.backup, "SKILL.md"), "utf8")).toContain("v1");
    expect(readState(fx.sandbox.scopeBase).entities["alpha"].revision).toBe(fx.oldRevision);
    // link 投影 = broken typed omission（发现层可见，非静默缺失）
    const { discoverSkills } = await import("../src/core/discovery.js");
    const brokenDiscovery = discoverSkills({
      userDir: fx.sandbox.home,
      workspaceDir: fx.sandbox.workspace,
      scanDefaultDirs: false,
      stateBases: [fx.sandbox.scopeBase],
      customDirs: [fx.rootLink],
    });
    expect(brokenDiscovery.diagnostics.omissions.map((o) => o.code)).toEqual(["broken-symlink"]);
    // 恢复双路（backup 复位 / 清扫+重跑）分别在下面两个独立用例验证
    cleanupSandbox(fx.sandbox);
  });

  it("mid-swap 恢复路 A：backup 复位 → 旧实体回来且 state revision 重合（一致性断言）", async () => {
    const { renameSync } = await import("node:fs");
    const fx = await setupUpdateFixture("crash-restore");
    updateSource(fx.sandbox, fx.source);
    const receiptFile = join(tmpdir(), `ccski-crash-restore-${process.pid}-${Date.now()}.json`);
    const outcome = await runCrashWorker("crash-mid-swap", {
      entityRoot: fx.sandbox.entityRoot,
      entityPath: fx.entityPath,
      sourceDir: fx.source,
      receiptFile,
    });
    expect(diedBySigkill(outcome)).toBe(true);
    const { backup } = JSON.parse(readFileSync(receiptFile, "utf8")) as { backup: string };

    renameSync(backup, fx.entityPath);
    // backup marker 是 ccski 残留元数据（backup 目录的清扫单位），不是内容——
    // 复位动作包含摘除，复位后实体内容 hash 与 state revision 重合（一致性断言）
    rmSync(join(fx.entityPath, ".ccski-residue.json"), { force: true });
    expect(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8")).toContain("v1");
    expect(await hashOf(fx.entityPath)).toBe(readState(fx.sandbox.scopeBase).entities["alpha"].revision);
    // 链解析恢复；staging 处于「marker 已摘、rename 未达」窗口 → 无 marker 残留由
    // 清扫保守面保留（no-marker 不删），绝不前缀盲删
    expect(readFileSync(join(fx.linkPath, "SKILL.md"), "utf8")).toContain("v1");
    const sweep = sweepReservedResidues(fx.sandbox.entityRoot);
    expect(sweep.removed).toEqual([]);
    expect(sweep.kept.map((r) => r.reason)).toEqual(["no-marker"]);
    cleanupSandbox(fx.sandbox);
  });

  it("mid-swap 恢复路 B：backup 清扫（写者已死）+ 重跑 update → 换新完成、state 一致", async () => {
    const fx = await setupUpdateFixture("crash-forward");
    updateSource(fx.sandbox, fx.source);
    const receiptFile = join(tmpdir(), `ccski-crash-fwd-${process.pid}-${Date.now()}.json`);
    const outcome = await runCrashWorker("crash-mid-swap", {
      entityRoot: fx.sandbox.entityRoot,
      entityPath: fx.entityPath,
      sourceDir: fx.source,
      receiptFile,
    });
    expect(diedBySigkill(outcome)).toBe(true);

    // 摘 marker 后的诚实窗口语义：backup 带 marker → 写者已死被清扫；staging 处于
    // 「marker 已摘、rename 未达」窗口 → 无 marker 残留由保守面保留（no-marker 不删，
    // 批 5 repair 收敛），绝不前缀盲删
    const sweep = sweepReservedResidues(fx.sandbox.entityRoot);
    expect(sweep.removed.map((r) => r.kind)).toEqual(["backup"]);
    expect(sweep.kept.map((r) => r.reason)).toEqual(["no-marker"]);
    const ok = expectUpdateOk(
      await updateEntity({ scope: "project", name: "alpha", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })
    );
    expect(ok.status).toBe("updated");
    expect(ok.entity.revision).toBe(await hashOf(fx.entityPath));
    expect(readFileSync(join(fx.linkPath, "SKILL.md"), "utf8")).not.toContain("v1\n");
    // 成功的 update 零新残留：唯一的 .ccski- 条目就是那条被保守保留的 staging 残留
    const residues = readdirSync(fx.sandbox.entityRoot).filter((n) => n.startsWith(".ccski-"));
    expect(residues).toHaveLength(1);
    expect(residues[0]?.startsWith(".ccski-staging-")).toBe(true);
    cleanupSandbox(fx.sandbox);
  });

  it("post-swap SIGKILL：磁盘新/state 旧的诚实中间态；以 expectedRevision=旧值重跑收敛", async () => {
    const fx = await setupUpdateFixture("crash-post");
    updateSource(fx.sandbox, fx.source);
    const receiptFile = join(tmpdir(), `ccski-crash-post-${process.pid}-${Date.now()}.json`);
    const outcome = await runCrashWorker("crash-post-swap", {
      entityRoot: fx.sandbox.entityRoot,
      entityPath: fx.entityPath,
      sourceDir: fx.source,
      receiptFile,
    });
    expect(diedBySigkill(outcome)).toBe(true);
    const { backup } = JSON.parse(readFileSync(receiptFile, "utf8")) as { backup: string };

    // 崩溃后形态：新内容已上位（link 按路径语义解析新内容）、旧实体在 backup、state 仍旧 revision
    expect(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8")).not.toContain("v1\n");
    expect(readFileSync(join(backup, "SKILL.md"), "utf8")).toContain("v1");
    expect(readState(fx.sandbox.scopeBase).entities["alpha"].revision).toBe(fx.oldRevision);
    expect(await hashOf(fx.entityPath)).not.toBe(fx.oldRevision);
    expect(readFileSync(join(fx.linkPath, "SKILL.md"), "utf8")).toBe(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8"));

    // 收敛：重跑 update（expectedRevision = state 旧值 guard 通过）→ state 刷新一致
    const ok = expectUpdateOk(
      await updateEntity({
        scope: "project",
        name: "alpha",
        source: { dir: fx.source },
        expectedRevision: fx.oldRevision,
        ...scopeOpts(fx.sandbox),
      })
    );
    expect(ok.entity.revision).toBe(await hashOf(fx.entityPath));
    expect(readState(fx.sandbox.scopeBase).entities["alpha"].revision).toBe(ok.entity.revision);
    expect(sweepReservedResidues(fx.sandbox.entityRoot).removed.map((r) => r.kind)).toContain("backup");
    cleanupSandbox(fx.sandbox);
  });
});
