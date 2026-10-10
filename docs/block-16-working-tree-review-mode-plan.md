---
id: BLOCK-16-WORKING-TREE-REVIEW-MODE
status: planning
truthDomain: block-16-working-tree-review
planVersion: v0.1
createdAt: 2026-08-19
governingDocs:
  survey: docs/block-16-working-tree-review-survey.md
  registry: docs/DOC-REGISTRY.json
  auditLog: docs/AUDIT-LOG.md
  roadmap: docs/next-steps-roadmap.md
---

# BLOCK-16 · Working Tree Review Mode — 计划 v0.1

## 1. 目标

为 Petri Desktop 补齐"AI Agent 完成一次任务后，弹出 PR-style diff 审阅浮层"的体验：用户可对 working tree 改动按 **hunk 级别**批准/拒绝/回滚，拒绝信号写入本机清单并通过 `system-prompt` 注入让 AI 在下一轮对话里**重新生成**。

**v1 thin-slice 范围**（不含 G1+ 阶段事项）：
- 5 条 IPC invoke/handle 通道 + 1 条 main→renderer 通知事件
- `<WorkingTreeReviewMount />` 全屏模态浮层（手写 React diff 渲染）
- hunk accept / reject UI（含行级 +/- 颜色、行号、scope、CodeHighlight 复用）
- `agent:task-done` typed event + 工具栏手动按钮入口
- hunk 拒绝清单（`<dataDir>/working-tree-review/rejects/<taskId>.json`）+ system-prompt 注入
- 专项门禁 `npm run block:working-tree-review` + `docs:check` + `ui:audit:check` 必跑

## 2. 决策摘要（基于调研 + 用户裁决）

| 维度 | 决策 |
|------|------|
| Diff 渲染 | **方案 C** — 手写 React 渲染，零新依赖，与 ADR-RS-3 + 既有 Result Studio diff 风格对齐 |
| v1 范围 | **thin-slice** — IPC + 浮层 + accept/reject UI + agent-done 事件 + 拒绝清单 + system-prompt 注入 |
| 拒绝信号 | **本机清单 + system-prompt 注入**（方案 ① 基线），方案 ② MCP 工具留 BLOCK-16.x 增量 |
| 触发 | **两者都有**：agent-done 自动 + 工具栏手动按钮 |

详细调研：`docs/block-16-working-tree-review-survey.md`（344 行 / 8 §）

## 3. 不在范围（不外推 / 不重做）

按 AGENTS.md §"当前阶段纪律" + 调研报告 §7 严格执行：

- 不引入 git 库（simple-git / isomorphic-git / nodegit / dugite）— ADR-RS-3 已固化
- 不引入 monaco-editor / react-diff-viewer — 保持零新依赖
- 不实现 Provider 矩阵 / packaged Electron 公证 / GA / notarization / dist staleness — G1+ 阶段事项
- 不修改 Result Studio 既有 diff 渲染（ChangeSet / Revision / Compare）
- 不实现 hunk 自动 merge（auto-merge conflict）
- 不实现跨仓库 working tree 审阅
- 不重写 backend IPC 子进程边界（继续走 `core/shared-backend/git-adapter.js` execFileSync 风格）
- 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15（按单工作包串行纪律）

## 4. 不变量守住

不修改 / 不破坏：
- `src/preload.js` 的 `petriDesktop.*` 既有 19 个命名空间（**只新增** 不覆盖）
- `frontend/src/lib/electron.d.ts` 既有 IPC 类型（**只 extend** `WorkingTreeReview*` 子树）
- `frontend/src/lib/desktopBridge.ts` 既有 `getBridge / requireBridge / isDesktop`
- `core/shared-backend/git-adapter.js`（**只读取 + 调用**已有 `diff / stage / status`；BLOCK-16 范围内**新增** `applyPatch / revertPaths` 两个方法）
- `frontend/src/components/result-studio/*` 既有 diff 组件（**不复用**其内部组件，避免反向耦合）
- Electron CSP / sandbox / contextIsolation 既有配置

## 5. PHASE 划分

### PHASE 0 · 计划登记 + 门禁基线

