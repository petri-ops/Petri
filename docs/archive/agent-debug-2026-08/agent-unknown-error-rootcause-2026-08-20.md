# Agent 对话「发生未知错误」根因与修复（2026-08-20）

## 现象
前端 Agent 对话（Copilot / 调用工具）报 **「发生未知错误，请重试或联系支持」**。
该提示是前端 `classifyError`（`frontend/src/components/copilot/errorMessages.ts`）的
**兜底文案**——只要后端返回的错误消息不匹配任何已知 pattern，就落到 `UNKNOWN`。
所以真实错误从不在前端日志里，必须去后端查。

## 真因
`core/r-server/loop-orchestrator.js:70` 从 **`require('./agent-tools')`** 解构
`localizeToolResult`，但 **`agent-tools` 并不导出该函数**（它定义在
`helpers/system-prompt.js`，且 `chat.js` / `ai-agent.js` / `agent-runner.js`
都正确地从 `helpers/system-prompt` 引入）。

结果：`localizeToolResult` 在 loop-orchestrator 里是 `undefined`，
**任何带工具调用的 agent task** 在 `loop-orchestrator.js:669 / 713`
`localizeToolResult(envelope.data)` 处抛
`localizeToolResult is not a function` → 整条 agent loop `failed` → 前端显示「未知错误」。

纯文本对话（如"你好"，不触发工具）走不到该分支，所以**间歇性出现、难复现**。

### 引入来源
PHASE 3.1 重构 `5f6c2de`（agent-runner 1799 行拆成 loop-orchestrator 等子模块）
时把 import 指错了模块。修复前的 `tasks` 表显示 2026-08-20 10:25–11:35
共 8 条 agent task **全部 failed: localizeToolResult is not a function**。

## 修复
`loop-orchestrator.js` 改为：
```js
const { localizeToolResult } = require('./helpers/system-prompt');
```
（从 `./agent-tools` 解构里移除 `localizeToolResult` 一行。）最小改动，与所有
其他调用方一致。

## 验证
桌面端 agent 端点无需登录（`core/r-server/auth.js:15` `req.user = LOCAL_USER`），
可直接复现：
```bash
curl -X POST localhost:3001/api/ai/agent \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"帮我查一下我当前有哪些项目"}],"context":{"page":"home"},"conversationId":null}'
```
重启后用「查项目」（强制调 `query` 工具）触发：
- 修复前同款 task：`failed / localizeToolResult is not a function`
- 修复后新 task：`completed / done / error null` ✓

真实错误落库位置：`.petri-dev-user-data/data/petri.db` 的 `tasks` 表
`error` 字段（注意列名是 `id`，不是 `task_id`）。

## 提交
本地提交 `29626a2`（仅 `core/r-server/loop-orchestrator.js`，+4/−1）。
未推 main，推送待裁决。

---

# 附录：deepseek.js chatStream 失败链路核查（2026-08-20 21:55 补充）

## 传播链核实结果（全部属实）

```
deepseek.js chatStream fail（timeout/req_error/res_error/http_error/parse_error/api_error）
→ model-gateway.js chat 返回 {error, message}        ✅
→ loop-orchestrator.js:601 !upJson || upJson.error || !upJson.choices → providerFailureReason  ✅（行号精确）
→ chat.js 兜底：finalizeResultEditProgress({outcome:'failed'}) → sseSend 兜底文案 → sseSend({error})  ✅（实际行号 900，与 894 有 6 行偏移）
→ SSE 流终止，已输出的半截文本留在页面                ✅
```

deepseek.js 触发点核实：`timeout: 90000`（buildRequestOptions，line 38）、
HTTP 非 2xx → `http_error`（line 425）、SSE 帧 JSON.parse 失败 → `parse_error`（line 335）、
`parsed.error` → `api_error`（line 340）、`req/res error`（line 438/435）、
complete() 无 choice → `parse_error`（line 307）。**全部在位，描述准确。**

## 实际失败数据画像（.petri-dev-user-data/data/petri.db）

ai_usage 表（94 行，2026-08-20 14:34 本地起才有数据）：

| errorCode | 次数 | 真实时刻（本地） | 明细 |
|---|---|---|---|
| req_error | 2 | 14:34:47–52 | agent_iter(deepseek-v4-flash) + conversation_title(deepseek-chat) |
| req_error | 3 | 15:19:09–14 | agent_iter(deepseek-chat) + user_fact_extraction + conversation_title |
| timeout / http_error / parse_error / api_error | 0 | — | 从未实际发生 |

