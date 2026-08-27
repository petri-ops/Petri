# BLOCK-18 — Workspace MD Diff

**Truth Domain**: ``（superseded 已移除）

**Status**: `superseded`

**Superseded**: 2026-08-22 by BLOCK-20-CODE-REVIEW-PANEL

**Registered**: 2026-08-22

**Supersedes**: `BLOCK-17-AGENT-DOC-REVIEW-PANEL`（2026-08-21 → 2026-08-22）

## 概述

BLOCK-17 在 `userData/agent-doc-snapshots/` + 独立侧边栏面板的方向上启动，但用户裁决（2026-08-22 00:13）认为"多一个审阅界面没有意义"，要求把"前后差异"直接呈现在文件页面（`files` tab 的 `WorkspaceFilePreview`）内。

BLOCK-18 复用 BLOCK-17 已实现的 IPC 通道（`agentDocReview:list / loadPair / commitSnapshot`）、`computeSimpleDiff` 算法与 `.wt-*` 样式骨架，**只把 UI 入口从独立面板改为 `WorkspaceFilePreview` 顶部的"预览 / 对比"toggle**：

- 文件页面已经能预览 markdown（`workspaceMarkdownPreview`）
- 在它顶部加一个 toggle：切换 `preview` ⇄ `diff`
- diff 视图复用 BLOCK-17 的 `.wt-hunk-table` 渲染，snapshot 来源沿用 BLOCK-17 IPC（`agentDocReview:loadPair`）
- 文件树 + 多 tab 打开 + markdown 渲染能力 **完全不动**
- 独立的 `AgentDocReview` 面板、`+` 菜单项、`useWorkspacePanels.docReviewOpen` 状态槽全部移除

## 与 BLOCK-17 的关系

| 维度 | BLOCK-17 状态 | BLOCK-18 复用 |
|---|---|---|
| IPC handlers（`src/ipc/agent-doc-review.js`） | 已写 | ✅ 复用，**不删** |
| `computeSimpleDiff`（`AgentDocReview.tsx:27-52`） | 已写 | ✅ 提取到 `lib/markdownDiff.ts` |
| `.wt-*` 样式（`WorkingTreeReview.css`） | 已重命名为 `.wt-*` 在该文件 | ✅ 复用 |
| `preload.js` `biof3Desktop.agentDocReview` namespace | 已挂 | ✅ 复用 |
| `desktopBridge.ts` `getBridge('agentDocReview')` | 已挂 | ✅ 复用 |
| `electron.d.ts` `AgentDocFileEntry` 类型 | 已加 | ✅ 复用 |
| **独立 `AgentDocReview` 面板** | 已写 | ❌ 删除（4 文件） |
| **TitleBar `+` 菜单"Agent 文档审阅"** | 已加 | ❌ 删除 |
| **`useWorkspacePanels.docReviewOpen` 状态槽** | 已加 | ❌ 删除 |
| **`App.tsx` 挂载 `AgentDocReviewMount`** | 已加 | ❌ 删除 |
| **测试 `test/agent-doc-review-ipc.test.mjs` / `test/preload-agentdocreview-namespace.test.mjs`** | 已写 | ✅ 保留（IPC 契约未变） |

BLOCK-17 的 plan 文件 `docs/block-17-agent-doc-review-panel-plan.md` 保留为 `superseded`，证据链路不破坏。

## 范围

**新增**

- `frontend/src/lib/markdownDiff.ts` —— 提取 `computeSimpleDiff` + `SimpleDiff` / `DiffLine` 类型，纯函数 + 单元测试
- `frontend/src/pages/project-workspace.tsx` —— `WorkspaceFilePreview` 加 `mode: 'preview' | 'diff'` 状态：
  - toolbar 加 toggle 按钮（仅当 `fallbackKind === 'markdown'` 且文件在 agent-doc-snapshots 内时显示）
  - diff 分支渲染 `.wt-hunk-table`
- `frontend/src/pages/project-workspace.module.css` —— 加 `.workspaceMarkdownDiff` + 行号样式（直接套用 `.wt-*` 主题变量）

**复用（不动）**

