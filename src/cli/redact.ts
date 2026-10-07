/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「--redact-paths：list/info CLI 选项（相对路径输出口）」
 * （spec: Field visibility contract — Redacted CLI output Scenario：输出不含绝对路径）
 * 正交意图：
 *   [1] 路径脱敏显示：cwd 之下 → 相对路径；home 之下 → ~/ 前缀；其余 → 末段
 *       （粘贴/日志场景不泄漏机器绝对路径）
 *   [2] 已知路径字段的结构化脱敏（list JSON / info 的 path、canonicalPath），
 *       非 path 语义字段不触碰
 * 妥协声明：无。
 */
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export interface RedactContext {
  cwd?: string;
  home?: string;
}

/** 单值路径脱敏：相对 cwd > ~/home > 末段（恒不输出绝对路径） */
export function redactPathForDisplay(pathValue: string, context: RedactContext = {}): string {
  if (!isAbsolute(pathValue)) return pathValue;
  const cwd = resolve(context.cwd ?? process.cwd());
  const home = resolve(context.home ?? homedir());
  const abs = resolve(pathValue);
  if (abs === cwd || abs.startsWith(cwd + sep)) return relative(cwd, abs) || ".";
  if (abs === home || abs.startsWith(home + sep)) return `~${abs.slice(home.length)}`;
  return basename(abs);
}

/** list JSON 条目的已知路径字段脱敏（浅拷贝，不改入参） */
export function redactSkillMetadataPaths<
  T extends { path: string; canonicalPath?: string },
>(skill: T, context: RedactContext = {}): T {
  const redacted: T = { ...skill, path: redactPathForDisplay(skill.path, context) };
  if (skill.canonicalPath !== undefined) {
    return { ...redacted, canonicalPath: redactPathForDisplay(skill.canonicalPath, context) };
  }
  return redacted;
}
