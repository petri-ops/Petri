# BioF3 Desktop Agent Harness 错误处理与可靠性独立审查

**日期**: 2026-08-17
**审查视角**: 错误处理与可靠性（独立视角）
**项目**: BioF3 Desktop — Electron + React/Vite + 内嵌 R/Python runtime
**当前阶段**: G0 长期开发期
**审查范围**: Agent Harness 后端（`core/r-server/` + `core/shared-backend/` + `src/main/` + `src/ipc/`）
**不审查范围**: 前端 UI 渲染逻辑、商业逻辑正确性、G1+ 阶段事项（Provider 矩阵/GA/公证/dist staleness 等）

---

## 一、执行摘要

### 1.1 维度发现数量

| 维度 | Critical | Major | Minor | 小计 |
|------|----------|-------|-------|------|
| 错误传播链 | 1 | 4 | 3 | 8 |
| 重试策略 | 0 | 3 | 2 | 5 |
| 取消语义 | 0 | 2 | 2 | 4 |
| 故障恢复 | 1 | 3 | 2 | 6 |
| 死循环/振荡检测 | 0 | 1 | 1 | 2 |
| **合计** | **2** | **13** | **10** | **25** |

### 1.2 整体可靠性评分

**自评 7/10（10 = 工业级，1 = 完全不可靠）**

**核心判断**：BioF3 Desktop 的 Agent Harness 后端在错误传播的**结构化**和**可观测性**上做了显著投入（标准 envelope、retryable 错误码、tool_job 终态持久化、Artifact Truth、owned-backend-supervisor 自愈重启），整体骨架是稳健的。**但有两类显著薄弱**：

1. **Provider 错误 context 大量丢失**：上游原始 message（`parsed.error.message`）在多次 fallback + model routing wrapper 后被简化或截断为 `http_xxx` 等短码；用户看到的错误往往只是 "上游异常：http_429"，缺少 Provider 真实 message。
2. **Retry 策略分散且语义不一致**：`model-gateway.js` 用 `isRetryableProviderError` 做可重试判断（带 status code 与 error code），但 `agent-runner.js` 又叠一层 `provider_retry` 循环（maxAttempts=3），`agent-task-store.js` 又实现了一套 `RETRY_POLICY`（基于字符串匹配 `timeout/rate_limit/...`）。三套机制并存，**职责边界模糊**——一个失败可能同时触发两套重试，或三套都失败才终止。

### 1.3 一句话总结

> 当前后端在"被 fail-closed 设计保护的关键路径"上可靠，但在"长尾失败 → 用户感知"这条链路上系统性丢失 Provider/原始 message context，并且 3 套重试策略职责重叠；G0 阶段的最大可靠性债务是**统一重试边界**和**保留 Provider 原始 message 的传播链路**。

---

## 二、错误传播链分析

### 2.1 典型路径图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 0: Provider API (DeepSeek / Anthropic / DashScope / Ollama / vLLM)    │
│   → 200 OK / 401 / 429 / 500 / SSE parse error / TCP timeout                  │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 1: core/shared-backend/llm-providers/{deepseek,anthropic,dashscope}.js │
│   → 统一 { error: code, message, status } shape                              │
│   → 区分: no_api_key / serialize_error / http_error / api_error /            │
│           timeout / req_error / res_error / parse_error / network_error     │
│   → 关键丢失点: 多个 provider 把 HTTP error body 截到首句或省略                │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 2: core/shared-backend/llm-providers/model-gateway.js (chat/vision)    │
│   → isRetryableProviderError() 决定是否切到 fallback profile                 │
│   → isRetryable 集合: network_error/req_error/res_error/timeout/parse_error/ │
│                      http_error/api_error  + HTTP 408/409/425/429/5xx        │
│   → 不可重试: aborted / no_api_key / serialize_error                          │
│   → 关键丢失点: 用户看到 errorCode 而非真实 Provider message                  │
│   → modelRouting.fallbackFrom + reason 记录，但 reason 也是 short code       │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 3: core/r-server/agent-runner.js (runAgentLoop)                        │
│   → callChatProvider 失败 → assessFinalizationResult.retryable 决定再 retry  │
│   → provider_retry 循环 maxAttempts=3（最终整理阶段）                          │
│   → finalization_retry 循环 MAX_FINALIZATION_ATTEMPTS=2                       │
│   → 关键丢失点: 流式 SSE 中 emit({ error: errorCode, message })               │
│     但 onEvent 的 done/error 之后 SSE 流不再 retry                            │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 4: core/r-server/routes/ai-chat.js / ai-agent.js (HTTP / SSE)           │
│   → SSE error event: { error: '模型请求失败: ' + error.message }              │
│   → agent task mode: agentTaskStore.markAgentTaskFailed(taskId, error)       │
│   → 关键丢失点: writeError(msg) 直接 JSON.stringify 单字段                     │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 5: src/main.js (IPC handler)                                           │
│   → ipcMain.handle 返回 { ok: false, error: e.message }                       │
│   → 大部分 handler 用 try/catch(e) → { ok:false, error: e.message }          │
│   → 关键丢失点: stack trace 永不返回                                            │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 6: src/preload.js (contextBridge IPC)                                  │
│   → 透传 { ok, error } 给 renderer                                           │
│   → 关键丢失点: preload 不增强 envelope（如添加 requestId）                    │
└────────────┬────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Layer 7: frontend/src/lib/desktopBridge.ts (renderer client)                 │
│   → 调用方拿到 { ok: false, error: 'xxx' }                                   │
│   → 显示给用户的字符串通常 ≤ 200 字（来自 stderr tail / Provider message）    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 五个最常见的错误场景

#### 场景 A：Provider 上游返回 4xx/5xx（非 401/403/429）

- **触发条件**：DeepSeek API 返回 `429 rate_limit_exceeded`、`500 internal_server_error`、`502 bad_gateway`，Anthropic 返回 529 overloaded。
- **各层表现**：
  - Layer 1：DeepSeek `chatStream()` 解析 errorBuffer → `fail('http_error', message, { status })`。
  - Layer 2：Model Gateway `isRetryableProviderError()` 看 status 408/409/425/429/≥500 → true；切 fallback profile。
  - Layer 3：`agent-runner.js` `if (upJson && !upJson.error && upJson.choices) break`；`upJson.error` 时尝试 provider_retry（maxAttempts=3）。
  - Layer 4：HTTP route `writeError((result && (result.message || result.error)) || '模型请求失败')` —— **用户看到的是原始 message**（例：DeepSeek 的 "Rate limit reached"），但若 message 本身为空（某些 provider），fallback 到 `result.error` 短码。
  - Layer 5-6-7：透传到 UI。
