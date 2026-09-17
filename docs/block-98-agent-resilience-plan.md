# BLOCK-98-AGENT-RESILIENCE — Agent 长任务韧性：上下文三层压缩 + 摘要注入 + 防呆 + 输入插队

> 状态：**active / P0-LAUNCH**（2026-09-17 启动，用户裁决原话「继续推工作」+ AskUserQuestion 选「BLOCK-98 智能体韧性 (Recommended)」；启动门槛两条均已满足=BLOCK-97 当日收口 + 工作区净）
> 立项日期：2026-09-17 · 行号基线：`8bf67dd1`（工作区另有 BLOCK-97 在制 WIP，见 §0 启动门槛）
> 用户裁决原话：「整理成一个 BLOCK 立项候选」「要全面深挖 尽可能通过这些机制的嵌入让gewu项目变得更稳重」（2026-09-17，在「ZCode 是如何做到长任务不中断」技术解剖会话上）

## §0 背景与启动门槛

用户在本会话提出「ZCode 如何做到长任务不中断？spec？长任务编排器？」，随后裁决把 ZCode 的机制全面深挖并移植进 Gewu，让「提出需求→等待→拿到预期结果」的稳定体验落地到本产品 copilot。本会话已完成对 ZCode 本体（`zcode.cjs` 11.4MB bundle + 主库 db.sqlite 431MB + rollout 模型 IO 日志）的完整解剖，结论沉淀于 §2/§3，作为本包移植规格。

**启动门槛（两条，对标 BLOCK-92 先例）**：

1. **BLOCK-97-AGENT-TODO-CARD 收口**：BLOCK-97 在制文件面（`agent-runner.js` / `conversationRunStore*` / `CenterPanel*` / `impact-map.json`）与本包 M3/M4 面重叠，并行会话持有期间本包零触碰；启动前提=BLOCK-97 已收口且工作区净。
2. **用户显式裁决启动**（planned 队列序）。

## §1 范围

六工作面（M1–M6），全部服务于一个目标：**copilot agent 长任务不中断、可恢复、诚实可见**。

| 面 | 内容 | 主落点 |
| --- | --- | --- |
| M1 | **microcompact（本地三层压缩第 0 层）**：LLM 视图中旧工具结果按组清理为占位符，零模型成本 | `helpers/history-assembly.js` 视图层 + 新 helper |
| M2 | **auto-compact 升级（第 1 层）**：B2 单层摘要升级为结构化摘要注入（9 章节模板 + 全文转写落盘 + 路径回查指针 + 续接指令）；阈值公式化（输出预留 + 缓冲 + provider 真值覆盖） | `helpers/conversation-compaction.js` + `token-estimator.js` |
| M3 | **防呆三件套 + reactive（第 2 层）**：rapid-refill 防抖（压缩后即满死循环上限）/ 连续失败熔断 / context-exceeded 反应式压缩原地重试 | agent-runner turn 环 + `ai-bridge` 错误分类 |
| M4 | **输入插队队列（steering）**：agent 运行中用户消息入队，下一轮请求自动带上；前端排队可见 | `ai-chat.js` / agent-runner 注入点 + SSE + store |
| M5 | **请求韧性遥测**：attempt/retryable/context_exceeded/cancelled_by_user 字段落 ai_usage；重试退避现状盘点补全 | `llm-client` / ai_usage 表 |
| M6 | **实机验收 + 灰度收口**：dev-verify flow、对账数字、翻默认裁决呈报 | `scripts/block98-*-live.cjs` + acceptance/block-98/ |

## §2 非范围（exclusions）

- **checkpoint/rewind 工作区快照回退**：本仓有 git 兜底，内容寻址快照库成本收益不划算，登记远期候选不实现。
- **workflow 持久化编排引擎**（ZCode `workflow_*` 表族 / DWF）：与单工作包串行纪律不匹配，不做。
- **定时自动化（cron/off-peak 调度器）**：另一产品域，另行立项候选。
- **跨会话记忆系统**：`user-facts` 已有雏形，本包不扩。
- **LLM 原文红线不破**：`copilot_messages` 原文永不删改（BLOCK-95 §4 原则 1 延续）；压缩只作用于 LLM 视图层。
- **BLOCK-97 文件面零触碰**（启动前）；0 新依赖。

## §3 ZCode 机制解剖结论（移植规格，2026-09-17 实测取证）

### 3.1 三层上下文压缩

