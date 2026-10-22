---
capability: q8-mcp-oauth
goal: 让需要 OAuth 的 HTTP MCP server 能完成授权、加密持久化凭据并在后续连接/刷新中复用；授权前工具不出现，授权后重连出现；失败可解释、凭据不出状态面。
acceptance:
  - HTTP MCP server 无 token 时连接返回 `auth_required` 且工具零投影；`POST /api/mcp/servers/:id/authenticate` 返回授权 URL；localhost callback 用 state + PKCE 完成 token 交换、重连并出现工具。
  - OAuth 凭据（client_secret / access_token / refresh_token / code_verifier）落盘密文；状态面只暴露 authorized/required，不出现 token 或 client_secret。
  - 授权后同一 server 重连复用 token（无需再次授权）；state 不匹配/过期、stdio server 调授权、未知 server 均给出可读错误且不污染状态。
  - UI 在 `auth_required` 时提供授权入口并打开系统浏览器；`authorizing` 轮询至 connected/error；HTTP server 卡片显示 url 与传输类型。
  - 测试含 mock OAuth + MCP HTTP server 的真实流程（Node 集成）与前端组件；9223 离屏 live 腿（授权→连接→工具出现）+ 亮/暗截图；closeout 十三门 PASS。
reopen: stdio OAuth（不适用）、legacy SSE OAuth、token revoke/账号切换/多账号、agent 主动调用 authenticate 工具（本轮 UI 发起，工具形态 reopen）、真实第三方 OAuth provider 矩阵（G1+ 边界）、trust 降档接审批（随 Q1）。
status: completed
---

# BLOCK-239 · Q8 深化：MCP OAuth per-server authenticate（HTTP）

> 用户裁决：2026-10-22「搞完 下一队列」= 承接 UI-547 收口，按 Q8 队列头继续（OAuth）。
> 前置：BLOCK-221 Q8 垂直切片（服务级策略 + 货架摘要）、BLOCK-163 CAP-3（streamable HTTP 传输）、UI-547（货架工具治理操作面）。

## 1. P0 实码勘察（2026-10-22，只读实测）

| 面 | 当前证据 | 结论 |
| --- | --- | --- |
| SDK OAuth 能力 | `@modelcontextprotocol/sdk@1.29.0`：`client/auth.js` 导出 `OAuthClientProvider` / `auth()`；`StreamableHTTPClientTransport` 接受 `authProvider` 并提供 `finishAuth(code)`；自带 `simpleOAuthClientProvider` 与 `demoInMemoryOAuthProvider` 示例 | **无需新依赖**；发现/注册/PKCE/换 token 由 SDK 完成 |
| 当前 HTTP 连接 | `client-manager.js:99` `new StreamableHTTPClientTransport(new URL(cfg.url))`，**未传 authProvider** | 401 只会落 `error`，无授权入口 |
| HTTP 配置 | `mcp-settings.js` 支持 `transport:'http'` + `url`；`GET /api/mcp/servers` 已透出 `transport`/`url` | 配置面已就绪；无需迁移 |
| 回调落点 | 后端 Express 已监听 `:3001`（`server.js`）；`/api/mcp/*` 无额外 auth 中间件 | 复用 `GET /api/mcp/oauth/callback/:serverId`，不另起回调进程 |
| 打开浏览器 | 渲染层 `window.open(http(s)://…)` 由主窗 `setWindowOpenHandler` 送系统浏览器（`src/main/_window-create.js:258-264`） | UI 只需 `window.open`，无新 IPC |
| 凭据加密 | `helpers/mcp-env-crypto.js` AES-256-GCM（`enc:v1:`，密钥在数据根 `keys/`），已用于 MCP env | OAuth token/verifier 复用同一加密原语，落盘零明文 |
| 现有 OAuth 代码 | `grep -rn "OAuthClientProvider\|finishAuth\|authorize" core/petri-server` 零命中 | 完全空白，无第二套 auth 词汇 |
| 测试夹具 | `test/block163-mcp-http-transport.test.mjs` 有零依赖 HTTP JSON-RPC 夹具；SDK examples 提供 demo auth provider + stateless streamable HTTP server | 可组装 mock OAuth + MCP server，真实走 HTTP |
| 状态面 | `getStatuses()` 只透出 envKeys/envCount/toolCount；无 auth 状态 | 需增 `auth: authorized/required/unknown`，仍不出 token |

**P0 结论**：本轮做 **HTTP MCP server 的 OAuth 授权码流程**（用户发起、SDK 发现/注册/PKCE、localhost 回调、密文持久化、重连）。stdio 与 legacy SSE 不在范围；token revoke/多账号/真实 provider 矩阵属 reopen。

## 2. 范围与阶段

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| **P1 存储与 provider** | `helpers/mcp-oauth-store.js`（逐 server：clientInformation/tokens/codeVerifier/pending state/redirectBase；密文字段用 `mcp-env-crypto`；坏 JSON fail-closed）+ `mcp/oauth-provider.js`（`OAuthClientProvider` 实现） | 存储单测：密文落盘、无明文、坏 store 降级、pending 过期 |
| **P2 状态机与路由** | HTTP 连接按是否有 token 决定是否挂 authProvider；`auth_required`/`authorizing` 状态；`beginAuthorization(id, redirectBase)` 捕获授权 URL；`completeAuthorization(id, code, state)` 校验 state 后换 token 并重连；`POST /api/mcp/servers/:id/authenticate` + `GET /api/mcp/oauth/callback/:serverId` | Node 集成：401→auth_required→授权 URL→callback→connected；state 错/stdio/未知 server 可读错误 |
| **P3 UI** | 状态徽标 `auth_required`/`authorizing`；卡片显示 `transport`/`url`；授权按钮 → `window.open`；轮询直至 connected/error；失败原因可见 | 组件测试：授权按钮、URL 打开、轮询、错误态 |
| **P4 测试与实机** | mock OAuth + MCP server 夹具；Node 集成 + 前端组件；9223 离屏 live（授权→连接→工具出现）+ 亮/暗截图 | 定向测试全绿；live 断言全过 |
| **P5 收口** | UI-548 台账 + canonical 回写 + closeout 十三门 + output:judge | 十三门 PASS；提交；推送另等发令 |

