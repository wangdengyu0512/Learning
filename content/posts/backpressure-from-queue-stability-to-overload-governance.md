---
title: 背压：从队列稳定性到过载治理
description: 从生产者与消费者的速率失配出发，理解背压如何传播容量信号，以及它与缓冲、限流、拥塞控制、丢弃、扩缩容之间的边界。
date: 2026-10-28
tags: 分布式系统, 流处理, 系统设计
featured: false
---

# 背压：从队列稳定性到过载治理

在一个数据处理链路里，上游每秒产生 10 万条事件，下游只能处理 6 万条。最初几秒，系统看起来仍然正常：多出来的数据先进入内存队列，延迟只增加了一点。几分钟后，队列越来越长，消息变得陈旧，内存开始吃紧；再往后，Full GC、超时和重试同时出现，原本局部的慢消费者最终拖垮整条链路。

这不是某个框架特有的问题，而是所有异步系统都要面对的基本矛盾：**生产速率和消费能力并不总是相等。**

背压（backpressure）就是为这个矛盾建立反馈。当下游接近容量上限时，它不再默默接收无限数据，而是把“我现在只能处理这么多”的信号传回上游，让上游减速、暂停或改变处理策略。

但背压很容易被说成一句过于宽泛的话：“消费者慢了，就让生产者慢一点。”这句话没有回答几个真正决定系统行为的问题：

- 下游用什么信号表达剩余容量？
- 信号如何跨线程、进程和网络逐级向上游传播？
- 在信号生效前，已经到达的数据放在哪里？
- 如果数据源根本不能减速，系统应该阻塞、丢弃还是拒绝？
- 如果长期输入速率大于处理能力，背压还能维持多久？

本文的核心结论是：

> **背压是容量失衡的反馈机制，而不是容量本身。它能阻止系统无界积压，却不能消除长期的算力不足；持续背压最终必须转化为扩容、降级、丢弃或拒绝。**

要真正理解背压，需要同时看三个层次：排队论中的稳定性、异步流中的反馈式流控，以及生产系统中的过载治理。

---

## 一、先从一条不断增长的队列开始

把系统简化成一个生产者、一个队列和一个消费者：

```text
Producer  -- λp -->  [ Queue: Q(t) ]  -- λc -->  Consumer
```

其中：

- `λp` 是单位时间进入队列的数据量；
- `λc` 是单位时间完成处理的数据量；
- `Q(t)` 是时刻 `t` 的队列长度。

暂时忽略速率波动，可以得到一个非常粗略但有用的关系：

```text
Q(t) ≈ Q(0) + (λp - λc) × t
```

当 `λp < λc` 时，消费者有余力消化积压，队列最终可以回落；当 `λp = λc` 时，系统没有为抖动留下余量；当 `λp > λc` 持续成立时，队列必然增长。

假设生产者每秒写入 10 万条，消费者每秒处理 6 万条，每条消息连同索引和对象开销占 1 KB，那么队列每秒增加约 40 MB：

```text
(100000 - 60000) × 1 KB ≈ 40 MB/s
```

10 GB 空闲内存只能多争取四分钟左右。把缓冲区扩大十倍，只是把故障从四分钟推迟到四十分钟，并没有改变系统最终失稳的事实。

### 突发流量和持续过载不是一回事

缓冲区并非没有价值。真实流量存在短时抖动，消费者也会因为 GC、缓存未命中、Checkpoint 或下游 I/O 偶尔变慢。只要高峰结束后 `λc` 能重新大于 `λp`，队列就可以吸收突发并在之后排空。

因此要区分两种情形：

| 情形 | 特征 | 合理手段 |
| --- | --- | --- |
| 短时突发 | 峰值过后有能力追平 | 有界缓冲、批处理、短时背压 |
| 持续过载 | 长期平均输入超过服务能力 | 扩容、降级、丢弃、拒绝或改变业务目标 |

背压的首要作用，是让系统从“无界积压后突然崩溃”变成“在明确边界内减速并暴露压力”。它控制失败方式，却不会凭空创造吞吐量。

### 队列长度为什么还会变成延迟

根据 Little's Law，在一个相对稳定的系统中：

