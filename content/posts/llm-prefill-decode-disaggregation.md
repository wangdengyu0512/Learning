---
title: PD 分离：从 Prefill/Decode 干扰到可扩展的大模型推理架构
description: 从 Prefill 与 Decode 的计算差异出发，系统拆解 PD 分离中的 KV Cache 传输、SLO 调度、资源配比、故障恢复与工程选型，并串联 DistServe、Splitwise、Mooncake 等代表性工作。
date: 2026-10-28
tags: 大模型推理, 分布式系统, 性能优化
featured: true
---

一次大语言模型请求，看起来只是“输入 Prompt，逐字生成答案”，但在 GPU 上实际经历了两种差异很大的工作负载：先并行处理全部输入 Token 的 **Prefill**，再逐 Token 执行 **Decode**。前者倾向于吃满算力，后者往往受显存带宽和批处理效率约束；前者直接决定首 Token 延迟，后者决定流式输出是否顺畅。

如果两个阶段挤在同一组 GPU、共享同一个批处理队列，长 Prompt 的 Prefill 很容易阻塞正在生成的请求，而大量 Decode 又会让新请求迟迟拿不到首 Token。**Prefill-Decode Disaggregation**，简称 **PD 分离**，就是将两个阶段放到可独立扩缩容的执行池中，通过传输 KV Cache 完成请求交接。

但“分开部署”只是表象。一个可用的 PD 系统必须同时回答：

1. Prefill 和 Decode 为什么值得分离，而不只是分别调参？
2. 数 GB 的 KV Cache 如何低延迟地跨设备传输？
3. 请求应该发往哪个 Prefill 实例、哪个 Decode 实例？
4. P:D 资源比例如何随 Prompt 长度、输出长度和 SLO 动态变化？
5. 新增的网络、调度与故障域成本，是否真的换来了更高 Goodput？

本文从这些问题出发，建立一套理解、设计和评测 PD 分离系统的完整框架。这里讨论的“PD”专指大模型推理中的 Prefill/Decode 分离。

![Prefill 与 Decode 的计算形态、服务目标和主要瓶颈对比](/blog-assets/pd-disaggregation/phase-comparison.svg)

## 一、先看清一次推理请求

### 1. Prefill：一次处理整段上下文

假设用户输入 `S` 个 Token。Prefill 会让这些 Token 经过全部 Transformer 层，计算每个位置的 Query、Key 和 Value，并保存后续生成需要的 Key/Value。虽然因果注意力仍然遵守“只能看左侧”的约束，但整个输入序列可以用矩阵运算并行处理。

Prefill 的典型特征是：

- 单次处理 Token 数较多，矩阵乘法规模大；
- 算术强度较高，更容易发挥 Tensor Core 的计算能力；
- 工作量随输入长度显著增长，长上下文请求尤其昂贵；
- 用户尚未看到输出，所以它主要影响 **TTFT**（Time To First Token，首 Token 延迟）。

严格来说，长序列注意力的计算量不只是与 `S` 线性相关。FlashAttention 等实现大幅减少了中间数据读写，但没有消除注意力本身的计算依赖。模型结构、上下文长度和算子实现共同决定 Prefill 到底有多“计算密集”。

### 2. Decode：每轮只生成一个 Token

Prefill 完成后，模型进入自回归生成。第 `t` 轮只输入最新 Token，读取此前所有 Token 的 KV Cache，算出下一个 Token，再将新的 Key/Value 追加到缓存中。这个过程持续到遇到停止条件。

Decode 的典型特征是：

- 单请求每轮只有一个新 Token，单次矩阵运算较小；
- 每一步都要读取模型权重和不断增长的 KV Cache；
- 通常更受 HBM 显存带宽、批大小与调度开销影响；
- 每轮结果都可能直接流向用户，主要影响 **TPOT**（Time Per Output Token）或 **ITL**（Inter-Token Latency）。

Decode 并不是“计算量小，所以一定便宜”。它需要重复执行很多轮，而且小批量 Decode 很难摊薄权重读取与内核启动成本。对在线服务而言，输出长度和并发数常常比单轮 FLOPs 更能决定 Decode 池压力。

### 3. KV Cache 是两个阶段之间的状态契约

Prefill 的输出不只是首 Token，还包括每一层、每个历史位置的 Key/Value 张量。Decode 不需要重新计算 Prompt，前提是它能接管这份 KV Cache。因此，一次请求可以抽象为下面的状态机：

