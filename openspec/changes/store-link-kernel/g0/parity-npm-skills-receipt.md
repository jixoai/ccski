<!--
文件意图（2026-10-07）
用户原始需求 [2026-10-07]：「npm parity 收据：用隔离 HOME/XDG 实跑 skills@1.7.1，产出结构化收据，覆盖 spec parity Requirement 的全部分支」
正交意图：
  [1] 钉死 skills@1.7.1 默认投影全集各分支的实跑输入与期望输出（parity fixture 事实源）
  [2] 记录不可构造/不可表达场景的诚实边界（防实现把单环境观测误固化成协议）
妥协声明：探针原始文件在 /tmp/skills-integration/g0-probes/（验证后清理），本文件为自包含收据。
-->

# G0 收据：npm:skills parity（skills@1.7.1 实跑）

日期：2026-10-07。方法：严格复用 `../codex-kernel-review.md` 的隔离环境方法（独立 HOME + XDG_* + npm cache，绝不触碰真实 `~/.agents`）。运行时：node v24.21.0 / npx 11.19.0 / macOS (arm64, APFS 大小写不敏感)。版本钉死：每个探针 `npx --yes --prefer-offline skills@latest --version` → `1.7.1`。

探针根目录：`/tmp/skills-integration/g0-probes/`。环境注入（probe-env.sh）：

```sh
HOME=$PROBE/home XDG_CONFIG_HOME=$PROBE/xdg-config XDG_DATA_HOME=$PROBE/xdg-data \
XDG_CACHE_HOME=$PROBE/xdg-cache XDG_STATE_HOME=$PROBE/xdg-state \
npm_config_cache=$PROBE/npm-cache NO_COLOR=1 CI=1
```

lock 位置复核：设置 `XDG_STATE_HOME` 时 lock 实际在 `$XDG_STATE_HOME/skills/.skill-lock.json`（与既有实证一致）。

## 0. Registry 快照（skills@1.7.1 钉值）

以无效 `--agent not-an-agent` 触发 CLI 自报（探针 p0）：

```text
●  Valid agents: aider-desk, amp, antigravity, antigravity-cli, astrbot, autohand-code,
   augment, bob, claude-code, openclaw, cline, codearts-agent, codebuddy, codemaker,
   codestudio, codex, command-code, continue, cortex, crush, cursor, deepagents, devin,
   dexto, droid, eve, firebender, forgecode, fx, gemini-cli, github-copilot, goose, grok,
   hermes-agent, inference-sh, jazz, junie, iflow-cli, kilo, kimchi, kimi-code-cli,
   kiro-cli, kode, lingma, loaf, mcpjam, minimax-code, mistral-vibe, moxby, mux, opencode,
   openhands, ona, pi, posit-assistant, qoder, qoder-cn, qwen-code, replit, reasonix,
   rovodev, roo, sarvam-code, tabnine-cli, terramind, tinycloud, trae, trae-cn, warp,
   windsurf, zed, zcode, zencoder, zenflow, neovate, pochi, promptscript, adal, universal
```

共 **79** 个（与每次运行报头 `◇ 79 agents` 一致）。关键字段（源码 `dist/cli.mjs`，版本 1.7.1）：

| agent | skillsDir | globalSkillsDir | 可见性字段 | 检测 |
| --- | --- | --- | --- | --- |
| `replit` | `.agents/skills` | `join(configHome,"agents/skills")` | `showInUniversalList: false` | cwd 存在 `.replit` |
| `universal` | `.agents/skills` | `join(configHome,"agents/skills")` | `showInUniversalList: false` | 恒 `false`（仅显式 `--agent universal`） |
| `promptscript` | `.agents/skills` | **undefined** | `showInUniversalPrompt: false` | cwd 存在 `.promptscript` 或 `promptscript.yaml` |
| `eve` | agent 子代理目录 | **undefined** | — | `~/.eve` 存在 |

语义函数（源码钉值）：

