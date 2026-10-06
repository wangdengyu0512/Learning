---
title: 领域驱动设计：从战略到战术，再到代码
description: 从统一语言、子域与限界上下文出发，经由事件风暴发现聚合，最后用实体、值对象、领域事件和应用服务把业务规则落进代码。
date: 2026-10-06
tags: DDD, 领域驱动设计, 软件架构, Java, 建模
featured: true
---

很多团队第一次接触领域驱动设计（Domain-Driven Design，DDD），会先记住一串名词：实体、值对象、聚合、仓储、领域服务、领域事件。然后按照这些名词重新组织代码，把 `entity`、`repository`、`service`、`domain` 目录建出来，以为系统已经完成了“DDD 改造”。

但目录结构不是领域模型，类的数量也不是建模质量。

一个系统即使有聚合根、仓储接口和领域事件，也可能只是把原来的 CRUD 换了一套名字；反过来，一个没有微服务、没有消息队列、甚至没有复杂框架的模块化单体，也完全可能拥有清晰而有效的领域模型。

DDD 真正解决的是另一类问题：**当业务规则复杂、概念容易混淆、变化不断发生时，如何让业务认知、系统边界和代码结构持续对齐。**

如果只用一句话概括它的主线，我会这样表达：

> **战略设计负责找到正确的边界，战术设计负责守住边界，代码负责让业务规则无法被绕过。**

本文用一个虚构的电商平台“云市”贯穿始终，从买家下单、支付、库存预留到配送，完整走一遍从业务发现到代码落地的过程。

---

## 一、DDD 的起点不是代码，而是问题空间

工程师讨论新系统时，很容易立即进入解空间：

- 使用 Java 还是 Go？
- 订单状态用整数还是枚举？
- 需要建几张表？
- 要不要拆微服务？
- 是否引入 Kafka？

这些问题都重要，但它们不应该最先出现。

在设计订单表之前，团队更应该先问：

- 什么才算一笔有效订单？
- 订单在什么条件下允许修改？
- “确认订单”在业务上意味着哪些承诺？
- 商品调价后，已经下单的价格是否变化？
- 下单成功是否要求库存已经预留成功？
- 支付成功但库存不足时如何处理？

前一组问题关注软件方案，后一组问题关注业务事实。DDD 的第一步，就是把提问顺序从“系统怎么做”调整为“业务究竟是什么”。

### 1. 领域是问题，不是软件

领域（Domain）是系统要面对的那块真实业务世界。对云市而言，领域不是 `OrderService`、`t_order` 表或某个 Spring Boot 工程，而是“让买卖双方安全地完成交易”这件事。

商家如何定价、订单何时不可撤销、库存怎样计算可用量、钱货怎样对账，这些规则在代码出现之前就已经存在。软件只是团队针对这个问题提交的一份答案。

这一区分决定了建模的方向：

```text
错误方向：框架能力 → 数据表 → 接口 → 尝试容纳业务
正确方向：业务事实 → 领域模型 → 边界 → 技术实现
```

### 2. 模型是有目的的抽象

真实业务无限复杂，模型不可能复制现实的全部细节。模型的价值，不在于它包含了多少信息，而在于它是否为当前问题保留了正确的信息。

同一件商品，在不同业务场景中会呈现出完全不同的形状：

| 场景 | 真正关心的信息 | 合适的模型 |
| --- | --- | --- |
| 商品目录 | 标题、图片、类目、营销文案、当前售价 | `CatalogProduct` |
| 下单销售 | 商品标识、名称快照、下单时单价 | `OrderLine` |
| 库存管理 | SKU、可用量、预留量、仓位 | `StockItem` |
| 配送履约 | 重量、体积、收货信息、配送限制 | `ShipmentItem` |

如果试图设计一个企业级统一 `Product` 类，它最终往往会塞入几十个字段：一部分只供目录使用，一部分只供库存使用，还有一部分只有配送理解。这个类看似统一，实际上失去了明确语义。

> 地图不是疆域。好的模型不是现实的完整副本，而是为特定目的进行的有效删减。

### 3. 统一语言必须同时进入对话和代码

