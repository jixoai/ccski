# ccski 内核演进评审

评审日期：2026-10-07

评审对象：`/tmp/skills-integration/KERNEL-EVOLUTION.md` 的 E1-E7、四项指定实证，以及上轮 `codex-review.md` 遗留的 lock 写入者议题。

评审边界：只读检查 `ccski` 与 `skill-creator-v2` 源码、npm 包 `skills@1.7.1` 的本机安装内容和隔离 HOME 运行结果。没有修改两个仓库；没有运行会改写两个仓库或 Owner HOME 的命令。运行探针和本报告只落在 `/tmp/skills-integration/`。

## 总裁决

Owner 选定的长期方向成立：**store-and-link 是主内核，物化是显式安装模式**。它解决了当前 ccski 的三个结构问题：实体与投影没有分层、顶层 symlink 被发现器丢弃、per-agent 状态会误写共享实体。

但现在还不能进入实现。必须先冻结下面这条边界：

```text
npm:skills .skill-lock.json  ---- 唯一写入者：skills CLI
                                  ccski 只读 provenance

ccski .ccski-state.json       ---- 唯一写入者：ccski
                                  记实体所有权、投影、模式、禁用、revision
```

两个程序不能直接 read-modify-write 同一个第三方 lock。npm CLI 1.7.1 的 lock 写入是直接 `writeFile`，没有跨进程锁或 tmp+rename；“两边都加原子写”在一方仍非原子时不能成立。若产品硬性要求 ccski 也写 npm lock，则必须先提供一个双方都调用的单一 writer/CLI adapter；在此之前应判为阻塞项，不能把 ccski 直接写 lock 当成完成。

当前实现是条件设计通过、运行实现未就绪。E1、E2、E3、E4、E5、E6、E7 的裁决如下。

| 项 | 裁决 | 关键收窄 |
| --- | --- | --- |
| E1 实体与投影 | 修改后同意 | scope-aware entity root、显式 projection、逻辑名与目录名分离、外部 live-link 只读归属 |
| E2 lock 写入者 | 反对双写；改为分层单写者 | npm lock 归 skills CLI，ccski state 归 ccski；未知字段必须保留，写入需有 generation/排他协议 |
| E3 per-agent 状态 | 同意选项 (a)，补物理语义 | link 禁用 = 摘掉该 projection 并由 sidecar 记 disabled；实体不改；物化 copy 可保留 `.SKILL.md` 兼容语义 |
| E4 remove/update | 修改后同意 | remove 先处理 projection ownership，再做实体 GC；update 可换实体目录但不能宣称跨模式原子 |
| E5 物化模式 | 修改后同意 | API 返回 link/materialized；自动降级必须显式记录 reason，不能把 copy 报成 symlink |
| E6 发现层 | 同意 | lstat 一等识别顶层 symlink、递归拒绝 symlink、broken link typed omission、staging 保留名跳过 |
| E7 版本迁移 | 同意 | 3.0.0；旧实目录默认保留为 legacy materialized，迁移必须显式、可预览、可回滚 |

## 证据基线

### ccski 当前形态

- `src/core/discovery.ts:127-140` 只接受 `entry.isDirectory()`，顶层目录 symlink 因此不会进入发现；而 `src/daemon/ccski-symlink-entries.ts:2-16,28-66` 的宿主补丁正是为这个盲区手工补扫 symlink。
- 当前默认 root 同时包含 user/workspace 的 `.agents/skills`、agent-specific roots 和 legacy `.agent/skills`：`src/core/skill-roots.ts:116-133`。实体 root 不能再靠“当前进程扫到的任意 root”隐式决定，必须携带 global/project scope。
- 现有 `installSkillDir` 仍接收 `targetRoot`，直接把 frontmatter name 作为 direct child；虽然已经有 lstat、restricted name、staging/backup swap，但它仍是物化 primitive：`src/api/install.ts:401-473`。
- 现有 `removeSkills` 是 host-guarded 的 direct-child 删除 primitive，主动拒绝 symlink 目标：`src/api/remove.ts:75-95,212-255`；它能处理 `SKILL.md` 和 `.SKILL.md`，但还没有实体/投影 ownership。
- `ccski` 已公开导出 `removeSkills` 与相关 typed result：`src/api/index.ts:1-60`。这为 3.0 的新 kernel 提供了迁移落点，但不能把当前 remove 语义直接当作 link-aware remove。

