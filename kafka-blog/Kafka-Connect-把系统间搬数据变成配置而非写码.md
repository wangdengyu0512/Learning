---
title: Kafka Connect：把“系统间搬数据”变成配置而非写码
description: 从核心概念、分布式机制到选型与自测，系统理解 Kafka Connect。
tags: [Kafka, Kafka Connect, 数据集成, CDC, 流式架构]
date: 2026-10-05
---

# Kafka Connect：把“系统间搬数据”变成配置而非写码

> 本文由本目录中的《Kafka Connect 教程》四个页面整理而成，保留原教程的核心概念、配置示例、机制解释与自测题，并重新编排为一篇可独立阅读的博客文章。

## 目录

- [导读：为什么是 Kafka Connect](#导读为什么是-kafka-connect)
- [第一章：核心概念——配置驱动的数据搬运](#第一章核心概念配置驱动的数据搬运)
- [第二章：机制与取舍——分布式集群怎么协调自己](#第二章机制与取舍分布式集群怎么协调自己)
- [第三章：自测题库——从回忆到判别](#第三章自测题库从回忆到判别)
- [总结](#总结)
- [参考资料](#参考资料)


---

## 导读：为什么是 Kafka Connect



基于 Apache Kafka 4.3（2026-05）。阅读时间约 1.5 小时。配置示例基于 Kafka 4.x，未在本机逐一运行。本教程是主 [Kafka 教程](https://zhiwenliang.github.io/learning/kafka/index.html)的子教程，默认读者已掌握分区、消费组、offset。

### 适合谁

这套教程为下面三类读者写——三条都对上，才会读得顺：

- 学过主 Kafka 教程或等同，理解分区 / 消费组 / offset / 再平衡，但**没用过 Connect** 的 Java 后端工程师。
- 要把数据库、对象存储、搜索引擎与 Kafka 之间的搬运标准化，正在**纠结自写 producer/consumer 还是上 Connect** 的人。
- 准备中高级面试，需要把 Connect 的**架构、offset 语义、exactly-once、再平衡**讲到能扛追问的人。

### 不适合谁

三种情况下，别的资源更划算：

- **Kafka 零基础**：不清楚分区与消费组 offset 是什么，先回到主 [Kafka 教程](https://zhiwenliang.github.io/learning/kafka/index.html)，那里建立的 schema 是本教程的地基。
- **要写流处理逻辑**（按 key join、聚合、开窗、一进多出）：那是 Kafka Streams 的领域，去 [Kafka Streams 子教程](https://zhiwenliang.github.io/learning/kafka-streams/index.html)，Connect 只搬运不做有状态计算。
- **找某个具体 connector 的配置手册**（JDBC / S3 / Debezium 的全部参数表）：去对应厂商文档；本教程讲框架机制与取舍，不逐一罗列 connector 参数。

### 读完之后你能做到什么

你能把任意 Connect 故障定位到三层之一——是 connector 搬运、converter 序列化、还是控制面 topic 的问题；面试被问"Connect 怎么保证 exactly-once/不丢数据"时，能说清 source 偏移存哪、EOS 靠事务+fencing，而不是"它有容错"。具体到可验证的能力：

- **区分** source 与 sink connector、standalone 与 distributed worker、task 与 connector，并说出各自把配置 / 偏移 / 状态存在哪。
- **判断**一个搬运需求该用 Connect、自写 producer/consumer、还是升级到 Streams，并讲出依据。
- **读懂**一份 connector 的 JSON 配置：认出 `key.converter`/`value.converter`、`tasks.max`、`errors.tolerance` 各自控制什么。
- **诊断** `Unknown magic byte!`、毒丸记录停 task、改名后重灌等典型失败，并定位到三层中的哪一层。
- **复述** EOS source 的成立条件：仅 distributed、全 worker 一致开启、事务原子双写记录与偏移、僵尸 task 被 fencing。

> **一句话本质**
>
> Kafka Connect 把"系统间搬数据"变成配置而非写码：connector 只管搬运、序列化格式由 converter 决定（不是 connector）、单条轻量变换由 SMT 做；而整个集群的配置/偏移/状态都存在 Kafka 自己的 compacted topic 里——没有外部协调器、没有数据库。
>
> 抓住"connector 搬运 + converter 定格式 + SMT 变换 + 控制面在 Kafka topic 里"这四块，整个 Connect 就清晰了。选型与面试的分水岭：知道何时用 Connect（标准化搬运）而非自写 producer/consumer，何时该升级到 Streams（有状态 / join / 聚合）。

### 现状速览（截至 2026-06-03，Kafka 4.3）

> **什么稳定 · 什么在变 · 什么已被取代**
> - **稳定**：EOS source（KIP-618，3.3 GA，2022-09）、incremental cooperative 再平衡（KIP-415，2.3）、DLQ（KIP-298，2.0）、REST 偏移管理（KIP-875，3.6）。
> - **近期变化**：**4.0（2025-03）起 Connect 需 Java 17**（KIP-1032 转 Jakarta EE）；ZooKeeper 已删（KRaft only）；**4.3（2026-05）加 KIP-1273 ConnectPlugin 接口**（插件可发现性）。
> - **生态**：JDBC / S3 / Debezium / Elasticsearch 等主流 connector 在核心 Kafka 之外（Confluent Hub / 厂商仓库），独立于 broker 版本演进。

> **流畅感警告**
> 这一页读着顺，不等于掌握了。三个假象，开读前先认清：
> **"我读得很顺"**——Connect 的概念名词（converter、task、offset）单看都好懂，连起来的责任边界才是难点；顺着读完，合上页面能不能说清"序列化格式到底由谁决定"？
> **"我做题很快"**——配置项眼熟不等于知道改错一个会触发哪种线上失败；自测的应用判别层才检验这个。
> **"我没卡壳"**——没卡壳常常是因为还没遇到 source 与 sink offset 存两套、EOS 只在 distributed 成立这类反直觉点；卡壳是学到了的信号，不是没学会。

### 概念地图

> **图示说明**：数据面 外部源系统 DB / 文件 source connector + tasks 搬运 converter 序列化 Kafka topic 字节 converter 反序列化 SMT 单条变换 sink connector + tasks 搬运 外部目标系统 DB / S3 / ES DLQ 坏记录 控制面 · 全在 Kafka 里 connect-configs 配置 connect-offsets source 偏移 connect-status 状态 REST API 同一集群 图 0.1 数据从外部源横向流到外部目标；控制面（虚线框）独立在下方。 注意 三点：① connector 搬运、converter 决定格式（不是 connector）；② source 偏移存 connect-offsets topic、sink 用消费组——两套不同机制；③ 控制面全在 Kafka compacted topic 里，无外部数据库。

### 学习路径建议

按目的选一条线，不必每页等量精读：

- **理解架构应付面试**：[01 概念](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html) → [02 原理](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html) → [03 自测](https://zhiwenliang.github.io/learning/kafka-connect/03-self-check.html)，全程走完，自测的应用判别层重点做。
- **做数据集成选型**：[01 概念](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html) → [02 原理](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html) 的备选方案对比表，抓 Connect / 自写 / Streams 的边界即可。
- **排查 Connect 故障**：[01 概念的 converter / offset / DLQ](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#converters) → [02 原理的序列化与 offset 恢复](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html)，对照三层定位法读。

### 教程章节

### 学完之后

把 Connect 这块 schema 立起来后，下面几个方向各自往上加一块：

- **Debezium 与 CDC**——基于 source connector 的变更数据捕获，在你的 schema 上加"从数据库事务日志读增量"这一能力。
- **具体 connector 深挖**（JDBC source/sink、S3 sink）——把框架机制落到某个真实 connector 的参数与限制上。
- **[Kafka Streams 子教程](https://zhiwenliang.github.io/learning/kafka-streams/index.html)**——补上 Connect 故意不做的部分：有状态计算、join、聚合、开窗，明确两者分工边界。
- **ksqlDB**——用 SQL 表达流处理，理解它与 Streams、Connect 在同一生态里各占什么位置。

---

## 第一章：核心概念——配置驱动的数据搬运



起点页给出了本质：Connect 把"系统间搬数据"从写码变成写配置——connector 搬运、converter 定格式、SMT 变换，控制面全在 Kafka 自己的 topic 里。这一章把这句话拆成八个能在面试里准确定义、在配置里准确落地的概念。

> **本章你将建立的 schema**
>
> - connector 只管"搬"，序列化格式由 converter 决定——这两者**解耦**，一个 connector 可配任意格式。
> - worker 是运行进程（standalone 单机无容错 / distributed 集群有 REST 与自动再平衡），connector 在 worker 里派生出 ≤`tasks.max` 个 task 作并行单位。
> - 偏移分两套：source 存进 `connect-offsets` topic、按 connector 名索引；sink 用普通消费组——改名即丢位置。
> - 错误默认 `none`（一条坏记录停整个 task）；DLQ 仅 sink、只抓 converter/SMT 错误。EOS source 是 worker 级、全集群一致的开关。

八个概念按依赖顺序排列：[connector](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#connectors)（搬什么）→ [worker](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#workers)（在哪跑）→ [task](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#tasks)（多快）→ [converter](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#converters)（什么格式）→ [SMT](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#smt)（路上改什么）→ [offset](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#offsets)（读到哪了）→ [错误处理 / DLQ](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#error-dlq)（坏记录去哪）→ [EOS source](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#eos-source)（不重不漏）。前四个回答"一条记录怎么从外部系统流进 Kafka 又流出去"，后四个回答"出错、重启、扩容时它还正确吗"。读者若已学过[主 Kafka 教程](https://zhiwenliang.github.io/learning/kafka/01-concepts.html)的 partition / 消费组 / offset，这一章会反复借用那套词汇。

> **图示说明**：SOURCE 侧 SINK 侧 外部源系统 DB / 文件 source connector + SMT 内联 序列化 converter 对象→字节 Kafka topic 字节存于日志 反序列化 converter 字节→对象 sink connector + SMT 内联 外部目标系统 ES / S3 图 1.0 一条记录的完整往返：外部源 → source connector（SMT 内联）→ converter 序列化 → Kafka topic → converter 反序列化 → sink connector（SMT 内联）→ 外部目标。 注意 ：序列化格式由两端的 converter 决定，不是 connector——同一个 connector 换 converter 就换了线上格式，connector 代码一行不动。

### 1.1 connector：搬运插件，POST 一段 JSON 就跑

connector 是一个可复用的搬运插件：source connector 把外部系统的数据写进 Kafka，sink connector 把 Kafka 的数据写进外部系统。

> **为什么需要它**
> 没有 Connect，"把 Postgres 表同步进 Kafka"这种活得自己写一个 producer 程序：轮询数据库、把行转成记录、处理位点跟踪、处理重启续传、处理并行、再写一套部署和监控。每接一个新系统就重写一遍这套胶水。Connect 把这套胶水抽成**插件契约**——JDBC、S3、Debezium、Elasticsearch 等厂商各实现一个 connector，工程师把 JAR 放进 plugin path，再 `POST` 一段 JSON 配置，搬运就跑起来，几乎不写码。

#### 底层机制（比文档深一层）

文档说"connector 负责搬数据"。再深一层：connector 类本身**不搬数据**。它只做两件事——验证配置、把工作切成若干份。真正读写数据的是它派生出的 [task](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#tasks)（§1.3）。所以一个 connector 实例 = 一份配置 + 一个"把活切成 N 份"的计划，框架拿着这个计划把 task 分发到各 worker 上跑。这解释了一个反直觉的事实：connector 配置里写 `"tasks.max": "10"` 不保证有 10 个 task 在干活——connector 自己决定能切出几份（JDBC source 受表数限、sink 受分区数限），`tasks.max` 只是上限。

还有一层：connector 只管"搬"，**不管序列化格式**。一条记录在 connector 内部是结构化对象（Connect 的内部 `SchemaAndValue` 表示），变成 Kafka 里的字节是 [converter](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#converters)（§1.4）的事。这个解耦是 Connect 设计的关键，后面专门讲。

> **类比 · 带边界声明**
> connector 像**货运公司的标准化集装箱接口**：你不关心箱子里装的是冰箱还是钢材，只要按接口装卸即可。**边界**：集装箱本身是被动的，而 connector 会主动验证你的运单（配置）、决定派几辆车（task 数）。它继承了承运方的能力上限——connector 有 bug 或限制，你就有；调优时仍要懂它下一层的配置。

#### 场景走查

把一个 Postgres 的 `public.orders` 表增量同步进 Kafka。装好 JDBC source connector 的 JAR 后，`POST` 这段配置到 worker 的 REST 端点：

**jdbc-source.json JSON**

```json
{
  "name": "orders-jdbc-source",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://db:5432/shop",
    "table.whitelist": "orders",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "topic.prefix": "pg-",
    "tasks.max": "1"
  }
}
```

`connector.class` 选定哪个插件；`mode: incrementing` 让它靠自增主键追新行；`topic.prefix` 把表写进 `pg-orders` topic。注意这里**没有任何序列化配置**——格式留给 worker 或 connector 级的 converter，下面 §1.4 才出现。这正是"connector 与格式解耦"在配置上的体现。

> **例 · MirrorMaker 2**
> Kafka 自带的跨集群复制工具 MirrorMaker 2 不是独立程序，而是**三个 source connector**：`MirrorSourceConnector`（复制数据）、`MirrorCheckpointConnector`（翻译消费位点供故障转移）、`MirrorHeartbeatConnector`（探活）。它因此白拿了 Connect 的扩缩容与高可用——这是"connector 即插件"抽象复用性的最好证据。

**与下一个概念的关系**：配置 `POST` 到哪？谁来跑这个 connector、谁来响应这个 REST 请求？那是运行进程——[worker](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#workers)。

### 1.2 worker：运行进程，standalone 还是 distributed

worker 是真正运行 connector 与 task 的 JVM 进程；standalone 是单进程、文件配置、无容错，distributed 是多进程共享一个集群、靠 REST 管理、自动再平衡。

> **为什么需要它**
> connector 是一份配置和一段插件代码，它得有个进程来加载、运行、监控。worker 就是这个进程。两种模式回答的是同一个运维问题的两端：开发期单机搬一个日志文件，要的是简单——一个进程、一个 properties 文件就够；生产期要的是容错与可管理——某台机器宕了任务自动转移、不重启进程就能加 connector。standalone 服务前者，distributed 服务后者。

#### 底层机制（比文档深一层）

文档说 distributed 模式"有容错和负载均衡"。再深一层：**它靠 Kafka 自己实现，没有外部协调器**。多个 worker 配同一个 `group.id`，通过 Kafka 的消费组协议加入同一个 Connect 集群；connector 配置、source 偏移、connector/task 状态全写进三个 compacted [internal topic](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#offsets)。这意味着 Connect 集群**不需要 ZooKeeper、不需要数据库**——它的全部状态就是几条 Kafka topic。代价直接：这三个 internal topic 配置不一致或损坏，整个集群就坏；`group.id` 配错会把一个集群裂成两个。

standalone 则把这套全省了：偏移存本地文件（`offset.storage.file.filename`），无 REST 集群管理，进程一死状态随它去。所以 standalone **不是**"小一号的 distributed"，而是**另一套存储与协调模型**——这是面试常考的分水岭。

#### REST API：connector 的生命周期入口

distributed worker 暴露一个 REST 端点（默认 `8083`），它是管理 connector 的**唯一正道**。整个生命周期都走它：

**connector 生命周期 · REST bash**

```bash
# 创建（POST 上一节那段 JSON）
curl -X POST -H "Content-Type: application/json" \
     --data @jdbc-source.json http://worker:8083/connectors

# 看状态：connector 与每个 task 是 RUNNING 还是 FAILED
curl http://worker:8083/connectors/orders-jdbc-source/status

# 暂停 / 恢复 / 重启失败的 task
curl -X PUT  http://worker:8083/connectors/orders-jdbc-source/pause
curl -X POST http://worker:8083/connectors/orders-jdbc-source/restart?includeTasks=true

# 删除
curl -X DELETE http://worker:8083/connectors/orders-jdbc-source
```

请求发给**任意一个** worker 都行——它会把变更写进 `connect-configs` topic，集群里所有 worker 读到后协同执行。这就是"配置即数据"：管理动作本质是往 Kafka 写一条记录。

> **图示说明**：standalone 单机 · 无容错 worker 进程 connector + task properties 文件配置 本地文件 offset 存这里 distributed 集群 · 自动再平衡 共享 group.id + REST :8083 worker 1 task a worker 2 task b worker 3 task c 3 个 internal topic（都 compacted） connect- configs connect- offsets connect- status 状态写入 图 1.1 左：standalone 单进程，配置与偏移都在本地文件，进程死即状态没。右：distributed 多 worker 共享 group.id 与 REST，把全部状态写进三个 compacted internal topic。 注意 ：distributed 没有外部协调器——它的"集群大脑"就是右下角那三条 Kafka topic， group.id 配错会把一个集群裂成两个。

**与下一个概念的关系**：图 1.1 里每个 worker 上跑着 task a/b/c——这些 task 从哪来、怎么被分到不同 worker 上？这是并行的单位：[task](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#tasks)。

### 1.3 task：并行单位，tasks.max 是上限不是保证

task 是 connector 派生出的、真正读写数据的执行单位；一个 connector 最多派生 `tasks.max` 个 task，它们被均摊到集群各 worker 上并行跑。

> **为什么需要它**
> 若一个 connector 只能单线程搬，那一张大表、一个高吞吐 topic 就被单线程卡死，加机器也没用。task 是 Connect 的并行原语：把一个 connector 的工作切成多份，分到多个 worker 上同时跑。"并行单位是 task，不是 connector"——这一句决定了怎么估算吞吐、怎么扩容。

#### 底层机制（比文档深一层）

关键、且面试高频：**`tasks.max` 是上限，不是保证**。实际 task 数由 connector 根据"能切成几份"决定，再对 `tasks.max` 取下限。两类典型约束：

- **sink connector**：并行度受订阅 topic 的**分区数**限——每个 task 是一个消费组成员，分区数即并行上限。`tasks.max=10` 但 topic 只有 3 个分区，只有 3 个 task 拿到分区，其余 7 个空转。
- **JDBC source connector**：并行度受**表数**限——它一张表给一个 task，同步 2 张表最多 2 个 task。

task 分到哪个 worker，由集群的 assignor 决定，目标是**均摊**。worker 加入或离开会触发再平衡重新分配——Connect 自 2.3 起用 incremental cooperative 再平衡（只暂停被收回/移动的 task，其余继续），机制细节是 [02 章 §2.2](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#rebalance) 的事，这里只需记住：task 是被调度的最小单位。

#### 场景走查

一个 sink connector 要把 `pg-orders`（4 个分区）写进 Elasticsearch。配 `tasks.max` 等于分区数最划算：

**es-sink.json JSON**

```json
{
  "name": "orders-es-sink",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "topics": "pg-orders",
    "connection.url": "http://es:9200",
    "tasks.max": "4"
  }
}
```

这里 4 个 task 各认领 1 个分区、并行写 ES。若把 `tasks.max` 写成 `8`，多出的 4 个 task 不会报错，只是**空转**——没有分区可认领。`GET /status` 会显示 8 个 task 都 RUNNING，但其中 4 个不干活，是排查吞吐问题时的常见误判点。

想一想

一个 sink connector 配了 `"tasks.max": "10"`，但它订阅的 topic 只有 3 个分区。实际有几个 task 在搬数据？

> **展开答案（先停 10 秒再点）**
>
> **3 个**。sink 的每个 task 是消费组成员，并行度被分区数封顶。框架会启动 10 个 task，但只有 3 个能分到分区，剩下 7 个拿不到分区、空转。
>
> 这道题指向的设计要点：`tasks.max` 是上限不是保证，sink 真实并行度 = `min(tasks.max, 分区数)`。想提高 sink 吞吐，先加分区，再加 task——单加 `tasks.max` 只是制造空转的进程。

**与下一个概念的关系**：task 把结构化记录搬到了 Kafka 边界，但 Kafka 里存的是字节。结构化对象怎么变字节、又怎么变回来？这是和 connector 解耦的那一层——[converter](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#converters)。

### 1.4 converter：决定序列化格式，与 connector 解耦

converter 负责记录在 Connect 内部对象与 Kafka 字节之间的相互转换；key 和 value 各配一个，它决定线上的序列化格式——且与 connector 完全解耦。

> **为什么需要它**
> 如果序列化格式烧死在每个 connector 里，那"换 JSON 为 Avro"就得改 connector 代码、每个 connector 各实现一遍各种格式。Connect 把序列化抽成独立的 converter 层：connector 只产出/消费结构化对象，converter 负责对象↔字节。于是**任意 connector × 任意格式**自由组合，换格式只动配置不动代码。

#### 底层机制（比文档深一层）

三个常被忽略、却最容易出事的点：

- **key 和 value 各一个 converter，独立配置**。`key.converter` 和 `value.converter` 互不相干——线上常见 key 是 String、value 是 Avro。两边配错任一个，就只有半边反序列化失败。
- **converter 可配在 worker 级或 connector 级**。worker 级是集群默认，connector 级覆盖它。一个 connector 完全可以用与集群默认不同的格式。
- **`JsonConverter` ≠ `JsonSchemaConverter`**。前者是 `org.apache.kafka.connect.json.JsonConverter`（纯 JSON，可选每条内嵌 schema）；后者是 `io.confluent.connect.json.JsonSchemaConverter`（走 Schema Registry、字节里带 schema id 的 wire format）。名字像，**wire format 完全不同，不可互换**。

再深一层是 `JsonConverter` 的 `schemas.enable`：设 `true` 时每条消息都内嵌一份 `{"schema":...,"payload":...}` 结构，体积成倍膨胀但自描述；设 `false` 只发裸 JSON。这个开关与"消费端期望什么结构"必须对齐，否则 sink 报 `JsonConverter requires "schema" and "payload"`。

> **图示说明**：同一个 connector 产出结构化对象 JsonConverter + schemas.enable JSON 字节 可选内嵌 schema AvroConverter + Schema Registry Avro 字节 magic byte + id StringConverter 原样字符串 纯文本字节 无 schema 图 1.2 同一个 connector，换 converter 就换了 Kafka 里的字节格式——connector 代码与配置一行不动。 注意 ：决定线上格式的是 converter 这一列，不是左边的 connector； AvroConverter 的字节带 magic byte + schema id，正是它与 JsonConverter 互不兼容的根源。

#### 场景走查

给 §1.1 那个 JDBC source 加上序列化：key 用 String、value 用 Avro 并接 Schema Registry。converter 配在 connector 级（覆盖 worker 默认）：

**converter 片段（并入 connector config） JSON**

```json
{
  "key.converter": "org.apache.kafka.connect.storage.StringConverter",
  "value.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter.schema.registry.url": "http://schema-registry:8081"
}
```

worker 级默认则写在 properties 里，对全集群生效：

**connect-distributed.properties（worker 级默认） properties**

```properties
key.converter=org.apache.kafka.connect.json.JsonConverter
value.converter=org.apache.kafka.connect.json.JsonConverter
value.converter.schemas.enable=false
```

> **陷阱**
> sink 端的 converter 必须匹配 topic 里**实际**的字节格式，而不是你以为的格式。producer 写的是 Avro（字节以 magic byte + schema id 开头），sink 却配 `JsonConverter`，反序列化会失败并报 `Unknown magic byte!`——它把 Avro 的第一个字节当成 JSON 起始字符去解。修复：sink 的 `value.converter` 改 `AvroConverter` 并对齐 `schema.registry.url`。这类"反序列化风暴"是 sink connector 最常见的失败模式。

想一想

上游 producer 用 Avro 写入一个 topic（每条字节带 magic byte + schema id）。一个 sink connector 配 `value.converter=JsonConverter` 去消费它。会发生什么？

> **展开答案（先停 10 秒再点）**
>
> sink 的每个 task 在**反序列化阶段就失败**，报 `Unknown magic byte!`。`JsonConverter` 拿到 Avro 字节的第一个字节（值为 `0x00` 的 magic byte），按 JSON 解析立刻失败。由于 `errors.tolerance` 默认是 `none`，**第一条记录就让整个 task 停掉**（见 [§1.7](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#error-dlq)）。
>
> 这道题指向的设计要点：converter 与 connector 解耦带来灵活，也带来一个新约束——**sink converter 必须与线上真实格式一致**。converter 不会"猜"格式，配错就是反序列化失败，而非默默降级。

**与下一个概念的关系**：converter 决定记录的"外壳格式"，但有时要在搬运途中改记录的**内容**——加个字段、脱敏、改目标 topic。这是逐条的轻量变换：[SMT](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#smt)。

### 1.5 SMT：逐条变换，无状态、无 join

SMT（Single Message Transform，单消息变换）是配置在 connector 里的链式逐条变换，每条记录流过时被原地修改，可加 predicate 谓词做条件门控。

> **为什么需要它**
> 很多集成需求只是对每条记录做点轻微编辑：加一个摄入时间戳、把某字段脱敏、按内容改写目标 topic 名。为这点事单起一个 Kafka Streams 应用是杀鸡用牛刀。SMT 让这类逐条编辑变成 connector 配置里的几行——零代码、内联在搬运路径上。

#### 底层机制（比文档深一层）

SMT 以**链**的形式声明：`transforms` 列出名字，每个名字配 `type` 和参数，记录按顺序流过整条链。常用的有 `InsertField`（插字段）、`MaskField`（脱敏）、`RegexRouter`（按正则改 topic 名）、`ReplaceField`（删改字段）。自 2.6 起每个 SMT 可挂一个 **predicate**，只对满足条件的记录生效。

关键边界、且是面试判别点：**SMT 是单条、无状态的**。它一次只看一条记录，没有跨记录的内存。所以 SMT **做不了**聚合、join、按 key 关联另一个 topic、一条变多条——这些是有状态的流处理，属于 Kafka Streams / ksqlDB。把"逐条无状态编辑用 SMT，有状态关联用 Streams"刻进判断里，选型就不会错。代价：很重的 SMT 链会增加每条记录的 CPU 开销，因为它在搬运热路径上同步执行。

#### 场景走查

给搬进来的订单记录做两件事：插入一个固定来源标记字段，并把所有记录从 `pg-orders` 改写到 `ingested-orders` topic。两个 SMT 串成一条链：

**smt 片段（并入 connector config） JSON**

```json
{
  "transforms": "addSource,route",

  "transforms.addSource.type":
    "org.apache.kafka.connect.transforms.InsertField$Value",
  "transforms.addSource.static.field": "source_system",
  "transforms.addSource.static.value": "postgres-shop",

  "transforms.route.type":
    "org.apache.kafka.connect.transforms.RegexRouter",
  "transforms.route.regex": "pg-(.*)",
  "transforms.route.replacement": "ingested-$1"
}
```

记录先过 `addSource`（value 里多出 `source_system: "postgres-shop"`），再过 `route`（topic 名 `pg-orders` 被正则改写成 `ingested-orders`）。整条链对每条记录同步执行，无任何跨记录状态。

> **陷阱**
> 需求若是"按订单 key 关联另一个 topic 的用户信息再聚合"，**SMT 做不到**——它无状态、看不到别的记录。强行用 SMT 会卡在"拿不到第二条记录"上。这类有状态关联是 [Kafka](https://zhiwenliang.github.io/learning/kafka/01-concepts.html) Streams / ksqlDB 的职责。SMT 与 Streams 的边界（单条无状态 vs 有状态 join/聚合）是面试判别题的常客。

**与下一个概念的关系**：connector 搬、converter 转、SMT 改——这条流水线跑起来后，重启时怎么知道"上次搬到哪了"？这就是 [offset](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#offsets)，而且 source 和 sink 的存法完全不同。

### 1.6 offset：source 存 topic、sink 用消费组

offset 记录"搬到哪了"用于重启续传；source connector 把自定义偏移存进 `connect-offsets` topic、按 connector 名索引，sink connector 用普通 Kafka 消费组的位点。

> **为什么需要它**
> 搬运进程会重启、会崩溃。没有偏移记录，重启后要么从头重灌全部数据、要么漏掉中间的。offset 让 connector 重启后从上次提交的位置续上，做到不重不漏（或至少不漏）。手写 producer/consumer 时这套位点跟踪得自己实现——Connect 把它白送了，这本身就是用 Connect 而非手写的一大理由。

#### 底层机制（比文档深一层）

面试高频：**source 和 sink 的偏移是两套完全不同的机制**。

- **source connector**：外部系统（数据库、文件）没有 Kafka 式 offset 的概念，所以 connector 自己定义"位点"长什么样——比如"读到 `id=10042`"或"文件读到 byte 4096"。框架把这组 `{sourcePartition → sourceOffset}` 键值对存进 `connect-offsets` topic，**按 connector 名索引**。
- **sink connector**：它就是个 Kafka 消费者，用**普通消费组**的位点，消费组名是 `connect-<connector 名>`。位点存在 Kafka 的 `__consumer_offsets` 里，和任何消费者一样。

"按 connector 名索引"埋了个直接后果：**给 source connector 改名 = 框架认不出旧偏移 = 从头重灌**。新名字对应一组空偏移，connector 会把外部系统从头再搬一遍。KIP-875（3.6）加了 REST 的 `GET/PATCH/DELETE /connectors/{name}/offsets`，可以查看和手动改偏移，但前提仍是名字稳定。

> **陷阱**
> 想"重建"一个 source connector 而顺手改了它的名字（如 `orders-jdbc-source` → `orders-jdbc-source-v2`），结果它把整张表**从头重灌**一遍——因为偏移按旧名索引，新名查不到任何已提交位点。修复：保持 connector 名稳定；确实要重置时，用 REST `/offsets` 显式管理，而不是靠改名。

#### 场景走查

用 REST 查一个 source connector 当前的偏移，确认它搬到了哪条主键：

**查看 source 偏移 · REST（KIP-875, 3.6+） bash**

```bash
curl http://worker:8083/connectors/orders-jdbc-source/offsets

# 返回（节选）：source 自定义的位点，按 connector 名归档
# {
#   "offsets": [
#     { "partition": { "table": "orders" },
#       "offset":    { "incrementing": 10042 } }
#   ]
# }
```

返回里 `partition` 和 `offset` 都是 connector 自定义的结构——这正是"source 偏移是自定义格式、框架只负责存取"的体现。同一个端点对 sink connector 返回的则是普通消费组位点（`{topic, partition, offset}`）。

**与下一个概念的关系**：偏移让 connector 知道搬到哪了。但搬运途中遇到一条**处理不了**的记录怎么办？默认行为出乎意料地严厉——这是[错误处理与 DLQ](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#error-dlq)。

### 1.7 错误处理 / DLQ：默认一条坏记录停整个 task

errors.tolerance 控制遇错行为，默认 `none`——一条处理失败的记录就让整个 task 停；DLQ（死信队列）把坏记录转去另一个 topic，但仅 sink 可用、且只抓部分错误。

> **为什么需要它**
> 真实数据流里总有"毒丸记录"：格式不符、字段缺失、反序列化失败。如果一条坏记录直接让搬运停摆，运维要半夜起来手动跳过。错误处理与 DLQ 让 connector 能容忍坏记录、把它们隔离到一边继续跑，而不是整条管道停摆。

#### 底层机制（比文档深一层）

三个必须记准的点：

- **`errors.tolerance` 默认是 `none`**。意思是零容忍——任何一条记录在 converter / SMT / 反序列化阶段出错，整个 task 立刻进入 `FAILED`。改成 `all` 才会跳过坏记录继续。这个默认值常让人措手不及：一条脏数据就能让搬运在凌晨停掉。
- **DLQ 仅 sink connector 可用**。`errors.deadletterqueue.topic.name` 指定一个 topic，坏记录被转发过去；配 `errors.deadletterqueue.context.headers.enable=true` 还会把"为什么失败"写进消息 header。source connector 没有 DLQ。
- **DLQ 只抓 converter / SMT / key-value 错误，不抓 sink 写外部系统的失败**。这是最大的认知误区——以为开了 DLQ 就万无一失。实际上"ES 拒绝写入""JDBC 主键冲突"这类**投递失败绕过 DLQ**，由 `errors.retry.*` 重试逻辑处理，重试耗尽仍会让 task 失败。

#### 场景走查

给 ES sink 加上容错：跳过坏记录、转去 DLQ、带上失败原因，并设重试窗口：

**error/dlq 片段（并入 sink config） JSON**

```json
{
  "errors.tolerance": "all",
  "errors.deadletterqueue.topic.name": "dlq-orders-es",
  "errors.deadletterqueue.context.headers.enable": "true",
  "errors.retry.timeout": "60000",
  "errors.log.enable": "true"
}
```

此时一条反序列化失败的记录会被写进 `dlq-orders-es`（header 里带异常信息），task 继续搬后面的记录。但若 ES 本身拒绝一次合法写入，那不是 converter/SMT 错误——它走 `errors.retry.timeout` 的 60 秒重试窗口，**不会**进 DLQ；重试窗口内没成功，task 仍会失败。

> **洞察 · DLQ 的边界**
> 把 DLQ 理解成"**数据形状**的隔离区"，不是"**所有故障**的兜底"。它拦的是"这条记录读不懂/变换不了"（converter、SMT），放过的是"目标系统暂时不收"（写外部失败）。两类问题用两套机制——DLQ 管前者，`errors.retry.*` 管后者。混淆这条边界是错误处理配置里最常见的误判。

**与下一个概念的关系**：容错保证了"坏记录不停摆"。但还有更强的正确性诉求——能不能保证每条记录**恰好一次**地搬进 Kafka，重启、再平衡都不重复？这是 [EOS source](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#eos-source)。

### 1.8 EOS source：worker 级的精确一次（KIP-618）

EOS source（exactly-once source，KIP-618）让 source connector 把记录与偏移原子地写进 Kafka，配合僵尸隔离做到精确一次；它是 worker 级开关，仅 distributed 可用、且必须全集群一致开启。

> **为什么需要它**
> 默认情况下 source connector 是"至少一次"：崩溃重启时，已写进 Kafka 但偏移没来得及提交的记录会被**重发**。对账务、计费这类不容重复的场景，重复记录是正确性事故。EOS source 把"写记录"和"提交偏移"绑成一个原子事务，让重启/再平衡时不产生重复。

#### 底层机制（比文档深一层）

它靠两个 Kafka 原语：

- **事务**：task 把"一批数据记录"和"对应的偏移更新（写进 `connect-offsets`）"放进**同一个 Kafka 事务**，原子提交。要么记录和偏移一起生效，要么都不生效——杜绝了"记录写了、偏移没写、于是重启重发"这个窗口。
- **fencing（僵尸隔离）**：再平衡后旧的 task 实例可能还"活着"想继续写（僵尸）。框架给每代 task 分配递增的事务标识，旧代的写入被 broker **拒绝**，确保同一份工作只有最新一代能提交。

配置上两个约束必须记住：**它是 worker 级开关 `exactly.once.source.support`，不是 per-connector**；并且**仅 distributed 模式可用**。开启要两阶段滚动：先把所有 worker 设成 `preparing`、滚动重启，再设成 `enabled`、再滚动一次——中途全集群必须一致，不能一半开一半不开。connector 侧再声明 `exactly-once.support=required` 表示它要求这个保证。

#### 场景走查

worker 级开启（properties，全集群一致）：

**connect-distributed.properties（worker 级） properties**

```properties
# 两阶段升级：先全员 preparing 滚动重启，再全员 enabled
exactly.once.source.support=enabled
```

connector 侧声明要求这个保证：

**eos 片段（并入 source config） JSON**

```json
{
  "exactly-once.support": "required"
}
```

> **陷阱**
> `exactly.once.source.support` 是 worker 级、全集群一致的开关——不能只给某一个 connector 单独开。在 standalone 模式下它不可用。试图"只给账务 connector 开 EOS"会失败：要么整个 distributed 集群一起开，要么都不开。EOS 机制（事务双写 + fencing）的完整推导留给 [02 章 §2.5](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#eos)。

**承接下一章**：这八个概念给了词汇表。它们背后的**机制与取舍**——分布式控制面为何能只靠 Kafka topic、incremental cooperative 再平衡解决了什么、序列化在字节层如何工作、偏移如何恢复、EOS 的事务与 fencing 如何咬合——是 [02 章](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html)的主题。

### § 本章 self-check

先合上教程，把你能想到的答案写在纸上或编辑器里。 写完再点开答案对照——直接点开等于把这一节当再读一遍。

1. 一句话说清 source connector 与 sink connector 的方向差异；再说清 connector 与 converter 各管什么、为什么要解耦。
2. standalone 与 distributed 各把 connector 配置、source 偏移、connector 状态存在哪里？distributed 为什么不需要 ZooKeeper？
3. source connector 和 sink connector 的偏移分别存在哪、按什么索引？为什么给 source connector 改名会导致从头重灌？
4. （设计题）要把一张 Postgres 表增量同步进 Elasticsearch，途中给每条记录脱敏一个手机号字段、并容忍偶发的脏数据。你会用哪些概念（connector / converter / SMT / 错误处理），各自配什么关键项？哪类失败 DLQ 抓不到？

> **答案（先做完再展开）**
>
> 1. source connector 把外部系统数据写进 Kafka，sink connector 把 Kafka 数据写进外部系统。connector 只管"搬"（读写哪个系统、切几个 task），converter 管"序列化格式"（结构化对象 ↔ Kafka 字节）。解耦是为了让任意 connector 配任意格式——换序列化只动配置不动 connector 代码。
> 2. standalone：配置在 properties 文件、偏移在本地文件（`offset.storage.file.filename`）、无独立状态存储，进程死即没。distributed：配置存 `connect-configs`、source 偏移存 `connect-offsets`、状态存 `connect-status`，三个都是 compacted internal topic。不需要 ZooKeeper 是因为 worker 靠 Kafka 消费组协议协调、靠这三个 topic 持久化全部状态——集群大脑就是几条 Kafka topic。
> 3. source 偏移存进 `connect-offsets` topic，是 connector 自定义格式，**按 connector 名索引**；sink 用普通消费组位点（组名 `connect-<name>`），存在 `__consumer_offsets`。改 source connector 名 = 新名字查不到任何已提交偏移 = 框架认为它从未搬过 = 从头重灌整个外部源。
> 4. 用 JDBC source connector（`mode: incrementing` 追新行）搬，用 `MaskField` 这个 SMT 脱敏手机号字段，converter 按线上格式配（如 value 用 Avro + Schema Registry，key 用 String）。容忍脏数据：`errors.tolerance=all` + `errors.deadletterqueue.topic.name`（仅 sink 端有效）+ `context.headers.enable=true`。DLQ 抓不到的：ES 端拒绝写入这类**投递失败**——它走 `errors.retry.*` 重试，重试耗尽仍会让 task 失败。

进阶挑战 · 刚好够不着

#### 为什么 EOS 是 source 专属，sink 端的"精确一次"是另一回事？

本章讲的 EOS（KIP-618）只覆盖 source connector——它能把"写记录 + 提交偏移"放进一个 Kafka 事务原子完成。但 sink connector 要把数据写进的是**外部系统**（ES、JDBC），那不是 Kafka，没法纳入 Kafka 事务。想一想：为什么 source 端能用一个 Kafka 事务搞定原子性，而 sink 端的精确一次必须依赖目标系统本身的能力？sink 端要做到精确一次，外部系统需要提供什么？

> **提示（卡住再展开）**
>
> source 端的"双写"两个对象（数据记录、偏移）**都在 Kafka 里**，所以一个 Kafka 事务能同时覆盖。sink 端的两个对象是"外部系统的写入"和"消费位点"——前者在 Kafka 之外，Kafka 事务管不到。线索：要让 sink 精确一次，外部系统得支持**幂等写入**（同一条记录写多次效果等同一次，比如按主键 upsert）或自己的事务，让重复投递不产生重复效果。这就是为什么 sink EOS 不是一个统一框架开关，而是"看目标系统支不支持"。

---

## 第二章：机制与取舍——分布式集群怎么协调自己



01 章认识了 connector / converter / task 这些部件，知道了它们各管什么、配置长什么样。这一章往下钻一层：一个 distributed 集群**没有外部协调器**，凭什么能协调多个 worker？再平衡为什么不再 stop-the-world？序列化在字节层如何工作、偏移如何在重启后恢复、EOS 的事务与 fencing 如何咬合？每个机制都配一张备选方案对比表——看清 Connect 为什么这么设计，而不是只会照着配。

> **本章你将建立的 schema**
>
> - distributed 集群的**控制面就是三个 compacted topic**（`connect-configs`/`connect-offsets`/`connect-status`）+ 消费组协议，REST 只是读写它们的门面——无 ZooKeeper、无数据库。
> - 再平衡是 **incremental cooperative**（KIP-415, 2.3）：拓扑变更只暂停被移动的 task，其余继续搬——不再全员停摆。
> - 序列化由 **converter 在字节层**决定（Schema Registry 用 magic byte + schema id），与 connector 解耦；`JsonConverter` 与 `JsonSchemaConverter` 是不同 wire format。
> - 偏移分两套并各自恢复：source 存 `connect-offsets` 按 connector 名索引、sink 用消费组；EOS source 用**事务双写 + 代际 fencing**，是 worker 级、仅 distributed 的开关。

五个机制按从控制面到数据正确性的顺序排列：[分布式协调](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#coordination)（集群怎么不靠外部协调器活着）→ [再平衡](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#rebalance)（拓扑变了怎么重分 task）→ [序列化机制](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#serialization)（字节层如何编解码）→ [偏移管理与恢复](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#offset-recovery)（重启从哪续）→ [EOS source](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#eos)（不重不漏怎么做到）。每个机制先讲**运行方式**，再用**备选方案对比表**说清"为什么没选别的设计"，然后是**代价与失效模式**，最后一道**预测题**。01 章给的是词汇表，这一章给的是这些词背后的工作机制与取舍——这是从"会配"到"理解"的那一层。

> **图示说明**：REST API :8083 读写控制面 WORKER 面 共享 group.id worker 1 task a worker 2 task b worker 3 task c 任一 worker 控制面 · 全在 Kafka（compacted topic） connect-configs 连接器/任务配置 connect-offsets source 偏移 connect-status 连接器/任务状态 读写状态 · 消费组协议协调 无 ZooKeeper 无外部数据库 图 2.0 distributed 控制面：REST 是门面，worker 靠消费组协议加入同一集群，全部配置 / 偏移 / 状态都写进下方三个 compacted topic。 注意 ：这三个 topic 就是集群的"大脑"——没有任何外部协调器。它们的配置或压缩一旦不一致，整张图就裂成两个互不相认的集群。

### 2.1 分布式协调：控制面全在 Kafka 自己的 topic 里

distributed 集群不靠任何外部协调器协调，而是用 Kafka 的消费组协议加上三个 compacted internal topic——控制面就是 Kafka 本身。

#### 运行方式

多个 worker 配同一个 `group.id`，它们通过 Kafka 的**消费组成员协议**（与普通消费者加入消费组用的是同一套 group membership 机制）加入同一个 Connect 集群。集群里有一个被选出的 leader worker 负责计算 task 分配方案，其余 worker 执行分到自己头上的 task。三类需要持久化、需要跨 worker 一致的状态，各写进一个 compacted topic：

- `connect-configs`：connector 与 task 的配置。`POST` 一个 connector 的本质，就是往这个 topic 追加一条配置记录。
- `connect-offsets`：source connector 的偏移（见 [§2.4](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#offset-recovery)）。
- `connect-status`：connector 与 task 的运行状态（`RUNNING`/`FAILED`/`PAUSED`），`GET /status` 读的就是它。

这三个 topic 全是 **compacted**（日志压缩）——压缩保留每个 key 的最新值，正好匹配"配置 / 偏移 / 状态都只关心当前值"的语义。REST API（[§1.2](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#workers) 已见）不是一个独立服务，它只是这套机制的门面：一次管理请求落到任意 worker，被翻译成对这三个 topic 的读或写，集群里所有 worker 读到后协同执行。这就是 01 章那句"配置即数据"在机制层的展开。

#### 备选方案对比

"集群协调"是分布式系统的经典难题，常规答案是引入一个外部协调器（ZooKeeper、etcd）。Connect 选了另一条路。

**表 2.1 · distributed 集群协调：三种设计**
| 外部协调器 ZooKeeper / etcd | worker 把成员、配置、偏移托管给独立的协调集群 | 多引入一套要单独部署、监控、备份、扩容的有状态基建；Kafka 自己都在去 ZooKeeper（KRaft），Connect 再依赖它是逆流。被放弃。 |
| 独立数据库存配置/偏移 | 配置、偏移、状态写进关系库或 KV 存储 | 引入一个不在 Kafka 可用性域内的故障点——Kafka 活着但库挂了，集群照样瘫；还要解决库与 Kafka 之间的一致性。被放弃。 |
| Kafka topic + 消费组协议 | 消费组成员协议管协调，三个 compacted topic 存全部状态 | 选中：零额外基建，控制面与数据面同生共死，复用 Kafka 已有的复制 / 持久化 / 压缩能力。 |

> **洞察 · 为什么是 compacted**
> 三个 topic 用**日志压缩**而非按时间删除，是因为它们存的是"状态"不是"事件流"。状态只关心每个 key 的最新值——connector `orders-source` 当前的配置是什么、当前搬到哪个偏移、当前是不是 `RUNNING`。压缩保证 worker 重启后能从 topic 重建出完整的当前世界，又不会让 topic 无限增长。把这三个 topic 设成普通的按时间过期，旧配置 / 偏移会被删掉，集群重启即失忆——这正是它们必须 compacted 的原因。

#### 代价与失效模式

"控制面就是几条 topic"换来零外部依赖，代价是**这几条 topic 的健康直接等于集群的健康**。两种典型失效：

- **internal topic 配置 / 压缩不一致 = 裂集群**。如果新加的 worker 配了不同的 internal topic 名，或这些 topic 没设成 compacted、副本数不足，集群会读不到一致的控制面，表现为 connector 莫名消失、配置回滚、状态错乱。
- **`group.id` 配错 = 一个集群裂成两个**。两批本应同属一个集群的 worker 配了不同 `group.id`，会各自组成独立集群、各跑一份 connector——同一个 source 被搬两遍。

> **陷阱**
> 三个 internal topic 必须在全部 worker 上配成**完全相同的名字 + 都 compacted + 副本数 ≥ 3**。生产事故的常见形态是：手动建 topic 时漏设 `cleanup.policy=compact`，或不同 worker 的 `config.storage.topic` / `offset.storage.topic` / `status.storage.topic` 写得不一致——集群于是间歇性"分裂"，connector 时有时无。修复方向：核对所有 worker 的这三项配置一字不差，并确认 topic 的 `cleanup.policy`。

想一想

运维把 `connect-offsets` 这个 topic 误建成了按时间删除（`cleanup.policy=delete`、保留 7 天）而非 compacted。集群短期看起来正常。两周后所有 source connector 重启了一次，会发生什么？

> **展开答案（先停 10 秒再点）**
>
> source connector 会**大面积从头重灌**。`connect-offsets` 存的是每个 source connector 的当前偏移（按 connector 名索引的 key）。按时间删除会把超过 7 天没更新的偏移记录直接删掉；compaction 本该保留每个 key 的最新值，这里却被删除策略丢了。重启后 worker 从这个 topic 读不到旧偏移，等于这些 connector 从未搬过，于是把外部源整个重灌一遍。
>
> 这道题指向的设计要点：三个 internal topic 必须 compacted，不是可选优化而是**正确性前提**。控制面在 Kafka 里的代价，就是这几个 topic 的配置错误会直接变成数据正确性事故。

**与下一个机制的关系**：worker 靠消费组协议加入集群——那么一个 worker 加入或离开时，它名下的 task 怎么重新分配给其他 worker？这就是[再平衡](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#rebalance)，而 Connect 的再平衡方式经历过一次关键演进。

### 2.2 再平衡：incremental cooperative 只暂停被移动的 task

再平衡是 worker 加入 / 离开 / 配置变更时重新分配 task 的过程；自 KIP-415（2.3）起用 incremental cooperative 策略，只暂停被收回或移动的那部分 task，其余继续搬。

#### 运行方式

集群拓扑变化（一个 worker 宕机、新 worker 加入、connector 配置改了 task 数）会触发再平衡——leader worker 重新计算"哪个 task 该在哪个 worker 上"。关键在于**怎么过渡到新方案**：

- **旧的 eager 策略（2.3 之前）**：再平衡一开始，所有 worker **立即放下手上全部 task**（revoke everything），等 leader 算出新分配后再统一领回。整个集群在这期间停止搬运——一个 worker 的加入会让所有 connector 短暂停摆，这就是 stop-the-world。
- **incremental cooperative（2.3 起，KIP-415）**：leader 先算出新旧分配的**差集**——只有真正需要换主的 task 才被收回，其余 task 完全不受影响、继续搬。收回的 task 在下一轮再分配给目标 worker。整个过程"增量"完成，集群绝大部分吞吐不中断。

对一个跑着几十个 connector 的集群，差别是质变：扩容时加一台 worker，eager 会让全部 connector 抖一下，cooperative 只动那几个被迁移的 task。

> **图示说明**：触发：worker 3 加入集群 eager (2.3 前) worker 1 全部暂停 worker 2 全部暂停 worker 3 新加入 集群整体停摆 stop-the-world cooperative (2.3 起) worker 1 继续搬 worker 2 仅迁出 task d worker 3 接收 task d 其余 task 不中断 只动差集 迁移 1 个 图 2.1 同一个触发（worker 3 加入）下两种再平衡的差别：eager 让全集群放下所有 task，cooperative 只迁移真正需要换主的 task d。 注意 ：cooperative 的关键不是"更快",而是 只动新旧分配的差集 ——绝大多数 task 在再平衡期间完全不知情、持续搬运。

#### 备选方案对比

**表 2.2 · 再平衡策略：两代设计**
| eager（stop-the-world） | 再平衡时全员先放弃所有 task，再统一重新领取 | 实现简单、分配逻辑无需算差集；但任何拓扑变更都让整个集群停摆，connector 越多抖动越大。2.3 起被取代。 |
| incremental cooperative（KIP-415） | 只收回需要换主的 task，分多轮增量收敛，其余 task 不停 | 选中：拓扑 / 配置变更的影响面缩到最小，扩缩容与单点故障不再波及无关 connector。代价是协议更复杂、收敛要多轮。 |

> **洞察 · 与消费者再平衡同源**
> Connect 的 incremental cooperative 与 Kafka 普通消费者的 cooperative sticky assignor 是**同一个思路的两次落地**：都把"全员重来"改成"只动差集"。读者若已理解主 Kafka 教程里消费组的[再平衡](https://zhiwenliang.github.io/learning/kafka/02-principles.html#rebalance)，这里只是把"被重分的是分区"换成"被重分的是 task"。这种一致性不是巧合——Connect 复用的就是 Kafka 那套 group membership 机制。

#### 代价与失效模式

cooperative 不是没有锋利的边。**worker 数在再平衡过程中继续变动会引入分配倾斜**（KAFKA-12495）：滚动重启时若 worker 一个接一个地进出，多轮增量再平衡可能收敛到一个 task 分布不均的中间态，部分 worker 过载、部分空闲。它不影响正确性，但会让吞吐不均，需要等集群稳定后再触发一次再平衡才会重新摊平。

> **陷阱**
> 滚动升级或扩容时如果让 worker 进出过快（一个还没稳定下一个又动），cooperative 再平衡会卡在倾斜的中间分配上——表现为某些 worker CPU 打满、另一些几乎空闲，而 task 全是 `RUNNING`。这不是配置错误，是 KAFKA-12495 这类已知的再平衡时序问题。处理方向：操作 worker 时留足稳定窗口、避免并发进出；集群稳定后必要时手动触发一次再平衡让分配重新摊匀。

想一想

一个 distributed 集群跑着 20 个 connector、共 60 个 task。运维加入第 4 台 worker。用 incremental cooperative 策略，再平衡期间这 60 个 task 里大约有多少会被暂停？换成旧的 eager 策略呢？

> **展开答案（先停 10 秒再点）**
>
> cooperative：**只有需要迁到新 worker 的那一小部分**被暂停——大约是为了让新 worker 分到公平份额而迁移的 task 数（数量级在十几个上下，取决于均摊目标），其余四十多个继续搬。eager：**全部 60 个**先被收回、集群整体停摆，等新分配算完再统一领回。
>
> 这道题指向的设计要点：再平衡的"代价"不是发生频率，而是**每次波及的 task 范围**。cooperative 把这个范围从"全部"压到"差集",这正是它在大集群里取代 eager 的根本原因。

**与下一个机制的关系**：再平衡决定 task 落在哪个 worker 上跑——而 task 真正搬运时，要把结构化记录变成 Kafka 里的字节。这一步的机制独立于 connector，发生在字节层：[序列化机制](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#serialization)。

### 2.3 序列化机制：converter 在字节层定格式，与 connector 解耦

序列化由 converter 在字节层完成、与 connector 完全解耦；走 Schema Registry 的格式在字节前缀里写 magic byte + schema id，而 `JsonConverter` 与 `JsonSchemaConverter` 是两种不可互换的 wire format。

#### 运行方式

01 章（[§1.4](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#converters)）讲了 converter 与 connector 解耦"是什么"。这里看字节层"怎么工作"。一条记录在 Connect 内部是带 schema 的结构化对象（`SchemaAndValue`）；converter 负责把它变成 Kafka 里的字节，反向亦然。关键在于**不同 converter 产出的字节布局完全不同**：

- **Schema Registry 系（Avro / Protobuf / JSON Schema converter）**：字节不是裸数据，而是带前缀的 wire format——第 1 个字节是 **magic byte**（值 `0x00`），紧跟 4 字节的 **schema id**，之后才是序列化后的 payload。消费端读到 schema id，去 Schema Registry 拉对应 schema 再解码。schema 本身不随每条消息走，只走一个 id——这是它比内嵌 schema 省体积的原因。
- **`JsonConverter`（`org.apache.kafka.connect.json`）**：产出纯 JSON 字节，没有 magic byte。`schemas.enable=true` 时每条消息内嵌一份 `{"schema":...,"payload":...}`，`false` 时只发裸 JSON。
- **`JsonSchemaConverter`（`io.confluent.connect.json`）**：名字像 JSON，但它走 Schema Registry、字节带 magic byte + schema id。**与 `JsonConverter` 的 wire format 完全不同，不可互换**——这是最容易混淆、也最容易出事的一对。

解耦体现在：同一个 connector，换 converter 就换了线上字节格式，connector 代码与配置一行不动（图 1.2 已示）。这把"序列化"从每个 connector 各实现一遍，变成一个可插拔的横切层。

> **图示说明**：Avro / Protobuf / JsonSchema converter magic 0x00 schema id 4 字节 序列化 payload Schema Registry 按 id 查 schema JsonConverter（纯 JSON，无前缀） { "id": 42, "amount": 9.9 } ← 直接是 JSON 字节 图 2.2 两种 wire format 的字节布局：Schema Registry 系在最前面塞 magic byte + 4 字节 schema id，再接 payload； JsonConverter 从第一个字节起就是 JSON。 注意 ：sink 端若用 JsonConverter 去读上面那种带 0x00 开头的字节，第一个字节就解析失败（ Unknown magic byte! ）——这正是两类 wire format 不可互换的物理根源。

#### 备选方案对比

**表 2.3 · 序列化放在哪：两种设计**
| 序列化烧进 connector | 每个 connector 内部自己实现各种格式 | 换格式要改 connector 代码；每个 connector 各实现一遍 JSON/Avro/Protobuf，重复且不一致；同一 connector 无法跨格式复用。被放弃。 |
| 固定单一线上格式 | 整个 Connect 强制一种序列化（如只许 Avro） | 无法对接已有的异构 topic（有的 JSON、有的 Avro、key 与 value 不同格式），现实里行不通。被放弃。 |
| 独立 converter 层（key/value 各一） | connector 只产出/消费结构化对象，converter 负责对象↔字节 | 选中：任意 connector × 任意格式自由组合，换格式只动配置；key 与 value 可用不同 converter。代价是多一层、且 sink 端必须配对线上真实格式。 |

#### 代价与失效模式

解耦的代价是**sink 端的 converter 必须与 topic 里实际的字节格式严格一致**，否则就是反序列化阶段的硬失败。最典型的失效是 **sink converter 与线上格式不符引发的反序列化风暴**：上游 producer 写 Avro（字节以 `0x00` 开头），sink 配了 `JsonConverter`，每一条记录在反序列化时都报 `Unknown magic byte!`。由于 `errors.tolerance` 默认 `none`（[§1.7](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#error-dlq)），第一条就让整个 task `FAILED`。converter 不会"猜"格式、不会默默降级——配错就是失败。

**修复：sink converter 对齐线上 Avro 格式 JSON**

```json
{
  "value.converter": "io.confluent.connect.avro.AvroConverter",
  "value.converter.schema.registry.url": "http://schema-registry:8081",
  "key.converter": "org.apache.kafka.connect.storage.StringConverter"
}
```

> **陷阱**
> 把 `JsonConverter`（`org.apache.kafka.connect.json`）当成 `JsonSchemaConverter`（`io.confluent.connect.json`）配，两端就此错位——一个发裸 JSON、一个期待 magic byte + schema id 的 JSON。它们名字只差一个词，wire format 却互不兼容。配 converter 时核对**完整类名**，尤其分清 `org.apache.kafka` 与 `io.confluent` 两个命名空间。

想一想

一个 source connector 用 `JsonSchemaConverter`（Confluent，带 magic byte）写一个 topic。下游有人新建一个 sink，把 `value.converter` 配成了 `JsonConverter`（Apache，纯 JSON），心想"反正都是 JSON"。sink 起得来吗？

> **展开答案（先停 10 秒再点）**
>
> 起不来——sink 的 task 在**反序列化阶段失败**。`JsonSchemaConverter` 写出的字节以 magic byte `0x00` + 4 字节 schema id 开头，`JsonConverter` 从第一个字节就按 JSON 解析，撞上 `0x00` 立刻报错（典型是 `Unknown magic byte!` 或 JSON 解析异常）。"都是 JSON"是错觉：两者的 wire format 一个有 Schema Registry 前缀、一个没有，物理布局不同。
>
> 这道题指向的设计要点：converter 解耦带来灵活，也把"格式契约"完全压在配置上。`org.apache.kafka...JsonConverter` 与 `io.confluent...JsonSchemaConverter` 不可互换——选 converter 时认的是字节布局，不是名字里的"Json"。

**与下一个机制的关系**：converter 把记录序列化进 Kafka 后，task 还得记住"搬到哪了"以便重启续传。而 source 与 sink 的偏移存法和恢复路径完全不同——这是[偏移管理与恢复](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#offset-recovery)。

### 2.4 偏移管理与恢复：source 存 topic、sink 用消费组，两套各自续传

source connector 把自定义偏移存进 `connect-offsets`、按 connector 名索引，sink connector 用消费组（组名 `connect-<name>`）的位点；重启时各自从上次提交处续，REST `/offsets`（KIP-875）可读写两者。

#### 运行方式

01 章（[§1.6](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#offsets)）建立了"两套偏移"这件事。这里看**恢复路径**怎么走。两套机制的差别源于一个事实：外部系统没有 Kafka 式的 offset 概念。

- **source 恢复**：外部系统（DB、文件）的"位点"由 connector 自己定义——"读到 `id=10042`""文件读到 byte 4096"。框架把这组 `{sourcePartition → sourceOffset}` 键值对周期性提交进 `connect-offsets` topic，**key 含 connector 名**。worker 重启或 task 被再平衡到别处，新实例先按自己的 connector 名去 `connect-offsets` 读回最近一次提交的偏移，再从那里继续向外部系统要数据。
- **sink 恢复**：sink 就是一个 Kafka 消费者，用**普通消费组**位点，组名固定为 `connect-<connector 名>`，位点存在 `__consumer_offsets`。重启即普通消费者重启——从消费组上次提交的位点接着消费，与任何 Kafka 消费者完全一样。

"按 connector 名索引"在 source 端埋了一个直接后果：**给 source connector 改名 = 新名字在 `connect-offsets` 里查不到任何偏移 = 框架认为它从未搬过 = 从头重灌整个外部源**。sink 端同理——改名意味着新消费组，从头消费。KIP-875（3.6）加了 REST `GET/PATCH/DELETE /connectors/{name}/offsets`，可以查看和手动调整两类偏移，但前提仍是名字稳定。

> **图示说明**：SOURCE source connector 自定义位点 框架提交 connect-offsets topic key 含 connector 名 重启按名读回 改名=丢偏移 SINK sink connector 就是个消费者 消费组提交 __consumer_offsets 组名 connect-<name> 重启续消费 普通消费者语义 图 2.3 两套偏移机制并排：source 把自定义位点按 connector 名存进 connect-offsets ，sink 用名为 connect-<name> 的消费组位点存进 __consumer_offsets 。 注意 ：两套都 以 connector 名为锚 ——改名在 source 端查不到旧偏移、在 sink 端是个新消费组，两边都从头开始。名字是偏移的主键。

#### 备选方案对比

**表 2.4 · source 与 sink 偏移：统一还是分两套**
| 统一用消费组偏移 | source 也强行套 Kafka 消费组位点语义 | source 读的是外部系统，位点是"DB 主键 / 文件字节",根本不是"topic+分区+offset",套消费组语义表达不了。被放弃。 |
| 统一存进外部存储 | source 与 sink 偏移都写进一个独立的偏移库 | 引入 Kafka 之外的故障点（与 §2.1 同理），还要为 sink 放弃 Kafka 原生消费组这套成熟机制。被放弃。 |
| source 存 topic / sink 用消费组 | source 自定义偏移进 `connect-offsets`；sink 复用消费组位点 | 选中：各自用最贴合语义的机制——source 的位点框架可任意建模，sink 直接白拿消费者重启续传。代价是两套机制、按名索引，改名即丢位置。 |

#### 代价与失效模式

分两套的代价集中在一个失效模式：**改 source connector 名 = 丢偏移 = 重灌**。想"重建"一个 source connector 而顺手把名字从 `orders-jdbc-source` 改成 `orders-jdbc-source-v2`，新名字在 `connect-offsets` 里对应一组空偏移，connector 会把整张表从头再搬一遍——对大表是一次代价高昂的全量重灌，还可能给下游灌入重复数据。

**用 REST 显式管理偏移（KIP-875, 3.6+）· 别靠改名 bash**

```bash
# 查看当前偏移（source 返回自定义位点；sink 返回消费组位点）
curl http://worker:8083/connectors/orders-jdbc-source/offsets

# 要重置时：先 stop，再 DELETE 偏移，而不是改名
curl -X PUT    http://worker:8083/connectors/orders-jdbc-source/stop
curl -X DELETE http://worker:8083/connectors/orders-jdbc-source/offsets
```

> **陷阱**
> 把"重置一个 source connector 的进度"和"给它改名"当成一回事，是偏移管理里代价最高的失误。改名不会重置进度——它是创建了一个**没有任何偏移记录的新 connector**，于是从头重灌。要重置进度，保持名字不变，用 REST 先 `stop` 再 `DELETE /offsets`；要保留进度地重建，更要保持名字一字不动。

想一想

一个 JDBC source connector 已把一张 5 亿行的表增量同步了三个月。团队想"换个更规范的名字"，于是删掉旧 connector、用新名字 `POST` 了一份配置完全相同（除了 `name`）的 connector。下一刻发生什么？

> **展开答案（先停 10 秒再点）**
>
> 新 connector 会**从头重灌整张 5 亿行的表**。source 偏移在 `connect-offsets` 里按 connector 名索引，新名字查不到任何已提交偏移，框架认为这是个全新的、从未搬过的 connector，于是从 `incrementing` 列的起点重新拉全量——海量重复数据涌向下游，下游若无幂等还会被污染。
>
> 这道题指向的设计要点：connector 名是偏移的**主键**，不是一个可随意美化的标签。"两套偏移、按名索引"的代价就是名字必须当成契约对待——要改进度用 REST `/offsets`，绝不靠改名。

**与下一个机制的关系**：默认的偏移提交是"先写记录、再提交偏移"，崩溃时这两步之间的窗口会导致**重发**——即"至少一次"。要做到"精确一次",必须把这两步绑成原子操作。这是 [EOS source](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#eos)。

### 2.5 EOS source：事务双写 + 代际 fencing，worker 级开关

EOS source（KIP-618）把"写记录"与"提交偏移"放进同一个 Kafka 事务原子完成，再用代际 fencing 拒绝僵尸 task 的写入；它是 worker 级开关 `exactly.once.source.support`，仅 distributed 可用、须全集群一致。

#### 运行方式

默认 source 是"至少一次"：task 先把一批记录写进目标 topic，再把对应偏移提交进 `connect-offsets`。如果崩溃发生在"记录已写、偏移未提交"这个窗口，重启后 task 从旧偏移续传，已写过的那批记录被**重发**。EOS source 用两个 Kafka 原语消除这个窗口：

- **事务双写**：task 把"一批数据记录"和"对应的偏移更新（写进 `connect-offsets`）"放进**同一个 Kafka 事务**，原子提交。要么记录与偏移一起生效，要么都不生效——"记录写了、偏移没写"的窗口不复存在。
- **代际 fencing（僵尸隔离）**：再平衡后旧 task 实例可能还"活着"想继续写（僵尸）。框架给每代 task 分配**递增的事务标识**，broker 只接受最新代的事务、**拒绝**旧代的写入。同一份工作因此只有最新一代能提交，僵尸写不进去。

开启是**两阶段滚动**：先把所有 worker 的 `exactly.once.source.support` 设为 `preparing` 滚动重启一轮，再设为 `enabled` 滚动重启一轮。两阶段是为了让集群在升级过程中始终保持一致——不能一半 worker 开、一半没开。connector 侧再声明 `exactly-once.support=required` 表示它要求这个保证。

> **图示说明**：task（当前代） 事务 id = N 同一个 Kafka 事务 写数据记录 → topic 写偏移 → connect-offsets broker 原子提交 记录与偏移同生共死 僵尸 task（旧代） 事务 id = N-1 broker 拒绝旧代 fencing：写不进去 图 2.4 EOS source 两件事：当前代 task 把"写记录"和"写偏移"装进同一个事务原子提交；旧代僵尸 task 因事务 id 过期被 broker fencing 拒绝。 注意 ：消除重复靠两件事咬合——事务保证"记录与偏移同生共死"（无重发窗口），fencing 保证"只有最新一代能写"（僵尸不重写）。少任一件都不成立。

#### 备选方案对比

**表 2.5 · source 端怎么做到精确一次：两种设计**
| 应用层 / 下游去重 | 接受 source 重发，靠下游按业务主键幂等或去重 | 把正确性责任推给每一个下游，各写各的去重逻辑、容易漏；source 仍在源头制造重复。作为框架级保证被放弃。 |
| 只提交偏移、不用事务 | 更频繁地提交偏移，缩小重发窗口 | 只是把窗口变小，没有消除——崩溃时机不巧仍会重发，做不到"精确一次"。被放弃。 |
| Kafka 事务 + 代际 fencing | 记录与偏移原子双写，僵尸 task 被 broker fencing 拒绝 | 选中：框架在源头保证精确一次，下游无需去重。代价：仅 distributed、worker 级全集群一致、两阶段升级、有事务开销。 |

#### 代价与失效模式

EOS source 的代价主要是约束而非性能：**仅 distributed 模式可用**（standalone 没有这套机制）、**是 worker 级开关、必须全集群一致**（不能 per-connector 单独开）、开启要**两阶段滚动**。最常见的失效是认知性的：以为能"只给账务这一个 connector 开 EOS"——做不到，要么整个 distributed 集群一起开，要么都不开。此外事务提交本身有开销，会略增延迟。

**connect-distributed.properties（worker 级、全集群一致） properties**

```properties
# 两阶段：先全员 preparing 滚动重启，再全员 enabled 滚动重启
exactly.once.source.support=enabled
```

> **陷阱**
> `exactly.once.source.support` 不是 per-connector 配置，写进 connector 的 JSON 里不会生效——它是 worker 级、要写进每个 worker 的 properties、且全集群取值必须一致。在 standalone 模式下它根本不可用。"给某个 connector 单独开精确一次"这个需求，在 Connect 的 source EOS 模型里不存在；能控制的只有 connector 侧 `exactly-once.support=required`（声明该 connector 要求集群提供这个保证）。

想一想

某团队想让一个计费 source connector 精确一次，于是只在这个 connector 的 JSON 配置里加了 `"exactly.once.source.support": "enabled"`，其余 worker 配置没动。重启后这个 connector 是精确一次吗？

> **展开答案（先停 10 秒再点）**
>
> 不是。`exactly.once.source.support` 是 **worker 级**配置，只在 worker 的 properties 里读；把它塞进 connector 的 JSON 不会开启 EOS——框架不会从 connector 配置里读这个 worker 级开关。这个计费 connector 仍是默认的"至少一次",崩溃时照样可能重发。要真正开启，得把所有 worker 的 properties 设成 `enabled`（经 `preparing` 两阶段滚动），并在 connector 侧声明 `exactly-once.support=required`。
>
> 这道题指向的设计要点：EOS source 是**集群级能力**，不是单个 connector 的属性。它要 fence 整个集群里同名 task 的所有代、要全员用事务语义，所以只能整集群开——这是它与 per-connector 配置（如 `tasks.max`、`errors.tolerance`）的根本区别。

### 2.6 跨机制综合：一条记录如何穿过整个集群

五个机制不是孤立的——一次真实的搬运同时用到协调、再平衡、序列化、偏移恢复。把它们串成一个场景，看它们如何协同。

**场景**：一个 distributed 集群（worker 1/2/3，`exactly.once.source.support` 未开）跑着一个 JDBC source connector，从 `orders` 表增量读、写进 `pg-orders` topic。某时刻 worker 2 宕机。跟着一条记录走一遍：

1. **task 分配（协调 §2.1 + 再平衡 §2.2）**：connector 启动时，leader worker 按 `tasks.max` 与可切分单元算出 task，均摊到三个 worker——假设 `orders` 表的 task d 落在 worker 2 上。这份分配方案写进 `connect-configs`。
2. **读取 + 序列化（序列化 §2.3）**：worker 2 上的 task d 从 `orders` 读到一行（`id=10042`），在 Connect 内部是结构化对象；`value.converter`（设为 Avro）把它序列化成带 magic byte + schema id 的字节，写进 `pg-orders`。
3. **提交偏移（偏移 §2.4）**：框架周期性把 task d 的位点 `{table:orders → incrementing:10042}` 提交进 `connect-offsets`，key 含 connector 名。
4. **worker 2 宕机 → 再平衡（§2.2）**：消费组协议检测到 worker 2 离开，触发 incremental cooperative 再平衡。worker 1/3 上无关的 task 继续搬，**只有 task d 被重新分配**——假设迁到 worker 3。
5. **从偏移续传（§2.4 + §2.1）**：worker 3 上新起的 task d 实例，先按 connector 名去 `connect-offsets` 读回最近提交的偏移（`incrementing:10042`），从 `id>10042` 继续向 `orders` 要数据——不重读已搬过的行。整个恢复没碰任何外部协调器，全程只读写 Kafka 的 topic。

这一圈把控制面（§2.1 三个 topic）、再平衡（§2.2 只动 task d）、序列化（§2.3 converter 定字节）、偏移恢复（§2.4 按名读回）咬合在一起。**注意一个边界**：因为这个集群没开 EOS（§2.5），第 3 步与第 2 步之间存在窗口——若 worker 2 恰在"记录已写、偏移未提交"时宕机，task d 在 worker 3 上会从上一个已提交偏移续传，重发 `10042` 这批里已写的记录（至少一次）。要消除这点，才需要 §2.5 的事务双写。

> **洞察 · 五个机制的分工**
> 一句话各归其位：**协调**决定状态存在哪（三个 topic）、**再平衡**决定 task 跑在哪（只动差集）、**序列化**决定记录长什么样（converter 定字节）、**偏移恢复**决定从哪续（按名读回）、**EOS**决定续得重不重（事务 + fencing）。前四个让搬运能在故障后正确地继续，第五个把"正确"从"至少一次"提到"精确一次"。

### § 本章 self-check

先合上教程，把你能想到的答案写在纸上或编辑器里。 写完再点开答案对照——直接点开等于把这一节当再读一遍。

1. distributed 集群的控制面由哪三个 topic 构成、各存什么？为什么它们必须是 compacted、且全集群配置一致？
2. incremental cooperative 再平衡相比 eager 改了什么？说清"只动差集"的含义，以及它在大集群里为什么是质变。
3. 走 Schema Registry 的 wire format 字节开头是什么？为什么 sink 端把 `JsonConverter` 用在 Avro topic 上会失败？
4. EOS source 靠哪两个 Kafka 原语做到精确一次？为什么它只能 worker 级、全集群一致地开，不能 per-connector？
5. （跨机制综合题）一个 distributed 集群跑着一个 JDBC source（未开 EOS），某 worker 宕机后一条记录被重新分配、从偏移续传。把这个过程涉及的协调、再平衡、序列化、偏移恢复四个机制串起来讲一遍，并指出在哪一步可能产生重复、要消除它需要开什么。

> **答案（先做完再展开）**
>
> 1. `connect-configs`（connector/task 配置）、`connect-offsets`（source 偏移）、`connect-status`（connector/task 状态）。必须 compacted 是因为它们存的是"状态"——只关心每个 key 的最新值，压缩保证 worker 重启能从 topic 重建当前世界又不无限增长；按时间删除会丢掉旧 key 的最新值导致失忆（如偏移被删→重灌）。全集群配置一致（topic 名相同、都 compacted、`group.id` 一致）否则集群会读到不一致控制面或裂成两个。
> 2. eager 在再平衡时让全员先放弃所有 task 再统一重领（stop-the-world）；cooperative 只收回新旧分配的**差集**（真正需要换主的 task），其余 task 完全不停。质变在于：波及范围从"全部 task"压到"被迁移的少数"——大集群里加一台 worker，eager 让所有 connector 抖动，cooperative 只动那几个 task。
> 3. 走 Schema Registry 的字节以 **magic byte（`0x00`）+ 4 字节 schema id** 开头，之后才是 payload。`JsonConverter` 是纯 JSON、没有这个前缀，用它读 Avro topic 时，它把第一个字节（`0x00`）按 JSON 解析立刻失败（`Unknown magic byte!`）；因 `errors.tolerance` 默认 `none`，第一条就让 task `FAILED`。两者 wire format 物理布局不同，不可互换。
> 4. ① **Kafka 事务**：把"写记录"与"写偏移（进 `connect-offsets`）"放进同一事务原子提交，消除"记录写了偏移没写"的重发窗口。② **代际 fencing**：给每代 task 递增事务 id，broker 拒绝旧代僵尸 task 的写入。只能全集群开是因为它要 fence 整个集群里同名 task 的所有代、全员用事务语义——这是集群级能力，不是单 connector 属性；且仅 distributed 可用、两阶段（preparing→enabled）滚动升级。
> 5. ① leader 按 `tasks.max` 与可切分单元算出 task 均摊到各 worker，方案写进 `connect-configs`（协调 §2.1）；② task 从表读行、converter 序列化成字节写进 topic（序列化 §2.3）；③ 框架周期性把位点按 connector 名提交进 `connect-offsets`（偏移 §2.4）；④ worker 宕机触发 incremental cooperative 再平衡，无关 task 不停、只有该 task 被迁到别的 worker（再平衡 §2.2）；⑤ 新 task 实例按 connector 名读回最近偏移、从该位点续传，全程只读写 Kafka topic、不碰外部协调器（§2.4+§2.1）。**产生重复的点**：第②与第③步之间有窗口——若崩溃在"记录已写、偏移未提交"时，续传会重发那批已写记录（至少一次）。要消除它需开 **EOS source（§2.5）**：把记录与偏移原子双写进同一事务，并对僵尸 task 做 fencing。

进阶挑战 · 刚好够不着

#### EOS source 用 Kafka 事务搞定原子双写——那 EOS sink 为什么不能照搬同一招？

§2.5 的精确一次靠"把记录和偏移放进同一个 Kafka 事务"。这一招成立的前提，是这两个被写的对象**都在 Kafka 里**。现在反过来想 sink 端：sink 要把数据写进的是外部系统（ES、JDBC），消费位点在 Kafka 的消费组里。想一想：为什么"用一个 Kafka 事务把外部写入和消费位点绑在一起"这条路走不通？sink 端要做到精确一次，必须依赖什么、由谁提供？

> **提示（卡住再展开）**
>
> Kafka 事务只能覆盖"写进 Kafka 的操作"。source 的两个对象（数据记录、偏移）都是写进 Kafka 的，所以一个事务能同时管。sink 的两个对象是"外部系统的写入"（在 Kafka 之外）和"消费位点"（在 Kafka 内）——前者根本不在 Kafka 事务的管辖范围，事务提交了也无法回滚一次已发生的 ES 写入。线索：sink 端的精确一次必须靠**外部系统自己的能力**——幂等写入（同一记录写多次效果等同一次，如按主键 upsert）或外部系统自己的事务，让重复投递不产生重复效果。这就是为什么 EOS source 是一个统一的框架开关，而"sink 精确一次"取决于目标系统支不支持、没有对应的全局开关。可对照主教程的[投递语义与事务](https://zhiwenliang.github.io/learning/kafka/02-principles.html#delivery)一节。

---

## 第三章：自测题库——从回忆到判别



01 章给了词汇表（connector / worker / task / converter / SMT / offset / DLQ / EOS source），02 章给了机制与取舍（控制面在 Kafka topic、incremental cooperative 再平衡、序列化 wire format、偏移恢复、EOS 事务 + fencing）。读得顺不等于答得出。这一章把那两章的内容翻过来——不再喂结论，而是逼着读者从空白里把结论提取出来，并在真实选型场景里做判别。

> **这一章怎么用**
>
> - 三层梯度共 **16 道**题：概念层 6 道（对应 01）、原理层 6 道（对应 02）、应用判别层 4 道（跨 01 + 02 的选型场景）。
> - 每道题先合上教程、把答案写在纸上或编辑器里，**写完**再翻文末答案对照——直接看答案等于把这两章当再读一遍，提取的训练效果归零。
> - 所有答案集中在**文末一个折叠块**里，按三层分组。题目区只有题，没有夹带答案。
> - 应用判别层是这套 concept-focused 教程的迁移训练主战场——它检验的不是"记没记住"，而是"换个真实场景还选得对吗"。

> **图示说明**：概念层 · 回忆 原子定义 · 对应 01 章 · 6 道 原理层 · 理解 机制为何如此 · 对应 02 章 · 6 道 判别 · 迁移 真实选型 · 跨 01+02 · 4 道 最难 认得出 讲得清 选得对 认知要求 自下而上 图 3.0 三层题库不是难度随机堆叠，而是一座金字塔：底层"认得出"概念、中层"讲得清"机制、顶层"选得对"场景，认知要求自下而上递增。 注意 ：塔尖最窄、题量最少（4 道判别），却是这套 concept-focused 教程 唯一 训练迁移的地方——底层答得再溜，塔尖答不出就等于没真正理解取舍。

### A 概念层 · 对应 01 章（6 道）

每题只考一个原子概念——一句话就该答得出。答不上来的，顺着提示链回 01 章对应小节补。

1. source connector 与 sink connector 的数据流方向各是什么？一句话说清。 提示：参考 [01 章 §1.1 connector](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#connectors)
2. standalone 与 distributed 两种 worker 模式，关键差异是什么？各自适合什么场景？ 提示：参考 [01 章 §1.2 worker](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#workers)
3. task 和 connector 是什么关系？为什么说"并行单位是 task 不是 connector"？ 提示：参考 [01 章 §1.3 task](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#tasks)
4. converter 到底干什么？为什么序列化格式由它决定、而不是由 connector 决定？ 提示：参考 [01 章 §1.4 converter](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#converters)
5. SMT 能不能按 key 关联另一个 topic 做 join 或聚合？为什么？这类需求该交给谁？ 提示：参考 [01 章 §1.5 SMT](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#smt)
6. source connector 的偏移存在哪里、按什么索引？这与 sink connector 的偏移有什么不同？ 提示：参考 [01 章 §1.6 offset](https://zhiwenliang.github.io/learning/kafka-connect/01-concepts.html#offsets)

### B 原理层 · 对应 02 章（6 道）

这一层不问"是什么"，问"为什么这么设计、代价是什么"。答案要触及机制，而不是复述定义。

7. distributed 模式的三个 internal topic（`connect-configs` / `connect-offsets` / `connect-status`）为什么都必须是 compacted？如果不压缩会怎样？ 提示：参考 [02 章 §2.1 控制面协调](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#coordination)
8. incremental cooperative 再平衡（KIP-415）相比早期的 eager stop-the-world 再平衡，到底解决了什么问题？代价是什么？ 提示：参考 [02 章 §2.2 再平衡](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#rebalance)
9. `org.apache.kafka.connect.json.JsonConverter` 与 `io.confluent.connect.json.JsonSchemaConverter` 名字相近，为什么说它们的 wire format 完全不同、不可互换？字节层差在哪？ 提示：参考 [02 章 §2.3 序列化机制](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#serialization)
10. 给一个正在运行的 source connector 改名，为什么会导致它从头重灌整个外部源？从偏移恢复机制讲清因果。 提示：参考 [02 章 §2.4 偏移恢复](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#offset-recovery)
11. EOS source（KIP-618）靠哪两个 Kafka 原语做到精确一次？事务保证了什么、fencing 又拦住了什么？ 提示：参考 [02 章 §2.5 EOS 机制](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#eos)
12. distributed worker 的 `group.id` 配错（一半 worker 用 A、一半用 B）会发生什么？为什么这是配置一致性的红线？ 提示：参考 [02 章 §2.1 控制面协调](https://zhiwenliang.github.io/learning/kafka-connect/02-principles.html#coordination)

### C 应用判别层 · 跨 01 + 02 场景（4 道，capstone 替代）

这一层把概念放进真实选型里。每题给一个场景，回答**选哪个、为什么**——理由要落到前两章的具体机制上，而不是"感觉这个更好"。这四道题承担整套 concept-focused 教程的判别训练职责，是塔尖。

13. **Connect 还是自写 producer？**要把一张 Postgres 表持续同步进 Kafka。一名工程师提议直接写个 producer 程序轮询表、把行发进 topic。该用 Kafka Connect 还是自写 producer/consumer？给出理由——Connect 在这件事上白送了哪些自写时必须自己实现的东西？
14. **SMT 还是 Kafka Streams？**需求是：把订单 topic 按订单 key 关联用户 topic 的用户信息，再按地区聚合下单金额，结果写进一个新 topic。这该用 connector 的 SMT 链实现，还是另起一个 Kafka Streams 应用？为什么？
15. **SMT 还是 Streams（轻量版）？**需求变了：只是在数据摄入 Kafka 时，把每条记录里的手机号字段脱敏、并给字段改个名，不做任何跨记录关联。这次该用 SMT 还是 Streams？和上一题的判断为什么相反？
16. **standalone 还是 distributed？**两个场景：(a) 开发机上临时把一个本地日志文件搬进 Kafka 做联调；(b) 生产环境跑 20 个 connector，要求某台机器宕机后任务自动转移、且能用 REST 在线增删 connector。各该选哪种 worker 模式？分界点是什么？

### D 面试加餐：这几道题的"强答案"必须包含什么

下面五道题最容易"答得像懂了、实则露馅"——普通答案停在表层、资深答案点到机制与边界。对照这张表检查自己上面写的答案够不够硬。这是面试官区分"用过"和"理解"的分水岭。

**表 3.1 · 五道最易露馅题：普通答案 vs 资深答案**
| EOS source 怎么实现的？ | "它能保证精确一次、不重复。" | Kafka **事务**把数据记录 + 偏移更新原子**双写**；**fencing** 给每代 task 递增标识、broker 拒绝僵尸旧代的写入。是 **worker 级**开关 `exactly.once.source.support`、**仅 distributed**、**全集群一致**开（两阶段 preparing→enabled），不能 per-connector（KIP-618, 3.3 GA）。 |
| source 与 sink 的偏移有什么不同？ | "都是记录搬到哪了，用来重启续传。" | source 是 connector **自定义格式**的偏移，存进 `connect-offsets` topic、**按 connector 名索引**——所以改名 = 查不到旧偏移 = 从头重灌。sink 是**普通消费组**位点（组名 `connect-<name>`），存在 `__consumer_offsets`，和任何消费者一样。两套机制，不是一回事。 |
| `tasks.max` 怎么映射并行度？ | "设成几就有几个 task 并行。" | `tasks.max` 是**上限不是保证**。实际 task 数由 connector 决定能切几份，再对上限取下限：sink 受**订阅分区数**封顶（每 task 一个消费组成员）、JDBC source 受**表数**限。超出的 task 不报错只**空转**，`GET /status` 仍显示 RUNNING——排查吞吐的常见误判点。 |
| DLQ 能抓到哪些错误？ | "开了 DLQ，坏记录都进死信队列，就不丢了。" | DLQ **仅 sink** 可用，且**只抓 converter / SMT / key-value 反序列化错误**——即"这条记录读不懂/变换不了"。**不抓** sink 写外部系统的**投递失败**（ES 拒写、JDBC 主键冲突），那类走 `errors.retry.*` 重试、耗尽仍让 task 失败。再加 `errors.tolerance` 默认 `none`（一条坏记录停整 task）这层。 |
| 三个 internal topic 为什么 compacted？ | "为了持久化，不丢配置。" | 它们是 **key-value 状态存储**，要的是**每个 key 的最新值**（最新配置 / 最新偏移 / 最新状态），不是完整历史——compaction 正好保留每 key 最新、回收旧值。若不压缩，topic 无限膨胀、worker 重启重放全部历史变慢。配套红线：`group.id` 不一致会把一个集群**裂成两个**。 |

> **洞察 · 面试官在听什么**
> 面试官真正在意的不是术语背诵，而是**对取舍的推理**和**失败模式的故事**。能讲出"converter 配错导致反序列化风暴""source 改名丢偏移从头重灌""毒丸记录默认停整个 task"这类具体失败链，比复述十个定义更能证明真用过、真理解。强答案 = 机制 + 边界 + 它在什么时候会咬人。

> **亲手画一张图**
> 合上教程，在纸上或 Excalidraw 里画出一条记录的完整路径：从**外部源** → `source connector` → `converter` 序列化 → **Kafka topic** → `converter` 反序列化 → `sink connector` → **外部目标**。然后在图上标出**两处偏移分别存在哪**——source 端的偏移、sink 端的偏移。画完回到 [起点页的概念图（§概念图）](https://zhiwenliang.github.io/learning/kafka-connect/index.html)对照：这**两处偏移你都标对了吗**？（提示：一处在 `connect-offsets` topic 按 connector 名索引，另一处是普通消费组位点——画错任一处，说明 §1.6 那条边界还没真正内化。）

### § 答案（三层都做完再展开）

下面是全部 16 道题的答案，按三层分组。先把你自己的答案写完——直接展开对照，提取练习的效果就没了。

> **展开全部答案（16 道，按概念层 / 原理层 / 应用判别层分组）**
>
> ### 概念层（对应 01 章）
>
> 1. **source → Kafka，sink → 外部**。source connector 把外部系统（数据库、文件、消息队列）的数据写进 Kafka；sink connector 把 Kafka 的数据写进外部系统（ES、S3、JDBC）。方向相反，是同一套插件契约的两端。
> 2. standalone 是**单进程、文件配置、无容错**，偏移存本地文件，进程死即状态没——只适合开发期或单机日志搬运。distributed 是**多 worker 共享一个 `group.id` 组成集群**，靠 REST 管理、worker 加入/离开/故障自动再平衡，状态存 Kafka topic——生产环境用它。两者不是大小号关系，而是**两套不同的存储与协调模型**。
> 3. connector 是"一份配置 + 把工作切成 N 份的计划"，它本身**不搬数据**；真正读写数据的是它派生出的 task。一个 connector 最多派生 `tasks.max` 个 task，被均摊到各 worker 并行跑。所以扩容、估吞吐都按 task 算——并行单位是 task。
> 4. converter 负责记录在 Connect **内部结构化对象**与 **Kafka 字节**之间的相互转换（序列化/反序列化），key 和 value 各配一个。格式由它决定而非 connector，是因为 Connect 把序列化抽成了独立的一层、与 connector **解耦**——于是任意 connector × 任意格式自由组合，换格式只动配置不动 connector 代码。
> 5. **不能**。SMT 是**单条、无状态**的逐条变换，一次只看一条记录、没有跨记录内存，所以做不了 join、聚合、按 key 关联另一个 topic、一条变多条。这类**有状态**关联是 Kafka Streams / ksqlDB 的职责。
> 6. source 偏移是 connector **自定义格式**，存进 `connect-offsets` topic，**按 connector 名索引**。sink 偏移是**普通消费组**位点（组名 `connect-<connector 名>`），存在 Kafka 的 `__consumer_offsets` 里，和任何消费者一样。两套完全不同的机制。
>
> ### 原理层（对应 02 章）
>
> 7. 这三个 topic 是**key-value 状态存储**，需要的是每个 key 的**最新值**——最新的 connector 配置、最新的 source 偏移、最新的 task 状态——而不是完整的变更历史。compaction 正好保留每个 key 的最新记录、回收旧值。若不压缩：topic 会无限膨胀，且 worker 启动时要重放全部历史才能重建当前状态，恢复越来越慢。
> 8. 它解决的是**"一点变动就全停"**的问题。eager 再平衡在任何拓扑/配置变更时**停掉所有 task**重新分配（stop-the-world），变更越频繁停摆越多。incremental cooperative 只**暂停被收回或被移动的那部分 task**，其余继续搬。代价：分配过程分多轮收敛、逻辑更复杂；且 worker 数中途变动有已知的 skew bug（KAFKA-12495）。
> 9. `JsonConverter` 产出的是**纯 JSON 字节**（可选每条内嵌 `{"schema":...,"payload":...}`），自描述、不依赖外部注册中心。`JsonSchemaConverter` 走 **Schema Registry**，字节里带 **magic byte + schema id**（Confluent wire format），靠 id 去注册中心取 schema。字节布局根本不同——用一个写、用另一个读，会在反序列化阶段失败（典型 `Unknown magic byte!`）。名字像，不可互换。
> 10. source 偏移**按 connector 名索引**存在 `connect-offsets` 里。改名后，框架拿新名字去查偏移，查到的是**一组空偏移**——它认为这个 connector 从未搬过任何数据，于是从外部源的起点重新全量搬一遍。机制上"改名"等价于"新建一个没有历史的 connector"。要重置应该用 REST `/offsets` 显式管理，而不是靠改名。
> 11. 靠**事务**和 **fencing**。事务：task 把一批数据记录 + 对应的偏移更新（写进 `connect-offsets`）放进**同一个 Kafka 事务**原子提交——要么都生效要么都不生效，杜绝"记录写了、偏移没写、重启重发"的窗口。fencing（僵尸隔离）：再平衡后旧 task 实例可能还活着想写（僵尸），框架给每代 task 递增的事务标识，broker **拒绝旧代**的写入，保证同一份工作只有最新一代能提交。
> 12. `group.id` 是 distributed worker 加入**同一个 Connect 集群**的身份。一半用 A、一半用 B，会形成**两个互不相识的集群**：各自读不同的 internal topic、各自以为自己拥有全部 connector，导致 connector 被重复调度或"凭空消失"。这是红线，因为 distributed 的整个协调与状态共享都建立在"所有 worker 同 `group.id` + 同三个 internal topic 配置"之上。
>
> ### 应用判别层（综合 01 + 02）
>
> 13. **用 Connect，别自写 producer。**把表同步进 Kafka 是标准化搬运，Connect 白送了自写时必须自己实现的一整套：**偏移跟踪与重启续传**（source 偏移自动存 `connect-offsets`）、**并行**（task 切分 + 跨 worker 分摊）、**容错与再平衡**（worker 宕机任务自动转移）、**REST 在线管理**（增删改查、暂停恢复）、以及现成的 JDBC/Debezium connector。自写就是重造一条 ETL 管道，还得自己维护位点、容错、监控。只有当需求超出"搬运"（要复杂有状态加工）时才另说。
> 14. **用 Kafka Streams，不是 SMT。**这需求是**有状态**的：按 key join 两个 topic + 跨记录聚合。SMT 单条无状态，看不到第二条记录、做不了 join / 聚合 / 1→N，强行用会卡在"拿不到要关联的数据"上。join + 聚合 + 写出新 topic 正是 Streams / ksqlDB 的核心能力。
> 15. **用 SMT，不是 Streams。**这次是纯**逐条、无状态**的编辑——脱敏一个字段（`MaskField`）、改字段名（`ReplaceField`），不跨记录。SMT 几行配置内联在搬运路径上就完成，零代码、无需独立应用和 topic。为这点事起一个 Streams 应用是杀鸡用牛刀。**和上一题相反**的判断点就是这一个词：**有没有状态**——要不要看到"别的记录"。要，则 Streams；不要，则 SMT。
> 16. (a) 开发机临时搬本地文件 → **standalone**：一个进程、一个 properties 文件就够，不需要集群和 REST。(b) 生产 20 个 connector + 故障自动转移 + REST 在线增删 → 必须 **distributed**。分界点是三个词：**容错、可在线管理、生产规模**——任一为真就上 distributed。standalone 没有自动再平衡、没有 REST 集群管理、进程死即状态没，扛不住生产。

收尾挑战 · 把整套串起来

#### 一句话能不能说清 Connect 的"控制面"特殊在哪？

不看教程，用一句话回答：为什么说 Connect 的 distributed 集群"没有外部协调器、没有数据库"，它的全部状态在哪？再追一层——这个设计省掉了什么基建，又因此引入了什么新的失败模式？答得出这一句，说明 01 + 02 两章的主线（控制面全在 Kafka compacted topic 里）已经长进认知里了。

> **提示（卡住再展开）**
>
> 线索：distributed worker 靠 Kafka 自己的**消费组协议**协调，全部状态（配置 / 偏移 / 状态）写进三个 **compacted internal topic**——所以不需要 ZooKeeper、不需要外部数据库。省掉的基建：一套独立的协调/存储组件。引入的新失败模式：这三个 topic 配置不一致或损坏 = 集群坏；`group.id` 配错 = 集群裂成两个。"配置即数据、控制面在 Kafka 里"既是它的优雅之处，也是它的脆弱之处。

---

## 总结

Kafka Connect 的价值，不只是“少写一个 producer 或 consumer”，而是把数据搬运抽象成一套可配置、可扩展、可恢复的运行框架：

1. **connector 负责搬运，converter 决定格式，SMT 完成单条无状态变换**，三者职责必须分清。
2. **task 才是并行执行单位**，`tasks.max` 只是上限，真实并行度仍受分区数、表数和 connector 实现限制。
3. **distributed worker 把控制面放在 Kafka 内部 topic 中**，因此获得持久化、协调和故障转移能力，也把 `group.id` 与 internal topic 配置变成运维红线。
4. **source 与 sink 使用两套偏移机制**，connector 改名往往等价于创建一个没有历史位置的新任务。
5. **Connect 适合标准化搬运，SMT 适合轻量逐条加工，Streams/ksqlDB 才适合 join、聚合、窗口等有状态处理**。

真正掌握 Kafka Connect 的标志，是面对一条数据链路时，能清楚判断问题属于 connector、converter、task、offset、错误处理还是控制面，并能据此选择正确的配置和排查路径。

## 参考资料

- [Apache Kafka Connect 官方文档](https://kafka.apache.org/documentation/#connect)
- [KIP-415：Incremental Cooperative Rebalancing in Kafka Connect](https://cwiki.apache.org/confluence/display/KAFKA/KIP-415:+Incremental+Cooperative+Rebalancing+in+Kafka+Connect)
- [KIP-618：Exactly-Once Support for Source Connectors](https://cwiki.apache.org/confluence/display/KAFKA/KIP-618:+Exactly-Once+Support+for+Source+Connectors)
- [Confluent：Kafka Connect Converters and Serialization Explained](https://www.confluent.io/blog/kafka-connect-deep-dive-converters-serialization-explained/)
- [Confluent：Kafka Connect Error Handling and Dead Letter Queues](https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/)
- [Red Hat：Manage and Preserve Kafka Connect Offsets](https://developers.redhat.com/articles/2024/06/13/how-manage-and-preserve-kafka-connect-offsets-smoothly)
- [Apache Kafka 4.3.0 Release Announcement](https://kafka.apache.org/blog/2026/05/22/apache-kafka-4.3.0-release-announcement/)
