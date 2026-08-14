# BioF3 Agent 工作台增强计划

> 文档版本：v1.0  
> 创建日期：2026-08-14  
> 状态：planned  
> 负责人：BioF3 Team  
> 目标：将 BioF3 Desktop 打造为 **Codex 式 AI 生信工作台**

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

---

## 1. 概述与愿景

### 1.1 背景

BioF3 Desktop 正在从传统的"工具集合"向 **AI 协作开发环境**转型。参考 OpenAI Codex 的产品理念，我们需要构建一个以项目为中心、由 Agent 协作推进、由固定插件系统产生可复现结果的生信工作台。

**核心定位**（来自 `docs/codex-style-workbench-direction.md`）：

> BioF3 工作台是面向生信分析家的 **AI 协作开发环境**
> - AI 是主角（不是辅助工具）
> - 结果卡片是核心交付物
> - 右侧查看器与聊天强联动
> - 项目级对话隔离

### 1.2 产品愿景

**目标形态**：

```
┌──────────────────────────────────────────────────────────────────┐
│  左侧：项目资源         │  中间：Agent 主工作区      │  右侧：结果查看  │
├─────────────────────────┼────────────────────────────┼────────────────┤
│ • 我的项目列表          │ • 分析目标输入             │ • 文件树        │
│ • 当前项目数据          │ • 理解/计划/执行展示       │ • 分析结果图    │
│ • 分析历史              │ • 结果卡片交付             │ • CSV/表格预览  │
│ • 切换项目              │ • 继续追问                 │ • 日志查看      │
└─────────────────────────┴────────────────────────────┴────────────────┘
```

**用户体验目标**：

> 用户不再面对一堆分散工具入口，而是在一个项目里，和 AI 生信分析搭档一起推进数据分析、查看结果、解释图表、沉淀可复现记录。

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

本计划**不是**将 BioF3 改造成传统 IDE（如 `docs/ide-transformation-plan.md` 所述的 Monaco Editor 集成、文件树导航等），而是专注于：

| 维度 | IDE 改造方向（归档） | Agent 工作台增强（本计划） |
|------|---------------------|---------------------------|
| 核心交互 | 代码编辑为主 | Agent 对话为主 |
| 结果交付 | 文件系统 | 可交互结果卡片 |
| 上下文 | 文件/代码 | 项目/数据集/分析历史 |
| 目标用户 | 开发者 | 生信分析家 |
| 可视化 | 通用代码高亮 | 生信图表、表格、日志 |

> **说明**：`docs/ide-transformation-plan.md` 和 `docs/ide-research/` 目录建议后续归档，因为它们代表了一个已放弃的方向。

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

### 4.1 增强后的系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BioF3 Desktop Shell                            │
│  ┌───────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│  │    Left Panel     │  │   Center Panel       │  │   Right Panel   │ │
│  │                   │  │                      │  │                  │ │
│  │ • 项目列表        │  │ • SimpleChat         │  │ • ResultStudio  │ │
│  │ • 当前项目数据    │  │   (主对话界面)       │  │   (结果查看)    │ │
│  │ • 分析历史        │  │                      │  │                  │ │
│  │ • 切换项目        │  │ • Result Cards       │  │ • FileTree      │ │
│  │                   │  │   (结果卡片)         │  │ • Artifact View │ │
│  │                   │  │                      │  │ • Terminal      │ │
│  │                   │  │ • Execution Progress │  │ • Browser       │ │
│  │                   │  │   (执行过程)         │  │                  │ │
│  └───────────────────┘  └─────────────────────┘  └─────────────────┘ │
│                                    │                                    │
│                         ┌──────────┴──────────┐                         │
│                         │  Agent Context Hub   │                         │
│                         │                     │                         │
│                         │ • Current Project  │                         │
│                         │ • Active Artifact  │                         │
│                         │ • Selection State  │                         │
│                         │ • Conversation ID  │                         │
│                         └──────────┬──────────┘                         │
└────────────────────────────────────│────────────────────────────────────┘
                                     │
