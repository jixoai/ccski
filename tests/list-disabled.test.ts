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
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "ccski-list-"));
    process.chdir(cwd);
    process.exitCode = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = 0;
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
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

  it("suppresses raw plugin parser stacks in list output", async () => {
    const userDir = mkdtempSync(join(tmpdir(), "ccski-list-plugin-drift-"));
    const pluginRoot = join(userDir, ".claude", "plugins", "cache", "example", "v1");
    const skillDir = join(pluginRoot, "skills", "alpha");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: alpha\ndescription: alpha plugin\n---\n\n# alpha\n`
    );

    const pluginsFile = join(userDir, ".claude", "plugins", "installed_plugins.json");
    mkdirSync(join(userDir, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "example@marketplace-a": [
            { installPath: pluginRoot, version: "v1" },
            { version: "broken" },
          ],
        },
      })
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: false,
      userDir,
      json: false,
      _: ["list"],
      $0: "ccski",
    } as any);

    const stdout = logSpy.mock.calls.flat().join("\n");
    const stderr = [...warnSpy.mock.calls.flat(), ...errorSpy.mock.calls.flat()].join("\n");
    expect(stdout).toContain("example:alpha");
    expect(`${stdout}\n${stderr}`).not.toContain("ZodError");
    expect(`${stdout}\n${stderr}`).not.toContain("at loadInstalledPlugins");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("keeps list --json stdout parseable with plugin manifest drift", async () => {
    const userDir = mkdtempSync(join(tmpdir(), "ccski-list-json-drift-"));
    const pluginsFile = join(userDir, ".claude", "plugins", "installed_plugins.json");
    mkdirSync(join(userDir, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      pluginsFile,
      JSON.stringify({
        version: 2,
        plugins: {
          "broken@marketplace-a": [{ version: "broken" }],
        },
      })
    );

    await listCommand({
      noColor: true,
      scanDefaultDirs: false,
      userDir,
      json: true,
      _: ["list"],
      $0: "ccski",
    } as any);

    const stdout = logSpy.mock.calls.flat().join("\n");
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
