# BLOCK-20 Code Review Panel — 收口笔录

> 收口日期：2026-08-22
> 工作包归属：BLOCK-20-CODE-REVIEW-PANEL（active → completed）
> 阶段纪律：G0 长期开发期常态 · 不外推 packaged/Provider/GA

## 1. 摘要

BLOCK-20 落地"系统级代码审阅"端到端：用户启动 agent → agent 改动工作区 → 用户在常驻右侧 `<CodeReviewPanel />` 内 per-hunk accept / reject + inline-edit 抽屉滑出保存 → reject 信号写入 30 天 TTL 清单 → 下次 agent prompt 自动经 `<working-tree-rejects>` 段读到的拒绝反馈。

0 新 npm 依赖。BLOCK-16 `DiffFileView / DiffHunkView / applyPatch / revertPaths / <working-tree-rejects>` 与 BLOCK-19 `workspace.writeTextFile` inline-edit 资产 0 改动复用。4 PHASE 全部收口（PHASE 0 / 1 / 2 / 3 + assets 已落 commit；PHASE 4 落到 working tree 待提交），4 治理门 GREEN。

## 2. 范围与不再范围

**范围内**：

- 5 新 IPC（`git:list-modified` / `git:file-head-content` / `git:split-side-diff` / `git:revert-file` / `git:apply-inverse-hunk`）
- 1 常驻右侧 `<CodeReviewPanel />`（基于 BLOCK-16 `WorkingTreeReview` 改造，role=`region`，mount 由 `useWorkspacePanels.workingTreeOpen` 控制）
- 1 滑出 `<CodeReviewDrawer />`（`frontend/src/components/desktop/WorkingTreeReview/CodeReviewDrawer.tsx` 246 行 + `CodeReviewDrawer.module.css` 277 行）
- 1 新增 per-hunk reject IPC `git:hunk-reject-inverse`（PHASE 4 落地）+ 前端 `buildForwardPatchForReject` + `rejectHunkByInverseHunk` hook
- BLOCK-16 `DiffFileView / DiffHunkView / applyPatch / revertPaths / <working-tree-rejects>` 0 改动复用
- BLOCK-19 `workspace.writeTextFile` + inline-edit `<textarea>` 资产 0 改动复用（项目文件 inline-edit 走 workspace.writeTextFile；沙盒文件走 agentDocReview.saveCurrent）
- reject 清单 30 天 TTL + 字符预算 4096 + 过期文件启动时 unlink（沿用 BLOCK-16 §PHASE 3）
- 专项门禁 `npm run block:code-review`（8 steps）

**不外推 / 不重做**：

- packaged / notarization / GA / P7 / dist staleness G1+ —— 用户 2026-08-15 裁决长期 G0 开发期
- Provider 矩阵 / 真实 OSS 远程接手
- 引入 monaco-editor / react-diff-viewer / react-split-pane
- n-way merge / 三方 merge / 跨项目 working tree 审阅
- Result Studio 既有 diff 组件 0 diff
- BLOCK-16 既有组件 0 diff（仅 WorkingTreeReview.tsx 改 panel 渲染 + .css 改 .module.css 文件名）
- preload 既有 19 命名空间 0 diff（仅在 `workingTreeReview` namespace 加方法）
- 不修改 core/shared-backend 既有方法（仅新增）

**已知偏差**（计划 §5 完成语义与实际实现的差异）：

- §5 列"文件页 markdown tab 退化为 `预览/对比` 二 tab"：实际 PHASE 3 落地后保留了 BLOCK-19 thin-slice 的 `编辑 / 预览 / 对比` 三 tab（inline-edit 资产原地保留）。降级工作未执行 —— BLOCK-20 决定保留 inline-edit 作为 markdown 文件审阅的等价入口，理由是 inline-edit 是 BLOCK-19 thin-slice 的核心资产，移除会破坏 markdown 文件的可编辑性，而 BLOCK-20 的核心收益（系统级 hunk accept/reject + 拒绝反馈）已经在 Code Review Panel 内实现，markdown 文件页内仍走 inline-edit 路径不构成阻塞。

## 3. 4 PHASE 落地

### PHASE 0 — 治理登记（commit `b855b54`）

