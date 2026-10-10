# BLOCK-39 — Agent 事件流断线重连（免刷新自动亮「继续执行」）

> status: active · truthDomain: `block-39-agent-stream-reconnect` · registered: 2026-09-02
> owner: main agent · branch: main（单工作包串行，前置 BLOCK-38 已 completed）
> 立项依据：BLOCK-38 收口时登记的候选增强，用户裁决「开始实现免刷新自动亮继续执行按钮」。

## 1. 背景（用户需求 + 已调查事实）

用户需求：后端服务重启导致 agent 任务中断后，前端应**自动发现**任务被中断并置 run 失败态、亮出「继续执行」按钮——而不是要求用户手动刷新页面靠挂载时孤儿恢复才发现（BLOCK-38 现状）。

已核实的现状（2026-09-02 摸底）：

- **订阅是 fetch-stream 而非 EventSource**：[copilotClient.ts:640-708](../frontend/src/components/copilot/copilotClient.ts#L640-L708) `subscribeAgentTask` 用 `fetch` + `ReadableStream` 读 SSE。后端重启时连接断开。
- **后端 SSE 语义已完备支持重连**：[events.js](../core/petri-server/routes/ai-agent/events.js) 订阅时先回放 `afterSeq+1` 起的历史事件（seq 续传）；task 已终态时发送终态事件后**必发 `[DONE]`** 再 `res.end()`；`failed` 终态事件携带 BLOCK-38 的 `resumable`/`interruptedAt` 标记。因此「流结束而未收到 `[DONE]`」⇔ 异常断线，可作为重连信号。
- **断线后前端现有行为有两处缺陷**（[copilotClient.ts:584-592](../frontend/src/components/copilot/copilotClient.ts#L584-L592)）：① `streamChatViaTask` 的 catch 对订阅阶段错误**回退 legacy**（`streamChatLegacy` 重发整段对话重新提交，非续传——中断场景下会重复执行已完成的步骤）；② `subscribeAgentTask` 读循环干净截断（`done=true` 未遇 `[DONE]`）时落入 `onDone?.()` 假装完成——任务实际被清扫为 failed+interrupted，用户却看到"完成"。
- **run 状态侧无需改动**：[conversationRunStore.ts:286-314](../frontend/src/components/copilot/conversationRunStore.ts#L286-L314) `finish('error')` 已在 `errorInfo.resumable` 时写入 `resumable`/`interruptedAt`，且 `finish` 有 `status !== 'running'` 守卫（error 后到达的 `[DONE]` 不会覆盖失败态）；SimpleChat 的 ResumePrompt 渲染条件（`m.error && m.resumable && m.taskId`）与确认弹层/续跑链路 BLOCK-38 已交付。
- **statusMessage 有现成渲染位**：SimpleChat 待处理的 assistant 消息展示 `m.statusMessage`（SimpleChat.tsx L1254），可用于「正在重连」提示。

## 2. 方案（P1–P3 串行，0 后端改动）

**P1 copilotClient：订阅断线重连（核心）**
- `subscribeAgentTask` 拆出单次订阅 `subscribeAgentTaskOnce`（返回 `lastSeq`），重试循环在外层：
  - 仅两类错误视为**可重连断线**：`fetch()` 本身 reject（后端不可达，TypeError）与 `reader.read()` reject / 读循环结束未见 `[DONE]`（连接被切断）——统一抛 typed `AgentStreamDisconnectedError`（携带 `lastSeq`）。HTTP 4xx/5xx（task 不存在/越权/服务器错误）不重试，如实上抛；AbortError 直接上抛（用户主动停止）。
  - 重试参数：有界退避（起始 1s，指数至 4s 封顶，总窗口约 60s）；重连 URL 带 `afterSeq=lastSeq` 续传，已收事件不重放、不重复渲染。
  - 重试期间通过新增可选回调 `opts.onStreamReconnecting?.({ attempt, nextRetryMs })` 通知 UI；重连成功或终态后由既有 `finish` 清除 statusMessage。
- `streamChatViaTask` 错误边界重划：**提交阶段**（`submitAgentTask` 抛错）保留 legacy 回退兼容；**订阅阶段**（已持有 taskId）不再回退 legacy（防止重发整段对话），错误经 `opts.onError` 如实上报（重试耗尽 = 诚实失败态，用户仍可刷新走孤儿恢复）。
- 读循环干净截断不再误调 `onDone`（消除"假完成"）。

**P2 conversationRunStore：重连提示 + 错误消息透传**
- 主 run / sub-agent 两处订阅 `.catch(() => finish('error', new Error('订阅失败')))` 改为透传真实错误（保留订阅失败文案兜底）。
- `onStreamReconnecting` 接入 `replaceRun` 置 `statusMessage: '与任务失去连接，正在重连（第 N 次）…'`；`finish` 已有 `statusMessage: undefined` 清理。

**P3 测试 + 门禁**
- 新增 `copilotClient.streamReconnect.test.ts`（vitest，mock fetch）：
  1. 流中断未见 `[DONE]` → 以 `afterSeq=lastSeq` 重连 → 收到 failed+resumable 终态 → `onError` 携带 `resumable:true`/`interruptedAt`（免刷新亮按钮的核心判据）；
  2. fetch 网络拒绝 ×N → 退避后重连成功 → 流正常完成（`onDone` 恰一次，无重复渲染事件）；
  3. 重试耗尽 → 抛 `AgentStreamDisconnectedError` → `onError` 收到（非 resumable）；
  4. 干净截断不再误调 `onDone`；
  5. AbortError 不触发重试、不触发 `onError`。
- conversationRunStore vitest：重连 statusMessage 置位与 finish 清理。
- tsc 0；`npm run docs:check` + `npm run ui:audit:check`。

**P4 dev Electron 实机收口（UI-276）**
- 发起 agent 写文件任务 → 进行中 `kill -9` :3001（核对后端进程启动时间 vs 代码 mtime 教训）→ dev-electron 自动重启后端 → **不刷新页面**：run 自动置失败态 + 「继续执行」按钮亮出 + 确认弹层 → 续跑至完成（改动归属连续、transcript 同会话文件连续追加）。证据 `acceptance/ui-276/`（截图 + evidence.json）。

## 3. 范围与非范围

**非范围**：自动续跑（按钮仍需手动确认）、subagent 断线续跑 UI 增强（重连能力随 P1 覆盖，提示不入台账）、轮询心跳、页面刷新路径改动（T82 孤儿恢复保持原样）、后端改动、G1+ 阶段事项（packaged/Provider/GA）。

**不变量**：0 新依赖；0 后端改动；BLOCK-38 resume 端点与 ResumePrompt 链路语义不动；legacy 模式（`VITE_AGENT_TASK_MODE=legacy`）不改动；重试链路（retry_pending）语义不动。

## 4. 验收判据

- P1–P3：新增 vitest 全绿 + 既有定向回归（conversationRunStore / ResumePrompt）全绿 + tsc 0 + docs:check / ui:audit:check。
- P4：实机证据 `acceptance/ui-276/`——kill 后端后**免刷新**出现失败态 + 「继续执行」按钮，续跑全链完成。

## 5. 完成语义

P1–P3 完成且门禁全绿 → 提交（UI-276 in_progress）；P4 实机证据齐 → UI-276 verified + 本 plan status completed + DOC-REGISTRY 同步。

## 6. 进度记录

- 2026-09-02 P0 立项登记（用户裁决启动；承接 BLOCK-38 收口时登记的 roadmap 候选）。
- 2026-09-02 P1–P3 完成：copilotClient `subscribeAgentTask` 拆 `subscribeAgentTaskOnce`（返回 lastSeq，终态必收 `[DONE]`，截断即 typed `AgentStreamDisconnectedError`）+ 有界退避重连（1s→4s 封顶，24 次重试总窗口约 90s，`afterSeq=err.lastSeq` 续传；实现更正：plan P1 草案写"约 60s"，实际 24 次 ≈ 90s）+ `onStreamReconnecting` 回调；`streamChatViaTask` 提交阶段保留 legacy 回退、订阅阶段如实 onError；干净截断不再误调 `onDone`。conversationRunStore 主 run `onStreamReconnecting` 置 statusMessage「与任务失去连接，正在重连（第 N 次）…」（delta/finish 既有清理），主 run/resume/sub-agent 三处订阅 catch 透传真实错误、AbortError 不算失败。门禁：新增 `copilotClient.streamReconnect.test.ts` 6/6（核心判据 = 截断→afterSeq 续传重连→failed+resumable 终态）/ conversationRunStore 33/33 / copilot 全目录 218/218 / tsc 0；docs:check / ui:audit:check。UI-276 in_progress，待 P4 实机。
- 2026-09-02 P4 实机收口（UI-276 verified）：dev Electron 实机 kill -9 Electron supervisor 托管后端（:65281，wrapper 的 :3001 与渲染端无关且 kill 会级联关停 dev 栈，验收走 supervisor 后端）→ 全程未刷新（CDP 连续驱动）：t0+2ms「正在重连」statusMessage、t0+807ms「继续执行」按钮自动亮出（两轮独立 kill 复现）→ 确认弹层 → 续跑新 task ed4f4132 completed、s3/s4 补齐、s1/s2 mtime 不变（未重复执行）；tasks 表 interrupted_at + 清扫日志核证。证据 `acceptance/ui-276/`（4 截图 + 时间线日志 + evidence.json A1–A6）。本 plan 收口 completed，DOC-REGISTRY 同步。

G0 开发期常态 · 不外推 packaged / Provider / GA。
