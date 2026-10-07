# Design: store-link-kernel（v2，按终审 AMEND 修订）

依据：Owner 长期主义裁决 + Codex 评审（`codex-kernel-review.md`）+ Codex change 终审（`/tmp/skills-integration/codex-kernel-change-verdict.md`，8 项必改已全部吸收）。规格面见 `specs/entity-projection-kernel/spec.md`——**spec 是契约本体，本文件只记裁决理由与门结构**。

## 核心边界（冻结）

```text
npm .skill-lock.json（$XDG_STATE_HOME/skills/ 或 ~/.agents/）—— 唯一写入者：skills CLI
  ccski 只读 provenance；raw passthrough（未知字段透传进契约测试；unknown version = 只读 opaque view（LOCK_VERSION_UNSUPPORTED，不得误认为可替换的空 lock））
ccski .ccski-state.json（scopeBase = global $HOME/.agents | project <workspace>/.agents）—— 唯一写入者：ccski
  实体所有权、投影清单（scope/rootId/path/mode/entityRevision/disabled/ownership）、folder hash、generation（CAS）
```

## 门结构（v3 完整映射，G0-G6）

| 门 | 位置 | 内容 | 阻断 |
| --- | --- | --- | --- |
| G0 | 批 0（实现前） | 契约冻结：specs strict 通过；npm 四项实证 + 投影全集分支 + registry 可见过滤 + hash fixture 的**输入与期望 digest 由 1.7.1 实跑钉死**（作为收据文件，不含生产实现）；typed 词表闭合清单；replace/claim/repair/gc 状态机一致性核对；可见性测试清单 | 不过不开批 1 |
| G1 | 批 1 | state 单写者收据：CAS 并发、kill -9 恢复、部分写降级（recovery **primitive**，非 repair CLI）；lock reader raw passthrough | 不过不进批 2 |
| G2 | 批 2 | 发现矩阵（**人工磁盘 fixture，不依赖批 3/5 API**）：scope × mode × enabled × regular/broken/external × 30+ roots × foreign 条目观察 × 投影路径被占用 | 不过不进批 3 |
| G3 | 批 3 | API 契约收据：ensureEntity/projectEntity 全 typed 路径（NAME_COLLISION/NAME_EXISTS+replace 回滚/降级分类/strict） | 不过不进批 4 |
| G4 | 批 4 | 组合矩阵 + update 收据：remove/GC/toggle 全组合、稳路径换新、PINNED、replace 崩溃恢复、disabled-after-update | 不过不进批 5 |
| G5 | 批 5 | CLI 契约 + dry-run 不变性：migrate/gc/state repair/import --claim 全 typed 收据（含 REPAIR_CONFIRM_REQUIRED/幂等/备份）、CLI 投影默认全集对齐 fixture | 不过不进批 6 |
| G6 | 批 6 | 发版门 + 宿主切换：strict/ts/test/build/parity/migrate-recovery/Windows 平台门；host 全链路无漂移复跑后才删 wrapper | 不过不发 3.0.0 |

## E1-E7 裁决要点（详见 spec）

- **E1**：scope-aware 实体层；folderName = 冻结 sanitize；`NAME_COLLISION` typed；两阶段 `ensureEntity`/`projectEntity`，SDK 显式 roots；外部 live-link `ownership:"external"` 只读。
- **E2**：分层单写者（见核心边界）；state 写入 tmp+fsync+rename+generation CAS；`STATE_GENERATION_CONFLICT`；`folder-hash` 单源实现并**对宿主导出唯一公开消费接口**（终审 P1-6）。
- **E3**：link 禁用 = 摘链 + state 记录（物理生效；sidecar 布尔不是禁用证明）；enable 校验 `entityRevision`（不符 → `ENTITY_REVISED`）；`.SKILL.md` 仅物化模式且标注 `convention:"ccski-legacy"`（实证非 npm 语义）。
- **E4**：remove 投影先行（link 只 unlink）→ 实体 GC（state + 全注册 roots 复核 + 未知引用保留 + warning）；update 实体稳路径换新、物化逐副本重物化、`PINNED`（ref+hash 组合 pin 落 state 并产出 skip 收据）；部分成功是常态，「原子 reinstall」表述禁用。
- **E5（终审澄清）**：**自动降级仅一种 reason = `symlink-unavailable`**；`pinned`/`imported-root`/`user-request` 三种是**显式物化触发**，永不自动。strict 选项 link-only 失败不降级。
- **E6**：顶层 symlink 一等（canonicalPath/entryKind/ownership）；递归层拒绝；broken typed omission；保留名精确 glob = `.ccski-staging-*` 与 `.ccski-backup-*`（marker + age/generation 条件清扫，非前缀盲删）。
- **E7**：3.0.0 major；存量物化 `materialized + legacy-unknown` 保留；`migrate --dry-run` + expected hash 守卫 + backup/journal 回滚；宿主下沉三步序（ccski 发布 → 宿主切换 → 删 wrapper，中间不许两套 scanner 并存）。

