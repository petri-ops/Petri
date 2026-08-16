# BLOCK-6 UI-158 + UI-159 实机复核工作包

**最后更新**：2026-08-16
**状态**：`superseded`（2026-08-16 21:35 用户裁决"关闭 BLOCK-6 保留 in_progress"——工具边界受限：playwright MCP / WebFetch 跑在隔离 sandbox 不能访问 localhost，macOS shell 退出杀 child process；主 agent 无法独立完成 dev Electron 实机；UI-158 / UI-159 状态保持 in_progress 不升级；plan 保留为 future reference）
**Plan ID**：`BLOCK-6-UI-158-UI-159-VERIFICATION`

---

## 1. 决策与定位

按用户裁决"可以继续" + 选择 "BLOCK-6 UI-158/UI-159 dev Electron 实机（推荐）" 选项，**重新启用 dev Electron 实机**（推翻 P1-T-A「跳过实机、走 Vite mock 验收路径」决策）。

UI-158 / UI-159 是 `docs/ui-productization-audit.md` 行 114-115 两条历史 commit 补登的 `in_progress` 项：

- **UI-158**（commit `446bfa8` feat(copilot)）：Copilot UX 增强 — `CommandPalette.tsx` + `errorMessages.ts` + `useErrorFormatter.ts`（均在 `frontend/src/components/copilot/`）+ `docs/architecture/gateway-design.md`
- **UI-159**（commit `3000a06` feat(frontend)）：Workspace UI plumbing — `App.tsx` + `BackendStatusProvider.tsx` + `conversationRunStore.ts` + `LeftPanel.tsx` + `project-workspace.tsx` + `Icon.tsx` + `simple-chat.css` + `desktop.css` + `custom.css` + `electron.d.ts`

按 audit 行 402 治理纪律："仅当真实 dev Electron 实机过目后才可考虑 `verified`"。

---

## 2. PHASE 划分

### PHASE 1：环境准备 + 启动 dev Electron + CDP attach

- 1.1 启动 dev Electron：`npm run dev:electron`（用户启动，主 agent 监控）
- 1.2 通过 playwright MCP `plugin-playwright-playwright` `browser_navigate` 连接到 dev Electron（Vite 默认 :3000 + Electron 启动后 BrowserWindow 加载）
- 1.3 抓首屏截图 + console.log

### PHASE 2：UI-158 CommandPalette 实机验证

- 2.1 触发 CommandPalette（默认快捷键 `Cmd+K` / `Ctrl+K`）
- 2.2 验证 fuzzy 搜索 + 快捷键注册 + 面板开关状态机
- 2.3 抓 3 张截图（关闭 / 打开 / 搜索中）

### PHASE 3：UI-159 Workspace UI plumbing 实机验证

- 3.1 验证 App.tsx Skills 路由接入
- 3.2 验证 BackendStatusProvider 后端状态显示
- 3.3 验证 LeftPanel 工作台侧栏
- 3.4 抓 3 张截图（首页 / Skills 页面 / Workspace 页面）

### PHASE 4：evidence 收集 + 收口

- 4.1 收集所有截图 + console.log + 验证结果
- 4.2 更新 `docs/ui-productization-audit.md` UI-158 / UI-159 状态：`in_progress → verified`（**仅当全部 test 通过**）
- 4.3 写 `agent-transcripts/phase-9-block6-ui-158-ui-159-verification.md` 报告
- 4.4 closeout 报告 `docs/block-6-ui-158-ui-159-verification-closeout.md`

---

## 3. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ PHASE 4 commit 前 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PHASE 4 commit 前 |
| 4 | `npm run docs:reconcile` | ✅ PHASE 4 commit 前 |
| 5 | dev Electron 启动 + 截图 + console.log | ✅ PHASE 1-3 |

---

## 4. 完成语义

- **UI-158 + UI-159 `in_progress → verified`**（仅当实机 evidence 充分）
- 4 治理门 GREEN
- **不变量守住**：UI-161 5/5 / desktopBridge.ts 0 diff / electron.d.ts 0 diff / preload.js 5 方法签名不变 / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff

---

## 5. 不外推

- 不外推 packaged / dist / notarization / Provider / P7 / GA
- 不外推 E1-d/E1-e G1+ 架构改动（留 BLOCK-10）
- 不外推 release-pipeline dist staleness（留 BLOCK-8 / G1+ 红线）
- 不外推 i18n 资源抽离（留 BLOCK-9）
- 不重新激活 BLOCK-2/BLOCK-3/BLOCK-4/BLOCK-5（均已 `completed`）
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/（UI-159 涉及 electron.d.ts 是 ADDITIVE 扩展，不在本工作包范围内）



---

## 7. 取消原因（2026-08-16 21:35 用户裁决）

**用户裁决**：关闭 BLOCK-6 保留 in_progress。

**工具边界**：
- playwright MCP `plugin-playwright-playwright` 运行在隔离 sandbox（实测 `browser_navigate http://localhost:3100/` 返 `ERR_CONNECTION_REFUSED`）
- WebFetch 隔离 server 声明 "Cannot fetch from localhost (localhost:3100)"
- macOS shell 退出时 child process 会被一同杀死（实测 Vite 后台跑 30s 内 alive，shell 退出后 vite 死）

**结论**：主 agent 无法独立完成 dev Electron 实机核查——dev Electron 启动 + 截图需用户手动操作 app 后提供截图 / console.log。

**保留 plan 为 future reference**：
- UI-158 / UI-159 状态保持 `in_progress` 字样不变（按 audit 行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 verified"）
- 未来用户启动 dev Electron 实机并提供截图 / console.log 后，可重新启动 BLOCK-6.1（实际 dev Electron 实机）——结构、6 截图、验证 checklist 均已规划
---

## 6. 下一块候选

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余 4 候选：
- **BLOCK-7**：UI-161 既有 in_progress 实机
- **BLOCK-8**：release-pipeline dist staleness（G1+ 红线，需用户显式裁决）
- **BLOCK-9**：Windows 代码签名 / i18n 资源抽离
- **BLOCK-10**：E1-d/E1-e G1+ 架构改动
