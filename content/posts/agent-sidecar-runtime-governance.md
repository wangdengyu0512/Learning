---
title: "Agent Sidecar：把智能体的执行治理移到进程之外"
description: "从工具调用、工作负载身份和策略执行出发，系统拆解 Agent Sidecar 的职责边界、安全模型、故障语义与 Kubernetes 落地方法。"
date: 2026-10-28
tags: AI Agent, Sidecar, Kubernetes, 安全治理
featured: false
---

> Agent Sidecar 的价值不是让 Agent 更聪明，而是把每一次外部行动变成可认证、可授权、可观测、可限制的系统调用。

假设公司正在开发一个采购 Agent。用户输入“从已准入供应商中选择一台适合设计团队的工作站，总价不超过 3 万元”，Agent 随后需要查询供应商、读取报价、核对预算、发起审批并创建采购单。

原型阶段，这些工作可以全部写在 Agent 应用里：SDK 读取一个服务账号密钥，直接调用供应商 API；遇到超时就重试；金额较高时通过一段 `if` 判断要求审批；最后把调用参数和返回值打印到日志。功能很快跑通，也能演示模型的规划能力。

进入生产后，问题开始变化：

- 采购、差旅和客服 Agent 使用不同语言与框架，凭据处理逻辑被重复实现；
- 安全团队要求长期密钥不能进入 Agent 进程，工具权限还要绑定最终用户的委托范围；
- 平台团队需要统一限制超时、并发、数据外发目标和单任务预算；
- 审计人员想知道某张采购单是由谁、在哪个任务中、依据哪版策略创建的；
- Agent 框架可以升级或替换，但权限控制不能跟着每个 SDK 重新实现；
- 一次创建订单请求超时后，系统必须先判断“没有执行”还是“已经执行但回执丢失”，不能盲目重试。

此时，瓶颈已经不只是模型能力，而是**模型决策怎样安全地变成外部副作用**。

Agent Sidecar 是解决这个问题的一种架构模式：在 Agent 旁边运行一个由平台管理的伴生组件，通过本地接口承接工作负载身份、短期凭据、工具连接、策略执行、可靠性控制和遥测。Agent 仍然理解目标、构造上下文并规划动作；Sidecar 则保证动作只能沿着受控路径执行。

“Agent Sidecar”目前还没有统一、成熟的学术定义。本文使用的是工程定义，不把它包装成某个既定标准，也不主张所有 Agent 都应该采用这种部署方式。真正需要讨论的是：哪些职责值得移出 Agent 进程，控制点怎样避免被绕过，以及额外的延迟、资源和故障复杂度是否值得。

## 一、为什么 Agent 会长出一圈基础设施代码

一个能够调用工具的 Agent，至少包含两条性质不同的路径。

第一条是**认知路径**：理解用户目标、选择上下文、调用模型、制定计划、判断是否继续。这条路径决定 Agent 想做什么。

第二条是**执行路径**：认证调用方、检查权限、获取凭据、连接工具、处理超时、记录回执。这条路径决定系统允许什么真正发生。

原型通常把两条路径放在同一个进程里，因为这样最短：

```text
用户请求
   ↓
Agent Runtime
   ├── Prompt 与上下文
   ├── 模型推理
   ├── 工具选择
   ├── OAuth / API Key
   ├── HTTP / MCP 客户端
   ├── 重试与熔断
   ├── 权限判断
   └── 日志与 Trace
           ↓
       外部工具
```

当 Agent 数量增加，这种实现会产生四类结构性问题。

### 1. 凭据暴露面跟随 Agent 数量增长

如果 Agent 进程能够读取长期 API Key，那么模型工具适配代码、第三方 SDK、调试接口和依赖漏洞都处在同一个信任边界内。密钥轮换还需要协调每个应用发布。即使密钥通过环境变量注入，也没有改变 Agent 进程能够读取它的事实。

更稳健的做法是让 Agent 只拥有工作负载身份，由受控组件根据目标工具和用户委托交换短期凭据。Agent 得到的是“调用这个能力”的接口，而不是可以复制和转发的永久秘密。

### 2. 同一条策略被翻译成多份业务代码

“实习生不能创建超过 5000 元的采购单”看似是一条规则，实际执行时还涉及租户、用户身份、采购类别、审批状态、参数摘要和规则版本。如果 Java、Python 和 TypeScript Agent 各写一遍，策略发布、撤销与审计很快会出现差异。

SDK 可以复用代码，但不能天然保证业务方没有绕过 SDK 直接访问目标 API。需要强制执行时，控制点必须位于真实调用路径上，并配合网络和目标系统权限一起限制旁路。

### 3. 可靠性语义被“自动重试”掩盖

读取供应商列表超时，通常可以在预算内重试；创建采购单超时则完全不同。调用方不知道目标系统是否已经落单，立即重试可能创建两张订单。

Sidecar 可以统一实现超时、并发和熔断，却不能凭空把非幂等业务变成恰好一次。调用契约仍要提供稳定的幂等键、结果查询接口或补偿流程。可靠性的核心不是“多重试几次”，而是保持副作用状态可判定。

### 4. 日志记录了结果，却解释不了授权依据

普通 HTTP 日志能回答调用了哪个地址、耗时多久、返回什么状态码，却未必能回答：

- 这次动作来自哪个用户和哪个 Agent？
- 使用了哪项用户委托与哪版策略？
- 为什么允许创建而不是只允许查询？
- 审批记录绑定的是这组参数，还是另一个已经被模型修改的动作？
- 工具超时后，最终副作用状态是否仍然未知？

这些信息必须在动作穿过执行边界时形成关联记录。事后从 Prompt、应用日志和目标系统日志中拼接，通常既不完整，也很难证明没有被遗漏。

因此，Sidecar 优化的是执行治理和平台一致性。它不会直接提高模型推理质量，也不会自动修复错误的业务规则。

## 二、Agent Sidecar 是什么，又不是什么

Kubernetes 将 Sidecar Container 定义为与主应用运行在同一 Pod 中、提供辅助能力并拥有独立容器生命周期的容器。[1] Dapr 等系统进一步展示了另一种常见形式：应用通过本地 API 使用服务调用、状态、发布订阅等能力，而基础设施实现与应用语言解耦。[2]

沿着这个思路，本文把 Agent Sidecar 定义为：

> 与一个 Agent 工作负载一对一或小范围绑定、就近通信、独立发布，并由平台管理的执行治理组件。

这个定义包含四个约束：

