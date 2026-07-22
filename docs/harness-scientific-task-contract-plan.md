# Harness Scientific Task Contract v1 — 工程工作包计划

最后更新：2026-07-22

状态：`complete`（HRT-0 至 HRT-7 已完成；后续缺口另列，不改变本工作包验收结论）

主模块：`P-03 Harness 与 Agent 工作流`

协作模块：`P-01 项目、会话与上下文`、`P-02 工具执行、Job 与 Artifact Truth`、`P-04 Plugin SDK 与分析能力`、`W-03 Agent 会话`、`W-04 结果与报告`

## 1. 决策结论

本工作包是对现有 Harness 的**增量升级**，不是推倒重构。

当前已经存在并必须继续复用的能力：

- `inspect → infer → select → repair → confirm → run → verify → report` 阶段链。
- `run_tool → tool_job → artifact truth` 唯一正式执行事实链。
- 项目文件索引、readiness、参数修复、工具注册表、workflow 状态投影、恢复动作和 Artifact lineage。
- Plugin/Artifact manifest v1、真实插件执行器和现有结果预览/报告展示。

本工作包只补齐一个工程缺口：

> 把用户的模糊科学需求，转化为可确认、可执行、可验证、可交付、可重放的 `ScientificTaskSpec`，并把它绑定到现有 `tool_job` 与 Artifact Truth。

Harness Core 不承载每个生物信息学分析需求。具体算法、领域参数和产物由 Domain Task Pack、Plugin 和 Workflow 提供；Harness 负责逻辑框架、边界、状态、证据和交付。

## 2. 目标闭环

```text
用户模糊需求
  → ScientificTaskSpec（需求契约）
  → Inspect / Infer / Select / Repair
  → 用户确认科学设计与交付标准
  → run_tool → tool_job
  → Verify Artifact Truth / lineage / diagnostics
  → DeliveryManifest（交付契约）
  → 结果预览、报告、下载包、复现入口
```

任何一步没有证据，都不能向用户宣称任务已完成。

## 3. 工程边界

### 3.1 Harness Core 负责

- 需求结构化：问题、数据类型、分析单位、对照、协变量、预期交付物。
- 数据证据：文件存在性、哈希、表头、样本结构、缺失值、重复数和索引命中。
- 方法选择接口：候选方法、选择依据、适用前提和风险。
- 决策门：哪些可以自动补全，哪些必须用户确认，哪些必须拒绝执行。
- 任务状态：计划、确认、运行、验证、修复、交付和重放状态。
- 证据绑定：需求契约、最终参数、`tool_job`、Artifact Truth、lineage 和交付清单之间的引用。
- 跨 Agent 可读取的计划、验收和接手协议。

### 3.2 Harness Core 不负责

- 不把 DESeq2、WGCNA、GO/KEGG 或单细胞流程硬编码进核心逻辑。
- 不替代生信工程师作不可逆的实验设计判断。
- 不根据预期结论调阈值、改输入或强行选择显著结果。
- 不新建第二套 executor、job 表、artifact 目录或 workflow truth。
- 不把自然语言解释当作统计证据。
- 不为“用户说得模糊”而静默猜测分组、对照、批次或统计单位。

### 3.3 Agent 主导、用户保留科学决策权

目标用户可能不了解文件格式、统计术语或分析工具。默认体验应由 Agent 主导，但不能把不可逆的科学判断伪装成自动化。实际工作中，Agent 还必须能够在分析前进行少量、临时、可审计的命令行验证：确认文件类型、表头、行列规模、编码、缺失值概况、样本命名和运行时状态，再决定是否能形成可靠的分析计划。

- 用户只需要用自然语言描述目标；Agent 负责定位项目文件、解释发现、提出候选方案和组织步骤。
- 优先采用“最少必要提问”：一次只询问当前无法安全推断、且会改变科学结论的关键问题。
- 每个问题都同时给出通俗解释、推荐选项、选择理由和选择后影响；高级参数默认折叠。
- Agent 可以自动完成文件识别、结构检查、默认参数建议、只读预检和结果整理；分组、对照、配对、批次、统计单位等关键设计必须得到用户确认。
- 不支持或证据不足时，Agent 要解释“为什么现在不能回答”和“需要什么数据/决定”，不能编造流程或结论。
- 结果交付同时提供新手摘要和技术详情；用户能逐层展开到参数、统计证据、产物和限制。
- `confidence` 只表示输入/设计/方法证据是否充分，不表示结果显著性或科学结论可信度；统计显著性必须来自真实结果表。
- HRT-0 记录提问轮数、用户采纳/修改推荐的次数、未解决问题和中途放弃点；不预设僵硬的提问数量上限，而是以“最少必要提问”持续优化。
- 命令行验证的目的只是获得数据结构和运行环境证据；它不能替代统计分析，也不能把临时输出直接当作最终 artifact。

### 3.4 聊天权限按钮与自动化边界

聊天数据框中的权限按钮可以成为用户理解和调整 Agent 自动化上限的入口，但它不能单独决定科学结论是否可靠。现有 `accessMode=read|full` 是安全/写权限边界，应继续保留；在其上增加面向用户的 `automationMode`：

| 用户看到的模式 | 内部值 | Agent 可以主动做什么 | 仍然必须确认/阻断什么 |
|---|---|---|---|
| 引导分析（推荐） | `guided` | 定位文件、索引、解释、提出方案、只读预检、整理结果 | 执行重任务、改变设计/参数、产生外部副作用 |
| 每步确认 | `confirm` | 准备并执行低风险的已确认步骤 | 每个写入、运行、修复、方法或参数变化 |
| 可信自动化 | `trusted` | 在任务设计明确、输入锁定且风险允许时自动连续执行 | 高影响科学判断、不可逆操作、证据不足 |

后端策略最终输出三种状态，而不是把三种状态都做成用户可选权限：

- `allow`（可自动完成）：由 `automationMode`、`accessMode`、工具副作用等级和 TaskSpec 未解决项共同计算。
- `confirm_required`（需要用户确认）：展示变更、风险、预计耗时/资源和可能失败类型后暂停。
- `cannot_reliably_answer`（当前无法可靠回答）：输入、设计、方法或工具能力不足时明确说明缺口；不能通过切换权限绕过。

决策函数必须是单向收紧的：权限越高只能扩大已证明安全的执行范围，不能替代分组、对照、配对、批次、统计单位等科学决策，也不能把缺失证据变成“可运行”。`read` 模式无论选择哪种 `automationMode` 都不得创建 Job；`full` 模式也必须经过 ScientificTaskSpec 的科学确认门。

现有权限入口和策略链为：`frontend/src/components/copilot/SimpleChat.tsx` → `frontend/src/components/copilot/copilotClient.ts` → `core/r-server/routes/ai-agent.js` → `core/r-server/agent-tools/agent-tool-policy.js` / `tool-execution.js`。实现时在这条链上增加 `automationMode` 和决策原因，不能绕过现有 `accessMode` 或另建一套执行器。

两层权限的组合语义固定如下：

| 文件/安全权限 | 自动化模式 | 允许范围 |
|---|---|---|
| `read` | 任意 | 只能索引、分析结构、解释和生成待确认计划，不创建 Job |
| `full` | `guided` | 可做低风险只读预检和准备；运行/写入仍需确认 |
| `full` | `confirm` | 每个有副作用的阶段逐步确认 |
| `full` | `trusted` | 仅对科学设计已确认、风险明确且可回滚的步骤自动连续执行 |

### 3.5 会话内终端与 Agent 命令执行

这里必须区分两个能力：

1. **用户终端**：当前项目工作台已经有 `BottomTerminal`、xterm.js、Electron `node-pty` 和 `terminal:session-*` IPC。用户可以在项目目录中手动打开交互式 shell；这属于 `W-07 集成终端` 与 `P-06 桌面集成`。
2. **Agent 终端工具**：`workspace_exec` 已按聊天权限工作；`full` 从项目目录启动通用 shell，`read` 禁止命令执行。`run_tool` 仍是正式 R/Python 科学分析和 Artifact 交付入口，通用 shell 不构成第二套结果真相。

Agent 命令执行的工程边界：

- 不把交互式 PTY 直接暴露给模型；Agent 调用的是结构化、非交互的 `workspace_command`（或等价工具），用户终端仍是人工通道。
- 命令默认从项目工作区启动并记录显式 `cwd`。完全访问模式不维护 executable/参数白名单，允许 shell、PATH、管道、重定向、脚本和机器上现有命令；超时与输出上限仅用于防止会话挂死和响应失控，不改变命令能力。
- `read` 始终禁止命令执行。`full` 表示能力授权，但 Agent 仍只能围绕用户当前任务行动；不能因为具有能力就擅自执行删除、发布、远程写入等与用户请求无关的操作。
- 生信分析不能绕过 `run_tool → tool_job → artifact truth` 直接用裸命令交付结果。复现脚本应通过受控 replay 入口运行，并把命令、输入、参数、运行时、stdout/stderr、退出码和产物绑定到现有 Job/Artifact Truth。
- 每次 Agent 命令都产生结构化 ToolResult/Trace；失败要区分拒绝、超时、退出码失败、运行时缺失、输入漂移和产物校验失败。

命令按用途分成四类，策略和证据等级不同：

| 命令类别 | 典型用途 | 默认策略 | 结果归宿 |
|---|---|---|---|
| 工作区结构探针 | 文件列表、`file`、表头/前 N 行、行列规模、编码、哈希 | `guided` 可自动执行，输出有界 | `inspection evidence`，绑定 TaskSpec/Trace，不创建分析 Job |
| 运行时探针 | R/Python 版本、插件 capability 是否就绪、固定检查脚本 | `guided` 可自动执行 | `runtime evidence`，进入 readiness 和确认摘要 |
| 复现/分析命令 | 执行已确认的 R/Python 脚本、生成图表/表格 | `confirm_required`；`trusted` 也受科学确认门约束 | 绑定 replay Job 与 Artifact Truth |
| 高影响命令 | 删除、覆盖、发布、网络、工作区外操作 | `read` 拒绝；`full` 具备执行能力，但必须有当前用户任务授权 | 记录 ToolResult/Trace；科学产物不能因此绕过 Job/Artifact Truth |

