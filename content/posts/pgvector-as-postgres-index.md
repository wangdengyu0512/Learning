---
title: 当向量检索成为 Postgres 的一种索引：理解 pgvector 的真正边界
description: 从排序契约、HNSW 构建、MVCC、过滤检索到量化与选型，系统理解 pgvector 在生产环境中的行为。
date: 2026-10-06
tags: PostgreSQL, pgvector, RAG
featured: true
---

# 当向量检索成为 Postgres 的一种索引：理解 pgvector 的真正边界

很多人第一次接触 pgvector，会把它理解成“运行在 PostgreSQL 里的向量数据库”。这个说法不算错，却容易让人带着错误的预期进入生产环境。

更准确的理解是：**pgvector 把向量检索实现成了 PostgreSQL 的一种索引访问方式。**

这一区别非常关键。向量检索一旦进入 PostgreSQL，就不再是一个独立运行的搜索子系统，而必须服从数据库原有的规则：查询由 planner 选择执行计划，行是否可见由 MVCC 决定，死亡元组由 vacuum 清理，索引构建受内存参数约束，过滤条件也不一定能在向量索引内部完成。

因此，生产中那些看起来“很奇怪”的现象——

- 明明写了 `LIMIT 10`，结果却只返回 4 条；
- 建了 HNSW 索引，查询仍然走全表扫描；
- 批量更新一批 embedding 后，召回率突然下降；
- 构建索引前半段很快，后半段却像卡死一样；
- 向量索引存在，但加上租户过滤后尾延迟暴涨；

往往不是 bug，而是同一条底层契约的不同表现：

> **pgvector 的向量索引，本质上服务于 `ORDER BY 距离 LIMIT k`。**

本文以一个多租户 RAG 文档库为例，从数据模型、索引构建、MVCC 生命周期、过滤检索和技术选型五个方面，把这条主线展开。

> 版本说明：本文根据目录内资料整理，技术示例以 pgvector 0.8.2、PostgreSQL 16/17 为基线。涉及版本、生态项目和规模边界的内容应视为该资料基线下的工程判断，而不是对 2026 年 10 月最新状态的联网核验。

---

## 一、先看懂那条贯穿始终的 SQL

假设我们在 PostgreSQL 中保存被切分后的文档块，每一行同时包含业务字段和 embedding：

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE doc_chunks (
    id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    doc_id      bigint       NOT NULL,
    tenant_id   int          NOT NULL,
    lang        text         NOT NULL,
    content     text         NOT NULL,
    embedding   vector(1536) NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now()
);
```

一次典型的多租户 RAG 检索可能是：

```sql
SELECT id, content
FROM   doc_chunks
WHERE  tenant_id = 42
  AND  lang = 'zh'
ORDER  BY embedding <=> $1
LIMIT  10;
```

这条 SQL 看起来很自然，但它实际上把两类完全不同的工作放到了一起：

1. `WHERE tenant_id = 42 AND lang = 'zh'` 是关系过滤，通常由 B-tree、分区或普通扫描处理；
2. `ORDER BY embedding <=> $1 LIMIT 10` 是距离排序与 Top-K 截断，才是 HNSW 或 IVFFlat 的职责。

**向量索引不会天然理解“租户 42”或“中文文档”。**它擅长回答的是：“离查询向量最近的结果是谁？”至于这些结果是否属于指定租户，通常要在索引返回候选之后再判断。

理解这个职责边界，是理解后续所有问题的起点。

---

## 二、向量不是数组，而是一种可参与距离运算的数据类型

如果只想保存 embedding，`float[]`、JSON 甚至拆成多列都能做到。但这些表示方式只解决“存储”，没有告诉 PostgreSQL 两个值之间应该如何比较，也无法直接建立 ANN 索引。

pgvector 的价值在于，它把 embedding 变成数据库能够识别的类型，并为这些类型定义了距离运算符和索引 operator class。

常见类型包括：

| 类型 | 每维占用 | 资料基线下的可索引维度 | 适用场景 |
| --- | ---: | ---: | --- |
| `vector` | 4 字节，float32 | 不超过 2,000 维 | 常规稠密向量 |
| `halfvec` | 2 字节，float16 | 不超过 4,000 维 | 3072 维向量或希望减半索引体积 |
| `bit` | 1 bit | 最多 64,000 位 | 二值量化、Hamming 距离 |
| `sparsevec` | 只存非零项 | 不超过 1,000 个非零项 | 稀疏向量 |

`vector` 的 2,000 维索引上限并不是任意规定。HNSW 的一个索引项不仅要保存向量，还要保存图结构相关信息，而 PostgreSQL 的索引页通常是 8KB。`vector(2000)` 的原始数据已经接近 8KB，再加上元组头和图指针，很快就会碰到单页限制。

因此，3072 维向量通常仍可在表中保存为 `vector(3072)`，但建索引时转换为 `halfvec`：

```sql
CREATE INDEX doc_chunks_embedding_half_idx
ON doc_chunks
USING hnsw (
    (embedding::halfvec(3072)) halfvec_cosine_ops
);
```

这不是一个临时绕过限制的技巧，而是利用半精度表示换取可索引维度和更小索引体积的标准工程手段。

### 距离运算符必须和 opclass 匹配

pgvector 常用的距离运算符如下：

| 运算符 | 距离度量 | 对应 opclass |
| --- | --- | --- |
| `<->` | L2 / 欧氏距离 | `vector_l2_ops` |
| `<=>` | cosine 距离 | `vector_cosine_ops` |
| `<#>` | 负内积 | `vector_ip_ops` |
| `<+>` | L1 / 曼哈顿距离 | `vector_l1_ops` |

