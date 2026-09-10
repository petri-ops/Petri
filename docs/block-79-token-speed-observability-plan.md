# BLOCK-79 — Token 速度可观测：按供应商的输出速率（统一展示面）

> 状态：`completed`（2026-09-10 立项即整包完成，UI-332 verified，实机 5/5 allPass）
> 立项日期：2026-09-10
> truthDomain: `block-79-token-speed-observability`
> 来源：用户提问「你能否拿到 token/s 这种速度信息呢」→ 主 Agent 核实数据面后给出三档工作量评估 → 用户裁决「统一的 增加，我还是希望你能看到不同供应商的 token 的速度情况的」

## 1. 用户裁决

- 2026-09-10：「有个需求 你能否拿到 token/s 这种速度信息呢」——提出问题。
- 2026-09-10 主 Agent 核实后回复：**能，原始数据已在库**（`ai_usage` 表含 `completion_tokens` + `latency_ms`），但没有任何地方算成速率；`summarizeAiUsage` 完全不聚合延迟，`/api/ai/usage-mine` 已返回 `avg_latency` 而前端未显示；缺 TTFT（分不出纯解码速度）与流中 token 计数（做不了实时速率）。
- 2026-09-10 用户裁决：**「统一的 增加 我还是希望你能看到不同供应商的 token 的速度情况的」**——① 统一在一处展示（不散落）；② 落为工作包增量；③ **必须能区分不同供应商的速度**。

## 2. 背景与动机

- 用户在真实使用中会配置多个供应商（原生 DeepSeek、DashScope、自定义 OpenAI 兼容渠道、本地 Ollama / LM Studio / vLLM 等），不同渠道的实际吞吐差异显著，但目前**没有任何界面能看到速度**：设置页「用量与资源」有 30 天调用数、输入/输出 token、缓存命中率、估算成本，唯独没有速率。
- 数据其实已经在收集：每次 LLM 调用都会写一行 `ai_usage`，其中 `latency_ms` 是完整墙钟耗时。缺的不是采集，而是**归因（provider）+ 成对聚合（token × 时间）+ 展示**。

## 3. 目标形态

- **统一一处**：设置页「用量与资源」面板（`UsageResourcePanel`）扩展为按供应商分组的用量与速度视图——每行一个供应商，显示调用数、输出 token、平均延迟、**输出 tokens/s**、以及在数据不足时的诚实标注。
- **速率口径（诚实定义）**：`输出 tokens/s = SUM(completion_tokens) ÷ (SUM(latency_ms) / 1000)`。这是**端到端平均输出速率**，包含排队、首 token 前的 prefill、decode 与网络往返，因此是真实解码速度的**下限**；输出越长越接近真值。界面文案不得称其为「解码速度」。
- **按供应商归因**：以模型配置 profile 的 provider id 为键（用户心智中的「供应商」），标签用于展示。
- **不可算即标注**：供应商未返回 usage 时（见 §4 渠道边界 `completion_tokens = 0`），该供应商速率显示为「不可算（未返回用量）」而非 0 或估算值。

## 4. 现状代码事实（2026-09-10 核实，HEAD 面）

**记账表**：`core/biof3-server/helpers/ai-usage.js` 建 `ai_usage` 表——`user_id / ts / kind / model / prompt_tokens / completion_tokens / **latency_ms** / cache_read_tokens / cache_creation_tokens / cost_cny / cost_status / error_code / conversation_id`，索引 `(user_id, ts)` / `(ts)` / `(kind, ts)`；**无 provider 列**。该文件已有 4 个 additive `ALTER TABLE ... ADD COLUMN` 迁移先例。

**记账点**：`usageArgs(telemetry, body, startedAt, usage, errorCode)`（`core/shared-backend/llm-providers/deepseek.js:47`）只取 `telemetry.{userId,kind,conversationId}` + `body.model` + usage；`latencyMs = Date.now() - startedAt`。`startedAt` 打在请求发出前（非流式 `:185` / 流式 `:262`），流式在 `finish`（流结束）时记账（`:308`）→ **latency = 整次请求墙钟**。anthropic / dashscope / dashscope-vision 同样记 `latencyMs`。

**供应商归因现状**：`telemetry` 由调用方构造，**不含 provider**（`core/biof3-server/routes/ai-chat.js:132` kind=`tool_summary_retry`、`:405` kind=`chat`）；provider 身份在网关层已确定——`core/biof3-server/helpers/model-gateway.js` 用 `profile.provider` 取密钥并 `providers.getProvider`，provider 实例带 `this.providerLabel`（`deepseek.js:80`）。→ **最小归因路径**：网关在 dispatch 前把 `profile.provider` 注入 `telemetry`（一处），`usageArgs` 透传，表加 additive 列。