“临时验证”必须具备 `probeId`、command、cwd、输入路径/哈希、截断规则、执行时间、退出码和证据摘要；后续 Agent 只能引用这些证据，不得声称已经完成正式分析。若探针发现结构不确定，Harness 应转入 `requires_user_decision` 或 `cannot_reliably_answer`，而不是继续猜测。

因此，“会话内终端”可以成为 Harness 的执行适配器，但不是第二套分析执行器。目标体验是：Agent 在聊天中提出命令 → 展示作用域、风险和预计资源 → 按权限自动执行或等待确认 → 在会话中流式显示结果 → 将可交付产物回收到同一任务包。

### 3.6 常驻约束、按需激活

Harness 是所有 Agent 会话共享的工程约束层，但不是每条聊天消息都要进入完整科学任务工作流。必须区分“始终生效的底线”和“按场景激活的任务阶段”：

**所有会话始终生效：**

- project/conversation 作用域、敏感路径和凭据隔离。
- `accessMode`、`automationMode`、工具风险、确认与拒绝策略。
- 所有工具调用的 ToolResult/Trace、超时、输出上限和脱敏。
- Agent 不得把未执行的建议描述为完成，也不得把临时探针输出伪装成分析结果。

**只有在需要时激活：**

| 会话状态 | 典型场景 | Harness 行为 |
|---|---|---|
| `conversation` | 问概念、讨论方案、解释已有结果、普通交流 | 不创建 TaskSpec/Job，不主动运行命令；只保留基础安全约束 |
| `context_assist` | 用户问“这个文件是什么”“数据大概什么结构”“环境能不能跑” | 可按权限调用只读文件工具或命令行探针，形成 inspection/runtime evidence；仍不创建分析 Job |
| `task_draft` | 用户要求分析、出图、出表、生成报告或批量处理 | 创建/更新 ScientificTaskSpec，进入 inspect/infer/select/repair，副作用前确认 |
| `task_execute` | 科学设计和交付标准已确认 | 通过 `run_tool → tool_job → artifact truth` 执行、验证和交付 |
| `replay` | 用户要求复现某图、表、报告或脚本 | 验证输入/脚本/运行时，按权限确认后创建 replay Job 并校验 artifact |

Agent 可以根据用户意图把会话从 `conversation` 提升到 `context_assist` 或 `task_draft`，但不能仅因聊天框存在就自动扫描文件或启动命令。无副作用的 TaskSpec 草稿可以自动创建；进入 `task_execute`、写入、长命令或重放必须满足权限和科学确认门。任务完成、取消或回到一般讨论后，会话应退回 `conversation`，不把上一任务的执行授权无限延续。

### 3.7 会话上下文与精准文件操作

要达到 Codex 类“快速理解文件、准确定位、可靠修改”的体验，Harness 不能把整个会话和整个项目一次性塞给模型，而要维护一个分层、可失效、可追溯的上下文栈：

1. 当前用户消息和显式文件引用（最高优先级）。
2. 当前 conversation 最近原始消息；不得混入其他 conversation。
3. 当前 conversation 摘要、未解决问题和用户已确认决定。
4. 当前 ScientificTaskSpec、active plan、tool job、artifact 和文件锚点。
5. 项目资源摘要、增量文件索引和按需检索结果。
6. 经 `workspace_read` 获取的精确文件范围、行号和 SHA-256。
7. 项目长期事实/记忆（最低优先级，只作线索，不能覆盖当前磁盘证据）。

现有基础包括：项目作用域的 conversation/message 持久化、长对话摘要、项目上下文注入、`workspace_list/find/search/read/write/replace`、有界读取、SHA 前置条件、唯一文本匹配、dry-run、同进程目标锁和原子发布。新增设计必须复用这些能力，但要补齐以下缺口：

- conversation 摘要与项目长期事实分离；不同会话不能因共享项目摘要而互相继承临时指令、执行授权或未确认结论。
- 摘要、模型记忆和旧助手消息只能提供检索线索；文件内容、参数和状态一律以当前读取、数据库和 Artifact Truth 为准。
- 显式文件引用优先精确解析；未指定文件时按“索引 → 文件名/模式 → 文本搜索 → 候选排序 → 有界范围读取”逐步扩大，不先扫描全文。
- 每个送入模型的文件证据包含 projectId、相对路径、行范围、SHA-256、读取时间和截断状态；文件发生变化后旧证据立即失效。
- 工具结果继续做压缩和已读范围去重，但不能把被截断、未真正进入模型的内容标记为已读。

精准编辑固定采用以下协议：

```text
解析目标文件和修改意图
  → workspace_search/read 定位唯一范围
  → 保存 expectedSha256
  → dry-run 生成变更摘要
  → 非唯一、越界、敏感文件或 SHA 漂移立即阻断
  → 原子写入/精确替换
  → 重新读取修改范围并核对新 SHA
  → 运行与改动范围匹配的语法/测试/数据校验
  → ToolResult/Trace 记录前后哈希、验证结果和未完成项
```

小范围修改优先使用现有唯一片段替换。HRT-0 若证明多处或结构化修改无法由安全的唯一替换表达，才新增受控 `workspace_patch` 契约：每个文件携带 `expectedSha256`，先在内存完整应用并 dry-run，单文件所有 hunk 通过后才原子发布；没有真实夹具证据时不预建新工具。多文件操作不虚构跨文件原子性；以 edit manifest 逐文件记录 `planned/applied/verified/conflict/failed`，任一文件漂移即停止后续写入并明确报告部分完成状态。

这里不能承诺模型“永不出错”；工程验收目标是：错误文件、歧义定位、旧版本覆盖、用户并发修改、敏感路径和验证失败均被检测并阻断，任何未验证修改都不得声称成功。原始科学输入和已验证 artifact 默认只读；除非用户明确要求且生成新版本，否则 Agent 不得原地修改。

### 3.8 上下文预算与可恢复压缩

模型上下文达到上限时，Harness 不追求“摘要完全无损”——自然语言摘要本质上有损。工程目标是让有损压缩只影响叙述细节，关键事实始终保存在可验证、可回读的无损层。

上下文分成三类：

| 层级 | 保存内容 | 压缩策略 |
|---|---|---|
| 无损事实层 | 原始 conversation messages、ScientificTaskSpec、用户决定、未解决项、Plan、ToolResult/Trace、Job、Artifact manifest、edit/replay manifest | 不由模型摘要替代；持久化并按 ID/哈希回读 |
| 引用证据层 | 文件相对路径、行范围、SHA、输入/脚本/参数引用、原消息 ID、日志/结果路径 | 只压缩为引用；使用前重新读取并验证版本 |
| 有损叙述层 | 讨论过程、解释、备选思路、重复问答和长工具输出的阅读性描述 | 可以摘要、去重、裁剪；不得升级为事实真相 |

当前实现已经在长对话后生成摘要并保留近期消息，也会对 ToolResult 做投影、截断和已读范围去重；但固定“消息数量触发”不足以适配不同模型窗口，项目级摘要也不能替代 conversation 级状态。新设计改为预算驱动：

1. 根据当前模型上下文窗口预留 system/tool schema、当前请求、预期输出和安全余量。
2. 优先保留当前用户消息、最近原始消息、active TaskSpec/Plan、未解决决定和即将使用的文件证据。
3. 先将完整 ToolResult 替换为 traceId/callId、结构化结论和可回读引用，再压缩旧叙述。
4. 压缩前生成 `ContextCheckpoint`：记录来源消息范围、结构化决定、约束、文件/Job/Artifact 引用和摘要版本。
5. 对 checkpoint 做完整性校验；缺失关键决定、否定约束、未解决项、失败状态或引用目标时，拒绝切换到压缩上下文。
6. 模型后续需要精确措辞、参数、代码或历史理由时，按 messageId/traceId/path+hash 回读原始来源，不让模型凭摘要补全。
7. 更换模型或上下文窗口后，从无损事实层重新构建 ContextEnvelope，不级联总结旧摘要，避免多轮摘要逐渐漂移。

压缩优先级固定为：去除重复投影 → 把大工具输出替换为引用 → 归档已结束的旧任务 → 摘要较早叙述 → 最后才缩短近期非关键消息。以下内容禁止仅存在于摘要：用户明确的“不要/必须”、分组/对照/统计单位、最终参数、接受/拒绝的方案、尚未回答的问题、文件版本、执行/失败状态、权限授权和交付标准。

上下文压缩后，Agent 必须知道自己看到的是摘要还是原文。回答涉及精确事实时，如果当前只有摘要引用，就先回读来源；无法回读时明确标为“未重新验证”，不能用流畅语言掩盖信息缺口。

### 3.9 模型切换稳定性

模型可能在任意两轮会话之间切换，因此压缩不能依赖某个聊天模型的记忆方式、tokenizer 或自由文本输出。Harness 需要提供模型无关的 Context Budget/Checkpoint 服务：

- 每次 Agent turn 启动时固定本轮 model/profile；流式回答进行中切换设置只影响下一轮，不能把一个 turn 中途迁移到另一个模型。
- Model Gateway 提供模型能力快照：上下文窗口、最大输出、tool calling/vision 能力和估算器版本。缺少可信窗口声明时使用保守预算，不猜测超大上下文。
- TaskSpec、决定、约束、Plan、Trace、Job、Artifact 和文件引用由确定性代码从数据库/manifest 组装；不让当前模型重新“总结”这些关键字段。
- summary 角色模型只生成有损叙述层；其输出必须通过 schema、来源覆盖、否定约束、未解决项和引用存在性校验。summary 模型不可用或校验失败时，回退为更多近期原文 + 更少非关键工具输出，而不是静默丢弃内容。
- 从大窗口模型切到小窗口模型时，重新从原始消息和最新 checkpoint 构建最小充分 ContextEnvelope；从小窗口切回大窗口时也不沿用被过度压缩的文本，可恢复更多原文证据。
- checkpoint 记录 `policyVersion`、来源 digest、生成模型/规则版本和质量检查；模型输出不同可以接受，结构化决定、约束、状态和引用必须等价。
- 如果当前模型连“最小关键上下文 + 当前问题 + 安全输出预留”都无法容纳，Harness 返回 `context_capacity_insufficient`，建议切换更大窗口或拆分任务，不能继续截断关键状态。

