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
| `ccski install <source> [-i\|--all\|--path]` | 从 git/目录/marketplace 安装；交互式选择器会显示可复制的最终命令 |
| `ccski enable [names...] [-i\|--all]`       | `.SKILL.md` → `SKILL.md`；交互模式默认**不选中**                 |
| `ccski disable [names...] [-i\|--all]`      | 反向操作，将技能禁用                                             |
| `ccski mcp`                                 | 启动 MCP（stdio/http/sse）                                       |
| `ccski validate <path>`                     | 校验 SKILL.md 或技能目录结构                                     |

install/enable/disable 的交互式选择器共享同一套布局、颜色和“Command:” 实时预览，便于复制等效的非交互命令。

### install 详解

- **来源**：git URL（可配 `--branch`、`--path`，http/https 默认 `--mode git`）、本地目录/文件（`--mode file`）、`marketplace.json`、直接指向 `SKILL.md`。
- **粒度**：`-i/--interactive` 选择；`--all` 全选；额外位置参数可模糊匹配名称。
- **落盘位置**：默认写入项目 `.claude/skills`，用 `--global` 写入 `~/.claude/skills`。
- **覆盖策略**：已有同名技能时用 `--force/--override` 覆盖。

#### 示例

- 克隆 repo 的默认分支并自动读取 marketplace  
  `ccski install https://github.com/wshobson/agents`

- 克隆 repo 的指定分支并自动读取 marketplace
  `ccski install https://github.com/wshobson/agents/tree/main` 或者 `--branch main`

- 指向 repo 内的具体文件（自动 clone，识别 blob 路径）
  `ccski install https://github.com/wshobson/agents/blob/main/.claude-plugin/marketplace.json`

- 本地目录（不走 git）
  `ccski install /path/to/skills --mode file`

- 直接安装某个 SKILL.md
  `ccski install ./plugins/foo/SKILL.md`

### 与 “claude plugin install” 的区别

- **安装对象**：`claude plugin install` 安装的是 Claude 插件包（命令/元数据）；`ccski install` 复制的是 **SKILL.md 技能** 到 `.claude/skills`，专注技能本地化。
- **来源**：ccski 支持 git/本地/marketplace.json/单个 SKILL.md；Claude plugin 来自Git仓库来作为marketplace。
- **扩展方向**：~如有需求，可新增复制协议（如 `--mode=webdav|sftp`）或对 `llms.txt` 等源的安装支持。~

## 3）致谢 & 区别

- **openskills** —— 奠定了 SKILL.md 的编写模式；ccski 与其保持兼容。
- **universal-skills** —— 提供开箱即用的技能合集；ccski 侧重管理与传输，不内置技能内容。

融合与区别：

- 我们结合了 **universal-skills 的 MCP 理念** 和 **openskills 的 CLI 体验**，同一套工具既服务代理又服务人工操作。
- ccski 额外支持 **扫描 Claude Code 插件内自带的 skills**，这是 universal-skills 与 openskills 均未覆盖的能力。
- `install` 命令支持多种灵活写法（git/目录/SKILL.md/marketplace），`-i` 进入交互模式并提供实时的“一次性命令”预览。

总结：ccski 是管理/服务层（不内置技能语料），以 MCP 为中心，支持多根目录发现，并强化了 install/enable/disable 的一致交互体验。

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
