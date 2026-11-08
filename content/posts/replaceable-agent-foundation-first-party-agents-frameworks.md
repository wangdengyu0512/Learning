---
title: "Agent 底座为什么必须可替换：从 Claude Code 安全事件到两种 Agent 开发路线"
description: "从 Claude Code 项目配置漏洞与 Nx 供应链事件出发，分析企业为何开始重视 Agent Runtime 的可替换性，对比成熟通用 Agent 与 Agent Framework 两条路线，并讨论第一方 Agent、平台抽象和未来 Agent 生态。"
date: 2026-11-08
tags: AI Agent, Agent Platform, Agent Security
featured: false
---

2025 年以来，Claude Code、Codex、Goose、OpenCode 等通用 Agent 快速进入开发者工作流。它们不再只是回答问题，而是能够读取代码、执行终端命令、修改文件、调用外部工具，并在较长时间内持续推进任务。

能力边界扩大的同时，安全边界也发生了变化。

过去，企业讨论大模型供应商锁定，焦点通常是 API 是否兼容、模型价格是否可接受、Prompt 能否迁移。进入 Agent 阶段之后，真正需要迁移的已经不只是一次模型调用，而是完整的执行环境：任务状态、上下文、工具、权限、凭证、沙箱、审批、审计与评测数据。

因此，一个正在变得重要的问题是：**如果今天使用的 Agent Runtime 明天不再适用，企业是否有能力替换它？**

本文从 Claude Code 的两项安全漏洞和 Nx 的 s1ngularity 供应链事件出发，讨论 Agent 为什么正在成为企业新的高权限执行平面；进一步比较当前 Agent 开发的两条主要路线：直接采用成熟通用 Agent，以及使用 Agent Framework 自行构建；最后结合 Claude Code、Codex、Goose、OpenCode，分析第一方 Agent 的价值、平台应该抽象什么，以及未来 Agent 生态可能如何演进。

本文涉及的漏洞均已由厂商修复。安全事件用于分析系统边界，不构成对任何单一产品当前安全状态的判断。除明确引用的披露事实外，文中的架构与趋势属于工程判断。

## 一、Claude Code 安全事件揭示了什么

### 配置文件已经不再只是配置

2026 年 2 月，Check Point Research 公开了 Claude Code 项目配置相关的研究，涉及两个已修复漏洞。

- `CVE-2025-59536`：Claude Code `< 1.0.111` 的项目启动信任机制存在缺陷。用户在不可信目录中启动 Claude Code 时，项目包含的命令可能在用户确认信任之前执行。
- `CVE-2026-21852`：Claude Code `< 2.0.65` 的项目加载流程可能在信任确认前读取项目配置并发起请求。恶意仓库可以将 `ANTHROPIC_BASE_URL` 指向攻击者控制的端点，进而造成包括 Anthropic API Key 在内的数据泄露风险。

研究还讨论了项目级 Hooks、MCP Server 和环境变量等配置机制。这些能力原本都是为了改善协作体验：团队可以把格式化、权限检查、工具接入和环境约定随仓库分发。但当配置能够启动进程、访问网络或影响凭证流向时，它就已经具有代码执行能力。

这不是 Claude Code 独有的问题。现代 IDE、构建工具、CI 工作流、Dev Container 和包管理器都经历过类似的边界变化：为了自动化，配置逐渐变成可执行逻辑；为了共享，执行逻辑又被放入仓库。Agent 只是在此基础上进一步连接了模型决策、工具调用和自然语言指令。

Anthropic 后续的修复包括在执行不可信项目配置前增强警告与确认，阻止 MCP Server 在用户批准前启动，并将网络请求延迟到信任确认之后。其当前安全文档也将权限模式、沙箱、工作目录边界和组织级配置列为核心防护能力。

真正值得企业关注的，不是“某个 Agent 是否出现过漏洞”，而是下面这个结构性事实：

> Agent Runtime 同时位于自然语言输入、项目文件、终端、网络、凭证和企业系统的交汇处。它既是智能层，也是高权限执行层。

### Agent 既可能是攻击面，也可能成为攻击工具

