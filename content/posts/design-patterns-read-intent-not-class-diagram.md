---
title: 设计模式：学会读意图，而不是背类图
description: 用“封装变化”串起创建型、结构型与行为型模式，并用接口、控制权和变化轴区分那些类图几乎相同的模式。
date: 2026-10-06
tags: 设计模式, 软件设计, 面向对象, 架构
featured: true
---

很多人学习设计模式，是从 23 张 UML 类图开始的：记住有哪些角色、谁继承谁、谁持有谁，然后在面试前反复默写。

这种学习方式有一个绕不过去的问题：**许多设计模式的类图本来就很像，甚至完全一样。**

策略与状态，都是“上下文持有一个接口，再把工作委托给具体实现”；代理与装饰器，都实现和目标相同的接口，并在外面包一层；桥接与策略，也都是“一个对象持有另一个抽象”。如果只看结构，越学越容易混淆。

真正能区分它们的，不是“长什么样”，而是：

> **它想隔离哪一处变化？为了达到什么目的？谁拥有选择与切换的控制权？**

这篇文章把创建型、结构型和行为型模式放回同一条主线：**封装变化，识别意图，再决定是否值得引入模式。**

---

## 一、设计模式的地基：封装变化

先不谈模式名，从一个不断膨胀的折扣函数开始：

```text
function priceOf(order):
    total = sum(order.items)

    if order.customer.isVip:
        total = total * 0.85
    else if order.coupon == "SUMMER":
        total = total - 20
    else if order.isFirstOrder:
        total = total * 0.9

    return total
```

这段代码的问题不只是 `if-else` 很长，而是两类东西被焊在了一起：

- 稳定的计费骨架：汇总商品、计算总价、返回结果；
- 易变的折扣算法：VIP、优惠券、新客活动，以及未来还会出现的规则。

于是每增加一种折扣，都必须修改同一个函数；计费模块被迫知道全部业务规则；单测某条规则时，还要构造完整订单。

所谓**封装变化**，就是找到这处可预期的变化，把它隔离到一个稳定契约后面，使它可以独立增加、替换和测试，而不波及稳定部分。

它通常依赖两种机制。

### 1. 面向接口编程

稳定代码只依赖“它能做什么”，不依赖“它具体怎么做”。这里的接口不局限于某种语言的 `interface` 关键字，也可以是抽象类、函数类型，或者动态语言中的约定。

### 2. 组合优于继承

稳定对象通过持有另一个对象获得可变行为，而不是把行为锁进继承链。组合可以在运行时替换，也更容易自由搭配；继承通常在编译期确定，并把子类绑定到一条父类骨架上。

把折扣规则抽出去，就自然得到策略模式：

```text
interface DiscountStrategy:
    apply(total): number

class VipDiscount implements DiscountStrategy:
    apply(total): return total * 0.85

class SummerCoupon implements DiscountStrategy:
    apply(total): return total - 20

class Checkout:
    strategy: DiscountStrategy

    constructor(strategy):
        this.strategy = strategy

    priceOf(order):
        total = sum(order.items)
        return this.strategy.apply(total)
```

此时新增规则只需增加一个策略实现，计费骨架不再修改；每条规则也可以独立测试。

这里最值得记住的不是 `Strategy` 这个名字，而是它的意图：

> **把一族可互换的算法隔离出来，由外部在运行时选择。**

这句话比类图更有辨识度，因为后面会看到：状态、桥接与策略可能拥有相似结构，却在解决完全不同的问题。

---

## 二、先问“什么会变”，再谈模式分类

GoF 把模式分为创建型、结构型和行为型。与其把它们当三个需要背诵的目录，不如把它们看作三类变化：

| 分类 | 主要隔离的变化 | 首要问题 |
| --- | --- | --- |
| 创建型 | 对象怎么产生 | 谁决定创建哪个对象，怎样构造它？ |
| 结构型 | 对象如何连接、包装和组织 | 包这一层是为了翻译、增强、控制还是简化？ |
| 行为型 | 算法、状态和协作如何变化 | 谁选择行为，谁触发切换，消息如何传播？ |

这样学习的好处是：遇到真实代码时，不需要先猜模式名，而是先定位变化发生在哪一层。

---

## 三、创建型模式：隔离“对象怎么来”