1. **就近。** Agent 通常通过 `localhost` 或 Unix Domain Socket 调用，避免把每一步都变成跨网络服务调用。
2. **绑定工作负载。** Sidecar 知道自己服务哪个 Agent、哪个租户和哪个部署身份，可以按工作负载下发策略。
3. **独立治理。** Sidecar 的镜像、策略和权限由平台控制，不随 Agent 业务代码任意修改。
4. **进入真实执行路径。** 受控工具只接受 Sidecar 所持身份，或者网络层禁止 Agent 直接连接目标，否则“策略执行”只是建议。

### 数据面与控制面

Sidecar 处理每一次实际调用，属于数据面；策略、工具目录、凭据映射和版本配置则由控制面维护。

```text
                    ┌───────────────────────────────┐
                    │         Control Plane         │
                    │ 策略 / 工具目录 / 身份 / 吊销 │
                    └──────────────┬────────────────┘
                                   │ 下发与同步
┌──────────────── Agent Pod ───────┼────────────────┐
│                                  ↓                │
│  ┌──────────────┐  local API  ┌───────────────┐  │
│  │ Agent Runtime│ ───────────→ │ Agent Sidecar │  │
│  │ 推理与规划   │ ←─────────── │ 执行与治理    │  │
│  └──────────────┘              └───────┬───────┘  │
└────────────────────────────────────────┼──────────┘
                                         │ 受控出站
                 ┌───────────────────────┼──────────────────┐
                 ↓                       ↓                  ↓
             MCP Server              HTTP API          gRPC Service
```

控制面不应进入每次工具调用的同步关键路径。否则它一旦抖动，所有 Agent 都会停止。Sidecar 应缓存带版本和有效期的策略，但离线时允许哪些动作、缓存多久有效，需要按风险明确规定。

### 它不等于什么

**Sidecar 不等于模型代理。** 模型代理通常统一模型供应商接入、Token 计量和内容过滤；Agent Sidecar 还要处理工具身份、参数授权和业务动作回执。

**Sidecar 不等于 MCP Server。** MCP Server 对外提供工具、资源或 Prompt；Sidecar 可以代理 MCP 调用，但它的核心职责是约束 Agent 如何使用这些能力，而不是成为所有工具的实现。[5][6]

**Sidecar 不等于 Agent Runtime。** 推理循环、任务状态机、上下文选择、长期记忆和恢复编排仍属于 Runtime 或业务应用。把这些逻辑全部搬进 Sidecar，只会制造第二个更难维护的 Agent 框架。

**Sidecar 不等于业务真相源。** 采购单是否存在、预算是否扣减、审批是否有效，最终仍由采购、预算和审批系统确认。Sidecar 可以缓存与协调，不能替代目标系统的事务和授权。

## 三、一条工具调用怎样穿过 Sidecar

回到采购案例。模型决定调用 `purchase.create_order`，并生成供应商、商品、数量和金额。此时它只产生了一个**动作提议**，还没有得到执行许可。

完整路径可以拆成八步：

1. Agent Runtime 为动作分配稳定的 `action_id`，形成结构化调用信封。
2. Sidecar 校验工具名称、参数 Schema、大小限制和调用超时。
3. Sidecar 识别 Agent 工作负载身份，并验证用户委托是否仍然有效。
4. 策略引擎根据租户、用户、工具、参数、审批状态和预算作出允许、拒绝或需要确认的决定。
5. 凭据代理为目标工具交换短期、受众受限的令牌，长期凭据不返回 Agent。
6. Sidecar 使用幂等键调用 MCP、HTTP 或 gRPC 工具，并限制出站目标。
7. Sidecar 规范化目标系统回执；超时时标记结果为 `unknown`，不擅自声称失败。
8. 策略决定、凭据主体、工具回执和 Trace 被关联记录，结构化结果再返回 Agent。

一个最小调用信封可以设计成：

```json
{
  "schema_version": "agent-action/1",
  "tenant_id": "tenant-acme",
  "agent_id": "procurement-agent",
  "task_id": "task-20261028-0017",
  "action_id": "act-0042",
  "user_delegation": {
    "subject": "user-1847",
    "scopes": ["supplier:read", "purchase:create"],
    "expires_at": "2026-10-28T09:35:00Z"
  },
  "tool": "purchase.create_order",
  "arguments": {
    "supplier_id": "supplier-23",
    "sku": "workstation-x2",
    "quantity": 2,
    "total_amount": 28600,
    "currency": "CNY",
    "approval_id": "approval-917"
  },
  "risk": "high",
  "timeout_ms": 8000,
  "idempotency_key": "purchase/task-20261028-0017/act-0042"
}
```

这里有三个不能混为一谈的身份：

| 身份 | 回答的问题 | 采购案例 |
| --- | --- | --- |
| 用户委托身份 | 谁要求 Agent 行动，授权范围是什么 | `user-1847` 允许在本任务中创建采购单 |
| Agent 工作负载身份 | 哪个运行实例正在调用 Sidecar | `procurement-agent` 的某个 Pod |
| 目标工具身份 | Sidecar 正在连接谁，令牌发给谁 | 采购系统 API 或 MCP Server |

SPIFFE 的工作负载身份与 SVID 可以为第二类身份提供基础，但它不会自动表达最终用户委托和业务授权。[3] 同样，服务账号证明“这个 Pod 是采购 Agent”，不等于证明“这个用户有权购买 28600 元的设备”。

### 把审批绑定到具体动作

审批不能只是一个布尔值。假设用户审批了两台、总价 28600 元的设备，模型随后把数量改成三台。如果策略只检查 `approved=true`，审批就被错误复用。

更可靠的做法是让审批记录绑定：

- `task_id` 与 `action_id`；
- 规范化后的工具名称；
- 关键参数摘要或完整参数哈希；
- 金额、数据范围等风险字段；
- 审批人、有效期和策略版本。

任何影响风险的参数变化都生成新动作并重新授权。模型可以解释变化原因，但不能自行扩大批准范围。

### MCP 头部能做什么，不能做什么

MCP 2026-07-28 的发布说明引入无状态请求，并讨论通过 `Mcp-Method`、`Mcp-Name` 等头部帮助中间设施进行路由、可观测和授权。[5] 这使 Sidecar 有机会在不完整解析消息体时执行粗粒度策略，例如“这个 Agent 只能调用 `tools/call` 中的指定工具”。

但“允许调用某个工具”不等于“允许使用任意参数”。金额上限、文件路径、查询范围和外发目标仍需要检查结构化内容。头部适合快速路由和第一层策略，参数级授权不能因此省略。

### 超时不是失败

对写操作，Sidecar 至少需要区分三种结果：

```text
succeeded  目标系统确认副作用已经完成
failed     目标系统确认没有执行，或明确拒绝
unknown    请求已发出，但无法确定是否产生副作用
```

