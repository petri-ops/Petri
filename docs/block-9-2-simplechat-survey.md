# BLOCK-9.2 PHASE 4 — `SimpleChat.tsx` 架构调研（第二轮）

**调研时间**：2026-08-18 00:45 (UTC+8)
**调研模式**：PHASE 4 架构调研 worker · **0 行代码改动 · 0 测试改动 · 0 commit**
**关联工作包**：`BLOCK-9.2-MEGA-FILE-REFACTOR`（PHASE 4）
**关联计划**：[`docs/block-9-2-mega-file-refactor-plan.md`](./block-9-2-mega-file-refactor-plan.md) §5 PHASE 4
**关联调研**：[`docs/block-9-2-mega-file-split-survey.md`](./block-9-2-mega-file-split-survey.md)（PHASE 0，1134 行）
**当前阶段纪律**：G0 长期开发期（`docs/AGENTS.md` §当前阶段纪律 · `qualificationEligible: false` 不外推）

---

## 0. 调研摘要（TL;DR）

**目标文件**：`frontend/src/components/copilot/SimpleChat.tsx` **2277 行**（baseline 2153 → post-c271010 +124 净增长 = 2277 行）

**重要前置状态**（必须先承认，避免重复开发）：
- commit `e599ee0 refactor(simplechat): UI-173 BLOCK-9.2 PHASE 4 — extract types + helpers` 已落地，**types.ts (189 行) + helpers.tsx (108 行) 已抽出**（位于 `frontend/src/components/copilot/SimpleChat/`）
- AUDIT-LOG 已收口 PHASE 4 + PHASE 5 + PHASE 6（2026-08-17）；但 commit `c271010 feat(copilot-chat): SimpleChat UI + workspace panels + skills index`（2026-08-18 00:08）在 closeout 后**新增 325 行**（含 23 个 useState + 6 个 useCallback + image attachment 子树）至 `SimpleChat.tsx`，**PHASE 4 的剩余抽取空间需要重做调研**

**关键发现**：
1. **2277 行 ≠ 2153 行**：PHASE 0 调研报告 + plan §5 PHASE 4 段均以 2153 为基线；当前文件比基线多 124 行，剩余**主组件约 2090 行**（2277 - 187 行 types+helpers 顶部 banner / re-export / import）
2. **真实 hook 实数 ≠ 86**：plan §5 PHASE 4 "86 hooks" 是 2153 行 baseline 时的旧数；当前实测 **70 个 hook 调用 + 9 个 custom hook 调用 = ~79 个 hook 引用**，分布在 `SimpleChat` 主组件内 64 个调用 + 5 个嵌套子组件 6 个调用
3. **image attachment 子树是新模块化候选**（`AttachmentFile` type + `attachments`/`isDraggingOver`/`previewImage` 3 state + 7 useCallback + `ImagePreviewModal` 子组件，~108 行），是 c271010 后唯一**未耦合主组件其他 state 的独立小宇宙**，最适合 P0 抽取
4. **主组件 hooks 顺序仍然强约束**（plan §5 PHASE 4 "86 hooks 顺序不能变"），但顺序约束本质上是 **React 规则约束**（hooks 必须在每次 render 用相同顺序调用），不依赖具体数字；抽取到自定义 hook 时必须保留调用顺序
5. **类型/常量/纯函数占比 13.0%**（types.ts 已抽 189 + helpers.tsx 已抽 108 = 297 / 2277）
6. **4 个 import 客户端 100% 兼容**：CenterPanel.tsx / RightPanel.tsx / ResultView.tsx / project-workspace.tsx 都通过 `@/components/copilot/SimpleChat` 导入 `SimpleChat` 命名导出，**e599ee0 的 re-export 兼容策略已 100% 验证为可行**，新一次抽取必须延续

**优先级矩阵**（详见 §4）：

| # | 候选 | 优先级 | 行数估算 | 风险 | 收益 | 依赖 |
|---|---|---|---|---|---|---|
| 1 | `ImagePreviewModal` 子树（P0 独立单元） | **P0** | ~108 行 → 独立模块 | **极低** | 高（移除 JSX + 2 hooks + 1 useEffect 离主组件） | `AttachmentFile` type 已内联在主组件 |
| 2 | `AttachmentFile` type + attachment state/handlers 集群 | **P0** | ~80 行 type+7 callbacks | **低** | 中（主组件瘦身 + attachment 逻辑独立测试） | #1 必须先行 |
| 3 | `helpers/` 抽取（5 个格式化 helpers） | **P1** | ~50 行 → `helpers/formatHarness.ts` | **极低** | 中（移除 5 个 function） | 0（独立） |
| 4 | `hooks/useChatStream.ts`（拆分 send/stop/regenerate/queue/runInBackground 5 个 callback） | **P2** | ~180 行 → 自定义 hook | **中** | 中（主组件瘦身 + stream 逻辑独立测试） | 0（独立，但需要谨慎处理 state 边界） |
| 5 | `components/MessageList.tsx` | **P2** | ~250 行 → 子组件 | **高** | 高（移除 render 整段 JSX） | 0（独立） |
| 6 | `components/InputBox.tsx` | **P3** | ~180 行 → 子组件 | **高** | 中 | 0（独立但 prop drilling 重） |
| 7 | `components/Toolbar.tsx` / `StatusBar.tsx` | **P3** | ~80 行 → 子组件 | **高** | 低 | 0（独立但 ROI 不足） |

**PHASE 4 第二轮建议**（详见 §8）：
- **commit 1**：`ImagePreviewModal` 子树 → `SimpleChat/attachments.tsx`
- **commit 2**：`helpers/formatHarness.ts`（5 个纯函数）→ `SimpleChat/helpers/formatHarness.ts`
- **commit 3**：`hooks/useChatStream.ts`（5 个 stream-related callback）→ `SimpleChat/hooks/useChatStream.ts`
- **commit 4**：可选 `MessageList` 子组件（如果 commit 1-3 后主组件仍 >1800 行）

---

## 1. 文件概览

### 1.1 当前行数

```bash
$ wc -l frontend/src/components/copilot/SimpleChat.tsx
2277 frontend/src/components/copilot/SimpleChat.tsx
```

**与 plan §5 PHASE 4 baseline 对比**：

| 阶段 | 行数 | 变化 |
|---|---|---|
| PHASE 0 调研（2026-08-17 07:46） | 2153 | baseline |
| `e599ee0` PHASE 4 第一次（types+helpers 抽取） | 1975 | **-178 / -8.3%** |
| `c271010` feat(copilot-chat) 新增 image attachment | **2277** | +302 净增 |
| 本次调研（PHASE 4 第二轮） | 2277 | 调研态 |

### 1.2 import 客户端数

**4 个生产 import 客户端**（plan §5 PHASE 4 边界已确认）：

```
frontend/src/components/workspace-panels/CenterPanel.tsx:2
  → import { SimpleChat } from '@/components/copilot/SimpleChat';

frontend/src/components/workspace-panels/RightPanel.tsx:2
  → import { SimpleChat } from '@/components/copilot/SimpleChat';

frontend/src/components/workspace-panels/ResultView.tsx:27
  → import { SimpleChat } from '@/components/copilot/SimpleChat';

frontend/src/pages/project-workspace.tsx:29
  → import { SimpleChat } from '@/components/copilot/SimpleChat';
```

**测试 mock 客户端**（2 个，与生产客户端不同 —— 它们 mock 整个模块）：

```
frontend/src/components/workspace-panels/ResultView.test.tsx:6
  → vi.mock('@/components/copilot/SimpleChat', () => ({ SimpleChat: () => <div>chat</div> }));

frontend/src/components/workspace-panels/CenterPanel.test.tsx:6
  → vi.mock('@/components/copilot/SimpleChat', () => ({ ... }));
```

**测试直接 import（消费 named exports）**（3 个 —— **必须 0 改动保证**）：

```
frontend/src/components/copilot/SimpleChat.extraRenderers.test.tsx:33
  → import { restoreSimpleMessage } from './SimpleChat';

frontend/src/components/copilot/SimpleChat.progress.test.ts:5
  → import { compactStageConclusion, ResultEditProgressList } from './SimpleChat';

frontend/src/components/copilot/simple-chat-file-open.test.ts:2
  → import { shouldOpenWithSystemApp } from './SimpleChat';
```

### 1.3 主组件名 / Props 形状 / default exports

**主组件名**：`SimpleChat`

**Props 形状**（已抽到 `SimpleChat/types.ts` `SimpleChatProps`）：

```typescript
interface SimpleChatProps {
  projectId: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  inputHeight?: number;
  /**
   * Whether this instance handles the copilotAsk event. Exactly one mounted
   * instance may, so it defaults to false and the owner opts in explicitly.
   */
  ownsCopilotAsk?: boolean;
}
```