统一语言（Ubiquitous Language）不是一份放在 Wiki 里、长期无人维护的术语表，而是业务专家、产品经理和开发者共同使用，并直接进入代码的语言。

如果业务人员说“确认订单”，代码却写成：

```java
statusService.setStatus(order, 2);
```

那么业务语言和代码语言已经断开。`2` 表示什么、谁能设置、设置前需要满足什么条件，都只能依赖开发者记忆。

更符合领域语言的代码应该是：

```java
order.confirm();
```

方法名只是表象，更重要的是，“确认”对应的规则也应该被封装在这个动作中：

```java
public final class Order {
    private OrderStatus status;
    private final List<OrderLine> lines;

    public void confirm() {
        if (status != OrderStatus.CREATED) {
            throw new IllegalStateException("只有待确认订单才能确认");
        }
        if (lines.isEmpty()) {
            throw new IllegalStateException("没有订单项的订单不能确认");
        }
        this.status = OrderStatus.CONFIRMED;
    }
}
```

此时，读代码就是在读业务规则。业务语言一旦变化，代码也应该跟着变化；如果二者长期使用不同词汇，通常不是翻译问题，而是模型已经发生偏移。

---

## 二、战略设计：不是所有业务都值得同样投入

建立语言之后，下一步并不是马上设计实体，而是先判断系统中哪些问题最重要。

大型业务通常由多个子问题组成。云市至少包含：

- 商品目录；
- 销售与下单；
- 库存；
- 支付；
- 配送；
- 通知；
- 身份认证。

DDD 把这些业务问题称为子域（Subdomain）。划分子域的目的不是给组织结构换名字，而是识别不同部分的业务价值与复杂度。

### 1. 核心域、支撑域与通用域

子域通常可以分为三类：

#### 核心域（Core Domain）

核心域是企业形成差异化竞争力的地方。假设云市的优势是面向多商家、多会员等级和复杂促销规则的实时定价，那么“定价与交易规则”就是核心域。

核心域值得投入最强的团队、最深入的建模以及持续演进的架构。

#### 支撑域（Supporting Subdomain）

支撑域是业务运行所必需，但不直接构成竞争优势的能力。例如后台运营、普通发货单管理、商家资料维护。它们通常适合简单、清晰、可维护的实现，不必把所有 DDD 战术模式都用上一遍。

#### 通用域（Generic Subdomain）

通用域是市场上已经有成熟标准答案的能力，例如身份认证、短信、对象存储和通用支付通道。只要它不是企业的差异化来源，通常优先购买、复用或接入，而不是重新发明。

这背后是一条非常重要的投资原则：

> **对核心域深建模，对支撑域保持简单，对通用域优先复用。**

DDD 最昂贵的用法，是在所有模块里平均铺开聚合、仓储、领域服务和事件总线。真正有效的用法，是把建模成本集中到最值得解决的复杂问题上。

### 2. 问题空间与解空间不要混在一起

子域属于问题空间，限界上下文属于解空间。

- 子域回答：业务由哪些问题组成？
- 限界上下文回答：我们准备用哪些模型和边界解决这些问题？

二者经常一一对应，但并非必须如此。一个复杂子域可能被多个限界上下文共同实现；多个简单子域也可能暂时放在同一个上下文中。

如果团队还没理解业务问题，就急着按照微服务清单反推子域，最终得到的往往只是技术模块，而不是业务边界。

---

## 三、限界上下文：为语言划定有效范围

统一语言不是全公司只有一套词，而是**每套语言在自己的边界内保持一致**。

“商品”“客户”“订单”这些词，在不同部门中经常有不同含义：

- 目录上下文中的商品，是用于展示和营销的内容；
- 销售上下文中的商品，是价格被冻结的下单快照；
- 库存上下文中的商品，是可以计数和预留的 SKU；
- 支付上下文中的客户，可能是付款人；
- 配送上下文中的客户，更接近收件人。

自然语言可以依赖语境消歧，代码却不能。一个类一旦同时承担多套语义，字段和规则就会互相污染。

限界上下文（Bounded Context）就是一条语义边界：**在边界内部，每个术语只有一种明确含义，模型保持自洽；跨越边界时，必须显式转换。**