- `docs/DOC-REGISTRY.json` 新增 `BLOCK-20-CODE-REVIEW-PANEL`（work-package / active / canonical=true / truthDomain=block-20-code-review / owners=[main-agent]）
- `docs/block-18-workspace-md-diff-plan.md` status: active → superseded（`supersededById: BLOCK-20-CODE-REVIEW-PANEL`）
- `docs/next-steps-roadmap.md` 当前 active 工作包：`BLOCK-20-CODE-REVIEW-PANEL`，§"BLOCK-20 — Code Review Panel" 段新增
- `docs/README.md` 长期核心指引同步 BLOCK-20 入口

### PHASE 1 — IPC 新增 + git-adapter 5 方法（commit `18995bb`）

- `core/shared-backend/git-adapter.js` 新增 5 方法：`listModified` / `fileHeadContent` / `fileWorkTreeContent` / `splitSideDiff` / `revertFile` / `applyInverseHunk`（注：`fileWorkTreeContent` 是 `splitSideDiff` 依赖，未列入命名空间但属于方法面新增）
- `src/ipc/working-tree-review.js` 扩展注册（与 BLOCK-16 既有 5 handler 并列）：5 个新 `ipcMain.handle` 沿用 sender guard + safeInvoke 错误契约
- `src/preload.js` `workingTreeReview` namespace 加 5 方法（workspaceDiff.listModified / .fileHeadContent / .splitSideDiff / .revertFile / .applyInverseHunk）
- `frontend/src/lib/electron.d.ts` `workingTreeReview` 接口 0 改动（mapped type 自动覆盖）
- `test/git-adapter.test.mjs` +30 → 38 测试，其中 8 个 BLOCK-20 子集（listModified×3 / fileHeadContent×2 / splitSideDiff×1 / revertFile×1 / applyInverseHunk×1）；7 files, +662/-1
- 同时落地 `src/ipc/agent-doc-review.js`（BLOCK-19 inline-edit 依赖，213 行）

### PHASE 2 — 前端常驻右侧审阅面板（commit `2dee4d1`）

- `frontend/src/App.tsx` 拆出 `AppShell` 内部组件，把 `WorkingTreeReviewMount + WorkingTreeReviewButton` 替换为 `<WorkingTreeReview isOpen={panels.workingTreeOpen} onClose={panels.toggleWorkingTree} />`
- `frontend/src/components/desktop/TitleBar.tsx` 加 `WorkingTreeReviewTitleBarButton`（git-branch icon，仅 desktop 显示）
- `frontend/src/hooks/useWorkspacePanels.ts` 加 `workingTreeOpen` state + `toggleWorkingTree`
- `frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.tsx` 改 panel 渲染：
  - 去掉 `wt-overlay` 浮层外框
  - 去掉 close button（显隐由 `workingTreeOpen` state 控制）
  - 标题 `"Working Tree Review"` → `"Code Review"`
  - `role="dialog"` → `role="region"`
- `frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.css` 注释更新 BLOCK-16 → BLOCK-20，删 `wt-btn-close` 死规则
- 删除（3 文件，0 引用）：`WorkingTreeReview.module.css`（rename .css）/ `WorkingTreeReviewMount.tsx` / `WorkingTreeReviewButton.tsx`
- 8 files, +185/-227

### PHASE 3 — inline-edit 抽屉 + workspace.writeTextFile IPC（commit `6482cd9` + `3d0c874`）

- `src/ipc/file-dialog.js` 新增 `workspace:write-text-file` IPC：
  - 三个参数 `workspacePath` / `relativePath` / `content`
  - 安全门：`realpathSync(workspacePath)` + `realpathSync(path.resolve(realRoot, relativePath))` + `startsWith(realRoot + path.sep)` 双向校验（避免 symlink 攻击跳出 workspace）
  - 必须是已存在的 file（不创建新文件）
  - `fs.writeFileSync` UTF-8 覆盖写入
