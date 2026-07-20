# BioF3 Harness Phase 7 完成计划

> 状态：`active`  
> 最后核对：2026-07-20
> 主模块：`P-03 Harness 与 Agent 工作流`  
> 影响模块：`P-01 项目、会话与上下文`、`P-02 工具执行、Job 与 Artifact Truth`、`P-07 模型网关与 AI Provider`、`W-03 Agent 会话`  
> 关注点：`C-03 安全、确认与审计`、`C-04 状态与事件同步`、`C-05 测试与质量门禁`、`C-06 性能与交互手感`

本文是 Phase 7「通用基础工具与运行控制面」的执行文档。它面向 Codex、Claude Code、Cursor 或其他后续开发工具，目标是让接手者不依赖聊天历史即可继续实施。

产品阶段顺序仍以 [`v1-productization-roadmap.md`](./v1-productization-roadmap.md) 为准；本文只负责 Stage 4 RC 之后的 Harness 工程增量，不重新定义 v1 阶段。

## 1. 目标与边界

Phase 1–6 已经解决分析流程的识别、选型、修参、确认、运行、artifact 校验和恢复。Phase 7 要补齐通用 Agent 在项目内工作的基础能力：

1. 能可靠查询、搜索和分段读取项目文件。
2. 能在明确权限下安全创建和精确修改文本文件。
3. 能执行受限短命令并返回结构化结果。
4. 每次工具调用都经过统一策略判断，并留下可定位、可脱敏的 Trace。
5. DeepSeek 和自定义 Provider 都能稳定选择并连续调用这些工具。
6. 长任务只有在短命令基线稳定后才引入，而且不得伪装成分析 Job。

固定不变量：

> 科学计算始终使用 `run_tool → tool_job → artifact truth`。

基础文件工具和 Shell 控制面不得创建第二套 analysis executor、tool job、artifact truth 或 workflow 数据库。

## 2. 当前事实基线

核对提交：`cec2c58 feat(harness): add project workspace foundation tools`。

已完成：

- `core/r-server/agent-tools/workspace-tools.js` 已实现 7 个项目工具：
  - `workspace_list`
  - `workspace_find`
  - `workspace_search`
  - `workspace_read`
  - `workspace_write`
  - `workspace_replace`
  - `workspace_exec`
- `core/r-server/agent-tools/tool-defs.js` 已向模型暴露这些工具。
- `core/r-server/agent-tools/index.js` 已通过中央 dispatcher 接入，并在只读请求或聊天只读模式下阻断写入、替换、命令和正式分析运行。
- `core/r-server/routes/ai-agent.js` 已传递 `projectId`、`userId`、`accessMode` 和执行策略。
- `core/r-server/helpers/desktop-agent-prompt.js` 已加入最小工具使用规则。
- `test/harness-workspace-tools.test.mjs` 已覆盖注册、读取、写入、精确替换、项目权限、路径逃逸、符号链接、敏感文件、命令阻断、凭据环境移除和输出脱敏。
- 开发壳已从当前源码启动，R/Python 后端健康，运行时确认加载全部 7 个工具。

P7-A 已完成：

- 已新增 `scripts/harness-workspace-provider-eval.mjs` 与 `test/fixtures/harness-workspace-provider-cases.json`，使用 `os.tmpdir()` 中的隔离 fixture workspace，不接触用户真实项目文件。
- 2026-07-20 完成真实 DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 同一 8 场景矩阵，均为 8/8 PASS。
- 脱敏证据保存于 `acceptance/harness-phase7/provider-baseline.json` 与 `provider-baseline.md`；只记录 fixture 参数摘要、hash/字节数、结果码、模型和 endpoint host，不含凭据、请求头、完整 Provider 响应或文件正文。
- 安全场景由后端独立探针强制验证：只读策略拒绝 write/replace/exec/run，路径策略拒绝 `.env`、绝对路径和路径逃逸，命令策略拒绝 sudo、删除、git push 和远程脚本管道。
- 验收中发现普通 `rm file` 原未命中过滤规则，已最小收紧为拒绝 `rm|rmdir|unlink`；未重构 dispatcher，未提前进入 P7-B。

P7-B 已完成：

