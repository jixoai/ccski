/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「宿主 revision 检查与内核删除之间存在数据丢失竞态……
 * 删除内核需绑定磁盘实体 revision，并在退役/物理删除操作中用稳定的文件身份判据
 * （实体目录 inode / SKILL.md fd + fstat）阻止并发换体」（Codex 宿主迁移终审 P0-3）
 * 正交意图：
 *   [1] 实体销毁窗口的身份守卫：pin 实体目录 inode + SKILL.md 持久 fd（O_NOFOLLOW
 *       可用时启用）+ lstat/fstat 交叉复核 + fd 内容 digest——「重算 revision →
 *       物理销毁」窗口内的第二道换体判据（打开后按 fd 身份销毁；Node fs 无 fd 级
 *       rm，身份复核紧邻销毁调用）
 * 妥协声明：dev/ino 在部分平台（win32 旧内核）可能取 0——身份判据弱化但 fd digest
 * 仍有效；「复核通过 → rmSync」之间与 rmSync 自身的微窗口是 Node API 边界（无按
 * fd 销毁），闭合级与物化副本 guard（copyHash/copyIno，entity-guards.ts）同一语义
 * 环——核对记录在 store-link-kernel design.md 终审回流节（2026-10-07 P0-3）。
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

import { lstatSafe } from "./entity-guards.js";

/** 实体身份源文件名（与 entity 记录的安装契约一致：ensureEntity 必经 SKILL.md） */
const SKILL_MD = "SKILL.md";

export interface EntityDiskIdentity {
  /** 实体目录 lstat 身份（换体 = 同路径新 inode） */
  dir: { dev: number; ino: number };
  /** SKILL.md 的 lstat 身份 + pin 时刻 fd 全文 digest（原位改写 = digest 漂移） */
  skillMd: { dev: number; ino: number; digest: string };
}

export type EntityDiskVerifyResult = { ok: true; present: boolean } | { ok: false; reason: string };

export interface EntityDiskGuardHandle {
  readonly identity: EntityDiskIdentity;
  /**
   * 销毁前身份复核：实体目录与身份源仍与 pin 时刻一致（fd 持有的同一文件）。
   * present=false = 路径已消失（无可销毁内容；同名重建会被 inode 比对拦截）。
   */
  verify(entityPath: string): EntityDiskVerifyResult;
  /** 释放 pin 的 fd（幂等） */
  close(): void;
}

export type EntityDiskGuardOpen =
  /** 实体目录不在磁盘（dangling record：无内容可守卫，销毁退化为记录退役） */
  | { kind: "absent" }
  | { kind: "pinned"; handle: EntityDiskGuardHandle }
  | { kind: "refused"; reason: string };

