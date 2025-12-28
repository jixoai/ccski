import type { ArgumentsCamelCase } from "yargs";
import { dim, error, setColorEnabled, success } from "../../utils/format.js";
import { validateSkill } from "../../api/validate.js";

import type { ValidateOptions } from "../../api/types.js";

export interface ValidateArgs extends ValidateOptions {
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

  try {
    const result = await validateSkill(argv);

    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.success ? 0 : 1;
      return;
    }

    if (result.success) {
      console.log(`${success("✓ Skill is valid")} (${result.file})`);
      if (result.warnings.length) {
        result.warnings.forEach((w) => console.log(dim(` - ${w}`)));
      }
      return;
    }

    console.error(error(`Validation failed for ${result.file}`));
    result.errors.forEach((err) => console.error(` - ${err}`));
    if (result.warnings.length) {
      console.error(dim("Warnings:"));
      result.warnings.forEach((w) => console.error(dim(`   • ${w}`)));
    }
    process.exitCode = 1;
  } catch (err) {
    console.error(error(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
