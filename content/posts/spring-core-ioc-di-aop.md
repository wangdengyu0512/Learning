---
title: Spring 核心：IoC 容器、依赖注入与 AOP
description: 从 BeanDefinition、refresh()、Bean 生命周期与三级缓存出发，串起依赖注入、后置处理器、AOP 代理及事务失效的完整机制。
date: 2026-10-06
tags: Spring, IoC, AOP
featured: true
---

# Spring 核心：IoC 容器、依赖注入与 AOP

很多人第一次使用 Spring 时，会把它理解成一组方便的注解：`@Component` 负责注册对象，`@Autowired` 负责注入依赖，`@Transactional` 负责开启事务，`@Async` 负责异步执行。

这些注解确实好用，但如果只停留在“会用”的层面，一旦遇到下面的问题，就很容易陷入试错：

- 为什么同一个类里的 `@Transactional` 方法没有生效？
- 为什么构造器循环依赖无法解决，字段循环依赖却有时可以？
- 为什么 `@PostConstruct` 中调用事务方法，事务仍然没有开启？
- 为什么把 `@Configuration` 换成 `@Component` 后，`@Bean` 方法可能重复创建对象？
- 为什么注入到单例中的 `prototype` Bean，没有做到“每次一个新对象”？

要回答这些问题，不需要把 Spring 源码全部背下来，只需要建立一条稳定的主线：

> **Spring 容器是一台对象图装配机。它先收集对象的“配方”，再按照固定生命周期创建对象，并允许各种扩展机制在生命周期的特定节点介入。**

沿着这条主线看，IoC、DI、Bean 生命周期、循环依赖和 AOP 不再是互不相关的知识点，而是同一台机器上的不同零件。

---

## 一、先建立全局模型：Spring 到底在管理什么

假设订单服务依赖支付网关。没有 Spring 时，代码可能这样写：

```java
public class OrderService {
    private final PaymentGateway paymentGateway;

    public OrderService() {
        this.paymentGateway = new StripePaymentGateway(
            new PaymentRepository()
        );
    }
}
```

`OrderService` 不仅负责订单业务，还必须知道：

- 使用哪个支付实现；
- 支付实现需要哪些依赖；
- 依赖应该如何创建；
- 对象是否应该复用。

业务对象同时承担了“使用依赖”和“组装依赖”两种职责，耦合自然越来越重。

使用依赖注入后，它只声明自己需要什么：

```java
@Service
public class OrderService {
    private final PaymentGateway paymentGateway;

    public OrderService(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }
}
```

至于 `PaymentGateway` 的具体实现、创建时机和生命周期，由容器统一决定。

这就是 IoC 与 DI 的关系：

- **IoC（控制反转）**描述结果：对象失去了主动创建、查找依赖的控制权；
- **DI（依赖注入）**描述手段：容器通过构造器、方法或字段，把依赖推送给对象。

它们不是两套互相竞争的机制，而是同一件事的两个观察角度。

### 1. Bean 与 BeanDefinition：实例和配方不是一回事

Spring 管理的对象实例称为 **Bean**。但容器在真正创建 Bean 之前，需要先知道：

- 要创建哪个类；
- Bean 的名称是什么；
- 它是单例还是原型；
- 是否延迟创建；
- 有哪些构造参数和属性；
- 初始化、销毁方法是什么。

这些元数据被组织成 **BeanDefinition**。可以把二者理解为：

```text
BeanDefinition：对象的配方
Bean：按照配方创建出来的对象
```

这是理解 Spring 扩展机制的第一个关键点。容器启动并不是扫描到一个类就立刻 `new` 一个对象，而是先收集 BeanDefinition，再集中创建 Bean：

```text
扫描与解析配置
    ↓
注册 BeanDefinition
    ↓
修改、补充 BeanDefinition
    ↓
实例化 Bean
    ↓
注入、初始化与代理
```

正因为“配方已经存在、实例尚未创建”之间有一个窗口，Spring 才能在实例化前统一替换占位符、解析配置类、修改作用域，甚至动态注册新的 BeanDefinition。

### 2. BeanFactory 与 ApplicationContext

