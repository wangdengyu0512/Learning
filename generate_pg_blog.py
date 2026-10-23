from __future__ import annotations

import copy
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import markdownify as md

SOURCE = Path(r"F:\fde\从一条规则读懂 PostgreSQL")
OUTPUT = SOURCE / "博客文档"
ASSETS = OUTPUT / "assets"
BUILD_DATE = "2026-10-06"
BASE_URL = "https://zhiwenliang.github.io/learning/postgresql/"

PAGES = [
    {
        "src": "起点 · PostgreSQL 核心机制教程.html",
        "out": "00-起点.md",
        "slug": "postgresql-core-mechanisms-start",
        "chapter": 0,
        "short": "起点",
        "asset": "00-start",
        "tags": ["PostgreSQL", "数据库原理", "学习路线"],
    },
    {
        "src": "01 存储与数据模型 · PostgreSQL 核心机制教程.html",
        "out": "01-存储与数据模型.md",
        "slug": "postgresql-storage-and-data-model",
        "chapter": 1,
        "short": "存储与数据模型",
        "asset": "01-storage",
        "tags": ["PostgreSQL", "Heap", "Page", "Tuple", "TOAST"],
    },
    {
        "src": "02 MVCC 与事务 · PostgreSQL 核心机制教程.html",
        "out": "02-MVCC-与事务.md",
        "slug": "postgresql-mvcc-and-transactions",
        "chapter": 2,
        "short": "MVCC 与事务",
        "asset": "02-mvcc",
        "tags": ["PostgreSQL", "MVCC", "事务", "隔离级别", "HOT"],
    },
    {
        "src": "03 回收与持久化：VACUUM、冻结、WAL · PostgreSQL 核心机制教程.html",
        "out": "03-回收与持久化-VACUUM-冻结-WAL.md",
        "slug": "postgresql-vacuum-freeze-wal",
        "chapter": 3,
        "short": "回收与持久化：VACUUM、冻结、WAL",
        "asset": "03-vacuum-wal",
        "tags": ["PostgreSQL", "VACUUM", "WAL", "冻结", "持久化"],
    },
    {
        "src": "04 索引 · PostgreSQL 核心机制教程.html",
        "out": "04-索引.md",
        "slug": "postgresql-indexes",
        "chapter": 4,
        "short": "索引",
        "asset": "04-indexes",
        "tags": ["PostgreSQL", "索引", "B-tree", "GIN", "GiST", "BRIN"],
    },
    {
        "src": "05 查询规划与执行 · PostgreSQL 核心机制教程.html",
        "out": "05-查询规划与执行.md",
        "slug": "postgresql-query-planning-and-execution",
        "chapter": 5,
        "short": "查询规划与执行",
        "asset": "05-planner",
        "tags": ["PostgreSQL", "查询规划器", "执行计划", "EXPLAIN", "Join"],
    },
    {
        "src": "06 深入对比 MySQL · PostgreSQL 核心机制教程.html",
        "out": "06-深入对比-MySQL.md",
        "slug": "postgresql-vs-mysql-internals",
        "chapter": 6,
        "short": "深入对比 MySQL",
        "asset": "06-vs-mysql",
        "tags": ["PostgreSQL", "MySQL", "InnoDB", "数据库对比"],
    },
    {
        "src": "自测 · PostgreSQL 核心机制教程.html",
        "out": "07-自测.md",
        "slug": "postgresql-core-mechanisms-self-check",
        "chapter": 7,
        "short": "自测",
        "asset": "07-self-check",
        "tags": ["PostgreSQL", "自测", "面试题", "数据库原理"],
    },
]

URL_TO_OUT = {
    "index.html": "00-起点.md",
    "01-storage.html": "01-存储与数据模型.md",
    "02-mvcc.html": "02-MVCC-与事务.md",
    "03-vacuum-wal.html": "03-回收与持久化-VACUUM-冻结-WAL.md",
    "04-indexes.html": "04-索引.md",
    "05-planner.html": "05-查询规划与执行.md",
    "06-vs-mysql.html": "06-深入对比-MySQL.md",
    "07-self-check.html": "07-自测.md",
}

