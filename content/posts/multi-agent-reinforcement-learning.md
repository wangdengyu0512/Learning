---
title: 多智能体强化学习入门：从 Dec-POMDP、CTDE 到 QMIX 与 MAPPO
description: 系统理解多智能体强化学习的建模方式、非平稳性与信用分配难题，拆解 CTDE、值分解和策略梯度两条技术路线，并说明如何正确实验与选型。
date: 2026-10-28
tags: 强化学习, 多智能体, 人工智能
featured: false
---

假设一个仓库里有十台搬运机器人。每台机器人只能看到附近的货架与同伴，却要共同完成订单；如果大家都去抢最近的任务，通道会拥堵，如果各自只顾避障，又可能没人处理远处的货物。这里真正困难的不是“让一台机器人学会移动”，而是让多个决策者在信息不完整、行为相互影响的环境中形成合作。

这正是**多智能体强化学习**（Multi-Agent Reinforcement Learning，MARL）研究的问题。它把强化学习从“一个策略面对一个环境”扩展到“多个策略同时学习并共同改变环境”。扩展后的难点不只是计算量增加：对任意一个智能体而言，其他智能体都在学习，所以环境本身看起来也在变化；团队得到同一个奖励时，还必须判断功劳或责任属于谁。

本文围绕合作型 MARL 展开，目标是回答五个问题：

1. MARL 通常如何建模？
2. 非平稳性、信用分配和局部可观测为什么难？
3. CTDE 为什么成为主流训练范式？
4. QMIX 与 MAPPO 分别解决了什么问题，又有哪些限制？
5. 如何设计一个可信的 MARL 对比实验？

在进入算法之前，还需要划清两个边界：MARL 不等于“多个大语言模型 Agent 协作”，也不等于粒子群优化、蚁群算法等群体智能算法。它们可能共享“多个个体产生整体行为”的外观，但学习机制和要解决的问题并不相同。

## 1. 从单智能体强化学习到 Dec-POMDP

单智能体强化学习常用马尔可夫决策过程（MDP）表示：智能体观察状态，执行动作，环境转移到新状态并返回奖励。策略的目标是最大化长期累计回报。

合作型 MARL 常用**分散式部分可观测马尔可夫决策过程**（Decentralized Partially Observable Markov Decision Process，Dec-POMDP）表示：

```text
G = <N, S, A, P, R, O, Z, gamma>
```

其中：

- `N`：智能体集合，例如 `N = {1, 2, ..., n}`；
- `S`：环境的真实全局状态；
- `A = A_1 x ... x A_n`：联合动作空间；
- `P(s' | s, a)`：执行联合动作后，环境状态的转移概率；
- `R(s, a)`：团队奖励函数；
- `O`：各智能体可能获得的局部观测空间；
- `Z(o | s, i)`：智能体 `i` 在状态 `s` 下获得观测 `o` 的概率；
- `gamma`：折扣因子。

在时刻 `t`，每个智能体 `i` 只获得局部观测 `o_i^t`，再根据自己的动作-观测历史 `tau_i^t` 选择动作 `a_i^t`。所有动作组成联合动作：

```text
a^t = (a_1^t, a_2^t, ..., a_n^t)
```

环境根据联合动作发生转移，并给团队返回奖励 `r_t`。合作型任务的共同目标是最大化期望折扣回报：

```text
J = E[r_0 + gamma * r_1 + gamma^2 * r_2 + ...]
```

这里有一个容易被忽略的区别：**状态不等于观测**。全局状态可能包含所有智能体的位置、速度、任务进度等信息，但执行时，一台机器人通常只能访问传感器范围内的局部观测。训练算法可以利用多少全局信息，正是后面 CTDE 要处理的问题。

## 2. MARL 为什么比单智能体 RL 更难

### 2.1 学习过程是非平稳的

在单智能体 MDP 中，只要环境动力学固定，执行某个动作后的结果分布就相对稳定。MARL 中，智能体 `i` 观察到的转移还取决于其他智能体的策略：

