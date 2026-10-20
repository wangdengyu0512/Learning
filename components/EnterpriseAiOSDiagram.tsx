import type { ReactNode } from "react";

const workforceCapabilities = [
  ["目标解析", "业务目标与约束识别"], ["任务原子化", "拆解为可路由任务"],
  ["优先级队列", "动态多级调度"], ["智能路由", "匹配最优智能体节点"],
  ["结果聚合", "校验一致性并汇总"], ["故障恢复", "跨层同步与自动接管"],
];

const agentCapabilities = [
  ["Agent Runtime", "推理、生成与业务操作"], ["A2A 协议总线", "跨域协作与任务交接"],
  ["技能与工具注册", "API / MCP / 企业系统"], ["上下文与记忆", "会话、任务与长期经验"],
  ["执行监控", "Trace、健康度与成本"], ["策略护栏", "权限、审批与风险控制"],
];

const dataCapabilities = [
  ["连接器与事件流", "ERP / CRM / OA / IoT"], ["WBM 语义层", "对象、关系、状态与规则"],
  ["异构存储", "湖仓 / 数据库 / 向量库"], ["联邦查询", "跨库检索与数据虚拟化"],
  ["Schema 演进", "版本兼容与契约治理"], ["血缘与质量", "审计、分级与异常修复"],
];

function CapabilityGrid({ items }: { items: string[][] }) {
  return <div className="aios-capabilities">{items.map(([title, description], index) => (
    <div className="aios-capability" key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><small>{description}</small></div></div>
  ))}</div>;
}

function WorkforceInstance() {
  return <aside className="aios-instance aios-instance--workforce" aria-label="专业智能体员工实例">
    <div className="aios-instance__top"><span>EMPLOYEE NODE</span><i>待机</i></div>
    <strong className="aios-instance__id">WF-E6-4Q</strong><h4>供应链协调员</h4>
    <div className="aios-instance__metrics">
      <div><span>部门</span><strong>供应链</strong></div><div><span>负载</span><strong>68%</strong></div>
      <div><span>级别</span><strong>L2</strong></div><div><span>上线时间</span><strong>2024-11</strong></div>
    </div>
    <div className="aios-instance__task"><span>当前任务</span><strong>预测库存缺口风险</strong></div>
    <div className="aios-load"><span style={{ width: "68%" }} /></div>
  </aside>;
}

function AgentInstance() {
  return <aside className="aios-instance aios-instance--agent" aria-label="智能体任务实例">
    <div className="aios-instance__top"><span>TASK · WF-A7-3Z</span><i>审核中</i></div>
    <h4>项目里程碑风险预警</h4><p>持续执行并汇报状态更新</p>
    <div className="aios-task-status"><span><i />82%</span><small>最近更新 5m</small></div>
    <div className="aios-progress"><span style={{ width: "82%" }} /></div>
    <dl><div><dt>目标</dt><dd>排班规划与资源调度优化</dd></div><div><dt>当前动作</dt><dd>发送异常升级通知</dd></div><div><dt>风险等级</dt><dd>低</dd></div></dl>
  </aside>;
}

function DataInstance() {
  return <aside className="aios-instance aios-instance--data" aria-label="企业数据库节点实例">
    <div className="aios-instance__top"><span>DATABASE · NODE-36</span><i>管控</i></div><h4>业务流程与执行状态</h4>
    <div className="aios-data-facts">
      <div><span>更新频率</span><strong>每小时刷新</strong></div><div><span>数据规模</span><strong>5,900k</strong></div>
      <div><span>负责方</span><strong>风险与合规团队</strong></div><div><span>保留期限</span><strong>5 年</strong></div>
    </div>
    <div className="aios-quality"><span>QUALITY</span><p>异常补录与人工审核工作流已配置</p></div>
  </aside>;
}

