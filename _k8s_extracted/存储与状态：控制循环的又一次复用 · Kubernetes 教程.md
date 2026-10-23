Chapter 05

# 存储与状态：控制循环的又一次复用

前几章的对象大多无状态、可替换。这一章讲 K8s 如何处理配置与持久状态——你会看到核心模式仍是第 2 章的控制循环，只是换了主角: PVC 是期望、PV 是供给，又一个 reconcile 把它们绑在一起。

本章脉络

- ConfigMap/Secret 改了为什么不会自动生效
- PV(供给) / PVC(申领) 的绑定就是一次 reconcile
- StorageClass 与动态供给
- StatefulSet 给 Pod 稳定身份，Deployment 不行
- 用 Deployment 跑有状态应用为什么会出事

第 2 章给出了贯穿全书的那把钥匙: Kubernetes 是一组 **level-triggered 的控制循环**——每个控制器读取「期望状态」与「实际状态」，算出差异，朝期望收敛(reconcile)，然后再读一遍。无状态对象(Deployment/ReplicaSet/Pod)是这套机制最干净的展示场。本章把同一把钥匙插进一把看似不同的锁: **配置注入**与**持久存储**。结论先摆出来——存储并不是另起炉灶的新机制，PVC 与 PV 的绑定*本身就是又一个 reconcile 循环*。把这一点看穿，本章的大半内容就只是第 2 章的换皮复述。

## 5.1配置注入与「改了不生效」的失败模式

ConfigMap/Secret 把配置从镜像里剥离出来，通过环境变量或挂载卷注入容器；但注入方式决定了它改了之后会不会生效。

为什么需要它

把数据库地址、日志级别、密钥直接烤进镜像，意味着每改一个值就要重新构建、重新推送镜像，且同一镜像无法跨环境复用。ConfigMap(明文配置) 与 Secret(敏感数据，base64 编码 + 可选静态加密) 把这些值抽成独立对象，让镜像保持环境无关。注入有两条路: 写进容器的**环境变量**，或挂成一个**卷**，把每个 key 变成一个文件。

两种注入方式的代码形态如下——同一个 ConfigMap，既可以摊平成环境变量，也可以挂成目录里的文件。

configmap-inject.yaml
yaml
复制

```
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: "info"
  config.yaml: |
    server:
      timeout: 30s
---
apiVersion: v1
kind: Pod
metadata:
  name: web
spec:
  containers:
    - name: app
      image: myapp:1.0
      env:                          # 路线 A：注成环境变量
        - name: LOG_LEVEL
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: LOG_LEVEL
      volumeMounts:                 # 路线 B：挂成卷（文件）
        - name: cfg
          mountPath: /etc/app
  volumes:
    - name: cfg
      configMap:
        name: app-config
```

差别在于**生效时机**，而这正是第 2 章控制循环视角能一眼看穿的地方。

**环境变量在容器启动那一刻只读一次。** kubelet 创建容器时把 `LOG_LEVEL` 的值固化进进程环境，此后这个值就是进程内存里的一个常量。现在去 `kubectl edit configmap app-config` 把它改成 `debug`——什么都不会发生。关键在于: 改 ConfigMap **没有改动任何 Pod 的 spec 字段**。Deployment 控制器盯的是 Pod 模板的 spec，spec 没变，diff 为空,reconcile 认为「实际已等于期望」,于是不滚动、不重建 Pod。运行中的容器里那个环境变量,纹丝不动。

**挂载成卷的 key 文件*会*更新**——但只更新到一半。kubelet 有一个周期性的同步循环，会把 ConfigMap 的新内容刷新到挂载卷的文件里(通过原子替换符号链接，存在最长约一分钟的传播延迟)。所以 `/etc/app/config.yaml` 的*文件内容*确实变了。可应用进程通常是在启动时把配置文件读进内存就不再回看——文件变了，进程内的配置没变。除非应用自己实现了 watch/inotify 或 SIGHUP 重载，否则新值同样躺在磁盘上睡大觉。

失败模式 · 改了 ConfigMap 却不生效