```text
QUEUED
  -> PREFILLING
  -> KV_READY
  -> TRANSFERRING
  -> DECODING
  -> FINISHED
```

PD 分离改变了执行位置，却不能改变这个语义依赖：**Decode 必须看到与模型版本、并行切分、位置编码和精度格式一致的 KV 状态。** 这也是 PD 系统最核心的接口，而不是普通 RPC 的请求体。

## 二、合并部署为什么会互相干扰

传统 LLM 服务通常让同一个实例同时执行 Prefill 和 Decode。Continuous Batching 会把新请求和正在生成的请求动态拼入批次，显著提升 GPU 利用率，但它没有消除两类工作负载的冲突。

### 1. 长 Prefill 会制造 Decode 抖动

如果调度器一次执行很长的 Prefill，正在生成的请求就必须等待。平均 TPOT 可能仍然正常，但 p95、p99 ITL 会突然升高，用户看到的就是流式输出停顿。

Chunked Prefill 将长 Prompt 切成若干块，并在块之间插入 Decode，从而缩短单次阻塞时间。这是非常有效的单实例优化，但存在三个边界：

- Chunk 太大，Decode 仍会被阻塞；
- Chunk 太小，Prefill 的内核效率和批处理效率下降；
- 两个阶段仍竞争同一份显存、计算单元和调度预算。

因此 Chunked Prefill 与 PD 分离并非二选一。前者降低单池内部干扰，后者允许两个池独立扩缩和调度；工程中可以同时使用。

### 2. Decode 会拖慢新请求的首 Token

当实例中存在大量活跃生成序列时，调度器若持续保障 Decode，新的 Prefill 就可能在队列中等待。TTFT 由此变成：

```text
TTFT = 排队时间 + Prefill 执行时间 + 首 Token 返回开销
```

很多系统只优化了“Prefill 执行时间”，却忽略排队时间通常才是高负载下的主要尾延迟。PD 分离允许 Prefill 池维护独立的准入和优先级，不必被 Decode 队列的历史状态绑住。

### 3. 一套 GPU 配置很难同时适配两个阶段

Prefill 更关注计算吞吐、Prompt 批量和上下文并行；Decode 更关注显存容量、带宽、可并发序列数以及低抖动调度。合并部署往往只能选择折中配置：同样的张量并行度、相同的实例规格和统一的扩缩容指标。

| 维度 | Prefill 池关注点 | Decode 池关注点 |
| --- | --- | --- |
| 主要 SLO | TTFT | TPOT / ITL |
| 核心压力 | 输入 Token/s | 输出 Token/s、活跃序列数 |
| 常见瓶颈 | 计算、长序列注意力 | HBM 带宽、KV 容量 |
| 批处理目标 | 形成高效大矩阵 | 稳定迭代并摊薄权重读取 |
| 扩容信号 | P 队列、预计等待时间 | D 队列、活跃 Token、ITL |
| 可选并行策略 | TP、PP、上下文并行 | TP、PP，更在意每实例 KV 容量 |

这不意味着 Prefill 永远计算受限、Decode 永远带宽受限。小模型、超长上下文、量化格式和特定 GPU 都可能改变瓶颈。它们应当是性能分析的起点，而不是无需测量的定律。

## 三、PD 分离架构到底增加了什么

一个基本的 PD 系统包含入口路由、Prefill Worker、KV 传输通道、Decode Worker 和全局调度器。请求先在 P 实例完成上下文计算，再携带 KV 元数据被交接给 D 实例，后续 Token 由 D 实例持续生成。

![PD 分离请求链路：从入口调度、Prefill、KV Cache 传输到 Decode 流式输出](/blog-assets/pd-disaggregation/pd-architecture.svg)

### 1. 控制面与数据面应当分开

控制面传递的是几十到几百字节的元数据，例如：

- `request_id` 与租户、优先级；
- 模型版本、Adapter 版本和采样参数；
- Prompt Token 数、预计输出长度；
- KV 块句柄、布局、目标 Worker；
- 请求状态、超时和取消信号。

数据面传递的则是可能达到 GB 级的 KV 张量。让 KV 经过普通 HTTP 服务或中心调度器中转，会制造额外拷贝、内存峰值和单点带宽瓶颈。成熟设计通常让调度器只发放传输计划，由 P、D Worker 或独立缓存层通过 RDMA、GPU Direct、NIXL 等数据通道直接搬运。

