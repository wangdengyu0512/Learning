---
title: 把 Spring Boot 拆成一条 refresh() 流水线
description: 从 BeanDefinition、后置处理器、自动配置、AOP 代理到内嵌 Web 服务器，用一条 refresh() 主线还原 Spring Boot 的“魔法”。
date: 2026-10-06
tags: Spring Boot, IoC, 自动配置
featured: true
---

# 把 Spring Boot 拆成一条 `refresh()` 流水线

很多人已经能熟练使用 Spring Boot：写一个 `@SpringBootApplication`，加几个 starter，再配上 `@RestController`、`@Service` 和 `@Transactional`，项目就能跑起来。

可一旦继续追问，问题很快就会变得模糊：

- starter 被放进 classpath 后，自动配置究竟是怎么被发现的？
- 为什么自己声明一个 Bean，Spring Boot 的默认 Bean 就会“自动退让”？
- `@Transactional` 明明加上了，为什么同类方法调用时事务仍然不生效？
- 内嵌 Tomcat 是在所有 Bean 创建完成后才启动的吗？
- 一个 Bean 在什么时候从普通对象变成了代理对象？
- 启动异常到底发生在环境准备、配置解析，还是 Bean 实例化阶段？

这些问题看起来分散，实际上都可以收束到一条主线：

> **Spring Boot 先准备环境并创建 ApplicationContext，再进入 Spring Framework 的 `refresh()`；容器先收集和修改 BeanDefinition，再注册 BeanPostProcessor，最后实例化单例并完成上下文刷新。**

只要抓住这条流水线，自动配置、依赖注入、事务代理、Web 容器和各种启动扩展点，就不再是彼此孤立的“注解魔法”，而是一组有严格先后关系的普通机制。

> 本文按照目录资料所采用的 Spring Boot 4.x / Spring Framework 7 语境整理。版本细节会变化，但 `ApplicationContext.refresh()`、BeanDefinition、两类后置处理器以及代理式 AOP 这条主干长期稳定。

---

## 一、先建立最小模型：容器里到底有什么

先把 Spring 容器想象成一座对象工厂。剥掉注解和各种便捷 API，它至少维护三类关键数据：

1. **BeanDefinition 注册表**：记录“应该怎样创建对象”；
2. **单例池**：保存已经创建完成的单例对象；
3. **后置处理器链**：在蓝图阶段或对象阶段插入扩展逻辑。

可以把它画成下面这样：

```text
配置类、扫描结果、自动配置
            │
            ▼
┌──────────────────────────┐
│ BeanDefinition 注册表     │  ← 对象蓝图
└──────────────────────────┘
            │
       BFPP 修改蓝图
            │
            ▼
       实例化与依赖注入
            │
       BPP 加工实例
            │
            ▼
┌──────────────────────────┐
│ 单例池 singletonObjects   │  ← 最终对象，可能已经是代理
└──────────────────────────┘
```

### 1. BeanDefinition 不是 Bean

`BeanDefinition` 描述的是“怎么造一个 Bean”，其中可能包含：

- Bean 的类型；
- scope；
- 构造参数和属性值；
- 是否懒加载；
- 初始化方法和销毁方法；
- 是否为 primary；
- 依赖关系等元数据。

真正的 Bean 则是按照这份蓝图创建出来的 Java 对象。

这个区分非常重要。Spring 之所以具有强扩展性，正是因为它没有发现一个类后立刻 `new`，而是先把信息登记成 BeanDefinition，留出一个可以统一分析、排序和修改的阶段。

### 2. 理解 Spring 的第一刀：BFPP 与 BPP

Spring 中名字最容易混淆、作用却完全不同的两个接口是：

| 扩展点 | 作用对象 | 典型时机 | 典型用途 |
|---|---|---|---|
| `BeanFactoryPostProcessor` | BeanDefinition | 普通 Bean 实例化之前 | 解析配置类、补充或修改 BeanDefinition |
| `BeanPostProcessor` | Bean 实例 | Bean 初始化前后 | 注入注解字段、创建代理、包装对象 |

可以记成一句话：

> **BFPP 改蓝图，BPP 改实例。**

`ConfigurationClassPostProcessor` 是重要的 BFPP。它负责解析 `@Configuration`、`@Bean`、`@Import`、组件扫描以及自动配置导入，由此不断向注册表补充 BeanDefinition。

