---
capability: mobile-gateway
goal: BLOCK-183 = 竞争力总纲 CP-19 数据桥 WS 化收官——投影数据桥读面从每请求一条 HTTP 走既有 /m/api/ws 单连接信封（WS-first），传输级 3 连失败回退 HTTP（现状语义）；用户裁决「行 你启动我来测试看看」（2026-10-14，批准主代理推荐「CP-19 收官 + 顺带轻量对账批」）
acceptance:
  - P0：服务端 /m/api/ws 扩 `data` 请求/响应信封——`{"t":"data","id","url"}` 严格 GET 白名单（七条数据桥读路径）+ 并发上限 + 8s 超时；服务端 loopback 自调既有路由（同一 Express 链：sessionAuth/限流/形状零第二实现），响应 `{"t":"data-res","id","status","data"}` / `{"t":"data-err","id","error"}`
  - P1：前端 projectionWsData 共享单连接（id 关联 pending 表/连接超时/断线清 pending）+ projectionDataBridges 读面 WS-first、失败逐请求回退 HTTP；3 连传输失败 5min 冷却（对齐 BLOCK-162 P3 形态）；POST（aiSettings.save）维持 HTTP 零改写
  - 门禁：红绿先行——后端 data 信封契约测试（白名单 fail-closed/id 关联并发/状态透传/超时/会话门外零到达）+ 前端 WS-first 单测（WS 优先 fetch 零调用/回退/冷却/断线清 pending）；邻域回归（block162 系）+ tsc + docs/ui 门禁
  - 实机：隔离网关探针七路径 data-res 与 HTTP 同形状对账 + WS/HTTP 延迟对比留痕（acceptance/block-183/）
reopen: 真机过隧道验收属 riders；范围改判需用户裁决
status: completed
---

# BLOCK-183 — 数据桥 WS 化（CP-19 收官：投影数据读面单连接信封 + HTTP 回退）

- 状态：`completed`（2026-10-14 立项当日一次会话收口；收口笔录 §6）
- 用户裁决原话：「行  你启动我来测试看看」（批准主代理推荐：下一包走 CP-19 收官 + 顺带轻量对账批）
- 来源：竞争力总纲 [agent-competitiveness-program.md](./agent-competitiveness-program.md) §4-W6 唯一 deferred 项 CP-19（W6 收口笔录：传输层协议变更为移动栈跨端契约面，宜新会话整段设计——本包即该整段设计）
- 关联：BLOCK-162（WS 服务端/端点/前端 WS-first 形态——全部复用扩展）/ BLOCK-159（网关会话门/水位——零改写）/ BLOCK-87（投影数据桥 L4 起点）/ BLOCK-158（插件写面退役——本包读面之外零触碰）

## 1. 立项自检（产品个性纪律问句）

「这个能力的形态与 ZCode/Codex 的差别在哪？」——借的是单 WS 多路复用之形，长的是自有形态：**零依赖自写 WS 服务端 + 网关会话门同源同门 + GET 白名单 fail-closed + 服务端 loopback 自调既有路由（数据形状与桌面 HTTP 单一真相，不建第二套读实现）+ 3 连失败诚实回退 HTTP**。本地可审计（读面走本机网关、审计/限流中间件全量复用不旁路）；治理透明（回退是显式设计而非静默兜底）；证据自证（live 探针七路径同形状对账 + 延迟对比留痕）。

## 2. 范围

- **P0 服务端**（`core/petri-server/mobile-gateway/agent-ws.js` 扩展，同一端点零新路径）：
  - 协议扩展：C→S `{"t":"data","id","url"}`；S→C `{"t":"data-res","id","status","data"}`（HTTP 响应同形状透传）与 `{"t":"data-err","id","error"}`（传输级：path_not_allowed/data_overloaded/data_timeout/data_fetch_failed）。
  - **GET 白名单严格相等**（七条，与前端桥当前调用面一一对应）：`/api/skills/registry`、`/api/plugins/installed`、`/api/plugins/catalog`、`/api/packs/installed`、`/api/packs/available`、`/api/runtime/status`、`/api/ai/settings`——白名单外 fail-closed 回 `data-err`，不扩查询参数透传（v1 无参数面；白名单扩张属显式登记）。
  - 服务端自取数：`fetch(http://127.0.0.1:<port><url>, { Authorization: Bearer <连接会话 token> })`——同一 Express app（sessionAuth/限流/gzip/审计中间件全量在链），**读面实现零第二份**；连接会话 token 在 upgrade 时已鉴权捕获（hub 'connection' 事件第二参 req）。
  - 并发上限 16/连接、单请求 8s 超时（AbortSignal.timeout）、响应按 id 关联回帧；连接关闭即放弃在途（fetch 已 abort 由信号传播）。
