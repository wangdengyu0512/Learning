Chapter 04

# 网络模型：扁平网络与 Service 的真相

上一章讲 Pod 如何落到 Node。落地之后，Pod 之间、Pod 与外界如何通信？答案里藏着一个反直觉的真相：Service 的 ClusterIP 根本不是一块网卡。

前三章建立的主线是：Kubernetes 是一组 level-triggered 控制循环，每个控制器盯着期望状态、不断把现实拉过去。本章引入又一个控制器——**kube-proxy**。它 watch Service 与 EndpointSlice 这两类对象，把它们 reconcile 成节点内核里的一组路由规则。这条主线在本章收口于一个让人愣住的事实：一个 Service 的 **ClusterIP 不是任何真实接口**，它只是 kube-proxy 写进内核的一组 DNAT 规则。把这一点想透，「后端 Pod 挂了为什么不是连接被拒」「为什么 ping 不通 ClusterIP 却能 curl 通」这些怪象全都变成直接推论。

本章你将建立的 schema

- **扁平网络公理**——每个 Pod 拿到一个独立、可路由的 IP，Pod 间通信*不经 NAT*，节点上的 agent 能直达所有 Pod。
- **Service = 稳定虚拟身份**——用 label selector 选中一组易逝的 Pod，控制器维护一份 EndpointSlice（就绪 Pod 的 IP 列表）。
- **ClusterIP 的真相**——它不是接口、没有进程监听，是 kube-proxy 写进内核的 DNAT 规则；发往它的包在内核被改写目标地址、转发到某个后端 Pod。
- **kube-proxy 三种模式**——iptables（当前默认）、IPVS（大规模、已在 1.35 弃用）、nftables（1.33 起 stable，尚未成为默认）。
- **暴露方式分工**——ClusterIP / NodePort / LoadBalancer 是三类 Service；Ingress 是 L7 入口，*不是*一种 Service 类型，而是 Service 之上的一层。

## §4.1扁平网络公理：每个 Pod 一个可路由 IP

Kubernetes 的网络模型只有三条公理：每个 Pod 一个独立可路由 IP、Pod 间通信不做 NAT、节点 agent 能直达每个 Pod。

为什么需要它

Docker 单机时代的网络靠端口映射：容器躲在宿主机的 NAT 后面，外界要访问就把宿主机的某个端口转发进去。一台机器跑几个容器还行，可一旦放到集群、跑成千上万个容器，这个模型立刻崩。端口是有限的（一台机 65535 个），多个容器抢同一个常用端口会冲突，得引入一张全局端口账本去记「哪个容器占了宿主机哪个端口」；更糟的是 NAT 会改写源地址——服务收到的连接都来自宿主机 IP，*真实来源被抹掉*，依赖源 IP 的日志、ACL、限流统统失灵。扁平网络就是为了一次性绕开这一整类问题：让每个 Pod 像一台拥有自己 IP 的小 VM。

扁平网络模型把上面的痛点用三条硬性约束消解掉：

- **每个 Pod 拿到自己独立、可路由的 IP。**这个 IP 在整个集群范围内唯一，Pod 内的容器共享它（同一个网络命名空间）。Pod 用*标准端口*对外提供服务——一个 Web 应用就监听 80，不必为了避让别人而改成 8081、8082。端口冲突这个问题从根上不存在了。
- **Pod 与 Pod 之间直接通信，全程不做 NAT。**Pod-A 发给 Pod-B 的包，到达 B 时源地址*仍然是 A 的 Pod IP*，没有被任何中间环节改写。源 IP 被完整保留，日志记得到真实来源、ACL 能按来源放行、限流能按来源计数。
- **节点上的 agent（如 kubelet、kube-proxy）能直达所有 Pod。**这条保证了健康检查、流量转发这些跨节点的控制动作不需要额外的隧道穿透。

Node 1


Pod A
10.1.1.7

Pod
10.1.1.8

Pod
10.1.1.9


Node 2


Pod B
10.2.3.4

Pod
10.2.3.5

Pod
10.2.3.6


无 NAT
源 IP 不变

每个 Pod 一个可路由 IP · 彼此直达 · 无宿主机端口映射