2025 年 8 月的 Nx s1ngularity 供应链事件进一步说明了这一点。根据 Nx 官方复盘，攻击者利用 GitHub Actions 注入问题获取 npm 发布 Token，并在约四小时内发布多个恶意版本。恶意包的安装脚本会扫描本地敏感数据，尝试调用本机的 Claude、Gemini 等 AI 工具，再通过 GitHub CLI 上传结果。

这次事件的入口不是 Agent 自身漏洞，而是传统的软件供应链攻击。但攻击代码主动寻找本地 AI CLI，是因为这些工具可能已经具备三类有价值的能力：

1. 它们能够理解文件和目录中的语义，而不只是按固定路径搜索。
2. 它们通常已经获得工作区、终端、网络或开发者凭证的某种访问能力。
3. 它们可以把多步搜索、筛选和外传过程组织成自动化任务。

从攻击者视角看，一个配置良好但权限过大的 Agent，就是已经安装在目标机器上的通用自动化组件。从防守者视角看，Agent 的权限不能只依赖“模型通常不会这样做”，而必须由操作系统隔离、最小权限、网络策略、短期凭证和可审计审批共同约束。

### 安全事件只是导火索

企业开始讨论 Agent 底座可替换性，安全通常是最直接的触发因素，但不是唯一原因。实际生产中，替换需求还可能来自：

- 厂商调整产品路线、许可、价格或版本生命周期。
- 某个 Agent 对代码任务表现很好，但不适合采购、运维或数据分析任务。
- 数据驻留、网络隔离或行业合规要求发生变化。
- 某个模型或 Runtime 在高峰期不可用，需要降级到另一套执行引擎。
- 企业需要审计 Agent Loop，而现有黑盒实现无法提供足够证据。
- 新一代 Agent 在质量、延迟或成本上出现明显优势。

安全事件让企业第一次直观地看到 Agent 的权限位置，业务连续性则把“能否替换”从架构偏好变成生产要求。

## 二、“Agent 底座可替换”到底指什么

最容易产生的误解，是把可替换性理解成把配置里的 `model=claude` 改成 `model=gpt`。这只是模型路由，不是 Agent Runtime 替换。

一个生产级 Agent 至少包含六层：

| 层次 | 主要职责 | 替换时可能变化的内容 |
| --- | --- | --- |
| Model | 理解、推理与生成 | API、上下文窗口、工具调用格式、价格和延迟 |
| Agent Loop | 规划、行动、观察、重试与终止 | 决策策略、工具选择、错误恢复、并行方式 |
| Context | 对话、检索、压缩与长期记忆 | 消息格式、摘要策略、缓存和 Session 语义 |
| Tools | 文件、终端、MCP 与业务 API | 工具 Schema、权限语义、调用结果和副作用 |
| Execution | 进程、沙箱、网络与凭证 | 隔离级别、审批点、Workspace 和身份传递 |
| Governance | 审计、成本、评测与策略 | 事件格式、轨迹完整度、质量指标和留存规则 |

模型只是最底层的一个依赖。即使两个 Agent 使用同一个模型，它们也可能因为上下文压缩、系统提示、工具描述、循环策略和错误恢复方式不同，得到完全不同的任务结果。

因此，可替换不等于行为完全一致，也不等于旧会话可以被另一个 Runtime 原生续跑。更现实的定义是：

> 当企业替换 Agent Runtime 时，任务、工具、权限、数据、长期状态、审计与评测资产仍由企业掌握；迁移成本可以估算，差异可以观测，关键业务可以连续运行。

这个定义有三个关键词。

第一是**资产不丢失**。用户文件、业务数据、工具目录、身份关系、评测集和历史结果不应只存在于某个 Agent 的私有目录或托管服务中。

第二是**差异可见**。Claude Code、Codex、Goose 和 OpenCode 不会采用完全相同的规划方式。平台不应假装差异不存在，而应通过统一任务和评测记录知道差异发生在哪里。

第三是**迁移可控**。平台可以接受适配器、会话转换和少量特例，但不能每次更换 Runtime 都重建整套身份、工具、审计和运行基础设施。