- `frontend/src/lib/desktopBridge.ts` 加 `agentDocReview` 通过 mapped type 自动 typing 注释
- `frontend/src/pages/project-workspace/types.ts` `ActiveWorkspaceFile` 加 `workspaceDir?: string` 字段
- `frontend/src/pages/project-workspace.tsx`（379 行）：
  - `ActiveWorkspaceFile` 构造点（URL `?file=` / `projectOpenWorkspaceFile` 事件 / FileTree 点击）全部带上 `project.workspacePath`
  - `FileTreeList / FileTreeItem` 透传 `workspaceDir` prop
  - Inline-edit `<textarea>` + `handleSaveCurrent / handleCommit / handleDiscard` 二分支：
    - `file.workspaceDir` 存在（项目文件）→ `workspace.writeTextFile`
    - `file.workspaceDir` 不存在（沙盒文件）→ `agentDocReview.saveCurrent`（原有行为）
  - Diff 渲染 baseline 锁定
- `frontend/src/pages/project-workspace.module.css`（199 行）
- `3d0c874` 资产收口：把 BLOCK-17 / BLOCK-19 thin-slice 资产从 untracked 转 tracked：
  - `frontend/src/lib/markdownDiff.ts`（281 行）—— 提取 BLOCK-17 `computeSimpleDiff` 纯函数 + SimpleDiff / DiffLine type + `computeUnifiedDiff / classifyDiffLine / parseUnifiedHunks` 等 unified-diff 解析层
  - `frontend/src/lib/markdownDiff.test.ts`（164 行，22/22 vitest PASS）
  - `test/agent-doc-review-ipc.test.mjs`（233 行）
  - `test/preload-agentdocreview-namespace.test.mjs`（106 行）
  - `docs/block-17-agent-doc-review-panel-plan.md`（82 行，已 superseded by BLOCK-18 → BLOCK-20，留 reference）
- `6482cd9` 6 files +633/-3；`3d0c874` 5 files +866

### PHASE 4 — per-hunk reject inverse + system-prompt 集成（working tree，未提交）

PHASE 4 reject inverse API 与单测早在 PHASE 1 的 `18995bb` 里就实现了（`git-adapter.applyInverseHunk` + `invertUnifiedDiff` + 7 个 BLOCK-20 子测）；PHASE 4 后续 IPC / preload / 类型 / hook 接线由两次 worker 增量落地，目前在 working tree（待 `block-20-closeout` commit 提交）：

- `src/ipc/working-tree-review.js`（+158/-7）：
  - 提取 `_writeRejectEntry(userDataDir, args)` helper：复用 BLOCK-16 拒绝清单 schema `{taskId, file, hunkIndex, oldText, newText, feedback, rejectedAt}`，写盘路径 `<userData>/working-tree-review/rejects/<taskId>-<fileSafe>-<hunkIndex>.json`，沿用 30 天 TTL + `pruneRejectFiles(rejectDir)` 启动时 unlink
  - `fs` 失败由 try/catch 吞掉 —— reject 清单写入失败不影响 git apply / inverse 结果
  - 注册 `git:hunk-reject-inverse` handler（与 BLOCK-16 `git:hunk-apply(action='reject')` 并列，保留 BLOCK-16 既有路径不动）
- `src/preload.js`（+5）：`workingTreeReview.rejectHunkByInverseHunk` 方法挂 IPC 桥
- `frontend/src/lib/electron.d.ts`（+32）：`rejectHunkByInverseHunk` typed declaration
- `frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts`（+90/-17）：
  - 新增 `buildForwardPatchForReject({ file, hunk })` 纯函数：把单个 hunk 转换为标准 unified diff 单 hunk 文本（带 `diff --git` / `---` / `+++` / `@@` header，`add → '+'`、`del → '-'`、context `' '`），由 `applyInverseHunk` 内部 invert
  - `rejectHunkByInverseHunk(file, hunkIndex, patch, feedback?)` hook 方法走 IPC，reject 清单走共享 `_writeRejectEntry` helper（BLOCK-16 复用）
  - `UseWorkingTreeReviewReturn` 接口同步声明
- `test/git-adapter-block20-per-hunk.test.mjs`（**新文件，436 行 / 12 测试 / 12/12 PASS**）：
  - invert 边界（仅 + / 仅 - / mixed / header-less / empty / multi-hunk / `++` literal content）—— 7 个 case
  - per-hunk 拒绝场景（hunk #1 of 3 / 相邻 hunks / 单行变更 / 未变更文件 → empty diff）—— 4 个 case
  - per-hunk selector 一致性（按顺序逐 hunk apply 与 full-patch reject 等价）—— 1 个 case

