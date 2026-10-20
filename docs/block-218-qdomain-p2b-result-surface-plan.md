---
capability: qdomain-p2b-result-surface
goal: Q-DOMAIN P2b（垂直切片）— 生信主结果面由 pack `resultSurfaces` 提供；核心只保留 artifact/truth/repository host 与 code/compare/history 过渡面；pack 缺失/不匹配时诚实标注，不伪装通用结果页。
acceptance:
  - pack 在位时，`result` 模式的主结果 body 由 pack `resultSurfaces` iframe 渲染（图像/表格/文本/报告源码），带生信语义标签与 truth/revision；核心 context bar/composer 保留。
  - pack 缺失或产物类型无匹配 surface → `core-transitional` 结果面保留并显式标注；code/compare/history 仍由核心 Renderer 提供，不伪装成已迁移。
  - host 数据桥只读、有界（URL/SHA/大小/行数/列数/错误/截断），pack iframe CSP 仍禁网络；不建立第二套 artifact/truth 真相。
  - 单测覆盖 surface 解析 modes、数据桥四类 adapter/上限/错误；9223 实机腿 + closeout 十三门 PASS。
reopen: lineage/compare/history/selection/revisions 全量迁入 pack；annotations/methods/export 的 pack 化；P4 data model；真实结果 job 实机腿（当前 dev DB 无 tool_jobs）。
status: completed
---

# BLOCK-218 · Q-DOMAIN P2b（垂直切片）：pack Result Surface

> 用户裁决：2026-10-20「好的 按照你的建议推进，搞定他」=继续 Q5 → P2-UI → **P2b** → Q6 → P3 → P4。
> 前置：Q5 `resultSurfaceHost` + PackSurfaceFrame 已就绪；P2-UI 已证明 pack iframe action 往返。

## 0. P0 实码勘察（2026-10-20）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| 结果主面 | `ResultView.tsx` 85 行包裹 `ResultArtifactShell.tsx`（1328 行）；`ResultArtifactShell` 自带 manifest/preview/revision/interaction/lineage/compare | 全量迁 pack 属多轮工程；本轮只迁 `result` 模式主 body |
| host 解析 | `resultSurfaceHost.ts` 已解析 pack resultSurfaces，但未按 mode 门控 | 增加 `modes`（默认 `['result']`），避免 pack 抢占 code/compare/history |
| 数据桥 | PackSurfaceFrame 只传 artifactContext（name/type/url/revision/truth），iframe CSP `connect-src 'none'` 不能自己取数 | 新增只读 host 数据桥：图→dataURL；表→有界行；文本/markdown/json→有界文本；binary→元数据 |
| pack 契约 | `pack-contributions.js` 已投影 resultSurfaces（artifactTypes/entry/priority/emptyState） | 增 `modes`（数组，默认 `['result']`）；publicId 已单源 |
| 真实 job | dev DB `tool_jobs=0`；`tasks=187` | 真实结果 job 实机腿不可得；用 fixture pack + component/live 视图证据，如实标注 |
| 生信 pack | 兄弟仓 `petri-pack-bio` 无 `ui/` | 新增 `ui/result.html` + `provides.resultSurfaces` |

## 1. 切片

### P1 — 契约与解析
- `WorkSurfaceDescriptor`/`PackResultSurfaceContribution` 增 `modes?: string[]`。
- 后端 contributions 归一化 `modes`（只接受 `result/code/compare/history`，默认 `['result']`）。
- `resolveResultSurfaceHost` 增 `mode` 入参；仅当 mode ∈ modes 时选 pack；否则 core-transitional。
- 单测：modes 命中/不命中/缺省/非法值。

### P2 — 只读数据桥
- `frontend/src/lib/workSurface/packResultData.ts`：
  - 图（image）：fetch 原 URL（带 auth）→ blob → dataURL；>4MB 拒绝并 honest。
  - 表（table）：fetch 文本（≤2MB）→ `buildPreviewTable(maxRows 200)`，列上限 50。
  - 文本/markdown/json：≤200KB 文本。
  - report：≤200KB 源码文本；binary：只给元数据。
  - 统一返回 `{adapter,status,imageDataUrl?,rows?,text?,truncated?,reason?}`；零写入、零新 API。
- `usePackResultData(activeArtifact)` hook：按 URL/kind 键控，失败/不可用如实。
- `PackSurfaceFrame` 增 `resultData` 入 surface-context；不改变 action 桥。

### P3 — pack 结果页与 host 接线
- `petri-pack-bio/ui/result.html`：生信结果头（产物/真值/版本/类型）+ 图/表/文本渲染 + 空/载/错/截断四态；样式走自身 CSS（独立 origin），不引外部网络。
- `petri-pack-bio/pack.json` 增 `provides.resultSurfaces`（plot/table/report，priority 100，entry `ui/result.html`，modes `['result']`）。
- `CenterPanel`：pack result surface 命中且 mode=result → `PackSurfaceFrame`（带 resultData）；否则现有 `ResultView`（标注 `core-transitional`）。
- `ResultView` 的 code/compare/history 维持核心过渡；不删除、不重写。

