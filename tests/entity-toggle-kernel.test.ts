/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「toggle link 摘链/重建（ENTITY_REVISED）+ 物化
 * ccski-legacy 标注 + link 禁第二身份文件」——批 4 任务 3 的 G4 门收据
 * 正交意图：
 *   [1] E3 契约收据（真磁盘 fixture）：link disable = unlink + state disabled 的物理
 *       生效（其它根不受影响、实体 SKILL.md 不动、绝不产生 .SKILL.md 第二身份文件）；
 *       enable = ENTITY_REVISED 闸 + 重建链
 *   [2] 物化 ccski-legacy 约定：.SKILL.md rename + convention 标注 + copyHash guard
 *       刷新（换名后的 hash 形态与后续 remove/update guard 自洽）
 *   [3] 换体/外部链/无记录形态的 typed 拒绝面（GUARD_PROJECTION/FOREIGN_OWNERSHIP/
 *       PROJECTION_NOT_FOUND）；canonical root = entity-local skipped 收据
 * 妥协声明：无。全部真磁盘、真 state 提交；convention 词与 disabled 语义按 spec
 * 「Physical disable semantics」正文钉值。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEntity,
  projectEntity,
  toggleEntityProjection,
  type EntityToggleResult,
} from "../src/api/index.js";
import {
  cleanupSandbox,
  makeSandbox,
  readState,
  rewriteSkillBody,
  scopeOpts,
  writeSkillSource,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";
import { projectionRootId } from "../src/core/entity-state.js";

function expectToggleOk(result: EntityToggleResult): Extract<EntityToggleResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
  return result as Extract<EntityToggleResult, { kind: "ok" }>;
}

/** 建实体 + link 投影，返回实体/源与根路径 */
async function setupLink(sandbox: Sandbox, name = "alpha", body = "v1\n") {
  const source = writeSkillSource(sandbox.workspace, name, body);
  const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
  expect(created.kind).toBe("ok");
  const root = join(sandbox.workspace, `agents-${name}`, "skills");
  const projected = await projectEntity({ scope: "project", name, roots: [root], ...scopeOpts(sandbox) });
  expect(projected.kind).toBe("ok");
  return { source, entityPath: join(sandbox.entityRoot, name), root, linkPath: join(root, name) };
}

async function setupMaterialized(sandbox: Sandbox, name = "mat", body = "v1\n") {
  const source = writeSkillSource(sandbox.workspace, name, body);
  const created = await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
  expect(created.kind).toBe("ok");
  const root = join(sandbox.workspace, `agents-${name}`, "skills");
  const projected = await projectEntity({
    scope: "project",
    name,
    roots: [root],
    mode: "materialized",
    reason: "user-request",
    ...scopeOpts(sandbox),
  });
  expect(projected.kind).toBe("ok");
  return { source, entityPath: join(sandbox.entityRoot, name), root, copyPath: join(root, name) };
}