- `getUniversalAgents()` = `skillsDir === ".agents/skills"` 且 `showInUniversalList !== false`（排除 replit/universal，含 promptscript）。
- `getVisibleUniversalAgents()` 再排除 `showInUniversalPrompt === false`（再排除 promptscript；仅用于交互列表渲染）。
- `isUniversalAgent()` 只看 `skillsDir`（不看可见性字段）——收据行归类用它。
- `ensureUniversalAgents(detected)` = detected ∪ getUniversalAgents()。
- 默认目标集分支（`add`）：显式 `--agent` → 精确集合；`--agent '*'` → 全 registry 键；无检测 + `--yes` → 全 registry 键（源码 `targetAgents = validAgents; log.info("Installing to all agents")`）；有检测 + `--yes` → `ensureUniversalAgents(detected)`。
- 安装模式分支（`add`）：`installMode = options.copy ? "copy" : "symlink"`；**`uniqueDirs.size <= 1`（全部目标 agent 共享同一 skillsDir）时静默自动 `copy`，即使 `--yes`**（源码 `else if (uniqueDirs.size <= 1) installMode = "copy"`）。
- symlink 创建失败 → copy fallback，结果仍报 `mode: "symlink"` + `symlinkFailed: true`（npm 的不诚实报法，E5 修正对象）。

## 1. 探针索引与分支覆盖

| 探针 | 分支 | 结论 |
| --- | --- | --- |
| p0 | 版本钉死 + registry 快照 | 1.7.1；79 agents 名单（上节） |
| p1 | detected+universal 默认投影 | canonical 实体 + detected symlink + universal 共享；**默认分支自带 PromptScript 失败条目** |
| p1b | 同 p1 + `--json` | JSON 只含失败条目、exit 1；**安装实际成功**——JSON 不是 global 默认检测的权威收据 |
| p2 | 空 HOME 检测观测 | 本机 `/Applications/ZCode.app` 泄漏检测 → **真 no-detection 分支在本机不可构造**（见 §4） |
| p2b | 全 registry 目标集（`--agent '*'`，与 no-detection `--yes` 同集合） | 79 目标 = 23 universal-class 共享 canonical（含 replit/universal/promptscript）+ 52 symlink + eve/promptscript 失败 |
| p3 | `showInUniversalList` 排除场景（replit 经 cwd 标记检测） | 排除语义 = 目标集成员资格：未检测不进 universal 行；被检测/显式指定时进且投影 = canonical（无独立根） |
| p4 | per-agent 部分成功（显式 claude-code + promptscript） | claude-code symlink 成功 + promptscript 失败；实体与 lock 照常落盘；exit 1；**JSON 不可表达部分成功** |
| p5 | remove `--agent` 投影作用域 + 末引用 GC | 逐投影摘除；末引用后实体 GC + lock `skills:{}`（version/dismissed 保留）；agent 根目录留空壳 |
| p6 | lock 未知字段透传 | `futureEntryField`/`futureTopLevelField` 经 list 与 remove 写回全部幸存 |
| p7 | `.SKILL.md` 非官方 | list `[]`、remove `Found 0`、文件原样、lock 不创建 |
| p9 | 物化副本 list 观察 | list 能发现 copy；字段 `name/path/scope/agents/source*/null`；**无 mode/ownership/canonical 表达力** |

## 2. 探针记录

### p1 — detected+universal 默认投影（文本模式）

输入树：`source/alpha-skill/SKILL.md`（frontmatter `name: alpha-skill`）；`~/.claude/`、`~/.zcode/` 两个检测标记目录。

命令：`npx --yes --prefer-offline skills@latest add <probe>/source/alpha-skill --global --yes`

完整文本输出（ANSI 清理后，节选去横幅）：

```text
┌   skills
│  Tip: use the --yes (-y) and --global (-g) flags to install without prompts.
◇  Source: /tmp/skills-integration/g0-probes/p1-detected-universal/source/alpha-skill
◇  Local path validated
◇  Found 1 skill
●  Skill: alpha-skill
│  P1 probe skill for detected+universal default projection.
◇  79 agents
●  Installing to: Claude Code, ZCode
◇  Installation Summary ──────────────────────────────────────────────────╮
│  ~/.agents/skills/alpha-skill                                           │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +16 more  │
│    symlink → Claude Code, ZCode                                         │
├─────────────────────────────────────────────────────────────────────────┤
◇  Installation complete
◇  Installed 1 skill ─────────────────────────────────────────────────────╮
│  ✓ ~/.agents/skills/alpha-skill                                         │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +16 more  │
│    symlinked: Claude Code, ZCode                                        │
├─────────────────────────────────────────────────────────────────────────┤
■  Failed to install 1
│    ✗ alpha-skill → PromptScript: PromptScript does not support global skill installation
└  Done!  Review skills before use; they run with full agent permissions.
```