## 三、为什么企业现在才开始重视

### Agent 已经从辅助工具进入业务流程

在代码补全阶段，工具失效通常意味着开发效率下降。进入 Agent 阶段后，一个任务可能持续几十分钟甚至数小时，期间修改仓库、创建工单、查询数据库、调用云资源或等待人工审批。Runtime 故障不再只影响一次回答，而可能留下部分完成的副作用。

当 Agent 开始进入发布、运维、客服、采购和财务流程，企业必须回答传统生产系统同样的问题：任务状态在哪里、谁有权执行、失败后如何恢复、重复执行是否安全、变更如何审计、供应商中断时如何切换。

### Harness 对结果的影响正在被重新认识

Agent 的能力常被归因于模型，但实际效果由模型与 Harness 共同决定。Harness 包括上下文管理、工具循环、提示组织、错误恢复、压缩、审批和执行环境。

OpenAI 在 2026 年发布的 Codex 平台文章中，将 Harness 明确定义为模型之外的执行系统，并披露在 ARC-AGI-3 实验中，仅通过保留推理和上下文压缩等 Harness 设置，就使特定配置下的分数从 13.3% 提升至 38.3%，同时降低输出 Token。这个例子不代表所有任务都会获得同样收益，但说明 Agent 的竞争已经不只是模型竞争。

企业过去认为“模型 API 可替换就够了”，现在逐渐意识到，真正形成生产差异的往往是模型上方的 Runtime。

### 开源 Agent 已经具备可用性

早期自研 Agent 往往是几十行循环：调用模型，解析工具，再把结果传回模型。这种实现适合验证概念，却很难处理长上下文、并行工具、进程恢复、流式事件和复杂权限。

今天的 Goose、OpenCode 以及开源 Codex Harness 已经提供了更完整的运行时能力。企业不再只能在“采购一个封闭产品”和“从零写循环”之间选择，而是可以在多个成熟 Runtime 之间进行评测、组合和替换。

### 开放协议开始形成集成基础

MCP 将工具和数据源暴露给 Agent；A2A 面向 Agent 之间的任务协作；ACP 面向编辑器、客户端与编码 Agent 的通信；`AGENTS.md` 尝试把仓库级指令沉淀为跨工具可读取的文件。

这些协议还没有消除所有语义差异，但它们正在形成生态的“窄腰”：上层应用不必理解每个工具的内部实现，下层 Agent 也不必为每个客户端重复开发全部接口。

协议越成熟，企业构建多 Runtime 平台的成本就越低；多 Runtime 需求越强，协议也越有动力完善。

## 四、路线一：直接采用成熟通用 Agent

第一条路线，是把一个已经能够完成开放任务的通用 Agent 作为执行引擎。

成熟通用 Agent 通常已经处理了大量容易被低估的工程问题：如何搜索大型仓库，如何控制上下文长度，如何在工具失败后恢复，如何展示中间进度，何时请求审批，如何在长任务中保持目标，以及如何让终端、IDE 或桌面端体验可用。

它们的优势是任务完成率和接入速度。企业不需要先设计一套完整工作流，就可以把自然语言目标交给 Agent，让它在约束范围内探索完成路径。

代价则是，部分行为来自 Runtime 内部约定。版本升级可能改变工具策略、上下文压缩或权限体验；某些状态和事件只存在于私有格式中；第一方 Agent 还可能与特定模型的能力演进紧密绑定。

### Claude Code：第一方模型与 Agent 体验联合优化

Claude Code 是第一方 Agent 路线的典型代表。它将 Claude 模型与代码搜索、终端执行、文件修改、Hooks、MCP、权限模式和 IDE 体验组合成完整产品。

它的价值并不只是“能够调用 Claude”。Anthropic 可以围绕模型行为同时调整系统提示、工具反馈、上下文管理和交互方式。当模型推出新能力时，第一方 Agent 通常可以较快利用这些能力，而不需要等待第三方 Framework 适配。

但这种联合优化也意味着生命周期由同一厂商主导。企业可以配置权限和沙箱，却不天然拥有 Runtime 的全部演进节奏。Claude Code 安全事件进一步说明，项目配置、信任确认和工具执行之间的顺序属于 Runtime 核心语义，不能只靠外围 API 网关治理。