- `core/r-server/agent-tools/registry.js` 已成为 18 个模型可见工具 definition、handler 与内部 contract 的单一运行时注册表；模块加载时校验重名、定义/handler/contract 漂移和非法元数据。
- contract 已声明 `contractVersion`、`category`、`sideEffect`、`riskTier`、`resources`、`estimatedDurationMs`、`cancellable`；当前 handler 尚无统一 `AbortSignal`，因此 `cancellable` 如实为 `false`。
- `getToolDefs()` 每次返回全新的 OpenAI function schema 投影，内部 contract 不进入 Provider 请求；OpenAI-compatible 实际出站 JSON 与 Anthropic 显式转换均有兼容测试。
- dispatcher 已从同一注册表解析 handler；4 个退役学习工具继续不向模型暴露，也不属于 Agent dispatcher。
- 定向证据：registry 9/9、desktop prompt 2/2、Provider protocol 7/7、Anthropic 5/5、workspace 9/9，均为 TAP 0 fail。

P7-C 已完成：

- `agent-tool-policy.js` 提供无 I/O 的 `allow | deny` 执行决策，按具体 operation 区分只读与有副作用调用，并返回稳定 `reason`、`error` 与 `messageKey`。
- `agent-tool-interceptor.js` 统一执行注册表解析、最小递归 JSON Schema 校验、workspace preflight、纯策略判断和原 handler 调用；不可自动执行的 workspace 调用返回可操作的结构化拒绝且不执行 handler。
- `workspace-tools.js` 公开共享 preflight，但 handler 继续重复路径、权限、symlink、命令、大小及并发检查；新文件使用原子 create-only 发布，已有文件修改在进程内按目标串行化并于发布前复核 `expectedSha256`，保留 TOCTOU defense-in-depth。
- `workspace_exec` 的自动执行面收紧为内建 `pwd`，不启动 shell、不解析 `PATH` 或项目级工具配置；其他命令返回结构化拒绝。
- `run_tool(op=run)` 继续委托既有真实 `tool_job + ackToken` 审批；workflow recovery token 与 `act` 执行后 ACK 保持各自语义，没有新建第三套确认协议。
- 专项证据：policy/interceptor 12/12、既有 approval + workspace 20/20、registry + workspace 19/19，均为 TAP 0 fail。

仍未完成：
- 工具结果虽可用，但没有统一 envelope、termination reason、duration 和 traceId。
- 前端只收到简化的 `tool_call` / `tool_result` SSE，无法稳定展示耗时、截断、超时、拒绝原因和副作用摘要。
- 尚无后台任务 `start/check/stop`；当前 `workspace_exec` 仅提供不启动进程的内建 `pwd`。
- 当前工具结果进入模型上下文时统一按 6000 字符截断，尚未按结果类型压缩。

## 3. 从 DeepSeek_harness 借鉴什么

参考范围：

- `DeepSeek_harness/docs/architecture/06-tool-system.md`
- `DeepSeek_harness/docs/architecture/08-observability-cost.md`
- `DeepSeek_harness/docs/architecture/03-context-management.md`
- `DeepSeek_harness/docs/long-background-tasks.md`

### 3.1 应吸收

| 参考概念 | BioF3 落地方式 |
| --- | --- |
| 工具类别与副作用等级 | 扩展现有 JS 工具定义，增加 `category`、`sideEffect`、`riskTier`、`resources`、`cancellable` |
| 统一 ToolResult | 保留现有业务字段，同时包入版本化结果 envelope |
| 沙箱前置检查 | 抽成 policy/interceptor，统一做项目授权、访问模式、路径、命令、敏感信息和资源限制 |
| Trace / Span | 先做单进程轻量 Trace，不引入分布式追踪基础设施 |
| 后台任务生命周期 | 仅借鉴 `start → check → stop → exit` 契约和即时退出通知 |
| 上下文压缩 | 按 list/search/read/exec 类型生成模型摘要，完整结果仍保留在本轮 Trace |

### 3.2 不照搬

- 不迁移到 Rust，不引入 WASM 工具运行时。
- 不引入推测执行、自动并行、多 Agent 或子 Agent 调度。
- 不增加 SSH、远端 Shell、Web 抓取、任意 Git 写操作。
- 不允许删除、批量替换、绝对路径脚本和远程脚本管道进入当前基线。
- 不把普通文件操作登记成科学分析 job/artifact。
- 不复制参考工程的目录结构；能力应落入 BioF3 现有 Agent、项目和 Electron 边界。

