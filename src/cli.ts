#!/usr/bin/env node

import { homedir } from "node:os";
import yargs, { type Argv, type CommandModule } from "yargs";
import { hideBin } from "yargs/helpers";
import { gcCommand, type GcArgs } from "./cli/commands/gc.js";
import { importCommand, type ImportArgs } from "./cli/commands/import.js";
import { infoCommand, type InfoArgs } from "./cli/commands/info.js";
import { installCommand, type InstallArgs } from "./cli/commands/install.js";
import { listCommand, type ListArgs } from "./cli/commands/list.js";
import { mcpCommand, type McpArgs } from "./cli/commands/mcp.js";
import { migrateCommand, type MigrateArgs } from "./cli/commands/migrate.js";
import { searchCommand, type SearchArgs } from "./cli/commands/search.js";
import { stateRepairCommand, type StateRepairArgs } from "./cli/commands/state.js";
import { disableCommand, enableCommand, type ToggleArgs } from "./cli/commands/toggle.js";
import { validateCommand, type ValidateArgs } from "./cli/commands/validate.js";
import { readPackageVersion } from "./package-version.js";

const listModule: CommandModule<unknown, ListArgs> = {
  command: "list",
  describe: "List all available skills",
  builder: (cmd: Argv<unknown>): Argv<ListArgs> =>
    cmd
      .option("format", {
        alias: "f",
        choices: ["plain", "json"] as const,
        default: "plain" as const,
      })
      .option("json", { type: "boolean", default: false, description: "Output JSON" })
      .option("redact-paths", {
        type: "boolean",
        default: false,
        description: "Redact absolute paths (relative/home/basename output for paste & logs)",
      })
      .option("all", {
        type: "boolean",
        default: false,
        description: "Show enabled and disabled skills",
      })
      .option("disabled", {
        type: "boolean",
        default: false,
        description: "Show only disabled skills",
      })
      .option("include", { type: "array", string: true, description: "Include filters" })
      .option("exclude", { type: "array", string: true, description: "Exclude filters" })
      .option("claude-plugins-file", {
        type: "string",
        description: "Path to Claude installed_plugins.json",
      })
      .option("claude-plugins-root", { type: "string", description: "Root dir for Claude plugins" })
      .option("scan-default-dirs", {
        type: "boolean",
        default: true,
        description: "Scan built-in workspace/user agent skill directories",
      }) as Argv<ListArgs>,
  handler: listCommand,
};

const infoModule: CommandModule<unknown, InfoArgs> = {
  command: "info <name>",
  describe: "Show detailed info for a skill",
  builder: (cmd: Argv<unknown>): Argv<InfoArgs> =>
    cmd
      .positional("name", { type: "string", demandOption: true })
      .option("full", {
        type: "boolean",
        default: false,
        description: "Print the full SKILL.md document (explicit file read; not with --json)",
      })
      .option("json", { type: "boolean", default: false })
      .option("redact-paths", {
        type: "boolean",
        default: false,
        description: "Redact absolute paths (relative/home/basename output for paste & logs)",
      })
      .option("include", { type: "array", string: true, description: "Include filters" })
      .option("exclude", { type: "array", string: true, description: "Exclude filters" })
      .option("all", {
        type: "boolean",
        default: false,
        description: "Include enabled and disabled skills",
      })
      .option("disabled", {
        type: "boolean",
        default: false,
        description: "Include only disabled skills",
      })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<InfoArgs>,
  handler: infoCommand,
};

const searchModule: CommandModule<unknown, SearchArgs> = {
  command: "search <query>",
  describe: "Search for skills",
  builder: (cmd: Argv<unknown>): Argv<SearchArgs> =>
    cmd
      .positional("query", { type: "string", demandOption: true })
      .option("content", {
        type: "boolean",
        default: false,
        description: "Search inside SKILL.md content",
      })
      .option("limit", { type: "number", default: 10, description: "Maximum results to display" })
      .option("format", {
        alias: "f",
        choices: ["plain", "json"] as const,
        default: "plain" as const,
      })
      .option("include", { type: "array", string: true, description: "Include filters" })
      .option("exclude", { type: "array", string: true, description: "Exclude filters" })
      .option("all", {
        type: "boolean",
        default: false,
        description: "Include enabled and disabled skills",
      })
      .option("disabled", {
        type: "boolean",
        default: false,
        description: "Include only disabled skills",
      })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<SearchArgs>,
  handler: searchCommand,
};

