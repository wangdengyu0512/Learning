import type { Metadata } from "next";
import { EnterpriseAiOSDiagram } from "@/components/EnterpriseAiOSDiagram";

export const metadata: Metadata = {
  title: "企业 AI 操作系统模型图",
  description: "基于世界行为模型的 Data OS、Agent OS 与 Agent Workforce 三层架构和双向数据流。",
};

export default function EnterpriseAiOSModelPage() {
  return (
    <main className="aios-model-page">
      <EnterpriseAiOSDiagram />
    </main>
  );
}
