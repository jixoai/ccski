# Tasks: store-link-kernel（v2）

> 门结构见 design.md「门结构」节：G0 = 批 0 契约冻结门（不过不开工）；Gi = 各批自身执行收据门（不过不进下一批）。

## 批 0 · G0 契约冻结门（实现前，全部完成才允许批 1）

- [x] specs/entity-projection-kernel 通过 `openspec validate store-link-kernel --strict` — openspec/ — P0-1
- [x] npm 四项实证 + 默认投影全集分支（detected+universal / no-detection --yes registry 退化 / showInUniversalList 过滤 / per-agent 部分成功收据 / 无 global 能力 agent 失败条目）钉成 parity fixture：**1.7.1 实跑记录输入与期望输出** — tests/parity-npm-skills.test.ts — P1-2
- [x] folder-hash fixture 收据：输入树 + 期望 digest 由 1.7.1 实跑钉死成**收据文件**（排序相对路径 + path bytes + file bytes、仅 regular files、跳 .git/node_modules）+ 对宿主的公开导出接口**定名**（仅命名与签名，实现在批 1） — tests/fixture 收据 — P1-6
- [x] typed 词表闭合清单（收据文件，无生产实现）：NAME_COLLISION/NAME_EXISTS/SCOPE_REQUIRED/STATE_GENERATION_CONFLICT/STATE_RECOVERY_REQUIRED/ENTITY_REVISED/STALE_PROJECTION/PINNED/FOREIGN_OWNERSHIP/TARGET_DENIED/symlink-unavailable/LOCK_VERSION_UNSUPPORTED/GUARD_MISMATCH 族（GUARD_ENTITY/GUARD_PROJECTION）/CLAIM_CONFLICT/REPAIR_CONFIRM_REQUIRED/GC_UNKNOWN_REFERENCE — 与 spec 逐条对齐的核对表 — G0
- [x] replace/claim/repair/gc 状态机评审（design 冻结版 vs spec 一致性人工核对表） — design.md + specs — P1-3/P1-4
- [x] 字段可见性契约测试清单（CLI/MCP/list·info/文件读取 × 领域字段/provenance 子集/redact-paths/frontmatter 隔离/**sourceUrl 脱敏三类输入**（userinfo/credentials/query strings，对齐 spec「Source URL sanitization」Scenario）） — specs + tests 清单 — P1-1

## 批 1 · state 单写者层【门：并发与崩溃收据】

- [x] `.ccski-state.json` 写入协议（tmp+fsync+rename + generation CAS + STATE_GENERATION_CONFLICT） — src/core/state-store — E2
- [x] state-store recovery primitive 收据：双进程竞争、kill -9 恢复、部分写降级（STATE_RECOVERY_REQUIRED）——repair **CLI** 在批 5 — src/core/state-store + tests — G1 门
- [x] folder-hash 单源实现（按批 0 收据）+ 对宿主导出 — src/core/folder-hash — P1-6
- [x] npm lock reader：raw passthrough（未知字段保留往返）、unknown version 只读降级拒当空 — src/core/lock-reader + tests — E2

## 批 2 · 发现层升级【门：发现矩阵全绿】

- [x] 顶层 symlink 一等（lstat→realpath 单层、canonicalPath/entryKind/ownership）+ 递归拒绝 + broken typed omission — src/core/discovery — E6
- [x] 保留名精确 glob（.ccski-staging-*/.ccski-backup-*）+ marker+age/generation 条件清扫 — discovery + tests — E6
- [x] 发现矩阵（**人工磁盘 fixture，不依赖批 3/5 API**——claim/占用以磁盘形态构造观察）：global/project × link/materialized × enabled/disabled × regular/broken/external × **30+ roots** × foreign 条目 × 投影路径被占用 — tests — G2 门
- [x] legacy 物化目录 `materialized + legacy-unknown` 标注 — discovery — E7

## 批 3 · ensureEntity / projectEntity【门：API 契约测试】

- [x] ensureEntity（scope-aware + NAME_COLLISION + NAME_EXISTS/显式 replace 状态机含回滚） — src/api — E1/P1-3
- [x] projectEntity（显式 roots；link 默认；materialized 显式 reason；自动降级仅 symlink-unavailable 一类；TARGET_DENIED 不降级；strict link-only；结果如实 mode+reason） — src/api — E5/P1-5
- [x] 2.x install 入口迁移裁决：targetRoot 物化 → materialized 显式（不造未批准兼容胶层） — src/api/install — E7

## 批 4 · remove / update / toggle 内核化【门：组合矩阵 + update 收据】

- [ ] remove 投影先行 + 实体 GC（全 roots 复核 + 未知引用保留 warning） — src/api/remove — E4
- [ ] update 实体稳路径换新 + 物化逐副本重物化（自身 hash guard）+ PINNED skip 收据 + replace 崩溃窗口恢复测试 — src/api/update — E4/P1-3
- [ ] toggle link 摘链/重建（ENTITY_REVISED）+ 物化 ccski-legacy 标注 + link 禁第二身份文件 — src/api/toggle — E3
- [ ] 组合矩阵收据：discovery/remove/toggle 全组合 + disabled-after-update + crash 恢复 — tests — G4 门

## 批 5 · migrate 与 CLI 面【门：dry-run 不变性】

- [ ] migrate --dry-run（碰撞/hash/目标实体/投影计划/影响 roots）+ 执行（expected hash 守卫 + backup/journal 回滚） — src/cli + src/api — E7
- [ ] gc --dry-run（不自动删）+ state repair（diff+confirm+备份+幂等）+ import --claim（inode+hash 守卫） — src/cli — P1-4
- [ ] CLI agent 检测默认全集（含 no-detection --yes 退化与 per-agent 部分成功收据，对齐批 0 fixture） — src/cli — P1-2

## 批 6 · 发版与宿主下沉【门：全量发版门】

- [ ] 发版门（全过才 3.0.0）：`openspec validate --strict` + `pnpm ts` + `pnpm test` 全量 + `pnpm build` + parity 矩阵 + migrate/recovery 收据 + Windows 可跑环境收据（无环境则 release notes 显式声明未验证面，不视为通过） — 仓内 — P1-7
- [ ] 【跨仓·skill-creator-v2 另立 host change】repository install 换 entity/projection API（保留 installedSkillId 复核链）+ ccski-symlink-entries 三步退役 + folder-hash 单源消费 + skills-update lockSyncPending 诚实化 + canonical 层区分逻辑名/目录名/实体/投影 — host 仓 — 评审硬门 5
- [ ] host 全链路无漂移复跑（provider/sourcePriority/canonical path/mutation target 对照表）后才删 wrapper — host 仓 — G6 门
