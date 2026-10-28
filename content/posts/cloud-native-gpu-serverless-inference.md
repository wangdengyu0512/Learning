---
title: "云原生 GPU 推理部署：从资源虚拟化到 Serverless 弹性与成本控制"
description: "面向 Kubernetes 生产集群，设计 GPU 虚拟化、Serverless 推理、Pod 与节点两级扩缩容，以及可归属、可约束的推理成本体系。"
date: 2026-10-28
tags: Kubernetes, GPU, 推理服务
featured: false
---

企业把模型部署到 Kubernetes 后，通常会先遇到两种相反的现象：热门模型在高峰期排队、超时，冷门模型却长期占着昂贵 GPU；为了降低空闲成本而缩容到零，又会在下一次请求到来时经历镜像拉取、权重下载、引擎初始化和 GPU 节点启动，冷启动可能远远超过业务可接受时间。

这不是简单增加 HPA 或把一张 GPU 切成多份就能解决的问题。生产方案需要同时处理四层控制：

1. **资源层**决定整卡、MIG、vGPU、MPS 或时间切片怎样交付与隔离。
2. **服务层**决定请求如何路由、排队、批处理、限流和唤醒实例。
3. **弹性层**协调推理副本和 GPU 节点扩缩容，并处理冷启动与安全缩容。
4. **成本层**把设备时长、模型加载、缓存和流量成本归属到模型、租户与业务结果。

> GPU Serverless 的本质不是“Pod 可以缩容到零”，而是让使用方按请求使用推理能力，同时由平台在服务等级、资源隔离和预算边界内完成容量交付与回收。

本文给出一套面向 Kubernetes 的参考方案。组件名称用于说明实现方式，不代表唯一选型；GPU 型号、推理引擎、模型结构和云厂商节点启动时间不同，所有容量参数都应通过真实工作负载压测确定。

## 一、先把目标写成可验证的服务契约

云原生部署的目标不应只是“提高 GPU 利用率”。利用率很高但请求大量超时，或者吞吐很高但输出质量下降，都不算有效优化。建议先定义以下指标。

| 维度 | 核心指标 | 设计问题 |
| --- | --- | --- |
| 可用性 | 成功率、超时率、熔断率 | 单节点、单可用区故障时是否还能服务 |
| 延迟 | 排队时间、TTFT、TPOT、端到端 P95/P99 | 交互请求最多允许等待多久 |
| 吞吐 | 请求数、输入/输出 Token、有效完成数 | 单副本在目标延迟下能处理多少工作量 |
| 弹性 | 扩容反应时间、Ready 时间、积压清空时间 | 流量突增后多久恢复到 SLO |
| 隔离 | 显存、计算、故障与性能干扰 | 不同租户能否共享同一物理卡 |
| 成本 | GPU 小时、每百万 Token 成本、每成功任务成本 | 空闲、冷启动和失败重试由谁承担 |

同一平台至少应区分三种服务等级。

| 服务等级 | 典型业务 | 最小副本 | 资源策略 | 主要目标 |
| --- | --- | ---: | --- | --- |
| 在线关键型 | 核心对话、实时审核、生产 API | 1 或更多 | 整卡或 MIG 保底 | 稳定尾部延迟和高可用 |
| 在线弹性型 | 流量波动明显的模型 API | 0 或 1 | MIG、整卡池或受控共享 | 在冷启动预算内降低空闲成本 |
| 异步批处理型 | 文档解析、Embedding、离线评测 | 0 | 队列、可抢占节点、共享 GPU | 单位工作量成本和完成时限 |

如果业务要求 P95 在 2 秒内返回，而模型从零启动需要 90 秒，那么 `minReplicas: 0` 与服务目标天然冲突。此时应保留热副本、路由到共享基础模型，或者把请求转成异步任务，而不是继续调 autoscaler 参数。

## 二、参考架构：把控制面与推理数据面分开

