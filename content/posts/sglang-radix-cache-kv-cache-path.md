---
title: 深入 SGLang KV Cache：从 Radix Prefix Cache 到 GPU 显存映射
description: 从 Cache Manager 出发，用贯穿全文的 Token 示例拆解 Radix Cache 的插入、匹配、锁定与淘汰，并对比 vLLM Block KV Cache 的设计取舍。
date: 2026-11-07
tags: SGLang, KV Cache, vLLM
featured: true
---

# 深入 SGLang KV Cache：从 Radix Prefix Cache 到 GPU 显存映射

大模型推理系统里，KV Cache 经常被概括成“避免重复计算历史 Token”。这句话没有错，却跳过了真正困难的部分：缓存放在哪里，如何找到它，多个请求怎样共享它，谁能释放它，以及一棵 CPU 上的前缀树为什么最终能让 GPU 少做一次 Prefill。

对 SGLang 而言，这条路径的核心是 **RadixAttention / Radix Cache**。它不是一个单纯的字典，也不是 GPU 上另一份 KV 张量，而是一套把前缀索引、请求调度、引用保护和显存回收连在一起的控制机制。

本文从 Cache Manager 的视角进入这条路径，并用三条 Token 序列贯穿全文：

```text
A: [1, 2, 3, 4, 5, 6, 7, 8]
B: [1, 2, 3, 4, 9, 10]
C: [1, 2, 3, 4, 5, 11]
```

我们最终要回答五个问题：

1. Radix Cache 的节点到底存了什么？
2. 插入、最长前缀匹配和节点分裂如何发生？
3. `lock_ref` 为什么决定了缓存能不能被淘汰？
4. Radix Tree、请求 Page Table 和 GPU KV 张量之间如何映射？
5. SGLang 与 vLLM 都支持 Prefix Caching，它们的真正差异是什么？

> 本文讨论稳定的架构机制，并参考 SGLang 与 vLLM 当前上游文档和源码。字段名、默认淘汰策略及混合模型实现会随版本变化，生产排查应以实际部署版本为准。

---

## 一、为什么 KV Cache 是推理系统的关键路径

### 1. 从自回归注意力看重复计算

在因果语言模型中，第 `t` 个 Token 的注意力只能读取它之前的位置。若每生成一个新 Token 都重新计算整段历史，历史部分就会被反复计算。

KV Cache 的做法是：每层注意力计算完历史 Token 的 Key 和 Value 后，把结果保留下来。下一步 Decode 只为新 Token 计算新的 K/V，并读取已有缓存。

忽略对齐和元数据，一个 Token 的 KV Cache 大小可以近似写成：

```text
KV_bytes_per_token
  = 2 × num_layers × num_kv_heads × head_dim × bytes_per_element
    ↑
   K 和 V
```

以 32 层、8 个 KV Head、每个 Head 128 维、BF16 为例：

```text
2 × 32 × 8 × 128 × 2 bytes = 131072 bytes ≈ 128 KiB / token
```

一条 32K Token 的上下文，仅 KV Cache 就约为 4 GiB。不同模型会因 GQA、MQA、MLA、量化或混合注意力而显著不同，但结论不变：**KV Cache 既是计算复用的依据，也是推理容量的主要约束之一。**

### 2. Prefix Cache 优化的是 Prefill，不是免费生成

假设请求 B 到来时，系统已经缓存了 `[1,2,3,4]` 的 K/V。B 可以跳过这四个 Token 的重复 Prefill，只计算 `[9,10]` 对应的未命中部分。

这主要改善重复 Prompt 的 Prefill 工作量、Time To First Token（TTFT）、同一显存容量下的有效上下文，以及多个请求共享长前缀时的系统吞吐。它不会消除新 Token 的 Decode。模型仍要逐个生成新 Token，并读取越来越长的历史 KV。因此，“前缀命中率高”不等于“端到端延迟按同样比例下降”。

### 3. 真正的问题是缓存身份与生命周期

知道“某段前缀算过”还不够，系统必须同时解决：

