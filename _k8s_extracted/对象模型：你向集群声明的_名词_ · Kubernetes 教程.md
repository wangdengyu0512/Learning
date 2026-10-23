Chapter 01

# 对象模型：你向集群声明的"名词"

这是第一章——先建立 K8s 的对象词汇表。每个对象都是一份带 spec(期望) 与 status(实际) 的记录；下一章会揭示让它们"活起来"的控制循环。

本章要建立的判断

- Pod 为什么是最小单位，而不是容器
- Deployment / ReplicaSet / Pod 的三层托管关系
- Service 如何用 label selector 给一组易逝的 Pod 一个稳定身份
- ConfigMap/Secret、Namespace、Node 各自的边界在哪

Kubernetes 的核心心智模型只有一句话：**它是一组 level-triggered 的控制循环——你声明期望状态(spec)，控制器持续观测实际状态(status)，并把实际推向期望。**这句话贯穿整个教程。本章只负责一件事：把你"声明"时用到的**名词**讲清楚。这些名词就是 K8s 的对象(object)，而每一个对象都长成同一副骨架——一半是你写的期望，一半是系统回写的实际。控制循环本身留到第 2 章；这里先认全词汇表。

## 1.1一切皆声明式对象

在 K8s 里，你管理的一切都是一份对象记录，由 spec(期望) 与 status(实际) 两半构成。

为什么需要它

命令式运维(`启动这个进程`、`把它扩到 3 份`)把"当前该做哪一步"的判断压在人身上：执行到一半机器宕了，没人知道该从哪续。声明式把这个判断交给系统——你只写下"要 3 份运行中的副本"这个**终态**，系统自己去比对、去补齐。运维从"下达步骤"变成"维护一份期望清单"。

每个对象在底层都是 etcd 里的一条记录，结构高度统一，四个顶层字段：

对象的通用骨架yaml复制

```
apiVersion: apps/v1        # 这个对象归哪个 API 组、哪个版本管
kind: Deployment           # 对象类型(名词)
metadata:                  # 身份：名字、namespace、labels
  name: web
spec:                      # ← 期望状态：你写的部分
  replicas: 3
status:                    # ← 实际状态：系统回写的部分，你别手写
  availableReplicas: 3
```

关键在最后两块的**所有权分裂**：`spec` 由你(或上游控制器)书写，表达"想要什么"；`status` 由系统持续回写，记录"现在实际是什么"。同一份对象，被两方各写一半。当你执行 `kubectl apply -f web.yaml`，你提交的只是 `spec`——表达**意图(intent)**，而不是"先建网络、再拉镜像、再起进程"的**步骤**。集群收下这份意图，剩下的"怎么把 status 变得和 spec 一致"是它的事。

这种 `apply` 的语义带来一个直接好处：**可重复执行(幂等)**。同一份 YAML 连 `apply` 十次，结果和一次完全相同——因为你声明的是终态，不是增量操作。改一行 `replicas: 3 → 5` 再 `apply`，集群只补上差额，不会"叠加"出 8 份。

一份对象记录
stored in etcd


你 / kubectl
apply


控制器系统
controllers


写 spec


回写 status

spec = 期望(你写)
status = 实际(系统写)


图 1.1同一份对象记录被两方各写一半。**注意**：你只写 `spec`，`status` 永远是系统回写的——手动改 status 没有意义，下一章的控制循环会立刻把它覆盖回真实值。

先预测，再展开

① 如果你在 YAML 里手动填了 `status.availableReplicas: 99` 再 `apply`，集群里会真的出现 99 个副本吗？

② 同一份 `replicas: 3` 的 YAML 连续 `apply` 三次，最终有几个副本？

展开答案

① 不会。`status` 是系统的回写字段，你写进去的值会被忽略/覆盖——副本数由 `spec.replicas` 决定，而不是 status。status 描述"现实"，不是"许愿池"。

② 3 个。声明式 `apply` 提交的是终态而非增量，幂等：apply 多少次，期望都还是"3 份"，集群只维持 3 个。

## 1.2Pod — 最小调度单位

Pod 是 K8s 能调度的最小单位，是一组共享网络与存储、同生共死的容器。

为什么需要它

