/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「四命令全 typed 契约测试（含 dry-run 不变性：dry-run 后
 * 磁盘与 state 字节零变化断言）」——批 5 G5 门收据：migrate / gc / state repair /
 * import --claim（tasks.md 批 5；G5 门行）
 * 正交意图：
 *   [1] migrate 契约：dry-run 计划（碰撞/hash/目标实体/投影计划/影响 roots）+ 字节
 *       不变性；执行（实体收编 + 副本→link 转换 + expected hash 守卫 + 冲突保留原件
 *       其余继续 + backup/journal 回滚 + journal replay 崩溃收敛）
 *   [2] gc 契约：仅 dry-run（DRY_RUN_REQUIRED typed 拒绝执行半区）+ roots 消失提案 +
 *       字节不变性 + GC_UNKNOWN_REFERENCE warning
 *   [3] repair 契约：diff 报告 + REPAIR_CONFIRM_REQUIRED + 预修复备份 + 幂等（二跑
 *       clean 零写入）+ 深度清扫收编（无 marker 无身份文件 --confirm 删；带身份保守
 *       保留）+ 修复半区（孤儿记录退役/禁用链缺席豁免）
 *   [4] claim 契约：inode+hash 双守卫 + CLAIM_CONFLICT reason 双触发（identity-
 *       mismatch / name-conflict）+ 只动 state（fs 字节不变）+ 幂等 unchanged
 * 妥协声明：全部真磁盘 fixture + 真实 rename/hash 构造（不 mock fs/guard）；崩溃窗以
 * journal + backup 的真实磁盘形态构造（与批 1/4 的 worker SIGKILL 法同源，此处静态
 * 形态足以钉 replay 语义）。
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claimLink,
  ensureEntity,
  gcPropose,
  migrateLegacyEntries,
  observeClaimTarget,
  projectEntity,
  repairState,
} from "../src/api/index.js";
import { CCSKI_RESIDUE_MARKER_FILENAME } from "../src/core/discovery.js";
import {
  assertSnapshotEqual,
  cleanupSandbox,
  hashOf,
  makeSandbox,
  readState,
  scopeOpts,
  snapshotDir,
  writeSkillSource,
  writeState,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";

let sandbox: Sandbox;
const created: Sandbox[] = [];

beforeEach(() => {
  sandbox = makeSandbox("batch5", "project");
  created.push(sandbox);
});

afterEach(() => {
  for (const box of created) cleanupSandbox(box);
  created.length = 0;
});

/** 在实体根放一个无 state 记录的 legacy 目录（含 SKILL.md） */
function placeLegacyDir(name: string, body: string): string {
  const dir = join(sandbox.entityRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: legacy ${name}\n---\n${body}`
  );
  return dir;
}

/** 在指定根放一个 legacy 副本目录 */
function placeLegacyCopy(root: string, name: string, body: string): string {
  mkdirSync(root, { recursive: true });
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: legacy ${name}\n---\n${body}`
  );
  return dir;
}

describe("migrate：dry-run 计划与字节不变性", () => {
  it("dry-run 列出目标实体/投影计划/影响 roots/hash，且磁盘与 state 字节零变化", async () => {
    const legacyDir = placeLegacyDir("alpha", "legacy\n");
    const copyRoot = join(sandbox.workspace, "agents-a", "skills");
    const copyPath = placeLegacyCopy(copyRoot, "alpha", "legacy\n");
    mkdirSync(sandbox.scopeBase, { recursive: true });
    writeState(sandbox.scopeBase, {
      schemaVersion: 1,
      generation: 7,
      entities: {},
      projections: {},
    });

    const before = snapshotDir(sandbox.workspace);
    const beforeHome = snapshotDir(sandbox.home);

    const plan = await migrateLegacyEntries({
      scope: "project",
      dryRun: true,
      roots: [copyRoot],
      ...scopeOpts(sandbox),
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok" || !plan.dryRun) return;
    expect(plan.targetEntities).toHaveLength(1);
    expect(plan.targetEntities[0]).toMatchObject({
      kind: "entity-adoption",
      path: legacyDir,
      logicalName: "alpha",
      folderName: "alpha",
      sanitizeTarget: "alpha",
    });
    expect(plan.targetEntities[0]?.hash).toBe(await hashOf(legacyDir));
    expect(plan.plannedProjections).toHaveLength(1);
    expect(plan.plannedProjections[0]).toMatchObject({
      kind: "projection-conversion",
      path: copyPath,
      root: copyRoot,
    });
    expect(plan.collisions).toHaveLength(0);
    expect(plan.affectedRoots.sort()).toEqual([sandbox.entityRoot, copyRoot].map((p) => p).sort());
    // 字节不变性收据（G5 门）：dry-run 后磁盘零变化（含 state 文件字节）
    assertSnapshotEqual(before, snapshotDir(sandbox.workspace));
    assertSnapshotEqual(beforeHome, snapshotDir(sandbox.home));
    expect(readState(sandbox.scopeBase).generation).toBe(7);
  });

  it("dry-run 报告名称碰撞（同名 sanitize 的候选间冲突），原件不动", async () => {
    // 注意：macOS 大小写不敏感文件系统上 "My Skill"/"MY SKILL" 是同一目录；
    // 用不同目录名 sanitize 到同一 folder（连续空格游程同为集合外字符）。
    placeLegacyDir("My Skill", "a\n"); // sanitize → my-skill
    placeLegacyDir("My  Skill", "b\n"); // sanitize → my-skill（候选间碰撞）
    const plan = await migrateLegacyEntries({
      scope: "project",
      dryRun: true,
      ...scopeOpts(sandbox),
    });
    if (plan.kind !== "ok" || !plan.dryRun) return;
    expect(plan.collisions.some((c) => c.code === "NAME_COLLISION")).toBe(true);
    expect(existsSync(join(sandbox.entityRoot, "My Skill"))).toBe(true);
    expect(existsSync(join(sandbox.entityRoot, "My  Skill"))).toBe(true);
  });
});

describe("migrate：执行（收编 + 转换 + 守卫 + 回滚）", () => {
  it("执行：实体收编（内容保持 hash 一致）+ 副本换链 + state 投影记录", async () => {
    const legacyDir = placeLegacyDir("alpha", "legacy\n");
    const legacyHash = await hashOf(legacyDir);
    const copyRoot = join(sandbox.workspace, "agents-a", "skills");
    placeLegacyCopy(copyRoot, "alpha", "legacy\n");

    const result = await migrateLegacyEntries({
      scope: "project",
      roots: [copyRoot],
      ...scopeOpts(sandbox),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || result.dryRun) return;
    expect(result.adopted).toHaveLength(1);
    expect(result.adopted[0]).toMatchObject({ logicalName: "alpha", folderName: "alpha" });
    expect(result.adopted[0]?.revision).toBe(legacyHash);
    expect(result.conflicts).toHaveLength(0);
    // 副本 → link
    const linkPath = join(copyRoot, "alpha");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(result.converted).toHaveLength(1);
    expect(result.converted[0]).toMatchObject({ mode: "link", folderName: "alpha" });
    // 实体在实体根（legacy 原路径 = 实体路径，内容已收编为记录实体）；无备份残留
    expect(existsSync(join(sandbox.entityRoot, "alpha", "SKILL.md"))).toBe(true);
    const scopeEntries = readdirSync(sandbox.scopeBase);
    expect(scopeEntries.some((name) => name.startsWith(".ccski-backup-migrate-"))).toBe(false);
    const state = readState(sandbox.scopeBase);
    expect(Object.keys(state.entities)).toContain("alpha");
    expect(Object.keys(state.projections).some((key) => key.endsWith(":alpha"))).toBe(true);
    // provenance 诚实化：source = legacy 原路径 + sourceType legacy-migrate
    const entityRecord = Object.values(state.entities).find((e) => e["logicalName"] === "alpha");
    expect(entityRecord?.["provenance"]).toMatchObject({
      source: legacyDir,
      sourceType: "legacy-migrate",
    });
  });

  it("执行：换名候选（目录名 ≠ sanitize 目标）重落位到冻结 sanitize folderName", async () => {
    placeLegacyDir("My Skill", "a\n"); // 目录 "My Skill"，sanitize → my-skill
    const result = await migrateLegacyEntries({ scope: "project", ...scopeOpts(sandbox) });
    if (result.kind !== "ok" || result.dryRun) return;
    expect(result.adopted[0]?.folderName).toBe("my-skill");
    expect(existsSync(join(sandbox.entityRoot, "my-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(sandbox.entityRoot, "My Skill"))).toBe(false);
  });

  it("expected hash 守卫（计划回传）：dry-run 后内容漂移 → HASH_MISMATCH 原件不动，其余候选继续", async () => {
    const dirA = placeLegacyDir("alpha", "v1\n");
    const dirB = placeLegacyDir("beta", "v1\n");
    const plan = await migrateLegacyEntries({
      scope: "project",
      dryRun: true,
      ...scopeOpts(sandbox),
    });
    if (plan.kind !== "ok" || !plan.dryRun) return;
    // 计划之后、执行之前的外部改动
    writeFileSync(
      join(dirA, "SKILL.md"),
      `---\nname: alpha\ndescription: legacy alpha\n---\nTAMPERED\n`
    );

    const result = await migrateLegacyEntries({ scope: "project", plan, ...scopeOpts(sandbox) });
    if (result.kind !== "ok" || result.dryRun) return;
    expect(result.conflicts.some((c) => c.code === "HASH_MISMATCH" && c.path === dirA)).toBe(true);
    // alpha 原件保持漂移后的内容不动
    expect(existsSync(dirA)).toBe(true);
    expect(readFileSync(join(dirA, "SKILL.md"), "utf8")).toContain("TAMPERED");
    // beta 收编不受影响（冲突保留原件，其余继续——spec Scenario 钉值）
    expect(result.adopted.some((a) => a.logicalName === "beta")).toBe(true);
    expect(existsSync(join(sandbox.entityRoot, "beta", "SKILL.md"))).toBe(true);
    void dirB;
  });

  it("无计划回传：执行自计划（同一内容两跑幂等收编面）", async () => {
    placeLegacyDir("alpha", "v1\n");
    const first = await migrateLegacyEntries({ scope: "project", ...scopeOpts(sandbox) });
    if (first.kind !== "ok" || first.dryRun) return;
    expect(first.adopted).toHaveLength(1);
    // 二跑：无 legacy 候选（已收编）→ 零收编零冲突
    const second = await migrateLegacyEntries({ scope: "project", ...scopeOpts(sandbox) });
    if (second.kind !== "ok" || second.dryRun) return;
    expect(second.adopted).toHaveLength(0);
    expect(second.conflicts).toHaveLength(0);
  });

  it("冲突保留原件：legacy 目录 sanitize 撞已记录实体 → NAME_COLLISION typed 不动", async () => {
    // 已有记录实体 my-skill（folderName = sanitize("my-skill")）
    const source = writeSkillSource(sandbox.workspace, "my-skill", "installed\n");
    const created = await ensureEntity({
      scope: "project",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(created.kind).toBe("ok");
    // legacy 目录 "My Skill"（sanitize → my-skill，撞已记录实体）
    const imposter = placeLegacyDir("My Skill", "legacy-imposter\n");

    const result = await migrateLegacyEntries({ scope: "project", ...scopeOpts(sandbox) });
    if (result.kind !== "ok" || result.dryRun) return;
    expect(result.adopted).toHaveLength(0);
    expect(result.conflicts.some((c) => c.code === "NAME_COLLISION" && c.path === imposter)).toBe(
      true
    );
    // 原件不动；已记录实体内容原样
    expect(existsSync(imposter)).toBe(true);
    expect(readFileSync(join(sandbox.entityRoot, "my-skill", "SKILL.md"), "utf8")).toContain(
      "installed"
    );
  });

  it("journal replay：崩溃残留（原件缺失 + 备份在）→ 下次执行还原原件并收敛", async () => {
    const legacyDir = placeLegacyDir("alpha", "v1\n");
    // 构造崩溃形态：legacy 被 rename 进备份、journal 记录在案
    const backupPath = join(sandbox.scopeBase, ".ccski-backup-migrate-crash");
    mkdirSync(sandbox.scopeBase, { recursive: true });
    renameDir(legacyDir, backupPath);
    writeFileSync(
      join(sandbox.scopeBase, ".ccski-migrate-journal.json"),
      JSON.stringify(
        {
          entries: [
            {
              id: "crash-1",
              kind: "entity",
              originalPath: legacyDir,
              backupPath,
              createdAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2
      ) + "\n"
    );

    const result = await migrateLegacyEntries({ scope: "project", ...scopeOpts(sandbox) });
    if (result.kind !== "ok" || result.dryRun) return;
    // replay 还原原件 → 本轮正常收编
    expect(existsSync(legacyDir)).toBe(true);
    expect(result.adopted.some((a) => a.logicalName === "alpha")).toBe(true);
  });
});

function renameDir(from: string, to: string): void {
  renameSync(from, to);
}

describe("gc：仅 dry-run 提案面", () => {
  it("执行半区 typed 拒绝（DRY_RUN_REQUIRED）；dry-run 提案 roots 消失记录且字节零变化", async () => {
    const source = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    const doomedRoot = join(sandbox.workspace, "agents-doomed", "skills");
    await projectEntity({
      scope: "project",
      name: "alpha",
      roots: [doomedRoot],
      ...scopeOpts(sandbox),
    });

    const refused = await gcPropose({ scope: "project", dryRun: false, ...scopeOpts(sandbox) });
    expect(refused.kind).toBe("error");
    if (refused.kind === "error") expect(refused.code).toBe("DRY_RUN_REQUIRED");

    rmSync(join(sandbox.workspace, "agents-doomed"), { recursive: true, force: true });
    const before = snapshotDir(sandbox.workspace);
    const gc = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
    expect(gc.kind).toBe("ok");
    if (gc.kind !== "ok") return;
    expect(gc.clean).toBe(false);
    expect(gc.proposals).toHaveLength(1);
    expect(gc.proposals[0]).toMatchObject({
      kind: "retire-projection",
      reason: "root-vanished",
      folderName: "alpha",
      mode: "link",
    });
    // 字节不变性：gc 不删任何东西
    assertSnapshotEqual(before, snapshotDir(sandbox.workspace));
    expect(existsSync(join(sandbox.entityRoot, "alpha", "SKILL.md"))).toBe(true);
  });

  it("注册根上的未注册同目标链 → GC_UNKNOWN_REFERENCE warning（收编走 claim）", async () => {
    // 两个已记录实体；注册根只登记了 alpha 的投影
    const sourceA = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    const sourceB = writeSkillSource(sandbox.workspace, "beta", "v1\n");
    await ensureEntity({ scope: "project", source: { dir: sourceA }, ...scopeOpts(sandbox) });
    await ensureEntity({ scope: "project", source: { dir: sourceB }, ...scopeOpts(sandbox) });
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    // 未注册链：beta 的实体在注册根上有一条野链
    symlinkSync(join(sandbox.entityRoot, "beta"), join(root, "beta"));

    const gc = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
    expect(gc.kind).toBe("ok");
    if (gc.kind !== "ok") return;
    expect(
      gc.unknownReferences.some((u) => u.code === "GC_UNKNOWN_REFERENCE" && u.folderName === "beta")
    ).toBe(true);
    // 野链不删除（gc 纯读）
    expect(lstatSync(join(root, "beta")).isSymbolicLink()).toBe(true);
  });
});

describe("state repair：diff + confirm + 幂等 + 深度清扫", () => {
  it("差异 + 未确认 → REPAIR_CONFIRM_REQUIRED（纯读零副作用）；--confirm 退役孤儿记录 + 预修复备份", async () => {
    const source = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    // 外部摘链（未走 remove）→ 孤儿记录
    rmSync(join(root, "alpha"));

    const before = snapshotDir(sandbox.workspace);
    const blocked = await repairState({ scope: "project", confirm: false, ...scopeOpts(sandbox) });
    expect(blocked.kind).toBe("confirm-required");
    if (blocked.kind !== "confirm-required") return;
    expect(blocked.code).toBe("REPAIR_CONFIRM_REQUIRED");
    expect(blocked.repairable).toBeGreaterThan(0);
    expect(blocked.diff.some((d) => d.code === "PROJECTION_RECORD_ORPHANED")).toBe(true);
    // 未确认路径零副作用
    assertSnapshotEqual(before, snapshotDir(sandbox.workspace));

    const applied = await repairState({ scope: "project", confirm: true, ...scopeOpts(sandbox) });
    expect(applied.kind).toBe("ok");
    if (applied.kind !== "ok") return;
    expect(applied.clean).toBe(false);
    expect(applied.repaired).toBeGreaterThan(0);
    expect(applied.backupPath).toBeDefined();
    expect(existsSync(applied.backupPath ?? "")).toBe(true);
    expect(readState(sandbox.scopeBase).projections).toEqual({});

    // 幂等：二跑 clean 零写入（无新备份）
    const second = await repairState({ scope: "project", confirm: true, ...scopeOpts(sandbox) });
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;
    expect(second.clean).toBe(true);
    expect(second.backupPath).toBeUndefined();
    expect(second.repaired).toBe(0);
  });

  it("禁用链缺席不豁免误报；根消失退役整根记录；实体悬空零投影退役记录", async () => {
    const source = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    // disable（摘链）→ state disabled：repair 不得将其视为漂移
    const { toggleEntityProjection } = await import("../src/api/index.js");
    const toggled = await toggleEntityProjection({
      scope: "project",
      name: "alpha",
      root,
      action: "disable",
      ...scopeOpts(sandbox),
    });
    expect(toggled.kind).toBe("ok");

    const scan = await repairState({ scope: "project", confirm: false, ...scopeOpts(sandbox) });
    if (scan.kind === "ok") {
      expect(scan.diff.some((d) => d.code === "PROJECTION_RECORD_ORPHANED")).toBe(false);
    } else if (scan.kind === "confirm-required") {
      expect(scan.diff.some((d) => d.code === "PROJECTION_RECORD_ORPHANED")).toBe(false);
    }

    // 根消失 → ROOT_VANISHED 退役
    rmSync(join(sandbox.workspace, "agents-a"), { recursive: true, force: true });
    const applied = await repairState({ scope: "project", confirm: true, ...scopeOpts(sandbox) });
    expect(applied.kind).toBe("ok");
    if (applied.kind !== "ok") return;
    expect(applied.diff.some((d) => d.code === "ROOT_VANISHED")).toBe(true);
    expect(readState(sandbox.scopeBase).projections).toEqual({});

    // 实体目录悬空 + 零投影 → ENTITY_RECORD_DANGLING 退役
    rmSync(join(sandbox.entityRoot, "alpha"), { recursive: true, force: true });
    const applied2 = await repairState({ scope: "project", confirm: true, ...scopeOpts(sandbox) });
    expect(applied2.kind).toBe("ok");
    if (applied2.kind !== "ok") return;
    expect(applied2.diff.some((d) => d.code === "ENTITY_RECORD_DANGLING")).toBe(true);
    expect(readState(sandbox.scopeBase).entities).toEqual({});
  });

  it("深度清扫收编：无 marker 无身份残留 --confirm 删；带身份文件保守保留；marker 残留走条件清扫", async () => {
    mkdirSync(sandbox.entityRoot, { recursive: true });
    // 无 marker 无身份 → deep sweep 候选
    const bare = join(sandbox.entityRoot, ".ccski-staging-bare");
    mkdirSync(bare, { recursive: true });
    writeFileSync(join(bare, "partial.bin"), "fragments");
    // 无 marker 有身份 → 保守保留
    const identity = join(sandbox.entityRoot, ".ccski-backup-identity");
    mkdirSync(identity, { recursive: true });
    writeFileSync(join(identity, "SKILL.md"), "---\nname: precious\ndescription: keep\n---\n");
    // 有 marker 写者已死 → 批 2 条件清扫（--confirm 路径内）
    const marked = join(sandbox.entityRoot, ".ccski-backup-marked");
    mkdirSync(marked, { recursive: true });
    writeFileSync(
      join(marked, CCSKI_RESIDUE_MARKER_FILENAME),
      `${JSON.stringify({ pid: 999999999, createdAt: Date.now() - 60_000, kind: "backup" })}\n`
    );

    const report = await repairState({
      scope: "project",
      confirm: false,
      residueMaxAgeMs: 1000,
      ...scopeOpts(sandbox),
    });
    expect(report.kind).toBe("confirm-required");
    if (report.kind !== "confirm-required") return;
    expect(
      report.diff.some(
        (d) => d.code === "RESIDUE_UNMARKED" && d.path === bare && d.action === "delete-residue"
      )
    ).toBe(true);
    expect(report.diff.some((d) => d.path === identity && d.action === "none")).toBe(true);

    await repairState({
      scope: "project",
      confirm: true,
      residueMaxAgeMs: 1000,
      ...scopeOpts(sandbox),
    });
    expect(existsSync(bare)).toBe(false); // 深度清扫收编（批 4 移交闭环）
    expect(existsSync(identity)).toBe(true); // 保守法则不破：身份内容永不自动删
    expect(existsSync(marked)).toBe(false); // marker 条件清扫

    // 未确认路径同样零删除（纯读报告）
    const bare2 = join(sandbox.entityRoot, ".ccski-staging-bare2");
    mkdirSync(bare2, { recursive: true });
    await repairState({
      scope: "project",
      confirm: false,
      residueMaxAgeMs: 1000,
      ...scopeOpts(sandbox),
    });
    expect(existsSync(bare2)).toBe(true);
  });

  it("report-only 面：实体根 legacy 目录 = LEGACY_DIR_NEEDS_MIGRATE；投影位被占 = PROJECTION_PATH_OCCUPIED；未注册链 = UNREGISTERED_LINK_CLAIMABLE", async () => {
    const source = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    // 投影位被实目录占据（换体）+ 实体根 legacy 目录 + 未注册链
    rmSync(join(root, "alpha"));
    mkdirSync(join(root, "alpha"), { recursive: true });
    writeFileSync(join(root, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: swap\n---\n");
    placeLegacyDir("legacy-one", "legacy\n");
    const strayRoot = join(sandbox.workspace, "agents-stray", "skills");
    mkdirSync(strayRoot, { recursive: true });
    symlinkSync(join(sandbox.entityRoot, "alpha"), join(strayRoot, "alpha"));

    const report = await repairState({
      scope: "project",
      confirm: false,
      roots: [strayRoot],
      ...scopeOpts(sandbox),
    });
    if (report.kind === "error") throw new Error(report.message);
    const diff = report.diff;
    expect(
      diff.some(
        (d) =>
          d.code === "LEGACY_DIR_NEEDS_MIGRATE" && d.path === join(sandbox.entityRoot, "legacy-one")
      )
    ).toBe(true);
    expect(
      diff.some((d) => d.code === "PROJECTION_PATH_OCCUPIED" && d.path === join(root, "alpha"))
    ).toBe(true);
    expect(
      diff.some(
        (d) => d.code === "UNREGISTERED_LINK_CLAIMABLE" && d.path === join(strayRoot, "alpha")
      )
    ).toBe(true);
    // 换体内容与 legacy 目录都原样（repair 永不动磁盘内容）
    expect(readFileSync(join(root, "alpha", "SKILL.md"), "utf8")).toContain("swap");
  });
});

describe("import --claim：inode+hash 守卫与双触发", () => {
  async function setupEntityAndStrayLink(
    name: string,
    body: string
  ): Promise<{ linkPath: string; target: string }> {
    const source = writeSkillSource(sandbox.workspace, name, body);
    const created = await ensureEntity({
      scope: "project",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(created.kind).toBe("ok");
    const target = join(sandbox.entityRoot, name);
    const strayRoot = join(sandbox.workspace, "agents-stray", "skills");
    mkdirSync(strayRoot, { recursive: true });
    const linkPath = join(strayRoot, name);
    symlinkSync(target, linkPath);
    return { linkPath, target };
  }

  it("--observe 只读打印 inode/hash（零 state）；claim 成功只写 state（fs 字节零变化）", async () => {
    const { linkPath } = await setupEntityAndStrayLink("alpha", "v1\n");
    const observed = await observeClaimTarget(linkPath);
    expect(observed.kind).toBe("ok");
    if (observed.kind !== "ok") return;

    const before = snapshotDir(sandbox.workspace);
    const result = await claimLink({
      scope: "project",
      link: linkPath,
      expectedInode: observed.inode,
      expectedHash: observed.contentHash,
      ...scopeOpts(sandbox),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.status).toBe("claimed");
    expect(result.projection.mode).toBe("link");
    expect(result.verified.inode).toBe(observed.inode);
    // 只动 state：技能面磁盘字节零变化（claim 不动文件系统；state 文件本身按设计
    // 前进一代 + 新增投影记录——分层单写者的合法写入面）
    const after = snapshotDir(sandbox.workspace);
    const stateFileRel = ".agents/.ccski-state.json";
    expect(after.files.has(stateFileRel)).toBe(true);
    assertSnapshotEqual(
      { ...before, files: new Map([...before.files].filter(([k]) => k !== stateFileRel)) },
      { ...after, files: new Map([...after.files].filter(([k]) => k !== stateFileRel)) }
    );
    const state = readState(sandbox.scopeBase);
    const record = Object.values(state.projections).find((r) => r["path"] === linkPath);
    expect(record).toBeDefined();
    expect(record?.["ownership"]).toBe("ccski");
  });

  it("identity-mismatch：inode 不符 / hash 不符 → CLAIM_CONFLICT reason:identity-mismatch 零 state 变更", async () => {
    const { linkPath } = await setupEntityAndStrayLink("alpha", "v1\n");
    const observed = await observeClaimTarget(linkPath);
    if (observed.kind !== "ok") throw new Error("observe failed");

    const wrongInode = await claimLink({
      scope: "project",
      link: linkPath,
      expectedInode: observed.inode + 1,
      expectedHash: observed.contentHash,
      ...scopeOpts(sandbox),
    });
    expect(wrongInode.kind).toBe("error");
    if (wrongInode.kind === "error") {
      expect(wrongInode.code).toBe("CLAIM_CONFLICT");
      expect(wrongInode.reason).toBe("identity-mismatch");
    }

    const wrongHash = await claimLink({
      scope: "project",
      link: linkPath,
      expectedInode: observed.inode,
      expectedHash: "0".repeat(64),
      ...scopeOpts(sandbox),
    });
    expect(wrongHash.kind).toBe("error");
    if (wrongHash.kind === "error") {
      expect(wrongHash.code).toBe("CLAIM_CONFLICT");
      expect(wrongHash.reason).toBe("identity-mismatch");
    }
    expect(readState(sandbox.scopeBase).projections).toEqual({});
  });

  it("name-conflict：链接名 ≠ 实体 folderName → CLAIM_CONFLICT reason:name-conflict；已注册 → 幂等 unchanged", async () => {
    const { linkPath, target } = await setupEntityAndStrayLink("alpha", "v1\n");
    const observed = await observeClaimTarget(linkPath);
    if (observed.kind !== "ok") throw new Error("observe failed");
    // 改名链接：beta → alpha 实体
    const strayRoot = join(sandbox.workspace, "agents-stray", "skills");
    const misnamed = join(strayRoot, "beta");
    renameDir(linkPath, misnamed);

    const conflict = await claimLink({
      scope: "project",
      link: misnamed,
      expectedInode: observed.inode,
      expectedHash: observed.contentHash,
      ...scopeOpts(sandbox),
    });
    expect(conflict.kind).toBe("error");
    if (conflict.kind === "error") {
      expect(conflict.code).toBe("CLAIM_CONFLICT");
      expect(conflict.reason).toBe("name-conflict");
    }

    // 链名复位后 claim 成功；重复 claim → unchanged 幂等
    renameDir(misnamed, linkPath);
    const ok = await claimLink({
      scope: "project",
      link: linkPath,
      expectedInode: observed.inode,
      expectedHash: observed.contentHash,
      ...scopeOpts(sandbox),
    });
    expect(ok.kind).toBe("ok");
    const again = await claimLink({
      scope: "project",
      link: linkPath,
      expectedInode: observed.inode,
      expectedHash: observed.contentHash,
      ...scopeOpts(sandbox),
    });
    expect(again.kind).toBe("ok");
    if (again.kind === "ok") {
      expect(again.status).toBe("unchanged");
      expect(again.warnings.length).toBeGreaterThan(0);
    }
    void target;
  });

  it("指向非实体目标的链 → ENTITY_NOT_FOUND（实体收编归 migrate）", async () => {
    const foreign = mkdtempSync(join(tmpdir(), "ccski-claim-foreign-"));
    try {
      writeFileSync(join(foreign, "SKILL.md"), "---\nname: foreign\ndescription: x\n---\n");
      const strayRoot = join(sandbox.workspace, "agents-stray", "skills");
      mkdirSync(strayRoot, { recursive: true });
      const linkPath = join(strayRoot, "foreign");
      symlinkSync(foreign, linkPath);
      const observed = await observeClaimTarget(linkPath);
      if (observed.kind !== "ok") throw new Error("observe failed");
      const result = await claimLink({
        scope: "project",
        link: linkPath,
        expectedInode: observed.inode,
        expectedHash: observed.contentHash,
        ...scopeOpts(sandbox),
      });
      expect(result.kind).toBe("error");
      if (result.kind === "error") expect(result.code).toBe("ENTITY_NOT_FOUND");
      // 本用例未建任何 state（无 ensureEntity）——零 state 写入以文件缺席断言
      expect(existsSync(join(sandbox.scopeBase, ".ccski-state.json"))).toBe(false);
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });
});