**default exports**：**无**（e599ee0 后已统一为命名导出 + re-export 兼容）

**顶层命名导出**（按行号，2026-08-18 调研态）：

| 名称 | 类型 | 行号 | 来源 |
|---|---|---|---|
| `SlashCommand` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `SLASH_COMMANDS` | const | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `shouldOpenWithSystemApp` | function | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `restoreSimpleMessage` | function | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `SimpleMessage` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `AgentProgressUpdate` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `ExamplePrompt` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `ExamplePromptsProps` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `SimpleChatHandle` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `SimpleChatProps` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `ErrorBannerProps` | interface | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `PendingApproval` | type alias | `types.ts` (re-export L33) | `SimpleChat/types.ts` |
| `SimpleChat` | function | **L170**（主组件） | `SimpleChat.tsx` |
| `ResultEditProgressList` | function | **L1944** | `SimpleChat.tsx`（**内联嵌套子组件**） |
| `DEFAULT_EXAMPLE_PROMPTS` | const | `helpers.tsx` (re-export L42) | `SimpleChat/helpers.tsx` |
| `MessageMeta` | function | `helpers.tsx` (re-export L42) | `SimpleChat/helpers.tsx` |
| `ExamplePrompts` | function | `helpers.tsx` (re-export L42) | `SimpleChat/helpers.tsx` |
| `compactStageConclusion` | function | `helpers.tsx` (re-export L42) | `SimpleChat/helpers.tsx` |

### 1.4 子组件数量

**嵌套子组件（内联定义在 SimpleChat.tsx 内）**：8 个

| # | 名称 | 行号 | 是否 export | hook 数 | 状态 |
|---|---|---|---|---|---|
| 1 | `MessageMeta` | `helpers.tsx` (L33-55) | export（re-export） | 1 useState + 1 useEffect | **已抽** |
| 2 | `ExamplePrompts` | `helpers.tsx` (L60-83) | export（re-export） | 0 | **已抽** |
| 3 | `ImagePreviewModal` | **L1739-1847** | private | 1 useState + 1 useRef + 1 useEffect | **内联**（P0 候选） |
| 4 | `LoopStatusPanel` | **L1847-1905** | private | 1 useState | **内联** |
| 5 | `AgentProgressList` | **L1905-1944** | private | 0 | **内联** |
| 6 | `ResultEditProgressList` | **L1944-1971** | **export** | 0 | **内联**（被测试 import） |
| 7 | `ErrorBanner` | **L1971-2003** | private | 1 useState | **内联** |
| 8 | `ToolActivityList` | **L2003-2094** | private | 1 useState + 1 useEffect | **内联** |
| 9 | `ApprovalCard` | **L2145-2213** | private | 0 | **内联** |
| 10 | `ApprovalRepairHint` | **L2213-2277** | private | 0 | **内联** |

> **注**：表中 `MessageMeta` + `ExamplePrompts` 实际位于 `SimpleChat/helpers.tsx` 但通过 re-export 从主文件暴露，逻辑上仍是 SimpleChat 的子组件。

### 1.5 状态管理方式

**全部 useState / useRef / useEffect**（**未使用 zustand** · `AGENTS.md` §技术栈 纪律）

| 类别 | 数量 | 分布 |
|---|---|---|
| `useState` | 33 个 | 主组件 30 个 + 4 个嵌套子组件各 1 个（ImagePreviewModal/LoopStatusPanel/ErrorBanner/ToolActivityList） |
| `useRef` | 14 个 | 主组件 13 个 + ImagePreviewModal 1 个（imageRef） |
| `useEffect` | 24 个 | 主组件 22 个 + ImagePreviewModal 1 个 + ToolActivityList 1 个 |
| `useCallback` | 27 个 | 全部在主组件 |
| `useMemo` | 5 个 | 全部在主组件 |
| **小计** | **103** | 主组件 ~96 + 嵌套子组件 7 |

**custom hooks 调用**（9 个，按行号）：

| 行号 | Hook | 用途 |
|---|---|---|
| L229 | `useConversationRun(conversationId)` | 共享 conversation run 状态（来自 `conversationRunStore`） |
| L230 | `useSubAgentTasksForConversation(conversationId)` | sub-agent 任务列表 |
| L238 | `useDurableConversationLoop(projectId, conversationId, activeRun?.loop)` | durable loop 投影 |
| L245 | `useCopilotContext()` | React Context（来自 `copilotContextProvider`） |
| L258 | `useConversations(projectId)` | SWR 共享 conversation cache |
| L269 | `useAiSettings()` | AI 模型预设 |
| L272 | `useErrorFormatter()` | 错误格式化 |
| L278 | `useExtraRenderersFlag()` | 额外渲染器开关 |

### 1.6 IPC 订阅 / Context Provider 情况

**IPC 订阅位置**（`subscribePetriEvent` 调用）：

| 行号 | 调用 | 生命周期 |
|---|---|---|
| L307-318 | `dispatchPetriEvent(petriEvents.projectOpenArtifact, ...)` + `projectOpenWorkspaceFile` | inline 在 `handleFileReferenceClick` useCallback 内（fire-and-forget） |
| L826 | `subscribePetriEvent(petriEvents.copilotAsk, ...)` | `useEffect` 内订阅（L819-833），依赖 `ownsCopilotAsk` |
| L894 | `dispatchPetriEvent(petriEvents.conversationForked, ...)` | inline 在 `handleForkAt` useCallback 内 |

**结论**：**所有 IPC 订阅都在 `SimpleChat` 主组件生命周期内**，且都在 `useEffect` 或 `useCallback` 中 —— 没有独立的 IPC subscription hook 可抽；提取到子模块时必须保留订阅的 cleanup 逻辑。

**Context Provider 情况**：

| 类别 | 名称 | 来源 | SimpleChat 内的角色 |
|---|---|---|---|
| Consumer | `useCopilotContext()` | `@/lib/copilotContextProvider` | L245 消费 + L246 ref 同步 + L308/315 dispatch |
| Provider | 无 | — | SimpleChat **不提供** Context Provider |

**结论**：SimpleChat 是 Context consumer，不是 Provider。`copilotContextProvider` 在更高层（project-workspace）提供 —— 抽取 SimpleChat 子模块不会破坏 Provider/Consumer 关系。

---

## 2. 现状结构图（树形 ASCII）