很多人以为 K8s 调度的是容器，其实不是。真实业务里常有"主进程 + 紧贴它的辅助进程"的组合：主容器跑应用，旁边一个 sidecar 收集日志、做服务网格代理、或定时刷新证书。这两个进程必须被**一起调度到同一台机器、共享同一个网络入口、同生共死**。容器粒度太细、表达不了这种"紧耦合的一组"，于是 K8s 在容器之上包了一层 Pod 作为调度单位。

### 底层机制：一个 pause 容器持有命名空间

同一个 Pod 内的多个容器并不是各自独立的孤岛，它们**共享三类内核命名空间(namespace)**：

- **network namespace**——共享同一个 IP 地址；容器之间可以直接经 `localhost` 互通，也共享同一套端口空间(所以同 Pod 内两个容器不能都监听 80)。
- **IPC namespace**——可通过 System V IPC / POSIX 消息队列等进程间通信原语直接通信。
- **共享 volume**——挂载同一个卷，用文件系统交换数据。

这套共享靠一个不起眼的角色实现：每个 Pod 启动时，K8s 先拉起一个几乎什么都不做的 **`pause` 容器**。它的唯一职责是**持有(hold)这些命名空间**——业务容器随后"加入"`pause` 已经建好的 network/IPC 命名空间。`pause` 是 Pod 的"锚"：业务容器可以崩溃重启，只要 `pause` 活着，Pod 的 IP 和命名空间就不变。

这就解释了那条常被背诵却少有人讲清的规则：**同一个 Pod 内的容器共享 `localhost`；不同 Pod 之间不行。**因为"共享 localhost"本质是"共享同一个 network namespace",而命名空间的边界恰好就是 Pod 的边界。

Pod
共享 IP / localhost / volume


app 容器
:8080


sidecar 容器
日志 / 代理


pause 容器
持有 network / IPC 命名空间




两个容器都加入 pause 的命名空间


图 1.2Pod 内部结构：两个业务容器加入同一个 `pause` 容器持有的命名空间。**注意**：容器共享的是 Pod 这一层的网络命名空间，而非各自独立——这正是"为什么是 Pod 不是容器"的答案。

### 情境走查：给应用配一个日志 sidecar

设想一个具体场景，逐步走一遍，留意每一步落在哪个概念上：

1. 应用容器把日志写进卷里的 `/var/log/app.log`(用到的概念：**共享 volume**)。
2. 同 Pod 里放一个 `log-shipper` sidecar，挂载**同一个卷**，读这个文件再转发到日志后端。两个容器靠文件系统交换数据,无需走网络。
3. sidecar 想确认应用是否就绪，直接请求 `http://localhost:8080/healthz`——因为同 Pod **共享 network namespace**，`localhost` 就指向旁边那个 app 容器。
4. K8s 把这两个容器作为**一个 Pod 整体**调度到某个 Node、一起启动、一起销毁(用到的概念：**Pod 作为最小调度单位、同生共死**)。

若把它们拆成两个 Pod，第 2、3 步立刻失效：卷不再共享、`localhost` 也不再指向对方。这个场景就是 Pod 这层抽象存在的全部理由。

## 1.3ReplicaSet → Deployment：三层托管

ReplicaSet 维持副本数量恒定；Deployment 管理多个 ReplicaSet 来实现滚动更新与回滚。

为什么需要它

直接管理一堆裸 Pod 没法应对两件现实：其一，Pod 会因为 Node 故障、被驱逐而消失，得有人时刻盯着"数量够不够";其二，发新版本时要平滑替换、出问题要能一键回滚。这两个职责被拆成两层——数量由 ReplicaSet 守，版本由 Deployment 编排——于是有了 Pod / ReplicaSet / Deployment 的三层托管关系。

### 底层机制：ReplicaSet 只做一件事

ReplicaSet 的职责单一到近乎乏味：**让"标签匹配它 selector 的 Pod 数量"恒等于 `spec.replicas`。多了就删、少了就建。**它不关心 Pod 里跑什么、是不是新版本——只数数。它怎么知道哪些 Pod 归它管？靠 label selector(下一节细讲)：凡是标签匹配的就算它的副本。

Deployment 在 ReplicaSet 之上加一层版本编排。**每次你修改 Pod 模板(最常见是换镜像 tag)，Deployment 就新建一个 ReplicaSet**，然后做滚动更新：