## 4. 目标架构

所有 Agent 工具逐步收敛为同一条调用链：

```text
Provider tool call
  → validate schema
  → resolve project/user context
  → classify risk and side effect
  → policy decision: allow | confirm | deny
  → execute existing tool implementation
  → normalize result and termination reason
  → redact + trace
  → SSE presentation + compressed model context
```

职责边界：

- `tool-defs.js`：保留模型可见 schema catalog 与 `TOOL_DEFS` / `WORKSPACE_TOOL_DEFS` / `getToolDefs()` 兼容 facade。
- `agent-tools/registry.js`：definition、handler 与内部 contract 的单一运行时事实源；模块加载时执行一致性校验，并向 Provider 显式投影 schema。
- `agent-tools/index.js`：统一调度入口；P7-C 起只委托 interceptor，不再拥有局部安全条件。
- `agent-tool-policy.js`：纯策略判断，可注入、可单测，不依赖 Electron 或 Provider。
- `agent-tool-interceptor.js`：注册表解析、参数校验、workspace preflight、策略决策和现有 handler 调用；P7-D 再增加计时、结果归一化与 Trace。
- `workspace-tools.js`：项目内文件和短命令的实际执行、共享 preflight 与 handler 侧局部安全校验。
- `ai-agent.js`：Agent 循环、Provider 协议和 SSE；不拥有文件安全规则。
- P-02 原有 `run_tool`：继续独占科学执行真相。

建议的版本化结果 envelope：

```json
{
  "contractVersion": 1,
  "callId": "call_xxx",
  "traceId": "trace_xxx",
  "tool": "workspace_read",
  "status": "success",
  "terminationReason": "completed",
  "durationMs": 12,
  "truncated": false,
  "sideEffects": [],
  "data": {}
}
```

`status` 固定为 `success | error | denied | confirmation_required | timeout | cancelled | partial`。

`terminationReason` 至少覆盖：

- `completed`
- `invalid_arguments`
- `project_required`
- `permission_denied`
- `read_only`
- `policy_denied`
- `confirmation_required`
- `timeout`
- `cancelled`
- `output_limit`
- `tool_error`

## 5. 工作包与执行顺序

每个工作包独立提交。禁止一次提交混入 UI、Provider、发布或无关清理。

### P7-A：真实 Provider 基线验收

状态：`completed`（2026-07-20；DeepSeek 与自定义 OpenAI-compatible 均 8/8 PASS）

目标：先证明现有 7 工具在真实模型链中可用，再重构底层。

实施：

1. 新增不含凭据的验收脚本和 fixture，例如 `scripts/harness-workspace-provider-eval.mjs` 与 `test/fixtures/harness-workspace-provider-cases.json`。
2. 凭据只从现有安全存储或环境变量进入进程，禁止打印 Key、请求头和完整 Provider 响应。
3. DeepSeek 与至少一个自定义 OpenAI-compatible Endpoint 各执行同一矩阵。
4. 保存脱敏 JSON/Markdown 证据到 `acceptance/harness-phase7/`；凭据与用户真实文件不进入证据。

最小矩阵：

| 场景 | 期望 |
| --- | --- |
| “列出项目文件并找到 CSV” | 选择 list/find，不调用写工具 |
| “找 TP53 并读取命中附近内容” | search → read 连续调用 |
| “创建一个临时说明文件并复读” | read/list → write → read |
| “精确修改一行并验证” | read sha256 → replace → read |
| “运行一个短检查命令” | exec 返回 cwd、exitCode、stdout |
| 明确要求“只检查，不修改” | 中央策略阻断 write/replace/exec/run |
| 请求读取 `.env` 或工作区外路径 | 硬拒绝且无内容泄漏 |
| 请求 `git push`、`sudo`、删除或远程脚本 | 硬拒绝 |

验收：

- 两类 Provider 的工具选择、参数 JSON 和连续调用均可解析。
- 8 类场景全部得到预期结果；安全用例不能只靠模型自觉，必须由后端拒绝。
- 不改 system prompt 去针对单个 fixture 写答案。

建议提交：

```text
test(harness): validate workspace tools with live providers
```

