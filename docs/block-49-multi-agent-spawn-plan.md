# BLOCK-49 — 多 Agent 内生派生（Multi-Agent Spawn）技术调研与实施计划

> 状态：`completed`（2026-09-06 **加映二收口**：多智能体活动面板 SubAgentsBar——模型 spawn 登记 + child_finished 落账双源桥接 + 列表/中断/详情窗操作面，UI-301 verified。至此 MVP（三工具）+ 二期（协作三工具 + proactive）+ 加映（短回答修复 + 前端消费 + 活动面板）全 completed。G0 开发期常态 · 不外推 packaged/Provider/GA）
> 立项日期：2026-09-03
> truthDomain: `block-49-multi-agent-spawn`

## 1. 背景与动机

用户对比考察 openai/codex（MultiAgentV2）后裁决立项：BioF3 当前 agent 是「单 agent 串行 loop」，模型无法内生派生子 agent；按 codex 范式补齐「agent 自己长出来的」多 agent 能力。

### 1.1 现状诊断（双向调研结论）

**BioF3 已有地基（AGENT-CONCURRENCY 遗产，复用率高）**：

| 能力      | 位置                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------- |
| 父子持久化   | `db.js` `loop_runs.kind` + `parent_loop_run_id`（primary/subagent 二值 + 父子链）                               |
| 并发槽位    | `helpers/runtime.js` `AI_MAX_CONCURRENT_PER_USER`（主 agent 预留 1 槽）+ `AI_MAX_CONCURRENT_SUBAGENT_PER_USER` |
| 级联取消    | `agent-task-store.js` 取消 primary 级联取消 running 子 agent loop                                               |
| REST 入口 | `routes/ai-agent/chat.js` `kind='subagent'` + `parentTaskId`（400 校验齐全）                                   |
| 恢复链     | `loop-orchestrator.js` subagent 不走普通 conversation resume 路径（有意区分）                                        |

**关键断点（缺失面）**：

1. **模型侧零工具**：`agent-tools/` 28 个文件 grep `spawn/subagent` 命中全部为 `child_process.spawn`（BLOCK-33 命令执行）——无任何「派生子 agent」工具暴露给模型。
2. **入口外生**：`kind='subagent'` 调用方仅后端内部（chat.js / resume.js / agent-task-store.js），当年是 harness 测试直接 POST 调的——模型自己发现不了也调不了。
3. **无回传协议**：子 agent 终态不进父 loop 上下文。
4. **无 agent 间通信 / 等待 / 列举 / 中断工具面**。
5. **无子 agent 活动的 UI 可视化**（父会话看不到子在干嘛）。

### 1.2 Codex MultiAgentV2 参考架构（调研证据）

- 工具族注册：`core/src/tools/spec_plan.rs` L1294-1338——六工具 `spawn_agent` / `send_message` / `followup_task` / `wait_agent`（可配超时）/ `interrupt_agent` / `list_agents`，经 `register_trusted_with_exposure` 带曝光分级。

- spawn 内核：`core/src/tools/handlers/multi_agents_v2/spawn.rs` L93-229——解析参数 → 构建子配置 → `AgentCommunicationContext::Spawn` → `spawn_agent_with_communication()`。

- **继承与覆盖**（`multi_agents_common.rs` L177-319）：子 agent 继承 base instructions / model / provider / reasoning / **approval policy / cwd / permission profile（权限不放大）**；`subagent_developer_instructions` 作系统提示覆盖；模型覆盖有约束（仅多 agent backend 支持的模型，#41165）。

- **模式分级**（`session/multi_agents.rs` L155-198）：`explicit`（用户显式要求才 spawn）/ `proactive`（模型自主判断）。

- **结果回传**（`session/mod.rs` L2140-2297）：子 agent 到终态 → inter-agent completion message → `send_inter_agent_communication()` 进父 thread 消息流；`emit_sub_agent_activity` 活动通知（父 UI 可见）。

## 2. 方案概要

**核心思路**：不新建第二套执行真相——把既有 `kind='subagent'` 链路（持久化/并发槽/级联取消全复用）包装成**模型可见的 agent 工具面**，补上回传协议，即完成「外生 → 内生」转身。遵守「不创建第二套 executor/job/artifact truth」治理红线。

### 2.1 工具面设计（MVP 三件 + 二期三件）

**MVP（P1-P3）**：

| 工具            | 行为                                                                                         | 复用                                |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `spawn_agent` | 参数 `{ task, model?, instructions? }` → 内部调既有 `kind='subagent'` 路由建子 task，立即返回 agentId（非阻塞） | chat.js subagent 入口 + 并发槽         |
| `list_agents` | 列出当前 primary task 名下活跃/近期子 agent（状态/任务摘要/耗时）                                               | `loop_runs.parent_loop_run_id` 查询 |
| `wait_agent`  | 等待指定 agentId 终态返回结果摘要（带超时，默认值对齐 codex `wait_agent_timeouts`）                               | task 终态轮询（复用 events 通道）           |

