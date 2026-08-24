# BLOCK-22 CodeMirror Inline Diff 工作包计划

**Plan ID**：`BLOCK-22-CODEMIRROR-INLINE-DIFF`
**Phase**：P0-P3（4 阶段串行）
**Status**：planned（active 待用户裁决启动后切到 active，再进 P0）
**Owner**：主 Agent
**Created**：2026-08-24
**Truth Domain**：`workspace-file-preview-engine`
**Parent Block**：无（独立工作包；承接 BLOCK-20 PHASE 4/5 复用资产对接）
**Predecessor**：BLOCK-16（Working Tree Review Mode）/ BLOCK-17/19（markdownDiff 资产）/ BLOCK-20（Code Review Panel）
**不外推边界继承**：BLOCK-20 closeout §2 不外推 + AGENTS.md §"G0 长期开发期"

---

## §1 背景与边界

### 1.1 现有编辑器栈（基线确认）

| 资产 | 路径 | 行数 / 状态 |
|------|------|------------|
| `WorkspaceFilePreview` 容器 | `frontend/src/pages/project-workspace.tsx:2333-2694` | text / markdown / csv / pdf / image / html / json 7 fallbackKind |
| `CodeHighlight` | `frontend/src/components/ui/CodeHighlight.tsx` | 基于 `highlight.js` 的只读 syntax highlight |
| `MarkdownView` | `frontend/src/components/copilot/SimpleChat.tsx` import + 聊天回复 | `react-markdown` + `remark-gfm` + `rehype-highlight` + `rehype-sanitize` |
| `ToolActivityList` | `frontend/src/components/copilot/SimpleChat.tsx:1764-1853` | 聊天卡片 = 工具活动列表 |
| 工具活动文案 | `frontend/src/components/copilot/toolActivity.ts:112-114` | 工具名 + 摘要 |
| **0 个 `@codemirror/*` 包** | `frontend/package.json` grep `@codemirror` 0 命中 | 当前仓库无 CM6 依赖 |
| 0 个 `monaco-editor` | grep 0 命中 | 不引入 |
| 0 个 `react-diff-viewer` | grep 0 命中 | 不引入 |
| 0 个 `react-split-pane` | grep 0 命中 | 不引入 |
| 0 个 n-way merge 资产 | 无第三方 merge 库 | 不引入 |

### 1.2 关键不外推边界（来自 BLOCK-20 closeout §2）

- **不引入** `monaco-editor` / `react-diff-viewer` / `react-split-pane` / `n-way merge`
- **不外推** 跨项目 working tree 审阅
- **不重新激活** BLOCK-2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 9.1 / 9.2 / 10 / 10-AUDIT / 11 / 13 / 14 / 15 / 16 / 17 / 18 / 19 / 20 / 21 任何已收口工作包

### 1.3 G0 阶段纪律（来自 AGENTS.md §当前阶段纪律）

- **不外推** packaged Electron 公证 / 签名 / notarization
- **不外推** 真实 Provider 矩阵 / GA 公证流水线 / dist staleness
- **不外推** Result Studio RS-P7
- **不外推** OSS 远程接手 / 资格升级 `qualificationEligible: false → true`
- **不外推** Git Worktree（`G0-RS-WT0` deferred）

### 1.4 与 BLOCK-20 范围重叠点（复用资产，不重写）

| BLOCK-20 PHASE 1 已备资产 | BLOCK-22 复用点 |
|---------------------------|------------------|
| `git:revert-file` IPC | P2 全文件 Reject All |
| `git:apply-inverse-hunk` IPC | P2 单 hunk Accept（Hunk→inverse 应用 baseline） |
| `<working-tree-rejects>` 30 天 TTL reject 清单 | P2 reject 反馈复用同一存储路径与 schema |
| `useWorkingTreeReview` reject 路径 | P2 不复用（CodeMirror 走 EditorApi 直接调用 IPC，与 WorkingTreeReview 解耦） |
| `splitSideDiff` MCP 适配器 | 不复用（BLOCK-22 直接走 `ide_file_diff` 后端 + CM6 unifiedMergeView） |
| `BLOCK-16 DiffFileView / DiffHunkView` | 不复用（CM6 unifiedMergeView 是同一职责的替换实现，BLOCK-16 资产保留不动） |