`AutowiredAnnotationBeanPostProcessor`、负责 AOP 代理创建的自动代理处理器，则属于 BPP 体系。它们必须先完成注册，随后创建普通 Bean 时才有机会介入。

这也解释了 `refresh()` 中最关键的顺序：

```text
先收齐并修改 BeanDefinition
        ↓
再注册全部 BeanPostProcessor
        ↓
最后批量实例化普通单例
```

如果顺序反过来，很多 Bean 已经创建完成，代理、注入和其他增强就永远没有机会补上。

---

## 二、`SpringApplication.run()`：先准备舞台，再启动容器

一个典型应用从这里开始：

```java
@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

从宏观上看，`run()` 可以压缩成五步：

```text
prepareEnvironment()
        ↓
createApplicationContext()
        ↓
prepareContext()
        ↓
refreshContext()
        ↓
callRunners()
```

### 1. `prepareEnvironment()`：配置必须先到场

Spring Boot 首先建立 `Environment`，收集系统属性、环境变量、命令行参数和配置文件等属性源，并决定激活哪些 profile。

环境必须先准备好，因为后续很多决策都依赖它：

- 当前是 Servlet、Reactive 还是非 Web 应用；
- 哪些配置类应该被启用；
- `@ConditionalOnProperty` 是否成立；
- 配置属性应该绑定成什么值；
- Web 服务应该监听哪个端口。

### 2. `createApplicationContext()`：选择容器类型

Spring Boot 会根据应用类型创建不同的上下文，例如 Servlet Web 应用、响应式应用和普通非 Web 应用使用不同的 `ApplicationContext` 实现。

这个选择不仅是类名不同。不同上下文会在 `refresh()` 的扩展点中执行不同逻辑，例如 Servlet Web 上下文会创建内嵌 Web 服务器。

### 3. `prepareContext()`：把启动类注册进去

主启动类会先被注册成 BeanDefinition，`Environment` 被绑定到上下文，`ApplicationContextInitializer` 也会在这一阶段运行。

注意，此时容器只是完成了准备，绝大多数普通业务 Bean 还没有被创建。

### 4. `refreshContext()`：真正的容器启动主干

这里最终进入 `AbstractApplicationContext.refresh()`。Spring Boot 的大量能力，最后都要落到这条 Spring Framework 流水线上。

### 5. `callRunners()`：容器刷新之后的扩展

`ApplicationRunner` 和 `CommandLineRunner` 都发生在 `refresh()` 返回以后。此时上下文已经刷新完成，Web 服务器通常也已经进入运行状态。

因此，如果某项初始化必须在服务接流量前完成，不应想当然地放进 Runner；更合适的时机可能是 Bean 初始化阶段、`SmartInitializingSingleton`，或者显式的就绪探针控制。

---

## 三、`refresh()` 的 12 个阶段

`AbstractApplicationContext.refresh()` 的骨架可以简化为：

```java
public void refresh() {
    prepareRefresh();
    ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();
    prepareBeanFactory(beanFactory);
    postProcessBeanFactory(beanFactory);
    invokeBeanFactoryPostProcessors(beanFactory);
    registerBeanPostProcessors(beanFactory);
    initMessageSource();
    initApplicationEventMulticaster();
    onRefresh();
    registerListeners();
    finishBeanFactoryInitialization(beanFactory);
    finishRefresh();
}
```

与其死记十二个方法，不如把它们分成五段。

### 第一段：刷新前准备

#### ① `prepareRefresh()`

记录启动时间、切换上下文状态、初始化早期事件集合，并校验必需属性。

#### ② `obtainFreshBeanFactory()`

获取当前上下文使用的 `BeanFactory`。不同上下文实现可能采用不同的刷新策略。

#### ③ `prepareBeanFactory()`

为 BeanFactory 设置类加载器、表达式解析器和一批基础设施组件，并注册处理 `ApplicationContextAware` 等接口的处理器。

#### ④ `postProcessBeanFactory()`

这是留给具体 `ApplicationContext` 子类的扩展点。Web 上下文可以在这里补充 Web 相关 scope 或基础设施。

### 第二段：处理 BeanDefinition

#### ⑤ `invokeBeanFactoryPostProcessors()`

这是第一处关键节点：执行全部 `BeanFactoryPostProcessor`。

在这里，`ConfigurationClassPostProcessor` 会解析配置类和导入关系，触发组件扫描，并把自动配置等内容转换为更多 BeanDefinition。

换句话说，到了这一步结束时，容器才基本知道“需要创建哪些对象”。

### 第三段：建立对象加工链

#### ⑥ `registerBeanPostProcessors()`

容器实例化并注册所有 `BeanPostProcessor`。从此以后，普通 Bean 的创建过程会经过这些处理器。

依赖注入、生命周期注解、AOP 代理等机制，都依赖这里建立起来的加工链。

### 第四段：初始化上下文基础设施

#### ⑦ `initMessageSource()`

初始化国际化消息组件。

#### ⑧ `initApplicationEventMulticaster()`

初始化事件广播器。

#### ⑨ `onRefresh()`

留给上下文子类执行特殊刷新逻辑。对于 Servlet Web 应用，内嵌 Web 服务器会在这一阶段被创建。

#### ⑩ `registerListeners()`

注册应用监听器，并广播此前积压的早期事件。

### 第五段：创建单例并完成刷新

#### ⑪ `finishBeanFactoryInitialization()`

完成 BeanFactory 初始化，其中最重要的动作是预实例化非懒加载单例。

一个普通单例大致会经历：

```text
实例化
  ↓