创建型模式的共同出发点，是调用方不应该到处直接依赖具体类：

```text
function export(report, format):
    if format == "pdf":
        writer = new PdfWriter()
    else if format == "excel":
        writer = new ExcelWriter()
    else if format == "csv":
        writer = new CsvWriter()

    writer.write(report)
```

这里变化的是“实例化哪个 Writer”，稳定的是“拿到 Writer 后调用 `write`”。创建型家族都在隔离 `new`，但它们隔离的角度不同。

### 1. 简单工厂：先把散落的 `new` 收口

```text
function createWriter(format): Writer
    if format == "pdf": return new PdfWriter()
    if format == "excel": return new ExcelWriter()
    if format == "csv": return new CsvWriter()
    throw "unknown format"
```

简单工厂不是 GoF 23 个模式之一，但它是很有价值的重构：把多处重复的创建分支集中到一个地方，让调用方只认识产品接口。

它解决了“创建逻辑散落”，却没有真正解决开闭问题。新增产品仍需修改工厂里的分支。若产品种类很少、变化频率低，这往往已经够用；不要为了“更像设计模式”继续制造类。

### 2. 工厂方法：让子类决定造哪个产品

工厂方法把“选择具体类”的手段从条件分支换成了子类多态：

```text
interface Writer:
    write(report)

abstract class Exporter:
    abstract createWriter(): Writer

    export(report):
        writer = this.createWriter()
        writer.write(report)

class PdfExporter extends Exporter:
    createWriter(): return new PdfWriter()

class ExcelExporter extends Exporter:
    createWriter(): return new ExcelWriter()
```

它的意图是：

> **父类定义使用产品的稳定流程，把“创建哪个具体产品”延迟给子类。**

这也是一个重要例外：工厂方法没有使用组合，而是使用继承。它与模板方法同源——父类掌握骨架，在需要时回调子类提供的钩子。只不过这个钩子专门负责创建对象。

它买到的是扩展性：新增产品时增加新的创建者子类，不修改旧分支。代价是产品体系旁边又多出一套创建者体系，类数量可能翻倍。

因此，只有在以下场景中这笔成本才划算：

- 创建者父类确实有一段值得复用的稳定流程；
- 产品类型会持续增长；
- 希望外部扩展者通过增加子类接入，而不修改框架源码。

### 3. 抽象工厂：一次切换一整族产品

工厂方法通常关心一种产品的不同实现；抽象工厂关心的是一组必须配套的产品。

例如跨平台 UI 不只创建按钮，还要创建复选框和滚动条，并且同一界面里不能混用 Windows 按钮和 macOS 滚动条：

```text
interface UiFactory:
    createButton(): Button
    createCheckbox(): Checkbox
    createScrollbar(): Scrollbar

class WindowsFactory implements UiFactory:
    createButton(): return new WindowsButton()
    createCheckbox(): return new WindowsCheckbox()
    createScrollbar(): return new WindowsScrollbar()

class MacFactory implements UiFactory:
    createButton(): return new MacButton()
    createCheckbox(): return new MacCheckbox()
    createScrollbar(): return new MacScrollbar()
```

调用方持有一个工厂对象，所有产品都从同一个工厂实例产生。因此，“同族一致性”不是靠事后校验，而是被结构本身保证。

它的意图是：

> **创建一族彼此相关、需要保持一致的产品，并允许整族替换。**

它的典型代价也很明确：增加一个新产品族相对容易；增加一种新的产品类型却很贵，因为每个具体工厂都要增加对应方法。

### 4. 建造者：隔离复杂对象的构造过程

工厂主要回答“最终造哪个类”；建造者主要回答“一个复杂对象如何一步步组装”。

当构造函数出现大量可选参数时，代码很快会变成“望远镜构造函数”：

```text
new HttpRequest(url, "POST", null, 30000, true, false, null, retryPolicy)
```

这些裸值几乎无法阅读，也很难在构造过程中集中校验。建造者把每一步变成有名字的操作：

```text
request = new HttpRequestBuilder()
    .url("/orders")
    .method("POST")
    .timeout(30000)
    .retry(3)
    .build()
```

`build()` 是唯一出口，可以统一检查必填字段和约束，避免半成品对象泄漏。

它的意图是：

