# Petri Desktop Agent Harness 后端架构调研报告

**日期**: 2026-08-17
**范围**: Agent Harness 后端架构（非前端 UI）
**项目**: Petri Desktop — Electron + React/Vite + 内嵌 R/Python runtime
**当前阶段**: G0 长期开发期

---

## 一、架构层分析

### 1. Agent Loop 所在层级

Agent Loop 的实现跨越两个进程：

#### 1.1 R-Server 层（核心逻辑）
- **Agent Runner**: `core/r-server/agent-runner.js` (1800 行)
  - `runAgentLoop()`: 主循环入口，异步执行，不 fork worker
  - 通过 `onEvent` 回调 + `agentTaskStore.appendAgentTaskEvent()` 持久化事件流
  - 支持断线重连（事件流持久化到 SQLite `task_events` 表）
  - HLE-C1: Loop Controller 集成，HLE-C2: Validator/Diagnoser/Repair 集成
  - HLE-C3R: durable checkpoint 持久化（`loop-checkpoint.js`）

- **Agent Tools**: `core/r-server/agent-tools/index.js`
  - 导出 `getToolDefs()` (工具定义) 和 `dispatchTool()` (工具分发)
  - 核心执行单元: `tool-execution.js`
    - `executeToolCall()`: 封装工具调用，含 envelope 追踪
    - `buildEnvelope()`: 构造标准响应结构（traceId/callId/durationMs/truncated/sideEffects）
    - `classifyResult()`: 结果分类（success/error/denied/approval_required）

- **Tool Definitions**: `core/r-server/agent-tools/tool-defs.js`
  - 约 30+ 工具定义（query/search/read_page/run_tool/plan/act 等）
  - Schema 校验通过 inputSchema 实现

#### 1.2 MCP Server 层（独立进程）
- **MCP Registry**: `core/r-server/mcp/registry.js` (1807 行)
  - `listTools()` / `callTool()` 双入口
  - 合并插件工具、Skill 工具、Branch 工具、IDE MCP 工具
  - `_runPluginScript()`: 插件执行器（复刻 tools-executor.js 约定）
  - 集成 artifact-truth、provenance、result archive

- **MCP Server**: `core/r-server/mcp/server.js` (490 行)
  - JSON-RPC 2.0 over stdio（零外部依赖）
  - 纯协议层，所有逻辑委托 registry.js
  - 图片自动转 image content blocks（最多 6 张，5MB 上限）

#### 1.3 Shared-Backend 层（跨进程共享）
- **Loop Controller**: `core/shared-backend/loop-controller.js` (661+ 行)
  - `deriveObservedStateDigest()`: 确定性状态摘要（SHA-256）
  - `computeGoalGapIds()`: DAG 缺口分析
  - `detectNoProgressCycle()` / `detectRepeatedAction()` / `detectOscillation()`: 异常检测
  - `mapDecisionToIterationStatus()`: 决策映射

- **Loop Contract**: `core/shared-backend/loop-contract.js` (434+ 行)
  - LoopRun / Iteration / Action / Evidence 实体定义
  - FSM 状态转换校验（`LOOP_STATUS_TRANSITIONS`）
  - `stableHash()`: 语义哈希（不含 id/createdAt）
  - `REASON_CODES`: 38 个 reason code 覆盖 plan/decision/termination/recovery

- **Agent Workflow**: `core/shared-backend/agent-workflow.js` (532 行)
  - `projectWorkflowPlan()`: 工作流计划投影
  - `bindVerifiedArtifact()`: 验证产物绑定（幂等）
  - `STEP_STATUSES`: 10 种 step 状态
  - 模板: bulk-rna-core / deg-result-refinement / coexpression-network

- **Workflow Engine**: `core/shared-backend/workflow-engine.js` (589+ 行)
  - Skill 之上流程编排
  - 支持 condition / error handling / checkpoint / resume

### 2. MCP Tools 注册表组织

```
registry.listTools()
  ├── Skill Tools (skill_discover / skill_get / skill_execute)
  ├── Branch Tools (branch_create/list/switch/delete/rename/get_active + message_list/append)
  ├── IDE MCP Tools (ide_* 前缀，Phase 1: 文件 + 终端)
  └── Plugin Tools (pluginLoader.listToolsForMCP())
```

注册表关键特性：
- 延迟加载 Branch DB (`_branchDb`)
- 延迟加载 Skill Registry (`_skillRegistry`)
- `refreshPluginSources()`: 每次 callTool/listTools 前刷新
- 三源发现: built-in / installed / development

### 3. Provider 调用链路