```
frontend/src/components/copilot/SimpleChat.tsx (2277 行)
│
├── L1-14   FILE BANNER 注释（描述 SimpleChat 设计意图 + BLOCK-9.2 PHASE 4 抽取历史）
├── L16     import React, { useEffect, useRef, useState, useCallback, useMemo }
├── L19-32  import { ... } from './SimpleChat/types'        (types 抽取后的 import)
├── L34-41  import { ... } from './SimpleChat/helpers'      (helpers 抽取后的 import)
├── L42-50  export { SLASH_COMMANDS, ... } from './SimpleChat'  (re-export 兼容层)
├── L62-148 其他内部 imports (React/内部模块/@/lib/@/hooks)
│           代表性 export/line 例子：
│           - L62-69  `import { ... } from '@/lib/copilotContextProvider'`   (copilotCtx context)
│           - L75-79  `import { petriEvents, subscribePetriEvent, ... } from '@/lib/events'`
│           - L85-114 `import { ... } from './copilotClient'` / `./copilotConversationsClient`
│           - L127    `import { useDurableConversationLoop } from '@/hooks/useDurableConversationLoop'`
│
├── L150-167 类型声明（PHASE 4 仍残留的私有 type）
│   ├── L150 type ApprovalRepairState = ...    (PHASE 0 §1.2.2 已识别私有)
│   ├── L161 type AttachmentFile = { ... }      (c271010 新增（PHASE 0 调研时不存在）)
│   └── 代表：L150 `type ApprovalRepairState = { status: 'idle' | 'loading' | ... }`
│
├── L170-1733  SIMPLECHAT 主组件（1564 行）
│   ├── L177-205  33 个 useState + 4 个 useRef 集中声明（含 attachment state）
│   ├── L214-225  useMemo `filteredCommands`（slash 命令过滤）
│   ├── L228-275  custom hooks 调用层（useConversationRun / useSubAgentTasks / useDurableConversationLoop / useCopilotContext / useConversations / useAiSettings / useErrorFormatter / useExtraRenderersFlag）
│   ├── L285-330  file reference resolution effect（settledContext / resolveNonce / handleFileReferenceClick）
│   ├── L334-460  message loading & reconciliation（getConversationMessages / activeRun reconcile / resumable check）
│   ├── L467-560  send pipeline（send useCallback / sendRef / copilotAsk event subscription）
│   ├── L580-715  drag/drop & paste handlers（c271010 新增：handleDragOver/handleDragLeave/handleDrop/handlePaste/removeAttachment/openPreview/closePreview + resizeTextarea useCallback + resize useEffect）
│   ├── L715-735  auto-focus + focus-restore useEffects（ownsCopilotAsk gating）
│   ├── L751-810  `send` useCallback (60 行，PHASE 0 §1.2.5 已识别 RORP·核心)
│   ├── L818-840  copilotAsk 事件订阅 + copilotContextOverrideForAsk
│   ├── L843-870  `regenerate` useCallback
│   ├── L870-905  `handleFork` / `handleForkAt` useCallback (forkingAtIndex)
│   ├── L906-935  `runInBackground` useCallback
│   ├── L934-995  `retrySummary` useCallback + retry cooldown tick useEffect
│   ├── L1000-1050  `approvePending` / `rejectPending` useCallback + auto-approve useEffect
│   ├── L1050-1145  `onKeyDown` handler (slash nav + history nav + Enter to send) — 80+ 行
│   ├── L1115-1145  `queueCurrentPrompt` useCallback + queue tick useEffect
│   ├── L1137-1145  `newConversation` useCallback
│   ├── L1144-1200  `executeSlashCommand` useCallback + slash close-on-outside-click useEffect
│   ├── L1196-1250  model menu handlers（handleExampleSelect / examplePrompts / preferredPresetForSupplier / selectModel）
│   └── L1264-1733 RETURN JSX（470 行 / 2 个返回包裹 div）：
│       - L1264-1728 主 div.sc-root（messages + composer + toolbar）
│         - L1283-1464 `displayMessages.map((m, i) => ...)` 整段 message list 渲染
│         - L1466-1657 composer (textarea + drag/drop + attachments preview + slash panel + send/stop/queue buttons + model menu overlay)
│         - L1658-1725 queuedPrompts + subAgentTasks list + ImagePreviewModal 渲染
│
├── L1734-1846  ImagePreviewModal 子组件（private · P0 抽取候选）
│                  1 useState (zoom) + 1 useRef (imageRef) + 1 useEffect (Escape key listener)
│
├── L1847-1904  LoopStatusPanel 子组件（private）
│                  1 useState (expanded)
│
├── L1905-1943  AgentProgressList 子组件（private）
│                  0 hooks
│
├── L1944-1970  ResultEditProgressList 子组件（EXPORT — 测试 import）
│                  0 hooks
│
├── L1971-2002  ErrorBanner 子组件（private）
│                  1 useState (detailsExpanded)
│
├── L2003-2093  ToolActivityList 子组件（private）
│                  1 useState (expanded) + 1 useEffect (auto-collapse on empty)
│
├── L2094-2144  5 个纯 helper functions（P1 抽取候选）
│   ├── L2094 stringifyParamValue(value)
│   ├── L2104 shortValue(value)
│   ├── L2109 formatHarnessRepair(item)
│   ├── L2129 formatHarnessWarning(item)
│   └── L2138 formatHarnessDiagnosticIssue(issue)
│
├── L2145-2212  ApprovalCard 子组件（private）
│                  0 hooks（接收 `onApprove`/`onReject`/`busy` callbacks）
│
└── L2213-2277  ApprovalRepairHint 子组件（private）
                   0 hooks（pure props-driven 渲染）
```

**说明**：
- 标注 P0/P1 优先级抽取候选（详见 §4）
- 标注最大 JSX 段（message list map + composer + return JSX）—— 这些是 P2/P3 候选（依赖多 state / 风险高）
- `EXPORT` 标注必须保留的命名导出（被 3 个测试 + 1 个 page consumer 直接 import）

---

## 3. Hooks 顺序核查（plan §5 PHASE 4 边界：86 hooks 顺序不能变）

### 3.1 实际 hook 数

**plan §5 PHASE 4 段的 "86 hooks 顺序不能变" 是 2153 行 baseline 调研时的旧数字**（PHASE 0 §1.2.7 注释 `真实 hooks 调用数 ≈ 50+，与评审报告 "86 hooks" 数量级一致`，但已说明 86 是估算）。**实测当前状态**：

| 类型 | 总数 | 主组件内 | 嵌套子组件 |
|---|---|---|---|
| `useState` | 33 | 30 | 3（ImagePreviewModal/LoopStatusPanel/ErrorBanner/ToolActivityList 各 1） |
| `useCallback` | 27 | 27 | 0 |
| `useEffect` | 24 | 22 | 2（ImagePreviewModal L1743 + ToolActivityList L2019） |
| `useRef` | 14 | 13 | 1（ImagePreviewModal imageRef L1741） |
| `useMemo` | 5 | 5 | 0 |
| **`hook 调用合计`** | **103** | **97** | **6** |
| custom hooks 调用 | 9 | 9 | 0 |
| `import` 行（line 16 等） | 5 | — | — |
| **总 grep 命中** | **117** | — | — |

**结论**：**70 个 hook 调用**（实测 70 个 `useXxx(` 调用），其中 **主组件内 64 个**、**嵌套子组件 6 个**。PHASE 4 抽取后 hooks 数量不会减少（hook 调用必须留在组件内或迁移到子组件 / 自定义 hook 中）。

### 3.2 主组件 hook 顺序详细列表（按调用顺序）

> **重要**：React 要求"hooks 必须在每次 render 用相同顺序调用"，这是 **调用顺序约束** 而不是 **数量约束**。
> 抽取到自定义 hook 时，必须保留相对调用顺序（在同一个组件内）。

