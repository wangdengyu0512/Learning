---
title: 从问题到可演化模型：本体建模方法论与工程实践
description: 以设备运维为例，系统讲解如何组合 TOVE、METHONTOLOGY、NeOn、Ontology Development 101 与 LOT，完成本体需求、概念化、OWL 实现、验证、发布和演化。
date: 2026-10-29
tags: 本体工程, 知识图谱, OWL
featured: false
---

本体建模最常见的误区，是把它理解成“画一棵分类树”或“把数据库字段改成 RDF”。这样的模型也许能展示术语，却很难回答三个工程问题：为什么要建这些概念，模型是否足以支持目标应用，以及业务变化后如何知道哪些公理、数据和查询需要修改。

本体工程的核心不是概念数量，而是**可检验的语义承诺**。一个可用的本体应当说明领域中存在哪些类型的事物，它们以何种关系连接，哪些推论在逻辑上成立，哪些数据状态必须被判为不合格，以及这些决定来自什么需求和证据。

本文以“企业设备运维”为贯穿示例，给出一套从问题到可演化模型的完整方法。它不是一项新的学术标准，而是对 TOVE、METHONTOLOGY、Ontology Development 101、NeOn 和 LOT 等经典方法的工程裁剪：

- 用 **TOVE** 的能力问题定义范围和验收标准；
- 用 **METHONTOLOGY** 管理规格说明、知识获取、概念化、实现、评估和维护；
- 用 **Ontology Development 101** 指导类、属性、约束和实例的具体建模；
- 用 **NeOn** 处理已有本体复用、本体网络、映射与演化；
- 用 **LOT** 把需求、实现、测试、发布和维护组织为可迭代的软件工程过程；
- 用 **OntoClean、ODP、OOPS!、Reasoner、SHACL 和 SPARQL** 建立多层质量保障。

文中的故障、工单和维修数据均为教学示例，不代表任何真实企业制度或行业标准。

## 一、本体建模方法论究竟解决什么问题

Gruber 将本体定义为“概念化的显式规范”[1]。Studer、Benjamins 和 Fensel 在此基础上强调，这种规范还应当是形式化的、共享的[3]。四个关键词分别对应四项工程责任：

| 关键词 | 工程含义 | 必须留下的证据 |
| --- | --- | --- |
| 概念化 | 对领域中哪些对象和关系重要作出选择 | 范围、术语表、概念模型 |
| 显式 | 把隐含规则写成定义、公理或约束 | OWL 公理、SHACL Shapes、规则说明 |
| 形式化 | 让机器能够解释、查询和检验 | RDF/OWL 文件、查询与测试 |
| 共享 | 让不同角色对含义形成可治理的共识 | 来源、评审记录、版本和负责人 |

因此，本体既不同于术语表和分类体系，也不能被数据库模型完全替代。

| 表达物 | 擅长回答的问题 | 通常不负责的部分 |
| --- | --- | --- |
| 术语表 | 一个词是什么意思，有哪些别名 | 概念间的形式逻辑 |
| 分类体系 | 一个对象应归入哪个层级 | 复杂关系、约束和推理 |
| ER/UML 模型 | 软件或数据库如何组织数据 | 跨系统共享语义和开放世界推理 |
| 知识图谱 | 当前有哪些实体、关系和事实 | 这些事实所遵循的概念规范 |
| 本体 | 哪些类型、关系和推论在领域中成立 | 具体系统的存储与页面设计 |

本体与知识图谱也不应混为一谈。类、属性、公理等模式知识通常称为 **TBox**；具体设备、故障事件和工单等事实通常称为 **ABox**。一个知识图谱可以使用本体作为语义模式，但本体并不等于图中全部业务数据。

方法论的价值，就是让团队持续回答以下问题：

1. **目的**：模型服务哪些决策、查询、集成或自动化任务？
2. **范围**：哪些概念属于首期，哪些明确不做？
3. **证据**：定义和规则来自专家、制度、数据还是外部标准？
4. **承诺**：采用某个类、公理或对齐关系会引入什么推论？
5. **验证**：如何证明模型正确、一致且足以满足需求？
6. **演化**：变更如何评审、发布、回滚并影响下游应用？

## 二、五种代表性方法如何分工

本体工程没有一条适用于所有项目的固定流水线。经典方法形成于不同背景，它们提供的不是互斥选项，而是不同粒度的工具。

### 1. TOVE：从能力问题开始

Grüninger 和 Fox 在 TOVE 工作中提出了一套设计与评估本体的方法[2]。其中最有工程价值的思想，是先用自然语言写出本体必须回答的 **Competency Questions，能力问题**，再把它们形式化并用于验收。

这种顺序会迫使团队从用途而不是名词出发。例如，“设备”“部件”“故障”都可能是重要术语，但只有当团队提出“某次故障涉及哪些部件”时，才会暴露出故障事件、参与关系、时间范围和设备结构等真正需要表达的语义。

### 2. METHONTOLOGY：覆盖完整生命周期

