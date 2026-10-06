import { z } from "zod";

/**
 * Schema for SKILL.md frontmatter
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().trim().min(1, "Skill name cannot be empty"),
  description: z.string().trim().min(1, "Skill description cannot be empty"),
}).passthrough(); // Allow additional fields

/**
 * Restricted skill name for filesystem-facing primitives (install destination,
 * remove target): the name *is* the direct-child directory name, so it must
 * never contain separators, traversal, NUL, scope prefixes, or leading dots.
 * Stricter than the frontmatter schema by design; violations are typed
 * rejections, not aliases.
 */
export const RestrictedSkillNameSchema = z
  .string()
  .trim()
  .min(1, "Skill name cannot be empty")
  .max(128, "Skill name cannot exceed 128 characters")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._+@-]*$/,
    "Skill name may only contain letters, digits, and '. _ + @ -' (no leading dot)"
  );

export type RestrictedSkillName = z.infer<typeof RestrictedSkillNameSchema>;

/**
 * Schema for plugin entry in installed_plugins.json
 */
export const PluginEntrySchema = z
  .object({
  version: z.string(),
  installedAt: z.string(),
  lastUpdated: z.string(),
  installPath: z.string(),
  gitCommitSha: z.string(),
  isLocal: z.boolean(),
  scope: z.string().optional(),
})
  .passthrough();

/**
 * Schema for installed_plugins.json
 */
export const InstalledPluginsSchema = z.object({
  version: z.number(),
  plugins: z.record(z.string(), z.union([PluginEntrySchema, z.array(PluginEntrySchema)])),
});

/**
 * Schema for Claude settings.json (subset we care about)
 */
export const ClaudeSettingsSchema = z
  .object({
    enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  })
  .passthrough();

/**
 * Infer TypeScript types from Zod schemas
 */
export type SkillFrontmatterType = z.infer<typeof SkillFrontmatterSchema>;
export type PluginEntryType = z.infer<typeof PluginEntrySchema>;
export type InstalledPluginsType = z.infer<typeof InstalledPluginsSchema>;
export type ClaudeSettingsType = z.infer<typeof ClaudeSettingsSchema>;
