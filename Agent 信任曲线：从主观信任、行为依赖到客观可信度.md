---
title: "Agent 信任曲线：从主观信任、行为依赖到客观可信度"
description: "一套用于定义、采集、统计和运营 Agent 信任数据的方法框架"
date: 2026-11-04
tags:
  - Agent
  - Trust
  - Evaluation
  - Human-AI Collaboration
---

# Agent 信任曲线：从主观信任、行为依赖到客观可信度

当 Agent 从“回答问题”进入“替人执行任务”，产品团队迟早会遇到一个看似简单、实际上很难回答的问题：**用户到底有多信任它？**

仅看满意度不够。用户可能觉得回答流畅，却不敢让 Agent 真正执行；仅看采纳率也不够，用户可能因为没有时间核验而盲目接受；仅看任务成功率仍然不够，一个准确率很高但偶尔造成严重损失的 Agent，并不一定值得托付。

因此，“Agent 信任曲线”不应被理解为一条已有统一公式的行业标准曲线。更稳妥的定义是：它是一组随交互、时间和风险情境变化的序列，用来描述用户如何形成信任、如何把信任转化为依赖，以及这种依赖是否与 Agent 的真实能力相匹配。

本文采用以下联合框架：

> **主观信任 `T(t)` + 行为依赖 `R(t)` + 客观可信度 `W(t)` → 信任校准与适当依赖**

它适用于客服、办公助理和内容生成，也适用于财税、法务、研发运维等高风险 Agent。文章重点不是造一个漂亮的总分，而是建立一套能回答产品和治理问题的数据体系。

---

## 一、先把三个容易混淆的概念分开

### 1. 主观信任：用户相信 Agent 到什么程度

主观信任是用户对 Agent 能力、可预测性、诚实性和善意的心理判断。它通常通过问卷、即时评分或访谈获得，记为：

```text
T(t) = 用户在时刻 t 对 Agent 的主观信任水平
```

主观信任会影响行为，但不等于行为。用户可能相信 Agent 在常规任务上有效，却因为合规要求必须人工复核；也可能不太相信 Agent，但为了赶时间仍直接采用结果。

### 2. 行为依赖：用户实际上把多少决策权交给了 Agent

行为依赖是可观察的使用行为，例如：

- 是否采用 Agent 建议；
- 是否授权自动执行；
- 是否进行人工复核；
- 修改了多少内容；
- 是否撤销、回滚或转人工；
- 遇到高风险任务时是否降低授权范围。

可将它表示为：

```text
R(t) = 用户在时刻 t 对 Agent 的实际依赖程度
```

依赖高不代表信任正确。错误建议被大量采纳，说明的不是“信任很好”，而是**过度依赖**。

### 3. 客观可信度：Agent 是否真的值得被信任

客观可信度来自系统表现和治理证据，记为：

```text
W(t) = Agent 在时刻 t、特定任务和风险条件下的可验证可信度
```

它至少应覆盖：

- 有效性与可靠性：任务成功率、事实正确率、稳定性；
- 安全性：是否产生伤害、越权或不可逆后果；
- 安全韧性：面对攻击、异常输入和工具故障时能否安全退化；
- 可问责与透明：操作是否留痕，责任边界是否明确；
- 可解释与可理解：用户能否理解关键依据和不确定性；
- 隐私与公平：是否泄露敏感数据，是否产生系统性偏差。

这些维度与 NIST AI RMF 1.0 对可信 AI 的特征划分一致。需要注意，客观可信度也不是脱离场景的模型常数。一个 Agent 在“整理会议纪要”上可靠，不代表它在“自动签署合同”上同样可靠。

### 4. 真正的目标不是最高信任，而是校准后的信任

信任治理的目标不是让用户尽可能信任 Agent，而是让信任与能力匹配：

| 状态 | 主观信任/行为依赖 | 客观可信度 | 结果 |
| --- | --- | --- | --- |
| 校准信任 | 与能力匹配 | 高或低均可 | 擅长时采用，不擅长时核验或拒绝 |
| 过度信任 | 过高 | 较低 | 错误建议被接受，风险被放大 |
| 信任不足 | 过低 | 较高 | 正确建议被拒绝，效率和价值损失 |
| 不稳定信任 | 波动大 | 相对稳定 | 使用行为不可预测，难以形成心智模型 |

产品团队不应该把“采纳率提升”单独设为信任建设目标。更合理的目标是：**提高正确建议的采纳率，同时降低错误建议的采纳率。**

---

## 二、信任曲线不是一条线，而是一组条件曲线

### 1. 最小分析单位

信任数据至少有五个关键维度：

