"use client";

import { useEffect, useId, useRef, useState } from "react";

type DiagramTheme = "light" | "dark";
type RenderStatus = "loading" | "ready" | "error";

let renderQueue: Promise<void> = Promise.resolve();

function getDocumentTheme(): DiagramTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function MermaidDiagram({ chart, label }: { chart: string; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renderSequence = useRef(0);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [theme, setTheme] = useState<DiagramTheme>("light");
  const [status, setStatus] = useState<RenderStatus>("loading");

  useEffect(() => {
    setTheme(getDocumentTheme());

    const observer = new MutationObserver(() => setTheme(getDocumentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++renderSequence.current;
    setStatus("loading");

    renderQueue = renderQueue
      .catch(() => undefined)
      .then(async () => {
        if (cancelled || !hostRef.current) return;

        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
          flowchart: { htmlLabels: true, useMaxWidth: true },
          sequence: { useMaxWidth: true, wrap: true },
        });

        await mermaid.parse(chart);
        const diagramId = `mermaid-${reactId}-${sequence}`;
        const { svg, bindFunctions } = await mermaid.render(diagramId, chart);
        if (cancelled || !hostRef.current) return;

        hostRef.current.innerHTML = svg;
        bindFunctions?.(hostRef.current);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [chart, reactId, theme]);

  return (
    <figure aria-label={label} className="mermaid-diagram">
      <div
        aria-hidden={status !== "ready"}
        className="mermaid-diagram__canvas"
        ref={hostRef}
      />
      {status === "loading" && <p className="mermaid-diagram__status">图表加载中</p>}
      {status === "error" && (
        <div className="mermaid-diagram__error">
          <p>图表暂时无法渲染，下面保留原始定义。</p>
          <pre data-language="mermaid"><code>{chart}</code></pre>
        </div>
      )}
      <figcaption>{label}</figcaption>
    </figure>
  );
}
