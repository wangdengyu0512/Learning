---
title: "从本地 Agent 到多用户云端 Agent：隔离、状态、MCP 网关与平台化"
description: "从本地进程的隐式信任出发，拆解 Agent 上云必须完成的能力解耦、租户隔离、沙箱执行、状态外移、MCP 凭证保护与平台公共能力建设。"
date: 2026-11-03
tags: AI Agent, 云原生, MCP
featured: false
---

一个本地编程 Agent 已经可以读取代码、修改文件、执行测试，也能通过 MCP 连接 GitHub、数据库和内部知识库。单人使用时，它运行得很好：工作目录就是项目边界，当前登录用户就是身份边界，环境变量里放着访问令牌，任务状态保存在内存或本地 JSON 中。

现在，团队希望把它变成一款云端产品，让几百名用户同时打开浏览器，提交各自的仓库和任务。

最直接的方案似乎是把 Agent 进程装进容器，再用一个 Web API 包起来。但第一个多用户版本很快就会遇到一连串问题：

- 用户 A 的任务有没有可能读到用户 B 的文件？
- Agent 生成了一条危险命令，应该在哪里执行？
- Worker 重启后，执行到一半的任务怎样恢复？
- GitHub Token 应该交给 Agent、沙箱，还是 MCP Server？
- 同一个用户启动两个任务时，记忆、文件和工具会不会串线？
- 模型已经调用外部系统创建了工单，但保存状态前进程崩溃，恢复后能否重试？

这些都不是“多启动几个副本”能够解决的问题。

> **本地 Agent 上云，不是把一个进程部署到服务器，而是把原本由本机、当前用户和本地文件系统隐式提供的能力，改造成边界清晰、可隔离、可持久化、可审计的平台服务。**

本文从一个已经可用的本地 Agent 出发，逐步完成能力切分与云端改写，重点讨论四个问题：用户隔离与沙箱、状态外移、MCP 网关，以及 Agent 平台应该提供的通用基础能力。

## 一、本地 Agent 依赖的是一整套隐式信任

本地 Agent 看起来只是“模型加工具”，实际运行时却借用了操作系统提供的大量能力。因为这些能力在单机上天然存在，开发者往往不会把它们当作架构组件。

| 本地条件 | 隐式承担的职责 | 上云后的问题 |
| --- | --- | --- |
| 当前登录用户 | 确定操作者身份和文件权限 | 一个服务进程需要代表多个用户执行 |
| 当前工作目录 | 限定文件范围并保存中间产物 | 多个任务可能落在同一节点甚至同一进程 |
| Agent 进程 | 保存会话、计划和执行游标 | 实例会重启、扩缩容和迁移 |
| 本地磁盘 | 保存历史、缓存、配置和产物 | 容器本地盘通常不是持久事实来源 |
| 环境变量 | 保存模型和工具凭证 | 同一 Worker 不能共享所有用户的令牌 |
| 本机 Shell | 提供代码执行能力 | 模型生成的命令属于不可信输入 |
| 本机网络 | 直接访问代码仓库和外部 API | 云端需要出网控制、审计和租户授权 |

在本地，“我是谁”“我能访问什么”“状态放在哪里”通常由当前操作系统会话回答。到了云端，一个 Agent Runtime 会在不同时间代表不同用户执行任务，这些答案必须由系统显式提供。

### 多用户不是多加一个 `user_id`

给会话表增加 `user_id` 是必要的，但远远不够。一个请求真正需要绑定的上下文至少包括：

```text
tenant_id     组织或租户
user_id       最终用户
agent_id      Agent 定义
version       Agent、提示词和工具集版本
session_id    连续交互会话
run_id        一次任务运行
attempt_id    一次具体执行尝试
workspace_id  独立工作空间
```

这些标识的作用不同。`session_id` 用来组织多轮交互，`run_id` 描述一次有终态的任务，`attempt_id` 区分故障恢复后的多次执行。如果只保留“用户”和“会话”，就很难判断一条工具调用属于哪次重试，也很难阻止已经失去租约的旧 Worker 继续写入结果。

因此，上云的第一步不是选 Kubernetes 还是 Serverless，而是把本地实现中混在一起的职责拆开。

## 二、先切分，再改写：把本地能力拆成七个边界

