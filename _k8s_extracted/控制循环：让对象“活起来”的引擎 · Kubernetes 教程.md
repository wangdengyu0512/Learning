Chapter 02

# 控制循环：让对象“活起来”的引擎

上一章把 K8s 的对象词汇表建立起来——每个对象都是 spec（期望）+ status（实际）。这一章解释这些静态记录如何被持续驱动：控制循环。

本章你将建立的 schema

- 声明式 vs 命令式：你交的是期望状态，不是操作步骤
- level-triggered（电平触发）为什么比 edge-triggered（边沿触发）更抗故障
- reconcile 循环：observe → diff → act 的三步
- 控制平面五大组件如何协作
- 一条 kubectl apply 从命令到 Pod 运行的完整路径

第 1 章末尾埋了一个问题：把一份 `replicas: 3` 的 Deployment 写进集群，没有任何人继续操作，Pod 却被创建、被维持、删掉一个还会自动补回。这份静态的 spec 凭什么会“动”？答案是一组永不停止的**控制循环**。本章的全部内容可以压成一句话：**Kubernetes 是一组 level-triggered 控制循环——你声明 spec（期望），控制器持续观测 status（实际）并把实际推向期望。**自愈、被改回去的 `kubectl edit`、改了配置却不生效，这些现象一旦看见循环，就都不再是“魔法”。

## 2.1声明式 vs 命令式：交期望，不交步骤

命令式是“跑 X、再跑 Y、再启动 Z”；声明式是存一份期望 spec，让系统自己想办法达到。

为什么需要它

命令式脚本把“当前状态”这个隐含前提钉死在每一行里：第 3 行假定第 2 行成功了。脚本在中途崩溃，集群就停在一个谁也说不清的中间态——已经建了一半的资源、改了一半的配置。要恢复，得先搞清楚“现在到哪了”，而这恰恰是最难的事。声明式把这个难题反过来：不描述路径，只描述目的地。

命令式的世界里，你对系统说的是**动词序列**：创建这个、更新那个、删除另一个。每条指令都依赖前一条的结果，整个序列没有幂等性——重跑一遍要么报“已存在”而失败，要么重复创建。一旦执行到第 k 步崩溃，系统落在第 1…k 步之间某个无法命名的状态，没有任何记录告诉你“目标本来是什么”。

声明式的世界里，你提交的是**一个名词**：期望的最终状态长什么样。`kubectl apply -f deploy.yaml` 不执行任何动作，它只做一件事——把这份 spec 作为“意图”记录下来。达成意图是系统自己的事，而且系统可以反复尝试：这一轮没达到，下一轮接着推，因为目标始终明确地写在那里。

imperative-vs-declarative.sh
shell
复制

```
# 命令式：一串动词，崩在第 2 行就停在未知状态
docker run -d --name web-1 nginx
docker run -d --name web-2 nginx
docker run -d --name web-3 nginx   # 若这行失败：现在是 2 个还是 3 个？无人知晓

# 声明式：一个名词（期望），系统自己想办法达到并维持
kubectl apply -f deploy.yaml        # spec: replicas: 3 —— 只记录意图，不执行步骤
```

底层机制 · 比文档深一层

`apply` 的“意图”不是一句空话，它被结构化地存了下来。api-server 会把你提交的字段记进对象的 `metadata.annotations`（`kubectl.kubernetes.io/last-applied-configuration`），下次 `apply` 时做三方合并（上次意图、本次意图、集群现状），算出该改哪些字段。**所以 spec 不是一次性命令，而是一份会被反复读取的、关于“你想要什么”的持久声明。**这正是下一节循环能持续工作的前提——目标永远在线可读。

## 2.2level-triggered vs edge-triggered：抗故障的支点

edge-triggered 对“事件”做反应；level-triggered 对“当前完整状态”做反应。后者是 Kubernetes 全部容错能力的支点。

为什么需要它

分布式系统里，组件崩溃、消息丢失、网络抖动不是异常而是常态。如果系统的正确性依赖“每个事件都被恰好处理一次”，那么任何一次丢事件都会让实际状态与期望状态永久发散，且无法自行修复。Borg 与 Omega 的教训凝结成一条设计原则：系统必须是对“部分失败”的反应式设计——这就是选 level 而非 edge 的根本原因。

**edge-triggered（边沿触发）**：系统监听“变化事件”——“副本数从 3 改成了 5”——并对这个 delta 做出动作（多起 2 个）。它处理的是*增量*。问题在于：如果接收方在事件到达时正好崩溃，或者事件在传输中丢失，那么这次“+2”就**永久丢失**了。没有人会再提起它，因为它只是一个转瞬即逝的边沿。系统从此停在 3 个副本，而期望是 5 个，且永远不会自己纠正。