因此，使用 Claude Code 的合理策略不是拒绝第一方能力，而是把它放入企业自己的身份、工作区、网络和审计边界中，并为任务迁移保留出口。

### Codex：从编码工具走向可嵌入 Harness

Codex 的变化更能说明通用 Agent 与平台路线正在汇合。

根据 OpenAI 官方文档，开源 Codex Harness 负责上下文、工具、流式执行、沙箱和审批。企业可以按不同深度使用它：

- `codex exec` 适合 CI、脚本和有界的后台任务。
- Codex SDK 适合应用代码启动、恢复和流式读取任务。
- app-server 通过协议暴露 Thread、Turn、事件和审批请求，适合深度集成到现有产品。

这组接口改变了“采用通用 Agent”的含义。企业不必要求用户全部迁移到一个聊天界面，而可以保留现有工单、运维控制台或研发门户，把 Codex 作为内部执行引擎。

同时，OpenAI 也明确区分了开源 Harness 与模型、托管服务。开源可以提高可检查性和集成自由度，但不自动消除模型依赖、服务依赖与版本治理问题。可替换性仍需要企业平台在更高层建立。

### Goose：开放 Runtime 与多模型 Provider

Goose 是由 Block 发起、现由 Agentic AI Foundation 承载的开源通用 Agent。官方将其定位为运行在本地的通用 Agent，不只面向编码，也覆盖研究、写作、自动化和数据分析。

Goose 的特点是开放：它支持多种模型 Provider，以 MCP Extension 扩展工具，并提供 Recipes、子 Agent 与 Goose Development Kit。其官方文档还描述了 ACP 能力，可以作为 ACP Server 接入编辑器，也可以使用 Claude Code、Codex 等 ACP Agent 作为 Provider。

对企业而言，Goose 的意义不仅是“另一个 Coding Agent”，而是一个可检查、可扩展的通用 Runtime 样本。企业可以更直接地控制模型、工具和部署位置，也更容易研究 Agent 的状态与集成方式。

开放不等于零成本。企业仍需验证 Provider 差异、会话存储、并发模型、升级兼容性和多租户隔离。开源解决了可见性问题，但不会替企业完成生产化。

### OpenCode：Provider-agnostic 的开放编码 Agent

OpenCode 同样是开源编码 Agent，提供终端、桌面和 Web 形态，并支持多家 LLM Provider、MCP Server、插件、自定义 Agent 和命令。

它代表另一种重要选择：Runtime 本身不以单一模型供应商为中心，企业可以在相似交互和工具环境中切换模型。对于需要自托管模型、区域化 Provider 或成本路由的团队，这种结构具有吸引力。

但 Provider-agnostic 不意味着模型之间能力等价。不同模型对工具 Schema、长上下文、指令遵循和错误反馈的敏感度不同。一个 Runtime 同时支持多模型，只能证明接口可连接，不能证明任务质量可无损切换。

### 四种通用 Agent 的比较

| Agent | 主要定位 | 模型关系 | 平台化接口 | 企业需要重点补齐 |
| --- | --- | --- | --- | --- |
| Claude Code | 第一方编码 Agent | 与 Claude 深度协同 | Hooks、MCP、CLI、IDE 集成 | 外部审计、统一身份、运行隔离、迁移策略 |
| Codex | 第一方编码 Agent 与开放 Harness | 与 OpenAI 模型协同 | `exec`、SDK、app-server、MCP | 企业策略层、跨 Runtime 状态、统一评测 |
| Goose | 开源通用 Agent 与 GDK | 多 Provider | MCP、ACP、Recipes、GDK | 生产存储、多租户、升级与运维治理 |
| OpenCode | 开源编码 Agent | 多 Provider | CLI、Desktop、Web、MCP、插件 | Provider 质量验证、企业权限与集中审计 |

这张表比较的是官方产品结构，不是任务质量排名。不同 Agent 的效果必须在企业自己的仓库、工具和安全约束下评测。

