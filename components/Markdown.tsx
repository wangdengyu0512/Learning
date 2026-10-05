import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      const external = /^https?:\/\//.test(link[2]);
      return (
        <a
          href={link[2]}
          key={index}
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {link[1]}
        </a>
      );
    }

    return part;
  });
}

function isBlockStart(line: string) {
  return /^(#{1,4})\s|^```|^>\s?|^[-*]\s|^\d+\.\s|^---$/.test(line);
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```([\w-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={`code-${index}`} data-language={fence[1] || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const children = renderInline(heading[2]);
      if (level === 1) blocks.push(<h2 key={`h-${index}`}>{children}</h2>);
      if (level === 2) blocks.push(<h2 key={`h-${index}`}>{children}</h2>);
      if (level === 3) blocks.push(<h3 key={`h-${index}`}>{children}</h3>);
      if (level === 4) blocks.push(<h4 key={`h-${index}`}>{children}</h4>);
      index += 1;
      continue;
    }

    if (line === "---") {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(quote.join(" "))}</blockquote>);
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="prose">{blocks}</div>;
}
