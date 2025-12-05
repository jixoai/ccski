import { mkdtempSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFilters, parseFilters } from "../src/utils/filters.js";
import type { SkillLocation, SkillMetadata, SkillProvider } from "../src/types/skill.js";

function makeDir(name: string): string {
  const base = mkdtempSync(join(tmpdir(), `ccski-filter-${name}-`));
  mkdirSync(base, { recursive: true });
  return base;
}

function touchPath(path: string, mtimeMs: number): void {
  const mtime = new Date(mtimeMs);
  utimesSync(path, mtime, mtime);
}

function skill(
  name: string,
  provider: SkillProvider,
  location: SkillLocation,
  path: string,
  extras: Partial<SkillMetadata> = {}
): SkillMetadata {
  return {
    name,
    description: `${provider}-${name}`,
    provider,
    location,
    path,
    hasAssets: false,
    hasReferences: false,
    hasScripts: false,
    ...extras,
  } satisfies SkillMetadata;
}

describe("filters", () => {
  it("defaults to auto include and dedups by mtime then location", () => {
    const claudePath = makeDir("claude-newer");
    const codexPath = makeDir("codex-older");
    touchPath(claudePath, Date.now() + 1000);
    touchPath(codexPath, Date.now());

    const skills = [
      skill("pdf", "claude", "project", claudePath),
      skill("pdf", "codex", "user", codexPath),
    ];

    const { includes, excludes } = parseFilters(undefined, undefined);
    const filtered = applyFilters(skills, includes, excludes, "enabled");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.provider).toBe("claude");
  });

  it("respects state filtering for disabled skills", () => {
    const enabledPath = makeDir("enabled");
    const disabledPath = makeDir("disabled");
    const skills = [
      skill("alpha", "claude", "project", enabledPath),
      skill("beta", "codex", "user", disabledPath, { disabled: true }),
    ];

    const { includes, excludes } = parseFilters(undefined, undefined);

    const disabledOnly = applyFilters(skills, includes, excludes, "disabled");
    expect(disabledOnly.map((s) => s.name)).toEqual(["beta"]);

    const enabledOnly = applyFilters(skills, includes, excludes, "enabled");
    expect(enabledOnly.map((s) => s.name)).toEqual(["alpha"]);
  });

  it("keeps auto choice and explicit provider entry when include order demands", () => {
    const claudePath = makeDir("auto-claude");
    const codexPath = makeDir("explicit-codex");
    // Make claude newer so auto picks it
    touchPath(claudePath, Date.now() + 2000);
    touchPath(codexPath, Date.now());

    const skills = [
      skill("shared", "claude", "user", claudePath),
      skill("shared", "codex", "project", codexPath),
    ];

    const { includes, excludes } = parseFilters(["auto,codex:shared"], undefined);
    const filtered = applyFilters(skills, includes, excludes, "enabled");

    expect(filtered).toHaveLength(2);
    const providers = filtered.map((s) => s.provider).sort();
    expect(providers).toEqual(["claude", "codex"]);
  });

  it("excludes plugin group tokens for claude plugins", () => {
    const pluginPath = makeDir("plugin");
    const projectPath = makeDir("project");
    const skills = [
      skill("notes", "claude", "plugin", pluginPath, {
        pluginInfo: { pluginName: "example", marketplace: "claude", version: "1.0.0" },
      }),
      skill("notes", "claude", "project", projectPath),
    ];

    const { includes, excludes } = parseFilters(["all"], ["claude:@plugins"]);
    const filtered = applyFilters(skills, includes, excludes, "all");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.location).toBe("project");
  });

  it("throws for unsupported provider group combinations", () => {
    expect(() => parseFilters(["codex:@plugins"], undefined)).toThrow(/codex provider does not support @plugins/i);
  });

  it("matches plugin group tokens with wildcards", () => {
    const pluginPath = makeDir("plugins-wild");
    const otherPlugin = makeDir("plugins-other");
    const skills = [
      skill("fmt", "claude", "plugin", pluginPath, {
        pluginInfo: { pluginName: "example-scripts", marketplace: "claude", version: "1.0.0" },
      }),
      skill("fmt", "claude", "plugin", otherPlugin, {
        pluginInfo: { pluginName: "other", marketplace: "claude", version: "1.0.0" },
      }),
    ];

    const { includes, excludes } = parseFilters(["claude:@plugins:example-*"], undefined);
    const filtered = applyFilters(skills, includes, excludes, "enabled");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.pluginInfo?.pluginName).toBe("example-scripts");
  });

  it("matches plugin-qualified skill ids (@plugin:skill)", () => {
    const pluginPath = makeDir("plugin-qualified");
    const skills = [
      skill("theme-factory", "claude", "plugin", pluginPath, {
        pluginInfo: { pluginName: "theme-factory", marketplace: "claude", version: "1.0.0" },
      }),
    ];

    const { includes, excludes } = parseFilters(["@theme-factory:theme-factory"], undefined);
    const filtered = applyFilters(skills, includes, excludes, "enabled");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.pluginInfo?.pluginName).toBe("theme-factory");
  });

  it("errors when using codex@plugin syntax", () => {
    expect(() => parseFilters(["codex@plugin:foo"], undefined)).toThrow(/only claude provider supports plugin-qualified/i);
  });

  it("prefers project over user when mtimes tie in auto mode", () => {
    const projectPath = makeDir("project-tie");
    const userPath = makeDir("user-tie");
    const now = Date.now();
    touchPath(projectPath, now);
    touchPath(userPath, now);

    const skills = [
      skill("report", "claude", "project", projectPath),
      skill("report", "claude", "user", userPath),
    ];

    const { includes, excludes } = parseFilters(undefined, undefined);
    const filtered = applyFilters(skills, includes, excludes, "enabled");

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.location).toBe("project");
  });
});
