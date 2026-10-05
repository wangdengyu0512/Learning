import type { Metadata } from "next";
import { PostCard } from "@/components/PostCard";
import { getAllPosts } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "文章",
  description: `浏览${siteConfig.name}关于技术、学习和生活的文章。`,
  alternates: { canonical: `${siteConfig.url}/posts/` },
};

export default function PostsPage() {
  const posts = getAllPosts();
  const tags = Array.from(new Set(posts.flatMap((post) => post.tags)));

  return (
    <section className="shell page-section">
      <header className="page-header">
        <p className="eyebrow"><span /> ARCHIVE / 文章归档</p>
        <h1>写下来的，<em>才真正属于自己。</em></h1>
        <p>这里是我的学习笔记、项目复盘和偶尔出现的生活观察。</p>
      </header>

      {tags.length ? (
        <div className="archive-tags" aria-label="文章标签">
          <span>全部 {posts.length}</span>
          {tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}

      <div className="post-list archive-list">
        {posts.map((post, index) => <PostCard index={index} key={post.slug} post={post} />)}
      </div>
    </section>
  );
}
