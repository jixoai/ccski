/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「remove 投影先行 + 实体 GC（全 roots 复核 + 未知引用
 * 保留 warning）」+「deleteEntity 走实体 mutation 受 GUARD_ENTITY」——批 4 任务 1 的
 * G4 门收据（E4: Ownership-first removal and entity GC）
 * 正交意图：
 *   [1] 投影先行收据：link 只 unlink（链后实体原样可用）；物化删目录过自身
 *       hash/inode guard（换体/外部改动 → GUARD_PROJECTION 路径不动）；无记录形态
 *       的 typed 面（NOT_FOUND 幂等/FOREIGN_OWNERSHIP 只读/GC_UNKNOWN_REFERENCE 保留）
 *   [2] 实体 GC 三条件收据：零投影记录 ∧ 全注册 roots 复核无 owned 引用 ∧ 无未知
 *       引用；末引用移除 GC（实体目录删 + 记录退役）；blockedBy 三态如实；
 *       canonical root = entity-local skipped
 *   [3] deleteEntity：GUARD_ENTITY 闸 + PROJECTIONS_REMAIN + 引用复核拒绝 + 成功退役
 * 妥协声明：无。全部真磁盘 fixture；换体以真实 rm+recreate（inode 变化）与外部内容
 * 改写构造，不 mock guard。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deleteEntity,
  ensureEntity,
  projectEntity,
  removeEntityProjections,
  type EntityRemoveResult,
} from "../src/api/index.js";
import {
  cleanupSandbox,
  hashOf,
  makeSandbox,
  readState,
  scopeOpts,
  writeSkillSource,
  writeState,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";
import { projectionRootId } from "../src/core/entity-state.js";

function expectRemoveOk(result: EntityRemoveResult): Extract<EntityRemoveResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
  return result as Extract<EntityRemoveResult, { kind: "ok" }>;
}

async function setupEntityWith(sandbox: Sandbox, name: string, roots: { root: string; mode: "link" | "materialized"; reason?: "pinned" | "user-request" }[]) {
  const source = writeSkillSource(sandbox.workspace, name, "v1\n");
  const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
  expect(created.kind).toBe("ok");
  for (const entry of roots) {
    const projected = await projectEntity({
      scope: "project",
      name,
      roots: [entry.root],
      ...(entry.mode === "materialized" ? { mode: "materialized", reason: entry.reason ?? "user-request" } : {}),
      ...scopeOpts(sandbox),
    } as never);
    expect(projected.kind).toBe("ok");
  }
  return { source, entityPath: join(sandbox.entityRoot, name) };
}

