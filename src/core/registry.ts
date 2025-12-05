import { AmbiguousSkillNameError, SkillNotFoundError } from "../types/errors.js";
import type { Skill, SkillMetadata, SkillProvider } from "../types/skill.js";
import type { DiscoveryOptions } from "./discovery.js";
import { discoverSkills, loadSkill } from "./discovery.js";
import type { PluginDiscoveryOptions } from "./plugins.js";
import { discoverPluginSkills } from "./plugins.js";
import { rankStrings } from "../utils/search.js";
import { formatSkillId } from "../utils/skill-id.js";

export type SkillRegistryOptions = DiscoveryOptions & PluginDiscoveryOptions;

interface SkillRegistryDiagnostics {
  directoriesScanned: string[];
  pluginSources: string[];
  warnings: string[];
  conflicts: string[];
  byProvider: Record<string, number>;
  byLocation: Record<string, number>;
}

/**
 * Skill registry for managing discovered skills
 */
export class SkillRegistry {
  private skills: SkillMetadata[] = [];
  private diagnostics: SkillRegistryDiagnostics = {
    directoriesScanned: [],
    pluginSources: [],
    warnings: [],
    conflicts: [],
    byProvider: {},
    byLocation: {},
  }; // collected during refresh

  constructor(private options: SkillRegistryOptions = {}) {
    this.refresh();
  }

  /**
   * Refresh the skill registry by rescanning directories
   */
  refresh(): void {
    this.skills = [];

    this.diagnostics = {
      directoriesScanned: [],
      pluginSources: [],
      warnings: [],
      conflicts: [],
      byProvider: {},
      byLocation: {},
    };

    // Discover user/project skills first (higher priority)
    const discovered = discoverSkills(this.options);

    this.diagnostics.directoriesScanned.push(...discovered.diagnostics.scannedDirectories);
    this.diagnostics.warnings.push(...discovered.diagnostics.warnings);
    this.diagnostics.conflicts.push(...discovered.diagnostics.conflicts);

    for (const skill of discovered.skills) {
      this.skills.push(skill);
      this.diagnostics.byProvider[skill.provider] = (this.diagnostics.byProvider[skill.provider] ?? 0) + 1;
      this.diagnostics.byLocation[skill.location] = (this.diagnostics.byLocation[skill.location] ?? 0) + 1;
    }

    // Discover plugin skills (lowest priority; keep duplicates so filters can resolve)
    if (!this.options.skipPlugins) {
      const pluginOptions: PluginDiscoveryOptions = {};
      if (this.options.pluginsFile) {
        pluginOptions.pluginsFile = this.options.pluginsFile;
      }
      if (this.options.pluginsRoot) {
        pluginOptions.pluginsRoot = this.options.pluginsRoot;
      }
      if (this.options.userDir) {
        pluginOptions.userDir = this.options.userDir;
      }

      const pluginSkills = discoverPluginSkills(pluginOptions);

      this.diagnostics.pluginSources.push(...pluginSkills.diagnostics.scannedPlugins);
      this.diagnostics.warnings.push(...pluginSkills.diagnostics.warnings);

      for (const skill of pluginSkills.skills) {
        const hasNonPluginDuplicate = this.skills.some(
          (existing) => existing.name.toLowerCase() === skill.name.toLowerCase() && existing.location !== "plugin"
        );
        if (hasNonPluginDuplicate) {
          this.diagnostics.conflicts.push(
            `Duplicate skill ${skill.name} from plugin at ${skill.path}; keeping for filter-stage resolution.`
          );
        }
        this.skills.push(skill);
        this.diagnostics.byProvider[skill.provider] = (this.diagnostics.byProvider[skill.provider] ?? 0) + 1;
        this.diagnostics.byLocation[skill.location] = (this.diagnostics.byLocation[skill.location] ?? 0) + 1;
      }
    }
  }

  /**
   * Get all skills
   */
  getAll(): SkillMetadata[] {
    return [...this.skills];
  }

  /**
   * Find a skill by name (case-insensitive, supports full and short names)
   */
  find(name: string): SkillMetadata {
    const normalizedName = name.toLowerCase();

    const [maybeProvider, rest] = normalizedName.includes(":")
      ? ((): [string | undefined, string] => {
          const parts = normalizedName.split(":");
          if (parts.length > 1 && ["claude", "codex", "file"].includes(parts[0]!)) {
            return [parts.shift(), parts.join(":")];
          }
          return [undefined, normalizedName];
        })()
      : [undefined, normalizedName];

    const targetProvider = maybeProvider as SkillProvider | undefined;
    const targetName = rest;

    const candidates = this.skills.filter((skill) => {
      const skillName = skill.name.toLowerCase();
      const shortName = skillName.split(":").pop();
      const matchesName = skillName === targetName || shortName === targetName;
      const matchesProvider = targetProvider ? skill.provider === targetProvider : true;
      return matchesName && matchesProvider;
    });

    if (candidates.length === 1) return candidates[0]!;
    if (candidates.length > 1) {
      const suggestions = candidates.map((s) => this.formatNameWithProvider(s));
      throw new AmbiguousSkillNameError(name, candidates.map((s) => s.name), suggestions);
    }

    throw new SkillNotFoundError(name, this.getSuggestions(name, targetProvider));
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
  private getSuggestions(query: string, provider?: SkillProvider, limit: number = 3): string[] {
    const pool = this.skills
      .filter((s) => (provider ? s.provider === provider : true))
      .map((s) => this.formatNameWithProvider(s));
    const ranked = rankStrings(pool, query);
    return ranked.slice(0, limit).map((index) => pool[index]!);
  }

  private formatNameWithProvider(skill: SkillMetadata): string {
    return formatSkillId(skill);
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics(): {
    totalSkills: number;
    byLocation: Record<string, number>;
    byProvider: Record<string, number>;
    directoriesScanned: string[];
    pluginSources: string[];
    warnings: string[];
    conflicts: string[];
  } {
    return {
      totalSkills: this.skills.length,
      byLocation: { ...this.diagnostics.byLocation },
      byProvider: { ...this.diagnostics.byProvider },
      directoriesScanned: [...this.diagnostics.directoriesScanned],
      pluginSources: [...this.diagnostics.pluginSources],
      warnings: [...this.diagnostics.warnings],
      conflicts: [...this.diagnostics.conflicts],
    };
  }
}
