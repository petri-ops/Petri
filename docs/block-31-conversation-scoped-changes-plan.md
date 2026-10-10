# BLOCK-31-CONV-SCOPED-CHANGES — 会话级改动归属（权威文件清单）Plan

- **Plan ID**: `BLOCK-31-CONV-SCOPED-CHANGES`（2026-09-01；用户确认「工作区改动/审阅是全项目共享视图」后裁决「要做会话隔离 权威清单」启动）
- **状态**: `completed`（P0 登记 → P1/P2/P3 实现 → P4 实机收口，2026-09-01；UI-263 verified）
- **truthDomain**: `block-31-conv-scoped-changes`
- **阶段**: P0 治理登记 → P1 后端权威清单 → P2 renderer 契约接入 → P3 UI 会话过滤 → P4 实机收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与问题（2026-09-01 调查结论）

现状：工作区改动卡片（`AgentChangesCard`）与审阅（`useWorkingTreeReview`）同为**项目级**视图——全链路（hook → preload → IPC → git-adapter）无任何 conversation 过滤，`bridge.diff({})` 空参即全仓 `git diff HEAD`；每个应用实例只绑定一个 git 仓库（`src/ipc/working-tree-review.js:49-66`）。同一项目的所有会话共享同一份改动视图。

缺口（要做的「权威清单」）：

1. 后端 SSE `done` 事件无 payload（`core/petri-server/routes/ai-agent/chat.js` 4 处 + `events.js:76/98`）；renderer `emitAgentTaskDone` 硬编码 `filesChanged: []`（`copilotClient.ts:21-30`，协议字段 `AgentTaskDoneDetail.filesChanged` 在 `lib/events.ts:96-99` 已预留但从未填充）。
2. 任务收尾无文件清单聚合：全 `core/petri-server` 无 `filesChanged` 产出；但**重建材料已持久化**——`agent-runner.js:357` 把全部 `tool_result`（含 `workspace_write`/`workspace_replace` 的 `path` + `changeSummary`）写入 `task_events`。
3. 任务↔会话关联：`loop_runs.conversation_id`（真列，`getLoopRunByTaskId` db.js:1189-1194）为准，`tasks.params.conversationId`（JSON）兜底；会话内 primary + subagent 可并发（并发锁按用户不按会话），归属必须先按 task 再聚合到 conversation。

## 2. 方案

- **P1 后端权威清单**：`agent-runner.js` 终态判定处（L703-718，`markAgentTaskDone/Failed` 前）新增聚合 helper——回放本 task 的 `task_events`，提取 `workspace_write`/`workspace_replace` 成功结果的 `path` 集合（seq 定序、文件级去重）→ ① 持久化到 task 终态（additive 列 `files_changed_json` 或终态 task_event，收口时定）② 注入 SSE `done` payload（chat.js / events.js 发点统一走该 helper）。`workspace_exec`（shell 写文件）不可精确归属 → 诚实标注为 unattributed 汇总，**不做**伪归属。
- **P2 renderer 契约接入**：`copilotClient.ts` 4 处 `emitAgentTaskDone` 填充 SSE `done` 携带的 `filesChanged`（保留空数组兜底）；按 conversationId 建立任务改动索引（`conversationRunStore` 侧或轻量 store，收口时定）。
- **P3 UI 会话过滤**：`AgentChangesCard` 默认只显示**当前会话**的任务改动文件（含每文件 ±统计），提供「查看全部改动」入口进审阅；**审阅面板（ReviewMode）保持 git 全量事实源语义不变**（审阅 = 项目全景，卡片 = 当前会话视角）——如需审阅侧会话过滤徽标，登记候选待用户裁决。
- **P4 实机收口**：dev Electron 验证会话隔离行为 + 门禁 + UI 台账（新 UI-263）。

## 3. 非范围

- hunk 级 / 行级归属（文件级归属即可）；并发同文件写的行级定序（按 task_events seq 做文件级去重）
- git snapshot diff 不作归属源（working tree 全局共享，并发任务无法切分），仅可作校验兜底
- 主进程备用通道 `notifyAgentTaskDone`（`working-tree-review.js:690-697`，当前无调用方）本包不启用
- 审阅写操作 / 提交流程 / 审阅内核 0 改动；0 新依赖

## 4. 依赖

- BLOCK-30 单后端收敛（`completed`）——本包改 `core/petri-server` 即唯一业务后端
- UI-252（改动卡片）/ UI-216（卡片→审阅跳转）既有行为为基线

## 5. 门禁与证据

- 后端：`node --check` 改动文件；task-store / agent-runner 聚合 helper 定向单测（多 write/replace 去重、exec 盲区标注、subagent 不串会话）
- 前端：`tsc --noEmit` 0；copilotClient / AgentChangesCard 定向 vitest
- 治理：`docs:check` / `ui:audit:check` / `docs:reconcile`
- 实机（P4）：dev Electron——会话 A 让 AI 改文件 → A 卡片显示该文件；切会话 B 卡片不显示 A 的文件；「全部改动」/审阅可见全量。截图 `acceptance/ui-263/`。