建索引时，opclass 决定这张图按什么距离组织：

```sql
CREATE INDEX doc_chunks_embedding_cosine_idx
ON doc_chunks
USING hnsw (embedding vector_cosine_ops);
```

查询时则必须使用与其匹配的运算符：

```sql
-- 可以匹配 vector_cosine_ops
SELECT id
FROM doc_chunks
ORDER BY embedding <=> $1
LIMIT 10;
```

如果索引使用 `vector_cosine_ops`，查询却写成 `<->`，通常不会报错，只是 planner 无法把查询运算符和索引匹配起来，最终可能退化为顺序扫描和全量距离排序。

这类问题最危险的地方在于：**结果仍然正确，只是性能突然从毫秒级退化到秒级。**

### 为什么内积运算符返回负数

内积越大，通常表示越相似；但 PostgreSQL 的这类索引排序按升序输出更容易工作。为了让“最相似”的结果变成“最小值”，pgvector 使用负内积：

```sql
ORDER BY embedding <#> $1
```

此时不应该再加 `DESC`。`<#>` 已经通过取负完成了排序方向转换，升序扫描就能把最大内积对应的结果排在最前面。若要展示真实内积分值，可以对结果乘以 `-1`，但排名本身不需要再反转。

---

## 三、真正的总开关：`ORDER BY 距离 LIMIT k`

普通 B-tree 更像“过滤索引”，擅长回答等值和范围问题，例如：

```sql
WHERE tenant_id = 42
WHERE created_at >= now() - interval '7 days'
```

HNSW 和 IVFFlat 更像“排序访问方法”：它们按距离产生一个有序结果流，让执行器取到前 `k` 个之后停止。

因此，一条能够稳定触发向量索引的查询，通常需要满足以下形状：

```sql
ORDER BY embedding <=> $1
LIMIT 10
```

几个常见误区是：

```sql
-- 只有距离阈值，没有 Top-K 排序，通常不能按预期使用 ANN 索引
WHERE embedding <=> $1 < 0.3;

-- 要求全部结果有序，planner 可能认为顺序扫描加排序更便宜
ORDER BY embedding <=> $1;

-- 向量索引按升序返回，DESC 会破坏使用条件
ORDER BY embedding <#> $1 DESC
LIMIT 10;
```

可以把 HNSW 想象成一条“按离查询向量的距离排好队的传送带”：查询从最近的一端不断取结果，取够 `k` 个就停。

但这条传送带不知道 `tenant_id`。如果还要求“只保留租户 42 的行”，就只能把候选拿下来后逐个检查，或者为租户 42 单独建立一条只包含其数据的传送带。

这正是过滤欠返的根源。

---

## 四、HNSW 为什么必须尽量驻留内存

