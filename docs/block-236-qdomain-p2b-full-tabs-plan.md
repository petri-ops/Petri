---
capability: qdomain-p2b-full-tabs
goal: Q-DOMAIN P2b 全量高级 tab 迁移——把仍住在核心的结果面高级视图（lineage / compare / history / selection / revisions / annotations / methods / export）按「只读数据面优先、交互面后置」的顺序分批交给领域包渲染，核心只保留 host、通用 artifact/truth 读取与过渡兜底。
acceptance:
  - 契约先行：`resultSurfaces[]` 增加 `tabs: [{ id, label }]` 声明与只读数据桥 schema（每 tab 一份 payload 形状，核心侧校验 fail-closed）；未声明的 tab 一律回落核心过渡面。
  - 第一批（只读面）由 pack 渲染：lineage（祖先链/边表）、history（job 的 revision 列表）、revisions-source（只读源码视图），数据全部走已存在的只读端点，不新增写面。
  - 核心保留：lineage 图形态、selection 交互、annotations、methods、export、compare——并继续在 DOM 标注 `data-result-surface-source`，不得出现「两个真相」。
  - 空态与降级：pack 缺失/停用/tab 未声明/数据取不到时，逐面回落核心并显示原因，不出现空白 iframe。
  - 数据桥有界：单面 payload 上限（表格行数/字节）与失败语义明确；不新增数据 API、不建第二套 artifact/truth。
  - 定向测试 + closeout 十三门 PASS；真实 job 实机腿若仍无夹具，如实记账为 rider。
reopen: compare（差异算法与交互）、selection（写面 + 图表选中语义）、annotations（BLOCK-219 已交付核心面，pack 面需窄桥）、methods（P3 已下沉数据，渲染面仍在核心）、export（导出流水在核心）、lineage 图形态、真实 job 实机腿。
status: completed
---

# BLOCK-236 · Q-DOMAIN P2b（全量高级 tab 迁移）— 第一批：只读三面

> 用户裁决：2026-10-21「按顺序进入 P1」= 承接 P0 台账对账结论，进入 P2b 全量 tab 迁移。
> 前置：Q5 host（BLOCK-216）、P2b 切片（BLOCK-218，result 模式主 body 已由 pack 渲染）。

## 1. P0 实码勘察（2026-10-21，只读实测）

| 面 | 现状证据 | 结论 |
| --- | --- | --- |
| host 路由粒度 | `CenterPanel.tsx:171` `resolveResultSurfaceHost(packResultSurfaces, activeArtifact, workspaceMode)`，`workspaceMode` ∈ `result/code/compare/history`（:170） | 已能**按模式**选 pack/core；但无「同一模式内的 tab 级」路由 |
| pack 数据桥 | `usePackResultData(activeArtifact)`（:172）+ `PackSurfaceFrame`（:305） | 只有「result 主 body 一份 payload」，没有按 tab 的数据形状 |
| 核心高级面清单 | `components/result-studio/`：`LineageStrip` + `LineageGraph` + `LineageViewSwitch`、`RevisionCodeView`、`ResultStudioChangeSetPanel`、`ScientificInteractionViewer`（selection）、`CompactResultNavigator` | 八面全部仍在核心 |
| 只读端点 | `lineage.js`：`GET /api/result-studio/lineage`；`revisions.js`：`GET /revisions/:id/source`、`/table-page`、`/artifact`；`selection.js`：`GET /selection/current`、`GET /selection/:id` | **只读三面（lineage / revisions-source / table-page）已有现成端点**，迁移不需要新 API |
| 写/交互面 | `selection.js` 的 POST/DELETE、`revisions.js` 的 replay/restore、`changesets.js` | 写入与交互语义复杂，**本轮不迁** |
| 域中性 | BLOCK-220 已把 methods 数据下沉 pack（`provides.methods`），但 methods/export 的**渲染**仍在核心 | 渲染面迁移属后续批次 |

## 2. 范围（第一批：只读三面）