一个可迁移的 Agent，可以先拆成七个能力域。

| 能力域 | 本地版常见实现 | 云端版职责 |
| --- | --- | --- |
| Agent Core | 进程内推理循环 | 规划、上下文组装、模型交互和工具选择 |
| Workspace | 直接读写本地路径 | 提供受租户和任务约束的文件视图 |
| Execution | `subprocess`、本机浏览器 | 在隔离环境中执行命令、代码和浏览器操作 |
| State | 内存、JSON、SQLite | 保存任务、检查点、消息、记忆和版本 |
| Tool Access | 直连 API 或 MCP Server | 发现工具、校验权限、执行并返回结果 |
| Credentials | 环境变量和用户配置文件 | 托管、换取、轮换并审计访问凭证 |
| Operations | 控制台日志 | 调度、限流、追踪、评测、成本和告警 |

### 保留 Agent Core，替换环境适配器

Agent Core 应只关心三件事：当前目标和上下文是什么、下一步需要模型还是工具、结果是否满足终止条件。文件系统类型、数据库驱动、容器实现和凭证来源都不应进入核心推理循环。

本地版可以直接调用文件 API，云端版则应依赖 `WorkspaceProvider`；本地版直接启动子进程，云端版则调用 `SandboxProvider`。接口的意义不是追求形式上的整洁，而是把信任边界从 Agent Core 中剥离出来。

```ts
type RunContext = {
  tenantId: string;
  userId: string;
  agentId: string;
  agentVersion: string;
  sessionId: string;
  runId: string;
  attemptId: string;
  workspaceId: string;
};

interface WorkspaceProvider {
  read(context: RunContext, path: string): Promise<Uint8Array>;
  write(context: RunContext, path: string, data: Uint8Array): Promise<void>;
}

interface SandboxProvider {
  execute(context: RunContext, command: CommandSpec): Promise<ExecutionResult>;
}

interface CheckpointStore {
  load(runId: string): Promise<Checkpoint | null>;
  save(checkpoint: Checkpoint, expectedVersion: number): Promise<void>;
}
```

租户上下文必须参与接口，而不能藏在全局变量、线程局部变量或默认目录中。显式上下文虽然显得啰嗦，却能让权限检查、测试和审计真正覆盖执行链路。

### 把本地实现改写为云端契约

| 本地做法 | 云端契约 | 推荐实现 |
| --- | --- | --- |
| 直接读写当前目录 | Workspace API | 对象存储、持久卷或按需挂载的仓库快照 |
| 直接启动子进程 | Execution API | 容器、gVisor、Kata 或 microVM 沙箱 |
| 会话对象常驻内存 | Checkpoint Store | 关系数据库加对象存储 |
| 本地 JSON 保存设置 | Config Repository | 带租户边界和版本的数据表 |
| 环境变量保存 Token | Credential Reference | Secret Manager/Vault 加凭证代理 |
| 直连 MCP Server | Tool Gateway Client | MCP Gateway 加策略与审计 |
| 单进程循环执行到底 | Durable Task | 队列、租约、检查点和恢复机制 |
| `stdout` 排障 | Run Event | 结构化事件、Trace、指标和审计日志 |

经过这一步，Agent Core 可以在本地实现与云端实现之间切换。本地模式仍然使用目录和子进程，云端模式则使用远程 Workspace、Sandbox 和 Gateway。迁移不需要一次推倒重写。

## 三、目标架构：控制面、运行面和状态面分离

改写后的系统可以按接入层、控制面、运行面、工具访问面和数据面组织。

```text
用户 / Web / SDK
       │
       ▼
┌──────────────────────────────────────────┐
│ 接入层：认证、租户解析、限流、流式连接    │
└────────────────────┬─────────────────────┘
                     │ tenant/user/run context
                     ▼
┌──────────────────────────────────────────┐
│ Agent 控制面                              │
│ Registry · Version · Policy · Quota       │
│ Task Service · Scheduler · Approval       │
└───────────┬─────────────────────┬────────┘
            │                     │
            ▼                     ▼
┌──────────────────────┐  ┌──────────────────────┐
│ Agent Runtime / Worker│  │ MCP Gateway          │
│ context · reasoning   │  │ auth · policy · audit│
└───────────┬──────────┘  └───────────┬──────────┘
            │                           │
            ▼                           ▼
┌──────────────────────┐       MCP Servers / SaaS / API
│ Isolated Sandbox     │
│ code · shell · browser│
└───────────┬──────────┘
            │
            ▼
┌──────────────────────────────────────────┐
│ 数据面：DB · Queue · Cache · Object Store │
│ Checkpoint · Artifact · Memory · Audit    │
└──────────────────────────────────────────┘
```

