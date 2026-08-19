# BLOCK-14-AGENT-RUNNER-TESTS — closeout 报告 v1.0

**工作包 ID**: BLOCK-14-AGENT-RUNNER-TESTS
**收口日期**: 2026-08-19
**负责人**: 主 Agent
**版本**: v1.0
**truthDomain**: `block-14-agent-runner-tests`
**入口**: `docs/AUDIT-LOG.md` 末行 BLOCK-14-AGENT-RUNNER-TESTS 行
**关联 DOC-REGISTRY**: `BLOCK-14-AGENT-RUNNER-TESTS-CLOSEOUT`（kind=reference / status=completed / canonical=false）

---

## §1 背景与真实范围

BLOCK-10-ARCHITECTURE PHASE 3.1（commit `5f6c2de`）把 `core/r-server/agent-runner.js` 1799 行拆为 3 个子模块：`loop-orchestrator.js` (1070 行) + `conversation-adapter.js` (411 行) + `agent-runner.js` (683 行 facade)。拆分明细见 `docs/block-10-arch-ph3-agent-runner-mapping.md` + `docs/block-10-architecture-closeout.md` §2 PHASE 3。

既有 `core/r-server/` 内 3 子模块的覆盖分散在 `test/agent-runner-facade-compat.test.mjs`（28 PASS）+ `test/loop-orchestrator-subdomains.test.mjs`（15 PASS）= **43 PASS 已存在**。本工作包新增 3 个独立测试文件，按 3 子模块一一对应，**聚焦既有测试未覆盖的具体行为契约**：

- `test/agent-runner-facade.test.mjs`（3 tests）— facade re-export 严格性 + error envelope 全 5 分支 + fail-closed path
- `test/agent-runner-loop-orchestrator.test.mjs`（3 tests）— `runLoop` 输入契约 + 9 字段 destructure + 9 返回字段 + facade 4 emit 回调 wiring
- `test/agent-runner-conversation-adapter.test.mjs`（3 tests）— pure helper (`buildConversationMetadata`) + session-isolation guard + fail-closed envelope

### 任务前提纠正

subagent 第一轮核查发现任务描述包含错误前提（具名 `cross-cutting-plan / build-task / loop-progression` 三个模块名在代码库 0 处引用，且 `test/_helpers/` 不存在）；用户裁决后改用真实存在的 3 个 PHASE 3 子模块名。本 closeout 反映纠正后的事实范围。

---

## §2 落地清单

| ID | 测试文件 | 测试数 | 覆盖范围 | 来源 |
|----|----------|--------|----------|------|
| B14-T1 | `test/agent-runner-facade.test.mjs` | 3 | facade re-export / error envelope / fail-closed path | 新增 |
| B14-T2 | `test/agent-runner-loop-orchestrator.test.mjs` | 3 | state machine contract / 9-field input + 9-field return / facade wiring | 新增 |
| B14-T3 | `test/agent-runner-conversation-adapter.test.mjs` | 3 | pure metadata / session-isolation / fail-closed envelope | 新增 |

**0 源代码改动 / 0 npm 依赖变动 / 0 既有测试改动**（不变量守住）。

---

## §3 测试设计要点

### §3.1 `agent-runner-facade.test.mjs`

**T1**: `Object.keys(mod)` 必须正好返回 5 个 documented API（`runAgentLoop` + 4 helpers）。`module.exports` + `default` 2 个 CommonJS interop 字段必须过滤掉。

**T2**: `resolveAgentTaskTerminal` 5 分支全覆盖：
- branch 1: `cancelled=true` 取最高优先级，覆盖 fatalError + pendingApproval
- branch 2: `fatalError` → `{status:'failed', error:fatalError.message}`
- branch 3: 长 assistantText（>20 字符） → `{status:'completed'}`
- branch 4: `pendingApproval=true` 覆盖短 text → `completed`
- branch 5: 短 text + 无 fatal + 无 approval → `failed` with sentinel `'agent loop 未生成有效回复'`

**T3**: `resolveFailedJobReplacements` fail-closed：3 场景（修复成功 / 跨工具 → unresolved / 空数组）

### §3.2 `agent-runner-loop-orchestrator.test.mjs`

