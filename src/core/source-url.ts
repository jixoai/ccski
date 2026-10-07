/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「sourceUrl 统一 sanitizer（credentials/userinfo/query
 * strings 剥离，离开 kernel 前），覆盖 entity.ts/entity-update.ts/lock-reader.ts
 * 的保存与投影两向 + 三类输入测试」（spec: Field visibility contract — Source URL
 * sanitization Scenario）
 * 正交意图：
 *   [1] 离开内核前的 provenance sourceUrl 清洗：userinfo/credentials 与 query
 *       strings（含 fragment）剥离，只留 sanitized origin URL
 *   [2] 非 URL 形态保守处理：可解析 URL 走 URL 语义；scp 式 git remote
 *       （user@host:path）剥 user@；其余（本地路径等）原样返回
 * 妥协声明：无。
 */

/**
 * 规范化 provenance sourceUrl：剥离 userinfo（`user:pass@`）与 query/fragment。
 * 幂等：已清洗的 URL 原样返回。保存侧（ensureEntity/updateEntity provenance）
 * 与投影侧（lock-reader provenance 子集、entity snapshot）共用本函数。
 */
export function sanitizeSourceUrl(raw: string): string {
  if (raw.length === 0) return raw;
  try {
    const url = new URL(raw);
    if (url.username !== "") url.username = "";
    if (url.password !== "") url.password = "";
    if (url.search !== "") url.search = "";
    if (url.hash !== "") url.hash = "";
    return url.toString();
  } catch {
    // 非 scheme URL：scp 式 git remote（user@host:path）剥 userinfo；其余原样
    const scp = /^([^/@\s]+)@([A-Za-z0-9._-]+:\S+)$/.exec(raw);
    if (scp !== null && scp[2] !== undefined) return scp[2];
    return raw;
  }
}
