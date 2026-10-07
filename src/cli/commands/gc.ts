/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「gc --dry-run（不自动删）——提案清单不自动删」（批 5
 * tasks.md:44；design G0 回流裁决 #2：3.0 只交付 gc --dry-run）——CLI 面桥接
 * src/api/gc.ts 内核契约
 * 正交意图：
 *   [1] --dry-run 必选语义：缺省即打印 DRY_RUN_REQUIRED 指路并 exit 1（CLI 与内核
 *       同一 typed 拒绝面，不给「看起来像执行了」的假象）
 * 妥协声明：无。
 */
import type { ArgumentsCamelCase } from "yargs";

import { gcPropose } from "../../api/gc.js";
import { dim, error, heading, info, setColorEnabled, tone } from "../../utils/format.js";

export interface GcArgs {
  global?: boolean;
  dryRun?: boolean;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  userDir?: string;
}

export async function gcCommand(argv: ArgumentsCamelCase<GcArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const scope = argv.global === true ? "global" : "project";
  const userDir = typeof argv.userDir === "string" ? argv.userDir : undefined;

  const result = await gcPropose({
    scope,
    dryRun: argv.dryRun === true,
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

  if (argv.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.clean) {
    console.log(info(`gc (scope: ${result.scope}): clean — no state records need retirement.`));
    return;
  }
  console.log(heading(`gc dry-run proposals (scope: ${result.scope}) — nothing was deleted`));
  for (const proposal of result.proposals) {
    console.log(
      `  ${tone.warning("◦")} retire ${proposal.mode} record "${proposal.logicalName}" (${proposal.folderName}) — root vanished: ${proposal.rootPath}`
    );
  }
  for (const unknown of result.unknownReferences) {
    console.log(`  ${tone.danger("!")} GC_UNKNOWN_REFERENCE: ${unknown.detail}`);
  }
  console.log(
    dim(
      `${result.proposals.length} proposal(s), ${result.unknownReferences.length} unknown-reference warning(s); apply decisions via state repair / remove`
    )
  );
}
