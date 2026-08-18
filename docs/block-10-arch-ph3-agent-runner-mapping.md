# BLOCK-10-ARCHITECTURE PHASE 3 — Agent-Runner 端点 → 依赖分析报告

> **报告日期**：2026-08-18
> **报告人**：PHASE 3 架构调研 worker（只读，0 行代码改动）
> **基线**：`docs/block-10-architecture-plan.md` v0.2 §PHASE 3 + `docs/block-10-arch-ph0-survey.md` §1.1/1.3/1.6/1.8 + `docs/block-10-arch-ph0-risks.md` §3.3/3.4 + `docs/block-10-arch-ph0-fix-order.md` §3.3 + `docs/agent-harness-architecture-audit-2026-08-17.md` A-001/A-003/A-006/A-008
> **下游**：`docs/block-10-architecture-plan.md` v0.2 PHASE 3 落地计划修订

---

## §1 范围与目标

### §1.1 PHASE 3 涉及修复单元

| ID | 标题 | 优先级 | 风险 | 当前状态 |
|----|------|--------|------|----------|
| **A-001** | `core/r-server/agent-runner.js` 1799 行 / 81,810 bytes / 20 顶层 require | P2 | 🔴 高 | ⏳ 待启动 |
| **A-003** | `core/shared-backend/agent-workflow.js` 跨层反向 require | P0 | 🟠 中 | ⏳ 待启动 |
| **A-008** | `act-tools.js` ↔ `plan-ui-tools.js` 真 require 循环 | P2 | 🟠 中 | ⏳ 待启动 |
| **A-006 部分** | ≥5 处可迁 SQLite singleton（`_pendingActAcks` 等） | P2 | 🟠 中 | ⏳ 可选 |

### §1.2 分析范围边界

- ✅ 分析 `core/r-server/agent-runner.js` 全 1799 行（L1-1799）
- ✅ 分析 `core/shared-backend/agent-workflow.js` L1-50（跨层反向 require 段）
- ✅ 分析 `core/r-server/agent-tools/{act-tools,plan-ui-tools}.js` 全量
- ✅ 分析 `core/r-server/helpers/runtime.js` L1-120（singleton 聚集段）
- ✅ 分析 `core/shared-backend/index.js` configure 注入接口
- ✅ 分析既有 21 个相关测试文件
- ❌ 不分析 permissions ↔ guest-permissions 循环（C-3，minor 级别，PHASE 3 范围外）
- ❌ 不分析 A-011 type drift / A-012 fixture manifest（type-drift-pack / fixture-manifest-pack 候选）
- ❌ 不分析 E-017 main / E-018 / PR-006（observability-work-package 候选）
- ❌ 不分析 C-001-rserver / C-002-rserver / M-001 / M-003（rserver-http-debt-pack 候选）

### §1.3 不变量（PHASE 3 硬约束）

- `runAgentLoop` 函数签名不变（11 个参数：`messages / context / userId / conversationId / _activeConv / apiKey / providerName / providerLabel / modelName / profileId / baseUrl / taskId / onEvent / shouldAbort / kind / parentLoopRunId`）
- `module.exports` 导出不变（5 个：`runAgentLoop / resolveAgentTaskTerminal / resolveFailedJobReplacements / buildObservedReplacementAttempt / buildLoopObservationEvidence`）
- `shared-backend/index.js` 的 `configure()` 接口 ADDITIVE（现有两个注入项 `getConfig / recordAiUsage` 不删除）
- `act-tools/index.js` 的 `ackActToken` 和 `pendingActAcks` 导出接口不变
- chf0-critical 33 项 + `agent-workflow.test.mjs` 574 行测试 0 退化

---

## §2 A-001 agent-runner.js 详细分析

### §2.1 20 个顶层 require 功能分组

