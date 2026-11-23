# P6 产品侧停用 bio pack table surface（2026-11-23）

## 改动（裁决方向 B 落地，红线内）

用户发令「开始 P6 产品侧停用 pack table surface」放行上票裁决方向 B。改动：
- **兄弟仓** `/Users/zhangdiandian/Documents/1.WorkDir/petri-pack-bio/pack.json`：`provides.resultSurfaces[0].artifactTypes` 从 `["plot","table","report"]` 改为 `["plot","report"]`（删 `table`）。
- `provides.artifactTypes`（包能力声明，line 19-23）**保留** `table`——不影响工具目录投影；plot/report result surface 不受影响。
- 无完整性校验（pack-contributions.js / pack-registry.js / scheme.js 均无 sha256/integrity），注册表无 hash——pack.json 改动即时生效，无需重装。
- **未动**产品 sandbox/CSP/凭据/B1 token/handler（HK-01 第 4 条断言）；未动注册表 enabled（避免停用整个包）。

## HK-01 红绿先行

新契约 `test/p6-pack-table-surface-disable.test.mjs`（4 条，纯源码）：resultSurfaces 不含 table / provides 保留 table / 回退链路在案 / 产品安全边界未动。
- 红 `1 fail / 3 pass`（resultSurfaces 仍含 table）→ 实现后 **`4 pass`**（`hk01-red.txt` / `hk01-green.txt`）。

## 决策性 A/B 证据：table_load 全链通过

同一 driver（含 tap Runtime.evaluate 修法）、同一 frontend，改 pack.json 前后：

| 读数 | 改前（上票 tap-verified） | 改后（本票 `driver-result-table-load-pass.json`） |
|---|---|---|
| `failedStage` | `table_load` | **`table_scroll`**（table_load 已过） |
| `page.tableViewport` | `False` | **`True`** |
| `page.viewerModes` | `[]` | **`["table"]`** |
| `canvasText` | pack iframe 标题，无宿主表格 | **`100,000 / 100,000 行`** + 筛选字段 + `GENE000201…` 行数据 + checkbox |
| `timeoutReason` | `None`（catch） | `None`（catch） |

**结论：B 路线成功**——`classified_table.csv` 不再被 pack surface 接管，`resolveResultSurface` 未命中 → `resultSurfaceHost` 回退 `core-transitional` 原生 viewer，`inspectTable` 的 `[aria-label="科学结果表格"]` + `100,000 / 100,000 行` + 行 checkbox 三判据天然成立。**P6「10 万行虚拟表格性能」测量语义完整保住**（无降级成 pack 200 行预览）。

## 断点上移（非回退，非本票范围）

改后 `failedStage=table_scroll`、`subStage=table_interactions`、log `Error: filter_controls_missing`——driver 的 `measureFilterFeedback` 找不到筛选控件。但 canvasText 显示筛选字段 UI 在场（「筛选字段 gene log2FoldChange … 添加筛选条件」）。这是下一阶段 harness 交互测量问题，与本票「table_load 走原生 viewer」无关，属新一层，停下报用户不擅改。

## 两仓 commit

- 兄弟仓 `petri-pack-bio`（独立 git repo，main 分支，改前干净）：pack.json 单独 commit（属该包仓库所有权）。
- 主仓 `Petri`：HK-01 契约、证据、六件套回写、impact-map 单独 commit（主仓 commit 不含兄弟仓文件）。

## 门禁

- HK-01：红 1 fail → 绿 `4 pass`；定向 Node（含本票+邻域）见 `targeted-tests.txt`。
- `node --check` driver 通过；docs / ui-audit / tsc / lint 全 0。
- 压测 A/B 原始读数：`driver-result-table-load-pass.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
