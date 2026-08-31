# BLOCK-31-CONV-SCOPED-CHANGES — 会话级改动归属（权威文件清单）Plan

- **Plan ID**: `BLOCK-31-CONV-SCOPED-CHANGES`（2026-09-01；用户确认「工作区改动/审阅是全项目共享视图」后裁决「要做会话隔离 权威清单」启动）
- **状态**: `active`（P0 治理登记，本 commit）
- **truthDomain**: `block-31-conv-scoped-changes`
- **阶段**: P0 治理登记（本 commit）→ P1 后端权威清单 → P2 renderer 契约接入 → P3 UI 会话过滤 → P4 实机收口
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与问题（2026-09-01 调查结论）

现状：工作区改动卡片（`AgentChangesCard`）与审阅（`useWorkingTreeReview`）同为**项目级**视图——全链路（hook → preload → IPC → git-adapter）无任何 conversation 过滤，`bridge.diff({})` 空参即全仓 `git diff HEAD`；每个应用实例只绑定一个 git 仓库（`src/ipc/working-tree-review.js:49-66`）。同一项目的所有会话共享同一份改动视图。

缺口（要做的「权威清单」）：

1. 后端 SSE `done` 事件无 payload（`core/biof3-server/routes/ai-agent/chat.js` 4 处 + `events.js:76/98`）；renderer `emitAgentTaskDone` 硬编码 `filesChanged: []`（`copilotClient.ts:21-30`，协议字段 `AgentTaskDoneDetail.filesChanged` 在 `lib/events.ts:96-99` 已预留但从未填充）。
2. 任务收尾无文件清单聚合：全 `core/biof3-server` 无 `filesChanged` 产出；但**重建材料已持久化**——`agent-runner.js:357` 把全部 `tool_result`（含 `workspace_write`/`workspace_replace` 的 `path` + `changeSummary`）写入 `task_events`。
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

- BLOCK-30 单后端收敛（`completed`）——本包改 `core/biof3-server` 即唯一业务后端
- UI-252（改动卡片）/ UI-216（卡片→审阅跳转）既有行为为基线

## 5. 门禁与证据

- 后端：`node --check` 改动文件；task-store / agent-runner 聚合 helper 定向单测（多 write/replace 去重、exec 盲区标注、subagent 不串会话）
- 前端：`tsc --noEmit` 0；copilotClient / AgentChangesCard 定向 vitest
- 治理：`docs:check` / `ui:audit:check` / `docs:reconcile`
- 实机（P4）：dev Electron——会话 A 让 AI 改文件 → A 卡片显示该文件；切会话 B 卡片不显示 A 的文件；「全部改动」/审阅可见全量。截图 `acceptance/ui-263/`。

G0 开发期常态 · 不外推 packaged / Provider / GA / P7.