`BeanFactory` 是 Spring IoC 容器的基础接口，提供 Bean 注册、查找和创建等核心能力。`ApplicationContext` 建立在它之上，并补充了工程应用常用的能力：

- 国际化消息；
- 事件发布与监听；
- 资源加载；
- 环境与配置管理；
- 自动发现并注册各种后置处理器；
- 启动阶段预实例化非懒加载单例。

可以用一句话区分：

> **BeanFactory 是容器内核，ApplicationContext 是面向应用的完整容器。**

`ApplicationContext` 默认在启动末期创建非懒加载单例，因此很多配置错误会在应用启动时暴露，而不是等到第一次请求到来时才出现。这增加了启动成本，却显著提升了线上系统的可预测性。

---

## 二、依赖注入：写法差异背后是生命周期差异

Spring 常见的注入方式有三种。

### 1. 构造器注入

```java
@Service
public class OrderService {
    private final PaymentGateway paymentGateway;

    public OrderService(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }
}
```

构造器注入发生在**对象实例化的那一刻**。依赖没有准备好，对象就无法创建。

它的优点很明确：

- 必需依赖在类型结构中显式可见；
- 字段可以声明为 `final`；
- 对象一旦创建就处于完整状态；
- 不启动 Spring 容器也能直接 `new`，单元测试更简单；
- 循环依赖会尽早暴露，迫使设计者修正对象关系。

### 2. Setter 注入

```java
@Service
public class OrderService {
    private PaymentGateway paymentGateway;

    @Autowired
    public void setPaymentGateway(PaymentGateway paymentGateway) {
        this.paymentGateway = paymentGateway;
    }
}
```

Setter 注入发生在对象已经实例化之后，适合真正可选、允许运行期重新配置的依赖。但它也意味着对象在构造完成后，可能暂时处于依赖不完整的状态。

### 3. 字段注入

```java
@Service
public class OrderService {
    @Autowired
    private PaymentGateway paymentGateway;
}
```

字段注入代码最短，却隐藏了对象的真实依赖。调用者只看构造器无法判断它需要什么，脱离容器测试时也往往需要反射或额外测试框架才能塞入替身对象。

三者最重要的差异不是语法，而是**注入时机**：

| 注入方式 | 发生阶段 | 对象创建时是否必须有依赖 | 典型特点 |
| --- | --- | --- | --- |
| 构造器注入 | 实例化 | 是 | 依赖显式、对象完整、便于测试 |
| Setter 注入 | 属性填充 | 否 | 适合可选依赖，但存在暂时不完整状态 |
| 字段注入 | 属性填充 | 否 | 写法简短，但依赖隐藏、测试不便 |

因此，在常规业务代码中，优先使用构造器注入通常是更稳妥的选择。

### 4. 作用域：容器究竟创建几个对象

最常见的两个作用域是：

- `singleton`：同一个容器中，一个 BeanDefinition 通常只对应一个共享实例；
- `prototype`：每次向容器请求时创建一个新实例。

这里有一个容易误判的场景：把 `prototype` Bean 直接注入 `singleton` Bean。

```java
@Component
@Scope("prototype")
public class TaskContext {
}

@Service
public class TaskService {
    private final TaskContext context;

    public TaskService(TaskContext context) {
        this.context = context;
    }
}
```

`TaskService` 只创建一次，注入也只发生一次。因此它持有的 `TaskContext` 引用不会在每次调用时自动刷新。`prototype` 的“每次新建”指的是**每次向容器获取**，而不是每次使用字段。

如果单例需要反复取得新的原型对象，应使用 `ObjectProvider` 等延迟获取机制：

```java
@Service
public class TaskService {
    private final ObjectProvider<TaskContext> contextProvider;

    public TaskService(ObjectProvider<TaskContext> contextProvider) {
        this.contextProvider = contextProvider;
    }

    public void execute() {
        TaskContext context = contextProvider.getObject();
        // 每次显式向容器获取
    }
}
```

---

## 三、容器启动：`refresh()` 如何安排所有扩展点

创建 `ApplicationContext` 时，真正组织启动过程的是 `AbstractApplicationContext.refresh()`。