落盘状态树：

```text
~/.agents/skills/alpha-skill/SKILL.md          (真实实体)
~/.claude/skills/alpha-skill -> <相对路径>/home/.agents/skills/alpha-skill   (symlink，相对链接)
~/.zcode/skills/alpha-skill -> <同上>
```

lock（`$XDG_STATE_HOME/skills/.skill-lock.json`）：

```json
{
  "version": 3,
  "skills": {
    "alpha-skill": {
      "source": "<probe>/source/alpha-skill",
      "sourceType": "local",
      "sourceUrl": "<probe>/source/alpha-skill",
      "skillFolderHash": "32edfbb4e3b3cd90ff096410af82a488ae579b206c38c969b452c9ebac2e1816",
      "installedAt": "2026-10-07T09:45:42.243Z",
      "updatedAt": "2026-10-07T09:45:42.243Z"
    }
  },
  "dismissed": {}
}
```

观察（fixture 钉值）：

1. 默认集合 = detected（Claude Code, ZCode）+ universal 21 个（共享 canonical，无独立目录）+ promptscript **失败条目**。detected+universal 分支默认就含 per-agent 失败收据，与 p4 部分成功同构。
2. universal 行计数钉值（`+16 more` = 5 具名 + 16 = **21**）：= `getUniversalAgents()` 成员数（含 promptscript，不含 `showInUniversalList:false` 的 replit/universal）。三处对照：p1（未检测 replit）= 21 且**不含 Replit**；p3（cwd `.replit` 检测）= 22 且**含 Replit**；p2b（全集 79 目标）= 23 = 21 + replit + universal。universal-class（`skillsDir === ".agents/skills"`）成员总数 = 23。
3. symlink 是**相对链接**（`../../../../…/home/.agents/skills/alpha-skill` 形态）。
4. 本地源的 `source`/`sourceUrl` 是原始本地绝对路径；lock `version: 3`。

### p1b — 同 p1 + `--json`（JSON 收据形态对照）

命令：同 p1 追加 `--json`；新 HOME 同构。EXIT=**1**。

完整 JSON stdout：

```json
[
  {
    "name": "alpha-skill",
    "status": "failed",
    "error": "PromptScript does not support global skill installation"
  }
]
```

磁盘与 p1 完全一致（实体 + 2 symlink 均存在）。**观察：global 默认检测 + `--json` 时，1.7.1 的 JSON 只承载失败条目且进程 exit 1；成功安装不出现在 JSON 里。parity fixture 的权威收据 = 文本 stdout + 磁盘树 + lock 三元组；JSON 不得作为该分支的安装收据。**

对照（全成功分支的 JSON 形态，引自 `codex-kernel-review.md` 实证 npm-skills-runtime-20261007-b/add.json，本轮核验该文件仍在且内容一致）：

```json
[
  {
    "name": "alpha",
    "status": "installed",
    "source": ".../source",
    "ref": null,
    "hash": "ca00b055d8df9a32abfccd2d9a72aba45f21e28fe6e3ecf17de329646066d9f1",
    "path": ".../home/.agents/skills/alpha",
    "scope": "global",
    "agents": ["Claude Code", "OpenClaw"],
    "mode": "symlink",
    "security": null
  }
]
```

即：全成功时 JSON 携带 `agents[]`/`mode`/`hash`；一旦任一 agent 失败，条目退化为 `{name,status:"failed",error}`，**部分成功在 JSON 中不可表达**（p4 实证）。

### p2 — 空 HOME 检测观测（no-detection 尝试）

输入：HOME 全空（无任何 agent 标记目录），cwd 无标记文件。

输出关键行：`●  Installing to: ZCode`。

