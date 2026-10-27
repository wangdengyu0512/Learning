---
title: 数字员工执行实例如何扩缩容：从容量模型到安全缩容
description: 面向长任务、工具调用和有状态会话，设计以任务压力和业务 SLO 为核心的数字员工执行实例弹性伸缩机制。
date: 2026-10-27
tags: 数字员工, 智能体, 弹性伸缩, 架构设计
featured: false
---

企业开始批量部署数字员工后，很快会遇到一个看似熟悉、实际不同的问题：执行实例到底应该开多少个？实例太少，任务长期排队；实例太多，浏览器、沙箱、模型额度和计算资源持续空转。更棘手的是，数字员工执行的通常不是几十毫秒结束的无状态请求，而是包含模型推理、工具调用、外部等待、人工审批和业务写入的长流程。直接增加 Pod 也许能扩容，直接删除 Pod 却可能中断任务、重复创建业务数据，甚至让两个实例同时认为自己拥有执行权。

因此，数字员工的弹性伸缩不能简化为“CPU 高了扩容，CPU 低了缩容”。它需要同时回答四个问题：

1. 什么对象需要扩缩容，是数字岗位、任务、Worker、沙箱还是并发槽位？
2. 什么指标能够反映真实执行压力，是 CPU、任务数、工作量还是等待时间？
3. 扩容后新增实例何时才算形成有效容量？
4. 缩容时如何证明任务可以安全离开原实例？

本文给出一套面向企业数字员工平台的工程方案。核心判断是：

> 数字员工扩缩容的本质，是根据任务到达速度、剩余工作量、有效执行槽位和服务目标动态调整执行容量。扩容主要解决吞吐与等待问题，缩容则必须建立在状态外置、租约、幂等、检查点和排空协议之上。

## 一、先明确扩缩容对象

### 1. 岗位、任务、实例和槽位不是一回事

数字员工平台通常同时存在以下对象：

| 对象 | 含义 | 是否直接扩缩容 |
|---|---|---|
| 数字岗位定义 | 长期有效的职责、知识、技能、权限和交付标准 | 否 |
| 任务实例 | 一次具体业务目标及其状态 | 否，由队列和运行框架管理 |
| 执行步骤 | 已满足依赖、等待获得资源的一段工作 | 是扩缩容的需求来源 |
| 执行尝试 | 某一步骤在某个执行实例上的一次尝试 | 否，但需要租约保护 |
| 执行实例 | 承载 Runtime、工具客户端或沙箱的进程、容器或虚拟机 | 是 |
| 并发槽位 | 一个执行实例同时可以安全处理的工作数量 | 是容量的最小计量单位 |
| 执行实例池 | 运行环境、能力、资源规格和恢复语义相同的一组实例 | 是扩缩容策略的作用范围 |

相同数字岗位可以同时处理多个任务，一个任务也可能包含多个可并行步骤。真正需要调整的不是“数字员工人数”，而是某一类执行实例池提供的有效槽位数量。

例如，资料分析数字员工可能使用三个资源池：

- `analysis-worker`：负责规划、模型调用和文本处理，每实例提供 4 个并发槽位。
- `browser-worker`：负责浏览器自动化，每实例只能稳定运行 1 个会话。
- `document-worker`：负责文件解析和转换，每实例提供 2 个并发槽位。

当浏览器任务积压时，只扩 `analysis-worker` 不会解决问题。平台必须先把任务转换为能力需求，再找到瓶颈资源池，最后对该实例池伸缩。

### 2. 扩缩容控制器的职责边界

建议将职责拆成五层：

| 层次 | 负责什么 | 不负责什么 |
|---|---|---|
| 运行框架 | 维护任务图、步骤状态、检查点、质量门禁和业务恢复 | 不直接决定 Pod 数量 |
| 调度器 | 将已就绪步骤分配给匹配的实例池和执行槽位 | 不决定业务步骤是否应该执行 |
| 实例池控制器 | 计算期望实例数，执行预热、扩容、排空和回收 | 不判断外部业务操作是否成功 |
| 集群调度与节点伸缩 | 为实例提供节点资源，处理装箱和节点容量 | 不理解数字员工任务语义 |
| 下游容量控制 | 管理模型、工具、账号和业务接口配额 | 不因 Worker 增多而自动扩大 |

实例池控制器接收的是运行压力和容量状态，不应越过运行框架修改任务计划。缩容过程中如果发现某一步不可中断，也应把任务交还运行框架决定等待、检查点恢复、补偿或人工介入，而不是由 Kubernetes 删除策略替业务作决定。

## 二、数字员工负载为什么不同于普通 Web 请求

### 1. CPU 低不代表没有压力