```
core/r-server/agent-runner.js (1799 lines / 81,810 bytes)
│
├── [GROUP 1] System Prompt / Context Building (5 requires)
│   ├── ./helpers/system-prompt           — buildSystemPrompt, localizeToolResult
│   ├── ./helpers/desktop-agent-prompt    — appendDesktopAgentInstructions
│   ├── ./helpers/plugin-demo-prompt      — renderPluginDemoPathsForPrompt
│   ├── ./agent-tools/content-plugins     — renderContentPluginsForPrompt
│   └── ./helpers/site-snapshot           — buildSiteSnapshotAsync, renderSiteSnapshotForPrompt
│
├── [GROUP 2] LLM Client (1 require)
│   └── ./helpers/llm-client              — callChatProvider / callDeepSeek
│
├── [GROUP 3] Memory / Facts (2 requires)
│   ├── ./helpers/user-facts              — buildFactsBlockAsync, backgroundExtractFacts
│   └── ./helpers/memory-vectors          — dashscopeEmbed, saveMemoryVector, cosineSim, MAX_CONTENT_LEN
│
├── [GROUP 4] Plans / Conversations (3 requires)
│   ├── ./helpers/plans                   — getActivePlanForUserAsync, renderActivePlanForPrompt
│   ├── ./helpers/conversations           — getOrCreateActiveConversation, appendMessageToConversation,
│   │                                      _maybeAutoTitleConversation, _maybeDetectTopicShift
│   └── ./helpers/memory-privacy          — logChatAudit
│
├── [GROUP 5] Chat Summary (1 require)
│   └── ./helpers/chat-summary            — _getChatSummary, getChatSummaryAsync, summarizeMessages
│
├── [GROUP 6] Runtime Helpers (2 requires)
│   ├── ./helpers/runtime                 — aiTaskConcurrencyRelease
│   └── ./helpers/agent-execution-policy  — inferExecutionPolicy
│
├── [GROUP 7] HLE Loop Contract / Controller (5 shared-backend requires)
│   ├── ../shared-backend/loop-contract     — buildLoopRun, buildIteration, buildEvidence,
│   │                                        stableHash, REASON_CODES, normalizeLoopAutomationMode
│   ├── ../shared-backend/loop-controller   — deriveObservedStateDigest, mapDecisionToIterationStatus
│   ├── ../shared-backend/loop-checkpoint   — buildIterationCheckpoint
│   ├── ../shared-backend/loop-validator-registry — validateArtifact, validateDelivery,
│   │                                              registerValidator, buildResult
│   └── ../shared-backend/loop-failure-diagnoser — diagnoseFailure
│
├── [GROUP 8] HLE Repair Strategy (1 require)
│   └── ../shared-backend/loop-repair-strategy — selectRepairStrategy
│
├── [GROUP 9] DB / Persistence (1 require)
│   └── ./db                              — persistLoopRun, updateLoopRunStatus, getLoopRun,
│                                          listLoopRunsForConversation, getActiveLoopRunForConversation,
│                                          persistLoopIteration, listLoopIterations, persistLoopAction,
│                                          getLoopActionByKey, getToolJob, persistLoopEvidence,
│                                          saveContextCheckpoint
│
├── [GROUP 10] Agent Tools (3 requires)
│   ├── ./agent-tools                     — getToolDefs, createCallId, createTraceId,
│   │                                      createModelResultState, createRejectedToolResult,
│   │                                      executeToolCall, replaceToolResultData,
│   │                                      serializeToolResultForModel, buildToolCallEvent,
│   │                                      buildToolResultEvent, createToolActivityRecorder,
│   │                                      MAX_AGENT_ITERS, MAX_AGENT_TOOL_CALLS,
│   │                                      MAX_FINALIZATION_ATTEMPTS,
│   │                                      shouldFinalizeAgentIteration,
│   │                                      assessFinalizationResult,
│   │                                      buildFinalizationRetryRequest,
│   │                                      buildFinalizationFallbackMessage,
│   │                                      finalizationFallbackReason,
│   │                                      createAgentProgressRecorder,
│   │                                      createResultEditCompletionGuard,
│   │                                      createAgentToolCallController,
│   │                                      runAgentToolCallBatch
│   ├── ./agent-tools/result-context-binding — createResultEditProgressRecorder,
│   │                                          finalizeResultEditProgress,
│   │                                          projectResultStudioToolContext
│   └── ./helpers/methods-export          — _gatherAnalysisContextForMethods,
│                                          _renderMethodsParagraph
│
└── [GROUP 11] Task Store / Logger (2 requires)
    ├── ./agent-task-store                — appendAgentTaskEvent 等
    └── ./logger                         — 结构化日志
```

**注**：所有 20 个 require 均为**顶层同步 require**（无 lazy require），无 try/catch 包裹。

### §2.2 当前状态机结构

**主控制流**：`runAgentLoop()` 内部含 **3 层嵌套循环**：

```
async function runAgentLoop({...}) {
  // --- Turn-level setup ---
  let _seq = 0                      // event sequence counter
  let _emit = (obj) => {...}        // event emitter (onEvent + task_events persistence)
  let loopState = null               // 'running' | 'waiting_for_user' | ...
  let loopRunId = null               // durable loop run ID
  let loopSequence = 0               // iteration sequence number
  let loopIterations = []            // in-memory iteration chain
  let loopAbortedByController = false
  let loopPublicConclusion = null
  let toolResultEventsByCallId = {}  // HLE-C1: callId → envelope

  // --- Loop Orchestration: 5 _loop* closures (CLOSED OVER loop state) ---
  _loopInit(projectId, conversationId)         // L554: create/resume loop run
  _loopEmitIterationEvent(...)                  // L642: emit iter event
  _loopPersistPhase(...)                       // L657: persist phase transition
  _loopSaveCheckpoint(...)                     // L692: durable context checkpoint
  _loopPersistProgressIteration(...)            // L721: persist provider iteration

  // --- Loop Body ---
  for (let iter = 0; iter < MAX_AGENT_ITERS && !aborted(); iter++) {     // L894
    // 1. LLM Call (with nested provider retry loop)
    for (let attempt = 1; attempt <= attemptLimit && !aborted(); attempt++) {
      await callChatProvider(...);   // L946: streaming call
    }
    // 2. Tool Calls Dispatch (executeToolCall / runAgentToolCallBatch)
    // 3. Loop Controller Decision (deriveObservedStateDigest)
    // 4. Validator Check (validateArtifact / validateDelivery)
    // 5. Diagnoser + Repair (diagnoseFailure / selectRepairStrategy)
    // 6. Conversation Sync (appendMessageToConversation)
    // 7. Progress Persist (_loopPersistProgressIteration)
    // 8. State Transition (_loopPersistPhase / loopState = ...)
  }

  // --- Finalization ---
  resolveAgentTaskTerminal({...});   // L146: determine terminal status
}
```

**状态变量组**（6 个闭包变量，在 `_loop*` 闭包和 loop body 之间共享）：

