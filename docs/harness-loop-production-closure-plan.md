# Harness Loop Engineering v1 — 生产接线收口计划

最后更新：2026-07-24

状态：`in_progress`（HLE-C1～C3 完成；HLE-C4 功能接线完成、视觉验收进行中；HLE-C5 Step 7 待真实产品验收）

主模块：`P-03 Harness 与 Agent 工作流`

影响模块：`P-01`、`P-02`、`P-04`、`P-07`、`W-03`、`W-04`

关注点：`C-03`、`C-04`、`C-05`、`C-06`

## 1. 决策结论

本计划不是 HLE-7，也不是新的并行系统。它只负责完成 HLE-2～HLE-6 已承诺但尚未进入生产链的接线与验收。

当前已经存在：

- LoopRun、Iteration、Action、Evidence、Decision、Snapshot 契约与 SQLite ledger。
- 目标差距、no-progress、重复动作、振荡和退出判定。
- Validator Registry 与通用 Artifact/Delivery 验证器。
- 故障分类、Repair Strategy 和受影响子图计算。
- Checkpoint、ContextEnvelope、预算投影和 SessionStageView 纯函数。
- HLE-0 脱敏 fixture 与 HLE-0～HLE-5 离线测试。

当前尚未完成：

1. 生产 `ai-agent.js` 没有调用 Loop Controller。
2. 工具执行结果没有自动形成 Loop Iteration/Evidence/Decision。
3. Validator/Repair 没有控制真实 Job/Artifact 推进。
4. 前端没有读取或展示 LoopRun、Validator、Repair 和 Checkpoint。
5. `harness:loop` 只聚合离线测试，不等于真实 Provider、重启恢复或视觉验收。
6. 正式计划、提交标题和实际证据之间存在状态漂移。
7. 真实历史会话出现过“Job 为 failed，但因目录存在部分文件而宣称整个分析完成”的错误行为。

固定不变量：

> `run_tool → tool_job → artifact truth`

Loop 只能消费、验证和编排这条真相链。任何 failed/cancelled/running/unknown Job 都不得因为存在文件而升级为成功。

## 2. 当前真实状态

| 原工作包 | 当前可信结论 | 不得宣称 |
|---|---|---|
| HLE-0 | fixture、三类基础轨迹与离线评测已建立 | 已覆盖全部真实故障和 Provider |
| HLE-1 | Contract、SQLite repository 和基础 API 已实现 | 已完成生产会话持久化 |
| HLE-2 | Controller 纯函数和集成夹具通过 | 已接入 task/legacy Agent loop |
| HLE-3 | Validator Registry 和验证器通过离线测试 | 已阻断真实会话中的假成功 |
| HLE-4 | Diagnoser/Repair Strategy 通过离线测试 | Agent 已能在真实 Job 中自动修复 |
| HLE-5 | Checkpoint/Context/UI projection 纯函数已实现 | 已完成前端和重启恢复矩阵 |
| HLE-6 | 离线聚合命令通过 | 已完成双 Provider 和产品验收 |

HLE-C0～HLE-C5 完成前，HLE 主计划总状态保持 `in_progress`。

## 3. 唯一生产控制流

```text
用户消息
  → 判定 conversation / task_draft / task_execute / replay
  → 仅科学任务创建或恢复 LoopRun
  → 从 TaskSpec + Plan + Job/Artifact Truth 观察状态
  → Loop Controller 生成结构化 Decision
  → schema / policy / actionKey / active Job 前置检查
  → 调用既有 executeToolCall()
  → run_tool 创建真实 tool_job
  → 读取 ToolResult + Job + Artifact Truth
  → Validator Registry 生成 Evidence
  → Diagnoser / Repair Strategy 决定继续、修复、重规划或阻断
  → 原子持久化 Iteration / Action / Evidence / Decision / Checkpoint
  → SSE 投影公开阶段结论
  → Task/DAG/Delivery/Replay 验收后完成
```

普通问答、概念解释和一般文件讨论不得误创建 LoopRun。

## 4. 生产契约

### 4.1 创建与恢复