pgvector 中的 HNSW 不是一个抽象的内存图，而是被拆成索引元组，分散存放在 PostgreSQL 的 8KB 页面中。

简化来看，一类元组保存向量、堆表 TID 和层级信息，另一类元组保存邻居列表。图遍历时，查询从入口点出发，读取一个节点，再根据邻居指针跳到另一个可能位于任意页面的节点。

这意味着 HNSW 查询天然具有大量随机页访问：

1. 读取当前 element tuple；
2. 找到 neighbor tuple；
3. 沿邻居 TID 跳到下一个 element；
4. 重复几十次甚至更多。

当索引的大部分页面位于 `shared_buffers` 或操作系统页缓存中时，这些跳转主要发生在内存里，延迟可以保持在毫秒级。若索引远大于可用内存，每一步都可能触发磁盘缺页，随机 I/O 会让尾延迟快速恶化。

因此，评估 HNSW 是否“装得下”时，不应该只估算原始向量大小，更应该在建完索引后直接测量：

```sql
SELECT pg_size_pretty(
    pg_relation_size('doc_chunks_embedding_cosine_idx')
);
```

图中还包含邻居槽和索引元组开销，实际体积可能显著大于“行数 × 向量字节数”。

---

## 五、构建悬崖：`maintenance_work_mem` 不够不是慢一点，而是慢一个数量级

HNSW 构建会优先尝试把正在生长的图放在 `maintenance_work_mem` 中。一旦图超过这个上限，pgvector 会发出类似提示：

```text
NOTICE: hnsw graph no longer fits into maintenance_work_mem
HINT: Building will take significantly more time.
```

这条日志不是普通提醒，而是一个明显的性能分界点。越过阈值后，构建过程会进入逐元组落盘和随机读写更重的路径，资料中给出的经验差距可达 10～50 倍。

构建前可以针对当前会话临时调大维护内存与并行 worker：

```sql
SET maintenance_work_mem = '8GB';
SET max_parallel_maintenance_workers = 7;

CREATE INDEX doc_chunks_embedding_cosine_idx
ON doc_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

这里有两个容易混淆的点：

- `maintenance_work_mem` 影响构建和维护，不决定查询时索引能否驻留缓存；
- 构建快并不代表查询一定快。查询延迟仍取决于索引页面能否长期留在共享缓存和系统页缓存中。

### 构建参数和查询参数要分开看

HNSW 常见参数可以分成两类：

- `m`、`ef_construction`：构建参数，决定图的连接质量、体积和构建成本；
- `hnsw.ef_search`：查询参数，决定一次查询探索多少候选。

构建参数确定的是索引质量上限，建完后不能在线修改，只能重建。查询参数可以按会话甚至按事务调整：

```sql
SET hnsw.ef_search = 100;
```

如果把 `ef_search` 调得很高，召回率仍然上不去，瓶颈可能不是“查询搜得不够深”，而是图本身的质量不足。这时需要提高 `m` 或 `ef_construction` 后重建索引，而不是继续增加查询预算。

---

## 六、不要凭感觉谈召回率

ANN 的全称是近似最近邻。它的目标不是保证 100% 找到真实 Top-K，而是在延迟、内存和召回之间做交换。

最危险的情况不是查询报错，而是：查询稳定返回 10 条、延迟也很好，但这 10 条中只有 7 条属于真实 Top-10。数据库不会主动告诉你召回率下降了。

正确的评估方法是给同一批查询向量跑两套结果：

1. 禁用索引扫描，获得精确暴力检索的 Top-K，作为 ground truth；
2. 正常使用 HNSW，获得近似 Top-K；
3. 计算两者交集占 `k` 的比例，即 recall@k；
4. 在一批具有代表性的查询向量上取平均和分位数。

```sql
BEGIN;
SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;

SELECT id
FROM doc_chunks
ORDER BY embedding <=> $1
LIMIT 10;

COMMIT;
```

再恢复索引，调整搜索参数：

```sql
SET hnsw.ef_search = 40;

