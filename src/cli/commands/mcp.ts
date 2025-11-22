import type { ArgumentsCamelCase } from "yargs";
import { startMCPServer, type MCPServerOptions } from "../../mcp/server.js";
import type { SkillRegistryOptions } from "../../core/registry.js";
import { buildRegistryOptions } from "../registry-options.js";

export interface McpArgs extends SkillRegistryOptions {
  refreshInterval?: number;
  noRefresh?: boolean;
  noPlugins?: boolean;
  skillDir?: string[];
  scanDefaultDirs?: boolean;
  pluginsFile?: string;
  pluginsRoot?: string;
  noColor?: boolean;
  json?: boolean;
  transport?: "stdio" | "sse" | "http";
  port?: number;
  host?: string;
}

export async function mcpCommand(argv: ArgumentsCamelCase<McpArgs>): Promise<void> {
  const options = buildRegistryOptions(argv);
  const serverOptions = {
    ...options,
    autoRefresh: argv.noRefresh ? false : true,
    transport: argv.transport,
    port: argv.port,
    host: argv.host,
  } as MCPServerOptions;

  if (typeof argv.refreshInterval === "number") {
    serverOptions.refreshInterval = argv.refreshInterval;
  }

  await startMCPServer(serverOptions);
}