const validateModule: CommandModule<unknown, ValidateArgs> = {
  command: "validate <path>",
  describe: "Validate a SKILL.md or skill directory",
  builder: (cmd: Argv<unknown>): Argv<ValidateArgs> =>
    cmd
      .positional("path", { type: "string", demandOption: true })
      .option("json", { type: "boolean", default: false })
      .option("include", { type: "array", string: true })
      .option("exclude", { type: "array", string: true })
      .option("all", {
        type: "boolean",
        default: false,
        description: "Include enabled and disabled skills",
      })
      .option("disabled", {
        type: "boolean",
        default: false,
        description: "Validate only disabled skills",
      })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" }) as Argv<ValidateArgs>,
  handler: validateCommand,
};

const mcpModule: CommandModule<unknown, McpArgs> = {
  command: "mcp",
  describe: "Start MCP server",
  builder: (cmd: Argv<unknown>): Argv<McpArgs> =>
    cmd
      .option("refresh-interval", {
        type: "number",
        description: "Auto refresh interval (ms)",
        default: 30000,
      })
      .option("refresh", {
        type: "boolean",
        default: true,
        description: "Auto refresh the registry (use --no-refresh to disable)",
      })
      .option("transport", {
        choices: ["stdio", "http", "sse"] as const,
        default: "stdio" as const,
        description: "Transport for MCP server",
      })
      .option("port", {
        type: "number",
        description: "Port for HTTP/SSE transport",
        default: 3000,
      })
      .option("host", {
        type: "string",
        description: "Host for HTTP/SSE transport",
        default: "127.0.0.1",
      })
      .option("include", { type: "array", string: true })
      .option("exclude", { type: "array", string: true })
      .option("all", {
        type: "boolean",
        default: false,
        description: "Include enabled and disabled skills",
      })
      .option("disabled", {
        type: "boolean",
        default: false,
        description: "Include only disabled skills",
      })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<McpArgs>,
  handler: mcpCommand,
};

const installModule: CommandModule<unknown, InstallArgs> = {
  command: "install [source]",
  describe:
    "Install ccski workflow instructions, or install a skill directory as entity + agent projections (kernel)",
  builder: (cmd: Argv<unknown>): Argv<InstallArgs> =>
    cmd
      .positional("source", {
        type: "string",
        description:
          "Optional local skill directory (contains SKILL.md). Omit to install ccski workflow instructions.",
      })
      .option("agent", {
        alias: "A",
        type: "array",
        string: true,
        description:
          "Projection target agent (repeatable, or '*' for the full registry). Workflow install target when no source is given.",
      })
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description:
          "Project to the global scope (default: project scope in the current directory)",
      })
      .option("scope", {
        choices: ["user", "project"] as const,
        default: "user" as const,
        description: "Workflow install scope when no source is provided",
      })
      .option("user", {
        type: "boolean",
        default: false,
        description: "Install workflow instructions at user scope",
      })
      .option("project", {
        type: "boolean",
        default: false,
        description: "Install workflow instructions in the current project",
      })
      .option("force", {
        type: "boolean",
        default: false,
        description: "Replace an existing same-name entity (explicit expectedRevision replace)",
      })
      .option("override", { type: "boolean", default: false, description: "Alias for --force" })
      .option("interactive", {
        alias: "i",
        type: "boolean",
        default: false,
        description: "Interactively choose workflow targets (requires TTY)",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        description: "Preview the planned projection without writing",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        description: "Fall back to the full agent registry when no agent is detected",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output typed receipts as JSON",
      }) as Argv<InstallArgs>,
  handler: installCommand,
};

const disableModule: CommandModule<unknown, ToggleArgs> = {
  command: "disable [names...]",
  describe: "Disable ccski projections (link = unlink, materialized = .SKILL.md rename)",
  builder: (cmd: Argv<unknown>): Argv<ToggleArgs> =>
    cmd
      .positional("names", { type: "string", array: true })
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description: "Operate on the global scope (default: project scope)",
      })
      .option("interactive", {
        alias: "i",
        type: "boolean",
        default: false,
        description: "Interactively choose entities to disable",
      })
      .option("all", {
        alias: "a",
        type: "boolean",
        default: false,
        description: "Disable all recorded entities in scope",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        description: "Skip confirmation prompt",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output typed receipts as JSON",
      }) as Argv<ToggleArgs>,
  handler: disableCommand,
};

const enableModule: CommandModule<unknown, ToggleArgs> = {
  command: "enable [names...]",
  describe: "Enable ccski projections (link = rebuild after ENTITY_REVISED gate)",
  builder: (cmd: Argv<unknown>): Argv<ToggleArgs> =>
    cmd
      .positional("names", { type: "string", array: true })
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description: "Operate on the global scope (default: project scope)",
      })
      .option("interactive", {
        alias: "i",
        type: "boolean",
        default: false,
        description: "Interactively choose entities to enable",
      })
      .option("all", {
        alias: "a",
        type: "boolean",
        default: false,
        description: "Enable all recorded entities in scope",
      })
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        description: "Skip confirmation prompt",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output typed receipts as JSON",
      }) as Argv<ToggleArgs>,
  handler: enableCommand,
};

