---
title: 把 FastAPI 当作一台机器拆开：从类型注解到请求生命周期
description: 从类型注解、Pydantic、依赖注入与 async 并发模型出发，沿 Uvicorn、ASGI、Starlette 到 FastAPI，追踪一次请求的完整生命周期。
date: 2026-10-06
tags: FastAPI, Python, 后端工程
featured: true
---

# 把 FastAPI 当作一台机器拆开：从类型注解到一次请求的完整生命周期

> FastAPI 真正值得学习的，并不只是“几行代码就能写出一个接口”，而是它如何把 Python 类型系统、Pydantic、依赖注入和 ASGI 串成一条完整的运行链。

很多 FastAPI 教程从下面这段代码开始：

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id}
```

代码很短，也确实能跑。但如果只停在“装饰器绑定路由、函数返回字典”这一层，就很难回答几个真正影响工程质量的问题：

- 为什么字符串形式的路径参数会自动变成 `int`？
- 为什么请求字段缺失时，业务函数还没执行就返回了 422？
- 为什么 `response_model` 能挡住敏感字段，却不能代替鉴权？
- 为什么普通 `def` 有时比 `async def` 更适合调用同步库？
- 数据库连接由 `yield` 依赖创建后，究竟由谁关闭？

要回答这些问题，最好的办法不是继续背 API，而是把 FastAPI 当作一台机器拆开。

---

## 一、先抓住主轴：类型注解不是提示，而是运行时规约

在普通 Python 代码中，类型注解经常只被理解为编辑器提示：

```python
def add(x: int, y: int) -> int:
    return x + y
```

Python 本身不会因为调用 `add("1", "2")` 就自动拒绝执行。但在 FastAPI 中，类型注解会被框架主动读取，并参与运行时行为。

例如：

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float

@app.put("/items/{item_id}")
def update_item(
    item_id: int,
    q: str | None = None,
    item: Item | None = None,
):
    return {"item_id": item_id, "q": q, "item": item}
```

FastAPI 会从“参数名 + 类型注解 + 默认值”中推断参数来源：

- `item_id` 的名字出现在 `/items/{item_id}` 中，所以它是**路径参数**；
- `q` 是普通标量，名字不在路径模板中，所以它是**查询参数**；
- `item` 是 Pydantic 模型，所以它来自**请求体**；
- 参数有没有默认值，则参与决定它是必填还是可选。

这套默认推断也可以用 `Path()`、`Query()`、`Body()` 等显式声明覆盖。

更重要的是，同一份类型信息会被复用到多个方向：

1. **输入校验**：值是否合法；
2. **类型转换**：把 URL 中的字符串 `"5"` 转成整数 `5`；
3. **响应序列化**：把模型或对象转成可发送的数据；
4. **OpenAPI 文档**：自动生成接口参数和数据结构；
5. **编辑器与静态检查**：提供补全和类型提示。

因此，FastAPI 的核心并不是“自动生成文档”，而是：

> **用一份 Python 类型声明，同时驱动校验、转换、序列化、依赖解析与接口文档。**

没有另一份需要人工同步的 schema，函数签名本身就是接口契约。

---

## 二、Path Operation：路由注册发生在请求到来之前

`@app.get()`、`@app.post()` 这类装饰器，FastAPI 官方称为 **path operation decorator**；被装饰的函数是 **path operation function**；二者共同组成一个 **path operation**。

关键点在于：装饰器是在模块被导入时执行的，而不是每次请求到达后才执行。

```python
@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id}
```

程序加载这段代码时，框架大致会完成两件事：

1. 把 `GET + /items/{item_id}` 与 `read_item` 登记进路由表；
2. 通过 `inspect.signature()` 读取函数参数、类型注解和默认值。

所以，当第一个请求真正到达时，框架通常不需要重新理解这段函数签名，而是直接使用启动阶段已经准备好的路由和参数规则。

这反映出 FastAPI 中一个很重要的性能设计：

> **把解析和编译的成本前移到定义期或启动期，换取请求热路径上的低开销。**

Pydantic v2 也采用了相同的思路。

---

## 三、Pydantic：请求进来走校验器，响应出去走序列化器

Pydantic 模型用类字段描述结构化数据：

```python
from pydantic import BaseModel, Field

class ItemIn(BaseModel):
    name: str
    price: float = Field(gt=0)

class ItemOut(BaseModel):
    id: int
    name: str
    price: float
```

在 Pydantic v2 中，模型定义会生成 core schema，并由 `pydantic-core` 准备两个方向不同的核心对象：

- `SchemaValidator`：负责“外部输入 → 合法的 Python/Pydantic 对象”；
- `SchemaSerializer`：负责“Python/Pydantic 对象 → 可输出的数据”。