### skill-creator-v2 当前形态

- 宿主仍用 `ccski-symlink-entries` 对顶层链接做补丁：`src/daemon/ccski-symlink-entries.ts:28-66,73-101`。发现层一等支持完成后，这个补丁应删除，而不是继续保留两套 scanner。
- 宿主对安装结果做 direct-child、regular `SKILL.md`、frontmatter name、重新发现和 validate 校验：`src/daemon/repository-service.ts:462-537`。新 ccski API 不能删除这条外层复核。
- repository install 按 `target × skill` 顺序调用 installer：`src/daemon/repository-service.ts:623-716`。单项失败时已经完成的项保留，不能把它改名为跨 target 原子 reinstall。
- 宿主锁 schema 明确区分 global v3 `skillFolderHash` 和 project v1 `computedHash`：`src/shared/contracts/skills-lock.ts:13-39,47-59,63-101`。当前 schema 的 `z.object` 会在 parse 结果中丢弃未知字段，虽然 update service 目前只读并降级：`src/shared/contracts/skills-lock.ts:105-120`。
- `skills-update-service` 目前只在 daemon 内存 `hashOverlay` 中反映 apply 成功，不写第三方 lock：文件顶部注释 `src/daemon/skills-update-service.ts:1-10`，apply 路径 `:633-665`。这不能作为持久化完成的证明。

## 四项实证核验

### 1. npm:skills add 的默认投影集合

实跑版本：`skills@1.7.1`，通过 `npx --yes skills@latest --version` 得到 `1.7.1`。本机包位于 `/tmp/skills-integration/npm-skills-probe/npm-cache/_npx/.../node_modules/skills/`。

源码先给出确定规则：

- canonical global base 是 `join(homedir(), ".agents", "skills")`，project base 是 `join(cwd, ".agents", "skills")`：打包源码 `dist/cli.mjs:2208-2223`。
- universal agents 的 `skillsDir` 都是 `.agents/skills`，非 universal agent 才有独立 projection root：`dist/cli.mjs:2171-2181,2214-2223`。
- 未指定 `--agent` 时，CLI 在检测到一个或多个已安装 agent 的正常分支读取 detected agents，再加上全部 universal agents：`dist/cli.mjs:5351-5400`、`4653-4657`。如果一个 agent 都未检测到，非交互 `--yes` 分支会退化为 registry 中的全部 agent；交互分支则提示选择。README 只概括了“自动检测，未检测到时提示选择”：`skills/README.md:364-365`，所以不能把 detected + universal 当成无条件协议。
- 默认安装模式是 symlink；交互式多 root 才能选择 copy，`--copy` 明确请求物化：`skills/README.md:135-142`。link 创建失败时实现会 copy fallback：`dist/cli.mjs:2247-2272,2310-2357`。

隔离 HOME 的默认运行探针（文本输出；因为 1.7.1 的 global 安装不支持 `--json`，JSON 记录会返回 `PromptScript does not support global skill installation`，见同目录 `add.json`，不能把该 JSON 失败对象当成安装收据）：

```text
probe: /tmp/skills-integration/npm-skills-runtime-20261007-f
command: npx --yes skills@latest add <local-source> --global --yes
text receipt:  /tmp/skills-integration/npm-skills-runtime-20261007-f/add.err
result entity: ~/.agents/skills/gamma
result links:  ~/.claude/skills/gamma -> ~/.agents/skills/gamma
               ~/.zcode/skills/gamma   -> ~/.agents/skills/gamma
```

该探针的文本收据显示检测到 Claude Code、ZCode，并把 universal agents 汇入同一 canonical entity；因此“只建了一个 `.claude` 目录”不能被当作默认检测的完整集合。可复用的结论是：**有检测结果时，默认集合 = detected agent roots + 全部 universal agents + canonical `.agents/skills`；没有检测结果时，非交互 `--yes` 可能选择 registry 全集；任何情况下都不包含 registry 外的任意目录**。