**消费面现状**：
- `summarizeAiUsage`（`ai-usage.js:71`）只 SUM token 与成本，**不聚合 latency**；喂 `/api/ai/loop/summary`（`core/biof3-server/routes/ai-loop.js:103`）→ 前端 `LoopSessionSummary.usage`（`frontend/src/lib/loop-client.ts:113-132`）→ 摘要卡「任务循环」节：**有 token、有成本、无速度**。
- `GET /api/ai/usage-mine?days=N`（`core/biof3-server/routes/ai-misc.js:58`）已返回 `AVG(latency_ms) AS avg_latency` + token 总和 + `cache_hit_rate` + `cost_status`；前端 `frontend/src/components/desktop/DesktopSettingsPanel/sections/UsageResourcePanel.tsx` 只用调用数 / 输入输出 token / 缓存命中 / 估算成本——**`avg_latency` 拿到了却未显示**。
- 管理面 `core/biof3-server/routes/ai-admin.js:184/191` 有按天按 kind 聚合。

**口径陷阱**：`kind` 取值为 `chat` / `chat_turn` / `embedding` / `tool_summary_retry`（`ai-chat.js:137/337/343/407`）——`embedding` 无输出 token，**速率聚合必须按 kind 过滤**，否则分母被污染。

**渠道可得性边界**：`stream_options: { include_usage: true }` 是 DeepSeek/OpenAI 扩展且会被部分兼容网关拒绝，代码只对原生 deepseek profile 添加，其它渠道（自定义 / Ollama / LM Studio / vLLM）走可移植形状（`deepseek.js:265-275` 注释）→ 这些渠道 `completion_tokens` 可能为 0，**速率不可算**，须诚实标注。

## 5. 阶段划分（P0–P3 串行，每阶段独立提交 + 定向测试）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 口径与归因裁决** | ① 速率口径写入契约（端到端平均输出速率、下限语义、禁止称「解码速度」）；② provider 归因键裁决（`profile.provider` id + 展示标签；`this.providerLabel` 仅作标签）；③ kind 过滤白名单（含/排除哪些 kind）；④ TTFT 是否本期做（见 §6 非范围默认不做） | 口径与归因获用户确认 |
| **P1 后端归因 + 成对聚合** | ① `ai_usage` 加 additive `provider` 列（沿既有 ALTER 先例）+ 必要时 `(provider, ts)` 索引；② 网关 dispatch 前注入 `profile.provider` 到 telemetry → `usageArgs` 透传 → `recordAiUsage` 落库（旧行 provider 为 NULL，按「未归因」呈现，零回填）；③ **新增**按供应商分组的汇总函数（`SUM(completion_tokens)` / `SUM(latency_ms)` / `COUNT(*)` / 输出速率 / 不可算计数），**不改既有 `summarizeAiUsage` 返回契约**；④ 端点：`/api/ai/usage-mine` 增 provider 分组段（additive 字段） | 后端定向测试绿；旧调用面零回归 |
| **P2 统一展示面** | 设置页「用量与资源」面板扩展：按供应商分组表（供应商 / 调用数 / 输出 token / 平均延迟 / 输出 tokens/s / 不可算标注）+ 把已返回未使用的 `avg_latency` 显性化；文案遵守 P0 口径（「端到端平均输出速率」）；无数据诚实空态；顺带裁决是否在摘要卡「任务循环」节加一行会话级速率（与 BLOCK-78 协同，**后做者复用前者聚合函数**） | 面板在真实多供应商配置下展示正确 |
| **P3 实机验收 + 收口** | dev Electron 实机：真实调用后核对面板数值与库内 `SUM(completion_tokens)/SUM(latency_ms)` 逐项一致；原生 deepseek 与「未返回用量」渠道的可得性差异如实呈现；UI 台账回写；整包收口 | 验收证据 `acceptance/block-79/` + 整包 completed |

## 6. 非范围（exclusions）

- **不做 TTFT / 纯解码速度**：需要流式循环内首 chunk 打点并加列，属独立改造；本期只做端到端平均输出速率。
- **不做流式实时速率**（边生成边跳动）：流中拿不到真实 token 数（usage 仅在流末由供应商返回），用字符数估算属编造边缘，不做。
- 不做通用仪表盘/趋势图表（沿用 BLOCK-78 的降噪立场）。
- 不做旧数据回填（历史行 provider 为 NULL，按未归因呈现）。
- 不按项目/会话做速率面板（那属 BLOCK-78「运行时投影」的消费面，本包只提供聚合能力）。
- 不外推 packaged/Provider/GA（G0 纪律）。