这意味着请求和响应虽然都使用模型，但它们不是同一个动作的正反执行：

```text
请求 JSON
   ↓
SchemaValidator
   ↓
业务函数拿到 ItemIn 实例
   ↓
业务函数返回对象
   ↓
SchemaSerializer
   ↓
JSON 响应
```

绝大多数内置约束可以在已经准备好的核心校验路径中执行。如果大量字段都依赖 Python 自定义校验器，运行过程就需要多次回调 Python，性能优势会相应下降。因此，能用 `Field(gt=0)`、字符串长度、枚举等内置约束表达的规则，通常不必急着写自定义校验函数。

### 422 为什么发生在业务函数之前？

假设客户端发送：

```json
{"name": "book"}
```

而 `price` 是必填字段。FastAPI 会先把请求数据交给 `ItemIn` 的校验器；校验失败后直接构造 422 响应，根本不会调用业务函数。

因此，如果你把日志写在函数体第一行，输入校验失败时连这条日志都不会出现。因为函数不是“执行后报错”，而是“尚未获得执行资格”。

---

## 四、`response_model`：它是输出边界，不是权限系统

数据库对象通常包含比客户端应该看到的更多字段。例如：

```python
class UserOut(BaseModel):
    id: int
    name: str

@app.get("/users/{user_id}", response_model=UserOut)
def read_user(user_id: int):
    return {
        "id": user_id,
        "name": "Ada",
        "password_hash": "$2b$12$xxxxx",
        "internal_notes": "only for operators",
    }
```

响应发出前，返回值会经过 `UserOut` 对应的序列化规则。未在模型中声明的 `password_hash` 和 `internal_notes` 不会进入最终 JSON：

```json
{"id": 7, "name": "Ada"}
```

这为 API 建立了一道明确的输出边界，也能减少“把 ORM 对象原样返回”造成的数据泄漏风险。

但必须区分两个概念：

- `response_model` 回答的是：**哪些字段可以出门？**
- 鉴权回答的是：**当前调用者有没有资格访问这条数据？**

所以它是输出过滤和响应契约，不是访问控制。用户身份解析、角色判断、资源权限校验等工作，仍然应该由依赖或业务逻辑完成。

还有一个容易记反的区别：

- 请求数据不符合模型：通常是客户端输入问题，返回 422；
- 服务端返回值缺少响应模型的必填字段：通常是服务端没有兑现自己的契约，应视为服务端错误。

---

## 五、把 FastAPI 放回它真正所在的分层中

一个 FastAPI 应用并不是一个独立完成所有工作的整体。更准确的结构是：

```text
你的业务函数
    ↑
FastAPI
类型读取、输入校验、依赖注入、响应序列化、OpenAPI
    ↑
Starlette
路由、Request/Response、中间件、WebSocket、线程池调度
    ↑
ASGI 协议
scope / receive / send
    ↑
Uvicorn 等 ASGI 服务器
监听 socket、解析 HTTP、驱动应用
    ↑
操作系统网络栈
```

### 1. Uvicorn 是服务器

它负责监听端口、读取 socket 字节、解析 HTTP，并调用上层 ASGI 应用。

### 2. ASGI 是服务器与应用之间的契约

一个最小的 ASGI 应用大致长这样：

```python
async def app(scope, receive, send):
    assert scope["type"] == "http"

    await receive()

    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [(b"content-type", b"text/plain")],
    })
    await send({
        "type": "http.response.body",
        "body": b"hello",
    })
```

三个参数的职责非常清楚：

- `scope`：连接和请求的元数据，例如类型、方法、路径、请求头；
- `receive`：异步拉取客户端发来的事件；
- `send`：把响应事件推送给服务器。

ASGI 的关键不是“它是异步的”这么简单，而是它采用了**消息传递**模型。应用可以多次调用 `send`，也可以多次等待 `receive`。这为流式响应、SSE 和 WebSocket 提供了自然的协议基础。

### 3. Starlette 是 ASGI 应用骨架

路由、请求对象、响应对象、中间件、WebSocket，以及把同步函数放进线程池的能力，主要来自 Starlette。

### 4. FastAPI 是类型驱动的端点封装

FastAPI 在 Starlette 的每个端点外面增加了一层处理：

```text
读取签名 → 提取参数 → 解析依赖 → 校验输入
→ 调用函数 → 校验/过滤输出 → 生成文档
```

理解这个边界很有用：遇到路由匹配、中间件或 `Request` 行为问题时，应更多查看 Starlette；遇到模型校验、`Depends`、响应模型或 OpenAPI 问题时，再回到 FastAPI。

---

## 六、一次请求的七个阶段

现在把静态分层变成动态流程。一次典型请求会经历下面几个阶段：

### 阶段 1：服务器接收字节

