我们需要开发一个让人类和AIAgent也可以直接使用 Claude Code Skills 的工具。

1. 在 `~/.claude/skills/*/SKILL.md` 和 `$PWD/.claude/skills/*/SKILL.md` 存在claude-code相关的技能。还有通过插件市场安装:`~/.claude/plugins/skills`。
   - 你可以通过`~/.claude/plugins`的一些JSON配置文件，分析出里面的规律。

2. 这些文件的头部通常是：

   ```md
   ---
   name: skill-name
   description: skill-info
   ---

   ...
   ```

3. 我clone了两个相似的项目： `/Users/kzf/Dev/GitHub/jixoai/ccski/references/openskills` 和 `/Users/kzf/Dev/GitHub/jixoai/ccski/references/universal-skills`
   - 请充分参考它们的设计和理念
   - 它们最大的问题是不支持“通过插件市场安装”的skills

4. 请参考这两个项目，来设计我们的ccski这个命令行工具：
   1. 默认情况下，我们是cli，可以用 `ccski <command>` 来执行任务
   2. 我们支持mcp协议，`ccski mcp`，从而让其它的 agents 也能使用我们的工具。

5. 你可以参考我用claude-code列出当前目录的技能，来验证你是否列出完全一致的内容：

用户级技能 (User/Project)

| 技能名称              | 描述                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| bun                   | Enhanced documentation skill for 'bun' with intelligent search                                                |
| cc                    | Claude Code 官方扩展开发指南，用于创建或修改 slash commands、skills、hooks、subagents、plugins 或 MCP servers |
| ccai                  | Delegate tool-intensive tasks to cost-efficient AI providers                                                  |
| glm-delegation        | 自动识别工具密集型任务并委托给 GLM-4.6 执行                                                                   |
| react-query@3         | Documentation skill for react-query                                                                           |
| tanstack-react-router | TanStack React Router - 类型安全路由器文档                                                                    |
| test-user-scope@1     | Enhanced documentation skill with Context7 integration                                                        |
| user                  | 用户的全局技能，必读！                                                                                        |
| zod@4                 | Documentation skill for zod                                                                                   |
| my-skill              | Specialized my-skill expert assistant                                                                         |

插件技能 (Plugin: example-skills)

| 技能名称                         | 描述                                |
| -------------------------------- | ----------------------------------- |
| example-skills:skill-creator     | 创建扩展 Claude 能力的技能指南      |
| example-skills:mcp-builder       | 创建 MCP 服务器指南                 |
| example-skills:canvas-design     | 创建视觉艺术和设计                  |
| example-skills:algorithmic-art   | 使用 p5.js 创建算法艺术             |
| example-skills:internal-comms    | 编写内部通讯文档                    |
| example-skills:webapp-testing    | 使用 Playwright 测试本地 Web 应用   |
| example-skills:artifacts-builder | 创建复杂的 claude.ai HTML artifacts |
| example-skills:slack-gif-creator | 创建优化的 Slack 动画 GIF           |
| example-skills:theme-factory     | 为 artifacts 应用主题样式           |
| example-skills:brand-guidelines  | 应用 Anthropic 官方品牌风格         |

插件技能 (Plugin: backend-development)

| 技能名称                                   | 描述                                                       |
| ------------------------------------------ | ---------------------------------------------------------- |
| backend-development:api-design-principles  | REST 和 GraphQL API 设计原则                               |
| backend-development:architecture-patterns  | Clean Architecture、Hexagonal Architecture、DDD 等架构模式 |
| backend-development:microservices-patterns | 微服务架构设计与通信模式                                   |

插件技能 (Plugin: llm-application-dev)

| 技能名称                                        | 描述                   |
| ----------------------------------------------- | ---------------------- |
| llm-application-dev:langchain-architecture      | LangChain 框架应用设计 |
| llm-application-dev:llm-evaluation              | LLM 应用评估策略       |
| llm-application-dev:prompt-engineering-patterns | 高级提示工程技术       |
| llm-application-dev:rag-implementation          | RAG 系统实现           |

插件技能 (Plugin: blockchain-web3)

| 技能名称                                | 描述                              |
| --------------------------------------- | --------------------------------- |
| blockchain-web3:defi-protocol-templates | DeFi 协议模板                     |
| blockchain-web3:nft-standards           | NFT 标准实现 (ERC-721, ERC-1155)  |
| blockchain-web3:solidity-security       | 智能合约安全最佳实践              |
| blockchain-web3:web3-testing            | 使用 Hardhat/Foundry 测试智能合约 |

