import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSkillInfo } from "../src/api/info.js";
import { installSkills } from "../src/api/install.js";
import { listSkills } from "../src/api/list.js";
import { searchSkills } from "../src/api/search.js";
import { toggleSkills } from "../src/api/toggle.js";
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

  it("returns info payload with preview and full content", async () => {
    const bodyLines = Array.from({ length: 25 }, (_, idx) => `line-${idx + 1}`).join("\n");
    createSkill(cwd, "alpha", false, bodyLines);

    const preview = await getSkillInfo({
      name: "alpha",
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(preview.name).toBe("other:alpha");
    expect(preview.content).toContain("name: alpha");

    const full = await getSkillInfo({
      name: "alpha",
      full: true,
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(full.content).toContain("line-25");
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

  it("toggles skills programmatically", async () => {
    const skillDir = createSkill(cwd, "toggle-me");

    const disabled = await toggleSkills("disable", {
      names: ["toggle-me"],
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(disabled.succeeded).toBe(1);
    expect(existsSync(join(skillDir, ".SKILL.md"))).toBe(true);

    const enabled = await toggleSkills("enable", {
      names: ["toggle-me"],
      skillDir: [cwd],
      scanDefaultDirs: false,
      claudePluginsFile: join(cwd, "missing-plugins.json"),
    });
    expect(enabled.succeeded).toBe(1);
    expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("installs skills and supports dry-run previews", async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "ccski-api-source-"));
    const source = createSkill(sourceRoot, "install-me");
    const dest = mkdtempSync(join(tmpdir(), "ccski-api-dest-"));

    const preview = await installSkills({ source, outDir: [dest], dryRun: true });
    expect("dryRun" in preview && preview.dryRun).toBe(true);
    expect(existsSync(join(dest, "install-me"))).toBe(false);

    const result = await installSkills({ source, outDir: [dest] });
    expect("results" in result).toBe(true);
    if ("results" in result) {
      expect(result.installed).toBe(1);
      expect(existsSync(join(dest, "install-me"))).toBe(true);
    }
  });
});
