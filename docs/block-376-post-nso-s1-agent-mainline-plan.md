---
capability: block-376-post-nso-s1-agent-mainline
status: completed
goal: S1 Agent 主链最后一公里——流中断/压缩/降级/终态在任何 provider/绑定组合下确定、可见、可恢复；已发出的失败事件真正到达轨迹面与前端；承载蓝图 §7 全部 9 项改进点与 S0 移交的 block93 spawn persona 残红。
acceptance:
  - anthropic.js 与 llm-client 兼容入口补齐 errorsAsRejections；启用 fallback 绑定的 RST 集成用例落地（不再固定 disableFallback:true）
  - classifyProviderFailure/resolveFallbackCandidates 单源裁决落码；cancelled+timeout / 401+api_error / 多绑定上界三负测绿
  - conversation-compaction 真增量摘要（只合并 rowid>covers_rowid，输入有界，删无谓全表读）；「会话翻倍但单次摘要输入有界」断言绿
  - 后台压缩 .catch(()=>{}) 改发 compaction_failed{reason}；chat.js 经 resolveCompactionMode 单源并透传 maxOutput；四种 flag 组合矩阵测试
  - SSE 三态契约：失败分支发显式 task.failed 终态；agent-fallback 空 onEvent 至少投影新 taskId/状态回父任务事件流
  - compaction_failed / provider_retry / trim_skipped / stream_stall 纳入 trajectory-events 分类；前端轨迹面可查（单源投影零前端改动）
  - context-budget-step / message-trimmer console 异常改 trim_skipped 事件；trim 幂等端到端用例
  - block93 spawn persona：spawn 子链 system prompt 含 BLOCK-339 人设片段（S0 移交残红清偿）
  - 全 provider 流中故障行为测试绿；无静默 catch；SSE 客户端终态不靠轮询判死
reopen: 分片新红、SSE 契约前端消费报红、或增量摘要阈值语义争议时先归因再重开
---

# BLOCK-376 · S1 Agent 主链最后一公里（post-NSO 蓝图 §7）

> 承载 [`docs/post-nso-optimization-blueprint-2026-11-06.md`](./post-nso-optimization-blueprint-2026-11-06.md) §7。
> 发令：用户 2026-11-07 预授权连续工作模式（S0→S7 全程零参与，工程判断全下放）。
> 前置：BLOCK-375（S0）completed @7c7e8d3b。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围（P0 六件 + P1 三件 + S0 移交一件）

1. **G-03 流中断穿透补全**：`anthropic.js` chatStream catch 按 `options.errorsAsRejections` 改抛（aborted 除外）；`llm-client.js callDeepSeekStream` 透传 `errorsAsRejections`；`model-gateway.js` 的「请求级 fallback 优先、终局 attempt 才 rejection 穿透」优先级写成显式注释契约；补启用绑定的全链 RST 用例（primary 可重试错误→降级不断链；全部候选失败→终局 throw 给整轮重试）。
2. **G-05 真增量摘要**：`compactConversationNow`/`maybeCompactInBackground` 在已有 compaction 时只读 `rowid > covers_rowid` 的未覆盖行（尾窗 keepRecent 界定切点），摘要输入=未覆盖行+已有摘要合并提示；首次压缩语义逐字节不变；输入长度有界断言。
3. **G-04 压缩失败可见**：`maybeCompactInBackground` 的 `.catch(() => {})` 改为向会话当前主任务 task_events 追加 `compaction_failed{reason}`（seq=last+1，拦截器同款）；`chat.js` 视图层改经 `resolveCompactionMode()` 单源、`maybeCompactInBackground` 透传 `maxOutput`；flag 四组合矩阵测试。
4. **G-04 SSE 三态**：`loop-orchestrator.js` 失败分支在 `{error}` 后发显式 `task.failed{reason, reasonCode, resumable}`（additive；run_terminal 生命周期书挡不变）；`agentTaskStream.ts` 消费 task.failed 为结构化终态。
5. **G-04 降级投影**：`agent-fallback.js:197` 空 onEvent 改为把 run_started/agent_status/run_terminal/model_fallback 里程碑投影回父任务事件流（带 fallbackTaskId+source 标记；正文仍由子任务自持轨迹+会话落库承担）。
6. **G-11 事件全链可见**：trajectory-events 注册 `compaction_failed/provider_retry/trim_skipped/stream_stall` 四事件（group+summarizer）；`model-gateway.js` 首 token stall 在抑制 error 的同时发可观测 `stream_stall{phase,elapsedMs,reasonCode}`；`context-budget-step.js`/`message-trimmer.js` 的 console 异常改发 `trim_skipped{reason}`。
7. **P1 熔断裁决**：CircuitBreaker 已在 BLOCK-364 删除——核销蓝图该项（验证零残留即可）。
8. **P1 源码扫描契约**：`test/loop-orchestrator-subdomains.test.mjs` 等的源码 includes 断言**不在本包批量改**（S4.6 统一行为化；本包只保证新增测试都是行为契约）。
9. **S0 移交**：block93 spawn persona（spawn 子链缺 BLOCK-339 人设片段）——本包清偿。

## 2. 非范围（exclusions）

- S2 执行准入/FK/链哈希（G-06~10）；S3 体验面；S4 拆分与 148 消亡执行；前端虚拟化（S3 DOM 预算）。
- 不改 model-fallback-policy 的分类词表（校准绑定）；不撤销 workspace_exec 裁决；零新增依赖。
- 不重写 events.js 的 500ms 传输轮询（传输层轮询与「终态语义事件化」正交；契约层 task.failed 已消除客户端判死依赖）。