## 五、路线二：使用 Agent Framework 自行构建

第二条路线，是使用 LangGraph、CrewAI、Google ADK、OpenAI Agents SDK、Microsoft Agent Framework 等开发框架，自行定义 Agent、状态和工作流。

Framework 的核心价值不是提供一个已经完成所有开放任务的 Agent，而是让开发者显式描述业务过程：有哪些节点，状态如何流转，什么时候调用模型，什么时候执行工具，哪里等待审批，失败后从哪里恢复。

这条路线更适合边界清晰、流程稳定、责任可定义的业务。例如贷款材料审核、售后工单分派、采购审批和合规报告生成。企业通常希望知道任务当前位于哪个节点，而不是只看到 Agent 正在“继续思考”。

### Framework 提供了更强的控制权

以 LangGraph 为例，它强调持久化执行、状态、流式处理和 Human-in-the-loop；Google ADK 强调模型与部署无关的 Agent 开发；Microsoft Agent Framework 将 Agent 与 Workflow 组织在同一框架中。它们虽然抽象方式不同，但共同目标是把编排权交给应用开发者。

使用 Framework，企业可以明确控制：

- 业务状态模型与检查点。
- 模型和工具调用的顺序。
- 人工审批与职责分离。
- 超时、重试、补偿与幂等。
- 任务数据如何写入系统事实源。
- 每个步骤需要保留哪些审计证据。

对于受监管流程，这种显式性通常比开放式自主规划更重要。

### 控制权的另一面是 Harness 工程

Framework 提供积木，不代表自动得到一个成熟 Agent。团队仍需自行解决：

- 大型上下文如何筛选和压缩。
- 工具返回过长或格式异常时如何处理。
- 模型调用失败后应该重试、换模型还是回退。
- 长任务如何暂停、恢复和取消。
- 子任务如何并行，结果冲突如何合并。
- Prompt、工具和模型版本如何联合评测。
- 前端如何展示流式事件、审批和中间产物。

这些工作构成了 Harness。它们不会因为用了 Framework 就消失，只是从通用 Agent 厂商转移到企业开发团队。

Framework 自身也可能形成锁定。Graph State、Checkpoint、Event、Tool 和 Agent Definition 往往使用框架专有结构。若业务代码直接依赖这些结构，未来从一个 Framework 迁移到另一个 Framework，同样会付出较高成本。

### 两条路线并不是二选一

通用 Agent 擅长在开放环境中寻找完成路径，Framework 擅长让业务流程可预测、可恢复、可治理。企业真正需要的通常是组合：

> 企业平台或 Framework 掌握流程、状态与治理，成熟通用 Agent 作为可替换的任务执行引擎。

例如，一个生产故障处置流程可以由 Framework 固定五个阶段：收集信息、形成假设、执行只读诊断、请求变更批准、执行并验证。在“形成假设”和“生成诊断计划”阶段，平台可以调用 Claude Code、Codex 或 Goose；在执行变更阶段，则由企业工具代理根据审批票据执行，而不是让 Agent 直接持有生产凭证。

这样既保留了通用 Agent 的探索能力，也保留了企业对关键状态和副作用的控制权。

## 六、第一方 Agent 为什么仍然重要

强调可替换性，很容易走向另一个极端：为了避免供应商依赖，只使用最通用的抽象，只暴露所有 Agent 都支持的最小能力。

这种设计看似中立，实际可能损失最多。

### 模型与 Harness 存在联合优化空间

第一方团队最了解模型的工具调用习惯、上下文特征、推理预算和失败模式。它们可以共同调整模型、系统提示、工具反馈和压缩策略。模型新增能力时，第一方 Agent 也更容易最先使用。

Claude Code 与 Claude、Codex 与 OpenAI 模型体现的都是这种联合优化。第三方 Runtime 可以连接相同模型，但未必立即获得相同效果，因为差异可能位于不可见的提示、状态管理和工具循环中。

### 可替换不等于抹平特色

企业平台应该允许不同 Agent 保留自己的规划、提示与上下文策略。平台要统一的是治理边界和业务契约，而不是每一步内部动作。

