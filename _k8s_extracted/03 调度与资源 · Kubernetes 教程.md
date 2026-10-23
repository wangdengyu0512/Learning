Chapter 03

# 调度与资源：Pod 如何落到 Node 上

上一章揭示了控制循环——scheduler 正是其中一个控制器，它的职责是给还没有 nodeName 的 Pod 选一个节点。这一章讲它怎么选，以及 requests/limits 这套资源模型背后的内核机制。

本章骨架

- scheduler 作为控制器：filter（过滤）+ score（打分）两阶段，本质仍是"观测—调谐"。
- requests vs limits：调度只看 requests，limits 对调度完全无影响。
- CPU 可压缩（被限流变慢）vs 内存不可压缩（被 OOMKill 杀掉）的内核机制。
- QoS 三档（Guaranteed / Burstable / BestEffort）如何决定驱逐顺序。
- affinity / taint / toleration 如何约束 Pod 的落点。

## 3.1scheduler 是个控制器

scheduler 监听 `spec.nodeName` 为空的 Pod，为其选一个节点，再把这个决定（binding）写回 api-server——它没有"启动容器"，只是填了一个字段。

为什么需要它

第 2 章把 Kubernetes 拆成一组 level-triggered 的控制循环：每个控制器观测某类对象的实际状态，与期望状态比对，再做一步调谐。scheduler 完全套进这个模型——它观测的"差异"是：**存在一个 Pod，它的 `spec.nodeName` 还是空的**（期望被调度，实际未被调度）。它的调谐动作只有一个：算出该去哪个节点，把节点名写进去。真正在节点上拉起容器的是 kubelet，那是另一个控制器的事。把"选节点"和"起容器"拆成两个控制器，是 Kubernetes 解耦设计的典型一刀。

### 底层机制（比文档深一层）

很多人把 scheduler 想象成一个"分配器"，仿佛它直接命令某台机器去运行 Pod。实际上它**从不与节点通信**。它的整个工作闭环都发生在 api-server 这一侧：

- **观测**：通过 watch 机制订阅 Pod 对象，筛出 `spec.nodeName == ""` 且尚未被处理的那些（处于 Pending）。
- **决策**：在内存里对所有节点跑两阶段算法（下一节展开），选出一个节点。
- **调谐**：创建一个 `Binding` 子资源 POST 回 api-server，效果等同于把 `pod.spec.nodeName` 设为选中的节点名。

写回那一刻，scheduler 的工作就结束了。后续交给目标节点上的 kubelet——它也在 watch，发现"有一个 `nodeName` 等于自己的 Pod 出现了"，于是开始拉镜像、起容器。**scheduler 和 kubelet 之间没有直接调用，只有共享的 api-server 状态作为媒介**。这正是第 2 章那条主线的再次落地：所有组件都对着同一份声明状态做调谐，彼此不耦合。

类比 · 带边界声明

scheduler 像餐厅的**领位员**：它只负责看哪张桌子空着、把客人领过去并在座位表上记一笔，并不下厨、也不上菜。上菜（起容器）是那张桌子对应的服务员（kubelet）的事。**边界**：领位员领错了位还能改，scheduler 一旦写入 `nodeName` 就**不会再改**——Pod 与节点的绑定是终身的，节点出问题只能删掉 Pod 让控制器新建一个再重新调度（这条性质是第 5 章讨论 StatefulSet 稳定身份的前提）。

想一想

如果 scheduler 进程整个挂掉一小时，集群里已经在运行的 Pod 会受影响吗？这一小时里新创建的 Deployment 会怎样？

展开答案（先停 10 秒再点）

已运行的 Pod **毫不受影响**——它们的 `nodeName` 早已写好，kubelet 仍在各自节点上维持它们，scheduler 不在闭环里。

这一小时里新建的 Pod 会一直停在 **Pending**：它们的 `nodeName` 是空的，没有控制器来填这个字段。scheduler 恢复后，因为是 level-triggered，它 watch 到这批积压的 Pending Pod，挨个调度即可——不需要任何人"重放"这一小时发生的事。这就是声明式 + level-triggered 的容错红利。

**与下一节的关系**：已经知道 scheduler 的动作是"选一个节点写回去"。那它**怎么选**？这就是两阶段算法——先排除不可行的，再给可行的打分。

## 3.2两阶段：Filter 过滤，Score 打分

