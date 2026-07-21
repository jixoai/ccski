import type { SkillRegistryOptions } from "../core/registry.js";
import type { SkillProvider } from "../types/skill.js";

/**
 * Args that map to SkillRegistryOptions.
 * Used by CLI and programmatic API to configure skill discovery.
 */
export interface RegistryInput {
  /** Provider-scoped custom roots for embedders that own their addressing model. */
  customDirs?: SkillRegistryOptions["customDirs"];
  /** Provider label assigned to every explicit custom root. */
  customProvider?: SkillProvider;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  claudePluginsFile?: string;
  claudePluginsRoot?: string;
  userDir?: string;
}

function parseSkillDir(value: string): { path: string; scope?: string } {
  const [rawPath, query] = value.split("?");
  const params = new URLSearchParams(query);
  const scope = params.get("scope") ?? undefined;
  return { path: rawPath, ...(scope ? { scope } : {}) };
}

export function buildRegistryOptions(
  argv: RegistryInput,
  extras: Partial<SkillRegistryOptions> = {}
): SkillRegistryOptions {
  const options: SkillRegistryOptions = {};

  if (argv.customDirs?.length) {
    options.customDirs = argv.customDirs;
    options.customProvider = argv.customProvider ?? "file";
  } else if (Array.isArray(argv.skillDir)) {
    const parsed = argv.skillDir.map(parseSkillDir);
    options.customDirs = parsed.map((p) => ({ path: p.path, scope: p.scope ?? "other" }));
    options.customProvider = "file";
  }

  if (argv.scanDefaultDirs === false) {
    options.scanDefaultDirs = false;
  }

  if (typeof argv.claudePluginsFile === "string") {
    options.pluginsFile = argv.claudePluginsFile;
  }

  if (typeof argv.claudePluginsRoot === "string") {
    options.pluginsRoot = argv.claudePluginsRoot;
  }

  if (typeof argv.userDir === "string") {
    options.userDir = argv.userDir;
  }

  return { ...options, ...extras };
}