```text
L = λ × W
```

`L` 是系统中的平均任务数，`λ` 是有效到达率，`W` 是任务在系统中的平均停留时间。直觉上，吞吐不变时，排队越长，等待越久。

这意味着“队列还没满”并不代表系统健康。一个容量为 100 万的队列即使只用了 30%，也可能已经让事件等待数十秒，超过业务的时效要求。对实时系统而言，**延迟预算通常比内存上限更早耗尽**。

---

## 二、学术论文里的 Backpressure 和工程里的背压

检索论文时会遇到两条都叫 Backpressure、但不能直接画等号的研究路线。

### 1. 排队网络中的 Backpressure Routing

Tassiulas 和 Ephremides 在 1992 年研究受约束排队网络的调度问题，给出了具有最大吞吐性质的策略[1]。后续文献常把这类方法称为 Backpressure Routing 或 Max-Weight Scheduling。

它的基本直觉是：比较相邻节点对某类流量的队列差，把链路资源优先分配给“上游积压显著高于下游”的方向。队列差形成一种压力：

```text
pressure(i -> j, commodity c) = Qi(c) - Qj(c)
```

调度器再结合链路容量和并发约束，选择本轮应该激活的传输。这里的核心问题是：在多跳网络和受约束服务资源中，怎样选择路由与调度，使到达率位于可稳定区域内时，所有队列保持稳定。

这是一套关于**队列稳定性与资源调度**的理论，不是 Reactive Streams 中 `request(n)` 接口的早期版本。二者共享“用下游状态反向影响上游决策”的思想，但信号、控制对象和理论目标都不同。

### 2. 异步数据流中的 Backpressure

在 Reactive Streams、Node.js Stream、Flink 或 Heron 中，背压通常指下游通过需求量、信用额度、缓冲区水位或阻塞状态，限制上游继续发送数据。

这一语境下，问题更像：

```text
下游还能接收多少？
    ↓
把容量信号向上游传播
    ↓
上游只发送被允许的数据量
```

例如 Reactive Streams 的订阅者调用 `request(n)`，表示自己准备再接收 `n` 个元素；发布者不得发送超过累计需求量的数据[2]。这里的控制信号不是队列差，而是明确的 demand。

### 3. 两条路线的共同结构

虽然不能混为同一算法，它们可以放进同一个控制框架：

1. **观察状态**：队列长度、可用缓冲、处理延迟或消费需求；
2. **形成反馈**：把局部容量或拥塞信息传给能够改变发送行为的一方；
3. **执行控制**：减少发送、暂停读取、调整调度或改变路由；
4. **追求稳定**：避免积压无界增长，同时尽量保持吞吐与公平性。

2024 年的流处理系统综述把 backpressure 放在流控与负载管理的演进中讨论：在生产者和消费者组成的执行图里，压力会沿图向上游传播，使算子速率逐渐受最慢消费者约束[3]。这正是理解现代流引擎背压的合适入口。

---

## 三、背压机制究竟由什么组成

一个可工作的背压方案至少包含四个部分：容量边界、反馈信号、传播路径和上游动作。

### 容量边界：什么情况下算“接不动了”

如果系统没有边界，就没有清晰的背压触发点。常见边界包括：

- 队列最大元素数或最大字节数；
- 网络发送缓冲区的高水位；
- 并发请求上限；
- 可用信用额度（credit）；
- 消费者主动声明的需求量；
- 端到端延迟或事件时效上限。

只按元素个数限制队列可能不够，因为一条 100 B 的指标和一条 10 MB 的日志对内存的影响完全不同。生产系统通常需要同时约束元素数、字节数和时间。

### 反馈信号：下游如何表达容量

常见信号可以分为几类：

| 信号 | 示例 | 特点 |
| --- | --- | --- |
| 需求量 | Reactive Streams `request(n)` | 下游主动拉取，语义明确 |
| 信用额度 | Flink 网络 credit | 只有拿到下游 buffer credit 才能发送 |
| 水位线 | 高水位暂停、低水位恢复 | 实现简单，需要滞回避免频繁抖动 |
| 阻塞/不可写 | socket buffer 满、channel not writable | 可复用系统调用，但信号粒度可能过粗 |
| 控制器输出 | 根据处理时间计算下一批输入率 | 能吸收动态变化，但参数不当会振荡 |