调度分两步：Filter 先把"放不下/不满足约束"的节点全部排除，得到一批可行节点；Score 再给每个可行节点打分，选分最高的，平手则随机。

为什么需要它

"选节点"其实是两个性质不同的问题混在一起：一是**硬约束**——这个节点到底装不装得下、允不允许（资源、标签、污点）；二是**软偏好**——在所有装得下的节点里，哪个更划算（分散负载、亲和性、资源碎片最小）。把它们揉进一个评分函数会很难表达"绝对不行"。所以 Kubernetes 拆成两阶段：Filter 处理"行不行"（布尔判定），Score 处理"哪个更好"（打分排序）。这是一个经典的 *predicate 然后 priority* 结构。

### 底层机制（比文档深一层）

**Filter 阶段**（历史上叫 predicates）逐个节点判定一组布尔条件，任何一条不满足，该节点立即出局。常见的过滤器：

- `PodFitsResources`：节点的可分配资源减去其上已有 Pod 的 **requests 之和**，还够不够装下新 Pod 的 requests。这是本章最关键的一条——下一节专讲。
- `nodeSelector` / node affinity：节点的标签是否匹配 Pod 指定的标签要求。
- taint 检查：节点上的污点是否被 Pod 的 toleration 容忍（§3.6 展开）。
- volume 相关：Pod 要挂的卷能否在该节点访问（如某些卷有可用区限制）。

Filter 跑完，得到一批"可行节点"。如果**这批是空的，Pod 就停在 Pending**，并在事件里写 `FailedScheduling`——这是排查 Pending 的第一现场。

**Score 阶段**（历史上叫 priorities）只在可行节点里进行：每个打分插件给每个节点打 0–100 分，加权求和，scheduler 选总分最高的那个。若多个节点同分，则在它们之间**随机**挑一个（避免总往同一台堆）。常见打分维度：让 Pod 尽量分散到资源更空闲的节点、满足 pod affinity 偏好、镜像已在节点上缓存等。

全部节点
node-1
node-2 … node-N
（含放不下的）


Filter
布尔·能否放下



可行节点（少）
node-2
node-5



Score 打分



选中 node-5



图 3.1调度漏斗：全部节点先被 Filter 收窄成"可行节点"，再由 Score 选出一个。
**注意**：Filter 判断"装不装得下"用的是节点上各 Pod 的 **requests 之和**——不是 limits、也不是当前实际用量。

**与下一节的关系**：图 3.1 反复强调 Filter 看的是 requests。但 requests 到底是什么、它和 limits 差在哪、为什么调度只认它一个？下一节是本章的核心。

## 3.3requests vs limits：调度只看 requests

requests 是"承诺给你的最小量"——调度与驱逐都按它算；limits 是"运行时上限"——只在节点上由内核约束。**调度器对 limits 完全视而不见。**

为什么需要它

一个 Pod 既要表达"至少需要这么多才能正常跑"（用于调度时占位、保证不被随意挤掉），又要表达"最多能用到这么多"（用于防止它失控吃光整台机器）。这是两个目的，所以是两个字段。`requests` 服务于**调度与资源保证**，`limits` 服务于**运行时隔离**。把它们当成同一个数来设，是后面所有资源类故障的根源。

### 底层机制（比文档深一层）

这里有一个**极其反直觉、却必须记牢**的事实：

核心 · 反直觉点

调度器**只对节点上所有 Pod 的 requests 求和**，来判断新 Pod 装不装得下。**limits 对调度的判定毫无影响**，节点实际用了多少也不看。一个节点可以被"超卖"——所有 Pod 的 limits 之和远超节点容量，只要 requests 之和不超，调度器照样往上塞。

把两个字段的职责并排看：

requests 与 limits 的职责分工

| 维度 | requests（请求量） | limits（上限） |
| --- | --- | --- |
| 影响调度吗 | 是——Filter 按 requests 之和判断能否放下 | 否——调度器完全不看 |
| 语义 | 承诺保证给你的最小量 | 允许你用到的最大量 |
| 影响什么 | 调度落点、QoS 判定、驱逐顺序 | 节点上的内核约束（cgroup） |
| 不设会怎样 | 调度器按 0 占位，极易被塞进超卖节点 | 无上限，可吃满节点资源直到触发节点级保护 |

pod-resources.yaml
yaml
复制