### 1.5 与 Monaco Phase 2（Block-3 deferred）的关系

- Monaco Phase 2（Block-3 PHASE 2）原计划为 "9 个 `editor_*` MCP 工具" 落地，依赖条件之一是"有可工作的编辑器入口"
- **CM6 接入 `frontend/src/components/editor/*`** 提供该入口 → **间接满足** Block-3 PHASE 2 重开条件之一
- **但**：BLOCK-22 **不启动** Monaco Phase 2；CM6 是只读 + 内联 diff 渲染层（轻），Monaco 是全功能 IDE（重），两者职责不重叠
- Block-3 PHASE 2 重开条件由后续主 Agent 显式裁决，不在本方案外推

---

## §2 现有事实清单（含行号定位，已确认）

### 2.1 文件预览与渲染层

| 事实 | 位置 | 确认 |
|------|------|------|
| `WorkspaceFilePreview` 容器渲染 7 fallbackKind 分支 | `frontend/src/pages/project-workspace.tsx:2333-2694` | ✅ |
| `fallbackKind` 联合类型 `'csv' \| 'pdf' \| 'html' \| 'json' \| 'markdown' \| 'image' \| 'text' \| 'binary'` | 同上 L2482 | ✅ |
| text 路径当前走 `<HighlightedCode>`（highlight.js） | `frontend/src/components/copilot/SimpleChat.tsx:159` import + `frontend/src/pages/project-workspace.tsx:2496` | ✅ |
| Markdown 路径当前走 `MarkdownView` | 同上 L2622 + `frontend/src/components/ui/MarkdownView.tsx`（待 P0 阶段确认行号） | ✅ |
| CSV 走 `<table>` 自渲染 | `frontend/src/pages/project-workspace.tsx:2595` | ✅ |
| PDF / 图片 / Office 完全不动 | L2568 / 2573 / 2587 | ✅ |

### 2.2 聊天卡片与跳转缺口

| 事实 | 位置 | 确认 |
|------|------|------|
| `ToolActivityList` 组件函数定义 | `frontend/src/components/copilot/SimpleChat.tsx:1764-1853` | ✅ |
| 调用点（sc-composer 上方） | 同上 L1175 | ✅ |
| 工具活动文案 source | `frontend/src/components/copilot/toolActivity.ts:112-114` | ✅ |
| **现状卡片仅展开/折叠** | `SimpleChat.tsx:1817`（点击 toggle isExpanded） | ✅ |
| **缺跳转事件** | grep `projectOpenWorkspaceFileAtLine` 0 命中 | ✅ |

### 2.3 后端 IPC / MCP / SSE

| 事实 | 位置 | 确认 |
|------|------|------|
| 后端 SSE `ToolResultEvent` 含 `sideEffects: 'workspace-write'` | `core/shared-backend/llm-providers/model-profile.js`（待 P0 确认行号） | ✅ |
| MCP `ide_file_diff(pathA, pathB)` 返回 `{ ok, hunks, summary, truncated }` | `core/r-server/mcp/ide-tools/diff.js:23-96` | ✅ |
| `git:revert-file` IPC（BLOCK-20 PHASE 1 已备） | `core/shared-backend/git-adapter.js` + `src/ipc/working-tree-review.js` | ✅ |
| `git:apply-inverse-hunk` IPC（BLOCK-20 PHASE 1 已备） | 同上 | ✅ |
| `git:hunk-reject-inverse` IPC（BLOCK-20 PHASE 4 已备） | 同上 + reject 清单 30 天 TTL | ✅ |

### 2.4 状态共享与事件总线

| 事实 | 位置 | 确认 |
|------|------|------|
| `WorkspacePanelsContext`（panels mount/unmount） | `frontend/src/components/workspace-panels/` | ✅ |
| `CopilotContext`（chat state + composer） | `frontend/src/components/copilot/` | ✅ |
| 事件总线 `biof3Events.projectOpenWorkspaceFile` | `frontend/src/lib/events.ts:35` | ✅ |
| **缺"跳转到行"事件** | grep `projectOpenWorkspaceFileAtLine` 0 命中 | ✅ |
| **缺"打开审阅 diff"事件** | grep `projectReviewWorkspaceDiff` 0 命中 | ✅ |

---

## §3 接入策略

### 3.1 最小侵入原则

