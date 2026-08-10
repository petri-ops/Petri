# Agent 并发设计 — 主 agent 不被长任务阻塞 + 同会话并行 sub-agent

> 2026-08-10 用户在聊天中发现：单个会话里主 agent 跑长任务时，输入框被禁用、无法再发消息，也不能并行起别的任务。本设计承接 `g0-rs-ux1h-async-tool-surface.md` §10 **显式推迟**的"完整子 agent 工作包"决策（原文："是否在本计划收口后启动'完整'子 agent 工作包（收口后再拍板，本计划不涵盖）"），现在正式立项。

---

## 1. 计划元信息

| 字段 | 值 |
|---|---|
| Plan ID | `AGENT-CONCURRENCY` |
| 全名 | Agent Concurrency（主 agent 不阻塞 + 同会话 sub-agent 并行） |
| 父主线 | `feat/agent-concurrency` 分支 |
| 启用形式 | 设计方案先行，评审通过再实现（本文档 = 设计阶段交付物） |
| truthDomain | `agent-concurrency-design` |
| 状态 | `planned`（设计稿，待评审） |
| 关联决策 | 推翻/兑现 `g0-rs-ux1h` §10 的 subagent 池推迟项 |

---

## 2. 背景：当前架构事实（已读代码核实）

### 2.1 现状一句话
**单一 agent loop + 单会话串行 + 跨会话最多并发 3**。同会话内"单在飞"，根因在前端守卫，不在后端跑不动。

### 2.2 后端已经具备并发底座（不用从零造）
- `core/r-server/agent-runner.js` 的 `runAgentLoop()` 在 API 进程内异步跑（L5-8 明确"不 fork worker"），通过 `onEvent` + `appendAgentTaskEvent` 把事件持久化到 SQLite `task_events`，支持断线重连（L336-349）。
- `POST /api/ai/agent` 的 `AGENT_TASK_MODE_v1`（`routes/ai-agent.js` L159-256）：`setImmediate(() => runAgentLoop(...))` 后台执行，HTTP 立即返回 `{taskId, status:'running'}`（L255）；`shouldAbort` 仅由显式取消端点触发（L244），关浏览器不取消。
- 并发锁 `aiTaskConcurrencyAcquire(userId, taskId)`（`helpers/runtime.js` L52-65）：每用户上限 **3**、每 worker 上限 **8**，超限返 `503 user_limit`。**这是 task 级锁，天然支持多 task 并发**。

### 2.3 真正的两个卡点
1. **会话↔LoopRun 1:1 绑定**：`runAgentLoop._loopInit` 用 `getActiveLoopRunForConversation(pid, cid)` 复用同一个 durable `LoopRun`（`agent-runner.js` L552-633）。即一个 `(project, conversation)` 只有一个主 LoopRun，长任务占着它。
2. **前端单在飞守卫**：`conversationRunStore.startConversationRun` 在 `isConversationRunning(conversationId)` 为真时直接 `return false`（L207）；`SimpleChat.tsx` 输入框 `disabled={running || cooling}`（L972）、`disabled={busy}`（L1535/1544）。**同会话无法再发消息/再起任务**。

### 2.4 已收口的不变量（必须保留）
来自 `g0-rs-ux1h` §3.2 / §3.3：
- `run_tool → tool_job → artifact truth` **唯一执行真相**不变。
- 不引入第二套执行器 / 第二张 Job 表 / 第二份 Artifact 真相。
- 不动 P-02 / Harness / Loop 核心契约；不改 plugin 执行路径。

---

## 3. 目标形态（本设计交付什么）

在**单个会话**内：
- 主 agent（primary loop）保持**轻量、始终可响应**——用户随时能发新消息。
- 长任务 / 独立任务被**委派给 sub-agent task**：各自独立 `taskId`、独立 `LoopRun`、独立 `task_events` 流、独立并发槽，后台并行跑。
- 用户可在对话里**监控/取消**每个 sub-agent 任务（卡片式），不必等它结束才能继续聊。

