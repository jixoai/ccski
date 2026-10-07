/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「P0-A 实体初始缺席时删除并发重建目录；P0-B 全树重算
 * 期间换体仍通过（哈希读取屏障）；P1-D expectedRevision 贯穿删除事务；P1-E lstatSafe
 * 吞错 + pin fd 泄漏」（Codex 终审第二轮 5.5/10 否决，内核第三轮修复）
 * 正交意图：
 *   [1] P0-A：absent 门 = dangling 记录退役，磁盘路径绝不触碰——CAS 等待窗口内
 *       同名重建（真 mkdir/write 注入于 StateStore.commit 屏障）→ 重建目录与
 *       precious 文件原样 + entityPresentOnDisk 诊断；无重建基线不误伤
 *   [2] P0-B：销毁哈希复读的读取屏障换体（folder-hash 计数屏障：第 2 次实体哈希
 *       返回定格哈希后真 rm+同内容重建+加文件）→ 第二次身份复核拒绝销毁；
 *       残余窗口收敛到复核→rmSync 微窗口（design.md 声明）
 *   [3] P1-D：expectedEntityRevision 贯穿 GC 退役——入口比对（验证后更新再删除 →
 *       typed GUARD_ENTITY 零副作用）+ CAS 复核（门后提交前并发换新 → typed
 *       GUARD_ENTITY 实体保留）；匹配基线照常 GC
 *   [4] P1-E：pin fd 生命周期（pinned open/close 计数断言——拒绝/错误提前返回
 *       不泄漏）+ lstatSafe 缺席 errno 纪律单元（ENOENT/ENOTDIR → null；EACCES
 *       上抛）+ mutation 面的 typed IO 投影（remove 逐根/gc）
 * 妥协声明：屏障 seam = vi.mock 包裹 folder-hash 计数钩子与 entity-disk-guard 的
 * open/close 计数（行为全保真透传，不 mock fs、不 mock guard 判定）；窗口内注入
 * 无其他确定性钩子（commitTransform 无生产钩子），CAS 屏障经 StateStore.prototype
 * commit spy 构造（真 commit 原样透传）。
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as diskGuardModule from "../src/api/entity-disk-guard.js";
import { lstatSafe } from "../src/api/entity-guards.js";
import {
  deleteEntity,
  ensureEntity,
  gcPropose,
  projectEntity,
  removeEntityProjections,
  toggleEntityProjection,
  updateEntity,
} from "../src/api/index.js";
import * as folderHashModule from "../src/core/folder-hash.js";
import { StateStore } from "../src/core/state-store.js";
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

// ---------------------------------------------------------------------------
// 读取屏障 seam（行为透传包裹；不 mock fs / 不 mock guard 判定）
// ---------------------------------------------------------------------------

type RealFolderHash = (dir: string) => Promise<string>;
type FolderHashHook = (dir: string, real: RealFolderHash) => Promise<string>;

vi.mock("../src/core/folder-hash.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/folder-hash.js")>();
  let hook: FolderHashHook | null = null;
  return {
    ...actual,
    computeSkillFolderHash: (dir: string) =>
      hook !== null ? hook(dir, actual.computeSkillFolderHash) : actual.computeSkillFolderHash(dir),
    __setFolderHashHook: (next: FolderHashHook | null) => {
      hook = next;
    },
  };
});

vi.mock("../src/api/entity-disk-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/entity-disk-guard.js")>();
  let pinnedOpened = 0;
  let pinnedClosed = 0;
  return {
    ...actual,
    openEntityDiskGuard: (entityPath: string) => {
      const opened = actual.openEntityDiskGuard(entityPath);
      if (opened.kind === "pinned") {
        pinnedOpened += 1;
        const originalClose = opened.handle.close;
        let counted = false;
        opened.handle.close = () => {
          if (!counted) {
            counted = true;
            pinnedClosed += 1;
          }
          originalClose();
        };
      }
      return opened;
    },
    __pinnedFdStats: () => ({ opened: pinnedOpened, closed: pinnedClosed }),
    __resetPinnedFdStats: () => {
      pinnedOpened = 0;
      pinnedClosed = 0;
    },
  };
});

