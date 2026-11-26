# 后端 Harness 全面能力评估（第二轮，超越稳定性）

> 发令：owner msg_9bad43ff203d「目前确实能完成一个需求，交付结果了，但是总觉得不够全面，给点建议」。
> 基线：origin/main @ `9842cad69`（BLOCK-520 稳定性/可观测性 P0/P1/P2 + harness 隐形优化 7 队列均已并入）。
> 性质：只读评估 + 机械小项落地；一切评级以当前代码证据为准（路径:行号），不臆测、不重复评第一轮已落地 OB 项。

## §0 评估框架（对照业界公开能力光谱自建）

参照 Claude Code（权限分层/检查点/子 agent/成本透明）、Codex（沙箱/审批/任务恢复）、Manus/Devin（任务 DAG/规划执行/交付校验）公开实践，自建 8 维矩阵：①可靠性 ②可恢复性 ③安全性 ④性能与成本 ⑤可扩展性 ⑥编排 ⑦可观测性（**第一轮已落地，本轮仅标注不重复评**）⑧交付质量。
评级口径：**A=机制完整且代码可证；B=主干在、有明确缺口；C=局部/默认关闭/依赖人工；D=结构性缺位**。

## §1 逐维度评级与证据

### ①可靠性 — B
- 已有：LLM 重试+provider fallback（`model-gateway.js:34-42,194-232,366-399`，含 400 去参重试 `__dropThinking`）、stall 退避（`llm-client.js:81-112`）、瞬断重试+重放过滤（`network-retry.js:11-37`+`loop-orchestrator.js:858-956`）、工具失败分类与回 pending+`retry_count`（`tool-retry-policy.js:35-65`、`tools-executor.js:1120-1168`）、三重闸单级降级（`model-fallback-policy.js:46-57`、`agent-fallback.js:57-78`）、microcompact/熔断（`agent-resilience.js:75-115,209-231`）。
- 缺口：①工具重试**默认关闭**（`getRetryMax()` 无 env 即 0，`tool-retry-policy.js:59-65`），仅 SIGKILL/137 判瞬态，hard_timeout/一般 nonzero 不重试；②网关 attempts 无独立 retry 次数/退避参数，长度由 profile 列表决定（`model-gateway.js:221-232`）；③`ack_token` 无 UNIQUE、无状态 CAS（`schema.js:472`、`db.js:1294-1309`），并发 ack 可重入；④批内无断点（checkpoint 只在整轮末写，`loop-orchestrator.js:1454,1540`），并行组 `Promise.all` 非 `allSettled`（`agent-loop-control.js:660`）。

### ②可恢复性 — B-
- 已有：`_loopInit` 从 active loop 恢复 planned/running（`loop-orchestrator.js:366-441`）、phase/checkpoint 持久化（:458-516）、stall-resume+重放过滤（:818-983）、stale-running 60s 对账（`stale-running-reconciler.js:30-99`）、不可变 checkpoint 表（`schema.js:73-83`）、conversation compaction 留痕（`conversation-compaction.js:8-13,168`）、窗口 rail restore（`window-manager.js:414-427`）、重启清扫+recovery_required（`server-main.js:156-199`）、人工 resume 路由（`routes/ai-agent/resume.js:111-274`）。
- 缺口：①`_loopInit` 跳过 subagent（:377）、sequence 仅从最近 500 条重建（:387-389）；②`_loopSaveCheckpoint` 整段 `catch {}` 静默（:515）；③stall-resume 游标/过滤器纯内存（:818-852,958-983），重启即丢；④崩溃一律 failed（db.js:1325-1330），**无自动续跑**、必须人工 POST resume；⑤`src/ipc/` 无任务级离线重放通道。

