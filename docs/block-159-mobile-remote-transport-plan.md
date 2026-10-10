---
capability: mobile-gateway
goal: BLOCK-159 = 手机远程传输层优化（mobile-gateway 慢/易断根因修复）；用户裁决「立项 马上解决这个…P0-P2 都要整完」
acceptance:
  - P0-1：生产投影 gzip（compress.js 零依赖，buffered JSON/文本 + /assets 有界缓存）；契约=阈值/已编码/HEAD/SSE 跳过规则 + wire 级 Content-Encoding + 非 gzip 客户端透传
  - P0-2/P0-5：探活连败 2 次自愈重连（单次 fail 不触发、ok 清零）+ ServerAlive 15→10 + 退避 ±30% 抖动 + 清场链并行（不变量「清场完成前绝不 spawn」保持）
  - P0-3/P0-4：agent SSE 15s 注释帧心跳（close/终态双路径清理）+ 审计 appendFile 异步写（appendFileSync 退役）
  - P1-6/P1-7：agent 流水位续传（删 90s 硬预算，1s→30s 封顶+抖动，HTTP 5xx/abort 不重试）+ 限流按会话 token 分桶（同桶/异桶/IP 退回）
  - P1-8/P1-9：projectionLink 状态/resync 总线（回前台派发、终端桥重挂）+ 数据桥断连上报 + 断连横幅 UI-482（仅投影渲染）
  - 门禁：定向红绿（后端 13 + 前端 9）+ 邻域 32 全绿 + impact-map block159 规则 + docs/ui 门禁 + quality 链
reopen: 实机（真机过隧道）验收属 riders；范围改判需用户裁决
status: completed
---

# BLOCK-159 — 手机远程传输层优化（mobile-gateway 慢/断根因修复）

- 状态：`active`（P0-LAUNCH · 2026-10-10 立项，目标一次会话 P0×5 + P1×4 全收口）
- 用户裁决原话：「立项 马上解决这个 注意 其它agent看是否存在冲突 尽可能不要冲突 P0-P2 都要整完 Codex 的进程崩溃恢复快照思路需要 手机投影首屏瘦身 这个没必要吧？」——裁决要点：①全做但不与并行 agent 冲突；②P2 两项经质询收敛：**进程崩溃恢复快照不做**（见 §3.1 理由）、**手机投影首屏瘦身不做**（与 UI-357「整个软件桌面原封不动的过来」既有裁决一致）。
- 关联：BLOCK-70（mobile-gateway）/ BLOCK-85（联邦/投影桥）/ BLOCK-87（限流与性能）/ BLOCK-145（清场异步化）/ BLOCK-149+152（隧道诚实性+探活）/ BLOCK-154（终端 SSH 保活，同族不同文件）。
- 参考系：ZCode v3.14.3 web 模式（`reference/ZCode`）与 Codex `app-server`/`remote-control`（`reference/codex`）的「会话与连接解耦 + 水位续传」范式（调研 2026-10-10，仅取思想不引代码）。

## 1. 背景与根因（2026-10-10 诊断，证据 file:line）

用户反馈手机远程「很慢、容易断」。三层根因（诊断会话全量排查）：

- **慢**：①生产投影全程无压缩（`mobile-gateway/index.js` 静态与 API 均无 gzip，压缩只在 dev Vite 代理路径 `:444-449`；`tunnel.js` 无 Compression）——首屏 ~1.5-2MB 裸奔；②逐请求隧道 RTT × 轮询密度；③agent 事件 = 服务端 500ms DB 轮询 + RTT（`routes/ai-agent/events.js:122`）。
- **易断**：①隧道恢复太重——ServerAlive 15s×3=45s 判死 + 每次重连清场链 15-35s（含远端端口清扫 25s 硬超时）+ 退避 30s 封顶，单次抖动全断 30-70s（`tunnel.js:190-201,66-101,294-335`）；②探活只报告不自愈——60s probe fail 仅记状态不触发恢复（`tunnel.js:383-387`）；③agent SSE 无心跳——空闲期零字节，中转 nginx 默认读超时掐断思考中长流；前端重连预算 24 次/90s（`agentTaskStream.ts:32-34`），烧窗即报「任务中断」；④经隧道全设备共享 127.0.0.1 的 600/min 限流桶，429 后数据桥静默吞错 =「卡死」观感（`index.js:27-35,60-72`、`projectionDataBridges.ts:26-30`）。
- **已排除**：会话过期（一年长效 cookie，`pairing.js:163-171`）；手机锁屏会话仍在。

