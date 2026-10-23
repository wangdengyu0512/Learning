Chapter 07

# 自测：把六章压成一个循环

前六章建立了 K8s 的对象模型、控制循环、调度、网络、存储与现状。这一章不教新东西——它逼你把这些**取回来**：先回忆、再讲机制、最后在真实场景里做判别。判别题是整份教程的"综合项目"。

怎么用这一章

- 三层梯度：概念层（回忆）→ 原理层（讲机制）→ 应用判别层（在场景里选方案）
- 所有答案集中在页面最后一个折叠块里——**先把答案写下来，再展开对照**
- 直接翻答案 = 把这一章当成第七遍阅读，前六章的 retrieval 收益全部归零

越往上越难，也越值钱。概念层只要你认得名词；原理层要你说清"它通过什么实现、代价是什么"；应用判别层把多章的概念混在一个场景里，逼你**选择**——这正是工程现场的样子。

概念层 · 回忆（recall）
认得名词就行 · 对应第 1 章


原理层 · 讲机制
说清怎么实现 · 第 2–5 章


应用判别层
场景里选方案 · 跨 1–6 章


越往上越考迁移


图 7自测的三层梯度，以及每层主要测哪些章节。
**注意**：顶层的判别题不测"你记不记得"，测"换个场景你还选得对吗"——这是迁移，也是这份教程真正的目标。

## 7.1概念层 · 对应第 1 章

1. Pod 和容器是什么关系？为什么 K8s 的最小调度单位是 Pod 而不是单个容器？§1.2
2. Deployment、ReplicaSet、Pod 三者的托管关系是什么？一次改镜像的滚动更新，背后发生了什么？§1.3
3. Service 靠什么把流量送到一组 Pod？它"拥有"这些 Pod 吗？§1.4
4. Secret 默认是加密存储的吗？它和 ConfigMap 的真正区别是什么？§1.5

## 7.2原理层 · 对应第 2–5 章

5. 用一句话说明 level-triggered 与 edge-triggered 的区别，以及为什么丢失一个 watch 事件不会让 K8s 状态永久跑偏。§2.2
6. 控制平面里哪个组件是唯一直接读写 etcd 的？其它组件靠什么获知变化？这么设计买到了什么？§2.4
7. 跟踪一条 `kubectl apply -f deploy.yaml`：从命令发出到 Pod 在节点上跑起来，依次有哪些组件参与、各做了什么？§2.5
8. 调度器在 Filter 阶段判断"装不装得下"，看的是 `requests` 还是 `limits`？那 `limits` 在运行时管什么？§3.3
9. 内存用超 `limit` 和 CPU 用超 `limit`，后果本质上有何不同？为什么一个会被杀、一个只是变慢？§3.4
10. ClusterIP 上有进程在监听吗？一个发往 ClusterIP 的数据包，是怎么最终到达某个后端 Pod 的？§4.3
11. readiness 探针失败会发生什么？和 liveness 探针失败的后果有何不同？§2.6 / §4.5
12. 为什么说 PV 和 PVC 的绑定"也是一次 reconcile"？谁是期望、谁是供给？§5.2
13. 改了 ConfigMap 里的值，为什么注入为环境变量的 Pod 不会自动拿到新值？怎么才能让它生效？§5.1

## 7.3应用判别层 · 跨章场景（综合项目）

每道题都把多章概念混在一个真实场景里。先判断"这是哪一层的问题"，再选方案、给依据。

场景 14 · 三个出问题的 Pod

一个 Pod 卡在 `Pending`，一个反复 `CrashLoopBackOff`，第三个 `ImagePullBackOff`。三者分别卡在生命周期的哪个阶段（调度 / 拉镜像 / 运行）？各自第一步该查什么？§2.5 + §3.2 + §1

场景 15 · 三副本的数据库

要部署 3 副本的 PostgreSQL，每个实例需要自己的持久数据卷和稳定的网络标识。用 Deployment 还是 StatefulSet？如果硬用"Deployment + 一个 PVC"会出什么事？§1.3 + §5.4 + §5.5

场景 16 · 八个微服务对外暴露

集群内 8 个 HTTP 微服务要对外暴露、按域名和路径路由。给每个都开一个 `LoadBalancer` Service 有什么问题？更合适的做法是什么？如果这是 2026 年的新项目，具体该选哪个 API？§4.6 + §6.2

场景 17 · 探针里的外部依赖

一个服务依赖外部数据库。同事提议把"能否连上数据库"写进 `liveness` 探针，"连不上就重启"。这么做在数据库抖动时会引发什么？正确的探针选择是什么？§2.6 + §4.5

场景 18 · 无声的延迟尖刺

服务在高负载下偶发延迟尖刺，但 Pod **从不重启**、没有任何报错事件、内存也正常。最该怀疑哪一项资源配置？为什么它如此难定位？§3.4

