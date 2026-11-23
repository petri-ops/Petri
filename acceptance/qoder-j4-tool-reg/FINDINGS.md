# QODER-J4 工具注册（2026-11-23，completed）

## 用户发令与裁决

「开始 J4 工具注册」：把 P1 核心 `mcp-agent-auth-request.js` 注册为真实 agent 工具 `mcp_authenticate`（schema + handler 委托既有 OAuth 发起链 + metadata + registry 三方互查 + 工具数 119→120）。D1/D2 沿用上批默认（needsApproval=true、不碰 token）。

## 交付

- **schema** `core/petri-server/agent-tools/tool-defs/mcp.js`（`mcp_authenticate`，参数 serverId/可选 redirectBase，描述明示"不回传 URL、需批准"），汇编入 `tool-defs.js` 的 mcp 域。
- **handler** `core/petri-server/agent-tools/mcp-auth-tools.js`：工厂注入 manager/settings（可测），P1 `validateAuthRequest` 校验（stdio/未配置/非法 redirectBase 一律拒且不触发 beginAuthorization）→ 委托既有 `mcp/client-manager.beginAuthorization` → P1 `publicAuthOutcome` 投影（只回 serverId/status，authorizationUrl/token 绝不进工具结果）。默认 redirectBase=loopback。
- **registry/metadata**：HANDLERS + CONTRACTS（`action`/`state-write`/R2/`local.process`）+ `tool-metadata.js`（needsApproval=true/medium）+ 工具数 118→119→**120**（两处断言同步）。
- **零新依赖**；不改 `mcp-oauth-store.js` 加密链、不改 `routes/mcp-client.js` OAuth handler，只委托。

## 验证

- HK-01 `test/qoder-j4-tool-registration.test.mjs` 红4→绿5（四处齐备/委托+P1投影/非法请求不触发 OAuth/工具数120/红线）。
- `agent-tool-registry` 三方互查（schema/handler/contract 一致）+ `block109-p2-tool-metadata` 门禁 → 本组 20/20。
- 累计 Node 定向 **25/25**（含上批 P1 核心）；docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 诚实边界：工具只"发起" OAuth，不完成授权、不回传授权 URL、不读写 token——完成链仍走既有浏览器回调；本包未新增前端面板（工具由模型/UI 显式调用）。

## 完成语义

J4 从 P1 core → 完整工具注册 completed。integrated 层（前端一键面板若有）留可选增量。

G0 开发期常态 · 不外推 packaged/Provider/GA。
