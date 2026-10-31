import type { MetadataRoute } from "next";
import { getListedPosts } from "@/lib/posts";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = [
    "",
    "/posts/",
    "/about/",
    "/enterprise-ai-os-model/",
    "/enterprise-ontology-model/",
  ].map((path) => ({
    url: `${siteConfig.url}${path}`,
    lastModified: new Date(),
  }));

  const posts = getListedPosts().map((post) => ({
    url: `${siteConfig.url}/posts/${post.slug}/`,
    lastModified: new Date(`${post.date}T00:00:00Z`),
  }));

  return [...staticPages, ...posts];
}
