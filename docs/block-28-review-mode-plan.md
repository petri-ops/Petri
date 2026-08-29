# BLOCK-28-REVIEW-MODE — 主区一级审阅模式（方案 B）Plan

- **Plan ID**: `BLOCK-28-REVIEW-MODE`
- **状态**: `completed`（2026-08-29 启动并收口；UI-204~207 dev Electron verified，证据 `acceptance/ui-204/`）
- **truthDomain**: `block-28-review-mode`
- **阶段**: P0~P5 全部收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与目标

当前代码审阅面是 TitleBar 按钮开关的侧边抽屉（`WorkingTreeReview.tsx`，BLOCK-20 形态）。
本工作包把它升级为**主区一级审阅模式**（对标 VS Code SCM / PR 页面的空间与动线）：

- 进入方式沿用 TitleBar 审阅按钮：点击打开主区模式（路由 `/review`），再点返回原页面。
- 顶部 summary 条 + 左栏文件树 + 右栏大空间 diff + 底部内嵌提交框。
- 保留确定性审阅内核（hunk accept/reject、A/Y/R/↑↓ 键盘流、commit review），零模型参与。
- **严禁重新引入 AI 审阅**（BLOCK-27 用户裁决）：不加模型调用、不加 rubric、不加 findings。

## 2. 范围 / 非范围

**范围内**：
- 新路由 `/review`（App 级主区模式，与 `/skills` 同级；WTR 审阅对象是应用工作区仓库，
  非项目作用域，故不用 `/project/:id/*` splat mode）。
- 新 `pages/review.tsx`（ReviewModePage）+ WorkingTreeReview 目录下新增模式组件
  （summary 条 / 文件树 / 提交框 / 滚动标记条 / hunk 悬浮控件扩展）。
- TitleBar 审阅按钮改为 `/review` 导航 + agent task-done 圆点提示。
- 旧抽屉退役（见 §4 决策 D1）。
- CodeMirrorEditor 少量 additive props（extraExtensions / diffOptions）。

**非范围（不外推）**：
- 0 新 npm 依赖；0 新增 IPC（复用 `git:working-tree-*` 全家桶 + preload `workingTreeReview`
  命名空间；仅在确有只读枚举缺口时按 BLOCK-20 惯例同步 preload + electron.d.ts）。