SELECT id
FROM doc_chunks
ORDER BY embedding <=> $1
LIMIT 10;
```

如果召回不达标，再逐步提高 `ef_search` 并重测。单个查询样本没有意义，必须使用接近真实流量分布的查询集。

生产验收至少应该同时观察：

- recall@k；
- 平均延迟与 P95/P99；
- 返回结果数量是否达到 `k`；
- 索引大小和缓存命中情况；
- 不同租户、语言和时间窗口下的分组表现。

---

## 七、MVCC：正确性还在，完整性却可能丢失

PostgreSQL 中的 `UPDATE` 本质上是“旧版本失效 + 新版本插入”，`DELETE` 也不会立即把元组从磁盘上抹掉。死亡元组会保留到 vacuum 清理。

对 HNSW 来说，旧节点也不会在更新或删除发生时立刻从图里摘除。索引仍可能找到这个节点，再由执行器回到堆表做 MVCC 可见性检查：

- 可见，返回；
- 已删除或对当前快照不可见，丢弃。

这样可以保证结果不会错误地包含已删除数据，但可能产生另一个问题：**候选预算已经消耗了，过滤后却不够 `LIMIT k`。**

假设 `ef_search = 40`，HNSW 先找到 40 个候选后停止。若其中大量节点指向刚被更新或删除的旧版本，MVCC 可见性检查会把它们剔除。最终可能只剩 3 条，即使表里还有大量有效向量。

这说明系统仍然“正确”——没有返回脏数据；但结果集不再“完整”——没有凑够请求的 Top-10。

### HNSW vacuum 为什么昂贵

根据目录资料中的实现分析，HNSW vacuum 大致要做三类工作：

1. 从索引节点保存的堆 TID 集合中移除死亡 TID；
2. 为受影响节点重新寻找邻居，修复图连通性；
3. 标记完全失效的节点并清理其向量数据。

第二步最贵，因为它不是简单删除一个指针，而是要为受影响节点重新计算替补边。删除本身可能很轻，真正的代价被推迟到了 vacuum。

更重要的是，vacuum 做的是“修补”，不是“重新规划整张图”。它可以恢复连通性，却不会把经历多轮删除、插入和绕行后的图重新整理成初始状态。

因此，高 churn 表可能出现两类退化：

- vacuum 跟不上时，死亡节点占据候选预算，出现急性的欠返和召回下降；
- vacuum 即使跟得上，长期修补仍可能形成更绕的搜索路径，使召回缓慢腐烂。

常见维护策略包括：

```sql
ALTER TABLE doc_chunks SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_vacuum_cost_delay   = 0
);
```

并监控死亡元组比例：

```sql
SELECT relname,
       n_live_tup,
       n_dead_tup,
       round(
           100 * n_dead_tup /
           nullif(n_live_tup + n_dead_tup, 0),
           1
       ) AS dead_pct
FROM pg_stat_user_tables
WHERE relname = 'doc_chunks';
```

当召回跌破业务阈值，或死亡元组比例持续进入较高区间时，可以考虑并发重建：

```sql
REINDEX INDEX CONCURRENTLY doc_chunks_embedding_cosine_idx;
```

资料中将 10%～15% 死亡元组比例作为一个经验触发区间，但这不是 PostgreSQL 的硬性规则。更可靠的做法是同时结合召回率、查询欠返率、vacuum 耗时和业务低峰窗口决定。

对于每天大批量重新生成 embedding 的系统，进一步可以考虑：

- 按时间或数据热度分区，只重建热分区；
- 新旧 embedding 列与索引做蓝绿切换；
- 避免在同一列上维护不必要的多套距离索引；
- 将高频原地更新改为批次化版本发布。

---

## 八、带过滤的检索，才是生产 RAG 真正的难题

回到这条查询：

```sql
SELECT id, content
FROM doc_chunks
WHERE tenant_id = 42
  AND lang = 'zh'
ORDER BY embedding <=> $1
LIMIT 10;
```

如果 HNSW 先取 40 个候选，再执行租户和语言过滤，而租户 42 的数据只占全表的 10%，那么过滤后平均可能只剩约 4 条。

这就是经典的 post-filter 欠返：

> 不是库里没有足够的数据，而是 ANN 的候选预算在过滤之前就用完了。

这个结构与 MVCC 欠返完全同构：

- MVCC 场景中，隐式条件是“这行对当前快照是否可见”；
- 多租户场景中，显式条件是“这行是否满足 `tenant_id = 42`”；
- 两者都是“先拿固定数量候选，再过滤，最后数量不足”。

### 方案一：iterative scan，适合作为默认兜底

pgvector 0.8.0 引入 iterative scan，使 HNSW 在过滤后不够 `k` 条时继续向外扫描，直到补够结果或触达资源上限。

```sql
SET hnsw.iterative_scan = relaxed_order;
SET hnsw.max_scan_tuples = 20000;