```text
Client / Application
        |
        v
API Gateway / Model Gateway
  鉴权 · 租户配额 · 路由 · 限流 · Token 预算 · 异步任务入口
        |
        +-----------------------+
        |                       |
        v                       v
Serverless Activator       Durable Queue
短请求唤醒与缓冲           长任务、批任务、重试与背压
        |                       |
        +-----------+-----------+
                    v
Inference Service Control Plane
  KServe / Knative 或 Deployment / KEDA / 自定义控制器
                    |
                    v
Inference Runtime Pods
  vLLM / Triton / TGI / TorchServe / 自研 Runtime
  动态批处理 · KV Cache · 模型并行 · 健康检查 · Drain
                    |
                    v
GPU Resource Pools on Kubernetes
  整卡 · MIG · vGPU · MPS · Time-slicing
                    |
                    v
GPU Nodes and Model Cache
  GPU Operator · Device Plugin / DRA · 本地 NVMe · 对象存储

贯穿能力：可观测性 · SLO · 模型版本 · 安全策略 · 成本计量 · 审计
```

控制面保存期望状态：模型版本、运行时、GPU 规格、副本边界、路由比例和预算。数据面只负责接收请求并执行推理。模型网关不能直接根据某个 Pod 的瞬时 GPU 利用率创建副本；推理 Pod 也不应自行修改租户配额。边界清楚后，扩容决策、故障恢复和成本归属才可审计。

### 一套务实的组件组合

| 能力 | 可选实现 | 主要职责 |
| --- | --- | --- |
| GPU 生命周期 | GPU Operator、厂商 Device Plugin、DRA 驱动 | 驱动、设备发现、健康、资源暴露 |
| 推理控制面 | KServe 或自研 ModelService CRD | 模型发布、版本、路由和副本策略 |
| 短请求 Serverless | Knative Serving / KServe Knative 模式 | 请求并发伸缩、从零唤醒、Revision |
| 长生成与异步任务 | Deployment + KEDA/HPA + 队列 | 基于积压和推理指标扩缩容 |
| 节点弹性 | Cluster Autoscaler、Karpenter 或云厂商节点控制器 | GPU 节点池扩缩容与实例选择 |
| 推理运行时 | vLLM、Triton、TGI 等 | 批处理、缓存、并行和模型执行 |
| 指标与计量 | Prometheus、DCGM Exporter、OpenTelemetry、账单导出 | 服务、设备、请求与成本事实 |

不要为了“Serverless”强行引入全部组件。单集群、少量稳定模型可以先用 Deployment、HPA/KEDA 和节点池完成闭环；只有在模型数量、版本和租户规模增长后，再增加统一推理控制面。

## 三、GPU 虚拟化：先选隔离模型，再谈利用率

GPU 虚拟化并不是一种技术，而是几种具有不同隔离边界的资源交付方式。

### 1. 整卡独占

一个 Pod 获得一张或多张完整 GPU，通常通过 `nvidia.com/gpu` 等扩展资源申请。它的优点是行为简单、性能较稳定、兼容性最好，适合大模型、多卡并行、延迟敏感服务和性能基线测试。缺点是小模型或低流量服务可能浪费显存和计算能力。

整卡独占仍然可能受到节点 CPU、内存、PCIe、网络和存储邻居影响，所以“独占 GPU”不等于独占整台服务器。

### 2. MIG 硬件切分

MIG 将支持该能力的物理 GPU 划分为预定义实例，每个实例拥有相对独立的计算、显存和故障隔离边界。Kubernetes 可以把不同 MIG Profile 暴露为可调度资源。它适合模型能够装入固定切片、需要较稳定性能，并且存在多租户隔离要求的在线推理。

MIG 的代价也很明确：

- Profile 是离散规格，资源不能像 CPU millicore 一样任意切分；
- 调整 MIG 几何形态通常需要排空节点，部分环境还需要重启；
- 小切片的显存和算力可能限制批大小、上下文长度和 KV Cache；
- 不同型号支持的 Profile、媒体引擎和互联能力不同；
- 碎片化可能造成“总空闲显存够，但没有匹配切片可用”。

因此应把 MIG 节点按稳定 Profile 建池，例如“全部小切片池”和“中等切片池”，不要在高峰期频繁重构正在服务的节点。