- **身份**：这段 Token 属于哪个模型、适配器和缓存命名空间？
- **位置**：对应 K/V 实际位于哪些物理 Slot 或 Page？
- **所有权**：哪些活动请求正在读取这些位置？
- **回收**：显存不足时，哪些位置可以安全释放？
- **一致性**：树、页表和 GPU 数据如何一起更新，避免悬空引用？

这正是 Cache Manager 需要管理的完整问题。

---

## 二、从 Cache Manager 看整体架构

“Cache Manager”可以理解为推理 Runtime 中负责前缀命中、KV 分配、引用保护与回收的逻辑入口。在 SGLang 当前实现中，这些职责并不只落在一个类上，而是由 Prefix Cache、请求映射池、KV 分配器和设备内存池协作完成。

```text
请求 Token IDs
    │
    ▼
┌───────────────────────────────────────┐
│ Prefix Cache 控制面                  │
│ Radix Tree / Unified Radix Cache     │
│ prefix → tree node → KV slot indices │
└──────────────────┬────────────────────┘
                   │ 命中哪些物理 Slot
                   ▼
┌───────────────────────────────────────┐
│ Request Page Table                   │
│ ReqToTokenPool                       │
│ (request, logical_position) → slot   │
└──────────────────┬────────────────────┘
                   │ Attention 按 Slot 取数
                   ▼
┌───────────────────────────────────────┐
│ GPU KV Pool                          │
│ slot → K/V tensors of every layer    │
└───────────────────────────────────────┘
```

另有分配器维护空闲 Slot 或 Page：

```text
TokenToKVPoolAllocator
  ├─ allocate: 取出空闲物理位置
  └─ free:     把不再使用的位置放回空闲集合
```

这里最容易出现三个误解：

- **Radix Cache 里存着 KV Tensor**：通常不是。节点保存压缩 Token 片段、树关系、KV 物理索引及生命周期元数据；真正的大体积 K/V Tensor 位于 GPU KV Pool。
- **Radix Cache 替代了 Paged KV Cache**：也不是。Radix Tree 回答“哪个前缀可以复用”，分页内存回答“这些 K/V 放在哪些非连续物理位置”，两者处在不同层。
- **逻辑上下文必须在显存中连续**：不需要。Attention Kernel 通过 Page Table 读取非连续 Slot，共享前缀只需让不同请求指向相同物理位置。

---

## 三、Radix Prefix Cache 到底保存什么

### 1. Radix Tree 是压缩前缀树

普通 Trie 往往一条边只保存一个符号。Radix Tree 把没有分叉的连续路径压缩为一个节点或一条边，更适合长 Token 序列。

一个简化节点可以理解为：

```text
TreeNode
  key              当前压缩片段的 Token IDs
  value            与 key 对应的 KV Slot/Page 索引
  children         后继分支
  parent           父节点
  lock_ref         活动请求引用计数
  last_access_time 最近访问时间
  priority/...     淘汰策略所需的其他元数据
```

若某节点是：

```text
key   = [5, 6, 7, 8]
value = [17, 18, 70, 71]
```

它表达的是这些 Token 的 K/V 分别位于物理 Slot `[17,18,70,71]`。这里的数字只是索引，不是 KV 数据本身。

### 2. Cache Key 不一定只有 Token IDs

两个请求即使 Token IDs 相同，也不一定允许共享 KV。缓存身份还可能包含 LoRA/Adapter 标识、模型或权重版本、Cache Salt、租户隔离信息、多模态上下文等。SGLang 的 `RadixKey` 可通过额外 Key 与 Salt 隔离逻辑命名空间，因此更准确的表达是：

```text
cache identity = token sequence + compatible cache namespace
```

### 3. 为什么它适合分支型 Prompt

依次插入 A、B、C 后，逻辑结构会变成：

```text
root
 └─ [1,2,3,4]
     ├─ [5]
     │   ├─ [6,7,8]
     │   └─ [11]
     └─ [9,10]
```

共同前缀只存一份，差异部分形成分支。对多轮对话和 Agent 工作流来说，这个结构很自然：系统提示词和历史轨迹构成稳定主干，不同用户轮次、工具结果或候选方案成为树枝。

---

## 四、插入：从一条长边到多个分支