一个合理类比是数据库平台。企业会统一身份、备份、监控、网络和数据分级，但不会要求 PostgreSQL、ClickHouse 和 Redis 使用相同的查询引擎。选择权来自边界清晰，而不是内部实现一致。

Agent 平台也是如此。Claude Code 可以保留自己的 Hooks 和权限体验，Codex 可以保留 Thread/Turn 与审批事件，Goose 可以保留 Recipes 和 Extension，OpenCode 可以保留 Provider 与插件机制。平台通过适配层接收任务、施加外部约束并收集结果，不需要重写它们的全部内部语义。

### 第一方 Agent 应该是能力插件，而不是事实源

第一方 Agent 可以拥有完成任务所需的临时上下文，却不应独占企业的长期事实。

任务定义、用户身份、工具授权、业务状态、长期记忆、审计轨迹和评测结果应保存在企业控制的系统中。Agent 可以读取这些资产并产生候选更新，但最终写入应通过受控接口完成。

这样，企业既可以使用第一方 Agent 的能力，又不会把业务连续性绑定到它的私有 Session 或托管界面。

## 七、企业 Agent 平台应该抽象什么

平台抽象的目标不是制造一个“所有 Agent 看起来完全一样”的外壳，而是把必须由企业控制的部分从 Runtime 中剥离出来。

### 推荐的五层结构

```text
┌──────────────────────────────────────────────────────┐
│ 企业控制面：身份、策略、审计、路由、成本、评测      │
├──────────────────────────────────────────────────────┤
│ 协议与适配层：任务 Schema、事件、MCP、ACP、A2A      │
├──────────────────────────────────────────────────────┤
│ Agent 执行层：Claude Code / Codex / Goose / OpenCode │
├──────────────────────────────────────────────────────┤
│ 模型层：Claude / GPT / Gemini / 企业自托管模型       │
├──────────────────────────────────────────────────────┤
│ 隔离执行层：Container / VM / Workspace / 网络沙箱    │
└──────────────────────────────────────────────────────┘
```

控制面拥有企业策略，执行层拥有 Agent 能力，隔离层提供不可绕过的安全边界。模型和 Agent 都可以路由，但它们不能直接决定自己拥有多大权限。

### 应该统一的部分

**身份与凭证。** Agent 不应长期保存个人 Token。平台根据用户、任务、工具和环境签发短期凭证，并记录凭证代表的身份。

**工具目录。** MCP 可以作为工具接入协议，但企业还需要维护工具所有者、风险等级、输入约束、副作用、审批规则和版本。

**权限与审批。** Runtime 内部的确认框适合交互式使用，企业级审批还要关联工单、角色、职责分离和过期时间。高风险动作必须由外部策略执行点拦截。

**任务与结果契约。** 平台至少要统一 Task ID、目标、输入资产、截止时间、取消信号、状态、结果和错误分类。这样同一业务任务才能被不同 Runtime 接管或重新执行。

**执行隔离。** 文件、进程、网络和云身份应由容器、虚拟机或等价沙箱限制。Prompt 中写着“不要访问生产环境”不是安全控制。

**Telemetry 与审计。** 平台记录模型调用、工具调用、审批、文件变更、成本和最终结果。轨迹格式可以经过归一化，但必须保留原始事件引用，避免归一化时丢失关键证据。

**评测与路由。** 平台用企业自己的任务集评估成功率、人工接管率、工具错误、延迟和成本，再决定默认 Runtime、降级顺序和任务路由。

### 不应该强行统一的部分

平台不应试图统一每个 Agent 的私有规划步骤、模型特定 Prompt、上下文压缩算法和所有工具调用细节。

如果平台把每个 Runtime 都限制成同一组最小能力，就会出现三个问题：

1. 第一方 Agent 无法利用模型新增能力。
2. 平台需要持续追赶每个 Runtime 的内部变化。
3. 所有 Agent 都被压缩成“最低公分母”，却仍然没有真正实现行为等价。

更好的方式是定义稳定的外部合同，同时允许能力协商。Agent 在启动时声明是否支持会话恢复、并行工具、结构化结果、审批回调、子 Agent 和特定隔离模式；平台根据任务要求选择合适的 Runtime。