场景 19 · 自己变回去的副本数

你 `kubectl scale` 把某 Deployment 改到 5 个副本，几分钟后它自己变回了 3，没人手动操作。用控制循环的语言解释这背后发生了什么。§2.1 + §2.3

亲手画一张图

合上教程，在纸上或 Excalidraw 里画出**控制平面架构**，再叠上一条 `kubectl apply` 从命令到 Pod 运行的完整路径（第 2 章 §2.4–§2.5）。只画 5–6 个核心组件即可。

画完翻回第 2 章对照，重点看三件事：① 你画的图里，直接写 etcd 的是不是只有 api-server 一个？② 控制器之间有没有被你画成"互相调用"（应该全是各自 watch api-server）？③ Pod 是先有 `nodeName` 才运行，还是先 `Pending` 等调度？

进阶挑战 · 刚好够不着

### 把"自愈"翻译成一句循环

不用"K8s 会自动恢复"这种说法，仅用**期望状态 / 实际状态 / 控制器 / reconcile** 这几个词，写一段话解释：为什么你手动 `kubectl delete pod` 删掉一个由 Deployment 管理的 Pod，几秒后它又回来了。然后再追问自己一句——如果删的是整个 Deployment 对象，它还会回来吗？为什么？

提示（卡住再展开）

ReplicaSet 控制器的期望来自 Deployment 写下的 `replicas`；它每轮 reconcile 都数一遍"标签匹配且存活的 Pod"。删 Pod 改变的是**实际**，期望没变，所以下一轮就补齐。删 Deployment 改变的是**期望本身**（连同它的 ReplicaSet 一起被回收）——没有期望，也就没有什么需要被恢复。

## §答案（先把你的答案写完再展开）

展开全部答案

### 概念层

1. **Pod 与容器**：Pod 是一个或多个容器的组合，组内容器共享同一个 network namespace（同一 IP、可经 `localhost` 互通）、IPC 和可共享的 volume，由一个 pause 容器持有这些命名空间。最小单位是 Pod 而非容器，是因为紧耦合的辅助进程（如 sidecar）需要被一起调度、同生共死、共享本地通信——容器粒度无法表达"这几个必须待在一起"。
2. **三层托管**：Deployment 管理 ReplicaSet，ReplicaSet 维持 N 个 Pod。ReplicaSet 的唯一职责是让"标签匹配的 Pod 数"等于 `replicas`。滚动更新时 Deployment 新建一个 ReplicaSet，旧 RS 逐步缩容、新 RS 逐步扩容（回滚即反向）。
3. **Service 与 Pod**：靠 label selector 选中一组带匹配标签的 Pod，维护一份就绪 Pod IP 的 EndpointSlice。它不"拥有"Pod，只按标签匹配——这是松耦合的关键，Pod 可以随时被替换而 Service 身份不变。
4. **Secret**：默认**不是**加密，只是 base64 编码；任何能读 etcd 或有 `get secret` 权限的人都能解开，真正的静态加密需另开 EncryptionConfiguration。它和 ConfigMap 的区别主要是语义与处理约定（不在日志里回显、可按需挂载），而非默认加密。

### 原理层

5. **level vs edge**：edge-triggered 对每个事件做一次反应，事件丢了或控制器崩了那次变更就永久丢失；level-triggered 每轮都重新读取完整实际状态与期望比对，无论被什么唤醒。所以丢一个 watch 事件，下一轮 reconcile 重新观测时仍会发现差异并补上——状态收敛，不会永久跑偏。
6. **唯一写 etcd 者**：api-server。其它组件（控制器、scheduler、kubelet）都通过 watch api-server 获知变化，从不直接碰 etcd。好处：单一入口统一做认证、鉴权、admission、校验与一致性控制；组件之间不需互相 RPC 编排，解耦且抗故障。
7. **kubectl apply 全程**：kubectl 把 YAML 转成请求 POST 给 api-server → 经认证/鉴权/admission/校验后写入 etcd → Deployment 控制器 watch 到新对象、创建 ReplicaSet → ReplicaSet 控制器发现副本数为 0、创建 N 个 Pod（Pending、无 nodeName）→ scheduler watch 到未调度 Pod、选节点并写 `nodeName` → 目标节点 kubelet watch 到属于自己的 Pod、经 CRI 拉镜像起容器、回报 status。没有总指挥，全是各自 watch+reconcile。
8. **调度看 requests**：Filter 阶段只对 `requests` 求和判断节点可分配量装不装得下；`limits` 对调度毫无影响。`limits` 是运行时上限，通过 cgroup 在内核层约束容器实际用量。
9. **内存 vs CPU 超限**：内存不可压缩，超过 limit 内核直接 OOMKill（退出码 137），进程死。CPU 可压缩，超过 limit 只是被 CFS 按周期节流、变慢，进程不死，而且没有事件/日志。所以同样"超限"，内存会死、CPU 只是慢。
10. **ClusterIP 真相**：ClusterIP 上没有任何进程监听、也没有对应网卡。kube-proxy 把"ClusterIP → 某后端 Pod IP"的 DNAT 规则写进内核（iptables/IPVS/nftables），包发往 ClusterIP 时在内核里被改写目标地址、转发到某个就绪 Pod。后端挂了只是规则选到坏 IP 或被摘除，而不是在 VIP 上拒绝连接。
11. **readiness vs liveness**：readiness 失败把该 Pod 的 IP 从 Service 的 EndpointSlice 里摘掉、停止给它发流量，但**不重启**；liveness 失败由 kubelet **重启**容器。前者管"能不能接客"，后者管"要不要重启"。
12. **PV/PVC 也是 reconcile**：PVC 是应用对存储的申领（期望），PV 是实际存在/可供给的存储（供给）；一个控制平面循环按 capacity/accessModes/storageClassName 把二者一对一双向绑定（ClaimRef），相位 Available→Bound→Released。这跟第 2 章的控制循环是同一个模式——期望与供给的持续撮合。
13. **改 ConfigMap 不生效**：env 在容器启动时只读一次；改 ConfigMap 不会改动任何 Pod spec 字段，因此不触发任何 reconcile、不滚动，Pod 里的值不变。解决：`kubectl rollout restart`、给 Pod 模板加 ConfigMap 内容的 checksum 注解（内容变→模板变→触发滚动）、或用 Reloader。挂成 volume 的 key 文件会更新，但应用得自己重新读取。

