# Harness Loop Engineering v1 — 工程升级工作包

最后更新：2026-07-23

状态：`completed`

主模块：`P-03 Harness 与 Agent 工作流`

协作模块：`P-01 项目、会话与上下文`、`P-02 工具执行、Job 与 Artifact Truth`、`P-04 Plugin SDK 与分析能力`、`P-07 模型网关与 AI Provider`、`W-03 Agent 会话`、`W-04 结果与报告`

跨模块关注点：`C-03 安全、确认与审计`、`C-04 状态与事件同步`、`C-05 测试与质量门禁`、`C-06 性能与交互手感`

## 1. 决策结论

本工作包是 **Harness v1 的增量升级**，不是并行系统，也不是对现有 Harness 的推倒重构。

当前 Harness 已经具备：

- 模糊科学需求到 `ScientificTaskSpec` 的结构化契约。
- Workflow Plan / DAG、确认门、持久化 Checkpoint、交付与 ReplayPackage。
- 目标驱动的 Agent tool loop、工具结果回灌、重复调用熔断和最终答复恢复。
- Plugin SDK、真实本地 R/Python 执行、Job/Artifact provenance 与漂移分类。
- 会话、公开阶段结论、工具活动和恢复状态的持久化展示。

本工作包只补齐一个工程缺口：

> 把“继续执行、验证结果、诊断偏差、修复或重规划、恢复任务、判断完成”从隐式模型行为提升为可持久化、可观测、可测试、可审计的 Loop 控制契约。

固定不变量：

> `run_tool → tool_job → artifact truth`

Loop Controller 只能编排和投影这条事实链，不得创建第二套 executor、job 表、artifact 仓库、插件系统或 workflow truth。

完成本工作包后，版本语义为 `Harness v1.1 / Loop Engineering v1`。

### 当前生产接线审计（2026-07-23）

HLE-0～HLE-5 已形成后端合同、纯函数、SQLite ledger 与离线测试基础，但尚未全部接入生产 Agent、真实 Job/Artifact 验证和前端。提交标题或离线 `harness:loop` 聚合通过不能替代真实 Provider、重启恢复和视觉产品验收。

剩余工作统一由 [`harness-loop-production-closure-plan.md`](./harness-loop-production-closure-plan.md) 的 HLE-C0～HLE-C5 收口。完成前，本文件保持 `in_progress`，且不得宣称 `Harness v1.1` 已完成。

## 2. 术语与责任边界

### 2.1 固定术语

| 用户或开发者用语 | 精确定义 | 主模块 |
|---|---|---|
| Harness | TaskSpec、DAG、Loop、执行事实、恢复、交付与复现的完整工程约束体系 | P-03 |
| Loop 工程包 / HLE | Harness 内部对“观察—执行—验证—修复—终止”的控制升级 | P-03 |
| Plugin | 具有稳定输入、输出和验证契约的独立科学分析模块 | P-04 |
| Workflow / DAG | 为一个任务组合多个 Plugin 节点及其依赖关系 | P-03 |
| Job / Artifact Truth | 一次真实执行及其磁盘产物、状态、诊断和 lineage | P-02 |
| Scientific Pilot / SPT | 用真实或脱敏真实科学问题验收完整产品闭环 | P-03，按任务影响 P-04 |

后续用户只说“继续 Loop 工程包”时，新 Agent 必须定位到本文件；用户说“继续 Harness”时，先读 `next-steps-roadmap.md` 判断当前 Harness 子包，不得默认重开已完成的 HRT-0～HRT-7。

### 2.2 Loop 负责

- 根据当前目标、DAG、Job、Artifact 和验证结果选择下一步。
- 判断当前节点应该继续、重试、修参、重规划、等待、阻断或交付。
- 记录每次循环采用的公开证据、动作、结果和退出理由。
- 识别“没有新增证据”的异常循环，而不是依靠固定正常轮数提前结束。
- 在应用重启、会话重开、模型切换或上下文压缩后，从持久化事实恢复。
- 为 UI 提供紧凑的阶段结论、尝试次数、恢复状态和证据入口。

### 2.3 Loop 不负责

- 不在核心代码中硬编码 DESeq2、WGCNA、GO/KEGG 等领域算法。
- 不把 LLM 自我评价当作统计或文件证据。
- 不直接执行分析脚本；正式分析仍通过 `run_tool` 创建真实 `tool_job`。
- 不覆盖失败 Job、旧脚本或旧 Artifact；修复后必须生成新 Job/版本并保留 parent 引用。
- 不把隐藏推理链保存或展示给用户，只保存可公开、可复核的阶段结论与决策依据。
- 不以“完全访问”绕过科学设计、不可逆外部副作用或证据不足状态。
- 不因模型切换而改变 TaskSpec、输入快照或验收标准。

