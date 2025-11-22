#!/usr/bin/env node

import yargs, { type Argv, type CommandModule } from "yargs";
import { hideBin } from "yargs/helpers";
import { infoCommand, type InfoArgs } from "./cli/commands/info.js";
import { listCommand, type ListArgs } from "./cli/commands/list.js";
import { mcpCommand, type McpArgs } from "./cli/commands/mcp.js";
import { searchCommand, type SearchArgs } from "./cli/commands/search.js";
import { validateCommand, type ValidateArgs } from "./cli/commands/validate.js";

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
      .option("format", {
        alias: "f",
        choices: ["plain", "json"] as const,
        default: "plain" as const,
      })
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<SearchArgs>,
  handler: searchCommand,
};

const validateModule: CommandModule<unknown, ValidateArgs> = {
  command: "validate <path>",
  describe: "Validate a SKILL.md or skill directory",
  builder: (cmd: Argv<unknown>): Argv<ValidateArgs> =>
    cmd.positional("path", { type: "string", demandOption: true }) as Argv<ValidateArgs>,
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
      .option("scan-default-dirs", { type: "boolean", default: true }) as Argv<McpArgs>,
  handler: mcpCommand,
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
  .option("json", {
    type: "boolean",
    description: "Output JSON when supported",
    default: false,
  })
  .option("skill-dir", {
    type: "array",
    string: true,
    description: "Additional skill directories (highest priority)",
  })
  .option("no-plugins", {
    type: "boolean",
    description: "Skip plugin skills",
    default: false,
  })
  .option("plugins-file", {
    type: "string",
    description: "Custom path to installed_plugins.json",
  })
  .option("plugins-root", {
    type: "string",
    description: "Root directory for plugin install paths",
  })
.command(listModule)
  .command(infoModule)
  .command(searchModule)
  .command(validateModule)
  .command(mcpModule)
  .demandCommand(1, "Please provide a command")
  .strict()
  .help()
  .alias("h", "help")
  .alias("v", "version")
  .parse();