属性填充 / 依赖注入
  ↓
Aware 回调
  ↓
BeanPostProcessor#postProcessBeforeInitialization
  ↓
@PostConstruct / InitializingBean / init-method
  ↓
BeanPostProcessor#postProcessAfterInitialization
  ↓
进入单例池
```

如果 Bean 需要 AOP 增强，最终进入单例池的对象可能已经不是原始实例，而是代理对象。

#### ⑫ `finishRefresh()`

完成生命周期处理，发布上下文刷新事件；对于 Web 应用，这一阶段还会完成 Web 服务器启动相关动作，使应用正式进入可运行状态。

---

## 四、不要背顺序，要理解三条因果链

### 因果链一：先改蓝图，再造对象

自动配置、组件扫描和 `@Bean` 方法解析都在补充 BeanDefinition。如果 BeanDefinition 尚未收齐就开始大规模创建对象，后续发现的新定义将无法参与同一轮完整装配。

所以 BFPP 必须先于普通单例实例化。

### 因果链二：先注册 BPP，再造普通 Bean

AOP 代理本质上是 BPP 对实例的替换。如果对象先创建，自动代理处理器后注册，那么这个对象就会错过代理窗口。

所以必须是：

```text
invokeBeanFactoryPostProcessors()
        ↓
registerBeanPostProcessors()
        ↓
finishBeanFactoryInitialization()
```

### 因果链三：Web 服务器的创建早于多数业务单例的预实例化

Servlet Web 上下文在 `onRefresh()` 中创建内嵌服务器，而普通非懒单例集中在后面的 `finishBeanFactoryInitialization()` 中创建。

这点很反直觉：并不是所有业务 Bean 都创建完，Spring Boot 才开始触碰 Tomcat。更准确地说，Web 服务器的创建和最终启动分布在刷新后半段的不同节点中；如果随后某个单例初始化失败，整个上下文刷新仍会失败并进入清理流程，应用不会以一个健康的“半启动”状态继续运行。

---

## 五、自动配置：不是魔法，而是延迟导入与条件注册

### 1. starter 负责“把候选能力放进 classpath”

starter 通常是一组经过版本协调的依赖描述。以 Web starter 为例，它把 Spring MVC、JSON 转换和默认内嵌服务器等依赖带入应用。

starter 本身并不等于自动配置。更准确的关系是：

```text
starter：提供依赖和 classpath 条件
自动配置：根据 classpath、Bean、属性和应用类型决定是否注册 Bean
```

### 2. `@SpringBootApplication` 的三部分

它可以理解为以下三个注解的组合：

```java
@SpringBootConfiguration
@EnableAutoConfiguration
@ComponentScan
public class DemoApplication {
}
```

- `@SpringBootConfiguration`：把主类标记为配置类；
- `@ComponentScan`：扫描业务组件；
- `@EnableAutoConfiguration`：导入自动配置候选。

主启动类通常放在项目根包，就是为了让默认组件扫描覆盖所有业务子包。

### 3. 自动配置候选从哪里来

现代 Spring Boot 将自动配置类登记在：

```text
META-INF/spring/
org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

文件中按行写入自动配置类的全限定名。`AutoConfigurationImportSelector` 负责加载候选，而它使用延迟导入机制，让用户配置先得到处理，再处理自动配置。

### 4. `@Conditional` 是筛选器