这张图中有三条关键边界。

第一，**Agent Runtime 与 Sandbox 分开**。Runtime 负责推理和编排，Sandbox 负责执行模型生成的代码与命令。即使 Sandbox 被攻破，也不应直接获得平台数据库、控制面和长期凭证的访问权。

第二，**运行进程与任务状态分开**。Worker 只是当前执行者，不是任务事实的拥有者。它随时可以被替换，任务进度由数据库中的状态和检查点解释。

第三，**Agent 与外部凭证分开**。Agent 只能提出“代表这个用户调用某个工具”的请求，MCP Gateway 负责判断是否允许，并在必要时取得短期凭证。

一次任务的执行链路可以概括为：

1. 接入层验证登录态，解析 `tenant_id` 和 `user_id`。
2. Task Service 创建 `run_id`，固化 Agent、策略和工具集版本。
3. Scheduler 根据租户配额、优先级和所需能力分配 Worker。
4. Worker 加载检查点和 Workspace，调用模型生成下一步动作。
5. 代码、Shell 和浏览器操作进入 Sandbox；外部工具调用进入 MCP Gateway。
6. 每一步结果写入 Run Event，关键节点生成 Checkpoint。
7. 遇到人工审批时，任务进入等待状态，Worker 和 Sandbox 可以释放。
8. 事件到达后，新的 Worker 从检查点继续，结束时归档产物并清理环境。

## 四、核心问题一：隔离的对象不只是“用户”

多用户云端 Agent 至少需要处理五种隔离关系：租户之间、同租户用户之间、不同 Agent 之间、同一用户的不同任务之间，以及 Runtime 与 Sandbox 之间。

只做数据库行隔离不能阻止进程和文件越界，只做容器隔离也不能阻止应用用错用户令牌。可靠的隔离需要多层共同成立。

### 1. 身份与数据隔离

每个任务都要绑定不可变的主体信息。Worker 获得的是有限期运行身份，而不是平台管理员身份；工具调用时还要继续携带最终用户身份，不能退化成“后台服务统一账号”。

关系数据库中的业务表应强制包含 `tenant_id`，缓存键、对象存储路径、向量集合和日志索引也要保留同样边界：

```text
tenants/{tenant_id}/workspaces/{workspace_id}/...
tenants/{tenant_id}/runs/{run_id}/artifacts/...
```

共享表加租户列、独立 Schema、独立数据库并不是互斥选择，而是不同隔离等级。普通租户可以共享数据库并使用行级安全；强监管客户可以使用独立 Schema、密钥甚至部署单元。

无论采用哪种方案，Repository 层都应自动附加租户条件。依靠每名开发者记得在 SQL 中写 `WHERE tenant_id = ?`，迟早会出现越权查询。

### 2. 文件与工作空间隔离

Workspace 不是宿主机上的任意目录，而是平台颁发给一次任务的受限文件视图。它需要满足：

- 路径规范化，阻止 `../` 和符号链接逃逸；
- 每个 Workspace 使用独立挂载点或存储前缀；
- 输入只读挂载，输出写入指定区域；
- 临时文件、缓存和构建产物有明确生命周期；
- 任务结束后可导出产物，也可以彻底删除；
- 沙箱复用前完成可验证的清理。

对代码仓库而言，可以先生成仓库快照或浅克隆，再挂载给 Sandbox。是否允许 `git push` 应作为独立工具权限，而不是因为沙箱中存在 Git 凭证就天然允许。

### 3. 进程、资源与网络隔离

模型产生的代码、安装脚本和命令都应视为不可信工作负载。Sandbox 至少需要限制 CPU、内存、磁盘、进程数、执行时间、系统调用和设备访问，并禁止访问宿主机目录、容器运行时 Socket 与云元数据服务。