- 新 ReplicaSet 的 `replicas` 逐步 **+1 扩容**；
- 旧 ReplicaSet 的 `replicas` 同步 **逐步缩容**；
- 两条曲线一升一降，直到新 RS 满载、旧 RS 归零。

**回滚就是把这个过程反向操作**：旧 ReplicaSet 并没有被删除(只是 `replicas` 被缩到 0、留作历史),回滚时把旧 RS 重新扩容、新 RS 缩容即可。这也是为什么 `kubectl rollout undo` 能瞬间生效——目标版本的 RS 一直都在。

三层托管：一份 Deployment 同时定义了下两层yaml复制

```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3              # → 透传给它管理的 ReplicaSet
  selector:
    matchLabels:
      app: web             # ReplicaSet 用它来"认领"Pod
  template:                # ← Pod 模板：换这里的镜像 = 触发滚动更新
    metadata:
      labels:
        app: web           # 模板里盖的标签，要能被上面的 selector 选中
    spec:
      containers:
        - name: web
          image: nginx:1.25
```

承上启下

"多了删、少了建""新旧 RS 一升一降"——这些都是**持续比对期望与实际、并把实际推向期望**的动作。这正是第 2 章控制循环(reconcile loop)的预告：ReplicaSet 控制器和 Deployment 控制器各自跑着一个这样的循环。本章只需记住"谁托管谁、谁负责数量、谁负责版本";循环的运转机制下一章揭晓。

Deployment
编排版本 / 滚动更新


ReplicaSet
维持副本数恒定


管理


Pod

Pod

Pod




维持 N=3


图 1.3三层托管：Deployment ▸ ReplicaSet ▸ Pod。**注意**：换镜像时 Deployment 不会原地改这个 ReplicaSet，而是**新建一个** RS，让新旧两个 RS 一升一降——回滚就是把这一动作反向跑。

先预测，再展开

① 你把 Deployment 的镜像从 `nginx:1.25` 改成 `nginx:1.26` 并 `apply`。集群里此刻一共存在几个 ReplicaSet？

② 发现 1.26 有问题，执行 `kubectl rollout undo`。哪个对象被"重新扩容"了？

展开答案

① 通常是 2 个：旧 RS(对应 1.25,被逐步缩容直至 0)和新 RS(对应 1.26,被逐步扩容)。滚动期间两者并存；完成后旧 RS 留作历史(replicas=0),不会被立即删除。

② 旧 RS(1.25)。它一直存在、只是被缩到 0;回滚时把它重新扩容、把新 RS 缩容即可——所以回滚几乎瞬时。

## 1.4Service：给易逝的 Pod 一个稳定身份

Service 用 label selector 选中一组 Pod，对外暴露一个稳定不变的虚拟身份。

为什么需要它

Pod 是**易逝(ephemeral)**的：滚动更新会换掉整批 Pod，Node 故障会让 Pod 重建，每次重建 IP 都变。如果调用方直接记某个 Pod 的 IP，对端一重启就连不上了。需要一个"不随 Pod 生灭而改变"的稳定入口——这就是 Service。

### 底层机制：selector 圈定一组后端

Service 自己并不持有任何 Pod。它的 `spec.selector` 写一组标签条件，比如 `app: web`;K8s 在后台持续把"当前所有标签匹配的、就绪的 Pod 的 IP"维护成这个 Service 的后端集合。Pod 来了走了，后端列表自动增减，但 Service 对外暴露的那个地址**始终不变**。调用方只认 Service 的名字(如 `web`)或它的虚拟 IP,流量被自动分发到当前健在的某个 Pod 上。

Service 靠 selector 圈定后端yaml复制

```
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web            # 凡标签匹配的就绪 Pod，都成为这个 Service 的后端
  ports:
    - port: 80
      targetPort: 8080  # Service 的 80 → 转发到 Pod 的 8080
```

悬念预告

一个常见的直觉是把这个"稳定地址"想成"有一个固定 IP 的负载均衡器进程蹲在那儿"。**这个直觉在第 4 章会被颠覆**——那个所谓的"虚拟 IP"背后其实没有一个真实进程在监听，它的真相藏在每个 Node 的内核转发规则里。本章先记住它的**行为**(稳定身份 + label selector 选后端)即可，实现真相留到网络模型那章。

