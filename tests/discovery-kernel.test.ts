/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「G2 发现矩阵（人工磁盘 fixture，不依赖批 3/5 API）：
 * global/project × link/materialized × enabled/disabled × regular/broken/external ×
 * 30+ roots × foreign 条目观察 × 投影路径被占用——全组合落 tests/，矩阵覆盖表进测试文件头注」
 * 正交意图：
 *   [1] G2 门收据：发现层 symlink 一等化全矩阵（真磁盘 fixture：tmp 目录 + 真
 *       symlink + 真 state 文件 seed；不 mock fs，不依赖批 3/5 API）
 *   [2] ownership 判定钉面（state 命中规则）：ccski = state 记录命中；
 *       symlink 未命中 = external；目录未记录 = unknown + legacy-unknown
 *   [3] broken link typed omission 占位可见性 + 发现只读不变量（零 state 写入）
 *   [4] 保留名清扫钉面：marker + pid 活性/龄期条件；无 marker 同名用户目录不删
 * 妥协声明：link×disabled 只能以「摘链后缺席」观察（物理禁用语义 E3，其重建面
 * 在批 4 toggle）；mutation 对 broken/external 的 typed 拒绝（FOREIGN_OWNERSHIP）
 * 是批 4 面，本文件只钉发现面观察。
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CCSKI_RESIDUE_MARKER_FILENAME,
  discoverSkills,
  sweepReservedResidues,
} from "../src/core/discovery.js";
import { SkillRegistry } from "../src/core/registry.js";

const STATE_FILENAME = ".ccski-state.json";

function real(path: string): string {
  return realpathSync(path);
}

interface Sandbox {
  home: string;
  workspace: string;
}

function makeSandbox(prefix: string): Sandbox {
  const home = mkdtempSync(join(tmpdir(), `ccski-g2-home-${prefix}-`));
  const workspace = mkdtempSync(join(tmpdir(), `ccski-g2-ws-${prefix}-`));
  return { home, workspace };
}

