<!--
文件意图（2026-10-07）
用户原始需求 [2026-10-07]：「状态机一致性核对表：replace/claim/repair/gc 四状态机 design vs spec 逐条对照（每步：design 位置 → spec Requirement/Scenario 位置 → 一致/歧义标记；发现歧义如实记录并停下报告，不得自行改 spec/design）」
正交意图：
  [1] 证明四个冻结状态机在 design（裁决理由）与 spec（契约本体）之间无第二解释
  [2] 独立记录歧义点供 Owner 裁决，不代改契约
妥协声明：design.md 行号为 2026-10-07 版本；spec 引用附 Requirement/Scenario 名锚定。
-->

# G0 收据：replace / claim / repair / gc 状态机一致性核对表

对照物：`../design.md`（design 冻结版）vs `../specs/entity-projection-kernel/spec.md`（契约本体）。标记：`一致` / `歧义`（含理由与建议裁决方向，**未改任何契约文件**）。

## 1. 同名 replace 状态机

design 位置：`design.md`「同名 replace 状态机（终审 P1-3 冻结，spec 同步）」（36-38 行）+ 评审裁决表 #1（56 行）。

| # | 状态机步骤 | design 位置 | spec 位置 | 判定 |
| --- | --- | --- | --- | --- |
| R1 | 无 `replace` → `NAME_EXISTS` 拒绝（显式优于隐式，不照抄 npm 静默覆盖） | design.md:36 | Frozen same-name replace 正文（91）+ Scenario: Unforced same-name install is rejected（93-95） | 一致 |
| R2 | 显式 replace 需当前实体的 `expectedRevision` | design.md:36 | Frozen same-name replace 正文（91：「explicit `replace` with `expectedRevision` of the current entity」） | 一致 |
| R3 | guard 失败 → `GUARD_ENTITY`、实体不动 | design.md:61（裁决表 #6）+ tasks.md:10 | Ownership-first removal / Scenario: Entity revision guard on replace（67-69） | 一致 |
| R4 | 实体稳路径换新（staging + 同 scope rename）；失败 backup 回滚、旧实体保持可用、state 记失败 generation | design.md:36（「失败 backup 回滚，旧实体保持可用」） | Frozen same-name replace 正文（91：「swaps entity content at the stable path (with backup restore on failure — the old entity remains usable)」）+ Scenario: Replace failure restores（97-99：「state records the failed generation」） | 一致 |
| R5 | 换新与 guard 检查之间的 crash window（update 场景） | design.md:31（E4「update = 实体目录稳路径换新」）+ tasks.md:37（「replace 崩溃窗口恢复测试」） | spec 无 crash-window 专条；由 Scenario: Replace failure restores（97-99）+ Stable-path update（79-88）共同覆盖 | 一致（弱覆盖注记：spec 无独立 crash Scenario，验收落在批 4 测试 tasks.md:37——G4 门承接，不判歧义） |
| R6 | state 刷新 revision/provenance | design.md:36 | Frozen same-name replace 正文（91：「refreshes state revision/provenance」） | 一致 |
| R7 | 各投影 `disabled` 记录保留 | design.md:36 | 同上（91：「preserves per-projection `disabled` records」） | 一致 |
| R8 | link 投影记的旧 revision 标 stale；下次 verify 报 `STALE_PROJECTION`；链接按路径语义自然解析到新内容 | design.md:36 | 同上（91：「marks link projections' recorded revisions stale (next verify reports `STALE_PROJECTION`; links resolve to new content by path semantics)」） | 一致 |
| R9 | 物化/pinned 副本不动 | design.md:36 | 同上（91：「leaves materialized and pinned copies untouched」） | 一致 |
| R10 | 外部 live-link 永不触碰 | design.md:36 | 同上（91：「never touches external live-links」） | 一致 |
| R11 | npm lock 不写；宿主流程诚实返回 `lockSyncPending` | design.md:36 | 同上（91：「does not write npm lock (host update flows report `lockSyncPending`)」） | 一致 |
| R12 | replace 与 update 的分工（update = 稳路径换新 + 物化逐副本重物化 + PINNED skip） | design.md:31（E4） | Stable-path entity update 正文（79-80）+ 两个 Scenario（83-88） | 一致（replace 与 update 共享换新机制，spec 用两个 Requirement 分述；无冲突） |

replace 结论：**12/12 一致，0 歧义**。design 与 spec 逐步对应，无第二解释空间。

## 2. claim 状态机（import --claim）

design 位置：`design.md` 裁决表 #3（58 行：「`import --claim` 需目标 inode + content hash；冲突 typed；只动 state 可回滚；GC 永不猜路径」）。

