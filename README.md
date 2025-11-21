# ccski - Claude Code Skills Manager

**ccski** 是一个命令行工具,为 AI 编程助手提供 Claude Code Skills 系统的 CLI 和 MCP 接口。

## 特性

✅ **完整的 Skill 发现** - 支持用户目录、项目目录和 Claude Code 插件市场
✅ **双接口设计** - CLI (人类用户) + MCP (AI Agent)
✅ **插件市场支持** - 自动发现 Claude Code 安装的插件 skills
✅ **优先级解析** - 项目级覆盖全局级,避免冲突
✅ **命名空间** - `plugin:skill` 格式,支持短名称
✅ **类型安全** - 100% TypeScript,零 any

## 安装

```bash
# 通过 npm (待发布)
npm install -g ccski

# 通过 pnpm
pnpm add -g ccski

# 开发模式
git clone https://github.com/jixoai/ccski
cd ccski
pnpm install
pnpm dev <command>
```

## 使用方式

### CLI 命令

```bash
# 列出所有可用的 skills
ccski list

# 显示 skill 的详细信息
ccski info <skill-name>

# 搜索 skills (待实现)
ccski search <query>

# 验证 skill 格式 (待实现)
ccski validate <path>

# 启动 MCP 服务器
ccski mcp
```

### MCP 集成

将 ccski 添加到你的 AI Agent 的 MCP 配置中:

#### Claude Code

```bash
claude mcp add --transport stdio ccski -- npx ccski mcp
```

#### Cursor / Windsurf

在 MCP 配置文件中添加:

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

## Skill 发现

ccski 按优先级从以下目录发现 skills:

1. `$PWD/.agent/skills/` (项目 universal - 最高优先级)
2. `$PWD/.claude/skills/` (项目 Claude Code)
3. `~/.agent/skills/` (全局 universal)
4. `~/.claude/skills/` (全局 Claude Code)
5. Claude Code 插件市场 (最低优先级)

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm ts

# 运行测试
pnpm test

# 构建
pnpm build

# 格式化代码
pnpm fmt
```

## License

MIT
