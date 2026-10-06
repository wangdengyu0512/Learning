---
title: Next.js App Router：从 React 到服务端组件
description: 从文件系统路由、React Server Components、流式渲染与数据获取，到缓存和 Server Actions，建立一套完整的 App Router 心智模型。
date: 2026-10-06
tags: Next.js, React, App Router, React Server Components, Server Actions
featured: true
---

# Next.js App Router：从 React 到服务端组件

如果你已经熟悉 React，却第一次接触 Next.js App Router，最容易产生的误解是：**它只是把 React 加上了文件系统路由和服务端渲染。**

实际上，App Router 改变的是整套应用的运行模型：组件默认在服务器上执行，数据可以直接在组件中获取，页面可以一边渲染一边流式发送，缓存由显式策略控制，写操作也不一定需要手写 API。

理解这一切，可以先记住一句话：

> **组件默认留在服务器；`'use client'` 划出浏览器边界；`<Suspense>` 划出流式边界；缓存指令决定哪些结果可以跨请求复用。**

本文根据目录中的系列教程整理而成。原始资料以 **Next.js 16.2 / React 19** 为版本基线，示例主要用于解释概念与 API 形态。

---

## 一、先换掉 SPA 的默认心智模型

传统 React SPA 的典型链路是：

1. 服务器返回 HTML 空壳；
2. 浏览器下载 JavaScript bundle；
3. React 在浏览器中渲染组件；
4. `useEffect` 发起数据请求；
5. 数据返回后通过 `setState` 再渲染一次；
6. 浏览器绑定事件，页面最终可交互。

这套模型里，几乎所有组件都必须进入浏览器，读取数据库则要经过额外的 API：

```text
浏览器 → API → 数据库 → API → 浏览器
```

App Router 把默认值翻转了：

- 组件默认是 **Server Component**；
- Server Component 不进入浏览器 bundle；
- 它可以直接 `await` 数据库、ORM 或远程接口；
- 只有真正需要状态、事件和浏览器 API 的部分，才进入客户端。

新的链路更接近：

```text
Server Component → 数据源 → 生成 UI 描述 → 浏览器
```

因此，学习 App Router 的关键不是记住更多 API，而是持续回答四个问题：

1. 这段组件在哪台机器上运行？
2. 它是在构建时还是请求时渲染？
3. 哪些结果应该被缓存，缓存多久？
4. 数据发生变化后，哪些缓存需要失效？

---

## 二、文件系统不是目录约定，而是一棵路由树

App Router 使用 `app/` 目录描述路由。文件夹对应 URL 段，`page.tsx` 决定该段是否可以访问：

```text
app/
├─ page.tsx                  → /
├─ about/
│  └─ page.tsx              → /about
└─ blog/
   ├─ page.tsx              → /blog
   └─ [slug]/
      └─ page.tsx           → /blog/:slug
```

只有文件夹而没有 `page.tsx`，不会自动产生一个可访问页面。这意味着目录既是代码组织方式，也是 URL 结构本身。

### 1. `layout`：持久的共享外壳

`layout.tsx` 会包裹同级和更深层的页面。在同一个 layout 覆盖范围内导航时，layout 会被复用，而不是重新挂载。

```tsx
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="dashboard">
      <Sidebar />
      <main>{children}</main>
    </div>
  )
}
```

从 `/dashboard/orders` 切换到 `/dashboard/settings` 时，`Sidebar` 所在的 layout 不会被卸载。它的滚动位置、输入框内容和组件状态都可以保留。

如果希望每次导航都重新挂载共享外壳，可以使用 `template.tsx`。两者的核心区别不是写法，而是生命周期：

- `layout`：复用已有实例；
- `template`：每次导航创建新实例。

### 2. 动态段与路由组

常见动态段包括：

- `[id]`：单个动态参数；
- `[...slug]`：捕获一个或多个路径段；
- `[[...slug]]`：可选的捕获路径；
- `(group)`：只用于组织目录，不进入 URL。

例如：

```text
app/(shop)/cart/page.tsx → /cart
```

`(shop)` 可以用来组织代码或共享 layout，但不会出现在最终地址中。

### 3. 特殊文件把状态变成路由约定

