import fs from "node:fs";
import path from "node:path";

export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string;
  tags: string[];
  featured: boolean;
  readingTime: number;
  content: string;
};

export type PostSummary = Omit<Post, "content">;

const postsDirectory = path.join(process.cwd(), "content", "posts");

function parseFrontmatter(source: string) {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);

  if (!match) {
    return { data: {} as Record<string, string>, content: normalized.trim() };
  }

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    data[key] = value;
  }

  return { data, content: match[2].trim() };
}

function calculateReadingTime(content: string) {
  const chineseCharacters = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = content
    .replace(/[\u3400-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return Math.max(1, Math.ceil(chineseCharacters / 400 + latinWords / 200));
}

function loadPost(fileName: string): Post {
  const slug = fileName.replace(/\.md$/, "");
  const source = fs.readFileSync(path.join(postsDirectory, fileName), "utf8");
  const { data, content } = parseFrontmatter(source);

  return {
    slug,
    title: data.title || slug,
    description: data.description || "",
    date: data.date || "1970-01-01",
    tags: (data.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    featured: data.featured === "true",
    readingTime: calculateReadingTime(content),
    content,
  };
}

export function getAllPosts() {
  if (!fs.existsSync(postsDirectory)) return [];

  return fs
    .readdirSync(postsDirectory)
    .filter((fileName) => fileName.endsWith(".md") && !fileName.startsWith("_"))
    .map(loadPost)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getPostBySlug(slug: string) {
  const fileName = `${slug}.md`;
  const fullPath = path.join(postsDirectory, fileName);
  return fs.existsSync(fullPath) ? loadPost(fileName) : undefined;
}