**批内纪律**：①OAuth token 永不出状态面/日志；②状态机错误一律可读（`authorization_required`/`authorization_state_invalid`/`authorization_exchange_failed`）；③不在 `connectServer` 自动生成授权 URL（避免启动时为所有未授权 server 造 pending 状态）；④新增 acceptance 目录同批登记 impact-map；⑤每阶段跑 `quality:types`。

## 3. 非范围（reopen）

- stdio OAuth（不适用）、legacy SSE 传输 OAuth。
- token revoke / 账号切换 / 多账号 / 凭据轮换 UI。
- **agent 主动调用 authenticate 工具**：本轮由用户点击授权入口发起，避免模型触发外部浏览器；工具形态 reopen。
- 真实第三方 OAuth provider 矩阵（G1+ 边界）；本轮用本地 mock auth server 取证。
- trust 降档接审批（随 Q1）；OAuth 成功不等于自动信任/自动批准工具。

## 4. 验收门禁

1. **红绿先行**：先落 mock OAuth + MCP server 集成测试（无 token → auth_required → 授权 URL → callback → connected + 工具出现；密文断言），确认红后再实现。
2. Node：block239 集成测试 + MCP 邻域（client-manager/projection/settings/policy）+ HTTP transport 回归。
3. 前端：McpShelfPane 授权按钮/状态/错误 + 邻域。
4. `quality:types` 0、theme 17/17、lint/knip/closeout 十三门。
5. 9223 离屏 live：配置 mock HTTP MCP server → 点授权 → 模拟浏览器完成 → connected + 工具出现 + 亮/暗截图。
6. `output:judge` 收口声明前跑。

## 5. 完成语义

- `completed` = OAuth 授权码流程贯通 + 密文持久化 + UI 入口 + 集成/组件测试 + 9223 live + UI-548 台账 + closeout 十三门 + canonical 回写。
- 若 live 受环境阻塞，README/台账如实记 `in_progress` 与阻塞点，不冒充 verified；本轮优先完成 Node 集成与 UI 组件证据。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口（2026-10-22）

**结论：BLOCK-239 completed；UI-548 verified（dev Electron 边界内；9223 离屏 live 11/11）。**

### 6.1 交付

- **密文 store**：`helpers/mcp-oauth-store.js`——逐 server 保存 clientInformation/tokens/codeVerifier/pending；token/refresh_token/client_secret/verifier 全部经 `mcp-env-crypto`（AES-256-GCM）加密；坏文件/pending 过期 fail-closed。
- **Provider**：`mcp/oauth-provider.js` 实现 SDK `OAuthClientProvider`；redirect URL = 本机 `/api/mcp/oauth/callback/:serverId`；动态注册/PKCE/换 token/刷新交给 SDK。
- **状态机**：`client-manager` 新增 `auth_required`/`authorizing`；`beginAuthorization` 捕获授权 URL；`completeAuthorization` 校验 state 后 `finishAuth` + 重连；有 token 才挂 provider，避免自动连接生成 pending。
- **REST**：`POST /api/mcp/servers/:id/authenticate` + `GET /api/mcp/oauth/callback/:serverId`；stdio 400、未知 404、state 错 400；DELETE server 同步清 OAuth 条目。
- **UI**：添加表单支持 stdio/HTTP + URL；HTTP 卡片显示 url/传输；`auth_required` 显示授权按钮并 `window.open`；`authorizing` 轮询；`authorized` 徽标；失败原因与兜底授权链接可见。
- **测试夹具**：`test/fixtures/mcp-oauth-server.mjs` 复用 SDK demo auth provider + stateless streamable HTTP，真实 Bearer 保护；`test/block239-mcp-oauth.test.mjs` 6/6。

### 6.2 验证

- Node 集成 **6/6**（auth_required/授权 URL/callback/connected/工具出现/密文/重连复用/state 错/stdio/未知/REST transport 保真）；MCP 邻域 **26/26**。
- 前端 **17/17**；theme 17/17；`quality:types` 0。
- 9223 离屏 live **11/11**（`acceptance/ui-548/` 亮/暗截图）；`npm run closeout` 十三门 PASS；`output:judge` PASS。

### 6.3 实机抓真

- REST `POST /api/mcp/servers` 未透传 `transport/url` → HTTP 被静默降级 stdio；已修路由并补回归断言。
- `getStatuses` 未连接时拿会话默认 transport → HTTP 卡片误显示 stdio；已改为按配置传输显示。

### 6.4 边界（reopen）

- stdio/legacy SSE OAuth、token revoke/账号切换/多账号、agent 主动 authenticate 工具、真实第三方 provider 矩阵（G1+）、trust 接审批（随 Q1）。
- OAuth 成功只代表可连接/可投影，不代表自动信任或自动批准工具。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