### 情境走查：一次滚动更新中调用方为何无感

1. 初始 3 个带 `app: web` 标签的 Pod,Service `web` 把它们作为后端。前端访问 `http://web`(用到的概念：**稳定身份**)。
2. 触发滚动更新：新 Pod 逐个起来(同样带 `app: web` 标签)、旧 Pod 逐个退出。Service 的 selector 不变，**后端集合随标签匹配关系自动刷新**(用到的概念：**label selector 动态选后端**)。
3. 整个过程里 Service 的名字和虚拟 IP 一个字没改,前端代码完全不用动——它访问的是**身份**,不是某个具体 Pod 的 IP。

## 1.5ConfigMap 与 Secret：把配置剥离镜像

ConfigMap/Secret 把配置与敏感数据从镜像里剥离，按环境变量或卷的形式注入 Pod。

为什么需要它

把数据库地址、功能开关、密钥写死进镜像，会带来两个问题：同一份镜像没法跨环境复用(dev/staging/prod 配置不同),以及改个配置就得重新构建镜像。把配置**外置**成独立对象,镜像就变成"纯代码"——同一份镜像在不同环境注入不同 ConfigMap 即可。

### 底层机制：两种注入方式

ConfigMap 存非敏感配置,Secret 存敏感数据,二者注入 Pod 的方式相同,都有两条路：

- **作为环境变量**:把键值对注入容器的 env,应用用 `os.getenv` 之类读取。
- **作为 volume 挂载**:把每个键挂成一个文件,应用读文件。改动后文件内容会更新(env 方式则需重启容器才生效)。

意料之外：Secret 默认不是加密的

这是最常被误解的一点。**Secret 默认只是 base64 *编码*,不是*加密*。**base64 是可逆的转码,任何拿到这份 Secret 的人 `base64 -d` 一下就还原出明文。这意味着：**任何能读 etcd、或对该 namespace 有 `get secret` 权限的人,都能拿到你的明文密钥。**要做到真正的"静态加密(encryption at rest)",必须额外在 API Server 上开启 `EncryptionConfiguration`(并配合 KMS 等),让数据进 etcd 前真正被加密。Secret 与 ConfigMap 的差别更多在于"访问控制 + 不进日志"的约定,而非默认就密文存储。

ConfigMap vs Secret

| 维度 | ConfigMap | Secret |
| --- | --- | --- |
| 存什么 | 非敏感配置(URL、开关、配置文件) | 敏感数据(密码、token、证书) |
| 注入方式 | env 或 volume | env 或 volume(相同) |
| 默认存储形态 | 明文 | 仅 base64 编码 — 不是加密 |
| 真正静态加密 | — | 需另开 EncryptionConfiguration |

先预测，再展开

① 一个攻击者拿到了你 etcd 的只读快照,他能不能看到 Secret 里的数据库密码?

② 仅仅把密码从 ConfigMap 挪进 Secret(不做其他配置),它在 etcd 里就变成密文了吗?

展开答案

① 默认情况下能。Secret 在 etcd 里只是 base64 编码,`base64 -d` 即还原明文。除非集群已开启 `EncryptionConfiguration` 做静态加密。

② 不会。默认仍是 base64 编码而非加密。Secret 相比 ConfigMap 的额外保护来自 RBAC 访问控制、不落普通日志等约定,而*不是*默认密文。真正密文需手动开启静态加密。

## 1.6把对象粘起来：label/selector + Namespace + Node

label/selector 做多维分组,Namespace 划作用域边界,Node 是承载 Pod 的工作机器。

为什么需要它

前面几节反复出现一个动作:"selector 选中一组 Pod"。这正是 K8s 把松散对象粘合起来的**通用机制**。它没有用"文件夹/目录"那种固定层级来组织对象,而是用 label——因为现实里一个对象往往同时属于多个维度,层级目录表达不了"既属于 A 又属于 B"。

### label/selector:多维、可重叠的分组