## 6. 实现进展（P1–P3，2026-09-01）

**P1 后端权威清单（已落地）**：

- 新模块 `core/petri-server/agent-files-changed.js`：`aggregateFilesChanged(events)` 纯聚合——回放 task_events，提取 `workspace_write`/`workspace_replace` 成功结果（`toolResult.data.ok===true`）的 `path`；`created`→`created`、否则 `modified`；`dryRun` 与失败写入跳过；`publicData` 预览截断时按 `callId` 回退到 `tool_call` 的 `args.path` 并置 `attributionComplete=false`；`approval_required` 跳过。
- `agent-task-store.js`：additive 列 `tasks.files_changed_json`（ALTER 容错）；`markAgentTaskDone/Failed/Cancelled` 接受可选 `filesChanged`（`COALESCE` 保留原值）；`getAgentTask` 返回解析后的 `filesChanged`；`resetTaskForRetry` 重试前清空清单。
- `agent-runner.js`：终态判定前 `collectFilesChangedForTask` 聚合并随三个终态标记持久化（聚合失败不阻塞终态）。
- `routes/ai-agent/events.js`：两处 SSE `done` 注入 `filesChanged`（task 模式权威通道；legacy 直连路径无 task_events，维持空清单由前端兜底——诚实边界）。
- 测试 `test/agent-files-changed.test.mjs` 6/6（created/modified 去重、dryRun/失败/approval 跳过、截断回退、无关工具忽略、store round-trip、重试清空）；`agent-task-cancellation` 回归 1/1。`agent-concurrency.test.mjs` 失败为**存量环境问题**（HEAD 无本改动同样失败：临时库缺 `projects` 表），与本包无关。

**P2 renderer 契约（已落地）**：

- `copilotClient.ts`：`emitAgentTaskDone` 增加 `payload {filesChanged, conversationId}`；task 订阅路径记录 SSE `done` 的 `filesChanged` 并在 `[DONE]`/流结束/`done` 事件三处派发；`_dispatchSseEvent` done 分支与 legacy 路径带 `opts.conversationId`。
- `lib/events.ts`：`AgentTaskDoneDetail` 增加 `conversationId?`（`filesChanged` 字段原先已预留）。
- 新 store `conversationChangesStore.ts`：按 conversationId 的改动索引（live 记录 + done 权威对账合并，权威清单外路径保留兼容 exec 盲区/并发）；快照缓存保证 `useSyncExternalStore` 引用稳定。
- `conversationRunStore.ts` `onToolResult`：`workspace_write`/`workspace_replace` 成功且非 dryRun 时实时登记（`data.path`/`data.created`）。

**P3 UI 会话过滤（已落地）**：

- `AgentChangesCard` 接受 `conversationId`（SimpleChat 传入）；会话有归属记录时默认**「本会话改动」**（标题/计数/± 按过滤后清单），卡片内新增「本会话 / 全部」segmented 切换（`sc-changes-scope-*`，token 化样式）；**无归属记录（旧会话/索引空）保持全量视图**，不渲染切换。审阅面板保持 git 全量事实源（本包不改）。
- 测试：AgentChangesCard vitest 7/7（新增会话默认过滤 / 「全部」切换 / 无归属回退全量）；SimpleChat vitest 6/6；tsc 0 / build 通过。

**P4 实机收口（2026-09-01，完成）**：

- **验收**（dev Electron CDP 9222 + 真实 DeepSeek agent task，desktop 项目）：S1 会话 A 写 a.txt → A 卡片「本会话改动」仅 a.txt + 后端 `tasks.files_changed_json` 权威清单持久化 ✓；S2 会话 B 写 b.txt → B 卡片仅 b.txt、A 的 a.txt 不可见（隔离核心判据）✓；S3「全部」= git 全量（审阅语义不变）✓；S4 旧会话回退全量且无切换 ✓。证据 `acceptance/ui-263/`（3 截图 + evidence.json）；UI-263 verified。
- **阻断性存量缺陷修复（本包顺带）**：`inferExecutionPolicy(messages)` 两处调用点（`agent-runner.js` / `routes/ai-agent/chat.js`）自 BLOCK-10 S-003 起漏传 context → `ctx.accessMode` 恒缺省 read →「完全访问」失效、workspace_write/replace/exec 全部被拒（实机两次复现：context 存 `accessMode:'full'` 仍 denied）。修复 = 两处补传 context。后端定向 6/6 + 1/1 过；`node --check` 过。
- **门禁**：后端 agent-files-changed 6/6 + agent-task-cancellation 1/1；前端 AgentChangesCard 7/7 + SimpleChat 6/6；docs:check / ui:audit:check / docs:reconcile。
- **观察项登记 roadmap 候选（不扩权）**：会话归属索引为内存态，页面 reload 后历史会话回退全量视图；候选改进 = 挂载时按会话从后端权威清单（`tasks.files_changed_json`）水合，需 task→conversation 查询通道（loop_runs 对 task 模式未落行，不能直接复用）。

G0 开发期常态 · 不外推 packaged / Provider / GA / P7.