METHONTOLOGY 把本体建设划分为规格说明、知识获取、概念化、集成、实现、评估、文档化和维护等活动[4][5]。它的优势不是规定某种 OWL 写法，而是提醒团队：本体不是一次建模会议的产物，还需要项目管理、配置管理和持续文档化。

对于多人协作项目，可以直接把它转化为交付物清单：本体需求规格、术语与定义、概念模型、复用评估、形式模型、测试集、发布包和变更日志。

### 3. Ontology Development 101：指导具体建模

Noy 和 McGuinness 的 Ontology Development 101 提供了一条实用的建模路径：确定领域和范围、考虑复用、枚举术语、定义类和层级、定义属性、设置属性约束，最后创建实例[6]。

它适合指导第一次迭代，但“先建类层级再加属性”不应被机械执行。事件、角色、时间和多方关系通常需要反复重构；本体也不存在唯一正确的类树，正确性取决于用途、语义承诺和可检验结果。

### 4. NeOn：面向复用、本体网络与演化

现实项目很少完全从零开始。NeOn 方法论提供了多种场景，覆盖复用非本体资源、复用本体、重构、模块化、对齐、本体网络协作和本体演化[10]。当企业需要连接设备分类标准、传感器本体、组织本体和内部运维模型时，NeOn 比单一本体的线性开发流程更贴近现实。

它带来的关键认识是：复用不等于直接 `owl:imports`。团队还可以选择模块抽取、术语引用、语义映射或仅复用设计模式，不同方案会带来不同的依赖和推理风险。

### 5. LOT：轻量、迭代、面向发布

LOT（Linked Open Terms）把本体工程组织为需求、实现、发布和维护四个阶段，并强调术语、用例、能力问题、测试及在线文档之间的追踪关系[11]。它与现代软件交付方式更容易结合，适合在 Git、持续集成和自动文档环境中使用。

本文采用 LOT 作为外层迭代骨架，再从其他方法中补充需求验收、概念建模、复用和质量控制。实际过程不是一次通过的瀑布线，而是一个短周期闭环：

```text
需求与 CQ → 知识获取 → 复用评估 → 概念化 → OWL/SHACL 实现
     ↑                                               ↓
变更与新需求 ← 发布和监测 ← 多层评估 ← 样例数据与查询测试
```

## 三、第一步：建立一个可验收的最小闭环

### 1. 写项目章程，而不是先打开 Protégé

项目章程不需要很长，但至少应回答：目标用户是谁，计划支持什么决策，权威知识源有哪些，谁有定义权，采用什么形式语言，以及首期不解决什么问题。

以设备运维本体为例，首期目标可以写成：

> 为运维知识查询、工单完整性检查和故障分析提供共享语义；覆盖设备、部件、观测、故障事件、诊断、工单、维修活动、人员及其来源；支持 OWL 2 DL 推理和 SHACL 数据质量校验。

范围外事项也必须明确。比如首期不构建设备剩余寿命算法，不定义行业安全等级，不替代工单系统的权限控制，也不把所有厂商产品目录导入核心本体。范围外清单可以阻止“看到一个词就加一个类”的无边界扩张。

### 2. 把用例改写成能力问题

好的能力问题应当具体、可提供样例答案，并能映射到查询、推理或校验。以下是首轮测试集：

| 编号 | 能力问题 | 需要的核心语义 | 验收方式 |
| --- | --- | --- | --- |
| CQ-01 | 某设备在指定时间段发生过哪些故障？ | 设备、故障事件、时间区间 | SPARQL |
| CQ-02 | 一次故障涉及哪些部件？ | 设备组成、事件参与 | 查询与推理 |
| CQ-03 | 某诊断依据了哪些观测和文档？ | 诊断、证据、来源 | SPARQL + 来源检查 |
| CQ-04 | 谁执行了维修，执行时承担什么角色？ | 人员、活动、角色承担 | SPARQL |
| CQ-05 | 哪些已关闭工单缺少完工时间或维修结果？ | 状态、时间、结果 | SHACL |
| CQ-06 | 某类故障最常影响哪类部件？ | 故障分类、部件分类、统计口径 | 聚合查询 |

能力问题不是写完就归档。每个 CQ 都应有稳定标识，并与术语、OWL 实体、样例数据、SPARQL 查询或 SHACL Shape 建立追踪关系。当 CQ-04 被删除时，团队应能判断“角色承担”模块是否仍有其他需求；当模型改变时，也应知道需要重跑哪些测试。

### 3. 同时记录非功能需求

仅用 CQ 描述功能还不够。项目还要决定：是否要求 OWL 2 DL 可判定性，预期数据规模和查询延迟是多少，是否需要中英文标签，外部本体能否在线访问，IRI 是否永久稳定，许可证是否允许再发布，以及谁负责审批变更。

这些约束会直接改变方案。例如，一个依赖高成本全量推理的模型，即使逻辑上优雅，也未必适合高频工单接口；一个没有明确许可证的外部词表，即使语义覆盖很好，也不应被直接打包发布。

## 四、第二步：知识获取必须留下证据链

