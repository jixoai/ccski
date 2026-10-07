# ccski 内核演进议题：store-and-link 主内核 + 物化模式（2026-10-07）

## Owner 裁决（长期主义方向，已定）

1. 主通道统一为 store-and-link：**实体层 + symlink 投影 + lock 记账**，与 npm:skills（vercel-labs/skills）内核完全一致——这是「兼容」的最终定义（内核一致，非协议同构）。
2. copy 物化降级为**显式模式**：它是「安装态的 agent 作用域」语义的物理基础（per-agent disable/版本钉住）+ symlink 不友好环境（Windows 权限/跨盘/CI）的可移植兜底。可以从主通道退居，不能删除。
3. 发现层把 symlink 当一等条目；宿主补丁（skill-creator 的 ccski-symlink-entries）退役。
4. 锁写入者议题**现在必须裁**（此前 Δ4 defer 的前提消失了）。

## 已核实事实（本机磁盘 + 源码实证）

- npm:skills 安装形态：实体 `~/.agents/skills/<name>`，投影 symlink（`~/.claude/skills/x -> ../../.agents/skills/x`，zcode/claude 同实体多投影）。
- lock v3（`~/.agents/.skill-lock.json`）：键 = skill name；值 = `{source, sourceType, sourceUrl, skillPath（**源仓库内相对路径**，非本地安装位置）, skillFolderHash, installedAt, updatedAt}`——**lock 不含投影清单**（投影靠扫 roots 或 CLI 约定）。
- skills CLI 命令面：`add / use / remove / list / find / update (-g/-p/-y)` + `experimental_install`（从 lock 恢复）+ `experimental_sync`（node_modules 同步）+ `init`。
- `~/.agents/skills` 里存在**指向任意开发目录的 live-link**（atlas-canonizer -> world-class-designer/skills/…、gaubee-skills -> ~/Dev/Github/gaubee.com/skills/…）——「实体可以在任何地方」已是既成事实。
- ccski 现状（2.5.0 + 本周 removeSkills 批）：发现层 `entry.isDirectory()` 跳过 symlink 条目；install = staging 物化实目录（rename 交换）；remove 幂等 typed + symlink 目标拒绝；零 lock 感知。
- skill-creator 宿主：skills-update-service 已实现 lock 读取 + skillFolderHash 对比（hash 公式已对齐）；canonicalize 用 realpath 去重（投影天然归并回实体）；ccski-symlink-entries 补丁存在的原因即发现层分叉。

## 待裁决技术点（E1-E7）

### E1 实体层与投影协议
- 实体 canonical 位置是否钉 `~/.agents/skills/<name>`（与 npm:skills 完全同位）？多 skill 仓库（一个 repo 装出多个 skill）的实体命名（各 skill 独立实体 = lock 键语义一致）。
- ccski install API 形态：`{entity 安装（写实体+lock）+ roots[] 投影（建链）}` 替代现 targetRoot 物化；投影集合默认值怎么来（npm:skills 认识哪些 agent roots 的约定需逆向核实——它 add 时默认投到哪）。
- live-link（外部实体）：发现层一等认可，lock 不记账——认可这个二分吗？

### E2 lock 写入者与协作协议
- 单 lock 双写者（skills CLI + ccski）：原子写（tmp+rename）够不够？并发窗口？字段超集策略——ccski 若加扩展字段（如 materialized 标记、投影清单），skills CLI 对未知字段的容忍度未知（需实证：safeParse 宽容 or 清洗）——保守方案 = ccski 自有 sidecar（`~/.agents/.ccski-state.json`）零侵入 lock，代价是双状态源。
- skillFolderHash 公式宿主已有，确认下沉 ccski 后单一实现。

### E3 per-Agent 状态语义（产品域模型根基，最重要的裁决）
实体共享后 disable 的语义三选一：
- (a) **投影级 sidecar**（`<root>/.ccski-state.json`：name→disabled）——per-root 成立、不动实体、与产品 per-installation disabled 对齐；代价 = 新状态源 + 发现层要读它。
- (b) 实体级 `.SKILL.md` 改名——全局 disable，零新状态，但 agent 作用域消失（一个禁用全投影禁用）；且 `.SKILL.md` 是否 npm:skills 官方约定需核实（可能是我们生态自创）。
- (c) 模式相关：物化=实体级改名、link=投影级 sidecar——两种安装形态两种语义，心智负担最大但零迁移成本。
版本钉住只能靠物化（link 天然同版本）——钉住即物化的触发规则。

### E4 remove / update 语义
- remove（link 投影）：摘链 + 实体引用计数（数谁？扫已知 roots 的 link？sidecar 记账？）归零才删实体 + lock 摘条；npm:skills remove 的真实作用域需实证（删实体+全部投影？还是按 -g/-p？）。
- update apply = 实体替换：staging→rename 换目录，**路径不变投影 symlink 不破**（链接按路径解析）——确认此优化成立；物化副本 update = 重物化。
- lock 条目 `updatedAt/skillFolderHash` 刷新的写入者。

### E5 物化模式显式化
- API：`materialize?: true | { reason }`；自动物化触发 = symlink 创建失败（EPERM/EXDEV/Windows）+ 显式 imported root + 版本钉住。
- 物化条目记账：sidecar `installedVia: materialized`？npm:skills list 对物化实目录的行为（当 manual？）需实证。

### E6 发现层升级
- symlink 一等条目（lstat→isSymbolicLink→resolve；顶层跟进一层、递归层拒绝现状保持）；broken link typed omission；live-link 外部实体同形。
- `.ccski-staging-*/.ccski-backup-*` 残留：dot 前缀跳过 or 启动清扫（顺带闭环批 5 风险 3）。
- ccski-symlink-entries 宿主补丁退役路径（发现层一等后直接删）。

### E7 版本与迁移
- 破坏面（install/remove API 形态、发现行为）→ ccski **3.0.0**（major，semver 诚实）。
- 存量物化实目录：默认保留为物化模式（sidecar 标注）vs 提供 `migrate` 命令转 entity+link。
- skill-creator 宿主下沉清单：repository install 换新 API、symlink-entries 退役、skills-update hash 单源化、canonical 层不动。

## 交付请求

- 逐 E 裁决（同意/修改/反对 + 理由 + 你看到的风险），写 `/tmp/skills-integration/codex-kernel-review.md`。
- **实证核验项**（你有两仓 + 本机磁盘，可跑只读命令）：npm:skills add 的默认投影集合约定；remove 的作用域行为；对 lock 未知字段的容忍度；`.SKILL.md` 禁用约定是否其官方语义。
- 列出我没问但该问的问题。不改两仓任何文件。
