export type ArticleHeading = {
  id: string;
  text: string;
  level: number;
};

export function getHeadingText(source: string) {
  return source
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function createHeadingId(text: string) {
  const id = text
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return id || "section";
}

export function getUniqueHeadingId(text: string, counts: Map<string, number>) {
  const base = createHeadingId(getHeadingText(text));
  const count = counts.get(base) ?? 0;
  counts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

export function extractHeadings(content: string, maxLevel = 2): ArticleHeading[] {
  const counts = new Map<string, number>();
  const headings: ArticleHeading[] = [];

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const match = /^(#{1,4})\s+(.+)$/.exec(line);
    if (!match) continue;

    const level = match[1].length === 1 ? 2 : match[1].length;
    const text = getHeadingText(match[2]);
    const id = getUniqueHeadingId(match[2], counts);

    if (level <= maxLevel) headings.push({ id, text, level });
  }

  return headings;
}