6. 技术细节：
   - 使用tsdown来构建编译
   - 使用vitest来进行测试
   - 我们在测试mcp协议的时候，还需要一些工具，类似 `@mastra/mcp` ,或者如果有更好的选择请你自己决策
7. 阅读SPEC.md，这是我让Claude Code生成的任务计划，可以给你一个很好的参考。

---

继续，并提升代码质量，使用yargs来做cli应用；使用@leeoniya/ufuzzy来做模糊搜索

---

1. 我看你在终端做了非常复杂的表格，这可能会导致一些排版异常，请你回归简单
2. 统一支持 `--no-color`/`env.FORCE_COLOR=0` `--json` 这些高级的功能。
3. 提高测试覆盖率

---

1. 请你移除 format=table；
2. 请你优化 列表打印的效果，提供更好的样式、更好的留白排版。优化人类可读性

---

我做了一些颜色上的优化，然后引入了npm:word-wrap 但是我发现它对国际化支持不是很好，对中文、日文等双宽字符的支持有限。所以我下载了源代码和LICENSE 在 src/word-wrap。请你对源代码进行改装：

1. 改成esm+typescript，删除原本的`js+d.ts`
2. 加入双宽字符的支持，加入emoji的支持

---

1. MCP 需要支持`--transport=sse`(SSE)/`--transport=http`(Streamable HTTP)/`--transport=stdio`(默认)，这样会更灵活，我未来可以通过网络隧道，将我的技能提供给外部环境使用。
2. MCP目前就一个技能，它是直接在skill这个技能里面列出`Available skills:`，在我的认知里面，mcp在会话开始之后，就不能修改了。如果做成一个listSkills，那么AI就得多做一步，这是不是也不好？你有什么建议吗？但是我确实在官方claude-code的提示词里面，看到它也是写死的。所以它也不能更新是吗？不过它是一种xml结构。会有什么优点吗？
3. 我试了一下 mcp_skill 的调用返回，内容大概是：

```
Loading: my-skill
Base directory: /Users/kzf/Dev/GitHub/jixoai-labs/ccski/.claude/skills/my-skill

---
name: my-skill
description: Specialized my-skill expert assistant providing comprehensive technical support
---

DEMO
```

这里最开始的`Loading: my-skill`没有必要，还有`Base directory:`，我们把它加入到`name:`字段上面会不会更好？

---

因为我们用tsdown来构建我们的cli：我们这个工具主要是通过cli去提供，因此我要确保安装的时候，它的安装成本非常低，所以我要把几乎所有的依赖全部放到`devDeps`。

---

我发现你还有checkBundledResources这样一个函数，我对它的必要性表示怀疑，因为我在mcp的调用返回里面看到：

```
name: my-skill
path: /Users/kzf/Dev/GitHub/jixoai-labs/ccski/.claude/skills/my-skill
location: project
assets: true <- 这个标记
```

首先你得告诉我这件事情的意义是什么？它是ClaudeCode Skills的标准吗？

---

我觉得 universal-skills 的mcp返回内容结构是更好的，这种结构也是官方claude-code的 tools:Skill 的内置结构：