| # | 行号 | Hook | 依赖 | 用途（1 句话） |
|---|---|---|---|---|
| 1 | 177 | `useState<SimpleMessage[]>([])` | initial | messages 主列表 |
| 2 | 178 | `useState<string \| null>(null)` | initial | 复制的消息 key |
| 3 | 179 | `useState('')` | initial | textarea input |
| 4 | 180 | `useState(false)` | initial | starting（send 进行中） |
| 5 | 181 | `useState<string[]>([])` | initial | queuedPrompts |
| 6 | 182 | `useState<AttachmentFile[]>([])` | initial | attachments（c271010 新增） |
| 7 | 183 | `useState(false)` | initial | isDraggingOver（c271010 新增） |
| 8 | 184 | `useState<AttachmentFile \| null>(null)` | initial | previewImage（c271010 新增） |
| 9 | 187 | `useState<Record<...>>({})` | initial | summaryRetryState |
| 10 | 188 | `useState<Record<...>>({})` | initial | summaryRetryErrors |
| 11 | 189 | `useState<Record<...>>({})` | initial | summaryRetryAttempts |
| 12 | 190 | `useState<Record<...>>({})` | initial | summaryRetryCooldownUntil |
| 13 | 191 | `useState(0)` | initial | retryTick |
| 14 | 192 | `useState(false)` | initial | loading（getConversationMessages 进行中） |
| 15 | 194 | `useState(false)` | initial | refreshing |
| 16 | 195 | `useState<Record<...>>({})` | initial | paramDraft |
| 17 | 196 | `useState<ApprovalRepairState>({ status: 'idle' })` | initial | approvalRepair |
| 18 | 197 | `useRef<string \| null>(null)` | initial | autoApproveRef（pendingApproval ackToken 记录） |
| 19 | 198 | `useState<...>(null)` | initial | modelMenuOpen |
| 20 | 199 | `useState<string \| null>(null)` | initial | modelSupplierKey |
| 21 | 200 | `useState(false)` | initial | accessMenuOpen |
| 22 | 201 | `useState<'full' \| 'read'>('full')` | initial | accessMode |
| 23 | 202 | `useState(false)` | initial | forking |
| 24 | 204 | `useState<number \| null>(null)` | initial | forkingAtIndex（c271010 新增） |
| 25 | 205 | `useRef<HTMLTextAreaElement>(null)` | initial | taRef（textarea DOM ref） |
| 26 | 206 | `useRef<HTMLDivElement>(null)` | initial | scrollRef（messages scroll container ref） |
| 27 | 208 | `useState(false)` | initial | slashOpen |
| 28 | 209 | `useState('')` | initial | slashQuery |
| 29 | 210 | `useState(0)` | initial | slashFocusedIndex |
| 30 | 211 | `useRef<HTMLDivElement>(null)` | initial | slashPanelRef |
| 31 | 212 | `useRef<HTMLDivElement>(null)` | initial | slashListRef |
| 32 | 214 | `useMemo(() => ...)` | [slashQuery, SLASH_COMMANDS] | filteredCommands |
| 33 | 223 | `useRef<SimpleMessage[]>(messages)` | initial | messagesRef（send 闭包用最新 messages） |
| 34 | 224 | `useEffect(() => { messagesRef.current = messages; }, [messages])` | [messages] | messagesRef 同步 effect |
| 35 | 228 | `useRef<typeof INITIAL_NAV_STATE>(INITIAL_NAV_STATE)` | initial | historyNavRef |
| 36 | 229 | (custom) `useConversationRun(conversationId)` | [conversationId] | 共享 conversation run 状态 |
| 37 | 230 | (custom) `useSubAgentTasksForConversation(conversationId)` | [conversationId] | sub-agent 任务列表 |
| 38 | 234 | `useEffect(() => { resumeOrphanAgentTasks(conversationId, projectId) }, [conversationId, projectId])` | [conversationId, projectId] | resume orphan agent tasks |
| 39 | 238 | (custom) `useDurableConversationLoop(projectId, conversationId, activeRun?.loop)` | [projectId, conversationId, activeRun?.loop] | durable loop 投影 |
| 40 | 245 | (custom) `useCopilotContext()` | — | React Context |
| 41 | 246 | `useRef<CopilotContext>(copilotCtx)` | initial | copilotCtxRef |
| 42 | 247 | `useEffect(() => { copilotCtxRef.current = copilotCtx; }, [copilotCtx])` | [copilotCtx] | copilotCtxRef 同步 effect |
| 43 | 258 | (custom) `useConversations(projectId)` | [projectId] | SWR conversation cache |
| 44 | 269 | (custom) `useAiSettings()` | — | AI 模型预设 |
| 45 | 272 | (custom) `useErrorFormatter()` | — | 错误格式化 |
| 46 | 278 | (custom) `useExtraRenderersFlag()` | — | 额外渲染器开关 |
| 47 | 285 | `useState<ExtractContext \| null>(null)` | initial | settledContext（file reference resolver） |
| 48 | 286 | `useState(0)` | initial | resolveNonce |
| 49 | 287 | `useRef<string \| null>(conversationId)` | initial | settledConvRef |
| 50 | 288 | `useEffect(() => { conv-switch clear }, [conversationId])` | [conversationId] | conv switch clear effect |
| 51 | 295 | `useEffect(() => { setSettledContext({ projectId }) }, [loading, projectId])` | [loading, projectId] | project context resolve effect |
| 52 | 303 | `useCallback(handleFileReferenceClick, ...)` | [projectId] | 文件引用点击 handler |
| 53 | 322 | `useCallback(copyMessage, ...)` | [projectId, messages, conversationId, ...] | 复制消息 callback |
| 54 | 334 | `useEffect(() => { clipboard fallback check }, [])` | [] | clipboard capability check (空依赖) |
| 55 | 346 | `useEffect(() => { paramDraft sync from pendingApproval }, [pendingApproval])` | [pendingApproval] | paramDraft 同步 effect |
| 56 | 435 | `useEffect(() => { approvalRepair fetch }, [pendingApproval, projectId])` | [pendingApproval, projectId] | harness repair 检测 |
| 57 | 457 | `useRef<string \| null>(null)` | initial | reconciledRunRef |
| 58 | 458 | `useEffect(() => { reconcile from SQLite }, [...])` | [...] | reconcile run effect |
| 59 | 486 | `useRef<string \| null>(null)` | initial | resumableCheckedRef |
| 60 | 487 | `useEffect(() => { resumable check }, [conversationId])` | [conversationId] | resumable check effect |
| 61 | 560 | `useMemo(() => lastAssistantContent, [...])` | [...] | 最后一条 assistant 消息 |
| 62 | 564 | `useMemo(() => hasFileReferences, [...])` | [...] | 是否有文件引用 |
| 63 | 570 | `useEffect(() => { displayMessages forking split }, [...])` | [...] | fork split effect |
| 64 | 580 | `useCallback(resizeTextarea, [])` | [] | textarea resize callback |
| 65 | 587 | `useEffect(() => { auto-resize on input change }, [...])` | [...] | auto-resize effect |
| 66 | 591 | `useEffect(() => { auto-resize on conversation switch }, [...])` | [...] | conversation switch resize |
| 67 | 617 | `useCallback(handleDragOver, [])` | [] | c271010 drag over handler |
| 68 | 625 | `useCallback(handleDragLeave, [])` | [] | c271010 drag leave handler |
| 69 | 637 | `useCallback(handleDrop, [])` | [] | c271010 drop handler |
| 70 | 657 | `useCallback(handlePaste, [])` | [] | c271010 paste handler |
| 71 | 691 | `useCallback(removeAttachment, [])` | [] | c271010 remove attachment |
| 72 | 702 | `useCallback(openPreview, [])` | [] | c271010 open preview |
| 73 | 707 | `useCallback(closePreview, [])` | [] | c271010 close preview |
| 74 | 715 | `useEffect(() => { auto-focus on mount }, [ownsCopilotAsk])` | [ownsCopilotAsk] | mount focus effect |
| 75 | 723 | `useEffect(() => { focus restore on window focus }, [ownsCopilotAsk, ...])` | [...] | focus restore effect |
| 76 | 751 | `useCallback(send, [...])` | [accessMode, activeModel, ..., send, streaming] | 主 send pipeline |
| 77 | 811 | `useRef(send)` | initial | sendRef |
| 78 | 812 | `useEffect(() => { sendRef.current = send }, [send])` | [send] | sendRef sync effect |
| 79 | 819 | `useEffect(() => { subscribePetriEvent(copilotAsk) }, [...])` | [...] | copilotAsk 事件订阅 |
| 80 | 837 | `useCallback(stop, [])` | [] | stop generation |
| 81 | 843 | `useCallback(regenerate, [...])` | [conversationId, streaming, displayMessages, sendRef] | regenerate |
| 82 | 861 | `useCallback(handleRefresh, [])` | [] | refresh conversation |
| 83 | 870 | `useCallback(handleFork, [...])` | [projectId, conversationId, ...] | fork |
| 84 | 885 | `useCallback(handleForkAt, [...])` | [projectId, conversationId, ...] | fork at message |
| 85 | 906 | `useCallback(runInBackground, [...])` | [conversationId, input, projectId, streaming, ...] | run in background |
| 86 | 934 | `useCallback(retrySummary, [...])` | [summaryRetryState, ...] | retry summary callback |
| 87 | 991 | `useEffect(() => { retry tick }, [...])` | [...] | retry tick effect |
| 88 | 1000 | `useCallback(approvePending, [...])` | [conversationId, paramDraft, pendingApproval, projectId, send, streaming] | approve pending |
| 89 | 1022 | `useCallback(rejectPending, [...])` | [conversationId, pendingApproval, projectId, send, streaming] | reject pending |
| 90 | 1033 | `useEffect(() => { auto-approve timer }, [...])` | [...] | auto-approve effect |
| 91 | 1115 | `useCallback(queueCurrentPrompt, [...])` | [conversationId, input, projectId, streaming, ...] | queue prompt |
| 92 | 1127 | `useEffect(() => { queue drain }, [...])` | [...] | queue drain effect |
| 93 | 1137 | `useCallback(newConversation, [...])` | [onConversationChange, projectId, ...] | new conversation |
| 94 | 1144 | `useCallback(executeSlashCommand, [...])` | [newConversation, projectId, conversationId, displayMessages] | slash command executor |
| 95 | 1183 | `useEffect(() => { slash outside click }, [slashOpen])` | [slashOpen] | slash outside click effect |
| 96 | 1196 | `useCallback(handleExampleSelect, [...])` | [projectId, conversationId] | example prompt select |
| 97 | 1203 | `useMemo(() => DEFAULT_EXAMPLE_PROMPTS, [])` | [] | example prompts |
| 98 | 1239 | `useCallback(preferredPresetForSupplier, [...])` | [...] | preferred model preset |
| 99 | 1247 | `useCallback(selectModel, [...])` | [setActiveModelId] | select model |

### 3.3 拆分后 hooks 归属

#### 跟随主组件（不能拆）

**理由**：hook 之间通过 ref（如 `messagesRef`/`taRef`/`scrollRef`/`slashPanelRef`/`sendRef`）和 closure（如 `send` 引用 `accessMode`/`activeModel`/`createConversationForRun`）**强耦合**，必须留在同一组件内以保证 ref 同步和闭包捕获最新值。

**主组件必须保留的 hook 类别**：

