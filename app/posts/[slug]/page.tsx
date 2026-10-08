import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReadingProgress, TableOfContents } from "@/components/ArticleTools";
import { Markdown } from "@/components/Markdown";
import { formatPostDate } from "@/lib/date";
import { extractHeadings } from "@/lib/markdown";
import { getAllPosts, getPostBySlug } from "@/lib/posts";
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

  const posts = getAllPosts();
  const currentIndex = posts.findIndex((item) => item.slug === post.slug);
  const newerPost = currentIndex > 0 ? posts[currentIndex - 1] : undefined;
  const olderPost = currentIndex >= 0 ? posts[currentIndex + 1] : undefined;
  const headings = extractHeadings(post.content, 2);

  return (
    <>
      <ReadingProgress />
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

        <div className="article-layout">
          <div className="article-main">
            <TableOfContents headings={headings} mobile />
            <Markdown content={post.content} />
            <footer className="article-footer">
              <p>向内理解，向外交流。</p>
              <strong>如果这篇文章让你想到什么，欢迎通过 GitHub 和我交流。</strong>
              <a href={siteConfig.github} rel="noreferrer" target="_blank">在 GitHub 找到我 ↗</a>
            </footer>
            <nav aria-label="相邻文章" className="article-pagination">
              {newerPost ? (
                <Link href={`/posts/${newerPost.slug}`}>
                  <span>← 较新一篇</span>
                  <strong>{newerPost.title}</strong>
                </Link>
              ) : <span />}
              {olderPost ? (
                <Link href={`/posts/${olderPost.slug}`}>
                  <span>较早一篇 →</span>
                  <strong>{olderPost.title}</strong>
                </Link>
              ) : <span />}
            </nav>
          </div>
          <TableOfContents headings={headings} />
        </div>
      </article>
    </>
  );
}
