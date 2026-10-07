/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「G3 API 契约收据：测试矩阵——ensureEntity 正/NAME_COLLISION/
 * NAME_EXISTS+replace 全状态机（含回滚）/GUARD_ENTITY；projectEntity link 正/物化三
 * reason/降级分类（EPERM 用受限环境或注入 seam 构造，如实记录构造方法）/TARGET_DENIED/
 * strict/占用拒绝；状态记账与 CAS 联动；与批 2 发现层互证」+ G3 裁决中继补场景：
 * 「canonical root → entity-local 收据、磁盘与 projection state 均无额外变化、幂等、
 * requestedMode 保留」
 * 正交意图：
 *   [1] G3 门收据：ensureEntity/projectEntity 全 typed 路径（真磁盘 fixture：tmp 沙箱 +
 *       真 symlink + 真 state 提交；不 mock fs）
 *   [2] replace 冻结状态机 R1-R11 逐步对照（g0/state-machine-consistency-checklist.md
 *       编号；R5 crash window 归批 4 G4，本文件不冒充）
 *   [3] 降级分类真构造（如实记录构造方法）：a) seam 构造（brief 授权「注入 seam」）=
 *       symlinkImpl 注入真实 errno 的 EPERM/ENOSYS——平台无法只对 symlink() 拒绝而
 *       放行文件创建，seam 是端到端降级成功路径的唯一确定性入口，除该单点外全链路
 *       真实；b) 真内核构造 = chflags uchg（macOS 实证 symlink() 与 staging 复制双
 *       双 EPERM）→ 钉「降级尝试仍被目标拒绝 = TARGET_DENIED 不静默」；c) EACCES =
 *       chmod 0555（root 下不可构造 → skipIf euid 0）
 *   [4] entity-local 第四形态（G3 裁决 commit a465dc1）：canonical root 收据/幂等/
 *       零副作用/requestedMode 保留 + 发现层互证（实体 = entity-local，物化副本 =
 *       materialized）
 * 妥协声明：R4 的 swap 中断回滚不经生产测试钩子——以真实 rename 失败构造：全路径
 * 前置失败（uchg 实体目录 → backup rename EPERM）+ 原语级后置失败（staging 消失 →
 * 最终 rename ENOENT → backup 回滚）；恢复也失败的形态在无特权环境不可确定性构造，
 * 如实留白不冒充。
 */
import { execSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEntity,
  projectEntity,
  swapEntityIntoPlace,
  type EnsureEntityResult,
} from "../src/api/entity.js";
import { discoverSkills } from "../src/core/discovery.js";
import { computeSkillFolderHash } from "../src/core/folder-hash.js";
import {
  projectionRootId,
  sanitizeEntityFolderName,
} from "../src/core/entity-state.js";
import {
  CCSKI_STATE_FILENAME,
  CCSKI_STATE_SCHEMA_VERSION,
} from "../src/core/state-store.js";

function real(path: string): string {
  return realpathSync(path);
}

interface Sandbox {
  home: string;
  workspace: string;
  scopeBase: string;
  entityRoot: string;
}

function makeSandbox(prefix: string, scope: "global" | "project"): Sandbox {
  const home = mkdtempSync(join(tmpdir(), `ccski-g3-home-${prefix}-`));
  const workspace = mkdtempSync(join(tmpdir(), `ccski-g3-ws-${prefix}-`));
  const base = scope === "global" ? join(home, ".agents") : join(workspace, ".agents");
  return { home, workspace, scopeBase: base, entityRoot: join(base, "skills") };
}

function cleanupSandbox(sandbox: Sandbox): void {
  rmSync(sandbox.home, { recursive: true, force: true });
  rmSync(sandbox.workspace, { recursive: true, force: true });
}

let skillCounter = 0;

function writeSkillSource(
  parent: string,
  name: string,
  body = "Body\n",
  extraFile?: string
): string {
  skillCounter += 1;
  const dir = join(parent, `src-${skillCounter}-${name.replace(/[^a-z0-9]/gi, "-")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: G3 fixture skill ${name}\n---\n${body}`
  );
  if (extraFile !== undefined) writeFileSync(join(dir, extraFile), "extra\n");
  return dir;
}

interface RawState {
  schemaVersion: number;
  generation: number;
  entities: Record<string, Record<string, unknown>>;
  projections: Record<string, Record<string, unknown>>;
}

function readState(scopeBase: string): RawState {
  return JSON.parse(readFileSync(join(scopeBase, CCSKI_STATE_FILENAME), "utf8")) as RawState;
}

function writeState(scopeBase: string, state: RawState): void {
  writeFileSync(
    join(scopeBase, CCSKI_STATE_FILENAME),
    `${JSON.stringify(state, null, 2)}\n`
  );
}

function scopeOpts(sandbox: Sandbox) {
  return { userDir: sandbox.home, workspaceDir: sandbox.workspace };
}

/** 正常 ok 结果的窄化助手（测试断言可读性） */
function expectOk(result: EnsureEntityResult): Extract<EnsureEntityResult, { kind: "ok" }> {
  expect(result.kind).toBe("ok");
  return result as Extract<EnsureEntityResult, { kind: "ok" }>;
}

/** 建实体 fixture：写入 source 并 ensureEntity（project scope） */
async function setupEntity(sandbox: Sandbox, name = "alpha", body = "v1\n") {
  const source = writeSkillSource(sandbox.workspace, name, body);
  const ok = expectOk(
    await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) })
  );
  return { ok, source };
}

// ---------------------------------------------------------------------------
// 降级分类的真构造探针（模块加载期一次性；如实记录构造方法）
// ---------------------------------------------------------------------------

/** EPERM 构造：macOS chflags uchg 目录内 symlink() → EPERM（2026-10-07 实证探针） */
function probeChflagsEperm(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "ccski-g3-chflags-probe-"));
  try {
    execSync(`chflags uchg ${JSON.stringify(probe)}`);
    try {
      symlinkSync("/tmp/ccski-g3-probe-target", join(probe, "link"));
      return false; // 未失败 = 构造不可用
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  } catch {
    return false; // chflags 不可用（非 macOS / 受限环境）
  } finally {
    try {
      execSync(`chflags nouchg ${JSON.stringify(probe)}`);
    } catch {
      // ignore
    }
    rmSync(probe, { recursive: true, force: true });
  }
}