以下先假设 `page_size = 1`，即按 Token 粒度讨论匹配。后文再引入 Page 对齐。

### 1. 第一次插入 A

树为空时插入 A：

```text
root
 └─ [1,2,3,4,5,6,7,8]
```

假设 A 的物理 KV 索引是 `[41,5,92,93,17,18,70,71]`。节点 `value` 保存这组索引。KV Tensor 已由模型 Forward 写入 GPU Pool，插入 Radix Tree 主要是在控制面登记“前缀与物理位置的关系”。

### 2. 插入 B：在公共前缀处拆分

B 与现有节点的最长公共前缀长度是 4。原节点被拆成：

```text
root
 └─ [1,2,3,4]
     ├─ [5,6,7,8]
     └─ [9,10]
```

前四个 Token 继续引用 A 已有的 Slot `[41,5,92,93]`，B 只需为 `[9,10]` 分配新位置，例如 `[33,34]`。

**节点分裂通常只重组元数据，不意味着搬动 GPU 上的 K/V。** 原物理索引数组可切成公共段与后缀段，底层 Tensor 保持原位。

### 3. 插入 C：在已有分支内部再次拆分

C 先匹配 `[1,2,3,4]`，再进入 `[5,6,7,8]` 分支，并在 Token `5` 后分叉：

```text
root
 └─ [1,2,3,4]
     ├─ [5]
     │   ├─ [6,7,8]
     │   └─ [11]
     └─ [9,10]
```

这次仍不需要复制 Token `5` 的 KV。C 的页表直接指向原 Slot `17`，只为 `[11]` 分配新 Slot。

### 4. 并发插入为什么可能产生重复 KV

请求 X 和 Y 可能同时对同一未缓存后缀执行 Prefill。两者开始时都认为缓存未命中，并各自分配物理位置。X 先完成插入，Y 再插入时发现其中一段已经被 X 登记。

正确做法是保留已成为规范缓存项的位置，让后来的请求改为引用它，释放重复 Slot，并只把真正新增的后缀接入树。SGLang 当前插入路径会归并重复 Segment，这说明 Prefix Cache 不只是查找结构，也参与物理内存所有权的归并。

### 5. 插入的抽象伪代码

```python
def insert(node, key, value):
    child = find_child(node, key[0])
    if child is None:
        node.add_child(TreeNode(key, value))
        return

    n = longest_common_prefix(key, child.key)
    if n == len(child.key):
        return insert(child, key[n:], value[n:])

    common = TreeNode(child.key[:n], child.value[:n])
    replace_child(node, child, common)
    child.key, child.value = child.key[n:], child.value[n:]
    common.add_child(child)

    if n < len(key):
        common.add_child(TreeNode(key[n:], value[n:]))
```

真实实现还要处理 Page 对齐、缓存命名空间、时间戳、锁引用、重复 Slot 回收与混合注意力组件，但核心拓扑变化就是公共前缀分裂。

---

## 五、匹配：找到最长可复用前缀

对新请求 `D = [1,2,3,4,5,6,99]`，匹配过程是：

```text
root
  → 命中 [1,2,3,4]
  → 命中 [5]
  → 在 [6,7,8] 中命中 [6]
  → 期望 99，实际下一 Token 是 7，停止
```

最长缓存前缀为 `[1,2,3,4,5,6]`。返回结果至少表达命中的物理 KV 索引、命中长度、最后命中的节点或句柄，以及后续锁定和插入所需状态。D 只需为 `[99]` 及后续生成 Token 分配新位置。

一次成功匹配通常还会更新最近访问时间或淘汰优先级，并为活动请求增加引用保护。因此 `match_prefix` 不是完全无状态的字符串查找，它把命中结果交给请求页表，也与缓存生命周期衔接。

部分执行路径会保留至少一个输入 Token 经过 Forward，以得到下一 Token 的 Logits；不同版本也可能在 Prompt、Decode 或 Chunked Prefill 边界采用不同处理。这属于执行细节，不改变核心语义：命中部分提供历史 K/V，未命中部分产生新状态和输出。

---

## 六、Page Size：Token 级树不等于永远按 Token 复用

前文假设 `page_size = 1`。实际部署为提高分配、访存或传输效率，常使用更大的 Page。若 `page_size = 4`：