只有明确失败且满足重试条件时才能自动重试。结果未知时，应先凭 `idempotency_key` 查询目标系统，或进入人工核对与补偿流程。把所有非 2xx 响应都当成失败，会在最需要可靠性的地方制造重复副作用。

## 四、哪些能力适合放进 Sidecar

判断一项能力是否适合进入 Sidecar，可以问三个问题：它是否跨 Agent 重复出现，是否需要与业务代码形成独立信任边界，以及它是否能通过稳定的本地契约提供。如果三项答案都是肯定的，Sidecar 通常值得评估。

### 1. 身份与短期凭据

Sidecar 可以读取 Pod 的投影服务账号令牌或工作负载身份材料，再向身份服务交换短期、受众受限的访问令牌。Agent 只提交目标能力和用户委托，不接触无法轮换的长期 Secret。[3]

需要注意，凭据代理不等于授权系统。拿到采购 API 的令牌，只能说明当前工作负载通过了认证；是否允许为某个用户创建 28600 元采购单，仍需要领域策略和目标系统校验。

### 2. 工具连接与协议适配

Sidecar 适合统一处理：

- MCP、HTTP 与 gRPC 连接；
- 服务发现、DNS 和连接池；
- 请求与响应大小限制；
- 协议错误到统一错误模型的映射；
- 受控重定向和出站目标校验；
- 工具 Schema 缓存与版本兼容检查。

这种抽离让 Agent Runtime 面向稳定的动作接口，而不必理解每个工具的认证与传输细节。但协议适配必须克制。把所有目标系统都强行抹平成一个过度通用的 `invoke(name, payload)`，会丢失幂等性、分页、流式响应和事务边界等关键语义。

### 3. 策略执行与审批门禁

OPA 与 Envoy 的外部授权模式展示了“策略决策”和“请求执行”分离的实现思路：执行点提供请求上下文，策略引擎返回允许、拒绝及附加约束。[4] Agent Sidecar 可以采用类似结构，但 Agent 工具策略通常比 URL 授权更细：

- 允许调用哪些工具和版本；
- 哪些参数只能取给定集合；
- 允许读取哪个租户、项目或数据分区；
- 哪些目标需要用户确认或人工审批；
- 单任务、单用户和单租户预算是多少；
- 哪些返回字段必须脱敏；
- 哪些动作只能在指定网络和时间窗口执行。

审批不应该只是一个布尔值。Sidecar 应验证审批与当前动作的绑定关系，并把策略版本、审批证据和参数摘要一起写入审计记录。

### 4. 可靠性控制

超时、并发限制、熔断和退避属于跨工具重复出现的机制，适合统一实现。重试策略则必须由动作语义驱动：

| 动作类型 | 自动重试条件 | 超时后的处理 |
| --- | --- | --- |
| 纯读取 | 请求无副作用，且服务端支持重复调用 | 可按预算退避重试 |
| 幂等写入 | 目标系统识别稳定幂等键 | 使用同一幂等键重试或查询结果 |
| 非幂等写入 | 通常不自动重试 | 标记 `unknown`，核对结果或人工处理 |
| 高风险写入 | 身份、策略和审批均有效 | 任一控制依赖不可用时暂停 |

Sidecar 可以实现机制，动作分类和业务补偿仍由领域系统定义。

### 5. 可观测性和动作审计

Sidecar 位于模型决策和外部工具之间，天然适合关联工具、策略、身份和回执。它可以统一产生 Trace Span、调用指标和动作审计事件，同时执行字段级脱敏。

但审计日志和调试日志不能混为一份。审计日志强调“谁依据什么执行了什么”，应结构稳定、可校验、受保留策略保护；调试日志可能包含 Prompt、工具参数和响应，访问面更窄，也不应无限期保存。

### 6. 有界的临时状态

Sidecar 可以保存令牌缓存、连接状态、策略快照、工具目录、本地限流桶和短期去重记录。这些状态必须有 TTL、版本和失效机制。

权威任务状态、长期记忆、审批记录和业务实体不应只存在于 Sidecar。Pod 重建后，平台必须能够从外部系统恢复正确状态，而不是依赖某个伴生容器磁盘里的偶然副本。

### 职责边界总表

| 能力 | Agent Runtime | Sidecar | 控制面 | 目标系统 |
| --- | --- | --- | --- | --- |
| 理解目标与制定计划 | 拥有 | 不拥有 | 不拥有 | 不拥有 |
| 选择工具并提出动作 | 拥有 | 校验契约 | 提供目录 | 提供能力 |
| 工作负载认证 | 使用本地接口 | 执行 | 配置信任关系 | 验证身份 |
| 用户委托 | 携带任务上下文 | 验证与约束 | 定义交换规则 | 最终授权 |
| 策略 | 提供上下文 | 同步执行 | 发布、版本化、吊销 | 保留领域校验 |
| 工具凭据 | 不直接持有长期凭据 | 交换和注入 | 管理映射与信任 | 校验受众和权限 |
| 任务状态 | 维护执行状态机 | 只缓存调用状态 | 不维护业务状态 | 维护自身业务状态 |
| 长期记忆 | 决定写入和读取 | 不拥有 | 可提供基础设施 | 由记忆系统持久化 |
| 审计 | 关联推理步骤 | 记录动作边界 | 汇聚和治理 | 记录业务结果 |

## 五、哪些能力不应该塞进 Sidecar

Sidecar 很容易从“统一横切能力”演变成新的万能中间层。它一旦理解太多业务，就会同时承担发布瓶颈、共享故障和组织协调成本。

以下能力通常应留在 Agent Runtime 或业务系统中：

### 推理循环与上下文工程

模型选择、Prompt 拼装、上下文裁剪、规划方式、反思循环和终止判断直接决定 Agent 行为。它们变化快，也与具体框架紧密相关。Sidecar 可以记录模型调用或限制预算，但不应接管认知循环。

### 长期记忆的写入决策

Sidecar 可以提供存储连接和访问控制，却不应该决定一句对话是否值得形成用户偏好、经验或事实。记忆写入涉及语义、冲突和生命周期，应由专门的记忆层与业务规则管理。

### 领域编排和业务验收

“报价查询后必须经过预算核验”“超过金额需要两级审批”属于采购流程，而不是通用 Sidecar 的内部状态机。Sidecar 可以强制检查审批证据，但审批流程本身应由工作流或审批系统拥有。

同样，工具返回成功不代表业务目标已经完成。采购单创建后是否满足用户需求，需要 Agent Runtime 或业务应用继续验收。

### 权威业务状态

Sidecar 不是采购数据库、预算账本或任务数据库。把权威状态放进每个 Pod，会造成并发冲突、恢复困难和审计分裂。Sidecar 只应保存可重建、可过期的本地状态。

### 完整思维链和无限期原始内容

