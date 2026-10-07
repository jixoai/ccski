/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「P1-7 前半——MCP 基础 transport probe：真实 stdio
 * 启动一次 tools/list + 一个工具调用，断言不泄 frontmatter 正文/token」（codex 3.0
 * 残留审计 P0-1/P1-7 最小真实收据；完整 e2e 另批）
 * 正交意图：
 *   [1] 真实 transport：spawn 真实 CLI（tsx 拉起 src/cli.ts mcp --transport stdio，
 *       隔离 HOME + skill-dir），JSON-RPC 握手 initialize → tools/list → tools/call
 *   [2] 可见性断言：tools/list 投影只有 name/description/provider/location（正文与
 *       frontmatter 自定义字段不出现）；tools/call = 显式读取面（正文在场）但原始
 *       frontmatter（含自定义 token 字段）被剥离
 * 妥协声明：stdio 帧为 newline-delimited JSON（MCP SDK StdioServerTransport 语义）；
 * 断言基于完整响应文本的 contains/absent 检查（字段级 schema 断言归完整 e2e 批）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsxEntry = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

const SECRET_TOKEN = "super-secret-token-7f3a";
const BODY_MARKER = "PROBE-BODY-MARKER-XYZ-unique";

interface JsonRpcResponse {
  id?: number;
  error?: unknown;
  result?: { content?: Array<{ type: string; text?: string }> };
}

async function probeSkillTool(
  skillDir: string,
  home: string
): Promise<{ listText: string; callText: string; stderrTail: string }> {
  const child = spawn(
    process.execPath,
    [
      tsxEntry,
      cliEntry,
      "mcp",
      "--transport",
      "stdio",
      "--no-refresh",
      "--user-dir",
      home,
      "--no-scan-default-dirs",
      "--skill-dir",
      skillDir,
    ],
    { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"] }
  );

  let buffer = "";
  const responses = new Map<number, JsonRpcResponse>();
  const waiters = new Map<number, (response: JsonRpcResponse) => void>();
  let stderrTail = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (typeof parsed.id === "number") {
            responses.set(parsed.id, parsed);
            const waiter = waiters.get(parsed.id);
            if (waiter !== undefined) {
              waiters.delete(parsed.id);
              waiter(parsed);
            }
          }
        } catch {
          // 非 JSON 行（不应出现；忽略）
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-2000);
  });

  const send = (message: Record<string, unknown>): void => {
    child.stdin?.write(`${JSON.stringify(message)}\n`);
  };
  const request = (id: number, method: string, params?: Record<string, unknown>): Promise<void> =>
    new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(
        () => rejectPromise(new Error(`probe timeout on id ${id}; stderr: ${stderrTail}`)),
        60000
      );
      waiters.set(id, (response) => {
        clearTimeout(timer);
        responses.set(id, response);
        resolvePromise();
      });
      send({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    });

  try {
    await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ccski-visibility-probe", version: "0.0.0" },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await request(2, "tools/list");
    await request(3, "tools/call", { name: "skill", arguments: { name: "probe-skill" } });
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      if (child.exitCode !== null) return resolvePromise();
      child.once("exit", () => resolvePromise());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise();
      }, 5000);
    });
  }

  const listResponse = responses.get(2);
  const callResponse = responses.get(3);
  if (listResponse === undefined || callResponse === undefined) {
    throw new Error(`probe responses missing; stderr: ${stderrTail}`);
  }
  if (callResponse.error !== undefined) {
    throw new Error(`tools/call failed: ${JSON.stringify(callResponse.error)}; stderr: ${stderrTail}`);
  }
  const callText =
    callResponse.result?.content?.find((part) => part.type === "text")?.text ?? "";
  if (callText.length === 0) {
    throw new Error(`tools/call text missing; stderr: ${stderrTail}`);
  }
  return { listText: JSON.stringify(listResponse), callText, stderrTail };
}

describe("MCP stdio 真实 transport probe（P1-7 前半）", () => {
  let home: string;
  let skillDir: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ccski-mcp-home-"));
    skillDir = mkdtempSync(join(tmpdir(), "ccski-mcp-skills-"));
    mkdirSync(skillDir, { recursive: true });
    const skill = join(skillDir, "probe-skill");
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      join(skill, "SKILL.md"),
      [
        "---",
        "name: probe-skill",
        "description: MCP visibility probe fixture",
        `internalToken: ${SECRET_TOKEN}`,
        "---",
        "",
        "# Probe Skill",
        "",
        `Instructions line with ${BODY_MARKER}.`,
        "",
      ].join("\n")
    );
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
  });

  it(
    "tools/list 不泄正文与 frontmatter；tools/call 给正文但不泄原始 frontmatter/token",
    async () => {
      const { listText, callText } = await probeSkillTool(skillDir, home);

      // tools/list = 投影面：name/description 在场；正文与 frontmatter 自定义字段不在场
      expect(listText).toContain("probe-skill");
      expect(listText).toContain("MCP visibility probe fixture");
      expect(listText).not.toContain(BODY_MARKER);
      expect(listText).not.toContain(SECRET_TOKEN);
      expect(listText).not.toContain("internalToken");

      // tools/call = 显式读取面：正文在场；原始 frontmatter（自定义 token 字段）被剥离
      expect(callText).toContain(BODY_MARKER);
      expect(callText).toContain("# Probe Skill");
      expect(callText).toContain("name: other:probe-skill"); // 领域头（formatSkillContent header）
      expect(callText).not.toContain(SECRET_TOKEN);
      expect(callText).not.toContain("internalToken");
      expect(callText).not.toContain("description: MCP visibility probe fixture");
    },
    120000
  );
});