- `task_draft` 可以创建 `planned` LoopRun，但不能创建 Job。
- `task_execute` 只有在 TaskSpec、Plan、输入快照、权限和科学确认满足后转为 `running`。
- 同一 `projectId + conversationId + taskSpecHash` 同时最多一个 active LoopRun。
- 页面刷新、SSE 重连和应用重启恢复同一个 LoopRun，不重新生成 ID。
- 模型切换只改变决策提供者，不改变 TaskSpec、Plan、Truth 或验收标准。
- 普通会话无 task ref 时返回 `null`，不生成伪造 Loop。

### 4.2 Iteration 事务

每次 Iteration 至少记录：

- observed state digest 和 goal gaps。
- TaskSpec、Plan、Job、Artifact、validator evidence 引用。
- proposed action、稳定 actionKey 和前置检查。
- ToolResult/Job/Artifact 的真实执行后状态。
- decision、公开阶段结论、progress delta 和 checkpoint。

副作用前先保存 intent/actionKey；执行后写结果与验证证据。恢复时先按 actionKey/Job reconcile，不能重复运行。

### 4.3 完成与部分产物

以下情况不得标记完成：

- Job 为 `failed`、`cancelled`、`running`、`queued` 或 unknown。
- 只有部分文件，必需 Artifact/manifest/validator 未通过。
- 输出来自旧 Job、旧输入 hash 或旧插件版本。
- 模型只在文本中声称成功。
- Delivery/Replay 仍有必需目标未覆盖。

failed Job 存在部分文件时必须：

1. 保持 Job failed。
2. Artifact Truth 按现有规则保持 blocked/degraded，不得 valid。
3. Validator 记录部分产物及缺失项。
4. Diagnoser 决定可否创建新 Job 修复。
5. UI 显示“部分产物已保留，任务未完成”。

### 4.4 修复边界

- 参数、环境和输入格式修复创建新 Job 或受控转换步骤。
- 新 Job 记录 parentJobId、repairStrategy、参数 diff 和受影响子图。
- 不覆盖旧脚本快照、参数或 Artifact。
- 分析 Agent 不得修改 `resources/built-in-plugins/` 源码让当前任务通过。
- 插件实现缺陷必须作为独立开发修复、升级版本并补回归后再运行。
- 科学设计变化、不可逆操作、工作区外写入、付费和凭据动作继续走用户决定门。

## 5. 收口工作包

每次只完成一个 HLE-C 子包。

### HLE-C0：事实审计、状态纠偏与生产基线

状态：`planned`

必须交付：

- 主计划状态区分“后端原语完成”和“生产验收完成”。
- `POST /api/loop/iterate` 路由测试：状态更新、sequence、actionKey、事务、跨项目。
- 核查 LoopRun hash/状态更新顺序；状态变化不得被 immutable hash 误阻断。
- 历史假成功 fixture：failed Job + 部分文件 + 模型声称完成。
- 生产基线指标：ai-agent 接入、真实 loop rows、前端投影、Provider/重启/视觉证据。
- evidence update 与只读 verify 命令分离；默认检查不静默改写 golden evidence。

出口：

- 假成功 fixture 在当前基线明确失败，并指向 HLE-C2。
- 文档状态与代码/证据一致。
- API 路由边界有真实测试，不只测试 repository。
- 本包不修改生产执行行为。

建议提交：`test(harness-loop): freeze production integration gaps`

### HLE-C1：接入真实 task/legacy Agent loop

状态：`completed`

首选位置：

- `core/r-server/routes/ai-agent.js`
- `core/r-server/agent-tools/agent-loop-control.js`
- `core/r-server/agent-tools/` 下的共享 orchestration helper
- `core/shared-backend/loop-controller.js`
- `core/r-server/routes/harness.js`
- `core/r-server/db.js`

必须交付：