const CHFLAGS_EPERM_AVAILABLE = probeChflagsEperm();
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

// ---------------------------------------------------------------------------
// ensureEntity：词表与基本路径
// ---------------------------------------------------------------------------

describe("ensureEntity (G3 契约收据)", () => {
  it("SCOPE_REQUIRED：缺 scope typed 拒绝且零文件系统/state 副作用", async () => {
    const sandbox = makeSandbox("scope", "project");
    const source = writeSkillSource(sandbox.workspace, "alpha");
    const result = await ensureEntity({ source: { dir: source }, ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "error", code: "SCOPE_REQUIRED" });
    expect(existsSync(sandbox.scopeBase)).toBe(false);
    expect(existsSync(sandbox.entityRoot)).toBe(false);
    cleanupSandbox(sandbox);
  });

  it("create：实体落盘 + state 记账（revision = folder-hash）+ 无 staging/backup 残留", async () => {
    const sandbox = makeSandbox("create", "project");
    const source = writeSkillSource(sandbox.workspace, "alpha");
    const ok = expectOk(
      await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) })
    );
    expect(ok.status).toBe("created");
    expect(ok.generation).toBe(1);
    expect(ok.lockSyncPending).toBe(true);

    const entityPath = join(sandbox.entityRoot, "alpha");
    expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toContain("name: alpha");
    expect(ok.entity.path).toBe(entityPath);
    expect(ok.entity.revision).toBe(await computeSkillFolderHash(entityPath));

    const state = readState(sandbox.scopeBase);
    expect(state.schemaVersion).toBe(CCSKI_STATE_SCHEMA_VERSION);
    const record = state.entities["alpha"] as Record<string, unknown>;
    expect(record).toMatchObject({
      kind: "entity",
      scope: "project",
      logicalName: "alpha",
      folderName: "alpha",
      path: entityPath,
    });
    expect(record.revision).toBe(ok.entity.revision);
    // provenance.source = source 身份原样（本地缺省 = resolve(dir)，与传入字符串一致）
    expect((record.provenance as Record<string, unknown>).source).toBe(source);

    // 无残留（staging/backup 已清理；实体根只有实体目录本身）
    const rootEntries = readdirSync(sandbox.entityRoot);
    expect(rootEntries.filter((n) => n.startsWith(".ccski-"))).toEqual([]);
    cleanupSandbox(sandbox);
  });

  it.each([
    ["My Skill", "my-skill"], // 集合外游程（空格）→ 连字符
    ["my_skill", "my_skill"], // dist 语义：下划线保留（cli.mjs:2183 亲验钉值）
    ["my.skill.v2", "my.skill.v2"], // dist 语义：点保留
    ["FOO", "foo"], // lowercase
    ["-lead.trail-", "lead.trail"], // 首尾 ./- 剥离
    ["café", "caf"], // é 在集合外 → 连字符 → 尾部剥离
    ["   ", "unnamed-skill"], // 空结果回退
    ["a".repeat(300), "a".repeat(255)], // 255 截断
  ])("冻结 sanitize（npm 1.7.1 dist 镜像）：%s → %s", (input, expected) => {
    expect(sanitizeEntityFolderName(input)).toBe(expected);
  });

  it("NAME_COLLISION：两个逻辑名 sanitize 同目录 → typed 拒绝且第一个实体不动", async () => {
    const sandbox = makeSandbox("collision", "project");
    const first = expectOk(
      await ensureEntity({
        scope: "project",
        source: { dir: writeSkillSource(sandbox.workspace, "My Skill") },
        ...scopeOpts(sandbox),
      })
    );
    const generationBefore = readState(sandbox.scopeBase).generation;
    const entityBefore = readFileSync(join(sandbox.entityRoot, "my-skill", "SKILL.md"), "utf8");

    // "MY SKILL" 与 "My Skill" 是不同逻辑名、同落 "my-skill"（dist 语义下真正
    // 碰撞的输入对；"my_skill" 保留下划线不与 "my-skill" 碰撞——不再是碰撞用例）
    const second = await ensureEntity({
      scope: "project",
      source: { dir: writeSkillSource(sandbox.workspace, "MY SKILL") },
      ...scopeOpts(sandbox),
    });
    expect(second).toMatchObject({ kind: "error", code: "NAME_COLLISION" });
    if (second.kind === "error") {
      expect(second.existing?.logicalName).toBe("My Skill");
      expect(second.existing?.folderName).toBe("my-skill");
    }
    // 第一个实体不动：内容与 state generation 原样
    expect(readFileSync(join(sandbox.entityRoot, "my-skill", "SKILL.md"), "utf8")).toBe(entityBefore);
    expect(readState(sandbox.scopeBase).generation).toBe(generationBefore);
    expect(first.entity.folderName).toBe("my-skill");
    cleanupSandbox(sandbox);
  });

  it("exists：同逻辑名同 source 幂等返回且不重写实体/不推进 generation", async () => {
    const sandbox = makeSandbox("exists", "project");
    const source = writeSkillSource(sandbox.workspace, "alpha", "Old body\n");
    const created = expectOk(
      await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) })
    );
    const stateBefore = readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8");

    // source 内容已变：exists 是「已确保」语义，不做更新（更新归批 4 / 显式 replace）
    writeFileSync(join(source, "SKILL.md"), "---\nname: alpha\ndescription: changed\n---\nNew body\n");
    const again = expectOk(
      await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) })
    );
    expect(again.status).toBe("exists");
    expect(again.generation).toBe(created.generation);
    expect(again.entity.revision).toBe(created.entity.revision);
    expect(readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8")).toContain("Old body");
    expect(readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8")).toBe(stateBefore);
    cleanupSandbox(sandbox);
  });

  it("NAME_EXISTS：同名不同 source 无 replace typed 拒绝，附 existing 供构造 replace", async () => {
    const sandbox = makeSandbox("name-exists", "project");
    const first = expectOk(
      await ensureEntity({
        scope: "project",
        source: { dir: writeSkillSource(sandbox.workspace, "alpha", "v1\n") },
        ...scopeOpts(sandbox),
      })
    );
    const before = readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8");

    const second = await ensureEntity({
      scope: "project",
      source: { dir: writeSkillSource(sandbox.workspace, "alpha", "v2\n") },
      ...scopeOpts(sandbox),
    });
    expect(second).toMatchObject({ kind: "error", code: "NAME_EXISTS" });
    if (second.kind === "error") {
      expect(second.existing?.revision).toBe(first.entity.revision);
      expect(second.existing?.expectedRevision).toBe(first.entity.revision);
    }
    expect(readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8")).toBe(before);
    cleanupSandbox(sandbox);
  });

  it("GUARD_ENTITY：replace 缺 expectedRevision 或不符 → typed 拒绝且实体不动", async () => {
    const sandbox = makeSandbox("guard", "project");
    const created = expectOk(
      await ensureEntity({
        scope: "project",
        source: { dir: writeSkillSource(sandbox.workspace, "alpha", "v1\n") },
        ...scopeOpts(sandbox),
      })
    );
    const before = readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8");
    const generationBefore = readState(sandbox.scopeBase).generation;

    const missing = await ensureEntity({
      scope: "project",
      source: { dir: writeSkillSource(sandbox.workspace, "alpha", "v2\n") },
      replace: {} as { expectedRevision: string },
      ...scopeOpts(sandbox),
    });
    expect(missing).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });

    const mismatched = await ensureEntity({
      scope: "project",
      source: { dir: writeSkillSource(sandbox.workspace, "alpha", "v2\n") },
      replace: { expectedRevision: "deadbeef" },
      ...scopeOpts(sandbox),
    });
    expect(mismatched).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });

    expect(readFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "utf8")).toBe(before);
    expect(readState(sandbox.scopeBase).generation).toBe(generationBefore);
    expect(created.entity.revision).not.toBe("deadbeef");
    cleanupSandbox(sandbox);
  });

  it.each([
    ["SOURCE_NOT_FOUND", (sb: Sandbox) => ({ dir: join(sb.workspace, "no-such-dir") })],
    ["SOURCE_NOT_DIRECTORY", (sb: Sandbox) => {
      const file = join(sb.workspace, "plain-file.txt");
      writeFileSync(file, "x");
      return { dir: file };
    }],
    ["SOURCE_INVALID", (sb: Sandbox) => {
      const dir = join(sb.workspace, "no-skill-md");
      mkdirSync(dir, { recursive: true });
      return { dir };
    }],
  ])("source 校验：%s", async (code, makeSource) => {
    const sandbox = makeSandbox(`src-${code}`, "project");
    const result = await ensureEntity({
      scope: "project",
      source: makeSource(sandbox) as { dir: string },
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "error", code });
    expect(existsSync(sandbox.entityRoot)).toBe(false);
    cleanupSandbox(sandbox);
  });

  it("SOURCE_SYMLINK：symlink 源 typed 拒绝", async () => {
    const sandbox = makeSandbox("src-symlink", "project");
    const realDir = writeSkillSource(sandbox.workspace, "alpha");
    const link = join(sandbox.workspace, "alpha-link");
    symlinkSync(realDir, link);
    const result = await ensureEntity({
      scope: "project",
      source: { dir: link },
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "error", code: "SOURCE_SYMLINK" });
    cleanupSandbox(sandbox);
  });

  it("ENTITY_PATH_OCCUPIED：无记录目录占据实体路径 → typed 拒绝（adoption 归批 5 migrate）", async () => {
    const sandbox = makeSandbox("occupied", "project");
    mkdirSync(join(sandbox.entityRoot, "alpha"), { recursive: true });
    writeFileSync(join(sandbox.entityRoot, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: legacy\n---\n");
    const result = await ensureEntity({
      scope: "project",
      source: { dir: writeSkillSource(sandbox.workspace, "alpha") },
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "error", code: "ENTITY_PATH_OCCUPIED" });
    cleanupSandbox(sandbox);
  });

  it("CAS 联动：双并发 ensure（不同名）恰经重读重建收敛，generation 严格推进", async () => {
    const sandbox = makeSandbox("cas", "project");
    const [a, b] = await Promise.all([
      ensureEntity({ scope: "project", source: { dir: writeSkillSource(sandbox.workspace, "alpha") }, ...scopeOpts(sandbox) }),
      ensureEntity({ scope: "project", source: { dir: writeSkillSource(sandbox.workspace, "beta") }, ...scopeOpts(sandbox) }),
    ]);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    const state = readState(sandbox.scopeBase);
    expect(state.generation).toBe(2);
    expect(Object.keys(state.entities).sort()).toEqual(["alpha", "beta"]);
    expect([a, b].map((r) => (r.kind === "ok" ? r.generation : -1)).sort()).toEqual([1, 2]);
    cleanupSandbox(sandbox);
  });

  it("state 提交原语保留不兼容 raw 条目（集合丢弃≠破坏性清理）", async () => {
    const sandbox = makeSandbox("raw-keep", "project");
    mkdirSync(sandbox.scopeBase, { recursive: true });
    writeState(sandbox.scopeBase, {
      schemaVersion: CCSKI_STATE_SCHEMA_VERSION,
      generation: 5,
      entities: { garbage: { whatever: true } },
      projections: {},
    });
    const ok = expectOk(
      await ensureEntity({
        scope: "project",
        source: { dir: writeSkillSource(sandbox.workspace, "alpha") },
        ...scopeOpts(sandbox),
      })
    );
    expect(ok.generation).toBe(6);
    const state = readState(sandbox.scopeBase);
    expect(state.entities["garbage"]).toEqual({ whatever: true });
    expect(state.entities["alpha"]).toBeDefined();
    cleanupSandbox(sandbox);
  });
});