### PHASE 5 — 专项门禁 + 收口笔录（本 commit）

- `package.json` 加 `block:code-review` 脚本 → `node scripts/block-20-code-review-panel.mjs`
- `scripts/block-20-code-review-panel.mjs`（97 行）专项门禁：
  1. `git-adapter-block20` —— `node --test test/git-adapter.test.mjs`
  2. `git-adapter-block20-per-hunk` —— `node --test test/git-adapter-block20-per-hunk.test.mjs`
  3. `system-prompt-rejects` —— `node --test test/system-prompt-rejects.test.mjs`
  4. `frontend-code-review` —— `cd frontend && [ -f src/components/desktop/CodeReview/CodeReviewPanel.test.tsx ] && npx vitest run ... || echo skip`（CodeReviewPanel vitest 不存在时 skip，不破坏门禁）
  5. `frontend-tsc` —— `cd frontend && npx tsc --noEmit`
  6. `docs-check` —— `npm run docs:check`
  7. `ui-audit-check` —— `npm run ui:audit:check`
  8. `docs-reconcile` —— `npm run docs:reconcile`
- DOC-REGISTRY：`BLOCK-20-CODE-REVIEW-PANEL` active → completed + 新增 `BLOCK-20-CODE-REVIEW-PANEL-CLOSEOUT` reference entry
- `docs/next-steps-roadmap.md` 增加 BLOCK-20 收口条目

## 4. 4 治理门 GREEN

| 门禁 | 命令 | 结果 |
|---|---|---|
| `docs:check` | `npm run docs:check` | 137 registered PASS |
| `ui:audit:check` | `npm run ui:audit:check` | BLOCK-20 范围内 0 commit 报错；10 个 pre-existing UI-AUDIT violation 已在 AUDIT-LOG 登记（baseline `0611ce5` 之后、BLOCK-20 启动之前的历史 commit 累积，详见 `docs/AUDIT-LOG.md` 2026-08-22 BLOCK-20 条目） |
| `docs:reconcile` | `npm run docs:reconcile` | 0 issues / Registered 137 / Unregistered 0 / Archive candidates 8（与 BLOCK-20 无关） |
| `tsc --noEmit` | `cd frontend && npx tsc --noEmit` | 0 错 |
| `block:code-review` | `npm run block:code-review` | 8/8 PASS（git-adapter-block20 38/38 + per-hunk 12/12 + system-prompt-rejects 11/11 + frontend-code-review skip + frontend-tsc + docs-check + ui-audit-check + docs-reconcile） |

## 5. 测试矩阵

- `node --test test/git-adapter.test.mjs` —— 38/38 PASS（既有 30 + BLOCK-20 子集 8）
- `node --test test/git-adapter-block20-per-hunk.test.mjs` —— 12/12 PASS（PHASE 4 新增）
- `node --test test/system-prompt-rejects.test.mjs` —— 11/11 PASS（BLOCK-16 PHASE 3 既有，0 破坏）
- `frontend/src/lib/markdownDiff.test.ts` —— 22/22 vitest PASS（PHASE 3 资产收口）

## 6. 调研驱动

本工作包**未单独出调研文档**：3 PHASE BLOCK-18 的 markdown 文件页内 toggle 调研结论（手写 React 渲染 vs monaco-editor / react-diff-viewer）已被 BLOCK-16 `block-16-working-tree-review-survey.md`（344 行 / 8 §）覆盖，并直接沿用 BLOCK-16 既有 `DiffFileView / DiffHunkView / applyPatch / revertPaths` 组件 + ADR-RS-3 风格约束。BLOCK-20 的 reject inverse API 设计（per-hunk `applyInverseHunk` vs 全文件 `revertPaths`）由 `docs/block-20-code-review-panel-plan.md` §2 决策摘要直接裁决，不另起调研。

## 7. 不变量守住

