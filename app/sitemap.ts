import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = ["", "/posts/", "/about/"].map((path) => ({
    url: `${siteConfig.url}${path}`,
    lastModified: new Date(),
  }));

  const posts = getAllPosts().map((post) => ({
    url: `${siteConfig.url}/posts/${post.slug}/`,
    lastModified: new Date(`${post.date}T00:00:00Z`),
  }));

  return [...staticPages, ...posts];
}