### 3. vGPU

vGPU 通常通过虚拟化层向多个虚拟机提供虚拟设备，再由虚拟机内 Kubernetes 使用。它适合已有 VMware、KubeVirt 或云平台虚拟化体系，需要 VM 级安全边界、租户操作系统隔离和企业支持的场景。

vGPU 会引入 Hypervisor、Guest 驱动、Host 驱动、许可和版本兼容矩阵。它解决的是 VM 级 GPU 交付，不等价于 Kubernetes 内部的 Pod 级细粒度调度。若平台本身以裸金属容器为主，不应仅为了提高小模型利用率而额外引入虚拟机层。

### 4. CUDA MPS

MPS 允许多个 CUDA 进程更有效地并发共享 GPU 执行资源，适合受信任、同构、显存可控的工作负载。它可以减少多个小任务互相等待，但资源和故障隔离弱于 MIG，部署和监控也依赖具体设备插件与运行栈支持。

MPS 更像进程并发机制，不应被包装成强隔离租户产品。不同团队共享时，要验证 OOM、进程故障和资源争抢的影响。

### 5. 时间切片

时间切片把一张物理卡声明为多个可分配副本，使多个 Pod 交替使用 GPU。它易于提高开发、测试、小流量推理的装箱率，但通常没有 MIG 提供的显存和故障隔离，也不保证申请两个共享副本就获得两倍算力。

时间切片最容易出现“调度器看到 8 份资源，物理上仍只有 1 张卡”的认知错误。平台必须明确标记共享资源，并限制每卡超售倍数、单工作负载显存和适用租户。

### 6. 选型矩阵

| 方式 | 隔离强度 | 性能可预测性 | 资源粒度 | 适合场景 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| 整卡 | 高 | 高 | 粗 | 大模型、关键在线、多卡推理 | 低负载时空闲成本高 |
| MIG | 较高 | 较高 | 固定 Profile | 多租户在线、小中型模型 | Profile 碎片与重配置成本 |
| vGPU | VM 级 | 取决于模式 | Profile | 虚拟化平台、强租户边界 | 许可与版本矩阵复杂 |
| MPS | 较低 | 中 | 进程级 | 受信任同构小任务 | OOM 与故障影响边界弱 |
| 时间切片 | 低 | 较低 | 超售副本 | 开发测试、低频轻负载 | 显存争用和邻居干扰 |

一个常见的生产组合是：关键 LLM 使用整卡池，稳定的小模型使用 MIG 池，研发与低优先级评测使用时间切片池。不同资源池使用独立的节点标签、污点、配额和成本单价，避免调度器把它们当成可互换资源。

## 四、Kubernetes 资源池与调度设计

### 节点池按能力和价格分层

建议至少建立以下节点池：

```text
gpu-dedicated-online   整卡、按需实例、关键在线服务
gpu-mig-online         固定 MIG Profile、小中型在线模型
gpu-shared-batch       MPS/时间切片、开发评测和低优先级任务
gpu-spot-batch         可抢占整卡、可恢复异步任务
cpu-system             网关、控制器、队列和监控组件
```

GPU 节点设置污点，只有明确声明加速资源和容忍度的 Pod 才能进入。使用节点标签表达 GPU 型号、显存、切分模式、购买方式和故障域；使用 node affinity 选择能力，使用 topology spread 让关键副本跨节点或可用区分布。

### 请求与限制必须一致

GPU 扩展资源通常以整数调度。容器应显式申请目标资源，CPU 和内存也要设置合理请求，避免模型虽然拿到 GPU，却因主机内存不足、CPU 分词瓶颈或 `/dev/shm` 过小而性能异常。

```yaml
resources:
  requests:
    cpu: "4"
    memory: 24Gi
    nvidia.com/mig-2g.20gb: "1"
  limits:
    cpu: "8"
    memory: 32Gi
    nvidia.com/mig-2g.20gb: "1"
```

资源名称只是示例，实际名称取决于设备型号、MIG Profile 和插件配置。对时间切片资源，不能仅根据 Kubernetes 的“副本数”计算真实物理容量，还要从设备层记录它们映射到哪张卡。

