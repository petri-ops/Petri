# BLOCK-17 — Agent 文档审阅面板


**Status**: `superseded`

**Registered**: 2026-08-21

**Superseded By**: `BLOCK-18-WORKSPACE-MD-DIFF`（2026-08-22）

## 概述（原始动机）

为 Petri Desktop 添加「Agent 文档审阅」侧边栏面板，复用 WorkingTreeReview 的 `.wt-*` CSS 样式骨架。新增独立 IPC 通道 `agentDocReview` 与 `WorkspacePanels` 状态槽。面板通过 TitleBar `+` 工具菜单触发。

## 收口（2026-08-22）

用户裁决（2026-08-22 00:13）：多一个审阅界面没有意义，应把"前后差异"直接呈现在文件页面（`files` tab 的 `WorkspaceFilePreview`）内。

BLOCK-17 已实现的以下资产**保留并复用**：

- `src/ipc/agent-doc-review.js`（3 条 IPC handlers）
- `src/preload.js` 中 `petriDesktop.agentDocReview` namespace
- `frontend/src/lib/electron.d.ts` 中 `AgentDocFileEntry` 类型
- `frontend/src/lib/desktopBridge.ts` 中 `getBridge('agentDocReview')` 支持
- `frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.css`（.wt-* 样式）
- `test/agent-doc-review-ipc.test.mjs` / `test/preload-agentdocreview-namespace.test.mjs`（IPC + preload 契约回归测试）

BLOCK-17 已实现但**不再使用**的资产（BLOCK-18 删除）：

- `frontend/src/components/desktop/AgentDocReview/`（4 文件）
- `frontend/src/App.tsx` 中 `AgentDocReviewMount` 挂载
- `frontend/src/components/desktop/TitleBar.tsx` 中 `+` 工具菜单"Agent 文档审阅"项
- `frontend/src/hooks/useWorkspacePanels.ts` 中 `docReviewOpen` 状态槽

具体删除与改造范围见 [`docs/block-18-workspace-md-diff-plan.md`](./block-18-workspace-md-diff-plan.md) §范围。

## 原始数据路径（保留作历史）

- **文档目录**: `app.getPath('userData')/agent-doc-snapshots/` 下所有 `.md` 文件
- **快照目录**: `app.getPath('userData')/agent-doc-snapshots/.snapshots/`（`commitSnapshot` 写入）
- **标签**: `path.relative(userData/agent-doc-snapshots, filePath)` 作为 human-readable label

## 原始 IPC 通道（BLOCK-18 继续使用）

| Channel | 参数 | 返回值 |
|---------|------|--------|
| `agentDocReview:list` | — | `{ files: [{ path, label, lastSnapshotAt, currentMtime }] }` |
| `agentDocReview:loadPair` | `filePath: string` | `{ snapshot: string\|null, current: string }` |
| `agentDocReview:commitSnapshot` | `filePath: string` | `{ ok: true, savedAt: string }` |

## 原始范围（已实现）

- `src/ipc/agent-doc-review.js` — IPC handlers ✅
- `src/preload.js` — `petriDesktop.agentDocReview` namespace ✅
- `frontend/src/lib/electron.d.ts` — `AgentDocFileEntry` 类型 + bridge 声明 ✅
- `frontend/src/lib/desktopBridge.ts` — `getBridge('agentDocReview')` 支持 ✅
- `src/main.js` — 装配 `setupAgentDocReviewIpc` ✅
- `frontend/src/hooks/useWorkspacePanels.ts` — `docReviewOpen` 状态槽 ⚠️（BLOCK-18 删除）
- `frontend/src/App.tsx` — 挂载 `AgentDocReviewMount` ⚠️（BLOCK-18 删除）
- `frontend/src/components/desktop/AgentDocReview/` — 组件目录（4 文件） ⚠️（BLOCK-18 删除）
- `frontend/src/pages/project-workspace.tsx` — TitleBar 菜单接入 ⚠️（BLOCK-18 删除菜单项）

## 原始不在范围

- `src/ipc/working-tree-review.js`（不修改） ✅
- `core/r-server/*` / `core/shared-backend/*`（不修改） ✅
- `frontend/src/components/copilot/*`（不修改） ✅
- r-server 自动写快照（phase 2 再做） ⏸
- 新增 npm 依赖 ✅

## 原始验收门禁

1. `npm run docs:check` — ⏸ 未跑（BLOCK-17 未提交时用户已裁决改方向）
2. `npm run ui:audit:check` — ⏸ 未跑
3. `cd frontend && npm run build` — ⏸ 未跑
4. `test/preload-agentdocreview-namespace.test.mjs` — ✅ 已写
5. `test/agent-doc-review-ipc.test.mjs` — ✅ 已写

最终验收由 BLOCK-18 承接（见 [`docs/block-18-workspace-md-diff-plan.md`](./block-18-workspace-md-diff-plan.md) §验收门禁）。

## 收口声明

G0 开发期常态 · 不外推 packaged/Provider/GA
