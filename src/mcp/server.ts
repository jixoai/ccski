import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SkillRegistry } from "../core/registry.js";
import type { SkillRegistryOptions } from "../core/registry.js";
import type { Skill } from "../types/skill.js";

export interface MCPServerOptions extends SkillRegistryOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

/**
 * Create and start an MCP server for skill management
 */
export async function startMCPServer(options: MCPServerOptions = {}): Promise<void> {
  const server = new Server(
    {
      name: "ccski",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const registry = new SkillRegistry(options);

  // Auto-refresh if enabled (default 30 seconds)
  if (options.autoRefresh !== false) {
    const interval = options.refreshInterval ?? 30000;
    setInterval(() => {
      registry.refresh();
      console.error(`[ccski] Registry refreshed at ${new Date().toISOString()}`);
    }, interval);
  }

  const buildSkillToolDescription = (): string => buildSkillDescription(registry);

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "skill",
          description: buildSkillToolDescription(),
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The skill name to load (case-insensitive)",
              },
            },
            required: ["name"],
          },
        },
      ],
    };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "skill") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const skillName = request.params.arguments?.name;
    if (typeof skillName !== "string") {
      throw new Error("Skill name must be a string");
    }

    try {
      const skill = registry.load(skillName);
      return {
        content: [
          {
            type: "text",
            text: formatSkillContent(skill),
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load skill: ${error.message}`);
      }
      throw error;
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[ccski] MCP server started");
  console.error(`[ccski] Discovered ${registry.getAll().length} skills`);
  if (options.autoRefresh !== false) {
    console.error(`[ccski] Auto-refresh enabled (every ${options.refreshInterval ?? 30000}ms)`);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.error("[ccski] Shutting down...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export function buildSkillDescription(registry: SkillRegistry): string {
  const skills = registry.getAll();
  const skillList = skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `Load a skill by name to get specialized instructions.

Available skills:
${skillList}

Usage: Invoke with the skill name to load its full content.`;
}

export function formatSkillContent(skill: Skill): string {
  return `Loading: ${skill.name}
Base directory: ${skill.path}

${skill.content}`;
}