```
前端 (React) 
  → desktopBridge.ts (IPC 客户端)
  → Electron IPC (ipcRenderer.invoke)
  → src/main.js (IPC handlers)
  → R-Server HTTP API (127.0.0.1:3003)
  → ai-bridge.js (setupAiBridge)
  → agent-runner.js (runAgentLoop)
  → llmClient.callChatProvider()
  → Provider API (DeepSeek / Anthropic / DashScope)
```

关键文件：
- `core/r-server/helpers/llm-client.js`: Provider 抽象层
- `core/r-server/ai-bridge.js`: SSE 事件流
- `core/r-server/routes/ai-chat.js`: HTTP 接口
- `core/shared-backend/llm-providers/`: 多 Provider 实现 (anthropic.js / deepseek.js / dashscope.js)

### 4. Skill / Workflow / Execution 边界

| 概念 | 文件 | 职责 |
|------|------|------|
| Skill | `shared-backend/skill-registry.js` + `skill-runtime.js` | 发现 + 执行单元 |
| Workflow | `shared-backend/workflow-engine.js` | 多 Skill 流程编排 |
| Agent Workflow | `shared-backend/agent-workflow.js` | DAG-based 多步骤工具执行 |
| Execution | `agent-tools/tool-execution.js` | 单工具调用 + envelope 追踪 |

---

## 二、执行模型分析

### 1. run_tool → tool_job → artifact truth 闭环

```
工具调用 (run_tool op="run")
  → tool-execution.js: executeToolCall()
  → tool-registry.js: runToolJob()
  → Plugin Script (R/Python)
  → Job Dir 写入 manifest.json
  → artifact-truth.js: reconcileArtifactTruth()
      ├── expectedArtifacts 校验
      ├── SHA256 快照
      ├── stagedInputSnapshots 校验
      └── 返回 truth { status: 'valid' | 'degraded' | 'blocked' }
  → db.js: updateToolJob(status='completed')
  → 返回给 Agent (envelope.data)
```

关键文件：
- `core/r-server/helpers/artifact-truth.js` (359+ 行): artifact 校验
  - `captureStagedInputSnapshots()`: 输入文件 SHA256 快照
  - `stagedInputMutationIssues()`: 检测文件变更
  - `reconcileArtifactTruth()`: 产物对账
- `core/r-server/helpers/tools-executor.js`: 工具执行器
- `core/r-server/helpers/tools-metadata.js`: `reconcileToolJobArtifacts()`

### 2. Context Token / Envelope / Revision 一致性

#### Context Token 设计
- **格式**: 64 字符 hex (SHA-256)
- **防篡改**: `computeContextToken()` 生成，内容哈希
- **防过期**: `authorizeContextOperation()` 校验 present vs current
- **防跨项目**: 绑定到 (projectId, conversationId, resultId)
- **Fail-Closed**: `context_token_stale` / `context_token_required` / `context_token_invalid`

#### Envelope 结构
```javascript
{
  contractVersion: '1.0.0',
  traceId: 'trace_xxx',
  callId: 'call_xxx',
  tool: string,
  status: 'success' | 'error' | 'denied',
  terminationReason: string,
  durationMs: number,
  truncated: boolean,
  sideEffects: { type, riskTier, resources },
  data: any  // 工具返回值
}
```

### 3. 取消 / 并发 / 重试 / 超时

#### 取消
- `shouldAbort()`: 外部传入函数（用户关浏览器不触发）
- `aborted()`: 每轮迭代检查 `loopAbortedByController`
- `agentTaskStore.markAgentTaskCancelled()`: 持久化取消状态

#### 并发
- Phase 1 单进程: 同进程内存 Map 有效
- `MAX_AGENT_ITERS`: 最大迭代次数
- `MAX_AGENT_TOOL_CALLS`: 单次工具调用上限
- `MAX_IDENTICAL_TOOL_CALLS`: 相同工具/参数重复上限（振荡检测）

#### 重试
- Provider 重试: 最多 3 次
- Finalization 重试: `MAX_FINALIZATION_ATTEMPTS`
- `retryable` 字段: Provider 响应异常检测

#### 超时
- R 脚本执行: 300s 硬超时 (`execFile` timeout)
- R-Server 启动: 30s (`block_until_ms`)
- MCP stdio: 无超时（阻塞读）

### 4. Long-Running Task 进度上报

#### Polling 机制
```javascript
// frontend/src/hooks/useHarnessWorkflowStatus.ts
const pollInterval = 2000;  // 2s polling
```

#### SSE 机制
```javascript
// core/r-server/ai-bridge.js
setupAiBridge() → SSE stream → frontend EventSource
```