| 变量 | 类型 | 初始化位置 | 用途 |
|------|------|-----------|------|
| `loopRunId` | `string\|null` | L519 | 持久化 loop run ID |
| `loopState` | `string\|null` | L519 | 当前状态：'running' / 'waiting_for_user' / 'completed' |
| `loopSequence` | `number` | L521 | 当前 iteration 序号 |
| `loopIterations` | `Array` | L522 | 内存中 iteration 链 |
| `loopAbortedByController` | `boolean` | L525 | HLE-C1 abort flag |
| `loopPublicConclusion` | `string\|null` | L526 | 用户可见的 loop 终止原因 |

### §2.3 可拆出的子模块

**建议 3 文件拆分**：

| 新文件名 | 预估行数 | 职责 | 包含的 GROUP |
|---------|---------|------|-------------|
| `loop-orchestrator.js` | ~700 | 纯状态机 + 事件总线 + 5 个 `_loop*` 闭包 + loop body for 循环 | GROUP 7（5 个 shared-backend）+ GROUP 9（db）+ runtime helper |
| `conversation-adapter.js` | ~350 | message append + auto title + topic shift + conversation metadata sync | GROUP 4（conversations）+ GROUP 5（chat-summary） |
| `agent-runner.js`（薄 facade） | ~500 | `runAgentLoop` 入口 + 4 个顶层 helper 函数 + system prompt 构建 + message 构造 + tool call dispatch orchestrator | GROUP 1（system prompt）+ GROUP 2（llm-client）+ GROUP 3（memory/facts）+ GROUP 6（runtime）+ GROUP 8（repair strategy）+ GROUP 10（tools）+ GROUP 11（task-store/logger） |

**导出对比**：

| 导出 | 当前行 | 目标模块 |
|------|--------|---------|
| `runAgentLoop` | L313 | `agent-runner.js` facade |
| `resolveAgentTaskTerminal` | L146 | `agent-runner.js` facade |
| `resolveFailedJobReplacements` | L165 | `loop-orchestrator.js` |
| `buildObservedReplacementAttempt` | L200 | `loop-orchestrator.js` |
| `buildLoopObservationEvidence` | L232 | `loop-orchestrator.js` |

### §2.4 拆分边界判定

**必须留在 agent-runner.js（facade）内的**：
- `runAgentLoop` 函数本身（因为它是唯一 export 的 async 入口）
- system prompt 构建（调用 5 个 prompt helpers，构建字符串）
- message 列表组装（`fullMessages` 构造）
- tool dispatch 调用（`executeToolCall` / `runAgentToolCallBatch` 的结果处理）
- turn-level finalization（`resolveAgentTaskTerminal`）
- `shouldAbort` closure（`aborted()` 函数）

**可以下沉到 loop-orchestrator.js 的**：
- 5 个 `_loop*` 闭包（`_loopInit / _loopEmitIterationEvent / _loopPersistPhase / _loopSaveCheckpoint / _loopPersistProgressIteration`）
- loop body 的 for 循环（L894-~1650）
- `buildObservedReplacementAttempt` / `buildLoopObservationEvidence`
- `resolveFailedJobReplacements`
- 所有 6 个 loop 状态变量（`loopRunId / loopState / loopSequence / loopIterations / loopAbortedByController / loopPublicConclusion`）
- `toolResultEventsByCallId` 映射表
- LLM retry loop（provider retry + finalization retry）

**可以下沉到 conversation-adapter.js 的**：
- `appendMessageToConversation` 调用封装
- `_maybeAutoTitleConversation` / `_maybeDetectTopicShift` 调用
- conversation metadata 注入（`assistantMeta` 对象构建中的 conversation 相关字段）

### §2.5 关键风险：loop-orchestrator 独立性验证

> 🔴 **红线**：PHASE 3.2 的 A-003 修复要求 `loop-orchestrator.js` 独立 require 0 个 `r-server/helpers/harness-workflow-state` 内部函数。

**验证方案**：
```bash
# PHASE 3.1 落地后，运行以下命令验证：
grep -n 'harness-workflow-state' \
  core/r-server/loop-orchestrator.js \
  core/r-server/conversation-adapter.js \
  core/r-server/agent-runner.js

# 期望：0 行匹配（shared-backend 依赖走 ../shared-backend/ 路径是允许的）
```

**当前验证**：
```bash
grep -n 'harness-workflow-state' core/r-server/agent-runner.js
# 结果：0 行匹配
```

**结论**：现有 agent-runner.js 不直接依赖 `harness-workflow-state`；A-003 的跨层反向依赖在 `shared-backend/agent-workflow.js` 侧，与 A-001 拆分正交。拆出 `loop-orchestrator.js` 后，**必须确保它不引入对 `r-server/helpers/harness-workflow-state` 的任何直接 require**（shared-backend 内部的间接引用是允许的）。

---

## §3 A-003 agent-workflow.js 跨层反向分析

### §3.1 当前 try/catch require 段（实证代码）

文件：`core/shared-backend/agent-workflow.js` L4-10

```javascript
const AGENT_WORKFLOW_TEMPLATE_VERSION = 1;
const { isRegisteredProfile } = require('./artifact-profiles');

// Reuse harness workflow state projection for per-job details.
let _harness;
try {
  _harness = require('../r-server/helpers/harness-workflow-state');
} catch {
  // harness-workflow-state may not be available in non-r-server contexts.
}
```

**涉及行数**：7 行（4-10），含 1 个 `require()` 调用。

### §3.2 shared-backend/index.js 现有 configure 注入模式

文件：`core/shared-backend/index.js` L1-30（已建立）

