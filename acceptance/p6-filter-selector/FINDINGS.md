# P6 table_scroll 筛选控件 selector 对齐（2026-11-23）

## 改动（仅 harness selector，不碰产品）

用户发令修 driver `measureFilterFeedback` selector 使 table_scroll 通过。根因：driver 用 `select[aria-label="筛选字段"]` / `input[aria-label="筛选内容"]`，产品实际是带序号且名字不同的 `筛选字段 1` / `筛选条件 1`（限定 `role=group[aria-label=表格筛选]`）。

改动只在 `scripts/g0-rs-p6-electron-pressure-driver.cjs` 的 `measureFilterFeedback`：
- selector 改 `filterGroup = viewer.querySelector('[role="group"][aria-label="表格筛选"]')` 内 `select[aria-label^="筛选字段"]` / `input[aria-label^="筛选条件"]`（前缀匹配序号）。
- React 受控 select 用 native value setter + change 事件可靠触发 `onChange`（原直接赋值在受控组件上不稳）。
- **未动**产品筛选 UI/DOM（`ScientificInteractionViewer.tsx`）、未动产品 sandbox/CSP/凭据/B1 token/handler/pack 声明。

## HK-01 红绿先行

新契约 `test/p6-driver-filter-selector.test.mjs`（3 条，纯源码）：selector 用产品真实 aria-label（前缀）/ 限定表格筛选 group / 产品筛选 UI 契约未改。
- 红 `2 fail / 1 pass`（selector 未对齐）→ 实现后 **`3 pass`**（`hk01-red.txt` / `hk01-green.txt`）。

## 决策性 A/B 证据：table_scroll 全链通过

| 读数 | 改前（上票 table-load-pass） | 改后（本票 `driver-result-table-scroll-pass.json`） |
|---|---|---|
| `failedStage` | `table_scroll` | **`png_load`**（table_scroll 已过） |
| log | `Error: filter_controls_missing` | 无该错；新错 `png_artifact_switch_failed` |
| `timeoutReason` | None | None（正常推进，非 watchdog） |

结论：**filter selector 修复生效**——`failedStage` 越过 `table_scroll` 推进到 `png_load`，`filter_controls_missing` 消失。table_scroll 五项（scroll/selection/virtualPage/sort/filter）全过。

## 断点上移（非回退、非本票范围）

`failedStage=png_load`、`Error: png_artifact_switch_failed`——artifact 切换（table → 火山图 PNG）阶段的新问题，属下一阶段 harness/产品交互，与本票 filter selector 无关，停下报用户不擅改。

## 门禁

- HK-01：红 2 fail → 绿 `3 pass`；定向 39/39（本票+邻域，见 `targeted-tests.txt`）。
- `node --check` driver 通过；docs / ui-audit / tsc / lint / changed-list 全 0。
- 压测读数：`driver-result-table-scroll-pass.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