describe("removeEntityProjections：投影先行（E4）", () => {
  it("link remove：只 unlink（实体原样可用）+ 记录退役；link 缺席 → removed 补退记录", async () => {
    const sandbox = makeSandbox("rm-link", "project");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", [
      { root: join(sandbox.workspace, "agents-a", "skills"), mode: "link" },
      { root: join(sandbox.workspace, "agents-b", "skills"), mode: "link" },
    ]);
    const rootA = join(sandbox.workspace, "agents-a", "skills");

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.results[0]).toMatchObject({ status: "removed", mode: "link", targetKind: "projection" });

    // 只摘链：实体目录与另一个投影原样
    expect(existsSync(join(rootA, "alpha"))).toBe(false);
    expect(existsSync(join(entityPath, "SKILL.md"))).toBe(true);
    expect(lstatSync(join(sandbox.workspace, "agents-b", "skills", "alpha")).isSymbolicLink()).toBe(true);
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(rootA)}:alpha`]).toBeUndefined();

    // 记录缺席但链已在的幂等面：再删 = skipped NOT_FOUND
    const again = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(again.results[0]).toMatchObject({ status: "skipped", errorCode: "NOT_FOUND" });
    cleanupSandbox(sandbox);
  });

  it("link remove 记录 enabled 但链已被删 → removed（补退记录）", async () => {
    const sandbox = makeSandbox("rm-link-absent", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    rmSync(join(rootA, "alpha"));
    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.results[0]).toMatchObject({ status: "removed", mode: "link" });
    cleanupSandbox(sandbox);
  });

  it("link remove 换体：链位被实目录占据 → GUARD_PROJECTION 路径不动记录保留", async () => {
    const sandbox = makeSandbox("rm-link-occupied", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    const projPath = join(rootA, "alpha");
    rmSync(projPath);
    mkdirSync(projPath, { recursive: true });
    writeFileSync(join(projPath, "precious.txt"), "keep\n");

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.results[0]).toMatchObject({ status: "failed", errorCode: "GUARD_PROJECTION" });
    expect(readFileSync(join(projPath, "precious.txt"), "utf8")).toBe("keep\n");
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(rootA)}:alpha`]).toBeDefined();
    cleanupSandbox(sandbox);
  });

  it("materialized remove：guard 过 → 目录删 + 记录退役；副本被外部改动 → GUARD_PROJECTION；同内容换 inode → GUARD_PROJECTION", async () => {
    const sandbox = makeSandbox("rm-mat", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const rootB = join(sandbox.workspace, "agents-b", "skills");
    const rootC = join(sandbox.workspace, "agents-c", "skills");
    await setupEntityWith(sandbox, "alpha", [
      { root: rootA, mode: "materialized" },
      { root: rootB, mode: "materialized" },
      { root: rootC, mode: "materialized" },
    ]);
    // B：外部追加文件（hash 不符）
    writeFileSync(join(rootB, "alpha", "extra.md"), "external\n");
    // C：同内容换体（rm + 原样重 build → hash 同、inode 异）
    const copyC = join(rootC, "alpha");
    rmSync(copyC, { recursive: true });
    mkdirSync(copyC, { recursive: true });
    writeFileSync(join(copyC, "SKILL.md"), readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8"));

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA, rootB, rootC], ...scopeOpts(sandbox) })
    );
    expect(ok.results.map((r) => r.status)).toEqual(["removed", "failed", "failed"]);
    expect(ok.results[1]?.errorCode).toBe("GUARD_PROJECTION");
    expect(ok.results[2]?.errorCode).toBe("GUARD_PROJECTION");
    expect(existsSync(join(rootB, "alpha", "extra.md"))).toBe(true);
    expect(existsSync(copyC)).toBe(true);
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(rootA)}:alpha`]).toBeUndefined();
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(rootB)}:alpha`]).toBeDefined();
    // 部分成功：A 已删，B/C 保留记录
    cleanupSandbox(sandbox);
  });

  it("materialized disabled 副本 remove：换名后 copyHash guard 自洽 → 删除成功", async () => {
    const sandbox = makeSandbox("rm-mat-disabled", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "materialized" }]);
    const { toggleEntityProjection } = await import("../src/api/index.js");
    const disabled = await toggleEntityProjection({ scope: "project", name: "alpha", root: rootA, action: "disable", ...scopeOpts(sandbox) });
    expect(disabled.kind).toBe("ok");

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.results[0]).toMatchObject({ status: "removed", mode: "materialized" });
    expect(existsSync(join(rootA, "alpha"))).toBe(false);
    cleanupSandbox(sandbox);
  });

  it("materialized remove 副本缺席 → removed（补退记录）", async () => {
    const sandbox = makeSandbox("rm-mat-absent", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "materialized" }]);
    rmSync(join(rootA, "alpha"), { recursive: true });
    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.results[0]).toMatchObject({ status: "removed", mode: "materialized" });
    cleanupSandbox(sandbox);
  });

  it("无记录形态：absent → NOT_FOUND；未知实目录/未注册同目标链 → GC_UNKNOWN_REFERENCE 保留；外部链 → FOREIGN_OWNERSHIP", async () => {
    const sandbox = makeSandbox("rm-norecord", "project");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", []);
    const emptyRoot = join(sandbox.workspace, "agents-empty", "skills");
    const unknownRoot = join(sandbox.workspace, "agents-unknown", "skills");
    const claimRoot = join(sandbox.workspace, "agents-claim", "skills");
    const extRoot = join(sandbox.workspace, "agents-ext", "skills");
    mkdirSync(unknownRoot, { recursive: true });
    mkdirSync(join(unknownRoot, "alpha"), { recursive: true });
    writeFileSync(join(unknownRoot, "alpha", "legacy.md"), "legacy\n");
    mkdirSync(claimRoot, { recursive: true });
    symlinkSync(entityPath, join(claimRoot, "alpha"));
    mkdirSync(extRoot, { recursive: true });
    const elsewhere = join(sandbox.workspace, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(extRoot, "alpha"));

    const ok = expectRemoveOk(
      await removeEntityProjections({
        scope: "project",
        name: "alpha",
        roots: [emptyRoot, unknownRoot, claimRoot, extRoot],
        ...scopeOpts(sandbox),
      })
    );
    expect(ok.results.map((r) => r.errorCode)).toEqual(["NOT_FOUND", "GC_UNKNOWN_REFERENCE", "GC_UNKNOWN_REFERENCE", "FOREIGN_OWNERSHIP"]);
    // 未知引用不动、外部链不动、实体保留
    expect(existsSync(join(unknownRoot, "alpha", "legacy.md"))).toBe(true);
    expect(readlinkSync(join(claimRoot, "alpha"))).toBe(entityPath);
    expect(readlinkSync(join(extRoot, "alpha"))).toBe(elsewhere);
    expect(existsSync(join(sandbox.entityRoot, "alpha", "SKILL.md"))).toBe(true);
    cleanupSandbox(sandbox);
  });

  it("canonical root → entity-local skipped 收据（实体删除走 deleteEntity）", async () => {
    const sandbox = makeSandbox("rm-canonical", "project");
    await setupEntityWith(sandbox, "alpha", []);
    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [sandbox.entityRoot], ...scopeOpts(sandbox) })
    );
    expect(ok.results[0]).toMatchObject({
      status: "skipped",
      mode: "entity-local",
      targetKind: "entity",
      reason: "canonical-root",
    });
    expect(existsSync(join(sandbox.entityRoot, "alpha"))).toBe(true);
    cleanupSandbox(sandbox);
  });

  it("INVALID_ROOTS / ENTITY_NOT_FOUND / SCOPE_REQUIRED typed 面", async () => {
    const sandbox = makeSandbox("rm-vocab", "project");
    const empty = await removeEntityProjections({ scope: "project", name: "alpha", roots: [], ...scopeOpts(sandbox) });
    expect(empty).toMatchObject({ kind: "error", code: "INVALID_ROOTS" });
    const ghost = await removeEntityProjections({ scope: "project", name: "ghost", roots: [sandbox.workspace], ...scopeOpts(sandbox) });
    expect(ghost).toMatchObject({ kind: "error", code: "ENTITY_NOT_FOUND" });
    const noScope = await removeEntityProjections({ name: "alpha", roots: [sandbox.workspace], ...scopeOpts(sandbox) });
    expect(noScope).toMatchObject({ kind: "error", code: "SCOPE_REQUIRED" });
    cleanupSandbox(sandbox);
  });
});