```text
A: Page A0=[1,2,3,4]  Page A1=[5,6,7,8]
B: Page B0=[1,2,3,4]  Tail=[9,10]
C: Page C0=[1,2,3,4]  Tail=[5,11]
```

B 与 C 都可以完整复用第一页。虽然 C 与 A 还共享 Token `5`，但它不足以形成完整可复用 Page；不完整尾页可服务当前请求，却不一定作为完整 Prefix Cache 单元供下一请求复用。

SGLang 的 `RadixKey.page_aligned(page_size)` 会把参与匹配和插入的长度裁剪到 Page 边界。因此，“SGLang 是 Token 粒度、vLLM 是 Block 粒度”不是无条件成立的结论：

> **SGLang 的前缀拓扑由 Radix Tree 表达；物理复用粒度受实际 `page_size` 约束。`page_size=1` 时可达到 Token 粒度，更大 Page 则按 Page 对齐。**

Page 越小，尾部浪费与匹配损失越少，但元数据、分配和 Kernel 管理成本可能增加；Page 越大，管理更规整，却更容易在分支处留下不可复用尾部。这是工程权衡，不是越小越好。

---

## 七、锁定：`lock_ref` 不是普通互斥锁

### 1. 它保护的是存活性

假设请求 D 已命中 `[1,2,3,4,5,6]`，并把对应 Slot 写入自己的 Page Table。就在 GPU 即将读取时，另一个请求触发显存淘汰。如果缓存管理器释放并复用了这些 Slot，D 将读到错误数据。

因此，命中节点及祖先必须在活动请求结束前受到保护。SGLang 使用类似引用计数的 `lock_ref`：

```text
lock_ref > 0  → 至少一个活动请求依赖该节点，不可淘汰
lock_ref == 0 → 没有活动请求持有，可进入淘汰候选集
```

它更接近生命周期 Pin/Reference Count，而不是用于线程互斥的 Mutex。

### 2. 为什么必须沿祖先路径加锁

请求命中叶侧节点 `[6,7,8]` 的一部分时，也依赖从根到该节点的全部前缀：

```text
[1,2,3,4] → [5] → [6]
```

只保护最后一个节点没有意义，因为 Attention 仍会读取祖先对应的 KV。因此增加引用会沿父指针直到根节点之前，释放时再沿同一路径递减：

```text
请求开始使用缓存
  [6,7,8].lock_ref += 1
  [5].lock_ref     += 1
  [1,2,3,4]        += 1

请求结束或不再依赖
  沿相同路径逐级 -= 1
```

节点引用从 `0 → 1` 时，其 Token/Page 数量应从 `evictable_size` 转入 `protected_size`；从 `1 → 0` 时再转回。若只是从 `1 → 2`，物理状态仍是“受保护”，无需重复调整容量统计。

### 3. 锁的完整生命周期

典型流程是：

1. 请求匹配已有前缀；
2. 命中路径增加引用；
3. 请求页表引用这些物理位置；
4. GPU 执行 Prefill 后缀和 Decode；
5. 新产生的可复用 KV 插入 Prefix Cache；
6. 请求完成、取消或离开运行批次；
7. 命中路径减少引用。

异常和抢占路径同样必须释放引用，否则会形成“逻辑显存泄漏”：数据本身仍在，但永远被标记为不可淘汰。

---

## 八、淘汰：为什么从未锁定叶节点开始

考虑下面的树：

```text
root
 └─ P = [1,2,3,4]
     ├─ Q = [5]
     │   ├─ R = [6,7,8]
     │   └─ S = [11]
     └─ T = [9,10]
```

若直接删除中间节点 P，却保留 R、S、T，这些后缀便失去完整前缀语义，也无法独立从根开始匹配。因此，基本 LRU 过程从**未锁定叶节点**开始：

1. 收集或维护可淘汰叶节点；
2. 按最近访问时间或策略优先级选候选；
3. 跳过 `lock_ref > 0` 的节点；
4. 释放该节点对应的物理 KV Slot/Page；
5. 从父节点删除该叶子；
6. 若父节点因此成为未锁定叶子，将父节点加入候选；
7. 重复直到回收目标容量。