```
resources:
  requests:        # 调度按这个占位；保证最小量
    cpu: "250m"    # 0.25 核
    memory: "256Mi"
  limits:          # 运行时上限；只在节点上由内核约束
    cpu: "500m"    # 最多 0.5 核（超了被限流）
    memory: "512Mi" # 最多 512Mi（超了被 OOMKill）
```

上面这个 Pod 在调度时只占 `250m` CPU、`256Mi` 内存的"坑位"；至于 `limits` 里的 `500m` / `512Mi`，调度器看都不看，它们要到 Pod 落地后才由内核登场——而 CPU 和内存这两个 limit 在内核里的下场**截然不同**，这是下一节的主题。

想一想

一个节点可分配 4 核。上面已有 10 个 Pod，每个 `requests.cpu=300m`、`limits.cpu=1`。requests 之和 = 3 核，limits 之和 = 10 核。现在再来一个 `requests.cpu=500m` 的 Pod，调度器会放它进来吗？

展开答案（先停 10 秒再点）

会。调度器只看 requests 之和：已有 3 核 + 新的 0.5 核 = 3.5 核，没超过 4 核可分配量，`PodFitsResources` 通过。limits 之和 10 核（远超 4 核）**对这个判定毫无影响**。

代价是这台节点被严重超卖——如果某一刻多个 Pod 同时逼近各自的 limit，CPU 会被瓜分到人人变慢，内存若同时冲高则会触发 OOMKill。"调度通过"不等于"运行无虞"，这正是 requests 与 limits 分离带来的张力。

## 3.4可压缩 vs 不可压缩：CPU 变慢，内存被杀

Pod 落到节点后，requests/limits 被翻译成 Linux cgroup 参数。CPU 是**可压缩**资源——超限只是被限流变慢；内存是**不可压缩**资源——超限直接被内核 OOMKill。

为什么需要它

"超过 limit 会怎样"这个问题没有统一答案，取决于资源能不能被**压缩**。CPU 时间可以被剥夺——这一刻不给你、下一刻再给，进程只是慢一点，不会因此损坏。内存不行——你已经写进去的数据无法被"暂时收回"，内核要么给你、要么在压力下杀掉某个进程腾出空间。这条物理差异决定了两种 limit 完全不同的失败模式，也决定了你该怎么设它们。

### 底层机制（比文档深一层）

kubelet 把资源字段写进容器的 cgroup。四条映射，逐条看下场：

- **CPU request → `cpu.shares`**：这是一个*相对权重*，不是硬上限。节点 CPU 紧张时，各容器按 shares 比例分配时间片；CPU 空闲时，容器可以用超过自己 request 的量。所以 CPU request 决定的是"抢不过来时你能保底拿到的比例"。
- **CPU limit → CFS `cfs_quota_us` / `cfs_period_us`**：这是*硬性限流*。内核按 period（默认 100ms）为周期，每周期最多让容器跑 quota 微秒。一旦用完配额，容器在本周期内**被节流（throttled）暂停**，进程**不会被杀，只是变慢**。
- **内存 request**：只参与调度占位与 QoS 判定，内核层面不强约束（不会因为低于 request 就保护你不被回收页缓存）。
- **内存 limit → cgroup `memory.limit_in_bytes`**：硬墙。容器内存用量触到这个值时，内核的 OOM killer 介入，**直接杀掉容器内进程（退出码 137 = 128 + SIGKILL 的 9）**，kubelet 随后将该容器状态标记为 `OOMKilled` 并按重启策略重启。

最该记住的一句

**CPU 超限只是变慢，内存超限会被杀。**更隐蔽的是：CPU 节流**没有 Kubernetes 事件、也没有容器日志**——容器活得好好的，只是莫名其妙变慢、p99 延迟飙升，指标得专门去看 cgroup 的 `throttled` 计数才能发现。而 OOMKill 是显式的：退出码 137、状态 `OOMKilled`、有重启记录，一眼可见。

CPU · 可压缩



limit







被节流·变慢
进程存活，无事件 / 无日志



内存 · 不可压缩


limit





✕ OOMKill
退出码 137

进程被杀，状态 OOMKilled，重启


同样是"超过 limit"
CPU：只是慢
内存：会死

所以内存 limit
要设成峰值，留足余量


图 3.2同样是"超过 limit"，CPU 被节流（变慢、进程存活），内存被 OOMKill（退出码 137、进程死）。
**注意**：CPU 节流无事件、无日志，延迟问题极难定位；这条差异直接决定了你该怎么设两种 limit——内存 limit 必须按峰值设、留余量。