describe("removeEntityProjections：实体 GC（E4 三条件）", () => {
  it("末引用移除 GC：实体目录删 + 实体记录退役 + generation 推进", async () => {
    const sandbox = makeSandbox("gc-last", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    const generationBefore = readState(sandbox.scopeBase).generation;

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.entityRemoved).toBe(true);
    expect(ok.gc).toMatchObject({ attempted: true, entityDeleted: true });
    expect(existsSync(entityPath)).toBe(false);
    const state = readState(sandbox.scopeBase);
    expect(state.entities["alpha"]).toBeUndefined();
    expect(state.projections).toEqual({});
    expect(state.generation).toBeGreaterThan(generationBefore);
    cleanupSandbox(sandbox);
  });

  it("GC blocked：其它根仍有投影记录 → PROJECTIONS，实体保留", async () => {
    const sandbox = makeSandbox("gc-projections", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const rootB = join(sandbox.workspace, "agents-b", "skills");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", [
      { root: rootA, mode: "link" },
      { root: rootB, mode: "materialized" },
    ]);
    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.entityRemoved).toBe(false);
    expect(ok.gc.blockedBy).toBe("PROJECTIONS");
    expect(existsSync(entityPath)).toBe(true);
    cleanupSandbox(sandbox);
  });

  it("GC blocked：注册根上未知引用（未注册实目录）→ UNKNOWN_REFERENCE + GC_UNKNOWN_REFERENCE warning；本次投影 remove 仍成功", async () => {
    const sandbox = makeSandbox("gc-unknown", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const rootB = join(sandbox.workspace, "agents-b", "skills");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", [
      { root: rootA, mode: "link" },
      { root: rootB, mode: "materialized" },
    ]);
    // B 转为「记录丢失的未知条目」形态：记录退役 + 磁盘留一个未注册实目录
    const state = readState(sandbox.scopeBase);
    delete state.projections[`${projectionRootId(rootB)}:alpha`];
    writeState(sandbox.scopeBase, state);
    rmSync(join(rootB, "alpha"), { recursive: true });
    mkdirSync(join(rootB, "alpha"), { recursive: true });
    writeFileSync(join(rootB, "alpha", "manual.md"), "mystery\n");

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA, rootB], ...scopeOpts(sandbox) })
    );
    // rootB：无记录实目录 → GC_UNKNOWN_REFERENCE skip（不删）；rootA 正常摘链
    expect(ok.results.map((r) => r.errorCode ?? r.status)).toEqual(["removed", "GC_UNKNOWN_REFERENCE"]);
    expect(ok.entityRemoved).toBe(false);
    expect(ok.gc.blockedBy).toBe("UNKNOWN_REFERENCE");
    expect(ok.gc.warnings.join("\n")).toContain("GC_UNKNOWN_REFERENCE");
    expect(existsSync(entityPath)).toBe(true);
    expect(existsSync(join(rootB, "alpha", "manual.md"))).toBe(true);
    cleanupSandbox(sandbox);
  });

  it("GC blocked：注册根上未注册同目标链（owned 引用）→ OWNED_REFERENCE，实体保留", async () => {
    const sandbox = makeSandbox("gc-owned", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const rootB = join(sandbox.workspace, "agents-b", "skills");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", [
      { root: rootA, mode: "link" },
      { root: rootB, mode: "link" },
    ]);
    // B 转为「记录丢失的 ours 链」形态：记录退役 + symlink 仍在
    const state = readState(sandbox.scopeBase);
    delete state.projections[`${projectionRootId(rootB)}:alpha`];
    writeState(sandbox.scopeBase, state);

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA, rootB], ...scopeOpts(sandbox) })
    );
    expect(ok.entityRemoved).toBe(false);
    expect(ok.gc.blockedBy).toBe("OWNED_REFERENCE");
    expect(existsSync(entityPath)).toBe(true);
    expect(lstatSync(join(rootB, "alpha")).isSymbolicLink()).toBe(true);
    cleanupSandbox(sandbox);
  });

  it("external live-link 不阻塞 GC（非引用，也不计入删除权限）", async () => {
    const sandbox = makeSandbox("gc-external", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const rootExt = join(sandbox.workspace, "agents-ext", "skills");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    mkdirSync(rootExt, { recursive: true });
    symlinkSync(entityPath, join(rootExt, "alpha"));
    // external 链注册进 roots（曾投影过又退记录）：出现在注册 roots 集
    const state = readState(sandbox.scopeBase);
    delete state.projections[`${projectionRootId(rootExt)}:alpha`];
    writeState(sandbox.scopeBase, state);

    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) })
    );
    expect(ok.entityRemoved).toBe(true);
    expect(ok.gc.entityDeleted).toBe(true);
    expect(existsSync(entityPath)).toBe(false);
    // 外部链现在悬空：发现层 typed omission（非静默缺失）
    const { discoverSkills } = await import("../src/core/discovery.js");
    const discovery = discoverSkills({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      scanDefaultDirs: false,
      stateBases: [sandbox.scopeBase],
      customDirs: [rootExt],
    });
    expect(discovery.diagnostics.omissions.length).toBe(1);
    expect(discovery.diagnostics.omissions[0]).toMatchObject({ code: "broken-symlink", name: "alpha" });
    cleanupSandbox(sandbox);
  });

  it("GC 永不猜路径：实体根作为显式根不把实体自身当未知条目（self-skip）", async () => {
    const sandbox = makeSandbox("gc-self", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    const ok = expectRemoveOk(
      await removeEntityProjections({ scope: "project", name: "alpha", roots: [rootA, sandbox.entityRoot], ...scopeOpts(sandbox) })
    );
    expect(ok.entityRemoved).toBe(true);
    expect(ok.gc.entityDeleted).toBe(true);
    cleanupSandbox(sandbox);
  });
});