这是一种后缀优先回收。公共主干只有在相关分支都不再保留后，才会逐步成为可删除叶子。

经典 RadixAttention 使用 LRU；当前 SGLang 也支持或正在统一 Priority、LFU、S-LRU、FIFO 等策略，以及混合 Full Attention、Sliding Window Attention、Mamba/SSM 状态的 Unified Radix Cache。无论策略如何变化，都必须满足两个硬约束：活动引用不能被淘汰；控制面删除与物理 Slot 回收必须一致。

删除 Python 节点只释放很少的 CPU 元数据。真正有价值的是把 `value` 指向的位置交还分配器：

```text
Radix node.value
      │
      ▼
[70, 71, ...] ── free ──> allocator free list
                              │
                              └─ 可分配给后续请求
```

假设 T 最旧，R 次之，S 最新，但 R 被活动请求锁定。若系统需要两个 Token 的空间，T 是未锁定叶节点且容量正好，于是回收 `[9,10]`；R 即使较旧，也因 `lock_ref > 0` 被跳过。

---

## 九、三层映射：树、Page Table 与 GPU KV 数据

这是整条链路最重要的心智模型。

### 第一层：Radix Cache 控制面

它回答：“某个可共享 Token 前缀，对应哪些物理 KV 索引？”

```text
[1,2,3,4] → [41,5,92,93]
[5]       → [17]
[6,7,8]   → [18,70,71]
[9,10]    → [33,34]
[11]      → [58]
```

这一层主要是 Prefix Cache 的树拓扑和 CPU 侧元数据，面向跨请求复用。

### 第二层：Request Page Table

它回答：“请求 r 的逻辑位置 i，应该读取哪个物理 KV Slot？”

| Request | 逻辑 Token | `ReqToTokenPool` 中的物理索引 |
|---|---|---|
| A | `[1,2,3,4,5,6,7,8]` | `[41,5,92,93,17,18,70,71]` |
| B | `[1,2,3,4,9,10]` | `[41,5,92,93,33,34]` |
| C | `[1,2,3,4,5,11]` | `[41,5,92,93,17,58]` |

A、B、C 的前四个逻辑位置指向同一组物理索引；A 与 C 的第五个位置也共享 Slot `17`。一条逻辑序列的物理位置可以完全不连续。这一层面向单个活动请求，把命中的旧 Slot 与新分配 Slot 拼成完整逻辑上下文。

### 第三层：GPU KV Pool 数据面

它回答：“物理 Slot p 在每一层、每个 KV Head 上的实际 K/V 数值是什么？”

```text
K[layer][slot][kv_head][head_dim]
V[layer][slot][kv_head][head_dim]
```

具体 Kernel 可能采用不同布局，但 Slot 始终是连接 Page Table 与真实 Tensor 的物理坐标。

### 三层如何在一次命中中联动

以 C 为例：

```text
输入 Tokens: [1,2,3,4,5,11]
       │
       ▼
Radix Cache 命中 [1,2,3,4,5]
       │ 返回 [41,5,92,93,17]
       ▼
ReqToTokenPool[C] = [41,5,92,93,17,58]
                                      ↑
                          为 Token 11 新分配 Slot 58
       │
       ▼
Attention Kernel 按页表读取 GPU KV Pool
       ├─ 旧前缀直接读 Slot 41,5,92,93,17
       └─ 新 Token 的 K/V 写入 Slot 58
```

**Radix Cache 决定可共享性，Page Table 决定当前请求如何观看这些数据，GPU Pool 保存真正的数值。**

Page Table 只属于一个已知请求。新请求到来时，不知道其他请求的哪些位置可以复用；Radix Tree 提供跨请求的内容寻址，匹配后再把结果物化到新请求的 Page Table。反过来，GPU Kernel 需要高效读取完整逻辑序列，不能每层注意力都重新遍历 CPU 树，因此又需要紧凑的请求映射表。

---

## 十、一次请求的完整生命周期

假设树中已有 A，新请求 C 到达：

