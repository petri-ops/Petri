# BLOCK-65 — 子智能体专属界面全面评估与设计（每 agent 专属视图）

> 状态：`planned`（2026-09-08 用户裁决立项「新开 BLOCK 全面评估」+ 需求「每个智能体运行时都有自己专属的界面」；评估（P0）已随立项完成落盘 §2–§4；实施待队列裁决后启动（UI-305 已收口））
> 立项日期：2026-09-08（用户裁决「立新的 BLOCK」）
> truthDomain: `block-65-subagent-ux`
> 来源：用户问题「项目中子智能体的运行逻辑是什么」+ 需求「每个智能体运行时都有专属界面，参考 codex 代码或模仿 zcode 实现方式」
> 参考系说明：codex 源码本机无 vendored copy，codex MultiAgentV2 参考以 BLOCK-49 plan §1.2 调研证据（在库）为准；ZCode 实现方式由用户指定为参照（每个子 agent = 独立会话上下文 + 独立可检视面板/任务卡 + 后台完成通知 + 结果以终态消息回传主会话）。

## 1. 评估对象

子智能体（sub-agent）全链：派生（BLOCK-49 已收口）→ 运行态可见性 → 专属界面（BLOCK-59 P4 agent 详情窗）→ 交互与回收。评估问题：现状距「每个智能体运行时都有自己专属的界面」差什么、补什么。

## 2. 子智能体运行逻辑（事实基线，2026-09-08 全量源码走读）

**总链路**：模型调 `spawn_agent` → [spawn-agent-tools.js](../core/biof3-server/agent-tools/spawn-agent-tools.js) 校验（父必须 `kind='primary'` → **递归禁令**；权限整体继承不放大；模型 fail-closed 解析不静默回退）→ `createAgentTask` 落 SQLite `tasks` 表 → 并发槽获取（每用户子 agent 上限 4，全局 8，primary 预留 1）→ `setImmediate` 异步 `runAgentLoop({kind:'subagent'})` **进程内直调**（与 HTTP 派生分支同一执行链，不走 HTTP 自调用）→ spawn 工具**立即返回 agentId**，父 loop 继续。

- **状态与持久化**：`tasks` 表（params JSON 含 parentTaskId/conversationId/模型信息）+ `task_events` 事件流（seq 每 task 独立自增）；终态正文落 `copilot_messages.task_id`；子 agent 全量时间线可经 `GET /ai/agent/task/:taskId?afterSeq=N` SSE 任意回放/订阅。
- **消息流（诚实边界）**：子 agent 中间输出只写自己的 task_events，**不注入父模型上下文**；父会话实时可见 = SubAgentsBar 状态行 + `child_finished` 终态通知（summaryHead 200 字）；父模型拿结果靠 `wait_agent` 返回值（1s 轮询阻塞、1–600s 超时可让出）。终态摘要 4000 token 预算截断。
- **二期三件套已实现**（非候选）：`send_message`（持久化为子任务 `parent_message` 事件，**队列语义**——运行中不即时注入 loop，诚实登记在代码注释）/ `followup_task`（对终态子 agent 续派）/ `interrupt_agent`（级联取消）。**前端均未消费。**
- **生命周期**：父不等子；子不能再 spawn；级联取消（取消父→运行中子；取消子不上溯）；桌面重启把 running 子 agent 扫成 failed（`interrupted_at`）——**运行态不可恢复**，但 task_events/正文/终态持久可回放；前端刷新（非重启）靠 `resumeSubAgentTasks` 重订阅。
- **窗口层现状**：agent 类弹出窗**已是多实例**（每 taskId 一窗 `agent:<taskId>`，960x680，`railClass=persistent` 不自动销毁）；全局 popped 上限 4，超限最旧自动降格边缘轨道。**「N 个子 agent 各自专属窗」的窗口层已就绪，无需改窗口管理器。**

## 3. 距「每 agent 专属界面」的缺口清单（分级）

