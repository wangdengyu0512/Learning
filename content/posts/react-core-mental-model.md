---
title: React 核心心智模型：从 UI=f(state) 到并发与服务端组件
description: 从声明式 UI、渲染与协调、状态快照、Hook 与副作用，到 React 19、Compiler、Server Components 和三层自测，建立一套能预测代码行为的 React 心智模型。
date: 2026-10-06
tags: React, 前端, JavaScript
featured: true
---

# React 核心心智模型：从 UI=f(state) 到并发与服务端组件

学习 React 最容易走偏的方式，是把它当成一组需要逐个记忆的 API。更有效的方式，是先建立一台统一的“解释机器”：**UI 是 state 的纯函数；状态变化触发重新计算；React 比较新旧描述，并把最小差异提交到宿主环境。**

本文由目录中的 7 份原始教程页面合并整理而成，保留了概念图、代码示例、预测题、章节自测和综合题。原始材料中的“前沿”内容以 **2026 年 6 月**为观察截点；正文重点是长期稳定的 React 心智模型，而不是某个框架版本的 API 清单。

## 全文导航

- [起点：读法、概念地图与学习路径](#start)
- [第 1 章：心智模型——UI 是 state 的纯函数](#chapter-01)
- [第 2 章：渲染机制——触发、渲染、提交](#chapter-02)
- [第 3 章：状态——快照、队列、不可变](#chapter-03)
- [第 4 章：副作用与 Hook](#chapter-04)
- [第 5 章：原理与前沿](#chapter-05)
- [第 6 章：三层自测题库](#chapter-06)

---

---

<a id="start"></a>

# React 核心心智模型

把 React 当成一台 **“状态 → UI”** 的纯函数机器来理解，而不是一堆要背的 API。建立这个心智模型，React 那些“反直觉”的行为会变成可预测的。

基于版本 React 19.2（含 React Compiler 1.0）

阅读时间约 4 小时 · 深度长文

读者定位会 JS、React 新手

代码验证基于 React 19 语义，未逐一本机运行

<a id="who"></a>

## · 这份教程为谁而写

### 适合谁

- 能写现代 JavaScript：箭头函数、解构、`map`/`filter`、`Promise`/`async`。能读懂闭包是加分项——第 3 章会把它重新讲一遍。
- 用过 HTML/CSS，知道 DOM 是什么，用 `document.querySelector` 改过页面节点。
- 写过或读过至少一个 React 组件，但说不清“为什么这里会重渲染两次”“为什么改了变量界面却没动”。

### 不适合谁

- 完全没碰过 JavaScript：先过一遍 [javascript.info](https://javascript.info/) 或 MDN 的 JS 教程，再回来。
- 想要 Next.js / 路由 / 状态管理库的工程实战：这是**心智模型**教程，工程栈是另一条线。先建模型，再上框架不会亏。
- 已经能预测 re-render 次数、闭包捕获哪一帧、effect 的执行时机：直接读 React 源码或 [overreacted.io](https://overreacted.io/)，这里的内容对你太浅。

<a id="can"></a>

## · 读完之后你能做到什么

读完，你能仅凭阅读一段 React 代码，就预测它会重渲染几次、某个闭包捕获的是哪一帧的 state、effect 会在哪个时刻以什么顺序执行——不靠打 log 试错。

这是一个 5 年经验工程师能讲清、而官方文档不会替你串起来的能力。具体到可验证的动作：

- 判断任意一次交互会触发哪些组件重渲染，并说清“重渲染”到底改了真实 DOM 的什么、没改什么。
- 解释 `setCount(count + 1)` 连写三次为什么只加 1，并写出能加 3 的正确版本。
- 看一眼依赖数组，就说出一个 effect 会在何时重新执行、它的清理函数何时运行。
- 对一个值，判断它该放进 state、放进 ref，还是在渲染时直接算出来。
- 判断一段逻辑该不该写成 effect——多数情况下不该。

**一句话本质**

React 的核心：**UI 是 state 的纯函数**。你不命令式地去改 DOM，而是声明“当前 state 下 UI 该长什么样”；React 把上一帧和这一帧 diff，最小化地更新真实 DOM。

两个支撑性的认知转折贯穿全篇：**state 是快照，不是活变量**（第 3 章）；**useEffect 是“与外部世界同步”，不是生命周期钩子**（第 4 章）。这三点一旦内化，几乎所有反直觉行为都会变得可预测。

**现状速览 · 截至 2026-06**

**稳定**：React 19.0（2024-12）确立了当前模型；并发特性 `useTransition` / `useDeferredValue` 已稳定。这份教程教的就是这套稳定核心。

**正在变**：**React Compiler 1.0 于 2025-10 正式 GA**——新代码基本不再手写 `useMemo` / `useCallback` / `React.memo`，编译器自动做记忆化；React 19.2（2025-10）加入 `<Activity>`、`useEffectEvent`。第 5 章会专门讲这对“何时手动优化”的影响。

**已被取代**：`forwardRef`、函数组件上的 `propTypes`/`defaultProps`、字符串 ref、旧 Context、class 生命周期框架——都已弃用或移除。Server Components 已走出 Next.js（React Router v7 起也支持）。本教程默认教函数组件 + Hook，不教 class。

**读之前 · 关于“流畅感”的警告**

这份教程会刻意在几处放慢、设置预测题和“刚好够不着”的挑战。原因是：读得顺 ≠ 学会了。读的时候若冒出这三句自我感觉，请警惕——它们往往是错觉：

“**我读得很顺**”——多半是熟悉感，不是掌握。换个场景就卡。
“**我做题很快**”——多半是题型眼熟，没真正调用到底层模型。
“**我没卡壳**”——多半是没碰到模型里真正硬的地方。卡壳是学习在发生，不是你笨。

对策只有一个：每章末的 self-check 先合上教程自己答，再展开对照。

<a id="map"></a>

## · 概念地图

下面这张图是整份教程的骨架。每个后续细节都会挂回它的某个节点。先扫一眼，不必现在理解每条边。

![React 核心概念地图：UI=f(state) 为中心，组件、Props、State、渲染、Hook、Effect 六个概念围绕它](/blog-assets/react-core-mental-model/00-01.svg)


图 0.1：React 核心概念地图。**注意三点**：① 中心的 `UI = f(state)` 是所有细节挂靠的唯一主轴；② Props 与 State 是这个 f 仅有的两类输入——一类只读、一类会变；③ Effect 用虚线连接，因为它在 f **之外**——它不是渲染的一部分，是逃生舱。

<a id="paths"></a>

## · 三条学习路径

按目的选一条，不必每条边都啃。

- **只想建立正确的心智模型**（最常见）
  01 → 02 → 03 → 04 ——可暂时跳过 05 的前沿段，先把核心打牢。
- **要做技术选型 / 对比 Vue·Svelte**
  01 → 02 → 05 ——重点在第 5 章的备选方案对比表与 signals（细粒度响应式）对比。
- **要能带读 / review 别人的 React 代码**
  01 → 03 → 04 → 06 ——直奔 state / effect / 闭包陷阱，再用第 6 章的判别题校准。

<a id="toc-nav"></a>

## · 目录

- [01 心智模型 · 声明式 vs 命令式、UI=f(state)、组件即纯函数、单向数据流](#chapter-01)
- [02 渲染机制 · 触发→渲染→提交三步、虚拟 DOM 与协调、key、re-render 到底是什么](#chapter-02)
- [03 状态 · state 是快照、归 React 所有、批处理、更新队列、不可变性](#chapter-03)
- [04 副作用与 Hook · Hook 规则的底层、useRef、useEffect=同步、依赖数组、你可能不需要 Effect](#chapter-04)
- [05 原理与前沿 · 设计权衡（备选方案表）、React 19 / Compiler / Server Components](#chapter-05)
- [06 自测 · 三层题库 + 跨章判别场景 + 亲手画图](#chapter-06)

<a id="next"></a>

## · 学完之后往哪走

- **状态管理库**（Zustand / Jotai / Redux）：看清它们在“state 归 React 持有”之上加了什么、解决了哪种跨组件共享。
- **React Compiler 深入**：自动记忆化的边界在哪、什么时候它帮不上忙、逃生舱怎么留。
- **Server Components**：把“组件是纯函数”延伸到服务端／客户端的边界划分。
- **并发特性**（`useTransition` / `Suspense`）：把“渲染可以被打断”从原理变成手里的工具。
- **性能调优**：从“理解 re-render”进到“测量并消除多余 re-render”。

### 总参考资料

- [react.dev · Learn](https://react.dev/learn)（官方教程，本教程的主线来源）
- [React 19 发布说明](https://react.dev/blog/2024/12/05/react-19)（官方，2024-12）与 [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1)（官方，2025-10）
- [Dan Abramov · React as a UI Runtime](https://overreacted.io/react-as-a-ui-runtime/)（维护者博客，机制级）
- [Dan Abramov · A Complete Guide to useEffect](https://overreacted.io/a-complete-guide-to-useeffect/)（effect 心智模型的权威长文）
- [react-fiber-architecture](https://github.com/acdlite/react-fiber-architecture)（Fiber 架构说明）

---

<a id="chapter-01"></a>

## 心智模型：UI 是 state 的纯函数

起点给了一张概念地图。这一章把地图正中心的 `UI = f(state)` 拆开：它到底在说什么，以及它如何把工程师从“手动同步 DOM”里解放出来。这是后面四章全部内容的地基。

**本章你将建立的 schema**

- 把“命令式地一步步改 DOM”换成“声明式地描述 UI 该长什么样”
- 把组件看成一个纯函数：输入 props 与 state，输出一段 UI 描述（JSX）
- 数据单向向下流，事件通过回调向上传——全程只有一个数据源

<a id="s11"></a>

### 1.1 从命令式到声明式

命令式：一步步告诉浏览器“怎么改”。声明式：只描述“当前状态下 UI 该是什么样”，怎么改交给 React。

**为什么需要它**

手动改 DOM 时，界面此刻的样子 = 初始 HTML ＋ 你写过的每一次修改的累积。状态一多，每条状态变化都要配一段 DOM 更新代码，还得保证它们彼此不打架。绝大多数 UI bug 是同一种：某个状态变了，但某处 DOM 忘了跟着改。

下面是同一个计数器的两种写法。先看命令式——注意有多少行在“手动同步 DOM”。

**代码：counter-imperative.js**

```js
let count = 0;
const label = document.getElementById("label");
const btn = document.getElementById("btn");

btn.addEventListener("click", () => {
  count = count + 1;
  label.textContent = "计数：" + count;   // 手动同步 DOM 第 1 处
  btn.disabled = count >= 5;              // 手动同步 DOM 第 2 处
  btn.textContent = count >= 5 ? "到上限" : "加一"; // 第 3 处……
});
```

每多一个“依赖 count 的界面元素”，就多一行手动同步。漏写任意一行，那块 DOM 就和 count 不一致。现在看声明式的 React 版本。

**代码：Counter.jsx**

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  // 只描述“count 是这个值时，UI 长什么样”
  return (
    <div>
      <p>计数：{count}</p>
      <button
        disabled={count >= 5}
        onClick={() => setCount(count + 1)}>
        {count >= 5 ? "到上限" : "加一"}
      </button>
    </div>
  );
}
```

#### 逐行解读（代码 → 概念）

useState(0)声明一个会变的输入 count，初始 0（第 3 章详解）。
return (…)这就是 f 的返回值：一份完整的 UI 描述，不是 DOM 操作。
disabled / 文本这些“依赖 count 的地方”不再各写一行同步代码，而是直接写成 count 的表达式。count 一变，整个描述重新算一遍，三处一起更新——不可能漏。

**底层机制 · 比文档深一层**

声明式不是“更高级的写法”，而是把“计算 DOM 差异”这件事从你手里转移给 React。你每次产出一份完整的目标描述，React 拿它和上一份描述做 diff，自己算出最小的 DOM 操作。**代价**：React 要在内存里保留描述并做对比（有开销，第 2 章讲它如何把开销压到最低）。**收益**：UI 不可能和 state 不同步——因为你根本不碰 DOM。

![命令式与声明式对比：命令式中你直接改 DOM，声明式中 React 介入并负责 diff](/blog-assets/react-core-mental-model/01-01.svg)


图 1.1：两种写法的差别，本质是“谁来算 DOM 差异”。**注意**：声明式把一个 `React` 节点插进了你和 DOM 之间——同步责任随之从你转移给它。你只负责描述，不再负责“怎么改”。

**想一想**

给命令式版本再加一个“在标题里也显示 count”的需求，要改几处？给声明式版本加同样的需求呢？

**展开答案（先停 10 秒）**

命令式：至少 +1 处手动同步（在 click 回调里再写一行更新标题），而且这处和已有三处都得记得在每次 count 变化时一起跑。声明式：在 return 的描述里多写一个 `{count}` 即可，同步由 React 负责，不存在“忘了更新标题”这种 bug。

这就是声明式的复利：界面越复杂，“手动保持同步”的成本差距越大。

<a id="s12"></a>

### 1.2 UI = f(state)：把组件看成函数

一个组件就是一个函数：输入 props 和 state，输出一段 UI 描述。界面此刻为何这样，只取决于此刻的 state。

**为什么需要它**

如果 UI 永远等于 `f(当前 state)`，那么“界面现在为什么长这样”就只需要看 state 一个地方——不必回放历史上发生过的所有点击和更新。调试从“追踪一连串操作”变成“检查一个值”。

**底层机制 · 比文档深一层**

React 真的把你的组件当函数**调用**。它返回的不是 DOM，是 React 元素（普通 JS 对象，见 §1.3）。state 一变，React 重新调用这个函数得到新描述，再 diff。所以“渲染”这个词，物理含义就是“React 调用了一次你的组件函数”。这也解释了为什么函数必须**纯**：React 要能随时调用它、跳过它、甚至调用了又把结果丢弃（并发渲染会这么干）——只有纯函数经得起这种反复调用。

**类比 · 带边界声明**

像 Excel 单元格公式 `=A1+B1`：你不手动更新结果，改了 A1，公式自动重算。**边界**：Excel 是细粒度的，只重算依赖那个单元格的公式；React 默认重新调用**整个**组件函数（第 2 章讲它如何做到“函数重跑、真实 DOM 却几乎不动”）。

![UI=f(state) 的循环：state 输入组件函数，输出 UI 描述并提交 DOM；用户交互触发 setState 产生新 state](/blog-assets/react-core-mental-model/01-02.svg)


图 1.2：这个循环就是 React 的全部。**注意**：UI 改变的**唯一**途径是顶部这条链重新跑一遍，而它重新跑的**唯一**触发是底部的 `setState` 产生了新 state。没有别的入口——这是“界面为何这样只看 state”的根据。

<a id="s13"></a>

### 1.3 组件与 JSX：返回值是描述，不是 DOM

JSX 不是 HTML，是 `React.createElement` 的语法糖，求值后得到一个描述 UI 的普通对象。

**为什么需要它**

JSX 让你用近似 HTML 的写法表达“UI 该长什么样”，同时保留 JavaScript 的全部能力——条件、循环、变量、函数组合都能直接用。它解决的痛点是：用纯 `createElement` 调用手写 UI 树极其啰嗦。

**代码：jsx-is-an-object.jsx**

```tsx
// 你写的 JSX
<button onClick={handleClick}>加一</button>

// 编译后（概念上）等价于一次函数调用
React.createElement("button", { onClick: handleClick }, "加一");

// 这次调用的返回值，是一个普通对象（一个 React 元素）
{
  type: "button",
  props: { onClick: handleClick, children: "加一" }
}
```

**底层机制 · 比文档深一层**

关键在最后那个对象：它是一份**描述**，不是真实 DOM 节点。创建它，没有发生任何 DOM 操作——它便宜得像写一个字面量对象。React 把组件返回的这些对象拼成一棵元素树，再拿它去和上一棵树 diff。这就解释了为什么 JSX 里不能塞 `document.appendChild(...)` 这类操作：你在搭一棵“描述树”，不是在直接指挥浏览器。

**类比 · 带边界声明**

React 元素像建筑图纸，真实 DOM 像盖好的楼。图纸便宜、可丢弃、能互相对比；楼昂贵、改动慢。**边界**：现实里图纸画一次就盖楼；React 每次渲染都重画一份图纸，再对比上一版，只把差异落到楼上。

**想一想**

执行 `const el = <h1>Hi</h1>;` 这一行之后，页面上出现 `<h1>` 了吗？

**展开答案（先停 10 秒）**

没有。`el` 此刻只是内存里的一个对象 `{ type: "h1", props: { children: "Hi" } }`。它要被 React 渲染进某个根节点（如 `createRoot(...).render(el)`）之后，才会变成真实 DOM。“写出 JSX”和“DOM 发生改变”是两件被刻意分开的事——这正是声明式的前提。

<a id="s14"></a>

### 1.4 单向数据流

数据有单一来源（state 住在某个组件里），通过 props 向下流。子组件要改父的数据，只能调用父传下来的回调。

**为什么需要它**

单一数据源 + 单向流动，让“谁能改这个数据”始终可追踪。若允许任意一端双向改写同一份数据，调试时就得四处找“到底是谁动了它”。React 用单向流把这个问题从根上消掉。

**底层机制 · 比文档深一层**

props 是只读的函数参数。子组件改 props **不会**触发任何重渲染——React 根本不监听 props 对象。数据“向下流”，物理上就是“父函数把值作为参数调用子函数”。事件“向上传”，物理上是“子组件调用了父亲传下来的那个回调函数”，回调体里 `setState`，于是父组件重渲染、把新 props 再次作为参数传下来。所谓数据流，全程只是函数调用与参数传递。

![单向数据流：App 持有 state，props 实线向下传给 Display 和 Button，事件虚线从 Button 绕行回到 App](/blog-assets/react-core-mental-model/01-03.svg)


图 1.3：props 实线向下，事件虚线向上绕行。**注意**：Button 永远不能直接改 App 的 count——它只能调用 App 传下来的 `onClick` 回调，由 App 自己 `setCount`。数据所有权始终留在 App，没有第二个人能写它。

把本章四个概念串起来：`App` 持有 count（§1.2 的 state），把 count 和一个回调作为 props 向下传（§1.4）。点击 Button 时回调被调用，回调里 setCount 产生新 state，于是 App 这个函数（§1.2 的 f）被重新调用，返回新的 JSX 描述（§1.3），React diff 后只更新真实 DOM 里变了的部分（§1.1 的声明式）。四个概念是同一个循环的四个侧面。

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再展开对照——直接点开等于把这一节当成又读了一遍。

1. 用一句话说明：“声明式”把原本属于你的哪一项工作，转移给了 React？
2. `<h1>Hi</h1>` 求值后得到的是 DOM 节点还是普通对象？这件事对“渲染”这个词的含义意味着什么？
3. （设计题）为什么 React 要求组件是纯函数？如果允许组件在渲染过程中直接修改外部变量，React 的哪一项能力会失效？
4. 图 1.3 里，Button 想让计数加一，为什么不能在自己内部直接做、必须调用 App 传来的回调？

**答案（先做完再展开）**

1. 把“计算并执行 DOM 差异更新”这项工作转移给了 React。你只产出目标描述，怎么把 DOM 改成那样由 React 负责。
2. 得到的是普通 JS 对象（React 元素），不是 DOM 节点。这说明“渲染”分两步：先调用组件函数得到描述（廉价、随时可重做），再由 React 把描述落到真实 DOM。写 JSX ≠ 改 DOM。
3. 因为 React 需要能随时调用、跳过、或调用后丢弃组件函数（并发渲染、StrictMode 双调用都依赖这点）。若组件在渲染时改外部变量，这些反复调用就会产生重复或错乱的副作用，React 就不再能安全地“多调用几次”——并发能力和可预测性都会失效。
4. 因为 count 的所有权在 App，props 是只读的。Button 改自己收到的 props 不会触发任何重渲染（React 不监听 props）。唯一能改 count 的是它的拥有者 App，所以 Button 只能请求 App 去改——即调用回调。

**进阶挑战 · 刚好够不着**

#### 子组件能直接 push 到收到的数组 prop 吗？

一个父组件持有 `todos`（数组 state），把它作为 prop 传给子组件 `<AddTodo todos={todos} />`。子组件里有个输入框，提交时想把新条目加进去。它能不能直接 `todos.push(newItem)`？界面会更新吗？正确的数据流应该长什么样？

**提示（卡住再展开）**

两个独立的问题。其一：`push` 改的是数组内容，但 props 是只读契约，更关键的是——即便改了，谁来触发重渲染？回顾图 1.2：，重渲染的唯一触发是 setState。其二：正确做法是父组件把一个回调（如 `onAdd`）传下去，子组件调用 `onAdd(newItem)`，由父组件用 `setTodos([...todos, newItem])` 产生一个**新数组**。为什么必须是新数组而不是 push 原数组，留到第 3 章的不可变性揭晓。

#### 本章参考

- [react.dev · Thinking in React](https://react.dev/learn/thinking-in-react)（官方）
- [react.dev · Describing the UI](https://react.dev/learn/describing-the-ui)（官方）
- [react.dev · Keeping Components Pure](https://react.dev/learn/keeping-components-pure)（官方，纯函数要求）
- [Dan Abramov · React as a UI Runtime](https://overreacted.io/react-as-a-ui-runtime/)（维护者博客，元素即描述）

---

<a id="chapter-02"></a>

## 渲染机制：触发、渲染、提交

上一章把 UI 看成 state 的纯函数 `f`。这一章追问：当 state 变了，React 究竟做了什么才让真实 DOM 跟上——以及为什么“重渲染”远没有名字听起来那么贵。

**本章你将建立的 schema**

- 一次更新分三步：触发（trigger）→ 渲染（render，调用组件）→ 提交（commit，改 DOM）
- 协调（reconciliation）：React 如何 diff 两棵元素树，为什么是 O(n) 而不是 O(n³)
- key 的真正职责：声明列表项的“身份”，决定状态在重排时跟谁走

<a id="s21"></a>

### 2.1 渲染的三步：触发 → 渲染 → 提交

一次更新分三步：触发（state 变了）、渲染（React 调用你的组件得到新描述）、提交（React 把差异改到真实 DOM）。

**为什么需要它**

“渲染”这个词被严重滥用，把“调用组件函数”和“改 DOM”混为一谈，于是新手以为每次渲染都在重写页面、因此很慢。把它拆成三步，你才能准确说出某次交互发生了什么、哪一步碰了 DOM、哪一步没碰。

**底层机制 · 比文档深一层**

**触发**：只有两种来源——首次渲染（`createRoot(...).render()`），或某个组件 `setState`。
**渲染（render 阶段）**：React 调用组件函数，递归调用子组件，得到一棵新的元素树（§1.3 的描述）。这一步是**纯计算，不碰 DOM**，因此可以被打断、丢弃、重做——并发渲染正是建立在这一点上。
**提交（commit 阶段）**：React 把新旧树的 diff 结果应用到真实 DOM。这一步**同步、不可打断、确实改 DOM**。提交完，浏览器才重新绘制（paint）。

**最关键的一处误解**

“重渲染”默认指 render 阶段——重新调用函数算出新描述——**不等于**“重写 DOM”。大量重渲染在 commit 阶段几乎不动 DOM，因为 diff 后没有差异。把“组件被重新调用”和“真实 DOM 被改”分开，是读懂 React 性能的第一步。

![渲染三步流程：触发到渲染到提交再到浏览器绘制，渲染阶段不碰DOM，提交阶段才改DOM](/blog-assets/react-core-mental-model/02-01.svg)


图 2.1：一次更新的三步。**注意**：只有第 ③ 步 commit 碰真实 DOM；第 ② 步 render 只是重新调用你的函数、算出一份新描述，可以被丢弃重来。把“慢”归咎于“重渲染”之前，先分清它卡在哪一步。

**想一想**

父组件 `setState` 重渲染时，一个 props 完全没变的子组件，会不会被重新调用？真实 DOM 会变吗？

**展开答案（先停 10 秒）**

默认情况下，子组件**会**被重新调用（render 阶段）——React 默认在父组件重渲染时递归重渲染所有子组件，不预先检查 props 变没变。但因为它返回的描述和上一次相同，diff 后没有差异，commit 阶段**不动**那部分真实 DOM。“被重新调用”≠“DOM 被改”。如何让没变的子组件连函数都跳过（手动 `memo` 或 React Compiler 自动处理），是第 5 章的话题。

<a id="s22"></a>

### 2.2 协调：怎么 diff 两棵树

协调（reconciliation）是 React 对比新旧两棵元素树、算出最小 DOM 操作的过程。

**为什么需要它**

通用的“最小编辑距离”树 diff 是 O(n³)，对动辄上千节点的 UI 完全不可用。React 用两条启发式假设，把它压到 O(n)——代价是这两条假设偶尔会“误判”，而理解这两条假设，正是预测 React 何时保留、何时丢弃组件状态的钥匙。

**底层机制 · 两条假设**

**假设一：不同类型的元素，产出不同的树。**同一位置上 `<div>` 变成了 `<span>`，React 不去 diff 内部，直接销毁整棵旧子树（连同其中所有组件的 state）、重建新子树。
**假设二：同一位置、同一类型的元素，是“同一个”。**React 复用那个真实 DOM 节点，只更新变化的属性，再递归 diff 它的子节点。
关键词是**“位置”**：React 靠“元素在树中的位置 + 类型”来判断“这是不是上次那个组件”。位置和类型都没变 → 复用并保留 state；类型变了，或位置变了 → 重建并丢掉 state。

![协调：对比旧树和新树，同位置同类型则复用更新，类型不同则销毁重建](/blog-assets/react-core-mental-model/02-02.svg)


图 2.2：协调按“位置 + 类型”逐点对比。**注意**：那个 `input` 因为位置和类型都没变而被复用，它内部未提交的输入内容会原样保留下来。这正是下一节 key、以及第 3 章“状态保留与重置”的根：状态是绑在“树中位置”上的，不是绑在数据上的。

<a id="s23"></a>

### 2.3 key：列表项的身份证

key 告诉 React“列表里这一项是谁”，让它在增删、重排时把每项的 DOM 和 state 跟对人。

**为什么需要它**

列表项没有天然的“位置稳定性”：插入、删除、排序会让“第 i 个”指向不同的数据。上一节说过，React 默认按位置匹配——对会变动的列表，这恰好是错的。key 给每项一个稳定身份，让匹配从“按位置”切换到“按身份”。

**代码：list-key.jsx**

```tsx
// ❌ 用数组下标当 key：列表一重排，state 就跟错行
{todos.map((todo, i) => (
  <TodoRow key={i} todo={todo} />
))}

// ✅ 用数据自带的稳定 id 当 key：state 永远跟着数据走
{todos.map((todo) => (
  <TodoRow key={todo.id} todo={todo} />
))}
```

**底层机制 · 比文档深一层**

有了稳定 key，React 改用 key 而非位置来匹配新旧项：key 相同 → 判定为同一项，复用其 DOM/state 并移动到新位置；key 消失 → 删除该项；出现新 key → 新建。用下标 `i` 当 key，等于又退回“按位置匹配”——重排时数据的位置变了、下标也跟着变，于是 key 和位置一起漂移，匹配错乱。**下标当 key 不是性能问题，是正确性问题**：它会让一项的 DOM 内部状态（如未提交的输入文字）串到另一项上。

![用下标当key的失败：删除中间的Bob后，React按位置复用，导致Cay继承了Bob输入框里的草稿](/blog-assets/react-core-mental-model/02-03.svg)


图 2.3：用下标当 key 删除中间项的后果。**注意**：React 以为“位置 1 还是位置 1”，于是把 Bob 的旧 DOM 节点（连同输入框里的草稿 X）复用给了 Cay。改用 `key={todo.id}`，React 会发现 Bob 这个 key 消失了，删掉 Bob 的节点，Ann 与 Cay 各自的状态原样不动。

<a id="s24"></a>

### 2.4 把三步与协调串起来

一次点击“删除 Bob”发生了什么，用本章三个概念走一遍：① **触发**——删除按钮的回调 `setTodos` 产生了新数组（§1.4 的事件向上 + 即将在第 3 章讲的新数组）。② **渲染**——React 重新调用列表组件（§1.2 的 f），得到一棵少了 Bob 的新元素树。③ **协调 + 提交**——React 按 key 把新旧两棵树匹配：稳定 key 下它精准删除 Bob 的节点，commit 阶段只对真实 DOM 做一次删除操作。整页其余部分的真实 DOM 一动不动——这就是“重渲染整个列表”却依然便宜的原因。

### § 本章 self-check

先合上教程，把答案写下来，再展开对照。

1. 把“渲染”拆成三步，分别说出哪一步碰真实 DOM、哪一步不碰。
2. “组件被重新渲染”和“它对应的真实 DOM 被修改”是同一件事吗？用一句话说清两者的关系。
3. React 的协调为什么能做到 O(n)？它靠的两条假设各是什么？
4. （设计题）一个带输入框的列表，用数组下标当 key，删除中间一项后，某个输入框的草稿“串”到了别的行。从“按位置匹配”出发解释为什么，并说出正确做法。

**答案（先做完再展开）**

1. 触发（state 变或首次，不碰 DOM）→ 渲染（调用组件算新树，纯计算，不碰 DOM）→ 提交（把 diff 应用到 DOM，碰 DOM）。只有提交碰真实 DOM。
2. 不是同一件事。重渲染 = 重新调用组件函数得到新描述；只有当新描述与旧描述 diff 出差异时，提交阶段才会改对应的真实 DOM。重渲染可以完全不改 DOM。
3. 靠两条启发式假设把通用 O(n³) 树 diff 降到 O(n)：① 类型不同则整棵子树重建，不深入比较；② 同位置同类型则复用、只更新变化属性并递归。列表再用 key 提示稳定身份。
4. 下标当 key 等于让 React 继续“按位置匹配”：删除中间项后，后面的数据全部前移一个位置，但下标 key 不变，于是 React 认为“位置 i 还是同一项”，把旧 DOM 节点（含未提交的输入草稿）复用给了新数据。正确做法是用数据自带的稳定 id 当 key，让匹配按身份而非位置进行。

**进阶挑战 · 刚好够不着**

#### 条件渲染会不会重置输入框？

有两段条件渲染：
写法 A：`{isEditing ? <input /> : <input disabled />}`
写法 B：`{isEditing ? <input /> : <p>...</p>}`，并在另一处单独再放一个 `<input />`。
切换 `isEditing` 时，哪种写法会让用户在 input 里打的字消失？用 §2.2 的“位置 + 类型”规则推理。

**提示（卡住再展开）**

问自己：切换前后，那个 input 在树中的“位置 + 类型”变了没有？写法 A 切换前后都是“同一位置上的 input”——类型没变，React 复用同一个 DOM，文字保留。写法 B 里，input 与 p 在同一位置上互相替换——类型从 input 变成 p（或反之），触发假设一：销毁重建，文字丢失。要刻意保留或刻意重置状态，关键就是控制元素在树中的位置与类型，或用 key 强制区分。第 3 章会把这条规则用到底。

#### 本章参考

- [react.dev · Render and Commit](https://react.dev/learn/render-and-commit)（官方，三步模型）
- [react.dev · Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state)（官方，位置决定状态）
- [react.dev · Rendering Lists（key）](https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key)（官方）
- [React · Reconciliation](https://legacy.reactjs.org/docs/reconciliation.html)（设计文档，两条启发式假设的出处）

---

<a id="chapter-03"></a>

## 状态：快照、队列、不可变

第 2 章说状态绑在“树中位置”上。这一章钻进 state 本身：它存在哪、为什么 `set` 之后立刻读还是旧值、为什么连写三次 `+1` 只加了 1。这是整份教程最反直觉、也最值钱的一章。

**本章你将建立的 schema**

- state 是**快照**：每次渲染捕获那一帧的值，函数里的 const 不是活变量
- 真正的 state 归 React 持有（存在 fiber 上），跨渲染保留
- 批处理 + 更新队列：何时用函数式更新；不可变性与 `Object.is`

<a id="s31"></a>

### 3.1 state 是快照，不是活变量

`useState` 返回的 const 只是“这一帧的快照”。真正的 state 存在 React 内部，跨渲染保留；这一帧里它的值固定不变。

**为什么需要它**

新手把 `const [count] = useState(0)` 里的 count 当普通变量，于是困惑两件事：“明明 `setCount` 了，为什么下一行 count 还是旧的”“为什么 `setTimeout` 里读到的是点击时的值，不是最新值”。这两个困惑同一个根源——count 是快照。

**底层机制 · 比文档深一层**

组件函数**每次渲染都整个重新执行**，里面的 `const count` 每次都是新建的局部常量。`useState` 做的事是：从 React 为这个组件保存的“记忆槽”里取出当前值，赋给这一帧的 count。`setCount` 不修改这一帧的 count（它是 const，也改不了），而是通知 React“把记忆槽更新成新值，并安排一次重渲染”。下次渲染函数重跑，`useState` 又从记忆槽取出新值。所以——**count 是某一帧的快照，React 的记忆槽才是真 state**。

![state存在React记忆槽里跨渲染保留，每次渲染函数从槽里取出一个快照赋给本帧的const](/blog-assets/react-core-mental-model/03-01.svg)


图 3.1：真正的 state 在 React 的记忆槽里跨渲染保留；你函数里的 `const count` 只是这一帧从槽里取出的**快照**。**注意**：`setCount` 改的是上面那个槽、并安排下一帧——它无法、也不会改动当前这一帧里已经定下的 count。

“快照”最直接的后果：在一次渲染产生的所有闭包里——事件回调、`setTimeout`、effect——读到的 count 都是**这一帧那个固定的值**。这不是 React 的魔法，就是 JavaScript 闭包：函数捕获它定义时所在作用域里的变量。

**代码：snapshot-timeout.jsx**

```tsx
function handleClick() {
  setCount(count + 1);          // 安排：下一帧 count 变 1
  setTimeout(() => {
    alert(count);               // 弹出 0 —— 捕获的是“点击那一刻”的快照
  }, 3000);                     // 3 秒后即使已经渲染过很多次，这里仍是 0
}
```

<a id="s32"></a>

### 3.2 批处理与更新队列

React 把一个事件里的多次 `setState` 攒成一批、只渲染一次。要基于“上一次更新后的值”累加，必须用函数式更新 `setCount(c => c + 1)`。

**为什么需要它**

承接上一节的快照，一个经典谜题：下面连写三次 `+1`，结果只加到 1，不是 3。理解它，就同时理解了批处理和“为什么要函数式更新”。

**代码：three-plus-one.jsx**

```tsx
function handleClick() {
  setCount(count + 1);   // 本帧 count = 0 → 入队“把 state 设为 1”
  setCount(count + 1);   // 本帧 count 仍 = 0 → 入队“把 state 设为 1”
  setCount(count + 1);   // 本帧 count 仍 = 0 → 入队“把 state 设为 1”
}                        // 三条都是“设为 1”，最终 count = 1
```

**底层机制 · 比文档深一层**

**批处理**：一个事件处理函数里的多次 `setState` 不会各触发一次渲染，而是攒进一个队列，事件跑完后 React 统一处理、只渲染一次。
**队列里放什么，决定结果**：放“值”——`setCount(count+1)` 入队的是“把 state 设为 1”，后一条覆盖前一条，三次只剩 1。放“函数”——`setCount(c => c+1)` 入队的是“拿上一个结果加 1”，React 依次把上一步结果喂进去：0→1→2→3，真的加了 3。

![值式更新三次只得1，函数式更新三次得3的队列对比](/blog-assets/react-core-mental-model/03-02.svg)


图 3.2：同样写三次，结果差在“队列里放值还是放函数”。**注意**：值式入队的是一个写死的目标值（都基于本帧的旧快照 0），互相覆盖；函数式入队的是“在上一个结果上 +1”的算法，React 依次折叠，才真正累加。需要连续累加时用函数式。

<a id="s33"></a>

### 3.3 不可变性：为什么必须给一个新对象

改 state 必须产生一个新对象/新数组，而不是原地修改旧的。React 用 `Object.is` 比较新旧引用，来决定要不要重渲染。

**为什么需要它**

这正是第 1 章那个挑战的答案：子组件（或任何人）`push` 进数组再 `setState`，界面却纹丝不动。问题不在 push 改了内容，而在——React 怎么知道“变了”？

**代码：immutability.jsx**

```tsx
// ❌ 原地修改：todos 还是同一个数组引用
todos.push(newTodo);
setTodos(todos);            // 新引用 === 旧引用 → React 判定“没变” → 不重渲染

// ✅ 产生新数组：新引用
setTodos([...todos, newTodo]);   // 新引用 ≠ 旧引用 → 触发重渲染
```

**底层机制 · 比文档深一层**

`setState` 决定要不要重渲染，靠的是 `Object.is(旧值, 新值)` 浅比较**引用**。原地 `push` 改的是数组内部，引用没变，于是 `setTodos(todos)` 传进去的新旧引用相同，React 判定“没变”而跳过渲染（这叫 bailout）。**代价**：你得养成不可变更新的习惯（展开运算符、`map`/`filter`，或 Immer 库）。**收益**：引用相等 = 一次廉价的变化检测，它也是第 5 章 `memo` 化和并发渲染能成立的基础——整套优化都建立在“引用没变就一定没变”这个约定上。

![原地修改导致引用相同被Object.is判定没变而跳过渲染，新引用则触发渲染](/blog-assets/react-core-mental-model/03-03.svg)


图 3.3：是否触发渲染，取决于 `Object.is` 比较新旧**引用**。**注意**：原地 `push` 后引用没变，React 判定“没变”而跳过——这就是“明明改了数组，界面却没动”的真因，不是 bug，是约定。

<a id="s34"></a>

### 3.4 把第 1 章的挑战补完

现在可以完整回答第 1 章末尾那个“子组件能不能 push 数组 prop”的挑战了，串起前三章：子组件通过调用父传下来的回调（§1.4 事件向上）请求添加；父组件用 `setTodos([...todos, item])` 产生**新数组**（§3.3 不可变，新引用才触发渲染）；新引用让 React 决定重渲染，父组件这个函数 `f` 重跑（§1.2），新的 `todos` 快照（§3.1）作为 props 流给子组件（§1.4）；协调阶段按 key 精准更新真实 DOM（§2.3）。每一步都不是孤立的 API，而是同一个数据循环的环节。

### § 本章 self-check

先合上教程，把答案写下来，再展开对照。第 3 题务必自己先在纸上推一遍队列。

1. `const [count] = useState(0)` 里的 count，和“真正的 state”是同一个东西吗？分别存在哪里？
2. 点击时执行 `setCount(count + 1)` 后紧接着 `console.log(count)`，打印的是新值还是旧值？为什么？
3. 本帧 count = 0，依次执行 `setCount(count + 1)`、`setCount(c => c + 1)`、`setCount(count + 1)`，最终 count 是多少？逐条推队列。
4. （设计题）为什么 React 要求不可变更新、而不是直接监听对象内部变化？这个约定为第 5 章的哪类优化打下了基础？

**答案（先做完再展开）**

1. 不是同一个。函数里的 count 是这一帧从记忆槽取出的快照（局部常量，渲染结束即废）；真正的 state 在 React 为该组件保存的记忆槽（fiber）上，跨渲染保留。
2. 旧值。count 是本帧快照，在这一帧里固定不变；`setCount` 安排的是下一帧的值，不会改动当前帧的 count。
3. 最终是 1。队列：①“设为 1”（基于本帧 0）→ ②“在上一个结果 1 上 +1 = 2” → ③“设为 1”（又基于本帧快照 0，把队列结果覆盖为 1）。最后一条值式覆盖掉了前面的累加，结果 1。
4. 因为监听任意对象的深层变化代价高且不可靠；改用“引用变了才算变了”的约定，把变化检测降成一次 `Object.is` 引用比较——廉价且确定。正是这个约定让 `memo` 化（靠引用相等跳过重渲染）和并发渲染（可安全复用未变的子树）成为可能。

**进阶挑战 · 刚好够不着**

#### 值式与函数式混用，结果是多少？

本帧 `count = 3`。一个事件里依次执行：
`setCount(count + 5);`
`setCount(c => c + 1);`
`setCount(10);`
`setCount(c => c + 2);`
渲染后 count 是多少？把队列一步步折叠出来。

**提示（卡住再展开）**

队列从空开始，依次应用，函数式拿“队列当前结果”、值式直接覆盖：① `count+5` = 3+5 = 8（值，队列结果 8）；② `c=>c+1` = 8+1 = 9；③ `10` 直接覆盖 = 10；④ `c=>c+2` = 10+2 = 12。最终 count = 12。关键：值式只看本帧快照（count=3），函数式只看队列里上一步的结果。

#### 本章参考

- [react.dev · State as a Snapshot](https://react.dev/learn/state-as-a-snapshot)（官方，快照模型）
- [react.dev · Queueing a Series of State Updates](https://react.dev/learn/queueing-a-series-of-state-updates)（官方，更新队列）
- [react.dev · Updating Objects / Arrays in State](https://react.dev/learn/updating-objects-in-state)（官方，不可变更新）
- [Dan Abramov · A Complete Guide to useEffect](https://overreacted.io/a-complete-guide-to-useeffect/)（每次渲染都有自己的一切，快照心智的权威长文）

---

<a id="chapter-04"></a>

## 副作用与 Hook

第 3 章把 state 钉成了“快照”。这一章处理两件事：Hook 凭什么能在“每次重跑的函数”里记住东西（答案藏在调用顺序里），以及 `useEffect` 到底是什么——它不是生命周期钩子，而是“与外部世界同步”的声明。

**本章你将建立的 schema**

- Hook 规则的底层原因：React 靠“第几次调用”认领记忆槽，所以顺序不能变
- `useRef`：跨渲染保留、但改了不触发渲染的逃生舱
- `useEffect` 是同步机制：依赖数组声明“读了哪些值”，cleanup 在重新同步前先跑
- 多数“看似需要 effect”的逻辑其实不需要——能算就算，事件归事件

<a id="s41"></a>

### 4.1 Hook 的规则与它的底层原因

Hook 必须在组件顶层、按固定顺序、无条件调用——因为 React 靠“这是第几次调用”来认领每个 Hook 的记忆槽。

**为什么需要它**

第 3 章留了个问题：组件函数每次渲染都整个重跑，里面的局部变量每次重建，那 `useState` 凭什么能记住上一次的值？答案解释了一条看似武断的规则——为什么不能把 Hook 放进 `if`、循环或嵌套函数里。

**底层机制 · 比文档深一层**

React **不靠变量名**记住 Hook，靠**调用顺序**。每个组件的 fiber 上挂着一个 Hook 列表。首次渲染时，第 1 次 `useState` 认领槽 0、第 2 次认领槽 1、`useEffect` 认领槽 2……之后**每次**渲染都必须以相同顺序、相同数量调用，React 才能把这次的第 N 个 Hook 对到上次的第 N 个槽。把 `useState` 放进 `if`，某次渲染少调一个，后面所有 Hook 的槽集体错位——这才是 Rules of Hooks 的真正原因，不是代码风格。

![渲染时Hook按调用顺序认领fiber上的记忆槽0、1、2](/blog-assets/react-core-mental-model/04-01.svg)


图 4.1：Hook 靠“第几次调用”对应 fiber 上的槽，不靠名字。**注意**：正因如此，每次渲染必须按相同顺序、相同数量调用 Hook。把任何 Hook 放进条件或循环，都会让后续 Hook 的槽错位——这是规则的全部来由。

**代码：rules-of-hooks.jsx**

```tsx
// ❌ Hook 放进条件：某次渲染少调一个，后面的槽全部错位
if (isLoggedIn) {
  const [name, setName] = useState("");
}

// ✅ Hook 永远在组件顶层、无条件调用；把条件放进 Hook 之后
const [name, setName] = useState("");
if (isLoggedIn) {
  // 用 name
}
```

<a id="s42"></a>

### 4.2 useRef：不触发渲染的记忆

`useRef` 给你一个跨渲染保留、但修改时**不触发渲染**的盒子（`ref.current`）。

**为什么需要它**

有些值需要在渲染之间记住——定时器 id、某个 DOM 节点、上一次的值——但它们不该驱动 UI。放进 state 会引发多余渲染甚至死循环；放进普通局部变量又会每次渲染被重置（第 3 章）。`useRef` 正好填这个缝。

**底层机制 · 比文档深一层**

ref 也是 fiber 上的一个槽，和 state 一样跨渲染保留——唯一的区别是：改 `ref.current` **不通知 React 重渲染**。它是第 3 章“快照”规则的逃生舱：当你想读“此刻最新的值”而不是“这一帧的快照”时，把它存进 ref。**代价**：正因为它不触发渲染，把“该显示在界面上的值”放进 ref，界面不会更新——这是新手第二常见的错误（第一是滥用 effect）。

**表 4.1 · state 与 ref 的分工**

|  | 跨渲染保留 | 修改触发渲染 | 该装什么 |
| --- | --- | --- | --- |
| state | 是 | 是 | 影响 UI 的值（计数、输入、开关） |
| ref | 是 | 否 | 不影响 UI 的值（定时器 id、DOM 节点、上次的值） |

**代码：useRef-timer.jsx**

```tsx
const timerRef = useRef(null);   // 跨渲染保留；改它不触发渲染

function start() {
  timerRef.current = setInterval(tick, 1000);  // 记住 id，但不该让界面重渲染
}
function stop() {
  clearInterval(timerRef.current);
}
```

<a id="s43"></a>

### 4.3 useEffect 是“同步”，不是生命周期

effect 描述“如何让某个外部系统与当前 props/state 保持一致”。React 在每次相关渲染提交后运行它来完成同步。

**为什么需要它**

把 effect 当成 “组件挂载时/更新时触发的回调”（即旧的 `componentDidMount`/`componentDidUpdate` 框架）的人，会写出一连串 bug：忘了 cleanup、依赖配错、effect 之间互相级联。换一个心智模型，这些 bug 从源头消失。

**底层机制 · 比文档深一层**

effect 不是“在某个时刻触发的回调”。正确心智：**每次渲染都有它自己的一份 effect**，闭包捕获那一帧的 props/state（第 3 章的快照）。提交并绘制后，React 比较这次和上次的依赖数组——若依赖变了，**先运行上一份 effect 的 cleanup，再运行这一份 effect**。组件卸载时运行最后一次 cleanup。所以一个 effect 表达的是：“对于当前这一帧的值，外部系统应当处于什么状态。”
依赖数组不是“何时重跑的开关”，而是“这个 effect 读了哪些响应式值”的**声明**——React 据此判断值变没变、需不需要重新同步。漏写依赖 = 撒谎，effect 会读到过期的快照。

**代码：effect-sync.jsx**

```tsx
useEffect(() => {
  const conn = createConnection(roomId);
  conn.connect();
  return () => conn.disconnect();   // cleanup：重新同步前 / 卸载时，先断开旧连接
}, [roomId]);                       // 依赖：声明这个 effect 读了 roomId
```

![effect同步时间线：roomId从A变B时先cleanup断开A再连接B，卸载时断开B](/blog-assets/react-core-mental-model/04-02.svg)


图 4.2：effect 表达“对当前 `roomId`，连接应处于什么状态”。**注意**：从 A 切到 B 时，React 先跑旧 effect 的 cleanup（断开 A），再跑新 effect（连接 B）。cleanup 不是“卸载时才跑”——每次重新同步前都先跑，这正是订阅类逻辑不泄漏的关键。

<a id="s44"></a>

### 4.4 你可能不需要 Effect

能在渲染中算出来的值，不要塞进 state＋effect；由用户操作触发的逻辑，放事件处理函数，不放 effect。

**为什么需要它**

effect 最大的滥用是拿它做“数据派生”和“级联状态”——用一个 effect 监听 A 去 set B，再用另一个 effect 监听 B 去 set C。这制造多余渲染、画面闪烁和难查的 bug。多数时候，effect 根本不该出现。

**代码：no-effect-needed.jsx**

```tsx
// ❌ 用 state + effect 同步一个派生值：多一次渲染，还可能闪烁
const [fullName, setFullName] = useState("");
useEffect(() => {
  setFullName(first + " " + last);
}, [first, last]);

// ✅ 能从现有 state 算出来的，渲染时直接算
const fullName = first + " " + last;
```

**判据 · 这段逻辑该放哪**

问一个问题：这段逻辑是**因为某个值变了、需要与外部系统同步**才跑，还是**因为用户做了某个具体操作**才跑？
— 能从现有 props/state 算出的值（全名、过滤后的列表）：渲染时直接算，别进 state。
— 用户点击/提交引发的事（发请求、弹提示）：放进那个事件处理函数。
— 只有“因为组件渲染出来了、要把外部系统（订阅、网络连接、非 React 的 DOM）拉到与当前状态一致”时，才用 effect。

![决策树：一段逻辑能算就渲染中算，用户触发放事件处理函数，需同步外部才用effect，否则多半不需要effect](/blog-assets/react-core-mental-model/04-03.svg)


图 4.3：“这段逻辑放哪”的判别路径。**注意**：effect 是这棵树最靠后的出口，不是第一选择。大多数逻辑在前两个分叉就该被拦下——能算的算掉，用户触发的归事件。第 6 章的判别题会反复用到这条路径。

**想一想**

“用户提交搜索表单后，发一个网络请求”——这该写进 `useEffect` 吗？

**展开答案（先停 10 秒）**

不该。它是“用户提交”这个具体操作触发的，属于决策树的第二个分叉——放进表单的 `onSubmit` 事件处理函数。只有当“请求该发”是由某个响应式值变化（如 URL 里的查询参数变了，要把结果与之同步）驱动时，才考虑 effect。把事件逻辑塞进 effect，会让“到底什么触发了请求”变得不可追踪。

<a id="s45"></a>

### 4.5 把四章串起来

一个聊天室组件的完整数据循环，调用了前四章的全部概念：组件是 props 的纯函数（§1.2），`roomId` 作为 prop 单向流入（§1.4）；它在渲染中直接算出标题文本而不用 effect（§4.4）；`useState` 与 `useEffect` 各自按调用顺序认领 fiber 槽（§4.1）；连接逻辑写成 effect，依赖 `[roomId]`，闭包捕获当前帧的 roomId 快照（§3.1），roomId 变时先 cleanup 旧连接再建新连接（§4.3）；切换房间触发重渲染时，React 按 key 复用 DOM、协调出最小改动（§2.3）。没有一个概念是孤立的——它们是同一个循环在不同位置的名字。

### § 本章 self-check

先合上教程，把答案写下来，再展开对照。

1. React 凭什么在“每次重跑的函数”里把这次的 `useState` 对到上次的同一个值？这条机制如何推出“不能把 Hook 放进 if”？
2. 一个值要跨渲染保留，但改它时不该触发重渲染——用 state 还是 ref？反过来，一个要显示在界面上的值放进了 ref，会出什么问题？
3. `useEffect(fn, [roomId])` 里的 cleanup 函数在哪两个时刻运行？
4. （设计题）为什么把“依赖数组”理解成“何时重跑的开关”是错的？正确的理解是什么，漏写一个依赖会导致什么具体后果？

**答案（先做完再展开）**

1. 靠调用顺序：fiber 上的 Hook 列表按“第几次调用”索引，第 N 个 Hook 永远对第 N 个槽。把 Hook 放进 if，某次渲染少调一个，之后所有 Hook 的序号前移一位、对错槽，状态全乱——所以必须每次按相同顺序、相同数量调用。
2. 用 ref：跨渲染保留且改它不触发渲染。反过来，把该显示的值放进 ref，改了它界面不会更新（ref 不触发渲染），用户看到的是旧画面——这类“数据变了 UI 不动”的 bug 就是误用 ref 装了 UI 状态。
3. 两个时刻：① 下一次该 effect 因依赖变化重新运行**之前**（先清理旧的再建新的）；② 组件卸载时（最后一次清理）。
4. 因为 effect 不是“在某时刻被触发的回调”，而是“对当前这一帧的值，外部系统该是什么状态”的声明；依赖数组是“这个 effect 读了哪些响应式值”的清单，React 用它判断要不要重新同步。漏写依赖等于谎报“没读这个值”，于是值变了 effect 不重跑，effect 内部继续用过期的快照——典型表现是连接连到旧房间、回调读到旧 state。

**进阶挑战 · 刚好够不着**

#### 计数器为什么停在 1？

下面这个 effect 想每秒把 count 加 1，但 count 永远停在 1：

**代码：stale-interval.jsx**

```tsx
useEffect(() => {
  const id = setInterval(() => {
    setCount(count + 1);   // 永远是 0 + 1
  }, 1000);
  return () => clearInterval(id);
}, []);   // 空依赖
```

用第 3 章的“快照”和本章的“依赖数组”解释为什么停在 1，并给出两种修法。

**提示（卡住再展开）**

空依赖 `[]` 意味着 effect 只在挂载时运行一次，那次运行的闭包永远捕获首帧的 `count = 0`（快照）。于是 interval 里每秒都执行 `setCount(0 + 1)`，永远把 state 设成 1。
修法一：函数式更新——`setCount(c => c + 1)`，不读快照里的 count，改读队列里的上一个结果（§3.2），空依赖也正确。
修法二：把 `count` 写进依赖数组 `[count]`，让每次 count 变化都重建 interval、捕获新快照——但这会频繁重建定时器，通常不如修法一。这正是“依赖数组是‘读了哪些值’的声明”的实战意义。

#### 本章参考

- [react.dev · Synchronizing with Effects](https://react.dev/learn/synchronizing-with-effects)（官方，同步心智）
- [react.dev · You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)（官方，何时不该用 effect）
- [react.dev · Referencing Values with Refs](https://react.dev/learn/referencing-values-with-refs)（官方，ref）
- [Dan Abramov · Why Do Hooks Rely on Call Order](https://overreacted.io/why-do-react-hooks-rely-on-call-order/)（维护者博客，调用顺序的根据）

---

<a id="chapter-05"></a>

## 原理与前沿：为什么这样设计，又往哪走

前四章把“怎么用”讲透了。这一章先回答“为什么是这样设计”——用三张备选方案表呈现 React 放弃了什么；再讲它正在往哪走：React 19、编译器、服务端组件。前者锁住理解，后者给出截至 2026 年的真实地形。

**本章你将建立的 schema**

- 三个核心设计的取舍：虚拟 DOM vs 信号（signals）、Hook vs class、不可变 vs 可变
- React 的分层架构：Reconciler 与 Renderer 分离意味着什么
- 前沿现状（带日期）：React 19、React Compiler、Server Components 各自改变了什么

<a id="s51"></a>

### 5.1 架构：Reconciler 与 Renderer 分离

前四章讲的全部——重跑组件、协调、状态、effect——发生在 React 的**协调层（Reconciler）**。它和把结果落到具体平台的**渲染层（Renderer）**是分开的：同一套协调逻辑，`react-dom` 落到浏览器 DOM，`react-native` 落到原生视图。

![React 分层架构：你的组件、元素树、Reconciler/Fiber、Renderer、宿主平台 DOM 自上而下](/blog-assets/react-core-mental-model/05-01.svg)


图 5.1：React 的分层。**注意**：Reconciler（Fiber）与 Renderer 是分开的——这就是同一份组件代码能渲染到 DOM 也能渲染到原生的原因。也正因为 Reconciler“可中断”，并发渲染（边算边可放弃）才得以实现。

<a id="s52"></a>

### 5.2 为什么用虚拟 DOM，而不是信号

React 选择“state 变就重跑整个组件、diff 虚拟树、最小提交”，换取一个显式、可预测的心智模型。

**设计的代价（诚实地说）**

这个选择的代价正是第 2 章那个默认：父组件重渲染会重跑整棵子树，其中一部分是“算了新描述、diff 后发现没变”的无用功。Solid、Svelte、Vue 走的“信号 / 细粒度响应式”路线没有这笔开销——但要在读值处建立依赖追踪，心智更隐式。React 用第 5.5 节的编译器来抵消这笔代价，而不是改变模型。

**表 5.1 · UI 更新机制的三条路线**

| 方案 | 优势 | 为什么 React 没选它 |
| --- | --- | --- |
| 命令式直接操作 DOM | 无抽象开销，改哪动哪 | 要手动保持 DOM 与状态同步，规模一大就失控（第 1 章的痛点） |
| 信号 / 细粒度响应式（Solid、Svelte、Vue 3） | 精确追踪依赖，只更新真正变的节点，无需 diff 整棵树 | 需在读值处建立依赖追踪（编译或包装），心智更隐式；React 偏向“重跑函数”的显式模型 |
| 虚拟 DOM + 协调 | 心智简单：state 变就重跑组件、声明式、无需手动追踪依赖 | 选中 |

<a id="s53"></a>

### 5.3 为什么是 Hook，而不是 class

函数组件 + Hook 让逻辑按“关注点”聚合、可抽成自定义 Hook 复用，代价是接受第 4 章那条“调用顺序”规则。

**表 5.2 · 组件与逻辑复用的演进**

| 方案 | 优势 | 为什么被取代 |
| --- | --- | --- |
| class 组件 + 生命周期 | 有实例 `this` 存状态，曾是标准 | `this` 绑定易错；同一关注点被切到 `didMount`/`didUpdate`/`willUnmount` 三处；复用靠 HOC / render props，嵌套层层叠加 |
| Mixins（更早） | 能复用逻辑 | 命名冲突、隐式依赖，早已废弃 |
| 函数组件 + Hook | 逻辑按关注点聚合、抽成自定义 Hook 复用、没有 `this` | 选中 |

![class把订阅关注点切到三个生命周期方法，Hook把它聚合进一个useEffect](/blog-assets/react-core-mental-model/05-02.svg)


图 5.2：同一个“订阅”关注点（朱红字）在两种模型里的分布。**注意**：class 按“生命周期时刻”组织代码，于是一个关注点被迫散在三个方法里；Hook 按“关注点”组织，订阅连同它的清理收进同一个 effect——这就是 Hook 真正解决的问题，不是少打几个字。

<a id="s54"></a>

### 5.4 为什么坚持不可变

**表 5.3 · 变化检测的三种做法**

| 方案 | 优势 | 为什么 React 没选它 |
| --- | --- | --- |
| 可变 + 脏检查（Angular 1 风格） | 直接改对象，写法自然 | 要遍历比对找出哪变了，性能随规模下降；变化时机不明确 |
| 可变 + 手动通知（observable / KVO） | 精确，改谁通知谁 | 样板多、容易漏发通知，错漏难查 |
| 不可变 + 引用比较 | `Object.is` 一次比较就知道变没变；并发下可安全复用旧子树 | 选中 |

代价在第 3 章已经领教：更新嵌套结构要层层展开，啰嗦，于是有 Immer 这类库帮忙。收益是整套优化的地基——下一节的编译器，正是建立在“引用没变就一定没变”这个约定上。

<a id="s55"></a>

### 5.5 前沿一：React 19 与编译器（截至 2026-06）

React 19（2024-12 稳定）把异步与资源读取纳入核心；React Compiler 1.0（2025-10 GA）让“手动记忆化”基本退场。

#### React 19：少写样板

React 19 于 **2024-12** 稳定，几个改变心智的点：**Actions** 配合 `useActionState` / `useFormStatus` / `useOptimistic`，把表单提交的 pending、错误、乐观更新做成内建；**`use()`** 可在渲染中读取 Promise（配合 Suspense）或 Context；**`ref` 成了普通 prop**，`forwardRef` 不再需要。

**代码：ref-as-prop.jsx**

```tsx
// React 18 及以前：转发 ref 必须包一层 forwardRef
const Input = forwardRef((props, ref) => <input ref={ref} {...props} />);

// React 19：ref 就是一个普通 prop（forwardRef 已弃用）
function Input({ ref, ...props }) {
  return <input ref={ref} {...props} />;
}
```

#### React Compiler：手动记忆化退场

**React Compiler 1.0** 于 **2025-10 GA**。它在编译期分析组件，自动插入等价于 `useMemo` / `useCallback` / `React.memo` 的缓存，跳过未变部分的重渲染——甚至能在 early-return 之后做记忆化，超出手写能力。结果：**新代码基本不再手写这三个 API**，它们留作逃生舱。

**代码：compiler-memo.jsx**

```tsx
// 手动记忆化时代：到处包 useMemo / useCallback
const filtered = useMemo(() => items.filter(fn), [items]);
const onClick   = useCallback(() => doThing(id), [id]);

// React Compiler（2025-10 GA）：写朴素代码，编译器自动插入等价缓存
const filtered = items.filter(fn);
const onClick   = () => doThing(id);
```

**这不改变你刚学的模型**

编译器优化的是“跳过没必要的重算”，**不改变** state → UI 的语义。第 2 章“父重渲染默认重渲染子组件”仍是心智基准；编译器只是把那笔“无用功”自动消除。理解 re-render（前四章）依旧必要——否则你看不懂编译器在替你做什么，也判断不了它什么时候帮不上忙。配套的 lint 已并入 `eslint-plugin-react-hooks` v6（独立的 `eslint-plugin-react-compiler` 不再单独安装）。

<a id="s56"></a>

### 5.6 前沿二：Server Components（截至 2026-06）

组件默认在服务端运行（可直读数据、不进浏览器 bundle）；用 `"use client"` 标记需要交互的组件，它们才下发到浏览器。

**把第 1 章延伸到服务端**

“组件是 props 的纯函数”在这里结出果实：纯的、无 state 的展示组件天然适合在服务端运行——它只是把数据映射成描述。带 state / effect / 事件的组件（前四章的交互核心）才需要客户端。`"use client"` 就是这条边界的声明。前四章的全部心智，在客户端边界之内原样成立。

**代码：server-client-boundary.jsx**

```tsx
// 默认在服务端运行：可直接读数据，不进浏览器 bundle
async function ProductPage({ id }) {
  const product = await db.products.get(id);   // 服务端直读
  return <ProductView product={product} />;
}

// 需要交互的组件：用 "use client" 标记，下发到浏览器
"use client";
function AddToCart({ id }) {
  const [count, setCount] = useState(1);       // state 只能在客户端
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

![服务端组件直读数据不进bundle，use client边界之后是带state的客户端组件，服务端渲染输出流向客户端](/blog-assets/react-core-mental-model/05-03.svg)


图 5.3：服务端 / 客户端边界。**注意**：边界由 `"use client"` 划定——之上放“纯、无 state”的组件（第 1 章那种 f），之下才放 state / effect / 事件。截至 2026-06，RSC 已从 Next.js 扩散到 React Router v7 等框架；2025-12 曾有一则 RSC 安全公告，生产环境记得 pin 并更新版本。

<a id="s57"></a>

### 5.7 跨概念综合：把取舍用起来

一个具体抉择，串起本章与前四章：一个“商品详情 + 加入购物车”的页面，该怎么切分？商品信息的读取与展示——纯函数、无 state（§1.2）——放服务端组件，省下 bundle 与一次客户端请求（§5.6）；“加入购物车”的按钮带 count state 与点击事件（§3、§1.4），必须 `"use client"`。是否要手动 `memo` 购物车列表？在开了 React Compiler 的项目里不必（§5.5），但你仍要能判断“这次重渲染是否真的多余”——而这个判断，靠的正是第 2 章的 render/commit 区分。新工具没有让旧心智过时，是让它更省力。

### § 本章 self-check

先合上教程，把答案写下来，再展开对照。

1. 用一句话说出 React 选“虚拟 DOM + 协调”而非“信号”所换来的东西，以及为此付出的代价。
2. Hook 相对 class 真正解决的问题是什么？它要求你接受哪条规则作为交换？
3. React Compiler（2025-10 GA）让哪三个 API 基本不必再手写？它改变了 state → UI 的语义吗？
4. （设计题）一个“显示文章正文 + 底部点赞按钮”的页面，用 RSC 该如何切分服务端 / 客户端？依据是什么？

**答案（先做完再展开）**

1. 换来的是显式、可预测的心智（state 变就重跑组件、无需手动追踪依赖）；代价是默认重跑整棵子树、可能产生 diff 后无变化的“无用功”render。
2. 真正解决的是“逻辑复用与关注点聚合”：把散在多个生命周期方法里的同一关注点收进一个 effect，并可抽成自定义 Hook 复用。交换条件是接受“Hook 必须按固定顺序、无条件调用”的规则（§4.1）。
3. `useMemo` / `useCallback` / `React.memo`。不改变语义——它只自动跳过没必要的重算，state → UI 的关系不变，所以前四章的心智依然成立。
4. 正文是纯展示、无 state，放服务端组件（直读数据、不进 bundle）；点赞按钮带本地 state 与点击事件，标 `"use client"` 放客户端。依据是“有没有 state / effect / 事件”——有交互才需要客户端。

**进阶挑战 · 刚好够不着**

#### 开了编译器，还需要理解 re-render 吗？

团队给项目开启了 React Compiler，有人说“以后不用关心重渲染了”。给出一个具体场景，说明即使有编译器，不理解前四章仍会写出 bug 或查不出问题。

**提示（卡住再展开）**

编译器消除的是“多余的重算”，不消除“语义错误”。例如：用下标当 key 导致状态串行（§2.3）——这是正确性 bug，编译器不碰；effect 漏写依赖读到过期快照（§4.3）——编译器不替你补语义；把该显示的值放进 ref 导致界面不更新（§4.2）——编译器无能为力。编译器优化的前提是你的代码语义本就正确；判断“这次重渲染是不是真的多余、是不是有副作用泄漏”，仍然要靠前四章的模型。工具加速正确的代码，不修复错误的心智。

#### 本章参考

- [React 19 发布说明](https://react.dev/blog/2024/12/05/react-19)（官方，2024-12-05）
- [React Compiler 1.0](https://react.dev/blog/2025/10/07/react-compiler-1)（官方，2025-10-07）
- [react.dev · Server Components](https://react.dev/reference/rsc/server-components)（官方，RSC 参考）
- [react-fiber-architecture](https://github.com/acdlite/react-fiber-architecture)（设计文档，Reconciler/Renderer 分离）

---

<a id="chapter-06"></a>

## 自测：三层题库

前五章建立了完整的心智模型。这一章用三层题检验它真的进了脑子，而不只是“读得很顺”。重点是最后的判别层——它逼你在跨章的新场景里做选择，这才是迁移。

**怎么用这一章**

- 三层梯度：概念层（回忆）→ 原理层（分析机制）→ 应用判别层（跨章场景）
- 所有答案集中在文末一个折叠块里。每题先自己写，再展开——“瞄一眼答案”会把检验变成又一次再读
- 判别层答不出，回对应章节重读；那才是模型没扎实的地方

![认知梯度金字塔：底层概念回忆，中层原理分析，顶层应用判别迁移](/blog-assets/react-core-mental-model/06-01.svg)


图 6.1：三层不是简单的“难度递增”，是**认知层级**递增：从“能复述”到“能讲机制”再到“能在新场景里判别选型”。**注意**：只有顶层判别题能检验迁移——前两层答得顺，恰恰是该警惕“流畅感错觉”的时候。

<a id="concept"></a>

### A 概念层（对应 01–02）

1. “声明式”把原本属于你的哪一项工作转移给了 React？（[§1.1](#s11)）
2. `const el = <h1>Hi</h1>` 求值后，`el` 是什么？页面上出现 `<h1>` 了吗？（[§1.3](#s13)）
3. props 为什么是只读的？子组件想改变父组件的数据，唯一的合法途径是什么？（[§1.4](#s14)）
4. “一个组件被重渲染”和“它对应的真实 DOM 被修改”是同一件事吗？（[§2.1](#s21)）

<a id="principle"></a>

### B 原理层（对应 02–05）

5. 协调把通用 O(n³) 树 diff 降到 O(n)，靠的两条启发式假设各是什么？（[§2.2](#s22)）
6. 本帧 count = 0，连写三次 `setCount(count + 1)`，结果为什么只到 1？（[§3.2](#s32)）
7. `arr.push(x)` 之后 `setArr(arr)`，界面为什么纹丝不动？React 用什么判断“变没变”？（[§3.3](#s33)）
8. 为什么 Hook 不能写在 `if` 或循环里？用“调用顺序认领槽”来解释。（[§4.1](#s41)）
9. `useEffect(fn, [dep])` 的 cleanup 函数在哪两个时刻运行？（[§4.3](#s43)）
10. React Compiler（2025-10 GA）让哪三个 API 基本不必再手写？它改变 state → UI 的语义吗？（[§5.5](#s55)）

<a id="discriminate"></a>

### C 应用判别层 · 跨章场景

每道题都横跨至少两章。先判断“涉及哪几章的哪个概念”，再给方案。这是整份教程真正要检验的能力。

![五道判别场景各自横跨两章的映射矩阵](/blog-assets/react-core-mental-model/06-02.svg)


图 6.2：五道判别场景与章节的对应。**注意**：每道题都落在两列上——现实问题从不按章节边界出现。若某道题你只想到一章，多半漏看了另一半；答案里会点出缺的那半。

1. **S1 · 列表串状态**：一个可拖拽排序的待办列表，每行带一个未提交的输入框。用数组下标当 `key`，拖动排序后，某行输入框里的草稿“串”到了别的行。这是什么问题？涉及哪两章的哪个概念？正确做法？
2. **S2 · 定时器不动**：一个 `useEffect`（空依赖）里开 `setInterval` 想每秒给 count 加 1，count 却停在 1。从“快照”和“依赖数组”两个角度解释，并给出两种修法及取舍。
3. **S3 · 选型权衡**：要做一个每秒更新几十次的实时仪表盘，团队在 React 与 Solid（signals）之间犹豫。从“重跑 + diff 的代价”出发，说出 React 的潜在劣势、以及 React 19 时代用什么抵消它。
4. **S4 · ref 还是 state**：需求是“记住用户上一次悬停的卡片 id，用于下次交互判断，但这个 id 不直接显示在界面上”。该用 state 还是 ref？如果改成“要把这个 id 显示出来”，结论怎么变？
5. **S5 · RSC 切分**：一个“文章正文 + 底部点赞按钮 + 评论输入框”的页面，用 Server Components 该如何划分服务端 / 客户端？划分依据是哪一章的什么概念？

**亲手画一张图**

合上教程，在纸上画出 [§1.2](#s12) 的 `UI = f(state)` 循环——只画 4 个节点：`state` → 组件 `f` → `UI → DOM` → `setState`，再连回 `state`。
画完回到图 1.2 对照三件事：① `setState` 的箭头有没有指回 `state`？② 有没有漏掉“用户交互”这条触发入口？③ 你能不能在这张图上，指出第 3 章的“快照”发生在哪个节点、第 4 章的 effect 挂在哪一步之后？画得出来，这份心智模型才算真的是你的。

### § 全部答案（先做完再展开）

答案集中在这里。判别层尤其要先写出自己的版本——这一层的价值全在“自己先做选择”。

**展开全部答案**

#### 概念层

1. 把“计算并执行 DOM 的差异更新”转移给了 React。你只产出目标描述，怎么把 DOM 改成那样由 React 负责。
2. `el` 是一个普通 JS 对象（React 元素，形如 `{ type: "h1", props: { children: "Hi" } }`），页面上**没有**出现 `<h1>`。它要被 React 渲染进根节点才会变成真实 DOM——写 JSX ≠ 改 DOM。
3. 因为数据所有权在拥有它的组件，props 是传下来的只读参数；子组件改 props 不会触发任何重渲染。唯一合法途径：调用父组件传下来的回调，由父组件 `setState`。
4. 不是。重渲染 = 重新调用组件函数得到新描述；只有当新旧描述 diff 出差异时，提交阶段才改对应的真实 DOM。重渲染可以完全不改 DOM。

#### 原理层

5. ① 类型不同则整棵子树销毁重建，不深入比较；② 同位置同类型则复用同一 DOM、只更新变化属性并递归子节点。列表再用 key 提示稳定身份。
6. 因为 count 是本帧快照、恒为 0，三次都是 `setCount(0 + 1)`，入队的都是“把 state 设为 1”，后者覆盖前者。要累加需用函数式更新 `setCount(c => c + 1)`。
7. 因为 `push` 改的是数组内部，引用没变；`setArr` 拿到的新旧引用相同，React 用 `Object.is` 判定“没变”而跳过渲染（bailout）。要给新引用：`setArr([...arr, x])`。
8. 因为 React 靠“第几次调用”把 Hook 对应到 fiber 上的第几个槽。放进 `if`，某次渲染少调一个，之后所有 Hook 的序号前移、对错槽，状态全乱。所以必须每次按相同顺序、相同数量调用。
9. ① 下一次该 effect 因依赖变化重新运行**之前**（先清理旧的）；② 组件卸载时（最后一次清理）。
10. `useMemo` / `useCallback` / `React.memo`。不改变语义——它只自动跳过没必要的重算，state → UI 的关系不变。

#### 应用判别层

1. **S1**（涉及 [§2.3 key](#s23) + [§3 状态绑位置](#s31)）：下标当 key 让 React 按位置匹配，排序后位置变、下标也变，于是旧 DOM 节点（含未提交输入草稿）被复用给了新数据。正确做法：用每行数据自带的稳定 id 当 `key`，让匹配按身份而非位置进行。只想到“key 要稳定”而没意识到“输入草稿是绑在 DOM 节点位置上的状态”，就漏了第 2/3 章那一半。
2. **S2**（涉及 [§3.1 快照](#s31) + [§4.3 依赖](#s43)）：空依赖让 effect 只在挂载时跑一次，那次闭包永远捕获首帧 `count = 0`，于是每秒都 `setCount(0 + 1)`。修法一：函数式 `setCount(c => c + 1)`，不读快照、读队列上一个结果，空依赖也对。修法二：把 `count` 写进依赖，每次变化重建 interval、捕获新快照——但会频繁重建定时器，通常不如修法一。
3. **S3**（涉及 [§2.1 render 代价](#s21) + [§5.2 备选](#s52)）：React 默认重跑组件 + diff，高频更新下可能做较多“算了又 diff”的工作，这是 signals（精确更新、无需 diff 整棵树）的相对优势所在。React 19 时代的抵消手段：React Compiler 自动记忆化跳过未变子树，加上把高频区域拆细、用 ref / 非受控减少 state 驱动的重渲染。只比较“谁快”而不谈“React 用什么抵消代价”，就只答了一半。
4. **S4**（涉及 [§4.2 ref](#s42) + [§3 state](#s31)）：不显示、只用于下次交互判断 → 用 `ref`（跨渲染保留且改它不触发重渲染，避免多余渲染）。一旦要把这个 id 显示出来，就必须改用 `state`——ref 改了不触发渲染，界面不会更新。判据就是“它影不影响 UI”。
5. **S5**（涉及 [§1.2 纯函数](#s12) + [§5.6 RSC](#s56)）：正文是纯展示、无 state，放服务端组件（直读数据、不进 bundle）；点赞按钮带本地 state + 点击事件、评论输入框是受控输入，二者都需 `"use client"` 放客户端。划分依据：“有没有 state / effect / 事件”，即第 1 章“纯函数 vs 有交互”的延伸。

#### 下一步学习

- [react.dev · Learn](https://react.dev/learn)——把本教程的心智模型对照官方全量教程再走一遍
- [react.dev · API Reference](https://react.dev/reference/react)——逐个 Hook 的精确语义
- [overreacted.io](https://overreacted.io/)——Dan Abramov 的机制级长文，深挖快照与 effect
- 状态管理（Zustand / Jotai）、React Compiler 深入、Server Components 实战——见 [起点页“学完之后”](#next)
