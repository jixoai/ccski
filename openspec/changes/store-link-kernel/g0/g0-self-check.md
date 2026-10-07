<!--
文件意图（2026-10-07）
用户原始需求 [2026-10-07]：「G0 自检收据：openspec validate store-link-kernel --strict 复跑记录 + 六项完成对照 tasks.md 批 0 逐条勾选建议」
正交意图：
  [1] 冻结 G0 门的自检证据（验证命令 + 输出 + 工作区边界）
  [2] 给出 tasks.md 批 0 六项的勾选建议供 MainAgent 复核，不代改 tasks.md
妥协声明：无。
-->

# G0 收据：G0 自检（validate 复跑 + 六项对照）

日期：2026-10-07。执行目录：ccski 仓根。

## 1. strict validation 复跑记录

```text
$ openspec validate store-link-kernel --strict
Change 'store-link-kernel' is valid
VALIDATE_EXIT=0

$ openspec show store-link-kernel --json --deltas-only
deltaCount: 12 / requirements: 12 / scenarios: 28
```

与 codex-kernel-change-verdict.md 复审 v4 记录（`deltaCount: 12`、`requirementCount: 12`、`scenarioCount: 28`）一致；本轮六项收据产出未触碰 spec/design/proposal/tasks，契约本体未变。

12 条 Requirement（结构校验列举）：Scope-aware entity layer / Layered single writers for lock and state / Two-phase install with explicit projections / First-class symlink discovery / Physical disable semantics / Ownership-first removal and entity GC / Stable-path entity update / Frozen same-name replace state machine / Explicit claim, repair, and gc contracts / Field visibility contract / npm:skills parity pinned by versioned fixtures / Versioned breaking release and legacy migration。

## 2. 工作区边界证据

```text
$ git status --porcelain
?? openspec/changes/store-link-kernel/g0/     # 唯一新增
```

零生产实现证据：`src/`、`package.json`、`tests/` 无任何变更；未执行 `git commit`（留给 MainAgent 复核后提交）。

## 3. tasks.md 批 0 六项完成对照（勾选建议）

| tasks.md 批 0 条目 | 收据文件 | 完成判定 | 勾选建议 |
| --- | --- | --- | --- |
| ① specs strict 通过（tasks.md:7） | 本文件 §1 | validate 严格通过；12 Requirement / 28 Scenario 结构完好 | ☑ 建议勾选 |
| ② npm 四项实证 + 默认投影全集分支钉成 parity fixture（tasks.md:8） | `parity-npm-skills-receipt.md` | 1.7.1 实跑钉死输入与期望输出；分支覆盖表见其 §3：detected+universal（p1/p1b）、no-detection `--yes` 退化（p2b 等价构造 + 不可构造记录）、showInUniversalList 过滤（p3 构造成功）、per-agent 部分成功（p4）、无 global 能力失败条目（p1/p2b/p4：promptscript+eve）；remove `--agent` 作用域 + 末引用 GC（p5）、lock 未知字段透传（p6）、`.SKILL.md` 非官方（p7）、物化 list 观察（p9） | ☑ 建议勾选（注：任务行写的落点「tests/parity-npm-skills.test.ts」属批内实现形态；本批按 G0 边界交付**收据文件**，测试文件在实现批次按收据转写——与 Codex v4 裁决「批 0 零生产实现」一致） |
| ③ folder-hash fixture 收据 + 宿主导出接口定名（tasks.md:9） | `folder-hash-receipt.md` | F1-F7 输入树 + 期望 digest 由 1.7.1 实跑 lock 钉死（参考实现 7/7 对账）；排序语义（localeCompare vs byte-order）入钉值；导出接口定名 `computeSkillFolderHash(skillDir: string): Promise<string>` + 版本常量建议 | ☑ 建议勾选 |
| ④ typed 词表闭合清单（tasks.md:10） | `typed-vocabulary-checklist.md` | 17 码全表：码名 / spec Requirement+Scenario+行号出处 / 触发条件 / 实现批次；2.x 既有码处置表；「finite failure vocabularies」三命令码闭合 | ☑ 建议勾选 |
| ⑤ replace/claim/repair/gc 状态机一致性核对（tasks.md:11） | `state-machine-consistency-checklist.md` | 35 步逐条对照：33 一致；2 处轻歧义（claim 双触发类合并码、gc 执行半区范围读法）如实记录、不阻塞、待 Owner 裁决——**未代改 spec/design** | ☑ 建议勾选（附歧义上报；若 Owner 要求先裁决再闭门，勾选可推迟到裁决后） |
| ⑥ 字段可见性契约测试清单（tasks.md:12） | `field-visibility-test-checklist.md` | 四面 × 领域字段/provenance 子集/redact-paths/frontmatter 隔离/sourceUrl 脱敏三类输入（userinfo/credentials/query strings，S1-S3 对齐 spec 123-125 行）共 27 条 GIVEN/WHEN/THEN + 3 条 1.7.1 负面钉值；含 2 个显式实现裁决点 | ☑ 建议勾选 |

六项全部有对应收据文件；无一项含生产实现代码。

## 4. G0 门判定（收据产出方立场）

- 门条件（design.md G0 行）：specs strict 通过 ✓；npm 实证 + 投影全集分支 + registry 可见性过滤 + hash fixture 的输入与期望 digest 由 1.7.1 实跑钉死 ✓（收据文件）；typed 词表闭合清单 ✓；状态机一致性核对 ✓；可见性测试清单 ✓。
- 不可构造场景已如实记录（真 no-detection 在本机受 `/Applications/ZCode.app` 检测泄漏限制，以 `--agent '*'` 同集合等价构造 + 源码钉值补全），不构成门阻塞。
- 遗留 Owner 决策点 2 个（均不阻塞 G0，详见状态机核对表 §5）：C5 claim 双触发类的码内区分粒度；G8 gc 执行半区是否入 3.0 范围。
- **收据产出方结论：G0 六项收据齐备，建议 MainAgent/Codex 复核后判 G0 通过、开批 1。**（最终判定权在复核方；本文件只提供证据与建议。）