### ③安全性 — B+
- 已有：origin/partition 白名单+默认拒绝（`security-hardening.js:41-45,298-344`）、webview 中和（:249-271）、工具侧效应分级+R3 拒+审批/用户规则/MCP trust（`agent-tool-policy.js:131-164,209-499`）、审批指纹+once/task/always+TTL（`approval-request-store.js:185-346`）、untrusted 包裹（`tool-capability.js:27,173-181`）、Keychain+AES-GCM+0600（`credential-store.js:41-199`）、key 只回 status 布尔（`ai-settings.js:268-272`）、[REDACTED]（`redaction.js:3-32`）、workspace 路径五重校验（`internals.js:218-299`）、gen-ui CSP（`csp.js:23-42`）、guard-ack 准入（guard-ack-store.js:17-42）。
- 缺口：①破坏命令仅 10 项首 token（`command-risk-rules.js:14-17`），rm/del 变体不拦；②PATH_ARG_FIELDS 仅 4 内建工具、MCP 参数无路径守卫（`agent-tool-policy.js:32-38`）；③lesson 正文直出未走 untrusted 包裹（`lesson-render.js:17-38`）、₄仅 rollback 剔除 fail-open（`lesson-injection-guard.js:6-9,32-38`）；④审批/ack store 进程内 Map 无持久（`guard-ack-store.js:17`、`approval-request-store.js:35`）；⑤CSP script-src 含 unsafe-inline+7 CDN（`csp.js:26`）、登记表上限 50 溢出丢记录（`security-hardening.js:160-168`）。

### ④性能与成本 — B-
- 已有：quickOutputBudget 1024–1500（task-spec.js:27-33）、resolveOutputBudget 16k/8%/64k 上限（`agent-loop-control.js:305-323`）、消息分级裁剪+tool 链原子（`message-trimmer.js:191-275`）、滚动压缩（conversation-compaction.js:19-60）、并发上限 8/5+子 agent 预留（`runtime.js:19-88`）、tool 泵 maxConcurrent=2 FIFO（`tools-executor.js:604-636`）、spawn 超时 SIGTERM→SIGKILL+后台进程表（`internals.js:110-185,328-408`）、ai_usage 全字段（`ai-usage.js:17-54`）、Anthropic cache_control ephemeral（`protocol-conversion.js:110-138`）。
- 缺口：①**成本上限仅软提示**（`cost-cap.js:13-15` 明示无强制 break/return），超成本只发事件不硬熔断；②AI_PRICING 仅 3 模型、未知模型回落 deepseek 单价（`ai-usage.js:236-246`），cost_status 恒 estimated/unknown；③并发硬编码超限直接拒绝无排队（`runtime.js:19-20`）、maxConcurrent 为 env 后门；④77 工具 `cancellable:false` 协作取消不生效（`tool-cancel-registry.js:6-18`）、后台进程表仅内存；⑤cache_control 仅 Anthropic，OpenAI/DeepSeek 无显式断点。

### ⑤可扩展性 — B
- 已有：插件装载+失败非致命（`_plugin-loader.js:17`、`plugin-loader.js:572`）、MCP 三传输+OAuth（`client-manager.js:87,205`）、mcp registry 合并插件/Skill/IDE（`mcp/registry.js:549,842`）、roleBindings/fallback 多模型（`model-profile.js:317-365`、`model-gateway.js:194,221`）、pack 贡献+work surface 视图（`pack-contributions.js:340,402`）、plugin-sdk+契约 lint（`plugin-sdk.js`、`plugin-contract-lint.js`）。
- 缺口：①插件变更需重启（`plugin-manager.js:254` 明言 "restart app to activate"），无运行时 activate/deactivate 生命周期；②**两个 tool 注册表面并存**（mcp/registry.js listTools vs agent-tools/registry.js buildToolRegistry），投影失败 `catch{}` 静默（`agent-tools/registry.js:606-610`）、client-manager 注释与代码漂移；③MODEL_ROLES 固定 7 档、pack 无贡献模型角色入口（`model-profile.js:60`）；④pack UI actions 只拼进 act 描述非一等 schema（registry.js:617-633）；⑤扩展点规范分散无单一 canonical 契约、顶层 plugins/ 不存在。

