/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「CLI 命令名保留、内部切换内核 API（语义破坏在 3.0 边界
 * 内）」+「CLI 投影默认全集：detected + universal（registry 可见性过滤）+ no-detection
 * --yes registry 退化 + 逐 agent 部分成功 per-agent 收据 + 无 global 安装能力 agent
 * 失败条目——对齐 g0 parity 钉值」（批 5 tasks.md:43/45；2.x installSkills 入口移除）
 * 正交意图：
 *   [1] `install <source>` 内核化：ensureEntity（--force → 显式 replace，取 NAME_EXISTS
 *       载荷的 expectedRevision）+ projectEntity（agent 注册表目标集去重 roots，一次
 *       调用逐根收据）+ per-agent 收据投影（universal-class 共享 canonical → entity-
 *       local；无 global 能力 → typed 失败条目）
 *   [2] 目标集分支（cli/agents.ts）：显式 --agent / '*' / detected+universal /
 *       no-detection --yes registry 退化 / 无检测无 --yes typed 拒绝
 *   [3] dry-run 预览：零写入（目标集 + 实体计划 + 逐 agent 计划收据）
 *   [4] workflow 安装半区（无 source）原样保留（workflow-install.ts，3.0 边界外）
 * 妥协声明：3.0 源面 = 单技能本地目录（含 SKILL.md）；git/marketplace 物化入口退役
 * （宿主 repository install 走 host change 的 entity/projection API——tasks.md 批 6），
 * typed 错误如实指路；npm 式「JSON 只报失败条目」的不诚实形态不照抄（部分成功在
 * ccski JSON 全量表达）。
 */
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import type { ArgumentsCamelCase } from "yargs";

import { ensureEntity, projectEntity } from "../../api/entity.js";
import type { AgentInstructionScope } from "../../api/types.js";
import { dim, error, heading, info, setColorEnabled, tone } from "../../utils/format.js";
import {
  AgentTargetError,
  resolveAgentTargets,
  type AgentTarget,
  type ResolvedAgentTargets,
} from "../agents.js";
import { installWorkflowCommand } from "./install-workflow.js";

export interface InstallArgs {
  source?: string;
  /** 技能安装目标 agent（repeatable；"*" = 全 registry） */
  agent?: string[];
  /** global scope（缺省 = project scope，对齐 npm:skills 语义） */
  global?: boolean;
  yes?: boolean;
  force?: boolean;
  override?: boolean;
  dryRun?: boolean;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  userDir?: string;
  /** workflow 安装（无 source）专用 flags */
  agents?: string[];
  scope?: AgentInstructionScope;
  user?: boolean;
  project?: boolean;
  outDir?: string[];
  outScope?: string[];
  interactive?: boolean;
  all?: boolean;
  include?: string[];
  exclude?: string[];
  disabled?: boolean;
  path?: string;
  mode?: string;
  branch?: string;
  timeout?: number;
}

interface AgentReceipt {
  agent: string;
  label: string;
  root: string | null;
  status:
    | "projected"
    | "unchanged"
    | "entity-local"
    | "failed"
    | "planned-projected"
    | "planned-entity-local"
    | "planned-failed";
  mode?: string;
  reason?: string;
  errorCode?: string;
  error?: string;
}