想一想

一个服务平时只用 200Mi 内存，但每天凌晨批处理时会瞬间冲到 900Mi。有人为了"省资源"把 `limits.memory` 设成 512Mi。会发生什么？换成 CPU 的同类设置（平时 0.2 核、批处理冲到 1 核，limit 设 0.5 核）又会怎样？

展开答案（先停 10 秒再点）

内存版：每天凌晨内存冲过 512Mi 的瞬间，容器被 **OOMKill（退出码 137）**，批处理中断、容器重启，往往反复 CrashLoop。内存不可压缩，"省"出来的额度直接换成了进程死亡。正解是把内存 limit 设成观测到的**峰值**（900Mi 以上）。

CPU 版：批处理时 CPU 需求超过 0.5 核的部分被 **CFS 节流**，进程不死，只是批处理跑得慢（本该 10 分钟被拖到 30 分钟）。没有崩溃、没有事件，只有"为什么今天特别慢"的困惑。同样是上限设低了，CPU 的代价是延迟，内存的代价是死亡。

**与下一节的关系**：requests 和 limits 的相对关系（相等？只设 request？都不设？）不只影响内核约束，还把 Pod 分成三个**服务质量等级**，决定节点内存吃紧时**谁先被赶走**。这就是 QoS。

## 3.5QoS 三档：谁先被驱逐

Kubernetes 按 requests/limits 的设置把 Pod 自动归入 Guaranteed / Burstable / BestEffort 三档；节点资源吃紧需要驱逐 Pod 时，从最低档（BestEffort）开始赶。

为什么需要它

节点内存逼近耗尽时（节点级压力，区别于单容器超 limit 的 OOMKill），kubelet 必须主动驱逐一些 Pod 来自救，否则整台机器会被内核 OOM 拖垮。"先赶谁"不能随机——应该先牺牲那些"没做出资源承诺"的 Pod，保住那些"明确声明了需求、不超量"的关键 Pod。QoS 等级就是 kubelet 用来排这个优先级的依据，它不是你手动设的字段，而是**从 requests/limits 推导**出来的。

### 底层机制（比文档深一层）

三档的判定规则很机械——逐个容器看 requests 和 limits 的关系：

QoS 三档：判定条件与驱逐优先级

| QoS 等级 | 判定条件 | 驱逐 / OOM 顺序 | oom\_score\_adj |
| --- | --- | --- | --- |
| Guaranteed | 每个容器都设了 requests 和 limits，且对 CPU、内存均 **request == limit** | 最后被驱逐（最受保护） | 最低（-998） |
| Burstable | 至少一个容器设了 requests 或 limits，但不满足 Guaranteed 的全相等条件 | 居中 | 按用量动态计算（2–999） |
| BestEffort | 所有容器都**没设**任何 requests 和 limits | 最先被驱逐（最不受保护） | 最高（1000） |

两点要拎清：其一，QoS 是**整个 Pod 级别**的，但判定要看 Pod 里**每个容器**——只要有一个容器不满足"request==limit"，整个 Pod 就掉出 Guaranteed。其二，QoS 同时映射到内核的 `oom_score_adj`：当节点真的触发内核级 OOM 时，分值越高的越优先被内核选中杀掉，方向和 kubelet 的主动驱逐一致——BestEffort 永远是第一个倒霉的。

BestEffort

Burstable

Guaranteed

先驱逐

最后驱逐

都没设
设了但不全相等
req==limit


图 3.3QoS 驱逐顺序：BestEffort 最先被赶，Burstable 居中，Guaranteed 最后。
**注意**：想让关键服务最不易被驱逐，就让它的每个容器都 **request == limit**，成为 Guaranteed——这是把"重要性"翻译成调度语言的唯一方式。

想一想

一个 Pod 有两个容器：主容器设了 `request==limit`，sidecar 只设了 requests 没设 limits。这个 Pod 是什么 QoS？要让它升到 Guaranteed 该怎么改？

展开答案（先停 10 秒再点）

是 **Burstable**。QoS 是 Pod 级判定，但要求**每个**容器都满足 request==limit 才算 Guaranteed；sidecar 没设 limits，于是整个 Pod 掉到 Burstable。

要升到 Guaranteed，必须给 sidecar 也补上 CPU、内存的 limits，并让它们等于各自的 requests。一个常被忽视的容器配置，能把整个 Pod 的"受保护级别"拉低——这也是审查关键服务 YAML 时要逐容器看、而不是只看主容器的原因。

