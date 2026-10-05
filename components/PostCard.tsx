import Link from "next/link";
import type { Post } from "@/lib/posts";
import { formatPostDate } from "@/lib/posts";

export function PostCard({ post, index }: { post: Post; index?: number }) {
  return (
    <article className="post-card">
      {typeof index === "number" ? <span className="post-index">{String(index + 1).padStart(2, "0")}</span> : null}
      <div className="post-card-content">
        <div className="post-meta">
          <time dateTime={post.date}>{formatPostDate(post.date)}</time>
          <span>·</span>
          <span>{post.readingTime} 分钟阅读</span>
        </div>
        <h3>
          <Link href={`/posts/${post.slug}`}>{post.title}</Link>
        </h3>
        <p>{post.description}</p>
        <div className="tag-row">
          {post.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <Link className="post-arrow" href={`/posts/${post.slug}`} aria-label={`阅读《${post.title}》`}>
        ↗
      </Link>
    </article>
  );
}