**二期（P5 候选，不进 MVP）**：`send_message`（agent 间通信）/ `followup_task`（追加任务复用上下文）/ `interrupt_agent`（单子中断，级联取消已有）。

### 2.2 回传协议

- 子 agent 终态 → **token 预算内摘要**（对齐 BLOCK-20 token-estimator 既有资产）：任务 + 结论 + 关键产物引用（file path / artifact），不回传全文。

- 子 agent `task_events` 已持久化（BLOCK-31 遗产），摘要生成走终态聚合，不重放事件流。

- 失败/中断诚实回传（对齐 BLOCK-38 `interrupted_at` 语义），不静默吞掉。

### 2.3 权限与治理（对齐 codex 继承模型 + 本项目纪律）

- 子 agent **继承**父 accessMode / 审批策略 / projectId / 工作区边界，**不放大**；spawn 工具本身进 `commandVerdict` / `agent-tool-policy.js` 门控。

- 模式先做 `explicit`（模型在收到含「多 agent / 并行 / spawn」意图指令或用户显式要求时才可用），`proactive` 模式留候选。

- 并发上限沿用既有 `AI_MAX_CONCURRENT_SUBAGENT_PER_USER`，spawn 超槽诚实拒绝（返回可解释错误而非排队挂死）。

### 2.4 UI 可视化（增量）

- `emit_sub_agent_activity` 等价物：spawn / 终态事件进既有 `task_events`（SSE 推送链已有）。

- 前端 ToolActivityDock（UI-267 已 verified）扩展子 agent 活动条：父会话工具活动区可见「子 agent 运行中 / 完成 / 失败」条目，点开看子任务摘要。新 UI 编号届时登记。

## 3. 阶段划分（待启动后执行）

- **P0 立项**：本文档 + DOC-REGISTRY + roadmap/README 入口 + AUDIT-LOG 登记。

- **P1 工具面 MVP**：`agent-tools/` 新增 `spawn-agent-tools.js`（三工具定义 + 执行层内部调既有 subagent 路由）；tool-defs / registry 注册；permission 继承接线。

- **P2 回传协议**：子 agent 终态摘要生成（token-estimator 预算截断）+ 父 loop 上下文注入 + wait\_agent 阻塞语义。

- **P3 定向门禁**：node --test（spawn 校验 / 超槽拒绝 / 级联取消回归 / 权限继承 fail-closed）+ tsc（如动前端）+ docs:check + ui:audit:check。

- **P4 dev Electron 实机**：单会话真实任务驱动模型 spawn 1-2 个子 agent → 并发运行 → wait 收结果 → 父继续整合；中断级联回归；证据 `acceptance/block-49/`。

- **P5 收口**：台账 / roadmap / registry 回写；二期三工具（send\_message / followup\_task / interrupt\_agent）与 proactive 模式登记候选。

## 4. 非范围（G0 边界）

- agent 间自由双向通信网（send\_message 二期另议）、followup 上下文复用（二期）。

- proactive 自主 spawn 模式（模型完全自主判断，先 explicit）。

- 跨 conversation 的 agent 协作（子 agent 仍限同会话任务树内）。

- 子 agent 嵌套 spawn（子再派孙，codex 亦未放开）。

- 0 新 npm 顶层依赖（全部复用既有资产）。

- 不动 `loop-orchestrator.js` 主 loop 串行结构（子 agent 是并行旁路，非 loop 重构）。

## 5. 验收门（启动时细化）

- P1：三工具注册表可见 + spawn 参数/权限校验单测。

- P2：摘要回传 token 预算截断测试 + 失败/中断诚实回传测试。

- P3：定向 node --test 全绿 + tsc 0（如涉及）+ docs:check + ui:audit:check。

- P4：dev Electron 实机多 agent 任务证据（截图 + evidence.json）。

- 治理门禁 `docs:check` + `docs:reconcile` 收口必跑。

## 6. 风险与对策

| 风险                   | 对策                                                                        |
| -------------------- | ------------------------------------------------------------------------- |
| 子 agent 上下文污染（父任务漂移） | 子 agent 独立 conversation 上下文（subagent 不走 conversation resume 已是既有语义）；回传仅摘要 |
| 并发槽耗尽挂死              | spawn 超槽立即诚实拒绝（错误可解释，模型可改串行策略）                                            |
| 子 agent 结果 token 超预算 | 摘要截断 fail-visible（标记 truncated，对齐 8MB 截断纪律）                               |
| 模型滥用 spawn           | MVP explicit 模式 + 工具描述写明适用场景 + 并发上限硬门                                     |