安全审计需要动作理由和证据，不等于保存模型的完整隐藏推理。更实用的记录是结构化决策摘要、所用输入、策略结果和外部回执。Prompt 和工具响应如需留存，应分类、脱敏、限权并设置保留期。

最后，策略不能只存在于 Sidecar。目标系统仍要执行租户隔离、对象级授权、金额约束和事务校验。Sidecar 提供第一道统一边界，目标系统提供最终领域防线。

## 六、Sidecar、SDK、节点代理和 Gateway 怎样选择

Sidecar 不是唯一的控制点。相同能力也可以放入 Agent SDK、共享 Gateway 或节点级代理。选择取决于隔离、延迟、治理强度和运维成本，而不是命名偏好。

| 维度 | SDK | Sidecar | 节点代理 | Gateway |
| --- | --- | --- | --- | --- |
| 调用路径 | 进程内 | 本地 IPC | 节点内网络 | 跨网络共享服务 |
| 语言耦合 | 高 | 低 | 低 | 低 |
| 每实例资源 | 最低 | 较高 | 节点级摊销 | 集中摊销 |
| 工作负载隔离 | 依赖应用 | 强 | 中等 | 较弱 |
| 凭据隔离 | 较弱 | 强 | 可实现 | 集中持有 |
| 绕过难度 | 低 | 配合网络策略后较高 | 取决于流量劫持 | 取决于出站限制 |
| 故障范围 | 单进程 | 单 Pod | 单节点 | 多工作负载共享 |
| 升级方式 | 逐应用升级 | 镜像与注入版本 | DaemonSet 滚动 | 服务端集中升级 |
| 适用场景 | 单语言、小规模 | 多框架、强隔离 | 通用网络/遥测 | 跨集群、统一入口 |

一个系统也可以组合使用。例如：Agent 调用本地 Sidecar，Sidecar 再访问跨集群 Gateway。前者提供工作负载身份、细粒度策略和本地审计，后者完成统一路由、跨区域限流和外部服务接入。

组合不会自动变好。每增加一层，都要回答谁负责重试、谁生成幂等键、错误怎样映射、Trace 怎样传播。两个中间层同时重试，可能把一次超时放大成多次写入；两层都做缓存，可能让策略撤销时间不可预测。

可以用以下判断快速筛选：

- 只有一个应用、单一语言、工具很少且没有敏感写操作：优先从 SDK 开始。
- 多语言、多框架，需要隔离凭据并按工作负载施策：评估 Sidecar。
- 能力主要是节点网络、证书或遥测采集：优先节点代理。
- 多个集群和租户共享外部入口，强调集中运维：评估 Gateway。
- 目标系统本身已经提供强认证、细粒度授权和完整审计：先利用原生能力，避免重复建设。

## 七、安全边界不能建立在“localhost 可信”上

Sidecar 与 Agent 位于同一个 Pod，不代表它们具有相同权限，也不代表本地端口天然安全。Agent 可能受到间接提示注入，依赖可能被利用，调试容器也可能尝试调用本地接口。

InjecAgent 和 AgentDojo 展示了工具返回值中的间接提示注入如何诱导 Agent 泄露数据或执行有害动作。[11][12] ToolEmu 则通过模拟沙箱识别工具型 Agent 的长尾风险。[13] 这些研究不能证明 Sidecar 是最优实现，却说明权限边界不应依赖模型自己识别所有恶意内容。

### 主要威胁

| 威胁 | 典型表现 | 主要控制点 |
| --- | --- | --- |
| 间接提示注入 | 网页或工具结果诱导 Agent 执行越权动作 | 外部内容标记、参数策略、最小权限 |
| 令牌透传 | Agent 把用户令牌直接转发给下游 | 受众校验、令牌交换、禁止 passthrough |
| 混淆代理 | Sidecar 用高权限身份替低权限用户执行 | 同时验证用户委托与工作负载身份 |
| SSRF | 工具参数诱导访问元数据或内网地址 | 出站白名单、DNS/IP 校验、重定向限制 |
| 恶意工具服务 | MCP Server 返回投毒内容或窃取数据 | 工具准入、身份认证、响应隔离、数据外发策略 |
| 旁路调用 | Agent 绕过 Sidecar 直连目标 API | NetworkPolicy、目标侧身份、受控 DNS/egress |
| 审计泄露 | Prompt、令牌或工具结果进入长期日志 | 分级脱敏、访问控制、保留期 |

MCP 安全最佳实践特别强调令牌受众、禁止令牌透传、SSRF 和最小权限等问题。[6] 在 Sidecar 中，这些原则可以落到几个具体机制上。

### 本地接口也要认证

Unix Domain Socket 可以用文件权限限制可访问进程；TCP 本地接口则可以结合 mTLS、短期会话令牌或工作负载证明。Sidecar 还要校验调用信封中的 `agent_id` 是否与连接身份一致，不能只相信请求体自报身份。

如果平台无法提供进程级隔离，至少要保证 Sidecar 使用的高权限凭据不会暴露给共享卷、环境变量和 Agent 文件系统。

### 不可绕过比“策略很聪明”更重要

最完善的策略引擎如果不在真实路径上，也只是提示。目标工具应只信任 Sidecar 可获得的身份；Pod 出站网络应限制 Agent 直接连接；工具目录不应把未受控端点暴露给模型。

这并不意味着网络策略可以代替应用授权。NetworkPolicy 只能缩小连接范围，不能判断某个用户是否有权创建特定采购单。

### 按风险决定 fail open 还是 fail closed

“依赖故障时一律拒绝”会把控制面事故放大为业务停摆；“一律放行”则会在最脆弱的时候撤掉安全边界。更合理的是按动作风险分级：

- 已授权的公共数据读取，可以在策略快照有效期内降级运行；
- 包含敏感数据的读取，需要有效用户委托和数据范围；
- 低风险幂等写入，需要有效身份、策略和幂等能力；
- 转账、采购、删除等高风险动作，在身份、策略或审批不可验证时暂停执行。

降级规则本身也必须版本化和审计，不能由某个 Sidecar 在故障时临时决定。

### Sidecar 自身是高权限供应链组件

Sidecar 能拿到工具凭据、看到动作参数并影响所有调用，因此它需要比普通业务容器更严格的保护：签名镜像、固定摘要、SBOM、漏洞扫描、只读根文件系统、最小 Linux capabilities、非 root 用户和独立安全审查。

如果 Sidecar 镜像被替换，集中治理会变成集中泄露。平台必须能够证明运行的是哪一个构建产物，并快速吊销有问题的版本。

## 八、生命周期和故障语义怎样设计

Agent 与 Sidecar 共享 Pod 生命周期，却是两个独立进程。系统必须区分“进程还活着”“可以提供本地接口”和“可以安全执行动作”三种状态。