### 在线与批任务不要共用无边界队列

在线推理应有保底容量和最高优先级，但也不能无限抢占。批任务可以借用在线池的暂时空闲量，前提是具备检查点、重试和明确的归还时限。异步推理优先进入持久队列，通过 KEDA 等组件按积压伸缩；同步请求则由网关设置最大等待时间和准入上限。

## 五、Serverless 推理不是一种部署模板

### 短请求预测模型

图像分类、排序、Embedding 和传统预测模型通常请求较短，单次并发语义清楚。KServe 的 Knative 模式可以利用请求并发驱动副本，在零副本时由 Activator 接住请求并唤醒服务。此模式还提供 Revision 与流量切分，适合版本发布和金丝雀验证。[4][5]

### 长生成 LLM

LLM 请求可能持续数十秒甚至更久，并且输入长度、输出长度、KV Cache 占用差异很大。两个“并发请求”可能对应完全不同的 GPU 工作量。KServe 当前文档也建议，长时间 GPU 生成负载优先使用标准 Kubernetes Deployment 模式，而不是把 Knative 并发模型作为默认方案。[6]

这类服务更适合：

- 由模型网关完成 Token 预算、租户配额和长短请求分流；
- 推理 Runtime 使用连续批处理和 KV Cache 管理；
- 根据等待请求、排队 Token、缓存压力和延迟伸缩 Deployment；
- 需要缩容到零时，由外部队列或 HTTP Interceptor 保留请求；
- 流式连接与后端生命周期解耦，实例缩容前执行 Drain。

### 异步和批量推理

文档解析、批量 Embedding、离线评测不应长时间占用同步 HTTP 连接。入口写入持久队列并返回任务 ID，Worker 拉取任务，结果写入对象存储或结果库。队列既是弹性指标，也是背压和故障恢复边界。

因此，一套平台可以同时提供三种产品，而不是只有一个“Serverless Endpoint”：

| 产品 | 请求协议 | 伸缩主指标 | 是否适合缩零 |
| --- | --- | --- | --- |
| 实时预测 Endpoint | 同步 HTTP/gRPC | 并发、RPS、排队 | 低频且可接受冷启动时适合 |
| 流式生成 Endpoint | SSE/WebSocket/流式 HTTP | 等待 Token、活动序列、TTFT | 谨慎，通常保留热副本 |
| 异步推理 Job | Queue + Task ID | 积压工作量、最老任务年龄 | 非常适合 |

## 六、弹性扩缩容：Pod、GPU 和节点是三层控制循环

### 第一层：请求准入与并发控制

网关先判断请求是否可以进入系统。关键控制包括：

- 每租户并发、RPS、输入 Token、最大输出 Token 和月度预算；
- 模型上下文上限和超长请求策略；
- 同步请求最大排队时间；
- 重试预算和幂等键；
- 过载时降级到小模型、异步队列或拒绝。

没有准入控制，扩容速度永远可能追不上突发流量；客户端超时重试还会形成请求放大。

### 第二层：推理 Pod 扩缩容

短请求可以采用目标并发：

```text
N_concurrency = ceil(inflight_requests / target_concurrency_per_pod)
```

异步任务可以采用到达率和积压模型：

```text
N_rate = ceil(arrival_work_per_second / service_rate_per_pod)
N_backlog = ceil(backlog_work / (drain_target_seconds × service_rate_per_pod))
N_desired = max(N_rate + N_backlog, N_slo_guard)
```

LLM 应把请求转换为更接近真实负载的工作量，例如待处理输入 Token、预计输出 Token、活动序列或 KV Cache 占用。扩缩容主指标建议至少组合：

- `waiting_requests` 与 `oldest_wait_seconds`；
- `pending_input_tokens`、`pending_output_token_budget`；
- `running_sequences` 与可用批处理槽位；
- `kv_cache_usage_ratio`；
- TTFT、TPOT 和请求超时率；
- GPU 利用率、显存和功耗作为诊断或保护指标。