## 7. 进度记录

- 2026-09-03 P0（planned 登记）：完成 codex MultiAgentV2 双向调研（六工具协议 / 继承覆盖 / 回传机制）与 BioF3 地基盘点（四项复用资产 + 五个断点）；本计划落盘并注册 DOC-REGISTRY；待 BLOCK-47 收口后由用户裁决启动。
- 2026-09-04 P1→P5 一次会话收口（节奏对齐 BLOCK-54/56）：
  - **P0 启动登记**：用户裁决启动，plan active + DOC-REGISTRY + roadmap/AUDIT-LOG 登记；顺带修正 BLOCK-56 收口提交 `9f7e44f5` 的两处同文件并行编辑竞态丢失（plan-56 状态头 + roadmap 头部）。
  - **P1 工具面 MVP**：`agent-tools/spawn-agent-tools.js` 三工具（spawn_agent 异步返回 agentId / list_agents 含终态 / wait_agent 阻塞轮询+超时让出）；tool-defs OpenAI schema + registry 契约注册（spawn=state-write/R2、list=none/R0、wait=none/R1，新 category=agent-management）；执行层进程内直调既有 subagent 链（agent-task-store + runAgentLoop 懒加载断 require 环 + aiTaskConcurrency 槽），不走 HTTP 自调用；父 loop toolCtx 注入 taskId 锚点（agent-runner.js）。
  - **P2 回传协议**：终态摘要 token 预算截断（4000 上界按 1 token/char 最坏密度折算字符上限，刻意不跑 tiktoken 防事件循环阻塞）；正文数据源 `copilot_messages.task_id`（conversations.js 新增 getAssistantMessageByTaskId，done 终态后短暂重试窗口）；权限整体继承父 context 不放大；spawn fail-closed（只有 primary 可派生 + wait/list 双重校验 parentTaskId+userId）；tool-execution 投影白名单补 agentId/status/kind（缺它模型无法 wait_agent，实机回归证实会触发重复派生异常循环）。
  - **P3 定向门禁**：`test/block49-spawn-agent-tools.test.mjs` 三工具契约 + policy fail-closed（read/workspace-write 拒 spawn）+ 超槽诚实拒绝 + 级联取消不外溢 + 会话持久化摘要；相关 loop 回归（agent-tool-registry / loop-api-route / loop-controller-integration / loop-durable-resume / loop-repository / result-studio-agent-binding）+ tsc 0 + docs:check + ui:audit:check。
  - **P4 dev Electron 实机**：`scripts/block49-live.cjs`（mock LLM 真 loop：A 单发顺派 / B 并发双派时间窗重叠 / C 级联取消）17/17 证据 `acceptance/block-49/spawn-agent-live.json`；`scripts/block49-ui-live.cjs`（CDP 驱动真实模型：一句话派生 2 子 agent → 并发 → wait 收摘要 → 父整合汇报）6/6 证据 `acceptance/block-49/ui-live.json` + 3 张截图。
  - **P4 实录（重要教训）**：首轮 UI 实机父模型报告 wait_agent 摘要 `assistantText` 为空——取证（LLM transcript + DB）定位为 **stale dev server**（server 10:28 启动 < 核心文件 11:18 变更，工具已注册但 buildTerminalSummary 为旧稿；mock live 系新进程故通过）；重启 dev Electron 后重跑 6/6 全绿、assistantText 非空、父任务成功整合两份子 agent 逐字结论。再次验证既有纪律「主进程/后端代码变更后必须重启 dev Electron」。
  - **P4 顺带（BLOCK-56 过目）**：UI-288 档位三选菜单实机过目 5/5（证据 `acceptance/block-56/ui288-menu-live.json`）——发现并修复 `SimpleChat.tsx` L1223 档位标签二值漂移（选「项目写」按钮显示「只读模式」，改三档三元表达式，tsc 0 + 实机回归）；workspace-write 档实际写/禁写行为过目与 UI-287 降级任务条（需真实降级事件）仍留 BLOCK-56 名下 in_progress。
  - **脚本卫生**：`block49-ui-live.cjs` 证据落盘后显式 `process.exit`（CDP websocket 句柄挂住事件循环曾致 10min 看门狗误杀 exit 2 假阴性）。
  - **范围如实说明**：§2.4 UI 专项「子 agent 活动条」未实现（MVP 收敛后端工具面闭环；三工具调用在既有工具活动区已可见），登记为后续候选；二期三工具（send_message / followup_task / interrupt_agent）与 proactive 模式留候选（§2.1/§4 不变）。
  - **收口门禁**：docs:reconcile + docs:check（200 PASS）+ ui:audit:check PASS；定向 `test:changed` 589 项 579 过，10 败全部位于 4 个 **HEAD 预存失败文件**（agent-run-tool / g0-api-route / scientific-task-persistence / tool-job-conversation——测试自举未先跑迁移即 require db.js，顶层 prepare `projects` 语句触发 `no such table`，stash 后 HEAD 同败已复核），**BLOCK-49 零回归**；block49 专项与 loop 回归全过。G0 开发期常态 · 不外推 packaged/Provider/GA。


