import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { installSkillDir } from "../src/cli/commands/install.js";

function createSkill(dirName: string, description = "demo"): string {
  const root = mkdtempSync(join(tmpdir(), `ccski-install-${dirName}-`));
  const skillDir = join(root, dirName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${dirName}\ndescription: ${description}\n---\n\n# ${dirName}\n`
  );
  return skillDir;
}

describe("installSkillDir", () => {
  it("copies skill into target root", () => {
    const src = createSkill("alpha", "alpha description");
    const destRoot = mkdtempSync(join(tmpdir(), "ccski-install-target-"));

    const installedPath = installSkillDir(src, destRoot, false);

    expect(installedPath).toBe(join(destRoot, "alpha"));
  });

  it("throws when skill exists without force", () => {
    const src = createSkill("beta");
    const destRoot = mkdtempSync(join(tmpdir(), "ccski-install-target-"));
    installSkillDir(src, destRoot, false);

    expect(() => installSkillDir(src, destRoot, false)).toThrow(/already exists/);
  });
});
