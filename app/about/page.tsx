import type { Metadata } from "next";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "关于",
  description: `关于${siteConfig.name}和这个博客。`,
  alternates: { canonical: `${siteConfig.url}/about/` },
};

export default function AboutPage() {
  return (
    <section className="shell about-page">
      <header className="about-hero">
        <div>
          <p className="eyebrow"><span /> ABOUT / 关于我</p>
          <h1>你好，<br />欢迎来到<em>{siteConfig.name}。</em></h1>
        </div>
        <div className="portrait-card" aria-label="缓慢生长的博客标记">
          <span>{siteConfig.mark}</span>
          <small>LEARNER · BUILDER · WRITER</small>
        </div>
      </header>

      <div className="about-content">
        <aside>
          <p className="kicker">QUICK PROFILE</p>
          <dl>
            <div><dt>关注</dt><dd>技术 / 学习 / 创造</dd></div>
            <div><dt>正在做</dt><dd>建立自己的知识系统</dd></div>
            <div><dt>在线</dt><dd><a href={siteConfig.github} rel="noreferrer" target="_blank">GitHub ↗</a></dd></div>
          </dl>
        </aside>
        <div className="about-story">
          <h2>这个网站，为什么存在？</h2>
          <p>互联网上的信息越来越快，我想留一个慢一点的地方。这里不追求日更，也不假装每个问题都有标准答案；我更愿意记录一个想法怎样出现、一个项目怎样被做出来，以及一次失败最后教会了我什么。</p>
          <p>博客也是我的公开学习记录。把理解写成别人能读懂的话，会迫使我发现那些模糊的部分。过一段时间回来重读，也能看到自己真正走了多远。</p>
          <blockquote>“先做一个真实的人，再做一个完整的网站。”</blockquote>
          <h2>我会在这里写什么？</h2>
          <ul>
            <li><strong>技术实践：</strong>项目中的选择、踩坑与复盘。</li>
            <li><strong>学习方法：</strong>如何阅读、做笔记并形成自己的理解。</li>
            <li><strong>生活观察：</strong>那些值得停下来认真想一想的小事。</li>
          </ul>
          <p className="about-note">这个空间会随着学习和项目持续更新。比起一次写完的介绍，我更希望它保留正在生长的痕迹。</p>
        </div>
      </div>
    </section>
  );
}