GPU 利用率可能在 Prefill 和 Decode 之间剧烈波动，平均值也会掩盖排队。因此它不适合作为唯一扩容信号。[4]

### 第三层：GPU 节点扩缩容

Pod 扩容只会产生 Pending Pod，不会自动创造 GPU。节点自动伸缩器需要识别 Pod 的 GPU 类型、MIG Profile、可用区和购买方式，并在匹配节点池中交付容量。

两个控制循环的时序必须协同：

```text
流量到达
  -> 网关缓冲或排队
  -> Pod autoscaler 增加期望副本
  -> 新 Pod 因无 GPU Pending
  -> Node autoscaler 创建 GPU 节点
  -> 驱动与设备插件 Ready
  -> Pod 调度、加载模型并通过 readiness
  -> 网关放行请求
```

节点启动往往比 Pod 启动更慢。高峰可预测时，应提前定时或预测扩容；不可预测时，可保留小型 warm node pool，使空闲节点已经具备驱动、镜像和权重缓存，只等待 Pod 启动。

### 扩容要快，缩容要稳

扩容可以在积压增长时快速增加副本；缩容应设置稳定窗口、最小运行时长和单次最大下降比例。推理 Pod 收到终止信号后应：

1. Readiness 变为失败并停止接收新请求；
2. 等待现有批次和流式请求完成；
3. 超过排空时限时，由网关重试可重放请求；
4. 释放模型、缓存和租约，再退出进程。

直接删除仍在生成的 Pod，会把节省的几分钟 GPU 成本转换成用户超时、重复推理和更高 Token 成本。

## 七、冷启动预算：把一分钟拆开看

从零到 Ready 的时间可以拆成：

```text
T_cold = T_queue
       + T_node_provision
       + T_driver_ready
       + T_image_pull
       + T_weight_download
       + T_engine_init
       + T_model_load
       + T_warmup
       + T_route_ready
```

仅优化镜像大小，无法解决 GPU 节点创建或数百 GB 权重下载。每个阶段都要有独立指标和超时。

### 分层降低冷启动

| 层次 | 优化手段 | 注意事项 |
| --- | --- | --- |
| 节点 | warm pool、预留实例、提前扩容 | 空闲节点仍产生基础成本 |
| 镜像 | 精简镜像、镜像预拉取、节点镜像缓存 | 运行时与驱动兼容需固定 |
| 权重 | 对象存储权威源、本地 NVMe 缓存、并行加载 | 缓存需校验版本和完整性 |
| 引擎 | 预生成优化产物、固定 shape/Profile | 产物需与硬件和版本匹配 |
| 模型 | 热门模型常驻、多个模型共享 Runtime | 多模型装载会增加显存治理难度 |
| 路由 | 冷启动回退、小模型降级、异步受理 | 必须向调用方明确语义变化 |

模型缓存键至少包含模型摘要、量化版本、推理引擎版本和硬件架构。不能用可覆盖的 `latest` 作为缓存身份，否则节点可能加载旧权重却被控制面标记为新版本。

### 哪些服务可以缩容到零

可以用一个简单决策条件评估：

```text
允许缩零，当且仅当：
  可接受等待时间 >= 冷启动高分位时间
  或存在可接受的异步/降级路径
  且请求能够被可靠缓冲
  且模型状态可以重新构建
```

核心在线 LLM 通常保留至少一个副本；长尾模型可以缩零；一组相似长尾模型也可以共享多模型 Runtime 或路由到统一基础模型，减少每个模型单独保活的成本。

## 八、容量规划：以目标延迟下的有效吞吐为基线

对每个“模型版本 + GPU 规格 + 精度 + 并行方式 + Runtime 版本”建立性能档案。压测应覆盖代表性输入长度、输出长度、并发和缓存命中率，并记录满足 SLO 时的最大稳定吞吐。

假设某模型服务在目标延迟下，每个副本稳定处理 `mu` 个标准工作量/秒，请求到达率为 `lambda`，目标利用率为 `u`：

```text
N_steady = ceil(lambda / (mu × u))
```