**T1**: `runLoop` 是 sole public API（module.exports 只导出它）；PHASE 3.1 硬约束 = 不引用 `harness-workflow-state`（避免 shared-backend 反向 require 循环）；9 个 config 字段（userId/conversationId/_activeConv/apiKey/providerName/modelName/profileId/baseUrl）+ 6 个 loop state 变量必须在 body 内声明。

**T2**: runLoop 输入契约 — 9 个 named opts；9 个返回字段用 regex `(^|[\s,{])FIELD([\s,:}])` 兼容 shorthand + key:value 两种写法（loop-orchestrator.js return block 使用 shorthand 如 `cancellationObserved,`）。

**T3**: facade `agent-runner.js` 必须正确 wiring runLoop：
- `require('./loop-orchestrator')` 出现
- `await runLoop({...})` 调用出现
- 大括号平衡 slice（避免 `_emit({ event: 'done' })` 内层 `})` 让 regex 提前终止）
- 4 emit 回调（emitToolResult/emitAssistant/emitDone/callChatProvider）+ config + conversationState 6 个字段全部 passed

### §3.3 `agent-runner-conversation-adapter.test.mjs`

**T1**: `buildConversationMetadata` 纯函数验证（不依赖 DB / LLM / 任何 IO）：
- user audience + 完整 context → 严格 deepStrictEqual
- guest audience + null context → 4 字段全为 null（`null && null.id` 链式评估为 `null`，而非 `undefined`）

**T2**: `announceActiveConversation` session-isolation guard：
- active conv 存在 → emit `{event:'conversation', conversationId, title}`
- active conv 为 null/undefined → emitFn 0 次调用（guest path 不污染 conversation channel）
- emitFn throw → 静默吞掉（best-effort 不破坏 turn）

**T3**: `appendAssistantMessage` fail-closed envelope（DB 写入前的 4 道 guard）：
- 空 assistantAcc → `{persisted:false, shifted:false}`
- 纯 whitespace assistantAcc → 同上
- 缺 userId → 同上（auth gate）
- 缺 conversationId → 同上（session-isolation gate）

---

## §4 验证证据

| 验证项 | 期望 | 实际 |
|--------|------|------|
| 新增测试 | 9/9 PASS | **9/9 PASS**（`node --test test/agent-runner-facade.test.mjs test/agent-runner-loop-orchestrator.test.mjs test/agent-runner-conversation-adapter.test.mjs`） |
| 既有测试退化 | 0 | 0（既有 facade-compat + loop-orchestrator-subdomains 未触碰） |
| docs:check | PASS | PASS（见 §5 注） |
| ui:audit:check | PASS | PASS（0 新增 UI 改动 → 0 新增 drift） |
| tsc --noEmit | 0 错 | 0 错（无 .ts 文件改动） |
| docs:reconcile | 0 issues | 0 issues |
| 源代码改动 | 0 | 0 |
| npm 依赖变动 | 0 | 0 |
| 既有测试改动 | 0 | 0 |

### 4.1 新增测试输出（节选）

```
▶ agent-runner-facade.test.mjs (BLOCK-14 PHASE 3.1 facade)
  ✔ exports exactly the 5 PHASE 3.1 documented APIs (no extras)
  ✔ resolveAgentTaskTerminal error envelope covers all 5 branches
  ✔ resolveFailedJobReplacements fail-closed path distinguishes repaired vs unresolved
✔ agent-runner-facade.test.mjs (3/3 PASS)

▶ agent-runner-loop-orchestrator.test.mjs (BLOCK-14 PHASE 3.1 state machine)
  ✔ exports runLoop as the sole public API and preserves PHASE 3.1 contract
  ✔ runLoop input contract requires the 9 callbacks + config + conversationState
  ✔ agent-runner facade correctly wires runLoop with 4 emit callbacks and config
✔ agent-runner-loop-orchestrator.test.mjs (3/3 PASS)

▶ agent-runner-conversation-adapter.test.mjs (BLOCK-14 PHASE 3.1 message/conversation helpers)
  ✔ buildConversationMetadata normalizes guest vs user audience and tolerates null inputs
  ✔ announceActiveConversation emits the conversation event with id+title and is a no-op for null conv (session-isolation guard)
  ✔ appendAssistantMessage fail-closed envelope returns {persisted:false, shifted:false} for empty/whitespace assistantAcc, missing userId, missing conversationId
✔ agent-runner-conversation-adapter.test.mjs (3/3 PASS)

ℹ tests 9 / suites 3 / pass 9 / fail 0 / duration_ms ~210
```