function Layer({ className, index, english, title, description, metrics, capabilities, instance }: {
  className: string; index: string; english: string; title: string; description: string;
  metrics: Array<[string, string]>; capabilities: string[][]; instance: ReactNode;
}) {
  return <article className={`aios-layer ${className}`}>
    <div className="aios-layer__identity">
      <span className="aios-layer__index">{index}</span><p>{english}</p><h3>{title}</h3><p>{description}</p>
      <div className="aios-layer__metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    </div>
    <CapabilityGrid items={capabilities} />{instance}
  </article>;
}

export function EnterpriseAiOSDiagram() {
  return <section className="enterprise-aios" aria-labelledby="enterprise-aios-title">
    <header className="enterprise-aios__header">
      <div><p className="enterprise-aios__eyebrow"><span />WBM · ENTERPRISE INTELLIGENCE RUNTIME</p><h2 id="enterprise-aios-title">企业 AI 操作系统</h2><p>以世界行为模型连接企业数据、智能体协作与数字员工集群，形成可感知、可决策、可执行、可反馈的智能生产力闭环。</p></div>
      <div className="enterprise-aios__status"><i />SYSTEM ONLINE <span>3 LAYERS / 42 NODES</span></div>
    </header>

    <div className="aios-goal"><span>BUSINESS GOAL</span><strong>从经营目标到自主执行</strong><ol aria-label="世界行为模型认知与执行链路"><li>感知</li><li>理解</li><li>推理</li><li>分析</li><li>任务决策</li><li>执行编排</li></ol></div>

    <div className="aios-flow-map">
      <aside className="aios-flow-rail" aria-label="双向数据流">
        <div className="aios-flow-rail__label"><span>WBM</span><strong>世界行为模型</strong><small>统一业务语义与状态</small></div>
        <div className="aios-flow aios-flow--down"><span>目标 · 任务 · 指令</span><i /><b>↓</b></div>
        <div className="aios-flow aios-flow--up"><b>↑</b><i /><span>数据 · 状态 · 反馈</span></div>
        <div className="aios-wbm-model"><span>对象</span><span>关系</span><span>状态</span><span>规则</span><span>行为</span><span>结果</span></div>
      </aside>

      <div className="aios-layers">
        <Layer capabilities={workforceCapabilities} className="aios-layer--workforce" description="任务编排的顶层控制平面，将业务目标拆解为原子任务，路由至最优节点并聚合结果。" english="AGENT WORKFORCE" index="L3" instance={<WorkforceInstance />} metrics={[["队列", "多优先级"], ["路由", "动态"], ["延迟", "低延迟"]]} title="专业智能体员工队伍" />
        <div className="aios-layer-link" aria-hidden="true"><span>原子任务 / SLA / 权限上下文</span><i /><span>执行状态 / 聚合结果</span></div>
        <Layer capabilities={agentCapabilities} className="aios-layer--agent" description="由专业 AI 智能体组成的协同执行层，接收编排指令，完成推理、生成与业务操作。" english="AGENT OS" index="L2" instance={<AgentInstance />} metrics={[["智能体", "多实例"], ["协议", "A2A"], ["模式", "并行"]]} title="企业智能体操作系统" />
        <div className="aios-layer-link" aria-hidden="true"><span>查询 / 写入 / 工具调用</span><i /><span>上下文 / 事件 / 证据</span></div>
        <Layer capabilities={dataCapabilities} className="aios-layer--data" description="分布式企业级数据与知识基础设施，为智能体提供可信、可追溯、可联邦查询的认知底座。" english="DATA OS" index="L1" instance={<DataInstance />} metrics={[["节点", "42"], ["类型", "分布式"], ["角色", "持久化"]]} title="企业数据与知识底座" />
      </div>
    </div>

    <footer className="enterprise-aios__footer">
      <div><span>01</span><strong>向下控制流</strong><p>目标被拆解、路由并转化为可执行动作。</p></div>
      <div><span>02</span><strong>向上认知流</strong><p>数据、状态、证据与结果持续回流。</p></div>
      <div><span>03</span><strong>闭环进化</strong><p>结果校验后更新知识、规则、记忆与策略。</p></div>
    </footer>
  </section>;
}