```text
用户 × Agent 版本 × 任务类型 × 风险等级 × 时间
```

不建议只画一条“全站信任指数”。同一个用户可能高度信任代码补全，却不信任自动部署；同一个 Agent 版本可能在常规任务上稳定，却在长上下文任务上频繁失败。

更有解释力的曲线包括：

- 用户级曲线：某用户与 Agent 交互后的信任变化；
- 人群级曲线：新用户、专家用户、普通用户的差异；
- 任务级曲线：不同任务类型和难度下的信任；
- 版本级曲线：模型、提示词、工具链升级前后的变化；
- 风险级曲线：低风险与高风险任务中的依赖差异；
- 事件级曲线：故障、纠错、解释或人工接管前后的变化。

### 2. 一条典型曲线的生命周期

Agent 信任通常经历以下阶段：

1. **先验信任**：用户尚未使用，判断来自品牌、同事推荐、界面和产品承诺。
2. **快速校准**：前几次交互权重很大，成功会推动试探性授权，明显失败则迅速降低信任。
3. **稳定使用**：用户形成“它擅长什么、不擅长什么”的心智模型，依赖趋于稳定。
4. **冲击与修复**：严重错误会造成信任断崖；解释、补救和持续正确表现可能逐步修复。
5. **重新校准**：Agent 版本、任务或风险环境改变后，旧信任不应被无条件继承。

研究显示，信任会随每次成功和失败动态更新，而且失败造成的下降往往比成功带来的上升更显著。因此，用月末一次满意度调查代替过程数据，会丢失最重要的变化。

### 3. 三条曲线应放在同一张图上

一个实用的信任看板应同时展示：

```text
T(t)：脉冲问卷或信任量表的平滑值
R(t)：采纳、自动执行、复核和回滚等行为指数
W(t)：经审核的任务成功率与风险加权可信度
```

三条线的偏离比单条线的绝对值更有意义：

- `R(t) > W(t)`：可能存在过度依赖；
- `R(t) < W(t)`：可能存在依赖不足；
- `T(t)` 很高但 `R(t)` 很低：可能有制度约束、界面阻力或问卷偏差；
- `W(t)` 下降而 `T(t)` 未变化：用户尚未感知能力退化，是高风险预警；
- `T(t)` 下降而 `W(t)` 稳定：需要调查解释、体验、舆情或一次高显著性事故。

---

## 三、如何采集信任数据

### 1. 数据来源要形成三角验证

任何单一来源都可能误导，建议组合三类数据：

| 数据层 | 主要来源 | 优点 | 局限 |
| --- | --- | --- | --- |
| 态度层 | 信任量表、即时问卷、访谈 | 直接测量心理判断 | 有自报偏差，频繁询问会干扰用户 |
| 行为层 | 采纳、编辑、复核、授权、回滚 | 连续、低干扰、接近真实使用 | 受流程和权限约束，不能直接等同信任 |
| 结果层 | 人工审核、业务结果、事故记录、离线评测 | 判断 Agent 是否真的正确 | 标签延迟、成本高，部分结果不可验证 |

理想路径是：用行为数据覆盖全量交互，用抽样审核和业务结果建立真值，再用低频问卷解释心理变化。

### 2. 问卷：测状态，不要只测满意度

可以参考 Jian、Bisantz 与 Drury 提出的自动化信任量表，但生产环境不宜每次都发完整量表。更可行的是“基线量表 + 脉冲问卷”：

- 首次使用前：测量先验信任和对自动化的一般态度；
- 完成前 3～5 个任务后：测量快速校准；
- 每隔一段时间随机抽样：测量当前状态；
- 严重失败或恢复流程后：测量冲击与修复；
- 大版本升级后：重新建立基线。

脉冲题可使用 1～7 分量表，例如：

- 我相信该 Agent 能在当前任务中给出可靠结果；
- 我能判断什么时候应该核验它的结果；
- 它会清楚表达不确定性和能力边界；
- 即使允许自动执行，我也能保持对结果的控制；
- 当它出错时，我相信系统能发现、解释并补救。

不要把五题简单相加后永久固定为一个总分。上线前应检查内部一致性、因子结构以及不同人群的测量等价性；否则同样的分数可能代表不同含义。

### 3. 行为埋点：记录“建议—决策—结果”完整链条

一个可分析的最小事件模型如下：

```text
event_time
user_id_hash
session_id
task_id
agent_id
agent_version
task_type
risk_level
difficulty_bucket
human_initial_answer
human_initial_confidence
agent_output
agent_confidence
uncertainty_disclosed
user_action
final_outcome
agent_correctness
final_correctness
error_type
error_severity
review_source
human_intervention_count
edit_distance_semantic
rollback_flag
latency_ms
trust_pulse_score
experiment_id
```