### 2. Push、Pull 与共享缓存

KV 交接常见三种方式：

| 模式 | 工作方式 | 优点 | 风险 |
| --- | --- | --- | --- |
| Push | P 直接把 KV 推给选定的 D | 路径直接，完成时延容易度量 | 必须较早绑定 D，目标背压会阻塞 P |
| Pull | P 发布位置，D 就绪后主动拉取 | D 可控制接收节奏 | KV 生命周期和发现协议更复杂 |
| 共享缓存 | P 写入独立 KV/内存池，D 按句柄读取 | 解耦 P 与 D，利于复用和弹性 | 多一层系统，需处理一致性、淘汰与热点 |

没有一种方式对所有集群都最优。同机多 GPU、同机架 RDMA、跨机架以太网的成本模型完全不同。关键是将**拓扑和实时带宽**纳入调度，而不是只比较 Worker 队列长度。

### 3. 请求交接必须是显式协议

工程上最危险的实现，是 P 发送 KV 后就把请求视为“已经交给 D”，而 D 只在完整接收后才记录它。两者之间的故障会让请求失去归属。

更稳妥的交接过程是：

```text
1. Scheduler 为请求选择 D，并签发 transfer_id
2. D 预留 KV 块与接收窗口，返回 READY
3. P 按 transfer_id 传输 KV
4. D 校验块数量、字节数、模型布局与校验信息
5. D 持久记录 OWNED，开始 Decode
6. Scheduler 收到确认后，允许 P 释放 KV
```

取消、超时和重试同样要绑定 `transfer_id`。否则，迟到的数据可能写入已复用的内存块，或同一请求在两个 D 上同时生成。PD 分离本质上增加了一次分布式状态所有权转移，不能只把它当作张量复制。

## 四、KV Cache：收益能否成立的关键账本

### 1. 先估算一份 KV 有多大

对采用 GQA/MQA 的 Transformer，忽略页表和对齐开销，每个 Token 的 KV Cache 大小可近似写成：

```text
KV_bytes_per_token
  = 2 × num_layers × num_kv_heads × head_dim × bytes_per_element
```

其中第一个 `2` 表示 Key 与 Value 两份张量。一个请求在 `S` 个上下文 Token 后的 KV 大小约为：

```text
KV_request ≈ S × KV_bytes_per_token
```

以类似 Llama 3.1 70B 的 GQA 配置为例：80 层、8 个 KV Head、Head Dimension 为 128、BF16 每元素 2 字节：

```text
2 × 80 × 8 × 128 × 2 = 327,680 bytes/token ≈ 320 KiB/token
```

8K Token 的 Prompt 仅原始 KV 就约为 `2.5 GiB`。如果有效传输带宽是 100 Gbit/s，也就是理论上限约 `12.5 GB/s`，只传这份 KV 的理想时间就接近 200 ms；协议、拓扑争用和拷贝通常还会让实际时间更长。

这个例子不是说 PD 一定很慢，而是说明：**必须用具体模型的 KV 形状和有效带宽算账。** MHA 模型的 KV 可能更大，FP8/INT8 KV 量化可以更小；张量并行会把 KV 分散在多张卡上，但集群需要传输的总字节数并不会凭空消失。

### 2. 传输时间不只是“大小除以网速”

可以用下面的近似式建立第一版成本模型：

```text
T_transfer
  ≈ T_setup
  + KV_bytes / B_effective
  + T_serialization
  + T_sync
  + T_contention
```

其中 `B_effective` 是实际可用带宽，不是网卡标称带宽。它会受到 NUMA 路径、PCIe 拓扑、GPU Direct 支持、并发流、交换机拥塞和其他集合通信影响。

更重要的是，传输可能与 Prefill 或 Decode 部分重叠。按层传输、按 KV Block 流式传输，可以让 D 在收到必要状态后更早启动；但流式化也会增加同步次数和实现复杂度。是否值得，取决于重叠后真正落在关键路径上的时间，而不是总传输时长。

### 3. Paged KV 带来的是管理能力，不是免费传输

PagedAttention 将 KV 划分成固定大小的逻辑块，让非连续物理显存可以承载连续序列，并降低碎片。PD 系统可以沿用块表传输和分配 KV，但要保证：

- P 与 D 对块大小、层布局和 dtype 有一致理解；
- 逻辑块 ID 与目标物理地址解耦；
- D 在数据到达前完成容量预留，避免传到一半才 OOM；
- 只在 D 确认接管后释放 P 侧块；
- Prefix Cache 命中时，只传缺失的增量块。