网络策略应默认拒绝。依赖安装可以走受控软件源代理，访问业务系统则通过 MCP Gateway 或专用服务代理。否则，即使工具层做了权限控制，Agent 仍可能在 Shell 中用 `curl` 绕过网关。

### 4. 容器不自动等于安全沙箱

普通容器共享宿主机内核，适合隔离受信应用，但不一定适合执行来自模型、用户仓库和互联网依赖的任意代码。

| 方案 | 隔离强度 | 启动与成本 | 适用场景 |
| --- | --- | --- | --- |
| 独立进程 | 低 | 最轻 | 受信内部逻辑，不执行用户代码 |
| 普通容器 | 中 | 低 | 依赖可控、权限较低的任务 |
| gVisor/Kata | 中高 | 中 | 需要更强内核边界的通用任务 |
| microVM | 高 | 中高 | 多租户不可信代码、浏览器和复杂工具链 |
| 独立虚拟机 | 很高 | 高 | 强隔离、长驻环境或监管要求 |

Docker Agent Sandbox 采用 microVM，并强调独立内核、网络和凭证代理等多层防护。[1] 这不意味着所有任务都必须使用 microVM，而是说明隔离强度需要由威胁模型决定。读取公开网页和运行未知仓库安装脚本，不应拥有相同的执行等级。

Sandbox 会经历创建、初始化、执行、暂停、恢复、产物收集和销毁。为了降低冷启动成本，平台可以建立预热池，但预热不应变成跨用户复用脏环境。每次分配前要重新绑定短期身份、网络策略和 Workspace；无法证明清理干净的实例应直接销毁。

## 五、核心问题二：状态必须外移，但不能全部塞进一张表

云端 Runtime 应尽量无状态。这里的“无状态”不是说 Agent 没有状态，而是说**任务的权威状态不能只存在于当前 Worker**。这样 Worker 才能水平扩容、重启和迁移，长任务也才能暂停后由另一台机器恢复。

### 1. 先把六类状态分开

| 状态类型 | 示例 | 主要用途 | 推荐存储 |
| --- | --- | --- | --- |
| 会话状态 | 消息、上下文摘要 | 多轮交互 | 关系数据库/对象存储 |
| 执行状态 | 当前节点、重试次数、等待原因 | 调度和恢复 | 关系数据库 |
| 检查点 | 状态图快照、已接受的模型结果 | 从确定位置继续 | 数据库加对象存储 |
| 工作空间 | 文件、补丁、构建产物 | 代码和文档处理 | 对象存储/持久卷 |
| 长期记忆 | 用户偏好、验证过的事实 | 跨会话复用 | 数据库/向量索引 |
| 副作用记录 | 工单号、提交哈希、幂等键 | 核对外部动作 | 关系数据库/审计存储 |

长期记忆与运行检查点尤其不能混为一谈。检查点追求可恢复和版本一致，通常跟随一次 `run` 生命周期；长期记忆需要来源、有效期、权限和纠错机制，可能跨越多个会话。

### 2. 用任务事实驱动执行

一个最小任务模型可以包含：

```text
agent_run
  id, tenant_id, user_id, agent_id, agent_version
  session_id, status, state_version, current_step
  checkpoint_ref, deadline_at, cancel_requested_at

run_attempt
  id, run_id, worker_id, lease_token, fencing_token
  started_at, heartbeat_at, ended_at

tool_invocation
  id, run_id, attempt_id, step_id, tool_name
  idempotency_key, status, external_operation_id
  request_ref, response_ref
```

Worker 领取任务时获得有期限的租约，并持续发送心跳。租约过期后，新 Worker 可以接管任务。但旧 Worker 可能只是网络中断，仍在后台继续执行，因此还需要单调递增的 fencing token。数据库拒绝持有旧 token 的写入，防止两个执行者同时推进任务。

### 3. Checkpoint 解决“从哪里继续”

LangGraph 的持久化设计把每个 thread 的状态保存为 Checkpoint，从而支持记忆、人工介入和故障恢复。[2] 对云端平台而言，检查点至少应记录 Agent 与工作流版本、已完成节点、下一步节点、已接受的模型输出、工具结果引用、等待事件和状态 Schema 版本。

保存频率要在恢复粒度、写入成本和数据敏感性之间权衡。每个 Token 都持久化没有必要，但只在任务结束时保存又失去了恢复价值。通常应在模型调用完成、工具结果确认、进入等待状态等边界生成检查点。