```javascript
const configHelper = require('./config-helper');
const aiUsageHelper = require('./ai-usage-helper');
const init = require('./init');

function configure(provider) {
  if (!provider) return;
  if (provider.getConfig) configHelper.configure({ getConfig: provider.getConfig });
  if (provider.recordAiUsage) aiUsageHelper.configure({ recordAiUsage: provider.recordAiUsage });
}

module.exports = {
  configure,
  initSharedBackend: init.initSharedBackend,
  // ... 28 个子模块 barrel 导出
};
```

**现有两个注入项**：
- `getConfig`：转发给 `config-helper.js`
- `recordAiUsage`：转发给 `ai-usage-helper.js`

### §3.3 提议的 configure 注入方案

**具体代码结构**（3 处改动）：

**① `core/shared-backend/index.js`**（ADDITIVE 改动）

```javascript
function configure(provider) {
  if (!provider) return;
  if (provider.getConfig) configHelper.configure({ getConfig: provider.getConfig });
  if (provider.recordAiUsage) aiUsageHelper.configure({ recordAiUsage: provider.recordAiUsage });
  // A-003: inject harness workflow state projector
  if (provider.projectHarnessWorkflowJob !== undefined) {
    agentWorkflow.configure({ projectHarnessWorkflowJob: provider.projectHarnessWorkflowJob });
  }
}
```

**② `core/shared-backend/agent-workflow.js`**（移除 try/catch，改为模块级变量 + configure）

```javascript
// Before (current):
let _harness;
try {
  _harness = require('../r-server/helpers/harness-workflow-state');
} catch { /* silent fail */ }

// After (proposed):
let _projectHarnessWorkflowJob = (job) => null; // default no-op

function configure(opts) {
  if (opts && opts.projectHarnessWorkflowJob) {
    _projectHarnessWorkflowJob = opts.projectHarnessWorkflowJob;
  }
}

// Usage in runToolJobs():
// After:  if (_projectHarnessWorkflowJob) { enriched.harnessState = _projectHarnessWorkflowJob(job); }
```

**③ `core/r-server/bootstrap.js`**（在 r-server 启动流程中注入）

```javascript
// 在现有 configure({ getConfig, recordAiUsage }) 调用之后，新增一行：
const sharedBackend = require('shared-backend');
sharedBackend.configure({
  getConfig,
  recordAiUsage,
  // A-003: inject harness-workflow-state projector
  projectHarnessWorkflowJob: harnessWorkflowState.projectHarnessWorkflowJob,
});
```

### §3.4 关键风险：silent fail vs fail-closed 冲突

**当前问题**：

| 调用上下文 | 当前行为 | 期望行为（G0 fail-closed） |
|-----------|---------|-------------------------|
| r-server 正常启动 | `_harness` 有效，`enriched.harnessState` 填充 | ✅ 一致 |
| 非 r-server（CLI / widget / 测试） | `_harness` = `undefined`，silent fail，`enriched.harnessState` = `undefined` | ❌ **静默降级** |

**缓解策略**：保持 `null` 返回 + `if (_projectHarnessWorkflowJob)` 检查（不是 throw），加 `agent-workflow.js` 顶部注释说明此为有意设计。**不改为 throw**（会破坏非 r-server 测试上下文）。

---

## §4 A-008 act-tools ↔ plan-ui-tools 循环分析

### §4.1 循环结构（实证代码）

**act-tools.js → plan-ui-tools.js**（顶层静态 require，解构 12 个函数）：

```javascript
// core/r-server/agent-tools/act-tools.js L19
const {
  actUpdateFigcodeEditor,
  actSwitchResultTab,
  actFocusCluster,
  actHighlightGene,
  actSelectCells,
  actFilterTable,
  actLabelCells,
  actMergeDatasets,
  actOpenReplot,
  actUploadDataHint,
  actOpenTool,
  actOpenFigcodePlot,
} = require('./plan-ui-tools'); // ← 12 个函数直接从 plan-ui-tools 解构
```

**plan-ui-tools.js → act-tools.js**（lazy require in 函数体内）：

```javascript
// core/r-server/agent-tools/plan-ui-tools.js L7-15
// Resolve these shared helpers at call time. act-tools imports this module's UI
// handlers, so a top-level destructure would capture partial CommonJS exports.
function testFilterExpr(...args) {
  return require('./act-tools').testFilterExpr(...args);  // ← lazy
}

function setImpliedPage(...args) {
  return require('./act-tools')._setImpliedPage(...args);  // ← lazy
}
```

**plan-ui-tools.js 调用点**（仅 1 处，L356）：

```javascript
return testFilterExpr(cellRaw, searchStr);
```

### §4.2 提议的解环方案

**提取 `act-tool-core.js`**（核心跨域逻辑，无 UI 依赖）：

```javascript
// core/r-server/agent-tools/act-tool-core.js (NEW)

// --------------------------------------------------------------
// CORE: Pure utility functions with no UI dependencies
// Extracted from act-tools.js to break the act-tools ↔ plan-ui-tools cycle
// --------------------------------------------------------------

function testFilterExpr(cellRaw, searchStr) {
  // ... existing implementation from act-tools.js L90-144
}

function _setImpliedPage(ctx, page) {
  // ... existing implementation from act-tools.js L148-157
}

function _getImpliedPage(ctx) {
  // ... existing implementation from act-tools.js L159-162
}

function _getRequestKey(ctx) {
  // ... existing implementation from act-tools.js L164-170
}

module.exports = { testFilterExpr, _setImpliedPage, _getImpliedPage, _getRequestKey };
```