- **Tier-0 microcompact（本地，零模型成本）**：把历史中旧工具结果内容替换为 `[Old tool result content cleared]` 占位符。触发=空闲超 60 分钟 或 估算 token ≥ min(窗口×0.9, 窗口−2000)；只清**连续 ≥5 条**同组可清理工具（Read/Bash/Grep/Glob/WebFetch/WebSearch/Edit/Write/ApplyPatch），保留最近 5 组；已清内容有标记防重复清理。
- **Tier-1 auto-compact（模型摘要）**：`有效窗口 = contextWindow − min(maxOutput, 21K)`；`压缩阈值 = 有效窗口 − 13K 缓冲`（200K 窗口≈166K 触发）。token 计数优先 provider 真值（cache-aware usage 覆盖本地估算）。判定拒绝理由枚举：`disabled / not_enough_messages / circuit_breaker / below_threshold / above_threshold`。
- **Tier-2 reactive（超限兜底）**：API 返回 context-exceeded 时强制压缩，成功后**重建 turn 状态机原地重试**，用户无感。
- **防呆**：连续压缩失败 ≥3 次熔断（circuit_breaker）；压缩后 rapid-refill（急速回填）计数上限 3、工具轮阈值 3，防「压缩→撑爆→再压缩」死循环。

### 3.2 摘要注入模板（压缩后「无缝」的原因）

- 摘要提示词：先 `<analysis>` 后 `<summary>`，**9 个必填章节**：①用户原始请求与意图 ②关键技术概念 ③文件与代码段（含完整片段）④错误与修复（尤其用户纠正过的行为）⑤问题求解 ⑥全部用户消息清单 ⑦待办任务 ⑧压缩前一刻正在做什么 ⑨下一步（必须与用户最近请求直接对齐，防任务漂移）；安全相关指令**逐字保留**；摘要器被明令「只许文本、禁止工具调用」。
- 注入开场白三要素：声明「本会话由前文压缩续接」+ **全文转写磁盘路径**（模型可用 Read 工具回查精确代码/报错——摘要+转写双保险）+ **续接纪律**（"Continue from where it left off — do not acknowledge the summary, do not recap… as if the break never happened"）；另有「最近 N 条原文保留」。
- 压缩边界（compactBoundary）随消息链持久化：会话重载时 `findLastIndex(isBoundary)` 从边界重建活动链；边界同时是 rewind/fork 的语义锚点。

### 3.3 输入插队（steering）

运行中用户消息**不拒绝而是入队**（`session_input`：admitted→promoted，实测 577 条 promoted）；每个模型请求边界 `drainPendingInput` 排空队列注入下一请求——「边跑边补充需求」不丢消息的机制根基。

### 3.4 请求韧性与遥测

每次模型调用带 attempt 序号，api_retry 事件含 `attempt/maxRetries/retryDelayMs/errorStatus`；usage 表持久 `retryable/context_exceeded/cancelled_by_user` 字段——「外有重试、内有防抖」双层防中断，且全部可审计。

### 3.5 状态外置（ZCode 稳定感的架构根基，本包只借鉴原则）

真状态全在 SQLite（session/message/part/session_entry/todo 表）+ 大体积工具结果外溢内容寻址 artifact 存储（242MB）+ 模型 IO 全量 rollout 日志。模型上下文是消耗品，盘上状态才是真大脑。

## §4 本仓现状承重事实（基线 `8bf67dd1`，启动时 P0 必须重定位）

| 事实 | 位置 | 与本包关系 |
| --- | --- | --- |
| B2 会话级 rolling compaction（**单层**，默认关 `BIOF3_SESSION_COMPACTION`）：12K token/24 条触发、保留最近 12、500 字中文摘要、`conversation_compaction` 表 covers_rowid 投影、诚实标记卡 A5 | `core/biof3-server/helpers/conversation-compaction.js`（全文 179 行已通读） | M2 的升级基座，不推倒重来 |
| token 估算：tiktoken cl100k（优于 ZCode 的 chars/4 估算），`countTokens/countMessages` | `helpers/token-estimator.js` | M2 阈值公式直接复用 |
| B1 后端拼装（compaction 的架构前提） | `helpers/history-assembly.js` | M1 视图层清理挂载点 |
| B3 cache 断链已修（ai_usage 命中率实测 96.8%） | ai_usage 表 + ai-bridge | M2 provider 真值覆盖 + M5 遥测挂点 |
| agent 主循环 `runAgentLoop`（895 行文件）+ loop-orchestrator（1241 行门） | `core/biof3-server/agent-runner.js:316` | M3/M4 注入点；行数门零触碰（新增逻辑下沉 helpers，BLOCK-92 家法） |
| llm-transcripts 落盘机制已存在（BLOCK-95 验证数据提及「llm-transcripts 源文件」） | 待 P0 勘察确切路径与格式 | M2 「全文转写路径」指针可复用性判定 |
| BLOCK-97 task_todo 在制（工作区 WIP）：`agent-tools/todo-tools.js` + conversationRunStore/conversationTodos.ts | 并行会话持有 | M2 摘要模板「待办任务」章节将来可引用 task_todo 状态（P0 对齐） |
| dev-verify flow 框架 + closeout 五门 + D7/D8 例外家法 | scripts/dev-verify | M6 验收载体 |