┌────────────────────────────────────│────────────────────────────────────┐
│                           Backend Services                               │
│  ┌───────────────────┐  ┌─────────┴────────┐  ┌─────────────────────┐   │
│  │  MCP Server       │  │  Harness Engine   │  │  Project Store      │   │
│  │  (AI 工具注册)    │  │  (工作流执行)    │  │  (SQLite)          │   │
│  └───────────────────┘  └──────────────────┘  └─────────────────────┘   │
│  ┌───────────────────┐  ┌──────────────────┐  ┌─────────────────────┐   │
│  │  Skills Registry  │  │  Artifact Store   │  │  Conversation Store │   │
│  │  (技能注册)      │  │  (结果存储)      │  │  (对话历史)        │   │
│  └───────────────────┘  └──────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心组件设计

#### 4.2.1 Result Card System（结果卡片系统）

**目的**：在聊天中交付可操作的结果卡片

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

**渲染位置**：`SimpleChat.tsx` 中的消息渲染器

#### 4.2.2 Agent Context Hub（Agent 上下文中心）

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

#### 4.2.3 Execution Progress Tracker（执行进度追踪器）

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

**UI 位置**：CenterPanel 中，聊天输入框上方

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

**目标**：在不破坏现有架构的前提下，快速提升核心体验

### 5.1 P1.1：聊天结果卡片 MVP

**工期**：3-5 天

**内容**：

1. **定义 Result Card 数据结构**
   - 在 `copilotConversationsClient.ts` 中扩展消息 meta 类型
   - 支持 `type: 'result_card'` 的消息

2. **实现卡片渲染组件**
   - 创建 `ResultCardMessage.tsx` 组件
   - 支持状态徽章、操作按钮
   - 响应点击事件

3. **后端适配**
   - 扩展 Job 完成回调，携带 Result Card 信息
   - 更新 Agent prompt，生成结构化卡片

**验收标准**：
- [ ] 工具运行完成后聊天区出现结果卡片
- [ ] 卡片显示工具名、状态、简要结果
- [ ] 点击"查看结果"按钮打开右侧面板

### 5.2 P1.2：卡片与右侧联动

**工期**：2-3 天

**内容**：

1. **卡片点击处理**
   - `view_result`: 右侧切换 results tab + 加载 artifact
   - `view_file`: 右侧切换 files tab + 定位文件
   - `download`: 触发文件下载

2. **Active Artifact 状态管理**
   - 在 `ProjectWorkspace` 中管理 `activeArtifact` 状态
   - 通过 Context 传递给子组件

3. **Context 更新机制**
   - 选择 artifact 后更新 Agent 上下文
   - 支持 `contextToken` 刷新

**验收标准**：
- [ ] 点击卡片按钮正确切换右侧面板
- [ ] 右侧加载对应的结果或文件
- [ ] Agent 能感知当前查看的结果（通过日志验证）

### 5.3 P1.3：执行进度可见性

**工期**：2-3 天

**内容**：

1. **ExecutionProgress 组件**
   - 创建 `ExecutionProgress.tsx` 组件
   - 显示步骤列表（理解 → 计划 → 确认 → 运行 → 完成）
   - 实时更新当前步骤

2. **状态接入**
   - 接入 `conversationRunStore` 中的执行状态
   - 监听 job 状态变化

3. **UI 集成**
   - 放在聊天输入框上方
   - 可折叠/展开

**验收标准**：
- [ ] Agent 执行时显示执行进度条
- [ ] 步骤状态实时更新
- [ ] 失败时显示错误原因

### 5.4 P1.4：参数确认卡片

**工期**：2-3 天

**内容**：

1. **确认卡片 UI**
   - 创建 `ParamConfirmCard.tsx` 组件
   - 显示参数名、值、类型
   - 支持修改参数值

2. **确认流程**
   - Agent 发送确认请求
   - 用户修改并确认
   - 确认后继续执行

3. **安全保护**
   - 涉及写操作、删除、覆盖时必须确认
   - 风险提示高亮显示

**验收标准**：
- [ ] 写操作前弹出确认卡片
- [ ] 用户可修改参数
- [ ] 确认/取消按钮正常工作

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

### 7.1 P3.1：多 Agent 协作

**工期**：4-5 人周

**内容**：

1. **子 Agent 委派**
   - 实现 `startSubAgentTask` / `stopSubAgentTask`
   - 子 Agent 结果聚合
   - 状态同步