SELECT id, content
FROM doc_chunks
WHERE tenant_id = 42
  AND lang = 'zh'
ORDER BY embedding <=> $1
LIMIT 10;
```

需要注意的是，iterative scan 默认并不会自动开启。仅升级扩展版本，并不意味着过滤欠返会自行消失。

两种常见模式是：

- `strict_order`：更严格地维持距离顺序；
- `relaxed_order`：允许轻微乱序以换取更好的吞吐，很多 RAG 场景足够使用。

iterative scan 解决了“固定候选池一次取完”的问题，但如果过滤值极其稀疏，它仍可能扫描大量节点并撞上 `max_scan_tuples` 或内存上限。

### 方案二：partial index，适合少量固定大租户

如果只有少数几个大租户，可以为每个大租户建立局部索引：

```sql
CREATE INDEX doc_chunks_tenant_42_hnsw_idx
ON doc_chunks
USING hnsw (embedding vector_cosine_ops)
WHERE tenant_id = 42;
```

这相当于把过滤提前到索引构建阶段。图中只有租户 42 的数据，搜索出来的候选天然满足过滤条件，召回不再被 post-filter 稀释。

代价也很直接：一个过滤值一张索引。十个大租户可以接受，十万个长尾租户则会造成不可承受的构建、存储、写入和 vacuum 成本。

### 方案三：先走 B-tree，再精确排序

如果过滤条件只命中几十或几百行，ANN 反而没有必要。先通过 B-tree 找出候选，再对小集合做精确距离排序，通常又快又准：

```sql
CREATE INDEX doc_chunks_tenant_lang_idx
ON doc_chunks (tenant_id, lang);
```

此时 planner 选择 B-tree + 精确排序，并不是“向量索引失效”，而是正确的成本判断。对 200 行计算精确距离，可能比遍历一张大型 HNSW 图更便宜，而且召回是 100%。

实际系统可以按租户数据量做分层路由：

- 大租户：partial HNSW index；
- 中等租户：全局 HNSW + iterative scan；
- 极小租户：B-tree 过滤 + 精确排序。

这里没有一种策略适合所有选择性。关键是统计不同过滤值的行数分布，再用 `EXPLAIN (ANALYZE, BUFFERS)` 验证计划和成本。

---

## 九、有索引却不走，先检查契约，再检查成本

排查 pgvector 查询时，不要直接假设 planner 出错。先运行：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM doc_chunks
ORDER BY embedding <=> $1
LIMIT 10;
```

理想计划中应该看到对应向量索引的 `Index Scan`。如果出现 `Seq Scan` 加 `Sort`，可以按下面的顺序检查：

1. 查询运算符是否与 opclass 匹配；
2. 是否误加了 `DESC`；
3. 是否缺少 `LIMIT`；
4. `ORDER BY` 是否写成了 planner 无法匹配的复杂表达式；
5. 表是否太小，以至于顺序扫描本来就更便宜；
6. 统计信息是否过旧；
7. 过滤选择性是否让 B-tree + 精确排序更划算；
8. pgvector 版本的成本模型是否适合当前查询形态。

不要在只有几百行的测试表上验证 HNSW 是否“有效”。对小表而言，全表计算距离本来就可能比图遍历更快，planner 选择顺序扫描是合理行为。

---

## 十、向量召回还不够：生产系统通常需要 Hybrid Search

稠密向量检索擅长捕获语义相似，但对产品型号、人名、缩写和罕见术语未必稳定。比如用户搜索 `SKU-7731`，纯向量检索可能返回语义相关的产品说明，却漏掉包含精确型号的文档。

生产 RAG 通常同时运行两条召回链：

- 稠密向量检索，负责语义；
- 词法检索，负责关键词、实体和精确 token。

