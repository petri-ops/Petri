---
capability: q4b-workflow-scripts
goal: 把「确定性多代理编排」做成 Petri 原生的本地脚本面（母纲 F8/Q4b）：本地沙箱执行 `export const meta` 工作流脚本，提供 agent/parallel/pipeline/phase/log/budget 原语，复用既有 spawn_agent 子代理执行链（不建第二执行器），带并发帽/总代理数帽/预算硬停/journal.jsonl/按前缀 resume，默认 opt-in 关闭。
acceptance:
  - 契约测试（红绿先行）：脚本 meta 校验（非法 meta/超预算声明拒绝）；沙箱静态扫描逐类禁词拒绝（require/import/process./Date.now/new Date/Math.random/fetch(/node:fs/node:net/eval）；ESM 子集转译只接受 `export const meta` 与 `export default` 两种导出形态；确定性（同种子同 args 同步骤序列）。
  - runner 契约测试（mock launchSubAgent 注入，零网络）：并发帽/总代理数帽/预算硬停（超限不再启动新步骤、运行中子代理不强杀）/journal 完整（每步骤一行、血缘字段齐）/resume 前缀命中（同 scriptHash+argsHash 已完成步骤复用、mismatch 起重跑、修改一处只重跑后续）。
  - REST 契约测试：opt-in 默认拒绝（`workflow_disabled`）；dryRun 返回成本预估（步骤数/agents 数/预算上限）不执行；cancel 标记后不再启动新步骤且请求子任务取消。
  - 邻域回归：block249 team/spawn、agent-journal、agent-tool-registry（工具计数若变）全绿；types/lint/theme 门禁。
  - 实机腿（P4）：隔离 9223 + mock provider 跑一个小型 2-agent fan-out review 工作流全链（脚本→预估→确认→两 agent→journal→终态汇总）；预算耗尽场景明确失败如实回显。截图不可得按 `unavailable` 如实标注。
  - 收口：closeout 十三门 PASS；母纲 §6.5/roadmap/handoff/（如涉及）UI 台账回写。
reopen: Qoder 全量语法（循环依赖图/条件边/子工作流 import）；workflow DAG 可视化编辑面；schedule 定时触发接线（Q7 已有 runner，后续接）；工具面 run_workflow agent 工具（R2+审批，若 P3 不做）；跨设备同步；worker_threads 进程级隔离升级；G1+。
status: completed
---

# BLOCK-262 · Q4b 工作流脚本（确定性多代理编排执行面）

用户发令：「行 按照建议 推完这一波」（2026-10-25）——按 Jev 单一建议（confidence=0.85 主会话 / 0.08 本轮复核，方向一致）立项 Q4b，推完本波。

本包当前阶段 = **completed**（P0 对账 + P1 沙箱 + P2 runner + P3 REST + P4 实机腿全部交付，证据见 §9）；C 档（画笔、pack iframe 桥）不属本包。母纲依据：`docs/qoder-essence-absorption-plan.md` §6-Q4b（单列大包）+ §6.5 第 7 行。

## 0. 启动前置（2026-10-25 实测）

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 阶段 | G0 长期开发期 | `AGENTS.md` §当前阶段纪律 |
| 分支 | `main`，`c83b6a36`（BLOCK-261）已提交，工作区干净 | `git status` |
| active 工作包 | 无（BLOCK-261 已收口） | handoff / AUDIT-LOG |
| 队列位置 | §6.5 串行队列仅剩 Q4b（本包，🔴 唯一 F8）与 P4-REM（硬约束最后） | 母纲 §6.5 |
| 唯一 active 槽位 | 本包占用；无并行包 | 治理纪律 |

## 1. P0 对账矩阵（复用 / 隔离 / 新建）

| 资产 | 实码性质 | 处置 | 依据 |
| --- | --- | --- | --- |
| `spawn-agent-tools.js:397 launchSubAgent` | 唯一子代理启动器：`createAgentTask`（kind=subagent，挂父会话）→ 并发槽 `aiTaskConcurrencyAcquire` → `setImmediate(runAgentLoop)` → 终态 `notifyChildTerminal` | **复用**（本包核心红线）：`agent()` 原语唯一执行路径；需从模块导出（现为私有函数），签名不变 | 治理红线「不建第二执行器」；审批/guard/toolPolicy/结构化输出全链经 `runAgentLoop` 天然继承 |
| `agentTaskStore` | 任务真相（状态/终态/取消请求/事件） | **复用**：workflow 的每个 agent 步骤=一个 subagent task 行；取消走既有 `requestAgentTaskCancellation` 语义 | 单一任务真相 |
| `helpers/agent-journal.js`（BLOCK-249） | leader 级 journal.jsonl 模式（单行 4KB/1MB 轮转/有界读/best-effort） | **复用形态不共用文件**：新建 `workflow-journal.js` 按同模式落 `<dataDir>/workflows/<runId>/journal.jsonl` | 不同真相域（团队诊断 vs 工作流血缘） |
| `shared-backend/agent-workflow.js` | **数据面**计划模板：steps+tool jobs 纯投影（注释明写 no executors；BLOCK-234 模板已下沉 pack） | **隔离**：编排对象不同（tool jobs vs agents），零触碰 | 防第二编排真相 |
| `helpers/harness-workflow-state.js` | RS 工具任务恢复阶段投影（inspect→report 八阶段） | **隔离**：与本包无关 | — |
| JS 沙箱 | 产品内零既有（grep 仅 node_modules 测试） | **新建**：`node:vm` Context + 源码静态扫描，fail-closed；**零新依赖** | 母纲「先做最小可用，不做 Qoder 全量语法」 |
| SQLite 迁移 | 最新 `019_annotation_entry_owner.sql` | **零迁移**：run 状态落文件目录 `<dataDir>/workflows/<runId>/`（run.json + journal.jsonl + script 快照） | 与 agent-journal 同形态，可审计、低风险 |

## 2. 设计判定

### 2.1 沙箱（P1，`helpers/workflow-sandbox.js`）

- **脚本形态（ESM 子集）**：仅接受两种导出——`export const meta = {…}` 与 `export default async function run(ctx) {…}`；其余 export 语法（named 多导出、export *、re-export）一律 `script_syntax_rejected`。
- **转译**：受限字符串预处理（`export const meta` → `__exports.meta =`；`export default` → `__exports.default =`），不做通用转译器；预处理后过 `new vm.Script` 语法校验。
- **静态扫描 fail-closed**（执行前，源码含任一即拒）：`require(`、`import `、`process.`、`Date.now`、`new Date`、`Math.random`、`fetch(`、`node:fs`、`node:net`、`eval(`、`Function(`、`globalThis`、`WebSocket`。
- **vm context 注入**：原语回调（`agent/parallel/pipeline/phase/log` 由 host 经注入函数桥接）、`now()`（runner 虚拟时钟，单调计数）、`random()`（mulberry32 seeded，种子=args.seed 派生 runId 哈希）、`JSON`、受限 `console`（映射 log 原语）。**不注入** `Date/process/require/fs/net/timers`。
- **meta 校验**（`workflow-script.js` 纯函数）：`name`（≤120 字符）、`version`（整数 ≥1）、`budget.maxAgents`（1..32）/`budget.maxSteps`（1..200）/`budget.timeoutMs`（≤30min）、`concurrency`（1..8，缺省 2）；非法/越界 `meta_invalid` + diagnostics。

### 2.2 原语语义（P2，`helpers/workflow-runner.js`）

- `agent({ prompt, role?, model?, goals?, toolPolicy?, structured? })` → 经 `launchSubAgent` 启动 + 等待终态（复用 wait 语义：轮询 `agentTaskStore` 终态 + `notifyChildTerminal` 唤醒）；返回 `{ ok, status, summary, agentId }`；prompt ≤16KB。
- `parallel(fns[], { concurrency? })` → runner 信号量限并发（帽=min(声明, meta.concurrency)），全部 settle 后返回数组（失败如实带 error 不吞）。
- `pipeline(fns[])` → 顺序传递上一步返回值。
- `phase(name, fn)` → journal 分段标记（name ≤80 字符）。
- `log(...)` → journal 行（拼接 ≤2KB）。
- `budget`（只读对象）→ `{ maxAgents, startedAgents, maxSteps, doneSteps, cancelled }`。
- 确定性：步骤键=原语调用序路径（`phase:p1/agent:3` 等）；同脚本+同 args 产生同键序列；时间/随机只经 `now()/random()`。

### 2.3 帽与硬停（P2）

- **并发帽**：runner 信号量 + 既有 `aiTaskConcurrencyAcquire` 双层（后者满时如实返回 `subagent_concurrency_limit` 并使该步骤 failed，不重试）。
- **总代理数帽**：`startedAgents ≥ budget.maxAgents` 后新 `agent()` 调用直接 `budget_exhausted`（不启动任务）。
- **预算硬停**：`doneSteps ≥ budget.maxSteps` 同上；运行中子代理**不强杀**（等其终态，journal 如实记 `stopped_after`）；取消（cancel API / timeout）= 不再启动新步骤 + 对运行中子任务发既有取消请求。

### 2.4 journal 与 resume（P2）

- journal.jsonl 每行：`{ seq, stepKey, kind, scriptHash, argsHash, status, agentId?, parentStepKey?, summaryHead?, at }`（虚拟时钟 at）。
- `run.json`：`{ runId, script: {source, meta, scriptHash}, argsHash, args, status, resumeFromRunId?, createdAt, finishedAt? }`。
- **resume**：新 run 传 `resumeFromRunId` → 读旧 journal，前缀命中条件=同 `scriptHash`+`argsHash`+`stepKey` 且 status terminal → 直接复用结果（journal 记 `reusedFrom`）；首个 mismatch 起真跑。旧 run 不改写。

### 2.5 opt-in 与入口（P3，`routes/ai-agent/workflow.js`）

- env 门 `PETRI_WORKFLOW_ENABLED`（默认关；未开 → `workflow_disabled`，与 Q2b web-search 默认关先例同构）。
- `POST /api/ai/agent/workflow/run`：`{ script, args?, dryRun?, resumeFromRunId? }`；**dryRun=true 只做解析+meta 校验+返回预估**（步骤展开静态上界=meta.maxSteps/maxAgents 声明 + 脚本内顶层原语调用计数），零执行；真跑返回 runId。
- `GET /api/ai/agent/workflow/runs`（有界列表 ≤50）/ `runs/:id`（状态 + journal 尾部 ≤100 行）/ `POST runs/:id/cancel`。
- 会话/项目鉴权对齐 `routes/ai-agent` 既有模式；父任务身份=以发起用户建一个 kind=workflow 的伞 task 行（复用 agentTaskStore，零新表）。

## 3. 红线与非范围

**红线**：
1. **不建第二执行器**：`agent()` 唯一路径=导出的 `launchSubAgent`；绝不旁路新写 agent 循环。
2. **沙箱 fail-closed**：未知语法/禁词/超限一律拒绝执行，不做白名单外放行。
3. **零新依赖**（vm=Node 内建；DEPENDENCY-CHECKLIST 默认 no 满足）。
4. **默认关**（opt-in env 门；dryRun 先行预估）。
5. **审批链全继承**：子代理内工具审批/toolPolicy/loop_guard 照常；workflow 层不加第二套审批。
6. **零迁移**：文件目录持久化，不新增 SQLite 表。

**非范围**：Qoder 全量语法/DAG 可视化编辑面/schedule 定时接线（Q7 已有 runner 可后续接）/`run_workflow` agent 工具（若 P3 时间不留给 reopen，R2+审批档）/工具 job 编排（`shared-backend/agent-workflow.js` 数据面零触碰）/worker_threads 进程隔离升级/跨设备/G1+。

## 4. 阶段计划（串行）

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P0 对账** | 本文件 §0–§3 + 登记 | docs:check / ui:audit:check 绿 |
| **P1 沙箱内核** | `workflow-script.js`（meta 校验）+ `workflow-sandbox.js`（扫描/转译/vm 执行骨架） | `test/block262-workflow-sandbox.test.mjs` 红绿：meta 合法/非法、逐类禁词、ESM 子集、确定性双跑同序列 |
| **P2 runner** | `workflow-runner.js`（原语/帽/硬停/journal/resume）+ `workflow-journal.js` + 目录持久化 + `launchSubAgent` 导出 | `test/block262-workflow-runner.test.mjs` 红绿（mock launchSubAgent）：并发帽/总帽/预算硬停/journal 完整/resume 前缀命中与 mismatch 重跑；block249 邻域回归 |
| **P3 REST** | `routes/ai-agent/workflow.js` + opt-in 门 + dryRun 预估 + cancel + 伞 task | `test/block262-workflow-routes.test.mjs` 红绿：默认拒/dryRun 零执行/cancel 语义；impact-map 登记 |
| **P4 实机腿 + 收口** | 9223 隔离栈 mock provider 跑 2-agent fan-out review + 预算耗尽场景；closeout 十三门；canonical 回写 | 实机断言 JSON + 截图（或 unavailable 如实）；十三门 PASS |

## 5. 完成语义

- `completed` = P1–P3 契约全绿 + P4 实机腿（或如实 unavailable）+ closeout 十三门 PASS + 母纲 §6.5 第 7 行（Q4b → completed）/roadmap/handoff/AUDIT-LOG 回写 + Q-MATRIX F8 🔴→✅。
- `partial` = P1–P3 绿而 P4 实机腿未跑（如实列明），或原语子集缩窄（逐项写明）。
- reopen 项不阻塞收口。

## 6. 台账回写口径

1. 母纲 §6.5 第 7 行：`Q4b（active · BLOCK-262）`；收口时回写交付明细与 F8 状态。
2. roadmap/handoff：只写「active=BLOCK-262（P0 完成）」级别状态，明细以本文件为唯一源。
3. UI 台账：本包默认无 UI 面（REST/脚本面）；若 P3 补设置开关则登记新 UI 编号。

## 9. 执行记录（2026-10-25）

| 阶段 | 交付 | 证据 |
| --- | --- | --- |
| P0 对账 | 复用=launchSubAgent（导出复用，签名零变化）/agentTaskStore/agent-journal 形态；隔离=agent-workflow.js 数据面/harness-workflow-state；新建=vm 沙箱 | 提交 42a24823 |
| P1 沙箱 | workflow-script.js（meta 校验 fail-closed + 稳定哈希）+ workflow-sandbox.js（13 类禁词扫描 + ESM 子集转译 + realm 摘除真 Date/Math.random + now/random 确定性注入） | test/block262-workflow-sandbox.test.mjs 25/25；提交 bd07b6a7 |
| P2 runner | workflow-runner.js（六原语/并发信号量/双帽/硬停不杀/cancel 语义）+ workflow-journal.js（每步骤一行/轮转/resume 前缀表/journal 写失败 fail-closed）+ ALS slot 确定性 stepKey | test/block262-workflow-runner.test.mjs 12/12（mock deps 全注入零网络）；提交 e33b86b4 |
| P3 REST | routes/ai-agent/workflow.js（opt-in env 默认关 503/dryRun 预估零执行/202 真跑/runs 列表详情/cancel in_process+伞 task 级联兜底+409）+ launchSubAgent 导出 + index 挂载 + extraRunMeta 透传 | test/block262-workflow-routes.test.mjs 7/7；邻域回归 85/85（block249 team/block49 spawn/工具计数/spawn 深度）；impact-map 登记；提交 8ec54064 |
| P4 实机 | 隔离后端 + mock provider + PETRI_WORKFLOW_ENABLED=1 全链：W1 2-agent fan-out（伞 task kind=workflow + params.parentTaskId 血缘 + 真实 runAgentLoop 打 mock ×2 + journal agent 行 completed×2）/ W2 预算硬停（maxAgents=1 第二个 rejected、第一个不强杀）/ W3 cancel（in_process + 级联 + 终态 cancelled + 不再启动第二个）/ R1 dryRun 零执行 / R2 禁词 400 | acceptance/block-262/workflow-live.json 11/11；scripts/block262-workflow-live.mjs |

**实机抓真三处并修复**：① launchSubAgent 未传 model 参数 → accessModeHint 解构崩（修=model:{} 缺省回落）；② 终态枚举写 done 但实测 DB status 列是 completed（done 进 agent_status 列）→ 轮询永不命中（修=TERMINAL 四值全收）；③ 子任务血缘在 params JSON 而非 parent_task_id 列（live 断言改 json_extract）。

**已知边界（如实）**：截图 unavailable（REST 面无 UI）；mock provider 秒回曾使 cancel 窗口不存在（mock 加长任务语义后复验通过）；resume 实机腿未单独跑（Node 12/12 契约覆盖三态）；run_workflow agent 工具未做（reopen）；run_workflow 的 schedule 定时触发接线 reopen。
