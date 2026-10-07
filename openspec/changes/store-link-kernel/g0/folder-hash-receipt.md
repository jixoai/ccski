<!--
文件意图（2026-10-07）
用户原始需求 [2026-10-07]：「folder-hash 收据：构造 fixture 技能源树（内嵌 symlink 文件、空目录、Unicode 名、大小写差异），经 add 安装到隔离 HOME 后读 lock 的 skillFolderHash 钉 digest；另写宿主导出接口定名一节（仅命名与签名建议，不实现）」
正交意图：
  [1] 冻结 folder-hash 算法语义与 F1-F7 fixture 的输入树/期望 digest（1.7.1 实跑钉死，批 1 实现的验收基准）
  [2] 冻结对宿主的唯一公开消费接口定名（仅命名与签名，实现在批 1）
妥协声明：无。fixture 源树可由本文件逐字节重建（全部内容为 ASCII/UTF-8 字面量）。
-->

# G0 收据：folder-hash fixture（skills@1.7.1 实跑钉死）

日期：2026-10-07。环境与隔离方法同 `parity-npm-skills-receipt.md`（隔离 HOME/XDG/npm-cache；`npx --yes --prefer-offline skills@latest` → 1.7.1；node v24.21.0，ICU locale **en-US**，APFS 大小写不敏感卷）。

## 1. 算法语义（源码转录 + 实跑复核）

来源：skills@1.7.1 `dist/cli.mjs:1138-1167`（`computeSkillFolderHash` + `collectFiles`）：

```js
async function computeSkillFolderHash(skillDir) {
  const files = [];
  await collectFiles(skillDir, skillDir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);   // string → UTF-8 bytes
    hash.update(file.content);        // raw file bytes
  }
  return hash.digest("hex");
}
async function collectFiles(baseDir, currentDir, results) {
  const entries = await readdir(currentDir, { withFileTypes: true });  // Dirent = lstat 语义
  await Promise.all(entries.map(async (entry) => {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") return;  // 任意深度
      await collectFiles(baseDir, fullPath, results);
    } else if (entry.isFile()) {       // symlink 既非 isFile 也非 isDirectory → 跳过、不跟随
      const content = await readFile(fullPath);
      const relativePath = relative(baseDir, fullPath).split("\\").join("/");
      results.push({ relativePath, content });
    }
  }));
}
```

冻结的语义要点：

1. **排序 = JS `localeCompare()`（默认 locale）**，不是字节序。本机 locale `en-US` 下大小写折叠为基础字母序（`apple.txt < scripts/run.sh < SKILL.md < Zebra.txt`），CJK 排在 Latin 之后（`参考/指南.md` 最后）。**byte-order 变体对全部 7 个 fixture 都产生不同 digest**（对照值见 §3）——ccski 冻结实现必须复现 localeCompare 语义，或以本收据 fixture 集钉死等价比较器。
2. 仅收集 `isFile()` 条目；**内嵌 symlink（文件或目录）跳过、不跟随、不进 hash**；空目录无贡献。
3. 目录排除集 = **仅 `.git` 与 `node_modules`**（任意深度、按目录名精确匹配）。注意与安装 copy 的排除集（`.git`/`__pycache__`/`__pypackages__`）**不是同一集合**——hash 语义独立于 copy 语义。
4. 输入 = **相对路径字符串（UTF-8，`/` 分隔，无尾部斜杠）拼接文件原始字节**；无权限位、无 mtime、无大小字段。
5. hash 输入树 = **安装时的源树**（`parsed.type === "local"` 分支 `computeSkillFolderHash(skill.path)`），不是安装后的目标目录。

## 2. Fixture 输入树与期望 digest（1.7.1 实跑钉值）

获取方法（每个 fixture 相同）：在隔离 HOME 执行

```sh
npx --yes --prefer-offline skills@latest add <fixtures>/<name> --global --yes --agent claude-code
cat $XDG_STATE_HOME/skills/.skill-lock.json   # 读 entries[<logical-name>].skillFolderHash
```

7 个 fixture 一次性顺序安装于同一隔离 HOME（`hash-install`），lock 中逐条目读取。注意：`--agent claude-code` 单目标时 1.7.1 触发 `uniqueDirs.size <= 1` 自动 copy 模式（见 parity 收据 §0），实体直接落在 `~/.claude/skills/<folderName>`——**不影响 hash**（hash 始终取自源树），fixture 消费者只需 lock 的 digest。

### F1 f1-baseline（嵌套目录 + 多文件基线）