> **把分步构造过程与最终对象表示分开，让复杂配置可读、可校验、可复用。**

如果对象只有两三个必填参数，直接构造通常更诚实。没有复杂构造过程，就没有必要引入 Builder。

### 5. 单例：正确需求与有害机制被绑在了一起

“某个对象在应用中逻辑上只有一个”是合理需求，例如配置、注册表或连接池。但经典单例把两件事绑定在一起：

- 私有构造函数，阻止外部创建；
- 静态字段与静态访问器，允许全局获取。

```text
class Config:
    private constructor()
    private static instance = null

    static getInstance(): Config
        if Config.instance == null:
            Config.instance = new Config()
        return Config.instance
```

问题不在“只有一个实例”，而在“任何地方都可以静态取用”：

- 依赖关系不再出现在构造函数或方法签名中；
- 全局共享状态会跨测试用例残留；
- 调用方把 `getInstance()` 写死后，很难替换为 mock；
- 生命周期管理和业务代码纠缠在一起。

现代工程中，更常见的做法是由依赖注入容器管理单实例生命周期，再通过构造函数把它注入调用方。这样保留“唯一”的语义，却去掉了“隐藏的全局访问”。

所以学习单例时，最重要的不是会写双重检查锁，而是理解：

> **实例唯一与全局静态取用是两件事，前者可能合理，后者通常会制造隐式耦合。**

### 创建型模式的快速判断

| 问题 | 更可能的选择 |
| --- | --- |
| 只是把少量创建分支集中起来 | 简单工厂 |
| 让子类决定创建哪一种单个产品 | 工厂方法 |
| 一次创建并切换一整族配套产品 | 抽象工厂 |
| 一个复杂对象需要分步骤配置和校验 | 建造者 |
| 逻辑上只需一个实例 | 优先考虑 DI 生命周期，而非手写单例 |

---

## 四、结构型模式：同样是“包一层”，意图完全不同

结构型模式最容易靠类图学错，因为适配器、装饰器、代理和外观都可能表现为：外层对象持有内层对象，再把调用转发进去。

区分它们，可以固定问三个问题：

1. **外层接口与内层接口相同吗？**
2. **谁控制这一层的创建、组合与生命周期？**
3. **这一层的意图是翻译、增强、控制访问，还是简化？**

### 1. 适配器：把已有接口翻译成期望接口

系统统一使用 `PaymentGateway`，第三方 SDK 却提供完全不同的方法名、参数单位和返回类型：

```text
interface PaymentGateway:
    charge(amountInCents): Receipt

class StripeSDK:
    createCharge(dollars, currency): StripeResponse

class StripeAdapter implements PaymentGateway:
    sdk: StripeSDK

    charge(amountInCents):
        dollars = amountInCents / 100
        response = this.sdk.createCharge(dollars, "USD")
        return new Receipt(response.id, response.paidAmount)
```

适配器的关键是**接口改变了**。它对外说调用方理解的语言，对内翻译成被适配对象的语言。

它通常是事后补救：两边已经存在，又无法直接修改，只能增加一层翻译。若源头接口可以直接统一，修改源头往往比增加永久适配层更清楚。

### 2. 装饰器：在接口不变的前提下叠加职责

一个数据流可能按需增加压缩、加密、缓冲和计量。若用继承穷举所有组合，子类数量会迅速爆炸。

装饰器让每项职责成为一层独立外壳：

```text
interface DataSource:
    write(data)

class FileDataSource implements DataSource:
    write(data): saveToFile(data)

class CompressionDecorator implements DataSource:
    wrapped: DataSource

    write(data):
        wrapped.write(compress(data))

class EncryptionDecorator implements DataSource:
    wrapped: DataSource

    write(data):
        wrapped.write(encrypt(data))
```

客户端可以自由组合：

```text
source = new EncryptionDecorator(
    new CompressionDecorator(
        new FileDataSource()
    )
)
```

装饰器最核心的机制是：**实现同一接口，同时持有同接口对象。** 因为装饰器本身仍是 `DataSource`，它可以继续被下一层装饰。

它的意图是动态增加职责，而不是改变接口或控制访问。代价是包装层会遮住内部对象身份，调试堆栈、类型判断和对象相等性也会更复杂。

### 3. 代理：以相同接口控制对真实对象的访问