## 3. 目标闭环与层级

```text
用户目标 / ScientificTaskSpec
  → 构建或恢复 Workflow Plan
  → 选择当前可运行节点
  → 调用现有工具或 run_tool
  → 读取真实 ToolResult / Job / Artifact Truth
  → 执行确定性与科学验证
  → 诊断差距
      ├─ 已满足节点验收 → 推进下游
      ├─ 可自动修复 → 新参数/新 Job/新 Artifact
      ├─ 方法不适用 → 重规划受影响子图
      ├─ 需要关键科学决定 → 等待用户
      ├─ 当前证据不足 → cannot_reliably_answer
      └─ 暂时性系统异常 → 有界退避后重试
  → 检查任务级交付验收
  → DeliveryManifest / ReplayPackage / 最终说明
```

Loop 必须区分四个层级，禁止混成一个“轮数”：

| 层级 | 作用域 | 完成依据 |
|---|---|---|
| `task` | 一个 ScientificTaskSpec | 用户目标、必须交付物和限制均得到证据覆盖 |
| `workflow` | 一个版本化 DAG | 必需节点终态、依赖和 lineage 完整 |
| `node` | 一个科学分析模块 | 节点自己的输入、执行和输出验收谓词通过 |
| `iteration` | Agent 的一次观察与决策 | 产生新证据、有效状态变化或明确退出决定 |

一次 `iteration` 可以不创建 Job，例如读取 Artifact Truth、执行验证器或确认输入漂移；一次 Job 也不能自动代表节点完成。

## 4. Loop Contract v1

### 4.1 核心对象

HLE-1 实现前必须先固定 JSON Schema/TypeScript/后端校验。字段可扩展但不得改变以下语义：

```ts
type LoopRunStatus =
  | 'planned'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_resource'
  | 'recovery_required'
  | 'cannot_reliably_answer'
  | 'completed'
  | 'cancelled'
  | 'failed';

type LoopDecision =
  | 'continue'
  | 'retry'
  | 'repair'
  | 'replan'
  | 'wait'
  | 'block'
  | 'complete'
  | 'cancel';

interface LoopRunV1 {
  contractVersion: '1';
  loopRunId: string;
  projectId: string;
  conversationId: string;
  scientificTaskRef: { taskSpecId: string; version: number; hash: string };
  workflowPlanRef: { planId: string; version: number; hash: string };
  status: LoopRunStatus;
  activeNodeIds: string[];
  satisfiedGoalIds: string[];
  unresolvedGoalIds: string[];
  latestIterationId?: string;
  latestCheckpointRef?: string;
  budgetPolicy: LoopBudgetPolicyV1;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface LoopIterationV1 {
  contractVersion: '1';
  iterationId: string;
  loopRunId: string;
  sequence: number;
  observedStateDigest: string;
  goalGapIds: string[];
  evidenceRefs: LoopEvidenceRefV1[];
  proposedAction: LoopActionV1;
  decision: LoopDecision;
  decisionReasonCode: string;
  publicConclusion: string;
  resultRefs: LoopEvidenceRefV1[];
  progressDelta: LoopProgressDeltaV1;
  startedAt: string;
  finishedAt?: string;
}
```

### 4.2 引用而不是复制

`LoopRun` 和 `LoopIteration` 只保存稳定引用与摘要：

- TaskSpec/Plan 使用 ID、version 和 hash。
- Tool 调用使用 `traceId`、`callId` 和版本化 ToolResult。
- Job 使用 `toolJobId`；Artifact 使用 artifact ID、相对路径和 hash。
- 输入使用项目相对路径、文件 hash 和 snapshot ref。
- 验证结果使用 `validatorId + version + resultHash`。

原始大表、完整日志、文件正文和隐藏模型推理不得复制进 Loop 表或聊天 meta。

### 4.3 幂等与并发

- 同一 `conversationId + scientificTaskRef.hash` 同时最多一个 active LoopRun。
- 每次副作用动作必须携带稳定 `actionKey`；恢复或 SSE 重放不能重复创建 Job。
- 相同 iteration 的持久化使用 compare-and-set 或事务保证 sequence 单调。
- 一个节点已有 running Job 时不得盲目再开；先 reconcile。
- 并行 DAG 节点必须各自持有节点状态，但任务级决策由同一个 LoopRun 汇总。
- 用户取消后不再启动新动作；已开始 Job 的真实状态由 P-02 决定，不能伪装已取消。