模型切换流程固定为：结束/取消当前 turn → 读取新模型能力 → 校验原始来源与 checkpoint → 重算预算 → 重建 ContextEnvelope → 完整性 gate → 开始下一轮。切换本身不修改 TaskSpec、执行授权、Job 或 Artifact Truth。

### 3.10 会话持久化、审计与删除边界

“会话内容全部保留”不能理解为把模型内部推理、文件正文、完整终端输出和每个流式 token 永久复制进数据库。Harness 只持久化用户可见内容和可审计执行事实，并按来源保存或引用：

| 内容 | 持久化位置 | 策略 |
|---|---|---|
| 用户消息、助手最终回复 | SQLite conversation/messages | 保留原文、messageId、角色、时间和必要 meta；受单条大小/隐私限制 |
| 模型私有 chain-of-thought | 不获取、不保存 | 不作为产品能力；用结构化计划、决策原因和工具活动替代审计需求 |
| 流式 delta | task event 临时回放层 | 只用于断线续传/后台任务；任务结束后可合并为最终消息，不把 token 副本无限保留 |
| 工具调用、参数摘要、确认/拒绝、状态、耗时、退出原因 | SQLite ToolResult/Trace/interaction ledger | 脱敏、结构化持久化；大结果保存引用和摘要，不复制敏感正文 |
| 完整工具/命令 stdout、stderr、运行日志 | Job/项目磁盘日志 | 数据库只保存路径、哈希、大小、截断和状态；日志按任务保留策略管理 |
| TaskSpec、ContextCheckpoint、Plan、用户决定 | SQLite 或项目任务包中的版本化结构对象 | 长期可回读，不依赖自然语言摘要 |
| 图、表、报告、脚本和 artifact manifest | 项目结果目录/Job 目录 | 文件在磁盘；数据库保存 Job/Artifact identity、路径、哈希、Truth 和 lineage |
| 原始科学数据 | 用户项目工作区 | 默认不复制进聊天数据库；只记录受授权的相对路径、哈希和结构摘要 |
| 摘要、向量、抽取事实 | 独立派生表 | 标记来源和 scope，可重建；不得覆盖原始消息或磁盘事实 |

当前实现已把 `copilot_conversations` / `copilot_messages`、Agent `tasks` / `task_events` 和分析 `tool_jobs` 分开；用户和助手的最终可见消息会写入 SQLite，Agent task 事件可用于 SSE 回放。当前 `toolTraceStore` 仍是进程内短期存储（默认 200 条、约 15 分钟），因此不能把它宣称为永久审计真相；HRT 实现需要把必须长期审计的 ToolResult/Trace 字段收敛到持久 ledger，而大正文继续留在日志/Artifact 文件中。

删除和保留规则必须明确：

- 删除 conversation 时级联删除该会话消息、conversation checkpoint、向量/派生事实和只服务于回放的 task events。
- 已产生的科学 `tool_job`、artifact 和任务交付包不随聊天删除，除非用户在结果/项目层另行明确删除；删除聊天不能破坏执行真相。
- 归档 conversation 只停止默认注入，不删除原文；恢复后可重新构建上下文。
- 密钥、Authorization、`.biof3-secrets`、完整 Provider 请求/响应、模型私有推理和未经必要性证明的大块用户数据禁止入库。
- 数据库写入失败、消息被大小限制截断、事件只在临时层或来源不可回读时必须有可见状态，不能声称“完整保存”。

### 3.11 历史重开、长期记忆与耐久恢复

“永久性记忆”在本地软件中必须拆成三个可验收目标，而不是承诺单机磁盘永不损坏：

1. **历史可重开**：重新打开软件后，按 `projectId/conversationId` 读取消息、ContextCheckpoint、TaskSpec、Plan、Job、Artifact 和交付清单；无法回读的部分明确标记，不用摘要补写。
2. **新需求可启动**：新建 conversation 或明确切换任务时，继承项目范围和可复用事实，但不继承上一任务的临时授权、未确认决定、旧文件证据或运行状态。
3. **长期记忆可恢复**：原始消息、结构化决定、任务包和结果 manifest 有版本、哈希、迁移和备份/导出路径；派生摘要和向量可以重建，不能成为唯一副本。

耐久链应包含：SQLite WAL/事务写入 → schema migration 版本 → 定期本地备份或用户导出任务包 → manifest/数据库完整性校验 → 启动时恢复检查。数据库损坏、任务目录缺失、版本迁移失败或备份过期时，软件必须进入 `recovery_required`/`partial_history` 状态并给出可操作修复路径；不能把空白会话显示成“历史不存在”，也不能把恢复失败伪装成正常新会话。

### 3.12 Harness 基础工具与快速定位算法

Harness Core 的基础工具不是每个生信算法，而是围绕“找到证据、确认边界、调用正式工具”的确定性能力：

| 工具层 | 当前/计划能力 | 主要算法或约束 |
|---|---|---|
| 工作区导航 | `workspace_list`、`workspace_find` | 相对路径、glob、深度/文件数上限、跳过生成目录和敏感路径 |
| 文本定位 | `workspace_search` | 有界递归扫描、文件模式过滤、大小/二进制跳过、行号和结果上限 |
| 精确读取 | `workspace_read` | 分段读取、最大行数/字节数、SHA-256、截断标记 |
| 安全编辑 | `workspace_write`、`workspace_replace`（必要时再评估 `workspace_patch`） | expected SHA、唯一匹配、dry-run、原子写入、冲突阻断 |
| 数据结构探针 | `npm run harness:index` / `harness-file-index.mjs` | CSV/TSV/JSON/文本/二进制识别、采样表头/样例、列类型/缺失值、角色和矩阵方向粗判、缓存与增量更新 |
| 结构化资源 | `query`、`read_page`、`search` | project/dataset/job/plugin 范围查询和内容插件检索 |
| 工作流控制 | `plan`、`run_tool(list/plan/status/next/bind_artifact/run)` | 真实 tool manifest、步骤依赖、确认门、Job/Artifact lineage |
| 命令执行 | `workspace_exec`：`full` 通用 shell、`read` 禁止 | 项目 cwd、超时、输出上限、ToolResult/Trace；正式结果不绕过科学分析执行器 |

快速定位的默认顺序是：显式路径或文件引用 → active file/artifact → 增量索引 → 文件名/glob → 文本/列名搜索 → 候选排序 → 读取最小充分范围。大文件优先采样和哈希，未变化文件复用 `.biof3-harness-index.json`，不把全量正文塞进模型。当前实现主要是确定性启发式和有界扫描，不是完整语义代码搜索；如果 HRT-0 证据表明列名/任务语义需要语义召回，再增加带来源引用的 embedding/rerank，不能用不可解释的相似度替代路径、哈希和行号证据。

### 3.13 Token 成本与缓存策略

缓存可以降低重复输入的处理成本，但不能把旧答案直接当成新答案。Harness 采用三层缓存，并把命中与质量分开验收：

| 缓存层 | 缓存内容 | 命中条件 | 质量边界 |
|---|---|---|---|
| Provider prompt cache | 稳定 system 前缀、工具 schema、未变化的上下文前缀 | 供应商、模型、profile、前缀哈希和 TTL 均一致 | 只是复用相同输入 token 的处理，不改变模型输入；厂商不支持时透明回退 |
| BioF3 本地证据缓存 | 文件索引、结构探针、query/read_page 只读结果、embedding、ContextEnvelope 片段 | project scope、输入/文件 SHA、参数、权限、插件/规则版本一致 | 文件或设计变化立即失效；返回必须带 source/hash/createdAt，不缓存成无来源结论 |
| 任务/结果缓存 | 已完成 replay 或确定性工具的 artifact 引用 | tool/plugin/runtime 版本、TaskSpec、输入哈希、参数、seed 和执行策略完全一致 | 只能复用已验证 Artifact；有副作用、随机性或环境漂移时重新确认/运行 |

缓存 key 至少包括：`projectId`、`conversationId`（仅会话级内容）、`modelProfileId`、模型能力快照、system/tool schema hash、TaskSpec/Checkpoint hash、输入文件 hash、规范化参数、权限模式、插件/runtime 版本和 policy 版本。不能把一个项目、一个用户或一个模型的缓存跨作用域混用。

缓存失效条件包括：文件内容/路径变化、用户纠正决定、TaskSpec/Plan/参数变化、模型/provider/profile 切换、system prompt 或 tool schema 变化、插件/runtime 升级、权限/自动化模式变化、Artifact Truth 变化和 TTL 到期。模型切换后不能假设 Provider cache 可复用；只能重新计算是否命中。

当前 provider 协议已经能规范化 `cacheRead/cacheCreation` 字段，但 AI usage 持久化和成本估算尚未完整记录这些字段；HRT 实现需要把 input/output/cache-read/cache-create、命中原因、缓存层、延迟和估算成本写入 usage ledger。缓存命中率不能用“少调用了一次模型”估算，必须以供应商 usage 和本地缓存审计为准。

缓存质量门禁：命中返回原始 source/hash/版本，命中后仍通过权限和 Artifact Truth 校验；发现 stale、冲突、无法证明等价或缓存服务异常时，宁可重新读取/调用并增加成本，也不返回可能过期的内容。缓存只能优化成本和延迟，不能降低证据标准、确认门或结果验证标准。

### 3.14 用量、成本与机器资源的模块归类

这两个需求与 Harness 有接口，但不应全部塞进 Harness Core：