### 4. Checkpoint 不解决外部副作用

考虑这样的时序：Agent 调用工单系统成功创建工单，工单系统返回了结果，但 Worker 在保存检查点前崩溃。接管者看到的仍然是“工具调用中”。

直接重试可能创建重复工单，直接跳过又可能漏掉未成功的操作。Checkpoint 只能说明本地确认到了哪里，不能让跨系统调用自动获得事务语义。

有副作用的动作需要独立协议：

1. 调用前生成稳定的 `idempotency_key` 并记录调用意图。
2. 相同业务动作的重试始终使用同一个幂等键。
3. 目标系统用唯一约束返回第一次执行的结果。
4. 若不支持幂等，Gateway 先按业务标识查询结果。
5. 仍然无法判断时，任务进入“结果待核对”，停止自动重试。

```text
工具执行前失败       → 根据检查点重试
工具明确返回失败     → 按错误类型重试或终止
工具成功且结果落库   → 继续下一步
工具结果未知         → 用幂等键查询，不能盲目重试
```

平台可以追求“任务至少会被接管并继续”，但不能仅凭数据库检查点就宣称跨系统副作用具有 Exactly Once。

### 5. 不同存储各司其职

状态外移不等于把所有东西写进一张 JSONB 表。关系数据库保存任务事实、状态迁移、版本、授权记录和副作用账本；对象存储保存文件、产物和大型工具输出；Redis 保存可丢失缓存、短期流事件和限流计数；消息队列负责任务派发与异步事件；向量索引服务于可检索记忆，但不作为权威任务状态。

队列中的消息是“有工作需要处理”的通知，数据库中的记录才是任务事实。消息重复投递时，Worker 通过状态版本和幂等规则判断是否仍需执行；消息丢失时，调度器可以从数据库扫描待执行任务重新投递。

## 六、核心问题三：MCP Gateway 不只是反向代理

本地 Agent 常常直接启动 MCP Server，或者携带 Token 连接远程 MCP Server。单用户环境中，Host、用户和凭证属于同一个信任域。多用户云端环境则不同：Runtime 服务不同租户，Sandbox 执行不可信代码，远程 MCP Server 也未必由平台控制。

如果把用户的 GitHub Token、数据库密码或 OAuth Token 注入 Worker，会出现四个风险：

- Token 进入模型上下文、工具参数、日志或 Checkpoint；
- Sandbox 中的代码读取环境变量并向外传输；
- 每个 MCP Server 重复实现认证、刷新、限流和审计；
- 用户撤权后，已下发的长期令牌仍可继续使用。

### 1. 把 Gateway 放到 Agent 与工具之间

```text
Agent Runtime
     │ tool + arguments + run identity
     ▼
┌─────────────────────────────────────┐
│ MCP Gateway                         │
│ 验证身份 → 检查策略 → 必要时审批     │
│ 取得凭证 → 调用 Server → 过滤与审计   │
└──────────────────┬──────────────────┘
                   ▼
       MCP Server / SaaS / Internal API
```

Gateway 至少承担五类职责：

| 职责 | 具体能力 |
| --- | --- |
| 连接治理 | Server 注册、发现、健康检查、协议版本和能力缓存 |
| 身份授权 | 最终用户识别、RBAC/ABAC、工具与资源级策略 |
| 凭证托管 | OAuth、Secret 引用、刷新、轮换、撤销和短期换取 |
| 流量治理 | 超时、重试、熔断、并发限制、租户配额 |
| 安全审计 | 参数校验、数据脱敏、审批、Trace 和操作证据 |

这使 MCP Gateway 同时成为 Policy Enforcement Point 和 Credential Broker，而不只是转发 JSON-RPC 的代理。

### 2. Agent 只拿凭证引用

推荐的凭证路径是：用户完成 OAuth 授权，Credential Service 保存加密后的授权材料，数据库只保留 `credential_ref` 和授权元数据。Agent 发起工具调用时携带用户与运行身份，Gateway 校验后为明确的目标受众换取短期 Token，并代表用户调用目标服务。

Token 不应进入 Agent 上下文、Checkpoint、日志和 Sandbox 环境。