因此，KV Connector 的协议版本应当与模型运行时版本一同治理。模型权重一致并不代表 KV 二进制布局一定兼容。

### 4. Prefix Cache 会改变调度目标

多轮对话、固定 System Prompt 和 RAG 模板经常共享前缀。如果某个 D 已经持有对应前缀，调度器可能宁愿选择队列稍长但缓存命中的实例。此时目标函数不再是“最短队列”，而更接近：

```text
estimated_finish_time
  = queue_delay
  + missing_prefill_cost
  + missing_kv_transfer_cost
  + decode_cost
```

共享 KV 缓存进一步允许 P、D 和不同请求复用上下文，但会引入缓存键正确性、租户隔离、逐出策略和隐私清理问题。缓存键至少应包含模型/Adapter 版本、Token 序列、位置编码相关参数以及会影响隐藏状态的配置。

## 五、调度目标不是利用率，而是 SLO 下的 Goodput

只看 GPU 利用率，很容易得出错误结论：一个始终满载的集群，可能正在让大量请求错过 TTFT 或 TPOT 目标。DistServe 等工作强调的 **Goodput**，指单位时间内满足服务级目标的有效请求数或 Token 数。

可以把请求 `r` 的有效性简化为：

```text
good(r) = 1, if TTFT(r) <= SLO_ttft
                 and TPOT(r) <= SLO_tpot
          0, otherwise

Goodput = sum(good(r)) / observation_window
```

生产系统还可能加入端到端延迟、每分钟 Token、取消率和优先级等约束。核心思想不变：**超时后才完成的吞吐，不一定是业务需要的吞吐。**

### 1. P:D 比例由工作负载决定

粗略地说，Prefill 池容量由输入 Token 到达率决定，Decode 池容量由输出 Token 到达率和并发生命周期决定：

```text
P_load ∝ request_rate × average_prompt_tokens
D_load ∝ request_rate × average_output_tokens
```

但平均值不足以规划在线服务。两个平均长度相同的流量，如果一个长度集中、另一个长尾严重，尾延迟会完全不同。至少应分桶统计：

- Prompt 长度分布，而不只是均值；
- 输出长度分布与停止原因；
- 请求到达过程是否突发；
- Prefix Cache 命中率；
- 模型、Adapter 和优先级占比；
- TTFT、TPOT 的 p50/p95/p99 SLO。

静态 `P:D = 1:2` 之类经验值只能作为压测起点。合理的容量控制器应分别观察 P、D 队列和预计完成时间，在扩容时计入模型加载、通信组初始化和缓存预热时间。

### 2. 路由至少需要三类信息

一个实用的调度分数通常包含：

```text
score(worker, request)
  = a × predicted_queue_delay
  + b × transfer_cost
  + c × cache_miss_cost
  + d × slo_violation_risk
  + e × topology_penalty
```

- **负载信息**：排队请求、运行中 Token、可用 KV 块；
- **局部性信息**：Prefix/Session KV 在哪里，P 与 D 是否同机架；
- **请求信息**：Prompt 长度、输出上限、模型/Adapter、优先级和 SLO。

这些指标必须有时间戳。几百毫秒前的“空闲 Worker”在高 QPS 下可能已经排满。集中式调度器需要处理状态陈旧，分布式调度则需要处理决策冲突，没有一种方式自动获得精确全局视图。

### 3. 准入控制比无限排队更诚实

当 Decode 池饱和时，继续让 P 高速完成 Prefill，只会产生更多待传 KV，占满 P 侧显存或共享缓存。系统需要跨阶段背压：

- D 没有接收容量时，P 降低新请求准入；
- 为已经 Prefill 的请求预留有限缓冲区；
- 按租户和优先级设置队列配额；
- 根据预计 SLO 违约提前降级或拒绝，而不是排队到超时；
- 对超长输入、超长输出使用独立队列或隔离池。

PD 分离把一个队列变成了流水线。任何一个阶段没有背压，都会把拥塞推向 KV 内存或网络。

![PD 系统的闭环调度：SLO、队列、KV 容量与网络共同驱动路由和扩缩容](/blog-assets/pd-disaggregation/scheduling-loop.svg)

## 六、可靠性：多出来的不只是一次网络调用

PD 分离增加了 P Worker、D Worker、KV 通道和调度器之间的组合故障。设计时至少要区分以下场景：

