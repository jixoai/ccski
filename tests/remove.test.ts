import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  RemoveSelectionError,
  RemoveTargetRootError,
  removeSkills,
} from "../src/api/remove.js";

const maybeSymlink = process.platform === "win32" ? it.skip : it;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function newRoot(): string {
  return mkdtempSync(join(tmpdir(), "ccski-remove-root-"));
}

function createSkill(root: string, name: string, options: { disabled?: boolean } = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const fileName = options.disabled ? ".SKILL.md" : "SKILL.md";
  writeFileSync(join(dir, fileName), `---\nname: ${name}\ndescription: demo ${name}\n---\n\n# ${name}\n`);
  return dir;
}

describe("removeSkills", () => {
  it("removes a named skill directory", async () => {
    const root = newRoot();
    const dir = createSkill(root, "alpha");

    const summary = await removeSkills({ targetRoot: root, requests: ["alpha"] });

    expect(summary.removed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0]).toMatchObject({ skill: "alpha", status: "removed", path: dir });
    expect(existsSync(dir)).toBe(false);
  });

  it("is idempotent: missing target is a successful skip", async () => {
    const root = newRoot();
    createSkill(root, "alpha");
    await removeSkills({ targetRoot: root, requests: ["alpha"] });

    const second = await removeSkills({ targetRoot: root, requests: ["alpha"] });

    expect(second.removed).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.results[0]).toMatchObject({ status: "skipped", reason: "NOT_FOUND" });
  });

  it("reports mixed per-item statuses in one call", async () => {
    const root = newRoot();
    const alpha = createSkill(root, "alpha");

    const summary = await removeSkills({
      targetRoot: root,
      requests: ["alpha", "ghost", "../escape"],
    });

    expect(summary.removed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]).toMatchObject({ skill: "alpha", status: "removed" });
    expect(summary.results[1]).toMatchObject({ skill: "ghost", status: "skipped" });
    expect(summary.results[2]).toMatchObject({
      skill: "../escape",
      status: "failed",
      errorCode: "INVALID_NAME",
    });
    expect(existsSync(alpha)).toBe(false);
  });

  it.each([
    "../escape",
    "a/b",
    "a\\b",
    "..",
    ".",
    ".hidden",
    "a:b",
    "",
    "bad\0name",
    "has space",
    "x".repeat(129),
  ])("rejects polluted name %j with INVALID_NAME and deletes nothing", async (name) => {
    const root = newRoot();
    const alpha = createSkill(root, "alpha");

    const summary = await removeSkills({ targetRoot: root, requests: [name] });

    expect(summary.results[0]).toMatchObject({
      skill: name,
      status: "failed",
      errorCode: "INVALID_NAME",
    });
    expect(summary.results[0]?.path).toBe("");
    expect(existsSync(alpha)).toBe(true);
  });

  it("trims surrounding whitespace before validation", async () => {
    const root = newRoot();
    const alpha = createSkill(root, "alpha");

    const summary = await removeSkills({ targetRoot: root, requests: ["  alpha  "] });

    expect(summary.removed).toBe(1);
    expect(existsSync(alpha)).toBe(false);
  });

  maybeSymlink("refuses a symlinked skill directory without touching the target", async () => {
    const root = newRoot();
    const outside = mkdtempSync(join(tmpdir(), "ccski-remove-outside-"));
    const realDir = join(outside, "real");
    mkdirSync(realDir);
    writeFileSync(join(realDir, "SKILL.md"), "---\nname: real\ndescription: x\n---\n");
    symlinkSync(realDir, join(root, "linked"));

    const summary = await removeSkills({ targetRoot: root, requests: ["linked"] });

    expect(summary.results[0]).toMatchObject({ status: "failed", errorCode: "SYMLINK_TARGET" });
    expect(existsSync(join(realDir, "SKILL.md"))).toBe(true);
    expect(lstatSync(join(root, "linked")).isSymbolicLink()).toBe(true);
  });

  it("refuses a directory without any identity file", async () => {
    const root = newRoot();
    const plain = join(root, "notaskill");
    mkdirSync(plain);
    writeFileSync(join(plain, "notes.txt"), "keep me");

    const summary = await removeSkills({ targetRoot: root, requests: ["notaskill"] });

    expect(summary.results[0]).toMatchObject({ status: "failed", errorCode: "NOT_A_SKILL" });
    expect(existsSync(join(plain, "notes.txt"))).toBe(true);
  });

  it("refuses a plain file at the target path", async () => {
    const root = newRoot();
    writeFileSync(join(root, "afile"), "x");

    const summary = await removeSkills({ targetRoot: root, requests: ["afile"] });

    expect(summary.results[0]).toMatchObject({ status: "failed", errorCode: "NOT_DIRECTORY" });
    expect(existsSync(join(root, "afile"))).toBe(true);
  });

  describe("guards", () => {
    it("removes when the expected content hash matches", async () => {
      const root = newRoot();
      const dir = createSkill(root, "alpha");
      const content = readFileSync(join(dir, "SKILL.md")).toString();

      const summary = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedContentHash: sha256(content) }],
      });

      expect(summary.removed).toBe(1);
      expect(existsSync(dir)).toBe(false);
    });

    it("fails with GUARD_MISMATCH and preserves the directory on hash mismatch", async () => {
      const root = newRoot();
      const dir = createSkill(root, "alpha");

      const summary = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedContentHash: sha256("stale content") }],
      });

      expect(summary.results[0]).toMatchObject({ status: "failed", errorCode: "GUARD_MISMATCH" });
      expect(existsSync(dir)).toBe(true);
    });

    it("removes when the expected inode matches and fails when it changed", async () => {
      const root = newRoot();
      const dir = createSkill(root, "alpha");
      const ino = lstatSync(dir).ino;

      const ok = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedInode: ino }],
      });
      expect(ok.removed).toBe(1);

      const rebuilt = createSkill(root, "alpha");
      const mismatch = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedInode: ino + 1000 }],
      });
      expect(mismatch.results[0]).toMatchObject({ status: "failed", errorCode: "GUARD_MISMATCH" });
      expect(existsSync(rebuilt)).toBe(true);
    });

    it("fails with GUARD_INVALID for malformed guard values", async () => {
      const root = newRoot();
      const dir = createSkill(root, "alpha");

      const badHash = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedContentHash: "nothex" }],
      });
      expect(badHash.results[0]).toMatchObject({ status: "failed", errorCode: "GUARD_INVALID" });

      const badInode = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedInode: 1.5 }],
      });
      expect(badInode.results[0]).toMatchObject({ status: "failed", errorCode: "GUARD_INVALID" });
      expect(existsSync(dir)).toBe(true);
    });

    maybeSymlink("fails with GUARD_UNREADABLE when the identity file is a symlink", async () => {
      const root = newRoot();
      const outside = mkdtempSync(join(tmpdir(), "ccski-remove-outside-"));
      const realFile = join(outside, "SKILL.md");
      const realContent = "---\nname: alpha\ndescription: x\n---\n";
      writeFileSync(realFile, realContent);
      const dir = join(root, "alpha");
      mkdirSync(dir);
      symlinkSync(realFile, join(dir, "SKILL.md"));

      const summary = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedContentHash: sha256(realContent) }],
      });

      expect(summary.results[0]).toMatchObject({ status: "failed", errorCode: "GUARD_UNREADABLE" });
      expect(existsSync(dir)).toBe(true);
    });

    it("hashes .SKILL.md for disabled-only directories", async () => {
      const root = newRoot();
      const dir = createSkill(root, "alpha", { disabled: true });
      const content = readFileSync(join(dir, ".SKILL.md")).toString();

      const summary = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedContentHash: sha256(content) }],
      });

      expect(summary.removed).toBe(1);
      expect(existsSync(dir)).toBe(false);
    });

    it("treats SKILL.md as the active identity file when both exist", async () => {
      const root = newRoot();
      const dir = createSkill(root, "alpha");
      writeFileSync(join(dir, ".SKILL.md"), "---\nname: alpha\ndescription: old\n---\n");

      const staleDisabledHash = await removeSkills({
        targetRoot: root,
        requests: [
          { name: "alpha", expectedContentHash: sha256("---\nname: alpha\ndescription: old\n---\n") },
        ],
      });
      expect(staleDisabledHash.results[0]).toMatchObject({
        status: "failed",
        errorCode: "GUARD_MISMATCH",
      });

      const active = readFileSync(join(dir, "SKILL.md")).toString();
      const ok = await removeSkills({
        targetRoot: root,
        requests: [{ name: "alpha", expectedContentHash: sha256(active) }],
      });
      expect(ok.removed).toBe(1);
    });
  });

  it("all mode removes every skill and leaves non-skill entries", async () => {
    const root = newRoot();
    createSkill(root, "alpha");
    createSkill(root, "beta", { disabled: true });
    writeFileSync(join(root, "README.txt"), "keep");

    const summary = await removeSkills({ targetRoot: root, all: true });

    expect(summary.removed).toBe(2);
    expect(existsSync(join(root, "README.txt"))).toBe(true);
    expect(existsSync(join(root, "alpha"))).toBe(false);
    expect(existsSync(join(root, "beta"))).toBe(false);
  });

  it("throws RemoveSelectionError with a listing when no selection is provided", async () => {
    const root = newRoot();
    createSkill(root, "alpha");
    createSkill(root, "beta");

    const error = await removeSkills({ targetRoot: root }).catch((err) => err);

    expect(error).toBeInstanceOf(RemoveSelectionError);
    expect(error.listing).toContain("alpha");
    expect(error.listing).toContain("beta");
    expect(existsSync(join(root, "alpha"))).toBe(true);
  });

  it("throws RemoveSelectionError for interactive mode without a TTY", async () => {
    const root = newRoot();
    createSkill(root, "alpha");

    await expect(removeSkills({ targetRoot: root, interactive: true })).rejects.toBeInstanceOf(
      RemoveSelectionError
    );
    expect(existsSync(join(root, "alpha"))).toBe(true);
  });

  it("dryRun previews without deleting", async () => {
    const root = newRoot();
    const dir = createSkill(root, "alpha");

    const preview = await removeSkills({ targetRoot: root, requests: ["alpha"], dryRun: true });

    expect(preview).toMatchObject({
      dryRun: true,
      totalRemovals: 1,
      skills: [{ name: "alpha", exists: true }],
    });
    expect(existsSync(dir)).toBe(true);
  });

  it("throws RemoveTargetRootError (NOT_FOUND) for a missing root", async () => {
    const missing = join(newRoot(), "does-not-exist");

    await expect(removeSkills({ targetRoot: missing, requests: ["alpha"] })).rejects.toBeInstanceOf(
      RemoveTargetRootError
    );
  });

  it("throws RemoveTargetRootError (NOT_DIRECTORY) for a file root", async () => {
    const root = newRoot();
    const file = join(root, "file");
    writeFileSync(file, "x");

    await expect(removeSkills({ targetRoot: file, requests: ["alpha"] })).rejects.toBeInstanceOf(
      RemoveTargetRootError
    );
  });

  maybeSymlink("throws RemoveTargetRootError (SYMLINK) for a symlinked root", async () => {
    const root = newRoot();
    const real = newRoot();
    symlinkSync(real, join(root, "link"));

    await expect(
      removeSkills({ targetRoot: join(root, "link"), requests: ["alpha"] })
    ).rejects.toBeInstanceOf(RemoveTargetRootError);
  });
});
