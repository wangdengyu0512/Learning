import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { formatPostDate, getAllPosts, getPostBySlug } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `${siteConfig.url}/posts/${post.slug}/` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      tags: post.tags,
      url: `${siteConfig.url}/posts/${post.slug}/`,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <article className="shell article-page">
      <Link className="back-link" href="/posts">← 返回文章列表</Link>
      <header className="article-header">
        <div className="tag-row">
          {post.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
        </div>
        <h1>{post.title}</h1>
        <p className="article-description">{post.description}</p>
        <div className="article-byline">
          <span className="mini-avatar">{siteConfig.mark}</span>
          <div>
            <strong>{siteConfig.name}</strong>
            <p><time dateTime={post.date}>{formatPostDate(post.date)}</time> · {post.readingTime} 分钟阅读</p>
          </div>
        </div>
      </header>
      <Markdown content={post.content} />
      <footer className="article-footer">
        <p>感谢你读到这里。</p>
        <strong>如果这篇文章让你想到什么，欢迎通过 GitHub 和我交流。</strong>
        <a href={siteConfig.github} rel="noreferrer" target="_blank">在 GitHub 找到我 ↗</a>
      </footer>
    </article>
  );
}