```text
P_i(s' | s, a_i) = sum over a_-i of P(s' | s, a_i, a_-i) * pi_-i(a_-i | tau_-i)
```

当其他智能体更新策略 `pi_-i` 时，智能体 `i` 所面对的有效转移分布也随之变化。昨天收集的经验，放到今天可能已经过时。由此会带来：

- 经验回放中的旧数据与当前联合策略不一致；
- 单个智能体难以判断回报变化来自自身动作，还是同伴策略更新；
- 多个学习者互相追逐，训练容易震荡或退化。

Independent Q-Learning（IQL）直接把其他智能体当作环境的一部分，简单且容易扩展，但它也因此没有从建模上解决非平稳性。

### 2.2 团队奖励带来信用分配问题

如果五个智能体只收到一个团队奖励，如何判断哪个动作真正促成了成功？这就是**多智能体信用分配**。

例如，一名智能体主动让路，短期看没有直接得分，却使另一名智能体及时完成任务。若所有智能体都用完全相同的团队回报更新，关键的让路行为可能被噪声淹没。反过来，任务失败也不意味着每名智能体的行为都错了。

信用分配大致有两类思路：

- **反事实基线**：固定其他智能体的动作，比较“当前动作”与“可能采取的其他动作”，COMA 是代表方法；
- **价值分解**：把联合价值 `Q_tot` 分解为各智能体局部价值的某种组合，VDN、QMIX、QTRAN、QPLEX 属于这条路线。

### 2.3 局部可观测导致信息不完备

单次观测往往不足以判断真实状态。智能体可能需要循环网络对历史信息编码，形成内部记忆。例如看到一个同伴离开视野，并不意味着它已经退出任务；策略需要结合此前轨迹推断其可能位置。

局部可观测还会造成**感知混叠**：两个真实状态在局部视角下完全相同，但最佳动作不同。扩大网络容量不能凭空补回缺失信息，通常要依靠历史序列、通信机制或训练阶段的全局信息。

### 2.4 联合动作空间指数增长

如果每个智能体有 `m` 个离散动作，`n` 个智能体的联合动作数量为 `m^n`。十个智能体各有五个动作，就对应 `5^10 = 9,765,625` 种联合动作。直接学习一张联合 Q 表或枚举全局最优动作，很快就不可行。

因此，MARL 需要同时兼顾两件事：训练时理解智能体之间的耦合，执行时又让每个智能体能够独立、快速地行动。

## 3. CTDE：训练时集中，执行时分散

**集中训练、分散执行**（Centralized Training with Decentralized Execution，CTDE）是现代合作型 MARL 最常见的范式。

```text
训练阶段：全局状态 + 所有动作/观测
              |
       集中式 critic 或 mixing network
              |
        为各智能体提供学习信号

执行阶段：o_1 -> policy_1 -> a_1
          o_2 -> policy_2 -> a_2
          ...
          o_n -> policy_n -> a_n
```

训练时，集中式价值函数可以看到全局状态、其他智能体动作或联合观测，从而更准确地估计价值、减少非平稳性造成的噪声。执行时，每个策略只依赖自己的局部观测或历史，因此不要求持续连接中央控制器，也不会使用部署环境中不可获得的信息。

CTDE 是一种**信息权限安排**，不是某个具体算法。它可以出现在不同方法中：

- MADDPG 使用能够看到联合信息的集中式 critic；
- COMA 使用集中式 critic 计算反事实优势；
- QMIX 在训练时用全局状态调节 mixing network；
- MAPPO 通常让 value function 使用全局信息，而各 actor 使用局部观测。

CTDE 也不是免费的午餐。训练时使用的信息越强，越需要检查训练与部署之间是否存在信息泄漏。如果 actor 间接依赖了执行时不可用的全局状态，那么它就不再是真正的分散执行。

## 4. 代表算法放在同一张地图上

下面的表格不是性能排行榜，而是用来识别各算法的建模假设。