| 故障时点 | 系统已拥有的状态 | 可选恢复策略 |
| --- | --- | --- |
| Prefill 完成前 P 失败 | Prompt、采样参数 | 在其他 P 重算 |
| KV 传输中 P 或链路失败 | 部分 KV Block | 丢弃未完成传输并重算，或从可靠共享缓存续传 |
| D 接收完成但未确认 | P、D 可能各有一份 KV | 通过 transfer 状态查询确定唯一 Owner |
| Decode 中 D 失败 | 已输出 Token、D 上的增量 KV | 重放 Prompt 与已输出 Token；有副本时可切换 |
| 客户端取消 | P/D/网络可能仍在工作 | 广播取消并以请求代次防止迟到写入 |

对普通聊天请求，重新 Prefill 往往比同步复制所有 Decode KV 更经济；对超长上下文或严格可用性场景，DéjàVu 提出的 KV 流式与复制思路更有吸引力。恢复方案不能脱离 Prompt 成本、允许重复计算量和业务 SLO 单独讨论。

还需要明确一个流式输出事实：已经发送给用户的 Token 不能“撤回”。故障恢复若重新采样，可能产生不同后缀。系统可以固定随机状态并重放，也可以在恢复边界向上层暴露中断，而不能假设生成天然幂等。

## 七、从论文看技术演进

PD 分离不是单篇论文定义后就停止变化的架构。相关工作大致沿着四条主线推进：阶段隔离、KV 数据路径、生产级调度，以及多模态阶段拆分。

### 1. 阶段隔离：Splitwise 与 DistServe

**Splitwise** 将生成式 LLM 推理拆成 Prompt 和 Token 两个阶段，在不同机器池执行，并讨论阶段专用硬件、资源配比和调度。它的重要贡献是把“阶段差异”上升为数据中心级资源设计问题，而不只是单实例 Kernel 优化。[1]

**DistServe** 进一步以 TTFT、TPOT SLO 下的 Goodput 为目标，强调 Prefill 与 Decode 共置时的干扰，并通过阶段分离和资源规划提升可满足 SLO 的吞吐。它让 PD 分离有了一个更准确的评价标准：不是峰值 Token/s，而是有多少请求在延迟约束内完成。[2]

两项工作均在 2024 年正式发表：Splitwise 收录于 ISCA 2024，DistServe 收录于 OSDI 2024。它们构成理解 PD 分离的最佳起点。

### 2. KV 数据路径：DéjàVu、CacheGen、MemServe 与 Mooncake

分开 P 和 D 后，KV Cache 立即从“实例内部状态”变成分布式数据对象。

**DéjàVu** 研究 KV Cache 流式传输，并把它用于解耦式推理和故障容错，关注如何在计算过程中移动、复制状态。[3]

**CacheGen** 关注 KV Cache 的压缩与流式传输，目标是在带宽受限环境中降低上下文加载时间。它提醒我们：网络优化不只有“换更快网卡”，也可以改变需要发送的数据表示。[4]

**MemServe** 提出面向解耦式 LLM 服务的上下文缓存和弹性内存池，将 KV 复用与跨实例内存管理结合。该工作目前以 arXiv 预印本形式公开，引用时应与正式发表论文区分。[5]

**Mooncake** 把 KV Cache 提升为架构中心，通过分离式缓存池连接 Prefill 与 Decode，并面向大规模线上服务讨论调度和缓存复用。论文获得 FAST 2025 Best Paper，是从“P/D 分开”走向“KVCache-centric 基础设施”的代表工作。[6]

### 3. 生产级调度：TetriInfer 与 P/D-Serve

真实平台同时承载交互式、批处理和不同长度的下游任务。**TetriInfer** 讨论混合工作负载下的解耦推理，目标是降低不同任务之间的干扰。[7]

**P/D-Serve** 面向大规模 PD 服务，重点处理异构并行配置、调度和生产部署中的可扩展问题。[8] 截至本文写作时，这两项引用来源均为 arXiv 预印本，适合用于理解工程方向，但其结论应结合公开版本状态和自己的环境复测。

到 2026 年，研究重点开始从“PD 是否可行”转向“什么条件下值得分”。MLSys 2026 的 **Beyond the Buzz** 系统评估了跨工作负载和硬件配置的大量设计点，指出分离对 Prefill-heavy 流量和较大模型更有利，而动态速率匹配与弹性扩缩是获得 Pareto 最优结果的关键。[12] 这与工程上的直觉一致：PD 是一个依赖负载、SLO 和拓扑的优化选择，而不是固定答案。