describe("deleteEntity（GUARD_ENTITY 实体 mutation）", () => {
  it("GUARD_ENTITY：缺/错 expectedRevision → 拒绝实体不动", async () => {
    const sandbox = makeSandbox("del-guard", "project");
    const { entityPath } = await setupEntityWith(sandbox, "alpha", []);
    const missing = await deleteEntity({ scope: "project", name: "alpha", expectedRevision: "", ...scopeOpts(sandbox) });
    expect(missing).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    const wrong = await deleteEntity({ scope: "project", name: "alpha", expectedRevision: "deadbeef", ...scopeOpts(sandbox) });
    expect(wrong).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    expect(existsSync(entityPath)).toBe(true);
    cleanupSandbox(sandbox);
  });

  it("PROJECTIONS_REMAIN：还有投影记录 → 拒绝（先投影 remove）", async () => {
    const sandbox = makeSandbox("del-remain", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const { source } = await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    expect(created.kind).toBe("ok");
    const revision = created.kind === "ok" ? created.entity.revision : "";
    const refused = await deleteEntity({ scope: "project", name: "alpha", expectedRevision: revision, ...scopeOpts(sandbox) });
    expect(refused).toMatchObject({ kind: "error", code: "PROJECTIONS_REMAIN" });
    cleanupSandbox(sandbox);
  });

  it("成功：零投影 + 无引用 → 记录退役 + 目录删 + revision 复核在 CAS 内", async () => {
    const sandbox = makeSandbox("del-ok", "project");
    const { entityPath, source } = await setupEntityWith(sandbox, "alpha", []);
    const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    expect(created.kind).toBe("ok");
    const revision = created.kind === "ok" ? created.entity.revision : "";
    // revision 与磁盘 hash 一致（guard 的实体侧基准）
    expect(revision).toBe(await hashOf(entityPath));

    const ok = await deleteEntity({ scope: "project", name: "alpha", expectedRevision: revision, ...scopeOpts(sandbox) });
    expect(ok).toMatchObject({ kind: "ok", directoryDeleted: true });
    expect(existsSync(entityPath)).toBe(false);
    expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
    cleanupSandbox(sandbox);
  });

  it("引用复核拒绝：显式 roots 上还有指向实体的链 → GC_UNKNOWN_REFERENCE 拒绝", async () => {
    const sandbox = makeSandbox("del-ref", "project");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const { entityPath, source } = await setupEntityWith(sandbox, "alpha", [{ root: rootA, mode: "link" }]);
    const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    const revision = created.kind === "ok" ? created.entity.revision : "";
    // 投影记录消失但链还在；deleteEntity 经显式 roots 复核引用
    const state = readState(sandbox.scopeBase);
    delete state.projections[`${projectionRootId(rootA)}:alpha`];
    writeState(sandbox.scopeBase, state);

    const refused = await deleteEntity({
      scope: "project",
      name: "alpha",
      expectedRevision: revision,
      roots: [rootA],
      ...scopeOpts(sandbox),
    });
    expect(refused).toMatchObject({ kind: "error", code: "GC_UNKNOWN_REFERENCE" });
    expect(existsSync(entityPath)).toBe(true);

    // 无 roots 且无注册记录：未注册引用内核不可见（永不猜路径）→ 删除照常成功；
    // 残链以 broken typed omission 呈现（发现层），可恢复
    const ok = await deleteEntity({ scope: "project", name: "alpha", expectedRevision: revision, ...scopeOpts(sandbox) });
    expect(ok).toMatchObject({ kind: "ok", directoryDeleted: true });
    expect(existsSync(entityPath)).toBe(false);
    cleanupSandbox(sandbox);
  });
});

