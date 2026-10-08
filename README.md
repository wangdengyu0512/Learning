# 向内生长

一个记录技术原理、系统设计与工程实践的静态个人博客，基于 Next.js 构建并部署到 GitHub Pages。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。

## 写一篇新文章

文章都放在 `content/posts/` 目录中。推荐从模板开始：

1. 复制 `content/posts/_template.md`。
2. 将副本改名，例如 `my-first-post.md`。
3. 修改文件顶部的文章信息。
4. 在第二个 `---` 下面使用 Markdown 写正文。
5. 执行 `npm run dev` 预览。

以下划线开头的 Markdown 文件不会发布，因此 `_template.md` 只会作为写作模板。

### 文章信息

```md
---
title: 文章标题
description: 一句话摘要
date: 2026-10-05
tags: Next.js, 学习
featured: true
---
```

- `title`：文章标题。
- `description`：首页和文章列表显示的摘要。
- `date`：发布日期，格式为 `YYYY-MM-DD`。
- `tags`：用英文逗号分隔多个标签。
- `featured`：设为 `true` 时优先显示在首页，设为 `false` 时只进入文章列表。

### 支持的正文语法

````md
## 二级标题

普通段落，可以使用 **粗体**、`行内代码` 和 [链接](https://example.com)。

- 无序列表
- 另一项

1. 有序列表
2. 另一项

> 这是一段引用。

```ts
const message = "这是一段代码";
```
````

## 修改博客资料

- 网站名称、简介和社交链接：`lib/site.ts`
- 首页：`app/page.tsx`
- 关于页面：`app/about/page.tsx`
- 全局视觉样式：`app/globals.css`

推送到 `main` 分支后，GitHub Actions 会自动构建并发布到 GitHub Pages。