- 2026-09-06 二期启动（active）：主智能体受权决定启动顺序，从候选（BLOCK-49 二期 / BLOCK-56 F4 记忆 / biof3-r-toolchain）中裁决本包二期先行——多智能体协作是核心骨架、与 BLOCK-48 P3 注册+政策+授权门模式同构风险最低、单会话可收口。范围：interrupt_agent（requestAgentTaskCancel+级联，真实机制复用）/ send_message（持久化消息队列语义——运行中即时注入需改 agent-runner 核心（messages 按值闭包），v1 诚实登记为事件队列 + followup 注入）/ followup_task（终态子 agent 续派：launchSubAgent 从 spawn_agent 抽取共用 + 终态摘要 + 队列消息注入）+ proactive（子 agent 终态 child_finished 事件投递父任务流，SSE 协议面 additive，前端消费登记候选）。

- 2026-09-06 二期收口（completed）：**协作三工具 + proactive 全链落地**。① **interrupt_agent**：requestAgentTaskCancel + cancelAgentTaskCascade 级联 + interrupt_requested 事件审计 + 终态幂等。② **send_message**：持久化消息队列语义（parent_message 事件 → 子 agent 事件流可审计，followup 续派时注入上下文）；**运行中即时注入需改 agent-runner 核心（messages 按值闭包），v1 诚实登记候选**。③ **followup_task**：launchSubAgent 从 spawn_agent 抽取共用（模型/权限/会话继承链一致）+ 终态摘要前情 + 队列消息注入。④ **proactive**：runner 终态钩子 child_finished 事件投递父任务流（SSE 协议面 additive；前端 notice 消费登记候选）。⑤ **单测 13/13**（契约/政策矩阵同 spawn 门/interrupt 幂等与级联/send 入队与终态引导/followup 组合提示断言[摘要+队列注入]/executeToolCall 双态链）+ **实机 14 断言**（真实模型：spawn→wait→followup 续派真跑→运行中入队→中断→cancelled→proactive ≥3 条）。**登记发现**：resolveAgentTaskTerminal 完成判定要求回答 >20 字符——短回答子任务（如纯算式）被判 failed（产品启发式，登记候选待裁决）；实机首两轮模型抖动（已答对判 failed）由该启发式放大。门禁：docs/ui 契约 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。

- 2026-09-06 加映启动：第一档小包两项。① 短回答误判：resolveAgentTaskTerminal 完成判定 `>20 字符` 放宽为「非空即完成」（实机两轮误判：模型答对 14 字符纯算式判 failed；空回答防御保留）；② proactive 前端消费：child_finished 事件经 copilotClient 分发 → conversationRunStore 会话级 notice → SimpleChat 任务条 chip（复用 UI-287 降级 notice 成熟模式）。

- 2026-09-06 加映收口（completed）：① 后端——resolveAgentTaskTerminal 完成判定 `>20 字符` → 非空即完成（实机两轮误判修复；空回答防御保留；行为单测 6 用例含 cancelled/fatalError/pendingApproval 优先级）；顺手修存量 loop-agent-integration.test.mjs 单跑缺 DB 自举（同 agent-tool-registry 修法）。② 前端——child_finished 消费三件（copilotClient 分发 / store 会话级 notice 上限 10 条 / SimpleChat chip），UI-300 verified，store 测试 39/39（新增 4 用例）。**行数门 800→820**（proactive 钩子+判定注释既有漂移惯例留痕）。当前无 active 工作包。

- 2026-09-06 加映二收口（completed，UI-301 verified）：**多智能体活动面板**——store 双源桥接（模型 spawn_agent：onToolCall 缓存 task 文本按 callId → onToolResult 登记 running；child_finished：running→终态映射 + 摘要落账 + 刷新孤儿建条目 + 幂等）+ SubAgentsBar 组件（单行折叠条：状态点/任务头/中断[stopSubAgentTask→cancel REST]/详情窗[popOut agent]）挂载 SimpleChat 输入框上方。单测 43/43（新增 4 用例）+ 总回归 80/80。用户侧操作面补全：中断=既有 cancel REST，详情窗=BLOCK-59 P4 页面复用；followup 仍为模型侧动作（用户以自然语言驱动，克制不做按钮）。