1. **契约扩展**（`resultSurfaces[]`）：
   ```json
   { "id": "bio-result", "modes": ["result"], "tabs": [{ "id": "lineage", "label": "血缘" }, { "id": "history", "label": "历史" }] }
   ```
   - `tabs` 可缺省（= 只接管模式主 body，行为与 BLOCK-218 一致）；
   - tab id 白名单：`lineage` / `history` / `revisions-source`，其余拒绝并留 diagnostic；
   - 同一 tab 被多个包声明时按 packId 序稳定取首个，留 warning。
2. **只读数据桥**（`lib/workSurface/packTabData.ts`）：按 tab 取数并把 payload 整形为有界结构
   - `lineage`：`GET /api/result-studio/lineage?jobId=` → `{ nodes: ≤200, edges: ≤400 }`；
   - `history`：由 job/artifact 关联的 revision 列表（复用 `/revisions/:id/source` 的元数据或既有列表端点）→ `{ revisions: ≤100 }`；
   - `revisions-source`：`/revisions/:id/source` → 文本 ≤200KB（与 BLOCK-218 同口径）。
   - 失败语义：`{ ok: false, reason }` + 该 tab 回落核心并显示原因。
3. **host 路由**：`CenterPanel` 在「模式命中且 tab 命中」时渲染 `PackSurfaceFrame`（带 `tab` 与 payload），否则保持现状（核心过渡面 + `data-result-surface-source="core-transitional"`）。
4. **pack 侧**：`pack.json` 增 `tabs`，新增 `ui/tabs.js`（同一 iframe 内按 `tab` 参数切换三个只读视图，表格形态），不引入图库。
5. **测试**：契约校验（tabs 白名单/重复/缺省）、数据桥（有界/失败/空态）、host 路由（命中/回落）。

## 3. 非范围（reopen）

compare、selection、annotations（pack 面）、methods 渲染、export、lineage 图形态；真实 job 实机腿（无夹具时如实记账）。

## 4. 完成语义

completed 需：契约 + 数据桥 + host 路由 + pack 三面 + 测试 + canonical 回写 + closeout 十三门。**明确声明这是 P2b 第一批**：只读三面已由 pack 渲染；其余五面与图形态仍在核心。

## 5. 长任务批次编排（2026-10-21 用户「计划一个比较长的任务 大幅度推进」）

本包按**单批连续推进**执行，每阶段自带出口断言，阶段间不等待人工发令（用户已预授权整批）；任一段出口不达标即停在该段并如实记账，不把未验证阶段表述为完成。

| 阶段 | 内容 | 出口断言 | 失败处理 |
| --- | --- | --- | --- |
| **P1 契约+桥**（已完成） | `tabs` 声明白名单 + `packTabData` 有界只读桥 | `lib/workSurface` 29/29；types 0 | 已交付 |
| **P2 host 路由** | `CenterPanel` 在「模式命中 + tab 命中」时渲染 `PackSurfaceFrame` 并传 tab payload；未命中回落核心并标 `data-result-surface-source` | 路由单测（命中/未命中/pack 数据失败回落三态）+ 邻域前端绿 | 回落路径优先保正确，宁可不接管 |
| **P3 pack 三面** | pack `pack.json` 增 `tabs`；`ui/tabs.js` 渲染 lineage 表格 / 源码只读视图（history 暂不声明） | pack 页面契约测（tab 参数、payload 渲染、空态）+ `pack.json` JSON 合法 | 只声明已验证的两面 |
| **P4 测试收口** | 契约/桥/路由/pack 四面测试补齐；`test:changed` 定向绿 | 定向测试 0 红；theme/knip/docs/ui-audit 绿 | 红即修，不带病收口 |
| **P5 收口** | canonical 回写（plan 收口节、registry、AUDIT-LOG、roadmap/handoff/backlog/README）+ closeout 十三门 | 十三门 PASS；提交 + 快照 | 失败即停并记录首个红门 |

**批内纪律**：①每个阶段提交一次（便于单独回滚）；②不改既有 `result` 模式行为（BLOCK-218 证据不得回退）；③pack 侧改动只加不改（版本 0.2.0 → 0.2.1）；④真实 job 实机腿若无夹具，登记为 rider，不用合成数据宣称 verified。