App Router 把常见页面状态做成了特殊文件：

- `loading.tsx`：当前路由段加载时的占位内容；
- `error.tsx`：当前路由段的错误边界；
- `not-found.tsx`：404 页面；
- `default.tsx`：平行路由无法恢复状态时的默认内容。

其中，`loading.tsx` 本质上是框架自动插入的 `<Suspense fallback={...}>`。它不仅提供加载界面，也为后续的流式渲染建立边界。

平行路由 `@slot` 适合在同一个页面中并排渲染多棵独立子树；拦截路由则适合“列表中打开弹窗，但刷新或分享 URL 时显示完整详情页”这类场景。

---

## 三、Server Component 是默认值，`'use client'` 是边界

在 App Router 中，没有特殊声明的组件默认都是 Server Component：

```tsx
// app/products/[id]/page.tsx
import { db } from '@/lib/db'
import { AddToCart } from './add-to-cart'

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const product = await db.product.find(id)

  return (
    <main>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <AddToCart productId={product.id} />
    </main>
  )
}
```

这个组件可以直接访问数据库，也可以写成 `async` 函数。它的代码不会进入浏览器 bundle。

需要交互的部分再单独声明为 Client Component：

```tsx
'use client'

import { useState } from 'react'

export function AddToCart({ productId }: { productId: string }) {
  const [count, setCount] = useState(1)

  return (
    <button onClick={() => setCount(value => value + 1)}>
      加入购物车（{count} 件）
    </button>
  )
}
```

### 1. `'use client'` 不是单个组件的标签

`'use client'` 声明的是一个**模块入口**。从这个文件开始，它直接或间接 import 的模块都会成为客户端依赖，进入浏览器 bundle。

所以不要在页面顶层随手加 `'use client'`。如果顶层组件引入了大型 Markdown 渲染器、图表库或大量展示组件，这些本可留在服务器上的代码，也会被一起推入客户端。

更好的策略是：

> **把客户端边界尽量下沉，只包住最小的交互岛。**

例如商品详情、评论内容、推荐列表都可以由服务器渲染，只有数量选择器、收藏按钮和购物车弹窗需要进入浏览器。

### 2. 服务端传递的是 UI 描述，不是函数闭包

Server Component 渲染后，React 会向浏览器发送 RSC payload。它描述组件树、元素、props 以及客户端组件引用，但不会把服务器内存里的函数闭包传过去。

这带来两个硬约束：

- 传给 Client Component 的 props 必须可序列化；
- 普通函数不能从服务端跨边界传到客户端。

因此，下面这种写法不成立：

```tsx
<ClientButton onClick={() => db.order.create(...)} />
```

函数既不能安全序列化，也不能在浏览器中访问服务器的数据库连接。跨边界执行写操作，应该使用后文的 Server Action。

### 3. 用 `children` 组合，而不是把所有内容客户端化

有时我们需要一个 Client Component 提供交互外壳，但外壳中的内容仍希望留在服务器。此时可以使用 `children`：

```tsx
// Client Component：只管理展开与收起
'use client'

export function Modal({ children }: { children: React.ReactNode }) {
  // 本地状态和事件逻辑省略
  return <div className="modal">{children}</div>
}
```

```tsx
// Server Component
export default async function Page() {
  const article = await getArticle()

  return (
    <Modal>
      <ArticleContent article={article} />
    </Modal>
  )
}
```

`Modal` 是客户端外壳，`ArticleContent` 仍可在服务端完成取数和渲染。可以把它理解为：客户端组件预留了一个“洞”，服务端把已经生成的内容填进去。

---

## 四、不要把“运行位置”和“渲染时机”混为一谈

Server / Client 回答的是：**代码在哪台机器上运行？**

Static / Dynamic 回答的是：**服务端渲染在什么时候发生？**

这是两条互相独立的轴。

### 1. 静态渲染

如果页面不依赖当前请求的信息，它可以在构建时或重新验证时渲染一次，然后被多个请求复用。

适合的内容包括：

- 营销页；
- 文档和博客；
- 变化不频繁的商品描述；
- 对所有访问者相同的公开内容。

静态产物可以进入 CDN 或服务端路由缓存，请求命中时几乎不需要重新计算。