数字员工执行中存在大量等待：等待模型返回、等待网页加载、等待业务接口、等待文件上传、等待人工审批。此时实例可能占有任务和会话，但 CPU 使用率很低。如果只看 CPU，控制器会在队列正在增长时拒绝扩容，或者误判实例空闲而开始缩容。

反过来，CPU 较高也不一定应该继续扩容。如果模型供应商已经达到每分钟 Token 上限，继续增加 Worker 只会制造更多限流和重试；如果浏览器账号池只有 20 个账号，扩到 50 个实例也只能有 20 个真正执行。

因此，资源利用率只能描述“实例内部是否繁忙”，不能单独描述“系统是否还有未被满足的工作”。数字员工扩缩容必须把队列、执行槽位、任务等待时间和下游约束组合起来。

### 2. 任务工作量差异很大

两个任务都记为一条队列消息，但成本可能相差几十倍：

- 一次知识检索可能只需要一个短模型调用。
- 一次合同审查可能包含文档解析、多轮检索、多个模型调用和结果校验。
- 一次浏览器采集可能打开数十个页面并等待动态内容。
- 一次业务办理可能在中途等待审批数小时。

若扩缩容只统计消息数量，一个重任务和一个轻任务会被认为容量需求相同。更可靠的方法是给步骤标注或在线估算 `work_units`，例如综合预计运行时间、模型 Token、工具调用次数、内存规格和是否独占资源。没有历史数据时可以从任务类型的静态权重开始，积累轨迹后再校准。

### 3. 端到端完成时间由多个阶段共同决定

Agentix 将 Agent 看成由多个相关调用组成的程序，并指出单次请求调度不能充分优化程序的端到端等待。[1] 对数字员工同样如此：用户关心的是整项工作何时完成，而不是某一次模型请求有多快。

因此，扩缩容指标需要保留任务和步骤层级：

- `queue_wait_seconds`：步骤从就绪到获得槽位的时间。
- `oldest_ready_age_seconds`：当前最老就绪步骤的等待时间。
- `task_end_to_end_seconds`：任务从创建到满足交付条件的时间。
- `step_service_seconds`：步骤真正占用执行槽位的时间。
- `external_wait_seconds`：等待审批、定时器或外部事件的时间。

等待审批的任务仍然存在，但不应持续占用计算槽位；等待模型响应的步骤仍占用并发预算，却未必消耗很多 CPU。将这些状态分开，扩缩容才不会被“任务仍未完成”和“当前需要计算资源”之间的差异误导。

## 三、先按运行特征拆分实例池

不同负载共享一个实例池，通常会导致伸缩信号失真和资源相互干扰。建议至少按运行环境、资源规格、执行时长和恢复语义拆分。

| 负载类型 | 典型任务 | 建议实例模式 | 主要伸缩信号 | 缩容到零 |
|---|---|---|---|---|
| 在线交互型 | 对话分析、即时查询 | 常驻 Worker 池 | 排队时间、可用槽位、到达率 | 谨慎 |
| 异步短任务 | 分类、摘要、批量抽取 | 队列 Worker 池 | 待处理工作量、最老任务年龄 | 可以 |
| 长流程型 | 报告生成、跨系统业务办理 | 状态外置 Worker 池 | 就绪步骤、槽位利用率 | 有条件 |
| 资源独占型 | RPA 桌面、浏览器、专属账号 | 专属资源池 | 等待任务数、可用账号或会话 | 有条件 |
| 一任务一环境 | 不可信代码、强隔离处理 | Job 或沙箱实例 | 可启动任务数 | 可以 |
| 周期批处理 | 日报、月末核对 | Worker 或 Job | 计划负载、积压清空时间 | 可以 |

拆池时不要只按业务部门分组。两个部门使用相同镜像、相同工具和相同恢复语义时，可以共享受配额控制的资源池；同一部门的浏览器任务与纯文本任务则通常应分池。合理的边界是：**池内实例可以互换，任务能够在任意健康实例上恢复，池内使用同一组容量指标和缩容协议。**

## 四、总体架构：两个控制循环、三层容量

### 1. 任务执行主链路

```text
用户请求 / 业务事件 / 定时计划
              │
              ▼
       运行框架生成就绪步骤
              │
              ▼
       持久化队列与优先级调度
              │
              ▼
   执行实例池 ── 模型 / 工具 / 业务系统
              │
              ▼
      检查点、产物与操作账本

队列与实例指标 → 实例池控制器 → 期望实例数
Pod Pending 状态 → 节点伸缩器 → 期望节点数
```

任务执行和容量控制应是两个松耦合控制循环。任务循环关注步骤能否推进和结果是否有效；容量循环关注有多少就绪工作、现有实例可以提供多少有效槽位，以及新增容量多久能够生效。两者通过队列、租约、状态事件和指标连接。

