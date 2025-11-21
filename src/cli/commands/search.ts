import type { ArgumentsCamelCase } from "yargs";
import { containsCaseInsensitive, rankStrings } from "../../utils/search.js";
import { highlight, renderTable, setColorEnabled } from "../../utils/format.js";
import { SkillRegistry } from "../../core/registry.js";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface SearchArgs extends SkillRegistryOptions {
  query: string;
  content?: boolean;
  noPlugins?: boolean;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
  format?: "plain" | "table" | "json";
}

export async function searchCommand(argv: ArgumentsCamelCase<SearchArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }
  if (argv.color) {
    setColorEnabled(true);
  }

  const registry = new SkillRegistry(buildRegistryOptions(argv));

  const skills = registry.getAll();
  const haystack = skills.map((skill) => `${skill.name} ${skill.description}`);
  const ranked = rankStrings(haystack, argv.query);

  const picked = ranked.length > 0 ? ranked.map((i) => skills[i]!) : skills;

  const filtered = argv.content
    ? picked.filter((skill) => {
        const content = registry.load(skill.name).content;
        return containsCaseInsensitive(content, argv.query);
      })
    : picked.filter((skill) => containsCaseInsensitive(`${skill.name} ${skill.description}`, argv.query));

  const format = argv.json ? "json" : argv.format ?? "plain";

  if (format === "json") {
    const payload = filtered.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: skill.location,
      path: skill.path,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log("No skills matched your query.");
    return;
  }

  if (format === "table") {
    const rows = filtered.map((skill) => [highlight(skill.name, argv.query), highlight(skill.description, argv.query), skill.location]);
    console.log(renderTable(["NAME", "DESCRIPTION", "LOCATION"], rows));
  } else {
    const lines = filtered.map((skill) => `- ${highlight(skill.name, argv.query)} (${skill.location}) — ${highlight(skill.description, argv.query)}`);
    console.log(lines.join("\n"));
  }

  if (argv.content) {
    console.log();
    for (const skill of filtered.slice(0, 5)) {
      const content = registry.load(skill.name).content;
      const snippet = extractSnippet(content, argv.query, 120);
      if (snippet) {
        console.log(`${skill.name}: ${highlight(snippet, argv.query)}`);
      }
    }
  }
}

function extractSnippet(content: string, query: string, length: number): string | null {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - Math.floor(length / 2));
  const end = Math.min(content.length, start + length);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}
