import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { installSkillDir, InstallAuditError } from "../src/api/install.js";
import { InvalidSkillNameError } from "../src/types/errors.js";

const maybeSymlink = process.platform === "win32" ? it.skip : it;

// Mutable indirection so a single test can simulate a catchable cpSync failure
// (vi.spyOn cannot redefine properties on the node:fs ESM namespace).
const cpSyncOverride: { impl: typeof fs.cpSync | null } = { impl: null };
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const wrappedCpSync = ((...args: Parameters<typeof actual.cpSync>) => {
    if (cpSyncOverride.impl !== null) return cpSyncOverride.impl(...args);
    return actual.cpSync(...args);
  }) as typeof actual.cpSync;
  return { ...actual, cpSync: wrappedCpSync };
});

function newRoot(): string {
  return mkdtempSync(join(tmpdir(), "ccski-hardening-root-"));
}

function createSource(name: string, description = "demo", extraFiles: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ccski-hardening-src-"));
  const skillDir = join(root, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  );
  for (const [file, content] of Object.entries(extraFiles)) {
    writeFileSync(join(skillDir, file), content);
  }
  return skillDir;
}

function expectAuditError(fn: () => unknown, code: string): InstallAuditError {
  try {
    fn();
    throw new Error(`Expected InstallAuditError with code ${code}`);
  } catch (err) {
    if (!(err instanceof InstallAuditError)) throw err;
    expect(err.code).toBe(code);
    return err;
  }
}

describe("installSkillDir audit hardening", () => {
  it("keeps installed/skipped/overwritten idempotent statuses", () => {
    const src = createSource("alpha");
    const targetRoot = newRoot();

    expect(installSkillDir(src, targetRoot, false).status).toBe("installed");
    expect(installSkillDir(src, targetRoot, false).status).toBe("skipped");
    expect(installSkillDir(src, targetRoot, true).status).toBe("overwritten");
  });

  it("refuses a missing source", () => {
    const targetRoot = newRoot();
    expectAuditError(() => installSkillDir(join(targetRoot, "nope"), targetRoot, false), "SOURCE_NOT_FOUND");
  });

  it("refuses a plain-file source", () => {
    const root = newRoot();
    const file = join(root, "file");
    writeFileSync(file, "x");
    expectAuditError(() => installSkillDir(file, newRoot(), false), "SOURCE_NOT_DIRECTORY");
  });

  maybeSymlink("refuses a symlinked source directory", () => {
    const realSrc = createSource("alpha");
    const root = newRoot();
    symlinkSync(realSrc, join(root, "link"));

    expectAuditError(() => installSkillDir(join(root, "link"), newRoot(), false), "SOURCE_SYMLINK");
  });

  it("refuses unsafe frontmatter names with InvalidSkillNameError", () => {
    const targetRoot = newRoot();
    for (const name of ["../escape", "a/b", "a:b", ".hidden", "has space"]) {
      const root = mkdtempSync(join(tmpdir(), "ccski-hardening-evil-"));
      const skillDir = join(root, "dir");
      mkdirSync(skillDir);
      writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n`);
      try {
        expect(() => installSkillDir(skillDir, targetRoot, false)).toThrow(InvalidSkillNameError);
      } finally {
        expect(existsSync(join(targetRoot, name))).toBe(false);
      }
    }
  });

  it("refuses a symlinked target root", () => {
    const src = createSource("alpha");
    const root = newRoot();
    const real = newRoot();
    symlinkSync(real, join(root, "link"));

    expectAuditError(
      () => installSkillDir(src, join(root, "link"), false),
      "TARGET_ROOT_SYMLINK"
    );
  });

  it("refuses a non-directory target root instead of writing through it", () => {
    const src = createSource("alpha");
    const root = newRoot();
    const file = join(root, "file");
    writeFileSync(file, "x");

    expectAuditError(() => installSkillDir(src, file, false), "TARGET_ROOT_NOT_DIRECTORY");
  });

  maybeSymlink("refuses a symlinked destination with and without force", () => {
    const src = createSource("alpha");
    const targetRoot = newRoot();
    const outside = mkdtempSync(join(tmpdir(), "ccski-hardening-outside-"));
    const victim = join(outside, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "keep.txt"), "do not touch");
    symlinkSync(victim, join(targetRoot, "alpha"));

    expectAuditError(() => installSkillDir(src, targetRoot, false), "DEST_SYMLINK");
    expectAuditError(() => installSkillDir(src, targetRoot, true), "DEST_SYMLINK");
    expect(existsSync(join(victim, "keep.txt"))).toBe(true);
    expect(existsSync(join(victim, "SKILL.md"))).toBe(false);
    expect(lstatSync(join(targetRoot, "alpha")).isSymbolicLink()).toBe(true);
  });

  it("refuses a non-directory destination", () => {
    const src = createSource("alpha");
    const targetRoot = newRoot();
    writeFileSync(join(targetRoot, "alpha"), "occupied");

    expectAuditError(() => installSkillDir(src, targetRoot, true), "DEST_NOT_DIRECTORY");
  });

  it("performs a clean swap on overwrite: stale files from the old version are gone", () => {
    const v1 = createSource("alpha", "v1", { "stale-extra.txt": "old file only in v1" });
    const v2 = createSource("alpha", "v2");
    const targetRoot = newRoot();

    expect(installSkillDir(v1, targetRoot, false).status).toBe("installed");

    const result = installSkillDir(v2, targetRoot, true);
    expect(result.status).toBe("overwritten");
    expect(result.warning).toBeUndefined();
    expect(existsSync(join(targetRoot, "alpha", "stale-extra.txt"))).toBe(false);
    expect(existsSync(join(targetRoot, "alpha", "SKILL.md"))).toBe(true);
  });

  it("leaves no staging or backup residue after success", () => {
    const src = createSource("alpha");
    const targetRoot = newRoot();
    installSkillDir(src, targetRoot, false);
    installSkillDir(src, targetRoot, true);

    const residue = readdirSync(targetRoot).filter(
      (entry) => entry.startsWith(".ccski-staging-") || entry.startsWith(".ccski-backup-")
    );
    expect(residue).toEqual([]);
  });

  it("preserves the previous installation when staging the copy fails", () => {
    const v1 = createSource("alpha", "v1", { "v1-marker.txt": "only in v1" });
    const v2 = createSource("alpha", "v2");
    const targetRoot = newRoot();
    installSkillDir(v1, targetRoot, false);

    // Simulate a catchable copy failure (e.g. ENOSPC). A real chmod-based
    // simulation is not portable: on macOS cpSync aborts the process on an
    // unreadable directory instead of raising a catchable JS error.
    cpSyncOverride.impl = () => {
      throw new Error("ENOSPC: simulated disk full");
    };
    try {
      expectAuditError(() => installSkillDir(v2, targetRoot, true), "COPY_FAILED");
    } finally {
      cpSyncOverride.impl = null;
    }
    // v1 stays complete; no partial v2 content leaked into the destination.
    expect(existsSync(join(targetRoot, "alpha", "v1-marker.txt"))).toBe(true);
    expect(existsSync(join(targetRoot, "alpha", "SKILL.md"))).toBe(true);
    const residue = readdirSync(targetRoot).filter((entry) => entry.startsWith(".ccski-staging-"));
    expect(residue).toEqual([]);
  });
});
