---
capability: q7-automation-goals
goal: 把 Q7 从占位变成可用的自动化与目标面——目标有持久状态机/三工具/用量预算可见（B4/B5/B6），定时任务有持久计划、复用既有 agent task 链执行、任务看板与 composer 入口（I1/I2/I3），提醒可进入通知中心（I5）；不建第二执行器、不新增调度依赖。
acceptance:
  - B4/B6：goal 持久表 + 状态机（active/paused/completed/blocked，非法迁移拒绝）+ `create_goal` / `get_goal` / `update_goal` 三工具（工具注册/contract/R0-R1 分档）；Agent 可通过工具创建/查询/暂停/完成目标。
  - B5：goal 用量来自真实 `ai_usage`（goal 会话 + goal 关联的定时运行会话），预算按 token 计；80% 为 usageLimited、100% 为 budgetLimited；UI 显示用量/预算/剩余/受限态；goal 关联的定时运行在 budgetLimited 或 goal 非 active 时跳过并记录 `skipped_budget` / `skipped_goal`（不硬熔断已在跑的 loop，如实登记）。
  - I1：schedule 持久表（interval 分钟，1–10080）+ 运行历史；runner 每 10s 检查到期，复用内部 `POST /api/ai/agent`（单一执行链）提交任务，记录 taskId/conversationId；失败/完成对账；不发第二套任务执行器。
  - I2：composer 新增 `/schedule` 斜杠入口，带标题/间隔的确认对话框，提交后创建 schedule；不发送聊天消息。
  - I3：ScheduledWorkspacePanel 从占位改为任务看板：schedule 列表（启用/暂停/立即运行/删除）、最近运行、goal 列表（暂停/恢复/完成/预算条）、提醒列表（确认）；数据走 `/api/automation`。
  - I5：reminder 类型 schedule 到期写提醒行；前端全局 bridge 轮询未确认提醒并写入通知中心（新增 `schedule_reminder` 类型），不依赖系统通知权限。
  - 定向测试：Node store/runner/tools 契约；前端 panel/dialog/slash/notification；types 0/lint 0 error/theme 17/17；test:changed EXIT=0。
  - 隔离 9223 离屏实机：seed goal + schedule + reminder → 看板可见；立即运行进入 queued/running（或如实失败记录）；goal 暂停/完成；提醒进入通知中心；`/schedule` 对话框可创建；亮/暗各一轮；截图不可得标 unavailable。
  - closeout 十三门逐门取证 PASS；canonical 回写（plan/roadmap/handoff/AUDIT-LOG/UI-567/Q-MATRIX I1/I2/I3/I5/B4/B5/B6）。
reopen: 硬熔断正在运行的 loop（当前只在调度提交前跳过）；cron 表达式/时区；跨设备调度；并发策略（同 schedule 重叠运行）；失败重试/退避；goal 跨会话聚合口径；G1+。
status: completed
---

# BLOCK-256 · Q7：自动化与目标（定时任务 + Goal 状态机）

用户发令：「搞完 Q7（confidence=0.77）」（2026-10-25）。本包按母纲 §6.5 第 6 行 Q7 执行，依赖 Q4a（已完成）。

## 0. P0 实码对账

| 项 | 实况 | 结论 |
| --- | --- | --- |
| I1 定时任务 | `ScheduledWorkspacePanel` 是占位「即将推出」；后端无 schedule 表/runner；`agent-task-store` 已有任务持久化与事件流 | 新建 schedule 存储 + runner，复用既有 `POST /api/ai/agent` 执行链 |
| I2 composer 入口 | 斜杠命令 6 条，无 schedule；`slashExecute` 是纯判定层 | 新增 `/schedule` → `schedule-task` 类；对话框提交 REST |
| I3 任务看板 | 只有占位面板；`CenterPanel` 的 scheduled 模式已存在 | 把占位替换为真实看板（schedules/runs/goals/reminders） |
| I5 提醒/唤醒 | 通知中心已有本地 `AppNotice`（50 条/localStorage）；无 schedule 来源 | reminder 到期写行 → 全局 bridge → `schedule_reminder` 通知 |
| B4 目标模式 | 只有 `spawn_agent` 的 `params.goals`（子任务目标清单），无独立 goal 表/状态机 | 新建 `agent_goals` + 状态机 |
| B5 目标预算 | 只有会话/任务级成本熔断（`copy-cap`），无 goal 归属 | goal 绑定会话 + 关联运行会话，用量取真实 `ai_usage`；调度提交前检查 |
| B6 目标工具 | 无 `get_goal/create_goal/update_goal` | 新增三工具（defs/handlers/contracts） |
| 执行链复用 | `routes/ai-agent/chat.js` 的 task 模式 = `createAgentTask → runAgentLoop`；内部 `desktop-local` Bearer 可调 | runner 只 POST 该端点，不复制 loop/provider 逻辑 |

**Patch vs refactor**：新增面为主；唯一共享改动是 `notification-center` 增加一种 kind 与 `routes/index` 注册、`server.js` 启动 runner；不改既有 loop/审批/任务执行语义。

## 1. 范围

- goal：持久表、状态机、三工具、用量/预算视图、看板操作。
- schedule：持久表、interval 调度、runner、运行历史、reminder、看板、`/schedule` 入口。
- 通知：`schedule_reminder` 进入既有通知中心。
- 复用：task 执行走既有 `POST /api/ai/agent`；goal 用量走既有 `ai_usage`；提醒走既有 notification-center。

## 2. 非范围

