# Change: Add ccski - Claude Code Skills Manager

## Why

Claude Code 的 skills 系统是一个强大的功能,能够通过动态加载专业知识来扩展 AI Agent 的能力。然而,这个功能目前只能在 Claude Code 中使用,其他 AI Agent (如 Cursor、Windsurf、Aider 等) 无法直接使用这些 skills。

现有的两个参考实现:
- **openskills**: 基于 CLI 的实现,但不支持 Claude Code 插件市场安装的 skills
- **universal-skills**: 基于 MCP 的实现,但不支持插件市场,且功能相对简单

我们需要一个 **完整的** 解决方案,既支持 CLI 接口(方便人类用户),又支持 MCP 接口(方便 AI Agent),并且能够完整支持 Claude Code 的所有 skills 来源,包括插件市场。

## What Changes

创建一个名为 **ccski** 的 TypeScript 命令行工具,提供以下核心能力:

1. **完整的 Skill 发现机制**
   - 扫描用户级和项目级 skills 目录 (`~/.claude/skills/`, `$PWD/.claude/skills/`, `~/.agent/skills/`, `$PWD/.agent/skills/`)
   - 支持 Claude Code 插件市场安装的 skills (通过 `~/.claude/plugins/installed_plugins.json`)
   - 实现优先级解析(项目级 > 全局级,agent > claude)

2. **CLI 接口** (面向人类用户)
   - `ccski list` - 列出所有可用的 skills
   - `ccski info <skill-name>` - 显示 skill 的详细信息
   - `ccski search <query>` - 搜索 skills
   - `ccski validate <path>` - 验证 skill 格式
   - `ccski mcp` - 启动 MCP 服务器

3. **MCP 接口** (面向 AI Agent)
   - 提供 `skill` tool,支持动态加载 skill 内容
   - 在 tool description 中列出所有可用的 skills
   - 支持自动刷新(30秒间隔)
   - 提供 MCP resources 作为备选访问方式

4. **插件市场支持**
   - 解析 `installed_plugins.json` 获取已安装插件
   - 递归搜索插件目录中的 `SKILL.md` 文件
   - 支持命名空间格式 (`plugin-name:skill-name`)
   - 支持短名称(无歧义时)

5. **类型安全实现**
   - 100% TypeScript 类型安全(禁用 `any`)
   - 使用 Zod 进行运行时验证
   - 使用 ts-pattern 进行类型安全的分支处理

6. **完善的测试**
   - 使用 vitest + jsdom 进行单元测试
   - 使用 MCP 测试工具进行集成测试
   - 目标代码覆盖率 >80%

## Impact

**影响的能力 (Capabilities)**:
- 新增: `skill-discovery` - Skill 发现和注册
- 新增: `skill-parsing` - SKILL.md 解析和验证
- 新增: `cli-interface` - 命令行接口
- 新增: `mcp-interface` - MCP 服务器接口
- 新增: `plugin-support` - 插件市场支持

**影响的代码**:
- 新项目,无现有代码影响
- 依赖于外部工具: `tsdown`(构建), `vitest`(测试), MCP SDK

**用户影响**:
- ✅ Claude Code 用户可以继续使用原生 skills 系统,无影响
- ✅ 其他 AI Agent 用户可以通过 MCP 接口使用所有 Claude Code skills
- ✅ 开发者可以通过 CLI 管理和调试 skills
- ✅ 支持多 Agent 环境(Claude Code + Cursor + Windsurf 等)

**兼容性**:
- 完全兼容 Claude Code 的 SKILL.md 格式
- 完全兼容插件市场的目录结构
- 向后兼容 openskills 和 universal-skills 的使用方式
