---
capability: q8-rem-mcp-tail
goal: 补齐 MCP 客户端尾项——① SSE 传输（SDK 自带 SSEClientTransport，零新依赖）；② HTTP/SSE 自定义凭据 headers（密文落盘、状态面只透键名、导出剥离）；③ OAuth 本地撤销与重新授权（账号切换）；J2 技能自进化与 J6 Agent builder 不做。
acceptance:
  - SSE：`transport='sse'` 配置经 SSEClientTransport 连接、工具发现/调用可用，状态面/健康面如实透出；缺 url 拒绝；授权入口对 http/sse 同样可用。
  - headers：HTTP/SSE 自定义 headers 加密落盘、读侧解密仅供连接、状态面只透键名与数量、配置导出剥离、导入按 id 保留；连接时同时作用于 SSE GET 与 POST；非法名/CRLF 拒绝。
  - OAuth：本地撤销 token（断开 + 清 tokens/pending/verifier，默认保留 client 注册），UI 提供「断开授权 / 重新授权」；如实声明服务端令牌在过期前可能仍有效。
  - 契约测试 + types/lint/theme + test:changed；隔离 9223 亮/暗；closeout 十三门逐门取证；canonical 回写。
reopen: J2 技能自进化建议 / J6 Agent builder（可选，另包）；RFC 7009 服务端令牌撤销（需 provider metadata）；多账号并存；SSE server 端实现；真实 provider 矩阵与 packaged 签名=G1+。
status: completed
---

# BLOCK-258 · Q8-REM MCP 尾项：SSE 传输 + 自定义凭据 headers + OAuth 本地撤销

用户发令「行 Jev 单一建议…冲完」（2026-10-25）。范围=Q8-REM 三项核心；J2/J6 可选不做（见非范围）。

## 0. P0 实码对账（2026-10-25）

| 项 | 实况 | 结论 |
| --- | --- | --- |
| 传输 | `mcp-settings`/`config-schema` 只认 `stdio/http`；`client-manager` 只加载 `StreamableHTTPClientTransport`。SDK **1.29.0** 自带 `SSEClientTransport` 且 `eventsource` 已是 SDK 依赖 | 加 `sse` 传输，**零新增依赖** |
| 自定义 headers | 配置只有 `env`（stdio）；HTTP/SSE 无 headers 字段；`env` 已由 `mcp-env-crypto` 密文落盘、导出剥离、导入按 id 保留 | 新增 `headers`，复用同一加密/剥离/保留纪律 |
| OAuth | `mcp-oauth-store` 有 tokens/pending/clientInformation；`removeServer` 仅在删 server 时清整条；无「撤销 token / 重新授权」入口；SDK OAuth 只对 http 接线 | 新增本地 revoke（清 tokens+pending+verifier，默认保留 client）+ UI 重新授权 |
| 账号切换 | 无 | 以「撤销本地令牌 → 重新授权」实现；不做多账号并存 |
| J2/J6 | 无实现 | **不做**（可选、体量另计） |
| 既有测试 | `block163` HTTP 夹具、`block239` OAuth 夹具（DemoInMemoryAuthProvider + Bearer 保护）、`mcp-client-settings` / `mcp-client-manager` | 复用夹具模式；新增 SSE 夹具（SDK `SSEServerTransport`） |

## 1. 非范围

- 不做 J2 技能自进化建议、J6 Agent builder。
- 不做 RFC 7009 服务端令牌撤销（本地撤销如实声明边界）；不做多账号并存。
- 不做 SSE server 端产品实现（仅客户端 + 测试夹具）；不做 G1+（真实 provider 矩阵 / packaged 签名）。

## 2. 阶段

- P1 SSE 传输（config schema/settings/manager/routes/status）。
- P2 自定义 headers（加密落盘/状态脱敏/导出剥离/导入保留/连接注入/校验）。
- P3 OAuth 本地撤销与重新授权（store/manager/route/UI）。
- P4 测试、9223 亮/暗实机、closeout、canonical 回写。

## 3. 验收门禁

`node --test test/block258-*.test.mjs` + MCP 邻域回归；前端定向（hook/shelf/theme）；`test:changed`；隔离 9223 亮/暗；closeout 十三门逐门取证。

## 4. 收口记录（2026-10-25）

| 项 | 交付 | 证据 |
| --- | --- | --- |
| P1 SSE | 配置注册表 `transport` 扩到 `stdio/http/sse`；`client-manager` 按需加载 SDK 自带 `SSEClientTransport`（`eventsource` 已是 SDK 依赖，**零新增依赖**）；授权入口对 http/sse 统一（`oauth_requires_remote`）；状态面/健康面透出 sse。 | `block258-mcp-tail.test.mjs` SSE 连接/工具调用 |
| P2 headers | 新增 `mcpServers.<item>.headers`；AES 密文落盘、读侧解密、状态面只透 `headerKeys/headerCount`、配置导出剥离、导入拒绝并**按 id 保留**；连接时同时作用于 SSE GET/POST 与 HTTP；CRLF/非法名/保留头/上限 fail-closed。 | 契约测试 + 实机 B4/B5 |
| P3 OAuth 撤销 | `oauthStore.clearCredentials`；`manager.revokeAuthorization`（断开+清 tokens/pending/verifier，默认保留 client）；`POST /api/mcp/servers/:id/oauth/revoke`；UI「断开授权 / 重新授权」；如实声明服务端令牌过期前可能仍有效。 | 契约测试 + REST 200/400/404 + 实机 A5/B1–B3 |
| P4 验收 | `block258` 契约 **6/6**；MCP 邻域合计 **34/34**；前端 shelf **15/15**；theme **17/17**；`test:changed` EXIT=0（changed=32；Node **626**＝621 pass/0 fail/5 skipped；前端 related 2 文件 21 + 定向 33 文件 241）；隔离 9223 亮/暗各 **18/18**（`acceptance/block-258/q8rem-live{,-dark}.json`；截图 unavailable）。 | 见上 |

实机断言链：B0 预置 OAuth token → A1 MCP 货架 → A2 SSE+Header 表单保存 → A3 真连接（1 工具 / Header 计数）→ A4 Header 值不出现在 DOM → A5 断开授权（notice/徽标消失/配置保留）→ A6 收尾；宿主侧 B1 tokens 清空、B2 client 保留、B3 状态非 authorized、B4 headers 密文落盘、B5 状态面不含 Header 值。

边界：本地撤销不清服务端令牌（RFC 7009 未做）；不做多账号并存/J2/J6/SSE server 端；实机夹具为 127.0.0.1 本地 SSE server。