代理和装饰器结构极像：都实现相同接口，也都持有目标对象。区别在控制权与意图。

代理通常为了以下目的存在：

- 延迟创建昂贵对象；
- 把本地调用转成远程请求；
- 在调用前检查权限；
- 控制缓存、限流或访问频率。

```text
class LazyImageProxy implements Image:
    realImage = null
    fileName

    display():
        if realImage == null:
            realImage = new HighResolutionImage(fileName)
        realImage.display()
```

这里接口没有改变，但代理掌握真实对象何时创建、是否允许访问以及何时转发。

最锋利的区分方式是：

- 被包对象由客户端传入，并由客户端决定叠几层，通常是装饰器；
- 外层自己掌控真实对象的创建与生命周期，并决定能否访问，通常是代理。

### 4. 外观：给复杂子系统增加一个简单入口

外观不是把接口 A 翻译成既有接口 B，而是为一组复杂组件新造一个更简单的入口：

```text
class VideoConverter:
    convert(file, targetFormat):
        codec = CodecFactory.extract(file)
        buffer = BitrateReader.read(file, codec)
        result = BitrateReader.convert(buffer, codec)
        result = AudioMixer.fix(result)
        return new File(result)
```

调用方只需要调用 `convert`，不必了解编解码器、码率读取器和音轨处理器之间的协作顺序。

外观不会禁止高级调用方直接使用子系统。它只是增加一扇方便的门，而不是把其他门封死。

### 四个 wrapper 的决策表

| 模式 | 接口是否变化 | 核心意图 | 谁控制 |
| --- | --- | --- | --- |
| 适配器 | 变化为调用方已期望的接口 | 翻译不兼容接口 | 一次性连接两边 |
| 外观 | 新增一个更简单的接口 | 简化复杂子系统 | 外观编排子系统 |
| 代理 | 与真实对象相同 | 控制访问 | 代理掌握真身生命周期 |
| 装饰器 | 与原对象相同，但行为增强 | 动态增加职责 | 客户端决定组合与顺序 |

可以把判断顺序压缩为：

> **先问接口变没变。变了：期望接口是适配器，新造的简单接口是外观。没变：控制访问是代理，增加职责是装饰器。**

### 5. 桥接：拆开两条独立增长的维度

假设一个图形系统同时沿两个方向增长：

- 形状：圆、方形、三角形；
- 渲染后端：矢量、光栅、SVG。

若用继承穷举，会出现 `VectorCircle`、`RasterCircle`、`SvgCircle`、`VectorSquare` 等大量组合类。M 种形状与 N 种后端会产生 M×N 个组合。

桥接把两个维度拆成两套体系：

```text
interface Renderer:
    drawCircle(x, y, radius)

class VectorRenderer implements Renderer: ...
class RasterRenderer implements Renderer: ...

abstract class Shape:
    renderer: Renderer

class Circle extends Shape:
    draw():
        renderer.drawCircle(x, y, radius)
```

此时系统只需 M 个形状类与 N 个渲染类，规模从 M×N 变成 M+N。它的前提是两个维度真的正交，可以自由组合。如果大量组合本身非法，说明维度并不独立，强行桥接只会制造特判。

桥接与策略结构很像，但意图不同：

- 策略隔离一组可互换算法；
- 桥接拆开两条会各自增长的结构维度。

可以记成：**策略是换算法，桥接是让两条轴分别生长。**

### 6. 组合：用统一接口表达部分—整体树

文件与文件夹、组织与部门、UI 容器与控件，都具有“叶子与容器组成树”的结构。

组合模式让叶子与容器实现同一接口：

```text
interface Node:
    size(): number

class FileNode implements Node:
    bytes
    size(): return bytes

class FolderNode implements Node:
    children: Node[]

    size():
        total = 0
        for child in children:
            total += child.size()
        return total
```

客户端对任何节点都调用 `size()`，无需判断它是文件还是文件夹；递归由容器内部完成。

组合有一个有意接受的权衡：如果 `add`、`remove` 也放进统一接口，它们对叶子并没有意义，违反了接口隔离的直觉。但这样换来了客户端对叶子和容器的统一处理。

组合和装饰器也可能长得像，因为它们都递归持有同接口对象。区分方式是：

