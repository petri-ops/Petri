# BioF3 Agent 工作台增强计划

> 文档版本：v1.4（增量增强版 · 修订 3 Phase 2/3 逐项对账收束）
> 创建日期：2026-08-14
> 修订日期：2026-09-12
> 状态：**active（P0 完成；P1 取消；P2/P3 已逐项对账，待路线裁决后收束）**
> 负责人：BioF3 Team
> 目标：在现有 BioF3 Desktop 工作台基础上**渐进式增添** Codex 式 AI 生信协作能力

---

## -1. 2026-09-12 立项登记与现状对账（P0-LAUNCH）

> 本节为 v1.2 立项增量；§0～§11 原有约束与设计继续有效，冲突时以本节对账结论为准。

### 用户裁决与启动来源

用户裁决（2026-09-12，队列候选问答）：在「AGENT-WORKBENCH / G0-RS / G0-SDC / BLOCK-70-MOBILE-SYNC」四个 planned 候选中**选择 AGENT-WORKBENCH 启动**。本包为既有 Plan ID 的增量复活（v1.1 写于 2026-08-14，Phase 1 已由当期会话完成大部分），不新建 ID。

### 现状对账（2026-09-12 逐项核实）

- **Phase 1 已完成七项（不重复开发）**：UI-AGENTWB-001（P1.1 ResultCard 契约层）/ 002（P1.2 表格渲染器）/ 003（P1.3 chart+image 渲染器）＝ verified；UI-AGENTWB-004（A4 SimpleChat 注入桥）/ 005（Chart 交互层 + a11y）/ 006（P1.5 CSV/Markdown 导出）/ 007（flag 生产态切换 Settings + 启动参数）＝ **dev Electron 边界内 verified**（前端 + dev + packaged 三轴）。证据：`docs/agent-workbench-p1-a5-verification-2026-08-15.md`、`docs/agent-workbench-dev-electron-verification-2026-08-15.md`（T-AW-014）、`docs/t-aw-013-packaged-verification-2026-08-15.md`（T-AW-013）。代码在库核实：`frontend/src/components/copilot/ResultCard.tsx`、`extraRenderers.tsx`、`renderers/{Text,Table,Chart,Image}Renderer.tsx` 均存在。
- **P1.4 参数确认卡片未实现**：无 `ParamConfirmCard.tsx`、无 copilot 下 param/confirm 组件、台账无对应条目（001–007 未覆盖 §5.4）→ 本包 **P1 首项**，按 §5.4 原规格（可选弹窗 + flag 门控 `paramConfirm`，默认关闭零行为变化）。
- **Phase 2（P2.1–P2.4）与 Phase 3（P3.1–P3.4）需逐项差距重审**：各节规格写于 2026-08-14，此后 BLOCK-66/69/72/73/78/81/82 等包已落地大量相邻能力（知识空间、工作台全局入口、思考档位、摘要卡运行时投影等）。**每项启动前必须先对照当前代码核实「是否已被覆盖 / 缺口收窄后还剩什么 / 是否已无意义」**，裁剪后按剩余缺口串行推进，防重复开发；重审结论登记进本 plan 对应节，不另立进度文档。

### 阶段划分（v1.3 重排）

> **修订 2（2026-09-12，用户裁决）**：原话「参数确认卡这个任务取消 不需要确认 agent主导」——P1.4 整项取消，**Phase 1 以 UI-AGENTWB-001～007 七项 verified 即为闭环**。产品方向登记：agent 主导、不做参数级确认打断。**边界**：本裁决只取消 §5.4 的「可选参数确认卡片」；既有**写操作/删除/覆盖的安全确认**（v1.0 现有路径，属安全底线非本计划范围）不变，如需放宽须另行用户裁决。§5.4 原规格保留作历史设计参考，不再实现。

| 阶段 | 内容 | 出口 |
| --- | --- | --- |
| P0-LAUNCH | 立项登记 + 本节现状对账 | 本节落盘 + DOC-REGISTRY active + 台账登记（已完成） |
| ~~P1~~ | ~~P1.4 参数确认卡片~~ **已取消**（修订 2，Phase 1 即日闭环） | 无 |
| P2 | Phase 2 剩余缺口逐项（P2.1→P2.4 串行，逐项先对账再实现；与 BLOCK-83 的 RS 通用化/产物工作台交汇处启动时划界） | 每项独立 UI-### 登记 + 实机证据 |
| P3 | Phase 3 评估（远期，逐项另行用户裁决后启动） | 不自动启动 |

### 修订 3（2026-09-12）：Phase 2/3 逐项对账结论与归宿（对照当前代码全量核实）

| 项 | 覆盖判定（事实） | 归宿处置 |
| --- | --- | --- |
| P2.1 Artifact 预览增强 | **部分覆盖**：通用预览底座已成（`resultSurface.ts` 6 类适配器 + `ScientificInteractionViewer` scatter/matrix/表格交互 + 选择持久化 + RS 四模式） | 缺的 previewRegistry 注册机制与 BLOCK-83 渲染器扩展点（D6）是同一件事 → **并入 BLOCK-83**，本项关闭 |
| P2.2 项目级 Timeline | **部分覆盖**：作业墙（CommandCenter/BLOCK-64）+ 运行俯瞰（SummaryCard/BLOCK-78）覆盖大部；垂直时间轴未做；`result_workflow_graphs` 后端权威谱系已有但无可视化消费 | 残余=谱系可视化，属产物工作台 → **并入 BLOCK-83**；加表设想废弃（以既有谱系投影为准），本项关闭 |
| P2.3 Skills 深度集成 | **部分覆盖**：/skills 全局页 + skill_discover/get/execute 全链已通 | 残余：对话内 /skills 触发器、安装/卸载/启停管理、agent 推荐 skill、边写边测 → **本计划唯一实做残余**；管理面依赖 BLOCK-83 P4 插件系统定型，排在 P4 之后 |
| P2.4 分析链路推荐 | **未实现且应改属**：仅 learning.js 学习资源推荐；领域级链路推荐属领域知识 | **裁剪出核心，移入 BLOCK-83 生信包**（作为包内能力）；核心通用机制（workflow plan + learning signal）已有，本项关闭 |
| P3.1 多 Agent 协作 | **已覆盖且超预期**（BLOCK-49/65：spawn 链、SubAgentsBar、专属窗体系） | 标记完成；残余（树形聚合展示/错误边界/agent 模板互调）降级为候选小项不阻塞，本项关闭 |
| P3.2 复杂工作流编排 | **部分覆盖且 harness 侧超计划**（19 端点 + loop 引擎 + 中断恢复；RS workflow DAG 为执行后权威谱系） | DAG 可视化与 P2.2 残余合流 → **并入 BLOCK-83**；Workflow DSL/独立 Director **deferred**（loop 引擎已是事实编排层，是否还需要待平台化后评估），本项关闭 |
| P3.3 高级生信可视化 | **核心未实现且应改属**：无任何生信特化渲染器；交互投影扩展点（`artifact-interaction.js`）已就绪且形态更优 | **移入 BLOCK-83 生信包**；其前置（renderer 注册扩展点）即 BLOCK-83 渲染器扩展点，本项关闭 |
| P3.4 团队协作 | **未实现**（确认） | 维持远期 deferred，本项关闭 |

**对账总结论**：Phase 2/3 八项中——已覆盖关闭 3 项（P3.1、P3.4 维持远期、P2.1/P2.2/P3.2 残余并入 BLOCK-83）、改属生信包 2 项（P2.4、P3.3）、实做残余仅 1 项（P2.3 Skills）。**本计划的增量使命实质完成**，待用户确认路线后本包可对账收口；P2.3 残余转独立小包排在 BLOCK-83 P4 之后。

### 红线与非范围



- §0.1 十条增量强制约束全量有效（非破坏性、feature flag 默认关、向后兼容、§0.2 口径纪律）。
- Phase 3 各项**不在本轮自动启动**，逐项需用户裁决。
- G1+ 阶段事项不外推（packaged/Provider/GA 不在本包校验范围）。
- 与队列其他 planned 包（G0-RS / G0-SDC / BLOCK-70-MOBILE-SYNC）文件面零触碰。

### 环境纪律

当前实机为 **Windows**（v1.1 写于 macOS）：fnm Node 24 + `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev` 起 dev 栈；`core/**`、`src/main.js` 改动后必须重启 dev 栈再实机验证；实机证据按 G0 纪律为 **dev Electron 边界内**。

---

## 0. 核心约束：增量增强，非破坏性重构

> 草案由 2026-08-14 用户反馈明确：
> *"是在我们现有的 UI 基础上进行增添优化，不是重构破坏原有的结构！"*

本计划的一切子任务、UI 变更、IPC/MCP 扩展、文件改动都必须严格遵守以下原则。任何与本节冲突的描述、Phase 任务、验收标准、附录设计，都以本节为准。

### 0.1 强制约束清单

1. **保留所有现有 UI 组件与页面结构**——不删除、不替换、不重组 `ProjectWorkspace`、`LeftPanel`、`RightPanel`、`ResultStudioSurface`、`SimpleChat`、`BackendStatusProvider`、`CommandPalette` 等。
2. **在现有组件之上扩展**——新能力通过新增可选组件、可选渲染器、可选 hook 注入，不修改现有组件的核心签名与 props 必填项。
3. **不强制切换到新界面**——新功能默认通过 feature flag 关闭，开启前不会出现在任何用户可见路径上；用户未启用即维持当前体验。
4. **不破坏任何已有功能**——所有现有 API、路由、IPC handler、MCP 工具、SQLite schema、SQLite 写入路径、IPC 事件、Electron 窗口行为、性能特征必须保持不变。
5. **每个 Phase 子任务向后兼容**——任意子任务独立关闭后，Desktop 必须恢复到 v1.0 的等价行为；CI 需通过旧的最小冒烟集。
6. **禁用项可独立关闭**——`AGENT_WORKBENCH_FLAGS`（详见 §X.1）逐项控制，关闭时连同 UI 元素、可选 hook、调度入口一起隐藏。
7. **依赖现有实现而非替代**——Result Card 渲染器、Execution Progress 视图、Param Confirm 弹窗、Skills Sidebar 等都以"plug-in 模式"挂到现有组件；替代性 API 改造必须经架构评审。
8. **数据契约兼容**——Conversation、Job、Artifact、Message 等 schema 只能以可空字段扩展，禁止改名、拆表、强制 NOT NULL。
9. **测试矩阵双向验证**——每次新增能力均必须同时通过"功能启用"与"功能禁用"两组验证（详见 §X.2）。
10. **失败可回退**——任何变更必须可回滚至上一稳定版本；Feature Flag 关闭即视为回退路径。

### 0.2 命名与口径纪律

- ❌ **禁用措辞**：重构、替换、迁移、推倒、重写、改写、弃用、breaking change、迁移兼容
- ✅ **推荐措辞**：扩展、增添、注入、可选、挂载、增量、向后兼容、append-only、opt-in
- 文档、commit、PR 描述、UI 文案、变量命名、文件名一律遵循以上口径。

### 0.3 触发本约束的现状证据

- `ProjectWorkspace` 三栏布局、`SimpleChat` 消息流、`ResultStudioSurface` 多 artifact 渲染、`useSkillStore` 与 `SkillsSidebar` 均已落地。
- 现有 Copilot 已经有 `toolActivity.ts`、`conversationRunStore.ts`、`useErrorFormatter.ts`、`CommandPalette.tsx` 等可挂载点。
- 现有 IPC 通道、MCP 工具、SQLite 表已稳定；新功能必须追加而非替换。
- 用户明确：保留体验、渐进增大、随时可关。

### 0.4 本约束与 §1-§11 各章节的关系

- 后续所有 Phase 1～Phase 3 任务在描述"修改哪些文件"时，必须额外标注：**保留什么 / 扩展什么 / 新增什么** 三栏。
- 任何章节引入"删除原组件"、"重命名 tab"、"拆 tab 重组"等破坏性描述，必须立刻改写为扩展型描述。
- §X 新增章节（Feature Flag 设计、兼容性测试矩阵）作为约束的工程化落地。

---
## 目录