### 2. 动态渲染

一旦组件读取只有当前请求到来后才存在的信息，就需要在请求时渲染，例如：

- `cookies()`；
- `headers()`；
- `searchParams`；
- 用户身份和个性化数据；
- 不能缓存或必须实时读取的数据。

需要特别注意动态信号的位置。在根 layout 顶层读取 cookie，可能会让它覆盖的整棵路由树都无法保持静态。

反过来，如果只有顶部问候语依赖 cookie，应该把读取 cookie 的逻辑下沉到独立组件中，而不是放在页面顶层。

### 3. `<Suspense>` 让页面不再被最慢查询绑架

假设页面包含：

- 50ms 返回的标题；
- 600ms 返回的通知；
- 2s 返回的统计报表。

如果在页面顶层等待所有数据，即使使用 `Promise.all`，首屏依然要等待最慢的 2 秒。`Promise.all` 只能消除串行瀑布，不能让父组件在 Promise 完成前产出 JSX。

更合理的做法是让慢数据位于独立的异步子组件，并分别建立 Suspense 边界：

```tsx
import { Suspense } from 'react'

export default async function Dashboard() {
  const title = await getTitle()

  return (
    <main>
      <h1>{title}</h1>

      <Suspense fallback={<NotificationsSkeleton />}>
        <Notifications />
      </Suspense>

      <Suspense fallback={<ReportSkeleton />}>
        <SlowReport />
      </Suspense>
    </main>
  )
}
```

页面会先发送标题和两个骨架，通知与报表准备好后分别流式补入。两块慢内容互不等待，谁先完成谁先显示。

这就是 Partial Prerendering / Cache Components 所表达的页面形态：

```text
静态外壳 + 动态洞 + 流式填充
```

---

## 五、数据获取下沉到组件，但要警惕瀑布

Server Component 可以在真正需要数据的位置直接 `await`：

```tsx
export async function ProductSummary({ id }: { id: string }) {
  const product = await getProduct(id)
  return <h2>{product.name}</h2>
}
```

这消除了 Pages Router 中“页面顶层取完所有数据，再逐层传 props”的限制，也避免为了服务自己的网站而额外维护一层内部 API。

### 1. 独立查询应该并行

连续 `await` 会形成请求瀑布：

```tsx
const user = await getUser()
const menu = await getMenu()
```

如果两个查询互不依赖，应同时发起：

```tsx
const [user, menu] = await Promise.all([
  getUser(),
  getMenu(),
])
```

串行只应该用于真实的数据依赖，例如第二个查询必须使用第一个查询的结果。

### 2. Request Memoization 负责单次渲染内去重

layout 和 page 可能都需要当前用户。与其为了避免重复查询而把用户对象层层传递，不如让两个组件都调用同一个数据函数，并使用请求记忆化去重。

- 相同的 `fetch` 可以在一次渲染中自动去重；
- ORM 或数据库函数可以用 React 的 `cache()` 包装；
- 这类记忆化只在当前渲染中有效，请求结束后即消失。

```tsx
import { cache } from 'react'

export const getCurrentUser = cache(async () => {
  return db.user.findCurrent()
})
```

这里的目标不是跨用户、跨请求缓存，而是避免同一次组件树渲染中重复执行相同查询。

---

## 六、缓存不是一个开关，而是四个不同层次

讨论“Next.js 缓存”前，必须先明确在说哪一层。

| 层次 | 缓存内容 | 生命周期 | 位置 |
| --- | --- | --- | --- |
| Request Memoization | 同一次渲染中的相同请求 | 当前渲染结束即清除 | 服务端内存 |
| Data Cache | 数据请求或缓存函数的返回值 | 跨请求持久，按策略失效 | 服务端持久层 |
| Full Route Cache | 路由的 HTML 与 RSC payload | 构建后持续到重新验证 | 服务端 |
| Router Cache | 已访问路由的 RSC payload | 当前浏览器会话内短期存在 | 浏览器内存 |

这四层解决的是不同问题：

- Request Memoization 防止一次渲染里重复查询；
- Data Cache 防止跨请求重复获取相同数据；
- Full Route Cache 复用静态路由产物；
- Router Cache 让客户端前进、后退和已访问页面导航更快。

