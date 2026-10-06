# 工具调用（Tool Use）：从协议到 Agent 自主行为

> 工具调用不是“把一个 Python 函数塞进大模型”。模型不会触碰数据库、天气 API、文件系统或浏览器；它只生成一份结构化的调用请求，然后停下来。真正执行工具、回填结果、决定是否继续循环的，是模型外部的运行时程序——也就是常说的 harness。

本文根据本地《工具调用 Tool Use · Agent 教程》的起点、核心概念、协议机制、Agent 编排循环、工具设计与自测内容整理而成。重点不是背某一家 SDK，而是建立一套跨模型、跨框架都能迁移的心智模型。

> **资料边界**：原教程的生态信息整理截至 **2026 年 6 月**。涉及 MCP、Responses API、Programmatic Tool Calling 等生态内容时，描述的是教程记录的时间截面，不把它宣称为本文写作日的最新产品清单。

---

## 一、最重要的认知反转：模型其实没有“调用”工具

“工具调用”这个名字很容易让人形成一种错误想象：

```python
answer = model.call(get_weather, city="Shanghai")
```

仿佛模型进程里握着一个函数指针，可以直接执行代码。

实际控制流完全不同：

```text
用户提出任务
    ↓
应用把工具定义交给模型
    ↓
模型生成：“请调用 get_weather，参数是 {city: Shanghai}”
    ↓
模型停止生成，把控制权交还给应用
    ↓
应用校验参数、检查权限、真正调用天气服务
    ↓
应用把执行结果作为 tool_result 放回上下文
    ↓
模型读取结果，决定继续调用工具或生成最终答案
```

模型能接触到的，只有上下文中的 token。数据库里的记录、服务器上的文件、浏览器当前页面以及第三方 API 的响应，如果没有被外部程序转成消息放进上下文，对模型来说都不存在。

因此，更准确的说法不是：

> 模型执行了 `get_weather`。

而是：

> 模型请求调用 `get_weather`，harness 执行工具，并把结果回填给模型。

这个区别看起来只是措辞，实际上决定了整个 Agent 系统的责任边界：

- **模型负责概率性决策**：要不要调用、调用哪个、参数填什么、拿到结果后下一步做什么；
- **harness 负责确定性控制**：能不能调用、怎样执行、是否并发、何时超时、如何重试、何时终止；
- **工具负责真实副作用**：查数据、写文件、发消息、退款、创建工单；
- **安全系统负责约束权限**：鉴权、审批、沙箱、审计、额度与幂等。

理解了这层分工，工具调用、Agent loop、MCP、computer use 和“模型写代码调工具”就不再是互不相关的名词，而是同一条控制链上的不同组件。

---

## 二、一次工具调用的五个角色

一次完整往返可以拆成五个固定角色。

### 1. 工具定义

应用先告诉模型“有哪些能力可用”。一个工具定义通常包含：

- `name`：模型用于选择和引用工具；
- `description`：工具做什么、何时使用、何时不要使用；
- 参数 schema：参数名、类型、必填项、枚举与格式约束。

例如：

```json
{
  "name": "get_weather",
  "description": "查询指定城市的当前天气。仅在用户询问实时天气时使用；不要用于历史天气或气候统计。",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "城市名，例如 Shanghai"
      }
    },
    "required": ["location"],
    "additionalProperties": false
  }
}
```

这不是给后端工程师看的普通接口文档，而是模型决策时会读取的提示词。工具定义会被序列化进上下文，模型根据这些文字预测下一步应该输出普通文本，还是输出某个工具调用。

### 2. 模型决策

模型读取用户问题、对话历史和工具定义，判断：

- 是否需要外部信息；
- 哪个工具最匹配；
- 参数应从用户问题中如何抽取；
- 是否可以在同一轮请求多个独立工具。

这个过程不是传统路由器中的确定性 `if-else`，而是一次概率生成。即使提供了计算器工具，模型面对简单乘法时也可能直接回答；即使 schema 完全合法，模型也可能选错工具或填入语义错误的值。

### 3. 调用请求与停机

模型产生结构化调用请求后会停止当前轮生成。例如在一种常见协议形状中：

