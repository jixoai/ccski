# Change: Fix Claude Code Plugin Skill Resolution

## Why
当前 `plugins.ts` 中的 `discoverPluginSkills` 函数直接递归扫描 `installPath` 目录查找所有 `SKILL.md` 文件，但这忽略了 `marketplace.json` 中的 `skills` 配置。这导致：
- 无法正确识别哪些技能属于哪个 plugin
- 无法正确解析技能路径（`installPath` + `skills[i]`）
- 与 Claude Code 的 plugins 系统不兼容

## What Changes
- **BREAKING**: 重构 `discoverPluginSkills` 函数，正确解析 `marketplace.json` 中的 plugins 和 skills 配置
- 新增 `marketplace.json` 解析逻辑：
  - `installPath` = `installLocation` + `plugin.source`
  - 技能路径 = `installPath` + `skills[i]`
- 保持 fallback 扫描机制作为 `marketplace.json` 缺失时的兜底方案
- 更新 skill 命名空间逻辑以正确反映 plugin 结构

## Impact
- Specs affected: `plugin-support`
- Code affected: `src/core/plugins.ts`
- 修复后将正确发现和解析 Claude Code 安装的 marketplace plugins 中的 skills