本体定义不是建模者凭直觉写出的解释。知识可以来自领域专家、操作规程、标准文档、数据库模式、历史工单、接口文档和现有本体，但不同来源的权威性、更新频率和适用范围并不相同。

建议维护一张“证据台账”：

| 条目 | 候选定义或规则 | 来源 | 适用范围 | 冲突与待确认项 | 负责人 |
| --- | --- | --- | --- | --- | --- |
| `FailureEvent` | 使设备偏离预期功能的事件 | 运维规程 V3 第 4.2 节 | A 类生产设备 | 是否包含计划停机 | 设备专家 |
| `ClosedWorkOrder` | 状态为关闭且流程已完成的工单 | 工单接口规范 | 现行工单系统 | “取消”是否属于关闭 | 流程负责人 |
| `affectsComponent` | 故障事件影响的物理部件 | 专家访谈 | 机械与电气部件 | 软件模块另行建模 | 本体负责人 |

每个重要概念都应收集四类例子：正例、反例、边界例和历史例。比如，“轴承过热”可能是观测、症状，也可能被口头称为故障。建模时要区分：温度超过阈值是一个观测结果；“过热症状”是对观测的解释；导致功能偏离的轴承失效才是故障事件或故障状态。边界例会比抽象讨论更快地揭示定义冲突。

知识获取还应记录未决问题，而不是过早用一个类名掩盖分歧。如果不同工厂对“停机”的统计口径不同，可以先把两种定义作为带来源的候选方案，通过 CQ 和样例数据评估影响，再决定统一、分层还是保留情境化定义。

## 五、第三步：复用前先评估语义承诺

复用已有本体可以减少重复定义并提高互操作性，但“找到同名类”只是开始。评估候选本体时，至少检查以下六个维度：

| 维度 | 核心问题 |
| --- | --- |
| 语义匹配 | 候选术语的定义和本项目的意图是否一致？ |
| 需求覆盖 | 它能直接或间接支持哪些 CQ？遗漏了什么？ |
| 形式质量 | 是否提供可解析的 RDF/OWL，逻辑是否一致？ |
| 依赖成本 | 导入后还会引入多少本体、实体和公理？ |
| 法律条件 | 许可证是否允许修改、组合和再发布？ |
| 维护状态 | IRI 是否稳定，是否有版本、文档和维护者？ |

评分不是为了得到一个机械总分，而是为了暴露取舍。一个语义精确但长期无人维护的本体，可能适合作为设计参考，不一定适合成为生产依赖。一个覆盖面很广的标准本体，也可能因导入链过重而只适合抽取局部模块。

常见复用策略可以分为四档：

1. **整体导入**：需要对方完整语义且依赖可控时使用 `owl:imports`。
2. **模块抽取**：只保留与种子术语相关的一组公理，并记录来源版本和抽取规则。
3. **术语引用或映射**：保留自己的模型，通过 `rdfs:subClassOf`、`skos:exactMatch` 等表达关系。
4. **设计模式复用**：复用事件、角色、参与关系等建模方案，不复制原本体术语。

映射关系必须根据语义强度选择。`owl:equivalentClass` 表示两类在所有模型中具有相同外延，远强于“含义相近”；`owl:sameAs` 表示两个 IRI 指称同一个个体，也不是普通的数据去重标记。无法证明逻辑等价时，应使用更弱的映射或把它保存为待评审候选。

Gangemi 和 Presutti 总结的本体设计模式（Ontology Design Patterns，ODP）提供了可复用的问题解法[8]。它们特别适合处理 n 元关系、参与、时间索引角色和情境等反复出现的难题，但模式仍需要经过 CQ 和领域定义检验，不能因为“是模式”就默认适用。

## 六、第四步：从术语走向概念模型

概念化阶段的产物不应只有一张类图。至少需要术语表、类层级、关系清单、关键约束、设计决策记录和若干样例实例。每个术语建议包含：首选名称、定义、同义词、来源、正反例、上位概念、相关关系和状态。

### 1. 判断它是类、个体还是属性

一个实用判断流程如下：

- 它表示一组可以共享定义的事物吗？通常建成类，如 `Pump`、`FailureEvent`。
- 它是现实中可被唯一指称的具体对象吗？通常建成个体，如编号为 P-101 的泵。
- 它描述两个对象之间的关系吗？建成对象属性，如 `hasComponent`。
- 它连接对象和字符串、数值、日期吗？建成数据属性，如 `completionTime`。
- 它本身需要时间、来源、参与者或状态吗？不要压缩为属性，应提升为独立实体。

最后一条最重要。`repairedBy` 看似可以直接连接设备和人员，但无法表达维修时间、工单、使用的方法和人员当时承担的角色。把“维修活动”建成实体后，这些信息都有清晰的挂载位置。

### 2. 不要把数据取值误建成类层级

工单状态若来自受控代码表，可以建成 `WorkOrderStatus` 的命名个体，例如 `Open`、`Closed` 和 `Cancelled`；若每种状态有独立语义和推理规则，也可以定义相应状态类。选择取决于用途，而不是界面上是否显示下拉框。

