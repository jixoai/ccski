import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  AgentInstructionScope,
  AgentInstructionTarget,
  WorkflowInstallOptions,
  WorkflowInstallResult,
  WorkflowInstallResultEntry,
} from "./types.js";

const WORKFLOW_NAME = "ccski";
const WORKFLOW_BLOCK = `<workflow name="${WORKFLOW_NAME}">
When starting a new context, run \`bunx ccski list --no-color\` to discover extra local skills available on this machine, especially shared \`agents:user\` skills and agent-specific skills such as \`claude:user\`, \`codex:user\`, and \`gemini:user\`.
If the user names a skill, or a task clearly matches a skill that is not already exposed in the current session, do not assume the skill is unavailable. First run \`bunx ccski list --no-color\`, then run \`bunx ccski info <name>\` and load the \`SKILL.md\` path reported by the output.
\`ccski\` may emit compatibility warnings while reading local agent or plugin metadata, such as \`installed_plugins.json\`. These warnings do not necessarily block \`list\` or \`info\`; prefer \`--no-color\` for readable output and downstream parsing.
</workflow>`;

const WORKFLOW_BLOCK_PATTERN = /<workflow\s+name=["']ccski["'][^>]*>[\s\S]*?<\/workflow>/m;

export const AGENT_INSTRUCTION_TARGETS = [
  {
    id: "codex",
    label: "Codex",
    aliases: ["openai-codex", "codex-cli"],
    userPath: [".codex", "AGENTS.md"],
    projectPath: ["AGENTS.md"],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    aliases: ["claude", "claudecode"],
    userPath: [".claude", "CLAUDE.md"],
    projectPath: ["CLAUDE.md"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    aliases: ["gemini-cli"],
    userPath: [".gemini", "GEMINI.md"],
    projectPath: ["GEMINI.md"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    aliases: ["open-code"],
    userPath: [".config", "opencode", "AGENTS.md"],
    projectPath: ["AGENTS.md"],
  },
] as const satisfies readonly AgentInstructionTarget[];

export function getCcskiWorkflowBlock(): string {
  return WORKFLOW_BLOCK;
}

export function resolveAgentInstructionTarget(name: string): AgentInstructionTarget | null {
  const normalized = name.trim().toLowerCase();
  return (
    AGENT_INSTRUCTION_TARGETS.find(
      (target) =>
        target.id === normalized ||
        target.aliases.some((alias) => alias.toLowerCase() === normalized)
    ) ?? null
  );
}

export function listAgentInstructionTargets(): readonly AgentInstructionTarget[] {
  return AGENT_INSTRUCTION_TARGETS;
}

export function installCcskiWorkflow(options: WorkflowInstallOptions = {}): WorkflowInstallResult {
  const scope = options.scope ?? "user";
  const userDir = resolve(options.userDir ?? homedir());
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const targets = resolveRequestedTargets(options.agents);

  const results = targets.map((target) =>
    installTargetWorkflow({
      target,
      scope,
      userDir,
      projectDir,
      dryRun: options.dryRun === true,
    })
  );

  return {
    scope,
    dryRun: options.dryRun === true,
    results,
    installed: results.filter((entry) => entry.status === "installed").length,
    updated: results.filter((entry) => entry.status === "updated").length,
    unchanged: results.filter((entry) => entry.status === "unchanged").length,
    failed: results.filter((entry) => entry.status === "failed").length,
  };
}

function resolveRequestedTargets(agents: string[] | undefined): AgentInstructionTarget[] {
  if (!agents || agents.length === 0) return [...AGENT_INSTRUCTION_TARGETS];

  const resolved: AgentInstructionTarget[] = [];
  for (const agent of agents.flatMap((value) => value.split(","))) {
    const trimmed = agent.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase() === "all") {
      for (const target of AGENT_INSTRUCTION_TARGETS) appendUniqueTarget(resolved, target);
      continue;
    }

    const target = resolveAgentInstructionTarget(trimmed);
    if (!target) {
      const known = AGENT_INSTRUCTION_TARGETS.map((entry) => entry.id).join(", ");
      throw new Error(`Unknown agent target '${trimmed}'. Known targets: ${known}.`);
    }
    appendUniqueTarget(resolved, target);
  }

  if (resolved.length === 0) {
    throw new Error("No agent targets selected.");
  }

  return resolved;
}

function appendUniqueTarget(
  collection: AgentInstructionTarget[],
  target: AgentInstructionTarget
): void {
  if (!collection.some((entry) => entry.id === target.id)) collection.push(target);
}

function installTargetWorkflow(options: {
  target: AgentInstructionTarget;
  scope: AgentInstructionScope;
  userDir: string;
  projectDir: string;
  dryRun: boolean;
}): WorkflowInstallResultEntry {
  const targetPath = resolveTargetPath(options);

  try {
    const current = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
    const next = upsertWorkflowBlock(current);
    const status =
      current === next ? "unchanged" : current.trim().length === 0 ? "installed" : "updated";

    if (!options.dryRun && status !== "unchanged") {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, next, "utf8");
    }

    return {
      agent: options.target.id,
      label: options.target.label,
      scope: options.scope,
      path: targetPath,
      status,
    };
  } catch (err) {
    return {
      agent: options.target.id,
      label: options.target.label,
      scope: options.scope,
      path: targetPath,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveTargetPath(options: {
  target: AgentInstructionTarget;
  scope: AgentInstructionScope;
  userDir: string;
  projectDir: string;
}): string {
  const segments = options.scope === "user" ? options.target.userPath : options.target.projectPath;
  const root = options.scope === "user" ? options.userDir : options.projectDir;
  return join(root, ...segments);
}

function upsertWorkflowBlock(content: string): string {
  const normalized = normalizeNewline(content);
  if (WORKFLOW_BLOCK_PATTERN.test(normalized)) {
    return normalized.replace(WORKFLOW_BLOCK_PATTERN, WORKFLOW_BLOCK);
  }

  const prefix = normalized.trimEnd();
  return prefix.length > 0 ? `${prefix}\n\n${WORKFLOW_BLOCK}\n` : `${WORKFLOW_BLOCK}\n`;
}

function normalizeNewline(content: string): string {
  return content.replace(/\r\n/g, "\n");
}