没有必要死记每一行源码，但要理解它为什么必须按固定顺序运行。可以把主干压缩成下面这条流程：

```text
准备环境与容器状态
    ↓
取得并准备 BeanFactory
    ↓
加载、注册 BeanDefinition
    ↓
执行 BeanFactoryPostProcessor
    ↓
注册 BeanPostProcessor
    ↓
初始化消息源、事件广播器等基础设施
    ↓
实例化非懒加载单例
    ↓
发布容器刷新完成事件
```

这套顺序解决了两个核心问题：

1. 在 Bean 创建前，谁有机会修改对象配方？
2. 在每个 Bean 创建过程中，谁有机会注入、检查或替换对象？

答案分别是 `BeanFactoryPostProcessor` 和 `BeanPostProcessor`。

### 1. BFPP：在对象出生前修改配方

`BeanFactoryPostProcessor` 处理的是 BeanDefinition，工作时大多数普通 Bean 还没有被创建。

它适合做：

- 替换配置占位符；
- 修改 Bean 的 scope、属性或依赖信息；
- 解析配置类；
- 增加或删除 BeanDefinition。

典型实现包括：

- `PropertySourcesPlaceholderConfigurer`；
- `ConfigurationClassPostProcessor`。

### 2. BPP：在对象创建过程中处理实例

`BeanPostProcessor` 处理的是已经实例化或即将初始化的 Bean 对象。它可以：

- 完成注解驱动的依赖注入；
- 执行初始化前后的自定义逻辑；
- 检查和修改字段；
- 返回一个包装对象；
- 用代理替换原始 Bean。

两类后置处理器可以这样对照：

| 对比维度 | BeanFactoryPostProcessor | BeanPostProcessor |
| --- | --- | --- |
| 处理对象 | BeanDefinition | Bean 实例 |
| 工作时机 | Bean 实例化之前 | 每个 Bean 创建过程中 |
| 典型能力 | 改配方、补配置、注册定义 | 注入、初始化、包装、生成代理 |
| 典型实现 | `ConfigurationClassPostProcessor` | `AutowiredAnnotationBeanPostProcessor`、自动代理创建器 |

一个特别重要的细节是：`BeanPostProcessor` 的回调可以返回另一个对象。

```java
public Object postProcessAfterInitialization(Object bean, String beanName) {
    return shouldProxy(bean)
        ? createProxy(bean)
        : bean;
}
```

容器最终保存的不一定是最初创建的对象，也可能是后置处理器返回的代理。这就是 AOP 能够无缝进入 IoC 容器的接口缝隙。

---

## 四、Bean 生命周期：所有“注解魔法”都有固定位置

把单个 Bean 的创建过程放大，可以归纳为三大阶段：

```text
实例化 → 属性填充 → 初始化
```

### 1. 实例化：先把对象的“壳”造出来

容器选择构造器并创建原始对象。构造器注入也发生在这个阶段，因为依赖本身就是构造参数。

```text
createBeanInstance(...)
    ↓
调用构造器
    ↓
得到原始对象
```

此时，通过字段或 Setter 注入的属性通常还没有填充。

### 2. 属性填充：`@Autowired` 在这里工作

实例创建后，容器进入属性填充阶段。负责解析 `@Autowired` 的核心组件之一是 `AutowiredAnnotationBeanPostProcessor`。

这说明：

> **`@Autowired` 不是写死在对象构造流程里的特殊语法，而是一个 BeanPostProcessor 基于生命周期扩展点实现的能力。**

理解这一点后，许多其他注解也可以用相同方式分析：先问它由哪个扩展组件处理，再问该组件挂在哪个生命周期节点。

### 3. 初始化：回调、初始化方法与代理

属性填充完成后，Bean 会经历一系列初始化动作。为了建立心智模型，可以把它简化为：

```text
Aware 接口回调
    ↓
BeanPostProcessor 初始化前回调
    ↓
@PostConstruct
    ↓
InitializingBean.afterPropertiesSet()
    ↓
自定义 init-method
    ↓
BeanPostProcessor 初始化后回调
    ↓
可能返回 AOP 代理
```

因此，下面几个结论都可以从生命周期直接推出：

