---
title: 把 Milvus 当成一个流式分布式数据库来学
description: 从 WAL、Segment、存算分离、索引取舍、读写路径与一致性出发，建立一套能解释 Milvus 行为的完整心智模型。
date: 2026-10-06
tags: Milvus, 向量数据库, 分布式系统, RAG, HNSW, 数据库
featured: true
---

# 把 Milvus 当成一个流式分布式数据库来学

很多人第一次接触 Milvus，会把它理解成“把 FAISS 包成服务，再补上集群能力”。这种理解足以完成第一个向量检索 Demo，却不足以解释生产环境里的大量现象：

- 为什么一次 `insert` 成功后，数据已经不会丢，却可能还不能立刻被搜索到？
- 为什么刚写入的数据能参与检索，但速度明显慢于历史数据？
- 为什么频繁调用 `flush()` 不一定让系统更快，反而可能制造大量小段？
- 为什么查询延迟升高时，不能只盯着 HNSW 的 `ef` 或 IVF 的 `nprobe`？
- 为什么删除已经生效，对象存储占用却没有立刻下降？
- 为什么同一个 Collection 里，Partition 和 Shard 都在“切数据”，作用却完全不同？
- 为什么 Milvus 默认不是 Strong consistency，而是 Bounded consistency？

这些问题的答案不在某个 API 参数里，而在 Milvus 的系统结构里。

> **理解 Milvus 最有效的方式，不是把它当成“向量搜索引擎”，而是把它当成一个存储计算分离、由日志驱动、以不可变 Segment 为核心调度单元的流式分布式数据库。**

本文沿着一条主线展开：

```text
一次写入
  ↓
WAL：事实源与持久性边界
  ↓
Growing Segment：承接实时增量
  ↓
Sealed / Flushed Segment：固化为不可变文件
  ↓
每个 Segment 独立建索引
  ↓
查询扇出到多个 Segment
  ↓
局部 Top-K 多级归并
  ↓
一致性级别决定“要看到多新的日志位置”
```

只要这条链路真正进入脑子，Collection、Shard、Partition、Flush、Compaction、HNSW、TSO 和一致性级别就不再是一组散乱名词，而会变成同一套系统设计的不同侧面。

> 版本说明：本文根据指定目录中的 Milvus 深潜资料整理，资料以 Milvus 2.6.x、截至 2026 年 6 月的状态为基线。本文没有联网核验 2026 年 10 月的最新版本变化，因此涉及组件名称、默认值、版本演进和实验性能力时，应以实际部署版本的官方文档为准。示例代码主要用于表达概念，未在当前项目中连接 Milvus 实例执行。

---

## 一、先记住一句话本质

Milvus 不是“带服务器的 FAISS”。

FAISS 主要解决的是一个算法问题：给定一批向量，怎样在单进程或单机环境里高效找到近邻。Milvus 要解决的则是数据库问题：

- 数据怎样持续写入并可靠落定；
- 节点故障后怎样恢复；
- 数据和索引怎样跨节点加载与迁移；
- 写入、离线构建和在线查询怎样独立扩缩；
- 查询怎样跨多个物理数据单元得到全局 Top-K；
- 用户怎样在新鲜度、延迟和吞吐之间选择；
- 删除、更新和小文件怎样通过后台任务最终收敛。

因此，更准确的定义是：

> **Milvus 是一个存储计算分离的流式分布式数据库。写入先进入 WAL，日志是事实源；数据随后被固化为不可变 Segment；Segment 是存储、索引、查询、负载均衡和 Compaction 的统一调度单元；向量 ANN 只是运行在这些物理单元上的查询算子。**

这句话里有四个关键词。

### 1. 存储计算分离

真正不能丢的状态沉在共享存储中，计算节点内存里的数据都可以重建。于是增加 Query Node 可以扩查询能力，增加 Data Node 可以扩离线处理能力，节点故障也不意味着数据丢失。

### 2. 日志驱动

一次写入不是直接修改某个“全局索引文件”，而是先追加到 WAL。只要日志已经持久化，后续的 Growing Segment、Binlog 和索引都可以重新生成。

### 3. 不可变 Segment

Milvus 不维护“一张表对应一个巨大索引”。数据会被切成很多 Segment，每个 Sealed Segment 独立持久化、独立建索引、独立加载和检索。

### 4. 多段检索与归并

因为索引分散在多个 Segment 中，一次搜索天然是“扇出—局部检索—归并”的分布式执行过程，而不是查询一个全局索引后直接返回。

后文所有内容，都是对这四点的展开。

---

## 二、从逻辑模型走到物理模型

理解 Milvus 的第一关，是把逻辑概念和物理概念分层。用户写代码时直接面对的是 Collection、Schema、Entity 和 Partition；系统实际存储与调度时依赖的是 Shard、Channel、Segment、WAL、Binlog 和索引文件。

## 2.1 Collection：逻辑上的“表”，不是一份连续存储

Collection 可以类比关系数据库中的表：一批共享同一 Schema 的 Entity 被归到一个 Collection 中。

Schema 通常定义：

- 主键字段；
- 一个或多个向量字段；
- 向量维度；
- 可过滤的标量字段；
- 是否启用动态字段；
- Partition Key；
- Shard 数量等配置。

但必须加上一条边界：

> **Collection 本身主要是一组元数据，不是一块连续的数据文件，也不是一份全局大索引。**

创建 Collection 时，系统主要是在元数据存储中登记 Schema 与配置。此时对象存储里还没有数据 Segment。只有真正写入 Entity，系统才开始分配写入流、构造 Growing Segment、生成 Binlog，并在后续异步建立索引。

