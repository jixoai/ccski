import type { SkillRegistryOptions } from "../core/registry.js";

/**
 * CLI args that map to SkillRegistryOptions.
 * Used by commands to configure skill discovery.
 */
export interface RegistryCliArgs {
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
  return { path: rawPath, scope };
}

export function buildRegistryOptions(
  argv: RegistryCliArgs,
  extras: Partial<SkillRegistryOptions> = {}
): SkillRegistryOptions {
  const options: SkillRegistryOptions = {};

  if (Array.isArray(argv.skillDir)) {
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
