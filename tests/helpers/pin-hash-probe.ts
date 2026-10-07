/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「folder-hash：按 G0 收据实现……F1-F7 七 fixture 全 digest 对账」
 * 正交意图：
 *   [1] pin 工具：对重建的 F1-F7 树以真实 skills@1.7.1 CLI 实跑重钉期望 digest
 *       （隔离 HOME/XDG；lock 逐条目读 skillFolderHash），并产出 byte-order 变体对照
 *   [2] 记录钉值获取方法（收据 folder-hash-receipt.md §2 的复跑协议），非生产代码
 * 妥协声明：G0 原始树未持久化，F3-F7 SKILL.md 字节不可从收据逐字复原，故按
 * tests/helpers/hash-fixtures.ts 的重建树重钉；F1/F2 必须与收据钉值一致（字节级对账锚）。
 * 运行：pnpm exec tsx tests/helpers/pin-hash-probe.ts
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { buildAllHashFixtures } from "./hash-fixtures.js";

// --- 收据 §1 算法转录（与 npm 1.7.1 dist/cli.mjs:1138-1167 同构；独立于 src 实现） ---
interface CollectedFile {
  relativePath: string;
  content: Buffer;
}

function hashWithComparator(
  skillDir: string,
  compare: (a: CollectedFile, b: CollectedFile) => number
): string {
  const files: CollectedFile[] = [];
  collectSync(skillDir, files);
  files.sort(compare);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

function collectSync(currentDir: string, results: CollectedFile[], baseDir = currentDir): void {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      collectSync(fullPath, results, baseDir);
    } else if (entry.isFile()) {
      results.push({
        relativePath: relative(baseDir, fullPath).split("\\").join("/"),
        content: readFileSync(fullPath),
      });
    }
  }
}

const localeDigest = (dir: string) =>
  hashWithComparator(dir, (a, b) => a.relativePath.localeCompare(b.relativePath));
const byteOrderDigest = (dir: string) =>
  hashWithComparator(dir, (a, b) =>
    Buffer.compare(Buffer.from(a.relativePath, "utf8"), Buffer.from(b.relativePath, "utf8"))
  );

// --- 主流程：隔离 HOME + 真实 skills@1.7.1 实跑 ---
function main(): void {
  const runtime = mkdtempSync(join(tmpdir(), "ccski-b1-pin-"));
  const home = join(runtime, "home");
  const xdgState = join(runtime, "xdg-state");
  const fixturesDir = join(runtime, "fixtures");
  for (const dir of [home, xdgState, fixturesDir]) mkdirSync(dir, { recursive: true });

  const built = buildAllHashFixtures(fixturesDir);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: xdgState,
    npm_config_cache: join(process.env.HOME ?? "", ".npm"),
    npm_config_prefer_offline: "true",
  };

  for (const [dirName, skillDir] of built) {
    execFileSync(
      "npx",
      [
        "--yes",
        "--prefer-offline",
        "skills@1.7.1",
        "add",
        skillDir,
        "--global",
        "--yes",
        "--agent",
        "claude-code",
      ],
      { env, stdio: "pipe" }
    );
    process.stdout.write(`installed ${dirName}\n`);
  }

  const lockPath = join(xdgState, "skills", ".skill-lock.json");
  if (!existsSync(lockPath)) {
    throw new Error(`lock not found at ${lockPath}`);
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
    version: number;
    skills: Record<string, { skillFolderHash?: string }>;
  };
  process.stdout.write(`lock version: ${String(lock.version)}\n\n`);

  process.stdout.write("| fixture | 1.7.1 实跑 digest | 本机 localeCompare | byte-order 对照 |\n");
  process.stdout.write("| --- | --- | --- | --- |\n");
  for (const [dirName, skillDir] of built) {
    const pinned = lock.skills[dirName]?.skillFolderHash ?? "MISSING";
    process.stdout.write(
      `| ${dirName} | \`${pinned}\` | \`${localeDigest(skillDir)}\` | \`${byteOrderDigest(skillDir)}\` |\n`
    );
  }
  process.stdout.write(`\nruntime kept for inspection: ${runtime}\n`);
}

main();