另一个干净 HOME 的直接树探针 `/tmp/skills-integration/npm-skills-runtime-20261007-g` 只留下 `home/.agents/skills/gamma/SKILL.md`，没有 agent-specific link；文本输出同时报告 universal registry 中不支持 global install 的 PromptScript 失败，但 entity/lock 已写入。这说明默认安装是逐 agent 尝试、允许部分成功，且 agent 检测/registry 变化会改变 projection 集合；ccski 不应把一次 CLI summary 当成跨 root 原子收据。

显式 root 的干净运行也已完成：

```text
probe: /tmp/skills-integration/npm-skills-runtime-20261007-b
command: npx --yes skills@latest add <local-source> --global --yes \
           --agent claude-code openclaw --json
result:   ~/.agents/skills/alpha          (real entity)
          ~/.claude/skills/alpha          (symlink)
          ~/.openclaw/skills/alpha        (symlink)
```

实体和 projection 的分层与 Owner 方向一致。ccski 的 API 不应把“扫描到哪些目录”作为 SDK 默认投影集合；SDK 应接收明确的 `roots[]`，CLI 才可以复用 agent registry 的默认检测。

### 2. npm:skills remove 的作用域

同一隔离 HOME 上按 agent 做两次 remove：

```text
add --agent claude-code openclaw
remove alpha --global --yes --agent claude-code
```

第一次 remove 后的实际状态：

```text
~/.claude/skills/alpha       absent
~/.openclaw/skills/alpha     symlink remains
~/.agents/skills/alpha       real entity remains
XDG_STATE_HOME/skills/.skill-lock.json  still contains alpha
```

随后执行：

```text
remove alpha --global --yes --agent openclaw
```

最后一个 projection 摘掉后，实体目录被删除，lock 的 `skills` 变为空。结论：**指定 `--agent` 是 projection-scoped remove；实体和 lock 只有在没有剩余被 CLI 认定的 agent reference 时才 GC**。

源码中的实现细节需要作为 ccski 风险记录：`dist/cli.mjs:6854-6898` 先删 target agents 的路径，再只扫描 `detectInstalledAgents()` 的剩余 agents 决定 `isStillUsed`。未被检测到但仍存在的旧 projection 不在这个 refcount 集合中，可能留下 dangling link。这是 npm CLI 的可复用语义边界，不是 ccski 应照抄的安全实现；ccski 必须以 sidecar ownership + 所有已注册 roots 的 lstat 复核为准。

### 3. lock 对未知字段的容忍度

先在隔离 `XDG_STATE_HOME` 预置 v3 lock，给 alpha/beta entry 加 `futureEntryField`，顶层加 `futureTopLevelField`。然后运行：

```text
npx --yes skills@latest list --global --json
npx --yes skills@latest remove alpha --global --yes
```

`list` 成功返回 alpha，未因未知字段失败。remove 写回后实际 lock 仍保留：

```json
{
  "skills": {
    "beta": {
      "futureEntryField": "keep-beta"
    }
  },
  "futureTopLevelField": { "keep": true }
}
```

这验证了 `skills@1.7.1` 的 JSON reader/writer 对未知字段是宽容并透传的：`dist/cli.mjs:3751-3766,3773-3789`。它不等于“任意版本都兼容”，也不等于 host 的 Zod round-trip 会保留字段。`skill-creator-v2` 的 `SkillLockFileSchema`/`SkillLockEntrySchema` 是默认 strip unknown 的 Zod object，因此 ccski/host 如果解析后重新序列化，必须显式保留原始 raw object；更稳妥的是 ccski 不写第三方 lock。

另外确认了 lock 位置：设置 `XDG_STATE_HOME` 时实际文件是 `$XDG_STATE_HOME/skills/.skill-lock.json`，不是 `$HOME/.agents/.skill-lock.json`。宿主的 `globalSkillLockPath()` 同样如此：`src/daemon/skills-update-service.ts:152-156`。

### 4. `.SKILL.md` 是否为 npm:skills 官方禁用语义

实跑版本 1.7.1 的隔离 HOME 只放：

```text
~/.agents/skills/disabled-only/.SKILL.md
```

执行：

```text
npx --yes skills@latest list --global --json
npx --yes skills@latest remove --global --all
```