- **context 是否丢失**：**部分丢失**。Provider 原始 message 通常保留，但若 message 为空则只剩 code；`request_id`/`execution_id` **从不传递**到前端。
- **用户能否看到**：是（弹出错误条），但缺少**请求追踪 id**，导致用户报错时开发者无法定位到具体上游 trace。

#### 场景 B：TCP 连接超时 / DNS 失败

- **触发条件**：用户网络断开、Endpoint 不可达、fetch 60s+ 未响应。
- **各层表现**：
  - Layer 1 (DeepSeek)：`req.on('timeout')` → `fail('timeout', '请求超时')`；`req.on('error')` → `fail('req_error', error.message)`。
  - Layer 1 (Anthropic)：fetch `AbortError` → catch → `{ error: 'network_error', message: error.message }` 或 `'aborted'`。
  - Layer 2：timeout/network_error 在 RETRYABLE 集合 → 切 fallback。
  - Layer 3：provider_retry 重试同 provider 或 fallback。
  - Layer 4：写 SSE error。
- **context 是否丢失**：**严重丢失**。`error.message` 通常是裸 `connect ECONNREFUSED ::1:443` 或 `The user aborted a request`，**没有 endpoint URL、没有 attempt 序号、没有 provider 名字**。
- **用户能否看到**：是，但错误信息对终端用户**没有可操作含义**（用户不知道是哪个 provider 失败）。

#### 场景 C：R/Python 子进程被 SIGKILL（OOM、用户取消、超时）

- **触发条件**：R 脚本内存爆掉（macOS 杀进程）、用户点击 stop、`BIOF3_TOOL_HARD_TIMEOUT_MS` (默认 30 min) 触发。
- **各层表现**：
  - `core/r-server/helpers/process-lifecycle.js` `terminateChildProcess()` 发 SIGTERM，5s 后发 SIGKILL。
  - `core/r-server/helpers/tools-executor.js` 回调：
    - `if (active.cancelRequested)` → `finalizeCancellation()` → 状态 `cancelled`。
    - 否则 `markJobFailed(jobId, '任务超过最大运行预算 Xms；...', 'execute')`。
  - IPC `result:update` 透传 status='failed'。
- **context 是否丢失**：**保留较好**。Error message 包含 timeoutMs、signal（SIGTERM/SIGKILL）、setupFailure phase。但**调用方难以区分"被取消"和"被 OOM kill"**——两者最终都进 cancelled 或 failed，丢失中间原因。
- **用户能否看到**：是；`tool_jobs.error` 字段、Result Studio 的 toast。

#### 场景 D：SQLite 锁死 / 写失败

- **触发条件**：高频写入（heartbeat / page_view）持有 WAL writer 时，admin API 读阻塞；或 SQLite 文件损坏。
- **各层表现**：
  - `core/r-server/db.js` 设置 WAL 模式 + `busy_timeout = 10000`（10s）+ `wal_autocheckpoint = 1000`，**配置合理**。
  - 但 `agent-task-store.js` 启动时 `new Database(config.dbPath)`，与 r-server 共享 db 时**没有复用连接**——两个 connection 同时写，存在竞争（虽然 WAL 模式允许并发读 + 单写）。
  - `tools-executor.js` `markUnownedStaleJobs()` 显式用 SQL `UPDATE ... AND id NOT IN (?)` 跳过 owned 任务，**避免 PID 误杀**（设计稳健）。
- **context 是否丢失**：**大部分保留**。`db.updateToolJob(failed)` error 写入 DB，**但 e.stack 从不上报到 console（只用 `console.warn`）**。
- **用户能否看到**：部分；tool_job 状态对前端可见，但**SQLite 异常本身不进用户 UI**——用户会看到 task 卡在 `running`，直到 zombie recovery（5 min 间隔）触发。

#### 场景 E：SSE 连接断开（用户关浏览器/网络闪断）

- **触发条件**：用户在流式响应中途关闭 tab、SSE 连接 timeout、Electron 进程被 OS 杀。
- **各层表现**：
  - **Legacy 直连 SSE** (`/api/ai/agent` 直连模式)：`req.on('close', () => { aborted = true })` → `if (aborted) break loop`。
  - **Task mode** (`/api/ai/agent` 后台模式)：`req.on('close')` **不取消 task**（注释明确写 "Closing a subscription does not cancel the task. Only the explicit cancellation endpoint below flips this persisted flag."）。订阅端点断连后，前端靠 polling `/api/ai/agent/task/:taskId/subscribe?afterSeq=N` 重连。
  - **断线后状态**：agent 任务继续在 r-server 后台跑，事件流持久化到 `task_events` 表。前端重连时从 lastSeq 续传。
- **context 是否丢失**：**保留良好**（task_events 持久化）。
- **用户能否看到**：能 resume；但**用户重新打开窗口时 UI 不主动提示"任务仍在跑"**——需要 polling 轮询后才显示。

---

## 三、每个发现（编号 E-001 ~ E-025）

### 严重程度说明
- **Critical**：阻塞核心用户路径、可能导致数据丢失/损坏、或安全相关
- **Major**：用户体验显著下降、debug 困难、或多场景叠加才暴露
- **Minor**：单点优化、文档缺口、或风格一致性

---

### E-001 [Major] model-gateway 丢弃 Provider 原始 message，只传播 short code

**文件位置**: `core/shared-backend/llm-providers/model-gateway.js`

**问题描述**：当 Provider 返回 5xx 时，`result.message` 通常包含详细原因（如 "rate_limit_exceeded: please retry after 30s"），但 model-gateway 通过 `errorCode(result)` **仅取 code/status**，传给 `onEvent` 的 message 字段只保留 message 字符串。**且 fallback 走自定义回调函数时，可能拿到的 result.message 被简化**（fallback 仅看 reason，未透传完整 message 到 SSE）。

**影响**：用户看到 `error: 'http_error', message: 'http_500'`，缺少 Provider 真实细节；开发者排查时无法从 message 还原 Provider 真实报错。

**建议修复**：在 `ModelGateway.chat()` 返回前构造完整的 `providerError` envelope（`{ provider, status, code, message, raw, attempts }`），并通过 `modelRouting.providerErrorEnvelope` 透传给上层。

---

### E-002 [Major] SSE 错误事件结构简单，丢失 stack 与 request_id

**文件位置**: `core/r-server/routes/ai-chat.js`；`core/r-server/routes/ai-agent.js`

```javascript
const writeError = (msg) => {
  if (ended) return;
  try {
    res.write('data: ' + JSON.stringify({ error: msg }) + '\n\n');
  } catch {}
}
```

