import { mkdtempSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { discoverSkills } from "../src/core/discovery.js";
import { SkillRegistry } from "../src/core/registry.js";
import { applyFilters, parseFilters } from "../src/utils/filters.js";

function createSkill(root: string, folder: string, name: string | undefined = undefined, description = "Test skill"): string {
  const skillDir = join(root, folder);
  mkdirSync(skillDir, { recursive: true });
  const skillName = name ?? folder;

  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: ${description}\n---\nContent\n`
  );

  return skillDir;
}

describe("discoverSkills", () => {
  it("collects all skills and records conflicts for duplicates", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-discovery-"));
    const highDir = join(root, "high");
    const lowDir = join(root, "low");

    createSkill(highDir, "shared", "shared-skill", "High priority skill");
    createSkill(lowDir, "shared", "shared-skill", "Low priority skill");

    const result = discoverSkills({ customDirs: [highDir, lowDir], scanDefaultDirs: false });

    // Discovery collects all skills (dedup happens in applyFilters)
    expect(result.skills).toHaveLength(2);
    expect(result.diagnostics.conflicts.some((c) => c.includes("other:shared-skill"))).toBe(true);
  });

  it("finds skills recursively in nested directories", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-recursive-"));
    createSkill(join(root, "nested", "inner"), "deep-skill");

    const result = discoverSkills({ customDirs: [root], scanDefaultDirs: false });

    expect(result.skills.map((skill) => skill.name)).toContain("other:deep-skill");
  });

  it("only includes disabled skills when explicitly requested", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-disabled-"));
    const skillDir = createSkill(root, "disabled-demo");

    // rename to .SKILL.md to simulate disabled
    renameSync(join(skillDir, "SKILL.md"), join(skillDir, ".SKILL.md"));

    const defaultResult = discoverSkills({ customDirs: [root], scanDefaultDirs: false });
    expect(defaultResult.skills).toHaveLength(0);

    const withDisabled = discoverSkills({
      customDirs: [root],
      scanDefaultDirs: false,
      includeDisabled: true,
    });
    expect(withDisabled.skills).toHaveLength(1);
    expect(withDisabled.skills[0]?.disabled).toBe(true);
  });

  it("marks codex project skills with provider and project location", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-codex-"));
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      const codexRoot = join(root, ".codex/skills");
      createSkill(codexRoot, "pdf", "pdf", "Codex skill");

      const result = discoverSkills({
        customDirs: [".codex/skills"],
        customProvider: "codex",
        scanDefaultDirs: false,
      });

      expect(result.skills).toHaveLength(1);
      const skill = result.skills[0]!;
      expect(skill.provider).toBe("codex");
      expect(skill.location).toBe("project");
      expect(result.diagnostics.byProvider.codex).toBe(1);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("uses userDir to resolve default user roots", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "ccski-userdir-"));
    const userSkillDir = join(fakeHome, ".claude/skills/alpha");
    mkdirSync(userSkillDir, { recursive: true });
    writeFileSync(
      join(userSkillDir, "SKILL.md"),
      `---\nname: alpha\ndescription: alpha user\n---\n\n# alpha\n`
    );

    const result = discoverSkills({ userDir: fakeHome });
    expect(result.skills.find((s) => s.name === "alpha")).toBeDefined();
    expect(result.skills.find((s) => s.name === "alpha")?.location).toBe("user");
    expect(result.diagnostics.scannedDirectories.some((d) => d.startsWith(join(fakeHome, ".claude/skills")))).toBe(true);
  });

  it("prefixes skills from --skill-dir with default scope 'other'", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-skilldir-scope-"));
    const skillDir = createSkill(root, "custom", "alpha", "Custom skill");

    const registry = discoverSkills({
      customDirs: [{ path: root, scope: "other" }],
      customProvider: "file",
      scanDefaultDirs: false,
    });

    const skill = registry.skills.find((s) => s.path === skillDir);
    expect(skill?.name).toBe("other:alpha");
  });
});

describe("SkillRegistry", () => {
  it("resolves provider-prefixed names to specific skills", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-registry-"));
    const userRoot = join(root, "user-skills");
    createSkill(userRoot, "pdf", "pdf", "User pdf skill");

    const pluginRoot = join(root, "plugins", "example-skills");
    createSkill(pluginRoot, "pdf", "pdf", "Plugin pdf skill");

    const pluginsFile = join(root, "installed_plugins.json");
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 1,
        plugins: {
          "example-skills@anthropic-agent-skills": {
            version: "0.1.0",
            installedAt: "2024-01-01T00:00:00Z",
            lastUpdated: "2024-01-02T00:00:00Z",
            installPath: "plugins/example-skills",
            gitCommitSha: "abc123",
            isLocal: false,
          },
        },
      })
    );

    const registry = new SkillRegistry({
      customDirs: [userRoot],
      scanDefaultDirs: false,
      pluginsFile,
      pluginsRoot: root,
    });

    // With multiple skills of the same base name, provider-prefix resolves correctly
    const userSkill = registry.find("file:pdf");
    expect(userSkill.location).not.toBe("plugin");
    expect(userSkill.path).toContain(join("user-skills", "pdf"));

    const pluginSkill = registry.find("example-skills:pdf");
    expect(pluginSkill.location).toBe("plugin");
    expect(pluginSkill.path).toContain(join("plugins", "example-skills", "pdf"));
  });

  it("keeps plugin skills with duplicate names so filters can surface them", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-registry-dup-"));
    const userRoot = join(root, "user-skills");
    // User skill shares the same full name as plugin skill will have
    createSkill(userRoot, "user", "example:skill", "User copy");

    const pluginsFile = join(root, "installed_plugins.json");
    const pluginInstallPath = "plugins/example";
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 1,
        plugins: {
          "example@anthropic-agent-skills": {
            version: "0.1.0",
            installedAt: "2024-01-01T00:00:00Z",
            lastUpdated: "2024-01-02T00:00:00Z",
            installPath: pluginInstallPath,
            gitCommitSha: "abc123",
            isLocal: false,
          },
        },
      })
    );

    const pluginSkillRoot = join(root, pluginInstallPath, "skills");
    createSkill(pluginSkillRoot, "skill", "skill", "Plugin copy");

    const registry = new SkillRegistry({
      customDirs: [userRoot],
      scanDefaultDirs: false,
      pluginsFile,
      pluginsRoot: root,
    });

    const all = registry.getAll().filter((s) => s.name === "example:skill");
    expect(all).toHaveLength(2);

    const { includes, excludes } = parseFilters(["all"], undefined);
    const filtered = applyFilters(registry.getAll(), includes, excludes, "all").filter((s) => s.name === "example:skill");
    expect(filtered).toHaveLength(2);
  });
});