- **P1 前端**（新 `frontend/src/lib/projectionWsData.ts` + `projectionDataBridges.ts` 接线）：
  - 共享单连接（模块级惰性建连，`ws(s)://location.host/m/api/ws`；5s 建连超时；id→pending 关联表；断线清 pending 全部走 HTTP 回退）。
  - `getJson` 读面 WS-first：WS 成功 → `markProjectionBridgeSuccess`；WS 传输失败 → 逐请求静默回退既有 HTTP fetch（横幅语义由 HTTP 最终结果决定，零行为漂移）。3 连传输失败 → 5min 冷却直走 HTTP（对齐 agentTaskStream 形态）；冷却到期恢复尝试。
  - **POST（aiSettings.save）与全部诚实禁用写面维持现状零改写**——本包只动读面传输。
  - 白名单前端镜像（不发白名单外请求；服务端白名单仍是真值门）。
- **非范围（exclusions）**：agent 任务流/终端流协议零触碰（sub/done/ev 帧语义不动）；写面（安装/卸载/执行/凭据）投影禁用语义不动；桌面端（非投影环境）数据桥不激活（isProjectionEnv 门保持）；带查询参数的数据读、SSE/POST 的 WS 化、多连接池、HTTP/2/QUIC 不做；真机过隧道实测属 riders。

## 3. 依赖与环境

