import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ccski",
  description: "CLI + MCP server for managing Claude/Codex skills",
  base: "/ccski/",
  themeConfig: {
    nav: [
      { text: "CLI", link: "/cli/" },
      { text: "API", link: "/api/" },
    ],
    sidebar: {
      "/cli/": [
        {
          text: "CLI",
          items: [
            { text: "Overview", link: "/cli/" },
            { text: "List", link: "/cli/list" },
            { text: "Info", link: "/cli/info" },
            { text: "Search", link: "/cli/search" },
            { text: "Install", link: "/cli/install" },
            { text: "Enable/Disable", link: "/cli/toggle" },
            { text: "Validate", link: "/cli/validate" },
            { text: "MCP Server", link: "/cli/mcp" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API",
          items: [
            { text: "Overview", link: "/api/" },
            { text: "Skill APIs", link: "/api/skills" },
            { text: "Install APIs", link: "/api/install" },
            { text: "Toggle APIs", link: "/api/toggle" },
            { text: "MCP APIs", link: "/api/mcp" },
            { text: "Types", link: "/api/types" },
          ],
        },
      ],
    },
  },
});