### 1. 限界上下文不等于微服务

限界上下文首先是模型和语言的边界，不是部署边界。

一个限界上下文可以：

- 是模块化单体中的一个模块；
- 独立部署为一个服务；
- 因规模和吞吐要求拆成多个进程；
- 在演进早期与其他上下文共享同一套运行环境。

因此，不应该从“我要拆多少个微服务”开始划上下文。更稳妥的顺序是：

```text
先识别语言和模型边界
        ↓
再建立模块边界与依赖规则
        ↓
最后根据团队、发布、容量和故障隔离需求决定是否独立部署
```

把“一个上下文等于一个微服务”当作硬规则，容易过早引入分布式事务、网络故障、接口治理和运维成本，却没有获得更清晰的模型。

### 2. 上下文映射：不仅要画边界，还要描述关系

系统不可能只有一个上下文。上下文映射（Context Map）用于说明不同上下文怎样协作：谁是上游、谁是下游、谁迁就谁、翻译发生在哪里、上游变化怎样影响下游。

以云市为例，可以先画出一条简化关系链：

```text
Catalog ──商品信息──> Sales ──订单已下单──> Inventory
                            │
                            ├──待支付订单──> Payment
                            │
                            └──待履约订单──> Shipping
```

这张图比普通依赖图多回答了一个问题：**模型由谁定义，语义由谁保护。**

Sales 是核心域时，不应该让 Catalog 的胖 `Product` 对象直接渗入订单模型，也不应该让第三方支付平台的状态码成为销售领域语言的一部分。核心模型需要在边界处建立翻译。

### 3. 防腐层：把外部模型挡在边界之外

假设 Catalog 对外返回：

```java
public record CatalogProduct(
        String productId,
        String title,
        List<String> imageUrls,
        String categoryPath,
        String marketingCopy,
        Money currentPrice
) {}
```

Sales 下单时真正需要的只有商品标识、名称快照和成交单价。于是 Sales 可以在自己这一侧建立防腐层（Anticorruption Layer，ACL）：

```java
public record OrderLineSnapshot(
        ProductId productId,
        String nameSnapshot,
        Money unitPrice
) {}

public final class CatalogAcl {
    private final CatalogClient catalogClient;

    public OrderLineSnapshot snapshotFor(ProductId productId) {
        CatalogProduct external = catalogClient.fetch(productId.value());

        return new OrderLineSnapshot(
                productId,
                external.title(),
                external.currentPrice()
        );
    }
}
```

这层翻译完成了三件事：

1. **裁剪**：丢掉图集、类目和营销文案；
2. **改名**：把目录的 `title` 转成销售语言里的 `nameSnapshot`；
3. **冻结语义**：把会变化的 `currentPrice` 转成下单时固定的 `unitPrice`。

防腐层并不是为了多写一层 DTO，而是为了阻止外部模型支配本地模型。

---

## 四、事件风暴：把业务故事变成模型

战略设计告诉我们应该关注哪些业务和边界，但它还没有直接回答：聚合从哪里来？命令如何产生？上下文之间怎样协作？

事件风暴（Event Storming）承担了从战略到战术的桥梁作用。

### 1. 为什么从事件开始，而不是从数据库开始

传统建模常从名词和 ER 图开始：订单、商品、库存、支付，然后为它们补字段和关联关系。

问题在于，名词会隐藏时间与因果。订单表无法直接告诉我们：

- 订单是什么时候确认的？
- 价格在哪个时刻被冻结？
- 下单后由什么规则触发库存预留？
- 支付成功但创建运单失败时如何补偿？

事件风暴要求业务人员用过去式描述已经发生的业务事实：

```text
购物车已结算
→ 订单已创建
→ 订单已确认
→ 库存已预留
→ 支付已完成
→ 运单已创建
→ 订单已发货
→ 订单已签收
```

过去式会迫使团队讨论“究竟发生了什么”，而不是提前争论“页面上放什么按钮”。

当事件之间无法连起来时，真正的知识盲区就会暴露。例如：

> 运单创建失败时，已经预留的库存由谁释放？订单回到什么状态？是否需要退款？

