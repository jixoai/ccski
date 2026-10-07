/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「sourceUrl 统一 sanitizer 三类输入测试（userinfo /
 * credentials / query strings）+ entity 保存向与 lock-reader 投影向覆盖」
 * （spec: Field visibility contract — Source URL sanitization Scenario）
 * 正交意图：
 *   [1] sanitizeSourceUrl 单元契约：三类敏感输入清洗 + 幂等 + 非 URL 保守透传
 *   [2] 保存向：ensureEntity 落 state 的 provenance.sourceUrl 已清洗
 *   [3] 投影向：readSkillLock 对 skills-CLI 拥有的 lock 文件投影时清洗（ccski
 *       不写 lock，只能投影向清洗）
 * 妥协声明：无。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureEntity } from "../src/api/entity.js";
import { SKILL_LOCK_FILENAME, readSkillLock } from "../src/core/lock-reader.js";
import { CCSKI_STATE_FILENAME } from "../src/core/state-store.js";
import { sanitizeSourceUrl } from "../src/core/source-url.js";

describe("sanitizeSourceUrl：三类敏感输入", () => {
  it("userinfo 剥离", () => {
    expect(sanitizeSourceUrl("https://user@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo.git"
    );
    expect(sanitizeSourceUrl("ssh://git@github.com/org/repo.git")).toBe(
      "ssh://github.com/org/repo.git"
    );
  });

  it("credentials 剥离（user:pass@）", () => {
    expect(sanitizeSourceUrl("https://user:token@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo.git"
    );
    expect(sanitizeSourceUrl("https://user:pa:ss@github.com/org/repo.git")).toBe(
      "https://github.com/org/repo.git"
    );
  });

  it("query strings（与 fragment）剥离", () => {
    expect(sanitizeSourceUrl("https://github.com/org/repo.git?token=abc")).toBe(
      "https://github.com/org/repo.git"
    );
    expect(sanitizeSourceUrl("https://github.com/org/repo.git?token=abc#frag")).toBe(
      "https://github.com/org/repo.git"
    );
  });

  it("组合输入一次清洗到位且幂等", () => {
    const dirty = "https://user:token@github.com/org/repo.git?token=abc";
    const clean = sanitizeSourceUrl(dirty);
    expect(clean).toBe("https://github.com/org/repo.git");
    expect(sanitizeSourceUrl(clean)).toBe(clean);
  });

  it("非 URL 形态保守透传（本地路径）；scp 式 remote 剥 user@", () => {
    expect(sanitizeSourceUrl("/Users/me/skills/my-skill")).toBe("/Users/me/skills/my-skill");
    expect(sanitizeSourceUrl("git@github.com:org/repo.git")).toBe("github.com:org/repo.git");
  });
});

describe("provenance sourceUrl：保存向与投影向", () => {
  let home: string;
  let workspace: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ccski-url-home-"));
    workspace = mkdtempSync(join(tmpdir(), "ccski-url-ws-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeSource(name: string): string {
    const dir = join(workspace, `src-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: url fixture\n---\nBody\n`);
    return dir;
  }

  it("ensureEntity 保存向：带 credentials 的 sourceUrl 落 state 前已清洗", async () => {
    const source = writeSource("alpha");
    const result = await ensureEntity({
      scope: "project",
      source: {
        dir: source,
        sourceType: "git",
        sourceUrl: "https://user:token@github.com/org/repo.git?token=abc",
      },
      workspaceDir: workspace,
      userDir: home,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.entity.provenance.sourceUrl).toBe("https://github.com/org/repo.git");

    const state = JSON.parse(
      readFileSync(join(workspace, ".agents", CCSKI_STATE_FILENAME), "utf8")
    ) as { entities: Record<string, { provenance: { sourceUrl?: string } }> };
    const record = Object.values(state.entities).at(0);
    expect(record?.provenance.sourceUrl).toBe("https://github.com/org/repo.git");
    expect(JSON.stringify(state)).not.toContain("user:token");
    expect(JSON.stringify(state)).not.toContain("token=abc");
  });

  it("readSkillLock 投影向：lock（skills-CLI 拥有）中的敏感 sourceUrl 投影时清洗", async () => {
    const lockPath = join(home, SKILL_LOCK_FILENAME);
    writeFileSync(
      lockPath,
      JSON.stringify({
        version: 3,
        skills: {
          alpha: {
            source: "github.com/org/repo",
            sourceType: "git",
            sourceUrl: "https://user:token@github.com/org/repo.git?token=abc",
            skillPath: "/skills/alpha",
            skillFolderHash: "a".repeat(64),
            updatedAt: "2026-10-07T00:00:00.000Z",
          },
        },
      })
    );
    const read = await readSkillLock(lockPath);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.skills[0]?.sourceUrl).toBe("https://github.com/org/repo.git");
    expect(JSON.stringify(read.skills)).not.toContain("user:token");
    // raw passthrough 不受影响：未知字段/原文在 raw 里保留（只读面，非投影）
    const rawSkills = read.raw.skills as Record<string, Record<string, unknown>>;
    expect(rawSkills.alpha?.sourceUrl).toBe("https://user:token@github.com/org/repo.git?token=abc");
  });
});