MCP 官方授权规范以 OAuth 2.1 为基础，并强调 Token Audience 校验、授权码保护、Refresh Token 轮换、Confused Deputy 和 Open Redirect 等问题。[3][4] 对平台而言，最重要的结论是：上游身份、Gateway 身份和目标服务 Token 不能混成一个万能令牌。

尤其要避免 Token Passthrough。一个发给 MCP Server A 的 Token，不应未经验证就传给内部服务 B。Gateway 应为明确的目标受众换取 Token，并校验作用域与有效期。

### 3. 工具发现本身也需要授权

很多系统只在 `tools/call` 时检查权限，却把完整工具清单暴露给所有 Agent。实际上，工具名称、参数 Schema、资源结构和描述文本都可能泄露内部能力，也可能通过恶意描述影响模型决策。

Gateway 应根据租户、用户、Agent 版本和环境动态过滤工具列表。一个只读分析 Agent 不应看到“删除仓库”工具；测试环境 Agent 也不应发现生产数据库写入能力。

模型输出的工具名和参数只能被视为请求，不能被视为授权。一次调用应依次完成 Schema 校验、运行身份校验、Agent 能力校验、资源权限校验、数据策略检查、风险分级、审批校验和凭证换取。

审批还要绑定工具、关键参数、目标资源和有效期。用户批准“向测试群发送摘要”，不能被复用为“向全员群发送原始客户数据”。

## 七、Agent 平台应该提供哪些通用能力

当隔离、状态和工具访问被抽出来后，会出现一组所有 Agent 都需要的公共能力。平台的价值，是让业务团队复用这些机制，而不是各自实现一套不一致的认证、恢复和审计逻辑。

### 1. 身份与策略中心

统一租户、用户、服务和 Agent 身份，支持 RBAC、ABAC 和资源级权限；在入口、任务、Worker、Sandbox 与工具之间传递身份；管理临时授权、人工批准和权限撤销。

### 2. Agent Registry 与发布系统

一个可运行的 Agent 版本不只有代码，还包括系统提示词、工作流、工具集、模型配置、状态 Schema 和策略要求。平台需要把这些内容固化为不可变版本，并支持灰度、回滚与兼容性检查。

任务创建后应绑定具体版本。等待审批两天的旧任务恢复时，不能悄悄切到改变行为的新提示词和新工具集，除非执行了明确迁移。

### 3. 模型网关

模型网关统一供应商适配、路由、配额、限流、成本和数据策略，并记录实际模型版本、采样参数、输入输出引用和 Token 用量。模型降级不能只按“接口可用”判断，还要评估结构化输出、工具选择和上下文长度是否满足任务要求。

### 4. 可靠任务执行

Task Service 保存任务事实和状态机，Scheduler 处理优先级、租户公平性与能力匹配，Worker 使用租约、心跳和 fencing token，Checkpoint 支持暂停与恢复，副作用账本处理外部操作，超时、取消、死信和补偿拥有明确语义。

### 5. Sandbox 与 Workspace 服务

平台集中维护运行镜像、资源规格、网络策略、依赖缓存和安全补丁。业务 Agent 声明所需能力，而不是直接获得集群管理员权限。Workspace 服务管理输入、临时文件和产物，并记录租户、任务、来源、敏感级别与保留期限。

### 6. MCP Gateway 与能力目录

能力目录不仅记录工具名和参数，还应记录版本、所有者、风险等级、幂等条件、超时语义和数据分类。平台必须知道“调用超时能否重试”“成功后如何核对”“是否产生不可逆副作用”。

### 7. 可观测性与审计

一次任务需要一条贯穿入口、模型、Worker、Sandbox、Gateway 和外部系统的 Trace。平台应能回答哪个用户通过哪个 Agent 版本发起任务、平台依据哪条策略放行工具、外部系统产生了什么结果，以及本次运行消耗了多少 Token、计算资源和时间。

运行日志、模型轨迹和审计证据不是同一种数据。运行日志服务于排障；审计记录服务于责任追溯，需要更强完整性；模型上下文可能包含敏感信息，不能因为“可观测性”而默认完整落盘。

### 8. Guardrails、评测与成本治理

Guardrails 负责输入检查、Prompt Injection 防护、敏感数据检测、工具参数约束和输出过滤。它不能代替权限系统，但可以在权限允许范围内减少错误与滥用。

