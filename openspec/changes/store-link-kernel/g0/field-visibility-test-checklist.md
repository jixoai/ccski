<!--
文件意图（2026-10-07）
用户原始需求 [2026-10-07]：「字段可见性测试清单：CLI/MCP/list·info/文件读取 × 领域字段/provenance 子集（含 sourceUrl 脱敏三类输入）/redact-paths/frontmatter 隔离——逐条可执行测试条目（GIVEN/WHEN/THEN 级）」
正交意图：
  [1] 把 spec Field visibility contract 逐句变成可执行验收条目（批内实现即测试）
  [2] 以 1.7.1 实跑 JSON 观察为负面钉值（npm 暴露面不构成 ccski 契约）
妥协声明：MCP 面与 --redact-paths 在 3.0 前无实现，条目为验收清单而非现状描述；每条注明承接批次。
-->

# G0 收据：字段可见性契约测试清单

契约本体：spec `Field visibility contract` Requirement（113 行）+ 三个 Scenario（115-125）。四个面：**CLI stdout / MCP tools / list·info 投影 / 文件读取**。本清单每条为 GIVEN/WHEN/THEN 可执行测试条目；「面」列标注该条目适用的面（全部 = C/M/L，文件读取面单列 F）。

允许暴露的领域字段全集（spec 113 行钉值）：`name`、`description`、folder/scope identities、`paths`、source provenance 子集（`source`/`sourceType`/`sourceUrl`/`skillPath`/`updatedAt`）、`mode`/`ownership`/`revision` 标记。

禁止暴露全集：环境/home 元数据（显式 path 字段以外）、lock 原文（provenance 子集以外）、tokens、文件内容（仅经显式 file-read 面）、frontmatter 字段（仅经 document/file-read 面）。

## 1. 领域字段白名单

| # | GIVEN | WHEN | THEN | 面 | 批 |
| --- | --- | --- | --- | --- | --- |
| V1 | 已安装 1 个实体（link 投影 + lock provenance 齐全） | 任一面执行 list/info | 输出恰为领域字段全集的子集：含 name/description/folder/scope/paths/source 子集/mode/ownership/revision；**无**规定之外的键（键集断言，非仅存在性） | C/M/L | 批 3（list/info 面）、批 5（CLI 面）、批 6（MCP 面） |
| V2 | 同上 | list 输出逐字段类型检查 | `mode ∈ {link, materialized}`；`ownership ∈ {ccski, external, unknown}`；`revision` 为实体 sha256 标记 | L | 批 2/3 |
| V3 | lock 含 `skillFolderHash`/`installedAt` | list/info | provenance 子集仅含 spec 允许的 5 键（source/sourceType/sourceUrl/skillPath/updatedAt）；`skillFolderHash` 不出现在 list/info 投影（1.7.1 list 同为不暴露——parity 收据 §2 p6 观察；ccski 的 hash 属 state 域，经 revision/marker 字段表达） | L/M | 批 3 |
| V4 | 环境含 `HOME`/`XDG_*` 等变量 | 任一面 list/info | 输出不含 `$HOME` 字符串（除显式 path 字段本身）；无 env 键 | C/M/L | 批 5 |
| V5 | lock 含未知字段（对齐 parity 收据 p6 的 `futureEntryField`） | list/info | 未知 lock 字段不出现在任何面（raw passthrough 是 reader 内部契约，不是暴露契约） | L/M | 批 1（reader）+ 批 3（投影） |

## 2. sourceUrl 脱敏（spec Scenario: Source URL sanitization，123-125 行）

| # | GIVEN（输入 sourceUrl） | WHEN | THEN | 面 | 批 |
| --- | --- | --- | --- | --- | --- |
| S1 | `https://user:token@github.com/org/repo.git`（userinfo/credentials 类） | 任一面返回 provenance | `sourceUrl === "https://github.com/org/repo.git"`；输出全文不含 `user:token` | C/M/L | 批 3（投影出口单点脱敏） |
| S2 | `https://github.com/org/repo.git?token=abc`（query string 类） | 同上 | `sourceUrl === "https://github.com/org/repo.git"`；`?token=abc` 剥离 | C/M/L | 批 3 |
| S3 | `https://user:token@github.com/org/repo.git?token=abc&x=1`（复合类，spec 两例的叠加） | 同上 | `sourceUrl === "https://github.com/org/repo.git"`（userinfo 与 query 同时剥离） | C/M/L | 批 3 |
| S4 | `https://github.com/org/repo.git`（干净 URL） | 同上 | 原样返回（脱敏不得破坏合法 URL） | C/M/L | 批 3 |
| S5 | `git@github.com:org/repo.git`（scp 形态，无 scheme） | 同上 | 按非 http(s) URL 原样返回或 typed 拒绝——**实现裁决点**：spec 只钉 userinfo/query 剥离，scp 形态不含可剥离成分；测试钉「不崩溃、不误剥」 | C/M/L | 批 3 |
| S6 | sourceUrl 含凭证且同轮来自 lock 原文 | MCP tools 返回 | 同 S1/S2（MCP 面与 RPC 字段集相同；脱敏在 kernel 出口，不在 transport 层） | M | 批 6 |
| S7 | 上述 S1-S3 输入落盘 provenance | state/lock 落盘检查 | 脱敏发生在**暴露边界**（spec：「stripped before leaving the kernel」）；落盘是否保留原文为实现裁决点，测试只钉出口——若实现选择落盘脱敏，S1-S3 同样通过 | （内部） | 批 1（state） |

