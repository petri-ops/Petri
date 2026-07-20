# BioF3 Harness Phase7 完成计划

> 状态：`completed`（2026-07-21）
> 最后核对：2026-07-21
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

P7-D 已完成：
- Agent loop 通过中央 `executeToolCall()` 生成版本化 ToolResult envelope，记录真实 `traceId`、`callId`、状态、termination reason、耗时、截断标记和副作用摘要；旧 `dispatchTool()` 仍返回原始 handler 数据，保持直接调用兼容。
- task 与 legacy 两条 loop 共用向后兼容 SSE builder；旧 `name/summary`、审批和 Act 扁平字段保留，新增可选 `toolResult`。
- Trace 使用最多 200 条、TTL 15 分钟的进程内脱敏摘要 store，不持久化原始参数、正文、命令输出或凭据。
- SimpleChat 按 `callId` 幂等呈现运行、成功、失败和拒绝状态，以及耗时、截断、termination reason 和副作用摘要；task 回放不会把终态降级为运行中。
- 当前执行器没有统一 `AbortSignal` 或 timeout，因此不虚构 `timeout` / `cancelled` 状态；前端停止按钮只停止当前订阅/生成显示，不声称工具已取消。

P7-G 已完成：
- 模型上下文不再只依赖统一 6000 字符截断，而由 `serializeToolResultForModel()` 按 list/find/search/read/write/replace/exec 类型生成有界投影；硬截断仍返回有效 JSON，并通过 `modelContext` 记录压缩比例与 read 去重状态。
- read 去重限定在 `projectId + traceId + path`，且只提交真正进入模型的行段；Trace entry 携带 `projectId` 并支持项目精确查询。
- task/legacy 两条 loop 已共用严格 5 次 Provider 请求/12 次工具调用边界；第 5 次请求为无工具最终整理轮，不再发起第 6 次请求，并结构化处理非法参数、重复 Provider call ID、批次超限和取消后剩余调用。

Phase 7 已完成：
- P7-F 后台任务控制面已于 2026-07-20 经 decision gate 判定为 `deferred`：当前 `workspace_exec` 仍仅提供不启动进程的内建 `pwd`，且未新增 `workspace_process_start/check/stop`。
- P7-H 已于 2026-07-21 完成离线聚合门禁、CI 接线与真实产品链路验收：`harness:phase7` 覆盖 manifests 7/7、Phase 6 回归 64/64、Phase 7 核心回归 68/68，临时真实 workspace 经生产 interceptor / policy / preflight / handler 链完成 13/13 检查。
- P7-A live Provider 证据继续作为人工验收：DeepSeek 与自定义 OpenAI-compatible 均为 8/8 PASS，不进入零网络、零凭据 CI。
- UI-034 仍为 `in_progress`；本次离线后端产品验收不冒充开发壳或打包态视觉验收。

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
  → policy decision: allow | deny
  → execute existing tool implementation
  → normalize result and termination reason
  → redact + trace
  → compatible SSE presentation + bounded model context