describe("toggleEntityProjection：link 物理禁用（E3）", () => {
  it("disable：unlink + state disabled；其它根不受影响；实体 SKILL.md 不动", async () => {
    const sandbox = makeSandbox("dis-basic", "project");
    const { entityPath, root, linkPath } = await setupLink(sandbox);
    const otherRoot = join(sandbox.workspace, "agents-other", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [otherRoot], ...scopeOpts(sandbox) });
    const entitySbBefore = readFileSync(join(entityPath, "SKILL.md"), "utf8");

    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    expect(ok).toMatchObject({ action: "disable", status: "toggled", mode: "link", disabled: true });

    // 物理生效：链不在了；sidecar 与磁盘一致
    expect(existsSync(linkPath)).toBe(false);
    expect(lstatSync(join(otherRoot, "alpha")).isSymbolicLink()).toBe(true); // 其它根不受影响
    expect(existsSync(join(entityPath, ".SKILL.md"))).toBe(false); // 禁第二身份文件
    expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toBe(entitySbBefore);

    const record = readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:alpha`];
    expect(record).toMatchObject({ mode: "link", disabled: true });

    // 发现层互证：禁用根不再出现 alpha（链没了），启用根照常
    const { discoverSkills } = await import("../src/core/discovery.js");
    const discovery = discoverSkills({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      scanDefaultDirs: false,
      stateBases: [sandbox.scopeBase],
      customDirs: [root, otherRoot],
    });
    expect(discovery.skills.find((s) => s.path === linkPath)).toBeUndefined();
    expect(discovery.skills.find((s) => s.path === join(otherRoot, "alpha"))).toBeDefined();
    cleanupSandbox(sandbox);
  });

  it("disable 幂等：已 disabled 且链已不在 → unchanged 且零 state 写入", async () => {
    const sandbox = makeSandbox("dis-idem", "project");
    const { root, linkPath } = await setupLink(sandbox);
    expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    const before = readFileSync(join(sandbox.scopeBase, ".ccski-state.json"), "utf8");
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    expect(ok.status).toBe("unchanged");
    expect(ok.disabled).toBe(true);
    expect(readFileSync(join(sandbox.scopeBase, ".ccski-state.json"), "utf8")).toBe(before);
    void linkPath;
    cleanupSandbox(sandbox);
  });

  it("disable：记录 enabled 但链已被删 → toggled（state 补记物理禁用）", async () => {
    const sandbox = makeSandbox("dis-absent", "project");
    const { root, linkPath } = await setupLink(sandbox);
    rmSync(linkPath);
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    expect(ok).toMatchObject({ status: "toggled", disabled: true });
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:alpha`]).toMatchObject({ disabled: true });
    cleanupSandbox(sandbox);
  });

  it("disable 换体：链位被实目录占据 → GUARD_PROJECTION 路径不动（绝不写 .SKILL.md）", async () => {
    const sandbox = makeSandbox("dis-occupied", "project");
    const { root, linkPath } = await setupLink(sandbox);
    rmSync(linkPath);
    mkdirSync(linkPath, { recursive: true });
    writeFileSync(join(linkPath, "user-data.txt"), "precious\n");

    const result = await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "error", code: "GUARD_PROJECTION" });
    expect(readFileSync(join(linkPath, "user-data.txt"), "utf8")).toBe("precious\n");
    expect(existsSync(join(linkPath, ".SKILL.md"))).toBe(false);
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:alpha`]).toMatchObject({ disabled: false });
    cleanupSandbox(sandbox);
  });

  it("disable 换体：链被改指向他处 → GUARD_PROJECTION（异向链不按 ours 处置）", async () => {
    const sandbox = makeSandbox("dis-repoint", "project");
    const { root, linkPath } = await setupLink(sandbox);
    rmSync(linkPath);
    const elsewhere = join(sandbox.workspace, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, linkPath);

    const result = await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "error", code: "GUARD_PROJECTION" });
    expect(readlinkSync(linkPath)).toBe(elsewhere);
    cleanupSandbox(sandbox);
  });
});

describe("toggleEntityProjection：link 重建（ENTITY_REVISED 闸）", () => {
  it("enable：revision 匹配 → 链重建 + state enabled + 发现层恢复", async () => {
    const sandbox = makeSandbox("en-basic", "project");
    const { root, linkPath } = await setupLink(sandbox);
    expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "enable", ...scopeOpts(sandbox) })
    );
    expect(ok).toMatchObject({ status: "toggled", mode: "link", disabled: false });
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    const record = readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:alpha`];
    expect(record).toMatchObject({ disabled: false });
    expect(record.stale).toBeUndefined();
    cleanupSandbox(sandbox);
  });

  it("enable：update 已刷新 disabled 记录 revision → enable 直接可用（disabled-after-update 组合）", async () => {
    const sandbox = makeSandbox("en-revised", "project");
    const { source, root, linkPath } = await setupLink(sandbox);
    expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    // 实体内容演进（update 生产管线：同源换新；disabled link 记录随实体收敛刷新）
    const { updateEntity } = await import("../src/api/index.js");
    rewriteSkillBody(source, "alpha", "v2 body\n");
    const updated = await updateEntity({ scope: "project", name: "alpha", source: { dir: source }, ...scopeOpts(sandbox) });
    expect(updated.kind).toBe("ok");

    // 记录 revision 已随 update 刷新（disabled 保留）→ enable 一次通过，链解析新内容
    const record = readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:alpha`];
    expect(record).toMatchObject({ disabled: true });
    expect(record.entityRevision).toBe(updated.kind === "ok" ? updated.entity.revision : "");
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "enable", ...scopeOpts(sandbox) })
    );
    expect(ok.disabled).toBe(false);
    expect(readFileSync(join(linkPath, "SKILL.md"), "utf8")).toContain("v2 body");
    cleanupSandbox(sandbox);
  });

  it("enable：replace 后 stale 记录 → ENTITY_REVISED；update 收敛后 enable 可用", async () => {
    const sandbox = makeSandbox("en-stale", "project");
    const { root } = await setupLink(sandbox, "stale-skill");
    // 记录 enabled 状态下直接 replace（R8：link 记录旧 revision + stale）
    const newSource = writeSkillSource(sandbox.workspace, "stale-skill", "REPLACED body\n");
    const state = readState(sandbox.scopeBase);
    const oldRevision = (state.entities["stale-skill"].revision as string);
    const replaced = await ensureEntity({
      scope: "project",
      source: { dir: newSource },
      replace: { expectedRevision: oldRevision },
      ...scopeOpts(sandbox),
    });
    expect(replaced.kind).toBe("ok");
    expect(readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:stale-skill`]).toMatchObject({ stale: true });

    // disable→enable 过 ENTITY_REVISED 闸（记录旧 revision ≠ 当前）
    expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "stale-skill", root, action: "disable", ...scopeOpts(sandbox) })
    );
    const denied = await toggleEntityProjection({ scope: "project", name: "stale-skill", root, action: "enable", ...scopeOpts(sandbox) });
    expect(denied).toMatchObject({ kind: "error", code: "ENTITY_REVISED" });

    // update 收敛记录 → enable 通过
    const { updateEntity } = await import("../src/api/index.js");
    const updated = await updateEntity({ scope: "project", name: "stale-skill", source: { dir: newSource }, ...scopeOpts(sandbox) });
    expect(updated.kind).toBe("ok");
    const record = readState(sandbox.scopeBase).projections[`${projectionRootId(root)}:stale-skill`];
    expect(record.stale).toBeUndefined();
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "stale-skill", root, action: "enable", ...scopeOpts(sandbox) })
    );
    expect(ok.disabled).toBe(false);
    cleanupSandbox(sandbox);
  });

  it("enable：链位被占/实体缺失 → GUARD_PROJECTION / ENTITY_MISSING", async () => {
    const sandbox = makeSandbox("en-blocked", "project");
    const { entityPath, root, linkPath } = await setupLink(sandbox);
    expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "disable", ...scopeOpts(sandbox) })
    );
    mkdirSync(linkPath, { recursive: true });
    const occupied = await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "enable", ...scopeOpts(sandbox) });
    expect(occupied).toMatchObject({ kind: "error", code: "GUARD_PROJECTION" });

    rmSync(linkPath, { recursive: true });
    rmSync(entityPath, { recursive: true });
    const missing = await toggleEntityProjection({ scope: "project", name: "alpha", root, action: "enable", ...scopeOpts(sandbox) });
    expect(missing).toMatchObject({ kind: "error", code: "ENTITY_MISSING" });
    cleanupSandbox(sandbox);
  });

  it("无记录形态：无记录 → PROJECTION_NOT_FOUND；未注册同目标链 → 同码+adoption 指引；外部链 → FOREIGN_OWNERSHIP", async () => {
    const sandbox = makeSandbox("en-norecord", "project");
    const { entityPath } = await setupLink(sandbox);
    const ghostRoot = join(sandbox.workspace, "agents-ghost", "skills");

    const none = await toggleEntityProjection({ scope: "project", name: "alpha", root: ghostRoot, action: "enable", ...scopeOpts(sandbox) });
    expect(none).toMatchObject({ kind: "error", code: "PROJECTION_NOT_FOUND" });

    // 未注册同目标链（claim 候选，批 5）
    const claimRoot = join(sandbox.workspace, "agents-claim", "skills");
    mkdirSync(claimRoot, { recursive: true });
    symlinkSync(entityPath, join(claimRoot, "alpha"));
    const unregistered = await toggleEntityProjection({ scope: "project", name: "alpha", root: claimRoot, action: "enable", ...scopeOpts(sandbox) });
    expect(unregistered).toMatchObject({ kind: "error", code: "PROJECTION_NOT_FOUND" });
    expect((unregistered as { message: string }).message).toContain("import --claim");

    // 外部链（目标非实体）→ FOREIGN_OWNERSHIP 只读
    const extRoot = join(sandbox.workspace, "agents-ext", "skills");
    mkdirSync(extRoot, { recursive: true });
    const elsewhere = join(sandbox.workspace, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(extRoot, "alpha"));
    const external = await toggleEntityProjection({ scope: "project", name: "alpha", root: extRoot, action: "disable", ...scopeOpts(sandbox) });
    expect(external).toMatchObject({ kind: "error", code: "FOREIGN_OWNERSHIP" });
    expect(readlinkSync(join(extRoot, "alpha"))).toBe(elsewhere);
    cleanupSandbox(sandbox);
  });
});

