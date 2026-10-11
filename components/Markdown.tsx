import type { ReactNode } from "react";
import { getHeadingText, getUniqueHeadingId } from "@/lib/markdown";

function resolveImageSource(source: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!basePath || !source.startsWith("/") || source.startsWith(`${basePath}/`)) {
    return source;
  }

  return `${basePath}${source}`;
}

function renderInline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
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

    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    return part;
  });
}

function isTableRow(line: string) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableDelimiter(line: string) {
  if (!isTableRow(line)) return false;
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function parseTableRow(line: string) {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function getAnswerSummary(line: string) {
  const match = /^\s*\*\*(.+)\*\*\s*$/.exec(line);
  if (!match) return undefined;

  const label = match[1].trim();
  const isAnswerLabel = label.startsWith("展开答案")
    || label.startsWith("展开参考答案")
    || (label.startsWith("答案") && label.includes("展开"));

  return isAnswerLabel ? label : undefined;
}

function getDetailsLine(line: string, quoted: boolean) {
  return quoted ? line.replace(/^\s*>\s?/, "") : line;
}

function getDetailsSummary(line: string) {
  const match = /^\s*<summary>([\s\S]+)<\/summary>\s*$/.exec(line);
  return match?.[1].replace(/<\/?strong>/g, "").trim();
}

function isAnswerBoundary(line: string) {
  const trimmed = line.trim();
  return /^(#{1,4})\s/.test(trimmed)
    || /^<a\s+id=["'][^"']+["']><\/a>$/.test(trimmed)
    || /^<details(?:\s[^>]*)?>$/.test(trimmed)
    || (/^\*\*.+\*\*$/.test(trimmed) && !getAnswerSummary(trimmed))
    || /^\*\*\u4e0e\u4e0b\u4e00(?:\u4e2a\u6982\u5ff5|\u8282)\u7684\u5173\u7cfb\*\*/.test(trimmed)
    || /^>\s?/.test(trimmed)
    || /^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)
    || /^(?:table|\u8868)\s*\d/i.test(trimmed)
    || /^(?:think about it|predict|cross-concept question|\u60f3\u4e00\u60f3|\u9884\u6d4b\u4e00\u4e0b|\u8de8\u6982\u5ff5\u7efc\u5408\u9898)$/i.test(trimmed)
    || trimmed === "---";
}

function isBlockStart(line: string, nextLine?: string) {
  return Boolean(getAnswerSummary(line))
    || /^<details(?:\s[^>]*)?>$/.test(line.trim())
    || /^(#{1,4})\s|^```|^>\s?|^[-*]\s|^\d+\.\s|^---$|^!\[[^\]]*\]\([^)]+\)$|^<a\s+id=["'][^"']+["']><\/a>$/.test(line)
    || (isTableRow(line) && Boolean(nextLine && isTableDelimiter(nextLine)));
}

export function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const headingCounts = new Map<string, number>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const answerSummary = getAnswerSummary(line);
    if (answerSummary) {
      let end = index + 1;
      while (end < lines.length && !isAnswerBoundary(lines[end])) {
        end += 1;
      }

      const answer = lines.slice(index + 1, end).join("\n").trim();
      blocks.push(
        <details className="answer-reveal" key={`answer-${index}`}>
          <summary>{renderInline(answerSummary)}</summary>
          <div className="answer-reveal-body">
            <Markdown content={answer} />
          </div>
        </details>,
      );
      index = end;
      continue;
    }

    const quotedDetails = /^\s*>\s*<details(?:\s[^>]*)?>\s*$/.test(line);
    if (quotedDetails || /^\s*<details(?:\s[^>]*)?>\s*$/.test(line)) {
      const detailsStart = index;
      index += 1;

      while (index < lines.length && !getDetailsLine(lines[index], quotedDetails).trim()) {
        index += 1;
      }

      const summary = index < lines.length
        ? getDetailsSummary(getDetailsLine(lines[index], quotedDetails))
        : undefined;

      if (summary) index += 1;

      const answer: string[] = [];
      while (
        index < lines.length
        && getDetailsLine(lines[index], quotedDetails).trim() !== "</details>"
      ) {
        answer.push(getDetailsLine(lines[index], quotedDetails));
        index += 1;
      }

      if (index < lines.length) index += 1;

      blocks.push(
        <details className="answer-reveal" key={`details-${detailsStart}`}>
          <summary>{renderInline(summary ?? "展开内容")}</summary>
          <div className="answer-reveal-body">
            <Markdown content={answer.join("\n").trim()} />
          </div>
        </details>,
      );
      continue;
    }

    const anchor = /^<a\s+id=["']([^"']+)["']><\/a>$/.exec(line.trim());
    if (anchor) {
      blocks.push(<span className="prose-anchor" id={anchor[1]} key={`anchor-${anchor[1]}`} />);
      index += 1;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (image) {
      blocks.push(
        <figure className="prose-figure" key={`image-${index}`}>
          {/* The source diagrams are local SVG assets with intrinsic viewBox sizing. */}
          <img alt={image[1]} loading="lazy" src={resolveImageSource(image[2])} />
        </figure>,
      );
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
      const level = heading[1].length === 1 ? 2 : heading[1].length;
      const id = getUniqueHeadingId(heading[2], headingCounts);
      const children = renderInline(heading[2]);
      const anchor = (
        <a aria-label={`链接到“${getHeadingText(heading[2])}”`} className="heading-anchor" href={`#${id}`}>#</a>
      );
      if (level === 2) blocks.push(<h2 id={id} key={`h-${index}`}>{children}{anchor}</h2>);
      if (level === 3) blocks.push(<h3 id={id} key={`h-${index}`}>{children}{anchor}</h3>);
      if (level === 4) blocks.push(<h4 id={id} key={`h-${index}`}>{children}{anchor}</h4>);
      index += 1;
      continue;
    }

    if (line === "---") {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="prose-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
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
    while (
      index < lines.length
      && lines[index].trim()
      && !isBlockStart(lines[index], lines[index + 1])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="prose">{blocks}</div>;
}