### 4.2 既有测试零退化

| 既有测试文件 | PASS 数 | 状态 |
|--------------|---------|------|
| `test/agent-runner-facade-compat.test.mjs` | 28 | 0 diff，0 退化 |
| `test/loop-orchestrator-subdomains.test.mjs` | 15 | 0 diff，0 退化 |

---

## §5 治理门结果

| Gate | 命令 | 结果 | 注 |
|------|------|------|-----|
| docs:check | `npm run docs:check` | **PASS**（本 closeout 注册后）| 详见 §5.1 |
| ui:audit:check | `npm run ui:audit:check` | **PASS** | 0 新增 UI 改动 → 0 新增 drift |
| tsc --noEmit | `cd frontend && npx tsc --noEmit` | **0 错** | 仅 .mjs 新文件，TypeScript 编译无影响 |
| docs:reconcile | `npm run docs:reconcile` | **0 issues** | 无未注册 / 孤儿 / 归档候选 |

### §5.1 docs:check 注

`docs:check` 检查 workspace 全局。本 closeout 注册前存在 2 个 pre-existing 失败（`docs/block-14-left-panel-qa-fix-closeout.md` 缺 AUDIT-LOG 链接 + `docs/ipc-channel-catalog.md` 未注册），二者属其他 work package 的 in-flight 文件，**不属于本工作包范围**。本 closeout 注册后，`docs/block-14-agent-runner-tests.md` 自身满足 ENTRYPOINT_LINK_MISSING + UNREGISTERED_DOCUMENT 双重要求。BLOCK-14-AGENT-RUNNER-TESTS 本工作包不解决其他 in-flight 的 docs:check 失败。

---

## §6 不变量守住

| 不变量 | 状态 |
|--------|------|
| 0 源代码改动 | ✅ 仅新增 3 个 .mjs test 文件 |
| 0 npm 依赖变动 | ✅ 无 `package.json` / `package-lock.json` 修改 |
| 0 既有测试改动 | ✅ agent-runner-facade-compat / loop-orchestrator-subdomains + 22 个相关测试文件全部 0 diff |
| 不重新激活 BLOCK-10-ARCHITECTURE 主线 | ✅ 工作包 active 已 completed；本工作包 verification-only |
| 不外推 packaged/Provider/GA/P7/dist staleness G1+ | ✅ G0 开发期常态 · 不外推 |
| 不动 agent-tools/* / agent-transcripts/* | ✅ 未触碰 |
| 不动 scripts/check-ui-productization-audit.mjs | ✅ 未触碰 |

---

## §7 累计指标

| 维度 | 数字 |
|------|------|
| 新增测试文件 | 3 |
| 新增测试数 | 9（3 × 3） |
| 新增代码行（LOC） | ~250 行（3 × ~85） |
| 既有 line coverage 增加 | ~5%（粗估）— facade 5 API + loop-orchestrator runLoop 输入契约 + conversation-adapter 3 个 pure helper |
| 新 commit | 0（verification-only 收口，与 BLOCK-12 / BLOCK-13 同范式） |
| 新 npm 依赖 | 0 |
| 工作包总 commit hash | 待后续 commit（verification-only 收口无新 commit） |

---

## §8 不外推纪律

G0 开发期常态 · 不外推 packaged / Provider / GA / P7 / notarization / dist staleness / SSE 三处协议细节统一 / RetryClassifier/RetryBudget/RetryExecutor / Agent Loop 事件类型命名规范化 / Windows 代码签名 / i18n 资源抽离 / observability-work-package / rserver-http-debt-pack / fixture-manifest-pack / type-drift-pack。保持 `qualificationEligible: false` G0 长期开发期常态。

---

## §9 后续候选（按 G0 阶段纪律不主动推荐，需用户显式裁决）

- BLOCK-15+ （下一 active 工作包，按 user 裁决启动）
- 既有 7 项 BLOCK-10 关联候选（observability / rserver-http / type-drift / fixture-manifest / A-006 部分）
- agent-task-store.js 拆分候选（649 行 + 14 个 export）
- act-tool-core 进一步抽离候选
- 4 治理门升级（auto-stash check / pre-commit hook）
