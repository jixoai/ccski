/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「G4 组合矩阵：scope(global/project) × mode(link/
 * materialized/entity-local) × 状态(enabled/disabled/stale/pinned) × remove/toggle/
 * update 操作 × regular/broken/external/占用/换体 —— 全组合 + disabled-after-update
 * （实体更新后 disabled 投影保持 disabled）+ crash 恢复。矩阵覆盖表进测试头注」
 * 正交意图：
 *   [1] G4 门组合矩阵收据：表格驱动跨乘验证（每格一个真磁盘沙箱，断言物理效果与
 *       state 终态），细节收据归三份 API 专测（见下表 r 标注）
 *   [2] 跨 scope 对称性：global 与 project 沙箱跑同一操作回路，物理效果逐一对照
 *
 * ============================ G4 矩阵覆盖表 ============================
 * 维度 \ 操作        | remove            | toggle(disable/enable)      | update
 * -------------------+-------------------+-----------------------------+------------------
 * link × enabled     | unlink+退役 ✓M3   | unlink+disabled / 重建 ✓M2  | 记录刷新 ✓M4,r
 * link × disabled    | 退役(补) ✓M3      | 幂等 unchanged / 重建 ✓M2,r | 刷新+保持禁用 ✓M7
 * link × stale       | 退役 ✓M3          | enable→ENTITY_REVISED ✓M2,r | stale 清除收敛 ✓M7,r
 * materialized×enabled| guard 删目录 ✓M3 | .SKILL.md rename 双向 ✓M2   | 重物化 ✓M4,r
 * materialized×disabled| copyHash 删 ✓M3 | rename 幂等面 ✓r            | PROJECTION_DISABLED ✓M7,r
 * materialized×pinned| 删除不受 pin 阻 ✓M3| rename 照常 ✓M2            | PINNED skip ✓M4,r
 * entity-local       | skipped ✓M5       | skipped ✓M5                 | 实体换新照常 ✓M5
 * 磁盘形态（×toggle） | regular/broken/external/占用(实目录)/换体(异向链) ✓M6,r
 * 磁盘形态（×remove） | 同上 + 副本异内容/异 inode 换体 ✓r（GUARD_PROJECTION 双判据）
 * scope 对称          | global≡project 全操作回路 ✓M1
 * disabled-after-update| link 禁用保持 + enable 直通；物化 skip→enable→update 收敛 ✓M7
 * crash 恢复（R5）    | mid-swap/post-swap 真 SIGKILL 双窗 + 恢复双路 ✓r（swap-worker）
 * 发现层互证          | 禁用→不可见；GC 后外部链→broken omission ✓r
 * ======================================================================
 *
 * 妥协声明：矩阵格只断言该格的决定性效果（防组合回归），触发面细节与错误文案由
 * 三份专测收据承载，不在此复制；crash 窗构造归 swap-worker（真进程真信号），本文件
 * 不重复拉起 worker。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deleteEntity,
  ensureEntity,
  projectEntity,
  removeEntityProjections,
  toggleEntityProjection,
  updateEntity,
  type EntityScope,
} from "../src/api/index.js";
import {
  cleanupSandbox,
  makeSandbox,
  readState,
  rewriteSkillBody,
  scopeOpts,
  writeSkillSource,
  writeState,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";
import { projectionRootId } from "../src/core/entity-state.js";

/** 组装一个实体 + 若干投影的最小沙箱（每格独立，自清理） */
async function cell(
  prefix: string,
  scope: EntityScope,
  opts: { mode?: "link" | "materialized"; reason?: "pinned" | "user-request" } = {}
) {
  const sandbox = makeSandbox(prefix, scope);
  const source = writeSkillSource(sandbox.workspace, "skill", "v1\n");
  const created = await ensureEntity({ scope, source: { dir: source }, ...scopeOpts(sandbox) });
  expect(created.kind).toBe("ok");
  const revision = created.kind === "ok" ? created.entity.revision : "";
  const root = join(sandbox.workspace, "agents", "skills");
  if (opts.mode !== undefined) {
    const projected = await projectEntity({
      scope,
      name: "skill",
      roots: [root],
      ...(opts.mode === "materialized" ? { mode: "materialized", reason: opts.reason ?? "user-request" } : {}),
      ...scopeOpts(sandbox),
    } as never);
    expect(projected.kind).toBe("ok");
  }
  return {
    sandbox,
    source,
    revision,
    root,
    entityPath: join(sandbox.entityRoot, "skill"),
    projPath: join(root, "skill"),
  };
}

// ---------------------------------------------------------------------------
// M1 scope 对称：global ≡ project（同一操作回路的物理效果逐一对照）
// ---------------------------------------------------------------------------

describe("M1 scope 对称（global ≡ project）", () => {
  for (const scope of ["global", "project"] as const) {
    it(`${scope}：disable→unlink + enable→重建 + update→换新 + remove→GC，物理效果一致`, async () => {
      const fx = await cell(`m1-${scope}`, scope, { mode: "link" });
      rewriteSkillBody(fx.source, "skill", "v2\n");

      const disabled = await toggleEntityProjection({ scope, name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) });
      expect(disabled).toMatchObject({ kind: "ok", disabled: true });
      expect(existsSync(fx.projPath)).toBe(false);

      const enabled = await toggleEntityProjection({ scope, name: "skill", root: fx.root, action: "enable", ...scopeOpts(fx.sandbox) });
      expect(enabled).toMatchObject({ kind: "ok", disabled: false });
      expect(lstatSync(fx.projPath).isSymbolicLink()).toBe(true);

      const updated = await updateEntity({ scope, name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
      expect(updated).toMatchObject({ kind: "ok", status: "updated" });
      expect(readFileSync(join(fx.projPath, "SKILL.md"), "utf8")).not.toContain("v1\n");

      const removed = await removeEntityProjections({ scope, name: "skill", roots: [fx.root], ...scopeOpts(fx.sandbox) });
      expect(removed).toMatchObject({ kind: "ok", entityRemoved: true });
      expect(existsSync(fx.entityPath)).toBe(false);
      cleanupSandbox(fx.sandbox);
    });
  }
});

// ---------------------------------------------------------------------------
// M2 mode × 状态 × toggle：每格断言物理效果 + state 终态
// ---------------------------------------------------------------------------

describe("M2 mode × 状态 × toggle", () => {
  const cases: Array<{
    title: string;
    mode: "link" | "materialized";
    reason?: "pinned" | "user-request";
    setup?: (fx: Awaited<ReturnType<typeof cell>>) => Promise<void>;
    action: "disable" | "enable";
    expect: { status: string; disabled: boolean; code?: string; convention?: "ccski-legacy" };
    disk: (fx: Awaited<ReturnType<typeof cell>>) => void;
  }> = [
    {
      title: "link/enabled/disable → unlink + disabled",
      mode: "link",
      action: "disable",
      expect: { status: "toggled", disabled: true },
      disk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
    {
      title: "link/disabled/enable → 重建链",
      mode: "link",
      action: "enable",
      setup: async (fx) => {
        expect(
          (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
        ).toBe("ok");
      },
      expect: { status: "toggled", disabled: false },
      disk: (fx) => expect(lstatSync(fx.projPath).isSymbolicLink()).toBe(true),
    },
    {
      title: "materialized/enabled/disable → .SKILL.md rename + ccski-legacy",
      mode: "materialized",
      action: "disable",
      expect: { status: "toggled", disabled: true, convention: "ccski-legacy" },
      disk: (fx) => {
        expect(existsSync(join(fx.projPath, ".SKILL.md"))).toBe(true);
        expect(existsSync(join(fx.projPath, "SKILL.md"))).toBe(false);
      },
    },
    {
      title: "materialized/pinned/disable → pin 不阻止 toggle（rename 照常）",
      mode: "materialized",
      reason: "pinned",
      action: "disable",
      expect: { status: "toggled", disabled: true, convention: "ccski-legacy" },
      disk: (fx) => expect(existsSync(join(fx.projPath, ".SKILL.md"))).toBe(true),
    },
    {
      title: "materialized/enabled+实体已换新/enable → 无 ENTITY_REVISED 闸（副本合法滞后）",
      mode: "materialized",
      action: "enable",
      setup: async (fx) => {
        // 先 disable（rename 到禁用形态），再把实体换新到 v2（副本滞留 v1）
        expect(
          (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
        ).toBe("ok");
        rewriteSkillBody(fx.source, "skill", "v2\n");
        expect(
          (await updateEntity({ scope: "project", name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) })).kind
        ).toBe("ok");
      },
      expect: { status: "toggled", disabled: false, convention: "ccski-legacy" },
      disk: (fx) => {
        expect(existsSync(join(fx.projPath, "SKILL.md"))).toBe(true);
        expect(readFileSync(join(fx.projPath, "SKILL.md"), "utf8")).toContain("v1"); // 滞后合法
      },
    },
    {
      title: "link/enabled+stale/enable → ENTITY_REVISED（replace 后记录旧 revision）",
      mode: "link",
      action: "enable",
      setup: async (fx) => {
        // replace 换实体（R8：link 记录旧 revision + stale），随后 disable→enable
        const newSource = writeSkillSource(fx.sandbox.workspace, "skill", "REPLACED\n");
        expect(
          (
            await ensureEntity({
              scope: "project",
              source: { dir: newSource },
              replace: { expectedRevision: fx.revision },
              ...scopeOpts(fx.sandbox),
            })
          ).kind
        ).toBe("ok");
        expect(
          (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
        ).toBe("ok");
      },
      expect: { status: "ENTITY_REVISED" },
      disk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
  ];

  for (const c of cases) {
    it(c.title, async () => {
      const fx = await cell(`m2-${c.action}-${c.mode}-${c.reason ?? "x"}`.slice(0, 60), "project", { mode: c.mode, reason: c.reason });
      await c.setup?.(fx);
      const result = await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: c.action, ...scopeOpts(fx.sandbox) });
      if (c.expect.code !== undefined || c.expect.status === "ENTITY_REVISED") {
        expect(result).toMatchObject({ kind: "error", code: "ENTITY_REVISED" });
      } else {
        expect(result).toMatchObject({ kind: "ok", action: c.action, status: c.expect.status, disabled: c.expect.disabled });
        if (c.expect.convention !== undefined) {
          expect((result as { convention?: string }).convention).toBe(c.expect.convention);
        }
      }
      c.disk(fx);
      cleanupSandbox(fx.sandbox);
    });
  }
});

// ---------------------------------------------------------------------------
// M3 mode × 状态 × remove（+ no-record 外部链形态）
// ---------------------------------------------------------------------------

describe("M3 mode × 状态 × remove", () => {
  const cases: Array<{
    title: string;
    mode: "link" | "materialized";
    reason?: "pinned" | "user-request";
    setup?: (fx: Awaited<ReturnType<typeof cell>>) => Promise<void>;
    expectStatus: "removed" | "failed";
    errorCode?: string;
    disk: (fx: Awaited<ReturnType<typeof cell>>) => void;
  }> = [
    {
      title: "link/enabled/regular → unlink + 退役",
      mode: "link",
      expectStatus: "removed",
      disk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
    {
      title: "materialized/enabled/regular → guard 删目录",
      mode: "materialized",
      expectStatus: "removed",
      disk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
    {
      title: "materialized/pinned/regular → remove 不受 pin 阻（pin 只约束 update 重物化）",
      mode: "materialized",
      reason: "pinned",
      expectStatus: "removed",
      disk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
    {
      title: "materialized/disabled（.SKILL.md 形态）→ copyHash guard 过 → 删除",
      mode: "materialized",
      expectStatus: "removed",
      setup: async (fx) => {
        expect(
          (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
        ).toBe("ok");
      },
      disk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
    {
      title: "link/换体（链被改指向他处）→ GUARD_PROJECTION 路径不动",
      mode: "link",
      expectStatus: "failed",
      errorCode: "GUARD_PROJECTION",
      setup: async (fx) => {
        rmSync(fx.projPath);
        const elsewhere = join(fx.sandbox.workspace, "elsewhere");
        mkdirSync(elsewhere, { recursive: true });
        symlinkSync(elsewhere, fx.projPath);
      },
      disk: (fx) => expect(readlinkSync(fx.projPath)).toBe(join(fx.sandbox.workspace, "elsewhere")),
    },
    {
      title: "link/无记录 external broken 链 → FOREIGN_OWNERSHIP（read-only）",
      mode: "link",
      expectStatus: "failed",
      errorCode: "FOREIGN_OWNERSHIP",
      setup: async (fx) => {
        // 独立实体 + 未注册 broken 链（指向不存在目标）
        rmSync(fx.projPath);
        symlinkSync(join(fx.sandbox.workspace, "vanished-target"), fx.projPath);
        const state = readState(fx.sandbox.scopeBase);
        delete state.projections[`${projectionRootId(fx.root)}:skill`];
        writeState(fx.sandbox.scopeBase, state);
      },
      disk: (fx) => expect(lstatSync(fx.projPath).isSymbolicLink()).toBe(true),
    },
  ];

  for (const c of cases) {
    it(c.title, async () => {
      const fx = await cell(`m3-${c.mode}-${c.reason ?? "x"}`.slice(0, 60), "project", { mode: c.mode, reason: c.reason });
      await c.setup?.(fx);
      const result = await removeEntityProjections({ scope: "project", name: "skill", roots: [fx.root], ...scopeOpts(fx.sandbox) });
      expect(result).toMatchObject({ kind: "ok" });
      const row = result.kind === "ok" ? result.results[0] : undefined;
      expect(row?.status).toBe(c.expectStatus);
      if (c.errorCode !== undefined) expect(row?.errorCode).toBe(c.errorCode);
      c.disk(fx);
      cleanupSandbox(fx.sandbox);
    });
  }
});

// ---------------------------------------------------------------------------
// M4 mode × 状态 × update（收据格）
// ---------------------------------------------------------------------------

describe("M4 mode × 状态 × update", () => {
  const cases: Array<{
    title: string;
    mode: "link" | "materialized";
    reason?: "pinned" | "user-request";
    setup?: (fx: Awaited<ReturnType<typeof cell>>) => Promise<void>;
    row: { status: string; code?: string };
  }> = [
    { title: "link/enabled → updated（记录刷新）", mode: "link", row: { status: "updated" } },
    {
      title: "materialized/enabled → updated（重物化）",
      mode: "materialized",
      row: { status: "updated" },
    },
    {
      title: "materialized/pinned → skipped PINNED",
      mode: "materialized",
      reason: "pinned",
      row: { status: "skipped", code: "PINNED" },
    },
    {
      title: "materialized/disabled → skipped PROJECTION_DISABLED",
      mode: "materialized",
      row: { status: "skipped", code: "PROJECTION_DISABLED" },
      setup: async (fx) => {
        expect(
          (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
        ).toBe("ok");
      },
    },
  ];

  for (const c of cases) {
    it(c.title, async () => {
      const fx = await cell(`m4-${c.mode}-${c.reason ?? "x"}`.slice(0, 60), "project", { mode: c.mode, reason: c.reason });
      await c.setup?.(fx);
      rewriteSkillBody(fx.source, "skill", "v2\n");
      const result = await updateEntity({ scope: "project", name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
      expect(result).toMatchObject({ kind: "ok" });
      const row = result.kind === "ok" ? result.projections.find((p) => p.rootPath === fx.root) : undefined;
      expect(row?.status).toBe(c.row.status);
      if (c.row.code !== undefined) expect(row?.code).toBe(c.row.code);
      cleanupSandbox(fx.sandbox);
    });
  }
});

// ---------------------------------------------------------------------------
// M5 entity-local × 三操作（canonical root 不参与投影面）
// ---------------------------------------------------------------------------

describe("M5 entity-local × remove/toggle/update", () => {
  it("remove(canonical root) → skipped entity 收据且实体保留（删除走 deleteEntity+GUARD_ENTITY）", async () => {
    const fx = await cell("m5-remove", "project");
    const result = await removeEntityProjections({ scope: "project", name: "skill", roots: [fx.sandbox.entityRoot], ...scopeOpts(fx.sandbox) });
    expect(result.kind === "ok" ? result.results[0] : undefined).toMatchObject({
      status: "skipped",
      mode: "entity-local",
      targetKind: "entity",
      reason: "canonical-root",
    });
    expect(existsSync(fx.entityPath)).toBe(true);
    // 实体删除半区：GUARD_ENTITY 通过才退役
    const wrong = await deleteEntity({ scope: "project", name: "skill", expectedRevision: "nope", ...scopeOpts(fx.sandbox) });
    expect(wrong).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    const ok = await deleteEntity({ scope: "project", name: "skill", expectedRevision: fx.revision, ...scopeOpts(fx.sandbox) });
    expect(ok).toMatchObject({ kind: "ok", directoryDeleted: true });
    cleanupSandbox(fx.sandbox);
  });

  it("toggle(canonical root) → skipped entity 收据（实体无禁用语义）", async () => {
    const fx = await cell("m5-toggle", "project");
    const result = await toggleEntityProjection({ scope: "project", name: "skill", root: fx.sandbox.entityRoot, action: "disable", ...scopeOpts(fx.sandbox) });
    expect(result).toMatchObject({
      kind: "ok",
      status: "skipped",
      mode: "entity-local",
      targetKind: "entity",
      reason: "canonical-root",
    });
    expect(existsSync(join(fx.entityPath, "SKILL.md"))).toBe(true);
    cleanupSandbox(fx.sandbox);
  });

  it("update：无投影实体照常稳路径换新（entity-local 形态的 update 面）", async () => {
    const fx = await cell("m5-update", "project");
    rewriteSkillBody(fx.source, "skill", "v2\n");
    const result = await updateEntity({ scope: "project", name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
    expect(result).toMatchObject({ kind: "ok", status: "updated", projections: [] });
    expect(readFileSync(join(fx.entityPath, "SKILL.md"), "utf8")).toContain("v2");
    cleanupSandbox(fx.sandbox);
  });
});

// ---------------------------------------------------------------------------
// M6 toggle × 磁盘形态（link disable 的形态守卫格）
// ---------------------------------------------------------------------------

describe("M6 link toggle × 磁盘形态", () => {
  const forms: Array<{
    title: string;
    build: (fx: Awaited<ReturnType<typeof cell>>) => void;
    expectCode: "ok" | "GUARD_PROJECTION" | "FOREIGN_OWNERSHIP";
    keepDisk: (fx: Awaited<ReturnType<typeof cell>>) => void;
  }> = [
    {
      title: "regular（指向实体的链）→ unlink 物理禁用",
      build: () => undefined,
      expectCode: "ok",
      keepDisk: (fx) => expect(existsSync(fx.projPath)).toBe(false),
    },
    {
      title: "占用（实目录占据链位）→ GUARD_PROJECTION",
      build: (fx) => {
        rmSync(fx.projPath);
        mkdirSync(fx.projPath, { recursive: true });
        writeFileSync(join(fx.projPath, "data.txt"), "x");
      },
      expectCode: "GUARD_PROJECTION",
      keepDisk: (fx) => expect(existsSync(join(fx.projPath, "data.txt"))).toBe(true),
    },
    {
      title: "换体（异向链）→ GUARD_PROJECTION",
      build: (fx) => {
        rmSync(fx.projPath);
        const elsewhere = join(fx.sandbox.workspace, "elsewhere");
        mkdirSync(elsewhere, { recursive: true });
        symlinkSync(elsewhere, fx.projPath);
      },
      expectCode: "GUARD_PROJECTION",
      keepDisk: (fx) => expect(readlinkSync(fx.projPath)).toBe(join(fx.sandbox.workspace, "elsewhere")),
    },
    {
      title: "external broken 链（未注册）→ FOREIGN_OWNERSHIP",
      build: (fx) => {
        rmSync(fx.projPath);
        symlinkSync(join(fx.sandbox.workspace, "vanished"), fx.projPath);
        const state = readState(fx.sandbox.scopeBase);
        delete state.projections[`${projectionRootId(fx.root)}:skill`];
        writeState(fx.sandbox.scopeBase, state);
      },
      expectCode: "FOREIGN_OWNERSHIP",
      keepDisk: (fx) => expect(lstatSync(fx.projPath).isSymbolicLink()).toBe(true),
    },
  ];
  for (const f of forms) {
    it(f.title, async () => {
      const fx = await cell(`m6-${f.expectCode}`.slice(0, 60), "project", { mode: "link" });
      f.build(fx);
      const result = await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) });
      if (f.expectCode === "ok") {
        expect(result).toMatchObject({ kind: "ok", disabled: true });
      } else {
        expect(result).toMatchObject({ kind: "error", code: f.expectCode });
      }
      f.keepDisk(fx);
      cleanupSandbox(fx.sandbox);
    });
  }
});

// ---------------------------------------------------------------------------
// M7 disabled-after-update（跨 mode 组合专项）
// ---------------------------------------------------------------------------

describe("M7 disabled-after-update", () => {
  it("link disabled + update → 物理保持禁用（不重建）+ 记录刷新 → enable 一次通过解析新内容", async () => {
    const fx = await cell("m7-link", "project", { mode: "link" });
    expect(
      (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
    ).toBe("ok");
    rewriteSkillBody(fx.source, "skill", "v2\n");
    const updated = await updateEntity({ scope: "project", name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
    expect(updated).toMatchObject({ kind: "ok" });
    // disabled 投影保持 disabled：磁盘无链、state disabled=true、记录 revision 已刷新
    expect(existsSync(fx.projPath)).toBe(false);
    const record = readState(fx.sandbox.scopeBase).projections[`${projectionRootId(fx.root)}:skill`];
    expect(record).toMatchObject({ disabled: true });
    expect(record.entityRevision).toBe(updated.kind === "ok" ? updated.entity.revision : "");
    // enable 直通（无 ENTITY_REVISED）→ 解析新内容
    const enabled = await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "enable", ...scopeOpts(fx.sandbox) });
    expect(enabled).toMatchObject({ kind: "ok", disabled: false });
    expect(readFileSync(join(fx.projPath, "SKILL.md"), "utf8")).toContain("v2");
    cleanupSandbox(fx.sandbox);
  });

  it("materialized disabled + update → skip（副本滞留禁用形态）→ enable（旧内容）→ update 收敛", async () => {
    const fx = await cell("m7-mat", "project", { mode: "materialized" });
    expect(
      (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "disable", ...scopeOpts(fx.sandbox) })).kind
    ).toBe("ok");
    rewriteSkillBody(fx.source, "skill", "v2\n");
    const first = await updateEntity({ scope: "project", name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
    expect(first.kind === "ok" ? first.projections.find((p) => p.rootPath === fx.root)?.code : undefined).toBe("PROJECTION_DISABLED");
    expect(existsSync(join(fx.projPath, ".SKILL.md"))).toBe(true);
    expect(readFileSync(join(fx.projPath, ".SKILL.md"), "utf8")).toContain("v1"); // 滞留旧内容

    // enable（旧内容，copyHash guard 自洽）→ 再 update 收敛（同源内容未变也收敛副本）
    expect(
      (await toggleEntityProjection({ scope: "project", name: "skill", root: fx.root, action: "enable", ...scopeOpts(fx.sandbox) })).kind
    ).toBe("ok");
    const second = await updateEntity({ scope: "project", name: "skill", source: { dir: fx.source }, ...scopeOpts(fx.sandbox) });
    expect(second).toMatchObject({ kind: "ok", status: "unchanged" }); // 实体已在 v2
    expect(second.kind === "ok" ? second.projections.find((p) => p.rootPath === fx.root)?.status : undefined).toBe("updated");
    expect(readFileSync(join(fx.projPath, "SKILL.md"), "utf8")).toContain("v2");
    cleanupSandbox(fx.sandbox);
  });
});

