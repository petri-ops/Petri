# A6-A2-WAVE2-EVIDENCE — agent-runner.js 聚宝盆拆解（队列 7 · A2 第二波）

- 日期：2026-11-25
- 来源：`docs/harness-invisible-issues-optimization-2026-11-25.md` §3
- 分支：`petri-ops/codex-harness-q7-a2`（独立分支；六分支 A1/B4B5/B1/A5/D1/console-wave1 零交叉）
- 基线：`main` 最新 HEAD `9519f688`（开工前 `git fetch` 核对，本地/远端 main 与发令时一致）
- 提交：本地提交，**未 push**（等主人逐批口令）

## 1. 核真基线（开工前自查）

| 项 | 发令值 | 现读值 | 结论 |
| --- | --- | --- | --- |
| agent-runner.js 行数 | 1153 | 1153 | 一致 |
| `resolveAgentTaskTerminal` | :127 | :127 | 一致 |
| `resolveFailedJobReplacements` | :155 | :155 | 一致 |
| `buildObservedReplacementAttempt` | :197 | :197 | 一致 |
| `buildLoopObservationEvidence` | :234 | :234 | 一致 |
| `_applyProjectTrustCeiling` | :267 | :267 | 一致 |
| `runAgentLoop` | :281（不动） | :281 | 一致 |
| `module.exports` | :1147 | :1147（5 导出） | 一致 |
| 注入点区域 | :321-323 | :321-323 | 一致，零触碰 |

## 2. 逐个函数评估与抽取结论

评估准则：仅抽「无隐式闭包依赖主循环状态、无副作用耦合」的真纯函数；与注入点区域交叠者跳过。

| 函数 | 闭包依赖 | 副作用耦合 | 与注入点交叠 | 结论 |
| --- | --- | --- | --- | --- |
| `resolveAgentTaskTerminal` | 无（纯 opts 入参） | 无 | 无 | **抽出** |
| `resolveFailedJobReplacements` | 无（纯 toolJobs） | 无（Map/Set 为局部返回值） | 无 | **抽出** |
| `buildObservedReplacementAttempt` | 无（纯三入参） | 无 | 无 | **抽出** |
| `buildLoopObservationEvidence` | 仅模块级 `buildEvidence` 导入（非主循环状态） | 无 | 无 | **抽出** |
| `_applyProjectTrustCeiling` | 无（惰性 require，非闭包） | 无（try/catch fail-open 语义逐字保留） | 无 | **抽出**（私有，不进 facade 导出） |
| `runAgentLoop` | 强（整循环状态机） | 强（_emit/落库/调度） | 主循环体内含注入点 | **保留不动**（见 §5） |

### 路径适配（唯一非逐字改动，仅相对路径）

目标模块落 `core/petri-server/helpers/agent-loop-helpers.js`（比 agent-runner.js 下移一层），故两处相对 require 路径适配，指向同一模块、零逻辑变化：

- `buildEvidence`：`../shared-backend/loop-contract` → `../../shared-backend/loop-contract`
- `_applyProjectTrustCeiling`：`./helpers/runtime-policy` → `./runtime-policy`；`./helpers/trust-policy` → `./trust-policy`

副作用边界：agent-runner.js 原 `buildEvidence` 解构 import 随之删除（唯一消费者已迁出）；`loop-contract` 仍由 helper 顶层 require，模块加载链零变化。定值 lint 已复核零新增 error。

## 3. facade 兼容（外部 require 零变化）

- `module.exports` 仍是原 5 项精确集，无增无减：`runAgentLoop` / `resolveAgentTaskTerminal` / `resolveFailedJobReplacements` / `buildObservedReplacementAttempt` / `buildLoopObservationEvidence`。
- 4 个公共纯函数为 helper 实现的**直接重导出**（`facade.fn === helper.fn`，HK-01 引用相等断言在场）。
- `_applyProjectTrustCeiling` 拆前即为私有（未导出），拆后仍私有，仅由 `runAgentLoop` 内部调用，调用点 `accessMode: _applyProjectTrustCeiling(context)` 逐字保留。
- `runAgentLoop` 仍为 async，签名零变化。

## 4. 行为零变化证据（HK-01 红绿先行）

测试：`test/agent-runner-a2-wave2.test.mjs`（本波新增）

- **红（抽前）**：8 tests / 4 pass / 4 fail。4 条行为等价用例因 helper 模块未创建而 `ERR_MODULE_NOT_FOUND` 红；facade 兼容 + 注入点守卫 4 条已在场且绿。
- **绿（抽后）**：10 tests / 10 pass / 0 fail。新增 2 条私有信任天花板守卫。
- **逐函数拆一个验一个**：每抽一个即用 `--test-name-pattern` 跑该函数的 focused 用例验绿，5 轮全绿后才跑全量。

等价断言内容：

