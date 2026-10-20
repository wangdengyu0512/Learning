"use client";

import { useEffect, useMemo, useState } from "react";

type View = "all" | "objects" | "rules" | "timeline";
type NodeKind = "core" | "object" | "context" | "rule" | "event" | "action";

type GraphNode = {
  id: string;
  label: string;
  value: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  description: string;
};

type GraphEdge = {
  from: string;
  to: string;
  label: string;
  views: View[];
};

const nodes: GraphNode[] = [
  { id: "run", label: "加工事件", value: "Process Run · PR-88731", kind: "core", x: 480, y: 294, width: 236, description: "2026-10-20 14:32:08 至 14:38:41，晶圆 W12 在 CH-B 完成刻蚀工序 OP-ETCH-120。" },
  { id: "lot", label: "生产对象", value: "LOT-24A17 · W12", kind: "object", x: 132, y: 118, width: 190, description: "产品 P28N，当前位于 Route R28-06 的刻蚀站点，优先级为 Hot Lot。" },
  { id: "operation", label: "工艺步骤", value: "OP-ETCH-120", kind: "object", x: 128, y: 276, width: 180, description: "关键层刻蚀步骤，前序为光刻显影，后序需要 CD-SEM 抽样量测。" },
  { id: "material", label: "物料批次", value: "Photoresist · PR-9C", kind: "object", x: 115, y: 430, width: 194, description: "本次加工关联光刻胶批次 PR-9C，并保留供应商、有效期和领用记录。" },
  { id: "location", label: "空间位置", value: "FAB 2 · Bay 14", kind: "context", x: 478, y: 72, width: 184, description: "设备所在厂区、洁净间与 Bay 层级，为环境和厂务数据提供空间上下文。" },
  { id: "equipment", label: "设备 / 腔体", value: "ETCH-07 · CH-B", kind: "object", x: 794, y: 116, width: 192, description: "300 mm 等离子刻蚀设备。CH-B 距上次 PM 已加工 486 片，健康度 87%。" },
  { id: "recipe", label: "配方版本", value: "ETCH-R42 · v8.3", kind: "context", x: 820, y: 278, width: 194, description: "批准版本 v8.3；关键参数包括腔压、RF 功率、气体流量和阶段时长。" },
  { id: "signal", label: "动态事件", value: "Pressure drift · +2.1σ", kind: "event", x: 790, y: 454, width: 220, description: "主刻蚀阶段腔压连续上移，仍未越规格限，但已触发 SPC 趋势规则。" },
  { id: "metrology", label: "量测结果", value: "CD-SEM-03 · 31.8 nm", kind: "event", x: 486, y: 530, width: 224, description: "目标值 30.0 nm，上控制限 32.0 nm；结果接近控制边界并进入加严抽样。" },
  { id: "rule", label: "业务规则", value: "SPC-R17 · 连续上升", kind: "rule", x: 290, y: 505, width: 206, description: "连续 6 个点同向漂移时触发风险判定，并检查受同一腔体影响的在制批次。" },
  { id: "hold", label: "执行动作", value: "Hold LOT-24A17", kind: "action", x: 478, y: 404, width: 190, description: "系统提交批次暂停和追加量测建议，等待良率工程师复核后决定 Release 或返工。" },
];

const edges: GraphEdge[] = [
  { from: "lot", to: "run", label: "被加工", views: ["all", "objects", "timeline"] },
  { from: "operation", to: "run", label: "实例化", views: ["all", "objects"] },
  { from: "material", to: "run", label: "投入", views: ["all", "objects"] },
  { from: "location", to: "equipment", label: "位于", views: ["all", "objects"] },
  { from: "equipment", to: "run", label: "执行于", views: ["all", "objects", "timeline"] },
  { from: "recipe", to: "run", label: "使用", views: ["all", "objects"] },
  { from: "run", to: "signal", label: "产生 Trace", views: ["all", "timeline"] },
  { from: "run", to: "metrology", label: "后续量测", views: ["all", "timeline"] },
  { from: "signal", to: "rule", label: "命中", views: ["all", "rules", "timeline"] },
  { from: "metrology", to: "rule", label: "验证", views: ["all", "rules"] },
  { from: "rule", to: "hold", label: "触发", views: ["all", "rules", "timeline"] },
  { from: "hold", to: "lot", label: "改变状态", views: ["all", "rules", "timeline"] },
];

const viewLabels: Array<{ id: View; label: string }> = [
  { id: "all", label: "全景" }, { id: "objects", label: "对象" },
  { id: "rules", label: "规则" }, { id: "timeline", label: "演化" },
];

const timeline = ["14:32 进腔", "14:36 压力漂移", "14:43 SPC 命中", "15:08 量测回传", "15:09 Lot Hold"];

function edgePath(from: GraphNode, to: GraphNode) {
  const dx = to.x - from.x;
  const bend = Math.min(72, Math.abs(dx) * 0.16 + 18);
  return `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 + (dx > 0 ? bend : -bend)} ${to.x} ${to.y}`;
}