同样，“P-101 泵”通常是 `Pump` 的实例，不应因数据库中有一张设备表就把每台设备变成一个 OWL 类。类表达可重复实例化的类型，实例表达具体对象。

### 3. 用事件表达变化，用角色表达情境身份

故障和维修都发生在时间中，有参与者、对象、原因或结果，因此适合建模为事件或活动：

```text
FailureEvent ──affects──> Component
      │
      ├──occursOn──> Equipment
      ├──supportedBy──> Observation
      └──hasTime──> TimeInterval

MaintenanceActivity ──actsOn──> Equipment
      │
      ├──performedBy──> RoleAssignment ──assignedTo──> Person
      ├──realizesRole──> TechnicianRole
      └──produces──> MaintenanceResult
```

“维修人员”通常不是一个人的永久本质类型。同一个人可能在某次维修中承担执行人员角色，在另一次评审中承担审核角色。用 `RoleAssignment` 表达人员、角色、活动范围和有效时间，可以避免把临时身份固化为 `Person` 的子类。

### 4. 用 OntoClean 检查类层级

OntoClean 用身份、统一性、依赖性和刚性等元属性评估分类决策[7]。一个简化但很有用的检查是：具有偶然性的角色类，不应成为刚性类型的上位类。例如，“人员”不应是“维修人员”的子类；一个人可以停止承担维修角色，却不会因此不再是人。

OntoClean 不是自动生成类树的工具。它的作用是发现不一致的本体承诺，再由领域定义和使用需求决定如何修正。

## 七、第五步：形式化前先理解 OWL 的语义

概念模型进入 OWL 时，团队必须从“数据结构思维”切换到“逻辑公理思维”。RDF 1.1 提供以三元组构成的图数据模型[15]，OWL 2 则在其上提供基于描述逻辑的本体语言，用于表达类别、关系及可推导知识[13][14]。它默认采用两个容易误解的假设。

### 1. 开放世界假设

没有记录某个事实，不等于该事实为假。如果图中没有工单的完工时间，OWL 只知道“目前未知”，不会自动认定“该工单不完整”。因此，下面的存在量词限制：

```text
ClosedWorkOrder SubClassOf completionTime some xsd:dateTime
```

表达的是“每个已关闭工单在所有满足本体的解释中都至少存在一个完工时间”，它可用于一致性推理，却不会像数据库的 `NOT NULL` 一样报告缺失三元组。需要检查当前 RDF 图是否真的提供了值时，应使用 SHACL 或查询测试。

### 2. 非唯一名假设

两个不同 IRI 不会自动被认为是两个不同对象。除非显式声明 `owl:differentFrom`、使用 `owl:AllDifferent`，或由其他公理推出差异，否则推理机可以把两个名字解释为同一个体。业务主键去重仍需由数据治理和约束机制负责。

### 3. domain 和 range 不是字段校验

若声明 `performedBy rdfs:domain MaintenanceActivity`，而数据中出现：

```turtle
ex:task-01 ex:performedBy ex:alice .
```

RDFS/OWL 的结论是 `ex:task-01` 属于 `MaintenanceActivity`，而不是“task-01 类型错误”。`rdfs:range` 同理会推断宾语类型。全局 domain/range 应表达真实的逻辑承诺；如果只是想限制某个类上的属性取值，应使用类限制或 SHACL Shape。

## 八、第六步：实现最小 OWL 模块

本体最好按稳定边界拆成模块，例如设备结构、观测与诊断、事件与维修、人员与角色。核心模块保持小而稳定，面向应用的公理放在扩展模块中，外部映射则放在独立桥接模块中。

下面的 Turtle 片段展示一个最小核心模型。为便于阅读，省略了中英文标签、定义、来源和版本注解；生产本体中这些注解不应省略。

