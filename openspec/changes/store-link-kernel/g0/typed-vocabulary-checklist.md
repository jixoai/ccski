<!--
文件意图（2026-10-07）
用户原始需求 [2026-10-07]：「typed 词表闭合核对表：spec 全部错误码/状态码逐条：码名/spec 出处/触发条件/所在批任务——Markdown 表」
正交意图：
  [1] 证明 3.0 内核失败词表闭合（每码都有 spec 唯一出处 + 触发条件 + 实现批次，无 design-only 词）
  [2] 记录 2.x 既有码的处置（退役/收编），防止旧词表泄漏进新内核
妥协声明：spec 行号随上游编辑会漂移，行号后附 Requirement/Scenario 名作为稳定锚。
-->

# G0 收据：typed 词表闭合核对表

依据：`specs/entity-projection-kernel/spec.md`（契约本体，r 行号为 2026-10-07 版本）+ `design.md` 门表 + `tasks.md` 批次。spec 引用格式：`Requirement 名 / Scenario 名（行号）`。

## 1. 3.0 新内核码（spec 为唯一契约来源）

| # | 码 | 类型 | spec 出处（Requirement / Scenario，行号） | 触发条件 | 实现批次（tasks.md） |
| --- | --- | --- | --- | --- | --- |
| 1 | `SCOPE_REQUIRED` | failure | Scope-aware entity layer / Scenario: Scope required for mutation（6, 8-10） | SDK mutation 缺显式 `scope`；无文件系统或 state 副作用 | 批 3（ensureEntity/projectEntity，tasks.md:30-31） |
| 2 | `NAME_COLLISION` | failure | Scope-aware entity layer / Scenario: Sanitize collision rejection（6, 12-14） | 两个不同逻辑名在同一 scope sanitize 出同一 folderName；第一个实体不动 | 批 3（tasks.md:30） |
| 3 | `NAME_EXISTS` | failure | Frozen same-name replace state machine / Scenario: Unforced same-name install is rejected（91, 93-95） | 已存在逻辑名来自不同 source 且未带 `replace`；现有实体不动 | 批 3（tasks.md:30） |
| 4 | `STATE_GENERATION_CONFLICT` | failure | Layered single writers / Scenario: Concurrent state write loses cleanly（17, 23-25） | 写者携带过期 generation 提交 CAS；失败后必须重读，禁止盲覆盖 | 批 1（state-store，tasks.md:16-17） |
| 5 | `STATE_RECOVERY_REQUIRED` | failure（只读降级标注） | Layered single writers 正文（17） | state 损坏或未知版本 → 只读降级，不得当可写空 state | 批 1（recovery primitive，tasks.md:17；repair CLI 在批 5，tasks.md:44） |
| 6 | `LOCK_VERSION_UNSUPPORTED` | failure（只读 opaque view 标注） | Layered single writers / Scenario: Unknown lock version is a read-only opaque view（17, 19-21） | npm lock 报未知 `version` → 只读 opaque view；不得用于 mutation、不得误当可替换空 lock | 批 1（lock reader，tasks.md:19） |
| 7 | `ENTITY_REVISED` | failure | Physical disable semantics / Scenario: Enable after entity replacement（50, 56-58） | enable 时记录的 `entityRevision` 与实体不符；投影保持 disabled，提示 update | 批 4（toggle，tasks.md:38） |
| 8 | `STALE_PROJECTION` | warning/failure（verify 时） | Frozen same-name replace state machine 正文（91：link 投影记录的旧 revision 标 stale，下次 verify 报 STALE_PROJECTION） | replace 换新实体后，link 投影记录的 revision 未刷新即被 verify | 批 4（update/toggle verify，tasks.md:37-38） |
| 9 | `PINNED` | typed skip | Stable-path entity update / Scenario: Pinned projection is skipped（80, 86-88） | update 遇到记录为 pinned（source ref + folder hash）的物化投影 → 跳过且副本不动 | 批 4（update，tasks.md:37） |
| 10 | `FOREIGN_OWNERSHIP` | failure | First-class symlink discovery / Scenario: External live-link is read-only（45, 45-47） | 对 `ownership:"external"` 的 live-link 执行 remove/update/toggle | 批 2（发现层观察，tasks.md:23）+ 批 4（mutation 拒绝，tasks.md:36-38） |
| 11 | `TARGET_DENIED` | failure（不可降级） | Two-phase install / Scenario: Target denial does not silently copy（28, 34-36） | 投影根写入 `EACCES` 等目标级权限/ownership 错误；直接失败，禁止静默 copy | 批 3（projectEntity，tasks.md:31） |
| 12 | `symlink-unavailable` | downgrade reason（唯一自动降级类） | Two-phase install / Scenario: EPERM on symlink syscall downgrades honestly（28, 30-32） | `symlink()` 系统调用族失败（`EPERM`/`ENOSYS`/`EXDEV`/junction 不支持）→ `mode:"materialized", reason:"symlink-unavailable"`；目标级权限错误不属此类（见 #11） | 批 3（tasks.md:31） |
| 13 | `GUARD_ENTITY` | failure | Ownership-first removal and entity GC 正文 + Scenario: Entity revision guard on replace（61, 67-69） | 实体 replace/mutation 的 `expectedRevision` 与实体不符；实体不动 | 批 3（replace 状态机，tasks.md:30）+ 批 4（update guard，tasks.md:37） |
| 14 | `GUARD_PROJECTION` | failure | Ownership-first removal 正文 + Scenario: Replaced projection path is refused（61, 63-65） | 物化投影的磁盘 inode/content 与记录 guard 不符（外部中途替换）；路径不动 | 批 4（remove，tasks.md:36） |
| 15 | `CLAIM_CONFLICT` | failure | Explicit claim, repair, and gc contracts / Scenario: Claim requires exact identity（102, 108-110） | `import --claim` 目标 inode 或 content hash 与期望不符；零 state 变更 | 批 5（tasks.md:44） |
| 16 | `REPAIR_CONFIRM_REQUIRED` | failure | Explicit claim, repair, and gc contracts 正文（102：缺 `--confirm` 失败 typed） | `state repair` 带差异却未带 `--confirm` | 批 5（tasks.md:44） |
| 17 | `GC_UNKNOWN_REFERENCE` | typed warning | Ownership-first removal / Scenario: Unknown reference blocks GC（61, 75-77）+ Explicit claim… contracts 正文（102） | 未注册 root 存在指向实体的 symlink → 实体保留 + warning；本次投影 remove 仍成功；`gc --dry-run` 以此码提案 | 批 4（remove GC，tasks.md:36）+ 批 5（gc，tasks.md:44） |