原因（源码钉值）：`isZCodeInstalled()` = `existsSync(join(home,".zcode")) || existsSync("/Applications/ZCode.app")`——本机存在 `/Applications/ZCode.app`，**HOME 隔离不能清零检测集**。落盘与 lock 同 p1 形态（实体 + `.zcode` symlink，universal 21）。

### p2b — 全 registry 目标集（no-detection `--yes` 的等价构造）

命令：`add <probe>/source/beta-skill --global --yes --agent '*' --json`（源码：`--agent '*'` → `targetAgents = Object.keys(agents)`，与 no-detection `--yes` 分支的 `validAgents` 同一集合）。

文本输出关键行：

```text
●  Installing to all 79 agents
◇  Installation Summary ─────────────────────────────────────────────────────╮
│  ~/.agents/skills/beta-skill                                               │
│    universal: Amp, Antigravity, Antigravity CLI, Cline, Codex +18 more     │
│    symlink → AiderDesk, AstrBot, Autohand Code CLI, Augment, IBM Bob +51   │
│  more                                                                      │
```

落盘：canonical 实体 1 + symlink 投影 52（52 个独立 agent 根，含 `~/.config/crush/skills`、`~/.config/kimchi/harness/skills`、`$XDG_CONFIG_HOME/devin/skills`、`$XDG_CONFIG_HOME/goose/skills` 等 XDG/嵌套根）。replit 与 `universal` 键**无独立目录**（universal-class 共享 canonical）。eve、promptscript 失败（二者 `globalSkillsDir` undefined）。JSON stdout 仍只有失败条目（`Eve does not support global skill installation`），EXIT=1。

lock：同 p1 形态（`skillFolderHash` 为源树 hash）。

观察：no-detection `--yes` 的退化集合语义 = 全 registry 键逐 agent 尝试、部分成功、无 global 能力者失败条目——与 p1 的 detected+universal 分支共享「逐 agent + 部分成功」形态，差异仅在集合范围（21+detected vs 79）。

### p3 — `showInUniversalList` 排除场景（replit）

输入：空 HOME；**cwd 放置空文件 `.replit`**（replit 检测标记）。

命令：`add <probe>/source/beta-skill --global --yes --json`。EXIT=1（promptscript 失败，同 p1b）。

输出关键行：

```text
●  Installing to: Replit, ZCode
│    universal: Replit, Amp, Antigravity, Antigravity CLI, Cline +17 more  │
│    symlink → ZCode                                                       │
```

落盘：`~/.agents/skills/beta-skill`（canonical）+ `~/.zcode/skills/beta-skill` symlink；**无任何 replit 独立目录**（isUniversalAgent(replit)=true → 投影即 canonical；其 `globalSkillsDir` `$XDG_CONFIG_HOME/agents/skills` 未创建）。cwd 的 `.replit` 标记原样保留。

对照 p1（无 `.replit` 时 universal 行 21 项、不含 Replit）⇒ **排除语义的实跑钉值**：

1. `showInUniversalList:false` 的作用是**目标集成员资格**：不进 `getUniversalAgents()`，因此未检测时不会被 `ensureUniversalAgents` 自动加入（p1），检测到（cwd 标记，p3）或显式 `--agent replit` 时才进目标集。
2. 进入目标集后，收据行按 `isUniversalAgent` 归类（p3 的 universal 行含 Replit、计数 21→22），投影与 canonical 共享，不产生独立根。
3. 交互多选列表会隐藏该类 agent（源码 `getVisibleUniversalAgents()` + `hiddenCount`）；headless 无法实跑该交互面，此项按源码钉值记录、不冒充实跑。

**结论：spec「Registry visibility filtering is pinned」Scenario 在 1.7.1 上可构造、已构造，观测如上；被排除 agent 的语义 = 不自动进集合，而非「进了集合再过滤掉投影」。**

### p4 — per-agent 部分成功收据（显式 agent 集）

输入：`~/.claude/` 标记；同 p2 源。

命令：`add <probe>/source/beta-skill --global --yes --agent claude-code promptscript --json`。EXIT=1。

完整 JSON stdout：

```json
[
  {
    "name": "beta-skill",
    "status": "failed",
    "error": "PromptScript does not support global skill installation"
  }
]
```

文本关键行：

```text
◇  Installation Summary ────────╮
│  ~/.agents/skills/beta-skill  │
│    universal: PromptScript    │
│    symlink → Claude Code      │
```