## 5. 继续、完成与停止标准

### 5.1 正常继续条件

至少满足一项才允许下一 iteration：

- 新增一个以前不存在的可引用证据。
- Job/Artifact/节点发生真实状态变化。
- 缩小了一个明确的 goal gap。
- 根据新证据修改了参数、方法或受影响 DAG 子图。
- 完成必要的用户决定并写入 TaskSpec 新版本。

仅重复叙述计划、重新读取未变化文件、调用同一工具同一参数、生成同义解释，不算进展。

### 5.2 节点完成条件

节点从 `running/validating` 进入 `verified` 必须同时满足：

1. 输入引用与当前快照匹配。
2. 对应 Job 有真实成功终态；若插件主动阻断则不得标成功。
3. 必需 Artifact 存在、可读、hash 匹配且 provenance 完整。
4. 插件声明的结构、数值、诊断和领域验证器全部达到阈值。
5. 下游消费使用的是本次 verified Artifact，不是聊天文本或旧文件。

### 5.3 任务完成条件

`complete` 不是“模型不再调用工具”，而是所有条件均成立：

- TaskSpec 中所有必须目标为 `satisfied`，可选目标有明确状态。
- 必需 DAG 节点 verified；被跳过节点有合法原因且不破坏交付。
- DeliveryManifest 状态符合用户约定，产物与脚本入口可访问。
- ReplayPackage 完整性校验通过，或明确标记无法重放的证据原因。
- 最终科学说明只引用已验证 Artifact，并披露限制、阻断项和未回答问题。

### 5.4 异常停止条件

正常路径不设置任意的固定轮数上限，但必须有异常保护：

- `no_progress`：连续 iteration 没有新增证据或有效状态变化。
- `repeated_action`：同一工具、归一化参数和输入快照重复请求。
- `oscillation`：在两个等价计划/参数状态之间往返。
- `failure_threshold_exceeded`：同一稳定故障经过允许的修复策略仍失败。
- `budget_attention_required`：预计继续运行将超过用户设置的成本、时间或资源软预算。
- `unsafe_or_irreversible`：动作超出当前用户授权或无法安全回滚。
- `evidence_insufficient`：缺少不能可靠推断的科学设计或输入。
- `provider_unavailable`：已执行允许的恢复/fallback 后仍无法继续。

异常停止必须保留已完成 Job/Artifact，并生成“停止位置、原因、已尝试处理、可恢复条件”；不得要求用户重新描述整个需求。

## 6. 验证器体系

### 6.1 验证顺序

验证必须按可信度由高到低执行：

1. Schema/文件/哈希/行列/类型等确定性验证。
2. 插件声明的领域验证器和诊断规则。
3. Workflow 级 lineage、依赖和交付覆盖验证。
4. 可选的模型评价器，只用于解释、发现遗漏或提出候选修复。

模型评价器不能推翻确定性失败，也不能自行制造统计结论。模型切换后相同 Artifact 和 validator 版本应得到相同确定性验收状态。

### 6.2 Validator Contract

每个验证器至少声明：

- `validatorId`、版本、适用 artifact/type。
- 输入字段和前置条件。
- `pass | warn | fail | unavailable` 四态。
- 稳定 reason code、公开说明和机器可读 details。
- 是否阻断节点、是否允许自动修复、建议的 repair strategy IDs。
- 验证器源码/规则 hash、运行时信息和结果 hash。

Plugin 的 `tool-definition.json`/manifest 负责声明模块特定验证器；Harness 提供通用文件、provenance、lineage 和交付验证器。不得把插件领域规则复制进 Loop Controller。

### 6.3 科研结果基本原则

- 进程退出码 0 只证明命令结束，不证明科学结果可靠。
- 生成文件只证明产物存在，不证明内容正确。
- `p.value`、`p.adjust`、effect size、样本数和过滤规则必须来自真实结果表。
- 不根据用户期待的结论修改阈值或重复尝试直到显著。
- 非显著、低功效、覆盖不足和方法不适用都可以是正确交付结果。

## 7. 故障分类与自动恢复策略