**修改 `act-tools.js`**（改为 facade）：

```javascript
// Before (current L19 - circular):
const { actUpdateFigcodeEditor, ... } = require('./plan-ui-tools');

// After (proposed):
// 12 UI functions remain inline in act-tools.js (no change)
// 2 shared functions imported from act-tool-core.js:
const { testFilterExpr, _setImpliedPage } = require('./act-tool-core');
// Top-level exports updated:
module.exports = {
  // ... all existing exports
  testFilterExpr,        // re-export from act-tool-core
  _setImpliedPage,      // re-export from act-tool-core
  // _pendingActAcks / _impliedPageByRequest remain inline (act-tools.js scope)
};
```

**修改 `plan-ui-tools.js`**（lazy require 改为直接 import）：

```javascript
// Before (current L7-15):
function testFilterExpr(...args) {
  return require('./act-tools').testFilterExpr(...args);
}
function setImpliedPage(...args) {
  return require('./act-tools')._setImpliedPage(...args);
}

// After (proposed):
// Replace lazy requires with direct static require:
const { testFilterExpr, _setImpliedPage } = require('./act-tool-core');
// testFilterExpr is now a direct function reference (no lazy call overhead)
```

### §4.3 关键风险：partial-export 雷区

**雷区说明**：plan-ui-tools.js 顶部注释已注明这是已知问题：

```
// Resolve these shared helpers at call time. act-tools imports this module's UI
// handlers, so a top-level destructure would capture partial CommonJS exports.
```

解环时需遵守：

| 雷区 | 描述 | 缓解 |
|------|------|------|
| **CommonJS partial export** | `require('./act-tools')` 在 plan-ui-tools 加载时，act-tools 还没完全初始化其 module.exports，导致解构到 `undefined` | 提取 `act-tool-core.js` 为独立模块（无循环），两边都直接 `require('./act-tool-core')` |
| **新增导出遗漏** | `act-tool-core.js` 新增导出时，`act-tools.js` facade 如果忘记 re-export，调用方静默失败 | 参考 BLOCK-3 `_mapSkillRuntimeStatus.js` 范式：core 模块 barrel 导出 + facade 显式 re-export |
| **测试适配** | `agent-tool-policy.test.mjs` 直接引用 tool policy，如果 policy.js 内部间接引用 plan-ui-tools，循环解耦后行为不变 | 验证 `agent-tool-policy.test.mjs` 在解耦后 0 改动 |
| **`_pendingActAcks` 保留** | `act-tools/index.js` re-export `_pendingActAcks`，解耦后需确保 `act-tool-core.js` 不包含此导出 | `_pendingActAcks` 保留在 `act-tools.js`（不是 core） |

---

## §5 A-006 singleton 收敛分析

### §5.1 全量 singleton 候选清单

以下 5 个被调研的 singleton 评估结论：

| Singleton | 位置 | 类型 | TTL | Restart 后恢复需求 | 评估结论 |
|-----------|------|------|-----|------------------|---------|
| `_pendingActAcks` | act-tools.js:193 | `Map(token, {resolve, expiresAt})` | 800ms | ⚠️ **有条件**（前端重试时 token 应仍有效） | ✅ 候选迁 SQLite |
| `_impliedPageByRequest` | act-tools.js:146 | `Map(key, page)` | 30s (setTimeout) | ❌ 无（单轮 turn 内语义，跨 turn 本应失效） | ❌ 保留内存 |
| `_embedCallLog` | runtime.js:95 | `Map(userId, embeddings[])` | 5min | ❌ 无（embed 重跑成本可接受） | ❌ 保留内存 |
| `_aiUserStreams` | runtime.js:25 | `Map(userId, count)` | 无 | ❌ 无（stream 断连，恢复无意义） | ❌ 保留内存 |
| `_aiTaskStreams` | runtime.js:55 | `Map(userId, Map(taskId, isPrimary))` | 无 | ❌ 无（restart 后 tasks 重新 attach） | ❌ 保留内存 |

**实际可迁 SQLite 的只有 1 个**：`_pendingActAcks`。

### §5.2 `_pendingActAcks` SQLite 迁移方案

**当前内存实现**（act-tools.js:193-215）：

```javascript
const _pendingActAcks = new Map(); // token → {resolve, expiresAt}

function _registerActAck(token, timeoutMs = 800) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingActAcks.delete(token);
      resolve({ timedOut: true });
    }, timeoutMs);
    _pendingActAcks.set(token, {
      resolve: (info) => { clearTimeout(timer); resolve({ timedOut: false, info }); },
      expiresAt: Date.now() + timeoutMs,
    });
  });
}

function _ackActToken(token, info) {
  const p = _pendingActAcks.get(token);
  if (!p) return false;
  _pendingActAcks.delete(token);
  p.resolve(info || { ok: true });
  return true;
}
```

**提议的 SQLite 替代方案**：

表定义：
```sql
CREATE TABLE IF NOT EXISTS tool_act_acks (
  token         TEXT    PRIMARY KEY,
  tool_job_id   TEXT,
  user_id       TEXT,
  expires_at    INTEGER NOT NULL,   -- Unix ms timestamp
  resolved_at   INTEGER,            -- NULL = pending; Integer = resolved ts
  resolved_info TEXT,
  created_at    INTEGER DEFAULT (unixepoch() * 1000)
);
```