**level-triggered（电平触发）**：系统不关心“发生了什么变化”，每次被唤醒时都**重新读取完整的实际状态**（现在有几个副本）并与期望状态（应该有几个）做完整比对，差多少补多少。它处理的是*当前的绝对值*，不是增量。无论它是被一个 watch 事件唤醒、被定时器唤醒、还是刚从崩溃中重启——动作都一样：读全量、比对、收敛。因此丢事件、组件重启、抖动，都只意味着“这一轮没动作或晚一轮动作”，下一轮照样自愈。

edge-triggered vs level-triggered

|  | edge-triggered（边沿） | level-triggered（电平） |
| --- | --- | --- |
| 处理对象 | 变化事件 / 增量（delta） | 当前完整状态 / 绝对值 |
| 丢失一个事件 | 那次变更永久丢失，状态发散且不自愈 | 无所谓——下一轮重读全量，照样收敛 |
| 崩溃后重启 | 错过期间的所有事件全部丢失 | 重启后重读一次全量即追平，毫无影响 |
| 代价 | 实现简单、动作少 | 每轮都要重读并比对全量状态，开销更大 |

EDGE

实际 = 3
期望 = 5

+2 事件丢失

实际 = 3
期望 = 5
永久停在 3 · 不自愈

LEVEL

实际 = 3
期望 = 5

重读全量

实际 = 5
期望 = 5
每轮收敛 · 抗丢失



图 2.1同样丢掉一次“+2”，两种模型的命运。**注意**：edge 把丢失的增量当成永久损失；level 根本不看“增量”，它每轮重读“实际 3、期望 5”，于是不管谁来唤醒它都会补到 5。容错不是额外加的重试逻辑，而是“只看绝对值”这个选择的免费副产品。

想一想

一个 level-triggered 控制器在监听 api-server 时漏掉了一个“某 Pod 被删除”的 watch 事件。这个删除会被永久忽略吗？

展开答案（先停 10 秒）

不会。控制器下一轮 reconcile 时重读全量：它列出该 Deployment 当前实际拥有的 Pod，发现数量比期望少一个，于是新建一个补齐。漏掉的那个事件从未被“处理”，但结果完全正确——因为控制器从不依赖事件本身，只依赖它重读到的绝对状态。watch 事件在这里只是一个“该醒醒了”的提醒，丢了顶多晚一轮，正确性不受影响。

## 2.3reconcile 循环：observe → diff → act

每个控制器都在跑同一个三步循环：观测实际、与期望比对、改变世界——然后回到观测，永不停止。

为什么需要它

上一节确立了“只看绝对值”的原则，这一节是它的具体形态。把 level-triggered 落成代码，就是一个三步闭环。理解这三步，才能解释为什么控制器“看起来什么都没做”却在持续工作，以及为什么它**常常永远到不了稳态——而这是正常的**。

**observe（观测）**：读取当前实际状态。注意控制器**不直接打 etcd，也不每轮都去问 api-server**——那样会把控制平面压垮。它通过 **informer** 读一份**本地缓存**。informer 的工作方式是 **list-then-watch**：启动时先 `list` 一次拉全量建立缓存，之后用 `watch` 持续接收增量更新维护这份缓存；每个对象带 `resourceVersion`，informer 据此去重、保证不漏不重地推进缓存版本。于是“读实际状态”几乎是本地内存操作。

**diff（比对）**：把 spec（期望）与 status（实际）做比对，算出差异。差异的形态各异——“少 2 个 Pod”“某个字段不一致”“多了一个该删的对象”。

**act（行动）**：针对差异，通过 **api-server** 改变世界——创建、更新或删除对象。注意控制器自己**不直接动 etcd**，它把意图写给 api-server，由 api-server 落库。动作完成后，循环立刻回到 observe。

observe 观测
informer 本地缓存

diff 比对
spec vs status

act 行动
经 api-server 改世界





永不停止
不是“收到事件才动”


图 2.2reconcile 循环的三步闭环。**注意**：它不是“收到事件 → 处理事件”的单次响应，而是不断重新比对期望与实际——这就是 level-triggered 在代码层面的样子。循环常常永远到不了稳态（spec 一直在变、外部一直在扰动），那不是 bug，是它的常态。

底层机制 · informer 为什么存在