- 不做 cron 表达式/时区、跨设备同步、远程调度。
- 不做正在运行 loop 的硬熔断（只在 schedule 提交前按 goal budget 跳过；如实登记）。
- 不做同 schedule 重叠运行的复杂策略（默认跳过并记录 running）。
- 不新增调度依赖、不新建第二任务执行器、不改 Provider/GA/packaged。
- 不做 goal 的自动续跑/自动完成推断；状态由工具/用户显式更新。

## 3. 数据模型

- `agent_goals(id,user_id,project_id,conversation_id,title,description,status,budget_tokens,created_at,updated_at,completed_at)`
- `agent_schedules(id,user_id,project_id,goal_id,title,prompt,kind,interval_minutes,reminder_text,enabled,next_run_at,last_run_at,created_at,updated_at)`
- `agent_schedule_runs(id,schedule_id,task_id,conversation_id,status,error,started_at,finished_at)`
- `agent_schedule_reminders(id,schedule_id,project_id,message,due_at,acknowledged_at)`
- `copilot_conversations.goal_id`（additive 列；调度创建的运行会话归属 goal）

## 4. 阶段

| 阶段 | 内容 |
| --- | --- |
| P0 | 对账/立项登记（本文件） |
| P1 | goal store/状态机/用量预算 + 三工具 + 注册 |
| P2 | schedule store/runner + 内部 agent 提交 + 提醒 |
| P3 | 路由（automation/schedules/goals/reminders）+ server runner 启动 |
| P4 | 看板/斜杠入口/通知 bridge/notification kind |
| P5 | 定向测试 + types/lint/theme + impact-map |
| P6 | 9223 离屏实机（亮/暗）+ closeout + canonical 回写 |

## 5. 验收门禁

- `node --test test/block256-automation.test.mjs test/agent-tool-registry.test.mjs`
- 前端定向：`ScheduledWorkspacePanel.test.tsx` / `ScheduleDialog.test.tsx` / `slashExecute.test.ts` / `notification-center.test.ts` / `theme-token-contract.test.ts`
- `npm run test:changed` / `quality:types` / `quality:lint` / `ui:audit:check` / `hygiene:check`
- 隔离 9223：`scripts/block256-q7-automation-live.mjs` + flow；证据 `acceptance/block-256/`；截图不可得标 `unavailable`
- `npm run closeout` 十三门逐门取证

## 6. 完成语义

`completed` 需三工具可用、schedule 可创建/到期执行/看板可见、提醒进入通知中心、goal 状态与预算可见、实机证据与十三门逐门取证、canonical 回写完成。未获用户提交发令时保持 WIP。

## 7. 执行记录（2026-10-25，P1–P6 completed）

- **P1 目标**：新增 `helpers/automation-store.js`（`agent_goals` / `agent_schedules` / `agent_schedule_runs` / `agent_schedule_reminders`，`copilot_conversations.goal_id` additive）；goal 状态机 active/paused/completed/blocked（非法迁移拒绝）+ 用量/预算视图（真实 `ai_usage`；80% usageLimited / 100% budgetLimited）；`goal-tools.js` + `tool-defs/goals.js` 三工具，registry **85→88**（create_goal R1 / get_goal R0 / update_goal R1）。
- **P2 调度**：`helpers/automation-runner.js` 每 **10s** 检查到期；任务型 schedule 复用内部 `POST /api/ai/agent`（创建运行会话 → 提交任务 → 记录 taskId/conversationId），提醒型写 reminder row；运行对账复用 `getAgentTask`；goal 非 active/budgetLimited 在提交前跳过并记录 `skipped_goal` / `skipped_budget`（**不硬熔断已在跑的 loop**）。
- **P3 路由**：`routes/automation.js`（`GET /api/automation`、schedule CRUD/toggle/run、goal status、reminders/ack）+ `routes/index.js` 注册 + `server.js` listen 后启动 runner。
- **P4 前端**：`automationClient`；`ScheduledWorkspacePanel` 由占位改为看板（schedule 列表/启用暂停/立即运行/删除 + 最近运行 + goal 用量预算/暂停恢复完成 + 提醒确认）；composer `/schedule`（`slashExecute` + `ScheduleDialog` + `useScheduleComposer`，prompt 可编辑、不发送聊天消息）；全局 `ScheduleReminderBridge` 轮询未确认提醒 → notification-center 新 kind `schedule_reminder`；`SimpleChat.tsx` 2106→**2097**（`/compact` 分支外移抵消）。
- **P5 验证**：Node `block256-automation` **5/5** + registry/prerouting/skill/decision 邻域 **52/52**；前端 Q7 定向 **33/33**（panel/dialog/bridge/slash/notification/theme）；`test:changed` EXIT=0（Node **1389** / 1372 pass / 0 fail / 17 skipped；前端 **107** 文件 / **768** tests）；types 0、lint 0 error、theme 17/17、code-size PASS、knip 278（+1 动态 flow）。
- **P6 实机 + 收口**：隔离 9223 离屏亮/暗各 **21/21**（`acceptance/block-256/q7-live.json` / `q7-live-dark.json`；截图 `unavailable`）——看板 schedule/goal/run/reminder、goal 820/1000 预算与“接近预算”、暂停/恢复、schedule 暂停/启用、看板新建、立即运行记录（模型成败不伪造）、提醒进入通知中心、composer `/schedule` 创建计划、收尾回 `?test=1`。canonical 回写完成；closeout 十三门逐门取证（见 AUDIT-LOG）。
- **诚实边界**：goal 预算只在**调度提交前**跳过，未硬熔断正在运行的 loop；cron/时区/跨设备/overlap 策略/失败重试退避未做；i18n 通知只在应用内，不接系统通知权限；截图 unavailable。