export async function installCommand(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const positional = Array.isArray(argv._) ? argv._.slice(1).map(String) : [];
  const source = typeof argv.source === "string" ? argv.source : positional.shift();

  if (!source) {
    await installWorkflowCommand(argv as never);
    return;
  }

  const userDir = typeof argv.userDir === "string" ? argv.userDir : undefined;
  const scope = argv.global === true ? "global" : "project";
  const cwd = process.cwd();

  // ---- 源解析（3.0：单技能本地目录）----
  const sourceDir = resolve(source);
  if (/^https?:\/\//i.test(source) || /^git[^.]*@/.test(source) || source.endsWith(".git")) {
    failTyped(
      argv,
      "SOURCE_UNSUPPORTED",
      `git/marketplace sources are retired in 3.0: pass a local skill directory (contains SKILL.md). Git materialization moves to the host's repository install (entity/projection API).`
    );
    return;
  }
  const sourceSt = lstatSync(sourceDir, { throwIfNoEntry: false });
  if (sourceSt === undefined) {
    failTyped(argv, "SOURCE_NOT_FOUND", `source not found: ${sourceDir}`);
    return;
  }
  if (sourceSt.isSymbolicLink() || !sourceSt.isDirectory()) {
    failTyped(
      argv,
      "SOURCE_INVALID",
      `source must be a real directory containing SKILL.md (3.0 installs one skill per invocation): ${sourceDir}`
    );
    return;
  }
  if (!existsSync(resolve(sourceDir, "SKILL.md"))) {
    failTyped(
      argv,
      "SOURCE_INVALID",
      `source has no SKILL.md; 3.0 installs a single skill directory per invocation: ${sourceDir}`
    );
    return;
  }

  // ---- 目标集解析（typed AgentTargetError 面）----
  let resolved: ResolvedAgentTargets;
  try {
    resolved = resolveAgentTargets({
      scope,
      ...(argv.agent !== undefined ? { agents: argv.agent } : {}),
      ...(argv.yes !== undefined ? { yes: argv.yes } : {}),
      ...(userDir !== undefined ? { userDir } : {}),
      cwd,
    });
  } catch (err) {
    if (err instanceof AgentTargetError) {
      failTyped(argv, err.code, err.message);
      return;
    }
    throw err;
  }

  if (argv.dryRun === true) {
    await printDryRun(argv, sourceDir, scope, resolved);
    return;
  }

  // ---- 实体半区：ensureEntity（--force → 显式 replace）----
  const force = argv.force === true || argv.override === true;
  let ensured = await ensureEntity({
    scope,
    source: { dir: sourceDir },
    ...(userDir !== undefined ? { userDir } : {}),
  });
  if (ensured.kind === "error" && ensured.code === "NAME_EXISTS" && force && ensured.existing) {
    ensured = await ensureEntity({
      scope,
      source: { dir: sourceDir },
      replace: { expectedRevision: ensured.existing.expectedRevision },
      ...(userDir !== undefined ? { userDir } : {}),
    });
  }
  if (ensured.kind === "error") {
    failTyped(argv, ensured.code, ensured.message);
    return;
  }

  // ---- 投影半区：capable roots 去重一次调用 + per-agent 收据投影 ----
  const receipts: AgentReceipt[] = [];
  const rootOwners = new Map<string, AgentTarget>();
  const capableRoots: string[] = [];
  for (const target of resolved.targets) {
    if (scope === "global" && !target.canInstallGlobal) {
      receipts.push({
        agent: target.id,
        label: target.label,
        root: null,
        status: "failed",
        errorCode: "NO_GLOBAL_INSTALL",
        error: `${target.label} does not support global skill installation`,
      });
      continue;
    }
    const root = target.root;
    if (root === null) continue;
    if (!rootOwners.has(root)) {
      rootOwners.set(root, target);
      capableRoots.push(root);
    }
  }

  const projected =
    capableRoots.length > 0
      ? await projectEntity({
          scope,
          name: ensured.entity.logicalName,
          roots: capableRoots,
          ...(userDir !== undefined ? { userDir } : {}),
        })
      : null;
  if (projected !== null && projected.kind === "error") {
    failTyped(argv, projected.code, projected.message);
    return;
  }
  interface RootReceiptShape {
    status: string;
    mode?: string;
    reason?: string;
    errorCode?: string;
    error?: string;
  }
  const receiptByRoot = new Map<string, RootReceiptShape>();
  if (projected !== null && projected.kind === "ok") {
    for (const rootResult of projected.results) {
      receiptByRoot.set(rootResult.root, {
        status: rootResult.status,
        ...(rootResult.mode !== undefined ? { mode: rootResult.mode } : {}),
        ...(rootResult.reason !== undefined ? { reason: rootResult.reason } : {}),
        ...(rootResult.errorCode !== undefined ? { errorCode: rootResult.errorCode } : {}),
        ...(rootResult.error !== undefined ? { error: rootResult.error } : {}),
      });
    }
  }

  for (const target of resolved.targets) {
    if (scope === "global" && !target.canInstallGlobal) continue; // 已在失败条目
    const root = target.root;
    if (root === null) continue;
    const rootReceipt = receiptByRoot.get(root);
    if (rootReceipt === undefined) {
      receipts.push({
        agent: target.id,
        label: target.label,
        root,
        status: "failed",
        errorCode: "IO",
        error: "no projection receipt for target root",
      });
      continue;
    }
    if (rootReceipt.status === "failed") {
      receipts.push({
        agent: target.id,
        label: target.label,
        root,
        status: "failed",
        ...(rootReceipt.mode !== undefined ? { mode: rootReceipt.mode } : {}),
        ...(rootReceipt.errorCode !== undefined ? { errorCode: rootReceipt.errorCode } : {}),
        ...(rootReceipt.error !== undefined ? { error: rootReceipt.error } : {}),
      });
      continue;
    }
    if (rootReceipt.mode === "entity-local") {
      receipts.push({
        agent: target.id,
        label: target.label,
        root,
        status: "entity-local",
        mode: "entity-local",
        ...(rootReceipt.reason !== undefined ? { reason: rootReceipt.reason } : {}),
      });
      continue;
    }
    receipts.push({
      agent: target.id,
      label: target.label,
      root,
      status: rootReceipt.status === "projected" ? "projected" : "unchanged",
      ...(rootReceipt.mode !== undefined ? { mode: rootReceipt.mode } : {}),
      ...(rootReceipt.reason !== undefined ? { reason: rootReceipt.reason } : {}),
    });
  }

  const failed = receipts.filter((r) => r.status === "failed").length;
  const projectedCount = receipts.filter((r) => r.status === "projected").length;
  const unchangedCount = receipts.filter((r) => r.status === "unchanged").length;
  const entityLocalCount = receipts.filter((r) => r.status === "entity-local").length;

  const payload = {
    source: sourceDir,
    scope,
    dryRun: false,
    branch: resolved.branch,
    detected: resolved.detected,
    entity: { ...ensured.entity, status: ensured.status },
    targets: receipts,
    projected: projectedCount,
    unchanged: unchangedCount,
    entityLocal: entityLocalCount,
    failed,
    lockSyncPending: true,
  };

  if (argv.json === true) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printInstallResult(payload);
  }
  // 部分成功是常态（receipt p4）：失败条目 exit 1，不回滚其余 agent
  if (failed > 0) process.exitCode = 1;
}