改完 ConfigMap/Secret 后,运行中的 Pod 行为不变,日志级别还是旧的。根因不是「同步太慢」,而是**这次修改根本没触动 reconcile**: 控制器只对 *Pod spec 的变化*做出反应,而改 ConfigMap 不改 Pod spec→diff 为空→不滚动。三种修复(按显式程度排序): ① `kubectl rollout restart deployment/web` 强制滚动一轮,让新 Pod 在启动时读到新值; ② 在 Pod 模板里加一个内容哈希注解(如 `checksum/config: <sha256>`),配置一变哈希就变→Pod spec 真的变了→*自动*触发滚动; ③ 部署 [Reloader](https://github.com/stakater/Reloader) 这类控制器,它 watch ConfigMap/Secret 并自动给关联工作负载打滚动。三者的共同本质都是「制造一个 spec 变化让控制循环重新跑」。

方案 ② 的哈希注解值得单独点出,因为它把失败模式的成因直接翻译成了修复手段: 既然 reconcile 只认 spec 变化,那就让配置的内容参与到 spec 里去。

checksum-annotation.yaml
yaml
复制

```
spec:
  template:
    metadata:
      annotations:
        # 配置内容的哈希；ConfigMap 一改，这个值就变，
        # Pod 模板的 spec 随之改变 → 自动触发滚动更新
        checksum/config: "5d41402abc4b2a76b9719d911017c592"
```

预测一下

一个 Secret 同时被「环境变量」和「挂载卷」两种方式注入同一个容器。你更新了这个 Secret。容器里通过这两条路径看到的值,会出现什么不一致?

展开答案

环境变量路径: 值**完全不变**——它在容器启动时已固化,更新 Secret 不改 Pod spec、不触发重建,进程内的环境变量是个常量。

挂载卷路径: 对应的 key **文件内容会被刷新**(kubelet 同步循环,最长约一分钟延迟),但应用是否「看见」取决于它会不会重新读文件。

于是同一个容器内出现分裂: `env` 里是旧值、`/etc/secret/...` 文件里是新值。这正是「注入方式决定生效时机」的直接后果,也是把环境变量当作可热更新配置会踩的陷阱。彻底对齐两条路径的唯一可靠手段,仍是触发一次滚动(rollout restart 或哈希注解)。

## 5.2Volume 与 PV/PVC 绑定: 存储就是又一次 reconcile

PV 是「一块已存在或可被供给的存储」(供给),PVC 是「应用对存储的申领」(期望);一个控制平面循环把二者按容量、访问模式、StorageClass 一对一双向绑定——这跟第 2 章的控制循环是*同一个模式*。

为什么需要它

容器的文件系统随容器销毁而消失;Pod 又是可被随时杀掉重建的。要让数据活过 Pod 的生命周期,就需要把存储抽象成独立于 Pod 的对象。但这里有个职责分裂: *管什么样的存储*(NFS、云盘、本地盘——是集群管理员的事)与*要多大、什么访问模式*(应用开发者的事)应当解耦。K8s 用一对对象切开这道缝: **PV**(PersistentVolume,代表一块真实存储,由管理员预备或动态生成)是*供给侧*; **PVC**(PersistentVolumeClaim,声明「需要 10Gi、RWO」)是*期望侧*。应用只跟 PVC 打交道,不关心背后是哪块盘。

把这两个对象并排看,第 2 章的句式立刻浮出来: **PVC 是期望状态、PV 是实际供给,中间缺的那一步——撮合——正是一个 reconcile 循环干的活。** 这个循环叫 PV 控制器(PersistentVolume controller),它的工作和 Deployment 控制器在结构上一模一样: 读一批未绑定的 PVC(期望) 与一批可用的 PV(实际),按规则算出哪个 PV 满足哪个 PVC,然后把它们绑定(写入双向引用),再循环。

PVC
期望: 10Gi · RWO
应用申领


绑定控制器
reconcile: 撮合
期望 ↔ 供给


PV
实际: 某块磁盘
管理员/动态供给






双向绑定 · ClaimRef

相位: Available → Bound
(回收后 → Released)


图 5.1PVC↔PV 的绑定是一个 reconcile 循环: 期望(PVC) 与供给(PV) 由绑定控制器撮合。**注意**: 这跟第 2 章的控制循环是*同一个模式*——期望与实际供给的撮合,不是存储专属的特例。

撮合的判据是几个硬约束的交集,绑定必须**同时**满足:

- **容量**: PV 的 `capacity` ≥ PVC 申请的容量。
- **访问模式**: PV 支持的 `accessModes` 覆盖 PVC 要求的——`RWO`(ReadWriteOnce,单节点读写)、`ROX`(ReadOnlyMany)、`RWX`(ReadWriteMany)。
- **StorageClass**: 两者的 `storageClassName` 必须一致。
- **选择器/卷模式**等其余约束(如有)也要匹配。

绑定一旦达成,就是**一对一且排他**的: PV 的 `spec.claimRef` 指回那个 PVC,PVC 的 `spec.volumeName` 指向那个 PV——双向引用焊死,别的 PVC 再也绑不上这个 PV。这正是「一块盘只能被一个申领占用」在对象层面的实现。

pv-pvc-bind.yaml
yaml
复制

```
apiVersion: v1
kind: PersistentVolume           # 供给侧：实际存在的一块存储
metadata:
  name: pv-data
spec:
  capacity:
    storage: 20Gi
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard
  # ...底层来源（nfs / hostPath / csi ...）
---
apiVersion: v1
kind: PersistentVolumeClaim      # 期望侧：应用的申领
metadata:
  name: data-claim
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard
  resources:
    requests:
      storage: 10Gi              # 要 10Gi，pv-data 的 20Gi 能满足 → 绑定
```

PV 的生命周期是一台明确的状态机,相位(`status.phase`) 在控制循环的推动下流转:

- **Available**: 空闲,等待被某个 PVC 绑定。
- **Bound**: 已与一个 PVC 绑定,正被使用。
- **Released**: 绑定它的 PVC 被删了,但 PV 上的数据还没按回收策略(`persistentVolumeReclaimPolicy`: Retain/Delete) 处理,因此*尚不可*被重新绑定。
- **Failed**: 自动回收过程出错。

回扣第 2 章

相位流转不是定时脚本驱动的,而是 level-triggered: 控制器每轮都重新观察 PVC 与 PV 的当前状态,与期望比对,把 PV 朝正确的相位推进。删掉一个 PVC,下一轮 reconcile 观察到「绑定它的 PVC 不见了」,于是把 PV 置为 Released——和 Deployment 观察到「副本少了一个」就补一个,是*字面意义上的同一套机制*。存储没有发明新范式,它复用了门槛。

预测一下

集群里有一个 50Gi、`RWO` 的 Available PV。你提交一个申请 10Gi、`RWX` 的 PVC。它会绑上这个 PV 吗?

展开答案

不会。容量这一项满足(50Gi ≥ 10Gi),但**访问模式不满足**: PV 只支持 `RWO`(单节点读写),而 PVC 要求 `RWX`(多节点读写)。绑定要求所有约束的交集,任何一项不满足都不绑。这个 PVC 会停在 `Pending`,直到出现一个支持 `RWX` 且容量足够、StorageClass 匹配的 PV(或由动态供给造出一个)。这也说明: 访问模式不是「建议」,是绑定撮合的硬条件——它直接决定了 §5.5 那个多副本争用的失败模式。

## 5.3StorageClass 与动态供给

没有人工预备 PV 时,PVC 指定一个 StorageClass,provisioner 按需即时创建出一块 PV 再绑定——把「先备货」变成「按订单生产」。

为什么需要它

§5.2 默认了一个前提: 集群里已经躺着一批管理员手工建好的 PV,等着被 PVC 认领(静态供给)。在几百个应用、存储需求各异的真实集群里,这套「先备货」既繁琐又浪费——预备多了闲置,预备少了 PVC 卡在 Pending。**StorageClass** 把它翻成「按订单生产」: 它描述一类存储「怎么造」(用哪个 provisioner、什么参数、什么回收策略),PVC 只要写上 `storageClassName`,就等于下了一张订单。

动态供给把绑定循环又拆细了一层。当一个 PVC 指定了 StorageClass 而集群里没有现成 PV 能满足它时,流程是:

- PVC 提交,带 `storageClassName: fast-ssd`,此刻没有匹配的 Available PV。
- 该 StorageClass 指定的 **provisioner**(通常是一个 CSI 驱动)观察到这个待供给的 PVC。
- provisioner 真的去后端(云厂商 API、存储阵列等)*即时创建*一块满足规格的盘,并据此生成一个对应的 PV 对象。
- 新 PV 一出现,§5.2 那个绑定循环立刻把它和 PVC 绑上。PVC 从 Pending 转为 Bound。

storageclass-dynamic.yaml
yaml
复制

```
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com         # 由谁来「造盘」
parameters:
  type: gp3
reclaimPolicy: Delete                # PVC 删除后，连同盘一起删
volumeBindingMode: WaitForFirstConsumer   # 等 Pod 被调度后再供给（见下）
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-claim
spec:
  storageClassName: fast-ssd         # 下订单：没有现成 PV 就动态造一个
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 10Gi
```

**代价与一个关键参数。** 动态供给把存储的创建权交给了 provisioner,便利的反面是: 这些盘通常是真实计费资源,`reclaimPolicy: Delete` 意味着删 PVC 会连数据盘一起删掉(对数据库这类场景应改用 `Retain`)。另一个常被忽略的参数是 `volumeBindingMode`: 默认 `Immediate` 会在 PVC 一提交就立刻供给——可此时 Pod 还没调度,造出的盘会落在一个未必能被 Pod 触达的可用区,导致后续挂载失败。`WaitForFirstConsumer` 把供给推迟到 Pod 被调度之后,让存储跟着 Pod 的落点走——这又一次呼应了第 3 章调度与第 4 章拓扑: 各控制循环的决策彼此牵连。

## 5.4StatefulSet vs Deployment: 谁给 Pod 稳定身份

Deployment 的 Pod 是可互换的、躲在一个 ReplicaSet 后、共享同一个 PVC;StatefulSet 给每个 Pod 稳定且唯一的身份——序号、主机名、专属 PVC——并按序操作。

为什么需要它

Deployment 的整个设计前提是「Pod 可互换」: 三个副本是三个无差别的克隆,谁挂了换一个新的、名字随机、共享同一份后端,毫无影响——这对无状态 Web 服务完美。但数据库、消息队列、共识集群这类*有状态*应用打破了这个前提: 每个实例有自己的那份磁盘数据(MySQL 主从各存各的)、靠稳定的网络身份互相寻址(`mysql-0` 是主、其余是从)、升级时必须按确定顺序逐个来(先从后主)。Deployment 一样都给不了。**StatefulSet** 就是为「每个 Pod 都是一个有名有姓、带着自己存储的个体」而生的工作负载。

两者的机制差异集中在**身份**这一个词上。Deployment → ReplicaSet → Pod 这条链里,Pod 名字是随机后缀(如 `web-7d9f8-x2k4p`),挂了重建就换一个全新名字,所有副本通过 Service 共享一个负载均衡入口、且常常共用同一个 PVC。StatefulSet 则给每个 Pod 一套*黏在它身上、跨重建保持不变*的身份:

- **有序序号 + 稳定主机名**: 副本被命名为 `web-0`、`web-1`……`web-(N-1)`。`web-0` 挂了重建,新 Pod 仍叫 `web-0`。
- **每 Pod 专属 PVC**: 通过 `volumeClaimTemplates`,StatefulSet 为每个 Pod *单独*创建一个 PVC(`data-web-0`、`data-web-1`……),Pod 重建后*重新绑回自己原来那一个*,数据不丢、不混。
- **有序滚动**: 创建按 0→N-1 顺序、删除按 N-1→0 逆序、升级逐个进行,保证集群成员关系的有序变更。
- **配合 headless Service**: `clusterIP: None` 的 Service 不做负载均衡,而是为每个 Pod 提供一个稳定 DNS 名(`web-0.svc...`),让成员之间能点对点寻址。

DEPLOY
可互换


Pod
web-x2k4p

Pod
web-9fhz2

Pod
web-pl7nq


1 个 PVC
共享







STS
有稳定身份


web-0

web-1

web-2


data-web-0
专属

data-web-1
专属

data-web-2
专属



图 5.2同样跑 3 副本,身份模型截然不同。**注意**: 上排 Deployment 的 Pod 名字随机、可互换、共享一个 PVC;下排 StatefulSet 的每个 Pod 名字稳定(web-0/1/2) 且各绑一个专属 PVC——重建后 web-0 仍绑回 data-web-0。

对应的声明里,`volumeClaimTemplates` 是 StatefulSet 独有的字段——它不是「一个 PVC」,而是「一张为每个副本各印一份 PVC 的模板」。

statefulset.yaml
yaml
复制

```
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: web
spec:
  serviceName: web-headless        # 配合 headless Service（clusterIP: None）
  replicas: 3
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: app
          image: myapp:1.0
          volumeMounts:
            - name: data
              mountPath: /var/lib/data
  volumeClaimTemplates:            # 关键：为每个 Pod 各建一个 PVC
    - metadata:
        name: data                 # → data-web-0, data-web-1, data-web-2
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 10Gi
```

预测一下

一个 3 副本的 StatefulSet,`web-1` 所在节点宕机,Pod 被重建到另一个节点。它会拿到一块新的空盘,还是原来那份数据?

展开答案

原来那份数据。`web-1` 的 PVC 是 `data-web-1`,这个 PVC 对象*独立于 Pod 存在*,Pod 重建时 StatefulSet 让新的 `web-1` 重新绑回 `data-web-1`(进而绑回那个 PV、那块盘)。这正是「稳定身份」里最关键的一半: 不只是名字稳定,**名字和它专属的那份存储是焊在一起的**。前提是底层卷支持跨节点重新挂载(对 `RWO` 云盘要求新旧节点在同一可用区,这也是 §5.3 用 `WaitForFirstConsumer` 的原因)。

## 5.5失败模式: 用 Deployment 跑有状态应用

给一个多副本 Deployment 挂一块 RWO 的 PVC,等于让所有副本去抢同一块只能单节点挂载的盘——结果是 Pod 卡住、调度受限、或数据互相覆盖。

为什么需要它(看清这个失败模式)

这是把 §5.4 的机制差异忽视后最常见的事故。Deployment 的 Pod 模板对所有副本是*同一份*: 模板里引用哪个 PVC,三个副本就都引用同一个 PVC、同一块底层卷。当这块卷是 `RWO`(绝大多数云盘的默认且唯一可靠模式) 时,「只能被单个节点挂载读写」的物理约束就和「多个副本分散在多个节点」直接冲突。

把副本数从 1 调到 3,会按底层卷类型走向以下几种结局,无一是好的:

- **第 2、3 个副本卡在 ContainerCreating。** 它们被调度到了别的节点,而 RWO 卷已被第一个副本所在节点独占挂载,新节点 attach 失败,Pod 永远起不来。
- **调度被强行挤到同一节点。** 若靠亲和性把副本都摁在 RWO 卷所在的那个节点,就失去了多副本的容灾意义——节点一挂全挂,且单节点资源成为天花板。
- **数据互相覆盖(最危险)。** 万一卷是 `RWX` 或某些文件系统允许多挂载,几个并不为并发写设计的应用进程同时往同一份文件/数据目录写,没有协调,数据损坏。

失败模式 · Deployment + RWO PVC + 多副本

表象多变(Pod Pending、挂载报错、或数据诡异损坏),根因唯一: **Deployment 假设副本无差别、共享后端,而有状态应用要求每副本独占自己的存储与身份**。这不是调参能救的——加内存、改亲和性都只是绕。正解是换工作负载类型: 用 **StatefulSet**,靠 `volumeClaimTemplates` 给每个副本发一个*独立*的 PVC(`data-web-0/1/2`),每个副本独占自己的卷,从根上消除争用。判断口诀: *实例之间是否需要各存各的数据 / 各有各的身份*——只要答案是「是」,就不该用 Deployment。

Deployment vs StatefulSet · 四维对照

| 维度 | Deployment | StatefulSet |
| --- | --- | --- |
| 身份 | 随机名、可互换;副本无差别 | 稳定序号 + 主机名(web-0…N-1),跨重建不变 |
| 存储 | 模板共享 → 所有副本指向*同一个* PVC | `volumeClaimTemplates` → 每副本一个*专属* PVC |
| 滚动顺序 | 无序、可并行替换 | 有序: 创建 0→N-1、删除逆序、逐个升级 |
| 网络 | 普通 Service 做负载均衡,共享入口 | headless Service,每 Pod 一个稳定 DNS 名 |
| 适用场景 | 无状态服务: Web、API、无状态 worker | 有状态服务: 数据库、消息队列、共识集群 |

把本章收束回那条贯穿全书的主线: 配置注入的「改了不生效」、PV/PVC 的绑定、StatefulSet 的有序操作——**没有一个引入了新范式**。它们都是同一组 level-triggered 控制循环在不同对象上的展开: 控制器观察期望与实际、算差异、收敛、再观察。存储只是又一次 reconcile;有状态只是给参与 reconcile 的对象加了「身份」这一约束。第 2 章那把钥匙,到这里依然是同一把。

## 自测

1. 用环境变量注入的 ConfigMap,改了值之后为什么运行中的 Pod 不生效?这件事和「控制器只对 spec 变化做出反应」有什么关系?
2. PVC 和 PV 分别对应控制循环里的哪一侧(期望 / 实际)?把它们绑起来的是什么,这个动作和第 2 章的 reconcile 是不是同一个模式?
3. (设计层)为什么数据库应该用 StatefulSet 而不是 Deployment?从「身份」和「存储」两个维度各给一条理由。
4. (设计层)一个 PVC 申请 `RWX`,集群里只有 `RWO` 的 Available PV,绑定会发生吗?这对「多副本共享存储」的设计意味着什么?

展开参考答案

**1.** 环境变量在容器启动时只读一次、固化进进程;改 ConfigMap 不改动任何 Pod spec 字段,diff 为空,reconcile 不滚动、不重建,进程里的值就不变。修复手段(rollout restart / 哈希注解 / Reloader) 本质都是「制造一次 spec 变化」让控制循环重新跑。

**2.** PVC = 期望(应用申领多少、什么模式),PV = 实际供给(真实存在的一块盘)。绑定它们的是 PV 控制器,它读未绑定的 PVC 与可用 PV、按容量/访问模式/StorageClass 撮合、写双向引用——这与 Deployment 控制器把副本数收敛到期望是字面意义上的同一套 level-triggered 机制。

**3.** 身份维度: 数据库实例要靠稳定网络名互相寻址(谁是主、谁是从),StatefulSet 给 web-0…N-1 稳定主机名,Deployment 的随机名做不到。存储维度: 每个数据库实例存各自的数据,StatefulSet 用 `volumeClaimTemplates` 给每副本发专属 PVC,Deployment 让所有副本共享一个 PVC,数据会争用/覆盖。

**4.** 不会绑——访问模式是绑定的硬约束,`RWO` 的 PV 满足不了 `RWX` 的申领,PVC 停在 Pending。这意味着「多副本共享同一块存储」在 RWO 卷上根本不成立;要么用支持 `RWX` 的存储(如 NFS/CephFS),要么改用 StatefulSet 让每副本各持一块 RWO 卷——后者通常才是正解。

进阶挑战

### 把副本数从 1 调到 3,哪里会出问题?

你给一个 Deployment 挂了一个 PVC,跑得好好的。现在把 `replicas` 从 1 调到 3。哪里会出问题?换成什么能解决?

展开提示与思路

**问题**: Deployment 的 Pod 模板对 3 个副本是同一份,它们会全部引用*同一个* PVC、同一块底层卷。若卷是 `RWO`(最常见),只能被单节点挂载: 第一个副本占住后,被调度到别的节点的另外两个副本会卡在 ContainerCreating(attach 失败);若强行用亲和性把三者摁到同一节点,又丢了容灾;若卷恰好允许多挂载,几个不为并发写设计的进程同写一份数据 → 损坏。

**解决**: 换成 **StatefulSet**。用 `volumeClaimTemplates` 为每个副本各建一个独立 PVC(`data-web-0/1/2`),每个副本独占自己的卷、有稳定身份(web-0/1/2)、按序滚动,从根上消除对单块 RWO 卷的争用。配合 headless Service 让副本之间能点对点寻址。

动手画一遍

不看本章,在纸上画出图 5.1: 左边放 PVC、右边放 PV、中间放绑定控制器,标出哪边是「期望」、哪边是「实际」,并把箭头方向画对。然后翻回去对照——你有没有把「绑定」画成单向?它其实是*双向*引用(ClaimRef + volumeName)。这一笔画对了,就说明你真的把存储看成了 reconcile,而不是一条单向的「申请→分配」流水线。

### 延伸阅读

- [Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/) — 官方: PV/PVC 生命周期、相位、回收策略、绑定规则
- [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/) — 官方: 稳定身份、volumeClaimTemplates、有序保证、headless Service
- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) — 官方: 配置注入两种方式与更新传播行为
- [Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/) — 官方: 动态供给、provisioner、reclaimPolicy、volumeBindingMode

[上一章
04 · 网络模型](https://zhiwenliang.github.io/learning/kubernetes/04-networking.html)
[下一章
06 · 现状与前沿](https://zhiwenliang.github.io/learning/kubernetes/06-frontier.html)