## 同名 replace 状态机（终审 P1-3 冻结，spec 同步）

无 `replace` → `NAME_EXISTS` 拒绝（对齐「显式优于隐式」而非 npm 静默覆盖）。显式 replace：需 `expectedRevision`（旧实体）→ 实体稳路径换新（失败 backup 回滚，旧实体保持可用）→ state 刷新 revision/provenance → 各投影 `disabled` 记录保留 → link 投影记的旧 revision 标 stale（下次 verify 报 `STALE_PROJECTION`；链接按路径语义自然解析到新内容）→ 物化/pinned 副本不动 → 外部 live-link 永不触碰 → npm lock 不写（宿主流程诚实返回 `lockSyncPending`）。

## Windows / EPERM 分类（终审 P1-5 冻结）

- `symlink-unavailable`（可降级）：symlink 系统调用族失败 `EPERM`/`ENOSYS`/`EXDEV`/junction 不支持。
- `TARGET_DENIED`（不可降级，直接失败）：投影根写入 `EACCES` 等目标级权限/ownership 错误。
- 平台门：Windows 语义在可跑环境（CI runner 或实机）为 release 阻断门；**无可用环境时明确记为「未验证面」，不得视为通过**，release notes 显式声明（诚实优先于进度）。

## 字段可见性契约（终审 P1-1，替代旧 Q13 裁决）

四个面（CLI stdout / MCP tools / list/info 投影 / 文件读取）按 spec `Field visibility contract` 执行：领域字段（身份/路径/provenance 子集/mode/ownership/revision）可见——路径是文件系统管理器的领域本体，不因「本地单用户」论断而裸奔也不假装脱敏；frontmatter 只经文档/文件读取面、不进 list 投影；lock 原文只暴露 provenance 子集；`--redact-paths` 提供相对路径输出口（贴日志场景）；MCP 字段集与 RPC 相同，transport 门（loopback+token）记录为传输边界而非隐私边界。测试钉死。

## 默认投影全集语义（终审 P1-2 补全）

CLI 层默认投影集合（SDK 恒显式 roots）：检测到 agent = detected + universal（受 registry `showInUniversalList` 类字段过滤）；**未检测 + 非交互 `--yes` = registry 全集退化**；逐 agent 尝试、部分成功、per-agent typed 收据；无 global 安装能力的 agent（如 PromptScript 类）记为失败条目而非静默跳过。以上全部分支进 parity fixture（钉 1.7.1，升级重跑）。materialized 目录能被 npm list 发现但无 mode/ownership 表达力的观察也入 fixture 注记。

## 评审 14 问裁决表（v2，终审对齐后）

1. 碰撞 → 冻结 sanitize + `NAME_COLLISION`；同名不同 source = `NAME_EXISTS` + 显式 replace 状态机（见上节）。
2. scope → 显式传参；mutation 缺 scope = `SCOPE_REQUIRED` 拒绝；无双视图、无隐式 precedence（host 决定视角）。
3. claim → `import --claim` 需目标 inode + content hash；冲突 typed；只动 state 可回滚；GC 永不猜路径。
4. repair → 扫描 vs sidecar 差异 → diff 报告 + `--confirm` + state 备份 + 幂等（二跑 no-op 报 clean）。
5. 禁用 → 摘链即物理禁用（E3）。
6. 外部变更 → expected revision/inode/hash guard（`GUARD_MISMATCH` 族：GUARD_ENTITY/GUARD_PROJECTION 两态，词表入 G0）；覆盖 entity replace 与投影路径被占用两类；重试 = 调用方重读 state。
7. Windows → 上节分类；strict link-only 可选。
8. 锁升级 → unknown version = 只读 opaque view（LOCK_VERSION_UNSUPPORTED，不得误认为可替换的空 lock）。
9. hash → fixture 输入 + 期望 digest 由 1.7.1 实跑钉死（排序相对路径 + path bytes + file bytes、仅 regular files、跳 `.git`/`node_modules`）；单源实现对宿主导出。
10. 投影清理 → state 保留 + `gc --dry-run` 提案，不自动删。
11. pin → source ref + folder hash 组合，落 state，update 产出 `PINNED` skip 收据。
12. 协议漂移 → SDK 显式 roots；CLI 检测语义全集进 parity（上节）；npm 升级重跑 parity。
13. 可见性 → 字段可见性契约（上节），测试钉死。
14. 验收归属 → ccski 仓拥有内核 parity（并发/crash/保留名/30+ roots/live-link 矩阵；Windows 按上节平台门）；skill-creator 仓拥有 wrapper 退役全链路复跑；两仓门都不过不发版。