这类问题不是数据库字段问题，也不只是技术异常处理，而是尚未达成共识的业务规则。事件风暴最重要的产出，往往正是这些热点和问号。

### 2. 从事件推导命令、聚合和策略

设计级事件风暴可以使用以下构件：

| 构件 | 含义 | 示例 |
| --- | --- | --- |
| 领域事件 | 已经发生的业务事实 | `OrderPlaced` |
| 命令 | 希望系统执行的意图 | `PlaceOrder` |
| 聚合 | 接收命令并守护不变量的对象 | `Order` |
| 策略 | 某事件发生后自动触发的规则 | 下单后预留库存 |
| 读模型 | 帮助参与者作出决定的数据视图 | 购物车结算视图 |
| 参与者 | 发起命令的人或外部系统 | 买家、运营人员 |

从事件墙到代码，可以沿着一条相对机械的推导链前进：

```text
参与者看到读模型
        ↓
发出命令 Command
        ↓
聚合校验规则并改变状态
        ↓
产生领域事件 Domain Event
        ↓
策略响应事件，触发下一个命令
```

以“下单后预留库存”为例：

```text
买家
  └─ PlaceOrder
       └─ Order
            └─ OrderPlaced
                 └─ ReserveStockOnOrderPlaced
                      └─ ReserveStock
                           └─ StockItem
                                └─ StockReserved / StockReservationFailed
```

这里自然浮现出两个聚合：

- `Order` 守护订单金额、订单项与状态机；
- `StockItem` 守护可用量和预留量。

二者虽然业务相关，却不需要被塞进同一个大对象中。销售和库存之间通过事件与策略协作，这也为后面的最终一致性提供了模型依据。

---

## 五、战术设计：让规则在代码中无法被绕过

战略设计解决“边界在哪里”，战术设计解决“边界内部如何表达业务”。最常用的三个构件是实体、值对象和聚合。

### 1. 实体：身份贯穿生命周期

实体（Entity）依靠身份区分，而不是依靠所有属性是否相同。

一张订单即使修改了收货地址、状态和订单项，仍然是同一张订单，因为它的 `OrderId` 没有改变。两个字段完全相同的订单，只要标识不同，也是两张不同的订单。

实体通常具有：

- 稳定的唯一标识；
- 跨时间持续存在的生命周期；
- 会变化的状态；
- 围绕状态变化建立的业务行为。

### 2. 值对象：用类型表达约束

值对象（Value Object）没有独立身份，按值相等，通常设计为不可变对象。

金额是最典型的值对象。直接使用 `BigDecimal` 无法阻止不同币种相加，也无法统一精度和舍入规则；把金额和币种封装成 `Money`，就可以把约束集中到类型内部：

```java
public record Money(BigDecimal amount, Currency currency) {

    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        amount = amount.setScale(
                currency.getDefaultFractionDigits(),
                RoundingMode.UNNECESSARY
        );
    }

    public Money plus(Money other) {
        if (!currency.equals(other.currency)) {
            throw new IllegalArgumentException("不同币种不能相加");
        }
        return new Money(amount.add(other.amount), currency);
    }

    public Money times(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("数量必须大于 0");
        }
        return new Money(amount.multiply(BigDecimal.valueOf(quantity)), currency);
    }
}
```

值对象的意义并不只是“少写几个字段”，而是把业务约束提升为类型约束，让错误更难被表达。

### 3. 聚合：一致性边界，而不是对象关系集合

聚合（Aggregate）是一组需要共同保持一致的实体和值对象。聚合根是边界唯一的外部入口，所有修改都必须通过它完成。

订单包含订单项，并不意味着商品、买家、库存、支付单和运单都应该进入订单聚合。判断聚合大小的依据不是 `has-a` 关系，也不是数据库外键，而是**真正不变量**。

所谓真正不变量，是指每次事务提交时都必须成立的规则。例如：

- 订单总额必须等于所有订单项小计之和；
- 已确认订单至少包含一个订单项；
- 订单状态只能沿允许的方向迁移；
- 库存预留量不能超过可用量。

前三条属于订单自身，需要在一次事务中由 `Order` 保证。第四条属于库存，应由 `StockItem` 保证。

判断一条规则是否应该进入同一聚合，可以问：

