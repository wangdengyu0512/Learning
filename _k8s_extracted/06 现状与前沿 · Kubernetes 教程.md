Chapter 06

# 现状与前沿：2026 年的 Kubernetes

前五章是 K8s 稳定的核心模型。这一章给出截至 2026 年中的现状——哪些已经改变、哪些正在快速变化、哪些已被取代，免得你学到过时的做法。

本章脉络

- 版本节奏与什么算「稳定核心」——前五章学的东西的保质期
- Gateway API 已取代 Ingress 的地位（最重要的「别学旧的」）
- 原地调整 Pod 资源（in-place resize）已 GA
- K8s 已转向 AI-first：DRA 与 Inference Gateway
- 原生 sidecar、无 sidecar 服务网格、eBPF
- CRD / operator：控制循环设计的完全开放

前五章把 Kubernetes 拆成一句话：**一组 level-triggered 的控制循环**——声明期望状态（spec）、观测实际状态（status）、持续把后者向前者收敛。这个模型从 2015 年至今没变。变的全是它的「周边」：入口怎么配、资源怎么申、网格要不要 sidecar、安全基线长什么样。这一章逐项给出截至 **2026-06** 的现状，每条带版本与日期，并把它钉回前五章的某个概念上——好让你判断哪些做法该跟、哪些教程该跳过。

