"use client";

import { useEffect, useRef } from "react";

export function CityGovernanceFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;

    const observeContent = () => {
      observer?.disconnect();
      const body = frame.contentDocument?.body;
      if (!body) return;
      const resize = () => {
        const height = Math.ceil(Math.max(body.getBoundingClientRect().height, body.scrollHeight));
        frame.style.height = `${height}px`;
      };
      observer = new ResizeObserver(resize);
      observer.observe(body);
      resize();
    };

    frame.addEventListener("load", observeContent);
    if (frame.contentDocument?.readyState === "complete") observeContent();
    return () => {
      frame.removeEventListener("load", observeContent);
      observer?.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={frameRef}
      title="城市智能体治理交互架构图"
      srcDoc={html}
    />
  );
}
