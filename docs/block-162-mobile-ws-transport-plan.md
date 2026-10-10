---
capability: mobile-gateway
goal: BLOCK-162 = 手机面传输 WS 化——agent 任务流从 SSE+500ms DB 轮询收敛为单条 WebSocket（零新依赖，进程内即时推送）；用户裁决「WS 化…能搞咱就 搞起来」
acceptance:
  - P0：零依赖 RFC6455 最小 WS 服务端（握手/文本帧收发/客户端掩码解码/ping-pong/close/发送背压上限；分片帧按协议错误显式关闭——边界如实）
  - P1：agent-task-store 进程内事件总线挂点（appendAgentTaskEvent 落库后 emit，additive 零 DB 语义变化）
  - P2：网关 `/m/api/ws` 端点——upgrade 会话门（cookie/Bearer/?session 同源同门）；sub/unsub 协议；afterSeq 水位回放 + 进程内即时推送 + 2s 兜底轮询（终态 done/failed/cancelled 帧语义与 SSE 对齐）；15s WS ping/pong 判死
  - P3：前端 subscribeAgentTask 投影环境 WS-first，失败 3 连退避 5min 回退既有 SSE；水位无限重连/抖动/HTTP 错误不重试语义全部保持（复用 BLOCK-159）
  - 门禁：后端 WS 契约测试（握手/掩码解码/回放/即时推送快于兜底轮询/终态帧/ping 判死/未授权拒绝）+ 前端 WS 路径单测 + 邻域回归 + tsc/docs/ui 门禁
reopen: 实机（真机过隧道）验收属 riders；范围改判需用户裁决
status: completed
---

# BLOCK-162 — 手机面传输 WS 化（agent 任务流单连接 + 即时推送）

- 状态：`active`（P0-LAUNCH · 2026-10-10 立项，目标一次会话收口）
- 用户裁决原话：「WS 化 是什么意思 能搞咱就 搞起来」（承接 BLOCK-159 收口报告中「SSE+HTTP → WebSocket 化」可选优化项）
- 关联：BLOCK-159（水位续传/心跳/退避——全部复用）/ BLOCK-70（网关）/ BLOCK-151（taskId 闭包守卫教训）/ BLOCK-87（nginx Upgrade 头已在：8442 块 `proxy_set_header Upgrade` 实机核查 2026-10-10）

## 1. 为什么 WS 化（诊断依据）

- **推送延迟地板**：agent 事件当前 = 服务端 500ms DB 轮询（`routes/ai-agent/events.js` poll）+ 隧道 RTT。网关与 agent-runner **同进程**——落库后进程内 emit 即可即时推送，地板归零。
- **连接收敛**：手机侧每任务一条 SSE + 终端一条 SSE + 数据轮询；WS 化后 agent 流单连接，断线重连面收敛。
- **ZCode/Codex 同型**：单 WS 多路复用是两家共同形态（ZCode `/ws` RPC、Codex remote-control WS）。

## 2. 范围

- **P0** `core/petri-server/mobile-gateway/ws.js`：零依赖最小 WS 服务端。握手指纹（SHA1+GUID）、text 帧编解码（2/8 字节长度）、客户端掩码解码、ping→pong、pong 判活、close 握手、发送缓冲上限（默认 1MiB 越限断开=慢消费者保护）。**边界如实**：分片帧（continuation）按协议错误显式 close——浏览器对小程序帧不分片，beyond-contract 显式拒绝优于静默错解。
- **P1** `agent-task-store.js`：`appendAgentTaskEvent` 落库成功后 `taskEventBus.emit`（additive；:628 的压实快照重写路径不挂——兜底轮询 2s 内回填，前端单调 seq 守卫去重）。
- **P2** 网关端点 `/m/api/ws`：upgrade 时按既有 sessionAuth 三源鉴权（cookie/Bearer/?session），未授权写 401 后销毁；`sub{taskId,afterSeq}` 越权校验同 SSE 端点（task.user_id 匹配）；事件帧形状与 SSE `{seq,eventType,payload}` 对齐、终态帧 `{t:"done",taskId,status,payload}` 对齐 done/error/cancelled+[DONE]；进程内即时推送 + 2s 兜底轮询双轨（单调 seq，重叠由前端守卫去重）；15s ping / 30s 无 pong 判死。
- **P3** 前端 `agentTaskStream.ts`：`isProjectionEnv()` 且 WebSocket 可用 → WS 单连接订阅；WS 传输级失败连续 3 次 → 5 分钟内直走既有 SSE（防升级被代理拦死的死循环）；**水位无限重连/30s 封顶抖动/非水位错误不重试/abort 上抛全部复用**（外层循环不变，仅单次订阅尝试内部换传输）。
- **非范围**：终端流 WS 化（环形缓冲重放已好用，另批裁决）；数据桥轮询 WS 化（SWR 语义另裁）；桌面端切 WS（桌面本机 RTT≈0，收益仅即时推送，随实机体感另裁）；批量多任务复用单连接（一任务一连接，简单优先）。