最关键的是把**用户动作**与**最终结果**关联起来。只有“点击采纳”而没有结果标签，无法判断这是适当依赖还是过度依赖。

### 4. 生成式任务不能只用“接受/拒绝”二分

对于文本、代码、方案等生成式任务，建议将用户动作细分为：

```text
accept_as_is       原样接受
accept_minor_edit  轻量修改后接受
accept_major_edit  大幅修改后接受
reference_only     仅作为参考
reject             明确拒绝
rollback           采用后撤销或回滚
```

编辑距离不应只使用字符级 Levenshtein distance。对代码和长文本，更适合同时记录结构差异、语义差异和关键事实变更。用户改了格式不等于不信任；用户只修正一个关键金额，虽然编辑量小，却可能意味着严重错误。

### 5. 真值标签必须允许“不确定”

`agent_correctness` 不要强迫所有任务落入 `correct/incorrect`，应至少保留：

```text
correct | incorrect | partially_correct | unverifiable | pending
```

- `unverifiable`：创意方案、开放式判断等没有唯一真值；
- `pending`：业务结果尚未产生，例如催收策略一个月后才可评价；
- `partially_correct`：主体正确但存在局部缺陷。

如果把不可验证样本当作正确，可信度会被系统性高估；如果直接删除，又会产生选择偏差。看板应单独展示其规模与占比。

---

## 四、核心统计口径：从四象限开始

对于有明确真值、且用户可以接受或拒绝 Agent 建议的任务，可建立最重要的四象限：

| Agent 建议 | 用户接受 | 用户拒绝 |
| --- | --- | --- |
| 正确 | 正确接受 `CA`（Correct Acceptance） | 依赖不足 `UR`（Under-Reliance） |
| 错误 | 过度依赖 `OR`（Over-Reliance） | 正确拒绝 `CR`（Correct Rejection） |

由此得到：

```text
正确建议采纳率 CAR = CA / (CA + UR)
依赖不足率     URR = UR / (CA + UR)
错误建议采纳率 ORR = OR / (OR + CR)
正确拒绝率     CRR = CR / (OR + CR)
适当依赖率     ARR = (CA + CR) / (CA + UR + OR + CR)
依赖辨别力     RD  = CAR - ORR
```

`RD` 越高，说明用户越能区分正确和错误建议。它比总体采纳率更接近“校准后的依赖”。理想情况不是 `CAR=100%`，而是 `CAR` 高、`ORR` 低。

这里有一个常见统计错误：

```text
错误：过度依赖率 = OR / 全部任务
正确：过度依赖率 = OR / 所有错误建议 = OR / (OR + CR)
```

前一个公式同时受 Agent 错误率影响，不能回答“当 Agent 出错时，用户有多大概率仍会采纳”。可以把 `OR / 全部任务` 称为“过度依赖事件占比”，但不能用它替代条件过度依赖率。

### 1. 任务结果指标

仅看依赖行为仍不够，还要比较协作前后的决策质量：

```text
Human Accuracy  = 人类初始答案正确数 / 可判定任务数
Agent Accuracy  = Agent 建议正确数 / 可判定任务数
Team Accuracy   = 最终答案正确数 / 可判定任务数
Complementarity = Team Accuracy - max(Human Accuracy, Agent Accuracy)
```

如果团队准确率没有超过更强的一方，即使用户“适当依赖率”看起来不错，也不一定产生了协作增益。

### 2. 置信度校准指标

如果能收集用户对 Agent 的可信概率 `p_user`，并把实际成功记为 `y∈{0,1}`，可计算：

```text
Signed Calibration Gap = mean(p_user - y)
Absolute Calibration Error = mean(|p_user - y|)
Brier Score = mean((p_user - y)^2)
```

- 有符号差值大于 0，表示总体过度信任；
- 小于 0，表示总体信任不足；
- 绝对误差衡量偏离程度，但不区分方向；
- Brier Score 对“非常自信但判断错误”惩罚更大。

还可以按用户给出的可信概率分桶，得到信任版期望校准误差：

```text
T-ECE = Σ_b (n_b / N) × |mean(p_user,b) - success_rate_b|
```

分桶图应同时显示样本量和置信区间，避免把小样本的随机波动误判为稳定规律。

### 3. 风险加权不能掩盖红线事故

不同错误的代价不同。可按严重度设置权重：

```text
S1 轻微：1
S2 一般：3
S3 严重：10
S4 红线：单独计数并触发告警
```