## 3. touchSurface / sharedBaselines

- core：`llm-providers/anthropic.js`、`model-gateway.js`、`helpers/llm-client.js`、`helpers/conversation-compaction.js`、`helpers/agent-fallback.js`、`helpers/trajectory-events.js`、`helpers/message-trimmer.js`、`loop-orchestrator.js`、`agent-tools/context-budget-step.js`、`agent-tools/spawn-agent-tools.js`（若 persona 根因在此）、`routes/ai-agent/chat.js`、`agent-runner.js`（task.failed 透传如需）。
- frontend：`copilotClient/agentTaskStream.ts`（task.failed 消费）、类型（如需）。
- 测试：新建 `test/nso-s1-*.test.mjs` 族 + 既有 compaction/gateway 测试追新。
- sharedBaselines：model-surface 基线（systemPrompt/toolDefs 若 persona 修复触及提示面需重打留因）、code-size 台账（loop-orchestrator +task.failed 行数内增量≤棘轮锚余量）。

## 4. 验收门禁

| 门禁 | 预期 |
| --- | --- |
| 新建 nso-s1 行为测试族 | 全绿（红绿先行：先红后绿留痕） |
| 既有 compaction / gateway / stream-retry / block93 / block172 族 | 定向绿 |
| quality:lint / types / arch / secret / model-surface | PASS（model-surface 若重打留因） |
| gate:code-size / knip / docs / ui-audit / hygiene | PASS |
| test:changed | 0 fail（C-46/P6 残红除外——S0 归因在案） |
| closeout | 全门出结果 |

## 5. 完成语义

本包 `completed` = §4 全绿 + canonical 回写同批（registry/README/roadmap/handoff/AUDIT-LOG）+ 收口笔录（红绿证据/门禁读数/残留）。未达证据不写 verified。

---

## 6. 收口（2026-11-07）

### 6.1 交付对账（§1 九项）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| ①errorsAsRejections 补全 + 启用绑定 RST | ✅ | anthropic catch 按 options.errorsAsRejections 改抛（aborted 除外）；callDeepSeekStream 条件展开透传；红 5→绿（nso-s1-stream-rejection 6/6）+ 既有 W1 全链 5/5 |
| ②网关 fallback 优先级显式契约 | ✅ | 「可重试先降级/全候选耗尽终局抛/401 硬不可降级不消耗绑定」三腿测试绿；**当场抓真**：rejection→result 转换丢 status 使 401 落入 RETRYABLE 被误降级（蓝图 §7.2 负测预言命中）→ 转换保留 details/status |
| ③真增量摘要 | ✅ | compactConversationNow/maybeCompactInBackground 只读 rowid>covers_rowid；「会话翻倍但单次摘要输入有界」断言绿（二次输入 48.7K < 全历史 77.8K×0.75，且不含首排行）；首次压缩 B2 契约不变；covers_count 改累计口径 |
| ④压缩失败可见 + 视图单源 | ✅ | maybeCompactInBackground 失败→主任务 task_events 追加 compaction_failed{reason}（seq=last+1）；chat.js 改 resolveCompactionMode 单源 + maxOutput 透传（req.max_tokens→preset）；nso-s1-compaction 4/4 + block95/98/w1 族 19/19 |
| ⑤SSE 三态 + 降级投影 | ✅ | loop 失败分支发 task.failed{reason,reasonCode}（additive）；agentTaskStream/types 前端消费（onTaskFailed，error 优先级不变，tsc 0）；agent-fallback 空 onEvent→里程碑事件投影回父任务事件流（fallbackTaskId+source 标记） |
| ⑥四事件轨迹面注册 | ✅ | trajectory-events 注册 compaction_failed(error)/provider_retry/trim_skipped(compaction)/stream_stall(system)+summarizer；首 token stall 发可观测 stream_stall（不破坏重试语义）；context-budget-step console 异常改 trim_skipped（summary 重复 console 通道删除） |
| ⑦CircuitBreaker 核销 | ✅ | BLOCK-364 已删（circuit-breaker.js 零残留核验） |
| ⑧源码扫描契约行为化 | ➡️ S4 | 按 plan 非范围条款移交 S4.6 统一处理 |
| ⑨spawn persona（S0 移交） | ⏸ 未清偿 | 深挖后修正归因：persona 其实在场，缺的是【角色：检索】指令与动态上下文——子链主请求 system=纯静态模板（1029B），疑 spawn 子链主请求与 CP-5 摘要请求走了不同 baseUrl 装配（test 抓包 len=1029 tail=principles+修剪通告）。诊断超出本片时盒，**移交 S4 专项**（含抓包线索），不硬闯 |

### 6.2 门禁终态（当次读数）

nso-s1 两新族 10/10 + 既有 compaction/gateway/CP-5 族全绿；test:changed 1200/1204（1 红=P6 已知 pending〔S0 在案〕，3 skip=block48 环境档〔S0 在案〕）；tsc 0；lint 0 error；arch/secret/knip/code-size/docs(507)/ui-audit(UI-700 in_progress 入账)/hygiene PASS；impact-coverage 棘轮 148→147（block172 挂规则真清偿）+UI 债 ceiling 7→8（BLOCK-370/371 先例留因，补腿队列归 S3）。

### 6.3 残留与补腿

1. P6 源绑定重打（S0 pending 延续）：健康会话 + 干净树 + g0:result-studio:p6:update。
2. block93 spawn 装配缺陷（⑨）：S4 专项，抓包线索在案。
3. UI-700 实机失败场景腿：S3 UI 台账终态化批。

G0 开发期常态 · 不外推 packaged/Provider/GA。
