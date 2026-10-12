---
name: Knap
description: 用 Knap CLI 把 markdown 按模板渲染/落成笔记。已有结构化模板要套用或批量产出时使用。
version: 1.0.0
category: coding/notes
tags: knap,template,markdown
requires.bins: knap
install: 参照 Knap 官方仓库 README 安装节（包管理器安装；装后 knap --version 验证）
---

# Knap — 模板渲染手册

## 何时使用

用户已有一套 markdown 模板（或要求按某模板产出），要把内容套模板生成/渲染文件。

## 前置（依赖声明）

frontmatter 声明 `requires.bins: knap`——skill_preflight 未过时按 install 配方装（经既有命令工具走审批确认后执行）。

## 工作流

1. `knap --help` 实测子命令与参数（模板定位/变量注入/输出路径以帮助输出为准，不凭记忆）。
2. 模板文件缺失时先与用户确认模板来源（用户提供路径，或由你起草模板文件再套用）。
3. 产出写入用户指定位置；批量套用时先跑单文件样本给用户过目再批量。

## 边界

- 模板变量名以模板文件实际内容为准；不确定时读模板文件本身而不是猜。