图 4.1跨节点的 Pod 直连。Pod A（10.1.1.7）发给 Pod B（10.2.3.4）的包直接送达，不经任何端口映射或地址转换。**注意**：每个 Pod 都持有集群内可路由的 IP，彼此直达——没有 Docker 单机那种「容器藏在宿主机端口背后」的映射层，到达 B 时源 IP 仍是 A 的 Pod IP。

**代价（比文档深一层）。** 这三条公理是 Kubernetes *提出的要求*，而不是它自己实现的能力。「让任意两个 Pod 跨节点直连、还不做 NAT」在物理上并不免费——不同节点上的 Pod IP 段如何互通、谁来分配不冲突的 Pod IP、跨节点的包走 overlay 隧道还是直接路由，这些全部被**推给 CNI（Container Network Interface）插件层**去解决。Flannel、Calico、Cilium 等插件各有实现：有的用 VXLAN 之类的 overlay 把 Pod 网络封装进隧道，有的依赖底层网络可路由而直接下发路由表，IPAM（IP 地址管理）也由它们负责。Kubernetes 核心只规定「结果必须满足三条公理」，把「怎么做到」连同全部复杂度外包给了 CNI。这也是为什么换一个 CNI 插件，集群的网络性能和可观测性会有显著差异。

## §4.2Service：易逝 Pod 之上的稳定虚拟身份

Pod 随时会被重建、IP 随之改变；Service 用 label selector 给一组 Pod 一个永不变的虚拟身份，背后由 EndpointSlice 维护当前就绪的 Pod IP 列表。

为什么需要它

扁平网络给了每个 Pod 一个 IP，但 Pod 是*易逝的*：滚动更新、崩溃重启、被调度器驱逐，每一次都会换一批 Pod、换一批 IP。如果调用方把后端 Pod 的 IP 写死，对端一重建就连不上了。需要一层间接——一个*稳定的*名字和 IP，把「这组提供某能力的 Pod」抽象出来，无论底下的 Pod 怎么换，前端始终对着这个稳定身份说话。Service 就是这层间接。

Service 的工作方式是一条小型控制循环。Service 对象上写着一个 **label selector**，比如 `app=web`。控制平面里的 EndpointSlice 控制器持续 watch 所有 Pod，把*同时满足两个条件*的 Pod 的 IP 收集起来：① 它的 label 匹配 selector，② 它已经**就绪（Ready）**。这份「当前就绪 Pod 的 IP 列表」被写进一个或多个 **EndpointSlice** 对象。Pod 增减、就绪状态变化，控制器就更新 EndpointSlice——又是一个 level-triggered 的 reconcile。

**回扣第 2 章。** 第 2 章讲过 readiness 探针决定一个 Pod 是否「准备好接收流量」。这里就是它的兑现点：当一个 Pod 的 **readiness 探针失败**，控制器立刻把它的 IP 从 EndpointSlice 里**摘掉**；流量于是不再被导向这个 Pod。探针恢复成功，IP 再被加回去。Service 看上去稳定不变，底下的 EndpointSlice 却在随 Pod 的就绪状态实时增删——这正是「稳定虚拟身份」与「易逝后端」之间的那层缓冲。

把概念钉死

Service 与 EndpointSlice 是*两个分工明确*的对象，别混成一个。Service 持有「身份」——稳定的名字、稳定的 ClusterIP、selector 规则；EndpointSlice 持有「当前现实」——此刻就绪的那批 Pod IP。Service 几乎从不变，EndpointSlice 随 Pod 起落不断变。下一节的 kube-proxy 正是同时 watch 这两者：从 Service 拿到「虚拟 IP 是多少」，从 EndpointSlice 拿到「该转发到哪些真实 IP」。

## §4.3ClusterIP 的真相：内核里的一组 DNAT 规则

ClusterIP 上没有任何进程在监听、也没有对应的网卡；它是 kube-proxy 写进内核的一组 DNAT 规则，发往它的包在内核被改写目标地址、转发到某个后端 Pod。

为什么需要它