### 启动：先建立执行边界，再接收任务

Sidecar 启动后通常需要完成：

1. 获取工作负载身份；
2. 与控制面建立信任并取得配置；
3. 拉取工具目录和策略包；
4. 验证策略签名、版本和有效期；
5. 创建本地 Socket 并完成自检。

只有这些步骤成功，Sidecar 的 `ready` 才能变为真，Agent 才开始接收包含外部动作的任务。否则 Agent 可能在策略尚未加载时抢先调用工具。

`live` 和 `ready` 应有不同含义：

- `live` 表示进程没有陷入不可恢复状态，失败时可以由 Kubernetes 重启；
- `ready` 表示身份、策略和必要工具连接满足当前执行要求；
- 更细的能力状态可以由本地 `/v1/capabilities` 返回，例如只读工具可用、写工具暂不可用。

不应因为一个非关键工具故障就让整个 Sidecar 永远不 Ready。就绪条件需要围绕 Agent 实际依赖的能力定义。

### 运行：缓存必须有版本、TTL 和撤销语义

控制面断开时，Sidecar 可以继续使用最近一次验证通过的策略快照，但需要同时记录：

- `policy_version`：当前执行的策略版本；
- `issued_at` 与 `expires_at`：策略有效窗口；
- `revocation_cursor`：已经同步到哪个吊销位置；
- `offline_permissions`：离线期间允许执行的动作等级。

策略过期后，Sidecar 不应默默无限延长。公共读取可以返回缓存或进入只读降级；高风险写入则停止，并向 Agent 返回“控制依赖不可验证”，而不是伪装成目标工具失败。

错误分类会影响 Agent 的下一步行为。至少应区分：

```text
POLICY_DENIED             策略明确拒绝，不应重试
APPROVAL_REQUIRED         需要新的外部确认
CONTROL_PLANE_UNAVAILABLE 控制依赖不可用，可等待或降级
TOOL_UNAVAILABLE          目标工具不可用，可按规则退避
RESULT_UNKNOWN            可能已产生副作用，先核对
CONTRACT_INVALID          调用格式错误，应修正参数
```

如果所有错误都映射成一个普通异常，模型很可能用错误策略恢复，例如在明确拒绝后反复重试，或在结果未知时重新创建订单。

### 终止：先停止新动作，再处理在途调用

Pod 终止时，Sidecar 应先进入 draining 状态：拒绝新动作，允许有界时间内的在途读取完成，并记录所有未决写操作。Agent 收到终止信号后也应停止启动新步骤，持久化任务检查点。

优雅终止时间不能无限长。超过预算的调用需要留下稳定的 `action_id` 和 `idempotency_key`，由恢复实例查询目标系统。仅仅杀掉进程并不能撤销已经发出的外部请求。

Kubernetes 原生 Sidecar Container 提供了与主容器协调启动和终止的生命周期语义，但它不会替应用设计业务恢复协议。[1]

### 故障矩阵

| 故障 | 读取动作 | 写入动作 | 恢复依据 |
| --- | --- | --- | --- |
| Sidecar 进程退出 | Agent 暂停调用，等待本地端点恢复 | 不允许绕过直连 | 重启后重新加载身份和策略 |
| 控制面断开 | 有效快照范围内可继续 | 按风险和快照有效期决定，高风险暂停 | 配置版本、TTL、吊销游标 |
| 身份服务不可用 | 已有短期令牌有效期内可读 | 不使用过期令牌，高风险暂停 | 令牌受众与到期时间 |
| 策略引擎超时 | 仅执行预定义低风险降级 | 默认拒绝高风险写入 | 缓存策略和降级规则版本 |
| 工具调用超时 | 可按读取策略重试 | 标记 `unknown`，先查询结果 | `action_id`、幂等键、工具回执 |
| 审计后端不可用 | 可写入有界本地缓冲 | 超过缓冲或合规阈值后暂停 | 审计序列号和落盘确认 |
| 策略版本回退 | 拒绝未授权降级 | 拒绝执行 | 签名、单调版本或显式回滚授权 |

这里不存在一个适合所有系统的 fail-open/fail-closed 答案。正确做法是预先按动作风险定义行为，并在故障演练中验证，而不是事故发生时临时决定。

## 九、可观测性要解释“为什么允许这个动作”

普通服务 Trace 往往到 HTTP 调用为止。Agent Sidecar 需要把模型决策、策略决定和业务回执放进同一条因果链。

一个采购任务可以形成如下结构：

```text
agent.task procurement
├── agent.step compare_suppliers
│   ├── gen_ai.chat
│   └── tool.invoke supplier.search
│       ├── policy.evaluate
│       └── http.request supplier-api
├── agent.step request_approval
│   └── tool.invoke approval.create
└── agent.step create_purchase
    ├── gen_ai.chat
    └── tool.invoke purchase.create_order
        ├── policy.evaluate
        ├── identity.exchange
        └── http.request purchase-api
```

OpenTelemetry 的 GenAI 语义约定可以作为模型、Agent 和工具 Span 的起点，但相关字段仍可能处于 Development 或 Experimental 状态。[7] 内部数据模型应带版本，不要把正在演进的字段名直接固化为永久数据库契约。

### 关联字段

以下字段应跨 Agent、Sidecar、策略和目标系统传播：

| 字段 | 用途 |
| --- | --- |
| `tenant_id` | 租户与数据边界 |
| `user_id` | 最终用户或委托主体 |
| `agent_id` / `agent_version` | 发起动作的工作负载及版本 |
| `task_id` | 端到端业务任务 |
| `action_id` | 单个动作提议和恢复标识 |
| `tool_name` / `tool_version` | 实际调用的工具契约 |
| `policy_version` | 作出决定的策略版本 |
| `credential_subject` | Sidecar 实际使用的身份主体 |
| `approval_id` | 高风险动作所绑定的批准证据 |
| `trace_id` / `span_id` | 分布式调用因果关系 |
| `idempotency_key` | 写操作去重与结果查询 |

这些字段不必全部暴露给模型。它们由 Runtime 和 Sidecar 维护，并在结构化接口中传递。尤其不要让模型自行生成租户身份、策略版本或凭据主体。

### 四类指标

**运行指标**回答系统是否健康：调用量、P50/P95/P99 延迟、Sidecar CPU 与内存、策略缓存年龄、控制面同步延迟、连接池饱和度。

**风险指标**回答边界是否有效：策略拒绝率、用户确认率、越权尝试、旁路探测、过期委托、敏感字段脱敏次数、策略回滚和高风险 fail-closed 次数。

**质量指标**回答动作是否完成：工具成功率、未知结果数量、重复副作用、人工接管率、恢复成功率以及最终业务验收结果。

