import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../src/core/registry.js";
import { buildSkillDescription, formatSkillContent } from "../src/mcp/server.js";

function createSkillDir(name: string, description = "demo skill"): string {
  const tempRoot = mkdtempSync(join(tmpdir(), `ccski-mcp-${name}-`));
  const skillPath = join(tempRoot, name);
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(
    join(skillPath, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  );
  return tempRoot;
}

describe("mcp helpers", () => {
  it("builds tool description listing skills", () => {
    const dir = createSkillDir("alpha", "alpha description");
    const registry = new SkillRegistry({ customDirs: [dir], scanDefaultDirs: false, skipPlugins: true });

    // Default includes is 'auto', but for 'file' provider skills we need to include 'all' or specify 'file'
    const desc = buildSkillDescription(registry, [{ provider: "all" }], [], "enabled");
    expect(desc).toContain("<available_skills>");
    expect(desc).toContain("<name>other:alpha</name>");
    expect(desc).toContain("<description>alpha description</description>");
    expect(desc).toContain("<location>global</location>");
  });

  it("formats skill content with base directory (frontmatter stripped, body served)", () => {
    const dir = createSkillDir("bravo", "bravo description");
    const registry = new SkillRegistry({ customDirs: [dir], scanDefaultDirs: false, skipPlugins: true });
    const skill = registry.load("bravo");

    const formatted = formatSkillContent(skill);
    expect(formatted).toContain(`name: ${skill.name}`);
    expect(formatted).toContain(`path: ${skill.path}`);
    // Field visibility contract：正文在场；原始 frontmatter 块不重复进工具结果
    expect(formatted).toContain(`# bravo`);
    expect(formatted).not.toContain("description: bravo description");
    expect(formatted).not.toContain("---");
  });
});
