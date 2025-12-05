import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listCommand } from "../src/cli/commands/list.js";
import { SkillRegistry } from "../src/core/registry.js";
import { applyFilters, parseFilters } from "../src/utils/filters.js";

function createPluginSkill(root: string, skillName: string, description: string): void {
  const skillDir = join(root, "skills", skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n\n# ${skillName}\n`
  );
}

describe("list command with plugin skills", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CCSKI_CLAUDE_PLUGINS_FALLBACK = "true";
    cwd = mkdtempSync(join(tmpdir(), "ccski-list-plugin-"));
    process.chdir(cwd);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    logSpy.mockRestore();
  });

  it("falls back to pluginsRoot/skills when manifest is missing", async () => {
    const userDir = mkdtempSync(join(tmpdir(), "ccski-list-plugin-home-"));
    const fallbackRoot = join(userDir, ".claude", "plugins", "skills", "canvas-design");
    mkdirSync(fallbackRoot, { recursive: true });
    writeFileSync(
      join(fallbackRoot, "SKILL.md"),
      `---\nname: canvas-design\ndescription: fallback plugin\n---\n\n# canvas-design\n`
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: true,
      userDir,
      _: ["list"],
      $0: "ccski",
    } as any);

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("canvas-design");
    expect(output).toMatch(/plugin/i);
  });

  it("falls back to pluginsRoot/skills when manifest paths are missing", async () => {
    const userDir = mkdtempSync(join(tmpdir(), "ccski-list-plugin-home-missing-"));
    const fallbackRoot = join(userDir, ".claude", "plugins", "skills", "canvas-design");
    mkdirSync(fallbackRoot, { recursive: true });
    writeFileSync(
      join(fallbackRoot, "SKILL.md"),
      `---\nname: canvas-design\ndescription: fallback plugin\n---\n\n# canvas-design\n`
    );

    // manifest points to a non-existent installPath
    const pluginsFile = join(userDir, ".claude", "plugins", "installed_plugins.json");
    mkdirSync(join(userDir, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 1,
        plugins: {
          "canvas-design@anthropic-agent-skills": {
            version: "0.1.0",
            installedAt: "2024-01-01T00:00:00Z",
            lastUpdated: "2024-01-02T00:00:00Z",
            installPath: "does/not/exist",
            gitCommitSha: "abc123",
            isLocal: true,
          },
        },
      })
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: true,
      userDir,
      _: ["list"],
      $0: "ccski",
    } as any);

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("canvas-design");
    expect(output.toLowerCase()).toContain("plugin");
  });

  it("shows plugin skills by default", async () => {
    const userDir = cwd;
    const pluginsRoot = join(userDir, ".claude", "plugins", "example");
    createPluginSkill(pluginsRoot, "alpha", "plugin alpha");

    const pluginsFile = join(userDir, ".claude", "plugins", "installed_plugins.json");
    mkdirSync(join(userDir, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 1,
        plugins: {
          "example@anthropic-agent-skills": {
            version: "0.1.0",
            installedAt: "2024-01-01T00:00:00Z",
            lastUpdated: "2024-01-02T00:00:00Z",
            installPath: "example",
            gitCommitSha: "abc123",
            isLocal: true,
          },
        },
      })
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: true,
      userDir,
      _: ["list"],
      $0: "ccski",
    } as any);

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("example:alpha");
    expect(output).toContain("plugin");
  });

  it("shows both plugin and local copies with --all", async () => {
    const userDir = cwd;
    const pluginsRoot = join(userDir, ".claude", "plugins", "example");
    createPluginSkill(pluginsRoot, "shared", "plugin shared");

    const pluginsFile = join(userDir, ".claude", "plugins", "installed_plugins.json");
    mkdirSync(join(userDir, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 1,
        plugins: {
          "example@anthropic-agent-skills": {
            version: "0.1.0",
            installedAt: "2024-01-01T00:00:00Z",
            lastUpdated: "2024-01-02T00:00:00Z",
            installPath: "example",
            gitCommitSha: "abc123",
            isLocal: true,
          },
        },
      })
    );

    // local copy with same name
    const localSkillDir = join(userDir, "local-skills", "shared");
    mkdirSync(localSkillDir, { recursive: true });
    writeFileSync(
      join(localSkillDir, "SKILL.md"),
      `---\nname: shared\ndescription: local\n---\n\n# shared\n`
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: true,
      skillDir: [localSkillDir],
      userDir,
      all: true,
      _: ["list"],
      $0: "ccski",
    } as any);

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("shared"); // base name appears
    // should include plugin entry (provider badge + plugin location)
    expect(output).toMatch(/plugin/i);
    // ensure both copies surfaced (two occurrences of name)
    const occurrences = output.split("shared").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("treats --all as include=all so duplicate plugin copies remain", async () => {
    const userDir = mkdtempSync(join(tmpdir(), "ccski-list-plugin-dup-"));
    const localSkillRoot = join(userDir, "local-skills");
    const localSkillDir = join(localSkillRoot, "shared-plugin");
    mkdirSync(localSkillDir, { recursive: true });
    writeFileSync(
      join(localSkillDir, "SKILL.md"),
      `---\nname: example:alpha\ndescription: local\n---\n\n# shared\n`
    );

    const fallbackRoot = join(userDir, ".claude", "plugins", "skills", "example", "alpha");
    mkdirSync(fallbackRoot, { recursive: true });
    writeFileSync(
      join(fallbackRoot, "SKILL.md"),
      `---\nname: example:alpha\ndescription: plugin copy\n---\n\n# alpha\n`
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: false,
      userDir,
      skillDir: [localSkillRoot],
      all: true,
      _: ["list"],
      $0: "ccski",
    } as any);

    const output = logSpy.mock.calls.flat().join("\n");
    const occurrences = output.split("example:alpha").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(output).toMatch(/plugin/i);
  });

  it("auto-dedups identical names across providers", async () => {
    const userDir = mkdtempSync(join(tmpdir(), "ccski-list-plugin-dedup-"));

    // codex user skill
    const codexSkillDir = join(userDir, ".codex", "skills", "webapp-testing");
    mkdirSync(codexSkillDir, { recursive: true });
    writeFileSync(
      join(codexSkillDir, "SKILL.md"),
      `---\nname: webapp-testing\ndescription: codex copy\n---\n\n# codex\n`
    );
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(codexSkillDir, "SKILL.md"), future, future);

    // fallback plugin skill with same name and dir name
    const pluginSkillDir = join(userDir, ".claude", "plugins", "skills", "webapp-testing", "webapp-testing");
    mkdirSync(pluginSkillDir, { recursive: true });
    writeFileSync(
      join(pluginSkillDir, "SKILL.md"),
      `---\nname: webapp-testing\ndescription: plugin copy\n---\n\n# plugin\n`
    );
    // make plugin older so auto dedup prefers user copy even if mtimes differ
    const past = new Date(0);
    utimesSync(join(pluginSkillDir, "SKILL.md"), past, past);

    const registry = new SkillRegistry({ userDir, scanDefaultDirs: true });
    const providers = registry.getAll().filter((s) => s.name === "webapp-testing").map((s) => s.provider);
    expect(providers).toContain("codex");

    const { includes, excludes } = parseFilters(undefined, undefined);
    const filtered = applyFilters(registry.getAll(), includes, excludes, "enabled");
    const chosen = filtered.find((s) => s.name === "webapp-testing");
    expect(chosen?.provider).toBe("codex");

    await listCommand({
      noColor: true,
      scanDefaultDirs: true,
      userDir,
      _: ["list"],
      $0: "ccski",
    } as any);

    const output = logSpy.mock.calls.flat().join("\n");
    const occurrences = output.split("webapp-testing").length - 1;
    expect(occurrences).toBe(1);
    // auto should prefer non-plugin copy (location priority user over plugin)
    expect(output).not.toMatch(/plugin copy/);
  });
});
