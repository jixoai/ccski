# ccski – Claude Code 技能管理器

ccski 是一个面向 CLI 与 MCP 的工具，用于发现、安装、启用/禁用并通过 MCP 提供 Claude Code 兼容的技能。本文档聚焦安装与使用；架构与设计哲学请看 `SPEC.md`。

## 安装

需要 Node.js >= 20。

```bash
# 直接运行
npx ccski --help

# 或本地安装后使用
pnpm install ccski
ccski --help
```

## 快速开始

### 启动 MCP 服务器

```bash
npx ccski mcp
```

- 追加技能根目录：`npx ccski mcp --skill-dir /extra/skills`
- 关闭自动刷新：`npx ccski mcp --no-refresh`

MCP 插件配置示例（Codex/Cursor/Windsurf/VS Code）：

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

### 核心 CLI 命令

| 命令 | 用途 |
| --- | --- |
| `ccski list` | 列出已发现技能（项目、本机、插件） |
| `ccski info <name>` | 查看技能元数据和内容预览 |
| `ccski install <source> [-i|--all|--path]` | 从 git/目录/marketplace/SKILL.md 安装，支持交互选择 |
| `ccski enable [names...] [-i|--all]` | 启用技能（`.SKILL.md` -> `SKILL.md`） |
| `ccski disable [names...] [-i|--all]` | 禁用技能（`SKILL.md` -> `.SKILL.md`） |
| `ccski validate <path>` | 校验 SKILL.md 或技能目录 |
| `ccski mcp` | 启动 MCP 服务器（stdio/http/sse） |

### 安装示例

- Git 仓库（自动识别 marketplace）：
  `ccski install https://github.com/wshobson/agents`
- 指定分支或路径：
  `ccski install https://github.com/wshobson/agents/tree/main --branch main`
  `ccski install https://github.com/wshobson/agents --path skills/foo/SKILL.md`
- 本地目录或单个文件：
  `ccski install /path/to/skills --mode file`
  `ccski install ./plugins/foo/SKILL.md`
- 覆盖已有技能：添加 `--force`（或 `--override`）。

### 启用/禁用

```bash
# 交互式启用
ccski enable -i

# 批量禁用所有已启用技能
ccski disable --all
```

## 更多

- Claude 用户：建议 `ccski mcp --exclude=claude`，避免回显内置 Claude skills。
- Codex 用户：建议 `ccski mcp --exclude=codex`，避免回显内置 Codex skills。
- 所有命令支持 `--json` 便于脚本化。
- 用 `--no-color` 关闭颜色，或 `--color` 强制开启。
- 详细技术与设计理念请查看 `SPEC.md`。

## 致谢

- [openskills](https://github.com/numman-ali/openskills) — 建立了 SKILL.md 编写规范；ccski 遵循该规范。
- [universal-skills](https://github.com/klaudworks/universal-skills) — MCP 优先的技能集；ccski 专注于管理，而非打包内容。
