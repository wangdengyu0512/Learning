import Link from "next/link";
import { Navigation } from "@/components/Navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { siteConfig } from "@/lib/site";

export function Header() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/" aria-label={`${siteConfig.name}的首页`}>
          <span className="brand-mark">{siteConfig.mark}</span>
          <span>{siteConfig.name}</span>
        </Link>
        <div className="header-actions">
          <Navigation />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
