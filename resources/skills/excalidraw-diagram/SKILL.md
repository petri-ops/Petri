---
name: Excalidraw Diagram
description: 生成 Excalidraw 手绘风图表（.excalidraw JSON：矩形/椭圆/箭头/文本元素）。架构草图、白板风格示意图时使用。
version: 1.0.0
category: coding/notes
tags: excalidraw,diagram,whiteboard
---

# Excalidraw Diagram — 图表生成手册

## 何时使用

用户要手绘风格的示意图/架构草图/白板布局，或明确要求 .excalidraw 文件。

## 文件格式

`.excalidraw` = JSON：顶层对象含 `type: "excalidraw"`、`version: 2`、`elements` 数组、`appState`（如 `viewBackgroundColor`）与 `files`。

元素公共字段：`id`（唯一）、`type`（rectangle/ellipse/diamond/arrow/line/text/freedraw）、`x/y/width/height`、`angle: 0`、`strokeColor/fillColor/backgroundColor`、`fillStyle`（hachure=手绘斜线/solid）、`strokeWidth`、`roughness`（0-2，越大越手绘）、`seed`、`version: 1`、`isDeleted: false`、`boundElements: null`、`groupIds: []`、`frameId: null`、`link: null`、`locked: false`。

- text 元素额外：`text`、`fontSize`、`fontFamily`（1=手绘 2=正常 3=代码）、`textAlign`。
- arrow 元素额外：`points`（相对起点的折线，首点 [0,0]）、`startBinding/endBinding: null`、`startArrowhead/endArrowhead: null`（需箭头端填 `"arrow"`）。

## 工作流

1. 先布局后连线：算好各框 x/y/width/height（等距网格，不重叠），箭头 points 连框边中点。
2. 文本框放框中心附近；字号分层（标题大/正文中/注释小）。
3. 写入 `.excalidraw` 文件；JSON 必须可解析（id 唯一、points 数组数值完整）。

## 边界

- 标准图型（流程/时序）优先 mermaid-visualizer；容器看板布局优先 json-canvas。
- 产物是**数据文件**，Petri 内不做 excalidraw 运行时渲染；用户在 Excalidraw/Obsidian Excalidraw 插件中打开。