**主 Agent 直做**：
1. 在 `docs/DOC-REGISTRY.json` 登记：
   - `BLOCK-16-WORKING-TREE-REVIEW-MODE-PLAN`（kind=`living-plan` / status=`active` / canonical=true）
   - `BLOCK-16-WORKING-TREE-REVIEW-MODE`（kind=`work-package` / status=`active` / canonical=true / archivePolicy=`retain_stable_path`）
2. 在 `docs/next-steps-roadmap.md` 增加 **BLOCK-16-WORKING-TREE-REVIEW-MODE 工作包已启动** 条目（按现有 active WP 条目格式）
3. 在 `docs/README.md` 长期核心指引新增条目 6（如已有同位条目则不重复）
4. 跑 `npm run docs:check` 与 `npm run docs:reconcile` 确认基线 GREEN

**完成语义**：registry 4 字段通过 + roadmap 同步 + docs:check PASS

### PHASE 1 · IPC channel + 共享解析器层

**主 Agent 直做**（5 个文件 +50/-10 量级）：

1. **`core/shared-backend/git-adapter.js`**：在已有 `diff / stage / status` 旁新增 2 个方法
   - `applyPatch({ repoPath, patch, dryRun })`：走 `git apply --check` + `git apply`，失败抛 `GIT_APPLY_FAILED` 错误（含 stderr 节选）
   - `revertPaths({ repoPath, paths })`：走 `git checkout HEAD -- <safe pathspec>`，路径白名单
   - 与既有 `execFileSync + 数组参数 + 路径白名单` 风格一致
   - **不引入** 任何新依赖

2. **`src/ipc/working-tree-review.js`**（新建 ~150 行）：
   - `setupWorkingTreeReviewIpc({ mainWindow })`
   - 5 条 handle：
     - `git:working-tree-status` → `git-adapter.status()`
     - `git:working-tree-diff` → `git-adapter.diff()` + `diff-helpers.parseUnifiedHunks`
     - `git:working-tree-file-content` → `git-adapter.showFile()`（HEAD / WORKTREE 二选一）
     - `git:hunk-apply` → `git-adapter.applyPatch({ patch: reversePatch })` + reject 清单写入
     - `git:working-tree-revert` → `git-adapter.revertPaths()`
   - 1 条通知：`webContents.send('agent:task-done', { taskId, filesChanged })`
   - 路径白名单走 `core/r-server/mcp/ide-tools/path-allowlist.js`（cwd / os.tmpdir / ~/.petri/logs）
   - **Sender guard**：参考 BLOCK-3 `_sender-guard.js`（同包已有），每个 handler 调用 `_assertPetriSender(event)`

3. **`src/main.js` 装配**：在 `app.whenReady().then(...)` 内增加一行 `setupWorkingTreeReviewIpc({ mainWindow })`，与既有 `setupXxxIpc` 风格一致

4. **`src/preload.js`**：在 `window.petriDesktop` 的子树下增加 `workingTreeReview.*` 5 个 invoke + 1 个 `onTaskDone(callback)` 通知
   - 命名空间：`workingTreeReview.{status, diff, fileContent, applyHunk, revert, onTaskDone}`
   - **不动** 既有 19 个命名空间的方法签名

5. **`frontend/src/lib/electron.d.ts`**：在 `Window.petriDesktop` 类型下 extend `workingTreeReview: { ... }`（5 个方法 + 1 个事件订阅）

**PHASE 1 验证**（不跑全量）：
- `node --check src/ipc/working-tree-review.js` 必须 PASS
- `npm run tsc`（前端类型）必须 0
- `node --test test/git-adapter.test.mjs`（如果存在）或新建 `test/git-adapter-block16.test.mjs` 验证新增的 `applyPatch / revertPaths`
- `npm run test:files --prefix frontend -- src/lib/desktopBridge.test.ts`（如果存在）

### PHASE 2 · 前端浮层组件（手写 diff 渲染）

**主 Agent 直做**（4 个新文件 +2 个改 +600/-30 量级）：

1. **`frontend/src/lib/desktopBridge.ts`**：在 `bridge.workingTreeReview` 子树下加 5 个 typed wrapper + 1 个事件订阅 helper（与既有 `bridge.skills` 风格一致）