- `@PostConstruct` 执行时，字段注入通常已经完成；
- AOP 代理通常在初始化后置处理阶段生成；
- 在 `@PostConstruct` 里通过 `this` 调用本类事务方法，不会经过最终代理；
- 容器中最终保存的对象可能不是原始对象，而是代理对象。

如果只记一句话，就记住：

> **实例化负责造对象，属性填充负责塞依赖，初始化负责执行回调并完成增强。**

---

## 五、循环依赖与三级缓存：解决的是引用一致性

设有两个单例 Bean：

```java
@Service
public class AService {
    @Autowired
    private BService bService;
}

@Service
public class BService {
    @Autowired
    private AService aService;
}
```

创建 `AService` 时需要 `BService`，创建 `BService` 时又需要 `AService`。如果容器只允许使用完整成品，创建过程就会无限等待。

Spring 核心容器处理一部分单例循环依赖时，关键思路是：

> **对象一旦完成实例化，即使属性还没有填满，也可以先暴露一个早期引用。**

常说的三级缓存，可以抽象为：

| 层级 | 作用 |
| --- | --- |
| 一级缓存 | 保存已经完成创建的单例 |
| 二级缓存 | 保存已经生成的早期单例引用 |
| 三级缓存 | 保存用于按需生成早期引用的工厂 |

简化后的过程如下：

```text
1. 实例化 A，得到一个尚未填充属性的原始对象
2. 为 A 注册早期引用工厂
3. A 注入 B，于是开始创建 B
4. B 注入 A，发现 A 正在创建
5. 调用 A 的早期引用工厂，得到 A 或 A 的早期代理
6. B 完成创建
7. 回到 A，完成属性填充与初始化
8. A 最终进入单例缓存
```

### 1. 为什么不是两级缓存

如果只有“成品对象”和“半成品对象”两级缓存，普通循环依赖似乎也能解决。但一旦 A 需要被 AOP 增强，就会出现引用不一致：

- B 提前拿到的是 A 的原始对象；
- 容器最终保存的却是 A 的代理对象。

此时，其他 Bean 调用的是代理，B 调用的却是裸对象，事务、日志、缓存等增强可能被绕过。

第三级缓存保存的不是现成对象，而是一个能够**按需产生早期引用**的工厂。只有循环依赖真的发生时，工厂才被调用，并决定返回原始对象还是早期代理。这样可以尽量保证：

```text
依赖方拿到的早期引用 === 容器最终对外暴露的引用
```

所以，第三级缓存的价值不只是“解决循环依赖”，而是处理循环依赖与 AOP 同时存在时的引用一致性。

### 2. 为什么构造器循环依赖无解

再看构造器注入：

```java
@Service
public class AService {
    public AService(BService bService) {
    }
}

@Service
public class BService {
    public BService(AService aService) {
    }
}
```

三级缓存生效的前提是：对象至少已经完成实例化，可以先暴露一个“壳”。

但构造器依赖必须在调用构造器前准备好：A 没有 B 就不能实例化，B 没有 A 也不能实例化。双方都到不了“已经有壳，可以提前暴露”的阶段，因此缓存没有介入机会。

需要强调的是，容器**能够**处理部分循环依赖，不等于业务设计**应该**依赖循环依赖。循环关系通常意味着职责边界不清。更好的修复方式往往是：

- 拆分职责；
- 抽取第三个协调者；
- 改为事件通信；
- 重新划分领域对象和应用服务边界。

---

## 六、AOP：不是把代码塞进方法，而是让调用先经过代理

AOP 用来集中处理日志、事务、权限、缓存、限流等横切逻辑。要理解它，先对齐几个术语：

| 术语 | 含义 | Spring 中的形态 |
| --- | --- | --- |
| 连接点 Join Point | 可以插入行为的位置 | Spring AOP 中主要是方法执行 |
| 切点 Pointcut | 匹配连接点的规则 | `execution(...)`、注解匹配等 |
| 通知 Advice | 在匹配位置执行的行为 | before、after、around 等 |
| 切面 Aspect | 切点与通知的组合 | `@Aspect` 类 |
| 织入 Weaving | 把增强应用到目标上的过程 | 运行期创建代理 |
| 目标与代理 | 原始对象与包装后的对象 | JDK 代理或 CGLIB 代理 |

