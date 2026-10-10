# BLOCK-16 Working Tree Review Mode — 收口笔录

> 收口日期：2026-08-19  
> 工作包归属：BLOCK-16-WORKING-TREE-REVIEW-MODE（active → completed）  
> 阶段纪律：G0 长期开发期常态 · 不外推 packaged/Provider/GA

## 1. 摘要

BLOCK-16 落地"工作树 PR-style diff 审阅"端到端：用户启动 agent → agent 改动工作区 → SSE 收口 → 浮层自动弹出 → 用户逐 hunk accept / reject + 反馈 → reject 清单 30 天 TTL → 下次 agent prompt 自动读到拒绝反馈。

3 方案对比（Monaco / react-diff-viewer / 手写）后选 C 手写 React 渲染，0 新依赖；2 拒绝信号方案对比（本地清单 / MCP 主动拉）后选本地清单基线。4 PHASE 全部收口，4 治理门 GREEN。

## 2. 范围与不再范围

**范围内**：

- 5 IPC channel + 1 main→renderer 通知 + 1 typed event bus 事件
- 5 frontend 组件 + 1 CSS module + 1 hook（手写 diff 渲染，0 新依赖）
- git-adapter 新增 `applyPatch` / `revertPaths` 两个方法
- system-prompt 注入 `<working-tree-rejects>` 段，下次 agent 自动看到反馈
- 拒绝清单 30 天 TTL + 字符预算 4096 + 过期文件启动时 unlink
- 专项门禁 `npm run block:working-tree-review`

**不外推 / 不重做**：

- packaged / notarization / GA / P7 / dist staleness G1+ —— 用户 2026-08-15 裁决长期 G0 开发期
- Provider 矩阵 / 真实 OSS 远程接手
- Chart a11y P2 / Worktree / Monaco / react-diff-viewer 重写
- Result Studio 既有 diff 组件 0 diff
- preload 既有 19 命名空间 0 diff
- 不修改 core/shared-backend 既有方法（仅新增）

## 3. 4 PHASE 落地

### PHASE 1 — IPC channel + 共享解析器层（commit `7f94854`）

- `core/shared-backend/git-adapter.js` 新增 `applyPatch({ patch })` + `revertPaths({ paths })` 2 方法
- `src/ipc/working-tree-review.js` 329 行：5 `ipcMain.handle` + 1 `webContents.send('agent:task-done')` 通道
- `src/preload.js` 新增 `workingTreeReview` 子树：`status` / `diff` / `fileContent` / `applyHunk` / `revertPaths` / `onTaskDone` 6 方法
- `src/main.js` 装配 `setupWorkingTreeReviewIpc({ mainWindow: () => mainWindow })`
- 拒绝清单写盘：`<userData>/working-tree-review/rejects/<taskId>-<file>-<hunkIndex>.json`，30 天 TTL
- plan `docs/block-16-working-tree-review-mode-plan.md`（343 行 / 11 §） + 调研 `docs/block-16-working-tree-review-survey.md`（344 行 / 8 §）

### PHASE 2 — 前端浮层组件（commit `59aeb95`）

- `frontend/src/components/desktop/WorkingTreeReview/` 7 新模块（WorkingTreeReview / WorkingTreeReviewMount / WorkingTreeReviewButton / DiffFileView / DiffHunkView / useWorkingTreeReview + WorkingTreeReview.module.css 280 行）
- `frontend/src/lib/electron.d.ts` 新增 `workingTreeReview` 类型
- `frontend/src/App.tsx` mount `<WorkingTreeReviewMount>` + `<WorkingTreeReviewButton>`
- UI-180 in_progress 登记（沿用 BLOCK-9.2 §4 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified）

### PHASE 3 — agent-done 事件接入 + 拒绝清单 + system-prompt 注入（commit `da48006`）

- `frontend/src/lib/events.ts` 加 `agentTaskDone` 事件常量 + `AgentTaskDoneDetail` 类型 + 映射
- `frontend/src/components/copilot/copilotClient.ts` SSE 4 处 done 分支派发 petri event（primary kind only）
- `frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts` 订阅 typed event bus（主路径）+ 保留 preload 备用通道
- `core/r-server/helpers/system-prompt.js` 加 `renderWorkingTreeRejectsForPrompt` + `loadWorkingTreeRejectEntries` 2 helper + `<working-tree-rejects>` 注入段（标签 `WORKING_TREE_REJECTS_v1` / limit 10 / 单行 80 / char budget 4096）
- `core/r-server/agent-runner.js` 读 `PETRI_USER_DATA_DIR` env 注入 ctxForPrompt
- `src/main/backend-proc-manager.js` spawn r-server 时设 `PETRI_USER_DATA_DIR = app.getPath('userData')`
- `test/system-prompt-rejects.test.mjs` 11 个 vitest 单元（11/11 PASS）