```turtle
@prefix ex: <https://example.org/maintenance/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex: a owl:Ontology ;
    owl:versionIRI <https://example.org/maintenance/1.0.0> .

ex:Equipment a owl:Class .
ex:Component a owl:Class .
ex:Event a owl:Class .
ex:FailureEvent a owl:Class ;
    rdfs:subClassOf ex:Event .
ex:MaintenanceActivity a owl:Class .
ex:WorkOrder a owl:Class .
ex:Person a owl:Class .
ex:RoleAssignment a owl:Class .
ex:MaintenanceResult a owl:Class .
ex:Observation a owl:Class .

ex:hasComponent a owl:ObjectProperty ;
    rdfs:domain ex:Equipment ;
    rdfs:range ex:Component .

ex:occursOn a owl:ObjectProperty ;
    rdfs:domain ex:FailureEvent ;
    rdfs:range ex:Equipment .

ex:affectsComponent a owl:ObjectProperty ;
    rdfs:domain ex:FailureEvent ;
    rdfs:range ex:Component .

ex:supportedBy a owl:ObjectProperty ;
    rdfs:domain ex:FailureEvent ;
    rdfs:range ex:Observation .

ex:executes a owl:ObjectProperty ;
    rdfs:domain ex:RoleAssignment ;
    rdfs:range ex:MaintenanceActivity .

ex:assignedTo a owl:ObjectProperty ;
    rdfs:domain ex:RoleAssignment ;
    rdfs:range ex:Person .

ex:hasResult a owl:ObjectProperty ;
    rdfs:domain ex:WorkOrder ;
    rdfs:range ex:MaintenanceResult .

ex:status a owl:ObjectProperty ;
    rdfs:domain ex:WorkOrder ;
    rdfs:range ex:WorkOrderStatus .

ex:WorkOrderStatus a owl:Class .
ex:Closed a ex:WorkOrderStatus .

ex:completionTime a owl:DatatypeProperty ;
    rdfs:domain ex:WorkOrder ;
    rdfs:range xsd:dateTime .

ex:eventTime a owl:DatatypeProperty ;
    rdfs:domain ex:Event ;
    rdfs:range xsd:dateTime .

ex:FailureEvent rdfs:subClassOf
    [ a owl:Restriction ;
      owl:onProperty ex:occursOn ;
      owl:someValuesFrom ex:Equipment
    ] .
```

最后一条公理说明：每个 `FailureEvent` 必须与至少一个 `Equipment` 存在 `occursOn` 关系。它是关于故障事件含义的必要条件，不是“当前数据必须已经写出该边”的封闭世界校验。

实现时还应遵守几条基础规则：

- 为本体、类和属性使用稳定、可解析且不含版本号的实体 IRI；版本号放在 `owl:versionIRI` 中。
- 每个公共实体提供 `rdfs:label`、自然语言定义、来源和维护状态。
- 只有在语义确实互斥时才声明 `owl:disjointWith`，因为它会把隐藏的多类型数据变成逻辑冲突。
- 谨慎使用逆属性、传递属性、属性链和基数限制，先确认它们符合业务语义和目标推理配置。
- 不以界面字段是否必填来决定 OWL 公理；业务完整性要求放入 SHACL。

## 九、第七步：让 OWL 与 SHACL 各司其职

OWL 回答“在这些公理下可以推出什么、是否存在逻辑矛盾”；SHACL 回答“当前数据图是否满足一组指定约束”[16]。二者可以描述相近条件，但采用不同假设，输出也不同。

以 CQ-05 为例，业务要求已关闭工单必须有且仅有一个完工时间，并至少有一个维修结果。这个条件适合写成 SHACL：

```turtle
@prefix ex: <https://example.org/maintenance/> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:ClosedWorkOrderShape
    a sh:NodeShape ;
    sh:targetClass ex:WorkOrder ;
    sh:or (
        [ sh:not [
            sh:property [
                sh:path ex:status ;
                sh:hasValue ex:Closed
            ]
        ] ]
        [ sh:property [
              sh:path ex:completionTime ;
              sh:minCount 1 ;
              sh:maxCount 1 ;
              sh:datatype xsd:dateTime
          ] ;
          sh:property [
              sh:path ex:hasResult ;
              sh:minCount 1 ;
              sh:class ex:MaintenanceResult
          ]
        ]
    ) ;
    sh:message "已关闭工单必须有且仅有一个完工时间，并至少记录一个维修结果。"@zh .
```

验证流水线应明确是否先执行 OWL 推理再执行 SHACL。若 Shape 依赖推导类型，而校验引擎只看到显式三元组，结果会与预期不同。最稳妥的做法是把推理配置、目标图、Shapes 版本和预期报告都纳入测试配置。

## 十、第八步：用样例数据把能力问题变成测试

模型只有和代表性数据一起运行，才能暴露隐藏问题。测试数据集应同时包含：能够正确回答 CQ 的正向数据、故意违反约束的负向数据、处于时间或分类边界的数据，以及曾引发生产问题的回归数据。

下面构造一条简化的故障记录：

```turtle
@prefix ex: <https://example.org/maintenance/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:pump-P101 a ex:Equipment ;
    ex:hasComponent ex:bearing-B01 .

ex:bearing-B01 a ex:Component .

ex:failure-F001 a ex:FailureEvent ;
    ex:occursOn ex:pump-P101 ;
    ex:affectsComponent ex:bearing-B01 ;
    ex:eventTime "2026-10-20T08:15:00Z"^^xsd:dateTime .

ex:workorder-W001 a ex:WorkOrder ;
    ex:status ex:Closed ;
    ex:completionTime "2026-10-20T11:30:00Z"^^xsd:dateTime ;
    ex:hasResult ex:result-R001 .

ex:result-R001 a ex:MaintenanceResult .
```

CQ-01“某设备在指定时间段发生过哪些故障”可以转写为参数化 SPARQL。应用层应绑定参数，不要用字符串拼接用户输入。

