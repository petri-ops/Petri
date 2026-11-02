---
capability: block-338-stream-stall-watchdog
status: planned
goal: 模型流式 stall 看门狗（用户裁决 2026-11-02「事关工作推进稳定性 必须全力解决」）：根治 /api/ai/chat「150s 零 token 零报错静默挂住」——根因=全部提供者只有 socket idle timeout（上游持续发 SSE 心跳/空 chunk 即永不触发），无「多久没收到 token 就判死」的看门狗；修法=ModelGateway 单点加 stall 看门狗（首 token 上限 + 连续无 token 上限，默认保守，env 可调），超时 abort 并发结构化错误（reason code 注册）；一处修全提供者受益。
acceptance:
  - P0 复现与证据：mock 上游「发心跳不发 token」场景——修复前 chat/agent 两路径均挂到 PETRI_CHAT_TIMEOUT_MS 兜底（120s）或永不结束（agent 路径无兜底）；证据 acceptance/block-338/stall-repro.json。
  - P1 看门狗：`shared-backend/llm-providers/stream-stall-watchdog.js` 纯函数（firstTokenMs 默认 45s / idleTokenMs 默认 60s / 空 chunk 与心跳不续命，只有 content_delta/tool_call_delta/thinking_delta 续命）；接入 ModelGateway.chat 单点（onEvent 包裹 + signal 合成 AbortSignal.any），超时 → abort + 结构化错误 `stream_stalled{phase:'first_token'|'idle', elapsedMs}`（reason-codes.js 注册 BLOCK-324 词表）。契约测红绿（含「心跳不续命」反向断言）。
  - P2 两路径接线：/api/ai/chat 的 120s 兜底降级为最后防线（看门狗先触发）；agent/loop 路径按 tool-retry-policy 瞬态分类——stall 判瞬态可重试一次（避免一次上游抽风毁掉整轮），二次 stall 升 blocked 如实报用户；SSE 事件面增 `stream_stalled` 事件（前端 toast 诚实原因）。
  - P3 实机：隔离后端 + mock 上游三场景（正常/首 token 迟到/中途静默）各断言：正常零误杀、迟到 45s 判死、中途 60s 判死，chat 与 agent 两路径各一轮；真实 deepseek 跑一轮正常对话证零误杀。证据 acceptance/block-338/。
  - P4 收口：AUDIT-LOG 自 2026-10-30 起挂的「/api/ai/chat hang 根因未定位」边界注记翻 ✅ 根因定位+根治；handoff 关键边界行移除。
reopen: 看门狗阈值按模型/档位自适应（thinking 档首 token 本就慢，v1 用保守全局默认 + env 覆盖，thinkingLevel 高档自动放宽 ×2）；上游心跳语义标准化（部分供应商心跳=进度，v1 一律不续命）。
---

# BLOCK-338-STREAM-STALL-WATCHDOG — 模型流式 stall 看门狗计划

- 立项裁决：用户 2026-11-02「行呀 这些你全方位核对 需要间隔 block 的 这事关工作推进的稳定性 必须全力解决」
- 队列位置：**插队到 334 收口后、336 之前**（稳定性优先于能力扩展——异常不根治，自动推进建在沙子上）
- 唯一真相域：本文件（block-338-stream-stall-watchdog）
- 文件面隔离：shared-backend/llm-providers（gateway + 新 watchdog）、routes/ai-chat.js 兜底降级、loop/agent 重试分类、reason-codes 词表、前端 SSE 事件消费一处；与 334（前端结果面）/336/337 零交叠。

## 1. 根因（2026-11-02 核对，证据链）

| 事实 | 出处 |
| --- | --- |
| 10-30 实测「150s 零 token、零报错、请求永不结束」，只做了 120s 兜底，根因未定位 | commit 3f4b0a44 正文；handoff 关键边界行 |
| deepseek 提供者 http.request `timeout: 90000` | `shared-backend/llm-providers/deepseek.js:39` |
| 该 timeout 是 **socket idle** 语义：响应流开始后只要 socket 有任意字节（SSE `: keep-alive` 注释帧/空 chunk）即重置——上游"发心跳不发 token"永不触发 | Node http 语义；流式路径 `deepseek.js:473-505` 无逐 token 看门狗 |
| 150s > 90s 直接证明 idle timeout 未触发（上游在发非 token 字节） | 数值矛盾 |
| 全部提供者（deepseek 系/anthropic/dashscope）均无 stall 看门狗 | 2026-11-02 grep 普查 stall/idle/watchdog=0 |
| agent 路径"正常"只是感知差异（loop 有迭代边界与用户可中断），同一提供者同病 | 3f4b0a44 边界注记 + 本核对 |

**结论**：跨提供者结构性缺口，修在 ModelGateway 单点。

## 2. 红线

- 心跳/空 chunk/非 token 事件**不续命**（否则看门狗形同虚设）；只有 content/tool/thinking delta 续命。
- 默认阈值保守（宁可多等 45s 也不误杀真实慢模型）；thinking 高档自动放宽；env 可调但不可关到无穷。
- 不改提供者各自的 socket timeout（CK-05 契约单源）；不建第二套超时体系——chat 的 120s 兜底降为最后防线而非删除。
- 错误必须结构化入 BLOCK-324 词表，前端诚实显示原因，不吞成"模型无响应"。
- G1+ 不外推。
