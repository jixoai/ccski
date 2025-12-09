import { tone, heading, dim, warn, success } from "../../utils/format.js";
import { existsSync } from "node:fs";

export interface ArgConfig {
  /** Argument values */
  values: string[];
  /** Custom short render function for preview mode */
  shortRender?: (values: string[], totalChoices?: number) => string[];
  /** Total choices (for --all detection) */
  totalChoices?: number;
  /** If true, render values as positional args (no --key= prefix) */
  positional?: boolean;
}

/**
 * Unified command builder for interactive CLI workflows.
 * Tracks arguments across multiple selection steps and provides
 * consistent command preview and confirmation.
 */
export class InteractiveCommandBuilder {
  private base: string;
  private positional: string[] = [];
  private args: Map<string, ArgConfig> = new Map();
  private flags: Set<string> = new Set();

  constructor(base: string) {
    this.base = base;
  }

  /** Add a positional argument (e.g., source URL) */
  addPositional(value: string): this {
    this.positional.push(value);
    return this;
  }

  /** Add a named argument with values */
  addArg(
    key: string,
    values: string | string[],
    options?: {
      shortRender?: ArgConfig["shortRender"];
      totalChoices?: number;
      positional?: boolean;
    }
  ): this {
    const arr = Array.isArray(values) ? values : [values];
    if (arr.length === 0) return this;
    this.args.set(key, {
      values: arr,
      shortRender: options?.shortRender,
      totalChoices: options?.totalChoices,
      positional: options?.positional,
    });
    return this;
  }

  /** Update an existing argument's values */
  updateArg(key: string, values: string[]): this {
    const existing = this.args.get(key);
    if (existing) {
      existing.values = values;
    } else {
      this.args.set(key, { values });
    }
    return this;
  }

  /** Add a boolean flag */
  addFlag(flag: string): this {
    this.flags.add(flag);
    return this;
  }

  /** Remove a flag */
  removeFlag(flag: string): this {
    this.flags.delete(flag);
    return this;
  }

  /** Get argument values */
  getArg(key: string): string[] {
    return this.args.get(key)?.values ?? [];
  }

  /** Check if flag is set */
  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  /** Build the full command string (no truncation) */
  buildFull(): string {
    const parts = [this.base, ...this.positional];

    for (const [key, config] of this.args) {
      // For full build, check if we should use --all
      if (config.totalChoices && config.values.length === config.totalChoices && config.values.length > 1) {
        parts.push("--all");
      } else if (config.positional) {
        // Positional args: just add values without --key=
        parts.push(...config.values);
      } else {
        for (const val of config.values) {
          parts.push(`--${key}=${val}`);
        }
      }
    }

    for (const flag of this.flags) {
      parts.push(`--${flag}`);
    }

    return parts.join(" ");
  }

  /** Build a shortened command preview for interactive display */
  buildPreview(): string {
    const parts = [this.base, ...this.positional];

    for (const [key, config] of this.args) {
      if (config.shortRender) {
        const rendered = config.shortRender(config.values, config.totalChoices);
        parts.push(...rendered);
      } else if (config.totalChoices && config.values.length === config.totalChoices && config.values.length > 1) {
        // All selected, use --all
        parts.push("--all");
      } else if (config.positional) {
        // Positional args: truncate to 3 items
        const maxShow = 3;
        const values = config.values;
        if (values.length <= maxShow) {
          parts.push(...values);
        } else {
          parts.push(...values.slice(0, maxShow));
          parts.push(`... (+${values.length - maxShow} more)`);
        }
      } else {
        // Named args: truncate to 3 items
        const maxShow = 3;
        const values = config.values;
        if (values.length <= maxShow) {
          for (const val of values) {
            parts.push(`--${key}=${val}`);
          }
        } else {
          for (const val of values.slice(0, maxShow)) {
            parts.push(`--${key}=${val}`);
          }
          parts.push(`... (+${values.length - maxShow} more)`);
        }
      }
    }

    for (const flag of this.flags) {
      parts.push(`--${flag}`);
    }

    return parts.join(" ");
  }

  /** Render colorized preview for display */
  renderPreview(label = "Command"): string {
    const preview = this.buildPreview();
    const [base, ...args] = preview.split(" ");
    const coloredArgs = args.map((arg) => tone.primary(arg)).join(" ");
    return `${tone.info(`${label}:`)} ${tone.bold(tone.accent(base))} ${coloredArgs}`;
  }

  /** Show confirmation prompt and return user's decision */
  async confirm(options: {
    skills?: Array<{ name: string; description?: string }>;
    destinations?: string[];
    conflicts?: Array<{ skill: string; destination: string }>;
    force?: boolean;
  }): Promise<boolean> {
    const { skills, destinations, conflicts, force } = options;

    console.log();
    console.log(heading("Installation Summary"));
    console.log();

    if (skills && skills.length > 0) {
      console.log(`${tone.bold("Skills:")} ${skills.length} selected`);
      for (const skill of skills) {
        console.log(`  ${tone.primary("•")} ${skill.name}`);
      }
      console.log();
    }

    if (destinations && destinations.length > 0) {
      console.log(`${tone.bold("Destinations:")} ${destinations.length}`);
      for (const dest of destinations) {
        const exists = existsSync(dest);
        console.log(`  ${tone.primary("•")} ${dest}${exists ? "" : dim(" (will create)")}`);
      }
      console.log();
    }

    if (conflicts && conflicts.length > 0) {
      if (force) {
        console.log(`${tone.warning("Will overwrite:")} ${conflicts.length} existing skill(s)`);
      } else {
        console.log(`${tone.warning("Will skip:")} ${conflicts.length} existing skill(s)`);
      }
      for (const c of conflicts.slice(0, 5)) {
        console.log(`  ${tone.warning("•")} ${c.skill} @ ${dim(c.destination)}`);
      }
      if (conflicts.length > 5) {
        console.log(dim(`  ... and ${conflicts.length - 5} more`));
      }
      console.log();
    }

    console.log(`${tone.bold("Command:")}`);
    console.log(`  ${tone.accent(this.buildFull())}`);
    console.log();

    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(`${tone.warning("Proceed?")} [Y/n] `, (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === "" || normalized === "y" || normalized === "yes");
      });
    });
  }

  /** Clone this builder */
  clone(): InteractiveCommandBuilder {
    const cloned = new InteractiveCommandBuilder(this.base);
    cloned.positional = [...this.positional];
    for (const [key, config] of this.args) {
      cloned.args.set(key, { ...config, values: [...config.values] });
    }
    for (const flag of this.flags) {
      cloned.flags.add(flag);
    }
    return cloned;
  }
}

/** Default short render for skill names: use --all or truncate */
export function skillsShortRender(values: string[], totalChoices?: number): string[] {
  if (totalChoices && values.length === totalChoices && values.length > 1) {
    return ["--all"];
  }
  const maxShow = 3;
  if (values.length <= maxShow) {
    return values;
  }
  return [...values.slice(0, maxShow), `... (+${values.length - maxShow} more)`];
}
