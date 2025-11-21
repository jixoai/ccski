import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArgumentsCamelCase } from "yargs";
import { dim, error, setColorEnabled, success } from "../../utils/format.js";
import { validateSkillFile } from "../../core/parser.js";

export interface ValidateArgs {
  path: string;
  json?: boolean;
  noColor?: boolean;
  color?: boolean;
}

export async function validateCommand(argv: ArgumentsCamelCase<ValidateArgs>): Promise<void> {
  if (argv.noColor || process.env.FORCE_COLOR === "0") {
    setColorEnabled(false);
  }
  if (argv.color) {
    setColorEnabled(true);
  }

  const target = resolve(argv.path);
  const skillFile = resolveSkillFile(target);

  if (!skillFile) {
    console.error(error(`Error: Could not find SKILL.md at ${target}`));
    process.exitCode = 1;
    return;
  }

  const result = validateSkillFile(skillFile);
  if (argv.json) {
    console.log(JSON.stringify({ file: skillFile, success: result.success, errors: result.errors, suggestions: result.suggestions }, null, 2));
    process.exitCode = result.success ? 0 : 1;
    return;
  }

  if (result.success) {
    console.log(`${success("✓ Skill is valid")} (${skillFile})`);
    return;
  }

  console.error(error(`Validation failed for ${skillFile}`));
  result.errors.forEach((err) => console.error(` - ${err}`));
  if (result.suggestions.length) {
    console.error(dim("Suggestions:"));
    result.suggestions.forEach((s) => console.error(dim(`   • ${s}`)));
  }
  process.exitCode = 1;
}

function resolveSkillFile(input: string): string | null {
  if (!existsSync(input)) return null;
  const stats = statSync(input);

  if (stats.isDirectory()) {
    const candidate = join(input, "SKILL.md");
    return existsSync(candidate) ? candidate : null;
  }

  if (stats.isFile() && input.toLowerCase().endsWith("skill.md")) {
    return input;
  }

  return null;
}