- `resolveAgentTaskTerminal`：8 条输入（cancelled/fatalError 对象与字符串、短文本/空文本/纯空白、pendingApproval、空对象）逐字 deepStrictEqual。
- `resolveFailedJobReplacements`：空数组/同工具高迭代修复/异工具未修复/callId 作键/jobTruth.tool_id 5 组，含 `Map` 与 `Set` 形状。
- `buildObservedReplacementAttempt`：空入参返回 null、faultType 透传、jobTruth 优先级、缺 replacementJobId 4 组。
- `buildLoopObservationEvidence`：显式注入 `evidenceId`/`createdAt` 消除时钟差，2 组 deepStrictEqual；断言 wrapper 恒覆盖 `kind='observation'`。
- `_applyProjectTrustCeiling`（私有）：对拆前基线快照 9 组输入逐字等价（`["full","full","read","plan","workspace-write","full","full","full","full"]`）；基线取自 agent-runner.js 原实现逐字快照（require 改绝对路径，逻辑零改）。

## 5. 与注入点 / 主循环的边界声明

- **注入点零改**：自进化 lesson 注入块（`if (!isGuest) { try { const { listActiveLessons } = require('./helpers/lesson-store'); const lessons = listActiveLessons(8); ... } catch { ... } }`）逐字在场，含原始注释。D1 分支 `petri-ops/codex-a3-d1-lesson` 的 `guardLessonInjection` 将来合回时，本波未改动该段任何一行、未改变语义，合并面零冲突。
- **机械证明**：`git show HEAD:core/petri-server/agent-runner.js` 与工作树从 `async function runAgentLoop({` 到文件末逐行 `diff` —— **873 行完全一致，零差异**。即主循环体、注入点、终止判定、落库链全部零改。
- **为何 `runAgentLoop` 不拆**：函数是整条 agent 循环状态机（system prompt 逐段注入、_emit/task_events、toolCtx、resilience 包裹、runLoop 编排、会话持久化、终态落库与对账、子 agent 投递等），变量跨段强闭包耦合且含大量副作用；抽取任一子段都会改变执行时序或作用域，风险远高于本波「纯函数聚宝盆」目标，故不动，留档。
- **行数锚**：`test/loop-orchestrator-subdomains.test.mjs` shrink-only 棘轮锚 `1153 → 1024`（−129），留因（本波纯函数迁出），只减不增继续生效。

## 6. 回归与门禁

| 项 | 结果 |
| --- | --- |
| HK-01（本波 10 项） | 绿 10/10 |
| agent-runner 邻域 8 文件定向回归 | 绿 94/94（facade / facade-compat / loop-orchestrator / conversation-adapter / loop-orchestrator-subdomains / loop-agent-integration / block49-addendum-terminal / 本波 HK-01） |
| `npm run docs:check` | PASS（674 注册文档） |
| `npm run ui:audit:check` | PASS（657 UI 编号） |
| `npm run quality:secret` | PASS |
| `npm run quality:arch` | PASS（R1-R5 无违规） |
| 改动文件 `npx eslint` | 0 error / 0 warning |
| `npm run quality:types` | red — 隔离工作树 frontend `node_modules` 未安装（`vitest`/`@xterm/xterm`/`@testing-library/react` 缺失）；本波零 TS/前端变更，归属环境基线，零触碰 |
| `npm run quality:lint`（全量） | red — HEAD 基线存量（`eslint .` 全仓 54822 error，含 frontend 解析面）；改动文件定向 lint 已绿，零新增违规 |
| `npm run test:changed:list` | exit 2 — HEAD 基线 `closed-batch-evidence-dirs` 规则引用不存在的 `test/c56-user-manuscript-fidelity.test.mjs`（`git show HEAD:test/impact-map.json` 已验证存在该引用）；非本波引入，改用显式定向回归集 |

## 7. 零新依赖 / 隔离纪律

- `package.json` / `package-lock.json` 零改动；helper 仅 require 仓内既有模块（`../../shared-backend/loop-contract`、`./runtime-policy`、`./trust-policy`）。
- 不碰 owner dev 实例（隔离栈）；主线工作树未跟踪 WIP 零触碰；六分支零交叉；另起独立分支 `petri-ops/codex-harness-q7-a2`。
- 提交留本地，未 push。

## 8. 决策建议器调用记录（如实）

| 工具 | 结果 |
| --- | --- |
| `test:suggest --supply=cloud` | exit 3：cloud 供给不可用（读不到 `.petri-dev-user-data/jev.env.bak-by-user-request`）→ 零建议 |
| `doc:suggest --supply=cloud --context ...` | exit 3：同上 → 零建议 |
| `next:suggest --context ... --candidates ...` | 「建议=无（队列7 A2 完结，后续待 owner 发令）」+ `jev_unavailable:no_key:cloud_unavailable` |
| `output:judge` | 需显式 `--request/--output` 参数；本 worker 交付无面向用户的散文输出件，不适用（参数错误 exit 2） |
| `decision:session` / `decision:report` | 隔离树无决策台账 DB（未设 PETRI_DB_PATH）→ jev 次数不可机读；本波可用建议数为 0（cloud 供给不可用） |

G0 开发期常态 · 不外推 packaged/Provider/GA。
