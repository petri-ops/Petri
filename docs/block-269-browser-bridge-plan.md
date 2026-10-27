---
capability: block-269-browser-bridge
goal: BLOCK-264（C-40）浏览器连接器第二垂直切片=前端桥接线：browser_act 的 transport 从如实失败变为真通道（event-bus SSE 下发 → 打开中的 BrowserPanel webview 执行 → action-result 回传 resolve）；browser_* 四工具加 REST 薄包装（复用 helpers 单一真相）供实机 flow 与未来面板驱动。
acceptance:
  - transport 桥契约（Node）：SSE 下发载荷含 actionId+params；回传 resolve pending（结果/错误两态）；25s 超时 transport_timeout；未知 actionId 404。
  - REST 四面契约：connect/act/status/disconnect 与 agent 工具同一 helpers（单一真相）；navigate=read 类免审批，click/fill 无 ackToken 如实 ack_token_required；未连接 browser_not_connected；私网 URL 硬拒。
  - 前端执行器纯逻辑（browser-action-bridge）：五动作 webview 包装注入可测；navigate 用 loadURL；executeJavaScript 参数全 JSON.stringify 注入（零字符串拼接 selector）；结果回传只 JSON。
  - 实机腿（隔离 9223 亮暗）：REST connect → act navigate 公网白名单域 → BrowserPanel webview 真导航 → 回传 → act 返回 ok + status actionsPerformed=1；私网 navigate 拒绝；click 无 ackToken 拒绝；未连接拒绝。断言 JSON 落 acceptance/block-269/。
  - closeout 十三门 PASS；registry/README/roadmap/handoff/AUDIT-LOG 回写。
reopen: native messaging / Chrome 扩展（传输层第三形态，接口已按 provider 抽象预留）；screenshot 像素回传（传输层约束维持只回尺寸）。
status: completed
---

# BLOCK-269 · 浏览器连接器前端桥（C-40 尾项，批次 2/5）

用户发令：「行！ 你规划一下 按顺序批次完成」（2026-10-27）。上游=BLOCK-264 C-40（连接会话+白名单+审批门执行面骨架，transport 如实 unavailable）+ BLOCK-265 T1（如实登记 reopen=BrowserPanel 事件桥接线）。

## 1. 通道设计（复用既有基建，零新依赖）

```
agent loop / REST act
  → browser-tools.currentTransport().perform(params)
    → pending map（actionId → resolve，25s 超时）
    → event-bus.publishInvalidation('browser-connector', {kind:'browser-action', actionId, params})
      → SSE /api/events（既有失效广播通道）
        → BrowserPanel useInvalidationStream 订阅
          → webview 执行（loadURL / executeJavaScript / capturePage）
            → POST /api/browser-connector/action-result {actionId, ok, result|error}
              → resolve pending → perform 返回 → connector.act 收尾（白名单计数/lastUrl/有界返回）
```

红线兑现：本桥不自造第二事件通道（复用 CK-03 event-bus）；执行面单一真相仍在 helpers/browser-connector.js（REST 与 agent 工具同一入口）；executeJavaScript 零字符串拼接（参数全 JSON.stringify）；screenshot 只回尺寸不回像素（传输层约束不破）。

## 2. 断言面

| 层 | 断言 |
| --- | --- |
| 契约（Node） | 下发/回传/超时/未知 actionId 404/错误态 resolve；REST 四面与 helpers 同源语义（未连接/白名单私网/ackToken 门）；执行器纯逻辑五动作+失败态 |
| 实机（亮/暗） | connect→navigate（白名单域）→webview 真导航→回传→act ok + status 计数=1；私网拒；click 无 ackToken 拒；未连接拒 |

## 3. 阶段

- P1 契约红绿：transport 桥 + REST 四面 + 执行器纯逻辑。
- P2 前端接线：BrowserPanel 订阅 + 桥调用（webview ready 防御）。
- P3 实机腿：隔离 9223 亮/暗（flow b269-browser-bridge-live）。
- P4 closeout + 回写。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 4. 收口记录（2026-10-27）

- 契约=Node 5/5 + 前端执行器 6/6；实机亮/暗各 **12/12**（`acceptance/block-269/browser-bridge-live{,-dark}.json`）。
- **实机抓真两处**：①event-bus 把 payload 展开在事件顶层（`useInvalidationStream` 的 info.payload=整个事件对象）——flow 首版按嵌套取法错过帧，修正后链 A 全绿；②SSE abort 重置 keep-alive 连接波及复用连接的 fetch（ECONNRESET unhandled rejection 崩进程）——flow 的 rest() 加重试+未 await promise 兜底。
- 链 B 真证据：隔离 9223 离屏 Electron 里 BrowserPanel webview 真执行 read_text（读到真实页面文本）+ navigate 外网真实导航——前端桥全链（订阅→webview→回传→resolve）实机通。
- lint 首跑 15 error 全为本批新文件形态（mock async 无 await/无谓断言/未用函数），按真缺陷修零豁免。
- knip +1（b269 flow 动态入口 --update 留痕）；closeout 十三门 PASS；不推送。