> **这条规则必须在提交的一瞬间成立，还是允许几秒钟后达成一致？**

如果必须立即成立，相关状态通常应处于同一聚合；如果允许短暂延迟，就应该优先考虑跨聚合协作，而不是继续扩大事务边界。

### 4. 一个事务尽量只修改一个聚合

聚合通常也是乐观锁版本号的单位。如果一张包含上千个订单项的订单被设计成巨型聚合，即使两个操作修改的是互不相关的行，也会竞争同一个 `version`。

聚合越大：

- 每次加载的数据越多；
- 事务持有资源越久；
- 并发冲突越频繁；
- 修改一个局部规则的影响范围越大。

因此，聚合设计应遵循“满足不变量的最小边界”，而不是“能够一次加载的最大对象图”。

### 5. 跨聚合只按标识引用

订单需要知道买家是谁，但通常只保存 `BuyerId`，而不是持有完整 `Buyer` 对象；订单项需要知道 SKU，但通常只保存 `SkuId` 和下单快照，而不是持有 Catalog 的 `Product` 对象。

```java
public final class Order {
    private final OrderId id;
    private final BuyerId buyerId;
    private final List<OrderLine> lines;
    private Money total;
    private OrderStatus status;
    private long version;
}
```

按标识引用会带来一点“显式的不方便”：需要买家详情时，必须明确发起另一次查询。但正是这种不方便，阻止 ORM 沿对象指针悄悄加载半个系统，也阻止多个聚合被无意间纳入同一个事务。

---

## 六、从领域模型到 Java 代码

下面把前面的设计压缩成一组相互配合的代码骨架。

### 1. 用值对象表达订单项

```java
public record ProductId(String value) {}
public record BuyerId(String value) {}
public record OrderId(String value) {}

public record OrderLine(
        ProductId productId,
        String nameSnapshot,
        Money unitPrice,
        int quantity
) {
    public OrderLine {
        if (quantity <= 0) {
            throw new IllegalArgumentException("商品数量必须大于 0");
        }
    }

    public Money subtotal() {
        return unitPrice.times(quantity);
    }
}
```

`OrderLine` 保存的是销售上下文需要的下单快照。目录后来修改标题或价格，不会追溯性地改变历史订单。

### 2. 让聚合根守住真正不变量

```java
public final class Order {
    private final OrderId id;
    private final BuyerId buyerId;
    private final List<OrderLine> lines = new ArrayList<>();
    private final List<DomainEvent> events = new ArrayList<>();

    private Money total;
    private OrderStatus status;
    private long version;

    private Order(OrderId id, BuyerId buyerId, Currency currency) {
        this.id = id;
        this.buyerId = buyerId;
        this.total = new Money(BigDecimal.ZERO, currency);
        this.status = OrderStatus.CREATED;
    }

    public static Order place(
            OrderId id,
            BuyerId buyerId,
            List<OrderLine> lines,
            Currency currency
    ) {
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("订单至少包含一个订单项");
        }

        Order order = new Order(id, buyerId, currency);
        lines.forEach(order::addLine);
        order.events.add(new OrderPlaced(id, buyerId, order.total));
        return order;
    }

    public void addLine(OrderLine line) {
        requireStatus(OrderStatus.CREATED);
        lines.add(line);
        total = lines.stream()
                .map(OrderLine::subtotal)
                .reduce(
                        new Money(BigDecimal.ZERO, total.currency()),
                        Money::plus
                );
    }

    public void confirm() {
        requireStatus(OrderStatus.CREATED);
        if (lines.isEmpty()) {
            throw new IllegalStateException("没有订单项的订单不能确认");
        }
        status = OrderStatus.CONFIRMED;
        events.add(new OrderConfirmed(id));
    }

    public List<DomainEvent> pullEvents() {
        List<DomainEvent> copied = List.copyOf(events);
        events.clear();
        return copied;
    }

    private void requireStatus(OrderStatus expected) {
        if (status != expected) {
            throw new IllegalStateException(
                    "当前状态 " + status + " 不允许执行该操作"
            );
        }
    }
}
```

这段代码的重点不是 Java 语法，而是修改路径：