## 2. 范围（P0×5 + P1×4）

### P0-1 生产投影 gzip（新模块 `core/biof3-server/mobile-gateway/compress.js`，零新依赖）

- buffered 中间件：`res.json`/`res.send` 的 JSON/文本响应按 `accept-encoding` gzip（阈值 >1KB；`content-type: text/event-stream` 跳过；已带 `Content-Encoding` 跳过；HEAD 跳过）。
- 静态资产：`/assets/**` 请求时 gzip + 有界字节缓存（默认 32MB 上限，mtime 失效），immutable 缓存头保持既有语义；非 gzip 客户端 fallthrough 既有 `express.static`。
- 接线点：`buildMobileGateway`（`index.js`）。SSE 三处（终端/agent/移动页）一律不压缩。

### P0-2 探活 fail → 自愈重连（`tunnel.js`）

- probe **连续 2 次** fail（`PROBE_FAIL_RECONNECT_THRESHOLD`）→ `forceReconnect`：杀全部 tracked 孩子 + `setState('reconnecting')` + 走既有退避重连（exit 事件丢失误差异由 spawn 前清场链兜底）；probe ok 或状态转移即清零连败计数。
- `ServerAliveInterval` 15→10（判死窗口 45s→30s；`CountMax=3` 保持）。
- 退避延迟加 ±30% 抖动（rng 注入点，测试确定性）。

### P0-3 agent SSE 心跳（`routes/ai-agent/events.js`）

- 订阅建立后每 15s 写 SSE 注释帧 `: ping\n\n`（与终端 SSE `index.js:349-351` 同款）；`req.close` 与终态结束路径清理计时器。SSE 注释行对 EventSource 与手工解析器（`/^data:\s?/`）天然透明。

### P0-4 审计异步写（`mobile-gateway/index.js`）

- `createAuditWriter`：`appendFileSync` → `fs.appendFile` fire-and-forget（回调吞错，fail-open 语义不变）。行 ≤4KB 在 O_APPEND 下原子性不受影响。

### P0-5 重连链降本（`tunnel.js`）

- spawnTunnel 清场链 `killStale` 与 `remotePortSweep` 改并行（`Promise.all`；本机孤儿清场与远端端口清场互不依赖，不变量「两者都完成才 spawn」保持）。
- exit handler 加守卫：`reconnectTimer` 已在排程时不再重复排程（防探活自愈路径与 exit 路径双排程）。

### P1-6 agent 流水位续传（`frontend/src/components/copilot/copilotClient/agentTaskStream.ts` + `events.js`）

- 删 24 次/90s 硬预算：`AgentStreamDisconnectedError` 且 afterSeq 可续 → **无限重试**，退避 1s 起、指数到 30s 封顶、带抖动；`onStreamReconnecting` 持续上报（UI 呈现「重连中」而非「中断」）。
- 依据：服务端 DB 即真相源（`getAgentTaskEventsSince(taskId, afterSeq)` 持久回放）+ 前端 BLOCK-151 单调 seq 守卫已在，重试安全性由水位语义保证（ZCode/Codex 范式的最小落地）；终态后重连会回放 done/error/[DONE] 正常收口。
- 不变式：非 `AgentStreamDisconnectedError`（HTTP 4xx/5xx、AbortError）仍不重试；任务不存在（404）不重试。

### P1-7 限流按会话计数（`mobile-gateway/index.js`）

