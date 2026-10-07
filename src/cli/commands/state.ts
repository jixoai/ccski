/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「state repair（diff+confirm+备份+幂等）」（批 5
 * tasks.md:44）——CLI 面桥接 src/api/repair.ts 内核契约；挂载为 `ccski state repair`
 * 正交意图：
 *   [1] diff 报告恒打印（含 REPAIR_CONFIRM_REQUIRED 路径——spec: print a diff，
 *       then fail typed）；--confirm 才执行修复
 * 妥协声明：无。
 */
import type { ArgumentsCamelCase } from "yargs";

import { repairState } from "../../api/repair.js";
import { dim, error, heading, info, setColorEnabled, tone, warn } from "../../utils/format.js";

export interface StateRepairArgs {
  global?: boolean;
  confirm?: boolean;
  root?: string[];
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  userDir?: string;
}

export async function stateRepairCommand(argv: ArgumentsCamelCase<StateRepairArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const scope = argv.global === true ? "global" : "project";
  const userDir = typeof argv.userDir === "string" ? argv.userDir : undefined;
  const roots = (argv.root ?? []).filter((value) => value.trim().length > 0);

  const result = await repairState({
    scope,
    confirm: argv.confirm === true,
    ...(roots.length > 0 ? { roots } : {}),
    ...(userDir !== undefined ? { userDir } : {}),
  });

  if (result.kind === "error") {
    if (argv.json === true)
      console.log(
        JSON.stringify({ kind: "error", code: result.code, message: result.message }, null, 2)
      );
    else console.error(error(`${result.code}: ${result.message}`));
    process.exitCode = 1;
    return;
  }

  if (result.kind === "confirm-required") {
    printDiff(result.diff, argv);
    if (argv.json === true) {
      console.log(
        JSON.stringify(
          {
            kind: "confirm-required",
            code: result.code,
            diff: result.diff,
            repairable: result.repairable,
          },
          null,
          2
        )
      );
    } else {
      console.error(
        error(
          `REPAIR_CONFIRM_REQUIRED: ${result.repairable} repair(s) pending; re-run with --confirm to apply`
        )
      );
    }
    process.exitCode = 1;
    return;
  }

  if (argv.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printDiff(result.diff, argv);
  if (result.clean) {
    console.log(
      info(`state repair (scope: ${result.scope}): clean — nothing to repair (idempotent no-op).`)
    );
    return;
  }
  for (const warning of result.warnings) {
    console.log(warn(`! ${warning}`));
  }
  console.log(
    `${tone.success("✓")} repaired ${result.repaired} item(s); pre-repair state backup: ${result.backupPath ?? "(none)"}`
  );
}

function printDiff(
  diff: Array<{ code: string; path: string; detail: string; action: string; fixed?: boolean }>,
  argv: ArgumentsCamelCase<StateRepairArgs>
): void {
  if (argv.json === true) return; // JSON 面已结构化输出
  if (diff.length === 0) {
    return;
  }
  console.log(heading("Scan vs sidecar diff:"));
  for (const item of diff) {
    const mark =
      item.fixed === true
        ? tone.success("✓")
        : item.action === "none"
          ? dim("·")
          : tone.warning("◦");
    console.log(`  ${mark} [${item.code}] ${item.path}`);
    console.log(dim(`      ${item.detail}`));
  }
}
