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

    const result = installSkillDir(src, destRoot, false);

    expect(result.path).toBe(join(destRoot, "alpha"));
    expect(result.name).toBe("alpha");
    expect(result.status).toBe("installed");
  });

  it("returns skipped status when skill exists without force", () => {
    const src = createSkill("beta");
    const destRoot = mkdtempSync(join(tmpdir(), "ccski-install-target-"));
    const firstResult = installSkillDir(src, destRoot, false);
    expect(firstResult.status).toBe("installed");

    const secondResult = installSkillDir(src, destRoot, false);
    expect(secondResult.status).toBe("skipped");
    expect(secondResult.name).toBe("beta");
  });

  it("returns overwritten status when skill exists with force", () => {
    const src = createSkill("gamma");
    const destRoot = mkdtempSync(join(tmpdir(), "ccski-install-target-"));
    const firstResult = installSkillDir(src, destRoot, false);
    expect(firstResult.status).toBe("installed");

    const secondResult = installSkillDir(src, destRoot, true);
    expect(secondResult.status).toBe("overwritten");
    expect(secondResult.name).toBe("gamma");
  });
});
