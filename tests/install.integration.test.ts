import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installCommand } from "../src/cli/commands/install.js";
import { promptMultiSelect } from "../src/cli/prompts/multiSelect.js";

vi.mock("../src/cli/prompts/multiSelect.js", () => ({
  promptMultiSelect: vi.fn(),
}));

function createSkill(root: string, name: string, desc = "demo"): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`
  );
  return dir;
}

function createRepoWithMarketplace(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "ccski-install-repo-"));
  const skillsRoot = repoRoot;

  const alg = createSkill(skillsRoot, "algorithmic-art", "algo art");
  const canvas = createSkill(skillsRoot, "canvas-design", "canvas");

  const pluginDir = join(repoRoot, ".claude-plugin");
  mkdirSync(pluginDir, { recursive: true });
  const marketplace = {
    name: "test-market",
    owner: { name: "tester", email: "tester@example.com" },
    plugins: [
      {
        name: "example-skills",
        description: "example",
        source: "./",
        strict: false,
        skills: ["./algorithmic-art", "./canvas-design"],
      },
    ],
  };
  writeFileSync(join(pluginDir, "marketplace.json"), JSON.stringify(marketplace, null, 2));

  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });

  // expose path ending with .git so clone path triggers
  const gitPath = `${repoRoot}.git`;
  execSync(`cp -R ${repoRoot} ${gitPath}`);
  return gitPath;
}

function createRepoWithPluginScopedSkills(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "ccski-plugin-scope-"));

  const pluginRoot = join(repoRoot, "plugins", "backend-development");
  const skillDir = createSkill(join(pluginRoot, "skills"), "api-design-principles", "api design");

  const marketplaceDir = join(repoRoot, ".claude-plugin");
  mkdirSync(marketplaceDir, { recursive: true });
  const marketplace = {
    name: "test-market",
    owner: { name: "tester", email: "tester@example.com" },
    plugins: [
      {
        name: "backend-development",
        description: "backend",
        source: "./plugins/backend-development",
        strict: false,
        skills: ["./skills/api-design-principles"],
      },
    ],
  };
  writeFileSync(join(marketplaceDir, "marketplace.json"), JSON.stringify(marketplace, null, 2));

  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });

  // expose path ending with .git so clone path triggers if desired
  const gitPath = `${repoRoot}.git`;
  execSync(`cp -R ${repoRoot} ${gitPath}`);
  return gitPath.replace(/\.git$/, "");
}

function listInstalled(root: string): string[] {
  try {
    return execSync("ls", { cwd: root }).toString().trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

describe("installCommand end-to-end", () => {
  let cwd: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "ccski-install-cwd-"));
    process.chdir(cwd);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
    process.chdir(originalCwd);
    vi.mocked(promptMultiSelect).mockReset();
  });

  it("installs all skills via marketplace from repo root", async () => {
    const repo = createRepoWithMarketplace();

    await installCommand({
      source: `file://${repo}`,
      global: false,
      force: false,
      override: false,
      all: true,
      _: [`file://${repo}`],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed.sort()).toEqual(["algorithmic-art", "canvas-design"]);
  });

  it("resolves marketplace skills relative to plugin source directories", async () => {
    const repo = createRepoWithPluginScopedSkills();

    await installCommand({
      source: `file://${repo}`,
      global: false,
      force: false,
      override: false,
      all: true,
      _: [`file://${repo}`],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed).toEqual(["api-design-principles"]);
  });

  it("installs single skill from SKILL.md file path", async () => {
    const repo = createRepoWithMarketplace().replace(/\.git$/, "");
    const skillFile = join(repo, "algorithmic-art", "SKILL.md");

    await installCommand({
      source: `file://${skillFile}`,
      global: false,
      force: false,
      override: false,
      _: [],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed).toEqual(["algorithmic-art"]);
  });

  it("installs skill from directory path", async () => {
    const repo = createRepoWithMarketplace().replace(/\.git$/, "");
    const skillDir = join(repo, "canvas-design");

    await installCommand({
      source: `file://${skillDir}/`,
      global: false,
      force: false,
      override: false,
      _: [],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed).toEqual(["canvas-design"]);
  });

  it("installs via marketplace.json path", async () => {
    const repo = createRepoWithMarketplace().replace(/\.git$/, "");
    const marketplacePath = join(repo, ".claude-plugin", "marketplace.json");

    await installCommand({
      source: `file://${marketplacePath}`,
      global: false,
      force: false,
      override: false,
      all: true,
      _: [],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed.sort()).toEqual(["algorithmic-art", "canvas-design"]);
  });

  it("requires selection when multiple skills and no flag", async () => {
    const repo = createRepoWithMarketplace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await installCommand({
      source: `file://${repo}`,
      global: false,
      force: false,
      override: false,
      _: [],
      $0: "ccski",
    } as any);

    expect(process.exitCode).toBe(1);
    const combinedLogs = logSpy.mock.calls.flat().join(" ");
    expect(combinedLogs).toMatch(/Multiple skills found/);
    expect(combinedLogs).toMatch(/algorithmic-art/);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    process.exitCode = 0;
  });

  it("installs selected subset by name", async () => {
    const repo = createRepoWithMarketplace();

    await installCommand({
      source: `file://${repo}`,
      global: false,
      force: false,
      override: false,
      _: [`file://${repo}`, "canvas"],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed).toEqual(["canvas-design"]);
  });

  it("suggests on typo", async () => {
    const repo = createRepoWithMarketplace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await installCommand({
      source: `file://${repo}`,
      global: false,
      force: false,
      override: false,
      _: [`file://${repo}`, "algorthmic-art"],
      $0: "ccski",
    } as any);

    const message = errorSpy.mock.calls.flat().join(" ");
    expect(process.exitCode).toBe(1);
    expect(message).toMatch(/Did you mean: algorithmic-art/);

    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("respects interactive selection instead of installing all", async () => {
    const repo = createRepoWithMarketplace();
    vi.mocked(promptMultiSelect).mockResolvedValueOnce(["canvas-design"]);
    const originalStdinTTY = process.stdin.isTTY;
    const originalStdoutTTY = process.stdout.isTTY;
    setIsTTY(true);

    await installCommand({
      source: `file://${repo}`,
      interactive: true,
      global: false,
      force: false,
      override: false,
      _: [`file://${repo}`],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed).toEqual(["canvas-design"]);

    setIsTTY(originalStdinTTY ?? false, originalStdoutTTY ?? false);
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
