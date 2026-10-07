/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「P0-5 词表机械闭合：机械对账测试断言 union 值集 ==
 * CHANGELOG 列出的集合 == 各 API 返回类型的成员；SOURCE_UNSUPPORTED 补触发测试」
 * （codex 3.0 残留审计 P0-5）
 * 正交意图：
 *   [1] 运行时对账：PUBLIC_RESULT_CODES（排序/去重/SCREAMING 命名）==
 *       CHANGELOG「Typed failure vocabulary」码表 == spec 冻结码逐个在场；
 *       编译期闭合由 src/api/result-codes.ts 的 ResultCodeClosureReceipt 承担
 *       （tsc 门），本文件引用收据类型保持两面的类型链接
 *   [2] SOURCE_UNSUPPORTED 触发例：CLI install 以 git/URL/marketplace 源调用 →
 *       typed 收据（此前该码无测试触达，仅实现面静态出现）
 * 妥协声明：SOURCE_UNSUPPORTED 触发经 installCommand 进程内调用 + console 捕获
 * （CLI 命令面输出契约），不起子进程。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ResultCodeClosureReceipt } from "../src/api/result-codes.js";
import { PUBLIC_RESULT_CODES } from "../src/api/result-codes.js";
import { installCommand } from "../src/cli/commands/install.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const CHANGELOG_PATH = join(repoRoot, "CHANGELOG.md");
const SPEC_PATH = join(
  repoRoot,
  "openspec",
  "changes",
  "store-link-kernel",
  "specs",
  "entity-projection-kernel",
  "spec.md"
);

/** spec 冻结词表逐码在场（Requirement 正文点名的核心冻结码） */
const SPEC_FROZEN_CODES = [
  "NAME_COLLISION",
  "NAME_EXISTS",
  "SCOPE_REQUIRED",
  "STATE_GENERATION_CONFLICT",
  "STATE_RECOVERY_REQUIRED",
  "ENTITY_REVISED",
  "STALE_PROJECTION",
  "PINNED",
  "FOREIGN_OWNERSHIP",
  "TARGET_DENIED",
  "LOCK_VERSION_UNSUPPORTED",
  "GUARD_ENTITY",
  "GUARD_PROJECTION",
  "CLAIM_CONFLICT",
  "REPAIR_CONFIRM_REQUIRED",
  "GC_UNKNOWN_REFERENCE",
  "DRY_RUN_REQUIRED",
  "HASH_MISMATCH",
  "NO_GLOBAL_INSTALL",
] as const;

function extractChangelogCodes(): string[] {
  const changelog = readFileSync(CHANGELOG_PATH, "utf8");
  const line = changelog
    .split("\n")
    .find((l) => l.includes("**Typed failure vocabulary**") && l.includes("Codes:"));
  expect(line, "CHANGELOG must carry the Typed failure vocabulary line").toBeTruthy();
  const codes = [...(line?.matchAll(/`([A-Z][A-Z0-9_]*)`/g) ?? [])].map((m) => m[1] ?? "");
  // 生成说明里点名的导出面符号不是词表码
  return codes.filter((code) => code !== "PUBLIC_RESULT_CODES" && code !== "ResultCode");
}

describe("PUBLIC_RESULT_CODES：机械对账", () => {
  it("表是 frozen、去重、ASCII 排序的 SCREAMING 词表", () => {
    expect(Object.isFrozen(PUBLIC_RESULT_CODES)).toBe(true);
    const codes = [...PUBLIC_RESULT_CODES];
    expect(new Set(codes).size).toBe(codes.length);
    const sorted = [...codes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(codes).toEqual(sorted);
    for (const code of codes) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it("CHANGELOG「Typed failure vocabulary」码表与导出表逐码相等", () => {
    const changelogCodes = extractChangelogCodes();
    expect(changelogCodes.sort()).toEqual([...PUBLIC_RESULT_CODES].sort());
  });

  it("spec 冻结码逐个在场（词表与 spec 双向锚定）", () => {
    const spec = readFileSync(SPEC_PATH, "utf8");
    for (const code of SPEC_FROZEN_CODES) {
      expect(PUBLIC_RESULT_CODES).toContain(code);
      expect(spec).toContain(code);
    }
  });

  it("编译期闭合收据类型在场（tsc 门在 src/api/result-codes.ts 两侧断言）", () => {
    // 类型级证据：收据字段类型 = 两侧断言的 bool；任一侧漂移 tsc 已先失败
    const receipt: ResultCodeClosureReceipt = {
      apiSubsetOfTable: true,
      tableClosedOverApi: true,
    };
    expect(receipt.apiSubsetOfTable).toBe(true);
    expect(receipt.tableClosedOverApi).toBe(true);
  });
});

describe("SOURCE_UNSUPPORTED 触发例", () => {
  function captureJson(): { logs: () => string; spy: ReturnType<typeof vi.spyOn> } {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    return { spy, logs: () => spy.mock.calls.map((args) => String(args[0])).join("\n") };
  }

  it.each([
    "https://github.com/org/repo.git",
    "git@github.com:org/repo.git",
    "https://marketplace.example/skills.json",
  ])("retired source %s → typed SOURCE_UNSUPPORTED 收据 + exit 1", async (source) => {
    const exitBefore = process.exitCode;
    const { spy, logs } = captureJson();
    try {
      await installCommand({
        source,
        json: true,
        dryRun: true,
        _: ["install", source],
        $0: "ccski",
      } as never);
    } finally {
      const printed = logs();
      spy.mockRestore();
      const receipt = JSON.parse(printed) as { kind: string; code: string };
      expect(receipt.kind).toBe("error");
      expect(receipt.code).toBe("SOURCE_UNSUPPORTED");
      expect(PUBLIC_RESULT_CODES).toContain("SOURCE_UNSUPPORTED");
      expect(process.exitCode).toBe(1);
      process.exitCode = exitBefore;
    }
  });
});
