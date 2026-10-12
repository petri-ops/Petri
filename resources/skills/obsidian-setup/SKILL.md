---
name: Obsidian Setup
description: 核验 Obsidian 工具链在本机的可用性：obsidian-cli/defuddle/knap 是否就绪、缺什么、怎么装。配置环境或依赖报错排查时使用。
version: 1.0.0
category: coding/notes
tags: obsidian,setup,preflight
---

# Obsidian Setup — 工具链核验手册

## 何时使用

初次配置 Obsidian 相关工作流；或 obsidian-cli/defuddle/knap 技能报缺依赖时的排查入口。

## 工作流

1. 跑 `skill_preflight` 工具，看三件外部依赖的当前状态（obsidian-cli / defuddle / knap；Obsidian 本体以用户自述为准）。
2. 对 installable/missing_deps 项：把 install 配方原文给用户，说明要执行什么；用户同意后经既有命令工具**走审批确认**执行（未批准不执行）。
3. 装完重跑 skill_preflight 复核；全部 available 后引导用户回到对应技能工作流。
4. blocked_platform 项如实告知平台不适用（本套技能面向桌面环境）。

## 边界

- 本技能是核验/引导面，不替代各技能本身；不代用户决定是否安装应用本体（Obsidian）。
