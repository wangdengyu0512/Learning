import fs from "node:fs";
import path from "node:path";
import { CityGovernanceFrame } from "./CityGovernanceFrame";

// Reuse the standalone diagram so its steps and interactions stay in sync.
const source = fs.readFileSync(path.join(process.cwd(), "enterprise-ai-os-explained.html"), "utf8");
const embeddedHtml = source.replace("</head>", `<style>
  body { background: transparent; }
  .wrap { max-width: none; padding: 0; }
  .topbar, .footer, main > :not(#studio) { display: none; }
</style></head>`);

export function CityGovernanceDiagram() {
  return (
    <div className="city-governance-diagram">
      <CityGovernanceFrame html={embeddedHtml} />
    </div>
  );
}