§4.2 给了 Service 一个稳定的 ClusterIP，但留了一个没回答的问题：当一个包发往这个 IP，*谁*来接、*怎么*送到后端 Pod？最自然的猜测是「ClusterIP 上跑着一个代理进程，它收下连接再转发」。这个猜测错了，而且错得很关键——理解它的真实机制，是本章的高潮，也是解释一连串怪象的钥匙。

真相是：**ClusterIP 上什么都没有**。没有进程 `bind` 在那个地址和端口上，集群里也*没有任何一块网卡*配着这个 IP。它纯粹是一个被登记在册的虚拟地址（从 Service CIDR 段里分配，详见官方的 ClusterIP allocation 文档）。真正让它「能用」的，是 **kube-proxy** 这个运行在*每个节点*上的控制器所做的事：它同时 watch Service（拿到 ClusterIP）和 EndpointSlice（拿到当前就绪的后端 Pod IP 列表），然后把一组形如「目标地址 = ClusterIP 的包，把目标地址**改写**成某个后端 Pod IP」的规则，写进节点的内核（iptables / IPVS / nftables，见 §4.4）。这种「改写目标地址」的操作叫 **DNAT（Destination NAT，目标地址转换）**。

于是一次「访问 ClusterIP」的真实经过是这样：你的 client Pod 发出一个目标地址为 ClusterIP（比如 `10.96.0.10`）的包；这个包在*本节点的内核协议栈里*撞上 kube-proxy 写的 DNAT 规则；内核当场把目标地址改写成某个后端 Pod 的真实 IP（比如 `10.1.1.7`），再按扁平网络把它路由过去。整个转发*发生在内核里、对应用透明*，没有用户态代理进程参与转包。

client Pod
curl ClusterIP


dst=10.96.0.10


内核 DNAT 规则
kube-proxy 写入
iptables / IPVS
改写 dst → Pod IP


后端 Pod
10.1.1.7

后端 Pod
10.1.1.8

后端 Pod
10.1.1.9




选中一个

ClusterIP 上无人 listen · 无对应网卡 · 它就是这组转发规则


图 4.2访问 ClusterIP 的真实路径。包发往 `10.96.0.10`，在内核里被 kube-proxy 写的 DNAT 规则改写目标地址，转发到三个就绪后端之一。**注意**：没有任何东西在 ClusterIP 上 `listen`，集群里也没有配着这个 IP 的网卡——ClusterIP 纯粹是内核里的一组转发规则，不是一个能被连接的实体。

**推论（这才是真正有用的部分）。** 一旦接受「ClusterIP = 内核里的转发规则」，几个原本费解的现象立刻就说得通了：

- **后端 Pod 挂了，不是「在 ClusterIP 上连接被拒」。**因为 ClusterIP 上本来就没人 listen，根本不存在「在 VIP 上接受或拒绝连接」这回事。后端不可用时发生的是另两种情况之一：要么 EndpointSlice 已经把坏 IP 摘掉、DNAT 规则随之更新，包被转给一个健康的后端；要么摘除还没完成、规则仍指向那个坏 IP，于是包被 DNAT 到一个*已经死掉的 Pod IP*——表现为连接超时或被那个 IP 拒绝，而*不是*「ClusterIP 拒绝了你」。错在过期的规则或选中了坏 IP，不在 VIP 本身。
- **ping ClusterIP 往往不通，curl 却通。**DNAT 规则通常只对特定协议和端口（TCP/UDP 的 Service 端口）生效；ICMP（ping 用的）没有对应规则，于是 ping 一个「不存在的接口」自然没有回应，而走 Service 端口的 TCP 连接却能被规则正确改写转发。

陷阱 · 把 ClusterIP 当成一台「机器」

新手常把 ClusterIP 想象成「Service 那台代理机的 IP」，于是去 ping 它、去 ClusterIP 上抓包找监听进程、把后端故障误读成「Service 宕了」。**失败模式**：基于这个错误心智去排障，方向全错。正确的心智是——ClusterIP 是一个*规则的入口地址*，排障要去看两样东西：EndpointSlice 里此刻有没有健康的后端 IP，以及节点上 kube-proxy 写的转发规则是否最新（§4.4 会讲它由哪种模式落地）。

## §4.4kube-proxy 三种模式：规则用什么写进内核

