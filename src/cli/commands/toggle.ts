/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「CLI 命令名保留、内部切换内核 API（语义破坏在 3.0 边界
 * 内）」——enable/disable 从 .SKILL.md rename（2.x toggleSkills，已移除）切换为
 * toggleEntityProjection 内核面（E3：link 摘链/重建物理语义 + ENTITY_REVISED 闸；
 * 物化 ccski-legacy rename；entity-local skipped）
 * 正交意图：
 *   [1] 名字解析 = state 实体记录（scope 内逻辑名，大小写不敏感）；2.x 的「任意发现
 *       目录 rename」语义退役——legacy 目录先 migrate、外部链先 claim（typed
 *       ENTITY_NOT_FOUND/PROJECTION_NOT_FOUND 如实指路）
 *   [2] 逐投影收据：实体名 × 投影根逐条 toggleEntityProjection；实体零投影 = skipped
 *       如实条目；canonical root 的 entity-local skipped 收据透传
 *   [3] scope 显式化：--global | 缺省 project（kernel SCOPE_REQUIRED 法则在 CLI 层
 *       以默认值满足——CLI 是宿主，默认即显式选择）
 * 妥协声明：--force/--override 退役（内核换体拒绝无 force 旁路——GUARD_PROJECTION
 * 是安全边界不是便利开关）；交互多选保留在实体名集合上（mock 面与 2.x 测试同法）。
 */
import type { ArgumentsCamelCase } from "yargs";
import { toggleEntityProjection } from "../../api/entity-toggle.js";
import {
  parseEntityTable,
  parseProjectionTable,
  resolveScopeBase,
} from "../../core/entity-state.js";
import { emptyState, StateStore } from "../../core/state-store.js";

import { dim, error, setColorEnabled, tone, warn } from "../../utils/format.js";
import { promptMultiSelect } from "../prompts/multiSelect.js";

export interface ToggleArgs {
  names?: string[];
  global?: boolean;
  all?: boolean;
  interactive?: boolean;
  yes?: boolean;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  userDir?: string;
}

export interface ToggleReceipt {
  skill: string;
  path: string | null;
  status: "toggled" | "unchanged" | "skipped" | "failed";
  mode?: string;
  errorCode?: string;
  error?: string;
}

export interface ToggleSummary {
  mode: "enable" | "disable";
  scope: "global" | "project";
  results: ToggleReceipt[];
  succeeded: number;
  skipped: number;
  failed: number;
}

export async function enableCommand(argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  await toggleCommand("enable", argv);
}

export async function disableCommand(argv: ArgumentsCamelCase<ToggleArgs>): Promise<void> {
  await toggleCommand("disable", argv);
}