### 2. 三层容量不能混为一个数字

建议分别记录：

1. **声明容量**：根据副本数与每实例槽位配置计算出的理论容量。
2. **就绪容量**：完成镜像启动、配置加载、凭证获取和依赖检查的槽位。
3. **有效容量**：扣除 Draining、故障、下游配额限制和资源争用后，真正可以领取任务的槽位。

例如，10 个实例每个配置 4 个槽位，声明容量是 40；其中 2 个尚未 Ready，2 个正在排空，就绪容量只有 24；模型网关当前只允许 16 个并发调用，则模型密集型任务的有效容量最多是 16。控制器若始终用 40 计算，就会低估压力。

### 3. 实例伸缩与节点伸缩是两级过程

实例控制器先创建 Pod，集群资源不足时 Pod 进入 Pending，节点伸缩器再增加节点。因此一次扩容的端到端时间至少包含：

```text
指标采集延迟
+ 控制器决策延迟
+ Pod 创建与调度延迟
+ 节点供给延迟（如果需要）
+ 镜像拉取与容器启动
+ Runtime、Skill、浏览器和连接预热
+ Readiness 生效延迟
```

扩容策略必须使用这个总时间，而不能只测容器进程启动耗时。Dirigent 的研究表明，在高频创建沙箱时，通用集群控制面的调度路径本身也可能成为启动延迟的重要部分。[2] 如果数字员工实例启动需要数分钟，纯反应式扩容很难保护秒级或分钟级 SLO，需要常驻容量、预热池或预测性扩容。

## 五、扩缩容指标：业务压力优先，资源指标兜底

### 1. 指标分层

**需求指标**描述有多少工作需要执行：

- `ready_steps`：已满足依赖且等待执行的步骤数。
- `pending_work_units`：待处理步骤的工作量之和。
- `arrival_work_units_per_second`：单位时间新到达工作量。
- `oldest_ready_age_seconds`：最老就绪步骤年龄。
- `deadline_risk_steps`：按当前容量预计会错过截止时间的步骤数。

**供给指标**描述实例池能够处理多少工作：

- `ready_instances`、`starting_instances`、`draining_instances`。
- `total_slots`、`occupied_slots`、`available_slots`。
- `service_rate_per_instance`：单实例单位时间完成的工作量。
- `startup_seconds`：实例从创建到可领取任务的时间。
- `drain_seconds`：实例从停止接单到安全退出的时间。

**结果指标**描述当前服务目标是否满足：排队时间和完成时间分位数、超时率、拒绝率、积压增长率，以及扩容后恢复到目标等待时间所需时长。

**约束指标**包括模型请求与 Token 配额、第三方接口 QPS、数据库连接、账号与许可证数量、租户预算和节点配额。

### 2. 为什么最老任务年龄很重要

队列深度相同，风险可能完全不同。100 个任务刚在一秒内到达，系统也许可以很快消化；10 个任务已经等待 20 分钟，则说明存在容量不足、调度饥饿或任务无法匹配资源。`oldest_ready_age_seconds` 能直接暴露这种问题。

但它不能单独使用。一个不可调度任务可能因缺少专属账号长期滞留，并持续触发通用 Worker 扩容。指标需要按实例池、任务类型、优先级和不可调度原因分组。无法通过增加该实例池解决的任务，应进入容量阻塞告警，而不是参与副本计算。

### 3. 使用工作量而不是只数任务

可以先为每类步骤定义基础权重：

```text
work_units =
    expected_runtime_seconds
  × resource_weight
  × exclusivity_weight
```

生产运行后，再根据实际完成轨迹更新任务类型的 P50、P90 处理时长。对于长尾明显的任务，容量规划应优先使用分位数或分桶模型，避免平均值掩盖少量超长任务。

## 六、容量模型：把压力换算成期望实例数

容量模型不需要一开始就很复杂，但必须能够解释“为什么从 8 个实例扩到 14 个”。建议至少同时计算到达率、积压、槽位和资源保护四类需求，然后取最大值。

### 1. 持续到达容量

对于同一任务类型，定义 `lambda` 为每秒到达任务数，`W` 为每个任务平均占用槽位的服务时间，`c` 为每实例并发槽位，`u_target` 为目标槽位利用率，则：

```text
N_rate = ceil(lambda × W / (c × u_target))
```

保留利用率余量，是为了吸收随机波动、任务长尾和实例故障。目标利用率设为 1，意味着任何抖动都会直接转化为排队。

混合任务可以先换算成标准任务当量再使用该公式；如果指标直接统计“每秒到达多少槽位秒”，则分子已经包含服务时间，不应再次乘以 `W`。

### 2. 积压清空容量

定义 `B` 为当前积压工作量，`T_drain` 为希望清空积压的时间，`mu_instance` 为单实例每秒可完成工作量：