```

职责边界：

- `tool-defs.js`：保留模型可见 schema catalog 与 `TOOL_DEFS` / `WORKSPACE_TOOL_DEFS` / `getToolDefs()` 兼容 facade。
- `agent-tools/registry.js`：definition、handler 与内部 contract 的单一运行时事实源；模块加载时执行一致性校验，并向 Provider 显式投影 schema。
- `agent-tools/index.js`：统一调度入口；P7-C 起只委托 interceptor，不再拥有局部安全条件。
- `agent-tool-policy.js`：纯策略判断，可注入、可单测，不依赖 Electron 或 Provider。
- `agent-tool-interceptor.js`：注册表解析、参数校验、workspace preflight、策略决策和现有 handler 调用。
- `agent-tools/tool-execution.js`：P7-D 中央后置层，负责计时、版本化结果归一化、真实 termination reason、递归脱敏和 Trace 写入；P7-G 在不修改原始 ToolResult/SSE/handler 数据的前提下，按工具类型生成有界模型投影与可测 `modelContext` 元数据。
- `agent-tools/agent-loop-control.js`：P7-G task/legacy loop 的共享 Provider 边界，统一 5 轮/12 次调用、批次 reserve、参数解析、重复 call ID 隔离和取消后的剩余调用拒绝。
- `agent-tools/tool-events.js`：task/legacy loop 共用的向后兼容 SSE 投影。
- `workspace-tools.js`：项目内文件和短命令的实际执行、共享 preflight 与 handler 侧局部安全校验。
- `ai-agent.js`：Agent 循环、Provider 协议和 SSE；不拥有文件安全规则。
- P-02 原有 `run_tool`：继续独占科学执行真相。

P7-D 已落地的版本化结果 envelope：

```json
{
  "contractVersion": "1.0.0",
  "callId": "call_xxx",
  "traceId": "trace_xxx",
  "tool": "workspace_read",
  "status": "success",
  "terminationReason": "success",
  "durationMs": 12,
  "truncated": false,
  "sideEffects": {
    "type": "none",
    "riskTier": "R0",
    "resources": []
  },
  "data": {}
}
```

当前 `status` 只报告执行器真实可观察的 `success | error | denied`。

当前 `terminationReason` 来自真实结果分类：成功为 `success`，普通 handler 失败为 `handler_error`，策略/校验拒绝沿用后端返回的稳定 `reason` 或 `error`（例如 `invalid_arguments`、`project_required`、`read_only`、`policy_denied`）。在统一 `AbortSignal`、timeout 执行器或完整 confirmation 消费协议落地前，不声明 `timeout`、`cancelled`、`partial` 或通用 `confirmation_required` 状态。

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
- P7-C 不创建不可消费的通用确认状态；P7-D 也未新增通用 confirmation 协议。若未来需要，必须另行实现 token、SSE、前端确认卡和执行回执的完整消费链。
- 执行后递归脱敏、统一 result envelope、termination reason、duration、Trace 与 SSE 呈现已由 P7-D 的 `tool-execution.js` / `tool-events.js` 完成。
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

状态：`completed`（2026-07-20；代码与自动化验证完成，UI-034 待实机验收）

目标：让用户和后续开发工具准确知道 Agent 调了什么、为什么被拒绝、运行多久、产生了何种副作用。

已实施：

1. 每个用户请求生成 `traceId`；每个工具调用保留 Provider `callId`，缺失时生成稳定 fallback id。
2. `executeToolCall()` 在中央执行层生成 `contractVersion/traceId/callId/tool/status/terminationReason/durationMs/truncated/sideEffects/data` envelope；旧 `dispatchTool()` 仍返回原始 handler 数据。
3. task 与 legacy Agent loop 共用 `buildToolCallEvent()` / `buildToolResultEvent()`，保留旧 `name/summary` 及审批、Act 扁平字段，同时增加可选 `toolResult`。
4. 参数、事件、入模结果和 Trace 摘要统一递归脱敏；Trace store 最多保留 200 条、TTL 15 分钟，只存各 1200 字符的参数/结果摘要，不持久化原始正文或凭据。
5. SimpleChat 按 `callId` 幂等投影工具活动，兼容旧事件同名调用关联，并防止 task 回放把终态降级为 `running`；展示运行、等待确认、成功、失败、拒绝、耗时、截断、termination reason 和实际副作用摘要。
6. 副作用摘要按本次 operation 的真实可观察结果生成：`run_tool` 的只读/规划/绑定/状态操作与 `plan` 的读取操作不继承工具静态最大能力；待审批调用只报告实际创建的 pending `tool_job`。
7. 保留现有 6000 字符入模截断。当前没有公共 `AbortSignal` 或通用 timeout 执行器，因此只报告真实可观察的 `success | error | denied`，不虚构 `timeout` 或 `cancelled`；停止前端订阅不改写工具终态。

验收证据：

- `test/agent-tool-result.test.mjs` 6/6：legacy dispatcher 兼容、envelope、SSE 投影、只读 operation 无副作用、递归脱敏（含常见 provider token）、共享引用、截断、Trace 容量与 TTL。
- 前端 `copilotClient.test.ts` + `toolActivity.test.ts` 7/7：task/legacy SSE parser、`callId` 幂等、回放防降级、legacy 同名关联、等待确认及展示格式。
- 后端 P7-D + 既有审批 + diagnostic redaction 组合定向回归 18/18，0 fail。
- UI-034 已登记为 `in_progress`；未取得开发壳或打包态视觉证据前不得标记 `verified`。

边界：

- 未新增通用 confirmation 状态；`run_tool` 审批、workflow recovery token 和 `act` ACK 保持原协议。
- 未实现 P7-F 后台进程生命周期，也未提前替换 P7-G 的按类型上下文压缩。
- 科学计算仍只走 `run_tool → tool_job → artifact truth`。

提交：

```text
feat(harness): trace structured tool outcomes
```

### P7-E：编辑能力补强

状态：`completed`（2026-07-20）

目标：在不开放任意批量写入的前提下，提高真实开发任务的修改能力。

已实施：

1. `workspace_write` 与 `workspace_replace` 的 Provider schema 新增可选 `dryRun`；预演仍执行项目授权、路径/敏感文件/symlink、文件大小、`overwrite`、`expectedSha256` 和唯一匹配校验，但不创建工作区根目录、目标父目录、临时文件或目标文件；若配置的工作区根目录尚不存在则返回 `workspace_unavailable`。
2. 成功结果保留既有顶层字段 `created/sizeBytes/replacements/previousSha256/sha256`，仅追加 `dryRun` 与 `changeSummary`，避免破坏现有 Provider 和直接调用方。
3. `changeSummary` 只包含项目相对路径和前后 `sha256/sizeBytes/lineCount`；不返回正文或完整 diff，创建前态固定为 `sha256: null, sizeBytes: 0, lineCount: 0`。
4. write/replace 共用同目录 `atomicPublish()`：临时文件使用 `wx`；已有目标发布前再次复核预期内容并 `rename`，新目标通过 hard-link create-only 发布；临时文件在 `finally` 中 best-effort 清理，常规冲突回归验证无残留，极端文件系统清理失败不作绝对保证。
5. 同进程 `withTargetLock` 与发布前 SHA 复核继续存在。该机制防止本进程并发静默覆盖，但不宣称跨进程 CAS；外部进程在最终复核与 rename 之间仍存在有限 TOCTOU 边界。
6. policy 将成功 dry-run 视为非变更操作，因此只读上下文可预演；真实 write/replace 仍被阻断。ToolResult 仅在 handler 实际返回 `dryRun: true` 后报告 `sideEffects: none/R0`，真实编辑仍为 `workspace-write/R2`。
7. 未实现 `workspace_patch`：当前没有真实 Provider 证据证明 write/replace 不足，不扩大多文件/hunk 写入攻击面。

验收证据：

- `CI=1 TERM=dumb node --test test/harness-workspace-tools.test.mjs test/agent-tool-policy.test.mjs test/agent-tool-result.test.mjs`：32 tests / 32 pass / 0 fail。
- 覆盖 Provider schema、create/replace dry-run 不落盘、缺失 workspace root、授权/敏感路径/symlink、overwrite、stale SHA、唯一匹配、additive 旧字段兼容、只读 policy、成功预演 R0 与真实写入 R2。
- 既有原子 create-only race 测试继续验证目标不会被并发创建覆盖，并确认常规冲突路径无临时文件残留；极端文件系统清理失败仍遵循 best-effort 边界。
- 科学计算链路未改变，仍只走 `run_tool → tool_job → artifact truth`。

提交：

```text
feat(harness): harden workspace edits
```

### P7-F：后台长任务控制面

状态：`deferred`（2026-07-20；decision gate 已完成，未进入实现）

进入条件核对：

| 条件 | 结论 | 证据 |
| --- | --- | --- |
| P7-A 至 P7-D 已通过 | 满足 | 真实 Provider 基线、统一注册表/Policy 与结构化 ToolResult 均已完成；P7-E 也已完成。 |
| 至少 3 个真实用户任务无法在 30 秒内完成，且不属于科学分析 `run_tool` | **不满足（0/3）** | 仓库中未找到同时具备真实用户/产品需求、可信 `>30s`、非科学且需要 Agent 生命周期控制的任务。插件/Runtime 安装、应用更新已有专用 IPC/进度面；诊断导出无 `>30s` 证据；dev server/watch 仅为潜在终端场景；构建发布属于维护门禁；content sync/capability provision 已有专用机制，均不得凑数。 |
| 集成终端现有进程管理不能直接满足 Agent 查询和停止需求 | 满足 | Electron 仅维护全应用单例 PTY；无项目归属或不透明 `processId`，无主进程有界 stdout/stderr 缓冲和按任务状态查询，stop 只能终止整个 session，且缺少项目归档/后端重启时的 orphan 清理策略。renderer 的 xterm `scrollback: 5000` 不是 Agent 可查询的后台缓冲。 |

决策：三个进入条件为 AND 关系。虽然终端能力缺口成立，但真实任务门槛为 0/3，因此本包明确 `deferred`。本次不新增 `workspace_process_start`、`workspace_process_check`、`workspace_process_stop`，不修改生产代码或测试，不扩大 P7-C 命令策略，也不提前实施 P7-G。

重新开启条件：后续只有在仓库中沉淀至少 3 个可复现的真实产品任务，并分别证明其通常或必然超过 30 秒、不能归入科学 `run_tool`、且专用 IPC/现有终端无法满足 Agent 查询与停止时，才重新评审本 gate。重新开启后仍必须遵守以下最小边界：

- 只允许项目 cwd 和已通过 P7-C 的命令策略。
- 返回不透明 `processId`，不得允许模型自行传 PID。
- stdout/stderr 使用有界环形缓冲。
- 支持退出码、信号、开始/结束时间、超时和主动停止。
- App 退出、项目归档或后端重启时必须有明确的 orphan 清理策略。
- 不复制正式分析 job；不为长驻 dev server 自动宣称“已完成”。

文档提交：

```text
docs(harness): defer background process control
```

### P7-G：上下文效率与 Provider 稳定性

状态：`completed`（2026-07-20）

目标：减少工具结果对模型上下文的无效占用，并确保不同 Provider 行为一致。

已实施：

1. `serializeToolResultForModel()` 只压缩模型侧投影，原始 handler result、ToolResult envelope、SSE 与 Trace 摘要生成链保持不变：
   - list/find：稳定字段白名单，最多 40 条，并保留总数与截断状态。
   - search：最多 12 条命中，每条上下文最多 120 字符，同时保留路径和行号。
   - read：返回实际入模行段，并按 `projectId + traceId + path` 去重；只有完整结构化投影真正入模后才提交已读范围，硬截断不会污染去重状态。
   - write/replace：保留相对路径、sha256 与变更摘要。
   - exec：保留状态、exitCode 与 stdout/stderr 尾部；cwd 统一显示 `[project workspace]`，`pwd` 不暴露绝对路径。
2. 所有硬截断结果仍是可 `JSON.parse` 的有效 JSON；`modelContext` 记录 projection、原始/投影字符数、read 去重与压缩状态，使上下文缩减可测。
3. Trace entry 新增 `projectId`，查询可按 `traceId + projectId` 精确过滤；read 去重状态同样包含项目作用域，不跨项目复用。
4. task 与 legacy 两条 Agent loop 共用 `agent-loop-control.js`，统一为最多 5 次 Provider 请求 / 12 次工具调用；第 5 次请求固定为无工具最终整理轮，不再追加第 6 次请求。工具批次先严格 reserve，只把已接受调用写入 assistant history，并为每个调用生成配对 tool result。
5. malformed JSON、数组或 null 参数返回 `invalid_arguments` 且不执行 handler；重复 Provider call ID 返回 `duplicate_tool_call` 且不执行 handler，写入协议 history 前使用唯一 ID，同时保留原始 `providerCallId` 供诊断。
6. 观察到用户取消后，不再启动剩余已 reserve 的 handler，也不发起后续 Provider 请求；剩余调用返回 `request_canceled`。当前没有公共 `AbortSignal`，因此不声称能中断已开始执行的 handler。
7. 未增加 Provider 特定 prompt，也未改变科学计算的 `run_tool → tool_job → artifact truth`。

验收证据：

- `CI=1 TERM=dumb node --test test/agent-tool-result.test.mjs test/agent-provider-boundary.test.mjs`：18 tests / 18 pass / 0 fail。
- ToolResult 回归覆盖按类型投影、有效 JSON 截断、原始数据截断语义、read 实际入模范围去重、`projectId` Trace 隔离和模型上下文测量元数据。
- 零网络 Provider 边界回归覆盖严格 5 次 Provider 请求/12 次工具调用、无工具最终轮、严格批次上限、malformed/non-object 参数、重复及跨轮碰撞 call ID、协议配对和取消后不再启动后续 handler。
- 原始 ToolResult/SSE/handler 数据未压缩，P7-D 的 UI、审批、result cards 与兼容调用方保持原契约。

提交：

```text
perf(harness): compact agent tool context
```

### P7-H：文档、门禁与真实产品验收

状态：`completed`（2026-07-21）

已实施：

1. 新增单一离线聚合入口 `npm run harness:phase7`：依次执行 `harness:check`、`harness:phase6`、Phase 7 核心契约测试和产品验收脚本；全链零网络、零凭据。
2. CI 使用同一 `npm run harness:phase7`，不再维护重复且易漂移的 Phase 6-era 手写 Harness 测试清单；P7-A 真实 Provider 矩阵继续保留为人工验收，不进入 CI。
3. 新增 `scripts/harness-phase7-acceptance.mjs`，在 `os.tmpdir()` 创建临时真实 workspace，并通过生产 `createAgentToolInterceptor()`、registry schema、workspace preflight 与真实 handlers 验证 list/find/search/read/dry-run/write/replace/exec 和安全拒绝链；`finally` 删除临时目录。
4. 产品验收不访问真实 SQLite、用户项目、Provider 或凭据，不创建科学分析 Job；证据不保存文件正文、绝对路径、命令 stdout 或请求数据，未建立第二套 analysis executor/job/artifact truth。
5. 脱敏证据保存于 `acceptance/harness-phase7/product-acceptance.{json,md}`，并更新 Phase 7 计划、路线图、交接与下一步文档。

验收证据：

- P7-A 人工 live Provider：DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 均为 8/8 PASS。
- `CI=1 TERM=dumb npm run harness:phase7`：manifest 7/7；Phase 6 tests 64/64；Phase 7 核心 tests 68/68；产品检查 13/13；全部 0 fail。
- P7-F 保持 `deferred`；UI-034 保持 `in_progress`，本次离线产品验收不作为视觉实机证据。

提交：

```text
test(harness): close phase7 quality gates
docs(harness): record phase7 acceptance
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

## 9. Phase 7 关闭后的下一步

Phase 7 已于 2026-07-21 完成，不再存在待执行的 Phase 7 工作包。P7-H 的离线聚合门禁、CI 接线和产品链路验收已落地；P7-A live Provider 证据继续保留为人工验收，不进入 CI。

后续先观察 `v0.0.1-rc.6` 与 Phase 7 的真实使用反馈，再独立决定发布签名/公证、x64 Runtime 或新的产品阶段；不得借“收尾”继续扩大命令权限、增加分析流程或改变 `run_tool → tool_job → artifact truth`。

P7-D 的 UI-034 仍为 `in_progress`，只在取得开发壳或打包态视觉证据后单独标记 `verified`，不影响后端 Phase 7 出口结论。P7-F 继续 `deferred`，只有至少 3 个合格真实任务的可复现证据进入仓库后才能重新评审；P7-E 仍未引入 `workspace_patch`。