如果权重表示错误造成的实际严重度，更准确的名称是“风险加权错误负担”：

```text
Risk-Weighted Error Burden = Σ(I(error_i) × severity_cost_i) / N_eligible_tasks
```

如果每个任务在执行前就有可比较的风险暴露权重 `risk_weight_i`，才适合计算归一化比率：

```text
Risk-Weighted Error Rate =
    Σ(I(error_i) × risk_weight_i) / Σ(risk_weight_i)
```

但 `S4` 事故不能被平均分抵消。即使综合指标提高，只要出现越权付款、敏感数据泄露、危险指令执行等红线事件，也应单独进入发布门禁和事故流程。

---

## 五、把离散事件变成动态曲线

### 1. 滚动窗口：最容易上线的基线方案

对每天的指标使用固定窗口，例如最近 7 天、最近 100 次交互：

```text
Metric(t) = sum(valid events in window) / count(valid events in window)
```

滚动窗口直观、容易解释，但有两个问题：窗口边界会造成突变；低频用户要很久才能积累足够样本。因此必须同时设定：

- 时间窗口，如最近 28 天；
- 最大事件数，如最近 100 次；
- 最小有效样本，如 `n >= 30`；
- 低于阈值时显示“数据不足”，而不是硬给排名。

### 2. EWMA：让近期行为拥有更高权重

指数加权移动平均适合连续监控：

```text
S_t = α × x_t + (1 - α) × S_(t-1)
```

其中 `x_t` 可以是一次任务是否成功、是否适当依赖或一次问卷评分。`α` 越大，曲线对近期事件越敏感。可以用半衰期表达参数，更容易和业务沟通：

```text
α = 1 - exp(ln(0.5) / half_life)
```

成功与失败不一定使用相同权重。若历史数据证明严重失败对信任冲击更大，可设置非对称更新：

```text
T_t = T_(t-1) + α_pos × surprise_t,  当结果优于预期
T_t = T_(t-1) + α_neg × surprise_t,  当结果差于预期
且 α_neg > α_pos
```

不能仅凭直觉指定不对称系数，应通过纵向数据估计，并按错误严重度、任务风险和用户专业度分层。

### 3. Beta-Binomial：解决小样本剧烈波动

当指标是二元结果，例如正确建议采纳率，可设置 Beta 先验：

```text
p ~ Beta(a, b)
观察到 success 次成功、failure 次失败后：
p | data ~ Beta(a + success, b + failure)

后验均值 = (a + success) / (a + b + success + failure)
```

这比裸比例稳定，也能直接给出可信区间。例如某用户只有 1 次错误建议且拒绝成功，不能据此宣称其正确拒绝率稳定为 100%。先验可以来自同任务、同风险层级的历史总体，但必须记录来源，并做敏感性分析。

### 4. 曲线一定要带不确定性

看板中不要只画一条实线。至少提供：

- 分子、分母和有效样本量；
- 95% 置信区间或贝叶斯可信区间；
- `pending`、`unverifiable` 和缺失标签占比；
- 数据新鲜度；
- 版本切换和重大事故标记。

对于二项比例，可用 Wilson 区间；对于用户聚类明显的数据，应按用户进行 bootstrap，而不是把每次交互误当成完全独立样本。

---

## 六、进阶建模：估计看不见的信任状态

当产品需要解释“为什么变化”和预测后续依赖时，可以把信任视为潜变量，而不是直接等同于某个点击事件。

### 1. 状态空间模型

设用户的潜在信任为 `z_t`：

```text
状态方程：z_t = z_(t-1) + β₁·success_t + β₂·failure_t
                    + β₃·severity_t + β₄·explanation_t + u_user + ε_t

观测方程：
问卷分数 q_t ~ Normal(z_t, σ_q)
采纳行为 a_t ~ Bernoulli(sigmoid(γ₀ + γ₁·z_t + γ₂·risk_t + γ₃·difficulty_t))
```

这个模型允许心理状态由问卷和行为共同观测，也允许风险、难度和制度约束独立影响采纳。若数据量较小，先用简单的动态线性模型；只有在能够验证预测和参数稳定性后，再增加复杂度。

### 2. 隐马尔可夫模型

也可以把用户划分为若干不可直接观察的状态：

```text
谨慎试用 → 校准依赖 → 过度依赖
    ↑          ↓          ↓
  信任不足 ← 冲击后观望 ← 严重失败
```

HMM 能估计状态转移概率，例如“经历一次 S3 错误后，从校准依赖转为观望的概率”。但状态名称是研究者对统计簇的解释，不应把模型自动产生的簇直接当成心理学事实。