### P4 — 验证与收口
- 前端测试：surface modes / 数据桥 adapter/上限/错误 / PackSurfaceFrame context 含 resultData。
- 9223 实机：fixture pack result surface；无真实 job 时用 fixture pack view + 合成 artifact context 验证页面渲染，host 解析由单测覆盖；如后续出现真实 job 再补。
- canonical 回写（Q-MATRIX E13/L8 注记）、closeout 十三门。

## 2. 非范围

- **不把 lineage/compare/history/selection/revisions 全量迁 pack**：它们仍由核心 ResultArtifactShell 提供，标注 core-transitional；这是 P2b 后续 reopen。
- 不删除 Result Studio 核心组件；不做通用文件浏览器；不建第二套 artifact/truth/repository。
- 不新增依赖、不改 artifact 数据模型/权限（P4）。
- pack 页面不联网、不执行远程资源；host 数据桥只读。

## 3. 验收与证据

| 项 | 判据 |
| --- | --- |
| 解析 | result mode + pack surface → pack；其他 mode / 无 surface → core-transitional |
| 数据桥 | image/table/text/report/binary 五类；4MB/2MB/200KB/200×50 上限；fetch/HTTP/超大 honest 失败 |
| pack 页面 | 图像/表格/文本、truth/revision、四态；无网络依赖 |
| host | PackSurfaceFrame 收到 resultData；core context bar/composer 不变 |
| 回归 | ResultArtifactShell/ResultStudioSurface/CenterPanel 邻域全绿；closeout 十三门 |

## 4. 风险

- **双界面过渡**：pack 主面与核心高级 tab 并存，用户可能感知切换；明确标注，逐步迁移其余 tab。
- **数据桥体积**：图像 dataURL 与表格文本需有界；超限如实显示，不静默截断。
- **pack 与核心真相**：pack 只消费 host 投影，不写 artifact/truth；卸载 pack 后核心过渡面仍能读。
- **真实 job 缺失**：dev DB 无 tool_jobs，实机腿用 fixture；不伪造“真实结果页已验证”。

## 5. 完成语义

completed 需：P1–P3 代码与测试、P4 证据、canonical 回写、closeout 十三门。**明确声明这是 P2b 垂直切片**：result 主 body 已 pack 化；code/compare/history/selection/revisions 与真实 job 实机腿仍在 reopen。

## 6. 收口（2026-10-20）

**结论：BLOCK-218 P2b 垂直切片 completed（带实机 rider）。** closeout 十三门 PASS。

### 6.1 交付

- result surface contract 增 `modes`（默认 `['result']`）；host 只让 pack 接管 `result` 模式，`code/compare/history` 保留核心过渡。
- 只读有界数据桥 `packResultData`：图→dataURL（4MB 上限）、表→前 200×50 行（2MB/200KB 文本上限）、文本/markdown/json/report 源码→≤200KB、binary→诚实降级；不新增 API。
- `PackSurfaceFrame` 向 iframe 传 `resultData`；数据晚到会重发 context；`CenterPanel` 在 result 模式且 descriptor 命中时挂载 pack surface，否则保留 `core-transitional`。
- 生信 pack：`provides.resultSurfaces`（plot/table/report，priority 100，`modes:['result']`，`ui/result.html`）+ 生信结果页（truth/revision/产物标签、图/表/文本、四态、无网络）。
- 公共 id/权限沿用 Q5 与 P2-UI；核心 artifact/truth/repository/lineage/compare 原语零搬移。

### 6.2 验证

- 前端：`packResultData` 5/5 + `resultSurfaceHost` modes 5/5 + CenterPanel pack/core 路由 2/2 + pack 页面契约 2/2 + 邻域回归。
- `quality:types` 0、`quality:lint` 0 errors、`quality:knip:check`/`quality:arch` PASS、`gate:code-size` PASS。
- `closeout` 十三门 PASS。

### 6.3 边界（明确 reopen）

- **无真实 tool_jobs 实机腿**：dev DB `tool_jobs=0`，无法打开真实结果 job；本轮只证 host 选择/数据桥/pack 页面契约，不宣称真实结果页 verified。
- 全量 lineage/compare/history/selection/revisions/annotations/methods/export 迁入 pack 未做；核心高级 tab 仍是 `core-transitional`。
- pack 结果页的图像/表格渲染需真实 artifact 才能截图；作为 P2b rider 待 fixture job/真实 job 出现后补。
- 下一步：Q6（批注）→ P3（methods/learning/legacy registry）→ P4（data model/permissions）；Q1/Q2b 可穿插。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
