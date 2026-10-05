import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Header() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="brand" href="/" aria-label={`${siteConfig.name}的首页`}>
          <span className="brand-mark">{siteConfig.mark}</span>
          <span>{siteConfig.name}</span>
        </Link>
        <nav aria-label="主要导航" className="main-nav">
          {siteConfig.nav.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