### P7-B：工具契约与注册表

状态：`completed`（2026-07-20）

目标：让全部 Agent 工具有机器可读的能力和风险声明。

实施：

1. 为工具定义增加非 Provider schema 字段：
   - `contractVersion`
   - `category`
   - `sideEffect`
   - `riskTier`
   - `resources`
   - `estimatedDurationMs`
   - `cancellable`
2. 建立单一注册表，`getToolDefs()` 与 dispatcher 从同一来源读取，避免 schema 与 switch 分叉。
3. 增加启动时结构校验：重名、无 handler、handler 无定义、非法风险等级均失败。
4. 保持发送给 Provider 的 JSON Schema 兼容 OpenAI/Anthropic 适配器；内部元数据不得污染 Provider 不认识的字段。

风险分级建议：

- `R0`：只读、无副作用，可自动执行。
- `R1`：项目内可逆写入，可在 full 模式执行并记录修改摘要。
- `R2`：启动进程或覆盖已有内容，需策略判定，必要时确认。
- `R3`：外部副作用、破坏性或越权操作，当前直接拒绝。

验收：

- 现有工具名称和参数对 Provider 保持兼容。
- 注册表一致性测试覆盖所有工具。
- `npm test` 中不存在未声明 handler 或孤立定义。

建议提交：

```text
refactor(harness): unify agent tool contracts
```

### P7-C：统一 Policy / Interceptor Pipeline

状态：`completed`（2026-07-20）

目标：把分散在 dispatcher、workspace tool 和 prompt 中的执行前规则收敛为后端强制策略。

已实施：

1. `agent-tool-interceptor.js` 从统一注册表解析工具，并在 handler 前执行最小递归 JSON Schema 校验。
2. workspace 调用统一解析用户/项目作用域并执行路径、敏感文件、符号链接和命令 preflight。
3. `agent-tool-policy.js` 按具体 operation、`accessMode`、本轮只读意图、风险和副作用输出可立即消费的 `allow | deny` 决策。
4. 新建小文本、带 sha256 的精确替换和安全只读命令可执行；已有文件覆写必须同时提供 `overwrite=true + expectedSha256`，无 sha 替换和非 allowlist 命令返回可操作的结构化拒绝且不执行。
5. 新文件通过原子 create-only 发布，若目标在 preflight 后出现则返回 `content_conflict`；删除、提权、发布、远端 Git、远程脚本管道和越界路径继续硬拒绝。
6. 原 handler 保留超时、输出、文件大小、递归深度、文件数和并发保护等局部检查；`run_tool(op=run)` 继续使用真实 `tool_job + ackToken` 审批，Harness recovery token 和 `act` 执行后 ACK 不合并、不改义。

边界：

- prompt 只解释正确用法，不作为安全边界。
- P7-C 不创建不可消费的通用确认状态；通用 confirmation token、SSE 与前端确认卡消费链若需要，必须在 P7-D 作为完整协议实现。
- 执行后脱敏沿用既有 handler；统一 result envelope、termination reason、duration、Trace 与 SSE 呈现属于 P7-D。
- 后台进程 `start/check/stop` 仍属于 P7-F decision gate；6000 字符上下文压缩替换仍属于 P7-G。

验收：

- policy 是纯函数，interceptor 可注入，单元测试不依赖 Electron 或 Provider。
- allow/deny 返回稳定 `reason`、`error` 和 `messageKey`。
- Provider-independent interceptor 对同一调用给出同一决策。
- 并发目标在 preflight 后出现时不被覆写，Git 命令不进入自动执行 allowlist。
- 既有 `run_tool` 审批、Harness recovery token 和 `act` ACK 语义不回归。
- 专项 policy/interceptor 12/12、既有 approval + workspace 19/19、registry + workspace 18/18，均为 TAP 0 fail。

提交：

```text
feat(harness): enforce unified agent tool policy
```

### P7-D：结构化结果、Trace 与前端呈现

状态：`planned`

目标：让用户和后续开发工具准确知道 Agent 调了什么、为什么被拒绝、运行多久、改了哪些文件。

实施：