```sparql
PREFIX ex: <https://example.org/maintenance/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?failure ?time
WHERE {
  ?failure a ex:FailureEvent ;
           ex:occursOn ex:pump-P101 ;
           ex:eventTime ?time .
  FILTER (
    ?time >= "2026-10-01T00:00:00Z"^^xsd:dateTime &&
    ?time <  "2026-11-01T00:00:00Z"^^xsd:dateTime
  )
}
ORDER BY ?time
```

对于每个 CQ，测试不应只判断“查询能够执行”，还应断言结果集合。可以为 CQ-01 保存预期结果 `failure-F001`；再加入一条区间外故障，确认它不会被返回；最后加入一条只有日期没有时区的数据，检验数据规范是否足够明确。

查询测试也能反向发现模型缺陷。如果 CQ-06 的统计结果受一场故障关联多个诊断记录而重复计数影响，就需要明确统计单位，并在查询中使用 `COUNT(DISTINCT ?failure)`，而不是随意修改本体去迎合一条查询。

## 十一、第九步：建立五层评估体系

“本体文件能打开”不等于本体质量合格。评估至少应覆盖五层，每层回答不同问题。

### 1. 语法和规范检查

先检查 RDF 是否可解析、IRI 是否合法、前缀和数据类型是否正确、本体元数据是否完整。序列化格式之间的转换测试也很有价值：Turtle 能解析不代表某个发布脚本生成的 RDF/XML 仍然完整。

### 2. 逻辑一致性检查

使用 HermiT、Pellet 或 ELK 等与目标 OWL Profile 匹配的推理机检查本体一致性、不可满足类和关键推论。测试既要包含“应当推出”的正向断言，也要包含“绝不能推出”的负向断言。

例如，如果 `FailureEvent` 与 `PlannedMaintenanceEvent` 被声明为不相交，而某个样例同时属于二者，推理机应报告不一致。此时不能直接删除 `disjointWith` 来让测试通过，而应检查事件定义或数据分类是否错误。

### 3. 结构和常见陷阱扫描

OOPS! 可以发现缺失 domain/range、循环定义、命名不一致、孤立元素和误用等常见陷阱[9]。但自动扫描结果只是评审输入：某些全局 domain 本来就不应声明，某些类也可能有意保持外部扩展点。团队需要记录“修复、接受或延期”的决定及理由。

OntoClean、设计模式审查和人工同行评审属于这一层。它们关注的不是文件语法，而是分类结构与语义承诺是否合理。

### 4. 能力问题验收

每个 CQ 都要有查询或约束、固定测试数据和预期结果。至少测试：

- 正常数据是否返回正确答案；
- 缺失数据是否产生预期的空结果或验证报告；
- 边界时间、多个角色和重复关系是否正确处理；
- 在启用与关闭推理时，结果差异是否符合设计；
- 本体升级后，历史 CQ 是否发生非预期回归。

### 5. 数据与业务验证

最后让领域专家检查实例和查询答案是否符合业务含义，并用 SHACL 检查当前数据图。逻辑一致的本体仍可能使用错误的术语定义；结构合格的数据也可能来自失效的来源。验证报告应保留数据快照、Shape 版本、推理配置、执行时间和负责人。

MIRO 指南提出了本体报告的最低信息要求，包括本体目的、范围、知识获取、开发方法、复用、评估和可访问性等内容[12]。它适合作为发布说明和论文写作的检查表，也能防止团队只交付一个无法解释的 `.owl` 文件。

可以把五层检查放入持续集成：

```text
解析与 lint
  → OWL Profile 检查
  → 推理一致性与预期推论
  → OOPS!/自定义结构规则
  → SHACL 数据验证
  → SPARQL CQ 回归测试
  → 文档和发布包生成
```

任何自动化工具都不能替代领域评审，但它们能够让已经确认的决定持续生效。

## 十二、第十步：发布、版本与演化

本体一旦被数据、查询和应用引用，就成为接口。发布包至少应包含：机器可读本体、Shapes、样例数据、CQ 与测试、HTML 文档、许可证、变更记录、依赖锁定信息和弃用说明。

### 1. 区分本体 IRI 与版本 IRI

实体和本体 IRI 应尽量长期稳定，例如：

```text
本体 IRI     https://example.org/maintenance
版本 IRI     https://example.org/maintenance/1.2.0
实体 IRI     https://example.org/maintenance/FailureEvent
```

不要因标签修改或版本升级就改变实体 IRI。标签是展示名称，IRI 是机器身份。发布服务器还应为这些 IRI 提供可解析表示和人类可读文档。

### 2. 用兼容性决定版本级别

可以借用语义化版本，但要先为本体定义“兼容”的含义：

- **补丁版本**：修正文档、标签或不改变逻辑结果的元数据；
- **次版本**：新增向后兼容的类、属性或约束；
- **主版本**：删除或重定义实体、收紧关键公理，或者改变既有查询结果。

新增公理并不天然向后兼容。例如新增不相交公理可能使旧数据不一致，新增 SHACL `minCount` 会使原本合格的数据失败。因此版本判定必须结合影响分析和回归测试，而不是只看文件 diff。

### 3. 让变更请求可追踪