> 这不是"把主 loop 偷偷拆成 worker 线程"，而是**沿用现有 `runAgentLoop` + task 机制，给长任务开"第二条（多条）task 通道"**，主 loop 只负责对话编排与委派。

---

## 4. 架构：主 agent + sub-agent 任务池

```
┌─ 单个会话 (conversationId) ────────────────────────────────┐
│                                                              │
│  主 agent (primary loop)          sub-agent 任务池           │
│  ├─ taskId: T_main  (常驻响应)     ├─ taskId: T1 (DESeq2…)    │
│  ├─ LoopRun: primary              ├─ LoopRun: subagent       │
│  ├─ 用户消息 → 对话/委派            ├─ taskId: T2 (GO/KEGG…)   │
│  └─ 不亲自跑长工具                  └─ LoopRun: subagent       │
│         │ 委派                          │ 各自 task_events    │
│         └─────────────────────────────►│                     │
│                                       ▼                     │
│                             appendMessageToConversation     │
│                             (按 taskId 标记 + 串行化写入)     │
│                                       │                     │
│                                       ▼                     │
│                              会话消息历史 / 结果卡片          │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 委派触发（两档，MVP 先做显式）
- **显式（MVP）**：用户消息可标记为"后台运行"，或 UI 提供"派子 agent 处理"动作 → 直接 spawn 一个 sub-agent task，主 loop 立即回一条"已派子 agent (taskId) 后台处理"卡片，不阻塞。
- **自动（深化）**：主 loop 在决定调用长耗时工具（DESeq2/GO-KEGG/volcano 等）前，自动 fork sub-agent 接管该工具执行，自身返回"已委派"卡片后继续空闲。需主 loop 能识别"长任务"并调用 spawn 接口——本期可后置。

### 4.2 sub-agent 的 LoopRun 身份（关键改造）
- 给 `LoopRun` 增加字段：`kind: 'primary' | 'subagent'`、`parentLoopRunId`（指向主 loop 的 LoopRun）。
- `getActiveLoopRunForConversation` **只 resume `kind='primary'`**（过滤掉 subagent），保证 sub-agent 永不被误当主 loop 续跑（`agent-runner.js` L563-572 改造点）。
- sub-agent LoopRun 为**一次性**：每次委派新建，不续跑；其 `parentLoopRunId` 用于结果回挂到主会话。

### 4.3 并发预算（确保主 loop 永不被饿死）
- 现状每用户 3 槽。改为：**预留 1 槽给主 loop（per conversation）**，其余用于 sub-agent；并把 `AI_MAX_CONCURRENT_PER_USER` 由 3 提到 **5**（`helpers/runtime.js` L20），即"1 主 + 4 sub-agent / 用户"。
- 超限时 sub-agent 入队或优雅拒绝（复用现有 `503 user_limit` 文案），**主 loop 槽不受影响**。

### 4.4 会话历史写入（必须解决的真风险）
多个 task 并发 `appendMessageToConversation` 会**竞态交错**。设计决策：
- 消息表增加 `taskId` 标记（来源 task），渲染时按 task 归组。
- 在 `helpers/conversations.js` 引入**每会话异步写入互斥（append mutex）**，串行化历史写入，执行仍并行。杜绝交错损坏。

### 4.5 事件流投递到前端（按 taskId 订阅）
- 现有 `task_events` 已按 `taskId` 存；扩展 `copilotClient.ts` SSE 订阅支持传入 `taskId`（或列表），`conversationRunStore`/`SimpleChat` 按**每个活跃 taskId** 订阅并合并流。
- 主 loop 流驱动对话消息；sub-agent 流驱动各自进度卡片，互不阻塞。

### 4.6 取消/中止语义
- 每个 task 已有 `shouldAbort: () => isAgentTaskCancellationRequested(taskId)`（`ai-agent.js` L244）。sub-agent 各自独立取消按钮；主 loop 取消保持不变。
- 主 loop 取消时，可选级联取消其名下未完成的 sub-agent（设计评审项，默认级联）。

---

## 5. 范围（Scope）

### 5.1 In Scope
- 后端：`POST /api/ai/agent` 增加 `kind: 'subagent'` + `parentTaskId` 形态，spawn 独立 `runAgentLoop` task；`LoopRun` 增 `kind`/`parentLoopRunId`；`getActiveLoopRunForConversation` 仅 resume primary。
- 后端：`helpers/runtime.js` 并发预算调整（主 loop 预留 + 上限提 5）；`helpers/conversations.js` 加每会话 append mutex + 消息 `taskId` 标记。
- 前端：`conversationRunStore` 从"单 run"改为"**每会话多 run（Map<taskId,run>）**"，区分 primary vs subagent；`SimpleChat.tsx` 输入框仅当 primary 在飞且无后台偏好时禁用；sub-agent 任务卡片（进度/取消）。
- 前端：`copilotClient.ts` / `loop-client.ts` 支持按 `taskId` 订阅多路流。
- 文档：本设计评审通过后转 `active` 工作包，落到 `feat/agent-concurrency`。

### 5.2 Out of Scope（显式不做）
- ❌ 不引入第二套执行器 / 第二张 Job 表 / 第二份 Artifact 真相（守 `g0-rs-ux1h` §3.2）。
- ❌ 不 fork worker 线程跑 loop（沿用现有进程内异步 task 模型）。
- ❌ 不改 `run_tool → tool_job → artifact truth` 唯一执行真相。
- ❌ 不修改 plugin（DESeq2/GO-KEGG/volcano）执行路径本身，只改"谁发起、结果回挂哪"。
- ❌ 不做跨用户/跨项目 agent 编排（本期限定单会话内）。
- ❌ 不取代 `g0-rs-ux1h` 已收口的"总结分离/失败 fail-soft"行为。

### 5.3 依赖与前置
- 现有 `task_events` 持久化、`aiTaskConcurrencyAcquire`、SSE 订阅端点（已具备）。
- `g0-rs-ux1h` 已 completed，async surface 已落地（主对话不被工具同步流锁死）——本设计在此基础上补"同会话可并行起第二个 task"。

---

## 6. 验收判据（Acceptance Gates）

### 6.1 硬门
```text
G-1. docs:check                            → 通过
G-2. ui:audit:check                        → 通过
G-3. node --test 覆盖受影响模块            → 通过
G-4. frontend 单元测试（conversationRunStore 多 run / SimpleChat 输入态） → 通过
G-5. docs:reconcile 不出现新无主文档
```

### 6.2 行为验收（真实跑通才算数）
```text
A-1. 单会话发起长任务（DESeq2）→ 主 loop 立即返回卡片、输入框保持可用
A-2. 长任务跑着时，同会话再发一条消息 → 主 loop 正常响应（不被锁）
A-3. 同会话并行起第 2 个 sub-agent 任务 → 两个 task 并发跑、各自进度卡片独立
A-4. 取消某个 sub-agent → 仅该 task 中止，主 loop 与其他 task 不受影响
A-5. 控制台 0 error；会话历史无交错损坏（多 task 并发写）
A-6. 主 loop 槽永不被 sub-agent 占满（压到每用户上限仍保主 loop 可发）
```

### 6.3 静态边界
```text
S-1. run_tool → tool_job → artifact truth 唯一执行真相不变
S-2. sub-agent 复用 runAgentLoop + 现有工具机制，不新建执行器
S-3. getActiveLoopRunForConversation 仅 resume primary，sub-agent 不续跑为主 loop
S-4. 消息历史写入经每会话 mutex 串行化，按 taskId 标记
S-5. 不改 plugin descriptor / r-server 入口契约
```

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 多 task 并发写会话历史交错损坏 | 每会话 append mutex + 消息 `taskId` 标记（§4.4） |
| sub-agent 占满并发槽饿死主 loop | 主 loop 预留 1 槽 + 上限提 5（§4.3） |
| sub-agent LLM 超时（180s，g0 已知） | 每 task 独立，超时只 fail-soft 该卡片，不杀会话；沿用 g0 总结分离 |
| sub-agent 结果回挂错会话 | `parentLoopRunId` 绑定 + 写入时校验归属 |
| 取消语义混乱 | 每 task 独立取消；主 loop 取消默认级联其 sub-agent（评审项） |
| 范围蔓延 | §5.2 显式 Out of Scope；越界回本文档修订 |
| 文档治理门禁挂 | 启动前/收口前各跑 `npm run docs:check` |

---

## 8. 影响范围（预期文件清单）

```text
core/r-server/agent-runner.js
  - _loopInit / getActiveLoopRunForConversation：LoopRun 增 kind/parentLoopRunId；仅 resume primary
  - runAgentLoop 接受 parentTaskId / kind 参数