Uvicorn 从 socket 读取 HTTP 数据，解析并准备 `scope`、`receive` 和 `send`，随后调用 ASGI 应用。

### 阶段 2：Starlette 完成路由匹配

框架根据 HTTP 方法和路径查找对应的 path operation。没有匹配项时返回 404。

### 阶段 3：解析依赖图

FastAPI 处理端点声明的 `Depends`：先准备子依赖，再准备父依赖，并复用当前请求中已经计算过的依赖结果。

### 阶段 4：提取参数并执行 Pydantic 校验

框架从 path、query、header、cookie 和 body 中取值，完成类型转换与校验。如果失败，就在这里生成错误响应，业务函数不会执行。

### 阶段 5：执行你的函数

通过前置校验后，函数拿到的已经是类型正确的 Python 对象。至于函数运行在事件循环还是线程池，则取决于它是 `async def` 还是普通 `def`。

### 阶段 6：序列化和过滤响应

函数返回值根据返回类型或 `response_model` 进行校验、过滤和序列化，转换为可发送的响应内容。

### 阶段 7：通过 `send` 发出响应

响应状态、响应头和响应体被转换为 ASGI 事件并交给服务器，最终写回客户端。

### 收尾：清理依赖资源

`yield` 依赖注册的清理动作由退出栈统一管理。资源会按后进先出顺序释放；如果是流式响应，资源生命周期还需要考虑流何时真正结束。

这条链最值得记住的顺序是：

```text
依赖解析 → 输入校验 → 业务函数 → 响应序列化 → 资源清理
```

输入校验在函数之前，响应序列化在函数之后，依赖清理则位于生命周期的收尾阶段。

---

## 七、`Depends` 不是简单的“先调用一个函数”

现代 FastAPI 代码通常使用 `Annotated` 声明依赖：

```python
from collections.abc import Iterator
from typing import Annotated
from fastapi import Depends


def get_db() -> Iterator["Connection"]:
    db = open_connection()
    try:
        yield db
    finally:
        db.close()


DB = Annotated["Connection", Depends(get_db)]

@app.get("/items")
def list_items(db: DB):
    return db.query("select * from items")
```

框架拿到的不是 `get_db()` 的执行结果，而是尚未调用的函数对象 `get_db`。它会继续检查这个函数的签名：如果 `get_db` 自己也有依赖，就递归向下读取，最终形成一张依赖图。

### 1. 解析顺序：先子后父

如果处理函数依赖 A，A 又依赖 C，那么 C 必须先准备好，A 才能执行：

```text
C → A → handler
```

这是典型的深度优先解析。

### 2. 默认是每请求缓存

同一个依赖在一次请求中被多处引用时，默认通常只执行一次，然后共享结果。这非常适合“当前用户”“数据库会话”这类请求级资源。

但如果依赖的语义是“每次调用都要生成新值”，例如生成一次性随机数，就要留意缓存行为，并按需要设置 `use_cache=False`。

### 3. `yield` 负责 setup 与 cleanup

`yield` 之前是资源准备，`yield` 出去的是注入值，`yield` 之后是清理逻辑。

多个资源按栈管理，释放顺序与创建顺序相反：

```text
创建：C → A → B
清理：B → A → C
```

这种 LIFO 顺序可以保证父依赖开始清理时，它所依赖的底层资源仍然可用。即使业务函数抛出异常，`finally` 中的清理逻辑也仍有机会执行。

---

## 八、最容易写错的地方：`async def` 并不自动更快

ASGI 服务通常由单线程事件循环调度大量协程。它的高并发能力来自一个前提：任务在等待 I/O 时主动让出控制权。

FastAPI 对两类路由采用不同策略：

- `async def`：直接运行在事件循环线程上；
- 普通 `def`：由框架放入工作线程池执行。

因此，下面的代码是危险的：

```python
import time

@app.get("/bad")
async def bad():
    time.sleep(10)  # 同步阻塞，没有 await 让出控制权
    return {"ok": True}
```

`time.sleep(10)` 会占住事件循环所在的线程。在这十秒内，其他连接也可能无法得到正常调度。

如果使用真正的异步等待，应写成：

```python
import asyncio

@app.get("/good")
async def good():
    await asyncio.sleep(10)
    return {"ok": True}
```

而如果业务必须调用同步数据库驱动、同步 SDK 或其他阻塞库，普通 `def` 路由往往更稳妥，因为阻塞发生在线程池工作线程中，而不是事件循环线程中：

```python
@app.get("/sync-library")
def call_sync_library():
    return blocking_sdk.fetch()
```

可以用一条简单规则判断：

- 调用链是原生异步的，并且会正确 `await`：使用 `async def`；
- 调用链主要是同步阻塞库：优先使用普通 `def`，或显式把阻塞工作移出事件循环；
- 工作是 CPU 密集计算：不要指望 async 解决，应考虑进程池、任务队列或独立计算服务。