每个变更请求应写明：触发需求、受影响 CQ、修改的实体和公理、数据迁移方案、下游查询或 API、兼容性判断、评审人和生效日期。弃用实体时先标记 `owl:deprecated true`，提供替代项和迁移窗口，不要直接删除 IRI。

演化闭环可以表示为：

```text
新需求或缺陷 → 影响分析 → 建模修改 → 推理/SHACL/CQ 回归
             → 专家评审 → 版本发布 → 使用监测 → 下一轮需求
```

NeOn 强调本体网络中的依赖关系[10]。当外部本体升级时，桥接模块应单独测试；否则一个看似局部的映射变化可能改变大量实例的推导类型。

## 十三、最常见的失败模式

### 1. 从数据库字段直接生成本体

数据库模式反映某个系统的存储选择，不一定反映领域概念。外键可能表示组成、参与、归属或临时引用；一个状态字段也可能压缩了完整的业务过程。数据库是重要知识源，但必须经过语义分析，不能逐表逐列机械转换。

### 2. 追求一开始就覆盖整个领域

没有 CQ 约束的“大而全”模型很难评审，也无法证明完成。更有效的方式是选取一个端到端用例，建立从需求、模型、样例数据到测试的最小闭环，再按新 CQ 扩展。

### 3. 把所有业务规则都写进 OWL

OWL 适合表达可复用的概念语义和逻辑关系，不适合直接承担所有数据完整性、流程顺序、计算和权限控制。字段必填与当前图校验用 SHACL，聚合和报表用 SPARQL，复杂过程规则由规则引擎或应用服务执行，并记录它们与本体术语的对应关系。

### 4. 过度使用等价和 `sameAs`

强映射会传播类型和公理。两个系统中的“设备”都叫 Equipment，并不意味着它们外延完全相同；两个名称相似的资产记录也不一定指向同一现实对象。先使用弱映射和来源化身份解析，只有证据充分时才提升为逻辑等价。

### 5. 只检查一致性，不检查用途

一个逻辑一致的本体可能回答不了任何关键 CQ；一个查询全部通过的模型，也可能隐藏概念层级错误。质量门禁必须同时覆盖逻辑、结构、需求、数据和业务解释。

### 6. 没有版本和负责人

没有维护责任的本体很快会成为静态词表。术语定义、外部依赖、Shapes 和查询都需要负责人、版本、评审状态和弃用策略。

## 十四、大模型可以参与什么，不能替代什么

大模型可以提高本体工程的资料处理效率，例如：从文档中抽取候选术语和定义、将访谈整理为候选 CQ、发现近义词、生成第一版 Turtle、解释推理错误、草拟 SPARQL/SHACL，以及为变更生成文档。2026 年的一项系统综述对大模型支持本体工程的研究进行了归纳，也指出评估标准、可复现性和人工监督仍是关键问题[17]。

合理的工作方式是把大模型输出视为**候选变更**：

1. 输入应附带来源片段、现有术语和建模约束。
2. 输出必须保留来源，不能把概率性生成当作领域事实。
3. 生成的 OWL 要经过解析、Profile 检查和推理测试。
4. 生成的 SHACL 和 SPARQL 要在正反例数据上执行。
5. 定义、等价映射和破坏性变更必须由领域专家与本体负责人批准。

大模型尤其不能独立决定概念的本质属性、权威定义或两个本体实体是否等价。它可以提供候选和反例，却不能替代组织中的定义权与发布责任。

## 十五、一份可执行的交付清单

第一次迭代不必交付庞大本体，但应交付一个完整闭环：

| 类别 | 最小交付物 |
| --- | --- |
| 需求 | 项目章程、范围内/范围外清单、带编号的 CQ、非功能需求 |
| 知识 | 术语表、证据台账、正反例、未决问题 |
| 设计 | 概念模型、复用评估、设计决策记录、模块与 IRI 方案 |
| 实现 | OWL 本体、SHACL Shapes、桥接模块、样例 ABox |
| 测试 | 推理测试、CQ 查询、预期结果、负向数据、回归报告 |
| 发布 | 版本化本体、HTML 文档、许可证、变更记录、弃用说明 |
| 治理 | 负责人、评审流程、变更模板、依赖监测和发布节奏 |

如果其中任何一个模型实体无法追溯到需求或证据，应询问它是否真的需要存在；如果任何 CQ 没有可执行验收，应继续细化问题；如果任何关键公理没有反例测试，就还没有证明团队理解了它的后果。

## 结语

本体建模不是把业务名词翻译成 OWL，而是把领域认知转化为可共享、可计算、可检验且可演化的语义契约。能力问题给出目标，知识获取提供证据，概念化明确承诺，OWL 负责可推导语义，SHACL 负责当前数据约束，SPARQL 把需求变成验收，而版本和回归测试保证这些决定能够长期维护。

TOVE、METHONTOLOGY、Ontology Development 101、NeOn 和 LOT 各自解决生命周期中的不同问题。工程实践不需要选出唯一“正确方法”，而应把它们组合成适合团队的闭环，并让每一个建模决定都能回答三个问题：它来自哪里，它支持什么用途，变化后如何验证。