### “薄平台、强控制面”

平台应该在治理上强，在 Agent 内部行为上薄。

强控制面意味着身份、权限、状态、审计和评测不能绕过；薄适配层意味着不复制每个 Agent 已经做好的上下文工程与工具循环。平台通过少量稳定协议管理多个 Runtime，而不是再造一个巨大的统一 Agent。

## 八、怎样验证底座真的可替换

架构图上的多个方框并不能证明系统可替换。企业需要通过演练得到证据。

### 建立统一但不简单化的评测集

评测任务应来自真实业务，至少覆盖：

- 只读信息收集。
- 多文件修改与测试。
- 工具失败和网络超时。
- 长上下文与会话压缩。
- 人工审批后恢复。
- 含恶意指令的仓库和工具输出。
- 有副作用的业务动作。
- Runtime 中断后的重试与接管。

不仅记录最终答案，还要记录完成率、回退次数、越权尝试、人工干预、Token、延迟和副作用正确性。

### 把切换分成四个级别

| 级别 | 能力 | 典型目标 |
| --- | --- | --- |
| L1 模型切换 | 同一 Runtime 更换模型 | 价格、质量或可用性路由 |
| L2 新任务切换 | 新任务选择不同 Agent | 多 Runtime 并存 |
| L3 上下文迁移 | 将任务摘要与资产交给另一 Agent | 原 Runtime 故障后继续工作 |
| L4 关键流程接管 | 另一 Runtime 从企业检查点恢复业务流程 | 生产连续性与灾备 |

大多数平台可以较快实现 L1 和 L2。L3 需要平台拥有可移植的任务摘要、文件和工具结果。L4 则要求业务状态不依赖 Agent 私有 Session，并且所有副作用都有幂等键、状态确认和补偿机制。

“旧聊天记录可以显示”不等于“另一个 Agent 可以原生续跑旧 Session”。对外产品文案必须准确表达这个边界。

### 定期进行替换演练

至少选择一类低风险任务，定期执行以下演练：停止默认 Runtime 的新任务接入；将流量路由到备用 Runtime；比较质量与成本变化；验证审计、审批和结果仍然完整；记录需要人工转换的状态。

只有实际切换过，企业才能知道可替换性是能力还是愿望。

## 九、未来 Agent 生态可能如何演进

### Harness 会成为独立的软件层

模型负责推理，Framework 负责流程，Harness 负责让模型在真实环境中持续工作。随着 Codex app-server、Goose GDK 等产品形态出现，Harness 正在从 CLI 内部实现变成可以被应用嵌入的独立层。

未来企业采购或评估的不只是模型，也会单独评估 Harness：它如何压缩上下文，如何恢复任务，如何隔离工具，事件是否完整，升级是否兼容。

### 通用 Agent 与 Framework 会逐渐汇合

通用 Agent 正在开放 SDK、Server 和协议接口；Framework 则不断加入持久化、内置工具、规划与多 Agent 能力。两条路线会在能力上靠近，但仍保留不同重心：

- 通用 Agent 优先优化开放任务的端到端完成率。
- Framework 优先优化业务流程的显式控制和可恢复性。

企业平台会同时使用两者，而不是等待其中一条路线完全取代另一条。

### 协议将形成生态窄腰，但不会统一智能

MCP、A2A、ACP 和 `AGENTS.md` 会降低工具、Agent、客户端和仓库指令的集成成本。协议最适合统一边界，不适合规定所有内部决策。

未来可能形成这样的分工：MCP 描述可调用能力，A2A 传递跨 Agent 任务，ACP 连接客户端与编码 Agent，`AGENTS.md` 保存仓库约定；企业自己的 Task 与 Event Schema 则负责治理和业务状态。

标准协议会让替换更容易，但无法保证两个 Agent 对同一任务做出相同行为。智能差异仍需通过评测管理。

### 企业会管理 Agent Portfolio

不会有一个 Agent 在所有任务上长期占优。代码修改、深度研究、桌面操作、数据分析、客服回复和生产运维，对上下文、工具、风险与延迟的要求不同。