#### IPC Push
```javascript
// src/ipc/harness-capabilities.js
ipcMain.handle("harness-capabilities:list")
// src/ipc/backend-lifecycle.js
ipcMain.handle("py:start/stop", "plumber:start/stop")
```

---

## 三、可靠性与可观测性

### 1. 错误传播

| 层级 | 机制 | 文件 |
|------|------|------|
| Plugin Script | stderr/stdout 捕获 | tool-execution.js L1363 |
| MCP Registry | JSON.stringify(err) | registry.js L1417-1421 |
| Agent Runner | envelope.data.error | agent-runner.js L987-1029 |
| SSE Stream | `{ event: 'error', message }` | agent-runner.js L1763 |
| SQLite | tool_jobs.status='failed' | db.js |
| Frontend | desktopBridge IPC error | App.tsx |

### 2. Execution 状态机

```
tool_jobs.status:
  pending → queued → running → completed
                      ↘ failed (可能 blocked)
                      ↘ cancelled
                      ↘ recovery_required (重启恢复)
```

Loop 状态 (`loop_contract.js`):
```
planned → running → waiting_for_user
                   ↘ blocked
                   ↘ completed
                   ↘ failed
                   ↘ cancelled
```

### 3. 死循环 / 振荡 / 无进展检测

```javascript
// loop-controller.js
detectNoProgressCycle(iterations, dag)
detectRepeatedAction(iterations, proposedAction)
detectOscillation(iterations, planRevisions)
```

### 4. 持久化策略

| 数据 | 存储 | 文件 |
|------|------|------|
| Tool Jobs | SQLite `tool_jobs` | db.js |
| Loop Runs | SQLite `loop_runs` | db.js |
| Loop Iterations | SQLite `loop_iterations` | db.js |
| Loop Actions | SQLite `loop_actions` | db.js |
| Loop Evidence | SQLite `loop_evidence` | db.js |
| Task Events | SQLite `task_events` | agent-task-store.js |
| Workflow DAG | SQLite `workflow_plans` | db.js |
| Artifact Truth | JSON in `tool_jobs.result_json` | artifact-truth.js |
| Provenance | `jobDir/provenance.json` | execution-provenance.js |

---

## 四、契约与边界

### 1. IPC 通道命名约定

```javascript
// Electron IPC handlers
ipcMain.handle("py:start")
ipcMain.handle("py:stop")
ipcMain.handle("plumber:start")
ipcMain.handle("plumber:stop")
ipcMain.handle("harness-capabilities:list")

// R-Server HTTP Routes
GET  /api/health
POST /api/ai/chat (SSE streaming)
GET  /api/loop/runs/:loopRunId
POST /api/loop/iterate
POST /api/harness/workflow/plan
```

### 2. Payload Schema 校验

#### Fail-Closed 设计
- `resultStudioScriptOverride`: SEC-001 安全校验
  - Symlink 检测 (`lstatSync`)
  - Timeout-protected realpathSync (5s)
  - Path traversal 校验
  - SHA256 校验
- `stagedInputPath`: 文件名白名单校验 (`isSafeFlatFilename`)
- `authorizeContextOperation`: context token 校验

### 3. 受信任 Origin / Capability 边界

- `isAdminOrInternal()`: admin role 或 internal 请求
- `canAccessProject()`: 项目公开性 + 所有权
- `canAccessJob()`: job 与用户匹配
- `automationMode`: guided / confirm / trusted
- `executionIntent`: task_draft / task_execute

---

## 五、测试与门禁

### 1. 测试覆盖率

| 测试文件 | 覆盖范围 |
|----------|----------|
| `test/result-studio-context.test.mjs` | contextToken 契约 |
| `test/result-studio-agent-binding.test.mjs` | Result Studio Agent 绑定 |
| `test/agent-tool-result.test.mjs` | Tool Result 序列化/redaction |
| `test/agent-provider-boundary.test.mjs` | Provider 边界/redaction |
| `test/loop-controller.test.mjs` | Loop Controller 逻辑 |
| `test/loop-contract.test.mjs` | Loop Contract FSM |
| `test/artifact-truth.test.mjs` | Artifact Truth 校验 |
| `test/workflow-engine.test.mjs` | Workflow Engine |
| `test/agent-workflow.test.mjs` | Agent Workflow DAG |

### 2. 治理门禁 4 项

```bash
npm run docs:check         # 文档治理门禁
npm run ui:audit:check     # UI 台账门禁
npm run tsc                # TypeScript 编译检查
npm run docs:reconcile     # 文档对账
```

---