2. **`frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.tsx`**（新建 ~250 行）：
   - 入口组件
   - 接 `useWorkingTreeReview()` hook（见下）
   - 顶部工具栏：关闭按钮 + "批准全部" + "回滚全部" + 当前 taskId
   - 中部 file list + 选中 file 的 hunk list
   - 底部状态栏：X hunks pending / Y approved / Z rejected

3. **`frontend/src/components/desktop/WorkingTreeReview/DiffFileView.tsx`**（新建 ~150 行）：
   - 选中 file 的统一 diff 渲染（split view + 行号 + +/- 颜色）
   - 每个 hunk 头部有 `[Approve] [Reject] [Skip]` 按钮
   - reject 时弹出 textarea 输入 feedback（可选）
   - 复用 `frontend/src/components/ui/CodeHighlight.tsx`

4. **`frontend/src/components/desktop/WorkingTreeReview/DiffHunkView.tsx`**（新建 ~100 行）：
   - 单一 hunk 渲染（line-by-line + 行号 + scope 标签）
   - 参考 `frontend/src/components/result-studio/ResultStudioChangeSetPanel.module.css` 颜色

5. **`frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts`**（新建 ~120 行）：
   - hook：管理 `useState<{ files, selectedFile, selectedHunks, decisions, taskId }>`
   - 调 `bridge.workingTreeReview.diff()` 拉数据
   - `accept / reject` 决策 → 调 `bridge.workingTreeReview.applyHunk()`
   - 订阅 `bridge.workingTreeReview.onTaskDone(callback)` → 自动 `setOpen(true)`

6. **`frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.module.css`**（新建 ~200 行）：
   - 全屏 overlay（`position: fixed; inset: 0; z-index: 9500`）— 比 `LoginModal`（10000）低，确保不会被 Login 遮挡；高于 SimpleChat preview（8000）
   - container：max-width 1200px、margin auto、max-height 90vh、滚动内部
   - 主题色：与 Result Studio diff 风格一致（green +/- / red -）
   - 行级背景：context 行透明、`+` 行绿底浅、`-` 行红底浅

7. **`frontend/src/App.tsx`**：在 `<App />` 根 mount `<WorkingTreeReviewMount />`（与 `<SimpleChat />` 同级，纯挂载、不绑路由）

8. **`frontend/src/components/desktop/Toolbar/WorkingTreeReviewButton.tsx`**（新建 ~30 行）：
   - 工具栏手动按钮（位置与 Copilot 入口并列或 Workspace toolbar）
   - `onClick` → 通过 `useWorkingTreeReview().open()` 弹出

**PHASE 2 验证**：
- `npm run tsc` 0
- `npm run test:files --prefix frontend -- src/components/desktop/WorkingTreeReview`（新建组件 + hook 的 Vitest 子集）
- `npm run ui:audit:check` 必须 PASS（新增 UI 组件会自动登记到 UI-REGISTRY）
- 视觉不测（dev Electron 实机）— G0 边界内 dev Electron `verified` 即视为当前最高证据等级

### PHASE 3 · agent-done 事件接入 + 拒绝清单 + system-prompt 注入

**主 Agent 直做 + worker 委派混合**：

1. **agent-done 事件广播**：
   - **主 Agent** 改 `frontend/src/components/copilot/copilotClient.ts`：在 SSE `event='done'` 的分支里调 `window.dispatchEvent(new CustomEvent('petri:agent-task-done', { detail: { taskId, filesChanged } }))`
   - **主 Agent** 在 `frontend/src/lib/events.ts` 的 typed event bus 增加 `'agent-task-done'` 事件常量 + type
   - **worker** 在 `src/main.js`（或 `src/ipc/working-tree-review.js`）增加 SSE → main IPC 桥（如果 SSE 不在主进程）：MCP SSE listener → `webContents.send('agent:task-done', ...)`
   - **不引入** 新依赖；沿用既有 `petriEvents` typed bus 模式