**label 是打在对象上的任意 `key=value` 键值对**;**selector 是一组标签条件**,用来"选出标签匹配的对象"。关键在于它是**多维、可重叠**的,而非单一层级:同一个 Pod 可以*同时*带上 `app=web`、`tier=frontend`、`env=prod` 三个标签,于是它同时落入三个不同维度的分组。一个 Service 的 selector 写 `tier=frontend` 能选中它,另一个监控规则写 `env=prod` 也能选中它——同一个 Pod,被不同 selector 从不同角度反复圈选。

这和你熟悉的"一个文件只能在一个目录里"截然不同。label 让分组从"树形归属"升级为"多维标记",这正是 Deployment 认领 Pod、Service 选后端、监控筛选目标——全都复用同一套机制的原因。

### Namespace:作用域 / 租户边界

**Namespace 是对象名字的作用域边界。**同一个 Namespace 内对象名字唯一;不同 Namespace 之间可以重名(`team-a/web` 与 `team-b/web` 互不冲突)。它常用来做多团队/多环境的软隔离,也是 RBAC 权限和资源配额的作用单位。不指定时,对象落进名为 `default` 的 Namespace。注意:**Namespace 是逻辑边界,不是物理隔离**——不同 Namespace 的 Pod 默认仍可经网络互通(网络层面的隔离要靠后面章节的 NetworkPolicy)。

### Node:运行 Pod 的工作机器

**Node 是真正跑 Pod 的工作机器**(物理机或虚拟机)。前面所有逻辑对象——Pod、ReplicaSet、Service——最终都要落到某个 Node 上运行。Node 自身也是一个对象:它的 `status` 持续上报这台机器的 CPU/内存容量、健康状况等,供调度决策使用。"哪个 Pod 该放到哪个 Node"是第 3 章调度的主题,本章只需把 Node 定位成"对象模型的物理落脚点"。

一句话归位

label/selector 是**黏合剂**(对象之间靠它互相选中),Namespace 是**围栏**(名字与权限的作用域),Node 是**地面**(逻辑对象最终落地运行的机器)。本章的所有名词都靠这三者组织、隔离、落地。

## 自测:三个原子问题

1. 一个对象的 `spec` 和 `status` 分别由谁书写?手动修改 `status` 会发生什么?
2. Service 自己持有 Pod 吗?它是靠什么把流量送到正确的一组 Pod 上的?
3. (设计层)为什么 K8s 的最小调度单位是 Pod 而不是容器?

展开参考答案

**1.** `spec` 由你(或上游控制器)书写,表达期望;`status` 由系统持续回写,反映实际。手动改 `status` 没有意义——它会被控制器按真实情况覆盖回去。

**2.** 不持有。Service 靠 `spec.selector` 的 label 条件,动态选中"当前标签匹配且就绪"的一组 Pod 作为后端;Pod 生灭时后端集合自动更新,而 Service 的稳定身份不变。

**3.** 因为 sidecar/紧耦合辅助进程需要被**一起调度到同一台机器、共享网络与存储、同生共死**。容器粒度太细,表达不了"必须绑在一起的一组进程";Pod 这层抽象正是为承载这种紧耦合关系而存在,所以调度以 Pod 为单位。

进阶 · 刚好够不着

### 手动删掉一个 Pod,几秒后会怎样?

一个 Deployment 设了 `replicas: 3`。你执行 `kubectl delete pod <其中一个>` 删掉 3 个里的 1 个。几秒后集群里发生了什么?**是哪个对象在起作用**?

提示(不给全答)

回想 §1.3:三层里哪一层的职责是"让标签匹配的 Pod 数量恒等于 replicas、多了删少了建"?现在标签匹配的 Pod 从 3 掉到了 2,这一层观测到"实际 < 期望",会怎么做?注意:动手的不是 Deployment 本身,而是它管理的那一层。至于这层"如何持续观测并触发动作"的运转细节——那是第 2 章控制循环的正题。

### 延伸阅读

- [Pods — Kubernetes 官方文档](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Deployments — Kubernetes 官方文档](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Service — Kubernetes 官方文档](https://kubernetes.io/docs/concepts/services-networking/service/)
- [Secrets — Kubernetes 官方文档(含 base64 说明)](https://kubernetes.io/docs/concepts/configuration/secret/)


[← 上一章
00 · 起点](https://zhiwenliang.github.io/learning/kubernetes/index.html)
[下一章 →
02 · 控制循环](https://zhiwenliang.github.io/learning/kubernetes/02-control-loop.html)