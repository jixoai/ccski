import { statSync } from "node:fs";
import { join } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { getSkillInfo, readSkillContent } from "../../api/info.js";
import type { InfoOptions } from "../../api/types.js";
import { SkillRegistry } from "../../core/registry.js";
import { AmbiguousSkillNameError, SkillNotFoundError } from "../../types/errors.js";
import { applyFilters, parseFilters, type StateFilter } from "../../utils/filters.js";
import { dim, formatBytes, setColorEnabled, success } from "../../utils/format.js";
import { providerNamesFromSkills } from "../../utils/providers.js";
import { resolveSkill } from "../../utils/resolution.js";
import { formatSkillLabel } from "../../utils/skill-id.js";
import { redactPathForDisplay } from "../redact.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface InfoArgs extends InfoOptions {
  /** 显式文档读取面：打印 SKILL.md 全文（与 --json 互斥） */
  full?: boolean;
  json?: boolean;
  /** 粘贴/日志脱敏：输出不含绝对路径（Field visibility contract） */
  redactPaths?: boolean;
  noColor?: boolean;
  color?: boolean;
}

export async function infoCommand(argv: ArgumentsCamelCase<InfoArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }
  if (argv.color) {
    setColorEnabled(true);
  }

  // --full（文档读取面）与 --json（投影面）互斥；不用 yargs conflicts——默认值
  // 注入的键会误触 conflicts 检查
  if (argv.full === true && argv.json === true) {
    console.error(
      "Error: --full and --json are mutually exclusive (--json returns the domain projection; --full prints the SKILL.md document)"
    );
    process.exitCode = 1;
    return;
  }

  const includeDisabled = Boolean(argv.all || argv.disabled);
  const registry = new SkillRegistry(buildRegistryOptions(argv, { includeDisabled }));

  try {
    const includeArgs = argv.include as string[] | undefined;
    const includeFallback = !includeArgs?.length && argv.all ? ["all"] : includeArgs;
    const { includes, excludes } = parseFilters(
      includeFallback,
      argv.exclude as string[] | undefined,
      { providers: providerNamesFromSkills(registry.getAll()) }
    );
    const state: StateFilter = argv.disabled ? "disabled" : argv.all ? "all" : "enabled";
    const filtered = applyFilters(registry.getAll(), includes, excludes, state);
    const resolved = resolveSkill(filtered, argv.name);
    const skill = registry.load(`${resolved.provider}:${resolved.name}`);
    const skillFile = join(skill.path, "SKILL.md");
    const stats = statSync(skillFile);
    const redact = argv.redactPaths === true;

    if (argv.json) {
      // 投影面 JSON：领域字段 DTO（恒无正文）；--redact-paths 脱敏路径
      const payload = await getSkillInfo(argv);
      const output = redact ? { ...payload, path: redactPathForDisplay(payload.path) } : payload;
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const displayPath = redact ? redactPathForDisplay(skillFile) : skillFile;
    console.log(`\n${formatSkillLabel(skill, { includeProvider: true })}`);
    console.log(skill.description);
    console.log(dim(`Location: ${skill.location}`));
    console.log(dim(`Provider: ${skill.provider}`));
    console.log(dim(`Path: ${displayPath}`));
    console.log(dim(`Size: ${formatBytes(stats.size)}`));
    console.log(dim(`Has references: ${skill.hasReferences}`));
    console.log(dim(`Has scripts: ${skill.hasScripts}`));
    console.log(dim(`Has assets: ${skill.hasAssets}`));

    if (skill.pluginInfo) {
      const info = skill.pluginInfo;
      console.log(dim(`Plugin: ${info.pluginName}@${info.marketplace} (v${info.version})`));
    }

    console.log();
    if (argv.full === true) {
      // 显式文档读取面：--full 打印 SKILL.md 全文
      const doc = await readSkillContent(argv);
      console.log(doc.content);
    } else {
      // 投影面默认不嵌正文（Field visibility contract）；正文走显式读取
      console.log(dim("SKILL.md body omitted (field visibility contract); use --full to read it."));
    }
    console.log();
  } catch (error) {
    if (error instanceof SkillNotFoundError) {
      console.error(`Error: ${error.message}`);
      if (error.suggestions.length > 0) {
        console.error(success(`Did you mean: ${error.suggestions.join(", ")}`));
      }
      process.exitCode = 1;
      return;
    }
    if (error instanceof AmbiguousSkillNameError) {
      console.error(`Error: ${error.message}`);
      if (error.suggestions.length > 0) {
        console.error(success(`Try specifying: ${error.suggestions.join(", ")}`));
      }
      process.exitCode = 1;
      return;
    }
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exitCode = 1;
  }
}
