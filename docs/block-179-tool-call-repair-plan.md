---
capability: agent-robustness
goal: 模型把工具调用写成正文的生产级修复（通用能力主线 · agent-runner 鲁棒性）——纯文本工具块解析（围栏 JSON/裸 JSON 对象/tool_call 标签三形态）+ 保护区间防误伤（可用名单校验 fail-closed/参数对象校验/单轮上限/任一未知名整轮不修）+ 提升为真实工具调用（复用 runAgentToolCallBatch 的 reserve/parse/重复语义闸与 agent-tool-policy 审批门）+ 修复决策事件透明化（原文诚实保留可审计）。
acceptance:
  - P0 解析器：core/petri-server/helpers/tool-call-repair.js scanPlainTextToolCalls——三形态解析+名单校验+保护规则+决策 reasons 输出；红绿先行单测全绿
  - P1 loop 接线：runLoop 内 toolCalls.length===0 且非 finalizing 分支最前扫描→repair 时构造 OpenAI 格式 tool_calls 走既有 runAgentToolCallBatch→agent_status phase=tool_call_repair 事件（条数/工具名/用户可读消息）；keep 决策零行为变化（additive 契约）
  - 集成用例：mock provider 首轮回正文退化工具块→提升后工具真执行→下一轮回最终答复正常收口；未知名正文→不修复按最终回答处理（存量行为不变）
  - 红线：原生 function-calling 通道零改写；提升调用与原生调用同权走 agent-tool-policy 审批门（修复不得成为绕治理后门）；finalizing 模式永不修复；前端抹除/替换已流式原文不做（非范围，原文保留=审计资产）
  - closeout 门禁绿 + 实机探针（探针强制注入正文退化场景断言修复链）
reopen: 任一出口断言未达即返工；用户 2026-10-13 裁决「行 开整吧」（批准主代理上一会话交接推荐的研究池④转正）
status: completed
---

# BLOCK-179 — tool-call-repair 鲁棒性（正文工具块→真实调用提升）

## 0. 来源与授权

- roadmap 研究候选池④（2026-09-06 登记，源自 openclaw 本地镜像对标解剖）：「tool-call-repair 鲁棒性借鉴——模型把工具调用写成正文的生产级修复：纯文本工具块解析 + 保护区间防误伤 + 流式归一化 + 提升为真实工具调用」。
- 主代理 2026-10-13 交接推荐「下一包候选我推荐 tool-call-repair（通用能力主线）」→ 用户裁决「行 开整吧」→ 立项发令。
- **参照实现不可得**：openclaw 本地镜像已不在盘上（对标解剖结论沉淀于 roadmap 条目），四条能力轴按自家链路现状自主设计；「流式归一化」按 v1 诚实边界收缩为状态事件级（见 §2）。

## 1. P0 勘察结论（2026-10-13，代码实证）

- **缺口**：`loop-orchestrator.js` runLoop 内 `msg.tool_calls.length === 0` 时，正文直接进 `assessFinalizationResult` → 内容非空即按最终回答收口。模型把工具调用写成正文（JSON 块等退化形态）时任务静默死亡：用户看到 JSON 汤、零工具执行、无修复尝试。
- **工具调用链**：Provider 原生 `msg.tool_calls`（OpenAI 格式 `{id, type:'function', function:{name, arguments:JSON字符串}}`）→ `runAgentToolCallBatch` → `controller.reserve`（上限）/`controller.parse`（ID 去重+JSON 参数+重复语义异常闸 MAX_IDENTICAL_TOOL_CALLS=3）→ `executeToolCall`（agent-tool-policy 审批门在此生效）。
- **可用名单**：`config.tools` = `effectiveTools`（context 收窄 BLOCK-99 + tool-route 收窄 BLOCK-113 后的 defs 数组）——名单校验用它，天然继承收窄语义。
- **已有 kin（不叠层，通用化）**：`recoverSealedResultEditArgs`（单工具参数 JSON 修复先例）、BLOCK-56 finalization 重试、continuationGuard 截断续写。本包是「正文工具块→真实调用」的通用提升路径，非上述任一的补丁。
- **流式面**：content_delta 实时透传前端，无内容替换事件——原文在修复后仍会留在前端消息里（诚实形态）。

## 2. 范围（两批）