闭合性检查结论：

- tasks.md 批 0 词表（tasks.md:10）列出的 17 个码全部能在 spec 找到正文或 Scenario 出处——**闭合**。
- spec 要求 "finite failure vocabularies" 的三条命令（claim/repair/gc，102 行）的码全部入表（#15/#16/#17）。
- v3 复审要求的 `GUARD_ENTITY`/`GUARD_PROJECTION` spec 缺口已在 v4 版 spec 补齐（61-69 行），核对一致。
- `symlink-unavailable` 是降级 reason 而非 failure 码，与 `TARGET_DENIED`（failure）在词表中的类型位不同，实现时不得合并为一个枚举的同一分支。

## 2. 2.x 既有码处置（remove/install/toggle 现行词表，`src/api/types.ts` 只读勘察）

| 既有码 | 现位置 | 3.0 处置建议 | 依据 |
| --- | --- | --- | --- |
| install `status: installed/overwritten/skipped/failed` | InstallResultEntry | 保留语义，载体换 entity/projection 结果（mode+reason 必带） | E5「结果恒返回规范化 mode + reason」 |
| remove `status: removed/skipped/failed` + `RemoveSkipReason: NOT_FOUND` | RemoveResultEntry | 保留；投影作用域下 NOT_FOUND 语义改指投影缺失 | E4 projection-first |
| `RemoveFailureCode: INVALID_NAME` | RemoveFailureCode | 收编（输入校验类，与 NAME_COLLISION/NAME_EXISTS 正交） | 冻结 sanitize 后 folderName 合法性仍需此码 |
| `PATH_ESCAPE` | RemoveFailureCode | 保留（containment 边界码，与 kernel 无冲突） | 安全边界不变量 4/5 |
| `NOT_DIRECTORY` / `NOT_A_SKILL` | RemoveFailureCode | 保留（实体/投影解析失败的物理形态码） | 发现层 entryKind 区分后语义更精确 |
| `SYMLINK_TARGET` | RemoveFailureCode | 被 `FOREIGN_OWNERSHIP` + projection-first unlink 取代（2.x 是「拒绝动 symlink」，3.0 是「link 投影 unlink、external 拒绝」） | E4/E6 |
| `GUARD_INVALID` / `GUARD_MISMATCH` / `GUARD_UNREADABLE` | RemoveFailureCode | 拆分收编：守卫读取失败态并入 `GUARD_ENTITY`/`GUARD_PROJECTION` 两态；`GUARD_MISMATCH` 族名退役（v3 复审裁定 spec 只认两个具体码） | spec 61-69 |
| `DELETE_FAILED` | RemoveFailureCode | 保留（文件系统删除失败的 typed 终态） | E4 |
| toggle `status: enabled/disabled/skipped/failed` | ToggleResultEntry | link 模式改「摘链/重建」语义；`ENTITY_REVISED` 加入 failed 族 | E3 |
| workflow-install `installed/updated` 状态 | WorkflowInstallResultEntry | 3.0 边界外（宿主 repository install 走 host change） | proposal Impact |

处置原则：2.x 码不自动进入 3.0 词表；上表「保留/收编」项在批 3/4 实现时逐一对号，「取代/退役」项不得在新 API 中复用旧名，避免双语义。

## 3. 结果状态词（非失败码，spec 正文钉值）

| 词 | spec 出处 | 语义 |
| --- | --- | --- |
| `mode: "link" \| "materialized"` | Two-phase install 正文（28） | 投影模式；默认 link；materialized 需显式 reason |
| `reason`（`symlink-unavailable`/`pinned`/`imported-root`/`user-request`） | Two-phase install 正文（28）+ design E5 | 仅 `symlink-unavailable` 可自动；其余三者显式触发，永不自动 |
| `ownership: "ccski" \| "external" \| "unknown"` | First-class symlink discovery 正文（39） | 发现层归属三态 |
| `entryKind`（regular/symlink/broken 等） | First-class symlink discovery 正文（39） | 发现层条目形态；broken 为 typed omission |
| `convention: "ccski-legacy"` | Physical disable semantics 正文（50） | 物化模式 `.SKILL.md` 兼容标注（非 npm 语义） |
| `provenance: legacy-unknown` | Versioned breaking release / Scenario: Legacy directory is never auto-converted（145-147） | 存量物化目录首次发现标注 |
| `lockSyncPending` | Frozen same-name replace 正文（91） | replace 不写 npm lock 时宿主流程的诚实返回 |
