import type { Metadata } from "next";
import { PostArchive } from "@/components/PostArchive";
import { getAllPosts } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "文章",
  description: `浏览${siteConfig.name}关于技术、学习和生活的文章。`,
  alternates: { canonical: `${siteConfig.url}/posts/` },
};

export default function PostsPage() {
  const posts = getAllPosts().map(({ content: _content, ...post }) => post);

  return (
    <section className="shell page-section">
      <header className="page-header">
        <p className="eyebrow"><span /> ARCHIVE / 文章归档</p>
        <h1>写下来的，<em>才真正属于自己。</em></h1>
        <p>在这里按主题浏览学习笔记、项目复盘和长期技术思考。</p>
      </header>
      <PostArchive posts={posts} />
    </section>
  );
}