| 算法 | 主要路线 | 典型动作空间 | 集中训练信息 | 优点 | 主要限制 |
| --- | --- | --- | --- | --- | --- |
| IQL | 独立价值学习 | 离散 | 通常无 | 简单、扩展容易，可直接复用 DQN | 把其他学习者视作环境，非平稳问题明显 |
| MADDPG | Actor-Critic | 连续为主 | critic 使用联合观测与动作 | 将 DDPG 扩展到多智能体，可处理混合合作竞争 | 对超参数和规模较敏感，off-policy 数据会过时 |
| COMA | 多智能体策略梯度 | 离散 | 集中式 critic | 用反事实基线处理信用分配 | critic 训练和动作边缘化开销较大 |
| VDN | 价值分解 | 离散 | 联合回报 | 结构简单，局部贪心与全局贪心一致 | 只允许加法分解，表达能力有限 |
| QMIX | 单调价值分解 | 离散 | mixing network 使用全局状态 | 表达力强于 VDN，仍能分散贪心执行 | 单调约束无法表示所有联合价值函数 |
| MAPPO | On-policy Actor-Critic | 离散或连续 | value function 使用全局信息 | 实现直观、训练稳定，是常用强基线 | 样本复用率低，数据采集成本可能较高 |

这些方法可以归为两条主线。基于价值的方法通常适合合作型离散动作任务：每个智能体估计局部动作价值，再通过某种结构形成团队价值。演进关系可粗略理解为 `IQL -> VDN -> QMIX -> Weighted QMIX / QPLEX`，QTRAN 则尝试更一般的分解。

Actor-Critic 方法直接优化策略：actor 负责选择动作，critic 评估状态或动作价值。借助集中式 critic，它可以考虑其他智能体的行为，同时保留分散 actor。MADDPG、COMA、Actor-Attention-Critic 和 MAPPO 都可以放在这条线上。

价值方法与策略梯度方法没有绝对胜负。动作空间、是否能够在线采样、策略随机性、样本成本和实现复杂度都会改变选择。

## 5. QMIX：用单调混合连接局部价值与团队价值

QMIX 是合作型离散动作 MARL 的代表算法。它试图同时满足两个目标：训练时学习能够反映团队协作的联合动作价值；执行时让每个智能体只根据自己的局部 Q 值选动作。

### 5.1 网络结构

QMIX 为每个智能体构建局部效用网络：

```text
Q_i(tau_i, a_i)
```

局部网络只接收智能体自己的历史或观测。训练时，mixing network 将所有 `Q_i` 合成为团队价值：

```text
Q_tot = Mix(Q_1, Q_2, ..., Q_n; global_state)
```

全局状态不直接进入各智能体的局部策略，而是输入 hypernetwork，由 hypernetwork 生成 mixing network 的权重。这样，团队价值的组合方式可以随状态变化。

### 5.2 单调性约束为什么关键

QMIX 对 mixing network 施加约束：`Q_tot` 对每个 `Q_i` 的偏导不小于零。直观地说，提高任何一个局部效用，都不能让团队价值下降。

```text
partial Q_tot / partial Q_i >= 0
```

这个约束保证了 Individual-Global-Max（IGM）性质：分别对每个局部 Q 值取最大动作，能够得到使 `Q_tot` 最大的联合动作。

```text
a_i* = argmax over a_i of Q_i(tau_i, a_i)
```

于是执行阶段不需要 mixing network，也不需要枚举指数级联合动作。每个智能体独立选择 `a_i*` 即可。

### 5.3 训练过程与能力边界

QMIX 通常使用类似 DQN 的时序差分学习：从经验回放中采样完整 episode 或序列，当前网络计算 `Q_tot`，目标网络计算下一时刻的目标值，然后最小化 TD 误差。

```text
target = r + gamma * max Q_tot(next_state, next_joint_action)
loss   = (Q_tot - target)^2
```

实际实现还要处理可用动作掩码、终止状态、循环网络隐藏状态、目标网络同步和 padding mask。