结果分别是 `[]` 和 `Found 0 unique installed skill(s)`；`.SKILL.md` 文件仍保留。npm 包源码对 skill identity 的读取均是精确 `SKILL.md`：`dist/cli.mjs:1240,1323,2704-2715`；README 的格式定义也是“directory containing a `SKILL.md`”：`skills/README.md:369-375`。在 npm 包源码和 README 中没有 `.SKILL.md` 的禁用约定。

因此结论是：**`.SKILL.md` 是 ccski 当前生态的兼容语义，不是 npm:skills 官方语义**。它可以继续作为 explicit materialized/legacy mode 的兼容层，但不能成为 shared entity 或 link projection 的跨 agent 协议。

## E1 实体层与投影协议

**裁决：修改后同意。**

1. 实体 root 按 scope 固定：global 使用 `$HOME/.agents/skills/<folderName>`，project 使用 `<workspace>/.agents/skills/<folderName>`。不能把 global 路径硬编码为唯一实体位置，也不能把任意 `targetRoot` 当成新的 canonical store。
2. 一个源仓库的每个 selected skill 都产生独立 entity。`lock key` 使用逻辑 skill name；实体目录使用经过冻结的 `folderName`。建议沿用 npm 的小写、空格/下划线转连字符、非法字符转连字符的 sanitize 算法，但遇到两个逻辑名映射到同一目录时必须 typed `NAME_COLLISION`，不能静默覆盖。
3. 新 API 分成两个明确阶段：`ensureEntity` 写入实体，`projectEntity` 对显式 `roots[]` 建立 link 或 materialized projection。SDK 不从当前机器的环境变量推断“所有 agent”；CLI 才使用 agent registry 的 detected + universal 默认规则。
4. projection record 至少要有 `scope`, `rootId`, `path`, `mode`, `entityRevision`, `disabled`, `ownership`。实体路径和 projection 路径都要由服务端解析，调用方不能只传一个任意绝对路径。
5. 外部 live-link 是一等发现条目，但不是 ccski-owned entity。发现时记录 `ownership: external`, `canonicalPath: realpath(target)`，允许 list/info/read；remove、GC、update 只能 unlink ccski 自己创建的 projection，不能删除外部 target。lock 不记录外部 live-link 是正确的二分。

主要风险是逻辑名、目录名和 lock key 被混成一个字符串。npm CLI 已允许带空格的 skill name（README `:104-105`），而 ccski 当前 `RestrictedSkillNameSchema` 只允许 direct-child 文件名（`src/types/schemas.ts:12-28`）。3.0 必须把“用户可见逻辑名”和“文件系统目录名”分开，否则多源同名、大小写碰撞和旧目录迁移都会变成覆盖事故。

## E2 lock 写入者与协作协议

**裁决：反对“skills CLI + ccski 双写同一个 `.skill-lock.json`”；采用分层单写者和 ccski sidecar。**

1. npm `skills@1.7.1` 的 `.skill-lock.json` 由 skills CLI 独占写入。ccski 可以读取并展示 source/provenance，但不得直接写该文件。npm CLI 当前 `writeSkillLock` 是直接 `writeFile`，没有 tmp+rename 或 lock lease；两套 writer 无法靠各自的原子 rename 解决 lost update。
2. ccski 写自己的 `scopeBase/.ccski-state.json`。`scopeBase` 是 global 的 `$HOME/.agents` 或 project 的 `<workspace>/.agents`。该 state 记录 entity ownership、projection roots、mode、disabled、entity revision、folder hash、last operation generation。它是 ccski 的 lock accounting，不冒充 npm lock。
   这在产品语义上仍然是 E3 的“projection-level sidecar”：物理上每个 scope 一个 state 文件，逻辑上按 `rootId + logicalName` 保存禁用和 ownership，避免每个 agent root 再引入一个互相竞争的写者。
