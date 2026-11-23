# P6 inspectTable 判据裁决（2026-11-23）

## 裁决（单一方向）：选「原生 viewer」方向（B）；产品侧改动停下报用户，未擅改

发令要求就两裁决点给单一最合理方向：
- A = `inspectTable` 改读 pack iframe 内 `#bioTable`
- B = 该 table target 走原生 viewer（不经过 pack surface）

**裁决 = B**。理由（一句话）：A 会把 P6 从「10 万行虚拟表格性能测量」降级成「200 行截断静态预览」，丢失工作包本质语义；B 保住语义，但其开关在产品侧（停用 bio pack 的 table result surface / 改 pack.json 声明），超出「仅改 harness 观测」红线，故只出裁决材料、停下报用户，不擅改产品。

## 决策性证据（code-explorer 现读，文件:行号）

### A 路线被否决：pack #bioTable 是 200 行截断预览
- `/Users/zhangdiandian/Documents/1.WorkDir/petri-pack-bio/ui/result.html:93` `bodyRows.slice(0, 200).forEach(...)` —— 最多 200 行。
- `:53` / `:155` `truncatedNote`「内容超出预览上限，已截断展示」。
- 宿主数据桥同样截断：`frontend/src/lib/workSurface/packResultData.ts:21` `MAX_TABLE_ROWS = 200`、`:105` `buildPreviewTable(..., {maxRows: 200})`。
- pack 表格无虚拟 viewport、无 `N / M 行`、无行 checkbox——`inspectTable` 三判据全缺。改读它 = 测 200 行静态预览，非 10 万行虚拟表格。**否决。**

### B 路线判据齐备，但开关不在 harness
- 原生表格 viewer 判据齐备：`frontend/src/components/result-studio/ScientificInteractionViewer.tsx:281` `data-mode="table"`、`:300` `${matchedCount} / ${totalRows} 行`、`:329-334` 虚拟滚动窗口、`:349` 行 checkbox。
- pack/原生判定在 `frontend/src/components/result-studio/resultSurfaceHost.ts:37-58`：`artifactKinds=[semanticKind,type]` → `resolveResultSurface` 命中 pack 则 `source:'pack'`，否则原生。
- 匹配规则：`frontend/src/lib/workSurface/registry.ts:308-322`（按 `artifactTypes` 匹配）；声明源 `petri-pack-bio/pack.json:26-40` `artifactTypes:["plot","table","report"]` → `classified_table.csv`（table 族）被接管。
- driver 的 `targetUrl`（`scripts/g0-rs-p6-electron-pressure-driver.cjs:86-90`）只生成 `/project/<id>/result?job=&artifact=`；`job`/`artifact` 仅用于自动打开（`frontend/src/pages/project-workspace/useWorkspaceOpenEffects.ts:80-108`），**不参与 pack/原生判定** → driver 无 URL 开关强制原生。
- 无 harness 侧 env 可禁用 pack（`pack-registry.js:142-146` 的 `PETRI_PACK_DIRS` 只增不减；`setPackEnabled` 改 `~/Documents/Petri-Local/packs/installed.json` = 用户资产）。
- 结论：B 需在产品侧停用 bio pack 的 table result surface（`pack.json` 删 `table` 声明 / 注册表 `enabled:false`）后重跑 driver，届时 `inspectTable` 的原生 DOM 判据天然成立。**需用户裁决是否执行该的产品侧改动。**

## 本票在 harness 内执行的部分（明确在红线内）：tap 配套修法

发令明确「附 tap 改 Runtime.evaluate 注入的配套修法」——此为纯 harness 观测改动，已实现：
- `_installHostMessageTap` 从挂起的 `Page.addScriptToEvaluateOnNewDocument` 改用 CDP `Runtime.evaluate` 注入 message listener。
- 注入时机改到 `navigate()` 内 `loadURL` 之后（`Runtime.evaluate` 只在已提交文档上下文存活，loadURL 前注入会随文档导航丢失），每次 navigate 重新注入，带 `Promise.race` 超时防护。
- 不动产品 sandbox/CSP/凭据/B1 token/handler，不动 pack.json/注册表。

## tap 修法实证（短压测 WAIT 5s，`driver-result-tap-verified.json`）

- `readyHandshake = {hostTapReady: true, attempts: 1}` —— Runtime.evaluate 注入成功（上票 addScriptToEvaluateOnNewDocument 挂起导致 false）。
- `hostMessages = [{type:"petri:ready", surfaceId:"bio-result", at:…}]` —— **首次捕到产品实发的 petri:ready postMessage**。
- `oop.verdict` 从 `oop_document_present_ready_missing` → **`oop_document_present_ready_sent`**；`readySignal=true`。
- `timeoutReason=None`（正常 catch 落证，非 watchdog 强杀）——上票 output:judge 判「探针信号名对齐未达成」已补齐实质读数。
- `subStage=inspectTable` 仍——再次印证宿主表格 viewport 判据错配，与裁决 B 一致。

## 状态

- harness 侧 tap 修法已实证生效（Runtime.evaluate 注入 + 捕到 petri:ready）；HK-01 绿 4/4。
- **停下报用户**：是否执行产品侧停用 bio pack 的 table result surface（B 路线落地前提）。未获发令不改产品。
- P6 table_load 全链验证待 B 路线产品侧裁决后复跑（届时 inspectTable 原生判据天然成立）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