1. [概述与愿景](#1-概述与愿景)
2. [当前能力评估](#2-当前能力评估)
3. [差距分析（基于 Codex 标准）](#3-差距分析基于-codex-标准)
4. [架构设计](#4-架构设计)
5. [Phase 1：快速见效增强（2-3 人周）](#5-phase-1快速见效增强2-3-人周)
6. [Phase 2：核心功能（8-12 人周）](#6-phase-2核心功能8-12-人周)
7. [Phase 3：高级能力（12-16 人周）](#7-phase-3高级能力12-16-人周)
8. [技术方案](#8-技术方案)
9. [风险评估](#9-风险评估)
10. [里程碑与验收标准](#10-里程碑与验收标准)
11. [后续归档建议](#11-后续归档建议)
12. [X.1 Feature Flag 设计](#x1-feature-flag-设计)
13. [X.2 兼容性测试矩阵](#x2-兼容性测试矩阵)

---

## 1. 概述与愿景

### 1.1 背景

BioF3 Desktop 已经具备稳定的 AI 协作骨架：`ProjectWorkspace` 三栏、`SimpleChat` 流、`ResultStudioSurface` artifact 查看、`SkillsSidebar`、`BackendStatusProvider`、`useSkillStore` 等都已落地。本计划基于这些事实，**在现有 UI 之上渐进式增添** Codex 式体验，而不是替换或重构已有结构。

**核心定位**（来自 `docs/codex-style-workbench-direction.md`）：

> BioF3 工作台是面向生信分析家的 **AI 协作开发环境**
> - AI 是主角（不是辅助工具）
> - 结果卡片是核心交付物
> - 右侧查看器与聊天强联动
> - 项目级对话隔离

> 本文档(v1.1)对定位、目标、用户体验均保持原方向不变；只把"实施方式"从"新建工作台"落地为"增量增强现有工作台"，并通过 §0 核心约束保证不会破坏现有 UX。

### 1.2 产品愿景（增量增强目标形态）

**保留**：现有 `ProjectWorkspace` 的左中右三栏、`LeftPanel` 的项目列表、`RightPanel` 的多 Tab（含 `ResultStudioInspector`、`RightFileTree`、`TerminalPanel`、`BrowserPanel`）、中间 `SimpleChat` + `ResultStudioSurface` 双区域布局——一切既有的骨架、样式、键位、可调整列宽能力一律保留。

**扩展**：在现有组件的可挂载点上注入新能力，不重构任何现有组件。

```
┌──────────────────────────────────────────────────────────────────┐
│  左侧：项目资源 (LeftPanel)   │  中间：Agent 主工作区 (Center)     │  右侧：结果查看 (RightPanel) │
├───────────────────────────────┼────────────────────────────────────┼────────────────────────────┤
│ • 我的项目列表 (保留)         │ • SimpleChat (保留)                │ • 结果 Tab (保留)         │
│ • 当前项目数据 (保留)         │   + ResultCardMessage 注入 (新增)   │ • 文件树 Tab (保留)       │
│ • 分析历史 (保留)             │   + ExecutionProgress 注入 (新增)   │ • Terminal Tab (保留)     │
│ • 切换项目 (保留)             │   + ParamConfirm 注入 (新增)        │ • Browser Tab (保留)      │
│   + Skills Tab (新增,左栏新增) │ • ResultStudioSurface (保留)       │ + 已有 Tab 顺序保持不变    │
└───────────────────────────────┴────────────────────────────────────┴────────────────────────────┘
```

> 三栏骨架、列宽调节、Tab 顺序、键盘焦点链、桌面布局行为都与 v1.0 等价；新增能力以"挂载/注入"形式出现，每个挂载点独立可关闭。

**用户体验目标**：

> 用户不再面对一堆分散工具入口，而是在一个项目里，和 AI 生信分析搭档一起推进数据分析、查看结果、解释图表、沉淀可复现记录。本目标的达成方式锁定为"在现有界面上**渐进式增添**"，不替换、不重组、不破坏。

### 1.3 核心原则

BioF3 **不能**变成"AI 随意写脚本、随意生成结果"的产品。必须坚持：

1. **所有正式分析必须落到已注册插件、标准 workflow 或受控执行器**
2. **每次分析必须记录 projectId、toolId、插件版本、参数、输入、输出、日志、状态**
3. **聊天区可以解释和编排，但不能替代可复现计算链路**
4. **Agent 不能绕过参数确认直接执行重操作**
5. **结果必须可以回看、下载、复现、追踪来源**

**推荐原则**：

> AI 负责理解意图、选择工具、填参数、串流程、解释结果；BioF3 插件系统负责真实计算和产物生成。

### 1.4 与 IDE 改造计划的区别

本计划**不是**将 BioF3 改造成传统 IDE（如 `docs/archive/ide-transformation-retired/ide-transformation-plan.md` 所述的 Monaco Editor 集成、文件树导航等；该计划于 2026-08-16 superseded 并归档），也**不是**通过新建"Codex 工作台"页面替换现有 `ProjectWorkspace`，而是专注于在现有 UI 之上**扩展**：

| 维度 | IDE 改造方向（归档） | Agent 工作台增强（本计划） |
|------|---------------------|---------------------------|
| 核心交互 | 代码编辑为主 | Agent 对话为主 |
| 结果交付 | 文件系统 | 可交互结果卡片 |
| 上下文 | 文件/代码 | 项目/数据集/分析历史 |
| 目标用户 | 开发者 | 生信分析家 |
| 可视化 | 通用代码高亮 | 生信图表、表格、日志 |

> **说明**：`docs/ide-transformation-plan.md` 和 `docs/ide-research/` 目录已 superseded 归档到 `docs/archive/ide-transformation-retired/`（2026-08-16），它们代表了一个已放弃的方向。

---

## 2. 当前能力评估

### 2.1 项目工作台 (`project-workspace.tsx`)

**已实现能力**：

| 能力 | 状态 | 文件位置 |
|------|------|----------|
| 三栏布局框架 | ✅ 已实现 | `frontend/src/pages/project-workspace.tsx` |
| 左侧项目树 | ✅ 已实现 | `frontend/src/components/workspace-panels/LeftPanel.tsx` |
| 右侧多 Tab 面板 | ✅ 已实现 | `frontend/src/components/workspace-panels/RightPanel.tsx` |
| 中间结果查看器 | ✅ 已实现 | `frontend/src/components/result-studio/ResultStudioSurface.tsx` |
| 简单聊天组件 | ✅ 已实现 | `frontend/src/components/copilot/SimpleChat.tsx` |
| 项目级对话隔离 | ✅ 已实现 | `useConversations` hook + `conversationConversationsClient` |
| 结果 Artifact 导航 | ✅ 已实现 | `ResultStudioSurface.tsx` |
| 工作空间布局可调整 | ✅ 已实现 | `useResizableColumns` hook |
| 模型选择菜单 | ✅ 已实现 | `SimpleChat.tsx` 中的 model menu |
| 对话草稿持久化 | ✅ 已实现 | `conversationDraft.ts` |

**关键数据流**：

```
ProjectWorkspace (主组件)
├── LeftPanel (项目/对话列表)
├── CenterPanel (聊天/结果视图)
│   ├── SimpleChat (对话输入/输出)
│   └── ResultStudio (结果查看)
└── RightPanel (多工具 Tab)
    ├── ResultStudioInspector (结果查看)
    ├── RightFileTree (文件树)
    ├── TerminalPanel (后端状态)
    └── BrowserPanel (嵌入式浏览器)
```

### 2.2 Copilot 系统

**已实现能力**：

| 能力 | 状态 | 文件位置 |
|------|------|----------|
| 对话消息存储 | ✅ 已实现 | `copilotConversationsClient.ts` |
| 对话运行状态管理 | ✅ 已实现 | `conversationRunStore.ts` |
| 工具活动展示 | ✅ 已实现 | `toolActivity.ts` |
| Markdown 渲染 | ✅ 已实现 | `copilotMarkdown.tsx` |
| 文件引用提取 | ✅ 已实现 | `chat-file-references.ts` |
| 命令面板 | ✅ 已实现 | `CommandPalette.tsx` |
| 错误格式化 | ✅ 已实现 | `useErrorFormatter.ts` |

### 2.3 Result Studio 系统

**已实现能力**：

| 能力 | 状态 | 文件位置 |
|------|------|----------|
| 结果画布 | ✅ 已实现 | `ResultStudioSurface.tsx` |
| Artifact 上下文就绪检查 | ✅ 已实现 | `resultSurface.ts` (P3) |
| Schema 驱动编辑控件 | ✅ 已实现 | `ResultEditPanel.tsx` (P4) |
| 版本历史查看 | ✅ 已实现 | `RevisionCodeView.tsx` |
| 科学交互查看器 | ✅ 已实现 | `ScientificInteractionViewer.tsx` |
| 紧凑结果导航 | ✅ 已实现 | `CompactResultNavigator.tsx` |
| 结果变更集面板 | ✅ 已实现 | `ResultStudioChangeSetPanel.tsx` |

### 2.4 后端集成

**已实现能力**：

| 能力 | 状态 | 文件位置 |
|------|------|----------|
| Electron IPC 桥接 | ✅ 已实现 | `lib/desktopBridge.ts` |
| MCP Server 工具注册 | ✅ 已实现 | `src/mcp-server.js` |
| Harness 工作流引擎 | ✅ 已实现 | `lib/harness-client.ts` |
| 后端健康检查 | ✅ 已实现 | `BackendStatusProvider.tsx` |
| 项目/数据集存储 | ✅ 已实现 | `lib/project-store.ts` |

---

## 3. 差距分析（基于 Codex 标准）

### 3.1 高优先级差距（影响核心体验）

#### G1：聊天结果卡片缺失

**现状**：工具运行完成后，聊天区只显示普通文本消息，用户需要手动切换到右侧查看结果。

**Codex 标准**：工具运行完成后，聊天区必须出现可操作的结果卡片，包含：
- 工具/分析名称
- 运行状态
- 关键产物数量或简要结果
- "查看结果"按钮
- "查看文件"按钮
- "下载"按钮
- "继续下一步"按钮

**影响**：用户体验碎片化，无法形成"对话→执行→结果→追问"的流畅闭环。

#### G2：右侧查看器与聊天联动不足

**现状**：右侧面板可以显示结果，但与聊天区的交互较弱。用户需要手动切换 Tab 查看结果。

**Codex 标准**：
- 点击聊天里的"查看结果"，右侧自动切到 results tab 并打开对应 job
- 点击聊天里的"查看文件"，右侧切到 files tab 并定位对应 artifact
- 右侧当前结果要反向注入 Agent 上下文
- 用户问"解释这个图"时，Agent 知道当前正在看的结果

**影响**：上下文割裂，Agent 无法感知用户当前正在查看的结果。

#### G3：Agent 执行过程可见性不足

**现状**：Agent 执行时只显示最终结果，过程不透明。

**Codex 标准**：Agent 执行过程要可见、可追踪，至少展示：
- 已理解目标
- 拟调用的插件/workflow
- 等待确认
- 已提交 job
- running / done / failed
- 失败原因
- 可恢复动作

**影响**：用户对 Agent 行为缺乏信任，难以理解分析过程。

### 3.2 中优先级差距（影响专业能力）

#### G4：参数确认卡片不完善

**现状**：涉及写操作、运行分析时，Agent 可能直接执行而未展示参数确认。

**Codex 标准**：
- 显示工具名和目的
- 显示参数表单
- 支持用户微调参数
- 显示输入数据和输出位置
- 显示风险或耗时提示
- 支持确认、取消

**影响**：安全性不足，可能导致用户误操作。

#### G5：Artifact 预览能力有限

**现状**：支持图片、CSV、日志预览，但复杂生信格式（如 .h5ad、.rds）支持不足。

**Codex 标准**：需要专业查看器支持：
- 单细胞数据 (.h5ad, .loom, .mtx)
- R 数据格式 (.rds, .RData)
- 高维矩阵可视化
- 降维图（PCA, UMAP, t-SNE）
- 热图、火山图、韦恩图

**影响**：专业用户无法在应用内直接查看生信分析结果。

#### G6：项目级 Timeline 缺失

**现状**：分析历史分散在对话列表和结果列表中，缺乏统一的时序视图。

**Codex 标准**：形成项目级 timeline：
> 计划 → 参数确认 → job 提交 → 运行日志 → artifact 生成 → 结果解释 → 下一步建议

**影响**：用户难以追溯完整的分析链路。

### 3.3 低优先级差距（影响高级体验）

#### G7：多 Agent 协作能力缺失

**现状**：当前是单一 Agent 对话模型。

**Codex 标准**：
- 支持子 Agent 委派（如 `luna_worker`）
- Agent 间通信与结果聚合
- 多任务并行执行与状态同步

**影响**：复杂分析场景下效率受限。

#### G8：Skills 系统与工作台集成不深

**现状**：Skills 系统已定义（`resources/skills/`），但与工作台交互有限。

**Codex 标准**：
- Skills 可在对话中被 Agent 调用
- Skills 结果自动生成 Artifact
- Skills  marketplace 在工作台内可浏览

**影响**：Skills 能力未充分发挥。

#### G9：分析链路推荐缺失

**现状**：Agent 可以建议下一步，但缺乏结构化的"下一步推荐"机制。

**Codex 标准**：
- 基于当前分析类型推荐标准流程
- 可视化分析链路图
- 一键续接分析

**影响**：用户需要自己规划分析路径。

---

## 4. 架构设计

> **再次强调**：本计划是"在现有架构上扩展"，不是"重建架构"。§4.1 描述的是新能力挂载到现有系统骨架的可视化示意，**不是要把现状替换成新架构**。所有现有组件、IPC、SQLite 表、MCP 工具在不开启对应 feature flag 时行为完全不变。

### 4.1 增强后的系统架构（增量扩展视图）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      BioF3 Desktop Shell (现有 — 全部保留)                  │
│  ┌───────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│  │    Left Panel     │  │   Center Panel       │  │   Right Panel   │ │
│  │   (保留)          │  │   (保留)             │  │   (保留)        │ │
│  │                   │  │                      │  │                  │ │
│  │ • 项目列表        │  │ • SimpleChat         │  │ • ResultStudio  │ │
│  │   (保留)          │  │   (主对话界面)       │  │   (结果查看)    │ │
│  │ • 当前项目数据    │  │   (保留)             │  │   (保留)        │ │
│  │   (保留)          │  │                      │  │                  │ │
│  │ • 分析历史        │  │ │┌─────────────────┐│ │ • FileTree      │ │
│  │   (保留)          │  │ ││ ResultCard Msg  ││ │   (保留)        │ │
│  │ • 切换项目        │  │ ││ (新增 — 挂载)   ││ │ • Artifact View │ │
│  │   (保留)          │  │ │└─────────────────┘│ │   (保留)        │ │
│  │ │┌───────────────┐│ │                      │  │ • Terminal      │ │
│  │ ││ Skills Tab    ││ │ │┌─────────────────┐│ │ • Browser       │ │
│  │ ││ (新增 — 挂载) ││ │ ││ExecutionProgress││ │   (保留)        │ │
│  │ │└───────────────┘│ │ ││ (新增 — 挂载)   ││ │ │┌──────────────┐││ │
│  │                   │  │ │└─────────────────┘│ │ ││ ParamConfirm │││ │
│  └───────────────────┘  └─────────────────────┘  └─────────────────┘ │
│                                    │                                    │
│                         ┌──────────┴──────────┐                         │
│                         │ Agent Context Hub   │                         │
│                         │ (新增 — 可选)        │                         │
│                         │ • Current Project  │                         │
│                         │ • Active Artifact  │                         │
│                         │ • Selection State  │                         │
│                         │ • Conversation ID  │                         │
│                         └──────────┬──────────┘                         │
└────────────────────────────────────│────────────────────────────────────┘
                                     │
┌────────────────────────────────────│────────────────────────────────────┐
│                     Backend Services (现有 — 全部保留)                    │
│  ┌───────────────────┐  ┌─────────┴────────┐  ┌─────────────────────┐   │
│  │  MCP Server       │  │  Harness Engine   │  │  Project Store      │   │
│  │  (现有 — 扩展)    │  │  (现有 — 保留)    │  │  (SQLite — 保留)    │   │
│  └───────────────────┘  └──────────────────┘  └─────────────────────┘   │
│  │┌─────────────────┐│  ┌──────────────────┐  ┌─────────────────────┐   │
│  ││ Result Card Hook││  │  Artifact Store   │  │  Conversation Store │   │
│  ││ (新增 — 钩子)   ││  │  (现有 — 保留)    │  │  (现有 — 保留)      │   │
│  │└─────────────────┘│  └──────────────────┘  └─────────────────────┘   │
│  ┌───────────────────┐                                                  │
│  │  Skills Registry  │  (新增 — 与现有 SkillsSidebar 配套)              │
│  │  (新增 — 可选)    │                                                  │
│  └───────────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

> 边框内的"现有 — 保留"组件**严禁任何形态修改**；带 `┌┐` 标记的为新增挂载/钩子，与现有组件通过 feature flag + 可选 hook 联动。

### 4.1.1 保留 / 扩展 / 新增 对照表（强制遵守）

| 现有组件 | 保留 | 扩展 | 新增 |
|----------|------|------|------|
| `ProjectWorkspace` 三栏布局 | 全部 | 接收可选上下文 provider | —— |
| `LeftPanel` 项目 Tab | 全部 | —— | Skills Tab（挂载，最右新增位） |
| `LeftPanel` 项目列表项 | 全部 | 接收可选 `onSkillAction` 回调 | —— |
| `SimpleChat` 消息渲染 | 全部 | 接收 `extraRenderers` 注入点位 | `ResultCardMessage`、`ExecutionProgressMessage`、`ParamConfirmMessage` 可选渲染器 |
| `ResultStudioSurface` | 全部（渲染、Tab、上下文就绪检查） | 接收 `onArtifactFocus` 回调 | —— |
| `RightPanel` FileTree / Terminal / Browser | 全部 | —— | —— |
| `useSkillStore` | 全部 | 接收可选 `enableCommandPalette` 参数 | —— |
| `CommandPalette` | 全部 | 注册可选 Skill 入口 | —— |
| MCP Server（`src/mcp-server.js`） | 全部现有 tools | 新增 `fetch_context_envelope` 等**新增** tool（不改签名） | —— |
| SQLite schema | 全部 | 允许新增可空列；禁止改名/拆表 | —— |
| IPC handler | 全部现有 channel | 新增 channel（不替换） | —— |
| Electron 主进程窗口 | 全部行为 | —— | —— |

> 上表"扩展"列指：**在不破坏现有组件核心签名与行为的前提下**，新增可选 prop、回调、provider。新增项必须能被 prop 设为 `undefined` 时完全退化为 v1.0 行为。
```

### 4.2 核心组件设计（增量扩展，所有定义都标注"基于现有 X"）

> 本节定义的是"挂载到现有组件上的可选能力"的数据结构，不引入脱离现有体系的子系统。

#### 4.2.1 Result Card System（结果卡片系统 —— 现有 `SimpleChat` 的可选渲染器）

**目的**：在聊天中交付可操作的结果卡片，**作为 `SimpleChat` 已有消息流的可选渲染器**。

**注入路径**：`SimpleChat` 的消息路由 → 若 `flags.agentWorkbench.resultCard` 开启且 `message.meta.kind === 'result_card'` → 渲染 `ResultCardMessage`；否则按现有 markdown 路径渲染。

**数据结构**：

```typescript
interface ResultCard {
  id: string;
  type: 'tool' | 'analysis' | 'file' | 'step';
  title: string;
  status: 'running' | 'success' | 'failed' | 'pending';
  
  // 内容摘要
  summary?: {
    artifactCount?: number;
    keyMetrics?: Array<{ label: string; value: string }>;
    message?: string;
  };
  
  // 操作
  actions: Array<{
    id: string;
    label: string;
    action: 'view_result' | 'view_file' | 'download' | 'continue' | 'cancel';
    payload?: Record<string, unknown>;
  }>;
  
  // 关联
  jobId?: string;
  artifactIds?: string[];
  projectId: string;
  
  // 元数据
  createdAt: string;
  toolId?: string;
}
```

**渲染位置**：`SimpleChat.tsx` 中的消息渲染器（**挂载点，不替换**）

**保留**：`SimpleChat` 现有消息渲染、Markdown 路径、tool activity 渲染。
**扩展**：`SimpleChat` 接收可选 `extraRenderers?: Record<string, React.ComponentType>` prop；未传时行为完全等价于 v1.0。
**新增**：`ResultCardMessage` 组件（仅在 `extraRenderers` 含 `result_card` 时生效）。

#### 4.2.2 Agent Context Hub（Agent 上下文中心 —— 现有 `ProjectWorkspace` 的可选 Provider）

**目的**：管理跨组件的共享上下文状态

**状态结构**：

```typescript
interface AgentContextHub {
  // 当前项目
  currentProject: Project | null;
  
  // 当前对话
  currentConversation: ConversationSummary | null;
  
  // 当前 Artifact（右侧查看器中选中的）
  activeArtifact: ActiveArtifact | null;
  
  // 选中状态（用于科学交互）
  activeSelection: ArtifactSelection | null;
  
  // 执行状态
  executionQueue: ExecutionItem[];
  
  // 上下文 token（用于 Agent API）
  contextToken: string | null;
}
```

**更新机制**：
- 右侧选择 Artifact → 更新 `activeArtifact`
- 聊天点击"查看结果" → 右侧切换 Tab + 设置 `activeArtifact`
- Agent 需要上下文时 → 读取 `contextToken`

**保留**：`ProjectWorkspace` 现有 state 与 props；`useState`+`useEffect` 模式继续使用。
**扩展**：可选 `AgentContextProvider` 通过 `ProjectWorkspace` 的可选 `contextProvider?: React.ComponentType` slot 注入；未注入时子组件读不到 context 不报错。
**新增**：仅 `useAgentContext` hook 与 `AgentContextProvider`（仅在 `flags.agentWorkbench.contextHub` 开启时挂载）。

#### 4.2.3 Execution Progress Tracker（执行进度追踪器 —— 现有 `conversationRunStore` 的可选视图）

**目的**：可视化 Agent 执行过程

**状态结构**：

```typescript
interface ExecutionStep {
  id: string;
  type: 'understanding' | 'planning' | 'confirming' | 'submitting' | 'running' | 'done' | 'failed';
  label: string;
  detail?: string;
  timestamp: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

interface ExecutionProgress {
  conversationId: string;
  steps: ExecutionStep[];
  currentStepId: string | null;
  jobId?: string;
  toolId?: string;
}
```

**UI 位置**：CenterPanel 中，聊天输入框上方（**作为可选注入条，不替换现有输入框**）

**保留**：`conversationRunStore` 当前数据模型、事件名、状态机。
**扩展**：在 `SimpleChat` 顶部新增可选 `<ExecutionProgress />` 容器，仅在 `flags.agentWorkbench.executionProgress` 开启且 `conversationRunStore` 报告 active run 时渲染；关闭时该容器渲染 `null`。
**新增**：`ExecutionProgress.tsx` 组件（自包含 view），只读订阅 `conversationRunStore`，不修改其 API。

### 4.3 数据流设计

#### 4.3.1 聊天 → 结果查看 流程

```
1. 用户在聊天中发送 "运行 DEG 分析"
2. Agent 解析意图，调用工具
3. 工具执行完成后：
   a. 后端写入 Job + Artifact
   b. 返回结果给 Agent
   c. Agent 生成 Result Card 消息
   d. 消息写入 Conversation
4. 用户点击卡片 "查看结果"
5. 前端：
   a. 设置 activeArtifact = 对应 artifact
   b. 右侧切换到 results tab
   c. 加载 ResultStudio
6. Agent 上下文更新（通过 contextToken）
7. 用户可继续问 "解释这个结果"
```

#### 4.3.2 右侧查看 → Agent 上下文 流程

```
1. 用户在右侧手动选择某个结果
2. 前端更新 activeArtifact
3. 调用后端 context-envelope 接口
4. 获取新的 contextToken
5. 后续 Agent 对话携带新 contextToken
6. Agent 知道用户当前在看什么
```

---

## 5. Phase 1：快速见效增强（2-3 人周）

### 5.0.5 ID 命名互引（2026-08-16 GATES-4 batch 2）

本计划 §5 P1.1 / P1.2 / P1.3 验收标准在文档早期使用 A1 / A2 / A3 / A4 内部编号；2026-08-15 实机验证后已统一为 `UI-AGENTWB-###` 编号体系。三份实机收口报告为本计划 P1.* 验收的最新证据：

| 内部 ID | UI 编号 | 收口报告 |
| --- | --- | --- |
| A4 | `UI-AGENTWB-007` | [`agent-workbench-p1-a5-verification-2026-08-15.md`](./agent-workbench-p1-a5-verification-2026-08-15.md) |
| A5 | `UI-AGENTWB-003` / `UI-AGENTWB-004` | [`agent-workbench-p1-a5-verification-2026-08-15.md`](./agent-workbench-p1-a5-verification-2026-08-15.md) |
| P1.3 | `UI-AGENTWB-005` / `UI-AGENTWB-006` / `UI-AGENTWB-007` | [`agent-workbench-dev-electron-verification-2026-08-15.md`](./agent-workbench-dev-electron-verification-2026-08-15.md) |
| T-AW-013 | `UI-AGENTWB-007` 三轴升级 | [`t-aw-013-packaged-verification-2026-08-15.md`](./t-aw-013-packaged-verification-2026-08-15.md) |

`qualificationEligible: false` 是 G0 开发期常态事实，本表 `verified` 仅在各自边界内成立；不外推 packaged / Provider / P7 / GA。



**目标**：在现有 `SimpleChat` / `ResultStudioSurface` / `ProjectWorkspace` 之上**挂载** 4 个可选能力，默认全部关闭，由 `AGENT_WORKBENCH_FLAGS` 单独控制。

### 5.0 Phase 1 依赖的现有组件（必须先理解）

| 现有组件 | 路径 | Phase 1 用途 |
|----------|------|--------------|
| `SimpleChat` | `frontend/src/components/copilot/SimpleChat.tsx` | 注入 Result Card、Execution Progress、Param Confirm 三类可选渲染器 |
| `ResultStudioSurface` | `frontend/src/components/result-studio/ResultStudioSurface.tsx` | 通过 `onArtifactFocus` 回调把焦点同步给 Agent Context Hub |
| `ProjectWorkspace` | `frontend/src/pages/project-workspace.tsx` | 提供可选 `contextProvider` slot，挂载 Agent Context Hub |
| `conversationRunStore` | `frontend/src/components/copilot/conversationRunStore.ts` | Execution Progress 只读订阅的数据源 |
| `toolActivity` | `frontend/src/components/copilot/toolActivity.ts` | 提供 Result Card 触发所需的工具活动信息 |
| `useErrorFormatter` | `frontend/src/components/copilot/useErrorFormatter.ts` | Execution Progress 失败原因格式化复用 |
| `ResultStudioInspector` | `frontend/src/components/workspace-panels/RightPanel.tsx` | 卡片点击"查看结果"的目标 Tab |
| `RightFileTree` | `frontend/src/components/workspace-panels/RightPanel.tsx` | 卡片点击"查看文件"的目标 Tab |

### 5.1 P1.1：聊天结果卡片 MVP（可选渲染器）

**工期**：3-5 天

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | `SimpleChat` 现有消息渲染、Markdown 路径、tool activity 渲染；`copilotConversationsClient` 现有消息结构 |
| **扩展** | `SimpleChat` 接收**可选** `extraRenderers?: Record<string, React.ComponentType>` prop；`MessageMeta` 类型**新增**可空字段 `resultCard?: ResultCardPayload`（不改既有字段语义） |
| **新增** | `frontend/src/components/copilot/ResultCardMessage.tsx`（自包含组件） |

**内容**：

1. **定义 Result Card 数据结构（追加，不替换）**
   - 在 `copilotConversationsClient.ts` 中**追加** `ResultCardPayload` 类型与可选字段；不修改任何现有字段
   - `MessageMeta` 仅新增可空字段 `resultCard?: ResultCardPayload`；server 端在 Job 完成回调**追加**一条**新**消息（`kind: 'result_card'`），不替换 user 既有消息

2. **实现卡片渲染组件（可选挂载）**
   - 新建 `ResultCardMessage.tsx` 组件
   - 支持状态徽章、操作按钮
   - 响应点击事件（通过 `onResultCardAction` 回调，**不直接**调 `setRightPanelTab`）

3. **SimpleChat 注入（向后兼容）**
   - `SimpleChat` 接收 `extraRenderers`，**只在 `flags.agentWorkbench.resultCard === true` 且 `message.meta.kind === 'result_card'` 时**路由至 `ResultCardMessage`
   - flag 关闭 / `extraRenderers` 未传 / `message.meta.kind` 不匹配 → 现有 markdown 路径，**完全等价 v1.0**

4. **依赖的现有组件**：`SimpleChat`（必需）、`copilotConversationsClient`（必需）、`useSkillStore`（无关）

**兼容性影响**：
- ✅ `SimpleChat` 不传 `extraRenderers` → 0 行为变更
- ✅ `MessageMeta` 增可空字段 → JSON 解析兼容
- ✅ SQLite `messages` 表 schema 不变

**验收标准**：
- [ ] 工具运行完成后聊天区出现结果卡片（仅在 flag 开启时）
- [ ] 卡片显示工具名、状态、简要结果
- [ ] 点击"查看结果"按钮通过 `onResultCardAction` 回调通知上层
- [ ] flag 关闭时，聊天消息渲染行为与 v1.0 **逐字节等价**（快照测试）
- [ ] `extraRenderers` 未传时，行为与 v1.0 **逐字节等价**

### 5.2 P1.2：卡片与右侧联动（基于现有 RightPanel，不替换 Tab 顺序）

**工期**：2-3 天

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | `RightPanel` 现有 Tab 顺序、布局、可折叠行为；`ResultStudioInspector` / `RightFileTree` 完全不动 |
| **扩展** | `ProjectWorkspace` 通过**新增** `lastClickedAction` 状态（独立 state，不污染现有 `activeArtifact`），实现"卡片点击 → 通知 → RightPanel 通过 `useEffect` 监听变更"的两段式联动 |
| **新增** | `frontend/src/hooks/useCardPanelBridge.ts`（自包含 hook，封装联动逻辑） |

**内容**：

1. **卡片点击处理（事件总线，非直接调）**
   - `view_result`: 通过 `onResultCardAction` 回调 → `ProjectWorkspace` 接收 → 设置 `lastClickedAction` + 调用现有 `setActiveArtifact`（**保留** 现有 API）
   - `view_file`: 同上路径，触发 `RightFileTree` 高亮（用 **新** 的 `useEffect` 监听，**不修改** `RightFileTree` 内部）
   - `download`: 复用现有 `desktopBridge.downloadArtifact`（**不新增** IPC channel）

2. **Active Artifact 状态管理（沿用现有 + 可选 Context）**
   - 现有 `ProjectWorkspace` 中 `activeArtifact` 状态**保留**
   - **新增**可选 `AgentContextProvider` slot（仅在 flag 开启时挂载），通过 context 传递 `activeArtifact`；未挂载时调用方读 context 为 `null`，**不报错**

3. **Context 更新机制（仅在 flag 开启时）**
   - 选择 artifact 后**仅在** `flags.agentWorkbench.contextHub` 开启时调用 `fetch_context_envelope`
   - flag 关闭：`activeArtifact` 仍按现有路径流转，**不调用**任何新接口

**依赖的现有组件**：`ProjectWorkspace`（必需）、`RightPanel`（必需）、`ResultStudioInspector`（必需）、`RightFileTree`（必需，新挂载点直接在 `RightPanel` 内 `useEffect` 监听）

**兼容性影响**：
- ✅ `activeArtifact` 现有管理路径不变
- ✅ `RightPanel` Tab 顺序、布局、折叠行为完全不变
- ✅ 不引入新 IPC channel；不修改 SQLite schema

**验收标准**：
- [ ] 点击卡片按钮正确切换右侧面板（仅在 flag 开启时）
- [ ] 右侧加载对应的结果或文件
- [ ] Agent 能感知当前查看的结果（通过日志验证）
- [ ] flag 关闭时，右侧 Tab 顺序、布局、键位与 v1.0 **逐字节等价**
- [ ] `useCardPanelBridge` 错误抛出不影响现有联动路径

### 5.3 P1.3：执行进度可见性（在现有进度条基础上扩展）

**工期**：2-3 天

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | `conversationRunStore` 现有 state、事件、reducer；`SimpleChat` 现有输入框 |
| **扩展** | `SimpleChat` 顶部**可选**插入 `<ExecutionProgress />` 容器；未插入时 `SimpleChat` 树结构与 v1.0 完全一致 |
| **新增** | `frontend/src/components/copilot/ExecutionProgress.tsx`（自包含 view） |

**内容**：

1. **ExecutionProgress 组件（只读订阅）**
   - 新建 `ExecutionProgress.tsx` 组件
   - 显示步骤列表（理解 → 计划 → 确认 → 运行 → 完成）
   - 实时更新当前步骤
   - **只读**订阅 `conversationRunStore`，**不修改**其 API

2. **状态接入（监听现有状态机）**
   - 接入 `conversationRunStore` 中的执行状态
   - 监听 job 状态变化（复用现有 `runStatus` 枚举）
   - **不引入**新事件名

3. **UI 集成（作为 SimpleChat 可选容器）**
   - 放在聊天输入框上方（**可选**，仅在 flag 开启时渲染）
   - 可折叠/展开（**不修改** SimpleChat 现有键盘快捷键）
   - 关闭 / flag 关闭时此 slot 渲染 `null`

**依赖的现有组件**：`SimpleChat`（必需）、`conversationRunStore`（必需）、`useErrorFormatter`（复用失败原因格式化）

**兼容性影响**：
- ✅ `conversationRunStore` API 不变
- ✅ `SimpleChat` 树结构在 flag 关闭时与 v1.0 等价
- ✅ 不修改现有键盘快捷键、tab 顺序、focus 链

**验收标准**：
- [ ] Agent 执行时显示执行进度条（仅在 flag 开启时）
- [ ] 步骤状态实时更新
- [ ] 失败时显示错误原因（复用 `useErrorFormatter`，错误文案与 v1.0 一致）
- [ ] flag 关闭时 `SimpleChat` 渲染快照与 v1.0 **逐字节等价**
- [ ] `conversationRunStore` 测试 100% 通过，**无新增 reducer/事件**

### 5.4 P1.4：参数确认卡片（现有 tool call 的可选弹窗，默认关闭）

> ⚠️ **2026-09-12 用户裁决取消本项**（原话「参数确认卡这个任务取消 不需要确认 agent主导」）——不再实现，本节保留作历史设计参考。见 §-1 修订 2。

**工期**：2-3 天

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | 现有 `toolActivity` 写操作路径、现有 `desktopBridge` IPC 调用、Agent prompt 既有行为 |
| **扩展** | `SimpleChat` 中**新增**可选 `pendingConfirm` 渲染区（默认不渲染）；Agent prompt **新增**可选确认策略提示（默认不启用） |
| **新增** | `frontend/src/components/copilot/ParamConfirmCard.tsx`（自包含组件） |

**内容**：

1. **确认卡片 UI（自包含，不替换现有 tool 渲染）**
   - 新建 `ParamConfirmCard.tsx` 组件
   - 显示参数名、值、类型
   - 支持修改参数值
   - **不修改** 现有 `toolActivity` 渲染

2. **确认流程（仅在 flag 开启时插入）**
   - Agent 发送确认请求（**仅在** `flags.agentWorkbench.paramConfirm === true` 时由 prompt 生成 `kind: 'param_confirm'` 消息）
   - 用户修改并确认 → 复用现有 `toolActivity` 路径继续执行
   - flag 关闭 → Agent **不生成**确认消息，tool call 沿现有路径直接执行，与 v1.0 等价

3. **安全保护（默认开启的安全阈值不变）**
   - 涉及写操作、删除、覆盖时**的强制确认**走 v1.0 现有路径（独立于本计划）
   - 本计划新增的"参数确认卡片"是**可选**的"友好提示层"，不替代 v1.0 的安全确认

**依赖的现有组件**：`SimpleChat`（必需）、`toolActivity`（必需，复用执行路径）、`useErrorFormatter`（复用错误格式化）

**兼容性影响**：
- ✅ flag 关闭时 Agent prompt 行为完全等价 v1.0
- ✅ flag 关闭时 `SimpleChat` 渲染快照与 v1.0 等价
- ✅ flag 关闭时工具调用链路零插桩

**验收标准**：
- [ ] 写操作前弹出确认卡片（仅在 flag 开启时）
- [ ] 用户可修改参数
- [ ] 确认/取消按钮正常工作
- [ ] flag 关闭时，Agent prompt 行为、SimpleChat 渲染快照、tool 调用链路与 v1.0 **逐字节等价**
- [ ] flag 关闭时，UI 上无任何确认卡片相关元素（通过 CSS Modules scoping 验证）

### 5.5 Phase 1 共享交付物

| 交付物 | 类型 | 路径 |
|--------|------|------|
| `AGENT_WORKBENCH_FLAGS` 配置 | 新增 | `frontend/src/config/agentWorkbenchFlags.ts` |
| Feature Flag 运行时读取 | 新增 | `frontend/src/lib/agentWorkbenchFlags.ts`（导出 hook `useAgentWorkbenchFlags`） |
| 4 个 P1 子任务的新组件 | 新增 | `frontend/src/components/copilot/ResultCardMessage.tsx` / `ExecutionProgress.tsx` / `ParamConfirmCard.tsx` |
| Result Card 渲染器注入 | 扩展 | `frontend/src/components/copilot/SimpleChat.tsx`（仅新增可选 prop） |
| ProjectWorkspace Context slot | 扩展 | `frontend/src/pages/project-workspace.tsx`（仅新增可选 contextProvider） |
| Job 完成 → Result Card 消息 | 新增 | `src/mcp-server.js`（仅追加新 tool `emit_result_card_message`，不改既有） |
| Context Envelope MCP tool | 新增（可选） | `src/mcp-server.js`（独立新增 tool，仅在 flag 开启时由前端调用） |

---

## 6. Phase 2：核心功能（8-12 人周）

**目标**：完善核心交互，构建专业生信能力

### 6.1 P2.1：Artifact 预览增强

**工期**：3-4 人周

**内容**：

1. **扩展预览支持**
   - .h5ad 单细胞数据可视化
   - .rds/.RData R 对象查看
   - 降维图交互（PCA/UMAP/t-SNE）
   - 热图、火山图、韦恩图

2. **科学交互查看器**
   - 增强 `ScientificInteractionViewer.tsx`
   - 支持细胞选择、基因选择
   - 选择状态持久化

3. **预览缓存**
   - 缩略图生成
   - 按需加载完整数据

**技术方案**：

```typescript
// ArtifactPreviewRegistry.ts
interface ArtifactPreviewHandler {
  type: string | string[];  // 文件类型
  priority: number;
  canPreview: (artifact: Artifact) => boolean;
  render: (artifact: Artifact, context: PreviewContext) => React.ReactNode;
  getInteractions?: (artifact: Artifact) => Interaction[];
}

// 注册示例
const previewHandlers: ArtifactPreviewHandler[] = [
  {
    type: ['.h5ad', '.loom'],
    priority: 10,
    canPreview: (a) => a.type === 'single-cell',
    render: (artifact) => <SingleCellViewer artifact={artifact} />,
    getInteractions: (a) => ['cell_selection', 'gene_expression']
  },
  {
    type: '.csv',
    priority: 5,
    canPreview: (a) => a.mimeType === 'text/csv',
    render: (artifact) => <DataTableViewer artifact={artifact} />,
  },
  // ...
];
```

**验收标准**：
- [ ] 支持 5 种以上生信格式预览
- [ ] 预览加载时间 < 2s（对于 < 10MB 文件）
- [ ] 交互选择状态可保存到 Artifact

### 6.2 P2.2：项目级 Timeline

**工期**：2-3 人周

**内容**：

1. **Timeline 数据模型**
   - 扩展 Job 表，增加 `parent_job_id`、`step_order`
   - 支持步骤链式关系

2. **Timeline UI 组件**
   - 创建 `AnalysisTimeline.tsx`
   - 垂直时间轴布局
   - 步骤状态图标
   - 点击跳转详情

3. **集成到工作台**
   - 作为左侧面板的一个 Tab
   - 与对话历史联动

**验收标准**：
- [ ] 显示完整的分析链路
- [ ] 支持点击跳转对应结果
- [ ] 失败步骤高亮并显示原因

### 6.3 P2.3：Skills 与工作台深度集成

**工期**：2-3 人周

**内容**：

1. **Skills Marketplace 入口**
   - 在左侧面板添加 "Skills" Tab
   - 展示已安装的 Skills 列表
   - 支持搜索和分类浏览

2. **Skills 调用**
   - 在对话中输入 `/skills` 触发选择器
   - Agent 可推荐合适的 Skill
   - Skill 执行结果生成 Artifact

3. **Skills 状态管理**
   - 创建 `useSkillStore.ts`
   - 订阅 Skills 安装/卸载事件

**验收标准**：
- [ ] Skills 列表可浏览
- [ ] 可在对话中调用 Skill
- [ ] Skill 执行结果自动生成 Artifact

### 6.4 P2.4：分析链路推荐

**工期**：1-2 人周

**内容**：

1. **推荐引擎**
   - 基于当前分析类型推荐下一步
   - 读取 `skills-workflow-integration.md` 中的流程定义
   - 生成推荐列表

2. **推荐 UI**
   - 在结果查看后显示推荐卡片
   - 支持一键续接分析
   - 显示预计耗时和资源

3. **推荐学习**
   - 记录用户接受/忽略的推荐
   - 优化推荐算法

**验收标准**：
- [ ] 结果查看后显示推荐
- [ ] 推荐基于分析类型匹配
- [ ] 一键续接可正常执行

---

## 7. Phase 3：高级能力（12-16 人周）

**目标**：构建多 Agent 协作、复杂工作流、高级可视化能力

### 7.1 P3.1：多 Agent 协作（基于现有 Agent Runtime 扩展）

**工期**：4-5 人周

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | 现有 Agent Runtime、Harness Engine、conversationRunStore、单 Agent 对话流 |
| **扩展** | `conversationRunStore` 接收**可选** sub-agent 任务注册（**不修改**现有 reducer/action） |
| **新增** | `startSubAgentTask` / `stopSubAgentTask` MCP tool（独立新增，不替换现有 tool） |

**内容**：

1. **子 Agent 委派（新增 MCP tool）**
   - **新增** MCP tool `start_subagent_task` / `stop_subagent_task`（**不替换**现有 `start_ai_task` 等）
   - 子 Agent 结果聚合（**新建** `aggregateSubAgentResults` reducer，**不修改** `conversationRunStore` 现有 reducer）
   - 状态同步（**新增** `subAgentStatus` 字段，**不修改**现有 `runStatus` 枚举）

2. **Agent 通信（保留现有 IPC + 新增 sub-agent 通道）**
   - 子 Agent → 主 Agent 结果传递（**新增** 独立 IPC channel `biof3:subagent-result`，**不修改**现有 channel）
   - 并行执行状态合并（**复用** 现有 `runStatus`，**不引入**新状态机）
   - 冲突处理（**新增** 独立冲突处理函数，flag 关闭时不调用）

3. **UI 展示（叠加在 SimpleChat/ExecutionProgress 之上）**
   - 多 Agent 状态指示器（**新增** `SubAgentStatusIndicator` 组件，**仅在** `ExecutionProgress` 开启时叠加显示）
   - 结果树形展示（**新增**树形组件，**不替换** Result Card 现有 props）
   - 错误隔离（**新增** `SubAgentErrorBoundary`，**不修改** 现有 `ErrorBoundary`）
   - flag 关闭时所有 sub-agent 相关组件渲染 `null`

**验收标准**：
- [ ] 支持 2+ 子 Agent 并行执行
- [ ] 子 Agent 结果正确聚合
- [ ] UI 显示多 Agent 状态

### 7.2 P3.2：复杂工作流编排（基于现有 Harness Engine 扩展）

**工期**：4-5 人周

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | 现有 Harness Engine、Plugin 协议、Job/Artifact 数据库表 |
| **扩展** | Harness 接收**新增** workflow DSL 解释器（**plug-in**，**不替换**现有 step 解释器） |
| **新增** | 独立 `WorkflowDirector` 服务（与 Harness 并列运行，**不修改** Harness 源码） |

**内容**：

1. **工作流定义语言（独立 DSL，不嵌入现有 Harness）**
   - YAML/JSON 工作流描述（**新增** `WorkflowDefinition` 类型，**不修改** Harness 现有 DSL）
   - 步骤、条件、循环（**新增** 独立解释器）
   - 错误恢复策略（**新增** 独立处理函数）

2. **工作流执行引擎（独立服务进程）**
   - 步骤依赖解析（**新增** `WorkflowDirector` 服务，**不替换** Harness）
   - 状态持久化（**新增** `workflow_runs` 表，**不修改** `jobs` 表现有字段）
   - 中断恢复（**新增** 独立恢复流程）

3. **工作流可视化（独立页面 + 可选 LeftPanel Tab）**
   - DAG 可视化编辑器（**新增** 独立页面 `frontend/src/pages/workflow/`）
   - 执行进度跟踪（**新增** 独立组件，**不修改** ExecutionProgress）
   - 日志聚合（**新增** 独立日志存储，**不修改**现有日志路径）
   - flag 关闭时 `WorkflowDirector` 不启动，LeftPanel 工作流 Tab 不渲染

**验收标准**：
- [ ] 支持定义多步骤工作流
- [ ] 工作流可中断恢复
- [ ] DAG 可视化展示

### 7.3 P3.3：高级生信可视化（基于现有 Artifact preview registry 增量追加）

**工期**：3-4 人周

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | 现有 `ResultStudioSurface`、preview registry、Artifact schema |
| **扩展** | preview registry 接收**新增** handler（**不重排**现有 priority） |
| **新增** | 单细胞分析、多组学整合、报告生成共 3 类 preview handler 或独立插件 |

**内容**：

1. **单细胞数据分析套件（注册到现有 preview registry）**
   - 细胞注释（**新增** preview handler）
   - 轨迹分析（**新增** preview handler）
   - 细胞间通信（**新增** preview handler）

2. **多组学整合视图（新增可选 preview handler）**
   - 转录组 + 蛋白组关联（**新增** handler）
   - 跨组学相关性热图（**新增** handler）

3. **报告生成（独立页面 + 可选导出）**
   - Markdown 报告模板（**新增** `frontend/src/pages/report/` 路由，**不修改**现有页面）
   - 图表自动嵌入（**复用** Artifact 引用）
   - PDF 导出（**新增** 独立命令，**不**通过现有 desktop API 路径触发）

**验收标准**：
- [ ] 内置 3 种以上高级可视化
- [ ] 支持报告自动生成
- [ ] 导出格式兼容性强

### 7.4 P3.4：团队协作（远期 —— 全部仅追加，不替换现有单用户模型）

**工期**：2 人周（规划）

**保留 / 扩展 / 新增**：

| 维度 | 内容 |
|------|------|
| **保留** | 现有 SQLite 单用户 schema、Project/Conversation/Job 表 |
| **扩展** | **新增可空** `owner_id` / `member_ids` 字段（项目表允许 nullable） |
| **新增** | 独立协作服务（**不替换**现有架构） |

**内容**：

1. **项目共享（可选字段 + 独立服务）**
   - 项目成员管理（**新增** 独立服务，**不修改**现有 Project 单用户写入路径）
   - 权限控制（**新增** Capability 字段，**不修改**现有权限断言）

2. **协作编辑（增量 IPC channel）**
   - 多人同时查看（**新增** `biof3:presence-update` channel，**不修改**现有 channel）
   - 变更通知（**新增** 独立通知服务，**不替换**现有通知）

3. **评论系统（独立数据模型）**
   - 结果评论（**新增** `comments` 表，**不修改** Artifact schema）
   - @ 提及（**新增** 独立解析器，**不修改** `chat-file-references.ts`）

---

## 8. 技术方案（增量扩展，不替换现有实现）

> §8 全部技术方案都遵守 §0 约束。**任何新增技术栈、库、配置都必须以"附加"形式加入，不能替换现有实现。**

### 8.1 前端技术栈（保留 + 仅追加）

| 组件 | 技术 | 说明 |
|------|------|------|
| 框架 | React 18 + TypeScript | 现有架构（**保留**） |
| 状态管理 | use State + 自定义 hooks | 现有架构 + 禁止 zustand（**保留**） |
| 样式 | CSS Modules | 现有架构（**保留**） |
| 路由 | React Router v6 | 现有架构（**保留**） |
| 拖拽 | 原生 Drag API | 现有架构（**保留**） |
| 可视化 | Recharts / D3.js | 现有架构（**保留**） |
| Feature Flag 读取 | `useAgentWorkbenchFlags` hook | **新增**（自包含，import 即可） |
| 上下文共享 | React Context API | 现有架构（**保留**） |
| 异步状态 | 现有 `useConversations` 等 | **保留**（不引入 Redux/SWR） |

### 8.2 关键实现细节

#### 8.2.1 Result Card 渲染（SimpleChat 的可选渲染器，**不替换** SimpleChat 现有渲染路径）

```typescript
// frontend/src/components/copilot/ResultCardMessage.tsx
// 自包含组件；仅在 SimpleChat 接收 extraRenderers?.result_card 时被调用
export function ResultCardMessage({
  card,
  onAction,
}: {
  card: ResultCard;
  onAction: (action: ResultCardAction) => void;
}) {
  const statusBadge = {
    running: <Badge variant="info">运行中</Badge>,
    success: <Badge variant="success">成功</Badge>,
    failed: <Badge variant="error">失败</Badge>,
  }[card.status];

  return (
    <div className={styles.resultCard}>
      <div className={styles.cardHeader}>
        <Icon name={card.type === 'tool' ? 'cpu' : 'chart'} />
        <span className={styles.cardTitle}>{card.title}</span>
        {statusBadge}
      </div>

      {card.summary && (
        <div className={styles.cardSummary}>
          {card.summary.artifactCount && (
            <span>生成 {card.summary.artifactCount} 个产物</span>
          )}
          {card.summary.keyMetrics?.map((m, i) => (
            <span key={i}>{m.label}: {m.value}</span>
          ))}
        </div>
      )}

      <div className={styles.cardActions}>
        {card.actions.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(action)}
            className={styles.actionBtn}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

```typescript
// frontend/src/components/copilot/SimpleChat.tsx (仅在 v1.1 增量新增 diff，不修改现有 props 签名)
// 现有 SimpleChat 不传 extraRenderers 时行为完全等价于 v1.0
function SimpleChat(props: SimpleChatProps) {
  const flags = useAgentWorkbenchFlags();
  const extraRenderers: Record<string, React.ComponentType> = {};

  if (flags.agentWorkbench.resultCard) {
    extraRenderers.result_card = ResultCardMessage;
  }
  if (flags.agentWorkbench.executionProgress) {
    extraRenderers.execution_progress = ExecutionProgressMessage;
  }
  if (flags.agentWorkbench.paramConfirm) {
    extraRenderers.param_confirm = ParamConfirmCard;
  }

  // 原有消息路由逻辑 — 仅在 message.meta.kind 命中 extraRenderers 时切换
  // 未命中时沿用 v1.0 现有 markdown 路径
  return (
    <MessageRouter
      messages={props.messages}
      extraRenderers={extraRenderers}  // 可选 prop
      fallback={SimpleMarkdownMessage}  // 现有 v1.0 路径
    />
  );
}
```

#### 8.2.2 Context Token 更新（仅在 `flags.agentWorkbench.contextHub` 开启时挂载）

```typescript
// frontend/src/hooks/useAgentContext.ts
// 自包含 hook；上游 ProjectWorkspace 决定是否挂载 AgentContextProvider
export function useAgentContext(projectId: string) {
  const flags = useAgentWorkbenchFlags();
  const [contextToken, setContextToken] = useState<string | null>(null);
  const activeArtifact = useActiveArtifact();

  useEffect(() => {
    if (!activeArtifact) return;
    if (!flags.agentWorkbench.contextHub) return;  // flag 关闭时不调用

    // 调用后端获取新的 context token
    fetchContextEnvelope({
      projectId,
      artifactId: activeArtifact.id,
      selection: activeArtifact.selection,
    }).then((envelope) => {
      setContextToken(envelope.contextToken);
    });
  }, [projectId, activeArtifact, flags.agentWorkbench.contextHub]);

  return { contextToken, activeArtifact };
}
```

> 未挂载 AgentContextProvider / 未开启 flag / activeArtifact 为 null 时，本 hook 全部早返回，**对 SimpleChat / ProjectWorkspace 现有渲染零影响**。

### 8.3 后端适配

#### 8.3.1 Job 完成事件（新增 hook，**不替换**现有 `job:completed` 处理器）

```javascript
// src/mcp-server.js
// 现有 server.on('job:completed', ...) 处理器保留不变；下方新增独立 hook
const _resultCardHook = async (job) => {
  const artifact = await getArtifactByJobId(job.id);

  // 仅在 flag 开启时生成 result card 消息；不修改 user 既有消息
  const cardMessage = {
    type: 'result_card',
    meta: {
      resultCard: {
        id: generateCardId(),
        type: 'tool',
        title: job.tool_id,
        status: 'success',
        summary: {
          artifactCount: artifact ? 1 : 0,
          keyMetrics: extractKeyMetrics(artifact),
        },
        actions: [
          { id: 'view_result', label: '查看结果', action: 'view_result', payload: { jobId: job.id } },
          { id: 'view_file', label: '查看文件', action: 'view_file', payload: { artifactId: artifact?.id } },
          { id: 'continue', label: '继续下一步', action: 'continue' },
        ],
        jobId: job.id,
        artifactIds: artifact ? [artifact.id] : [],
        projectId: job.project_id,
        createdAt: new Date().toISOString(),
        toolId: job.tool_id,
      }
    }
  };

  // 追加新消息，不修改 user 既有消息，不修改 Conversation 现有结构
  await addMessageToConversation(job.conversation_id, cardMessage);
};

if (process.env.AGENT_WORKBENCH_RESULT_CARD === 'true') {
  server.on('job:completed', _resultCardHook);  // 注册额外 hook，不替换现有
}
```

> 现有 `server.on('job:completed', ...)` 处理器保留不变；新 hook 仅在 `AGENT_WORKBENCH_RESULT_CARD=true` 时挂载。flag 关闭时**整段代码不调用**，不读取 `getArtifactByJobId`、不写入 `addMessageToConversation`，与 v1.0 行为完全等价。

#### 8.3.2 Context Envelope MCP Tool（独立新增，**不替换**现有 tools）

```javascript
// src/mcp-server.js
// 独立新增 MCP tool；不修改现有任何 tool 的签名、行为、返回类型
mcpServer.tool('fetch_context_envelope', {
  description: '获取 Agent 上下文 envelope（仅在 flags.agentWorkbench.contextHub 开启时由前端调用）',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      artifactId: { type: 'string' },
      selection: { type: 'object' },
    },
    required: ['projectId']
  },
  async handler({ projectId, artifactId, selection }) {
    const project = await getProject(projectId);
    const artifact = artifactId ? await getArtifact(artifactId) : null;

    return {
      contextToken: generateContextToken({ project, artifact, selection }),
      publicPhases: ['artifact_loaded'],
      selectionUsable: selection !== null,
    };
  }
});
```

> 现有 mcp tools 全部保留；新 tool 仅在 `flags.agentWorkbench.contextHub === true` 时由前端调用。flag 关闭时本 tool 被注册但不调用，**不消耗** MCP 资源。

---

## 9. 风险评估

### 9.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Artifact 预览性能问题 | 中 | 高 | 实施懒加载 + 缩略图缓存 |
| 多 Agent 状态一致性 | 中 | 高 | 使用消息队列 + 乐观更新 |
| 复杂工作流调试困难 | 高 | 中 | 提供执行日志 + 断点重放 |
| Context Token 过期 | 低 | 中 | 自动刷新 + 过期提示 |

### 9.2 产品风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 用户习惯迁移成本 | 高 | 高 | 提供传统模式切换 |
| 生信格式支持不完整 | 中 | 中 | 优先支持主流格式 |
| 结果卡片信息过载 | 低 | 中 | 渐进式披露 + 帮助提示 |

### 9.3 项目风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Phase 1 延期影响后续 | 中 | 高 | P1.1 独立可交付 |
| 需求变更频繁 | 高 | 中 | 敏捷迭代 + 定期对齐 |
| 测试覆盖不足 | 中 | 中 | 单元测试 + E2E 测试 |

---

## 10. 里程碑与验收标准

> 本计划每个里程碑在宣告"完成"前必须通过 §X.2 兼容性测试矩阵的 15 项双向用例。
> 任何里程碑即便功能上达到交付，但**未通过回退验证**（即关闭所有 flag 后 v1.0 等价冒烟集失败），不得宣称收口。

### 10.0 里程碑收口的强制前置条件

| 前置条件 | 验证脚本 | 失败后果 |
|---------|---------|----------|
| `AGENT_WORKBENCH_FLAGS` 全部关闭时，`test:smoke:v1-equivalent` 100% 通过 | `scripts/compat-matrix.mjs` | 不可收口 |
| 渲染快照 `snapshot:diff --baseline=v1.0-LTS` 与 v1.0 LTS 标签**逐字节等价** | `scripts/snapshot-diff.mjs` | 不可收口 |
| `extraRenderers` 未传 / `AgentContextProvider` 未挂载时行为 v1.0 等价 | 单元测试 | 不可收口 |
| 新增 IPC / MCP tool 列表与 v1.0 diff 已登记 | `tools/list.mjs` | 不可收口 |
| `docs/DOC-REGISTRY.json` 中 AGENT-WORKBENCH 条目状态保持 `planned` 直至 M1-M3 全部 verified | `npm run docs:check` | 不可收口 |

### 10.1 总体时间线

```
Phase 1: ████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 2-3 人周
Phase 2: ░░░░░░░░░░░░░░░░████████████████████░░ 8-12 人周
Phase 3: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████ 12-16 人周
```

### 10.2 里程碑

| 里程碑 | 日期 | 交付物 | 功能验收 | 兼容性验收（必跑） |
|--------|------|--------|----------|---------------|
| M1 | Week 2 | P1.1 + P1.2 | 结果卡片可点击打开右侧面板 | 关闭 `resultCard` / `cardPanelBridge` flag → SimpleChat/RightPanel 渲染快照与 v1.0 逐字节等价 |
| M2 | Week 4 | P1.3 + P1.4 | 执行过程可见 + 参数确认卡片 | 关闭 `executionProgress` / `paramConfirm` flag → SimpleChat 树结构、Agent prompt 行为、tool 调用链路与 v1.0 逐字节等价 |
| M3 | Week 8 | P2.1 + P2.2 | Artifact 预览增强 + Timeline | 关闭 `advancedVis` / `analysisTimeline` flag → preview registry、LeftPanel 渲染快照与 v1.0 逐字节等价 |
| M4 | Week 12 | P2.3 + P2.4 | Skills 集成 + 链路推荐 | 关闭 `skillsInLeftPanel` / `skillsSlashCommand` / `skillRecommendation` / `nextStepSuggestions` flag → SimpleChat 解析、useSkillStore、CommandPalette 与 v1.0 行为一致 |
| M5 | Week 20 | P3.1 + P3.2 | 多 Agent 协作 + 工作流编排 | 关闭 `subAgent` / `workflowDirector` flag → Agent Runtime 行为与 v1.0 逐字节等价 |
| M6 | Week 26 | P3.3 + P3.4 | 高级可视化 + 团队协作 | 关闭 `reportGen` / `teamCollab` flag → ResultStudioSurface、Project 写入路径与 v1.0 一致 |

> 任何里程碑的功能验收都必须**同时**配上对应的兼容性验收行；只有功能行通过、兼容性行未跑，不得宣称"已收口"。

### 10.3 Phase 1 详细验收

#### P1.1 结果卡片 MVP

**前提**：`agentWorkbench.resultCard === true`

**功能验收用例**：

```gherkin
功能: 结果卡片显示
  场景: 工具运行完成
    假设 用户在项目中发起 DEG 分析
    当 分析运行完成
    那么 聊天区出现结果卡片
    并且 卡片显示 "DEG 分析"
    并且 卡片显示 "成功" 状态
    并且 卡片显示产物数量

  场景: 点击查看结果
    假设 结果卡片已显示
    当 用户点击 "查看结果" 按钮
    那么 右侧面板切换到结果 Tab
    并且 加载对应的 Artifact
```

**兼容性验收用例**（必跑）：

```gherkin
功能: 结果卡片 - flag 关闭回退
  场景: 关闭 resultCard flag
    假设 agentWorkbench.resultCard === false
    当 用户在项目中发起 DEG 分析
    当 分析运行完成
    那么 聊天消息沿用 v1.0 markdown 路径
    并且 SimpleChat 渲染快照与 v1.0 逐字节等价
    并且 不调用 addMessageToConversation('result_card')
    并且 SQLite messages 表不新增 result_card 消息

  场景: extraRenderers 未传
    假设 SimpleChat 调用方未传 extraRenderers
    当 任何消息流经过
    那么 行为与 v1.0 完全一致
    并且 console 0 报错
```

#### P1.2 卡片与右侧联动

**前提**：`agentWorkbench.cardPanelBridge === true` 且 `agentWorkbench.contextHub === true`

**功能验收用例**：

```gherkin
功能: 卡片与右侧联动
  场景: 查看文件
    假设 结果卡片已显示
    当 用户点击 "查看文件" 按钮
    那么 右侧切换到文件 Tab
    并且 高亮对应的文件

  场景: Agent 感知当前结果
    假设 用户在右侧查看了某个结果
    当 用户在聊天中问 "解释这个结果"
    那么 Agent 知道当前查看的是哪个 Artifact
```

**兼容性验收用例**（必跑）：

```gherkin
功能: 卡片联动 - flag 关闭回退
  场景: 关闭 cardPanelBridge + contextHub
    假设 agentWorkbench.cardPanelBridge === false
    并且 agentWorkbench.contextHub === false
    当 用户在 ResultStudioSurface 选择 Artifact
    那么 activeArtifact 状态按 v1.0 现有路径流转
    并且 不调用 fetch_context_envelope
    并且 RightPanel Tab 顺序、布局、键位与 v1.0 逐字节等价

  场景: AgentContextProvider 未挂载
    假设 ProjectWorkspace 未提供 AgentContextProvider slot
    当 useAgentContext 被调用
    那么 早返回 null
    并且 不发起任何 IPC
```

#### P1.3 执行进度可见性

**前提**：`agentWorkbench.executionProgress === true`

**功能验收用例**：

```gherkin
功能: 执行进度展示
  场景: Agent 执行分析
    假设 用户发起分析请求
    当 Agent 正在执行
    那么 输入框上方显示执行进度
    并且 显示当前步骤 "正在运行 DEG 分析..."
    并且 步骤状态实时更新
```

**兼容性验收用例**（必跑）：

```gherkin
功能: 执行进度 - flag 关闭回退
  场景: 关闭 executionProgress flag
    假设 agentWorkbench.executionProgress === false
    当 Agent 正在执行
    那么 SimpleChat 顶部不渲染 ExecutionProgress
    并且 SimpleChat 树结构与 v1.0 逐字节等价
    并且 conversationRunStore 0 新增 reducer/action
    并且 测试覆盖率 100% 不变
```

#### P1.4 参数确认卡片

**前提**：`agentWorkbench.paramConfirm === true`

**功能验收用例**：

```gherkin
功能: 参数确认
  场景: 写操作前确认
    假设 用户请求删除数据
    当 Agent 准备执行删除
    那么 弹出参数确认卡片
    并且 显示将删除的文件
    并且 显示 "确认" 和 "取消" 按钮
```

**兼容性验收用例**（必跑）：

```gherkin
功能: 参数确认 - flag 关闭回退
  场景: 关闭 paramConfirm flag
    假设 agentWorkbench.paramConfirm === false
    当 Agent 准备执行写操作
    那么 Agent 不生成 param_confirm 消息
    并且 SimpleChat 渲染快照与 v1.0 逐字节等价
    并且 tool 调用链路 0 插桩
    并且 CSS Modules 中无 param-confirm 相关样式生效
```

---

## 11. 后续归档建议

### 11.1 待归档文档

以下文档已于 2026-08-16 superseded 并归档（commit 即将提交）：

| 文件 | 状态 | 原因 |
|------|------|------|
| `docs/archive/ide-transformation-retired/ide-transformation-plan.md` | `archived` / superseded by `G0-IDE-MCP-TOOLS` | IDE 改造计划已取消 |
| `docs/archive/ide-transformation-retired/ide-research/mcp-ide-tools-design.md` | `archived` / superseded by `G0-IDE-MCP-TOOLS` | 面向 IDE 的研究 |
| `docs/archive/ide-transformation-retired/ide-research/monaco-integration-research.md` | `archived` / superseded by `G0-IDE-MCP-TOOLS` | Monaco Editor 研究 |

归档操作已完成（`git mv`），DOC-REGISTRY 同步把三个登记项 `status` 从 `planned` / `reference` 改为 `archived`，并把路径指向 `docs/archive/ide-transformation-retired/`。归档方向由 `docs/codex-style-workbench-direction.md` 与本计划共同确认。

### 11.2 文档更新

归档后需要更新 `DOC-REGISTRY.json`：

1. 将 `IDE-TRANSFORMATION`、`IDE-MCP-TOOLS-DESIGN`、`IDE-MONACO-RESEARCH` 条目状态改为 `archived`
2. 新增 `AGENT-WORKBENCH` 条目（见下节）

---

## X.1 Feature Flag 设计

> 本章是 §0 核心约束"禁用项可独立关闭"的工程化落地，也是未来所有 Phase 子任务的标准接入门。

### X.1.1 设计目标

1. **每个 Agent Workbench 新能力对应一个独立 flag**，默认全部关闭。
2. **flag 关闭时**，新能力的代码、UI、IPC 调用、prompt 补充、SQLite 写入路径**全部短路**——等价于 v1.0 行为。
3. **flag 开启时**，能力以"挂载/注入"形式出现在现有组件上，不替换、不重构。
4. **开发态可通过环境变量或 LocalStorage 单独开关**；**测试态通过 fixture 切换**；**生产态默认全关**直至显式启用。
5. **flag 之间独立**，关闭 A 不影响 B；不存在"隐式依赖"。

### X.1.2 Flag 类型与读取优先级

| 来源 | 优先级 | 适用场景 |
|------|--------|----------|
| `AGENT_WORKBENCH_FLAGS` 环境变量（`true`/`false` 逗号分隔） | 1（最高） | 打包构建、CI、Electron 启动参数 |
| `localStorage` 中 `agentWorkbench.flags` JSON 值 | 2 | 开发态单独开关、用户临时调试 |
| `frontend/src/config/agentWorkbenchFlags.ts` 静态默认值 | 3（最低） | 仓库默认；首启动赋值给 localStorage |

> 三层设置缺一不可：环境变量作为最终覆盖，localStorage 提供开发态灵活性，静态默认值保证零配置启动。

### X.1.3 Flag 清单（v1.1 初版）

| Flag 名（点分隔） | 默认 | 控制的能力 | 实现位置 |
|-------------------|------|-----------|----------|
| `agentWorkbench.resultCard` | `false` | SimpleChat 聊天结果卡片渲染 | P1.1 |
| `agentWorkbench.cardPanelBridge` | `false` | 卡片点击 ↔ RightPanel 联动 | P1.2 |
| `agentWorkbench.contextHub` | `false` | Agent Context Hub Provider 挂载 | P1.2 / 4.2.2 |
| `agentWorkbench.executionProgress` | `false` | ExecutionProgress 可选渲染器 | P1.3 |
| `agentWorkbench.paramConfirm` | `false` | ParamConfirmCard 可选渲染器 | P1.4 |
| `agentWorkbench.skillsInLeftPanel` | `false` | LeftPanel Skills Tab | P2.3 |
| `agentWorkbench.skillsSlashCommand` | `false` | SimpleChat 解析 `/skills` | P2.3 |
| `agentWorkbench.skillRecommendation` | `false` | Agent 推荐 Skill | P2.3 |
| `agentWorkbench.analysisTimeline` | `false` | LeftPanel Timeline Tab | P2.2 |
| `agentWorkbench.nextStepSuggestions` | `false` | Result Card 推荐区 | P2.4 |
| `agentWorkbench.subAgent` | `false` | 多 Agent 协作（全部 P3.1 子能力） | P3.1 |
| `agentWorkbench.workflowDirector` | `false` | WorkflowDirector 服务启动 | P3.2 |
| `agentWorkbench.advancedVis` | `false` | 单细胞/多组学高级 preview | P3.3 |
| `agentWorkbench.reportGen` | `false` | 报告生成独立页面 | P3.3 |
| `agentWorkbench.teamCollab` | `false` | 团队协作服务 | P3.4 |

> 新增 flag 必须按本表格式登记；改动现有 flag 默认值必须先经过架构评审。

### X.1.4 静态默认值实现示例

```typescript
// frontend/src/config/agentWorkbenchFlags.ts
export interface AgentWorkbenchFlags {
  agentWorkbench: {
    resultCard: boolean;
    cardPanelBridge: boolean;
    contextHub: boolean;
    executionProgress: boolean;
    paramConfirm: boolean;
    skillsInLeftPanel: boolean;
    skillsSlashCommand: boolean;
    skillRecommendation: boolean;
    analysisTimeline: boolean;
    nextStepSuggestions: boolean;
    subAgent: boolean;
    workflowDirector: boolean;
    advancedVis: boolean;
    reportGen: boolean;
    teamCollab: boolean;
  };
}

export const DEFAULT_AGENT_WORKBENCH_FLAGS: AgentWorkbenchFlags = {
  agentWorkbench: {
    resultCard: false,
    cardPanelBridge: false,
    contextHub: false,
    executionProgress: false,
    paramConfirm: false,
    skillsInLeftPanel: false,
    skillsSlashCommand: false,
    skillRecommendation: false,
    analysisTimeline: false,
    nextStepSuggestions: false,
    subAgent: false,
    workflowDirector: false,
    advancedVis: false,
    reportGen: false,
    teamCollab: false,
  },
};
```

### X.1.5 运行时读取 Hook

```typescript
// frontend/src/lib/agentWorkbenchFlags.ts
import { useMemo } from 'react';
import { DEFAULT_AGENT_WORKBENCH_FLAGS, AgentWorkbenchFlags } from '../config/agentWorkbenchFlags';

const LS_KEY = 'agentWorkbench.flags';

function readEnvFlags(): Partial<AgentWorkbenchFlags> {
  // 读取 process.env.AGENT_WORKBENCH_FLAGS = "resultCard=true,executionProgress=true"
  // 解析后覆盖对应字段
  // ...
}

function readLocalStorageFlags(): Partial<AgentWorkbenchFlags> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<AgentWorkbenchFlags>;
  } catch {
    return {};
  }
}

export function useAgentWorkbenchFlags(): AgentWorkbenchFlags {
  return useMemo(() => {
    const env = readEnvFlags();
    const ls = readLocalStorageFlags();
    const merged: AgentWorkbenchFlags = {
      agentWorkbench: {
        ...DEFAULT_AGENT_WORKBENCH_FLAGS.agentWorkbench,
        ...(ls.agentWorkbench ?? {}),
        ...(env.agentWorkbench ?? {}),
      },
    };
    return merged;
  }, []);
}
```

### X.1.6 后端开关（独立、可选）

```javascript
// src/mcp-server.js
// 仅在 server-side 初始化时读取；不暴露给 IPC
const SERVER_AGENT_WORKBENCH_FLAGS = {
  emitResultCard: process.env.AGENT_WORKBENCH_RESULT_CARD === 'true',
  fetchContextEnvelope: process.env.AGENT_WORKBENCH_CONTEXT_HUB === 'true',
  // ... 与前端 flag 独立，可独立开关
};
```

### X.1.7 开关入口（用户/管理员可控制）

- **开发态**：通过 `localStorage.agentWorkbench.flags` JSON 控制；提供 `scripts/dev-toggle-flags.mjs` 命令行辅助。
- **生产态打包**：通过 Electron 启动参数 `--agent-workbench-flags=resultCard=true,executionProgress=true` 一次性注入。
- **管理员 UI**（**规划中**，近期非 blocking）：在 Settings 页面**新增** "Experimental Features" 子区，**仅在** `window.biof3Desktop.experimentalSettings` 暴露时显示；该子区是**新增** UI，不影响现有 Settings 任何部分。

### X.1.8 Flag 启用的强制纪律

- 任何 PR 引入新代码路径必须**同时**包含该路径的 flag 关闭等价实现；
- flag 默认值的变更必须经架构评审；
- 关闭 flag 后的代码路径必须能用现有最小冒烟集验证；
- flag 关闭后**严禁**出现 console.warn / console.error / 异常堆栈；
- flag 关闭后**严禁**引入额外的 IPC / SQLite 写入 / 同步阻塞。

---

## X.2 兼容性测试矩阵

> 本章是 §0 "测试矩阵双向验证"的具体工程化落地：每个新能力必须同时通过"功能启用"与"功能禁用"两组验证。

### X.2.1 矩阵总览

| 测试维度 | 现有功能（v1.0） | 新功能 flag 关闭 | 新功能 flag 开启 |
|---------|----------------|------------------|------------------|
| 渲染快照 | v1.0 基线 | **必须与 v1.0 逐字节等价** | 可与 v1.0 不同 |
| API 签名 | v1.0 基线 | **必须与 v1.0 逐字节等价** | 可新增可选 prop |
| IPC 通道 | v1.0 基线 | **必须与 v1.0 一致** | 可新增 channel |
| SQLite schema | v1.0 基线 | **必须与 v1.0 一致** | 可新增可空列 |
| IPC 事件 | v1.0 基线 | **必须与 v1.0 一致** | 可新增事件 |
| SQLite 写入路径 | v1.0 基线 | **必须与 v1.0 一致** | 可新增写入 hook |
| 性能（启动时间） | v1.0 基线 | **必须与 v1.0 误差 < 5%** | 可放宽 |
| 错误文案 | v1.0 基线 | **必须与 v1.0 一致** | 可新增文案 |

### X.2.2 强制双向测试用例

| 用例 ID | 名称 | flag 关闭预期 | flag 开启预期 |
|---------|------|--------------|--------------|
| `T-AW-001` | SimpleChat 渲染快照 | 与 v1.0 快照逐字节等价 | 含 `ResultCard` 渲染（适用消息类型时） |
| `T-AW-002` | SimpleChat 树结构 | 与 v1.0 完全一致 | 顶层多 `<ExecutionProgress />` slot |
| `T-AW-003` | RightPanel Tab 顺序 | v1.0 顺序 | 顺序不变；可新增 Tab |
| `T-AW-004` | MessageMeta JSON | 与 v1.0 完全一致 | 可新增 `resultCard` / `executionProgress` / `paramConfirm` 字段 |
| `T-AW-005` | SQLite messages 表 | 与 v1.0 schema 一致 | 仅允许新增可空列 |
| `T-AW-006` | MCP tools 列表 | v1.0 列表 | 可新增 tool；现有 tool 签名不变 |
| `T-AW-007` | IPC channels 列表 | v1.0 列表 | 可新增 channel；现有 channel 行为不变 |
| `T-AW-008` | conversationRunStore | v1.0 reducer/action | flag 关闭时**无** sub-agent 注册 |
| `T-AW-009` | SimpleChat Composer 键盘快捷键 | v1.0 全部可用 | 全部保留 |
| `T-AW-010` | `useSkillStore` 返回值 | v1.0 默认值 | 可新增 `enableCommandPalette` / `enableSlashCommand` 参数 |
| `T-AW-011` | 启动时间（macOS 冷启） | < 5% 误差 | flag 开启后增量 < 200ms |
| `T-AW-012` | `extraRenderers` 未传 | 走 v1.0 markdown 路径 | 走 ResultCard 路径 |
| `T-AW-013` | `AgentContextProvider` 未挂载 | `useAgentContext` 早返回 null | 正常返回 |
| `T-AW-014` | `localStorage` 无键时 | 使用默认 flags | 同上 |
| `T-AW-015` | `process.env` 未设置 | 使用默认 flags | 同上 |

### X.2.3 兼容性测试脚本（草图）

```javascript
// scripts/compat-matrix.mjs （在工程 npm scripts 中以 `npm run compat:matrix` 暴露）
import { DEFAULT_AGENT_WORKBENCH_FLAGS } from '../frontend/src/config/agentWorkbenchFlags';

const allFlags = Object.keys(DEFAULT_AGENT_WORKBENCH_FLAGS.agentWorkbench);

async function runMatrix() {
  // 1. 当前所有 flag 关闭 — 跑测试套件，结果必须与 v1.0 基线一致
  await runAllFlags(allFlags, false);
  // 2. 单独开启每个 flag — 跑定向测试 + 渲染快照
  for (const flag of allFlags) {
    await runAllFlags([flag], true);
  }
  // 3. 全部开启 — 跑全功能冒烟
  await runAllFlags(allFlags, true);
}
```

### X.2.4 渐进启用顺序

> 当多个 flag 同时开启时，**必须**遵守以下顺序；任何倒序都不被允许。

1. `agentWorkbench.resultCard`（最低风险：仅渲染层）
2. `agentWorkbench.executionProgress`（仅渲染层）
3. `agentWorkbench.cardPanelBridge`（联动层，需 resultCard 启用）
4. `agentWorkbench.contextHub`（依赖层，需 cardPanelBridge 启用）
5. `agentWorkbench.paramConfirm`（Agent prompt 增强，需 contextHub 启用）
6. `agentWorkbench.skillsInLeftPanel`（UI 扩展，独立）
7. `agentWorkbench.skillsSlashCommand`（依赖 skillsInLeftPanel）
8. `agentWorkbench.skillRecommendation`（依赖 skill slash）
9. `agentWorkbench.analysisTimeline`（独立 UI 扩展）
10. `agentWorkbench.nextStepSuggestions`（依赖 resultCard）
11. `agentWorkbench.subAgent`（依赖 executionProgress）
12. `agentWorkbench.workflowDirector`（独立服务）
13. `agentWorkbench.advancedVis`（独立预览）
14. `agentWorkbench.reportGen`（独立页面）
15. `agentWorkbench.teamCollab`（独立服务）

> 启用顺序也是 §10 里程碑验收路径——M1 必须先通过步骤 1-5，M2 必须通过步骤 6-10，M3 必须通过步骤 11-15。

### X.2.5 回退验证（"禁用所有 flag 时的回退验证"）

每次 Phase 收口必须执行：

```bash
# 1. 关闭所有 flag
unset AGENT_WORKBENCH_FLAGS
rm -f ~/.biof3/agentWorkbench.flags.json

# 2. 运行 v1.0 等价冒烟集
npm run test:smoke:v1-equivalent  # 自包含脚本

# 3. 渲染快照对比（与 v1.0 LTS 标签的快照）
npm run snapshot:diff -- --baseline=v1.0-LTS
```

任意一项失败 → 视为引入了破坏性变更，必须修复后再宣称"flag 关闭即回退"。

### X.2.6 已知边界与豁免清单

| 豁免项 | 原因 | 文档位置 |
|--------|------|----------|
| 启动时间 ± 5% 误差 | flag 加载本身需读取 env/localStorage | X.2.1 表格已声明 |
| `simplify-chat.css` 因新增 CSS Modules 而体积增大 | 不可避免的样式增量 | 报告"v1.0 与 v1.1 体积差异"附录 |
| `AGENT_WORKBENCH_FLAGS` 环境变量本身的存在 | 必须保留作为覆盖入口 | X.1.2 已声明 |

> 任何新增豁免项必须经架构评审。

---

## 附录 A：DOC-REGISTRY.json 新增条目

```json
{
  "id": "AGENT-WORKBENCH",
  "path": "docs/agent-workbench-enhancement-plan.md",
  "kind": "roadmap",
  "status": "planned",
  "canonical": true,
  "truthDomain": "agent-workbench-enhancement",
  "entrypoint": "docs/README.md",
  "archivePolicy": "retain_stable_path",
  "tags": [
    "agent",
    "workbench",
    "enhancement",
    "codex-style",
    "result-card"
  ],
  "phases": [
    {
      "id": "P1",
      "name": "快速见效增强",
      "duration": "2-3 人周",
      "milestone": "M1"
    },
    {
      "id": "P2",
      "name": "核心功能",
      "duration": "8-12 人周",
      "milestone": "M3-M4"
    },
    {
      "id": "P3",
      "name": "高级能力",
      "duration": "12-16 人周",
      "milestone": "M5-M6"
    }
  ]
}
```

---

## 附录 B：关键文件清单（区分"扩展"与"新增"）

### B.1 仅追加（"新增"列）的文件 —— 不修改任何现有源码

| 文件 | 类型 | 说明 |
|------|------|------|
| `frontend/src/config/agentWorkbenchFlags.ts` | 新增 | 静态默认 flag 配置 |
| `frontend/src/lib/agentWorkbenchFlags.ts` | 新增 | `useAgentWorkbenchFlags` hook |
| `frontend/src/components/copilot/ResultCardMessage.tsx` | 新增 | SimpleChat 结果卡片可选渲染器 |
| `frontend/src/components/copilot/ExecutionProgress.tsx` | 新增 | SimpleChat 执行进度可选容器 |
| `frontend/src/components/copilot/ParamConfirmCard.tsx` | 新增 | SimpleChat 参数确认可选渲染器 |
| `frontend/src/components/copilot/SubAgentStatusIndicator.tsx` | 新增 | 主/子 Agent 状态指示器（P3.1） |
| `frontend/src/components/copilot/SubAgentErrorBoundary.tsx` | 新增 | sub-agent 错误隔离（P3.1） |
| `frontend/src/components/copilot/RecommendationList.tsx` | 新增 | Result Card 推荐子区（P2.4） |
| `frontend/src/hooks/useAgentContext.ts` | 新增 | Agent 上下文 hub hook |
| `frontend/src/hooks/useCardPanelBridge.ts` | 新增 | 卡片 → RightPanel 联动 hook |
| `frontend/src/hooks/useNextStepSuggestions.ts` | 新增 | 推荐清单 hook（P2.4） |
| `frontend/src/hooks/useArtifactThumbnailCache.ts` | 新增 | 缩略图缓存 hook（P2.1） |
| `frontend/src/hooks/useArtifactPreviewRegistry.ts` | 新增 | preview registry 扩展点 |
| `frontend/src/components/result-studio/AnalysisTimeline.tsx` | 新增 | Timeline 自包含视图 |
| `frontend/src/pages/workflow/index.tsx` | 新增 | 工作流可视化独立页面（P3.2） |
| `frontend/src/pages/report/index.tsx` | 新增 | 报告生成独立页面（P3.3） |
| `frontend/src/components/desktop/ExperimentalSettings.tsx` | 新增（可选） | "Experimental Features" 设置子区 |
| `scripts/dev-toggle-flags.mjs` | 新增 | flag 切换 CLI 辅助 |
| `scripts/compat-matrix.mjs` | 新增 | 兼容性矩阵测试脚本 |
| `scripts/snapshot-diff.mjs` | 新增 | 渲染快照对比脚本 |
| `docs/agent-workbench-enhancement-plan.md` | 更新 | 本文档 v1.1 |
| `docs/archive/...` | 新增 | 历史归档占位（按 §11） |

### B.2 仅扩展（"扩展"列）的现有文件 —— **仅追加**可选 prop / hook / handler

| 文件 | 扩展内容 | 禁止改动 |
|------|---------|----------|
| `frontend/src/components/copilot/SimpleChat.tsx` | 接收**可选** `extraRenderers?: Record<string, React.ComponentType>` prop；接收**可选** `slashCommandParser` slot | 现有消息路径、tool activity 渲染、键盘快捷键、focus 链、tab 顺序 |
| `frontend/src/pages/project-workspace.tsx` | 接收**可选** `contextProvider?: React.ComponentType` slot；接收**可选** `lastClickedAction` 状态挂载 | 现有三栏布局、列宽、RightPanel 顺序、IPC 调用 |
| `frontend/src/components/result-studio/ResultStudioSurface.tsx` | 接收**可选** `onArtifactFocus` 回调 | 现有渲染路径、Tab 顺序、上下文就绪检查 |
| `frontend/src/components/copilot/conversationRunStore.ts` | 接收**可选** sub-agent state registration | 现有 reducer、action、事件名 |
| `frontend/src/hooks/useSkillStore.ts` | 接收**可选** `enableCommandPalette` / `enableSlashCommand` 参数 | 现有 defaults、subscription、cleanup |
| `frontend/src/components/copilot/CommandPalette.tsx` | **新增**注册项（保持现有注册顺序） | 现有命令解析、行为、快捷键 |
| `frontend/src/hooks/useErrorFormatter.ts` | **新增**可选格式化函数（保持现有签名） | 现有错误文案、错误码 |
| `frontend/src/components/workspace-panels/LeftPanel.tsx` | **新增** Timline / Skills Tab（**最右**新增位） | 现有 Tab 顺序 |
| `frontend/src/components/workspace-panels/RightPanel.tsx` | 通过 `useEffect` 监听 `lastClickedAction`（**不修改**内部） | 现有 Tab 顺序、布局、折叠行为 |
| `src/mcp-server.js` | **新增** MCP tool `fetch_context_envelope` / `emit_result_card_message` / `start_subagent_task` / `stop_subagent_task`（独立新增） | 现有 tool 列表、签名、行为 |
| `frontend/src/components/copilot/copilotConversationsClient.ts` | **新增**可选 `ResultCardPayload` 类型；MessageMeta 仅新增可空字段 | 现有消息结构、字段语义 |
| `core/shared-backend/job-schema` (SQLite) | **新增可空** `parent_job_id` / `step_order` 列 | 现有 schema、写入路径、索引 |
| `core/shared-backend/artifact-schema` | **新增可空** `selection` / `thumbnail_url` 字段 | 现有 schema、写入路径 |
| `docs/DOC-REGISTRY.json` | 在 AGENT-WORKBENCH 条目**已有**字段基础上，**新增**phase 字段描述扩展型策略 | 现有 `kind` / `status` / `canonical` 不变 |

---

## 附录 C：参考文档

| 文档 | 关系 |
|------|------|
| `docs/codex-style-workbench-direction.md` | 核心方向定义 |
| `docs/project-workspace-handoff.md` | 当前工作台交接文档 |
| `docs/skills-workflow-integration.md` | Skills 与工作流集成 |
| `docs/g0-result-studio-plan.md` | Result Studio 计划 |
| `docs/ui-productization-audit.md` | UI 审计 |

---

*文档结束*
