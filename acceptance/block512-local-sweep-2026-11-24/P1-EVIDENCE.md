# BLOCK-512 P1 · web_fetch pin-IP 证据（2026-11-24）

## 缺陷（BLOCK-511 §2 第 8 项遗留）

`guardedFetch` 先 `resolveHostAddresses` 校验全部解析结果为公网，再把 URL 交给
`fetchImpl`（undici/global fetch）——undici 建连时**自行重新解析**，校验与建连之间存在
DNS rebinding TOCTOU 窗口（第一次解析公网、建连时被污染解析到私网即可绕过）。

## 修法（零新依赖，不削弱防护）

`core/petri-server/helpers/web-fetch-policy.js`：

- 新增 `pinnedLookupFor(records)`：对任何 hostname 只回已校验地址的 lookup——建连层
  不再查 DNS，DNS 重绑定影响不到连接目标（rebind-proof 核心属性）。
- 新增 `defaultTransport`：Node 内建 http/https + pinned lookup；https 时
  `servername=host`（SNI 与证书身份仍按目标主机名校验，证书链校验默认不变）；超时
  覆盖建连+读体全程，destroy 携 `TimeoutError` 名。
- 新增 `readStreamBounded`：流式有界读体（超限即断流截断），语义与既有
  `readBodyBounded` 一致；成功结果 additive 透传 `seenBytes`。
- `guardedFetch` 通道优先级：显式 `fetchImpl`（兼容契约，**明示不 pin-IP**，生产零注入
  不会走到）> `transportImpl`（新注入点，测试流式 shim）> `defaultTransport`（生产默认）。
- 逐跳重校验/私网拒绝/黑白名单/内容类型白名单/端口/凭据校验**一字未动**；重定向
  第二跳重新解析重新 pin；早退路径 `discardStream` 关闭底层流不留挂起 socket。

## HK-01 红绿先行

- 红（实现前）：`test/block512-web-fetch-pin-ip.test.mjs` 两条 red 用例对现码
  ✖——`transportImpl 路径应成功，实际={"ok":false,"code":"web_fetch_failed","message":"fetch failed"}`
  与 `web-fetch-policy 应导出 defaultTransport`（AssertionError 实录）。
- 绿（实现后）：**10/10**（pin 属性/redirect 重 pin/超时映射/有界截断/流关闭/本地实连/
  超时断开/live smoke）；live smoke 经默认 pinned 通道真实抓取 `https://example.com`
  200（TLS/SNI/证书链端到端成立，离线时显式 skip）。
- 邻域回归：block247 双文件 + qoder-l1l2 双文件 **33/33**（fetchImpl 兼容契约未破）。
- impact-map：新测试挂入 `block247-q2b-web-access` 规则。

## 诚实边界

- live smoke 依赖外网可达；离线/受限网络环境下该条显式 skip（探测 5s 超时兜底）。
- Windows 实机 PATH 项（P2）与本通道无交集。
