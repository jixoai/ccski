import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listCommand } from "../src/cli/commands/list.js";

function createSkill(root: string, name: string, disabled = false): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: demo\n---\n\n# ${name}\n`);
  if (disabled) {
    renameSync(join(dir, "SKILL.md"), join(dir, ".SKILL.md"));
  }
  return dir;
}

describe("list command disabled handling", () => {
  let cwd: string;
  const originalCwd = process.cwd();
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "ccski-list-"));
    process.chdir(cwd);
    process.exitCode = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    logSpy.mockRestore();
  });

  it("hides disabled skills by default and shows them with --disabled", async () => {
    createSkill(cwd, "enabled-one");
    createSkill(cwd, "disabled-one", true);

    await listCommand({
      noColor: true,
      skillDir: [cwd],
      scanDefaultDirs: false,
      json: false,
      _: ["list"],
      $0: "ccski",
    } as any);

    const firstCall = logSpy.mock.calls.flat().join("\n");
    expect(firstCall).toContain("enabled-one");
    expect(firstCall).not.toContain("disabled-one");

    logSpy.mockClear();

    await listCommand({
      noColor: true,
      skillDir: [cwd],
      scanDefaultDirs: false,
      disabled: true,
      json: false,
      _: ["list"],
      $0: "ccski",
    } as any);

    const disabledOutput = logSpy.mock.calls.flat().join("\n");
    expect(disabledOutput).toContain("disabled-one");
    expect(disabledOutput).toContain("[disabled]");
    expect(disabledOutput).not.toContain("enabled-one");
  });
});
