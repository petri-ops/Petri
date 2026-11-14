# BLOCK-447 · MCP App 页面自动渲染与双向 RPC

> 承接 BLOCK-445（通用 Agent 插件/技能兼容层）的 §5 未覆盖项：宿主链路已通，
> 但工具结果里的 `_meta.ui.resourceUri` 没有接到前端，页面不会自动出现。
> 本包把「能渲染」变成「自动出现在对话里 + 页面可调工具」。

## 1. 链路（逐环真实代码）

```
外部 MCP server 的 tools/call 结果带 _meta.ui.resourceUri
  → core/petri-server/agent-tools/mcp-projection.js 保真透传 ui={serverId,uri}
  → agent 事件 tool_result → 前端 parseToolResultEvent（展开 toolResult）
  → toolActivity.parseMcpAppFromResult 提取 mcpApp
  → ToolActivityList 在活动行后自动挂 <McpAppCard>
  → preload genUi.prepareMcpApp → 主进程 gen-ui:prepare-mcp-app
      → 后端 POST /api/mcp/servers/:id/resource 取 HTML
      → createGenUiSession（petri-genui://gen-<id>）→ 沙箱 iframe 渲染
  → 页面 window.petri.mcpApp.callTool(name,args)
      → guest-bridge postRpc('petri/mcp-app/call-tool')
      → McpAppCard 校验 event.source + origin 后桥接
      → preload genUi.callMcpAppTool → 主进程 gen-ui:mcp-app-call
      → session 归属校验（ownerWebContentsId + scopeKey 绑定 serverId）
      → 后端 POST /api/mcp/servers/:id/tools/call
```

## 2. 安全边界

- **serverId 只从 session 绑定取**（`scopeKey='mcp-app:<serverId>'`），绝不信任渲染层传参；
- 子页 RPC 必须 `event.source === iframe.contentWindow` 且 `event.origin === petri-genui://<sessionId>`；
- 会话须 `ownerWebContentsId === event.sender.id`，伪造 session 返回 `session_not_found`；
- iframe 沿用 `sandbox="allow-scripts allow-same-origin"` + gen-ui CSP + 现有劫持侦测；
- 页面 follow-up 绑定缺席时明确拒绝（read-only），不静默丢弃。

## 3. 当次实测

| 层 | 读数 |
| --- | --- |
| 前端组件 | `McpAppCard.test.tsx` 4/4（prepare/iframe/错误态/RPC 中继/伪造 origin 拒绝）、`toolActivity.mcpApp.test.ts` 2/2 |
| 源码契约 | `test/block446-mcp-app-wiring.test.mjs` 5/5 |
| 后端 | mock MCP server 的 `tools/call` 返回 `_meta.ui.resourceUri`；`POST /api/mcp/servers/:id/tools/call` 200 且结果保真 |
| 离屏 Electron | `prepareMcpApp` → `petri-genui://gen-…/index.html`；`callMcpAppTool` 返回 `ok:true` + `PONG` + `_meta.ui`；伪造 session `gen-forged-session` → `session_not_found` |
| 用户数据 | 验证用的 MCP server 已删除、`mcp-servers.json` 从备份恢复；端口全空 |

## 4. 仍未覆盖（精确原因）

| 项 | 原因 | 补腿 |
| --- | --- | --- |
| `@modelcontextprotocol/ext-apps` 原生 SDK 协议 | Petri 桥 API 是 `window.petri.mcpApp`，与 ext-apps 的 `ui/initialize`、`tools/call` JSON-RPC 形状不同 | 写 host 侧协议 shim（把 ext-apps 消息翻译成 `petri-gen-ui-rpc`） |
| 完整 agent→卡片链路实机 | 需把 mock MCP 工具投影进 agent 工具面并让真实任务命中 | 独立实机腿（mock server + MCP 策略 + agent 任务 + 页面可见） |
| `updateModelContext` 独立方法 | 当前复用 `sendFollowUpMessage`（`onFollowUp`），未实现 ext-apps 的上下文更新语义 | 宿主侧新增上下文注入回调 |
| ext-apps 页面资源订阅 / widgetState 持久化 | Petri 已有 `petri/gen-ui/state`（内存版 ≤16KiB），语义不完全等同 | 按 MCP Apps 规范逐项对齐 |

## 5. 治理

新增 IPC 通道 → surface-matrix / capability-map / surface-schema 基线连锁刷新；阈值与容差零改动。
证据：`acceptance/m-blueprint-2026-11-11/m6a/mcp-app-auto-render.json`。
G0 开发期常态 · 不外推 packaged/Provider/GA。