| 故障类 | 默认判断 | 自动动作 | 升级条件 |
|---|---|---|---|
| `transient_provider` | 限流、网关暂时失败、连接中断 | 退避重试；仅使用用户配置的 fallback | 允许尝试耗尽后 `provider_unavailable` |
| `transient_runtime` | 临时文件锁、短暂进程错误 | reconcile 后创建新尝试 | 同 reason code 重复失败 |
| `invalid_arguments` | 参数 schema/枚举/范围不合法 | 用契约和工具定义修参 | 修参会改变科学设计时等待用户 |
| `input_format` | 列名、编码、矩阵方向等可确定转换问题 | 调用明确转换/校验模块，保留原输入 | 转换存在歧义或可能丢数据 |
| `runtime_not_ready` | R/Python/包/capability 缺失 | 走现有 provisioning/readiness | 无可信 bundle、平台不支持或下载失败 |
| `artifact_invalid` | 缺文件、hash/结构/内容验证失败 | 诊断上游，从首个失效节点重跑 | 原因无法定位或连续失败 |
| `method_not_applicable` | 方法前提不满足 | 重规划受影响子图并比较候选方法 | 替代方法改变科学问题或解释口径 |
| `scientific_design_missing` | contrast、配对、批次、统计单位不明确 | 最少必要提问 | 不得通过 trusted/full 绕过 |
| `resource_pressure` | 内存、磁盘或计算风险 | 暂停新节点、建议分块/替代方法 | 可能影响结果可比性时等待用户 |
| `external_side_effect` | 上传、发布、付费、工作区外写入 | 不自动执行 | 必须有明确用户授权与现有安全门 |

每个自动修复动作必须记录：原失败引用、strategy ID/version、修改字段、依据、parent Job/Artifact、验证结果和是否消耗额外成本。

## 8. 预算不是正常任务的硬截止线

Loop 采用“目标驱动 + 异常保护”，不得恢复历史的固定 5 轮/12 次正常上限。预算用于提前预警和阻止失控，不用于把正常科研任务伪装成已完成。

`LoopBudgetPolicyV1` 至少包括：

- Provider token/费用软预算和用户可见估算。
- Job 预计/实际耗时、CPU、内存、磁盘和可选 GPU 指标。
- 同类失败、无进展和重复动作阈值。
- 自动修复允许的风险等级和最大额外成本。
- 预算接近/超过时的 `continue | pause | require_user` 策略。

资源峰值不可用时必须显示 `unavailable_without_process_sampler`，不能用主机开始/结束快照冒充进程峰值。Provider cache、BioF3 证据缓存和 Replay cache 的命中必须记录 scope/key/version；缓存命中不能跳过当前输入 hash 和 validator 检查。

## 9. 持久化、压缩与模型切换

- 原始消息、TaskSpec、Workflow Plan、Job、Artifact、LoopIteration 和验证结果分别持久化；摘要不是唯一副本。
- 每个成功 iteration 结束后写入 checkpoint；副作用动作开始前先保存 intent/actionKey。
- 应用重启时先 reconcile running Job 和磁盘 Artifact，再决定恢复节点，禁止直接重复执行最后动作。
- 上下文压缩从结构化对象生成 `LoopContextEnvelope`，包含目标、未解决 gap、当前节点、最近有效证据、失败/修复历史和下一候选动作。
- 精确判断仍回读原始消息、Trace、Job 或 Artifact；不得依据摘要猜测参数或文件内容。
- 模型/Profile 切换只替换决策提供者，不修改事实对象；重新根据新窗口大小构建 ContextEnvelope。
- Provider 输出的 loop decision 必须经过 schema、policy、precondition 和 actionKey 校验后才能执行。

## 10. 用户界面与公开信息

### 10.1 默认紧凑视图

会话中每个阶段默认只显示一条公开结论：

```text
表达矩阵质控 · 第 2 次尝试 · 已完成
结论：样本名全部匹配；发现 3 个低质量候选样本，尚未自动删除。
下一步：验证实验设计是否仍可估计。
```

默认不展示模型隐藏思维、重复计划、完整工具参数或长日志。

### 10.2 展开详情

用户点击后显示：

- 阶段目标和验收条件。
- 采用的公开证据与对应 Job/Artifact/文件。
- 验证器结果和 reason code。
- 修复或重规划动作、尝试次数和 parent 引用。
- Token、耗时和可用资源指标。
- 查看脚本、参数、结果和复现入口。

完整 stdout/stderr、大表和时间序列资源数据仍位于 Job/Artifact 详情，不复制到聊天卡片。

### 10.3 摘要卡片

摘要区投影同一个 LoopRun：

- 当前任务、状态和 DAG 完成度。
- 正在运行/后台挂起/等待恢复节点。
- 最近一个阶段结论与下一动作。
- 本次累计时间、Token/费用、内存/磁盘和峰值可用性。
- `继续 / 查看问题 / 停止` 等动作；只有真正需要用户决定时才出现确认按钮。

