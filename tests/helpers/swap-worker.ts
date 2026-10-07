/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「R5 崩溃窗收据：replace/update 中途崩溃（SIGKILL 注入或
 * 等价确定性构造）→ backup 回滚或可恢复路径 + state 一致性断言」（G4 门）
 * 正交意图：
 *   [1] G4 跨进程崩溃 worker：由测试以 tsx 拉起的独立进程，在实体稳路径换新的两个
 *       崩溃窗定点对自身 SIGKILL——mid-swap（旧实体已入 backup、新实体未上位）与
 *       post-swap（新实体已上位、state 未刷新），stdout/receipt 文件回执窗口到达
 *   [2] 崩溃点组合生产原语（stageEntityCopy + 与 swapEntityIntoPlace 逐步镜像的
 *       backup/staging rename + writeResidueMarker），生产代码零测试钩子（与批 1
 *       state-worker 同法：生产零钩子，窗口由原语组合构造）
 * 妥协声明：swapEntityIntoPlace 的两次 rename 之间无暂停点，进程内无法在不加生产
 * 钩子的前提下于窗口内自杀——本 worker 以逐行镜像的生产原语序列在窗口内 SIGKILL，
 * 镜像一致性由 R4 回滚测试（真 swapEntityIntoPlace 失败路径）与崩溃后磁盘形态断言
 * 双面钉住。SIGKILL 自杀 = 真信号真进程（非 mock）。
 */
import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stageEntityCopy } from "../../src/api/entity.js";
import { writeResidueMarker } from "../../src/core/entity-state.js";

interface CrashArgs {
  /** 实体根（backup/staging 的同 scope 容器） */
  entityRoot: string;
  /** 实体稳路径 */
  entityPath: string;
  /** 新内容源目录 */
  sourceDir: string;
  /** 窗口到达回执（写完即 SIGKILL，父进程据此确认窗口已真实到达） */
  receiptFile: string;
}

function fail(message: string): never {
  process.stderr.write(`swap-worker failure: ${message}\n`);
  process.exit(1);
}

/**
 * 与 src/api/entity.ts swapEntityIntoPlace 的窗口序列逐步镜像：
 *   backup = mkdtempSync(entityRoot/.ccski-backup-*) → rename(entityPath → backup)
 *   → writeResidueMarker(backup) →【mid-swap 窗】→ rename(staging → entityPath)
 *   →【post-swap 窗（backup 尚未删除、state 未刷新）】
 */
async function runCrash(args: CrashArgs, window: "mid-swap" | "post-swap"): Promise<void> {
  // stageEntityCopy 已内置「复制完成即摘 marker」语义（批 4 修正）；worker 不再重复
  // 标记——崩溃后 staging 残留的无 marker 形态与生产窗口真实一致（清扫保守保留）。
  const staging = stageEntityCopy(args.sourceDir, args.entityRoot);
  const backup = mkdtempSync(join(args.entityRoot, ".ccski-backup-"));
  renameSync(args.entityPath, backup);
  writeResidueMarker(backup, "backup");

  if (window === "mid-swap") {
    writeFileSync(args.receiptFile, JSON.stringify({ window, backup, staging }));
    process.kill(process.pid, "SIGKILL");
    return; // SIGKILL 不可拦截；此行仅为类型收窄
  }
  renameSync(staging, args.entityPath);
  writeFileSync(args.receiptFile, JSON.stringify({ window, backup, staging: null }));
  process.kill(process.pid, "SIGKILL");
}

async function main(): Promise<void> {
  const job = process.argv[2];
  const rawArgs = process.argv[3];
  if (job === undefined || rawArgs === undefined) fail("usage: swap-worker <job> <json-args>");
  const args: unknown = JSON.parse(rawArgs);
  if (job !== "crash-mid-swap" && job !== "crash-post-swap") fail(`unknown job: ${job}`);
  await runCrash(args as CrashArgs, job === "crash-mid-swap" ? "mid-swap" : "post-swap");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
