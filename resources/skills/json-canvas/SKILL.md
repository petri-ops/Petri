---
name: JSON Canvas
description: 生成 JSON Canvas（.canvas）无限画板文件：文本/文件/链接/组节点 + 带标签彩色的边。看板式布局、卡片墙、流程容器时使用。
version: 1.0.0
category: coding/notes
tags: json-canvas,canvas,layout
---

# JSON Canvas — 画板生成手册

## 何时使用

用户要 .canvas 看板/卡片墙/分组布局，或要求 JSON Canvas 格式文件。

## 文件格式

`.canvas` = JSON：`{"nodes": [...], "edges": [...]}`。

节点公共字段：`id`、`x/y/width/height`（整数像素）、`type`、`color`（"1" 到 "6" 预设色或 hex）。按 type 追加：

- `text`：+ `text`（支持 markdown）
- `file`：+ `file`（vault 内路径）、可选 `subpath`（井号小节）
- `link`：+ `url`
- `group`：+ 可选 `label`；组先声明，子节点坐标落在组矩形内

边：`id`、`fromNode`、`toNode`、可选 `fromSide/toSide`（top/bottom/left/right）、可选 `label`、可选 `color`。

## 工作流

1. 先排坐标再连边：列宽一致、行距一致；组先摆，子卡片放组内。
2. id 用短横线小写唯一串；edge 的 fromNode/toNode 必须引用存在节点 id。
3. 写入 `.canvas` 文件；自查 JSON 可解析、无悬空边引用。

## 边界

- 手绘风示意 → excalidraw-diagram；标准图型 → mermaid-visualizer。产物为数据文件，渲染发生在 Obsidian/兼容查看器。