3. ccski state 的写入必须是同目录临时文件 + flush/fsync + rename，并带跨进程排他/代次检查。读取到 generation 改变时，写者必须重读并拒绝覆盖；崩溃残留要能恢复或 typed `STATE_RECOVERY_REQUIRED`。
4. 如果未来要求 ccski 为 npm-managed skill 刷新 `updatedAt/skillFolderHash`，只能调用 npm CLI 或双方共用的 upstream writer library；在这个 adapter 出现以前，host 的 update apply 只能返回 `updated` + `lockSyncPending`，不能宣称 lock 已刷新。
5. `skillFolderHash` 算法应下沉为单一实现：npm 是“relative path 字典序 + path bytes + file bytes”，跳过 `.git`/`node_modules`；宿主现有实现是 `src/daemon/skills-update-service.ts:88-120`，应改为复用 ccski/shared package，不保留两份会漂移的实现。

未知字段的实证结果支持“raw pass-through”，但不支持 Zod parse 后再写回。必须把“未知字段保留”加入 lock reader/writer contract 和回归测试，而不是依赖 npm 当前实现的偶然宽容。

## E3 per-Agent 状态语义

**裁决：同意选项 (a)，但把禁用动作定义为 projection 状态变化。**

1. shared entity 永远只保留启用态 `SKILL.md`。link projection 的 disable 不得把实体重命名为 `.SKILL.md`，否则另一个 agent 的 link 会一起失效。
2. link mode 的 `disable(root, name)`：在 state 中写 `disabled=true`，校验 link ownership 后摘掉该 root 的 projection；entity 保留，其他 root 不变。`enable` 根据 entity revision 重新建 link。ccski discovery 默认隐藏 disabled projection，`--all/--disabled` 才展示它。
3. materialized mode 可以继续用 `.SKILL.md` rename 来维持旧 ccski 行为，因为 copy 已经是独立实体；state 同时记录 `mode=materialized`。这不是 npm 官方语义，必须在 API/result 中显式标注。
4. 同时存在 `SKILL.md` 和 `.SKILL.md` 的 materialized legacy 目录继续报告 conflict；link entity 不允许通过 toggle 制造第二个 identity file。toggle 对 link 不能复用当前 `src/api/toggle.ts:122-173` 的 rename-through-link 逻辑。

风险是“sidecar disabled 但 projection 仍然存在”会对不认识 sidecar 的 agent 失效。若目标是实际阻止 agent 加载，disable 必须摘链或改为该 root 的 materialized disabled copy；仅把一个布尔值写入 sidecar 不能被当成 agent runtime 的禁用证明。

## E4 remove / update 语义

**裁决：修改后同意。**

### remove

- `remove(root, name)` 首先解析并校验 projection ownership。link projection 只能 `unlink`，不能对 link 使用 recursive `rm`；materialized projection 才能删除目录。
- 删除 projection 后，只有当 ccski state 中没有 active/desired projection，且所有已注册 roots 的 lstat/realpath 复核都没有 ccski-owned reference，才删除 entity 和 npm/ccski 对应 provenance。外部 live-link 永远不计入 ccski entity 的删除权限，但存在未知 reference 时应保留 entity并返回 warning/typed status。
- `--agent` 语义按 npm 实证保留：指定 agent 只摘该 projection；不指定 agent 的 CLI 行为可以覆盖默认 detected/universal 集合，但 SDK 必须要求明确 root selection。
- `all` 必须只作用于已确认 ownership 的 projections；不能因为目录名相同就删除用户手工目录。

### update

- 更新 link entity 用 staging directory + 同 scope rename 交换。只要 projection 指向稳定的 entity path，link path 不变，更新后自然解析到新目录；但 Windows junction、打开的文件句柄和 crash window 仍需专门测试。
- 更新 materialized projection 必须逐 copy 重物化，不能假设 entity rename 会影响 copy。若某 root 已 pin 版本，默认跳过并返回 `PINNED`。
- `remove+install` 不得命名为原子 `reinstallSkills`。跨 root、跨文件系统和跨 lock/state 的操作仍然可能部分成功；真正原子需要 journal、备份、恢复和外部变更检测。
- `updatedAt`/hash 的持久化写者按 E2 执行：npm lock 由 skills CLI，ccski state 由 ccski；host 当前 `hashOverlay` 只能作为短暂 UI freshness，不是 lock 完成收据。

## E5 物化模式显式化

**裁决：修改后同意。**

建议 API 使用显式 `mode: "link" | "materialized"`，或保留 `materialize: true | { reason: "pinned" | "symlink-unavailable" | "imported-root" | "user-request" }`，但 result 必须返回规范化的 `mode` 和 `reason`。