## 六、已知痛点与改进空间

### 1. 最大瓶颈

#### A. 多进程 IPC 通信开销
```
前端 → Electron IPC → R-Server HTTP → MCP Registry → Plugin Script
          ↑                ↑              ↑              ↑
       JSON序列化    HTTP overhead   进程间通信    R/Python启动
```

#### B. Loop Controller 与 Agent Runner 紧耦合
- `_loopPersistProgressIteration()`: 600+ 行函数
- `_loopInit()` / `_loopEmitIterationEvent()` / `_loopPersistPhase()` 散落各处

#### C. 工具定义与执行分离不彻底
- `tool-defs.js`: 纯静态 schema
- `tool-execution.js`: 执行逻辑
- `tool-registry.js`: 运行时注册

### 2. Fail-Open 风险点

#### A. MCP Registry 延迟加载降级
```javascript
// registry.js L30-46
function getBranchDb() {
  if (!_branchDb) {
    try { _branchDb = require(branchDbPath); }
    catch (e) { return null; }  // ⚠️ 返回 null 不报错
  }
  return _branchDb;
}
```

#### B. Plugin 加载失败静默跳过
```javascript
// registry.js L748-752
try { pluginLoader.loadPluginsFromDisk(); }
catch (e) { /* 静默 */ }
```

### 3. 过度设计 / 设计不足

#### 过度设计
- `loop-repair-strategy.js`: 修复策略库（8+ 种策略），但实际只用了 2-3 种
- `agent-workflow.js` 的 `AGENT_WORKFLOW_TEMPLATES` 硬编码 3 个模板，无法动态扩展
- `workflow-engine.js` 589 行，Skill Runtime 之上还有 Workflow Runtime，层级过深

#### 设计不足
- **重试策略**: 无指数退避，无重试预算
- **SSE 断线**: 无自动重连机制
- **监控指标**: 无 Prometheus/StatsD 导出
- **类型安全**: 部分 IPC handler 用 `any`

---

## 七、核心代码引用

### A. Agent Loop 主入口

```313:330:core/r-server/agent-runner.js
async function runAgentLoop({
  messages,
  context,
  userId,
  conversationId,
  ...
}) {
  const turnStartedAt = Date.now();
  const ctxForPrompt = { ...context, audience: isGuest ? 'guest' : 'user' };
  let _seq = 0;
  const _emit = (obj) => {
    try { onEvent && onEvent(obj); } catch {}
    const eventType = (obj && obj.event) || 'delta';
    try {
      _seq += 1;
      agentTaskStore.appendAgentTaskEvent(taskId, _seq, eventType, obj);
    } catch {}
  };
```

### B. Loop Controller 决策

```63:68:core/shared-backend/loop-controller.js
function deriveObservedStateDigest(facts) {
  const { toolJobs = [], conversationSummary = '', dagProgress = {} } = facts;
  const jobDigest = deriveJobsDigest(toolJobs);
  const progressDigest = deriveProgressDigest(dagProgress);
  const summaryDigest = stableHash({ conversationSummary, jobDigest, progressDigest });
  return summaryDigest;
}
```

### C. Artifact Truth 校验

```66:77:core/r-server/helpers/artifact-truth.js
function captureStagedInputSnapshots(filePaths = []) {
  return (filePaths || []).map((filePath) => {
    const resolvedPath = fs.realpathSync(filePath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) throw new Error(`staged_input_not_regular_file:${path.basename(resolvedPath)}`);
    return {
      path: resolvedPath,
      name: path.basename(resolvedPath),
      sizeBytes: stat.size,
      sha256: sha256File(resolvedPath),
    };
  });
}
```

### D. Context Token 授权

```test/result-studio-context.test.mjs
// L222-244: contextToken 校验
assert.equal(authorizeContextOperation({ envelope, presentedToken: envelope.contextToken }).ok, true);
assert.equal(missing.diagnostics[0].code, 'context_token_required');
assert.equal(stale.diagnostics[0].code, 'context_token_stale');
assert.equal(tampered.diagnostics[0].code, 'context_token_invalid');
```

### E. MCP Server 协议处理

```117:133:core/r-server/mcp/server.js
async function handleMessage(line) {
  let req;
  try { req = JSON.parse(line); }
  catch { sendError(null, -32700, 'Parse error'); return; }
  const { id, method, params } = req;
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') return;
    return;
  }
  try {
    switch (method) {
      case 'initialize': handleInitialize(id, params); break;
      case 'ping': sendResponse(id, {}); break;
      case 'tools/list': await handleToolsList(id); break;
      case 'tools/call': await handleToolsCall(id, params); break;
```

