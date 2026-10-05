import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import { getAllPosts } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

export default function HomePage() {
  const posts = getAllPosts();
  const featured = posts.filter((post) => post.featured);
  const selectedPosts = (featured.length ? featured : posts).slice(0, 3);

  return (
    <>
      <section className="hero shell">
        <div className="hero-copy">
          <p className="eyebrow"><span /> PERSONAL FIELD NOTES · 2026</p>
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
            <strong>构建自己的数字花园</strong>
            <p>学习 · 编程 · 写作 · 复盘</p>
          </div>
        </aside>
      </section>

      <section className="manifesto-band">
        <div className="shell manifesto-grid">
          <p>写作不是输出结论，</p>
          <p>而是留下思考的路径。</p>
          <span>THINK → BUILD → WRITE</span>
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
        <p className="kicker">MY PRINCIPLES</p>
        <div className="principle-grid">
          <div><span>01</span><h3>保持具体</h3><p>少一点空泛判断，多一点真实问题、过程和细节。</p></div>
          <div><span>02</span><h3>长期积累</h3><p>不追赶每一个热点，只记录值得反复回看的东西。</p></div>
          <div><span>03</span><h3>公开学习</h3><p>把未完成的理解写出来，让反馈帮助它继续生长。</p></div>
        </div>
      </section>
    </>
  );
}