一条贯穿全章的线索放在最后揭晓（[§6.8](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html#s68)）：最大的扩展性故事——到处都是的 CRD 与 operator——本质上就是**把第 2 章那套 reconcile-loop 设计，原封不动地开放给用户**。前沿在动，这个核心模型没动。

## 6.1版本节奏与稳定核心：前五章的保质期

截至 2026-06，最新稳定版约为 **1.36**（2026-04-22 发布），约每年 3 个小版本；1.32 与更早版本已 EOL。但核心对象模型与控制循环多年稳定——前五章学的不会过时。

**机制（节奏怎么定的）**：Kubernetes 走时间盒发布，一个发布周期约 14–15 周，一年约 3 个 minor。社区只为**最近 3 个 minor** 维护补丁分支：到 1.36（2026-04）时，受维护的是 1.36 / 1.35 / 1.34，1.33 及更早进入 EOL、不再有安全补丁。每个版本的特性按 alpha → beta → stable(GA) 三档晋级；GA 即「默认开启、API 稳定、可放心生产使用」。本章凡说「GA」都指这一档。

近期版本时间线（截至 2026-06）

| 版本 | 发布 | 这一版的标志特性（本章相关） |
| --- | --- | --- |
| 1.33 Octarine | 2025-04 | 原生 sidecar GA（[§6.5](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html#s65)）；in-place resize 进 beta |
| 1.34 | 2025-09 | DRA 框架 GA（[§6.4](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html#s64)） |
| 1.35 Timbernetes | 2025-12-17 | in-place Pod resize GA（[§6.3](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html#s63)） |
| 1.36 | 2026-04-22 | 当前最新稳定；workload-aware 调度推进、安全默认进一步收紧 |

概念 · version skew（版本偏斜）

集群组件并非必须同版本。官方的 version skew 策略允许 kubelet 落后 control plane 最多 **3 个 minor**、kubectl 与 apiserver 相差 ±1 个 minor。这是为什么生产集群能「先升控制面、再分批滚动节点」而不停机——升级是一个被设计成可分阶段进行的过程，本身也是控制循环友好的。

回扣 · 第 1–5 章

Pod / Deployment / Service 的字段语义、ReplicaSet 的 reconcile、调度器的 predicate+score、CSI/CNI 接口边界——这些第 1–5 章讲的东西在 1.36 上和在 1.24 上一模一样。版本节奏快，但快的是**特性闸门**，不是**核心数据模型**。学完前五章，你读 2026 的集群和读 2021 的集群用的是同一套心智模型。

## 6.2Gateway API 取代 Ingress：最重要的「别学旧的」

Ingress 已被冻结、只维护不加新特性；曾经的事实标准 **ingress-nginx 已于 2026-03-24 正式 EOL**（停止维护、不再有 CVE 补丁）。HTTP/L7 入口的现状是 **Gateway API**——其核心 v1.0 自 2023-10 GA，规范已迭代到 v1.x。新项目用 Gateway API。

**机制（为什么换）**：[第 4 章的 Ingress](https://zhiwenliang.github.io/learning/kubernetes/04-networking.html#expose) 是一个单一资源，把「在哪监听、按 host/path 路由到哪个 Service」全塞进一个对象，再靠各家 controller 用 annotation 扩展非标准能力（重写、超时、灰度……）。结果是：规范本身能力薄，真正的功能都藏在 ingress-nginx 这类实现的私有 annotation 里，跨实现不可移植，且把网络策略和应用路由混在同一个对象、同一拨人手里。

Gateway API 把这一个对象**按角色拆成一组对象**，对应组织里不同的人：

Gateway API 的角色化对象（核心 v1）

| 资源 | 谁管它 | 表达什么 |
| --- | --- | --- |
| `GatewayClass` | 基础设施 / 平台提供方 | 「这套 Gateway 由哪个实现支撑」——类比 StorageClass |
| `Gateway` | 集群 / 基础设施团队 | 实际的监听点：端口、协议、证书、对外入口 |
| `HTTPRoute` | 应用 / 服务团队 | L7 路由规则：按 host/path/header 把流量导到 Service，附带的灰度、重写、镜像都是**规范内的字段** |

关键差别有两点。其一，灰度、流量切分、header 改写这些过去是 annotation 的能力，现在是**规范内的一等字段**，跨实现可移植。其二，职责被边界切开：平台团队管 `Gateway`（监听点、证书），应用团队只管自己的 `HTTPRoute`，两者通过 route 绑定到 gateway 的引用关系协作——这正是第 1 章「每个对象有明确归属与边界」在入口层的体现。

别学旧的 · ingress-nginx 2026-03-24 EOL

退休时间线：2025-11-11 官方公告 → **2026-03-24 正式 EOL**，此后无新版本、无 bugfix、无 CVE 补丁；SIG-Network 于 2026-03-20 发布迁移工具 `ingress2gateway` 1.0。继续运行已退休的 ingress-nginx 等于把已知漏洞暴露在外。**2026 年的新项目，HTTP 入口直接上 Gateway API；存量 Ingress 用 ingress2gateway 迁移，或换 F5 NIC / Kong / Traefik 等仍在维护的 controller。**

回扣 · 第 4 章

第 4 章讲 Ingress 时埋了个伏笔：它的扩展全靠 annotation、跨实现不可移植。Gateway API 就是这个缺陷的正式答案。第 4 章的 Service（L4）没变；变的是它**上面**那层 L7 入口——从「一个对象 + 私有 annotation」变成「一组角色化对象 + 标准字段」。

## 6.3原地调整资源（in-place Pod resize）GA

in-place Pod resize 已在 **1.35（2025-12）GA**。过去改 Pod 的 CPU/内存 requests/limits 必须删 Pod 重建；现在通过 Pod 的 `resize` 子资源原地调整、容器通常无需重启（内存下调为 best-effort）。

**机制（为什么过去必须重建）**：[第 3 章](https://zhiwenliang.github.io/learning/kubernetes/03-scheduling.html#s33) 讲过，`requests` 参与调度的资源匹配、`limits` 落到 cgroup 上限。在 1.35 之前这两个值是 Pod 上的**不可变字段**——一旦 Pod 被调度并写定，改它的唯一办法是删了重建，于是触发重新调度、甚至换节点、连接中断。对一个内存吃紧但不想丢进程状态的服务，这代价很高。

1.27 引入 alpha、1.33 进 beta、1.35 GA，把 `resources` 变成可在运行中修改：向 Pod 的 `resize` 子资源提交新值，kubelet 直接调整容器 cgroup，无需重建 Pod。CPU 增减、内存上调通常无重启；内存**下调**因为涉及已分配内存的回收，是 best-effort、并可按 `resizePolicy` 决定是否重启容器。配套地，Vertical Pod Autoscaler 的 `InPlaceOrRecreate` 模式可借此自动右调资源而少打扰工作负载。

回扣 · 第 3 章

第 3 章的资源模型（requests 给调度看、limits 给 cgroup 用）一个字没改——改的是这组值的**可变性**。原本「Pod 一经调度其资源即固化」的假设松动了：现在资源是控制循环可以在线收敛的又一个维度，而不再是只能靠重建来改的死值。

## 6.4K8s 已 AI-first：DRA 与 Inference Gateway

两个 GA/标准级变化把 Kubernetes 推成 AI 工作负载的默认底座：**DRA（Dynamic Resource Allocation）在 1.34（2025-09）GA**，把 GPU/加速器的申领纳入控制平面；**Gateway API Inference Extension（Inference Gateway）**让入口能按模型/LoRA 路由推理流量。

**机制一 · DRA，比 requests/limits 更一般的资源模型**：第 3 章的资源模型只认**标量、可加**的资源——CPU 是「2 核」、内存是「4Gi」，调度器做减法即可。GPU 这类设备塞不进这个模型：它有型号、显存档位、是否可分片（MIG）、拓扑亲和、driver 版本等结构化约束，「要 1 个」远不足以表达。早期靠 device plugin 把 GPU 伪装成可数资源，表达力差。

DRA 换了一套抽象：用 `DeviceClass` 描述设备种类，用 `ResourceClaim` 声明「需要一块满足这些约束的设备」，由专门的 driver 负责把声明匹配到真实硬件并完成分配——**这正是把第 2 章的「声明期望 → 控制器调谐 → 绑定实际」那套模式，从 Pod 调度推广到任意结构化设备**。`resource.k8s.io/v1` 在 1.34 默认开启。意义：GPU 调度从「集群外挂的脏活」变成**控制平面里的一等公民**——这是 2023 年还不存在的能力。

**机制二 · Inference Gateway，按模型路由**：普通 Gateway/HTTPRoute（[§6.2](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html#s62)）按 host/path 路由，对推理流量不够用——同一个端点后面挂着多个模型、多个 LoRA adapter，路由要看请求里的**模型名**，负载均衡要看 GPU 上的 KV-cache 占用与排队深度，而非简单轮询。Gateway API Inference Extension 在 Gateway API 之上加了一层推理感知的路由与调度，让入口理解「这是去 model-A 还是 model-B、哪个副本此刻最空」。2026 年并出现了 **Kubernetes AI Conformance** 认证，给「这个发行版能否可靠跑 AI 工作负载」一个统一标尺。

入口
核心
硬件


Inference Gateway
按模型 / LoRA 路由 · 看 KV-cache 与排队


核心调度
predicate + score

核心网络
Service / Gateway


DRA
ResourceClaim 申领
GPU GA · 1.34


GPU 节点


推理流量

接进控制平面



图 6.1AI-on-K8s 栈：**DRA**（1.34 GA）把 GPU 申领接进核心调度，**Inference Gateway** 叠在核心网络之上按模型路由。**注意**：GPU 调度被收进了控制平面本身——这是 2023 年还不存在的能力，DRA 是第 3 章资源模型的结构化推广。

回扣 · 第 3 章 + 第 4 章

这一节没有引入新范式，只是把旧范式推广：DRA 是第 3 章「资源申领」的结构化版（标量 → 带约束的设备），Inference Gateway 是第 4 章 Gateway 的「内容感知」版（按 host/path → 按模型/负载）。对正在转 AI 方向的人，这是 K8s 与 AI 工程的直接交点。

想一想

为什么 GPU 不能像 CPU 那样用 `requests: { cpu: "2" }` 这种标量写法表达需求？DRA 用什么替代了它？（先停十秒）

展开答案（先自己答）

因为 GPU 不是「可加的标量」。CPU/内存调度本质是做减法——节点有多少、Pod 要多少、够不够。GPU 带**结构化约束**：型号、显存档、能否 MIG 分片、拓扑亲和、driver 版本，「要 1 个」无法表达「要一块支持 MIG、显存 ≥ 40G、和这块网卡同 NUMA 的卡」。DRA 用 `DeviceClass` + `ResourceClaim` 把这种声明交给专门的 driver 去匹配真实硬件——和第 2 章 Pod 调度同构：声明期望 → 控制器调谐 → 绑定实际。

## 6.5原生 sidecar GA：用 init 容器表达伴生进程

原生 sidecar 在 **1.33（2025-04）GA**：用 `initContainers` 加 `restartPolicy: Always` 来表达 sidecar，解决了过去「主容器与 sidecar 赛跑启动 / 退出」的老办法。

**机制（旧办法错在哪）**：[第 1 章](https://zhiwenliang.github.io/learning/kubernetes/01-concepts.html#s12)讲 Pod 是「一组共享网络与存储的容器」。在原生支持之前，sidecar（如日志收集、网格代理）只能作为**普通容器**和主容器并列放进 `containers`。普通容器之间没有启动顺序保证，于是两类竞态反复出现：启动时主容器先跑、网格代理还没就绪，最初几个请求直接失败；退出时 sidecar 先于主容器结束，主容器最后的日志/流量发不出去；而对 Job 这类一次性任务，常驻的 sidecar 永不退出会让整个 Pod 卡在 Running 完不成。

1.33 的解法不是引入新对象，而是**复用 `initContainers` 的现成语义并扩展一个字段**：把 sidecar 写成 init 容器但设 `restartPolicy: Always`。init 容器天然「按顺序、先于主容器启动」，加上 Always 就让它**启动后不阻塞、持续常驻、并在主容器全退出后才终止**。一举消掉启动赛跑、退出顺序、Job 不结束三个老问题。

pod-with-sidecar.yamlyaml复制

```
spec:
  initContainers:
    - name: mesh-proxy        # 写成 init 容器
      image: proxy:1.x
      restartPolicy: Always   # ← 这一行让它成为「原生 sidecar」
  containers:
    - name: app               # 主容器；启动时 sidecar 已就绪
```

回扣 · 第 1 章

Pod「一组共享上下文的容器」这个定义没变。变的是 Pod 内部**容器之间的生命周期编排**从「全部并列、无序」多出一类「先起、常驻、后退」的伴生容器。注意它的实现方式——不是发明新资源，而是给已有的 `initContainers` 加一个字段。这种「复用既有机制而非堆新概念」的克制，正是 K8s API 演进的典型手法。

## 6.6无 sidecar 服务网格 + eBPF

数据面正在「去 sidecar」：**Istio ambient 模式自 Istio 1.24（2024-11）GA**，用 ztunnel + waypoint 取代每 Pod 一个 sidecar；**Cilium（eBPF）**已成主流 CNI，可整体替换 kube-proxy。

**机制一 · ambient mesh 去掉每 Pod sidecar**：传统网格给每个 Pod 注入一个 Envoy sidecar（即便用了 §6.5 的原生 sidecar，代理本身仍在）。代价是每个 Pod 都背一份代理的内存与延迟开销，规模大时很重。Istio ambient 把数据面拆成两层：**ztunnel** 是每节点一个的轻量 L4 组件，负责该节点上所有 Pod 的 mTLS 与 L4 流量；需要 L7 能力（七层路由、重试、授权）时，流量再按需经过 **waypoint** 代理。结果是 L4 安全（零信任 mTLS）对所有 Pod 默认开启而无 per-Pod sidecar，L7 开销只在真正用到时才付。

**机制二 · eBPF 替换 kube-proxy**：[第 4 章的 kube-proxy](https://zhiwenliang.github.io/learning/kubernetes/04-networking.html#kube-proxy-modes) 在每个节点把 Service 的 ClusterIP 翻译成后端 Pod IP，传统实现靠 iptables（或 IPVS）规则——Service 数量大时规则线性膨胀、更新慢。Cilium 用 **eBPF** 把这套转发逻辑下沉进内核数据路径，按 eBPF map 做查表，规模化下的转发与更新都更高效，可以**整体替换 kube-proxy**，并顺带提供 L3/L4/L7 网络策略与可观测性。

回扣 · 第 4 章

第 4 章的两个抽象——Service（稳定虚 IP）与 kube-proxy（把虚 IP 转发到 Pod）——语义都没变。变的是**实现层**：kube-proxy 的 iptables 实现可被 eBPF 取代，而 mTLS/L7 这些「Service 之上」的网格能力，正从「每 Pod 一个 sidecar」转向「每节点一层 + 按需 waypoint」。抽象稳定、实现在换，是本章的反复主题。

## 6.7安全基线变更：别学已删除的

两处早已删除的东西，2026 年的教程若还在教就是错的：**dockershim 自 1.24（2022）移除**——运行时是 containerd/CRI，别再把 Docker 当运行时讲；**PodSecurityPolicy（PSP）自 1.25（2022）移除**——换成 Pod Security Admission（PSA）。

**机制一 · 运行时是 CRI，不是 Docker**：kubelet 通过 **CRI（Container Runtime Interface）**这个标准接口和运行时对话。早年 kubelet 内置了一个适配 Docker 的垫片 `dockershim`，让人误以为「K8s 跑在 Docker 上」。1.24 把 dockershim 移出 kubelet，节点上的运行时是 **containerd** 或 CRI-O 这类直接实现 CRI 的运行时。注意区分：你本地用 `docker build` 构建的镜像是 OCI 标准镜像，照样在 containerd 上跑——**变的是节点运行时，不是镜像格式**。任何把「Docker」讲成 K8s 节点运行时的材料，停在 2022 年之前。

**机制二 · PSP → Pod Security Admission**：限制 Pod 的安全上下文（能否特权、能否用 hostPath、以谁的 UID 运行）过去靠 PodSecurityPolicy，它配置复杂、授权模型反直觉，1.25 被移除。替代是内置的 **Pod Security Admission**——一个 admission controller，按命名空间打标签即可施加三档标准之一：`privileged`（不限）、`baseline`（挡掉已知提权）、`restricted`（强约束最佳实践），每档还可设 enforce/audit/warn 三种力度。它不替代细粒度策略（要更细就上 Kyverno/OPA Gatekeeper 这类策略引擎），但把「基线」做成了开箱声明。

别学已删除的 · 两处停在 2022

① 「Kubernetes 用 Docker 作为运行时」——dockershim 1.24（2022）已移除，运行时是 containerd/CRI。② 「用 PodSecurityPolicy 限制 Pod 权限」——PSP 1.25（2022）已移除，用 Pod Security Admission 的 baseline/restricted。看到教程里出现这两个说法，基本可判断它的知识停在 2022 年之前。

## 6.8CRD 与 operator：控制循环设计的完全开放

内置资源用的那套 API 机制（声明对象 → 存 etcd → 校验 → RBAC → watch → reconcile），通过 **CRD** 对用户完全开放：注册一个 CRD 就得到一等公民资源，写一个 **operator** 就是「再加一个 reconcile 循环」。

**机制（这是第 2 章的高潮）**：回到第 2 章那条主线——Deployment 控制器的工作是「watch Deployment 对象 → 比对期望与实际副本数 → 创建/删除 ReplicaSet 收敛」。这个循环没有任何一处是 Deployment 专属的，它用的全是通用设施：对象存在 etcd、经 admission 校验、受 RBAC 管控、通过 watch 推送变更、由控制器持续 reconcile。

CRD（CustomResourceDefinition）做的事，就是**把这套通用设施开放给任意你定义的类型**。注册一个 CRD（比如 `Database`），apiserver 立刻给你一个完整的 REST 资源：`kubectl get database` 能用、字段经 schema 校验、纳入 RBAC、支持 watch——和内置资源毫无二致。然后你写一个 **operator**：一个 watch 你的 CRD、把声明的期望状态（「需要一个 3 副本、自动备份的 PostgreSQL」）调谐成现实的控制器。**operator 不是新机制，它就是「再加一个第 2 章那样的 reconcile 循环」**，只不过被调谐的对象从内置的 Pod 换成了你的 `Database`。

apiserver + etcd
存储 · 校验 · RBAC
watch


内置控制器
reconcile Deployment

Pod / ReplicaSet


operator
reconcile Database

CRD: Database



watch
调谐



watch
调谐


图 6.2内置控制器（左）与自定义 operator（右）**共用中央那套 API 设施**，两边都是同构的 reconcile 循环，只是被调谐的资源类型不同。**注意**：右侧（accent）和左侧结构完全镜像——operator 不是新机制，是第 2 章 reconcile 循环对用户类型的完全开放。

由此得到对 Kubernetes 本质的一句重述：它其实是**一个通用的、可声明、可调谐的对象数据库**——任何能被表达成「期望状态 + 一个把现实收敛到期望的循环」的东西，都能装进来。容器编排（Pod/Deployment/Service）只是它的**第一个应用**，不是它的全部。这也是**平台工程**的技术底座：企业把数据库、消息队列、机器申领、甚至发布流程都建模成 CRD + operator，让内部开发者像 `kubectl apply` 一个 Deployment 那样去申领一整套基础设施——Kubernetes 成为内部平台的统一控制面。

回扣 · 第 2 章（全章高潮）

第 2 章那句核心论断——「Kubernetes 是一组 level-triggered 控制循环」——在这里收束为一个最强论断：那套循环设计不是内置资源的特权，而是**对所有人开放的编程模型**。学会了第 2 章，你不只是会用 K8s，你已经掌握了写 operator、把 K8s 当平台底座来扩展的全部核心思想。前沿在动，这个模型纹丝不动。

### 动手画一遍

不看本节，在纸上画出图 6.2：把「内置控制器调谐 Deployment」和「你写的 operator 调谐某个自定义资源」画成两条并列的循环，中间共用同一个 apiserver。画完翻回来对照——你有没有把两条循环画成**结构对称**的？如果它们看起来不一样，说明「operator = 再加一个 reconcile 循环」这层还没真正内化。

## §本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再点开对照——直接点开等于把这一节当再读一遍。

1. 2026 年的新项目要做 HTTP（L7）入口，该用 Ingress 还是 Gateway API？为什么？ingress-nginx 现在处于什么状态？
2. 1.35 之前要改一个运行中 Pod 的内存 limit，必须做什么动作？1.35 GA 之后呢？
3. GPU 为什么塞不进第 3 章「CPU/内存 requests」那种标量资源模型？DRA 用哪两个对象替代了它，对应第 2 章的什么模式？
4. 「operator」和第 2 章讲的「内置控制器的 reconcile 循环」是两种不同的机制吗？用一句话说清它们的关系。

答案（先做完再展开）

1. 用 **Gateway API**。Ingress 已冻结、不再加新特性，其能力靠各 controller 的私有 annotation 撑、跨实现不可移植；Gateway API 把入口拆成角色化对象（GatewayClass / Gateway / HTTPRoute），灰度/重写等是规范内字段、可移植，且按平台团队 vs 应用团队切分职责。ingress-nginx 已于 **2026-03-24 正式 EOL**——不再有版本、bugfix 或 CVE 补丁，继续用等于暴露已知漏洞。
2. 之前：`resources` 是 Pod 不可变字段，唯一办法是**删 Pod 重建**，触发重新调度、甚至换节点、连接中断。1.35（2025-12）GA 后：向 Pod 的 `resize` 子资源提交新值，kubelet 直接调 cgroup，**原地调整、通常无需重启**（内存下调为 best-effort，可按 resizePolicy 决定是否重启）。
3. 因为 GPU 不是「可加的标量」，带型号、显存档、能否 MIG 分片、拓扑、driver 版本等**结构化约束**，「要 1 个」表达不了。DRA 用 `DeviceClass`（描述设备种类）+ `ResourceClaim`（声明带约束的需求）替代，由专门 driver 匹配真实硬件——和第 2 章 Pod 调度**同构**：声明期望 → 控制器调谐 → 绑定实际。1.34（2025-09）GA。
4. 不是两种机制，是**同一种**。operator 就是「再加一个第 2 章那样的 reconcile 循环」——watch 一个对象、把期望状态调谐成现实——只不过被调谐的对象从内置的 Pod/Deployment 换成了你用 CRD 注册的自定义资源，复用的是同一套 apiserver/etcd/RBAC/watch 设施。

进阶挑战 · 刚好够不着

### 三处过时：一个 2026 教程仍在教旧做法

一个号称「2026 最新」的 Kubernetes 教程，里面还在教：**(a)** 用 ingress-nginx 做 HTTP 入口、**(b)** 用 PodSecurityPolicy 限制 Pod 权限、**(c)** 「Kubernetes 把 Docker 作为容器运行时」。这三处分别过时在哪？各自现在的现状（含大致时点）是什么？

提示（卡住再展开）

**(a) ingress-nginx**：该项目已于 **2026-03-24 正式 EOL**（公告 2025-11），无新版本/无 CVE 补丁；现状是 **Gateway API**（核心 v1.0 自 2023-10 GA），存量用 `ingress2gateway` 迁移或换 F5 NIC/Kong/Traefik。

**(b) PodSecurityPolicy**：PSP 自 **1.25（2022）移除**；现状是内置的 **Pod Security Admission**，按命名空间打标签施加 baseline/restricted 三档基线，细粒度策略交给 Kyverno/OPA Gatekeeper。

**(c) Docker 作为运行时**：`dockershim` 自 **1.24（2022）移除**；节点运行时是实现 **CRI** 的 containerd/CRI-O。注意区分：本地 `docker build` 出的是 OCI 镜像，照样能在 containerd 上跑——变的是节点运行时，不是镜像格式。

### 本章参考

- [Kubernetes 官方博客](https://kubernetes.io/blog/)（发布动态：1.36 / 1.35 / 1.34 release 与各特性 GA 公告）
- [Gateway API 官方文档](https://gateway-api.sigs.k8s.io/)（GatewayClass / Gateway / HTTPRoute 角色化模型；ingress-nginx 退休与迁移见官方博客 2025-11-11 / 2026 系列）
- [Dynamic Resource Allocation（DRA）官方文档](https://kubernetes.io/docs/concepts/scheduling-eviction/dynamic-resource-allocation/)（DeviceClass / ResourceClaim；1.34 GA，`resource.k8s.io/v1`）
- [Istio ambient 模式文档](https://istio.io/latest/docs/ambient/)（ztunnel + waypoint 无 sidecar 数据面；自 Istio 1.24 / 2024-11 GA）
- [Sidecar Containers 官方文档](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)（initContainers + restartPolicy: Always；1.33 GA）

[← 上一章
05 · 存储与状态](https://zhiwenliang.github.io/learning/kubernetes/05-storage-state.html)
[下一章 →
07 · 自测](https://zhiwenliang.github.io/learning/kubernetes/07-self-check.html)