### ⑥编排 — B-
- 已有：子 agent spawn/wait/interrupt/followup（`spawn-agent-tools.js:223,394,486,539`）、深度/并发钳制（:46-59）、workflow parallel/pipeline+信号量（`workflow-runner.js:201,213,421`）、只读并行分组 Promise.all（`agent-loop-control.js:625-667`）、plan 工具+修订审批（`plan-ui-tools.js:13,89,116`、`plan-lifecycle.js:86,118,157`、`ai-plans.js:63,91`）。
- 缺口：①**无基于 dependsOn 的 DAG 调度**（DSL 只有 parallel/pipeline，workflow-runner.js:283-284；现有拓扑实现属工具规划/血缘非步骤调度）；②spawn 族 `concurrentSafe=false` 强制串行、子 agent 无法并行（`agent-loop-control.js:626`）；③`parallelImpl` 裸 Promise.all 无失败隔离/partial 回收（workflow-runner.js:204）；④计划审批与工具审批两套通道无统一审批面；⑤plan 步骤无后端执行器/自动调度（模型自行推进）。

### ⑦可观测性 — 第一轮已落地（A-，**本轮不重复评**）
- 标注：OB-001 console→logger/OB-002 IPC trace rid/OB-003 metrics/OB-004 error-log 静默修复/OB-005 health/OB-007 进程错误统一/OB-008 goal-verifier 接线 P2，证据见 `docs/block520-harness-observability-plan.md` P0/P1/P2 与 `acceptance/harness-observability/P0~P2-EVIDENCE.md`。本轮仅在别维度引用其作为已有机制（如 error 可观测支撑可靠性）。
- 残留（新增，不重评旧项）：goal-verifier 仍无外部调用（`agent-runner.js:308 decisionVerifier=null`，OB-008 接线 P2 待裁决）。

### ⑧交付质量 — B+
- 已有：artifact-truth sha256 实算+快照比对+mutated 检测（`artifact-truth.js:45-96,259,391`）、delivery-manifest/replay-package 路由（`routes/harness/scientific-task.js:15,205`）、事件流 afterSeq 水位补齐（mobile-gateway/agent-ws.js:144-147）、[REDACTED] 重放凭据防重放（reason-codes.js:93）、judge 邻域重放观测（`judge-core.js:153-174`）、report-guard（report-guard.js:14,53）。
- 缺口：①goal-verifier 无调用点（同⑦残留）——"交付完成"缺第七方裁决；②replay-package 限 scientific-task 单一面，通用 agent 任务的交付回放未标准化；③artifact 校验覆盖文件产物，对"结论/答复"类无结构化验收契约。

## §2 差距矩阵 + 分级路线（含「不做的话真实代价」）

### ①档 · 高价值低成本（机械可补，本轮直接落地 1 项，其余列明）
| 项 | 差距 | 不做的话真实代价 | 处置 |
|---|---|---|---|
|M1|ack_token 无 UNIQUE/CAS（可靠性）|并发 ack 可重入 → 同一工具被授权两次，审批语义被绕过；但触发需并发+相同 token，概率低|**降级为材料**：需 DB 唯一索引迁移+改 ack 语义，现有 DB 可能有重复 token、调用方依赖无条件 UPDATE——超"机械小改"安全边界，不硬凑|
|M2|工具重试默认 0（可靠性）|偶发瞬断直接失败、用户要手动重试；代价=体验损耗、非数据丢失|材料（改 env 默认属行为变更，需 owner 确认预算）|
|M3|checkpoint catch{} 静默（可恢复性）|恢复点写失败无痕、崩溃后回退更早状态不可知；代价=诊断盲区|**本轮已落地**：loop-orchestrator.js 加 logError 留痕（零语义变更、与第一轮 OB-004 同向）；HK-01 红→绿 2/2|
|M4|approval/ack store 进程内 Map（安全性）|重启后审批凭据丢失，用户需重新批准；多实例部署态不可行|材料（DB 持久化表 + 迁移，中等成本）|
|M5|AI_PRICING 仅 3 模型（成本）|未知模型成本估算错、预算判断失真；代价=账单不准（非超额扣费）|材料（定价表维护策略属产品语义）|