候选自动配置并不等于最终生效。它们还要经过条件判断，例如：

- `@ConditionalOnClass`：classpath 中存在某个类；
- `@ConditionalOnMissingClass`：不存在某个类；
- `@ConditionalOnBean`：容器中已有某种 Bean；
- `@ConditionalOnMissingBean`：容器中还没有某种 Bean；
- `@ConditionalOnProperty`：配置属性满足要求；
- `@ConditionalOnWebApplication`：当前是 Web 应用。

因此，一段自动配置可以理解为：

```java
@AutoConfiguration
@ConditionalOnClass(SomeClient.class)
@ConditionalOnProperty(
    prefix = "demo.client",
    name = "enabled",
    matchIfMissing = true
)
public class DemoClientAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    DemoClient demoClient(DemoClientProperties properties) {
        return new DemoClient(properties);
    }
}
```

它表达的不是“无条件创建 DemoClient”，而是：

> classpath 中有客户端类、配置没有关闭功能、用户也没有自己声明 DemoClient 时，才提供一个默认实现。

### 5. 为什么用户的 Bean 能覆盖默认 Bean

关键不是 Spring Boot 在最后“发现冲突后删掉默认 Bean”，而是两件事共同作用：

1. 自动配置通过延迟导入，在用户配置之后处理；
2. `@ConditionalOnMissingBean` 在注册阶段检查现有 BeanDefinition。

当自动配置准备注册默认 Bean 时，用户 BeanDefinition 已经在注册表中，于是条件不成立，默认 Bean 从一开始就不会被注册。

这叫 **back off（退让）**，不是覆盖后的替换。

自动配置之间若存在顺序依赖，则应显式使用 `@AutoConfigureBefore`、`@AutoConfigureAfter` 或相应排序机制，而不应依赖偶然的扫描顺序。

---

## 六、AOP：Bean 是怎样被换成代理的

`@Transactional`、`@Async`、`@Cacheable` 看起来属于不同功能，底层却共享一个重要前提：

> **调用必须经过 Spring 创建的代理对象。**

自动代理创建器属于 `BeanPostProcessor`。在 Bean 完成初始化后，它会判断当前 Bean 是否命中某些 Advisor；如果命中，就创建代理并把代理返回给容器。

```text
原始 OrderService
        │
        │ postProcessAfterInitialization
        ▼
OrderService 代理
        │
        ├── 事务拦截器
        ├── 缓存拦截器
        └── 异步拦截器
```

以后其他 Bean 从容器中注入到的通常是代理，而不是原始对象。

### 1. JDK 动态代理与类代理

两类常见策略是：

| 方式 | 原理 | 主要限制 |
|---|---|---|
| JDK 动态代理 | 生成目标接口的实现 | 需要合适的业务接口 |
| CGLIB 类代理 | 生成目标类的子类 | `final` 类或不可覆盖的方法无法按常规方式增强 |

Spring Boot 通常默认启用基于目标类的代理策略，也可以通过 AOP 配置调整。无论使用哪一种，排查问题时真正重要的不是背默认值，而是确认：

- 当前对象是否由 Spring 容器管理；
- 注入到调用方的是原对象还是代理；
- 当前方法能否被代理覆盖或暴露；
- 调用路径是否真正经过代理。

### 2. 为什么 self-invocation 会让事务失效

看下面的代码：

```java
@Service
public class OrderService {

    public void createOrder() {
        saveOrder();
    }

    @Transactional
    public void saveOrder() {
        // 写数据库
    }
}
```

外部调用 `orderService.saveOrder()` 时，调用路径是：

```text
调用方 → OrderService 代理 → TransactionInterceptor → 原始方法
```

但 `createOrder()` 内部调用 `saveOrder()`，本质上相当于：

```java
this.saveOrder();
```

调用已经进入目标对象内部，不会重新绕回代理，所以事务拦截器根本不在这次调用栈中。

正确的问题不是“为什么注解没被扫描到”，而是：

> **这次调用有没有经过代理？**

常见修复方式包括：

1. 把事务方法拆到另一个 Spring Bean，由外部 Bean 调用；
2. 调整事务边界，让入口方法本身承担事务；
3. 在确有必要时使用编织方案，而不是依赖代理式 AOP；
4. 避免把获取自身代理作为常规设计手段，它会增加耦合并掩盖职责问题。

同样的失效模型也适用于 `@Async`、`@Cacheable` 等代理式注解。

---