```text
N_backlog = ceil(B / (T_drain × mu_instance))
N_queue = N_rate + N_backlog
```

二者需要相加，因为清理旧积压时仍有新任务到达。

### 3. 槽位与启动提前量

```text
N_slot = ceil(active_steps / (c × u_target))
B_projected = current_backlog + lambda_forecast × T_startup
```

`active_steps` 只统计真正占用该实例池槽位的步骤。等待审批、定时器和外部回调的任务应释放槽位。`T_startup` 是实例从创建到业务 Ready 的时间，启动越慢，越需要预测、预热和安全余量。

Serverless 生产负载研究显示，不同函数调用频率跨度很大，统一保活策略通常无法同时兼顾冷启动与成本。[3] 数字员工实例池也应按热度和启动代价设置不同的最小副本与保活时间。

### 4. 最终副本数

```text
N_raw = max(N_queue, N_slot, N_resource_guard)

N_desired = clamp(
  apply_downstream_limit(N_raw),
  min_replicas,
  max_replicas
)
```

`apply_downstream_limit` 不只是截断数字。例如模型网关剩余并发为 40，每实例最多发起 4 个模型调用，则模型密集型池最多只需要 10 个有效实例。超过部分应通过入口限流、优先级和背压处理，而不是继续扩容。

### 5. 一个计算示例

某异步分析实例池的到达率为每秒 1.2 个标准工作量，一个工作量平均占用槽位 8 秒，每实例有 2 个槽位，目标利用率为 0.7。当前积压 180 个工作量，希望 5 分钟清空，单实例吞吐约为每秒 0.25 个工作量：

```text
N_rate = ceil(1.2 × 8 / (2 × 0.7)) = 7
N_backlog = ceil(180 / (300 × 0.25)) = 3
N_queue = 7 + 3 = 10
```

若当前运行 6 个实例，控制器可将期望值调整到 10。实际策略还要考虑一次最大扩容比例、实例启动时间、下游配额和最近扩容尚未生效的实例，避免在指标反馈到来前重复追加。

## 七、扩容：新增副本不等于新增有效容量

### 1. 从零激活与普通扩容分开

从零到一需要解决事件发现和冷启动，正常副本范围内扩容则主要解决吞吐。两者应使用不同阈值：

- `activation_threshold`：是否需要唤醒实例池。
- `scale_threshold`：每个实例期望承载多少工作量。
- `idle_timeout`：最后一项可执行工作结束后多久允许归零。

低频、可延迟任务可以缩容到零；交互式、关键业务或启动时间较长的实例池应保留最小副本。对外承诺 5 秒响应，却让实例冷启动 90 秒，是配置逻辑冲突，不是控制器调参问题。

### 2. 快扩慢缩

扩容过快主要带来短期成本和下游压力；缩容过快可能中断任务并造成业务副作用。因此通常采用：

- 扩容观察窗口短，允许按比例或固定数量快速增加。
- 缩容观察窗口长，连续多个周期低负载后才减少。
- 最老任务年龄超过 SLO 时允许紧急扩容。
- 刚启动的实例设置最短存活时间。
- 将 `Starting` 实例计入在途容量，避免控制器反复追加。

Kubernetes HPA 支持分别设置扩容和缩容的稳定窗口与变化策略；KEDA 可以使用队列、Prometheus 等外部事件源驱动工作负载，并处理缩容到零的激活边界。[4][5]

Jiagu 提出的双阶段伸缩也说明，频繁、轻量的容量调整和代价较高的实例变化可以分层处理，从而降低反复冷启动的成本。[12] 在数字员工实例池中，可以先调节进程内槽位或热沙箱数量，再按较慢周期调整 Pod 和节点数量。

### 3. Readiness 必须表达业务就绪

进程启动成功不能代表可以领取任务。数字员工实例至少应完成配置与能力包加载、凭证初始化、模型和工具连接检查、浏览器或沙箱预热，并向调度器注册能力版本和槽位数。

只有这些步骤完成，实例才进入 `Ready`。启动探针用于给初始化留出时间，Readiness 控制能否接受工作，Liveness 只判断进程是否失去推进能力。不要用 Liveness 检测临时下游故障，否则下游抖动会触发大量实例重启，进一步放大压力。

### 4. 预热和预测性扩容

月末、早高峰、日报和预约批处理适合预扩容。较稳妥的方式是让预测结果提前建立部分容量，实时队列和等待时间继续负责纠偏。预测不应替代反馈控制。

## 八、缩容：先撤销执行资格，再回收计算资源

### 1. 实例生命周期

```text
Pending → Starting → Ready → Busy → Draining → Terminated
                         ↘ Unhealthy
```