1. **构造缓存身份**：Tokenizer 得到 `[1,2,3,4,5,11]`，Runtime 再组合模型、Adapter、Salt 等命名空间。
2. **最长前缀匹配**：树返回命中 `[1,2,3,4,5]`、物理索引 `[41,5,92,93,17]` 和最后命中节点。若 `page_size > 1`，长度还需按 Page 对齐。
3. **锁定命中路径**：从最后节点到根增加 `lock_ref`，相关容量从可淘汰统计转入受保护统计。
4. **分配未命中 KV**：Allocator 为 Token `11` 分配 Slot `58`。显存不足时先淘汰足够多的未锁定叶节点。
5. **组装 Page Table**：写入 `ReqToTokenPool[C] = [41,5,92,93,17,58]`。
6. **执行 GPU Forward**：Attention 读取前缀 Slot，只对未命中后缀做 Prefill，把新 K/V 写入 Slot `58`，然后进入 Decode。
7. **插入新增缓存**：新增可复用部分进入 Radix Tree；若其他请求已先插入相同段，则归并重复项并释放多余 Slot。
8. **释放活动引用**：请求完成、取消或离开批次时减少 `lock_ref`。节点继续留在缓存，只是重新变为可淘汰状态。

这里有一个关键区别：

```text
请求结束 ≠ KV 立即删除
请求结束 = 活动所有权结束，但缓存所有权可以继续存在
```

RadixAttention 的价值正来自请求结束后仍保留可复用 KV，直到容量压力要求淘汰。

---

## 十一、SGLang Radix Cache 与 vLLM Block KV Cache

先纠正一个常见说法：**vLLM 也支持跨请求 Prefix Caching。** vLLM 的 Automatic Prefix Caching（APC）把完整 KV Block 的内容和前序 Block Hash 组合成链式哈希，通过全局 Hash Table 找到相同前缀，并让请求共享物理 Block。

两者都具备分页或分块 KV 内存、非连续物理内存到连续逻辑序列的映射、跨请求前缀复用、活动引用计数，以及基于空闲队列或淘汰策略的显存回收。真正差异是“如何表达和利用前缀关系”。

| 维度 | SGLang Radix Cache | vLLM APC / Block KV Cache |
|---|---|---|
| 前缀索引 | 显式压缩 Radix Tree | 链式 Block Hash + 全局 Hash Table |
| 结构表达 | 直接保留公共主干与分支拓扑 | 完整 Block 由自身 Token、前序 Hash 和额外身份确定 |
| 匹配过程 | 沿树做最长前缀匹配 | 顺序查询 Block Hash，首个未命中后停止 |
| 复用粒度 | 受 `page_size` 约束；为 1 时可按 Token | 以完整 KV Block 为命中单位 |
| 活动保护 | 节点及祖先路径的 `lock_ref` | Block 引用计数大于 0 时不可重分配 |
| 淘汰组织 | 叶节点/组件级策略，天然感知树拓扑 | 引用为 0 的 Block 进入 Free Block Queue，按 LRU 语义重用 |
| 调度协同 | 可直接利用最长前缀和树局部性 | APC 核心偏向 Block 内容寻址，不依赖显式前缀树 |
| CPU 元数据 | 维护遍历、分裂、锁和策略状态 | Hash 查询与固定 Block 管理相对规整 |
| 典型优势 | 复杂分支、细粒度前缀、会话/Agent 轨迹 | 通用高吞吐服务、统一固定 Block 管理 |

### 1. vLLM 为什么使用链式 Block Hash

假设 Block Size 为 4，A 分成：

```text
Block 0 = [1,2,3,4]
Block 1 = [5,6,7,8]

H0 = hash(parent_hash, [1,2,3,4], extra_keys)
H1 = hash(H0,          [5,6,7,8], extra_keys)
```

把前一个 Block 的 Hash 纳入后一个 Hash，意味着 `[5,6,7,8]` 只有在完整历史也一致时才是同一个缓存块，避免把“内容相同但前序历史不同”的 KV 错误复用。新请求逐块查 Hash Table，连续命中的 Block 被复用，从首个未命中处开始计算。