- 从 ScientificTaskSpec/Workflow Plan 创建或恢复 LoopRun。
- task/legacy route 调用同一个生产 iteration helper。
- 每轮 Provider 前观察真实 Task/Plan/Job/Artifact。
- Controller 决策经过 schema、policy、actionKey、active Job 和取消检查。
- 继续使用 `executeToolCall()`，不得直接调用 handler。
- 工具执行前后幂等写入 Iteration、Action、Decision 和 checkpoint。
- 增加兼容 SSE Loop 事件；旧客户端忽略后仍可工作。
- 普通聊天和 context_assist 不创建 LoopRun。

出口：

- 两条真实 Agent route 都产生可查询的 LoopRun/Iteration。
- SSE 重连、call ID 碰撞和页面重挂载不重复创建 Job。
- 用户取消后不启动新动作。
- Provider tool-call history 保持合法配对。
- finalization recovery、fallback、权限和 ToolResult 无回归。

建议提交：`feat(harness-loop): connect controller to production agent runs`

### HLE-C2：接入 Validator、Diagnoser 与 Repair

状态：`completed`

必须交付：

- ToolResult 后重新读取真实 Job/Artifact Truth，不信任模型摘要。
- Job、Artifact、provenance、lineage、Delivery、Replay 验证结果写为 Evidence。
- validator blocked/fail 阻止完成；warn/degraded 按契约决定下游。
- failed Job + 部分文件假成功回归稳定阻断。
- 故障分类连接 Repair Strategy。
- 只自动执行 `isActionable` 且权限/科学边界允许的修复。
- 修复产生 parent lineage、新参数 hash、新 Job 和新验证结果。
- 方法不适用、科学设计缺失和外部副作用进入等待/阻断。

出口：

- 至少 6 类真实临时 Job 故障经过生产 orchestration。
- failed Job 永远不会因存在文件被宣称完成。
- verified 节点不重跑，只重建首个失效节点下游。
- 插件源码没有被当前分析任务原地修改。
- 非显著结果可正常交付，不因“不符合期待”进入修复。

建议提交：`feat(harness-loop): enforce validators and lineage-safe repair`

### HLE-C3：耐久恢复、查询 API 与上下文重建

状态：`completed`（HLE-C3R 收口）

必须交付：

- 按 `projectId + conversationId` 查询 active/latest LoopRun。
- API 提供 compact/expanded 投影，不返回无界日志和大表。
- 成功 iteration 写 checkpoint；副作用前保存 intent。
- 后端启动时 reconcile running LoopRun/Job。
- 无法证明 Job 终态时进入 `recovery_required`。
- ContextEnvelope 从 TaskSpec、Plan、checkpoint、失败/修复历史和 Truth 重建。
- 模型切换、上下文压缩和旧 partial 数据有明确降级。
- Loop API 鉴权、项目隔离、limit 和脱敏完整。

出口：

- 刷新、会话切换、后端重启、应用重开和模型切换矩阵通过。
- actionKey/Job 防止恢复时重复副作用。
- 摘要不是唯一副本。
- 损坏/缺失 snapshot 显示可操作恢复状态。

建议提交：`feat(harness-loop): resume durable runs from execution truth`

