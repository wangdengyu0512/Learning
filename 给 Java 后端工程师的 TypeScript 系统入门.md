# 给 Java / 后端工程师的 TypeScript 系统入门

> **定位**：面向已有 Java 或其他静态类型语言经验、但尚未系统学习 JavaScript / TypeScript 的后端工程师。
> **内容基线**：TypeScript 6.0（2026-03）
> **预计阅读时间**：约 2 小时
> **文档生成日期**：2026-10-06

这不是一份 API 速查表，而是一篇围绕心智模型组织的系统教程。全文用一条主线串起所有概念：**TypeScript 的类型只存在于编译期，按结构匹配，并在运行时被擦除。**

## 目录

- [起点：先建立整套心智模型](#start)
- [第 1 章：核心概念——类型系统的零件](#chapter-01)
  - [1.1 两个世界：编译期类型 vs 运行时值](#s11)
  - [1.2 基础类型](#s12)
  - [1.3 类型注解与类型推断](#s13)
  - [1.4 对象类型：interface 与 type](#s14)
  - [1.5 联合类型与字面量类型](#s15)
  - [1.6 函数类型与 this](#s16)
  - [1.7 泛型](#s17)
  - [1.8 收窄 narrowing](#s18)
- [第 2 章：工作原理与设计取舍](#chapter-02)
  - [2.1 结构化类型：按形状，不按名字](#s21)
  - [2.2 类型擦除与编译模型](#s22)
  - [2.3 「不健全」是故意的，以及 enum 这个例外](#s23)
  - [2.4 strict 配置：一个元开关](#s24)
  - [2.5 综合示例：一次 API 取数据](#s25)
- [第 3 章：自测与辨析](#chapter-03)
  - [概念层](#t1)
  - [原理层](#t2)
  - [应用判别层](#t3)
  - [答案](#answers)

---
<a id="start"></a>

## 起点：先建立整套心智模型

基于 TypeScript 6.0（2026-03）· 概念为主 · 约 2 小时 · 代码为说明性片段，行为已对照 TS 语义核对（标 ✗ 处是**故意**演示的编译/运行错误，非笔误）。本教程不是 API 速查，而是帮你装上一套关于「类型在 TS 里到底是什么」的心智模型。

<a id="fit"></a>

## 适合谁

这份教程为**已有静态类型语言经验、但没系统写过 JS/TS 的工程师**写。三条前置能力：

- 能读写 Java（或 C# / Kotlin / Go 等）后端代码，理解类、接口、泛型、异常这些概念。
- 知道「静态类型」「编译期检查」是什么，用过 IDE 的类型提示与重构。
- 没有系统写过 JavaScript——对它的运行时（`null`/`undefined`、真值判断、`this`、原型、异步）不熟悉，甚至有点怕。

第三条很关键：TypeScript 是 JavaScript 的**超集**，TS 的一半难点其实是底下那层 JS 运行时。整份教程会反复用「TS 类型 vs Java 类型」做对照，把你已有的 Java 直觉，一条条校准到 TS 上——哪些能照搬，哪些会害你。

<a id="unfit"></a>

## 不适合谁

- **完全的编程新手**（没写过任何带类型的语言）——本教程默认你已经懂类型、泛型、接口。先学一门基础语言更划算。
- **已熟练写 JS/TS、想钻类型体操的人**——条件类型、映射类型、模板字面量类型的深水区不在这里。去看 [type-challenges](https://github.com/type-challenges/type-challenges) 和《Effective TypeScript》。
- **只想查某个 API 怎么写**——直接看 [官方 Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) 更快。

<a id="outcomes"></a>

## 读完之后你能做到什么

这份教程想给你的，是一个有五年经验的工程师都未必从官方文档里直接读到的东西：

> **把 TS 的类型系统看成一层「编译期、按结构匹配、运行时被擦除」的图纸——一旦装上这个模型，`as` 为何不做检查、为何要用 zod 校验外部数据、`enum` 为何特殊、泛型在运行时为何是空的，都不再需要死记，而是同一条原理的推论。**

具体地，读完你能：

- 给一段无类型的 JS 加上正确的类型注解，并说清哪些该手写、哪些该交给类型推断。
- 判断两个类型能不能互相赋值——用**结构**规则推，而不是看它们叫什么名字。
- 在 `interface` / `type`、`any` / `unknown`、`enum` / 字面量联合之间，按场景选对。
- 说出一段 TS 编译成 JS 后「运行时还剩什么」，并据此判断 `instanceof`、反射这类操作能不能用。
- 配置 `strict` 模式，并讲清它打开了哪些检查、各自防住哪种错误。

> **🧭 一句话本质 · 整篇教程的核心**
>
> TypeScript 的类型是一层**只存在于编译期、按「结构形状」匹配**的图纸；代码真正跑起来之前它会被**完全擦除**——「类型世界」和运行时的「值世界」是两个分开的世界。
>
> 对 Java 开发者，这一条最反直觉：你习惯了「类型按名字/继承认定 + 运行时有反射」，TS 两条都反过来。下文所有看起来奇怪的设计，都从这一条推得出来。

<a id="fluency"></a>
> **⚠️ 读之前 · 警惕「流畅幻觉」**
>
> 这份教程读起来会很顺，因为概念都拆小了。但「读着顺」不等于「学会了」。认知科学（Bjork）把这叫**流畅幻觉**——当下表现好，不代表记得住、用得上。出现下面三种感觉冒出来时，请停下来做自测：
>
> · **「我读得很顺」**——那是熟悉感，不是掌握。熟悉的字面 ≠ 能自己推导。
> · **「我做题很快」**——多半碰上的是套路题型，换个壳就卡。
> · **「我没卡壳」**——多半是还没碰到真正的难点（结构化、擦除）。
>
> 每章末尾的 self-check 和第 3 章的判别题，是用来戳破这层幻觉的。**先合上教程作答，再展开对照**——直接看答案等于把题目当正文又读了一遍。

<a id="map"></a>

## 概念地图

下面这张图是整份教程挂载细节的骨架。第 1 章讲左右两框里的零件，第 2 章讲中间那条「擦除边界」为什么存在、代价是什么。

![TypeScript 的两个世界：编译期类型世界与运行时值世界，以 tsc 编译为擦除边界](typescript-blog-assets/figure-01.svg)

> 图 0 TypeScript 的两个世界，以 `tsc` 编译为边界。**注意**三件事：① 所有类型构造都只在左框；② 左框在编译后整体消失，运行时只剩右框的 JS；③ `enum` 是少数会「漏」到右侧、编译成真实 JS 对象的类型语法——记住这个例外，第 2 章会专门讲它为什么特殊。
<a id="paths"></a>

## 学习路径建议

顶部那条 00 — 01 — 02 — 03 面包屑就是主线，每章开头都会重画并高亮当前位置。按目标可以走不同路线：

- **只想理解类型系统在干什么**：第 1 章（概念）→ 第 2 章前半（结构化 + 擦除两节）。约 1 小时。
- **要在团队里做选型 / code review**（比如定 `interface` 还是 `type`、要不要用 `enum`）：第 1 章 §1.4–§1.5 + 第 2 章全章 + 第 3 章判别题。
- **要能读懂别人写的 TS 代码**：第 1 章全章（重点 §1.8 收窄）→ 第 2 章 §2.2 擦除 → 第 3 章。

<a id="toc"></a>

## 目录

- [**01 核心概念**](#chapter-01)——类型系统的零件：两个世界、基础类型、注解与推断、对象类型、联合与字面量、函数、泛型、收窄。
- [**02 工作原理与设计取舍**](#chapter-02)——结构化类型、类型擦除与编译模型、「不健全」是故意的、`strict` 配置。
- [**03 自测与辨析**](#chapter-03)——三层梯度题库 + 跨章判别场景 + 默画概念图。
<a id="next"></a>

## 学完之后

这份教程止步于「语言基础」。装上这套模型后，下一步按你的方向选：

- **类型进阶**——条件类型、映射类型、`infer`、工具类型源码。在「按结构匹配」之上加「类型层面的编程」。
- **运行时校验**——[zod](https://zod.dev/) / valibot。把「擦除」这一课补上：外部数据进系统时如何重建类型保证。
- **工程化**——`tsconfig` 深配置、monorepo、`tsx`/打包器、声明文件 `.d.ts` 编写。把单文件的类型知识扩展到真实项目。
- **框架方向**——Node 后端（Express/Nest）、React 前端、或 AI Agent SDK。它们都是 TS-first，结构化 + 泛型在这里大量出现。

### 参考资料

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)（官方文档，权威）
- [TypeScript Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html)（官方，各版本新特性）
- [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals)（官方设计目标 / 非目标）
- [Effective TypeScript](https://effectivetypescript.com/)（Dan Vanderkam，进阶必读博客 + 书）
- [TS Playground](https://www.typescriptlang.org/play)（边读边试，能看到编译后的 JS）

---

<a id="chapter-01"></a>

## 第 1 章：核心概念——类型系统的零件

导览页给了一张「两个世界」的概念地图——编译期的类型世界、运行时的值世界。这一章逐个拆解左框里的零件：每个零件先给定义和它解决的问题，再用「对照 Java」校准你的直觉，标出能照搬的和会害你的地方。

> **🧭 本章你将建立的 schema**
>
> - 「类型只在编译期、运行时被擦除」这条主线，能套到每一个后续概念上
> - 把「类型」理解成「值的集合」——assignability 就是子集关系
> - 哪些 Java 直觉能照搬（泛型、接口的用途），哪些会翻车（一个 number、两个空值、this、instanceof）
> - 读到一段类型声明时，能说出它在描述什么形状、运行时还剩什么

<a id="s11"></a>

### 1.1 两个世界：编译期类型 vs 运行时值

> **TypeScript 在 JavaScript 上加了一层只在编译期存在的类型；类型检查一结束，类型就被擦掉，真正运行的还是纯 JS。**

> **📌 为什么需要它**
>
> 纯 JS 的类型错误只在运行时炸出来：字段名拼错、函数少传一个参数、把字符串当数字用——这些都要等代码跑到那一行才报。TypeScript 把这类错误提前到「你按下保存、还没运行」时就在编辑器里标红。代价写在定义里：它只在编译期帮你，运行时它什么都不剩。

> **💡 类比 · 带边界声明**
>
> TS 的编译期检查像 Java 的编译期类型检查。但类比在一个点上断裂：**Java 的类型运行时还在**——你能反射、能 `getClass()`、能对接口 `instanceof`。**TS 的类型运行时彻底消失**。这条差异是后面一半「怪事」的根源。

看一段最小的 TS，和它编译出的 JS：

**两个世界 · TypeScript → JavaScript**

```typescript
// —— 你写的 .ts（类型世界 + 值世界都在）——
let count: number = 5;
function greet(name: string): string {
  return "Hi, " + name;
}

// —— tsc 编译后的 .js（类型世界被擦干净）——
// let count = 5;
// function greet(name) {
//   return "Hi, " + name;
// }
```

注解 `: number`、`: string` 在产物里一个不剩。这就是「擦除」最直观的样子：类型是给 `tsc` 和编辑器看的批注，不是会被打包进运行结果的代码。

> **💡 桥接你已有的 Java 知识**
>
> Java 其实已经让你见过擦除：`List<String>` 在运行时只是 `List`，泛型参数 `String` 被擦掉了。TypeScript 把这件事推到极致——**不只泛型参数，所有类型注解都像 Java 的泛型参数一样被擦除**。你对「Java 泛型运行时拿不到 `T`」的那份接受，正好是理解整个 TS 类型系统的起点。

> **🧠 想一想**
>
> 一个 `function add(a: number, b: number)`，运行时还能不能拿到「这两个参数本该是 number」这条信息，从而在别人传字符串时自动拦下？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

不能。编译后就是 `function add(a, b)`，类型信息没了。运行时若有人 `add("1", "2")`，JS 照跑不误，得到 `"12"`（字符串拼接）。想在运行时拦住，只能自己写 `typeof a === "number"` 这类**值层面**的检查。

这指向一条贯穿全书的原理：**类型保证只在编译期成立；运行时的输入（用户、API、文件）不受类型系统保护，必须自己校验。**

</details>

**与下一节的关系**：既然类型是编译期的批注，那这些批注能写出哪些「值的集合」？下一节从最基础的类型零件开始。

<a id="s12"></a>

### 1.2 基础类型：一个 number、两个空值、any/unknown/never

> **TS 的原始类型把「这个值属于哪一类」写成类型；其中几个的边界和 Java 差得最远，最容易栽。**

> **📌 为什么需要它**
>
> 类型系统从原始类型起步。多数能直接对应 Java，但**数字、空值、顶/底类型**这三处和 Java 的差异，是 Java 工程师第一周最常踩的失败模式——不先讲清，后面全是连锁误判。

#### 一个 number：没有 int / long / double 之分

JS 只有一种数字类型，TS 对应只有一个 `number`，底层是 IEEE 754 双精度浮点。没有 `int`、`long`、`float` 的区分；超大整数才用单独的 `bigint`。直接后果：浮点误差对所有数字生效。

**一个 number · TypeScript**

```typescript
let price: number = 10;     // 整数也是 number
let ratio: number = 0.5;    // 小数也是 number
console.log(0.1 + 0.2);     // 0.30000000000000004，不是 0.3
console.log(0.1 + 0.2 === 0.3);  // false

const big: bigint = 9007199254740993n;  // 超出安全整数范围才用 bigint
```
> **⚠️ 陷阱**
>
> Java 里 `10 / 3` 是整数除法得 `3`；TS 里 `10 / 3` 是 `3.333...`，因为没有整数类型。还有：数组越界 `arr[99]` 返回 `undefined` 而不是抛异常。Java 的「会抛 `IndexOutOfBoundsException`」直觉在这里失效。

#### 两个空值：null 和 undefined

Java 只有一个 `null`。JS/TS 有**两个**表示「空」的值，含义不同：

- `undefined`——「没赋值 / 不存在」。变量声明未赋值、对象没有的属性、函数没 return，都是 `undefined`。多数是「自然发生」的空。
- `null`——「显式的空」。通常是程序员主动赋的，表示「这里就是要为空」。

实务上一个常见误判：用 `x === null` 检查空值，却漏掉 `undefined`。两者不相等（`null === undefined` 是 `false`）。

#### 顶与底：unknown / any / never

这三个最抽象，用「类型 = 值的集合」来理解最快。一个类型就是「所有能赋给它的值」组成的集合；一个值能不能赋给某类型，等价于问「它在不在那个集合里」。

![把类型看成值的集合：unknown 是全集，never 是空集，字面量是单点集合，string 与 number 是不相交的子集](typescript-blog-assets/figure-02.svg)

> 图 1.1 把类型看成值的集合。**注意**：`unknown` 是装下一切的全集——任何值都能赋给它，但反过来它不能赋给任何具体类型（先得收窄）；`never` 是空集；字面量 `"hi"` 是只有一个元素的集合；「A 能赋给 B」等价于「集合 A ⊆ 集合 B」。

- **`unknown`**（安全的顶类型）：全集。任何值都能存进 `unknown`，但取出来用之前**必须先收窄**（见 §1.8）。它是 Java `Object` 的精神对应——能装一切，用前要确认。
- **`any`**（逃生舱）：它不是「集合」，而是「关掉类型检查」的开关。标了 `any` 的值，TS 对它的一切操作都不再检查。它**不**等于 Java 的 `Object`——`Object` 还要求你强转，`any` 连这一步都免了。
- **`never`**（底类型）：空集。没有任何值属于它。用于表达「永远到不了这里」——比如一个永远抛异常、永不正常返回的函数，返回类型就是 `never`。

![unknown 是单向膜：值进得来，用之前必须收窄才能出去；any 两个方向都不拦，关闭检查](typescript-blog-assets/figure-03.svg)

> 图 1.2 `unknown` 与 `any` 都能接收任何值，区别在「出口」。**注意**：`unknown` 像单向膜——进得来，但用之前编译器逼你收窄，安全；`any` 把检查整个关掉，方便但错误会一路漏到运行时。优先用 `unknown`。
> **🧠 想一想**
>
> 有个值 `const data: unknown = JSON.parse(raw)`。直接写 `data.name` 会怎样？换成 `const data: any = ...` 又会怎样？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

`unknown` 版：`data.name` 直接**编译报错**——「对象类型为 unknown」。必须先收窄，例如 `if (data && typeof data === "object" && "name" in data)`。

`any` 版：`data.name` 编译**通过**，但如果 `data` 其实没有 `name`，运行时得到 `undefined`，错误被推迟、被掩盖。这正是为什么处理「外部来的、形状不确定的数据」要用 `unknown` 而不是 `any`。

</details>

**与下一节的关系**：知道有哪些类型后，下一个问题是——这些类型该自己手写，还是让 TS 替你推出来？

<a id="s13"></a>

### 1.3 类型注解与类型推断

> **注解是你手写给值的类型；推断是 TS 根据值自动算出的类型。能推断的就别手写。**

> **📌 为什么需要它**
>
> JS 本身没类型。注解把「这里期望什么」写给编译器和读代码的人。但到处写注解既啰嗦又容易和实际值不同步——TS 的推断很强，绝大多数局部变量不用标。关键是知道**哪里必须手写**。

经验法则：**在边界处手写注解，内部交给推断**。边界 = 函数参数、函数返回值、模块对外的导出、外部数据的入口。这些地方写清楚，等于给整个系统钉下契约；内部的临时变量让 TS 自己推。

**注解在边界，推断在内部 · TypeScript**

```typescript
// 边界：参数与返回值显式注解（契约）
function totalPrice(items: { price: number }[]): number {
  let sum = 0;            // 内部：推断为 number，不用标
  for (const it of items) sum += it.price;
  return sum;
}

let name = "Ada";         // 推断为 string
let ids = [1, 2, 3];      // 推断为 number[]
```
> **💡 类比 · 带边界声明**
>
> Java 10 的 `var` 是局部变量推断，和 TS 的 `let name = "Ada"` 同理。区别是 TS 的推断更广——连函数返回值都能推。但「对外契约要显式」这条工程纪律两边一致：库的公开 API 别依赖推断，手写出来更稳。

> **🧠 想一想**
>
> `let x = 5` 和 `const x = 5`，TS 推断出的类型一样吗？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

不一样。`let x = 5` 推断为 `number`——因为 `let` 之后还能改成别的数字，TS 把类型「拓宽」到 `number`。`const x = 5` 推断为**字面量类型 `5`**——`const` 不能再赋值，值永远是 `5`，所以收到最窄。

这解释了一个常见困惑：把变量传进只接受字面量联合的函数时，`const` 的常量能过、`let` 的变量被拒（已拓宽成 `number`/`string`）。这条会在 §1.5 再次出现。

</details>

**与下一节的关系**：原始类型之上，真实程序到处是对象。怎么给对象的「形状」命名？

<a id="s14"></a>

### 1.4 对象类型：interface 与 type

> **用 `interface` 或 `type` 给对象的「形状」（有哪些属性、各是什么类型）起个名字。**

> **📌 为什么需要它**
>
> 对象是 JS 的主角。给形状命名后，函数才能声明「需要一个长这样的对象」，编辑器才能补全、检查。没有它，对象就是一团 `any`。

**interface 与 type · TypeScript**

```typescript
interface User {
  id: number;
  name: string;
  email?: string;        // ? 表示可选属性
  readonly createdAt: number;  // readonly：初始化后不可改
}

type Point = { x: number; y: number };  // type 也能描述对象形状

function rename(u: User, next: string): User {
  return { ...u, name: next };
}
```

两者在「描述对象形状」上几乎可互换。差异在能力范围：

表 1.1 · interface vs type 的取舍

| 维度 | interface | type（类型别名） |
| --- | --- | --- |
| 能描述什么 | 只能是对象 / 类的形状 | 任何类型：联合、元组、原始类型别名、映射类型 |
| 扩展 | `extends` 继承 | `&` 交叉类型 |
| 同名声明 | 自动**合并**（declaration merging） | 报「重复标识符」错误 |
| 典型用法 | 对象形状、类契约、对外 API | 联合 / 元组 / 工具类型 / 复杂组合 |

经验法则：**对象形状和类契约用 `interface`，联合 / 元组 / 需要类型运算的用 `type`**。团队里选一个为主、保持一致比纠结哪个「更好」重要。

> **⚠️ 陷阱 · Java 直觉失效**
>
> Java 的 `interface` 是**名义**契约：一个类必须 `implements User` 才算是 `User`。TS 的 `interface` 是**结构**形状：任何对象只要长得对（有 `id: number` 和 `name: string`），就**自动**算 `User`，不需要、也没有 `implements` 这一步。这是第 2 章「结构化类型」的核心，先记住这个反直觉点。

> **🧠 想一想**
>
> 先后写 `interface Box { w: number }` 和 `interface Box { h: number }`，会报「重复定义」吗？换成两个同名 `type Box` 呢？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

`interface` 版：**不报错**，两次声明**合并**成 `{ w: number; h: number }`——这叫声明合并，是 Java 没有的机制（用来给第三方类型「补充」属性）。`type` 版：**报错**，「标识符 Box 重复」。这是表 1.1 里「同名声明」那行的直接后果。

</details>

**与下一节的关系**：对象形状之外，JS 函数常接受「几种值之一」。表达「或」要用联合类型。

<a id="s15"></a>

### 1.5 联合类型与字面量类型

> **联合 `A | B` 表示「A 或 B」；字面量类型把一个具体的值（`"GET"`、`200`）本身当成类型。**

> **📌 为什么需要它**
>
> JS 函数天生灵活：一个参数既可以是字符串、也可以是数字，一个配置项只允许几个固定字符串。联合 + 字面量能精确表达这些，而这正是 JS 代码的日常形状。

把字面量用联合串起来，就得到「JS 版的枚举」——一组允许的具体值：

**字面量联合 = JS 风格的枚举 · TypeScript**

```typescript
type Method = "GET" | "POST" | "PUT" | "DELETE";

function request(url: string, method: Method): void {
  // ...
}

request("/users", "POST");   // ✓
request("/users", "PATCH");  // ✗ 编译报错："PATCH" 不在联合里

type Id = string | number;   // 联合不同原始类型也很常见
```
> **💡 类比 · 带边界声明**
>
> Java 这种场景用 `enum Method { GET, POST }`。TS 里**首选字面量联合**，因为：① 它是纯类型，编译后零运行时开销（被擦除）；② 它的值就是字符串本身，和 JSON / HTTP 头 / API 天然兼容，不用做 enum↔字符串转换。TS 也有 `enum` 关键字，但它有运行时陷阱——第 2 章 §2.3 专门拆。

> **🧠 想一想**
>
> 把 `"POST"` 存进 `let m = "POST"` 再 `request("/x", m)`，能编译过吗？换成 `const m = "POST"` 呢？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

`let m = "POST"`：**报错**。`let` 把 `m` 推断成 `string`（§1.3 的拓宽），而 `string` 比 `Method` 宽，不能塞进只接受四个字面量的参数。`const m = "POST"`：**通过**，`const` 推断成字面量类型 `"POST"`，正好属于联合。这就是 §1.3 那条推断规则的实战后果。

</details>

**与下一节的关系**：值和对象之外，函数本身也有类型；而函数里藏着 JS 最坑人的运行时机制——`this`。

<a id="s16"></a>

### 1.6 函数类型与 this

> **函数有参数类型和返回类型；而 JS 的 `this` 在「被怎么调用」时才确定，不是在定义处词法绑定的。**

> **📌 为什么需要它**
>
> 函数是 JS 的一等公民，到处被当值传递。给它标类型保证调用方传对参数、用对返回值。`this` 则是 Java 工程师最容易栽的运行时陷阱——它的行为和 Java 完全不同。

**函数类型 · TypeScript**

```typescript
function send(url: string, retries: number = 3, ...tags: string[]): boolean {
  return true;
}
//  retries 有默认值；...tags 是剩余参数（收成 string[]）

// 函数也能作为类型标注（回调）
function onClick(handler: (event: string) => void): void {
  handler("tap");
}
```

#### this 的陷阱

Java 里 `this` 永远指当前实例，编译期就定死。JS 里 `this` 取决于**调用方式**——同一个函数，不同调法，`this` 不同。最常见的翻车是把对象方法当回调传出去：

**this 在回调里丢失 · TypeScript**

```typescript
class Counter {
  count = 0;
  increment() { this.count++; }            // 普通方法
  incrementSafe = () => { this.count++; };  // 箭头函数：锁定词法 this
}

const c = new Counter();
[1, 2, 3].forEach(c.increment);      // ✗ this 变成 undefined，运行时报错
[1, 2, 3].forEach(c.incrementSafe);  // ✓ 箭头函数保留了 c 作为 this
```
> **⚠️ 陷阱 · Java 直觉失效**
>
> `c.increment` 单独取出来传给 `forEach` 时，它和对象 `c` 的联系断了；调用时 `this` 不再是 `c`（严格模式下是 `undefined`），`this.count++` 抛错。修复：用箭头函数（词法绑定 `this`）或 `c.increment.bind(c)`。Java 的「方法永远绑定在实例上」直觉，在这里必须放下。

**与下一节的关系**：函数要适配多种类型而不退化成 `any`，靠的是泛型——一个你在 Java 已经熟悉的工具。

<a id="s17"></a>

### 1.7 泛型

> **泛型让类型像参数一样传进来，写一份逻辑适配多种类型，同时保住类型安全。**

> **📌 为什么需要它**
>
> 和 Java 同一个动机：避免为 `string[]`、`number[]` 各写一遍取首元素的函数，又不想退化成 `any[]` 丢掉类型。泛型把「元素类型」抽成参数 `T`。

**泛型函数与约束 · TypeScript**

```typescript
function first<T>(arr: T[]): T | undefined {
  return arr[0];
}
const a = first([1, 2, 3]);     // a: number | undefined
const b = first(["x", "y"]);    // b: string | undefined

// 约束：T 必须有 id 字段
function byId<T extends { id: number }>(items: T[], id: number): T | undefined {
  return items.find(it => it.id === id);
}
```
> **💡 类比 · 带边界声明**
>
> 语法和 Java 几乎一样（`<T>`、`T extends ...`）。**最重要的相同点**：Java 泛型运行时被擦除，TS 也擦除——你早就接受了「运行时拿不到 `T`」。差异是程度：Java 至少保留原始类型 `List`；TS 连这个都没有，运行时 `arr` 就是个普通数组，`T` 不留一丝痕迹。所以 `new T()`、`T.class` 在两边都不行，TS 更彻底。

> **🧠 想一想**
>
> 能不能在 `first<T>` 里写 `if (x instanceof T)` 来判断元素类型？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

不能。`T` 是编译期的类型参数，运行时已被擦除，根本不存在一个叫 `T` 的东西供 `instanceof` 用——这和 Java 不能写 `x instanceof T` 是同一道限制。要在运行时辨别，只能基于**值**本身（`typeof`、检查某个字段在不在），也就是下一节的收窄。

</details>

**与下一节的关系**：类型擦除后运行时没有类型信息，那怎么在运行时区分「这到底是 string 还是 number」？答案是收窄——连接两个世界的桥。

<a id="s18"></a>

### 1.8 收窄 narrowing

> **用 JS 在运行时能做的检查（`typeof` / `instanceof` / `in` / 比较字面量），让 TS 把宽类型「收窄」成具体类型。**

> **📌 为什么需要它**
>
> 有了联合类型（`string | number`），用之前得知道具体是哪个。但类型已被擦除，运行时只能靠**值本身**的检查来辨别。收窄就是那座桥：你用值世界的检查（`typeof x === "string"`），TS 在类型世界里同步把 `x` 收窄成 `string`——这叫控制流分析。

![联合类型 string | number 经过 typeof 守卫，在两个分支里分别收窄成 string 和 number](typescript-blog-assets/figure-04.svg)

> 图 1.3 `typeof` 守卫把联合类型在两个分支里分别收窄。**注意**：你只写了一个普通的 JS `if`，TS 在每个分支里**自动**把 `value` 当成对应的具体类型——不需要 Java 那样的显式强转。
**四种收窄手段 · TypeScript**

```typescript
function format(value: string | number): string {
  if (typeof value === "string") {
    return value.toUpperCase();   // 这一支里 value 是 string
  }
  return value.toFixed(2);        // 另一支里 value 是 number
}

// in：靠属性是否存在来收窄
type Dog = { bark: () => void };
type Cat = { meow: () => void };
function speak(a: Dog | Cat) {
  if ("bark" in a) a.bark(); else a.meow();
}

// 带标签的联合（discriminated union）——最稳的收窄
type Result =
  | { kind: "ok"; data: string }
  | { kind: "err"; message: string };
function handle(r: Result) {
  if (r.kind === "ok") console.log(r.data);
  else console.log(r.message);
}
```
> **⚠️ 陷阱 · instanceof 只对 class 有效**
>
> `instanceof` 检查的是「运行时的构造函数 / 原型」，所以只能用于 **class**。对 `interface` 或 `type` 用 `instanceof` 会直接编译报错——因为它们运行时不存在（又是擦除）。区分两个 interface 形状的对象，得用 `in` 或带标签的联合，而不是 `instanceof`。

**本章收束**：八个零件背后是同一条线——**类型只在编译期、运行时被擦除**。number 只有一个、instanceof 不能用于 interface、泛型运行时拿不到 `T`、收窄要靠值层面的检查……全是这条线的推论。下一章把这条线本身讲透：它为什么这么设计，代价是什么。

<a id="chapter-01-self-check"></a>

### § 本章 self-check

先合上教程，把答案写在纸上或编辑器里。写完再展开对照——直接点开等于把这一节当再读一遍。

1. 一段 TS 编译成 JS 后，类型注解（`: number`、`interface`）去哪了？这对「运行时能否拿到类型」意味着什么？
2. `let x = 5` 和 `const x = 5` 各被推断成什么类型？为什么不同？
3. `any` 和 `unknown` 都能接收任何值，最关键的区别是什么？哪个适合接 `JSON.parse` 的结果？
4. （设计层）为什么 `instanceof` 能用于 class，却不能用于 interface？

<details>
<summary><strong>答案（先做完再展开）</strong></summary>

1. 被**完全擦除**，产物里一行类型都不剩。意味着运行时拿不到任何类型信息——不能反射类型、不能对 interface 用 `instanceof`、泛型拿不到 `T`；外部输入必须自己用值层面的检查校验。
2. `let x = 5` → `number`（可再赋值，类型被拓宽）；`const x = 5` → 字面量类型 `5`（不可变，收到最窄）。直接影响能否把它传进只接受字面量联合的参数。
3. `any` 关闭检查、可直接 `.foo`，错误漏到运行时；`unknown` 安全，用前必须收窄。接 `JSON.parse`（外部、形状不确定）应该用 `unknown`。
4. `instanceof` 依赖运行时的构造函数 / 原型链，class 编译后会留下真实的构造函数；而 interface / type 是纯类型，运行时被擦除、根本不存在，没有东西供 `instanceof` 检查。

</details>

进阶挑战 · 刚好够不着

#### 不用 as，安全地把 unknown 收窄成具体形状

写一个 `parseConfig(raw: unknown): { port: number } | null`：当 `raw` 确实是一个含数字 `port` 的对象时返回它，否则返回 `null`。约束：**不许用 `as` 断言**，只能靠运行时检查让 TS 自己收窄。

<details>
<summary><strong>提示（卡住再展开）</strong></summary>

分层检查：先 `raw !== null && typeof raw === "object"`，再 `"port" in raw`，最后 `typeof (raw as ...).port`——等等，目标是不用 `as`。试试在每层之后让 TS 自动收窄：`"port" in raw` 通过后，再单独取出 `raw.port` 用 `typeof` 判断。你会发现：这套手写校验，正是 [zod](https://zod.dev/) 这类库替你做的事——记住这个手感，第 2 章 §2.2 会回到它。

</details>

#### 本章参考

- [Handbook · Everyday Types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)（官方，基础类型）
- [Handbook · Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)（官方，收窄与控制流分析）
- [Handbook · Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)（官方，泛型）
- [Effective TypeScript · Item 7「把类型当成值的集合」](https://effectivetypescript.com/2019/03/01/items/)（图 1 .1 的理论来源）

---

<a id="chapter-02"></a>

## 第 2 章：工作原理与设计取舍

第 1 章把八个零件背后的主线点了出来——类型只在编译期、运行时被擦除。这一章把这条主线本身讲透：类型为什么按「形状」而非「名字」匹配、擦除在编译流水线的哪一步发生、为什么这套类型系统**故意**不健全、`strict` 又替你打开了哪些检查。

> **🧭 本章你将建立的 schema**
>
> - 用「按形状、不按名字」解释两个无关类型为何可互换，以及多余属性检查这个补丁
> - 能画出 `tsc` 的「检查 → 擦除 → 生成」流水线，说清 tsx / Node 原生 / `--noEmit` 各在哪一环
> - 理解「绿色编译 ≠ 运行不崩」——`any` / `as` 是故意留的逃生舱，不能像信 javac 那样信 tsc
> - 会配 `strict`，知道它打开的每个子开关防住哪种错误

<a id="s21"></a>

### 2.1 结构化类型：按形状，不按名字

> **TS 判断「A 能不能赋给 B」只看 A 有没有 B 要求的全部成员（形状），不看它们叫什么、有没有继承关系。**

> **📌 运行方式**
>
> 这叫结构化类型（也叫鸭子类型）。第 1 章 §1.4 埋的伏笔在此收口：TS 的 `interface` 不需要 `implements`——任何对象只要形状对上，就**自动**算那个类型。兼容性由形状决定，与名字无关。

![同样形状的两个类型：TypeScript 按结构判定可互相赋值，Java 按名字判定不兼容](typescript-blog-assets/figure-05.svg)

> 图 2.1 同样是 `{ x; y }` 形状、不同名字的两个类型。**注意**：TS 只看形状，二者随意互换；Java 看名字 + 继承，二者老死不相往来。这是 Java 工程师对 TS 最大的直觉重置。
> **📌 为什么这么设计**
>
> JS 代码满地都是匿名对象字面量、没有类名的东西（`{ x: 1, y: 2 }` 随手就写）。名义类型（Java 那种「必须 implements 才算数」）根本没法描述这些**既存的、无名的** JS 值，也没法支持「给一个旧 JS 项目逐步加类型」的渐进式迁移。结构化是 TS 能套在现成 JS 生态上的前提。

表 2.1 · 三种类型立场

| 方案 | 兼容性怎么判定 | 代价 / 为什么 TS 没选它 |
| --- | --- | --- |
| 名义类型（Java / C#） | 看声明的名字 + 继承链 | 描述不了无名的 JS 对象，迁移成本高 |
| 无类型（原始 JS） | 不判定，全靠运行时 | 没有任何编译期保护 |
| 结构化类型（TypeScript） | 看形状（有没有要求的成员） | 选中：能套现成 JS；代价见下文 |

> **📌 带来的代价**
>
> 两个本该区分的类型，只要形状一样就能互换——类型系统不替你拦。一个 `{ meters: number }` 和 `{ seconds: number }`……不，它们字段名不同所以不兼容；但 `UserId` 和 `PostId` 若都只是 `number`，就能随意混用，编译器不管。为了堵一类手滑，TS 加了个补丁：**多余属性检查**——把对象字面量**直接**赋值时，多出未声明的属性会报错。

> **🧠 想一想**
>
> `const p: {x:number; y:number} = {x:1, y:2, z:3}` 会报错吗？如果先 `const tmp = {x:1,y:2,z:3}` 再把 `tmp` 赋给 `p` 呢？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

直接赋值：**报错**——多余属性检查发现 `z` 未在目标类型里声明。经过中间变量 `tmp`：**不报错**——此时走纯结构化规则，目标只要求「至少有 x、y」，`tmp` 满足，多出的 `z` 被忽略。

这两个看似矛盾的行为，根源是：多余属性检查是个**只对「新鲜的对象字面量」生效的补丁**，不是结构化规则本身。理解了这点，这个高频困惑就不再是玄学。

</details>

**与下一节的关系**：结构化解决了「编译期怎么判类型」。但这些类型到了运行时还在不在？这就是擦除。

<a id="s22"></a>

### 2.2 类型擦除与编译模型

> **`tsc` 先做类型检查，再把所有类型擦掉、生成纯 JS；这两步可以分开——很多工具只擦不查。**

> **📌 运行方式**
>
> 从你的 `.ts` 到能跑的代码，中间是一条流水线。关键是它有**两个独立动作**：类型检查、擦除生成。现代工具链把它们拆开了。

![TypeScript 编译流水线：源码经类型检查、擦除生成纯 JS、再运行；tsx 和 Node 原生绕过类型检查直接剥离类型](typescript-blog-assets/figure-06.svg)

> 图 2.2 编译流水线，类型在「擦除 → 生成」这一步丢弃。**注意**那条虚线绕行：`tsx` 和 Node 原生为了快，只剥离类型、**不做类型检查**——代码照样跑，但错误不被拦。所以真实项目用它们跑、用 `tsc --noEmit` 在 CI 里单独把关。
> **📌 为什么这么设计**
>
> TS 的设计目标白纸黑字写着：「完全可擦除的类型系统」「零运行时开销」「不留运行时类型信息」。好处是编译产物就是干净标准的 JS，没有运行时负担，能跑在任何 JS 环境（浏览器、Node、边缘函数）。

表 2.2 · 2026 年运行 TS 代码的几种方式

| 工具 | 做什么 | 类型检查 | 典型用途 |
| --- | --- | --- | --- |
| `tsc` | 官方编译器：检查 + 生成 .js | ✓ | 出包、CI 把关（`--noEmit` 只查不生成） |
| `tsx` / esbuild | 极快地剥离类型直接跑 | ✗ | 本地开发、跑脚本 |
| Node 原生（≥22.18） | `node file.ts` 直接剥离类型 | ✗ | 无需额外依赖跑单文件 |
| `ts-node` | 用真编译器跑（较慢） | 可选 | 旧项目，逐渐被 tsx 取代 |

> **📌 带来的代价**
>
> 运行时没有类型，是第 1 章一连串限制的**同一个根因**：不能反射类型（§1.1）、不能对 interface 用 `instanceof`（§1.8）、泛型拿不到 `T`（§1.7）。最现实的代价是：**外部数据（API 响应、用户输入、读文件）不受类型系统保护**。[zod](https://zod.dev/) 这类库就是来补这个洞——它定义一个「运行时存在的 schema」，校验外部数据，并能反推出对应的静态类型。

**擦除的代价：as 不是运行时检查 · TypeScript**

```typescript
// 从 API 拿数据，断言它是 User —— 危险
const user = (await res.json()) as User;  // as：编译期骗过检查，运行时零验证
console.log(user.name.length);            // 后端少给 name？运行时才 TypeError

// 正确做法：运行时校验（zod），schema 不会被擦除
import { z } from "zod";
const User = z.object({ name: z.string() });
const user2 = User.parse(await res.json()); // 形状不对当场抛错，且 user2 自动有类型
```
> **🧠 想一想**
>
> 把 API 返回的 JSON 写成 `as User` 后，如果后端漏发了一个字段，TS 会在哪一步替你发现？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

**永远不会自动发现。**`as` 是编译期断言，运行时被擦除，不产生任何检查代码。字段缺失要等到你访问 `.missingField` 拿到 `undefined`、或对它再取属性抛 `TypeError` 时才暴露——可能在离出错点很远的地方。这就是「外部数据要用 zod 校验、而不是 as」的全部理由。

</details>

**与下一节的关系**：既然 `as` 能骗过编译器、运行时又不检查，那 TS 的「编译通过」到底保证了什么？答案出人意料：它**没**保证运行不崩。

<a id="s23"></a>

### 2.3 「不健全」是故意的，以及 enum 这个例外

> **TS 明确把「健全 / 可证明正确」列为**非目标**：它知道有些会在运行时崩的程序，也照样放行。**

> **📌 运行方式**
>
> 「健全」（sound）指类型系统保证「编译通过 → 运行时类型一定不出错」。Java、C# 在很大程度上追求这个。TS **故意放弃**了它，留了几个逃生舱：`any`（关掉检查）、`as` 断言（覆盖检查、不做运行时验证）、数组协变等。它们让你「自己说了算」，代价是编译器不再担保。

> **⚠️ 最重要的心智调整**
>
> **绿色编译 ≠ 运行不崩。**Java 工程师习惯无条件信任 `javac`——编译过基本不会有类型错误。在 TS 里不能这样信任 `tsc`。尤其 `as`：它长得像 Java 强转，但 **Java 强转运行时会检查**（失败抛 `ClassCastException`），**TS 的 `as` 运行时什么都不做**。它只是命令编译器别检查、按你断言的类型算。

> **📌 为什么这么设计**
>
> 一个完全健全的类型系统，会拒绝大量「其实没问题」的 JS 惯用法，让给存量 JS 加类型变得几乎没法做到。TS 选了「实用 > 可证明正确」：用八成的检查覆盖九成九的错误，剩下的交给逃生舱、由你负责。这是个清醒的工程权衡，不是疏漏。

表 2.3 · 健全性的三种立场

| 立场 | 编译通过意味着 | 取舍 |
| --- | --- | --- |
| 健全（如 Elm / 多数函数式语言） | 运行时类型一定不出错 | 最安全，但会拒绝很多合法的动态写法 |
| 无类型（原始 JS） | 什么都不意味着 | 最灵活，零保护 |
| 不健全但实用（TypeScript） | 「基本没事」，但 `any`/`as` 处除外 | 选中：覆盖绝大多数错误 + 留逃生舱兼容 JS |

#### enum：擦除的那个例外

导览页的概念图埋了一句「`enum` 是少数会漏到运行时的类型语法」，这里收口。第 1 章说过类型几乎全被擦除，但 `enum` 不是——它会编译成一个**真实存在的 JS 对象**，还带正反双向映射：

![enum 编译成带正反映射的真实 JS 对象并留在运行时，而字面量联合编译后什么都不剩](typescript-blog-assets/figure-07.svg)

> 图 2.3 同样表达「颜色只能是 Red 或 Green」，`enum` 与字面量联合的运行时命运相反。**注意**：`enum` 是擦除规则的**例外**，留下真实对象（有体积、有反向映射带来的反直觉行为）；字面量联合（§1.5）纯类型、零开销。这是社区多数场景偏向字面量联合的原因。
> **🧠 想一想**
>
> `const u = {} as User; console.log(u.name.length)`，编译过吗？运行时呢？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

编译**通过**——`as User` 让编译器相信 `{}` 是个 `User`，跳过检查。运行时 `u.name` 是 `undefined`，`undefined.length` 抛 `TypeError`。这就是「不健全」最具体的样子：一行编译全绿的代码，运行直接崩。把 `as` 当成「我对编译器的承诺」，而不是「一次安全转换」。

</details>

**与下一节的关系**：既然编译器默认会放行不少危险写法，怎么把它调到「尽量严格」？这就是 `strict`。

<a id="s24"></a>

### 2.4 strict 配置：一个元开关

> **`strict: true` 不是一个检查，而是一次性打开约 8 个子检查的**元开关**。**

> **📌 运行方式**
>
> 在 `tsconfig.json` 里设 `"strict": true`，等于同时开启一组「更安全、但会拒绝部分旧代码」的检查。其中分量最重的是 `strictNullChecks`。TypeScript 6.0 起，`strict` 已是默认开启。

**tsconfig.json（最小够用） · JSON**

```json
{
  "compilerOptions": {
    "strict": true,            // 元开关：打开下面一整组检查
    "target": "es2023",        // 编译到哪个 JS 版本
    "module": "nodenext",      // 模块格式
    "moduleResolution": "nodenext",
    "esModuleInterop": true,   // 兼容 CommonJS 默认导入
    "skipLibCheck": true       // 跳过第三方 .d.ts 检查，构建更快
  }
}
```

表 2.4 · strict 打开的关键子检查 → 各自防住的痛点

| 子开关 | 关闭时的痛点 | 打开后 |
| --- | --- | --- |
| strictNullChecks | `null`/`undefined` 可赋给任何类型，NPE 在运行时炸 | 空值必须显式处理，编译期拦下 |
| noImplicitAny | 推断不出类型时悄悄变 `any`，检查静默失效 | 逼你补注解或承认确实是 any |
| strictPropertyInitialization | 类字段忘了初始化，用时是 `undefined` | 字段必须初始化（类似 Java final 检查） |
| useUnknownInCatchVariables | `catch (e)` 里 `e` 是 `any` | `e` 是 `unknown`，用前必须收窄 |

> **💡 洞察 · 十亿美元错误**
>
> `strictNullChecks` 针对的是 Tony Hoare 口中的「十亿美元错误」——null 引用。关闭时，TS 和早期 Java 一样：`null` 潜伏在每个类型里，运行时随时 NPE。打开后，`string` 就只是 `string`，想让它能为空必须写成 `string | null` 并显式处理。这是新项目**第一件该确认开启**的事（6.0 已默认开）。

> **🧠 想一想**
>
> 关闭 `strictNullChecks` 时，`function len(s: string) { return s.length }` 传 `null` 进去，编译报错吗？
>
> <details>
<summary><strong>展开答案（先停 10 秒）</strong></summary>

关闭时：**不报错**——`null` 被视为可赋给 `string`，运行时 `null.length` 抛错。打开 `strictNullChecks` 后：编译期就报错，因为 `null` 不再属于 `string`，要传得把参数类型写成 `string | null` 并在函数里先判空。把「空」从隐形变显形，正是这个开关的全部价值。

</details>

<a id="s25"></a>

### 2.5 跨概念综合：一次 API 取数据，用上几乎所有机制

把前面拆开的机制串成一个真实场景——从 API 取用户列表、渲染名字。读这段时，留意每一步**踩在哪个机制上**：

**一个场景串起全章 · TypeScript**

```typescript
import { z } from "zod";

// 形状（§1.4 对象类型 + §2.1 结构化）
const User = z.object({ id: z.number(), name: z.string(), email: z.string().optional() });
type User = z.infer<typeof User>;   // 从运行时 schema 反推静态类型

async function loadUsers(): Promise<User[]> {
  const raw: unknown = await (await fetch("/api/users")).json();  // §1.2 unknown，不是 any
  return z.array(User).parse(raw);   // §2.2 擦除→必须运行时校验，而不是 as
}

function render(users: User[]): string[] {
  return users.map(u =>
    u.email ? `${u.name} <${u.email}>` : u.name   // §1.8 收窄 + §2.4 strictNullChecks
  );
}
```

梳理一遍因果链：fetch 回来的是 `unknown`（§1.2，因为运行时无类型、外部数据不可信，§2.2）；所以不能 `as`，要用 zod 校验（§2.3 不健全 + §2.2 擦除）；校验后得到的 `User[]` 靠结构匹配（§2.1）；渲染时 `email` 是可选的，`strictNullChecks`（§2.4）逼你先收窄（§1.8）才能用。**跳过 zod 这一步，前面所有类型保证都建在沙子上**——因为类型在运行时不存在。

<a id="chapter-02-self-check"></a>

### § 本章 self-check

先合上教程作答，写完再展开对照。

1. 结构化类型下，为什么 `{x,y,z}` 字面量**直接**赋给 `{x,y}` 报错，但经过一个中间变量再赋值就不报错？
2. `tsx` / Node 原生跑 TS，和 `tsc` 有什么本质区别？为什么实践中还要单独跑一遍 `tsc --noEmit`？
3. 用一个 `as` 的例子说明「绿色编译 ≠ 运行不崩」。`as` 和 Java 强转的关键差异在哪？
4. （跨机制）`strictNullChecks` 和「类型擦除」如何**共同**决定了「为什么 API 数据必须用 zod 校验，而不是 `as`」？

<details>
<summary><strong>答案（先做完再展开）</strong></summary>

1. 多余属性检查只对「新鲜的对象字面量直接赋值」生效，发现未声明的 `z` 就报错；经过中间变量后走纯结构化规则，目标只要求「至少有 x、y」，多的忽略。后者才是结构化本身，前者是补丁。
2. `tsx`/Node 原生只**剥离类型直接跑、不做类型检查**；`tsc` 会检查。所以光靠它们跑，类型错误不会被发现——需要在 CI 用 `tsc --noEmit` 单独把关。
3. 例：`const u = {} as User; u.name.length` 编译通过、运行抛 `TypeError`。差异：Java 强转运行时会校验、失败抛 `ClassCastException`；TS 的 `as` 运行时被擦除、零校验，只是骗过编译器。
4. 擦除 → 运行时没有类型，所以外部数据进来时类型系统管不到；`strictNullChecks` 等只在编译期对「你声明的类型」生效，可一旦你用 `as` 谎报了形状，编译期检查是基于谎言做的，运行时又没有兜底。两者叠加 → 唯一可靠的办法是在运行时用 zod 真正验一遍。

</details>

进阶挑战 · 刚好够不着

#### 在结构化系统里，造一个「名义类型」

§2.1 提到 `UserId` 和 `PostId` 若都是 `number` 就能互换，编译器不拦。设计一个类型技巧，让二者**不能**互相赋值——即在结构化系统里模拟出 Java 那样的名义区分。要求：运行时仍然就是普通 number，零开销。

<details>
<summary><strong>提示（卡住再展开）</strong></summary>

给类型「掺」一个现实中不存在、仅用于区分的标记字段：`type UserId = number & { readonly __brand: "UserId" }`。两个 brand 字符串不同 → 形状不同 → 不可互换。运行时那个 `__brand` 从不真正存在（被擦除），所以零开销。这招叫 **branded types**，是用「故意制造形状差异」去对抗结构化默认行为——理解了 §2.1，这个技巧就是自然推论。

</details>

#### 本章参考

- [TypeScript Design Goals](https://github.com/microsoft/TypeScript/wiki/TypeScript-Design-Goals)（官方，含「可擦除」「非健全」等目标/非目标原文）
- [Handbook · Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)（官方，结构化类型规则）
- [tsconfig 参考 · strict 家族](https://www.typescriptlang.org/tsconfig/#strict)（官方，各子开关）
- [The Seven Sources of Unsoundness in TypeScript](https://effectivetypescript.com/2021/05/06/unsoundness/)（不健全从何而来）
- [zod](https://zod.dev/)（运行时校验，补「擦除」留下的洞）

---

<a id="chapter-03"></a>

## 第 3 章：自测与辨析

第 1 章给了类型系统的零件，第 2 章讲了它们背后的设计取舍。这一章不再喂新知识，而是把它们逼出来——三层梯度题 + 跨章判别场景 + 默画概念图。读得顺不算数，能在合上教程后答对才算。

> **⚠️ 使用方式 · 对抗流畅幻觉**
>
> 所有答案集中折叠在页面**最底部**一个块里，刻意离题目很远。先把每道题的答案写在纸上或编辑器里，全部做完，再翻到底部对照。中途瞄答案，等于把题目当正文又读了一遍——那正是导览页警告过的「我读得很顺」假象。

![自测三层梯度金字塔：底层概念回忆，中层原理理解应用，顶层跨章判别迁移](typescript-blog-assets/figure-08.svg)

> 图 3.1 自测的三层梯度。**注意**：越往上，题目越不能靠「背过」答出，越需要把第 1、2 章的概念**组合**起来现场推——顶层的判别题就是用来戳破「我读得顺」却「迁移不动」的幻觉的。

<a id="t1"></a>

### 一 概念层（对应第 1 章）

1. 类型注解和类型推断的区别是什么？说出至少两处「必须手写注解」的场景。[提示：§1.3](#s13)
2. TS 的 `number` 和 Java 的数字类型有什么本质不同？举一个因此会出问题的具体例子。[提示：§1.2](#s12)
3. `null` 和 `undefined` 在语义上分别表示什么？为什么用 `=== null` 判空有风险？[提示：§1.2](#s12)
4. 用「值的集合」分别描述 `unknown`、`any`、`never`。哪个不是真正的集合？[提示：§1.2 + 图 1.1 ](#s12)
5. `interface` 和 `type`，各自只有对方做不到的一件事是什么？[提示：§1.4 表 1.1](#s14)
6. 把 `this` 丢失的那个回调例子，说清「为什么丢」和「两种修复」。[提示：§1.6](#s16)
7. 「收窄（narrowing）」是什么？列出至少三种收窄手段。[提示：§1.8](#s18)
8. 为什么泛型函数里写不了 `new T()` 或 `x instanceof T`？这和 Java 是同一个原因吗？[提示：§1.7](#s17)

<a id="t2"></a>

### 二 原理层（对应第 2 章）

1. 一句话说清「结构化类型」和「名义类型」的区别。[提示：§2.1](#s21)
2. 「多余属性检查」是什么？为什么它让「直接赋值」和「经过中间变量」表现不同？[提示：§2.1](#s21)
3. 描述 `tsc` 的编译流水线，指出类型在哪一步消失。[提示：§2.2 图 2.2 ](#s22)
4. `tsx` / Node 原生跑 TS，和 `tsc` 的本质区别是什么？为什么还要 `tsc --noEmit`？[提示：§2.2 表 2.2](#s22)
5. 「TS 不健全是故意的」——这话什么意思？举两个逃生舱。[提示：§2.3](#s23)
6. `enum` 为什么是「擦除的例外」？它编译成什么？[提示：§2.3 图 2.3 ](#s23)
7. `strict` 是什么级别的开关？`strictNullChecks` 关闭和打开各是什么后果？[提示：§2.4](#s24)

<a id="t3"></a>

### 三 应用判别层（综合第 1、2 章 · 这层最难）

每题给一个场景，要你**选一个方案并说明为什么**——答案往往横跨两章。这是检验「真懂」还是「读着顺」的分水岭。

1. **interface 还是 type？**你要为一个函数的返回值建模，它是 `{ kind: "ok"; data: string } | { kind: "err"; message: string }` 这样的联合。选哪个声明方式？换成给一个普通的 `User` 对象建模、且希望第三方能扩展它，又选哪个？
2. **any 还是 unknown？**你调用一个没有类型声明的老 JS 库，它的返回值形状不确定。先用什么类型接住它最稳？接住之后要做什么才能安全使用？
3. **enum 还是字面量联合？**定义一个 HTTP 方法集合 `GET/POST/PUT/DELETE`，要频繁和 JSON、请求头里的字符串互转。选哪个？从「运行时开销」和「与字符串的兼容性」两个角度说理由。
4. **怎么区分两个对象？**有 `type Dog = { bark(): void }` 和 `type Cat = { meow(): void }`，参数是 `Dog | Cat`。能不能用 `animal instanceof Dog` 区分？为什么？应该用什么手段？（这题同时踩 §1.8 和 §2.2）
5. **as 还是 zod？**一个 webhook 推来一段 JSON，你要把它当作 `{ event: string; amount: number }` 使用。用 `as` 断言，还是用 zod 校验？从「类型擦除」和「不健全」两个原理说清，为什么 `as` 在这里是个定时炸弹。（这题同时踩 §2.2 和 §2.3）

<a id="draw"></a>
> **💡 亲手画一张图**
>
> 合上教程，在纸上默画导览页那张「两个世界」概念图——只画两个框（编译期类型世界 / 运行时值世界）+ 中间的 `tsc` 擦除边界，每个框里填 3 个零件。
>
> 画完回到 [导览页图 0 ](#map) 对照，重点检查三件事：① 你有没有把 **泛型**放在「类型世界」那侧（它运行时被擦除）？② 你有没有把 **enum** 放在「值世界」那侧（它是唯一会漏过去的例外）？③ 你画的 `narrowing` 在哪侧——它其实是连接两侧的桥。哪个放错了，就回对应小节再看一遍。

<a id="answers"></a>

### § 答案（三层全部做完再展开）

最后的检验：合上教程，三层 20 题独立作答完毕，再展开这里。

<details>
<summary><strong>展开全部答案</strong></summary>

#### 一 · 概念层

1. 注解是你手写给值的类型；推断是 TS 根据值自动算出的类型。必须手写的场景：函数参数、对外导出的 API 返回值（不应依赖推断）、外部数据入口。其余局部变量交给推断。
2. TS 只有一个 `number`（IEEE 754 浮点），没有 int/long/double 之分。例子：`10 / 3` 得 `3.333…` 而非整数 `3`；`0.1 + 0.2 !== 0.3`；数组越界返回 `undefined` 而不抛异常。
3. `undefined` = 没赋值 / 不存在（自然发生的空）；`null` = 显式赋的空。风险：`null === undefined` 为 `false`，只判 `=== null` 会漏掉 `undefined` 的情况。
4. `unknown` = 全集（所有值），是安全顶类型，用前必须收窄；`never` = 空集（无任何值）；`any` **不是真正的集合**，它是「关闭类型检查」的开关。
5. `interface` 独有：同名声明自动合并（declaration merging）。`type` 独有：能给联合 / 元组 / 原始类型起别名、做类型运算。
6. 方法被单独取出当回调时，与原对象的绑定断了，调用时 `this` 不再是该对象（严格模式下为 `undefined`），`this.x` 抛错。两种修复：① 用箭头函数（词法绑定 this）；② `obj.method.bind(obj)`。
7. 收窄 = 用运行时能做的值检查，让 TS 把宽类型缩到具体类型。手段：`typeof`、`instanceof`（仅 class）、`in`、比较字面量 / 带标签的联合（discriminated union）、真值判断。
8. 因为 `T` 是编译期类型参数，运行时被擦除、根本不存在，没有东西供 `new` 或 `instanceof` 使用。和 Java 同源（Java 泛型也擦除），但 TS 更彻底——连原始类型都不保留。

#### 二 · 原理层

1. 结构化：看形状（有没有要求的成员）判定兼容；名义：看声明的名字 + 继承链判定兼容。TS 是前者，Java 是后者。
2. 多余属性检查：把**新鲜的对象字面量直接**赋给某类型时，多出未声明的属性会报错。它是结构化规则之外的一个补丁，只对字面量直接赋值生效；经过中间变量后走纯结构化规则（只要求「至少有」要求的成员），多余属性被忽略，于是不报错。
3. 流水线：`.ts 源码（值+类型）` → `tsc 类型检查` → `擦除 + 生成` → `纯 JS` → 运行。类型在「擦除 + 生成」这一步消失。
4. `tsx`/Node 原生只剥离类型、**不做类型检查**，图快；`tsc` 会检查。所以光用它们跑，类型错误不被发现，需要在 CI 用 `tsc --noEmit` 单独把关（只查不生成）。
5. 意思是 TS 明知有些会在运行时崩的程序也放行——它选择「实用 > 可证明正确」，用逃生舱兼容存量 JS。两个逃生舱：`any`（关闭检查）、`as` 断言（覆盖检查、运行时零验证）。（数组协变也算。）
6. 因为 `enum` 会编译成一个真实存在的 JS 对象（数字 enum 还带正向 + 反向双映射），留在运行时——这与「类型几乎全被擦除」相反，故是例外。字面量联合则零运行时开销。
7. `strict` 是元开关，一次打开约 8 个子检查。`strictNullChecks` 关闭时 `null`/`undefined` 可赋给任何类型、NPE 留到运行时；打开后空值必须显式处理（如写成 `string | null`），编译期就拦下。

#### 三 · 应用判别层

1. 联合返回值用 `type`（`interface` 描述不了联合）。普通 `User` 对象、且要第三方可扩展，用 `interface`（可被 `extends`，也支持声明合并来增补）。判别点：要不要表达「联合 / 元组」→ 只能 `type`；要不要「可扩展的对象契约」→ 倾向 `interface`。
2. 先用 `unknown` 接住（不是 `any`——`any` 会让后续所有访问失去检查、错误漏到运行时）。接住后必须先**收窄**（`typeof` / `in` / 逐字段检查，或直接用 zod 校验）才能安全使用。
3. 用字面量联合 `type Method = "GET" | "POST" | "PUT" | "DELETE"`。理由：① 零运行时开销（纯类型、被擦除），`enum` 会生成运行时对象；② 它的值本身就是字符串，和 JSON / 请求头天然互通，不需要 enum↔字符串转换。
4. 不能用 `instanceof`。因为 `Dog`/`Cat` 是 `type`（接口形状），运行时被擦除、不存在构造函数供 `instanceof` 检查（§2.2 擦除）。应改用 `in`（`"bark" in animal`）或把它们改造成带标签的联合（加 `kind` 字段）后按字段收窄（§1.8）。
5. 用 zod。原理：类型擦除（§2.2）→ 运行时没有类型，webhook 的 JSON 不受类型系统保护；`as` 不健全（§2.3）→ 它只在编译期骗过检查、运行时零验证。所以 `as { event; amount }` 在字段缺失 / 类型不符时不会报错，等到你用 `amount.toFixed()` 之类才在远处炸 `TypeError`——定时炸弹。zod 在数据入口当场验，且能反推静态类型。

</details>

> **💡 洞察 · 一条线收束全篇**
>
> 如果三层里你卡住的题，几乎都能追溯到同一句话——「类型只在编译期、运行时被擦除；且按结构而非名字匹配」——那这份教程的目标就达成了。`as` 不安全、要用 zod、`enum` 特殊、泛型运行时为空、`instanceof` 不能用于 interface，全是这一条的推论，而不是五条要分别背的规则。

#### 下一步

- [Handbook · Creating Types from Types](https://www.typescriptlang.org/docs/handbook/2/types-from-types.html)（条件 / 映射 / 模板字面量类型——类型层面的编程）
- [zod](https://zod.dev/)（把「擦除」这一课补上：运行时校验 + 类型反推）
- [type-challenges](https://github.com/type-challenges/type-challenges)（在「按结构匹配」之上练类型体操）
- [Total TypeScript](https://www.totaltypescript.com/)（Matt Pocock，进阶交互课程）