- 默认是 link。
- symlink 创建失败时可以按 policy 自动降级为 materialized，但结果必须是 `mode="materialized", reason="symlink-unavailable"`；不能像 npm 当前实现一样返回 mode symlink 再附带 `symlinkFailed`，让调用方误认为 link 仍存在。
- imported root 和版本 pin 只有在调用方明确声明时才自动物化；不能因“这个 root 看起来不像标准 agent root”就隐式复制。
- sidecar 记录 `entityRevision`, `materializedRevision`, `installedVia`, `reason`。npm lock 不记录 projection 清单或安装模式，这正是 sidecar 必须存在的原因。
- 物化 copy 的 update/remove/toggle 均以 copy 自己的 inode/content hash 为 guard；实体更新不应越权改写它。

补充只读核验：对已有 `/tmp/skills-integration/npm-skills-runtime-20261007-c` 的 materialized copy 执行 `skills@1.7.1 list --global --json`，CLI 返回该目录和 `agents: ["Codex"]`，并保留 source/sourceType；返回体没有 `mode`、inode 或 canonical-vs-copy 字段。因此 npm list 能发现物化目录，却不能证明它是 copy，也不能表达 per-agent materialized 状态；ccski 的 mode/reason/ownership 必须由 sidecar 和 typed result 提供。

## E6 发现层升级

**裁决：同意，带安全实现门。**

发现器需要把当前 `entry.isDirectory()` 过滤改为：

```text
top-level entry
  regular directory -> scan as entity/materialized
  symlink           -> lstat, stat/realpath target, scan one level, mark projection
  broken link       -> typed omission + diagnostic

recursive child
  regular directory -> recurse
  symlink           -> do not recurse; report/skip by policy
```

必须额外满足：

- `SKILL.md`、目录和 link target 都用 lstat/realpath/fstat 身份复核；不能只用 lexical containment。`SkillMetadata` 需要携带 `canonicalPath`/`entryKind`/`ownership` 或等价 opaque identity，否则当前 toggle/info/remove 会把 projection path 当成实体 path。
- 外部 live-link 允许出现在 list/info，但 mutation 只对 ccski-owned projection 生效；broken link 不应静默变成普通 missing skill。
- `.ccski-staging-*`、`.ccski-backup-*` 是保留名。发现层必须跳过这些目录；启动清扫只能删除带 ccski ownership marker 且满足年龄/generation 条件的残留，不能用前缀对用户目录盲删。
- 宿主 `ccski-symlink-entries` 的退役顺序是：先发布 ccski link-aware discovery 和 tests，再切换 host 所有调用点，最后删除 wrapper；中间不能让两套 scanner 同时产生不同 provider/sourcePriority 结果。

## E7 版本与迁移

**裁决：同意。**

这是 ccski 的 3.0.0 破坏性边界：install 从单一物化 `targetRoot` 转为 entity + projection，发现器开始返回 symlink 一等条目，toggle/remove 的 link 行为改变，名称/ownership/mode 字段新增且需要 mutation 语义重写。2.x 不应偷偷改变这些行为。

存量物化目录的默认策略：

1. 首次发现时标记 `mode=materialized, provenance=legacy-unknown`，保留原目录，不自动转 link。
2. 提供 `migrate --dry-run`，展示 name collision、hash、目标 entity、将建立的 projections 和会影响的 agent roots。
3. 只有用户确认且 expected inode/content hash 仍匹配时，才把 copy 导入 entity、创建 link、再删除旧 copy；任何冲突都保留原 copy并给 typed result。
4. 迁移失败可从 backup/journal 恢复；不能因为“目录看起来像 npm entity”就自动接管。

skill-creator-v2 的下沉清单：

- repository install 改调 entity/projection API，并保留安装后 `installedSkillId` 的整套复核；
- 删除 `ccski-symlink-entries` wrapper；
- hash 算法复用单一实现；
- `skills-update-service` 明确 lock writer/lockSyncPending，不再只靠内存 overlay 宣称完成；
- canonical directory layer 要区分 logical name、folder name、realpath entity 和 projection path；
- host 的 Workspace Provider target/Global read-only 边界继续保留，不能把 ccski low-level API 变成 workspace-aware。