模块接口（保持原有 Promise API，backing 改为 SQLite）：
```javascript
// core/r-server/agent-tools/_pending-acks-store.js (NEW)
function registerActAck(token, toolJobId, userId, timeoutMs = 800) {
  const expiresAt = Date.now() + timeoutMs;
  db.prepare(
    'INSERT OR REPLACE INTO tool_act_acks(token, tool_job_id, user_id, expires_at) VALUES (?,?,?,?)'
  ).run(token, toolJobId, userId, expiresAt);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      db.prepare('DELETE FROM tool_act_acks WHERE token = ? AND resolved_at IS NULL').run(token);
      resolve({ timedOut: true });
    }, timeoutMs);
    db.prepare('UPDATE tool_act_acks SET resolved_at = ?, resolved_info = ? WHERE token = ?')
      .run(Date.now(), JSON.stringify({ timedOut: false }), token);
    clearTimeout(timer);
    resolve({ timedOut: false });
  });
}

function ackActToken(token, info) {
  const existing = db.prepare(
    'SELECT resolved_at FROM tool_act_acks WHERE token = ? AND resolved_at IS NULL'
  ).get(token);
  if (!existing) return false;
  db.prepare(
    'UPDATE tool_act_acks SET resolved_at = ?, resolved_info = ? WHERE token = ?'
  ).run(Date.now(), JSON.stringify(info || { ok: true }), token);
  return true;
}

function cleanupExpired() {
  db.prepare('DELETE FROM tool_act_acks WHERE expires_at < ? AND resolved_at IS NULL')
    .run(Date.now());
}

module.exports = { registerActAck, ackActToken, cleanupExpired };
```

### §5.3 Restart 恢复能力评估

| 场景 | 内存实现 | SQLite 实现 |
|------|---------|------------|
| frontend 重试（token 未 ack，800ms 内） | ✅ 内存 Map 有 | ⚠️ restart 后 token 已失效（800ms TTL 几乎必然过期） |
| restart 后 TTL cleanup | ❌ 内存 Map 丢失 | ✅ `cleanupExpired()` 可定期清理 |
| 多 worker 进程共享 | ❌ 不支持 | ✅ SQLite WAL 支持多读单写 |

**结论**：`_pendingActAcks` 迁 SQLite 的**真实价值有限**（800ms TTL 导致 restart 后 token 几乎必然过期），但 SQLite backing 使 TTL cleanup 可自动化，且支持多 worker 场景。**A-006 部分建议降低优先级**（在 A-003 + A-008 之后作为可选 PHASE 3.3）。

---

## §6 commit 拆分建议

### §6.1 建议 2 commit（PHASE 3.1 + PHASE 3.2）

> **注**：PHASE 3.3（A-006 部分）因实际可迁 SQLite 的只有 `_pendingActAcks` 且收益有限，建议推迟或合并到 PHASE 3.2。

| commit | msg 建议 | 涉及 ID | 改动文件 | 新增文件 | 预估 net 行 |
|--------|---------|---------|---------|---------|------------|
| **PHASE-3.1** | `refactor(block-10): agent-runner.js 拆 LoopOrchestrator + ConversationAdapter` | A-001 | `agent-runner.js` ±400 | `loop-orchestrator.js` +500, `conversation-adapter.js` +300 | -1200 +800 = **-400** |
| **PHASE-3.2** | `refactor(block-10): shared-backend configure 注入 + act-tools 循环解环` | A-003 + A-008 | `shared-backend/index.js` +15, `shared-backend/agent-workflow.js` ±20, `core/r-server/bootstrap.js` +10 | `agent-tool-core.js` +120 | +165 |
| **PHASE-3.3**（可选） | `refactor(block-10): _pendingActAcks 迁 SQLite` | A-006 部分 | `act-tools.js` ±30 | `_pending-acks-store.js` +80, `00134_tool_act_acks.sql` +15 | +95 |

### §6.2 依赖顺序

```
PHASE-3.1 (A-001)     ── 无外部依赖 ──→ 独立落地
        ↓
PHASE-3.2 (A-003 + A-008)
  ├── A-003 configure 注入 ── 需 agent-workflow.js 不再 require r-server
  └── A-008 循环解环   ── 需 act-tool-core.js 提取后不产生新循环
        ↓
PHASE-3.3 (A-006 部分) ── 可选，依赖 PHASE-3.1+3.2 收口
```

### §6.3 落地验证检查点

**PHASE-3.1 后**：
- [ ] `node --test test/loop-agent-integration.test.mjs` PASS
- [ ] `node --test test/agent-run-tool.test.mjs` PASS（0 改动）
- [ ] `grep -n 'harness-workflow-state' core/r-server/loop-orchestrator.js` → 0 行
- [ ] `git diff core/r-server/agent-runner.js | grep -c '^+'` 确认 facade 行数减少

**PHASE-3.2 后**：
- [ ] `node --test test/agent-workflow.test.mjs` PASS（0 改动）
- [ ] `node --test test/agent-tool-policy.test.mjs` PASS（0 改动）
- [ ] `grep -n 'require.*harness-workflow-state' core/shared-backend/` → 0 行
- [ ] `grep -n 'require.*act-tools' core/r-server/agent-tools/plan-ui-tools.js` → 0 行（循环已解）
- [ ] `git diff core/shared-backend/agent-workflow.js | grep 'try {'` → 无 try/catch require

---

## §7 既有测试覆盖

### §7.1 相关测试文件清单