- `Starting`：尚未形成有效容量。
- `Ready`：可领取新任务。
- `Busy`：至少一个槽位被占用。
- `Draining`：禁止领取新任务，只允许完成、检查点或移交在途工作。
- `Unhealthy`：无法保证继续执行，需要撤销租约并恢复任务。

缩容对象应先转为 `Draining`。直接删除 Busy Pod，相当于绕过数字员工运行协议。

### 2. 完整排空流程

一次可审计的缩容应包含以下步骤：

1. 实例池控制器选择候选实例，写入排空原因和截止时间。
2. 调度器将实例标记为 `Draining`，立即停止分配新步骤。
3. Readiness 变为失败，使普通流量不再进入该实例。
4. 实例上报当前执行尝试、租约、外部操作和可检查点位置。
5. 可快速完成的步骤在宽限期内完成并提交结果。
6. 可恢复步骤保存检查点、释放租约并重新入队。
7. 不可安全中断的步骤等待完成，或由运行框架转入人工处理。
8. 实例确认槽位为空、租约清零、缓冲数据已落盘后退出。

Kubernetes 的 `preStop` 与 `SIGTERM` 可以承接容器层终止通知，但终止宽限期从 `preStop` 开始前就已经计时，两者共享同一个时间预算。[6] 因此，`preStop` 更适合快速登记排空意图，真正的任务排空由进程的终止信号处理器和平台状态机协同完成。

### 3. 租约与 fencing token

任务被实例领取时，调度器应签发有版本的执行租约：

```text
lease = {
  task_id,
  step_id,
  attempt_id,
  owner_instance_id,
  lease_version,
  expires_at
}
```

实例定期续租，并在提交检查点、结果或外部操作状态时携带 `lease_version`。发生超时、故障接管或缩容移交后，平台提升版本并把执行权交给新实例。旧实例即使恢复网络，也无法用过期版本覆盖新结果。

租约解决的是“谁现在有权执行”，幂等解决的是“同一业务动作被重复请求会发生什么”。两者不能互相替代。

### 4. 检查点与外部副作用

| 类型 | 缩容处理 | 示例 |
|---|---|---|
| 可重算 | 放弃本次尝试，重新入队 | 无副作用的文本分析 |
| 可检查点 | 保存进度，从稳定位置恢复 | 多文档处理、分页采集 |
| 不可直接重放 | 完成、核实或人工处理 | 创建工单、付款、发送通知 |

Beldi 和 Netherite 的研究都说明，有状态工作流需要把进度与状态持久化，并为故障恢复建立明确的执行语义。[7][8] 对数字员工而言，外部写入尤其不能依赖“Pod 退出前应该来得及”。每个逻辑业务操作应有稳定的幂等键和操作账本，记录参数摘要、提交时间、外部回执和核实状态。

如果创建工单的请求超时，实例退出前不能简单把步骤标为失败并重新执行。正确状态应是“结果待核实”，新实例恢复后先查询外部系统或使用同一幂等键安全重试。Flux 对有状态 Serverless 应用幂等性的研究进一步说明，平台级重试只有在应用操作满足幂等条件时才对用户透明。[9]

### 5. 缩容截止时间

每个实例池需要定义最大排空时间。超过截止时间时按步骤类型处理：

- 可重算步骤撤销租约并重新入队。
- 可检查点步骤提交最近检查点，否则从上一个稳定检查点恢复。
- 不可重放步骤进入结果核实或人工处置队列。
- 超长且不可中断步骤迁入不参与常规缩容的长任务池。

节点突然故障时可能没有排空窗口，所以安全机制必须支持“实例没有机会执行退出钩子”的情况。`preStop` 是优化，不是正确性的基础。

## 九、根据执行模式选择伸缩实现

### 1. 常驻 Worker 池

推荐使用 `Deployment + HPA/KEDA ScaledObject`，适合高频异步任务、在线交互和需要复用连接的实例。一个实例可以拥有多个受控槽位，任务通过持久队列分配。

### 2. 一任务一实例

推荐使用 `Job` 或 `KEDA ScaledJob`，适合强隔离、资源边界清晰、可以在一个 Job 生命周期内完成的任务。高频任务会产生更大的控制面和冷启动开销；等待审批的长流程还要把等待状态从 Job 中剥离。

### 3. 请求驱动服务

对于短时、无状态或状态已外置的 HTTP 入口，可以使用 Knative Serving 等请求并发驱动服务。它适合处理请求到达与实例并发，但不自动解决长任务检查点、外部副作用和任务恢复。

### 4. 专属桌面与账号资源池

RPA、虚拟桌面、许可证软件和实名账号不能用通用 HPA 完整表达。其上限为：

```text
effective_max_instances = min(
  compute_quota,
  available_accounts,
  available_desktops,
  license_quota,
  downstream_concurrency
)
```

