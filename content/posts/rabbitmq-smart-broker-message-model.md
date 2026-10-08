---
title: RabbitMQ：智能 broker 的消息模型
description: 从 exchange、queue、binding 到 publisher confirms、quorum 队列与 Kafka 对比，建立 RabbitMQ 这套智能 broker 的完整心智模型。
date: 2026-10-06
tags: RabbitMQ, 消息队列, 分布式系统
featured: true
---

<a id="top"></a>

# RabbitMQ：智能 broker 的消息模型

> 本文由目录中的 6 个离线 HTML 页面整理合并，保留原有代码、表格、自测题和 14 张架构图。原教程的技术现状标注为“截至 2026-06”，本文整理日期为 2026-10-06；涉及版本状态与基准数字时，应以该资料基线理解。

> 基于 RabbitMQ 4.x（4.3，2026-04）。阅读时间约半天（deep-dive）。本教程以概念与机制为主，示例配置/命令用于说明，未在本机逐条运行的会就地标注。读完你会用一条主线看懂 RabbitMQ，并能和 Kafka 做选型。

<a id="fit"></a>

## 适合谁

这份教程假设你具备以下三项。任一项缺失，下面"不适合谁"有更合适的去处。

- 能读懂一段后端服务代码，理解线程、TCP 连接、进程这些基本概念。
- 用过**至少一种**消息系统或队列——最好是 **Kafka**。本教程大量以"你已经懂 Kafka"为支点来讲 RabbitMQ 的不同之处。
- 目标是**系统理解** RabbitMQ 的模型与机制（为面试、架构评审或选型），而不是只复制一段能跑的代码。

<a id="unfit"></a>

## 不适合谁