这也解释了为什么“Collection 已经创建成功”和“Collection 中已经存在可检索数据”是两件不同的事。

## 2.2 Entity：一行数据，但向量类型不止 float32

一个 Entity 可以理解为一行：

```text
主键 + 向量字段 + 标量字段 + 可选动态字段
```

典型的 RAG 文档块可能长这样：

```text
id          主键
embedding   稠密向量
tenant_id   租户
document_id 文档 ID
chunk_id    分块 ID
content     文本
created_at  写入时间
```

常见向量类型及其用途如下。

| 向量类型 | 典型用途 | 常见度量 |
| --- | --- | --- |
| `FloatVector` | 常规稠密 Embedding | L2 / IP / COSINE |
| `Float16Vector` / `BFloat16Vector` | 用较低精度换更小内存 | L2 / IP / COSINE |
| `Int8Vector` | 量化后的稠密向量 | L2 / IP / COSINE |
| `BinaryVector` | 哈希指纹、二值特征 | HAMMING / JACCARD |
| `SparseFloatVector` | 稀疏 Embedding、全文检索 | IP / BM25 |

向量维度通常写死在 Schema 中。换 Embedding 模型时，如果输出维度或距离语义发生变化，往往不能只改一个配置，而要新建 Collection、重灌数据并重建索引。

如果使用 `AutoID`，也不要假设主键是 1、2、3 的连续序列。自动主键是面向分布式写入生成的标识，不适合承担业务上的连续编号语义。

## 2.3 Partition 与 Shard：两条正交的切分轴

这是 Milvus 最容易混淆的一组概念。

| 维度 | Partition | Shard |
| --- | --- | --- |
| 主要目的 | 查询裁剪 | 写入并行 |
| 路由依据 | 业务字段或 Partition Key | 主键哈希 |
| 影响什么 | 查询要扫描哪些 Segment | 写入进入哪条 Channel |
| 是否面向业务 | 是 | 通常不是 |
| 是否容易动态调整 | 可按设计管理 | 通常建表时确定，后改代价高 |

### Partition：为了少查数据

Partition 是 Collection 内部的逻辑子集。若数据天然有高频过滤维度，例如：

- `tenant_id`；
- 知识空间 `space_id`；
- 地区；
- 日期或月份；
- 业务域；

就可以让这些字段参与 Partition 设计。

它的价值不只是“把数据分类摆放”，而是让查询发生 **Partition Pruning**：查询显式带上分区维度后，调度器可以直接排除其他 Partition 下的 Segment，那些 Segment 连检索任务都不会收到。

如果查询不带分区条件，系统仍可能扫描整个 Collection。也就是说，Partition 不是“写进去就自动省成本”，必须与查询形态匹配。

### Shard：为了把写入拆成多条流

Shard 是写入侧的水平分片。每条写入通过主键哈希进入一个 Shard，对应一条逻辑写入 Channel，再映射到底层 WAL 的物理 Channel。

因此可以把它粗略理解为：

```text
Shard 数量 ≈ Collection 的写入并行度
```

一条 Entity 会落入：

- 恰好一个 Shard；
- 恰好一个 Partition。

两者彼此独立，可以画成一个二维网格：

```text
                    Shard 0           Shard 1
                ┌────────────────┬────────────────┐
Partition A     │ Segment 集合    │ Segment 集合    │
                ├────────────────┼────────────────┤
Partition B     │ Segment 集合    │ Segment 集合    │
                └────────────────┴────────────────┘

横向：Shard，解决写入并行
纵向：Partition，解决查询裁剪
```

一个常见术语陷阱是：Kafka 的 Partition 更接近 Milvus 的 Shard，而不是 Milvus 自己的 Partition。讨论跨系统架构时必须说清楚语境。

## 2.4 Segment：真正的数据与调度单元

如果只记一个物理概念，就记 Segment。

> **Segment 是 Milvus 中真正存放数据、构建索引、执行查询、进行负载均衡与 Compaction 的基本单元。**

一个 Segment 大致经历以下生命周期：

```text
Growing
  │  可追加；实时数据；通常只能暴力扫描
  ▼
Sealed
  │  停止写入；只读
  ▼
Flushed
  │  Binlog 已进入对象存储
  ▼
Indexed
     向量索引构建完成，可由 Query Node 高效检索
```

需要特别注意：这些状态不是“数据是否安全”的同义词。

- 数据是否安全，主要看是否已经进入 WAL；
- 数据是否可见，取决于一致性级别和消费进度；
- 数据是否能走 ANN 索引，取决于 Segment 是否已经完成密封、持久化和建索引。

这三条时间线彼此相关，但不等价。

---

## 三、Milvus 的四层架构：真相只在最底层

Milvus 的架构可以从上到下分成四层：接入层、协调层、工作层和存储层。

```text
┌──────────────────────────────────────────────┐
│ 接入层：Proxy                                 │
│ 请求校验、写入路由、查询扇出、最终结果归并     │
├──────────────────────────────────────────────┤
│ 协调层：MixCoord                              │
│ 元数据操作、TSO、调度、拓扑、负载均衡、任务编排 │
├──────────────────────────────────────────────┤
│ 工作层                                        │
│ Streaming Node：WAL 与 Growing 数据           │
│ Query Node：加载 Sealed Segment 并检索         │
│ Data Node：Flush、Compaction、索引构建等离线活  │
├──────────────────────────────────────────────┤
│ 存储层                                        │
│ etcd：元数据与 Checkpoint                      │
│ WAL：写入事实源                                │
│ 对象存储：Binlog、索引文件及其他大对象          │
└──────────────────────────────────────────────┘
```