- **只换 text 路径**：CM6 EditorView 仅替换 `fallbackKind === 'text'` 的只读渲染层
- **Markdown 仍走 react-markdown**（`MarkdownView`）—— 不引入 CM6 markdown mode，避免引入 markdown parser 依赖膨胀
- **CSV 仍走 `<table>`** —— P0/P1 不动
- **PDF / 图片 / Office / HTML / JSON 完全不动** —— 不引入 CM6 相关解析
- **`fallbackKind` 判定与状态机保留**：6 种 fallbackKind 分支 + `mode: NORMAL ↔ INLINE_DIFF` 切换是 `WorkspaceFilePreview` 内部 state，不外泄

### 3.2 文件状态流转

```
WorkspaceFilePreview
  └─ mode: 'NORMAL' | 'INLINE_DIFF' (新增，仅 text 路径生效)
       ├─ 'NORMAL'      → <HighlightedCode> (highlight.js, baseline)
       └─ 'INLINE_DIFF' → <CodeMirrorEditor mode='inline-diff'> (CM6 unifiedMergeView)
```

**触发源**：Agent `workspace_write` 完成 → SSE `ToolResultEvent.sideEffects === 'workspace-write'` 携带 path → `SimpleChat.tsx` 把"展开活动" + "触发跳转"作为两个独立副操作 dispatch（保留 toggle 作副操作，新增跳转作主操作）

### 3.3 DiffRevision 数据契约（types.ts）

```ts
type DiffRevision = {
  path: string;             // 工作区相对路径
  baseline: string;         // 磁盘旧值（git HEAD 或磁盘原始内容）
  proposed: string;         // 磁盘新值（agent 写入后的当前内容）
  hunks: DiffHunk[];        // 可选：前端预解析；CM6 也可自解析
  producedAt: number;       // epoch ms
};

type DiffHunk = {
  oldStart: number; oldLines: number;
  newStart: number; newLines: number;
  lines: Array<{ kind: 'context' | 'add' | 'del'; text: string }>;
};
```

### 3.4 渲染层不变量

- `<HighlightedCode>` 保留作为 `mode === 'NORMAL'` 兜底，不删除
- `MarkdownView` / `CodeHighlight` 0 diff
- `fallbackKind` 判定 0 diff
- `WorkspacePanelsContext` / `CopilotContext` 0 diff（不引入新 context）

---

## §4 模块边界

### 4.1 新建目录

```
frontend/src/components/editor/
└── CodeMirror/
    ├── CodeMirrorEditor.tsx            (~120 行)
    ├── CodeMirrorEditor.module.css     (~80 行)
    ├── extensions/
    │   ├── unifiedDiff.ts              (CM6 unifiedMergeView 封装)
    │   ├── scrollToLine.ts             (scrollToLine API + pulse 3s)
    │   └── acceptRejectWidget.ts       (P2: WidgetType + ViewPlugin)
    ├── useCodeMirrorEditor.ts          (单例 EditorView + Compartment 模式切换)
    ├── types.ts                        (DiffRevision / EditorApi / EditorMode)
    └── index.ts                        (barrel export)
```

### 4.2 依赖版本（建议值，P0 阶段敲定）

| 包 | 版本 | 用途 | 不引入什么 |
|----|------|------|------------|
| `@codemirror/state` | `^6.4.1` | EditorState + Compartment | |
| `@codemirror/view` | `^6.28.0` | EditorView | |
| `@codemirror/commands` | `^6.5.0` | history / 历史栈 | |
| `@codemirror/language` | `^6.10.2` | StreamLanguage 框架 | |
| `@codemirror/merge` | `^6.0.0` | **unifiedMergeView 行级 + 字符级 diff**（只用 unified view，**不用 3-way merge**） | **不引** 3-way merge / `mergeViews` |
| `@codemirror/lint` | `^6.8.1` | linter 框架（预留，P1 不落地） | |
| `@lezer/highlight` | `^1.2.0` | syntax highlight tags | |
| 语言包（`@codemirror/lang-*`） | 按扩展名懒加载 | tsx / python / r / json / md / shell | |

**不引入**：`monaco-editor` / `react-diff-viewer` / `react-split-pane` / `codemirror-merge` 之外的 merge 库 / n-way merge。

---

## §5 阶段分解（4 阶段串行）