### 4. 从 PD 到 EPD：多模态模型再拆一层

多模态大模型在文本 Prefill 前还有图像或视频编码阶段。编码器与语言模型 Prefill、Decode 的计算形态再次不同，于是 PD 自然演化为 **EPD：Encoder-Prefill-Decode Disaggregation**。

**Efficiently Serving Large Multimodal Models Using EPD Disaggregation** 将视觉 Encoder、Prefill 和 Decode 分别调度，并在 ICML 2025 正式发表。[9] 后续 **HydraInfer** 探索多模态服务中的混合解耦调度，[10] **TriInfer** 则进一步讨论混合 EPD 设计，并收录于 MLSys 2026。[11]

EPD 的意义不只是“多建一个池”。图像分辨率、视觉 Token 数、文本 Prompt 和输出长度共同决定负载；编码结果与文本 KV 还具有不同的复用和生命周期。它证明 PD 更广泛的思想是：**按计算阶段的资源特征和 SLO 拆分服务，再用状态传输把流水线连接起来。**

### 5. 推荐阅读顺序

```text
Splitwise
  -> DistServe
  -> DéjàVu
  -> Mooncake
  -> MemServe / P/D-Serve
  -> EPD Disaggregation
```

前两篇回答“为什么分”，DéjàVu 和 Mooncake 回答“状态怎么移动与复用”，后面的工作回答“怎样扩到生产和多模态”。不要直接比较论文摘要中的提升百分比：基线框架、模型、GPU、网络、长度分布和 SLO 定义不同，数字通常不能横向搬运。

## 八、开源框架中的工程落点

论文给出架构思想，落地时仍需要推理引擎、KV Connector、服务路由和集群基础设施配合。

### 1. vLLM

vLLM 的 PagedAttention、Continuous Batching 和 KV Connector 机制为分离式 Prefill 提供基础。部署时需要把 P、D 角色、KV 传输后端和路由层组合起来。需要注意：

- Connector 能搬运 KV，不等于自动拥有全局 SLO 调度；
- P、D 的模型配置、并行配置和 KV 布局必须兼容；
- 不同 Connector 对 GPU Direct、RDMA、共享存储的要求不同；
- 框架版本迭代较快，应以对应版本的官方文档和示例为准。

### 2. SGLang、NVIDIA Dynamo 与其他系统

SGLang 围绕 Radix Cache、调度与分离式推理持续建设，适合关注前缀复用和多节点服务的团队。NVIDIA Dynamo 将 GPU 推理服务的路由、KV 管理和 PD 分离纳入更完整的分布式运行时。Mooncake、DistServe 等论文也有对应的开源实现或项目页面。

框架选型时，不应只看“支持 PD”这一项勾选框，而要验证：

- 目标模型和量化格式是否支持；
- P/D 是否允许不同 TP/PP 配置，若允许如何重排 KV；
- KV 传输是否真正走预期的数据通道；
- 是否支持 Prefix Cache、Session Affinity 和增量 KV；
- 请求取消、Worker 故障、升级兼容性如何处理；
- 指标能否串起 P 排队、传输和 D 生成三个阶段。

如果平台没有成熟的全局调度能力，先在同构 GPU、同 TP、同机架网络上做最小闭环通常更稳妥。跨硬件、跨并行布局的 KV 重排应当在收益明确后再引入。

## 九、怎样做一场可信的 PD 压测

只跑固定长度、均匀到达的合成请求，很容易得到漂亮但无法指导容量规划的结果。一场可信的对比至少包括三组系统：

1. 合并部署 + Continuous Batching；
2. 合并部署 + Chunked Prefill；
3. PD 分离，并说明 P:D 资源和网络配置。

### 1. 固定总资源与模型质量

对比时应固定 GPU 总数、型号、功率上限、模型版本、量化方式和采样参数。若 PD 方案多用了 GPU 或更快的独占网络，结论必须明确反映资源差异。

### 2. 使用长度联合分布

Prompt 长度与输出长度可能相关。例如代码补全通常输入长、输出短，内容生成可能输入短、输出长。压测应重放真实的 `(prompt_tokens, output_tokens)` 联合分布，并保留请求突发，而不是分别取两个均值。

建议至少覆盖：