同一套「ClusterIP → 后端 Pod IP」的转发语义，kube-proxy 可以用 iptables、IPVS 或 nftables 三种内核机制落地；当前默认仍是 iptables。

为什么需要它

§4.3 说 kube-proxy 把转发规则「写进内核」，但内核提供不止一种写规则的机制，它们在*规则数量随 Service 增长时的性能*上差异巨大。一个几千 Service 的大集群，用错机制会让规则匹配从 O(1) 退化成线性扫描，每个新连接的建立都被拖慢。理解三种模式的取舍，是给集群选对数据面的前提；而它们各自的成熟度和默认状态*正在变化*，记住时效尤其重要。

三种模式实现的转发语义完全一致——区别只在用哪种内核子系统去承载那些规则，以及随规则规模增长的性能曲线：

kube-proxy 三种模式 + eBPF 路线（时效：截至 Kubernetes 1.33–1.35）

| 模式 | 内核机制 | 大规模表现 | 当前状态 |
| --- | --- | --- | --- |
| iptables | iptables 规则链（基于 netfilter） | 规则随 Service 数线性增长，超大集群下匹配与更新变慢 | 当前**默认**，成熟、兼容性最广 |
| IPVS | 内核 IPVS（L4 负载均衡，哈希表） | 规则查找接近 O(1)，适合大规模 Service | 已在 **1.35 弃用**，新部署不应再选它 |
| nftables | nftables（netfilter 的现代继任者） | 更新与匹配比 iptables 高效，面向大规模 | **1.33 起 stable**，但*尚未成为默认* |
| eBPF（Cilium 等） | eBPF 程序挂载到内核钩子 | 可绕开 iptables/nftables 规则链，高性能、强可观测 | 由 CNI 提供，**整体替换** kube-proxy |

表里最容易记错时效的是后两行。**IPVS 曾是大规模集群的推荐项**，但它已经在 1.35 被弃用——如果凭旧印象「大集群就上 IPVS」，会选到一条正在退场的路。**nftables 已在 1.33 转正为 stable**，它是 iptables 的现代继任者、为大规模而生，但*默认模式仍然是 iptables*，要用 nftables 得显式配置。这两点合起来意味着：当下默认仍是 iptables，nftables 是经过深思熟虑后值得切换的现代选项，而 IPVS 不再是新部署的候选。

表的最后一行是另一条路线：**eBPF**（以 Cilium 为代表）。它不是 kube-proxy 的一种模式，而是用 eBPF 程序直接在内核钩子上实现 Service 转发，从而*整体替换掉 kube-proxy*，绕开 iptables/nftables 的规则链，换取更高性能和更强的网络可观测性。这条路线属于 CNI 的能力范畴，第 6 章会再展开。

预测一下

一个集群从几十个 Service 扩到上万个 Service，数据面用的是 iptables 模式。随着 Service 增多，新连接建立的延迟和 kube-proxy 同步规则的耗时为什么会变差？换成 nftables 会从哪里得到缓解？

展开答案

**iptables 的规则是组织成链、按顺序匹配的**，Service（及其后端）越多，链越长，一个包要匹配到对应规则平均扫过的规则数就越多，新连接建立因此变慢；同时每次 EndpointSlice 变动，kube-proxy 往往要重算并下发一大片规则，规模越大这次同步越慢，规则收敛有可见延迟。**nftables 用更高效的数据结构组织规则、支持增量更新**，匹配不再是长链顺序扫描、变更也不必整片重写，因此在大规模下匹配延迟和同步耗时都明显优于 iptables——这正是它被引入并转正的动机。**结论**：默认的 iptables 在中小规模够用，超大规模 Service 场景下 nftables 是更合身的现代选择（IPVS 虽也解决规模问题，但已弃用，不再推荐）。

## §4.5服务发现：CoreDNS 把名字解析到 ClusterIP

CoreDNS 把 `service.namespace.svc.cluster.local` 解析到对应 Service 的 ClusterIP；跨 namespace 访问必须用完整域名（FQDN）。

为什么需要它