两路分数不能简单相加，因为 cosine 距离和词法相关性分数不在同一量纲。更稳妥的方式是 Reciprocal Rank Fusion（RRF），仅根据名次融合：

```text
RRF score = Σ 1 / (k + rank_i)
```

`k` 常取 60。只要一个文档同时出现在两张榜单中，它就会因为“双路共识”而被明显抬升。

一个简化 SQL 示例是：

```sql
WITH dense AS (
    SELECT id,
           RANK() OVER (ORDER BY embedding <=> $1) AS rank
    FROM doc_chunks
    WHERE tenant_id = 42
    ORDER BY embedding <=> $1
    LIMIT 40
),
lexical AS (
    SELECT id,
           RANK() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
    FROM doc_chunks,
         plainto_tsquery('simple', $2) AS q
    WHERE tenant_id = 42
      AND content_tsv @@ q
    LIMIT 40
)
SELECT COALESCE(d.id, l.id) AS id,
       COALESCE(1.0 / (60 + d.rank), 0)
     + COALESCE(1.0 / (60 + l.rank), 0) AS score
FROM dense d
FULL OUTER JOIN lexical l USING (id)
ORDER BY score DESC
LIMIT 10;
```

真正上线时，还需要分别测量两条召回链的候选数、延迟和覆盖率，而不是只调最终的 `LIMIT 10`。

---

## 十一、量化与 Rescore：用更小的表示完成粗筛

当向量数量上升后，内存往往比计算更先成为瓶颈。量化的核心思想是：**索引阶段不一定需要保存完整精度，只要能把正确候选圈进 shortlist 即可。**

可以把表示精度看作一架阶梯：

| 表示 | 每维大小 | 作用 |
| --- | ---: | --- |
| `vector` / fp32 | 4 字节 | 全精度基线 |
| `halfvec` / fp16 | 2 字节 | 体积减半，通常是性价比较高的选择 |
| 二值表示 | 1 bit | 大幅压缩，用于低成本粗筛 |

量化检索通常分两阶段：

1. 在低精度表示上快速取出比 `k` 大得多的候选集，例如 top-200；
2. 回到全精度向量，对这 200 条重新计算距离并排序，最终取 top-10。

示意写法如下：

```sql
SELECT id, content
FROM (
    SELECT id, content, embedding
    FROM doc_chunks
    ORDER BY binary_quantize(embedding)::bit(1536)
          <~> binary_quantize($1)
    LIMIT 200
) AS shortlist
ORDER BY embedding <=> $1
LIMIT 10;
```

量化本身并不神奇。若 shortlist 太小，正确候选在第一阶段就被漏掉，后面的全精度 rescore 也无能为力。调优时必须一起测试：

- 量化方式；
- shortlist 倍率；
- rescore 成本；
- recall@k；
- 内存节省；
- P95/P99 延迟。

---

## 十二、什么时候 pgvector 是正确答案，什么时候应该换路线

pgvector 最大的优势不是“绝对最快”，而是**向量与业务数据处在同一个 PostgreSQL 事务、同一套 SQL 和同一套运维体系里**。

它尤其适合：

- 数据本来就在 PostgreSQL 中；
- 需要向量写入与业务写入原子提交；
- 查询经常同时带租户、语言、时间等关系过滤；
- 数据规模和 HNSW 索引仍能被当前机器的内存体系覆盖；
- 更新频率在 autovacuum、定期 REINDEX 能控制的范围内；
- 团队希望避免额外维护一套独立向量数据库。

资料中把约千万级以内视为 pgvector 的“舒适区”，但这个数字不是硬边界。实际边界取决于维度、量化、索引参数、机器内存、过滤选择性、目标召回和延迟预算。

当出现以下情况时，应认真评估其他方案：

- 向量达到上亿级，全精度 HNSW 图无法驻留内存；
- 纯向量查询是绝对热路径，QPS 和尾延迟要求极高；
- 大规模查询还伴随复杂、高选择性过滤；
- churn 极高，vacuum 长期追不上，REINDEX 频率已影响可用性；
- 需要水平分片和专门为向量检索优化的分布式架构。