## 3.6约束落点：nodeSelector / affinity / taint

资源够只是"能放下"，约束机制再叠加"该不该放这里"：nodeSelector 是硬标签匹配，affinity 表达亲和/反亲和偏好，taint + toleration 让节点主动"排斥"除非 Pod 明确"容忍"。

为什么需要它

仅按资源调度会忽略很多真实诉求：GPU 任务必须落到带 GPU 的节点；同一服务的多个副本最好分散到不同节点以抗单点故障；某些节点是给特定团队预留的、不希望普通 Pod 乱入。这些"位置约束"无法用 CPU/内存表达，需要一套正交于资源的机制。它们都在 Filter 阶段生效——不满足就直接把节点过滤掉。

### 底层机制（比文档深一层）

- **nodeSelector**：最简单的硬约束。Pod 写 `nodeSelector: {disktype: ssd}`，调度器在 Filter 阶段只保留带 `disktype=ssd` 标签的节点。不匹配则该节点出局，没有"偏好"余地——要么匹配，要么排除。
- **node affinity**：nodeSelector 的增强版，支持*硬性*（`requiredDuringScheduling`，不满足就过滤掉，等价于强约束）和*软性*（`preferredDuringScheduling`，不满足只是 Score 阶段扣分，仍可调度）两种强度，还支持 `In/NotIn/Exists` 等更丰富的匹配。
- **pod affinity / anti-affinity**：约束对象不是节点标签，而是*其他 Pod 的位置*。affinity 表达"想和某类 Pod 待在一起"（如缓存与应用同节点降延迟）；anti-affinity 表达"想躲开某类 Pod"（如同一 Deployment 的副本互相排斥，强制分散到不同节点/可用区）。
- **taint + toleration**：方向反过来——前几种是 Pod 挑节点，taint 是**节点排斥 Pod**。给节点打污点 `kubectl taint nodes node1 key=value:NoSchedule` 后，**默认所有 Pod 都不会被调度到它上面**，除非 Pod 显式声明了能"容忍"这个污点的 toleration。常用于专用节点（GPU 节点只接受声明了 GPU toleration 的 Pod）和节点维护（打 `NoExecute` 污点会驱逐不容忍的现有 Pod）。

类比 · 带边界声明

把节点想成餐厅的桌子：**nodeSelector / affinity** 是*客人的偏好*——"要靠窗的桌子""想和朋友坐一起""别被安排在吵闹区"。**taint** 是*桌子自己挂的牌子*——"VIP 专座，闲人免进"，只有手持对应邀请函（toleration）的客人才能落座。**边界**：toleration 只是"允许坐"，不是"一定坐这"——一个 Pod 容忍某污点，不代表它会被优先调度到该节点；要真正吸引它过去，还得配合 node affinity。容忍 ≠ 偏好，这是最常见的混淆。

## 3.7三个高频失败模式

本章的机制对应三类反复出现的线上故障，逐一点明"误解 → 正解"。

陷阱一 · 内存 limit 设太低

**现象**：容器反复 `OOMKilled`、退出码 137、陷入 CrashLoopBackOff。  
**误解**："limit 就是预计平时会用的量"。  
**正解**：内存**不可压缩**，碰到 limit 就被杀，没有缓冲。内存 limit 要按观测到的**峰值**设、再留余量，而不是按平均用量设。

陷阱二 · requests 设错

**现象**：设太低 → Pod 被调度到已超卖的节点，节点压力一来就被优先驱逐；设太高 → 节点装不下、Pod 长期 Pending，同时浪费保留的资源。  
**误解**："调度器看的是 limits，或者看实际用量"。  
**正解**：调度器**只看 requests 之和**。requests 要贴近"稳态实际需求"——它既是调度占位的依据，也是 QoS 与驱逐顺序的依据。

陷阱三 · CPU 节流无声

**现象**：服务延迟莫名升高、p99 抖动，但**没有任何报错、没有事件、没有重启**，日志一片正常。  
**误解**："没有错误日志就说明资源没问题"。  
**正解**：CPU limit 触发的 CFS 节流是静默的——它只让进程变慢，不产生 Kubernetes 事件或容器日志。要发现它，必须去看 cgroup 的 `cpu.stat` 里的 `throttled` 计数（或监控系统里的 CPU throttling 指标）。

