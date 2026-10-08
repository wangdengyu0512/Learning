import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import { getAllPosts } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

export default function HomePage() {
  const currentYear = new Date().getFullYear();
  const posts = getAllPosts();
  const featured = posts.filter((post) => post.featured);
  const selectedPosts = (featured.length ? featured : posts).slice(0, 3);

  return (
    <>
      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow"><span /> INWARD GROWTH · {currentYear}</p>
          <h1>
            把复杂的事情
            <br />
            <em>想清楚，写简单。</em>
          </h1>
          <p className="hero-intro">{siteConfig.intro}</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/posts">
              阅读文章 <span>→</span>
            </Link>
            <Link className="text-link" href="/about">
              关于这里 ↗
            </Link>
          </div>
        </div>
        <aside className="now-card" aria-label="最近在做">
          <div className="now-card-top">
            <span className="status-dot" />
            <span>NOW / 现在</span>
          </div>
          <div className="monogram" aria-hidden="true">{siteConfig.mark}</div>
          <div className="now-card-body">
            <p className="label">最近在做</p>
            <strong>{siteConfig.now.title}</strong>
            <p>{siteConfig.now.detail}</p>
          </div>
        </aside>
      </section>

      <section className="manifesto-band" aria-label={siteConfig.motto}>
        <div className="shell manifesto-grid">
          <p>求木之长者，</p>
          <p>必固其根本。</p>
          <span>ROOT DEEP · BUILD FAR</span>
        </div>
      </section>

      <section className="section shell">
        <div className="section-heading">
          <div>
            <p className="kicker">SELECTED NOTES</p>
            <h2>最近写下的</h2>
          </div>
          <Link className="text-link" href="/posts">查看全部文章 →</Link>
        </div>
        <div className="post-list">
          {selectedPosts.map((post, index) => <PostCard index={index} key={post.slug} post={post} />)}
        </div>
      </section>

      <section className="shell principle-section">
        <p className="kicker">GROWTH PRINCIPLES</p>
        <div className="principle-grid">
          <div><span>01</span><h3>向内求解</h3><p>不止停留在怎么使用，而是继续追问为什么这样设计。</p></div>
          <div><span>02</span><h3>扎根原理</h3><p>穿过变化很快的工具，寻找值得长期保留的底层规律。</p></div>
          <div><span>03</span><h3>向外构建</h3><p>把理解变成文章、项目和行动，让认知接受真实反馈。</p></div>
        </div>
      </section>
    </>
  );
}