UI 只消费持久化 Loop/Job/Artifact 状态，不维护第二份完成状态。

## 11. 实现落点与依赖约束

下列是目标责任位置；实施 Agent 必须先用 `rg` 核对当前结构，不得因路径漂移创建重复模块：

| 责任 | 首选目标位置 |
|---|---|
| Loop contract、归一化、hash、状态迁移 | `core/shared-backend/loop-engineering/` 或同职责共享模块 |
| SQLite schema/repository/transaction | `core/r-server/db.js` 与现有 migration 机制 |
| Agent task/legacy loop 接入 | `core/r-server/routes/ai-agent.js`、现有 `agent-loop-control.js` |
| ToolResult/Trace/事件 | 现有 `agent-tools/tool-execution.js`、`tool-events.js` |
| Scientific Task/Workflow/恢复 API | `core/r-server/routes/harness.js` 与现有 shared-backend 契约 |
| Plugin validator 声明与加载 | P-04 manifest/schema/loader，不在 Controller 硬编码 |
| 前端类型与 API | `frontend/src/lib/harness-client.ts`、`copilotClient.ts` |
| 会话进度与摘要 UI | `frontend/src/components/copilot/`、`project-workspace.tsx` |
| 离线门禁与证据 | `scripts/harness-loop-*.mjs`、`test/loop-*.test.mjs`、`acceptance/harness-loop/` |

禁止新增状态管理库；前端继续使用 React state、自定义 hooks 和现有 conversation run store。Electron IPC 必须通过 `desktopBridge.ts`/preload 既有边界。

## 12. 工作包拆分

每次只实施一个 HLE 子包。前一包出口没有真实证据时，不得把后一包标为完成。

### HLE-0：真实基线、失败语料与评测夹具

状态：`completed`

目标：先记录 Harness v1 在真实科学任务上的行为，避免先写抽象框架再寻找问题。

必须交付：

- SPT-1 Bulk RNA-seq 脱敏任务：模糊需求、counts、metadata、预期交付契约和完整 DAG。
- 至少 3 类执行场景：正常闭环、可自动修复故障、必须阻断/询问的科学歧义。
- 故障注入：Provider 暂时失败、非法参数、缺包、Artifact 缺失/损坏、输入漂移、重复动作、应用重启恢复。
- 基线指标：目标完成率、错误分类准确率、无效工具调用、修复次数、用户提问次数、Token/时间/资源、交付/重放完整性。
- 夹具不得包含用户隐私、真实凭据或不可再分发数据。

出口标准：

- 基线脚本可零网络运行确定性部分；Provider 场景为显式人工验收，不进入默认 CI。
- 每个失败有稳定期望状态和 reason code，不以自然语言字符串作为唯一断言。
- 当前 Harness 的已知成功与失败都被诚实记录，不因计划目标修改预期。

建议提交：`test(harness-loop): add scientific loop baseline fixtures`

### HLE-1：Loop Contract 与持久化骨架

状态：`completed`

目标：实现版本化 LoopRun/Iteration/Evidence/Decision/Checkpoint 契约和数据库状态迁移。

必须交付：

- Schema、归一化、稳定 hash、reason code 和合法状态迁移。
- SQLite migration、repository、事务/幂等 actionKey 和项目/会话作用域查询。
- 敏感字段递归脱敏；原始正文和日志不进入 Loop ledger。
- 旧会话/旧 Job 无 Loop 数据时安全投影为 `partial_history`，不得伪造完整历史。

出口标准：

- 单测覆盖合法/非法迁移、hash 稳定性、并发 sequence、重复 actionKey、跨项目隔离、脱敏和旧数据兼容。
- 应用重启后可读取完全相同的 LoopRun/Iteration 引用关系。
- 不创建第二套 Job/Artifact 表。

建议提交：`feat(harness-loop): persist versioned loop contracts`

### HLE-2：统一 Loop Controller 与退出判定

状态：`completed`

目标：让 task/legacy 两条现有 Agent loop 复用一个控制层，所有动作先经过观察、决策和前置校验。

必须交付：

- `observe → decide → validate action → execute → record → evaluate exit` 控制器。
- Provider-safe 结构化决策 schema；非法/缺字段决策不得执行工具。
- no-progress、repeated-action、oscillation 和 active-job reconcile 检测。
- 用户取消、确认门、Provider fallback 和现有 finalization recovery 语义不回归。
- 保留正常任务无任意 iteration/tool-call 总量上限的产品决策。