### 1. 为什么老教程里的缓存结论经常互相矛盾

原始资料梳理了三代默认行为：

- Next.js 14：`fetch` 倾向于默认缓存；
- Next.js 15：默认转向不缓存；
- Next.js 16：通过 Cache Components 和 `'use cache'` 强调显式缓存。

这次变化的核心，是从“默认很快但可能意外读到旧数据”，转向“默认保持正确，需要性能优化时显式声明”。

因此，阅读旧教程时不要只抄 `fetch` 选项，要先确认它针对的是哪个 Next.js 版本。

### 2. 显式声明缓存

在资料所采用的 Next.js 16 模型中，可以使用 `'use cache'`、`cacheLife` 和 `cacheTag` 描述缓存策略：

```tsx
import { cacheLife, cacheTag } from 'next/cache'

export async function getProduct(id: string) {
  'use cache'

  cacheLife('hours')
  cacheTag(`product-${id}`)

  const response = await fetch(
    `https://api.example.com/products/${id}`
  )

  return response.json()
}
```

三者分别回答：

- `'use cache'`：这段结果是否跨请求复用；
- `cacheLife`：结果可以存活多久；
- `cacheTag`：未来通过什么标签精确失效。

### 3. 写入和失效必须成对出现

修改数据库不会自动刷新缓存。写入后通常需要选择一种失效方式：

- `revalidateTag`：按业务标签精确失效；
- `revalidatePath`：按页面路径失效；
- `updateTag`：需要“写完立即读到自己刚写的数据”时使用。

可以把它记成一个简单公式：

```text
一次完整写操作 = 权限校验 + 数据写入 + 缓存失效
```

只写数据库而不处理缓存，是“数据库已经更新，页面仍然显示旧内容”的最常见原因之一。

---

## 七、Server Action：从 UI 直接调用服务端写操作

普通函数不能跨越 Server / Client 边界，但 Server Action 是框架为写操作提供的受控入口。

```tsx
// app/todos/actions.ts
'use server'

import { revalidateTag } from 'next/cache'
import { db } from '@/lib/db'