- 短输入/短输出；
- 长输入/短输出；
- 短输入/长输出；
- 长输入/长输出；
- 有共享前缀与无共享前缀；
- 稳态流量与突发流量。

### 3. 指标必须拆到阶段

| 指标 | 解释 |
| --- | --- |
| TTFT p50/p95/p99 | 从接入到首 Token 的延迟 |
| TPOT/ITL p50/p95/p99 | 流式生成的平稳程度 |
| E2E latency | 请求完整完成时间 |
| Goodput | 同时满足 TTFT、TPOT SLO 的请求或 Token 吞吐 |
| KV transfer latency | 从 D 预留到可用于 Decode 的关键路径时间 |
| KV transfer bytes | 实际传输量，区分压缩前后与缓存命中 |
| P/D queue delay | 两阶段各自排队时间 |
| Prefix Cache hit rate | 命中请求数和节省 Token 数 |
| rejected/cancelled rate | 准入失败和客户端取消比例 |

GPU 指标还应包含 SM 利用率、HBM 带宽、显存占用和 KV 块碎片；网络指标应包含有效吞吐、重传、拥塞与拓扑维度。只有端到端 Trace 能回答“TTFT 高是 P 排队、Prefill 慢，还是 KV 交接慢”。

### 4. 做成本而不只是性能比较

```text
cost_per_good_request = cluster_cost / good_requests
cost_per_good_token   = cluster_cost / good_tokens
```

PD 可能提高 Goodput，却因低负载时两个池都保留冗余而增加成本；也可能略微增加单请求延迟，却显著提高高峰期 SLO 达成率。评价必须与业务目标对齐。

## 十、什么时候值得做，什么时候不值得

### 适合优先评估 PD 分离

- 在线流量规模较大，TTFT 与 TPOT 都有明确且严格的 SLO；
- Prompt/输出长度差异大，合并部署存在明显阶段干扰；
- 长上下文请求占比高，Prefill 已形成独立容量瓶颈；
- P 与 D 需要不同硬件、并行方式或扩缩容节奏；
- 集群具备高带宽低延迟互联，且拓扑可被调度器感知；
- 团队能维护 KV 数据面、全局调度和跨阶段可观测性。

### 先优化合并部署可能更合理

- QPS 较低，GPU 大部分时间空闲；
- Prompt 很短，KV 传输固定开销占比高；
- 网络较弱或跨机架拥塞不可控；
- 只有少量 GPU，拆池后容易出现一边排队、一边闲置；
- 当前问题可通过 Continuous Batching、Chunked Prefill、量化或 Prefix Cache 解决；
- 团队尚未建立 TTFT/TPOT 分阶段 Trace，无法定位瓶颈。

PD 分离不是“更先进的默认架构”。低 QPS 下，共置实例可以自然共享空闲资源；拆分后，P 和 D 的容量不能轻易互借，反而可能降低利用率。只有当**减少干扰与独立扩缩的收益，大于 KV 传输、资源碎片和系统复杂度**时，分离才有价值。

## 十一、一条可执行的落地路径

### 第一步：先建立基线

在现有合并部署中采集请求级 TTFT、TPOT、输入/输出长度、排队时间和 Prefix 命中。分别压测 Continuous Batching 与 Chunked Prefill，确认问题确实来自阶段干扰，而不是模型 Kernel、网关排队或下游限流。

### 第二步：离线建立容量模型

对目标模型测量不同 Prompt 长度、Batch、并行度下的 Prefill 时间，以及不同活跃序列数下的 Decode Token/s。再按真实流量回放，估算初始 P:D 比例和 KV 带宽上限。

### 第三步：做最小同构闭环

先使用相同 GPU、相同并行布局和同机架互联，打通 P -> KV -> D。把状态机、取消、超时、容量预留和端到端 Trace 做完整，不急于同时引入异构硬件和远端缓存。

### 第四步：加入拓扑感知和背压

让调度器使用 D 可用 KV 块、P/D 队列、缓存位置与网络拓扑做选择。通过容量令牌限制已 Prefill 未 Decode 的请求数，验证 D 饱和时系统不会把 P 和缓存一同拖垮。

### 第五步：灰度并以 Goodput 验收

在相同总资源下，对真实流量小比例灰度。验收重点是 SLO Goodput、尾延迟和单位有效 Token 成本，而不是单项峰值吞吐。故障演练应覆盖 P/D 崩溃、KV 通道中断、调度器重启和客户端取消。

