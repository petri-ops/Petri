# P6 PNG artifact 切换判据修复（2026-11-23）

## 改动（仅 harness，不碰产品）

用户发令排查 `png_artifact_switch_failed`。根因（code-explorer 铁证）：切换其实成功（失败现场 `artifactNetwork` 中 volcano.png 已 completed/200），但 volcano.png 属 plot 族、bio pack 仍提供 plot result surface → 切到 PNG 后 `packTakesOver=true`，`ResultArtifactShell`（承载 `data-debug-selected-name`）被卸载 → driver 全局查询拿不到 `selectedName` → `changed:false`。**是判据宿主被换掉（DOM re-host），非属性改名、非切换失败。**

改动只在 `scripts/g0-rs-p6-electron-pressure-driver.cjs` 的 `measureArtifactSwitch`：
- 判据加 pack 分支：`canvas [data-result-surface-source="pack"]` + `[data-testid="pack-surface-frame"][data-surface-state="ready"]`（packReady）OR 原 core `selectedName===artifactName`；结果加 `surface:'pack'|'core'` 落证。
- 受控 select 用 native value setter（与 `measureFilterFeedback` 同构）；清除调用点 `{useSection:true}` 死参。
- png_load 段加 subStage 五步打点（switch/inspectProjection/visualDigest/sampleMemory/publicProjection）以精确定位。
- **未动**产品 debug 属性/切换控件/pack 声明（上票只停 table，plot 保留）/sandbox/CSP/凭据/handler。

## HK-01 红绿先行

新契约 `test/p6-artifact-switch-pack.test.mjs`（4 条，纯源码）：判据含 pack 分支 / 受控 select native setter / 无死参 / 产品 DOM 与 pack 声明未改。
- 红 `3 fail / 1 pass` → 实现后 **`4 pass`**（`hk01-red.txt` / `hk01-green.txt`）。

## A/B 证据：artifact 切换判据修复生效（断点上移）

3 轮压测（第 1/2 轮本票判据已改但因主流程偶发挂起未走到 png 打点；第 3 轮加 png subStage 后定位）：

| 读数 | 改前（上票 filter-selector） | 第 3 轮（本票 `driver-result-switch-pass.json`） |
|---|---|---|
| `failedStage` | `png_load` | `png_load` |
| `subStage` | `table_interactions`（无 png 打点） | **`png_inspectProjection`** |
| log | `png_artifact_switch_failed` | 无该错（`p6_pressure_electron_failed:png_load` 为上层包装） |

结论：`subStage` 越过 `png_switch` 推进到 `png_inspectProjection`，说明 **measureArtifactSwitch 已通过**（pack 分支判据生效），`png_artifact_switch_failed` 消失。本票目标达成。

## 断点上移（非回退、非本票范围）

`subStage=png_inspectProjection`——`inspectPlotProjection`（driver 观察 PNG 画布投影）判据挂起/超时。疑因 PNG 走 pack surface 后画布图片在 iframe 内、宿主 DOM 投影不同。属下一阶段 harness 判据问题，≤3 轮纪律已到，停下报用户不擅改。

## 门禁

- HK-01：红 3 fail → 绿 `4 pass`；定向（本票+邻域）见 `targeted-tests.txt`。
- `node --check` driver 通过；docs / ui-audit / tsc / lint / changed-list 全 0。
- 压测读数：`driver-result-switch-pass.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