### ②档 · 高价值高成本（立项裁决）
| 项 | 差距 | 不做的话真实代价 | 建议 |
|---|---|---|---|
|L1|**dependsOn DAG 步骤调度器**（编排）|复杂任务只能 parallel/pipeline 硬编码顺序，依赖变更需改代码；代价=复杂需求编排表达力天花板|立项裁决（与 G1"通用 agent 内核"方向同频）|
|L2|**崩溃自动续跑**（可恢复性）|崩溃即 failed+人工 resume，夜间/长任务无人值守断档；代价=长任务交付依赖人在场|立项裁决（需先解决 checkpoint 持久化与游标落盘）|
|L3|**成本硬熔断**（性能成本）|超预算只提示不强制，极端情况 token 失控；代价=偶发超支（当前 ai_usage 可事后追账）|立项裁决（硬中断语义/用户体验影响大）|
|L4|**统一工具注册表面+插件热启停**（可扩展性）|两个 registry 漂移、插件改完必须重启；代价=扩展开发体验与长期维护成本|立项裁决（与"领域包"方向强相关）|
|L5|**goal-verifier 接线**（交付质量）|"完成"由模型自判、无第三方裁决；代价=错误完成声明偶发（当前 artifact-truth 兜住文件产物）|立项裁决（OB-008 已留 P2 位，默认值需 owner 拍板）|

### ③档 · 低价值/暂不做（写明理由）
| 项 | 不做理由（真实代价评估） |
|---|---|
|全工具 cancellable 强杀|77 工具多为瞬时纯计算（<100ms），强杀反而引入状态不一致；实际长任务已由 workspace_exec SIGKILL 兜住，代价低|
|OpenAI/DeepSeek 显式 cache 断点|Anthropic ephemeral 已覆盖一类协议；其余协议 cache 由 provider 侧透明处理，手动断点收益不确定|
|MCP 参数路径守卫全覆盖|当前 MCP trust 由用户授权面把关（agent-tool-policy.js:272+），路径级细粒度属纵深防御第二层；真实风险依赖恶意 MCP server，属供应链信任问题非 harness 缺陷|
|pack 一等工具 schema|UI actions 当前拼 act 描述够用，pack 视图已可承载数据面；升级收益=开发体验，代价=契约重构，G1 后随领域包规模化再评|

## §3 与第一轮衔接

- 第一轮 BLOCK-520（OB-001~008 + 7 队列）为稳定性/可观测性，本轮不重复评其交付；仅在别维度把已落地机制作为"已有"证据引用（如 error-log 支撑可靠性、metrics 支撑成本观测）。
- 本轮新增差距不与 OB 项重叠：M1-M5/L1-L5 均属能力面（可靠性语义/恢复自动化/编排表达/扩展契约/交付裁决），非"失败可见/链路可追"。

## §4 机械项处置与边界

- M3（checkpoint 静默 catch）本轮 HK-01 红绿先行落地（红 0/2→绿 2/2）：loop-orchestrator.js 加 logError 留痕，零语义变更。
- M1（ack_token UNIQUE/CAS）核码后降级为材料：需 DB 迁移+改 ack 语义，超"机械小改"边界，不硬凑；其余机械候选与全部高成本项均出材料等 owner 拍板；本评估不改任何现有编排/审批/模型路由行为。
- 评级依据=代码证据；无使用数据处不臆测（同右栏审计纪律）。