| # | 状态机步骤 | design 位置 | spec 位置 | 判定 |
| --- | --- | --- | --- | --- |
| C1 | claim 前置身份 = 目标期望 inode + content hash | design.md:58 | Explicit claim… contracts 正文（102：「only with the target's expected inode and content hash」） | 一致 |
| C2 | 身份不符 → typed 失败（`CLAIM_CONFLICT`）、零 state 变更 | design.md:58（「冲突 typed」）+ tasks.md:10 词表 | 同正文（102）+ Scenario: Claim requires exact identity（108-110：「the claim fails typed and no state change occurs」） | 一致 |
| C3 | claim 只动 state（文件系统不变）、可由 state revert 回滚 | design.md:58 | 同正文（102：「a claim MUST touch state only (filesystem unchanged) and MUST be reversible by state revert」） | 一致 |
| C4 | claim 的采纳对象 = 外部 symlink → ccski projection（ownership 迁移） | design.md:58（上下文 Q3）+ codex-kernel-review.md Q3 | 同正文（102：「adopt a foreign symlink as a ccski projection」）+ Scenario: External live-link is read-only（45-47，未 claim 前 FOREIGN_OWNERSHIP） | 一致 |
| C5 | 同名冲突（claim 目标逻辑名与现有实体/投影冲突）| design.md:58 未逐步展开 | 同正文（102：「name conflicts MUST fail typed `CLAIM_CONFLICT`」） | **歧义（轻）**：`CLAIM_CONFLICT` 同时覆盖「inode/hash 不符」与「名字冲突」两类触发，spec 用一个码；实现时可区分（见建议）。建议裁决方向：单码 + `detail` 字段区分两触发类，或在批 5 收据中钉两个触发 fixture。**不阻塞 G0**（码已冻结，触发分类是实现收据粒度）。 |
| C6 | GC 永不猜路径（claim 是唯一合法 adoption 路径） | design.md:58 | 同正文（102）+ Ownership-first removal 正文（61：仅 lstat/realpath 复核的 ccski-owned reference 计入） | 一致 |

claim 结论：**5/6 一致，1 处轻歧义（C5，不阻塞，已记录待 Owner/批 5 裁决粒度）**。

## 3. repair 状态机（state repair）

design 位置：`design.md` 裁决表 #4（59 行：「扫描 vs sidecar 差异 → diff 报告 + `--confirm` + state 备份 + 幂等（二跑 no-op 报 clean）」）。

| # | 状态机步骤 | design 位置 | spec 位置 | 判定 |
| --- | --- | --- | --- | --- |
| P1 | 输入 = 文件系统扫描 vs sidecar 差异 | design.md:59 | Explicit claim… contracts 正文（102：「MUST compare a filesystem scan against sidecar」） | 一致 |
| P2 | 有差异且未确认 → `REPAIR_CONFIRM_REQUIRED`（拒绝执行） | design.md:59 + tasks.md:10 词表 | 同正文（102：「require `--confirm` (absent confirmation it fails typed `REPAIR_CONFIRM_REQUIRED`)」） | 一致 |
| P3 | 执行前写 pre-repair state 备份 | design.md:59 | 同正文（102：「write a pre-repair state backup」） | 一致 |
| P4 | 幂等：二跑 no-op 报 clean | design.md:59 | Scenario: Repair is idempotent（104-106：「the second run reports clean without writing state」） | 一致 |
| P5 | repair 的修复对象与边界（只修 state 记录，不动磁盘上非 ccski 拥有的条目） | design.md:59 未显式说「不动磁盘」 | spec 正文（102）亦未显式说；由 claim C3（claim 只动 state）与 gc 提案制间接约束 | 一致（边界由单写者边界推得：repair 写者是 ccski state；磁盘 mutation 属 remove/install 面。无冲突表述。） |
| P6 | diff 报告形态（print a diff） | design.md:59（「diff 报告」） | 同正文（102：「print a diff」） | 一致 |
| P7 | state 损坏/未知版本时 repair 的入口 | design.md:29（E2「STATE_RECOVERY_REQUIRED」）+ tasks.md:17（批 1 recovery primitive）| Layered single writers 正文（17：「Corrupt or unknown-version state degrades read-only with typed `STATE_RECOVERY_REQUIRED`」） | 一致（recovery primitive 在批 1、repair CLI 在批 5，tasks.md:17 注明「repair CLI 在批 5」——门序无矛盾） |

repair 结论：**7/7 一致，0 歧义**。

## 4. gc 状态机（entity GC + gc --dry-run）

