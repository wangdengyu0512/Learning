"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./EnterpriseAiOSScene.module.css";

type LayerId = "workforce" | "agents" | "data";
type Point = { x: number; y: number };
type Plane = { x: number; y: number; width: number; skew: number; rise: number; depth: number };
type SceneNode = { id: string; layer: LayerId; title: string; description: string; u: number; v: number; kind: "person" | "agent" | "database" };

const layers: Record<LayerId, { name: string; subtitle: string; description: string; plane: Plane }> = {
  workforce: {
    name: "Agent Workforce", subtitle: "专业智能体员工队伍",
    description: "把经营目标转化为岗位职责与任务，由数字员工组织协作、交付结果。",
    plane: { x: 650, y: 105, width: 600, skew: -230, rise: 53, depth: 104 },
  },
  agents: {
    name: "Agent OS", subtitle: "企业智能体操作系统",
    description: "以运行时、工具、记忆与策略连接智能体，让推理转化为可治理的业务行动。",
    plane: { x: 470, y: 240, width: 800, skew: -260, rise: 70, depth: 132 },
  },
  data: {
    name: "Data OS", subtitle: "企业数据与知识底座",
    description: "将业务系统、实时事件和企业知识组织为可信数据网络，通过世界行为模型统一语义。",
    plane: { x: 330, y: 375, width: 1000, skew: -290, rise: 88, depth: 136 },
  },
};

const roles = ["经营分析师", "供应链协调员", "生产计划员", "质量工程师", "客户经理", "财务分析师", "研发助手", "设备工程师", "采购专员", "人力资源助手", "项目经理", "合规专员"];
const agentNames = ["目标解析", "任务编排", "智能路由", "Agent Runtime", "A2A 协作", "工具注册", "上下文", "长期记忆", "策略护栏", "执行监控", "结果校验", "故障恢复"];
const dataNames = ["ERP", "CRM", "MES", "IoT", "企业本体", "知识库", "湖仓", "事件流", "向量索引", "数据血缘", "业务规则", "主数据"];
const dataDescriptions = ["订单、采购、库存与财务事实。", "客户关系、商机与服务记录。", "工单、工艺、生产进度与质量记录。", "设备遥测、告警和实时运行状态。", "统一对象、关系、状态、规则与行为语义。", "制度、文档和经过验证的业务经验。", "汇集结构化与非结构化历史数据。", "传递业务状态变化与系统事件。", "按语义检索相关知识和上下文。", "追踪数据来源、转换过程和使用关系。", "表达约束、决策条件和审批要求。", "对齐客户、产品、设备等核心业务对象。"];
const nodes: SceneNode[] = [
  ...roles.map((title, i): SceneNode => ({ id: `worker-${i}`, layer: "workforce", title, description: `${title}在明确的权限与任务范围内，调用专业智能体完成工作，并向业务负责人反馈结果。`, u: 0.12 + (i % 6) * 0.15, v: 0.24 + Math.floor(i / 6) * 0.4, kind: "person" })),
  ...agentNames.map((title, i): SceneNode => ({ id: `agent-${i}`, layer: "agents", title, description: `${title}是 Agent OS 的执行能力，通过共享任务上下文与其他能力协作，支撑数字员工完成业务任务。`, u: 0.1 + (i % 6) * 0.155, v: 0.22 + Math.floor(i / 6) * 0.4, kind: "agent" })),
  ...dataNames.map((title, i): SceneNode => ({ id: `data-${i}`, layer: "data", title, description: dataDescriptions[i], u: 0.1 + (i % 4) * 0.26, v: 0.15 + Math.floor(i / 4) * 0.27, kind: "database" })),
];

function project(plane: Plane, u: number, v: number): Point {
  return { x: plane.x + u * plane.width + v * plane.skew, y: plane.y + u * plane.rise + v * plane.depth };
}
function coords(point: Point) { return `${point.x},${point.y}`; }
function line(a: Point, b: Point) { return `M ${coords(a)} L ${coords(b)}`; }