出口标准：

- 同一 SSE 重放、页面重挂载或 Provider call ID 碰撞不会重复执行动作。
- 同一工具/参数/输入重复和 A↔B 计划振荡被稳定识别。
- 产生新证据的长流程可以继续，不因测试保护阈值进入生产逻辑而提前停止。
- task/legacy 协议历史始终成对且 Provider 格式合法。

建议提交：`feat(harness-loop): centralize progress and exit control`

### HLE-3：Validator Registry 与科学完成判定

状态：`in_progress`（离线验证器已建立；生产接线已由 HLE-C2 完成；**当前补充：Plugin Contract 统一后重新验证 artifact profile 校验**）

目标：建立通用验证器注册表，让节点/任务完成由证据决定。

必须交付：

- Validator Contract、注册、版本、适用类型、四态结果和阻断策略。
- 通用输入快照、Job、Artifact、provenance、lineage、Delivery 和 Replay 验证器。
- Plugin manifest 连接模块特定验证器的标准，不修改核心 Controller 添加领域 if/else。
- SPT-1 至少覆盖 metadata/counts 匹配、DE 结果结构与诊断、图表数据来源、富集统计字段和交付完整性。

出口标准：

- “exit 0 但缺必需文件”“文件存在但 hash/列不对”“图引用旧结果”等假成功全部被阻断。
- 非显著结果仍可在结构和方法成立时正确完成，不通过追求显著性触发重试。
- 更换模型不改变确定性 validator 结果。

交付物：

- `core/shared-backend/loop-validator-registry.js`（纯函数注册表）
- `core/shared-backend/loop-validators.js`（7 个内置验证器）
- `core/shared-backend/loop-controller.js`（decideNextAction 集成 validatorResults）
- `test/loop-validator-registry.test.mjs`（33 个单元测试）
- `test/loop-validators.test.cjs`（48 个内置验证器测试）
- `scripts/harness-loop-validator.mjs`（聚合门禁脚本）
- `package.json`（新增 harness:loop:validator:test + harness:loop:validator）

核心实现证据：相关离线测试通过，`npm run check` 通过；这不等于生产假成功阻断已经验收。

建议提交：`feat(harness-loop): verify scientific completion from artifacts`

### HLE-4：故障诊断、修复与受影响子图重规划

状态：`in_progress`（离线 Diagnoser/Repair 已建立；生产接线已由 HLE-C2 完成；**当前补充：Repair Boundary 细化（禁止生成假数据）**）

目标：根据稳定故障分类选择最小修复范围，并保留完整 lineage。

必须交付：

- 本计划第 7 节故障分类器和 repair strategy registry。
- 原参数重试、参数修复、输入转换、capability readiness、Artifact reconcile 和子图重规划。
- 修复产生新 Job/Artifact/Plan version，记录 parent 和 invalidation boundary。
- 无法可靠修复时输出可操作说明，不要求用户重新描述任务。

出口标准：

- 至少 6 类故障注入得到预期分类和处理。
- 只重跑第一个失效节点及其下游；未受影响的 verified Artifact 保持可复用。
- 科学设计变化、不可逆动作和证据不足不会被 trusted/full 自动越权。
- 修复失败不会覆盖原始脚本、参数或 Artifact。

交付物：

- `core/shared-backend/loop-failure-diagnoser.js`（10 类故障分类器，36 条规则，支持 HLE-3 validator 结果集成）
- `core/shared-backend/loop-repair-strategy.js`（12 个 repair strategy，parent lineage，safety level，cost multiplier）
- `core/shared-backend/loop-controller.js`（decideNextAction 集成 failedJob → repair decision + decision='retry'）
- `test/loop-failure-diagnoser.test.cjs`（54 个单元测试）
- `test/loop-repair-strategy.test.cjs`（34 个单元测试）
- `scripts/harness-loop-repair.mjs`（聚合门禁脚本）
- `package.json`（新增 harness:loop:repair:test + harness:loop:repair，check 接线）

核心实现证据：88 项相关离线测试通过，`npm run check` 与 `npm run harness:loop:repair` 通过；尚未完成真实 Job 修复矩阵。

建议提交：`feat(harness-loop): repair failures with lineage-safe replanning`

### HLE-5：耐久恢复、成本资源与紧凑 UI

状态：`in_progress`（离线基础设施已建立；生产恢复已由 HLE-C5 完成；前端面板待 UI agent）

目标：让长任务关闭会话或应用后仍可恢复，并让用户快速看懂当前状态。

