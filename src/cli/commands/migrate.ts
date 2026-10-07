/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「migrate --dry-run（碰撞/hash/目标实体/投影计划/影响
 * roots）+ 执行」（批 5 tasks.md:43）——CLI 面桥接 src/api/migrate.ts 内核契约
 * 正交意图：
 *   [1] --dry-run 默认安全面：无 --execute 时恒为 dry-run（计划输出 + 退出码 0），
 *       执行必须显式 --execute（防误迁移）
 *   [2] 默认 roots 注入：CLI 层以检测到的 agent 注册表根为投影转换扫描面（SDK 层
 *       恒显式 roots）；--root 可追加
 * 妥协声明：无。
 */
import { readFileSync } from "node:fs";
import type { ArgumentsCamelCase } from "yargs";

import { migrateLegacyEntries, type MigratePlan } from "../../api/migrate.js";
import { dim, error, heading, info, setColorEnabled, tone, warn } from "../../utils/format.js";
import { existingRegistryRoots } from "../agents.js";

export interface MigrateArgs {
  global?: boolean;
  dryRun?: boolean;
  execute?: boolean;
  root?: string[];
  /** dry-run 计划 JSON 回传（expected hash 守卫基准 = 计划值） */
  plan?: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  userDir?: string;
}

export async function migrateCommand(argv: ArgumentsCamelCase<MigrateArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") setColorEnabled(false);
  if (argv.color) setColorEnabled(true);

  const scope = argv.global === true ? "global" : "project";
  const userDir = typeof argv.userDir === "string" ? argv.userDir : undefined;
  const explicitRoots = (argv.root ?? []).filter((value) => value.trim().length > 0);
  const defaultRoots =
    explicitRoots.length > 0
      ? []
      : existingRegistryRoots({ scope, ...(userDir !== undefined ? { userDir } : {}) });
  const roots = [...new Set([...defaultRoots, ...explicitRoots])];

  let plan: MigratePlan | undefined;
  if (typeof argv.plan === "string" && argv.plan.length > 0) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(argv.plan, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as MigratePlan).dryRun !== true ||
        !Array.isArray((parsed as MigratePlan).targetEntities)
      ) {
        throw new Error("not a migrate dry-run plan payload");
      }
      plan = parsed as MigratePlan;
    } catch (err) {
      console.error(
        error(
          `--plan is not a migrate dry-run plan: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      process.exitCode = 1;
      return;
    }
  }

  const result = await migrateLegacyEntries({
    scope,
    dryRun: argv.execute !== true,
    roots,
    ...(plan !== undefined ? { plan } : {}),
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

  if (result.dryRun) {
    if (argv.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(
      info(`Dry-run plan (scope: ${result.scope}) — no writes; re-run with --execute to apply\n`)
    );
    console.log(heading(`Target entities (${result.targetEntities.length}):`));
    for (const candidate of result.targetEntities) {
      console.log(
        `  ${tone.success("●")} ${candidate.logicalName} [${candidate.folderName}${
          candidate.sanitizeTarget !== candidate.folderName ? ` → ${candidate.sanitizeTarget}` : ""
        }] hash ${candidate.hash.slice(0, 12)} @ ${candidate.path}`
      );
    }
    console.log(heading(`Planned projections (${result.plannedProjections.length}):`));
    for (const candidate of result.plannedProjections) {
      console.log(
        `  ${tone.info("→")} ${candidate.folderName} copy → link @ ${candidate.root} (hash ${candidate.hash.slice(0, 12)})`
      );
    }
    console.log(heading(`Collisions (${result.collisions.length}):`));
    for (const collision of result.collisions) {
      console.log(
        `  ${tone.danger("✗")} [${collision.code}] ${collision.path}: ${collision.message}`
      );
    }
    console.log(dim(`Affected roots: ${result.affectedRoots.join(", ") || "(none)"}`));
    return;
  }

  if (argv.json === true) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(heading(`Migrated (scope: ${result.scope})`));
    for (const entry of result.adopted) {
      console.log(
        `  ${tone.success("●")} adopted entity ${entry.logicalName} → ${entry.entityPath} (rev ${entry.revision.slice(0, 12)})`
      );
    }
    for (const entry of result.converted) {
      console.log(
        `  ${tone.info("→")} converted ${entry.folderName} @ ${entry.root} → ${entry.mode}${entry.reason ? ` (${entry.reason})` : ""}`
      );
    }
    for (const conflict of result.conflicts) {
      console.log(`  ${tone.danger("✗")} [${conflict.code}] ${conflict.path}: ${conflict.message}`);
    }
    for (const warning of result.warnings) {
      console.log(warn(`  ! ${warning}`));
    }
    console.log(
      dim(
        `${result.adopted.length} adopted, ${result.converted.length} converted, ${result.conflicts.length} conflict(s); journal: ${result.journalPath}`
      )
    );
  }
  if (result.conflicts.length > 0) process.exitCode = 1;
}