当瓶颈是账号而不是计算资源时，平台应展示“资源不可满足”，而不是不断创建无法执行的 Pod。

## 十、控制算法：把容量计算变成稳定控制循环

```text
every control_interval:
    metrics = read_metrics(pool, lookback_window)
    demand = exclude_unschedulable_work(metrics.pending_work)

    n_rate = replicas_for_arrival_rate(demand.arrival_rate)
    n_backlog = replicas_for_backlog(demand.backlog, drain_target)
    n_slot = replicas_for_active_slots(metrics.active_steps)

    raw_desired = max(n_rate + n_backlog, n_slot, resource_guard)
    bounded = apply_pool_limits(raw_desired, min_replicas, max_replicas)
    feasible = apply_downstream_and_tenant_limits(bounded)

    desired = apply_rate_limit_and_stabilization(feasible)

    if metrics.oldest_ready_age > emergency_threshold:
        desired = accelerate_scale_up(desired)

    active_supply = ready_replicas + starting_replicas

    if desired > active_supply:
        create_instances(desired - active_supply)

    if desired < ready_replicas:
        candidates = select_scale_in_candidates(
            idle_first,
            no_exclusive_resource,
            low_checkpoint_cost,
            minimum_lifetime_satisfied
        )
        begin_drain(candidates, current_replicas - desired)

    record_decision(metrics, raw_desired, desired, constraints)
```

需要特别注意：`Starting` 实例不是有效容量，但已经是正在交付的容量；缩容不是立刻改副本数，而是先形成排空候选；每次决策必须记录原始需求、约束后的结果和未执行原因。

## 十一、Kubernetes 与 KEDA 配置示例

以下配置展示控制思想，指标名称、认证和参数需要根据实际环境调整。

### 1. 使用工作量指标驱动实例池

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: analysis-worker
spec:
  scaleTargetRef:
    name: analysis-worker
  pollingInterval: 15
  cooldownPeriod: 600
  minReplicaCount: 1
  maxReplicaCount: 50
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 0
          selectPolicy: Max
          policies:
            - type: Percent
              value: 100
              periodSeconds: 60
            - type: Pods
              value: 8
              periodSeconds: 60
        scaleDown:
          stabilizationWindowSeconds: 600
          selectPolicy: Min
          policies:
            - type: Percent
              value: 20
              periodSeconds: 120
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        metricName: digital_employee_pending_work_units
        query: |
          sum(digital_employee_pending_work_units{pool="analysis-worker"})
        threshold: "8"
        activationThreshold: "1"
```

这里用 `pending_work_units` 而不是 CPU 作为主指标，扩容允许较快增长，缩容等待 10 分钟并限制变化比例。关键业务可以保留一个或多个最小副本；允许冷启动的低频池可设为 0。

KEDA/HPA 负责把指标转换为副本数，但它并不知道哪些实例可以安全删除。生产方案仍需要实例池控制器或 Worker 协议完成 Drain。

### 2. 为实例提供启动、就绪和终止协议

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: analysis-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: analysis-worker
  template:
    metadata:
      labels:
        app: analysis-worker
    spec:
      terminationGracePeriodSeconds: 900
      containers:
        - name: worker
          image: example.com/digital-worker:1.0.0
          ports:
            - name: management
              containerPort: 8081
          startupProbe:
            httpGet:
              path: /health/startup
              port: management
            periodSeconds: 5
            failureThreshold: 60
          readinessProbe:
            httpGet:
              path: /health/ready
              port: management
            periodSeconds: 5
            failureThreshold: 1
          livenessProbe:
            httpGet:
              path: /health/live
              port: management
            periodSeconds: 15
            failureThreshold: 3
          lifecycle:
            preStop:
              httpGet:
                path: /lifecycle/begin-drain
                port: management
```

`/lifecycle/begin-drain` 应快速、幂等地将实例改为 Draining、停止领取任务，并让 Readiness 返回失败。进程收到 `SIGTERM` 后等待在途步骤按策略结束，剩余时间不足时提交检查点或释放租约。900 秒只是示例，实际值应依据任务时长分布和恢复能力确定。

PodDisruptionBudget 可以减少节点维护等自愿中断同时影响的副本数，但不能替代 Worker 排空协议，也不是所有缩容场景的安全保证。

## 十二、多租户、优先级与成本边界

共享实例池需要每租户最小保障槽位、最大并发、加权公平队列、高优任务预留容量和等待时间老化。自动扩容只能增加总容量，不能自动保证公平。

每个实例池还应配置最大实例数、计算预算、模型 Token 预算、单任务最大工作量和超预算策略。达到成本上限后，控制器应向入口反馈预计等待、限流原因或降级选项，而不是继续扩容并在月底才告警。