const setFolderHashHook = (hook: FolderHashHook | null): void =>
  (
    folderHashModule as unknown as { __setFolderHashHook: (h: FolderHashHook | null) => void }
  ).__setFolderHashHook(hook);
const pinnedFdStats = (): { opened: number; closed: number } =>
  (
    diskGuardModule as unknown as { __pinnedFdStats: () => { opened: number; closed: number } }
  ).__pinnedFdStats();
const resetPinnedFdStats = (): void =>
  (diskGuardModule as unknown as { __resetPinnedFdStats: () => void }).__resetPinnedFdStats();

/** CAS 屏障：第 callIndex 次 state commit 入口处执行 action（真 commit 原样透传） */
function injectAtCommit(
  callIndex: number,
  action: () => void | Promise<void>
): { restore: () => void } {
  let calls = 0;
  const originalCommit = StateStore.prototype.commit;
  const spy = vi.spyOn(StateStore.prototype, "commit").mockImplementation(async function (
    this: StateStore,
    ...args: Parameters<StateStore["commit"]>
  ) {
    calls += 1;
    if (calls === callIndex) await action();
    return originalCommit.apply(this, args);
  });
  return { restore: () => spy.mockRestore() };
}

afterEach(() => {
  setFolderHashHook(null);
  vi.restoreAllMocks();
});

async function setupEntity(
  sandbox: Sandbox,
  name: string
): Promise<{ entityPath: string; revision: string; source: string }> {
  const source = writeSkillSource(sandbox.workspace, name, "v1\n");
  const created = await ensureEntity({
    scope: "project",
    source: { dir: source },
    ...scopeOpts(sandbox),
  });
  expect(created.kind).toBe("ok");
  if (created.kind !== "ok") throw new Error(`setup failed: ${created.kind}`);
  return { entityPath: join(sandbox.entityRoot, name), revision: created.entity.revision, source };
}

function recreateEntityDir(entityPath: string, skillBody: string): void {
  mkdirSync(entityPath, { recursive: true });
  writeFileSync(join(entityPath, "SKILL.md"), skillBody);
  writeFileSync(join(entityPath, "precious.txt"), "not mine to delete\n");
}