- 组合持有 N 个子节点并聚合结果，是多叉树；
- 装饰器只持有 1 个被包对象并增加职责，是退化成链的树。

---

## 五、行为型模式：关键在“谁选择、谁切换、谁通知”

行为型模式把算法、状态或协作关系从对象内部抽出来。这里最重要的不是“都使用委托”，而是控制权落在哪里。

### 1. 策略：外部选择一个可互换算法

策略的三个信号是：

- Context 把工作委托给策略；
- 客户端从外部选择策略；
- 各策略彼此不认识，也不会主动把 Context 换成另一个策略。

例如折扣、路由、排序、序列化与重试算法，都可能是策略。但在支持函数作为一等值的语言里，简单策略未必需要一族类，传入一个函数就能表达同样意图。

### 2. 状态：行为随内部状态变化，并由状态推动转移

订单会经历待支付、已支付、已发货。不同阶段下，相同操作有不同结果：

```text
interface OrderState:
    pay(order)
    ship(order)

class PendingState implements OrderState:
    pay(order):
        receiveMoney()
        order.setState(new PaidState())

    ship(order):
        throw "not paid"

class PaidState implements OrderState:
    pay(order):
        throw "already paid"

    ship(order):
        sendPackage()
        order.setState(new ShippedState())

class Order:
    state = new PendingState()

    pay(): state.pay(this)
    ship(): state.ship(this)
```

状态与策略的类图可以完全相同，但一个信号足以把它们分开：

> **当前实现会不会主动触发 Context 切换到下一个实现？**

- 不会，所有实现彼此独立，由外部选择：策略；
- 会，状态之间知道合法转移，并由当前状态推动切换：状态。

状态模式适合有明确生命周期、多个阶段以及复杂合法转移的对象。如果只有两三个简单状态，`enum` 加清晰的条件判断或模式匹配，往往更直接。状态类过多会导致类数量膨胀，转移规则也可能被分散到多个文件中。

### 3. 观察者：一个变化源向多个订阅者广播

观察者解决“一对多通知”：Subject 保存订阅者列表，状态变化时依次通知。

```text
interface Observer:
    update(event)

class Subject:
    observers: Observer[]

    subscribe(observer): observers.add(observer)
    unsubscribe(observer): observers.remove(observer)

    publish(event):
        for observer in observers:
            observer.update(event)
```

它的价值是发布者不必知道每个订阅者的具体类型，订阅者也可以动态加入和离开。

代价是控制流从直接调用变成隐式广播：谁会响应、响应顺序、异常如何处理、是否会重复订阅，都需要额外约定。在分布式事件系统里，还要继续面对重复投递、乱序和最终一致性，不能因为用了“观察者”这个名字就忽略可靠性问题。

观察者与中介者的区别在通信形态：

- 一个变化源单向通知多个响应方：观察者；
- 多个组件之间存在复杂的多对多协作，希望它们都只和中心对象通信：中介者。

### 4. 模板方法：父类锁定骨架，子类填写步骤

多个流程拥有相同顺序，只有部分步骤不同：

```text
abstract class ReportExporter:
    final export():
        open()
        writeHeader()
        writeBody()
        writeFooter()
        close()

    abstract writeBody()

class SalesReport extends ReportExporter:
    writeBody(): print("sales data")
```

父类掌握流程控制，在适当时机回调子类钩子，这就是“好莱坞原则”：不要主动调用框架，框架会调用你。

模板方法和策略都能改变算法，但改变方式相反：

| 维度 | 策略 | 模板方法 |
| --- | --- | --- |
| 隔离手段 | 组合 | 继承 |
| 替换对象 | 整个算法 | 算法中的若干步骤 |
| 替换时机 | 运行时 | 通常在编译期由子类确定 |
| 流程控制 | Context 委托策略 | 父类锁定顺序并回调子类 |

如果同一个 HTTP 客户端需要在运行时切换 Bearer Token、API Key 和匿名认证，策略更合适；如果流程骨架稳定，各子类只需要填一个固定步骤，模板方法更自然。

---

## 六、最容易混淆的模式，应该怎样辨析

### 1. 策略 vs 状态

两者结构近乎相同，真正的分界在切换权：

- 策略由客户端选择，实现之间互不知晓；
- 状态由对象内部演化，当前状态知道并推动下一次转移。

