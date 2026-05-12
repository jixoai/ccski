import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getCcskiWorkflowBlock,
  installCcskiWorkflow,
  resolveAgentInstructionTarget,
} from "../src/api/index.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("installCcskiWorkflow", () => {
  it("installs all known user-scope instruction files by default", () => {
    const userDir = tempDir("ccski-workflow-user-");

    const result = installCcskiWorkflow({ userDir });

    expect(result.scope).toBe("user");
    expect(result.installed).toBe(4);
    expect(result.failed).toBe(0);
    expect(readFileSync(join(userDir, ".codex", "AGENTS.md"), "utf8")).toContain(
      '<workflow name="ccski">'
    );
    expect(readFileSync(join(userDir, ".claude", "CLAUDE.md"), "utf8")).toContain(
      "bunx ccski info <name>"
    );
    expect(readFileSync(join(userDir, ".gemini", "GEMINI.md"), "utf8")).toContain(
      "installed_plugins.json"
    );
  });

  it("installs selected project-scope instruction files", () => {
    const projectDir = tempDir("ccski-workflow-project-");

    const result = installCcskiWorkflow({
      projectDir,
      scope: "project",
      agents: ["gemini"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      agent: "gemini",
      scope: "project",
      status: "installed",
      path: join(projectDir, "GEMINI.md"),
    });
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
  });

  it("updates an existing ccski workflow block idempotently", () => {
    const userDir = tempDir("ccski-workflow-update-");
    const targetFile = join(userDir, ".codex", "AGENTS.md");
    mkdirSync(join(userDir, ".codex"), { recursive: true });
    writeFileSync(
      targetFile,
      `# Existing\n\n<workflow name="ccski">\nold text\n</workflow>\n\nKeep this.\n`
    );

    const first = installCcskiWorkflow({ userDir, agents: ["codex"] });
    const second = installCcskiWorkflow({ userDir, agents: ["codex"] });
    const content = readFileSync(targetFile, "utf8");

    expect(first.results[0]?.status).toBe("updated");
    expect(second.results[0]?.status).toBe("unchanged");
    expect(content.match(/<workflow name="ccski">/g)).toHaveLength(1);
    expect(content).toContain("# Existing");
    expect(content).toContain("Keep this.");
    expect(content).toContain(getCcskiWorkflowBlock());
  });

  it("supports aliases and rejects unknown targets", () => {
    expect(resolveAgentInstructionTarget("claude")).toMatchObject({ id: "claude-code" });
    expect(resolveAgentInstructionTarget("open-code")).toMatchObject({ id: "opencode" });
    expect(() => installCcskiWorkflow({ agents: ["missing-agent"] })).toThrow(
      /Unknown agent target/
    );
  });
});