describe("P0-A 实体初始缺席：删除只退役 dangling 记录，绝不触碰磁盘路径", () => {
  it("deleteEntity：CAS 等待窗口内同名重建 → state 退役、重建目录与 precious 文件原样、entityPresentOnDisk", async () => {
    const sandbox = makeSandbox("r3-p0a-del", "project");
    const { entityPath } = await setupEntity(sandbox, "alpha");
    const skillBody = readFileSync(join(entityPath, "SKILL.md"), "utf8");
    // 构造 dangling record：磁盘移除实体目录，state 记录保留
    rmSync(entityPath, { recursive: true });
    expect(existsSync(entityPath)).toBe(false);

    const barrier = injectAtCommit(1, () => recreateEntityDir(entityPath, skillBody));
    try {
      const result = await deleteEntity({
        scope: "project",
        name: "alpha",
        expectedRevision: readState(sandbox.scopeBase).entities["alpha"]!.revision as string,
        ...scopeOpts(sandbox),
      });
      expect(result).toMatchObject({
        kind: "ok",
        directoryDeleted: false,
        entityPresentOnDisk: true,
      });
      if (result.kind === "ok") {
        expect(result.warnings.join("\n")).toContain("reappeared on disk");
      }
    } finally {
      barrier.restore();
    }

    // 重建目录与文件原样（绝未被 rmSync）
    expect(readFileSync(join(entityPath, "precious.txt"), "utf8")).toBe("not mine to delete\n");
    expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toBe(skillBody);
    // dangling 记录已退役
    expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
    cleanupSandbox(sandbox);
  });

  it("deleteEntity 基线：无重建的 dangling 记录 → 退役成功、directoryDeleted=true、无误报", async () => {
    const sandbox = makeSandbox("r3-p0a-base", "project");
    const { entityPath } = await setupEntity(sandbox, "alpha");
    rmSync(entityPath, { recursive: true });

    const result = await deleteEntity({
      scope: "project",
      name: "alpha",
      expectedRevision: readState(sandbox.scopeBase).entities["alpha"]!.revision as string,
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", directoryDeleted: true });
    if (result.kind === "ok") {
      expect(result.entityPresentOnDisk).toBeUndefined();
      expect(result.warnings).toEqual([]);
    }
    expect(existsSync(entityPath)).toBe(false);
    expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
    cleanupSandbox(sandbox);
  });

  it("末投影 GC：CAS 等待窗口内同名重建 → 投影照常退役、实体记录退役、重建内容原样、gc.entityPresentOnDisk", async () => {
    const sandbox = makeSandbox("r3-p0a-gc", "project");
    const { entityPath } = await setupEntity(sandbox, "alpha");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    expect(
      (
        await projectEntity({
          scope: "project",
          name: "alpha",
          roots: [rootA],
          ...scopeOpts(sandbox),
        })
      ).kind
    ).toBe("ok");
    const skillBody = readFileSync(join(entityPath, "SKILL.md"), "utf8");
    // dangling 实体 + 断链投影（记录在、目标缺）
    rmSync(entityPath, { recursive: true });

    // 第 2 次 commit = 实体退役 CAS（第 1 次 = 投影记录退役）
    const barrier = injectAtCommit(2, () => recreateEntityDir(entityPath, skillBody));
    try {
      const result = await removeEntityProjections({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error(`unexpected: ${result.kind}`);
      expect(result.entityRemoved).toBe(false);
      expect(result.gc.entityDeleted).toBe(false);
      expect(result.gc.entityPresentOnDisk).toBe(true);
      expect(result.gc.warnings.join("\n")).toContain("reappeared on disk");
    } finally {
      barrier.restore();
    }

    expect(readFileSync(join(entityPath, "precious.txt"), "utf8")).toBe("not mine to delete\n");
    expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toBe(skillBody);
    const after = readState(sandbox.scopeBase);
    expect(after.entities["alpha"]).toBeUndefined(); // dangling 记录退役是合法动作
    expect(after.projections).toEqual({});
    cleanupSandbox(sandbox);
  });
});

describe("P0-B 销毁哈希复读窗口换体：第二次身份复核拒绝", () => {
  /** 第 2 次实体哈希 = destroyGuardedEntity 复读：返回定格哈希后换同内容新目录+加文件 */
  function armRehashBarrier(entityPath: string): { originalIno: number } {
    const originalIno = lstatSync(entityPath).ino;
    const skillBody = readFileSync(join(entityPath, "SKILL.md"), "utf8");
    let entityHashCalls = 0;
    setFolderHashHook(async (dir, real) => {
      if (dir !== entityPath) return real(dir);
      entityHashCalls += 1;
      const frozen = await real(dir); // 哈希值在此刻定格（换体前内容）
      if (entityHashCalls === 2) {
        // 读取屏障内换体：同内容新目录（新 inode）+ 非身份文件；返回定格哈希（stale）
        rmSync(entityPath, { recursive: true });
        recreateEntityDir(entityPath, skillBody);
      }
      return frozen;
    });
    return { originalIno };
  }

  it("deleteEntity：复读哈希等值但目录已换体 → 拒绝销毁、新目录与 precious 原样", async () => {
    const sandbox = makeSandbox("r3-p0b-del", "project");
    const { entityPath, revision } = await setupEntity(sandbox, "alpha");
    const { originalIno } = armRehashBarrier(entityPath);

    const result = await deleteEntity({
      scope: "project",
      name: "alpha",
      expectedRevision: revision,
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", directoryDeleted: false });
    if (result.kind === "ok") {
      expect(result.warnings.join("\n")).toContain("identity changed while re-hashing");
    }
    // 换体自证（新 inode）+ 换体内容未被删除
    expect(lstatSync(entityPath).ino).not.toBe(originalIno);
    expect(readFileSync(join(entityPath, "precious.txt"), "utf8")).toBe("not mine to delete\n");
    // state 已在销毁前退役（既有残留拓扑：未记录目录 + warning 如实）
    expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
    cleanupSandbox(sandbox);
  });

  it("末投影 GC：复读哈希等值但目录已换体 → GC 拒绝销毁、新目录原样", async () => {
    const sandbox = makeSandbox("r3-p0b-gc", "project");
    const { entityPath } = await setupEntity(sandbox, "alpha");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    expect(
      (
        await projectEntity({
          scope: "project",
          name: "alpha",
          roots: [rootA],
          ...scopeOpts(sandbox),
        })
      ).kind
    ).toBe("ok");
    const { originalIno } = armRehashBarrier(entityPath);

    const result = await removeEntityProjections({
      scope: "project",
      name: "alpha",
      roots: [rootA],
      ...scopeOpts(sandbox),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(`unexpected: ${result.kind}`);
    expect(result.entityRemoved).toBe(false);
    expect(result.gc.entityDeleted).toBe(false);
    expect(result.gc.warnings.join("\n")).toContain("identity changed while re-hashing");
    expect(lstatSync(entityPath).ino).not.toBe(originalIno);
    expect(readFileSync(join(entityPath, "precious.txt"), "utf8")).toBe("not mine to delete\n");
    cleanupSandbox(sandbox);
  });
});

describe("P1-D expectedEntityRevision 贯穿末投影 GC 退役", () => {
  it("验证后更新再删除（update 先于 remove）→ typed GUARD_ENTITY、投影/实体/state 零副作用", async () => {
    const sandbox = makeSandbox("r3-p1d-early", "project");
    const { source } = await setupEntity(sandbox, "alpha");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    expect(
      (
        await projectEntity({
          scope: "project",
          name: "alpha",
          roots: [rootA],
          ...scopeOpts(sandbox),
        })
      ).kind
    ).toBe("ok");
    const before = readState(sandbox.scopeBase);
    const observedRevision = before.entities["alpha"]!.revision as string;

    // 并发更新：实体换新（revision 变化、磁盘换新）
    rewriteSkillBody(source, "alpha", "v2-body\n");
    const updated = await updateEntity({
      scope: "project",
      name: "alpha",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(updated.kind).toBe("ok");

    // 旧观察 revision 的删除请求 → 入口闸 typed 拒绝，零副作用
    const result = await removeEntityProjections({
      scope: "project",
      name: "alpha",
      roots: [rootA],
      expectedEntityRevision: observedRevision,
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    expect(existsSync(join(rootA, "alpha"))).toBe(true); // 投影未动
    const after = readState(sandbox.scopeBase);
    expect(after.entities["alpha"]).toBeDefined(); // 实体未动
    expect(Object.keys(after.projections).length).toBe(1); // 投影记录未动
    expect(readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8")).toContain(
      "v2-body"
    );
    cleanupSandbox(sandbox);
  });

  it("门通过后提交前并发换新（CAS 屏障注入 updateEntity）→ typed GUARD_ENTITY、实体保留在新 revision", async () => {
    const sandbox = makeSandbox("r3-p1d-cas", "project");
    const { source } = await setupEntity(sandbox, "alpha");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    expect(
      (
        await projectEntity({
          scope: "project",
          name: "alpha",
          roots: [rootA],
          ...scopeOpts(sandbox),
        })
      ).kind
    ).toBe("ok");
    const observedRevision = readState(sandbox.scopeBase).entities["alpha"]!.revision as string;
    resetPinnedFdStats();
    rewriteSkillBody(source, "alpha", "v2-body\n");

    // 第 2 次 commit = 实体退役 CAS：入口先过（revision 匹配）+ 磁盘门通过后才被换新
    const barrier = injectAtCommit(2, async () => {
      const updated = await updateEntity({
        scope: "project",
        name: "alpha",
        source: { dir: source },
        ...scopeOpts(sandbox),
      });
      expect(updated.kind).toBe("ok");
    });
    let result: Awaited<ReturnType<typeof removeEntityProjections>>;
    try {
      result = await removeEntityProjections({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        expectedEntityRevision: observedRevision,
        ...scopeOpts(sandbox),
      });
    } finally {
      barrier.restore();
    }
    expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    if (result.kind === "error") {
      expect(result.message).toContain("re-read state and retry");
    }
    // 投影删除的磁盘事实如实发生（链已摘）；实体保留且已是新 revision 内容
    expect(existsSync(join(rootA, "alpha"))).toBe(false);
    const after = readState(sandbox.scopeBase);
    expect(after.entities["alpha"]).toBeDefined();
    expect(after.entities["alpha"]!.revision as string).not.toBe(observedRevision);
    expect(readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8")).toContain(
      "v2-body"
    );
    // P1-E：pinned fd 已关闭（typed 错误提前返回不泄漏）
    const fds = pinnedFdStats();
    expect(fds.opened).toBeGreaterThan(0);
    expect(fds.closed).toBe(fds.opened);
    cleanupSandbox(sandbox);
  });

  it("匹配基线：expectedEntityRevision === 当前 revision → GC 照常销毁实体（闸门不误伤）", async () => {
    const sandbox = makeSandbox("r3-p1d-clean", "project");
    const { entityPath } = await setupEntity(sandbox, "alpha");
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    expect(
      (
        await projectEntity({
          scope: "project",
          name: "alpha",
          roots: [rootA],
          ...scopeOpts(sandbox),
        })
      ).kind
    ).toBe("ok");
    const observedRevision = readState(sandbox.scopeBase).entities["alpha"]!.revision as string;

    const result = await removeEntityProjections({
      scope: "project",
      name: "alpha",
      roots: [rootA],
      expectedEntityRevision: observedRevision,
      ...scopeOpts(sandbox),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(`unexpected: ${result.kind}`);
    expect(result.entityRemoved).toBe(true);
    expect(result.gc.entityDeleted).toBe(true);
    expect(existsSync(entityPath)).toBe(false);
    expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
    cleanupSandbox(sandbox);
  });
});

describe("P1-E pin fd 生命周期与缺席 errno 纪律", () => {
  it("deleteEntity 退役 CAS 被拒（并发换新）→ typed GUARD_ENTITY 且 pinned fd 全关闭", async () => {
    const sandbox = makeSandbox("r3-p1e-fd", "project");
    const { source, revision } = await setupEntity(sandbox, "alpha");
    rewriteSkillBody(source, "alpha", "v2-body\n");
    resetPinnedFdStats();

    // 第 1 次 commit = deleteEntity 的退役 CAS：门 pinned 之后才被并发换新
    const barrier = injectAtCommit(1, async () => {
      const updated = await updateEntity({
        scope: "project",
        name: "alpha",
        source: { dir: source },
        ...scopeOpts(sandbox),
      });
      expect(updated.kind).toBe("ok");
    });
    let result: Awaited<ReturnType<typeof deleteEntity>>;
    try {
      result = await deleteEntity({
        scope: "project",
        name: "alpha",
        expectedRevision: revision,
        ...scopeOpts(sandbox),
      });
    } finally {
      barrier.restore();
    }
    expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
    const after = readState(sandbox.scopeBase);
    expect(after.entities["alpha"]).toBeDefined(); // 实体保留
    const fds = pinnedFdStats();
    expect(fds.opened).toBeGreaterThan(0);
    expect(fds.closed).toBe(fds.opened); // 无泄漏
    cleanupSandbox(sandbox);
  });

  it("lstatSafe：ENOENT/ENOTDIR → null（缺席）；EACCES → 上抛（不折叠为缺席）", () => {
    const sandbox = makeSandbox("r3-p1e-lstat", "project");
    // ENOENT：终条目缺席
    expect(lstatSafe(join(sandbox.workspace, "nope"))).toBeNull();
    // ENOTDIR：路径组件为非目录 → 目标不可能存在（[ -e ] 同语义）
    const file = join(sandbox.workspace, "plain-file");
    writeFileSync(file, "x\n");
    expect(lstatSafe(join(file, "child"))).toBeNull();
    // EACCES：父目录拒绝 search → 无法观察 ≠ 缺席，上抛
    if (process.getuid?.() !== 0) {
      const locked = join(sandbox.workspace, "locked");
      mkdirSync(locked, { recursive: true });
      chmodSync(locked, 0o000);
      try {
        let thrown: unknown;
        try {
          lstatSafe(join(locked, "entry"));
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as NodeJS.ErrnoException).code).toBe("EACCES");
      } finally {
        chmodSync(locked, 0o755); // 恢复以使 cleanupSandbox 可删除
      }
    }
    cleanupSandbox(sandbox);
  });

  it(
    "remove 逐根投影位 EACCES → typed IO 收据（记录不退役、路径不动）",
    { skipIf: process.getuid?.() === 0 },
    async () => {
      const sandbox = makeSandbox("r3-p1e-remove", "project");
      await setupEntity(sandbox, "alpha");
      const rootA = join(sandbox.workspace, "agents-a", "skills");
      expect(
        (
          await projectEntity({
            scope: "project",
            name: "alpha",
            roots: [rootA],
            ...scopeOpts(sandbox),
          })
        ).kind
      ).toBe("ok");
      const before = readState(sandbox.scopeBase);

      chmodSync(rootA, 0o000); // 拒绝 search → 投影位 lstat EACCES
      try {
        const result = await removeEntityProjections({
          scope: "project",
          name: "alpha",
          roots: [rootA],
          ...scopeOpts(sandbox),
        });
        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") throw new Error(`unexpected: ${result.kind}`);
        expect(result.results[0]).toMatchObject({ status: "failed", errorCode: "IO" });
        expect(result.results[0].error).toContain("failed to inspect");
      } finally {
        chmodSync(rootA, 0o755);
      }
      const after = readState(sandbox.scopeBase);
      expect(after.projections).toEqual(before.projections); // 记录未退役
      expect(existsSync(join(rootA, "alpha"))).toBe(true); // 路径未动
      cleanupSandbox(sandbox);
    }
  );

  it(
    "gc 注册根父目录 EACCES → typed IO 拒绝（不可观察 ≠ root-vanished 提案）",
    { skipIf: process.getuid?.() === 0 },
    async () => {
      const sandbox = makeSandbox("r3-p1e-gc", "project");
      await setupEntity(sandbox, "alpha");
      const agentsA = join(sandbox.workspace, "agents-a");
      const rootA = join(agentsA, "skills");
      expect(
        (
          await projectEntity({
            scope: "project",
            name: "alpha",
            roots: [rootA],
            ...scopeOpts(sandbox),
          })
        ).kind
      ).toBe("ok");

      chmodSync(agentsA, 0o000); // lstat(rootA) 需要 agents-a 的 search 权限
      let result: Awaited<ReturnType<typeof gcPropose>>;
      try {
        result = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
      } finally {
        chmodSync(agentsA, 0o755);
      }
      expect(result).toMatchObject({ kind: "error", code: "IO" });
      if (result.kind === "error") {
        expect(result.message).toContain("no retirement proposals were made");
      }
      cleanupSandbox(sandbox);
    }
  );

  it(
    "deleteEntity 显式复核根条目 EACCES → GC_UNKNOWN_REFERENCE 保守拒绝（fail closed）",
    { skipIf: process.getuid?.() === 0 },
    async () => {
      const sandbox = makeSandbox("r3-p1e-classify", "project");
      const { entityPath, revision } = await setupEntity(sandbox, "alpha");
      const agentsA = join(sandbox.workspace, "agents-a");
      const rootA = join(agentsA, "skills");
      mkdirSync(rootA, { recursive: true });
      const before = readState(sandbox.scopeBase);

      chmodSync(agentsA, 0o000); // classifyReferences 的 lstat(rootA/alpha) EACCES
      let result: Awaited<ReturnType<typeof deleteEntity>>;
      try {
        result = await deleteEntity({
          scope: "project",
          name: "alpha",
          expectedRevision: revision,
          roots: [rootA],
          ...scopeOpts(sandbox),
        });
      } finally {
        chmodSync(agentsA, 0o755);
      }
      expect(result).toMatchObject({ kind: "error", code: "GC_UNKNOWN_REFERENCE" });
      if (result.kind === "error") {
        expect(result.message).toContain("unreadable");
      }
      // 实体与 state 零副作用（无法验证的引用保守阻塞删除）
      expect(existsSync(entityPath)).toBe(true);
      expect(readState(sandbox.scopeBase).entities["alpha"]).toEqual(before.entities["alpha"]);
      cleanupSandbox(sandbox);
    }
  );
});

// ---------------------------------------------------------------------------
// 实体表按记录降级（终审第三轮补：MainAgent 探针实证）——损坏实体记录被
// parseEntityTable 丢弃时，四个按名解析 API 不得谎报 ENTITY_NOT_FOUND（宿主会
// 把「未登记」当 legacy 处置）；缺席不可证明 → STATE_RECOVERY_REQUIRED。
// ---------------------------------------------------------------------------
describe("entity table degraded (per-record corruption)", () => {
  it("updateEntity：损坏实体记录 → STATE_RECOVERY_REQUIRED（不是 ENTITY_NOT_FOUND）", async () => {
    const sandbox = makeSandbox("r3-etd-upd", "project");
    try {
      const srcV1 = writeSkillSource(sandbox.workspace, "skill-a", "body v1");
      const ensured = await ensureEntity({
        scope: "project",
        workspaceDir: sandbox.workspace,
        source: { dir: srcV1 },
      });
      expect(ensured.kind).toBe("ok");
      const state = readState(sandbox.scopeBase);
      const key = Object.keys(state.entities)[0] as string;
      (state.entities[key] as Record<string, unknown>).revision = 12345; // 非法类型
      writeState(sandbox.scopeBase, state);
      const srcV2 = writeSkillSource(sandbox.workspace, "skill-a", "body v2");
      const updated = await updateEntity({
        scope: "project",
        workspaceDir: sandbox.workspace,
        name: "skill-a",
        source: { dir: srcV2 },
      });
      expect(updated).toMatchObject({
        kind: "error",
        code: "STATE_RECOVERY_REQUIRED",
      });
      // 实体内容与磁盘原样（未被 legacy 迁移处置）
      expect(readFileSync(join(sandbox.entityRoot, "skill-a", "SKILL.md"), "utf8")).toContain("body v1");
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it("removeEntityProjections / deleteEntity / toggleEntityProjection 同降级；干净未登记基线仍 ENTITY_NOT_FOUND", async () => {
    const sandbox = makeSandbox("r3-etd-rm", "project");
    try {
      const srcDir = writeSkillSource(sandbox.workspace, "skill-a", "body v1");
      const ensured = await ensureEntity({
        scope: "project",
        workspaceDir: sandbox.workspace,
        source: { dir: srcDir },
      });
      expect(ensured.kind).toBe("ok");
      const projected = await projectEntity({
        scope: "project",
        workspaceDir: sandbox.workspace,
        name: "skill-a",
        roots: [join(sandbox.workspace, "prov")],
      });
      expect(projected.kind).toBe("ok");
      const state = readState(sandbox.scopeBase);
      const key = Object.keys(state.entities)[0] as string;
      const originalRevision = (state.entities[key] as Record<string, unknown>).revision;
      delete (state.entities[key] as Record<string, unknown>).revision; // 必填缺失
      writeState(sandbox.scopeBase, state);
      const roots = [join(sandbox.workspace, "prov")];
      const removed = await removeEntityProjections({
        scope: "project",
        workspaceDir: sandbox.workspace,
        name: "skill-a",
        roots,
      });
      expect(removed).toMatchObject({ kind: "error", code: "STATE_RECOVERY_REQUIRED" });
      const deleted = await deleteEntity({
        scope: "project",
        workspaceDir: sandbox.workspace,
        name: "skill-a",
        expectedRevision: "whatever",
      });
      expect(deleted).toMatchObject({ kind: "error", code: "STATE_RECOVERY_REQUIRED" });
      const toggled = await toggleEntityProjection({
        scope: "project",
        workspaceDir: sandbox.workspace,
        name: "skill-a",
        root: roots[0] as string,
        action: "disable",
      });
      expect(toggled).toMatchObject({ kind: "error", code: "STATE_RECOVERY_REQUIRED" });
      // 磁盘全原样：实体 + 投影
      expect(existsSync(join(sandbox.entityRoot, "skill-a", "SKILL.md"))).toBe(true);
      expect(existsSync(join(sandbox.workspace, "prov", "skill-a"))).toBe(true);
      // 干净基线：复原实体记录后，未登记名仍如实 ENTITY_NOT_FOUND
      const restored = readState(sandbox.scopeBase);
      (restored.entities[key] as Record<string, unknown>).revision = originalRevision;
      writeState(sandbox.scopeBase, restored);
      const clean = await updateEntity({
        scope: "project",
        workspaceDir: sandbox.workspace,
        name: "never-registered",
        source: { dir: srcDir },
      });
      expect(clean).toMatchObject({ kind: "error", code: "ENTITY_NOT_FOUND" });
    } finally {
      cleanupSandbox(sandbox);
    }
  });
});