基于资料中的 2.6.x 架构，各组件可以这样理解。

| 组件 | 核心职责 | 为什么可以无状态化 |
| --- | --- | --- |
| Proxy | 接收请求、校验、路由、扇出和最终 Merge | 不持有权威数据，只缓存拓扑 |
| MixCoord | TSO、DDL、调度、拓扑与负载均衡 | 权威元数据写入 etcd |
| Streaming Node | 处理 WAL、维护 Growing Segment、服务实时查询 | 可从 WAL 与 Checkpoint 重放 |
| Query Node | 加载 Sealed Segment 和索引并执行搜索 | 可从对象存储重新加载 |
| Data Node | Flush、Compaction、建索引等后台任务 | 输入和输出均来自共享存储 |
| etcd | Schema、Checkpoint、注册信息等 | 持久元数据 |
| WAL | 顺序追加的写入日志 | 写入事实源 |
| 对象存储 | Binlog、索引等大文件 | 长期持久化数据 |

这里的“无状态”并不是说计算节点内存里什么都没有。Query Node 当然会加载 Segment，Streaming Node 也会维护 Growing 数据。

真正的含义是：

> **节点内存中的状态不是唯一真相；节点丢失后，状态可以从 etcd、WAL 和对象存储重新构造。**

这使两件事变成了同一套机制的两面：

- 故障恢复：旧节点崩溃，新节点重新加载或重放；
- 弹性伸缩：增加节点后，调度器把 Segment 或 Channel 重新分配过去。

如果持久状态被钉在某台工作节点的本地磁盘上，这两个能力都会显著变难。

---

## 四、日志即事实源：一次写入究竟在哪一刻“完成”

数据库架构里最关键的问题之一是：一次写入在什么时候算成功？

对 Milvus 而言，核心答案不是“索引更新完成”，甚至不是“Binlog 已经落对象存储”，而是：

> **写入已经追加到 WAL，进入可恢复的持久日志。**

这就是“日志即事实源”。

## 4.1 一次 Insert 的完整路径

一条写入可以按下面的过程理解：

1. 客户端把 Entity 发给 Proxy；
2. Proxy 校验 Collection、Schema、字段类型与维度；
3. 系统为写入分配全局时间戳 TSO；
4. 根据主键哈希确定 Shard 与逻辑 Channel；
5. 写入追加到对应 WAL；
6. Streaming Node 消费日志，将数据组织进 Growing Segment；
7. Segment 达到条件后被 Seal；
8. Data Node 把数据固化为 Binlog，写入对象存储；
9. 后台为 Sealed Segment 构建索引；
10. Query Node 加载 Segment 与索引，进入稳定查询路径。

把它压缩成三段，就是：

```text
先写日志 → 再固化 Segment → 再异步建索引
```

为什么不直接修改索引？因为直接修改会把持久性、查询结构和某台节点绑在一起。日志先行则把这些阶段解耦：

- WAL 负责可靠地记录“发生过什么”；
- Growing Segment 负责吸收实时增量；
- Binlog 负责生成可共享、可加载的不可变数据文件；
- 索引负责让稳定数据的检索更快。

## 4.2 三只钟：持久、可见、可索引

处理线上问题时，最有用的技巧是把一条写入放到三条时间线上看。

| 时间线 | 判断问题 | 关键机制 |
| --- | --- | --- |
| 持久性 | 节点现在崩了，数据会不会丢？ | WAL |
| 可见性 | 这次查询能不能看到它？ | TSO、Guarantee Timestamp、一致性级别 |
| 可索引性 | 查询它时能不能走 ANN 索引？ | Segment 状态与索引构建进度 |

于是，“写入成功后立刻查询”可能出现以下组合：

- 已持久，但默认 Bounded 下暂时不可见；
- 已持久且在 Session 查询中可见，但仍位于 Growing Segment，只能暴力扫描；
- 已持久、可见、已 Sealed，但索引还在构建；
- 已持久、可见、已 Indexed，进入稳定的 ANN 查询路径。

这不是系统自相矛盾，而是三个不同保证的完成时间不同。

## 4.3 故障恢复为什么成立

假设某个 Streaming Node 在 Growing Segment 尚未 Flush 时崩溃。

只要对应写入已经进入 WAL，数据就不应该因为这个进程退出而消失。接管的新节点可以：

1. 读取该 Channel 的 Checkpoint；
2. 从 Checkpoint 之后重放 WAL；
3. 重建 Growing Segment；
4. 追赶到日志当前尾部；
5. 继续服务写入和实时查询。

因此，Growing Segment 不是最终事实，它是“WAL 尾部在内存中的派生态”。

这也是为什么 Shard 不只是吞吐概念，也构成故障域。一个 Shard 对应的流式处理节点发生问题时，其他 Shard 的 Channel 不必与它共享全部故障命运。

---

## 五、Flush、不可变数据与 Compaction

## 5.1 Flush 不是写入确认

`flush()` 容易被误解成关系数据库里的“把脏页刷盘”，进而被当作数据安全按钮。

在 Milvus 的日志驱动设计中，更准确的理解是：

> **Flush 推动 Growing Segment 提前进入 Sealed 与持久化流程，但不是数据第一次获得持久性的时刻。**

写入进入 WAL 时，持久性边界已经建立。Flush 的主要作用是：

- 让当前 Growing Segment 停止追加；
- 触发数据固化为 Binlog；
- 为后续异步建索引创造条件。