### P0 — 基础脚手架 + 依赖引入 + 只读渲染（UI-191）

**目标**：CM6 在 text 路径下能渲染，不引入 diff 模式。

**范围**：
- 加 7 个 `@codemirror/*` 依赖到 `frontend/package.json`
- 创建 `frontend/src/components/editor/CodeMirror/` 目录与所有初始文件
- `CodeMirrorEditor.tsx` 最小只读实现（`mode: 'normal'` 单分支）
- `useCodeMirrorEditor.ts` 单例 EditorView + Compartment 模式切换骨架
- `frontend/src/pages/project-workspace.tsx` text 路径分支引入 `<CodeMirrorEditor>`，CM6 与 `<HighlightedCode>` 二选一（Compartment reconfigure 切换，P0 默认走 CM6，P0 closeout 时切换回 HighlightedCode 验证不破坏 baseline）
- 不接任何事件；不接 diff；不接 accept/reject

**验证**：
- `cd frontend && npx tsc --noEmit` 0 错
- `npm run docs:check` PASS（registry +1 PLAN +1 CLOSEOUT-reference）
- `npm run ui:audit:check` PASS（+1 UI-191 entry）
- `cd frontend && npx vitest run src/components/editor/` （最小骨架测试）
- `npm run docs:reconcile` 0 issues

**预期**：3~5 commits / 0.5 人天

---

### P1 — Unified Diff 渲染（行级 + 字符级）（UI-192）

**目标**：CM6 unifiedMergeView 渲染 `DiffRevision`，行级 + 字符级 diff；接入 mode 切换。

**范围**：
- `extensions/unifiedDiff.ts` 封装 `unifiedMergeView` + 自定义 diff 主题
- `CodeMirrorEditor.tsx` `mode: 'normal' | 'inline-diff'` 切换（`Compartment.reconfigure`）
- `CodeMirrorEditor.module.css` 定义：
  - `.cm-deletedChunk` / `.cm-insertedChunk`（行级）
  - `.cm-deletedChar` / `.cm-insertedChar`（字符级）
  - **复用 `.hljs token` 颜色变量**（不引入新 token，沿用 `styles/custom.css` 已有 `--biof3-*` token）
- `extensions/scrollToLine.ts` API 实现（`scrollToLine(line, options)` + `pulseForDuration(3000)`），**不接业务事件**
- `types.ts`：`DiffRevision` / `EditorApi` / `EditorMode` 类型定义落地
- `useCodeMirrorEditor.ts` 把 `EditorApi` 通过 `forwardRef` 暴露给父组件

**验证**：
- `cd frontend && npx tsc --noEmit` 0 错
- `cd frontend && npx vitest run src/components/editor/CodeMirror/` （含 scrollToLine API 单元测试）
- `npm run docs:check` / `npm run ui:audit:check` PASS
- 手写集成测试：`ide_file_diff` mock 1 个 `DiffRevision` fixture → CM6 渲染行级 diff + 字符级 diff → 截图存 `acceptance/block-22-p1-codemirror-diff/`

**预期**：2~3 commits / 0.5 人天

---

### P2 — Accept/Reject 浮动按钮（UI-193）

**目标**：单 hunk accept/reject + 全文件 accept all/reject all 浮动按钮。

**范围**：
- `extensions/acceptRejectWidget.ts`：`WidgetType` + `ViewPlugin` 注入 inline widget
- **两种形态**：
  - 单 hunk ≤ 5 行 → **行内 inline**（接在 hunk 末尾）
  - 单 hunk > 5 行 → **floating**（CM6 panel，positioned）
- `EditorApi.acceptHunk(hunkIndex)` / `rejectHunk(hunkIndex)` / `acceptAll()` / `rejectAll()` 方法挂 `forwardRef`
- **复用 BLOCK-20 PHASE 1 + PHASE 4 已备 IPC**（0 新增）：
  - `acceptHunk` → 由 CM6 客户端基于 baseline + hunk 增量构造 unified diff patch 后 IPC 写回（暂走 `workspace.writeTextFile` BLOCK-20 PHASE 3）
  - `rejectHunk` → `git:hunk-reject-inverse`（BLOCK-20 PHASE 4）+ reject 清单共享 `_writeRejectEntry`（BLOCK-16 PHASE 3 schema）
  - `acceptAll` → `workspace.writeTextFile` 整文件写入 `proposed`
  - `rejectAll` → `git:revert-file`（BLOCK-20 PHASE 1）