## 参考文献与规范

[1] Gruber, T. R. (1993). A Translation Approach to Portable Ontology Specifications. *Knowledge Acquisition*, 5(2), 199-220. [https://doi.org/10.1006/knac.1993.1008](https://doi.org/10.1006/knac.1993.1008)

[2] Grüninger, M., & Fox, M. S. (1995). Methodology for the Design and Evaluation of Ontologies. *IJCAI Workshop on Basic Ontological Issues in Knowledge Sharing*. [论文 PDF](https://www.eil.utoronto.ca/wp-content/uploads/enterprise-modelling/papers/gruninger-ijcai95.pdf)

[3] Studer, R., Benjamins, V. R., & Fensel, D. (1998). Knowledge Engineering: Principles and Methods. *Data & Knowledge Engineering*, 25(1-2), 161-197. [https://doi.org/10.1016/S0169-023X(97)00056-6](https://doi.org/10.1016/S0169-023X(97)00056-6)

[4] Fernández-López, M., Gómez-Pérez, A., & Juristo, N. (1997). METHONTOLOGY: From Ontological Art Towards Ontological Engineering. *AAAI Spring Symposium*. [AAAI 页面](https://aaai.org/papers/0005-ss97-06-005-methontology-from-ontological-art-towards-ontological-engineering/)

[5] Fernández-López, M., & Gómez-Pérez, A. (2002). Overview and Analysis of Methodologies for Building Ontologies. *The Knowledge Engineering Review*, 17(2), 129-156. [https://doi.org/10.1017/S0269888902000462](https://doi.org/10.1017/S0269888902000462)

[6] Noy, N. F., & McGuinness, D. L. (2001). *Ontology Development 101: A Guide to Creating Your First Ontology*. Stanford Knowledge Systems Laboratory. [论文 PDF](https://protege.stanford.edu/publications/ontology_development/ontology101.pdf)

[7] Guarino, N., & Welty, C. (2002). Evaluating Ontological Decisions with OntoClean. *Communications of the ACM*, 45(2), 61-65. [https://doi.org/10.1145/503124.503150](https://doi.org/10.1145/503124.503150)

[8] Gangemi, A., & Presutti, V. (2009). Ontology Design Patterns. In *Handbook on Ontologies* (2nd ed.). Springer. [https://doi.org/10.1007/978-3-540-92673-3_10](https://doi.org/10.1007/978-3-540-92673-3_10)

[9] Poveda-Villalón, M., Gómez-Pérez, A., & Suárez-Figueroa, M. C. (2014). OOPS! (OntOlogy Pitfall Scanner!): An On-line Tool for Ontology Evaluation. *International Journal on Semantic Web and Information Systems*, 10(2), 7-34. [https://doi.org/10.4018/ijswis.2014040102](https://doi.org/10.4018/ijswis.2014040102)

[10] Suárez-Figueroa, M. C., Gómez-Pérez, A., & Fernández-López, M. (2015). The NeOn Methodology Framework: A Scenario-Based Methodology for Ontology Development. *Applied Ontology*, 10(2), 107-145. [https://doi.org/10.3233/AO-150145](https://doi.org/10.3233/AO-150145)

[11] Poveda-Villalón, M., Fernández-Izquierdo, A., Fernández-López, M., & García-Castro, R. (2022). LOT: An Industrial Oriented Ontology Engineering Framework. *Engineering Applications of Artificial Intelligence*, 111, 104755. [https://doi.org/10.1016/j.engappai.2022.104755](https://doi.org/10.1016/j.engappai.2022.104755)

[12] Matentzoglu, N., Malone, J., Mungall, C., & Stevens, R. (2018). MIRO: Guidelines for Minimum Information for the Reporting of an Ontology. *Journal of Biomedical Semantics*, 9, 6. [https://doi.org/10.1186/s13326-017-0172-7](https://doi.org/10.1186/s13326-017-0172-7)

[13] W3C. (2012). *OWL 2 Web Ontology Language Document Overview (Second Edition)*. [https://www.w3.org/TR/owl2-overview/](https://www.w3.org/TR/owl2-overview/)

[14] W3C. (2012). *OWL 2 Web Ontology Language Primer (Second Edition)*. [https://www.w3.org/TR/owl2-primer/](https://www.w3.org/TR/owl2-primer/)

[15] W3C. (2014). *RDF 1.1 Concepts and Abstract Syntax*. [https://www.w3.org/TR/rdf11-concepts/](https://www.w3.org/TR/rdf11-concepts/)

[16] W3C. (2017). *Shapes Constraint Language (SHACL)*. [https://www.w3.org/TR/shacl/](https://www.w3.org/TR/shacl/)

[17] Li, J., Garijo, D., & Poveda-Villalón, M. (2026). Large Language Models for Ontology Engineering: A Systematic Literature Review. *Semantic Web*, 17(4), 1-45. [https://doi.org/10.1177/22104968261465514](https://doi.org/10.1177/22104968261465514)