如果希望继续留在 PostgreSQL 生态内，可以关注基于 DiskANN、ScaNN 或更强量化方案的扩展与托管实现。它们的共同目标是将“全精度图必须全部驻留 RAM”改造成“压缩表示负责图遍历，全精度数据留在 SSD，最后 rescore”。

如果业务几乎没有关系查询优势，向量检索本身就是系统核心，并且需要独立扩缩容，那么专用向量数据库往往更自然。

选型时可以依次问四个问题：

1. 业务数据是否已经在 PostgreSQL？
2. 索引及热点工作集是否还能被内存覆盖？
3. 查询是否依赖 PostgreSQL 的事务与关系过滤能力？
4. churn 是否仍在 vacuum 和 REINDEX 可管理范围内？

答案不是“pgvector 永远够用”或“专用库一定更快”，而是你的主要矛盾究竟在事务、过滤、内存、延迟还是写入维护。

---

## 十三、一份可落地的生产检查清单

### 建模阶段

- 根据 embedding 维度选择 `vector` 或 `halfvec`；
- 明确模型对应的距离度量；
- 保证查询运算符与索引 opclass 匹配；
- 如果向量已归一化，评估是否可以统一使用内积排序；
- 不要为了偶发查询无节制地在同一列上建立多张距离索引。

### 建索引阶段

- 新项目默认优先评估 HNSW；
- IVFFlat 应先导入数据再建索引；
- 按实际索引体积配置 `maintenance_work_mem`；
- 关注 `graph no longer fits into maintenance_work_mem`；
- 配套设置 `max_parallel_maintenance_workers`；
- 建完后用 `pg_relation_size()` 测量真实索引体积。

### 查询与召回阶段

- 保持 `ORDER BY 距离 LIMIT k` 的可匹配形状；
- 用 `EXPLAIN (ANALYZE, BUFFERS)` 验证计划；
- 不要只看返回数量和耗时，必须测 recall@k；
- 用关闭索引扫描的精确结果作为 ground truth；
- 分别统计不同租户、语言和过滤选择性的表现；
- 对带过滤查询显式评估 iterative scan。

### 生命周期阶段

- 监控 `n_dead_tup`、vacuum 时长和召回变化；
- 高 churn 表降低 autovacuum 触发阈值；
- 把欠返率作为独立指标，而不只监控 SQL 错误率；
- 召回持续衰减时考虑 `REINDEX CONCURRENTLY`；
- 大规模 re-embedding 优先考虑分区或蓝绿索引切换。

### 架构阶段

- 语义召回之外增加词法召回；
- 使用 RRF 等无量纲方法融合排名；
- 内存吃紧时优先评估 `halfvec`；
- 使用二值量化时必须配合足够大的 shortlist 和全精度 rescore；
- 当规模、过滤尾延迟或 churn 越界时，评估 DiskANN 路线或专用向量库。

---

## 结语

理解 pgvector，最重要的不是记住某个参数的默认值，而是建立一条完整的因果链：

1. 向量索引是一种按距离产生有序结果的访问方法；
2. 它主要服务 `ORDER BY 距离 LIMIT k`，并不直接负责普通关系过滤；
3. HNSW 的图遍历依赖随机页访问，所以索引能否驻留内存决定了延迟下限；
4. 构建过程受 `maintenance_work_mem` 约束，跨过阈值会进入明显更慢的路径；
5. ANN 的召回不会自动被数据库监控，必须用精确结果建立 ground truth；
6. MVCC 和 `WHERE` 过滤都会在候选产生之后剔除结果，从而造成欠返；
7. vacuum 能修复图，却不能完全恢复一张经历长期 churn 的图；
8. partial index、iterative scan 和 B-tree 精确排序应按过滤选择性组合使用；
9. 量化负责缩小索引，rescore 负责把精度拉回来；
10. pgvector 的核心优势始终是与 PostgreSQL 的事务、关系数据和运维体系融为一体。

当你把 pgvector 看成 PostgreSQL 的一种索引，而不是一个被塞进数据库的独立搜索引擎，许多生产问题就不再神秘。你会知道为什么它欠返、为什么它不走索引、为什么更新会腐蚀召回，也会更清楚：什么时候应该继续调 PostgreSQL，什么时候应该换一条技术路线。