### 3. 混合效应模型

交互数据具有明显的层级结构：任务嵌套于用户，用户嵌套于团队；不同 Agent 版本和任务类型又交叉出现。可使用逻辑混合效应模型：

```text
logit(P(accept_ij)) = β₀ + β₁·agent_correct_ij + β₂·risk_ij
                    + β₃·confidence_shown_ij + β₄·explanation_ij
                    + u_user_i + u_task_j
```

关键交互项是：

```text
agent_correct × intervention
```

如果某种解释或界面提示真的改善适当依赖，它应提高正确建议的采纳概率，或降低错误建议的采纳概率，而不是无差别地提高所有采纳。

### 4. 不要忽略选择偏差

生产数据里，用户不是随机选择任务和授权级别的。经验用户可能只把简单任务交给 Agent，谨慎用户更可能触发人工审核。直接比较两组采纳率，容易把人群差异错当成产品效果。

处理方式包括：

- 在模型中控制任务难度、风险、用户经验和历史表现；
- 使用用户固定效应比较同一个人的前后变化；
- 对界面和解释策略进行随机实验；
- 无法随机时使用倾向得分、差分中的差分等准实验方法；
- 报告未观测混杂风险，不把相关性写成因果结论。

---

## 七、如何统计信任冲击与修复

### 1. 事件研究

以严重错误发生时刻为 `t=0`，对齐不同用户的时间轴，统计事件前后的曲线：

```text
ΔT_k = T_(event+k) - T_(event-1)
ΔR_k = R_(event+k) - R_(event-1)
```

需要同时设置没有发生事故、但用户和任务特征相近的对照组，避免把整体版本变化或季节性误当成事故影响。事件窗口中还应排除同时发生的重大功能改版，或在模型中控制。

建议重点报告：

- 即时冲击幅度：事故后第一次测量的下降；
- 最大跌幅：窗口内最低点相对基线的差；
- 恢复半衰期：恢复一半损失所需交互次数或天数；
- 恢复率：窗口结束时回到基线一定比例的用户占比；
- 永久流失：事故后停止使用或永久关闭自动执行的用户比例。

### 2. 生存分析

把“恢复到事故前信任水平”作为事件，可使用 Kaplan-Meier 曲线或 Cox 模型分析恢复时间；把“停止使用 Agent”作为事件，则可分析信任崩塌后的流失风险。尚未恢复或观察期结束的用户应作为删失数据，不能直接丢弃。

### 3. 修复措施必须分解评估

道歉、错误解释、补偿、人工接管、撤销能力和后续稳定表现可能产生不同效果。实验时应区分：

- 是否更快恢复主观信任；
- 是否恢复了正确建议采纳；
- 是否也意外提高了错误建议采纳；
- 是否降低后续事故率；
- 效果是否只存在于低风险任务。

如果主观信任恢复了，但客观能力没有改善，修复措施可能只是制造了新的过度信任。

---

## 八、实验设计：验证什么真正改善了信任校准

可以测试的产品干预包括：不确定性提示、证据引用、先让用户独立判断、错误类型说明、分级授权、二次确认和人工复核入口。实验的主指标不能只选采纳率或问卷信任分，而应组成指标组：

```text
主指标：RD、ARR、Team Accuracy 或风险加权业务结果
护栏指标：ORR、S3/S4 事故、回滚率、隐私与越权事件
解释指标：T(t)、CAR、复核率、耗时、用户负担
```

实验设计需要注意：

- 以用户或团队为随机化单位，避免同一用户在多个版本间学习和串扰；
- 在实验前定义主要假设、样本量、停止规则和排除标准；
- 按任务风险和 Agent 正误分别报告效果；
- 对多指标和多分组比较控制假阳性；
- 报告效应量与区间，不只报告 `p < 0.05`；
- 高风险功能先在模拟环境、影子流量或有限授权中验证。

解释并不天然提升适当依赖。有些解释只是让答案更有说服力，可能同时提高正确和错误建议的采纳。Vasconcelos 等人的研究也表明，解释能否降低过度依赖取决于用户是否有能力和动机处理解释。因此，必须直接观察 `ORR`，不能以“用户看过解释”作为成功证据。

---

## 九、一个可运行的 SQL 统计示例

假设明细表 `agent_trust_events` 已经把用户决策与审核结果连接起来，以下 SQL 计算每日四象限指标。示例使用接近 PostgreSQL 的语法，生产环境应按实际数仓调整。

