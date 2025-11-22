import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { installSkill } from "../src/cli/commands/install.js";

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

describe("installSkill", () => {
  it("copies skill into target root", () => {
    const src = createSkill("alpha", "alpha description");
    const destRoot = mkdtempSync(join(tmpdir(), "ccski-install-target-"));

    const installedPath = installSkill(src, destRoot, false);

    expect(installedPath).toBe(join(destRoot, "alpha"));
  });

  it("throws when skill exists without force", () => {
    const src = createSkill("beta");
    const destRoot = mkdtempSync(join(tmpdir(), "ccski-install-target-"));
    installSkill(src, destRoot, false);

    expect(() => installSkill(src, destRoot, false)).toThrow(/already exists/);
  });
});
