"use client";

import { useEffect, useState } from "react";
import type { ArticleHeading } from "@/lib/markdown";

export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0);
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div aria-hidden="true" className="reading-progress" style={{ transform: `scaleX(${progress / 100})` }} />
      <button
        aria-label="返回页面顶部"
        className={`back-to-top ${progress > 12 ? "is-visible" : ""}`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        type="button"
      >
        ↑
      </button>
    </>
  );
}

export function TableOfContents({ headings, mobile = false }: { headings: ArticleHeading[]; mobile?: boolean }) {
  const [activeId, setActiveId] = useState(headings[0]?.id ?? "");

  useEffect(() => {
    if (!headings.length) return;
    const elements = headings.map((heading) => document.getElementById(heading.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: "-18% 0px -70% 0px", threshold: [0, 1] },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [headings]);

  if (!headings.length) return null;

  const list = (
    <ol>
      {headings.map((heading) => (
        <li className={activeId === heading.id ? "is-active" : undefined} key={heading.id}>
          <a aria-current={activeId === heading.id ? "location" : undefined} href={`#${heading.id}`}>{heading.text}</a>
        </li>
      ))}
    </ol>
  );

  if (mobile) {
    return (
      <details className="mobile-toc">
        <summary><span>文章目录</span><small>{headings.length} 节</small></summary>
        {list}
      </details>
    );
  }

  return (
    <aside aria-label="文章目录" className="article-toc">
      <p>CONTENTS</p>
      {list}
    </aside>
  );
}