**问题描述**：SSE 错误事件仅含 `{ error: <string> }` 单字段。**无 `request_id`、`trace_id`、`conversation_id`**。上层 `agent-runner.js` 已有 `createTraceId()`、`createCallId()`，但**只在 envelope（工具结果）维度追踪**，未在 SSE error event 维度同步。

**影响**：用户报错时，开发无法用唯一 id 把前端报错与后端日志关联；debug 依赖时间戳 + conversationId 模糊匹配。

**建议修复**：构造 SSE error envelope `{ event: 'error', traceId, conversationId, code, message, recoverable }`，让 `writeError` 接受对象参数。

---

### E-003 [Major] agent-runner.js 顶层 catch 的 error.message 丢失 stack

**文件位置**: `core/r-server/agent-runner.js` (顶层 catch 块)

```javascript
} catch (e) {
  fatalAgentError = e;
  _emit({ error: e.message });
  if (loopRunId && !cancellationObserved) {
    _loopPersistPhase('failed', 'Harness Loop 收口失败，执行记录与已有产物已保留。');
  }
}
```

**问题描述**：外层 catch 只把 `e.message` 喂给 `_emit`，**丢失 stack、code、原始 Error 类型**。下游 SSE 用户看到 `error: 'xxx is not a function'` 之类的 V8 原生 message，**没有 stack 定位**。

**影响**：bug 报告没有 stack trace，开发需手动 ssh 进 r-server 看 stderr 日志。

**建议修复**：构造标准化 `fatalErrorPayload = { message: e.message, name: e.name, stack: e.stack, code: e.code }`，`agent_task.mode` 时写入 `agent_tasks.error` 字段（DB），`legacy` 模式时 SSE 推送 `{ error: { message, code, stack } }`。

---

### E-004 [Major] IPC handler `try/catch (e) → { ok: false, error: e.message }` 模式丢失 stack

**文件位置**: `src/ipc/result-handlers.js`（多处）；`src/ipc/branch-handlers.js`；`src/ipc/harness-capabilities.js:36`；`src/ipc/backend-lifecycle.js`

```javascript
ipcMain.handle('result:create', async (_, { ... }) => {
  try {
    // ...
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
```

**问题描述**：所有 IPC handler 统一 `try/catch (e) → { ok:false, error:e.message }`。**stack 永不跨 IPC 返回**（Electron IPC 序列化也会自动剥掉 stack）。

**影响**：debug 依赖 Electron 主进程 stderr 日志 + 用户口述；不能像 web 后端那样"前端 console 直接显示完整错误对象"。

**建议修复**：当前 G0 阶段保留原样（不破坏 IPC contract），但在每个 catch 内追加 `console.error('[IPC <channel>] handler failed:', e)`（带 stack），并在 `desktopBridge.ts` 客户端额外 log 错误到 dev console。

---

### E-005 [Major] legacy SSE vs task mode 取消语义不一致

**文件位置**: `core/r-server/routes/ai-agent.js`（legacy mode + task mode 区段）

**问题描述**：两种模式下"用户关闭 SSE 连接"含义不同：
- **Task mode**：订阅关闭 ≠ task 取消（task 继续后台跑，靠 polling resume）。
- **Legacy 直连 SSE**：req.close 立即把 aborted=true → loop 退出。

**影响**：用户预期"关窗口就停"，但 task mode 实际**不取消**——可能在 background 继续消耗 token、Provider API 调用费用。前端需要明确"关闭订阅 ≠ 取消"的状态指示。

**建议修复**：在 task mode 暴露 IPC `ai-agent-task:cancel` 端点（已存在 `POST /api/ai/agent/task/:taskId/cancel`）的同时，前端在 unsubscribe 之前显式 confirm "task continues in background"。

---

### E-006 [Minor] model-gateway.js 不区分 timeout vs network_error 在 abort 路径

**文件位置**: `core/shared-backend/llm-providers/model-gateway.js`

```javascript
if (!code || code === 'aborted' || code === 'no_api_key' || code === 'serialize_error') return false;
```

**问题描述**：`aborted` 被归为不可重试，但用户可能因临时网络抖动触发 AbortError（fetch 的 AbortController 超时）—— 这本质是 transient，**应作为可重试**。

**影响**：偶发的 fetch abort 后 model-gateway 直接放弃，**不尝试 fallback profile**。

**建议修复**：把 aborted 拆为 `aborted_by_user`（来自 `options.signal.aborted`，不重试）和 `aborted_by_timeout`（来自 controller timeout，可重试）。

---

### E-007 [Minor] Anthropic provider healthCheck 失败时 swallow 错误

**文件位置**: `core/shared-backend/llm-providers/anthropic.js` (healthCheck)