| 需求 | 主模块 | Harness 的关系 |
|---|---|---|
| Token/input-output/cache 命中、估算成本、按模型/Provider/项目/会话查看 | `P-07 Model Gateway` + 设置/治理 UI | 提供模型调用预算、缓存命中和成本证据；不负责科学任务状态 |
| CPU、内存、磁盘、运行时、Job 资源峰值和 GPU（可用时） | `P-05 Runtime & Adapters` + `P-06 Desktop Integration` + 设置/计算 UI | 提供运行时能力快照、资源预检和 Job 资源引用；不把监控采样混进 Artifact Truth |
| 什么时候提示、确认、阻断或建议缩小任务 | `P-03 Harness` | 消费上述能力快照，形成可解释的资源决策 |

设置页建议提供一个“用量与资源”入口，至少展示：

- AI 用量：时间范围、Provider、模型、输入/输出/cache-read/cache-create tokens、调用次数、失败次数、延迟、估算成本和缓存命中率。
- 成本口径：区分供应商真实 usage、估算价格、未知价格和本地缓存节省；价格缺失时显示 `cost_unknown`，不伪造金额。
- 本机资源：CPU、可用内存/峰值内存、磁盘空间、R/Python 运行时就绪状态、活跃 Job；GPU 只在 adapter 能可靠探测时显示。
- 任务关联：某个会话、TaskSpec、Job 消耗了多少 token/时间/资源；原始数据和密钥不进入用量面板。

资源监控应采用低频采样和 Job 生命周期采集：UI 约 5–10 秒刷新概览，Job 开始/结束记录运行时、峰值内存、退出原因和可选 CPU/IO/GPU 摘要；不为监控本身持续启动重进程。采样数据用于趋势和资源诊断，不冒充科学结果。

Harness 的资源前置检查必须区分科学不确定和机器容量不足：

- `resource_ready`：可以按计划运行。
- `resource_warning`：可运行但需向用户说明预计耗时/内存/磁盘和降级方案。
- `resource_unavailable`：运行时缺失、磁盘不足或预计必然 OOM；暂停并给出缩小数据、安装能力或换机器的选择。

`resource_unavailable` 不应伪装成 `cannot_reliably_answer`；后者表示科学证据/方法不足。任何资源提示都不能绕过用户确认、权限策略或 `run_tool → tool_job → artifact truth`。

资源监控的 UI 采用“实时摘要 + 可展开详情”而不是把监控日志塞进聊天正文：

- 全局/设置页显示当前机器资源状态芯片：`资源正常`、`需要注意`、`资源不足`，点击后查看 CPU、可用内存、磁盘、runtime 和活跃 Job。
- TaskSpec 确认卡显示“预计资源 vs 当前资源”：预计内存/CPU/磁盘/耗时、当前可用值、数据规模依据和降级选项；确认前刷新一次快照，长任务运行中按低频采样更新。
- Agent 会话的 Harness 摘要只显示短状态和 `resourceSnapshotRef`，例如“当前内存可用 12.4 GB，预计任务需 8 GB”；详细时序、峰值和诊断放到 Job 详情。
- 资源摘要必须有 `observedAt`、`expiresAt` 和来源；超过 TTL 的数字显示为“需刷新”，不能继续当作实时事实。
- 长期 ContextCheckpoint/会话记忆不保存不断变化的 CPU 百分比；只保存任务确认时快照、Job 实际峰值和异常事件的引用，避免过期资源数字污染长期记忆。

建议的资源摘要结构：

```json
{
  "status": "resource_warning",
  "resourceSnapshotRef": "rs_xxx",
  "observedAt": "...",
  "expiresAt": "...",
  "available": { "memoryBytes": 0, "diskBytes": 0, "cpuLoad": 0.0 },
  "estimate": { "memoryBytes": 0, "durationSeconds": 0, "basis": "input_schema" },
  "message": "预计任务可运行，但建议关闭其他高内存任务"
}
```

实时摘要是可读性优化，不改变资源事实来源；确认卡、Agent 决策、Job manifest 和设置页必须引用同一份 snapshot/peak 数据。

### 3.15 生信分析内容的组合架构

一个科学需求通常不是一次工具调用，而是从模糊问题逐步形成证据链：

```text
用户问题
  → 可检验的科学主张/论据目标
  → 证据计划（需要哪些比较、质量检查和替代解释）
  → 分析模块 DAG
  → 插件执行与 Artifact Truth
  → 证据记录（事实、假设、诊断、不确定性）
  → 论据/报告/限制
```

因此“多个分析需求产出一个论据”的方向是对的，但 Harness 不应把多个结果简单拼成结论。每个论据必须指向一个或多个真实证据 artifact，并保留支持条件、统计事实、替代解释和限制；论据是 evidence graph 的投影，不是模型根据图表自由编写的故事。

#### 插件的最小单位

插件的最小单位应是**可独立验证、具有稳定输入/输出契约的科学分析模块**，而不是：

- 一个 R/Python 包函数（包属于 runtime capability bundle）。
- 一个过于细碎的语法步骤（如单独的 `filter()` 或 `scale()`）。
- 一个只为某个用户问题临时拼出的全流程。

一个合格模块至少能说明：

- 解决什么科学子问题，适用前提和不适用情况。
- 输入数据 schema、分析单位、必需列/维度和质量门槛。
- 参数 schema、默认值、哪些参数必须用户确认。
- 使用的 runtime、包/capability 版本和随机种子策略。
- 产生哪些标准化 artifact、diagnostics 和 evidence records。
- 失败模式、资源预估、可否重试和可否接入下游。
- 独立 fixture、独立脚本入口和可重放命令。

插件可以内部编排多个 R/Python 包，只要对外仍是一个科学模块契约。模块之间通过 verified artifact 和明确的 lineage 连接，不通过聊天文本或未声明的临时文件传递状态。

#### 四层内容模型

| 层级 | 责任 | 示例 |
|---|---|---|
| Runtime capability | 提供语言、包和系统能力，不表达用户意图 | R、DESeq2、limma、ComplexHeatmap、scanpy |
| Analysis module/plugin | 一个可验证科学子问题和标准产物 | count matrix QC、DE model、volcano plot、GO enrichment |
| Workflow/task pack | 按设计和证据目标组合模块 DAG | bulk RNA-seq 差异表达证据链、单细胞 marker 证据链 |
| Evidence/delivery pack | 将多个 artifact 转成可审阅论据和报告 | 统计事实、图表、方法、限制、复现脚本 |

例如一个 bulk RNA-seq 任务可以组合：文件/样本结构检查 → count/metadata QC → 设计与 contrast 确认 → DE 模型 → QC/诊断 → 结果表 → volcano/heatmap → enrichment → 报告。这里 DE 模型是一个核心分析模块；火山图是消费已验证结果表的可复用展示模块；DESeq2、limma 和绘图库是 capability，不应分别变成用户可见的需求插件。

#### 组合规则

- 模块输入优先引用已验证 artifact；下游不能直接猜测上游文件或重新扫描出另一份结果。
- 模块输出必须有 schema、artifact manifest、诊断和 evidence type；“图很好看”不是有效输出契约。
- 同一模块可以被不同 task pack 复用；task pack 负责领域设计、模块顺序、确认门和论据覆盖，而不是复制脚本。
- 新增科学能力优先新增模块/manifest/fixture，不修改 Harness Core 的阶段逻辑；只有跨领域的证据、状态、权限和交付规则进入 Harness。
- 一个模块应保持足够大，能独立解释和验证；如果拆分后每个节点没有独立科学意义、契约或测试价值，就不应继续拆成插件。
- 一个复杂模块可以内部有多个脚本步骤，但必须在一个 Job 内保留 step、参数、日志和 artifact lineage；跨模块组合则由 workflow/task pack 管理。

#### 完整任务的串联脚本与 DAG 执行

完整科学任务会有一个可复现的**串联执行描述**，但不把所有 R 代码拼成一个不可维护的超级脚本。推荐分成三层：

1. `TaskSpec`：说明用户要回答的科学问题、输入快照、设计、确认决定和交付标准。
2. `Workflow/Task Pack`：保存 DAG、模块版本、依赖关系、输入/输出 artifact 类型、确认门、失败恢复和资源估计；它调用现有 `run_tool → tool_job → artifact truth`，不创建第二套执行器。
3. `Replay Manifest`：由一次真实运行生成，记录每个 step 的实际脚本快照、参数、输入/输出 hash、Job ID、运行时和重放命令。需要导出时可以生成一个顺序执行的 wrapper，但 wrapper 只能调用受控 replay 入口，不能绕过确认门直接执行裸 shell。

示意结构：

```text
task-spec.json
workflow-plan.json       # DAG 的声明和确认状态
steps/
  01-metadata-validator/ # 插件脚本快照 + 输入/输出 manifest
  02-expression-qc/
  03-deseq2/
  04-deg-standardizer/
  05-go-kegg/
replay.json              # 实际 Job/Artifact lineage 和逐步重放命令
replay/reproduce.mjs     # 可选的受控串联入口
```

因此：插件脚本是最小科学计算单元，DAG 是任务级串联脚本/计划，`replay.json` 是本次运行的事实。用户修改一个图时只重放受影响的 step；输入、参数或环境变化时从第一个失效节点重新确认，不能整条链静默复用旧结果。

#### 长任务的摘要卡片

长任务不应把完整日志或每个工具调用堆进聊天正文。摘要卡片是 DAG 的可读投影，首屏只显示：

```text
任务标题 · 当前状态 · 已完成/总步骤
当前步骤：DESeq2 差异模型
下一步：等待确认 / 运行中 / 可查看结果
证据：已验证 Artifact 数量 · 阻断原因（如有）
资源：resourceSnapshotRef + 短状态（过期则提示刷新）
```

展开后显示步骤轨道：每个节点的状态、耗时、输入/输出 Artifact、确认门和失败恢复；再展开才进入参数、脚本快照、日志摘要和复现入口。完整 stdout/stderr、时间序列资源和大表仍放在 Job/Artifact 详情，不复制进摘要上下文。

摘要卡片必须引用同一个 `workflowPlanRef`、`taskSpecHash`、`resourceSnapshotRef` 和当前 Job/Artifact Truth；它是展示层，不是工作流事实源。关闭/重开会话时重新从这些结构化对象投影，不能依赖聊天里的一段长摘要恢复任务。