export async function createTodo(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()

  if (!title) {
    throw new Error('标题不能为空')
  }

  const session = await requireSession()

  await db.todo.create({
    title,
    userId: session.userId,
  })

  revalidateTag('todos', 'max')
}
```

客户端拿到的并不是函数本体，而是一个可以触发服务端 POST 请求的引用。因此，它既保留了函数式调用体验，也没有把数据库代码发送到浏览器。

Server Action 很适合：

- 提交表单；
- 保存草稿；
- 点赞、收藏；
- 修改个人资料；
- 由当前网站 UI 发起的内部写操作。

### 安全上要把它当作公开端点

Server Action 不是“只有自己的按钮才能调用”的私有函数。它在网络层面仍是可被请求的服务端入口，因此必须：

1. 校验输入，而不是依赖 TypeScript 类型；
2. 校验用户是否登录；
3. 校验用户是否有权操作当前这条数据；
4. 不信任从客户端传来的对象 ID；
5. 写入完成后使相关缓存失效。

“已登录”只解决认证，“能否修改这篇文章”才是授权。忽略对象级授权，仍然可能产生越权漏洞。

### Server Action 和 Route Handler 怎么选

判断标准可以简化为“谁来触发”：

| 场景 | 选择 |
| --- | --- |
| 用户在当前网站提交表单、点赞、保存 | Server Action |
| Stripe、GitHub 等第三方发送 webhook | Route Handler |
| 移动端或其他系统调用公开 API | Route Handler |
| 需要精确控制状态码、响应头和 HTTP 缓存 | Route Handler |

Server Action 面向自己应用中的 UI；Route Handler 面向通用 HTTP 客户端。前者减少样板代码并支持渐进增强，后者提供完整的 HTTP 控制能力。

---

## 八、一个完整页面应该如何拆分

以商品详情页为例，可以按下面的方式决策：

### 保持在服务器上的部分

- 商品标题和描述；
- 商品详情 Markdown；
- SEO 内容；
- 数据库查询；
- 权限检查；
- 推荐算法的服务端调用。

### 进入客户端的交互岛

- 数量选择器；
- 加入购物车按钮；
- 收藏状态；
- 图片轮播的手势交互；
- 本地弹窗和临时 UI 状态。

### 渲染策略

- 标题、描述：静态或长时间缓存；
- 价格、库存：短缓存或请求时读取；
- 个性化推荐：动态渲染；
- 每块慢内容：独立 Suspense 边界；
- 首屏：先发送静态外壳和骨架；
- 后续：价格、库存和推荐结果流式补入。

### 写操作

- “加入购物车”：Server Action；
- action 内重新校验用户和商品；
- 写入购物车数据；
- 对购物车 tag 或路径执行失效；
- 客户端可以配合 `useOptimistic` 先更新 UI，失败时回退。

这套拆分让页面既不必整体客户端化，也不必在“整页静态”和“整页动态”之间二选一。

---

## 九、最常见的六个误区

### 误区 1：有一点交互，就给整个页面加 `'use client'`

后果是大量展示组件、数据处理库和第三方依赖进入浏览器 bundle。正确做法是把交互拆成尽可能小的客户端岛。

### 误区 2：Server Component 等于静态页面

Server Component 只说明运行位置在服务器。它既可以构建时渲染，也可以每次请求动态渲染。

### 误区 3：`Promise.all` 可以解决所有首屏阻塞

它只能让查询并发。如果父组件仍要等待最慢 Promise 才返回 JSX，首屏仍会被阻塞。要提前显示页面，需要把慢任务下沉到 Suspense 子树。

### 误区 4：把 cookie 读取放在根 layout

这会扩大动态渲染范围。请求相关逻辑应该尽量下沉到真正需要它的组件。

### 误区 5：写完数据库，页面自然会更新

数据源和缓存是两套状态。写完后必须显式使相关 tag 或 path 失效。

### 误区 6：Server Action 是可信的内部函数

它仍然是网络入口。输入验证、认证和对象级授权一个都不能少。

---

## 十、一套可复用的决策清单

面对一个新组件或新需求时，可以按以下顺序判断：

### 1. 是否需要浏览器能力？

- 需要 `useState`、事件、DOM、`window`：Client Component；
- 不需要：保持 Server Component。

### 2. 是否依赖当前请求？

- 依赖 cookie、header、查询参数或用户身份：动态；
- 不依赖：优先静态或缓存。

### 3. 是否有慢数据？

- 相互独立：并行请求；
- 不影响首屏：下沉到异步子组件；
- 每块完成时间不同：分别建立 Suspense 边界。

### 4. 是否值得跨请求缓存？

- 值得：明确缓存生命周期和 tag；
- 不值得或必须实时：保持动态读取；
- 不要把“单次渲染去重”和“跨请求缓存”混为一谈。

### 5. 谁触发写操作？

- 当前网站中的用户 UI：Server Action；
- 外部机器或公开 HTTP 客户端：Route Handler。

### 6. 写完以后什么会变旧？

- 某类业务数据：按 tag 失效；
- 某个页面产物：按 path 失效；
- 当前用户必须立即看到新值：考虑 read-your-writes 策略。

---

## 结语

App Router 并不是把 React 组件搬到服务器那么简单。它真正提供的是一套新的组合方式：

- 用文件系统描述路由树；
- 用 Server Component 降低浏览器 JavaScript 成本；
- 用 `'use client'` 划出最小交互岛；
- 用异步组件把数据获取下沉到使用位置；
- 用 `<Suspense>` 把页面拆成可独立流式返回的区域；
- 用显式缓存平衡性能与数据新鲜度；
- 用 Server Action 完成 UI 驱动的写操作；
- 用缓存失效保证写入后的最终一致性。

最终，最重要的问题不再是“这个页面属于 SSR、SSG 还是 CSR”，而是：

> **哪些代码必须进入浏览器，哪些内容可以提前计算，哪些数据需要请求时获取，以及这些边界应该落在组件树的什么位置。**

一旦能够沿着这四个问题拆分页面，App Router 的路由、渲染、数据、缓存和变更机制就不再是互相独立的知识点，而会收敛成同一套可推导的系统。