- `src/ipc/agent-doc-review.js` —— IPC handlers
- `src/preload.js` —— `biof3Desktop.agentDocReview` namespace
- `frontend/src/lib/desktopBridge.ts` —— `getBridge('agentDocReview')`
- `frontend/src/lib/electron.d.ts` —— `AgentDocFileEntry` / bridge 声明
- `frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.css`（.wt-*）

**删除**

- `frontend/src/components/desktop/AgentDocReview/`（4 文件：`AgentDocReview.tsx` / `AgentDocReview.css` / `AgentDocReviewMount.tsx` / `useAgentDocReview.ts`）
- `frontend/src/App.tsx` 中 `AgentDocReviewMount` 导入与挂载
- `frontend/src/components/desktop/TitleBar.tsx` 中 `+` 工具菜单的"Agent 文档审阅"项 + 关联 handler
- `frontend/src/hooks/useWorkspacePanels.ts` 中 `docReviewOpen` 状态槽 + setter

**保留（验证）**

- `test/agent-doc-review-ipc.test.mjs` —— IPC 契约未变，继续 PASS
- `test/preload-agentdocreview-namespace.test.mjs` —— preload namespace 契约未变，继续 PASS
- 新增 `frontend/src/lib/markdownDiff.test.ts` —— 单元测试 `computeSimpleDiff`

## 数据流

1. 用户在 `files` tab 选中一个 `.md` 文件 → `WorkspaceFilePreview` 进入 `mode: 'preview'`
2. 点击 toolbar 右上角 toggle "预览 / 对比" → `mode: 'diff'`
3. `WorkspaceFilePreview` 调 `getBridge('agentDocReview').loadPair(file.path)`
4. 拿到 `{ snapshot: string|null, current: string }` → `computeSimpleDiff(snapshot ?? '', current)` → `.wt-hunk-table`
5. toolbar 增加 "Commit" / "Discard" 按钮（仅当 `current !== snapshot`，复用 BLOCK-17 状态判断）：
   - **Commit** → `commitSnapshot(file.path)` 把当前内容写入 `.snapshots/<basename>.snap`
   - **Discard** → 重新 `loadPair` 还原

## 验收门禁

1. `npm run docs:check` —— 通过
2. `npm run ui:audit:check` —— 通过
3. `cd frontend && npm run build` —— TypeScript + Vite 通过
4. `node --test frontend/src/lib/markdownDiff.test.ts` —— 通过（需加 .ts loader 或用 vitest）
5. `node --test test/agent-doc-review-ipc.test.mjs` —— 通过（BLOCK-17 IPC 契约回归）
6. `node --test test/preload-agentdocreview-namespace.test.mjs` —— 通过（BLOCK-17 preload 契约回归）
7. 实机 dev Electron：打开 `files` tab → 选 `.md` → toggle "对比" → 看到 diff → Commit → 切回 "预览" 内容不变 → 再 toggle 回 "对比" snapshot 与 current 一致无 diff

## 不在范围

- `core/r-server/*` / `core/shared-backend/*`（不修改）
- `frontend/src/components/copilot/*`（不修改）
- `src/ipc/working-tree-review.js`（不修改）
- `frontend/src/components/workspace-panels/*`（不修改）
- 工作区文件树 + 多 tab 打开能力（不修改）
- 新增 npm 依赖
- 任何 G1+ 阶段事项（packaged / Provider / GA / 公证）

## 收口声明

G0 开发期常态 · 不外推 packaged/Provider/GA

## 实施 PHASE

- **PHASE 1** 提取 `computeSimpleDiff` → `frontend/src/lib/markdownDiff.ts` + 单测
- **PHASE 2** `WorkspaceFilePreview` 加 `mode: 'preview' | 'diff'` 状态机 + toolbar toggle + `.workspaceMarkdownDiff` 样式
- **PHASE 3** 删除 BLOCK-17 独立面板（4 文件 + App.tsx 挂载 + TitleBar 菜单 + useWorkspacePanels 状态槽）
- **PHASE 4** 验收门禁全绿 + 实机 dev Electron 对账 + git commit + canonical 文档收口
