# Design: Fix Claude Code Plugin Skill Resolution

## Context

Claude Code 的 plugins 系统有以下文件结构：

```
~/.claude/plugins/
├── installed_plugins.json          # 已安装插件列表
├── plugins/
│   └── known_marketplaces.json    # 已知 marketplaces
└── marketplaces/
    ├── anthropic-agent-skills/
    │   └── .claude-plugin/
    │       └── marketplace.json   # 定义 plugins 和 skills
    └── claude-code-workflows/
        └── .claude-plugin/
            └── marketplace.json
```

### 关键路径关系

1. **`installed_plugins.json`**:
```json
{
  "plugins": {
    "example-skills@anthropic-agent-skills": {
      "installPath": "/Users/.../.claude/plugins/marketplaces/anthropic-agent-skills/"
    }
  }
}
```

2. **`marketplace.json`**:
```json
{
  "plugins": [
    {
      "name": "example-skills",
      "source": "./",
      "skills": ["./skills/algorithmic-art", "./skills/canvas-design"]
    }
  ]
}
```

3. **路径计算公式**:
```
最终技能路径 = installPath + skills[i]
例如: /Users/.../.claude/plugins/marketplaces/anthropic-agent-skills/ + ./skills/algorithmic-art
    = /Users/.../.claude/plugins/marketplaces/anthropic-agent-skills/skills/algorithmic-art
```

## Goals / Non-Goals

### Goals
- 正确解析 `marketplace.json` 中的 `skills` 配置
- 准确计算每个 skill 的路径
- 保持向后兼容（fallback 扫描）

### Non-Goals
- 修改 `install` 命令逻辑（已正确实现）
- 支持新的 plugin 格式

## Decisions

### Decision 1: 使用 marketplace.json 作为权威来源

当 `marketplace.json` 存在且有效时，仅解析其中声明的 skills，而非递归扫描整个目录。

**Rationale**: 这与 Claude Code 的行为一致，也能准确反映 plugin 作者的意图。

### Decision 2: 基于 installPath 定位 marketplace.json

从 `installed_plugins.json` 的 `installPath` 向上查找 `.claude-plugin/marketplace.json`。

**Rationale**: `installPath` 已经包含了 `source` 的解析结果，我们需要找到包含它的 marketplace。

### Decision 3: 保持 Fallback 机制

当 `marketplace.json` 缺失或无法解析时，退回到递归扫描模式。

**Rationale**: 保持向后兼容，支持非标准 plugin 结构。

## Risks / Trade-offs

- **Risk**: 部分 plugin 可能不遵循标准结构
  - **Mitigation**: Fallback 机制覆盖这种情况
  
- **Trade-off**: 首次加载需要读取更多文件
  - **Mitigation**: 这是一次性操作，影响可忽略

## Open Questions

1. 是否需要缓存 marketplace.json 的解析结果？