ClusterIP 虽稳定，但仍是一串数字、且在 Service 创建时才分配。应用不该把 ClusterIP 写死在配置里——需要一个*名字*层：用人能读、跨环境不变的名字去找 Service，由集群在运行时把名字解析成当前的 ClusterIP。这就是集群内 DNS 服务发现，承担者是 **CoreDNS**。

每个 Service 在集群 DNS 里都有一条记录，遵循固定格式：`<service>.<namespace>.svc.cluster.local`。CoreDNS 把这个名字解析成该 Service 的 ClusterIP——于是应用只要 `curl http://web.default.svc.cluster.local`，解析得到 ClusterIP，包再交给 §4.3 的 DNAT 规则转发到后端。名字这一层把「找到 Service」和「ClusterIP 具体是多少」彻底解耦。

有一条规则常被忽略、却是后面那个经典陷阱的根源：**跨 namespace 访问必须带上 namespace（用 FQDN）。** 同 namespace 内可以只写短名 `web`（DNS 搜索域会自动补全成本 namespace 下的 FQDN）；但要访问*另一个* namespace 里的 Service，短名补全不到那边去，必须显式写成 `web.other-ns` 或完整的 `web.other-ns.svc.cluster.local`。少写了 namespace，解析会落到本 namespace（本 namespace 下往往并没有那个 Service）而失败。

## §4.6暴露方式分工：ClusterIP / NodePort / LoadBalancer / Ingress

三类 Service（ClusterIP、NodePort、LoadBalancer）解决「从哪一层把流量送进来」；Ingress 是 Service 之上的 L7 路由层，按 host/path 把多个服务收敛到一个入口——它不是一种 Service 类型。

为什么需要它

前面讲的 ClusterIP 只在集群*内部*可达。但很多服务要被集群*外*的客户端访问——浏览器、移动端、外部系统。Kubernetes 提供了几种由内到外、层层加码的暴露方式；它们解决的问题不同、代价也不同，选错会直接体现在云账单和架构复杂度上。最容易混淆的是 Ingress 与三类 Service 的关系，必须厘清。

四种暴露方式，按「触达范围」从内到外排列；前三种是 Service 的 `type`，第四种是另一个维度的对象：

四种暴露方式：层级、触达范围与代价

| 方式 | 是什么 | 触达范围 | 典型代价 / 适用 |
| --- | --- | --- | --- |
| ClusterIP | Service 默认 type | 仅集群内部 | 内部服务间调用，零外部暴露 |
| NodePort | Service type | 每个节点上开一个端口（30000–32767） | 从任一节点 IP:端口进入；端口范围受限、不适合直接对公网 |
| LoadBalancer | Service type | 云厂商为*每个*该类 Service 分配一个外部 L4 IP | L4 直达；**按服务计费**，服务一多账单陡增 |
| Ingress | Service 之上的 L7 层（*非* Service 类型） | 一个入口，按 host/path 路由到多个后端 Service | HTTP 多服务收敛到单一入口，省外部 IP |

前三行是一条递进的链：**ClusterIP** 把服务限制在集群内；**NodePort** 在每个节点上开一个高位端口，外部用「任一节点 IP + 该端口」即可进来，但端口范围有限、直接暴露给公网不优雅；**LoadBalancer** 让云厂商为这个 Service 分配一个外部 L4 IP（并通常在背后接到各节点的 NodePort），客户端直接访问这个 IP。LoadBalancer 最省心，但有个关键代价——**云厂商通常按「每个 LoadBalancer」计费**，每多一个这类 Service 就多一个外部负载均衡器、多一笔账。

第四行的 **Ingress** 是另一回事，也是最常被误解的一处：**它不是一种 Service 类型**。它是 Service *之上*的一层 **L7（HTTP 层）路由**，由一个 Ingress Controller（如 nginx-ingress）实现。Ingress 的价值在于*收敛*：用一个外部入口（通常背后只接*一个* LoadBalancer），按请求的 **host**（域名）和 **path**（路径）把流量分发到背后*多个*不同的 Service。`api.example.com` 路由到 api Service，`shop.example.com/cart` 路由到 cart Service——全部共用同一个入口地址和同一个外部负载均衡器。

L7

L4 / type