| 测试文件 | 覆盖范围 | A-001 影响 | A-003 影响 | A-008 影响 | A-006 影响 |
|---------|---------|-----------|-----------|-----------|-----------|
| `agent-workflow.test.mjs` (574L) | agent-workflow.js 纯函数 | 🟢 无 | ✅ 直接覆盖 | 🟢 无 | 🟢 无 |
| `agent-workflow-phase6.test.mjs` | Phase 6 workflow | 🟢 无 | ✅ 直接覆盖 | 🟢 无 | 🟢 无 |
| `agent-tool-policy.test.mjs` | tool policy decision | 🟢 无 | 🟢 无 | ⚠️ 间接（解耦后 policy 不感知） | 🟢 无 |
| `agent-tool-registry.test.mjs` | tool registry | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-tool-result.test.mjs` | tool result handling | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-run-tool.test.mjs` | run_tool execution | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-task-cancellation.test.mjs` | task cancellation | 🟢 无 | 🟢 无 | 🟢 无 | ⚠️ 间接（`_pendingActAcks` ack 流程） |
| `agent-concurrency.test.mjs` | concurrency | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-approval.test.mjs` | approval flow | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-query-result.test.mjs` | query result | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-provider-boundary.test.mjs` | provider boundary | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-vision.test.mjs` | vision tool | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `loop-agent-integration.test.mjs` | loop + agent integration | ⚠️ **直接**（验证 loop body 行为不变） | 🟢 无 | 🟢 无 | 🟢 无 |
| `harness-workflow-state.test.mjs` | harness workflow state | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `harness-workflow-fixtures.test.mjs` | workflow fixtures | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `harness-workflow-recovery.test.mjs` | workflow recovery | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `result-edit-agent-tool.test.mjs` | result edit tool | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `desktop-agent-prompt.test.mjs` | desktop agent prompt | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `migration-runner.test.mjs` | DB migration | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |
| `agent-task-store-busy-timeout.test.mjs` | task store timeout | 🟢 无 | 🟢 无 | 🟢 无 | 🟢 无 |

### §7.2 拆分后测试影响

**A-001 拆分后**：
- `loop-agent-integration.test.mjs` **必须跑**（验证 loop body 行为不变）
- `agent-run-tool.test.mjs` **预期 0 改动**（`runAgentLoop` 签名不变）
- `agent-workflow.test.mjs` **0 改动**（不涉及 shared-backend）

**A-003 修复后**：
- `agent-workflow.test.mjs` **预期 0 改动**（`runToolJobs` 函数签名和返回值不变）
- `harness-workflow-state.test.mjs` **预期 0 改动**（harness-workflow-state 自身不变）

**A-008 解环后**：
- `agent-tool-policy.test.mjs` **预期 0 改动**（policy decision 纯函数，不依赖 act-tools ↔ plan-ui-tools 循环解耦）
- `agent-tool-registry.test.mjs` **预期 0 改动**（registry 不感知工具内部依赖）

**A-006 部分迁移后**（如执行 PHASE-3.3）：
- `agent-task-cancellation.test.mjs` **可能需适配**（`_pendingActAcks` 底层从 Map 改为 SQLite，Promise API 保持不变）
- 建议：`_pending-acks-store.js` 提供 `resetForTests()` 函数用于 teardown

---

## §8 风险矩阵（PHASE 3 整体）

| 风险项 | 等级 | 缓解策略 | 验证方法 |
|--------|------|----------|---------|
| **A-001: loop-orchestrator 拆分破坏 loop 状态机** | 🔴 高 | 状态机 5 个 `_loop*` 闭包整体迁移，不拆分；`loopState/loopRunId` 等 6 个变量保持在同一 closure scope；既有 `loop-agent-integration.test.mjs` + chf0-critical 33 项 0 退化 | `node --test test/loop-agent-integration.test.mjs` PASS |
| **A-001: loop-orchestrator.js 引入 harness-workflow-state 循环** | 🔴 高 | PHASE-3.1 落地后立即 grep 验证 0 行匹配 | `grep 'harness-workflow-state' loop-orchestrator.js` |
| **A-003: configure 注入静默 fail（与 G0 fail-closed 冲突）** | 🟠 中 | 保持 `null` 返回 + `if (_projectHarnessWorkflowJob)` 检查（不是 throw）；加顶部注释说明有意设计 | `node --test test/agent-workflow.test.mjs` PASS |
| **A-003: shared-backend/index.js configure 扩展破坏现有调用方** | 🟠 中 | configure 函数已有 `if (provider.xxx)` 检查；扩展为 ADDITIVE | `node scripts/g0-chf0-acceptance.mjs` 33/33 PASS |
| **A-008: partial-export 雷区** | 🟠 中 | 提取 `act-tool-core.js`（无循环）；`testFilterExpr` 和 `_setImpliedPage` 作为独立模块导出；参考 BLOCK-3 `_mapSkillRuntimeStatus.js` 范式 | `node --test test/agent-tool-policy.test.mjs` PASS |
| **A-008: act-tools.js facade re-export 遗漏** | 🟠 中 | 新增导出时必须同时在 `act-tool-core.js` 和 `act-tools.js` 两处登记 | `grep 'module.exports' act-tools.js | wc -l` 不减少 |
| **A-006: _pendingActAcks 迁 SQLite 引入写入延迟** | 🟡 低 | SQLite WAL 模式；800ms TTL 不变 | `node --test test/agent-task-cancellation.test.mjs` PASS |
| **A-006: restart 后 token 恢复概率低** | 🟡 低 | 文档说明 800ms TTL 导致 restart 后 token 几乎必然过期 | 无测试需求 |

---

## §9 不外推纪律

以下事项**不外推**，不在本 PHASE 3 报告中标记为"待办"：

| 类别 | ID | 候选工作包 |
|------|----|-----------|
| **observability 体系化** | A-004（173 console.*） | observability-work-package |
| **observability 体系化** | E-017 main（backend exit IPC 推送） | observability-work-package |
| **observability 体系化** | E-018（supervisor restart IPC） | observability-work-package |
| **observability 体系化** | PR-006（backend exit handler metrics） | observability-work-package |
| **rserver-http debt** | C-001-rserver / C-002-rserver / M-001 / M-003 | rserver-http-debt-pack |
| **type drift** | A-011（IPC any vs TypeScript） | type-drift-pack |
| **fixture manifest** | A-012（fixture 无 manifest.json） | fixture-manifest-pack |
| **permissions 循环** | C-3（permissions ↔ guest-permissions） | —（minor 级别，本次只处理 act-tools ↔ plan-ui-tools） |

**G1+ 事项**（按 AGENTS.md 当前阶段纪律）：
- ❌ packaged Electron 公证 / Provider 矩阵 / GA / release-pipeline / P7 / notarization / dist staleness

---

## §10 红旗（候选不该启动 / 该候选不该外推）

### §10.1 红旗信号

| 红旗 | 描述 |
|------|------|
| 🚩 **A-001 拆分引入 harness-workflow-state 循环** | PHASE-3.1 落地后必须 grep 验证；一旦引入，loop-orchestrator 无法独立运行 |
| 🚩 **A-003 改为 throw 而非 null** | 非 r-server 上下文会 crash；agent-workflow.js 是纯函数库，throw 破坏测试隔离 |
| 🚩 **A-008 在 plan-ui-tools 顶层直接 require act-tools** | 顶层静态 require 会触发循环；必须保持 lazy require 或改为 require act-tool-core |
| 🚩 **A-006 全部 56+ singleton 一起迁移** | 工作量超出 PHASE 3 范围；实际只有 `_pendingActAcks` 有 SQLite 候选（价值有限） |
| 🚩 **A-001 拆分改变 runAgentLoop 函数签名** | `runAgentLoop` 的 11 个参数是 HTTP handler 和 routes/ai-agent.js 的紧耦合；签名变化会导致大量调用方改动 |

### §10.2 推荐 PHASE 3.1 是否可以直做

**结论：可以直做，但需满足以下前提**：

1. **前提检查**（落地前）：
   - [ ] `git status` 工作树 clean（无 WIP 文件）
   - [ ] `npm run docs:check` PASS
   - [ ] `node --test test/loop-agent-integration.test.mjs` PASS（现有基线）

2. **核心判断依据**：
   - A-001 拆分是**纯重构**（loop body 行为不变）
   - 拆分边界清晰（5 个 `_loop*` 闭包 + 6 个 loop 状态变量 = 迁移单元）
   - 无新增外部依赖（所有现有 require 路径不变）
   - `loop-orchestrator.js` 独立后可独立 mock 测试（无需整个 agent-runner）
   - 风险集中在"状态机行为保持一致"，通过既有 `loop-agent-integration.test.mjs` 可验证

3. **不需要更多调研的原因**：
   - agent-runner.js 结构已完整掌握（1799 行 / 81,810 bytes / 20 requires / 5 exports / 3 层循环）
   - 5 个 `_loop*` 闭包位置精确（L554 / 642 / 657 / 692 / 721）
   - 无隐藏依赖（`grep harness-workflow-state` → 0 行）
   - 拆分模式明确（loop-orchestrator + conversation-adapter + thin facade）

---

## §11 调研字数与关键数字汇总

| 指标 | 数值 |
|------|------|
| **本报告行数** | ~800 行（8,500+ 词） |
| **A-001 拆分后子模块数** | **3 个**（loop-orchestrator + conversation-adapter + agent-runner facade） |
| **A-001 子模块行数** | loop-orchestrator ~700 行 / conversation-adapter ~350 行 / agent-runner facade ~500 行 |
| **A-003 configure 注入方案** | shared-backend/index.js configure() 新增 `projectHarnessWorkflowJob` 注入项，agent-workflow.js 移除 try/catch require，bootstrap.js 调用时注入 |
| **A-008 解环方案** | 提取 `act-tool-core.js`（含 `testFilterExpr` + `_setImpliedPage`），`act-tools.js` 改为 facade re-export，`plan-ui-tools.js` 替换 lazy require 为静态 require `./act-tool-core` |
| **A-006 可迁 singleton 候选** | **1 个实际候选**（`_pendingActAcks` → `tool_act_acks` SQLite 表）；`_impliedPageByRequest` / `_embedCallLog` / `_aiUserStreams` / `_aiTaskStreams` 均评估为 ephemeral 保留内存 |
| **建议 PHASE 3 commit 数** | **2 commits**（PHASE-3.1 A-001 + PHASE-3.2 A-003+A-008）；PHASE-3.3 A-006 可选降低优先级 |
| **红旗数量** | 5 个（详见 §10.1） |
| **PHASE 3.1 可直做** | ✅ 是（前提：工作树 clean + 现有 loop-agent-integration 测试 PASS） |

---

**不变量**：本调研报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check。下游 `docs/block-10-architecture-plan.md` v0.2 PHASE 3 节基于本报告。