- **不新增** `src/ipc/working-tree-review.js` handler；**不修改** `core/shared-backend/git-adapter.js` 既有 6 方法

**验证**：
- `cd frontend && npx tsc --noEmit` 0 错
- `cd frontend && npx vitest run src/components/editor/CodeMirror/` （widget 渲染 + accept/reject API 单元测试）
- `node --test test/git-adapter-block20-per-hunk.test.mjs` 12/12 PASS（既有 BLOCK-20 测试 0 退化）
- `npm run docs:check` / `npm run ui:audit:check` PASS

**预期**：2~3 commits / 0.5 人天

---

### P3 — 聊天卡片跳转联动（UI-194）

**目标**：聊天卡片点击触发"跳转到工作区文件的指定行 + 高亮 pulse 3s"。

**范围**：
- `frontend/src/lib/events.ts` 新增：
  - `biof3Events.projectOpenWorkspaceFileAtLine: 'biof3:project-open-workspace-file-at-line'`
  - `biof3Events.projectReviewWorkspaceDiff: 'biof3:project-review-workspace-diff'`
- `frontend/src/components/copilot/SimpleChat.tsx:1817` 改为 dispatch 新事件（保留 toggle 展开/折叠作为副操作）
- `frontend/src/App.tsx` 全局监听器（跨 react-router 页面切换）：
  - 监听 `projectOpenWorkspaceFileAtLine` → 打开 `WorkspaceFilePreview` + `scrollToLine(line)` + `pulse(3000)`
  - 监听 `projectReviewWorkspaceDiff` → 打开 `WorkspaceFilePreview` + `mode='inline-diff'` + 注入 `DiffRevision`
- `frontend/src/lib/pendingScrollContext.tsx`（NEW）：暂存跳转目标（处理"页面未渲染完就先收到事件"的 race）
- `useCodeMirrorEditor.ts` 接收 `pendingScrollContext` → mount 时消费

**验证**：
- `cd frontend && npx tsc --noEmit` 0 错
- `cd frontend && npx vitest run src/components/copilot/SimpleChat.test.tsx src/lib/pendingScrollContext.test.tsx src/App.test.tsx`
- `npm run docs:check` / `npm run ui:audit:check` PASS
- 手写集成：Vite preview + 静态 mock dispatch 事件 → 验证事件 → scrollToLine + pulse 不破坏既有 toggle 副操作

**预期**：2~3 commits / 1.0 人天

---

### 阶段总览

| 阶段 | UI 编号 | commits | 人天 | 关键交付 |
|------|---------|---------|------|----------|
| P0 | UI-191 | 3~5 | 0.5 | 只读 CM6 + Compartment 骨架 |
| P1 | UI-192 | 2~3 | 0.5 | unified diff 行级 + 字符级 + scrollToLine |
| P2 | UI-193 | 2~3 | 0.5 | accept/reject widget + IPC 复用 |
| P3 | UI-194 | 2~3 | 1.0 | 聊天卡片跳转联动 + pendingScrollContext |
| **总计** | | **9~14** | **2.5** | 4 治理门 GREEN × 4 阶段 |

---

## §6 验证范围

### 6.1 每个阶段必跑

- `cd frontend && npx tsc --noEmit` —— 0 错
- `npm run docs:check` —— PASS
- `npm run ui:audit:check` —— PASS
- `cd frontend && npx vitest run <指定文件>` —— 0 错
- `npm run docs:reconcile`（收口前）

### 6.2 默认不跑

- `npm run test:all:workspace`（1300+ 项，耗时数分钟）
- 根 `npm run check`（含所有门禁）
- `npm run test:changed`（除非改动跨文件且影响范围已通过 `test/impact-map.json` 显式登记）

### 6.3 禁止在收口笔录中写

- "全量测试通过"
- "npm run check PASS"
- "npm run test:all:workspace PASS"
- 任何"全量" / "完整" / "全部测试" 字样

---

## §7 关键文件清单

### 7.1 新增