企业最终更可能像管理云资源或数据库一样管理 Agent Portfolio：

- 高质量第一方 Agent 处理复杂开放任务。
- 开源 Agent 处理需要本地部署和深度定制的任务。
- Framework Agent 处理高确定性业务流程。
- 小模型或专用 Agent 处理高频、低风险、结构化任务。
- 平台根据策略、评测、成本和可用性动态路由。

竞争的焦点将从“企业最终统一使用哪个 Agent”，转向“谁能够在可治理的平台中，为某类任务提供最好的结果”。

### 安全边界会下沉到执行基础设施

随着 Agent 自主性提高，仅依赖交互确认会越来越困难。更可靠的安全模型会将限制下沉到执行环境：文件系统挂载决定可读写范围，网络策略决定可访问端点，工作负载身份决定可调用服务，策略引擎决定哪些工具需要审批。

Agent 可以提出动作，但不能自行扩大权限。即使模型被 Prompt Injection 影响、Runtime 出现漏洞或依赖被投毒，基础设施仍应限制影响范围。

## 十、结语：让依赖可替换，而不是让能力同质化

Claude Code 的项目配置漏洞已经修复，Nx 也完成了供应链事件后的发布体系加固。它们留下的长期启示不是“不要使用 Agent”，而是 Agent 已经成为需要按生产基础设施治理的高权限执行平面。

成熟通用 Agent 提供更高的开箱任务完成能力，Agent Framework 提供更强的流程控制权。第一方 Agent 通过模型与 Harness 联合优化继续具有重要价值，开源 Agent 则提供可检查性、多 Provider 与部署选择。企业没有必要只选一条路线。

真正稳健的策略，是让企业平台掌握身份、工具、权限、业务状态、审计和评测，让 Claude Code、Codex、Goose、OpenCode 或未来的新 Runtime 以执行引擎的身份参与。在这个结构中，替换不是一行配置，也不是完全无损，而是业务资产不丢失、差异可观测、迁移成本可控制。

模型时代关注的是 API 是否兼容。Agent 时代更应该关注：**执行权是否可控，业务资产是否可迁移。**

## 参考资料

- Check Point Research：[Caught in the Hook: RCE and API Token Exfiltration Through Claude Code Project Files](https://research.checkpoint.com/2026/rce-and-api-token-exfiltration-through-claude-code-project-files-cve-2025-59536/)
- Anthropic GitHub Security Advisory：[CVE-2025-59536](https://github.com/anthropics/claude-code/security/advisories/GHSA-4fgq-fpq9-mr3g)
- NIST NVD：[CVE-2026-21852](https://nvd.nist.gov/vuln/detail/CVE-2026-21852)
- Anthropic：[Claude Code Security](https://code.claude.com/docs/en/security)
- Nx Blog：[S1ngularity - What Happened, How We Responded, What We Learned](https://nx.dev/blog/s1ngularity-postmortem)
- OpenAI Developers：[Codex as a platform: build on the open agent harness](https://developers.openai.com/blog/codex-as-a-platform)
- OpenAI Developers：[Codex app-server](https://developers.openai.com/codex/app-server)
- OpenAI Developers：[Codex SDK](https://developers.openai.com/codex/codex-sdk)
- Goose Docs：[Your open source AI agent](https://goose-docs.ai/)
- OpenCode Docs：[Intro](https://opencode.ai/docs/)
- LangChain Docs：[LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- CrewAI Docs：[Introduction](https://docs.crewai.com/en/introduction)
- Google：[Agent Development Kit](https://google.github.io/adk-docs/)
- Microsoft Learn：[Microsoft Agent Framework overview](https://learn.microsoft.com/en-us/agent-framework/overview/agent-framework-overview)
- Model Context Protocol：[MCP Documentation](https://modelcontextprotocol.io/docs/getting-started/intro)
- Agent2Agent Protocol：[A2A Protocol](https://a2a-protocol.org/latest/)
- Agent Client Protocol：[ACP](https://agentclientprotocol.com/)
- AGENTS.md：[An open format for guiding coding agents](https://agents.md/)