| # | 级别 | 缺口 | 证据 |
| --- | --- | --- | --- |
| 1 | **P1** | 专属窗是**只读投影**：AgentWindowPage 仅状态行+工具时间线（200 条上限）+摘要（8000 字符上限），零交互——后端二期三件套（中断/留言/续派）全部闲置 | [AgentWindowPage.tsx:42-202](../frontend/src/pages/window/AgentWindowPage.tsx) |
| 2 | **P1** | **无自动唤起**：spawn 后专属窗不会自动出现也无通知动线，用户须知道去 SubAgentsBar 手动点弹；「每个 agent 运行时都有专属界面」的现状语义 = 「手动打开的只读窗」 | SubAgentsBar.tsx:44,77 为唯一入口 |
| 3 | **P1** | SubAgentsBar 行**无实时进度**：中间输出不回父会话（设计如此），但 UI 未给替代动线（行内 mini 进度/最新动作行），只能逐个开窗才有实时感 | conversationRunStore.ts:828 内存 Map |
| 4 | **P2** | 4 窗预算 vs 4 并发 agent 恰好相等，但第 5 窗/降格无主动提示，轨道 hover 才发现「窗被收了」 | _window-manager.js:20,215-233 |
| 5 | **P2** | 重启后运行态丢失（sweep 标 failed）：专属窗变纯历史回放；「专属界面」对长任务跨重启场景的连续性断裂 | agent-task-store.js:317-336 |
| 6 | **P2** | send_message 为队列语义非实时注入——专属窗若接输入框必须诚实标注「排队送达，下个检查点消费」，否则用户预期错位 | spawn-agent-tools.js:312-342 注释 |
| 7 | **P2** | agent 俯瞰空白（自 BLOCK-64 P2-c 移交并入本包统一设计）：指挥中心只读 tool_jobs，子 agent 无任何俯瞰瓦片 | BLOCK-64 plan §3#6 |

## 4. 优化方向（候选实施阶段，待用户裁决勾选）

- **P1-a 专属窗交互补全（核心增量）**：AgentWindowPage 接 `interrupt_agent`（取消按钮，级联语义确认卡）+ `send_message`（输入框，诚实标注队列语义）+ `followup_task`（终态后「继续派」按钮）；时间线/摘要上限复核。
- **P1-b 专属感与自动唤起**：spawn 成功后主动线三选一（用户裁决）——① 自动弹出专属窗；② 桌面通知 + 一键开窗；③ SubAgentsBar 行内嵌 mini 实时进度（轻订阅各自 SSE 状态行）；窗口标题带 task 描述前缀。
- **P2-c agent 俯瞰（BLOCK-64 P2-c 移交并入）**：指挥中心 agent 瓦片或 SubAgentsBar 升格为俯瞰面板，二选一裁决；只读 task_events 投影。
- **P2-d 形态对照裁决（ZCode 式 vs 独立窗）**：评估「单窗多 agent 面板 tab」（ZCode 桌面形态）与现有多实例独立窗的取舍——不推翻窗口系统，仅补对照结论供后续裁决；含重启连续性（P2-d 不实现恢复，仅登记候选）。
- 每阶段：定向 vitest + tsc 0 + ui:audit:check + docs:check；实机证据 `acceptance/block-65/`。

## 5. 治理边界

- **零第二真相**：专属窗一切增强只读 `task_events`/`tasks`/`copilot_messages` 既有真相；交互走既有 REST/工具语义，不建新状态。
- **窗口系统零改动**：多实例已支持，不动 `_window-manager`（MAX_POPPED_WINDOWS=4 维持）；不动 agent-runner 核心 loop（send_message 即时注入属核心改动，明确范围外）。
- 范围外：递归 spawn 解禁、并发上限调整、子 agent 权限放大、指挥中心 result/terminal 瓦片行为。
- 与 BLOCK-64 关系：64 的 P2-c 移交本包（已在 64 plan 标注），其余 64 范围不变。
- 0 新 npm 依赖倾向。

## 6. 进度记录

- 2026-09-08 **planned 立项 + 评估交付**：用户裁决「新开 BLOCK 全面评估」并给出需求「每个智能体专属界面（参考 codex / 模仿 zcode）」→ 全量源码走读完成（§2 事实基线）；核心结论 = **窗口层多实例已就绪、数据面完备（task_events SSE 任意回放）、后端交互三件套已实现，缺口集中在内容层交互与自动唤起**（§3 七项分级）；优化四档待用户裁决（§4）。排队待用户裁决启动（UI-305 已收口）。
