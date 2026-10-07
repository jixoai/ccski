/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「import --claim（inode+hash 守卫）」（批 5 tasks.md:44）
 * ——CLI 面桥接 src/api/claim.ts 内核契约；缺省 --claim 时 typed 指路（3.0 的 import
 * 只承载收编语义；安装走 install、legacy 收编走 migrate）
 * 正交意图：
 *   [1] 守卫值来源：--inode/--hash 必填（显式优于隐式）；--observe 提供只读观察面
 *       打印当前目标的 inode/hash（供两步 claim 工作流），零 state 变化
 * 妥协声明：无。
 */
import type { ArgumentsCamelCase } from "yargs";

import { claimLink, observeClaimTarget } from "../../api/claim.js";
import { dim, error, heading, info, setColorEnabled } from "../../utils/format.js";

export interface ImportArgs {
  path?: string;
  claim?: boolean;
  inode?: number;
  hash?: string;
  global?: boolean;
  observe?: boolean;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  userDir?: string;
}

export async function importCommand(argv: ArgumentsCamelCase<ImportArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const positional = Array.isArray(argv._) ? argv._.slice(1).map(String) : [];
  const link = typeof argv.path === "string" ? argv.path : positional.shift();
  if (link === undefined || link.length === 0) {
    fail(
      argv,
      "PATH_REQUIRED",
      "usage: ccski import <link-path> --claim --inode <n> --hash <sha256>"
    );
    return;
  }
  const userDir = typeof argv.userDir === "string" ? argv.userDir : undefined;

  if (argv.observe === true) {
    const observed = await observeClaimTarget(link);
    if (observed.kind === "error") {
      fail(argv, observed.code, observed.message);
      return;
    }
    if (argv.json === true) {
      console.log(JSON.stringify(observed, null, 2));
      return;
    }
    console.log(info(`Claim observation (read-only, no state change)`));
    console.log(`  link:   ${observed.link}`);
    console.log(`  target: ${observed.target}`);
    console.log(`  inode:  ${observed.inode}`);
    console.log(`  hash:   ${observed.contentHash}`);
    console.log(dim("re-run with --claim --inode <n> --hash <sha256> to adopt"));
    return;
  }

  if (argv.claim !== true) {
    fail(
      argv,
      "CLAIM_REQUIRED",
      "3.0 import only carries --claim adoption; install skills via `ccski install`, legacy directories via `ccski migrate`"
    );
    return;
  }
  if (typeof argv.inode !== "number" || !Number.isInteger(argv.inode) || argv.inode < 0) {
    fail(
      argv,
      "IO",
      "--inode is required for --claim (non-negative integer observed via --observe)"
    );
    return;
  }
  if (typeof argv.hash !== "string" || !/^[a-f0-9]{64}$/i.test(argv.hash)) {
    fail(argv, "IO", "--hash is required for --claim (64 hex chars observed via --observe)");
    return;
  }

  const result = await claimLink({
    scope: argv.global === true ? "global" : "project",
    link,
    expectedInode: argv.inode,
    expectedHash: argv.hash,
    ...(userDir !== undefined ? { userDir } : {}),
  });

  if (result.kind === "error") {
    const payload = {
      kind: "error",
      code: result.code,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      message: result.message,
    };
    if (argv.json === true) console.log(JSON.stringify(payload, null, 2));
    else
      console.error(
        error(`${result.code}${result.reason ? ` (${result.reason})` : ""}: ${result.message}`)
      );
    process.exitCode = 1;
    return;
  }

  if (argv.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(heading(result.status === "claimed" ? "Claimed" : "Already claimed"));
  console.log(`  entity:     ${result.entity.logicalName} (${result.entity.folderName})`);
  console.log(`  projection: ${result.projection.path}`);
  console.log(
    dim(
      `  verified inode ${result.verified.inode} / hash ${result.verified.contentHash.slice(0, 12)}; state-only change (reversible by state revert)`
    )
  );
}

function fail(argv: ArgumentsCamelCase<ImportArgs>, code: string, message: string): void {
  if (argv.json === true) console.log(JSON.stringify({ kind: "error", code, message }, null, 2));
  else console.error(error(`${code}: ${message}`));
  process.exitCode = 1;
}