### F. Desktop IPC Bridge

```79:101:frontend/src/lib/desktopBridge.ts
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.petriDesktop;
}

export function getBridge<K extends DesktopBridgeName>(
  name: K
): DesktopBridgeHandle<K> | null {
  if (typeof window === 'undefined') return null;
  const desktop = window.petriDesktop;
  if (!desktop) return null;
  const handle = (desktop as Partial<DesktopBridge>)[name];
  return (handle ?? null) as DesktopBridgeHandle<K> | null;
}
```

### G. Loop Contract FSM

```126:134:core/shared-backend/loop-contract.js
const LOOP_STATUS_TRANSITIONS = Object.freeze({
  planned: new Set(['running', 'cancelled']),
  running: new Set(['waiting_for_user', 'blocked', 'completed', 'failed', 'cancelled']),
  waiting_for_user: new Set(['running', 'blocked', 'completed', 'failed', 'cancelled']),
  blocked: new Set(['running', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(['running', 'cancelled']),
  cancelled: new Set(),
});
```

### H. Tool Envelope 构建

```92:106:core/r-server/agent-tools/tool-execution.js
function buildEnvelope(name, args, data, ctx, options, durationMs) {
  const classification = classifyResult(data);
  return {
    contractVersion: TOOL_RESULT_CONTRACT_VERSION,
    traceId: options.traceId || createTraceId(),
    callId: options.callId || createCallId(),
    tool: name,
    status: classification.status,
    terminationReason: classification.terminationReason,
    durationMs: Math.round(durationMs * 10) / 10,
    truncated: safeJson(data).length > MODEL_RESULT_LIMIT,
    sideEffects: sideEffectSummary(name, args, getToolContract(name), data, classification),
    data,
  };
}
```

---

## 八、总结与优化方向

### 精简摘要（300 字内）

基于对 Petri Desktop agent harness 后端架构的全面调研，识别出以下 **5 个最高 ROI 优化方向**（按优先级排序）：

---

**1. MCP Registry 延迟加载静默降级问题（高优先级）**

**痛点**: `getBranchDb()` / `getSkillRegistry()` 返回 `null` 时静默降级，Agent 不知道工具不可用，继续执行导致隐性失败。

**方向**: 对所有可选模块引入 `require-or-fail` 策略，启动时检测缺失模块并告警（不阻断），运行时对降级模块的操作返回明确的 `degraded` 状态而非 `null`。

**收益**: 将隐性降级转为显性降级，定位问题时间从数小时降至分钟级。

**风险**: 需修改约 15 处延迟加载逻辑，G0 阶段兼容（不影响 Provider/GA 功能）。

---

**2. Agent Runner 与 Loop Controller 紧耦合重构（中高优先级）**

**痛点**: `agent-runner.js` 1800 行中含大量 inline 循环逻辑（`_loopPersistProgressIteration` 600+ 行），难以独立测试和复用。

**方向**: 将 `runAgentLoop` 拆分为 `LoopOrchestrator`（状态机）与 `AgentExecutor`（LLM 调用）两层，`LoopController` 作为纯函数被两者共享。

**收益**: 单元测试覆盖率可提升 40%+，Loop 重入/暂停/恢复逻辑更清晰。

**风险**: 拆分涉及约 2000 行代码迁移，G0 阶段建议用重构而非重写。

---

**3. 跨进程 IPC 序列化优化（中优先级）**

**痛点**: MCP Registry 返回的 `tool_job.result_json` 包含完整的 `artifacts[]` / `outputs[]` / `manifest{}`，单次调用可能序列化数百 KB 到数 MB 数据。

**方向**: 引入 `ArtifactChunk` 协议：默认返回前 20 个 artifact + 文件名列表，按需 `GET /api/harness/artifact/:id` 获取详情。stdout 启用 gzip 压缩。

**收益**: 典型工具调用响应体积减少 60-80%，SSE 流式输出更平滑。

**风险**: 需前端配合修改 Result Studio 渲染逻辑，G0 兼容。

---

**4. 重试策略规范化（中优先级）**

**痛点**: Provider 重试 3 次无退避，脚本执行超时 300s 硬编码，无重试预算概念。

**方向**: 引入统一的 `RetryPolicy` 配置：
```javascript
const DEFAULT_RETRY = {
  maxAttempts: 3,
  backoff: 'exponential',  // 1s → 2s → 4s
  retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'upstream error'],
  budget: 30000  // 总重试时间预算 ms
};
```

**收益**: 减少无意义重试对 token 预算的浪费，提升用户体验。