2. **hunk 拒绝清单**：
   - **主 Agent** 在 `frontend/src/components/desktop/WorkingTreeReview/DiffFileView.tsx` 的 reject 路径里调 `bridge.workingTreeReview.applyHunk({ ..., action: 'reject' })`
   - **主 Agent** 在 `src/ipc/working-tree-review.js` 的 `git:hunk-apply` handler 实现里：当 `action='reject'` 时写 `<dataDir>/working-tree-review/rejects/<taskId>-<file>-<hunkIndex>.json`
   - **路径脱敏**走 `core/shared-backend/redaction.js`（与 diagnostics 同模式）
   - **LRU 老化**：每个 reject 文件加 TTL 30 天；启动时清理过期

3. **system-prompt 注入**：
   - **worker** 改 `core/r-server/helpers/system-prompt.js`：在既有 result-context 注入段旁增加 reject-list 注入：
     ```
     <working-tree-rejects>
     The user has rejected the following hunks from previous tasks. Re-generate them considering the feedback:
     - taskId=T1, file=src/foo.ts, hunkIndex=0, feedback="..."
     ...
     </working-tree-rejects>
     ```
   - **主 Agent** 确认注入位置与既有 result-context 注入段并列、不冲突
   - **不外推** Provider / packaged / GA

**PHASE 3 验证**：
- `node --test test/system-prompt.test.mjs`（如果存在）或新建 `test/system-prompt-rejects.test.mjs`
- `npm run test:files --prefix frontend -- src/components/copilot/copilotClient.test.ts`（如果存在）
- `npm run docs:check` PASS（新增文档如果有）

### PHASE 4 · 专项门禁 + 收口笔录

**主 Agent 直做**：

1. **专项门禁 `npm run block:working-tree-review`**：
   - 在 `package.json` scripts 增加：
     ```json
     "block:working-tree-review": "node scripts/block-16-working-tree-review.mjs"
     ```
   - `scripts/block-16-working-tree-review.mjs`（新建 ~80 行）：
     - 串行跑：git-adapter applyPatch/revertPaths 子集测试 + DiffFileView/DiffHunkView Vitest 子集 + system-prompt-rejects 子集测试 + `docs:check` + `ui:audit:check`
     - 任一失败 → 退出码 1
   - **不跑全量** `npm run check` / `npm run test:all:workspace`

2. **closeout 笔录 `docs/block-16-working-tree-review-mode-closeout.md`**（新建）：
   - 11 节格式（参照 `block-9-1-main-js-split-closeout.md`）
   - G0 边界用语："G0 开发期常态 · 不外推 packaged/Provider/GA" 一句即可
   - 列出所有 commit / 验证证据 / 不变量守住证明

3. **DOC-REGISTRY 收口**：
   - `BLOCK-16-WORKING-TREE-REVIEW-MODE-PLAN` → status=`completed`
   - `BLOCK-16-WORKING-TREE-REVIEW-MODE` → status=`completed`
   - `BLOCK-16-WORKING-TREE-REVIEW-MODE-CLOSEOUT` → kind=`handoff` / status=`completed` / canonical=true

4. **`docs/next-steps-roadmap.md`** 增加 **BLOCK-16 收口** 条目，模板同 BLOCK-9.1 / 9.2

5. **`docs/README.md`** 长期核心指引同步（如有新增条目）

**PHASE 4 验证**：
- `npm run block:working-tree-review` PASS
- `npm run docs:check` PASS
- `npm run ui:audit:check` PASS

## 6. 完成语义

| 项 | 期望 |
|---|---|
| 新增 IPC channel | 5 条 invoke/handle + 1 条 main→renderer 通知 |
| 新增 IPC handler 文件 | `src/ipc/working-tree-review.js`（独立模块） |
| git-adapter 新方法 | `applyPatch + revertPaths`（继承 execFileSync 风格） |
| 新增前端组件 | `<WorkingTreeReviewMount />` + `DiffFileView` + `DiffHunkView` + `WorkingTreeReviewButton` + `useWorkingTreeReview` hook |
| 新增样式 | `WorkingTreeReview.module.css`（200 行内） |
| agent-done 事件 | typed event bus `'agent-task-done'` + main→renderer IPC 桥 |
| 拒绝清单 | `<dataDir>/working-tree-review/rejects/*.json`（30 天 TTL） |
| system-prompt 注入 | 与 result-context 注入并列的 `<working-tree-rejects>` 段 |
| 专项门禁 | `npm run block:working-tree-review` |
| 治理门禁 | `docs:check` + `ui:audit:check` 必跑且 PASS |
| 既有 vitest | 0 失败 / 0 改动 |
| 不变量守住 | preload.js / 既有 electron.d.ts 子树 / desktopBridge.ts 既有 API 0 diff |
| closeout 笔录 | `block-16-working-tree-review-mode-closeout.md` 11 节 |