一个请求结束后，Block 引用计数降为 0，可以进入 Free Block Queue，但只要尚未被重新分配，其 Hash 映射仍可能保留。后续请求若命中，可以把它从 Free Queue 中取回；只有真正分配给新内容时，旧缓存身份才失效。这与 SGLang“请求结束后保留 KV、容量不足时再淘汰”的目标一致，只是组织方式不同。

### 2. Radix Tree 的独特价值是拓扑显式化

对以下请求族：

```text
system prompt
  └─ shared tools and policies
      └─ conversation history
          ├─ tool call A → result A → next reasoning
          ├─ tool call B → result B → next reasoning
          └─ retry branch → corrected result
```

Radix Tree 直接知道哪些节点是公共祖先、哪些是兄弟分支、哪些叶子可先淘汰。Cache-aware Scheduler 也能优先安排共享长前缀的请求，使刚产生的 KV 更快被后续请求命中。

Hash Table 能识别每个 Block 是否存在，却不天然提供一棵可遍历的工作流前缀拓扑。它可以通过 Hash 链表达历史依赖，但没有把整棵树作为一等控制面对象。

### 3. 为什么不能断言 SGLang 永远更快

若请求几乎没有公共前缀，Radix Tree 的命中收益接近零，树遍历、节点管理和调度仍有 CPU 成本。高并发、短 Prompt、平坦且彼此无关的流量，可能更适合规整的固定 Block + Hash Table 管理。

即使存在公共前缀，最终性能还取决于请求是否路由到同一 Worker、Page/Block Size、批处理策略、GPU Kernel、缓存容量、CPU Scheduler，以及 PD 分离时的 KV 传输。

所以准确结论是：

> **SGLang 用显式前缀树把复用、调度和淘汰放进同一个拓扑模型；vLLM 用链式 Block Hash 把前缀复用融入规整的 Block Manager。前者更强调结构，后者更强调统一块管理。**

---

## 十二、为什么 Radix Cache 适合多轮对话、长上下文与 Agent Loop

### 1. 多轮对话：每一轮都在旧历史后追加

```text
Round 1: system + user_1
Round 2: system + user_1 + assistant_1 + user_2
Round 3: system + user_1 + assistant_1 + user_2 + assistant_2 + user_3
```

后续轮次的大部分输入是上一轮已经计算过的前缀。只要请求路由到持有缓存的 Worker，且旧路径未被淘汰，新一轮只需 Prefill 新追加消息。相同 System Prompt 还能形成更高层公共主干，各会话历史形成分支。Session-aware Radix Cache 可进一步保护活跃 Session 的路径，降低长会话被无关流量挤出的概率。

### 2. 长上下文：命中价值随前缀长度放大

8K Token 与 128K Token 的前缀即使都算一次“命中”，节省的计算也完全不同。长上下文中，复用能避免大段 Prefill，TTFT 收益更明显；但它也放大显存压力。因此应关注命中 Token 数，而不是仅看命中请求数，同时监控受保护 KV、淘汰后重算、Page 尾部损失和租户缓存预算。

### 3. Agent Loop：稳定主干加短分支

典型 Agent Loop 是：

```text
System Prompt
  + Tool Definitions
  + User Goal
  + Reasoning / Action
  + Tool Result
  + Reasoning / Action
  + Tool Result
  + ...
```

每次工具调用后再次推理时，前面大部分轨迹不变，只追加一小段 Tool Result。代码 Agent 还可能从同一仓库上下文尝试多个补丁、在测试失败后回到共同决策点，再产生新分支。

这种负载恰好具备 Radix Tree 偏好的形状：

- 长而稳定的主干：System Prompt、工具描述、仓库上下文；
- 逐步增长的轨迹：每轮只新增少量观察与动作；
- 频繁分叉：候选方案、重试、并行工具调用；
- 多个后续请求共享同一历史祖先。

SGLang 不只保存前缀，还能让调度器看到最长公共前缀，把缓存局部性纳入请求排序。“索引 + 调度 + 淘汰”的协同，是它对 Agentic Workload 更有吸引力的核心原因。

### 4. 优势是工作负载相关的

以下情况会显著削弱收益：