“巡逻、追击、逃跑”的敌人 AI，如果各模式会根据环境和生命值互相切换，更像状态；如果只是玩家在开局前选择“保守、激进、随机”三种固定算法，更像策略。

### 2. 装饰器 vs 代理

接口都不变，但目的和生命周期控制不同：

- 给数据流自由叠加压缩、加密、审计：装饰器；
- 权限检查、懒加载、远程调用、访问缓存：代理。

不要只凭“它加了缓存”就断言是装饰器。若缓存的目的是减少对昂贵真实对象的访问，它仍然属于访问控制语义，更接近缓存代理。

### 3. 适配器 vs 外观

两者都可能改变调用方看到的接口：

- 适配器把已有接口翻译为调用方早已需要的接口；
- 外观面向复杂子系统，新设计一个更简单的入口。

适配器强调兼容，外观强调易用。

### 4. 桥接 vs 策略

两者都是“对象持有接口并委托”：

- 一条行为轴上替换不同算法：策略；
- 两条正交维度需要分别扩展再自由组合：桥接。

如果变化是“发送算法可替换”，考虑策略；如果变化是“消息级别 × 发送渠道”两边都会持续增长，考虑桥接。

### 5. 组合 vs 装饰器

两者都可以递归嵌套：

- 一个节点持有多个孩子并聚合：组合；
- 一层只持有一个对象并增强：装饰器。

数一数子节点，再问是“表达部分—整体”还是“叠加职责”，通常就能分清。

### 6. 工厂方法 vs 抽象工厂

- 工厂方法：一个产品的不同实现，通常依靠继承延迟创建；
- 抽象工厂：一整族相关产品的不同版本，通常通过组合注入工厂对象。

当 UI 只创建一种按钮时，工厂方法可能足够；当按钮、复选框、菜单和滚动条必须整体切换风格时，才进入抽象工厂的意图范围。

---

## 七、设计模式不是目标：什么时候不该用

学完模式后最常见的副作用，是到处寻找模式。一个接口只有一个实现，也要叫 `Strategy`；一个对象只有三个参数，也要造 Builder；一个 `switch` 两年没变，也要拆成十几个工厂类。

这类代码形式上“符合模式”，设计上却没有回应真实变化。

### 1. 不存在变化，就不要提前制造间接层

模式应该回应已经出现或高度可预期的变化，而不是为所有可能性预铺脚手架。

判断一个抽象是否值得保留，可以问：

- 是否已经有第二种实现？
- 是否有明确需求表明它很快会变化？
- 每次变化是否真的会波及稳定代码？
- 这层间接是否降低了修改成本，还是只增加了跳转文件？

如果答案都是否定的，先用简单代码，等变化出现再重构。

### 2. 现代语言会压缩模式的代码形态

模式的意图仍然存在，但实现未必还需要一族类：

| 现代能力 | 可以简化的传统模式写法 |
| --- | --- |
| lambda、一等函数 | 简单策略、命令、模板钩子 |
| 内置迭代协议、生成器 | 迭代器 |
| 依赖注入容器 | 大量手写工厂与单例生命周期 |
| enum、sealed 类型、模式匹配 | 简单状态机 |

“被语言特性吸收”不等于模式失效。恰恰因为理解了模式意图，才知道一个 lambda 为什么能替代策略对象，也知道什么时候 lambda 已经不足以承载复杂状态和生命周期。

### 3. 先做最小重构，再决定是否升级为模式

面对一段 200 行的方法，正确答案可能只是：

- 提取几个有名字的函数；
- 消除重复；
- 把数据与行为放回正确模块；
- 让依赖通过参数显式传入。

只有当某处变化会以多种形态反复出现，并且已经开始影响稳定代码时，才值得把它升级为模式。

---

## 八、一套可落地的“读意图”流程

以后在代码评审或重构中，可以按下面的顺序判断。

### 第一步：圈出真正变化的地方

不要先说“这里该用工厂”，先说完整句子：

- 变化的是折扣算法；
- 变化的是一整套平台组件；
- 变化的是第三方接口形状；
- 变化的是对象生命周期状态；
- 变化的是两个独立维度的组合。

如果无法说清变化是什么，就还没有资格选择模式。

