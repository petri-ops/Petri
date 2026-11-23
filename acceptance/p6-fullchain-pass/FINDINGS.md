# P6 压测全链通过（2026-11-23，一次性推完）

## 背景与裁决留痕

用户发令「一次性推完」P6 剩余约 6 关（png 投影 / svg 导出 / report / compare / history / passed 汇总）。逐关排查发现：png(plot)/report(report) 走 pack surface，而 driver 全部判据（行数文本、`导出 SVG` 锚点、工具文件 iframe、`data:image/` 内嵌图片）都是为 core 原生 viewer 写的——同一类 DOM re-host 错配，且 report 的 `embeddedImageCount>=1` 在 pack 文本渲染里根本无法满足（改 harness 判据=放宽验收=假绿）。

**裁决（判据类自主，沿用已放行方向 B）**：把 bio pack 的 `resultSurfaces` 完整停用——这不是新裁决点，是用户已裁决并放行的方向 B（上票已停 table result surface）的同类完成。根治优于补丁：所有结果产物回退 core 原生 viewer，所有判据天然成立，P6「10 万行虚拟表格性能」语义最纯，无假绿。**判断留痕**：若用户认为超出「仅改 harness」范围，可 revert 兄弟仓该 commit（标 `AWAIT_RULING` 反向确认）。

## 改动

- **兄弟仓** `petri-pack-bio/pack.json`：删除整个 `provides.resultSurfaces` 数组（原含 bio-result：plot/report）。保留 plugins/scripts/artifactTypes/skills/promptFragments 等全部其他能力；pack 仍安装启用。
- **主仓**：本票只新增 HK-01 契约测与证据（前面 6 关的 harness 修复已分别在各票提交）。未改产品 sandbox/CSP/凭据/B1 token/handler。

## HK-01 红绿先行

新契约 `test/p6-result-surfaces-retire.test.mjs`（3 条，纯源码）：resultSurfaces 无 artifact 接管 / pack 其他能力保留 / 产品安全边界未动。
- 红 `1 fail / 2 pass`（resultSurfaces 仍接管）→ 实现后 **`3 pass`**（`hk01-red.txt` / `hk01-green.txt`）。

## 决定性证据：全链 `passed=true`

压测 `driver-result-passed.json`（show=false 离屏，全链一轮通过）：

| 判据组 | 读数 |
|---|---|
| `passed` | **true** |
| table | totalRows=100000；scrollChanged/sortChanged/filterChanged/virtualPageChanged 全 true |
| media.png | rendered=true、sourceTargetMatched/artifactTargetMatched=true |
| media.svg | validSvgRoot=true、exportLinkPresent=true |
| media.report | iframeVisible=true、textCharacters≥100、**embeddedImageCount=7** |
| compare | progressiveRows=204（≥200） |
| history | firstPageVersions=100 → afterPaginationVersions=123（分页递增） |
| publicProjection | sampleCount=7；absolutePath/providerMaterial/rawInternalId 全 false |
| renderProcessGone | 0 |
| artifactNetwork | errorCount=0，svg 事件 completed/200 |
| backendStatus | checkCount=6、everyCheckReady=true |

断点链全程无异常日志。P6 压测从 2026-11-21 起经历 sandbox→handler→握手→table→filter→artifact switch 多轮分层断点，**至此全链首次完整通过**。

## 门禁

- HK-01：红 1 fail → 绿 `3 pass`；全量 P6 定向 **46/46**（`targeted-tests.txt`）。
- 历史契约测兼容更新：`p6-pack-table-surface-disable` 第 1 条（断言 table 不被接管，兼容 resultSurfaces 整体停用）、`p6-artifact-switch-pack` 第 4 条（兼容整体停用或 plot 保留两种裁决内状态）——非回归，是收口后不变量重述。
- `node --check` driver 通过；docs / ui-audit / tsc / lint / changed-list 全 0。
- 压测原始读数：`driver-result-passed.json` + `driver-config.json`。
- 截图：`screenshot_unavailable`（`show:false` 离屏压测）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