## 6. 收口（2026-10-21）

**结论：BLOCK-236 第一批（只读三面）completed——但属「代码+单测绿、无实机腿」的证据等级。**

### 6.1 交付

- **契约**：`resultSurfaces[].tabs`（白名单 lineage/history/revisions-source，label ≤24 字、重复去重、坏形状整条丢弃并留 diagnostic）。
- **只读有界桥**：`packTabData.ts`（lineage ≤200 节点/≤400 边、源码 ≤200KB + 截断提示；失败返回 `missing_job_id/http_500/invalid_json/network_error/no_endpoint`）。
- **host 路由**：`code→revisions-source`、`history→history`；未声明 tab → 回落核心 `tab_not_claimed`；取数失败 → 回落核心并写 `data-fallback-reason`。
- **渲染**：`PackSurfaceFrame` 接收 `tab/tabData` 并进 `surface-context` 载荷；pack `ui/result.html` 新增 `renderTab()`（源码 `<pre>` / 血缘三列表格 / 未知 tab 诚实空态）。
- **pack 仓**：`0.2.1`，`resultSurfaces[0].tabs = [revisions-source, lineage]`——`history` **不声明**（无列表端点）。

### 6.2 验证

- 新增单测 **11 条**（路由 5 + 降级 4 + 桥 5 中的裁剪/缺参/失败部分）；
- 定向回归 **41 文件 / 318 项全绿**（lib/workSurface + result-studio + work-surface + CenterPanel）；
- `quality:types` 0、`quality:knip:check` PASS（255 键）、`theme-token-contract` 17/17。

### 6.3 边界（如实，不外推）

- **`test:changed` 对本批是空转**：跑那一刻工作树干净，输出 `changed=0`——不能表述为「影响范围已验证」。
- **无实机腿**：pack 页 `renderTab()` 未在 dev 栈用真实 revision 打开过；`lineage` 端点字段（按 `nodes/edges` 取）未实机核对。
- `history` tab 未接管（桥层返回 `no_endpoint`，路由层也因未声明而回落核心）——端点补齐后再开。
- 其余五面（compare/selection/annotations/methods/export）与 lineage 图形态仍在核心，属后续批次。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 第二批 P0 勘察结论（2026-10-21）：compare/selection 当前不可接管

用户「一次性搞完 P2b 第二批」后先做只读勘察，结论是**第二批在本轮不可执行**，依据三条实测：

| 面 | 实测 | 结论 |
| --- | --- | --- |
| compare | 端点存在（`GET /api/result-studio/changesets/:changeSetId/compare`，`routes/result-studio/changesets.js`），但 `CenterPanel` 与 `ResultView` **都没有 `changeSetId` 上下文**（grep 零命中） | 路由层即使判给 pack，桥层也拿不到 changeSet → 必然回落，属「判了也白判」 |
| selection | `POST/DELETE /selection`、`/selection/query`、`/selection/resolve` 全是写面 | 迁入 pack = 把可信写边界挪进领域包，与「核心保留治理面」相悖，**设计与纪律都不允许** |
| lineage tab | 声明已在 pack（0.2.1），但 `CenterPanel` 没有 lineage 的 tab 入口（血缘在 `ResultStudioSurface`/`LineageStrip`） | 无 tab 宿主 → 无法在结果面触发，只能等 tab 宿主补齐 |

**因此第二批需要的不是「迁移」，而是先补前置结构**：

1. `CenterPanel` 引入 **changeSet 上下文**（activeChangeSetId）或把 compare 的入口从 changeset 面板抬到结果面；
2. 结果面引入 **lineage tab 宿主**（或把血缘从 `LineageStrip` 提升为结果面一等 tab）；
3. selection 维持核心（除非另立窄桥契约并经治理裁决）。

在上述前置完成前，第二批标记为 **blocked（前置缺口）**，不计入「代码未写」的欠账——这是设计缺口，不是工作量缺口。G0 开发期常态 · 不外推 packaged/Provider/GA。