```json
{
  "role": "assistant",
  "stop_reason": "tool_use",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01A",
      "name": "get_weather",
      "input": {
        "location": "Shanghai"
      }
    }
  ]
}
```

这里最关键的不是字段名，而是控制权发生了转移：模型已经停机，正在等待调用结果。

### 4. harness 执行

应用程序收到请求后，至少要做这些工作：

1. 根据名称找到工具实现；
2. 再次校验参数，而不是盲信模型输出；
3. 检查用户权限和业务策略；
4. 设置超时、重试、限流和取消机制；
5. 执行真实 API、数据库或系统操作；
6. 把结果转换成适合模型阅读的返回值。

所有真正的 I/O 与副作用都发生在这里。

### 5. 结果回填

执行完成后，harness 把结果连同调用 ID 放回对话：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A",
      "content": "上海当前 24°C，多云",
      "is_error": false
    }
  ]
}
```

模型只有在这一步之后才“知道”天气。它不是直接看到了 API 响应，而是读到了被放进上下文的结果 token。

如果 harness 收到调用请求后忘记回填，系统就会表现为一直转圈：模型已经停下，工具结果却永远没有回来，没有任何一方会自动推进下一轮。

---

## 三、协议层到底在约定什么

不同厂商的字段名不同，但都在表达三个核心对象：

1. **工具声明**：有哪些工具、参数是什么；
2. **调用请求**：模型想调用什么、参数是什么；
3. **调用结果**：外部程序执行后返回了什么。

可以把协议理解为模型与运行时之间的“中断协议”：模型输出结构化请求并中断，运行时完成工作后恢复对话。

### Anthropic 与 OpenAI 的常见字段差异

| 概念 | Anthropic 风格 | OpenAI Chat Completions 风格 |
|---|---|---|
| 模型调用请求 | `tool_use` 内容块 | `tool_calls[]` |
| 返回工具结果 | `tool_result` 内容块 | `role: "tool"` 消息 |
| 请求与结果关联 | `tool_use_id` | `tool_call_id` |
| 调用参数 | `input`，通常已是对象 | `function.arguments`，常见为 JSON 字符串 |
| 调用停止信号 | `stop_reason: "tool_use"` | `finish_reason: "tool_calls"` |
| 参数 schema | `input_schema` | `function.parameters` |

跨厂商迁移时最容易踩的坑，是把字段相似误认为数据形状相同。例如某些 OpenAI 接口中的 `arguments` 是字符串，需要先反序列化：

```python
arguments = json.loads(tool_call["function"]["arguments"])
```

无论使用哪家接口，都必须坚持同一条原则：**协议对象只是请求，不是已执行的函数返回值。**

### 调用 ID 为什么不能丢

一次回复可能包含多个调用。调用 ID 用来建立严格配对：

```text
tool request A ───── result A
tool request B ───── result B
```

做上下文裁剪、消息压缩或并行执行时，如果删除了请求却保留结果、回填了错误 ID，或者破坏了协议要求的消息顺序，就可能得到 API 错误，或更危险的结果错配。

因此，对话历史不是可以随意删行的日志。凡是仍位于有效上下文中的调用，都要维护完整的请求—结果配对。

---

## 四、`tool_choice`：允许调用、强制调用与指定调用不是一回事

常见工具选择策略可以归纳为四类：

| 策略 | 语义 |
|---|---|
| `auto` | 模型自行决定是否调用、调用哪个 |
| `any` / `required` | 本轮必须调用至少一个工具，但由模型选择具体工具 |
| 指定工具 | 本轮必须调用给定名称的工具 |
| `none` | 禁止调用工具，只能生成普通回复 |

容易混淆的是：

> “必须调用工具”不等于“必须调用我心里想的那个工具”。

当工具列表中同时存在 `search_orders`、`get_order` 和 `refund_order` 时，`required` 只是禁止模型直接回答，并没有替你完成路由。如果业务流程明确要求先查订单，就应指定工具，或干脆由代码确定性地执行前置步骤，而不是把已知流程重新交给模型猜。

这也揭示了 Agent 设计中的一条边界：

- **需要开放判断的地方交给模型**；
- **已经确定的流程交给普通代码**。

不要为了“更 Agent”而把每个 `if-else` 都改成一次模型调用。

---

## 五、并行调用与流式调用

### 5.1 一个回合可以请求多个工具

如果用户问“比较上海和北京现在的天气”，模型可以在同一个回复里生成两个调用：

```json
[
  {
    "id": "call_shanghai",
    "name": "get_weather",
    "input": {"location": "Shanghai"}
  },
  {
    "id": "call_beijing",
    "name": "get_weather",
    "input": {"location": "Beijing"}
  }
]
```

harness 可以并发执行它们，再按各自 ID 回填结果。这样节省的是墙钟时间，而不是模型推理步骤本身。

但“同一轮返回多个调用”不代表它们天然适合并发。判断标准是：

- 是否存在数据依赖；
- 是否要求确定的先后顺序；
- 是否读写同一份可变状态；
- 是否可能产生互相冲突的副作用。

查两个城市天气彼此独立，可以并行；“查询库存”和“按库存下单”存在依赖且共享库存状态，必须串行。最难排查的并发错误往往不是程序崩溃，而是程序正常运行，却在旧状态上做出了错误决策。

### 5.2 流式参数不能过早执行

在流式响应中，工具参数通常按增量片段到达：

```text
{"location": "Sh
anghai"}
```

中间状态既可能不是合法 JSON，也可能尚未表达完整意图。正确做法是：

1. 按调用 ID 累积参数片段；
2. 等待该工具调用块结束；
3. 解析完整 JSON；
4. 做 schema 与业务校验；
5. 最后才允许执行。

不要为了抢几十毫秒，在参数尚未完整时触发有副作用的操作。

---

## 六、深一层：模型是怎样“生成”工具调用的

从模型内部看，生成一个工具请求与生成一句自然语言没有本质差别：都是逐 token 预测。

工具定义被放入上下文；模型经过工具调用轨迹的后训练，学会在合适的时候生成特定结构；服务端再把对应 token 解析成 API 返回的 `tool_use` 或 `tool_calls` 对象。

因此，下面三件事必须分开理解：

1. **格式合法**：输出能否被解析，是否符合 JSON Schema；
2. **工具正确**：模型是否选择了真正适合任务的工具；
3. **参数正确**：参数值是否与用户意图、当前状态和业务约束一致。

约束解码可以大幅帮助第一件事。其思路是把 schema 编译成语法或状态机，在每一步采样时屏蔽不合法的下一个 token，使模型只能生成满足结构约束的内容。

但它不能自动解决后两件事。例如 schema 只能保证：

```json
{"location": "New York"}
```

中的 `location` 是字符串，却不能保证用户问上海时模型没有错填成纽约。这类输出是 **valid but wrong**：结构正确，语义错误。

所以，结构化输出不是可靠性的终点。生产系统仍需要：

- 更清晰的工具描述；
- 业务规则校验；
- 权限与范围检查；
- 高风险操作前的二次确认；
- 对工具选择和参数正确率的评测。

---

## 七、从单次 Tool Use 到 Agent：只差一个循环

单次工具调用只是“带工具的一问一答”。把它放进循环，系统才具有多步自主行为：

```python
messages = [{"role": "user", "content": user_input}]

for step in range(MAX_ITERATIONS):
    response = call_model(messages=messages, tools=tool_definitions)
    messages.append(as_assistant_message(response))

    calls = extract_tool_calls(response)
    if not calls:
        return extract_final_answer(response)

    results = []
    for call in calls:
        result = execute_safely(call)
        results.append(to_tool_result(call.id, result))

    messages.append(as_tool_results_message(results))

raise AgentLimitError("超过最大执行轮数")
```

循环的每一轮，模型只做一件事：读取当前上下文并生成下一步。

- 如果生成普通答案，循环结束；
- 如果生成工具请求，模型停机；
- harness 执行并回填；
- 下一轮模型根据新结果继续规划。

这正是 Agent 的最小骨架：

```text
Observe → Decide → Act → Observe → Decide → Act → ... → Answer
```

### ReAct 与原生工具调用的关系

ReAct 通过提示词让模型交替输出 `Thought → Action → Observation`，再由外部程序解析文本中的动作。原生 function calling / tool use 延续了相同控制循环，但把“Action”从需要正则解析的自由文本，变成了训练过的结构化协议。

所以，原生工具调用不是消灭了 ReAct 的思想，而是把脆弱的文本动作接口升级成了可校验的数据结构。

---

## 八、谁决定 Agent “做完了”

一个常见误解是：模型最终会自己意识到任务已经完成。

模型能做的是在当前上下文下预测“下一步还要不要调用工具”。这不等于它能可靠地判断整个业务任务已经安全、完整地结束。任务级终止必须由 harness 设置确定性护栏。

至少应具备以下 guard：

### 1. 最大轮数

```python
MAX_ITERATIONS = 12
```

无论模型是否还想继续，到达上限都必须停机。这是最基本的成本保险丝。

### 2. 最大执行时间

为整次任务设置 deadline，而不只是给单个 HTTP 请求设置 timeout。否则十几个“都没有超时”的慢步骤仍可能把总延迟拖到不可接受。

### 3. 重复调用检测

对工具名和规范化参数做指纹：

```text
hash(tool_name + canonical_json(arguments))
```

如果同一调用连续出现多次且状态没有变化，应判定为原地打转，而不是继续烧 token。

### 4. 无进展检测

不能只看调用是否重复。有时模型会不断改写参数，但业务状态没有推进。可以记录：

- 已完成的子目标数；
- 状态版本号；
- 新增证据或新数据量；
- 错误类型是否发生变化。

若连续若干轮没有有效进展，应停止、降级或请求人工介入。

### 5. 成本与调用配额

轮数不是成本的完整代理。一次返回上万条记录的搜索，比多个轻量调用更昂贵。生产系统应同时限制：

- 模型 token；
- 工具调用次数；
- 外部 API 费用；
- 单次与累计返回体积；
- 高风险副作用次数。

### 6. 业务完成条件

如果任务有可验证的完成状态，应由代码检查。例如退款任务不应以“模型说已退款”为准，而应读取支付系统中的退款状态和交易号。

结论很简单：**模型提出结束建议，harness 判定是否真的结束。**

---

## 九、错误恢复：把错误写给模型，而不是把日志扔给模型

工具失败后，harness 通常有三种选择：

1. 确定性重试，例如网络瞬断；
2. 把可修复错误回填给模型，让它调整参数；
3. 对不可恢复错误立即终止或转人工。

适合回填给模型的错误应当简短、结构化、可行动：

```json
{
  "is_error": true,
  "error_code": "INVALID_STATUS",
  "message": "status 不合法，可选值为 active、archived。请修改参数后重试。",
  "retryable": true
}
```

不适合直接回填的是整段 stack trace：

```text
Traceback (most recent call last):
  File "/srv/app/internal/..."
  ...
KeyError: 'status'
```

后者有三个问题：

- 混入大量对决策无帮助的 token；
- 泄露内部路径、代码结构或敏感信息；
- 模型知道“哪里炸了”，却不一定知道“下一步应怎样修”。

工程上最好把错误分成两份：

- **日志版本**：给开发者，包含堆栈、请求 ID、下游响应；
- **模型版本**：给 Agent，只包含错误类型、可恢复性、合法取值和建议动作。

还要避免“双重重试”：HTTP 客户端重试三次、工具层重试三次、Agent 又重试三轮，最坏会把一次失败放大成 27 次真实请求。重试策略必须分层设计，并共享总预算。

---

## 十、工具设计：真正决定 Agent 上限的地方

同一个模型、同一套循环，换一组工具定义，效果可能相差巨大。因为模型并不了解工具内部实现；它只能根据名称、描述、schema 和返回值做预测。

### 10.1 description 不是注释，而是路由提示词

一个高质量描述至少回答四个问题：

1. **做什么**：功能和业务对象是什么；
2. **何时使用**：哪些用户意图应选择它；
3. **何时不要使用**：与相似工具的边界；
4. **参数与结果约定**：格式、单位、时间范围和不返回的内容。

较差的定义：

```json
{
  "name": "get_data",
  "description": "获取数据"
}
```

较好的定义：

```json
{
  "name": "search_active_orders",
  "description": "按客户名称或订单号搜索当前未关闭订单。用户要查在途、待付款或处理中订单时使用；查询已归档订单请使用 search_archived_orders。默认只返回最多 20 条摘要，不返回支付凭证或完整审计日志。"
}
```

当工具选择准确率低时，先改名称、描述和边界，通常比立刻换更大的模型更值得。

### 10.2 名称要明确且互斥

避免：

```text
get_data
fetch_info
query_item
```

更好：

```text
jira_search_issues
asana_search_tasks
crm_get_customer
```

当多个系统都提供 `search` 时，namespace 能同时帮助模型消歧和工程师读日志。

### 10.3 用参数形状做防错设计

不要只在描述里提醒模型“小心”，而应让错误尽量无法表达。

- 有限取值使用 `enum`，不要放任自由字符串；
- 路径要求绝对路径，避免依赖不可见的当前工作目录；
- 时间明确时区和格式；
- ID 与名称使用不同字段，不要都叫 `user`；
- 必填字段写进 `required`；
- 不接受未知字段时设置 `additionalProperties: false`；
- 复杂操作拆出 `dry_run` 或确认令牌。

例如，退款原因只有三个合法类别，就应明确枚举：

```json
{
  "reason": {
    "type": "string",
    "enum": ["duplicate", "customer_request", "service_failure"]
  }
}
```

这类设计常被称为 poka-yoke，也就是从接口形状上减少误用。

### 10.4 返回值要高信号、低噪声

工具结果会进入上下文，并在后续轮次被反复携带。返回值设计直接影响：

- 模型能否做出正确后续判断；
- 上下文长度与 token 成本；
- 模型是否会抄错底层 ID；
- Agent 是否更容易收敛。

推荐做法：

- 默认分页、过滤和截断；
- 优先返回语义字段，而不是所有内部字段；
- 提供 `concise` / `detailed` 等详略模式；
- 明确 `has_more`、`next_cursor` 等继续读取信号；
- 对大文档返回摘要和引用句柄，不直接倾倒全文；
- 让结果结构稳定，避免同一工具时而字符串、时而对象。

一个搜索工具的简洁返回可以是：

```json
{
  "items": [
    {
      "order_id": "O-20261006-18",
      "customer_name": "张三",
      "status": "awaiting_payment",
      "total": 299.0,
      "currency": "CNY"
    }
  ],
  "has_more": false
}
```

而不是把数据库行的数十个内部字段、二进制元数据和调试状态码全部塞回上下文。

### 10.5 少而高层的工具，通常优于大量薄包装

如果把每个后端端点都暴露给模型，模型既要理解业务，又要自己拼装底层工作流，错误面会迅速扩大。

例如，与其提供：

```text
find_availability
create_event
add_attendees
reserve_room
send_invitation
```

不如在业务规则稳定时提供一个更高层的：

```text
schedule_meeting
```

由确定性代码完成查空闲、订会议室、创建日程和发邀请。当然，高层工具也不能无限膨胀成“万能工具”；关键是把**稳定流程封装进代码，把真正需要判断的分支留给模型**。

### 10.6 副作用工具要比查询工具更严格

查询失败通常只是体验问题，写操作失败可能造成真实损失。对发邮件、删除文件、下单、退款、部署等工具，至少考虑：

- 权限是否与当前用户一致；
- 是否需要人工确认；
- 是否支持幂等键；
- 是否先执行 `dry_run`；
- 是否记录审计日志；
- 是否限制金额、收件人、路径和资源范围；
- 重复执行是否安全；
- 工具结果能否证明操作确实完成。

永远不要把“模型生成了调用”当成授权本身。

---

## 十一、为什么多步 Agent 会越来越贵

每轮模型调用通常都需要重新读取系统提示、工具定义和越来越长的对话历史。假设 Agent 已经执行了十步，第十一步往往还要带上前十步的请求与结果。

因此，多步 Agent 的成本不只是“每轮生成了多少 token”，还包括反复预填充旧上下文的成本。可以把它粗略理解为：

```text
总输入成本 ≈ 第 1 轮上下文 + 第 2 轮上下文 + ... + 第 N 轮上下文
```

一份巨大的工具返回不仅贵一次，还会在之后的每一轮继续占据上下文。

降低成本的常用手段包括：

1. 缩短工具描述，但不牺牲边界信息；
2. 只加载当前任务需要的工具；
3. 工具返回默认使用摘要、分页和过滤；
4. 把大对象外置，只向模型返回句柄和必要证据；
5. 用代码完成固定的数据转换、聚合和排序；
6. 对历史做结构化压缩，但保持调用—结果配对；
7. 尽量减少无意义轮次和重复失败；
8. 对可预先确定的调用使用普通 workflow 或批处理。

成本优化和可靠性优化往往是同一件事：上下文越短、工具越少、边界越清晰，模型越容易做对选择。

---

## 十二、MCP 与工具生态：改变的是接入方式，不是基本循环

### 12.1 MCP 解决 M×N 集成问题

假设有 M 个 Agent 应用和 N 个工具或数据源。没有统一协议时，每个应用都要分别对接每个工具，集成关系接近 M×N。

MCP 的思路是：

- 工具或数据源实现一次 MCP server；
- Agent 应用实现一次 MCP client；
- 双方通过统一协议发现能力、读取资源和调用工具。

于是集成工作更接近 M+N：

```text
多个 Agent Client  ── MCP ── 多个 Tool / Data Server
```

按照原教程截至 2026 年 6 月的整理，MCP 包含 client、server 和 transport 三个基本部分，常见传输包括本地进程使用的 stdio，以及网络场景使用的 Streamable HTTP。

但必须明确：MCP 标准化的是“怎样接入工具与上下文”，并没有取消工具调用的基本责任边界。模型仍然只是提出请求，宿主应用仍要负责权限、执行、超时、结果回填和终止条件。

### 12.2 工具搜索：从一次性全量加载到按需加载

当系统拥有几十或上百个工具时，把所有 schema 都塞进上下文会带来两个问题：

- 工具定义本身消耗大量 token；
- 相似描述变多，模型更难选准。

按需工具搜索的方向，是先给模型少量元能力，让它根据任务发现并加载相关工具，而不是在任务开始时展示全部工具。这相当于把“工具列表”从静态 prompt 变成可检索目录。

### 12.3 模型写代码调工具：减少中间结果穿越上下文

传统工具循环是：

```text
模型生成调用 A → 执行 A → 结果回模型
模型生成调用 B → 执行 B → 结果回模型
模型生成调用 C → 执行 C → 结果回模型
```

如果 A、B、C 只是固定的数据处理步骤，每次都穿过模型非常浪费。Programmatic Tool Calling / Code Execution 类方案让模型先生成一段受控代码，在沙箱中完成多个调用、过滤和聚合，只把最终需要的结果带回模型：

```text
模型生成程序 → 沙箱内部执行 A/B/C → 只回传最终摘要
```

它优化的是 round-trip、上下文膨胀和 re-prefill 成本，但同时带来新的安全要求：

- 沙箱隔离；
- 网络与文件权限；
- CPU、内存与执行时间限制；
- 可调用工具白名单；
- 输出大小限制；
- 完整审计。

### 12.4 Computer Use 仍是工具调用

截图、点击、键盘输入看起来像一种全新的 Agent 能力，底层仍可以还原成同一个循环：

1. 环境工具返回截图或可访问性树；
2. 模型请求点击、输入或滚动；
3. harness 执行动作；
4. 新页面状态被再次回填；
5. 循环直到完成或触发 guard。

不同之处在于 GUI 环境更不稳定：坐标会漂移、页面会变化、动作副作用更难撤销。因此 computer use 比普通只读 API 更需要状态校验、截图证据、可逆操作和人工确认。

---

## 十三、一个更接近生产的 Agent Loop

下面的伪代码把协议、执行、安全和终止放在一起：

```python
from dataclasses import dataclass
from time import monotonic

@dataclass
class Budget:
    max_steps: int = 12
    max_seconds: int = 90
    max_tool_calls: int = 30
    max_same_call: int = 3


def run_agent(user_input, model, tool_registry, budget=Budget()):
    started_at = monotonic()
    messages = [{"role": "user", "content": user_input}]
    call_counts = {}
    total_tool_calls = 0

    for step in range(budget.max_steps):
        if monotonic() - started_at > budget.max_seconds:
            return fail("AGENT_TIMEOUT", "任务超过总执行时间")

        response = model.generate(
            messages=messages,
            tools=tool_registry.definitions_for(user_input),
        )
        messages.append(response.as_message())

        calls = response.tool_calls
        if not calls:
            if verify_completion(response, messages):
                return response.final_text
            return fail("INCOMPLETE", "模型停止调用工具，但业务完成条件未满足")

        if not dependencies_allow_parallel(calls):
            calls = order_by_dependency(calls)

        tool_results = []
        for call in calls:
            total_tool_calls += 1
            if total_tool_calls > budget.max_tool_calls:
                return fail("TOOL_BUDGET_EXCEEDED", "工具调用次数超过预算")

            args = validate_schema(call.name, call.arguments)
            authorize(user_input, call.name, args)

            fingerprint = canonical_fingerprint(call.name, args)
            call_counts[fingerprint] = call_counts.get(fingerprint, 0) + 1
            if call_counts[fingerprint] > budget.max_same_call:
                return fail("REPEATED_CALL", "检测到重复调用且没有进展")

            try:
                result = tool_registry.execute(
                    call.name,
                    args,
                    timeout=remaining_time(started_at, budget.max_seconds),
                )
                safe_result = normalize_and_truncate(result)
                tool_results.append(success_result(call.id, safe_result))
            except RetryableToolError as error:
                tool_results.append(model_readable_error(call.id, error))
            except FatalToolError as error:
                return fail(error.code, error.public_message)

        messages.append(tool_results_message(tool_results))

    return fail("MAX_STEPS", "达到最大 Agent 轮数")
```

这段代码传达的重点不是某个 SDK 的写法，而是控制顺序：

```text
生成调用
→ 验证 schema
→ 鉴权
→ 检查预算与重复
→ 判断并发关系
→ 执行
→ 规范化结果
→ 回填
→ 验证是否完成
```

模型不能跳过其中任何一道确定性控制。

---

## 十四、常见故障与排查顺序

### 故障 1：模型从不调用工具

优先检查：

1. 工具描述是否明确写了使用场景；
2. 工具名称是否含糊；
3. 用户问题是否真的需要实时或私有信息；
4. `tool_choice` 是否禁止或仅允许自动选择；
5. 工具 schema 是否过于复杂；
6. 是否应由代码直接指定必需工具。

不要第一时间换模型。

### 故障 2：模型总选错工具

重点检查工具之间的职责重叠：

```text
search_data / get_data / find_info
```

这类名称几乎是在要求模型猜。重命名、增加“何时不要用”、合并重复能力，通常比增加更多提示词有效。

### 故障 3：参数 JSON 合法，但业务值错误

这是典型的 valid but wrong。schema 和约束解码无法解决全部语义错误，需要：

- 参数描述更明确；
- enum、格式和范围约束；
- 业务校验；
- 从可信状态中解析 ID，不让模型自由编造；
- 高风险操作前向用户确认。

### 故障 4：Agent 反复调用同一工具

检查：

- 是否有最大轮数；
- 是否有调用指纹和重复检测；
- 工具错误是否告诉模型怎样修；
- 返回结果是否缺少“已经完成”的状态；
- 工具是否看似成功、实际没有改变状态。

### 故障 5：API 报调用结果无法配对

打印实际发送给模型的完整消息序列，逐个验证：

- 每个 request ID 是否有且只有一个对应 result；
- result 是否出现在协议允许的位置；
- 上下文裁剪是否留下孤立结果；
- 并行回填是否混用了 ID；
- 重试模型请求时是否重复追加了旧结果。

### 故障 6：Agent 越跑越慢、越来越贵

同时检查两个方向：

- **轮数问题**：是否重复调用、缺少终止条件；
- **体积问题**：单次工具返回是否过大、工具定义是否全量加载。

二者会互相放大：大结果让后续判断更困难，判断困难又导致更多轮次。

### 故障 7：工具明明成功，最终答案却说失败

可能原因包括：

- 返回字段语义不清；
- 工具返回的是内部状态码，模型无法解释；
- 成功结果被截断；
- 多个并行结果发生错配；
- 后续错误覆盖了先前成功状态。

工具结果应明确给出 `status`、关键业务标识和可读摘要，必要时由 harness 直接验证完成状态。

---

## 十五、什么时候不该使用 Agent Tool Loop

Tool Use 很强，但不是每个任务都需要自主循环。

### 更适合普通代码的情况

- 流程固定，没有开放决策；
- 每一步依赖明确；
- 输入输出可以完全结构化；
- 错误处理规则已知；
- 高频、低价值、对成本敏感。

例如：

```text
读取 CSV → 校验字段 → 转换日期 → 写入数据库
```

这是一条确定性数据管道，不需要模型每一步决定接下来做什么。

### 更适合 workflow + 少量模型节点的情况

- 大部分流程固定，少数节点需要分类、抽取或生成；
- 必须保证审计和可重复性；
- 需要在特定节点人工审批。

### 更适合 Agent loop 的情况

- 用户目标明确，但完成路径不能预先穷举；
- 需要根据中间结果动态选择下一步；
- 工具之间存在开放式组合；
- 任务价值足以覆盖额外 token、延迟和失败面。

一个成熟系统通常不是“全 Agent”或“全 workflow”，而是二者组合：确定性骨架包住概率性决策点。

---

## 十六、上线前检查清单

### 工具定义

- [ ] 名称清晰、稳定、与其他工具不重叠；
- [ ] 描述写明“做什么、何时用、何时不要用”；
- [ ] 参数含义、格式、单位、时区和范围明确；
- [ ] 有限值使用 enum；
- [ ] 必填项和可选项准确；
- [ ] 默认拒绝未知字段或有明确处理策略。

### 工具执行

- [ ] 参数在服务端重新校验；
- [ ] 权限基于真实用户身份检查；
- [ ] 有超时、取消、限流和总预算；
- [ ] 写操作支持幂等或去重；
- [ ] 高风险副作用有审批或二次确认；
- [ ] 日志不会把敏感内容直接回填给模型。

### 结果与错误

- [ ] 默认返回高信号摘要；
- [ ] 大结果支持过滤、分页、截断和句柄；
- [ ] 错误包含类型、可恢复性、合法取值与建议动作；
- [ ] 请求与结果 ID 严格配对；
- [ ] 并行结果不会错配；
- [ ] 上下文裁剪保留协议完整性。

### Agent 循环

- [ ] 设置最大轮数；
- [ ] 设置总执行时间；
- [ ] 设置工具调用与 token 预算；
- [ ] 检测重复调用和无进展；
- [ ] 区分可重试与不可重试错误；
- [ ] 有确定性的业务完成条件；
- [ ] 失败时有降级、人工接管或安全退出路径。

### 评测与可观测性

- [ ] 分别统计工具选择准确率和参数准确率；
- [ ] 记录每轮决策、耗时、调用成本与结果体积；
- [ ] 覆盖正常、歧义、错误、超时和恶意输入；
- [ ] 对副作用工具做回放隔离或模拟测试；
- [ ] 能追踪一次任务中每个调用的 request ID、tool ID 和业务 ID。

---

## 十七、最后用六句话记住 Tool Use

1. **模型不执行工具，只生成调用请求。**
2. **工具请求出现时，模型已经停机，控制权回到 harness。**
3. **harness 负责执行、回填、权限、错误、预算与终止。**
4. **Agent 只是把“请求—执行—回填”放进一个受控循环。**
5. **JSON 合法不等于语义正确，schema 不能替代业务校验。**
6. **工具的名称、描述、参数形状和返回值，往往比框架选择更影响最终效果。**

工具调用真正重要的，不是让模型显得更“自主”，而是建立一个可控的边界：把开放式判断交给模型，把真实世界的执行权留在确定性系统中。

当这条边界被设计清楚，Agent 才不是一个会无限尝试的聊天机器人，而是一套能够被验证、被限制、被审计，也能在失败时安全停下来的软件系统。

