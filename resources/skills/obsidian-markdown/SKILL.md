---
name: Obsidian Markdown
description: 撰写 Obsidian Flavored Markdown：wikilinks、embeds、frontmatter properties、tags、callouts、footnotes。写笔记、知识库文档、双链结构时使用。
version: 1.0.0
category: coding/notes
tags: obsidian,markdown,notes
---

# Obsidian Markdown — 撰写手册

## 何时使用

用户要求写 Obsidian 笔记、知识库文档、带双链/属性/标注的 markdown 时。

## 语法要点（按需选用，不要堆砌）

- **wikilinks**：`[[页面名]]`、`[[页面名|显示名]]`、`[[页面名#小节]]`；链接到不存在的页面=合法（即为建档意图）。
- **embeds**：`![[文件名]]` 嵌入笔记/图片/小节。
- **frontmatter properties**：文件开头 `---` 包裹的 YAML（tags/aliases/date 等字段）。
- **tags**：正文 `#tag` 或 frontmatter `tags:` 列表。
- **callouts**：`> [!note]` / `[!tip]` / `[!warning]` 等（GFM blockquote 扩展）。
- **footnotes**：`[^1]` 行内引用 + 文末 `[^1]: 内容` 定义。
- 注释：`%%这是不会渲染的注释%%`。

## 工作流

1. 先用文件读写工具查看目标 vault 中相邻文件的既有风格（frontmatter 字段习惯、命名习惯），跟随而非另起一套。
2. 按用户意图选择语法子集；纯文本笔记不必强加 properties。
3. 写完自查：链接目标名拼写、frontmatter YAML 可解析（冒号后有值、列表缩进一致）。

## 边界

- 本技能只管**撰写**；vault 操作（检索/重命名/批量管理）见 obsidian-cli 技能（外部 CLI，须先装）。
- 产物通过既有文件工具写入用户指定路径；不虚构 vault 内不存在文件的链接目标。
