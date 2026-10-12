---
name: Defuddle
description: 用 Defuddle CLI 把网页提取成干净 markdown（去广告/导航/杂讯，保留正文）。网页正文采集入知识库时使用；通用抓取读不到整洁正文时的提取面。
version: 1.0.0
category: coding/extract
tags: defuddle,extract,markdown
requires.bins: defuddle
install: npm install -g defuddle-cli（Node 环境全局安装；装后 defuddle --version 验证）
---

# Defuddle — 网页正文提取手册

## 何时使用

要把网页转成干净 markdown 存入知识库/笔记，通用抓取带太多杂讯时。

## 前置（依赖声明）

frontmatter 声明 `requires.bins: defuddle`——skill_preflight 未过时按 install 配方装（`npm install -g defuddle-cli`，经既有命令工具走审批确认后执行）。

## 工作流

1. `defuddle --help` 确认入口与参数（输出格式/元数据保留等以帮助输出为准）。
2. 对目标 URL 运行提取，产出 markdown 正文。
3. 入库路径二选一：写 vault/目录文件（文件工具），或调用既有知识库导入通道（用户要求入 Petri 知识库时）。
4. 提取失败（页面反爬/需登录）→ 如实报告，不静默交空文档。

## 边界

- 只处理用户提供的或任务上下文中明确的 URL；不批量爬取站点（那类任务需用户明示范围与授权）。