> HLE-C3R 完成（耐久恢复收口，2026-07-23）：
> REST API（HLE-C3 首批，已上线）：
> - `/api/loop/runs/:loopRunId`（?expanded=1 追加 recoveryRequired/recoveryReason/abortedByUser/recentIterations/evidenceCount）
> - `/api/loop/runs?conversationId=&projectId=` — 按会话/项目查询
> - `/api/loop/iterations|actions|evidence/:loopRunId` — compact 投影
> - `/api/loop/recovery/:loopRunId` — 恢复投影（canResume/needsRecovery/recoveryHint）
> - `/api/loop/runs/:loopRunId/abort` — 中止信号写入
>
> C3R 补齐（本轮）：
> - **耐久 resume**：`db.getActiveLoopRunForConversation(projectId, conversationId)` 解析最近的非终止 LoopRun；`agent-runner._loopInit` 先 resume 再新建，多轮任务复用同一 LoopRun 而非每轮新建；resume 时从 `listLoopIterations` 重建 sequence + parentHash 链；`planned`→`running` 在首个执行轮推进。
> - **终止即恢复**：server 重启 reconcile 写 `failed(recovery_required)`；`getActiveLoopRunForConversation` 只取 `planned`/`running`，重启中断的 run 不被静默 resume，改由 recovery API 暴露（`canResume=false`）。
> - **checkpoint 不是唯一副本**：新增 `_loopSaveCheckpoint`（`buildIterationCheckpoint`→`saveContextCheckpoint`），每轮 iteration 落一份脱敏 checkpoint；`buildLoopContextEnvelope` 可从持久 checkpoint 重建（模型切换只换决策方，不换 TaskSpec/Truth/验收）。
> - **API 收口**：修复 recovery/abort 读错字段（`run.loopStatusJson/loopStatusHash`→`run.record/run.hash`），补 `listLoopActions`（此前 `/actions` 端点空转），补项目归属隔离（`userMayAccessProject`：owner/public/ownerless/admin，非属主 403）。
> - 证据：`test/loop-durable-resume.test.mjs`（11）+ `test/loop-api-route.test.mjs`（15，真实挂载 router + 真实 DB + mock auth）；641 loop + 1049 全量 pass / 0 fail，`npm run check` 绿。
> - 待 HLE-C5R：真实应用重启矩阵、真实模型切换矩阵和视觉恢复态仍属 Step 7 实机验收，不因离线通过而声明。

### HLE-C4：会话与摘要 UI 接线

状态：`in_progress`（功能接线完成：实时 SSE、历史回放、recovery、active/background、token/cache/cost；明暗/820px/停止恢复视觉矩阵待验）

> HLE-C4R 进度（2026-07-23，聊天消费端）：
> - `frontend/src/lib/loop-client.ts`：`/api/loop/*` 类型化 REST 客户端 + SSE 事件类型（LoopPhaseEvent/LoopIterationEvent）+ 展示辅助（isLoopComplete / isLoopUnsuccessfulTerminal / loopStatusLabel / deriveLoopDisplay / loopDecisionLabel）。聊天与摘要共用同一 loop 词表，杜绝第二套完成状态。
> - `conversationRunStore.ts`：`ConversationRunSnapshot.loop` 投影；`startConversationRun` 接入 `onLoopPhase`/`onLoopIteration`（此前被丢弃）；`mergeLoopIteration` 按 iterationId 去重、sequence 排序 → SSE + API 回放幂等；loop 投影在 stop/finish 后保留（spread）。
> - `SimpleChat.tsx` + `simple-chat.css`：`LoopStatusPanel` 紧凑显示阶段状态 + 轮次 + 最近公开结论，可展开逐轮 decision/publicConclusion；blocked/failed/cancelled 一律非绿（tone=warning/neutral）；只展示 publicConclusion，不展示隐藏思维链。
> - `CenterPanel.tsx` + `WorkspaceSummaryCard.tsx`：从同一个 conversation run store 读取当前会话 loop 投影；摘要卡紧凑显示后端状态、轮次、最近公开结论和最近决策，未创建 LoopRun 时不显示。未建立第二套完成状态。
> - 测试：conversationRunStore 15/15（含 4 个 loop 用例：phase 投影、iteration 幂等去重、stop 后保留、blocked 非绿）；frontend 全量 223/223；`npm --prefix frontend run build:check` 通过；根 `npm run check` 全绿。
> - 2026-07-23 时记录的历史回放、摘要 active/background/recovery/token-cost 功能缺口已于 2026-07-24 关闭；保持 in_progress 的仅是明暗 / 820px 窄窗 / 停止恢复视觉矩阵与 HLE-C5 Step 7。
>
> HLE-C4R 功能收口（2026-07-24）：
> - `automationMode` 与 `executionIntent` 分离；新运行走 `buildLoopRun`，旧 task_* 行只读兼容。
> - Loop 每轮结束会真实持久化 completed/blocked/cancelled，不再依赖瞬时 SSE 表示终态。
> - `/api/loop/session-summary` 提供有界冷启动投影：latest run、公开 iterations、recovery、active/background 和 conversation usage。
> - `useDurableConversationLoop` 在打开、切换、重开会话时从 SQLite 回放，并与 live SSE 按 iterationId 幂等合并；聊天停止后阶段记录不再随 transient run 清除。
> - 摘要同步显示恢复状态、当前/后台 Loop 数、Token、缓存口径与成本状态；资源仍由 RuntimeResourceSnapshot 提供。
> - 自动证据：真实 Router 18 项、Contract/Repository 64 项、前端 226 项、根测试 1067（1056 pass/0 fail/11 skip）。
> - 真实 Desktop 纠偏：bounded AI Loop API 必须先于 legacy `/api/loop/:loopRunId` 注册；desktop-local 的 `req.user.id` 统一归一化为 `req.userId`。否则独立 router 测试虽绿，真实产品仍会分别返回 404/401。
> - 无 assistant 消息的历史会话仍直接渲染 durable LoopStatusPanel，避免恢复事实因消息形态缺失而不可见。
> - 待续仅剩实机视觉矩阵；未取得证据前 UI-101 不标 verified。