#### 中断后的续跑规则

长任务可以续上，但续跑不是简单地从“上次聊天最后一句”继续，而是从持久化的 DAG、Job 和 Artifact Truth 恢复：

| 中断状态 | 恢复动作 |
|---|---|
| 已确认但尚未创建 Job | 回到确认后的第一个 ready step，不重复询问已确认决定 |
| `queued` / `running` 且进程异常退出 | 先 reconcile 当前 Job/输出目录；不能证明退出状态时标为 `recovery_required`，禁止盲目再开一个 Job |
| Job `completed` 且 Artifact Truth `valid` | 保留并跳过该 step，下游继续绑定原 Artifact |
| Job `completed` 但 `degraded`/`blocked` | 停在 verify，显示诊断，修复或用户确认后再继续 |
| Job `failed` / `cancelled` | 只能走带确认的 `retry_run`，新 Job 记录 parentJob/recovery history |
| 下游 step 尚未运行 | 由依赖满足情况重新计算 `readyStepIds` |

续跑必须满足：TaskSpec hash、输入快照 hash、插件/runtime/capability 版本和权限边界仍匹配。任何一个变化都要从第一个受影响 step 重新确认；不能把旧 Artifact 当成新环境的结果。摘要卡片显示“已恢复 N/M 步、从哪个 step 继续、哪些 step 被跳过及原因”，并提供“继续 / 查看差异 / 重新确认 / 停止”动作。

当前已有 `projectWorkflowPlan().resumeFromStepId`、`retry_run` 和 `reconcile_artifacts` 的基础投影与校验；服务重启后 Agent loop 会先标记中断，科学任务的完整跨重启自动恢复仍属于后续持久化恢复工作包，不能在当前摘要中宣称已经自动续跑。

#### 任务永久性不变量

用户没有主动执行删除/清理之前，以下对象不得自动消失：conversation、原始 messages、TaskSpec 版本、ContextCheckpoint、Workflow Plan、tool_job、Artifact manifest、结果目录和 replay/provenance。关机、应用崩溃、模型切换、上下文压缩、缓存失效或服务重启只能改变状态为 `recovery_required`/`failed`/`partial_history` 并保留原因与来源，不能删除事实。

自动清理只允许作用于明确标记的临时目录、过期缓存和可重建派生物；不能作用于 canonical Job/Artifact 结果。用户主动删除会话时，删除范围必须显式展示：可删除派生摘要/向量/Checkpoint，不能连带删除科学 Job/Artifact，除非用户另行确认“同时删除分析结果”。

HRT-0 的插件开发样板固定在 [`acceptance/harness-plugin-prototype`](../acceptance/harness-plugin-prototype)。它以排序基因 GO-BP 富集为例，展示 `plugin.json`、`tool-definition.json`、`environment.json`、R 脚本、demo input 和 `acceptance.json` 的最小闭环。后续智能体开发新模块时，应先复制该目录，再替换科学语义；不得从空目录自由发明依赖安装、产物命名或验收方式。

插件环境分成三种证据：

1. **声明证据**：`plugin.json`/`environment.json` 说明需要哪些 R 包、runtime 和 capability bundle。
2. **准备证据**：Harness readiness/provisioning 记录 bundle 来源、版本、SHA-256、安装目录和实际挂载的 `R_LIBS_USER`；脚本禁止 `install.packages()`、`BiocManager::install()` 或运行期联网。
3. **运行证据**：每次 Job 的 `artifact-manifest.json` 记录脚本 digest、规范化参数、输入文件 hash、R/包版本、命令和产物 hash。

脚本快照是可交付内容，不是临时日志：本地执行器当前会把插件源脚本复制为 Job 目录的 `run-script.R`/`run-script.py`，后续应由 Delivery Manifest 提供“导出复现包”入口。历史 Job 的脚本快照只读且不可被新修改覆盖；任何 Agent 二次修改都生成新的脚本 hash、参数 hash、parent artifact/job 引用和新结果。这样用户可以看到“原代码是什么”，也能准确比较修改前后差异。

跨平台采用“源码复用、环境分平台”的策略：脚本和工具契约尽量共享，runtime、原生 R/Python 包、capability bundle 和安装包按 `macos-arm64`、`macos-x64`、`windows-x64`、`linux-x64` 分别声明和校验。没有该平台的可验证 artifact 时必须阻断并报告 `platform_not_supported`，不允许静默使用其他平台包。当前 HRT-0/HRT-1 先验收 macOS 版本，其他平台进入后续平台矩阵。

因此，“临时分析环境搭建”不是插件作者在 R 脚本里临时解决的问题，而是 Harness 的 capability provisioning + readiness gate。插件只声明科学依赖并消费已经准备好的环境；缺包时返回结构化 `runtime_not_ready`，不偷偷降级或安装。

## 4. 任务契约

### 4.1 `ScientificTaskSpec v1`

运行前必须产生并经用户确认的结构化对象，至少包含：

```json
{
  "schemaVersion": 1,
  "taskId": "st_xxx",
  "projectId": "p_xxx",
  "conversationId": "c_xxx",
  "originalRequest": "用户原始需求",
  "question": {
    "domain": "transcriptomics",
    "analysisUnit": "biological_sample",
    "questionType": "differential_expression"
  },
  "inputs": [
    {
      "relativePath": "data/counts.csv",
      "sha256": "...",
      "sizeBytes": 0,
      "schemaSummary": {}
    }
  ],
  "design": {
    "groups": [],
    "contrast": {},
    "covariates": [],
    "replicates": {},
    "assumptions": [],
    "unresolved": []
  },
  "method": {
    "category": "differential_expression",
    "candidateToolIds": [],
    "selectionReason": ""
  },
  "requestedDeliverables": [],
  "acceptanceCriteria": [],
  "requiresUserDecision": [],
  "clarification": {
    "questionsAsked": [],
    "confidence": "unknown",
    "userDecisions": []
  },
  "execution": {
    "accessMode": "read",
    "automationMode": "guided",
    "decisionPolicyVersion": 1,
    "resourcePolicyVersion": 1,
    "resourceSnapshotRef": null
  },
  "presentation": {
    "language": "zh-CN",
    "explanationLevel": "guided"
  },
  "status": "draft"
}
```

绝对路径只允许作为内部执行上下文；任务契约和交付证据优先使用项目相对路径与哈希，确保换机器后仍能定位输入。

### 4.2 `RunManifest v1`

由 Verify 阶段从真实 Job 和磁盘结果生成，至少包含：

- `taskId`、`taskSpecHash`、`projectId`、`toolJobId`。
- 工具 ID、插件版本、语言、运行时版本、平台。
- 最终确认的 `params_json`、随机种子和输入快照哈希。
- 状态、开始/结束时间、退出信息、重试/修复历史。
- `artifactSchemaVersion`、标准化 artifacts、每个产物的大小和 SHA-256。
- `artifactTruth`、`artifactDiagnostics`、lineage 和日志摘要。

### 4.3 `DeliveryManifest v1`

面向用户和其他智能体的交付索引，至少包含：

- 需求是否逐项满足。
- 统计事实、科学解释、趋势判断和限制性结论的分层结果。
- 报告、表格、图、日志和 ZIP 的稳定项目内路径。
- Artifact Truth 是否为 `valid`；`degraded` 必须明确展示，`blocked` 禁止交付为成功。
- 复现入口、环境要求、随机种子或数值容差。
- 未解决问题和需要用户继续确认的事项。

### 4.4 `ArtifactProvenance v1`

每个图、表、报告或导出文件都要在 artifact manifest 中携带可复现信息。最低结构如下：

```json
{
  "artifactId": "art_volcano_plot",
  "type": "plot",
  "producer": { "toolId": "de-plugin", "pluginVersion": "1.2.0", "toolJobId": "job_xxx" },
  "reproducibility": {
    "status": "available",
    "scriptPath": "repro/scripts/art_volcano_plot.R",
    "scriptSha256": "...",
    "language": "r",
    "entrypoint": "main",
    "inputRefs": [{ "relativePath": "data/counts.csv", "sha256": "..." }],
    "paramsHash": "...",
    "runtime": { "version": "", "capabilityBundle": "" },
    "replay": { "command": "", "workingDir": "", "seed": null, "tolerance": null }
  }
}
```

`available` 只表示本次实际运行的脚本已快照并可导出；在受控 fixture 或等价环境重放通过后才能升级为 `verified`。无法生成或验证时必须为 `unavailable` 并给出原因。共享预处理脚本可以被多个 artifact 引用，但每个 artifact 必须有直接入口或显式依赖链，且脚本快照、输入哈希和参数必须对应本次 Job，不能只链接到会变化的插件源码。

### 4.5 `ConversationContextEnvelope v1`

每轮 Agent 调用构建临时上下文信封，不把其作为第二份会话数据库。最低结构：

```json
{
  "schemaVersion": 1,
  "projectId": "p_xxx",
  "conversationId": "c_xxx",
  "interactionMode": "conversation",
  "currentIntent": "",
  "explicitFileRefs": [],
  "recentMessageIds": [],
  "conversationSummaryRef": null,
  "taskRef": null,
  "activePlanRef": null,
  "activeJobRef": null,
  "activeArtifactRef": null,
  "unresolvedDecisions": [],
  "evidence": [
    {
      "source": "workspace_read",
      "relativePath": "scripts/analysis.R",
      "startLine": 1,
      "endLine": 120,
      "sha256": "...",
      "capturedAt": "...",
      "truncated": false
    }
  ],
  "modelContext": {
    "profileId": "model_profile_xxx",
    "contextWindow": 0,
    "maxOutput": 0,
    "capabilitySnapshotHash": "...",
    "estimatorVersion": 1
  },
  "contextBudget": { "maxUnits": 0, "usedUnits": 0, "reservedOutput": 0, "safetyMargin": 0 },
  "accessMode": "read",
  "automationMode": "guided"
}
```

信封在每轮请求时从真实 conversation、项目索引、TaskSpec、Job/Artifact Truth 和按需文件读取重建。它可以缓存，但项目、会话、文件哈希或 active task 变化时必须失效；不得把旧信封作为事实源长期保存。

