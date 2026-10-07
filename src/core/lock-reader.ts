/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「npm lock reader：raw passthrough（未知字段保留往返）、unknown version 只读降级拒当空」
 * 正交意图：
 *   [1] npm:skills `.skill-lock.json` 只读 provenance 面（spec: Layered single
 *       writers——ccski 绝不写该文件，唯一写入者是 skills CLI）
 *   [2] raw passthrough：parse 保留全部未知字段，序列化往返无损（G0 parity p6 钉值）
 *   [3] 未知 version → 只读 opaque view（LOCK_VERSION_UNSUPPORTED），不得误当
 *       可替换的空 lock
 * 妥协声明：已知条目字段类型不符时丢弃该条目（集合读取丢弃不兼容条目法则）；
 * 损坏 JSON 投影为 invalid 而非空 lock——spec 未给损坏 lock 词表码，不盗用
 * LOCK_VERSION_UNSUPPORTED。
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { CcskiError } from "../types/errors.js";

/** npm:skills lock 文件名（`$XDG_STATE_HOME/skills/` 或 `~/.agents/` 下） */
export const SKILL_LOCK_FILENAME = ".skill-lock.json";

/** skills@1.7.1 lock 版本（G0 parity 收据钉值）；其余版本一律 opaque 降级 */
export const SKILL_LOCK_SUPPORTED_VERSION = 3;

/** lock 条目中允许离开内核的 provenance 子集（spec: Field visibility contract） */
export interface LockSkillProvenance {
  /** 条目键 = 逻辑技能名 */
  name: string;
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;
  updatedAt?: string;
}

export type LockReadResult =
  | {
      kind: "ok";
      version: typeof SKILL_LOCK_SUPPORTED_VERSION;
      /** 完整原始解析结果（未知字段原样保留；只读） */
      raw: Record<string, unknown>;
      skills: LockSkillProvenance[];
    }
  | {
      kind: "unsupported";
      code: "LOCK_VERSION_UNSUPPORTED";
      /** 不可解读的 lock：没有 skills 投影，不得用于任何 mutation、不得视为空 lock */
      observedVersion: unknown;
      raw: Record<string, unknown>;
    }
  /** 文件不存在（宿主尚未用 skills CLI 装过任何技能） */
  | { kind: "absent" }
  /** 存在但不是可解析的 JSON 对象；不盗用版本码 */
  | { kind: "invalid"; reason: string };

/** lock 文件 IO 故障（非 ENOENT）的硬失败 */
export class LockReadError extends CcskiError {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LockReadError";
  }
}

// 默认 strip 语义：投影只携带已知 provenance 字段；未知字段仅经 raw 透传，
// 不混入子集（否则子集泄漏为全集）。已知字段类型不符 → 整条丢弃。
const lockEntryProvenanceSchema = z.object({
  source: z.string().optional(),
  sourceType: z.string().optional(),
  sourceUrl: z.string().optional(),
  skillPath: z.string().optional(),
  skillFolderHash: z.string().optional(),
  updatedAt: z.string().optional(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

/**
 * 只读读取 npm lock。raw passthrough：`raw` 即 JSON.parse 的原对象，未知字段
 * （顶层与条目内）原样保留，序列化往返无损（tests/lock-reader.test.ts 钉）。
 * unknown version → kind:"unsupported" + LOCK_VERSION_UNSUPPORTED，不解释条目。
 */
export async function readSkillLock(lockPath: string): Promise<LockReadResult> {
  let text: string;
  try {
    text = await readFile(lockPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "absent" };
    throw new LockReadError(`failed to read skill lock ${lockPath}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: "invalid", reason: `lock is not valid JSON (${detail})` };
  }
  if (!isRecord(parsed)) {
    return { kind: "invalid", reason: "lock payload is not a JSON object" };
  }

  if (parsed.version !== SKILL_LOCK_SUPPORTED_VERSION) {
    return {
      kind: "unsupported",
      code: "LOCK_VERSION_UNSUPPORTED",
      observedVersion: parsed.version,
      raw: parsed,
    };
  }

  const rawSkills = parsed.skills;
  if (!isRecord(rawSkills)) {
    return { kind: "invalid", reason: "lock v3 payload has no skills record" };
  }
  const skills: LockSkillProvenance[] = [];
  for (const [name, entry] of Object.entries(rawSkills)) {
    if (!isRecord(entry)) continue;
    const provenance = lockEntryProvenanceSchema.safeParse(entry);
    if (!provenance.success) continue; // 集合读取：丢弃不兼容条目
    const projected: LockSkillProvenance = { name };
    for (const key of [
      "source",
      "sourceType",
      "sourceUrl",
      "skillPath",
      "skillFolderHash",
      "updatedAt",
    ] as const) {
      const value = provenance.data[key];
      if (typeof value === "string") projected[key] = value;
    }
    skills.push(projected);
  }
  return { kind: "ok", version: SKILL_LOCK_SUPPORTED_VERSION, raw: parsed, skills };
}