评测系统把 Agent 版本、测试集、运行轨迹和业务结果关联起来，支持离线回归、线上抽样与安全越权测试。成本系统按租户、用户、Agent 和任务统计模型、沙箱、存储与工具成本，并执行预算和并发配额。

Google Cloud 的 Agent Gateway 将身份、访问策略和审计作为连接 Agent、工具与 MCP Server 的治理能力；AWS 的 Agentic AI 治理指南也把身份、授权、监控和策略执行放在 Agent 层讨论。[5][6] 共同方向是把“模型能提出什么”与“系统允许执行什么”分离。

## 八、平台边界：公共能力不等于吞掉业务逻辑

平台化容易走向两个极端：一种是只提供容器和数据库，让每个团队重复建设；另一种是试图把所有工作流和业务规则收进一个超级平台。

更合适的边界是：平台负责跨 Agent 复用且需要统一治理的机制，业务应用负责领域语义和结果责任。

| 平台负责 | 业务 Agent 负责 |
| --- | --- |
| 身份传播和权限执行 | 定义业务角色与资源含义 |
| 任务状态、调度和恢复机制 | 定义业务步骤与完成标准 |
| Sandbox 和 Workspace 安全 | 声明所需运行环境和依赖 |
| MCP 接入、凭证和审计 | 定义工具语义和业务补偿 |
| 模型路由、配额和观测 | 设计上下文、提示词和推理策略 |
| 评测框架与发布门禁 | 提供领域测试集与质量标准 |

例如，平台可以保证一次采购工具调用具有身份、幂等键和审计记录，但“超过五万元需要二级审批”“供应商被暂停后不得下单”仍然是采购业务规则。平台提供执行机制，业务系统保留权威判断。

## 九、渐进迁移：不要一开始就建设完整 Agent OS

从本地产品迁移到多用户云端，适合逐层替换。每个阶段都应产生一个可验证的系统，而不是先建设半年平台再接入第一个 Agent。

### 阶段一：完成能力解耦

为 Workspace、Execution、State 和 Tool Access 定义接口，引入显式 `RunContext`，清除 Agent Core 对绝对路径、全局环境变量和本地 SQLite 的依赖。本地实现继续可用，先用契约测试验证行为一致。

### 阶段二：实现单用户远程运行

把 Runtime 部署为远程 Worker，文件迁移到对象存储或受控持久卷，任务和会话进入数据库，并建立基础流式输出与取消机制。此时先验证远程执行链路，不急于开放多租户。

### 阶段三：让任务可恢复

引入状态机、队列、租约和 Checkpoint；为工具调用生成幂等键；区分可重试失败、不可重试失败和结果未知；支持等待人工审批时释放资源。通过在模型调用、工具调用和状态提交的不同位置强制终止 Worker，验证恢复语义。

### 阶段四：实现多租户隔离

全链路传播租户身份；数据库、缓存、对象存储和日志实施租户边界；不可信执行进入独立 Sandbox；默认拒绝网络；增加资源配额和公平调度。自动化越权测试应覆盖数据、文件、缓存、工具和日志。

### 阶段五：上线 MCP Gateway

用户凭证迁移到 Credential Service；Runtime 只持有短期运行身份和 `credential_ref`；工具发现、授权、审批和审计统一进入 Gateway；禁止 Sandbox 直接访问受保护业务系统。

验收时应确认 Token 不出现在模型输入、Checkpoint、日志和 Sandbox 环境中，用户撤权后新的工具调用立即被拒绝。

### 阶段六：形成平台能力

建立 Agent Registry、版本和发布门禁，增加模型网关、统一 Trace、评测与成本体系，并按业务重要性定义 SLO、容灾和数据保留策略。新 Agent 应能直接复用身份、任务、沙箱、Gateway 与观测能力。

## 十、七个常见误区

### 误区一：所有表增加 `user_id` 就实现了多租户

数据库只是隔离的一层。对象存储、缓存、向量索引、文件系统、日志、队列和工具凭证都可能造成跨租户泄露。

### 误区二：容器就是沙箱

隔离强度取决于代码可信度、内核边界、权限、网络和生命周期。一个以特权模式运行并挂载 Docker Socket 的容器，几乎没有提供所需边界。

### 误区三：状态外移后，Agent 就天然可靠