## 3. 依赖与环境

- **零新 npm 依赖**（ws 不可解析→自写最小实现；依赖变更清单默认「不新增」遵守）。
- 链路核查（2026-10-10 实机）：aliyun nginx 8442 块 `proxy_set_header Upgrade/Connection` 已在；`proxy_read_timeout 1h` 覆盖 WS 空闲；WS 15s ping 保活双保险。
- 后端改动需重启 dev 栈生效；实机（真机过隧道）验收属 riders。

## 4. 验收门禁（收口逐项对账）

1. `test/block162-ws-server.test.mjs`——握手指纹/掩码解码/编解码回环/ping-pong/close/背压越限断开/分片拒绝。
2. `test/block162-agent-ws-endpoint.test.mjs`——未授权 401/回放水位/即时推送快于兜底轮询（bus 命中）+兜底轮询补齐（bus 未覆盖路径）/终态帧/越权 sub 拒绝/双 sub 去重。
3. 前端 `agentTaskStream` WS 路径单测——WS 优先/回退 SSE（3 连失败）/水位续传语义不变。
4. 邻域回归（block151/159 系）+ tsc 0 + docs:check + ui 门禁 + quality 链。

## 5. 完成语义

P0-P3 全绿 + 门禁 1-4 通过 → `completed`。实机过隧道验收属 riders（UI 台账随 P3 登记）。

## 6. 收口笔录

**收口（2026-10-10，立项当日一次会话 P0-P3 全交付）**

- **交付**：P0 `ws.js` 零依赖 RFC6455 最小服务端（握手指纹 RFC 向量锚定/掩码解码/ping-pong/pong 判活/close/慢消费者 writableLength 越限 1009 止损；分片帧 1002 显式拒绝边界如实）；P1 `agent-task-store.js` 进程内事件总线（appendAgentTaskEvent 落库后 emit，additive，压实快照路径不挂由兜底轮询补齐）；P2 `agent-ws.js` 端点 /m/api/ws（upgrade 三源会话门/越权校验对齐 SSE/afterSeq 水位回放/bus 即时推送+2s 兜底轮询双轨/终态帧含 fallback 对齐 SSE error 语义/15s ping 30s 判死/单连接 sub 上限 8）；P3 前端投影 WS-first（传输级 3 连失败 5min 冷却回退 SSE；水位无限重连/30s 封顶抖动全复用 BLOCK-159）。
- **测试**：后端 13/13（ws-server 6+endpoint 7：RFC 向量/掩码/协议错误拒绝/心跳判死/背压/401 门/回放水位/即时推送快于轮询 400ms 断言（兜底 5s 拉开）/轮询补齐/越权/fallback 帧）；前端 3/3（WS 优先 fetch 零调用/水位跨传输/3 连失败回退 SSE）；邻域 58/58（block159×3+70×2+145/151/152/154）。**测试基建两课随包清偿**：①测试客户端 pong 帧漏 FIN 位（重构 firstByte 签名后调用点未跟，红 ④ 抓真）；②Windows 对接收缓冲有未读数据的连接丢弃 RST——慢消费者用例改断言服务端关闭态（观测方式错非实现错）+ 两个 socket 密集文件按 BLOCK-102 先例 `--test-force-exit`（进程收尾内核态尾巴，测试本体全绿）。
- **门禁**：tsc 0+lint 新文件 0 error（4 error 全在并行 BLOCK-160/163 在途文件，归因留痕）+arch 0 违+secret PASS+knip 240 键无新增+hygiene（唯一旗帜=并行 BLOCK-163 在途测试文件）；**实机**：dev 栈重启后 WS 端点四探全绿（无 token 401 拒绝升级/会话 101 升级/ping→pong/不存在任务 err 帧，探针设备已吊销）。
- **非范围留痕**：终端流/数据桥 WS 化、桌面端切 WS、多任务单连接复用（plan §2）。
- Jev：本包零 Jev 触点（无测试规划/台账回写建议需求，decision_log 为准）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