| hook 类型 | 数量 | 原因 |
|---|---|---|
| 主消息/输入 state | L177-184（messages/input/starting/queuedPrompts/attachments/isDraggingOver/previewImage）7 个 | 与 taRef / resizeTextarea / onKeyDown 强耦合 |
| summaryRetry 状态族 | L187-191 5 个 | retrySummary callback 依赖 |
| loading/refreshing/paramDraft/approvalRepair | L192/194/195/196 4 个 | reconcile effect 依赖 |
| autoApproveRef + model/access/fork state | L197-204 8 个 | model menu / handleFork 依赖 |
| textarea refs (taRef/scrollRef) | L205-206 2 个 | resizeTextarea / handlePaste / openPreview 引用 |
| slash state + refs | L208-212 5 个 | slash panel 渲染 + outside click effect |
| messagesRef + sync effect | L223-224 2 个 | send 闭包引用 |
| historyNavRef | L228 1 个 | onKeyDown 引用 |
| custom hooks 调用 | L229/230/238/245/258/269/272/278 8 个 | 共享状态 + Context |
| copilotCtxRef + sync | L246-247 2 个 | send 闭包引用 |
| settledConvRef + file reference effects | L285-295 4 个 | file reference resolver |
| paramDraft sync + approvalRepair fetch | L334/346/435 3 个 | approve/reject callback 依赖 |
| reconciledRunRef + resumableCheckedRef + effects | L457/458/486/487 4 个 | reconcile 流程 |
| lastAssistantContent / hasFileReferences memos | L560/564 2 个 | regenerate 依赖 |
| displayMessages fork split effect | L570 1 个 | handleFork 依赖 |
| resizeTextarea + 2 useEffects | L580/587/591 3 个 | taRef 依赖 |
| **drag/drop/paste handlers** | L617-707 7 个 | c271010 新增，可下沉到 P0-1 自定义 hook |
| **auto-focus / focus-restore** | L715/723 2 个 | ownsCopilotAsk gating |
| **send + sendRef + sync + copilotAsk subscribe** | L751/811/812/819 4 个 | 可下沉到 P1-1 useChatStream |
| **stop/regenerate/handleRefresh/handleFork/handleForkAt** | L837/843/861/870/885 5 个 | regenerate 可下沉，handleFork/handleForkAt 涉及 forkingAtIndex 可下沉 |
| **runInBackground/retrySummary** | L906/934 2 个 | 可下沉到 P1-1 |
| **approvePending/rejectPending/auto-approve effect** | L1000/1022/1033 3 个 | approvalRepair state 依赖 |
| **queueCurrentPrompt + queue drain effect** | L1115/1127 2 个 | 可下沉到 P1-1 |
| **newConversation/executeSlashCommand/slash outside click/handleExampleSelect/examplePrompts/preferredPresetForSupplier/selectModel** | L1137-1247 8 个 | 全部留主组件 |

**预计保留在主组件的 hook 数**：~96 个（其中 ~15 个可下沉到 P1-1 useChatStream）

#### 可随子组件下沉（无需主组件协调）

| 子组件 | 跟随子组件的 hook | 行号 |
|---|---|---|
| `ImagePreviewModal` | `useState(zoom)` + `useRef(imageRef)` + `useEffect(Escape key listener)` | L1740-1743 |
| `LoopStatusPanel` | `useState(expanded)` | L1854 |
| `ErrorBanner` | `useState(detailsExpanded)` | L1972 |
| `ToolActivityList` | `useState(expanded)` + `useEffect(auto-collapse on empty)` | L2010/2019 |

#### 可随自定义 hook 上抽（**P0/P1/P2 候选**）

| hook | 自定义 hook 名 | 优先级 |
|---|---|---|
| L182-L184 + L617-L707 attachment state + handlers + ImagePreviewModal | `useAttachments()` + `attachments.tsx` 模块 | **P0** |
| L2094-L2143 5 个纯函数 helpers | `helpers/formatHarness.ts` | **P1** |
| L751-L933 send/stop/regenerate/queue/runInBackground/retrySummary + L818-L840 copilotAsk subscribe + L1115-L1135 queue | `useChatStream()` 自定义 hook | **P2** |
| L303-L330 handleFileReferenceClick + L285-L295 settledContext/resolveNonce + L287 settledConvRef + L288/L295 effects | `useFileReferences(projectId)` | **P2** |

**注意**：自定义 hook 抽取时必须保留 **hook 调用顺序** —— 也就是说，如果 `useChatStream` 包含 6 个 useCallback + 3 个 useEffect + 1 个 useRef + 1 个 sendRef sync useEffect，**它在主组件中调用的位置就是 L751-L933**，**不能放到 L177 之前**。

---

## 4. 拆分候选清单（P0 / P1 / P2 / P3）

### 4.1 P0（必拆，边界最清晰）

#### P0-1：`ImagePreviewModal` 子组件 + `AttachmentFile` type + attachment state/handlers 集群

**目标位置**：`frontend/src/components/copilot/SimpleChat/attachments.tsx`

**预计抽取**：
- `AttachmentFile` type（L161-167，约 7 行）
- `attachments`/`isDraggingOver`/`previewImage` 3 个 useState（L182/183/184）
- `handleDragOver`/`handleDragLeave`/`handleDrop`/`handlePaste`/`removeAttachment`/`openPreview`/`closePreview` 7 个 useCallback（L617-L707）
- `ImagePreviewModal` 子组件（L1734-1847，含 1 useState + 1 useRef + 1 useEffect）
- composer JSX 片段（L1466-1469 onDrag/onDrop/onPaste + L1471-1513 attachments preview）
- ImagePreviewModal 渲染（L1724-1728）

**预计抽出**：~108 行（type 7 + state 3 + handlers 7×5=35 + ImagePreviewModal 108 - 一些 import + attachment preview JSX 30 ≈ **~170 行**）

**边界清晰度**：
- 独立单元：只依赖 `AttachmentFile` type + `closePreview` callback
- 0 prop drilling：`attachments`/`previewImage` state 可下沉到自定义 hook，子组件只接收 props
- 0 IPC 依赖：附件处理不涉及 IPC / Context Provider
- 0 测试覆盖：现有 4 个 SimpleChat 测试不直接测附件功能（grep `attach|AttachmentFile` 在 `*.test.*` 中为 0 命中）

**风险**：极低。新建文件 + 主组件改 import + 顶部 banner 注释更新。

**预期实现模式**：
```typescript
// SimpleChat/attachments.tsx
export interface AttachmentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  previewUrl?: string;
}

export interface UseAttachmentsResult {
  attachments: AttachmentFile[];
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>;
  isDraggingOver: boolean;
  setIsDraggingOver: React.Dispatch<React.SetStateAction<boolean>>;
  previewImage: AttachmentFile | null;
  setPreviewImage: React.Dispatch<React.SetStateAction<AttachmentFile | null>>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  removeAttachment: (id: string) => void;
  openPreview: (attachment: AttachmentFile) => void;
  closePreview: () => void;
}

export function useAttachments(): UseAttachmentsResult { ... }

export function AttachmentsPreview({
  attachments,
  onPreview,
  onRemove,
}: AttachmentsPreviewProps): React.ReactElement { ... }

export function ImagePreviewModal({
  attachment,
  onClose,
}: ImagePreviewModalProps): React.ReactElement { ... }
```

### 4.2 P1（应拆，但需要谨慎处理 state 协调）

#### P1-1：`hooks/useChatStream.ts`（send/stop/regenerate/queue/runInBackground）

**目标位置**：`frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts`

**预计抽取**：
- `send` useCallback（L751-810，含 sendRef sync effect L811-816 + copilotAsk subscribe L819-835）
- `stop` useCallback（L837-841）
- `regenerate` useCallback（L843-860）
- `runInBackground` useCallback（L906-933）
- `queueCurrentPrompt` useCallback（L1115-1125）+ queue drain effect（L1127-1135）

**预计抽出**：~180 行

**风险**：**中**。`send` 是核心 callback，被 `regenerate`/`handleFork`/`handleForkAt`/`approvePending`/`rejectPending`/`runInBackground`/`queueCurrentPrompt`/`handleRefresh` 8+ 个 callback 引用。如果抽取到自定义 hook：
- 选项 A：自定义 hook **返回** `send`/`stop`/`regenerate`/`runInBackground`/`queueCurrentPrompt` 5 个 callback —— 主组件解构使用，但 sendRef 跨 hook 边界
- 选项 B：自定义 hook **不返回**，而是在内部 `useEffect` 订阅 copilotAsk event，自己调用 send —— 主组件只关心 regenerate/queue 调用

**推荐**：选项 B（hook 内部自治），降低主组件复杂度，但需要小心确保 send/stop 仍是单一可信源。

**依赖梳理**（send 内部）：
- `accessMode` (state)
- `activeModel` (from useAiSettings)
- `activeModelId` (from useAiSettings)
- `conversationId` (prop)
- `createConversationForRun` (from useConversations)
- `messages` (state via messagesRef)
- `onConversationChange` (prop)
- `projectId` (prop)
- `streaming` (derived: starting || activeRun?.status === 'running')
- 历史 cleanup：clearConversationDraft / migrateConversationDraft
- `startConversationRun` (from copilotClient)
- `isConversationRunning` (from copilotClient)