假如每个控制器每轮都直接 `list` 一次 etcd，几十个控制器 × 高频循环会把 etcd 打爆。informer 把“读”这一侧彻底本地化：全集群对某类对象的 watch 由共享 informer 复用一条连接，缓存在内存里，控制器读缓存而非读后端。`resourceVersion` 是这套机制的游标——watch 中断后可以从上次的版本号续上，不必重新拉全量。**“读很便宜”是 reconcile 能跑得这么频繁的物理基础。**

## 2.4控制平面架构：谁碰 etcd，谁只 watch

etcd 是唯一事实来源；api-server 是唯一直接读写 etcd 的组件；其余所有组件都只 watch api-server。

为什么需要它

前三节讲的是“一个”控制器怎么工作。真实集群里有几十个控制器、一个调度器、每个节点一个 kubelet 同时在跑。要让它们协同而不互相踩踏，靠的不是一个中央指挥官，而是一条铁律：所有状态都经由 api-server 进出 etcd，组件之间不直接 RPC 编排。理解这条边界，是看懂下一节那条完整路径的前提。

控制平面五大组件，各司其职：

- **etcd**——唯一事实来源。一个强一致的分布式 KV 存储，集群里所有对象的 spec 与 status 最终都落在这里。它只管存，不懂业务。
- **api-server**——**唯一直接读写 etcd 的组件**。所有其他组件、所有 `kubectl`，都只能通过它间接访问状态。它对外是一套 REST API，对内是 etcd 的唯一守门人。一次写请求要穿过它的处理链：**认证（你是谁）→ 鉴权（你能不能做）→ mutating admission（按策略改写对象，如注入 sidecar）→ schema 校验（字段合不合法）→ validating admission（按策略放行或拒绝）→ 持久化到 etcd**。
- **controller-manager**——把几十个 reconcile 循环（Deployment 控制器、ReplicaSet 控制器、Node 控制器……）打包跑在一个进程里，每个都 watch api-server。
- **scheduler**——一个特殊的控制器。它专门 watch “还没有 `nodeName` 的 Pod”，为每个这样的 Pod 选一个合适的 Node，然后把选择结果写回去（设置 `nodeName`，即 binding）。它**只决策、不启动容器**。
- **kubelet**——每个 Node 上各一个。它 watch “`nodeName` 等于自己的 Pod”，把这些 Pod 通过 **CRI**（容器运行时接口）真正跑起来，并把容器的实际 status 回报给 api-server。

此外每个节点还有 **kube-proxy**，负责把 Service 的抽象编排成节点上的网络转发规则（细节留到第 4 章）。

etcd
唯一事实来源


api-server
唯一读写 etcd


唯一写入边


controller-manager
跑各种 reconcile 循环


scheduler
选 Node · 写 nodeName


Node

kubelet

kube-proxy


watch

watch

watch


图 2.3控制平面的拓扑。**注意**：只有 api-server 那条边碰 etcd（accent 标出）；controller-manager、scheduler、kubelet 全部把箭头指向 api-server 而**不指 etcd**，组件之间也**不直接 RPC 编排**。整个系统靠“都 watch 同一个 api-server”来协同，没有中央指挥官。

## 2.5跟踪一条 kubectl apply

没有任何组件“指挥”全局；一条 apply 的落地，是若干个各自 watch + reconcile 的循环依次被触发的结果。

为什么需要它

把前四节拼成一条完整路径，是本章的收口。读完这一节，“声明 spec、组件各自收敛”就从抽象原则变成你能在脑中逐帧播放的具体过程——而这恰恰是排障时最值钱的能力：知道一个 Pod 卡在哪一帧，就知道该看哪个组件。

提交 `kubectl apply -f deploy.yaml`（其中 `spec.replicas: 3`），发生的事按顺序是：

1. **kubectl → api-server**：kubectl 把 YAML 转成 JSON，向 api-server 发一个 POST。api-server 跑完处理链——认证、鉴权、mutating admission、schema 校验、validating admission——然后把这个 Deployment 对象**写入 etcd**。此刻集群里只多了一条记录，还没有任何容器。
2. **Deployment 控制器**：它一直 watch Deployment。看到这个新对象后 reconcile：期望有一个对应的 ReplicaSet，实际没有，于是**创建一个 ReplicaSet**（同样是写给 api-server，落 etcd）。
3. **ReplicaSet 控制器**：它 watch ReplicaSet。看到新 ReplicaSet 期望 3 个副本、实际 0 个，于是**创建 3 个 Pod 对象**。这些 Pod 此刻是 `Pending` 状态，**没有 `nodeName`**——还没被调度。
4. **scheduler**：它 watch “没有 `nodeName` 的 Pod”。看到这 3 个待调度 Pod，为每个挑一个合适的 Node，把选择结果**写回 Pod 的 `nodeName` 字段**（binding）。scheduler 到此收工——它从不启动容器。
5. **目标节点的 kubelet**：每个节点的 kubelet 都 watch “`nodeName` 等于自己的 Pod”。被分到 Pod 的那个节点的 kubelet 看到“这是属于自己的 Pod”，于是**拉镜像 → 经 CRI 起容器**，然后把容器跑起来后的实际 status **回报给 api-server**。