因此，不要为了“每条写入立刻可查”而高频 Flush。可见性由一致性控制，索引可用性由 Segment 生命周期控制。每写几条就 Flush，最直接的后果往往是制造大量小 Segment。

## 5.2 为什么 Segment 要不可变

Sealed Segment 固化后不再原地修改，这带来几个好处：

- Query Node 可以安全并发加载；
- 不需要为在线修改维护复杂锁；
- Segment 可以在节点间迁移和缓存；
- 索引结构与数据文件可以稳定绑定；
- 对象存储天然适合承载不可变大文件。

代价也很明确：更新和删除不能原地完成。

## 5.3 删除为什么不会立刻释放空间

删除通常通过 Tombstone 或 Delta Log 表达：

1. 原 Binlog 保持不变；
2. 系统追加一条删除标记；
3. 查询时过滤已删除 Entity；
4. 后台 Compaction 重写新 Segment；
5. 被删除的数据不再进入新 Segment；
6. 旧 Segment 最终淘汰，空间才真正回收。

所以删除有两条时间线：

- **逻辑生效**：被删记录不再出现在结果中；
- **物理回收**：等待 Compaction 后，旧文件才被替换。

短时间内，对象存储占用甚至可能先增加，因为旧 Binlog 仍在，同时又多了 Delta 数据。

## 5.4 Compaction 不只是“清理垃圾”

Compaction 至少解决三个问题：

- 合并零碎的小 Segment；
- 将 Tombstone 真正落实到新数据文件；
- 降低查询的 Segment 扇出数量。

第三点经常被低估。Milvus 的查询成本不只是“每个 Segment 搜多快”，还取决于“一次要搜多少个 Segment”。小段越多，任务分发、局部 Top-K 和结果归并的成本越高。

因此，Compaction 同时是：

- 存储回收机制；
- 写放大控制机制；
- 查询性能治理机制。

---

## 六、索引不是选“最好的”，而是选愿意牺牲哪一角

向量索引的核心取舍可以画成一个三角：

```text
                  高召回
                    ▲
                   / \
                  /   \
                 /     \
        低内存 ◀─────────▶ 低延迟 / 高 QPS
```

没有一种索引能同时把三个角拉满。

- 想提高召回，就要检查更多候选，延迟通常会上升；
- 想提高 QPS，就倾向把更多结构与向量放在内存或显存中；
- 想降低内存，就要量化或把大头下沉到 SSD，代价是精度或延迟。

## 6.1 FLAT：精确基线

FLAT 不做近似剪枝，而是把查询向量与候选集中的每个向量计算距离。

特点：

- 召回率可以视为 100%；
- 查询复杂度随数据规模近似线性增长；
- 保留完整向量；
- 没有 `nprobe`、`ef` 这类召回旋钮。

它适合：

- 小规模数据；
- 需要建立 ANN 召回率 Ground Truth；
- 不允许漏检且规模可控的场景。

FLAT 的意义不只是“最慢的方案”，也是评估其他索引是否真的达到目标召回率的基线。

## 6.2 IVF：先分桶，再只搜部分桶

IVF 先通过聚类把向量分成多个簇。查询时先找到最接近查询向量的若干簇，再在这些簇中寻找候选。

两个参数必须分清：

- `nlist`：建索引时分成多少个簇；
- `nprobe`：查询时扫描多少个簇。

`nlist` 改变索引结构，需要重建；`nprobe` 是请求级参数，可以在线调整。

IVF 家族的差异主要在“桶里保存什么”：

| 索引 | 桶内表示 | 内存 | 召回与性能倾向 |
| --- | --- | --- | --- |
| `IVF_FLAT` | 完整向量 | 较高 | 精度高，结构相对简单 |
| `IVF_SQ8` | 标量量化向量 | 明显降低 | 常作为内存与召回的平衡点 |
| `IVF_PQ` | 乘积量化编码 | 更低 | 压缩更强，误差也更明显 |

线上发现召回不足而延迟仍有余量时，通常应先增大 `nprobe`，而不是立刻重建索引。

## 6.3 HNSW：高召回与高 QPS 的常见默认项

HNSW 构造多层近邻图。上层图稀疏，负责快速接近目标区域；下层图稠密，负责精细搜索。它可以类比“向量空间中的跳表”。

主要参数：

- `M`：每个节点保留的邻接关系规模，影响图密度、内存与召回上限；
- `efConstruction`：构图时的候选宽度，影响构建质量和构建成本；
- `ef`：查询时维护的候选宽度，影响召回与延迟。

其中：

- `M`、`efConstruction` 是建索引旋钮；
- `ef` 是查询旋钮。

HNSW 的优势是高召回区间里延迟和吞吐都很有竞争力，代价是图结构和完整向量都比较吃内存。

## 6.4 DiskANN：数据超过内存时，把大头放到 SSD

DiskANN 面向“完整向量与图结构无法全部驻留内存”的场景。可以粗略理解为：

- 内存中保留用于导航或近似判断的压缩信息；
- SSD 上保存更完整的向量和图数据；
- 查询用 Beam Search 在图上前进，并按需做随机读。

它不是“零内存索引”，而是把内存中最昂贵的部分压缩或下沉。因为查询涉及大量随机读，NVMe 一类低延迟 SSD 通常比普通磁盘更符合它的访问模式。

查询侧的 `search_list` 可以理解为 Beam 宽度：

- 调大：访问更多候选，召回提高，SSD 读与延迟增加；
- 调小：速度更快，召回下降。

## 6.5 GPU / CAGRA：显存换吞吐