- **零新 npm 依赖**（fetch/AbortSignal/WebSocket 皆内建）。
- 后端改动需重启 dev 栈生效（网关进程内挂载 agent-ws）；用户实测姿势=投影环境（LAN/手机过网关）打开 Skills/插件/领域包/设置读面，DevTools Network 观察 /api/* 数据请求消失、仅 /m/api/ws 一条连接。
- 并行隔离：本包触碰面=agent-ws.js + 新前端 lib + 两测试文件 + 台账；block162 系测试为只读回归面。

## 4. 验收门禁（收口逐项对账）

1. `test/block183-data-ws.test.mjs`（红绿先行）——白名单外 `data-err`(path_not_allowed)/白名单内 `data-res` status+data 透传/双请求 id 关联不串线/上游 500 透传/超时 `data-err`(data_timeout)/未授权连接零 data 帧到达（upgrade 门既有）/并发上限。
2. 前端 `projectionWsData.test.ts`（红绿先行）——WS 优先且成功时 fetch 零调用/WS 失败逐请求回退 HTTP/3 连失败 5min 冷却/断线清 pending 回退/POST 不走 WS。
3. 邻域回归：block162 两文件 + projectionDataBridges 既有测试全绿；tsc 0。
4. 实机探针 `scripts/block183-data-ws-live.mjs`：真实 buildMobileGateway + 七路径 data-res 与 HTTP 响应形状逐字段对账 + WS/HTTP 延迟对比落 acceptance/block-183/。

## 5. 完成语义

P0+P1 交付 + 门禁 1-4 全过 + 台账回写 → `completed`（当日立项当日收口目标）。真机过隧道延迟实测属 riders。

## 6. 收口笔录

**收口（2026-10-14，立项当日一次会话 P0+P1 全交付，CP-19 收官=竞争力总纲 19 包全闭环）**

- **交付**：P0 `agent-ws.js` 扩 `data` 请求/响应信封（GET 七路径白名单严格整串相等 fail-closed；并发上限 16/连接；8s 超时 AbortSignal；响应 id 关联；连接会话 token 于 upgrade 时捕获、自调 loopback 打回同一 Express app=读面形状单一真相零第二实现）；P1 前端 `projectionWsData.ts` 共享单连接（惰性建连 5s 超时/id→pending 关联/断线清 pending/成功清零连击）+`projectionDataBridges.getJson` 白名单读面 WS-first 逐请求静默回退 HTTP（横幅语义由 HTTP 最终结果决定）+3 连传输失败 5min 冷却；**POST/写面/agent 任务流/终端流零触碰**；`isProjectionEnv` canonical 迁 `projectionLink.ts`（叶子模块防循环导入，桥 re-export 保持消费方导入路径不变）。
- **红绿先行**：后端 `test/block183-data-ws.test.mjs` 先落 8 用例红（初始红=实现未写）→实现后 8/8 绿；前端 `projectionWsData.test.ts` 6 用例红→6/6 绿。
- **实现期抓真**：①`connectOnce` 初版执行器内自引用 `connecting !== promise` 守卫恒假（executor 运行时赋值未完成）→共享连接永不 resolve，重构为显式 settled 标志+落定统一清槽（含构造器同步 throw 路径）；②探针 `await new Promise(resolve=>app.listen(0,cb引用const左值))` TDZ 崩溃→同步赋值+deferred resolve；③探针白名单整串匹配拒查询串（测试桩原设计带 `?delay=`）→桩改 handler 级慢路径。
- **存量缺陷顺手清偿（干净树 bisect 坐实非本包面）**：`streamReconnect.test.ts` 4 红首次暴露——BLOCK-159 P1-6 给退避加 ±30% 抖动时未同步该文件精确断言（1000/2000），且「24 次硬上限」两用例未随 P1-6「重试不设硬上限」裁决同步（生产码无限水位重连→runAllTimersAsync 万定时器熔断）；该文件此前不在 test:changed 受影响集合（本包触碰 projectionLink/projectionDataBridges 同属 block159 规则首拉入）。修=固定 Math.random=0.5（抖动乘子恰 1）+两用例按新语义重写（60s 有界窗断言持续重试 ≥5 轮+onDone 零调用+abort 退出，「不假完成」核心判据保留）→10/10 绿。
- **门禁总账**：后端 data 信封契约 8/8（白名单透传/fail-closed/500 透传/id 并发关联/超时/并发上限/401 门/白名单常量对账）+前端 20/20（新 6+既有桥契约 14，既有文件加确定性 fail-mode WS 桩防 happy-dom 真连）+block162 邻域回归 13/13 零破坏+agentTaskStream 3/3+tsc 0+test:changed 全绿（存量 4 红已顺手清偿）+docs:check 338 PASS+ui:audit PASS。
- **实机**：隔离网关探针 `scripts/block183-data-ws-live.mjs`（buildMobileGateway+attachAgentWs 生产同形挂载+full route registry 真实路由模块）**allPass**——七路径 data-res 与 HTTP 响应 status+JSON 逐字节一致（形状单一真相实证）+错 token 401+白名单外 path_not_allowed；延迟对比本机 loopback WS≈HTTP（15~16ms 中位，隧道增益属 riders，acceptance/block-183/data-ws-live.json）。
- **doc:suggest**（cloud）：建议 uiAudit+planDoc——planDoc 已承载与本批动作一致；uiAudit 按 BLOCK-162 同质先例（纯传输层无新 UI 元素）不登记，如实留痕。test:suggest（cloud）：零建议（conf 0.56<0.8 below_threshold）。jev×3（会话口径 npm run decision:session 取数）。
- **台账**：registry BLOCK-183 → completed；roadmap/backlog/AUDIT-LOG/总纲 §4-W6 CP-19 行（**总纲 19 包全闭环**）/handoff 同步；impact-map 登记 block183-data-ws-probe 规则（探针脚本 governance 角色，同 ui-proxy-review 先例）。
- **非范围留痕（plan §2）**：带查询参数读面/多连接池/桌面端激活/真机过隧道实测（riders：双机/隧道环境齐备后随 CP-16 联邦实测同批）。
- **riders/UI-512（同日代行实机评估 verified）**：真浏览器全链验收通过（/pair 配对→/ 入口→技能货架 11 卡渲染；页面内应用模块本体 wsDataRequest=200/14 技能/7ms/零浏览器直连，acceptance/block-183/ui512-live.json+截图）。随批登记两 findings：①BackendStatusProvider 直连 runtime/status 轮询=桥外消费方（BLOCK-86 既有设计，迁移候选不立项）；②**dev 环境深链陷阱**——/skills 等深链在 dev 落 frontend/dist 旧构建（10-12，无本包代码）走 HTTP，系 BLOCK-87 窄 Vite 代理设计+dist 陈旧叠加，生产单构建不受影响；重开条件=dev 深链测试误导诊断再现（建议：dev 投影测试一律从 / 入口进）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