### 4.6 `ContextCheckpoint v1`

每次压缩产生版本化 checkpoint，至少包含：

```json
{
  "schemaVersion": 1,
  "checkpointId": "ctxcp_xxx",
  "projectId": "p_xxx",
  "conversationId": "c_xxx",
  "sourceMessageRange": { "firstId": "msg_a", "lastId": "msg_z", "count": 0 },
  "sourceDigest": "...",
  "policyVersion": 1,
  "generatedBy": { "mode": "deterministic+summary", "modelProfileId": null, "rulesVersion": 1 },
  "summary": "仅用于叙述线索的摘要",
  "taskRefs": [],
  "confirmedDecisions": [],
  "rejectedOptions": [],
  "unresolvedDecisions": [],
  "constraints": [],
  "evidenceRefs": [],
  "toolTraceRefs": [],
  "jobRefs": [],
  "artifactRefs": [],
  "editManifestRefs": [],
  "supersedes": null,
  "coverage": { "requiredFieldsPresent": true, "missing": [] },
  "createdAt": "..."
}
```

`sourceDigest` 对原消息 ID、角色和内容哈希的规范化列表生成，不复制敏感正文。checkpoint 可以被新版本取代，但不能覆盖或删除原始消息；用户纠正早期决定时，新增 superseding decision/checkpoint，并明确旧决定已失效。

## 5. 工作包与执行顺序

所有子包独立提交；每个提交只服务一个主模块，不混入 UI 美化、Provider 扩展或新分析流程。

### HRT-0：真实任务基线与评测夹具

主模块：`P-03`；状态：`complete`（2026-07-22，24/24 离线基线检查通过；已知产品缺口保留）

目标：从真实使用中选出至少 3 个代表任务，不先写抽象功能。

任务覆盖要求：

1. 一个模糊需求 → 需求澄清 → 标准分析 → 结果交付。
2. 一个多步骤任务 → 上游产物验证 → 下游绑定 → 最终报告。
3. 一个失败或歧义任务 → 阻断/修复/用户决策，不允许静默猜测。
4. 至少一条任务由没有生信背景的用户只用自然语言发起，不要求用户先知道文件路径、工具名或统计术语。
5. Agent 必须先用通俗语言展示“我发现了什么、准备怎么做、还缺什么”，再进入确认门。
6. 对同一任务分别验证 `guided`、`confirm` 和 `trusted` 的边界；验证聊天权限按钮只改变自动化上限，不会把 `cannot_reliably_answer` 变成可执行。
7. 至少记录一条“权限足够但科学证据不足”的任务，作为 `cannot_reliably_answer` 基线。
8. 记录一条 Agent 需要读取工作区/检查运行时/重放脚本的命令行场景，明确哪些命令自动执行、哪些命令必须确认、哪些命令拒绝。
9. 至少包含一条“文件扩展名与实际内容不一致”或“表头/样本结构不明确”的任务，验证 Agent 先用受控探针获取证据，再决定提问或阻断。
10. 增加非任务会话与轻量上下文辅助夹具：普通问答不得误创建 TaskSpec/Job；只有在回答确实需要项目证据时才进入 `context_assist` 并调用只读探针。
11. 增加精准文件操作夹具：显式文件引用、同名文件歧义、唯一片段替换、重复片段拒绝、读取后并发漂移、长会话换题和多文件部分失败。
12. 在小型真实夹具和大型合成文件树上分别记录冷启动/热索引的文件定位与首个有效证据耗时；HRT-0 先建立 p50/p95 基线，再冻结后续性能门槛，不凭感觉写死毫秒目标。
13. 增加多轮压缩夹具：早期关键否定约束、后续纠正、未解决问题、文件引用、工具失败和跨任务切换在至少两次 checkpoint 后仍可恢复；精确问题必须回读原消息/Trace，而不是复述摘要猜测。
14. 增加模型窗口切换夹具：大窗口 → 小窗口 → 大窗口、summary 角色不可用、能力声明缺失和最小关键上下文放不下；验证重建、保守回退或 `context_capacity_insufficient`，不得静默截断。
15. 验证会话保留/归档/删除：可见消息、checkpoint、派生向量、task event 的级联范围正确；科学 Job/Artifact 不因删除聊天而失去执行真相；私有推理和密钥不进入持久层。
16. 验证关闭/重启/新建会话/切换项目后的历史重开、旧授权隔离、任务包读取和损坏/缺失文件恢复提示；同时在不同规模 workspace 上验证基础工具定位和增量索引命中。
17. 在重复询问、重复文件探针、模型切换和相同 replay 场景中测量本地/Provider cache 命中；验证文件、TaskSpec、权限或模型变化后失效，缓存异常时结果质量与安全边界不下降。
18. 验证设置页用量与资源口径，以及 `resource_ready/warning/unavailable` 的任务前置决策；用量价格未知、运行时缺失、磁盘不足和预计 OOM 都必须有诚实状态。
19. 验证资源状态在设置页、任务确认卡、Agent Harness 摘要和 Job 详情之间引用同一 snapshot/peak；过期快照必须提示刷新，长期会话摘要不得保留实时 CPU 百分比。
20. 至少选一条真实生信任务画出“主张 → 证据计划 → 模块 DAG → Artifact → 论据/限制”链，验证模块可独立运行、下游只消费 verified artifact，且每个最终图/表/报告都有脚本。

输出：

- `test/fixtures/harness-scientific-task/` 脱敏夹具。
- `acceptance/harness-scientific-task/task-catalog.md`。
- `acceptance/harness-scientific-task/baseline.{json,md}`。
- `acceptance/harness-scientific-task/interaction-metrics.json`（提问轮数、推荐采纳/修改、放弃点和阻断原因）。
- `acceptance/harness-scientific-task/context-edit-metrics.json`（文件定位次数、候选歧义、范围读取、上下文大小、首个有效证据耗时、编辑冲突和验证结果）。
- `acceptance/harness-scientific-task/context-compaction-metrics.json`（压缩前后预算、checkpoint 覆盖、关键字段缺失、回读次数、矛盾/漂移和跨模型重建结果）。
- `acceptance/harness-scientific-task/durability-recovery-metrics.json`（重启重开、备份/导出、哈希校验、迁移、缺失/损坏恢复和新会话授权隔离）。
- `acceptance/harness-scientific-task/tool-locator-metrics.json`（工具序列、索引命中、候选歧义、采样/全量读取、冷/热耗时和定位证据）。
- `acceptance/harness-scientific-task/cache-cost-metrics.json`（provider cache read/create、local cache 命中、失效原因、input/output tokens、估算成本、延迟和质量回归）。
- `acceptance/harness-scientific-task/usage-resource-metrics.json`（用量口径、价格可用性、资源采样、Job 峰值、预检决策和 UI 展示一致性）。
- `scripts/harness-scientific-task-evaluate.mjs`。

出口标准：每个任务都有原始需求、输入清单、预期交付物、允许自动化范围、明确的失败边界和新手可读的成功路径；HRT-0 不要求用户先写出正确的分析术语。

### HRT-1：ScientificTaskSpec schema 与校验器

主模块：`P-03`；影响：`P-01`；状态：`complete`（2026-07-22；schema、规范化、哈希、状态迁移、脱敏和 14 个契约测试通过）

目标：建立版本化需求契约，不把需求留在 prompt 或临时内存中。

候选路径：

- `core/shared-backend/scientific-task-spec.js`
- `core/shared-backend/index.js`
- `test/scientific-task-spec.test.mjs`

要求：ScientificTaskSpec schema 校验、状态迁移、哈希生成、敏感信息脱敏、相对路径/输入快照表达和 unresolved decision 表达；同时定义 `ConversationContextEnvelope v1` 的作用域、模型能力快照、证据引用、预算、失效和 conversation/project/task 隔离规则，以及 `ContextCheckpoint v1` 的来源范围、policy/生成器版本、结构化覆盖、supersede 和回读规则。

出口标准：同一输入产生稳定规范化 spec；缺少分组、对照、统计单位等关键条件时返回 `requires_user_decision`，不自动进入 run。Agent 的解释文本不要求逐字一致，评测比较规范化字段、关键假设、用户决策、最终参数和交付状态。

### HRT-2：需求 → 数据证据 → 候选方法

主模块：`P-03`；影响：`P-01/P-04`；状态：`complete`（2026-07-22；规划器、真实 Harness index 适配、插件发现入口、科学规划 API 与 4 个测试通过）

目标：把现有 index/repair/manifest 能力组织成可解释的需求翻译阶段。

实现与复用路径：

- `core/shared-backend/scientific-task-planner.js`
- `test/scientific-task-planner.test.mjs`
- `core/r-server/routes/harness.js`：`POST /api/harness/scientific-task/plan`

- `scripts/harness-file-index.mjs`
- `core/r-server/routes/harness.js`
- `core/shared-backend/plugin-sdk.js`
- `core/r-server/helpers/harness-workflow-state.js`

要求：

- 识别数据类型、表头、样本结构、分组候选和可用工具。
- 在需要时调用受控命令行探针验证文件类型、编码、表头、行列规模、样本命名和运行时；探针输出必须有界、脱敏并记录证据来源。
- 实现按优先级的上下文解析：显式引用 → active file/artifact → 增量索引 → 文件名/文本候选 → 有界范围读取；返回候选依据和歧义状态，不猜测同名文件。
- 长会话只注入当前 conversation 的近期原文和摘要；项目长期事实、旧摘要、旧 Agent 输出不得覆盖当前用户消息、TaskSpec 或磁盘证据。
- 根据当前模型窗口构建预算；压缩后从 checkpoint + 近期原文重建上下文，关键精确问题能够按 messageId/traceId/path+hash 回读原始来源。
- 输出候选方法、选择理由、适用前提和风险。
- 输出一个推荐方案和必要的替代方案，并用数据证据说明“为什么推荐/为什么不推荐”。
- 区分“可自动修复”“需要用户确认”“明确不支持”。
- 推荐方案必须同时带有数据依据、替代方案和用户可理解的影响说明；权限模式只能影响后续执行，不得影响证据判断。
- 临时命令只用于 `inspect/infer/readiness`，不得绕过 `confirm` 直接启动分析；探针本身不创建 `tool_job`，除非它被明确升级为可重放的 replay Job。
- 候选方法必须能映射到可复用的分析模块和 task pack；包/算法版本属于 capability，不得把某个 R 包名称直接当成科学论据。
- 不读取全量数据正文来替代结构摘要；大文件保持有界索引。

