---
name: Obsidian Bases
description: 生成 Obsidian Bases（.base）数据库视图：按 frontmatter 属性筛选/排序/分组笔记的卡片或表格视图。结构化笔记集合管理时使用。
version: 1.0.0
category: coding/notes
tags: obsidian,bases,database-view
---

# Obsidian Bases — 数据库视图生成手册

## 何时使用

用户要把一批笔记（共享 frontmatter 属性）做成可筛选/排序/分组的数据库视图，或要求 .base 文件。

## 文件格式

`.base` = YAML：`filters`（按笔记 frontmatter 属性过滤的条件表达式，如相等比较、标签判定）、`views`（视图列表，每项含 `type: cards` 或 `table`、排序 `order`、可选分组 `group-by` 等）。

语法细节以 Obsidian 官方 Bases 文档为准——不确定运算符/函数名时，提示用户核对官方文档，或先在 Obsidian 内手工建一个视图导出做参照；**不要凭记忆编造过滤函数名**。

## 工作流

1. 先看目标笔记集合的 frontmatter 字段（用文件工具抽样 2-3 篇），筛选/排序/分组只用**真实存在的属性**。
2. 视图选型：卡片墙（预览型）用 cards；字段清单用 table。
3. 写入 `.base`；YAML 缩进一致（两空格层）。

## 边界

- 只管视图定义；改笔记 frontmatter 本身走文件工具 + obsidian-markdown 语法。
