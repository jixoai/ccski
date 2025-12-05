import type { SkillMetadata } from "../types/skill.js";
import { colors, dim } from "./format.js";

function stripPluginPrefix(name: string, pluginName: string): string {
  const prefix = `${pluginName}:`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export interface SkillIdFormatOptions {
  includeProvider?: boolean;
  color?: boolean;
  providerColor?: (text: string) => string;
}

const defaultFormatOptions: Required<Omit<SkillIdFormatOptions, "providerColor">> = {
  includeProvider: true,
  color: true,
};

/**
 * Build a copy/paste friendly skill id that includes provider and plugin (when present).
 * Format: provider:@plugin:name or provider:name
 */
export function formatSkillId(skill: SkillMetadata, opts?: SkillIdFormatOptions): string {
  const { includeProvider } = { ...defaultFormatOptions, ...opts };
  if (skill.pluginInfo) {
    const base = stripPluginPrefix(skill.name, skill.pluginInfo.pluginName);
    const id = `@${skill.pluginInfo.pluginName}:${base}`;
    return includeProvider ? `${skill.provider}:${id}` : id;
  }
  return includeProvider ? `${skill.provider}:${skill.name}` : skill.name;
}

/**
 * Return a set of aliases (lowercased) that should match user input, including plugin-qualified variants.
 */
export function skillAliases(skill: SkillMetadata): string[] {
  const aliases = new Set<string>();
  aliases.add(skill.name.toLowerCase());
  const short = skill.name.toLowerCase().split(":").pop() ?? skill.name.toLowerCase();
  aliases.add(short);

  if (skill.pluginInfo) {
    const plugin = skill.pluginInfo.pluginName.toLowerCase();
    const base = stripPluginPrefix(skill.name.toLowerCase(), plugin);
    aliases.add(`${plugin}:${base}`);
    aliases.add(`@${plugin}:${base}`);
    aliases.add(`${skill.provider}:${plugin}:${base}`);
    aliases.add(`${skill.provider}:@${plugin}:${base}`);
  }

  return Array.from(aliases);
}

/**
 * Render a human-friendly label with colors, highlighting provider/plugin/name components.
 * Default includes provider to stay copy/pasteable; set includeProvider=false when a provider badge already exists.
 */
export function formatSkillLabel(skill: SkillMetadata, opts?: SkillIdFormatOptions): string {
  const { includeProvider, color, providerColor } = { ...defaultFormatOptions, ...opts };
  const useColor = color !== false;

  const providerPart = includeProvider ? `${skill.provider}:` : "";
  const pluginPart = skill.pluginInfo ? `@${skill.pluginInfo.pluginName}:` : "";
  const baseName = skill.pluginInfo ? stripPluginPrefix(skill.name, skill.pluginInfo.pluginName) : skill.name;

  if (!useColor) {
    return `${providerPart}${pluginPart}${baseName}`;
  }

  // Colored segments
  const defaultProviderColor =
    skill.provider === "claude" ? colors.green : skill.provider === "codex" ? colors.cyan : dim;
  const paintProvider = providerColor ?? defaultProviderColor;
  const green = paintProvider(providerPart.replace(/:$/, ""));
  const blue = colors.blue(baseName);
  const pluginColored = pluginPart ? dim(pluginPart) : "";
  const providerColored = includeProvider ? `${green}:` : "";
  return `${providerColored}${pluginColored}${blue}`;
}
