import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { parse } from "node:url";
import type { SkillRegistryOptions } from "../core/registry.js";
import { SkillRegistry } from "../core/registry.js";
import type { Skill } from "../types/skill.js";

export interface MCPServerOptions extends SkillRegistryOptions {
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
  transport?: "stdio" | "sse" | "http";
  host?: string;
  port?: number;
}

/**
 * Create and start an MCP server for skill management
 */
export async function startMCPServer(options: MCPServerOptions = {}): Promise<void> {
  const registry = new SkillRegistry(options);
  const transportKind = options.transport ?? "stdio";
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;

  const createServer = (): Server => {
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

    const buildSkillToolDescription = (): string => buildSkillDescription(registry);

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

    return server;
  };

  // Auto-refresh if enabled (default 30 seconds)
  if (options.autoRefresh !== false) {
    const interval = options.refreshInterval ?? 30000;
    setInterval(() => {
      registry.refresh();
      console.error(`[ccski] Registry refreshed at ${new Date().toISOString()}`);
    }, interval);
  }

  const shutdown = () => {
    console.error("[ccski] Shutting down...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (transportKind === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("[ccski] MCP server started on stdio");
    console.error(`[ccski] Discovered ${registry.getAll().length} skills`);
    if (options.autoRefresh !== false) {
      console.error(`[ccski] Auto-refresh enabled (every ${options.refreshInterval ?? 30000}ms)`);
    }
    return;
  }

  if (transportKind === "http") {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    await server.connect(transport);

    const httpServer = createHttpServer(async (req, res) => {
      if (!req.url) {
        res.statusCode = 404;
        res.end();
        return;
      }

      const url = parse(req.url, true);
      if (url.pathname !== "/mcp") {
        res.statusCode = 404;
        res.end();
        return;
      }

      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("[ccski] Failed to handle HTTP MCP request", error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      }
    });

    httpServer.listen(port, host, () => {
      console.error(`[ccski] MCP Streamable HTTP server listening on http://${host}:${port}/mcp`);
      console.error(`[ccski] Discovered ${registry.getAll().length} skills`);
    });

    return;
  }

  // SSE transport (deprecated protocol but kept for compatibility)
  const transports = new Map<string, { transport: SSEServerTransport; server: Server }>();
  const messagePath = "/messages";

  const httpServer = createHttpServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const url = parse(req.url, true);

    if (req.method === "GET" && url.pathname === "/mcp") {
      const transport = new SSEServerTransport(messagePath, res);
      const server = createServer();
      transports.set(transport.sessionId, { transport, server });

      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };

      try {
        await server.connect(transport);
      } catch (error) {
        console.error("[ccski] Failed to establish SSE session", error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Failed to establish SSE session");
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === messagePath) {
      const sessionId = url.query.sessionId;
      if (typeof sessionId !== "string") {
        res.statusCode = 400;
        res.end("Missing sessionId");
        return;
      }

      const entry = transports.get(sessionId);
      if (!entry) {
        res.statusCode = 404;
        res.end("Unknown session");
        return;
      }

      try {
        const postReq = req as Parameters<(typeof entry.transport)["handlePostMessage"]>[0];
        const postRes = res as Parameters<(typeof entry.transport)["handlePostMessage"]>[1];
        await entry.transport.handlePostMessage(postReq, postRes);
      } catch (error) {
        console.error("[ccski] Failed to handle SSE message", error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Failed to handle request");
        }
      }
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  httpServer.listen(port, host, () => {
    console.error(
      `[ccski] MCP SSE server listening on http://${host}:${port}/mcp (messages at ${messagePath})`
    );
    console.error(`[ccski] Discovered ${registry.getAll().length} skills`);
  });
}

export function buildSkillDescription(registry: SkillRegistry): string {
  const skills = registry.getAll();
  const diagnostics = registry.getDiagnostics();

  const exampleCommands = skills.slice(0, 2).map((skill) => `  - command: "${skill.name}"`);

  const skillBlocks = skills
    .map((skill) => {
      const location = skill.location === "user" ? "global" : skill.location;
      return [
        "<skill>",
        `<name>${skill.name}</name>`,
        `<description>${skill.description}</description>`,
        `<location>${location}</location>`,
        "</skill>",
      ].join("\n");
    })
    .join("\n");

  const discoveryLines = [
    "- `<available_skills>` is generated from the skills discovered on this machine at runtime.",
    "- Discovery scans project and user skill directories",
  ];

  if (diagnostics.pluginSources.length > 0) {
    discoveryLines.push(`- Plugin skills loaded from: ${diagnostics.pluginSources.join(", ")}`);
  }

  const exampleSection =
    exampleCommands.length > 0 ? ["- Examples:", ...exampleCommands].join("\n") : "";

  const instructions = `Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

Source of truth:
${discoveryLines.join("\n")}

How to use skills:
- Invoke this tool with the skill name only (case-insensitive)
- The skill's prompt will expand and provide detailed instructions on how to complete the task
${exampleSection}

Important:
- Only use skills listed in <available_skills> below (this list reflects what is actually installed)
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
</skills_instructions>`;
  const available = `<available_skills>\n${skillBlocks || "<skill>\n<name>none</name>\n<description>No skills discovered</description>\n<location>none</location>\n</skill>"}\n</available_skills>`;

  return `${instructions}\n\n${available}`;
}

export function formatSkillContent(skill: Skill): string {
  const header = [
    `name: ${skill.name}`,
    `path: ${skill.path}`,
    `location: ${skill.location}`,
    skill.pluginInfo
      ? `plugin: ${skill.pluginInfo.pluginName}@${skill.pluginInfo.marketplace}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${header}\n\n${skill.content}`;
}
