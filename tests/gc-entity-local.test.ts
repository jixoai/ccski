/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「P0-2 gc 误报：findUnknownReferencesAtRoot 排除
 * entity root 本体（entity-local 语义）——正常 canonical entity 不产生
 * GC_UNKNOWN_REFERENCE；warning + clean:true 不一致一并修；补正常投影不误报
 * 回归测试」（codex 3.0 残留审计 P0-2）
 * 正交意图：
 *   [1] 正常态回归：实体存在（entity root 扫描）零 GC_UNKNOWN_REFERENCE、
 *       clean 如实（无提案无 warning 时 clean:true）
 *   [2] clean 一致性：有 unknown-reference warning 时 clean:false（不再出现
 *       「有 warning 却 clean」的自相矛盾）
 *   [3] 保留面：实体根内的 alias symlink（指向实体）仍是未知引用；投影根上的
 *       未注册实目录仍上报（migrate 收编语义不变）
 * 妥协声明：无。
 */
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureEntity, projectEntity } from "../src/api/index.js";
import { gcPropose } from "../src/api/gc.js";
import {
  cleanupSandbox,
  makeSandbox,
  scopeOpts,
  writeSkillSource,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";

let sandbox: Sandbox;
const created: Sandbox[] = [];

beforeEach(() => {
  sandbox = makeSandbox("gc-local", "project");
  created.push(sandbox);
});

afterEach(() => {
  for (const box of created) cleanupSandbox(box);
  created.length = 0;
});

describe("gc entity-local 本体不误报（P0-2 回归）", () => {
  it("正常 canonical entity（零投影记录）：实体根扫描零 GC_UNKNOWN_REFERENCE，clean:true", async () => {
    const source = writeSkillSource(sandbox.workspace, "alpha");
    const ensured = await ensureEntity({
      scope: "project",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(ensured.kind).toBe("ok");

    const result = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.unknownReferences).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it("实体 + 正常 link 投影：注册根与实体根均零误报，clean:true", async () => {
    const source = writeSkillSource(sandbox.workspace, "beta");
    const ensured = await ensureEntity({
      scope: "project",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;
    const rootA = join(sandbox.workspace, "agents-a", "skills");
    const projected = await projectEntity({
      scope: "project",
      name: ensured.entity.logicalName,
      roots: [rootA],
      ...scopeOpts(sandbox),
    });
    expect(projected.kind).toBe("ok");

    const result = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.unknownReferences).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.clean).toBe(true);
  });

  it("有 unknown-reference warning 时 clean:false（warning 与 clean 不再矛盾）", async () => {
    const source = writeSkillSource(sandbox.workspace, "gamma");
    const ensured = await ensureEntity({
      scope: "project",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;
    // 实体目录被外部删除后，同名 symlink 占住实体根条目（指向旧实体路径）——
    // 实体根扫描仍如实上报未知引用（entity-local 排除只豁免实体本体目录形态）
    rmSync(ensured.entity.path, { recursive: true, force: true });
    symlinkSync(ensured.entity.path, join(sandbox.entityRoot, "gamma"));

    const result = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.unknownReferences).toHaveLength(1);
    expect(result.unknownReferences[0]?.code).toBe("GC_UNKNOWN_REFERENCE");
    expect(result.clean).toBe(false);
  });

  it("注册根上指向实体的野链（未注册）仍上报；clean 如实为 false", async () => {
    const sourceDelta = writeSkillSource(sandbox.workspace, "delta");
    const ensured = await ensureEntity({
      scope: "project",
      source: { dir: sourceDelta },
      ...scopeOpts(sandbox),
    });
    expect(ensured.kind).toBe("ok");
    if (ensured.kind !== "ok") return;
    const sourceEcho = writeSkillSource(sandbox.workspace, "echo");
    const ensuredEcho = await ensureEntity({
      scope: "project",
      source: { dir: sourceEcho },
      ...scopeOpts(sandbox),
    });
    expect(ensuredEcho.kind).toBe("ok");
    if (ensuredEcho.kind !== "ok") return;
    // 注册投影根（gc 只扫 state 登记过的 roots —— 永不猜路径）；rootB 只登记
    // delta，echo 的野链（指向 echo 实体）= 未注册引用 → GC_UNKNOWN_REFERENCE
    const rootB = join(sandbox.workspace, "agents-b", "skills");
    const projected = await projectEntity({
      scope: "project",
      name: ensured.entity.logicalName,
      roots: [rootB],
      ...scopeOpts(sandbox),
    });
    expect(projected.kind).toBe("ok");
    symlinkSync(ensuredEcho.entity.path, join(rootB, "echo"));

    const result = await gcPropose({ scope: "project", dryRun: true, ...scopeOpts(sandbox) });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.unknownReferences).toHaveLength(1);
    expect(result.unknownReferences[0]?.root).toBe(rootB);
    expect(result.unknownReferences[0]?.folderName).toBe("echo");
    expect(result.clean).toBe(false);
  });
});