- `createRateLimiter` 桶键：会话 token 原始值（cookie `gw_session` / Bearer / `?session=`）sha256 短哈希优先，无 token 退回 IP（配对面）。SSE 为单请求天然不因心跳计数。

### P1-8 投影链路感知 + 回前台 resync（新模块 `frontend/src/lib/projectionLink.ts`）

- link 状态总线：`markBridgeFailure/markBridgeSuccess` → 状态转移时派发事件；`onProjectionLinkChange` 订阅。
- resync 总线：projection 环境注册 `visibilitychange`（回可见即派发）；`onProjectionResync` 订阅。
- 终端桥（`projectionTerminalBridge.ts`）订阅 resync：对仍存活的 session 关闭旧 EventSource 重挂（服务端环形缓冲天然重放）。

### P1-9 数据桥显式断连态（`projectionDataBridges.ts` + 新组件）

- `getJson` 网络错/429/5xx → `markBridgeFailure`；成功 → `markBridgeSuccess`（数据返回形状零变化，消费方无感）。
- 新组件 `frontend/src/components/desktop/_ProjectionLinkBanner.tsx`：离线时显示固定顶横幅「与桌面连接中断，正在自动重试…」，恢复自动隐藏；挂载于 `App.tsx`（仅投影环境渲染）。
- UI 台账：**UI-482**（投影断连横幅 + 回前台重同步）。

## 3. 非范围（exclusions）

1. **进程崩溃恢复快照（Codex daemon 模式）不做**：格物的会话真相源本就在 SQLite（task_events 按 seq 持久），网关重启后手机凭水位重连即自然恢复——P1-6 的水位语义已覆盖会话层恢复；进程级崩溃 = 桌面后端整体重启场景，属桌面生命周期域，超出手机面边界。
2. **手机投影首屏瘦身不做**：用户裁决砍掉；与 UI-357「桌面原封投影」一致。压缩（P0-1）已覆盖首屏体积大头。
3. 不做 WebSocket 改造 / 不引入 bot 通道 / 不动中转服务器侧配置与交付指引（`docs/guides/mobile-tunnel-aliyun-setup.md` 仅可加注心跳相关性）。
4. 轮询密度治理（WorkspaceSummaryCard 5s×3 等）不在本包——等 P0-1/P1 系落地后按实测再评估。
5. **BLOCK-158（并行包，商店面退役）文件面零触碰**：`src/plugin/**`、`src/ipc/plugin.js`、`src/ipc/channels.js`、`src/preload.js`、`core/biof3-server/plugin-loader.js`、`frontend/src/hooks/usePluginStore.ts`、`frontend/src/lib/electron.d.ts`、`test/block157-plugin-enabled.test.mjs`、`acceptance/dev-verify/app-health-live.json`。唯一同文件交叉 `frontend/src/lib/projectionDataBridges.ts`：其改动在 `pluginsBridge` 段（install/uninstall 删除），本包改动在 `getJson` 头部与导出段，行区不相交；提交时按 hunk 精确暂存本包改动，绝不整文件打包对方在途改动。

## 4. 依赖与环境纪律

- 零新 npm 依赖（gzip 用 `node:zlib`；抖动用注入 rng）。
- 后端改动生效需重启 dev 栈（本次为纯代码+测试交付，实机过目按 riders 登记待用户重启验证）。
- 契约测试沿用 `test/block152-tunnel-probe.test.mjs` 的注入约定（假进程/假清场/假 fetch/假钟）。

## 5. 验收门禁（收口逐项对账）