动手画一画

不看上文，在纸上画出图 3.2 的对比：横轴是时间、纵轴是用量，画出 CPU 和内存各自"撞到 limit"那一刻之后的曲线走向。CPU 那条线撞线后是什么形状？内存那条呢？画完翻回去对照——你有没有把内存那条画成"撞线后被截断"（其实是进程直接消失）？

## 自测

1. scheduler 选好节点后，做的**唯一一个写动作**是什么？是它去节点上启动容器吗？
2. 一个节点 CPU 可分配 8 核，上面 Pod 的 `requests.cpu` 之和是 7 核、`limits.cpu` 之和是 20 核。一个 `requests.cpu=2` 的新 Pod 能被调度上来吗？为什么？
3. 容器超过 CPU limit 和超过内存 limit，下场分别是什么？哪一个会在 `kubectl describe` 里留下明显痕迹，哪一个不会？
4. **（设计层）**为什么要把一个关键服务设成 Guaranteed（每个容器 request==limit）？这对它在节点压力下的命运意味着什么？

展开参考答案

**1.** 唯一写动作是创建一个 `Binding`、把 `pod.spec.nodeName` 设为选中节点——纯粹是改 api-server 里的一个字段。它**不**启动容器，启动是目标节点 kubelet watch 到这个 nodeName 后自己做的。

**2.** 能。调度只看 requests 之和：7 + 2 = 9 核 > 8 核可分配量——等一下，这其实**超了**，`PodFitsResources` 不通过，Pod 会 Pending。（陷阱：limits 之和 20 核是干扰项，永远不参与判定；真正的红线是 requests 之和不得超过节点可分配量。）

**3.** 超 CPU limit → 被 CFS 节流、进程存活、变慢，**无事件无日志**，`describe` 里看不到。超内存 limit → 被 OOMKill、退出码 137、状态 `OOMKilled`、有重启计数，`describe` 里清晰可见。

**4.** 设成 Guaranteed 让它在 QoS 排序里处于**最后被驱逐、oom\_score\_adj 最低**的位置。节点内存吃紧时，kubelet 先赶 BestEffort、再赶 Burstable，Guaranteed 的关键服务最受保护。代价是 request==limit 意味着按上限预留资源、无法超卖，资源利用率较低——这是"稳定性优先"换来的确定性。

进阶挑战

### 一个 Pod 一直 Pending，沿着 Filter 阶段列出至少 3 个让所有节点都被过滤掉的原因

Pending 意味着 Filter 阶段没有产出任何可行节点。顺着 §3.2 的过滤器清单，给出至少三类成因，并说明各自该用什么命令去印证。

展开提示

- **requests 之和超节点可分配量**：所有节点的剩余可分配资源都装不下这个 Pod 的 requests（`kubectl describe pod` 会显示 `Insufficient cpu/memory`）。
- **nodeSelector / node affinity 无匹配**：Pod 要求的节点标签在集群里不存在（如要求 `gpu=true` 但没有 GPU 节点打了这个标签）。
- **未容忍的 taint**：所有节点都带了 `NoSchedule` 污点，而 Pod 没有对应的 toleration。
- **没有满足 pod affinity 的节点**：Pod 要求和某类 Pod 同处（或反亲和要求分散），但拓扑上无节点能同时满足。
- **PVC 未绑定 / 卷拓扑受限**：Pod 要挂的 PVC 还没绑定到 PV，或卷被限制在某可用区而该区无可行节点（这条牵出第 5 章存储）。

统一的第一步排查命令：`kubectl describe pod <name>` 看 `Events` 里的 `FailedScheduling` 消息，它会直接告诉你是哪一类过滤器把节点全刷掉了。

### 参考资料

- [Kubernetes 官方 · Scheduling, Preemption and Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/)
- [Kubernetes 官方 · Managing Resources for Containers（requests / limits）](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [k8s.guide · 调度只看 requests、不看 limits](https://www.k8s.guide/insights/opinion/2026-03-10-kubernetes-scheduling-requests-not-limits/)
- [groundcover · Kubernetes CPU Throttling 机制详解](https://www.groundcover.com/blog/kubernetes-cpu-throttling)

[← 上一章
02 · 控制循环](https://zhiwenliang.github.io/learning/kubernetes/02-control-loop.html)
[下一章 →
04 · 网络模型](https://zhiwenliang.github.io/learning/kubernetes/04-networking.html)