**关键在于：从头到尾没有一个组件“指挥”全局。**Deployment 控制器不知道 scheduler 存在，scheduler 不知道 kubelet 存在。每个组件只盯着 api-server 里与自己相关的那部分状态，做自己的 reconcile，把结果写回去——这个写回，又成了下一个组件的输入。协同是涌现出来的，不是编排出来的。

kubectl
api-server
controllers
scheduler
kubelet







写 etcd


① POST Deployment


② watch 到 Deployment

创建 ReplicaSet


③ 创建 3 个 Pod
Pending · 无 nodeName


④ watch 到未调度 Pod

写 nodeName（binding）


⑤ watch 到属于自己的 Pod

拉镜像 · CRI 起容器 · 回报 status


图 2.4一条 apply 的时序。**注意**：Pod 先以 `Pending` 存在（第 ③ 步，无 `nodeName`），之后才被 scheduler 赋予 `nodeName`（第 ④ 步）——“创建”和“调度”是两个独立步骤、由两个互不相识的组件完成。所有箭头都进出 api-server 那条 accent 生命线，组件之间没有任何直接连线。

## 2.6探针：循环如何“观测健康”

探针（probe）是 kubelet 这一层 reconcile 的“观测”输入——它让循环不只看“容器在不在”，还看“容器健不健康、能不能收流量”。

为什么需要它

到这里循环只观测到“进程是否存活”这一粗粒度信号。但进程活着不等于工作正常（死锁、还没加载完）。探针给循环更细的观测维度，让“把实际推向期望”这件事能精确到“重启它”还是“先别给它发流量”。本节只建立机制，第 3、4 章会用到。

三种探针对应三种不同的“健康”问题，触发三种不同的动作：

- **liveness（存活）**：探测失败 → kubelet 判定容器“坏了”，**重启该容器**。用于检测死锁这类“活着但卡死”的状态。
- **readiness（就绪）**：探测失败 → **把该 Pod 的 IP 从 Service 端点列表里摘掉**，**但不重启**。用于“暂时不能收流量、但本身没坏”的状态（如正在加载缓存、依赖暂时不可用）。摘掉后流量不再进来，恢复后再加回。
- **startup（启动）**：在容器**慢启动期间**先顶着——startup 探针没成功之前，liveness 和 readiness 都暂缓，避免“启动还没完就被 liveness 判死、反复重启”。一旦 startup 成功，交棒给另外两个。

失败模式 · 重启风暴

把外部依赖（如数据库）的可用性塞进 **liveness** 探针，是一个会放大故障的陷阱。一旦数据库抖动，所有副本的 liveness 同时失败 → kubelet 同时重启**整队**容器 → 重启期间依赖仍未恢复 → 再次失败、再次重启 → 雪崩。容器自身明明没坏，却被一次外部抖动打趴全队。**外部依赖的检查应放在 readiness**：依赖不可用时把 Pod 从 Service 摘掉、停止收流量即可，容器无需重启，依赖恢复后自动加回——故障被隔离，而不是被放大。

## 2.7回看第 1 章：自愈不是魔法，是循环

带着 reconcile 模型，重新解释第 1 章那个现象：**你手动 `kubectl delete pod` 删掉一个由 ReplicaSet 管理的 Pod，几秒后一个新 Pod 自己冒了出来。**这不是有谁在“监视你的删除操作并报复”，而是——你的删除让 etcd 里该 ReplicaSet 实际拥有的 Pod 从 3 个变成 2 个；ReplicaSet 控制器下一轮 reconcile 时 observe 到“实际 = 2”，diff 出“实际 < 期望（3）”，于是 act：新建一个 Pod 补齐。**自愈 = 一个永不停止的 level-triggered 循环，碰巧把你的删除当成了一次需要纠正的偏差。**

