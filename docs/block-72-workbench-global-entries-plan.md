# BLOCK-72 — 工作台全局入口：知识空间 + 后端迁出项目工作区

> 状态：`active`（2026-09-09 用户裁决「知识+后端一起，右栏 tab 删 开工吧」，同日立项即开工）
> 立项日期：2026-09-09
> truthDomain: `block-72-workbench-global-entries`
> UI 台账：UI-320（实现同提交登记）
> 来源：用户 2026-09-09 评审 BLOCK-69 收口后的界面归属裁决（左栏截图）

## 1. 用户裁决

> 「知识、后端应该放在工作台中，它们是全局的，不是项目或者会话关联的」

裁决范围（开工指令）：**知识+后端一起迁；右栏 tab 删**。

## 2. 语义依据

- 知识空间存储真相是设备级全局（BLOCK-69 D1：单行 default 空间，文档/开关不挂 project/conversation）；
  现管理面（右栏 knowledge tab）只在项目工作区内可达——暗示了不存在的作用域，且首页无入口。
- 后端 biof3-server 是全局单进程；右栏「后端」tab 同为项目附属面。
- 左栏「工作台」区（搜索/插件/Skills）是全局能力区的既有先例；知识空间与 Skills 同为「智能体的全局器官」。

## 3. 设计裁决

- **D1 全局路由**（对标 /skills 先例）：新增 `/knowledge` 与 `/backend` 全局路由页；左栏工作台区新增
  「知识空间」（brain icon）与「后端」（cpu icon）入口，`navigate()` 直达（Skills 同款），带回退头。
- **D2 右栏 tab 删除**：`RightPanelMode` 去掉 `'knowledge'` 与 `'terminal'`；`RIGHT_PANEL_ITEMS` 同步删两行；
  RightPanel 分发删除两分支；home 空态「后端」快捷卡与既有打开逻辑改跳 `/backend`。
  **不预留空壳**（BLOCK-68 先例）。composer 大脑开关**保留**（会话内快捷启停，D6「启用即生效」心智，
  与全局管理面不冲突——开关是态，页面是管理）。
- **D3 组件复用**：KnowledgeSpacePanel 原样复用（本就零项目 ctx 依赖）；TerminalPanel 放宽
  `project` 为可选（仅用于 workspacePath 展示与 openShell cwd；全局态回退数据根目录），
  `backendStatus` 经既有 `useBackendStatus()`（BackendStatusProvider）获取。
- **D4 单一管理面**：知识空间管理面唯一化到 /knowledge；右栏不保留跳转残件。
  检索测试框/上传/删除/清空等能力全部随面板迁移，行为不变。

## 4. 阶段

| 阶段 | 内容 |
| --- | --- |
| P1 | 路由 + 页面（/knowledge /backend）+ 左栏工作台入口 + 右栏 tab 删除 + TerminalPanel props 放宽 |
| P2 | 定向测试（LeftPanel/RightPanel/页面冒烟）+ tsc + 门禁 |
| P3 | 实机 CDP 验收（acceptance/ui-320/）+ UI-320 台账 + 收口回写 |

## 5. 验收门

- tsc 0；受影响定向 vitest；docs:check + ui:audit:check
- 实机 CDP：左栏工作台含「知识空间/后端」入口；/knowledge 渲染知识面板（上传/检索可用）；
  /backend 渲染后端进程面；右栏 tab 栏不再出现 知识/后端 两项；composer 大脑开关仍在
- UI-320 台账与实现同提交登记

## 6. 范围外

- 底部终端（BLOCK-54 用户侧多 tab 终端）不动——后端页定位是全局后端进程观测面，非用户 shell
- 知识空间多空间演进（space 字段预留位）另行裁决
- BLOCK-70 文件面零触碰
- G0 开发期常态 · 不外推 packaged/Provider/GA