`u` 不应设为 1，需要为突发、长尾请求、故障和滚动发布留余量。对 LLM，标准工作量可以按请求画像定义，例如：

```text
work_units = a × input_tokens + b × expected_output_tokens
```

系数 `a`、`b` 应来自当前模型和硬件实测，而不是跨模型复制。Prefill 与 Decode 的瓶颈不同，输入输出长度分布变化后，旧档案可能失效。

容量上限还要受离散 GPU 约束：

```text
N_final = min(
  N_desired,
  available_gpu_slots,
  tenant_quota,
  budget_limit,
  downstream_limit
)
```

当预算或 GPU 配额成为瓶颈时，系统应返回“容量受限”并执行优先级、排队或降级策略，不能继续制造永远无法调度的 Pending Pod。

## 九、成本控制：从 GPU 利用率转向单位有效产出

### 成本模型

推理服务的完整成本可以近似表示为：

```text
C_total = C_gpu_node
        + C_cpu_memory
        + C_storage
        + C_model_transfer
        + C_network
        + C_control_plane
        + C_observability
        + C_failed_retry
```

其中 GPU 节点成本应进一步分解为有效推理、排队占用、模型加载、预热、空闲保活和不可调度碎片。只有这样，团队才能判断成本来自模型太大、批处理不足、MIG Profile 不合适，还是缩零后反复冷启动。

建议同时观察以下单位经济指标：

- 每百万输入 Token 和输出 Token 的 GPU 成本；
- 每个满足质量与延迟门槛的成功请求成本；
- 每个业务任务的完整模型调用、重试与降级成本；
- GPU 已分配时长与有效计算时长；
- 冷启动时长、空闲时长和碎片损失占比。

### 五类主要优化杠杆

1. **模型路由**：简单任务使用小模型，困难任务升级到大模型；路由必须经过质量评测。
2. **运行时优化**：连续批处理、前缀缓存、量化、推测解码和并行策略；每项优化都要同时验证质量和尾部延迟。
3. **资源规格优化**：小模型匹配 MIG，大模型使用整卡；根据显存而不是参数量选择 Profile。
4. **弹性与购买策略**：稳定基线使用承诺或预留资源，突发使用按需，异步可恢复任务使用可抢占资源。
5. **生命周期治理**：低频模型缩零，过期版本自动下线，缓存按热度淘汰，防止影子模型长期占卡。

### 缩零不一定更便宜

设保留一个热副本每小时成本为 `C_hot`，一次冷启动的节点、下载和预热成本为 `C_start`，观察窗口内预计唤醒 `k` 次，则仅从直接成本看：

```text
当 k × C_start + 冷启动业务损失 > C_hot 时，保留热副本更合理。
```

频繁地在 0 和 1 之间振荡，会同时增加启动成本和延迟。应根据模型访问间隔分布设置保活时间，而不是全平台使用同一个 cooldown。

### 成本必须可归属、可约束

每个请求和运行对象都应携带：

```text
tenant_id · project_id · model_id · model_version
environment · service_tier · cost_center · request_id
```

计量系统将网关请求、模型 Token、Pod 运行时、实际物理 GPU/MIG 实例和云账单关联起来。预算控制至少包含月度预算、日速率告警、并发上限、最大副本数和超预算策略。标签只能用于归属，不能替代强制配额和准入策略。

## 十、可靠性、安全与多租户边界

### 可用性

- 关键服务至少跨节点部署，必要时跨可用区；
- 使用 PodDisruptionBudget 控制自愿中断，但仍需 Runtime Drain；
- 网关、队列和控制面运行在 CPU 节点，不依赖被管理的 GPU 池；
- 模型制品使用不可变摘要并保留上一稳定版本；
- 扩容器、指标系统或模型仓库故障时定义保守回退副本数；
- 对 GPU XID、ECC、温度和驱动异常执行节点隔离与健康恢复。

### 多租户安全

不同信任域之间优先使用整卡、MIG 或 VM/vGPU 边界。时间切片和 MPS 更适合同一信任域内的受控共享。容器仍需执行最小权限、只读根文件系统、镜像签名、网络策略、Secret 外置和工作负载身份。

