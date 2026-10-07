/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「npm lock reader：raw passthrough（未知字段保留往返，测试钉）+ unknown version → 只读 opaque view LOCK_VERSION_UNSUPPORTED（不误当空 lock，测试钉）」
 * 正交意图：
 *   [1] provenance 子集投影：v3 lock 条目只投影已知 provenance 字段，未知字段不混入
 *   [2] raw passthrough 往返：未知字段（顶层与条目内）原样保留，序列化往返无损
 *       （G0 parity 收据 p6 钉值形态）
 *   [3] unknown version / 缺文件 / 损坏 JSON 三态 typed 降级；unsupported 永不
 *       误当可替换的空 lock
 * 妥协声明：lock 文件形态取自 G0 parity 收据 p1/p6（skills@1.7.1 实跑），非猜测。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SKILL_LOCK_FILENAME,
  SKILL_LOCK_SUPPORTED_VERSION,
  readSkillLock,
  type LockReadResult,
} from "../src/core/lock-reader.js";

function newScope(): string {
  return mkdtempSync(join(tmpdir(), "ccski-lock-"));
}

async function readFrom(lockBody: string): Promise<LockReadResult> {
  const scope = newScope();
  const lockPath = join(scope, SKILL_LOCK_FILENAME);
  writeFileSync(lockPath, lockBody);
  return await readSkillLock(lockPath);
}

describe("readSkillLock", () => {
  it("reports absent for a missing lock instead of an empty one", async () => {
    const scope = newScope();
    const result = await readSkillLock(join(scope, SKILL_LOCK_FILENAME));
    expect(result).toEqual({ kind: "absent" });
  });

  it("projects the provenance subset and keeps unknown fields out of it", async () => {
    // p1/p6 形态：v3 + 条目 provenance + 未知条目字段 + 未知顶层字段
    const lockBody = JSON.stringify({
      version: 3,
      skills: {
        alpha: {
          source: "someone/alpha-skill",
          sourceType: "github",
          sourceUrl: "https://github.com/someone/alpha-skill",
          skillPath: "skills/alpha",
          skillFolderHash: "aaaa1111",
          installedAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
          futureEntryField: "keep-alpha",
        },
        beta: {
          source: "/tmp/local-source",
          sourceType: "local",
          skillFolderHash: "bbbb2222",
        },
      },
      dismissed: {},
      futureTopLevelField: { keep: true },
    });

    const result = await readFrom(lockBody);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.version).toBe(SKILL_LOCK_SUPPORTED_VERSION);

    const alpha = result.skills.find((entry) => entry.name === "alpha");
    expect(alpha).toEqual({
      name: "alpha",
      source: "someone/alpha-skill",
      sourceType: "github",
      sourceUrl: "https://github.com/someone/alpha-skill",
      skillPath: "skills/alpha",
      skillFolderHash: "aaaa1111",
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(Object.keys(alpha ?? {})).not.toContain("futureEntryField");
    expect(Object.keys(alpha ?? {})).not.toContain("installedAt");

    const beta = result.skills.find((entry) => entry.name === "beta");
    expect(beta).toEqual({
      name: "beta",
      source: "/tmp/local-source",
      sourceType: "local",
      skillFolderHash: "bbbb2222",
    });
  });

  it("preserves unknown fields raw with a lossless serialization round-trip", async () => {
    const lockBody = JSON.stringify({
      version: 3,
      skills: {
        alpha: {
          source: "someone/alpha-skill",
          futureEntryField: "keep-alpha",
          nestedFuture: { list: [1, 2, { deep: true }] },
        },
        beta: { sourceType: "local" },
      },
      dismissed: {},
      futureTopLevelField: { keep: true },
      futureArray: [1, "two", null],
    });
    const input = JSON.parse(lockBody) as Record<string, unknown>;

    const result = await readFrom(lockBody);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // raw passthrough：原样保留全部未知字段
    expect(result.raw).toEqual(input);
    expect(result.raw).not.toBe(input); // 是独立解析副本，不是引用别名

    // 往返：raw 再序列化 → 再解析，与原始输入逐字段相等（p6 钉值语义）
    const roundTrip = JSON.parse(JSON.stringify(result.raw)) as Record<string, unknown>;
    expect(roundTrip).toEqual(input);
    expect((roundTrip.futureTopLevelField as Record<string, unknown>).keep).toBe(true);
    const rawSkills = roundTrip.skills as Record<string, Record<string, unknown>>;
    expect(rawSkills.alpha?.futureEntryField).toBe("keep-alpha");
  });

  it("degrades unknown versions to a read-only opaque view that is never an empty lock", async () => {
    for (const version of [4, 2, "3", null, undefined]) {
      const result = await readFrom(
        JSON.stringify({ version, skills: { alpha: { source: "x" } }, dismissed: {} })
      );
      expect(result.kind).toBe("unsupported");
      if (result.kind !== "unsupported") continue;
      // 类型面即契约：unsupported 没有 skills 投影，唯一的码是 LOCK_VERSION_UNSUPPORTED
      expect("skills" in result).toBe(false);
      expect(result.code).toBe("LOCK_VERSION_UNSUPPORTED");
      expect(result.observedVersion).toEqual(version);
      // opaque 但 raw 仍透传（诊断面可用，不可解释为条目）
      expect(result.raw).toMatchObject({ dismissed: {} });
    }
  });

  it("degrades corrupt or non-object lock payloads as invalid, not as empty", async () => {
    const corrupt = await readFrom('{"version":3,');
    expect(corrupt).toEqual({ kind: "invalid", reason: expect.stringContaining("valid JSON") });

    const nonObject = await readFrom("[1,2,3]");
    expect(nonObject).toEqual({ kind: "invalid", reason: expect.stringContaining("object") });

    const noSkills = await readFrom('{"version":3,"dismissed":{}}');
    expect(noSkills).toEqual({ kind: "invalid", reason: expect.stringContaining("skills") });
  });

  it("drops entries whose known provenance fields have incompatible types", async () => {
    const result = await readFrom(
      JSON.stringify({
        version: 3,
        skills: {
          good: { source: "someone/good" },
          bad: { source: 42 },
        },
        dismissed: {},
      })
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.skills.map((entry) => entry.name)).toEqual(["good"]);
  });
});