#### P1-2：`helpers/formatHarness.ts`（5 个纯函数 helpers）

**目标位置**：`frontend/src/components/copilot/SimpleChat/helpers/formatHarness.ts`

**预计抽取**：
- `stringifyParamValue`（L2094-2102）
- `shortValue`（L2104-2107）
- `formatHarnessRepair`（L2109-2127）
- `formatHarnessWarning`（L2129-2136）
- `formatHarnessDiagnosticIssue`（L2138-2143）

**预计抽出**：~50 行（含 import）

**边界清晰度**：
- 纯函数：0 React / 0 副作用 / 0 state 依赖
- 已被 ApprovalCard（L2183-2198）+ ApprovalRepairHint（L2231-2257）使用，可独立测试

**风险**：极低。新建文件 + 主组件改 import。

### 4.3 P2（可拆但需要新增 hook 协调）

#### P2-1：`components/MessageList.tsx`

**预计抽出**：~250 行（L1283-1464 `displayMessages.map((m, i) => ...)`）

**props 列表**：
- `displayMessages: SimpleMessage[]`
- `loading: boolean`
- `streaming: boolean`
- `extraRenderersFlag: boolean`
- `formatError: (content: string) => {...}`
- `getTechnicalDetails: (content: string) => string | undefined`
- `resolveContext: ExtractContext | null`
- `resolveNonce: number`
- `onFileReferenceClick: (detail: FileReferenceClickDetail) => void`
- `summaryRetryState: Record<string, 'running' | 'done'>`
- `handleSummaryRetry: (toolJobId: string) => void`（推测当前是 inline IIFE）

**风险**：**高**。15+ 个 props，prop drilling 重。但每个 prop 都是必要的（MessageList 是纯渲染组件）。

#### P2-2：`components/InputBox.tsx`（composer + slash panel + attachments + send button）

**预计抽出**：~180 行（L1435-1657 composer）

**依赖梳理**：~10 state + ~6 useCallback + taRef/scrollRef —— **prop drilling 极重**。

**风险**：**高**。

### 4.4 P3（保留不拆，强耦合）

#### P3-1：`components/Toolbar.tsx` / `components/StatusBar.tsx`（model menu + queue counter + sub-agent task list）

**预计抽出**：~80 行（L1572-1657 model menu + L1658-1725 queue + sub-agent）

**风险**：**高**。model menu 强耦合 `modelGroups`/`activeModel`/`setModelMenuOpen` 等 ~8 个 state。

#### P3-2：主组件 JSX 中 `displayMessages.map(...)` 拆 `MessageItem`

**预计抽出**：每条 message 渲染 ~30 行 × 多个 case。

**风险**：**极高**。每条 message 渲染条件复杂（toolActivities / progressUpdates / resultEditProgress / resultNodes / error / summaryUnavailable / loop 等），且依赖大量外层 props。

#### P3-3：`ApprovalCard` / `ApprovalRepairHint` 子组件抽取

**预计抽出**：~120 行（L2145-2277）

**风险**：**中**。但与 `formatHarness*` helpers 强耦合 —— 必须 P1-2 先抽 helpers，再做此抽取。

---

## 5. 风险点

### 5.1 跨子组件共享 state（需 prop drill 还是 lift up）

**严重耦合项**（**仍需 lift up 到主组件**）：

| state | 用途 | 消费者 |
|---|---|---|
| `messages` | 主消息列表 | send / regenerate / handleRefresh / resolveFileReference / onKeyDown(↑↓ history) |
| `input` | textarea 输入 | onKeyDown / send / queueCurrentPrompt / runInBackground |
| `messagesRef` | send 闭包 | send |
| `sendRef` | copilotAsk subscribe 闭包 | regenerate / copilotAsk subscribe |
| `taRef` | textarea DOM | resizeTextarea / openPreview / focus-restore |
| `scrollRef` | message scroll container | （无 hook 消费，render 内直接 ref.current.scrollTop 调整） |
| `copilotCtxRef` | send 闭包 | send |
| `streaming` | derived | send / approvePending / rejectPending / regenerate / queueCurrentPrompt / runInBackground / auto-approve effect / onKeyDown |
| `activeRun` | conversation run 状态 | send / regenerate / reconcile / retrySummary / copilotAsk subscribe |

**结论**：~10 个 state/ref 必须留在主组件（lift up），通过 props 传给子组件。P0 抽取（attachments.tsx）只需 lift up 1 个 callback（`closePreview`）；P2 MessageList 抽取需 lift up 15 个 props。

### 5.2 hooks 顺序约束

**约束本质**：React 要求 hooks 在每次 render 用相同顺序调用。**只要抽取到自定义 hook 时仍保持调用顺序相对位置，就满足约束**。

**P0-1 attachments 抽取后的顺序**：
- 主组件 hook 调用保持原顺序（L177-L184 → L187-L212 → ...）
- `useAttachments()` 自定义 hook 在 L617 附近调用（替换原 7 个 useCallback）
- `useAttachments()` 内部 hook 顺序由它自己决定

**P1-2 formatHarness helpers 抽取**：不涉及 hook 顺序变化（纯函数，无 hook）

**P1-1 useChatStream 抽取**：
- 主组件中 hook 调用保持原顺序
- `useChatStream()` 自定义 hook 在 L751 附近调用（替换 send/stop/regenerate/queue/runInBackground 5 个 useCallback + 2 个 useEffect + 1 个 useRef + 1 个 sendRef sync useEffect）

### 5.3 IPC 订阅位置

**3 个 IPC 引用**：

| 行号 | 引用 | 当前位置 | 抽取后位置 |
|---|---|---|---|
| L307-318 | `dispatchPetriEvent(projectOpenArtifact/...)` | inline in handleFileReferenceClick useCallback | 保留主组件（属于 file reference resolver） |
| L826 | `subscribePetriEvent(copilotAsk)` | useEffect 内 | 保留主组件（依赖 ownsCopilotAsk gating） |
| L894 | `dispatchPetriEvent(conversationForked)` | inline in handleForkAt useCallback | 保留主组件（属于 handleForkAt） |

**结论**：所有 IPC 引用都耦合主组件 state（ownsCopilotAsk / pendingApproval / projectId），**不能抽取到独立文件**。所有 IPC subscribe/unsubscribe 必须在主组件生命周期内。

### 5.4 Context Provider 嵌套

**SimpleChat 自身是 Context Consumer，不是 Provider**（见 §1.6）。`copilotContextProvider` 在更高层（`project-workspace.tsx`）提供。

**结论**：抽取 SimpleChat 子模块**不会**改变 Context Provider/Consumer 关系。

### 5.5 现有测试覆盖范围

**直接测试 SimpleChat 的文件**（5 个）：

| 文件 | 行数 | 范围 | 命名导入 | 影响 |
|---|---|---|---|---|
| `SimpleChat.test.tsx` | 95 | tool-summary presentation | `toolActivity` / `toolSummaryPresentation`（**不直接 import SimpleChat**） | 0 |
| `SimpleChat.progress.test.ts` | 45 | ResultEditProgressList | `compactStageConclusion, ResultEditProgressList` from `./SimpleChat` | 必须保留 |
| `SimpleChat.extraRenderers.test.tsx` | 252 | extraRenderers bridge | `restoreSimpleMessage` from `./SimpleChat` | 必须保留 |
| `simple-chat-file-open.test.ts` | 44 | shouldOpenWithSystemApp | `shouldOpenWithSystemApp` from `./SimpleChat` | 必须保留 |
| `simple-chat-model-menu.test.ts` | 27 | model menu CSS regression | `fs` only | 0 |
| `simple-chat-markdown-style.test.ts` | 39 | markdown style regression | `fs` only | 0 |

**间接测试 SimpleChat 的文件**（2 个 mock）：

| 文件 | 行数 | mock 模式 |
|---|---|---|
| `ResultView.test.tsx` | — | `vi.mock('@/components/copilot/SimpleChat', () => ({ SimpleChat: () => <div>chat</div> }))` |
| `CenterPanel.test.tsx` | — | `vi.mock('@/components/copilot/SimpleChat', () => ({ ... }))` |

**结论**：直接测试覆盖了 `restoreSimpleMessage`/`shouldOpenWithSystemApp`/`compactStageConclusion`/`ResultEditProgressList` 4 个 named export。**任何抽取都必须保留这 4 个 named export 的 re-export**（沿用 e599ee0 的 re-export 兼容策略）。

### 5.6 已知边界风险