### 传播路径：压力必须回到真正的源头

设有一条三段流水线：

```text
Source -> Parse -> Enrich -> Sink
```

如果 Sink 变慢，只让 Enrich 暂停还不够。Enrich 的输入队列很快会填满，压力需要继续传给 Parse，再由 Parse 传回 Source。只有 Source 最终减少读取或发送，整条链路才形成闭环。

一个中间算子如果收到背压后仍继续从上游拉取、只是把数据转存到另一个无界队列，实际上切断了反馈链。系统表面上“支持背压”，压力却被隐藏在新的内存或磁盘积压里。

### 上游动作：收到信号之后做什么

上游并不总能简单地“慢一点”。它可能采取不同动作：

- 暂停从 socket、文件或消息队列读取；
- 减少下一批拉取数量；
- 降低并发度或发送速率；
- 阻塞当前写入调用；
- 将请求明确拒绝给调用方；
- 对允许损失的数据采样、合并或丢弃；
- 扩展处理实例，增加服务率。

因此，“支持背压”不是一个布尔属性。必须继续问：**信号是什么、传到哪里、触发什么动作、积压最终由谁承担。**

---

## 四、Push、Pull 与 Push-Pull

背压的实现方式与数据传输模型密切相关。

### Push：发送者主导

在纯 Push 模型中，生产者一有数据就主动发送。优点是路径直接、低负载时延迟低；问题是生产者天然不知道消费者还剩多少容量。

要加入背压，通常需要额外机制：

- 写入返回成功或“暂不可写”；
- 缓冲区达到高水位后通知暂停；
- 消费者显式发送 pause/resume；
- 中间层拒绝或丢弃数据。

如果生产者忽略返回值，Push API 即使提供了背压也没有意义。Node.js 可写流的 `write()` 返回 `false` 时，调用方应停止继续写入并等待 `drain`；继续无视返回值写入，只会把压力留在内存里。

### Pull：消费者主导

Pull 模型中，消费者准备好后再请求数据。由于请求本身携带需求，背压更自然：没有请求，就不发送。

但 Pull 也有成本。逐条请求会增加往返和调度开销，批量拉取又需要在吞吐、延迟和内存之间取舍。如果源头是不可暂停的外部事件，例如传感器、网络报文或用户请求，Pull 只能控制系统何时读取，无法让事件停止产生。

### Push-Pull：用窗口或信用额度连接两者

许多高吞吐系统采用混合模型：消费者预先授予一批额度，生产者在额度内连续 Push，用完后再申请或等待新的额度。

```text
Consumer -- credit = 128 --> Producer
Consumer <-- 128 items ----- Producer
Consumer -- credit = 64 ---> Producer
```

它既避免逐条握手，又维持有界的在途数据。Reactive Streams 的 `request(n)`、HTTP/2 的流控窗口以及流处理引擎里的 credit-based flow control，都可以从这个角度理解，但它们的控制范围和协议语义并不相同。

---

## 五、Reactive Streams：用 demand 建立协议边界

Reactive Streams 规范的目标，是为异步流处理定义带非阻塞背压的互操作协议[2]。它的核心接口很小：

```java
public interface Publisher<T> {
    void subscribe(Subscriber<? super T> subscriber);
}

public interface Subscriber<T> {
    void onSubscribe(Subscription subscription);
    void onNext(T item);
    void onError(Throwable throwable);
    void onComplete();
}

public interface Subscription {
    void request(long n);
    void cancel();
}
```

真正关键的是协议约束：

1. 订阅建立后，Subscriber 通过 `request(n)` 增加累计需求；
2. Publisher 发送的 `onNext` 数量不能超过已声明但尚未满足的需求；
3. Subscriber 可以分批申请，以自己的处理能力控制节奏；
4. 不再需要数据时可以 `cancel()`，终止上游工作和资源占用。

一个保守的订阅者可以一次只申请一条：