必须交付：

- iteration checkpoint、启动 reconcile、模型切换 ContextEnvelope 和旧历史降级策略。
- Token/费用、耗时、缓存、资源软预算和预算提醒投影。
- 会话阶段结论、展开证据、摘要卡 DAG 进度、后台/恢复状态和必要动作。
- 停止生成后已持久化公开阶段结论不消失；不保存隐藏思维链。

出口标准：

- 页面切换、会话 A/B 并行、刷新、后端重启和应用重开矩阵通过。
- running Job 在重启后先 reconcile；无法证明状态时进入 `recovery_required`，不重复开 Job。
- 默认 UI 紧凑，只展示阶段结论；展开后能追到 Job、Artifact、验证器、脚本和尝试历史。
- 峰值采样不可用时诚实显示不可用，不估算伪造。

交付物：

- `core/shared-backend/loop-checkpoint.js`（buildIterationCheckpoint / buildLoopContextEnvelope / projectBudget / buildSessionStageView，~500 行）
- `core/shared-backend/loop-contract.js`（buildIteration 支持 validatorResults/repairAttempt/costSnapshot）
- `core/shared-backend/loop-controller.js`（buildControllerIteration 集成 costSnapshot）
- `test/loop-checkpoint.test.cjs`（38 个单元测试）
- `scripts/harness-loop-checkpoint.mjs`（HLE-5 门禁脚本）
- `scripts/harness-loop.mjs`（更新为 HLE-0~HLE-5 全量聚合门禁）
- `package.json`（新增 harness:loop:checkpoint:test，check 接线）

核心实现证据：HLE-2～HLE-5 相关离线测试通过，`npm run check` 与 `npm run harness:loop` 通过；尚无前端改动、真实重启恢复或视觉矩阵，不能作为 HLE-5 产品出口。

建议提交：`feat(harness-loop): durable checkpoints, budget policy, and session stage views`

### HLE-6：SPT-1 产品验收与聚合门禁

状态：`pending`（HLE-C5R 真实产品回归中——当前需先完成 Plugin Contract 统一和 Workflow DAG 修复）

目标：用真实 Bulk RNA-seq 问题证明 Harness v1.1 从模糊需求到可复现交付的完整 Loop。

必须交付：

- 统一 `npm run harness:loop` 零网络聚合门禁。
- SPT-1 正常、自动修复、科学歧义/阻断三条任务轨迹。
- 中断恢复、输入/插件/参数/环境漂移、数据库外 ReplayPackage 验证。
- 至少两种真实 Provider 的人工矩阵；凭据不落盘，Provider 结果只保存脱敏指标和状态。
- 明暗主题、常规/窄窗、长任务和异常恢复的实机 UI 矩阵。

出口标准：

- 正常任务达到所有 task/node/Delivery/Replay 验收条件。
- 可修复任务自动恢复并保留 parent lineage；不可可靠任务稳定阻断且说明缺口。
- 用户停止或应用重开不会丢失阶段结论、Job、Artifact 或下一恢复动作。
- 所有既有 Phase 6/7、HRT、Plugin 和 UI audit 门禁无回归。
- 证据写入 `acceptance/harness-loop/`，计划状态和当前入口在同一提交更新。

当前已有离线交付物：

- `scripts/harness-loop.mjs`（统一聚合门禁，输出 acceptance/harness-loop/hle-all-gate.json）
- `acceptance/harness-loop/hle-all-gate.json`（330 测试证据）
- `docs/harness-loop-engineering-plan.md`（保留真实完成状态）
- `docs/AUDIT-LOG.md`（保留历史提交记录，并登记生产接线阻塞）
- `docs/next-steps-roadmap.md`（指向 HLE 生产收口计划）

当前证据只证明离线门禁通过。双 Provider、生产 Agent route、重启恢复和实机 UI 矩阵尚未完成，不能据此关闭 HLE-6。

建议提交：`test(harness-loop): close HLE-0~HLE-6 product acceptance`

## 13. 验收矩阵