function Platform({ id }: { id: LayerId }) {
  const { plane, name, subtitle } = layers[id];
  const corners = [project(plane, 0, 0), project(plane, 1, 0), project(plane, 1, 1), project(plane, 0, 1)];
  const lower = (p: Point) => ({ x: p.x, y: p.y + 12 });
  const label = project(plane, 0.035, 0.91);
  return <g>
    <path d={`M ${coords(corners[3])} L ${coords(corners[2])} L ${coords(lower(corners[2]))} L ${coords(lower(corners[3]))} Z`} fill="#111b29" stroke="#30435d" />
    <path d={`M ${coords(corners[2])} L ${coords(corners[1])} L ${coords(lower(corners[1]))} L ${coords(lower(corners[2]))} Z`} fill="#101722" stroke="#30435d" />
    <polygon points={corners.map(coords).join(" ")} fill={`url(#scene-plane-${id})`} stroke="#435872" strokeWidth="1.2" />
    <g stroke="#7a9dc3" strokeOpacity=".09" strokeWidth=".65">
      {Array.from({ length: 17 }, (_, i) => <path key={`u-${i}`} d={line(project(plane, i / 16, 0), project(plane, i / 16, 1))} />)}
      {Array.from({ length: 8 }, (_, i) => <path key={`v-${i}`} d={line(project(plane, 0, i / 7), project(plane, 1, i / 7))} />)}
    </g>
    <path d={line(corners[3], corners[2])} stroke="#69b9ff" strokeOpacity=".65" strokeWidth="1.5" />
    <g transform={`translate(${label.x} ${label.y}) rotate(6.3)`}>
      <text fill="#eff7ff" fontSize="21" fontWeight="600">{name}</text>
      <text fill="#9aafc9" fontSize="11" y="18">{subtitle}</text>
    </g>
  </g>;
}

function NodeShape({ kind }: { kind: SceneNode["kind"] }) {
  if (kind === "person") return <g>
    <ellipse cy="5" rx="21" ry="7" fill="#69b9ff" opacity=".12" />
    <path d="M -9 -19 L -10 0 L -4 2 L 0 -14 L 4 3 L 10 1 L 9 -19" fill="#99c7f6" />
    <path d="M -10 -40 Q 0 -46 10 -40 L 16 -20 L 11 -18 L 6 -31 L 7 -15 L -8 -15 L -7 -31 L -12 -19 L -17 -22 Z" fill="url(#scene-person)" stroke="#c0e1ff" strokeWidth=".6" />
    <circle cy="-53" r="8" fill="#bddcfa" stroke="#e2f1ff" strokeWidth=".8" />
    <path d="M 0 -42 L 1 -20" stroke="#d6ebff" opacity=".55" />
  </g>;
  if (kind === "agent") return <g>
    <ellipse cy="5" rx="25" ry="9" fill="#5eb9ff" opacity=".13" />
    <path d="M -19 -39 L -5 -47 L 21 -38 L 6 -29 Z" fill="#a5c9ed" stroke="#d0e8ff" />
    <path d="M -19 -39 L 6 -29 L 6 1 L -19 -10 Z" fill="url(#scene-agent)" stroke="#91bce6" />
    <path d="M 6 -29 L 21 -38 L 21 -8 L 6 1 Z" fill="#3e668f" stroke="#91bce6" />
    <path d="M -13 -25 L -1 -20 M -13 -18 L -1 -13" stroke="#d5edff" strokeWidth="2" />
    <circle cx="13" cy="-14" r="2" fill="#a2f0d8" />
  </g>;
  return <g>
    <ellipse cy="5" rx="27" ry="9" fill="#72baff" opacity=".12" />
    <path d="M -20 -28 L -20 -5 C -20 8 20 8 20 -5 L 20 -28" fill="url(#scene-agent)" stroke="#8ab6e2" />
    <ellipse cy="-28" rx="20" ry="8" fill="#8eb8df" stroke="#c7e2fa" />
    <path d="M -20 -18 C -20 -5 20 -5 20 -18 M -20 -9 C -20 4 20 4 20 -9" fill="none" stroke="#9cc9f1" />
  </g>;
}