单调性让分散贪心执行成为可能，但也限制了表达能力。在某些任务中，一个智能体动作的价值会随着另一个智能体动作改变而反转。例如，两名智能体必须选择不同开关才得分；某个动作单独看没有稳定的高低顺序。此时，真实联合 Q 函数未必能被单调分解。

后续工作从不同方向放宽限制：QTRAN 通过额外约束尝试更一般的分解，Weighted QMIX 调整不同样本的学习权重，QPLEX 使用 duplex dueling 结构扩大可表示的 IGM 函数范围。不过，更强的表达能力通常也意味着更复杂的优化。

## 6. MAPPO：简单 PPO 如何成为强基线

MAPPO（Multi-Agent PPO）并不是给 PPO 加上一条神秘公式，而是把 PPO 放进 CTDE 框架，并针对合作型 MARL 做出一组关键实现选择。论文《The Surprising Effectiveness of PPO in Cooperative Multi-Agent Games》显示，经过严谨调参与实现后，on-policy PPO 在多个合作任务上可以成为很有竞争力的基线。

### 6.1 Actor 与 critic 的分工

MAPPO 中，每个 actor 根据局部观测输出动作分布：

```text
pi_i(a_i | o_i)  或  pi_i(a_i | tau_i)
```

集中式 value function 则可以使用全局状态或联合观测：

```text
V(s)  或  V(o_1, o_2, ..., o_n)
```

critic 在训练阶段提供更低方差的优势估计，actor 在部署时仍只依赖本地信息。对于同质智能体，常见做法是共享 actor 参数，并附加 agent ID 或角色特征来区分个体；异质智能体则可能需要分组共享或独立网络。

### 6.2 PPO 裁剪目标

PPO 比较新旧策略对已采样动作的概率比：

```text
ratio = pi_new(a | o) / pi_old(a | o)
```

更新时使用裁剪目标，限制单次策略变化幅度。优势为正时，希望提高该动作概率；优势为负时，希望降低概率，但两种变化都不会无限放大。多智能体同时更新时，这种保守更新尤其重要，因为每个策略的大幅改变都会放大其他智能体眼中的非平稳性。

MAPPO 通常还会结合：

- GAE（Generalized Advantage Estimation）计算优势；
- value normalization 或 reward normalization；
- 合理控制每批数据重复更新的 epoch 数；
- 对终止状态和因时间上限截断的状态作不同处理；
- 使用动作可用性掩码；
- 在循环策略中正确切分序列并传递隐藏状态。

### 6.3 为什么 MAPPO 值得先做基线

MAPPO 的价值不在于“总是优于 off-policy 方法”。它的优势是概念清晰、训练相对稳定，并且统一支持离散与连续动作。它也有明确缺点：on-policy 数据通常在若干轮更新后就被丢弃，样本复用率低；如果环境交互昂贵，训练成本可能高于基于经验回放的方法。

因此，更准确的结论是：**MAPPO 是合作型 MARL 中应当认真对待的强基线，但不是对所有任务都占优的通用答案。**

## 7. MARL、群体智能与多 LLM Agent 的边界

### 7.1 MARL 与群体智能不是同一个概念

粒子群优化（PSO）模拟群体中个体参考自身历史最优和群体最优位置进行搜索；蚁群优化（ACO）通过信息素强化有潜力的路径。它们通常用于连续优化、组合优化或路径搜索，最终输出一个或一组优化解。

MARL 则主要学习动态环境中的序列决策策略，结果通常是“面对不同观测时如何行动”。两者的区别可概括如下：

| 维度 | 多智能体强化学习 | 典型群体智能算法 |
| --- | --- | --- |
| 核心问题 | 多个决策者在动态环境中学习策略 | 借助种群协作搜索优化解 |
| 学习信号 | 奖励、回报、价值或策略梯度 | 适应度、个体最优、群体最优、信息素 |
| 交互时间 | 强调连续状态转移与长期回报 | 通常强调迭代搜索过程 |
| 输出 | 一个或多个可执行策略 | 最优解、近似解或候选解集 |
| 代表方法 | QMIX、MAPPO、MADDPG | PSO、ACO、人工蜂群算法 |
| 典型应用 | 机器人协作、交通控制、博弈 | 参数优化、调度、路径规划 |

