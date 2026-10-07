/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「CLI 命令名保留、内部切换内核 API」——enable/disable
 * 命令测试改写为 toggleEntityProjection 内核等价用例（2.x toggleSkills 用例随入口
 * 退役；G5 门收据的一部分）
 * 正交意图：
 *   [1] link 物理 toggle 收据：disable = 摘链 + state disabled；enable = ENTITY_REVISED
 *       闸 + 重建；物化 = .SKILL.md rename + convention:ccski-legacy
 *   [2] 名字解析面：state 实体记录（未知名 typed ENTITY_NOT_FOUND + available 列表；
 *       零投影实体 skipped；--json 结构化收据）
 * 妥协声明：无。真磁盘 fixture（kernel-fixtures 沙箱），tmp 自清理。
 */
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureEntity, projectEntity } from "../src/api/index.js";
import { disableCommand, enableCommand } from "../src/cli/commands/toggle.js";
import {
  cleanupSandbox,
  makeSandbox,
  readState,
  scopeOpts,
  writeSkillSource,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";

function captureJson(): { logs: string[]; spy: ReturnType<typeof vi.spyOn> } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    logs.push(typeof message === "string" ? message : String(message ?? ""));
  });
  return { logs, spy };
}

function lastJson<T>(logs: string[]): T {
  return JSON.parse(logs.join("\n")) as T;
}

describe("enable/disable commands（内核 toggleEntityProjection 面）", () => {
  let sandbox: Sandbox;
  const originalCwd = process.cwd();

  beforeEach(() => {
    sandbox = makeSandbox("cli-toggle", "project");
    process.chdir(sandbox.workspace);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    vi.restoreAllMocks();
    cleanupSandbox(sandbox);
  });

  async function setupEntityWithLink(name: string): Promise<{ root: string; linkPath: string }> {
    const source = writeSkillSource(sandbox.workspace, name, "v1\n");
    const created = await ensureEntity({
      scope: "project",
      source: { dir: source },
      ...scopeOpts(sandbox),
    });
    expect(created.kind).toBe("ok");
    const root = join(sandbox.workspace, "agents-a", "skills");
    const projected = await projectEntity({
      scope: "project",
      name,
      roots: [root],
      ...scopeOpts(sandbox),
    });
    expect(projected.kind).toBe("ok");
    return { root, linkPath: join(root, name) };
  }

  it("disable：link 摘链 + state disabled（物理生效）", async () => {
    const { linkPath } = await setupEntityWithLink("alpha");
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

    await disableCommand({
      names: ["alpha"],
      _: ["disable", "alpha"],
      $0: "ccski",
    } as never);

    expect(existsSync(linkPath)).toBe(false);
    const state = readState(sandbox.scopeBase);
    const record = Object.values(state.projections).find((r) => r["folderName"] === "alpha");
    expect(record?.["disabled"]).toBe(true);
  });

  it("enable：重建链；实体被外部改写后 enable → ENTITY_REVISED typed 失败收据", async () => {
    const { linkPath } = await setupEntityWithLink("beta");
    await disableCommand({ names: ["beta"], _: ["disable"], $0: "ccski" } as never);
    expect(existsSync(linkPath)).toBe(false);

    await enableCommand({ names: ["beta"], _: ["enable"], $0: "ccski" } as never);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

    await disableCommand({ names: ["beta"], _: ["disable"], $0: "ccski" } as never);
    // 实体被外部直接改写（绕过 update 面 → 记录 entityRevision 与磁盘 revision 失配）
    const entityDir = join(sandbox.entityRoot, "beta");
    writeFileSync(
      join(entityDir, "SKILL.md"),
      `---\nname: beta\ndescription: externally rewritten\n---\nexternal\n`
    );

    const { logs, spy } = captureJson();
    await enableCommand({ names: ["beta"], json: true, _: ["enable"], $0: "ccski" } as never);
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
    const summary = lastJson<{ results: Array<{ status: string; errorCode?: string }> }>(logs);
    expect(summary.results[0]?.status).toBe("failed");
    expect(summary.results[0]?.errorCode).toBe("ENTITY_REVISED");
    expect(existsSync(linkPath)).toBe(false);
  });

  it("未知名 → ENTITY_NOT_FOUND typed 失败 + available 实体列表", async () => {
    await setupEntityWithLink("gamma");
    const { logs, spy } = captureJson();
    await disableCommand({ names: ["nope"], json: true, _: ["disable"], $0: "ccski" } as never);
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
    const payload = lastJson<{ kind: string; code: string; available: string[] }>(logs);
    expect(payload.kind).toBe("error");
    expect(payload.code).toBe("ENTITY_NOT_FOUND");
    expect(payload.available).toContain("gamma");
  });

  it("零投影实体 → skipped 条目；materialized 实体 disable = .SKILL.md rename + ccski-legacy", async () => {
    const source = writeSkillSource(sandbox.workspace, "lonely", "v1\n");
    await ensureEntity({ scope: "project", source: { dir: source }, ...scopeOpts(sandbox) });

    const { logs, spy } = captureJson();
    await disableCommand({ names: ["lonely"], json: true, _: ["disable"], $0: "ccski" } as never);
    spy.mockRestore();
    const summary = lastJson<{ results: Array<{ status: string; errorCode?: string }> }>(logs);
    expect(summary.results[0]?.status).toBe("skipped");
    expect(summary.results[0]?.errorCode).toBe("NO_PROJECTIONS");

    // materialized 副本：projectEntity user-request 到独立根
    const copyRoot = join(sandbox.workspace, "agents-m", "skills");
    const projected = await projectEntity({
      scope: "project",
      name: "lonely",
      roots: [copyRoot],
      mode: "materialized",
      reason: "user-request",
      ...scopeOpts(sandbox),
    });
    expect(projected.kind).toBe("ok");
    expect(existsSync(join(copyRoot, "lonely", "SKILL.md"))).toBe(true);

    const { logs: logs2, spy: spy2 } = captureJson();
    await disableCommand({ names: ["lonely"], json: true, _: ["disable"], $0: "ccski" } as never);
    spy2.mockRestore();
    const summary2 = lastJson<{
      results: Array<{ status: string; mode?: string; error?: string }>;
    }>(logs2);
    expect(summary2.results[0]?.status).toBe("toggled");
    expect(summary2.results[0]?.mode).toBe("materialized");
    expect(existsSync(join(copyRoot, "lonely", ".SKILL.md"))).toBe(true);
    expect(existsSync(join(copyRoot, "lonely", "SKILL.md"))).toBe(false);
  });
});