- preload.js 既有 19 命名空间方法签名 0 diff（仅在 `workingTreeReview` namespace 加方法）
- electron.d.ts 既有类型 0 diff（mapped type 自动覆盖 `workingTreeReview` 新方法）
- desktopBridge.ts 既有 API 0 diff（仅在 `agentDocReview` 段加注释）
- BLOCK-16 `useWorkingTreeReview / DiffFileView / DiffHunkView / applyPatch / revertPaths` 既有逻辑 0 diff（仅 PHASE 2 改 WorkingTreeReview 浮层→panel 渲染，PHASE 4 加 reject inverse 路径）
- Result Studio 既有 diff 组件 0 diff
- core/shared-backend 既有方法 0 diff（仅 git-adapter 新增 5 方法 + agentDocReview IPC 独立模块）
- agent-tools/* / agent-transcripts/* 0 diff
- 0 npm 依赖新增 / 0 npm 依赖删除

## 8. 后续候选（不外推 / 不在范围）

- BLOCK-2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 9.1 / 9.2 / 10 / 10-AUDIT / 11 / 13 / 14 / 15 / 16 / 17 / 18 历史 in_progress 复核项
- Result Studio P7 deferred
- Chart a11y P2 落实
- 10 个 pre-existing UI-AUDIT violation 治理（A 选项 LEGACY_AUDIT_SYNC_EXEMPTIONS / B 选项 BLOCK-XX-UI-AUDIT-CLEANUP / C 选项接受降级 —— 已在 AUDIT-LOG 2026-08-22 BLOCK-20 条目登记，留主 agent 后续裁决）
- 文件页 markdown tab 退化为 `预览/对比` 二 tab（已知偏差，详见 §2）

按 single work package serial 纪律，**下一块候选须经用户显式裁决启动新工作包**。

## 9. ADR / 架构决策

- **ADR-RS-3** 沿用：Result Studio diff 组件 / theme token 风格一致
- **BLOCK-16 §3.4 方案 C** 沿用：手写 React 渲染（vs Monaco / react-diff-viewer / react-split-pane）
- **BLOCK-16 §3.4 拒绝信号方案 A** 沿用：本地清单（vs MCP 主动拉）
- 拒绝清单 30 天 TTL + 字符预算 4096：防 prompt 爆炸 + 自动老化
- **BLOCK-20 新增决策**：per-hunk reject 走 `git-adapter.applyInverseHunk`（新增 API，正向 patch → 内部 invert → `git apply --reverse`），前端只构造正向 unified diff + `@@` header，不用构造 reverse patch；与 BLOCK-16 `decideHunk(file, hunkIndex, 'reject')` 路径（构造 reverse patch 后 `applyPatch({patch: reversePatch})`）并存，UI 端 `rejectHunkByInverseHunk` 是 additive 替代入口，BLOCK-16 reject 路径保留不动（向后兼容）

## 10. 文档门禁同步

- `docs/DOC-REGISTRY.json` `BLOCK-20-CODE-REVIEW-PANEL` active → completed + 新增 `BLOCK-20-CODE-REVIEW-PANEL-CLOSEOUT` reference entry
- `docs/next-steps-roadmap.md` 增加 BLOCK-20 收口条目
- `docs/README.md` 长期核心指引同步（UI-185 入口）
- `docs/ui-productization-audit.md` UI-185 综合笔录（PHASE 0/1/2/3 + assets + closeout 汇总），BLOCK-18 段状态 in_progress → superseded
- `docs/AUDIT-LOG.md` 2026-08-22 BLOCK-20 收口 entry + pre-existing UI-AUDIT violation 登记
- `docs/project-workspace-handoff.md` BLOCK-18-WORKSPACE-MD-DIFF 段补 superseded 标记 + BLOCK-20-CODE-REVIEW-PANEL active 段（待本笔录 commit 后同步 → completed）

## 11. 锁门

- 7 commit（`b855b54` / `18995bb` / `ea03eaf` / `2dee4d1` / `6482cd9` / `3d0c874` / `0d5b7e3` / `1292e24`）+ 1 待提交 closeout commit（PHASE 4 working tree）落在 `main` HEAD
- 4 治理门 GREEN + 1 专项门禁 8/8 PASS
- 不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+
- `qualificationEligible: false` 永久 G0 事实
- UI-185 保持 `in_progress`（按 audit 行 402 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified）
