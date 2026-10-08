---
title: Elasticsearch：从“会用”到“会推导”
description: 以“Lucene segment 不可变”和“主分片数量固定”为两条公理，串起 mapping、近实时写入、BM25、分布式检索、doc_values 与技术选型。
date: 2026-10-06
tags: Elasticsearch, 搜索引擎, 分布式系统
featured: true
---

> **核心结论**：Elasticsearch 的许多“怪行为”都可以从两条底层事实推出：Lucene segment 不可变，主分片数量固定。写后暂时搜不到、删除后磁盘不立刻下降、相同文档在不同分片得分有偏差、主分片数不能原地修改，都是这两条公理的后果。

本文由 `F:\fde\把 Elasticsearch 从会用推到会推导` 中的 5 个离线 HTML 页面整理合并，保留代码、表格、自测题与 13 张原理图，并把原站内跨页链接改为本文锚点。

> **资料基线说明**：原教程标注“截至 2026-06”，并以 Elasticsearch 9.x 为版本背景。本文整理日期为 2026-10-06，没有联网复核此后版本状态；涉及“最新版本”、许可证和新功能成熟度时，应把文中的日期视为资料快照，并以 Elastic 官方文档为准。示例用于解释机制，未连接真实集群逐条执行验证。

## 目录

- [导读：两条公理，推导 Elasticsearch 的怪行为](#guide)
- [第 1 章：名词地图与集群拓扑](#chapter-01)
- [第 2 章：写入路径——为什么是“近实时”](#chapter-02)
- [第 3 章：检索、相关性与聚合](#chapter-03)
- [第 4 章：自测与场景辨析](#chapter-04)

---

<a id="guide"></a>

## 导读：两条公理，推导 Elasticsearch 的怪行为

基于 ES 9.x（核心模型适用 7/8/9 全系）· 阅读约 2 小时 · 概念向：DSL/配置示例用于说明机制，未在本地集群逐一执行验证。

<a id="for-whom"></a>

## 适合谁

这份教程面向**已经用过 Elasticsearch、但底层没打通**的工程师。具体到能力：

- 建过 index、写过 `match` / `term` 这类查询、能读懂一段 query DSL——但说不清它们在底层发生了什么。
- 遇到过"写完搜不到""聚合报错""打分不对"，靠搜索引擎贴答案解决过，但没有形成可复用的解释。
- 想要的是**一套能自己推导的心智模型**，而不是又一份 API 速查。

<a id="not-for-whom"></a>

## 不适合谁

- **完全没碰过 ES**：先去官方 [Quick start](https://www.elastic.co/docs/get-started) 跑通"建一个 index、写几条文档、搜一次"，建立手感再回来。
- **只想要可运行代码 / 运维调参手册**：这版是概念向。需要代码渐进与实战的，走"动手向"教程；需要集群容量规划的，看官方 [Production guidance](https://www.elastic.co/docs/deploy-manage/production-guidance)。
- **要深入向量检索 / RAG**：本教程只在末章选型里点到向量能力，不展开 kNN / 混合检索的教学（那是另一个独立主题）。

<a id="outcomes"></a>

## 读完之后你能做到什么

这份教程给你的、官方文档单独给不了的那一样东西：**把 ES 的行为当作两条公理（段不可变 + 分片固定）的可推导推论——遇到反直觉现象先推导、再查证，而不再靠背结论。**具体可验证的能力：

- 推导出"刚写入的文档为什么默认 1 秒内搜不到"，并说清 refresh / flush / merge 各自负责什么。
- 解释"两个内容相同的文档为什么打分不同"，并指出 `dfs_query_then_fetch` 在补什么。
- 判断一个字段该用 `text` 还是 `keyword`，并说明错配会触发哪种失败（搜不到 / 聚合 OOM）。
- 说清"主分片数为什么创建后不能改"，把它还原成路由公式里的一个除数。
- 在 Elasticsearch、PostgreSQL 全文检索、专用向量库之间，做出有依据的选型判断。

**一句话本质 · Threshold**

Elasticsearch 的绝大多数"怪行为"不是一张要背的特性清单，而是两个底层事实的推论：**① 底层是一堆*不可变*的 Lucene segment；② 数据被水平切成*固定数量*的 shard。**抓住这两条，写后不可见、打分偏差、`text` 不可聚合、分片数不可变——全都能自己推出来。

**现状速览 · 截至 2026-06**

**原资料版本基线**：资料标注 Elasticsearch 9.4.2（2026-05），9.x 基于 Lucene 10；核心模型适用 7 / 8 / 9 全系。

**稳定多年**：倒排索引、mapping、query DSL、分片模型多年未动；BM25 自 ES 5.0（2016）起为默认打分；mapping types（`_type`）已在 8.0（2022）彻底移除。

**仍在快速变化（不在本教程展开）**：ES|QL 管道查询语言（GA 自 8.14 / 2024-06，9.0 起支持 JOIN）；向量量化 BBQ（自 9.1 / 2025-07 成为 ≥384 维向量默认）；`semantic_text` 与内置推理（8.18 / 2025-04 GA）。

**许可证**：2021 从 Apache 2.0 转 SSPL / ELv2；2024-09 加回 AGPLv3，现为三选一（AGPLv3 / SSPL / ELv2）——常被误记成"只剩 SSPL"。

**读之前 · 关于"读懂了"的错觉**

ES 的概念彼此勾连，最容易产生"懂了"的假象。读的过程中用这三句话自检：

**"我读得很顺"**——顺 ≠ 懂。合上页面，能不能把"一条文档从写入到能被搜到"的链路讲出来？讲不出就是没懂。

**"我做题很快"**——如果自测题你只是在复述定义，说明还没碰到机制层；机制层的题会让你卡住。

**"我没卡壳"**——真正吃透的标志，是能从"段不可变 / 分片固定"推出一个你没见过的现象，而不是读的时候没有疑问。

<a id="concept-map"></a>

## 概念地图

下面这张图是整份教程的骨架。后面每一章都是在给这张图的某个节点补充机制细节。

![Elasticsearch 概念地图：索引由不可变 segment 和固定数量 shard 组成，两者各自派生出写入与检索行为](/blog-assets/elasticsearch-derivation/diagram-01.svg)

*图 0.1 整份教程的骨架：索引 = 不可变 segment（左）+ 固定 shard（右）。 注意 ：朱红色的两个节点是全图的"公理"，下面所有灰色节点都是从它们派生出来的现象——这正是本教程要训练的推导方向。*

<a id="routes"></a>

## 怎么读这份教程

顶部的学习路径就是章节顺序（当前停在"00 起点"）。按目标选一条路径：

**想系统吃透原理**

按 01 → 02 → 03 → 04 顺序读完。这是默认路径，每章建立在前一章之上，末章用跨章场景题检验你是否真的打通。

**只想搞懂某个困惑**

"写完搜不到 / 删除后磁盘不降"看 [02 写入](#chapter-02)；"打分不对 / text 不能聚合 / 分片数不能改"看 [03 检索](#chapter-03)。但概念词汇先扫一眼 [01](#chapter-01)。

**做选型 / 带读他人代码**

读 [01](#chapter-01) 建立词汇 → 直接跳 [04 自测](#chapter-04) 末尾的"ES vs PG vs 向量库"选型辨析；需要论据时回查 02 / 03。

<a id="toc"></a>

## 分章概要

- [01 · CONCEPTS：名词地图与集群拓扑](#chapter-01)——document / mapping / index / shard / segment 的层级关系；text 与 keyword 这条最高频的认知分水岭。
- [02 · WRITE PATH：写入路径：为什么是"近实时"](#chapter-02)——倒排索引怎么建、refresh 为何带来 1 秒延迟、translog 与持久化、merge 与"删除不真删"——全是"段不可变"的推论。
- [03 · SEARCH PATH：检索、相关性与聚合](#chapter-03)——query 与 filter 的分野、BM25 怎么打分、分布式两阶段检索为何让相同文档打分不同、doc_values 怎么撑起聚合——全是"分片 + 不可变段"的推论。
- [04 · SELF-CHECK：自测与场景辨析](#chapter-04)——三层梯度自测 + 跨章场景题 + 动手画图 + ES vs PostgreSQL / 向量库 / ClickHouse 选型辨析。

<a id="after"></a>

## 学完之后

这份教程之后，几个自然的下一步（每个都在你已有的 schema 上加一块）：

- **向量与混合检索**：在"倒排索引"之外加一条 kNN / HNSW 的检索路径，以及 RRF 把两者融合——给 RAG 用。
- **聚合进阶**：bucket / metric / pipeline 聚合，把 ES 当分析引擎用，对应到 doc_values 的列式读取。
- **集群运维与容量**：分片数与节点数怎么定、ILM 生命周期、冷热架构——把"分片固定"这条公理推到生产规模。
- **ES|QL**：新的管道式查询语言，在 query DSL 之外提供一种更接近 SQL 管道的表达方式。

### 本教程参考

- [Elasticsearch Glossary](https://www.elastic.co/docs/reference/glossary)（官方术语表）
- [Practical BM25](https://www.elastic.co/blog/practical-bm25-part-1-how-shards-affect-relevance-scoring-in-elasticsearch)（官方 · 相关性打分与分片）
- [Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)（官方 · 近实时机制）
- [What's new in Elasticsearch 9.0](https://www.elastic.co/blog/whats-new-elastic-search-9-0-0)（官方 · 版本现状）

---

<a id="chapter-01"></a>

## 第 01 章：名词地图与集群拓扑

起点给了你整张概念地图——这一章把图上的名词逐个定义清楚，重点是 cluster→node→index→shard→segment 谁装谁，以及 text / keyword 这条最高频的认知分水岭。

**本章你将建立的 schema**

- ES 里"东西"的层级：cluster / node / index / shard / Lucene segment 谁装谁
- 一条文档的解剖：document / field / _source / mapping
- text 与 keyword 的本质区别，以及为什么它是最高频的字段错配来源

这一章只做一件事：把名词钉死。后面两章讲机制（写入为什么近实时、检索为什么打分会偏），靠的全是这一章建立的词汇——如果"shard 和 segment 谁装谁"还含糊，那两章会读得磕磕绊绊。所以这里给每个名词一个 ≤30 字的硬定义，再往下挖一层机制，最后用一个类比收尾（并指出类比在哪里失效）。

![集群拓扑层级：cluster 包含 node，index 切成 shard 分布在 node 上，shard 内部由多个不可变 segment 组成](/blog-assets/elasticsearch-derivation/diagram-02.svg)

*图 1.1 cluster ⊃ node ⊃ shard ⊃ segment 的物理嵌套，index 是横跨多个 node 的逻辑分组。 注意 ：shard 才是 Lucene index 的边界——一个 shard 内部由若干 segment 累加而成，segment 一旦写出只增不改（02 章整章建在这条上）；index 本身不在任何单台机器上，它只是"这批 shard 属于同一类文档"的名字。*

图 1.1 是这一章的总纲。下面五节，就是把这张图里的每个框单独拎出来定义。读的顺序是从最小的单位（一条文档）往外扩，再下钻到最底层（segment），最后落到那条最高频的字段分水岭。

<a id="s11"></a>

### 1.1 文档与字段 · document / field / _source

document 是一条 JSON 对象，写入与检索的基本单位；field 是它的键值对；_source 是原始 JSON 的完整副本。

**为什么需要它**

ES 不是按行存表，它按"文档"存。一条文档就是一个完整的 JSON 对象——一个商品、一篇日志、一个订单。把"基本单位"定成 JSON 而不是表行，是因为真实数据天然嵌套（一个商品有多个标签、一段地址有省市区），用一个自描述的 JSON 装进去，比拆成多张表再 JOIN 更贴合搜索场景。

field 就是文档里的每一个键值对：`"title": "无线降噪耳机"` 是一个 field，`"price": 899` 是另一个。每个 field 有自己的类型（由 mapping 决定，见 1.2），类型决定它怎么被存、怎么被搜。

#### 底层机制（比文档深一层）：_source 和"用于搜索的结构"是两份存储

这是全章第一个、也是最容易被忽略的机制点。把一条文档写进 ES，它在底层至少被拆成**两份不同的存储**：

- **用于搜索的倒排结构**：把字段值切成一个个 term，记录"哪个 term 出现在哪些文档里"。这份结构*不保留原文*——它只知道 `"无线"` 这个 term 出现在文档 1、文档 7，但拼不回原始那句 `"无线降噪耳机"`。
- **`_source`**：写入时原始 JSON 的一份完整、未经处理的副本，单独存在磁盘上。

检索时，倒排结构负责"找到哪些文档命中"，但返回给你看的那段 JSON 是从 `_source` 里取出来的——因为倒排结构根本还原不了原文。这就解释了一个常被当成理所当然、其实很关键的事实：**索引结构 ≠ 原文，两者是分开存的。**关掉 `_source`（`"_source": {"enabled": false}`）能省磁盘，但代价是命中后拿不回原始文档、也没法 reindex——这正是因为搜索结构里没有原文可还原。

**洞察 · 一份写入，多份存储**

"索引结构 ≠ 原文"是后面所有内容的起点。01 章只需记住"原文单独存在 `_source` 里"；到 03 章会再加一份：`keyword` 字段还会建第三份存储 doc_values（列式，专供聚合排序）。同一个字段值，按用途被存成好几份——这不是浪费，是 ES 用空间换"既能搜又能聚合"的核心手段。

#### 类比（带边界）

document 像数据库里的一行记录，field 像一个列。但边界在于：行记录的 schema 是建表时定死的、所有行共享一套列；ES 文档则是 schema-on-write 的 JSON，*每条文档可以带不同的字段*，mapping 在第一次见到新字段时才动态长出来（见 1.2）。把它当成"严格的表行"会在这里翻车。

#### 小例子

**index 一条文档**

```bash
PUT /products/_doc/1
{
  "title": "无线降噪耳机",
  "brand": "Acme",
  "price": 899,
  "tags": ["audio", "wireless"]
}
```

- `products` 是 index（这类文档的集合，见 1.2），`_doc` 是固定端点，`1` 是这条文档的 `_id`。
- 请求体整段就是这条 document；`title` / `brand` / `price` / `tags` 是它的 field。
- 这段 JSON 会被原样存进 `_source`；同时每个字段按各自类型被拆进搜索结构。两份存储，一次写入。

**与下一个概念的关系**：一条文档要被存、被搜，ES 得先知道每个字段是什么类型、走哪条索引路径——这套"字段规则"就是 mapping，下一节。

<a id="s12"></a>

### 1.2 索引与 mapping · index / mapping

index 是一类文档的集合（逻辑分组）；mapping 是定义每个字段如何被存储和索引的 schema。

**为什么需要它**

同一类文档（所有商品）放进同一个 index，才能一次性搜整批、共享一套字段规则。而 mapping 回答的是"这个字段到底怎么处理"——是切词做全文检索，还是原样存好做精确匹配？是不是要额外建一份列式结构好做聚合？没有 mapping，ES 不知道把 `"2026-06-01"` 当日期还是当字符串，更不知道该不该给它分词。

#### 底层机制（比文档深一层）：mapping 决定字段走哪条索引路径

mapping 不是"声明一下类型"那么轻。它实际决定了每个字段在底层被处理成什么：

- **要不要分词**：`text` 类型的字段会过 analyzer 被切成多个 term；`keyword` 不分词、整串存一个 term（详见 1.5）。
- **要不要建 doc_values**：大多数非 `text` 字段默认建 doc_values——一份列式磁盘结构，专门支撑排序和聚合（细节在 03 章）。`text` 默认不建，所以直接对 `text` 聚合会失败或退化。

同一个字符串值，因为 mapping 不同，可以走完全不同的两条路。这就是为什么 1.5 那条分水岭如此重要——而它的根，就在 mapping。

**陷阱 · dynamic mapping 的"意外字段"**

不预先定义 mapping 时，ES 用 **dynamic mapping**：第一次见到某个字段，就按值*推断*一个类型并固定下来。方便，但有两个失败模式：① 第一条文档里 `"id": "00123"` 被推断成 `text`，后面想当数字用就晚了——**已存在字段的类型不能原地改**；② 日志里塞进上千个动态 key，mapping 爆炸（mapping explosion），拖垮集群。生产环境对结构稳定的数据，显式写 mapping 比依赖推断稳得多。

#### 类比（带边界）

mapping 像关系数据库的表结构（`CREATE TABLE` 里的列类型）。但边界有两条：① 它默认是*动态*的，能在写入时自动长出新列，而建表语句是静态的；② 一个字符串字段默认会被映射成**两个**可用形态——字段本身是 `text`，外加一个 `.keyword` 子字段（这叫 multi-field），相当于"一列同时存了分词版和原样版"。关系数据库没有这种"一列两形态"的概念。

#### 小例子

**显式定义 mapping**

```bash
PUT /products
{
  "mappings": {
    "properties": {
      "title": { "type": "text" },
      "brand": { "type": "keyword" },
      "price": { "type": "integer" }
    }
  }
}
```

- `title` 声明为 `text`：会被分词，用于全文检索（搜"耳机"能命中"无线降噪耳机"）。
- `brand` 声明为 `keyword`：原样存，用于精确过滤和聚合（按品牌分组统计）。
- `price` 声明为 `integer`：默认建 doc_values，可做范围过滤、排序、求和。
- 这里显式区分了 `text` 和 `keyword`；若不写 mapping，`title` 和 `brand` 都会被 dynamic mapping 推断成 `text` + `.keyword` 子字段的组合形态。

![一条文档按 mapping 拆成多个字段，每个字段按类型走不同的索引路径](/blog-assets/elasticsearch-derivation/diagram-03.svg)

*图 1.2 同一条文档拆成多个字段后，每个字段按 mapping 里的类型走 不同 的索引路径。 注意 ：路径分叉发生在字段类型这一层—— text 只进倒排（朱红，分词后可搜但不可聚合）， keyword / 数值额外进 doc_values（可聚合排序）。这张分叉图就是 1.5 那条分水岭的全貌预览。*

**与下一个概念的关系**：到这里"一条文档怎么被定义、被拆分"清楚了。但这些文档物理上存在哪、怎么扛住单机放不下的数据量？答案是被切片分到多台机器上——这就是集群拓扑。

<a id="s13"></a>

### 1.3 集群拓扑 · cluster / node / shard 主副本

cluster 是一组协同的 node；node 是一个 ES 进程；shard 是 index 被切成的片，每片是一个独立的 Lucene index。

**为什么需要它**

一个 index 的数据量可以远超单台机器的内存和磁盘。把它水平切成若干 shard、分布到多个 node，单机放不下的数据就放下了，单机扛不住的查询也能并行分摊。primary / replica 的主副本设计则同时解决两件事：**容灾**（一台 node 挂了，副本顶上）和**查询吞吐**（读请求可以打到副本上分担）。

#### 底层机制（比文档深一层）：写读如何在分片上并行

index 在*创建时*被切成 N 个 primary shard，由 ES 分布到不同 node 上。每个 primary 可以配置若干 replica（副本）。三条关键规则：

- **写入只走 primary**：一条文档先被路由到某个 primary shard 写入，再由它同步给自己的 replica。primary 是这条文档的"写入权威"。
- **读可走 primary 或 replica**：查询时，每个 shard（primary 或它的某个 replica，由协调节点挑）并行执行，结果再汇总。replica 越多，并发读吞吐越高。
- **primary 与它的 replica 不同 node**：否则那台 node 一挂，主副本一起没，容灾就失效了。

**公理 · 主分片数创建后固定**

primary shard 的**数量在 index 创建时定死，之后不能改**。原因在 03 章会还原成一个路由公式：一条文档落到哪个 shard，由 `hash(_routing) % primary_数量` 决定；除数一变，所有老文档的归属全乱。这条"分片数固定"是与"段不可变"并列的第二条公理——记住结论，机制留到 03 章。（replica 数量则可以随时调整，它不参与路由计算。）

#### 类比（带边界）

shard 像分库分表里的一个"分片"——数据按某种规则散到多个库。但边界在于：分库分表的分片是逻辑划分，底层还是普通的库表；ES 的每个 shard 是一个**完整、独立、自包含的 Lucene index**——它自己有完整的倒排索引、自己的 segment、能独立完成一次搜索。换句话说，shard 不是"半个索引"，而是"一个小而全的索引"。这一点直接通向下一节。

#### 小例子

**创建时指定分片数**

```bash
PUT /products
{
  "settings": {
    "number_of_shards": 2,
    "number_of_replicas": 1
  }
}
```

- `number_of_shards: 2`：这个 index 被切成 2 个 primary shard（图 1.1 里的 P0、P1）。这个数*之后不能改*。
- `number_of_replicas: 1`：每个 primary 配 1 个副本，于是共 2 primary + 2 replica = 4 个 shard，分布到不同 node。这个数*可以随时改*。
- 查"耳机"时，2 个 primary（或它们的 replica）并行各搜一半数据，结果汇总返回。

**与下一个概念的关系**：既然一个 shard 就是一个完整的 Lucene index，那 Lucene index 内部又长什么样？下钻最后一层——segment。

<a id="s14"></a>

### 1.4 Lucene segment

segment 是 Lucene 写在磁盘上的不可变数据文件；一个 shard 由多个 segment 累加组成。

**为什么需要它**

倒排索引一旦建好，原地插入一个新文档代价极高——要在无数个 term 的 postings 列表中间见缝插针。Lucene 的解法是：**不改旧的，只写新的**。新文档攒一批，打包成一个全新的 segment 写到磁盘，旧 segment 原封不动。一个 shard 就是一摞这样的 segment 叠加而成。这条"只增不改"是整个写入模型能高效运转的根。

#### 底层机制（关键，比文档深一层）：shard 是一摞只增不改的 segment

把一个 shard 的内部摊开，它不是一块整数据，而是**一摞 segment**——每个 segment 自己是一个迷你倒排索引，包含一批文档的全部索引结构。核心性质只有一条，但它撑起后面整整一章：

每个 segment 一旦写出，就再也不被修改——immutable。

"不可变"带来三个直接推论，这里只点名、细节全在 02 章：

- **近实时（refresh）**：新文档要先被打包成一个新 segment、且这个 segment 对搜索可见，才能被搜到。这个动作默认每 1 秒做一次——这就是"写完默认 1 秒内搜不到"的来源。*细节在 02 章。*
- **删除不真删**：既然 segment 不可改，删一条文档就不能从 segment 里抠掉，只能在一个单独的 `.del` 标记里记一笔"这条已删"，搜索时跳过。磁盘空间当时并不释放。*细节在 02 章。*
- **段合并（merge）**：segment 越攒越多会拖慢搜索，ES 在后台把多个小 segment 合并重写成一个大的——这时被标删的文档才真正被丢弃、磁盘才回收。*细节在 02 章。*

**类比 · 带边界声明**

segment 像一本只追加的账本：写错了不涂改旧页，而是翻到新页记一笔更正，旧页永远保留。这个类比抓住了"不可变 + 只追加"的精髓。**但边界在这里**：普通账本不会回头重抄，ES 却会在后台把旧页合并、重抄成新页（merge），并在重抄时把作废的记录彻底丢掉。所以更准确的说法是"一本会定期被誊清的只追加账本"。

想一想

把一个 index 的数据想象成"一摞只增不改的 segment"。那么"更新一条已存在的文档"，在这摞 segment 上到底意味着什么操作？（提示：旧 segment 不能改。）

**展开答案（先停 10 秒再点）**

不是"原地改"，而是**新写 + 标删**：把更新后的整条文档作为一条新文档写进一个新 segment，同时在旧文档所在位置打上"已删除"标记。于是同一个 `_id` 在物理上短暂存在新旧两份，靠"标删 + 取最新"对外表现为一次更新。

这也解释了为什么 ES 里没有"部分字段原地更新磁盘"这回事——所谓 partial update，底层也是"读出整条 → 改内存 → 整条重写新 segment"。旧版本要等 merge 时才被真正清理。完整的写入链路、版本号怎么保证取到最新，*都在 02 章*。

**与下一个概念的关系**：到这里"东西的层级"从 cluster 一路下钻到了 segment。但有一个贯穿始终、决定字段能不能搜、能不能聚合的分叉还没正面讲——它发生在字段类型这一层，是日常最高频的错配来源。

<a id="s15"></a>

### 1.5 text vs keyword · 认知分水岭

text 过 analyzer 切成多个 term，可全文检索、不可直接聚合排序；keyword 原样存一个 term，可精确匹配/排序/聚合、不做全文相关性匹配。

**为什么需要它**

"搜文章正文"和"按状态精确分组统计"是两种根本不同的需求。全文检索要把句子切成词、忽略大小写、容忍词序——这要分词。精确匹配和聚合要的恰恰相反：原值一字不差、能当 key 分桶。一个字段类型满足不了两种需求，所以 ES 把字符串劈成两类：`text` 管搜，`keyword` 管精确与聚合。判断一个字段该用哪个，是日常最高频的设计决策，错配会直接触发"搜不到"或"聚合报错"。

#### 底层机制（比文档深一层）：分词路径 vs 列式路径

两种类型在底层是两条完全不同的处理流水线：

- **`text` → 过 analyzer → 进倒排**：analyzer 是一条三段流水线——char filter（预处理字符）→ tokenizer（切词）→ token filters（如小写化、去停用词）。`"Quick Fox"` 经标准 analyzer 产出 term `[quick, fox]`（注意：小写、拆成两个），这些 term 进倒排索引。`text` *默认不建 doc_values*，所以直接对它聚合/排序会退化到一种叫 fielddata 的堆上结构——把字段值临时加载进 JVM 堆，数据量一大极易 OOM。*fielddata / doc_values 的细节在 03 章。*
- **`keyword` → 不分词 → 进倒排 + doc_values**：`"Quick Fox"` 原封不动作为*单个* term 存入（大小写、空格全保留），同时默认建 doc_values——一份列式磁盘结构，专供聚合和排序高效读取。所以 `keyword` 能分组统计、能排序，但你搜"fox"匹配不到它（它存的是整串 `"Quick Fox"`，不是 `fox`）。

![同一个字段值 Quick Fox 向下分两条路：text 经 analyzer 切成 quick fox 进倒排，keyword 整串一个 term 进 doc_values](/blog-assets/elasticsearch-derivation/diagram-04.svg)

*图 1.3 同一个原始值 "Quick Fox" ，按字段类型走两条互补的路： text 切成小写 term 进倒排（左，朱红）， keyword 整串进 doc_values（右）。 注意 ：两条路的能力恰好互补——一边能搜不能聚合，另一边能聚合不能搜。这正是 dynamic mapping 默认给字符串 同时 建 text 和 .keyword 子字段（multi-field）的原因：让你既能用字段本身全文搜，又能用 .keyword 聚合排序。*

#### 这是全章最重要的一节：term 不分词，match 才分词

错配几乎都源于一个混淆：`term` 查询**不分词**，`match` 查询**会分词**。对一个 `text` 字段用 `term` 查原始整句，往往一条都命中不了——因为倒排里存的是小写切词后的 token，不是你给的原句。

想一想

一个字段 `title` 走默认 dynamic mapping（即被映射成 `text` + `.keyword`），写入一条文档 `{"title": "Hello World"}`。然后执行 `{"term": {"title": "Hello World"}}`。命中吗？

**展开答案（先停 10 秒再点）**

**不命中。**`title` 是 analyzed `text` 字段，写入时 `"Hello World"` 被 analyzer 切成并小写化为 `[hello, world]` 两个 term 存进倒排。而 `term` 查询*不分词*，它拿着原始字符串 `"Hello World"`（带空格、带大写）去倒排里找一个一模一样的 term——倒排里只有 `hello` 和 `world`，没有 `"Hello World"`，所以零命中。

三种修法，各对应一个正确心智模型：① 想全文搜，用 `{"match": {"title": "Hello World"}}`——`match` 会把查询词同样分词成 `[hello, world]` 再匹配，命中。② 想精确匹配整串，查子字段 `{"term": {"title.keyword": "Hello World"}}`——`.keyword` 存的就是原样整串。③ 这也直接说明聚合为什么要用 `title.keyword` 而不是 `title`：聚合需要原值当 key，分词后的 `text` 给不了。

#### 小例子

**term 落空 → match 命中 → 聚合用 .keyword**

```bash
# 写入（title 走 dynamic mapping，得到 text + title.keyword）
PUT /docs/_doc/1
{ "title": "Hello World" }

# ① term 查 analyzed text 字段 —— 0 命中（倒排里是 [hello, world]）
GET /docs/_search
{ "query": { "term": { "title": "Hello World" } } }

# ② match 会分词 —— 命中
GET /docs/_search
{ "query": { "match": { "title": "Hello World" } } }

# ③ 精确匹配 / 聚合，走 .keyword 子字段
GET /docs/_search
{
  "query": { "term": { "title.keyword": "Hello World" } },
  "aggs":  { "by_title": { "terms": { "field": "title.keyword" } } }
}
```

表 1.1 · text 与 keyword 的能力对照

| 维度 | text | keyword |
| --- | --- | --- |
| 写入时处理 | 过 analyzer，切成多个小写 term | 不分词，原样整串存一个 term |
| 底层存储 | 倒排索引（默认无 doc_values） | 倒排 + doc_values（列式） |
| 全文检索（match） | 支持，这是它的本职 | 不做相关性匹配 |
| 精确匹配（term） | 对原句几乎总落空 | 支持，匹配整串 |
| 聚合 / 排序 | 默认禁用；强开退化到 fielddata（易 OOM，详见 03 章） | 支持，走 doc_values 高效完成 |
| 典型字段 | 文章正文、商品标题、日志消息 | 状态、标签、品牌、枚举、ID |

**与全章的关系**：1.1–1.4 建立了"东西的层级"，1.5 这条分水岭则贯穿其中——它发生在 1.2 的 mapping 这一层，决定字段值在 1.4 的 segment 倒排里以什么形态存在。下一章（02 写入路径）会把 1.4 的"段不可变"展开成完整的写入与近实时机制；再下一章（03 检索路径）会把 1.5 里点到的 doc_values / fielddata、以及 1.3 里点到的分片路由公式补全。

### § 本章 self-check

先合上教程，把你能想到的答案写在纸上或编辑器里。
写完再点开答案对照——直接点开等于把这一节当再读一遍。

1. 用一句话说清 cluster / node / index / shard / segment 的包含关系：谁装谁？其中哪一层才是"一个完整的 Lucene index"的边界？
2. 检索命中后返回给你看的那段 JSON，来自哪份存储？为什么倒排结构本身还原不了它？
3. （设计层）一个字段写入的全是 `"已发货" / "已签收"` 这类固定状态值，业务只需要"按状态精确过滤 + 分组统计数量"，从不做模糊搜索。该把它设成 `text` 还是 `keyword`？如果误设成默认的 `text`，分别会在"过滤"和"聚合"上撞到什么失败？

**答案（先做完再展开）**

1. cluster ⊃ node ⊃ shard ⊃ segment；index 是横跨多个 node 的逻辑分组（不在单台机器上），它被切成的 shard 才落在具体 node 上。"完整 Lucene index 的边界"是 **shard**——每个 shard 是一个独立自包含的 Lucene index，内部由多个 segment 累加而成。
2. 来自 **`_source`**（写入时原始 JSON 的完整副本，单独存储）。倒排结构只记录"哪个 term 出现在哪些文档"，把原文切碎成 term 后并不保留原始字符串，所以还原不了文档原文——这就是"索引结构 ≠ 原文"。
3. 应设成 **`keyword`**：状态值要的是原样精确匹配和分组，正好是 keyword 的本职。若误设成 `text`：① *过滤*上，`term` 查 `"已发货"` 可能落空（被 analyzer 处理过，且 `text` 不为精确匹配而生）；② *聚合*上，对 `text` 直接做 terms 聚合默认被禁止，强行打开会退化到 fielddata 把字段值加载进 JVM 堆，状态基数虽小风险尚可，但在高基数字段上就是典型的 OOM 来源（详见 03 章）。正确做法：直接声明 `keyword`，或退而用 dynamic mapping 自动生成的 `.keyword` 子字段。

**进阶挑战 · 刚好够不着**

#### 一个字段，既要精确聚合、又要全文搜

有个 `company` 字段，存公司名如 `"Acme Industrial Co."`。业务有两个看似矛盾的需求：① 报表要**按公司名精确分组**统计每家公司的订单数（整串当 key，不能被切词）；② 搜索框要支持**对公司名做全文搜**（输入"industrial"能召回这家）。一个字段类型满足不了两者——你的 mapping 该怎么设计，让这一个字段同时具备两种能力？写出 mapping 片段，并说清查询时各自该引用哪个名字。

**提示（卡住再展开）**

回看 1.2 的类比边界和图 1.3 的 figcaption：一个字符串值可以*同时*存成两种形态。把 `company` 设成 `text`（供 ① 全文搜），并在它下面挂一个 `keyword` 类型的子字段（供 ② 精确聚合）——这就是 multi-field。全文搜引用 `company`，精确聚合引用 `company.keyword`。这正是 dynamic mapping 默认替你做的事，这里只是把它显式写出来并理解为什么。

#### 本章参考

- [Elasticsearch Glossary](https://www.elastic.co/docs/reference/glossary)（官方术语表 · cluster / node / shard / segment 等定义）
- [Anatomy of an analyzer](https://www.elastic.co/docs/manage-data/data-store/text-analysis/anatomy-of-an-analyzer)（官方 · char filter → tokenizer → token filters 三段流水线）
- [Field data types](https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-types.html)（官方 · text vs keyword 与各 mapping 类型）

---

<a id="chapter-02"></a>

## 第 02 章：写入路径：为什么是“近实时”

上一章理清了名词和层级，尤其点出 segment 是不可变的。这一章顺着"不可变"这条线，追一条文档从写入到能被搜到，中间到底发生了什么——近实时、持久化、删除与合并，全是这条公理的推论。

**本章你将建立的 schema**

- 倒排索引怎么从一段文本建出来（analyzer → term → postings list），以及它为什么让搜索快
- "段不可变"如何同时解释 近实时(refresh)、持久化(translog / flush)、删除与更新(merge)
- refresh / flush / merge 是三件不同的事——混淆它们是大多数写入困惑的根源

写入路径上的每一个反直觉行为，根都扎在 01 章那条公理里：**底层是一堆不可变的 Lucene segment**。一段已经写出的 segment 永不被原地改写——这一条同时逼出了三个看似无关的现象：写完为什么搜不到（refresh）、崩溃为什么不丢数据（translog / flush）、删除为什么不立刻回收磁盘（merge）。本章四节顺着一条文档的旅程走：先看它被切成什么（倒排索引），再看它何时可见（refresh）、何时落盘（flush），最后看它被删时发生了什么（merge）。

<a id="inverted-index"></a>

### 2.1 倒排索引：搜索为什么快

写入时把文本切成规范化的 term，每个 term 指向一个有序的文档 id 列表（postings）；搜索因此变成几个有序列表的归并，而不是全表扫描。

**为什么需要它**

没有倒排索引，"找出所有含 `fox` 的文档"只能逐行取出每篇文章、在正文里做子串匹配，代价是 O(N · 字段长)——文档越多越慢，且每个查询词重来一遍。倒排索引把这份扫描代价**一次性预付在写入时**：写入时就按词建好索引，于是读取时无需再碰原文。

#### 运行方式：analyzer 管线 → term → postings

一个 `text` 字段被写入时，它的内容先过一条 **analyzer 管线**，分三段：

- **char filter**：在分词之前对原始字符做替换，例如剥掉 HTML 标签、把 `&` 换成 `and`。
- **tokenizer**：按规则把字符流切成 token，最常见的 `standard` tokenizer 按词边界切，并丢掉大部分标点。
- **token filters**：对切出的 token 逐个规范化——小写化（lowercase）、去停用词（stop，如 `the` / `a`）、词干还原（stemmer，把 `foxes` 还原成 `fox`）。

管线的产物是一串规范化后的 **term**。索引之所以叫"倒排"，是因为它不存"文档 → 它含哪些词"，而是反过来存 **每个 term → 一个 postings list**：一个按文档 id 升序排列的列表，每个条目还附带词频（term frequency）和位置（position，供短语查询用）。所有 term 本身又被收进一个有序的 **term 词典**。

![analyzer 管线把一段文本切成规范化 term，再倒排成 term 指向 postings 列表](/blog-assets/elasticsearch-derivation/diagram-05.svg)

*图 2.1 一段文本经 analyzer 管线切成规范化 term，再倒排成"term → 有序 doc id 列表"。 注意 ：词典与每个 postings list 都是 有序 的——正是这份有序让 quick AND fox 退化成两个排好序列表的归并，而非全表扫描。*

#### 搜索时为什么快

查询 `quick AND fox` 时，查询词先过**同一条 analyzer**得到 term `quick` 和 `fox`，在有序 term 词典里二分定位到各自的 postings，然后两个已排序的 doc id 列表做归并求交集——两个指针各自只向前走，命中相同 id 的就是结果。整个过程不碰任何一篇原文，代价只与命中文档数相关，与索引里文档总数基本无关，这就是"亚线性"。行存数据库走的是相反路线：扫每一行、对字段做子串匹配，代价随行数线性增长。倒排索引把这份代价从"每次查询"挪到了"一次写入"。

#### 带来的代价

预付不是免费的。写入时要跑完整条 analyzer 管线并构建索引结构，因此写比"直接落一行"重。更隐蔽的代价是**一致性约束**：查询分词器必须和索引分词器一致，否则查询词规范化出的 term 和存储的 term 对不上，结果就是"字段里明明有这个词却搜不到"。

**洞察 · 呼应 01 章 text / keyword**

这正是 01 章 `text` 与 `keyword` 那条分水岭的底层原因。`text` 字段过 analyzer、被切成多个 term，所以要用 `match`（查询词也过同一 analyzer、再匹配 term）；`keyword` 字段*不分词*、整段当成一个 term 存，所以要用 `term`（精确匹配整个值）。对 `text` 用 `term` 去查一整句话，等于拿"没分过词的原句"去比"分过词的单个 term"——永远对不上。`term` vs `match` 的区别，本质是"绕不绕过 analyzer"。

**例**

字段值 `"Running Foxes"` 经 standard analyzer + lowercase + 英文 stemmer，存进去的 term 是 `[run, fox]`（停用词无、`running` 词干还原成 `run`、`foxes` 还原成 `fox`）。用 `match: "ran"` 查，若查询侧用同一 stemmer，`ran` 也还原成 `run`，命中；用 `term: "Running"` 查，拿未规范化的 `Running` 直接比 term 词典里的 `run`，不命中。

想一想

给一个 `text` 字段写入 `"E-mail"`，standard analyzer 会把它切成几个 term？之后用 `term: "e-mail"` 能精确命中吗？

**展开答案（先停 10 秒再点）**

standard tokenizer 在连字符处断开并丢弃标点，`"E-mail"` 切成两个 term：`e` 和 `mail`（再经 lowercase）。词典里根本不存在 `e-mail` 这个整体 term，所以 `term: "e-mail"`（不过 analyzer、精确比对整串）匹配不到。

它指向的设计点：`text` 字段存的是*切碎并规范化后的 term 集合*，不是原文。要按原值精确匹配 / 排序 / 聚合，得用 `keyword`——这又回到 01 章那条分水岭。

<a id="refresh"></a>

### 2.2 不可变的 segment 与 refresh：近实时从哪来

新文档先进内存 buffer；一次 refresh 把 buffer 写成一个新 segment 并重开 reader——"近实时"就是这个 reader 重开的节奏，默认约 1 秒，不是实时。

**为什么这样设计**

segment 一旦写出就不可变（01 章公理）。"不可变"意味着新文档不能塞进已有 segment，只能攒在内存里、再整批写成一个*新* segment。而 Lucene 的搜索是针对"已打开的 segment 集合"做的——只有重新打开一个包含新 segment 的 reader，新文档才进入搜索的视野。这一步重开就是 refresh。

#### 运行方式：buffer → refresh → 新 segment → reader 重开

一条文档被索引后，先落进一个 **in-memory buffer**（同时也写了 translog，见 2.3）。此时它**还搜不到**——搜索看的是已打开的 segment，而 buffer 不是 segment。直到一次 **refresh** 发生：buffer 里积攒的文档被写成一个新的磁盘 segment，并打开一个新的 **reader**，把这个新 segment 纳入可搜索集合。从此刻起，这批文档才能被搜到。

refresh 默认每 **1 秒**触发一次，但有个常被忽略的条件：自 ES 7.0 起，只有**最近 30 秒内被搜索过**的 index 才会自动周期 refresh；完全没有查询打进来的 index 不会空跑 refresh，避免给纯写入负载白白制造小 segment。这就是 **near-real-time（近实时）** 的全部含义——不是写完即可见的实时，而是"reader 按节奏重开"带来的、上限约 1 秒的可见延迟。

![写入路径的两条正交轴：可见性轴 buffer 到 refresh 到新 segment，持久化轴每个操作到 translog 到 flush](/blog-assets/elasticsearch-derivation/diagram-06.svg)

*图 2.2 一条文档写入后分头走两条 正交 的轴：左边可见性轴（refresh）决定它何时能被搜到，右边持久化轴（flush）决定它何时落盘。 注意 ：朱红色的 refresh 链条和黑色的 flush 链条互不依赖——这就是为什么"可见"和"落盘"是两件事，下一节展开。*

#### 带来的代价

refresh 越频繁，单位时间内生成的小 segment 越多，而段越多越碎，后续 **merge**（2.4）要重写合并的负担就越重——代价不在 refresh 当下，而滞后到合并阶段。`?refresh=true` 能强制一次立即可见的 refresh，但每调一次就多新建一个小 segment；在高频写入路径上滥用，等于主动制造段爆炸、把成本压给 merge。

**提示**

需要"写完立刻读回"时，优先用 `?refresh=wait_for` 而非 `?refresh=true`：前者让请求挂起、等到下一次*自然*的周期 refresh 再返回，不额外制造 segment；后者强制立刻 refresh，多一个小段。两者都能保证读回，代价档次不同。

想一想

写入一条文档后**立刻**发一个 `GET _search`，默认配置下搜得到吗？

**展开答案（先停 10 秒再点）**

默认**搜不到**。文档此刻还在 in-memory buffer 里，没被写成 segment、reader 也没重开，不在可搜索集合中。要等下一次 refresh——最长约 1 秒——它才可见。

要立刻读回，有两条路：按 `_id` 走 `GET /index/_doc/{id}`（实时读，直接查 translog + segment，不受 refresh 影响），或写入时带 `?refresh=wait_for` 让请求等到下一次 refresh 完成再返回。注意"实时 GET"和"近实时 search"是两条不同的路径——前者按主键点查，后者走倒排索引。

<a id="translog"></a>

### 2.3 持久化 ≠ 可见性：translog 与 flush

可见性（refresh）和持久化（durability）是两条独立的轴：每个写操作先追加 translog 保证崩溃不丢，flush 才把内存 segment fsync 落盘并清空 translog。

**为什么需要 translog**

refresh 把 buffer 变成 segment，但这个新 segment 起初只在**文件系统缓存**里，还没 `fsync` 到物理磁盘——此时断电，它会丢。把每个 segment 都立刻 fsync 又太慢（fsync 是昂贵的磁盘同步）。translog 是这道矛盾的解：每个写操作在进 buffer 的同时**顺序追加**到一个事务日志，顺序写很快；万一在 flush 之前崩溃，重启时**重放 translog** 就能把尚未落盘的操作全部补回来。持久化由 translog 兜底，落盘的昂贵动作则可以攒着批量做。

#### 运行方式：两条轴各走各的

把图 2.2 的两条轴拆开看：

- **可见性轴（refresh）**：buffer → 新 segment → reader 重开 → 可搜索。管"什么时候能搜到"。
- **持久化轴（durability）**：每个 op → 追加 translog → flush 时 fsync segment 落盘并清空 translog。管"崩溃了丢不丢"。

两条轴由不同的触发条件驱动、互不等待。refresh 默认 1 秒一次；**flush** 则在 translog 达到阈值（默认 512MB）或周期到点时触发，把内存里的 segment fsync 到磁盘、然后清空已落盘部分对应的 translog。一次 flush 之后，那段 translog 的使命完成、可以丢弃。

**translog 持久化策略**

```json
PUT /logs/_settings
{
  "index.translog.durability": "request",
  "index.translog.flush_threshold_size": "512mb"
}
// durability=request（默认）：每个写请求返回前，translog 先 fsync
//   → 单条写确认即不丢，代价是每请求一次磁盘同步
// durability=async：translog 每 5s 才 fsync 一次
//   → 写吞吐更高，但崩溃可能丢掉最近 5s 的已确认写
```

**洞察 · 头号写入困惑的根因**

因为这两条轴正交，一条文档可以处在它们的任意组合态。一种是**已持久化、但还不可见**：操作进了 translog（崩溃能重放回来），但还没 refresh，所以搜不到。另一种是**已可见、但还没 fsync 落盘**：refresh 了、能搜到，但那个新 segment 仍在文件系统缓存里，尚未 flush——此刻真断电，segment 本身会丢，但数据并不丢，因为它还在 translog 里，重启重放即可恢复。把 refresh 和 flush 当成同一回事——以为"搜得到就等于落了盘"或"落了盘就等于搜得到"——是绝大多数写入困惑的头号根因。

#### 带来的代价

translog 不是没有成本的。translog 攒得越大，崩溃后重启要重放的操作越多，**恢复时间越长**；这也是 flush 阈值不能设得过大的原因。反过来，flush 太频繁则把"攒批落盘"的优化吃掉了，每次 fsync 都是一次昂贵的磁盘同步，**增加 I/O 压力**。`durability: request`（默认）保证每条已确认的写都不丢，但代价是每个写请求都要等一次 translog fsync；改成 `async` 能换吞吐，但崩溃时会丢掉最近一个 fsync 间隔内的已确认写——这是一道明确的"持久化保证 vs 写吞吐"权衡。

<a id="merge"></a>

### 2.4 删除不真删、更新=删+插：merge

段不可变，所以删除只是在位图里打个标记（soft delete），被删文档的空间要等后台 merge 把若干段重写成新段时才真正回收；更新 = 旧文档标删 + 新文档进新段。

**为什么删除不能"真删"**

从一个不可变的 segment 里抠掉一条文档，等于原地改写它——这与"段不可变"直接冲突。于是 ES 走了另一条路：删除时不动 segment，只在一个伴随该 segment 的位图（`.liv` 文件，每个文档一个 bit）里把对应文档标记为已删（**soft delete**）。搜索时跳过被标记的文档，对外看起来"删掉了"，但它仍占着 segment 的物理空间。

#### 运行方式：标删 → 后台 merge 才真正回收

被 soft-delete 的文档一直躺在原 segment 里，直到后台的 **merge** 发生：merge 选若干个小 segment，把其中**仍存活**的文档重写进一个新的、更大的 segment，然后丢弃旧 segment。被标删的文档在重写时**不会被带进新段**——这一刻，它们的空间才真正释放。merge 因此身兼两职：把碎段合并成大段（减少段数、加快搜索），以及顺带清理掉积压的已删文档。

**更新**（包括用相同 `_id` 重新索引）在底层就是"删 + 插"：把旧版本文档 soft-delete，把新版本写进当前 buffer、等下次 refresh 进新 segment。所以高频更新同一批文档，会持续制造"标删的旧版本"，把回收压力堆给 merge。

![三个小 segment 含若干 soft-deleted 文档，经 merge 重写成一个新 segment，被删文档消失、空间回收](/blog-assets/elasticsearch-derivation/diagram-07.svg)

*图 2.3 merge 选若干小 segment，把存活文档重写进一个新段，旧段连同被标删文档一起丢弃。 注意 ：灰格子（soft-deleted）在 merge 之前 一直占着磁盘——删除命令本身不回收空间，回收发生在 merge 那一刻。*

**反直觉**

批量删除一半文档后，磁盘占用**不会立刻下降**，甚至会*先涨*：删除产生的标记、以及为承接后续写入而新建的 segment，都和旧 segment 并存，要等 merge 完成才回收。merge 是 ES 里最容易被忽略、却最重的隐藏 I/O 成本——它在后台默默重写整段整段的数据，能在写入高峰把磁盘读写吃满。"删了为什么磁盘没降""明明没怎么写为什么 I/O 这么高"，根都在这里。

#### 带来的代价

merge 把"读到稳定快照、写走顺序追加"的好处，换成了一项后台开销：被删 / 被更新文档在 merge 前持续占用磁盘（**空间回收滞后**），而 merge 本身是重 I/O 的整段重写，与正常读写争抢磁盘带宽。ES 用一套策略限制并发 merge 数与速率来平摊这份成本，但它无法被消除——只能被调度。这也是为什么"段不可变"虽然让读路径干净，却必然附带一个永远在后台运转的 merge。

想一想

对一个 index 执行 `DELETE _by_query` 删掉一半文档，磁盘占用会立刻降一半吗？

**展开答案（先停 10 秒再点）**

不会。这些文档只是被 soft-delete——在各自 segment 的 `.liv` 位图里标了一位，文档数据原封不动留在 segment 里继续占空间。磁盘占用要等后台 merge 把这些段重写、把存活文档搬进新段、丢弃旧段时，才逐步下降。短期内甚至可能因为删除操作本身写入 translog、以及并发的新写入制造新段而*略升*。

它指向的设计点：删除的"逻辑生效"（搜不到了）和"物理回收"（磁盘降了）是分离的两件事，由 merge 这条后台通路连接。想强制立刻回收可以触发 `_forcemerge`，但那是一次极重的全量重写，只适合冷数据。

#### 为什么是"不可变段 + 后台合并"，而不是原地更新

把前三节的代价摊开看，会自然冒出一个问题：既然不可变带来了近实时延迟、删除滞后、merge 重 I/O 这么多麻烦，为什么不干脆让 segment 可原地更新？下表对比三条路线，解释为什么 ES（及其底层 Lucene）选了不可变这条。

表 2.1 · 为什么用"不可变段 + 后台合并"而不是原地更新

| 方案 | 优势 | 为什么没选 |
| --- | --- | --- |
| 原地更新倒排索引 | 立即可见、无合并开销 | postings 是有序压缩结构，在中间插 / 删一个 doc id 要重排整段、极难高效；并发读写必须加锁；且无法给搜索一个稳定不变的快照——读到一半底层数据就变了 |
| 每次写都建独立小索引 | 实现简单、天然不可变 | 段爆炸：一个查询要把成百上千个小段的结果合并，读极慢，小段的固定开销也压垮内存 |
| 不可变段 + 后台 merge | 顺序追加写得快、读到稳定快照、读路径可无锁、filter 结果可缓存且不失效 | 选中。代价是近实时延迟（refresh）、删除空间滞后回收、merge 占 I/O——本章前三节正是这些代价 |

**洞察 · 前向引用 03 章**

"读路径可无锁 + filter 结果可缓存且不失效"这条优势，到 03 章会兑现成一个具体机制：filter 查询的结果被缓存成**按 segment 的 bitset**，因为 segment 不可变，这份缓存*永远不需要失效*——细节在 [03 章 query 与 filter](#query-filter)。本章只需记住：不可变这条公理在写路径上付出了延迟和 merge 的代价，到读路径上会以"缓存免失效"的形式连本带利还回来。

<a id="synthesis"></a>

### 2.5 把三件事拼回一条链路

refresh / flush / merge 是三件不同的事，触发条件、负责的轴、产出各不相同。混淆它们是写入困惑的总根源，所以单独列一张表钉死区别：

表 2.2 · refresh / flush / merge 三者对照

| 操作 | 负责哪条轴 | 默认触发 | 产出 / 效果 |
| --- | --- | --- | --- |
| refresh | 可见性 | ~1s（且 index 近 30s 被查过） | buffer → 新 segment、重开 reader，新文档可被搜到 |
| flush | 持久化 | translog 达 512MB 或周期到点 | 把内存 segment fsync 落盘，清空已落盘部分的 translog |
| merge | 空间 / 段数 | 后台按段数与大小启发式 | 小段重写成大段，真正丢弃 soft-deleted 文档、回收空间 |

把一条文档的完整旅程串起来：被索引 → 同时进 buffer 和 translog（已持久化、未可见）→ 下次 refresh 写成新 segment、可被搜到（已可见、仍在文件缓存）→ 下次 flush 把 segment fsync 落盘、清 translog（已落盘）→ 若干次写入后，它所在的小段被 merge 进大段；若期间它被删 / 被更新，旧版本在这次 merge 里被真正丢弃。四段路、三件事，全是"segment 不可变"这一条公理的连续推论。

### § 本章 self-check

先合上教程，把你能想到的答案写在纸上或编辑器里。
写完再点开答案对照——直接点开等于把这一节当再读一遍。

1. 用一句话说清 refresh、flush、merge 各自**负责什么**、各自**默认什么时候**发生。
2. 一条刚写入、还没 refresh 的文档，此刻服务器断电，数据会丢吗？为什么？这说明可见性和持久化是什么关系？
3. 对 `text` 字段写入 `"Quick Foxes"`、再用 `term: "Quick Foxes"` 查，为什么查不到？换成什么查询、或换成什么字段类型能查到？
4. **（设计层）**为什么 refresh 和 flush 要拆成两件独立的事，而不是合并成一个"落盘并可见"的单一操作？合并会牺牲掉什么？

**答案（先做完再展开）**

1. refresh 负责*可见性*：把 buffer 写成新 segment、重开 reader，使新文档可搜，默认约 1 秒一次（且该 index 近 30s 被查过）。flush 负责*持久化*：把内存 segment fsync 落盘、清空 translog，默认在 translog 达阈值（512MB）或周期到点时发生。merge 负责*段数与空间*：把小段重写成大段、顺带真正丢弃 soft-deleted 文档回收空间，后台按段数 / 大小启发式触发。
2. 不会丢。每个写操作在进 buffer 的同时已追加到 translog，断电重启后重放 translog 即可恢复这条文档。这说明*持久化（translog 兜底）和可见性（refresh）是两条独立的轴*：文档可以"已持久化但还不可见"——在 translog 里崩溃不丢，但因为没 refresh 而搜不到。
3. `text` 字段过 analyzer，`"Quick Foxes"` 被切并规范化成 term（如 `quick`、`fox`），词典里不存在 `Quick Foxes` 这个整体；而 `term` 查询不过 analyzer、拿原串精确比对 term，对不上。改用 `match: "Quick Foxes"`（查询词过同一 analyzer、再匹配 term）能查到；或把字段设成 `keyword`（整段当一个 term 存），再用 `term` 精确匹配整个值。
4. 因为它们各自换的是不同的东西，合并会逼这两笔交易绑死、互相拖累。可见性想要*低延迟*（约 1 秒就让用户搜到），但 refresh 生成的新 segment 起初只在文件系统缓存里，并不昂贵；持久化想要的是*崩溃不丢*，要靠昂贵的 fsync 落盘。若合并成"落盘即可见"，要么每秒都 fsync（把 1 秒可见延迟的代价抬成每秒一次磁盘同步，写吞吐崩）、要么把可见延迟拖到 flush 周期那么长（用户要等很久才搜得到）。拆开后，refresh 用便宜的"重开 reader"买低延迟可见，translog 用便宜的"顺序追加"买持久化、把昂贵的 fsync 攒批到 flush——两笔交易各自取到最优。

**进阶挑战 · 刚好够不着**

#### 每秒百万文档、查询容忍 30s 延迟的日志场景，refresh_interval 怎么调？

一个日志写入场景：每秒约百万条文档涌入，但查询侧完全能容忍最新数据 30 秒后才可见。保持默认 `refresh_interval: 1s` 会发生什么？把它调成 `30s`（甚至写入期间设成 `-1` 关掉自动 refresh）能换来什么？沿着 refresh → segment → merge 这条链路推一遍代价的流向。

**提示（卡住再展开）**

默认 1s 时，每秒都把 buffer 刷成一个新 segment——百万文档 / 秒意味着海量小段被持续生产，而段越碎，后台 merge 要重写合并的工作量越大，写入高峰期 merge 抢走的磁盘 I/O 越多，反过来拖慢写入本身。把 refresh_interval 拉到 30s，等于让 buffer 多攒 30 倍的数据再一次性刷成*一个更大的* segment：单位时间内的段数量骤降，merge 压力随之大幅下降，写吞吐显著回升。代价正好是查询侧愿意付的那个：可见延迟从 1s 变成最长 30s。这就是"用查询能容忍的延迟，去换写入侧的段数和 merge 开销"——refresh 的快慢，最终是在 segment 数量和 merge I/O 上结账。

#### 本章参考

- [Near real-time search](https://www.elastic.co/docs/manage-data/data-store/near-real-time-search)（官方 · 近实时与 refresh 机制）
- [Refresh API](https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-refresh.html)（官方 · `refresh=true` / `wait_for` 语义与代价）
- [Translog](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-translog.html)（官方 · 事务日志、durability 与 flush）

---

<a id="chapter-03"></a>

## 第 03 章：检索、相关性与聚合

上一章顺着"段不可变"讲完了写入。这一章换到另一根支柱——"分片数量固定"，看一次检索怎么在多个分片上并行跑、相关性为什么会偏、以及聚合为什么不把堆撑爆。

**本章你将建立的 schema**

- 分片路由公式，以及"主分片数为什么创建后不能改"
- query 与 filter 的本质分野（打分 vs 是否 + 缓存），以及缓存为什么能不失效
- BM25 的三个旋钮；分布式 query_then_fetch 两阶段，以及 per-shard IDF 为什么让相同文档打分不同
- doc_values 怎么用列式结构撑起聚合 / 排序，对比 fielddata 为什么爆堆

检索路径上的每一个反直觉行为，根都扎在一句话里：**数据被切成了固定数量的 shard，一次查询要在所有 shard 上并行跑、再归并**。打分会偏、分片数改不了、聚合要走另一套存储——全是这句话的推论。本章五节顺着"一条查询从落点到结果"的链路走：先定位（路由），再筛选与打分（filter / query / BM25），再分布式归并（两阶段），最后是聚合走的那条独立数据通道（doc_values）。

<a id="routing"></a>

### 3.1 分片路由：文档落在哪个分片，分片数为什么不能改

一条文档落在哪个 shard，由一个取模公式唯一决定；而除数就是主分片数——这就是它创建后不能改的全部原因。

写入一条文档、或按 `_id` 读取一条文档时，Elasticsearch 不会去问每个分片"这条在不在你这"，而是用一个确定性公式直接算出它该在哪个分片：

**routing-formula**

```bash
shard = hash(_routing) % number_of_primary_shards
# _routing 默认取文档的 _id
# 写入、按 id GET、按 id 删除，都用这同一个公式定位分片
```

公式是确定的，所以同一个 `_id` 永远算到同一个分片——写进 shard 1 的文档，之后按 id 取也只会去 shard 1 找，不必广播。代价是这个除数被钉死了：`number_of_primary_shards`（下文记作 N）一旦在建索引时定下，就不能再改。

![文档按 hash(_id) 取模 N 路由到固定的三个主分片之一](/blog-assets/elasticsearch-derivation/diagram-08.svg)

*图 3.1 路由是一次纯计算，不是一次查找。 注意 ：朱红那条实线（余数=1）是这条文档唯一的归宿；N 是公式里的除数——改掉 N，所有旧文档的余数全部错位。*

为什么不能改？把 N 从 3 改成 4，对同一条文档，`hash(_id) % 3` 和 `hash(_id) % 4` 几乎必然得到不同的余数。换句话说，旧文档当初按"模 3"写进了 shard 1，新公式却按"模 4"去 shard 3 找它——找不到。**主分片数不可变，不是一条人为限制，而是它在路由公式里当除数这一身份的直接后果**：动了除数，等于把整张已经建好的映射表作废。

**洞察 · split 怎么"绕过"不可变**

ES 内部其实不是直接拿 N 当除数。建索引时它把 hash 先散布到一个更大的固定空间 `number_of_routing_shards`（路由分片数），再映射到 N 个主分片。`_split` API 因此能把分片数按**整数倍**扩大（如 3→6）——靠硬链接底层 Lucene 文件、再删掉不属于新分片的文档，而不是真的在原地改除数。这解释了为什么 split 只能整数倍、且 `number_of_routing_shards` 本身也得在创建时定好。

既然主分片数定死，分片数估错了怎么补救？三条现实路径，代价递增：

表 3.1 · 改主分片数的三种办法（痛点 → 设计回应 → 代价）

| 办法 | 它怎么回应"除数不能改" | 代价 / 适用 |
| --- | --- | --- |
| `_reindex` 到新索引 | 新建一个 N' 不同的索引，把全部文档按新除数重新路由写一遍 | 最通用、任意改分片数；但要全量重写 + 切换别名，期间双倍存储、耗时与数据量成正比 |
| `_split`（扩分片） | 借 `routing_shards` 空间，硬链接文件后按整数倍拆分 | 比 reindex 快（不重新分析文档）；但只能整数倍放大，且源索引须先转只读 |
| `_shrink`（缩分片） | 把多个分片的 segment 硬链接进一个分片，约数收缩（如 6→3 / 6→2 / 6→1） | 同样快；但要求分片先聚到同一节点、源索引只读，且目标数必须是原数的约数 |

**提示**

三条路径都要求源索引进入只读或别名切换——没有一种是"在线原地改 N"。这正是为什么分片数要在建索引前就按数据规模估好：它不是一个事后可调的旋钮。

<a id="query-filter"></a>

### 3.2 query context 与 filter context

query 问"有多相关"、算出 _score；filter 问"是 / 否"、跳过打分，并把结果缓存成一个永不失效的 bitset。

同一个查询子句，放在 query context 还是 filter context，跑的是两套完全不同的逻辑。query context 要回答"这条文档跟查询*有多相关*"，于是算出一个浮点 `_score`，结果按分数排序。filter context 只回答一个布尔问题——"这条文档*符不符合*这个条件"，不打分、不参与排序。

**为什么需要这条分野**

全文搜索的核心诉求是排序（最相关的排最前），所以默认要打分。但很多条件本质是过滤——"状态是 published""时间在最近 7 天""租户 id 等于 42"。这些条件没有"相关程度"可言，对它们打分纯属浪费 CPU。filter context 就是把这类"是 / 否"条件从打分流程里摘出来，单独走一条更省、且可缓存的通路。

#### filter 缓存为什么能"免失效"——这是 02 章红利

filter 的结果会被缓存成一个 **bitset**：一个 segment 内有多少文档，就有多少个 bit，命中该 filter 的文档对应位置 1，其余置 0。下次任何查询用到同一个 filter，直接复用这个位图，连判断都省了。

关键在于这份缓存**永远不需要失效**。回忆 02 章那根支柱——[段不可变](#chapter-02)：bitset 是*按 segment* 缓存的，而 segment 一旦写出就再不改动。既然底层数据不会变，"哪些文档命中这个 filter"这个答案在该 segment 的整个生命周期里恒定，缓存自然无需失效。新数据进来只会形成*新*的 segment，老 segment 的 bitset 原封不动继续用；老 segment 被 merge 掉时，它的 bitset 一起丢弃即可。**filter 缓存的"免失效"，是直接吃了 02 章"段不可变"的红利。**

**洞察 · 为什么打分查询缓存不了**

query context 的输出是一组*浮点排名*，而且依赖整个查询的词项组合（见 3.3 的 BM25）；它不是一个"命中 / 不命中"的固定集合，没法压成一个可复用的位图。filter 的输出恰恰是一个稳定的文档集合——这才是它能缓存、而打分不能的根本差别。ES 还有个细节：只有当一个 filter 在"足够大的 segment 上反复被用"时才值得缓存，太小的 segment 缓存了也不划算，于是它有一套启发式决定缓存哪些。

想一想

有人把"最近 7 天"这个 range 条件从 `filter` 挪进了 `must`，功能上结果集没变。性能上会发生什么？

**展开答案（先停 10 秒再点）**

三件事一起变差。其一，range 进了 query context，每条命中文档都要白算一遍 `_score`——而时间范围本身没有"相关程度"，这部分计算纯属浪费。其二，`must` 子句不进 filter 缓存，于是每次查询都重算这个集合，无法复用上一次的位图。其三，这个无意义的时间分量还会*污染*最终排序，把真正该决定排名的全文相关性稀释掉。

设计含义：凡是"是 / 否"型、与相关性无关的条件——精确 `term`、`range`、状态枚举——都应放进 `filter`。把它放进 `must` 是用三份代价换一个本不需要的分数。

表 3.2 · query context vs filter context

| 维度 | query context | filter context |
| --- | --- | --- |
| 核心问题 | 有多相关 | 是 / 否 |
| 是否打分 | 算 `_score` | 不打分 |
| 是否缓存 | 不缓存（输出是浮点排名） | 缓存为 bitset，按 segment、免失效 |
| 典型子句 | `bool.must` / `match` | `bool.filter` / `range` / `term` |
| 适用 | 全文相关性排序 | 精确过滤、范围、权限隔离 |

落到一个 `bool` 查询上，正确的分工是：相关性条件进 `must`（要打分），过滤条件进 `filter`（不打分、走缓存）。

**bool-query.json**

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "elasticsearch 路由" } }
      ],
      "filter": [
        { "range": { "created_at": { "gte": "now-7d/d" } } },
        { "term":  { "status": "published" } }
      ]
    }
  }
}
```

must 全文相关性条件，参与 BM25 打分、决定排序。

filter range + term 是纯"是 / 否"判断：不打分，结果缓存成 bitset，跨查询复用且不失效。

<a id="bm25"></a>

### 3.3 BM25：相关性怎么算出来

BM25 用三个旋钮——词频饱和、字段长度归一、逆文档频率——把"一条文档对一个查询有多相关"压成一个分数。

query context 要打分，打的就是 BM25 分。一个查询有多个词项 `qᵢ`，每个词项贡献一份分，加起来就是文档的 `_score`：

**bm25-score**

```text
score = Σᵢ  IDF(qᵢ) · ( tf · (k1 + 1) )
                      ─────────────────────────────────────
                      tf + k1 · ( 1 − b + b · (fieldLen / avgLen) )

IDF(qᵢ) = log( (N − n + 0.5) / (n + 0.5) )     # N=文档总数, n=含该词的文档数
k1 = 1.2   # 词频饱和速度
b  = 0.75  # 字段长度归一强度
```

三个旋钮各管一件事：

- **词频饱和（k1=1.2）**：词频 `tf` 以 `tf / (tf + k1·…)` 的形式进入——这是一条*渐近线*。一个词出现第 1 次贡献很大，第 2 次还不错，到第 10 次几乎不再加分。`k1` 控制这条曲线压平的快慢。
- **字段长度归一（b=0.75）**：分母里的 `fieldLen / avgLen` 让长于平均的字段被惩罚——同样出现 3 次某词，出现在一篇万字长文里，远不如出现在一句标题里有分量。`b` 控制惩罚强度。
- **逆文档频率 IDF**：含某词的文档数 `n` 越大，`IDF` 越小。"的""是"这种到处都有的词权重被压到接近 0，区分度高的稀有词权重高。

**为什么取代了 TF-IDF**

BM25 自 Lucene 6 / ES 5（2016）起是默认打分。它替换的经典 TF-IDF 有两处粗糙：词频近似*线性、无上界*——一个词刷 100 次，分就涨 100 倍，容易被关键词堆砌骗到；而且对字段长度的归一也更原始。BM25 的词频饱和 + 长度归一让多词匹配的排序更贴近"人觉得哪条更相关"。

![BM25 词频贡献是先升后平的饱和曲线，TF-IDF 近似一条不封顶的直线](/blog-assets/elasticsearch-derivation/diagram-09.svg)

*图 3.3 同一个词反复出现时两种打分的走势。 注意 ：朱红的 BM25 曲线是 趋近 一条渐近线、而非撞上一道硬上限——第 10 次出现仍在加分，只是加得极少；灰色 TF-IDF 则一路不封顶。*

**反直觉**

词频饱和让"把关键词塞进一个*短*字段"成为操纵排序的手段。一篇真正相关的长文，关键词密度被字段长度归一稀释；而一条把同样关键词硬塞进短标题的低质文档，`fieldLen` 小、惩罚轻，反而能压过长文排在前面。这不是 bug，是 b 旋钮的设计后果——3.5 节末的进阶挑战会让你拿这一点去排查"短文档总排前面"。

<a id="two-phase"></a>

### 3.4 分布式检索两阶段，与相关性偏差

一次检索分两阶段在所有分片上跑——先各自返回 top-K 的 id+score 归并，再只对胜出的 K 条去取原文。

3.1 说过数据被切成固定数量的分片。于是一次 `search` 不可能只问一个分片——它要在*每个*分片上跑，再把结果归并。默认策略叫 `query_then_fetch`，顾名思义两个阶段：

![query_then_fetch 两阶段：阶段一各分片回传 id 和 score 给协调节点归并，阶段二只对选中文档取原文](/blog-assets/elasticsearch-derivation/diagram-10.svg)

*图 3.4 两阶段把"在哪打分"和"取多少原文"分开。 注意 ：阶段①（黑线，上行）每个分片只回传轻量的 id+score；只有归并出全局 top-K 后，阶段②（朱红线，下行）才去对应分片取这 K 条的原文——避免把所有候选文档的 _source 都搬回来。*

**阶段一（query）**：协调节点把查询发到每个分片，每个分片在自己的数据上算分、只返回本地 top-K 的 `doc id + score`（不含原文）。协调节点收齐所有分片的候选，归并出全局 top-K。**阶段二（fetch）**：只对这 K 条，去它们各自所在的分片取完整 `_source`。这样网络上搬运的，第一阶段是轻量的 id+score、第二阶段只有最终 K 条原文，而不是每个分片的全部候选文档。

想一想

两个内容*一模一样*的文档，恰好被路由到了不同分片。同一个查询打过来，它们的 `_score` 会相等吗？

**展开答案（先停 10 秒再点）**

不一定相等，而且小集群上经常不等。原因在 BM25 的 IDF：`IDF = log((N−n+0.5)/(n+0.5))` 里的 `N`（文档总数）和 `n`（含该词的文档数）是**每个分片用自己本地的统计**算的——阶段一各分片独立打分，谁也不知道全局词频。两个分片若文档数不同、或某词在两边的分布不同，同一个词的 IDF 就不同，于是两条内容相同的文档拿到不同的分。

这正是 `dfs_query_then_fetch` 要补的：它在阶段一之前多加一个 **DFS 预阶段**，先从所有分片收集全局词频，再让每个分片用这套*统一*的统计打分。代价是多一轮网络往返；收益是相同文档得到一致、更准确的分。

**陷阱 · per-shard IDF**

这是检索路径上最反直觉的一点：**IDF 是每个分片各算各的**。文档总量小、或路由不均（某些分片文档明显偏多偏少）时，同一个 term 在不同分片的 IDF 能差出可见的幅度，导致"两条相同文档分数不同""同一文档换个分片分布就排名跳动"。`dfs_query_then_fetch` 用一轮额外往返收集全局词频来消除它。好消息是：当每个分片都装满、词频统计趋于收敛，per-shard 的差异会自然变小——所以这个问题在小索引、测试数据集上最刺眼，在生产规模的大索引上往往可以忽略。

<a id="doc-values"></a>

### 3.5 doc_values 与聚合：为什么 text 不能直接聚合

聚合和排序要"按文档读字段值"，方向和倒排索引正相反——doc_values 是写入时就建好的列式磁盘结构，专门提供这个反方向。

倒排索引解决的是"给一个 term，找出哪些文档含它"——方向是 `term → docs`。但聚合和排序问的是反方向的问题："给一个文档，它这个字段的值是多少"——`doc → value`。要对 `price` 求平均、按 `created_at` 排序，都需要快速地按文档拿到字段值，而倒排索引天生不擅长这个方向。

![倒排索引提供 term 到文档的方向，doc_values 提供文档到值的反方向，分别服务搜索与聚合](/blog-assets/elasticsearch-derivation/diagram-11.svg)

*图 3.5 同一份字段数据被组织成两种相反的访问方向。 注意 ：检索需要 term→docs （左），聚合 / 排序需要 doc→value （右）；ES 为后者单独建了一份列式结构 doc_values，而不是在查询时硬把倒排索引反转。*

历史上这个反方向是用 **fielddata** 解决的：查询时把倒排索引*临时反转*成"按字段排列的数组"，整个加载进 JVM 堆。字段一大，这个数组几十 GB，触发长时间 GC，严重时直接 OOM 把节点打挂。

**doc_values 把这件事提前到写入时做。**它在文档落盘、生成 segment 时就把每个字段写成一份*列式*磁盘结构（同一字段的所有值连续存放）。查询时通过操作系统的**文件缓存（堆外、mmap 映射）**读取，不占 JVM 堆。这就是为什么聚合 / 排序密集的负载能在一个不大的堆上跑——数据的重量压在堆外的文件缓存里，由操作系统按需换页，而不是全堆驻留。

#### 这正是 01 章 text / keyword 分水岭的底层原因

回到 01 章那条最高频的[分水岭——`text` 与 `keyword`](#chapter-01)。现在能看清它在检索路径上的后果了：

- **`text` 默认*没有* doc_values**（它被分词、为全文检索而生，列式存原文意义不大）。所以直接对一个 `text` 字段做聚合或排序，会退回到老的 fielddata 路径——在堆上临时反转倒排索引，正是 01 章提到的那个易 OOM 的陷阱。ES 默认还把 text 的 fielddata 关掉，逼你显式开启或改用 keyword。
- **`keyword` 默认*有* doc_values**（它整体存原值、不分词）。于是它天生能聚合、能排序，走的是堆外列式读取，安全又高效。

"一个字段该用 text 还是 keyword"这道 01 章的选择题，底层就是"它要参与全文检索（走倒排）还是聚合 / 排序（走 doc_values）"。需要两者兼顾时，常见做法是一个字段配两个映射：`text` 主体 + 一个 `.keyword` 子字段。

表 3.3 · doc_values vs fielddata

| 维度 | doc_values | fielddata（旧） |
| --- | --- | --- |
| 存储位置 | 堆外 · 磁盘 + OS 文件缓存（mmap） | JVM 堆内 |
| 何时构建 | 写入时（落盘进 segment） | 查询时临时反转倒排索引 |
| 主要风险 | 占磁盘 + 文件缓存，堆压力小 | 大字段几十 GB，长 GC / OOM |
| 默认开启的字段 | `keyword` / 数值 / 日期等 | `text`（且默认关闭，需显式开） |

**洞察 · 三根支柱在这一节合流**

doc_values 同时踩在两根支柱上：它是*写入时*建好的（02 章"段不可变"——既然 segment 不变，索引期建好的列式结构就一直有效），又是聚合在*分片*本地完成的基础（3.4 的两阶段里，每个分片用自己的 doc_values 算局部聚合，coordinator 再归并）。检索路径上看似无关的几处行为，回收到的是同两条公理。

### § 本章 self-check

先合上教程，把你能想到的答案写在纸上或编辑器里。
写完再点开答案对照——直接点开等于把这一节当再读一遍。

1. 用一句话说清"主分片数为什么创建后不能改"，要点到它在路由公式里的角色。
2. filter 缓存能"免失效"，靠的是哪一章的哪条公理？为什么打分查询的结果缓存不了？
3. BM25 的词频饱和，是一道"硬上限"还是一条"渐近线"？这个区别在排序上意味着什么？
4. （设计层）什么场景下你愿意为 `dfs_query_then_fetch` 多付一轮网络往返？什么场景下不值得？

**答案（先做完再展开）**

1. 主分片数 N 是路由公式 `hash(_id) % N` 里的除数；改了 N，所有已存在文档的余数都会变，旧数据再也定位不到——所以它创建后不可变。要改只能 reindex / split / shrink。
2. 靠 02 章的"段不可变"：bitset 按 segment 缓存，segment 永不改动，故"哪些文档命中此 filter"的答案恒定、无需失效。打分查询的输出是依赖词项组合的浮点排名、不是固定文档集合，压不成可复用的位图，所以缓存不了。
3. 是渐近线，不是硬上限。词频越高，每多一次出现加的分越少，但永远不会"封顶为零增量"。意味着关键词堆砌的边际收益急剧递减，多词命中、稀有词命中比单词刷量更能拉高排名。
4. 当索引文档量小、或分片间路由明显不均、且相关性精度要紧（如要给用户展示"最相关"少量结果、或做相关性回归测试）时，值得用 dfs 消除 per-shard IDF 偏差。当索引已是生产规模、每个分片都装满、词频统计趋于收敛时，偏差本就很小，多一轮往返不划算——直接用默认 `query_then_fetch`。

**进阶挑战 · 刚好够不着**

#### 短文档总排在前面，给出两个排查方向

一个搜索结果里，几条明显不相关的*短*文档（标题里硬塞了查询关键词）总是压过真正相关的长文排在最前。只用本章讲过的 BM25 三个旋钮 + 分片 IDF，给出**两个**独立的排查 / 调整方向。

**提示（卡住再展开）**

方向一落在 `b`（字段长度归一）上：短文档之所以占便宜，正是因为 `fieldLen` 小、惩罚轻。想一想调高还是调低 `b` 会加重 / 减轻这种偏向，以及它的副作用。

方向二落在分片 IDF 上：如果数据量不大或分片不均，某些词在个别分片的 IDF 被局部抬高，会让本地的短文档分数虚高。想一想 3.4 哪个检索策略能把打分统一到全局词频，从而排除"分片偏差在作祟"这一项。

#### 本章参考

- [Practical BM25 (part 2 – the algorithm)](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables)（官方 · BM25 公式与三个变量）
- [Query-then-fetch vs DFS-query-then-fetch](https://www.elastic.co/blog/understanding-query-then-fetch-vs-dfs-query-then-fetch)（官方 · 两阶段与 IDF 偏差）
- [All about Elasticsearch filter bitsets](https://www.elastic.co/blog/all-about-elasticsearch-filter-bitsets)（官方 · filter 缓存与位图）
- [Disk-based field data a.k.a. doc values](https://www.elastic.co/blog/disk-based-field-data-a-k-a-doc-values)（官方 · doc_values 设计）
- [Query and filter context](https://www.elastic.co/docs/reference/query-languages/query-dsl/query-filter-context)（官方文档）

---

<a id="chapter-04"></a>

## 第 04 章：自测与场景辨析

前三章分别建立了名词地图（01）、写入路径（02）、检索与聚合（03）。这一章不教新东西——它逼你把这些回忆出来，并在跨章的真实场景里做判别。读不出答案的地方，就是还没真正打通的地方。

**本章检验你能否**

- 脱离教程复述核心概念，并把机制讲到"为什么"那一层
- 在一个跨章场景里，判断问题出在写入路径还是检索路径，并指出根因
- 在 Elasticsearch 与 PostgreSQL / 专用向量库 / ClickHouse 之间做出有依据的选型

**怎么用这一章**

所有答案集中在页面最底部一个折叠块里。先合上前面的章节，把每道题的答案写在纸上或编辑器里，**写完**再展开对照。直接展开答案，等于把这一章当成第四遍阅读——主动回忆才有效果，看一眼答案"觉得自己会"是最典型的错觉。

题目分三层，认知要求从下到上递增。下层能复述、中层能讲清机制、上层能在没见过的场景里判别——三件不同的事。

![自测三层梯度金字塔：概念层、原理层、应用判别层，认知要求向上递增](/blog-assets/elasticsearch-derivation/diagram-12.svg)

*图 4.1 三层梯度，认知要求向上递增。 注意 ：在概念层做得又快又顺，不代表应用判别层过得了——后者要的是迁移，不是复述。*

<a id="layer-concept"></a>

### A 概念层（对应 01 章）

每题一句话能答清即可。卡住的，回 [01 章](#chapter-01)对应小节。

1. `document` 和 `_source` 是什么关系？为什么搜索命中后还要单独存一份 `_source`？
2. dynamic mapping 给一个字符串字段默认建出哪两样东西？各自能做什么？
3. 用一句话说清 `cluster` / `node` / `index` / `shard` / `segment` 的包含关系。
4. 为什么说"shard 是一摞只增不改的 segment"，而不是一块可以原地改的整数据？
5. 对一个默认 dynamic mapping 的 `text` 字段做 `term` 查询，为什么常常查不到？两种改法分别是什么？

<a id="layer-principle"></a>

### B 原理层（对应 02 + 03 章）

这一层答不出"为什么"就只是背了结论。每题都要落到机制。

1. `refresh` 和 `flush` 各自负责什么？哪个决定"能不能搜到"，哪个决定"崩溃会不会丢"？（[02 §refresh](#refresh) / [§translog](#translog)）
2. 删除一条文档后，它占的磁盘空间什么时候才真正回收？为什么不是立刻？（[02 §merge](#merge)）
3. 倒排索引为什么让 `quick AND fox` 比行存全表扫描快？关键在"有序"两个字上——具体怎么用到？（[02 §倒排索引](#inverted-index)）
4. 主分片数为什么创建后不能改？把这个限制还原成一个公式。（[03 §routing](#routing)）
5. 同一个 `range` 条件，放进 `filter` 和放进 `must` 有什么本质差别？filter 的缓存为什么能"免失效"？（[03 §query/filter](#query-filter)，根在 02 段不可变）
6. BM25 的 `k1` 和 `b` 各控制什么？为什么一个把关键词塞进短标题的文档能排到前面？（[03 §BM25](#bm25)）
7. 两个内容完全相同的文档，分在不同分片，`_score` 会一样吗？`dfs_query_then_fetch` 补的是什么？（[03 §两阶段](#two-phase)）
8. 为什么 `text` 字段不能直接聚合/排序，`keyword` 可以？从 doc_values 的角度回答。（[03 §doc_values](#doc-values)）

<a id="layer-discriminate"></a>

### C 应用判别层（跨章场景）

每个场景都不告诉你它属于哪一章——你要自己判断问题出在写入还是检索、根因在哪个机制。这才是"打通"的检验。

**场景 1 · 写完搜不到**

同事抱怨："我刚 index 了一条文档，紧接着 search，搜不到，是不是 ES 有 bug？"。这问题出在写入路径还是检索路径？根因是什么？怎么验证、怎么让它在需要时立刻可见？

涉及：02 §refresh（near-real-time）

**场景 2 · 相同文档不同分**

线上两条几乎一模一样的文档，搜索时 `_score` 差很多。先从哪两个方向排查？哪个跟"文档落在哪个分片"有关，哪个跟"字段长度"有关？

涉及：03 §两阶段（per-shard IDF）+ 03 §BM25（字段长度归一）

**场景 3 · 聚合就 OOM**

对一个存商品全文描述的字段做 `terms` 聚合，节点频繁触发熔断 / OOM。根因是什么？为什么换一个字段就好了？正确做法是什么？

涉及：01 §text/keyword + 03 §doc_values（fielddata 退化）

**场景 4 · 删了磁盘不降**

批量删除了一半文档，磁盘占用没降、甚至先涨了一点。运维问"是不是删除没生效？"。怎么解释？数据到底删没删？空间什么时候回来？

涉及：02 §merge（soft delete + 段不可变）

**场景 5 · 先开 200 个分片？**

一个新业务的索引，有人主张"先开 200 个主分片以防将来不够"。怎么评估这个决定？它和"分片数不可变""过度分片"分别有什么关系？数据量不大时这样做的代价是什么？

涉及：03 §routing（分片数不可变）+ 过度分片的开销

<a id="selection"></a>

### D 选型辨析：到底要不要用 ES

"向量数据库主要有哪些"那类讨论里，ES 常被当成"全文 + 向量都能干"的万金油。但选型的第一道题，恰恰是**要不要上 ES**。下面这条判断流，按"先排除、再落地"的顺序走。

![选型决策流：按主导负载依次排除，最终落到 Elasticsearch 或 PostgreSQL](/blog-assets/elasticsearch-derivation/diagram-13.svg)

*图 4.2 选型按"先排除特化场景、再落到通用方案"的顺序。 注意 ：ES 不是默认选项——只有"要相关性排序的全文/混合检索 + 规模大"这条路径才真正轮到它；中小规模优先复用 PostgreSQL。*

表 4.1 · 四种存储的适用边界

| 选项 | 什么时候选它 | 短板 |
| --- | --- | --- |
| Elasticsearch | 需要相关性排序的全文检索 + 词法/语义混合检索 + 聚合，且规模大 | 运维重、存储放大；纯向量场景浪费内存（在跑一整套搜索引擎） |
| PostgreSQL FTS / pgvector | 中小规模；检索与 OLTP 数据同库；想少维护一个系统 | 分词与相关性能力弱于 ES；向量超约 50–100M 后退化 |
| 专用向量库 Milvus / Qdrant | 向量是主要负载、超大规模 ANN 检索 | 不擅长全文相关性与复杂聚合 |
| ClickHouse | 海量日志/指标的聚合分析 | 无相关性排序、无语言学检索；同样数据 ES 的存储约是其 12–19 倍 |

<a id="draw"></a>

### E 亲手画一张图

**亲手画图 · retrieval**

合上教程，在纸上或 Excalidraw 里画**两张**图，只画核心节点：

（1）一条文档**从写入到能被搜到**的路径：`buffer → ? → ?` 直到可见；再单独画出 `translog` 那条持久化的轴。

（2）一次 `query_then_fetch` 在 3 个分片上的**两个阶段**，标出每个阶段在分片和协调节点之间传的是什么。

画完回到 [02 §refresh](#refresh) 和 [03 §两阶段](#two-phase)对照：你画的写入图里，refresh 和 flush 是不是两条分开的线？你画的检索图里，第一阶段分片返回的是完整文档，还是只有 `id + score`？这两个点答错，就是该回去重读的地方。

<a id="answers"></a>

### ✓ 答案

下面是全部答案，按三层 + 选型组织。对照时重点不是“对没对”，而是“能不能讲出为什么”。

**展开全部答案（先做完再看）**

#### 概念层 A

1. `_source` 是写入时原始 JSON 的完整副本，和"用于搜索的倒排/列式结构"是**两份独立存储**。搜索结构只存切词、统计这些便于检索的派生数据、不保留原文，所以命中后要靠 `_source` 把整条文档还原给调用方。
2. 一个 `text` 字段（过 analyzer、可全文检索）+ 一个 `.keyword` 子字段（multi-field，原样、有 doc_values、可精确匹配/排序/聚合）。两者互补：全文搜用字段本身，聚合排序用 `.keyword`。
3. cluster ⊃ node ⊃（index 被切成的）shard ⊃ Lucene segment。其中 index 是横跨多个 shard 的**逻辑集合**，shard 才是物理上的 Lucene index 边界，segment 在 shard 内部只增不改。
4. 因为 Lucene segment 一旦写出就不可变；一个 shard 是若干 segment 累加而成。所谓"改"数据，实际是写新 segment + 在旧 segment 里把老版本标记为已删，而不是原地修改。
5. 因为 `text` 字段存的是经 analyzer 切分、规范化（如小写化）后的 term，例如 `"Hello World"` 存成 `[hello, world]`；而 `term` 查询**不分词**，拿整串原文去比对，对不上。改法：用 `match`（会分词），或查 `field.keyword`（原样存储的子字段）。

#### 原理层 B

1. `refresh` 把内存 buffer 写成一个新 segment 并打开新 reader，决定文档**能不能被搜到**（默认 1s，near-real-time）；`flush` 把 segment fsync 落盘并清空 translog，配合 translog 决定**崩溃会不会丢**。一个管可见性，一个管持久化，是两条正交的轴。
2. 等到后台 `merge` 把包含该文档的若干 segment 重写成新 segment 时才回收。因为 segment 不可变，删除当下只能在 `.liv` 位图里标记 soft delete，旧文档仍占空间；merge 前磁盘甚至可能因新旧 segment 并存而先涨。
3. 倒排索引把每个 term 映射到一个**有序**的 postings list（doc id 升序）。查询词用同一 analyzer 处理后，在有序 term 词典里二分定位，再对多个 term 的有序 postings 做**归并**求交/并——全程不碰不相关文档；行存则要逐行扫描、对每个字段做匹配。
4. `shard = hash(_routing) % number_of_primary_shards`，`_routing` 默认是 `_id`。主分片数是公式里的除数（模数），一旦改变，`hash % N` 会把已存在的每条文档解析到不同分片，旧数据再也定位不到——所以创建后不可变，要改只能 reindex / split / shrink。
5. `filter` 只问"是/否"、跳过打分，结果按**每个不可变 segment**缓存成一个 bitset；因为 segment 永不改，这个缓存永不需要失效、可被任意复用。`must`（query context）要算 `_score`、无法这样缓存，把本该是 filter 的精确/范围条件放进去，白算分还不进缓存。
6. `k1` 控制词频饱和：tf 以 `tf/(tf+k1)` 形式进入，是渐近线，第 10 次出现某词几乎不再加分；`b` 控制字段长度归一，长于平均的字段被惩罚。所以一个把查询词塞进很短标题的文档，因为字段短、长度归一几乎不罚、词频占比又高，会被 BM25 顶到前面——即使它整体并不相关。
7. 默认**不一定一样**。IDF 是每个分片用本地文档频率算的，相同 term 在不同分片 IDF 不同；文档少或路由不均时，两条相同文档因落在不同分片而得到不同分。`dfs_query_then_fetch` 先加一轮收集**全局**词频，让所有分片用同一套统计打分（多一次往返、更准）。分片填满后偏差自然收敛。
8. 聚合/排序需要"doc → value"的访问方向，倒排索引是反方向的"term → docs"。`keyword` 默认有 `doc_values`（写入时就建好的**列式磁盘**结构，走 OS 文件缓存、堆外读取），所以能聚合排序；`text` 默认没有 doc_values，要聚合/排序就退化到查询时在 JVM 堆上反转索引的 `fielddata`，几十 GB、触发 GC/OOM。

#### 应用判别层 C

1. **场景 1：**写入路径问题，不是 bug。文档写入后默认要等下一次 `refresh`（最长约 1s）才进入可搜索的 segment，这就是 near-real-time。验证：等 1s 再搜，或对写入加 `?refresh=wait_for`。不要用 `?refresh=true` 批量刷，会制造大量小 segment、加重 merge。
2. **场景 2：**两个方向。①分片维度：两条文档可能落在不同分片，per-shard IDF 不同导致打分不同——可用 `dfs_query_then_fetch` 或在数据量足够时观察是否收敛。②字段维度：BM25 的字段长度归一（`b`）和词频，使较短字段、词频占比高的那条打分更高。先确认是不是同一分片，再看字段长度差异。
3. **场景 3：**根因是对 `text` 字段聚合。`text` 没有 doc_values，聚合退化到堆上的 fielddata，把整列加载进 JVM 堆 → 熔断/OOM。换成 `keyword`（或字段的 `.keyword` 子字段）就好，因为它有列式、堆外的 doc_values。正确做法：聚合/排序一律用 `keyword`，不要打开 `text` 的 fielddata。
4. **场景 4：**删除已生效，但只是 soft delete——在 `.liv` 里标记为删，文档仍占着不可变 segment 的空间，所以磁盘不立刻降；新写入/标记还会产生新 segment，短期甚至先涨。等后台 `merge` 把旧 segment 重写、丢弃被删文档后，空间才回收。可观察 segment 数与 merge 进度，必要时（谨慎）触发 force merge。
5. **场景 5：**不合理。分片数创建后不可变，"以防万一先开多"意味着把一个错误锁死；而过度分片本身有代价——每个 shard 是一个独立 Lucene 实例，带固定的堆、文件句柄、集群状态开销，并占用搜索线程。数据量不大时，几百个小分片只会拖慢查询、加重集群状态管理。正确做法：按目标单分片 10–50GB 估算分片数，需要时用 rollover / ILM 扩展。

#### 选型 D

按图 4.2 的顺序排除：海量日志聚合 → ClickHouse；纯向量大规模 → Milvus/Qdrant；要相关性排序的全文/混合检索且规模大 → Elasticsearch；其余中小规模优先 PostgreSQL（FTS / pgvector），少维护一个系统。核心判断：**ES 的不可替代价值在"相关性排序的全文 + 混合检索 + 聚合"三合一**；只要其中没有"相关性全文检索"这一项，几乎都有更省的专用或通用方案。

#### 本章参考

- [01 · 名词地图与集群拓扑](#chapter-01)（概念层题目对应章）
- [02 · 写入路径](#chapter-02)（原理层 refresh / merge）
- [03 · 检索、相关性与聚合](#chapter-03)（原理层 routing / BM25 / doc_values）
- [Size your shards](https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards)（官方 · 过度分片）