describe("toggleEntityProjection：物化 ccski-legacy 约定（E3）", () => {
  it("disable：SKILL.md → .SKILL.md rename + convention 标注 + copyHash 刷新（remove guard 随后自洽）", async () => {
    const sandbox = makeSandbox("mat-dis", "project");
    const { copyPath } = await setupMaterialized(sandbox);
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "mat", root: join(sandbox.workspace, "agents-mat", "skills"), action: "disable", ...scopeOpts(sandbox) })
    );
    expect(ok).toMatchObject({
      status: "toggled",
      mode: "materialized",
      disabled: true,
      convention: "ccski-legacy",
    });
    expect(existsSync(join(copyPath, ".SKILL.md"))).toBe(true);
    expect(existsSync(join(copyPath, "SKILL.md"))).toBe(false);

    // copyHash 已刷新为换名后形态 → remove 的 guard 仍通过
    const { removeEntityProjections } = await import("../src/api/index.js");
    const removed = await removeEntityProjections({
      scope: "project",
      name: "mat",
      roots: [join(sandbox.workspace, "agents-mat", "skills")],
      ...scopeOpts(sandbox),
    });
    expect(removed.kind).toBe("ok");
    expect(removed.kind === "ok" ? removed.results[0]?.status : null).toBe("removed");
    cleanupSandbox(sandbox);
  });

  it("enable：rename 回启用形态 + 无实体 revision 闸（实体先 update 也能 enable）", async () => {
    const sandbox = makeSandbox("mat-en", "project");
    const { copyPath, source } = await setupMaterialized(sandbox);
    const root = join(sandbox.workspace, "agents-mat", "skills");
    expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "mat", root, action: "disable", ...scopeOpts(sandbox) })
    );
    // 实体先 update（副本合法滞后，E3 物化 enable 不做实体 revision 校验）
    const { updateEntity } = await import("../src/api/index.js");
    rewriteSkillBody(source, "mat", "v2 body\n");
    const updated = await updateEntity({ scope: "project", name: "mat", source: { dir: source }, ...scopeOpts(sandbox) });
    expect(updated.kind).toBe("ok");

    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "mat", root, action: "enable", ...scopeOpts(sandbox) })
    );
    expect(ok).toMatchObject({ status: "toggled", mode: "materialized", disabled: false, convention: "ccski-legacy" });
    expect(existsSync(join(copyPath, "SKILL.md"))).toBe(true);
    expect(existsSync(join(copyPath, ".SKILL.md"))).toBe(false);
    // 副本仍是旧内容（滞后合法）
    expect(readFileSync(join(copyPath, "SKILL.md"), "utf8")).toContain("v1");
    cleanupSandbox(sandbox);
  });

  it("disable：副本被外部改动（guard 不符）→ GUARD_PROJECTION 路径不动", async () => {
    const sandbox = makeSandbox("mat-guard", "project");
    const { copyPath } = await setupMaterialized(sandbox);
    writeFileSync(join(copyPath, "user-notes.md"), "hands off\n");
    const result = await toggleEntityProjection({
      scope: "project",
      name: "mat",
      root: join(sandbox.workspace, "agents-mat", "skills"),
      action: "disable",
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "error", code: "GUARD_PROJECTION" });
    expect(existsSync(join(copyPath, "SKILL.md"))).toBe(true);
    expect(existsSync(join(copyPath, ".SKILL.md"))).toBe(false);
    expect(readFileSync(join(copyPath, "user-notes.md"), "utf8")).toBe("hands off\n");
    cleanupSandbox(sandbox);
  });

  it("enable：副本目录缺失 → GUARD_PROJECTION（重物化归 update，不在 toggle 造副本）", async () => {
    const sandbox = makeSandbox("mat-gone", "project");
    const { copyPath } = await setupMaterialized(sandbox);
    const root = join(sandbox.workspace, "agents-mat", "skills");
    rmSync(copyPath, { recursive: true });
    const result = await toggleEntityProjection({ scope: "project", name: "mat", root, action: "enable", ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "error", code: "GUARD_PROJECTION" });
    cleanupSandbox(sandbox);
  });
});