Ingress (L7)
按 host / path 路由


Service A
ClusterIP

Service B
ClusterIP

Service C
ClusterIP




/api
/shop
/admin


NodePort：每节点开端口（30000–32767）

LoadBalancer：每服务一个外部 L4 IP
一个入口 · 扇出到多个 Service


图 4.3暴露方式分层。上层的 Ingress（L7）按 host/path 把一个入口的流量扇出到多个 ClusterIP Service；NodePort、LoadBalancer 则是 Service 自身的 type，是另一维度的 L4 入口方式。**注意**：Ingress 不是一种 Service 类型，而是 Service 之上的 L7 入口，把多个 Service 收敛到一个地址——它和 NodePort/LoadBalancer 不在同一层、不互相替代。

陷阱 · 给每个服务都开 LoadBalancer

把每一个需要对外的 HTTP 服务都设成 `type: LoadBalancer`，是云上最常见的烧钱姿势。**失败模式**：云厂商按「每个 LoadBalancer」计费，二十个对外服务就是二十个外部负载均衡器、二十笔费用，账单线性膨胀。**正解**：HTTP 类的多个服务应当走 **Ingress**——背后只用一个 LoadBalancer，由 Ingress Controller 按 host/path 分发到各 Service，外部 IP 与负载均衡器的数量从 N 降到 1。LoadBalancer 留给少数真正需要独立 L4 入口、或非 HTTP 协议的场景。

陷阱 · 「docker-compose 能跑、K8s 不行」

从 docker-compose 迁过来的应用，常把对端地址写成 `localhost`（或 `127.0.0.1`），以为这样能连到「同一组里的兄弟容器」。在 Kubernetes 里这会失败。**失败模式**：在 Pod 里，`localhost` 指的是*本 Pod*（同 Pod 内多个容器共享网络命名空间），它*到不了*另一个 Pod；compose 里那种「服务名即可互联」的便利，在 K8s 里不是默认提供的。**正解**：要访问别的 Pod，必须为目标显式建一个 Service，然后用它的 DNS 名访问（同 namespace 用短名 `db`，*跨 namespace 必须用 FQDN* `db.other-ns.svc.cluster.local`，见 §4.5）。把 `localhost` 改成 Service 的 DNS 名，是这类迁移的关键一步。

动手画一遍

不看本章，在纸上画出「一个 client Pod 访问某 Service 的 ClusterIP」的完整路径：从发包、到内核 DNAT 规则、到选中某个后端 Pod IP。画完翻回图 4.2 对照——你把「改写目标地址」这一步画在了哪里？是画成了一台独立的代理机，还是画成了内核里的一条规则？这个区别正是本章的高潮。

## 自测

1. 扁平网络的三条公理分别是什么？**为什么 Kubernetes 选扁平网络、而不是 Docker 单机那种端口映射？**（从端口记账、冲突、NAT 抹掉源 IP 三方面答）
2. Service 和 EndpointSlice 各持有什么？一个 Pod 的 readiness 探针失败时，这两个对象里会发生什么变化？
3. 「ClusterIP 上没有任何进程在监听」这句话为什么成立？由它可以直接推出「后端挂了不是在 ClusterIP 上连接被拒」——把这条推理补全。
4. kube-proxy 当前默认是哪种模式？IPVS 与 nftables 各自的*当前状态*是什么（哪个已弃用、哪个 stable 但未默认）？

查看参考答案

**1.** 三条公理：每个 Pod 一个独立可路由 IP；Pod 间通信不做 NAT；节点 agent 能直达所有 Pod。选它而非端口映射的原因——端口映射要为每个容器在宿主机上记一笔端口账（一台机仅 65535 个端口，规模大了记账与冲突都失控），常用端口还会被多个容器抢占；更要命的是 NAT 改写源地址、*抹掉真实来源 IP*，让依赖源 IP 的日志、ACL、限流全部失效。扁平网络让每个 Pod 像一台有自己 IP 的小 VM、用标准端口、保留源 IP，从根上消解这三类问题（代价是把实现复杂度推给 CNI 层）。

