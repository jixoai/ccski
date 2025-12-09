#!/usr/bin/env node

import { homedir } from "node:os";
import yargs, { type Argv, type CommandModule } from "yargs";
import { hideBin } from "yargs/helpers";
import { infoCommand, type InfoArgs } from "./cli/commands/info.js";
import { listCommand, type ListArgs } from "./cli/commands/list.js";
import { mcpCommand, type McpArgs } from "./cli/commands/mcp.js";
import { searchCommand, type SearchArgs } from "./cli/commands/search.js";
import { validateCommand, type ValidateArgs } from "./cli/commands/validate.js";
import { installCommand, type InstallArgs } from "./cli/commands/install.js";
import { disableCommand, enableCommand, type ToggleArgs } from "./cli/commands/toggle.js";

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
      .option("claude-plugins-file", { type: "string", description: "Path to Claude installed_plugins.json" })
      .option("claude-plugins-root", { type: "string", description: "Root dir for Claude plugins" })
      .option("scan-default-dirs", {
        type: "boolean",
        default: true,
        description: "Scan built-in .agent/.claude directories",
      }) as Argv<ListArgs>,
  handler: listCommand,
};

const infoModule: CommandModule<unknown, InfoArgs> = {
  command: "info <name>",
  describe: "Show detailed info for a skill",
  builder: (cmd: Argv<unknown>): Argv<InfoArgs> =>
    cmd
      .positional("name", { type: "string", demandOption: true })
      .option("full", { type: "boolean", default: false, description: "Show full SKILL.md" })
      .option("json", { type: "boolean", default: false })
      .option("include", { type: "array", string: true, description: "Include filters" })
      .option("exclude", { type: "array", string: true, description: "Exclude filters" })
      .option("all", { type: "boolean", default: false, description: "Include enabled and disabled skills" })
      .option("disabled", { type: "boolean", default: false, description: "Include only disabled skills" })
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
      .option("all", { type: "boolean", default: false, description: "Include enabled and disabled skills" })
      .option("disabled", { type: "boolean", default: false, description: "Include only disabled skills" })
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
      .option("all", { type: "boolean", default: false, description: "Include enabled and disabled skills" })
      .option("disabled", { type: "boolean", default: false, description: "Validate only disabled skills" })
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
      .option("no-refresh", { type: "boolean", description: "Disable auto refresh" })
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
      .option("all", { type: "boolean", default: false, description: "Include enabled and disabled skills" })
      .option("disabled", { type: "boolean", default: false, description: "Include only disabled skills" })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<McpArgs>,
  handler: mcpCommand,
};

const installModule: CommandModule<unknown, InstallArgs> = {
  command: "install <source>",
  describe: "Install a skill into .claude/skills",
  builder: (cmd: Argv<unknown>): Argv<InstallArgs> =>
    cmd
      .positional("source", { type: "string", demandOption: true })
      .option("out-dir", { type: "array", string: true, description: "Destination directory (repeatable)" })
      .option("out-scope", {
        type: "array",
        string: true,
        description: "Destination scope claude|claude:@project|claude:@user|codex|codex:@user",
      })
      .option("force", { type: "boolean", default: false, description: "Overwrite if skill already exists" })
      .option("override", { type: "boolean", default: false, description: "Alias for --force" })
      .option("path", { type: "string", description: "Explicit SKILL.md or marketplace.json path inside source" })
      .option("mode", {
        choices: ["git", "file"] as const,
        description: "Materialization mode (default: git for http/https sources, file otherwise)",
      })
      .option("branch", { type: "string", description: "Branch to checkout when using git mode" })
      .option("interactive", {
        alias: "i",
        type: "boolean",
        default: false,
        description: "Interactively choose skills (requires TTY)",
      })
      .option("all", { alias: "a", type: "boolean", default: false, description: "Install all discovered skills" })
      .option("include", { type: "array", string: true, description: "Filter skills to install" })
      .option("exclude", { type: "array", string: true, description: "Exclude skills from source" })
      .option("disabled", { type: "boolean", default: false, description: "Include only disabled skills from source" })
      .option("dry-run", { type: "boolean", default: false, description: "Preview what would be installed without installing" })
      .option("timeout", { type: "number", description: "Git clone timeout in milliseconds (default: 120000)" })
      .option("yes", { alias: "y", type: "boolean", default: false, description: "Skip confirmation prompt in interactive mode" })
      .option("json", { type: "boolean", default: false, description: "Output results as JSON" }) as Argv<InstallArgs>,
  handler: installCommand,
};

const disableModule: CommandModule<unknown, ToggleArgs> = {
  command: "disable [names...]",
  describe: "Disable skills by renaming SKILL.md to .SKILL.md",
  builder: (cmd: Argv<unknown>): Argv<ToggleArgs> =>
    cmd
      .positional("names", { type: "string", array: true })
      .option("include", { type: "array", string: true })
      .option("exclude", { type: "array", string: true })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" })
      .option("interactive", { alias: "i", type: "boolean", default: false, description: "Interactively choose skills to disable" })
      .option("all", { alias: "a", type: "boolean", default: false, description: "Disable all available skills" })
      .option("force", { alias: "f", type: "boolean", default: false, description: "Overwrite when both SKILL.md and .SKILL.md exist" })
      .option("override", { type: "boolean", default: false, description: "Alias for --force" })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<ToggleArgs>,
  handler: disableCommand,
};

const enableModule: CommandModule<unknown, ToggleArgs> = {
  command: "enable [names...]",
  describe: "Enable skills by restoring SKILL.md from .SKILL.md",
  builder: (cmd: Argv<unknown>): Argv<ToggleArgs> =>
    cmd
      .positional("names", { type: "string", array: true })
      .option("include", { type: "array", string: true })
      .option("exclude", { type: "array", string: true })
      .option("claude-plugins-file", { type: "string" })
      .option("claude-plugins-root", { type: "string" })
      .option("interactive", { alias: "i", type: "boolean", default: false, description: "Interactively choose skills to enable" })
      .option("all", { alias: "a", type: "boolean", default: false, description: "Enable all disabled skills" })
      .option("force", { alias: "f", type: "boolean", default: false, description: "Overwrite when both SKILL.md and .SKILL.md exist" })
      .option("override", { type: "boolean", default: false, description: "Alias for --force" })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<ToggleArgs>,
  handler: enableCommand,
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
    description: "Additional skill directories (default scope 'other', use ?scope=name to override)",
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
  .demandCommand(1, "Please provide a command")
  .strict()
  .help()
  .alias("h", "help")
  .alias("v", "version")
  .parse();