Pod 退出后应确认显存与本地缓存的清理语义。敏感模型权重落到本地 NVMe 时，需要加密、访问控制和节点退役擦除流程。Prompt、输出与 Token 级 Trace 可能包含业务数据，遥测系统同样必须执行脱敏、采样和保留期限策略。

## 十一、可观测性：解释一次请求为什么慢、为什么贵

建议把指标分成四层。

| 层次 | 关键指标 |
| --- | --- |
| 请求层 | RPS、并发、输入/输出 Token、排队、TTFT、TPOT、错误与租户 |
| Runtime 层 | 批大小、等待/运行序列、KV Cache、缓存命中、模型加载时间 |
| Pod 层 | 副本状态、启动阶段、Readiness、重启、排空、CPU/内存 |
| GPU/节点层 | SM/显存利用率、显存占用、功耗、温度、XID/ECC、物理映射、节点价格 |

一次请求 Trace 应关联：网关准入、排队、目标模型版本、Pod、GPU 或 MIG 实例、Prefill、Decode、响应和计费记录。Autoscaler 每次决策也要保留：

```text
timestamp
observed_metrics
raw_desired_replicas
bounded_desired_replicas
active / starting / ready / draining
gpu_slots_available
budget_and_quota_limits
decision_reason
```

只展示一张 GPU 利用率大盘，无法解释扩容为何没有发生，也无法判断成本优化是否损害了延迟目标。

## 十二、配置示例

以下 YAML 用于表达控制思路，资源名称、镜像、API 版本和参数应按实际安装版本调整。

### KServe 短请求模型：基于并发从零伸缩

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: image-classifier
spec:
  predictor:
    minReplicas: 0
    maxReplicas: 8
    scaleMetric: concurrency
    scaleTarget: 4
    containerConcurrency: 8
    model:
      modelFormat:
        name: tensorflow
      storageUri: s3://model-registry/image-classifier/sha256-abc123/
      resources:
        requests:
          cpu: "2"
          memory: 8Gi
          nvidia.com/mig-1g.10gb: "1"
        limits:
          cpu: "4"
          memory: 12Gi
          nvidia.com/mig-1g.10gb: "1"
```

`scaleTarget` 是扩容目标，`containerConcurrency` 是单副本硬上限。硬上限过低可能造成更多冷启动和排队，应通过压测确定。[5]

### LLM Deployment：使用 KEDA 按等待工作量伸缩

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: llm-inference
spec:
  scaleTargetRef:
    name: llm-inference
  pollingInterval: 15
  cooldownPeriod: 900
  minReplicaCount: 1
  maxReplicaCount: 12
  fallback:
    failureThreshold: 3
    replicas: 2
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 0
          policies:
            - type: Pods
              value: 4
              periodSeconds: 60
            - type: Percent
              value: 100
              periodSeconds: 60
          selectPolicy: Max
        scaleDown:
          stabilizationWindowSeconds: 600
          policies:
            - type: Percent
              value: 25
              periodSeconds: 120
          selectPolicy: Min
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        metricName: llm_pending_work_units
        query: |
          sum(llm_pending_work_units{model="enterprise-assistant"})
        threshold: "8"
        activationThreshold: "1"
```

这里保留一个热副本，以 Prometheus 中的待处理工作量作为主指标，扩容快于缩容。KEDA 的 `cooldownPeriod` 主要控制回到零副本的时间；1 到 N 的伸缩仍由它创建的 HPA 行为控制。[7]

推理 Deployment 还应设置 startup、readiness 和 liveness 探针，并让 `preStop` 调用 Runtime 的 Drain 接口。Readiness 必须在权重加载、引擎初始化和最小预热完成后才成功，否则网关会把真实请求送给尚未形成容量的 Pod。

## 十三、分阶段落地路线

### 第一阶段：建立基线

- 选择一个短请求模型和一个 LLM 作为代表负载；
- 使用整卡部署，固定模型、Runtime、硬件和流量画像；
- 打通请求、Token、GPU 时长与租户成本归属；
- 测量冷启动各阶段和目标延迟下的有效吞吐。