SVG_STYLE = """
:root {
  --bg: #ffffff;
  --ink: #0a0a0a;
  --ink-soft: #525252;
  --ink-faint: #a3a3a3;
  --vermilion: #b73b2f;
  --vermilion-soft: rgba(183, 59, 47, 0.08);
  --sans: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --mono: "JetBrains Mono", Consolas, monospace;
}
.diagram-ink { stroke: var(--ink); fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.diagram-accent { stroke: var(--vermilion); fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.diagram-soft { stroke: var(--ink-faint); fill: none; stroke-width: 1.1; stroke-dasharray: 3 3; }
.node-fill { fill: var(--bg); }
.node-fill-accent { fill: var(--vermilion-soft); }
.node-label { font-family: var(--sans); font-size: 13px; font-weight: 500; fill: var(--ink); }
.node-label-accent { font-family: var(--sans); font-size: 13px; font-weight: 700; fill: var(--vermilion); }
.edge-label { font-family: var(--mono); font-size: 11px; fill: var(--ink-soft); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
.branch-label { font-family: var(--mono); font-size: 11px; font-weight: 700; fill: var(--vermilion); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
""".strip()

ATTR_CASE = {
    "viewbox": "viewBox",
    "markerwidth": "markerWidth",
    "markerheight": "markerHeight",
    "refx": "refX",
    "refy": "refY",
    "gradientunits": "gradientUnits",
    "gradienttransform": "gradientTransform",
    "preserveaspectratio": "preserveAspectRatio",
}


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([，。；：！？、）】》])", r"\1", text)
    text = re.sub(r"([（【《])\s+", r"\1", text)
    return text


def yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def make_tag(soup: BeautifulSoup, name: str, text: str | None = None, **attrs) -> Tag:
    tag = soup.new_tag(name, **attrs)
    if text is not None:
        tag.string = text
    return tag


def normalize_svg(svg: Tag, out_path: Path) -> None:
    svg = copy.deepcopy(svg)
    for tag in svg.find_all(True):
        for old, new in ATTR_CASE.items():
            if old in tag.attrs:
                tag.attrs[new] = tag.attrs.pop(old)
    svg.attrs["xmlns"] = "http://www.w3.org/2000/svg"
    style = BeautifulSoup("", "html.parser").new_tag("style")
    style.string = SVG_STYLE
    svg.insert(0, style)
    content = '<?xml version="1.0" encoding="UTF-8"?>\n' + str(svg)
    out_path.write_text(content, encoding="utf-8")


def rewrite_href(href: str) -> str:
    if not href:
        return href
    if href.startswith("#"):
        return href
    parsed = urlparse(href)
    if href.startswith(BASE_URL) or parsed.netloc == "zhiwenliang.github.io":
        filename = Path(parsed.path).name or "index.html"
        if filename in URL_TO_OUT:
            return "./" + URL_TO_OUT[filename] + (("#" + parsed.fragment) if parsed.fragment else "")
    return href


def div_to_blockquote(soup: BeautifulSoup, node: Tag, label: str | None = None) -> None:
    node.name = "blockquote"
    if label:
        p = make_tag(soup, "p")
        strong = make_tag(soup, "strong", label)
        p.append(strong)
        node.insert(0, p)