**成本指标**回答资源花在哪里：模型 Token、工具费用、审批等待时间、Sidecar 额外资源、每任务外部调用次数。

Sidecar 延迟必须单独测量。只看端到端耗时无法分辨模型变慢、策略查询变慢还是 IPC 与协议转换变慢。

### 审计事件与调试日志分流

一条动作审计事件可以长这样：

```json
{
  "event_type": "agent.action.completed",
  "occurred_at": "2026-10-28T09:22:14.381Z",
  "tenant_id": "tenant-acme",
  "user_id": "user-1847",
  "agent_id": "procurement-agent",
  "agent_version": "2.4.1",
  "task_id": "task-20261028-0017",
  "action_id": "act-0042",
  "tool_name": "purchase.create_order",
  "argument_digest": "sha256:5bb...",
  "decision": "allow",
  "policy_version": "procurement-policy/37",
  "approval_id": "approval-917",
  "credential_subject": "spiffe://example.com/ns/agents/sa/procurement",
  "result": "succeeded",
  "resource_id": "purchase-order-5821",
  "trace_id": "4fd0..."
}
```

审计事件保留参数摘要和关键风险字段，不必复制完整 Prompt。调试数据如确有需要，应进入权限更严、保留期更短的存储。令牌、Secret、个人敏感信息和模型隐藏推理不应默认进入任一日志。

## 十、在 Kubernetes 上实现一个最小版本

最小可行版本不需要一开始就建设完整 Agent 平台。先选择一个只读工具和一个需要审批的写工具，验证三件事：Agent 无法绕过 Sidecar、写操作能够恢复、审计链能够连接用户到业务回执。

### 本地 API

Sidecar 可以先提供一组很小的接口：

| 接口 | 作用 |
| --- | --- |
| `GET /v1/tools` | 返回当前工作负载可见的工具与契约版本 |
| `POST /v1/invoke` | 校验、授权并执行一个结构化动作 |
| `POST /v1/authorize` | 只做策略预检，不产生外部副作用 |
| `GET /v1/actions/{id}` | 查询动作及未知结果的恢复状态 |
| `GET /v1/identity` | 返回当前工作负载身份摘要，不返回秘密 |
| `GET /health/live` | 进程存活检查 |
| `GET /health/ready` | 身份、策略与必需工具就绪检查 |

`authorize` 只能用于提前展示是否需要审批，真正执行时仍要重新授权。否则检查与执行之间的用户权限、参数或策略可能已经变化。

### Pod 结构示例

下面示例使用 Kubernetes 原生 Sidecar Container 语义：在 `initContainers` 中声明 `restartPolicy: Always`，使 Sidecar 先启动并在主容器运行期间持续存在。[1] 这是结构示意，镜像地址、探针命令、安全上下文和资源配额需要按实际实现调整。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: procurement-agent
  labels:
    app: procurement-agent
spec:
  serviceAccountName: procurement-agent
  automountServiceAccountToken: false
  initContainers:
    - name: agent-sidecar
      image: registry.example.com/agent-sidecar@sha256:REPLACE_ME
      restartPolicy: Always
      args:
        - --listen=unix:///var/run/agent-sidecar/sidecar.sock
        - --config=/etc/agent-sidecar/config.yaml
      securityContext:
        runAsNonRoot: true
        runAsUser: 10002
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      readinessProbe:
        exec:
          command: ["test", "-S", "/var/run/agent-sidecar/sidecar.sock"]
        periodSeconds: 2
      resources:
        requests:
          cpu: 50m
          memory: 64Mi
        limits:
          cpu: 500m
          memory: 256Mi
      volumeMounts:
        - name: sidecar-socket
          mountPath: /var/run/agent-sidecar
        - name: sidecar-config
          mountPath: /etc/agent-sidecar
          readOnly: true
        - name: workload-token
          mountPath: /var/run/secrets/agent-sidecar
          readOnly: true
  containers:
    - name: agent
      image: registry.example.com/procurement-agent:2.4.1
      env:
        - name: AGENT_SIDECAR_URL
          value: unix:///var/run/agent-sidecar/sidecar.sock
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      resources:
        requests:
          cpu: 250m
          memory: 256Mi
        limits:
          cpu: "2"
          memory: 2Gi
      volumeMounts:
        - name: sidecar-socket
          mountPath: /var/run/agent-sidecar
  volumes:
    - name: sidecar-socket
      emptyDir: {}
    - name: sidecar-config
      configMap:
        name: procurement-agent-sidecar
    - name: workload-token
      projected:
        sources:
          - serviceAccountToken:
              path: token
              audience: agent-control-plane
              expirationSeconds: 600