出口标准：3 个真实任务均能生成可审阅的候选计划；歧义任务被稳定阻断且不创建 Job。

### HRT-3：确认门与任务持久化

主模块：`P-03`；影响：`P-01/P-02/W-03`；状态：`complete`（2026-07-22；确认预览、哈希/风险门、不可变 SQLite ledger、`scientificTaskRef` 执行门和 Job 反查已落地；5 个 HRT-3 测试通过）

目标：用户确认的是科学设计和交付标准，不只是点击“开始”。

实现路径：

- `core/shared-backend/scientific-task-confirmation.js`
- `core/r-server/db.js`：`scientific_task_specs` ledger
- `core/r-server/routes/harness.js`：确认预览、确认、恢复、绑定与 Job 反查 API
- `core/r-server/agent-tools/learning.js`：`run_tool.scientificTaskRef` 强制执行门
- `test/scientific-task-confirmation.test.mjs`
- `test/scientific-task-persistence.test.mjs`

要求：

- 确认前只允许 inspect/index/plan/repair 等无副作用操作。
- 确认内容包括输入快照、对照、参数、方法、预期 artifacts 和风险。
- 确认摘要包含预计耗时、运行时/资源要求和可能的失败类型；小白不需要先理解这些术语，但应能看到可读解释。
- 确认卡先展示通俗版摘要，技术参数、统计假设和高级选项渐进式展开。
- 用户可以用自然语言修改方案；Agent 必须重新生成 TaskSpec 版本并说明变更影响。
- 文件修改前展示目标相对路径、定位依据和 dry-run 变更摘要；歧义文件、非唯一片段、敏感路径或哈希漂移必须进入阻断/重新读取，不允许自动选一个继续。
- 修改后必须重新读取目标范围，并运行与变更类型匹配的最小验证；多文件修改用 edit manifest 明确每个文件的 applied/verified/conflict/failed，不能用总括性“已完成”掩盖部分失败。
- 确认后生成不可变 `taskSpecHash`。
- 任务契约必须绑定到真实 `tool_job`；不得创建第二套执行状态真相。
- 需求变更生成新 spec 版本，不覆盖已执行 spec。
- 聊天权限按钮映射到 `execution.automationMode`，现有 `accessMode` 仍作为独立的读/写安全边界；后端统一产出 `allow`、`confirm_required` 或 `cannot_reliably_answer`。
- `cannot_reliably_answer` 必须是可解释、可恢复的任务状态，列出缺失证据/待用户决定/不支持能力和下一步，不允许仅显示通用错误。
- 命令行执行同样经过统一确认门：命令、cwd、风险、预计资源、超时和可能产物在执行前可审阅；拒绝或失败不创建伪造的成功 Job。

出口标准：未确认任务零 `tool_job` 副作用；已确认任务能从 `tool_job` 反查原始 spec 和确认记录。

### HRT-4：执行事实与 Artifact Truth 绑定

主模块：`P-02`；协作：`P-03/P-04`；状态：`complete`（2026-07-22；MCP/HTTP 两条执行路径均写入 provenance，成功/失败 Job 保留 TaskSpec、参数、插件/runtime、脚本快照、命令和 Artifact 哈希；2 个 provenance tests 通过）

目标：让每次运行都能证明“按哪个需求、哪个输入、哪个插件、哪些参数运行”。

实现路径：

- `core/shared-backend/execution-provenance.js`
- `core/r-server/mcp/registry.js`
- `core/r-server/helpers/tools-executor.js`
- `core/r-server/helpers/artifact-truth.js`
- `test/execution-provenance.test.mjs`

复用路径：

- `core/r-server/db.js`
- `core/r-server/mcp/registry.js`
- `core/r-server/helpers/tools-executor.js`
- `core/r-server/helpers/artifact-truth.js`
- `core/shared-backend/agent-workflow.js`

要求：

- 继续使用 `run_tool → tool_job → artifact truth`。
- 记录工具/插件/运行时版本、最终参数、输入哈希和修复历史。
- `bind_artifact` 只允许 `artifactTruth.status === "valid"`。
- `degraded` 进入人工审查；`blocked` 不得被投影为完成。
- 多步骤任务保留 step、toolJobId、artifact 和 lineage 的一一对应。
- 受控 Agent 命令若产生任务性结果，必须记录 command spec、真实 executable、cwd、环境白名单摘要、退出码、stdout/stderr 摘要和进程终止原因，并绑定到现有 `tool_job` 或 replay Job；不得只留在聊天文本。
- workflow/task pack 必须声明模块顺序、输入/输出 artifact 类型、用户确认点、证据覆盖和失败恢复；模块实现不得在聊天上下文中隐式传递参数。
- 每个交付 artifact 必须带有可复现 provenance：实际使用脚本或生成脚本的快照、脚本哈希、输入引用、规范化参数、运行时和重放入口。
- 图、表、报告等产物都要能从结果卡直接找到对应脚本。允许多个 artifact 共享同一预处理 DAG，但每个 artifact 必须有直接可运行的 entrypoint，或有明确的依赖链和生成目标；不要求复制一份无差别的全流程脚本。

出口标准：同一 task spec 的每个 Job 都可重建输入、参数、产物清单和失败原因；不存在只在聊天文本中的执行事实。

### HRT-5：验证与 DeliveryManifest

主模块：`P-03`；协作：`W-04/P-02`；状态：`complete`（2026-07-22；DeliveryManifest v1、落盘/脚本 API、valid/degraded/blocked 三态测试与 UI-049 已实现；3 个仓库脱敏生信任务真实 R 链路 3/3 通过；UI-049 明暗主题、820px 窄窗和三态实机视觉矩阵通过）

目标：把“完成”从 UI 文案变成逐项可检查的交付结论。

实现路径：

- `core/shared-backend/delivery-manifest.js`
- `core/r-server/routes/harness.js`
- `test/delivery-manifest.test.mjs`
- `scripts/harness-scientific-task-delivery-acceptance.mjs`
- `acceptance/harness-scientific-task/hrt5-delivery-acceptance.json`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `docs/ui-productization-audit.md`：`UI-049`

复用路径：