```sql
WITH labeled AS (
    SELECT
        DATE(event_time) AS dt,
        agent_version,
        task_type,
        risk_level,
        CASE
            WHEN user_action IN ('accept_as_is', 'accept_minor_edit')
                THEN TRUE
            WHEN user_action IN ('reject', 'reference_only')
                THEN FALSE
            ELSE NULL
        END AS accepted,
        CASE
            WHEN agent_correctness = 'correct' THEN TRUE
            WHEN agent_correctness = 'incorrect' THEN FALSE
            ELSE NULL
        END AS agent_correct
    FROM agent_trust_events
    WHERE event_time >= CURRENT_DATE - INTERVAL '28 days'
),
confusion AS (
    SELECT
        dt,
        agent_version,
        task_type,
        risk_level,
        COUNT(*) FILTER (WHERE agent_correct AND accepted) AS ca,
        COUNT(*) FILTER (WHERE agent_correct AND NOT accepted) AS ur,
        COUNT(*) FILTER (WHERE NOT agent_correct AND accepted) AS oor,
        COUNT(*) FILTER (WHERE NOT agent_correct AND NOT accepted) AS cr,
        COUNT(*) FILTER (WHERE accepted IS NULL OR agent_correct IS NULL)
            AS excluded_n
    FROM labeled
    GROUP BY dt, agent_version, task_type, risk_level
)
SELECT
    *,
    ca::numeric / NULLIF(ca + ur, 0) AS correct_acceptance_rate,
    ur::numeric / NULLIF(ca + ur, 0) AS under_reliance_rate,
    oor::numeric / NULLIF(oor + cr, 0) AS over_reliance_rate,
    cr::numeric / NULLIF(oor + cr, 0) AS correct_rejection_rate,
    (ca + cr)::numeric / NULLIF(ca + ur + oor + cr, 0)
        AS appropriate_reliance_rate,
    ca::numeric / NULLIF(ca + ur, 0)
        - oor::numeric / NULLIF(oor + cr, 0)
        AS reliance_discrimination
FROM confusion
ORDER BY dt, agent_version, task_type, risk_level;
```

这里把 SQL 别名写为 `oor`，是为了避开部分数据库中的关键字冲突；业务含义仍然是前文的 `OR`。`accept_major_edit`、`rollback` 和 `partially_correct` 没有被武断地归类，而是保留给业务规则处理。

如果需要 28 天滚动曲线，应先聚合四个计数，再对计数做窗口求和，最后相除。**不能直接对每天的比例做简单平均**，否则小样本日期会获得与大样本日期相同权重。

---

## 十、信任看板应该回答什么问题

### 1. 总览层：现在是否处于健康状态

总览建议展示：

- `T(t)`、`R(t)`、`W(t)` 三条带区间的时间序列；
- `CAR`、`ORR`、`ARR`、`RD`；
- Team Accuracy 与 Complementarity；
- S3/S4 事故数、风险加权错误率；
- 回滚、人工接管和自动执行比例；
- 可判定、待定、不可验证和缺失样本占比。

### 2. 诊断层：问题发生在哪里

支持按以下维度下钻：

- Agent、模型、提示词、工具和版本；
- 任务类型、难度和风险等级；
- 用户经验、角色、团队和使用频率；
- 是否展示置信度、解释、引用或警告；
- 首次使用、稳定使用、事故后等生命周期阶段；
- 错误类型与严重度。

下钻时优先展示分子分母、区间和原始样本入口，防止团队只看颜色判断问题。

### 3. 事件层：什么改变了曲线

在时间轴上标注：

- Agent 或基础模型版本发布；
- 提示词、工具权限和知识库变更；
- 严重事故与恢复措施；
- 问卷、实验和运营活动；
- 审核规则与真值口径变化。

没有事件标记的曲线很容易被过度解释。一次指标突变可能来自产品能力变化，也可能只是审核团队改变了标签标准。

### 4. 告警层：什么时候必须介入

示例规则：

```text
S4 事故数 > 0                                      立即告警并按规则停用
高风险任务 ORR 的 7 日下置信界 > 发布门槛          阻止扩大自动化范围
W(t) 明显下降但 R(t) 未同步下降                    过度依赖预警
RD 连续两个窗口下降且样本充分                      启动根因分析
pending 或 unverifiable 占比异常上升               检查标签管道
版本发布后关键指标越过控制图边界                   评估回滚
```

阈值应依据历史基线、风险偏好和业务损失设定，不宜复制一个通用数值。

---

## 十一、数据质量与统计陷阱

### 1. 标签不是天然真值

人工审核也会出错。应记录审核人、审核规范版本和证据来源，并定期抽取双人标注样本，计算 Cohen's kappa、Krippendorff's alpha 或类别级一致率。争议样本应仲裁，不能用多数人的直觉掩盖定义不清。