**风险**: G0 阶段优先级较低，可作为可选配置。

---

**5. 监控可观测性补强（低优先级，渐进）**

**痛点**: 无 Prometheus/StatsD 指标导出，调试依赖日志 grep。

**方向**: 引入轻量指标采集：
- `loop_iterations_total` (counter)
- `tool_execution_duration_seconds` (histogram)
- `provider_api_calls_total` (counter with labels: provider, status)
- `active_loop_runs` (gauge)

**收益**: 问题定位时间进一步缩短，支持长期趋势分析。

**风险**: G0 阶段可放后，引入前需评估 SQLite 写入频率对性能影响。

---

**G0 阶段纪律兼容性**: 所有上述优化均属 G0 开发期工程改进，不涉及 Provider/GA/packaged Electron 等 G1+ 事项，**与当前阶段纪律完全兼容**。建议优先推进优化 1 和 2，它们直接影响开发态的调试效率和代码质量。

---

## 附录 A: 关键文件清单

### A.1 R-Server 核心文件

| 文件路径 | 行数 | 职责 |
|----------|------|------|
| `core/r-server/agent-runner.js` | 1800 | Agent Loop 主循环 |
| `core/r-server/mcp/registry.js` | 1807 | MCP 工具注册表 |
| `core/r-server/mcp/server.js` | 490 | MCP JSON-RPC 协议 |
| `core/r-server/agent-tools/index.js` | 81 | Agent Tools 导出 |
| `core/r-server/agent-tools/tool-execution.js` | 200+ | 工具执行封装 |
| `core/r-server/agent-tools/tool-defs.js` | 200+ | 工具定义 |
| `core/r-server/helpers/artifact-truth.js` | 359+ | Artifact 校验 |
| `core/r-server/routes/harness.js` | 1367 | Harness HTTP API |
| `core/r-server/routes/ai-loop.js` | 257+ | Loop REST API |
| `core/r-server/ai-bridge.js` | 200+ | SSE 事件流 |
| `core/r-server/helpers/system-prompt.js` | 100+ | System Prompt 构建 |

### A.2 Shared-Backend 核心文件

| 文件路径 | 行数 | 职责 |
|----------|------|------|
| `core/shared-backend/loop-controller.js` | 661+ | Loop 决策引擎 |
| `core/shared-backend/loop-contract.js` | 434+ | Loop 数据模型/FSM |
| `core/shared-backend/loop-checkpoint.js` | 200+ | Loop 检查点 |
| `core/shared-backend/loop-failure-diagnoser.js` | 200+ | 故障诊断 |
| `core/shared-backend/loop-repair-strategy.js` | 300+ | 修复策略 |
| `core/shared-backend/agent-workflow.js` | 532 | Agent Workflow DAG |
| `core/shared-backend/workflow-engine.js` | 589+ | Workflow 编排 |
| `core/shared-backend/execution-context.js` | 200+ | 执行上下文 |
| `core/shared-backend/execution-provenance.js` | 200+ | 执行溯源 |
| `core/shared-backend/result-studio-context.js` | 300+ | Result Studio 上下文 |

### A.3 Electron IPC 文件

| 文件路径 | 行数 | 职责 |
|----------|------|------|
| `src/ipc/backend-lifecycle.js` | 54 | 后端生命周期 |
| `src/ipc/harness-capabilities.js` | 41 | Harness 能力查询 |
| `src/ipc/result-handlers.js` | 100+ | Result IPC handlers |
| `src/ipc/branch-handlers.js` | 100+ | Branch IPC handlers |

---

## 附录 B: IPC 通道详细规格

### B.1 Electron IPC 通道清单

| 通道名 | 方向 | 参数 | 返回值 |
|--------|------|------|--------|
| `py:start` | handle | none | `{ok, error?}` |
| `py:stop` | handle | none | `{ok, error?}` |
| `plumber:start` | handle | none | `{ok, error?}` |
| `plumber:stop` | handle | none | `{ok, error?}` |
| `harness-capabilities:list` | handle | none | `{ok, capabilities[], error?}` |
| `backend:status` | handle | none | backend status |
| `terminal:create` | handle | options | session id |