```java
public final class OneByOneSubscriber<T> implements Subscriber<T> {
    private Subscription subscription;

    @Override
    public void onSubscribe(Subscription subscription) {
        this.subscription = subscription;
        subscription.request(1);
    }

    @Override
    public void onNext(T item) {
        process(item);
        subscription.request(1);
    }

    @Override
    public void onError(Throwable error) {
        log(error);
    }

    @Override
    public void onComplete() {
        close();
    }
}
```

这样做能把在途元素限制得很小，但吞吐可能受调度和往返影响。实践中通常批量申请，并在剩余额度降到阈值时补充：

```text
初始 request(256)
每消费 192 条，再 request(192)
```

这里有两个容易忽略的事实。

第一，`request(n)` 控制的是**元素数量**，不直接控制元素占用的字节数或处理成本。如果元素大小差异巨大，仍需额外的内存预算和大对象限制。

第二，背压必须贯穿算子链。某个算子如果为了提高并发而启用无界预取，或把任务交给无界线程池队列，需求协议就在该处失去保护作用。

---

## 六、流处理系统如何把压力传回 Source

分布式流处理比单进程 Reactive Stream 更复杂：一个作业是跨机器的有向图，数据经过网络 shuffle、多个分区和有状态算子。一个慢点可能通过多条边扩散。

### Heron：为什么直接依赖 TCP 还不够

Twitter 的 Heron 论文专门讨论了拓扑背压[4]。其早期思路是利用 TCP：当下游实例消费变慢，接收缓冲区填满，发送侧缓冲区也会变满，TCP 可写性自然把压力传回上游。

这个方案简单，但论文指出，多条逻辑通道复用在 Stream Manager 之间的物理连接上时，一条通道拥塞可能连带阻塞其他通道，形成 Head-of-Line Blocking。局部慢消费者会污染共享连接，导致拥塞传播范围过大、恢复缓慢。

Heron 因而采用更显式的拓扑级控制：应用缓冲区设置高、低水位；达到高水位时触发背压，只有下降到低水位后才解除，并最终限制 Source 向拓扑注入新数据。

高低两个阈值很重要。如果只用一个阈值，队列在边界附近波动时，系统会频繁暂停和恢复：

```text
高水位：80% -> pause
低水位：50% -> resume
```

这段差值称为滞回（hysteresis），用于抑制控制抖动。

### Flink：背压是执行图中的传播现象

Flink 的网络栈使用有界的网络缓冲，并通过 credit-based flow control 告知上游接收方还有多少可用 buffer。下游任务不能及时消费时，可用 credit 减少，上游发送受限，压力再沿数据流图向 Source 传播[3][5]。

这会产生一个重要的运维现象：**显示背压的算子未必是根因。** 上游算子处于 backpressured 状态，可能只是因为更下游的 Sink、外部数据库或热点分区变慢。诊断时不能看到第一个红色指标就扩容该算子，而应沿执行图向下游寻找最早出现高 busy time、长处理延迟或低吞吐的位置。

### Spark Streaming：背压本身也需要一个稳定控制器

微批系统常根据上一批的处理时间和调度延迟调整下一批的输入速率。它不是简单的“满了就停”，而是一个动态反馈控制问题。

GOVERNOR 论文研究了 Spark Streaming 中 Checkpoint 对背压控制器的干扰[6]。Checkpoint 会引入可变的额外延迟，如果控制器把它全部误判成正常处理能力下降，就可能过度削减下一批输入；随后延迟降低，输入又突然增加，系统形成吞吐振荡。GOVERNOR 把 Checkpoint 成本纳入控制模型，在论文实验中提升了吞吐并降低资源耗尽风险。

这个案例说明：**有反馈不等于反馈稳定。** 信号延迟、采样周期、阈值和增益都会影响系统是否振荡。背压设计也要面对控制系统中的过冲、滞后和稳态误差。

---

## 七、缓冲、阻塞、丢弃、拒绝和扩容如何选择

背压只负责暴露和传递容量约束，系统仍要决定如何处理超过当前能力的工作。常见策略并不是互斥的，而是分阶段组合。