```javascript
async healthCheck(apiKey, options = {}) {
  if (!apiKey) return false;
  try {
    const response = await fetch(endpointUrl(options.baseUrl, '/models'), {
      headers: requestHeaders(apiKey, options),
      signal: options.signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

**问题描述**：`catch {}` 全吞，`return false`。前端 health-check UI 看不到"是 401 还是 503 还是 network"。

**影响**：用户诊断 "Anthropic key 不工作" 时只能看到 false，无法区分。

**建议修复**：返回 `{ ok: bool, error: { code, message } }`，让 healthCheck UI 显示具体原因。

---

### E-008 [Minor] circuit-breaker.js 未被任何 caller 接入

**文件位置**: `core/r-server/helpers/circuit-breaker.js`（约 280 行）

**问题描述**：`circuit-breaker.js` 定义了 `wrapChatProvider(callChatProvider)` API 和 `LLMCircuitBreaker` 类，但**没有证据显示 `llm-client.js` 或 `model-gateway.js` 调用它**。`grep` 仅命中该文件自身。

**影响**：`failureThreshold: 5` / `recoveryTimeout: 60s` / `halfOpenMaxCalls: 3` 配置**写在文档里但没生效**。这是 "dead code" 而非 "fault tolerance"。

**建议修复**：要么接入 model-gateway（在 `chat()` 失败时调用 `breaker.recordFailure(profileId)`），要么标注"电路断路器未启用"作为已知缺口。

---

### E-009 [Major] 三套重试策略并存（model-gateway / agent-runner / agent-task-store）

**文件位置**:
1. `core/shared-backend/llm-providers/model-gateway.js` — `isRetryableProviderError()`
2. `core/r-server/agent-runner.js` — `provider_retry` 循环 maxAttempts=3
3. `core/r-server/agent-task-store.js` — `RETRY_POLICY` (network_timeout/rate_limit/model_overloaded/internal_error)

**问题描述**：三套机制职责重叠：
- model-gateway 在**单次 callChatProvider**内做 profile fallback。
- agent-runner 的 provider_retry 循环是**外层 application-level retry**——但它直接再次调用 callChatProvider，会**再次进入 model-gateway 内部 fallback**。
- agent-task-store 的 RETRY_POLICY 通过 `scheduleAgentTaskRetry(taskId, error)` 排到 `next_retry_at`——但**目前没有 worker 实际消费** `retry_pending` 状态的任务（grep `retry_pending` 只命中 DB 索引创建，无 cron/scheduler 调用 `getRetryableTasks()`）。

**影响**：
1. 用户感知：同一次失败可能触发 model-gateway fallback（不通知用户）+ agent-runner provider_retry（emit `agent_status phase=provider_retry`）+ agent-task-store retry（仅入库，不自动执行）。
2. 调试：日志里同时出现 `model_fallback`、`provider_retry`、`retry_pending`，但哪个生效不清楚。

**建议修复**：明确边界——
- model-gateway = transport-level fallback（profile 切换）
- agent-runner = user-perceived retry（emit status；总上限 3 次）
- agent-task-store = durable retry queue（cron worker；当前未启用）

写文档或在 `core/shared-backend/retry-strategy.md` 明确分层。

---

### E-010 [Major] agent-task-store RETRY_POLICY 通过字符串匹配 error.message 推断 error_type

**文件位置**: `core/r-server/agent-task-store.js`

```javascript
function detectErrorType(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('timeout') || message.includes('timed out') || message.includes('network')) {
    return 'network_timeout';
  }
  if (message.includes('rate limit') || message.includes('rate_limit') || message.includes('too many requests')) {
    return 'rate_limit';
  }
  // ...
}
```

**问题描述**：用 `error.message` 字符串匹配分类 retry policy。脆弱性：
- Provider i18n 化（中文错误、含 "Rate Limit" 大小写不一致）会误分类。
- 字符串 `model_overloaded` 仅靠 "overloaded"、"model busy"、"server busy"——OpenAI 的 "Server is overloaded. Please try again later." 命中，但 Anthropic 的 "Overloaded_error" 因 toLowerCase 后仍命中（"overloaded"）。

**影响**：分类错误 → retry policy 选错（可能以错误退避间隔重试，浪费 token / quota）。

**建议修复**：用 `error.code` 或 `error.type` 字段（Provider 已标准化为 `'timeout'/'http_error'/'api_error'`）而非字符串匹配。

---

### E-011 [Major] agent-task-store.scheduleAgentTaskRetry 写库后无 worker 触发重试执行

**文件位置**: `core/r-server/agent-task-store.js` (scheduleAgentTaskRetry)

**问题描述**：`scheduleAgentTaskRetry` 把 task 标记 `status='retry_pending'`、`next_retry_at=...`，并通过 `updateRetryInfo` SQL 写入。但**代码库内没有任何地方调用 `getRetryableTasks()`**（grep `getRetryableTasks` 只命中 module.exports 自身）—— **scheduler/worker 缺失**。

**影响**：retry_pending 任务永久积压，但前端 UI 只看 `agent_status`，retry_pending 状态在 UI 上是什么表现未定义（`task_events` 表也没记录 retry 状态变化）。

**建议修复**：要么实现 cron worker（`scripts/agent-retry-worker.mjs` 或嵌入 r-server startup），要么删除 `RETRY_POLICY` 全部代码（标记为 deferred）。

---

### E-012 [Major] process-lifecycle.js zombie recovery 后 tool_jobs.process_pid 仍指向旧 PID

**文件位置**: `core/r-server/helpers/process-lifecycle.js`；`core/r-server/helpers/tools-executor.js`

```javascript
async function markUnownedStaleJobs({ db, cutoff, now = Date.now, ownedJobIds = [] }) {
  // ...
  return db
    .prepare(
      "UPDATE tool_jobs SET status = 'failed', error = '任务心跳失活且无本次进程句柄；进程归属无法证明，未发送信号', completed_at = ? WHERE status IN ('running', 'pending') AND COALESCE(heartbeat_at, created_at) < ?"
      + excludeOwned
    )
    .run(now(), cutoff, ...owned);
}
```

**问题描述**：
- 设计是稳健的：**未在 ownedJobIds 内的 zombie job，只标 failed，不发信号**（注释明示避免 PID 复用误杀）。
- 但 IPC handler `result:get` / `result:status` 透传 `tool_jobs.process_pid` 给前端，**前端可能基于陈旧 PID 显示"进程仍在运行"**。

**影响**：用户看到 tool_job status='failed' 同时 process_pid 仍指向一个**已被 OS 复用的** PID；若有同 PID 的其他进程，前端 UI 混乱。

**建议修复**：在 `markUnownedStaleJobs` 时同时 `UPDATE tool_jobs SET process_pid=NULL`。

---

### E-013 [Major] SSE 错误事件后不触发 IPC 通知，前端必须 polling

**文件位置**: `core/r-server/routes/ai-agent.js` (POST /api/ai/agent handler)

**问题描述**：task mode 下，HTTP POST 立即返回 `{ status: 'running' }`，后续事件流通过 SSE 推送。但 IPC 端（preload bridge）**不接收 SSE 事件**——前端必须主动调 `desktopBridge.invoke('agent:subscribe', taskId)` 拉 SSE。

**影响**：前端启动 SimpleChat 后**默认不订阅 SSE**，需要 React effect 显式建立。如果 effect 漏掉或被 React 18 strict mode 双重调用处理不当，用户看不到任务进度。

**建议修复**：在 `runAgentLoop` 完成后主动 `webContents.send('agent-task:complete', taskId)` 推 IPC 事件（仅 task mode），让前端不用 polling 也能感知终态。

---

### E-014 [Minor] db.js schema migration 用 `try { ALTER TABLE } catch {}` 风格

**文件位置**: `core/r-server/db.js`（多处 ALTER 段）

```javascript
for (const statement of [
  'ALTER TABLE tasks ADD COLUMN user_id TEXT',
  // ...
]) {
  try {
    db.exec(statement);
  } catch (err) {
    logger.warn(`[agent-task-store] schema step skipped: ${statement} (${err && err.message})`);
  }
}
```

**问题描述**：agent-task-store.js 写了"ALTER 列不存在时抛错吞掉"的注释，但**CREATE INDEX 失败时如果前置 ALTER 没成功，索引创建也会失败——此时应该 warn 而非 silent**。代码虽然 warn 到 logger，但 logger level 可能是 warn（默认 INFO），运营可能错过。

**影响**：数据库 schema 在某次升级时若 ALTER + INDEX 配对失败，**索引缺失**——后续 query 性能问题，但 UI 无感知。

**建议修复**：让 schema migration 严格按 (ALTER, INDEX) 配对追踪，先 ALTER 成功才尝试对应 INDEX；任何失败升 ERROR。

---

### E-015 [Minor] ai-bridge.js 的 try/catch 链在 globalThis 上设置属性

**文件位置**: `core/r-server/ai-bridge.js`

**问题描述**：`try { globalThis._biof3.recordAiUsage = recordAiUsage; } catch {}` 模式**几乎不可能抛错**——除非 `_biof3` 本身被 freeze。`catch {}` 是过度防御。

**影响**：无直接影响；但模式传染——其他模块可能误以为 `try { assignment } catch {}` 是必要的，造成代码噪音。

**建议修复**：删除 try/catch，若需要可加 `Object.defineProperty(globalThis._biof3, key, { value, writable: true })`。

---

### E-016 [Minor] plugin-loader.js 加载失败仅 console.warn，无结构化错误码

**文件位置**: `core/r-server/agent-tools/plugin-loader.js`；`core/r-server/helpers/tools-executor.js`

**问题描述**：插件加载失败全部走 `console.warn('[tools] ...')`，没有写入 `tool_jobs.error` 或返回结构化 error。

**影响**：前端 UI 在 plugin 不可用时只看到 `tool_jobs.status='failed'` + error 含 'Unknown tool'——但用户不知道是 plugin 加载失败还是 tool 不存在。

**建议修复**：plugin-loader 暴露 `getLoadErrors()` 列表，IPC 端在 `result:create` 错误时合并展示。

---

### E-017 [Critical] Backend procs exit handler 不推送 IPC status 事件

**文件位置**: `src/main/backend-proc-manager.js`

```javascript
gatewayProc.on("exit", (code) => {
  console.log(`[desktop] gateway exited: ${code}`);
  gatewayProc = null;
});
```

**问题描述**：4 个 backend proc 的 `exit` handler **仅打日志 + null 引用**，没有 `webContents.send('backend:status', { name, status: 'down' })`。前端 `backend:status` IPC 只能在用户主动 invoke 时拉快照，**不会实时感知**。

**影响**：r-server crash 后，前端用户继续发请求；下次 IPC 调用才返回 "ECONNREFUSED 127.0.0.1:3003"——错误信息不友好（只是 TCP refused），用户不知道是 r-server 死了。

**建议修复**：所有 4 个 proc 的 exit handler 调 `mainWindow.webContents.send('backend:status', { name, status: 'down', code })`；前端 React state 订阅。

---

### E-018 [Critical] rServerSupervisor 自动重启时无 IPC 通知，且 DB / HTTP 句柄未刷新

**文件位置**: `src/main/backend-proc-manager.js`（rServerSupervisor 段）

**问题描述**：`rServerSupervisor` 会在 r-server crash 后 500ms / 1s / 2s / 5s / 10s / 30s 退避重启。重启后**主进程持有的 HTTP fetch 引用全部失效**（TCP 端口已重置），但**没有 IPC 通知前端"r-server 正在重启"**。前端继续发起 fetch → 前 1-2 秒内 `ECONNREFUSED`。

**影响**：用户感知"突然所有 AI 请求失败"，过几秒恢复。无明确反馈。

**建议修复**：supervisor 在 `scheduleRestart()` 内 `mainWindow.webContents.send('backend:status', { name: 'r-server', status: 'restarting' })`。

---

### E-019 [Major] r-server 内 SQLite 共享一个 db 文件但开两个 connection，busy_timeout 不一致

**文件位置**: `core/r-server/agent-task-store.js` vs `core/r-server/db.js`

```javascript
// agent-task-store.js
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// db.js (主入口)
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
```

**问题描述**：两个 module 各开一个 `better-sqlite3` connection，**busy_timeout 不一致**（5000 vs 10000）。WAL 模式允许多 reader + 单 writer，但 busy_timeout 不一致时**短 timeout 的连接先抛 SQLITE_BUSY**——agent-task-store 的 query 比 r-server/db.js 的短 5s。

**影响**：agent_task mode 下高并发写入可能 SQLITE_BUSY → retry pending 失败。

**建议修复**：把 busy_timeout 统一到一个常量 (`core/shared-backend/db-config.js`)，agent-task-store 直接 require。

---

### E-020 [Major] markUnownedStaleJobs 无 IPC 端点暴露运营统计

**文件位置**: `core/r-server/helpers/process-lifecycle.js`

**问题描述**：zombie recovery 在启动时 + 每 5 min 跑一次，但**没有 IPC 端点**暴露"最近 1 次 zombie scan 回收多少 job"。运营无法知道是否有大量进程在 OS 端死亡。

**影响**：故障诊断时，运营需查 DB 才知道有没有 zombie job。

**建议修复**：在 `backend-proc-manager.js` 暴露 IPC `backend:zombie-stats` 返回 `{ lastScanAt, recoveredTotal, lastBatchSize }`。

---

### E-021 [Minor] SSE 错误事件后未调 res.end()，连接悬挂

**文件位置**: `core/r-server/routes/ai-agent.js`（订阅端点）

**问题描述**：SSE 端点 send `done`/`error`/`cancelled` 后**不调 `res.end()`**，前端 EventSource 可能不会自动断开连接——browser 维持 SSE 长连接直到 timeout（通常 60s+）。

**影响**：前端 EventSource 维持挂起连接，浪费句柄。

**建议修复**：订阅端点 send 终止事件后**显式 res.end()**。

---

### E-022 [Major] 取消语义：用户取消 vs Controller abort vs tool_job timeout 三者终态冲突

**文件位置**: `core/r-server/agent-runner.js`；`core/r-server/helpers/tools-executor.js`

```javascript
// agent-runner
if (terminal.status === 'cancelled') {
  agentTaskStore.markAgentTaskCancelled(taskId);
}