所以，真正的问题不是“同步还是异步谁更先进”，而是：

> **阻塞代码最终运行在哪个线程上，它是否会阻止事件循环继续调度其他连接？**

---

## 九、什么时候应该选 FastAPI，什么时候不必

FastAPI 的价值与接口中“结构化契约”的密度成正比。

### 适合 FastAPI 的场景

- 以 JSON API 为主；
- 请求和响应有清晰的数据结构；
- 希望自动获得校验和 OpenAPI 文档；
- 需要依赖注入组织鉴权、数据库会话和公共参数；
- 服务包含大量网络、数据库等 I/O 等待；
- 需要流式响应、SSE 或 WebSocket。

### 可能更适合其他方案的场景

- **只是做极薄的请求转发**：若不需要校验、DI 和自动文档，直接使用 Starlette 会更轻；
- **需要成熟的管理后台、ORM 和完整站点能力**：Django 往往更省集成成本；
- **小型同步服务或重模板渲染**：Flask 仍然简单直接；
- **CPU 密集任务**：重点应是进程池、任务队列和计算架构，而不是换一个 Web 框架。

框架基准测试也不应成为唯一选型依据。真实系统的大部分延迟往往来自数据库、下游网络、鉴权和业务逻辑。FastAPI 更有价值的地方，是它在高并发 I/O 场景中的调度模型，以及类型驱动开发带来的契约一致性，而不是某个“Hello World 每秒请求数”。

---

## 十、把所有机制重新串成一条时间线

设想下面这个端点：

```python
@app.post("/items", response_model=ItemOut)
async def create_item(
    item: ItemIn,
    user: Annotated["User", Depends(get_current_user)],
    db: DB,
):
    record = await save_item(db, item, user)
    return record
```

它背后发生的事情可以分成两个时间段。

### 导入与定义阶段

1. path operation 装饰器登记路由；
2. `inspect.signature()` 读取函数签名；
3. `item` 被识别为请求体，`user` 和 `db` 被识别为依赖；
4. Pydantic 为 `ItemIn`、`ItemOut` 准备校验和序列化结构；
5. FastAPI 根据依赖声明建立依赖关系；
6. OpenAPI schema 可以从这些声明中生成。

### 请求阶段

1. Uvicorn 接收并解析 HTTP；
2. Starlette 匹配路由；
3. FastAPI 解析 `get_current_user`、`get_db` 等依赖；
4. 请求体经过 `ItemIn` 校验，不合法则直接返回 422；
5. `create_item` 在事件循环上执行，并在 `await` 时让出控制权；
6. 返回值经过 `ItemOut` 过滤和序列化；
7. 响应通过 ASGI `send` 发出；
8. 退出栈按逆序释放依赖资源。

至此可以看到，类型系统、Pydantic、依赖图和异步调度并不是四个彼此孤立的功能。它们通过函数签名连接在一起，共同参与同一次请求。

这也是 FastAPI 最值得学习、同时最需要保持警惕的地方：

> 改动一行类型声明，可能同时改变参数来源、必填规则、校验行为、依赖解析、响应结构和接口文档。便利与耦合，本来就是同一枚硬币的两面。

---

## 结语

如果只从表面看，FastAPI 像是一个“用装饰器写接口”的轻量框架；把机器拆开后，它其实是一套分层协作系统：

- Uvicorn 负责网络与 HTTP；
- ASGI 定义服务器和应用之间的消息协议；
- Starlette 提供路由、请求响应对象、中间件和调度骨架；
- FastAPI 读取类型与依赖声明，建立端点契约；
- Pydantic 负责输入校验和输出序列化；
- 你的函数只在所有前置条件通过后执行。

真正理解 FastAPI，不是记住更多装饰器，而是能在脑中追踪一条请求：它从 socket 字节进入，在哪里匹配路由，在哪里解析依赖，在哪里被校验，业务函数运行在哪个执行环境中，返回值又如何被过滤并发送出去。

当这条链变得清晰，422、响应字段泄漏、依赖缓存、连接清理和事件循环阻塞就不再是零散的“框架坑”，而只是这台机器在不同层暴露出的可解释行为。

---

## 延伸阅读

- [FastAPI 官方文档](https://fastapi.tiangolo.com/)
- [FastAPI：并发与 async/await](https://fastapi.tiangolo.com/async/)
- [FastAPI：依赖项与 yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/)
- [Pydantic v2 架构](https://docs.pydantic.dev/latest/internals/architecture/)
- [Starlette 官方文档](https://www.starlette.io/)
- [ASGI Specification](https://asgi.readthedocs.io/en/latest/specs/main.html)