## 7. 风险与边界

### 7.1 Electron 安全
- 主进程执行 `git` 子进程走 `execFileSync + 数组参数`（ADR-RS-3）
- 路径入参经 `core/r-server/mcp/ide-tools/path-allowlist.js`
- IPC channel 在 `src/preload.js` 显式 enumerate
- CSP / sandbox / contextIsolation 不动
- Sender guard 复用既有 `_sender-guard.js`

### 7.2 性能
- 千文件 `git diff` 实测 ~1-2s（基于既有 `ide_git_diff` 测试覆盖）
- 30s timeout + 进度事件（参考 `plugin:install-progress`）
- `MAX_LINES_HARD_CAP = 5000` 沿用
- 大文件 > 1MB 只返回元信息（行数 + binary 标记 + 截断）
- 二进制文件单独走 `{ binary: true, path }` 占位

### 7.3 G0 边界外
- 不依赖 Provider / packaged / GA / notarization
- 不引入新依赖（按方案 C）
- 不修改 CSP / BrowserWindow / preload sandbox 标志
- 不写 Result Studio qualification / packaged UI / Provider 矩阵相关 evidence

### 7.4 单工作包串行
- BLOCK-16 启动后是**当前唯一** active 工作包
- 收口前不启动 G1+ / Provider / packaged 相关 WP
- 定向测试优先；全量测试默认不跑

## 8. 测试纪律

- **定向优先**：`npm run test:changed:list` 按 `test/impact-map.json` 选最小影响范围
- **专项门禁必跑**：`npm run block:working-tree-review`（PHASE 1-3 收口前 + PHASE 4 收口时各跑一次）
- **治理门禁必跑**：`npm run docs:check` + `npm run ui:audit:check`（秒级）
- **根 `npm run check` 与全量 `npm run test:all:workspace` 默认不跑**（留给发布前 / CI）

## 9. ADR / 架构决策

- **新建** ADR 候选条目（PHASE 0 同步登记）：
  - `BLOCK-16-ADR-1`：diff 数据源（`git-adapter` 复用 + `diff-helpers` 复用）
  - `BLOCK-16-ADR-2`：hunk 拒绝信号通道（本机清单 + system-prompt 注入）
- 候选 ADR 在 PHASE 4 收口时与既有 ADR-RS-3 / SUB-15.1 一起列入 `docs/architecture-decisions.md`

## 10. 文档门禁

- PHASE 0 起：`docs/block-16-working-tree-review-mode-plan.md`（本文件）必须登记为 `living-plan` / `active` / `canonical=true`
- PHASE 4 收口：新建 `docs/block-16-working-tree-review-mode-closeout.md`（kind=`handoff`）
- 整个工作包期间：`docs:check` 必须 GREEN

## 11. 下一动作

PHASE 0 启动登记（主 Agent 直做）：
1. DOC-REGISTRY 登记本计划 + work package
2. `docs/next-steps-roadmap.md` 同步当前 active WP = BLOCK-16
3. `docs/README.md` 长期核心指引同步（如需）
4. 跑 `docs:check` + `docs:reconcile` 确认基线
5. 启动 PHASE 1 IPC + 解析器层

> **当前 active 工作包候选**：BLOCK-16-WORKING-TREE-REVIEW-MODE（v1 thin-slice 范围）
> **不外推**：Provider / packaged / GA / P7 / notarization / dist staleness / Result Studio qualification / i18n
> **不动**：preload.js / electron.d.ts / desktopBridge.ts 既有 API / Result Studio 既有 diff 渲染 / core/shared-backend/* 既有方法 / agent-tools/* / agent-transcripts/*