async function toggleCommand(
  mode: "enable" | "disable",
  argv: ArgumentsCamelCase<ToggleArgs>
): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const scope = argv.global === true ? "global" : "project";
  const userDir = typeof argv.userDir === "string" ? argv.userDir : undefined;
  const scopeBase = resolveScopeBase(scope, {
    ...(userDir !== undefined ? { userDir } : {}),
  });

  // state 实体/投影读取（只读；CLI 名字解析面）
  const store = new StateStore(scopeBase);
  const read = await store.read();
  if (read.kind === "recovery-required") {
    failTyped(argv, "STATE_RECOVERY_REQUIRED", `ccski state degraded read-only: ${read.detail}`);
    return;
  }
  const base = read.kind === "ok" ? read.data : emptyState();
  const entities = parseEntityTable(base.entities).records;
  const projections = parseProjectionTable(base.projections).records;

  const allEntities = [...entities.values()].sort((a, b) =>
    a.logicalName.localeCompare(b.logicalName)
  );

  // ---- 名字解析 ----
  const requested = (argv.names ?? [])
    .flatMap((value) => String(value).split(/[\\/,]/))
    .map((v) => v.trim())
    .filter(Boolean);
  let selectedNames: string[] = [];
  if (argv.all === true) {
    selectedNames = allEntities.map((entity) => entity.logicalName);
  } else if (requested.length > 0) {
    const lowered = new Map(
      allEntities.map((entity) => [entity.logicalName.toLowerCase(), entity.logicalName])
    );
    selectedNames = requested;
    const unknown = requested.filter((name) => !lowered.has(name.toLowerCase()));
    if (unknown.length > 0) {
      failTyped(
        argv,
        "ENTITY_NOT_FOUND",
        `no ccski entity record for: ${unknown.join(", ")} in ${scope} scope (legacy directories migrate first; foreign links claim first)`,
        allEntities.map((entity) => entity.logicalName)
      );
      return;
    }
  } else if (argv.interactive === true) {
    if (allEntities.length === 0) {
      printEmpty(mode, argv);
      return;
    }
    const picked = await promptMultiSelect({
      message: mode === "disable" ? "Select skills to disable" : "Select skills to enable",
      choices: allEntities.map((entity) => ({
        value: entity.logicalName,
        label: entity.logicalName,
        description: entity.folderName,
        checked: false,
      })),
      defaultChecked: false,
    });
    if (!Array.isArray(picked) || picked.length === 0) {
      if (argv.json === true)
        console.log(JSON.stringify({ error: "No skills selected." }, null, 2));
      else console.log(warn("No skills selected."));
      return;
    }
    selectedNames = picked.map(String);
  } else {
    failTyped(
      argv,
      "SELECTION_REQUIRED",
      "provide names, use --all, or enable interactive mode (-i)"
    );
    return;
  }

  if (selectedNames.length === 0) {
    printEmpty(mode, argv);
    return;
  }

  // ---- 逐实体 × 逐投影内核 toggle ----
  const results: ToggleReceipt[] = [];
  for (const name of selectedNames) {
    const entity = allEntities.find((e) => e.logicalName.toLowerCase() === name.toLowerCase());
    if (entity === undefined) {
      results.push({
        skill: name,
        path: null,
        status: "failed",
        errorCode: "ENTITY_NOT_FOUND",
        error: "no entity record",
      });
      continue;
    }
    const entityProjections = [...projections.values()].filter(
      (record) => record.folderName === entity.folderName
    );
    if (entityProjections.length === 0) {
      results.push({
        skill: entity.logicalName,
        path: null,
        status: "skipped",
        errorCode: "NO_PROJECTIONS",
        error: `no projections recorded for "${entity.logicalName}" in ${scope} scope`,
      });
      continue;
    }
    for (const record of entityProjections) {
      const toggled = await toggleEntityProjection({
        scope,
        name: entity.logicalName,
        root: record.rootPath,
        action: mode,
        ...(userDir !== undefined ? { userDir } : {}),
      });
      if (toggled.kind === "error") {
        results.push({
          skill: entity.logicalName,
          path: record.path,
          status: "failed",
          errorCode: toggled.code,
          error: toggled.message,
        });
        continue;
      }
      results.push({
        skill: entity.logicalName,
        path: toggled.path,
        status:
          toggled.status === "toggled"
            ? "toggled"
            : toggled.status === "skipped"
              ? "skipped"
              : "unchanged",
        mode: toggled.mode,
        ...(toggled.convention !== undefined ? { error: `convention:${toggled.convention}` } : {}),
        ...(toggled.detail !== undefined && toggled.status !== "toggled"
          ? { error: toggled.detail }
          : {}),
      });
    }
  }

  const summary: ToggleSummary = {
    mode,
    scope,
    results,
    succeeded: results.filter((r) => r.status === "toggled").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };

  if (argv.json === true) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printToggleSummary(summary);
  }
  if (summary.failed > 0) process.exitCode = 1;
}

function printEmpty(mode: "enable" | "disable", argv: ArgumentsCamelCase<ToggleArgs>): void {
  if (argv.json === true) {
    console.log(
      JSON.stringify({ mode, results: [], succeeded: 0, skipped: 0, failed: 0 }, null, 2)
    );
    return;
  }
  console.log(
    mode === "disable"
      ? warn("No enabled ccski entities found to disable.")
      : warn("No disabled ccski entities found to enable.")
  );
}

function failTyped(
  argv: ArgumentsCamelCase<ToggleArgs>,
  code: string,
  message: string,
  available: string[] = []
): void {
  if (argv.json === true) {
    console.log(
      JSON.stringify(
        { kind: "error", code, message, ...(available.length ? { available } : {}) },
        null,
        2
      )
    );
  } else {
    console.error(error(`${code}: ${message}`));
    if (available.length > 0) console.error(dim(`Available entities: ${available.join(", ")}`));
  }
  process.exitCode = 1;
}

function printToggleSummary(summary: ToggleSummary): void {
  const { mode, results, succeeded, skipped, failed } = summary;

  for (const r of results) {
    let status: string;
    switch (r.status) {
      case "toggled":
        status = tone.success(`✓ ${mode}d`);
        break;
      case "unchanged":
        status = dim(`○ unchanged${r.error ? `: ${r.error}` : ""}`);
        break;
      case "skipped":
        status = dim(`○ skipped${r.error ? `: ${r.error}` : ""}`);
        break;
      case "failed":
        status = tone.danger(`✗ failed [${r.errorCode ?? "IO"}]${r.error ? `: ${r.error}` : ""}`);
        break;
    }
    console.log(`${tone.bold(r.skill)}${r.path ? dim(` (${r.path})`) : ""}: ${status}`);
  }

  console.log();
  const parts: string[] = [];
  if (succeeded > 0) parts.push(tone.success(`${succeeded} ${mode}d`));
  if (skipped > 0) parts.push(dim(`${skipped} skipped`));
  if (failed > 0) parts.push(tone.danger(`${failed} failed`));

  if (parts.length === 0) {
    console.log(warn("No skills were processed."));
  } else {
    console.log(`Summary: ${parts.join(", ")}`);
  }
}
