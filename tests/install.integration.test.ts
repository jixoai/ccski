import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installCommand } from "../src/cli/commands/install.js";

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
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("installs all skills via marketplace from repo root", async () => {
    const repo = createRepoWithMarketplace();

    await installCommand({
      source: `file://${repo}`,
      global: false,
      force: false,
      override: false,
      _: [],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed.sort()).toEqual(["algorithmic-art", "canvas-design"]);
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
      _: [],
      $0: "ccski",
    } as any);

    const installed = listInstalled(join(cwd, ".claude/skills"));
    expect(installed.sort()).toEqual(["algorithmic-art", "canvas-design"]);
  });
});

