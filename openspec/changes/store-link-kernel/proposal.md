# Proposal: store-link-kernel — ccski 3.0 内核演进（store-and-link 主内核 + 物化显式模式）

## Why

Owner 裁决（2026-10-07，长期主义）：ccski 与 npm:skills（vercel-labs/skills）的兼容目标是**内核一致**，不是协议同构。当前 ccski 是 copy-per-root 物化内核：实体与投影无分层、顶层 symlink 被发现层丢弃（`entry.isDirectory()` 恒 false）、per-agent 状态会误写共享实体。本仓真实磁盘已是三种形态并存（npm 实体+投影、live-link 指向开发目录、ccski 物化副本），分叉由宿主补丁（skill-creator 的 ccski-symlink-entries）勉强缝合。

方向（已定）：**store-and-link 为主内核**（实体层 + symlink 投影 + lock 记账，与 npm:skills 完全同构）；**copy 物化降级为显式模式**——它是「安装态的 agent 作用域」语义的物理基础（per-agent 禁用/版本钉住）与 symlink 不友好环境（Windows 权限/跨盘/CI）的可移植兜底，退居幕后不删除。

Codex 评审（同目录 `codex-kernel-review.md`，含 skills@1.7.1 隔离 HOME 四项实证）与 change 终审（AMEND 8 项）均已吸收：契约本体见 `specs/entity-projection-kernel/spec.md`（`openspec validate --strict` 必过）；门结构 = G0 契约冻结门（批 0）+ Gi 各批执行收据门；字段可见性契约、同名 replace 状态机、EPERM 分类、默认投影全集、hash fixture 输入与期望 digest 为 G0 收据（1.7.1 实跑钉死，批 0 产出）。

## What Changes

- **E1 实体与投影**：scope-aware 实体层（global `$HOME/.agents/skills/<folderName>` / project `<workspace>/.agents/skills/<folderName>`）；逻辑名与目录名分离（npm sanitize 算法 + `NAME_COLLISION` typed）；API 两阶段 `ensureEntity` + `projectEntity(roots[])`（SDK 只收显式 roots，CLI 才做 agent 检测）；外部 live-link = 一等只读条目（ownership: external）。
- **E2 分层单写者**：npm `.skill-lock.json` 唯一写入者 = skills CLI（ccski 只读 provenance，raw passthrough 契约）；ccski 自有 `scopeBase/.ccski-state.json`（实体所有权/投影/模式/禁用/revision/generation），tmp+fsync+rename + generation CAS。
- **E3 per-Agent 状态**：link 禁用 = **摘链 + state 记 disabled**（物理生效，sidecar 布尔不构成禁用证明）；enable 按实体 revision 重建链；`.SKILL.md` 改名仅存于物化模式（实证非 npm 官方语义，API 显式标注）。
- **E4 remove/update**：remove 先投影 ownership 后实体 GC（sidecar + 全注册 roots lstat 复核，不照抄 npm detected-agents-only refcount 的 dangling 缺陷）；update = 实体目录稳路径换新（投影 symlink 不破）+ 物化逐副本重物化 + `PINNED` 跳过；禁用「原子 reinstall」表述。
- **E5 物化显式化**：`mode: "link"|"materialized"` 默认 link；**自动降级仅一种 reason = `symlink-unavailable`**（symlink 系统调用族失败；目标级权限错误 = `TARGET_DENIED` 直接失败不降级）；`pinned`/`imported-root`/`user-request` 是显式物化触发，永不自动；结果恒返回规范化 `mode + reason`。
- **E6 发现层**：顶层 symlink 一等（lstat→resolve 单层）、递归层拒绝、broken typed omission、保留名精确 glob `.ccski-staging-*`/`.ccski-backup-*` 跳过；宿主 wrapper 按「先 ccski 后切宿主再删」顺序退役。
- **E7 版本迁移**：ccski **3.0.0**；存量物化目录默认 `materialized + legacy-unknown` 保留；`migrate --dry-run` hash 守卫 + 可回滚。

## Impact

- ccski：`src/core/discovery.ts`、`src/api/{install,remove,toggle}.ts` 重写为 entity/projection 内核、新增 state 层与 npm-lock reader、CLI 命令面扩展（migrate/gc/state repair）——major 破坏边界。
- skill-creator-v2（另列下沉批）：repository install 换新 API、ccski-symlink-entries 退役、skillFolderHash 单源化、skills-update 明确 `lockSyncPending`、canonical 层区分逻辑名/目录名/实体路径/投影路径。
- 非目标：不写 npm lock（分层单写者裁定）；不做跨模式原子 reinstall；不 vendor agent registry（SDK 显式 roots）。