| 策略 | 适合的问题 | 主要代价 |
| --- | --- | --- |
| 有界缓冲 | 吸收短时突发和速率抖动 | 增加内存与排队延迟 |
| 阻塞/暂停 | 上游可等待、链路可传播压力 | 占用连接或线程，可能扩大故障域 |
| 丢弃/采样 | 指标、遥测等允许近似的数据 | 信息损失，需要定义保留价值 |
| 拒绝 | 在线请求、任务提交等可快速失败的入口 | 调用方必须处理失败和重试 |
| 降级 | 可牺牲精度、功能或新鲜度 | 业务质量下降 |
| 扩容 | 工作可并行且仍有资源 | 生效有延迟，也可能受外部瓶颈限制 |

### 为什么有界缓冲通常是第一道边界

无界队列把一个可观察、可恢复的过载问题变成内存耗尽。队列应该有明确上限，并在达到上限前触发动作。

上限不能只按“机器能放多少”设置，还要从业务延迟反推。若最大可接受排队时间为 2 秒，稳定处理能力为每秒 5000 条，那么队列预算大致不应远高于 1 万条；否则即使没有 OOM，数据也已经失去时效。

```text
queue_budget ≈ sustainable_rate × allowed_queueing_time
```

这只是初始估算，还需为消息大小、批处理、并发和尾延迟留出余量。

### 当源头不能减速时，必须选择损失发生在哪里

消息队列消费者可以暂停拉取，文件读取可以停在当前位置，但用户请求、UDP 数据包和传感器事件不会因为内部背压自动消失。此时系统只能选择：

- 在入口拒绝，保护内部资源；
- 把数据落到一个真正持久、容量可治理的日志；
- 丢弃低价值事件；
- 降低处理精度；
- 接受延迟增长，但设置明确上限。

“一条都不能丢、请求都不能拒绝、延迟不能增加、也不能扩容”不是背压策略，而是一组无法同时满足的约束。

### Load Shedding 是过载治理，不是背压的同义词

Tatbul 等人在 2003 年研究数据流系统的 Load Shedding：当输入率超过容量时，动态向查询计划插入 drop operator，以牺牲一定结果质量换取可接受的延迟[7]。论文区分随机丢弃与基于内容重要性的丢弃。

背压的目标通常是限制继续进入系统的工作量；Load Shedding 则主动舍弃一部分工作。二者可以结合：先用背压平滑短时突发，当持续过载且源头不可控时，再按业务价值丢弃。

---

## 八、背压不等于限流、流控或拥塞控制

这些概念经常一起出现，但控制目标和作用范围不同。

### 背压与限流

限流（rate limiting）通常在入口实施预设策略，例如每个租户每秒最多 1000 次请求。它保护配额、公平性和容量预算，限制值可以在请求到来前就确定。

背压则更多由运行时下游状态触发。同一个入口在系统空闲时可以高速接收，在下游变慢时减少接收。两者常配合使用：限流给出长期预算，背压应对短期动态变化。

### 背压与流控

流控（flow control）防止发送方压垮接收方，背压可以视为跨处理链传播的反馈式流控。TCP 接收窗口和 HTTP/2 流控窗口都限制发送者在途数据，但它们只知道协议层缓冲，不一定知道应用是否真正处理完业务。

例如服务器快速把请求体读入内存，TCP 窗口就可能继续打开，即使业务线程池早已拥塞。网络流控不能自动替代应用层容量治理。

### 背压与拥塞控制

拥塞控制（congestion control）主要保护网络路径和共享链路；接收端流控保护特定接收方。两者可能使用窗口、速率和反馈等相似工具，但观察对象不同。

Goyal 等人在 NSDI 2022 提出的 Backpressure Flow Control（BFC）是一个网络领域案例：它采用逐跳、逐流的反馈，并在可编程交换机上用有界状态近似实现，目标是在数据中心突发流量下改善吞吐和尾延迟[8]。这进一步说明“背压”是一类反馈思想，而不是一个跨领域完全相同的协议。

### 背压与阻塞

阻塞是收到压力后可能采取的动作，不是背压本身。同步写入在队列满时阻塞线程，确实能让调用方减速，但也可能耗尽线程池，甚至产生循环依赖：A 等 B 释放队列，B 又等 A 的线程执行回调。