export function OntologyGraph() {
  const [view, setView] = useState<View>("all");
  const [selectedId, setSelectedId] = useState("run");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 2600);
    return () => window.clearInterval(timer);
  }, []);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), []);
  const visibleEdges = edges.filter((edge) => edge.views.includes(view));
  const visibleNodeIds = new Set(visibleEdges.flatMap((edge) => [edge.from, edge.to]));
  visibleNodeIds.add("run");
  const selected = nodeMap.get(selectedId) ?? nodes[0];
  const pulseEdge = visibleEdges[tick % visibleEdges.length];

  return (
    <section className="ontology-graph" aria-label="半导体工厂时空本体动态图谱">
      <header className="ontology-graph__header">
        <div>
          <p className="ontology-graph__eyebrow"><span />SEMICONDUCTOR FAB ONTOLOGY</p>
          <h3>企业时空本体 · 制造实例图谱</h3>
          <p>统一连接对象、空间、时间、规则与动作，让一次晶圆加工成为可理解、可计算、可执行的业务事实。</p>
        </div>
        <div className="ontology-graph__views" aria-label="图谱视角">
          {viewLabels.map((item) => (
            <button aria-pressed={view === item.id} className={view === item.id ? "is-active" : ""} key={item.id} onClick={() => setView(item.id)} type="button">
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="ontology-graph__stage">
        <div className="ontology-graph__status"><i /> LIVE INSTANCE <span>FAB 2 / 2026-10-20</span></div>
        <svg aria-labelledby="ontology-graph-title" role="img" viewBox="0 0 960 600">
          <title id="ontology-graph-title">晶圆加工事件与设备、配方、量测、规则和处置动作之间的本体关系</title>
          <defs>
            <filter id="ontology-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <marker id="ontology-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0,0 L7,3.5 L0,7 Z" /></marker>
          </defs>

          <g className="ontology-grid">
            {Array.from({ length: 12 }, (_, index) => <line key={`v-${index}`} x1={index * 80} x2={index * 80} y1="0" y2="600" />)}
            {Array.from({ length: 8 }, (_, index) => <line key={`h-${index}`} x1="0" x2="960" y1={index * 80} y2={index * 80} />)}
          </g>

          <g className="ontology-edges">
            {visibleEdges.map((edge, index) => {
              const from = nodeMap.get(edge.from)!;
              const to = nodeMap.get(edge.to)!;
              const path = edgePath(from, to);
              const active = edge === pulseEdge || edge.from === selectedId || edge.to === selectedId;
              return (
                <g className={active ? "is-active" : ""} key={`${edge.from}-${edge.to}`}>
                  <path className="ontology-edge-hit" d={path} />
                  <path className="ontology-edge" d={path} markerEnd="url(#ontology-arrow)" />
                  <path d={path} fill="none" id={`edge-${index}`} stroke="none" />
                  <text className="ontology-edge-label" dy="-7"><textPath href={`#edge-${index}`} startOffset="50%" textAnchor="middle">{edge.label}</textPath></text>
                  {active && <circle className="ontology-particle" filter="url(#ontology-glow)" r="4"><animateMotion dur="2.2s" path={path} repeatCount="indefinite" /></circle>}
                </g>
              );
            })}
          </g>

          <g className="ontology-nodes">
            {nodes.map((node) => {
              const visible = visibleNodeIds.has(node.id);
              const active = node.id === selectedId;
              const height = node.kind === "core" ? 82 : 62;
              return (
                <g
                  className={`ontology-node ontology-node--${node.kind}${active ? " is-selected" : ""}${visible ? "" : " is-muted"}`}
                  key={node.id}
                  onClick={() => setSelectedId(node.id)}
                  role="button"
                  tabIndex={visible ? 0 : -1}
                  transform={`translate(${node.x - node.width / 2} ${node.y - height / 2})`}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(node.id); }}
                >
                  <rect height={height} rx="5" width={node.width} />
                  <circle cx="17" cy="17" r="4" />
                  <text className="ontology-node-label" x="29" y="21">{node.label}</text>
                  <text className="ontology-node-value" x="16" y={node.kind === "core" ? 52 : 44}>{node.value}</text>
                  {node.kind === "core" && <path className="ontology-core-orbit" d={`M ${node.width - 47} 29 a 16 16 0 1 0 0.1 0`} />}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="ontology-graph__footer">
        <div className="ontology-graph__detail">
          <span>{selected.label}</span><strong>{selected.value}</strong><p>{selected.description}</p>
        </div>
        <ol className="ontology-graph__timeline" aria-label="事件时间轴">
          {timeline.map((item, index) => <li className={index <= tick % timeline.length ? "is-past" : ""} key={item}>{item}</li>)}
        </ol>
      </div>

      <div className="ontology-graph__legend" aria-label="节点类型">
        <span><i className="object" />业务对象</span><span><i className="context" />时空上下文</span>
        <span><i className="event" />事件与量测</span><span><i className="rule" />规则</span><span><i className="action" />执行动作</span>
      </div>
    </section>
  );
}