// ---------------------------------------------------------------------------
// projectEntity：形态、降级分类、占用拒绝、entity-local
// ---------------------------------------------------------------------------

describe("projectEntity (G3 契约收据)", () => {
  it("SCOPE_REQUIRED / INVALID_ROOTS / INVALID_MODE / ENTITY_NOT_FOUND / ENTITY_MISSING", async () => {
    const sandbox = makeSandbox("proj-vocab", "project");
    const { ok } = await setupEntity(sandbox);

    const noScope = await projectEntity({ name: "alpha", roots: [sandbox.workspace], ...scopeOpts(sandbox) });
    expect(noScope).toMatchObject({ kind: "error", code: "SCOPE_REQUIRED" });

    const noRoots = await projectEntity({ scope: "project", name: "alpha", roots: [], ...scopeOpts(sandbox) });
    expect(noRoots).toMatchObject({ kind: "error", code: "INVALID_ROOTS" });

    const noReason = await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [sandbox.workspace],
      mode: "materialized",
      ...scopeOpts(sandbox),
    } as never);
    expect(noReason).toMatchObject({ kind: "error", code: "INVALID_MODE" });

    const reasonWithLink = await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [sandbox.workspace],
      mode: "link",
      reason: "user-request",
      ...scopeOpts(sandbox),
    } as never);
    expect(reasonWithLink).toMatchObject({ kind: "error", code: "INVALID_MODE" });

    const unknown = await projectEntity({ scope: "project", name: "ghost", roots: [sandbox.workspace], ...scopeOpts(sandbox) });
    expect(unknown).toMatchObject({ kind: "error", code: "ENTITY_NOT_FOUND" });

    // 实体磁盘消失 → ENTITY_MISSING（恢复归批 4/5）
    rmSync(join(sandbox.entityRoot, "alpha"), { recursive: true, force: true });
    const missing = await projectEntity({ scope: "project", name: "alpha", roots: [sandbox.workspace], ...scopeOpts(sandbox) });
    expect(missing).toMatchObject({ kind: "error", code: "ENTITY_MISSING" });
    void ok;
    cleanupSandbox(sandbox);
  });

  it("link 正路径：symlink 指向实体路径 + state 投影记账（path/mode/entityRevision/disabled=false）", async () => {
    const sandbox = makeSandbox("proj-link", "project");
    const { ok } = await setupEntity(sandbox);
    const rootA = join(sandbox.workspace, "agents-a", "skills");

    const result = await projectEntity({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "ok", projected: 1, unchanged: 0, failed: 0 });
    if (result.kind !== "ok") return;
    const entry = result.results[0];
    expect(entry).toMatchObject({ status: "projected", mode: "link", targetKind: "projection" });
    expect(entry?.reason).toBeUndefined();

    const linkPath = join(rootA, "alpha");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(linkPath)).toBe(ok.entity.path); // 绝对目标

    const state = readState(sandbox.scopeBase);
    const record = state.projections[`${entry?.rootId}:alpha`] as Record<string, unknown>;
    expect(record).toMatchObject({
      kind: "projection",
      mode: "link",
      disabled: false,
      ownership: "ccski",
      entityRevision: ok.entity.revision,
      path: linkPath,
      rootPath: rootA, // rootId/rootPath = resolve 归一形态（非 realpath）
    });
    expect(entry?.rootId).toBe(projectionRootId(rootA));
    expect(result.generation).toBe(2);
    cleanupSandbox(sandbox);
  });

  it("unchanged 幂等：重复投影零 state 写入、generation 不动", async () => {
    const sandbox = makeSandbox("proj-idem", "project");
    await setupEntity(sandbox);
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) });
    const stateBefore = readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8");

    const again = await projectEntity({ scope: "project", name: "alpha", roots: [rootA], ...scopeOpts(sandbox) });
    expect(again).toMatchObject({ kind: "ok", unchanged: 1, projected: 0, failed: 0 });
    if (again.kind === "ok") expect(again.generation).toBe(2); // 无提交 → 返回读到的 generation
    expect(readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8")).toBe(stateBefore);
    cleanupSandbox(sandbox);
  });

  it("物化三显式 reason（pinned/imported-root/user-request）：真复制 + 记账 reason", async () => {
    for (const reason of ["pinned", "imported-root", "user-request"] as const) {
      const sandbox = makeSandbox(`proj-mat-${reason}`, "project");
      const { ok } = await setupEntity(sandbox, `mat-${reason}`);
      const root = join(sandbox.workspace, "agents-m", "skills");
      const result = await projectEntity({
        scope: "project",
        name: `mat-${reason}`,
        roots: [root],
        mode: "materialized",
        reason,
        ...scopeOpts(sandbox),
      });
      expect(result).toMatchObject({ kind: "ok", projected: 1 });
      if (result.kind !== "ok") continue;
      expect(result.results[0]).toMatchObject({ status: "projected", mode: "materialized", reason });

      const copyPath = join(root, `mat-${reason}`);
      expect(lstatSync(copyPath).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(copyPath, "SKILL.md"), "utf8")).toContain(`name: mat-${reason}`);
      const record = readState(sandbox.scopeBase).projections[`${result.results[0]?.rootId}:mat-${reason}`] as Record<string, unknown>;
      expect(record).toMatchObject({ mode: "materialized", reason, entityRevision: ok.entity.revision, disabled: false });
      cleanupSandbox(sandbox);
    }
  });

  it("PROJECTION_PATH_OCCUPIED：实目录/异源 symlink/文件占据投影路径 → typed 拒绝不清障", async () => {
    const sandbox = makeSandbox("proj-occupied", "project");
    await setupEntity(sandbox);
    const root = join(sandbox.workspace, "agents-x", "skills");
    mkdirSync(join(root, "alpha"), { recursive: true });
    writeFileSync(join(root, "alpha", "user-data.txt"), "precious\n");

    let result = await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "ok", failed: 1, projected: 0 });
    expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("PROJECTION_PATH_OCCUPIED");
    expect(readFileSync(join(root, "alpha", "user-data.txt"), "utf8")).toBe("precious\n");

    // 异源 symlink（指向非实体）
    const foreignRoot = join(sandbox.workspace, "agents-y", "skills");
    mkdirSync(foreignRoot, { recursive: true });
    symlinkSync(join(sandbox.workspace, "elsewhere"), join(foreignRoot, "alpha"));
    result = await projectEntity({ scope: "project", name: "alpha", roots: [foreignRoot], ...scopeOpts(sandbox) });
    expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("PROJECTION_PATH_OCCUPIED");
    expect(readlinkSync(join(foreignRoot, "alpha"))).toBe(join(sandbox.workspace, "elsewhere"));

    // 普通文件占据
    const fileRoot = join(sandbox.workspace, "agents-z", "skills");
    mkdirSync(fileRoot, { recursive: true });
    writeFileSync(join(fileRoot, "alpha"), "not-a-dir");
    result = await projectEntity({ scope: "project", name: "alpha", roots: [fileRoot], ...scopeOpts(sandbox) });
    expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("PROJECTION_PATH_OCCUPIED");

    // 占用拒绝零 state 写入
    expect(readState(sandbox.scopeBase).projections).toEqual({});
    cleanupSandbox(sandbox);
  });

  it("MODE_CONFLICT / PROJECTION_DISABLED：已记录形态的 typed 拒绝", async () => {
    const sandbox = makeSandbox("proj-mode", "project");
    await setupEntity(sandbox);
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });

    const switched = await projectEntity({
      scope: "project", name: "alpha", roots: [root], mode: "materialized", reason: "user-request", ...scopeOpts(sandbox),
    });
    expect(switched.kind === "ok" ? switched.results[0]?.errorCode : null).toBe("MODE_CONFLICT");

    // 物化投影 → 请求 link 同样 MODE_CONFLICT
    const matRoot = join(sandbox.workspace, "agents-b", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [matRoot], mode: "materialized", reason: "user-request", ...scopeOpts(sandbox) });
    const backToLink = await projectEntity({ scope: "project", name: "alpha", roots: [matRoot], ...scopeOpts(sandbox) });
    expect(backToLink.kind === "ok" ? backToLink.results[0]?.errorCode : null).toBe("MODE_CONFLICT");

    // disabled 记录（批 4 toggle 的物理禁用形态）→ 拒绝静默重建
    const state = readState(sandbox.scopeBase);
    const disabledKey = `${projectionRootId(root)}:alpha`;
    (state.projections[disabledKey] as Record<string, unknown>).disabled = true;
    writeState(sandbox.scopeBase, state);
    rmSync(join(root, "alpha"));
    const disabled = await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    expect(disabled.kind === "ok" ? disabled.results[0]?.errorCode : null).toBe("PROJECTION_DISABLED");
    expect(existsSync(join(root, "alpha"))).toBe(false);
    cleanupSandbox(sandbox);
  });

  it("投影根形态：缺失自动建 / symlink 根 ROOT_SYMLINK / 文件根 ROOT_NOT_DIRECTORY", async () => {
    const sandbox = makeSandbox("proj-roots", "project");
    await setupEntity(sandbox);
    const fresh = join(sandbox.workspace, "deep", "nested", "skills");
    let result = await projectEntity({ scope: "project", name: "alpha", roots: [fresh], ...scopeOpts(sandbox) });
    expect(result).toMatchObject({ kind: "ok", projected: 1 });
    expect(existsSync(join(fresh, "alpha"))).toBe(true);

    const linkRootParent = join(sandbox.workspace, "link-root");
    mkdirSync(linkRootParent, { recursive: true });
    const realRoot = join(sandbox.workspace, "real-root");
    mkdirSync(realRoot, { recursive: true });
    symlinkSync(realRoot, join(linkRootParent, "skills"));
    result = await projectEntity({ scope: "project", name: "alpha", roots: [join(linkRootParent, "skills")], ...scopeOpts(sandbox) });
    expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("ROOT_SYMLINK");

    const fileRoot = join(sandbox.workspace, "file-root");
    writeFileSync(fileRoot, "x");
    result = await projectEntity({ scope: "project", name: "alpha", roots: [fileRoot], ...scopeOpts(sandbox) });
    expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("ROOT_NOT_DIRECTORY");
    cleanupSandbox(sandbox);
  });

  // ---- 降级分类真构造 ----
  // 构造方法如实记录：
  // a) seam 构造（brief 授权「注入 seam」）：symlinkImpl 注入真实 errno 的 EPERM/
  //    ENOSYS——平台无法只对 symlink() 拒绝而放行文件创建，seam 是端到端降级成功
  //    路径的唯一确定性入口；除该单点外全链路真实（真复制、真 state 提交）。
  // b) 真内核构造（chflags uchg）：symlink() 与 staging 复制双双 EPERM（不可变
  //    目录拒绝一切条目创建）→ 钉「降级尝试仍被目标拒绝 = TARGET_DENIED 不静默」。

  function errnoFail(code: string): (target: string, path: string) => void {
    return () => {
      const error: NodeJS.ErrnoException = new Error(`Operation not permitted (${code})`);
      error.code = code;
      throw error;
    };
  }

  it("EPERM 降级（symlink seam 真实 errno）：mode=materialized + reason=symlink-unavailable + 真复制 + state 同步", async () => {
    const sandbox = makeSandbox("proj-eperm", "project");
    await setupEntity(sandbox);
    const root = join(sandbox.workspace, "agents-e", "skills");
    const result = await projectEntity({
      scope: "project", name: "alpha", roots: [root], symlinkImpl: errnoFail("EPERM"), ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", projected: 1 });
    if (result.kind !== "ok") return;
    expect(result.results[0]).toMatchObject({
      status: "projected",
      mode: "materialized",
      reason: "symlink-unavailable",
    });
    // 真实物化副本（非 symlink），state 记录同一形态
    const copyPath = join(root, "alpha");
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(copyPath, "SKILL.md"), "utf8")).toContain("name: alpha");
    const state = readState(sandbox.scopeBase);
    const keys = Object.keys(state.projections);
    expect(keys).toHaveLength(1);
    expect(state.projections[keys[0] as string]).toMatchObject({ mode: "materialized", reason: "symlink-unavailable" });
    cleanupSandbox(sandbox);
  });

  it("ENOSYS 同支（seam 构造，平台不可直接构造）：同类降级收据", async () => {
    const sandbox = makeSandbox("proj-enosys", "project");
    await setupEntity(sandbox);
    const root = join(sandbox.workspace, "agents-n", "skills");
    const result = await projectEntity({
      scope: "project", name: "alpha", roots: [root], symlinkImpl: errnoFail("ENOSYS"), ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", projected: 1 });
    expect(result.kind === "ok" ? result.results[0]?.reason : null).toBe("symlink-unavailable");
    expect(lstatSync(join(root, "alpha")).isSymbolicLink()).toBe(false);
    cleanupSandbox(sandbox);
  });

  it("strict link-only：EPERM（seam）不降级 → SYMLINK_FAILED 且零副本", async () => {
    const sandbox = makeSandbox("proj-strict", "project");
    await setupEntity(sandbox);
    const root = join(sandbox.workspace, "agents-s", "skills");
    const result = await projectEntity({
      scope: "project", name: "alpha", roots: [root], strict: true, symlinkImpl: errnoFail("EPERM"), ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", failed: 1, projected: 0 });
    expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("SYMLINK_FAILED");
    expect(existsSync(join(root, "alpha"))).toBe(false);
    expect(readState(sandbox.scopeBase).projections).toEqual({});
    cleanupSandbox(sandbox);
  });

  it.skipIf(!CHFLAGS_EPERM_AVAILABLE)(
    "真内核 EPERM（chflags uchg）：降级尝试仍被目标拒绝 → TARGET_DENIED 不静默 copy",
    async () => {
      const sandbox = makeSandbox("proj-uchg", "project");
      await setupEntity(sandbox);
      const root = join(sandbox.workspace, "agents-u", "skills");
      mkdirSync(root, { recursive: true });
      execSync(`chflags uchg ${JSON.stringify(root)}`);
      try {
        const result = await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
        expect(result).toMatchObject({ kind: "ok", failed: 1, projected: 0 });
        expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("TARGET_DENIED");
        expect(existsSync(join(root, "alpha"))).toBe(false);
        expect(readState(sandbox.scopeBase).projections).toEqual({});
      } finally {
        execSync(`chflags nouchg ${JSON.stringify(root)}`);
      }
      cleanupSandbox(sandbox);
    }
  );

  it.skipIf(IS_ROOT)(
    "TARGET_DENIED（chmod 0555 真构造 EACCES）：直接失败不降级、不静默 copy",
    async () => {
      const sandbox = makeSandbox("proj-denied", "project");
      await setupEntity(sandbox);
      const root = join(sandbox.workspace, "agents-d", "skills");
      mkdirSync(root, { recursive: true });
      chmodSync(root, 0o555);
      try {
        const result = await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
        expect(result).toMatchObject({ kind: "ok", failed: 1, projected: 0 });
        expect(result.kind === "ok" ? result.results[0]?.errorCode : null).toBe("TARGET_DENIED");
        expect(existsSync(join(root, "alpha"))).toBe(false);
        expect(readState(sandbox.scopeBase).projections).toEqual({});

        // materialized 请求同样 TARGET_DENIED（目标级权限不因模式豁免）
        const resultMat = await projectEntity({
          scope: "project", name: "alpha", roots: [root], mode: "materialized", reason: "user-request", ...scopeOpts(sandbox),
        });
        expect(resultMat.kind === "ok" ? resultMat.results[0]?.errorCode : null).toBe("TARGET_DENIED");
        expect(existsSync(join(root, "alpha"))).toBe(false);
      } finally {
        chmodSync(root, 0o755);
      }
      cleanupSandbox(sandbox);
    }
  );
});

// ---------------------------------------------------------------------------
// entity-local 第四形态（G3 裁决 commit a465dc1）
// ---------------------------------------------------------------------------

describe("projectEntity entity-local（G3 第四形态）", () => {
  it("canonical root → entity-local 收据：path=canonicalPath=entityPath、零副作用、零投影记录", async () => {
    const sandbox = makeSandbox("el-basic", "project");
    const { ok } = await setupEntity(sandbox);
    const stateBefore = readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8");
    const rootEntriesBefore = readdirSync(sandbox.entityRoot).sort();

    const result = await projectEntity({
      scope: "project", name: "alpha", roots: [sandbox.entityRoot], ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", unchanged: 1, projected: 0, failed: 0 });
    if (result.kind !== "ok") return;
    expect(result.generation).toBe(1); // 零 state 写入
    const entry = result.results[0];
    expect(entry).toMatchObject({
      status: "unchanged",
      mode: "entity-local",
      reason: "canonical-root",
      targetKind: "entity",
      requestedMode: "link",
    });
    // path === canonicalPath === entityPath（spec Scenario 钉值）
    expect(entry?.path).toBe(join(sandbox.entityRoot, "alpha"));
    expect(entry?.canonicalPath).toBe(ok.entity.path);
    expect(entry?.path).toBe(entry?.canonicalPath);
    // 磁盘与 projection state 均无额外变化
    expect(readdirSync(sandbox.entityRoot).sort()).toEqual(rootEntriesBefore);
    expect(readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8")).toBe(stateBefore);
    cleanupSandbox(sandbox);
  });

  it("幂等：重复调用收据一致且 state 不动", async () => {
    const sandbox = makeSandbox("el-idem", "project");
    await setupEntity(sandbox);
    const first = await projectEntity({ scope: "project", name: "alpha", roots: [sandbox.entityRoot], ...scopeOpts(sandbox) });
    const before = readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8");
    const second = await projectEntity({ scope: "project", name: "alpha", roots: [sandbox.entityRoot], ...scopeOpts(sandbox) });
    expect(second).toEqual(first);
    expect(readFileSync(join(sandbox.scopeBase, CCSKI_STATE_FILENAME), "utf8")).toBe(before);
    cleanupSandbox(sandbox);
  });

  it("requestedMode 保留：materialized 请求也不自拷贝（禁悄悄声称独立副本）", async () => {
    const sandbox = makeSandbox("el-mat", "project");
    await setupEntity(sandbox);
    const entriesBefore = readdirSync(sandbox.entityRoot).sort();

    const result = await projectEntity({
      scope: "project", name: "alpha", roots: [sandbox.entityRoot], mode: "materialized", reason: "user-request", ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", unchanged: 1, projected: 0 });
    if (result.kind !== "ok") return;
    expect(result.results[0]).toMatchObject({
      mode: "entity-local",
      reason: "canonical-root",
      targetKind: "entity",
      requestedMode: "materialized",
    });
    // 实体根无新增条目（没有把实体复制到自身）
    expect(readdirSync(sandbox.entityRoot).sort()).toEqual(entriesBefore);
    expect(readState(sandbox.scopeBase).projections).toEqual({});
    cleanupSandbox(sandbox);
  });

  it("混合 roots：canonical root 产自己的收据，其它根独立按 link 处理", async () => {
    const sandbox = makeSandbox("el-mixed", "project");
    await setupEntity(sandbox);
    const linkRoot = join(sandbox.workspace, "agents-a", "skills");

    const result = await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [linkRoot, sandbox.entityRoot],
      ...scopeOpts(sandbox),
    });
    expect(result).toMatchObject({ kind: "ok", projected: 1, unchanged: 1, failed: 0 });
    if (result.kind !== "ok") return;
    const local = result.results.find((r) => r.targetKind === "entity");
    const link = result.results.find((r) => r.targetKind === "projection");
    expect(local).toMatchObject({ mode: "entity-local", reason: "canonical-root", status: "unchanged" });
    expect(link).toMatchObject({ status: "projected", mode: "link" });

    // 投影记录只有普通根（canonical root 不写记录；实体记录是唯一权威）
    const projections = readState(sandbox.scopeBase).projections;
    expect(Object.keys(projections)).toHaveLength(1);
    expect(Object.values(projections)[0]).toMatchObject({ mode: "link", rootPath: linkRoot });
    cleanupSandbox(sandbox);
  });
});

// ---------------------------------------------------------------------------
// 同名 replace 冻结状态机（R1-R11 对照 g0/state-machine-consistency-checklist.md）
// ---------------------------------------------------------------------------

describe("ensureEntity replace 状态机（P1-3 冻结）", () => {
  interface ReplaceFixture {
    sandbox: Sandbox;
    oldRevision: string;
    newSource: string;
    rootLink: string;
    rootMat: string;
    rootDisabled: string;
    rootExternal: string;
    lockPath: string;
    lockBytes: Buffer;
  }

  async function setupReplace(prefix: string): Promise<ReplaceFixture> {
    const sandbox = makeSandbox(prefix, "project");
    const oldSource = writeSkillSource(sandbox.workspace, "alpha", "OLD body\n");
    const created = expectOk(
      await ensureEntity({ scope: "project", source: { dir: oldSource }, ...scopeOpts(sandbox) })
    );
    const rootLink = join(sandbox.workspace, "agents-link", "skills");
    const rootMat = join(sandbox.workspace, "agents-mat", "skills");
    const rootDisabled = join(sandbox.workspace, "agents-disabled", "skills");
    const rootExternal = join(sandbox.workspace, "agents-ext", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [rootLink], ...scopeOpts(sandbox) });
    await projectEntity({
      scope: "project", name: "alpha", roots: [rootMat], mode: "materialized", reason: "pinned", ...scopeOpts(sandbox),
    });
    await projectEntity({ scope: "project", name: "alpha", roots: [rootDisabled], ...scopeOpts(sandbox) });
    // rootDisabled → 物理禁用形态（E3：摘链 + state disabled=true；重建面在批 4）
    const state = readState(sandbox.scopeBase);
    const disabledKey = `${projectionRootId(rootDisabled)}:alpha`;
    (state.projections[disabledKey] as Record<string, unknown>).disabled = true;
    writeState(sandbox.scopeBase, state);
    rmSync(join(rootDisabled, "alpha"));
    // 外部 live-link（不在 state 投影记录内）
    mkdirSync(rootExternal, { recursive: true });
    symlinkSync(join(sandbox.entityRoot, "alpha"), join(rootExternal, "alpha"));
    // npm lock 预置（分层单写者：ccski 永不写）
    const lockPath = join(sandbox.scopeBase, ".skill-lock.json");
    const lockBytes = Buffer.from(JSON.stringify({ version: 3, skills: {}, dismissed: {} }));
    writeFileSync(lockPath, lockBytes);
    const newSource = writeSkillSource(sandbox.workspace, "alpha", "NEW body\n");
    return { sandbox, oldRevision: created.entity.revision, newSource, rootLink, rootMat, rootDisabled, rootExternal, lockPath, lockBytes };
  }

  it("R1-R11 全步：replace 换新实体、state 刷新、link stale、物化不动、外部链不触碰、lock 不写", async () => {
    const fx = await setupReplace("replace-all");
    const oldContent = "OLD body\n";

    // R1/R2：无 replace → NAME_EXISTS（已在独立用例钉）；显式 replace + expectedRevision 放行
    const replaced = expectOk(
      await ensureEntity({
        scope: "project",
        source: { dir: fx.newSource },
        replace: { expectedRevision: fx.oldRevision },
        ...scopeOpts(fx.sandbox),
      })
    );
    expect(replaced.status).toBe("replaced");
    expect(replaced.lockSyncPending).toBe(true); // R11

    const entityPath = join(fx.sandbox.entityRoot, "alpha");
    // R4（磁盘半区）：稳路径换新 + 新内容 + 新 revision
    expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toContain("NEW body");
    expect(replaced.entity.revision).toBe(await computeSkillFolderHash(entityPath));
    expect(replaced.entity.revision).not.toBe(fx.oldRevision);
    // 实体根无 staging/backup 残留
    const rootEntries = readdirSync(fx.sandbox.entityRoot);
    expect(rootEntries.filter((n) => n.startsWith(".ccski-"))).toEqual([]);

    const state = readState(fx.sandbox.scopeBase);
    const entityRecord = state.entities["alpha"] as Record<string, unknown>;
    // R6：state 刷新 revision/provenance
    expect(entityRecord.revision).toBe(replaced.entity.revision);
    expect((entityRecord.provenance as Record<string, unknown>).source).toBe(fx.newSource);

    const linkKey = `${projectionRootId(fx.rootLink)}:alpha`;
    const disabledKey = `${projectionRootId(fx.rootDisabled)}:alpha`;
    const matKey = `${projectionRootId(fx.rootMat)}:alpha`;
    const linkRecord = state.projections[linkKey] as Record<string, unknown>;
    const disabledRecord = state.projections[disabledKey] as Record<string, unknown>;
    const matRecord = state.projections[matKey] as Record<string, unknown>;
    // R8：link 投影旧 revision 保留 + stale 标注（下次 verify 报 STALE_PROJECTION；链接按路径语义解析新内容）
    expect(linkRecord.stale).toBe(true);
    expect(linkRecord.entityRevision).toBe(fx.oldRevision);
    expect(disabledRecord.stale).toBe(true);
    // R7：disabled 记录保留
    expect(disabledRecord.disabled).toBe(true);
    expect(linkRecord.disabled).toBe(false);
    // R9：物化/pinned 副本不动（无 stale、旧 revision、磁盘仍旧内容）
    expect(matRecord.stale).toBeUndefined();
    expect(matRecord.entityRevision).toBe(fx.oldRevision);
    expect(readFileSync(join(fx.rootMat, "alpha", "SKILL.md"), "utf8")).toContain(oldContent);
    // R10：外部 live-link 不触碰（存在性 + 解析），按路径语义解析到新内容
    expect(lstatSync(join(fx.rootExternal, "alpha")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(fx.rootExternal, "alpha", "SKILL.md"), "utf8")).toContain("NEW body");
    // R11：npm lock 字节不动
    expect(readFileSync(fx.lockPath)).toEqual(fx.lockBytes);
    cleanupSandbox(fx.sandbox);
  });

  it("R4（回滚·全路径前置失败）：uchg 实体目录 → ENTITY_SWAP_FAILED + 旧实体原样 + state 记失败 generation", async () => {
    const fx = await setupReplace("replace-uchg");
    execSync(`chflags uchg ${JSON.stringify(join(fx.sandbox.entityRoot, "alpha"))}`);
    try {
      const result = await ensureEntity({
        scope: "project",
        source: { dir: fx.newSource },
        replace: { expectedRevision: fx.oldRevision },
        ...scopeOpts(fx.sandbox),
      });
      expect(result).toMatchObject({ kind: "error", code: "ENTITY_SWAP_FAILED" });
      // 旧实体保持可用
      expect(readFileSync(join(fx.sandbox.entityRoot, "alpha", "SKILL.md"), "utf8")).toContain("OLD body");
      const state = readState(fx.sandbox.scopeBase);
      // state 记失败 generation（lastFailure 落账；generation = ensure1+proj3+失败标记5）
      const record = state.entities["alpha"] as Record<string, unknown>;
      expect((record.lastFailure as Record<string, unknown> | undefined)?.operation).toBe("replace");
      expect(state.generation).toBe(5);
      expect(record.revision).toBe(fx.oldRevision);
    } finally {
      execSync(`chflags nouchg ${JSON.stringify(join(fx.sandbox.entityRoot, "alpha"))}`);
    }
    cleanupSandbox(fx.sandbox);
  });

  it("R4（回滚·原语级后置失败）：staging 消失 → 最终 rename 失败 → backup 回滚旧实体可用", async () => {
    const sandbox = makeSandbox("replace-primitive", "project");
    const entityPath = join(sandbox.entityRoot, "alpha");
    mkdirSync(entityPath, { recursive: true });
    writeFileSync(join(entityPath, "SKILL.md"), "OLD\n");
    const staging = join(sandbox.entityRoot, ".ccski-staging-vanished");

    const outcome = swapEntityIntoPlace(staging, entityPath, sandbox.entityRoot);
    expect(outcome.ok).toBe(false);
    expect(outcome.restored).toBe(true);
    expect(outcome.residualBackupPath).toBeUndefined();
    expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toBe("OLD\n");
    // 回滚后实体根无残留 backup
    const entries = readdirSync(sandbox.entityRoot);
    expect(entries.filter((n) => n.startsWith(".ccski-backup-"))).toEqual([]);
    cleanupSandbox(sandbox);
  });
});

// ---------------------------------------------------------------------------
// 与批 2 发现层互证（ownership/entryKind/mode）
// ---------------------------------------------------------------------------

describe("发现层互证（G2 集成）", () => {
  it("安装后 discoverSkills：实体=entity-local/ccski、link=symlink/ccski/link、物化=directory/ccski/materialized", async () => {
    const sandbox = makeSandbox("interop", "project");
    await setupEntity(sandbox);
    const linkRoot = join(sandbox.workspace, "agents-a", "skills");
    const matRoot = join(sandbox.workspace, "agents-b", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [linkRoot], ...scopeOpts(sandbox) });
    await projectEntity({
      scope: "project", name: "alpha", roots: [matRoot], mode: "materialized", reason: "imported-root", ...scopeOpts(sandbox),
    });

    const discovery = discoverSkills({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      scanDefaultDirs: false,
      stateBases: [sandbox.scopeBase],
      customDirs: [sandbox.entityRoot, linkRoot, matRoot],
    });
    const entityPath = join(sandbox.entityRoot, "alpha");
    const entity = discovery.skills.find((s) => s.path === entityPath);
    expect(entity).toBeDefined();
    // 批 3 G3 裁决附带修正：实体本体 ≠ 物化投影 → entity-local
    expect(entity).toMatchObject({
      entryKind: "directory",
      ownership: "ccski",
      mode: "entity-local",
    });
    expect(entity?.canonicalPath).toBe(real(entityPath));
    expect(entity?.provenance).toBeUndefined();

    const link = discovery.skills.find((s) => s.path === join(linkRoot, "alpha"));
    expect(link).toMatchObject({ entryKind: "symlink", ownership: "ccski", mode: "link" });
    expect(link?.canonicalPath).toBe(real(entityPath));

    const copy = discovery.skills.find((s) => s.path === join(matRoot, "alpha"));
    expect(copy).toMatchObject({ entryKind: "directory", ownership: "ccski", mode: "materialized" });
    cleanupSandbox(sandbox);
  });

  it("link 投影经发现层解析到实体内容（装后即可被 agent 发现）", async () => {
    const sandbox = makeSandbox("interop-content", "project");
    await setupEntity(sandbox, "readable", "Deep content\n");
    const linkRoot = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "readable", roots: [linkRoot], ...scopeOpts(sandbox) });
    const discovery = discoverSkills({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      scanDefaultDirs: false,
      stateBases: [sandbox.scopeBase],
      customDirs: [linkRoot],
    });
    // custom provider "file" 的条目带 scope 前缀（other:readable），按路径定位
    const found = discovery.skills.find((s) => s.path === join(linkRoot, "readable"));
    expect(found).toBeDefined();
    expect(found?.name.endsWith("readable")).toBe(true);
    expect(found?.disabled).toBe(false);
    cleanupSandbox(sandbox);
  });
});
