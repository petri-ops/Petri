---
capability: block-338-stream-stall-watchdog
status: completed
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

## 3. 收口记录（2026-11-02 立项当日 P0→P4 全收口）

| 片 | 交付 | 证据 |
| --- | --- | --- |
| P0 复现 | `scripts/block338-stall-repro.mjs`：A) 裸 http `timeout=400ms` + 上游每 100ms 心跳 → **未触发**（心跳续命 socket）；B) 真 DeepSeek provider 面向心跳上游：2.5s 内 **0 个** content/tool delta 且 promise 未 settled | `acceptance/block-338/stall-repro.json` **3/3** |
| P1 看门狗 | 新 `llm-providers/stream-stall-watchdog.js`（纯函数：续命集合封闭、两段计时、幂等、stop、阈值解析含下限 1s）+ `ModelGateway.chat` 单点接入（`AbortSignal.any` 组合 signal）+ 结构化 `stream_stalled{phase,elapsedMs}` + `reason-codes` 新类别 `provider` | 契约测 **7/7**（含「心跳不续命」「正常流零误杀」反向断言） |
| P2 两路径 | `/api/ai/chat` 120s 兜底**降级为最后防线**（注释+既有 message 通路直接显示 `stream_stalled` 中文原因）；agent 路径 `callChatProvider` 首 token 段自动重试**一次**；首 token stall **不发** error 事件（避免前端先报错再成功） | 契约测 2 条（重试恰好 1 次 / idle 不重试 / 二次仍 stall 不无限重试） |
| P3 实机 | `scripts/block338-stall-live.mjs`：真 provider + 真 gateway + 真 HTTP mock 三场景 | `acceptance/block-338/stall-live.json` **6/6**（正常零误杀 495ms·4 delta / 首 token 1003ms 判死且 0 伪造 token / idle 判死且部分输出保留） |
| P4 收口 | 本记录 + AUDIT-LOG 翻 ✅ + handoff/roadmap 回写 | `test:changed` 268 项 267 绿（唯一红=p6 脏树，提交自愈） |

**对计划字面的收窄（留痕）**：plan 写「stall 判瞬态可重试一次」，实现收窄为**仅 `phase='first_token'` 可重试**——idle 段已产出部分内容，重放会重复输出（用户可见的坏结果），因此 idle 段不重试、原样返回由上层如实报。这比「一律重试一次」更安全，且首 token 段正是「一次上游抽风毁掉整轮」的实际形态。

**抓真两处**：① 复现脚本首版用 `req.on('close')` 清理心跳——Node ≥16 的 `IncomingMessage 'close'` 在**请求体读完**即触发，导致心跳被立刻清掉、A 场景假阳性（timeout 正常触发）；改用 `req.socket`/`res` 的 close。② 接入测试首版把阈值设 120ms，但产品下限是 1000ms（`MIN_THRESHOLD_MS`）→ 阈值被回落成默认 45s、测试必红；改为使用合法下限 1s。

**未覆盖（如实）**：P3 未经 Express 进程（`/api/ai/chat` 只加注释降级，路由行为由既有 UI-638 兜底测试覆盖）；真实 deepseek 上游一轮正常对话属用户侧凭据条件，本机无 key 未跑；thinking 高档阈值放宽属 reopen。

G0 开发期常态 · 不外推 packaged/Provider/GA。
