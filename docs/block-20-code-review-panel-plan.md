---
id: BLOCK-20-CODE-REVIEW-PANEL
status: planning
truthDomain: block-20-code-review
planVersion: v0.1
createdAt: 2026-08-22
governingDocs:
  registry: docs/DOC-REGISTRY.json
  auditLog: docs/AUDIT-LOG.md
  roadmap: docs/next-steps-roadmap.md
  supersedes: docs/block-18-workspace-md-diff-plan.md (active → superseded)
related:
  - docs/block-16-working-tree-review-mode-plan.md (hunk accept/reject 基础设施已落地)
  - docs/block-17-agent-doc-review-panel-plan.md (已 superseded by BLOCK-18)
---

# BLOCK-20 · Code Review Panel — 计划 v0.1

## 1. 目标

为 Petri Desktop 提供**系统级的代码审阅体验**——不再只是"文件页内嵌 diff toggle"，而是仿 VSCode Source Control / Cursor Pending Changes / Antigravity Review 的**常驻右侧面板**：

- 列出当前项目 `git status --porcelain` 中所有 `?? / M / A / D` 的文本文件（不限于 markdown）
- 每个文件 → 红绿 unified diff + 可选左右双栏 split view
- hunk 级别 Accept / Reject（Accept 走 `git apply` 写入 working tree；Reject 走 `git checkout -- file`）
- 拒绝信号进入 BLOCK-16 的 `<working-tree-rejects>` system-prompt 注入段（已有基础设施复用）
- 集成 inline-edit 抽屉（BLOCK-19 thin-slice 资产合并进来）：点"在编辑器中打开"→ 抽屉滑出 `<textarea>` → 保存走 `workspace.writeTextFile`（已有 IPC）

**v1 thin-slice 范围**（G0 开发期常态 · 不外推 packaged/Provider/GA）：

- 1 个新 IPC `git:list-modified`（`git status --porcelain --untracked-files=all`，输出 [{path, status}] 列表）
- 1 个新 IPC `git:file-head-content`（返回 HEAD 版本文件内容，用于 split view 左栏）
- 1 个新 IPC `git:split-side-diff`（HEAD + working tree → structured hunks，复用 BLOCK-16 `parseUnifiedHunks`）
- 1 个新 IPC `git:revert-file`（`git checkout -- <path>`，仅限 working tree）
- 1 个新 IPC `git:apply-inverse-hunk`（算 inverse patch 后 `git apply --reverse`）
- 1 个新前端组件 `<CodeReviewPanel />`（常驻右侧面板）
- 1 个新前端组件 `<CodeReviewDrawer />`（右侧滑出抽屉）
- BLOCK-19 thin-slice 改动（markdown tab 三态 / `workspace.writeTextFile` IPC）原样保留作为 drawer 内联编辑器
- BLOCK-16 `applyPatch / revertPaths / <working-tree-rejects>` 复用

## 2. 决策摘要

| 维度 | 决策 | 理由 |
|---|---|---|
| 范围 | 项目级所有修改过的文本文件 | 用户裁决"代码审阅模式"覆盖 .md / .ts / .js / .json / .css 等 |
| 基准 | git HEAD（`git diff HEAD`） | 用户裁决"vs git index"；split 左栏 HEAD 内容，右栏 working tree |
| 触发 | 常驻右侧面板 + TitleBar 手动按钮 | BLOCK-16 浮层仅 agent task done；BLOCK-20 覆盖"日常手动审阅" |
| 渲染 | 复用 BLOCK-16 `DiffFileView / DiffHunkView` | BLOCK-16 调研已确认手写 0 依赖 |
| hunk 接受 | `git-adapter.applyPatch` | BLOCK-16 PHASE 1 已实现 |
| hunk 拒绝 | `git-adapter.applyInverseHunk`（新增） | 单文件全撤粒度太粗；per-hunk 拒绝需算 inverse hunk |
| inline edit | drawer 抽屉 + `<textarea>` + `workspace.writeTextFile` | BLOCK-19 资产直接挪进 drawer |
| 拒绝清单注入 | 复用 BLOCK-16 `<working-tree-rejects>` | BLOCK-16 PHASE 3 已实现 |
| BLOCK-19 markdown toggle | **删除**文件页 `编辑/预览/对比` 三 tab | 职责合并到 Code Review Panel + Drawer |
| BLOCK-18 plan | superseded | BLOCK-20 接管 active 槽位 |
| BLOCK-16 浮层 | **保留** | agent 完成任务的浮层 vs 日常审阅面板，两条触发流并存 |
| 真实 OSS / Provider / packaged | 不外推 | G0 开发期常态 |

## 3. 架构