非阻塞背压把“暂时不能继续”编码为 demand、future、可写事件或异步信号，让线程可以处理其他工作。它减少线程占用，但并不会降低协议和状态机的复杂度。

---

## 九、背压为什么可能把故障传得更远

背压能阻止局部队列爆炸，也可能把一个下游问题传播到更多上游调用者。这不是机制失效，而是压力传播的必然结果；设计目标应是让传播可控。

### Head-of-Line Blocking

如果多个租户、分区或逻辑流共享同一个 FIFO 队列、连接或线程池，一个慢流可能挡住其他健康流。Heron 对 TCP 复用连接的观察就是典型案例[4]。

缓解方式包括：

- 按租户、分区或优先级隔离队列；
- 使用公平调度，限制单一流占用；
- 为关键流预留容量；
- 避免把所有逻辑通道复用到一个不可区分的阻塞点。

### 反馈风暴与同步恢复

大量实例在同一阈值暂停，又在同一时刻恢复，可能造成周期性流量尖峰。可以通过高低水位、随机抖动、分批恢复和自适应窗口降低同步效应。

### 超时和重试会制造新的生产者

当排队时间变长，上游请求开始超时；如果客户端立即重试，原始请求可能仍在队列中，于是输入率进一步上升：

```text
过载 -> 排队 -> 超时 -> 重试 -> 更高输入率 -> 更严重过载
```

这类正反馈会抵消背压。生产系统需要把超时、重试预算、幂等、指数退避、熔断和入口拒绝一起设计。尤其不能让每一层都独立重试三次，否则一次用户请求可能被放大成指数级下游调用。

### “暂停读取”会把压力转移给谁

服务 A 停止读取 socket 后，数据可能留在内核缓冲区，再通过 TCP 窗口传给服务 B；B 随后也可能积压。使用 Kafka 一类持久日志时，暂停消费则把 backlog 留在 broker。

压力不会消失，只会改变承载位置。好的设计会把积压留在**容量明确、持久可靠、可观测且易于扩展**的层，而不是散落在进程堆、线程池队列和内核缓冲区里。

---

## 十、怎样判断背压正在保护系统，还是正在掩盖问题

只看 CPU 和内存，很难诊断背压。至少需要同时观察速率、队列、时间和控制动作。

### 速率

- 各阶段输入速率与输出速率；
- Source 实际读取速率与外部到达速率；
- 成功、失败、丢弃和拒绝速率；
- 各分区或 key 的吞吐分布。

### 队列

- 当前长度、字节数和容量使用率；
- oldest item age，即最老元素已等待多久；
- 消息队列 consumer lag；
- in-flight 请求或未完成任务数。

### 时间

- 服务时间与排队时间；
- 端到端 p50、p95、p99 延迟；
- 背压信号从下游传播到 Source 的时间；
- 触发背压后恢复到稳态所需时间。

### 控制动作

- 背压持续时间和占运行时间比例；
- pause/resume 或窗口调整次数；
- demand、credit 或可写状态；
- 扩缩容、降级、丢弃和拒绝是否触发。

其中，`oldest item age` 往往比队列长度更接近业务影响。队列长度为 1 万可能只是毫秒级批量，也可能代表积压了半小时；消息年龄能直接回答数据是否仍有价值。

### 一条实用的排查路径

当上游出现持续背压时，可以按以下顺序定位：

1. 沿执行图向下游寻找首个处理速率下降或 busy time 异常的节点；
2. 将排队时间与实际服务时间分开，判断是在等资源还是执行变慢；
3. 检查是否只有部分 key、分区、租户或连接过载；
4. 检查数据库、对象存储、外部 API 和网络等系统边界；
5. 对齐 GC、Checkpoint、部署、流量变化和故障时间线；
6. 确认重试是否放大输入，扩容是否真的提升了瓶颈处的 `λc`。

背压指标高并不天然是故障。如果系统正在有界地吸收一次短峰值，随后队列恢复，说明保护机制在工作。真正危险的信号是：背压长期不解除、消息年龄持续增加、吞吐没有恢复，而且拒绝或丢弃策略仍未启动。

