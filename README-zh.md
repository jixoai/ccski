# ccski – Claude Code 技能管理器

ccski 是一个面向 CLI 与 MCP 的工具，用于发现、安装、启用/禁用并通过 MCP 提供 Claude/Codex 兼容的技能。同时它也导出了一个小而精的“内核 API”，方便你在脚本中复用实体管理、技能发现与校验能力。本文档聚焦安装与使用；架构与设计哲学请看 `SPEC.md`。

文档站点：https://jixoai-labs.github.io/ccski/

## 目录

- [安装](#安装)
- [3.0 一段话速览](#30-一段话速览)
- [快速开始](#快速开始)
  - [启动 MCP 服务器](#启动-mcp-服务器)
  - [核心 CLI 命令](#核心-cli-命令)
  - [安装技能](#安装技能)
  - [启用/禁用](#启用禁用)
  - [维护命令：migrate / gc / state repair / import --claim](#维护命令migrate--gc--state-repair--import---claim)
  - [Scope、实体与投影](#scope实体与投影)
- [平台支持](#平台支持)
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

## 3.0 一段话速览

3.0 是破坏性大版本。ccski 不再到处复制技能：每个安装的技能成为一个**实体**（scope 下 `.agents/skills/` 根里的真实目录）加显式的**投影**（默认 symlink）落到你点名的 agent 根。发现层把 symlink 视为一等条目，为每个技能报告 `canonicalPath` / `entryKind` / `ownership` / `mode` / `provenance`；3.0 之前的物化副本原样保留并标注 `materialized + legacy-unknown`，直到你显式 migrate。2.x 的 mutation API（`installSkills`、`installSkillDir`、`removeSkills`、`toggleSkills`）与 git/marketplace 安装源已移除，不留兼容胶层——见[从 2.x 迁移](#从-2x-迁移)与 [CHANGELOG](./CHANGELOG.md)。

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

> 提示：3.0 的 workflow 提示词注入（`ccski install` 不带 source）与 2.x 一致，用法见英文版 README 或 `npx -y ccski install --help`。

### 核心 CLI 命令

| 命令 | 用途 |
| --- | --- |
| `ccski list` | 列出已发现技能（含 mode/ownership/provenance 元数据） |
| `ccski info <name>` | 查看技能领域元数据（`--full` 打印 SKILL.md 全文） |
| `ccski search <query>` | 按名称/描述搜索（可选 `--content` 搜正文） |
| `ccski validate <path>` | 校验 SKILL.md 或技能目录 |
| `ccski install` | 把 ccski workflow 块写入 agent 提示词文件（3.0 不变） |
| `ccski install <dir>` | 安装本地技能目录：实体 + agent 投影（默认 link） |
| `ccski enable [names...]` | 启用投影（link：过 `ENTITY_REVISED` 闸后重建） |
| `ccski disable [names...]` | 禁用投影（link：摘链——物理生效） |
| `ccski migrate` | 收编存量物化副本为实体 + 投影（缺省 dry-run） |
| `ccski gc` | 提案清理 root 已消失的 state 记录（3.0 仅 dry-run） |
| `ccski state repair` | 磁盘 vs sidecar state 差异比对，`--confirm` 后修复 |
| `ccski import <path> --claim` | 收编未登记 symlink 为 ccski 投影（inode + hash 守卫） |
| `ccski mcp` | 启动 MCP 服务器（stdio/http/sse） |

携带收据的命令均支持 `--json` 类型化输出：`list`、`info`、`validate`、`install`、`enable`、`disable`、`migrate`、`gc`、`state repair`、`import` 用 `--json`；`search` 用 `--format=json`；`mcp` 是常驻服务器（无 JSON 模式）。`list`/`info` 另支持 `--redact-paths`（相对路径输出，便于粘贴/日志）。

### 安装技能

3.0 每次调用安装**一个含 `SKILL.md` 的本地目录**。技能先落为所选 scope 的实体，再投影到目标 agent 根。CLI mutation 缺省 scope 为 `project`（当前目录）；`--global` 切到用户全局 scope。

```bash
# project scope（缺省）：实体落 <cwd>/.agents/skills，
# 并向检测到的 agent 项目根投影（detected + universal 集合）
ccski install ./my-skill

# global scope：实体落 ~/.agents/skills，向 agent 全局根投影
ccski install ./my-skill --global

# 显式目标（可重复；* = 全 registry）
ccski install ./my-skill --agent claude-code --agent codex
ccski install ./my-skill --agent '*'

# 预览计划，零写入
ccski install ./my-skill --dry-run --json

# 覆盖同名实体（显式 expectedRevision replace）
ccski install ./my-skill --force
```

可依赖的行为：

- 投影默认 `link`（指向实体的 symlink）；`materialized` 副本只在显式要求时创建，绝不静默。
- 未检测到 agent 时，非交互安装需要 `--yes` 才退化为全 registry 目标集。
- 无全局安装能力的 agent 产出 typed 失败条目（`NO_GLOBAL_INSTALL`），不会被静默跳过；部分成功逐 agent 收据表达，仅在有失败时 exit 1。
- ccski 永不写 npm 的 `.skill-lock.json`；收据携带 `lockSyncPending: true`，宿主流程据此诚实上报 lock 未同步。
- git/URL/marketplace 源已退役：统一 typed `SOURCE_UNSUPPORTED` 拒绝。Git 获取归你的宿主工具链（clone 后 `ccski install <dir>`）。

### 启用/禁用

禁用是物理生效的，不是 sidecar 布尔：link 投影直接从文件系统摘链（`unlink`）；物化副本保留 legacy 的 `.SKILL.md` 改名约定，标注 `convention: "ccski-legacy"`（这不是 npm 语义）。启用 link 前先核对实体 revision——实体若已变化，调用以 typed `ENTITY_REVISED` 拒绝并建议 `update`。

```bash
# 交互式启用
ccski enable -i

# 批量禁用 scope 内所有已登记实体
ccski disable --all

# 操作 global scope（缺省 project）
ccski disable my-skill --global
```

### 维护命令：migrate / gc / state repair / import --claim

```bash
# 1) 把 3.0 之前的物化副本收编为实体 + 投影。
#    缺省 dry-run，零写入。
ccski migrate --dry-run
ccski migrate --execute              # expected hash 守卫；backup/journal 回滚
ccski migrate --execute --plan plan.json   # 以保存的 dry-run 计划 hash 为守卫基准

# 2) 提案清理 root 已消失的 state 记录（3.0 仅 dry-run；
#    不带 --dry-run 的执行面以 typed DRY_RUN_REQUIRED 拒绝，绝不自动删）。
ccski gc --dry-run

# 3) sidecar state（.ccski-state.json）与磁盘漂移时修复。
ccski state repair                    # 只出 diff；typed REPAIR_CONFIRM_REQUIRED
ccski state repair --confirm          # 先备份后修复；幂等
ccski state repair --confirm          # 第二跑报 clean，零写入

# 4) 把手工创建的 symlink 收编为 ccski 投影（只动 state）。
ccski import .claude/skills/my-skill --observe          # 观察目标 inode/hash
ccski import .claude/skills/my-skill --claim \
  --inode 1234567 --hash 64hexhash                      # 守卫式收编
```

守卫全部 typed：migrate 保持冲突原件不动（`NAME_COLLISION`、`HASH_MISMATCH`），claim 要求精确 inode + 内容 hash（`CLAIM_CONFLICT`），gc 对未知外部引用给 `GC_UNKNOWN_REFERENCE` 警告。

### Scope、实体与投影

```text
global  scope:  $HOME/.agents/skills/<folder>            （实体） + agent 全局根
project scope:  <workspace>/.agents/skills/<folder>      （实体） + agent 项目根
记账文件:       <scopeBase>/.ccski-state.json            （唯一写入者：ccski）
npm lock:       .skill-lock.json                         （唯一写入者：skills CLI；本仓只读）
```

- `folderName` 由 SKILL.md `name` 经与 npm:skills 1.7.1 逐字一致的 sanitize 算法派生（小写化；`[a-z0-9._]` 之外的字符游程转连字符；下划线/点保留）。两个逻辑名 sanitize 到同一目录名时以 typed `NAME_COLLISION` 拒绝。
- 发现层报告每个条目的 `entryKind`、`canonicalPath`、`ownership`（`ccski` / `external` / `unknown`）、投影 `mode` 与来源 provenance。断链以 typed omission 呈现，绝不静默丢失。
- 外部 symlink（目标不在 ccski 记录内）只读：对其 mutation 以 typed `FOREIGN_OWNERSHIP` 拒绝。
- 投影根必须显式提供。SDK 永不从环境推断；CLI 的缺省目标集来自 agent 检测（detected + universal，对齐 npm:skills 1.7.1 parity fixture）。
- 实体路径稳定：`update` 在原路径换新实体目录，既有 link 无需重建即解析到新内容。pin 住的物化副本以 typed `PINNED` 跳过。

### 从 2.x 迁移

- 存量物化技能目录**绝不被自动转换**。发现层标注 `materialized + legacy-unknown`；先 `ccski migrate`（dry-run）再执行收编。
- 2.x CLI 语义已移除：`install` 不再 clone git 仓/读 marketplace.json；link 投影的 enable/disable 不再改 `SKILL.md` 文件名（link 直接摘链）。
- 编程 mutation API `installSkills` / `installSkillDir` / `removeSkills` / `toggleSkills` 已删除。改用内核 API（`ensureEntity` / `projectEntity` / `removeEntityProjections` / `deleteEntity` / `toggleEntityProjection` / `updateEntity`）或 CLI 命令。

## 平台支持

3.0 在 macOS 上开发并完成验证。Windows 特有失败类（`symlink-unavailable`：`EPERM`/`ENOSYS`/`EXDEV`/junction 不支持；`TARGET_DENIED`：目标级权限错误）已实现，并有针对可构造 syscall 面的测试覆盖，但**本次发版没有可用的真 Windows 实机或 CI runner**，Windows 行为属显式未验证面——见 [CHANGELOG](./CHANGELOG.md) 平台声明。诚实优先于进度：没有验证环境不得视为通过。

## 更多

- 提供可编程 API，见文末 [API 文档](#api-文档)（或文档站点）获取用法示例。
- Claude 用户：建议 `ccski mcp --exclude=claude`，避免回显内置 Claude skills。
- Codex 用户：建议 `ccski mcp --exclude=codex`，避免回显内置 Codex skills。
- 携带收据的命令支持 `--json`（`search` 用 `--format=json`）；`list`/`info` 另支持 `--redact-paths`。
- 用 `--no-color` 关闭颜色，或 `--color` 强制开启。
- 详细技术与设计理念请查看 `SPEC.md`。

## 致谢

- [openskills](https://github.com/numman-ali/openskills) — 建立了 SKILL.md 编写规范；ccski 遵循该规范。
- [universal-skills](https://github.com/klaudworks/universal-skills) — MCP 优先的技能集；ccski 专注于管理，而非打包内容。
- [npm:skills CLI](https://www.npmjs.com/package/skills)（1.7.1）— 投影集合与 folder-hash 的 parity 参照；ccski 以版本化 fixture 冻结这些行为。

## API 文档

这里描述 `import ... from "ccski"` 可用的公开导出。

注意：

- 包是 ESM（`"type": "module"`），请在 Node.js >= 20 使用 `import`。
- 发现/registry 面只返回**元数据**；读取完整 SKILL.md 内容请用 `loadSkill()` / `SkillRegistry.load()`。
- 缺显式 `scope` 的 mutation 以 typed `SCOPE_REQUIRED` 拒绝（SDK 无隐式 scope 优先级；CLI 缺省 `project`）。

### 引入方式

```ts
// 内核面（3.0）
import {
  ensureEntity,
  projectEntity,
  removeEntityProjections,
  deleteEntity,
  toggleEntityProjection,
  updateEntity,
} from "ccski";

// 命令面（3.0）
import { migrateLegacyEntries, gcPropose, repairState, claimLink } from "ccski";

// 对齐面（保留）
import { listSkills, getSkillInfo, searchSkills, validateSkill } from "ccski";

// 发现面（保留）
import { discoverSkills, SkillRegistry, validateSkillFile } from "ccski";
import type { Skill, SkillMetadata } from "ccski";
```

3.0 已删除：`installSkills`、`installSkillDir`、`removeSkills`、`toggleSkills` 及其选项/结果类型。无别名、无兼容胶层。

### 内核 API（实体 + 投影）

mutation 全部带 scope 与 revision 守卫，领域失败以类型化结果返回（`kind: "ok" | "error"` + 有限失败码），不靠抛错表达。

```ts
import { ensureEntity, projectEntity } from "ccski";

// 1) ensureEntity：实体落位并登记所有权
let ensured = await ensureEntity({
  scope: "project",                 // 显式；缺省 => SCOPE_REQUIRED
  source: { dir: "/abs/path/to/my-skill" },
});
if (
  ensured.kind === "error" &&
  ensured.code === "NAME_EXISTS" &&
  ensured.existing
) {
  // 显式同名 replace：必须携带当前实体 revision
  //（NAME_COLLISION 则表示另一逻辑名映射到同一目录名）
  ensured = await ensureEntity({
    scope: "project",
    source: { dir: "/abs/path/to/my-skill" },
    replace: { expectedRevision: ensured.existing.expectedRevision },
  });
}
if (ensured.kind === "error") throw new Error(`${ensured.code}: ${ensured.message}`);

// 2) projectEntity：只向你点名的 roots 创建投影（绝不环境推断）
const projected = await projectEntity({
  scope: "project",
  name: ensured.entity.logicalName,
  roots: ["/abs/workspace/.claude/skills", "/abs/workspace/.codex/skills"],
  // mode 缺省 "link"；"materialized" 必须给显式 reason
  //（"pinned" | "imported-root" | "user-request"）；strict: true 禁止降级
});
```

逐根收据携带规范化 `mode`（`link` | `materialized` | `entity-local`）与 `reason`；归一化后等于 scope 自身实体根的投影根返回 `targetKind: "entity"`、`mode: "entity-local"`——不建链、不复制、不写重复记录。自动降级到 `materialized` 只发生在 `symlink-unavailable`（`EPERM`/`ENOSYS`/`EXDEV`/junction 不支持）；目标级权限失败以 typed `TARGET_DENIED` 拒绝，绝不静默复制。

其余内核 mutation：

- `removeEntityProjections({ scope, name, roots })` —— 投影先行删除（link 只摘链，绝不穿过 link 递归删）；仅当全部已登记 roots 中不再有 ccski 引用时才 GC 实体；未知引用保留实体并给 typed `GC_UNKNOWN_REFERENCE` 警告。
- `deleteEntity({ scope, name, expectedRevision, roots? })` —— 在 `GUARD_ENTITY` revision 守卫下删除实体本体。
- `toggleEntityProjection({ scope, name, root, action: "enable" | "disable" })` —— 物理禁用（摘链 + state 记录）与带闸重建（实体变化时 `ENTITY_REVISED`）。
- `updateEntity({ scope, name, source, expectedRevision? })` —— 实体稳路径换新；物化副本逐份重物化；pin 住的副本以 typed `PINNED` 跳过。部分成功是常态；不存在「原子 reinstall」。

### 命令 API（migrate / gc / repair / claim）

- `migrateLegacyEntries({ scope, dryRun, roots?, plan? })` —— 收编存量物化目录；dry-run 计划列出碰撞/hash/目标；执行（`dryRun: false`，即 CLI 的 `--execute`）受 expected hash 守卫（`HASH_MISMATCH` 原件不动），带 backup/journal 回滚。
- `gcPropose({ scope, dryRun })` —— 提案清理 root 已消失的 state 记录；3.0 只交付 dry-run 半区（否则 `DRY_RUN_REQUIRED`）。
- `repairState({ scope, confirm?, roots? })` —— 扫描 vs sidecar 差异；需 `--confirm`；写修复前备份；幂等（二跑报 clean）。
- `claimLink({ scope, link, expectedInode, expectedHash })` —— 收编外部 symlink；只动 state；可经 state 回滚还原；身份不符以 typed `CLAIM_CONFLICT` 拒绝。

### 发现面（保留）

- `discoverSkills(options?: DiscoveryOptions): { skills; diagnostics }` —— 扫描内置目录（除非 `scanDefaultDirs: false`）与 `customDirs`。元数据现携带 `canonicalPath`、`entryKind`、`ownership`、投影 `mode` 与来源 provenance；断链以 typed omission 进入 `diagnostics`。
- `SkillRegistry` —— 发现 + 模糊匹配解析（`getAll` / `find` / `has` / `load` / `refresh` / `getDiagnostics`）。
- `parseSkillFile(filePath)` / `validateSkillFile(filePath)` —— frontmatter 解析与安全校验。
- `getDefaultSkillDirectories(userDir)` / `scanSkillDirectory(...)` —— 底层扫描原语。

参考结构（简化版）：

```ts
export interface SkillMetadata {
  name: string;
  description: string;
  disabled?: boolean;
  provider: "claude" | "codex" | "file" | (string & {});
  location: "user" | "project" | "plugin";
  path: string;
  hasReferences: boolean;
  hasScripts: boolean;
  hasAssets: boolean;
  pluginInfo?: { pluginName: string; marketplace: string; version: string };
  // --- 3.0 增量（仅发现层顶层条目标注；可选） ---
  /** 实体路径：目录条目 = 自身绝对路径；symlink 条目 = 单层 realpath 解析目标 */
  canonicalPath?: string;
  /** 顶层条目形态 */
  entryKind?: "directory" | "symlink";
  /** 归属三态：ccski 记录命中 / 外部 live-link / 未登记 */
  ownership?: "ccski" | "external" | "unknown";
  /** 观察到的投影形态 */
  mode?: "link" | "materialized" | "entity-local";
  /** legacy 标注：无 state 记录的存量物化副本 */
  provenance?: "legacy-unknown";
  /** 实体 replace 换新后记录已 stale 的 link 投影 */
  stale?: boolean;
}

export interface Skill extends SkillMetadata {
  content: string; // 含 frontmatter 的完整 Markdown
  fullName: string;
}
```

### Folder hash（宿主消费接口）

`computeSkillFolderHash(skillDir): Promise<string>` —— npm:skills 1.7.1 folder hash 的唯一冻结实现（排序相对路径 + path bytes + file bytes、仅 regular files、跳 `.git`/`node_modules`）。ccski 导出它，宿主直接复用同源摘要，不必重写算法。

### 错误类型

领域失败以类型化结果 + 有限失败码返回，不靠抛错：`SCOPE_REQUIRED`、`NAME_COLLISION`、`NAME_EXISTS`、`ENTITY_REVISED`、`GUARD_ENTITY`、`GUARD_PROJECTION`、`STALE_PROJECTION`、`PINNED`、`FOREIGN_OWNERSHIP`、`TARGET_DENIED`、`SYMLINK_FAILED`、`HASH_MISMATCH`、`CLAIM_CONFLICT`、`DRY_RUN_REQUIRED`、`REPAIR_CONFIRM_REQUIRED`、`GC_UNKNOWN_REFERENCE`、`NO_GLOBAL_INSTALL`、`SOURCE_UNSUPPORTED`、`STATE_GENERATION_CONFLICT`、`STATE_RECOVERY_REQUIRED`、`LOCK_VERSION_UNSUPPORTED`。

解析/registry 错误继承 `CcskiError`，带 `suggestions: string[]` 用于可操作提示：

- `SkillNotFoundError`: 找不到指定技能名
- `AmbiguousSkillNameError`: 技能名歧义（匹配多个）；包含 `matches: string[]`
- `ParseError`: 文件读取/UTF-8/YAML/frontmatter 解析失败；包含 `filePath`、`reason`
- `ValidationError`: frontmatter schema 校验失败；包含 `filePath`、`issues: string[]`

### Schemas（Zod）

用于类型安全地校验/解析外部 JSON 与 frontmatter：

- `SkillFrontmatterSchema` / `SkillFrontmatterType`
- `PluginEntrySchema` / `PluginEntryType`
- `InstalledPluginsSchema` / `InstalledPluginsType`
- `ClaudeSettingsSchema` / `ClaudeSettingsType`
