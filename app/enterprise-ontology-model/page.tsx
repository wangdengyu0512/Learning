import type { Metadata } from "next";
import { OntologyGraph } from "@/components/OntologyGraph";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "\u4f01\u4e1a\u65f6\u7a7a\u672c\u4f53\u6a21\u578b\u56fe",
  description: "\u4ee5\u6676\u5706\u52a0\u5de5\u4e8b\u4ef6\u4e3a\u4f8b\uff0c\u5c55\u793a\u4f01\u4e1a\u5bf9\u8c61\u3001\u65f6\u7a7a\u4e0a\u4e0b\u6587\u3001\u52a8\u6001\u4e8b\u4ef6\u3001\u4e1a\u52a1\u89c4\u5219\u4e0e\u6267\u884c\u52a8\u4f5c\u4e4b\u95f4\u7684\u5173\u7cfb\u3002",
  alternates: { canonical: `${siteConfig.url}/enterprise-ontology-model/` },
};

export default function EnterpriseOntologyModelPage() {
  return (
    <div className="ontology-model-page">
      <OntologyGraph />
    </div>
  );
}