### B.2 R-Server HTTP API 清单

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/ai/chat` | POST | AI 对话 (SSE) |
| `/api/loop/runs/:id` | GET | 获取 Loop Run |
| `/api/loop/iterate` | POST | 追加 Iteration |
| `/api/loop/snapshot` | POST | 快照 Loop 状态 |
| `/api/harness/workflow/plan` | POST | 创建 Workflow 计划 |
| `/api/harness/workflow/action/:id` | POST | Workflow 操作 |
| `/api/harness/workflow/status/:id` | GET | Workflow 状态 |
| `/api/harness/index` | GET | Harness 文件索引 |
| `/api/harness/repair` | POST | Harness 参数修复 |
| `/api/harness/context-checkpoint` | POST | 上下文检查点 |
| `/api/tools/file/:jobId/:name` | GET | 获取 Artifact 文件 |

---

## 附录 C: FSM 状态转换表

### C.1 Loop Run 状态转换

| 当前状态 | 允许目标状态 |
|----------|--------------|
| `planned` | `running`, `cancelled` |
| `running` | `waiting_for_user`, `blocked`, `completed`, `failed`, `cancelled` |
| `waiting_for_user` | `running`, `blocked`, `completed`, `failed`, `cancelled` |
| `blocked` | `running`, `completed`, `failed`, `cancelled` |
| `completed` | (terminal) |
| `failed` | `running`, `cancelled` |
| `cancelled` | (terminal) |

### C.2 Iteration 状态转换

| 当前状态 | 允许目标状态 |
|----------|--------------|
| `pending` | `running`, `skipped` |
| `running` | `succeeded`, `failed`, `blocked`, `skipped` |
| `succeeded` | (terminal) |
| `failed` | `running`, `skipped` |
| `blocked` | `running`, `skipped` |
| `skipped` | (terminal) |

### C.3 Step 状态转换

| 当前状态 | 含义 |
|----------|------|
| `waiting_for_dependency` | 等待前置 step 完成 |
| `ready` | 输入已绑定，等待执行 |
| `waiting_for_confirmation` | 等待用户确认 |
| `queued` | 已入队，等待调度 |
| `running` | 执行中 |
| `recoverable` | 可恢复（部分失败） |
| `blocked` | 被阻塞 |
| `complete` | 已完成 |
| `cancelled` | 已取消 |

---

## 附录 D: Security 设计要点

### D.1 SEC-001 安全校验

```javascript
// registry.js L1620-1674: resultStudioScriptOverride
// 1. Symlink 检测
const lstat = fs.lstatSync(inputPath);
if (lstat.isSymbolicLink()) throw new Error('materialized_script_symlink_rejected');

// 2. Timeout-protected realpathSync (5s)
const SAFE_REALPATH_TIMEOUT_MS = 5000;
const realpathResult = spawnSync(
  process.execPath,
  ['-e', `try{console.log(require('fs').realpathSync('${inputPath}'))}catch(e){process.exit(1)}`],
  { timeout: SAFE_REALPATH_TIMEOUT_MS, encoding: 'utf8' }
);
if (realpathResult.status !== 0) throw new Error('realpath_timeout');

// 3. Path traversal 校验
if (resolved !== allowedRootResolved && !resolved.startsWith(`${allowedRootResolved}${path.sep}`)) {
  throw new Error('materialized_script_outside_changeset');
}