首选位置：

- `frontend/src/lib/harness-client.ts`
- `frontend/src/components/copilot/copilotClient.ts`
- `frontend/src/components/copilot/conversationRunStore.ts`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/pages/project-workspace.tsx`
- 对应 hook、CSS 和测试

必须交付：

- LoopRun/Iteration/Validator/Repair/Checkpoint 类型和 API。
- SSE 与 API 回放按 iterationId/actionKey 幂等合并。
- 默认只显示阶段结论、状态、尝试次数和下一步。
- 展开显示公开证据、验证器、修复、parent Job/Artifact 和脚本/结果入口。
- 摘要显示 DAG、active/background/recovery、最近结论、Token/费用和资源。
- failed + partial 显示任务未完成，不能显示绿色完成。
- 停止生成、切换会话和重开后阶段记录不消失。
- 不展示或保存隐藏思维链。

出口：

- 前端测试覆盖 SSE 幂等、回放、终态、failed partial、取消和恢复。
- A/B 会话并行与返回恢复通过。
- 明暗、820px、摘要折叠/展开和长任务视觉矩阵通过。
- UI 只消费后端 Loop/Job/Artifact，不维护第二套完成状态。
- UI audit 同提交更新；无实机证据时保持 `in_progress`。

建议提交：`feat(agent-ui): project durable loop progress and repair evidence`

### HLE-C5：真实 SPT-1 与产品出口

状态：`in_progress`（HLE-C5R 基础设施完成，真实产品验收待 Step 7：Plugin Contract 已统一（biof3.deg.v1、lfc_col、DESeq2 preflight）、bulk-rna-core 4-step DAG 已完成、Repair Boundary 已建立、scientific-task-planner coldataBinding 已完成、false-success 检测已修复。1032/1032 测试全量通过，插件契约 lint 0 错误。真实产品路径三轨（Normal/Repairable/Blocking）和 UI/Provider/重启验收待 Step 7。）

Provider 验收入口已覆盖 DeepSeek、Anthropic 与产品通用 OpenAI-compatible Profile；只有 key/base URL/model 环境变量齐备的目标才参与人工矩阵，报告不保存凭据、请求头、完整 Provider 响应或 endpoint URL。

2026-07-24 真实主轨纠偏：Agent 最终正文不能先于 Loop ledger 收口被视为 done；Loop Controller 运行时依赖启动即校验，post-processing fatal error 必须把 task/Loop 标为 failed。真实 observed-state digest 由 Job 状态、最近公开进度和持久化 iteration 计数组成，不再使用被控制器忽略的字段。

必须交付：

- SPT-1 从真实聊天请求和生产 route 启动。
- DAG 覆盖 metadata validator、expression QC、DESeq2、DEG standardizer、volcano、GO/KEGG、GSEA；不支持项诚实说明。
- 正常、可修复和必须阻断三条真实产品轨迹。
- 故障覆盖 Provider、非法参数、runtime、Artifact、输入漂移、重复动作和应用重启。
- 至少两种真实 Provider 人工矩阵。
- 每个图/表/报告有本次脚本、参数、输入和输出 hash。
- 数据库外 ReplayPackage 验证。
- 明暗、常规/窄窗、长任务、停止/恢复和异常视觉矩阵。
- `npm run harness:loop` 为只读验证；另设显式 evidence update。

出口：

- 三条轨迹都创建真实 LoopRun 和真实 Job/Artifact。
- 正常任务满足 TaskSpec、DAG、Validator、Delivery 和 Replay。
- 可修复任务保留失败 Job、parent lineage 和新 verified Job。
- 阻断任务不创建非法 Job，只询问关键科学问题。
- 双 Provider、重启和视觉证据绑定当前 commit。
- 既有 check/test/Phase 7/HRT/Plugin/UI 门禁无回归。
- 只有此时才能声明 `Harness v1.1 / HLE-0～HLE-6 complete`。

建议提交：`test(harness-loop): close production SPT-1 acceptance`

## 6. 测试矩阵

| 层级 | 必须覆盖 |
|---|---|
| Contract | schema、迁移、hash、actionKey、脱敏、旧数据 |
| Route | 鉴权、隔离、事务、sequence、更新、查询、snapshot |
| Agent | task/legacy、history、取消、fallback、SSE、幂等 |
| Execution | run_tool、真实 job、Artifact Truth、failed partial |
| Validator | Job/Artifact/provenance/lineage/Delivery/Replay |
| Repair | 参数、runtime、输入、Artifact、方法、资源、外部副作用 |
| Recovery | 刷新、会话、后端/应用重启、模型切换 |
| UI | compact/expanded、摘要、失败/恢复、明暗、窄窗 |
| Product | SPT-1 三轨、双 Provider、Replay、成本资源 |

测试保护阈值只能依赖注入，不能成为生产正常轮数上限。

## 7. 证据目录

```text
acceptance/harness-loop/production/
├── baseline.json
├── route-integration.json
├── agent-loop-matrix.json
├── validator-repair-matrix.json
├── restart-recovery-matrix.json
├── provider-matrix.json
├── ui-matrix.md
├── spt1-normal/
├── spt1-repairable/
└── spt1-blocking/
```

证据只保存脱敏状态、计数、hash、reason code、版本和相对路径，不保存 Key、请求头、完整 Provider 响应、用户真实正文或隐藏推理。

## 8. 开发纪律

1. 先读 `AUDIT-LOG.md` 并核对 Git/HEAD/origin。
2. 每次只实施一个 HLE-C。
3. 先写失败测试和基线，再改生产代码。
4. 不用 fixture JSON 直接驱动生产 UI。
5. 不在 Controller 硬编码生信算法或插件 ID。
6. 不修改用户数据、历史 Job 或旧 Artifact。
7. 不用 `git add .` / `git add -A`。
8. 同提交更新计划、证据和必要 UI audit。
9. 未经授权不 push、不发布、不上传 OSS。
10. 自动检查不能冒充 Provider、重启、打包态或视觉验收。

## 9. 新 Agent 接手顺序

1. `git status --short --branch`
2. `git log -8 --oneline --decorate`
3. `git rev-parse HEAD && git rev-parse origin/main`
4. `docs/AUDIT-LOG.md`
5. `docs/next-steps-roadmap.md`
6. `docs/project-workspace-handoff.md`
7. 本文件
8. `docs/harness-loop-engineering-plan.md`
9. 当前 HLE-C 的代码和测试
10. `acceptance/harness-loop/`

接手后先证明上一出口、生产 Agent 接线、Truth 来源，以及自动/Provider/重启/视觉证据的分别状态。

## 10. 完成定义

只有 HLE-C0～HLE-C5 全部满足出口标准，才能关闭本计划：

> 用户从真实聊天提出科学目标后，生产 Agent 持续读取真实执行证据、验证结果、自动处理可修复异常，在关键科学问题上诚实暂停，并在中断后恢复；只有经过 Job/Artifact/Validator/Delivery/Replay 验收的任务才能显示完成。
