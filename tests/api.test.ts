import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSkillInfo, readSkillContent } from "../src/api/info.js";
import { listSkills } from "../src/api/list.js";
import { searchSkills } from "../src/api/search.js";
import { validateSkill } from "../src/api/validate.js";

function createSkill(root: string, name: string, disabled = false, body = ""): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: demo\n---\n\n# ${name}\n${body}`;
  writeFileSync(join(dir, "SKILL.md"), content);
  if (disabled) {
    renameSync(join(dir, "SKILL.md"), join(dir, ".SKILL.md"));
  }
  return dir;
}

describe("programmatic API", () => {
  let cwd: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "ccski-api-"));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("lists skills with disabled filters", async () => {
    createSkill(cwd, "alpha");
    createSkill(cwd, "beta", true);

    const enabled = await listSkills({
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(enabled.map((s) => s.name)).toContain("other:alpha");
    expect(enabled.map((s) => s.name)).not.toContain("other:beta");

    const disabled = await listSkills({
      skillDir: [cwd],
      scanDefaultDirs: false,
      disabled: true,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(disabled.map((s) => s.name)).toEqual(["other:beta"]);
  });

  it("preserves an explicit provider for custom programmatic roots", async () => {
    createSkill(cwd, "provider-scoped");

    const skills = await listSkills({
      customDirs: [{ path: cwd, scope: "embedded" }],
      customProvider: "codex",
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.provider).toBe("codex");
    expect(skills[0]?.name).toBe("embedded:provider-scoped");
  });

  it("returns domain-only info DTO and separates the explicit file-read face", async () => {
    const bodyLines = Array.from({ length: 25 }, (_, idx) => `line-${idx + 1}`).join("\n");
    createSkill(cwd, "alpha", false, bodyLines);

    // Field visibility contract：info 投影恒为领域字段 DTO，无正文/frontmatter
    const info = await getSkillInfo({
      name: "alpha",
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(info.name).toBe("other:alpha");
    expect("content" in info).toBe(false);
    expect(JSON.stringify(info)).not.toContain("line-1");
    expect(JSON.stringify(info)).not.toContain("name: alpha");

    // 显式文件读取面：正文只在这里出现（全文含 frontmatter）
    const doc = await readSkillContent({
      name: "alpha",
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(doc.name).toBe("other:alpha");
    expect(doc.content).toContain("name: alpha");
    expect(doc.content).toContain("line-25");
    expect(doc.disabled).toBe(false);
    expect(doc.size).toBeGreaterThan(0);
  });

  it("searches by metadata and content", async () => {
    createSkill(cwd, "api-helper", false, "content api keyword");
    createSkill(cwd, "other-skill", false, "misc");

    const byName = await searchSkills({
      query: "api",
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(byName.map((s) => s.name)).toContain("other:api-helper");

    const byContent = await searchSkills({
      query: "keyword",
      content: true,
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(byContent.map((s) => s.name)).toContain("other:api-helper");
  });

  it("validates skill paths and reports errors", async () => {
    const skillDir = createSkill(cwd, "valid");
    const result = await validateSkill({
      path: skillDir,
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    await expect(
      validateSkill({
        path: join(cwd, "missing"),
        skillDir: [cwd],
        scanDefaultDirs: false,
        claudePluginsFile: join(cwd, "missing-plugins.json"),
      })
    ).rejects.toThrow("Could not find SKILL.md");
  });
});