def process_article(page: dict) -> tuple[str, str, str, str]:
    source_path = SOURCE / page["src"]
    raw = source_path.read_text(encoding="utf-8")
    source_match = re.search(r"saved from url=\(\d+\)([^ ]+) -->", raw)
    source_url = source_match.group(1) if source_match else ""
    soup = BeautifulSoup(raw, "html.parser")
    article = soup.find("article")
    if not article:
        raise RuntimeError(f"No <article> in {source_path}")

    opener = article.select_one("header.chapter-opener")
    title = clean_text(opener.find("h1").get_text(" ", strip=True)) if opener and opener.find("h1") else page["short"]
    recap_node = opener.select_one("p.recap") if opener else None
    recap = clean_text(recap_node.get_text(" ", strip=True)) if recap_node else ""
    chapter_label = clean_text(opener.select_one("p.chapter-label").get_text(" ", strip=True)) if opener and opener.select_one("p.chapter-label") else f"第 {page['chapter']:02d} 章"
    if opener:
        opener.decompose()

    for nav in article.select("nav.chapter-nav"):
        nav.decompose()
    for button in article.find_all("button"):
        button.decompose()

    # Keep stable, explicit anchor IDs after conversion to Markdown.
    for heading in article.find_all(["h2", "h3"]):
        anchor = heading.get("id")
        if anchor:
            marker = NavigableString(f"\n\n@@ANCHOR:{anchor}@@\n\n")
            heading.insert_before(marker)
        if heading.name == "h2":
            num = heading.select_one("span.num")
            if num:
                heading_text = clean_text(heading.get_text(" ", strip=True))
                heading.clear()
                heading.string = heading_text

    # Make syntax-highlighted HTML code clean Markdown code blocks.
    for pre in article.find_all("pre"):
        code = pre.find("code")
        if code:
            language = ""
            for cls in list(pre.get("class", [])) + list(code.get("class", [])):
                if cls.startswith("language-"):
                    language = cls.split("-", 1)[1]
                    break
            raw_code = code.get_text("", strip=False).strip("\n")
            code.clear()
            code.string = raw_code
            code.attrs = {"class": [f"language-{language}"]} if language else {}
            pre.attrs = {"class": [f"language-{language}"]} if language else {}

    for block in article.select("div.code-block"):
        header = block.select_one("div.header")
        if header:
            filename_node = header.select_one("span.filename")
            label = clean_text(filename_node.get_text(" ", strip=True)) if filename_node else clean_text(header.get_text(" ", strip=True))
            header.clear()
            p = make_tag(soup, "p")
            p.append(make_tag(soup, "strong", label))
            header.replace_with(p)

    # Better labels for annotated walkthrough lists.
    for annotations in article.select("span.annotations"):
        line_ref = annotations.select_one("span.line-ref")
        if line_ref:
            strong = make_tag(soup, "strong", clean_text(line_ref.get_text(" ", strip=True)) + "：")
            annotations.replace_with(strong)
        else:
            annotations.unwrap()

    # Structured panels and callouts.
    for panel in article.select("section.schema-panel"):
        label = panel.select_one("p.label")
        if label:
            label.name = "h2"
            label.string = "本章要点"

    for rationale in article.select("div.rationale"):
        label = rationale.select_one("span.label")
        if label:
            label.decompose()
        div_to_blockquote(soup, rationale, "为什么需要它")

    callout_labels = {
        "warning": "⚠️ 注意",
        "tip": "💡 提示",
        "insight": "🔗 主线串联",
        "example": "🧪 实践",
    }
    for callout in article.select("div.callout"):
        extra = next((c for c in callout.get("class", []) if c in callout_labels), None)
        title_node = callout.select_one("span.title")
        callout_title = clean_text(title_node.get_text(" ", strip=True)) if title_node else ""
        if title_node:
            title_node.decompose()
        label = callout_labels.get(extra, "提示")
        if callout_title:
            label += " · " + callout_title
        div_to_blockquote(soup, callout, label)

    for predict in article.select("div.predict"):
        qlabel = predict.select_one("span.question-label")
        if qlabel:
            qlabel.decompose()
        intro = make_tag(soup, "p")
        intro.append(make_tag(soup, "strong", "🤔 思考题"))
        predict.insert(0, intro)
        div_to_blockquote(soup, predict)

    for challenge in article.select("div.challenge"):
        label = challenge.select_one("span.label")
        if label:
            label.name = "h2"
            label.string = "进阶挑战"

    for detail in article.find_all("details"):
        summary = detail.find("summary")
        summary_text = clean_text(summary.get_text(" ", strip=True)) if summary else "参考答案"
        if summary:
            summary.decompose()
        if "展开" in summary_text or "查看" in summary_text:
            summary_text = "参考答案"
        h = make_tag(soup, "h4", summary_text)
        detail.insert(0, h)
        detail.name = "div"
        detail.attrs = {}

    for refs in article.select("footer.references"):
        refs.name = "section"
        heading = refs.find(["h2", "h3"])
        if heading:
            heading.name = "h2"

    # Extract standalone SVGs with their original captions.
    figure_no = 0
    for figure in list(article.find_all("figure")):
        svg = figure.find("svg")
        if not svg:
            continue
        figure_no += 1
        asset_name = f"{page['asset']}-figure-{figure_no:02d}.svg"
        normalize_svg(svg, ASSETS / asset_name)
        caption_node = figure.find("figcaption")
        caption = clean_text(caption_node.get_text(" ", strip=True)) if caption_node else ""
        alt = clean_text(svg.get("aria-label", "")) or caption or f"{title} 图 {figure_no}"

        wrapper = make_tag(soup, "div")
        image_p = make_tag(soup, "p")
        image = make_tag(soup, "img", src=f"./assets/{asset_name}", alt=alt)
        image_p.append(image)
        wrapper.append(image_p)
        if caption:
            cap_p = make_tag(soup, "p")
            em = make_tag(soup, "em", caption)
            cap_p.append(em)
            wrapper.append(cap_p)
        figure.replace_with(wrapper)

    for link in article.find_all("a", href=True):
        link["href"] = rewrite_href(link["href"])

    body = md(
        str(article),
        heading_style="ATX",
        bullets="-",
        strong_em_symbol="*",
        strip=["article", "section", "div", "span", "footer"],
        code_language_callback=lambda el: next((c.split("-", 1)[1] for c in el.get("class", []) if c.startswith("language-")), ""),
    )

    body = re.sub(r"@@ANCHOR:([A-Za-z0-9_-]+)@@", r'<a id="\1"></a>', body)
    body = re.sub(r"\n(<a id=)", r"\n\n\1", body)
    body = re.sub(r"^(#{2,6})\s+§(\d+)\s*", r"\1 §\2 ", body, flags=re.M)
    body = re.sub(r"[ \t]+\n", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    body = body.replace(" 复制", "").replace("复制\n", "")

    tags_yaml = ", ".join(yaml_quote(t) for t in page["tags"])
    frontmatter = "\n".join([
        "---",
        f"title: {yaml_quote(title)}",
        f"description: {yaml_quote(recap)}",
        f"slug: {yaml_quote(page['slug'])}",
        f"date: {BUILD_DATE}",
        f"updated: {BUILD_DATE}",
        f"series: {yaml_quote('从一条规则读懂 PostgreSQL')}",
        f"chapter: {page['chapter']}",
        f"tags: [{tags_yaml}]",
        f"source: {yaml_quote(source_url)}",
        "draft: false",
        "---",
    ])

    intro = f"# {title}\n\n> **{chapter_label}**  \n> {recap}" if recap else f"# {title}"
    source_note = f"> 本文由本地保存的教程页面整理为 Markdown；原始页面：{source_url}" if source_url else "> 本文由本地保存的教程页面整理为 Markdown。"

    idx = page["chapter"]
    prev_link = f"[← 上一篇：{PAGES[idx-1]['short']}](./{PAGES[idx-1]['out']})" if idx > 0 else ""
    next_link = f"[下一篇：{PAGES[idx+1]['short']} →](./{PAGES[idx+1]['out']})" if idx < len(PAGES) - 1 else ""
    nav = " | ".join(x for x in [prev_link, "[返回目录](./README.md)", next_link] if x)

    document = f"{frontmatter}\n\n{intro}\n\n{source_note}\n\n{body}\n\n---\n\n{nav}\n"
    return title, recap, source_url, document


def make_readme(meta: list[dict]) -> str:
    rows = []
    for page, info in zip(PAGES, meta):
        rows.append(f"| {page['chapter']:02d} | [{page['short']}](./{page['out']}) | {info['recap']} |")
    return f"""# 从一条规则读懂 PostgreSQL

> **核心规则：PostgreSQL 的写入通常不是原地覆盖，而是创建新的行版本。**
>
> 从这一条规则出发，可以把存储、MVCC、VACUUM、WAL、索引、查询规划器，以及 PostgreSQL 与 MySQL 的关键差异串成一条完整因果链。

## 文档说明

- 来源：`{SOURCE}` 下的 8 个本地 HTML 教程页面。
- 输出：适合 Hexo、Hugo、VuePress、VitePress、MkDocs 或通用 Markdown 博客系统的文章。
- 生成日期：{BUILD_DATE}。
- 原始 HTML 未被修改；示意图已拆分为 `assets/*.svg`。
- 每篇文章都带 YAML Front Matter、章节导航、稳定锚点和本地化的跨章节链接。

## 阅读路线

| 章节 | 文章 | 你将建立的认识 |
|---:|---|---|
{chr(10).join(rows)}

## 推荐阅读方式

1. **第一次阅读**：从“起点”顺序读到“深入对比 MySQL”，先建立机制之间的因果链。
2. **第二次阅读**：重点重读 MVCC、VACUUM/WAL、索引、查询规划四章，并完成每章自测。
3. **查漏补缺**：最后做“自测”篇的概念层、原理层和判别层问题。

## 一句话主线

```text
UPDATE 产生新 tuple
  → 同一逻辑行出现多个版本
  → 快照决定每个事务看见哪个版本
  → 旧版本最终成为死元组
  → VACUUM 回收空间并维护可见性信息
  → WAL 保证这些写入在崩溃后可恢复
  → 索引通过 ctid 指向堆中的版本
  → 规划器根据统计信息与成本选择访问路径
```

## 合集版本

如需单文件发布或导出 PDF，请使用：

- [PostgreSQL 核心机制教程·合集](./PostgreSQL-核心机制教程-合集.md)
"""


def strip_frontmatter(text: str) -> str:
    return re.sub(r"\A---\n.*?\n---\n+", "", text, count=1, flags=re.S)


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    ASSETS.mkdir(parents=True, exist_ok=True)

    meta = []
    documents = []
    for page in PAGES:
        title, recap, source_url, document = process_article(page)
        (OUTPUT / page["out"]).write_text(document, encoding="utf-8")
        meta.append({"title": title, "recap": recap, "source": source_url})
        documents.append(document)

    (OUTPUT / "README.md").write_text(make_readme(meta), encoding="utf-8")

    combined_frontmatter = "\n".join([
        "---",
        f"title: {yaml_quote('从一条规则读懂 PostgreSQL：核心机制教程（合集）')}",
        f"description: {yaml_quote('从行版本出发，系统理解 PostgreSQL 的存储、MVCC、VACUUM、WAL、索引、查询规划，以及与 MySQL 的核心差异。')}",
        f"slug: {yaml_quote('postgresql-core-mechanisms-complete-guide')}",
        f"date: {BUILD_DATE}",
        f"updated: {BUILD_DATE}",
        f"tags: [{yaml_quote('PostgreSQL')}, {yaml_quote('数据库原理')}, {yaml_quote('MVCC')}, {yaml_quote('WAL')}, {yaml_quote('索引')}]",
        "draft: false",
        "---",
    ])
    toc = "\n".join(f"{i+1}. [{p['short']}](#{p['slug']})" for i, p in enumerate(PAGES))
    parts = [combined_frontmatter, "# 从一条规则读懂 PostgreSQL：核心机制教程（合集）", "## 全集目录", toc]
    for page, document in zip(PAGES, documents):
        content = strip_frontmatter(document)
        content = re.sub(r"\n---\n\n(?:\[←.*?\n|\[返回目录.*?\n|.*?返回目录.*?\n)?\s*\Z", "", content, flags=re.S)
        # Remove per-file source note and local navigation, keep article body.
        content = re.sub(r"\n> 本文由本地保存的教程页面整理为 Markdown；原始页面：.*?\n", "\n", content)
        def combined_link(match):
            filename = match.group(1)
            fragment = match.group(2)
            target_page = next((p for p in PAGES if p["out"] == filename), None)
            target = fragment if fragment else ("#" + target_page["slug"] if target_page else "#")
            return "](" + target + ")"
        content = re.sub(r"\]\(\./([^#)]+\.md)(#[^)]+)?\)", combined_link, content)
        parts.append(f'<a id="{page["slug"]}"></a>\n\n{content.strip()}')
    header = "\n\n".join(parts[:4])
    chapters = "\n\n---\n\n".join(parts[4:])
    combined = header + "\n\n---\n\n" + chapters + "\n"
    (OUTPUT / "PostgreSQL-核心机制教程-合集.md").write_text(combined, encoding="utf-8")

    print(f"Generated {len(PAGES)} chapter files, README, combined document, and {len(list(ASSETS.glob('*.svg')))} SVG assets in {OUTPUT}")


if __name__ == "__main__":
    main()

