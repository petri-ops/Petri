# BLOCK-511 · S4 端口与首屏证据（2026-11-24）

## HK-01 红→绿

| 子项 | 修复前红 | 修复后绿 | 关键断言 |
|---|---|---|---|
| 4.1 CSP 端口 | `block511-csp-port` 1/4（写死 3001/3000、打包态可走 dev CSP） | 4/4 + next05-csp/block405 共 19/19 | 非 3001 后端端口时 connect/frame-src 含实际端口不含 3001；渲染 Origin 动态；打包态 NODE_ENV=development 仍生产 CSP；未打包 dev 保留 unsafe-inline |
| 4.2 首屏懒加载 | `block511-first-paint-lazy` 1/2（静态 import + 无 lazy/Suspense） | 2/2 + 前端 28/28 | App.tsx 静态链到不了 three/@xyflow；两组件 lazy + Suspense 合约 |

## 改动摘要

- `src/main/csp-config.js`：`buildCspHeader(isDevMode, { backendPort, rendererOrigin, isPackaged })` 按实际端口/Origin 生成；dev CSP 仅 `!isPackaged && isDevMode`；img/connect/frame-src 动态端口；删除写死端口常量。`src/main.js:796` 传 `backendPorts.r` / `rendererDevUrl` / `app.isPackaged`（行数保持 920）。
- `ChatArtifactCard.tsx`：Model3DScene 改 React.lazy + Suspense 空占位（零观感变化）；`ToolActivityDock.tsx`：OrchestrationGraph 改 lazy + Suspense 空占位。

## 构建与实机证据

- `npm run build:spa` EXIT=0；`frontend/dist/assets/Model3DScene-*.js`（907KB，含 three）与 `OrchestrationGraph-*.js` 独立 chunk；首屏 index chunk（659KB）不含 three。
- dev-verify flow `block511-s4-firstpaint-live` **10/10 allPass**（证据 `live/block511-s4-firstpaint-live-darwin.json` + `live/s4-firstpaint.png`）：
  - CDP targets listed / SPA page target / main page selected；
  - `document_rendered`（readyState=complete，textLen=16732，title=Petri，origin=localhost:3000）；
  - `composer_present`；`zero_csp_violations` 与 `zero_csp_violations_after_stream`（securitypolicyviolation 监听零事件）；
  - `message_typed` + `chat_message_visible`（聊天 SSE 流消息可见）；
  - `artifact_3d_checked`：**本会话未出现 3D artifact 卡**（expand3d=false，如实标 not_present，不伪造）；`screenshot` 离屏捕获成功。
- 9223 离屏实例跑完即 kill（pid 24283）。

## 遗留/诚实边界

- 3D 产物卡「可展开」单项本会话无 artifact 可验；由构建独立 chunk + 单测 lazy/Suspense 契约背书，实机标 not_present 不伪造通过。

## 出口门禁

- block511-csp-port 4/4 + block511-first-paint-lazy 2/2 + 前端 28/28 + tsc 0；docs/ui/hygiene/secret/arch/lint(0 error)/knip(留因 408 键)/code-size/arch-cycles/css-modules 全绿；gate:tracked-consistency 提交后绿。
