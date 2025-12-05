import { describe, expect, it } from "vitest";
import { buildSkillDescription, formatSkillContent } from "../src/mcp/server.js";
import type { Skill, SkillProvider } from "../src/types/skill.js";
import type { SkillRegistry } from "../src/core/registry.js";

const baseSkill: Skill = {
  name: "demo",
  fullName: "demo",
  description: "Demo skill",
  provider: "claude" as SkillProvider,
  location: "user",
  path: "/skills/demo",
  hasReferences: false,
  hasScripts: false,
  hasAssets: false,
  content: "# Demo\nSome instructions.",
};

describe("MCP formatting helpers", () => {
  it("formats skill content without noisy prefixes", () => {
    const result = formatSkillContent(baseSkill);

    expect(result).toContain("name: demo");
    expect(result).toContain("path: /skills/demo");
    expect(result).toContain("location: user");
    expect(result).not.toContain("Loading:");
    expect(result).toContain("Some instructions.");
  });

  it("includes plugin metadata when present", () => {
    const pluginSkill: Skill = {
      ...baseSkill,
      name: "plugin:alpha",
      fullName: "plugin:alpha",
      location: "plugin",
      pluginInfo: {
        pluginName: "plugin",
        marketplace: "store",
        version: "1.0.0",
      },
    };

    const result = formatSkillContent(pluginSkill);
    expect(result).toContain("plugin: plugin@store");
  });

  it("builds a readable tool description", () => {
    const registry = {
      getAll: () => [baseSkill],
      getDiagnostics: () => ({
        totalSkills: 1,
        byLocation: { user: 1 },
        byProvider: { claude: 1 },
        directoriesScanned: [],
        pluginSources: [],
        warnings: [],
        conflicts: [],
      }),
    } as unknown as SkillRegistry;

    // Use 'all' include to bypass auto-dedup filter (auto requires specific providers)
    const description = buildSkillDescription(registry, [{ provider: "all" }], [], "enabled");
    expect(description).toContain("<skills_instructions>");
    expect(description).toContain("<available_skills>");
    expect(description).toContain("<name>demo</name>");
    expect(description).toContain("<description>Demo skill</description>");
    expect(description).toContain("<location>global</location>");
  });
});