GPU 索引适合批量查询、高并发和极致吞吐场景，但要付出：

- GPU 成本；
- 显存限制；
- 数据传输与调度开销；
- 索引类型与 Metric 的相容限制。

资料基线中特别需要注意：GPU 索引不直接支持 COSINE 时，可以先对向量做 L2 归一化，再使用 IP。因为对于归一化向量，内积排序与余弦相似度排序等价。

## 6.6 稀疏索引：Dense Retrieval 之外的另一条路

`SparseFloatVector` 与稀疏倒排索引适合：

- 稀疏 Embedding；
- BM25 全文检索；
- Dense + Sparse 混合召回。

在 RAG 中，稠密向量擅长语义近似，稀疏检索擅长关键词、专有名词、编号与精确词匹配。实际系统常将两路结果融合，再交给 Reranker，而不是把所有希望都压在一种向量表示上。

## 6.7 建索引旋钮与查询旋钮

这组区别值得单独背下来。

| 索引 | 建索引旋钮 | 查询旋钮 | 查询旋钮调大后 |
| --- | --- | --- | --- |
| IVF | `nlist` | `nprobe` | 召回上升，延迟上升 |
| HNSW | `M`、`efConstruction` | `ef` | 召回上升，延迟上升 |
| DiskANN | 建图参数 | `search_list` | 召回上升，SSD 访问与延迟上升 |
| FLAT | 无 | 无 | 始终全量精确扫描 |

记忆方法：

> **建索引旋钮决定“数据怎样组织”，是冷参数；查询旋钮决定“这次看多宽”，是热参数。**

线上召回不足时，优先用查询旋钮消费现有延迟预算。只有查询旋钮已经达到不合理水平，仍无法满足召回目标，才考虑修改索引结构并重建。

## 6.8 Metric 必须和向量语义对齐

索引选对了，距离度量选错，结果仍然可能失去意义。

| 向量类型或场景 | 常见 Metric |
| --- | --- |
| 稠密浮点向量 | L2 / IP / COSINE |
| 二值向量 | HAMMING / JACCARD |
| 稀疏向量 | IP / BM25 |
| 归一化向量 | COSINE，或在等价条件下使用 IP |

Metric 的选择不应只看“哪个跑得快”，而要看 Embedding 模型训练时优化的距离语义。模型按余弦相似度训练，却在线上用未经归一化的内积，排序含义就可能发生变化。

## 6.9 一棵实用的索引选型树

可以先用硬约束缩小范围：

```text
数据是否明显超过单机内存？
  ├─ 是：优先评估 DiskANN / 分布式资源方案
  └─ 否：是否有 GPU 且追求极致吞吐？
          ├─ 是：评估 GPU_CAGRA 等 GPU 索引
          └─ 否：是否追求高召回且内存充足？
                  ├─ 是：HNSW
                  └─ 否：IVF_SQ8 / IVF_PQ 等平衡方案

旁路：
  小数据且要精确 → FLAT
  稀疏向量或全文 → 稀疏倒排索引
```

这只是起点，不是终判。最终必须用真实数据、真实过滤条件、真实 Top-K 和真实并发压测。

---

## 七、一次 Search 为什么一定是“扇出再归并”

前面已经得到两个事实：

1. 一张 Collection 由很多 Segment 组成；
2. 每个 Sealed Segment 各自拥有一份索引。

所以一次搜索不可能只访问一个“整表索引”。它必须向所有相关 Segment 扇出。

## 7.1 读路径

一次查询可以抽象为：

```text
Client
  ↓
Proxy
  ├─→ Streaming Node → 搜 Growing Segment（通常暴力扫描）
  └─→ Query Node     → 搜 Sealed Segment（走 ANN 索引）
                           ↓
                    Segment 局部 Top-K
                           ↓
                    分片内 Reduce
                           ↓
Proxy 跨分片 Merge
  ↓
全局 Top-K
```

这里有两条不同的检索路径：

- Growing Segment：为了实时性，需要查询尚未固化的数据，但缺少稳定索引，通常只能扫描；
- Sealed Segment：已经固化并建索引，可以使用 HNSW、IVF、DiskANN 等结构。

写入路径是“一条数据收敛到一个 Shard 的一条流”，查询路径则是“一个请求扇出到相关 Shard 和 Segment，再收回来”。它们是同一套物理组织在两个方向上的镜像。

## 7.2 为什么 Segment 越多，查询越贵

假设一次查询要求 `limit=10`，一个执行节点持有 20 个相关 Segment。每个 Segment 至少要贡献自己的候选，再由上层从候选并集中选出全局前 10。

于是总成本近似由两部分相乘：

```text
总成本 ≈ 相关 Segment 数量 × 单个 Segment 的检索成本 + 多级归并成本
```

单段检索成本由索引和查询旋钮控制：

- HNSW 的 `ef`；
- IVF 的 `nprobe`；
- DiskANN 的 `search_list`。

Segment 数量则受以下因素影响：

- Partition 是否有效裁剪；
- 是否频繁 Flush 产生小段；
- Compaction 是否跟得上；
- 大批量写入后是否堆积 Growing Segment；
- Segment 是否已经建索引并正确加载。

因此，“检索越来越慢”不一定是索引参数问题。若小段数量翻了十倍，即便单段查询速度完全没变，总体延迟也会显著上升。

> 排障时应先看 Segment 数量和状态分布，再看 `ef`、`nprobe` 等参数。否则可能只是在每一个失控的小段上做更多工作。

---

## 八、过滤为什么让 ANN 更难，而不是更简单

真实业务很少做无条件全库向量搜索，通常还会带：