这一阶段先得到可信基线，不急于切卡或缩零。

### 第二阶段：资源池化与 Pod 弹性

- 建立整卡、MIG 和批处理节点池；
- 为短请求接入 KServe/Knative 并发伸缩；
- 为 LLM 和异步任务接入 KEDA 或自定义指标；
- 完成限流、排队、Drain、PDB 和故障演练。

### 第三阶段：节点弹性与冷启动优化

- 接入 GPU 节点自动伸缩和 warm pool；
- 建立镜像预拉取与本地权重缓存；
- 根据模型热度设置最小副本和保活时间；
- 验证从零启动、突发扩容和节点回收的完整时序。

### 第四阶段：FinOps 与多租户治理

- 建立每模型、租户和成本中心的 Showback/Chargeback；
- 引入预算、配额、超预算降级和版本自动下线；
- 评估量化、小模型路由、Spot 和共享 GPU 的真实收益；
- 以单位有效任务成本持续优化，而不是只追求设备忙碌度。

## 十四、上线评审清单

1. 每个模型是否有明确的服务等级、延迟目标和冷启动预算？
2. GPU 交付方式是否明确了显存、计算、故障和性能隔离边界？
3. MIG Profile 是否按稳定节点池管理，是否验证过碎片化？
4. 长生成请求是否避免只按 HTTP 并发或 GPU 利用率扩缩容？
5. Pod 和 GPU 节点扩容的时序、最大等待时间和失败回退是否明确？
6. 从零启动时，请求由谁缓冲，超时后是否会继续占用资源？
7. 模型缓存是否使用不可变版本，并能验证完整性？
8. 缩容前能否停止接单并排空流式请求和批次？
9. 指标系统故障时，扩缩容是否有保守回退策略？
10. 每份 GPU/MIG 用量能否归属到模型、租户、环境和成本中心？
11. 预算、配额和最大副本是否由准入策略强制执行？
12. 节点故障、可用区故障、模型仓库故障和流量突发是否经过演练？

## 结语

云原生 GPU 推理平台的核心，不是把所有模型都改造成“零副本服务”，而是建立一套有边界的资源与容量系统：关键模型拥有稳定保底，长尾模型能够释放资源，异步任务接受排队，突发流量可以扩容，昂贵 GPU 的每一段占用都能够解释和归属。

GPU 虚拟化解决“如何切分和隔离”，Serverless 解决“如何按需求交付”，Kubernetes 解决“如何声明、调度和恢复”，FinOps 解决“如何证明资源花得值得”。四者必须围绕同一套 SLO、容量档案和成本事实协同，弹性扩容与成本控制才不会互相抵消。

## 参考资料

资料核验日期：2026 年 10 月 28 日。生产配置应以实际安装版本的文档为准。

1. [Kubernetes：Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)。
2. [NVIDIA GPU Operator：GPU Operator with MIG](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/gpu-operator-mig.html)。
3. [NVIDIA GPU Operator：Time-Slicing GPUs in Kubernetes](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/24.9.0/gpu-sharing.html)。
4. [KServe：Autoscaling with Knative Pod Autoscaler](https://kserve.github.io/website/docs/model-serving/predictive-inference/autoscaling/kpa-autoscaler)。
5. [Knative：Configuring concurrency](https://knative.dev/docs/serving/autoscaling/concurrency/)。
6. [KServe：Knative Serverless Installation Guide](https://kserve.github.io/website/docs/admin-guide/serverless)。
7. [KEDA：ScaledObject specification](https://keda.sh/docs/latest/reference/scaledobject-spec/)。
8. [NVIDIA：Multi-Instance GPU User Guide](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/)。
9. [NVIDIA：vGPU for Compute Overview](https://docs.nvidia.com/ai-enterprise/latest/vgpu/overview.html)。
10. [Kubernetes：Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)。
11. [Kubernetes：Node Autoscaling](https://kubernetes.io/docs/concepts/cluster-administration/node-autoscaling/)。
12. [DCGM Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)。