export function EnterpriseAiOSScene() {
  const [focus, setFocus] = useState<LayerId | "all">("all");
  const [selected, setSelected] = useState<SceneNode | null>(null);
  const [zoom, setZoom] = useState(100);
  const activeLayer = selected?.layer ?? (focus === "all" ? null : focus);
  const detail = selected ?? (activeLayer ? { title: layers[activeLayer].name, description: layers[activeLayer].description } : { title: "从数据到行动，再从行动回到认知", description: "选择图层或节点，查看数据底座、智能体运行时与数字员工之间的关系。图中节点与连线为架构示意。" });
  function chooseLayer(id: LayerId | "all") { setFocus(id); setSelected(null); }

  return <section className={styles.scene} aria-labelledby="ai-os-scene-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>WBM / ENTERPRISE ARCHITECTURE</p><h1 id="ai-os-scene-title">企业 AI 操作系统</h1></div>
      <div className={styles.headerRight}><span className={styles.badge}>三层协同 · 认知与执行闭环</span><Link prefetch={false} href="/posts/enterprise-ai-operating-system-wbm/">阅读架构说明 ↗</Link></div>
    </header>
    <div className={styles.toolbar}>
      <div className={styles.tabs} role="group" aria-label="架构图层">
        <button type="button" aria-pressed={focus === "all"} onClick={() => chooseLayer("all")}>全景</button>
        {(Object.keys(layers) as LayerId[]).map(id => <button type="button" key={id} aria-pressed={focus === id} onClick={() => chooseLayer(id)}>{layers[id].name}</button>)}
      </div>
      <div className={styles.zoom} role="group" aria-label="画布缩放">
        <button type="button" aria-label="缩小" disabled={zoom <= 75} onClick={() => setZoom(value => value - 25)}>−</button>
        <output aria-live="polite">{zoom}%</output>
        <button type="button" aria-label="放大" disabled={zoom >= 175} onClick={() => setZoom(value => value + 25)}>+</button>
        <button type="button" onClick={() => { setZoom(100); chooseLayer("all"); }}>重置</button>
      </div>
    </div>
    <div className={styles.viewport} tabIndex={0} aria-label="三层立体架构画布，可横向滚动">
      <svg className={styles.canvas} style={{ width: `${zoom}%`, minWidth: `${9 * zoom}px` }} viewBox="0 0 1600 650" role="group" aria-labelledby="scene-svg-title scene-svg-description">
        <title id="scene-svg-title">Agent Workforce、Agent OS、Data OS 三层立体架构</title>
        <desc id="scene-svg-description">顶部数字员工调用中层智能体能力，中层读取底层企业数据与知识。虚线表示跨层指令和反馈，节点可点击或使用键盘选择。</desc>
        <defs>
          {(Object.keys(layers) as LayerId[]).map(id => <linearGradient key={id} id={`scene-plane-${id}`} x1="0" y1="0" x2=".7" y2="1"><stop stopColor="#1c293a" stopOpacity=".98" /><stop offset="1" stopColor="#111b29" stopOpacity=".98" /></linearGradient>)}
          <linearGradient id="scene-person" x2="1" y2="1"><stop stopColor="#d7eaff" /><stop offset="1" stopColor="#6b9ecb" /></linearGradient>
          <linearGradient id="scene-agent" x2="1" y2="1"><stop stopColor="#6998c9" /><stop offset="1" stopColor="#355475" /></linearGradient>
          <radialGradient id="scene-aura"><stop stopColor="#173452" stopOpacity=".35" /><stop offset="1" stopColor="#0c1016" stopOpacity="0" /></radialGradient>
          <marker id="scene-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#67b8f6" /></marker>
        </defs>
        <ellipse cx="810" cy="385" rx="700" ry="260" fill="url(#scene-aura)" />
        <g className={styles.connectors} fill="none" stroke="#67b8f6" strokeWidth="1.2" strokeDasharray="5 8" markerEnd="url(#scene-arrow)">
          <path d="M 435 220 C 260 235 180 300 180 360 C 100 385 60 420 65 470" />
          <path d="M 1355 510 C 1470 450 1440 355 1320 340 C 1420 260 1370 185 1265 180" />
        </g>
        <g fill="#829bb5" fontSize="12"><text x="190" y="265">目标 · 任务 · 指令</text><text x="1340" y="390">状态 · 结果 · 反馈</text></g>
        {(["data", "agents", "workforce"] as LayerId[]).map(id => {
          const layerNodes = nodes.filter(node => node.layer === id);
          const plane = layers[id].plane;
          const muted = activeLayer !== null && activeLayer !== id;
          return <g key={id} className={`${styles.layer} ${muted ? styles.muted : ""}`}>
            <Platform id={id} />
            <g fill="none" stroke="#68b8f2" strokeWidth="1" opacity={id === "data" ? ".6" : ".3"}>
              {layerNodes.slice(0, -1).map((node, i) => {
                const next = layerNodes[i + 1];
                const a = project(plane, node.u, node.v);
                const b = project(plane, next.u, next.v);
                const mid = project(plane, next.u, node.v);
                return <path key={node.id} className={styles.network} d={`M ${coords(a)} L ${coords(mid)} L ${coords(b)}`} />;
              })}
              {id === "data" && [0, 1, 2, 3].map(i => <path key={i} d={line(project(plane, layerNodes[i].u, .15), project(plane, layerNodes[i + 8].u, .69))} />)}
            </g>
            {layerNodes.map(node => {
              const p = project(plane, node.u, node.v);
              return <g key={node.id} transform={`translate(${p.x} ${p.y})`} className={`${styles.node} ${selected?.id === node.id ? styles.selected : ""}`} role="button" tabIndex={0} aria-label={`${layers[id].name}：${node.title}`} aria-pressed={selected?.id === node.id} onClick={() => { setSelected(node); setFocus(id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(node); setFocus(id); } }}>
                <title>{node.title}</title>
                <rect className={styles.hitbox} x="-38" y="-67" width="92" height="94" rx="8" />
                <ellipse className={styles.halo} rx="32" ry="12" cy="4" fill="none" stroke="#97d5ff" strokeWidth="1.8" />
                <NodeShape kind={node.kind} />
                <text x="0" y="24" textAnchor="middle" fill="#bbd0e4" fontSize={id === "data" ? "13" : "11"}>{node.title}</text>
              </g>;
            })}
          </g>;
        })}
        <g transform="translate(1330 85)"><path d="M 0 0 L 0 130" stroke="#34506b" /><text x="18" y="16" fill="#d3e6fa" fontSize="22" fontWeight="600">WBM</text><text x="18" y="42" fill="#92abc4" fontSize="12">世界行为模型</text><text x="18" y="72" fill="#677f97" fontSize="11">对象 / 关系 / 状态</text><text x="18" y="93" fill="#677f97" fontSize="11">规则 / 行为 / 结果</text><text x="18" y="125" fill="#7fc6f3" fontSize="11">统一三层业务语义</text></g>
      </svg>
    </div>
    <footer className={styles.detail} aria-live="polite" aria-atomic="true">
      <span className={styles.detailLabel}>{activeLayer ? layers[activeLayer].name : "ARCHITECTURE OVERVIEW"}</span>
      <div><strong>{detail.title}</strong><p>{detail.description}</p></div>
      <span className={styles.hint}>点击节点探索 · 支持键盘操作</span>
    </footer>
  </section>;
}