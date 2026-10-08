"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/lib/site";

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="主要导航" className="main-nav">
      {siteConfig.nav.map((item) => {
        const active = item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "is-active" : undefined} href={item.href} key={item.href}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
