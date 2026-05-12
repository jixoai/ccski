import type { ArgumentsCamelCase } from "yargs";
import type {
  AgentInstructionScope,
  WorkflowInstallOptions,
  WorkflowInstallResult,
} from "../../api/types.js";
import { installCcskiWorkflow, listAgentInstructionTargets } from "../../api/workflow-install.js";
import { dim, error, info, tone } from "../../utils/format.js";
import { promptMultiSelect } from "../prompts/multiSelect.js";

export interface WorkflowInstallCliArgs extends WorkflowInstallOptions {
  agent?: string[];
  agents?: string[];
  interactive?: boolean;
  json?: boolean;
  project?: boolean;
  user?: boolean;
}

export async function installWorkflowCommand(
  argv: ArgumentsCamelCase<WorkflowInstallCliArgs>
): Promise<void> {
  try {
    const scope = resolveWorkflowScope(argv);
    const explicitAgents = [...normalizeArray(argv.agents), ...normalizeArray(argv.agent)];
    const agents = explicitAgents.length > 0 ? explicitAgents : await maybePromptAgents(argv);

    const result = installCcskiWorkflow({
      ...(agents.length > 0 ? { agents } : {}),
      scope,
      ...(argv.userDir !== undefined ? { userDir: argv.userDir } : {}),
      ...(argv.dryRun !== undefined ? { dryRun: argv.dryRun } : {}),
    });

    if (argv.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printWorkflowInstallSummary(result);
    }

    if (result.failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error(error(`Install failed: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}

function resolveWorkflowScope(argv: WorkflowInstallCliArgs): AgentInstructionScope {
  if (argv.project && argv.user) throw new Error("Use only one of --project or --user.");
  if (argv.project) return "project";
  if (argv.user) return "user";
  return argv.scope ?? "user";
}

function normalizeArray(values: string[] | string | undefined): string[] {
  if (!values) return [];
  return Array.isArray(values) ? values.map(String) : [String(values)];
}

async function maybePromptAgents(argv: WorkflowInstallCliArgs): Promise<string[]> {
  if (!argv.interactive) return [];
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive workflow install requires a TTY. Use --agent instead.");
  }

  return promptMultiSelect({
    message: "Select agent prompt target(s)",
    choices: listAgentInstructionTargets().map((target) => ({
      value: target.id,
      label: `${tone.bold(target.label)} ${dim(target.id)}`,
      description: `${target.userPath.join("/")} / ${target.projectPath.join("/")}`,
      checked: true,
    })),
    defaultChecked: true,
    command: {
      base: "ccski install",
      label: "Command",
      argPrefix: "--agent",
    },
  });
}

function printWorkflowInstallSummary(summary: WorkflowInstallResult): void {
  console.log(info(`Installing ccski workflow instructions (${summary.scope} scope)\n`));

  for (const result of summary.results) {
    const status =
      result.status === "installed"
        ? tone.success("✓ installed")
        : result.status === "updated"
          ? tone.warning("↻ updated")
          : result.status === "unchanged"
            ? dim("○ unchanged")
            : tone.danger("✗ failed");
    const errorText = result.error ? ` ${tone.danger(result.error)}` : "";
    console.log(`${tone.bold(result.label)}: ${status} ${dim(result.path)}${errorText}`);
  }

  console.log();
  console.log(
    dim(
      `Known targets: ${listAgentInstructionTargets()
        .map((target) => target.id)
        .join(", ")}`
    )
  );
  console.log(
    dim("Use --agent=<name> to limit targets, --project for the current directory, or --dry-run.")
  );
}