二者也可以结合。例如，用 PSO 搜索 MARL 超参数，或用强化学习动态调整群体智能算法的算子。但“能够结合”不代表概念可以互换。

### 7.2 MARL 与多 LLM Agent 也不能画等号

多个大语言模型 Agent 可以通过角色分工、自然语言通信、工具调用和任务编排共同完成工作，但这个系统未必进行强化学习。只有当策略通过环境交互和奖励信号更新，且问题被建模为多智能体序列决策时，才进入 MARL 的核心范畴。

大语言模型可以成为 MARL 中的策略表示、通信模块或高层规划器；MARL 也可以优化 Agent 的协作行为。这是交叉研究方向，而不是两个术语的同义替换。

## 8. 如何设计一个可信的 MARL 实验

算法论文中的一条胜率曲线，远不足以证明方法更好。MARL 对环境版本、实现细节、随机种子和评估协议都很敏感。

### 8.1 环境与工具

常见合作型基准包括：

- **PettingZoo**：提供统一的多智能体环境 API，适合教学、原型和跨环境实验；
- **SMAC**：基于《星际争霸 II》微操任务，常用于测试合作与信用分配；
- **SMACv2**：增加程序化生成与随机性，更强调泛化能力，而非记住固定单位配置；
- **Melting Pot**：关注多智能体社会情境、合作与一般化；
- **MPE**：粒子世界任务规模较小，适合快速验证算法实现。

训练框架方面，可考察 PyMARL、MARLlib、EPyMARL 或基于 PettingZoo 的自定义实现。框架名称不是实验质量保证，必须核对算法版本、环境 wrapper、终止条件和评估逻辑。

### 8.2 一个 Simple Spread 对比方案

PettingZoo MPE 中的 `simple_spread` 是直观的合作任务：多个智能体需要覆盖多个地标，同时避免碰撞。可以比较 IQL、QMIX 和 MAPPO，观察三种不同范式。

**固定条件：**

- 使用同一环境版本、智能体数量、观测定义和 episode 长度；
- 明确训练环境步数，而不是只比较 update 次数；
- 为每个算法使用相同的一组随机种子，例如至少 5 个；
- 超参数搜索预算尽量一致，并公开最终配置；
- 训练与评估环境分离，评估时关闭额外探索噪声。

**建议指标：**

- 平均团队回报；
- 地标覆盖率与完成时间；
- 智能体之间的碰撞次数；
- 达到某个性能阈值所需的环境步数；
- 不同随机种子之间的标准差或置信区间；
- wall-clock 时间、峰值显存和推理延迟。

一个简化的实验循环如下：

```text
for seed in seeds:
    initialize environment and algorithm with seed

    while environment_steps < budget:
        collect trajectories
        update IQL / QMIX from replay, or update MAPPO on-policy

        every evaluation_interval:
            run deterministic evaluation episodes
            record return, coverage, collisions and elapsed time

aggregate all seeds
report mean, dispersion and learning curves
```

这里不能只保证三种算法的网络层数完全相同。IQL、QMIX 和 MAPPO 的数据利用方式不同，更重要的是统一环境交互预算，并分别给予合理调参。把所有算法强行套用同一个学习率，也不等于公平。

### 8.3 结果解读检查表

阅读或复现实验时，至少检查以下问题：

1. 曲线来自多少个随机种子，阴影表示标准差、标准误还是置信区间？
2. 横轴是环境步数、episode、梯度更新次数，还是 wall-clock 时间？
3. 评估时是否关闭 epsilon-greedy、动作噪声等探索机制？
4. centralized critic 是否使用了部署时不可获得的信息？
5. 训练与测试是否使用同一批固定地图或场景？
6. 是否报告最终性能、样本效率和稳定性，而不是只挑最优种子？
7. 是否公开环境版本、终止处理、网络结构和关键超参数？

