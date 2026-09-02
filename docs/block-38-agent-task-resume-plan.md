# BLOCK-38 — Agent 任务中断续跑（resume from interruption）

> status: active · truthDomain: `block-38-agent-task-resume` · registered: 2026-09-02
> owner: main agent · branch: main（单工作包串行，前置 BLOCK-37 已 completed）
> 立项依据：用户在 BLOCK-37 收口讨论中提出信息流的两大目的——「追溯历史」与「可以在任何阶段启动任务，尽管任务异常中断了」，并裁决「好的，立项 BLOCK-38」。

## 1. 背景（用户需求 + 已调查事实）

用户需求：agent 任务异常中断（典型：服务重启）后，能够**从任务的既有进度继续执行**，而不是从头重来或只能看到一条 failed 记录。

已核实的现状（2026-09-02 摸底）：
- **中断标记链**：[agent-task-store.js](../core/biof3-server/agent-task-store.js#L309-L319) 服务启动清扫把 `type='agent_loop' AND status='running'` 的任务批量标记 `status='failed', agent_status='failed', error='服务重启，Agent 任务中断'`——**没有任何续跑入口**，中断即终态。
- **Loop run 已有进程内恢复**：[loop-orchestrator.js](../core/biof3-server/loop-orchestrator.js#L236-L273) `_loopInit` 会通过 `getActiveLoopRunForConversation` 恢复同会话的 active loop run 并重放 `loop_iterations` sequence（`loop_phase: resumed`）——同会话再次进入 agent loop 时天然挂上原 run，这是续跑的现成挂钩点。
- **上下文权威源是 SQLite 会话消息**：agent 每轮迭代全量重发完整消息历史（BLOCK-37 已验证），因此「恢复」不依赖任何内存态——只要在原会话重新进入 agent loop，模型上下文自动从权威源重建。
- **BLOCK-37 transcript 是取证层**：中断前最后一次模型调用（模型看到了什么 / 卡在哪轮 / 是否有未完成的 tool_calls）可从 `llm-transcripts/<conversationId>.jsonl` 末条精确还原，用于续跑前的确认展示与事后比对。
- 前端失败任务只在摘要条展示错误，无操作入口；显式失败（非中断）任务已有独立 `retry_pending` 自动重试链路（retry_count/next_retry_at），与本工作包的手动续跑语义不同，不得混用。

## 2. 方案（P1–P4 串行）

**P1 后端：中断标记显式化 + resume 端点**
- `agent-task-store.js`：启动清扫在标 failed 的同时写入新列 `interrupted_at TEXT`（schema ALTER 容错，同既有模式）；提供 `getResumableTask(taskId)`（type=agent_loop、interrupted_at 非空、conversationId 可解析）。
- 新路由 `POST /api/ai/agent/task/:taskId/resume`（挂在 [context.js](../core/biof3-server/routes/ai-agent/context.js) 同款 task 路由风格）：
  - 校验：任务存在且 `interrupted_at` 非空——**非中断失败的任务诚实拒绝**（409，提示走重试链路），running 任务拒绝（409）。
  - 续跑实现：在原会话**新建一条 agent_loop task**（原 task 保持 failed 不可变，审计链完整），`params` 写入 `resumeOfTaskId` + `resumedAt`；复用 `POST /api/ai/agent` 既有链路进入 loop（loop-orchestrator 依 conversationId 自动 resume 原 loop run）。
  - 取证摘要：响应返回中断前最后一次模型调用摘要（从 llm-transcripts 按会话末条取：ts/model/finishReason/toolCalls 名称/error），供前端确认弹层展示「中断前最后状态」。
  - 鉴权：与同文件既有 task 路由一致（登录态 + 归属校验）。

**P2 前端：「继续执行」入口（UI-275）**
- 失败摘要条对 `interrupted_at` 非空的中断任务显示「继续执行」按钮（非中断失败不显示——诚实区分）。
- 点击 → 轻量确认弹层（展示中断时间 + 中断前最后一条模型调用摘要）→ 确认后调 resume 端点 → 新 task 走既有流式渲染链路（摘要条/思考/执行/改动归属全部自动衔接）。
- 样式全 `--biof3-*` token；不新增常驻 UI。

**P3 测试**
- node --test：resume 端点（interrupted 任务可续跑并创建关联 task / 非 interrupted 失败 409 / running 409 / 未登录 401 / 取证摘要返回）；store 层 interrupted_at 写入与查询。
- vitest：「继续执行」按钮仅在 interrupted 任务出现、确认弹层内容、点击触发 resume 调用；tsc 0。

**P4 实机收口**
- dev Electron：发起 agent 写文件任务 → 任务进行中 kill 后端（模拟中断）→ 重启（新后端清扫标 failed + interrupted_at）→ 任务显示中断 + 「继续执行」→ 确认续跑 → 任务完成、会话改动归属连续、transcript 会话文件全程连续记录（中断前后同文件追加）→ 截图 + evidence.json 存 `acceptance/ui-275/`。

## 3. 范围与非范围

**非范围**：自动续跑（仅手动触发）、subagent 续跑、帧级回放 UI、进程内内存态恢复（loop 内存态丢失由 SQLite 权威源兜底）、批量续跑、崩溃现场快照、G1+ 阶段事项（packaged/Provider/GA）。

**不变量**：0 新依赖；原任务记录不可变（审计链）；重试链路（retry_pending）语义不动；loop-orchestrator 恢复机制复用不重写；transcript 严格只读（取证查询，不作为回放源）。

## 4. 验收判据

- P1：node --test 全绿（resume 语义 / 校验 / 取证摘要 / interrupted_at 链）。
- P2：vitest 全绿 + tsc 0。
- P3：随 P1/P2 交付，每提交跑 `npm run docs:check` + `npm run ui:audit:check`。
- P4：实机证据 `acceptance/ui-275/`（含中断 → 续跑 → 完成全链截图 + evidence.json）。

## 5. 完成语义

P1–P3 完成且门禁全绿 → 提交（UI-275 in_progress）；P4 实机证据齐 → UI-275 verified + 本 plan status completed + DOC-REGISTRY 同步。

## 6. 进度记录

- 2026-09-02 P1 完成：agent-task-store（`interrupted_at` 列 + `sweepInterruptedRunningTasks` 启动清扫 + `getResumableTask`，dbMod 缺省单例 db——测试禁止另开第二连接，会触发 SQLITE_IOERR_SHORT_READ）；io-transcript `readLastRecord`（活跃文件 + 轮转留存回退 + 诚实空态）；resume 路由（GET 只读预览 + POST 续跑）；events.js failed 事件携带 `resumable`/`interruptedAt`。`test/block38-agent-task-resume.test.mjs` 9/9。
- 2026-09-02 P2 完成：copilotClient onError 透传 + `previewAgentTaskResume`/`resumeAgentTask`；conversationRunStore `resumable`/`interruptedAt`/`resumeOfTaskId` 快照字段 + `resumeInterruptedConversation` action（新 run 携带审计链走既有订阅渲染链路）；ResumePrompt 组件（仅中断任务显示「继续执行」，确认层 = 中断时间 + lastModelCall 摘要 + progressDigest，全 `--biof3-*` token）。ResumePrompt vitest 3/3 + conversationRunStore vitest 32/32 + tsc 0 + docs:check / ui:audit:check（UI-275 in_progress）。test:changed 3 个失败经 stash 前后对比确认为既有失败（agent-provider-boundary db 加载 / test-affected 证据对账 / P6 证据 hash 漂移）。
- 待办：P4 实机收口（中断 → 续跑 → 完成全链，证据 `acceptance/ui-275/`）。

G0 开发期常态 · 不外推 packaged / Provider / GA。