- 外部不能直接取得可变的 `lines`；
- 没有公开的 `setStatus` 和 `setTotal`；
- 增加订单项后，总额立即重新计算；
- 状态变化只能通过带业务含义的方法完成；
- 领域事件由聚合在业务事实成立时产生。

这就是“让规则无法被绕过”。

### 3. 仓储以聚合为单位

仓储（Repository）提供的是面向领域的聚合存取抽象，而不是把数据库操作全部隐藏成一个万能 DAO。

```java
public interface OrderRepository {
    Optional<Order> findById(OrderId id);
    void save(Order order);
}
```

仓储接口通常放在领域层，具体的 JPA、MyBatis 或 JDBC 实现放在基础设施层。领域模型只知道“保存订单”，不应该知道订单被拆成了几张表。

### 4. 应用服务只负责编排

应用服务处理一个用例的流程：接收输入、加载聚合、调用领域行为、保存结果、发布事件。它不应该成为业务规则的集中地。

```java
public final class PlaceOrderApplicationService {
    private final CatalogAcl catalogAcl;
    private final OrderRepository orderRepository;
    private final EventPublisher eventPublisher;

    @Transactional
    public OrderId handle(PlaceOrderCommand command) {
        List<OrderLine> lines = command.items().stream()
                .map(item -> {
                    OrderLineSnapshot snapshot =
                            catalogAcl.snapshotFor(item.productId());
                    return new OrderLine(
                            snapshot.productId(),
                            snapshot.nameSnapshot(),
                            snapshot.unitPrice(),
                            item.quantity()
                    );
                })
                .toList();

        OrderId orderId = OrderIdGenerator.next();
        Order order = Order.place(
                orderId,
                command.buyerId(),
                lines,
                Currency.getInstance("CNY")
        );

        orderRepository.save(order);
        eventPublisher.publish(order.pullEvents());
        return orderId;
    }
}
```

应用服务可以有条件分支，但这些分支应该是流程编排，而不是领域判断。判断“订单能否确认”的规则属于 `Order`；判断“某会员在某促销下应付多少钱”的复杂算法可能属于领域服务；事务、鉴权、幂等和消息发布则通常属于应用层或基础设施层。

### 5. 领域服务不等于应用服务

领域服务用于承载无法自然归属某个实体或值对象、但确实属于领域的逻辑。例如，一次报价需要同时考虑会员等级、商家协议和促销策略，可以建模为：

```java
public interface PricingService {
    Money quote(BuyerId buyerId, List<OrderLineDraft> lines);
}
```

它的名字和行为属于统一语言。

应用服务则负责“先做什么、后做什么”，本身不应拥有核心业务规则。二者混淆后，系统很容易退化为贫血模型：领域对象只剩 getter/setter，所有规则堆进几千行的 `OrderService`。

---

## 七、跨聚合协作：最终一致不是技术偷懒

订单创建和库存预留属于两个聚合，也往往属于两个限界上下文。它们不应该为了“看起来一致”而被强行放进一个本地事务或分布式事务。

更自然的流程是：

```text
Sales 事务：
  创建 Order
  保存 Order
  记录 OrderPlaced
          ↓
可靠发布领域事件
          ↓
Inventory 事务：
  加载 StockItem
  尝试预留库存
  产生 StockReserved 或 StockReservationFailed
          ↓
Sales 根据结果推进订单状态或执行补偿
```

最终一致不代表“不保证一致”，而是把一个跨边界的大事务拆成多个各自可靠的小事务，再通过事件、重试、幂等和补偿达到业务上的一致。

真正需要设计的是：

- 事件怎样与本地事务一起可靠记录；
- 消费者如何实现幂等；
- 重试失败后怎样进入人工处理；
- 业务补偿是什么，而不仅仅是数据库回滚；
- 用户在中间状态下看到什么。

领域事件也不等于 Kafka。事件可以先在同一进程内分发；只有当跨进程通信、独立伸缩、故障隔离或异步吞吐确实需要时，才引入消息中间件。先建立正确的业务边界，再选择通信技术。

---

## 八、最常见的五个失败模式

### 1. 先建表，再给表生成领域对象