2. **Agent 通信**
   - 子 Agent → 主 Agent 结果传递
   - 并行执行状态合并
   - 冲突处理

3. **UI 展示**
   - 多 Agent 状态指示器
   - 结果树形展示
   - 错误隔离

**验收标准**：
- [ ] 支持 2+ 子 Agent 并行执行
- [ ] 子 Agent 结果正确聚合
- [ ] UI 显示多 Agent 状态

### 7.2 P3.2：复杂工作流编排

**工期**：4-5 人周

**内容**：

1. **工作流定义语言**
   - YAML/JSON 工作流描述
   - 步骤、条件、循环
   - 错误恢复策略

2. **工作流执行引擎**
   - 步骤依赖解析
   - 状态持久化
   - 中断恢复

3. **工作流可视化**
   - DAG 可视化编辑器
   - 执行进度跟踪
   - 日志聚合

**验收标准**：
- [ ] 支持定义多步骤工作流
- [ ] 工作流可中断恢复
- [ ] DAG 可视化展示

### 7.3 P3.3：高级生信可视化

**工期**：3-4 人周

**内容**：

1. **单细胞数据分析套件**
   - 细胞注释
   - 轨迹分析
   - 细胞间通信

2. **多组学整合视图**
   - 转录组 + 蛋白组关联
   - 跨组学相关性热图

3. **报告生成**
   - Markdown 报告模板
   - 图表自动嵌入
   - PDF 导出

**验收标准**：
- [ ] 内置 3 种以上高级可视化
- [ ] 支持报告自动生成
- [ ] 导出格式兼容性强

### 7.4 P3.4：团队协作（远期）

**工期**：2 人周（规划）

**内容**：

1. **项目共享**
   - 项目成员管理
   - 权限控制

2. **协作编辑**
   - 多人同时查看
   - 变更通知

3. **评论系统**
   - 结果评论
   - @ 提及

---

## 8. 技术方案

### 8.1 前端技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 框架 | React 18 + TypeScript | 现有架构 |
| 状态管理 | use State + 自定义 hooks | 禁止 zustand |
| 样式 | CSS Modules | 现有架构 |
| 路由 | React Router v6 | 现有架构 |
| 拖拽 | 原生 Drag API | 轻量级方案 |
| 可视化 | Recharts / D3.js | 按需引入 |

### 8.2 关键实现细节

#### 8.2.1 Result Card 渲染