```text
f1-baseline/
├── SKILL.md              "---\nname: f1-baseline\ndescription: F1 baseline fixture.\n---\n\n# f1-baseline\n"  (75B)
├── README.md             "root readme\n"          (12B)
├── reference/guide.md    "# Guide\nsome text\n"   (18B)
└── scripts/run.sh        "#!/bin/sh\necho f1\n"   (18B)
```

hash 输入序（localeCompare）：`README.md` → `reference/guide.md` → `scripts/run.sh` → `SKILL.md`。

**期望 digest：`be61bb178f1cf14f37da682ec236c1b44d51c3a158fb1ebe54de365543026fe7`**
byte-order 对照：`c1a55a201abc00c45e636a91d4bcc9cde0ceaaf3d4f535bf622ef8095241ea84`（不同 ⇒ 排序语义被 fixture 钉住）

### F2 f2-unicode（Unicode 目录/文件名）

```text
f2-unicode/
├── SKILL.md              (72B, frontmatter name: f2-unicode)
├── alpha.md              "more latin\n"             (11B)
├── zeta.md               "latin content\n"          (14B)
└── 中文目录/说明.md        "unicode content 文件内容\n" (29B)
```

（重建 fixture 时以本节字面量与字节数为准；29B 的说明.md 含多字节 UTF-8 内容。）

hash 输入序（localeCompare）：`alpha.md` → `SKILL.md` → `zeta.md` → `中文目录/说明.md`（CJK 最后）。

**期望 digest：`c06f541a68209aea184c2bff92aa28c09ca2cd8759b23e589894b5989077b2aa`**
byte-order 对照：`9a5727d15e277cf43b401db0fd91c06aaaab1ddd72d54a4b8b89a53704c06422`

### F3 f3-case（大小写差异；父目录不同以存活于大小写不敏感卷）

```text
f3-case/
├── SKILL.md              (frontmatter name: f3-case)
├── Mixed.TXT             "mixed\n"
├── SUB-UP/Readme.md      "upper dir file\n"
└── sub-low/readme.md     "lower dir file\n"
```

**期望 digest：`398cd30b4dc32abf2494b393307ff16794663d3078f9b8a3b0fd6e274163add4`**
byte-order 对照：`bea0db1e50cfd42c6d7a21667de67a64f1c78c193b9245cf0768be38ae5e0f40`

注：`Mixed.TXT` 与 `SUB-UP` 在 localeCompare 下的相对次序、`Readme.md` vs `readme.md` 的等价类行为都被该 fixture 的 digest 钉住。

### F4 f4-symlink（内嵌 symlink 文件 + 目录 symlink）

```text
f4-symlink/
├── SKILL.md              (frontmatter name: f4-symlink)
├── real-dir/real.txt     "real file content\n" (18B)
├── docs/doc.md           "doc\n"
├── link-to-file   -> real-dir/real.txt     (文件 symlink：不进 hash)
├── link-to-dir    -> real-dir              (目录 symlink：不进 hash、不递归)
└── docs/relative-link -> ../real-dir/real.txt
```

**期望 digest：`dbb78b44267ef3de376378ff034cf7d2f73c0f49763e39d9561023116a09e252`**（= 仅 3 个 regular file：`SKILL.md`、`docs/doc.md`、`real-dir/real.txt`）
byte-order 对照：`0008921eb7334f41dacd7e55b00d1ee5b3de08fec74f06b8ae7b94f346419c24`

副作用观察（materialized 模式注记）：1.7.1 copy 安装对该树**解引用**全部 symlink——`link-to-file` 变 18B 普通文件、`link-to-dir` 变含 `real.txt` 的真实目录。ccski 物化实现若复刻 npm copy 行为需显式决定解引用语义；link 模式实体层不做 copy，无此问题。

### F5 f5-empty-dir（空嵌套目录）

```text
f5-empty-dir/
├── SKILL.md              (frontmatter name: f5-empty-dir)
├── only.txt              "only file\n"
└── empty-nested/deeper/  (全空)
```

**期望 digest：`fe8b8c3bff3aa17cc574cadfc4f89326c64b710044c1685b02373c1ef8f0fb2e`**（空目录零贡献）
byte-order 对照：`33783cfab5a6899323b74e35dcb07a18a42dd4d1a5b8210c7f1801dd60fb83e4`

### F6 f6-excluded（.git / node_modules 目录排除）

```text
f6-excluded/
├── SKILL.md              (frontmatter name: f6-excluded)
├── kept.txt              "kept\n"
├── .git/objects/abc      "git blob\n"          (排除)
└── node_modules/pkg/index.js  "nm file\n"      (排除)
```

**期望 digest：`5ec133e107bd651ca79d3ef88bd88beb5246721db697eb35e508252f0b3e0ef0`**（= 仅 `SKILL.md` + `kept.txt`）
byte-order 对照：`29ef2d6da21369056406176312035f904358f6b3827cafcbaa76f4cbc0e1a146`