## 七、请求进入后：从 Tomcat 到 Controller

容器启动完成只是第一阶段。HTTP 请求到达后，Servlet 栈中的主线是：

```text
客户端
  ↓
Tomcat Connector
  ↓
DispatcherServlet
  ↓
HandlerMapping
  ↓
HandlerAdapter
  ↓
Controller 方法
  ↓
HttpMessageConverter / 视图渲染
  ↓
HttpServletResponse
```

几个组件各司其职：

- **HandlerMapping**：根据请求路径、HTTP 方法等信息找到 handler；
- **HandlerAdapter**：知道如何调用不同形态的 handler；
- **参数解析器**：把路径变量、查询参数、请求体等转换成方法参数；
- **HttpMessageConverter**：处理请求体反序列化和响应体序列化；
- **DispatcherServlet**：作为前控制器协调完整流程。

`HandlerMapping` 回答“谁来处理”，`HandlerAdapter` 回答“怎样调用”。两者分离后，DispatcherServlet 不必了解每种 handler 的具体形态。

---

## 八、配置系统：Environment 是一条有序属性源链

`application.yml` 不是 Spring Boot 唯一的配置来源。命令行参数、系统属性、OS 环境变量、profile 文件、默认配置等最终都会被组织为一组有优先级的 `PropertySource`。

查询配置时，可以把 `Environment` 想象为从高优先级到低优先级依次查找：

```text
高优先级来源
    ↓
命中 key 后停止
    ↓
低优先级来源
```

实际完整顺序应以所用 Spring Boot 版本的官方文档为准。工程上更重要的是掌握这个模型：**配置不是被简单合并，而是同名 key 按属性源顺序竞争。**

### `@ConfigurationProperties` 与 `@Value`

对于一组结构化配置，更推荐：

```java
@ConfigurationProperties(prefix = "demo.client")
public class DemoClientProperties {
    private Duration timeout;
    private int maxConnections;
    // getter/setter
}
```

`@ConfigurationProperties` 通过 Binder 完成聚合绑定，支持类型转换、嵌套对象、集合、校验以及 relaxed binding，适合承载一个完整配置域。

`@Value` 更适合少量、离散的值或表达式：

```java
@Value("${demo.client.name:default-client}")
private String clientName;
```

两者差异不应简单理解为“一个能读环境变量、另一个不能”。更准确地说，`@ConfigurationProperties` 对命名变体、结构化对象和类型转换提供了更系统的绑定模型；环境变量的属性名适配还会受到 `Environment` 中系统环境属性源解析规则的影响。

---

## 九、Bean 生命周期与循环依赖：三级缓存不是设计方案

一个典型单例的创建过程可以进一步展开：

```text
构造实例
  ↓
提前暴露对象工厂（必要时）
  ↓
填充属性
  ↓
初始化回调
  ↓
BPP 创建最终代理
  ↓
写入完整单例池
```

所谓三级缓存，主要服务于单例创建过程中的早期引用协调，尤其是在某些 setter/field 注入循环依赖场景下，让已经完成实例化但尚未完整初始化的对象可以被另一方提前引用。

构造器循环依赖则更直接：

```text
创建 A 必须先得到 B
创建 B 又必须先得到 A
```

A 的构造都无法完成，自然没有可提前暴露的 A，容器无法打破这个环。

更重要的是，现代 Spring Boot 默认倾向于拒绝循环依赖。即使某些循环理论上可以通过早期引用解开，也不代表它是合理设计。优先修复方式通常是：

- 重新划分职责；
- 抽取第三个协作组件；
- 使用领域事件解除双向同步调用；
- 重新设计事务边界；
- 只把 `@Lazy` 当作有限场景的逃生手段。

三级缓存应该被理解为容器机制，而不是鼓励业务代码制造依赖环的许可证。

---

## 十、把启动故障映射回流水线

理解 `refresh()` 最大的价值，不是面试时默写方法名，而是缩小排查范围。

### 1. 配置文件没有生效

优先检查 `prepareEnvironment()`：

- profile 是否真的激活；
- 配置文件位置是否正确；
- 是否被更高优先级属性源覆盖；
- key 是否与绑定前缀一致；
- 属性转换或校验是否失败。

### 2. 自动配置没有生效

定位到 BeanDefinition 处理阶段：

- 自动配置类是否登记在 `.imports`；
- `@ConditionalOnClass` 所需依赖是否存在；
- `@ConditionalOnProperty` 是否命中；
- 是否已有 Bean 触发了 `@ConditionalOnMissingBean` 退让；
- 自动配置之间是否缺少顺序声明。

