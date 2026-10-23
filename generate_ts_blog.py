from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup, NavigableString
from markdownify import markdownify

SRC = Path(r"F:\fde\给 Java  后端工程师的 TypeScript 系统入门")
OUT = SRC / "给 Java 后端工程师的 TypeScript 系统入门.md"
ASSETS = SRC / "blog-assets"
ASSETS.mkdir(exist_ok=True)

pages = [
    ("start", "起点 · 给 Java_后端工程师的 TypeScript 系统入门.html", "起点：先建立整套心智模型"),
    ("chapter-01", "01 核心概念 · TypeScript 教程.html", "第 1 章：核心概念——类型系统的零件"),
    ("chapter-02", "02 工作原理与设计取舍 · TypeScript 教程.html", "第 2 章：工作原理与设计取舍"),
    ("chapter-03", "03 自测与辨析 · TypeScript 教程.html", "第 3 章：自测与辨析"),
]

page_anchor_by_path = {
    "/learning/typescript/index.html": "start",
    "/learning/typescript/01-concepts.html": "chapter-01",
    "/learning/typescript/02-principles.html": "chapter-02",
    "/learning/typescript/03-self-check.html": "chapter-03",
}

placeholders: dict[str, str] = {}
ph_counter = 0
figure_counter = 0

# Count source IDs so unique anchors can stay readable while duplicates are namespaced.
id_counts = Counter()
for _, filename, _ in pages:
    _soup = BeautifulSoup((SRC / filename).read_text(encoding="utf-8"), "html.parser")
    _article = _soup.find("article")
    if _article:
        id_counts.update(node.get("id") for node in _article.find_all(id=True) if node.get("id"))


def token(kind: str, content: str) -> str:
    global ph_counter
    ph_counter += 1
    key = f"BLOGPH{kind.upper()}{ph_counter:04d}END"
    placeholders[key] = content
    return key


def md_fragment(html: str) -> str:
    return markdownify(
        html,
        heading_style="ATX",
        bullets="-",
        strong_em_symbol="*",
    ).strip()


def replace_tokens(text: str) -> str:
    # Some placeholders are nested (for example code inside a <details> block),
    # so restore repeatedly until stable.
    for _ in range(10):
        old = text
        for key, value in placeholders.items():
            text = text.replace(key, value)
        if text == old:
            break
    return text