Spring AOP 的核心调用链可以画成：

```text
调用者
  ↓
代理对象
  ↓
通知链：事务 / 日志 / 权限 / 缓存
  ↓
目标对象的方法
```

这张图解释了绝大多数 AOP 行为：增强逻辑不在目标对象本身，而在代理对象持有的拦截器链中。

### 1. 自动代理创建器如何进入生命周期

Spring 会注册自动代理创建器。以基于注解切面的场景为例，常见核心组件是 `AnnotationAwareAspectJAutoProxyCreator`，它本身就是 `BeanPostProcessor`。

每个 Bean 初始化完成后，它会判断：

1. 当前 Bean 是否匹配某个切点；
2. 如果匹配，需要应用哪些通知；
3. 应该创建 JDK 动态代理还是 CGLIB 代理；
4. 返回原始对象，还是返回代理对象。

因此，IoC 与 AOP 并不是两套独立系统：

> **AOP 是借助 BeanPostProcessor，挂载在 Bean 生命周期末尾的一种对象替换行为。**

---

## 七、JDK 动态代理与 CGLIB

Spring 常见的两类代理技术各有边界。

### 1. JDK 动态代理

JDK 动态代理基于接口工作。运行时生成一个实现相同接口的代理类，方法调用进入 `InvocationHandler`：

```java
public Object invoke(Object proxy, Method method, Object[] args) {
    before();
    try {
        return method.invoke(target, args);
    } finally {
        after();
    }
}
```

它的特点是：

- 目标通常需要提供接口；
- 代理类型面向接口；
- 接口之外的实现类方法不属于该代理契约。

### 2. CGLIB 代理

CGLIB 通过生成目标类的子类并覆盖方法来插入增强。因此它不要求目标类实现接口，但继承机制也带来限制：

- `final` 类不能被继承；
- `final` 方法不能被覆盖；
- `private` 方法不能由子类覆盖；
- 构造和可见性设计不当也可能限制代理生成。

| 对比维度 | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 基础机制 | 生成接口实现类 | 生成目标类子类 |
| 是否要求接口 | 通常需要 | 不需要 |
| 主要限制 | 代理契约受接口约束 | 不能覆盖 `final`、`private` 方法 |
| 注入类型关注点 | 更适合按接口注入 | 可以按具体类暴露代理 |

选择哪种技术不是目的。真正需要检查的是：**调用是否进入了代理可拦截的方法。**

---

## 八、为什么 `@Transactional` 自调用会失效

下面这段代码看起来合理，但 `saveWithTx()` 上的事务通常不会因为内部调用而生效：

```java
@Service
public class OrderService {

    public void createOrder(Order order) {
        validate(order);
        saveWithTx(order);
    }

    @Transactional
    public void saveWithTx(Order order) {
        // 写数据库
    }
}
```

外部拿到的通常是 `OrderService` 代理：

```text
Controller → OrderService 代理 → createOrder()
```

但进入目标对象的 `createOrder()` 以后，`saveWithTx()` 是通过 `this` 调用的：

```text
目标对象 this.createOrder()
          ↓
目标对象 this.saveWithTx()
```

这一步没有重新回到代理，所以事务拦截器没有机会执行。

判断任何 AOP 失效问题时，都可以先问一句：

> **这次方法调用，究竟有没有经过代理对象？**

### 1. 优先修复：拆分 Bean 边界

通常最清晰的修复方式，是把事务操作拆到另一个 Bean：

```java
@Service
public class OrderApplicationService {
    private final OrderTransactionalService transactionalService;

    public OrderApplicationService(
        OrderTransactionalService transactionalService
    ) {
        this.transactionalService = transactionalService;
    }

    public void createOrder(Order order) {
        validate(order);
        transactionalService.save(order);
    }
}

@Service
public class OrderTransactionalService {

    @Transactional
    public void save(Order order) {
        // 写数据库
    }
}
```

调用从一个 Bean 进入另一个 Bean，天然经过后者的代理，也让事务边界在架构上更清晰。

### 2. 其他办法与代价

