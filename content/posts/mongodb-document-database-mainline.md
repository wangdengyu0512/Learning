---
title: MongoDB：把文档数据库还原成一条主线
description: 从关系型工程师视角，把文档模型、查询聚合、索引与 Schema、WiredTiger、副本集、一致性和分片串成一条完整主线。
date: 2026-10-06
tags: MongoDB, 文档数据库, 数据库设计, 分布式系统
featured: false
---

> **核心结论**：MongoDB 的 schema 首先是访问模式的函数，而不是数据逻辑结构的函数。一起读取、一起更新且有界的数据，才适合放进同一个文档。

关系型数据库习惯从“数据如何规范化”出发，再用 JOIN 在查询时把信息拼回来；MongoDB 则把方向反过来：先确认系统怎样读取和写入，再决定文档边界。顺着这条主线，BSON、16MB 上限、`$lookup`、复合索引、WiredTiger、副本集、读写关注和 shard key 就不再是互不相干的知识点。

> 本文内容基于目录中的原始教程整理，基线为 MongoDB 8.0。示例使用 `mongosh` 语法；原教程未连接真实实例逐条验证，因此应将代码视为便于理解机制的示例，而不是已经通过集成测试的生产脚本。

## 目录

- [导读：先换掉关系型直觉](#guide)
- [第 1 章：文档模型与 BSON](#chapter-01)
- [第 2 章：查询与聚合管道](#chapter-02)
- [第 3 章：索引与 Schema 设计](#chapter-03)
- [第 4 章：WiredTiger 存储引擎](#chapter-04)
- [第 5 章：副本集与一致性](#chapter-05)
- [第 6 章：分片与选型](#chapter-06)
- [附录：自测题库](#chapter-07)

---
<a id="guide"></a>

## 导读：先换掉关系型直觉

基于 MongoDB 8.0（2024-10 GA），覆盖文档模型、查询与聚合、索引与建模、WiredTiger 存储引擎、副本集与一致性、分片与选型。代码示例为 `mongosh` 语法，未在本机连真实实例验证——视为可读的伪运行，而非测试通过的脚本。

<a id="who"></a>

### 适合谁

这份教程为**已经熟悉关系型数据库的后端工程师**写。它默认你能做到以下三件事——如果不能，先补这一项再回来：


**前置能力（具体到动作）**

- 能在 PostgreSQL 或 MySQL 里写多表 JOIN，并读懂 `EXPLAIN` 输出里的 seq scan / index scan / nested loop。
- 能说清 B-tree 索引为什么能把范围查询从 O(n) 降到 O(log n)，以及为什么写入要付索引维护的代价。
- 理解 WAL / redo log 和 MVCC 的基本作用：为什么"提交成功"要先落日志，为什么读不阻塞写。

<a id="not-who"></a>

### 不适合谁

两类读者请换一份资源，会更高效：

- **没碰过数据库的初学者**——本教程不解释"什么是索引""什么是事务",而是直接对比 MongoDB 与关系型在这些点上的差异。先到 [MongoDB University](https://learn.mongodb.com/) 的免费入门课建立基线。
- **要深挖 WiredTiger 源码或分布式协议形式化证明的人**——本教程讲到"比官方文档深一层"的机制为止；再往下请读 [repl/README](https://github.com/mongodb/mongo/blob/master/src/mongo/db/repl/README.md)、[WiredTiger 架构文档](https://source.wiredtiger.com/) 与 [Jepsen 分析](https://jepsen.io/analyses/mongodb-4.2.6)。

<a id="outcomes"></a>

### 读完之后你能做到什么

核心收获，一句话：**在"该用 MongoDB 还是关系型"这个决策上，你不再按"数据长得像不像表"来判断，而是按"访问模式是否稳定、是否以单个文档为读写单位"来判断；并能把文档模型、`$lookup` 的代价、读写关注、shard key 选择，全部还原到同一条主线上。**这是官方文档不会替你串起来的那条线。

具体地，读完你能：

- 给一个真实需求，**决定字段该嵌入还是引用**，并说出判据（访问是否同时发生、是否无界增长、是否独立写入）。
- 读一条慢聚合，**判断瓶颈是缺索引、`$lookup` 嵌套循环、还是 `$sort` 溢出**，而不是笼统地说"性能问题"。
- 给定写入模式，**选出不会造成热分片的 shard key**，并解释为什么单调递增键会把负载压到一个分片。
- 配置 `writeConcern` 与 `readConcern`，**说清一次写入在什么条件下会丢、在什么条件下读到的是旧值**。
- 在选型评审里，**诚实地说出 MongoDB 不该用在哪**（重多实体事务、复杂即席 JOIN、强关系约束）。


**一句话本质**

- **在 MongoDB 里，schema 是"访问模式"的函数，不是数据逻辑结构的函数——一起被读取的数据就该存在一起。**

关系型从数据的逻辑结构出发，靠范式化消除冗余，靠 JOIN 在查询时重新拼装。MongoDB 反过来：从查询怎么读出发，把一起读的数据预先拼好存进一个文档。理解了这一条，后面的一切——为什么推荐反范式、为什么 `$lookup` 被劝退、为什么 16MB 上限在约束你的设计——都不再是孤立的规则。

现状速览 · 截至 2026-06

**稳定可放心学**：文档模型、WiredTiger 存储引擎、副本集、分片、聚合管道——核心自 4.2–5.0 起稳定。
**近期在变（带日期）**：MongoDB 8.0（2024-10 GA）把查询执行默认切到 SBE（slot-based execution engine），加了 Express 点查快路径、config shard、可查询加密的范围查询；官方称读吞吐较 7.0 提升约 36%。
**已成过去式，别再学旧做法**：`mongo` 旧 shell（6.0 移除，改用 `mongosh`）、MMAPv1 存储引擎（4.2 移除）、默认 `w:1` 写关注（5.0 起默认 `w:majority`）、map-reduce（5.0 弃用，用聚合管道）。
**许可证**：SSPL（2018 起，非 OSI 认可的开源），影响自托管再分发与发行版打包决策。

读之前 · 流畅感是假象

这份教程会刻意让你卡住——因为"读着顺"不等于"学会了"。带着关系型经验读 MongoDB 尤其危险：很多概念名字相同（索引、事务、复制），机制却不同，熟悉感会盖住差异。出现这三句内心独白时请停下：

· **"我读得很顺"**——你十有八九还在用关系型的旧 schema 套新词，没真正换模型。
· **"我做题很快"**——往往只是在背 API，没有在"嵌入还是引用"这种判别题上卡过。
· **"我没卡壳"**——真正的核心概念（为访问模式建模、持久性≠可见性）会让人卡；没卡说明还没碰到它。

<a id="map"></a>

### 概念地图

八个概念，一条自上而下的依赖链。先把这张图记在脑子里，后面每一章都挂在它的某个节点上。

![MongoDB 概念地图：文档模型在顶端，向下依赖到查询聚合、索引、schema 设计，再到 WiredTiger 存储，再到副本集与分片，最后汇到选型](/blog-assets/mongodb-mainline/intro-diagram-01.svg)

*图 0 八个概念的依赖链，自上而下读。 注意 ：索引和 schema 设计之间那条"同一决策"虚线——在关系型里它们是两件事（先建表再调索引），在 MongoDB 里建模时就得同时决定索引，这是那条核心原则在结构上的投影。*

<a id="paths"></a>

### 三条学习路径

按你来的目的选一条，不必从头读到尾：

表 0 · 分场景路径

| 你的目的 | 建议路径 | 可跳过 |
| --- | --- | --- |
| 只想换对脑子里的模型（为什么文档库不是"无 schema 的表"） | 01 → 03 → 07 | 04 / 05 / 06 的分布式细节 |
| 做技术选型 / 评审（该不该上 MongoDB） | 01 → 06 → 07 的判别题 | 02 的聚合 stage 细节 |
| 排查线上慢查询 / 数据一致性问题 | 02 → 04 → 05 | 03 的设计模式枚举 |

<a id="next"></a>

### 学完之后

这份教程画的是 MongoDB 的核心心智模型。再往外走，下面几个主题会在你的 schema 上各加一块：

- **Atlas Search / Vector Search**——把全文检索和向量检索做进数据库；在你已有的"文档+聚合"模型上加一个 `$search` stage。（本教程刻意没讲，留给你的 [vector-database 教程](https://zhiwenliang.github.io/learning/vector-database/index.html)衔接。）
- **Change Streams**——基于 oplog 的变更订阅，把第 05 章的复制机制变成可消费的事件流。
- **时序集合（Time Series Collections）**——5.0 起的列式存储集合，把第 04 章的存储模型专门优化给写多读聚合的时序数据。
- **Queryable Encryption**——在加密状态下做相等 / 范围查询，把安全边界推进到数据库内部。

#### 总参考

- [MongoDB Manual](https://www.mongodb.com/docs/manual/)（官方文档，本教程的基线）
- [mongodb/mongo · repl/README](https://github.com/mongodb/mongo/blob/master/src/mongo/db/repl/README.md)（复制协议设计文档）
- [WiredTiger 架构文档](https://source.wiredtiger.com/)（存储引擎机制）
- [MongoDB 8.0 Release Notes](https://www.mongodb.com/docs/manual/release-notes/8.0/)（现状速览来源）
- [Jepsen: MongoDB 4.2.6](https://jepsen.io/analyses/mongodb-4.2.6)（一致性边界的独立分析）

---

<a id="chapter-01"></a>

## 第 1 章：文档模型与 BSON

起点页给了一句话本质："schema 是访问模式的函数"。这章把这句话落到具体形状上——文档、集合、BSON、`_id`、16MB 上限——并讲清这一条如何反转关系型工程师的范式化本能。

**本章你将建立的 schema**

- 文档 / 集合 / BSON 是什么，和"行 / 表 / JSON"差在哪个机制点上。
- `_id` 的三条硬规则：强制、不可变、自动唯一索引；ObjectId 为什么能客户端生成。
- 16MB 文档上限不是限制，是建模信号——它在告诉你访问模式何时错了。
- "为访问模式建模"如何把建模方向从"结构 → 查询"翻转成"查询 → 结构"。

<a id="s11"></a>

### 1.1 文档与集合：BSON，不是 JSON

文档是一条 BSON 记录，集合是一组文档；集合不强制所有文档同构。

为什么需要它

关系型把一个实体拆到多张表，靠外键和 JOIN 在查询时重新拼装。文档模型允许把"总是一起被使用的数据"放进一条记录，读取时不必重组。代价转移了——不是消失了——后面几节会逐一还账。

**底层机制（比文档深一层）**：文档不是以文本 JSON 存储，而是以 **BSON**（Binary JSON）存储。差别是机制性的：BSON 给每个字段带上**类型标记和长度前缀**，所以引擎能在不解析整个文档的前提下跳过某个字段、直接定位到一个嵌套路径。这也是为什么 BSON 能表达 JSON 没有的类型——`ObjectId`、`Decimal128`（精确十进制，给钱用）、`Date`（64 位毫秒）、`Binary`、区分 32/64 位整数。它的代价同样是机制性的：BSON 每个文档都**各自存一份字段名**（没有表头共享字段名），所以同样的数据，文档存储通常比规范化的行占更多空间，短字段名能省下可观的量。

类比 · 带边界

文档像一份排好版的"订单详情打印页"——所有相关信息已经摆在一页上。关系型像把同样信息拆进档案柜的不同抽屉，看一次详情要开好几个抽屉。**类比失效处**：文档不是冻结的纸，你可以原子地只更新其中一个字段（`$set` 单字段），不必重写整页。

下面是同一个"订单详情"在两种模型里的样子。先看摆放，再看读取代价。

![左侧关系型用 users/orders/order_items 三张表加外键，右侧 MongoDB 用一个内嵌文档](/blog-assets/mongodb-mainline/01-diagram-01.svg)

*图 1.1 同一份订单详情的两种摆法。 注意 ：右侧不是"把三张表塞进一个字段"，而是按"详情页总是一起读 customer 和 items"这个访问事实，把它们预拼进一个文档——摆放是被查询决定的。*

```javascript
// 一条文档就装下了关系型里要跨 3 张表的数据
db.orders.insertOne({
  _id: ObjectId("665f1a2b3c4d5e6f70819200"),
  total: 248.00,                       // Decimal 应该用 NumberDecimal，演示从简
  status: "paid",
  customer: { name: "Lin", tier: "gold" },   // 内嵌子文档
  items: [                                    // 内嵌数组
    { sku: "A-12", qty: 1, price: 199.0 },
    { sku: "B-07", qty: 1, price: 49.0 }
  ]
})

// 读详情：一次按 _id 命中，无 JOIN
db.orders.findOne({ _id: ObjectId("665f1a2b3c4d5e6f70819200") })
```

想一想

如果把"该用户的全部历史订单"也嵌进 `customer` 里，随着用户不断下单，这个文档会发生什么？

**展开答案（先停 10 秒）**

文档会**无界增长**，逐步逼近 16MB 上限；更糟的是，每次读这个用户（哪怕只想看名字）都会把全部历史订单一起载入内存。这正是经典反模式——嵌入只适合**有界**的、**总是一起读**的数据。历史订单数量无界、且常被独立查询，应当**引用**而非嵌入（§1.4 给判据，03 章给完整决策）。

<a id="s12"></a>

### 1.2 _id 与 ObjectId

每个文档必须有唯一且不可变的 `_id`；省略时引擎自动生成一个 12 字节 ObjectId。

为什么需要它

`_id` 是主键，且自动带一个唯一索引（你删不掉这个索引）。它要解决的问题和关系型主键一样——唯一标识一行——但多了一个分布式诉求：在没有中心协调者的情况下，多个客户端能各自生成不冲突的 ID。

**底层机制（比文档深一层）**：默认的 ObjectId 是 12 字节，结构是 **4 字节时间戳 + 5 字节随机值 + 3 字节自增计数器**。关键在于：这 12 字节**由客户端驱动生成**，不需要往返数据库去取一个自增序号（对比 MySQL `AUTO_INCREMENT` 要数据库分配、或 Postgres sequence 要中心计数器）。代价藏在第一段：因为前 4 字节是时间戳，ObjectId **大致随生成时间单调递增**。这带来一个好处和一个陷阱——好处是按 `_id` 排序近似按时间排序；陷阱是如果直接拿 ObjectId 当 shard key，新写入会全落到"最大值"所在的那个分片，造成热点（06 章会还这笔账）。

![ObjectId 的 12 字节布局：4 字节时间戳、5 字节随机值、3 字节计数器](/blog-assets/mongodb-mainline/01-diagram-02.svg)

*图 1.2 ObjectId 的字节布局。 注意 ：被高亮的是头部时间戳——它既是"客户端无协调生成又能粗略排序"的来源，也是单调递增 shard key 陷阱的根源。同一个设计，一面是优点一面是代价。*

想一想

两个问题：(a) 已经写入的文档，能改它的 `_id` 吗？(b) 两个不同集合里能存在相同的 `_id` 吗？

**展开答案**

(a) **不能**。`_id` 不可变；要"改"只能删除旧文档再插入新的。(b) **能**。唯一性约束是**集合级**的，每个集合是独立命名空间，`users` 和 `orders` 各有一个 `_id: 1` 互不冲突。

<a id="s13"></a>

### 1.3 16MB 上限：不是限制，是信号

单个 BSON 文档最大 16MB；与其把它当成需要绕过的限制，不如当成建模出错的报警。

为什么需要它

这个上限防止单文档无界增长拖垮两个地方：内存（WiredTiger 以整个文档为载入单位，04 章）和网络传输。它不是任意拍脑袋的数字，而是一道护栏。

**底层机制（比文档深一层）**：MongoDB 读写的最小单位是**整个文档**，不是文档里的某个片段。一次 `findOne` 把整文档读进 WiredTiger cache；一次更新（哪怕只改一个字段）在存储层也要重写整个文档版本（04 章的 MVCC 会讲）。所以一个臃肿的大文档被频繁读取时，会把 cache 里的热数据挤出去，引发更多磁盘读。由此，16MB 上限的真正含义是一句话：**当你的文档在逼近 16MB，你的访问模式已经错了**——几乎总是因为把一个无界数组（评论流、事件日志、历史记录）嵌进了文档。需要存超大二进制（视频、大文件）时用 **GridFS** 把它分块成多条文档，而不是硬塞。

陷阱

"反正 16MB 很大，先嵌着，撞上限再说"——这是把一个建模信号当噪音忽略。等真撞上限时，往往已经有大量超大文档拖垮了 cache 命中率，性能问题在撞上限*之前*很久就出现了。把它当成"数组该有界"的早期提醒，而不是终点线。

想一想

一个 IoT 设备每秒产生一条读数，你把读数嵌进设备文档的一个数组里。假设每条读数约 200 字节，大约多久撞上 16MB？这说明什么？

**展开答案**

16MB ÷ 200B ≈ 8 万条，每秒一条约 **22 小时**就撞上限。结论不是"调大上限"（不能调），而是"**设备 + 时间窗**才是正确的文档粒度"——把读数按小时/天分桶存成多条文档（这正是 03 章的 Bucket 设计模式，也是时序集合背后的思路）。无界的时间序列**从来**不该整段嵌进一个文档。

<a id="s14"></a>

### 1.4 为访问模式建模：方向翻转

先确定查询怎么读，再决定文档怎么放——schema 是访问模式的函数，这是全教程最该先内化的一条。

为什么需要它

这是从关系型迁移过来最大的认知翻转，也是最容易"读着顺、用着错"的地方。范式化（3NF）优化的目标是**写入与一致性**：每个事实只存一处，更新无需同步多处。文档建模优化的目标是**读取**：一起读的数据放一起，读取无需重组。两者不是"谁更先进"，是优化目标不同。

**底层机制（比文档深一层）**：为什么不能沿用关系型的"先规范结构、查询时再 JOIN"？因为 MongoDB 没有关系型那种高效的跨表 JOIN——`$lookup` 本质是**嵌套循环**（02 章会拆开看），数据量一大代价陡增。既然查询期拼装很贵，就把拼装**提前到建模期**：列出最高频的几个查询 → 看哪些数据总是被一起读 → 把它们嵌进同一个文档。代价诚实地摆在这里——反范式带来**冗余**和**更新放大**（同一个事实存在多个文档里，更新要改多处）。你是在用"写入复杂度"换"读取简单度"。值不值，取决于读写比和访问模式是否稳定。

![两条泳道对比建模方向：关系型从数据结构出发到查询时 JOIN，文档从访问模式出发到单次读取](/blog-assets/mongodb-mainline/01-diagram-03.svg)

*图 1.3 建模方向的翻转。 注意 ：两条泳道的 起点 不同——关系型从"数据本身长什么样"起步，文档从"查询要怎么读"起步。被高亮的左下角"访问模式"是整条链的源头，这就是"为访问模式建模"的字面意思。*

把这条原则压成一个可操作的判断序列，遇到"这个字段放哪"时走一遍：

表 1.1 · 嵌入 vs 引用的初判（03 章给完整版）

| 问自己 | 倾向嵌入 | 倾向引用 |
| --- | --- | --- |
| 这块数据和主体总是一起被读吗？ | 是 → 嵌入 | 否，常被单独查 → 引用 |
| 它会无界增长吗？ | 有界（如地址、几个标签）→ 嵌入 | 无界（评论、订单、事件）→ 引用 |
| 它被多个不同实体共享吗？ | 否，专属于主体 → 嵌入 | 是（如商品被多订单引用）→ 引用 |
| 它和主体的写入时机一致吗？ | 一起写 → 嵌入 | 各自独立高频写 → 引用 |

想一想

一个博客系统：文章（post）有作者（author）和评论（comments）。按上表，author 和 comments 各该嵌入还是引用？

**展开答案**

**author 倾向引用**：一个作者被很多文章共享（共享判据命中），且作者资料独立更新；通常存 `authorId`，需要时再查。但若只展示"作者名"且几乎不变，把 `{name}` 冗余嵌进 post 也合理（用读取简单度换一点冗余）——这正是"看访问模式"而非"看数据关系"。**comments 看量级**：评论无界增长（无界判据命中），且常分页独立加载，倾向引用到单独集合；只有"最多几条、总和文章一起显示"的场景才嵌入。注意这两个判断都没有唯一答案——它们取决于你的*读法*，不取决于数据本身。这正是为访问模式建模的含义。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. BSON 相比文本 JSON，多了哪一类机制性能力？举出它带来的一个具体好处和一个具体代价。
2. `_id` 的三条硬规则是什么？ObjectId 的 12 字节为什么能在客户端生成而不必访问数据库？
3. 16MB 上限"是信号不是限制"——这句话具体在提醒你检查什么？
4. （设计题）一句话说清：为什么把"先规范结构、查询时 JOIN"的关系型策略直接搬到 MongoDB 会代价高昂？

**答案（先做完再展开）**

1. 多了**带类型与长度前缀的二进制字段编码**（以及 ObjectId/Decimal128/Date/Binary 等类型）。好处：能不解析整文档就跳过字段、定位嵌套路径，并精确表达十进制金额。代价：每文档各存一份字段名，存储通常比规范化行更占空间，短字段名更省。
2. 强制存在、不可变、自带唯一索引。ObjectId = 4B 时间戳 + 5B 随机 + 3B 计数器，三段都能在客户端本地算出，无需向数据库申请自增序号，因此天然适合分布式无协调生成。
3. 提醒你检查：是不是把一个**无界增长的数组**嵌进了文档。逼近上限几乎总意味着访问模式选错了粒度，该改成分桶/引用。
4. 因为 MongoDB 的跨文档 `$lookup` 是嵌套循环、没有关系型那种高效 JOIN；查询期拼装很贵，所以要把拼装提前到建模期（嵌入），否则就是在最贵的路径上反复付费。

进阶挑战 · 刚好够不着

#### 给一个二手交易 App 设计 listing（商品）文档

需求：商品列表页要展示标题、价格、卖家昵称和头像；商品详情页额外展示卖家信用分、最近 3 条买家评价、以及该商品的全部问答（数量无界，常被翻页加载）。先不查任何资料，写出你的文档结构，并对每个"嵌入还是引用"的决策标注判据。

**提示（卡住再展开）**

分三类想：(1) 卖家昵称+头像——列表页高频读、几乎不变 → 适合**冗余嵌入**少量字段（用一点冗余换列表页零 JOIN）；(2) 卖家信用分——会变、且多个商品共享同一卖家 → **引用**，详情页再查；(3) 问答——无界增长 + 翻页独立加载 → 一定**引用**到单独集合，按 `listingId` 关联。"最近 3 条评价"是个有趣的中间态：可以用 Subset 模式冗余存最近 3 条、其余引用（03 章）。

#### 本章参考

- [Documents](https://www.mongodb.com/docs/manual/core/document/)（官方 · 文档结构与 BSON 类型）
- [BSON Specification](https://bsonspec.org/)（BSON 二进制格式规范）
- [ObjectId](https://www.mongodb.com/docs/manual/reference/method/ObjectId/)（官方 · 12 字节结构）
- [Data Modeling Introduction](https://www.mongodb.com/docs/manual/data-modeling/)（官方 · 嵌入 vs 引用）

---

<a id="chapter-02"></a>

## 第 2 章：查询与聚合管道

01 章建立了文档模型和"为访问模式建模"的原则。这章讲怎么把数据读出来——`find` 查询与聚合管道——并拆开 `$lookup`，看清它为什么不是关系型那种 JOIN。

**本章你将建立的 schema**

- `find` + 查询操作符 + 投影的心智模型，对照 SQL 的 WHERE / SELECT。
- 聚合管道是有序的 stage 流水线，而非声明式集合运算。
- `$lookup` 本质是嵌套循环，不是 hash / merge JOIN——它为什么贵。
- 查询如何执行：多计划竞速 + plan cache + SBE / Express。

<a id="s21"></a>

### 2.1 find 与查询操作符

`find` 按文档匹配条件返回文档集，投影裁剪字段；对应 SQL 的 WHERE + SELECT。

为什么需要它

读取是数据库最高频的操作。`find` 是单集合查询的入口——给一个匹配条件（filter），引擎返回所有满足条件的文档；再给一个投影（projection），引擎在返回前裁掉不需要的字段，减少网络与内存开销。两个参数对应关系型 `SELECT <projection> FROM coll WHERE <filter>` 的两半。

**底层机制（比文档深一层）**：filter 由**比较操作符**构成——`$eq` / `$gt` / `$gte` / `$lt` / `$in`，逻辑组合用 `$and` / `$or`。对标量字段这些操作符的语义和 SQL 一致。陷阱出现在**数组字段**：当一个字段是数组，`{results: {$gt: 80, $lt: 90}}` 的判定不是"存在一个元素同时满足两条件"，而是"数组里**分别**有元素满足 `$gt: 80`、**分别**有元素满足 `$lt: 90`"。所以 `results: [95, 70]` 会命中——因为 `95 > 80` 成立、`70 < 90` 成立，两个条件各被数组里不同的元素满足。要表达"**同一个**元素同时落在 (80, 90) 区间"，必须用 `$elemMatch`：`{results: {$elemMatch: {$gt: 80, $lt: 90}}}` 才会把 `[95, 70]` 排除掉。这是数组查询最常见的误解。

投影用 1 / 0 表达包含或排除：`{title: 1}` 只返回 `title`（外加默认带上的 `_id`），`{body: 0}` 返回除 `body` 外的全部字段。包含与排除不能在同一个投影里混用（`_id` 是唯一例外，允许 `{title: 1, _id: 0}` 这样显式排除主键）。

```javascript
// 等值 + 范围 + IN，配投影只取需要的字段
db.students.find(
  { grade: "A", score: { $gte: 80, $lt: 90 }, city: { $in: ["SH", "BJ"] } },
  { name: 1, score: 1, _id: 0 }     // 只返回 name 和 score，排除 _id
)

// 数组字段的陷阱：results 是一个分数数组
// 这条会命中 results:[95,70]——95>80 与 70<90 分别由不同元素满足
db.exams.find({ results: { $gt: 80, $lt: 90 } })

// 要求"同一个元素"落在 (80,90)，必须用 $elemMatch——它会排除 [95,70]
db.exams.find({ results: { $elemMatch: { $gt: 80, $lt: 90 } } })
```

表 2.1 · MongoDB find ↔ SQL 对照

| 意图 | MongoDB find | SQL |
| --- | --- | --- |
| 等值 | `{status: "paid"}` | `WHERE status = 'paid'` |
| 范围 | `{score: {$gte: 80, $lt: 90}}` | `WHERE score >= 80 AND score < 90` |
| IN | `{city: {$in: ["SH","BJ"]}}` | `WHERE city IN ('SH','BJ')` |
| 投影 | `find(filter, {name: 1, _id: 0})` | `SELECT name` |

想一想

集合里有文档 `{scores: [50, 99]}`。查询 `db.coll.find({scores: {$gte: 70, $lte: 80}})` 会不会返回它？换成 `$elemMatch` 包裹同样两个条件呢？

**展开答案（先停 10 秒）**

不带 `$elemMatch` **会返回**：因为 `99 >= 70` 成立、`50 <= 80` 成立，两个条件各由数组里不同的元素满足，文档即命中——尽管没有任何单个元素落在 [70, 80] 区间。换成 `{scores: {$elemMatch: {$gte: 70, $lte: 80}}}` 后**不会返回**：`$elemMatch` 要求**同一个**元素同时满足全部条件，而 50 和 99 都不在 [70, 80] 内。凡是对数组字段写多条件，先问一句"要的是同一个元素吗"。

<a id="s22"></a>

### 2.2 聚合管道

聚合管道是一串有序 stage，每个 stage 把文档流变换后喂给下一个。

为什么需要它

`find` 只能匹配和投影，做不了分组、汇总、跨集合关联、重塑结构。聚合管道（aggregation pipeline）补齐这部分——它是 MongoDB 的分析与变换引擎，能力对标 SQL 的 `GROUP BY` / `JOIN` / 窗口与子查询的组合。

**底层机制（比文档深一层）**：管道是一个 stage 数组，文档流从第一个 stage 进、逐个 stage 流过、从最后一个 stage 出。核心 stage 各司其职：

- `$match` — 过滤文档，语义同 `find` 的 filter；**尽量前置**。
- `$group` — 按 `_id` 表达式分组，配累加器 `$sum` / `$avg` / `$push`（收集进数组）/ `$addToSet`（去重收集）。
- `$project` — 重塑字段：保留、重命名、计算派生值。
- `$unwind` — 把一个数组字段**炸开**成多条文档，数组里每个元素生成一条。
- `$sort` — 排序。
- `$lookup` — 对右集合做左外连接（§2.3 拆开它）。
- `$facet` — 一份输入并行跑多个子管道，各自独立产出。
- `$bucket` / `$bucketAuto` — 按边界把文档分桶，做直方图。

关键机制对照 SQL：SQL 是**声明式**的，写 `WHERE` / `GROUP BY` / `ORDER BY` 不规定执行顺序，由查询优化器决定怎么跑。管道是**过程式**的，stage 顺序由编写者**显式写出**，引擎原则上按写定的顺序执行——但优化器仍会做**有限重排**，最典型的是把 `$match` 向前下推到尽量靠前的位置，以减少后续 stage 需要处理的文档数。把 `$match` 和 `$project` 写在尽早的位置，等于亲手缩小下游每个 stage 的输入——这是管道性能的第一直觉。

```javascript
// 已支付订单，按客户等级汇总总额，再按总额降序
db.orders.aggregate([
  { $match: { status: "paid" } },                    // 先过滤，缩小下游输入
  { $group: {
      _id: "$customer.tier",                          // 按嵌套字段分组
      revenue: { $sum: "$total" },                    // 累加订单金额
      orders:  { $sum: 1 }                            // 计数
  } },
  { $sort: { revenue: -1 } }                          // 总额从高到低
])
```

![聚合管道横向流水线：documents 经 match group sort project 到结果，流出文档数逐级递减](/blog-assets/mongodb-mainline/02-diagram-01.svg)

*图 2.1 聚合管道是横向流水线，文档逐 stage 变换。 注意 ： $match 越早，后面 stage 处理的文档越少——这是管道唯一最重要的优化直觉。*

<a id="s23"></a>

### 2.3 $lookup 的真相：嵌套循环

`$lookup` 是对左侧每个输入文档去右集合查一次的嵌套循环，不是 hash / merge JOIN。

为什么需要它

引用式建模（01 章）把数据拆到多个集合，读取时需要关联。`$lookup` 是聚合管道里做跨集合关联的 stage，语义是**左外连接**：左侧每个文档保留，匹配到的右侧文档作为一个数组字段附加上去。能力像 SQL 的 `LEFT JOIN`，但执行机制完全不同——这个不同决定了它的代价。

**底层机制（比文档深一层）**：对左侧管道流入的**每一个**文档，`$lookup` 取出 `localField` 的值，到右集合按 `foreignField` 查找匹配。这是一个**嵌套循环**：外层遍历左侧 N 个文档，内层每次去右集合查一遍。如果 `foreignField` **没有索引**，内层每次查找都是一次右集合**全扫描**，整体复杂度 `O(N × M)`（N 是左侧文档数，M 是右集合大小）。对比关系型——优化器会按数据量和统计信息**按代价选择** hash join 或 merge join，复杂度通常是 `O(N + M)` 量级，而不是乘积。

所以 `$lookup` 要快，只有三条路：(a) 给 `foreignField` **建索引**，把内层每次全扫描降为索引查找；(b) 在 `$lookup` **之前**用 `$match` 把左侧 N 缩小，直接砍掉外层循环次数；(c) 多数时候——回到 01 章那条主线（为访问模式建模），干脆把数据**嵌入**避免 JOIN。这正是为什么 MongoDB 的文档建模反复劝你"别把关系型范式直接搬过来"：范式化在一个**没有廉价 JOIN** 的系统里，等于把代价从写入期推到了每一次读取期。

![lookup 嵌套循环：左侧 N 个文档每个都对右集合触发一次全扫描](/blog-assets/mongodb-mainline/02-diagram-02.svg)

*图 2.2 $lookup 的嵌套循环：左侧 N 个文档，每个都对右集合发起一次查找。 注意 ：左侧 N 翻倍，右侧扫描就翻倍—— $lookup 的代价随数据量超线性，这是它和 SQL JOIN 最本质的差别。*

想一想

同一个 `$lookup`，把 `$match` 放在它**之前**和放在它**之后**，性能差别有多大？

**展开答案**

差别可以是数量级。放**之前**：先把左侧输入从百万缩到几十，嵌套循环的外层次数同比下降，右集合查找只发生几十次。放**之后**：引擎先对全部百万左文档做完整的嵌套循环 JOIN，再把结果过滤掉绝大部分——白白为最终不要的文档付了 JOIN 代价。结论：能下推到 `$lookup` 之前的过滤，一定下推；这也是优化器会自动尝试把 `$match` 前移的原因，但跨 `$lookup` 的重排并非总能自动完成，手写时就把它放对位置。

<a id="s24"></a>

### 2.4 查询如何执行：多计划竞速、plan cache、SBE

第一次见到某查询形状，优化器并行试跑多个候选计划选最优，缓存它供后续复用。

为什么需要它

同一个查询往往有多个可用索引、多种执行方式，代价天差地别。关系型靠**代价模型 + 统计信息**估算选计划；MongoDB 选了一条不同的路——**实测**。它不光估算，还真跑一小段来比较，这影响你怎么读 `explain`、怎么理解第一次慢、之后快的现象。

**底层机制（比文档深一层）**：对一个**新的查询形状**（query shape，filter 结构相同、具体值不同算同一形状），**multi-planner** 会为每个候选索引各建一个计划，把它们**并行试跑一小段 trial period**，按"产出最多结果、做最少工作"的标准评出胜者，存入 **plan cache**。之后相同形状的查询**直接复用**缓存里的胜出计划，跳过竞速。当集合统计变化、或缓存计划的实际表现退化到阈值之下，会触发 **replan**，重新竞速。这和关系型的 plan cache / prepared statement plan 扮演同一个角色——把"选计划"的成本摊销到多次执行上。

计划选定后由**执行引擎**跑。**SBE**（slot-based execution engine，5.1 引入）把执行计划编译成基于 **slot** 的算子树，stage 之间通过 slot 传值，**避免每个 stage 都物化一份中间 BSON 文档**，从而降低 CPU 与内存开销；经典的 classic engine 则在 stage 之间反复物化文档。8.0 还加了 **Express** 快路径，专门加速最简单的单集合点查（按 `_id` 或单字段等值），绕过完整的计划流程。对照关系型，这一层等价于把 prepared statement 编译成更紧凑的执行代码。

现状 · 版本陷阱

SBE 的默认状态**随版本反复变过**：5.1 引入并默认开启，但在 7.0 的某些补丁里因稳定性被**默认关闭**，直到 8.0（2024-10）才作为稳定默认重新开启。所以"在 5.x 学过 SBE"不代表它当时真在跑你的查询——判断某条查询走没走 SBE，看 `explain` 输出里的引擎标识，别凭版本号假定。

![multi-planner：一个新查询形状并行试跑多个候选计划，选胜者存入 plan cache 供后续复用](/blog-assets/mongodb-mainline/02-diagram-03.svg)

*图 2.3 multi-planner 竞速：新查询形状并行试跑候选计划，胜者进 plan cache。 注意 ：第一次执行多付了竞速代价，之后复用缓存才快——这就是"首次慢、随后快"的来源。*

洞见 · plan cache 会过期

plan cache 里的胜出计划是**按当时的数据分布**选出来的。数据漂移后（比如某个原本高选择性的字段值变得普遍），旧计划不再是最优，却仍被复用，直到表现退化触发 replan。排查"同一条查询昨天快今天慢"时，把 plan cache 失效 / replan 列为头号嫌疑，用 `explain` 看现在实际走的是哪个计划，而不是假定它还在用你上次看到的那个。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 对一个数组字段写多条件（如 `{a: {$gt: 1, $lt: 9}}`），它和 `$elemMatch` 包裹同样条件的判定差别是什么？各自会/不会命中怎样的数组？
2. 管道里为什么要把 `$match` 尽量前置？它影响的是下游的什么？
3. `$lookup` 在 `foreignField` 无索引时的复杂度是多少？给出两种把它降下来的具体做法。
4. （设计题）需求"按月统计每个商品类目的销售额"。描述你的管道 stage 顺序，并说明为什么这样排。

**答案（先做完再展开）**

1. 不带 `$elemMatch` 时，每个条件可由数组里**不同元素**分别满足——`[10, 0]` 会命中 `{a: {$gt: 1, $lt: 9}}`（10>1、0<9 各由一个元素满足），尽管没有元素落在 (1, 9)。`$elemMatch` 要求**同一个元素**满足全部条件，`[10, 0]` 不命中；只有像 `[5]` 这样含单个落区间元素的才命中。
2. 因为管道是过程式、按顺序处理文档流，`$match` 越早，后面每个 stage 要处理的**文档数**越少——直接决定 `$group` / `$sort` / `$lookup` 的工作量。优化器也会主动尝试把 `$match` 前移。
3. `O(N × M)`（左侧 N 文档 × 右集合 M，每个左文档触发一次右集合全扫描）。降法：(a) 给 `foreignField` 建索引，把内层全扫描变索引查找；(b) 在 `$lookup` 之前用 `$match` 缩小左侧 N。终极做法是建模时嵌入、根本不 JOIN。
4. 顺序：`$match`(限定时间窗，先砍输入) → `$group`(`_id` 为 {类目, 月份}，`$sum` 销售额) → `$sort`(按月或销售额排序) → 可选 `$project` 重塑输出。先 `$match` 是为了让 `$group` 只扫该时间窗的文档；分组键放 {类目, 月} 一次成型，避免后续再二次聚合。

进阶挑战 · 刚好够不着

#### 用聚合管道做一个三步漏斗分析

有一个用户事件集合 `events`，每条形如 `{userId, type, ts}`，`type` 取值 `view` / `add_cart` / `purchase`。求某时间窗内 `view → add_cart → purchase` 三步的转化率（每一步相对上一步的留存比例）。先不查资料，写出你的管道 stage 思路。

**提示（卡住再展开）**

一条主线：`$match` 限定时间窗（先砍输入）→ `$group` 按 `userId` 收集该用户出现过的事件类型（`$addToSet: "$type"`）→ `$project` 用 `$in` 算出每个用户是否达成各步（三个布尔字段）→ `$group`（`_id: null`）对三个布尔分别 `$sum` 求达成人数 → 末尾 `$project` 计算 `add_cart/view`、`purchase/add_cart` 两个比率。另一种写法：用一个 `$facet` 同时跑三个计数子管道（各自 `$match` 一种 type 再 `$group` 去重计数），一次输入出三个数字，最后在应用层或追加 stage 里相除。两种都对——前者按用户判定更贴"同一用户走完三步"的漏斗语义，后者更简单但算的是各步独立人数。

#### 本章参考

- [Aggregation Pipeline](https://www.mongodb.com/docs/manual/core/aggregation-pipeline/)（官方 · 管道与 stage 概览）
- [$lookup](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/)（官方 · 跨集合左外连接）
- [Aggregation Pipeline Optimization](https://www.mongodb.com/docs/manual/core/aggregation-pipeline-optimization/)（官方 · $match 下推等重排规则）
- [Slot-Based Query Execution Engine](https://www.mongodb.com/docs/manual/reference/sbe/)（官方 · SBE reference）

---

<a id="chapter-03"></a>

## 第 3 章：索引与 Schema 设计

02 章讲了查询和聚合怎么读，也看到 `$lookup` 是嵌套循环、代价很贵。这章把"建什么索引"和"字段怎么摆"合起来讲——在 MongoDB 它们是同一个决策，而不是关系型里"先建表、再单独调索引"的两步走。

**本章你将建立的 schema**

- 索引类型全景：single / compound / multikey / text / 2dsphere / wildcard / hashed / partial / sparse / TTL，差异都在"键怎么从文档里取"。
- ESR 规则：复合索引字段顺序 = Equality → Sort → Range，以及为什么这个顺序是机制而非惯例。
- 嵌入 vs 引用的完整决策，加官方设计模式：Bucket / Subset / Computed / Polymorphic / Schema Versioning / Attribute。
- 反模式：无界数组、海量数组的 multikey 爆炸、过多索引、`$lookup` 滥用，以及 schema validation 怎么守门。

<a id="s31"></a>

### 3.1 索引类型全景

索引是独立于集合存储的 B-tree，键是字段值、值是文档定位符；各类型的差异在于"键怎么从文档里取"。

为什么需要它

没有索引的查询是全集合扫描，引擎逐文档比对。索引把"按字段值找文档"变成 B-tree 上的对数查找。这一点和关系型一致；不一致的是 MongoDB 的字段值会是数组、会是任意嵌套路径，所以"键怎么取"分化出了多种索引类型。

**底层机制（比文档深一层）**：普通 single / compound 索引每个文档贡献**一个**索引项。multikey 不同——当被索引字段是数组时，索引为数组的**每个元素**各存一个索引项。所以一个数组字段的索引项数 ≈ 文档数 × 平均数组长度，远多于文档数。还有一条硬限制：**不能对两个数组字段建复合索引**（parallel arrays 限制），引擎会直接报错——因为两个数组的笛卡尔积会让索引项数爆炸。multikey 不是一种显式声明的类型，而是只要被索引字段含数组值，索引**自动**变成 multikey。

其余类型各自解决一类"键怎么取或取多少"的问题：**partial** 只索引满足 `partialFilterExpression` 的文档，省空间也省写入维护；**sparse** 只索引含该字段的文档（缺字段的不进索引）；**TTL** 是单字段索引加 `expireAfterSeconds`，后台线程**周期性**扫描并删除过期文档——注意是周期删除（默认约 60 秒一轮），不是到点精确即时删；**hashed** 索引哈希字段值，给分片场景提供均匀分布（见 06 章）；**wildcard**（`{"$**": 1}`）给字段名不固定、无法预先枚举的场景，对所有路径建索引；**text** 做分词全文检索，**2dsphere** 做地理空间查询。

表 3.1 · 索引类型 → 用途 → 代价/注意

| 类型 | 用途 | 代价 / 注意 |
| --- | --- | --- |
| single / compound | 等值、范围、排序、覆盖查询 | 每文档一个索引项；compound 受 ESR 顺序约束（§3.2） |
| multikey | 对数组字段建索引、按数组元素过滤 | 索引项 ≈ 文档数 × 数组长度；不能对两个数组字段建复合索引 |
| partial | 只索引满足条件的子集，省空间 | 查询条件不落在 `partialFilterExpression` 内时用不上该索引 |
| sparse | 只索引含该字段的文档 | 缺字段文档不进索引，相关排序/范围查询会漏掉这些文档 |
| TTL | 按 `expireAfterSeconds` 自动过期文档 | 后台线程周期删除（非精确即时）；只能建在单个 `Date` 字段上 |
| hashed | 分片时打散写入、均匀分布 | 哈希后丢失顺序，不支持范围查询（见 06 章） |
| wildcard | 字段名不固定、无法预先枚举 | 覆盖面广但更大更慢；不能替代有针对性的 compound 索引 |
| text / 2dsphere | 全文分词检索 / 地理空间查询 | 专用类型；text 每集合至多一个；体积大于普通索引 |

想一想

对一个含 50 个标签的数组字段建 multikey 索引，集合有 100 万文档，索引大致有多少项？这对写入意味着什么？

**展开答案（先停 10 秒）**

索引项数 ≈ 100 万 × 50 = **5000 万项**，是文档数的 50 倍。后果在写入侧：每次改动这个数组（增删一个标签）都要在 B-tree 上维护对应的多个索引项，**数组越大、写入越慢**。这就是"海量数组 + multikey"反模式的机制根源（§3.5 给修复），也是为什么数组字段要控制长度。

<a id="s32"></a>

### 3.2 ESR 规则：复合索引字段顺序

复合索引字段顺序按 Equality → Sort → Range 排，能让一次索引扫描同时完成过滤、排序、范围三件事。

为什么需要它

复合索引能不能被一个查询用上、用得多充分，取决于字段顺序。顺序排错，引擎要么用不上后半段索引，要么被迫在内存里排序（大排序会溢出，02 章讲过 `$sort` 的内存上限）。ESR 是把顺序选对的规则。

**底层机制（比文档深一层）**：复合索引 `{a:1, b:1, c:1}` 的 B-tree 先按 a 排序，a 相同的再按 b 排，b 相同的再按 c 排——是一棵**有序嵌套**的树。这个有序结构决定了三类条件该放哪：

**Equality（等值）放最前**——等值条件把扫描范围缩成 B-tree 上**一段连续区间**，选择性最高的过滤要尽早做，后面的字段才只在这一小段上工作。**Sort（排序）放中间**——等值段内部，索引按 Sort 字段天然有序，引擎直接顺着读出有序结果，**避免内存 sort**。**Range（范围）放最后**——范围条件（`$gt`/`$lt`）在索引上扫描一个连续子区间，放最后才不会打断前面字段的连续性。一个常见错误是把低基数字段（如布尔，只把集合切两半）放最前，那等于浪费了最前位置的选择性。

```javascript
// 查询：某商户、已支付、按金额降序、金额在某区间
db.orders.find({
  merchantId: "M-100",        // Equality
  status: "paid",             // Equality
  amount: { $gte: 50, $lt: 500 }   // Range
}).sort({ createdAt: -1 })    // Sort

// 对应的 ESR 索引：先 E（两个等值），再 S，最后 R
db.orders.createIndex({
  merchantId: 1,   // E
  status: 1,       // E
  createdAt: -1,   // S
  amount: 1        // R
})
// 一次索引扫描即可过滤 + 有序输出 + 区间裁剪，无内存 sort
```

![ESR 规则示意：Equality 把全集缩成一段连续键，Sort 在该段内保持有序，Range 在末端扫描一个子区间](/blog-assets/mongodb-mainline/03-diagram-01.svg)

*图 3.1 ESR 把一次索引扫描拆成三段协作。 注意 ：Equality 放最前不是惯例而是机制——它把扫描缩成一段连续键， 因此 后面的 Sort 与 Range 只在这一小段上工作。顺序换了，这个连续性就断了。*

想一想

有人把上例索引建成 `{ amount: 1, merchantId: 1, status: 1, createdAt: -1 }`，把范围字段放最前。为什么这会拖慢查询？

**展开答案**

范围字段 `amount` 放最前，B-tree 先按一个区间散开，等值条件 `merchantId`/`status` 无法把扫描缩成一段连续键——它们散落在 `amount` 区间内的各处。更糟的是排序：`createdAt` 落在范围字段之后，索引顺序对它**不再单调**，引擎只能把结果拉进内存排序。ESR 顺序排错，等值的选择性和排序的免费有序**两个好处同时丢失**。

<a id="s33"></a>

### 3.3 嵌入 vs 引用：完整决策

嵌入=一次读命中、但写入会被放大；引用=避免冗余、但读取要二次查询或 `$lookup`。

为什么需要它

01 章表 1.1 给了四问初判（一起读 / 无界 / 共享 / 写入时机）。这里补上反方向：什么时候引用*反而*更好，以及嵌入的真实代价。把决策落成一棵能照着走的树。

**底层机制（比文档深一层）**：嵌入把"总是一起读"的数据预拼进一个文档，读取一次命中、无 `$lookup`；代价是更新放大（同一事实冗余在多处，改一处要改多处）和文档膨胀（逼近 16MB、挤占 WiredTiger cache，01/04 章）。引用把数据拆到独立集合，避免冗余、各自独立写；代价是读取要二次查询或走 `$lookup` 嵌套循环。四个判据里**任何一个**命中"引用"侧，就倾向引用：总是一起读吗（否→引用）、会无界增长吗（是→引用）、被多实体共享吗（是→引用）、写入时机一致吗（各自独立高频写→引用）。嵌入是**默认**选项，但要四个条件**全部**落在安全侧才成立。

![嵌入 vs 引用决策树：依次判断总是一起读、是否无界增长、是否被多实体共享，任一命中则引用，全部安全才嵌入](/blog-assets/mongodb-mainline/03-diagram-02.svg)

*图 3.2 嵌入 vs 引用决策树。 注意 ：四个判断里任何一个命中"引用"就倾向引用；嵌入是默认终点，但只有"总是一起读、有界、不共享"三关全过才到得了。任一关失守，路径就拐向引用。*

想一想

什么场景下，明明数据"总是一起读"，却仍该选引用？

**展开答案**

当这块数据**无界增长**或**被多实体共享**时，即便它和主体常一起读，也该引用。例如商品详情页总要显示商品所属的"类目"信息——一起读，但同一个类目被成千上万商品共享，嵌入会让类目改名时要更新海量文档。共享判据压过了"一起读"，结论是引用类目、读时关联。决策树里"一起读=是"只是放行到下一关，不是直接判嵌入。

<a id="s34"></a>

### 3.4 官方设计模式

设计模式是把"嵌入 vs 引用"这条原则在常见场景下固化成的可复用解法。

MongoDB 官方把高频建模套路整理成一组模式。逐个看，每个配上"何时用"：

**Bucket（分桶）**：把高频产生的小数据按时间窗或固定数量分桶，多条原始记录合并成一个"桶文档"。接 01 §1.3 的 IoT 例子——每秒一条读数若各存一文档会有海量小文档，按"设备 + 小时"分桶成一个文档、内含该小时的读数数组，既控制文档数又让数组有界。*何时用*：时序、日志、高频小数据。

**Subset（子集）**：把热子集冗余进主文档，其余引用。例如商品文档里冗余存"最近 3 条评价"供详情页直接显示，完整评价列表引用到独立集合按需翻页。*何时用*：一个大集合里只有一小段是高频读的。

**Computed（预计算）**：把读时要算的聚合结果预先算好存进文档，省去每次读时重算。例如商品文档存 `avgRating` 和 `reviewCount`，写评价时增量更新，读时直接取。*何时用*：读远多于写、且每次读都要做同样的聚合。

**Polymorphic（多态）**：一个集合存多种形态的文档，加一个 `type` 鉴别字段区分。例如 `events` 集合里 `click`/`purchase`/`signup` 各有不同字段，靠 `type` 分流处理。*何时用*：一组实体有共性也有差异，且常被一起查询。

**Schema Versioning（schema 版本）**：给文档加 `schemaVersion` 字段，应用层按版本兼容读取、写入时渐进迁移到新版——无需停机改全表。*何时用*：schema 要演进，但表大到不能一次性迁移。

**Attribute（属性）**：把数量可变、键不固定的属性存成 `[{k, v}]` 数组，再对 `k` 和 `v` 建索引，从而能按任意属性过滤。*何时用*：实体有大量稀疏、品类相关的可变属性（见本章 challenge）。

表 · 设计模式 → 解决的问题 → 一句话机制

| 模式 | 解决的问题 | 一句话机制 |
| --- | --- | --- |
| Bucket | 高频小数据导致海量文档 / 无界数组 | 按时间窗或数量把多条记录合并成一个桶文档 |
| Subset | 大数组拖垮主文档读取 | 热子集冗余进主文档，其余引用到独立集合 |
| Computed | 每次读都重复同一聚合 | 写时预算结果存进文档，读时直接取 |
| Polymorphic | 多形态实体要存一处并一起查 | 同一集合存多种文档 + `type` 鉴别字段 |
| Schema Versioning | schema 演进但表大到不能整迁 | 加 `schemaVersion`，应用层按版本渐进迁移 |
| Attribute | 键不固定的可变属性要可过滤 | 存成 `[{k,v}]` 数组并对 `k,v` 建索引 |

<a id="s35"></a>

### 3.5 反模式与 schema validation

反模式几乎都源自同一类错误——把无界或冗余的代价压在了写入和 cache 上；schema validation 在写入时守门。

表 3.2 · 反模式 → 根因 → 修复

| 反模式 | 根因 | 修复 |
| --- | --- | --- |
| 无界数组 | 文档无界增长，逼近 16MB、挤占 cache | 分桶（Bucket）或引用到独立集合 |
| 海量数组 + multikey | 索引项 ≈ 文档数 × 数组长度，写放大 | 限制数组长度，或把数组重构为独立文档 |
| 过多索引 | 每次写都要同步维护所有索引 B-tree | 用 `$indexStats` 找出低命中索引并删除 |
| `$lookup` 当 JOIN 滥用 | 嵌套循环，数据量大时代价陡增 | 把常一起读的数据嵌入，或对 `foreignField` 建索引 |
| 无 schema 校验，脏数据涌入 | 缺字段、错类型的文档混入集合 | 加 `$jsonSchema` validator 在写入时拦截 |

**schema validation 机制**：MongoDB 允许给集合挂一个 `$jsonSchema` 校验器，在写入时强制结构与类型。两个开关控制严格度：`validationLevel` 决定校验范围（`strict` 校验所有写入，`moderate` 只校验本就合规的文档的更新），`validationAction` 决定违规处理（`error` 拒绝写入，`warn` 仅记日志放行）。校验器既能在 `createCollection` 时设，也能用 `collMod` 给已有集合补上。

```javascript
// 给 orders 集合加 $jsonSchema 校验器（写入时强制结构 + 类型）
db.runCommand({
  collMod: "orders",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["merchantId", "status", "amount"],
      properties: {
        merchantId: { bsonType: "string" },
        status: { enum: ["pending", "paid", "refunded"] },
        amount: { bsonType: "decimal", minimum: 0 }
      }
    }
  },
  validationLevel: "strict",   // 校验所有写入
  validationAction: "error"    // 违规直接拒绝
})
```

想一想

一个集合建了 12 个索引，写入明显变慢，为什么？怎么入手？

**展开答案**

每次 `insert`/`update` 都要**同步维护全部 12 棵 B-tree**——一次写在存储层放大成 12 倍量级的索引维护工作，写入吞吐随索引数线性下降。读再快也救不回写被拖垮。入手：用 `db.collection.aggregate([{$indexStats:{}}])` 看每个索引的实际命中次数，删掉长期零命中或低命中的索引。索引不是越多越好，每一个都在写路径上收税。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 一个数组字段建 multikey 索引，怎么估它的索引项数？给出估算公式，并说明为什么它影响写入性能。
2. ESR 规则里 Equality、Sort、Range 各自为什么放那个位置？逐字母说清机制依据。
3. Bucket 模式解决什么问题？它通过什么手段同时控制文档数和数组长度？
4. （设计题）一个"用户 + 用户的收货地址（最多几个）+ 用户的订单（无界）"。收货地址和订单分别该嵌入还是引用？逐项给判据。

**答案（先做完再展开）**

1. 索引项数 ≈ **文档数 × 平均数组长度**（multikey 为数组每个元素各存一项）。影响写入：每次改动数组都要在 B-tree 上维护对应的多个索引项，数组越大写入维护越重。
2. **Equality 放最前**：等值把扫描缩成一段连续键，选择性最高的过滤要最早做。**Sort 放中间**：等值段内索引按 Sort 字段天然有序，顺读即得有序结果，避免内存 sort。**Range 放最后**：范围在索引上扫一个连续子区间，放最后才不打断前面字段的连续性。
3. 解决高频小数据导致的**海量小文档**与**无界数组**两个问题。手段：按时间窗或固定数量把多条原始记录合并进一个桶文档——桶的数量受时间窗约束（控文档数），每桶内数组受窗口长度约束（控数组长度）。
4. **收货地址 → 嵌入**：有界（最多几个）、几乎总和用户一起读、专属该用户、写入时机一致，四关全过。**订单 → 引用**：无界增长（无界判据命中）、常被独立分页查询、各自高频写入，任一命中即倾向引用，存独立集合按 `userId` 关联。

进阶挑战 · 刚好够不着

#### 给"任意多动态属性且要能按属性过滤"的商品设计 schema 和索引

需求：商品有任意多动态属性（颜色、尺寸、材质……），不同品类的属性集合不同；前台要能按任意属性组合过滤（如"红色 + 棉质"）。先不查资料，选一个设计模式，写出文档结构，并设计支撑过滤的索引。再权衡它和"每个属性一个字段 + wildcard 索引"的取舍。

**提示（卡住再展开）**

用 **Attribute 模式**：把属性存成 `attrs: [{k:"color", v:"red"}, {k:"material", v:"cotton"}]` 数组，对 `{ "attrs.k": 1, "attrs.v": 1 }` 建一个 multikey 复合索引——一个索引就能服务所有属性的等值过滤（`{"attrs": {$elemMatch: {k:"color", v:"red"}}}`）。对比方案是"每个属性一个顶层字段（`color`/`material`…）+ wildcard 索引 `{"$**":1}`"：字段方案查询更直观、单属性查询更快，但字段集合随品类膨胀、wildcard 索引更大更慢且难精确控制。Attribute 用一个稳定索引换字段不固定的灵活性，代价是查询语法绕一层 `$elemMatch`、且 multikey 索引项随属性数增长。选型取决于属性是否真的无法枚举、以及过滤是单属性还是多属性组合为主。

#### 本章参考

- [Indexes](https://www.mongodb.com/docs/manual/indexes/)（官方 · 索引类型全景）
- [The ESR (Equality, Sort, Range) Guideline](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)（官方 · 复合索引字段顺序）
- [Building With Patterns: A Summary](https://www.mongodb.com/blog/post/building-with-patterns-a-summary)（MongoDB blog · 设计模式总览）
- [Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/)（官方 · `$jsonSchema` 校验器）

---

<a id="chapter-04"></a>

## 第 4 章：WiredTiger 存储引擎

前三章都停在逻辑层——文档怎么建模、怎么查、怎么建索引。这章下沉到物理层：数据和索引到底怎么落盘、并发怎么控制、崩溃后怎么不丢。对照对象是 Postgres 的 heap + shared_buffers + WAL + VACUUM，逐条还账。

**本章你将建立的 schema**

- WiredTiger 是每集合 / 每索引一棵 B-tree；并发是文档级乐观 MVCC，不是行锁。
- cache（默认约 50% RAM）与 eviction：cache 满时应用线程被征用去 evict——这是延迟悬崖，不是优雅降级。
- checkpoint（约 60s）+ journal/WAL 共同保证持久性。
- 旧版本进 history store → 没有 VACUUM；逐条对照 Postgres 的 heap + shared_buffers + WAL + VACUUM。

<a id="s41"></a>

### 4.1 B-tree 与文档级并发

WiredTiger 给每个集合、每个索引各维护一棵 B-tree；并发写靠文档级乐观 MVCC，冲突即重试。

为什么需要它

逻辑层的"集合"和"索引"在物理层各自落成一棵独立的 B-tree 文件。这一层决定了三件事——数据按什么结构排布、两个并发写如何裁决、热点页放在哪里。理解它，03 章的索引选择和本章后面的 cache 行为才有机制依据。

**底层机制（比文档深一层）**：WiredTiger 默认是**行存 B-tree**——每个集合一棵 B-tree、每个索引一棵 B-tree，各自是磁盘上一个独立文件。WiredTiger 也提供 LSM-tree 选项（`type=lsm`），但默认不开，因为 LSM 用读延迟换写吞吐，不适合 MongoDB 的通用读写画像。并发控制是**文档级乐观 MVCC**，不是锁：一次写入把版本化更新挂到 B-tree page 内存里的 **update chain**（一条 skip list）上，不就地改 page。两个并发事务改同一文档时，其中一个在提交期检测到冲突、抛出 `WriteConflict`，由 MongoDB 层自动 abort 并 retry。对照 Postgres：Postgres 是 MVCC-in-heap——新版本作为新元组追加进 heap、旧元组就地留在原页等 VACUUM 清理；写冲突走的是行级锁阻塞，后到的事务*等*锁释放，而不是被判败重来。机制点完全不同：一个是乐观重试，一个是悲观阻塞。

对照 · Postgres

Postgres 写同一行：后到事务在行级锁上**阻塞等待**，前一个提交后它接着改——序列化但不丢工作。WiredTiger 写同一文档：后到事务在提交期**直接判败**（`WriteConflict`），整个操作 abort 后由上层重放。**边界**：这意味着 MongoDB 的写冲突代价是"重做一遍"，在高争用同文档场景下重试会放大；Postgres 的代价是"排队等待"，体现为延迟而非重算。选择不同，热点行为也不同。

```javascript
// 确认存储引擎与每集合的 B-tree 文件
db.serverStatus().storageEngine
// → { name: "wiredTiger", ... }

// 看某集合的 WiredTiger 细节：block-manager、btree、cache 占用
db.orders.stats().wiredTiger["block-manager"]
// 写冲突计数（高 = 多个写打在同一批文档上，触发乐观重试）
db.serverStatus().metrics.operation.writeConflicts
```

<a id="s42"></a>

### 4.2 MVCC 快照与 history store

每个操作看到一个时间戳确定的快照；旧文档版本被写进磁盘上的 history store。

为什么需要它

快照让读不阻塞写、写不阻塞读——一个长读不会因为别人在写就被挡住，它看到的是开始那一刻的一致视图。代价是旧版本必须留着，直到没有任何快照还需要它。这些旧版本去哪了、谁来回收，正是 MongoDB 与 Postgres 分道的地方。

**底层机制（比文档深一层）**：可见性由 **transaction id + commit timestamp** 决定——一个操作只看到 commit timestamp 不晚于自己快照点的版本。关键伏笔在这里：MongoDB 用 oplog 的 **optime** 驱动 WiredTiger 的 commit timestamp，让存储层的版本时间线和复制时间线对齐（05 章副本集会接上这条线）。eviction 把一个 page 写回磁盘时，若该 page 上挂着多个版本，**最新值写进数据文件、旧版本写进 history store**（磁盘上的一个独立表）。因此 MongoDB **没有 VACUUM**——旧版本的回收发生在 eviction / checkpoint 的**页重整（reconciliation）**里：重整时引擎判断哪些旧版本已无任何活跃快照引用，就地丢弃。对照 Postgres：死元组留在原 heap 页，必须靠后台 VACUUM 进程*扫描*表把它们标记可重用、并推进 freeze；回收是一个独立的、需要调参（autovacuum 阈值）的后台任务。WiredTiger 把回收**折叠进了本来就要做的刷盘动作**，不再有单独的清扫扫描。

![WiredTiger 一个 B-tree page 的结构：page 上挂版本链 v3 到 v1，最新在内存 cache，旧版本指向磁盘 history store](/blog-assets/mongodb-mainline/04-diagram-01.svg)

*图 4.1 一个 B-tree page 上的版本链与去向。 注意 ：旧版本不是就地覆盖、也不是等 VACUUM 扫描，而是在 页重整 时由最新值进数据文件、旧版本被推进 history store——这就是 MongoDB"无 VACUUM"的机制来源。*

想一想

一个事务开了一个很久不提交的快照读，期间同一批文档被反复更新很多版本。history store 会怎样？对照 Postgres 的什么现象？

**展开答案（先停 10 秒）**

只要那个老快照还活着，它可能仍需要某些旧版本，**这些旧版本就不能被页重整丢弃**，于是 history store 持续累积、占用磁盘并拖慢相关读。这对应 Postgres 的经典现象：一个长事务持有老 xmin，**VACUUM 无法回收**晚于它的死元组，导致表膨胀（bloat）。机制不同（history store vs 死元组堆积），但病根同源——长快照拖住旧版本回收。两边的运维结论一致：盯住长事务。

<a id="s43"></a>

### 4.3 cache 与 eviction：延迟悬崖

WiredTiger cache 默认约 (RAM−1GB) 的 50%，装大多未压缩页；填满到阈值后，应用线程被迫亲自参与 eviction 才能继续。

为什么需要它

cache 是热数据驻留内存的地方，命中率直接决定读写延迟。它的容量公式和"装的是未压缩页"这两点，决定了同一台机器能放多大的工作集；而它满了之后的行为，决定了过载时是平滑变慢还是突然抖动。这一节是本章对生产延迟最有解释力的部分。

**底层机制（比文档深一层）**：WiredTiger cache 默认大小是 `max(256MB, 50% × (RAM − 1GB))`，缓存的是**未压缩**页——压缩只发生在磁盘上，进了 cache 就是解压后的形态，所以 cache 的有效容量按未压缩体积算。eviction 由专门的 **eviction server + eviction worker 线程**做近似 LRU，把页分成 clean / dirty / urgent 几个队列处理：clean 页直接丢，dirty 页要先写回磁盘（顺带做上一节的页重整）。引擎维持两道水位——`eviction_target` / `eviction_dirty_target`（后台开始干活）和 `eviction_trigger` / `eviction_dirty_trigger`（上限）。一旦越过 trigger 阈值，**应用线程被"征召"同步参与 eviction**——它得先帮引擎 evict 出空间，才能推进自己的读写。这是一道**延迟悬崖（latency cliff）**：不是后台默默降速，而是前台请求线程突然被拉去打工，p99 陡升。当 working set > cache，页会被反复换进换出（外加每次 miss 的磁盘读），形成持续 **thrash**。对照 Postgres shared_buffers：脏页由后台 **bgwriter** 和 **checkpointer** 刷，前台查询一般*不*被拉去刷盘（极端情况才会因 buffer 不足而等待）；缺页时走 OS page cache 兜底，行为更平滑。WiredTiger 把刷盘压力直接回灌到应用线程，所以过载表现更"硬"。

![左侧正常态 cache 未满后台 worker 干活应用线程畅通，右侧超阈值态 cache 满应用线程被拉去 evict](/blog-assets/mongodb-mainline/04-diagram-02.svg)

*图 4.2 cache 两态对比。 注意 ：working set 超过 cache 不是平滑变慢，而是应用线程突然要替引擎打工——被高亮的那条征用路径就是延迟悬崖， p99 延迟会陡升 ，而非线性退化。*

想一想

磁盘上一个集合压缩后是 8GB，cache 还剩 10GB。能断定这个集合的工作集"装得下"吗？

**展开答案**

**不能。**cache 装的是**未压缩**页。snappy 在文档型数据上常有 2–4 倍压缩比，8GB 压缩数据解压后可能是 16–32GB，远超 10GB 剩余 cache。要估能否装下，得按**未压缩**体积（以及实际热点页占比）算，不能直接拿磁盘文件大小比 cache。这是 cache 缓存未压缩页这一机制最容易被忽略的实务后果。

<a id="s44"></a>

### 4.4 持久性：checkpoint + journal

checkpoint 每约 60s 落一份一致快照，journal/WAL 覆盖两次 checkpoint 之间的窗口。

为什么需要它

cache 里的脏页在落盘前一旦断电就会丢失。持久性靠两件东西分工兜底：一份定期的一致磁盘快照，加上两次快照之间的连续日志。理解这对组合，才能判断"断电会丢多少"以及不同写关注（write concern）改变了什么。

**底层机制（比文档深一层）**：**checkpoint**（默认约 60s 一次，或写满约 2GB journal 触发）把 cache 里的脏页刷成一份**一致的磁盘快照**；旧 checkpoint 在新 checkpoint 完整落盘之前一直有效——崩溃时可以回退到上一个完好的 checkpoint，不会读到写了一半的状态。**journal/WAL** 提供两次 checkpoint 之间的持久性：写操作先记 journal，引擎**组提交（group commit）**把一批 journal 攒在一起刷盘，默认约 **100ms** 一批（用 `j:true` 则该写同步等自己的 journal 落盘）。崩溃恢复 = 加载最后一个完好 checkpoint，再**重放（replay）**其后的 journal 到崩溃点。压缩方面：数据块默认 **snappy**（可选 `zstd` / `zlib`，更小但更慢），索引用**前缀压缩**（相邻 key 共享前缀）。对照 Postgres：checkpoint ≈ Postgres 的 checkpoint（也是落一致快照点），journal ≈ WAL（也是组提交、也是崩溃后从 checkpoint 重放）——这一层两者的*形态*最接近，区别更多在默认间隔和参数名。

表 4.1 · WiredTiger 机制 ↔ Postgres 机制对照

| 维度 | WiredTiger（MongoDB） | Postgres |
| --- | --- | --- |
| 存储布局 | 每集合一棵 B-tree、每索引一棵 B-tree，各自独立文件 | heap（无序）+ 独立的索引文件 |
| 缓存 | WT cache，缓存**未压缩**页，默认 ~50%×(RAM−1GB) | shared_buffers，缓存页，另有 OS page cache 兜底 |
| 并发 | 文档级**乐观** MVCC，冲突即 abort+retry | 行级 MVCC（多版本元组）+ 行锁阻塞 |
| 日志 | journal 组提交（默认 ~100ms 一批） | WAL 组提交 |
| 旧版本回收 | history store + 页重整，**无 VACUUM** | 死元组堆积 + 后台 **VACUUM** 扫描清理 |
| 刷脏 | 后台 worker；过阈值时**应用线程被征用** | 后台 bgwriter / checkpointer，前台一般不刷 |

想一想

断电时，最后约 100ms 内、未用 `j:true` 提交的写会怎样？

**展开答案**

**可能丢失。**journal 默认约 100ms 才组提交一次落盘，这段窗口内已确认给客户端、但尚未刷进 journal 的写，在断电后无法被恢复重放——它们既不在最后的 checkpoint 里，也不在已落盘的 journal 里。要更强保证：用 `j:true`（每次写都等自己的 journal 落盘后才返回，牺牲延迟换不丢）；或在副本集层用 `w:majority`（多数节点确认，05 章展开）。两个旋钮作用在不同层：`j:true` 管单机落盘，`w:majority` 管跨副本持久。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 为什么 MongoDB 没有 VACUUM？被替换掉的旧文档版本去了哪里、什么时候被真正回收？
2. cache 满到阈值时具体发生了什么？为什么把这个行为叫"延迟悬崖"而不是"逐渐变慢"？
3. checkpoint 和 journal 各负责持久性的哪一段？崩溃恢复时两者怎么配合？
4. （对照题）WiredTiger 的文档级乐观 MVCC 与 Postgres 的行级 MVCC，在处理"两个写打到同一条记录"时差在哪一步？

**答案（先做完再展开）**

1. 因为旧版本回收被**折叠进了 eviction / checkpoint 的页重整**，不需要单独的清扫扫描。旧版本在页重整时被推进磁盘上的 **history store**，一旦没有任何活跃快照引用它，就在重整中被丢弃；Postgres 则要靠后台 VACUUM 扫表清死元组。
2. 越过 `eviction_trigger` / `eviction_dirty_trigger` 阈值后，**应用线程被征召同步参与 eviction**，必须先帮引擎腾出空间才能推进自己的操作。叫悬崖是因为这是阶跃式的——从"后台默默 evict"突然切到"前台线程替引擎打工"，p99 陡升，而非线性退化。
3. checkpoint（~60s）落一份一致磁盘快照，覆盖到快照点为止的所有已刷数据；journal/WAL 覆盖两次 checkpoint 之间的窗口。恢复 = 加载最后一个完好 checkpoint，再重放其后的 journal 到崩溃点。
4. WiredTiger 让后到的写**直接判败**（`WriteConflict`）、abort 后由上层 retry——乐观重试；Postgres 让后到的写在**行级锁上阻塞等待**，前一个提交后继续——悲观阻塞。一个重算，一个排队。

进阶挑战 · 刚好够不着

#### 估算 working set 与 cache：会不会 thrash

场景：单机内存 64GB，数据集磁盘体积 200GB，负载以随机点查为主。先不查资料，估算 WiredTiger cache 容量、判断这个工作负载会不会 thrash，并给出至少两条缓解方向。

**提示（卡住再展开）**

cache ≈ (64 − 1) × 0.5 ≈ **31.5GB**。判断 thrash 看的不是 200GB 全量，而是**热点工作集（未压缩）**：随机点查若热点工作集 > 31.5GB，页会持续换进换出 + 磁盘读，进入 thrash，p99 抖。缓解方向：(1) **加内存**，把 cache 抬到覆盖热点工作集；(2) **分片**（06 章）把热点摊到多台，各自工作集落进各自 cache；(3) 收紧 **schema**——短字段名 / 去掉冗余大字段 / 拆出冷字段，直接缩小文档体积从而缩小工作集。注意全程按未压缩体积算，别拿 200GB 磁盘数比 cache。

#### 本章参考

- [WiredTiger Storage Engine](https://www.mongodb.com/docs/manual/core/wiredtiger/)（官方 · cache、checkpoint、压缩）
- [WiredTiger Architecture Guide](https://source.wiredtiger.com/develop/arch-index.html)（官方架构 · B-tree、eviction、history store）
- [Journaling](https://www.mongodb.com/docs/manual/core/journaling/)（官方 · journal 组提交与恢复）
- [MongoDB Transactions & Timestamps](https://www.mongodb.com/blog/post/quick-start-mongodb-multi-document-acid-transactions)（工程博客 · optime 驱动 commit timestamp）

---

<a id="chapter-05"></a>

## 第 5 章：副本集与一致性

04 章讲了单节点怎么存、怎么本地持久——还埋了一个伏笔：WiredTiger 的 commit timestamp 由 oplog 驱动。这章把数据复制到多节点，看 oplog、选举、读写关注，以及"返回成功"到底意味着什么。

**本章你将建立的 schema**

- oplog：local 库里的 capped 集合，条目幂等，secondary 主动 PULL 拉取并重放。
- 副本集协议：受 Raft 启发但不是 Raft——pull 而非 push、term、选举、priority takeover、dry-run election。
- write concern / read concern：w:majority 的 commit point 怎么算；readConcern majority/snapshot/linearizable 各读到什么。
- 因果一致性 + HLC（$clusterTime 带 HMAC 签名）；持久性 ≠ 可见性。

<a id="s51"></a>

### 5.1 oplog：幂等操作日志

oplog 是 primary 上一个 capped 集合（local.oplog.rs），记录幂等的操作条目，secondary 主动拉取重放。

为什么需要它

多节点复制要解决一个核心矛盾：同一批操作在不同节点上重放，结果必须一致，而网络重传、节点重启会让同一条操作被重放不止一次。oplog 把每条变更设计成可重复执行而结果不变的形式，重放就不必担心"放了几遍"。

**底层机制（深一层）**：oplog 条目被设计成**幂等**——`$inc` 被转写成绝对值 `$set`，一条改多文档的操作被拆成逐文档条目——所以重复重放同一批不会出错。secondary 用一个 OplogFetcher exhaust cursor 按 optime tail primary，主动 **PULL**，primary 从不 push。oplog window（大小 ÷ 写入速率）决定 secondary 最多能落后多久；落后超窗口就要 full resync。对照 Postgres：既不是物理 WAL ship，也不是逻辑解码，而是一个**可查询的、幂等的操作日志**，由状态机重放。

机制对照

`$inc: 1` 这种相对操作不是幂等的——重放两遍就多加了一次。oplog 在 primary 执行后把结果落成绝对值：primary 把计数器从 41 加到 42，写进 oplog 的是 `$set: { counter: 42 }`。secondary 重放一遍是 42，重放十遍还是 42。把相对操作转写成绝对结果，是幂等的来源。

下面是同一条写入操作在 primary 执行后落进 oplog 的样子。注意 `o` 字段里已经是绝对值。

```javascript
// 应用层发的是相对操作
db.counters.updateOne({ _id: "page" }, { $inc: { hits: 1 } })

// primary 执行后，落进 oplog 的条目（节选）——已转写为绝对值
db.getSiblingDB("local").oplog.rs.find().sort({ $natural: -1 }).limit(1)
// {
//   op: "u",                       // update
//   ns: "app.counters",
//   ts: Timestamp(1717300000, 1),  // optime：secondary 按它 tail
//   o:  { $v: 2, diff: { u: { hits: 42 } } },  // 绝对值 42，非 +1
//   o2: { _id: "page" }            // 定位目标文档
// }
```

![副本集拓扑：一个 primary 持有 oplog，两个 secondary 主动从 primary 的 oplog 拉取并重放](/blog-assets/mongodb-mainline/05-diagram-01.svg)

*图 5.1 副本集拓扑与复制方向。 注意 ：箭头从 secondary 指向 primary——复制是 secondary 主动拉，不是 primary 推，这点和 Raft 的 leader-push 相反。*

想一想

一个 secondary 宕机维护了几小时，期间 primary 写入很猛。它重新上线后，能直接从断点继续 tail oplog 吗？

**展开答案（先停 10 秒）**

不一定。取决于它落后的量有没有超过 **oplog window**。oplog 是 capped 集合，容量固定，写入速率越高、覆盖越快。如果 secondary 需要的那条 optime 已经被新条目**覆盖滚掉**，断点处的 oplog 不存在了，它无法增量追赶，只能 **full resync**（全量重新同步整个数据集）。所以高写入负载下要把 oplog 调大，给慢节点留出追赶窗口。

<a id="s52"></a>

### 5.2 选举与协议：像 Raft，但不是 Raft

副本集用 protocolVersion 1，借了 Raft 的 term 与单 leader 思想，但在复制方式、提交点计算、选举细节上都不同。

为什么需要它

primary 宕机后，集群要在没有人工介入的情况下选出新 primary 并继续接受写入，同时保证不会有两个 primary 同时被认可（脑裂）。Raft 提供了 term + 多数票的骨架来解决这件事，副本集采用了这套骨架，但按自己的复制模型做了改造。

**底层机制（深一层）**：与 Raft 的差异要明确列出——(1) 日志条目是**幂等操作**，不是状态机命令；(2) 复制是 secondary **pull**，不是 Raft 的 AppendEntries push；(3) commit point 由 primary **轮询多数节点的 lastDurable/lastWritten** 算出，而不是逐条计票；(4) 增加了 priority takeover（高优先级节点上线后抢主）和 dry-run election（选赢之前不 bump term，避免无谓的 term 膨胀）。心跳每 2s，10s 超时触发选举。rollback 用 WiredTiger 的 recover-to-stable-timestamp 回到公共点，而**不是**截断日志。

核心洞察

为什么强调"不是 Raft"——照搬 Raft 心智会误判它的提交语义。在 Raft 里，leader 把一条日志复制到多数节点就提交了该条目；在副本集里，提交点是 primary **周期性轮询**各 secondary 已 durable 的 optime 后算出的一个"多数已达"水位线，是 optime 维度的水位，而不是逐条目的计票。把它当 Raft 来推断"写到多数即提交的精确时刻"会偏差。

dry-run election 是一个容易被忽略的细节：候选人在真正发起选举、bump term 之前，先问一轮"若此刻发起选举，能否拿到多数票"。

```javascript
// 选举触发与 dry-run 的次序（伪代码，描述协议行为）
onHeartbeatTimeout() {                 // 10s 收不到 primary 心跳
  if (dryRunElection().wonMajority()) {  // 1) 试选：不 bump term
    bumpTerm();                          // 2) 真选才 +1，避免 term 膨胀
    requestVotes(currentTerm);           // 3) 正式拉票
  }
  // 试选失败：term 保持原值，集群不被一次无谓选举打扰
}

// priority takeover：高优先级节点追平 oplog 后主动抢主
if (this.priority > primary.priority && this.isCaughtUp()) {
  callElection();                        // 把主导权交还给更高优先级节点
}
```

想一想

primary 失联又恢复，发现自己写过几条 oplog 是当时的少数派、从未被多数确认。这些条目会怎样？日志会被截断吗？

**展开答案**

这些未达多数的条目会被 **rollback**。但机制上**不是截断 oplog 文件**——而是借 WiredTiger 的 **recover-to-stable-timestamp**，把整个存储引擎状态回退到与新 primary 的**公共提交点**一致的稳定时间戳，被回退的写从存储层一并消失。这把"日志截断"换成了"存储回到一个已知稳定快照"，和 04 章的 stable timestamp 是同一套机制。

<a id="s53"></a>

### 5.3 write concern / read concern

writeConcern 决定一次写要多少节点确认才返回，readConcern 决定一次读看到哪个一致性级别的数据。

为什么需要它

持久性和延迟是一对可调的权衡，不存在对所有写入都最优的固定点。writeConcern 与 readConcern 把这个权衡交到每次操作手里：要更强的不丢与不回滚保证，就多等几个节点；要更低延迟，就少等。两个旋钮分别管"写返回前等谁"和"读看见什么"。

**底层机制（深一层）**：`w:majority` 在多数节点 durable 后才返回；primary 跟踪 **lastCommittedOpTime**（majority commit point）。readConcern 的层级：**local**（不保证已提交，存在回滚风险）/ **majority**（读 majority commit point 的 WiredTiger 快照，不会被回滚）/ **snapshot**（钉住一个集群级多数提交时间戳，事务用）/ **linearizable**（额外发一个 no-op majority 写来确认自己仍是 primary，给实时线性读）。read preference：primary/secondary/nearest——从 secondary 读会读到滞后数据。

```javascript
// 写：等多数节点 durable 才返回（不丢、不被回滚）
db.accounts.updateOne(
  { _id: 7 },
  { $set: { balance: 100 } },
  { writeConcern: { w: "majority" } }
)

// 读：只看已被多数提交的快照，读到的值不会被 rollback
db.accounts.find(
  { _id: 7 }
).readConcern("majority")

// 实时线性读：linearizable 会额外发一个 no-op majority 写，
// 确认本节点仍是 primary，代价最高，只能读 primary
db.accounts.find({ _id: 7 }).readConcern("linearizable")
```

把常见组合摊开看保证与代价。表里每一行是一个真实会被选用的搭配。

表 5.1 · writeConcern × readConcern 典型组合

| 组合 | 保证 | 代价 |
| --- | --- | --- |
| w:1 + readConcern local | 最快返回；单节点 durable 即应答 | failover 时有丢失或回滚风险；可读到未提交、将回滚的数据 |
| w:majority + readConcern majority | 不丢、不回滚；读到的是多数提交快照 | 写要等多数 durable，读看的是稍旧的提交点，延迟更高 |
| w:majority + readConcern linearizable | 实时线性读，读到最新已提交值 | 额外 no-op majority 写确认主身份，最慢，仅 primary |
| w:1 + 从 secondary 读 | 读写吞吐高，分散读负载 | secondary 有复制滞后，读到旧值；写在 failover 时也有丢失风险 |

想一想

一次 `w:majority` 的写已返回成功，紧接着用 `readConcern: local` 从 primary 读同一文档。读到的一定是这次写的值吗？读到的会被回滚吗？

**展开答案**

读到的**是**这次写的值——primary 上 local 读看到的是最新已应用的状态，而这次写既已在 primary 应用、又已多数 durable。它**不会被回滚**，但这份"不会回滚"的保证来自**写用了 w:majority**，不是来自 readConcern local。换 readConcern majority 读会同样安全；二者的区别在别处——若写只是 w:1，local 读可能读到尚未多数提交、将被回滚的数据，而 majority 读不会。

<a id="s54"></a>

### 5.4 因果一致性、HLC，与"持久性 ≠ 可见性"

一个写在本地持久，不等于它已对多数可见；这两件事被 write/read concern 分开调。

为什么需要它

分布式读写里有一类高频期望："刚写入的值，紧接着的读要能看到"（read-your-writes），以及"读到的顺序不倒退"（单调读）。这些保证不靠墙钟，因为节点间时钟不可信。因果一致性用一个逻辑时间把"谁先于谁"传递下去，读端据此等待节点追平。

**底层机制（深一层）**：HLC（Hybrid Logical Clock）生成 `$clusterTime`，随每条消息 gossip，并且 **HMAC 签名**防客户端伪造逻辑时间；`afterClusterTime` 让读等节点追上某个 cluster time，给 read-your-writes / 单调读。HLC 选型：胜过 Lamport 钟（无物理时间亲和）、向量钟（消息 O(N) 膨胀）、纯墙钟（要时钟同步）。

核心洞察 · 第二条主线

`w:1` 返回成功的写，在 failover 后**可被回滚**——有时甚至没有 rollback 文件留下痕迹。"返回成功" ≠ "持久且可见"。一次写返回成功只说明它**在某个节点本地落了盘**；它是否已跨越多数、是否不可回滚、是否对其他读者可见，是由 writeConcern 和 readConcern 分别决定的另外两件事。把"应答"等同于"安全"，是这一层最常见的误判。

![一次写入的时间线：t0 primary 本地 durable，此刻 w:1 返回；t0 到 t1 之间是危险窗口；t1 多数确认后不可回滚](/blog-assets/mongodb-mainline/05-diagram-02.svg)

*图 5.2 一次写入的持久性时间线。 注意 ：w:1 在 t0 就返回成功，但真正"不可回滚"要等到 t1；这段时间差就是持久性与可见性的缝隙。*

因果一致性的用法是开一个会话，让连续操作携带并推进 `$clusterTime`，读端用 `afterClusterTime` 等节点追平。

```javascript
// 因果一致性会话：写后读保证 read-your-writes
const s = db.getMongo().startSession({ causalConsistency: true });
const coll = s.getDatabase("app").profiles;

coll.updateOne({ _id: 7 }, { $set: { nick: "lin" } },
               { writeConcern: { w: "majority" } });

// 同一会话内的读携带上一步的 $clusterTime（HMAC 签名，不可伪造），
// 读端用 afterClusterTime 等本节点追平该 cluster time 再返回
coll.find({ _id: 7 }).readConcern("majority");  // 必读到 nick: "lin"
s.endSession();
```

想一想

从 secondary 读，readConcern local，刚写入（w:1）的数据一定读得到吗？

**展开答案**

不一定——secondary 可能还没重放到该 oplog 条目，读到旧值。w:1 只保证写在 primary 本地落盘，复制到 secondary 有滞后，而 local 读又不等任何提交点。要 read-your-writes 用**因果一致性会话 + majority**：会话把写的 `$clusterTime` 带给后续读，`afterClusterTime` 让 secondary 先追平再返回，majority 又保证读到的值不会被回滚。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 为什么 oplog 条目必须幂等？举一个被改写的例子（`$inc` → `$set`）。
2. 副本集协议和 Raft 的两个关键差异是什么？
3. w:majority 与 readConcern majority 各保证什么？
4. （综合题）"返回成功"的写在什么条件下还会丢？怎么配置避免？

**答案（先做完再展开）**

1. 因为同一批 oplog 会被重传、节点重启后重放，重复重放不能改变结果。例：应用发 `$inc: { hits: 1 }`，primary 执行后把结果落成绝对值 `$set: { hits: 42 }` 写进 oplog；secondary 重放一遍是 42，重放多遍仍是 42。相对操作转成绝对结果即幂等。
2. 任取其二：(1) 日志条目是幂等操作而非状态机命令；(2) 复制是 secondary **pull** 而非 Raft 的 AppendEntries push；(3) commit point 由 primary 轮询多数节点的 lastDurable/lastWritten 算出的 optime 水位，而非逐条计票；(4) 有 priority takeover 与 dry-run election；(5) rollback 用 recover-to-stable-timestamp 而非截断日志。
3. w:majority：写在**多数节点 durable** 后才返回，因此不丢、不会被回滚。readConcern majority：读 **majority commit point 的 WiredTiger 快照**，看到的数据已被多数提交、不会被回滚（但可能比最新写稍旧）。一个管写返回前等谁，一个管读看见哪个快照。
4. 用 `w:1` 的写在 t0 返回后、t1 多数确认前若发生 failover，可能被回滚而丢失（图 5.2 的危险窗口）。避免：写用 `w:majority`，要读到不被回滚的值再配 `readConcern: majority`；需要 read-your-writes 时加因果一致性会话。

进阶挑战 · 刚好够不着

#### 按访问点分别选一致性级别

设计一个一致性方案：用户改完资料后**立刻跳详情页必须看到新值**，但允许**全站列表页读到稍旧数据**以换取吞吐。先不查资料，写出详情页和列表页各自的 writeConcern / readConcern / read preference，并说明每个选择的理由。

**提示（卡住再展开）**

详情页用**因果一致性会话**（causally consistent session）+ readConcern majority 或直接读 primary，保证 read-your-writes：改资料的写用 w:majority，同会话的详情读带上该写的 `$clusterTime`，读端追平后再返回。列表页可读 **secondary + readConcern local** 换吞吐，接受复制滞后带来的稍旧数据。要点是**按访问点分别选一致性级别**，而不是全站一刀切——强一致只加在真正需要 read-your-writes 的那条路径上。

#### 本章参考

- [Replica Set Oplog](https://www.mongodb.com/docs/manual/core/replica-set-oplog/)（官方 · oplog 与复制）
- [Replica Set Elections](https://www.mongodb.com/docs/manual/core/replica-set-elections/)（官方 · 选举与 protocolVersion）
- [Read Concern / Write Concern](https://www.mongodb.com/docs/manual/reference/read-concern/)（官方 · 读写关注层级）
- [Causal Consistency](https://github.com/mongodb/specifications/blob/master/source/causal-consistency/causal-consistency.md)（spec · github mongodb/specifications）
- [repl/README](https://github.com/mongodb/mongo/blob/master/src/mongo/db/repl/README.md)（源码 · 复制子系统设计文档）

---

<a id="chapter-06"></a>

## 第 6 章：分片与选型

05 章把数据复制到多节点保证高可用；这章把数据水平切分到多组副本集——分片——并最终回答那个选型问题：什么时候该用 MongoDB，什么时候不该。每个分片本身就是 05 章那样的一个副本集。

**本章你将建立的 schema**

- 分片机制：chunk / shard key / balancer / mongos / config server；targeted vs scatter-gather 查询。
- shard key 选择：单调递增 = 热点；低基数 = jumbo chunk；hashed / compound 的取舍。
- 何时用 / 何时不用 MongoDB；对比 Postgres（JSONB） / MySQL / DynamoDB / Cassandra。
- "MongoDB 丢数据"声誉的事实时间线——真相是哪个默认值、什么时候改的。

<a id="s61"></a>

### 6.1 分片机制

mongos 按 shard key 把数据切成 chunk 分布到多个分片，每个分片是一个副本集，config server 存元数据。

为什么需要它

副本集解决高可用，不解决容量：每个节点都存全量数据，写入也都先过同一个 primary。当数据量或写吞吐超过单台机器，唯一的横向出路是把数据切开、分到多组机器各管一段。分片就是这一步——把"一个副本集装不下"变成"N 个副本集分着装"。

**底层机制（比文档深一层）**：客户端不直接连分片，而是连 **mongos** 路由器。mongos 读 config server 上的元数据，把一个集合按 shard key 的取值范围切成一段段 **chunk**（块），每个 chunk 落在某个分片上。一条查询走哪条路，由它带不带 shard key 决定：带 shard key 的查询是 **targeted**，mongos 算出该值落在哪个 chunk、只把请求发给持有它的那个分片；不带 shard key 的查询是 **scatter-gather**，mongos 把请求广播到所有分片、各自执行后再合并，整体延迟等于最慢那个分片的延迟——这和 02 章 `$lookup` 是同一种形态：代价随规模放大。**balancer** 跑在 config server 的 primary 上，监控各分片的 chunk 数量、在分片间迁移 chunk 以均衡分布。这里有一个硬约束：一个 chunk 大到超过约 2 倍平均大小、且其 shard key 取值已无法再细分时，成为 **jumbo chunk**，balancer 无法迁移它——它是坏 shard key 的直接后果，后面 §6.2 会还这笔账。

![分片架构：顶部 mongos 路由器，下方三个分片各为一个副本集，旁边 config server，并画出 targeted 与 scatter-gather 两类查询路径](/blog-assets/mongodb-mainline/06-diagram-01.svg)

*图 6.1 分片架构与两类查询路径。 注意 ：带 shard key 的查询只打一个分片，不带的广播全部——选 shard key 的本质是让你最高频的查询落在 targeted 这一侧。*

想一想

一个分片集群有 6 个分片，某条高频查询不带 shard key。它的尾延迟（p99）大致由什么决定？加分片能改善吗？

**展开答案（先停 10 秒）**

它是 scatter-gather：mongos 广播到全部 6 个分片，必须等**最慢**那个返回才能合并。所以尾延迟由 6 个分片里最慢的一个决定，分片越多、撞上一个慢分片的概率越高——加分片不仅不改善，反而会推高这条查询的尾延迟。改善的方向是让这条查询**带上 shard key**（变 targeted），或为它单独建合适索引。

<a id="s62"></a>

### 6.2 shard key 选择

好的 shard key = 高基数 + 写入分散 + 高频查询常带上它；坏的 shard key 制造热点或 jumbo chunk。

为什么需要它

shard key 决定每条文档落在哪个 chunk、每条查询走 targeted 还是 scatter-gather。选错了，水平扩展的钱白花——加再多分片，写入仍挤在一台机器上。它是分片集群里最难改、影响最深的一个决策。

**底层机制（比文档深一层）**：三类坏选择各有机制根源。**单调递增键**（ObjectId、时间戳——接 01 章 §1.2 埋的伏笔）：因为新值总是当前最大，所有新写入落到持有"最大范围"那个 chunk、那个分片，形成**写入热点**，其余分片闲置，横向扩展失效。**低基数键**（布尔、国家这类取值很少的字段）：取值少意味着 chunk 切到某个粒度后无法再按 shard key 细分，单个 chunk 持续膨胀成 **jumbo chunk**、无法迁移、堆在一个分片上。**hashed 键**：对 shard key 取哈希再分布，写入摊得很均匀，代价是牺牲范围查询的局部性——一个范围查询的连续值被哈希打散到各分片，退化成 scatter-gather。**compound 键**（多字段组合）：用前缀字段保证分散、后续字段保留查询局部性，兼顾基数与 targeted。5.0（2021）起支持在线 `reshardCollection` 改 shard key，但它要重写并重新分布整个集合，代价高——最好一次选对，把它当不可逆决策来设计。

![同一份写入流在三种 shard key 下的落点对比：单调递增压向一个过载分片，hashed 均匀分到三个分片，compound 均匀且范围局部](/blog-assets/mongodb-mainline/06-diagram-02.svg)

*图 6.2 同一份写入流，三种 shard key 的落点。 注意 ：单调递增键把它压成一根柱子、hashed 摊成三根——shard key 决定的是负载形状，不是存储位置。*

表 6.1 · shard key 候选 → 问题 → 修复

| 候选 shard key | 问题 | 修复 |
| --- | --- | --- |
| `_id`（默认 ObjectId） | 单调递增 → 写入热点，全压最新分片 | 改 `hashed _id`，或换业务键做 compound |
| `createdAt` 时间戳 | 单调递增 → 同上，新数据全落一处 | `{tenantId, createdAt}` compound 或 hashed |
| `country` / 布尔标志 | 低基数 → chunk 无法细分，jumbo chunk 堆积 | 叠高基数字段成 compound，提升可分性 |
| `hashed userId` | 写入均匀，但按 user 的范围查询变 scatter-gather | 查询若总带等值 userId 则无碍；要范围则用 compound |
| `{region, userId}` | 若某 region 数据极度倾斜，该前缀仍会热点 | 评估各前缀值的数据量，必要时把高基数字段前置 |

想一想

用创建时间戳做 shard key，写入压力会怎样分布？

**展开答案**

几乎全压到持有最新时间范围的那个分片，其余分片闲置——这是典型的单调递增热点。加分片也不会提升写吞吐，因为新写入永远指向"当前最大值"那一段。改用 `hashed` 把写入打散，或用 `{tenantId, timestamp}` 这样的 compound 键：前缀把写入按租户分散，后缀仍保留按时间的范围局部性。

<a id="s63"></a>

### 6.3 何时用 / 何时不用 MongoDB

默认用你已有的关系型库，除非下面某一条判据明确翻转这个默认。

为什么需要它

对一个 PostgreSQL/MySQL 熟练的工程师，选型的起点不该是"MongoDB 能不能做这个"——几乎都能做。起点应是"现有的关系型库在这个场景上输在哪个具体机制点"。没有这样一个明确的失分点，换库只是增加运维面、损失事务与 JOIN 能力。

**对比 Postgres（含 JSONB）**：Postgres 的 JSONB 在 JSON 只是数据里少数字段、其余实体需要 join typed 表、且 schema 会随时间硬化时是够用的——GIN 索引能对 JSONB 做 containment 查询。MongoDB 真正赢的场景是**整个领域模型就是文档**、读和更新以文档为单位、并且需要原生的水平写分片。Postgres 赢在多实体事务的完整性、即席 join 与报表、外键约束。

**对比 MySQL**：判据的轴线类似。MySQL/InnoDB 在给钱、库存、订单这类需要强原子性与约束的负载上更稳；它的成熟事务与外键不是 MongoDB 文档模型的强项。

**对比 DynamoDB / Cassandra**：当访问模式**固定且已知**、并且是极端规模的写入时，宽列 / KV 系统更合适——Cassandra 擅长写多、append 为主、多数据中心 active-active；DynamoDB 是 serverless、延迟可预测的 KV。MongoDB 在这条轴上的优势**不是裸写规模**，而是灵活的即席查询 + 二级索引 + 聚合管道；如果访问模式已经固化到不需要这些灵活性，宽列 / KV 往往更省。

**MongoDB 的甜区**：商品目录 / CMS / 内容系统；每个实体 schema 多变的文档；高写吞吐且要水平扩展；用聚合管道做实时分析；事件 / IoT 数据摄取。**MongoDB 的错用**：重多实体事务完整性的核心交易；复杂即席 join 与 BI 报表；强关系约束；以及 schema 其实稳定且本质关系型的负载（多数业务线应用属于此类）。

表 6.2 · 选型决策矩阵

| 场景 | MongoDB? | 更好的替代 |
| --- | --- | --- |
| 商品目录 / CMS，每类商品字段差异大 | 合适 | —（文档模型甜区） |
| 支付 / 订单 / 库存，多实体强事务 | 不合适 | Postgres / MySQL（InnoDB） |
| 跨多实体的即席 join 与 BI 报表 | 不合适 | Postgres + 列存 / 数仓 |
| 事件 / IoT 高写入摄取 + 实时聚合 | 合适 | —（或写极端规模时 Cassandra） |
| 访问模式固定的超大规模 KV | 可用但非最优 | DynamoDB / Cassandra |

![选型决策树：从 schema 是否多变且以文档为读写单位出发，依次判断是否需要复杂即席 join 或多实体强事务、访问模式是否固定且极端规模写，最终指向关系型、Dynamo/Cassandra 或 MongoDB](/blog-assets/mongodb-mainline/06-diagram-03.svg)

*图 6.3 选型决策树。 注意 ：第一个分叉问的是访问模式与读写单位，不是"数据像不像表"——这正是 01 章那条主线（为访问模式建模）在选型层的复现。*

想一想

一个团队给出的理由是"数据有嵌套结构，所以选 MongoDB"。按图 6.3，这条理由本身够不够支撑选型？

**展开答案**

不够。"数据有嵌套结构"在 Postgres 里用 JSONB + GIN 索引也能存能查。决策树的第一个分叉不是问"数据长不长得像嵌套文档"，而是问**读写是否以整个文档为单位 + schema 是否每实体多变**。如果嵌套数据其实 schema 稳定、还需要和其他表 join 出报表，那它落在"否"或第二个分叉的"是"，应留在关系型。嵌套结构是表象，访问模式与读写单位才是判据。

<a id="s64"></a>

### 6.4 "丢数据"声誉的事实时间线

"MongoDB 丢数据"的印象来自十多年前的驱动默认值，不是存储引擎缺陷；多个默认在 2012 至 2021 间已逐一改硬。

为什么需要它

这条声誉在技术选型讨论里反复出现，常被当成"别用 MongoDB"的终结性理由。对资深工程师，把它当事实时间线核对一遍，比接受或反驳一个标签更有用——结论应建立在"哪个默认值、什么时候改的"之上。

表 6.3 · 持久性相关默认值的事实时间线

| 时间 | 事件 | 对持久性的意义 |
| --- | --- | --- |
| 2012 之前 | 驱动默认 fire-and-forget（`w:0`，不确认） | "丢数据"的真正根源——是驱动默认值，不是存储 bug |
| 2012-11 | 新 MongoClient 驱动默认改为 `w:1`（确认写入） | 写入默认开始等单节点确认 |
| 3.0（2015） | 引入 WiredTiger（文档级锁 + 压缩）；MMAPv1（集合级锁）弃用 | 并发与崩溃恢复显著改善；MMAPv1 于 4.2（2019）移除 |
| 4.0（2018）/ 4.2（2019） | 多文档 ACID 事务：副本集 → 分片集群 | 跨文档原子性从无到有，覆盖到分片层 |
| 5.0（2021） | 默认 writeConcern 改为 `w:majority` | 默认即多数派持久，掉一个节点不丢已确认写 |

把这条时间线读完，现状是一句话：**现代 MongoDB 默认 `w:majority` + WiredTiger**，"丢数据"印象停留在十多年前那个 `w:0` 的驱动默认值上，与今天的默认行为不符。诚实地补一句与持久性无关、但影响选型的事实：MongoDB 自 2018 年起改用 **SSPL** 许可证（Server Side Public License，OSI 未认可其为开源许可证），它影响自托管再分发与 Linux 发行版打包决策——若计划把 MongoDB 作为服务再分发、或依赖发行版仓库直接提供，需要单独评估这一项。

校准 · 带边界

"默认 `w:majority`"指的是**已确认**的写入在多数派持久。它不保证**未确认**或被显式降级到 `w:1` / `w:0` 的写入——持久性始终是 writeConcern 的函数，由调用方设定。结论不是"MongoDB 现在绝不丢数据"，而是"它的默认值已不再是丢数据的原因"，剩下的责任回到每次写入选用的 writeConcern 上（05 章的 `w` / `j` 语义）。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. targeted 查询和 scatter-gather 查询的差别是什么？是什么决定一条查询属于哪一种？
2. 为什么用单调递增字段（如时间戳或 ObjectId）做 shard key 是反模式？它具体破坏了哪个目标？
3. （设计题）一个内容聚合站点：每篇内容字段差异大、读多写中、几乎不做跨实体 join。该用 MongoDB 还是 Postgres？说出判据。
4. "MongoDB 丢数据"的事实根源是什么？它在何时、由哪个默认值的改变被修复？

**答案（先做完再展开）**

1. targeted 只把请求发给持有相关 chunk 的**那一个分片**；scatter-gather **广播到所有分片**再合并、延迟等于最慢分片。决定因素是查询**带不带 shard key**：带则 mongos 能算出目标分片（targeted），不带则只能全广播（scatter-gather）。
2. 单调递增键的新值总是当前最大，所有新写入落到持有"最大范围"的同一个 chunk / 分片，形成**写入热点**，其余分片闲置。它破坏的是**写入分散**这个目标——分片本是为横向扩展写吞吐，热点让加分片失效。
3. 倾向 **MongoDB**。判据：每实体 schema 多变（文档模型甜区）、以文档为读写单位、几乎不做跨实体 join（避开了关系型的强项区）、读多写中也契合。若该站点其实需要复杂即席报表或多实体强事务，则判据翻转、应留在 Postgres。
4. 根源是 2012 之前驱动的 **fire-and-forget 默认值（`w:0`，不确认写入）**——是驱动默认值不是存储引擎 bug。2012-11 新 MongoClient 默认改 `w:1`，5.0（2021）默认进一步改为 `w:majority`，至此默认即多数派持久。

进阶挑战 · 刚好够不着

#### 给一个多租户 SaaS 做选型判断

需求：多租户 SaaS，每个租户的数据结构可自定义字段（不同租户字段集不同）；读多写中；偶尔要跨租户出 BI 报表。先不查资料，判断：MongoDB 是否合适？哪部分合适、哪部分不合适？shard key 选什么？

**提示（卡住再展开）**

分两种负载看。**OLTP 主体（合适）**：自定义字段 + 每租户独立文档，正好是文档模型甜区；读多写中也契合。shard key 用 `{tenantId, ...}` 这样的 compound：前缀 `tenantId` 把租户数据分散到各分片（兼顾隔离与负载均衡），后缀按需保留查询局部性——避免单调递增热点，也避免单 `tenantId` 低基数导致 jumbo chunk（大租户可再叠一个高基数字段）。**跨租户 BI 报表（不合适）**：这是即席 join / 大范围聚合的弱区，在 OLTP 库上硬跑会拖累线上、且多为 scatter-gather。把分析数据 ETL 到列存 / 数仓单独跑——一个系统里把 OLTP 和分析两种负载分开放，而不是让一个库同时承担两种相反的访问模式。

#### 本章参考

- [Sharding](https://www.mongodb.com/docs/manual/sharding/)（官方 · chunk / mongos / config server / balancer）
- [Choose a Shard Key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/)（官方 · 基数 / 分散 / targeting）
- [MongoDB vs PostgreSQL](https://www.mongodb.com/compare/mongodb-postgresql)（官方对比 · 结合独立基准客观看待）
- [Write Concern](https://www.mongodb.com/docs/manual/reference/write-concern/)（官方 · `w` / `j` 与默认值）
- [SSPL FAQ](https://www.mongodb.com/legal/licensing/server-side-public-license/faq)（官方 · 许可证与再分发影响）

---

<a id="chapter-07"></a>

## 附录：自测题库

前六章建立了从文档模型到分片选型的完整链条。这一章不讲新东西，只逼着把它取出来用——题目分三层梯度，最后六道跨章场景题是真正检验"换没换对脑子"的地方。


**怎么用这一章**

- 所有答案集中在文末一个折叠块里。先把答案写在纸上或编辑器里，再展开对照——直接看答案等于把题目当又读了一遍，零收益。
- 三层梯度：概念层考词汇与定义，原理层考机制（为什么这么设计），应用判别层给场景逼你在多章方案间做选择。
- 卡在原理层或判别层是正常的、也是有用的——那说明题目正好压在还没真正内化的地方。

<a id="gradient"></a>

### 题目的难度梯度

三层不是按章节分，而是按认知动作分：能复述 ≠ 懂机制 ≠ 会在真实场景里选对。判别层最少，却最能暴露问题。

![难度金字塔：底层概念层最宽、中层原理层、顶层应用判别层最窄最难](/blog-assets/mongodb-mainline/07-diagram-01.svg)

*图 7 题目的三层梯度。 注意 ：金字塔越往上越窄、题目越少，但单题信息量越大——能背概念层却答不出判别层，恰恰是"读得顺但没换对模型"的典型信号。*

<a id="concept"></a>

### L1 概念层（对应 01 / 03）

1. BSON 相比文本 JSON，多了哪一类机制性能力？这对引擎读取嵌套字段有什么用？[→ 01 §1.1](#s11)
2. `_id` 的三条硬规则是什么？ObjectId 的 12 字节由哪三段构成？[→ 01 §1.2](#s12)
3. 16MB 文档上限"是信号不是限制"——它具体在提醒检查什么？[→ 01 §1.3](#s13)
4. 一个数组字段建 multikey 索引、100 万文档、平均数组长 20，索引项大致多少？这对写入意味着什么？[→ 03 §3.1](#s31)
5. ESR 规则里 E / S / R 各代表什么？为什么 Equality 必须放最前？[→ 03 §3.2](#s32)
6. Bucket 设计模式解决的是哪一类问题？举一个适用场景。[→ 03 §3.4](#s34)

<a id="principle"></a>

### L2 原理层（对应 02 / 04 / 05）

7. `$lookup` 为什么是嵌套循环而不是 hash join？foreignField 无索引时复杂度是多少？[→ 02 §2.3](#s23)
8. 多计划竞速（multi-planner）和 plan cache 怎么协作？什么时候会 replan？[→ 02 §2.4](#s24)
9. WiredTiger 为什么没有 VACUUM？旧文档版本最终去了哪里？[→ 04 §4.2](#s42)
10. cache 满到阈值后会发生什么？为什么把它叫"延迟悬崖"而不是"逐渐变慢"？[→ 04 §4.3](#s43)
11. checkpoint 和 journal 各自负责持久性的哪一段？崩溃恢复怎么用它们？[→ 04 §4.4](#s44)
12. oplog 条目为什么必须幂等？举一个被改写成幂等形式的操作。[→ 05 §5.1](#s51)
13. 副本集复制协议和 Raft 的两个关键差异是什么？[→ 05 §5.2](#s52)
14. `w:majority` 和 `readConcern: majority` 各自保证什么？组合起来排除了哪种故障？[→ 05 §5.3](#s53)

<a id="discriminate"></a>

### L3 应用判别层（跨章场景 · 最难）

每道题给一个真实场景，要求在多章的方案之间做选择并说出判据。这一层是这份教程的综合压轴——不是考"会不会用某个 API"，而是考"换没换对模型"。

15. **建模 × 查询**：电商系统里"商品"和"库存"，库存被多个端高频独立改写，而商品详情页要同时显示商品信息和当前库存。库存该嵌入商品文档还是引用？说出判据，并指出嵌入会带来哪种写入代价。（01 建模 + 03 嵌入决策 + 02 `$lookup` 代价）
16. **查询 × 索引**：一条聚合很慢，`explain` 显示它对 `$lookup` 的 foreignField 做全集合扫描，且末尾有一个超 100MB 的 `$sort`。瓶颈在哪两处？分别怎么修？（02 `$lookup`/执行 + 03 索引/ESR）
17. **分片 × 访问模式**：多租户 SaaS，写入按租户高度不均（少数大租户占大部分写），偶尔要跨租户出 BI 报表。shard key 选什么？跨租户报表该怎么处理？（06 shard key + 01 访问模式 + 02 scatter-gather）
18. **一致性 × 读写关注**：用户改完个人资料立刻跳转详情页，必须看到刚改的值；而全站用户列表页允许看到稍旧的数据。两处分别怎么配 read preference / readConcern / 会话？（05 读写关注 + 因果一致性）
19. **建模 × 存储**：IoT 设备每秒一条约 200 字节的读数。直接把读数 push 进设备文档的数组里，约 22 小时就撞 16MB。正确的文档粒度是什么？背后是哪个设计模式、为什么也对 cache 友好？（01 16MB + 03 Bucket + 04 cache）
20. **选型判别**：什么时候 PostgreSQL 的 JSONB 比 MongoDB 更合适？反过来，哪三个特征出现时 MongoDB 才真正胜过带 JSONB 的 Postgres？（06 选型 + 01 访问模式主线）

亲手画一张图

合上教程，在纸上或 Excalidraw 里默画 MongoDB 的概念地图——只画 8 个节点（文档模型 / 查询·聚合 / 索引 / schema 设计 / WiredTiger / 副本集 / 分片 / 选型）和它们之间的依赖箭头。画完回到[起点页图 0](#map) 对照：**你有没有画出"索引"和"schema 设计"之间那条"同一个决策"的边？**如果没画出来，回 03 章重读——那条边正是这份教程要你换上的那块模型。

第二张（可选）：默画[图 5.2](#s54) 的写入时间线——标出 `w:1` 在哪个时刻返回成功、哪个时刻起才不可回滚。中间那段缝隙能不能讲清，决定了你有没有真正区分"持久"和"可见"。

<a id="answers"></a>

### 答案

先把上面三层都做完，再展开。给自己的判别层答案打分时，标准不是"措辞对不对"，而是"判据指对没指对、有没有落回访问模式"。

**展开全部答案（先做完再点）**

#### 概念层

1. 多了**带类型与长度前缀的二进制字段编码**，以及 JSON 没有的类型（ObjectId / Decimal128 / Date / Binary / 区分 32/64 位整数）。长度前缀让引擎能不解析整个文档就跳过字段、直接定位到一个嵌套路径。
2. 规则：强制存在、不可变、自带唯一索引。ObjectId = 4 字节时间戳 + 5 字节随机值 + 3 字节自增计数器，三段都能在客户端本地生成，无需访问数据库取序号。
3. 提醒检查：是不是把一个**无界增长的数组**（评论、事件、历史）嵌进了文档。逼近上限几乎总意味着访问模式选错了粒度，应改成分桶或引用。
4. 约 100 万 × 20 = **2000 万个索引项**（multikey 给数组每个元素各存一项）。意味着每次改这个数组都要维护多个索引项，数组越大写入越慢——所以数组要有界。
5. E = Equality（等值）、S = Sort（排序）、R = Range（范围）。Equality 放最前是因为它把 B-tree 扫描缩到一段**连续区间**，后面的 Sort 和 Range 只在这一小段上工作；放后面则失去这个收窄效果。
6. 解决**高频小数据无界增长**的问题——把按时间/批次产生的小数据分桶成多条有界文档，而不是无限嵌进一个数组。典型场景：IoT 读数、日志、按小时聚合的指标。

#### 原理层

7. 因为 `$lookup` 对左侧**每个**输入文档都去右集合查一次，没有关系型优化器的 hash/merge join 策略。foreignField 无索引时，每个左文档触发一次右集合全扫描，复杂度 O(N×M)。修法：给 foreignField 建索引、先 `$match` 缩小左侧、或干脆嵌入。
8. 第一次见到某查询形状，multi-planner 并行试跑多个候选计划一小段，选"产出最多/做最少工作"的胜者存进 plan cache；后续相同形状复用缓存。当数据分布变化或缓存计划表现退化时触发 replan。
9. 因为旧版本不就地覆盖、也不靠后台清理：eviction 做页重整（reconciliation）时，最新值进数据文件、旧版本进磁盘上的 **history store**。回收发生在 eviction/checkpoint 流程里，不需要 Postgres 那样的 VACUUM 扫描死元组。
10. 越过 eviction 阈值后，**应用线程被"征召"同步参与 eviction** 才能继续推进自己的操作。这是一道悬崖而非缓坡——working set 一旦超过 cache，p99 延迟陡升，因为前台线程突然要替引擎打工，而不是后台默默降速。
11. checkpoint（约 60s）落一份一致的磁盘快照；journal/WAL 覆盖两次 checkpoint **之间**的窗口。崩溃恢复 = 加载最后一个完整 checkpoint，再重放它之后的 journal。
12. 因为 secondary 可能重复重放同一批 oplog，幂等保证重放不出错。例：`$inc: {n:1}` 被改写成绝对值 `$set: {n: 实际新值}`；一条改多文档的更新被拆成逐文档条目。
13. 任选两个：(1) 副本集日志是**幂等操作**，不是状态机命令；(2) 复制是 secondary **主动 pull**，不是 Raft 的 leader push（AppendEntries）；(3) commit point 靠 primary 轮询多数节点的 lastDurable 算出，不是逐条计票；(4) 多了 priority takeover 和 dry-run election。
14. `w:majority` 保证写在多数节点 durable 后才返回（故不会因 failover 被回滚）；`readConcern: majority` 保证读到的是 majority commit point 的快照（读到的数据不会被回滚）。组合起来排除了"读到一个稍后会被回滚的写"这种故障。

#### 应用判别层

15. **引用**。库存命中两条"倾向引用"的判据——高频独立写入、写入时机与商品信息不一致；嵌入会造成**更新放大**（改库存要重写整个商品大文档，并制造版本churn）。详情页同时要两者，可在读取时 `$lookup`（给 inventory 的 productId 建索引），或用 Computed/Subset 模式冗余一个"是否有货"的轻量标志到商品文档、精确库存再查。核心：按*写入模式*决定，不按"库存属于商品"这种逻辑归属决定。
16. 两处瓶颈：(1) `$lookup` 的 foreignField 全扫描——给 foreignField 建索引，并把 `$match` 提到 `$lookup` 之前缩小左侧输入；(2) 超 100MB 的 `$sort` 内存溢出——用**索引支撑的排序**（按 ESR 把 sort 字段放进复合索引的正确位置），实在不行才开 `allowDiskUse`。两处分别对应 02 章的执行机制和 03 章的索引设计。
17. shard key 用 **compound**，如 `{tenantId, 某高基数字段}`：tenantId 提供租户隔离与查询定向，第二字段把大租户内部的写入分散开，避免单调递增热点。纯 `tenantId` 会让大租户变成 jumbo chunk。跨租户 BI 报表是即席聚合的弱区，且会变成 scatter-gather——把分析数据 ETL 到列存/数仓单独跑，**不要**在 OLTP 分片库上硬跑全表聚合。一个系统两种负载分开放。
18. 详情页要 read-your-writes：用**因果一致性会话**（causally consistent session）+ `readConcern: majority`，或直接读 primary，保证读到刚写的值。列表页容忍旧值：可读 secondary + `readConcern: local` 换吞吐。关键是**按访问点分别选一致性级别**，不是全站一刀切——这正是把一致性当连续谱而非布尔。
19. 正确粒度是**设备 + 时间窗**（如每设备每小时一条文档，内含该小时的读数数组），即 **Bucket 模式**。它对 cache 友好的原因：WiredTiger 以整个文档为载入单位，有界的小桶文档不会像无界大文档那样把热数据挤出 cache；分桶把读写都限制在固定大小的文档上。
20. JSONB 更合适当：JSON 只是整体关系模型里的**少数**字段、需要把 JSON 与强类型表 join、或 schema 迟早会硬化下来（GIN 索引能查 containment）。MongoDB 真正胜出需要三个特征同时出现：**整个模型是文档** + 读写**以单个文档为单位** + 需要**原生水平写分片**。只满足"有点 JSON"不构成换库理由。

进阶挑战 · 刚好够不着

#### 把这份教程压成一页选型备忘

不看教程，写一页"MongoDB 选型 + 建模"备忘录给团队：包含 (1) 三个"该上 MongoDB"的信号、(2) 三个"别上"的信号、(3) 嵌入 vs 引用的四问、(4) shard key 的两条红线、(5) 一句话的持久性配置默认建议。写完和各章对照，缺哪条就回哪章。

**提示（卡住再展开）**

骨架：该上=schema 多变 + 以文档为读写单位 + 要水平写扩展；别上=重多实体事务 + 复杂即席 join/BI + 强关系约束。四问=一起读/无界/共享/写入时机。红线=不用单调递增键、不用低基数键。默认=`w:majority` 起步，按访问点调 readConcern。每一条都能在前六章找到出处。

#### 把整套串起来的延伸阅读

- [Data Modeling](https://www.mongodb.com/docs/manual/data-modeling/)（官方 · 建模总入口，串起 01 / 03）
- [Building With Patterns: A Summary](https://www.mongodb.com/blog/post/building-with-patterns-a-summary)（官方博客 · 设计模式全景）
- [Jepsen: MongoDB 4.2.6](https://jepsen.io/analyses/mongodb-4.2.6)（独立一致性分析，校准 05 章的边界）
- [MongoDB 8.0 Release Notes](https://www.mongodb.com/docs/manual/release-notes/8.0/)（现状的权威来源）

---

## 结语：所有问题最终都回到文档边界

如果只记住一件事，请记住：**先画访问模式，再画文档结构。**

- 文档边界决定一次读写要搬动多少数据；
- 查询形态决定索引的字段和顺序；
- 工作集大小决定 WiredTiger cache 是否稳定；
- 一致性要求决定读写关注级别；
- 数据分布与路由方式决定 shard key；
- 当这些前提无法稳定成立时，关系型数据库可能才是更合适的选择。

MongoDB 的优势不是“没有 schema”，而是允许 schema 围绕访问路径组织。它的代价也来自同一个地方：一旦访问模式判断错误，冗余、超大文档、昂贵的 `$lookup`、热点分片和一致性复杂度会沿着整条链条依次出现。