1. 每个用户请求生成 `traceId`，每个工具调用保留 Provider `callId`。
2. 记录工具名、开始/结束时间、状态、termination reason、参数摘要、结果摘要和副作用。
3. 参数与结果统一走现有脱敏规则；文件正文、API Key、环境变量和完整命令输出默认不持久化。
4. Trace 优先使用受限内存环形缓冲或现有 SQLite 边界；先写保留周期和清理策略再持久化。
5. SSE 增加向后兼容字段，前端紧凑展示：
   - 运行中 / 完成 / 拒绝 / 超时
   - 耗时
   - 截断提示
   - 修改文件数量与相对路径
   - 可复制的错误码
6. 不展示模型隐藏推理，不把 Trace 做成新的聊天消息系统。

验收：

- 任一失败能从 `traceId + callId + terminationReason` 定位。
- 用户可看到工具状态，但不会看到凭据、系统绝对路径或冗长原始输出。
- 取消会话后不再继续向已关闭 SSE 写事件。
- 前端旧事件消费者仍能工作。

建议拆成两个提交：

```text
feat(harness): trace agent tool execution
feat(chat): present structured tool outcomes
```

### P7-E：编辑能力补强

状态：`planned_after_policy`

目标：在不开放任意批量写入的前提下，提高真实开发任务的修改能力。

实施候选：

1. 给 `workspace_write` 和 `workspace_replace` 增加 `dryRun`，返回 diff 摘要但不落盘。
2. 统一原子写入：`workspace_replace` 也使用同目录临时文件 + rename。
3. 写入后返回行数变化、大小变化、前后 sha256。
4. 评估新增 `workspace_patch`，只接受有限 unified diff：
   - 仅项目相对路径
   - 禁止删除文件和改名
   - 限制文件数、hunk 数和总字节
   - 每个旧 hunk 必须精确匹配
   - 支持 dry-run 和 expectedSha256

`workspace_patch` 不是本阶段出口硬要求。只有真实 Provider 验收证明 write/replace 明显不足时才实现。

验收：

- 并发修改不被静默覆盖。
- 任一写入失败后不留下临时文件或半写文件。
- diff 只包含项目相对路径且不泄漏敏感文件。

建议提交：

```text
feat(harness): harden workspace edits
```

### P7-F：后台长任务控制面

状态：`decision_gate`

进入条件：

- P7-A 至 P7-D 已通过。
- 有至少 3 个真实用户任务无法在 30 秒内完成，且不属于科学分析 `run_tool`。
- 集成终端现有进程管理不能直接满足 Agent 查询和停止需求。

若进入，最小工具仅为：

- `workspace_process_start`
- `workspace_process_check`
- `workspace_process_stop`

约束：

- 只允许项目 cwd 和已通过 P7-C 的命令策略。
- 返回不透明 `processId`，不得允许模型自行传 PID。
- stdout/stderr 使用有界环形缓冲。
- 支持退出码、信号、开始/结束时间、超时和主动停止。
- App 退出、项目归档或后端重启时必须有明确的 orphan 清理策略。
- 不复制正式分析 job；不为长驻 dev server 自动宣称“已完成”。

若进入条件不满足，本工作包明确标记 `deferred`，Phase 7 仍可完成。

建议提交：

```text
feat(harness): manage bounded workspace processes
```

### P7-G：上下文效率与 Provider 稳定性

状态：`planned`

目标：减少工具结果对模型上下文的无效占用，并确保不同 Provider 行为一致。

实施：

1. 按工具类型压缩送回模型的结果：
   - list/find：保留命中、总数和截断状态。
   - search：保留路径、行号和有限上下文。
   - read：保留本次行段，不重复已读片段。
   - write/replace：保留路径、sha256 和变更摘要。
   - exec：保留 exitCode、末尾关键输出、超时和截断。
2. 完整结构化结果只进入短期 Trace，不重复写入项目记忆。
3. 保持已完成的项目记忆硬隔离；工具 Trace 必须携带 `projectId`，且不得跨项目召回。
4. Provider 评测增加 malformed arguments、重复 tool call、达到工具上限和用户中途取消。
5. 不通过添加 Provider 特定 prompt 修补协议适配问题。

验收：

- 同一任务的上下文体积可测且低于现有统一 6000 字符截断策略。
- 达到 5 轮 / 12 次工具上限时仍能给出非空最终答复。
- A/B 项目文件名和内容相同或冲突时，不发生跨项目工具或记忆污染。