- `tenant_id == "acme"`；
- `created_at >= 某个时间`；
- `status == "active"`；
- `document_type in [...]`；
- 权限与知识空间过滤。

直觉上，过滤后数据更少，查询应该更简单。但对 ANN 索引来说，过滤会破坏原有搜索结构。

## 8.1 两层缩小范围

过滤可以发生在两个层次。

### 第一层：Partition Pruning

如果查询条件包含 Partition Key，调度器可以整段排除无关 Partition。这是最便宜的优化，因为被裁剪的 Segment 根本不会进入搜索路径。

### 第二层：Segment 内标量过滤

进入相关 Segment 后，系统还要根据标量条件过滤 Entity。此时 ANN 搜索结构可能受到干扰。

## 8.2 HNSW 为什么会被过滤“打断”

HNSW 依赖图上的邻接关系逐步靠近目标。若经过的很多节点都不满足过滤条件，搜索过程可能出现：

- 图上能走，但候选不能返回；
- 满足条件的候选过少；
- 为凑够 Top-K 需要扩展更宽的搜索；
- 图的有效连通性变差。

## 8.3 IVF 为什么也会受影响

IVF 本来只扫描若干最近簇。若这些簇里满足过滤条件的数据太少，就可能需要：

- 扫更多簇；
- 增大 `nprobe`；
- 处理更多无效候选。

所以索引选型不能只输入“总数据量”，还要输入：

- 过滤后保留多少数据；
- Top-K 多大；
- 每个租户或空间的数据规模；
- 查询是否总能带 Partition Key；
- 标量字段的分布是否倾斜。

资料中给出的过滤比例阈值可以作为测试起点，但不应当成跨版本、跨数据集的定律。生产决策仍应以真实负载基准测试为准。

---

## 九、一致性：本质上是在给 Guarantee Timestamp 选值

Milvus 的一致性级别不是抽象的“强或弱”开关。它们建立在统一机制之上：TSO 与 Guarantee Timestamp。

## 9.1 TSO：给写入一个全局时间顺序

系统为写入分配时间戳，使分布式写入能够放在统一的逻辑时间线上。

可以把每条写入理解为：

```text
write(event, tso = 123456)
```

不同节点处理日志的进度可能不同，但时间戳让系统能够描述“某个节点已经消费到哪里”。

## 9.2 Guarantee Timestamp：查询要求看到哪里

一次查询携带一个 Guarantee Timestamp，语义可以理解为：

> 在执行查询前，相关执行者至少要处理完所有时间戳不大于该值的写入。

如果本地进度落后于 Guarantee Timestamp，查询就需要等待追赶；如果已经达到，就可以直接执行。

于是四种一致性级别，只是在选择不同的 Guarantee Timestamp。

| 一致性级别 | Guarantee Timestamp 的含义 | 新鲜度 | 延迟与吞吐代价 | 典型用途 |
| --- | --- | --- | --- | --- |
| Strong | 接近当前最新 TSO | 看到最新全局写入 | 等待最多，代价最高 | 必须全局写后立刻读 |
| Bounded | 最新时间减去容忍窗口 | 有界滞后 | 默认平衡项 | 推荐、常规 RAG、离线灌库后查询 |
| Session | 当前 Client 最后一次写入的 TSO | 保证 Read-Your-Writes | 通常低于 Strong | 刚写入后由同一会话立即查询 |
| Eventually | 不强制追赶到较新位置 | 可能明显滞后 | 等待最少 | 日志、监控、对最新数据不敏感的场景 |

最容易踩坑的一点是：

> **默认通常是 Bounded，而不是 Strong。**

从关系数据库过来的工程师容易默认“刚写完就一定能读到”。在 Milvus 中，如果某条交互路径明确需要 Read-Your-Writes，应考虑 Session；如果必须让所有客户端都看到全局最新数据，才需要评估 Strong 的代价。

## 9.3 为什么默认 Bounded 是架构的自然结果

Milvus 的写入是流式传播的：写入落 WAL 后，多个执行者按各自进度消费和构造派生状态。若每次查询都要求全局最新，就必须频繁等待所有相关位置追到日志头部，吞吐和尾延迟都会承压。

Bounded 允许系统在一个可控窗口内使用略旧快照，从而减少等待。对于推荐与多数 RAG 场景，几秒内刚写入的数据是否立刻进入召回，往往没有查询稳定性与吞吐重要。

这不是“系统做不到强一致”，而是把新鲜度成本显式交给业务选择。

---

## 十、把三块拼起来：一个多租户 RAG 的设计

假设我们要建设企业知识库：

- 文档持续增量写入；
- 每个文档块属于一个 `tenant_id` 或 `space_id`；
- 在线查询几乎总按租户或空间过滤；
- Top-K 通常是几十；
- 大多数查询可以容忍短暂的新鲜度滞后；
- 用户刚上传文档后，希望马上能在自己的会话中检索到。

此时不能只回答“用 HNSW”。至少要同时决定 Partition、索引和一致性。

## 10.1 Schema：把高频过滤维度显式建模

下面代码只表达设计思路，具体 API 以实际 PyMilvus 版本为准。

