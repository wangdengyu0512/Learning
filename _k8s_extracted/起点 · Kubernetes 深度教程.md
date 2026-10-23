Kubernetes 深度教程 · 概念向

# 从"部署工具"到"控制循环"：真正理解 Kubernetes

不背命令，而是建立一个能解释自愈、滚动更新、调度、网络的统一心智模型。

**基于版本**：Kubernetes 1.3x（截至 2026-06）
**阅读时间**：约半天（深入）
**模式**：概念向（非实操）
**代码验证**：以概念为主；YAML 片段为说明用途，未在本机集群逐条执行

## A这份教程适合谁

### 适合你，如果——

- 能用 Docker 跑起一个容器，分得清镜像与容器
- 理解进程、端口、基本的 TCP/IP 与 DNS
- 部署过至少一种后端服务（传统部署或 docker-compose 都算），想搞懂 K8s 到底在替你解决什么问题

### 先去别处，如果——

- 还没碰过容器 → 先花一小时过一遍 [Docker 入门](https://docs.docker.com/get-started/)
- 要的是 kubectl 命令速查或 CKA 实操备考 → 去 [killercoda](https://killercoda.com/) 做交互式 lab
- 只想把应用一键上线、不关心原理 → 用托管 PaaS（Cloud Run / Render）

## B读完之后你能做到什么

这份教程真正想给你的

把 K8s 里的**任何**对象都看成一份"期望状态记录 + 一个不停把现实推向它的控制器"。一旦这么看，自愈、`kubectl edit` 被还原、改了 ConfigMap 却不生效——这些"玄学"都还原成同一个循环。这是官方文档不会直接告诉你的那一层。

具体说，读完你能：

- 用"期望状态 vs 实际状态 + 控制循环"一句话解释自愈、滚动更新、为什么手动 `kubectl edit` 会被还原
- 看到 `Pending` / `CrashLoopBackOff` / `ImagePullBackOff`，能说出卡在**调度 / 拉镜像 / 运行**哪一阶段
- 解释为什么调度只看 `requests`、为什么内存超限会被杀（OOMKill）而 CPU 超限只是变慢
- 解释 ClusterIP 为什么不是一块网卡，一个请求如何被内核规则转发到后端 Pod
- 为有状态服务在 Deployment 与 StatefulSet 之间做出有依据的选择
- 判断一个 2026 年的新项目该用 Gateway API 还是 Ingress

一句话本质

Kubernetes 不是一个"部署工具"，而是一组持续运行的**控制循环**（control loop）：你声明**期望状态**（spec），控制器不断观测**实际状态**（status），并把实际推向期望。Deployment、Service、PVC、自动扩缩、operator——全是这一个模式的重复。

现状速览 · 截至 2026-06

**稳定核心**：对象模型 + 控制循环多年未变——本教程前五章学的不会过时；容器运行时是 containerd/CRI（Docker 作为运行时早在 2022 年的 1.24 就移除了）。

**正在快速变化**：最新稳定版约 1.36（2026-05）；原地调整 Pod 资源（in-place resize）已 GA（1.35）；GPU/加速器调度 DRA 已 GA（1.34），K8s 明显转向 AI-first；Gateway API 已接替 Ingress 的位置。

**已被取代（别再学旧的）**：Ingress 已冻结、ingress-nginx 自 2026-03 停止维护，新项目用 Gateway API；PodSecurityPolicy 已移除（1.25），改用 Pod Security Admission。第 6 章专门讲这些。

读之前 · 关于"流畅感"的警告

这份教程会刻意在某些地方让你停下来预测、自答。如果你冒出下面这三种感觉，请警惕——它们通常是错觉，而不是学会了：

· **"我读得很顺"**——顺，往往只说明内容眼熟，不代表你能复述机制。  
· **"我做题很快"**——快，往往是题型见过，换个场景就卡。  
· **"我没卡壳"**——没卡壳，往往说明这部分没真正触碰到你的认知结构。

遇到 想一想 和 进阶挑战，先合上屏幕在脑子里（或纸上）答一遍，再展开对照。

## C概念地图：先看全景

下面这张图是整份教程的骨架。它画的不是组件清单，而是**那一个循环**：你在顶端写下期望，控制平面把它存下来并不停比对，节点把它变成现实，现实再回报上去——周而复始。后面每一章都挂在这张图的某个位置上。

你 · kubectl apply
写下期望状态（spec）


apply（spec）


控制平面 · CONTROL PLANE


api-server
唯一读写 etcd 的入口


etcd
唯一事实来源


读 / 写


控制器 controllers · 调度器 scheduler
observe → diff → act，永不停止


watch


下发 / 分配


节点 · NODES

kubelet
拉镜像 · 起容器

kube-proxy
写网络规则

Pod
status=实际


status 回报 → 重新比对


图 0整份教程只讲一个循环：声明期望 → 控制平面比对 → 节点落实 → 状态回报 → 再比对。
**注意**：只有 **api-server** 直接碰 etcd，其它组件之间从不互相"指挥"——全靠各自 watch。这是 K8s 抗故障的根，第 2 章展开。

## D三条阅读路径

七章按依赖顺序排列，从头读最完整。若时间有限，按目的挑一条：

只想吃透"控制循环"这个本质

起点 → [02 控制循环](https://zhiwenliang.github.io/learning/kubernetes/02-control-loop.html) → 回头看 [01 对象模型](https://zhiwenliang.github.io/learning/kubernetes/01-concepts.html) → [05 存储](https://zhiwenliang.github.io/learning/kubernetes/05-storage-state.html)（看同一个循环如何被复用到存储上）。

做技术选型：K8s 到底值不值得上

起点 → [02 控制循环](https://zhiwenliang.github.io/learning/kubernetes/02-control-loop.html)（理解它买到了什么、代价是什么）→ [06 现状与前沿](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html) → [07 自测](https://zhiwenliang.github.io/learning/kubernetes/07-self-check.html)的应用判别题。

要看懂别人写的 K8s 配置

[01 对象模型](https://zhiwenliang.github.io/learning/kubernetes/01-concepts.html) → [03 调度与资源](https://zhiwenliang.github.io/learning/kubernetes/03-scheduling.html)（requests/limits）→ [04 网络](https://zhiwenliang.github.io/learning/kubernetes/04-networking.html)（Service / Ingress）→ [05 存储](https://zhiwenliang.github.io/learning/kubernetes/05-storage-state.html)。

## E目录

- [01对象模型 — 你向集群声明的"名词"：Pod、Deployment、Service、ConfigMap/Secret，每个都是 spec+status](https://zhiwenliang.github.io/learning/kubernetes/01-concepts.html)
- [02控制循环 — 本质所在：声明式、level-triggered、reconcile 三步、控制平面架构，跟踪一条 kubectl apply](https://zhiwenliang.github.io/learning/kubernetes/02-control-loop.html)
- [03调度与资源 — Pod 如何落到 Node；requests vs limits；CPU 限流 vs 内存 OOMKill；QoS](https://zhiwenliang.github.io/learning/kubernetes/03-scheduling.html)
- [04网络模型 — 扁平网络公理；ClusterIP 的真相（不是网卡，是内核 DNAT 规则）；Service 类型 vs Ingress](https://zhiwenliang.github.io/learning/kubernetes/04-networking.html)
- [05存储与状态 — PV/PVC 绑定就是又一个 reconcile；StatefulSet vs Deployment；为什么改 ConfigMap 不生效](https://zhiwenliang.github.io/learning/kubernetes/05-storage-state.html)
- [06现状与前沿 — 2026 年实况：Gateway API、in-place resize、DRA/AI、原生 sidecar、ambient mesh、CRD/operator](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html)
- [07自测 — 三层梯度题库 + 跨章判别场景 + 亲手画一遍控制平面](https://zhiwenliang.github.io/learning/kubernetes/07-self-check.html)

## F学完之后往哪走

- **Helm / Kustomize** — 配置打包与多环境管理。在你的 schema 上加："如何把一堆 YAML 模板化、复用"。
- **写一个 operator / CRD** — 把第 2 章的控制循环变成你自己的。加的是："reconcile 不只是内置的，你也能写"。
- **可观测性（Prometheus + metrics-server）** — 看 reconcile 与资源使用的真实行为。加的是："如何观测这台机器在做什么"。
- **服务网格（Istio ambient）** — 流量治理、mTLS。加的是："Service 之上的 L7 治理层"（回扣第 6 章）。
- **CKA 实操认证** — 若需要动手能力证明，用 killercoda 交互 lab 把命令练熟。

### 总参考资料

- [Kubernetes 官方 Concepts 文档](https://kubernetes.io/docs/concepts/)（权威来源）
- [Borg, Omega, and Kubernetes](https://queue.acm.org/detail.cfm?id=2898444)（ACM Queue · 设计渊源与控制循环动机）
- [Declarative Application Management in Kubernetes](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/declarative-application-management.md)（设计文档）
- [Kubernetes Blog](https://kubernetes.io/blog/)（版本发布与前沿动态）