下游错误率或限流率升高时，队列会增长，普通扩容器会继续增加 Worker，导致更多失败请求。应将“下游不可用造成的积压”和“本地容量不足造成的积压”分开，并采用熔断、退避、重试预算和逐步恢复。

Autothrottle 将应用级 SLO 反馈和局部资源控制拆成两层，为这种设计提供了参考。[10] 数字员工平台也可以由上层控制器关注任务等待与完成 SLO，下层控制器管理各实例池槽位、CPU、内存和并发限制。

## 十三、可观测性：能够解释每一次扩缩容

每个实例池应同时展示：

- 到达工作量、完成工作量和积压工作量。
- 最老任务年龄和排队时间分位数。
- 当前、期望、Starting、Ready、Busy、Draining 实例数。
- 声明槽位、就绪槽位和有效槽位。
- 冷启动与排空耗时分布。
- 下游并发、限流率和错误率。
- 每任务计算、模型和工具成本。
- 租约过期、任务接管、重复执行和结果待核实数量。

每次控制循环至少记录：

```text
decision_id
pool_id
observed_at
current_replicas
starting_replicas
draining_replicas
raw_desired_replicas
bounded_desired_replicas
final_desired_replicas
trigger_metrics
active_constraints
selected_scale_in_instances
decision_reason
```

需要重点告警：期望实例长期高于 Ready 实例、Starting 超时、扩容后积压仍增长、最老任务超过 SLO、Draining 超时、频繁伸缩、租约接管异常和重复业务副作用。

## 十四、验证方案：不仅测能否扩，还要测能否安全缩

压测应覆盖短任务与长任务混合、不同优先级、模型与浏览器混合、外部等待、人工等待，以及包含幂等写入的业务动作。Agentix 的程序级调度研究和 InferLine 的多阶段推理管线容量研究都说明，只观察单个调用无法代表整条执行链的延迟和资源需求。[1][11]

扩容测试至少覆盖：从零激活、十倍突发、持续增长、节点扩容、镜像未缓存、下游模型限流和单租户突发。关注扩容决策时间、首个新增实例 Ready 时间、恢复 SLO 时间和过量副本峰值。

缩容与故障测试至少覆盖：

1. 空闲实例正常排空。
2. Busy 实例收到终止信号。
3. 长任务在截止前提交检查点。
4. 外部写入超时后实例被终止。
5. 节点突然断电，没有执行 `preStop`。
6. 旧实例恢复后尝试提交结果。
7. 控制器在排空过程中重启。
8. 同一任务被队列重复投递。

验收底线不是“Pod 最终减少”，而是任务不丢失、过期租约不能提交、已生效业务动作不被重复执行，无法自动恢复的任务有明确状态和责任人。

| 类别 | 指标示例 |
|---|---|
| 响应能力 | P95 排队时间、突发后恢复 SLO 时间 |
| 容量效率 | 槽位利用率、空闲实例时长、单位任务成本 |
| 稳定性 | 每小时扩缩容次数、过量副本比例 |
| 启动质量 | Pod 创建到业务 Ready 的 P50/P95 |
| 缩容安全 | 排空成功率、强制终止率、检查点恢复率 |
| 执行正确性 | 任务丢失数、过期租约提交数、重复副作用数 |
| 多租户治理 | 配额违规数、关键租户 SLO 达成率 |

## 十五、分阶段落地

### 第一阶段：建立可恢复的执行协议

- 统一任务、步骤、尝试和实例标识。
- 使用持久队列交付就绪步骤。
- 建立 Worker 心跳、租约和 fencing token。
- 将任务状态、产物和操作记录移出实例本地。
- 实现 `Ready → Draining → Terminated` 生命周期。

没有这一阶段，不建议开放自动缩容。

### 第二阶段：接入业务指标扩容

- 采集队列深度、最老任务年龄和槽位指标。
- 为不同运行特征建立独立实例池。
- 使用 KEDA/HPA 接入外部指标。
- 配置快扩慢缩、最小副本和最大副本。
- 建立扩缩容决策日志和基础看板。

### 第三阶段：引入工作量和 SLO 模型

- 为任务类型建立工作量权重。
- 使用历史轨迹估算服务时间和启动时间。
- 根据积压清空目标和截止时间计算容量。
- 把下游配额、租户预算和优先级纳入控制器。
- 对长任务、浏览器和独占资源使用专用策略。

### 第四阶段：预测、预热与全局优化

- 对周期负载进行预扩容。
- 建立热实例和预热沙箱池。
- 联动节点伸缩、镜像缓存和资源装箱。
- 在 SLO、成本和下游风险之间联合优化。
- 用故障演练和生产轨迹持续校准参数。

## 十六、常见设计误区