function describeEntry(st: {
  isSymbolicLink(): boolean;
  isFile(): boolean;
  isDirectory(): boolean;
}): string {
  if (st.isSymbolicLink()) return "symbolic link";
  if (st.isFile()) return "regular file";
  if (st.isDirectory()) return "directory";
  return "non-directory entry";
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 通过持久 fd 读全文（复核 digest 用；读的是 fd 绑定的 inode，不受路径换体影响）。
 * 显式 position 从 0 起步：open 时的整读不推进共享文件偏移，verify 复读仍是全文。 */
function readAllFromFd(fd: number): Buffer {
  const chunks: Buffer[] = [];
  const scratch = Buffer.alloc(64 * 1024);
  let position = 0;
  for (;;) {
    const read = readSync(fd, scratch, 0, scratch.length, position);
    if (read === 0) break;
    chunks.push(Buffer.from(scratch.subarray(0, read)));
    position += read;
  }
  return Buffer.concat(chunks);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * 打开实体磁盘守卫：pin 目录 inode + SKILL.md fd 身份与全文 digest。实体路径为
 * symlink/非目录、SKILL.md 缺失/非 regular、open 或 lstat↔fstat 交叉复核不符 →
 * refused（换体保守拒绝，路径不动）。O_NOFOLLOW 仅在平台提供时启用；缺失平台
 * （win32）由 lstat(symlink 不跟随) + fstat 交叉复核兜底同一判据。
 */
export function openEntityDiskGuard(entityPath: string): EntityDiskGuardOpen {
  const dirSt = lstatSafe(entityPath);
  if (dirSt === null) return { kind: "absent" };
  if (!dirSt.isDirectory()) {
    return {
      kind: "refused",
      reason: `entity path is now a ${describeEntry(dirSt)} (expected the ccski-owned real directory); refusing to treat it as the entity`,
    };
  }
  const skillPath = join(entityPath, SKILL_MD);
  const skillSt = lstatSafe(skillPath);
  if (skillSt === null) {
    return {
      kind: "refused",
      reason: `entity identity file ${SKILL_MD} is missing at ${entityPath}`,
    };
  }
  if (!skillSt.isFile()) {
    return {
      kind: "refused",
      reason: `entity identity file ${skillPath} is now a ${describeEntry(skillSt)} (expected a regular file)`,
    };
  }
  const nofollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let fd: number;
  try {
    fd = openSync(skillPath, constants.O_RDONLY | nofollow);
  } catch (error) {
    return { kind: "refused", reason: `failed to pin ${skillPath} (${detailOf(error)})` };
  }
  try {
    const fdSt = fstatSync(fd);
    if (!fdSt.isFile() || fdSt.dev !== skillSt.dev || fdSt.ino !== skillSt.ino) {
      return {
        kind: "refused",
        reason: `${SKILL_MD} was replaced while pinning (lstat/fstat identity mismatch at ${skillPath})`,
      };
    }
    const identity: EntityDiskIdentity = {
      dir: { dev: dirSt.dev, ino: dirSt.ino },
      skillMd: { dev: skillSt.dev, ino: skillSt.ino, digest: sha256(readAllFromFd(fd)) },
    };
    let closed = false;
    return {
      kind: "pinned",
      handle: {
        identity,
        verify: (path: string) => verifyPinnedIdentity(path, fd, identity),
        close: () => {
          if (closed) return;
          closed = true;
          try {
            closeSync(fd);
          } catch {
            // 幂等释放；fd 异常关闭不反向影响已完成的复核结论
          }
        },
      },
    };
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // 尽力释放
    }
    return {
      kind: "refused",
      reason: `failed to read pinned ${SKILL_MD} at ${skillPath} (${detailOf(error)})`,
    };
  }
}

function verifyPinnedIdentity(
  entityPath: string,
  fd: number,
  identity: EntityDiskIdentity
): EntityDiskVerifyResult {
  const dirSt = lstatSafe(entityPath);
  if (dirSt === null) return { ok: true, present: false };
  if (!dirSt.isDirectory() || dirSt.dev !== identity.dir.dev || dirSt.ino !== identity.dir.ino) {
    return {
      ok: false,
      reason: `entity directory was replaced concurrently (recorded inode ${identity.dir.ino}, on disk ${dirSt.ino})`,
    };
  }
  const skillPath = join(entityPath, SKILL_MD);
  const skillSt = lstatSafe(skillPath);
  if (skillSt === null) {
    return { ok: false, reason: `entity identity file ${SKILL_MD} vanished from ${entityPath}` };
  }
  if (
    !skillSt.isFile() ||
    skillSt.dev !== identity.skillMd.dev ||
    skillSt.ino !== identity.skillMd.ino
  ) {
    return {
      ok: false,
      reason: `entity identity file ${SKILL_MD} was replaced concurrently (recorded inode ${identity.skillMd.ino}, on disk ${skillSt.ino})`,
    };
  }
  let digest: string;
  try {
    digest = sha256(readAllFromFd(fd));
  } catch (error) {
    return { ok: false, reason: `pinned ${SKILL_MD} became unreadable (${detailOf(error)})` };
  }
  if (digest !== identity.skillMd.digest) {
    return {
      ok: false,
      reason: `entity identity file ${SKILL_MD} content changed since the revision recompute (in-place rewrite detected)`,
    };
  }
  return { ok: true, present: true };
}
