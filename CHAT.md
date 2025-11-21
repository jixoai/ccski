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