```typescript
// frontend/src/components/copilot/ResultCardMessage.tsx
export function ResultCardMessage({ 
  card, 
  onAction 
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

#### 8.2.2 Context Token 更新

```typescript
// frontend/src/hooks/useAgentContext.ts
export function useAgentContext(projectId: string) {
  const [contextToken, setContextToken] = useState<string | null>(null);
  const activeArtifact = useActiveArtifact();
  
  useEffect(() => {
    if (!activeArtifact) return;
    
    // 调用后端获取新的 context token
    fetchContextEnvelope({
      projectId,
      artifactId: activeArtifact.id,
      selection: activeArtifact.selection,
    }).then((envelope) => {
      setContextToken(envelope.contextToken);
    });
  }, [projectId, activeArtifact]);
  
  return { contextToken, activeArtifact };
}
```

### 8.3 后端适配

#### 8.3.1 Job 完成事件

```javascript
// src/mcp-server.js 扩展
server.on('job:completed', async (job) => {
  const artifact = await getArtifactByJobId(job.id);
  
  // 生成结果卡片消息
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
  
  await addMessageToConversation(job.conversation_id, cardMessage);
});
```

#### 8.3.2 Context Envelope 接口

```javascript
// src/mcp-server.js
mcpServer.tool('fetch_context_envelope', {
  description: '获取 Agent 上下文 envelope',
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

### 10.1 总体时间线

```
Phase 1: ████████████░░░░░░░░░░░░░░░░░░░░░░░░░ 2-3 人周
Phase 2: ░░░░░░░░░░░░░░░░████████████████████░░ 8-12 人周
Phase 3: ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████ 12-16 人周
```

### 10.2 里程碑

| 里程碑 | 日期 | 交付物 | 验收标准 |
|--------|------|--------|----------|
| M1 | Week 2 | P1.1 + P1.2 | 结果卡片可点击打开右侧面板 |
| M2 | Week 4 | P1.3 + P1.4 | 执行过程可见 + 参数确认卡片 |
| M3 | Week 8 | P2.1 + P2.2 | Artifact 预览增强 + Timeline |
| M4 | Week 12 | P2.3 + P2.4 | Skills 集成 + 链路推荐 |
| M5 | Week 20 | P3.1 + P3.2 | 多 Agent 协作 + 工作流编排 |
| M6 | Week 26 | P3.3 + P3.4 | 高级可视化 + 团队协作 |

### 10.3 Phase 1 详细验收

#### P1.1 结果卡片 MVP

**验收用例**：

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

#### P1.2 卡片与右侧联动

**验收用例**：

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

#### P1.3 执行进度可见性

**验收用例**：

```gherkin
功能: 执行进度展示
  场景: Agent 执行分析
    假设 用户发起分析请求
    当 Agent 正在执行
    那么 输入框上方显示执行进度
    并且 显示当前步骤 "正在运行 DEG 分析..."
    并且 步骤状态实时更新
```

#### P1.4 参数确认卡片

**验收用例**：

```gherkin
功能: 参数确认
  场景: 写操作前确认
    假设 用户请求删除数据
    当 Agent 准备执行删除
    那么 弹出参数确认卡片
    并且 显示将删除的文件
    并且 显示 "确认" 和 "取消" 按钮
```

---

## 11. 后续归档建议

### 11.1 待归档文档

以下文档代表已放弃的 IDE 改造方向，建议后续归档到 `docs/archive/`：

| 文件 | 建议操作 | 原因 |
|------|----------|------|
| `docs/ide-transformation-plan.md` | 归档 | IDE 改造计划已取消 |
| `docs/ide-research/mcp-ide-tools-design.md` | 归档 | 面向 IDE 的研究 |
| `docs/ide-research/monaco-integration-research.md` | 归档 | Monaco Editor 研究 |

**归档操作**（后续执行）：

```bash
# 创建归档目录（如果不存在）
mkdir -p docs/archive/ide-transformation-retired

# 移动文件
git mv docs/ide-transformation-plan.md docs/archive/ide-transformation-retired/
git mv docs/ide-research docs/archive/ide-transformation-retired/

# 提交
git add -A
git commit -m "docs: archive IDE transformation plan (retired direction)

The Agent Workbench Enhancement Plan (docs/agent-workbench-enhancement-plan.md)
replaces the IDE transformation direction. Monaco Editor integration and
traditional IDE features are not part of the BioF3 roadmap.

See docs/codex-style-workbench-direction.md for the new direction.
"
```

### 11.2 文档更新

归档后需要更新 `DOC-REGISTRY.json`：

1. 将 `IDE-TRANSFORMATION`、`IDE-MCP-TOOLS-DESIGN`、`IDE-MONACO-RESEARCH` 条目状态改为 `archived`
2. 新增 `AGENT-WORKBENCH` 条目（见下节）

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

## 附录 B：关键文件清单

### B.1 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/components/copilot/SimpleChat.tsx` | 新增 Result Card 渲染 |
| `frontend/src/components/copilot/ResultCardMessage.tsx` | 新建：结果卡片组件 |
| `frontend/src/pages/project-workspace.tsx` | 接入卡片点击处理 |
| `frontend/src/hooks/useAgentContext.ts` | 新建：Agent 上下文 hook |
| `src/mcp-server.js` | 新增 Job 完成事件处理 |
| `docs/DOC-REGISTRY.json` | 新增 AGENT-WORKBENCH 条目 |

### B.2 需要新建的文件

| 文件 | 说明 |
|------|------|
| `frontend/src/components/copilot/ResultCardMessage.tsx` | 结果卡片组件 |
| `frontend/src/components/copilot/ExecutionProgress.tsx` | 执行进度组件 |
| `frontend/src/components/copilot/ParamConfirmCard.tsx` | 参数确认卡片 |
| `frontend/src/hooks/useAgentContext.ts` | Agent 上下文 hook |
| `frontend/src/hooks/useArtifactPreviewRegistry.ts` | Artifact 预览注册表 |
| `docs/agent-workbench-enhancement-plan.md` | 本文档 |

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
