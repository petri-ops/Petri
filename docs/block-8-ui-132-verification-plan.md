# BLOCK-8-UI-132-VERIFICATION 工作包（UI-132 既有 in_progress 静态收口）

**最后更新**：2026-08-16 22:30
**状态**：`active`（2026-08-16 22:20 用户裁决"接下来要做什么呢" + 选项 "BLOCK-8 UI-132 dev CSP 静态化（推荐）"启动）
**Plan ID**：`BLOCK-8-UI-132-VERIFICATION`

---

## 1. 决策与定位

按用户裁决"BLOCK-8 UI-132 dev CSP 静态化"启动 BLOCK-8，目标收口 UI-132 (行 239 in_progress) `in_progress` 状态。

**PHASE 0 摸底发现 — entry 描述与实际代码不一致**：
- entry 描述：`src/main.js setupCsp` dev-CSP `connect-src` / `frame-src` 改为本地网络分支变量，dev 模式放开 `127.0.0.1:*` 和 `ws://127.0.0.1:*`（生产仍只允许 `localhost:*`）；同时 `frontend/src/styles/custom.css` 在日间/夜间两套主题里补齐 `--petri-warning: var(--petri-status-warning)`
- 实际代码：
  - `src/main.js` L507-509 用 `127.0.0.1` 注入 3 个 URL（r/py/gateway）— commit `3240a09 fix(desktop): Inject R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL for gateway (P1-CFG-1)`
  - `src/main.js` L1418-1422 CSP dev mode 已放开 `http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*` — 配套 commit `3240a09`
  - `src/main.js` L1443 CSP dev mode 日志 "127.0.0.1:* whitelisted"
  - `frontend/src/styles/custom.css` L71 明色主题 `--petri-warning: var(--petri-status-warning)` — commit `f3b5c42 refactor(css): migrate all CSS token references from --ifm-* to --petri-*` + commit `3000a06 feat(frontend): Workspace UI plumbing — icons, panels, layout, styles`
  - `frontend/src/styles/custom.css` L181 暗色主题 `--petri-warning: var(--petri-status-warning)` — 同 commit

**结论**：UI-132 (行 239 in_progress) entry 描述的两个改动的**目标都已 100% 落地**，但 **entry 没同步状态**——audit ledger 与实际代码漂移。**PHASE 0 摸底盲点 = BLOCK-7 PHASE 0 UI-161 同类盲点（UI-161 实际已 5/5 PASS 但 entry 仍 in_progress）**。

**路径选择**：沿用 BLOCK-7 Vite-only + 静态 grep 综合验证路径（用户裁决 + UI-132 不依赖 IPC 桥 + UI-132 改动是纯代码静态层）。

**BLOCK-7 vs BLOCK-8 平行性**：
- BLOCK-7 收口 UI-161（in_progress → verified，6 项 grep + Vite 产物 grep）
- BLOCK-8 收口 UI-132（in_progress → verified，4 项 grep + Vite 产物 grep）
- 两条都从 entry `in_progress` 字样 + 实际代码已落地出发，路径完全相同

---

## 2. UI-132 4 项静态验证

| # | 项 | 文件 | 验证点 |
|---|---|---|---|
| 1 | main.js setupCsp dev mode 放开 `http://127.0.0.1:*` + `ws://127.0.0.1:*` | `src/main.js` L1418-1422 + L1443 | grep `isDevMode` + `127.0.0.1:\*` + `ws://127.0.0.1:\*` + `CSP dev mode ... 127.0.0.1:\* whitelisted` |
| 2 | main.js R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL 用 `127.0.0.1` 注入 | `src/main.js` L507-509 | grep `process.env.R_SERVER_URL.*127.0.0.1` + `process.env.PY_SERVER_URL.*127.0.0.1` + `process.env.GATEWAY_URL.*127.0.0.1` |
| 3 | styles/custom.css `--petri-warning` token 明色主题 | `frontend/src/styles/custom.css` L71 | grep `--petri-warning: var(--petri-status-warning)` |
| 4 | styles/custom.css `--petri-warning` token 暗色主题 | `frontend/src/styles/custom.css` L181 | grep `--petri-warning: var(--petri-status-warning)` (在 `:root[data-theme="dark"]` / `[data-theme="dark"]` 块内) |

PHASE 1 通过 grep 综合验证 4 项，确认 commit `3240a09`（CSP dev 放开）/ `3000a06`（Workspace UI plumbing）+ `f3b5c42`（CSS token 迁移）以来**未被任何后续 commit 回退**。

---

## 3. PHASE 划分

### PHASE 1：静态 grep 综合验证 4 项