- `core/r-server/helpers/harness-workflow-state.js`
- `core/r-server/routes/harness.js`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`

要求：

- 结果页显示 task spec、输入锁定、方法、Job、Truth、产物数量和交付状态。
- 报告、图、表、日志和 ZIP 都来自已校验的 Artifact manifest。
- 将统计结果、解释、趋势和限制分层展示。
- 首屏提供“结论摘要 / 我做了什么 / 需要注意什么”，技术详情可展开，不要求用户先理解 `tool_job`、FDR 或 lineage。
- 生成 `DeliveryManifest v1`，支持下载或复制到项目结果目录。
- 结果页按 artifact 展示“查看脚本 / 导出复现包 / 重放验证”入口；重放属于有资源和副作用的动作，默认仍受确认门约束。
- 区分 `reproducibility: available`（已有脚本快照）、`verified`（在受控 fixture/环境重放通过）和 `unavailable`（明确原因），不可把“能下载源文件”冒充为已验证复现。

出口标准：3 个真实任务都能生成交付清单；`valid`、`degraded`、`blocked` 的 UI 语义与后端状态一致。

### HRT-6：重放与跨智能体接手

主模块：`P-03`；协作：`C-05`；状态：`complete`（2026-07-22；ReplayPackage v1、ContextCheckpoint 持久化、逐 artifact 入口、漂移分类、真实离线 R 重放、数据库外接手和 UI-050 导出均通过）

目标：换智能体、换开发环境或重新打开项目后，能够按任务包复现，而不是依赖会话记忆。

实现路径：

- `core/shared-backend/scientific-replay-package.js`
- `core/r-server/db.js`：`context_checkpoints`
- `core/r-server/routes/harness.js`：checkpoint 与 replay package API
- `frontend/src/pages/project-workspace.tsx`
- `test/scientific-replay-package.test.mjs`
- `scripts/harness-scientific-task-replay-acceptance.mjs`
- `acceptance/harness-scientific-task/hrt6-replay-acceptance.json`
- `docs/ui-productization-audit.md`：`UI-050`

要求：

- 任务包不包含 API Key、Authorization、原始敏感文件正文或未经脱敏的 Provider 响应。
- 提供离线 fixture replay；真实任务重放前必须重新确认外部副作用。
- 对确定性工具比较产物哈希；对随机/浮点工具记录 seed 和容差。
- 重放失败必须分类为输入漂移、环境漂移、插件漂移、参数漂移或真实计算失败。
- 跨智能体接手使用 TaskSpec、ContextCheckpoint、Job/Artifact manifests 和原始来源引用重建上下文；不得只转发一段自由文本摘要。
- 导出/接手任务包包含 schema 版本、来源 digest、相对路径/哈希、恢复说明和验证命令；新 Agent 可在数据库不可用时至少读取任务包并判断历史是否完整。
- 重放包为每个 artifact 提供独立入口（例如 `repro/scripts/<artifactId>.R` 或 `.py`）及 `replay.json`；脚本应使用输入相对路径和哈希，不得依赖聊天上下文或未记录的临时文件。
- 确定性产物比较哈希；随机或浮点产物记录 seed、运行时和数值容差。脚本快照必须对应本次 Job 实际执行版本，而不是只引用可能变化的插件源码路径。

出口标准：新 Agent 只读入口文档、任务包和仓库代码，即可判断当前阶段、复现命令、验收结果和未完成边界。

### HRT-7：聚合门禁与稳定化

主模块：`P-03`；状态：`complete`（2026-07-22；离线聚合入口、固定窗口夹具、summary 失败回退和 HRT-6 回归均通过）

目标：把真实任务评测纳入零网络、零凭据 CI，并保持现有 Phase 6/7 回归。

要求：

- 增加 `npm run harness:scientific-task`，只使用脱敏 fixture workspace。
- 聚合门禁包含固定的大/小窗口能力夹具和 summary 失败回退；不依赖真实 Provider 返回一致措辞，只比较结构化关键事实、引用和最终策略状态。
- 保留 `npm run harness:phase7`、`npm run harness:agent-evaluate` 和 `npm test`。
- 任务评测不访问 Provider、Keychain、用户数据库或真实科学 Job。
- 证据写入 `acceptance/harness-scientific-task/`，禁止保存输入正文和密钥。

最终出口：HRT-0 至 HRT-7 全部完成，3 个任务覆盖成功、歧义/阻断、多步骤 lineage；所有既有门禁无回归。证据：`acceptance/harness-scientific-task/hrt7-scientific-task-gate.json`。

## 6. 总验收矩阵

| 验收维度 | 必须证明 |
|---|---|
| 需求翻译 | 模糊需求能形成结构化 TaskSpec，并保留原始需求 |
| 新手路径 | 用户不需要预先知道文件路径、工具名或统计术语，Agent 能引导到确认门 |
| 科学边界 | 分组、对照、统计单位或实验设计不明确时暂停并请求确认 |
| 方法选择 | 选择结果包含数据依据、候选方法和风险，而不是只给工具名 |
| 内容组合 | 科学主张可追溯到证据计划、模块 DAG、verified artifact、统计事实和限制；多个结果不被自由拼接成无依据结论 |
| 插件粒度 | 插件是可独立验证的科学分析模块；R/Python 包属于 capability，完整需求组合属于 workflow/task pack |
| 模块复用 | 不同任务能复用同一模块；输入/输出 schema、诊断、失败模式、脚本和 lineage 稳定 |
| Agent 主导 | Agent 主动识别、解释、推荐和整理；只有高影响科学选择打断用户 |
| 使用负担 | 记录澄清轮数、用户修改和放弃点，证明 Agent 减少而不是转移了复杂度 |
| 资源预期 | 重任务在确认前说明预计耗时、运行时和可能失败原因 |
| 自动化边界 | 权限按钮映射到 `automationMode`；`allow/confirm_required/cannot_reliably_answer` 与实际策略、工具风险和科学证据一致 |
| 按需激活 | 普通聊天不误启动 TaskSpec/命令/Job；文件结构问题可进入 context_assist；明确分析需求才进入 task_draft/task_execute |
| 会话隔离 | 当前 conversation 原文/摘要、项目长期事实和 TaskSpec 分层；不同会话不泄漏临时指令、授权或未确认结论 |
| 上下文压缩 | 预算触发而非固定消息数；关键决定/约束/未解决项保存在 checkpoint 结构字段，原消息和 Trace 可回读，不级联总结旧摘要 |
| 压缩恢复 | 经多轮压缩、模型切换和话题纠正后，TaskSpec、否定约束、文件版本、失败状态和未解决问题仍能从来源恢复；仅有摘要时不冒充已核实 |
| 模型切换 | turn 内模型固定；切换后按新窗口从原始事实重建，summary 失败时保守回退，容量不足明确阻断；不同模型的关键结构字段等价 |
| 持久化边界 | 可见消息、结构化决策和可审计工具事实可回读；私有推理不保存；大正文留在日志/Artifact；删除会话不误删科学执行真相 |
| 历史重开 | 软件重启/迁移后可重建 conversation、TaskSpec、Plan、Job、Artifact 和交付清单；损坏/缺失时显示 recovery_required，不伪造空历史 |
| 长期记忆 | 关键事实有原始来源、版本、哈希、备份/导出路径；摘要/向量可重建，不是唯一副本；新会话不继承旧授权 |
| 工具定位 | 基础工具按确定性优先级快速找到路径、行号、结构和哈希；大文件有界采样，语义召回若增加也必须带来源引用 |
| 成本缓存 | Provider/local/replay 三层缓存按作用域、输入 hash、模型/插件/策略版本命中；失效和异常可审计，质量、确认门和 Truth 不降级 |
| 用量透明 | 设置页能按时间/Provider/模型/项目/会话查看真实 usage、缓存命中、估算/未知成本和失败；不展示伪造价格 |
| 资源透明 | 设置/任务确认能看到本机运行时、CPU/内存/磁盘和活跃 Job；采样低频且不影响分析；GPU 仅在可靠探测时显示 |
| 资源决策 | `resource_ready/warning/unavailable` 与 `cannot_reliably_answer` 分离；Harness 给出资源依据和降级选项，不篡改科学结论 |
| 资源摘要 | 实时状态芯片、确认卡、Agent 摘要和 Job 详情使用同一带 TTL 的 snapshot/peak；过期数据不冒充实时，长期记忆只存引用和异常/峰值 |
| 上下文定位 | 显式文件引用优先；索引/搜索/范围读取逐级扩大；每条文件证据带路径、行范围、SHA 和截断状态 |
| 响应效率 | 已索引项目不重复扫描全仓；优先返回最小充分上下文，在小型真实/大型合成夹具记录冷/热查找读取次数、候选数、上下文大小和首个有效证据 p50/p95 |
| 精准编辑 | 错文件、同名歧义、非唯一片段、SHA 漂移和敏感路径均阻断；修改后重读并完成最小验证，部分失败不冒充完成 |
| Agent 命令行 | Agent 只调用受控非交互命令工具；cwd、命令风险、审批、超时、输出、退出码和进程终止均可审计；不绕过 `run_tool` 交付分析结果 |
| 数据结构探针 | Agent 能在正式分析前用有界命令核实文件类型、表头、规模、编码、哈希和运行时；证据可追溯且不冒充分析产物 |
| 执行真相 | TaskSpec、确认记录、tool_job、参数和输入哈希可互相追溯 |
| 产物真相 | 必需 artifacts 齐全，Truth 为 valid；degraded/blocked 不被伪装成成功 |
| 多步骤 | 只有 valid artifact 才能绑定到下游，lineage 完整且幂等 |
| 结果展示 | UI 只展示已验证 manifest；预览、报告、下载入口指向同一 Job |
| 交付解释 | 统计事实、科学解释、趋势和局限分层表达 |
| 逐产物复现 | 每个图、表、报告都有脚本快照、输入/参数引用和重放入口；共享依赖链需显式声明 |
| 复现验证 | 同一 task package 可在 fixture 中重放；真实任务有明确环境/seed/容差；未验证项明确标注原因 |
| 安全 | 无密钥、无任意网络、无第二执行器/Job/Artifact truth |

## 7. 验证命令

每个子包根据改动范围执行：

```bash
npm --prefix frontend run check
npm test --prefix frontend
npm --prefix frontend run build
npm run harness:check
npm run harness:agent-evaluate
npm run harness:phase7
npm test
npm run harness:scientific-task
```

涉及 Electron、IPC、打包资源或结果展示时，额外执行：

```bash
npm run dev
# 验证目标项目工作台、真实/脱敏任务状态和结果页
npm run build:mac-arm64
```

每次 handoff 必须记录：`HEAD`、`origin/main` 关系、修改文件、测试结果、未完成项、是否需要实机/打包态/用户确认。

## 8. 接手协议

新智能体按以下顺序读取：

1. `git status --short`、`git log -5 --oneline --decorate`、`git rev-parse HEAD`、`git rev-parse origin/main`。
2. `docs/AUDIT-LOG.md`。
3. `docs/README.md`、`docs/next-steps-roadmap.md`、`docs/project-workspace-handoff.md`。
4. 本文件 `harness-scientific-task-contract-plan.md`。
5. `docs/development-module-map.md`、`docs/harness-engine-spec.md`、`docs/plugin-artifact-schema.md`。
6. 当前 HRT 子包列出的代码路径和验收证据。

开发限制：

- 先完成当前 HRT 子包的出口标准，再进入下一个子包。
- 不批量新增生物信息流程，不复制参考 Harness 工程目录。
- 不直接修改用户真实输入，不根据预期显著性调参。
- 不读取、打印或提交 `.biof3-secrets`、Keychain 或 API Key。
- 不使用 `git add .` 或 `git add -A`；显式 stage 文件。
- 任何 UI 状态、Provider、发布和无关清理不得混入 P-03 子包提交。

## 9. 当前下一步

HRT-0 已完成，证据位于 `acceptance/harness-scientific-task/` 与 `test/fixtures/harness-scientific-task/`，门禁为 `npm run harness:scientific-task:evaluate`。

HRT-1 已完成。契约实现和测试位于：

- `core/shared-backend/scientific-task-spec.js`
- `test/scientific-task-spec.test.mjs`
- `core/shared-backend/index.js`

HRT-2、HRT-3、HRT-4、HRT-5、HRT-6 已完成。HRT-6 任务包包含 TaskSpec、ContextCheckpoint 或明确的 `partial_history`、Workflow Plan、Job/Artifact/Delivery/Provenance、来源 digest、脱敏参数、脚本快照、逐 artifact 入口、完整性清单和 HANDOFF；真实任务默认只保存输入引用/哈希，仓库脱敏 fixture 才允许携带输入副本。`acceptance/harness-scientific-task/hrt6-replay-acceptance.json` 证明数据库移除后仍可验证和运行：离线 R 重放退出码 0、确定性产物哈希完全一致，输入/插件/参数/环境/真实计算失败五类漂移均被分类。UI-050 实机点击为 6 个产物生成 18 文件任务包，旧任务缺 checkpoint 时正确显示“历史部分可用”，控制台 0 error。下一阶段进入 HRT-7：聚合门禁与稳定化。继续保持普通聊天不误创建 TaskSpec、`cannot_reliably_answer` 不因自动化模式提升而变成可执行，并保持 `run_tool → tool_job → artifact truth` 唯一执行真相。

该顺序保证 Harness 的工程能力由真实需求驱动，同时不把具体分析内容误写成 Harness Core。