def normalize_spacing(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    # markdownify occasionally joins a figure number directly to its caption.
    text = re.sub(r"(图\s*\d+(?:\.\d+)?)((?![\s：:，。]))", r"\1 \2", text)
    return text.strip() + "\n"


def make_callout(soup: BeautifulSoup, node, label: str, emoji: str = "", label_node=None):
    quote = soup.new_tag("blockquote")
    title = soup.new_tag("p")
    strong = soup.new_tag("strong")
    strong.string = f"{emoji} {label}".strip()
    title.append(strong)
    quote.append(title)
    if label_node is not None:
        label_node.extract()
    for child in list(node.children):
        quote.append(child.extract() if hasattr(child, "extract") else child)
    node.replace_with(quote)


chunks: list[str] = []

for page_index, (page_anchor, filename, merged_title) in enumerate(pages):
    path = SRC / filename
    raw = path.read_text(encoding="utf-8")
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.find("article")
    if article is None:
        raise RuntimeError(f"No <article> in {filename}")

    # Remove browser-only controls and duplicated previous/next navigation.
    for node in article.select("button, script, nav.chapter-nav"):
        node.decompose()

    # Rewrite links between the original four HTML pages to anchors in this merged post.
    for link in article.find_all("a", href=True):
        href = link["href"]
        parsed = urlparse(href)
        if parsed.netloc == "zhiwenliang.github.io" and parsed.path in page_anchor_by_path:
            link["href"] = "#" + (parsed.fragment or page_anchor_by_path[parsed.path])

    # Preserve meaningful IDs that live on sections/callouts rather than headings.
    for node in list(article.find_all(id=True)):
        source_id = node.get("id")
        if (
            not source_id
            or re.fullmatch(r"h[1-6]", node.name or "")
            or source_id.startswith("c-")
            or node.find_parent("svg") is not None
        ):
            continue
        merged_id = source_id if id_counts[source_id] == 1 else f"{page_anchor}-{source_id}"
        node.insert_before(NavigableString(token("anchor", f'<a id="{merged_id}"></a>')))
        del node.attrs["id"]

    # Extract embedded diagrams as portable SVG assets.
    css = """
:root { --bg:#fff; --ink:#0a0a0a; --ink-soft:#525252; --ink-faint:#a3a3a3; --vermilion:#b73b2f; --vermilion-soft:rgba(183,59,47,.08); }
svg { background:#fff; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif; }
.diagram-ink { stroke:var(--ink); fill:none; stroke-width:1.4; stroke-linecap:round; stroke-linejoin:round; }
.diagram-accent { stroke:var(--vermilion); fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.diagram-soft { stroke:var(--ink-faint); fill:none; stroke-width:1.1; stroke-dasharray:3 3; }
.node-fill { fill:var(--bg); }
.node-fill-accent { fill:var(--vermilion-soft); }
.node-label { font-size:13px; font-weight:500; fill:var(--ink); }
.node-label-accent { font-size:13px; font-weight:700; fill:var(--vermilion); }
.edge-label { font-family:Consolas,"SFMono-Regular",monospace; font-size:11px; fill:var(--ink-soft); paint-order:stroke; stroke:var(--bg); stroke-width:4px; stroke-linejoin:round; }
.branch-label { font-family:Consolas,"SFMono-Regular",monospace; font-size:11px; font-weight:700; fill:var(--vermilion); paint-order:stroke; stroke:var(--bg); stroke-width:4px; stroke-linejoin:round; }
"""
    for fig in list(article.find_all("figure")):
        svg = fig.find("svg")
        if svg is None:
            continue
        figure_counter += 1
        svg_attr_case = {
            "viewbox": "viewBox",
            "refx": "refX",
            "refy": "refY",
            "markerwidth": "markerWidth",
            "markerheight": "markerHeight",
            "maskunits": "maskUnits",
        }
        for element in [svg, *svg.find_all(True)]:
            for old_name, new_name in svg_attr_case.items():
                if old_name in element.attrs:
                    element.attrs[new_name] = element.attrs.pop(old_name)
        vb = svg.get("viewBox", "0 0 800 450").split()
        if len(vb) == 4:
            svg.attrs.setdefault("width", vb[2])
            svg.attrs.setdefault("height", vb[3])
        style = soup.new_tag("style")
        style.string = css
        svg.insert(0, style)
        asset_name = f"figure-{figure_counter:02d}.svg"
        asset_path = ASSETS / asset_name
        asset_path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n' + str(svg), encoding="utf-8")

        alt = svg.get("aria-label", f"图 {figure_counter}")
        caption = fig.find("figcaption")
        caption_md = md_fragment(str(caption)) if caption else ""
        figure_md = f"![{alt}](blog-assets/{asset_name})"
        if caption_md:
            figure_md += f"\n\n> {caption_md.replace(chr(10), chr(10) + '> ')}"
        fig.replace_with(NavigableString(token("figure", figure_md)))

    # Preserve fenced code exactly, without Prism's token spans or copy buttons.
    for block in list(article.select("div.code-block")):
        header = block.select_one(".header")
        filename_label = block.select_one(".filename")
        lang_label = block.select_one(".lang")
        pre = block.find("pre")
        code = pre.find("code") if pre else None
        if not code:
            continue
        classes = (code.get("class") or []) + (pre.get("class") or [])
        language = ""
        for cls in classes:
            if cls.startswith("language-"):
                language = cls.removeprefix("language-")
                break
        source = code.get_text().rstrip()
        labels = []
        if filename_label and filename_label.get_text(strip=True):
            labels.append(filename_label.get_text(" ", strip=True))
        if lang_label and lang_label.get_text(strip=True):
            labels.append(lang_label.get_text(" ", strip=True))
        label_md = f"**{' · '.join(labels)}**\n\n" if labels else ""
        fenced = f"{label_md}```{language}\n{source}\n```"
        block.replace_with(NavigableString(token("code", fenced)))

    # Keep interactive answers collapsible on common Markdown engines.
    for details in list(article.find_all("details")):
        summary = details.find("summary")
        summary_text = summary.get_text(" ", strip=True) if summary else "查看答案"
        if summary:
            summary.extract()
        inner = md_fragment("".join(str(x) for x in details.contents))
        if page_index > 0:
            inner = re.sub(r"^(#{1,5})(?= )", lambda m: m.group(1) + "#", inner, flags=re.MULTILINE)
        details_md = f"<details>\n<summary><strong>{summary_text}</strong></summary>\n\n{inner}\n\n</details>"
        details.replace_with(NavigableString(token("details", details_md)))

    # Turn teaching boxes into portable Markdown blockquotes.
    for node in list(article.select("div.rationale")):
        label_node = node.select_one(".label")
        make_callout(soup, node, label_node.get_text(" ", strip=True) if label_node else "为什么需要它", "📌", label_node)
    for node in list(article.select("div.callout")):
        classes = set(node.get("class") or [])
        label_node = node.select_one(".label")
        label = label_node.get_text(" ", strip=True) if label_node else "提示"
        emoji = "⚠️" if "warning" in classes else "💡"
        make_callout(soup, node, label, emoji, label_node)
    for node in list(article.select("div.predict")):
        label_node = node.select_one(".question-label")
        make_callout(soup, node, label_node.get_text(" ", strip=True) if label_node else "想一想", "🧠", label_node)
    for node in list(article.select("section.schema-panel")):
        label_node = node.select_one(".label")
        label = label_node.get_text(" ", strip=True) if label_node else "核心模型"
        make_callout(soup, node, label, "🧭", label_node)
    for node in list(article.select("p.one-liner")):
        quote = soup.new_tag("blockquote")
        p = soup.new_tag("p")
        strong = soup.new_tag("strong")
        for child in list(node.contents):
            strong.append(child.extract() if hasattr(child, "extract") else child)
        p.append(strong)
        quote.append(p)
        node.replace_with(quote)

    # Normalize nested-span headings so spaces survive HTML -> Markdown conversion.
    original_heading_names = {id(h): h.name for h in article.find_all(re.compile(r"^h[1-6]$"))}
    for heading in article.find_all(re.compile(r"^h[1-6]$")):
        heading_id = heading.get("id")
        clean_text = re.sub(r"^·\s*", "", heading.get_text(" ", strip=True))
        heading.clear()
        heading.string = clean_text
        if heading_id:
            anchor_html = f'<a id="{heading_id}"></a>'
            heading.insert_before(NavigableString(token("anchor", anchor_html)))

    header = article.find("header", class_="chapter-opener")
    if header:
        label = header.select_one(".chapter-label")
        if label:
            label.decompose()
        h1 = header.find("h1")
        if page_index == 0:
            # The merged document already has the same H1.
            if h1:
                h1.decompose()
        else:
            # Chapter heading is supplied explicitly below.
            if h1:
                h1.decompose()

    # In chapter pages, demote source H2/H3 one level under the chapter H2.
    if page_index > 0:
        for h in article.find_all(re.compile(r"^h[1-5]$")):
            n = int(h.name[1])
            h.name = f"h{min(n + 1, 6)}"

    body_md = md_fragment(str(article))
    body_md = replace_tokens(body_md)

    section_header = f'<a id="{page_anchor}"></a>\n\n## {merged_title}'
    chunks.append(section_header + "\n\n" + body_md)

front = """# 给 Java / 后端工程师的 TypeScript 系统入门

> **定位**：面向已有 Java 或其他静态类型语言经验、但尚未系统学习 JavaScript / TypeScript 的后端工程师。  
> **内容基线**：TypeScript 6.0（2026-03）  
> **预计阅读时间**：约 2 小时  
> **文档生成日期**：2026-10-06

这不是一份 API 速查表，而是一篇围绕心智模型组织的系统教程。全文用一条主线串起所有概念：**TypeScript 的类型只存在于编译期，按结构匹配，并在运行时被擦除。**

## 目录

- [起点：先建立整套心智模型](#start)
- [第 1 章：核心概念——类型系统的零件](#chapter-01)
  - [1.1 两个世界：编译期类型 vs 运行时值](#s11)
  - [1.2 基础类型](#s12)
  - [1.3 类型注解与类型推断](#s13)
  - [1.4 对象类型：interface 与 type](#s14)
  - [1.5 联合类型与字面量类型](#s15)
  - [1.6 函数类型与 this](#s16)
  - [1.7 泛型](#s17)
  - [1.8 收窄 narrowing](#s18)
- [第 2 章：工作原理与设计取舍](#chapter-02)
  - [2.1 结构化类型：按形状，不按名字](#s21)
  - [2.2 类型擦除与编译模型](#s22)
  - [2.3 「不健全」是故意的，以及 enum 这个例外](#s23)
  - [2.4 strict 配置：一个元开关](#s24)
  - [2.5 综合示例：一次 API 取数据](#s25)
- [第 3 章：自测与辨析](#chapter-03)
  - [概念层](#t1)
  - [原理层](#t2)
  - [应用判别层](#t3)
  - [答案](#answers)

---
"""

final = front + "\n\n---\n\n".join(chunks) + "\n"
final = normalize_spacing(final)
OUT.write_text(final, encoding="utf-8")

print(f"Wrote: {OUT}")
print(f"Characters: {len(final):,}")
print(f"Lines: {final.count(chr(10)):,}")
print(f"Figures: {figure_counter}")
print(f"Assets: {ASSETS}")