在 MARL 中，“平均更高但方差巨大”和“稍低但稳定复现”代表不同工程价值。结论应与实际部署目标一致。

## 9. 如何选择算法

可以先按下面的顺序缩小范围：

```text
任务是否是序列决策？
  否 -> 如果目标是搜索最优解，优先考虑 PSO、ACO 等优化算法
  是
  |
  +-- 是否存在多个相互影响的决策者？
        否 -> 单智能体 RL 可能已经足够
        是
        |
        +-- 合作任务 + 离散动作 + 可进行集中训练
        |     -> 先比较 IQL、QMIX、MAPPO
        |
        +-- 连续控制
        |     -> 先比较 MAPPO、MADDPG 及其后续方法
        |
        +-- 环境交互非常昂贵
              -> 重点考察 off-policy 或离线 MARL，谨慎评估分布偏移
```

工程上还应考虑通信条件、智能体异质性、训练与部署时的规模变化、安全约束，以及训练阶段能否记录全局状态和所有动作。

如果是第一次在新环境中做 MARL，不应直接从最复杂的新算法开始。一个实际可行的顺序是：随机策略与规则策略用于校验环境，IQL 暴露独立学习的难点，MAPPO 提供稳定策略梯度基线，离散合作任务再加入 QMIX。只有基线可靠，后续结构创新才有解释力。

## 10. 值得继续关注的方向

MARL 仍有许多未解决的问题：

- **泛化与零样本协作**：面对新地图、新队友和不同数量的智能体，策略能否继续工作；
- **离线 MARL**：只使用历史日志学习，同时控制多智能体分布偏移与外推误差；
- **通信学习**：在有限带宽下学习何时通信、传递什么，以及如何解释消息；
- **平均场方法**：用群体分布近似大量智能体的相互作用，降低规模复杂度；
- **鲁棒性与安全**：处理队友失效、对手扰动、传感器噪声和奖励误设；
- **人类与语言模型协作**：把自然语言先验、高层规划和可学习的低层策略结合起来。

这些方向的共同挑战，是从“在固定基准上学会一种配合”走向“在开放、变化且信息受限的真实系统中持续协作”。

## 11. 总结

理解合作型 MARL，可以抓住三条主线：

1. **建模**：Dec-POMDP 描述多个智能体在局部观测下共同影响环境并优化长期团队回报；
2. **困难**：其他策略不断变化导致非平稳性，团队奖励导致信用分配，联合动作又随智能体数量指数增长；
3. **方法**：CTDE 在训练时利用全局信息，在执行时保持局部决策。QMIX 用单调价值分解实现分散贪心，MAPPO 用集中式 value function 与保守策略更新构建稳定基线。

QMIX 的单调性既是它能高效分散执行的原因，也是表达能力的边界；MAPPO 的强大来自正确的训练范式和实现细节，而不是在理论上支配所有 off-policy 方法。最终，算法选择必须回到动作空间、数据成本、通信条件和部署信息权限。

## 参考论文与阅读路线

如果希望循序渐进，可以先读入门材料，再读 QMIX 与 MAPPO，最后进入基准、通信和大规模方法。

### 综述与教材

