# P6 harness 补 pack protocol handler（2026-11-22）

## 改动（仅 harness，不碰产品）

用户发令「开始 P6 harness 补 pack handler」。改动只在压测 driver `scripts/g0-rs-p6-electron-pressure-driver.cjs`：
- require 产品主进程 `src/main/pack-ui/scheme.js` 的 `registerPackSchemePrivileges` + `setupPackProtocol`（**复用单源，不自造第二份 handler**）；
- `app.whenReady()` 前调 `registerPackSchemePrivileges()`（Electron 硬约束；Privileges 含裁决 A 的 `supportFetchAPI/corsEnabled`，与产品主窗同形）；
- `run()` 内（ready 后）调 `setupPackProtocol()` 注册 `protocol.handle('petri-pack', …)`。

**红线遵守**：未改产品 `scheme.js`（handler/CSP/privileges 原样）、未改 sandbox/B1 token、未改凭据。产品 scheme.js 保持只读 handler 单源。

## HK-01 红绿先行

新契约 `test/p6-driver-pack-handler.test.mjs`（4 条，纯源码不跑 Electron）：driver 复用产品 scheme 单源 / privileges 在 ready 前 / handler 在 run() 内 ready 后 / 产品 scheme.js 未被改写。
- 红：`3 fail / 1 pass`（driver 未加载 scheme 模块）。
- 绿：`4 pass`（`hk01-red.txt` / `hk01-green.txt`）。

## 决策性 A/B 证据：handler 缺口已补上

同一 frontend、同一 sandbox B1 token，补 handler 前后各采压测 OOP 探针：

| 读数 | 补 handler 前（`driver-result-before-handler.json`） | 补 handler 后（round1 / round2） |
|---|---|---|
| iframe target 数 | **0** | **1 / 1** |
| 执行上下文可读 | 0 | 1 / 1 |
| OOP verdict | `oop_no_iframe_target` | `oop_document_present_ready_missing` |
| result.html 加载 | 无 frame | `readyState=complete`、`documentTitle=生信主结果`、`htmlLength=30466`、`loadState=oop_loaded` |
| 表格内容 | 无 | round1 `bodyText` 含 `classified_table.csv … GENE000001 … GENE000002`、`hasBioTable=true`、`stateLoadingHidden=true` |
| sandbox blocked 报错 | 0（B1 已解除） | 0 |

结论：**handler 补票生效**——`petri-pack://petri-pack-bio/ui/result.html` 在压测 driver 进程里第一次真实加载成功（iframe target 建立、document complete、表格数据渲染）。这清偿了 B1 票发现的 harness 缺口。

## 卡点（转移，非回退）：table_load 全链仍未通过——断点上移到握手/渲染层

两轮补 handler 后压测 `failedStage` 仍 `table_load`，但性质已变：
- 补 handler 前：`oop_no_iframe_target`（导航层无 handler，iframe target 都不建立）——**已解决**。
- 补 handler 后：`oop_document_present_ready_missing`（iframe 加载成功、表格数据在，但 `surfaceReady=false`），且 `timeoutReason=oop_watchdog_forced`、`failedError=None`——**主流程挂起后被 watchdog 强制落证**，不是 `virtual_table_ready` 正常超时。

分析（不臆断）：
- `surfaceReady` 探针读的是 `window.__petriSurfaceReady`，而产品 pack 页（result.html:167）实际发的是 `window.parent.postMessage({type:'petri:ready'})`——**探针信号名与产品协议不一致**，`surfaceReady=false` 不能证明握手失败。
- round1 `bodyText` 含表格数据 + `stateLoadingHidden=true` → pack 页实际已收到宿主 `petri:surface-context` 并渲染（该 context 由宿主 `markReady()` 触发，`markReady` 由收到 `petri:ready` 触发），间接说明握手在 pack 侧完成。
- round2 `bioTableRows=0`、canvasText 无「正在加载」——两轮 DOM 态有差异，疑为 watchdog 落证时刻的渲染竞态；主流程挂起源（某 `executeJavaScript` 在 pack iframe 导航/渲染期悬挂）未在本票定位。
- 宿主 message tap（`_installHostMessageTap`）默认未调用，`hostMessages=[]` 不代表 `petri:ready` 未发——是探针未开 tap。

**这是下一层问题（主流程挂起 + ready 握手信号名/渲染竞态），超出「补 handler」范围**。按 ≤3 轮纪律（本票 2 轮一致）+ 新裁决点停下报用户，不再盲跑。

## 结论

- **P6 harness pack handler：完成且实证有效**（iframe target 0→1、result.html complete、表格数据渲染）。HK-01 红3→绿4、邻域 18/18、lint/types 绿。
- **P6 压测 table_load 全链：仍未通过**，断点从「无 handler」上移到「主流程挂起 + ready 握手/渲染层」——新一层问题，待下一步专项。
- 未擅改任何产品代码/凭据/沙箱边界。

## 门禁

- HK-01：红 `3 fail/1 pass` → 绿 `4 pass`。
- 定向 Node 22/22：`p6-driver-pack-handler`(4) + `p6-driver-iframe-probe`(7) + `block216-pack-contributions` + `live-window-policy` + `p6-pack-scheme-privileges`（`targeted-tests.txt`）。
- `node --check` driver 通过；docs:check / ui:audit:check / tsc / lint 全 0（`docs-check.txt` / `ui-audit-check.txt` / `tsc.txt` / `lint.txt`）。
- 压测 A/B 原始读数：`driver-result-before-handler.json` / `driver-result-handler-round1.json` / `driver-result-handler-round2.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