1. `test/block159-gateway-compress.test.mjs` —— 压缩中间件契约（JSON gzip / 阈值跳过 / SSE 跳过 / 静态 assets gzip+缓存头 / 非 gzip 客户端透传 / 缓存有界）。
2. `test/block159-tunnel-selfheal.test.mjs` —— 探活连败→自愈重连 / 单次 fail 不触发 / ok 清零 / 抖动有界 / 清场并行不变量 / exit 不覆盖已排程 timer。
3. `test/block159-agent-stream-resume.test.mjs` —— agent SSE 心跳帧存在+清理 / 限流按会话 token 分桶 / 无 token 退回 IP。
4. 前端：`projectionLink.test.ts`（状态转移+resync 派发）、`agentTaskStream` 重连语义（无限重试/退避封顶/非水位错误不重试）+ `tsc --noEmit` 0。
5. `npm run test:changed`（impact-map 登记 block159 规则后）。
6. `npm run docs:check` + `npm run ui:audit:check`（UI-482 登记）。
7. quality 链：`quality:lint`（新文件零新增违规）/ `quality:types` / `quality:knip:check`（新导出必须被引用）/ `quality:secret` / `quality:arch`。

## 6. 完成语义

P0×5 + P1×4 全绿 + 门禁清单 1-7 通过 → `completed`。实机（真机过隧道）验收属 riders：需用户重启 dev 栈后实测，登记待过目项。

## 7. 收口笔录

**收口（2026-10-10，立项当日一次会话 P0×5+P1×4 全交付）**

- **交付**：后端五件——`compress.js`（零依赖 gzip：buffered 中间件 + /assets 有界缓存接线 `index.js`）+ 探活连败 2 次自愈（`forceReconnect`，单次 fail 复测、ok 清零）+ ServerAlive 15→10（判死 45s→30s）+ 退避 ±30% 抖动 + 清场链并行（`Promise.all`，不变量「清场完成前绝不 spawn」保持，exit 不覆盖已排程重连）+ agent SSE 15s 心跳（`events.js`，close/终态双路径清理）+ 审计 `appendFile` 异步写 + 限流按会话 token 分桶（sha256 短哈希，IP 退回）。前端四件——agent 流删 90s 硬预算（1s→30s 封顶+抖动，水位续传；HTTP 5xx/abort 不重试语义保持）+ `projectionLink.ts`（状态/resync 双总线，回前台派发）+ 终端桥重挂（EventSource CLOSED 才重挂，环形缓冲重放）+ 数据桥断连上报 + 断连横幅 `_ProjectionLinkBanner`（App.tsx 挂载，仅投影渲染）。
- **抓真两件（随包清偿）**：①`shouldCompressBuffer` 首版 `text\/` 前缀误命中 `text/event-stream`（红 1 抓真→显式排除修复）；②`jitteredDelay` 首版 250ms 下限抬高既有注入测试的 10ms 退避档（block70-tunnel 邻域红抓真→下限 1ms，生产档 ≥1s 语义不变）。
- **门禁对账（plan §5）**：①②③ 定向=后端 13/13（compress 4+自愈 4+心跳/审计/限流 5）；④ 前端=projectionLink 5/5 + agentTaskStream 重连 4/4 + **既有 projectionDataBridges 契约 14/14 零漂移**；邻域回归 32/32（block70×2+145+151+152+154）；tsc 0；docs:check PASS(308)；ui:audit:check PASS（UI-482 登记）；quality:lint 0 error；secret PASS；arch 0 违规；knip 240 键无新增；impact-map block159 规则登记（157 条）。**两门被并行会话在途产物阻塞（归因留痕，非本包产物）**：`test:changed` 卡 `scripts/ui-audit-probe.cjs`（BLOCK-158 未跟踪新脚本未登记分类，工具 exit 2 非本包文件）；`gate:code-size` 卡 `PluginStorePanel.tsx` 指纹漂移（BLOCK-158 在途文件，本包零触碰不代打重锚）。两门的等价证据=按规则点名直跑全绿（上述 45+23）。
- **riders**：UI-482 翻 verified 需真机走查（断连→横幅出现→恢复自动消失）；P0-1/P0-2 生效需重启 dev 栈。
- **P2 收敛留痕**：崩溃恢复快照不做（§3.1）；首屏瘦身不做（用户裁决）。
- Jev：test:suggest 立项时 http_error 降级如实；doc:suggest 收口时 partial_degraded（http_error），确定性命中 uiAudit 已随包登记。

G0 开发期常态 · 不外推 packaged/Provider/GA。