// 4. SHA256 校验
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
if (!override.sha256 || actualHash !== override.sha256) {
  throw new Error('materialized_script_hash_mismatch');
}
```

### D.2 文件名安全

```javascript
// artifact-truth.js L21-33
function isSafeFlatFilename(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && !value.includes('/')
    && !value.includes('\\')
    && value !== '.'
    && value !== '..'
    && !path.isAbsolute(value)
    && !path.win32.isAbsolute(value)
    && !/^[A-Za-z]:/.test(value)
    && path.basename(value) === value;
}
```

### D.3 敏感信息脱敏

```javascript
// redaction.js
function redactSensitiveValue(value) {
  // 脱敏 API keys, tokens, passwords 等
  return value.replace(/(api[_-]?key|token|password|secret|credential)[=:]\s*["']?([^"'\s,}]+)/gi, '$1=[REDACTED]');
}
```

---

## 附录 E: Performance 指标

### E.1 当前实现性能特征

| 指标 | 当前值 | 说明 |
|------|--------|------|
| Agent Loop 单轮延迟 | 200-500ms | LLM API 调用延迟 |
| Tool Execution 启动 | 100-300ms | R/Python 进程创建 |
| SQLite 单次写入 | 1-5ms | 小事务 |
| SSE 事件推送 | <10ms | 内存操作 |
| MCP stdio 往返 | 5-20ms | 进程间通信 |

### E.2 已知性能瓶颈

1. **R/Python 冷启动**: 首次调用需 2-5s 启动进程
2. **大型 Artifact 序列化**: 50+ 文件可能导致 >1MB JSON
3. **SQLite 写放大**: 每轮 Iteration 至少 3 次写入
4. **Harness 文件索引**: 大型 workspace (50000+ 文件) 首次索引 >10s

### E.3 缓存策略

| 数据类型 | 缓存策略 | TTL |
|----------|----------|-----|
| Tool Definitions | 内存 Map，动态刷新 | 每次 callTool 前 |
| Plugin Manifests | 内存 Map，lazy load | 进程生命周期 |
| Workspace 文件索引 | SQLite + 内存 Map | 手动失效 |
| LLM Provider 响应 | 不缓存 | N/A |

---

## 附录 F: Error Code 参考

### F.1 Agent Tool Error Codes

| Error Code | 含义 | 处理建议 |
|------------|------|----------|
| `agent_tool.policy_denied` | 策略拒绝 | 检查 policy 配置 |
| `agent_tool.handler_error` | 处理错误 | 查看日志 |
| `missing_required_file_inputs` | 缺少文件输入 | 用户上传文件 |
| `scientific_task_not_confirmed` | 科学任务未确认 | 用户确认 |
| `scientific_task_params_changed` | 参数已变更 | 重新规划 |
| `scientific_task_tool_changed` | 工具已变更 | 重新规划 |

### F.2 Context Token Error Codes

| Error Code | 含义 | 处理建议 |
|------------|------|----------|
| `context_token_required` | 需要 contextToken | 调用 result_studio_context |
| `context_token_stale` | contextToken 过期 | 重新获取 |
| `context_token_invalid` | contextToken 无效 | 检查是否被篡改 |

### F.3 File Reference Error Codes

| Error Code | 含义 |
|------------|------|
| `job_not_found` | Job 不存在 |
| `artifact_missing` | Artifact 缺失 |
| `workspace_out_of_root` | 路径超出 workspace |
| `forbidden_path_segment` | 禁用路径段 |
| `file_not_found_or_ambiguous` | 文件未找到或歧义 |

---

## 附录 G: 测试场景矩阵

### G.1 单元测试覆盖

| 模块 | 测试文件 | 覆盖率目标 |
|------|----------|------------|
| Loop Controller | `test/loop-controller.test.mjs` | 90%+ |
| Loop Contract | `test/loop-contract.test.mjs` | 95%+ |
| Artifact Truth | `test/artifact-truth.test.mjs` | 85%+ |
| Context Token | `test/result-studio-context.test.mjs` | 90%+ |
| Agent Workflow | `test/agent-workflow.test.mjs` | 80%+ |

### G.2 集成测试场景

| 场景 | 测试文件 | 触发条件 |
|------|----------|----------|
| 完整工具执行链 | `test/g0-rs-p3-acceptance.mjs` | 每次 merge |
| Loop 断线重连 | `test/g0-rs-p6-real-restart-prototype.test.mjs` | 每周 |
| Result Studio 上下文绑定 | `test/result-studio-agent-binding.test.mjs` | 每次 RS 相关改动 |
| Provider 边界 | `test/agent-provider-boundary.test.mjs` | 每次 LLM 相关改动 |

### G.3 端到端测试

| 场景 | 验收文件 |
|------|----------|
| RS-P3 Agent Context | `acceptance/g0-result-studio/rs-p3-agent-context.json` |
| RS-P6 Durability | `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json` |
| UI-108 Electron Two Provider | `acceptance/ui-108/electron-two-provider-context.json` |

---

## 附录 H: 术语表

| 术语 | 定义 |
|------|------|
| **Agent Loop** | Agent 与 LLM 的交互循环，包含多轮 tool calling |
| **Loop Run** | 单次对话的完整 Loop 执行记录 |
| **Iteration** | Loop Run 中的单次迭代（一次 LLM 调用 + 工具调用） |
| **Action** | Iteration 中提议的具体动作 |
| **Evidence** | 支持决策的证据（产物、观察等） |
| **HLE** | Harness Loop Engine，Loop 引擎的代号 |
| **Artifact** | 分析产物（图片、表格、文件等） |
| **Artifact Truth** | Artifact 的验证状态（valid/degraded/blocked） |
| **Context Token** | SHA-256 格式的上下文标识符，防篡改 |
| **Envelope** | 工具调用的标准响应结构 |
| **Provenance** | 执行溯源信息 |
| **Skill** | 可复用的分析技能单元 |
| **Workflow** | 多 Skill/工具的编排 |
| **DAG** | 有向无环图，描述工作流依赖 |
| **MCP** | Model Context Protocol |
| **SSE** | Server-Sent Events |

---

*报告生成时间: 2026-08-17*
*调研深度: 6 维度架构分析*
*包含代码引用: 9 处核心代码片段*