### PHASE 4 — 专项门禁 + 收口笔录（本 commit）

- `package.json` 加 `block:working-tree-review` 脚本
- `scripts/block-16-working-tree-review.mjs` 4 步门禁（git-adapter + system-prompt-rejects + WorkingTreeReview 子集 + docs:check + ui:audit:check）
- DOC-REGISTRY：BLOCK-16-WORKING-TREE-REVIEW-MODE active → completed + 新增 BLOCK-16-WORKING-TREE-REVIEW-MODE-CLOSEOUT reference entry
- `docs/next-steps-roadmap.md` 增加 BLOCK-16 收口条目
- `docs/README.md` 长期核心指引同步 UI-180 入口

## 4. 4 治理门 GREEN

| 门禁 | 命令 | 结果 |
|---|---|---|
| `docs:check` | `npm run docs:check` | 133 registered PASS |
| `ui:audit:check` | `npm run ui:audit:check` | 131 PASS（含 UI-180 in_progress） |
| `docs:reconcile` | `npm run docs:reconcile` | 0 issues |
| `tsc --noEmit` | `cd frontend && npx tsc --noEmit` | 0 错 |
| `block:working-tree-review` | `npm run block:working-tree-review` | 5/5 PASS（git-adapter + system-prompt-rejects + frontend-working-tree-review + docs-check + ui-audit-check） |

## 5. 测试矩阵

- `node --test test/git-adapter.test.mjs` —— 30/30 PASS（既有测试 0 破坏）
- `node --test test/system-prompt-rejects.test.mjs` —— 11/11 PASS（PHASE 3 新增）
- `cd frontend && npx vitest run src/components/copilot` —— 17 files / 168 tests PASS（既有 0 破坏）

## 6. 调研驱动

`docs/block-16-working-tree-review-survey.md`（344 行 / 8 §）3 方案对比（Monaco / react-diff-viewer / 手写）后选 C：手写 React 渲染对组件契约清晰 / 0 新依赖 / 对齐 ADR-RS-3 + 既有 Result Studio diff 风格；2 拒绝信号方案对比（本机清单 / MCP 主动拉）后选本机清单基线 —— 写盘比实时 RPC 简单、不引入额外监测点、与 AGENTS.md 测试纪律一致（fail-closed 升级全量）。

## 7. 不变量守住

- preload.js 既有 19 命名空间方法签名 0 diff
- electron.d.ts 既有类型 0 diff（仅新增 `workingTreeReview`）
- desktopBridge.ts 既有 API 0 diff
- Result Studio 既有 diff 组件 0 diff
- core/shared-backend 既有方法 0 diff（仅 git-adapter 新增）
- agent-tools/* / agent-transcripts/* 0 diff
- 0 npm 依赖新增 / 0 npm 依赖删除

## 8. 后续候选（不外推 / 不在范围）

- BLOCK-6 UI-158 + UI-159 dev Electron 实机
- BLOCK-7 UI-161 既有 in_progress 实机
- BLOCK-8 release-pipeline dist staleness
- BLOCK-9 Windows 代码签名 / i18n 资源抽离
- BLOCK-10 E1-d / E1-e G1+ 架构改动
- Chart a11y P2 落实
- Result Studio P7 deferred

按 single work package serial 纪律，**下一块候选须经用户显式裁决启动新工作包**。

## 9. ADR / 架构决策

- **ADR-RS-3** 沿用：Result Studio diff 组件 / theme token 风格一致
- **BLOCK-16 §3.4 方案 C** 沿用：手写 React 渲染（vs Monaco / react-diff-viewer）
- **BLOCK-16 §3.4 拒绝信号方案 A** 沿用：本地清单（vs MCP 主动拉）
- 拒绝清单 30 天 TTL + 字符预算 4096：防 prompt 爆炸 + 自动老化

## 10. 文档门禁同步

- `docs/DOC-REGISTRY.json` `BLOCK-16-WORKING-TREE-REVIEW-MODE` active → completed + 新增 `BLOCK-16-WORKING-TREE-REVIEW-MODE-CLOSEOUT` reference entry
- `docs/next-steps-roadmap.md` 增加 BLOCK-16 收口条目
- `docs/README.md` 长期核心指引同步（UI-180 入口）
- `docs/ui-productization-audit.md` 第 3 行"最后更新" + UI-180 in_progress 登记 + 第 440 行 PHASE 1+2 笔录（保持原状；本笔录作为 PHASE 3+4 补充 evidence）

## 11. 锁门

- 4 commit（7f94854 / 59aeb95 / da48006 / closeout commit）全部落在 `main` HEAD
- 4 治理门 GREEN
- 不外推 packaged / Provider / GA / P7 / Chart a11y P2 / Worktree
- `qualificationEligible: false` 永久 G0 事实
- UI-180 保持 `in_progress`（按 audit 行 402 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified）