## G0 收据回流裁决（2026-10-07，MainAgent）

1. **CLAIM_CONFLICT 双触发类**：单码保留，result 以 finite `reason` 区分 name-conflict / identity-mismatch 两类（批 5 fixture 钉两个触发类）。
2. **gc 范围**：3.0 只交付 `gc --dry-run`（与 spec 冻结面一致）；执行协议如需另立 change，不在本 change 偷偷扩面。
3. **uniqueDirs<=1 静默 copy（1.7.1 实测）**：npm 在全部目标共享同一 skillsDir 时静默 copy 无 canonical 实体——**已知分歧，不照抄**：ccski ensureEntity 恒建实体；投影根 == 实体根的形态已由 Codex 裁决冻结（2026-10-07）：**第四形态 entity-local**——收据 targetKind:"entity"/mode:"entity-local"/reason:"canonical-root"，path=canonicalPath=entityPath；不建链不复制不写投影记录（实体记录唯一权威），幂等；requestedMode 保留在收据（禁自拷贝伪装独立副本）；canonical root 不参与投影 disable/remove，remove 走实体 mutation 受 GUARD_ENTITY 保护。spec「Canonical root yields entity-local receipt」Scenario 同步。
4. **hash 算法代际**：1.7.1 = sha256 + localeCompare 排序（G0 收据 F1-F7 钉死）；本机存量 lock 存在旧算法 40-hex 条目——批 6 宿主切换时 update-check 需裁决代际差异兼容（建议：旧代 hash 视为 stale 触发一次重装收敛，具体批 6 定）。

## 实现期契约修正（2026-10-07，批 3 回流，MainAgent 亲验 dist 源码）

**sanitize 分歧修正**：spec 原句「spaces/underscores to hyphens」源自评审转述，与 npm:skills 1.7.1 dist 实读不符。dist 事实（cli.mjs sanitizeName，已亲验）：`toLowerCase().replace(/[^a-z0-9._]+/g,"-").replace(/^[.\-]+|[.\-]+$/g,"").substring(0,255) || "unnamed-skill"`——**下划线与点保留**、集合外游程转连字符、首尾 `.-` 剥离、255 截断、空落 unnamed-skill。裁决：ccski 对齐 dist（内核一致优先；spec 已同步修正）。后果消除：npm 装 `my_skill` 与 ccski 装 `my-skill` 不再分叉成两目录。

## 批 5 实现期裁决（2026-10-07，MainAgent 批准）

(a) ccski CLI 的 git/marketplace 安装源 3.0 退役 → typed `SOURCE_UNSUPPORTED` 指路宿主（git clone+install 本就是 skill-creator repository 域的职责）；(b) CLI mutation 缺省 scope = project（`--global` 切换；SDK 恒显式；与 npm 的 auto-detect 缺省为已知 CLI 层差异，不违 parity——parity 钉的是投影集合非 scope 缺省）；(c) migrate expected hash 守卫 = `--plan` 文件回传（无回传时同调用内 scan→execute 重 hash，并发窗由 CAS 收窄）；(d) agent 注册表 = npm 1.7.1 语义镜像非逐键复制（universal-class 压缩共享 canonical 根；zcode 检测不含 /Applications 探针——hermetic 优先）；(e) 批 5 命令面新增 finite 码 DRY_RUN_REQUIRED/NO_GLOBAL_INSTALL/HASH_MISMATCH 已补进 spec 对应 Requirement（词表闭合纪律）。

## 宿主迁移终审回流裁决（2026-10-07 P0-3，Codex 终审 → 内核修复）