```python
from pymilvus import MilvusClient, DataType

client = MilvusClient(uri="http://localhost:19530")

schema = client.create_schema(
    auto_id=True,
    enable_dynamic_field=False,
)

schema.add_field(
    field_name="id",
    datatype=DataType.INT64,
    is_primary=True,
)
schema.add_field(
    field_name="tenant_id",
    datatype=DataType.VARCHAR,
    max_length=128,
    is_partition_key=True,
)
schema.add_field(
    field_name="document_id",
    datatype=DataType.VARCHAR,
    max_length=256,
)
schema.add_field(
    field_name="created_at",
    datatype=DataType.INT64,
)
schema.add_field(
    field_name="embedding",
    datatype=DataType.FLOAT_VECTOR,
    dim=768,
)

client.create_collection(
    collection_name="knowledge_chunks",
    schema=schema,
    shards_num=4,
)
```

设计含义是：

- `tenant_id` 是绝大多数查询都会携带的条件，适合作为 Partition Key；
- `created_at` 只是偶尔用于时间过滤，可以先作为普通标量字段；
- Shard 数决定写入并行度，需要结合持续写入吞吐预估，而不是照抄固定值；
- 向量维度与 Embedding 模型绑定，升级模型时要考虑迁移 Collection。

## 10.2 索引：先选家族，再压测查询旋钮

如果单租户数据量可装入内存、Top-K 不大、目标是高召回和低延迟，可以从 HNSW 开始：

```python
index_params = client.prepare_index_params()
index_params.add_index(
    field_name="embedding",
    index_type="HNSW",
    metric_type="COSINE",
    params={
        "M": 16,
        "efConstruction": 200,
    },
)

client.create_index(
    collection_name="knowledge_chunks",
    index_params=index_params,
)
```

这里的 `M` 和 `efConstruction` 会影响图结构，改动通常意味着重建。

查询时再通过 `ef` 调整本次搜索：

```python
result = client.search(
    collection_name="knowledge_chunks",
    data=[query_embedding],
    filter='tenant_id == "acme"',
    limit=20,
    search_params={
        "metric_type": "COSINE",
        "params": {"ef": 64},
    },
    consistency_level="Bounded",
)
```

如果召回不足而延迟有富余，先增加 `ef`；如果内存压力明显，再评估 IVF_SQ8、IVF_PQ 或磁盘型方案，而不是只继续扩大 HNSW 图。

## 10.3 一致性：按请求区分，不必整库一刀切

常规问答请求可以使用 Bounded：

```python
result = client.search(
    collection_name="knowledge_chunks",
    data=[query_embedding],
    filter='tenant_id == "acme"',
    limit=20,
    consistency_level="Bounded",
)
```

“用户刚上传文档，上传完成后马上提问”的路径可以使用 Session：

```python
result = client.search(
    collection_name="knowledge_chunks",
    data=[query_embedding],
    filter='tenant_id == "acme"',
    limit=20,
    consistency_level="Session",
)
```

这样做比把整个 Collection 都切到 Strong 更精确：只为真正需要 Read-Your-Writes 的请求付成本。

## 10.4 三个决定如何互相影响

- Partition Key 先缩小 Segment 范围，降低扇出和归并成本；
- 索引决定被保留下来的每个 Segment 搜多快；
- 一致性决定搜索开始前要等日志消费追到多新的位置；
- 大批量重灌会产生大量 Growing 或小 Sealed Segment，使暴力扫描和归并同时变贵；
- 若此时再用 Strong，就会叠加“等待追赶最新日志”的成本；
- 等待 Seal、建索引与 Compaction 收敛后，查询会回到稳定状态。

这就是为什么生产调优不能只盯一个参数。Milvus 的延迟是数据组织、索引、后台任务和一致性共同作用的结果。

---

## 十一、常见故障现象应该怎样推理

## 11.1 写入成功，但立刻查询不到

按顺序检查：

1. 查询使用什么一致性级别？
2. 是否需要 Read-Your-Writes，却仍在使用 Bounded？
3. 查询是否由同一 Client 会话发起，Session 语义是否成立？
4. 相关执行者的消费进度是否落后？
5. 过滤条件或 Partition 条件是否把新数据排除了？

不要第一反应就调用 `flush()`。Flush 不直接定义可见性。

## 11.2 能查到，但刚写入的数据查询更慢

这通常是 Growing Segment 的正常代价：数据可见了，但还没有进入稳定的索引路径。

检查：

- Growing Segment 数量；
- Seal 和 Flush 是否跟得上；
- 索引构建是否积压；
- Query Node 是否已加载新索引；
- 是否有大批量写入导致实时路径压力上升。

## 11.3 一段时间后查询越来越慢

优先查看：

- 小 Sealed Segment 是否大量堆积；
- Compaction 是否落后；
- 是否存在过度 Flush；
- Growing Segment 是否过多；
- 相关 Partition 是否真的被裁剪；
- `ef` 或 `nprobe` 是否被调得过大；
- Top-K 是否从几十扩大到几千；
- 过滤条件是否变得极端。

先治理 Segment 数量，再调单段索引参数。

## 11.4 召回率偏低

建立一条可重复的评估链路：

1. 用 FLAT 或离线精确计算得到 Ground Truth；
2. 确认 Metric 与模型训练语义一致；
3. 确认向量是否按预期归一化；
4. 增大查询旋钮，如 `ef`、`nprobe`、`search_list`；
5. 检查标量过滤是否破坏候选遍历；
6. 检查每个 Partition 的数据量是否过小或严重倾斜；
7. 查询旋钮已无空间时，再考虑重建索引。

没有 Ground Truth 的“感觉召回不够”很难转化为可操作结论。

## 11.5 删除成功，但磁盘没有下降

这是不可变 Segment 与延迟回收的结果。

- 删除标记已经让结果层面不可见；
- 原始 Binlog 仍然存在；
- 等待 Compaction 重写 Segment；
- Compaction 完成并淘汰旧 Segment 后，空间才会回收。