## 7. 依赖与协同

- **BLOCK-78-SUMMARY-CARD-RUNTIME-PROJECTION（planned）**：摘要卡「任务循环」节若要显示会话级速率，复用本包 P1 的聚合函数与 provider 归因，不建第二套聚合；两包启动顺序后到者复用前者。
- **既有遥测面（AI_USAGE_v1）**：本包是 additive 扩展（新列 + 新聚合函数 + 新返回段），不改既有 `summarizeAiUsage` / `ai_usage` 既有列语义。
- **模型配置面**（`helpers/ai-settings.js` profile / `model-gateway.js`）：provider id 来源，只读不改配置语义。

## 8. 验收门

- 定向：`ai-usage` / `usage-mine` 路由 / 网关注入面定向测试 + `tsc` 0。
- 数值一致性：面板显示值 = 库内 `SUM(completion_tokens)/SUM(latency_ms)` 重算值（实机逐项对账）。
- 治理门禁：`npm run docs:check` + `npm run docs:reconcile` + `npm run ui:audit:check`。
- UI 台账：实现同提交登记对应 `UI-###`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 速率被误读为「模型解码速度」 | P0 把口径写入契约；界面文案固定「端到端平均输出速率（含首 token 与网络）」；文档同步 |
| 部分渠道无 usage → 速率缺失被误当 0 | `completion_tokens = 0` 的调用单独计数，展示「不可算（未返回用量）」；面板文案说明渠道差异 |
| embedding / retry 调用污染分母 | kind 过滤白名单在聚合函数内实现，并由定向测试锁定 |
| 归因加列触及既有记账链路 | 只用 additive 列 + 新函数；既有 `summarizeAiUsage` 返回契约不动；旧行 NULL 不回填 |
| 与 BLOCK-78 争同一展示面 | P2 明确「后做者复用前者的聚合函数」；本包只做设置页统一视图 |

## 10. 治理边界

- 单一真相：`ai_usage` 仍是唯一用量账本，本包只加归因列与新聚合读面，不新建第二套用量存储。
- 禁止在缺数据时伪造速率（供应商未返回 usage → 诚实标注不可算）。
- 启动前置：无硬前置；按单工作包串行纪律排队（BLOCK-76 为当前 active）。

## 11. 进度记录

- 2026-09-10 **整包完成（UI-332 verified）**：用户「冲 逐个击破」裁决当日完成 P0–P3。**P1 后端**：`ai_usage` additive `provider` 列 + `(provider, ts)` 索引 + `recordAiUsage` 透传 + `model-gateway` chat 循环 attempt 级注入（`telemetry.provider = profile.provider`，fallback 换档即换归因；`!telemetry.provider` 防覆盖调用方显式值）+ deepseek/anthropic usage 记账透传 + `summarizeProviderUsage`（成对聚合 `SUM(completion_tokens)/SUM(latency_ms)`，kind 排除 embedding，`completion_tokens=0` 计 noUsageCalls → measurable=false，旧行 NULL 归「(未归因)」组；**既有 summarizeAiUsage 契约零改动**）+ usage-mine 增 providers 分组段。**P2 前端**：设置页「供应商速率（30 天）」分组区（provider/调用数/输出 tok/s/输出 token/平均延迟；不可算标注；`avg_latency` 首次显性化并标注含 embedding）。**P3 实机**：`block79-provider-live.cjs` 5/5 allPass——真实推理一轮（模型回「收到」）→ providers 分组 → 端点 vs 库内重算（readonly·同 user 过滤）逐组一致。**实机抓环境事实**：脚本直驱网关时必须同时设 `BIOF3_DB_PATH`+`BIOF3_LOCAL_DATA_DIR`（db.js:20 DB_PATH 优先 BIOF3_DB_PATH，缺省回落 core/biof3-server/biof3.db 第二库——不设则归因行落错库，usage-mine 永远读不到）。范围外守住：TTFT/流式实时速率/旧数据回填均未做。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-09-10 **立项登记（planned）**：用户提问「能否拿到 token/s」→ 主 Agent 核实（`ai_usage` 已含 `completion_tokens` + `latency_ms`；`summarizeAiUsage` 不聚合延迟；`usage-mine` 已返回未使用的 `avg_latency`；缺 TTFT 与流中计数）→ 用户裁决「统一的 增加，要能看到不同供应商的 token 速度」→ 本计划落盘并注册 DOC-REGISTRY。关键设计：速率口径=端到端平均输出速率（下限语义）、provider 归因=网关注入 `profile.provider`（additive 列）、kind 过滤排除 embedding、渠道无 usage 时诚实标注不可算。G0 开发期常态 · 不外推 packaged/Provider/GA。