### 2. 延迟结果会造成右删失

如果只统计已经产生业务结果的任务，近期数据会偏向反馈快的任务。应按结果成熟期建立 cohort，在同一成熟度下比较，或使用生存分析。日报可展示先行指标，但必须标注“未成熟”。

### 3. 辛普森悖论

总体准确率上升，可能只是简单任务占比增加。所有核心指标至少按任务类型、风险和难度分层，并同时报告标准化后的总体结果。

### 4. 重复交互不独立

一个重度用户贡献数千条记录，不能让他在统计上等同于数千个独立用户。汇总时同时给出交互加权和用户等权结果；推断时使用聚类稳健标准误、层级模型或用户级 bootstrap。

### 5. 问卷响应偏差

极满意或极不满意的人更可能回答问卷。应记录曝光率、响应率和响应时延，比较响应者与未响应者的行为特征，必要时进行逆概率加权。不要把问卷均分直接外推到全部用户。

### 6. 指标会被优化行为改变

一旦“采纳率”成为团队 KPI，界面可能被设计得更容易接受，而不是真正更可靠。指标组必须同时包含结果、风险和反向指标，并允许审计原始事件。

---

## 十二、要不要做一个综合“信任指数”

管理层通常希望看到一个数。可以构造导航性指数，但必须先标准化，并明确权重：

```text
Trust Health Index =
    w₁ × normalized(T)
  + w₂ × normalized(RD)
  + w₃ × normalized(W)
  - w₄ × normalized(Risk Loss)
```

这个指数只能用于发现趋势，不能替代分项决策，原因包括：

- 不同维度可能相互抵消；
- 权重包含价值判断，不是自然常数；
- 不同任务的风险尺度不可直接比较；
- S4 红线事件不能被其他高分抵消；
- 指数变化无法直接告诉团队应该修模型、改交互还是改流程。

每次展示总分时，都应允许一键展开 `T/R/W`、四象限和风险事件；权重、标准化区间和版本必须可追溯。

---

## 十三、分阶段落地路线

### 阶段一：建立事实层（2～4 周）

- 定义任务、建议、用户决策和结果四类对象；
- 统一接受、编辑、拒绝、回滚和人工接管事件；
- 建立 `correct/incorrect/partial/unverifiable/pending` 标签；
- 先上线四象限、任务成功率和事故严重度；
- 按版本、任务和风险切分，不急于做总分。

交付物是事件字典、数据血缘、基础 SQL 和第一版看板。

### 阶段二：建立曲线层（4～8 周）

- 上线基线量表和低频脉冲问卷；
- 使用滚动窗口与 EWMA 画 `T/R/W`；
- 加入 Wilson 区间或 Beta-Binomial 后验；
- 标注版本和事故事件；
- 建立高风险 `ORR` 与 S4 告警。

交付物是可解释的动态曲线和运营告警，而不是预测模型。

### 阶段三：建立因果与治理层（持续）

- 使用 A/B 实验评估解释、置信度和分级授权；
- 通过事件研究分析事故冲击和恢复；
- 使用混合效应或状态空间模型解释异质性；
- 将指标接入发布门禁、权限升级和模型回滚；
- 定期审查指标是否被产品机制或组织 KPI 扭曲。

交付物是“评测—上线—监控—干预—复盘”的闭环。

---

## 十四、建议的指标字典

| 指标 | 定义 | 主要用途 | 不能单独代表什么 |
| --- | --- | --- | --- |
| 主观信任 `T` | 量表或脉冲问卷的潜变量/标准化得分 | 理解用户心理状态 | 实际依赖、Agent 正确性 |
| 总采纳率 | 被接受建议 / 可决策建议 | 使用行为概览 | 适当依赖 |
| `CAR` | 正确建议中被接受的比例 | 识别信任不足 | 错误建议风险 |
| `ORR` | 错误建议中被接受的比例 | 识别过度依赖 | Agent 自身错误频率 |
| `ARR` | 正确接受和正确拒绝占比 | 总体依赖适当性 | 错误严重度 |
| `RD` | `CAR - ORR` | 区分正确与错误建议的能力 | 最终业务收益 |
| `W` | 可靠、安全、透明等客观证据组合 | 判断是否值得信任 | 用户是否理解系统 |
| Team Accuracy | 人机协作后的最终准确率 | 评估协作结果 | 风险损失全部维度 |
| Complementarity | 团队准确率减去人机较强一方准确率 | 判断协作增益 | 成本和时延 |
| 回滚率 | 采用后撤销或回滚的比例 | 发现延迟暴露的问题 | 所有错误 |
| 恢复半衰期 | 事故后恢复一半信任损失的时间 | 评估修复能力 | 客观能力是否已修复 |

