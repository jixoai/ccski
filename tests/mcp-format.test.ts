import { describe, expect, it } from "vitest";
import { buildSkillDescription, formatSkillContent } from "../src/mcp/server.js";
import type { Skill } from "../src/types/skill.js";
import type { SkillRegistry } from "../src/core/registry.js";

const baseSkill: Skill = {
  name: "demo",
  fullName: "demo",
  description: "Demo skill",
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
    } as unknown as SkillRegistry;

    const description = buildSkillDescription(registry);
    expect(description).toContain("Available skills");
    expect(description).toContain("demo: Demo skill");
  });
});