### 第二步：识别稳定部分

模式不是只把变化抽走，还要保护一块值得稳定的骨架。没有稳定部分，抽象就可能只是把代码搬家。

### 第三步：问控制权在哪里

很多“双胞胎模式”最终都靠控制权区分：

- 谁选择算法：客户端还是对象内部？
- 谁触发下一次切换：外部还是当前状态？
- 谁创建被包对象：客户端还是代理？
- 谁定义流程顺序：Context、父类还是调用方？

### 第四步：检查接口是否变化

这个问题能快速切开 wrapper 家族：

- 接口被翻译：适配器；
- 新增简化接口：外观；
- 接口不变且控访问：代理；
- 接口不变且加职责：装饰器。

### 第五步：确认变化有几条轴

- 一条算法轴：策略；
- 一条生命周期状态轴：状态；
- 两条正交增长轴：桥接；
- 一整族配套产品轴：抽象工厂。

### 第六步：比较模式收益与间接成本

引入模式会增加接口、类、委托层和理解成本。只有当它减少的未来改动成本大于这些成本时，才是好设计。

---

## 九、把 14 个模式压缩成一张意图索引

| 模式 | 它隔离的变化 | 最有辨识度的信号 |
| --- | --- | --- |
| 工厂方法 | 单个产品的具体类型 | 父类流程回调子类创建钩子 |
| 抽象工厂 | 一整族产品的版本 | 同一工厂产生全部配套产品 |
| 建造者 | 复杂对象的构造过程 | 多步骤、可选参数、统一 `build()` |
| 单例 | 实例数量与生命周期 | 经典静态访问会引入隐藏全局依赖 |
| 适配器 | 两个接口的差异 | 把 B 翻译成调用方期待的 A |
| 装饰器 | 可自由叠加的职责 | 同接口、客户端组合、层层包装 |
| 代理 | 对真实对象的访问 | 同接口、代理控制真身生命周期 |
| 外观 | 复杂子系统的使用方式 | 新增一个更简单的入口 |
| 桥接 | 两条正交变化维度 | M×N 组合拆成 M+N 两套体系 |
| 组合 | 部分—整体层级 | N 个子节点、递归聚合、统一叶子与容器 |
| 策略 | 一族可互换算法 | 外部选择，实现彼此不切换 |
| 状态 | 生命周期阶段下的行为 | 当前状态推动下一状态转移 |
| 观察者 | 一个变化源到多个响应方 | 单向一对多发布订阅 |
| 模板方法 | 固定骨架中的可变步骤 | 父类锁顺序，子类填钩子 |

简单工厂可以作为创建逻辑收口的踏脚石，但不必为了“升级”而升级。

---

## 十、最后的自测：不要问“这是什么结构”，要问“它为什么存在”

尝试不看前文回答下面的问题：

1. 同样是 Context 持有接口，怎样区分策略和状态？
2. 同样实现目标接口并包住目标，怎样区分代理和装饰器？
3. 接口都发生了变化，怎样区分适配器和外观？
4. 同样是替换算法，怎样区分策略和模板方法？
5. 同样是对象组合，怎样区分桥接和策略？
6. 同样能创建产品，怎样区分工厂方法、抽象工厂和建造者？
7. 一个接口只有一个实现，而且没有变化迹象，还需要模式吗？

答案可以压缩成几组关键词：

- **外部选择 vs 内部转移**；
- **增加职责 vs 控制访问**；
- **翻译既有接口 vs 新造简单入口**；
- **运行时组合 vs 编译期继承**；
- **一个算法轴 vs 两条正交维度**；
- **单个产品 vs 一族产品 vs 构造过程**；
- **真实变化 vs 想象中的变化**。

设计模式最有价值的地方，从来不是让代码看起来更“高级”，而是给反复出现的设计问题提供共同语言。

真正掌握模式，不是看到 `Context + Interface + ConcreteImpl` 就喊出一个名字，而是能解释：

> **这里哪一部分稳定，哪一部分会变；为什么要把它们分开；控制权应该落在哪里；以及这层抽象今天是否真的值得存在。**

当你开始用这些问题读代码，类图会从需要背诵的答案，退回它应有的位置——只是一种描述结构的工具。模式的名字，则重新变成它本来的含义：对设计意图的命名。