## §4.1 P0 结论（2026-09-17，HEAD e2ec7c36 重定位 + 四项勘察 + D1-D7 落定）

- **§4 重定位**：agent-runner 现 958 行（runAgentLoop 结构未变，BLOCK-97 emitAssistant 接线在其内）；loop-orchestrator 仍 1241 行（本包零触碰达成，M1 接线点改在 agent-runner callChatProvider 包裹——比 plan 预想的 loop 内更优：请求体投影副本替换，loop 行数门与运行时数组双零触碰）。B2/token-estimator/ai_usage/dev-verify 承重面与 §4 一致。
- **勘察①llm-transcripts**：`<DATA_DIR>/llm-transcripts/<conversationId>.jsonl`（BLOCK-37，model-gateway 落盘+轮转）现成可复用——M2 摘要内写转写路径面向**用户/审计可见**；模型经工具回查=能力缺口（路径在 DATA_DIR 不在项目工作区内，workspace 工具读不到），诚实登记为远期候选，摘要 9 章节自包含为主。
- **勘察②provider 窗口真值**：`getContextWindow(modelName, provider, baseUrl, apiKey, preset)`（token-estimator，agent-runner token_budget 已用）+ `model_profiles[].contextWindow`——D3 公式直接接此真值，无需新建。
- **勘察③ai-bridge 错误分类现状=无**：128 行全 `catch {}` 静默，无结构化分类——M3/M5 的 context-exceeded/retryable 判定为新建（P3 落 agent-resilience.js，从 provider 抛错信息分类）。
- **勘察④run 中用户消息现状**：`POST task/:id/message` 留言通道**仅子 agent 且不注入运行中循环**（源码自述「运行中即时注入需 loop 核心支持（登记候选）」，续派时才注入）；primary 任务无通道——M4=留言队列升级为运行中注入（task_events 入队 + loop 轮边界 drain）。
- **D1-D7 落定**：全部按 §5 预置推荐（plan 自带「未应答按推荐先行留痕」授权，用户放权惯例；可逆、有总开关）。分组语义适配结论：ZCode「连续 ≥5 条」按本仓 assistant(tool_calls)+tool 交替格式适配为「同一调用批次内 ≥2 条工具结果成组」（语义等价：成组才折、零散不折），已回写 §4。

## §5 设计裁决项（P0 呈报，预置推荐先行可逆留痕）

| # | 裁决项 | 预置推荐 |
| --- | --- | --- |
| D1 | microcompact 挂载层：LLM 视图层（B1 拼装后投影，DB 原文不动） vs 内存 history | **视图层**——延续 BLOCK-95 红线与 A5 诚实标记，清理行为对用户可见可审计 |
| D2 | 摘要模板：中文 9 章节结构化（对齐 ZCode 语义本地化）+ 转写路径指针 + 续接纪律 | **是**；转写复用 llm-transcripts（P0 勘察确认），路径写进摘要消息 |
| D3 | 阈值公式：`ctx − min(maxOut, 21K) − buffer`，buffer 对小窗口模型缩放为 `min(13K, 8%×有效窗口)`（本仓多 provider 64K~128K 窗口，ZCode 常数按 200K 标定不能硬抄） | **公式化 + provider 真值覆盖**（ai_usage 已有真值）；固定 12K 退役 |
| D4 | 防呆三件套 + reactive 一次做齐 vs 分期 | **一次做齐**（三者共享同一套状态机，拆开反而两次改 agent-runner） |
| D5 | 插队队列语义：一期「下一轮请求注入」 vs ZCode 级 per-request drain | **一期下一轮注入**（产品语义已达标，drain 细粒度留评估项须有结论） |
| D6 | 灰度开关：新增 `BIOF3_AGENT_RESILIENCE` 总开关（M1–M3），与 B2 开关关系收口时一并呈报 | **总开关默认关，收口时用户裁决翻默认**（B2「默认关待裁决」悬置一并了结） |
| D7 | M5 遥测字段 additive 落 ai_usage 现表 vs 新表 | **现表 additive 加列**（对标 BLOCK-96 F3 错误码表先例，不建第二真相） |