| 风险 | 描述 | 缓解 |
|---|---|---|
| 主组件行数下行幅度受限 | P0-1 + P1-1 + P1-2 全部抽取后预计主组件从 2090 → ~1700 行（-19%），不如 PHASE 1 (DesktopSettingsPanel -43%) | 接受保守拆分；超出 1500 行阈值再启动 BLOCK-9.5+ 单独工作包 |
| attachment JSX 与 composer JSX 紧密耦合 | `AttachmentsPreview` 嵌在 textarea 上方，无法纯函数拆出 | 用 `<AttachmentsPreview ... />` 子组件替换 inline JSX，保持 DOM 结构 |
| send 闭包依赖 12+ state | P1-1 useChatStream 抽取需传递大量依赖 | 选项 B：hook 内部自治，只暴露 5 个 callback |
| c271010 新增 state 未在 PHASE 0 调研范围 | types.ts + helpers.tsx 已抽走的是 PHASE 0 调研时的类型；attachment 是 PHASE 0 后才加的 | 本次调研识别 attachments 子树为 P0 抽取目标 |

---

## 6. 拆分后净瘦身估算

### 6.1 当前状态（调研时）

| 模块 | 行数 | 占比 |
|---|---|---|
| `SimpleChat.tsx` | 2277 | 100% |
| `SimpleChat/types.ts`（已抽） | 189 | — |
| `SimpleChat/helpers.tsx`（已抽） | 108 | — |
| **主组件实际行数** | **~2090** | **91.8%** |

### 6.2 PHASE 4 第二轮抽取后预估

**P0-1（attachments）+ P1-1（useChatStream）+ P1-2（formatHarness）全部完成后**：

| 模块 | 行数（预估） | 变化 |
|---|---|---|
| `SimpleChat.tsx`（主组件） | **~1700** | **-370 / -17.7%** |
| `SimpleChat/attachments.tsx`（新增） | ~180 | +180 |
| `SimpleChat/helpers/formatHarness.ts`（新增） | ~55 | +55 |
| `SimpleChat/hooks/useChatStream.ts`（新增） | ~190 | +190 |
| `SimpleChat/types.ts`（已抽） | 189 | 0 |
| `SimpleChat/helpers.tsx`（已抽） | 108 | 0 |
| **总行数** | **~2422** | +145（净增，包含新文件的 import/header/banner 注释） |

> **行数下行方向**：主组件从 ~2090 → ~1700（**-19%**），但**总行数因新文件的 header/import 略有上升**（这是类型安全的代价，符合 BLOCK-9 / BLOCK-9.1 范式）。

### 6.3 推荐 commit 拆分粒度

**推荐 3 个 commit（而非一次性大提交）**：

| commit | 范围 | 预计行数变化 | 风险 | 可独立验证 |
|---|---|---|---|---|
| commit 1 | P0-1：attachments.tsx（含 ImagePreviewModal + AttachmentFile type + 7 handler + 3 state） | 主组件 -170 + 新文件 +180 | 极低 | 是 |
| commit 2 | P1-2：helpers/formatHarness.ts（5 个纯函数） | 主组件 -50 + 新文件 +55 | 极低 | 是 |
| commit 3 | P1-1：hooks/useChatStream.ts（5 callback） | 主组件 -180 + 新文件 +190 | 中 | 是 |

**不推荐**：一次性大提交（4 个候选合 1）—— 风险叠加，难以独立验证，违反 BLOCK-9 / BLOCK-9.1 范式。

### 6.4 远期展望（可选 commit 4）

如果 commit 1-3 后主组件仍 >1800 行（threshold），启动 commit 4：P2-1 `components/MessageList.tsx`（预计主组件再 -250 行）。

**当前不建议**：commit 1-3 完成后如果主组件 ~1700 行（< 1800），停止后续拆分。

---

## 7. 4 import 客户端核查

### 7.1 当前 import 详情

**4 个生产客户端**（每个 1 行 import）：

```
frontend/src/components/workspace-panels/CenterPanel.tsx:2
  import { SimpleChat } from '@/components/copilot/SimpleChat';

frontend/src/components/workspace-panels/RightPanel.tsx:2
  import { SimpleChat } from '@/components/copilot/SimpleChat';

frontend/src/components/workspace-panels/ResultView.tsx:27
  import { SimpleChat } from '@/components/copilot/SimpleChat';

frontend/src/pages/project-workspace.tsx:29
  import { SimpleChat } from '@/components/copilot/SimpleChat';
```

**2 个 mock 客户端**（每个 vi.mock 调用）：

```
frontend/src/components/workspace-panels/ResultView.test.tsx:6
  vi.mock('@/components/copilot/SimpleChat', () => ({ SimpleChat: () => <div>chat</div> }));

frontend/src/components/workspace-panels/CenterPanel.test.tsx:6
  vi.mock('@/components/copilot/SimpleChat', () => ({ ... }));
```

**3 个 named export 消费者**（测试）：

```
frontend/src/components/copilot/SimpleChat.extraRenderers.test.tsx:33
  import { restoreSimpleMessage } from './SimpleChat';

frontend/src/components/copilot/SimpleChat.progress.test.ts:5
  import { compactStageConclusion, ResultEditProgressList } from './SimpleChat';

frontend/src/components/copilot/simple-chat-file-open.test.ts:2
  import { shouldOpenWithSystemApp } from './SimpleChat';
```

### 7.2 拆分后 import 是否需要改

**P0-1（attachments）+ P1-1（useChatStream）+ P1-2（formatHarness）抽取后**：

| 客户端 | 当前 import | 拆分后 import | 是否变化 |
|---|---|---|---|
| `CenterPanel.tsx` | `import { SimpleChat } from '@/components/copilot/SimpleChat';` | **不变** | 否 |
| `RightPanel.tsx` | `import { SimpleChat } from '@/components/copilot/SimpleChat';` | **不变** | 否 |
| `ResultView.tsx` | `import { SimpleChat } from '@/components/copilot/SimpleChat';` | **不变** | 否 |
| `project-workspace.tsx` | `import { SimpleChat } from '@/components/copilot/SimpleChat';` | **不变** | 否 |
| `ResultView.test.tsx` | `vi.mock('@/components/copilot/SimpleChat', ...)` | **不变** | 否 |
| `CenterPanel.test.tsx` | `vi.mock('@/components/copilot/SimpleChat', ...)` | **不变** | 否 |
| `SimpleChat.extraRenderers.test.tsx` | `import { restoreSimpleMessage } from './SimpleChat';` | **不变**（沿用 e599ee0 re-export） | 否 |
| `SimpleChat.progress.test.ts` | `import { compactStageConclusion, ResultEditProgressList } from './SimpleChat';` | **不变**（沿用 e599ee0 re-export） | 否 |
| `simple-chat-file-open.test.ts` | `import { shouldOpenWithSystemApp } from './SimpleChat';` | **不变**（沿用 e599ee0 re-export） | 否 |

**结论**：**所有 9 个客户端 0 改动**。如果继续沿用 e599ee0 的 re-export 兼容策略（主文件顶部 `export { ... }` re-export 所有被外部消费的 named exports），新抽取的代码不应影响任何 import。

### 7.3 re-export 兼容策略模板

```typescript
// 抽取后 SimpleChat.tsx 顶部示例（e599ee0 已建立）
import {
  SLASH_COMMANDS,
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  // ... 14 个 named export from types.ts
} from './SimpleChat/types';
import {
  DEFAULT_EXAMPLE_PROMPTS,
  MessageMeta,
  ExamplePrompts,
  compactStageConclusion,
  // ... helpers
} from './SimpleChat/helpers';
import {
  AttachmentFile,
  useAttachments,
  ImagePreviewModal,
  // ... attachments 模块
} from './SimpleChat/attachments';
import {
  stringifyParamValue,
  shortValue,
  formatHarnessRepair,
  formatHarnessWarning,
  formatHarnessDiagnosticIssue,
} from './SimpleChat/helpers/formatHarness';
import { useChatStream } from './SimpleChat/hooks/useChatStream';

// Re-export 兼容层（保证 4 import 客户端 0 改动）
export {
  SLASH_COMMANDS,
  shouldOpenWithSystemApp,
  restoreSimpleMessage,
  DEFAULT_EXAMPLE_PROMPTS,
  MessageMeta,
  ExamplePrompts,
  compactStageConclusion,
  // 新增（如果外部需要，可选 re-export）
};
export type {
  SlashCommand,
  SimpleMessage,
  AgentProgressUpdate,
  ExamplePrompt,
  ExamplePromptsProps,
  SimpleChatHandle,
  SimpleChatProps,
  ErrorBannerProps,
  PendingApproval,
};
```

**关键**：新抽取的模块（attachments / formatHarness / useChatStream）默认是 SimpleChat 内部使用的，**不需要 re-export**（除非未来有外部消费需求）。

---

## 8. 验证策略建议（主 agent PHASE 4 实施 worker 落地时用）

### 8.1 每个 commit 后必跑

