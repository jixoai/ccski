import type { SkillMetadata } from "../types/skill.js";
import { dim, tone, type ListItem } from "./format.js";
import { formatSkillLabel } from "./skill-id.js";
import { wrap } from "../word-wrap/index.js";

/**
 * Common interface for skill-like objects (SkillMetadata or SkillEntry)
 */
export interface SkillLike {
  name: string;
  description?: string;
  disabled?: boolean;
  location?: string;
  pluginInfo?: { pluginName: string };
  path?: string;
}

/**
 * Format a skill for interactive multi-select choice label.
 * Uses consistent styling with list command.
 */
export function formatSkillChoiceLabel(skill: SkillLike): string {
  const wrapWidth = Math.max(24, Math.min(process.stdout?.columns ?? 80, 120) - 6);
  const descriptionText = skill.description ?? "";
  const wrapped = descriptionText
    ? wrap(descriptionText, {
        width: wrapWidth,
        indent: "",
        newline: "\n",
        trim: true,
        cut: false,
      })
    : "";
  const description =
    wrapped && wrapped.length > 0 ? "\n    " + wrapped.replace(/\n/g, "\n    ") : "";

  // Use formatSkillLabel for SkillMetadata, or simple name for basic entries
  const label = isSkillMetadata(skill)
    ? formatSkillLabel(skill, { includeProvider: true })
    : skill.name;

  return `${tone.primary(label)}${description}`;
}

/**
 * Convert skills to ListItem format for renderList.
 * Consistent with list command rendering.
 */
export function skillsToListItems(skills: SkillLike[]): ListItem[] {
  return skills.map((skill) => {
    const meta = skill.location === "plugin" && skill.pluginInfo
      ? skill.pluginInfo.pluginName
      : skill.location
        ? dim(skill.location)
        : undefined;

    const base: ListItem = {
      title: skill.name,
      ...(meta ? { meta } : {}),
      ...(skill.description ? { description: skill.description } : {}),
    };

    if (skill.disabled) {
      return {
        ...base,
        color: tone.danger,
        badge: tone.danger("[disabled]"),
      };
    }

    return base;
  });
}

/**
 * Type guard to check if a SkillLike is a full SkillMetadata
 */
function isSkillMetadata(skill: SkillLike): skill is SkillMetadata {
  return "provider" in skill;
}