## §6 分阶段计划（裁决后串行）

- **P0-LAUNCH**：启动门槛核对（BLOCK-97 已收口+git 净）→ §4 行号/事实全量重定位 → D1–D7 呈报落定（未应答按推荐先行留痕）→ llm-transcripts 复用性、provider 窗口配置盘点、ai-bridge 错误分类现状、run 中用户消息现状行为四项勘察结论回写本 plan。
- **P1**（M1）：microcompact 视图层清理 + 占位符中文标记 + 分组保留策略 + 契约测试。
- **P2**（M2）：阈值公式化 + provider 真值覆盖 + 9 章节摘要模板 + 转写路径指针 + 续接纪律注入；A5 诚实标记卡兼容升级（前端触碰最小化）。
- **P3**（M3+M5）：防呆三件套 + reactive 原地重试 + api_retry/context_exceeded 遥测 additive。
- **P4**（M4）：输入插队队列（服务端排队 + 下一轮注入 + SSE 事件 + store 排队态展示；UI 增量按 ui-productization-audit 同提交登记 UI-###）。
- **P5**（M6）：dev-verify flow `block98-resilience`（长会话驱动三层压缩逐层触发断言）+ 对账数字（压缩率/回查命中/插队零丢失）+ closeout + 翻默认裁决呈报。

## §7 验收门禁（收口时逐项对账）

1. 契约测试：microcompact 分组/触发/占位（≥10 断言）+ 阈值公式表驱动（≥8）+ 防呆状态机（≥8）+ 插队入列/晋升/丢弃语义（≥6）——Node `node --test`，新文件挂 impact-map。
2. 实机 flow：`npm run verify -- block98-resilience` allPass，证据 `acceptance/block-98/`；关键对账=压缩后 token 对账（延续 B2 方法）、摘要内转写路径真实可读、插队消息端到端零丢失。
3. 红线回归：`copilot_messages` 原文 diff 为零；A5 诚实卡照常渲染；B2 既有契约全绿不回退。
4. 邻接回归：BLOCK-97 task_todo 契约全绿；loop/agent 族定向；前端 vitest 定向 + tsc 0。
5. 治理门禁：`docs:check` + `ui:audit:check` + closeout fail-fast 全绿；行数台账棘轮不回退（agent-runner 新增逻辑下沉 helpers）。
6. 未验证范围如实声明（G0 开发期常态 · 不外推 packaged/Provider/GA，全量 test:all 留 CI）。

## §8 风险与回滚

- **多 provider 窗口差异**（64K 级模型常数错配）→ D3 缩放公式 + 表驱动测试覆盖；错配最坏退化为「提前压缩」，不炸任务。
- **摘要质量回归**（9 章节 vs 现 500 字要点，token 成本上升）→ 摘要 maxTokens 上限保护延续（B2 现 800，P2 重定标）；成本对账数字进收口报告。
- **agent-runner 行数门**（1241/1250）→ M3/M4 逻辑全部下沉 `helpers/agent-resilience.js` 新文件，runner 只留接线。
- **插队语义歧义**（用户以为立即生效）→ 排队态前端明示（「已排队，将在当前步骤后加入」），诚实可见红线。
- **总回滚**：总开关 `BIOF3_AGENT_RESILIENCE=0` + B2 开关既有独立回滚路径，全部灰度可逆。

## §9 完成语义

六工作面 M1–M6 逐面收口；§7 门禁全绿 + 两开关翻默认经用户显式裁决；canonical 回写（本 plan §6/§7 + roadmap + handoff + AUDIT-LOG + impact-map + ui-productization-audit 如涉 UI）；`docs:reconcile` + `docs:check` 过；registry `active → completed`。遗留候选（checkpoint/rewind、编排引擎、定时自动化、drain 细粒度）登记于此节保留 discoverable，不另立文档。