1. Stefano V. Albrecht, Filippos Christianos, Lukas Schäfer. [Multi-Agent Reinforcement Learning: Foundations and Modern Approaches](https://www.marl-book.com/). MIT Press, 2024.
2. [A First Introduction to Cooperative Multi-Agent Reinforcement Learning](https://arxiv.org/abs/2405.06161). arXiv preprint, 2024.
3. Lucian Bușoniu, Robert Babuška, Bart De Schutter. [A Comprehensive Survey of Multiagent Reinforcement Learning](https://doi.org/10.1109/TSMCC.2007.913919). IEEE Transactions on Systems, Man, and Cybernetics, Part C, 2008.
4. Pablo Hernandez-Leal, Bilal Kartal, Matthew E. Taylor. [A Survey and Critique of Multiagent Deep Reinforcement Learning](https://doi.org/10.1007/s10458-019-09421-1). Autonomous Agents and Multi-Agent Systems, 2019.
5. [A Survey of Multi-Agent Deep Reinforcement Learning with Communication](https://aamas.csc.liv.ac.uk/Proceedings/aamas2024/pdfs/p2845.pdf). AAMAS, 2024.

### 核心算法

6. Ming Tan. [Multi-Agent Reinforcement Learning: Independent vs. Cooperative Agents](https://www.cs.utexas.edu/~shivaram/readings/b2hd-Tan1993.html). ICML, 1993.
7. Ryan Lowe et al. [Multi-Agent Actor-Critic for Mixed Cooperative-Competitive Environments](https://arxiv.org/abs/1706.02275). NeurIPS, 2017. MADDPG 论文。
8. Jakob N. Foerster et al. [Counterfactual Multi-Agent Policy Gradients](https://arxiv.org/abs/1705.08926). AAAI, 2018. COMA 论文。
9. Peter Sunehag et al. [Value-Decomposition Networks For Cooperative Multi-Agent Learning](https://arxiv.org/abs/1706.05296). AAMAS, 2018.
10. Tabish Rashid et al. [QMIX: Monotonic Value Function Factorisation for Deep Multi-Agent Reinforcement Learning](https://proceedings.mlr.press/v80/rashid18a.html). ICML, 2018.
11. Kyunghwan Son et al. [QTRAN: Learning to Factorize with Transformation for Cooperative Multi-Agent Reinforcement Learning](https://proceedings.mlr.press/v97/son19a.html). ICML, 2019.
12. Tabish Rashid et al. [Weighted QMIX: Expanding Monotonic Value Function Factorisation for Deep Multi-Agent Reinforcement Learning](https://papers.neurips.cc/paper_files/paper/2020/hash/73a427badebe0e32caa2e1fc7530b7f3-Abstract.html). NeurIPS, 2020.
13. Jianhao Wang et al. [QPLEX: Duplex Dueling Multi-Agent Q-Learning](https://arxiv.org/abs/2008.01062). ICLR, 2021.
14. Chao Yu et al. [The Surprising Effectiveness of PPO in Cooperative Multi-Agent Games](https://proceedings.neurips.cc/paper_files/paper/2022/hash/9c1535a02f0ce079433344e14d910597-Abstract.html). NeurIPS, 2022. MAPPO 论文。

### 环境、基准与群体智能

15. Mikayel Samvelyan et al. [The StarCraft Multi-Agent Challenge](https://arxiv.org/abs/1902.04043). AAMAS, 2019.
16. Benjamin Ellis et al. [SMACv2: An Improved Benchmark for Cooperative Multi-Agent Reinforcement Learning](https://papers.neurips.cc/paper_files/paper/2023/hash/764c18ad230f9e7bf6a77ffc2312c55e-Abstract-Datasets_and_Benchmarks.html). NeurIPS, 2023.
17. J. K. Terry et al. [PettingZoo: Gym for Multi-Agent Reinforcement Learning](https://arxiv.org/abs/2009.14471). NeurIPS, 2021.
18. Angeliki Papoudakis et al. [Benchmarking Multi-Agent Deep Reinforcement Learning Algorithms in Cooperative Tasks](https://proceedings.neurips.cc/paper/2021/file/65b9eea6e1cc6bb9f0cd2a47751a186f-Paper.pdf). NeurIPS Datasets and Benchmarks, 2021.
19. James Kennedy, Russell Eberhart. [Particle Swarm Optimization](https://doi.org/10.1109/ICNN.1995.488968). ICNN, 1995.
20. Marco Dorigo, Vittorio Maniezzo, Alberto Colorni. [Ant System: Optimization by a Colony of Cooperating Agents](https://doi.org/10.1109/3477.484436). IEEE Transactions on Systems, Man, and Cybernetics, Part B, 1996.
