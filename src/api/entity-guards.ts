/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「批 4 remove/update/toggle 内核化——物化投影删目录带
 * 自身 revision/inode guard（不符 → GUARD_PROJECTION）；enable 校验 entityRevision；
 * link 投影只 unlink 绝不穿链；外部 live-link ownership 判定」
 * 正交意图：
 *   [1] 投影路径归属判定原语（E4/E6）：link 投影磁盘形态的 dual-form 身份比对
 *       （readlink 原文 resolve + realpath 典范化，macOS /var→/private/var 实证
 *       形态对齐）——unlink/remove/toggle 的「ours vs 换体 vs external」三分类依据
 *   [2] 物化副本自身 guard（spec: Ownership-first removal「the copy's own
 *       revision/inode guard」）：hash（copyHash ?? entityRevision 回退）+ inode
 *       双判据；任一不符 = GUARD_PROJECTION（换体拒删/拒改路径不动）
 * 妥协声明：本文件是 entity 内核家族（toggle/remove/update）的共享判定层，不做
 * IO mutation；hash 读取失败按 guard 不符保守拒绝（词表核对表 §2：守卫读取失败
 * 并入 GUARD_ENTITY/GUARD_PROJECTION 两态）。
 */
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import type { Stats } from "node:fs";
import { resolve } from "node:path";

import { computeSkillFolderHash } from "../core/folder-hash.js";

export function lstatSafe(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

export function readlinkSafe(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

export function realpathSafe(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * link 投影归属判定（dual-form）：symlink 的 readlink 原文经 resolve 展开（相对
 * 目标按链接父目录归一）或 realpath 典范化后与实体路径一致 = ours。断链（realpath
 * 失败）时仅按 readlink 原文 resolve 形态比对——链文本仍指向实体 = 归我们处置。
 */
export function symlinkTargetsEntity(linkPath: string, entityPath: string): boolean {
  const raw = readlinkSafe(linkPath);
  if (raw === null) return false;
  const parent = linkPath.slice(0, linkPath.lastIndexOf("/") + 1) || "/";
  if (resolve(parent, raw) === resolve(entityPath)) return true;
  const linkReal = realpathSafe(linkPath);
  const entityReal = realpathSafe(entityPath);
  return linkReal !== null && entityReal !== null && linkReal === entityReal;
}

/**
 * 物化副本自身 guard（hash + inode）：expected = copyHash（禁用/重物化后随 copy
 * 刷新）回退 entityRevision（批 3 记录）；copyIno 已记录时不符即换体（同内容换目录
 * 也拒）。hash 读取失败 = guard 不符（保守，绝不静默当作 ours 处置）。
 */
export async function materializedCopyGuard(
  record: {
    entityRevision: string;
    copyHash?: string | undefined;
    copyIno?: number | undefined;
  },
  projPath: string,
  st: Stats
): Promise<{ ok: boolean; expected: string; actual?: string; reason?: string }> {
  if (record.copyIno !== undefined && st.ino !== record.copyIno) {
    return {
      ok: false,
      expected: record.copyHash ?? record.entityRevision,
      reason: `inode changed (recorded ${record.copyIno}, on disk ${st.ino})`,
    };
  }
  const expected = record.copyHash ?? record.entityRevision;
  let actual: string;
  try {
    actual = await computeSkillFolderHash(projPath);
  } catch (error) {
    return {
      ok: false,
      expected,
      reason: `copy hash unreadable (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  return actual === expected ? { ok: true, expected, actual } : { ok: false, expected, actual };
}