```
Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Invoke skills using this tool with the skill name only (no arguments)
- When you invoke a skill, you will see <command-message>The "{name}" skill is loading</command-message>
- The skill's prompt will expand and provide detailed instructions on how to complete the task
- Examples:
  - command: "pdf" - invoke the pdf skill
  - command: "xlsx" - invoke the xlsx skill
  - command: "ms-office-suite:pdf" - invoke using fully qualified name

Important:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
</skills_instructions>

<available_skills>
<skill>
<name>my-skill</name>
<description>Specialized my-skill expert assistant providing comprehensive technical support</description>
<location>project</location>
</skill>
<skill>
<name>bun</name>
<description>Enhanced documentation skill for 'bun' with intelligent search</description>
<location>global</location>
</skill>
<skill>
<name>claude-code-extension</name>
<description>Claude Code 官方扩展开发指南。当需要创建或修改 slash commands、skills、hooks、subagents、plugins 或 MCP servers 时使用此技能。此技能提供索引和导航，详细文档位于 references/claude-code/ 目录。</description>
<location>global</location>
</skill>
<skill>
<name>ccai-task-delegation</name>
<description>Delegate tool-intensive tasks to cost-efficient AI providers. Use when tasks involve 10+ tool calls, have clear boundaries, and simple verification. Ideal for batch operations, web scraping, code generation, and data processing. Suggest running delegated tasks in background.</description>
<location>global</location>
</skill>
<skill>
<name>glm-delegation</name>
<description>Automatically identify tool-intensive tasks with clear boundaries and delegate them to GLM-4.6 for cost-efficient execution. Triggers on batch operations (WebFetch, Read, Write, Edit, Bash, MCP, etc.), data processing, code generation, code analysis, and web scraping tasks, chrome-devtools-mcp tasks.</description>
<location>global</location>
</skill>
<skill>
<name>react-query@3</name>
<description>Documentation skill for react-query</description>
<location>global</location>
</skill>
<skill>
<name>tanstack-router</name>
<description>TanStack React Router - Fully typesafe Router for React with built-in caching, search-param APIs, and isomorphic rendering. Provides comprehensive documentation with intelligent search capabilities.</description>
<location>global</location>
</skill>
<skill>
<name>test-user-scope@1</name>
<description>Enhanced documentation skill for test-user-scope@1 with intelligent search and Context7 integration</description>
<location>global</location>
</skill>
<skill>
<name>user</name>
<description>用户的全局技能，必读！</description>
<location>global</location>
</skill>
<skill>
<name>zod@4</name>
<description>Documentation skill for zod</description>
<location>global</location>
</skill>
</available_skills>


```

还有我看到 universal-skills和openskills 都支持`install`命令。
请你参考并实现。

---

我们不需要刻意做“快捷本地复制”，如果需要，也是通过`file://`协议去支持。还有，要支持子目录，比如我给你`https://github.com/anthropics/skills/tree/main/canvas-design`，那么这个目录下如果有`SKILL.md`文件，那么就作为一个skill来安装。如果这个目录下有`.claude-plugin`目录，那么就要读取`.claude-plugin/marketplace.json`文件，它会列出相应的skills。

注意，claude code 官方已经有插件安装的能力：

```
claude plugin
Usage: claude plugin [options] [command]

Manage Claude Code plugins

Options:
  -h, --help                 Display help for command

Commands:
  validate <path>            Validate a plugin or marketplace manifest
  marketplace                Manage Claude Code marketplaces
  install|i <plugin>         Install a plugin from available marketplaces (use plugin@marketplace for
                             specific marketplace)
  uninstall|remove <plugin>  Uninstall an installed plugin
  enable <plugin>            Enable a disabled plugin
  disable <plugin>           Disable an enabled plugin
  help [command]             display help for command
```

理论上我们是不用做install的，但是我仍然要你做install，主要的差异在于，我们并不是`plugin`，而是直接将skills安装到 user 或者 project，如果要插件化的管理，那么开发者直接用`claude plugin install`去做管理就行了。

---

install的时候，支持 `--override/--force` 来进行强制覆盖。
对于git链接，使用`--depth=1`来做快速的下载安装到缓存目录，然后在走你本地安装的逻辑`ccski install file:///tmp/...`

---

进一步提升 install 命令的可靠性：

```
> bun src/cli.ts install https://github.com/anthropics/skills

Install failed: No SKILL.md found in /var/folders/tn/y_b12zxs2dldn8thmfnpy9c80000gp/T/ccski-install-qxAIax
 ELIFECYCLE  Command failed with exit code 1.
```

这异常不该发生！
我明确说明，我们应该尝试这样几种情况：

- `ccski install https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json`
  - 等价于`ccski install file:///tmp/{random}/anthropics/skills --use=.claude-plugin/marketplace.json`
  - 自动发现当前文件就是`marketplace.json`
- `ccski install https://github.com/anthropics/skills/blob/main/.claude-plugin/`
  - 等价于`ccski install file:///tmp/{random}/anthropics/skills --use=.claude-plugin/`
  - 自动发现当前文件夹存在`marketplace.json`
- `ccski install https://github.com/anthropics/skills/blob/main/`
  - 等价于`ccski install file:///tmp/{random}/anthropics/skills`
  - 自动发现当前文件夹存在`.claude-plugin/marketplace.json`
- `ccski install https://github.com/anthropics/skills/`
  - 等价于`ccski install file:///tmp/{random}/anthropics/skills --use=.claude-plugin/marketplace.json`
  - 自动发现当前文件夹存在`.claude-plugin/marketplace.json`
- `ccski install https://github.com/anthropics/skills/blob/main/algorithmic-art/SKILL.md`
  - 等价于`ccski install file:///tmp/{random}/anthropics/skills --use=algorithmic-art/SKILL.md`
  - 自动发现当前文件就是`SKILL.md`
