# Design: ccski Architecture

## Context

ccski 需要桥接 Claude Code 的 skills 系统和其他 AI Agent。这涉及到:
- 理解 Claude Code 的 skills 目录结构和插件系统
- 提供两种接口(CLI 和 MCP)服务不同用户群体
- 保持与现有实现的兼容性,同时提供更完整的功能

### 相关约束
- 必须支持 Claude Code 的所有 skills 来源(用户目录、项目目录、插件市场)
- 必须保持类型安全(TypeScript + Zod)
- 必须是轻量级的(快速启动,低内存占用)
- 必须易于集成到各种 AI Agent 中

### 利益相关方
- **Claude Code 用户**: 希望在其他 Agent 中使用已有的 skills
- **其他 Agent 用户**: 希望使用 Claude Code 生态的 skills
- **Skill 开发者**: 希望 skill 能在多个 Agent 中使用
- **多 Agent 用户**: 希望在多个 Agent 间共享 skills

## Goals / Non-Goals

### Goals
- ✅ 完整支持 Claude Code 的 skills 发现机制(包括插件市场)
- ✅ 提供人类友好的 CLI 接口和 Agent 友好的 MCP 接口
- ✅ 保持 100% 类型安全
- ✅ 实现优先级解析,避免 skill 重复和冲突
- ✅ 支持 skill 的实时刷新和缓存

### Non-Goals
- ❌ 不实现 skill 的安装/卸载功能(用户使用 Claude Code 插件系统或手动管理)
- ❌ 不修改 SKILL.md 格式或创建新的 skill 格式
- ❌ 不提供 skill 的版本管理
- ❌ 不实现 skill 的依赖管理

## Decisions

### Decision 1: 双接口设计 (CLI + MCP)

**选择**: 同时提供 CLI 和 MCP 两种接口

**原因**:
- CLI 适合人类用户:调试、管理、验证 skills
- MCP 适合 AI Agent:标准化的工具调用协议
- 两者共享核心逻辑(skill 发现和解析),减少代码重复

**备选方案**:
1. 只实现 MCP (如 universal-skills)
   - ❌ 不方便人类调试和管理
   - ❌ 需要额外的工具来查看 skills

2. 只实现 CLI (如 openskills)
   - ❌ Agent 集成不标准化
   - ❌ 需要 Agent 调用 shell 命令,不够优雅

### Decision 2: 支持插件市场的完整实现

**选择**: 解析 `installed_plugins.json`,递归搜索插件目录

**原因**:
- Claude Code 插件市场有大量高质量 skills (example-skills, workflows 等)
- 用户已经通过 Claude Code 安装了这些插件,应该能在其他 Agent 中复用
- 这是 openskills 和 universal-skills 的主要缺陷

**实现细节**:
```typescript
// 1. 读取 installed_plugins.json
const plugins = JSON.parse(readFileSync('~/.claude/plugins/installed_plugins.json'))

// 2. 遍历每个插件的 installPath
for (const [pluginKey, plugin] of Object.entries(plugins.plugins)) {
  const [pluginName, marketplace] = pluginKey.split('@')

  // 3. 递归搜索 SKILL.md 文件
  const skillFiles = glob(`${plugin.installPath}/**/SKILL.md`)

  // 4. 解析并注册,使用命名空间
  for (const skillFile of skillFiles) {
    const skill = parseSkill(skillFile)
    registerSkill(`${pluginName}:${skill.name}`, skill)
  }
}
```

### Decision 3: 使用优先级目录解析

**选择**: 4 个目录,优先级从高到低
1. `$PWD/.agent/skills/` (项目级 universal)
2. `$PWD/.claude/skills/` (项目级 Claude Code)
3. `~/.agent/skills/` (全局 universal)
4. `~/.claude/skills/` (全局 Claude Code)
5. 插件市场 (最低优先级,仅在 list 时显示,读取时从 installPath)

**原因**:
- 项目级优先于全局:允许项目覆盖全局配置
- `.agent` 优先于 `.claude`:支持多 Agent 环境
- 插件作为基础,可被覆盖

**冲突解决**:
- 同名 skill 只保留优先级最高的
- 插件 skill 使用完全限定名 (`plugin:skill`) 避免冲突
- 短名称查找:无歧义时允许,有歧义时报错并提示

### Decision 4: MCP Tool 设计

**选择**: 单个 `skill` tool,在 description 中动态列出所有可用 skills

**原因**:
- Agent 无需额外调用即可发现所有 skills
- 符合 Claude Code 的设计(system prompt 中的 `<available_skills>`)
- 减少 Agent 的 token 消耗和交互轮次

**Tool Schema**:
```typescript
{
  name: "skill",
  description: `Load a skill by name to get specialized instructions.

Available skills:
- user: 用户的全局技能,必读!
- bun: Enhanced documentation skill for 'bun'
- example-skills:pdf: Comprehensive PDF manipulation toolkit
...

Usage: Invoke with the skill name to load its full content.`,
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The skill name to load (case-insensitive)"
      }
    },
    required: ["name"]
  }
}
```