```

投影令牌只挂载到 Sidecar，Agent 容器不直接获得 Kubernetes 服务账号令牌。Sidecar 使用它向受众明确的控制面证明工作负载身份，再交换目标工具的短期凭据。

Unix Socket 减少本地网络暴露，但还要设置目录和 Socket 权限，使 Agent 能调用而其他非预期进程不能访问。若使用 TCP，本地端口同样需要认证，不能只绑定 `127.0.0.1` 就认为边界成立。

### 让旁路调用真正困难

部署 Sidecar 后，如果 Agent 仍能直接访问采购 API，那么所有策略都可以被一段业务代码绕过。需要组合以下控制：

- 目标系统只信任 Sidecar 可获得的工作负载或客户端身份；
- Agent 容器不持有目标工具凭据；
- NetworkPolicy 和出口代理限制 Pod 的可访问目标；
- 工具目录只发布经过审核的服务地址；
- 对公网和动态 URL 使用显式出站白名单及 SSRF 防护。

Kubernetes NetworkPolicy 作用于 Pod 网络，通常不能单独区分同一 Pod 内两个容器的出站流量。因此，**目标侧身份校验和凭据隔离是不可缺少的一层**。仅靠网络策略不能证明请求一定来自 Sidecar 进程。

### 控制面只管理可版本化资产

控制面可以维护：

- Agent 注册和工作负载身份映射；
- 工具目录、Schema 与版本兼容信息；
- 策略包、签名、有效期与吊销；
- 目标凭据交换规则；
- Sidecar 配置、灰度版本和强制升级；
- 审计汇聚和异常告警。

控制面不应存放每个任务的完整推理状态，也不应同步参与每一次调用。Sidecar 缓存有界配置并执行，任务状态仍由 Agent Runtime 或外部任务存储负责。

### 从显式部署开始

自动注入可以通过 Mutating Admission Webhook 或 Operator 完成，但不应成为第一步。先在一个明确的 Pod 模板中部署，观察权限、资源、探针、升级和终止行为。只有本地契约稳定、绕过路径被验证、故障语义清楚后，再把注入自动化。

否则，Webhook 只是快速把一个尚未理解的故障域复制到所有 Agent。

## 十一、怎样判断 Sidecar 是否值得引入

Sidecar 带来的不是免费抽象。每个 Agent 实例多一个进程或容器，意味着额外 CPU、内存、IPC、协议解析、镜像分发、探针和版本协调。Service Mesh Sidecar 的研究已经表明，中介层开销来自 socket 写入、数据复制、协议处理和排队，而且会随工作负载与配置显著变化。[14] 这项研究的对象不是 LLM Agent，不能直接搬用具体数字，但足以提醒我们必须实测。

### 适合评估的场景

- 多个团队使用不同语言和 Agent 框架，却需要共享身份、策略与审计能力；
- 工具包含采购、转账、删除、发布等敏感写操作；
- 长期凭据不能暴露给 Agent 进程；
- 用户委托、工作负载身份和目标工具身份需要分别验证；
- 合规要求能够追溯每个动作的策略依据和业务回执；
- 平台希望在不升级每个 Agent SDK 的情况下撤销工具或更新策略；
- 单个工作负载的故障隔离比集中资源利用率更重要。

### 通常不值得的场景

- 单用户本地助手，只调用少量无敏感数据的只读工具；
- 原型尚未形成稳定的工具契约和错误语义；
- 目标系统没有身份、幂等或结果查询能力，Sidecar 也无法补足；
- 团队没有能力运维第二个关键进程及其控制面；
- 请求对微秒或极低毫秒延迟高度敏感，且不存在足够治理收益；
- 只是希望“架构看起来更平台化”，没有明确的隔离或复用问题。

判断标准不应是 Agent 数量本身。两个高风险支付 Agent 可能比一百个只读问答 Agent 更需要执行边界。

### 先建立基线

在引入 Sidecar 前，记录当前系统：

| 基线 | 计算方式示例 |
| --- | --- |
| 重复基础设施代码 | 各 Agent 中身份、重试、审计适配代码及维护工时 |
| 凭据暴露面 | 能读取长期 Secret 的进程、人员和环境数量 |
| 策略覆盖率 | 已受统一策略控制的高风险工具比例 |
| 审计完整率 | 能关联用户、动作、策略和回执的调用比例 |
| 框架升级成本 | 一次公共安全修复需要升级的应用数量和周期 |
| 当前性能 | 各动作 P50/P95/P99 延迟、CPU、内存和错误率 |

没有基线，团队很容易只看到新增平台复杂度，或者只看到治理愿景，却无法判断实际收益。

### 用验收指标而不是组件上线判定成功

Sidecar 上线不等于执行边界已经成立。至少验证：

- 绕过测试：Agent 能否绕过本地接口直连受控工具；
- 撤销测试：工具或用户权限撤销需要多久传播到全部实例；
- 故障测试：控制面、身份、策略和审计后端故障时是否按风险降级；
- 写入测试：超时与重启是否造成重复采购单；
- 审计测试：能否从业务资源反查用户、Agent、策略和审批；
- 性能测试：Sidecar 带来的 P95/P99 延迟、CPU、内存和排队增量；
- 恢复测试：`unknown` 动作能否在新实例中核对并收敛；
- 版本测试：策略、Sidecar 和工具契约能否独立灰度与回滚。

资源开销应按任务类型测量。读取小 JSON、下载大文件和流式 MCP 调用对 IPC 与内存的影响完全不同，不能只用一个平均值概括。

### 六阶段落地路线

**阶段一：旁路观测。** Sidecar 只接收镜像流量或审计事件，不阻断调用。目标是确认工具目录、动作分类和关联字段完整。

**阶段二：代理只读工具。** 选择一个可安全重试的读取能力，让 Agent 通过本地接口调用，测量延迟、资源和错误映射。

**阶段三：策略提示。** 对高风险动作运行策略但暂不阻断，只比较“现有行为”和“预期决定”，修正规则误报。

**阶段四：强制执行。** 配合目标身份和出站控制关闭旁路，对已验证的工具执行工具级、参数级和数据范围策略。

**阶段五：受控写入。** 接入一个具备幂等键、结果查询和审批绑定的写工具，演练超时、重启和未知结果恢复。

**阶段六：多框架规模化。** 契约稳定后再引入自动注入、控制面灰度、统一工具目录和多团队接入。

每个阶段都应有退出条件。旁路观测发现 `action_id` 无法稳定生成时，不应急着进入强制执行；目标系统不支持幂等与查询时，也不应把高风险写入交给通用重试器。

NIST AI Risk Management Framework 强调治理、识别、度量和处置贯穿整个生命周期。[15] 对 Sidecar 项目而言，这意味着安全不是上线前的一次评审，而是策略版本、运行指标、事件响应和持续验证共同组成的运营过程。

## 十二、现有论文能支持哪些结论

关于 Agent Sidecar 的直接研究仍然较少。更严谨的证据链应分成三层，而不是把所有相关材料都描述成“Sidecar 已经被证明有效”。

### 第一层：直接相关或架构近邻

*Safety Sidecar: Reflection-Driven Runtime Control for Safer Agents* 提出模型无关、即插即用的运行时模块，在动作执行前调用外部 verifier，并保留可审计轨迹。论文在安全代码生成场景报告安全解率提升 2.9 至 11.2 个百分点，端到端额外延迟约 3.2 秒。[8]

这说明“模型外部验证模块”可以在特定任务中改善安全结果，也真实引入延迟。但论文中的 Sidecar 是反思和验证模块，不等同于 Kubernetes 伴生容器，也没有覆盖工作负载身份、凭据代理、网络旁路和业务写入恢复。

*Rethinking Agent Security as a Networking Problem* 借鉴网络系统中的集中控制、分布执行、能力式访问和零信任，提出 Control Plane 与 Sidecar 参考架构。[9] *Five Primitives for Governing Autonomous AI Agents at Runtime* 则把运行时治理拆成 discovery、identity、governance、attestation 与 supply chain，并明确讨论每工作负载 Sidecar、关键路径和 fail-closed 成本。[10]

两篇工作都能帮助组织架构问题，但截至本文核对日期仍是 2026 年预印本。前者偏立场与研究议程；后者披露的是私有试点，且第五项原语尚未接入请求路径。它们不应被写成成熟行业标准或普遍生产结论。

### 第二层：工具型 Agent 的风险证据

InjecAgent、AgentDojo 和 ToolEmu 分别从间接提示注入基准、动态攻防环境和模拟沙箱角度说明：当模型可以调用外部工具时，非可信内容可能改变动作，风险会沿工具权限转化成数据泄露或真实副作用。[11][12][13]

这些论文支撑的是“需要模型外部的执行约束和测试”，不是“Sidecar 一定优于 Gateway 或 SDK”。同样的控制原则也可以在其他不可绕过的执行点实现。

### 第三层：Sidecar 机制的系统代价

Service Mesh Sidecar 研究用于提醒读者，中介层存在真实的 CPU、内存、延迟和排队成本。[14] 但 Service Mesh 处理的流量模式、代理实现和协议栈与 Agent 工具调用不同。文章只能引用其机制性结论，不能把论文中的百分比直接当成 Agent Sidecar 性能预测。

因此，现阶段最稳妥的结论是：

1. 工具型 Agent 确实需要独立于模型自律的权限和执行边界；
2. Sidecar 是实现“就近、按工作负载、语言无关控制点”的一种合理拓扑；
3. 直接实证仍然有限，收益和开销必须在具体工具、风险和部署环境中测量；
4. Sidecar 是否优于 SDK、Gateway 或目标系统原生控制，仍是工程选择，不是论文已经给出的统一答案。

## 结语：从“会调用工具”到“在边界内行动”

回到采购 Agent。引入 Sidecar 前，模型工具代码持有凭据、决定重试、记录日志，也在应用内部解释权限。引入后，Agent 仍负责理解“买什么、为什么买、下一步做什么”，但每个外部动作都要经过统一边界：

- 工作负载身份说明哪个 Agent 实例正在行动；
- 用户委托限定动作代表谁、允许做到什么程度；
- 策略与审批绑定具体工具和参数；
- 短期凭据只对目标工具有效；
- 幂等键和结果查询处理不确定写入；
- Trace 与审计把模型步骤、策略依据和业务回执连接起来。

Sidecar 没有替代采购系统授权，也没有替代 Agent Runtime 的任务状态机和业务验收。它只是把容易散落在每个框架里的横切能力，收敛到一个可以独立治理的执行边界。

最终判断标准不是系统中有没有一个名为 `agent-sidecar` 的容器，而是能否对每个外部动作回答：谁提出的，谁授权的，使用什么身份，经过哪版策略，是否真正完成，失败后怎样恢复。

当这些问题只能从 Prompt 和零散日志里猜测时，Agent 还只是“会调用工具”。当答案成为系统契约的一部分时，它才开始具备在生产边界内行动的能力。

## 参考资料

以下资料核对于 2026-10-28。会议论文、预印本和工程规范分别标明，避免混淆证据等级。

**[1] Kubernetes. Sidecar Containers.**

[官方文档](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)。用于 Sidecar Container 的 Pod 生命周期、启动顺序和终止语义；不定义 Agent Sidecar 的能力范围。

**[2] Dapr. Sidecar overview 与 Service invocation.**

[Sidecar overview](https://docs.dapr.io/concepts/dapr-services/sidecar/)，[Service invocation](https://docs.dapr.io/developing-applications/building-blocks/service-invocation/service-invocation-overview/)。用于理解本地 API、语言解耦和服务调用机制；Dapr 是通用分布式应用运行时，不等同于 Agent Runtime。

**[3] SPIFFE. Concepts.**

[官方文档](https://spiffe.io/docs/latest/spiffe/concepts/)。用于工作负载身份、信任域和 SVID；不自动解决最终用户委托和业务授权。

**[4] Open Policy Agent. OPA-Envoy Plugin.**

[官方文档](https://www.openpolicyagent.org/docs/envoy)。用于策略决策与流量执行点分离的工程参照；Agent 的工具参数和业务状态仍需要领域策略。

**[5] Model Context Protocol. 2026-07-28 Release.**

[发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)。用于无状态请求、MCP 头部和授权演进；具体实现应继续核对固定版本规范与所用 SDK。

**[6] Model Context Protocol. Security Best Practices, specification version 2026-07-28.**

[安全最佳实践](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx)。重点关注混淆代理、令牌透传、SSRF、受众校验和最小权限。

**[7] OpenTelemetry. GenAI agent spans.**

[语义约定](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)。作为 Agent、模型和工具 Trace 字段的起点；字段稳定性和仓库位置仍可能变化。

**[8] Safety Sidecar: Reflection-Driven Runtime Control for Safer Agents. Findings of ACL 2026.**

[ACL Anthology](https://aclanthology.org/2026.findings-acl.1542/)，DOI: `10.18653/v1/2026.findings-acl.1542`。用于模型外部反思与执行前验证的实证结果；实验场景主要是安全代码生成。

**[9] Rethinking Agent Security as a Networking Problem. 2026. arXiv:2608.12172.**

[论文页面](https://arxiv.org/abs/2608.12172)。2026-08-12 提交的预印本/立场论文，用于集中控制、分布执行、能力式访问与 Sidecar 参考架构；没有完整生产评测。

**[10] Five Primitives for Governing Autonomous AI Agents at Runtime. 2026. arXiv:2608.26696.**

[论文页面](https://arxiv.org/abs/2608.26696)。2026-08-27 提交的预印本，用于 discovery、identity、governance、attestation、supply chain 五项运行时治理原语及其成本；私有试点不能视为独立复现。

**[11] InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated Large Language Model Agents. Findings of ACL 2024.**

[ACL Anthology](https://aclanthology.org/2024.findings-acl.624/)，DOI: `10.18653/v1/2024.findings-acl.624`。用于说明工具返回值中的间接提示注入风险；不比较 Sidecar、Gateway 和 SDK。

**[12] AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents. NeurIPS 2024 Datasets and Benchmarks Track.**

[会议论文](https://proceedings.neurips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract-Datasets_and_Benchmarks_Track.html)，arXiv: `2406.13352`。用于提示注入攻防测试和回归测试设计；不研究 Sidecar 部署与身份体系。

**[13] Identifying the Risks of LM Agents with an LM-Emulated Sandbox. ICLR 2024.**

[会议论文](https://proceedings.iclr.cc/paper_files/paper/2024/hash/7274ed909a312d4d869cc328ad1c5f04-Abstract-Conference.html)，arXiv: `2309.15817`，系统名 ToolEmu。用于工具型 Agent 风险仿真；不是在线策略执行点。

**[14] Dissecting Overheads of Service Mesh Sidecars. ACM SoCC 2023.**

[DOI 页面](https://doi.org/10.1145/3620678.3624652)，DOI: `10.1145/3620678.3624652`，相关预印本 arXiv: `2207.00592`。用于理解 Sidecar 的系统开销来源；具体数字不能直接套用于 Agent Sidecar。

**[15] NIST. AI Risk Management Framework.**

[官方页面](https://www.nist.gov/itl/ai-risk-management-framework)。用于把治理、识别、度量和处置贯穿设计与运营；它是治理框架，不提供 Sidecar 部署实现。
