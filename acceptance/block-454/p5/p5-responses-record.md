# BLOCK-454 P5 · Responses 协议 adapter · 记录（2026-11-17）

> 波次：W5（e2e-execution-plan §3 W5 任务卡）。D3 预置裁决：**默认做**——补抓 UNVERIFIED 契约后实现，不硬写。

## 1. 契约补抓（前置达成）

- 官方 `POST /responses` 参考页抓取核实（findings 文首补记 VERIFIED，深链在册）：请求/响应/流式完整形态（详见 findings P5 补抓注）。原 UNVERIFIED 项清偿；Fetch 独立端点仍未进入实现范围（保持 UNVERIFIED 如实登记）。

## 2. 交付物

### adapter（`core/shared-backend/llm-providers/responses.js`，provider 名 `deepseek-responses`，protocol `responses`）
- `openAIToResponsesRequest`：messages → input items（input_text 块；image_url → input_image（data URL/http 走 image_url，file_id 互斥契约落在上游）；Chat file 块 → input_file）；assistant tool_calls → function_call items；tool 角色 → function_call_output；**max_tokens → max_output_tokens**（参数名逐字）；tools：OpenAI 嵌套 function → Responses 扁平 {type,name,description,parameters}，内联工具（deepseek_web_search/deepseek_read_url）原样透传；**safety_check/title 仅参数级透传——不替换 Petri 本地审批/治理链**（丢魂红线）。
- `responsesToOpenAIResponse`：归一回 OpenAI-compat 信封。**四类内容投影不丢**：thinking→reasoning_content；tool_use→tool_calls（finish_reason=tool_calls）；citations（web_search_call action.sources + kind）→ `deepseekResponses.webSearchCalls`（来源可审计 P3-a）；refusal（incomplete+content_filter）→ finish_reason=content_filter；max_output_tokens→length；status=failed → 诚实 error 信封。usage 映射 prompt/completion/total + details/server_tool_use/safety_tokens 保留（计费可审计）。
- 流式：SSE（event+sequence_number，**无 [DONE]**）→ content_delta 聚合 + 终事件 completed/incomplete/failed → done/error；未知事件不猜不炸；**终帧无尾部 \n\n 的 flush 收尾**（测试当场抓出的真 bug：completed 帧滞留 buffer）。
- 注册：`index.js` registerProvider('deepseek-responses')；`model-profile.js` inferProtocol('deepseek-responses')→'responses'。
- thinking 映射（单一映射点扩 'responses' 协议）：off→`reasoning{effort:'none'}` / standard→不发参（默认档零行为变化） / high→`reasoning{effort:'max'}`（最强调参数）；KNOWN_PARAMS 白名单登记；**既有三协议映射逐字不动**（BLOCK-200 冻结面复验绿）。

## 3. HK-01 红→绿

- 红：`test/block454-p5-responses.test.mjs` 先行（模块缺失红）→ 实现后 **9/9**（注册/请求形态 3 + 响应投影 3 + adapter 端到端/流式 3）。
- 两轮测试反哺：P5-4 断言路径修正（item.action.sources）；P5-8 抓出**实现真缺陷**（终帧 flush 缺失）已修——红绿纪律的价值兑现。
- 邻域回归：thinking 基线/ reasoning-config / gateway / fallback / anthropic / W4 **61/61**。

## 4. 门禁

quality:types / secret / arch PASS；零新依赖。

## 5. external-blocked 清单

- 实机 /responses 调用腿：同 W2-W4（无独立验证授权 + 付费副作用 P5-a），契约级证据覆盖。用户配置 key 后 profile 选 `deepseek-responses` 渠道即真跑。

## 6. Anthropic Messages 协议（同阶段另一腿）

- 按 findings §3：`anthropic.js` adapter 已在体内且支持 baseUrl 指向 `/anthropic`，属**配置态零代码**（本波未改其行为；W4 已为其补 files beta header 注入）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