还可以使用自注入或 `AopContext.currentProxy()`，让调用重新经过代理。但这些方案会让业务代码显式感知 AOP 容器，增加理解和测试成本。除非有明确约束，否则优先通过职责拆分解决。

### 3. 同一根因导致的失败模式

| 现象 | 直接原因 | 对应机制 |
| --- | --- | --- |
| `@Transactional` 自调用不生效 | `this` 绕过代理 | 通知存在于代理链中 |
| `@Async` 自调用仍在当前线程执行 | `this` 绕过代理 | 异步拦截器没有执行 |
| `@Cacheable` 自调用没有缓存 | `this` 绕过代理 | 缓存拦截器没有执行 |
| `final` 方法上的增强无效 | CGLIB 无法覆盖 | 子类代理受继承规则限制 |
| `@PostConstruct` 中调用事务方法无效 | 最终代理尚未对外工作，且是 `this` 调用 | 生命周期早于代理使用阶段 |
| 单例中的原型对象不刷新 | 注入只在单例创建时发生一次 | 作用域与注入时机共同决定 |

这些问题不需要分别死记。只要从“生命周期”和“是否经过代理”两条线推导，就能得到答案。

---

## 九、`@Configuration` 为什么也要代理

考虑下面的配置类：

```java
@Configuration
public class AppConfig {

    @Bean
    public InventoryRepository repository() {
        return new MySqlInventoryRepository();
    }

    @Bean
    public OrderService orderService() {
        return new OrderService(repository());
    }
}
```

从普通 Java 语义看，`orderService()` 中调用 `repository()` 会再次执行方法并创建一个新对象。那为什么完整配置模式下，`OrderService` 通常仍然拿到容器管理的那个单例？

原因是 `@Configuration` 类会被增强。对 `@Bean` 方法的调用会先被拦截：

- 如果对应 Bean 已经存在，直接从容器返回；
- 如果还不存在，再按容器创建流程生成。

因此，`@Bean` 方法之间的调用仍然遵守容器的单例语义。

### Full 与 Lite 模式

| 配置方式 | 是否增强配置类 | `@Bean` 方法互调 |
| --- | --- | --- |
| `@Configuration` 默认模式 | 是 | 可被拦截并返回容器中的 Bean |
| `@Component` 中声明 `@Bean` | 否 | 普通 Java 方法调用，可能重复创建 |
| `@Configuration(proxyBeanMethods = false)` | 否 | 不拦截互调，适合不存在方法互调的配置 |

关闭 `proxyBeanMethods` 可以减少配置类增强成本，但前提是各个 `@Bean` 方法彼此独立，依赖关系通过方法参数表达，而不是直接互调：

```java
@Configuration(proxyBeanMethods = false)
public class AppConfig {

    @Bean
    public InventoryRepository repository() {
        return new MySqlInventoryRepository();
    }

    @Bean
    public OrderService orderService(
        InventoryRepository repository
    ) {
        return new OrderService(repository);
    }
}
```

这种写法依赖容器注入方法参数，不依赖配置类方法调用，更容易安全地关闭代理。

---

## 十、Spring AOP 与 AspectJ 怎么选

Spring AOP 的限制都来自“运行期代理”这一实现选择：

- 主要拦截方法执行；
- 只增强 Spring 容器管理的 Bean；
- 自调用可能绕过代理；
- 受 JDK 接口代理和 CGLIB 继承规则约束。

AspectJ 则可以在编译期或类加载期修改字节码，覆盖更多连接点。

| 对比维度 | Spring AOP | AspectJ |
| --- | --- | --- |
| 织入时机 | 运行期创建代理 | 编译期或类加载期织入 |
| 主要连接点 | 方法执行 | 方法、字段、构造器等 |
| 作用对象 | Spring Bean | 可以覆盖普通对象 |
| 自调用 | 可能绕过代理 | 可直接织入目标字节码 |
| 工具链成本 | 较低，框架内置 | 较高，需要织入配置 |

一般选择原则是：

- 事务、日志、缓存、权限等 Bean 公共方法级横切逻辑，优先使用 Spring AOP；
- 需要增强非 Spring 对象、字段访问、构造器，或必须覆盖自调用时，再评估 AspectJ；
- 不要为了避开一次不合理的 Bean 设计，直接引入更重的字节码织入方案。