function failTyped(argv: ArgumentsCamelCase<InstallArgs>, code: string, message: string): void {
  if (argv.json === true) {
    console.log(JSON.stringify({ kind: "error", code, message }, null, 2));
  } else {
    console.error(error(`${code}: ${message}`));
  }
  process.exitCode = 1;
}

async function printDryRun(
  argv: ArgumentsCamelCase<InstallArgs>,
  sourceDir: string,
  scope: "global" | "project",
  resolved: ResolvedAgentTargets
): Promise<void> {
  const receipts: AgentReceipt[] = resolved.targets.map((target) => {
    if (scope === "global" && !target.canInstallGlobal) {
      return {
        agent: target.id,
        label: target.label,
        root: null,
        status: "planned-failed",
        errorCode: "NO_GLOBAL_INSTALL",
        error: `${target.label} does not support global skill installation`,
      };
    }
    return {
      agent: target.id,
      label: target.label,
      root: target.root,
      status: target.universalClass ? "planned-entity-local" : "planned-projected",
    };
  });
  const payload = {
    source: sourceDir,
    scope,
    dryRun: true,
    branch: resolved.branch,
    detected: resolved.detected,
    targets: receipts,
    projected: receipts.filter((r) => r.status === "planned-projected").length,
    entityLocal: receipts.filter((r) => r.status === "planned-entity-local").length,
    failed: receipts.filter((r) => r.status === "planned-failed").length,
  };
  if (argv.json === true) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(info("Dry-run mode: showing the planned projection (no writes)\n"));
  console.log(heading(`Scope: ${scope}`));
  console.log(
    dim(
      `Target-set branch: ${payload.branch}${payload.detected.length ? ` (detected: ${payload.detected.join(", ")})` : ""}`
    )
  );
  console.log(heading("Per-agent plan:"));
  for (const receipt of receipts) {
    const mark =
      receipt.status === "planned-failed"
        ? tone.danger("✗")
        : receipt.status === "planned-entity-local"
          ? tone.info("●")
          : tone.success("→");
    console.log(
      `  ${mark} ${receipt.agent}${receipt.root ? ` → ${receipt.root}` : dim(" (no global capability)")}`
    );
  }
  console.log(
    `\n${dim(`${payload.projected} link projection(s), ${payload.entityLocal} entity-local, ${payload.failed} failure entr(ies)`)}`
  );
}

interface InstallResultPayload {
  source: string;
  scope: string;
  branch: string;
  detected: string[];
  entity: {
    logicalName: string;
    folderName: string;
    path: string;
    revision: string;
    status: string;
  };
  targets: AgentReceipt[];
  projected: number;
  unchanged: number;
  entityLocal: number;
  failed: number;
}

function printInstallResult(payload: InstallResultPayload): void {
  const status =
    payload.entity.status === "replaced"
      ? tone.warning("replaced")
      : tone.success(payload.entity.status);
  console.log(heading(`Installed: ${payload.entity.logicalName}`));
  console.log(`  entity: ${payload.entity.path} ${status}`);
  console.log(
    dim(
      `  target-set branch: ${payload.branch}${payload.detected.length ? ` (detected: ${payload.detected.join(", ")})` : ""}`
    )
  );
  for (const receipt of payload.targets) {
    switch (receipt.status) {
      case "projected":
        console.log(
          `  ${tone.success("✓")} ${receipt.agent}: ${receipt.mode ?? "link"} → ${receipt.root}`
        );
        break;
      case "unchanged":
        console.log(`  ${dim("○")} ${receipt.agent}: unchanged (${receipt.root})`);
        break;
      case "entity-local":
        console.log(`  ${tone.info("●")} ${receipt.agent}: entity-local (shared canonical root)`);
        break;
      case "failed":
        console.log(
          `  ${tone.danger("✗")} ${receipt.agent}: ${receipt.error ?? receipt.errorCode ?? "failed"}`
        );
        break;
    }
  }
  const parts: string[] = [];
  if (payload.projected > 0) parts.push(tone.success(`${payload.projected} projected`));
  if (payload.unchanged > 0) parts.push(dim(`${payload.unchanged} unchanged`));
  if (payload.entityLocal > 0) parts.push(tone.info(`${payload.entityLocal} entity-local`));
  if (payload.failed > 0) parts.push(tone.danger(`${payload.failed} failed`));
  console.log(`Summary: ${parts.join(", ")}`);
  console.log(dim("npm lock not written (lockSyncPending); ccski never writes .skill-lock.json"));
}