- `ccski install https://github.com/anthropics/skills/blob/main/algorithmic-art/`
  - 等价于`ccski install file:///tmp/{random}/anthropics/skills --use=algorithmic-art/`
  - 自动发现当前文件夹存在`SKILL.md`

请你提供完全的测试，覆盖我提到的几种情况。
并且要加入“防呆”测试。

---

补充一下，默认情况下`ccski install`如果是在安装多个skills，那么需要明确指明要安装哪些技能：`ccski install <git-url> <skill-a> <skill-b>,<skill-c>/<skill-d>`支持多种name混合的写法

或者可以通过`-i, --interactive`来开启交互模式。
或者使用`-a, --all`来安装全部。

也就是说，如果使用`ccski install <git-url>`，那么一旦发现存在多个技能，那么会打印可用的技能列表（参考`ccski search`的打印效果）。
如果`ccski install <git-url> <skill-a> <skill-b>`这里等同于使用search进行搜索，如果存在不明确的skill-name，可能是用户打错了，那么需要提醒用户进行拼写纠正。确保输入正确的skill-name

这些都是一些防呆设计。

---

现在渲染出来的效果非常差劲，是一种倒退，请对齐 list/search 的效果。
请使用 Inquirer.js 来做交互。

---

我们还需要支持`ccski enable/disable <skill-name>` 的功能：

1. 原理是：`disable`: 将 `SKILL.md` 重命名成 `.SKILL.md`，反之，就是`enable`
2. 如果目录中，同时存在`SKILL.md`和`.SKILL.md`两个文件，那么无法`enable/disable`需要报告异常，不会工作，除非强制使用`--force/--override`来忽略异常，强制覆盖
3. 在`ccski list`命令行中，新增可选参数：`--all`或者`--disabled`，可以列出被禁用的skill列表，默认显示成“红色”，并且有明确的禁用标志，方便NO_COLOR也能正确辨别(mcp不需要支持这个功能)
4. `ccski enable/disable`同样支持`-i, --interactive`来开启交互模式。enable就列出所有被禁用的skills，disable就列出所有可用的skills，渲染方案也对齐 list/search 的效果。

确保测试覆盖率达标，防呆体验达标、可读性达标！
完成所有任务后，提交所有文件（包括CHAT.md）并 git push

---

还有，你自己看看这个输出：

```
pnpm ccski install https://github.com/anthropics/skills
```

这个体验很不好：

1. 首先这不属于“Install failed:”，应该属于“参数不足”，需要用户进行更多的输入，所以不该是红色。使用蓝色、黄色、绿色、紫色等颜色会更好
   - 具体什么颜色，我们整个cli需要有一套统一的颜色语义，这点你一直没有做好，我现在明确要求你定义好这些颜色语义。然后放在 README.md 的 `## 开发`这一章节
2. 然后就是 `Multiple skills found` 这一段提示，你是放在顶部了，它应该放在底部，因为技能可能非常多，超过一个屏幕，打印在底部，终端用户的体验能更友好。或者最保险的方式，就是头尾都打印。

---

我还测试了交互式安装：`pnpm ccski install https://github.com/anthropics/skills -i`，它的问题是：

1. 完全没必要在开头打印所有的技能，我们的 prompts 已经可以渲染出所有的技能了。
2. 另外，虽然我们用了第三方库来渲染我们的prompts，但是样式上也应该“尽可能”和 renderList 保持一致

---

1. `ccski enable/disable`的体验请和我们刚刚升级`install`对齐，在代码注释中要明确说明，它们的体验都应该保持一致类似。
2. `ccski enable/disable -i`的交互模式，默认不应该“选中”
3. `ccski enable/disable/install -i`的交互模式都会启动一个 prompts 交互组件，能否做到：随着选中项的变更，底部显示成一个一次性指令：比如我选中了3个技能，对应底部状态就显示出`ccski enable a-skill b-skill c-skill`，注意，这里提供颜色上的语义辅助支持。

---

编写README.md：

1. 中英双语（README-zh.md）
2. 首先介绍这个ccski这个cli工具的定位，以及如何启动mcp，提供常见cli工具的mcp配置方法（比如`codex mcp add skills -- npx ccski mcp`）
3. 然后介绍面向ccski内置的一些功能 list/enable/disable/install
4. 接着为贡献者开发者提供一些简单的入门教程、架构简介，源码阅读顺序、以及一些代码规范
