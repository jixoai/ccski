import { z } from "zod";

/**
 * Schema for SKILL.md frontmatter
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().trim().min(1, "Skill name cannot be empty"),
  description: z.string().trim().min(1, "Skill description cannot be empty"),
}).passthrough(); // Allow additional fields

/**
 * Schema for plugin entry in installed_plugins.json
 */
export const PluginEntrySchema = z.object({
  version: z.string(),
  installedAt: z.string(),
  lastUpdated: z.string(),
  installPath: z.string(),
  gitCommitSha: z.string(),
  isLocal: z.boolean(),
});

/**
 * Schema for installed_plugins.json
 */
export const InstalledPluginsSchema = z.object({
  version: z.number(),
  plugins: z.record(z.string(), PluginEntrySchema),
});

/**
 * Infer TypeScript types from Zod schemas
 */
export type SkillFrontmatterType = z.infer<typeof SkillFrontmatterSchema>;
export type PluginEntryType = z.infer<typeof PluginEntrySchema>;
export type InstalledPluginsType = z.infer<typeof InstalledPluginsSchema>;