- 每个请求从第一个 Token 起就不同；
- Prompt 模板把随机 ID、时间戳放在很靠前的位置；
- 请求被负载均衡到不同 Worker，缓存局部性丢失；
- 模型、LoRA、Tokenizer 或 Cache Salt 不兼容；
- 分支很多但每个只访问一次，形成缓存污染；
- 显存太小，长前缀在下一轮前已被淘汰；
- Page 太大，分叉点经常落在 Page 中间。

部署 Agent 服务时，除了开启 Prefix Cache，还应同时设计 Session Affinity、Prefix-aware Routing、Prompt 稳定性、缓存配额与淘汰策略。

---

## 十三、生产排查：不要只看 Cache Hit Rate

一个“90% 命中率”可能是 90% 请求至少命中一个 Token，也可能是输入 Token 中 90% 来自缓存，二者性能意义完全不同。

| 指标 | 要回答的问题 |
|---|---|
| Cached Tokens / Input Tokens | 实际跳过了多少 Prefill Token？ |
| TTFT P50/P95/P99 | 前缀复用是否改善首 Token 延迟？ |
| Prefill Tokens/s | 节省的计算是否转化为吞吐？ |
| Evictable / Protected KV | 有多少可回收、多少被活动请求钉住？ |
| Evicted / Recomputed Tokens | 是否刚淘汰就重新计算？ |
| Page Tail Waste | Page 对齐损失是否显著？ |
| Worker-local Hit Rate | 路由是否破坏缓存局部性？ |
| Scheduler CPU Time | 树匹配与调度是否成为 CPU 瓶颈？ |

还要区分三个“命中”：

```text
逻辑命中：Token 前缀相同
索引命中：Prefix Cache 中仍有节点和有效物理索引
执行收益：GPU 确实跳过对应 Prefill，并改善目标 SLO
```

只有第三层才是最终业务价值。

---

## 十四、把整套机制压缩成一个心智模型

第一，**Radix Tree 存的是前缀拓扑与 KV 物理索引，不是另一份 KV Tensor。**

第二，**请求 Page Table 把逻辑 Token 位置拼接到共享旧 Slot 和新分配 Slot，GPU Pool 才保存真正的 K/V 数据。**

第三，**匹配负责复用，插入负责登记，`lock_ref` 负责存活性，叶节点淘汰负责把显存交还分配器。**

第四，**SGLang 与 vLLM 都能做跨请求前缀缓存；SGLang 的特点是把前缀分支显式建模为 Radix Tree，并让调度和淘汰理解这棵树。**

```text
Token Prefix
   → Prefix Match
   → Physical KV Indices
   → Request Page Table
   → GPU Attention
   → New KV Insert
   → Reference Release
   → Tree-aware Eviction
```

当工作负载呈现“稳定长主干 + 反复追加 + 频繁分支”的结构时，这套协议能够把 Prompt 的结构相似性真正转化为 GPU 计算与显存效率。这也是它在多轮对话、长上下文和 Agent Loop 中格外重要的原因。

---

## 参考资料

1. Ying Sheng et al., [SGLang: Efficient Execution of Structured Language Model Programs](https://openreview.net/attachment?id=VqkAKQibpq&name=pdf)。
2. SGLang Source, [Radix Cache Implementation](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/mem_cache/radix_cache.py)。
3. SGLang Source, [Memory Cache Architecture README](https://github.com/sgl-project/sglang/blob/main/python/sglang/srt/mem_cache/README.md)。
4. SGLang Blog, [Unified Radix Cache](https://www.sglang.io/blog/unified-radix-cache)。
5. SGLang Docs, [Session-aware Radix Cache](https://github.com/sgl-project/sglang/blob/main/docs/docs/advanced_features/session_radix_cache.mdx)。
6. SGLang Docs, [Radix Cache Eviction Policies](https://github.com/sgl-project/sglang/blob/main/docs/docs/advanced_features/radix_eviction_policy.mdx)。
7. vLLM Docs, [Automatic Prefix Caching Design](https://docs.vllm.ai/en/latest/design/prefix_caching/)。
8. vLLM Docs, [Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/)。
9. Woosuk Kwon et al., [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)。
10. vLLM Blog, [PagedAttention](https://vllm-project.github.io/2023/06/20/vllm.html)。