core/r-server/routes/ai-agent.js
  - POST /api/ai/agent 增加 kind:'subagent' + parentTaskId 分支，spawn 独立 task

core/r-server/helpers/runtime.js
  - AI_MAX_CONCURRENT_PER_USER: 3 → 5；主 loop 预留槽逻辑

core/r-server/helpers/conversations.js
  - 每会话 append mutex；消息表 taskId 标记；按 taskId 归组读取

core/r-server/agent-task-store.js
  - 现有 task_events 已按 taskId，确认 sub-agent 流可被独立订阅回放

frontend/src/components/copilot/conversationRunStore.ts
  - 单 run → Map<taskId, run>；区分 primary/subagent；isConversationRunning 仅指 primary

frontend/src/components/copilot/SimpleChat.tsx
  - 输入框禁用条件改为"primary 在飞且无后台偏好"；sub-agent 进度卡片 + 取消按钮

frontend/src/components/copilot/copilotClient.ts
  - SSE 订阅支持按 taskId（列表）多路

frontend/src/lib/loop-client.ts
  - 对应 taskId 维度 REST/SSE 封装
```

不修改：
```text
core/shared-backend/llm-providers/*.js   （保留 180s 超时行为）
src/mcp-server.js / src/main.js
core/shared-backend/result-studio-*.js
plugin 执行路径（DESeq2/GO-KEGG/volcano）
```

---

## 9. 测序（实现阶段，本文档评审通过后）

1. **阶段 A（后端底座）**：LoopRun `kind`/`parentLoopRunId` + `getActiveLoopRunForConversation` 仅 resume primary；`ai-agent.js` subagent spawn 分支；`runtime.js` 预算调整。→ 单测 + `node --test`。
2. **阶段 B（历史写入安全）**：`conversations.js` 每会话 mutex + `taskId` 标记。→ 并发写压测无交错。
3. **阶段 C（前端多 run）**：`conversationRunStore` 多 run；`SimpleChat` 输入态 + sub-agent 卡片/取消；`copilotClient`/`loop-client` 按 taskId 订阅。→ 前端单测 + 真实 Electron 验收（A-1~A-6）。
4. **阶段 D（收口）**：`docs:check`/`ui:audit:check` 绿；本设计 `planned → active`；AUDIT-LOG 追加；DOC-REGISTRY 状态更新。

---

## 10. 决策点（已拍板，2026-08-10）

> 用户评审结论，全部采用推荐默认，作为实现基线。

- [x] **自动委派**：本期**仅显式**（用户点"后台运行 / 派子 agent"才 spawn sub-agent）。自动识别长任务 fork sub-agent 后置，不在本期范围。
- [x] **取消级联**：主 loop 取消时**默认级联**取消其名下未完成的 sub-agent，避免孤儿任务。
- [x] **并发预算**：每用户上限 3→**5**，其中**预留 1 槽给主 loop**（per conversation），其余 4 槽给 sub-agent；超限 sub-agent 优雅拒绝（复用 `503 user_limit` 文案）。
- [x] **结果呈现**：sub-agent 结果作为**独立卡片 + 可折叠归组**到主对话，不破坏主对话时间线；不按完成时间穿插进主线程。

## 11. 详细实现任务分解（按文件，已核实行号）

### Phase A — 后端 sub-agent 底座
- **`core/r-server/db.js`**
  - `:86-99` `CREATE TABLE loop_runs` 之后追加（仿 `agent-task-store.js:44-52`）：
    ```js
    try { db.exec('ALTER TABLE loop_runs ADD COLUMN kind TEXT'); } catch {}
    try { db.exec('ALTER TABLE loop_runs ADD COLUMN parent_loop_run_id TEXT'); } catch {}
    ```
  - `loop-contract.js:404` `buildLoopRun` 增 `kind`（默认 `'primary'`）/`parentLoopRunId`（默认 `null`）。
  - `db.js:1104` `persistLoopRun` INSERT 写入 `kind`/`parent_loop_run_id`；`db.js:1155` `getLoopRun` 投影包含这两列。
  - 放宽 `validateLoopRun`（如存在）对未知字段的拒绝。
  - `db.js:1216-1226` `getActiveLoopRunForConversation`：`WHERE` 加 `AND (kind IS NULL OR kind = 'primary')`——**向后兼容历史行（kind NULL 视为 primary）**，仅 resume primary，sub-agent 永不被误当主 loop 续跑。
- **`core/r-server/routes/ai-agent.js`**
  - `:160` `USE_AGENT_TASK_MODE` 分支内新增：`if (req.body.kind === 'subagent')` 路径 →
    1. 校验 `parentTaskId` 存在、属于同一 userId + conversationId（防越权委派）；
    2. 复用现有 `insertAgentTask` + `setImmediate(() => runAgentLoop(...))`，但 `taskId` 独立、`kind:'subagent'`、`parentTaskId` 透传进 `runAgentLoop` 的 `parentLoopRunId`；
    3. 主 loop 路径（`kind` 缺省/primary）完全不变。
  - `runAgentLoop`（`agent-runner.js:313`）签名增 `parentLoopRunId` 形参，透传给 `buildLoopRun`。
- **`core/r-server/helpers/runtime.js`**
  - `:20` `AI_MAX_CONCURRENT_PER_USER` 3 → **5**。
  - `aiTaskConcurrencyAcquire(userId, taskId, { isPrimary })`：sub-agent 路径 `userCount >= 4` 即拒（保留第 5 槽给主 loop），主 loop 永远能拿到槽。

### Phase B — 会话历史并发写入安全
- **`core/r-server/helpers/conversations.js`**
  - `:34-43` `copilot_messages` 之后追加：`try { db.exec('ALTER TABLE copilot_messages ADD COLUMN task_id TEXT'); } catch {}`（仿 `:44-66`）。
  - `appendMessageToConversation`（`:92-101`）写入 `task_id`（从 opts 取，缺省 `NULL`）；读取侧 `COALESCE(task_id, NULL)`。
  - 每会话 append 互斥：模块内 `const _convAppendMutex = new Map()`；`appendMessageToConversation` 用 per-conversation Promise 链串行化（同 `conversation_id` 排队），执行仍并行。

### Phase C — 前端多 run + 按 taskId 订阅
- **`frontend/src/components/copilot/conversationRunStore.ts`**
  - `:88` `runs` 由 `Map<conversationId, snapshot>` 改为 `Map<taskId, snapshot>`；新增 `byConversation(conversationId)` 聚合视图。
  - `isConversationRunning(conversationId)` 改为「仅 primary 在飞」（`startConversationRun` 标 `isPrimary`）。
  - `startConversationRun` 接受 `taskId` + `isPrimary`；新增 `subscribeAllForConversation(conversationId)`：用 `loop-client.fetchLoopRuns({conversationId})`（`:195-206`）拿全部 run，对每个活跃 `taskId` 各开 `copilotClient.subscribeAgentTask`（`:447-502`）。
- **`frontend/src/components/copilot/SimpleChat.tsx`**
  - `:201` `queuedPrompts` drain 守卫由「任意 run 在飞」改为「仅 primary 在飞」。
  - 输入框 `disabled` 条件改 `primary 在飞`；sub-agent 进度卡片复用 `ToolActivityItem`（`toolActivity.ts:9-27`），**按 taskId 隔离各 snapshot.toolActivities**（现存 `mergeToolCallActivity` 按 `callId||name+traceId` 去重，taskId 隔离后直接复用，不改 toolActivity 本身）。

### Phase D — 收口与验收
- **重启孤儿化修复**：app 启动 `agent-task-store.js:54-64` 把 running task 标 failed；sub-agent 恢复需把 `fetchLoopRuns` 的 subagent `taskId` 接入 `findResumableAgentTask`（`copilotClient.ts:349-375`）或等价逻辑，重订阅其 `task_events` 回放（`ai-agent.js:1110-1131`）。
- **取消级联**：`ai-agent.js:1047-1068` cancel 端点扩展——若取消的是 primary `taskId`，查 `loop_runs WHERE parent_loop_run_id = 该 loopRunId` 得子 `taskId`，逐个 `requestAgentTaskCancel`。
- 收口：`docs:check` + `ui:audit:check` 绿 → 设计 `planned → active` → AUDIT-LOG 追加 → DOC-REGISTRY 状态更新 → PR 合 main。

## 12. 边界与兼容（关键）

- **历史 LoopRun 行无 `kind`** → `getActiveLoopRunForConversation` 用 `kind IS NULL OR kind='primary'`，旧行仍被当 primary 续跑，零迁移数据。
- **历史消息无 `task_id`** → `COALESCE` 为 `NULL`，渲染不依赖该列。
- **`validateLoopRun` 若拒绝未知字段** → 一并放宽（加列后才写入）。
- **主 loop 预留槽**：sub-agent 路径 `userCount >= 4` 即拒，保留第 5 槽给主 loop，主 loop 永不被饿死。
- **sub-agent 为一次性**：每次委派新建 LoopRun（`kind='subagent'`，`parentLoopRunId` 指向主），不续跑。

## 13. 测试矩阵

**后端 `node --test`**
- `getActiveLoopRunForConversation` 仅 resume primary：构造 1 primary + 1 subagent 行，确认只回 primary。
- sub-agent spawn：`POST /api/ai/agent` `kind='subagent'` 返回独立 `taskId`，`loop_runs` 行 `kind='subagent'` + `parent_loop_run_id` 正确。
- runtime 预留槽：主 loop(1) + 4 sub-agent 通过；第 5 个 sub-agent 拒（503 user_limit）。
- 并发写历史：`appendMessageToConversation` 同 `conversation_id` 并发 50 次，断言顺序/计数无交错。

**前端单测**
- `conversationRunStore` 多 run、`isConversationRunning` 仅 primary、`SimpleChat` 输入态（primary 在飞禁用、sub-agent 在飞可用）。

**真实 Electron 验收（Phase D 门，A-1~A-6）**
- 启动：`env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 npm run dev`（⚠️ 先 kill 旧 electron 主进程 + 清 `~/Library/Application Support/biof3-local/SingletonLock` + 确认端口 3001/3004 空，规避 dev 孤儿陷阱）。
- 验证：单会话长任务输入框可用、并行起第 2 sub-agent、独立取消、历史无交错、主 loop 槽不被占满。

## 14. 回滚策略

- 所有 schema 变更用 `try/catch ALTER`，新列默认 `NULL`，旧代码路径不依赖 → 代码 `git revert` 安全，列留空无害。
- 旧 `loop_runs` 行 `kind NULL` 仍被 resume 为 primary，回滚后行为不变。
- 前端 `conversationRunStore` 重构若出问题，单文件 `git revert` 即可回到单 run 模型。

---

## 15. 实现进度（2026-08-10）

### 15.1 状态
- **阶段 A（后端底座）**：✅ 已实现 + `node --test` 全绿（5/5）。
- **阶段 B（历史写入安全）**：✅ `conversations.js` `task_id` 列 + 写入已实现；并发压测无交错。
- **阶段 C（前端多 run + 后台运行）**：✅ 已实现 + `vitest` 全绿（34/34，含 4 个新增 sub-agent 用例）。前端保留主 run 单通道不变，新增**平行 sub-agent 子系统**（按 `taskId` 索引），UI 暴露"后台运行"按钮与子任务卡片。
- **阶段 D（收口）**：✅ 已实现（`docs:check` / `ui:audit:check` 通过；A-1~A-6 真实 Electron 验收待本机手测）。

### 15.2 已落地改动（相对 §8/§11 的实际落点）
- `core/r-server/db.js`：`loop_runs` 增 `kind` / `parent_loop_run_id` / `task_id` 三列（idempotent ALTER）；`persistLoopRun` 写三列；`getLoopRun` 投影 `kind`/`parentLoopRunId`/`taskId`；新增 `getLoopRunByTaskId(taskId)` 与 `getLoopRunsByParentLoopRunId(parentLoopRunId)`；`getActiveLoopRunForConversation` 仅 resume primary（向后兼容 `kind NULL`）。
- `core/shared-backend/loop-contract.js`：`buildLoopRun` 默认 `kind:'primary'`、`parentLoopRunId:null`（validateLoopRun 不拒未知字段，安全）。
- `core/r-server/agent-runner.js`：`runAgentLoop` 增 `kind`/`parentLoopRunId` 形参；`_loopInit` 中 subagent 跳过 `getActiveLoopRunForConversation` 续跑；`buildLoopRun` 透传 `kind`/`parentLoopRunId`；`run.taskId = taskId` 使 `loop_runs.task_id` 落库；两处 `appendMessageToConversation` 传入 `taskId`。
- `core/r-server/helpers/runtime.js`：`AI_MAX_CONCURRENT_PER_USER` 3→5；`aiTaskConcurrencyAcquire(userId, taskId, { isPrimary })` 用独立 subagent 计数保证主 loop 预留 1 槽（与启动顺序无关）。
- `core/r-server/helpers/conversations.js`：`copilot_messages` 增 `task_id` 列；`appendMessageToConversation` 写 `task_id`（第 5 参）。
- `core/r-server/routes/ai-agent.js`：`POST /api/ai/agent` 增 `kind:'subagent'` + `parentTaskId` 分支（越权/归属校验、父 loopRunId 解析、subagent 落到父会话线程）；主 loop `concurrency acquire` 标 `isPrimary:true`；返回体带 `kind`/`parentTaskId`；cancel 端点级联取消 primary 名下 sub-agent。
- 测试：`test/agent-concurrency.test.mjs`（5 用例，覆盖 §13 后端矩阵 4 项）。
- `frontend/src/components/copilot/conversationRunStore.ts`：`ConversationRunSnapshot` 增 `parentTaskId?`；新增平行 sub-agent 子系统——`subTaskRuns`(Map<taskId, snapshot>)、`startSubAgentTask` / `stopSubAgentTask` / `getSubAgentTaskSnapshot` / `listSubAgentTasksForConversation` / `subscribeSubAgentTask` / `useSubAgentTask` / `useSubAgentTasksForConversation` / `clearSubAgentTask`。复用 `streamChat` 并透传 `kind:'subagent'` + `parentTaskId`（taskId 在 `onTaskStarted` 中确定后作索引键）。主 run 通道完全不动。
- `frontend/src/components/copilot/copilotClient.ts`：`StreamChatOptions` 增 `kind?` / `parentTaskId?`；`submitAgentTask` 与 `streamChatLegacy` 的 POST body 透传二者（undefined 时 JSON 自动省略，主路径零行为变化）。
- `frontend/src/components/copilot/SimpleChat.tsx`：主 run 忙时（`streaming`）输入区出现「后台运行」按钮 → `runInBackground` 以当前输入作为独立 sub-agent 任务提交（父 `taskId` = 当前主 run 的 `taskId`），输入不被主 run 阻塞；底部渲染 `subAgentTasks` 子任务卡片（状态点 + 进度文本 + 停止按钮）。新增样式见 `simple-chat.css`（`.sc-send-cta-bg` / `.sc-subtasks` / `.sc-subtask*`）。
- 前端测试：`conversationRunStore.test.ts` 新增 4 个用例（独立追踪 / 同会话并发多子任务 / 取消 / 无父 taskId 拒绝 spawn）。
- 阶段 D 重启孤儿重订阅：`copilotClient.ts` 的 `findResumableAgentTask` 过滤 `kind==='subagent'`（老 key 无 kind 视为 primary），新增 `findResumableSubAgentTasks()`；`streamChatViaTask` 写 localStorage 时记录 `kind` + `parentTaskId`（防 sub-agent 被误当主 run 恢复）。`loop-client.ts` 的 `LoopRunCompact` 补 `kind`/`parentLoopRunId`/`taskId`；`ai-loop.js` 的 `GET /api/loop/runs` compact 映射补同字段；`conversationRunStore.ts` 新增 `resumeSubAgentTasks(conversationId, projectId)`（调 `fetchLoopRuns` 找回仍 running 的 sub-agent run 并重订阅其事件流，避免孤儿化）。**注意**：`findResumableAgentTask`/`resumeSubAgentTasks` 的 mount 调用点尚未接线（与主 run 崩溃恢复同源，当前 UI 层无消费方），需与 mount 恢复一并接入。

### 15.3 设计收敛（实现中修正，已落实）
1. **并发写入保护：去掉"每会话 append mutex"，改为"同步 SQLite 原子性 + `task_id` 列"。**
   `better-sqlite3` 为同步串行写入，多 task 并发 `appendMessageToConversation` 不会交错/损坏；原 §4.4 / §7 / §11-Phase B 的"每会话 Promise 互斥链"属过度设计，已收敛为仅加 `task_id` 列并按 taskId 归组（§13 并发压测 300 条无交错验证）。文档表述以本小节为准。
2. **主 loop 预留槽实现：`userSet.size >= perUserCap` 无法保证"先 primary 后 4 subagent"达标**（primary 先占 1 槽后 subagent 只能再占 3 槽）。改为按 `isPrimary` 分别计数：subagent 上限 = `AI_MAX_CONCURRENT_SUBAGENT_PER_USER`(4) 且总数封顶 5，主 loop 始终能拿到预留槽，与启动顺序无关（§13 两组用例验证）。
3. **父会话 / 子任务链路落点：未在 `tasks` 表加列，改为在 `loop_runs` 加 `task_id`。**
   subagent spawn 用 `getLoopRunByTaskId(parentTaskId)` 取父 `loopRunId`；cancel 级联用 `getLoopRunsByParentLoopRunId(parentLoopRunId)` 枚举子 `taskId`；避免在 `tasks` 表再引一列。

### 15.4 下一步
- 阶段 D 收口已完成：`docs:check` + `ui:audit:check` 通过；重启孤儿 sub-agent 重订阅逻辑落地（见上方 §15.2）；设计文档 `planned → active`、DOC-REGISTRY + AUDIT-LOG 已同步；待统一推 PR。
- 真实 Electron 行为验收 A-1~A-6（mount 调用点接入 + 同会话并行 / 取消级联 / 重启重订阅手测）待本机 `launchctl asuser` 启动后执行，当前状态 `in_progress`，不宣称 `verified`。
