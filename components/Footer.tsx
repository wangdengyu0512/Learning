import { siteConfig } from "@/lib/site";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-inner">
        <div>
          <strong>{siteConfig.name}</strong>
          <p>保持好奇，缓慢积累。</p>
        </div>
        <div className="footer-links">
          <a href={siteConfig.github} rel="noreferrer" target="_blank">
            GitHub ↗
          </a>
          {siteConfig.email ? <a href={`mailto:${siteConfig.email}`}>邮件</a> : null}
        </div>
      </div>
    </footer>
  );
}