---

## 十一、用一条完整链路串起所有概念

假设有一个 `OrderService`：

- 它依赖 `PaymentGateway`；
- 两者形成了字段注入循环依赖；
- `OrderService` 又命中了日志切面。

容器中的主流程大致如下：

```text
1. 扫描配置，注册 OrderService 与 PaymentGateway 的 BeanDefinition
2. BFPP 在实例化前解析配置、修改 BeanDefinition
3. 注册负责注入与自动代理的 BPP
4. 开始创建 OrderService
5. 实例化 OrderService 原始对象
6. 注册 OrderService 的早期引用工厂
7. 属性填充时发现需要 PaymentGateway，于是创建 PaymentGateway
8. PaymentGateway 又需要 OrderService
9. 从三级缓存中的工厂取得 OrderService 的早期引用
10. 如果 OrderService 需要 AOP，则早期引用应考虑代理一致性
11. PaymentGateway 完成创建并进入单例缓存
12. 回到 OrderService，完成属性填充
13. 执行初始化回调
14. 自动代理创建器在初始化后置阶段返回代理
15. 容器最终对外暴露 OrderService 代理
```

这条链路把前面的概念全部连起来了：

- IoC 决定对象由容器创建；
- DI 决定依赖由容器注入；
- BeanDefinition 是创建前的配方；
- `refresh()` 规定扩展点顺序；
- BFPP 修改配方；
- BPP 处理对象；
- 三级缓存处理早期引用；
- 自动代理创建器把原始对象替换为代理；
- 外部调用经过代理时，事务和日志才会执行。

Spring 的“魔法”到这里已经被还原为一组有序、可预测的动作。

---

## 十二、排查问题时的实用顺序

遇到 Spring 注入或 AOP 问题时，可以按以下顺序排查。

### 1. 这个对象真的是 Spring Bean 吗

如果对象由业务代码直接 `new` 出来，它通常不会自动经历完整的容器生命周期，也不会自动获得依赖注入和 AOP 增强。

```java
OrderService service = new OrderService(...);
```

先确认实例来源，而不是先怀疑注解失效。

### 2. 容器中保存的是原始对象还是代理

可以观察运行时类型，或使用 Spring AOP 工具判断代理类型。重点不是类名看起来奇怪，而是确认调用方持有的引用是否为代理。

### 3. 调用是否真的经过代理

检查是否存在：

- 同类自调用；
- 构造器或 `@PostConstruct` 中调用增强方法；
- 私有方法、`final` 方法；
- 从未进入 Spring 管理的对象调用链。

### 4. 注入发生在哪个阶段

如果字段为 `null`，要判断当前代码是否运行得过早：

- 是否在构造器里读取字段注入的依赖；
- 当前类是否是特殊的基础设施 Bean，创建得早于普通后置处理器；
- 对象是否根本不是由容器创建。

### 5. 作用域是否和使用方式匹配

`prototype`、request、session 等作用域都有各自的获取边界。不要把“定义为原型”误解成“注入后会自动换引用”。

---

## 十三、真正值得记住的五句话

1. **IoC 是控制权反转，DI 是实现反转的主要手段。**
2. **BeanDefinition 是配方，Bean 是实例；Spring 先收集配方，再创建对象。**
3. **Bean 的主生命周期是实例化、属性填充、初始化。**
4. **`@Autowired` 和 AOP 都依赖 BeanPostProcessor，只是挂载节点和职责不同。**
5. **Spring AOP 的增强存在于代理上，判断是否生效的核心是调用有没有经过代理。**

如果这五句话能够在脑中连成一条流程，那么面对 `@Transactional` 失效、循环依赖、代理类型、初始化顺序等问题时，就不再需要零散背答案。

Spring 核心并不是一堆互不相关的注解。它是一台按固定阶段运行的对象图装配机：先登记配方，再创建实例；先完成依赖，再执行初始化；最后根据需要，把原始对象替换成代理。

**没有魔法，只有生命周期，以及挂在生命周期上的扩展点。**