- 1.1 grep main.js L1418-1422 dev mode 放开 `127.0.0.1:*` + `ws://127.0.0.1:*`
- 1.2 grep main.js L1443 CSP dev mode 日志 "127.0.0.1:* whitelisted"
- 1.3 grep main.js L507-509 R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL 注入 `127.0.0.1`
- 1.4 grep styles/custom.css L71 明色主题 `--petri-warning`
- 1.5 grep styles/custom.css L181 暗色主题 `--petri-warning`
- 1.6 git log 退化检查（`3240a09..HEAD -- src/main.js` 检查不引入 `127.0.0.1` 删除；`f3b5c42..HEAD -- frontend/src/styles/custom.css` 检查不删除 `--petri-warning`）
- 1.7 tsc --noEmit + vitest run 全量核验（保留绿色）

### PHASE 2：Vite build + 产物 grep

- 2.1 vite build 产出 frontend/dist/（如未产出则跑 `cd frontend && npm run build`）
- 2.2 grep 产物 CSS 中 `--petri-warning` 已定义
- 2.3 grep 产物 JS 不含 main.js CSP 内容（CSP 在 main 进程，渲染产物不直接含）
- 2.4 grep 产物 CSS 含 `--petri-status-warning` 引用链完整

### PHASE 3：theme-token-contract test + 治理门

- 3.1 `cd frontend && npx vitest run src/styles/theme-token-contract.test.ts`
- 3.2 tsc --noEmit 0
- 3.3 `npm run docs:check` + `npm run ui:audit:check` + `npm run docs:reconcile`

### PHASE 4：audit + closeout

- 4.1 更新 `docs/ui-productization-audit.md` UI-132 (行 239 in_progress) 状态：`in_progress → verified`
- 4.2 entry 末尾追加 BLOCK-8 验证说明
- 4.3 写 `docs/block-8-ui-132-verification-closeout.md` 报告（11 节）
- 4.4 4 canonical 文档同步
- 4.5 DOC-REGISTRY `active → completed` + 新增 CLOSEOUT reference entry
- 4.6 AUDIT-LOG 登记

---

## 4. 验收门禁

| # | 命令 | 必跑 |
|---|---|---|
| 1 | `npm run docs:check` | ✅ PHASE 4 commit 前 |
| 2 | `npm run ui:audit:check` | ✅ PHASE 1 + PHASE 4 |
| 3 | `cd frontend && npx tsc --noEmit` | ✅ PHASE 1 + PHASE 4 |
| 4 | `npm run docs:reconcile` | ✅ PHASE 4 commit 前 |
| 5 | `cd frontend && npm run build && grep产物` | ✅ PHASE 2 |
| 6 | 静态 grep 4 项 | ✅ PHASE 1 |
| 7 | `git log` 退化检查 | ✅ PHASE 1 |

---

## 5. 完成语义

- **UI-132 (行 239 in_progress) → verified**
- 4 治理门 GREEN
- **不变量守住**：UI-157 / UI-158 / UI-159 / UI-156 / UI-AGENTWB-001/002 仍 in_progress / UI-161 已 verified（BLOCK-7）/ UI-039 / UI-132 (行 87 verified) / preload.js 0 diff / electron.d.ts 0 diff / desktopBridge.ts 0 diff / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff

---

## 6. 不外推

- 不外推 packaged / dist / notarization / Provider / P7 / GA
- 不外推 E1-d/E1-e G1+ 架构改动
- 不外推 release-pipeline dist staleness（G1+ 红线）
- 不外推 i18n 资源抽离
- 不重新激活 BLOCK-2/BLOCK-3/BLOCK-4/BLOCK-5/BLOCK-6/BLOCK-7（已 completed/superseded）
- 不动 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/

---

## 7. 下一块候选（须经用户显式裁决启动新工作包）

按 single work package serial 纪律，本工作包收口后 **不主动启动**新工作包。剩余 3 候选：

| 候选 | 来源 | 工具边界 | 备注 |
|---|---|---|---|
| **BLOCK-8.1** UI-132 dev Electron 实机（可选）| BLOCK-8 | 受工具边界限制（同 BLOCK-6）| 非 verified 必要条件 |
| **UI-156 / UI-157 / UI-158 / UI-159 / UI-AGENTWB-001/002 实机收口** | audit 表 | 受工具边界限制 | 同 BLOCK-6 |
| **BLOCK-9 / BLOCK-10** | 用户说"暂时不提"| G1+ 红线 | 同 BLOCK-7 closeout 末尾 |

**当前无 active 工作包**（BLOCK-8 收口后）。