落盘：实体 + `~/.claude/skills/beta-skill` symlink；lock 完整写入（含 `skillFolderHash`）。

观察：**部分成功是 1.7.1 全局安装的常态**（一个 agent 失败不回滚其他 agent、不回滚实体与 lock）；失败条目是 per-agent typed 记录的唯一形态；JSON 无法同时表达成功与失败 agent（见 p1b 对照）。

### p5 — remove `--agent` 投影作用域 + 末引用 GC

序列（同一隔离 HOME）：

1. `add <probe>/source/beta-skill --global --yes --agent claude-code openclaw --json` → EXIT=0，实体 + `.claude`/`.openclaw` 两个 symlink，lock 含 `beta-skill`。
2. `remove beta-skill --global --yes --agent claude-code --json` → EXIT=0。落盘：`.claude` 链接消失；实体与 `.openclaw` 链接保留；**lock 仍含 `beta-skill` 全字段**（source/sourceType/sourceUrl/skillFolderHash/installedAt/updatedAt 原样）。
3. `remove beta-skill --global --yes --agent openclaw --json` → EXIT=0。落盘：实体目录删除；`~/.claude/skills/`、`~/.openclaw/skills/` 留空壳根目录；lock 变为：

```json
{ "version": 3, "skills": {}, "dismissed": {} }
```

remove 的 stdout 全文（1、2 步同形）：

```text
◇  Found 1 unique installed skill(s)
◇  Removal process complete
◆  Successfully removed 1 skill(s)
└  Done!
```

观察：`--agent` = projection-scoped remove（spec「projection-scoped remove with entity/lock GC on last reference」钉值）；GC 触发 = CLI 认定的最后引用消失；agent 根目录不回收。**remove 在 1.7.1 不产出 JSON 收据**（传 `--json` 仍输出文本；源码中 remove 无 JSON 发射面）——ccski 的 per-agent remove typed 收据是超集能力，fixture 只能钉文本 + 磁盘。

另记（照抄风险，源自上一轮实证、本轮源码复核仍在）：`dist/cli.mjs:6854-6898` remove 后只对 `detectInstalledAgents()` 剩余集合做 refcount——未被检测到的残留投影不计入，可能留 dangling link。ccski 不得照抄（sidecar + 全注册 roots lstat 复核）。

### p6 — lock 未知字段透传

预置 `$XDG_STATE_HOME/skills/.skill-lock.json`：v3 + alpha/beta 两条目（各带 `futureEntryField`）+ 顶层 `futureTopLevelField`；`~/.agents/skills/{alpha,beta}/SKILL.md` 真实目录。

`list --global --json`（EXIT=0）：

```json
[
  { "name": "alpha", "path": ".../home/.agents/skills/alpha", "scope": "global",
    "agents": [], "source": "someone/alpha-skill",
    "sourceUrl": "https://github.com/someone/alpha-skill", "sourceType": "github" },
  { "name": "beta",  "path": ".../home/.agents/skills/beta",  "scope": "global",
    "agents": [], "source": "someone/beta-skill",
    "sourceUrl": "https://github.com/someone/beta-skill",  "sourceType": "github" }
]
```

`remove alpha --global --yes`（EXIT=0）后 lock：

```json
{
  "version": 3,
  "skills": {
    "beta": {
      "source": "someone/beta-skill", "sourceType": "github",
      "sourceUrl": "https://github.com/someone/beta-skill",
      "skillPath": "skills/beta",
      "skillFolderHash": "bbbb2222…",
      "installedAt": "2026-10-01T00:00:00.000Z", "updatedAt": "2026-10-01T00:00:00.000Z",
      "futureEntryField": "keep-beta"
    }
  },
  "dismissed": {},
  "futureTopLevelField": { "keep": true }
}
```

观察：未知字段经 **list 读**与 **remove 写回**双向幸存（raw passthrough 钉值成立）；被删条目连同其未知字段一起删除；`version`/`dismissed` 保留。附带观察：**list JSON 不暴露 `skillFolderHash`/`installedAt`/`updatedAt`**（可见性契约输入，见 field-visibility 清单）。