**备选方案**: 提供 `list_skills` 和 `read_skill` 两个工具
- ❌ 需要 2 次调用才能加载 skill
- ❌ 增加了 Agent 的复杂度
- ✅ 但更符合 RESTful 风格

### Decision 5: 技术栈选择

| 技术 | 选择 | 原因 |
|------|------|------|
| 语言 | TypeScript | 类型安全,生态完善 |
| 运行时 | Node.js | 兼容性好,易于分发 |
| 构建工具 | tsdown | 快速,支持多种输出格式 |
| 测试框架 | vitest | 快速,与 TypeScript 集成好 |
| 验证库 | Zod | 类型安全的运行时验证 |
| MCP SDK | @modelcontextprotocol/sdk | 官方 SDK |
| CLI 框架 | 原生 | 避免过度依赖,保持轻量 |

**备选方案**:
- Bun: ❌ 生态不够成熟,兼容性问题
- Deno: ❌ npm 包分发不便
- Commander.js: ❌ 对于简单 CLI 来说过重

### Decision 6: 缓存和刷新策略

**选择**: 启动时扫描 + 30秒自动刷新

**原因**:
- 启动时扫描:保证首次调用的正确性
- 30秒刷新:平衡性能和实时性
- 自动刷新:无需重启 MCP 服务器

**实现**:
```typescript
class SkillRegistry {
  private skills: Map<string, Skill> = new Map()
  private refreshInterval: NodeJS.Timeout

  constructor() {
    this.refresh() // 初始扫描
    this.refreshInterval = setInterval(() => this.refresh(), 30000)
  }

  private async refresh() {
    const newSkills = await scanAllDirectories()
    this.skills = newSkills
  }
}
```

## Risks / Trade-offs

### Risk 1: 插件市场 JSON 格式变化
**风险**: Claude Code 更新可能改变 `installed_plugins.json` 格式

**缓解措施**:
- 使用 Zod schema 验证 JSON 格式
- 向后兼容旧格式
- 提供清晰的错误信息
- 单元测试覆盖多个版本的格式

### Risk 2: 性能问题(大量 skills)
**风险**: 扫描大量插件目录可能很慢

**缓解措施**:
- 使用并发扫描(`Promise.all`)
- 缓存扫描结果
- 增量刷新(检测文件变化)
- 提供 `--skip-plugins` 选项

### Risk 3: 与 Claude Code 原生功能的混淆
**风险**: 用户可能不清楚何时使用 ccski,何时使用 Claude Code 原生

**缓解措施**:
- 清晰的文档说明使用场景
- Claude Code 用户不需要 ccski(继续用原生)
- 其他 Agent 用户使用 ccski
- 多 Agent 环境推荐使用 `.agent/skills/`

### Risk 4: SKILL.md 格式的兼容性
**风险**: 不同来源的 SKILL.md 可能有细微差异

**缓解措施**:
- 宽松的解析(允许额外字段)
- 只验证必需字段(`name`, `description`)
- 提供 `validate` 命令帮助开发者检查
- 详细的错误信息和修复建议

## Migration Plan

### Phase 1: 核心功能 (Week 1)
- [ ] 实现 skill 发现(用户目录)
- [ ] 实现 SKILL.md 解析
- [ ] 实现优先级解析
- [ ] 单元测试

### Phase 2: 插件支持 (Week 1)
- [ ] 解析 installed_plugins.json
- [ ] 递归扫描插件目录
- [ ] 命名空间支持
- [ ] 集成测试

### Phase 3: MCP 接口 (Week 2)
- [ ] 实现 MCP 服务器
- [ ] 实现 skill tool
- [ ] 实现自动刷新
- [ ] MCP 集成测试

### Phase 4: CLI 接口 (Week 2)
- [ ] 实现 list 命令
- [ ] 实现 info 命令
- [ ] 实现 search 命令
- [ ] 实现 validate 命令
- [ ] CLI 集成测试

### Phase 5: 完善和文档 (Week 3)
- [ ] 性能优化
- [ ] 错误处理改进
- [ ] 编写 README
- [ ] 示例和教程

### Rollback Plan
如果项目失败或需要回退:
- 用户可以继续使用 openskills 或 universal-skills
- Claude Code 用户不受影响(原生功能)
- 无破坏性变更,可以安全移除

## Open Questions

1. **是否需要支持 skill 安装/卸载?**
   - 当前决策: No (使用 Claude Code 插件系统或手动管理)
   - 需要收集用户反馈

2. **是否需要支持自定义 skill 目录?**
   - 当前决策: Yes (通过 `--skill-dir` flag)
   - 已在 universal-skills 中验证

3. **MCP Resources 是否必需?**
   - 当前决策: Optional (Tool 是主要接口)
   - 可以在后续版本添加

4. **是否需要 skill 的依赖管理?**
   - 当前决策: No (skill 自行管理依赖)
   - 可能在未来版本考虑

5. **如何处理 skill 的本地化?**
   - 当前决策: 保持原样(skill 自行处理)
   - 可以考虑在 description 中支持多语言