---

## 十一、设计一套背压方案的工程清单

可以从以下问题开始，而不是先选择某个框架 API。

### 1. 明确业务不变量

- 数据是否允许丢失？
- 是否允许重复？
- 最大可接受延迟是多少？
- 哪些租户或事件优先级更高？
- 过载时应优先保吞吐、时效、完整性还是公平性？

这些答案决定系统是等待、拒绝还是丢弃。技术组件不能替业务做这个决定。

### 2. 找到每一个有界资源

列出内存、线程、连接、文件句柄、网络缓冲、外部 API 配额、分区和磁盘吞吐。对每个异步边界明确：

- 容量上限；
- 满载信号；
- 谁接收信号；
- 接收后执行什么动作；
- 最坏情况下数据保存在哪里。

### 3. 让压力传播到可治理的入口

反馈链不能终止在某个无界线程池或临时缓存。理想情况下，压力应抵达能够真正减少工作量的位置，例如 Kafka consumer、任务提交 API、HTTP gateway 或数据采集端。

### 4. 为持续过载设计第二方案

背压触发一段时间后，必须有升级动作：

- 自动或人工扩容；
- 按优先级丢弃；
- 降低计算精度或关闭非核心步骤；
- 快速拒绝并给出可重试信号；
- 切换到离线补偿流程。

### 5. 用故障注入验证，而不是只做稳态压测

至少测试以下场景：

- 下游吞吐突然下降 50%；
- 单个分区或热点 key 变慢；
- Checkpoint、GC 与流量高峰重叠；
- 下游完全不可用后再恢复；
- 客户端超时并重试；
- 扩容需要数分钟才能生效。

验证的不只是“系统没崩”，还包括队列是否有界、信号是否传播、健康流是否被隔离，以及恢复后能否平稳排空积压。

---

## 十二、一个端到端的设计示例

假设要设计一条订单事件处理链：

```text
API -> Kafka -> Validation -> Pricing -> Database
```

业务要求订单不可静默丢失，正常端到端延迟小于 2 秒，数据库短时抖动可以容忍，但持续过载时宁可入口拒绝新请求，也不能把整个系统拖垮。

可以形成如下策略：

1. API 先做租户限流与全局并发限制，超过长期容量预算时返回明确的可重试错误；
2. 已接收的订单先写入 Kafka，只有持久化成功才向调用方确认；
3. 消费者使用有限的 `max.poll.records` 和有界并发，数据库连接池大小决定最大在途写入数；
4. 数据库变慢时，消费者降低拉取或暂停分区，把积压集中保留在 Kafka，而不是放进 JVM 无界队列；
5. 监控 consumer lag 的同时监控最老订单年龄，因为 2 秒时效比 broker 磁盘容量更早成为约束；
6. 短时抖动由 Kafka backlog 吸收，持续背压触发消费者扩容；
7. 若数据库已经达到写入上限，继续扩消费者无效，入口应进一步收紧并停止非核心衍生计算；
8. 客户端重试必须携带幂等键并采用退避，避免超时订单重复放大流量。

这个方案里，Kafka 是有意选择的积压承载层，暂停消费是背压动作，入口拒绝是持续过载的治理手段，扩容是提升服务率的尝试。四者职责不同，但共同构成闭环。

---

## 结语：背压的价值是让容量边界成为协议

异步系统最危险的状态，不是“慢”本身，而是各组件假装下游永远接得住：生产者持续发送，中间层持续缓存，调用方持续重试，直到某个隐蔽资源突然耗尽。

背压把下游容量从一个内部实现细节，变成上下游之间可传播的协议。它要求系统明确回答：还能接收多少、何时应该暂停、压力由谁承担、什么时候恢复，以及长期超载时舍弃什么。

最终可以把整篇文章压缩成三句话：

1. **队列可以吸收波动，但不能修复长期的速率失配。**
2. **背压通过反馈让压力回到能够减速或拒绝工作的入口。**
3. **当输入长期超过容量时，系统必须扩容、降级、丢弃或拒绝。**