```bash
# 1. TypeScript 0 错误
cd /Users/zhangdiandian/Documents/1.WorkDir/Petri-workspace/desktop/frontend && npx tsc --noEmit

# 2. 直接 SimpleChat 测试 23/23 PASS（不能退化）
npx vitest run src/components/copilot/SimpleChat.test.tsx \
              src/components/copilot/SimpleChat.progress.test.ts \
              src/components/copilot/SimpleChat.extraRenderers.test.tsx \
              src/components/copilot/simple-chat-file-open.test.ts

# 3. 影响范围测试（按 test/impact-map.json 选）
cd /Users/zhangdiandian/Documents/1.WorkDir/Petri-workspace/desktop && npm run test:changed:list

# 4. 治理门（4 项必跑）
npm run docs:check          # 文档数 PASS
npm run ui:audit:check      # UI ID 数 PASS
npm run docs:reconcile      # 0 issues
```

### 8.2 全部 commit 完成后必跑

```bash
# 5. Vite build（产物大小应保持 ~2308 kB）
cd /Users/zhangdiandian/Documents/1.WorkDir/Petri-workspace/desktop && npm run build --prefix frontend

# 6. chf0-critical 不退化（plugin IPC contract）
node --test test/chf0-critical/*

# 7. vitest 75 文件 630 tests 0 失败（影响范围内）
cd /Users/zhangdiandian/Documents/1.WorkDir/Petri-workspace/desktop && npm run test:changed

# 8. 4 个 import 客户端 0 改动（git diff 应为空）
git diff --stat HEAD -- frontend/src/components/workspace-panels/CenterPanel.tsx \
                          frontend/src/components/workspace-panels/RightPanel.tsx \
                          frontend/src/components/workspace-panels/ResultView.tsx \
                          frontend/src/pages/project-workspace.tsx
```

### 8.3 推荐 commit 顺序

**3 个 commit（commit 1 → commit 2 → commit 3）**：

1. **commit 1（P0-1 attachments）**：极低风险，最大单次收益（移除 11 个 hook 调用 + 1 个独立子组件）
2. **commit 2（P1-2 formatHarness）**：极低风险，移除 5 个纯函数 + 改善可测性
3. **commit 3（P1-1 useChatStream）**：中等风险，send pipeline 抽取（最大单次收益但耦合多）

**commit 4 可选**：P2-1 `components/MessageList.tsx`（如果 commit 1-3 后主组件仍 >1800 行）

### 8.4 不变量守住清单

| 不变量 | 验证 |
|---|---|
| `frontend/src/lib/desktopBridge.ts` 0 diff | `git diff` |
| `frontend/src/lib/electron.d.ts` 0 diff | `git diff` |
| `frontend/src/components/copilot/copilotClient.ts` 0 diff | `git diff` |
| `frontend/src/components/copilot/toolActivity.ts` 0 diff | `git diff` |
| `frontend/src/components/copilot/toolSummaryPresentation.ts` 0 diff | `git diff` |
| `frontend/src/components/copilot/extraRenderers.tsx` 0 diff | `git diff` |
| `frontend/src/components/copilot/conversationRunStore.ts` 0 diff | `git diff` |
| `frontend/src/components/copilot/copilotMarkdown.tsx` 0 diff | `git diff` |
| 4 import 客户端 0 diff | `git diff --stat` |
| 0 npm 依赖新增/删除 | `package.json` diff |
| `tsc --noEmit` 0 错误 | 类型检查 |
| vitest SimpleChat 4 文件 23/23 PASS | 测试运行 |
| UI-161 仍 `in_progress` | 纯代码组织变更，无实机 Electron |

### 8.5 AUDIT-LOG 同步

PHASE 4 第二轮收口时，按 G0 阶段纪律同步：

| 文档 | 内容 |
|---|---|
| `docs/AUDIT-LOG.md` | 追加 PHASE 4 第二轮收口 entry（含行数变化 + commit hashes + 4 治理门结果 + 不变量守住清单） |
| `docs/next-steps-roadmap.md` | launch + closeout entry（PHASE 4 第二轮） |
| `docs/project-workspace-handoff.md` | launch + closeout entry |
| `docs/DOC-REGISTRY.json` | `BLOCK-9.2` active → completed + linkedCommits 加新 commit hashes |
| `docs/ui-productization-audit.md` | 追加 UI-173 续 entry（PHASE 4 第二轮） |

**不外推**：packaged / Provider / GA / P7 / notarization / dist staleness G1+ / UI-157/158/159 实机验证 / 已 closed BLOCK-9/9.1/8/7/6/5/4/3/2 / agent-tools/* / agent-transcripts/*。

---

## 9. 与 PHASE 0 调研对照

| 维度 | PHASE 0 调研（2026-08-17 07:46） | 本次调研（2026-08-18 00:45） | 变化 |
|---|---|---|---|
| SimpleChat.tsx 行数 | 2153 | 2277 | **+124 / +5.8%**（c271010 净增） |
| types.ts | 内联（L1-122） | 189 行已抽 | e599ee0 完成 |
| helpers.tsx | 内联（L193-205, 1825-2019） | 108 行已抽 | e599ee0 完成 |
| 86 hooks 估算 | 实测 ~50-61 | 实测 70 调用 + 9 custom | 数字更新 |
| hook 调用实数 | ~50+（估算） | 70（实测） | 数字更新 |
| 子组件数 | 8 个内联 + MessageMeta/ExamplePrompts 计划抽 | 10 个内联（2 已抽）+ ImagePreviewModal 新增 | c271010 +1 |
| 4 import 客户端 | 0 改动策略已确认 | 已 e599ee0 验证 + 本次仍 0 改动 | 不变 |
| PHASE 4 边界（plan §5） | types + 4 helpers + 4 子组件 + 1 hook | **attachments 子树 + formatHarness + useChatStream** | 优先级重排 |
| P0 候选 | types / helpers（已抽） | **attachments 子树 + formatHarness** | c271010 后调整 |
| P1 候选 | 子组件抽取 | **useChatStream 自定义 hook** | 调整 |
| P2 候选 | useChatStream | MessageList 子组件 | 降级 |
| P3 候选 | MessageList / InputBox | Toolbar / MessageItem | 降级 |

**结论**：PHASE 0 调研的总体方向（types+helpers+子组件+1 hook）仍然正确，但具体优先级在 c271010 后需要重新排序。**attachments 子树是新发现的 P0 候选**（c271010 引入，独立单元，0 耦合）。

---

## 10. 调研结论

**调研产出**（0 行代码改动 / 0 测试改动 / 0 commit）：

1. **当前 SimpleChat.tsx 2277 行**（比 plan §5 PHASE 4 baseline 2153 多 124 行）
2. **70 个 hook 调用**（plan "86 hooks" 是 PHASE 0 估算旧数），分布在主组件 64 个 + 嵌套子组件 6 个
3. **4 个 import 客户端 100% 兼容**（re-export 策略已 e599ee0 验证可行）
4. **3 个 commit 拆分粒度推荐**：
   - commit 1：P0-1 attachments 子树 → `SimpleChat/attachments.tsx`（~180 行新文件，主组件 -170 行）
   - commit 2：P1-2 formatHarness helpers → `SimpleChat/helpers/formatHarness.ts`（~55 行新文件，主组件 -50 行）
   - commit 3：P1-1 useChatStream hook → `SimpleChat/hooks/useChatStream.ts`（~190 行新文件，主组件 -180 行）
5. **净瘦身**：主组件从 ~2090 → ~1700 行（-19%），总行数 +145（包含新文件 header）
6. **风险**：3 个 commit 都属于保守拆分，attachements 极低风险 / formatHarness 极低风险 / useChatStream 中等风险（依赖 12+ state 但通过选项 B 自治方案缓解）
7. **不外推**：G0 阶段纪律（packaged / Provider / GA / P7 / dist staleness G1+ / UI-157/158/159 实机 / 已 closed BLOCK-9/9.1/8/7/6/5/4/3/2）

**后续工作包 BLOCK-9.2 PHASE 4 第二轮**（主 agent 实施 worker 启动时）：
- 按 commit 1 → commit 2 → commit 3 顺序执行
- 每个 commit 后跑 §8.1 验证
- 全部 commit 后跑 §8.2 + §8.4 完整验证
- 收口时同步 §8.5 AUDIT-LOG + DOC-REGISTRY

**调研约束严格遵守**：
- 0 行代码改动
- 0 测试改动
- 0 commit
- 仅输出本 markdown 报告

---

**不变量**：本调研报告为 BLOCK-9.2 PHASE 4 第二轮架构调研唯一 canonical 调研报告（与 PHASE 0 调研报告 `docs/block-9-2-mega-file-split-survey.md` 并列）。主 agent 复核后启动 PHASE 4 第二轮实施 worker。
