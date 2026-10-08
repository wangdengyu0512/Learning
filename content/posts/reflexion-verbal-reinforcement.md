---
title: Reflexion：把失败翻译成语言，写进记忆
description: 从 Actor、Evaluator、Self-Reflection 与 episodic memory 出发，理解 Reflexion 如何在不更新模型权重的前提下，把失败转成可复用的语言教训，并完成可运行实现、陷阱分析与选型判断。
date: 2026-10-06
tags: AI Agent, Reflexion, 推理模式
featured: true
---

# Reflexion：把失败翻译成语言，写进记忆

一个 LLM Agent 做错了一次，怎样在**不更新任何模型权重**的前提下，让它下一次做得更好？Reflexion 的答案是：让模型把失败翻译成自然语言教训，写入跨 trial 的情景记忆，并在下一次尝试前重新读入上下文。

本文由目录中的 7 份原始教程页面合并整理而成，保留了概念图、代码、预测题、完整实现、陷阱分析、综合项目与三层自测。原始材料中的生态现状以 **2026 年 6 月**为观察截点；正文重点是 Reflexion 的稳定机制与工程判断。

## 全文导航

- [起点：概念地图与学习路径](#chapter-00)
- [第 1 章：概念——三组件与两层记忆](#chapter-01)
- [第 2 章：原理——语言如何完成 credit assignment](#chapter-02)
- [第 3 章：实操——从失败到通过的最小实现](#chapter-03)
- [第 4 章：陷阱——Evaluator、幻觉、记忆与成本](#chapter-04)
- [第 5 章：综合——CI 代码助手与模式选型](#chapter-05)
- [第 6 章：三层自测题库](#chapter-06)

---


<a id="chapter-00"></a>

# Reflexion：把失败翻译成语言，写进记忆

一个 LLM agent 做错了一次，怎么在**不改动任何权重**的前提下，第二次做得更好？Reflexion（Shinn et al., 2023）给出的答案是：让模型把这次失败用自然语言总结成一条教训，存进记忆，下一次把这条教训读进上下文。这篇 hands-on 教程从机制讲到能跑通的代码，再到何时*不*该用它。

<a id="audience"></a>

## · 适合谁

这篇教程面向已经摸过 LLM agent、想把"自我反思 / 自我纠错"这件事彻底搞清楚的工程师。读者最好满足：

- 已理解 **ReAct**（交错 reason + act + observe）、**CoT** 和基本的 agent loop——这些是 Reflexion 的地基，不会再从头讲；
- 能读写 Python，用过至少一个 LLM API（OpenAI / Anthropic 等任意一个即可）；
- 想要的不是"会调一个库的函数"，而是理解循环里每个组件*为什么*存在、reward 信号到底从哪来。

如果 ReAct 和 CoT 对你还陌生，先看兄弟教程 [agent-reasoning-patterns](/posts/agent-reasoning-patterns-react-cot-family) 把推理模式补齐，再回到这里。

<a id="not-for"></a>

## · 不适合谁

- **完全没接触过 LLM agent 的人**：这里假设 agent loop、prompt、tool call 都是已知概念，缺这块会读得吃力——先补 agent 基础。
- **只想要纯理论 RL 推导的人**：Reflexion 借用了"reinforcement"这个词，但本教程讲的是工程机制与可运行代码，不做 policy gradient 的数学推导。想要 RL 形式化证明的，这里不是合适的入口。

<a id="outcomes"></a>

## · 读完之后你能做到什么

读完你能说清：Reflexion 的"学习"不在权重里、而在上下文里——并能判断一个任务到底配不配用它（有没有可靠的 Evaluator、初始正确率是不是够低）。具体地，你将能够：

- **拆解** Reflexion 的三个组件 Actor / Evaluator / Self-Reflection，说出每个的输入输出，以及它们如何接成一个跨 trial 的循环；
- **解释**为什么自然语言反思能替代梯度更新——标量 reward 做不了 credit assignment，而语言能定位"哪一步错了、该改成什么"；
- **跑通**一个纯标准库、无需 API key 的最小 Reflexion 循环（用脚本化 mock 模拟 Actor 从 buggy 到 fixed 的演化），并把每行映射回概念；
- **判定**一个任务是否适合 Reflexion：检查它有没有可靠的验证信号、初始正确率是否落在受益区间、是否需要大量探索；
- **辨析** Reflexion 与 Self-Refine、ReAct、Tree of Thoughts、RLHF 的分界轴，在选型时讲清"为什么没选别的"。

<a id="essence"></a>

## · 一句话本质

**本教程要钉进你脑子里的那一句**

- Reflexion 不更新权重——它让一个 LLM 把"失败"这个标量信号翻译成"哪一步错了、下次该怎么改"的自然语言教训，写进记忆；下次尝试把这段教训读进上下文。所以"学习"发生在 context window 里，policy 就是记忆里那段文本，而不是模型参数。
- **推论一 · 语言反思 ≠ 重试**：把上次轨迹原样塞回去（blind retry）反而更差；起作用的是"反思"这一步做的 credit assignment。论文消融显示，加反思比只给历史轨迹再 +8% 绝对值；盲目 refinement 的 52% 还低于不 refine 的 60%。
- **推论二 · 没有可靠的验证信号就会退化**：缺少能判对错的 Evaluator（测试 / 环境 reward / oracle），Reflexion 会失效甚至比不反思更差——它的全部杠杆都压在那个 Evaluator 上。

<a id="frontier"></a>

## · 现状速览（截至 2026-06）

**Frontier · 2026-06**

核心的 verbal-RL 机制自 2023 年论文以来**稳定、未被推翻**。真正在变的是两件事：

**(1) 框架层 API 大改。** LangGraph 1.0（2025-10）把反思能力收进了通用的 `create_agent`，独立的 `langgraph-reflection` 包已于 **2026-04 归档为只读**。AutoGen、LlamaIndex 也都把这个循环实现成了通用"reflection"设计模式——值得注意的是，它们*都不再引用 Reflexion 这个名字*，idea 被吸收，品牌没留下。

**(2) 前沿从"prompt 式反思"转向"把反思能力训进权重"。** SCoRe（DeepMind，2024-09）用多轮 RL 在自生成数据上训练，得到真正的内在自我纠错（MATH +15.6%）。关于"o1 / R1 这类推理模型是否取代外部反思循环"的争论，2025–2026 的共识是**互补而非替代**——外部反思循环存在 **3–7 轮的能力天花板**（CMU，2026-02）。早期那种"让模型没有外部验证、自己 review 自己"的做法已被证伪（Huang et al., ICLR 2024），**不要学**。

**流畅感警告**

这个主题最大的陷阱不是难，而是*看起来太顺*。"反思一下再重试"听上去理所当然，于是很容易在没真正理解机制的情况下滑过去。下面三句话，只要在读这篇教程时冒出过任何一句，就是信号——停下，回到对应章节动手验证，别让流畅感骗了你：

- **"我读得很顺"**——那就合上教程，试着不看原文复述：reward 是标量，为什么标量做不了 credit assignment，而语言可以？说不清，就是没真懂。
- **"我做题很快"**——那道判别题真考的是"这个任务配不配用 Reflexion"，不是"Reflexion 是什么"。答快了，检查你有没有真的去验证 Evaluator 是否可靠。
- **"我没卡壳"**——没卡壳常常意味着没碰到真正反直觉的点：Actor 不是新模型、episodic memory 不是向量库、blind retry 比反思更糟。这三个里有一个让你意外，才说明读进去了。

<a id="map"></a>

## · 概念地图

先建立一张整体图。Reflexion 的全部活动围绕一个跨 trial 的循环展开，三个组件协作、两层记忆分工，而最外圈那一条虚线——**LLM 权重全程冻结**——才是理解一切的钥匙。

![Reflexion 概念地图：Actor、Evaluator、Self-Reflection 与情景记忆的循环](/blog-assets/reflexion-verbal-reinforcement/00-01.svg)

图 0-1：Reflexion 的中心辐射结构。Actor 读记忆并产出 trajectory，Evaluator 打分给出 reward，Self-Reflection 把失败转成语言教训并追加到 episodic memory，下一轮再由 Actor 读回。**注意**：LLM 权重全程冻结，学习发生在记忆文本里。

<a id="paths"></a>

## · 学习路径建议

这篇教程是六章 hands-on，全读一遍当然最扎实。但不同目的有不同的最短路径：

### 只想搞懂机制

目标是"在会上能把 Reflexion 讲清楚、能判断别人的方案对不对"。路线：[01 概念](#chapter-01)（建立词汇与三组件循环）→ [02 原理](#chapter-02)（吃透为什么语言能替代权重、credit assignment、反思 ≠ 重试）→ [06 自测](#chapter-06) 验收。03 的代码可以略读，但 02 的 `#why-language` 和 `#ablation` 两节必须停下来想透。

### 要动手实现 → 直奔 03

目标是"今天就跑通一个反思循环、明天接到自己的项目里"。路线：先扫一遍 [01 概念](#chapter-01) 对齐术语 → 重点做 [03 实操](#worked)（完整 worked example，纯标准库、无需 API key，直接 `python3 reflexion.py` 跑通）→ 做 `#partial` 的两个留白（memory 怎么注入、reflection prompt 怎么写）→ 上 [05 综合](#chapter-05) 把循环扩成带早停护栏的真实形态。

### 做选型辨析 → 02 + 05

目标是"在 Reflexion / Self-Refine / ReAct / RLHF 之间替团队拍板"。路线：直接看 [02 原理的备选方案对比表](#alternatives)（讲清每条分界轴、为什么没选别的）→ 做 [05 综合的判别决策点](#decisions)（在具体场景里走一遍决策树）。[04 陷阱](#evaluator-dependency) 的"何时不要用 Reflexion"是选型的反面清单，一并看。

<a id="toc"></a>

## · 目录

- [**01 概念**](#chapter-01)——Reflexion 的词汇表：verbal reinforcement、Actor、trajectory（短期记忆）、Evaluator、Self-Reflection、episodic memory（长期记忆），用一个"写函数失败 → 反思 → 重试"的场景在每个概念上落锚。
- [**02 原理**](#chapter-02)——从"会用"到"理解"：为什么语言能替代权重更新、credit assignment 怎么发生、reward 分任务从哪来、反思如何拼进下一轮上下文，以及与 ReAct / CoT / Self-Refine / ToT / CRITIC / RLHF 的分界。
- [**03 实操**](#chapter-03)——环境准备 → 可直接运行的最小 Reflexion 循环（逐行映射回概念）→ 两个关键留白 → 开放练习。纯标准库，mock 跑通逻辑，换真实 API 即可上生产。
- [**04 陷阱**](#chapter-04)——五个以上失败模式：Evaluator 依赖（没 oracle 就崩）、反思幻觉（correct→incorrect 翻转）、memory 膨胀、成本 ≈ self-consistency、收敛天花板、任务不匹配。每个都给症状 / 根因 / 修复。
- [**05 综合**](#chapter-05)——一个真实场景（给代码助手加 CI 反馈下的反思循环），三个以上判别决策点，在 03 骨架上扩展 + 验收 checklist + 参考实现。
- [**06 自测**](#chapter-06)——三层梯度题库：概念层、原理层、应用判别层。答案集中在文末，先自己答完再对。

<a id="next"></a>

## · 学完之后

把这篇吃透后，自然的下一步是把 Reflexion 放回更大的 agent 图景里：

- **Reflexion 内部的 Actor 长什么样**：Actor 的内核就是 ReAct / CoT。想把那一层也讲透，看 [agent-reasoning-patterns](/posts/agent-reasoning-patterns-react-cot-family)——理解了 ReAct 的单轨迹推理，才更能体会 Reflexion 是在它外面套了一层跨 trial 的学习。
- **反思在"agent 自我改进"谱系里的位置**：Reflexion 只是 agent 规划与自我改进的一种。[agent-planning](https://zhiwenliang.github.io/learning/agent-planning/index.html) 的搜索与反思章把它和其它规划/反思策略放在一起对比。
- **把反思能力训进权重**：顺着 frontier 的第二条线，去读 SCoRe 这类用 RL 做内在自我纠错的工作——它正面回应了"prompt 式反思的天花板"。
- **长期记忆的工程化**：论文把"反思存进向量库 / SQL"列为 future work；当 episodic memory 从滑动窗口长成持久检索系统，就接上了 agent memory 与 RAG 的话题。

### 参考资料

- Shinn et al., 2023 · [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)（原始论文，本教程的真相源）
- 官方实现 · [github.com/noahshinn/reflexion](https://github.com/noahshinn/reflexion)
- Huang et al., ICLR 2024 · [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)（没有 oracle 时改进消失——务必读）
- DeepMind, 2024 · [SCoRe: Training Language Models to Self-Correct via RL](https://arxiv.org/abs/2409.12917)（把反思训进权重）
- LangChain · [LangChain & LangGraph 1.0](https://www.langchain.com/blog/langchain-langgraph-1dot0)（框架现状）


---


<a id="chapter-01"></a>

## 词汇表：七个零件如何拼出一个会反思的 agent

起点章给出了一句话本质——Reflexion 的"学习"不在权重里、而在上下文里。本章把这句话拆成七个可命名的零件,并用同一个"写函数失败 → 反思 → 重试"的场景把每个零件落到地上:看清它在循环里负责哪一步、为什么非它不可、以及它和下一个零件如何衔接。读完这七个名字,后续每一章都建立在它们之上。

**本章你将建立的 schema**

- **verbal reinforcement**:权重冻结,策略是记忆里的一段文本,而非模型参数。
- **Actor / trajectory / Evaluator / Self-Reflection**:生成、产物、打分、把标量翻成语言教训。
- **episodic memory**:跨 trial 的反思 buffer,Ω=1–3 滑动窗口——是窗口,不是向量库。
- 三个反直觉断言:Actor 不是新模型、reward 只是标量、信息量在反思那一步才产生。

贯穿本章的场景只有一个,小到可以在脑子里跑完:让一个 LLM 写出 Python 函数 `median(nums)`(返回数字列表的中位数,偶数长度取中间两数平均),并通过两条断言——其中一条专测偶数长度。第一次尝试只取了正中间那一个元素,偶数用例失败。这一次失败、以及它如何变成下一次的成功,正好把七个零件依次点亮。

**流畅感警告**

这一章的名词不多,读起来会很顺。但"我读得很顺""这些词我都见过"并不等于"我能在循环里指出每个零件负责哪一步"。真正的检验是:读完能不能脱稿画出三组件循环图、并说清为什么把上次轨迹原样塞回去(blind retry)不如反思一次。每节末尾的预测题就是用来戳破顺滑感的——先写下你的答案,再展开。

<a id="verbal-rl"></a>

## 1.1 verbal reinforcement：为什么不更新权重

> 用语言反馈而非梯度更新来"强化"一个 agent,策略就是记忆里那段文本。

**为什么需要它**

常规强化学习靠梯度把"做得好/不好"回灌进权重。但对一个跑在 API 后面的大模型,微调一轮昂贵、缓慢,且会改动全局行为。Reflexion 换了个赌注:权重一动不动,只在每次失败后往上下文里写一段自然语言教训;下一次尝试把这段文本读进 prompt。强化的载体从"梯度"换成了"文字"。

在 `median` 场景里,这意味着:第一次失败后,系统不会去调模型参数,而是生成一句话——"只取了中间单个元素,没处理偶数长度"——并把它存起来。第二次尝试时,这句话被拼进 prompt,模型在它的条件下重新生成代码。整个过程没有一次反向传播。

比文档深一层的机制:论文把策略 *π* 显式参数化为"agent 的记忆编码 + 选定的 LLM 参数"两部分。两次 trial 之间,LLM 参数那一半完全冻结,唯一变化的是记忆那一半——也就是上下文里的文本。所以"verbal reinforcement learning"是字面意义上的:学习确实发生了(行为在改善),但它发生在 context window 里,通过 in-context conditioning 生效,而不是通过 backprop 改动任何一个权重。这条线索后面会反复回来——它是整个范式与微调的根本分界。

衔接下一节:既然权重不动,那"生成代码"这一步由谁来做?答案是 Actor——而它正是读者已经熟悉的东西,只是换了个角色名。

<a id="actor"></a>

## 1.2 Actor：它不是新模型,就是 CoT / ReAct

> 生成 text + action 的 LLM 策略,内部就是 CoT 或 ReAct,不是另起炉灶的新模型。

**为什么需要它**

循环总得有人真正去"做事"——读任务、想一步、产出动作或代码。这个角色就是 Actor。给它单独起名,是为了在循环里把"生成"这一步和"打分""反思"这两步分开,而不是因为它需要一个特殊架构。

这是本章第一个反直觉点,值得钉死:**Actor 不是一个为 Reflexion 新训练或新设计的模型**。它就是一个普通的 LLM 推理策略——单遍生成中间推理就是 [CoT;边推理边调工具、交错 reason+act+observe 就是 ReAct](/posts/agent-reasoning-patterns-react-cot-family)。Reflexion 没有改 Actor 的内部,它只是把 Actor 当成一个可替换的零件塞进更大的循环里。在 `median` 场景里,Actor 就是"接到任务描述、吐出一段函数定义"的那次模型调用,仅此而已。

比文档深一层的机制:既然 Actor 内部可以是 ReAct,那它本身就能在*一次*尝试内做多步推理与工具调用。这里要分清两个不同维度的"循环"——Actor 内部的 reason→act→observe 是*单条轨迹之内*的步进;而 Reflexion 外层套的 生成→评估→反思 是*跨尝试*的循环。前者不跨尝试积累教训,后者才是 Reflexion 的新增物。把两者叠在一起看:Reflexion = 一个(可能很会推理的)Actor + 外面一圈让它跨尝试改进的脚手架。

**预测一下**

如果把 Actor 从"单步生成代码"换成一个完整的 ReAct agent(它自己会查文档、跑中间命令),Reflexion 这一层还有存在意义吗?换句话说,ReAct 自带的 observe 步骤,能不能替代外层的反思?

**展开看答案**

仍然有意义,两者不重叠。ReAct 的 observe 让 Actor 在*当前这条轨迹内*看到环境反馈并即时调整,但当这条轨迹整体失败、被判不通过后,ReAct 自己*不会把"这一整次为什么没成"沉淀成一条跨尝试的教训*——下一条轨迹默认从头开始。Reflexion 外层正是补这一段:它在一整条轨迹失败后做诊断,把教训写进记忆,供*下一条*轨迹的 Actor 读取。一句话:ReAct 管"这一步看到什么就改什么",Reflexion 管"上一整次失败教会了什么"。维度不同,叠加使用。

衔接下一节:Actor 跑完一次,留下的产物——那一串"想了什么、做了什么、得到什么"——需要一个名字。这就是 trajectory。

<a id="trajectory"></a>

## 1.3 trajectory(轨迹)：一次尝试的动作序列 = 短期记忆

> Actor 一次尝试产生的完整 action / observation 序列,即这一回合的短期记忆。

**为什么需要它**

要给一次尝试"打分"或"诊断",得先有一个可被检查的对象。trajectory 就是这次尝试留下的完整痕迹——推理、动作、环境反馈,直到产出最终答案。它是 Evaluator 和 Self-Reflection 的共同输入。

在 `median` 场景里,trial 0 的 trajectory 很短:Actor 输出的那段代码 `return s[len(s)//2]`,加上把它跑在两条测试上得到的结果(第二条偶数用例抛出断言失败)。在多步 ReAct 任务里,trajectory 会长得多——一连串 思考→动作→观察。无论长短,它都是"这一回合到底发生了什么"的唯一完整记录。

比文档深一层的机制:trajectory 是**短期记忆**——关键在"短期"二字。它的生命周期被绑死在*单次 trial 之内*:这一回合结束、教训被提炼出来后,下一回合的 Actor 并不会原样继承上一条 trajectory(否则上下文会迅速膨胀)。它服务于"评估"和"反思"这两个紧邻的下游步骤,用完即可丢弃。能跨回合活下来的,不是 trajectory 本身,而是从它身上提炼出的那一句教训。这个"短期 vs 长期"的切分是本章最容易被读顺、却最该记牢的一刀——图 2 会专门画它。

衔接下一节:有了可检查的 trajectory,下一步是判它成败。这件事交给 Evaluator。

<a id="evaluator"></a>

## 1.4 Evaluator：给轨迹打分 = reward,而 reward 只是标量

> 给一条 trajectory 打分、输出 reward 的角色;reward 通常只是一个标量或 pass/fail。

**为什么需要它**

循环必须知道"这次到底对没对",才能决定停下还是继续。Evaluator 提供这个判断信号。没有它,系统无从知道何时该停、也无从触发反思——这也是为什么后面会反复强调:没有可靠 Evaluator 的任务,Reflexion 会退化甚至变差。

Evaluator 不一定是一个 LLM。论文按任务类型用不同实现:推理任务对答案做 exact-match;决策任务用手写启发式(比如同一动作重复超过 3 次、或动作数超过 30 就判失败)或一个 LLM 二分类器;编程任务则跑自生成的单元测试。在 `median` 场景里,Evaluator 就是那段"逐条执行 assert、捕获异常"的代码——通过返回 `(True, "")`,失败返回 `(False, "AssertionError: ...")`。

这是本章第二个反直觉点:**reward 只是一个标量(甚至只是 pass/fail),它的信息量极低**。它能告诉系统"你失败了",却*说不出哪一步错了、该怎么改*。在 `median` 里,Evaluator 给出的只是"第二条断言挂了 + 一行报错";它不会、也无法说"你应该对偶数长度取中间两数平均"。这个"诊断"动作不在 Evaluator 的职责里。

比文档深一层的机制:这里藏着 credit assignment 问题。一个标量 reward 无法在一串动作里定位"是哪一步 *ai* 导致了后续连锁出错、它该被改成什么"。即便把 reward 升级成向量也不行——它仍然不是一个带定位、可操作的纠错信号。这正是为什么光有 Evaluator 还不够:它制造了一个"知道错了、但不知道错在哪"的缺口。填这个缺口的,是下一个零件。

**预测一下**

假设把 Evaluator 的输出从 pass/fail 升级成一个更细的分数(比如 0–1 连续值、或一个多维向量),Actor 下一次就能写对 `median` 了吗?为什么?

**展开看答案**

大概率不能,而且这恰恰是 Reflexion 的核心论点所在。把标量换成连续值或向量,提升的只是"失败程度"的分辨率——它告诉你"错得有多严重",却依旧*不告诉你错在哪一步、该怎么改*。`median` 的修复需要一个带定位的命题:"偶数长度时取了单个元素,应改成取中间两数平均"。这是自然语言才能承载的、高维且可操作的纠错信号,任何维度的数值 reward 都表达不出来。所以信息量不在打分这一步变多——它在下一步、把标量翻译成语言时才被创造出来。

衔接下一节:Evaluator 制造了"知道错、不知错在哪"的缺口。把这个标量缺口填成可操作教训的,是 Self-Reflection。

<a id="self-reflection"></a>

## 1.5 Self-Reflection：把标量失败翻成第一人称语言教训

> 把 reward + trajectory 转成一条第一人称的自然语言教训(reflective text)。

**为什么需要它**

Evaluator 给的是"失败"这个标量,Actor 要的是"下次具体怎么改"。中间隔着一道翻译。Self-Reflection 就是这台翻译机:它读 trajectory(发生了什么)+ reward(结果如何),输出一句能直接指导下一次行动的话。**整个循环里,信息量正是在这一步被创造出来的。**

这是本章第三个、也是最关键的反直觉点的落点:前面 Evaluator 给的标量信息量近乎为零,而 Self-Reflection 通过"语言化的诊断"凭空造出了一个高维、带定位的纠错信号。在 `median` 场景里,它读到"代码取了 `s[len(s)//2]` + 偶数用例失败",输出的反思文本是:

**代码：trial 0 的 reflective text(被展示的程序产物)**

```text
我只取了中间单个元素,没处理偶数长度;下次对偶数长度取中间两数的平均。
```

**关于这里的"我"**

上面这句反思是**第一人称**写的——这是论文明确的设计选择(reflective text written in the first person)。注意区分:第一人称只出现在*被展示的 reflection 样本*里(它是程序产物,像一段日志),而本章正文从头到尾是第三人称。看到引用块里的"我",那是 agent 在对自己说话,不是作者在说话。

比文档深一层的机制:Self-Reflection 之所以能替代梯度,是因为它在做 credit assignment ——而它用的工具是语言,不是数值。它能推断"动作 *ai* 导致了后续 *ai+1*、*ai+2* 出错,应该改成 *a'i*"。在 `median` 里,这个定位就是"问题出在'取单个元素'这一步,改成'偶数取两数平均'"。这一句话同时完成了三件标量做不到的事:定位错误环节、给出修正方向、且以 Actor 能直接读懂的形式表达。所以论文的消融结果才合理——只把上次 trajectory 原样塞回去(blind retry / episodic-memory-only)效果反而更弱,加上这一步反思能再贡献约 +8% 的绝对提升;盲目重试(52%)甚至低于不重试(60%)。*起作用的从来不是"再试一次",而是"反思那一步做的诊断"。*

衔接下一节:Self-Reflection 产出了一条教训。但单条教训若用完即丢,下一次就又从零开始。要让教训跨回合积累,需要一个存放它们的地方——episodic memory。

<a id="episodic-memory"></a>

## 1.6 episodic memory(情景记忆)：跨 trial 的反思 buffer = 长期记忆

> 跨 trial 累积反思文本的 buffer,即长期记忆;Ω=1–3 的滑动窗口,不是向量库。

**为什么需要它**

trajectory 是短期的、用完即弃;但教训必须活过这一回合,才能在下一次被读到。episodic memory 就是那个"活下来的容器"——它只装反思文本,不装原始轨迹,并把它们一路带进后续每一次尝试的 prompt。

这是本章第四个反直觉点,也是最常被想偏的一个:**episodic memory 不是向量数据库,而是一个长度上限为 Ω 的滑动窗口**(论文 AlfWorld 用 3、programming 用 1)。它的实现朴素到近乎简陋:一个列表,每反思一次就 append 一条,只保留最近的 Ω 条。论文把"用向量库 / SQL 做检索式长期记忆"明确列为 future work——也就是说,标准 Reflexion 里*没有*嵌入、没有相似度检索,只有"最近几条"。

比文档深一层的机制:为什么是滑动窗口而不是全量保留?因为反思文本要被拼进下一轮的 prompt,而上下文长度有限。到 trial 3 时,prompt 已经 = 任务描述 + 多次尝试的痕迹 + 多条反思;若无上限,长任务会直接溢出窗口。Ω 因此是一个*为适配上下文长度而设的容量上限*,不是检索策略。把它理解成"队列尾部最近 Ω 条",而不是"按相关性召回的知识库"——这一刀切错,后面 02 章的 memory injection、04 章的 memory 膨胀全会跟着想偏。

![Reflexion 的短期记忆与长期记忆对比](/blog-assets/reflexion-verbal-reinforcement/01-01.svg)

图 1-1：trajectory 只存在于单次 trial；reflections 跨 trial 保留，并由 Ω 滑动窗口截取最近几条送入下一轮 prompt。这里是容量窗口，不是按相关性检索的向量库。

衔接下一节:四个角色、两种记忆都齐了。剩下的问题是——它们如何接成一个能自我改进的闭环?这就是 trio。

<a id="trio"></a>

## 1.7 trio：三者接成"生成 → 评估 → 反思 → 重试"循环

> Actor、Evaluator、Self-Reflection 三个模型,经 trajectory、reward、memory 串成一个跨 trial 的闭环。

**为什么需要它**

单看任何一个零件都不构成"反思"。Actor 只会生成、Evaluator 只会打分、Self-Reflection 只会诊断;只有把三者按固定顺序连起来、并让记忆把这一轮的教训带到下一轮,"自我改进"才作为一个系统性质涌现出来。trio 就是这个连接方式本身。

三个模型(论文记作 *Ma* / *Me* / *Msr*)按这样一条数据流首尾相接:Actor 读"任务 + memory 里的反思"生成 trajectory → Evaluator 给 trajectory 打出 reward → 若未通过,Self-Reflection 把 (trajectory, reward) 翻成一条反思文本 → 这条文本 append 进 episodic memory → 回到 Actor,开始下一个 trial。循环在两种情况下停止:Evaluator 判定通过,或者达到 max_trials。

![Reflexion 的 Actor、Evaluator 与 Self-Reflection 三组件循环](/blog-assets/reflexion-verbal-reinforcement/01-02.svg)

图 1-2：Actor 生成 trajectory，Evaluator 产生 reward，Self-Reflection 把标量信号翻译成语言教训并写入 memory。trial 之间唯一变化的是记忆文本，不是模型权重。

比文档深一层的机制:把图 1 横着读,会看到一条信息量先降后升的曲线。Actor 产出富信息的 trajectory → Evaluator 把它压成一个近乎零信息的标量 reward → Self-Reflection 又把这个标量*重新展开*成一条带定位的语言教训。中间这一压一展不是冗余:压缩是为了得到一个明确的"对/错"判定(停止条件需要它),展开是为了得到一个可操作的修正方向(下一次 Actor 需要它)。这条循环之所以能改进,靠的正是 Self-Reflection 在展开那一步注入的、标量里本不存在的信息——而这一切发生时,三个模型的权重一个都没动。

**把 median 场景跑完整**

trial 0:Actor 写 `return s[len(s)//2]` → Evaluator 跑测试,偶数用例抛 `AssertionError`(reward = fail)→ Self-Reflection 产出 sr₀「我没处理偶数长度,下次取中间两数平均」→ 写进 memory。trial 1:Actor 读到 sr₀,改写成"奇数取中间、偶数取两数平均"的版本 → Evaluator 两条测试全过(reward = pass)→ 停止。全程零梯度,改进只来自 memory 里多出来的那一句话。

## 自测：合上教程再看自己能不能答

1. **(概念)**把这七个零件按数据流排成一条链:从 Actor 出发,经过哪些中间产物(trajectory / reward / reflective text),最后又怎么回到 Actor?哪些产物属于短期记忆、哪些属于长期记忆?
2. **(辨析)**有人说"Evaluator 打分越精细,Actor 改得越好,所以应该把 pass/fail 升级成连续分数"。这句话错在哪?用"信息量在哪一步产生"来反驳。
3. **(设计)**你要给一个真实任务接 Reflexion,但发现 episodic memory 到第 4 个 trial 就把上下文撑爆了。在*不引入向量库*的前提下(保持标准 Reflexion 的滑动窗设定),你有哪两三个调节旋钮可用?各自的代价是什么?

**展开参考答案**

**1.** Actor →(生成)trajectory τ →(Evaluator 打分)reward →(Self-Reflection 翻译)reflective text →(append)episodic memory →(下一 trial 读回)Actor。其中 trajectory 是短期记忆(单 trial 内,跨回合重置);episodic memory 里的反思文本是长期记忆(跨 trial 保留,受 Ω 截断)。

**2.** 错在把"分辨率"当成"信息量"。连续分数只让"失败程度"更精细,仍然回答不了"哪一步错、怎么改"——它不做 credit assignment。真正凭空创造可操作信息的是 Self-Reflection 那一步的语言化诊断;打分这一步再细,信息量也不增加(预测题二同理)。

**3.** 旋钮:① 调小 Ω(滑动窗容量),只留最近 1–2 条反思——代价是丢掉更早 trial 的教训,可能重蹈早期覆辙;② 让 Self-Reflection 产出更短的反思文本(约束长度),代价是定位可能变粗、修正方向变模糊;③ 调小 max_trials 提前停,代价是放弃本可在更多轮里收敛的任务。三者都在"上下文预算 vs 改进机会"之间取舍——这正是 04 章 memory 膨胀一节要展开的张力。

**刚好够不着的挑战**

### 同一句教训,为什么"放进 memory"比"原样重放 trajectory"强?

设想两种"重试"实现:实现 A 把上一次完整的 trajectory(代码 + 报错)原样塞回下一轮 prompt;实现 B 只把 Self-Reflection 提炼的那一句反思文本放进 memory、再拼进 prompt。论文消融显示 B 明显优于 A(反思额外贡献约 +8% 绝对值,而盲目重试 52% 反低于不重试的 60%)。试用本章的"credit assignment + 信息量在哪一步产生"两个概念,说清楚 A 给 Actor 的到底是什么、B 给的又是什么——为什么"更多原始上下文"反而不如"一句被诊断过的教训"。这个问题的完整机制会在 [02 章 #ablation](#ablation) 展开,这里先尝试自己讲一遍。

### Further reading

- Shinn et al., 2023. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)(术语 Actor / Evaluator / Self-Reflection、Ω 滑动窗、Algorithm 1 的原始出处)。
- 官方实现:[noahshinn/reflexion](https://github.com/noahshinn/reflexion)(对照本章七个零件看代码里的对应类)。
- Prompt Engineering Guide:[Reflexion 技术页](https://www.promptingguide.ai/techniques/reflexion)(更轻量的概念回顾)。
- 兄弟教程:[Agent 推理模式(ReAct / CoT)](/posts/agent-reasoning-patterns-react-cot-family)——Actor 内部就是这里讲的 ReAct 或 CoT。


---


<a id="chapter-02"></a>

## 为什么语言能代替梯度

上一章建立了 Reflexion 的词汇表——Actor、Evaluator、Self-Reflection 三组件,trajectory 是短期记忆,episodic memory 是跨 trial 的长期记忆。这一章拆开循环的内核:标量 reward 为什么不够用、语言反思凭什么补上、"更新"到底发生在哪里。读完不再停在"会调这个循环",而是能解释它为何成立、代价是什么、什么时候该换别的范式。

**本章你将建立的 schema**

- 标量 reward 只携带"成功/失败"一个比特,做不了 credit assignment
- 语言反思是一个高维、带定位的纠错信号:它能指出"action ai 该改成 a'i"
- "更新"通过 in-context conditioning 发生,不是 backprop;policy 就是记忆里那段文本
- reward 来源按任务分三类:精确匹配 / 启发式或 LLM 分类 / 自生成测试
- 反思 ≠ 重试:加反思比只塞历史轨迹多 +8% 绝对值,盲目重试反而更差
- 为什么没选 ReAct / CoT / Self-Refine / ToT / CRITIC / RLHF——每条分界轴在哪

<a id="why-language"></a>

## 2.1 标量 reward 的信息瓶颈

强化学习的经典回路里,环境回给 agent 一个数:`r`。这个数可以是 0/1,可以是连续分值,但无论多精确,它只回答一个问题——**这次整体做得多好**。它不回答"哪一步错了""错在什么地方""下次该改成什么"。在监督式或基于梯度的方法里,这个缺口由 backprop 填补:误差信号沿着计算图反传,把"责任"按权重分摊到每一个参数上。这就是 **credit assignment(信用分配)**——把一个总体结果拆解成对各个决策的功过评判。

LLM agent 的回路里,这条路断了。权重冻结,没有梯度回传;一次 trajectory 可能有十几步 action,Evaluator 只回来一个 `fail`。Actor 拿到这个 `fail`,无从知道是第 2 步取错了元素、还是第 7 步漏判了边界条件。**标量 reward 在多步决策上是一个信息瓶颈:结果维度坍缩到一维,定位信息全部丢失。**

**深一层 · 为什么向量 reward 也不够**

把 reward 从标量升级成向量(给每一步打分),似乎能恢复定位。但向量回答的仍是"第 i 步好不好",不回答"第 i 步*应该*怎么做"。诊断与处方是两件事。Reflexion 论文把改进信号交给一个 LLM 用**自然语言**表达,正是因为自然语言能同时携带"哪一步""为什么错""改成什么"——这是任何固定维度的数值向量都编码不下的结构。

<a id="credit-assignment"></a>

### 语言反思如何完成 credit assignment

Self-Reflection 模型(Msr)接收三样东西:任务描述、完整 trajectory、Evaluator 的判定。它产出一段自然语言 **reflective text**。这段文本做的恰恰是标量 reward 做不到的事——它把整体失败*归因*到具体某步,并给出修正方向。论文里这段文本是第一人称写的,例如一条编程任务的反思:

**reflective text 示例(论文设计为第一人称)**

"我只取了排序后中间的单个元素,没有处理列表长度为偶数的情况;下次遇到偶数长度,应该取中间两个数的平均。"

对照看:标量信号是 `AssertionError` 这一个 `fail`;语言信号则定位到"取中间单个元素"这一步(credit assignment 的*定位*),并给出"取两数平均"这一处方(credit assignment 的*方向*)。这就是**一个高维、带定位的纠错信号**:它的"维度"是自然语言的全部表达力,它的"定位"是对具体 action 的指认。下一个 trial 开始时,Actor 把这段文本拼进 prompt——所谓"学习",是 Actor 在新的上下文条件下重新生成,即 **in-context conditioning**,而不是参数被梯度推动。policy 在数学上被参数化为"记忆编码 + 冻结的 LLM 参数",trial 之间唯一变化的就是上下文里那段文本。这正是 "verbal reinforcement learning(语言强化学习)" 为何是字面意义:用语言而非梯度去强化。

![标量 reward 与语言反思的 credit assignment 对比](/blog-assets/reflexion-verbal-reinforcement/02-01.svg)

图 2-1：标量 reward 只能说明“失败了”；语言反思可以定位错误动作、解释原因并给出修改方向，从而完成 credit assignment。

### 备选信号对比

**纠错信号的三种形态**

| 信号形态 | 能否定位是哪一步 | 能否给出修正方向 | 更新机制 |
| --- | --- | --- | --- |
| 标量 reward | 否(整体一维) | 否 | 需 backprop 才能分摊;LLM 权重冻结时无路可走 |
| 向量 / 逐步 reward | 部分(知道哪步差) | 否(不说怎么改) | 仍需梯度;诊断 ≠ 处方 |
| 语言 reflective text | 是(指认具体 action) | 是(给出 a'i) | in-context conditioning,零梯度 |

**带来的代价**

语言信号的表达力是有代价的:它**无法被验证为真**。梯度由损失函数机械导出,不会"编造";reflective text 是 LLM 生成的,可能把失败归因到错误的 action,甚至凭空发明一条不存在的教训(reflection hallucination,见 [04 章 #reflection-hallucination](#reflection-hallucination))。高维表达力换来的,是把一部分信任交给了一个会出错的生成器。这也是为什么 Reflexion 强依赖一个能*独立*判对错的 Evaluator——反思可以错,但"是否通过"这个 ground truth 不能错。

**预测一下**

如果把 Self-Reflection 模型换成一个只会输出 "请再试一次,这次更仔细" 这类**无定位**套话的模型,Reflexion 的收益会怎样?它和标量 reward 有本质区别吗?

**展开答案**

收益会塌回接近"盲目重试"的水平。无定位的套话虽然是自然语言,但它不携带 credit assignment——不指认哪步、不给处方,信息量和"失败了"这个比特几乎一样。本质上它退化成了一个被包装成句子的标量信号。这恰好印证 2.4 节的消融:起作用的不是"有没有文字反馈",而是反馈里有没有完成**定位 + 处方**。

<a id="reward-source"></a>

## 2.2 reward 从哪里来：按任务分三类

2.1 节反复强调"必须有一个能判对错的 Evaluator"。但 Evaluator 不是一个固定实现——论文里它**随任务类型变化**,而且大多数情况下*不*用 LLM 当裁判。这一点常被误解为"Reflexion 就是让 LLM 自己评自己",实际并非如此。下表来自论文的三类基准。

**Evaluator 的三种实现(对应论文三类任务)**

| 任务类型 | Evaluator 实现 | reward 性质 | 基准与增益 |
| --- | --- | --- | --- |
| 推理 / (HotPotQA) | **exact-match(EM)**:把答案与 ground-truth 精确比对 | 客观、外部、可信 | HotPotQA +20% |
| 决策 / (AlfWorld) | **手写启发式**(同一动作重复 >3 次,或动作数 >30 判失败)或 **LLM 二分类** | 启发式客观 / LLM 判定带噪 | 130/134(较 ReAct +22%) |
| 编程 / (HumanEval) | **自生成单元测试**(≤6 条,用 AST 过滤掉语法无效的) | 半客观——测试本身可能有错 | pass@1 = 91%(GPT-4 基准 80%) |

三类的可信度递减:EM 比对 ground-truth,几乎不会错;手写启发式规则明确;自生成测试则把"判据"也交给了 LLM 生成——这埋下了 Reflexion 唯一一次失利的根因(见下方代价段)。Evaluator 的选择,直接决定整个循环的可靠性上限。

![Reflexion 的三类 reward 来源](/blog-assets/reflexion-verbal-reinforcement/02-02.svg)

图 2-2：推理任务可用 exact-match，决策任务可用启发式或分类器，编程任务可运行测试。Evaluator 越缺少外部真值，反思循环越不可靠。

**带来的代价 · 自生成测试的假阳性**

编程任务里 Evaluator 用 LLM 自己写的单元测试。这条路在 HumanEval 上很成功(假阳性仅 1.4%),却在 MBPP-Python 上翻车:**Reflexion 77.1% < GPT-4 的 80.1%**,是论文里唯一一次失利。根因不是反思错了,而是**自生成测试有 16.3% 假阳性**——错代码被一个同样有缺陷的测试误判通过,循环于是提前提交了错误答案。失败是*非对称*的:假阴性可容忍(还能继续反思),**假阳性致命**(提前提交、不可恢复)。选 Evaluator 时,宁可让它偏向严格。详见 [04 章 #evaluator-dependency](#evaluator-dependency)。

<a id="memory-injection"></a>

## 2.3 反思如何拼回下一轮上下文

反思产出之后,要真正影响行为,必须进入下一个 trial 的 prompt。这一步是机械的字符串拼接,但其中两个设计决定了 Reflexion 能否在长任务上撑住:**反思怎么拼**、**留几条**。

每个 trial 结束,Self-Reflection 产出的 `srt` 被*追加*进 episodic memory。下一个 trial 开始,Actor 把 memory 里的反思文本格式化成一个"过往教训"区块,拼进任务描述之后、生成指令之前。注意:拼进去的是**反思(长期记忆)**,而*不是*完整的历史 trajectory——trajectory 是短期记忆,每个 trial 内重置。这正是 2.4 节消融的物理基础:Actor 看到的是被提炼过的教训,不是原始的失败轨迹。

**代码：memory 注入(对应共享骨架 Actor.act)**

```python
def act(self, task: Task, reflections: list[str]) -> str:
    memory_block = "\n".join(f"- {r}" for r in reflections)   # 长期记忆 → 文本
    prompt = (
        f"实现函数 {task.entry_point}。\n任务:{task.spec}\n"
        + (f"\n过去尝试的教训(避免重犯):\n{memory_block}\n" if reflections else "")
        + "\n只输出函数定义代码。"
    )
    return self.llm.complete(prompt)
```

第二个决定是**容量**。episodic memory 不是无限增长的——它是一个大小为 Ω 的**滑动窗口**,只保留最近 Ω 条反思(论文 Ω=1–3;AlfWorld 用 3,programming 用 1)。截断的原因是上下文长度:trial 3 时,如果把全部历史都塞进去,prompt = 任务 + 3 次完整尝试 + 3 条反思,长任务会直接溢出窗口(见 [04 章 #memory-bloat](#memory-bloat))。Ω 是为适配上下文限制而设的**容量上限**,论文明确指出它*不是* vector DB——向量库 / SQL 检索被列为 future work。

**代码：Ω 滑动窗口(对应共享骨架 EpisodicMemory.add)**

```python
def add(self, sr: str) -> None:
    self.reflections.append(sr)
    self.reflections = self.reflections[-self.capacity:]   # 只保留最近 capacity 条
```

![反思通过滑动窗口注入下一轮上下文](/blog-assets/reflexion-verbal-reinforcement/02-03.svg)

图 2-3：失败 trial 的反思被追加进 Ω 滑动窗口；下一轮只读取最近几条反思，而不是重放完整 trajectory。

**带来的代价 · Ω 的两难**

Ω 调小:省 token、抗溢出,但跨越多个 trial 的教训会被滑出窗口而遗忘。Ω 调大:记得多,但长任务下 prompt 迅速膨胀,既贵又可能触上下文上限,还稀释了模型对最新教训的注意力。论文用 Ω=1–3 是工程折中,不是理论最优——它把"记忆"压在了一个很窄的窗里,这也是 Reflexion 难以处理需要长期积累的任务的结构性原因。

<a id="ablation"></a>

## 2.4 反思 ≠ 重试：消融证据

一个自然的怀疑:Reflexion 的收益,会不会只是"多试了几次"?毕竟给模型第二次、第三次机会,本身就可能撞对。论文用消融实验正面回应了这个问题,结论很硬:**起作用的是"反思"这一步,不是"重试"本身。**

**消融:把"反思"从循环里拿掉会怎样(论文)**

| 配置 | Actor 下一轮看到什么 | 相对效果 |
| --- | --- | --- |
| 不重试(单次) | — | 基线 60% |
| blind retry(盲目重试) | 把上次 trajectory 原样塞回 | **52%,反而低于不重试** |
| episodic-memory-only | 只给历史轨迹,无反思 | 有限提升 |
| 反思引导的 refinement | 提炼过的 reflective text(定位+处方) | 较 memory-only 再 **+8% 绝对值** |

两个数字钉死结论。其一,**盲目重试 52% < 不重试 60%**:把原始失败轨迹塞回上下文,不仅没帮助,还把模型往错误方向引(它倾向于复刻上次的错误路径)。其二,**反思比只给历史轨迹再多 +8% 绝对值**:同样是"看过去",看"提炼后的教训"显著优于看"原始轨迹"。差距就出在 2.1 节那一步——credit assignment。反思把"发生了什么"压缩成"哪步错了、该怎么改",而原始轨迹把这个推断的负担又甩回给 Actor。

**别记成"多试几次就有用"**

"我读得很顺,反思不就是 retry 吗"——如果脑子里冒出这句,正是该停下的信号。Reflexion 与 retry 的分界,不在"试了几次",而在"两次之间发生了什么处理"。把这一步去掉,52% 这个数字会提醒:盲目重试比单次更差。下一章动手时,留白 B(怎么写反思 prompt)考的就是这一点。

**带来的代价 · 涌现性与成本**

反思能完成 credit assignment,前提是模型*本身*足够强——自我纠错是更强模型的涌现能力。弱模型(starchat-beta)上 Reflexion 0.26 = baseline 0.26,反思形同虚设。此外,一轮 Reflexion 要 10–30s(单次推理仅约 0.8s);在*相同采样预算*下,多次尝试常常打不过 self-consistency。这些都在 [04 章 #cost](#cost) 展开。

<a id="alternatives"></a>

## 2.5 为什么没选别的：六种范式的分界轴

Reflexion 不是凭空出现的,它在一族"让 agent 做得更好"的方法里有明确的生态位。理解它的关键,是理解它*不*是什么——以及在什么条件下,别的范式才是对的选择。下表给出六个最常被拿来比较的方法,选中行是 Reflexion 的适用区间。

**Reflexion vs 五种相邻范式(分界轴)**

| 范式 | 一句话本质 | 与 Reflexion 的分界轴 | 什么时候选它而非 Reflexion |
| --- | --- | --- | --- |
| ReAct | 单条轨迹里交错 reason + act + observe | 单轨迹、不跨尝试学习;Reflexion 把 ReAct 当 Actor,外面套评估→反思→重试 | 任务一遍能解、无需从失败中改进时 |
| CoT | 单遍生成中间推理步 | 无评估、无记忆、无第二次尝试 | 没有可验证信号、也不打算重试时 |
| Self-Refine | 同一 session 内自评 → 自改一个输出 | **无外部 reward、不跨 trial、不持久化记忆**——最易与 Reflexion 混淆 | 没有外部 verifier、只想润色单个输出时 |
| Tree of Thoughts | 在推理分支树上搜索(BFS/DFS) | 探索"宽度"(一次尝试内并行铺开);Reflexion 探索"时间"(跨 trial 串行改进) | 解空间需要广度搜索、单步可枚举候选时 |
| CRITIC | 调外部工具验证并就地改正 | 工具 grounding、任务内即时纠正;Reflexion 是 reward 驱动的跨 trial 记忆 | 有现成工具能即时校验、无需跨尝试积累时 |
| RLHF / 微调 | 梯度更新权重 | 改权重、全局持久、跨任务;Reflexion 是 in-context、临时、per-task、零梯度 | 要把能力**永久**固化进模型、且有数据和算力时 |
| Reflexion | 把失败的标量信号翻译成语言教训、写进记忆、下轮读回 | —(跨 trial · reward 驱动 · 语言记忆 · 零梯度) | 能重试 + 有可靠 Evaluator + 初始正确率不高时 |

把分界轴归纳成两条问题,选型就清楚了:

- **有没有可靠的外部对错信号?** 没有 → CoT / Self-Refine(它们不依赖 verifier);有 → Reflexion / CRITIC / RLHF 才成立。
- **改进要不要跨越多次尝试、并被记住?** 任务内即时纠正 → CRITIC;一次尝试内铺开搜索 → ToT;要永久写进权重 → RLHF;**跨 trial、用语言记忆、不动权重 → Reflexion**。

**深一层 · 最危险的混淆是 Self-Refine**

Self-Refine 和 Reflexion 都"自评 + 自改",代码骨架看起来几乎一样。但 Self-Refine 的"评"是模型自己的主观判断、没有外部 ground truth,且**不跨 trial、不持久化**——它是一个 session 内对单个输出的润色。Reflexion 的"评"来自*独立*的 Evaluator(exact-match / 测试 / 环境 reward),改进被写进 episodic memory 跨尝试累积。一句话:Self-Refine 是"自我审稿",Reflexion 是"在客观判分下跨回合学习"。把 Reflexion 误用成 Self-Refine(去掉外部 reward),恰恰落进 Huang et al. ICLR 2024 证伪的那个区间——无 grounding 的内在自我纠错会净降准确率。RLHF/Self-Refine 这类"自我改进谱系"的整体定位,可参 [agent 规划与反思教程](https://zhiwenliang.github.io/learning/agent-planning/index.html)。

还要补一句生态现实:Reflexion 的 Actor 内部通常就是一个 ReAct 或 CoT 智能体(它复用、而非取代它们),这也是为什么 Reflexion 坐落在这族方法*之上*而非与之并列。关于 ReAct / CoT 本身的机制,见 [agent 推理模式教程](/posts/agent-reasoning-patterns-react-cot-family)。

**跨概念综合题**

场景:某团队让 LLM 玩 WebShop(在线购物,需要大量探索不同商品组合),用 Reflexion 反复跑了 4 个 trial,发现成绩到 trial 4 就平台期、且**始终不超过纯 ReAct**。请结合 2.3(Ω 滑动窗)、2.4(反思的机制)、2.5(分界轴)三节,解释为什么 Reflexion 在这个任务上不灵,并指出更该选哪种范式。

**展开答案**

三层原因叠加。**(1) 任务-范式错配(2.5)**:WebShop 的瓶颈是"探索宽度"——需要尝试大量不同的商品/查询组合,这是 Tree of Thoughts 那种"一次尝试内铺开搜索"擅长的维度。Reflexion 探索的是"时间"(跨 trial 串行改进同一条思路),它不会主动拓宽探索面。**(2) 反思的机制天花板(2.4)**:credit assignment 擅长修"哪一步逻辑错了",但 WebShop 的失败往往不是"某步错了",而是"压根没探到对的商品"——没有明确的错步可定位,反思无从发力,容易反复在同一片狭窄区域打转(local minima)。**(3) Ω 滑动窗的健忘(2.3)**:需要长期积累探索经验的任务,Ω=1–3 的窗口记不住跨越多轮的探索历史,进一步压低了上限。结论:这类高探索任务应转向 **ToT**(广度搜索)或带显式探索策略的方法,而不是 Reflexion。这也呼应论文 Fig 6 与 [04 章 #convergence](#convergence)。

## 本章自测

1. 用一句话说清:为什么 LLM 权重冻结时,标量 reward 无法驱动改进?(提示:credit assignment 与 backprop)
2. reflective text 比标量 reward 多携带了哪两类信息?分别对应 credit assignment 的哪个动作?
3. 所谓"更新"在 Reflexion 里通过什么机制发生?policy 在数学上被参数化成了什么?
4. 论文三类任务的 Evaluator 各是什么?哪一类把"判据"也交给了 LLM,因此最不可信?
5. Ω 滑动窗口为什么是"容量上限"而不是 vector DB?调大和调小各有什么代价?
6. "盲目重试 52% < 不重试 60%"说明了什么?它如何反驳"Reflexion 收益只是多试几次"?
7. **跨机制综合**:一个任务初始正确率已有 85%、且没有可靠 Evaluator。结合 2.1(信号)、2.2(reward 源)、2.5(分界轴),论证为什么对它用 Reflexion 很可能有害,并给出更合适的范式。

**展开参考答案**

**1.** 标量 reward 只携带"整体成败"一个比特、不能定位是哪一步错;而把这个责任分摊到决策上(credit assignment)在数值方法里靠 backprop 完成,权重冻结时没有梯度回传这条路,标量信号于是无法转化为可执行的改进。

**2.** 多携带了*定位*(指认具体 action ai,对应 credit assignment 的"分配责任")和*处方*(给出 a'i 该改成什么,对应"指明修正方向")。这两类信息任何固定维度的数值都编码不下。

**3.** 通过 in-context conditioning——下一轮 Actor 把反思文本读进 prompt、在新上下文下重新生成,不是 backprop。policy 被参数化为"agent 的记忆编码 + 冻结的 LLM 参数",trial 之间唯一变化的是上下文里的那段文本。

**4.** 推理=exact-match 对 ground-truth;决策=手写启发式或 LLM 二分类;编程=自生成单元测试。编程这一类把判据(测试)也交给 LLM 生成,最不可信——MBPP 上 16.3% 假阳性导致了论文唯一一次失利。

**5.** 它只保留最近 Ω(=1–3)条反思,目的是适配上下文长度限制、防止 prompt 溢出,并非按相似度检索的存储(论文把向量库列为 future work)。调小:省 token、抗溢出,但会遗忘跨多轮的教训;调大:记得多但 prompt 膨胀、变贵、稀释对最新教训的注意力。

**6.** 说明把原始失败轨迹塞回去不仅无益、反而有害(模型倾向复刻错误路径),起作用的是"反思"这步做的 credit assignment 而非"重试"本身。配合"反思比 memory-only 再 +8%",直接反驳"收益只是多试几次"——多试反而更差。

**7.** 两个条件同时踩雷。*没有可靠 Evaluator(2.2)*:Reflexion 的反思可以错,但靠一个可信的对错信号兜底;缺了它,循环退化成无 grounding 的内在自我纠错,正是 Huang et al. 证伪的区间。*初始正确率高(2.5/RA 阈值)*:反思只在初始正确率低(约 <20–30%)时净获益,对本就高置信的答案反而把对的改错(correct→incorrect 翻转)。这两点叠加,Reflexion 很可能净降准确率。更合适的选择:若只想润色单个输出,用普通生成 / 谨慎的 Self-Refine;若要保住已有的高正确率,干脆不加自我纠错循环。详见 [04 章 #task-fit](#task-fit)。

**刚好够不着的挑战**

### 给"语言信号"设计一个反例

2.1 节论证了语言信号优于标量。但语言信号的代价是"无法被验证为真"。请设计一个具体任务场景,使得**语言反思的高表达力反而成为缺点**——即反思越"自信、具体",对结果越有害。提示:把"自生成测试假阳性(2.2)"与"reflection hallucination"结合,想一个 Evaluator 和 Self-Reflection*同时*出错、且错误方向一致的情形。把它写成 3–4 句,作为进入 04 章前的诊断练习。

### Further reading

- [Shinn et al., 2023 · Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)(算法、消融、三类 reward 来源、MBPP 失利分析)
- [Prompt Engineering Guide · Reflexion](https://www.promptingguide.ai/techniques/reflexion)(机制速览与对比)
- [Madaan et al., 2023 · Self-Refine](https://arxiv.org/abs/2303.17651)(最易与 Reflexion 混淆的范式,对照 2.5)
- [Gou et al., 2023 · CRITIC](https://arxiv.org/abs/2305.11738)(工具 grounding 的就地纠正,对照 2.5)
- [兄弟教程 · agent 规划与反思](https://zhiwenliang.github.io/learning/agent-planning/index.html)(自我改进谱系中 RLHF / Self-Refine 的定位)


---


<a id="chapter-03"></a>

## 上手实操：跑通一个最小 Reflexion 循环

02 章建立了机制:标量 reward 做不了 credit assignment,语言反思能定位"哪一步错、下次怎么改",反思文本拼回下一轮 context 完成 in-context 更新。这一章把那套机制落成 80 行能直接 `python3` 跑起来的代码——先读懂一个完整 worked example,再补两处关键留白,最后独立扩展一个带边界条件的任务。

**本章你将建立的 schema**

- 一套纯标准库、零 API key 即可运行的 Reflexion 骨架(`reflexion.py`),真实使用时只换 LLM 那一层
- 把代码里的 `act / evaluate / reflect / memory.add / 主循环` 逐一对回 01 章的 Actor、Evaluator、Self-Reflection、trajectory、episodic memory
- 两个决策点的填法:memory 怎么注入 prompt(长期记忆怎么用)、反思 prompt 怎么写(第一人称 + credit assignment)
- 判断一个改动是否"动到了机制":换 Evaluator、换任务边界条件,会怎样改变循环的可靠性

<a id="setup"></a>

## 3.1 环境准备

整章代码只依赖 **Python 3.10+ 标准库**——用到的 `dataclass`、`typing.Protocol`、内置 `exec` 都在标准库里,无需 `pip install` 任何东西。版本下限是 3.10:骨架用了 `list[str]`、`tuple[bool, str]` 这类内置泛型写法,以及 `X | None` 风格,3.9 及以下会报语法错。

真实的 Reflexion 需要一个真 LLM 当 Actor 和 Self-Reflection。但循环逻辑本身——生成、评估、反思、写记忆、重试——和模型是谁无关。所以这里用一个 `ScriptedLLM` 把模型输出"录播"成一个列表:它按调用顺序吐出预设字符串,让整个循环在没有任何网络和密钥的情况下确定性地跑通。验证完逻辑,把 `ScriptedLLM` 换成一个调用 OpenAI 或 Anthropic 的封装(同样实现 `complete(prompt) -> str`),其余一行不用改——这正是骨架把 LLM 抽象成 `Protocol` 的目的。

**运行方式**

把 3.2 节的两段代码依次粘进同一个文件 `reflexion.py`(骨架在前,worked example 的 mock 在后),然后:

`python3 reflexion.py`

没有任何输出之外的依赖。预期输出见 3.2 节末尾。

换真实 API 时,Actor 与 Self-Reflection 可以共用同一个客户端实例(论文里 `M_a`、`M_e`、`M_sr` 常是同一个 base model 的不同 prompt),Evaluator 这里是真跑测试、不调模型——这点在 [02 章 reward 来源](#reward-source)里讲过:编程任务的 Evaluator 是单元测试,不是 LLM judge。

![一轮 Reflexion trial 中的数据类型流动](/blog-assets/reflexion-verbal-reinforcement/03-01.svg)

图 3-1：`Task → code → evaluation → reflection → memory → next prompt`。红色回边是唯一跨 trial 携带信息的通道。

<a id="worked"></a>

## 3.2 Worked example：median 任务从失败到通过

任务设定对应论文的 HumanEval 编程场景:让 LLM 写一个函数通过给定单元测试,Evaluator 就是跑测试。下面这套骨架是 03 与 05 两章共用的同一份 `reflexion.py`——类名和方法签名固定,后面所有练习都在它上面改。先读完整骨架。

**代码：reflexion.py**

```python
"""reflexion.py — 最小可运行的 Reflexion 循环(对应 Shinn et al. 2023, Algorithm 1)"""
from dataclasses import dataclass, field
from typing import Protocol

# ── LLM 接口:换成真实 API 即可接 GPT-4 / Claude ──────────────
class LLM(Protocol):
    def complete(self, prompt: str) -> str: ...

# ── 任务定义 ────────────────────────────────────────────────
@dataclass
class Task:
    spec: str            # 自然语言任务描述
    entry_point: str     # 待实现的函数名
    tests: list[str]     # 充当 Evaluator 判据的 assert 语句

# ── Actor:生成代码(产出 = trajectory)──────────────────────
class Actor:
    def __init__(self, llm: LLM):
        self.llm = llm
    def act(self, task: Task, reflections: list[str]) -> str:
        memory_block = "\n".join(f"- {r}" for r in reflections)
        prompt = (
            f"实现函数 {task.entry_point}。\n任务:{task.spec}\n"
            + (f"\n过去尝试的教训(避免重犯):\n{memory_block}\n" if reflections else "")
            + "\n只输出函数定义代码。"
        )
        return self.llm.complete(prompt)

# ── Evaluator:跑测试,返回 (是否通过, 错误信息) ────────────────
class Evaluator:
    def evaluate(self, code: str, task: Task) -> tuple[bool, str]:
        ns: dict = {}
        try:
            exec(code, ns)                  # 定义函数
            for assertion in task.tests:    # 逐条跑测试
                exec(assertion, ns)
            return True, ""
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

# ── Self-Reflection:把失败转成第一人称语言教训 ──────────────────
class SelfReflection:
    def __init__(self, llm: LLM):
        self.llm = llm
    def reflect(self, code: str, error: str, task: Task) -> str:
        prompt = (
            f"任务:{task.spec}\n我写的代码:\n{code}\n"
            f"测试失败:{error}\n"
            "用第一人称写一条简短教训:我哪一步错了、下次具体怎么改。"
        )
        return self.llm.complete(prompt)

# ── 情景记忆:Ω 滑动窗口(论文 Ω=1-3) ─────────────────────────
@dataclass
class EpisodicMemory:
    capacity: int = 3
    reflections: list[str] = field(default_factory=list)
    def add(self, sr: str) -> None:
        self.reflections.append(sr)
        self.reflections = self.reflections[-self.capacity:]   # 只保留最近 capacity 条

# ── 主循环:Algorithm 1 ──────────────────────────────────────
def reflexion(task: Task, actor: Actor, evaluator: Evaluator,
              reflector: SelfReflection, memory: EpisodicMemory,
              max_trials: int = 3) -> tuple[str, bool, int]:
    code = ""
    for t in range(max_trials):
        code = actor.act(task, memory.reflections)        # 生成 trajectory
        passed, error = evaluator.evaluate(code, task)     # 打分(reward）
        if passed:
            return code, True, t                            # 停止条件:通过
        sr = reflector.reflect(code, error, task)           # 反思
        memory.add(sr)                                      # 写入长期记忆
    return code, False, max_trials                          # 用尽 trials
```

第二段是 worked example 的驱动代码:用 `ScriptedLLM` 把 Actor 的演化"录"成三次输出——trial 0 的 buggy 代码、一条反思文本、trial 1 的 fixed 代码。把它接在骨架后面,同一个文件即可运行。

**代码：reflexion.py(接上)**

```python
class ScriptedLLM:
    """按调用顺序返回预设输出,模拟 Actor 从 buggy → fixed 的演化。
    真实使用时替换为 OpenAI / Anthropic 客户端封装。"""
    def __init__(self, outputs: list[str]):
        self._outputs = list(outputs)
    def complete(self, prompt: str) -> str:
        return self._outputs.pop(0) if self._outputs else ""

task = Task(
    spec="返回数字列表的中位数(偶数长度取中间两数平均)",
    entry_point="median",
    tests=[
        "assert median([1, 3, 2]) == 2",
        "assert median([1, 2, 3, 4]) == 2.5",     # 偶数长度
    ],
)
# 三次 complete 调用:trial0 代码 → 反思文本 → trial1 代码
llm = ScriptedLLM([
    "def median(nums):\n    s = sorted(nums)\n    return s[len(s)//2]",
    "我只取了中间单个元素,没处理偶数长度;下次对偶数长度取中间两数的平均。",
    "def median(nums):\n    s = sorted(nums)\n    n = len(s)\n    if n % 2:\n        return s[n//2]\n    return (s[n//2 - 1] + s[n//2]) / 2",
])
code, ok, trials = reflexion(task, Actor(llm), Evaluator(), SelfReflection(llm), EpisodicMemory())
print(f"passed={ok}  trials_used={trials}")
print(code)
```

运行 `python3 reflexion.py`,预期输出:

**代码：stdout**

```text
passed=True  trials_used=1
def median(nums):
    s = sorted(nums)
    n = len(s)
    if n % 2:
        return s[n//2]
    return (s[n//2 - 1] + s[n//2]) / 2
```

`trials_used=1` 的含义要看准:第 0 次尝试(index 0)失败,反思后第 1 次尝试(index 1)通过,所以返回的索引是 1。trial 0 的代码 `return s[len(s)//2]` 在偶数长度上取了单个中间元素,`median([1,2,3,4])` 返回 `3` 而非 `2.5`,被第二条 assert 拦下;反思定位了这个具体缺陷;trial 1 补上了偶数分支。

### 逐行映射回 01 章概念

骨架里每个动作都对应 01 章一个词汇。读代码时按这张对照表落锚:

actor.act() 这是 [Actor](#actor)——生成 text+action 的 LLM 策略。它的产出 `code:str` 就是这次尝试的 [trajectory(短期记忆)](#trajectory);编程任务里整条轨迹塌缩成一段代码。注意 `act` 的第二个参数 `reflections`:Actor 内部本质是 CoT/ReAct(详见 [agent-reasoning-patterns](/posts/agent-reasoning-patterns-react-cot-family)),Reflexion 没有换模型,只是在它的 prompt 前面多塞了一段记忆。

evaluator.evaluate() 这是 [Evaluator](#evaluator)——给 trajectory 打分。返回的 `passed:bool` 就是 [reward](#evaluator)(这里是 pass/fail 的二值标量),`error:str` 是给反思用的诊断材料。编程任务的 reward 来自真跑测试,不是 LLM 自评。

reflector.reflect() 这是 [Self-Reflection](#self-reflection)——把标量 reward + trajectory + error 转成自然语言教训(reflective text)。这一步做的是 [credit assignment](#credit-assignment):标量"失败"无法说清哪一步错,这段文本能。它的输出以第一人称写出该改什么,这是论文的设计选择。

memory.add() 这是写入 [episodic memory(长期记忆)](#episodic-memory)。`EpisodicMemory` 用 `capacity` 实现 Ω 滑动窗口(论文 Ω=1-3):只保留最近几条反思,适配上下文长度上限——它是个截断的 list,不是向量库。

主循环 for t 这是论文 Algorithm 1:生成 → 评估 → (通过则停)→ 反思 → 写记忆 → 下一轮。下一个 trial 开始时,`actor.act` 把 `memory.reflections` 读进 prompt——这就是 [verbal reinforcement](#why-language) 的字面含义:"学习"通过把上一轮教训拼进上下文发生,模型权重始终冻结。

**预测一下**

如果把 `ScriptedLLM` 的第二个元素(那条反思)删掉,只留 trial 0 和 trial 1 两段代码,`complete` 的调用顺序会怎样错位?`trials_used` 还会是 1 吗?

**展开答案**

会错位。主循环每个 trial 调一次 `act`、失败后调一次 `reflect`,两者都从同一个 `ScriptedLLM` 取下一个输出。trial 0:`act` 取出原本的 buggy 代码,`reflect` 取出本该是 trial 1 的 fixed 代码当成"反思文本"。trial 1:`act` 取到空字符串(列表已空),`exec("")` 不定义 `median`,assert 抛 `NameError`,失败;`reflect` 也取到空串。三个 trial 用尽,返回 `passed=False, trials_used=3`。这恰好暴露了 mock 的本质:`ScriptedLLM` 是按"调用次数"而非"角色"喂数据的,Actor 和 Self-Reflection 共享同一个输出队列——换成真实 LLM 时这个耦合就消失了,因为真实模型对每个 prompt 实时生成。

<a id="partial"></a>

## 3.3 Partial：补全两个关键决策点

骨架里有两处不是"随便填填"的样板代码,而是 Reflexion 成败所系的设计决策。下面把这两处挖空成 `# TODO`,框架其余部分给出。先自己写,再对参考答案。

### 留白 A：Actor 怎么把长期记忆注入 prompt

这一处决定"长期记忆怎么用"。`reflections` 是 `EpisodicMemory` 里累积的反思文本列表;Actor 必须把它们拼进 prompt,而且要让模型清楚这是"过去的教训、避免重犯",否则模型可能把它当噪声忽略,或反过来误读成任务要求。

**代码：练习 A · Actor.act**

```python
class Actor:
    def __init__(self, llm: LLM):
        self.llm = llm
    def act(self, task: Task, reflections: list[str]) -> str:
        # TODO-A1:把 reflections 列表拼成一段可读的 memory 文本
        memory_block = ...
        # TODO-A2:仅当有反思时,才把 memory 段落带标题地插进 prompt
        prompt = (
            f"实现函数 {task.entry_point}。\n任务:{task.spec}\n"
            + ...
            + "\n只输出函数定义代码。"
        )
        return self.llm.complete(prompt)
```

**展开参考答案 + 为什么这么填**

**代码：参考答案 · Actor.act**

```python
        memory_block = "\n".join(f"- {r}" for r in reflections)
        prompt = (
            f"实现函数 {task.entry_point}。\n任务:{task.spec}\n"
            + (f"\n过去尝试的教训(避免重犯):\n{memory_block}\n" if reflections else "")
            + "\n只输出函数定义代码。"
        )
```

**TODO-A1**:把每条反思加 `-` 前缀、换行拼接,渲染成项目符号清单。这不只是好看——逐条分隔让模型把多条教训当成并列的独立约束,而不是糊成一段连续文本里相互稀释。

**TODO-A2**:用 `if reflections` 守卫,空记忆时整段不出现。第一次尝试(trial 0)记忆为空,prompt 里不该凭空冒出"过去的教训"这种误导性标题。标题文案"过去尝试的教训(避免重犯)"是 prompt 工程的关键:它给反思文本一个明确角色——这是历史反馈、不是任务的一部分。决策路径是:*记忆是否非空 → 拼成带角色标签的清单 → 放在任务描述之后、输出指令之前*。位置也有讲究:放在任务之后让模型先理解要做什么,放在输出指令之前让教训成为"最后看到的约束"。

这一处直接对应 [02 章的 memory injection](#memory-injection):长期记忆不是被检索召回的知识库,而是逐轮拼进上下文的一段文本——它能起作用,全靠 Actor 这几行把它放对位置、给对标签。

### 留白 B：Self-Reflection 的 prompt 怎么写

这一处决定反思的质量。reward 只是个标量"失败",信息量为零;真正驱动改进的是这段 prompt 引导出的 reflective text。它必须做两件事:**第一人称**写出教训(论文的设计选择),并强制模型做 **credit assignment**——不是泛泛说"我错了",而是定位"哪一步错、下次具体怎么改"。

**代码：练习 B · SelfReflection.reflect**

```python
class SelfReflection:
    def __init__(self, llm: LLM):
        self.llm = llm
    def reflect(self, code: str, error: str, task: Task) -> str:
        # TODO-B:写一个 prompt,喂入 任务 / 代码 / 错误,
        #         引导模型用第一人称、定位哪一步错、给出下次的具体改法
        prompt = ...
        return self.llm.complete(prompt)
```

**展开参考答案 + 为什么这么填**

**代码：参考答案 · SelfReflection.reflect**

```python
        prompt = (
            f"任务:{task.spec}\n我写的代码:\n{code}\n"
            f"测试失败:{error}\n"
            "用第一人称写一条简短教训:我哪一步错了、下次具体怎么改。"
        )
```

prompt 把三样东西摆齐:任务规格(对标准)、自己写的代码(被诊断对象)、具体错误(reward 之外的诊断信号)。最后一句指令是核心——它同时锁死了两个要求:

**第一人称**("我哪一步错了"):这是论文明确的设计选择,反思文本以第一人称写出该改什么。第一人称让教训读起来像 agent 对自己的指令,下一轮拼进 prompt 时更像"自我提醒"而非"旁观评价"。注意这是*被生成的程序内容*,出现在代码字符串里合规——讲解它时仍用第三人称。

**定位 + 具体改法**("哪一步错、下次具体怎么改"):这逼模型做 credit assignment。对比两条反思——"我的代码有 bug"(无定位,下一轮 Actor 不知道改哪)对上"我只取了中间单个元素,没处理偶数长度;下次对偶数长度取中间两数平均"(定位到具体步骤 + 可执行的修法)。后者才是 [02 章说的高维带定位的纠错信号](#credit-assignment),标量 reward 永远表达不了。决策路径:*给齐三份材料 → 用指令同时约束人称和粒度 → 产出可被下一轮直接照做的教训*。

顺带提一个边界:这里把 `error` 字符串(如 `AssertionError` 或 `NameError: ...`)喂给反思,而不是只喂"失败"二字。02 章讲过 reward 是标量,但 Evaluator 顺手带回的 `error` 是免费的诊断材料——把它交给反思能显著提升 credit assignment 的准确度。这不违背"reward 是标量":停止判定靠 `passed` 这个标量,定位靠 `error` 这段文本。

**两处留白的共性**

A 和 B 一进一出,卡住了同一条命脉:反思文本是 Reflexion 唯一跨 trial 流动的信息。B 决定这段文本*含不含可执行的定位信息*,A 决定它*有没有被放回模型能用到的位置*。任一处写砸,循环就退化成"盲目重试"——而 [02 章消融](#ablation)已经量化过:盲目 refinement(52%)反而低于不 refine(60%),起作用的从来是反思这一步的 credit assignment。

<a id="open"></a>

## 3.4 Open：独立扩展一个带边界条件的任务

前两节给了完整轮子。这一节合上参考、自己动手。任务有两条独立路线,任选其一(或都做):

1. **路线一(换任务)**:把 `median` 换成一个*带边界条件*的新函数——边界条件是关键,因为它制造了 trial 0 容易漏、反思容易定位的缺陷。例如 `chunk(lst, size)`:把列表按 `size` 切块,最后一块允许不足 `size`,空列表返回 `[]`。给至少 3 条 assert(含一条空输入 + 一条 `size>len` 的边界);用 `ScriptedLLM` 录一段 trial 0 漏掉边界 → 反思 → trial 1 修复的演化。
2. **路线二(换 Evaluator)**:把 `Evaluator` 从"跑单元测试"换成"LLM judge"——新类实现同样的 `evaluate(code, task) -> (passed, error)` 签名,但 `passed` 由一个 LLM 读代码后回 `PASS`/`FAIL` 决定(mock 里用 `ScriptedLLM` 录判决)。

**硬性要求**

实现里必须显式用到 **01 章 ≥3 个概念**(在代码注释里点名,如 `# Actor` / `# Evaluator` / `# episodic memory / trajectory`),并在收尾段落讨论 **02 章某一个权衡**。路线二天然牵出 [reward 来源](#reward-source)那个权衡:LLM judge 比单元测试更通用,但*可靠性更低*——这正是论文 MBPP 翻车的根因(自生成判据 16.3% 假阳性),细节留到 [04 章](#evaluator-dependency)。

**动手前先想**

路线二里,如果 LLM judge 误判一个错代码为 `PASS`(假阳性),循环会怎样?这和 judge 误判一个对代码为 `FAIL`(假阴性)相比,哪种更危险?

**展开答案**

假阳性致命、假阴性可容忍——这是 Reflexion 的非对称失败模式。假阴性时,对的代码被判 `FAIL`,循环继续反思重试,顶多浪费几轮 trial,最终仍可能收敛。假阳性时,错的代码被判 `PASS`,主循环立刻 `return code, True, t` 提前提交——错误答案不可恢复,后面再没有机会纠正。论文里 MBPP 是唯一一次失利(77.1% < GPT-4 的 80.1%),根因正是自生成测试 16.3% 的假阳性率(HumanEval 仅 1.4%)。*是 reward 源错了,不是反思错了*。所以换 Evaluator 时,宁可让判据偏严(多几个假阴性),也别让它偏松。

**展开参考实现(路线一:chunk 边界任务)+ 决策说明**

**代码：open_chunk.py(接 reflexion.py 骨架)**

```python
# 复用 reflexion.py 的 Task / Actor / Evaluator / SelfReflection /
# EpisodicMemory / reflexion / ScriptedLLM —— 一行不改,只换任务数据。

# Task = 一个带边界条件的新规格(空列表 + size>len 两个边界）
task = Task(
    spec="把列表按 size 切成多个子列表;最后一块允许不足 size;空列表返回 []",
    entry_point="chunk",
    tests=[
        "assert chunk([1,2,3,4,5], 2) == [[1,2],[3,4],[5]]",  # 不足 size 的尾块
        "assert chunk([], 3) == []",                          # 空输入边界
        "assert chunk([1,2], 5) == [[1,2]]",                  # size > len 边界
    ],
)

# Actor(由 ScriptedLLM 驱动):trial0 漏掉尾块 → 反思 → trial1 修复
# 第二个元素是 reflective text(第一人称,论文设计)= 跨 trial 的 episodic memory
llm = ScriptedLLM([
    # trial0:用 len(lst)-size+1 当上界,丢掉不足 size 的尾块,空列表也没覆盖
    "def chunk(lst, size):\n    return [lst[i:i+size] for i in range(0, len(lst) - size + 1, size)]",
    # reflection:credit assignment —— 定位到"上界算错",给出可执行改法
    "我用 len(lst)-size+1 当上界,丢掉了不足 size 的最后一块,空列表也没覆盖;"
    "下次直接 range(0, len(lst), size)。",
    # trial1:按反思修复
    "def chunk(lst, size):\n    return [lst[i:i+size] for i in range(0, len(lst), size)]",
])

# 主循环 = Algorithm 1:Actor 产 trajectory(code）→ Evaluator 打分 →
#          失败则 Self-Reflection 反思 → 写入 EpisodicMemory → 下一轮
code, ok, trials = reflexion(task, Actor(llm), Evaluator(),
                             SelfReflection(llm), EpisodicMemory())
print(f"passed={ok}  trials_used={trials}")
print(code)
```

**代码：stdout**

```text
passed=True  trials_used=1
def chunk(lst, size):
    return [lst[i:i+size] for i in range(0, len(lst), size)]
```

**用到的 01 章概念**(注释已点名):[Actor](#actor)(产出 trajectory)、[Evaluator](#evaluator)(跑 assert 打分)、[episodic memory](#episodic-memory) + [trajectory](#trajectory)(反思写入长期记忆、code 即短期记忆)。

**用到的 02 章权衡**:边界条件是 Reflexion 的*甜区*。trial 0 的初始解在主路径上看着对,只在边界(空输入、`size>len`)崩——这种"初始正确率不高、且失败可被测试精确定位"的任务,正是 [02 章](#ablation)说反思最划算的场景。边界 assert 让 Evaluator 给出的 `error` 精确指向问题,Self-Reflection 才能完成有效的 credit assignment。反过来,若任务本来就几乎全对(初始正确率高),反思反而可能把对的改错——这条阈值留到 [04 章](#task-fit)。

**展开参考实现(路线二:LLM-judge Evaluator)+ 决策说明**

**代码：open_judge.py(接 reflexion.py 骨架)**

```python
# 复用骨架,只替换 Evaluator —— 同样的 evaluate(code, task) -> (passed, error) 签名,
# 但 passed 由一个 LLM 判定,而非真跑测试。这把"客观 reward"换成"模型 reward"。
class LLMJudgeEvaluator:
    """Evaluator 变体:reward 来自 LLM judge,不再跑单元测试。
    签名与原 Evaluator 完全一致,可直接塞进同一个 reflexion() 主循环。"""
    def __init__(self, llm: LLM):
        self.llm = llm
    def evaluate(self, code: str, task: Task) -> tuple[bool, str]:
        verdict = self.llm.complete(
            f"判定下面代码是否满足任务,只回 PASS 或 FAIL:\n{code}\n任务:{task.spec}"
        ).strip()
        passed = verdict == "PASS"
        return passed, "" if passed else "judge 判定:代码未满足规格"

task = Task(
    spec="把列表按 size 切成多个子列表;最后一块允许不足 size;空列表返回 []",
    entry_point="chunk",
    tests=[],   # LLM judge 路线不依赖 assert,tests 留空
)

# 两个独立的 ScriptedLLM:一个驱动 Actor,一个驱动 judge —— 职责分离
actor_llm = ScriptedLLM([
    "def chunk(lst, size):\n    return [lst[i:i+size] for i in range(0, len(lst) - size + 1, size)]",
    "def chunk(lst, size):\n    return [lst[i:i+size] for i in range(0, len(lst), size)]",
])
judge_llm  = ScriptedLLM(["FAIL", "PASS"])  # judge:trial0 不过、trial1 通过
reflect_llm = ScriptedLLM([
    "我漏了不足 size 的尾块和空列表;下次用 range(0, len(lst), size)。"
])

code, ok, trials = reflexion(
    task, Actor(actor_llm), LLMJudgeEvaluator(judge_llm),
    SelfReflection(reflect_llm), EpisodicMemory(),
)
print(f"passed={ok}  trials_used={trials}")
print(code)
```

**代码：stdout**

```text
passed=True  trials_used=1
def chunk(lst, size):
    return [lst[i:i+size] for i in range(0, len(lst), size)]
```

**关键设计**:`LLMJudgeEvaluator` 与原 `Evaluator` 签名逐字相同——这正是骨架把组件解耦的回报:换 reward 来源不动主循环一行。Actor、judge、Self-Reflection 用三个独立的 `ScriptedLLM`,避免上面 worked example 里"共享输出队列"的耦合,也更贴近真实部署(三个角色可以是三次独立 API 调用)。

**用到的 02 章权衡 —— reward 可靠性**:LLM judge 比单元测试通用得多(任何自然语言规格都能判,不必先写出 assert),代价是*可靠性骤降*。单元测试要么过要么不过,客观;LLM judge 会假阳性——把错代码判成 `PASS`,触发主循环提前 `return` 提交错误答案。论文 [reward 来源](#reward-source)那张表里,编程任务坚持用自生成测试而非 judge,正是这个原因;而 MBPP 唯一失利就栽在判据假阳性上。结论很直接:*Reflexion 的天花板由 Evaluator 的可靠性决定,不由反思能力决定*——没有可信的对错信号,反思越积极越危险。这条依赖关系是 [04 章第一个失败模式](#evaluator-dependency)。

## 本章自测

1. `trials_used=1` 到底意味着第几次尝试通过?为什么返回的不是 2?
2. worked example 里 Actor 和 Self-Reflection 传入的是同一个 `ScriptedLLM` 实例。这个共享在真实 LLM 下会不会造成问题?为什么?
3. 留白 A 里那个 `if reflections` 守卫去掉会怎样?第一次尝试的 prompt 会变成什么样,可能误导模型吗?
4. 留白 B 的 prompt 若改成只说"反思一下哪里错了"、不要求"下次具体怎么改",反思文本的质量会怎样退化?它还能让下一轮 Actor 改对吗?
5. 路线二把 Evaluator 换成 LLM judge 后,哪一种误判(假阳性 / 假阴性)会让循环不可恢复?对应论文哪一次失利?

**展开参考答案**

**1.** 第 1 次尝试(index 1)通过;返回的是通过那一轮的循环索引 `t`。trial 0(index 0)失败、反思,trial 1(index 1)通过即 `return code, True, t`,此时 `t==1`。它数的是"通过发生在第几个 trial",从 0 起。

**2.** 真实 LLM 下没问题。`ScriptedLLM` 是按调用次数顺序吐预设输出,所以 Actor 和 Self-Reflection 共享一个队列会"抢"彼此的输出——这是 mock 的人工产物。真实 LLM 对每个 prompt 实时独立生成,不存在共享队列,Actor 调一次生成代码、Self-Reflection 调一次生成反思,互不干扰。

**3.** 去掉守卫后,trial 0(记忆为空)的 prompt 里会凭空出现"过去尝试的教训(避免重犯):"这个标题,后面跟一段空的 `memory_block`。模型可能被这个空标题困惑,甚至幻觉出并不存在的"过去尝试"。守卫保证记忆为空时整段不出现——空记忆就该是"没有历史",而非"历史为空字符串"。

**4.** 会退化成无定位的泛泛之谈,如"我的代码有问题"。下一轮 Actor 读到这种反思,不知道该改哪一步,大概率重蹈覆辙或乱改。"下次具体怎么改"这句逼模型完成 credit assignment——把"失败"翻译成可执行的修法。缺了它,反思就退回到接近盲目重试的状态,而消融实验已证明盲目重试比不重试还差。

**5.** 假阳性(错代码被判 `PASS`)不可恢复:主循环立刻提交错误答案、不再有反思机会。假阴性(对代码被判 `FAIL`)可容忍:循环继续反思重试。对应论文唯一一次失利——MBPP-Python 77.1% < GPT-4 的 80.1%,根因是自生成测试 16.3% 的假阳性率。

**刚好够不着的挑战**

### 给主循环加一道"是否值得反思"的护栏

当前主循环失败后无条件反思。但 04 章会讲一个反直觉事实:对初始就高置信、本来对的答案做反思,反而可能把对的改错([correct→incorrect 翻转](#reflection-hallucination))。试着在 `reflexion()` 里加一个护栏:只有当失败"够明确"(比如 `error` 非空、且不是因为代码根本没跑起来的 `SyntaxError`)时才反思,否则换一种策略(如直接重采样、或提前放弃)。想清楚:这个护栏该放在主循环哪一步?它和 `max_trials` 早停是什么关系?——这正是 [05 章 capstone](#decisions) 要展开的扩展方向之一,先在脑子里设计好接口。

### Further reading

- Shinn et al. 2023 — Reflexion 论文(Algorithm 1 即本章主循环):[arxiv.org/abs/2303.11366](https://arxiv.org/abs/2303.11366)
- 官方实现(把 mock 换成真实 LLM 后的参考):[github.com/noahshinn/reflexion](https://github.com/noahshinn/reflexion)
- Prompt Engineering Guide · Reflexion(prompt 写法参考):[promptingguide.ai/techniques/reflexion](https://www.promptingguide.ai/techniques/reflexion)
- 本教程兄弟篇 · ReAct/CoT(Actor 内部推理):[agent-reasoning-patterns](/posts/agent-reasoning-patterns-react-cot-family)


---


<a id="chapter-04"></a>

## Reflexion 的失败模式与适用边界

03 章把 Algorithm 1 跑通了:Actor 写代码、Evaluator 跑测试、Self-Reflection 产出第一人称教训、episodic memory 滑动窗口存储。一个能跑通的循环掩盖了一个事实——同一套机制在错误的任务、错误的 Evaluator、错误的初始正确率上会净降准确率。本章拆解六个被论文与复现实验量化过的失败模式,每个回指 02 章的机制根因。

**本章你将建立的 schema**

- Reflexion 的收益不是无条件的:Evaluator 信号质量 + 初始正确率 + 任务多样性需求,三者共同决定它是净赚还是净亏。
- 失败模式按受损组件归类:Evaluator 失效(信号不可靠)、Actor 失效(反思幻觉、弱模型)、Memory 失效(上下文膨胀)、整体经济性(成本 ≈ self-consistency)。
- 最危险的失败是隐性的:在没有 oracle、初始正确率已高的场景,反思会把对的答案改错——而表面流程一切正常。
- "什么时候不用 Reflexion"是一个可执行的判据清单,不是态度问题。

03 章的 worked example 之所以收敛,是因为三个前提同时成立:Evaluator(单元测试)给的是可信信号、初始代码确实错了、任务有唯一正确解。把任意一个前提抽掉,同一套循环就从"自我改进"滑向"自我损害"。本章按受损组件组织六个失败模式,每个都附论文或复现实验的具体数字,并把根因链回 [02 章的机制小节](#why-language)。先看一张全景:这些失败模式分别打在循环的哪个组件上、严重度如何。

![Reflexion 六类失败模式的组件与严重度分布](/blog-assets/reflexion-verbal-reinforcement/04-01.svg)

图 4-1：六个失败模式按“受损组件 × 严重度”分布。Evaluator 缺少 oracle 与 Actor 产生反思幻觉最危险，因为它们可能让错误答案被当成正确答案提交。

致命的失败模式集中在左上:它们破坏的是循环的**正确性判据**本身,而不只是效率。下面逐个拆解,顺序按 [02 章的机制依赖](#reward-source)从根上排起——先是 Evaluator 失效,因为它是整个循环的地基。

<a id="evaluator-dependency"></a>

## 4.1 失败模式一：没有 oracle,改进就消失

> 症状:论文里漂亮的提升数字,换到生产环境就蒸发,甚至变成净下降。

### 症状

团队照搬论文 setup 接一个 reasoning 任务(数学题、常识问答),线下用带标准答案的数据集验证时收益明显;一旦上线、失去标准答案,Reflexion 不再带来提升,内在自我纠错的准确率反而低于不纠错的单遍生成。

Huang et al.([《LLMs Cannot Self-Correct Reasoning Yet》](https://arxiv.org/abs/2310.01798),ICLR 2024,arXiv 2310.01798)复现了 Reflexion 式 setup,得出一个尖锐结论:headline 收益**依赖一个 oracle label 来决定何时停止反思**。把 oracle 拿掉、让模型自己判断对错并据此反思,内在自我纠错**净降准确率**:

**Huang et al. ICLR 2024:去掉 oracle 后的内在自我纠错(单位:准确率 %)**

| 任务 / 模型 | 初始(单遍) | 自我纠错后 | 净变化 |
| --- | --- | --- | --- |
| GSM8K | 75.9 | 74.7 | −1.2 |
| Llama-2 (GSM8K) | 62.0 | 36.5 | −25.5 |
| CommonSenseQA | 75.8 | 41.8 | −34.0 |

### 根因

这直接命中 [02 章 #reward-source](#reward-source) 的机制:Reflexion 的"学习"由 Evaluator 的 reward 驱动,而**反思的方向由"判定为错"这个信号触发**。当 Evaluator 就是被反思的同一个 LLM、又没有外部 ground-truth 锚定时,它的"对错判断"本身就带着和 Actor 一样的偏差。模型既判不准对错,反思自然指向错误的方向——它在用一个不可靠的信号去"纠正"一个本来正确的答案。论文设计里 reasoning 任务用的是 **exact-match 对标准答案**(HotPotQA +20%),决策任务用**手写启发式或环境信号**(AlfWorld 130/134)——这些都是*外部、可信*的判据,不是模型自评。

### 修复：错误写法 / 正确写法

**代码：evaluator_self_judge.py**

```python
# ❌ 错误:让同一个 LLM 既生成答案又判断对错,没有外部锚
class SelfJudgeEvaluator:
    def __init__(self, llm):
        self.llm = llm
    def evaluate(self, answer, task):
        verdict = self.llm.complete(
            f"问题:{task.spec}\n答案:{answer}\n这个答案对吗?只回答 对/错。"
        )
        passed = verdict.strip().startswith("对")
        return passed, ""        # 没有 ground-truth,verdict 和答案同源偏差
```

**代码：evaluator_grounded.py**

```python
# ✅ 正确:Evaluator 锚定到外部可验证信号;无信号时拒绝启用反思循环
class GroundedEvaluator:
    def __init__(self, oracle=None, tests=None):
        if oracle is None and tests is None:
            raise ValueError(
                "Reflexion 需要可信的对错判据(ground-truth / 单元测试 / 环境 reward);"
                "缺失时应退化为单遍生成,而非自评反思。"
            )
        self.oracle, self.tests = oracle, tests
    def evaluate(self, answer, task):
        if self.tests is not None:          # 编程:跑测试(外部、确定)
            return run_tests(answer, self.tests)
        return answer == self.oracle[task.id], ""   # 推理:对标准答案
```

### 如何避免再次触发

把"是否存在外部可验证信号"列为接入 Reflexion 的**准入门槛**,而不是事后检查项:有单元测试、编译器、环境 reward、或线下标准答案,才上反思循环;只有模型自评时,默认退化为单遍生成或 self-consistency。线上无 oracle 的场景,可用线下带标签的数据评估反思是否真的提升,再决定是否部署——绝不能用"线上看起来在自我改进"作为依据。

<a id="reflection-hallucination"></a>

## 4.2 失败模式二：反思幻觉——把对的答案改错

> 症状:反思这一步本身产出了错误的"教训",把一个已经正确的答案翻转成错误答案。

### 症状

Actor 第一次就答对了,但循环没有可靠信号确认"已通过",于是照常进入反思;Self-Reflection 凭空捏造一条"问题",Actor 据此"修正",结果把对的改成错的。这种 **correct→incorrect 翻转**在 Huang 的实验里被量化:

**correct→incorrect 翻转率与净准确率(无 oracle 的内在自我纠错)**

| 设置 | correct→incorrect 翻转 | 净准确率影响 |
| --- | --- | --- |
| GSM8K · GPT-3.5 | 8.8% | 翻转多于纠正 → 净降 |
| GSM8K · Llama-2 | 31% | 62.0 → 36.5(净降 25.5) |

Llama-2 上 31% 的正确答案被反思改错,是 62.0→36.5 这个崩塌的直接来源。翻转率越高、模型越弱,这个失败模式越致命。

### 根因

回指 [02 章 #why-language](#why-language):Reflexion 起作用的前提是 Self-Reflection 能做出*有效的* credit assignment——准确定位"哪一步错了、该怎么改"。但这个能力依赖一个真实存在的错误。当答案其实是对的、却被要求"找出问题并改进"时,语言模型会顺从指令**编造一个并不存在的缺陷**(语言反思的灵活性在这里成了双刃:它能表达任何"教训",包括错误的)。这也是 02 章 [#ablation](#ablation) 那条结论的反面——反思之所以比 blind retry 强(+8% 绝对值),是因为 credit assignment 指向了真实错误;一旦指向虚构错误,同一机制反向放大损害。

**预测一下**

若把反思的触发条件从"每轮都反思"改成"仅当 Evaluator 明确判失败才反思",上面 31% 的翻转率会怎样变化?为什么这恰好对应 Huang 所说的"oracle 决定何时停"?

**展开答案**

翻转率会大幅下降:只要 Evaluator 是可信的,正确答案根本不会进入反思分支,自然不会被改错。Huang 的"oracle 决定何时停"正是这个意思——oracle 的真正作用不是指导反思内容,而是**门控反思是否发生**。论文的收益里有相当一部分来自"oracle 让正确答案及时停止、不被破坏",而非反思本身的纠错力。把这个门控误当成模型自评,翻转就回来了。

### 修复：错误写法 / 正确写法

**代码：loop_always_reflect.py**

```python
# ❌ 错误:无条件每轮反思,正确答案也被拖进反思 → 可能被改错
def loop(task, actor, reflector, memory, max_trials=3):
    code = ""
    for t in range(max_trials):
        code = actor.act(task, memory.reflections)
        sr = reflector.reflect(code, "请找出可改进之处", task)  # 不管对错都反思
        memory.add(sr)
    return code
```

**代码：loop_gated_reflect.py**

```python
# ✅ 正确:反思由可信 Evaluator 门控;判通过立即停,绝不反思正确答案
def loop(task, actor, evaluator, reflector, memory, max_trials=3):
    code = ""
    for t in range(max_trials):
        code = actor.act(task, memory.reflections)
        passed, error = evaluator.evaluate(code, task)   # 外部可信判据
        if passed:
            return code                                  # 停止条件:正确即停
        sr = reflector.reflect(code, error, task)        # 仅在确认失败时反思
        memory.add(sr)
    return code
```

### 如何避免再次触发

反思永远由"已确认的失败"触发,不是由"惯例每轮反思"触发。停止条件必须是循环里的硬约束(`if passed: return`),而非"跑满 max_trials"。模型越弱,这个门控越要严——下一个失败模式会量化弱模型的处境。

<a id="memory-bloat"></a>

## 4.3 失败模式三：记忆膨胀——上下文溢出窗口

> 症状:trial 数一多,prompt 越拼越长,先是变慢变贵,最后溢出上下文窗口直接报错或截断丢信息。

### 症状

到 trial 3 时,prompt 已经等于「任务描述 + 3 次完整尝试 + 3 条反思文本」;长任务(长代码、长轨迹)累积几轮后超出模型上下文窗口,要么报错,要么静默截断——把最关键的早期反思或任务描述挤掉,循环开始"失忆"。

### 根因

回指 [01 章 #episodic-memory](#episodic-memory):episodic memory 是一个 **Ω=1-3 的滑动窗口**,这正是论文为*适配上下文长度限制*而设的容量上限——它不是向量库(论文把向量检索/SQL 列为 future work)。设计上 AlfWorld 用 Ω=3、programming 用 Ω=1。忽略这个上限、把所有历史反思无限拼接,就是把一个有意为之的"有界窗口"当成"无界缓冲"用,直接撞上 02 章 [#memory-injection](#memory-injection) 描述的 context 拼接边界。

### 修复：错误写法 / 正确写法

**代码：memory_unbounded.py**

```python
# ❌ 错误:无限累积反思 + 把每轮完整代码也塞进 prompt
class UnboundedMemory:
    def __init__(self):
        self.reflections = []
        self.full_trajectories = []          # 还把整段代码也存下来
    def add(self, sr, code):
        self.reflections.append(sr)          # 永不截断 → 线性膨胀
        self.full_trajectories.append(code)  # trial 越多,prompt 越长
```

**代码：memory_sliding.py**

```python
# ✅ 正确:Ω 滑动窗口(论文设计),只保留最近 capacity 条反思
from dataclasses import dataclass, field

@dataclass
class EpisodicMemory:
    capacity: int = 3                        # 论文 Ω=1-3;programming 用 1
    reflections: list[str] = field(default_factory=list)
    def add(self, sr: str) -> None:
        self.reflections.append(sr)
        self.reflections = self.reflections[-self.capacity:]  # 截断到窗口
    # 注意:长期记忆只存"反思文本",不存完整 trajectory;
    # 当前 trajectory 是短期记忆,每个 trial 重置,不进 memory。
```

### 如何避免再次触发

把 `capacity` 作为显式参数,按任务轨迹长度调:短轨迹任务可放宽到 3,长代码任务收紧到 1。只持久化**反思文本**(长期记忆),当前 trajectory 属于短期记忆、随 trial 重置、不进 memory(这条区分在 01 章已建立)。上线前用最长的预期输入压测一遍,确认拼好的 prompt 在窗口内。

<a id="cost"></a>

## 4.4 失败模式四：成本——相同预算下并不比采样划算

> 症状:上了 Reflexion,延迟和 token 成本翻几倍,但在相同采样预算下,准确率并不优于简单多采几次。

### 症状

Reflexion 一轮(生成 → 评估 → 反思)耗时约 **10-30 秒**,而单次生成约 **0.8 秒**。多个 trial 叠加,延迟和成本成倍上升。关键的反直觉点:在**相同采样预算**下,Reflexion 的多次尝试 **≈ self-consistency**(多采样投票)——也就是说,把同样的 token 预算花在"采 N 次取多数"上,常常拿到相当甚至更好的结果,而 Reflexion 不一定赚回它的复杂度和延迟。

### 根因

回指 [02 章 #why-language](#why-language):Reflexion 用"推理期算力"换"可靠性"——每个 trial 都是一次完整的生成+评估+反思。当任务本身可以靠并行多采样解决(答案分布里正确答案占多数),反思那一步带来的 credit assignment 增益,抵不过它串行、多轮、长 prompt 的开销。Reflexion 的优势区是"单纯多采样救不了"的任务(初始正确率低、需要定向纠错),不是所有需要多次尝试的场景。

### 修复：错误写法 / 正确写法

**代码：cost_blind.py**

```python
# ❌ 错误:默认上 Reflexion,不和等预算的 self-consistency 比
answer = reflexion(task, max_trials=5)   # 5 轮串行,5×(生成+评估+反思)
# 没有对照:同样的预算如果改成多采样投票会怎样?
```

**代码：cost_baselined.py**

```python
# ✅ 正确:在相同采样预算下,先和 self-consistency 对照再决策
from collections import Counter

def self_consistency(task, actor, n=5):
    samples = [actor.act(task, reflections=[]) for _ in range(n)]
    return Counter(samples).most_common(1)[0][0]   # 多数投票,可并行

# 选型:仅当 Reflexion 在等预算下显著优于 self-consistency,
# 且任务确实"多采样救不了"(初始正确率低),才付它的串行+延迟代价。
def choose(task, actor, evaluator, budget=5):
    baseline = self_consistency(task, actor, n=budget)
    if not needs_directed_correction(task):   # 多采样能解 → 用更便宜的
        return baseline
    return reflexion(task, max_trials=budget)
```

### 如何避免再次触发

把 self-consistency 当作**默认对照基线**:任何上 Reflexion 的决策,都要回答"同样的 token 预算花在多采样投票上,结果如何"。只有当反思的定向纠错确实赢过等预算的并行采样时,串行多轮的延迟和成本才值得。

<a id="convergence"></a>

## 4.5 失败模式五：不收敛——平台期、局部最优、弱模型

> 症状:trial 加了,曲线却拍平不动;或陷在同一类错误里反复反思;或换个弱模型直接毫无效果。

### 症状

三种相关表现:

- **平台期**:WebShop 任务上,Reflexion 在 **trial 4 即触顶**,且**始终不超过 ReAct**(论文 Fig 6)。需要大量探索/多样性的任务,反思无法靠"复盘上次"突破。
- **局部最优**:反思反复指向同一类小修补,Actor 在一个错误区域里打转,不做结构性的换路线尝试。
- **弱模型无效**:starchat-beta 上,Reflexion 得分 **0.26 = baseline 0.26**——完全没有提升。

### 根因

回指 [02 章 #why-language](#why-language) 与 [#credit-assignment](#credit-assignment):Reflexion 探索的是"时间"维度(跨 trial 复盘),而非"宽度"维度(一次尝试内的分支搜索,那是 Tree of Thoughts 的领域)。当任务的瓶颈是**探索不足**而非**纠错不到位**时,反思——再精准的 credit assignment——也只能在已走过的路径附近微调,跳不出去。而弱模型无效的根因更深:**自我纠错是更强模型的涌现能力**。credit assignment 要求模型有能力推断"a_i 导致后续出错、应改成 a'_i";starchat 这一级的模型根本产不出有效的反思文本,语言强化无从发生。

### 修复：错误写法 / 正确写法

**代码：converge_naive.py**

```python
# ❌ 错误:盲目加大 max_trials,期待更多轮就能突破平台期
answer = reflexion(task, model="starchat-beta", max_trials=10)
# 弱模型产不出有效反思;探索型任务再多轮也拍平 → 纯烧钱
```

**代码：converge_guarded.py**

```python
# ✅ 正确:能力门槛 + 平台期早停 + 探索型任务改用宽度搜索
def run_with_guards(task, model, max_trials=4):
    if model_capability(model) < CORRECTION_THRESHOLD:
        return single_pass(task, model)          # 弱模型:别上反思
    if task.needs_exploration:                   # 探索型:宽度而非时间
        return tree_of_thoughts(task, model)     # 换搜索范式
    prev = None
    for t in range(max_trials):                  # 反思型:监控平台期
        ans = reflexion_step(task, model)
        if ans == prev:                          # 连续两轮无变化 → 平台期
            break                                # 早停,不空烧 trial
        prev = ans
    return ans
```

### 如何避免再次触发

先判任务瓶颈:是"纠错不到位"(Reflexion 的主场)还是"探索不足"(交给宽度搜索 / 多样性采样)。再设能力门槛:模型弱到产不出有效反思,就退回单遍生成。最后给循环装平台期早停——连续若干轮 Evaluator 信号或答案不变,立即停止,别用 max_trials 空烧。Actor 内部用 ReAct/CoT 的细节,见 [agent-reasoning-patterns 教程](/posts/agent-reasoning-patterns-react-cot-family);把 Reflexion 摆进"agent 自我改进"谱系的对比,见 [agent-planning 教程](https://zhiwenliang.github.io/learning/agent-planning/index.html)。

<a id="task-fit"></a>

## 4.6 失败模式六：任务不匹配——初始正确率太高反受其害

> 症状:在本就高置信、初始正确率高的任务上启用反思,准确率不升反降。

### 症状

把 Reflexion 套在初始正确率已经很高的任务上,反思频繁地"修正"本来正确的答案,净效果是**降准确率**。[《When Hindsight is Not 20/20》](https://arxiv.org/abs/2404.09129)(arXiv 2404.09129)给出量化的 **RA(reflection)阈值**:反思只在**初始正确率 < 20-30%** 时净获益;用在高置信答案上有害——HotpotQA 上初始 **80.3 → 反思后 76.2**(净降 4.1)。

这和论文里 HumanEval 的成功并不矛盾:HumanEval 的 base 是 GPT-4 的 80% pass@1,Reflexion 把它推到 **91%**——但那是因为编程任务里"失败"由*可信的单元测试*判定(假阳性仅 1.4%),错误答案被准确识别后才反思。问题出在*初始正确率高 + 判据不可靠*同时成立时:反思去动了不该动的答案。

### 根因

回指 [02 章 #reward-source](#reward-source):Reflexion 的收益来自"把错误轨迹纠正过来"。当初始正确率已高,大多数答案本就是对的——可纠正的空间小,而误伤正确答案的风险大。收益与风险的天平在初始正确率高时整体倒向风险一侧。这与失败模式二(反思幻觉)同源——都是"对正确答案做了不必要的反思",但这里的判据是**任务层面的初始正确率**,是选型阶段就能预判的,不必等到运行时才发现翻转。

**非对称失败**

论文给的更深一层判据:Evaluator 的**假阴性可容忍**(误判为失败,还能继续反思修正),**假阳性致命**(误判为通过,提前提交错误答案不可恢复)。这正是论文唯一一次失利的根因——MBPP-Python **77.1% < GPT-4 的 80.1%**,因为自生成测试有 **16.3% 假阳性**(HumanEval 仅 1.4%),错代码被误判通过、提前提交。是 reward 源错了,不是反思错了。

### 修复：错误写法 / 正确写法

**代码：fit_blanket.py**

```python
# ❌ 错误:对所有任务一刀切上反思,不看初始正确率
def solve(task, actor, evaluator, reflector, memory):
    return reflexion(task, actor, evaluator, reflector, memory)
    # 高置信任务也反思 → 误伤正确答案(HotpotQA 80.3 → 76.2)
```

**代码：fit_gated.py**

```python
# ✅ 正确:用初始正确率 / 置信度门控是否启用反思
RA_THRESHOLD = 0.30   # 《When Hindsight》:初始正确率 < 20-30% 才净获益

def solve(task, actor, evaluator, reflector, memory):
    first = actor.act(task, reflections=[])
    passed, error = evaluator.evaluate(first, task)   # 需可信判据(低假阳性)
    if passed:
        return first                                  # 已对:不反思,避免误伤
    if estimated_initial_accuracy(task) >= RA_THRESHOLD:
        return first        # 高置信任务:即使这条错了,反思整体期望为负 → 不上
    return reflexion(task, actor, evaluator, reflector, memory)
```

### 如何避免再次触发

选型阶段先估初始正确率:本就高置信的任务(初始正确率超过 20-30%)默认不上 Reflexion,或仅在有**低假阳性**判据时谨慎启用。把"初始正确率是否够低"和"Evaluator 假阳性是否够低"做成两道并列的准入门槛——这正是下一节"什么时候不用"清单的核心两条。

<a id="when-not"></a>

## 4.7 诚实段：什么时候不要用 Reflexion

Reflexion 不是默认选项。把它当成有明确适用边界的工具,以下任一条成立时,默认**不用**:

**Reflexion 的"不适用"判据(满足任一条即默认不上)**

| 判据 | 为什么不适用 | 替代 |
| --- | --- | --- |
| 没有可靠的 Evaluator(无单元测试 / 环境 reward / 标准答案,只能模型自评) | 无 oracle 时改进消失,且会净降准确率(§5.1) | 单遍生成 / 工具 grounding(CRITIC) |
| 任务初始正确率已高(> 20-30%) | 误伤正确答案的风险大于纠错收益(§5.6,HotpotQA 80.3→76.2) | 单遍 / self-consistency |
| 任务单次就能解 / 不允许重试 | 跨 trial 学习无处发生;Reflexion 的"时间维度"探索失去意义 | 单遍生成 |
| 用的是弱模型(自我纠错能力未涌现) | 产不出有效反思文本,starchat-beta 实测 0.26 = baseline(§5.5) | 换更强模型 / 单遍 |
| 瓶颈是探索不足而非纠错不到位 | 反思只在已走路径附近微调,跳不出(WebShop trial4 平台期,§5.5) | Tree of Thoughts / 多样性采样 |
| 相同预算下 self-consistency 已够好 | 串行多轮 + 长 prompt 的开销抵不过并行采样(§5.4) | self-consistency |

**现状提醒 · 截至 2026-06**

"让模型无 grounding 自己 review 自己"已被 Huang et al.(ICLR 2024)证伪——不要学。值得注意的转向:SCoRe(DeepMind,2024-09,arXiv 2409.12917)用多轮 RL 在自生成数据上训练,得到真正的内在自我纠错(+15.6% MATH),把 Huang 的结论改写为"未经训练的 prompting 不行",而非"原理上不可能"。当下共识(CMU,2026-02):外部反思循环与 o1/R1 这类推理模型**互补而非替代**,且外部反思循环存在 **3-7 轮的能力天花板**——这正是 §5.5 平台期的更一般形式。

## 自测

1. 同一套 Reflexion 循环,接 HumanEval(单元测试当 Evaluator)收益显著,接"无标准答案的开放问答 + 模型自评"却净降准确率。用 §5.1 的机制解释这个落差,并指出根因链到 02 章哪个 anchor。
2. Llama-2 在 GSM8K 上从 62.0 掉到 36.5。这个 25.5 的净降里,"correct→incorrect 翻转"扮演什么角色?把反思触发条件改成什么,能直接堵住这个失败模式?
3. 一位工程师为提升收敛,把 `max_trials` 从 3 调到 10,用的是 starchat-beta。预测结果,并说明为什么这同时踩中"弱模型"和"成本"两个失败模式。
4. 《When Hindsight is Not 20/20》说反思只在初始正确率 < 20-30% 才净获益。HotpotQA 上 80.3→76.2 是这条的例证。它和论文 HumanEval 80%→91% 的成功为什么不矛盾?(提示:判据的假阳性率。)

**展开参考答案**

**1.** HumanEval 的 Evaluator 是外部、确定的单元测试(假阳性仅 1.4%),"失败"判定可信,反思指向真实错误;开放问答用模型自评、无 ground-truth 锚,判定本身带着和 Actor 同源的偏差,反思被错误信号驱动,把对的改错。根因链到 `02-principles.html#reward-source`:Reflexion 的学习由 reward 驱动,reward 不可信则方向错。

**2.** 翻转是净降的主因:31% 的正确答案被反思改错,直接拖垮总分。把触发条件从"每轮都反思"改成"仅当可信 Evaluator 判失败才反思"(并在判通过时立即 `return`),正确答案不进反思分支,翻转被堵住——这就是 Huang 说的"oracle 决定何时停"。

**3.** 结果:几乎无提升且成本激增。starchat-beta 自我纠错能力未涌现(实测 0.26 = baseline),产不出有效反思文本,加轮数也补不上;同时 10 轮串行每轮 10-30s,延迟和 token 成本线性上升,在等预算下还不如 self-consistency。踩中 §5.5(弱模型)+ §5.4(成本)。

**4.** 不矛盾。关键在判据的假阳性率:HumanEval 单元测试假阳性仅 1.4%,错误答案被准确识别后才反思,初始正确率虽不低但纠错指向真实错误;HotpotQA 案例是"初始正确率高 + 判据不可靠"叠加,反思动了不该动的正确答案。论文里 MBPP 失利(77.1 < 80.1)同样源于 16.3% 假阳性。**是 reward 源的质量决定成败,不是任务类型。**

**刚好够不着 · 挑战**

### 给循环加一道"是否值得反思"的护栏

基于 03 章的 `reflexion.py` 骨架,设计一个 `should_reflect(task, first_answer, evaluator) -> bool` 护栏,要同时挡住本章的失败模式二(反思幻觉)和六(高置信反改错)。约束:① 判通过立即停;② 用初始正确率阈值(RA < 20-30%)门控;③ 给 Evaluator 留一个"假阳性率"参数,假阳性高于阈值时拒绝据其提前提交。写出函数 + 三行注释说明每个分支堵的是哪个失败模式。把它接进主循环后,§5.2 的 31% 翻转和 §5.6 的 80.3→76.2 各被哪一行挡下?(参考实现留到 05 章 capstone。)

### Further reading

- [Huang et al., 《LLMs Cannot Self-Correct Reasoning Yet》(ICLR 2024, arXiv 2310.01798)](https://arxiv.org/abs/2310.01798) — §5.1/5.2 的数据来源:无 oracle 改进消失、correct→incorrect 翻转。
- [《When Hindsight is Not 20/20》(arXiv 2404.09129)](https://arxiv.org/abs/2404.09129) — §5.6 的 RA 阈值(初始正确率 < 20-30% 才净获益)。
- [Shinn et al., Reflexion(arXiv 2303.11366)](https://arxiv.org/abs/2303.11366) — WebShop 平台期(Fig 6)、starchat 弱模型、MBPP 假阳性等原始结论。
- [SCoRe(DeepMind, arXiv 2409.12917)](https://arxiv.org/abs/2409.12917) — 把"prompting 自纠错不行"改写为"未经训练才不行"的对照。


---


<a id="chapter-05"></a>

## 综合实战：给内部代码助手加一个自我修正的反思循环

01 章把 Reflexion 拆成 [Actor / Evaluator / Self-Reflection 三组件](#trio)，钉死了"[trajectory 是短期记忆](#trajectory)、[反思文本是长期记忆](#episodic-memory)"。02 章讲透了机制：[为何语言能替代权重](#why-language)、[reward 来源分任务](#reward-source)、[反思 ≠ 重试](#ablation)。03 章把 `reflexion.py` 跑通了。04 章列出机制被违反时的[失败模式](#evaluator-dependency)。本章不再逐节讲机制，而是把前四章塞进一个真实需求：给一个内部代码助手加上"在 CI 测试反馈下自我修正"的能力。它逼出的不是"某步怎么写"，而是**判别**——同一个决策点，这里该用 Reflexion 还是别的模式、Evaluator 该信谁、反思该在哪一层发生。

**本章你将建立的 schema**

- 把"学习发生在上下文、不在权重里"从一句话本质落到一张可运行的 CI 反思循环上
- 三个跨章判别决策——用不用 Reflexion、Evaluator 信谁、反思在哪一层——每个都没有放之四海的默认答案
- 选型判别：一棵决策树分清 Reflexion / 纯 ReAct / Self-Refine / RLHF 各自的主场
- 用可观测行为（首轮过就不反思、反思没推进就早停、反思文本能定位到哪一步错）验收设计，而不是"看起来对"

![Reflexion、ReAct、Self-Refine 与 RLHF 的选型决策树](/blog-assets/reflexion-verbal-reinforcement/05-01.svg)

图 5-1：先判断能否修改权重，再判断有没有可靠验证信号，最后判断是否允许多次尝试。四个终点不是优劣排序，而是适用边界不同。

<a id="project"></a>

## 5.1 项目背景：CI 反馈下的代码助手

一个内部代码助手现在的工作方式是：工程师给一句自然语言需求（"写一个解析 ISO 时间戳的函数"），助手调一次 LLM 生成代码，直接贴给工程师。问题是**一次成的概率不高**——生成的函数经常在边界条件上挂掉，工程师得自己跑测试、自己改。

团队已经有一套现成的资产：每个需求都附带一组单元测试（CI 流水线里跑的那组）。于是有人提议：既然测试能自动判对错，为什么不让助手**自己跑测试、看到失败信息后自己改一版**，改到通过再贴给人？这正是 Reflexion 的设定——把 LLM 写代码当 [Actor](#actor)，把跑 CI 测试当 [Evaluator](#evaluator)，失败时让模型反思"哪一步错了、下次怎么改"。

**需求画像**

**验证信号**：每个任务自带单元测试，跑一遍就是 pass/fail——这是一个[可靠、机器可判的 Evaluator](#reward-source)，不是"让模型自己评自己"。这一条几乎把"该用 Reflexion"写定了。

**初始正确率**：助手当前一次成的比例偏低（边界条件常挂），属于[反思能净获益的区间](#task-fit)（初始正确率越低、反思边际收益越大）。

**可重试**：写代码这个动作天然*可重做*——失败了再生成一版没有副作用，不像"已经把钱转出去了"那种不可逆动作。

**成本约束**：每多一轮就多一次 LLM 调用 + 一次测试，[单轮 10–30s](#cost)。所以要有**早停**，不能无限反思下去。

这套画像把"用 Reflexion"几乎写死了：可靠 Evaluator + 初始正确率低 + 动作可重试 + 任务自带 ground-truth 判据。但"选了 Reflexion"只是起点——真正的工程判断在下面三个决策点上，每一个都对应前面某一章，且都没有"标准答案"，只有"对这个 CI 场景"的答案。

<a id="decisions"></a>

## 5.2 设计任务：三个判别决策

下面每一行都是一次**判别**：给出备选、给出这个场景下的选择、给出"为什么不选另一条"。每个决策点回链到前面定义过它的章节——判别题考的从来不是记住名词，是对[取舍的推理](#alternatives)。

**表 5.1 · CI 代码助手的三个跨章判别决策**

| 决策点 | 备选 | 这个场景选哪个 / 为什么 |
| --- | --- | --- |
| ① 用 Reflexion 还是纯 ReAct / [01 三组件](#trio) · [02 反思≠重试](#ablation) vs [agent-reasoning-patterns](/posts/agent-reasoning-patterns-react-cot-family) | 纯 ReAct（单条轨迹推理+行动）/ Reflexion（外套 评估→反思→重试） | 选 **Reflexion**。判据是两条：*动作能否重试*（写代码可以，重生成无副作用）＋ *有无可靠 verifier*（CI 测试就是）。两条都满足，套上反思循环就能把失败信号变成下一轮的教训。若任一条不满足——比如动作不可逆、或没有任何判对错的信号——就该退回[纯 ReAct 的单轨迹推理](/posts/agent-reasoning-patterns-react-cot-family)，因为 Reflexion 的增益[全部来自那个能判对错的 Evaluator](#ablation)；没有它，反思就是在没有 grounding 的情况下自说自话。 |
| ② Evaluator 用自生成测试还是 ground-truth / [02 reward 来源](#reward-source) vs [04 Evaluator 依赖](#evaluator-dependency) | 让 LLM 自己生成单元测试当判据 / 用 CI 里已有的 ground-truth 测试 | 选 **ground-truth 测试**。团队的 CI 测试是人写、可信的判据。自生成测试看着省事，但 [MBPP 那次失利](#evaluator-dependency)就是栽在它身上——自生成测试有 16.3% 假阳性，会把错代码误判通过、提前提交。Reflexion 的失败**非对称**：假阴性还能继续反思，**假阳性致命**（贴了错答案不可恢复）。CI 场景既然已有 ground-truth，没有任何理由去赌一个高假阳性的判据。自生成测试只在*完全没有现成测试*时才作为退路。 |
| ③ 同 session 改一版还是跨 trial 累积 / [02 备选方案表](#alternatives)（Self-Refine vs Reflexion） | Self-Refine（同一 session 内自评自改，不持久化）/ Reflexion（跨 trial、反思写进 episodic memory） | 选 **Reflexion**。分界轴是*有没有外部 reward + 教训要不要跨尝试留存*。Self-Refine 靠模型自评（无外部信号），且改完即弃、不积累。这里有 CI 这个外部 reward，且希望"上一次踩过的边界坑"能[写进记忆、喂给下一轮](#episodic-memory)，避免重犯同一个错。若这个助手只需"对单次输出润色一遍、不要历史教训"，那 Self-Refine 更轻——但 CI 场景要的是**带外部判据的、跨尝试的纠错**，正是 Reflexion 与 Self-Refine 的分界处（也是两者[最容易被混淆](#alternatives)的地方）。 |

三行有一个共同点值得停下来看：**每个决策的关键都不是"哪个更先进"，而是"这个场景满不满足那条分界判据"**。① 看动作可重试 + 有 verifier；② 看判据可不可信（假阳性代价）；③ 看要不要外部 reward + 跨尝试留存。把"Reflexion 最新所以最好"当默认，是这道题最常见的错——判别的核心就是*认出该用哪条轴去分*。

**想一想**

决策 ② 选了 ground-truth 测试。假设有一天换了个新任务，团队**还没来得及写测试**，只能让 LLM 自己生成测试当判据。这时该把 `max_trials` 调大还是调小？

**展开答案（先停 10 秒再点）**

该**调小**，甚至退回不反思。自生成测试有 [16.3% 假阳性](#evaluator-dependency)——trial 越多，越可能在某一轮"恰好"骗过这个不可靠判据、提前提交一个其实错的答案。判据越不可信，越不该给它更多"蒙混过关"的机会。

更稳的做法：自生成测试时把判据**调严**（比如要求连续两轮都通过、或人工抽检通过的样本再提交），而不是放更多 trial。这正呼应"假阳性致命"——判据的可信度，比尝试次数更决定 Reflexion 到底帮不帮得上忙。

<a id="model-discrimination"></a>

## 5.3 选型判别：Reflexion / ReAct / Self-Refine / RLHF

决策 ① 和 ③ 合起来，其实是在一棵更大的决策树上定位。这棵树（[章首图 5.1](#project)）把四个最容易混淆的"自我改进"模式按分界轴排开。把判别路径走一遍，就能说清"为什么是 Reflexion，而不是它旁边那三个"。

### 三道判别各自在问什么

- **Q1 能改权重 + 有训练数据/算力？** 这是 [RLHF / 微调](#alternatives)与其余三者的分水岭。改权重得到的是*全局、持久*的改进（这个模型以后所有任务都受益），但代价是要数据、要算力、要训练流程。CI 助手是一个轻量内部工具，没有这个预算，也不需要全局改——它只要在*当前这个任务*上改对。所以走"否"。[SCoRe（2024-09）那条前沿](#why-language)正是把反思能力训进权重，但那是另一条重得多的路。
- **Q2 有可靠验证信号？** 这是 Reflexion / Self-Refine 与[纯 ReAct](/posts/agent-reasoning-patterns-react-cot-family) 的分水岭，也是本教程反复强调的[那条红线](#evaluator-dependency)。有测试/环境 reward/oracle 才谈得上"反思"；没有就只能让模型凭空自评——[Huang 等人 ICLR 2024 已证伪](#evaluator-dependency)：无 grounding 的内在自我纠错**净降准确率**。CI 测试是可靠信号，走"是"。
- **Q3 要跨多次尝试累积教训？** 这是 [Reflexion 与 Self-Refine](#alternatives) 的分水岭——也是最细的一刀。两者都在 session 内自我改进，区别在 Reflexion 把反思[写进 episodic memory、跨 trial 持久化](#episodic-memory)（"这次的教训喂给下一轮"），Self-Refine 改完即弃、不留历史。CI 助手希望"上次踩的边界坑别再踩"，要跨尝试留存，走"是"，落到 Reflexion。

**洞察 · 判别不是追新**

资深信号不是"知道 Reflexion 所以到处用"，而是**认得出哪道分界轴在当前场景起决定作用**。CI 助手落在 Reflexion，是因为它三道分界都恰好走到那个终点：不改权重、有可靠判据、要跨尝试留教训。把任意一条改掉——动作不可逆、没有测试、或只需润色单次输出——最优解立刻滑到旁边某个模式。Reflexion 不是更好的 ReAct，它是"ReAct 当 Actor、外面套了评估和跨 trial 记忆"的[组合体](#trio)；用不用那层外壳，由这三道分界决定。

<a id="implement"></a>

## 5.4 自己实现（先别看参考实现）

把 §5.2 的决策落成代码，**在 03 章那套 `reflexion.py` 骨架上扩展**。**先合上参考实现，自己写一版**——判别题的价值在于你做了选择、并能说出为什么；直接看答案等于把这章读成了配置清单。

### 任务：给主循环加早停 + 反思护栏

03 章的 `reflexion()` 主循环有两个隐患，正是 04 章点名的失败模式。本章要在**不改三组件类**的前提下，给主循环加两道护栏：

- **反思护栏（堵 correct→incorrect 翻转）**：[04 章那条"在已经对的答案上继续反思反而改错"](#reflection-hallucination)。所以一旦 Evaluator 判通过，**立刻停、绝不再反思一版**。更进一步：通过即停，不给"对的解"任何被改坏的机会。
- **早停（堵收敛 plateau）**：[04 章 WebShop 那种"trial 4 就平台期、反思不再推进"](#convergence)。所以当反思连续若干轮都没改变结果（同一个错误反复出现），就提前停，不耗满 `max_trials` 白烧 LLM 调用。

同时让主循环返回**每个 trial 的可观测日志**（这一轮过没过、有没有反思、为什么没反思），好让下面的 checklist 能用行为来验。

### 验收 checklist（用可观测行为验，不靠"看起来对"）

- **首轮过就不反思**：喂一个第 0 轮就通过的任务，循环只跑 1 个 trial，且那个 trial 的"是否反思"标记为**否**——绝不在已通过的解上调用 Self-Reflection。
- **失败→反思→通过**：喂 03 章那个 median 例子（首轮漏了偶数长度），循环在第 0 轮失败后反思、第 1 轮通过；日志显示第 0 轮 `reflected=True`、末轮通过且不再反思。
- **反思没推进就早停**：喂一个"每轮都返回同样错代码、报同一个错误"的 mock，`max_trials` 设 5，循环应在**远小于 5** 的轮数停下，并在日志里记下"反思未推进、提前停止"，而不是傻跑满 5 轮。
- **反思文本能定位到哪一步**：打印失败那轮产生的反思文本，它应当是[第一人称 + 指出哪一步错 + 下次怎么改](#credit-assignment)（credit assignment），而不是"我错了，我会改进"这种没有定位的空话。

**验收陷阱**

"早停生效"不能靠"循环跑完了"来证明——要**主动喂一个永远不会进步的 mock**（每轮同样的错代码），看它是否在 `max_trials` 之前停下。一个没有早停的实现，在正常路径（很快通过）下看起来完全正常，只会在"任务太难、反思一直推不动"时[白烧满额度](#cost)才暴露。验收的是**不收敛路径的行为**，不是 happy path。

**参考实现（写完自己版本再展开）**

下面整段基于 03 章的 `reflexion.py`——三组件类（`Actor` / `Evaluator` / `SelfReflection` / `EpisodicMemory`）**原样不动**，只替换主循环 `reflexion()`，新增一个 `TrialLog` 记录可观测行为。纯标准库，可直接 `python3 reflexion.py` 运行。

**代码：reflexion.py（三组件部分 · 与 03 章同源，原样保留）**

```python
"""reflexion.py — Reflexion 循环 + capstone 扩展(早停 + 反思护栏)"""
from dataclasses import dataclass, field
from typing import Protocol

class LLM(Protocol):
    def complete(self, prompt: str) -> str: ...

@dataclass
class Task:
    spec: str
    entry_point: str
    tests: list[str]

class Actor:
    def __init__(self, llm: LLM):
        self.llm = llm
    def act(self, task: Task, reflections: list[str]) -> str:
        memory_block = "\n".join(f"- {r}" for r in reflections)
        prompt = (
            f"实现函数 {task.entry_point}。\n任务:{task.spec}\n"
            + (f"\n过去尝试的教训(避免重犯):\n{memory_block}\n" if reflections else "")
            + "\n只输出函数定义代码。"
        )
        return self.llm.complete(prompt)

class Evaluator:
    def evaluate(self, code: str, task: Task) -> tuple[bool, str]:
        ns: dict = {}
        try:
            exec(code, ns)                  # 定义函数
            for assertion in task.tests:    # 逐条跑测试
                exec(assertion, ns)
            return True, ""
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

class SelfReflection:
    def __init__(self, llm: LLM):
        self.llm = llm
    def reflect(self, code: str, error: str, task: Task) -> str:
        prompt = (
            f"任务:{task.spec}\n我写的代码:\n{code}\n"
            f"测试失败:{error}\n"
            "用第一人称写一条简短教训:我哪一步错了、下次具体怎么改。"
        )
        return self.llm.complete(prompt)

@dataclass
class EpisodicMemory:
    capacity: int = 3
    reflections: list[str] = field(default_factory=list)
    def add(self, sr: str) -> None:
        self.reflections.append(sr)
        self.reflections = self.reflections[-self.capacity:]   # 只留最近 capacity 条
```

**① 扩展点：带早停 + 护栏的主循环**。两道护栏都直接对应 04 章的失败模式——注释里标了堵的是哪一条：

**代码：reflexion.py（扩展的主循环）**

```python
@dataclass
class TrialLog:
    """每个 trial 的可观测记录,供验收 checklist 检查行为。"""
    index: int
    passed: bool
    error: str
    reflected: bool          # 这一轮到底有没有触发反思
    skip_reason: str = ""    # 没反思时,护栏给出的原因

def reflexion(task: Task, actor: Actor, evaluator: Evaluator,
              reflector: SelfReflection, memory: EpisodicMemory,
              max_trials: int = 3,
              patience: int = 2) -> tuple[str, bool, list[TrialLog]]:
    """两道护栏:
       1) 反思护栏: Evaluator 判通过就立刻停、绝不在已通过的解上"再反思一版"
          —— 堵 04 章 reflection-hallucination 的 correct→incorrect 翻转。
       2) 早停: 连续 patience 次"同一个错误信号" → 反思没在推进, 提前停,
          不耗满 max_trials —— 堵 04 章 convergence 的 plateau / 白烧成本。
    """
    code = ""
    logs: list[TrialLog] = []
    last_error = None
    repeat = 0
    for t in range(max_trials):
        code = actor.act(task, memory.reflections)          # 生成 trajectory
        passed, error = evaluator.evaluate(code, task)       # 打分(reward)
        if passed:
            # 护栏 1: 通过即停, 不在正确解上反思(避免把对的改错)
            logs.append(TrialLog(t, True, "", reflected=False,
                                 skip_reason="已通过,无需反思"))
            return code, True, logs
        # 早停判定: 同一个错误信号重复 → 反思没在推进
        repeat = repeat + 1 if error == last_error else 0
        last_error = error
        if repeat >= patience - 1 and t < max_trials - 1:
            logs.append(TrialLog(t, False, error, reflected=False,
                                 skip_reason=f"连续 {repeat + 1} 次相同错误,反思未推进,提前停止"))
            return code, False, logs
        sr = reflector.reflect(code, error, task)            # 反思: 做 credit assignment
        memory.add(sr)                                       # 写入长期记忆
        logs.append(TrialLog(t, False, error, reflected=True))
    return code, False, logs                                 # 用尽 trials
```

**② 三个 mock 验收（对应 checklist 三条可观测行为）**。`ScriptedLLM` 与 03 章同源；真实使用时换成 OpenAI/Anthropic 封装即可：

**代码：reflexion.py（验收演示，可直接跑）**

```python
class ScriptedLLM:
    """按调用顺序返回预设输出。真实使用时替换为 OpenAI / Anthropic 客户端封装。"""
    def __init__(self, outputs: list[str]):
        self._outputs = list(outputs)
    def complete(self, prompt: str) -> str:
        return self._outputs.pop(0) if self._outputs else ""

task = Task(
    spec="返回数字列表的中位数(偶数长度取中间两数平均)",
    entry_point="median",
    tests=[
        "assert median([1, 3, 2]) == 2",
        "assert median([1, 2, 3, 4]) == 2.5",     # 偶数长度
    ],
)

# 演示 1 — 失败→反思→通过(checklist 第 2 条)
llm = ScriptedLLM([
    "def median(nums):\n    s = sorted(nums)\n    return s[len(s)//2]",
    "我只取了中间单个元素,没处理偶数长度;下次对偶数长度取中间两数的平均。",
    "def median(nums):\n    s = sorted(nums)\n    n = len(s)\n    if n % 2:\n        return s[n//2]\n    return (s[n//2 - 1] + s[n//2]) / 2",
])
code, ok, logs = reflexion(task, Actor(llm), Evaluator(), SelfReflection(llm), EpisodicMemory())
print(f"[1] passed={ok} trials_run={len(logs)}")
assert ok and logs[0].reflected and not logs[-1].reflected   # 首轮反思过、末轮通过不再反思

# 演示 2 — 反思没推进就早停(checklist 第 3 条)
same_buggy = "def median(nums):\n    return nums[0]"          # 永远错且报同一个 AssertionError
llm2 = ScriptedLLM([same_buggy, "教训1", same_buggy, "教训2", same_buggy, "教训3"])
_, ok2, logs2 = reflexion(task, Actor(llm2), Evaluator(),
                          SelfReflection(llm2), EpisodicMemory(),
                          max_trials=5, patience=2)
print(f"[2] passed={ok2} trials_run={len(logs2)} (max_trials=5)")
assert not ok2 and len(logs2) < 5 and "提前停止" in logs2[-1].skip_reason   # 远未跑满就停

# 演示 3 — 首轮通过,护栏阻止反思(checklist 第 1 条)
llm3 = ScriptedLLM([
    "def median(nums):\n    s = sorted(nums)\n    n = len(s)\n    if n % 2:\n        return s[n//2]\n    return (s[n//2-1]+s[n//2])/2",
])
_, ok3, logs3 = reflexion(task, Actor(llm3), Evaluator(), SelfReflection(llm3), EpisodicMemory())
print(f"[3] passed={ok3} trials_run={len(logs3)} reflected={logs3[0].reflected}")
assert ok3 and len(logs3) == 1 and not logs3[0].reflected     # 首轮就过、绝不反思

print("ALL ASSERTIONS PASSED")
```

运行 `python3 reflexion.py` 的预期输出：

**代码：预期输出**

```text
[1] passed=True trials_run=2
[2] passed=False trials_run=2 (max_trials=5)
[3] passed=True trials_run=1 reflected=False
ALL ASSERTIONS PASSED
```

**每个决策"为什么选 X 不选 Y"小结**：

- **护栏选"通过即停"不选"再反思一版"**：03 章原循环里，`passed` 后直接 `return` 已经隐含了这条——但本章把它显式记进日志（`reflected=False` + 原因），是为了能*验证*护栏真在挡。[在对的答案上继续反思会触发 correct→incorrect 翻转](#reflection-hallucination)（论文复现里 GSM8K 8.8%、Llama-2 31% 的翻转率），所以"对了就别动它"。
- **早停按"相同错误信号"判,不按固定轮数砍**：固定轮数（比如永远只跑 2 轮）会误伤"前两轮没成、第三轮本能成"的任务。按*错误是否在变*判：错误一直不变，说明反思[没在做有效的 credit assignment、陷在 local minima](#convergence)，再跑也是白烧；错误在变，说明还在推进，就继续。这比"一刀切轮数"更贴合"反思有没有用"这个真实信号。
- **用 `error == last_error` 而非语义相似度**：这是最小可运行的判据（纯标准库）。真实系统里可换成"测试通过数有没有增加"这种更强的进度信号——但分界轴不变：**进度停了就停反思**。
- **不动三组件类**：两道护栏都是*主循环层*的策略，不是组件能力的改变。Actor/Evaluator/Self-Reflection 仍各司其职——这正呼应 01 章"[三组件 + 一个把它们接起来的循环](#trio)"，护栏改的是"循环怎么停"，不是"组件怎么干活"。

**亲手画一张图**

合上教程，在纸上或 Excalidraw 里画出这个 CI 反思循环——**只画 3 个核心节点**：Actor（生成代码）、Evaluator（跑 CI 测试出 pass/fail）、Self-Reflection（失败时产出教训）。再画出连接它们的环，以及那条"反思文本写进 memory、回喂给下一轮 Actor"的回边。画完回到 [章首图 5.1](#project) 与 [01 章三组件图](#trio)对照——**你画的回边，是从 Evaluator 直接连回 Actor（那只是"重试"），还是经过 Self-Reflection 和 memory 再回 Actor？**后者才是 Reflexion；少了中间那步，就退化成 [04 章说的盲目 retry（52% < 不 refine 的 60%）](#ablation)。这条回边走不走 Self-Reflection，正是"反思 ≠ 重试"的全部。

<a id="reflect"></a>

## 5.5 反思问题

1. 这三个决策里，哪个你做得最不确定？回看是哪一章帮你定下来的——是 01 的概念、02 的机制、还是 04 的失败模式？把"卡住→回看哪章→怎么定的"这条路径写下来。判别能力的标志，是能讲清这条回看路径，而不是记住结论。
2. (场景变形) 如果这个 CI 助手要从"写函数"升级成"改一个跨多文件的 bug"——需要**多步**探索代码库、读多个文件、再改。这时该把 Actor 从单步换成 [ReAct 多步](/posts/agent-reasoning-patterns-react-cot-family)吗？换了之后，Evaluator 和 Self-Reflection 要不要跟着改？哪一个组件的工作量变化最大？

**反思参考（先自己想完再展开）**

1. 没有标准答案——重点是**能定位到具体章节**。常见的"最难"是决策 ③（Self-Refine vs Reflexion）：它最细，要同时认清"有没有外部 reward"和"教训要不要跨 trial 留存"两条轴，且 [Self-Refine 与 Reflexion 在文献里最容易被混为一谈](#alternatives)。能讲清"CI 有外部 reward + 要跨尝试留教训 ⇒ Reflexion，而非只润色单次输出的 Self-Refine"，就说明这个判别是推理出来的、不是背的。
2. 应该把 Actor 换成 [ReAct 多步](/posts/agent-reasoning-patterns-react-cot-family)——单步生成搞不定"读多个文件再改"。换之后：**Self-Reflection 的工作量变化最大**。单步任务里，trajectory 就是一段代码，反思只需定位"这段代码哪行错"；多步任务里，trajectory 变成一长串"读文件 A → 推断 → 改文件 B → 跑测试"的动作序列，反思要做的 [credit assignment 难得多](#credit-assignment)——要在*一长串动作里*定位是哪一步（哪次读错了文件、哪次改错了地方）导致最终失败，这正是 Reflexion 比标量 reward 强的地方，但也对反思质量提出更高要求。Evaluator 变化最小：仍是跑那组测试出 pass/fail，判据本身没变。这也说明：**Actor 内部换成 ReAct，Reflexion 的外层循环结构不变**——Reflexion 始终是"把某种 Actor 套进 评估→反思→重试"，01 章那个组合关系在这里再次成立。

**进阶挑战 · 刚好够不着**

### 给护栏加一道"是否值得反思"的前置判断

04 章的 [RA 阈值](#task-fit)说：反思只在初始正确率 <20–30% 时净获益，用在*本来就高置信*的答案上反而有害（HotpotQA 80.3→76.2）。现在的护栏是"失败了才反思"，但它无法区分"差一点点就对（高置信）"和"完全跑偏（低置信）"。给主循环再加一道前置判断：在反思*之前*，先估一个"这次失败到底值不值得反思"的信号，不值得就直接停或换策略，而不是无脑反思。可用的信号有哪些？写出两种，并说明各自的假阳性/假阴性风险。

**提示（卡住再展开）**

可用信号（写代码场景）：① **测试通过比例**——10 条测试过了 9 条（差一点点）vs 过了 1 条（跑偏），前者更值得再反思一轮，后者可能任务本身超纲、该停。② **错误类型**——`AssertionError`（逻辑差一点）比 `SyntaxError` 反复出现（模型根本没理解任务）更值得反思。③ **反思后通过数有没有单调上升**——上升说明在推进，停滞/下降说明该停。风险面：用"通过比例高才反思"会有假阴性——某些任务前期通过数低但一次顿悟就全过，被提前砍掉；用"通过比例"当唯一信号也可能被[假阳性测试](#evaluator-dependency)污染（测试本身判错）。核心仍是 04 章那条：**反思的价值由判据可靠度 + 初始正确率共同决定**，前置判断就是把这两者显式量化进停止策略。

### 本章参考

- [Shinn et al. 2023 — Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)（Algorithm 1：Actor/Evaluator/Self-Reflection + episodic memory）
- [Huang et al. ICLR 2024 — LLMs Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)（决策①②的红线：无可靠 verifier 时反思净降准确率）
- [Madaan et al. 2023 — Self-Refine](https://arxiv.org/abs/2303.17651)（决策③的对照：同 session 自评自改、不跨 trial、无外部 reward）
- [When Hindsight is Not 20/20 (2024)](https://arxiv.org/abs/2404.09129)（进阶挑战的依据：反思只在初始正确率 <20–30% 时净获益）


---


<a id="chapter-06"></a>

## 自测：三层梯度题库

前五章建立了 Reflexion 的词汇表（01）、机制原理（02）、可运行循环（03）、失败模式（04）与综合选型（05）。这一章把这些拆成可单独作答的题目——题干区只放题，所有参考答案锁在文末一个折叠块里。先合上前面的章节作答，再展开核对。

**本章你将检验的 schema**

- **概念层**：能否复述 Actor / Evaluator / Self-Reflection、trajectory、episodic memory、Ω 滑动窗、verbal reinforcement 的定义
- **原理层**：能否解释为何语言能替代权重更新、reward 怎么分任务来源、反思与重试的消融差异、Reflexion 与备选方案的分界轴
- **判别层**：能否对一个具体场景判断该不该上 Reflexion、该选 Reflexion 还是 Self-Refine、某失败现象的根因落在哪个组件

**作答前的提醒**

能顺畅读完前五章，不等于能在合上文档后答出这些题。如果出现「这题我好像见过」「这道我扫一眼就跳过」「我直接展开答案对一下就行」这几种念头，正是检索没有发生的信号——那种「我读得很顺」的流畅感会冒充掌握。每题先在纸上写下答案再展开核对。

<a id="how-to-use"></a>

## 6.0 怎么用这套题

题目按难度分三层，由下往上对应不同的认知动作，也对应不同的章节。底层考**回忆（recall）**——定义记住没有；中层考**理解（understand）**——机制说得通没有；顶层考**判别（discriminate）**——换个场景还分得清没有。下图是这套题与教程章节的映射。

![Reflexion 自测题的回忆、理解与判别三层梯度](/blog-assets/reflexion-verbal-reinforcement/06-01.svg)

图 6-1：题目从概念回忆、原理理解逐步上升到场景判别。判别题最少，却最能检验能否把机制迁移到真实决策中。

**动手画一遍**

在做下面的题之前，先合上整篇教程，凭记忆在纸上画出 Reflexion 的三组件循环：**Actor → trajectory → Evaluator → reward → Self-Reflection → reflective text → episodic memory → 回到 Actor**。标出哪一段是**短期记忆**（trial 内重置）、哪一段是**长期记忆**（跨 trial 保留、Ω 滑动窗），并在外圈写一句话注明「LLM 权重在整个过程中冻结」。画不出来的那一环，就是后面最该重点核对的考点。

<a id="concept-layer"></a>

## 6.1 概念层 · 回忆（对应 01）

每题一问，答案在文末折叠块的「概念层」分组。先写下答案，再核对。

1. 用一句话说出 **Actor** 是什么；它内部是不是一个为 Reflexion 新训练的模型？ / [提示：01 章 §Actor](#actor)
2. **Evaluator** 的输入是什么、输出是什么？ / [提示：01 章 §Evaluator](#evaluator)
3. **Self-Reflection** 把哪两样东西作为输入，产出什么形态的输出？ / [提示：01 章 §Self-Reflection](#self-reflection)
4. **trajectory（轨迹）**在 Reflexion 里对应短期记忆还是长期记忆？它在每个 trial 之间会被保留还是被重置？ / [提示：01 章 §trajectory（短期记忆）](#trajectory)
5. **episodic memory（情景记忆）**里存的是什么内容？它对应短期记忆还是长期记忆？ / [提示：01 章 §episodic memory（长期记忆）](#episodic-memory)
6. 记忆的 **Ω 滑动窗口**是用来做什么的？论文里 Ω 的取值范围是多少？它是不是一个 vector database？ / [提示：01 章 §episodic memory（Ω=1-3 滑动窗口）](#episodic-memory)
7. **verbal reinforcement（语言强化）**一句话指的是什么范式——它靠什么「强化」agent？ / [提示：01 章 §verbal-rl](#verbal-rl)
8. 一个完整的 **trial（试验 / 回合）**包含哪三个步骤，按什么顺序？ / [提示：01 章 §trio（三组件循环）](#trio)

<a id="principle-layer"></a>

## 6.2 原理层 · 理解（对应 02）

这一层不再问「是什么」，问「为什么这样设计、代价是什么」。答案在文末折叠块的「原理层」分组。

1. 标量 reward（比如 pass/fail）**为什么**无法指导 Actor 改进？用 credit assignment 这个词解释，自然语言反思补上了标量缺的哪种信息？ / [提示：02 章 §credit-assignment](#credit-assignment)
2. Reflexion 全程**不更新权重**，那 trial 与 trial 之间究竟是什么发生了变化、使下一次表现更好？换句话说，这里的「policy（策略）」具体是什么？ / [提示：02 章 §why-language](#why-language)
3. 下一个 trial 开始时，上一轮的反思文本是**怎么**影响 Actor 的？是通过梯度回传，还是别的途径？ / [提示：02 章 §memory-injection](#memory-injection)
4. 推理任务（HotPotQA）、决策任务（AlfWorld）、编程任务（HumanEval）三类任务的 Evaluator 各用什么来打分？是不是都用 LLM 当裁判？ / [提示：02 章 §reward-source](#reward-source)
5. 论文的消融实验：把上一次 trajectory 原样塞回上下文（episodic-memory-only / blind retry），和「反思引导的 refinement」相比，效果差多少？这说明真正起作用的是哪一步？ / [提示：02 章 §ablation（反思≠重试）](#ablation)
6. 说出 **Reflexion 与 ReAct** 的分界轴：哪一个跨尝试学习、哪一个不跨？Reflexion 把 ReAct 摆在什么位置？ / [提示：02 章 §alternatives](#alternatives)
7. HumanEval 上 Reflexion 拿到 pass@1 = 91%，而它的 base 模型（GPT-4）本身就有 80%。这个数字组合反驳了一种什么样的误解？ / [提示：02 章 §why-language（结合 index 现状）](#why-language)
8. 反思文本按论文设计是用**第一人称**写的（「我把边界算错了，下次先判断 n 是否为偶数」）。这是作者在正文里说话，还是被展示的程序内容？为什么这样区分很重要？ / [提示：02 章 §memory-injection](#memory-injection)

<a id="discrimination-layer"></a>

## 6.3 应用判别层 · 判别（综合 03+04+05）

这一层给场景、不给术语，要你拍板。每题先决定「用 / 不用 / 用哪个」，再写一句根因。答案在文末折叠块的「判别层」分组。

1. **场景判别（有无可靠 Evaluator）。**团队想给一个「开放式创意文案生成」加 Reflexion，但没有任何客观的对错判据，只能让另一个 LLM 凭感觉打分。该不该上 Reflexion？一句话说出关键约束。 / [提示：04 章 §evaluator-dependency](#evaluator-dependency)
2. **场景判别（初始正确率高低）。**某分类任务模型单次回答已有约 85% 准确率，有人提议「再加一轮反思冲一冲」。依据 RA 阈值的结论，这样做更可能提升还是损害准确率？阈值大概在哪个区间才值得反思？ / [提示：04 章 §task-fit（RA 阈值 <20-30%）](#task-fit)
3. **选型判别（Reflexion vs Self-Refine）。**需求是「同一个 session 内、对单个输出做一次自评自改，不需要外部 reward、也不跨多次尝试积累记忆」。该选 Reflexion 还是 Self-Refine？说出区分这两者的那条轴。 / [提示：05 章 §decisions ／](#decisions)[02 §alternatives](#alternatives)
4. **根因判别（失败落在哪个组件）。**编程任务里，错误的代码**被提前判定通过并提交**了，再也没机会反思修正（对应论文 MBPP 那次唯一失利）。这个失败的根因落在 Actor、Evaluator、还是 Memory？为什么假阳性比假阴性致命？ / [提示：04 章 §evaluator-dependency](#evaluator-dependency)
5. **根因判别（收敛失败）。**把 Reflexion 用在 WebShop 这类需要大量探索、解空间很宽的任务上，反思到第 4 轮就进入平台期、始终追不上纯 ReAct。这暴露了 Reflexion 适用边界的哪一条？根因更偏向「探索宽度」还是「跨时间纠错」？ / [提示：04 章 §convergence ／](#convergence)[§task-fit](#task-fit)
6. **能力前提判别。**有人把 Reflexion 套在一个很弱的小模型（如 starchat-beta）上，发现加了反思后分数和不加几乎一样。这说明自我纠错是模型的什么性质？换强模型还是改循环更可能见效？ / [提示：04 章 §convergence ／ index 现状速览](#convergence)

<a id="answers"></a>

## 6.4 参考答案（全部折叠在此）

三层题目的参考答案统一收在下面这一个折叠块里，按层分组。先把三层题都答完，再一次性展开核对——答错的题回到对应章节的 anchor 重读，比直接看答案更有效。

**展开全部参考答案（概念层 8 + 原理层 8 + 判别层 6）**

### 概念层（对应 01）

1. **Actor** 是生成 text + action 的 LLM 策略；它内部就是 **CoT 或 ReAct**，**不是**为 Reflexion 新训练的模型——权重直接复用，只是被套进反思循环里。
2. Evaluator 的输入是一条 **trajectory（轨迹）**，输出是 **reward**（一个标量分数，或 pass/fail）。
3. Self-Reflection 的输入是 **reward + 这次的 trajectory**，输出是**自然语言写的教训（reflective text / 反思文本）**——把「失败」翻译成「哪一步错了、下次怎么改」。
4. trajectory 对应**短期记忆**；它是单次尝试的完整 action/observation 序列，**每个 trial 之间被重置**（下一次重新生成，不累积）。
5. episodic memory 里存的是**跨 trial 累积的反思文本（reflective text）buffer**；它对应**长期记忆**。
6. Ω 滑动窗口是为**适配上下文长度限制**而设的「容量上限」——只保留最近 Ω 条反思。论文里 **Ω = 1–3**（AlfWorld 用 3、programming 用 1）。它**不是 vector database**（向量库 / SQL 被论文列为 future work）。
7. verbal reinforcement 指**用语言反馈、而非梯度更新来「强化」agent** 的范式——靠把自然语言教训读进上下文来改进，而不是 backprop。
8. 一个 trial = **生成（Actor 产出 trajectory）→ 评估（Evaluator 打 reward）→ 反思（Self-Reflection 产出反思文本并写入 memory）**，按此顺序，索引 t 递增。

### 原理层（对应 02）

1. 标量 reward 只说「你失败了（或成功了）」，**无法做 credit assignment**——无法定位是哪一步动作出了错、也无法说该怎么改。自然语言反思补上的正是这种**带定位、高维的纠错信息**：它能推断「action a_i 导致后续出错，应改成 a'_i」，这是标量甚至向量 reward 都表达不了的。
2. trial 之间唯一变化的是**上下文里的文本（episodic memory 里那段反思）**，权重始终冻结。所以这里的 **policy（策略）= agent 的记忆文本 + 选定的 LLM**；「学习」发生在 context window 里，策略就是记忆里那段文字，而非模型参数。
3. 下一个 trial 开始时，Actor 把 episodic memory 里的反思文本**拼进 prompt（in-context conditioning）**来影响生成——**不是**梯度回传，是把教训当作上下文读进去。
4. 不是都用 LLM 裁判：**推理（HotPotQA）**用 **exact-match 对 ground-truth 答案**；**决策（AlfWorld）**用**手写启发式**（如同一动作重复 >3 次、或动作数 >30 判失败）**或 LLM 二分类**；**编程（HumanEval）**用**自生成的单元测试**（≤6 条，AST 过滤掉语法无效的）。
5. 盲目把上次 trajectory 塞回去明显更弱——论文里 **blind refinement 52% < 不 refine 的 60%**；而「反思引导的 refinement」比「只给历史轨迹（episodic-memory-only）」再 **+8% 绝对值**。真正起作用的是**反思那一步做的 credit assignment**，不是把历史塞回去本身。
6. 分界轴是**「是否跨尝试学习」**：ReAct 是单条轨迹内交错 reason+act+observe，**不跨尝试**；Reflexion **跨 trial** 累积反思。Reflexion 把 **ReAct 当作 Actor**，在外面再套「评估 → 反思 → 重试」一层。
7. 反驳了「Reflexion 是弱模型救星」这种误解——它是给**已经很强的模型（GPT-4，80%）再加约 11 个点**（到 91%）。配合弱模型（starchat-beta）反思 = baseline 这一点：**自我纠错是更强模型的涌现能力**，不是给弱模型托底的。
8. 那是**被展示的程序内容 / 被引用的材料**（reflection 样本），不是作者在正文里说话。区分很重要：正文 prose 必须第三人称（主语是系统、读者或行为），第一人称只允许出现在 reflection 样本、被展示的输出、或读者动作邀请里——否则会把「程序产出的第一人称」误当成「作者口吻」。

### 判别层（综合 03+04+05）

1. **不该上（或风险很高）。**关键约束：**没有可靠的外部验证信号（测试 / 环境 reward / oracle）**，Reflexion 就会退化甚至变差——它依赖一个能判对错的 Evaluator。纯靠 LLM 凭感觉打分的开放创意任务缺这个判据，反思容易在错误方向上自我强化。
2. **更可能损害。**RA 阈值的结论是：反思只在**初始正确率 < 20–30%** 时净获益；用在本来就高置信的答案上反而有害（论文里 HotpotQA 80.3 → 76.2）。85% 远高于阈值，「再冲一冲」更可能把对的改错（correct→incorrect 翻转）。
3. **选 Self-Refine。**区分轴：**有无外部 reward、是否跨 trial、是否持久化记忆**。Self-Refine 是同一 session 内自评自改一个输出、**无外部 reward、不跨尝试、不持久化记忆**；需求正好如此。Reflexion 的额外机件（Evaluator 的外部 reward + 跨 trial 的 episodic memory）在这里用不上。
4. **根因在 Evaluator。**这是 **reward 源错了，不是反思错了**——自生成测试有 16.3% 假阳性（HumanEval 仅 1.4%），把错代码误判通过。假阳性比假阴性致命的原因是**非对称**：假阴性还能继续反思（可恢复），假阳性会**提前提交错误答案、循环就此终止（不可恢复）**。
5. **暴露了「任务契合度」边界。**根因偏向**探索宽度**不足：WebShop 需要大量探索 / 多样性，而 Reflexion 探索的是「时间」（跨 trial 纠错），不是「宽度」（一次尝试内铺开分支，那是 Tree of Thoughts 的强项）。靠跨时间纠错补不上探索宽度的缺口，所以追不上 ReAct。
6. **说明自我纠错是更强模型的涌现能力。**弱模型加反思 ≈ 不加（starchat-beta 0.26 = baseline 0.26）。**换强模型**比改循环更可能见效——循环结构没问题，是 Actor 本身还没具备「能读懂教训并据此改写」的能力。

**刚好够不着的挑战**

### 把这套题反过来出

挑判别层里你答得最有把握的一题，**改一个条件让答案翻转**：例如第 2 题把初始正确率从 85% 改到 15%，第 1 题把「无客观判据」改成「有现成单元测试」。写出新场景下的结论，并指出究竟是哪一个变量（有无可靠 Evaluator / 初始正确率 / 是否跨 trial）翻转了决策。能自己造出「临界翻转点」，才算真的把适用边界握在手里，而不只是记住了结论。

### Further reading

- Shinn et al. 2023, *Reflexion: Language Agents with Verbal Reinforcement Learning* — [arxiv.org/abs/2303.11366](https://arxiv.org/abs/2303.11366)（所有概念层 / 原理层题目的一手出处）
- Huang et al. 2024, *LLMs Cannot Self-Correct Reasoning Yet* — [arxiv.org/abs/2310.01798](https://arxiv.org/abs/2310.01798)（判别层「无 oracle 就崩」的依据）
- *When Hindsight is Not 20/20*（RA 阈值） — [arxiv.org/abs/2404.09129](https://arxiv.org/abs/2404.09129)（判别层第 2 题）
- Prompt Engineering Guide · Reflexion — [promptingguide.ai/techniques/reflexion](https://www.promptingguide.ai/techniques/reflexion)


---