**2.** Service 持有「稳定身份」：名字、ClusterIP、label selector；EndpointSlice 持有「当前现实」：此刻 label 匹配*且就绪*的那批 Pod IP。某 Pod 的 readiness 探针失败时，Service 本身*不变*，但控制器把该 Pod 的 IP 从 EndpointSlice 中**摘掉**，kube-proxy 随之更新转发规则、不再把流量导向它；探针恢复后 IP 被加回。

**3.** 成立，是因为 ClusterIP 只是从 Service CIDR 分配的一个虚拟地址，集群里*没有任何网卡配着它*、也没有进程 `bind` 在它上面——它的「可用」完全来自 kube-proxy 写进内核的 DNAT 规则。推理补全：既然没人在 ClusterIP 上 listen，就不存在「在该地址上接受/拒绝连接」这一动作；后端不可用时，要么 EndpointSlice 已摘除坏 IP、规则把包转给健康后端，要么摘除尚未完成、规则把包 DNAT 到一个已死的*Pod IP*，表现为连接超时或*那个 Pod IP* 拒绝——错在过期规则或选中坏 IP，而非「ClusterIP 拒绝了连接」。

**4.** 当前默认是 **iptables**。IPVS 已在 **1.35 弃用**，新部署不应再选；nftables 自 **1.33 起 stable**，是面向大规模的现代选项，但*尚未成为默认*，需显式配置。此外 eBPF（Cilium）走的是整体替换 kube-proxy 的另一条路线。

进阶挑战

### curl 一个 ClusterIP，背后 3 个后端 Pod 刚崩了 1 个，会发生什么？

一个 Service 背后有 3 个就绪后端 Pod，转发规则会把发往 ClusterIP 的连接分散到这 3 个。此刻其中 1 个 Pod 刚刚崩溃。你对着 ClusterIP 发起 `curl`，会看到什么结果？**为什么这不是「在 ClusterIP 上连接被拒」？** 想清楚后再展开提示。

提示

关键是两条时间线的*错位*。其一，崩溃的 Pod 要被从 EndpointSlice 摘除、kube-proxy 再据此更新内核里的 DNAT 规则——这需要时间（探测到不就绪、控制器更新 EndpointSlice、各节点 kube-proxy 同步规则）。其二，你的 `curl` 可能正好落在这段时间差里。

于是有两种结局：**(a) 摘除已完成**——DNAT 规则只剩 2 个健康 IP，连接被转给其中一个，`curl` 正常成功。**(b) 摘除尚未完成**——规则仍把这次连接 DNAT 到那个已死的 Pod IP，`curl` 表现为连接超时，或被那个 IP 所在节点回以拒绝。注意结局 (b) 里被拒/超时的是*那个具体的后端 Pod IP*，**不是 ClusterIP**——因为 ClusterIP 上从来没人 listen，它只是把你的包改写转发出去的规则入口。重试一次，落到健康后端的概率就回来了。把这条因果链和 §4.2 的「readiness 失败 → 摘除 EndpointSlice」、§4.3 的「ClusterIP = DNAT 规则」对上，整章就闭合了。

### 参考资料

- [Kubernetes Docs · Service](https://kubernetes.io/docs/concepts/services-networking/service/)（Service 类型、selector 与 EndpointSlice、kube-proxy 模式的官方说明）
- [Kubernetes Docs · Service ClusterIP allocation](https://kubernetes.io/docs/concepts/services-networking/cluster-ip-allocation/)（ClusterIP 如何从 Service CIDR 分配的权威细节）
- [k8s.guide · Kubernetes 扁平网络、CNI 与 Ingress](https://www.k8s.guide/insights/opinion/2026-03-12-kubernetes-flat-network-cni-ingress/)（扁平网络为何这样设计、CNI 与 Ingress 的分工）
- [Robusta · Service vs LoadBalancer vs Ingress](https://home.robusta.dev/blog/kubernetes-service-vs-loadbalancer-vs-ingress)（三者分工与选型代价的实务对比）

[← 上一章
03 · 调度与资源](https://zhiwenliang.github.io/learning/kubernetes/03-scheduling.html)
[下一章 →
05 · 存储与状态](https://zhiwenliang.github.io/learning/kubernetes/05-storage-state.html)