## 还没有被问、但必须先问的问题

1. **逻辑名碰撞**：大小写、Unicode normalization、空格、plugin namespace 和 npm sanitize 后碰撞时，哪个字段是 lock key，哪个字段是目录名？同名不同 source 是拒绝、显式 replace，还是允许多实体？
2. **scope precedence**：同一个 workspace 的 project entity 与 global entity 同名时，list/info/toggle/update 的代表项和写入目标如何选择？project lock 与 global lock 同时命中时是否固定 project 优先？
3. **ownership claim**：已有 symlink 指向 ccski entity，但没有 state 记录时，是 adopt、只读 foreign、还是要求 `import --claim`？GC 绝不能靠路径猜 ownership。
4. **sidecar 损坏**：state JSON 缺失、版本未知、部分写入、手工编辑或两个 ccski 进程并发时，恢复、只读降级和用户修复命令是什么？
5. **实际禁用效果**：sidecar disabled 是否必须摘 link，还是某些 agent 有自己的 disabled protocol？如果 agent 不识别 `.SKILL.md`，物化 copy 的 disable 是否只是 ccski 发现层状态？
6. **外部变更**：entity/projection 在 check 和 rename 之间被用户、另一个 CLI 或编辑器替换时，expected revision/inode/hash 的失败码和重试策略是什么？
7. **Windows 语义**：junction、Developer Mode、跨盘 `EXDEV`、权限不足和 reparse point 是否统一映射为 materialized fallback，还是 link-only 失败？
8. **锁升级**：npm lock version 4 或字段删除时，ccski 是只读降级、保留 raw、还是禁止 mutation？unknown version 不能被当成空 lock 后覆盖。
9. **hash 边界**：权限位、symlink 文件、空目录、大小写文件系统和 Unicode path 是否进入 folder hash？ccski 与 npm 必须有同一 fixture 矩阵。
10. **投影清理**：agent root 被删除或 agent 未安装时，state 中的 desired projection 是否自动清掉？清理是否需要用户确认，如何避免删除新占用同名目录？
11. **版本 pin 的来源**：pin 是 source ref、folder hash、entity revision 还是三者组合？同一 source ref 重新发布内容时，哪个字段优先保护 agent。
12. **协议漂移**：skills CLI 的默认 agent registry 会持续增加。ccski 是 vendored registry、运行时探测、还是只接受 host 显式 roots？版本升级如何测试 parity。
13. **安全暴露**：lock/source/frontmatter 中的本地绝对路径、私有仓库 URL、metadata 和环境信息是否允许出现在 list/info/MCP 返回？本机 loopback 不等于无需脱敏。
14. **验收 ownership**：需要明确谁跑跨进程 lock race、crash recovery、Windows symlink/junction、30+ roots、unknown live-link 和真实 agent load；Zod/DOM 单测不足以证明 kernel parity。

## 实现前的硬门

在开始 3.0 实现前，至少要有以下可执行收据：

1. 一份冻结的 entity/projection/state schema，含 logical name、folder name、scope、ownership、mode、disabled、revision 和 collision/error vocabulary。
2. npm lock 单写者与 ccski sidecar 单写者的并发协议；两个进程同时 add/remove/update、kill -9 后恢复、未知字段透传和 unknown version 拒写测试。
3. global/project × link/materialized × enabled/disabled × regular/broken/external symlink 的 discovery/remove/toggle 矩阵。
4. entity update 的 stable link path、materialized copy 不被误更新、部分成功和恢复收据；不再使用“remove+install 原子”表述。
5. ccski-symlink-entries 退役后的 host 全链路复跑，确认 provider、sourcePriority、canonical path 和 mutation target 没有漂移。
6. 上述四项 npm 实证固定成版本钉住的 parity tests，并在 npm CLI 升级时重新跑；本报告中的 1.7.1 结果是当前观测，不是永恒协议保证。

本轮没有运行仓库测试、构建或 UI 验收；这是有意保持的只读架构裁决边界。可交付的是源码对照、npm 隔离运行收据和 E1-E7 决策，不是 3.0 实现完成证明。
