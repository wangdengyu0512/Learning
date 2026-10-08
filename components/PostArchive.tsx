"use client";

import { useEffect, useMemo, useState } from "react";
import { PostCard } from "@/components/PostCard";
import type { PostSummary } from "@/lib/posts";

const PRIMARY_TAG_COUNT = 10;

export function PostArchive({ posts }: { posts: PostSummary[] }) {
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("全部");
  const [showAllTags, setShowAllTags] = useState(false);

  const tags = useMemo(() => {
    const frequencies = new Map<string, number>();
    posts.forEach((post) => post.tags.forEach((tag) => frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1)));
    return [...frequencies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  }, [posts]);

  const filteredPosts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return posts.filter((post) => {
      const matchesTag = activeTag === "全部" || post.tags.includes(activeTag);
      const searchable = `${post.title} ${post.description} ${post.tags.join(" ")}`.toLocaleLowerCase("zh-CN");
      return matchesTag && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [activeTag, posts, query]);

  const visibleTags = showAllTags ? tags : tags.slice(0, PRIMARY_TAG_COUNT);

  useEffect(() => {
    if (activeTag !== "全部" && !visibleTags.some(([tag]) => tag === activeTag)) setShowAllTags(true);
  }, [activeTag, visibleTags]);

  return (
    <div className="archive-browser">
      <div className="archive-toolbar">
        <label className="archive-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">搜索文章</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、摘要或标签…"
            type="search"
            value={query}
          />
        </label>
        <p aria-live="polite"><strong>{filteredPosts.length}</strong> 篇文章</p>
      </div>

      <div aria-label="按标签筛选文章" className="archive-tags">
        <button
          aria-pressed={activeTag === "全部"}
          className={activeTag === "全部" ? "is-active" : undefined}
          onClick={() => setActiveTag("全部")}
          type="button"
        >
          全部 <span>{posts.length}</span>
        </button>
        {visibleTags.map(([tag, count]) => (
          <button
            aria-pressed={activeTag === tag}
            className={activeTag === tag ? "is-active" : undefined}
            key={tag}
            onClick={() => setActiveTag(tag)}
            type="button"
          >
            {tag} <span>{count}</span>
          </button>
        ))}
        {tags.length > PRIMARY_TAG_COUNT ? (
          <button className="tag-expand" onClick={() => setShowAllTags((value) => !value)} type="button">
            {showAllTags ? "收起标签 ↑" : `更多标签 +${tags.length - PRIMARY_TAG_COUNT}`}
          </button>
        ) : null}
      </div>

      {filteredPosts.length ? (
        <div className="post-list archive-list">
          {filteredPosts.map((post, index) => <PostCard index={index} key={post.slug} post={post} />)}
        </div>
      ) : (
        <div className="archive-empty">
          <span>没有找到匹配的文章。</span>
          <button onClick={() => { setQuery(""); setActiveTag("全部"); }} type="button">清除筛选</button>
        </div>
      )}
    </div>
  );
}
