---
name: Obsidian CLI
description: 用官方 Obsidian CLI（随 Obsidian 1.12+ 分发）操作 vault：检索、打开、笔记管理等命令行能力。需要对已装 Obsidian 做自动化操作时使用。
version: 1.0.0
category: coding/notes
tags: obsidian,cli,automation
requires.bins: obsidian-cli
install: 随 Obsidian 1.12+ 官方分发（先确认 Obsidian 本体已装并升级到 1.12+，CLI 安装入口见应用内/官方文档）
---

# Obsidian CLI — vault 操作手册

## 何时使用

对用户本机 Obsidian vault 做检索/管理类操作（列表、打开、批量信息读取），且用户已装 Obsidian 1.12+。

## 前置（依赖声明）

frontmatter 声明 `requires.bins: obsidian-cli`——先跑 skill_preflight 确认在位；未装时按 install 说明引导（装/升级 Obsidian 本体），**不代用户安装应用本体**。

## 工作流

1. `obsidian-cli --help`（或官方分发的实际入口名）确认可用子命令与全局参数——**不凭记忆猜测子命令**，每次以帮助输出实测为准。
2. 按用户意图组合子命令；先只读操作（列出/检索）再写操作。
3. 涉及 vault 文件落盘时走既有文件工具，并在回复中给出相对 vault 根的路径。

## 边界

- CLI 不可用或用户没装 Obsidian → 如实告知缺依赖，转到纯文件工具 + obsidian-markdown 语法直接写 vault 目录（vault 本质是文件系统目录）。
- 不做 vault 全量备份/批量删除类操作，除非用户明确逐项确认。