- 不动 editor/CodeMirror 既有扩展行为（BLOCK-22 面）；不重激活 BLOCK-2~27 已收口工作包；
  不触碰 agent-tools/* / agent-transcripts/* / core/shared-backend/*；
  packaged / Provider / GA / P7 / notarization / dist staleness G1+。

## 3. 复用资产（已核实）

- `useWorkingTreeReview.ts`：status/diff/decisions/commitReview/revertAll 全量保留复用。
- `CodeMirrorDiffView.tsx`：HEAD vs WORKTREE 双读 + CodeMirrorEditor inline-diff，复用。
- IPC（`src/ipc/working-tree-review.js`，0 改动）：working-tree-status / working-tree-diff
  （diffForReview = `git diff HEAD -- <paths>`，commit c228beb 修复必须保留）/
  file-content / list-modified / file-head-content / split-side-diff / revert-file /
  apply-inverse-hunk / hunk-reject-inverse / commit-review。
- `@codemirror/merge@6.12.2`：`unifiedMergeView` 支持 `collapseUnchanged:{margin,minSize}` +
  `uncollapseUnchanged` 命令 → 「hunk 间展开上下文」零依赖原生实现。
- 主区模式先例：App.tsx `<Route path="/skills">`；workspace splat mode 仅作风格参照。

## 4. 架构决策

**D1 — 旧抽屉退役（P0 建议，用户已倾向）**：模式落地后**删除**侧边抽屉形态
（`WorkingTreeReview.tsx` 组件 + App.tsx 挂载点），保留 hook / diff 视图 / 行内编辑抽屉
（CodeReviewDrawer）/ CSS。理由：
1. 双形态双维护成本（两套布局 × 每次交互改动 × UI 台账双倍面积）；
2. 主区模式是抽屉的功能超集（同 hook、同 IPC、同键盘流）；
3. 行为变化点：agent task-done 不再自动弹出浮层，改为 TitleBar 按钮圆点提示
   （主区模式自动导航会打断用户当前工作流，属破坏性行为）。

**D2 — 路由层级**：`/review` 为 App 级一级路由。理由：审阅对象是 `app.getAppPath()`
工作区仓库（resolveGitAdapter），与 project 无关；塞进 `/project/:id/*` 会伪造项目作用域。

**D3 — hunk 决策对齐**：键盘 A/Y/R 与悬浮按钮统一用 git hunk index（`file#hunkIndex`
决策键，与现有 decisions/commitReview 契约一致）。悬浮按钮经 additive prop
`extraExtensions` 注入 review 层自有 decoration 扩展（不使用 merge view 内建
`mergeControls`——它编辑的是编辑器文档而非磁盘，与决策模型冲突）。

## 5. 阶段划分（串行，每阶段一提交）

| 阶段 | 内容 | UI 编号 |
| --- | --- | --- |
| P0 | 治理登记：本 plan + DOC-REGISTRY active + README 入口 + AUDIT-LOG 启动行 | — |
| P1 | 主区模式骨架：`/review` 路由 + ReviewModePage 布局 + TitleBar 导航 + 抽屉退役 + Esc 语义 + 空态 | UI-204 |
| P2 | 文件树：M/A/D 徽标、每文件 +N −M、目录分组折叠、已审标记（审完置灰折叠） | UI-205 |
| P3 | diff 区：sticky 文件头、hunk 悬浮 accept/reject、滚动标记条、collapseUnchanged 展开上下文 | UI-206 |
| P4 | 内嵌提交框（message + ⌘+Enter + 面板内轻提示）、进度 n/m、键盘流完备 | UI-207 |
| P5 | dev Electron 实机验收（CDP：intent-to-add fixture）+ 台账收口 + 提交推送 | — |

## 6. UI 台账纪律

每个含前端 UI 改动的提交**同一提交内**更新 `docs/ui-productization-audit.md` 且提交信息
含 UI-###（UI-204 起）。实机验收前各 UI 条目 `in_progress`；P5 实机证据
`acceptance/ui-204/`（passed:true，qualificationEligible:false）落地后统一转 `verified`。

## 7. 验证与门禁（最小充分）

- 每阶段：`cd frontend && npx tsc --noEmit` = 0；定向 vitest
  （WorkingTreeReview/、CodeMirror 相关、触及页面）；node --check 触及 ipc/preload（如有）。
- 每提交：`npm run docs:check` + `npm run ui:audit:check`。
- 不跑全量 `npm run check` / `npm run test:all:workspace`。
- P5：`BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev`，
  intent-to-add fixture（`git add -N`，验收后删除）制造真实 diff，CDP 驱动验证
  布局/统计/悬浮按钮/标记条/进度/内嵌提交全链 + 截图与 DOM 证据落 `acceptance/ui-204/`。
- WTR 组件实机验证前干净 reload 页面（HMR 状态劣化前科）。

## 8. 完成语义

- 全部 5 阶段收口；working tree 干净；origin/main 同步；无 active 工作包。
- 台账：roadmap / handoff / AUDIT-LOG / DOC-REGISTRY completed / ui-audit verified。
- `npm run docs:reconcile` + `npm run docs:check` + `npm run ui:audit:check` +
  `git diff --check` 全绿。
- 一句固定话术收口：G0 开发期常态 · 不外推 packaged/Provider/GA.

## 9. 风险

- merge view chunks 与 git hunks 可能不逐一对齐（编辑器按文本自算）→ 悬浮按钮按
  git hunk 定位，二者视觉可能重叠但语义以 git hunk 为准。
- `collapseUnchanged` 与自定义 decoration 的行位在折叠时会偏移 → 悬浮按钮 decoration
  绑定 hunk 首行行位，折叠区域不含 hunk 行（merge view 只折叠 unchanged 区），理论安全，
  P3 实测确认。
- dev 启动「port 3001 occupied; using xxx」为正常形态；清理 dev 时按端口
  `lsof -t | xargs kill` 补刀孤儿进程。