function writeSkill(dir: string, name: string, description = "kernel fixture skill"): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`);
  return dir;
}

function writeDisabledSkill(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".SKILL.md"), `---\nname: ${name}\ndescription: disabled fixture\n---\nBody\n`);
  return dir;
}

/** 直写 state 文件 seed（批 1 已钉写入协议；本文件只造磁盘形态） */
function seedState(
  scopeBase: string,
  entities: Record<string, unknown>,
  projections: Record<string, unknown>
): string {
  mkdirSync(scopeBase, { recursive: true });
  const statePath = join(scopeBase, STATE_FILENAME);
  writeFileSync(
    statePath,
    `${JSON.stringify({ schemaVersion: 1, generation: 1, entities, projections }, null, 2)}\n`
  );
  return statePath;
}

function discover(sandbox: Sandbox, includeDisabled = true) {
  return discoverSkills({
    userDir: sandbox.home,
    workspaceDir: sandbox.workspace,
    scanDefaultDirs: true,
    includeDisabled,
  });
}

function spawnExitedPid(): Promise<number> {
  return new Promise((resolvePid, reject) => {
    const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
    child.on("exit", () => resolvePid(child.pid as number));
    child.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// G2 矩阵覆盖表（scope × form × enabled × health × roots × foreign × occupancy × reserved）
//
// | #  | 维度组合 | fixture 构造 | 核心断言 | 测试 |
// |----|----------|--------------|----------|------|
// | M1 | global × link × enabled × regular(ccski) | home/.agents/skills 实体 + state seed + .claude/skills symlink | entryKind=symlink、ownership=ccski、mode=link、canonicalPath=实体 realpath、path=链接路径 | M1 |
// | M2 | global × materialized × enabled × regular(ccski) | agent root 实目录 + state projection(mode:materialized) seed | ownership=ccski、mode=materialized、无 provenance | M2 |
// | M3 | project × link × enabled × regular | workspace/.agents/skills 实体 + project state seed + .myagent/skills symlink | 同 M1（project scopeBase 命中） | M3 |
// | M4 | project × materialized × legacy(unknown) | workspace/skills 实目录、state 无记录 | ownership=unknown、mode=materialized、provenance=legacy-unknown | M4 |
// | M5 | materialized × disabled | .SKILL.md 重命名 + includeDisabled | disabled=true 且内核标注保留 | M5 |
// | M6 | materialized × disabled × 默认面 | 同 M5、不含 includeDisabled | 不出现在结果 | M5 |
// | M7 | link × disabled（摘链） | state 记录 disabled projection、链接已摘除 | 无条目（物理禁用）；实体根仍可见 | M7 |
// | M8 | link × broken | symlink → 不存在目标 | omissions[] typed 占位 + warnings 可见 + skills 无条目 | M8 |
// | M9 | link × external | symlink → 未登记真实技能目录 | ownership=external、canonicalPath=目标 realpath | M9 |
// | M10 | link × target-not-directory | symlink → 普通文件 | omission code=symlink-target-not-directory | M10 |
// | M11 | 顶层链接不递归 | symlink → 无 SKILL.md 但含嵌套技能的目录 | 链接与其嵌套内容均不产出条目（递归不跟随 symlink） | M11 |
// | M12 | foreign 观察 × state 整体缺席 | 无 .ccski-state.json | 链接=external、目录=unknown+legacy、零 crash | M12 |
// | M13 | state 损坏降级 | corrupt .ccski-state.json | state-recovery-required 诊断 + 磁盘形态标注 | M13 |
// | M14 | 投影路径被占用 | state 记录 mode:link 投影 + 实目录占据该路径 | ownership=ccski + mode=materialized + projection-path-occupied 诊断 | M14 |
// | M15 | 30+ roots | user+workspace 各 6 常规根 + 10 动态 agent 根 | scannedDirectories ≥ 30 且跨根技能全部可见 | M15 |
// | M16 | 保留名发现层跳过 | 根下 .ccski-staging-* / .ccski-backup-* 技能形目录 | 不产出条目 | M16 |
// | M17 | 清扫 × marker+写者死亡 | 已退出进程 pid 的 marker 残留 | removed | M17 |
// | M18 | 清扫 × marker+超龄（写者存活） | 本进程 pid + 老createdAt + now 注入 | removed | M18 |
// | M19 | 清扫 × marker+存活写者+未超龄 | 本进程 pid + 新 createdAt | kept writer-alive、目录保留 | M19 |
// | M20 | 清扫 × 无 marker 同名用户目录 | .ccski-staging-user-data 无 marker | kept no-marker、内容完好（禁前缀盲删钉面） | M20 |
// | M21 | 清扫 × marker 损坏 | 半截 JSON marker | kept marker-unreadable | M21 |
// | M22 | 清扫 × 保留名 symlink | .ccski-backup-link → 真实目录 | kept non-directory、目标完好（防穿链删除） | M22 |
// | M23 | 发现只读不变量 | seed 后跑发现 | state 字节不变、缺失不补建 | M23 |
// | M24 | registry 涟漪 | SkillRegistry 消费同一沙箱 | getDiagnostics().omissions 传播 | M24 |
// ---------------------------------------------------------------------------

describe("G2 discovery kernel matrix (store-link-kernel 批 2)", () => {
  it("M1: global scope link projection is first-class with ccski ownership", () => {
    const sandbox = makeSandbox("m1");
    const entityDir = writeSkill(join(sandbox.home, ".agents", "skills", "alpha"), "alpha");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "alpha");
    symlinkSync(entityDir, linkPath);
    const statePath = seedState(
      join(sandbox.home, ".agents"),
      { ent_1: { path: real(entityDir), name: "alpha" } },
      { prj_1: { path: linkPath, mode: "link", entityId: "ent_1", disabled: false } }
    );

    const result = discover(sandbox);
    const link = result.skills.find((s) => s.path === linkPath);
    expect(link).toBeDefined();
    expect(link?.entryKind).toBe("symlink");
    expect(link?.ownership).toBe("ccski");
    expect(link?.mode).toBe("link");
    expect(link?.canonicalPath).toBe(real(entityDir));
    expect(link?.disabled).toBe(false);

    // 实体本体在其根下也可见：materialized + ccski（state 命中），无 legacy 标注
    const entity = result.skills.find((s) => s.path === entityDir);
    expect(entity?.entryKind).toBe("directory");
    expect(entity?.ownership).toBe("ccski");
    expect(entity?.mode).toBe("materialized");
    expect(entity?.provenance).toBeUndefined();
    expect(readFileSync(statePath, "utf8")).toContain('"generation": 1');
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M2: global materialized projection recorded in state is ccski-owned", () => {
    const sandbox = makeSandbox("m2");
    const copyDir = writeSkill(join(sandbox.home, ".codex", "skills", "beta"), "beta");
    seedState(
      join(sandbox.home, ".agents"),
      {},
      { prj_2: { path: copyDir, mode: "materialized", entityId: "ent_2", disabled: false } }
    );

    const result = discover(sandbox);
    const copy = result.skills.find((s) => s.path === copyDir);
    expect(copy).toBeDefined();
    expect(copy?.entryKind).toBe("directory");
    expect(copy?.ownership).toBe("ccski");
    expect(copy?.mode).toBe("materialized");
    expect(copy?.provenance).toBeUndefined();
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M3: project scope link projection resolves through the project state base", () => {
    const sandbox = makeSandbox("m3");
    const entityDir = writeSkill(join(sandbox.workspace, ".agents", "skills", "gamma"), "gamma");
    const projRoot = join(sandbox.workspace, ".myagent", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "gamma");
    symlinkSync(entityDir, linkPath);
    seedState(
      join(sandbox.workspace, ".agents"),
      { ent_3: { path: real(entityDir), name: "gamma" } },
      { prj_3: { path: linkPath, mode: "link", entityId: "ent_3", disabled: false } }
    );

    const result = discover(sandbox);
    const link = result.skills.find((s) => s.path === linkPath);
    expect(link).toBeDefined();
    expect(link?.entryKind).toBe("symlink");
    expect(link?.ownership).toBe("ccski");
    expect(link?.mode).toBe("link");
    expect(link?.canonicalPath).toBe(real(entityDir));
    expect(link?.location).toBe("project");
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M4: pre-existing materialized directory without state record is legacy-unknown", () => {
    const sandbox = makeSandbox("m4");
    const legacyDir = writeSkill(join(sandbox.workspace, "skills", "delta"), "delta");

    const result = discover(sandbox);
    const legacy = result.skills.find((s) => s.path === legacyDir);
    expect(legacy).toBeDefined();
    expect(legacy?.entryKind).toBe("directory");
    expect(legacy?.ownership).toBe("unknown");
    expect(legacy?.mode).toBe("materialized");
    expect(legacy?.provenance).toBe("legacy-unknown");
    // 只标注不转换：发现层绝不创建/改写 state（spec: Legacy directory is never auto-converted）
    expect(existsSync(join(sandbox.workspace, ".agents", STATE_FILENAME))).toBe(false);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M5/M6: disabled materialized skill is annotated only when includeDisabled", () => {
    const sandbox = makeSandbox("m5");
    const disabledDir = writeDisabledSkill(join(sandbox.home, ".gemini", "skills", "epsilon"), "epsilon");

    const withoutDisabled = discover(sandbox, false);
    expect(withoutDisabled.skills.find((s) => s.path === disabledDir)).toBeUndefined();

    const withDisabled = discover(sandbox, true);
    const disabled = withDisabled.skills.find((s) => s.path === disabledDir);
    expect(disabled).toBeDefined();
    expect(disabled?.disabled).toBe(true);
    expect(disabled?.entryKind).toBe("directory");
    expect(disabled?.ownership).toBe("unknown");
    expect(disabled?.mode).toBe("materialized");
    expect(disabled?.provenance).toBe("legacy-unknown");
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M7: unlinked (disabled) link projection is absent while its entity stays visible", () => {
    const sandbox = makeSandbox("m7");
    const entityDir = writeSkill(join(sandbox.home, ".agents", "skills", "zeta"), "zeta");
    const unlinkedPath = join(sandbox.home, ".claude", "skills", "zeta");
    seedState(
      join(sandbox.home, ".agents"),
      { ent_7: { path: real(entityDir), name: "zeta" } },
      { prj_7: { path: unlinkedPath, mode: "link", entityId: "ent_7", disabled: true } }
    );

    const result = discover(sandbox);
    // 摘链即物理禁用（E3）：投影路径无磁盘条目，发现层如实缺席
    expect(result.skills.find((s) => s.path === unlinkedPath)).toBeUndefined();
    expect(result.diagnostics.omissions).toHaveLength(0);
    // 实体仍在实体根可见
    const entity = result.skills.find((s) => s.path === entityDir);
    expect(entity?.ownership).toBe("ccski");
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M8: broken top-level link is a typed omission, never a silent gap", () => {
    const sandbox = makeSandbox("m8");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "ghost");
    symlinkSync(join(projRoot, "target-vanished"), linkPath);
    const healthy = writeSkill(join(projRoot, "healthy"), "healthy");

    const result = discover(sandbox);
    const omission = result.diagnostics.omissions.find((o) => o.path === linkPath);
    expect(omission).toBeDefined();
    expect(omission?.code).toBe("broken-symlink");
    expect(omission?.name).toBe("ghost");
    expect(result.skills.find((s) => s.path === linkPath)).toBeUndefined();
    // 列表可见：warnings 与 events 同步携带占位诊断
    expect(result.diagnostics.warnings.some((w) => w.includes("broken-symlink") && w.includes("ghost"))).toBe(true);
    expect(result.diagnostics.events.some((e) => e.code === "broken-symlink" && e.source === "discovery")).toBe(true);
    // 健康条目不受影响
    expect(result.skills.find((s) => s.path === healthy)).toBeDefined();
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M9: external live-link (target outside state records) is listed read-only as external", () => {
    const sandbox = makeSandbox("m9");
    const strangerDir = writeSkill(join(sandbox.home, "skills", "stranger"), "stranger");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "stranger");
    symlinkSync(strangerDir, linkPath);

    const result = discover(sandbox);
    const link = result.skills.find((s) => s.path === linkPath);
    expect(link).toBeDefined();
    expect(link?.entryKind).toBe("symlink");
    expect(link?.ownership).toBe("external");
    expect(link?.mode).toBe("link");
    expect(link?.canonicalPath).toBe(real(strangerDir));
    // FOREIGN_OWNERSHIP mutation 拒绝是批 4 面；本批钉发现面观察
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M10: top-level link to a plain file is a typed omission", () => {
    const sandbox = makeSandbox("m10");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const filePath = join(projRoot, "notes.txt");
    writeFileSync(filePath, "not a skill");
    const linkPath = join(projRoot, "file-link");
    symlinkSync(filePath, linkPath);

    const result = discover(sandbox);
    const omission = result.diagnostics.omissions.find((o) => o.path === linkPath);
    expect(omission?.code).toBe("symlink-target-not-directory");
    expect(result.skills.find((s) => s.path === linkPath)).toBeUndefined();
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M11: recursive descent never follows symlinks (even first-class top-level ones)", () => {
    const sandbox = makeSandbox("m11");
    // 实体侧嵌套技能挂在被扫描的共享根下（home/.agents/skills）
    const nestedHolder = join(sandbox.home, ".agents", "skills");
    const nested = writeSkill(join(nestedHolder, "parent", "inner"), "inner");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "parent-link");
    // 链接指向含嵌套技能但自身无 SKILL.md 的目录
    symlinkSync(join(nestedHolder, "parent"), linkPath);

    const result = discover(sandbox);
    // 直接扫描实体侧：嵌套仍经真实目录递归可见（现状保持）
    expect(result.skills.find((s) => s.path === nested)).toBeDefined();
    // 顶层链接不递归：链接自身与穿链嵌套均不产出条目
    expect(result.skills.find((s) => s.path === linkPath)).toBeUndefined();
    expect(result.skills.filter((s) => s.path.startsWith(`${linkPath}/`))).toHaveLength(0);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M12: with state entirely absent, disk shape decides ownership and nothing crashes", () => {
    const sandbox = makeSandbox("m12");
    const plainDir = writeSkill(join(sandbox.workspace, "skills", "plain"), "plain");
    const strangerDir = writeSkill(join(sandbox.home, "skills", "stranger"), "stranger");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "stranger");
    symlinkSync(strangerDir, linkPath);

    const result = discover(sandbox);
    const dir = result.skills.find((s) => s.path === plainDir);
    expect(dir?.ownership).toBe("unknown");
    expect(dir?.provenance).toBe("legacy-unknown");
    const link = result.skills.find((s) => s.path === linkPath);
    expect(link?.ownership).toBe("external");
    // 只读不变量：发现不补建 state
    expect(existsSync(join(sandbox.home, ".agents", STATE_FILENAME))).toBe(false);
    expect(existsSync(join(sandbox.workspace, ".agents", STATE_FILENAME))).toBe(false);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M13: corrupt state degrades read-only with a recovery diagnostic, disk shape decides", () => {
    const sandbox = makeSandbox("m13");
    const scopeBase = join(sandbox.home, ".agents");
    mkdirSync(scopeBase, { recursive: true });
    writeFileSync(join(scopeBase, STATE_FILENAME), "{ half-written json");
    const plainDir = writeSkill(join(sandbox.home, ".agents", "skills", "legacy"), "legacy");
    const strangerDir = writeSkill(join(sandbox.home, "skills", "stranger"), "stranger");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    const linkPath = join(projRoot, "stranger");
    symlinkSync(strangerDir, linkPath);

    const result = discover(sandbox);
    expect(
      result.diagnostics.events.some(
        (e) => e.code === "state-recovery-required" && e.source === "discovery"
      )
    ).toBe(true);
    const dir = result.skills.find((s) => s.path === plainDir);
    expect(dir?.ownership).toBe("unknown");
    expect(dir?.provenance).toBe("legacy-unknown");
    const link = result.skills.find((s) => s.path === linkPath);
    expect(link?.ownership).toBe("external");
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M14: directory occupying a recorded link-projection path is observed as occupied", () => {
    const sandbox = makeSandbox("m14");
    const occupiedDir = writeSkill(join(sandbox.home, ".claude", "skills", "theta"), "theta");
    seedState(
      join(sandbox.home, ".agents"),
      { ent_14: { path: real(occupiedDir), name: "theta" } },
      { prj_14: { path: occupiedDir, mode: "link", entityId: "ent_14", disabled: false } }
    );

    const result = discover(sandbox);
    const occupied = result.skills.find((s) => s.path === occupiedDir);
    expect(occupied).toBeDefined();
    // 磁盘形态是实目录：mode=materialized；state 命中 → ccski
    expect(occupied?.entryKind).toBe("directory");
    expect(occupied?.ownership).toBe("ccski");
    expect(occupied?.mode).toBe("materialized");
    // 投影路径被占用观察诊断（guard 处理在批 4）
    expect(
      result.diagnostics.events.some(
        (e) => e.code === "projection-path-occupied" && JSON.stringify(e.details).includes(occupiedDir)
      )
    ).toBe(true);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M15: matrix scans 30+ roots across global and project scopes without loss", () => {
    const sandbox = makeSandbox("m15");
    // 每侧 6 常规根 + 10 动态 agent 根 = 32 根（≥30）
    const providers = [".claude", ".codex", ".gemini", ".openclaw"];
    const dynamicAgents = Array.from({ length: 10 }, (_, i) => `.acme${i}`);
    let rootCount = 0;
    for (const base of [sandbox.home, sandbox.workspace]) {
      for (const dir of [...providers, "skills", join(".agents", "skills")]) {
        const root = join(base, dir);
        mkdirSync(root, { recursive: true });
        rootCount += 1;
      }
      for (const agent of dynamicAgents) {
        const root = join(base, agent, "skills");
        mkdirSync(root, { recursive: true });
        rootCount += 1;
      }
    }
    expect(rootCount).toBe(32);
    // 跨根撒技能：首根、末动态根、共享根各一
    writeSkill(join(sandbox.home, ".claude", "skills", "first"), "first");
    writeSkill(join(sandbox.workspace, ".acme9", "skills", "last"), "last");
    writeSkill(join(sandbox.home, ".agents", "skills", "shared"), "shared");

    const result = discover(sandbox);
    expect(result.diagnostics.scannedDirectories.length).toBeGreaterThanOrEqual(30);
    expect(result.skills.find((s) => s.name === "first")).toBeDefined();
    expect(result.skills.find((s) => s.name === "last")).toBeDefined();
    expect(result.skills.find((s) => s.name === "shared")).toBeDefined();
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M16: reserved names (.ccski-staging-* / .ccski-backup-*) are skipped by discovery", () => {
    const sandbox = makeSandbox("m16");
    const root = join(sandbox.home, ".claude", "skills");
    writeSkill(join(root, ".ccski-staging-abc123"), "staged");
    writeSkill(join(root, ".ccski-backup-def456"), "backed");
    const normal = writeSkill(join(root, "normal"), "normal");

    const result = discover(sandbox);
    expect(result.skills.find((s) => s.name === "staged")).toBeUndefined();
    expect(result.skills.find((s) => s.name === "backed")).toBeUndefined();
    expect(result.skills.find((s) => s.path === normal)).toBeDefined();
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M17: sweep removes marked staging residue whose writer process is dead", async () => {
    const sandbox = makeSandbox("m17");
    const root = join(sandbox.home, ".claude", "skills");
    const residue = join(root, ".ccski-staging-feed1");
    mkdirSync(residue, { recursive: true });
    writeFileSync(join(residue, "partial"), "staged bytes");
    const deadPid = await spawnExitedPid();
    writeFileSync(
      join(residue, CCSKI_RESIDUE_MARKER_FILENAME),
      JSON.stringify({ pid: deadPid, createdAt: Date.now(), kind: "staging" })
    );

    const result = sweepReservedResidues(root);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]?.path).toBe(residue);
    expect(existsSync(residue)).toBe(false);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M18: sweep removes aged residue even with a live writer pid (age condition)", () => {
    const sandbox = makeSandbox("m18");
    const root = join(sandbox.home, ".claude", "skills");
    const residue = join(root, ".ccski-backup-old9");
    mkdirSync(residue, { recursive: true });
    const createdAt = 1_000;
    writeFileSync(
      join(residue, CCSKI_RESIDUE_MARKER_FILENAME),
      JSON.stringify({ pid: process.pid, createdAt, kind: "backup" })
    );
    const tick = createdAt + 10_001;

    const result = sweepReservedResidues(root, { maxAgeMs: 10_000, now: () => tick });
    expect(result.removed).toHaveLength(1);
    expect(existsSync(residue)).toBe(false);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M19: sweep keeps young residue whose writer pid is still alive", () => {
    const sandbox = makeSandbox("m19");
    const root = join(sandbox.home, ".claude", "skills");
    const residue = join(root, ".ccski-staging-live2");
    mkdirSync(residue, { recursive: true });
    const createdAt = Date.now();
    writeFileSync(
      join(residue, CCSKI_RESIDUE_MARKER_FILENAME),
      JSON.stringify({ pid: process.pid, createdAt, kind: "staging" })
    );

    const result = sweepReservedResidues(root, { maxAgeMs: 10_000 });
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.reason).toBe("writer-alive");
    expect(existsSync(residue)).toBe(true);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M20: same-named user directory WITHOUT a marker is never deleted (no prefix-blind purge)", () => {
    const sandbox = makeSandbox("m20");
    const root = join(sandbox.home, ".claude", "skills");
    const userDir = writeSkill(join(root, ".ccski-staging-my-notes"), "my-notes");
    const backupDir = writeSkill(join(root, ".ccski-backup-precious"), "precious");

    const result = sweepReservedResidues(root);
    expect(result.kept).toHaveLength(2);
    expect(result.kept.map((k) => k.reason)).toEqual(["no-marker", "no-marker"]);
    expect(existsSync(join(userDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(backupDir, "SKILL.md"))).toBe(true);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M21: residue with an unreadable marker is kept (marker-unreadable)", () => {
    const sandbox = makeSandbox("m21");
    const root = join(sandbox.home, ".claude", "skills");
    const residue = join(root, ".ccski-backup-broken");
    mkdirSync(residue, { recursive: true });
    writeFileSync(join(residue, CCSKI_RESIDUE_MARKER_FILENAME), "{ not json");

    const result = sweepReservedResidues(root);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.reason).toBe("marker-unreadable");
    expect(existsSync(residue)).toBe(true);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M22: reserved-name symlink is never touched (no deletion through links)", () => {
    const sandbox = makeSandbox("m22");
    const targetDir = writeSkill(join(sandbox.home, "skills", "keeper"), "keeper");
    const root = join(sandbox.home, ".claude", "skills");
    mkdirSync(root, { recursive: true });
    const linkPath = join(root, ".ccski-backup-link");
    symlinkSync(targetDir, linkPath);

    const result = sweepReservedResidues(root);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.reason).toBe("non-directory");
    expect(existsSync(linkPath)).toBe(true);
    expect(existsSync(join(targetDir, "SKILL.md"))).toBe(true);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M23: discovery is read-only over seeded state (bytes untouched, absent not created)", () => {
    const sandbox = makeSandbox("m23");
    const entityDir = writeSkill(join(sandbox.home, ".agents", "skills", "keep"), "keep");
    const linkPath = join(sandbox.home, ".claude", "skills", "keep");
    mkdirSync(join(sandbox.home, ".claude", "skills"), { recursive: true });
    symlinkSync(entityDir, linkPath);
    const statePath = seedState(
      join(sandbox.home, ".agents"),
      { ent_23: { path: real(entityDir), name: "keep" } },
      { prj_23: { path: linkPath, mode: "link", entityId: "ent_23", disabled: false } }
    );
    const before = readFileSync(statePath, "utf8");

    discover(sandbox);
    discover(sandbox, false);

    expect(readFileSync(statePath, "utf8")).toBe(before);
    expect(existsSync(join(sandbox.workspace, ".agents", STATE_FILENAME))).toBe(false);
    expect(existsSync(`${statePath}.lock`)).toBe(false);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });

  it("M24: SkillRegistry propagates kernel omissions through getDiagnostics", () => {
    const sandbox = makeSandbox("m24");
    const projRoot = join(sandbox.home, ".claude", "skills");
    mkdirSync(projRoot, { recursive: true });
    symlinkSync(join(projRoot, "vanished"), join(projRoot, "ghost"));
    writeSkill(join(projRoot, "solid"), "solid");

    const registry = new SkillRegistry({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      scanDefaultDirs: true,
      skipPlugins: true,
    });
    const diagnostics = registry.getDiagnostics();
    expect(diagnostics.omissions.some((o) => o.code === "broken-symlink" && o.name === "ghost")).toBe(
      true
    );
    expect(registry.getAll().some((s) => s.path === join(projRoot, "solid"))).toBe(true);
    rmSync(sandbox.home, { recursive: true, force: true });
    rmSync(sandbox.workspace, { recursive: true, force: true });
  });
});