### 应用判别层

14. **三个 Pod**：`Pending` = 还没被**调度**（没有节点能满足 requests/affinity/taint/PVC），查 `kubectl describe pod` 的调度事件与节点可分配量。`ImagePullBackOff` = 已调度但**拉镜像**失败（标签错/仓库认证/网络），查镜像名与 imagePullSecrets。`CrashLoopBackOff` = 已运行但容器**反复启动后退出**（应用或配置错），查 `kubectl logs --previous`。三者分别对应"调度 / 拉镜像 / 运行"三个阶段。
15. **数据库选型**：用 StatefulSet。它给每个 Pod 稳定序号与主机名（`db-0/1/2`）、通过 `volumeClaimTemplates` 为每个 Pod 单独建 PVC、配合 headless Service 提供稳定 DNS。硬用"Deployment + 一个 PVC"：多个可互换的副本会争抢同一块 RWO 卷、调度到不同节点时挂载失败，或互相覆盖数据。
16. **八个服务暴露**：给每个都开 LoadBalancer 会按服务数量计费、且无法做 L7 路由，成本和管理都失控。应该用一个 L7 入口按 host/path 把流量收敛到各 Service。2026 年的新项目用 **Gateway API**（GatewayClass/Gateway/HTTPRoute）——Ingress 已冻结、ingress-nginx 自 2026-03 停止维护。
17. **探针里的依赖**：把外部数据库放进 liveness，会在数据库抖动时让所有副本同时被判定"不健康"而**一起重启**，重启后又一起冲击数据库 → 重启风暴/雪崩。外部依赖应放 **readiness**（连不上就暂时摘出流量、不重启）；liveness 应只做便宜的本地存活检查，并配较高的 failureThreshold。
18. **无声尖刺**：CPU `limit` 设得过低导致的**限流（throttling）**。CPU 可压缩，超限只是被内核按周期节流、变慢，进程不死、不重启、不产生事件——所以表现为"偶发延迟但一切看起来正常"，极难定位。需看 cgroup 的 CPU throttling 指标。
19. **自己变回去**：几乎一定是另一处"期望状态"在 reconcile 覆盖你。最常见是 GitOps/CD（如 Argo CD）或重新 `apply` 的清单里写着 `replicas: 3`，控制器持续把实际拉回这个期望；你的 `kubectl scale` 改的是实际、没改源头的 spec，于是被还原。（HPA 接管副本数也会有类似效果。）

### 本章参考

- [Debugging CrashLoopBackOff](https://www.sysdig.com/blog/debug-kubernetes-crashloopbackoff)（Sysdig · 场景 14）
- [Liveness and Readiness Probes](https://blog.colinbreck.com/kubernetes-liveness-and-readiness-probes-how-to-avoid-shooting-yourself-in-the-foot/)（Colin Breck · 场景 17）
- [Scheduling uses requests, not limits](https://www.k8s.guide/insights/opinion/2026-03-10-kubernetes-scheduling-requests-not-limits/)（场景 18）
- [Kubernetes Concepts](https://kubernetes.io/docs/concepts/)（官方 · 全章兜底）

[← 上一章
06 · 现状与前沿](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html)
[回到 →
00 · 起点 / 概念地图](https://zhiwenliang.github.io/learning/kubernetes/index.html)