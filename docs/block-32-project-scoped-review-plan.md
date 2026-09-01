# BLOCK-32-PROJECT-SCOPED-REVIEW — 项目级审阅隔离 Plan

- **Plan ID**: `BLOCK-32-PROJECT-SCOPED-REVIEW`（2026-09-01；BLOCK-31 P4 收口后用户指出「审阅中也是看到所有的吗？不同项目审阅中的变化也应该是隔离开的吧」，AskUserQuestion 裁决「立项，全套做」+ 非 git 项目「诚实空态」启动）
- **状态**: `active`（P0 登记 → P1 后端项目仓库解析 → P2 前端契约与空态 → P3 实机收口）
- **truthDomain**: `block-32-project-scoped-review`
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与问题

审阅/改动事实源与项目无关：`src/ipc/working-tree-review.js` 全部 **20 个** `git:*` IPC handler 调用无参 `resolveGitAdapter()`（L49，固定候选 `app.getAppPath()` → `userData/workspace`，取第一个含 `.git` 的）——即**应用仓库本体**。前端审阅（dock / /review 主区，`useWorkingTreeReview`）、`AgentChangesCard`、CodeMirror inline diff（BLOCK-22 五通道）全部消费同一绑定。结果：任何项目下打开审阅看到的都是 desktop 应用仓库的 working tree / 历史 / 分支，与项目工作区无关。

各项目工作区本就是独立 git 仓库（已实机验证 ThinkSpace 有自己的 `.git` 与未提交改动），按项目隔离在数据层可行。BLOCK-31 的会话级归属（`conversationChangesStore` 相对路径 + `AgentChangesCard`）建立在同一事实源之上，其路径按 repo 相对对齐，项目隔离后自然成立。

用户裁决：① 立项全套做；② 项目工作区**不是 git 仓库**时，该项目审阅显示**诚实空态**（「当前项目工作区不是 git 仓库」引导），不回退显示应用仓库。

## 2. 方案

- **P1 后端参数化**：`resolveGitAdapter(projectId)`——有 `projectId` 时从本地 DB（`db.getProject`）取 `workspace_path`，校验目录存在且含 `.git`；无 `.git` 抛 `GitAdapterError('project_workspace_not_git')`（新错误码，detail 带 workspace_path）。20 个 handler 的 `args` 增加 `projectId?: string`（additive）：传了按项目仓库，未传维持旧候选行为（应用仓库）——渐进兼容，不在本包内 fail-closed 强制。DB 读取失败/项目不存在抛 `project_not_found`。
- **P2 前端契约**：`preload.js` + `electron.d.ts` + `desktopBridge.ts` 的 `workingTreeReview` 全方法签名增加 `projectId?: string`（additive，既有类型 0 破坏）；`useWorkingTreeReview` 增加 projectId 入参并全调用点透传；`AgentChangesCard` 增加 projectId（SimpleChat 已有 context.projectId）；CodeMirror inline diff 链路（`useCodeMirrorEditor`/`CodeMirrorDiffView`）传入。审阅挂载层（AppShell dock / /review 路由）从路由 `/project/:id` 取当前 projectId。非 git 空态：`useWorkingTreeReview` 捕获 `project_workspace_not_git` → ReviewMode 渲染诚实空态（图标 + 说明「当前项目工作区不是 git 仓库」），不显示任何仓库数据。
- **P3 实机收口**：dev Electron 跨项目验证——项目 A（desktop = 应用仓库）与项目 B（tinkspace = ThinkSpace 仓库）审阅各自显示本仓库 status/diff/历史/分支且互不串；改动卡片按项目仓库过滤；非 git 项目空态；UI-264 台账 + 门禁 + 收口。

## 3. 非范围

- 非 git 工作区的 git init 引导 / 初始化流程（空态只说明，不提供操作）
- 审阅写操作语义变化（hunk apply/revert/commit 等仅随 projectId 换仓库目标）
- BLOCK-31 会话归属逻辑改动（conversationChangesStore 不动）
- 主进程备用通道 `notifyAgentTaskDone`、AgentChangesCard 悬停预览行为
- 0 新依赖；不动 r-server/后端业务；不动 DB schema

## 4. 依赖

- BLOCK-31（`completed`）——`AgentChangesCard` projectId 传参在其 conversationId 之上叠加
- BLOCK-30 单后端更名（`completed`）——DB 路径 `core/biof3-server`

## 5. 门禁与证据

- 后端：`node --check` 改动文件；git-adapter/working-tree-review 定向 node --test（projectId 解析 / 非 git 错误码 / 未传回退）
- 前端：`tsc --noEmit` 0；ReviewMode + AgentChangesCard + useWorkingTreeReview 相关定向 vitest
- 治理：`docs:check` / `ui:audit:check` / `docs:reconcile`
- 实机（P3）：dev Electron——tinkspace 审阅显示 ThinkSpace 仓库改动与历史、desktop 审阅显示应用仓库，互相隔离；非 git 项目空态；截图 `acceptance/ui-264/` + evidence.json

G0 开发期常态 · 不外推 packaged / Provider / GA.