这样得到的类只会忠实表达存储结构，很难表达行为、状态机和不变量。数据库是模型的持久化形式，不应反过来决定整个领域模型。

### 2. 所有规则都写在 Service 中

当 `Order` 只有 getter/setter，任何调用者都能直接修改状态，规则便无法被对象自己守住。这是典型的贫血领域模型：穿着面向对象外衣的过程式代码。

### 3. 把相关性误认为一致性

订单与库存有关，不代表它们必须属于同一聚合；订单与买家有关，也不代表订单必须持有完整的买家对象。聚合边界取决于提交时必须成立的不变量，而不是业务对象之间是否存在关联。

### 4. 把限界上下文直接翻译成微服务

语义边界清楚，并不意味着必须立即进行物理拆分。很多系统应该先从模块化单体开始，用包、模块、接口和依赖检查守住边界，等独立发布或伸缩的收益超过分布式成本时再拆服务。

### 5. 在所有模块里平均使用 DDD

后台字典管理、短信发送和普通配置页面没有必要使用与核心定价引擎相同的建模强度。DDD 的重点不是模式齐全，而是把认知和设计投入到真正复杂、真正产生差异的地方。

---

## 九、一条可执行的落地路径

如果团队准备在真实项目中实践 DDD，可以按下面的顺序推进。

### 第一步：选择一个有价值的业务场景

不要一开始试图重构整个系统。选择规则复杂、变化频繁、跨团队沟通成本高的一条核心流程，例如下单、授信、理赔或排产。

### 第二步：邀请真正懂业务的人参与

领域知识不在需求文档里，而在业务人员处理例外和冲突的经验里。让业务专家、产品、开发和测试共同参与讨论。

### 第三步：用事件风暴还原时间线

先贴“已经发生的事实”，再补命令、参与者、策略和读模型。把争议和未知明确标成热点，不要用技术术语掩盖业务规则缺失。

### 第四步：识别子域和限界上下文

观察哪些事件使用同一套语言、围绕同一组规则变化，并明确上下文之间的上下游关系与翻译策略。

### 第五步：寻找真正不变量

针对每个命令追问：谁接收它？谁负责保证结果合法？哪些规则必须在同一次提交中成立？由此识别聚合及其边界。

### 第六步：把语言写进代码

优先设计行为和类型，而不是 getter/setter：

- 用 `order.confirm()` 替代 `setStatus(2)`；
- 用 `Money` 替代裸 `BigDecimal`；
- 用 `BuyerId` 替代跨聚合对象引用；
- 用工厂方法保证对象出生即合法；
- 用领域事件表达已经发生的业务事实。

### 第七步：最后再决定基础设施

模型和边界稳定之后，再选择模块化单体或微服务、同步调用或消息通信、关系数据库或事件存储。技术决策应该服务于模型，而不是反过来主导模型。

可以把整条路径压缩成下面这张路线图：

```text
业务事实
  ↓
统一语言
  ↓
子域分类与投资决策
  ↓
限界上下文与上下文映射
  ↓
事件风暴
  ↓
命令、聚合、领域事件
  ↓
实体、值对象、领域服务
  ↓
应用服务、仓储、防腐层
  ↓
事务、消息、数据库与部署方案
```

---

## 结语

DDD 不是一套必须全部使用的设计模式，也不是通往微服务的固定路线。它更像一套管理复杂度的工作方法：用统一语言减少认知损耗，用战略设计决定把精力投在哪里，用限界上下文隔离冲突语义，用事件风暴发现业务因果，再用聚合和值对象把规则固化进代码。

判断一个系统是否真正实践了 DDD，不要看它有多少个 `AggregateRoot`、多少个 Repository，也不要看它是否部署在 Kubernetes 上。更值得检查的是：

- 业务人员和开发者是否在使用同一套语言；
- 相同术语的不同含义是否被边界隔离；
- 核心业务规则是否位于领域模型中；
- 聚合是否只包含必须强一致的数据；
- 跨边界协作是否显式、可追踪、可补偿；
- 代码能否阻止非法状态和非法操作出现。

当这些问题有清晰答案时，DDD 才不再是术语和目录结构，而会变成一种可以持续演进的业务设计能力。

