/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「STALE_PROJECTION verify 报告面（批 4 移交）：list/CLI
 * 的 stale 标注呈现（state 侧标注/清除批 4 已钉，本批补报告面）」（批 5 移交项）
 * 正交意图：
 *   [1] 报告面链路收据：replace 标注 stale（批 4）→ 发现层读 state stale 字段 →
 *       SkillMetadata.stale → list --json/plain 呈现（typed STALE_PROJECTION 词）
 *   [2] 收敛清除链路：updateEntity 收敛后 stale 清除 → 报告面不再呈现（批 4 语义 +
 *       本批报告面的往返闭环）
 *   [3] 非链接条目/未标注条目零污染（stale 字段缺省）
 * 妥协声明：无。真磁盘 fixture（kernel-fixtures 沙箱），tmp 自清理。
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureEntity, projectEntity, updateEntity } from "../src/api/index.js";
import { listCommand } from "../src/cli/commands/list.js";
import { discoverSkills } from "../src/core/discovery.js";
import {
  cleanupSandbox,
  makeSandbox,
  scopeOpts,
  writeSkillSource,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";

function capture(): { logs: string[]; spy: ReturnType<typeof vi.spyOn> } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
    logs.push(typeof message === "string" ? message : String(message ?? ""));
  });
  return { logs, spy };
}

describe("STALE_PROJECTION 报告面", () => {
  let sandbox: Sandbox;
  const originalCwd = process.cwd();

  beforeEach(() => {
    sandbox = makeSandbox("stale-report", "project");
    process.chdir(sandbox.workspace);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    vi.restoreAllMocks();
    cleanupSandbox(sandbox);
  });

  it("replace 后：发现层 SkillMetadata.stale=true；list --json/plain 呈现 STALE_PROJECTION", async () => {
    const source1 = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    const created = await ensureEntity({
      scope: "project",
      source: { dir: source1 },
      ...scopeOpts(sandbox),
    });
    expect(created.kind).toBe("ok");
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "alpha", roots: [root], ...scopeOpts(sandbox) });
    // 异源 replace（expectedRevision 从 created 快照取）
    const source2 = writeSkillSource(sandbox.workspace, "alpha", "v2\n");
    writeFileSync(
      join(source2, "SKILL.md"),
      "---\nname: alpha\ndescription: alpha v2 replace\n---\nv2\n"
    );
    const replaced = await ensureEntity({
      scope: "project",
      source: { dir: source2 },
      replace: { expectedRevision: created.kind === "ok" ? created.entity.revision : "" },
      ...scopeOpts(sandbox),
    });
    expect(replaced.kind).toBe("ok");

    // 发现层报告面（state 视图 stale 链路）
    const discovered = discoverSkills({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      stateBases: [sandbox.scopeBase],
      scanDefaultDirs: false,
      customDirs: [root],
    });
    const alpha = discovered.skills.find(
      (skill) => skill.name === "alpha" || skill.name.endsWith(":alpha")
    );
    expect(alpha).toBeDefined();
    expect(alpha?.stale).toBe(true);
    expect(alpha?.mode).toBe("link");

    // CLI list 报告面（--json 携带字段；plain 带 STALE_PROJECTION 标注）
    const { logs, spy } = capture();
    await listCommand({
      json: true,
      skillDir: [root],
      scanDefaultDirs: false,
      claudePluginsFile: join(sandbox.workspace, "missing-plugins.json"),
      userDir: sandbox.home,
      _: ["list"],
      $0: "ccski",
    } as never);
    spy.mockRestore();
    const listed = JSON.parse(logs.join("\n")) as Array<{
      name: string;
      stale?: boolean;
      mode?: string;
    }>;
    const alphaJson = listed.find(
      (skill) => skill.name === "other:alpha" || skill.name === "alpha"
    );
    expect(alphaJson?.stale).toBe(true);

    const { logs: plainLogs, spy: plainSpy } = capture();
    await listCommand({
      skillDir: [root],
      scanDefaultDirs: false,
      claudePluginsFile: join(sandbox.workspace, "missing-plugins.json"),
      userDir: sandbox.home,
      _: ["list"],
      $0: "ccski",
    } as never);
    plainSpy.mockRestore();
    expect(plainLogs.join("\n")).toContain("STALE_PROJECTION");
  });

  it("updateEntity 收敛后：stale 清除，报告面不再呈现（往返闭环）", async () => {
    const source1 = writeSkillSource(sandbox.workspace, "beta", "v1\n");
    const created = await ensureEntity({
      scope: "project",
      source: { dir: source1 },
      ...scopeOpts(sandbox),
    });
    expect(created.kind).toBe("ok");
    const root = join(sandbox.workspace, "agents-a", "skills");
    await projectEntity({ scope: "project", name: "beta", roots: [root], ...scopeOpts(sandbox) });
    const source2 = writeSkillSource(sandbox.workspace, "beta", "v2\n");
    writeFileSync(join(source2, "SKILL.md"), "---\nname: beta\ndescription: beta v2\n---\nv2\n");
    await ensureEntity({
      scope: "project",
      source: { dir: source2 },
      replace: { expectedRevision: created.kind === "ok" ? created.entity.revision : "" },
      ...scopeOpts(sandbox),
    });

    // update 收敛（批 4 语义：link 记录 revision 刷新 + stale 清除）
    const source3 = writeSkillSource(sandbox.workspace, "beta", "v3\n");
    writeFileSync(join(source3, "SKILL.md"), "---\nname: beta\ndescription: beta v3\n---\nv3\n");
    const updated = await updateEntity({
      scope: "project",
      name: "beta",
      source: { dir: source3 },
      ...scopeOpts(sandbox),
    });
    expect(updated.kind).toBe("ok");

    const discovered = discoverSkills({
      userDir: sandbox.home,
      workspaceDir: sandbox.workspace,
      stateBases: [sandbox.scopeBase],
      scanDefaultDirs: false,
      customDirs: [root],
    });
    const beta = discovered.skills.find(
      (skill) => skill.name === "beta" || skill.name.endsWith(":beta")
    );
    expect(beta).toBeDefined();
    expect(beta?.stale).toBeUndefined();
    expect(existsSync(join(root, "beta"))).toBe(true);
  });
});
