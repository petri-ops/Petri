# BLOCK-34-AGENT-TOOL-TRAIL-DOCK — 会话工具记录持久化 + 后台进程浮窗 Plan

- **Plan ID**: `BLOCK-34-AGENT-TOOL-TRAIL-DOCK`（2026-09-01；用户反馈「开发过程中会执行很多工具，但任务完成后记录就不见了，希望全部内容都保存但会话区保持整洁，终端/持续输出任务可以出现独立小窗口」；三个设计决策经 AskUserQuestion 裁决：快照随消息落库 / 右下角浮窗+可折叠 / 仅 background 任务触发）
- **状态**: `active`（P0 立项）
- **truthDomain**: `block-34-agent-tool-trail-dock`
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 背景与问题（已调查确认）

1. **历史工具记录消失的根因（后端）**：tool 事件全量持久化在 `task_events` 表，但 task agent 链路（BLOCK-33 使用的）持久化最终 assistant 消息时 `agent-runner.js` 对话落库调用显式传 `assistantToolActivities: null` → `conversation-adapter` 的 meta_json 不含 `toolActivities`。任务进行中前端看到的工具记录来自内存 run 快照（conversationRunStore），任务完成后 SimpleChat 的 re-conciliation 用持久化消息覆盖本地快照（防重复机制），工具记录随之消失。
2. **恢复链路前端已就绪**：legacy SSE 链路（`routes/ai-agent/chat.js`）已持久化完整 snapshot 且 `restoreSimpleMessage` → `ToolActivityList` 渲染链路完好；task 链路只差把 `runLoop` 内部创建的 `assistantToolActivities` recorder（`createToolActivityRecorder`，snapshot 已含 100 条上限与摘要截断）传回并落库。
3. **后台进程无独立观察窗口**：BLOCK-33 P4 的 `workspace_exec_background` 输出写工作区 `.biof3-agent-tmp/` 日志文件（`readLogTail` 可查尾部），进程表内存态 per conversation；前端只能等模型调用 `process_status` 时被动看到尾部，无持续观察手段。

## 2. 方案（P1–P4 串行，每阶段独立提交 + 定向测试）

- **P1 快照随消息落库（后端）**：`loop-orchestrator.runLoop` 返回值增加 `assistantToolActivities`（recorder 引用，snapshot 语义不变）；`agent-runner` 对话落库处把 `null` 替换为该 recorder；`conversation-adapter.appendAssistantMessage` 已有 snapshot 落库逻辑零改动。节流与体量：recorder snapshot 上限 100 条、每条为摘要形状（summary/actionDetail 已截断），meta_json 体量可控。
- **P2 前端历史恢复核对**：`restoreSimpleMessage` 已恢复 `toolActivities`（types.ts），核对历史渲染（SimpleChat `ToolActivityList`）在 task 链路快照下的展示——chip 摘要 + 展开详情（输出尾部/耗时/状态），与进行中形态一致；发现差异只做最小修补。
- **P3 后台进程浮窗**：
  - 后端：新增两个只读查询端点（biof3-server HTTP 路由）——按 conversationId 列出本会话 background 进程（id/pid/命令摘要/状态/startedAt/日志路径）+ 按 processId 读日志尾部（复用 `readLogTail`，tail 上限 64KB）；数据源就是 P4 的内存 `backgroundProcesses` 表，0 新持久化。
  - 前端：新组件 `BackgroundProcessDock`（右下角浮窗）——当 run 中出现 `workspace_exec_background` 的成功 tool_result（携带 processId）时自动弹出；1s 轮询日志尾部增量渲染（等宽、自动滚动、可暂停）；可折叠为小 chip（显示运行中进程数与状态点）；可手动关闭；位置自适应避开边界（沿用 UI-252 hover 预览的自适应经验）；复用主题 token 与字体契约（`--biof3-font-mono`）。
  - 触发范围：仅 `workspace_exec_background` 任务；普通 `workspace_exec` 流式输出维持消息流内展示不变。
- **P4 实机收口**：dev Electron + CDP——真实 DeepSeek task（多工具调用）验证：任务进行中与完成后、以及页面 reload 后工具记录均保留且展开详情可用；background 起长驻 http server → 浮窗自动弹出且日志实时滚动 → process_stop 后浮窗状态收敛 → 关闭浮窗；截图 `acceptance/ui-266/` + evidence.json + UI-266 台账 verified。

## 3. 非范围

- tool_events 全文回放（P1 方案为截断快照；完整数据已在 task_events 表，可按需查库）——若后续需要「查看全部历史输出」再做二期
- 后台进程表跨应用重启恢复（内存态，重启失联诚实边界不变；日志文件仍在工作区）
- 浮窗拖拽自定义位置 / 多进程并行分屏
- 普通命令流式输出的独立窗口化（维持消息流内）
- 0 新 npm 依赖、0 新增 Electron IPC（走后端 HTTP 路由，与 getBackendPort 通道一致）

## 4. 依赖

- BLOCK-33（recorder/工具事件基建、background 进程表与日志文件、tool_result 携带 processId）
- BLOCK-31（task_events 权威清单模式——本包不改归属逻辑）
- UI-252（浮窗自适应边界先例）、UI-242（字体契约：mono 必须走 `--biof3-font-mono`）

## 5. 门禁与证据

- 后端：`node --check`；定向 node --test（runLoop 返回 recorder / 落库 meta 含 toolActivities / background 查询端点形状与隔离——A 会话进程对 B 会话不可见）
- 前端：`tsc --noEmit` 0；定向 vitest（restoreSimpleMessage 恢复 toolActivities、BackgroundProcessDock 弹出/折叠/关闭/轮询渲染）
- 治理：`docs:check` / `ui:audit:check` / `docs:reconcile`
- 实机（P4）：见 §2 P4；证据 `acceptance/ui-266/`

G0 开发期常态 · 不外推 packaged / Provider / GA.
