import type { Metadata } from "next";
import { EnterpriseAiOSDiagram } from "@/components/EnterpriseAiOSDiagram";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "企业 AI 操作系统模型图",
  description: "基于世界行为模型的 Data OS、Agent OS 与 Agent Workforce 三层架构和双向数据流。",
  alternates: { canonical: `${siteConfig.url}/enterprise-ai-os-model/` },
};

export default function EnterpriseAiOSModelPage() {
  return (
    <div className="aios-model-page">
      <EnterpriseAiOSDiagram />
    </div>
  );
}
