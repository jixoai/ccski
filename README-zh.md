# ccski – Claude Code 技能管理器

ccski 是一个同时面向 **CLI** 与 **MCP 服务器** 的工具，让任何 AI 编程助手都能发现、安装、启用/禁用并提供 Claude Code 兼容的技能。它轻量、类型安全，便于嵌入编辑器或代理工作流。

## 1）定位 & MCP 快速上手

- **它是什么**：面向 SKILL.md 技能包（本地目录、git 仓库、插件市场）的“管家”。
- **谁在用**：需要人类可操作 CLI、也需要 Agent 通过 MCP 连接的场景。

### 一行启动 MCP

```bash
npx ccski mcp
```

常见 MCP 注册方式：

- **Codex CLI**：`codex mcp add skills -- npx ccski mcp`
- **Cursor / Windsurf / VS Code MCP 插件**（配置片段）：

```json
{
  "mcpServers": {
    "ccski": {
      "command": "npx",
      "args": ["ccski", "mcp"]
    }
  }
}
```

可用 `--skill-dir` 追加技能根目录，或用 `--no-refresh` 关闭实时刷新。

## 2）面向人的核心 CLI

| 命令                                        | 作用                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `ccski list`                                | 按优先级列出已发现技能（项目、本机、插件市场）并显示状态         |
| `ccski info <name>`                         | 查看元数据与内容预览                                             |
| `ccski install <source> [-i\|--all\|--use]` | 从 git/目录/marketplace 安装；交互式选择器会显示可复制的最终命令 |
| `ccski enable [names...] [-i\|--all]`       | `.SKILL.md` → `SKILL.md`；交互模式默认**不选中**                 |
| `ccski disable [names...] [-i\|--all]`      | 反向操作，将技能禁用                                             |
| `ccski mcp`                                 | 启动 MCP（stdio/http/sse）                                       |
| `ccski validate <path>`                     | 校验 SKILL.md 或技能目录结构                                     |

install/enable/disable 的交互式选择器共享同一套布局、颜色和“Command:” 实时预览，便于复制等效的非交互命令。

## 3）致谢 & 区别

- **openskills** —— 奠定了 SKILL.md 的编写模式；ccski 与其保持兼容。
- **universal-skills** —— 提供开箱即用的技能合集；ccski 侧重管理与传输，不内置技能内容。

核心区别：ccski 是管理/服务层（不打包技能语料），以 MCP 为中心，强调多根目录发现以及 install/enable/disable 的一致体验。

## 4）贡献者指南与架构速览

### 开发起步

- `pnpm install`
- `pnpm test`（Vitest）
- `pnpm ts`（类型检查）
- `pnpm build`（tsdown 打包）

### 架构地图

- 入口：`src/cli.ts`（yargs CLI，统一颜色开关）
- 命令：`src/cli/commands/*.ts`
- 交互 UI：`src/cli/prompts/multiSelect.ts`（共享复选 + 实时命令预览）
- 格式化：`src/utils/format.ts`（tone 颜色语义，避免裸用 colorette）
- 核心：`src/core/*`（发现、注册、解析）
- 测试：`tests/*.test.ts`（Vitest，部分 CLI e2e 走 bun runner）

推荐阅读顺序：`src/utils/format.ts` → `src/cli/prompts/multiSelect.ts` → 命令文件（install、toggle）→ `src/core/registry.ts`。

### 代码规范要点

- TypeScript 严格模式；避免 `any`/`as any`/`@ts-nocheck`（除非三方类型不可控）。
- CLI 颜色统一用 `tone/heading/warn/info/success/error`，不要直接调用 colorette。
- 单文件尽量 <200 行，复杂度上升时拆文件夹。
- 测试优先：Vitest，交互逻辑走集成用例。
- 包管理统一 pnpm；脚本在 `package.json`。

### 常用脚本

```bash
pnpm install       # 安装依赖
pnpm test          # 全量测试
pnpm ts            # 类型检查
pnpm build         # tsdown 打包
pnpm fmt           # prettier + organize imports + tailwind 插件
```

欢迎贡献！
