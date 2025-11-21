import type { SkillRegistryOptions } from "../core/registry.js";
import type { ArgumentsCamelCase } from "yargs";

export function buildRegistryOptions(argv: ArgumentsCamelCase): SkillRegistryOptions {
  const options: SkillRegistryOptions = {};

  if (Array.isArray(argv.skillDir)) {
    options.customDirs = argv.skillDir as string[];
  }

  if (argv.noPlugins === true) {
    options.skipPlugins = true;
  }

  if (argv.scanDefaultDirs === false) {
    options.scanDefaultDirs = false;
  }

  if (typeof argv.pluginsFile === "string") {
    options.pluginsFile = argv.pluginsFile;
  }

  if (typeof argv.pluginsRoot === "string") {
    options.pluginsRoot = argv.pluginsRoot;
  }

  return options;
}
