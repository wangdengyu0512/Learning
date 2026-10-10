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

  useEffect(() => {
    if (!activeId || mobile) return;
    const toc = document.querySelector<HTMLElement>(".article-toc");
    const activeLink = toc?.querySelector<HTMLAnchorElement>(`a[href="#${CSS.escape(activeId)}"]`);
    if (!toc || !activeLink || toc.scrollHeight <= toc.clientHeight) return;

    const headerHeight = toc.querySelector<HTMLElement>(".toc-header")?.offsetHeight ?? 0;
    const itemTop = activeLink.offsetTop;
    const itemBottom = itemTop + activeLink.offsetHeight;
    const visibleTop = toc.scrollTop + headerHeight;
    const visibleBottom = toc.scrollTop + toc.clientHeight;

    if (itemTop < visibleTop) toc.scrollTo({ top: Math.max(0, itemTop - headerHeight - 10), behavior: "smooth" });
    if (itemBottom > visibleBottom) toc.scrollTo({ top: itemBottom - toc.clientHeight + 10, behavior: "smooth" });
  }, [activeId, mobile]);

  if (!headings.length) return null;

  const list = (
    <ol>
      {headings.map((heading) => {
        const active = activeId === heading.id;
        return (
          <li className={active ? "is-active" : undefined} data-level={heading.level} key={heading.id}>
            <a aria-current={active ? "location" : undefined} href={`#${heading.id}`}>
              <span>{heading.text}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );

  if (mobile) {
    return (
      <details className="mobile-toc">
        <summary>
          <span className="mobile-toc-title">文章目录</span>
          <small>{headings.length} 节</small>
        </summary>
        {list}
      </details>
    );
  }

  return (
    <aside aria-label="文章目录" className="article-toc">
      <div className="toc-header">
        <div>
          <p>CONTENTS</p>
          <strong>文章目录</strong>
        </div>
        <span>{headings.length} 节</span>
      </div>
      {list}
    </aside>
  );
}