副作用观察：copy 安装产物保留 `node_modules/**`（copy 排除集不含它）、剔除 `.git`——再次印证 hash 排除集与 copy 排除集是两套规则。

### F7 f7-combined（冻结综合 fixture：全部边界合一）

```text
f7-combined/
├── SKILL.md              (82B, frontmatter name: f7-combined)
├── apple.txt             "B\n"   (2B)
├── Zebra.txt             "A\n"   (2B)
├── scripts/run.sh        "run\n" (4B)
├── scripts/target.txt    "target\n" (7B)
├── 参考/指南.md            "zh\n"  (3B)
├── link-file    -> scripts/target.txt   (排除)
├── link-dir     -> scripts              (排除)
├── empty-dir/                            (零贡献)
├── .git/config           "git\n"         (排除)
└── node_modules/x.js     "nm\n"          (排除)
```

hash 输入序（localeCompare，**这就是冻结的实现必须复现的次序**）：

```text
apple.txt → scripts/run.sh → scripts/target.txt → SKILL.md → Zebra.txt → 参考/指南.md
```

byte-order 次序（对照，**必须不等于**实现次序）：`SKILL.md → Zebra.txt → apple.txt → scripts/run.sh → scripts/target.txt → 参考/指南.md`

**期望 digest：`c047a123c322a7be0b029a0b3b85c11aed618c1c5b90c682beffdcf5be42b332`**
byte-order 对照：`007be582af1c47cc0caca14e4c99539a0df475726d8ba776fb130261ca677307`

## 3. 对账记录

探针侧参考实现（逐行转录 §1 算法，位于 `/tmp/skills-integration/g0-probes/hash-ref.mjs`，非仓库代码）对 7 个 fixture 全部复现 lock 实跑 digest；另以 P1 探针树（单 SKILL.md）交叉验证 `32edfbb4e3b3cd90ff096410af82a488ae579b206c38c969b452c9ebac2e1816` 一致。byte-order 变体 7/7 全部偏离 ⇒ 排序语义已入 fixture 钉值。

| fixture | lock 实跑 digest（期望值） | 参考实现 | byte-order 变体 |
| --- | --- | --- | --- |
| f1-baseline | `be61bb17…3026fe7` | 一致 | 不同 |
| f2-unicode | `c06f541a…077b2aa` | 一致 | 不同 |
| f3-case | `398cd30b…64163add4` | 一致 | 不同 |
| f4-symlink | `dbb78b44…16a09e252` | 一致 | 不同 |
| f5-empty-dir | `fe8b8c3b…ef8f0fb2e` | 一致 | 不同 |
| f6-excluded | `5ec133e1…f0b3e0ef0` | 一致 | 不同 |
| f7-combined | `c047a123…5be42b332` | 一致 | 不同 |

环境钉值：digest 在 node v24.21.0 / ICU en-US 下取得。localeCompare 是 locale 敏感的；批 1 实现若运行于 small-icu/full-icu 不同的 Node 构建，必须用本 fixture 表做守卫（任何环境产生不同 digest 即失败，不得静默漂移）。

## 4. 宿主导出接口定名（仅命名与签名，实现在批 1）

建议（与 1.7.1 源函数同名，降低 parity 认知成本；命名与签名冻结于本节，实现落 `src/core/folder-hash`，见 tasks.md 批 1）：

```ts
/**
 * skills@1.7.1 兼容的技能目录 hash：localeCompare 排序的
 * 相对路径(UTF-8) + 文件字节流式 sha256；仅 regular files；
 * 任意深度跳过 .git 与 node_modules；symlink 不进 hash。
 * 期望值由 g0/folder-hash-receipt.md F1-F7 fixture 钉死。
 */
export function computeSkillFolderHash(skillDir: string): Promise<string>;
```

- 命名：`computeSkillFolderHash`（与 npm 源函数、宿主 `skills-update-service` 现有概念 `skillFolderHash` 同词根）。
- 签名：入参单一 `skillDir: string`（绝对路径）；返回 hex digest（无 `sha256:` 前缀，与 lock `skillFolderHash` 字段取值形态一致）。
- 单一消费出口：ccski 3.0 以此为唯一公开导出（design「对宿主导出唯一公开消费接口」，终审 P1-6）；宿主 `src/daemon/skills-update-service.ts` 的本地实现退役进批 6 host change。
- 可选伴随导出（不强制）：`SKILL_FOLDER_HASH_VERSION = "1.7.1"` 常量，供宿主在 provenance 中标注算法代。
