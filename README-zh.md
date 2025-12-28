# ccski – Claude Code 技能管理器

ccski 是一个面向 CLI 与 MCP 的工具，用于发现、安装、启用/禁用并通过 MCP 提供 Claude/Codex 兼容的技能。同时它也导出了一个小而精的“内核 API”，方便你在脚本中复用技能发现与校验能力。本文档聚焦安装与使用；架构与设计哲学请看 `SPEC.md`。

文档站点：https://jixoai-labs.github.io/ccski/

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
  - [启动 MCP 服务器](#启动-mcp-服务器)
  - [核心 CLI 命令](#核心-cli-命令)
  - [安装示例](#安装示例)
  - [启用/禁用](#启用禁用)
- [更多](#更多)
- [致谢](#致谢)
- [API 文档](#api-文档)

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

- 提供可编程 API，见文末 [API 文档](#api-文档)（或文档站点）获取用法示例。
- Claude 用户：建议 `ccski mcp --exclude=claude`，避免回显内置 Claude skills。
- Codex 用户：建议 `ccski mcp --exclude=codex`，避免回显内置 Codex skills。
- 所有命令支持 `--json` 便于脚本化。
- 用 `--no-color` 关闭颜色，或 `--color` 强制开启。
- 详细技术与设计理念请查看 `SPEC.md`。

## 致谢

- [openskills](https://github.com/numman-ali/openskills) — 建立了 SKILL.md 编写规范；ccski 遵循该规范。
- [universal-skills](https://github.com/klaudworks/universal-skills) — MCP 优先的技能集；ccski 专注于管理，而非打包内容。

## API 文档

这里描述 `import ... from "ccski"` 可用的公开导出。

注意：

- 包是 ESM（`"type": "module"`），请在 Node.js >= 20 使用 `import`。
- `discoverSkills()` / `SkillRegistry.getAll()` 只返回**元数据**；需要读取完整 SKILL.md 内容请用 `loadSkill()` / `SkillRegistry.load()`。

### 引入方式

```ts
import { discoverSkills, SkillRegistry, validateSkillFile } from "ccski";
import type { Skill, SkillMetadata } from "ccski";
```

### 类型

- `SkillProvider`: `"claude" | "codex" | "file"`
- `SkillLocation`: `"user" | "project" | "plugin"`
- `SkillFrontmatter`: SKILL.md 顶部 frontmatter（必需 `name`、`description`，允许附加字段）
- `SkillMetadata`: 已发现技能的摘要信息（name/description/provider/location/path + 资源目录标记）
- `Skill`: `SkillMetadata` + `content`（含 frontmatter 的完整 Markdown）+ `fullName`
- `ParseResult`: `{ frontmatter, content, fullContent }`
- `DiscoveryOptions`: 扫描默认目录/自定义目录、provider 标记、是否包含禁用技能等
- `SkillRegistryOptions`: `DiscoveryOptions` + 插件发现参数（`pluginsFile` / `pluginsRoot` / `settingsFile` / `userDir`）

参考结构（简化版）：

```ts
export interface SkillMetadata {
  name: string;
  description: string;
  disabled?: boolean;
  provider: "claude" | "codex" | "file";
  location: "user" | "project" | "plugin";
  path: string;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo?: { pluginName: string; marketplace: string; version: string };
}

export interface Skill extends SkillMetadata {
  content: string; // 含 frontmatter 的完整 Markdown
  fullName: string;
}
```

### 错误类型

所有错误都继承 `CcskiError`，并带有 `suggestions: string[]` 用于提供可操作的提示信息。

- `SkillNotFoundError`: 找不到指定技能名
- `AmbiguousSkillNameError`: 技能名歧义（匹配多个）；包含 `matches: string[]`
- `ParseError`: 文件读取/UTF-8/YAML/frontmatter 解析失败；包含 `filePath`、`reason`
- `ValidationError`: frontmatter schema 校验失败；包含 `filePath`、`issues: string[]`

### 解析与校验

#### `parseSkillFile(filePath: string): ParseResult`

解析 `SKILL.md`（或 `.SKILL.md`），并返回：

- `frontmatter`: 经过校验与规范化的 frontmatter（会对 `description` 做空白归一）
- `content`: 去掉 frontmatter 的正文
- `fullContent`: 含 frontmatter 的原始文件内容

会抛出 `ParseError`（IO/编码/YAML）与 `ValidationError`（schema）。

#### `validateSkillFile(filePath: string): { success; errors; suggestions }`

对 `parseSkillFile()` 的安全包装：不抛错，返回 `success/errors/suggestions`。

```ts
import { validateSkillFile } from "ccski";

const result = validateSkillFile("/abs/path/to/SKILL.md");
if (!result.success) {
  console.error(result.errors);
  console.error(result.suggestions);
}
```

### 发现（Discovery）

#### `getDefaultSkillDirectories(userDir: string)`

返回默认的技能根目录（project + user）及其 provider 标记（Claude/Codex）。

#### `discoverSkills(options?: DiscoveryOptions): { skills; diagnostics }`

扫描内置目录（除非 `scanDefaultDirs: false`）以及 `customDirs`：

- `skills`: `SkillMetadata[]`
- `diagnostics`: 扫描路径、warnings、conflicts、以及按 provider 的计数

```ts
import { discoverSkills } from "ccski";

const { skills, diagnostics } = discoverSkills({
  includeDisabled: true,
  customDirs: ["/extra/skills"],
  customProvider: "file",
});
```

#### `loadSkill(metadata: SkillMetadata): Skill`

读取技能的完整内容（会根据 `metadata.disabled` 决定读取 `SKILL.md` 或 `.SKILL.md`）。

#### `scanSkillDirectory(dirPath, options, provider, userDir?, scope?)`

用于底层自定义扫描（`discoverSkills()` 内部使用）。适合你需要自行控制：

- 根目录与递归深度
- provider 标记（`"claude" | "codex" | "file"`）
- 通过 `scope` 为技能名增加前缀

### Registry

#### `new SkillRegistry(options?: SkillRegistryOptions)`

发现 + 模糊匹配解析的一体化封装。

```ts
import { SkillRegistry } from "ccski";

const registry = new SkillRegistry({ includeDisabled: true });

const all = registry.getAll(); // SkillMetadata[]
const full = registry.load("some-skill"); // Skill（含 content）
```

方法：

- `refresh()`: 重新扫描目录（以及插件；可用 `skipPlugins: true` 关闭）
- `getAll()`: 获取所有技能元数据
- `find(name)`: 解析技能名（不区分大小写，支持短名与 `provider:name`）
- `has(name)`: 是否存在
- `load(name)`: 解析并读取完整内容
- `getDiagnostics()`: 统计信息 + 扫描路径 + warnings/conflicts

### Schemas（Zod）

用于类型安全地校验/解析外部 JSON 与 frontmatter：

- `SkillFrontmatterSchema` / `SkillFrontmatterType`
- `PluginEntrySchema` / `PluginEntryType`
- `InstalledPluginsSchema` / `InstalledPluginsType`
- `ClaudeSettingsSchema` / `ClaudeSettingsType`
