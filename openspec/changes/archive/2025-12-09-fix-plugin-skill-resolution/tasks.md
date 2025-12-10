# Tasks

## 1. 分析与理解
- [x] 1.1 读取并理解 `installed_plugins.json` 结构
- [x] 1.2 读取并理解 `known_marketplaces.json` 结构
- [x] 1.3 读取并理解 `marketplace.json` 结构及 plugins/skills 配置
- [x] 1.4 确认路径解析公式：`skillPath = installLocation + source + skills[i]`

## 2. 核心重构
- [x] 2.1 新增 `loadMarketplaceJson` 函数解析 `marketplace.json`
- [x] 2.2 重构 `discoverPluginSkills` 使用 `marketplace.json` 中的 skills 配置
- [x] 2.3 正确计算 skill 路径：基于 `installPath` 和 `marketplace.json` 中的相对路径
- [x] 2.4 保持 fallback 逻辑：当 `marketplace.json` 不存在或无效时递归扫描

## 3. 命名空间与元数据
- [x] 3.1 更新 skill 命名空间逻辑，使用 `marketplace.json` 中的 plugin name
- [x] 3.2 确保 `pluginInfo` 正确反映 marketplace 结构

## 4. 测试
- [x] 4.1 单元测试：`loadMarketplaceJson` 函数
- [x] 4.2 单元测试：skill 路径解析逻辑
- [x] 4.3 集成测试：使用真实 marketplace 结构验证发现

## 5. 验证
- [x] 5.1 运行 `openspec validate fix-plugin-skill-resolution --strict`
- [x] 5.2 运行所有测试确保无回归