- **P0 解析器**（新文件 `core/petri-server/helpers/tool-call-repair.js`）：
  1. 三形态解析：①围栏代码块（```json 等 fenced block）内含 name+arguments 形态 JSON；②正文中顶层裸 JSON 对象（平衡扫描，含 `name`+`arguments` 双键）；③`<tool_call>...</tool_call>` 标签包裹 JSON。键名别名：`name|tool`、`arguments|args|parameters`。
  2. 保护规则（防误伤，全部 fail-closed）：a) 所有解析候选的 name 必须 ∈ 可用名单，任一不在 → 整轮 decision=keep（判定为演示/文档引用）；b) arguments 必须为合法 JSON 对象（空→{}，非法→该块弃且计入 reason）；c) 候选 >5 → 整轮 keep；d) 解析全程 try/catch，任何异常 → keep。
  3. 输出：`{ decision: 'repair'|'keep', calls: [{name, arguments(字符串化)}], blocks: n, reasons: [...] }`——reasons 供事件与 console 审计。
- **P1 loop 接线**（`loop-orchestrator.js` toolCalls===0 分支最前，finalizing 除外）：
  1. `scanPlainTextToolCalls(content, { availableToolNames })`；decision=repair → 构造 tool_calls（id=既有 createCallId、arguments 字符串化）走既有 `runAgentToolCallBatch`（reserve/parse/异常闸全复用）→ assistant 消息 `{content: 原文（诚实保留）, tool_calls: accepted}` → `continue` 下一轮。
  2. 透明事件：`agent_status` phase=`tool_call_repair`，附 repaired 条数/工具名/用户可读消息「检测到模型以文本形式输出工具调用，已自动修复为真实调用继续执行」。
  3. keep 决策 → 落入既有分支，零行为变化；有候选但 keep 时 console 留 reason（开发观测面，不发事件防噪音）。

## 3. 非范围（红线）

- 前端内容替换/抹除已流式原文（无替换事件基础设施；原文保留=本地可审计资产）。
- finalization 分支修复（finalizing 明确要求不调工具，修复违反复试协议）。
- 原生 function-calling 通道行为零改写；不动 controller.parse 既有校验。
- 提升调用旁路审批门——提升与原生同权走 agent-tool-policy（治理红线）。
- openclaw 式多通道消息网关/微包拆分（roadmap 已登记参考不收）。

## 4. 门禁

- 红绿先行：`test/tool-call-repair.test.mjs`（解析器 ~15 用例：三形态×正反+名单校验+别名键+上限+异常安全）。
- 集成：`test/tool-call-repair-loop.test.mjs`（runLoop+mock callChatProvider：退化→提升→真执行→收口；未知名→存量行为不变）。
- impact-map 登记（helpers/tool-call-repair.js + loop-orchestrator.js → 上述测试）。
- 定向回归：loop 相关既有测试（agent-runner-loop-orchestrator 等）零红。
- 实机：`scripts/block179-live.mjs` 探针——测试实例强制注入正文退化场景（走真实 agent 循环），断言修复事件+工具执行+收口链，证据 `acceptance/block-179/`。
- closeout 十三门绿。

## 5. 完成语义

- registry `active → completed`；plan 波报回填；roadmap 研究池④销号注记；AUDIT-LOG ✅ 行；handoff 顶部更新。UI 台账不涉及（无 UI 面）。

## 6. 波报（2026-10-13 当日整包收口）

- **P0 解析器**：`core/petri-server/helpers/tool-call-repair.js` —— 字符串感知顶层平衡扫描（三形态同一覆盖：围栏 JSON/裸对象/`<tool_call>` 标签；嵌套对象不算候选）；键名别名 `name|tool` × `arguments|args|parameters`；保护规则 fail-closed 全落地（任一未知名整轮 keep / arguments 非对象该块弃+reason / 上限 5 / 空·畸形输入恒 keep）。**红绿先行 21/21 绿**（test/tool-call-repair.test.mjs）。
- **P1 loop 接线**：`loop-orchestrator.js` toolCalls===0 分支（恒非 finalizing）最前扫描 → repair 时构造 OpenAI 格式 tool_calls 走既有 `runAgentToolCallBatch`（reserve/parse/重复语义闸与 agent-tool-policy 审批门全复用，不绕治理）→ `agent_status phase=tool_call_repair` 透明事件（条数/工具名/用户可读消息）→ assistant 历史=退化原文诚实保留+修复后 tool_calls；keep 决策零行为变化，reasons 落 console。**集成 2/2 绿**（test/tool-call-repair-loop.test.mjs，mock provider 裸驱 runLoop）。
- **实机探针 12/12 PASS**（scripts/block179-live.mjs → acceptance/block-179/block179-live.json）：隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录+独立端口，用户空间零残留）+ mock OpenAI SSE provider（openai-compatible preset 强制注入）走真实 agent 全链。A 链事件序列完整：`run_started → delta×2（退化正文流式）→ agent_status:tool_call_repair → agent_progress → tool_call → tool_result → iter → delta×2（收口）→ done`；第 2 轮 provider 请求历史形态 `system,user,assistant,tool` 实证修复调用执行结果入会话。B 链实证保护不误伤（未知名演示正文零修复单轮收口）。
- **test:suggest 采纳**：追加 agent-backend 域 7 文件 71/71 绿（block109 基线/multi-agent/agent-provider-boundary/block110/112/113）；doc:suggest 命中 planDoc 与本批一致。
- **存量红如实归属**：context-breaker 2 红 bisect 干净树同挂（存量，非本包面）；lint 触碰面 0 error（loop-orchestrator 存量 security warning 非 本包新增）。
- **openclaw 参照如实登记**：本地镜像已不在盘上，四轴按 roadmap 登记自主设计；「流式归一化」收缩为状态事件级（前端无内容替换基础设施，原文保留=审计资产），UI 抹除列非范围。
- closeout 十三门绿；G0 开发期常态 · 不外推 packaged/Provider/GA。