**缺陷**：宿主（Creator 语义）在 `await` 内核调用前校验内容 revision，但 `deleteEntity` 的 `expectedRevision` 只与 state 记录比对、从不核对磁盘当前实体树——宿主校验后实体内容被并发改写再调删除，内核仍按 state 记录放行并销毁已被改写的磁盘内容（数据丢失竞态）。末投影 GC 的实体销毁路径同族（基准只有 state 记录）。

**裁决与实现**（`src/api/entity-remove.ts` + `src/api/entity-disk-guard.ts`）：

1. **revision 表示**：entity revision = `computeSkillFolderHash`（entity-state.ts 注释与 EntityRecord.revision 语义钉死的单源），守卫直接复用该函数，不引入第二种哈希口径。
2. **销毁前磁盘门（零副作用拒绝）**：`deleteEntity` 在 state 退役提交**之前**重算磁盘实体树哈希，与调用方 `expectedRevision` + state 记录**双重比对**；末投影 GC 以 state 实体记录为基准同构。不符 → `deleteEntity` typed `GUARD_ENTITY` / GC 以 `GC_ENTITY_DISK_GUARD` warning 拒绝销毁，两路径 state 记录与磁盘内容零副作用。GC retire 的 CAS transform 内追加 guarded-revision 复核（记录在门与提交之间被并发 ccski mutation 换新 → REVISION reject，实体保留），补齐并发写者象限。
3. **为什么不在 state 锁内持锁重算**：state 锁只串行化 ccski state 写者，对带外磁盘改写者（本竞态的对手方）没有任何互斥力；把哈希搬进锁内不改变攻击面。闭不变量改为「(CAS + transform 内 revision 复核) ∨ (磁盘身份 pin + 销毁前复核)」——state 侧竞态由 CAS 收口，磁盘侧竞态由身份判据收口，二者合取即 Codex 要求的「同一事务语义」的实际达成方式，且不加新的锁序。
4. **「重算 → 销毁」窗口第二道守卫**（`entity-disk-guard.ts`，模块内导出、不进包根公共面）：pin 实体目录 lstat inode + `SKILL.md` 持久 fd（`O_NOFOLLOW` 平台可用时启用；win32 由 lstat 不跟随 + lstat↔fstat 交叉复核兜底）+ fd 全文 digest。销毁前 verify：目录 inode 不符（整目录换体）/ 身份源路径 inode 不符（rename 盖帽换体，目录 inode 不变也可查）/ fd digest 漂移（原位字节改写）任一命中即拒绝销毁——state 已退役的场合按既有残留拓扑如实 warning（未记录目录 + 下次 install `ENTITY_PATH_OCCUPIED` typed 可见 + 批 5 repair 收敛），绝不为「收干净」反向删除换体后的内容。销毁前另有全树哈希复读（destroyGuardedEntity 内），覆盖 commit 窗口（锁等待最长 5s）内非身份文件的改动。
5. **与物化副本守卫的语义闭环核对**：`materializedCopyGuard`（copyHash/copyIno，lstat 时点 + 单次哈希 + rm）与本守卫同一闭合级——哈希单源同函数、inode 判据同 lstat 语义；实体路径额外加 fd pin 与 digest 复读，原因是其「哈希 → 销毁」之间隔着 state commit（可秒级），比物化路径的紧邻 rm 宽得多。不重复造第三套判据。
6. **残余窗口（诚实声明）**：verify 通过 → `rmSync` 之间及 rmSync 自身执行中的原位改写不可观测——Node fs 无按 fd 销毁 API，属平台边界；与物化副本守卫的残余同级。确定性测试按 Codex 要求锚「调用前注入改写」（tests/entity-delete-race.test.ts：deleteEntity 原位改写/目录换体/symlink 换体 + GC 原位改写/目录换体，断言 typed 拒绝 + 实体/投影/state/generation 全原样 + 两条无竞态基线不误伤）；窗口内注入无确定性 seam，由 guard 单元收据（rename 换体/原位改写/目录 inode 换体/路径消失/symlink 五形态）覆盖判据本身。
7. **API 形状**：Options/Result 零变化；新增拒绝全部落在既有词表（`GUARD_ENTITY`）或 warning 字符串（`GC_ENTITY_DISK_GUARD:` 前缀，对齐 `GC_UNKNOWN_REFERENCE:` 先例），`EntityRemoveGcReport.blockedBy` 三态联合不为本拒绝类扩面。