describe("toggleEntityProjection：canonical root 与 scope 面", () => {
  it("canonical root → entity-local skipped 收据，零磁盘/state 变化", async () => {
    const sandbox = makeSandbox("toggle-canonical", "project");
    await setupLink(sandbox);
    const before = readFileSync(join(sandbox.scopeBase, ".ccski-state.json"), "utf8");
    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "project", name: "alpha", root: sandbox.entityRoot, action: "disable", ...scopeOpts(sandbox) })
    );
    expect(ok).toMatchObject({
      status: "skipped",
      mode: "entity-local",
      targetKind: "entity",
      reason: "canonical-root",
      disabled: false,
    });
    expect(readFileSync(join(sandbox.scopeBase, ".ccski-state.json"), "utf8")).toBe(before);
    cleanupSandbox(sandbox);
  });

  it("SCOPE_REQUIRED + global scope 对称（global 实体/投影同样摘链物理生效）", async () => {
    const sandbox = makeSandbox("toggle-global", "global");
    const source = writeSkillSource(sandbox.workspace, "gskill", "global body\n");
    const created = await ensureEntity({ scope: "global", source: { dir: source }, ...scopeOpts(sandbox) });
    expect(created.kind).toBe("ok");
    const root = join(sandbox.workspace, "agents-g", "skills");
    await projectEntity({ scope: "global", name: "gskill", roots: [root], ...scopeOpts(sandbox) });

    const noScope = await toggleEntityProjection({ name: "gskill", root, action: "disable", ...scopeOpts(sandbox) });
    expect(noScope).toMatchObject({ kind: "error", code: "SCOPE_REQUIRED" });

    const ok = expectToggleOk(
      await toggleEntityProjection({ scope: "global", name: "gskill", root, action: "disable", ...scopeOpts(sandbox) })
    );
    expect(ok.disabled).toBe(true);
    expect(existsSync(join(root, "gskill"))).toBe(false);
    expect(existsSync(join(sandbox.entityRoot, "gskill", "SKILL.md"))).toBe(true);
    cleanupSandbox(sandbox);
  });
});

