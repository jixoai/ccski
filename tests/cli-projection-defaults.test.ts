/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「CLI 投影默认全集测试对齐 g0 钉值（registry 过滤/退化
 * 分支/部分成功/失败条目）」（G5 门收据行；g0/parity-npm-skills-receipt.md）
 * 正交意图：
 *   [1] 注册表分支钉值（receipt §0 语义镜像）：detected+universal（ensureUniversal-
 *       Agents）/ showInUniversalList 过滤（replit 不自动入集、检测后入集且归
 *       canonical）/ no-detection --yes registry 全集退化 / 无检测无 --yes typed 拒绝 /
 *       '*' 全集 / 未知 id typed 拒绝
 *   [2] per-agent 部分成功收据（receipt p1/p4）：无 global 能力 agent（promptscript/
 *       eve）= typed 失败条目而非静默跳过；claude-code 等独立根 = link 投影；
 *       universal-class = entity-local（canonical 共享，receipt p1 universal 行钉值）
 *   [3] CLI 安装面：--json 全量收据（npm 式「JSON 只报失败」不照抄）+ exit 1 on
 *       failed + --dry-run 零写入 + NAME_EXISTS/--force 显式 replace
 * 妥协声明：检测探针全部经 userDir/cwd 注入（hermetic）；「真 no-detection 在本机
 * 不可构造」的 receipt 边界以注入空 home 等价构造（分支语义同一）。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_REGISTRY,
  AgentTargetError,
  detectInstalledAgents,
  ensureUniversalAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  resolveAgentTargets,
} from "../src/cli/agents.js";
import { installCommand } from "../src/cli/commands/install.js";
import {
  cleanupSandbox,
  makeSandbox,
  readState,
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

function lastJson<T>(logs: string[]): T {
  return JSON.parse(logs.join("\n")) as T;
}

describe("agent 注册表语义（receipt §0 钉值镜像）", () => {
  it("universal 集：agents+promptscript 入集；replit/universal 被 showInUniversalList 过滤", () => {
    const universal = getUniversalAgents().map((entry) => entry.id);
    expect(universal).toContain("agents");
    expect(universal).toContain("promptscript");
    expect(universal).not.toContain("replit");
    expect(universal).not.toContain("universal");
    // 交互可见集再排除 showInUniversalPrompt:false（promptscript 隐藏）
    expect(getVisibleUniversalAgents().map((entry) => entry.id)).not.toContain("promptscript");
  });

  it("检测：home 探针命中；universal 键恒不检测（receipt：仅显式指定）", () => {
    const sandbox = makeSandbox("agents-detect", "global");
    try {
      mkdirSync(join(sandbox.home, ".claude"), { recursive: true });
      const detected = detectInstalledAgents({ userDir: sandbox.home, cwd: sandbox.workspace });
      expect(detected.map((entry) => entry.id)).toContain("claude-code");
      expect(detected.map((entry) => entry.id)).not.toContain("universal");
      // cwd 标记检测（receipt p3：.replit）
      mkdirSync(join(sandbox.workspace, ".replit"), { recursive: true });
      const withReplit = detectInstalledAgents({ userDir: sandbox.home, cwd: sandbox.workspace });
      expect(withReplit.map((entry) => entry.id)).toContain("replit");
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it("ensureUniversalAgents：detected ∪ universal，registry 序去重", () => {
    const sandbox = makeSandbox("agents-ensure", "global");
    try {
      mkdirSync(join(sandbox.home, ".claude"), { recursive: true });
      const detected = detectInstalledAgents({ userDir: sandbox.home, cwd: sandbox.workspace });
      const merged = ensureUniversalAgents(detected).map((entry) => entry.id);
      expect(merged).toContain("claude-code");
      expect(merged).toContain("agents");
      expect(merged).toContain("promptscript");
      expect(merged).not.toContain("replit");
      expect(new Set(merged).size).toBe(merged.length);
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it("分支：显式 / '*' 全集 / registry 退化 / 无检测无 --yes typed 拒绝", () => {
    const sandbox = makeSandbox("agents-branch", "global");
    try {
      // 显式集合
      const explicit = resolveAgentTargets({
        scope: "global",
        agents: ["claude-code", "claude-code"],
        userDir: sandbox.home,
        cwd: sandbox.workspace,
      });
      expect(explicit.branch).toBe("explicit");
      expect(explicit.targets.map((t) => t.id)).toEqual(["claude-code"]);

      // '*' = 全 registry 键（receipt p2b 等价构造）
      const all = resolveAgentTargets({
        scope: "global",
        agents: ["*"],
        userDir: sandbox.home,
        cwd: sandbox.workspace,
      });
      expect(all.branch).toBe("registry-all");
      expect(all.targets.map((t) => t.id)).toEqual(AGENT_REGISTRY.map((entry) => entry.id));

      // 无检测 + --yes = registry 全集退化（branch 收据如实标注）
      const fallback = resolveAgentTargets({
        scope: "global",
        yes: true,
        userDir: sandbox.home,
        cwd: sandbox.workspace,
      });
      expect(fallback.branch).toBe("registry-fallback");
      expect(fallback.detected).toEqual([]);
      expect(fallback.targets.map((t) => t.id)).toEqual(AGENT_REGISTRY.map((entry) => entry.id));

      // 无检测 + 无 --yes → typed 拒绝
      expect(() =>
        resolveAgentTargets({ scope: "global", userDir: sandbox.home, cwd: sandbox.workspace })
      ).toThrow(AgentTargetError);
      try {
        resolveAgentTargets({ scope: "global", userDir: sandbox.home, cwd: sandbox.workspace });
      } catch (error) {
        expect((error as AgentTargetError).code).toBe("TARGET_SET_REQUIRED");
      }

      // 未知 id → typed 拒绝 + 合法集
      try {
        resolveAgentTargets({
          scope: "global",
          agents: ["not-an-agent"],
          userDir: sandbox.home,
          cwd: sandbox.workspace,
        });
        throw new Error("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AgentTargetError);
        expect((error as AgentTargetError).code).toBe("AGENT_UNKNOWN");
        expect((error as AgentTargetError).message).toContain("not-an-agent");
      }
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it("showInUniversalList 过滤语义（receipt p3）：replit 未检测不入集；检测后入集且归 canonical", () => {
    const sandbox = makeSandbox("agents-replit", "global");
    try {
      mkdirSync(join(sandbox.home, ".claude"), { recursive: true });
      const withoutReplit = resolveAgentTargets({
        scope: "global",
        userDir: sandbox.home,
        cwd: sandbox.workspace,
      });
      expect(withoutReplit.branch).toBe("detected-plus-universal");
      expect(withoutReplit.targets.map((t) => t.id)).not.toContain("replit");

      // cwd 放 .replit → replit 入目标集，universal-class → canonical 根（entity-local 形态）
      mkdirSync(join(sandbox.workspace, ".replit"), { recursive: true });
      const withReplit = resolveAgentTargets({
        scope: "global",
        userDir: sandbox.home,
        cwd: sandbox.workspace,
      });
      const replit = withReplit.targets.find((t) => t.id === "replit");
      expect(replit).toBeDefined();
      expect(replit?.universalClass).toBe(true);
      expect(replit?.root).toBe(join(sandbox.home, ".agents", "skills"));
    } finally {
      cleanupSandbox(sandbox);
    }
  });

  it("无 global 安装能力（globalSkillsDir undefined）→ canInstallGlobal=false（global 失败条目；project 可投影）", () => {
    const sandbox = makeSandbox("agents-cap", "global");
    try {
      const globalTargets = resolveAgentTargets({
        scope: "global",
        yes: true,
        userDir: sandbox.home,
        cwd: sandbox.workspace,
      });
      const promptscript = globalTargets.targets.find((t) => t.id === "promptscript");
      const eve = globalTargets.targets.find((t) => t.id === "eve");
      expect(promptscript?.canInstallGlobal).toBe(false);
      expect(promptscript?.root).toBeNull();
      expect(eve?.canInstallGlobal).toBe(false);

      const projectTargets = resolveAgentTargets({
        scope: "project",
        yes: true,
        userDir: sandbox.home,
        cwd: sandbox.workspace,
        workspaceDir: sandbox.workspace,
      });
      const promptscriptProject = projectTargets.targets.find((t) => t.id === "promptscript");
      expect(promptscriptProject?.root).toBe(join(sandbox.workspace, ".agents", "skills"));
    } finally {
      cleanupSandbox(sandbox);
    }
  });
});

describe("install 命令（内核面 + 默认投影全集）", () => {
  let sandbox: Sandbox;
  const originalCwd = process.cwd();

  beforeEach(() => {
    sandbox = makeSandbox("cli-install", "project");
    process.chdir(sandbox.workspace);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    vi.restoreAllMocks();
    cleanupSandbox(sandbox);
  });

  it("global：detected+universal 分支（receipt p1 形态）——claude link + agents entity-local + promptscript 失败条目", async () => {
    const source = writeSkillSource(sandbox.workspace, "alpha", "v1\n");
    mkdirSync(join(sandbox.home, ".claude"), { recursive: true });

    const { logs, spy } = capture();
    await installCommand({
      source,
      global: true,
      yes: true,
      json: true,
      userDir: sandbox.home,
      _: ["install", source],
      $0: "ccski",
    } as never);
    spy.mockRestore();

    const payload = lastJson<{
      branch: string;
      detected: string[];
      targets: Array<{
        agent: string;
        status: string;
        mode?: string;
        errorCode?: string;
        error?: string;
      }>;
      failed: number;
      lockSyncPending: boolean;
      entity: { logicalName: string };
    }>(logs);
    expect(payload.branch).toBe("detected-plus-universal");
    expect(payload.detected).toContain("claude-code");
    const byAgent = new Map(payload.targets.map((t) => [t.agent, t]));
    // receipt p1：detected → symlink 投影
    expect(byAgent.get("claude-code")).toMatchObject({ status: "projected", mode: "link" });
    expect(lstatSync(join(sandbox.home, ".claude", "skills", "alpha")).isSymbolicLink()).toBe(true);
    // receipt p1：universal 行共享 canonical（entity-local，无独立目录）
    expect(byAgent.get("agents")).toMatchObject({ status: "entity-local", mode: "entity-local" });
    // receipt p1/p4：无 global 能力 → typed 失败条目
    expect(byAgent.get("promptscript")).toMatchObject({
      status: "failed",
      errorCode: "NO_GLOBAL_INSTALL",
    });
    expect(byAgent.get("promptscript")?.error).toContain(
      "does not support global skill installation"
    );
    expect(payload.failed).toBe(1);
    expect(payload.lockSyncPending).toBe(true);
    expect(process.exitCode).toBe(1); // 部分成功 = 常态，失败条目 exit 1
    // 实体在 global 实体根；npm lock 永不创建
    expect(existsSync(join(sandbox.home, ".agents", "skills", "alpha", "SKILL.md"))).toBe(true);
    expect(existsSync(join(sandbox.home, ".agents", ".skill-lock.json"))).toBe(false);
  });

  it("project：无检测 + --yes registry 退化（receipt p2b 形态）——独立根 links + canonical + 失败条目不适用", async () => {
    const source = writeSkillSource(sandbox.workspace, "beta", "v1\n");
    const { logs, spy } = capture();
    await installCommand({
      source,
      yes: true,
      json: true,
      userDir: sandbox.home,
      _: ["install", source],
      $0: "ccski",
    } as never);
    spy.mockRestore();

    const payload = lastJson<{
      branch: string;
      targets: Array<{ agent: string; status: string; mode?: string }>;
    }>(logs);
    expect(payload.branch).toBe("registry-fallback");
    const byAgent = new Map(payload.targets.map((t) => [t.agent, t]));
    expect(byAgent.get("claude-code")).toMatchObject({ status: "projected" });
    expect(lstatSync(join(sandbox.workspace, ".claude", "skills", "beta")).isSymbolicLink()).toBe(
      true
    );
    expect(byAgent.get("zcode")).toMatchObject({ status: "projected" });
    expect(byAgent.get("agents")).toMatchObject({ status: "entity-local" });
    // project scope 无「global 能力」概念：promptscript/eve 正常投影（canonical/独立根）
    expect(byAgent.get("promptscript")?.status).toBe("entity-local");
    expect(byAgent.get("eve")).toMatchObject({ status: "projected" });
    expect(process.exitCode).toBe(0);
    // 实体 + state 记账
    expect(existsSync(join(sandbox.workspace, ".agents", "skills", "beta", "SKILL.md"))).toBe(true);
    const state = readState(sandbox.scopeBase);
    expect(Object.keys(state.entities)).toContain("beta");
  });

  it("无检测无 --yes → TARGET_SET_REQUIRED typed 错误（非交互不猜测）", async () => {
    const source = writeSkillSource(sandbox.workspace, "gamma", "v1\n");
    const { logs, spy } = capture();
    await installCommand({
      source,
      json: true,
      userDir: sandbox.home,
      _: ["install", source],
      $0: "ccski",
    } as never);
    spy.mockRestore();
    expect(process.exitCode).toBe(1);
    const payload = lastJson<{ kind: string; code: string }>(logs);
    expect(payload).toMatchObject({ kind: "error", code: "TARGET_SET_REQUIRED" });
    // 零副作用：无实体目录、无 state
    expect(existsSync(join(sandbox.workspace, ".agents"))).toBe(false);
  });

  it("--dry-run 零写入：计划收据 + 磁盘/state 缺席", async () => {
    const source = writeSkillSource(sandbox.workspace, "delta", "v1\n");
    mkdirSync(join(sandbox.home, ".claude"), { recursive: true });
    const { logs, spy } = capture();
    await installCommand({
      source,
      global: true,
      yes: true,
      dryRun: true,
      json: true,
      userDir: sandbox.home,
      _: ["install", source],
      $0: "ccski",
    } as never);
    spy.mockRestore();
    const payload = lastJson<{ dryRun: boolean; targets: Array<{ status: string }> }>(logs);
    expect(payload.dryRun).toBe(true);
    expect(payload.targets.length).toBeGreaterThan(0);
    // 零写入
    expect(existsSync(join(sandbox.home, ".agents"))).toBe(false);
    expect(existsSync(join(sandbox.home, ".claude", "skills"))).toBe(false);
  });

  it("NAME_EXISTS → 无 --force typed 失败；--force 显式 replace（expectedRevision 由错误载荷取）", async () => {
    const source1 = writeSkillSource(sandbox.workspace, "eps", "v1\n");
    mkdirSync(join(sandbox.home, ".claude"), { recursive: true });
    const first = capture();
    await installCommand({
      source: source1,
      global: true,
      agent: ["claude-code"],
      json: true,
      userDir: sandbox.home,
      _: ["install", source1],
      $0: "ccski",
    } as never);
    first.spy.mockRestore();

    // 异源同名 → NAME_EXISTS（source2 的 frontmatter name 改写为 eps：同名异源）
    const source2 = writeSkillSource(sandbox.workspace, "eps2", "v2\n");
    writeFileSync(
      join(source2, "SKILL.md"),
      "---\nname: eps\ndescription: eps v2 from another source\n---\nv2\n"
    );
    const second = capture();
    await installCommand({
      source: source2,
      global: true,
      agent: ["claude-code"],
      json: true,
      userDir: sandbox.home,
      _: ["install", source2],
      $0: "ccski",
    } as never);
    second.spy.mockRestore();
    expect(process.exitCode).toBe(1);
    expect(lastJson<{ code: string }>(second.logs).code).toBe("NAME_EXISTS");
    // 实体内容未被静默覆盖
    expect(
      readFileSync(join(sandbox.home, ".agents", "skills", "eps", "SKILL.md"), "utf8")
    ).toContain("v1");

    // --force → 显式 replace（换新成功 + 投影记录 stale 标注）
    process.exitCode = 0;
    const third = capture();
    await installCommand({
      source: source2,
      global: true,
      agent: ["claude-code"],
      force: true,
      json: true,
      userDir: sandbox.home,
      _: ["install", source2],
      $0: "ccski",
    } as never);
    third.spy.mockRestore();
    const replaced = lastJson<{
      entity: { status: string };
      targets: Array<{ agent: string; status: string }>;
    }>(third.logs);
    expect(replaced.entity.status).toBe("replaced");
    expect(replaced.targets[0]?.status).toBe("unchanged");
    expect(process.exitCode).toBe(0);
    expect(
      readFileSync(join(sandbox.home, ".agents", "skills", "eps", "SKILL.md"), "utf8")
    ).toContain("v2");
    // R8：link 投影记录 stale 标注（批 5 报告面的 state 侧事实源）
    const state = readState(join(sandbox.home, ".agents"));
    const projection = Object.values(state.projections).find((r) => r["folderName"] === "eps");
    expect(projection?.["stale"]).toBe(true);
  });
});
