import { AmbiguousSkillNameError, SkillNotFoundError } from "../types/errors.js";
import type { Skill, SkillLocation, SkillMetadata } from "../types/skill.js";
import type { DiscoveryOptions } from "./discovery.js";
import { discoverSkills, loadSkill } from "./discovery.js";
import type { PluginDiscoveryOptions } from "./plugins.js";
import { discoverPluginSkills } from "./plugins.js";
import { rankStrings } from "../utils/search.js";

export type SkillRegistryOptions = DiscoveryOptions & PluginDiscoveryOptions;

interface SkillRegistryDiagnostics {
  directoriesScanned: string[];
  pluginSources: string[];
  warnings: string[];
  conflicts: string[];
}

/**
 * Skill registry for managing discovered skills
 */
export class SkillRegistry {
  private skills: Map<string, SkillMetadata> = new Map();
  private diagnostics: SkillRegistryDiagnostics = {
    directoriesScanned: [],
    pluginSources: [],
    warnings: [],
    conflicts: [],
  }; // collected during refresh

  constructor(private options: SkillRegistryOptions = {}) {
    this.refresh();
  }

  /**
   * Refresh the skill registry by rescanning directories
   */
  refresh(): void {
    this.skills.clear();

    this.diagnostics = {
      directoriesScanned: [],
      pluginSources: [],
      warnings: [],
      conflicts: [],
    };

    // Discover user/project skills first (higher priority)
    const discovered = discoverSkills(this.options);

    this.diagnostics.directoriesScanned.push(...discovered.diagnostics.scannedDirectories);
    this.diagnostics.warnings.push(...discovered.diagnostics.warnings);
    this.diagnostics.conflicts.push(...discovered.diagnostics.conflicts);

    for (const skill of discovered.skills) {
      this.skills.set(skill.name, skill);
    }

    // Discover plugin skills (lowest priority, only add if not already exists)
    if (!this.options.skipPlugins) {
      const pluginOptions: PluginDiscoveryOptions = {};
      if (this.options.pluginsFile) {
        pluginOptions.pluginsFile = this.options.pluginsFile;
      }
      if (this.options.pluginsRoot) {
        pluginOptions.pluginsRoot = this.options.pluginsRoot;
      }

      const pluginSkills = discoverPluginSkills(pluginOptions);

      this.diagnostics.pluginSources.push(...pluginSkills.diagnostics.scannedPlugins);
      this.diagnostics.warnings.push(...pluginSkills.diagnostics.warnings);

      for (const skill of pluginSkills.skills) {
        if (!this.skills.has(skill.name)) {
          this.skills.set(skill.name, skill);
        } else {
          this.diagnostics.conflicts.push(
            `Skipping plugin skill ${skill.name} from ${skill.path} because a higher-priority skill is already loaded.`
          );
        }
      }
    }
  }

  /**
   * Get all skills
   */
  getAll(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find a skill by name (case-insensitive, supports full and short names)
   */
  find(name: string): SkillMetadata {
    const normalizedName = name.toLowerCase();

    // Try exact match first (case-insensitive)
    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase() === normalizedName) {
        return skill;
      }
    }

    // Try namespace match (plugin:skill)
    if (name.includes(":")) {
      throw new SkillNotFoundError(name, this.getSuggestions(name));
    }

    // Try short name with priority resolution
    const shortMatches = Array.from(this.skills.values()).filter((skill) => {
      const shortName = skill.name.split(":").pop();
      return shortName?.toLowerCase() === normalizedName;
    });

    if (shortMatches.length === 0) {
      throw new SkillNotFoundError(name, this.getSuggestions(name));
    }

    const priority: SkillLocation[] = ["project", "user", "plugin"];

    for (const tier of priority) {
      const tierMatches = shortMatches.filter((skill) => skill.location === tier);

      if (tierMatches.length === 1) {
        return tierMatches[0]!;
      }

      if (tierMatches.length > 1) {
        throw new AmbiguousSkillNameError(name, tierMatches.map((s) => s.name));
      }
    }

    throw new SkillNotFoundError(name, this.getSuggestions(name));
  }

  /**
   * Check if a skill exists
   */
  has(name: string): boolean {
    try {
      this.find(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load full skill content
   */
  load(name: string): Skill {
    const metadata = this.find(name);
    return loadSkill(metadata);
  }

  /**
   * Get suggestions for similar skill names (fuzzy matching)
   */
  private getSuggestions(query: string, limit: number = 3): string[] {
    const names = Array.from(this.skills.keys());
    const ranked = rankStrings(names, query);
    return ranked.slice(0, limit).map((index) => names[index]!);
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics(): {
    totalSkills: number;
    byLocation: Record<string, number>;
    directoriesScanned: string[];
    pluginSources: string[];
    warnings: string[];
    conflicts: string[];
  } {
    const byLocation: Record<string, number> = {};

    for (const skill of this.skills.values()) {
      byLocation[skill.location] = (byLocation[skill.location] ?? 0) + 1;
    }

    return {
      totalSkills: this.skills.size,
      byLocation,
      directoriesScanned: this.diagnostics.directoriesScanned,
      pluginSources: this.diagnostics.pluginSources,
      warnings: this.diagnostics.warnings,
      conflicts: this.diagnostics.conflicts,
    };
  }
}