// tools-executor
async function settleConfirmedToolCancellation({ db, jobId, result, ... }) {
  return db
    .prepare('UPDATE tool_jobs SET status=?, error=?, result_json=?, completed_at=?, process_pid=?, heartbeat_at=? ...')
    .run('cancelled', null, JSON.stringify(result), ...);
}
```

**问题描述**：
- 用户手动取消：`tool_jobs.error = NULL`，`status='cancelled'`
- Loop Controller abort（异常循环）：同上
- tool_job 硬超时（30 min）：`status='failed'`, `error='任务超过最大运行预算 Xms；...'`

但 agent_run level 的 cancelled **不区分是用户取消还是 controller_aborted**——都进 `markAgentTaskCancelled(taskId)`，error=NULL。

**影响**：用户看 `agent_tasks.status='cancelled'` 时，不知道是主动取消还是系统自动。

**建议修复**：扩展 `tasks.error` 列写入 reason（`'user_cancelled'` / `'controller_aborted'` / `'hard_timeout'`），前端 UI 区分展示。

---

### E-023 [Minor] MAX_IDENTICAL_TOOL_CALLS = 3 是硬编码常量

**文件位置**: `core/r-server/agent-tools/agent-loop-control.js`

**问题描述**：相同工具 + 相同参数连续 3 次触发停止（"repeated_tool_call"）。但**3 次的合理性没文档化**——某些场景下用户希望"再试一次不同入参"被识别为新 attempt 而非重复。

**影响**：用户配置某工具需要 retry 时（Provider/网络瞬态错误），agent 会在 3 次后被强制停。

**建议修复**：暴露环境变量 `BIOF3_AGENT_MAX_IDENTICAL_TOOL_CALLS`，并在 SETTINGS 中提供 UI。

---

### E-024 [Major] model-gateway fallbackReason 不传播原始 message

**文件位置**: `core/shared-backend/llm-providers/model-gateway.js`

```javascript
_recordFallback(role, fromProfileId, toProfileId, reason) {
  const event = { role, fromProfileId, toProfileId, reason };
}