| 文件 | 阶段 | 行数估 | 用途 |
|------|------|--------|------|
| `docs/block-22-codemirror-inline-diff-plan.md` | PHASE 0 启动 | 380~450 | 本文档 |
| `frontend/src/components/editor/CodeMirror/CodeMirrorEditor.tsx` | P0 | 120 | CM6 组件主入口 |
| `frontend/src/components/editor/CodeMirror/CodeMirrorEditor.module.css` | P0 | 80 | diff 主题（复用 .hljs token） |
| `frontend/src/components/editor/CodeMirror/extensions/unifiedDiff.ts` | P1 | 80 | unifiedMergeView 封装 |
| `frontend/src/components/editor/CodeMirror/extensions/scrollToLine.ts` | P1 | 60 | scrollToLine API + pulse |
| `frontend/src/components/editor/CodeMirror/extensions/acceptRejectWidget.ts` | P2 | 150 | WidgetType + ViewPlugin |
| `frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts` | P0 | 100 | 单例 EditorView + Compartment |
| `frontend/src/components/editor/CodeMirror/types.ts` | P0 | 50 | DiffRevision / EditorApi / EditorMode |
| `frontend/src/components/editor/CodeMirror/index.ts` | P0 | 10 | barrel export |
| `frontend/src/lib/pendingScrollContext.tsx` | P3 | 60 | 跳转目标暂存 |
| `frontend/src/lib/pendingScrollContext.test.tsx` | P3 | 40 | vitest |

### 7.2 修改