Spring Boot 的条件评估报告通常是这类问题的重要入口。

### 3. `@Transactional`、`@Async` 或缓存注解失效

定位到 BPP 与代理阶段：

- 对象是不是 Spring Bean；
- 自动代理处理器是否注册；
- 调用是否经过代理；
- 是否发生 self-invocation；
- 方法可见性、类和方法修饰符是否允许当前代理方式增强；
- 是否在异常被吞掉后才误以为事务没有回滚。

### 4. 启动时出现 `BeanCurrentlyInCreationException`

定位到单例实例化和依赖注入阶段：

- 是否存在构造器依赖环；
- 是否通过 `@Lazy` 暂时掩盖了设计问题；
- 某个 BPP 是否导致 Bean 被过早创建；
- 依赖关系是否可以通过拆分职责消除。

### 5. Runner 执行期间服务已经能收到请求

Runner 位于 `refresh()` 之后。若初始化是“接流量前必须完成”的硬条件，不要只依赖 `ApplicationRunner`。可以考虑：

- 把必要初始化放到更早且语义匹配的生命周期阶段；
- 使用 `SmartInitializingSingleton`；
- 让 readiness probe 在初始化完成前保持失败；
- 将耗时预热拆成可观测、可重试的独立过程。

---

## 十一、一张图记住整套机制

```text
SpringApplication.run()
│
├─ 1. prepareEnvironment
│     └─ 配置文件 / 环境变量 / 命令行 / profiles
│
├─ 2. createApplicationContext
│     └─ Servlet / Reactive / 普通上下文
│
├─ 3. prepareContext
│     └─ 注册主启动类、执行 Initializer
│
├─ 4. refreshContext
│     │
│     └─ AbstractApplicationContext.refresh()
│           │
│           ├─ 准备 BeanFactory
│           │
│           ├─ 执行 BFPP
│           │    └─ 解析配置类、扫描组件、导入自动配置
│           │
│           ├─ 注册 BPP
│           │    └─ 注入、生命周期、AOP 代理处理器
│           │
│           ├─ onRefresh
│           │    └─ Web 上下文创建内嵌服务器
│           │
│           ├─ 实例化非懒单例
│           │    └─ 注入 → 初始化 → 代理 → 单例池
│           │
│           └─ finishRefresh
│                └─ 生命周期完成、发布事件、Web 服务就绪
│
└─ 5. callRunners
      └─ ApplicationRunner / CommandLineRunner
```

沿着这张图再看 Spring Boot 的几个高频概念：

- **组件扫描**：向 BeanDefinition 注册表添加蓝图；
- **自动配置**：延迟导入、条件筛选后添加默认蓝图；
- **依赖注入**：Bean 创建过程中由 BPP 等基础设施参与完成；
- **事务、缓存、异步**：BPP 把原始 Bean 替换成代理；
- **内嵌 Tomcat**：Web ApplicationContext 在刷新过程中创建并启动；
- **Runner**：容器刷新完成后的应用级回调。

所有“魔法”都可以被放回一个明确阶段。

---

## 十二、结语：从记注解，升级到看时序

学习 Spring Boot 最容易陷入两个极端：

一个极端是只会用注解，把框架当黑盒；另一个极端是钻进源码细节，记住大量类名，却没有一条能组织这些知识的主线。

`refresh()` 提供了中间那条路。

你不必一开始就记住每个实现类，但应当稳定掌握下面四个判断：

1. **当前问题发生在 BeanDefinition 阶段，还是 Bean 实例阶段？**
2. **这个扩展点属于 BFPP、BPP，还是 refresh 之后的应用回调？**
3. **这个注解是在注册 Bean，还是在给 Bean 创建代理？**
4. **当前调用拿到的是容器代理，还是已经绕回原始对象内部？**

最后把整篇文章压缩成一句话：

> **Spring Boot 先用 Environment 决定运行条件，再在 `refresh()` 中收集 BeanDefinition、执行条件化自动配置、注册 BeanPostProcessor、创建并加工 Bean，最后完成 Web 上下文和应用生命周期；所谓“魔法”，只是这条流水线上有序发生的扩展。**

当你能从这条流水线定位问题时，Spring Boot 就不再是一组需要背诵的注解，而是一台可以推导、可以调试、也可以扩展的容器机器。