- **完全没接触过消息队列**：先读一篇"为什么需要消息队列"的入门，再回来，否则第 1 章的解耦动机会落空。可看 [CloudAMQP: What is message queuing](https://www.cloudamqp.com/blog/what-is-message-queuing.html)。
- **只想要一段能跑的 Python/Java 收发代码**：直接看 [官方六个 tutorial](https://www.rabbitmq.com/tutorials) 更快；本教程刻意不做代码渐进，重在心智模型。
- **要做 RabbitMQ 集群部署与调优实操**：本教程讲清机制与判据，但不是一份运维手册；落地时配合官方 [Production Checklist](https://www.rabbitmq.com/docs/production-checklist)。

<a id="outcome"></a>

## 读完之后你能做到什么

读完你能用**一条主线**——"智能 broker、ack 后删除" 对 "Kafka 不可变日志、offset 可重放"——当场讲清 RabbitMQ 的**路由灵活、无重放、单队列吞吐瓶颈**为什么是**同一个设计决策的三个侧面**，并据此做 RabbitMQ/Kafka 选型，而不是背一张特性对比表。具体而言：

- 画出消息从 producer 经 exchange、binding 到 queue、再到 consumer 并在 ack 后删除的完整路径。
- 区分四种 exchange 的路由规则，为给定订阅需求写出正确的 binding key。
- 说清 publisher confirms 与 consumer ack 各防住哪一类丢失，以及 durable / persistent / quorum 三者的区别——尤其"classic 队列确认后仍可能丢"。
- 解释 quorum 队列用 Raft 如何取代已移除的镜像队列，以及为什么单个队列是吞吐天花板。
- 在给定场景下判断该用 RabbitMQ 还是 Kafka、该用哪种 queue、哪种 exchange，并讲出依据。

### 一句话本质

> **RabbitMQ 是“智能 broker / 笨消费者”**：路由、投递追踪、ack 后删除都发生在 broker 内部，消息一旦被 ack 就消失。这与 Kafka 的“笨 broker / 智能消费者 + 不可变日志 + 消费者自己记 offset”正好相反。抓住这一点，后面所有特性都是它的推论。

> **现状速览 · 截至 2026-06**
>
> **稳定核心**：AMQP 0-9-1 模型（exchange/queue/binding）、publisher confirms、consumer ack、prefetch——十余年稳定，放心学。
>
> **近期变动**：4.0（2024-09）把 AMQP 1.0 升为一等核心协议、默认消息上限从 128 降到 16 MiB；4.2（2025-10）Khepri 成为新节点默认元数据存储；4.3（2026-04）Khepri 成唯一存储、Mnesia 移除。**quorum 队列现为默认队列类型。**
>
> **已被取代（别再学旧做法）**：classic mirrored queues（镜像队列，`ha-mode`）在 4.0 移除 → 用 quorum 队列；Mnesia → Khepri；AMQP 事务 `tx` → publisher confirms。看到这些旧配置，基本能判定材料过时。

> **读之前 · 一个提醒**
>
> 这份教程在很多地方会故意让你慢下来——预测题、折叠的答案、"自己先画一张图"。原因是：**读得顺，不等于学会了。**三种感觉最会骗人，遇到时停一下：
>
> 「**我读得很顺**」——顺往往只是眼熟，不是掌握。合上页面能复述吗？  
> 「**我做题很快**」——快往往是题型见过，换个场景还快吗？  
> 「**我没卡壳**」——没卡壳可能是没碰到真正的难点。把答案盖住自己讲一遍试试。

<a id="map"></a>

## 概念地图

![图 0.1 RabbitMQ 的五个核心抽象与消息流向。 注意 三件事：① 消息发给 Exchange 不发给 Queue（红色中心是 RabbitMQ 独有的概念）；② binding 才决定消息进哪些 Queue；③ Consumer ack 后 broker 删除 消息——这里没有 offset，正是它和 Kafka 的分叉。](/blog-assets/rabbitmq-smart-broker/intro-diagram-01.svg)

*图 0.1 RabbitMQ 的五个核心抽象与消息流向。 注意 三件事：① 消息发给 Exchange 不发给 Queue（红色中心是 RabbitMQ 独有的概念）；② binding 才决定消息进哪些 Queue；③ Consumer ack 后 broker 删除 消息——这里没有 offset，正是它和 Kafka 的分叉。*

<a id="paths"></a>

## 学习路径建议

顶部面包屑就是线性路径（00→05，每章高亮当前位置）。按目标挑一条走法：

表 0.1 · 三种读法

| 你的目标 | 建议路线 |
| --- | --- |
| 只想建立心智模型 | 01 模型 → 02 可靠投递 →（03 跳读）→ 04 对标，重在理解"为什么" |
| 面试 / 架构评审 | 01 → 02 → 03 → 04 → 05 全程，重点啃 03 的 Raft/流控 与 04 的选型判据 |
| 已有 Kafka 基础、只想搞清差异 | 先看 01 §1.4 生命周期 → 直奔 04 对标 → 回补 02 可靠性与 03 机制 |

<a id="toc"></a>

## 目录

- [第 1 章：模型与路由](#chapter-01)
- [第 2 章：可靠投递](#chapter-02)
- [第 3 章：内部机制](#chapter-03)
- [第 4 章：对标 Kafka 与技术选型](#chapter-04)
- [第 5 章：自测与辨析](#chapter-05)

<a id="next"></a>

## 学完之后

- **AMQP 1.0 与多协议**：4.x 把 AMQP 1.0 升为核心协议，MQTT 5.0 原生支持——它在 schema 上加的是"RabbitMQ 不只是 AMQP 0-9-1"。
- **RabbitMQ Streams 深入**：super-streams、offset 跟踪、服务端过滤——补上"重放/事件流"这一侧，和 Kafka 正面对比。
- **可观测性**：Prometheus + Grafana 监控 quorum 队列、内存/磁盘告警、unacked 堆积——把第 2、3 章的故障信号变成可观测指标。
- **客户端实战**：Spring AMQP / Java client 的连接与 channel 池、消费者并发模型——把第 1 章的 channel 规则落到代码层。

### 本章参考

- [RabbitMQ 官方文档](https://www.rabbitmq.com/docs)（必读基准）
- [AMQP 0-9-1 Model Explained](https://www.rabbitmq.com/tutorials/amqp-concepts)（官方模型说明）
- [Quorum Queues in 4.0](https://www.rabbitmq.com/blog/2024/08/28/quorum-queues-in-4.0) · [What's new in 4.0](https://blog.rabbitmq.com/docs/4.0/whats-new)（设计与版本）
- [Jack Vanlightly: RabbitMQ vs Kafka](https://jack-vanlightly.com/blog/2017/12/4/rabbitmq-vs-kafka-part-1-messaging-topologies)（架构对比经典）
- [Confluent 2024 吞吐基准](https://www.confluent.io/blog/kafka-fastest-messaging-system/) · [CloudAMQP 最佳实践](https://www.cloudamqp.com/blog/part1-rabbitmq-best-practice.html)

---

<a id="chapter-01"></a>

## 模型与路由：消息不是发给队列的

> RabbitMQ 的一切都立在一个反直觉的事实上：生产者从不把消息发给队列。这一章拆开消息从 producer 到 consumer 的完整路径——以及它在 ack 之后消失的那一刻。

### 本章你将建立的 schema

- Connection 与 Channel 的多路复用：一条 TCP，多个 channel，靠帧里的编号区分
- exchange / queue / binding 三件套：消息发给 exchange，由 binding 路由到 queue
- 四种 exchange 的路由规则，以及 routing key 与 binding key 的区别
- 消息生命周期：ack 之后即删除——RabbitMQ 没有 offset，这是它与 Kafka 的根本分叉

<a id="s11"></a>

## 1.1 Connection 与 Channel

Channel 是复用在一条 TCP Connection 上的轻量虚拟连接；所有协议交互跑在 channel 上，而不是直接跑在 TCP 上。

> **为什么需要它**
>
> 一个高并发服务可能有几百个线程同时收发消息。每个线程开一条 TCP 连接，意味着几百次握手、几百个文件描述符、几百份内核缓冲。channel 把这些复用到一条（或少数几条）TCP 连接上：每个 channel 一个编号，broker 靠编号把会话区分开。

**底层机制（比文档深一层）**：AMQP 把每一帧（frame）都打上 2 字节的 channel 编号，broker 按编号把帧分发给对应的会话状态机。代价直接来自这个设计——同一个 channel 上的帧严格有序、串行处理，所以一个 channel 不能跨线程共享：两个线程往同一 channel 写，帧会交错，broker 解析到一半发现结构不对，报 `unexpected frame` 甚至断开连接。帧结构本身留到 [03 章](#s31)拆开。

![图 1.1 三个线程各用一个 channel，复用同一条 TCP 连接；broker 靠帧里的 channel 编号还原出三路独立会话。 注意 ：同一 channel 串行处理帧，所以一个 channel 只能归一个线程用。](/blog-assets/rabbitmq-smart-broker/01-diagram-01.svg)

*图 1.1 三个线程各用一个 channel，复用同一条 TCP 连接；broker 靠帧里的 channel 编号还原出三路独立会话。 注意 ：同一 channel 串行处理帧，所以一个 channel 只能归一个线程用。*

> **类比 · 带边界声明**
>
> channel 像 HTTP/2 在一条 TCP 上跑多个 stream。但 AMQP channel 没有 HTTP/2 那种独立流控：一旦 broker 因内存告警阻塞了某条连接，这条连接上**所有** channel 一起被阻塞，不是只卡住一个。这个"一损俱损"的边界在 [03 章流控](#s33)里会再出现。

**场景走查**：一个订单服务跑 8 个工作线程。启动时建立 1 条 Connection，每个线程开自己的 channel（共 8 个）。线程 A 在 channel 1 上 publish，线程 B 在 channel 2 上 consume，互不干扰。若图省事让两个线程共享 channel 1——表现为偶发的 `unexpected frame`、消息体错位，而且**低负载下不复现**，上线放量才炸。

把 100 个线程压到 1 个 channel 上收发，会出什么问题？

**展开答案（先停 10 秒再点）**

两件事同时发生：① 帧交错损坏——多个线程的帧在同一 channel 序列里穿插，broker 解析失败；② 串行瓶颈——就算不崩，channel 内帧是串行的，100 个线程也只能排队走一条道。正解是每线程一个 channel，连接可以共享。

**与下一节的关系**：channel 是协议交互的通道；真正决定消息去哪的，是 channel 上声明的 exchange 和 binding。

<a id="s12"></a>

## 1.2 Exchange / Queue / Binding

生产者把消息发给 exchange，exchange 按 binding 规则把消息路由到 0 个或多个 queue；生产者不知道、也不关心 queue 的存在。

> **为什么需要它**
>
> 若生产者直接发给队列，生产者就得知道有哪些消费者、各要什么——拓扑硬编码在生产端。exchange 把"发布"和"路由"解耦：生产者只管发给一个命名的 exchange 加一个 routing key，由 binding（运维或消费端声明）决定消息落到哪些队列。新增一个消费者，只加一条 binding，生产者代码一行不动。

**底层机制（比文档深一层）**：exchange 本身**不存储消息**——它是一张路由表加一个匹配函数。消息到达 exchange，broker 用该 exchange 类型对应的匹配算法，把消息的 routing key 与所有 binding 的 binding key 比对，命中的每个 queue 各收到一份消息引用。一个 binding 都没命中的消息被直接丢弃（或在 `mandatory` 标志下退回生产者）。所以"消息发出去了"不等于"消息进队列了"——这是新手最常栽的认知缺口。

> **类比 · 带边界声明**
>
> exchange 像邮局的分拣台，binding 是"这个邮编送这条街"的规则，queue 是街道信箱。但分拣台**不留底**：没有匹配地址的信直接销毁，不会退回——除非你寄信时贴了 `mandatory` 回执要求。

**场景走查**：声明一个 topic 类型的 exchange `orders`。队列 `order-email` 用 binding key `order.created` 绑上去；队列 `order-audit` 用 `order.#` 绑上去。生产者 publish 到 `orders`，routing key 写 `order.created`：两个队列都命中（email 精确匹配，audit 的 `#` 匹配任意层级），同一条消息进了两个队列。换成 routing key `order.shipped`：只有 audit 命中，email 收不到。

> **陷阱**
>
> "我 publish 返回成功了，broker 没报错，但队列里空的。" 根因：没有 binding 命中，消息被静默丢弃。publish 成功只表示**broker 收到了**，不表示**进了某个队列**。要确认确实入队，靠 publisher confirms（[02 章](#s21)）加 `mandatory` 标志，缺一个都看不见这次丢弃。

**与下一节的关系**：命不命中，取决于 exchange 的类型——四种类型，四套匹配规则。

<a id="s13"></a>

## 1.3 四种 exchange 类型

direct、fanout、topic、headers——区别只在一件事：拿什么和 binding key 比，怎么比。

表 1.1 · 四种 exchange 的路由规则

| 类型 | 匹配规则 | 典型用途 |
| --- | --- | --- |
| direct | routing key 与 binding key **完全相等**才路由 | 按确定的 key 点对点分发，如按任务类型分队列 |
| fanout | 忽略 routing key，**广播**给所有绑定的队列 | 发布/订阅、广播配置变更 |
| topic | routing key 与 binding key 做**模式匹配**：`*` 匹配一个单词，`#` 匹配零或多个单词（以 `.` 分隔） | 按层级主题订阅，如 `service.level` 日志 |
| headers | 忽略 routing key，改用消息 **headers 属性**匹配，`x-match=all/any` | 多维度条件匹配，routing key 表达不了时 |

**底层机制（比文档深一层）**：direct 和 fanout 本质是 topic 的两个特例——direct 等于"无通配的精确匹配"，fanout 等于"全部匹配"。headers 走的是另一条匹配路径，根本不碰 routing key，而是遍历消息头字典。性能排序也由此而来：direct/fanout 最快，topic 的通配匹配略贵，headers 最灵活但最慢。选型时，能用 direct/topic 表达的，就别用 headers。

![图 1.2 routing key 为 payment.error 的一条消息，被 topic exchange 按 binding key 同时投进 alerts 和 payment-log 。 注意 ： order.# 不匹配， order-flow 一份都收不到——一条消息可命中多个队列，也可能一个都不命中。](/blog-assets/rabbitmq-smart-broker/01-diagram-02.svg)

*图 1.2 routing key 为 payment.error 的一条消息，被 topic exchange 按 binding key 同时投进 alerts 和 payment-log 。 注意 ： order.# 不匹配， order-flow 一份都收不到——一条消息可命中多个队列，也可能一个都不命中。*

**场景走查（topic 通配）**：日志系统的 routing key 形如 `<service>.<level>`，例如 `auth.error`、`payment.info`。队列 `all-errors` 绑 `*.error`，`payment-all` 绑 `payment.*`，`everything` 绑 `#`。一条 `payment.error` 同时命中三者。

topic binding key `*.error` 能匹配 routing key `auth.login.error` 吗？

**展开答案（先停 10 秒再点）**

不能。`*` 只匹配**一个**单词，而 `auth.login.error` 是三个单词。要匹配任意前缀加 `.error` 结尾，得用 `#.error`（`#` 匹配零或多个单词）。这一个字符的差别，是 topic 路由最常见的失误来源。

<a id="s14"></a>

## 1.4 消息生命周期：ack 之后即删除

一条消息的命运：被路由进队列（Ready）→ 推送给消费者（Unacked）→ 消费者 ack → broker 永久删除。没有 offset，没有"再读一遍"。

**为什么这是全教程的轴心**：RabbitMQ 的队列是"消费即销毁"的。消息被 ack 后，broker 删除它，不留任何记录。这意味着 RabbitMQ **没有 offset、没有重放、没有从头再读一遍**。这正是它与 Kafka 的根本分叉：Kafka 是不可变日志，消息留存、消费者用 offset 自己记进度，可以倒回去重读；RabbitMQ 是"智能 broker"——它替消费者记账（谁 ack 了、谁还欠着），记完账就把消息扔了。抓住这一点，后面所有特性都是推论。

**底层机制（比文档深一层）**：消息在队列里有两个关键状态——**Ready**（已入队、待投递）和 **Unacked**（已推送给某消费者、等它 ack）。broker 为每一次投递分配一个 **delivery tag**（投递编号），挂在消费它的那个 channel 上。消费者 `basic.ack(tag)` → broker 删除消息；`basic.nack`/`basic.reject` → 按参数 requeue 或转入 dead-letter；消费者的 channel/连接**断开** → 它名下所有 Unacked 消息自动 requeue 回队列（通常回到头部，这会破坏顺序，[04 章](#s43)详谈）。

![图 1.3 消息在 RabbitMQ 里走到 ack 就被删除；nack 或消费者断连会把它 requeue 回队列。 注意 ：右下角是 Kafka 的对照——同一时刻 Kafka 不删消息，只把消费者的 offset 往前挪，所以它能重放，RabbitMQ 不能。](/blog-assets/rabbitmq-smart-broker/01-diagram-03.svg)

*图 1.3 消息在 RabbitMQ 里走到 ack 就被删除；nack 或消费者断连会把它 requeue 回队列。 注意 ：右下角是 Kafka 的对照——同一时刻 Kafka 不删消息，只把消费者的 offset 往前挪，所以它能重放，RabbitMQ 不能。*

消费者拿到消息、处理到一半进程崩了（没来得及 ack），这条消息会怎样？

**展开答案（先停 10 秒再点）**

broker 检测到该消费者的 channel/连接断开，把它名下所有 Unacked 消息 requeue，另一个消费者会重新拿到这条。后果是**消费可能重复**——所以消费逻辑必须幂等。代价的另一面：如果用了 auto-ack（消息一推送就当已确认），崩溃时这条消息已被删除，直接丢失、毫无痕迹。auto-ack 的取舍在 [02 章](#s22)。

> **洞察 · 对标 Kafka**
>
> 一句话记住两者的分叉：**RabbitMQ 的 broker 替你记账并在 ack 后删除消息；Kafka 的 broker 只追加日志，消费者自己记 offset。**前者给你灵活路由和每消息确认，代价是没有重放；后者给你重放和高吞吐，代价是路由和每消息工作流得自己在消费端实现。这句话会在 04 章被反复用到。

<a id="s15"></a>

## 1.5 vhost 与三种队列类型

vhost 是命名空间隔离；queue 有三种实现——classic（单节点）、quorum（Raft 多副本，4.x 默认）、stream（可重放的追加日志）。

> **为什么需要 vhost**
>
> 一个 broker 集群常被多个应用或团队共用。vhost 把 exchange、queue、权限隔成互不可见的命名空间——`/prod` 和 `/staging` 各有自己的 `orders` exchange，同名也互不干扰。客户端连接时指定要进哪个 vhost。它是隔离边界，不是性能边界。

队列类型这里只给地图，机制留到 [03 章](#s34)展开：

表 1.2 · 三种队列类型概览

| 类型 | 一句话 | 什么时候用 |
| --- | --- | --- |
| classic | 消息存在单个节点，无副本；节点挂了队列不可用 | 非关键、可容忍丢失的临时队列 |
| quorum | 基于 Raft 的多副本队列，写入要多数派确认；**4.x 默认** | 需要可靠性、不丢消息的绝大多数场景 |
| stream | 追加型不可变日志，消费非破坏性（按 offset 读，不删除） | 要重放、要多个独立消费者读同一份数据 |

> **陷阱 · 过时材料**
>
> 网上大量老教程教你用 **classic mirrored queues（镜像队列）**做高可用，配置里有 `ha-mode`、`ha-policy`、`x-ha-policy`。RabbitMQ 4.0（2024）已经**彻底移除**镜像队列。现在做副本/高可用用 **quorum 队列**。看到 `ha-mode` 这类配置，基本能判定那是 3.x 时代、已经不能照搬的内容。这条分界在 [03 章](#s35)讲清楚为什么。

## § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 生产者 publish 一条消息时，需要指定**队列名**吗？为什么？它指定的是什么？
2. 一条 routing key 没有任何 binding 匹配的消息，默认下场是什么？怎么让这次丢弃变得"看得见"？
3. 消费者 ack 一条消息后，broker 对这条消息做了什么？这和 Kafka 消费者提交 offset 有什么本质不同？
4. 为什么同一个 channel 不能被多个线程共享？根因在协议的哪一层？

**答案（先做完再展开）**

1. 不需要队列名。它指定的是 **exchange 名 + routing key**。消息进哪些队列，由 binding 决定，生产者完全不感知队列的存在——这正是"发布/路由解耦"。
2. 默认被**静默丢弃**。要让它看得见：publish 时带 `mandatory` 标志（无法路由就退回生产者），并开启 publisher confirms 接收 broker 的 `basic.return`。
3. broker **永久删除**这条消息，不留记录。Kafka 提交 offset 只是移动消费者的读指针，消息仍留在日志里，可被任何消费者按 offset 重读。RabbitMQ 没有这个能力（除非用 stream 队列）。
4. 因为 AMQP 给每帧打 channel 编号、同一 channel 的帧严格有序串行处理。两个线程并发写同一 channel 会让帧交错，broker 解析出错。根因在**帧层**（03 章）。

**进阶挑战 · 刚好够不着**

### 用两条 binding 实现一组路由

一个 topic exchange 接收 `<service>.<level>` 形式的日志。要求：(a) 所有 `error` 级日志（任意 service）进 `alerts` 队列；(b) 来自 `payment` 服务的所有级别日志进 `payment-log` 队列；(c) 一条 `payment.error` 必须**同时**进这两个队列。写出 `alerts` 和 `payment-log` 各自的 binding key。

**提示（卡住再展开）**

`alerts` 用 `*.error`（任意 service 的 error 级）；`payment-log` 用 `payment.*`（payment 的任意级别）。`payment.error` 同时满足两者，所以两个队列都收到——验证了"一条消息命中多个 binding"。想想：如果日志 key 可能是三段 `payment.api.error`，`*.error` 还够用吗？

### 本章参考

- [AMQP 0-9-1 Model Explained](https://www.rabbitmq.com/tutorials/amqp-concepts)（官方）
- [Queues](https://www.rabbitmq.com/docs/queues)（官方文档）
- [Channels](https://www.rabbitmq.com/docs/channels)（官方文档）
- [RabbitMQ Tutorials（六个入门范例）](https://www.rabbitmq.com/tutorials)（官方）

---

<a id="chapter-02"></a>

## 可靠投递：让消息的托管链不断裂

> 上一章建立了消息从 producer 经 exchange/binding 到 queue、并在 ack 后被删除的路径——这一章把这条托管链的每个接缝补上，让消息不丢。

### 本章你将建立的 schema

- 发送端的接缝：publisher confirms 用 delivery tag 异步回执，确认"消息已被 broker 托管"
- 消费端的两个接缝：手动 ack 确认"已处理可删除"，prefetch 控制"一次推多少"防止撑爆
- 持久化的三个独立开关：durable（实体）≠ persistent（消息）≠ 真正安全（quorum 多副本）
- 失败兜底：dead-letter exchange、TTL 过期、delivery-limit 重试上限，把毒消息引开而非丢弃

<a id="s21"></a>

## 2.1 发送端不丢：publisher confirms

publisher confirms 让 broker 在消息被处理后回一个确认，生产者据此知道这条消息已被托管，不是发进了黑洞。

> **为什么需要它**
>
> 裸的 `basic.publish` 是单向的——TCP write 返回成功只说明字节进了内核缓冲，不说明 broker 收到、更不说明它路由进了队列或写了盘。上一章 [1.2](#s12) 已经埋了这个缺口：没有 binding 命中的消息被静默丢弃，生产者一无所知。publisher confirms 把这条单行道改成有回执：broker 处理完一条消息，回送一个带 delivery tag 的 `basic.ack`，生产者凭它对账。

**底层机制（比文档深一层）**：confirm 是**异步**且**按 delivery tag 累进**的。生产者在 channel 上开启 confirm 模式后，broker 给这条 channel 上发出的每条消息按发布顺序编号（从 1 递增的 delivery tag）。生产者不必发一条等一条——它持续 publish，broker 在消息"处理完成"时回 `basic.ack`，且可以**批量确认**：一个 `basic.ack` 带 `multiple=true` 表示"到这个 tag 为止全部确认"。所谓"处理完成"对持久化消息意味着"已写入"（写入的真实强度见 [2.3](#s23)，那里有一个关键的 fsync 缺口）；路由失败的消息走 `basic.nack`。生产者侧需维护一个"已发出未确认"的窗口，收到 ack 后从窗口移除，超时或 nack 则重发。

> **对标 · 旧的事务机制**
>
> AMQP 还有一套老的事务机制 `tx`（`tx.select`/`tx.commit`），同步阻塞：每次提交都要等 broker 完整落地再返回。官方实测它比 publisher confirms **慢约 250 倍**。结论很硬：发送端可靠性用 confirms，不要用 tx。看到代码里还在 `txSelect()`，基本是十年前的写法。

**场景走查**：一个支付回调服务每秒 publish 几千条结算消息。开启 confirm 模式后，它把每条消息的 delivery tag 和业务 ID 存进一个本地未决表，继续不停 publish。broker 陆续回 `basic.ack(tag=4200, multiple=true)`，服务一次性把 tag ≤ 4200 的记录从未决表清掉。某条消息的 routing key 拼错、无队列可达，broker 回 `basic.nack(tag=4201)`，服务据此告警并把这条转人工补偿——这条本来会被静默吞掉，现在看得见了。

**publisher_confirms.py**

```python
channel.confirm_delivery()  # 开启 confirm 模式

def on_confirm(tag, multiple, nacked):
    # multiple=True 表示 tag 及之前的都确认；nacked=True 表示这是 nack
    if nacked:
        resend(pending.pop_le(tag))   # broker 拒收，重发
    else:
        pending.discard_le(tag)       # 已托管，从未决窗口移除

channel.add_on_confirm_callback(on_confirm)

for msg in stream:                    # 持续发布，不逐条阻塞等待
    channel.basic_publish("orders", msg.key, msg.body,
                          mandatory=True)   # 无队列可达就退回，不静默丢
    pending.add(channel.next_delivery_tag, msg)
```

上面的 `mandatory=True` 是 confirms 的搭档：confirms 回答"broker 收下了吗"，`mandatory` 回答"收下后有队列接吗"——无队列可路由时 broker 通过 `basic.return` 把消息退回生产者，而不是默默丢弃。两者合起来才覆盖 [1.2](#s12) 里那个"publish 成功 ≠ 进了队列"的缺口。

![图 2.1 托管链上的两段确认：左半段 confirm 关闭"发出去是否被 broker 收下"的缺口，右半段 ack 关闭"处理完是否可以删除"的缺口。 注意 ：两段方向相反、互不替代——只开 confirm 不开手动 ack，消费端崩溃照样丢；反之亦然。](/blog-assets/rabbitmq-smart-broker/02-diagram-01.svg)

*图 2.1 托管链上的两段确认：左半段 confirm 关闭"发出去是否被 broker 收下"的缺口，右半段 ack 关闭"处理完是否可以删除"的缺口。 注意 ：两段方向相反、互不替代——只开 confirm 不开手动 ack，消费端崩溃照样丢；反之亦然。*

生产者收到了 broker 的 `basic.ack` confirm，能不能就此断定"这条消息一定不会丢了"？

**展开答案（先停 10 秒再点）**

不能，要看队列类型。confirm 只保证 broker 已按它对这条消息的承诺处理完。对 classic 队列，承诺仅是"写进了内存写缓冲并已下发写盘指令"，并未 fsync——broker 此刻崩溃，这条已 confirm 的持久化消息仍可能丢（缺口见 [2.3](#s23)）。只有 quorum 队列在回 confirm 前已提交到多数派副本，才给出多数工程师以为自己早就有的那种保证。confirm 是**对账工具**，不是**持久化级别**本身。

**与下一节的关系**：confirm 守住了消息进 broker 这一段。消息推给消费者之后，能不能不丢、会不会把消费者撑爆，是另外两个接缝。

<a id="s22"></a>

## 2.2 消费端不丢、不撑爆：consumer ack 与 prefetch

手动 ack 让 broker 在消费者真正处理完后才删除消息；prefetch 限定一次最多推几条未确认消息，防止单个消费者吞掉整条队列。

> **为什么需要它**
>
> 两个独立的风险。其一，自动 ack（automatic ack，俗称 ack-on-send）让 broker 在**推送瞬间**就删消息——消费者处理到一半崩溃，这条已经没了，连 requeue 的机会都没有。手动 ack 把删除推迟到"业务处理完成"那一刻。其二，broker 默认会尽量多推未确认消息给消费者，一个慢消费者会把整条队列的消息全拉进自己内存，撑爆自己（OOM），同时让别的消费者空闲——prefetch（通过 `basic.qos` 设置）给"未确认消息数"设了上限。

**底层机制（比文档深一层）**：prefetch 限的是一条 channel/consumer 上 **Unacked 状态**（见 [1.4](#s14)）的消息条数上限。broker 推一条，Unacked 计数 +1；消费者 ack 一条，计数 −1，broker 才补推下一条。所以 prefetch 和 ack 是**同一个反馈环**的两端：忘了 ack，Unacked 计数只增不减，撞到 prefetch 上限后 broker 停止投递——消费者就此"挂起"，但它其实没死，只是再也拿不到新消息。`basic.nack` 是 RabbitMQ 的扩展，支持 `multiple`（一次否定到某 tag 为止）和 `requeue`（退回还是丢弃）；`basic.reject` 功能相同但只能一次一条。注意 4.x 里**全局 QoS（global prefetch）已弃用**，prefetch 应按 per-consumer 设置。

prefetch 取值有量纲化的经验法则：`prefetch ≈ 往返时延 / 单条处理时间`。极端值 `prefetch=1`（入门教程"公平分发"的默认）把吞吐锁死在"每个网络往返才处理一条"——若 RTT 为 125ms，上限约 8 条/秒。实战起步给 10–50，消费者慢、消费者多时调小。

表 2.1 · 两种 ack 模式 × prefetch 取值的后果

| 设置 | 机制 | 后果 |
| --- | --- | --- |
| 自动 ack | 推送瞬间即删除 | 吞吐最高，**消费者崩溃即丢消息**，无痕迹 |
| 手动 ack + prefetch 适中 | 处理完才删除，未确认数受限 | 不丢、负载均衡、内存可控——生产默认 |
| 手动 ack + prefetch=1 | 处理完才删除，一次只推一条 | 绝对公平，**吞吐被往返时延锁死** |
| 手动 ack + 无限 prefetch | 处理完才删除，但不限未确认数 | 一个消费者吞光队列 → OOM，其余空闲 |

**场景走查**：四个消费者从一条订单队列取货，单条处理约 50ms，RTT 约 10ms。按经验法则 `10/50` 远小于 1，prefetch 给个位数即可，取 `prefetch=5`：每个消费者手里最多压 5 条未确认，broker 在它 ack 后即时补推，四个消费者负载基本均摊。若误设无限 prefetch，启动瞬间最快的那个消费者把上万条全拉进内存，自己 OOM 重启，重启后名下 Unacked 全部 requeue，又一次涌入下一个消费者——形成"击鼓传 OOM"。

**consumer_ack.py**

```python
channel.basic_qos(prefetch_count=5)   # per-consumer，最多 5 条 Unacked

def handle(ch, method, props, body):
    try:
        process(body)                              # 业务处理
        ch.basic_ack(method.delivery_tag)          # 处理完才确认 → broker 删除
    except TransientError:
        ch.basic_nack(method.delivery_tag, requeue=True)    # 可重试：退回队列
    except PoisonError:
        ch.basic_nack(method.delivery_tag, requeue=False)   # 必失败：走 DLX（见 2.4）

channel.basic_consume("orders", handle, auto_ack=False)   # 关键：不要自动 ack
```

> **陷阱 · 自动 ack 丢消息**
>
> 症状：消费者偶发"消息凭空消失"，日志里没有任何异常。根因：用了 `auto_ack=True`，broker 在推送的那一刻就删了消息，消费者处理途中崩溃（或被 OOM kill、被部署重启），这条永久丢失、零痕迹。修复：`auto_ack=False` + 处理成功后再 `basic_ack`；只有"丢了也无所谓"的指标流才考虑自动 ack。

> **陷阱 · 忘了 ack 导致假死**
>
> 症状：消费者进程活着、CPU 也不高，却不再消费新消息，队列 Unacked 数顶在某个值不动。根因：业务分支里漏了 `basic_ack`，Unacked 计数只增不减，撞到 prefetch 上限后 broker 停止投递。看着像"卡死"，实则是反馈环被卡住。修复：确保每条消息在所有分支上都恰好 ack/nack 一次。management UI 里"Unacked 持续不降"是这个故障的指纹。

一个消费者设了 `prefetch=1`，处理每条消息要 100ms，网络 RTT 约 100ms。它的吞吐上限大约是多少？怎么提高？

**展开答案（先停 10 秒再点）**

约 **5 条/秒**。`prefetch=1` 时一条消息的完整周期是"推送(100ms) + 处理(100ms) + ack 回程(100ms)"≈ 200ms 串行往返（推送与 ack 各占半个 RTT），broker 必须等 ack 才推下一条，吞吐被锁在往返节奏上。提高办法：把 prefetch 调到 `RTT/处理时间` 量级或更高（这里 ≥ 2 就能让处理与网络往返重叠流水线化），让 broker 提前把后续消息推到消费者手里，处理和网络传输并行起来。

**与下一节的关系**：confirm 和 ack 守的是"在线消息不丢"。但 broker 一旦重启或崩溃，内存里的队列和消息还在不在，是另一套机制——而且这里藏着本章最大的认知陷阱。

<a id="s23"></a>

## 2.3 重启与崩溃不丢：durable ≠ persistent ≠ safe

durable 是队列定义能否扛重启，persistent 是单条消息要不要落盘，两者都满足也未必扛得住崩溃——那要 quorum。

> **为什么需要它**
>
> "重启不丢"被工程师普遍误解为一个开关，实则是三个相互独立的属性，常被混为一谈。durable 是**实体属性**：队列/exchange 的*定义*是否在 broker 重启后还存在。persistent（`delivery_mode=2`）是**消息属性**：这一条消息是否被标记为要写盘。两者正交——durable 队列里的 transient 消息，重启后队列还在但消息没了；non-durable 队列里的 persistent 消息，重启后队列连同消息一起蒸发。要让一条消息扛过重启，**队列 durable 和消息 persistent 必须同时满足**，缺一不可。

**底层机制（比文档深一层）——本章最重要的一点**：满足了 durable + persistent，仍有一个被多数教程跳过的缺口。**classic 队列在回送 publisher confirm 之前，并不保证已经 fsync 到磁盘**。持久化消息先进的是操作系统的写缓冲，broker 随即回 confirm，真正刷盘是稍后批量进行的（通常有一个 ≤200ms 的窗口）。如果 broker 正好在这个窗口内崩溃（断电、内核 panic、被 OOM kill），这条"durable + persistent + 已 confirm"的消息**照样会丢**——它从来没真正落到盘上。这就是为什么 quorum 队列存在：quorum 队列基于 Raft，写入要**提交到多数派副本之后才回 confirm**，单机崩溃由其余副本兜底，给出 durable+persistent 让人误以为自己早已拥有的那种持久性。Raft 的细节留到 [03 章 3.4](#s34)，这里只需记住缺口和补法。

表 2.2 · 三个独立属性，挡住三种不同的失败

| 属性 | 作用对象 | 挡住的失败 | 挡不住的 |
| --- | --- | --- | --- |
| durable | 队列/exchange 定义 | broker 重启后队列定义还在 | 消息本身（若消息非 persistent） |
| persistent | 单条消息 | 消息被标记写盘，配合 durable 扛重启 | fsync 前的崩溃窗口（classic） |
| quorum 队列 | 整条队列 + 多副本 | 单节点崩溃 / 宕机：多数派已落地 | 多数派同时全灭（极端情形） |

![图 2.2 三层防护逐层加深：durable 挡 broker 重启、persistent 让消息真正落盘、quorum 多副本挡单机崩溃。 注意 ：底部虚线层是 classic 队列特有的崩溃窗口——confirm 已回但尚未 fsync，此刻崩溃仍丢；quorum 用"多数派落地后才 confirm"关掉这个窗口。](/blog-assets/rabbitmq-smart-broker/02-diagram-02.svg)

*图 2.2 三层防护逐层加深：durable 挡 broker 重启、persistent 让消息真正落盘、quorum 多副本挡单机崩溃。 注意 ：底部虚线层是 classic 队列特有的崩溃窗口——confirm 已回但尚未 fsync，此刻崩溃仍丢；quorum 用"多数派落地后才 confirm"关掉这个窗口。*

**场景走查**：一个对账系统把队列声明为 durable、消息设 `delivery_mode=2`、开了 publisher confirms，自认为"零丢失"。压测中给 broker 断电，复盘发现丢了最后约 80ms 的已 confirm 消息。根因不是配置错，而是 classic 队列的 fsync 窗口：那 80ms 的消息回了 confirm 但还在 OS 写缓冲里，断电时一起没了。把队列换成 quorum 队列后重测，同样断电零丢失——因为每条消息在回 confirm 前已写入多数派节点。

> **陷阱 · durable 与 persistent 混为一谈**
>
> 症状：队列声明了 durable，重启后队列还在但消息全空。根因：只设了队列 durable，没给消息设 `delivery_mode=2`，消息是 transient 的，重启时随内存蒸发。反之，给消息设了 persistent 却把队列建成 non-durable，重启后队列定义都没了，消息更无处安放。两个开关是**正交**的，必须同时打开，且这只防"重启"不防"崩溃窗口"。

一条消息设了 `delivery_mode=2`（persistent），但发往一个 non-durable 的 classic 队列。broker 正常重启后，这条消息还在吗？

**展开答案（先停 10 秒再点）**

不在。non-durable 队列的*定义*本身重启就消失了，承载它的队列都没了，消息标没标 persistent 已无意义——persistent 只决定"消息要不要写盘"，不决定"队列要不要保留"。这正是两个属性正交的体现：要扛重启，**队列 durable 和消息 persistent 缺一不可**；要再扛崩溃窗口，还得上 quorum。

**与下一节的关系**：消息存住了，但如果某条消息本身有毒——每次处理都失败——nack 重回队列会变成无限循环。把毒消息引开，是下一个接缝。

<a id="s24"></a>

## 2.4 毒消息不死循环：dead-letter、TTL、重试上限

dead-letter exchange 把被拒绝、过期或超限的消息引到另一个 exchange，而不是丢弃或无限重投；delivery-limit 给重试次数封顶。

> **为什么需要它**
>
> 手动 ack 解决了"处理失败的消息别删"，但若用 `nack(requeue=true)` 把一条**永远会失败**的消息退回队列，它会被立刻重新投递、再次失败、再次退回——一个无限重投循环，把 CPU 打满，还卡在队头阻塞后面所有正常消息（head-of-line blocking）。需要一个出口：让"反复失败的"和"过期的"和"积压超量的"消息离开主队列，进到一个专门的地方，等人工或自动重试逻辑处理。这个出口就是 dead-letter exchange（DLX，死信交换机）。

**底层机制（比文档深一层）**：一个队列可以声明 `x-dead-letter-exchange` 指向一个 DLX。三类事件会让消息被**死信化**（dead-lettered）而非留在原队列：① 被 `nack`/`reject` 且 `requeue=false`；② TTL 到期（`x-message-ttl` 设在队列上、或单条消息设 `expiration`）；③ 超过队列长度上限 `x-max-length` 被挤出。被死信化的消息按原 routing key（或 DLX 配置的覆盖 key）路由进 DLX 绑定的队列。每死信一次，broker 在消息的 `x-death` 头里累加一条记录（次数、原因、时间、来源队列）——这是排查"这条消息怎么进的死信队列"的取证依据。quorum 队列还有一个内建的 `delivery-limit`：4.0 起**默认值为 20**，一条消息被重投 20 次后自动死信化，从机制上掐断毒消息的无限循环，无需手工拼 DLX 计数逻辑。

![图 2.3 死信流：主队列里被拒绝、TTL 过期、超长或超重试的消息被引到 DLX，再按可恢复与否分流到重试队列或终态死信队列。 注意 ：重试队列经延迟退避后把消息送回主队列，每轮在 x-death 头累加计数，配合 delivery-limit 才不会变成换皮的无限循环。](/blog-assets/rabbitmq-smart-broker/02-diagram-03.svg)

*图 2.3 死信流：主队列里被拒绝、TTL 过期、超长或超重试的消息被引到 DLX，再按可恢复与否分流到重试队列或终态死信队列。 注意 ：重试队列经延迟退避后把消息送回主队列，每轮在 x-death 头累加计数，配合 delivery-limit 才不会变成换皮的无限循环。*

**场景走查**：订单队列消费时，某条消息因下游一个字段 schema 不兼容而每次反序列化都抛异常。消费者对它 `nack(requeue=false)`，消息进 DLX。DLX 绑了两条路径：可重试错误（如下游瞬时 503）进"重试队列"，该队列设 30s TTL，过期后再死信回主队列重试，`x-death` 计数每轮 +1；不可重试错误（如这次的 schema 不兼容）直接进"死信队列"等人工。即便误把它当可重试，quorum 队列的 `delivery-limit=20` 也会在第 20 次后强制把它打入终态，不会无限打转。

**declare_dlx.json**

```json
{
  "queue": "orders",
  "arguments": {
    "x-queue-type": "quorum",
    "x-dead-letter-exchange": "orders.dlx",
    "x-message-ttl": 600000,
    "x-max-length": 100000,
    "x-delivery-limit": 20
  }
}
```

> **陷阱 · requeue 无限循环**
>
> 症状：一条消息在队列里反复出现、CPU 持续打满，后面正常消息迟迟得不到处理。根因：对一条必然失败的消息用了 `nack(requeue=true)`，它立刻回到队列被重投、再失败，形成死循环，还在队头阻塞后续消息。修复：失败时改用 `requeue=false` 送 DLX，并给 quorum 队列保留默认 `delivery-limit`（或在 classic 上用 DLX + 重试队列计数）封顶重试次数。

给主队列设了 DLX，但消费者一直用 `nack(requeue=true)` 重投失败消息。这条毒消息会进 DLX 吗？

**展开答案（先停 10 秒再点）**

不会——除非命中别的死信条件。死信化只在 `requeue=false`、TTL 过期、超长或（quorum）超过 delivery-limit 时触发。`requeue=true` 表示"放回去再试"，根本没把消息交给 DLX，它会原地无限重投。DLX 配了不等于自动生效，**得让消息真正满足某个死信条件**。在 quorum 队列上，即使消费者执意 `requeue=true`，`delivery-limit=20` 仍会兜底把它死信化。

**与下一节的关系**：前四节都在补"消息不丢"的接缝。但可靠性本身有反作用力——队列无限堆积会触发 broker 的自我保护，反而把整个集群的发送端按下暂停键。

<a id="s25"></a>

## 2.5 可靠性的反作用力：内存/磁盘告警与背压

为了不让自己被撑爆，broker 在内存或磁盘逼近水位线时会阻塞所有生产者——看起来像 publish 卡住，其实是设计中的背压。

> **为什么需要它**
>
> 把消息可靠地存住，前提是 broker 自己不被存爆。一条没人消费的队列会一直堆，内存与磁盘是有限的。broker 设了告警水位（resource alarm）：内存用量逼近高水位（默认约总内存的 **60%**）或磁盘剩余跌破阈值时，broker 主动**阻塞所有发布连接**——这是自保的背压，不是故障。消费者照常消费，队列被排空、资源回落到水位线下后，发布自动解除阻塞。可靠性和吞吐在这里短兵相接：与其 OOM 崩掉丢光所有消息，不如先把入口关上。

**底层机制（比文档深一层）**：触发内存告警时，broker 在**连接层**停止从所有发布连接读取数据——TCP 接收窗口不再推进，生产者的 `basic.publish` 因此阻塞（或在异步客户端里收到 channel 的 blocked 通知）。这里有一个和 [1.1](#s11) 呼应的细节：阻塞作用在**连接**层级，所以一条连接上的*所有* channel 一起被卡，不是只卡发往满队列的那一个；而且告警是**集群级**的——任一节点触发，整个集群的发布全停。消费连接不受影响，继续放水。这造成一个极具迷惑性的现象：发送端集体"卡住"，消费端却一切正常。

队列实现也影响堆积时的内存行为：经典的 lazy 模式（消息尽量留在磁盘、不常驻内存）和 quorum 队列在大积压下对内存更友好，能延后撞上水位线的时刻；但它们只是**推迟**而非取消告警——根治还得给队列设上界。

> **陷阱 · 无界队列触发全集群发布阻塞**
>
> 症状：所有生产者的 publish 同时"卡住"或超时，而消费端日志显示一切正常——极易误判成网络或生产者代码问题。根因：某条队列无人消费、无上界，一路堆到 broker 内存高水位（约 60%），触发集群级资源告警，broker 阻塞了**所有**发布连接。修复：给队列设 `x-max-length` 或 `x-message-ttl` 封顶并配 DLX 泄流，用 quorum 或 lazy 行为压低堆积时的内存占用，并监控内存水位告警。把"publish 卡住"的第一反应从"查网络"改成"查队列堆积与资源告警"。

**场景走查**：一次发布上线把某个消费者服务的镜像配错，消费者全挂，但生产者还在全速 publish。一条队列在十几分钟内堆到几百万条，broker 内存撞上 60% 高水位，触发告警，集群所有发布连接被阻塞。值班同学看到"所有服务 publish 超时"，先怀疑网络和 broker 宕机，排查许久才在 management UI 看到内存告警和那条暴涨的队列。修复消费者镜像、队列被消费排空后，内存回落，发布阻塞自动解除。事后给该队列补了 `x-max-length` 和 DLX——再发生时超量消息进死信而非无限堆积，不再拖垮全集群。

线上所有生产者的 publish 同时变慢甚至卡住，但消费者一切正常、网络也没问题。最先该怀疑什么？

**展开答案（先停 10 秒再点）**

broker 资源告警触发了背压。"发布端集体阻塞、消费端正常"是 RabbitMQ 内存/磁盘告警的典型指纹——broker 在连接层停止读取发布连接，且这是集群级的，所以全员 publish 卡住。去 management UI 看内存/磁盘水位和有没有暴涨的队列，而不是先查网络。根因通常是某条队列无界堆积；根治是给队列加 `x-max-length`/TTL 上界并配 DLX 泄流。

> **洞察 · 可靠性是一组权衡，不是一个开关**
>
> 本章五节连起来是一条因果链：每加一道"不丢"的保险，都要付出吞吐、延迟或资源的代价。confirm/ack 增加往返，persistent 与 quorum 增加写放大，无界堆积换来的"不丢消息"最终以"全集群发布阻塞"的形式反噬。可靠投递的工程问题从来不是"能不能不丢"，而是"为这条消息值得付多少代价、把界划在哪里"。这条权衡线会贯穿 [03 章](#s34)的内部机制和 [04 章](#chapter-04)的选型。

## § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 队列声明了 durable、消息设了 persistent、还开了 publisher confirms 并收到了 ack。在 **classic** 队列上，这条消息还可能丢吗？为什么？换成 quorum 队列结果有何不同？
2. publisher confirms 和 consumer ack 都叫"ack"，方向和语义各是什么？只开其中一个，会在链路哪一端留下丢失缺口？
3. 一个消费者进程活着、CPU 不高，却不再消费新消息，队列 Unacked 数顶住不降。最可能的根因是什么？它和 prefetch 的关系是什么？
4. （设计题）给一条核心订单队列设计一套"消息不丢 + 毒消息不死循环 + 不拖垮集群"的完整方案，列出你会设置的队列类型与关键参数，并说明每一项挡的是哪种失败。

**答案（先做完再展开）**

1. classic 队列上**仍可能丢**：它在回 confirm 前并不 fsync，消息还在 OS 写缓冲里，broker 在这 ≤200ms 窗口内崩溃就丢。confirm 只代表"broker 按它的承诺处理完"，对 classic 这个承诺不含落盘。quorum 队列在回 confirm 前已提交到多数派副本，单机崩溃由其余副本兜底，因此不丢。
2. publisher confirms 是 **broker → producer** 的回执，语义是"消息已被 broker 托管"；consumer ack 是 **consumer → broker** 的回执，语义是"已处理完，可删除"。只开 confirm 不开手动 ack，消费端崩溃丢消息；只开手动 ack 不开 confirm，发送端进 broker 失败时无感知。两段方向相反、互不替代。
3. 根因是**漏了 ack**。Unacked 计数只随投递增加、不随 ack 减少，撞到 prefetch 上限后 broker 停止投递，消费者看着像假死，实则反馈环被卡住。prefetch 限的就是 Unacked 上限，所以"忘 ack"必然以"Unacked 顶在 prefetch 值不动"的形式暴露。
4. 参考方案：队列用 **quorum**（多副本，挡单机崩溃，且自带 `delivery-limit=20` 挡无限重投）；消息设 `delivery_mode=2` persistent + 队列 durable（挡重启）；生产端开 **publisher confirms** + `mandatory`（挡发送端丢失与无路由静默丢弃）；消费端**手动 ack** + 适中 `prefetch`（挡消费端崩溃丢失与撑爆）；配 **DLX** 接收 `requeue=false`/TTL/超长的消息（挡毒消息与积压）；给队列设 `x-max-length`/`x-message-ttl` 上界（挡无界堆积触发全集群发布阻塞）。每一项对应一种具体失败，缺哪项就在哪处留缺口。

**进阶挑战 · 刚好够不着**

### 用 TTL + DLX 拼一个"延迟重试 30 秒"

RabbitMQ 没有原生的延迟队列。要求：消费失败的消息不立即重投，而是等 **30 秒**再回到主队列重新消费，且最多重试 5 次，超过就进终态死信队列。手上只有普通队列、TTL、DLX 三样积木——画出队列与 exchange 的拓扑，说明消息怎么"绕一圈"实现延迟，以及 5 次上限靠什么字段判定。

**提示（卡住再展开）**

关键技巧：让消息在一个**没有消费者的"等待队列"**里靠 TTL 自然过期，过期即死信。拓扑：主队列消费失败 → `nack(requeue=false)` 进 DLX-A → 路由到"等待队列"（设 `x-message-ttl=30000`，且它的 DLX 指回主队列对应的 exchange）→ 30s 后 TTL 到期，消息被死信回主队列重试。等待队列没有消费者，消息只能靠过期离开，"延迟"就来自这段 TTL。重试次数读消息 `x-death` 头里的累计计数，超过 5 就在消费端改判进终态死信队列（quorum 队列也可直接靠 `delivery-limit` 兜底，但那是次数上限不是延迟）。想一想：如果不同消息要不同延迟（30s/5min/1h），单条 TTL 的"队头阻塞"会带来什么问题？

### 本章参考

- [Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)（官方文档）
- [Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx)（官方文档）
- [Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)（官方文档）
- [Memory and Disk Alarms / Resource-driven Flow Control](https://www.rabbitmq.com/docs/memory)（官方文档）

---

<a id="chapter-03"></a>

## 内部机制：broker 到底怎么做到的

> 上一章给出了可靠投递的三层防护，并把"classic 队列确认后仍可能丢"指向了 quorum——这一章下探一层，拆开帧、Erlang 进程、流控与 Raft，解释这些保证从何而来。

### 本章你将建立的 schema

- AMQP 帧的字节结构：channel 多路复用为什么必须靠帧里的 2 字节编号
- 每个队列是一个 Erlang 进程：单队列的吞吐天花板，以及为什么加核救不了它
- credit 流控与内存/磁盘告警：背压如何一路传导到 TCP，告警为什么阻塞所有 publisher
- quorum 队列的 Raft 多副本，以及 Khepri 取代 Mnesia 后元数据存储的分区行为

<a id="s31"></a>

## 3.1 AMQP 0-9-1 帧：channel 多路复用的根

一条 TCP 上传输的最小单位是帧（frame）；每一帧都带 2 字节的 channel 编号，broker 靠交错这些帧、按编号还原，实现一条连接上多路 channel 并行。

> **为什么需要它**
>
> [01 章 §1.1](#s11)给出了结论：一条 TCP、多个 channel、靠编号区分，同一 channel 串行所以不能跨线程。那一层是从 API 角度看的。这一节落到字节：channel 不是一条独立的 socket，而是同一条 TCP 字节流里被打上同一编号的那些帧。理解了帧，才理解为什么 channel 既能多路复用、又强制串行——两个性质来自同一个设计。

**底层机制（比文档深一层）**：一帧 = **1 字节帧类型** + **2 字节 channel 编号** + **4 字节 payload 长度** + payload + **1 字节帧尾**。帧尾固定是 `0xCE`（十进制 206）：解析器读完声明的长度后，下一个字节必须正好是 `0xCE`，否则判定字节流错位，直接断开整条连接——这是协议自带的成帧校验。帧类型只有四种：method（类型 1，一次 RPC，如 `Basic.Publish`）、content-header（类型 2，消息属性 + body 字节数）、content-body（类型 3，消息体原始字节）、heartbeat（类型 8，心跳）。

**一次逻辑 publish 不是一帧，而是一串**：先一个 method frame（声明"这是一次 publish，发给哪个 exchange、什么 routing key"），紧接一个 content-header frame（带消息属性和总 body 大小），再接 1 个或多个 content-body frame（消息体）。消息体大于 `frame_max` 时被切成多个 body frame——`frame_max` 在 `connection.tune` 阶段由 client 与 broker 协商，默认约 131 KB。

![图 3.1 一次 publish 被拆成 method + content-header + 至少一个 content-body 帧，依次铺在同一 channel 上。 注意 ：三类帧共享同一个 channel 编号，broker 据此把它们重组为一条消息；任何一帧被另一线程的帧插进来，重组就错位。](/blog-assets/rabbitmq-smart-broker/03-diagram-01.svg)

*图 3.1 一次 publish 被拆成 method + content-header + 至少一个 content-body 帧，依次铺在同一 channel 上。 注意 ：三类帧共享同一个 channel 编号，broker 据此把它们重组为一条消息；任何一帧被另一线程的帧插进来，重组就错位。*

**channel 多路复用的实现，就是给每帧打编号再交错**：channel 1 的 method 帧、channel 2 的 body 帧、channel 1 的 header 帧，可以在同一条 TCP 上首尾相接地传，broker 读到每帧前缀的编号，把它投递给对应的会话状态机。这正是应用**避免"每个任务开一条 TCP 连接"**的原因——几百个并发任务复用一条 TCP 上的几百个 channel，握手、文件描述符、内核缓冲都省下来。

**代价直接来自交错**：同一 channel 上的帧严格按到达顺序处理——一个 channel 是串行的。所以一个 channel 不能被多个线程共享：线程 A 刚写完 method 帧、还没写 header 帧，线程 B 插进来写自己的 body 帧，编号一样、序列被打乱，broker 重组时把 B 的 body 当成 A 的消息体，或读到错误的帧尾直接断连。这把 [01 章 §1.1](#s11)"channel 不能跨线程"的结论落到了字节层面的因果。

发一条 200 KB 的消息（frame\_max 默认约 131 KB），这条消息在 TCP 上由几个帧组成？

**展开答案（先停 10 秒再点）**

至少四个：1 个 method frame + 1 个 content-header frame + 2 个 content-body frame（200 KB 超过单帧上限，body 被切成两段）。注意 method 和 header 各自独立成帧、不受 frame\_max 影响——被切分的只有消息体。若把 frame\_max 调大到 256 KB，body 就只需 1 帧，但单帧内存占用随之上升，这是吞吐与内存的权衡。

> **洞察 · 成帧校验**
>
> 帧尾那 1 个字节（`0xCE`）看似冗余，作用是**廉价的损坏检测**：长度字段说 payload 有 N 字节，解析器跳过 N 字节后必须撞上 `0xCE`；撞不上，说明长度被写错或字节流被污染，broker 不试图恢复，直接杀连接。AMQP 把"宁可断连也不处理半个坏帧"做成了协议级别的约束——这也是为什么 channel 上的协议错误往往表现为整条连接掉线，而不是单个 channel 报错。

<a id="s32"></a>

## 3.2 每队列一个 Erlang 进程：单队列的吞吐天花板

RabbitMQ 用 Erlang 写成，每个队列、每个 connection、每个 channel 都是一个独立的 Erlang 进程；一个队列的全部工作串行穿过它那一个进程邮箱，被钉在大约一个 scheduler/核上——单队列因此有一个换大机器也抬不动的吞吐上限。

> **为什么是 Erlang**
>
> RabbitMQ 跑在 BEAM（Erlang 虚拟机）上。BEAM 的进程不是操作系统线程，而是极轻量的用户态进程：创建一个只要微秒级、几百字节内存，一台机器可以同时跑几百万个。配上 supervision tree（监督树），一个进程崩溃只重启它自己，不波及 broker 整体。把"每个队列、每个连接、每个 channel 都做成一个进程"在别的语言里是奢侈，在 BEAM 上是惯用法——隔离性和容错就是这么来的。

**底层机制（比文档深一层）**：一个队列就是**一个 gen\_server 风格的 Erlang 进程**（classic 队列是 `rabbit_amqqueue_process`，quorum 队列是 `rabbit_fifo` 状态机 + Ra 进程）。进程之间不共享内存，只靠消息传递：publish、ack、consumer 注册，全部变成发给该队列进程邮箱（mailbox）的 Erlang 消息，进程从邮箱里**一次取一条、顺序处理**。BEAM 的 scheduler 通常每个 CPU 核一个，一个进程在某一时刻只能跑在一个 scheduler 上——于是**一个队列的全部吞吐被一个进程、约一个核所限定**。

**这是 RabbitMQ 最具决定性的性能事实**：单个队列的处理能力，被单进程、单核的串行邮箱框死。一条队列打满了一个核，换一台核更多、主频更高的机器——那一条队列**快不了多少**，因为瓶颈不是机器总算力，是单进程串行。扩展的唯一方向是**更多队列 / 分片**：把负载摊到多个队列进程上，让它们各占一个核并行跑（如 consistent-hash exchange 把消息按 key 散列到 N 个队列，或用 sharding 插件）。绝不是"加一台更大的机器"。

![图 3.2 四个队列进程分散在四个核上，但高流量全打到队列 H：它的单进程把核 1 打满，核 2/3/4 闲着也帮不上。 注意 ：换更大的机器只会让其他核更闲，队列 H 的天花板纹丝不动——必须按 key 分片成多个队列才能横向吃满 CPU。](/blog-assets/rabbitmq-smart-broker/03-diagram-02.svg)

*图 3.2 四个队列进程分散在四个核上，但高流量全打到队列 H：它的单进程把核 1 打满，核 2/3/4 闲着也帮不上。 注意 ：换更大的机器只会让其他核更闲，队列 H 的天花板纹丝不动——必须按 key 分片成多个队列才能横向吃满 CPU。*

**场景走查**：一个订单系统把全部订单事件发进单个 quorum 队列 `orders`。压测发现吞吐卡在某个数字，CPU 总利用率只有 30%，但 `rabbitmqctl` 显示 `orders` 队列进程的 reductions（Erlang 的 CPU 计量）持续打满。换 16 核机器，吞吐几乎不变。根因：单队列单进程的串行天花板。改法是用 consistent-hash exchange 按 `order_id` 把消息散到 8 个队列 `orders.0..7`，每个队列各占一个核并行消费——总吞吐随队列数近线性上升。

**分片：用 consistent-hash exchange 把单热队列摊成 N 个**

```bash
# 启用一致性哈希 exchange 插件
rabbitmq-plugins enable rabbitmq_consistent_hash_exchange

# 声明一个 x-consistent-hash 类型的 exchange，按 routing key 哈希分流
rabbitmqadmin declare exchange name=orders type=x-consistent-hash

# 绑定 8 个队列，weight 写在 binding key 上（这里各为 1）
# 消息按 order_id 哈希落到其中一个队列，8 个队列进程吃 8 个核
for i in $(seq 0 7); do
  rabbitmqadmin declare queue name=orders.$i queue_type=quorum
  rabbitmqadmin declare binding source=orders destination=orders.$i routing_key=1
done
```

> **反直觉 · 加核救不了单队列**
>
> "吞吐不够就升配机器"在 RabbitMQ 单队列上**无效**。瓶颈是一个 Erlang 进程的串行邮箱，不是机器总算力。更多核、更高主频，只让其他核更闲。能横向扩的只有**队列数量**：分片、多队列、多消费者。设计阶段就要问"这条队列的峰值会不会顶满一个核"，而不是上线后再加机器——加机器这条路对单队列是堵死的。这一点和 Kafka 靠 partition 数扩并行是同一思路，只是 RabbitMQ 的并行单元是"队列"。

给单个队列**加更多消费者**，能突破它的吞吐天花板吗？

**展开答案（先停 10 秒再点）**

只能缓解消费侧，突破不了队列本身的天花板。消息的**路由、入队、出队调度、状态记账**全在那一个队列进程里串行完成——加消费者只是让出队后的业务处理并行，队列进程本身仍是单核串行的瓶颈。生产侧（publish 进同一队列）更是完全不受益。真正横向扩的唯一办法是把消息分片到**多个队列进程**，让队列这一层本身并行起来；消费者数量是第二位的。

<a id="s33"></a>

## 3.3 credit 流控与内存/磁盘告警：背压如何传导

队列给它的发布 channel 发放 credit（额度），每条消息扣 1，队列把消息推向下游（持久化）后才补额度；额度耗尽 → channel 进程阻塞 → TCP 不再读 socket → 背压沿 TCP 直接顶住生产者。

> **为什么需要它**
>
> 生产快、消费慢时，消息会在队列里堆积，最终吃光内存。最坏的做法是无限收下再 OOM 崩溃。RabbitMQ 用 credit-based flow control（基于额度的流控）做**精准背压**：哪条发布路径压垮了哪个队列，就只减速那条路径，不殃及无辜。这比"全局限速"或"丢消息"都更可控。

**底层机制（比文档深一层）**：每个 channel 进程向它要写入的队列进程持有一笔 **credit**。每发一条消息扣 1 个 credit。队列进程**只有在把这条消息向下游推进之后**（比如交给持久化层、写入 message store）才给该 channel 回补 credit。生产者快于队列处理速度时，credit 越扣越少，归零那一刻 channel 进程**停止处理新的入站帧** → 它不再从 TCP 连接读取字节 → socket 接收缓冲填满 → TCP 滑动窗口归零 → 生产者的 `send` 阻塞。背压就这样从队列一路逆向传到生产者的网络栈，**不需要应用层协议参与**，靠的是 TCP 自身的流控。

**这套机制是有靶向的**：credit 是 channel ↔ 队列这一对之间的，只有压垮了某队列的那条发布路径会被减速。别的 channel、别的队列照常跑。这与下面要说的"告警"形成鲜明对比——告警是全局的核弹。

**内存高水位与磁盘告警是最后一道防线，不是日常流控**。两条全局红线：

表 3.1 · 两类背压机制的作用域

| 机制 | 触发条件 | 作用域 / 后果 |
| --- | --- | --- |
| credit 流控 | 某队列处理慢于其发布 channel | **靶向**：只阻塞那一条 channel 的 TCP 读，其他连接无感 |
| 内存高水位告警 | broker 内存用量超过 `vm_memory_high_watermark`（默认 RAM 的 0.6，即约 60%） | **全局**：阻塞集群内**所有** publishing 连接，consumer 不受影响 |
| 磁盘告警 | 剩余磁盘低于 `disk_free_limit`（默认 50 MB） | **全局**：同上，阻塞所有 publisher，直到磁盘回到阈值以上 |

**底层机制（告警这一层）**：内存或磁盘告警一旦触发，broker 给**所有携带 publish 的连接**下达 `channel.flow` / 直接停止读取，整个集群范围内的生产**全部冻结**，直到资源回落到阈值以下自动解除。关键的两点：① 告警**只冻结 publisher，不动 consumer**——让消费继续排空队列，是它能自愈的前提；② 告警**只阻塞、不丢消息、也不把消息换页丢弃**。它是"踩了急刹"，不是"扔货减重"。这与某些系统"内存满了就丢老消息"的策略截然不同。

broker 内存触顶、所有 publisher 被告警冻结。此时消费者还能正常消费吗？这个设计为什么是对的？

**展开答案（先停 10 秒再点）**

能。告警只阻塞 publisher，consumer 照常拉取并 ack。这是**刻意**的：内存压力来自堆积的消息，只有让消费继续、把队列排空，内存才会回落、告警才能解除。若把 consumer 也冻结，系统就死锁在高水位再也下不来。所以"冻结写、放行读"是自愈的唯一可行方向。副作用：生产端会经历一段 publish 卡住或 confirm 迟迟不返回——这正是 [02 章 §2.1](#s21) publisher confirms 在告警期间"长时间不 ack"的根因，不是消息丢了，是被刹住了。

**场景走查**：消费者集体宕机，消息在队列里疯涨。先是 credit 流控把对应发布 channel 一条条减速（靶向）；堆积继续逼近 60% RAM，内存告警触发，**整个集群**所有生产连接被冻结，监控里 publish rate 瞬间归零、生产端线程卡在 `send` 上。运维重启消费者后队列开始排空，内存回落到水位线以下，告警自动解除，publish 恢复。全程**没有一条消息丢失**，代价是生产侧的一段冻结。

> **洞察 · 两级背压的层次**
>
> 把背压看成两级：第一级 credit 流控是**外科手术**——精确减速闯祸的那条路径，平时就在工作，多数人察觉不到；第二级内存/磁盘告警是**全局熔断**——第一级没拦住、资源真的逼近极限时,一把冻结所有写入保命。理解这个层次，就能解释一个常见困惑：为什么"只有几个队列在堆积，结果全集群的 publisher 都卡住了"——那是第二级告警被触发了，它从不区分是谁把内存吃满的。回看 [01 章 §1.1](#s11)说的"一条连接被阻塞，其上所有 channel 一起阻塞"，告警正是制造这种"一损俱损"的源头。

<a id="s34"></a>

## 3.4 quorum 队列与 Raft：多副本一致性

每个 quorum 队列本身就是一个 Raft 集群（建在 Ra 库上）：一个 leader、N 个 follower、一份复制的预写日志；publisher confirm 只在消息被提交到多数派（N/2 + 1）之后才返回。

> **为什么需要它**
>
> [02 章 §2.3](#s23)指出 classic 队列即使返回了 confirm，落盘也可能在 fsync 之前发生在崩溃窗口里——确认了仍可能丢。要堵上这个窗口，需要的不是"写一份盘写得更勤",而是"**把消息复制到多台机器、多数派都记下来才算数**"。单机再可靠也扛不住整机宕机；多副本一致性才是。quorum 队列就是 RabbitMQ 对这个问题的答案，用的是工业界验证过的 Raft 共识算法。

**底层机制（比文档深一层）**：每个 quorum 队列是一个独立的 Raft 组，跑在 **Ra**（RabbitMQ 团队实现的 Raft 库）上。组里一个 **leader** 负责接收所有写入，N 个 **follower** 复制 leader 的**预写日志**（write-ahead log，每条消息是一条 log entry）。一条 publish 的流程：client 发给 leader → leader 追加到自己的 log → 并行复制给 followers → 当**多数派**（含 leader，共 N/2 + 1 个节点）都把这条 entry 写进各自的 log，这条 entry 被标记为 **committed** → leader 此时才向生产者回 **confirm**。confirm 的语义因此变成"已被多数派持久记录"，这正是 [02 章 §2.3](#s23)所指的那个 fsync/安全保证的来源。

![图 3.3 3 副本 quorum 队列：leader 写入并向两个 follower 复制，只要多数派（2 个节点，leader + 任一 follower）落了日志，entry 即提交，confirm 立即返回。 注意 ：confirm 在多数派提交后就返回，不必等最慢的第三个节点——这既是它比单机更安全的原因，也是它比 classic 队列延迟更高的原因。](/blog-assets/rabbitmq-smart-broker/03-diagram-03.svg)

*图 3.3 3 副本 quorum 队列：leader 写入并向两个 follower 复制，只要多数派（2 个节点，leader + 任一 follower）落了日志，entry 即提交，confirm 立即返回。 注意 ：confirm 在多数派提交后就返回，不必等最慢的第三个节点——这既是它比单机更安全的原因，也是它比 classic 队列延迟更高的原因。*

**故障与恢复**：leader 宕机，剩余 follower 通过 Raft 选举在数百毫秒内选出新 leader，队列继续可用——只要多数派节点还活着。一个宕机后重新加入的节点，**从它自己 log 的 offset 处续传**缺失的 entry，不需要全量重新同步。这套行为是 Raft 算法保证的，不是 RabbitMQ 自己拼的。

**这取代了 classic mirrored queues（镜像队列）**。老的镜像队列用的是一套**自研的链式复制协议**——master 把消息异步推给 mirror，mirror 常常处于"未同步"（unsynchronised）状态，**不是任何共识算法**。网络分区下它的行为是**未定义**的：可能两边都自认 master，愈合时一边的数据被丢弃，造成**真实的消息丢失**。RabbitMQ 4.0 已彻底移除镜像队列（见 [01 章 §1.5](#s15)的过时配置警告）。quorum 队列把"多副本"从一个尽力而为的复制，升级成了有数学证明的多数派共识。

表 3.2 · quorum 队列 vs 已移除的镜像队列

| 维度 | quorum 队列（Raft） | classic mirrored（已于 4.0 移除） |
| --- | --- | --- |
| 复制协议 | Raft 共识，多数派提交 | 自研链式复制，异步、常不同步 |
| 分区行为 | 定义明确：少数派侧不可写，多数派继续 | 未定义，愈合时可能丢消息 |
| confirm 语义 | 多数派持久记录后才返回 | 取决于 mirror 是否已同步，不确定 |
| 恢复 | 按 log offset 增量续传 | 常需全量重新同步 |

> **代价 · quorum 不是免费的**
>
> 多数派复制要等网络往返，**publish 延迟高于 classic 队列**；每条消息在内存里维护一份索引（约 32 字节/条），**深 backlog 下内存随消息数增长**；quorum 队列**总是持久的**，没有"非持久 quorum 队列"这种东西。换来的是不丢消息与明确的分区语义。选型口径：要可靠性用 quorum（4.x 默认），明确可丢、要极致低延迟的临时流量才用 classic——这条权衡 [04 章 §4.2](#s42)会和 Kafka 的副本机制并排再算一遍。

一个 5 副本的 quorum 队列，多数派是几个？同时挂掉 2 个节点，队列还能写吗？挂掉 3 个呢？

**展开答案（先停 10 秒再点）**

多数派 = 5/2 + 1 = 3。挂 2 个，还剩 3 个 = 多数派，**能写**，confirm 正常返回。挂 3 个，只剩 2 个 < 3，凑不齐多数派，队列**停止接受写入**（拒绝或阻塞），直到至少恢复到 3 个节点。这正是 Raft 的安全性所在：它宁可在少数派侧停写，也绝不在凑不齐多数的情况下确认——避免脑裂下的数据分叉。代价是可用性：副本越多越能容错，但"多数派"门槛也越高。生产上 quorum 队列通常配 3 或 5 副本，偶数副本不划算（4 副本的多数派也是 3，容错能力却和 3 副本一样只是多耗一份存储）。

<a id="s35"></a>

## 3.5 Khepri 取代 Mnesia：元数据存储与消息存储

集群元数据（vhost、队列定义、binding、权限）的存储从 Mnesia 换成了基于 Raft 的 Khepri；网络分区下只有多数派分区继续推进，少数派暂停并在愈合后追平——且这个行为刻意不可配置。

> **两类"存储"别混淆**
>
> RabbitMQ 里有两套独立的存储，常被搞混。一套是**元数据存储**（metadata store）：存的是集群拓扑——有哪些 vhost、队列、exchange、binding、用户权限，全集群必须看到一致的视图。另一套是**消息存储**（message store）：存的是消息体本身。前者关乎"集群对自己的认知一不一致"，后者关乎"消息字节存在哪"。这一节先讲元数据存储的世代更替，再讲消息存储的落盘细节。

### 元数据存储：Mnesia → Khepri 的世代更替

**底层机制（比文档深一层）**：**Mnesia** 是 Erlang 自带的分布式数据库，RabbitMQ 从诞生起一直用它存元数据。它的复制是**点对点、无自动冲突解决**的：网络分区时，两侧节点都还能各自写元数据（建队列、改 binding），愈合那一刻两份不一致的状态撞在一起，**没有自动裁决谁对**。官方给的两个缓解手段都不可靠——`pause_minority`（少数派暂停）在抖动网络里容易误判，`autoheal`（自动愈合）会挑一侧丢弃；而 `pause_minority` 触发恢复时甚至可能**把整个元数据库 dump 出来再重灌一遍**，代价高昂。

**Khepri** 是 RabbitMQ 团队新写的元数据存储，同样建在 **Ra**（即 quorum 队列用的那个 Raft 库）之上——元数据的每一次变更都走 Raft，提交到多数派才生效。分区时的行为因此变得确定：**只有多数派那一侧能继续修改元数据**，少数派一侧**暂停元数据写入**，等网络愈合后从 Raft 日志追平。和 `pause_minority` 不同，这**不是一个可调的策略**，而是 Raft 内建的、唯一的行为。

表 3.3 · Khepri 取代 Mnesia 的时间线（RabbitMQ 4.x）

| 版本 | 时间 | 元数据存储状态 |
| --- | --- | --- |
| 4.0 | 2024 | Mnesia 仍为默认，Khepri 可选（experimental → 稳定演进中） |
| 4.2 | 2025-10 | Khepri 成为**新节点默认**元数据存储 |
| 4.3 | 2026-04 | Khepri 成为**唯一**存储，Mnesia 被完全移除 |

> **洞察 · "少旋钮"本身就是特性**
>
> Khepri 的分区行为**故意不可配置**，这不是功能缺失，是设计取向。Mnesia 时代的 `pause_minority` / `autoheal` / `ignore` 三选一，把一个本该由共识算法保证的正确性问题，推给运维去赌——选错就丢数据。Khepri 直接用 Raft 的多数派规则**消灭这个选择**：少数派必停、多数派必进、愈合必追平，无旋钮可调也就无从配错。"fewer knobs"在这里是把"可能配错的自由"换成"默认就对的确定性"。对从 Kafka 来的工程师，这等价于把 ZooKeeper/KRaft 那种"元数据本来就该走共识"的直觉，落实到了 RabbitMQ 的集群层。

### 消息存储：4 KB 阈值与那道性能悬崖

**底层机制（比文档深一层）**：消息体存哪，取决于它和 `queue_index_embed_msgs_below`（默认 **4 KB**）的大小关系。大于该阈值的消息，写进**每 vhost 共享的 message store**——一组引用计数的段文件（segment files），多个队列引用同一份消息体时靠 ref-count 共享，所有引用都 ack 后才回收。小于阈值的消息，**直接内嵌进每队列的 queue index**（队列索引）。queue index 本身记录每条消息的**位置 + 投递/ack 状态**，是队列的账本。

**这条 4 KB 线是一道真实的性能悬崖**：小于 4 KB 的消息内嵌在索引里，**无论 backlog 堆多深，单条消息占用的队列内存基本是常数**——索引结构紧凑、可批量顺序刷盘。一旦消息超过 4 KB 走 message store，每条消息多一次间接引用、段文件的随机访问与回收开销随之而来。所以"把消息控制在 4 KB 以内"对深队列场景是实打实的优化，跨过这条线性能特征会变。（顺带：classic 队列那个"confirm 前未必 fsync"的窗口，[02 章 §2.3](#s23)所说，物理上就发生在这套 message store / queue index 的落盘时序里。）

**查看与调整内嵌阈值（谨慎，影响内存与吞吐特征）**

```bash
# 当前生效值（默认 4096 字节）
rabbitmqctl eval 'application:get_env(rabbit, queue_index_embed_msgs_below).'
# => {ok, 4096}

# rabbitmq.conf 里调整：把 8 KB 以下的消息也内嵌进索引
# 收益：更多小消息走常数内存路径；代价：索引变大、单段刷盘更重
queue_index_embed_msgs_below = 8192
```

同一个队列里堆了一百万条 1 KB 的消息和一百万条 8 KB 的消息，两者对队列内存的占用模式有何本质不同？

**展开答案（先停 10 秒再点）**

1 KB 的消息小于 4 KB，**内嵌在 queue index** 里——它们的内容随索引一起，单条占用近似常数，深 backlog 下队列内存增长平缓、可顺序刷盘。8 KB 的消息大于 4 KB，**进共享 message store**，索引里只留一个引用，消息体在段文件中，多一层间接、回收靠 ref-count，随机访问更多。本质区别：4 KB 线两侧是"内嵌常数开销"与"外置引用 + 段文件管理"两套不同的内存与 IO 模型。批量发小消息时把单条压到 4 KB 以内，能稳稳吃到内嵌路径的红利。

## § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 一次逻辑 publish 在 TCP 上由哪几类帧组成？帧尾那 1 个字节（`0xCE`）有什么用？
2. 一条队列把一台机器的某个核打满了，吞吐还不够。换一台核更多、主频更高的机器有用吗？为什么？正确的扩展方向是什么？
3. 内存高水位告警触发时，broker 对 publisher 和 consumer 分别做什么？为什么要这样区别对待？它会丢消息吗？
4. （设计级）一个对延迟敏感、又要求绝对不丢的支付流水队列，应当怎样在 quorum 队列的"多数派复制"代价和可靠性之间取舍？副本数选 3 还是 5，依据是什么？

**答案（先做完再展开）**

1. 三类依次：一个 **method frame**（类型 1，声明 publish 的 exchange 和 routing key）+ 一个 **content-header frame**（类型 2，消息属性 + body 总大小）+ 一个或多个 **content-body frame**（类型 3，消息体；超过 frame\_max 才会有多个）。`0xCE` 是帧尾标记，解析器读完声明长度后必须撞上它，否则判定成帧损坏、直接断开整条连接——廉价的损坏检测。
2. **基本没用**。瓶颈是单个队列 = 单个 Erlang 进程 = 串行邮箱，约钉在一个 scheduler/核上；加核、提主频只让其他核更闲，那一条队列的天花板不动。正确方向是**分片成多个队列**（如 consistent-hash exchange 按 key 散列到 N 个队列），让多个队列进程各占一个核并行，总吞吐随队列数近线性扩展。
3. 告警**阻塞所有 publisher**（集群范围），**放行所有 consumer**。这样区别对待是因为内存压力来自堆积的消息，只有让消费继续排空队列、内存回落，告警才能解除；若冻结消费就会死锁在高水位。它**只阻塞、不丢消息、不换页丢弃**——是急刹不是扔货。
4. 设计级：可靠性优先选 quorum 队列（4.x 默认就是），接受多数派复制带来的延迟上浮——支付流水"不丢"的权重高于个位数毫秒的延迟。副本数选 **3** 起步：多数派 = 2，可容 1 个节点宕机，延迟代价适中。要求更高容错（容 2 个节点同时挂）才上 **5**（多数派 = 3），代价是每条消息多复制两份、写延迟更高。**不选偶数**：4 副本多数派也是 3，容错力与 3 副本相同却多耗一份存储与带宽。再叠加 02 章的 publisher confirms，确保 confirm 返回 = 多数派已持久记录，才算端到端不丢。

**进阶挑战 · 刚好够不着**

### 诊断一个"全集群 publisher 卡死"的现场

线上告警：所有生产服务的 publish 调用集体卡住、confirm 迟迟不返回，但消费者日志显示仍在正常消费、队列深度在缓慢下降。CPU 总利用率不高，只有少数几个队列在堆积。请按本章机制，**分两级**说明这是哪种背压、根因链条是什么、为什么消费者不受影响、运维该先看哪个指标来确认。

**提示（卡住再展开）**

这是**第二级**背压——内存（或磁盘）高水位告警，不是第一级 credit 流控（流控只会靶向减速个别 channel，不会让全集群一起卡）。链条：少数几个队列堆积 → broker 总内存逼近 `vm_memory_high_watermark`（约 60% RAM）→ 触发全局告警 → **所有** publishing 连接被冻结，于是连那些没在堆积的服务也 publish 卡住、confirm 不返回。消费者放行，所以队列深度仍在降。先看的指标：broker 的内存告警状态（`rabbitmqctl status` 里的 `alarms` / `memory`，或管理界面顶部的红色告警条）。确认是告警后，处置方向是加速消费排空、或临时调高水位争取时间，而不是去重启 publisher——publisher 没坏，是被刹住了。延伸想:为什么"少数队列堆积却拖垮全集群写入"在 Kafka 上不会以同样方式发生？

### 本章参考

- [Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)（官方文档）
- [Flow Control（credit 流控与内存/磁盘告警）](https://www.rabbitmq.com/docs/flow-control)（官方文档）
- [Metadata Store / Khepri](https://www.rabbitmq.com/docs/metadata-store)（官方文档）
- [AMQP 0-9-1 Protocol Reference（帧与 method 定义）](https://www.rabbitmq.com/amqp-0-9-1-reference)（官方）

---

<a id="chapter-04"></a>

## 对标 Kafka：何时选谁

> 前三章建立了 RabbitMQ 的模型、可靠性与内部机制——这一章把"智能 broker、ack 后删除"这条主线放到 Kafka 的"不可变日志、offset 可重放"旁边，逐条对比并给出选型判据。读者已经熟悉 Kafka，所以每一条对比都落到机制层：差异从哪来，而不是只贴一个标签。

### 本章你将建立的 schema

- 架构分叉：RabbitMQ 是被路由的临时信箱，Kafka 是可重放的持久账本，一切差异都从这里长出来
- 投递模型：RabbitMQ 用 prefetch 限流的 push，Kafka 用按 offset long-poll 的 pull——谁定速率，谁会被压垮
- 顺序与重放：Kafka 分区内全序且可任意倒带；RabbitMQ 的顺序在 competing consumers 与 requeue 下天然易碎
- 吞吐与延迟的真实数字（Confluent 2024 基准）：Kafka 赢的是吞吐不是单条延迟，低负载下 RabbitMQ 反而更快
- 选型判据：RabbitMQ、Kafka、RabbitMQ Streams 三者各自的归属场景，以及它们正从两端向中间收敛

<a id="s41"></a>

## 4.1 架构对照：智能 broker vs 不可变日志

RabbitMQ 把状态、路由、ack 记账都压在 broker 里，消息 ack 即删；Kafka 的 broker 只追加不可变字节，不路由、不删除，消费进度由消费者自己用 offset 持有。

这条分叉在 [01 章 §1.4](#s14) 已被立为全教程的轴心。这里把它摆到 Kafka 旁边逐项展开：同一个"消息从生产者到消费者"的过程，两套系统把哪些职责放在了哪一侧。

表 4.1 · 职责落点对照

| 职责 | RabbitMQ（智能 broker） | Kafka（不可变日志） |
| --- | --- | --- |
| 路由决策 | broker 侧：exchange + binding 把消息分发到 0~N 个 queue | 无 broker 侧路由：producer 按 key 哈希选 partition，仅此而已 |
| 消息存储 | broker 持有消息状态（Ready / Unacked），随消费推进而变 | broker 存不可变字节序列；写入后只读、不改 |
| 消费进度 | broker 替消费者记账：谁 ack 了、谁还欠着 | 消费者自己持有 offset；broker 不知道谁读到哪 |
| 消费后 | ack 即**删除**，不留记录 | 消息**留存**，按 time/size 策略到期才删，可被重读 |
| 重放能力 | classic/quorum 队列：ack 后即消失，无法倒带 | 任意消费者可把 offset 重置到任意位置重读 |

**底层机制（比文档深一层）**：差异的根在"谁持有消费游标"。RabbitMQ 的 broker 为每个 queue 维护一份消息集合，每次投递分配一个 delivery tag 并把消息从 Ready 移到 Unacked；收到 ack 就从存储里抹掉这条。游标在 broker 内部，且是**单调销毁**的——读过的位置不再存在。Kafka 反过来：broker 把每个 partition 写成一个仅追加的 segment 文件序列，写入即定型，broker 对"谁消费到哪"一无所知；offset 是消费者自己提交到 `__consumer_offsets` 这个内部 topic 里的一个数字。因为消息不随消费而变，多个消费者读同一份字节互不干扰，任何一个都能把自己的 offset 倒回去重读。一句话：RabbitMQ 的状态机活在 broker 里，Kafka 的状态机活在消费者里。

![图 4.1 左侧 RabbitMQ：消息经 exchange 路由进 queue，push 给 consumer，ack 后从 broker 删除。右侧 Kafka：producer append 到不可变 partition，consumer 拿自己的 offset 指针前移。 注意 ：左侧消息消费后 不复存在 ，右侧消息留存、offset 可任意倒回——这是后续每一条差异的源头。](/blog-assets/rabbitmq-smart-broker/04-diagram-01.svg)

*图 4.1 左侧 RabbitMQ：消息经 exchange 路由进 queue，push 给 consumer，ack 后从 broker 删除。右侧 Kafka：producer append 到不可变 partition，consumer 拿自己的 offset 指针前移。 注意 ：左侧消息消费后 不复存在 ，右侧消息留存、offset 可任意倒回——这是后续每一条差异的源头。*

> **洞察 · 反直觉点**
>
> 对一个 Kafka 老手，最容易低估的不是"RabbitMQ 删消息"，而是 **Kafka 的 broker 完全不做路由与过滤**。Kafka broker 收到的是一串字节，它只负责按 partition 追加、复制、按策略过期；任何"这条消息该给谁、要不要过滤掉"的逻辑，要么落在 producer 的分区键里，要么落在消费端 / Kafka Streams 里。RabbitMQ 的 exchange 把这套逻辑放进了 broker——这正是它路由能力的来源，也是它吞吐上限的来源。两端的取舍，4.4 用数字说话。

一个消费者把一批消息处理完并 ack 了，事后发现处理逻辑有 bug，需要拿原始消息重跑一遍。RabbitMQ（classic/quorum 队列）和 Kafka 各能怎么办？

**展开答案（先停 10 秒再点）**

Kafka：把消费者的 offset 重置到那批消息的起始位置，重新消费一遍即可——消息还在日志里。RabbitMQ 的 classic/quorum 队列：消息在 ack 那一刻已被 broker 删除，**没有任何办法**从队列里再取出来，只能寄望于上游能重新生产，或事先把消息落到别处。这就是"ack 后删除"在运维上最痛的一面，也是 RabbitMQ Streams（4.5 详谈）想补的洞。

<a id="s42"></a>

## 4.2 投递与消费：push/prefetch vs pull/offset

RabbitMQ 把消息 push 给消费者，用每消费者的 prefetch（最多多少条未 ack 在途）限流；Kafka 让消费者 pull——按 offset 长轮询拉取，速率由消费者自己定。

表 4.2 · 投递模型对照

| 维度 | RabbitMQ（push + prefetch） | Kafka（pull + long-poll） |
| --- | --- | --- |
| 谁发起投递 | broker 主动把消息推给消费者 | 消费者主动按 offset 发 fetch 请求拉 |
| 速率由谁定 | broker；消费者只能用 prefetch 设上限 | 消费者自己；想多快拉多快 |
| 慢消费者后果 | 未 ack 堆到 prefetch 上限即停推，易被压垮 | 自己少拉即可，不阻塞别人，落后了之后追上 |
| 单条延迟 | 低——消息一就绪就推出去 | 略高——要等下一次 fetch，靠批量摊薄 |
| 吞吐驱动 | 逐条投递 + 逐条 ack 记账 | 批量 fetch，一次拉一大段 |

**底层机制（比文档深一层）**：RabbitMQ 的 push 是 broker 通过 `basic.deliver` 主动把消息帧推到消费者的 channel 上。流控的唯一旋钮是 **prefetch**（`basic.qos` 的 prefetch count）：它限定一个消费者最多有多少条"已推送但未 ack"的消息在途。prefetch 设 1，broker 推一条、等 ack、再推下一条，延迟最低但吞吐受单条往返限制；prefetch 设大，在途消息多、吞吐高，但若消费者处理慢，这些消息全卡在它手里（Unacked），其它空闲消费者也分不到。Kafka 的 pull 是消费者发 fetch 请求带上 offset，broker 用 long-poll——有数据立即返回，没数据则挂起到 `fetch.max.wait.ms` 再返回空，避免空轮询打爆 CPU。消费者一次能拉 `max.poll.records` 条，处理完再拉下一批，速率完全自控；一个慢消费者只是自己 offset 前进得慢，partition 里的数据不动，它随时能追上。push 把"会不会压垮消费者"的风险交给 broker 的 prefetch 旋钮去兜；pull 把这个风险从系统里消除了——消费者永远不会被喂太多。

> **洞察 · 把 backpressure 想清楚**
>
> backpressure（背压，下游处理不过来时让上游慢下来）在两套系统里是两种东西。Kafka 的 pull 让背压**自然成立**：消费者不发 fetch，数据就在 partition 里待着，天生不会过载。RabbitMQ 的 push 没有这种天然背压，它用 prefetch 来**人为制造**一个上限——这是个必须调对的旋钮：太小则吞吐被单条往返拖死，太大则消息全堆在一个慢消费者手里、其它消费者饿着。prefetch 的取舍在 [03 章 §3.2](#s32) 的单队列处理模型里有更细的展开。

一个 RabbitMQ 队列接了 3 个消费者，prefetch 设成 1000。其中一个消费者卡住了（不崩、但处理极慢，迟迟不 ack）。队列里堆积的消息会怎么分配？

**展开答案（先停 10 秒再点）**

broker 会先把多达 1000 条消息推给那个卡住的消费者（填满它的 prefetch 窗口），这 1000 条就锁在它手里成了 Unacked，其它两个健康消费者干瞪眼。结果是吞吐塌方却没有任何报错。把 prefetch 调小（如 10~50），broker 就不会一次喂太多给慢消费者，消息更均匀地流向健康消费者。换成 Kafka 不存在这个问题——每个消费者按自己的速率 pull，慢的那个只是自己落后。这正是 push 模型必须调 prefetch 的原因。

<a id="s43"></a>

## 4.3 顺序与重放：RabbitMQ 的顺序为何易碎

Kafka 在一个 partition 内提供全序，同 key 进同 partition 即有序；RabbitMQ 按队列到达顺序投递，但 competing consumers 让完成顺序错位，requeue 还会把消息重新插回队列（常在头部），"FIFO 队列"不等于"FIFO 处理"。

消费并行与重放也在 [01 章 §1.4](#s14) 埋下了伏笔。这里把它和 Kafka 的 consumer group 摆在一起看。

表 4.3 · 并行、顺序、重放对照

| 维度 | RabbitMQ | Kafka |
| --- | --- | --- |
| 并行模型 | competing consumers：一个 queue 接多个消费者，broker 把消息一人一条派出去 | consumer group：每个 partition 最多 1 个消费者 |
| 加并行 | 直接加消费者，零协调，立刻分担 | 受 partition 数封顶；加消费者超过 partition 数则空转 |
| 重平衡 | 无——加减消费者不触发协调 | 消费者加入/离开触发 rebalance，期间短暂停顿 |
| 顺序保证 | 队列到达有序，但 competing consumers + requeue 下处理顺序易碎 | partition 内严格全序（跨 partition 无序） |
| 重放 | classic/quorum：ack 即删，无法重放 | 任意 offset 自由重读 |

**底层机制（比文档深一层）**：Kafka 的顺序来自"同 key 哈希到同一 partition + 一个 partition 在组内只归一个消费者"这两条的合力——同一实体的消息走同一条单线日志，被同一个消费者按 offset 顺序读，所以有序。RabbitMQ 的队列**投递**是按到达顺序的，但顺序在两处断裂：其一，competing consumers——broker 把消息一人一条地派给多个消费者，谁先处理完不取决于谁先拿到，msg-1 给了消费者 A、msg-2 给了消费者 B，B 更快，于是 msg-2 先完成，完成顺序和到达顺序脱钩。其二，requeue——一条被 nack 或因消费者断连而退回的消息，会被重新插入队列，**常常插在队首**（取决于版本与配置），于是它越过了本来排在它后面的消息，顺序当场被打乱（这个 requeue 回插的细节，[01 章 §1.4](#s14) 的状态机图里画过那条回环）。结论很反直觉：RabbitMQ 的 queue 是 FIFO 的**数据结构**，但一旦有并行消费或重投，得到的不是 FIFO 的**处理**。

要在 RabbitMQ 上复刻 Kafka 那种"按 key 有序又能并行"，得动用 **consistent-hashing exchange**（一致性哈希交换机，按消息 key 哈希到固定的某个 queue），把相关消息全路由到同一个 queue，再给该 queue 配**单一活跃消费者**（single active consumer，同一时刻只有一个消费者在消费这个队列）。等于用"一 key 一队列、一队列一消费者"手工搭出 Kafka 的 partition 语义——能做到，但要自己拼装，而 Kafka 里这是默认行为。

> **洞察 · 容易高估的对称性**
>
> Kafka 的并行上限被 **partition 数**死死封顶：partition 建了 12 个，最多 12 个消费者并行，第 13 个只能空转等接替；想加并行得先增 partition（且增了不能减）。RabbitMQ 没有这个上限——队列接多少消费者都行，加一个立刻分担、零重平衡。但这份"自由"的代价正是上面的顺序易碎。两者在这里不是对称的优劣，而是把"顺序"和"弹性扩容"放在了天平的两端：Kafka 锁顺序、限弹性；RabbitMQ 给弹性、弃顺序。

某业务要求"同一个用户的事件必须按发生顺序处理，不同用户之间可以并行"。在 RabbitMQ 上要怎么搭？为什么单纯"一个队列 + 多个消费者"不行？

**展开答案（先停 10 秒再点）**

单纯"一队列多消费者"不行：competing consumers 会把同一用户的相邻事件派给不同消费者并行处理，完成顺序错乱。正解是 consistent-hashing exchange 按 `userId` 哈希，把同一用户的事件恒定路由到同一个 queue，再给每个这样的 queue 配 single active consumer。不同用户落在不同 queue、由不同消费者并行处理，同一用户落在同一 queue、被一个消费者顺序处理。这恰好是 Kafka 用"key→partition + 一 partition 一消费者"免费给你的东西。

<a id="s44"></a>

## 4.4 吞吐与延迟：真实数字与原因

Kafka 在吞吐上压倒性领先，但赢的是吞吐不是单条延迟——在低负载下 RabbitMQ 的端到端延迟反而更低。

Confluent 2024 的基准测试（i3en.2xlarge 实例、3 个 broker、1 KB 消息、3 副本、4 producer/4 consumer）给出一组常被引用的数字：

表 4.4 · Confluent 2024 基准（i3en.2xlarge · 3 broker · 1KB · 3× 副本）

| 系统 | 峰值吞吐 | 延迟特征 |
| --- | --- | --- |
| Kafka | **~605 MB/s** | 200K msg/s 时 p99 约 5 ms；吞吐压倒性领先 |
| Pulsar | ~305 MB/s | 200K msg/s 时 p99 约 25 ms |
| RabbitMQ | ~38 MB/s | ~30K msg/s 以上 CPU 瓶颈、p99 急剧抬升；但 ~30 MB/s 低负载下 p99 约 1 ms，**低于 Kafka** |

**底层机制（比文档深一层）**：Kafka 赢吞吐有四个叠加的原因。① **顺序磁盘写**——partition 是仅追加文件，每个字节只在一条优化了近十年的代码路径上落盘一次，顺序写对机械盘和 SSD 都远快于随机写。② **OS page cache**——Kafka 不自建缓存层，直接复用 Linux 页缓存，读多写少时数据热在内核内存里。③ **zero-copy**（零拷贝）——用 `sendfile` 把文件数据从页缓存直接送到网卡，**不经过用户态的来回拷贝**。④ **producer 批量**——基准里 producer 攒批至多 1 MB、最多等 10 ms（linger），把多条消息合成一次写、一次 fsync，把固定开销摊薄。RabbitMQ 的上限来自相反的设计：它要为**每一条**消息做路由匹配、维护 Ready/Unacked 状态、记 ack 账，逐条记账的固定开销无法摊薄；更关键的是**每个队列由单个 Erlang 进程处理**（single-process-per-queue bottleneck，[03 章 §3.2](#s32) 拆过），一个队列的吞吐被一个进程的单核能力封顶，30K msg/s 以上就撞到 CPU 墙。

![图 4.2 同一套硬件上 Kafka 峰值吞吐约为 RabbitMQ 的 16 倍。 注意 ：这张图只说吞吐——在 ~30 MB/s 的低负载下 RabbitMQ 的 p99 延迟（约 1 ms）反而低于 Kafka，吞吐与单条延迟是两件事，别用前者的差距去推断后者。](/blog-assets/rabbitmq-smart-broker/04-diagram-02.svg)

*图 4.2 同一套硬件上 Kafka 峰值吞吐约为 RabbitMQ 的 16 倍。 注意 ：这张图只说吞吐——在 ~30 MB/s 的低负载下 RabbitMQ 的 p99 延迟（约 1 ms）反而低于 Kafka，吞吐与单条延迟是两件事，别用前者的差距去推断后者。*

> **洞察 · 诚实地表述这个差距**
>
> "Kafka 比 RabbitMQ 快 16 倍"这句话只在**吞吐**这一维成立。换到**单条消息的端到端延迟**，结论会翻转：在远低于 Kafka 的吞吐区间（约 10 MB/s 以下），RabbitMQ 能做到亚毫秒级 p99，比 Kafka 更低——因为 Kafka 的批量机制本身要等 linger、攒批，给单条消息加了固有延迟。所以一个低流量、要求每条消息尽快送达的请求-响应场景，RabbitMQ 反而是更快的那个。把"Kafka 快"理解成"Kafka 吞吐高"，而不是"Kafka 每条都更快"。

一个内部 RPC 系统，QPS 几千、每条请求都要尽快拿到响应，延迟敏感但吞吐谈不上高。光看"Kafka 605 vs RabbitMQ 38"就选 Kafka，会踩到什么？

**展开答案（先停 10 秒再点）**

会选错维度。这个场景的约束是**低延迟**不是高吞吐，几千 QPS 远在 RabbitMQ 的舒适区内（30K msg/s 才撞墙）。在这个负载下 RabbitMQ 的 p99 更低，而 Kafka 的批量/linger 反而给每条请求加了延迟。加上 RPC 需要请求-响应、临时回复队列这类 RabbitMQ 原生擅长的模式。结论：延迟敏感 + 中等吞吐 + 请求-响应 → RabbitMQ。605 这个数字在这里根本不相关。

<a id="s45"></a>

## 4.5 选型决策：RabbitMQ、Kafka、还是 Streams

复杂路由 / 每消息工作流 / RPC / 低延迟中等吞吐 → RabbitMQ；高吞吐事件流 / 重放 / 事件溯源 / 多独立消费者读同一份流 → Kafka；想要重放与扇出但留在 RabbitMQ 生态且吞吐要求不极端 → RabbitMQ Streams。

表 4.5 · 场景 → 选型

| 场景 | 选谁 | 为什么 |
| --- | --- | --- |
| 复杂路由 / 按条件扇出到每个应用各自的队列 | RabbitMQ | exchange（fanout/direct/topic/headers/一致性哈希）做 broker 侧过滤；Kafka 无 broker 侧路由（[01 §1.3](#s13)） |
| 每消息任务/工作队列、priority、TTL、DLX 工作流 | RabbitMQ | 这些是 RabbitMQ 的原生语义；Kafka 没有逐消息优先级/过期/死信 |
| RPC / 请求-响应、临时回复队列 | RabbitMQ | 低延迟 push + 灵活路由天然契合；Kafka 的日志模型不为此设计 |
| 低延迟、中等吞吐 | RabbitMQ | 低负载下 p99 更低（4.4）；没撞到 30K msg/s 的墙 |
| 高吞吐事件流、海量写入 | Kafka | 顺序写 + page cache + zero-copy + 批量，吞吐高一个量级（4.4） |
| 重放 / 重新处理、事件溯源 | Kafka | 消息留存、offset 可任意倒带；classic/quorum 队列 ack 即删 |
| 多个独立消费者各自读同一份流、流处理 | Kafka | 不可变日志天然支持多读者互不干扰 + Kafka Streams |
| 想要重放/扇出给多读者，但要留在 RabbitMQ 生态、吞吐不极端 | RabbitMQ Streams | append-only 可重放日志、非破坏性消费，免迁 Kafka |

**底层机制（比文档深一层）**：第三个选项 **RabbitMQ Streams** 是 RabbitMQ 对 Kafka 的正面回应（GA 自 3.9，super-streams 分区在 4.x 稳定）。它是一个**仅追加、可复制的日志**，消费是**非破坏性**的——消费者按 `x-stream-offset` 附着到日志的某个位置（`first` / `last` / 某个 offset / 某个 timestamp），读过不删，可重放，多个消费者读同一份。4.2 进一步加了服务端 AMQP 1.0 的 SQL 风格 filter expression（服务端按表达式过滤，只下发命中的消息）。这把 Kafka 的几项核心能力搬进了 RabbitMQ：留存、重放、扇出给多读者。**但它不等于 Kafka**：一个 stream 仍然没有 classic/quorum 队列的 TTL / DLX / priority / 逐消息持久化语义；RabbitMQ 官方文档也直言——没有任何持久化队列类型能在吞吐上匹敌一个日志系统。所以 Streams 是从 RabbitMQ 这一端向 Kafka 收敛，而非完全取代；与此同时 Kafka 在 2024 年补上了 tiered storage（分层存储，热数据在本地盘、冷数据下沉到对象存储，便宜地长期留存并重放）。两个系统正从相反的出身互相靠拢：一个加日志语义，一个加廉价长留存。

![图 4.3 三问决策树：先问路由/RPC/逐消息工作流（是→RabbitMQ），再问重放/溯源/超高吞吐（否→RabbitMQ 低延迟中吞吐场景），最后在"要重放"里分流——留在生态且吞吐不极端→Streams，否则→Kafka。 注意 ：超高吞吐这一支，Streams 仍不及 Kafka，吞吐压满时走右路。](/blog-assets/rabbitmq-smart-broker/04-diagram-03.svg)

*图 4.3 三问决策树：先问路由/RPC/逐消息工作流（是→RabbitMQ），再问重放/溯源/超高吞吐（否→RabbitMQ 低延迟中吞吐场景），最后在"要重放"里分流——留在生态且吞吐不极端→Streams，否则→Kafka。 注意 ：超高吞吐这一支，Streams 仍不及 Kafka，吞吐压满时走右路。*

> **边界 · 别把 Streams 当 Kafka 平替**
>
> RabbitMQ Streams 补上了留存与重放，但它不继承 classic/quorum 队列的 TTL、DLX、priority、逐消息持久化语义，吞吐也不及真正的日志系统；4.2 的 SQL filter 还只走 AMQP 1.0，原生 Stream 协议与传统 0.9.1 客户端都用不上。需要 Kafka 级吞吐、成熟流处理生态（Kafka Streams / ksqlDB / Connect）或分层存储长留存时，仍然是 Kafka。Streams 的定位是"不想为了重放就整体迁去 Kafka"的折中。

## § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. Kafka 的 broker 对"一条消息该投给谁、要不要过滤"做了什么？这和 RabbitMQ 的 exchange 有什么本质区别？
2. "Kafka 比 RabbitMQ 快"这句话，在吞吐和单条延迟两个维度上分别成立吗？给出 Confluent 基准里的关键数字。
3. 一个 RabbitMQ 队列接了多个 competing consumers，为什么"queue 是 FIFO 的"不等于"消息被 FIFO 地处理"？两个断裂点是什么？
4. **场景判断**：系统要把一份订单变更流喂给 5 个互相独立的下游（风控、报表、搜索索引、对账、归档），每个下游都要能从历史某点重新消费一遍，吞吐中等偏上。选 RabbitMQ、Kafka 还是 RabbitMQ Streams？为什么？

**答案（先做完再展开）**

1. Kafka 的 broker **什么都不做**——它只按 partition 追加字节，路由（选 partition）发生在 producer 的 key 哈希里，过滤/扇出发生在消费端或 Kafka Streams 里。RabbitMQ 的 exchange 把路由与过滤放进了 **broker**（topic/headers/一致性哈希等），代价是逐消息匹配带来的吞吐上限。
2. 吞吐维度成立：Kafka ~605 MB/s vs RabbitMQ ~38 MB/s（i3en.2xlarge、1KB、3 副本），约 16 倍。单条延迟维度**翻转**：~30 MB/s 低负载下 RabbitMQ p99 约 1 ms，低于 Kafka；Kafka 的批量/linger 给单条加了延迟。"快"指吞吐高，不指每条都更快。
3. 两个断裂点：① competing consumers——消息一人一条派给不同消费者，谁先处理完和谁先拿到无关，完成顺序与到达顺序脱钩；② requeue——nack 或断连退回的消息被重新插入队列（常在队首），越过后面的消息。要恢复有序并行，需一致性哈希 exchange + single active consumer。
4. 选 **Kafka**。判据：多个独立消费者各自读同一份流（不可变日志天然支持，互不干扰）+ 每个都要从历史某点重放（offset 可倒带）+ 吞吐中等偏上。RabbitMQ classic/quorum 队列 ack 即删、无法重放，且扇出给 5 个独立读者要建 5 套队列。Streams 能满足重放与多读者，但题面吞吐偏上且无"必须留在 RabbitMQ 生态"的约束，Kafka 是更直接的归属；若题面强约束"已重度使用 RabbitMQ、不愿引入 Kafka"，则 Streams 是折中解。

**进阶挑战 · 刚好够不着**

### 给一个"混合需求"系统拆分消息中间件

一个电商后台同时有三类消息流：(a) 下单后触发的**履约工作流**——发券、扣库存、通知，每步要重试、要死信、要按业务优先级插队；(b) 全站**行为埋点事件**——每秒数十万条，要长期留存供离线分析与模型训练随时重跑；(c) 一份**订单状态变更流**，要实时喂给 3 个内部服务，偶尔需要回放最近一天补数据。请为三类流各选一种方案（RabbitMQ / Kafka / RabbitMQ Streams），并各用一句话给出决定性判据。

**提示（卡住再展开）**

(a) → RabbitMQ：重试/DLX/priority/逐消息工作流是它的原生语义，吞吐不是约束。(b) → Kafka：每秒数十万条 + 长期留存 + 随时重跑，正是日志 + tiered storage 的主场，RabbitMQ 30K msg/s 就撞墙。(c) → RabbitMQ Streams 或 Kafka 皆可：要重放 + 多读者，若团队已重度用 RabbitMQ 且只需"最近一天回放"这种不极端的留存，Streams 免去引入 Kafka；若已有 Kafka 或要对接流处理生态，则 Kafka。决定性判据分别是：逐消息工作流语义、超高吞吐+长留存、重放+生态归属。

### 本章参考

- [Benchmarking Apache Kafka, Apache Pulsar, and RabbitMQ](https://www.confluent.io/blog/kafka-fastest-messaging-system/)（Confluent 2024 基准，4.4 数字出处）
- [RabbitMQ vs Kafka（Jack Vanlightly 系列）](https://jack-vanlightly.com/blog/2017/12/4/rabbitmq-vs-kafka-part-1-messaging-topologies)——拓扑与语义的逐条对照
- [Streams and Super Streams](https://www.rabbitmq.com/docs/streams)（RabbitMQ 官方文档）
- [When to use RabbitMQ or Apache Kafka](https://www.cloudamqp.com/blog/when-to-use-rabbitmq-or-apache-kafka.html)（CloudAMQP 选型指南）

---

<a id="chapter-05"></a>

## 自测与辨析：把答案盖住

> 前四章给了模型、可靠性、内部机制、与 Kafka 的对标。这一章把它们搅在一起考——尤其最后的判别层，逼你在真实场景里**选**，而不是**认**。答案统一折叠在文末，先做完再展开。

三层梯度，约 17 题。**概念层**查词汇（对应 01），**原理层**查机制（对应 02、03），**判别层**查迁移——给场景、逼选型，跨越 01–04（这是本教程的 capstone）。

![图 5.1 三层梯度，自下而上难度递增。 注意 ：真正区分"懂了"和"读过"的是 顶层判别题 ——它不问定义，只给场景逼你选 RabbitMQ 还是 Kafka、哪种 queue、哪种 exchange。下两层答得快不代表顶层答得对。](/blog-assets/rabbitmq-smart-broker/05-diagram-01.svg)

*图 5.1 三层梯度，自下而上难度递增。 注意 ：真正区分"懂了"和"读过"的是 顶层判别题 ——它不问定义，只给场景逼你选 RabbitMQ 还是 Kafka、哪种 queue、哪种 exchange。下两层答得快不代表顶层答得对。*

<a id="t1"></a>

## 一、概念层 · 对应 01

1. 生产者 publish 一条消息时，需要指定**队列名**吗？它实际指定的是什么？（[§1.2](#s12)）
2. 四种 exchange（direct/fanout/topic/headers）各自拿什么和 binding key 比？哪两种根本不看 routing key？（[§1.3](#s13)）
3. topic 的 binding key `*.error` 能匹配 routing key `auth.login.error` 吗？要匹配它，binding key 该怎么写？（[§1.3](#s13)）
4. 同一个 channel 能不能被多个线程同时收发？根因在协议的哪一层？（[§1.1](#s11)）
5. 消息被 ack 之后，broker 对它做了什么？这与 Kafka 消费者提交 offset 的本质区别是什么？（[§1.4](#s14)）

<a id="t2"></a>

## 二、原理层 · 对应 02、03

6. publisher confirms 与 consumer ack 各防住消息生命周期的哪一段丢失？少了其中一个会怎样？（[§2.1](#s21)、[§2.2](#s22)）
7. durable、persistent、quorum 三者各保护什么？为什么"durable + persistent + 已确认"的消息在 **classic 队列**上仍可能丢？（[§2.3](#s23)）
8. prefetch 设成无限大、设成 1，各会出什么问题？怎么估一个合理值？（[§2.2](#s22)）
9. 一次 publish 在 AMQP 0-9-1 里由哪几种 frame 组成？channel 编号在哪里、起什么作用？（[§3.1](#s31)）
10. "给 broker 加 CPU 核数能提升**单个**队列的吞吐"——对吗？根因是什么？（[§3.2](#s32)）
11. 内存高水位告警触发时，谁被阻塞、谁不受影响？是**阻塞**还是**丢弃**消息？（[§3.3](#s33)）
12. quorum 队列的 publisher confirm 在什么时刻返回？它靠什么机制取代了被移除的镜像队列？（[§3.4](#s34)）

<a id="t3"></a>

## 三、判别层 · 综合 01–04（capstone）

每题先写下你的选择和**一句话依据**，再展开答案。判别题没有"背得出"，只有"想得通"。

13. **事件分发 + 历史重跑**：一份"用户注册"事件要让邮件、风控、数仓三个独立服务**各消费一次**，且数仓以后可能**重跑全部历史**。选 RabbitMQ 还是 Kafka？若坚持用 RabbitMQ，缺口在哪、用什么补？（综合 [§1.3 路由](#s13) + [§4.3 重放](#s43)）
14. **有序 + 高吞吐**：订单状态机要求"同一订单的事件严格按序处理"，同时整体吞吐要高。RabbitMQ 怎么做到？Kafka 怎么做到？各自的代价？（综合 [§4.3 顺序](#s43) + [§3.2 单队列瓶颈](#s32)）
15. **绝不丢**：金融转账消息绝对不能丢，单节点宕机也不能丢。在 RabbitMQ 里你会怎么配（队列类型 + 发送端 + 消费端三处）？（综合 [§2.3](#s23) + [§3.4 quorum](#s34)）
16. **RPC 低延迟**：一个内部服务调用，请求-响应、要低延迟、量不大。RabbitMQ 还是 Kafka？为什么这种场景 RabbitMQ 反而延迟更低？（综合 [§4.2 投递](#s42) + [§4.4 延迟](#s44)）
17. **毒消息**：某条消息每次消费都失败，导致 CPU 飙高、队列头部被堵、后面的消息也消费不动。怎么诊断、怎么修？（综合 [§2.4 毒消息](#s24) + [§1.4 生命周期](#s14)）

> **亲手画一张图**
>
> 合上教程，在纸上或 Excalidraw 里画出一条消息从 producer 到**被删除**的完整路径——只画 5 个元素：producer、exchange、binding、queue、consumer，外加 ack 箭头。画完回到 [§1.4](#s14) 和首页[图 0.1](#map) 对照：你画的图里，"ack 之后消息被删除"这一步标出来了吗？exchange 和 queue 之间，你写上 binding 了吗？这两处是最容易在脑子里"想当然"、落到纸上才发现没想清的地方。

**进阶挑战 · 刚好够不着**

### 把整套教程压成一张选型决策表

不看 [§4.5](#s45)，自己列一张三列表：**需求特征**（如"复杂路由"/"重放"/"严格有序"/"超高吞吐"/"RPC"/"绝不丢"）→ **选什么**（RabbitMQ / Kafka / RabbitMQ Streams / quorum 队列）→ **一句话依据**。列满 6 行。然后翻回 §4.5 的决策树对照，看你漏了哪条、判反了哪条。

**提示（卡住再展开）**

主线还是那句话：消息要不要**留存可重放**、路由要不要**broker 端做**、吞吐是不是**极端高**。这三个问题几乎能定位到所有选择。"绝不丢"是正交维度——它决定 queue 类型（quorum），不决定 RabbitMQ vs Kafka。

## § 全部答案（先做完再展开）

**展开全部答案**

### 概念层

1. 不需要队列名。它指定的是 **exchange 名 + routing key**。消息进哪些队列由 binding 决定，生产者不感知队列——这是"发布/路由解耦"。
2. direct 比"routing key 是否等于 binding key"；topic 比"routing key 是否匹配 binding key 的通配模式"。**fanout 和 headers 不看 routing key**：fanout 广播给所有绑定队列，headers 改用消息头属性匹配。
3. 不能。`*` 只匹配**一个**单词，`auth.login.error` 是三个单词。要匹配"任意前缀 + `.error`"，用 `#.error`（`#` 匹配零或多个单词）。
4. 不能共享。根因在**帧层**：每帧带 channel 编号、同一 channel 的帧严格有序串行处理；多线程并发写同一 channel 会让帧交错，broker 解析出错。一线程一 channel，连接可共享。
5. broker **永久删除**这条消息，不留记录。Kafka 提交 offset 只是移动读指针，消息仍在日志里、可被任意消费者按 offset 重读。RabbitMQ 没有 offset、没有重放（除非用 stream 队列）。

### 原理层

6. publisher confirms 防"发送端→broker"这段：broker 确认已接管（已路由、持久化消息已落盘流程已启动）才回 confirm，否则发送方知道要重发。consumer ack 防"broker→消费端"这段：处理成功才 ack，broker 才删除。少了 confirms，消息没进 broker 就丢且发送方不知情；少了手动 ack（用了 auto-ack），消费者崩溃时消息已被删、直接丢失。
7. durable 保护**队列/exchange 定义**在 broker 重启后还在（实体属性）；persistent（`delivery_mode=2`）保护**消息**被写盘（消息属性）；quorum 保护消息在**节点宕机**后还在（多副本）。classic 队列即便 durable+persistent，在发 confirm **之前不 fsync**，崩溃落在写盘缓冲窗口内就丢——这正是 quorum（Raft 多数派提交后才 confirm）存在的理由。
8. 无限大：一个消费者把整队列消息全抓到本地，内存爆掉、其它消费者闲着，崩溃时大批消息重投。设成 1：每处理一条要等一个完整往返，吞吐被 RTT 卡死（125ms RTT 下约 8 msg/s）。合理值 ≈ 往返时间 / 单条处理时间，常从 10–50 起调，消费者慢或多则调低。
9. 一次 publish = 一个 **method frame**（Basic.Publish，RPC 意图）+ 一个 **content-header frame**（消息属性、body 大小）+ 一个或多个 **content-body frame**（消息体，按 frame\_max 切分）。每个 frame 头部都带 2 字节 **channel 编号**，broker 靠它把交错的帧还原成各 channel 独立的会话——这就是多路复用的根。
10. 不对。每个队列是**一个 Erlang 进程**，所有工作串行过它的信箱，被钉在约一个调度器/核上。单队列吞吐有天花板，加核数也抬不动。提升靠**拆更多队列**（consistent-hash exchange、分片），不是换更大的机器。
11. 所有**发布连接**被阻塞（集群范围），**消费连接不受影响**。是**阻塞**（让发布方停下来），不是丢弃或换页——broker 宁可卡住生产者也不丢消息。一个发布者把内存顶到水位，会连累集群里所有发布者。
12. quorum 队列的 confirm 在消息**提交到多数派副本**（N/2+1）之后才返回。每个 quorum 队列是一个独立的 Raft 组（一 leader 多 follower、复制 WAL），leader 挂了选新 leader、重新加入的节点从自己的日志位置续上。它用**共识算法**取代了镜像队列那套自研的、副本常不同步的链式复制——后者在分区时行为未定义、会真丢消息。

### 判别层

13. **Kafka 更顺手。**三个独立消费者各读全量 + 数仓要重跑历史 = 重放与多消费者独立 offset，正是日志的主场。坚持 RabbitMQ 的话：经典/quorum 队列消息 ack 即删、无法重跑历史——缺口在**重放**。补法是改用 **RabbitMQ Streams**（非破坏性消费、按 offset 重读），但要接受它吞吐不及 Kafka，且没有 TTL/DLX/优先级那套队列语义。
14. RabbitMQ：用 **consistent-hash exchange** 把"同一订单"路由到固定的一个队列，该队列配**单活消费者**（single active consumer）保证串行——代价是单订单串行、并行度受队列数限制（单队列吞吐天花板，§3.2）。Kafka：用**订单 ID 作 partition key**，同一订单进同一 partition、partition 内有序，并行度 = partition 数——代价是 partition 数定死了最大并行度、扩容要重分区。
15. 三处一起配：① 队列类型用 **quorum**（Raft 多副本，多数派提交才确认）；② 发送端开 **publisher confirms**、消息 persistent，confirm 没回来就重发（注意幂等）；③ 消费端用**手动 ack**，处理成功再 ack。三者缺一：classic 队列会在崩溃窗口丢、无 confirms 发送段会丢、auto-ack 消费段会丢。
16. **RabbitMQ。**请求-响应、低延迟、低量正是它的主场：broker 推送（push）省去消费者轮询的等待，低负载下 p99 可到亚毫秒。Kafka 是拉模型（pull）+ 为吞吐做的批量，单条消息要等 fetch/批处理，低量时**延迟反而更高**。Kafka 的强项是吞吐，不是单条延迟。RPC 还能用 RabbitMQ 的 reply-to + correlation-id 直接搭。
17. **诊断**：这是毒消息——某条消息每次消费失败、被 nack 后又 requeue 回队头，无限重投占满 CPU，并堵住队头让后面的消息也出不来。**修复**：给队列配 **dead-letter exchange** + 设**重试上限**（quorum 队列默认 `delivery-limit=20`），超限后消息进死信队列而不是继续 requeue；消费端对"必然失败"的消息用 `basic.reject`/`nack(requeue=false)` 直接打入死信，再离线排查。根因回到 §1.4：requeue 把消息送回队列、断连/ nack 触发重投。

### 本章参考

- [Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms)（官方）
- [Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues)（官方）
- [When to use RabbitMQ or Kafka](https://www.cloudamqp.com/blog/when-to-use-rabbitmq-or-apache-kafka.html)（CloudAMQP）
- [RabbitMQ vs Kafka 系列](https://jack-vanlightly.com/blog/2017/12/4/rabbitmq-vs-kafka-part-1-messaging-topologies)（Jack Vanlightly）

