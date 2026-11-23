# P6 ready 握手层专项（2026-11-23）

## 改动（仅 harness 观测，不碰产品）

用户发令「排查上移断点：driver 探针信号名对齐产品 petri:ready postMessage + 定位主流程挂起源」。改动只在 `scripts/g0-rs-p6-electron-pressure-driver.cjs`：
1. **waitFor 超时防护**：新增 `evaluateGuarded`（`Promise.race` + 8s 超时），`waitFor` 改走它——pack iframe 渲染期主上下文单次求值挂起时重试而非永久阻塞。
2. **宿主 message tap 重新启用**（带 10s race 防护）：`_installHostMessageTap` 在 window 创建后、navigate 前调用，捕产品实发的 `petri:ready` postMessage，落证 `readyHandshake.hostTapReady`。
3. **loadURL 改 `waitUntil:'domcontentloaded'`**：pack iframe 子资源不阻塞主文档导航。
4. **subStage 细粒度打点**：table_load 五步（navigate/inspectTable/attachDebugger/visualDigest/sampleMemory）各打点，watchdog/catch 落证带出——用于精确定位挂起位置。

**红线遵守**：未改产品 `PackSurfaceFrame.tsx`（B1 token）、`scheme.js`（handler/CSP/privileges）、任何凭据/沙箱边界。HK-01 第 4 条专门断言产品协议未改。

## HK-01 红绿先行

新契约 `test/p6-driver-ready-handshake.test.mjs`（6 条，纯源码）：tap 启用+防护 / readySent 判据用 hostMessages / waitFor guarded 超时 / subStage 打点 / loadURL domcontentloaded / 产品协议未改。
- 红：`2 fail / 2 pass`（初版）→ 迭代后 `1 fail / 5 pass`（loadURL 未改）→ 全实现后 **`6 pass`**（`hk01-red.txt` / `hk01-green.txt`）。

## 决定性发现：挂起源精确定位 = `inspectTable` 等一个在 pack 渲染路径下不存在的宿主 viewport

3 轮压测（同一 frontend、产品 B1+handler 均在场）：

| 轮次 | 改动 | subStage | 结果 |
|---|---|---|---|
| round1 | waitFor guarded + tap 启用 | （未打点） | watchdog 强制落证，hostTapReady=false |
| round2 | + loadURL domcontentloaded | （未打点） | watchdog 强制落证，hostTapReady=false |
| round3 | + subStage 打点 | **`inspectTable`** | watchdog 强制落证，精确定位卡在 inspectTable |

round3 读数：`failedStage=table_load`、`subStage=inspectTable`、`timeoutReason=oop_watchdog_forced`、`readyHandshake.hostTapReady=false`、`oop.verdict=oop_document_present_ready_missing`、iframe target=1、result.html `readyState=complete`+表格数据渲染。

**根因链（分层证据，非推测）**：
- `inspectTable`（driver line 311）等的判据是宿主 DOM 的 `[aria-label="科学结果表格"]` viewport + 行数文本 `N / M 行`。
- 但 pack surface 结果渲染路径下，表格在 **pack iframe 内**（`#bioTable`，已证实有 `GENE000001…` 数据、`stateLoadingHidden=true`），宿主结果画布**不会**再渲染 `[aria-label="科学结果表格"]` 原生表格 viewport（round2 `viewerModes=[]`、`tableViewport=false`、`images=[]`）。
- 因此 inspectTable 的 waitFor 永远等不到该 viewport → 120s deadline 与 watchdog 120s 竞态，watchdog 抢先强制落证 → `timeoutReason=oop_watchdog_forced`（而非 `timeout:virtual_table_ready` 进 catch）。
- 这是 **harness 判据与真实渲染形态不匹配**（P6 原判据测宿主虚拟表格 10 万行性能；pack surface 把表格移进 iframe）。

## 未达成的子目标：信号名对齐的 tap 未真正装上

`hostTapReady=false`（3 轮均如此）：`Page.addScriptToEvaluateOnNewDocument` 的 CDP 调用在此场景挂起（10s race 超时）。因此 `hostMessages=[]`、`readySignal=false`——**探针仍无法直接捕到 `petri:ready` postMessage**。虽然 evaluateOopProbe 的判据已用 `hostMessages.some(type==='petri:ready')`（信号名方向正确），但 tap 未装上使该判据无输入。可 next 轮改用 `Runtime.evaluate` 注入 listener（不依赖新 document 时机），但本票 ≤3 轮纪律已到，停下报用户。

## 结论

- **harness 健壮性改动完成**：waitFor guarded / tap 启用+防护 / loadURL domcontentloaded / subStage 打点，HK-01 6/6、邻域 22/22、lint/docs/ui/tsc 绿。
- **挂起源精确定位**：`inspectTable` 等 pack 渲染路径下不存在的宿主表格 viewport（subStage 铁证）——**这是判据与渲染形态不匹配**，属裁决点，未擅改。
- **table_load 全链仍未通过**：断点从「主流程挂起源不明」收敛到「inspectTable 判据错配 + tap 未装上」，均为 harness 层，非产品代码问题。

**新裁决点（停下报用户，未擅改）**：
1. inspectTable 判据是否改为读 pack iframe 内 `#bioTable`（but 这改变 P6「宿主虚拟表格 10 万行性能」测量语义），或让该 table target 走非 pack 的原生 viewer；
2. tap 是否改用 `Runtime.evaluate` 注入监听（替代挂起的 addScriptToEvaluateOnNewDocument）。

## 门禁

- HK-01：红 → 绿 `6 pass`；定向 Node（含本票+邻域）`28/28`（`targeted-tests.txt`）。
- `node --check` driver 通过；docs / ui-audit / tsc / lint 全 0。
- 3 轮压测原始读数：`driver-result-round1/round2/round3-substage.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