const migrateModule: CommandModule<unknown, MigrateArgs> = {
  command: "migrate",
  describe:
    "Adopt legacy materialized skill directories as ccski entities + projections (dry-run by default)",
  builder: (cmd: Argv<unknown>): Argv<MigrateArgs> =>
    cmd
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description: "Migrate the global scope (default: project scope)",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        description: "Print the migration plan without writing (default when --execute is absent)",
      })
      .option("execute", {
        type: "boolean",
        default: false,
        description: "Execute the migration (expected-hash guarded, backup/journal rollback)",
      })
      .option("root", {
        type: "array",
        string: true,
        description: "Extra projection roots to scan for legacy copies (repeatable)",
      })
      .option("plan", {
        type: "string",
        description: "Path to a dry-run plan JSON; execution guards against its pinned hashes",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output the plan/receipts as JSON",
      }) as Argv<MigrateArgs>,
  handler: migrateCommand,
};

const gcModule: CommandModule<unknown, GcArgs> = {
  command: "gc",
  describe: "Propose retiring state records whose roots vanished (dry-run only in 3.0)",
  builder: (cmd: Argv<unknown>): Argv<GcArgs> =>
    cmd
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description: "Inspect the global scope (default: project scope)",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        description: "Required: gc is proposal-only in 3.0 and never deletes",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output proposals as JSON",
      }) as Argv<GcArgs>,
  handler: gcCommand,
};

const stateModule: CommandModule<unknown, StateRepairArgs> = {
  command: "state <action>",
  describe: "ccski state maintenance",
  builder: (cmd: Argv<unknown>): Argv<StateRepairArgs> =>
    cmd
      .positional("action", {
        choices: ["repair"] as const,
        demandOption: true,
        description: "repair: scan vs sidecar diff + --confirm + pre-repair backup",
      })
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description: "Repair the global scope (default: project scope)",
      })
      .option("confirm", {
        type: "boolean",
        default: false,
        description: "Apply the repair (absent: diff only + typed REPAIR_CONFIRM_REQUIRED)",
      })
      .option("root", {
        type: "array",
        string: true,
        description: "Extra roots to include in the scan (repeatable)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output the diff/receipt as JSON",
      }) as Argv<StateRepairArgs>,
  handler: stateRepairCommand,
};

const importModule: CommandModule<unknown, ImportArgs> = {
  command: "import <path>",
  describe: "Adopt an unregistered symlink as a ccski link projection (--claim)",
  builder: (cmd: Argv<unknown>): Argv<ImportArgs> =>
    cmd
      .positional("path", {
        type: "string",
        demandOption: true,
        description: "Symlink path to adopt",
      })
      .option("claim", {
        type: "boolean",
        default: false,
        description: "Adopt the link as a ccski projection (state-only change)",
      })
      .option("inode", {
        type: "number",
        description: "Expected target directory inode (identity guard; observe via --observe)",
      })
      .option("hash", {
        type: "string",
        description: "Expected target content hash, 64 hex (identity guard; observe via --observe)",
      })
      .option("observe", {
        type: "boolean",
        default: false,
        description: "Print the target's inode/hash without changing state",
      })
      .option("global", {
        alias: "g",
        type: "boolean",
        default: false,
        description: "Claim against the global scope (default: project scope)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Output typed receipts as JSON",
      }) as Argv<ImportArgs>,
  handler: importCommand,
};

await yargs(hideBin(process.argv))
  .scriptName("ccski")
  .usage("$0 <command> [options]")
  .option("no-color", {
    type: "boolean",
    description: "Disable colored output",
    default: false,
  })
  .option("color", {
    type: "boolean",
    description: "Force enable colored output",
    default: undefined,
  })
  .option("skill-dir", {
    type: "array",
    string: true,
    description:
      "Additional skill directories (default scope 'other', use ?scope=name to override)",
  })
  .option("user-dir", {
    type: "string",
    description: "Override user directory for default skill roots",
    default: homedir(),
  })
  .command(listModule)
  .command(infoModule)
  .command(searchModule)
  .command(validateModule)
  .command(mcpModule)
  .command(installModule)
  .command(disableModule)
  .command(enableModule)
  .command(migrateModule)
  .command(gcModule)
  .command(stateModule)
  .command(importModule)
  .demandCommand(1, "Please provide a command")
  .strict()
  .help()
  .alias("h", "help")
  .version(readPackageVersion())
  .alias("v", "version")
  .parse();