### 第六步：收益明确后再扩展

当基础链路稳定后，再考虑异构 P/D、共享 KV 池、KV 压缩、跨机架调度和 EPD。每增加一层解耦，都应有可量化的瓶颈与回退方案。

## 十二、总结

PD 分离抓住了一个真实矛盾：Prefill 与 Decode 虽然属于同一次推理，却有不同的计算形态、延迟目标和容量驱动因素。把它们拆成独立资源池，可以降低互相干扰、分别扩缩容，并为异构硬件和大规模调度打开空间。

代价同样明确：KV Cache 从本地状态变成需要管理、传输和恢复的分布式对象；一个实例内部队列变成带背压的两段流水线；调优对象从 GPU 利用率扩展到 TTFT、TPOT、Goodput、缓存局部性和网络拓扑。

因此，判断一个 PD 系统是否优秀，不应只问“P 和 D 是否部署在不同节点”，而应连续追问：

1. KV 在关键路径上增加了多少时间和字节？
2. 调度是否同时理解 SLO、队列、缓存和拓扑？
3. P、D 比例能否随工作负载变化？
4. 所有权交接和故障恢复是否有明确协议？
5. 在相同总资源下，Goodput 和单位有效 Token 成本是否真的改善？

能回答这五个问题，PD 分离才从一张架构图变成可运行、可度量、可演进的推理系统。

## 参考资料

1. Microsoft Research, [Splitwise: Efficient Generative LLM Inference Using Phase Splitting](https://www.microsoft.com/en-us/research/publication/splitwise-efficient-generative-llm-inference-using-phase-splitting/), ISCA 2024；[arXiv:2311.18677](https://arxiv.org/abs/2311.18677)。
2. Yinmin Zhong et al., [DistServe: Disaggregating Prefill and Decoding for Goodput-optimized Large Language Model Serving](https://www.usenix.org/conference/osdi24/presentation/zhong-yinmin), OSDI 2024；[项目代码](https://github.com/LLMServe/DistServe)。
3. Rohan Strati et al., [DéjàVu: KV-cache Streaming for Fast, Fault-tolerant Generative LLM Serving](https://proceedings.mlr.press/v235/strati24a.html), ICML 2024。
4. Yuhan Liu et al., [CacheGen: KV Cache Compression and Streaming for Fast Large Language Model Serving](https://doi.org/10.1145/3651890.3672274), SIGCOMM 2024。
5. Yuhan Liu et al., [MemServe: Context Caching for Disaggregated LLM Serving with Elastic Memory Pool](https://arxiv.org/abs/2406.17565), arXiv 预印本，2024。
6. Ruoyu Qin et al., [Mooncake: Trading More Storage for Less Computation — A KVCache-centric Architecture for Serving LLM Chatbot](https://www.usenix.org/conference/fast25/presentation/qin), FAST 2025 Best Paper；其 arXiv 题名为 *Mooncake: A KVCache-centric Disaggregated Architecture for LLM Serving*，[项目主页](https://kvcache-ai.github.io/Mooncake/)。
7. Jiangfei Duan et al., [Inference without Interference: Disaggregate LLM Inference for Mixed Downstream Workloads](https://arxiv.org/abs/2401.11181), arXiv 预印本，2024。
8. Jiamin Yin et al., [P/D-Serve: Serving Disaggregated Large Language Model at Scale](https://arxiv.org/abs/2408.08147), arXiv 预印本，2024。
9. Gursimran Singh et al., [Efficiently Serving Large Multimodal Models Using EPD Disaggregation](https://proceedings.mlr.press/v267/singh25d.html), ICML 2025；[项目代码](https://github.com/vbdi/epdserve)。
10. [HydraInfer: Hybrid Disaggregated Scheduling for Multimodal Large Language Model Serving](https://arxiv.org/abs/2505.12658), arXiv 预印本，2025。
11. [TriInfer: Hybrid EPD Disaggregation for Efficient Multimodal Large Language Model Inference](https://proceedings.mlsys.org/paper_files/paper/2026/hash/f068c65585985c25c17f221390774ec7-Abstract-Conference.html), MLSys 2026。
12. Tiyasa Mitra et al., [Beyond the Buzz: A Pragmatic Take on Inference Disaggregation](https://proceedings.mlsys.org/paper_files/paper/2026/hash/d49cee5f3a79d97d719df255689d83d7-Abstract-Conference.html), MLSys 2026。
