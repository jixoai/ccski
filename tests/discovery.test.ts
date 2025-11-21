import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { discoverSkills } from "../src/core/discovery.js";
import { SkillRegistry } from "../src/core/registry.js";

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
  it("prefers higher-priority custom directories", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-discovery-"));
    const highDir = join(root, "high");
    const lowDir = join(root, "low");

    createSkill(highDir, "shared", "shared-skill", "High priority skill");
    createSkill(lowDir, "shared", "shared-skill", "Low priority skill");

    const result = discoverSkills({ customDirs: [highDir, lowDir], scanDefaultDirs: false });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.path).toBe(join(highDir, "shared"));
    expect(result.diagnostics.conflicts.some((c) => c.includes("shared-skill"))).toBe(true);
  });

  it("finds skills recursively in nested directories", () => {
    const root = mkdtempSync(join(tmpdir(), "ccski-recursive-"));
    createSkill(join(root, "nested", "inner"), "deep-skill");

    const result = discoverSkills({ customDirs: [root], scanDefaultDirs: false });

    expect(result.skills.map((skill) => skill.name)).toContain("deep-skill");
  });
});

describe("SkillRegistry", () => {
  it("resolves short names to non-plugin skills when conflicts exist", () => {
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

    const userSkill = registry.find("pdf");
    expect(userSkill.location).not.toBe("plugin");
    expect(userSkill.path).toContain(join("user-skills", "pdf"));

    const pluginSkill = registry.find("example-skills:pdf");
    expect(pluginSkill.location).toBe("plugin");
    expect(pluginSkill.path).toContain(join("plugins", "example-skills", "pdf"));
  });
});