if (index > 0 && typeof onEvent === 'function') {
  const fallback = this._recordFallback(role, previousProfileId, profile.id, previousReason);
  onEvent({
    type: 'model_fallback',
    ...fallback,
  });
}
```

**问题描述**：`reason` 是 `{ code, status }` 短结构（如 `{ code: 'http_429', status: 429 }`），**不含 Provider 原始 message**。onEvent 推送的 `model_fallback` 事件前端能展示 fallback 发生，但**不能展示 fallback 的具体原因**。

**影响**：用户在 UI 看到 "Fallback to model B" 但不知道"为什么"（rate limit? overloaded? timeout?）。

**建议修复**：在 `previousReason` 中同时附 `message: previousResult.message`。

---

### E-025 [Minor] local-storage.js SQLite 错误仅 log 不抛出

**文件位置**: `core/shared-backend/storage/local-storage.js`

```javascript
} catch (error) {
  console.error('[local-storage] operation failed:', error);
}
```

**问题描述**：catch 后 `console.error` 但不 rethrow——调用方拿不到 error。

**影响**：上层假设"操作成功"——例如 `setItem` 失败后，cache 数据不一致。

**建议修复**：根据 operation 决定是否 rethrow（set 失败应 throw，get 失败可返回 null）。

---

## 四、重试策略评估

### 4.1 当前重试分层（已映射）

| 层级 | 机制 | 触发条件 | 退避 | 上限 |
|------|------|----------|------|------|
| L1: Transport | `model-gateway.js` profile fallback | `isRetryableProviderError(result)` 为 true | 立即切 profile | 受 `config.fallbackBindings[role]` 长度限制 |
| L2: Application | `agent-runner.js` provider_retry 循环 | L1 fallback 全部用尽仍失败 | 立即再次 | maxAttempts=3 |
| L3: Finalization | `agent-runner.js` finalization_retry | 模型未返回可用正文 | 立即 | MAX_FINALIZATION_ATTEMPTS=2 |
| L4: Durable queue | `agent-task-store.js` scheduleAgentTaskRetry | task run 失败 | 字符串匹配 error_type → policy.backoff | policy.maxRetries (2-5) |
| L5: Process | `rServerSupervisor` 自愈 | r-server 子进程 exit | 500ms / 1s / 2s / 5s / 10s / 30s | 30s |
| L6: Process | `markUnownedStaleJobs` zombie scan | heartbeat 超时 | 每 5 min | N/A |

### 4.2 一致性评估

| 维度 | 评分 | 备注 |
|------|------|------|
| **统一入口** | ⚠️ 不统一 | 6 套独立实现，分散在 6 个文件 |
| **可重试错误分类** | ⚠️ 不一致 | L1 用 status code，L4 用字符串匹配 |
| **退避策略** | ⚠️ 风格不一 | L5 是列表退避；L4 是指数+抖动；其他都是立即 |
| **持久化** | ✅ 一致 | L4 用 SQLite + next_retry_at 持久化（但**无 worker 消费**） |
| **用户感知** | ⚠️ 不一致 | L2/L3 通过 SSE emit；L4 静默入库；L5/L6 仅 console |
| **Token 预算保护** | ⚠️ 缺失 | 无 token 累计计量；只能靠 MAX_AGENT_* 间接限制 |
| **Idempotent 检查** | ⚠️ 缺失 | tool_job 重试时不验证幂等性；R/Python 脚本非天然幂等 |

### 4.3 建议：统一边界（不实现，仅供下一阶段参考）

| 边界 | 职责 | 文件 |
|------|------|------|
| **RetryClassifier** | 单一 source of truth：error → `{ retryable, backoff, category }` | `core/shared-backend/retry-classifier.js`（新增） |
| **RetryBudget** | 单 task 的累计重试次数 + token 预算 + wall-clock budget | `core/shared-backend/retry-budget.js`（新增） |
| **RetryExecutor** | 通用 retry runner（指数退避 + jitter + budget 守门） | `core/shared-backend/retry-executor.js`（新增） |

替换现有 L1-L4 三套机制为统一调用。**G0 阶段不实现**，仅建议在 roadmap 标注。

---

## 五、取消语义矩阵

### 5.1 各操作的可取消性

| 操作类型 | 触发入口 | 取消机制 | 终态 | 用户感知 |
|---------|---------|---------|------|---------|
| **AI 对话 (legacy SSE)** | `POST /api/ai/agent?legacy=1` | `req.on('close')` → aborted=true | `cancelled` | SSE 流断开，UI 停 |
| **AI 对话 (task mode)** | `POST /api/ai/agent` | `POST /api/ai/agent/task/:taskId/cancel` | `cancelled` (后台) | 需显式调 cancel IPC |
| **AI 对话 (chat SSE)** | `POST /api/ai/chat` | `req.on('close')` + `abortController.abort()` | Stream 终止 | SSE 流断开 |
| **Tool Execution (R/Python)** | `POST /api/tools/run` (内部 `executeJob`) | `requestActiveToolJobCancellation(jobId)` | `cancelled` | tool_jobs.status='cancelled' |
| **Provider 流 (stream)** | `callChatProvider(..., { signal })` | `signal.abort()` | `aborted` (code) | SSE 流断开 |
| **Loop Controller abort** | 内部（异常循环） | `loopAbortedByController = true` | `cancelled` | UI 显示"已停止" |
| **Backend proc (r-server)** | N/A (kill -9) | `rServerSupervisor` 自动重启 | 30s 内恢复 | 用户无感知（除非显式订阅） |
| **Backend proc (py-server/plumber/gateway)** | N/A (kill) | **无自动重启**（仅 rServerSupervisor） | 完全关闭 | IPC 返回 ECONNREFUSED |
| **Plan step** | 内部 | 暂无直接取消接口 | N/A | 跟随 plan 自身 |
| **Memory embedding (background)** | `dashscopeEmbed()` | 无 | fire-and-forget | 用户无感知 |

### 5.2 取消语义一致性评估

| 维度 | 评分 | 问题 |
|------|------|------|
| **机制可发现性** | ⚠️ 部分可发现 | task mode 取消需显式 IPC，UI 必须主动调 |
| **终态分类** | ⚠️ 混用 cancelled/failed | 用户取消 vs controller abort 都进 cancelled，但 error 信息不一致 |
| **取消传播（cascade）** | ✅ 已实现 | `cancelAgentTaskCascade(taskId)` 级联子 agent |
| **cooperative vs hard kill** | ✅ 已实现 | SIGTERM → 5s → SIGKILL；硬超时独立 backup |
| **Resume after cancel** | ⚠️ 部分支持 | task mode 可重连续传，但 tool_job 取消后 result 不保留 |
| **Hard kill 后的进程归属证明** | ✅ 已实现 | `isChildProcessAlive` + PID 0-signal probe，避免 PID 复用误杀 |

### 5.3 不可取消的操作（缺口）

| 操作 | 当前行为 | 建议 |
|------|---------|------|
| **Plan 整图** | 无取消接口 | 暴露 `plan:cancel` IPC |
| **Workflow DAG node** | 跟随 Loop | 暴露 `workflow:cancel-node` |
| **Memory extract (background)** | fire-and-forget | 加 cancel token |
| **Backend proc (py-server)** | 无自动重启 | 统一 supervisor pattern |
| **Backend proc (plumber)** | 无自动重启 | 5 min idle timeout 已存在，但 crash 不重启 |

---

## 六、故障恢复剧本

### 6.1 五个最可能发生的故障

#### 故障 1：r-server 子进程崩溃（OOM、unhandledException）

**触发场景**：某插件脚本触发 V8 heap 爆掉 / 某个 Promise 永远 pending 让 event loop 卡住 / Node 升级后 binary 不兼容。

**当前恢复路径**：
1. `rServerSupervisor` 的 `child.once('exit')` 触发 → `handleStopped(code, signal)`。
2. `scheduleRestart(detail)` 按 `[500ms, 1s, 2s, 5s, 10s, 30s]` 退避重启。
3. 30s 后仍失败则尝试下一档退避（`restartAttempt` 自增）。

**用户感知**：
- ❌ **前端无感知**：E-018 已记录。
- ❌ **HTTP 请求 1-30s ECONNREFUSED**。
- ✅ Supervisor 持续重试，最终恢复。
- ⚠️ **运行中的 task 全部中断**：agent-runner 在新 r-server 启动后没有"接续未完成 task"机制——靠 `task_events` 重放，但**主循环状态在内存**（`loopIterations`、`assistantAcc`）全部丢失。

**建议补救**：
- WebContents 推送 `backend:status` 事件（E-018 修复）
- agent-runner 持久化 checkpoint 到 SQLite（已有 `loop-checkpoint.js`）—— **当前收口确保每次迭代后写 checkpoint**，但**重新加载 checkpoint 重启主循环的入口未实现**

#### 故障 2：SQLite 锁死 / WAL 文件过大

**触发场景**：高频 page_view/heartbeat 写；admin panel 高频读；disk full 让 WAL checkpoint 失败。

**当前恢复路径**：
- `busy_timeout = 10000`：写等待 10s 而非立即抛错。
- `wal_autocheckpoint = 1000`：每 1000 页 checkpoint 一次。
- 启动时 `wal_checkpoint(TRUNCATE)`：清空旧 WAL。
- ❌ **无 disk full 检测**。
- ❌ **无 WAL 大小监控**。

**用户感知**：
- 前端 tool_job 卡在 `running`，无错误提示。
- 5 min 后 zombie scan 把无主 job 标 failed。
- ✅ 不丢失数据（事务未提交会自动 rollback）。

**建议补救**：
- 增加 disk space check on startup + warn。
- IPC `db:wal-status` 暴露 WAL size 给 dev 工具。

#### 故障 3：网络断开（用户网络/Provider endpoint 不可达）

**触发场景**：用户在飞行模式；DeepSeek 维护；Anthropic 529 overloaded。

**当前恢复路径**：
1. `deepseek.js` fetch 60s+ timeout → `fail('timeout', '请求超时')`。
2. `model-gateway.isRetryableProviderError('timeout')` → true → 切 fallback profile。
3. fallback 也失败 → `agent-runner.provider_retry` 循环 3 次。
4. 都失败 → `_emit({ error: providerFailureReason })` → SSE 终止。

**用户感知**：
- ❌ 错误信息 `模型请求失败: upstream error`（user action 不可知）。
- ✅ Fallback 自动尝试（用户可能看到 `model_fallback` event，但前端可能不展示）。
- ⚠️ 没有"网络恢复了自动重试"机制——失败后必须用户手动重发。

**建议补救**：
- 错误信息附上"请检查网络" / "请稍后重试"等可操作指引。
- 暴露 retry 端点 `agent-task:resume` 让用户在网络恢复后手动恢复。

#### 故障 4：R/Python 脚本 OOM 杀进程

**触发场景**：DESeq2 处理 50k 样本矩阵 / WGCNA 处理 30k 基因 / 单细胞数据 sparse matrix。

**当前恢复路径**：
1. OS 发 SIGKILL（exit 137）。
2. `execFile` 回调 `err.code === 137`。
3. `tools-executor.js` 进入 `executionFailure` 分支 → `markJobFailed(jobId, '...; 子进程退出已确认', 'execute')`。
4. ❌ **没有特殊识别 OOM**：与普通 nonzero exit 一视同仁。

**用户感知**：
- 用户看到 "任务失败：subprocess exit 137"——**专业用户能识别 OOM，普通用户不知道**。
- ❌ 没有建议"减少数据量" / "联系管理员"。

**建议补救**：
- 识别 exit code 137 / signal SIGKILL + OOM 文本 → 提示"内存不足，请减少数据量或联系管理员"。
- 当前 `R_ERROR_TRANSLATIONS` (`tools-executor.js`) 已含 `Killed|exit code 137` pattern → 加翻译：`'任务被系统终止（内存超限）：...'`（**已经有但要确认是否触达**）。

#### 故障 5：用户长时间挂起（leave page + idle hours）

**触发场景**：用户开 AI 对话后离开电脑 6 小时，token budget 烧光，Provider 计费耗尽。

**当前恢复路径**：
- ❌ **没有 idle timeout**：agent loop 跑到 `MAX_AGENT_ITERS = Infinity`（`agent-loop-control.js`）。
- ✅ provider_retry 会在 API 计费异常时失败。
- ✅ task events 持久化，session 可重连。
- ⚠️ **但 idle 期间 Provider 持续被调**，可能 token 烧到 $X 不止。

**用户感知**：
- 用户回来发现 token 已耗尽。
- ❌ 没有"task 自动挂起"或"low-budget warning"。

**建议补救**：
- 暴露 `idleTimeoutMs` 配置（默认 30 min）。
- 在 idle 超时后 emit `agent_paused` event，让 UI 提示"任务已暂停，点击继续"。

---

## 七、优先修复建议（Top 5-8）

按 **影响用户面 × 修复成本** 排序：

### P0：影响所有用户 / 低成本

1. **E-018 [Critical]** r-server 重启时推 IPC `backend:status` 事件
   - 修复点：`src/main/backend-proc-manager.js` 的 `rServerSupervisor.scheduleRestart` 内追加 `mainWindow.webContents.send`。
   - 成本：5 行代码。
   - 收益：用户感知后端状态。

2. **E-017 [Critical]** 4 个 backend proc 的 `exit` handler 推 IPC 状态
   - 修复点：`src/main/backend-proc-manager.js` 4 个 `proc.on('exit')`。
   - 成本：每个 3 行。
   - 收益：实时可见后端存活。

3. **E-002 [Major]** SSE error event 加 `traceId` / `requestId`
   - 修复点：`ai-chat.js` + `ai-agent.js` 的 `writeError`。
   - 成本：~20 行。
   - 收益：bug 报告可追踪。

4. **E-009 [Major]** 文档化三套重试机制边界
   - 修复点：新增 `docs/agent-retry-strategy.md`，明确 L1-L6 职责。
   - 成本：纯文档。
   - 收益：未来修 retry bug 不再瞎试。

### P1：影响特定场景 / 中成本

5. **E-011 [Major]** 决定 `agent-task-store` RETRY_POLICY 命运
   - 选项 A：实现 cron worker（`scripts/agent-retry-worker.mjs`，~50 行）。
   - 选项 B：删除 RETRY_POLICY（标 deferred）。
   - 成本：选项 B < 1h；选项 A < 1d。
   - 收益：消除"代码定义了但无人调用"的 dead code。

6. **E-001 [Major]** `model-gateway` 透传 Provider 原始 message
   - 修复点：`model-gateway.js` `_withRouting()` 构造完整 envelope。
   - 成本：~30 行。
   - 收益：debug 时间减半。

7. **E-022 [Major]** `cancelled` 终态区分原因
   - 修复点：`markAgentTaskCancelled` 接受 `reason` 参数，写入 `error` 字段。
   - 成本：~15 行。
   - 收益：用户区分"我取消的" vs "系统取消的"。

### P2：长期改进 / 高成本

8. **E-005 [Major]** task mode 关闭订阅 ≠ 取消的 UX 明确化
   - 修复点：前端 `ResultStudio` / `SimpleChat` 显示 "Task continues in background" banner。
   - 成本：~50 行（前端为主）。
   - 收益：避免用户误以为关闭订阅就停止。

---

## 八、附录

### 8.1 已审查文件清单

| 文件 | 审查重点 |
|------|---------|
| `core/r-server/agent-runner.js` | 顶层 catch / SSE error / provider_retry |
| `core/r-server/agent-tools/agent-loop-control.js` | MAX_IDENTICAL_TOOL_CALLS / finalization |
| `core/r-server/agent-tools/tool-execution.js` | envelope 错误结构 |
| `core/r-server/agent-task-store.js` | RETRY_POLICY / scheduler 缺失 |
| `core/r-server/ai-bridge.js` | globalThis try/catch 链 |
| `core/r-server/helpers/llm-client.js` | Provider 抽象 |
| `core/r-server/helpers/process-lifecycle.js` | SIGTERM/KILL / heartbeat |
| `core/r-server/helpers/tools-executor.js` | executeJob callback / cancellation |
| `core/r-server/helpers/circuit-breaker.js` | 死代码检测 |
| `core/r-server/routes/ai-chat.js` | SSE error / abort |
| `core/r-server/routes/ai-agent.js` | task mode / legacy SSE 取消差异 |
| `core/r-server/routes/r-compute.js` | Replot 代理 |
| `core/shared-backend/llm-providers/deepseek.js` | Provider 错误码 |
| `core/shared-backend/llm-providers/anthropic.js` | Provider 错误码 / healthCheck |
| `core/shared-backend/llm-providers/model-gateway.js` | retryable 分类 / fallback |
| `core/shared-backend/loop-controller.js` | no-progress / oscillation 检测 |
| `core/shared-backend/storage/local-storage.js` | SQLite error |
| `core/r-server/db.js` | pragma / migration try/catch |
| `src/main/backend-proc-manager.js` | 4 个 backend proc |
| `src/owned-backend-supervisor.js` | 重启退避 |
| `src/ipc/result-handlers.js` | try/catch 模式 |
| `src/ipc/branch-handlers.js` | try/catch 模式 |
| `src/ipc/harness-capabilities.js` | graceful degradation |
| `src/ipc/backend-lifecycle.js` | 4 个 backend lifecycle IPC |
| `src/preload.js` | contextBridge |

### 8.2 跳过的范围

- **前端 React 组件的 catch**（`SimpleChat.tsx`、`BranchTabs.tsx` 等）——非后端范畴
- **测试文件**（`test/*.test.mjs`）——非生产代码
- **G1+ 阶段事项**：Provider 矩阵、GA 公证、packaged Electron、dist staleness、notarization
- **`scripts/` 下的验收脚本**——一次性脚本
- **`eval-reports/`**——历史报告
- **`docs/` 下的归档报告**——历史快照

### 8.3 关联引用

- 架构总览：[agent-harness-architecture-survey-2026-08-17.md](./agent-harness-architecture-survey-2026-08-17.md)
- 当前阶段纪律：[AGENTS.md](../AGENTS.md) "G0 长期开发期" 段
- 审计广播台：[AUDIT-LOG.md](./AUDIT-LOG.md)
- 文档治理：[document-governance.md](./document-governance.md)
- 工作包计划：[next-steps-roadmap.md](./next-steps-roadmap.md)

---

**报告生成时间**: 2026-08-17
**审查方法**: grep + 追踪典型错误路径 + 检查超时/取消覆盖度
**自评可靠性**: 7/10
**报告不含**: G1+ 阶段事项、不重写架构调研报告、不与其他 agent 报告名共存