| 维度 | 必须证明 |
|---|---|
| 架构唯一性 | 所有正式执行仍为 `run_tool → tool_job → artifact truth` |
| 目标推进 | 每个 iteration 有新证据、状态变化或明确退出理由 |
| 科学完成 | 完成由 validator + Artifact 证据决定，不由模型口头宣称 |
| 自动修复 | 可修复错误自主处理；修改有版本、parent 和验证证据 |
| 诚实阻断 | 科学歧义、证据不足和不支持能力不会被权限模式绕过 |
| 异常循环 | 重复、无进展、振荡和同类失败可识别且不重复产生副作用 |
| 耐久恢复 | 会话/应用/模型切换后从结构化 checkpoint 和事实对象恢复 |
| UI 可理解 | 默认只显示阶段结论，展开能追溯证据和修复历史 |
| 成本资源 | Token/费用/缓存/资源可审计；不可用指标不伪造 |
| 隐私安全 | 无凭据、原始敏感数据、隐藏推理链或无界日志进入 ledger/证据 |
| 复现交付 | 每个正式图表/表格有本次脚本快照、参数、输入和输出 hash |
| 模型独立 | 模型可切换，TaskSpec/Truth/确定性验证语义保持稳定 |

## 14. 测试与证据规范

每个 HLE 子包至少包含：

1. 契约单测：schema、状态迁移、reason code、hash 和脱敏。
2. 控制器单测：动作选择、幂等、取消、重复、振荡和退出。
3. 集成测试：真实临时 workspace、SQLite、Job/Artifact 与恢复。
4. 科学 fixture：脱敏输入、真实 R/Python 脚本和可验证产物。
5. 失败注入：Provider、runtime、输入、Artifact、资源和重启。
6. UI 测试：事件归并、持久化投影、紧凑/展开状态。
7. 实机矩阵：仅在真实开发壳或打包态完成后才把相关 UI 标为 `verified`。

自动证据必须记录 commit、平台、架构、Node/R/Python 版本、命令、用例数、通过/失败/跳过、开始结束时间和脱敏环境摘要。更新证据的命令与只验证证据的命令必须分开，CI 不能静默重写 golden evidence。

最低回归命令：

```bash
npm run check
npm test
npm run test --prefix frontend
npm run harness:phase7
npm run harness:scientific-task
npm run harness:plugins:acceptance
# HLE-6 新增：npm run harness:loop
```

若某项因本机运行时、Provider 凭据或视觉环境无法执行，必须标记 `unverified`/`skipped` 并写明原因；不得用代码检查冒充真实 Provider、打包态或视觉验收。

## 15. 实施与提交协议

每个子包遵守以下顺序：

1. 读取 `docs/AUDIT-LOG.md`，先处理阻塞/待合并项。
2. 核对 `git status`、HEAD、`origin/main` 和用户工作区改动。
3. 只实施当前 HLE 子包，先补失败测试/fixture，再改生产代码。
4. 运行定向测试，再运行与风险匹配的聚合门禁。
5. 同一提交更新本计划状态、证据路径、`next-steps-roadmap.md` 和必要的 UI audit。
6. 使用显式路径 stage；禁止 `git add .`、`git add -A` 和覆盖用户改动。
7. 每个提交只标一个主模块，建议使用本文件给出的 Conventional Commit 标题。
8. 没有用户明确授权时不 push、不发版、不上传 OSS、不操作真实外部数据。

实现过程中若发现计划与真实代码不符：

- 先记录当前证据和影响。
- 只允许调整实现落点，不得静默改变不变量、出口标准或科学边界。
- 需要改变架构或验收标准时，先把决策写入本文件并等待用户确认。

## 16. 新 Agent 接手协议

新 Agent 按以下顺序读取，不依赖聊天历史：

1. `git status --short --branch`
2. `git log -5 --oneline --decorate`
3. `git rev-parse HEAD && git rev-parse origin/main`
4. `docs/AUDIT-LOG.md`
5. `docs/next-steps-roadmap.md`
6. `docs/project-workspace-handoff.md`
7. 本文件 `docs/harness-loop-engineering-plan.md`
8. `docs/harness-scientific-task-contract-plan.md`
9. `docs/development-module-map.md`
10. 当前 HLE 子包引用的代码、测试和 `acceptance/harness-loop/` 证据

接手后先回答五个问题再修改代码：

- 当前 HLE 子包和状态是什么？
- 上一个子包的出口证据是否真实存在并通过？
- 本次修改的主模块、影响模块和不变量是什么？
- 哪些测试是自动门禁，哪些仍需 Provider/实机/视觉验收？
- 工作区是否有不属于本任务的用户改动？

## 17. 完成定义

只有 HLE-0～HLE-6 全部达到各自出口标准，才能把本文件状态改为 `complete`。

最终完成不等于“Agent 能多调用几次工具”，而是：

> 对一个真实科学目标，系统能持续获得证据、验证每一步、在合理范围内自主修复、在证据不足时诚实停止，并在中断后恢复，最终交付可追溯、可复现的结果；全过程没有产生第二套执行真相。