同样地，**为什么 `kubectl edit` 改的东西会被改回去？**如果你改的是 status 或某个由控制器拥有的派生字段，控制器下一轮 reconcile 会发现它与 spec 推导出的期望不符，于是把它覆盖回去——你改的是“实际”，而循环只认 spec 这个“期望”。**为什么改了配置却不滚动更新？**因为很多配置（如挂载的 ConfigMap 内容）不在触发 reconcile 的 spec 字段里——spec 没变，循环就认为“实际已达期望”，不会重建 Pod，配置自然不生效。每一个“反直觉”，都在循环可见之后变成“当然如此”。

## §本章 self-check

先合上教程，把答案写下来，再展开对照。

1. 用一句话说出 reconcile 循环的三步，并指出哪一步会“改变世界”、它是通过谁去改的。
2. 为什么 level-triggered 的控制器能容忍丢失的 watch 事件？（跨机制题：把 2.2 的原则和 2.3 的循环连起来答。）
3. 控制平面里哪个组件直接读写 etcd？scheduler 在一条 apply 路径里到底做了什么、没做什么？
4. （设计题）某团队把“能否连上 Redis”写进了 liveness 探针。Redis 抖动了一下，结果整个服务的所有副本同时反复重启、迟迟不恢复。解释成因，并说出正确的探针选择。

答案（先做完再展开）

1. observe（经 informer 本地缓存读实际）→ diff（spec 与 status 比对）→ act（改变世界）。只有 act 改变世界，且它不直接动 etcd，而是把意图写给 api-server，由 api-server 落库。
2. 因为 level-triggered 控制器从不依赖“事件”，它每轮重读**完整的实际状态**并与期望比对、差多少补多少。丢掉的事件只是少了一次“该醒醒了”的提醒，下一轮重读全量时仍会发现实际与期望的差距并纠正——正确性绑在“绝对值比对”上，不绑在“事件被处理”上。
3. 只有 api-server 直接读写 etcd，其余组件都只 watch api-server。scheduler 只为没有 `nodeName` 的 Pod 选一个 Node 并把 `nodeName` 写回（binding）；它**不**拉镜像、**不**启动容器——起容器是目标节点 kubelet 的事。
4. liveness 失败会触发 kubelet 重启容器。把外部依赖塞进 liveness，等于让一次依赖抖动同时判“死”所有副本、同时重启整队；重启期间依赖仍未恢复，于是反复重启形成雪崩，而容器自身并没坏。正确做法是放进 **readiness**：依赖不可用时把 Pod 从 Service 端点摘掉、停收流量即可，不重启，依赖恢复后自动加回，故障被隔离而非放大。

动手画一遍

不看教程，在纸上把图 2.4 的时序默画出来：五条生命线、五步箭头。画完翻回去对照——你把“Pod 变成 Pending”画在了 scheduler 写 `nodeName` 之前还是之后？这一前一后的顺序，正是“创建”与“调度”是两件事的核心。

进阶挑战 · 刚好够不着

### 两次 apply 打架，最终几个副本？

你先用 `kubectl edit` 把某 Deployment 的 `replicas` 改成 5；几分钟后，同事用一份旧的 YAML（里面写着 `replicas: 3`）对同一个 Deployment 重新 `kubectl apply`。最终集群里跑着几个副本？为什么？

提示（卡住再展开）

关键问：reconcile 循环认的是“最近一次写进 spec 的值”，而不是“谁先谁后的意图”。同事的 apply 是**后发生**的写操作，它把 `spec.replicas` 覆盖成了 3（apply 的三方合并会用最新提交的字段值）。于是 ReplicaSet 控制器下一轮 reconcile observe 到“实际 = 5、期望（spec）= 3”，diff 出“多了 2 个”，act：删掉 2 个，收敛到 **3**。你的“5”没有任何持久痕迹能让循环记住——**spec 是唯一事实，循环永远收敛到最近一次写入 spec 的那个值。**这也解释了为什么“谁最后 apply，谁说了算”是 K8s 协作里一条要命的隐性规则。

### 本章参考

- [kubernetes.io · Cluster Architecture](https://kubernetes.io/docs/concepts/architecture/)（官方·架构）
- [Borg, Omega, and Kubernetes](https://queue.acm.org/detail.cfm?id=2898444)（ACM Queue·level-triggered 的设计动机）
- [Tim Hockin · Edge vs Level Triggered Logic](https://speakerdeck.com/thockin/edge-vs-level-triggered-logic)（边沿 vs 电平的出处）
- [Declarative Application Management](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/declarative-application-management.md)（设计文档·声明式模型）

[← 上一章
01 · 对象模型](https://zhiwenliang.github.io/learning/kubernetes/01-concepts.html)
[下一章 →
03 · 调度与资源](https://zhiwenliang.github.io/learning/kubernetes/03-scheduling.html)