```
CodeReviewPanel (右侧 tab)
├── FileList (git status --porcelain 列表)
│   ├── FileRow(path, status: ??/M/A/D)
│   │   ├── onClick → setActiveFile(path)
│   │   └── badge: 改动行数 (+12 / -5)
│   └── EmptyState
├── FileDetail
│   ├── Header: filename · status · [unified ↔ split toggle]
│   ├── DiffFileView (复用 BLOCK-16)
│   │   └── DiffHunkView (per-hunk ✓ / ✗)
│   └── InlineEditToggleButton → 抽屉
└── CodeReviewDrawer (右侧滑出)
    ├── <textarea> (BLOCK-19 资产)
    └── 保存到文件 / 恢复
```

数据流：
- 启动 / `git status` 变化 → `git:list-modified` → FileList
- 选中文件 → `git:split-side-diff` → DiffFileView
- Accept hunk → `git-adapter.applyPatch({ patch })`
- Reject hunk → `git-adapter.applyInverseHunk({ filePath, hunk })`
- inline-edit 保存 → `workspace.writeTextFile` → 自动 refresh FileList

## 4. PHASE 拆分

### PHASE 0 — 治理登记
- DOC-REGISTRY 新增 `BLOCK-20-CODE-REVIEW-PANEL` (work-package / active / canonical=true / truthDomain=block-20-code-review)
- BLOCK-18-WORKSPACE-MD-DIFF → superseded
- BLOCK-19 thin-slice 不登记新 ID（合并进 BLOCK-20）
- 更新 `docs/next-steps-roadmap.md` 当前 active = BLOCK-20
- `npm run docs:check` GREEN

### PHASE 1 — IPC 新增
- `core/shared-backend/git-adapter.js` 新增 5 方法：`listModified / fileHeadContent / splitSideDiff / revertFile / applyInverseHunk`
- `src/ipc/working-tree-review.js` 扩展注册
- `src/preload.js` workingTreeReview namespace 加 5 方法
- `frontend/src/lib/electron.d.ts` 类型同步
- 单元测试 4 文件

### PHASE 2 — 前端面板组件
- `frontend/src/components/desktop/CodeReview/` 6 新模块：CodeReviewPanel / CodeReviewDrawer / FileList / FileDetail / useCodeReview + CSS module
- `frontend/src/App.tsx` mount `<CodeReviewPanel />`
- `frontend/src/pages/project-workspace.tsx` markdown tab 退化为 `预览/对比` 二 tab

### PHASE 3 — inline-edit 抽屉
- `<CodeReviewDrawer />` 承载 `<textarea>` + 保存/恢复
- 复用 BLOCK-19 `workspace.writeTextFile` IPC（0 改动）

### PHASE 4 — per-hunk reject inverse + system-prompt 集成
- `git-adapter.applyInverseHunk` 实现：把 hunk 的 + → -、- → + 后 `git apply --reverse`
- 拒绝信号经 `<working-tree-rejects>` 注入（BLOCK-16 已有）
- 测试：BLOCK-16 `system-prompt-rejects.test.mjs` 不动；BLOCK-20 加 per-hunk 粒度测试

### PHASE 5 — 专项门禁 + closeout
- `npm run block:code-review` 新脚本：定向 vitest + node --test + 治理门
- closeout 笔录 `docs/block-20-code-review-panel-closeout.md`
- DOC-REGISTRY status=completed

## 5. 完成语义

- 5 新 IPC（`list-modified / file-head-content / split-side-diff / revert-file / apply-inverse-hunk`）
- 1 常驻右侧 `<CodeReviewPanel />` + 1 滑出 `<CodeReviewDrawer />`
- BLOCK-16 `DiffFileView / DiffHunkView / applyPatch / revertPaths / <working-tree-rejects>` 0 改动复用
- BLOCK-19 inline-edit 资产 0 改动复用
- 文件页 markdown tab 退化为 `预览/对比` 二 tab
- 4 治理门 GREEN（docs:check / ui:audit:check / tsc 0 / docs:reconcile 0）
- 不变量守住：preload.js 既有 19 命名空间 0 diff；electron.d.ts 既有类型 0 diff；desktopBridge.ts 既有 API 0 diff；core/shared-backend 既有方法 0 diff；BLOCK-16 既有组件 0 diff

## 6. 不在范围

- packaged / notarization / GA / P7 / dist staleness G1+
- Provider 矩阵 / 真实 OSS 远程接手
- 引入 monaco-editor / react-diff-viewer / react-split-pane
- n-way merge / 三方 merge
- 跨项目 working tree 审阅
- 修改 core/shared-backend 既有方法（仅新增）
- 修改 BLOCK-16 既有组件（仅复用）
- 不重新激活 BLOCK-2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 9.1 / 9.2 / 15 / 17 / 18
- 不动 Result Studio 既有 diff 组件
- 不动 agent-tools/* / agent-transcripts/*
- 不引入新 npm 依赖

## 7. 当前状态

**当前 active 工作包**：NONE（BLOCK-20 处于 planning；PHASE 0 登记完成后切 active）