design 位置：`design.md` 裁决表 #10（65 行：「state 保留 + `gc --dry-run` 提案，不自动删」）+ E4（30 行：「remove 先投影 ownership 后实体 GC（sidecar + 全注册 roots lstat 复核，不照抄 npm detected-agents-only refcount 的 dangling 缺陷）」）。

| # | 状态机步骤 | design 位置 | spec 位置 | 判定 |
| --- | --- | --- | --- | --- |
| G1 | remove 投影先行：link 只 unlink（禁止穿 link 递归删）、物化删目录且带自身 revision/inode guard | design.md:30（E4） | Ownership-first removal 正文（61：「link projections are unlinked (never recursively removed through a link), materialized projections delete their directory with the copy's own revision/inode guard」） | 一致 |
| G2 | guard 不符 → `GUARD_PROJECTION`、路径不动 | design.md:61（#6）+ tasks.md:10 | Scenario: Replaced projection path is refused（63-65） | 一致 |
| G3 | 实体 GC 条件 = state 无 active projection AND 全注册 roots lstat/realpath 复核无 ccski-owned reference AND 无未知 reference | design.md:30（E4） | Ownership-first removal 正文（61：「only when state has no active projection AND no ccski-owned reference exists among all registered roots (lstat/realpath verified) AND no unknown reference exists」） | 一致 |
| G4 | 未知 reference → 实体保留 + typed warning（`GC_UNKNOWN_REFERENCE`）；本次投影 remove 仍成功 | design.md:30（「未知引用保留 warning」）+ tasks.md:36 | Scenario: Unknown reference blocks GC（75-77）+ Explicit claim… 正文（102） | 一致 |
| G5 | 外部 live-link 不计入删除权限 | design.md:30 + codex-kernel-review.md E4 | Ownership-first removal 正文（61：「External live-links never count toward deletion authority」） | 一致 |
| G6 | 末引用移除 → 实体目录删除 + state/provenance 条目退役 | design.md:30 | Scenario: Last projection removal GCs the entity（71-73） | 一致 |
| G7 | `gc --dry-run` 只提案（roots 消失等 state 记录清理），不自动删 | design.md:65（#10） | Explicit claim… 正文（102：「`gc --dry-run` MUST propose cleaning state records whose roots vanished and MUST NOT delete automatically」） | 一致 |
| G8 | gc 的清理确认路径（dry-run 之后如何真删） | design.md:65 未展开（仅「提案」） | spec 亦未定义 gc 的执行半区（只有 MUST NOT delete automatically） | **歧义（轻）**：`gc`（非 dry-run）的执行语义、确认方式与 typed 结果在 design 与 spec 都未展开——当前契约只冻结「不自动删」半区。建议裁决方向：要么在 spec 补一句「execution requires the same `--confirm` + backup protocol as repair」，要么在 tasks.md 批 5 明示 gc 执行半区是否入 3.0 范围（当前 tasks.md:44 只列 `gc --dry-run`——可解读为 3.0 只交付 dry-run）。**不阻塞 G0**（契约无冲突，只是范围边界存在两种合法读法），记入回报待 Owner 确认。 |
| G9 | npm refcount dangling 缺陷不照抄（对照钉值） | design.md:30（E4 括注）+ parity 收据 §2 p5 观察 | spec 无 npm 对照句（不必须）；spec 61 的「all registered roots」即差异本体 | 一致 |
| G10 | disabled-after-update 组合（update 后 disabled 投影的处理） | design.md:36（R7 disabled 保留）+ tasks.md:39（组合矩阵收据） | Frozen same-name replace 正文（91）+ Physical disable semantics（50） | 一致（行为 = disabled 记录保留 + link 旧 revision 标 stale；组合验收在 G4 门） |

gc 结论：**9/10 一致，1 处轻歧义（G8，gc 执行半区范围两种合法读法，不阻塞，已记录）**。

## 5. 汇总

| 状态机 | 步骤数 | 一致 | 歧义 | 阻塞性 |
| --- | --- | --- | --- | --- |
| replace | 12 | 12 | 0 | — |
| claim | 6 | 5 | 1（C5：CLAIM_CONFLICT 双触发类合并于一个码） | 非阻塞；建议批 5 以 fixture 钉两个触发类 |
| repair | 7 | 7 | 0 | — |
| gc | 10 | 9 | 1（G8：gc 执行半区是否入 3.0 范围存在两种合法读法） | 非阻塞；建议 Owner 明示「3.0 只交付 gc --dry-run」或补执行协议 |

核对期间未修改 proposal/design/tasks/spec 任何文件；两处歧义仅在本表记录并在回报中上报。
