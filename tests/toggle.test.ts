import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import inquirer from "inquirer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disableCommand, enableCommand } from "../src/cli/commands/toggle.js";

function createSkill(root: string, name: string, disabled = false): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: demo\n---\n\n# ${name}\n`);
  if (disabled) {
    renameSync(join(dir, "SKILL.md"), join(dir, ".SKILL.md"));
  }
  return dir;
}

describe("enable/disable commands", () => {
  let cwd: string;
  const originalCwd = process.cwd();
  const originalStdinTTY = process.stdin.isTTY;
  const originalStdoutTTY = process.stdout.isTTY;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "ccski-toggle-"));
    process.chdir(cwd);
    process.exitCode = 0;
    setIsTTY(true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    setIsTTY(originalStdinTTY ?? false, originalStdoutTTY ?? false);
    vi.restoreAllMocks();
  });

  it("disables a named skill", async () => {
    const skillDir = createSkill(cwd, "alpha");

    await disableCommand({
      names: ["alpha"],
      skillDir: [cwd],
      scanDefaultDirs: false,
      _: ["disable", "alpha"],
      $0: "ccski",
    } as any);

    expect(existsSync(join(skillDir, ".SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(false);
  });

  it("enables a disabled skill", async () => {
    const skillDir = createSkill(cwd, "beta", true);

    await enableCommand({
      names: ["beta"],
      skillDir: [cwd],
      scanDefaultDirs: false,
      _: ["enable", "beta"],
      $0: "ccski",
    } as any);

    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, ".SKILL.md"))).toBe(false);
  });

  it("requires force when both SKILL.md and .SKILL.md exist", async () => {
    const skillDir = createSkill(cwd, "gamma");
    writeFileSync(join(skillDir, ".SKILL.md"), "stub");

    await disableCommand({
      names: ["gamma"],
      skillDir: [cwd],
      scanDefaultDirs: false,
      _: ["disable", "gamma"],
      $0: "ccski",
    } as any);

    expect(process.exitCode).toBe(1);
    // unchanged without force
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, ".SKILL.md"))).toBe(true);

    process.exitCode = 0;

    await disableCommand({
      names: ["gamma"],
      skillDir: [cwd],
      scanDefaultDirs: false,
      force: true,
      _: ["disable", "gamma"],
      $0: "ccski",
    } as any);

    expect(existsSync(join(skillDir, ".SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(false);
  });

  it("uses interactive picker when -i is provided", async () => {
    createSkill(cwd, "delta");
    createSkill(cwd, "echo");
    const promptSpy = vi.spyOn(inquirer, "prompt").mockResolvedValue({ picked: ["echo"] });

    await disableCommand({
      interactive: true,
      skillDir: [cwd],
      scanDefaultDirs: false,
      _: ["disable"],
      $0: "ccski",
    } as any);

    expect(promptSpy).toHaveBeenCalled();
    expect(existsSync(join(cwd, "echo", ".SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, "delta", "SKILL.md"))).toBe(true);
  });
});

function setIsTTY(stdinValue: boolean, stdoutValue?: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value: stdinValue,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: stdoutValue ?? stdinValue,
    configurable: true,
  });
}