---

## 结语

Agent 信任不是一种可以靠满意度或采纳率单独描述的情绪指标。它至少包含三个不同问题：用户认为 Agent 是否可靠，用户实际把多少决策权交给它，以及 Agent 是否真的值得这份托付。

因此，可信的统计方法应遵循四个原则：

1. **分开测量**：主观信任、行为依赖和客观可信度不能互相替代。
2. **按条件统计**：过度依赖必须在 Agent 错误的条件下计算，信任必须按任务和风险分层。
3. **动态观察**：记录逐次交互、重大冲击和修复过程，而不是只看期末均值。
4. **以适当依赖为目标**：让用户在 Agent 正确时采用，在 Agent 错误时拒绝，并让人机组合优于任何单独一方。

一条真正有用的信任曲线，不是不断向上的曲线。它应该能随能力变化而变化，能在风险升高时变得谨慎，也能在证据充分时恢复授权。这样的曲线才不是“用户更相信 AI”的包装，而是人机协作是否进入可测量、可解释、可治理状态的证据。

---

## 参考文献与在线资料

1. Lee, J. D., & See, K. A. (2004). *Trust in Automation: Designing for Appropriate Reliance*. Human Factors, 46(1), 50–80. [https://doi.org/10.1518/hfes.46.1.50_30392](https://doi.org/10.1518/hfes.46.1.50_30392)
2. Jian, J.-Y., Bisantz, A. M., & Drury, C. G. (2000). *Foundations for an Empirically Determined Scale of Trust in Automated Systems*. International Journal of Cognitive Ergonomics, 4(1), 53–71. [https://doi.org/10.1207/S15327566IJCE0401_04](https://doi.org/10.1207/S15327566IJCE0401_04)
3. Tabassi, E. (2023). *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*. NIST AI 100-1. [https://doi.org/10.6028/NIST.AI.100-1](https://doi.org/10.6028/NIST.AI.100-1)
4. NIST AI Resource Center. *Characteristics of Trustworthy AI Systems*. [https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/)
5. Schemmer, M., Kühl, N., Benz, C., Bartos, A., & Satzger, G. (2023). *Appropriate Reliance on AI Advice: Conceptualization and the Effect of Explanations*. Proceedings of IUI '23, 410–422. [https://doi.org/10.1145/3581641.3584066](https://doi.org/10.1145/3581641.3584066)
6. Vasconcelos, H., Jörke, M., Grunde-McLaughlin, M., Gerstenberg, T., Bernstein, M. S., & Krishna, R. (2023). *Explanations Can Reduce Overreliance on AI Systems During Decision-Making*. Proceedings of the ACM on Human-Computer Interaction, 7(CSCW1). [https://doi.org/10.1145/3579605](https://doi.org/10.1145/3579605)
7. Yang, X. J., Schemanske, C., & Searle, C. (2023). *Toward Quantifying Trust Dynamics: How People Adjust Their Trust After Moment-to-Moment Interaction With Automation*. Human Factors, 65(5), 862–878. [https://doi.org/10.1177/00187208211034716](https://doi.org/10.1177/00187208211034716)
8. Steyvers, M., & Kumar, A. (2024). *Three Challenges for AI-Assisted Decision-Making*. Perspectives on Psychological Science, 19(5), 722–734. [https://doi.org/10.1177/17456916231181102](https://doi.org/10.1177/17456916231181102)
9. Lucas, G. M., Becerik-Gerber, B., & Roll, S. C. (2024). *Calibrating Workers' Trust in Intelligent Automated Systems*. Patterns, 5(9), 101045. [https://doi.org/10.1016/j.patter.2024.101045](https://doi.org/10.1016/j.patter.2024.101045)
10. Passi, S., Dhanorkar, S., & Vorvoreanu, M. (2024). *Appropriate Reliance on Generative AI: Research Synthesis*. Microsoft Technical Report MSR-TR-2024-7. [https://www.microsoft.com/en-us/research/publication/appropriate-reliance-on-generative-ai-research-synthesis/](https://www.microsoft.com/en-us/research/publication/appropriate-reliance-on-generative-ai-research-synthesis/)

> 注：以上资料用于建立定义、测量与统计框架。本文中的 `T(t)`、`R(t)`、`W(t)` 联合表示、部分工程字段和看板结构是面向 Agent 产品落地的综合设计，并非任何单篇论文提出的统一行业标准。
