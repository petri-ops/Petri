---
name: Mermaid Visualizer
description: 把文本转成专业 Mermaid 图（流程图/时序图/类图/状态图/思维导图/时间线等），流程叙事、思维过程、系统关系可视化时使用。
version: 1.0.0
category: coding/notes
tags: mermaid,diagram,visualization
---

# Mermaid Visualizer — 图表生成手册

## 何时使用

用户要把流程、时序、结构、思维过程画成图；或要求「画个流程图/时序图/思维导图」。

## 图型选型

- 流程/决策 → `flowchart TD`（上下）或 `LR`（左右）
- 交互时序 → `sequenceDiagram`
- 类/结构 → `classDiagram`；状态机 → `stateDiagram-v2`
- 概念发散 → `mindmap`；阶段演进 → `timeline`
- 甘特 → `gantt`；象限 → `quadrantChart`

## 产出路径（Petri 形态）

1. **优先**：把 mermaid 代码块交给 Gen UI 卡片渲染（前端会话内直接出图）；内置 visualize 技能含「模板优先」节——先查既有模板命中再手写，几何/配色走既有 token。
2. 用户要落盘时，写 `.md` 文件内嵌 mermaid 代码块（Obsidian/多数渲染器直接渲染）。

## 语法纪律

- 节点 id 用 ASCII；显示文本含特殊字符用引号包裹 `A["文本(含括号)"]`。
- 连线标签 `A -->|说明| B`；子图 `subgraph 名称 ... end`。
- 写完自查：括号/引号配对、箭头语法、关键字拼写（Mermaid 对未知关键字会整图渲染失败）。

## 边界

- 大而复杂的定制视觉产物（非标准图型）→ excalidraw-diagram 技能；容器/卡片布局 → json-canvas 技能。