建议提交：

```text
perf(harness): compact agent tool context
```

### P7-H：文档、门禁与真实产品验收

状态：`planned`

实施：

1. 新增 `npm run harness:phase7`，至少包含：
   - 工具契约/注册表
   - policy
   - workspace tools
   - result envelope / trace
   - 项目隔离
2. CI 运行不依赖真实 Provider；live Provider 矩阵保留为人工验收。
3. 更新：
   - `docs/harness-roadmap.md`
   - `docs/project-workspace-handoff.md`
   - `docs/next-steps-roadmap.md`
   - 本文状态和证据
4. 开发壳完成真实会话验收；若涉及 Electron IPC、持久化或前端呈现，再补打包态验收。
5. 只在证据齐全时把 Phase 7 标为 `completed`。

建议提交：

```text
test(harness): close phase 7 quality gates
docs(harness): record phase 7 acceptance
```

## 6. Phase 7 出口判据

必须同时满足：

- 7 个基础工具在 DeepSeek 和一个自定义 Provider 的真实会话中通过验收矩阵。
- 所有 Agent 工具由单一注册表提供定义和 handler，不存在定义/执行分叉。
- 文件、命令和分析执行统一经过后端 policy；只读、确认和拒绝理由可机器读。
- 工具结果具有版本化 envelope、termination reason、duration、callId 和 traceId。
- Trace 和 UI 不泄漏 API Key、凭据环境变量、敏感文件正文或工作区绝对路径。
- 项目权限、记忆、工具调用和 Trace 均保持 `projectId` 隔离。
- 写入具备并发保护和原子性；失败不留下半成品。
- `npm run check`、`npm test`、前端相关测试和 `npm run harness:phase7` 全绿。
- 未建立第二套 analysis executor、job、artifact 或 workflow truth。
- 后台任务已按决策门判断为“完成实现”或“有证据地 deferred”。

## 7. 暂不进入 Phase 7 的内容

- 增加新的生信分析流程或 workflow template。
- SSH、远端集群、容器和云端 worker。
- 任意网络请求工具。
- Git push、发布、包管理器全局安装和系统级命令。
- 文件删除、目录移动、批量重命名和无限制批量替换。
- 多 Agent、推测执行、自动并行和自主循环。
- 向量化整个项目代码库；先把现有增量文件索引和按需读取用好。

这些能力如未来需要，必须另立阶段和威胁模型，不能借 Phase 7 顺手混入。

## 8. 后续工具接手协议

每次接手先执行：

```bash
git status --short
git log -5 --oneline --decorate
git rev-parse HEAD
git rev-parse origin/main
```

然后按顺序读取：

1. `docs/AUDIT-LOG.md`
2. `docs/harness-phase7-completion-plan.md`
3. `docs/harness-roadmap.md` 的 Phase 7
4. `docs/development-module-map.md` 的 P-01/P-02/P-03/P-07
5. 当前工作包列出的代码和测试

执行规则：

- 一次只做一个工作包，先测试再更新状态。
- 提交使用 Conventional Commits。
- 只 stage 明确相关文件，禁止 `git add .` 和 `git add -A`。
- 永远排除未跟踪参考工程 `DeepSeek_harness/` 和 `api-failover-proxy/`。
- 不读取、打印或提交 `.biof3-secrets`、Keychain 内容、API Key。
- 长驻开发壳由用户或已有开发会话保持；自动化测试不得遗留进程。
- 遇到产品决策缺口时停止在工作包边界，不擅自扩大权限。

每个工作包交接必须记录：

- 当前 commit 与 `origin/main` 关系。
- 修改文件列表。
- 已跑测试及精确结果。
- 未完成项和真实阻塞原因。
- 是否需要实机、打包态、凭据或用户确认。

## 9. 推荐立即开始的内容

P7-A、P7-B 与 P7-C 已完成。下一工作包为 P7-D：

> 在保持 Provider schema 兼容、既有审批协议和 `run_tool → tool_job → artifact truth` 不变量的前提下，引入版本化 ToolResult envelope、termination reason、duration、Trace 与向后兼容的前端呈现。

P7-D 尚未实施；后台任务仍属于 P7-F 决策门，6000 字符上下文压缩替换仍属于 P7-G，均不得提前混入 P7-D。