## 3. `--redact-paths`（spec Scenario: Redacted CLI output，119-121 行）

| # | GIVEN | WHEN | THEN | 面 | 批 |
| --- | --- | --- | --- | --- | --- |
| R1 | global scope 安装 1 实体（绝对路径含 `$HOME`） | `list --redact-paths` / `info --redact-paths` | stdout 无绝对路径（无 `/` 开头的路径 token）；路径以相对形态呈现 | C | 批 5 |
| R2 | 同上 | 不带 flag 的 list | 含绝对路径（正 flag 行为不回归：redact 是显式选择） | C | 批 5 |
| R3 | project scope 安装 | `list --redact-paths` | 相对锚点为 workspace root（相对形态确定性断言） | C | 批 5 |
| R4 | sourceUrl 含本地绝对路径（local source，parity 收据 p1 形态） | `list --redact-paths` | provenance `source`/`sourceUrl` 同样进入相对形态或剥离（redact 不豁免 provenance 路径） | C | 批 5 |

## 4. frontmatter 隔离（spec Scenario: List projection omits frontmatter payload，115-117 行）

| # | GIVEN | WHEN | THEN | 面 | 批 |
| --- | --- | --- | --- | --- | --- |
| F1 | SKILL.md frontmatter 含非核心字段（如 `license: private`、自定义键）与正文 | list/info 任意面 | 输出不含 frontmatter 正文键（仅允许 `name`/`description` 两个身份字段经领域字段暴露）；不内嵌 SKILL.md body | L/M | 批 3 |
| F2 | 同上 | 显式文件读取面（document/file-read） | frontmatter 全文可读（隔离仅指投影面；读取面不受限） | F | 既有面，3.0 回归钉值 |
| F3 | description 缺失的 SKILL.md | list | `description` 为空串或 null（不回退读取 body 首段） | L | 批 3 |
| F4 | frontmatter 含 `sources:` 等疑似敏感键 | list/info/MCP | 不出现 | L/M | 批 3/6 |

## 5. MCP 面与传输边界（spec 113 行末句）

| # | GIVEN | WHEN | THEN | 面 | 批 |
| --- | --- | --- | --- | --- | --- |
| M1 | 同一实体 | MCP tools 与 RPC（list/info）各自返回 | 字段集逐键相同（spec：「MCP tool results carry the same field set as RPC」） | M | 批 6 |
| M2 | MCP server 挂载 | 检查 server 元数据/文档 | 传输门（loopback+token）被记录为传输边界而非隐私边界（spec 原文要求「documented as such」） | M | 批 6 |
| M3 | stdio 形态 MCP | mutation 尝试 | 无 mutation 注册（readonly 面；既有红线 15 回归钉值） | M | 批 6 回归 |

## 6. 负面钉值（1.7.1 实跑观察，防「npm 怎么做我们怎么做」倒灌）

| # | GIVEN | WHEN | THEN | 依据 |
| --- | --- | --- | --- | --- |
| N1 | npm list --json 输出（parity 收据 §2 p6/p9） | 对照 ccski list/info 契约 | npm 暴露 `path`（绝对）且不暴露 hash；ccski 契约以 spec 为准（绝对路径允许在 domain path 字段、hash 不进 list）——两者差异是**有意的**，parity fixture 不得把 npm 字段集当 ccski 期望值 | parity-npm-skills-receipt.md |
| N2 | npm add --json 的 `hash` 字段（全成功形态） | 对照 | 该 `hash` 是 source 树 hash，不进 ccski list/info（进 state revision/provenance 域） | 同上 |
| N3 | npm lock `sourceUrl` 为本地绝对路径（local source） | ccski 读取该 provenance 并投影 | 经 S1-S5 脱敏管线（本地路径不是 credentials，但受 R4 redact 管辖） | spec 113 |

## 7. 承接与执行说明

- 本清单是**测试条目清单**（G0 交付物），不是已运行的测试；每条在对应批次实现时转为可执行断言（键集断言优先于子串断言）。
- 「实现裁决点」（S5/S7）不得由实现者静默决定：批 3/5 收据中显式记录裁决与理由，如与 spec 冲突则回报 Owner。
- 全部条目的最终验收面 = CLI stdout / MCP tools / list·info 三面同跑（spec 要求「Surfaces」复数一致性）；文件读取面只出现在 F2。