| 文件 | 阶段 | 改动 |
|------|------|------|
| `frontend/package.json` | P0 | +7 deps（@codemirror/*） |
| `frontend/src/pages/project-workspace.tsx` | P0 | text 路径分支引入 `<CodeMirrorEditor>`（保持 fallbackKind 判定 0 diff） |
| `frontend/src/lib/events.ts` | P3 | +2 events（projectOpenWorkspaceFileAtLine + projectReviewWorkspaceDiff） |
| `frontend/src/components/copilot/SimpleChat.tsx` | P3 | L1817 dispatch 新事件（保留 toggle 作副操作） |
| `frontend/src/App.tsx` | P3 | +全局监听器（跨 react-router 页面切换） |
| `docs/DOC-REGISTRY.json` | PHASE 0 启动 | +2 entries（PLAN + CLOSEOUT-reference） |
| `docs/AUDIT-LOG.md` | PHASE 0 启动 | +1 launch entry |
| `docs/project-workspace-handoff.md` | 各阶段收口 | 同步 active / completed 段（PHASE 4 closeout 一次性同步） |
| `docs/next-steps-roadmap.md` | 各阶段收口 | 同步 active 段（PHASE 4 closeout 一次性同步） |
| `docs/ui-productization-audit.md` | 每阶段 +1 | UI-191 / 192 / 193 / 194 各 +1 行 |

### 7.3 不修改（不变量）

- `frontend/src/components/copilot/SimpleChat.tsx` P0/P1/P2 阶段 0 diff
- `frontend/src/components/ui/MarkdownView.tsx` 0 diff
- `frontend/src/components/ui/CodeHighlight.tsx` 0 diff（保留作 fallbackKind='text' mode='NORMAL' 兜底）
- `src/preload.js` 0 diff（不新增 IPC namespace）
- `src/ipc/working-tree-review.js` 0 diff（不新增 handler；P2 复用 BLOCK-20 PHASE 1+4 既有 6 handler）
- `core/shared-backend/git-adapter.js` 0 diff（既有 6 方法 0 diff）
- `core/shared-backend/llm-providers/model-profile.js` 0 diff
- `core/r-server/mcp/ide-tools/diff.js` 0 diff
- 任何 BLOCK-16 / BLOCK-17 / BLOCK-19 / BLOCK-20 既有组件 0 diff
- BLOCK-20 PHASE 4 working tree 待提交 closeout commit 不属于本工作包范围，**BLOCK-22 不 commit 它**

---

## §8 不在本方案范围

- 真实 Provider 矩阵（OpenAI / Anthropic / DeepSeek 等）
- packaged Electron 公证 / 签名 / notarization
- GA 公证流水线 / dist staleness check
- OSS 远程接手 / 资格升级 `qualificationEligible: false → true`
- Monaco 编辑器 9 个 `editor_*` 工具（Block-3 PHASE 2 deferred；BLOCK-22 间接满足其"有可工作入口"重开条件之一，**不启动** Monaco 阶段）
- Result Studio RS-P7
- 全量 `npm run test:all:workspace`（1300+ 项）
- 根 `npm run check`（含所有门禁）
- Git Worktree 创建（`G0-RS-WT0` deferred）
- i18n 资源抽离（任务 #91 deferred）
- Windows 代码签名（任务 #55 deferred）
- 任何 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/10/10-AUDIT/11/13/14/15/16/17/18/19/20/21 已收口工作包重启

---

## §9 风险登记

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| 1 | CM6 + happy-dom（vitest 默认环境）兼容 | 🟡 | P0 阶段先 `cd frontend && npx vitest run src/components/editor/` 单测跑通；如不兼容，切换 `environment: 'jsdom'` 或加 `@happy-dom/global-registrator` polyfill |
| 2 | 7 个 `@codemirror/*` 依赖引入后打包体积膨胀 | 🟡 | 仅 P0 引入；按扩展名懒加载语言包（tsx / python / r / json / md / shell）；P1 验证 Vite build 体积变化，记录在 closeout |
| 3 | diff hunk 极多时（>500 hunks）渲染卡顿 | � | 复用 BLOCK-17 markdownDiff 的硬上限（5000 行）；`ide_file_diff` 已硬封顶 maxLines 5000；CM6 unifiedMergeView 自身有虚拟滚动 |
| 4 | 事件 `projectOpenWorkspaceFileAtLine` 频率过高导致 React 重渲染 | 🟢 | `pendingScrollContext` 用 `useRef` 而非 `useState`；CM6 直接调 `EditorView.dispatch`，不走 React 状态树 |
| 5 | P2 复用 BLOCK-20 PHASE 4 的 `git:hunk-reject-inverse` 与 BLOCK-16 PHASE 3 的 reject 清单 schema 不兼容 | 🟡 | schema 复用：`{taskId, file, hunkIndex, oldText, newText, feedback, rejectedAt}` —— 不引入新 schema |
| 6 | CM6 React strict mode 双 mount 导致 EditorView 泄漏 | 🟡 | `useCodeMirrorEditor` 用 `useEffect` cleanup `view.destroy()`；mount 时检查 `viewRef.current === null` 再创建 |
| 7 | P3 跨 react-router 页面切换事件丢失 | 🟢 | `App.tsx` 全局监听器（不在路由组件内）；`pendingScrollContext` 持久化跳转目标直到消费 |
| 8 | `ide_file_diff` MCP 工具返回格式与 CM6 unifiedMergeView 期望格式不一致 | 🟡 | `useCodeMirrorEditor` 内做 adapter：`DiffHunk[]` → CM6 `Chunk`[]；不修改 `ide_file_diff` |
| 9 | P2 accept/reject 后磁盘写入失败（workspace.writeTextFile 拒绝） | 🟢 | UI 显示 toast 错误；不破坏 CM6 状态；reject 清单不写入 |
| 10 | `.cm-deletedChunk` / `.cm-insertedChunk` 与既有 `.hljs-*` token 视觉冲突 | 🟢 | P1 复用 `.hljs token 颜色变量`（`--biof3-status-warning` / `--biof3-status-success` 等已有 token），不引入新 CSS variable |

---

## §10 收口门禁

### 10.1 每个阶段收口必跑

- `npm run docs:check` PASS
- `npm run ui:audit:check` PASS
- 每个阶段 ui-audit 加 1 行（UI-191 / 192 / 193 / 194）
- `cd frontend && npx tsc --noEmit` 0 错
- 该阶段定向 vitest 全 PASS

### 10.2 最终收口（PHASE 4 closeout）

- `npm run docs:reconcile` 0 issues
- 写 closeout 笔录 `docs/block-22-codemirror-inline-diff-closeout.md`
- 同步 4 canonical 文档：
  - `docs/DOC-REGISTRY.json`（`BLOCK-22-CODEMIRROR-INLINE-DIFF-PLAN` active → completed + 新增 `BLOCK-22-CODEMIRROR-INLINE-DIFF-CLOSEOUT` reference）
  - `docs/next-steps-roadmap.md`（active 段 → completed）
  - `docs/project-workspace-handoff.md`（active 段 → completed）
  - `docs/README.md`（如有 entrypoint 链接，同步）
- DOC-REGISTRY `linkedCommits` 填充 9~14 个 commit SHA

### 10.3 closeout 笔录固定句

> G0 开发期常态 · 不外推 packaged/Provider/GA/P7/notarization/dist staleness；不引 monaco-editor / react-diff-viewer / react-split-pane / n-way merge；不重新激活 BLOCK-2~21 任意已收口工作包。

**该句写一次**，不重复列举未做项。

---

## §11 引用 & 索引

### 11.1 引用的 AUDIT-LOG 条目

- `2026-08-22 BLOCK-20 task 模式 token_budget 修复 / de02724` —— 旁证 BLOCK-20 closeout 后仍有 working tree
- `2026-08-22 BLOCK-20 live token budget 落地 + 5 commit 合并 / e6e3832` —— 旁证 UI-189/190 已收口，UI-191 空闲
- `2026-08-22 BLOCK-20 wire-up 5 孤儿组件接入 SimpleChat / 9cbf8e3` —— 旁证 accessModeValidator 等工具名契约
- `2026-08-22 BLOCK-20 hooks-order 修复登记（错位 / 待实际修复）` —— 旁证 hooks-order 历史教训
- `2026-08-19 BLOCK-15-ARCHITECTURE-PERF 工作包启动（PHASE 0 调研 + plan v0.1 DRAFT）` —— 旁证 plan v0.1 DRAFT 范式
- `2026-08-22 BLOCK-20-CODE-REVIEW-PANEL PHASE 1+2+3 + assets + closeout` —— 主复用源（PHASE 1 IPC 5 通道 + PHASE 4 reject inverse API）

### 11.2 引用的 BLOCK-15 / BLOCK-20 plan 段落

| 引文 | 来源 |
|------|------|
| Plan ID / Phase / Status / Owner 头部元数据范式 | `docs/block-15-architecture-perf-plan.md` §"工作包元数据" |
| `User Rulings` 表（如有）格式 | `docs/block-15-architecture-perf-plan.md` 顶部 |
| §"PHASE 0 范围评估（调研基准）" 范式 | `docs/block-15-architecture-perf-plan.md` §2 |
| "不变量守住" 段格式 | `docs/block-20-code-review-panel-closeout.md` §7 |
| "不外推" 固定句（一次） | `docs/block-20-code-review-panel-closeout.md` §11 |
| "ADR / 架构决策" 段 | `docs/block-20-code-review-panel-closeout.md` §9 |

### 11.3 复用的既有资产（BLOCK-20 closeout 总结）

- `git-adapter.js` 6 方法：`listModified` / `fileHeadContent` / `fileWorkTreeContent` / `splitSideDiff` / `revertFile` / `applyInverseHunk`
- 5 IPC handler：`git:list-modified` / `git:file-head-content` / `git:split-side-diff` / `git:revert-file` / `git:apply-inverse-hunk`
- 1 IPC handler：`git:hunk-reject-inverse`（BLOCK-20 PHASE 4 working tree）
- `workspace.writeTextFile` IPC（BLOCK-20 PHASE 3）
- `_writeRejectEntry(userDataDir, args)` helper（BLOCK-16 PHASE 3 reject 清单 schema 复用）
- `useWorkingTreeReview` 既有 hook（**BLOCK-22 不复用 hook，但共享底层 IPC**）

### 11.4 不复用的 BLOCK-20 组件

- `CodeReviewPanel` / `CodeReviewDrawer`（系统级审阅面板，非 BLOCK-22 范围）
- `DiffFileView` / `DiffHunkView`（BLOCK-16 自写 React diff 渲染，BLOCK-22 用 CM6 unifiedMergeView 替换）
- `applyPatch` / `revertPaths`（BLOCK-16 既有 API，BLOCK-22 不复用）

---

## §12 阶段纪律收尾

- 本工作包**全程在 dev Electron 边界内**落地（不引 packaged 实机复核），UI-191~194 状态收口时按 `docs/ui-productization-audit.md` 行 402 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified，否则保持 `in_progress`
- `qualificationEligible: false` 永久 G0 事实；不写入 closeout 笔录作"待办"
- 不外推任何 G1+ 阶段事项（详见 §1.3 + §8）
- 任何阶段中途若发现范围外问题（如 Provider / packaged / Worktree）→ 升级 AUDIT-LOG 红色阻塞项，**不**外推