tasks 表 12 条 failed 构成：
- **9 条 `localizeToolResult is not a function`**（主因，上文已修，commit 29626a2）
- **2 条 `Client network socket disconnected before secure TLS connection was established`** ← req_error 的具体真身（TLS 握手阶段被断，上游连接层抖动）
- 1 条 `服务重启，Agent 任务中断`

**关键旁证**：两波 req_error 突发的同一时刻，dashscope embedding（text-embedding-v3）调用**全部成功**
→ 本机网络/DNS/r-server 正常，失败仅限 deepseek 上游通道（自定义 baseUrl 中转，deepseek-chat 与
deepseek-v4-flash 双模型名并存佐证走中转站）。

## 为什么 req_error 没被网关 fallback 吸收

model-gateway.js 有完整 fallback 机制，且 `req_error` 在 RETRYABLE_ERROR_CODES 里，但触发条件：

```js
canFallback = !emittedOutput && (isRetryableProviderError || fallbackWhen) && index < attempts.length - 1
```

`attempts = [primary.profile.id, ...fallbackProfileIds]`。若该 role 只配了**一个**模型 profile
（无 fallback 链），`attempts.length === 1`，条件恒假 → 错误直接冒泡前端。这是突发 req_error
表现为「聊天中断」而非「自动切换」的直接原因。

## 建议（未实施，待裁决）

1. **provider 层连接重试**：deepseek.js `agent: false` 每次新建连接且零重试；对 `req_error`
   （连接/TLS 阶段失败，emittedOutput 必为 false）在 provider 内部做 1 次快速重试（间隔 1s），
   可吸收中转站秒级抖动。
2. **给 chat/agent role 配置 fallback profile**，让网关现有 fallback 机制真正生效。
3. timeout 90s 从未实际触发，暂不动。
4. ai_usage 仅当日 14:34 后有记录，更早失败无法追溯（recordAiUsage 接入时间所致，非缺陷）。

---

# 附录 2：req_error 根因定案（2026-08-20 22:05 追加）——Clash TUN 代理链路抖动

> 更正附录 1 中「自定义 baseUrl 中转站」的推测：**不成立**。ai-settings.json 显示 deepseek
> profile 的 baseUrl 是官方 `https://api.deepseek.com`（deepseek-v4-flash 为官方 v4 系列命名）。

## 证据链（全部现场实测）

1. **`dig api.deepseek.com` → `198.18.0.57`** —— Fake-IP 段（198.18.0.0/15），代理 DNS 接管铁证
2. **Clash Verge（mihomo 内核）运行中**（PID 95105 + 特权服务 508），`utun1024` 接口 IP
   `198.18.0.1`（mihomo 默认 fake-ip-range）—— **TUN + Fake-IP 模式，全部流量经 Clash 隧道**
3. **失败时刻 dashscope（阿里云国内域名）全部成功** —— 国内域名走 Clash 直连规则，
   不受代理节点影响；deepseek 走隧道，节点抖动即挂
4. 错误形态吻合：「Client network socket disconnected **before secure TLS connection was
   established**」+ ~5s 耗时 + 同一秒内 3 个并发请求（agent_iter/title/fact_extraction）全灭
   —— 典型的**代理节点切换/断流瞬间，隧道内所有连接同时被杀**
5. 当前实测 api.deepseek.com 3 次握手全部正常（TLS 40-56ms，HTTP 401）—— 当前节点健康，
   问题只在特定时刻发生
6. 关联旁证：WorkBuddy 日志「CF WS connect failed」从 19:09 起每 70s 刷屏
   （Cloudflare WebSocket 连不上）—— 同一 Clash 隧道下另一受害面

## 回答「上下文足够为什么还失败」

请求**根本没到达 deepseek 服务器**：ai_usage 失败记录 p0/c0（prompt/completion tokens 均为 0），
TLS 握手在本机 Clash 隧道内就被掐断。与上下文长度、token 上限、模型能力**完全无关**——
是本机网络层的间歇性问题。

## 修复方向（按性价比排序，未实施）

1. **Clash 规则**：给 `api.deepseek.com` 加独立规则（DIRECT 或绑定稳定节点/专属分组），
   从源头隔离节点抖动 —— 一行规则，零代码
2. **应用层兜底**：deepseek.js 对 `req_error` 做 1 次快速重试（连接阶段失败必无已输出内容，
   重试安全）—— 附录 1 建议仍然有效
3. WorkBuddy 的 CF WS 失败同根，调 Clash 对 Cloudflare 的分流可一并缓解
