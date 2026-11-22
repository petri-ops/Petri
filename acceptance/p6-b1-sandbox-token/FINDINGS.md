# P6-TABLE-LOAD B1 sandbox token 执行与实证（2026-11-22）

## 裁决与改动

用户裁决「按 B1 在 sandbox 增 `allow-top-navigation-to-custom-protocols`」。改动：
- `frontend/src/components/work-surface/PackSurfaceFrame.tsx`：导出 `PACK_SURFACE_SANDBOX = 'allow-scripts allow-same-origin allow-top-navigation-to-custom-protocols'`，iframe `sandbox={PACK_SURFACE_SANDBOX}`。**仅加 B1 点名 token**，未动 `allow-top-navigation` / `allow-popups` 等宽边界、未动 CSP / 凭据。
- HK-01 红绿先行：`PackSurfaceFrame.test.ts` 新增契约测（断言 B1 token 在场 + 更宽 token 不在场）→ 红 `1 failed/3 passed`（常量未导出）→ 实现后绿 `4 passed`。

## 决策性 A/B 证据：B1 消除了 sandbox 导航拦截

同一压测 driver、同一 frontend 源码，B1 前后各采 rendererConsole：

| 样本 | console 条数 | `blocked by sandbox` 报错 |
|---|---|---|
| B1 前（`driver-result-B1-before.json`，OOP 深探小票） | 3 | **1**（`Navigation to external protocol blocked by sandbox... doesn't contain allow-top-navigation-to-custom-protocols`） |
| B1 后 第 1 轮（`...round1.json`） | 2 | **0** |
| B1 后 第 2 轮（`...round2.json`） | 2 | **0** |

结论：**B1 token 精确解除了 Chromium 导航层的 sandbox 拦截**——报错点名的 token 加上后，该报错消失。这与裁决材料/OOP 深探的根因归因完全一致，B1 产品改动正确且必要。

## 卡点：压测 table_load 全链仍未通过——driver harness 缺 pack protocol handler（新裁决点）

两轮 B1 后压测 `failedStage` 仍为 `table_load`，DOM 仍停「正在加载 bio-result」，iframe target 仍 0。逐轮判据：

- 第 1 轮（WAIT 120s）：sandbox 报错 0，watchdog 落证（主流程挂起）。
- 第 2 轮（WAIT 180s + watchdog DOM 诊断增强）：sandbox 报错 0，DOM 读数补齐——`canvasPresent=true`、`packIframes=[{src:petri-pack://petri-pack-bio/ui/result.html, visible:true, width:720}]`、`tableViewportPresent=false`、`oop.verdict=oop_no_iframe_target`。

**根因（静态代码铁证，非推测）**：压测 driver（`scripts/g0-rs-p6-electron-pressure-driver.cjs`）是隔离观察器，全文件**无 `protocol.handle` / `registerPackSchemePrivileges` / `setupPackProtocol`**——它只加载 http backend 页面（`window.loadURL(targetUrl(...))`），从未注册 `petri-pack://` 协议处理器。真正的协议 handler 在主进程 `src/main/pack-ui/scheme.js`（`protocol.handle` + `registerSchemesAsPrivileged`），产品主窗 P3 已 verified 工作过。

这解释了分层拦截：
- B1 前：sandbox 层在导航建立前就拒绝自定义协议 → 报 `blocked by sandbox`；
- B1 后：跨过 sandbox 层，但 driver 进程无 `petri-pack://` handler → 导航仍失败（iframe target 不建立，主 frame console 看不到独立 iframe 进程的导航错误），表仍停 loading。

**这是预存在的 harness 缺口，不是 B1 改动引入，也不在本次 B1 裁决范围**。P6 压测 table_load 用隔离 driver 测表格性能，从未服务 pack iframe 真实渲染；该缺口在 B1 之前就使 table_load 无法全链通过（历轮均 blocked）。

## 结论

- **B1 产品修复：完成且实证有效**（sandbox 导航拦截报错 1→0）。HK-01 红3→绿（新增契约 1 条）、邻域测试绿、lint/types 绿。
- **P6 压测 table_load 全链：未通过**，卡在 driver harness 缺 pack protocol handler（非产品代码问题）。按 ≤3 轮纪律跑了 2 轮一致 + 静态铁证，不再追加盲跑。
- **新裁决点（停下报用户，未擅改）**：是否给压测 driver 补 pack protocol handler（测试基础设施扩建，可使 table_load 全链真验证）——超出「仅限 B1 token」红线，待用户发令。补法方向：driver 复用主进程 `setupPackProtocol`（`src/main/pack-ui/scheme.js`）+ 在 app ready 前 `registerPackSchemePrivileges`，或改用带完整主进程的 dev Electron 栈跑该腿。

## 门禁

- HK-01：红 `1 failed/3 passed` → 绿 `4 passed`（`hk01-red.txt` / `hk01-green.txt`）。
- 邻域 Node 定向：`test/p6-driver-iframe-probe` + `block216-pack-contributions` + `live-window-policy` + `p6-pack-scheme-privileges` = `18/18`。
- `quality:types` 0 红；`quality:lint` 0 error（清理了上票遗留的未用函数 `installHostMessageTap` → `_installHostMessageTap`）。
- 压测 A/B 原始读数：`driver-result-B1-before/round1/round2.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测，无 GUI 截图面）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