### 1. 把 CPU 当作唯一指标

CPU 无法表达队列积压、外部等待、账号约束和模型限流。它应是资源保护指标，而不是唯一需求指标。

### 2. 把副本数当作容量

尚未 Ready、正在 Draining、无法获得账号或被下游限流的实例都不是有效容量。真正需要计算的是可用执行槽位。

### 3. 让等待审批的任务持续占用 Worker

长时间等待应持久化状态并释放实例。审批到达后重新排队，运行框架从检查点恢复。

### 4. 认为 `preStop` 可以保证不丢任务

节点崩溃、网络分区和强制驱逐可能不给完整退出机会。正确性必须来自持久状态、租约、幂等和恢复协议。

### 5. 扩容不检查下游容量

Worker 越多，请求放大越快。模型、数据库、业务接口和账号池达到上限时，需要背压和限流，而不是继续堆副本。

### 6. 缩容直接修改 Deployment 副本数

这会让 Kubernetes 任意选择 Pod 删除。需要先由平台选择候选实例并完成 Drain，再回收副本；或者确保所有实例都具备一致、可靠的终止排空协议。

## 十七、总结

数字员工执行实例扩缩容不是一个单独的 Kubernetes 参数问题，而是一套贯穿任务、调度、运行状态和基础设施的控制机制。

一套可落地的方案应满足以下条件：

1. 以实例池和执行槽位作为容量对象，不把岗位数、任务数或 Pod 数混在一起。
2. 以工作量、排队时间和 SLO 作为主要伸缩信号，CPU、内存用于资源保护。
3. 同时计算持续到达容量和积压清理容量，并考虑实例启动提前量。
4. 采用快扩慢缩和两级伸缩，协调 Worker 副本、节点资源和下游配额。
5. 把 Drain 作为缩容协议，先停止接单，再处理在途任务，最后回收资源。
6. 用租约、fencing、检查点和幂等保证恢复正确性，不依赖退出钩子维持业务安全。
7. 记录每次容量决策的原因和约束，通过混合负载与故障注入证明系统既能扩，也能安全缩。

最终，扩缩容的目标不是让副本曲线看起来灵敏，而是在负载变化和局部故障下，持续满足任务等待时间、执行正确性和成本边界。只有任务状态与计算资源解耦，新增实例才能快速接管工作，旧实例才能在不破坏业务的前提下退出。

**参考文献与技术资料**

1. Michael Luo 等. *Agentix: An Efficient Serving Engine for LLM Agents as General Programs*. NSDI, 2026. [原文](https://www.usenix.org/conference/nsdi26/presentation/luo)
2. Lazar Cvetković 等. *Dirigent: Lightweight Serverless Orchestration*. SOSP, 2024. [原文](https://arxiv.org/abs/2404.16393)
3. Mohammad Shahrad 等. *Serverless in the Wild: Characterizing and Optimizing the Serverless Workload at a Large Cloud Provider*. USENIX ATC, 2020. [原文](https://www.usenix.org/conference/atc20/presentation/shahrad)
4. Kubernetes 官方文档. *Horizontal Pod Autoscaling*. [原文](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
5. KEDA 官方文档. *ScaledObject specification*. [原文](https://keda.sh/docs/latest/reference/scaledobject-spec/)
6. Kubernetes 官方文档. *Pod Lifecycle* 与 *Container Lifecycle Hooks*. [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)；[Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
7. Haoran Zhang 等. *Fault-tolerant and Transactional Stateful Serverless Workflows*. OSDI, 2020. [原文](https://www.usenix.org/conference/osdi20/presentation/zhang-haoran)
8. Sebastian Burckhardt 等. *Netherite: Efficient Execution of Serverless Workflows*. PVLDB 15(8), 2022. [原文](https://www.vldb.org/pvldb/vol15/p1591-burckhardt.pdf)
9. Haoran Ding 等. *Automated Verification of Idempotence for Stateful Serverless Applications*. OSDI, 2023. [原文](https://www.usenix.org/conference/osdi23/presentation/ding)
10. Zibo Wang 等. *Autothrottle: A Practical Bi-Level Approach to Resource Management for SLO-Targeted Microservices*. NSDI, 2024. [原文](https://www.usenix.org/conference/nsdi24/presentation/wang-zibo)
11. Daniel Crankshaw 等. *InferLine: ML Prediction Pipeline Provisioning and Management for Tight Latency Objectives*. SoCC, 2020. [原文](https://arxiv.org/abs/1812.01776)
12. Qingyuan Liu 等. *Harmonizing Efficiency and Practicability: Optimizing Resource Utilization in Serverless Computing with Jiagu*. USENIX ATC, 2024. [原文](https://www.usenix.org/conference/atc24/presentation/liu-qingyuan)
