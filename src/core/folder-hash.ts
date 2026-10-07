/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「folder-hash 单源实现（按批 0 收据）+ 对宿主导出」
 * 正交意图：
 *   [1] skills@1.7.1 兼容的技能目录 hash（唯一公开消费接口，G0 定名
 *       computeSkillFolderHash，收据 openspec/changes/store-link-kernel/g0/folder-hash-receipt.md §4）
 *   [2] 算法语义冻结：localeCompare（默认 locale）排序的相对路径(UTF-8)+文件字节
 *       流式 sha256；仅 regular files；任意深度跳过 .git/node_modules；symlink 不进 hash
 * 妥协声明：排序语义直接镜像 npm 的 `localeCompare()` 默认 locale 行为——parity 优先于
 * 确定性（收据 §1 要点 1：byte-order 变体对 F1-F7 全部产生不同 digest）。localeCompare
 * 是 locale 敏感的；F1-F7 fixture digest 表（tests/folder-hash.test.ts）是跨 Node 构建
 * （full-icu/small-icu）的守卫：任何环境产生不同 digest 即测试失败，不得静默漂移。
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * 算法代际标注：期望 digest 由 skills@1.7.1 实跑钉死（收据 §2/§3）。
 * npm 升级重跑 parity 时随新版本更新。
 */
export const SKILL_FOLDER_HASH_VERSION = "1.7.1";

interface CollectedFile {
  relativePath: string;
  content: Buffer;
}

/**
 * 与 npm 1.7.1 `collectFiles` 逐行同构：Dirent 为 lstat 语义——symlink 既非
 * isFile 也非 isDirectory，跳过、不跟随；目录排除集仅 `.git` 与 `node_modules`
 * （任意深度、按目录名精确匹配；与安装 copy 的排除集是两套规则，收据 §1 要点 3）。
 */
async function collectFiles(
  baseDir: string,
  currentDir: string,
  results: CollectedFile[]
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        const relativePath = relative(baseDir, fullPath).split("\\").join("/");
        results.push({ relativePath, content });
      }
    })
  );
}

/**
 * skills@1.7.1 兼容的技能目录 hash：localeCompare 排序的相对路径(UTF-8) +
 * 文件字节流式 sha256；仅 regular files；任意深度跳过 .git 与 node_modules；
 * symlink 不进 hash。期望值由 g0/folder-hash-receipt.md F1-F7 fixture 钉死。
 * 入参为绝对路径；返回 hex digest（无 `sha256:` 前缀，与 lock `skillFolderHash`
 * 字段取值形态一致）。hash 输入树是安装时的源树，不是安装后的目标目录。
 */
export async function computeSkillFolderHash(skillDir: string): Promise<string> {
  const files: CollectedFile[] = [];
  await collectFiles(skillDir, skillDir, files);
  // 镜像 npm：`files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))`，
  // 无显式 locale。等价类并列（如仅大小写不同的路径）继承 Array.sort 的稳定序
  // （V8 下 = 收集序），与 npm 在同一运行时的行为一致。
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath); // string → UTF-8 bytes
    hash.update(file.content); // 原始文件字节
  }
  return hash.digest("hex");
}