## 11.6 内存压力过高

检查：

- HNSW 图参数是否过大；
- 是否加载了过多副本或 Segment；
- 向量是否必须使用 float32；
- 是否可以使用 Float16、Int8 或 IVF_SQ8；
- 是否应评估 DiskANN；
- Partition 与数据分布是否导致热点节点；
- Query Node 的加载与副本策略是否合理。

优化内存不是简单地“把 `ef` 调小”。`ef` 主要影响查询时的候选宽度，长期内存大头往往来自向量本身、图结构与已加载 Segment。

---

## 十二、什么时候该用 Milvus，什么时候不该

Milvus 的价值来自它的分布式架构，但架构能力也意味着部署和运维成本。

## 12.1 更适合 Milvus 的场景

- 向量规模持续增长到单机内存难以承载；
- 写入与查询都需要独立横向扩展；
- 需要多种 ANN、磁盘索引、GPU 或混合检索能力；
- 数据天然适合对象存储与不可变 Segment；
- 团队能维护分布式组件、监控后台任务和容量；
- 业务能明确表达新鲜度、召回、延迟和成本之间的取舍。

## 12.2 可能不该优先选 Milvus 的场景

- 数据只有几十万条，单机轻松容纳；
- 业务数据已经全部在 PostgreSQL 中，向量检索只是附属功能；
- 强依赖事务、Join 与关系约束；
- 团队没有专门运维能力；
- 只是做原型、课程实验或本地 Demo；
- 为“未来也许会有十亿向量”而提前承担当前不需要的复杂度。

这类场景通常可以先评估：

- pgvector：向量与关系数据共存，复用 PostgreSQL 事务和运维体系；
- 轻量本地向量库：适合原型与单机应用；
- 托管向量数据库：用服务成本换运维成本；
- 应用内 ANN 库：数据静态、单机可控且不需要数据库语义时。

技术选型的重点不是“谁的 Benchmark 最高”，而是系统边界是否匹配业务。

---

## 十三、用一组问题检验自己是否真的学会

不要立即看答案，先尝试独立解释。

1. Collection 创建完成但尚未写入时，etcd 与对象存储里分别有什么？
2. Partition 与 Shard 分别由什么决定，各自优化什么？
3. 为什么说 Growing Segment 中的数据已经可以安全，却仍可能查不到或查得慢？
4. 一次写入在哪个阶段建立持久性边界？为什么不是建索引完成时？
5. Query Node 崩溃后为什么不丢数据？它从哪里恢复？
6. 为什么频繁 Flush 会让读路径变贵？
7. `nlist` 与 `nprobe` 哪个需要重建？`M` 与 `ef` 呢？
8. 为什么 DiskANN 仍然需要内存？
9. 一次 Search 为什么必须跨多个 Segment 做局部 Top-K 再归并？
10. 为什么带过滤的 ANN 可能比不带过滤更难？
11. Strong、Bounded、Session、Eventually 的差别，如何用 Guarantee Timestamp 统一解释？
12. 用户刚写入一条数据，只要求自己立刻读到，为什么 Session 通常比 Strong 更合适？
13. 删除已经不再返回结果，为什么对象存储占用仍未下降？
14. 一个多租户 RAG 应如何同时设计 Partition Key、索引和一致性？
15. 什么规模和组织条件下，Milvus Distributed 可能是过度设计？

如果能不看资料，把这些问题串成因果链，而不是只背定义，就已经建立了比较完整的心智模型。

---

## 十四、最后把整套系统压缩成四句话

第一，**WAL 是事实源**。写入先进入日志，持久性因此与具体计算节点解耦，节点可以失败、迁移和横向扩展。

第二，**Segment 是统一物理单元**。数据从 Growing 走向 Sealed、Flushed 和 Indexed；删除通过 Tombstone 表达，Compaction 负责最终收敛。

第三，**没有整表一个大索引**。每个 Sealed Segment 各建一份索引，所以查询天然是多段并行检索与多级 Top-K 归并；Segment 数量和单段检索成本共同决定延迟。

第四，**一致性是在选择日志可见位置**。Strong、Bounded、Session 和 Eventually 本质上是为 Guarantee Timestamp 选择不同的值，用新鲜度交换等待时间与吞吐。

把这四句话连起来，就能解释 Milvus 的大部分行为：

```text
日志先行
  → 计算节点可以无状态
  → 增量先成为 Growing Segment
  → 稳定数据固化为不可变 Segment
  → 每段独立建索引
  → 查询扇出并归并
  → Segment 数与索引旋钮共同决定延迟
  → Guarantee Timestamp 决定能看到多新的数据
```

这也是 Milvus 真正的学习主线：不要从 API 列表出发，而要从写入日志、Segment 生命周期和分布式读路径出发。理解了这些结构，索引参数与一致性级别才不再是需要死记的配置项，而会成为可以根据业务约束推导出来的工程选择。

## 参考资料

- [Milvus 官方文档](https://milvus.io/docs)
- [Milvus Architecture Overview](https://milvus.io/docs/architecture_overview.md)
- [Milvus Consistency Level](https://milvus.io/docs/consistency.md)
- [Milvus Index Explained](https://milvus.io/docs/index-explained.md)
- [Milvus: A Purpose-Built Vector Data Management System](https://www.vldb.org/pvldb/vol14/p3152-guo.pdf)
- [Manu: A Cloud Native Vector Database Management System](https://www.cidrdb.org/cidr2022/papers/p84-guo.pdf)
- [ann-benchmarks](https://ann-benchmarks.com/)