### p7 — `.SKILL.md` 非官方语义

输入：HOME 只有 `~/.agents/skills/disabled-only/.SKILL.md`（无 `SKILL.md`）。

- `list --global --json` → `[]`（EXIT=0）。
- `remove --global --all --yes` → 文本 `◇  Found 0 unique installed skill(s)` + `└  No skills found to remove.`（EXIT=0）。
- 落盘：`.SKILL.md` 原样保留；**lock 文件未被创建**。

钉值：`.SKILL.md` 对 1.7.1 完全不可见（identity 源 = 精确 `SKILL.md`）；它只能是 ccski 物化模式的兼容语义（spec `convention:"ccski-legacy"`）。

### p9 — 物化副本的 list 可发现性观察

输入：手工把源树复制为真实目录 `~/.agents/skills/copyx`（无 lock 条目、无 symlink）。

`list --global --json`：

```json
[
  {
    "name": "beta-skill",
    "path": ".../home/.agents/skills/copyx",
    "scope": "global",
    "agents": [],
    "source": null,
    "sourceUrl": null,
    "sourceType": null
  }
]
```

观察：npm list 按 frontmatter `name`（非目录名）报告 `beta-skill`，path = copy 目录自身；**无 mode/ownership/canonical-vs-copy 字段**——物化状态只能由 ccski sidecar 与 typed result 提供（E5 观察钉值）；list 不创建 lock。

## 3. 分支 → spec Scenario 对照

| spec parity Requirement 分支 | 实跑探针 | 状态 |
| --- | --- | --- |
| detected+universal 默认投影 | p1（文本）/ p1b（JSON 形态） | 已钉 |
| universal 受 registry 可见性字段过滤（`showInUniversalList` 类） | p3 + p1 对照（构造成功）；交互隐藏面按源码钉值 | 已钉（含边界注记） |
| no-detection 非交互 `--yes` registry 全集退化 | 本机不可直接构造（§4）；等价构造 p2b（`--agent '*'` 同集合）+ 源码钉值 | 已钉（含不可构造记录） |
| per-agent 部分成功 typed 收据 | p4（+ p1 默认分支自带失败条目 + p2b eve/promptscript） | 已钉 |
| 无 global 安装能力 agent 失败条目（PromptScript 类） | p1/p2b/p4（promptscript、eve 两例） | 已钉 |
| 投影作用域 remove + 末引用实体/lock GC | p5 两步序列 | 已钉 |
| lock 未知字段透传（读 + 写回） | p6 | 已钉 |
| `.SKILL.md` 非 npm 语义 | p7 | 已钉 |
| 物化目录 list 可发现但无 mode/ownership 表达力（fixture 注记） | p9 | 已钉 |
| symlink 失败 → copy fallback 仍报 symlink + `symlinkFailed` | 本轮未实跑触发；源码钉值（`dist/cli.mjs` createSymlink 失败分支）| 源码钉值记录，未实跑 |

## 4. 不可构造 / 不可表达场景（如实记录）

1. **真 no-detection 分支在本机不可构造**：`isZCodeInstalled()` 检查 `/Applications/ZCode.app`（本机必存）。等价构造 = `--agent '*'`（源码同一 `validAgents` 集合）；若未来需真跑，须在无 `/Applications` agent 应用且无 `~` 标记的环境（如干净 Linux CI）补一轮。
2. **`--json` 对 global 安装不是完整收据**：默认检测/全集分支只发射失败条目且 exit 1；部分成功不可表达；remove 无 JSON 面。fixture 必须钉「文本 + 磁盘 + lock」三元组。
3. **交互多选的 universal 区隐藏（`hiddenCount`）无法 headless 实跑**：按源码钉值记录（`getVisibleUniversalAgents`），不冒充实跑观察。
4. **`universal` 键只能显式指定**（`detectInstalled` 恒 false）；其实体投影与 canonical 同路径，无独立观察面。

## 5. 升级重跑指引（fixture 消费方式）

npm CLI 升级时重跑本收据全部探针（命令与输入树均在本文件 §2，环境注入见文件头），diff 三处：registry 快照（§0）、各探针文本收据关键行、磁盘/lock 形态。任何漂移先改 parity fixture 与 spec 再动实现。