因此，评价一个系统是否“支持背压”，不能只看它有没有 `request(n)`、pause/resume 或高水位 API。更重要的是看反馈链是否完整、缓冲是否有界、故障是否隔离，以及压力持续存在时，系统是否有清晰而可执行的过载策略。

---

## 参考文献与延伸阅读

[1] L. Tassiulas, A. Ephremides. [Stability Properties of Constrained Queueing Systems and Scheduling Policies for Maximum Throughput in Multihop Radio Networks](https://drum.lib.umd.edu/items/571fda52-aefb-4497-9a2d-69d8c7c907b9). *IEEE Transactions on Automatic Control*, 37(12): 1936–1948, 1992. DOI: 10.1109/9.182479.

[2] Reactive Streams. [Reactive Streams Specification for the JVM](https://github.com/reactive-streams/reactive-streams-jvm). Version 1.0.4.

[3] M. Fragkoulis, P. Carbone, V. Kalavri, A. Katsifodimos. [A Survey on the Evolution of Stream Processing Systems](https://doi.org/10.1007/s00778-023-00819-8). *The VLDB Journal*, 33: 507–541, 2024.

[4] S. Kulkarni, N. Bhagat, M. Fu, et al. [Twitter Heron: Stream Processing at Scale](https://doi.org/10.1145/2723372.2742788). *Proceedings of the 2015 ACM SIGMOD International Conference on Management of Data*, 239–250, 2015.

[5] Apache Flink. [Monitoring Back Pressure](https://nightlies.apache.org/flink/flink-docs-master/docs/ops/monitoring/back_pressure/); [Network Buffer Tuning](https://nightlies.apache.org/flink/flink-docs-master/docs/deployment/memory/network_mem_tuning/). Flink Documentation.

[6] X. Chen, Y. Vigfusson, D. M. Blough, F. Zheng, K.-L. Wu, L. Hu. [GOVERNOR: Smoother Stream Processing Through Smarter Backpressure](https://research.ibm.com/publications/governor-smoother-stream-processing-through-smarter-backpressure). *2017 IEEE International Conference on Autonomic Computing*, 145–154, 2017. DOI: 10.1109/ICAC.2017.31.

[7] N. Tatbul, U. Cetintemel, S. Zdonik, M. Cherniack, M. Stonebraker. [Load Shedding in a Data Stream Manager](https://people.csail.mit.edu/tatbul/publications/vldb03.pdf). *Proceedings of the 29th International Conference on Very Large Data Bases*, 309–320, 2003.

[8] P. Goyal, P. Shah, K. Zhao, G. Nikolaidis, M. Alizadeh, T. E. Anderson. [Backpressure Flow Control](https://www.usenix.org/conference/nsdi22/presentation/goyal). *19th USENIX Symposium on Networked Systems Design and Implementation*, 779–805, 2022.

[9] D. J. Abadi, D. Carney, U. Cetintemel, et al. [Aurora: A New Model and Architecture for Data Stream Management](https://doi.org/10.1007/s00778-003-0095-z). *The VLDB Journal*, 12: 120–139, 2003.

[10] V. Kalavri, J. Liagouris, M. Hoffmann, D. Dimitrova, M. Forshaw, T. Roscoe. [Three Steps Is All You Need: Fast, Accurate, Automatic Scaling Decisions for Distributed Streaming Dataflows](https://www.usenix.org/conference/osdi18/presentation/kalavri). *13th USENIX Symposium on Operating Systems Design and Implementation*, 783–798, 2018.

[11] S. Floratou, A. Agrawal, B. Graham, et al. [Dhalion: Self-Regulating Stream Processing in Heron](https://www.vldb.org/pvldb/vol10/p1825-floratou.pdf). *Proceedings of the VLDB Endowment*, 10(12): 1825–1836, 2017.

[12] IETF. [RFC 9293: Transmission Control Protocol](https://www.rfc-editor.org/rfc/rfc9293.html), 2022; [RFC 9113: HTTP/2](https://www.rfc-editor.org/rfc/rfc9113.html), 2022.

[13] Node.js. [Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams); [Stream API: `writable.write()`](https://nodejs.org/api/stream.html#writablewritechunk-encoding-callback). Node.js Documentation.