数据库能保存进度，不能自动解决重复副作用、并发接管、版本迁移和外部结果未知。可靠性来自明确的状态机、租约、幂等和核对协议。

### 误区四：Checkpoint 等于事务

Checkpoint 只描述 Agent 确认的本地进度。跨数据库、SaaS 和人工流程的动作仍需要业务幂等、补偿或人工核对。

### 误区五：给每个 Sandbox 注入用户 Token 最简单

这确实最简单，也最容易泄露。Sandbox 应持有短期运行身份，由 Gateway 代取目标凭证。凭证明文不应进入模型可见环境。

### 误区六：MCP Gateway 只需转发协议

如果没有工具级授权、Audience 校验、凭证代理、审批和审计，Gateway 只是增加了一跳网络，并没有建立新的安全边界。

### 误区七：先建设一个包罗万象的平台

没有真实 Agent 接入的平台很容易抽象错误。更有效的方式是从第一个产品的明确问题出发，只抽取第二个、第三个 Agent 确实会复用的能力。

## 十一、上线前检查清单

### 身份与隔离

- 每次数据库、对象存储和工具访问是否都能追溯到租户、用户和运行？
- 是否存在缺少租户条件的旁路查询？
- 沙箱是否默认禁止访问宿主机、云元数据和平台内网？
- 复用环境前，是否能证明前一用户的数据和进程已清理？

### 状态与恢复

- Worker 被强制终止后，任务是否能由其他 Worker 接管？
- 旧 Worker 恢复网络后，是否会继续写入过期结果？
- 每个外部写操作是否有幂等键、结果查询或补偿方案？
- Agent 升级后，旧 Checkpoint 由谁恢复，如何迁移？

### 凭证与工具

- 长期 Token 是否可能进入模型输入、日志、Checkpoint 或 Sandbox？
- Token 是否绑定正确的目标受众、作用域和有效期？
- 工具列表是否按用户和 Agent 动态过滤？
- 高风险调用的审批是否绑定具体参数和资源？
- 用户撤权后，Gateway 能否立即停止新调用？

### 平台运行

- 是否可以按租户限制模型 Token、并发任务和 Sandbox 资源？
- 是否能从一次用户请求追踪到模型、工具和外部结果？
- 队列重复投递和消息丢失时，任务是否仍能收敛到正确状态？
- 控制面故障时，哪些任务可以继续，哪些操作必须失败关闭？

## 十二、结语：真正要搬上云的是边界

本地 Agent 的便利，来自同一台机器上的身份、文件、进程、状态和凭证都默认属于同一个人。多用户云端 Agent 的困难，则来自这些默认关系全部失效。

因此，本地 Agent 上云的主线不是“容器化、加 API、上 Kubernetes”，而是重新建立四组明确关系：

1. **谁在执行：** 用租户、用户、Agent 和运行身份建立责任边界；
2. **在哪里执行：** 用 Workspace、Sandbox 和网络策略建立资源边界；
3. **执行到哪里：** 用数据库、Checkpoint、租约和副作用账本建立恢复边界；
4. **能调用什么：** 用 MCP Gateway、凭证代理和策略系统建立权限边界。

完成这些改造后，Agent Runtime 反而可以变得更轻：它负责理解目标、组织上下文、选择模型和提出动作；平台负责让动作在正确的身份、状态、资源和权限约束下执行。

这才是从“一个能在本机完成任务的 Agent”，走向“一个能够被多人长期使用和治理的云端 Agent 应用”的关键变化。

## 参考资料

[1] Docker Docs, [Agent Sandboxes: Isolation](https://docs.docker.com/ai/sandboxes/security/isolation/)

[2] LangGraph Docs, [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

[3] Model Context Protocol, [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

[4] Model Context Protocol, [Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)

[5] Google Cloud, [Agent Gateway overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview)

[6] AWS Prescriptive Guidance, [Govern the agents layer](https://docs.aws.amazon.com/prescriptive-guidance/latest/govern-architect-agentic-ai/agents-layer.html)

[7] Microsoft Azure Architecture Center, [Architectural considerations for multitenant agentic systems](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/agentic-systems)

[8] Kubernetes SIGs, [Agent Sandbox](https://agent-sandbox.sigs.k8s.io/docs/)
