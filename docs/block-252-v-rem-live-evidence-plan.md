---
capability: v-rem-live-evidence
goal: 给 V-REM 三条遗留 UI 补实机证据并把挡路的真实断点修掉——UI-544（结果面 code 模式由领域包渲染源码）、UI-545（compare 模式由领域包渲染四列差异）、UI-546（图像/PDF 图形批注创建 ellipse/arrow）；证据足则三条升 verified。
acceptance:
  - UI-544：真实结果 job + 领域包夹具 → 结果面 code 模式命中 pack（`data-result-surface-source="pack"` + `data-pack-tab="revisions-source"`），pack iframe 收到有界源码并渲染；history 模式未声明时如实回落核心并标 `data-fallback-reason=tab_not_claimed`。
  - UI-545：compare 模式命中 pack（`data-pack-tab="compare"`），pack 渲染四列差异表（文件/状态/新增/删除），数据来自真实 `changesets/:id/compare`；`changeSetId` 有**持久来源**（当前查看版本），不再只依赖瞬时运行进度。
  - UI-546：结果图像产物在核心结果面打开批注条 → 选择 ellipse / arrow → 拖拽出 draft（`data-kind` 正确）→ 保存 → REST 落库 `kind` 正确、列表显示形状；两种形状各一条。
  - 修复实机抓到的断点并留单测：后端贡献投影透出 `tabs`；`packTabData` 读 `content` / `lineage.chain` / 真实 `changeSet.changedPaths` 且不带双 `/api`；source 桥带 `projectId`；`pack-result` 可挂 iframe；pack 接管 result body 时保留模式栏；`ActiveArtifact.changeSetId` 作为 compare 的持久来源并在切模式时不被空投影覆盖。
  - 实机：隔离栈（:3001 + :3000 + :9223 离屏 + 临时数据根 + 夹具 pack + 真实 git 绑定），亮/暗各一轮；证据落 `acceptance/ui-544/`、`acceptance/ui-545/`、`acceptance/ui-546/` 与 `acceptance/block-252/`。
  - 门禁：定向 Node/前端测试 + `npm run closeout` 十三门 + canonical 回写 + 本地提交（不推送）。
status: completed
---

# BLOCK-252 · V-REM：UI-544 / UI-545 / UI-546 实机腿

> **一句话**：把三条「代码+单测绿、从未在真栈里打开过」的结果面/批注面真正跑到屏幕上，并修掉沿途让它们根本跑不通的接线断点。

## 0. 交接摘要（换 agent 先读这一节）

- **背景**：BLOCK-236（UI-544/545）与 BLOCK-238（UI-546）都因无夹具只记 `in_progress`；本轮用隔离栈 + 合成结果 job + 夹具 pack 补实机。
- **P0 实码勘察（已抓到的真断点）**：
  1. `core/petri-server/helpers/pack-contributions.js` 的 `normalizeResultSurfaces` **不透出 `tabs`** → 前端永远看不到 tab 声明，code/compare 必回落核心。
  2. `frontend/src/lib/workSurface/packTabData.ts` 读 `payload.source`/`text`，而后端 source 端点返回 `content` → 永远 `empty_source`。
  3. 同文件 lineage 读顶层 `nodes/edges`，而 `/api/result-studio/lineage` 返回 `{ lineage: { chain, downstreamCount } }` → 空图。
  4. `CenterPanel` 的 compare `changeSetId` 只来自 `activeResultProgress`（瞬时运行态）→ 重载/普通查看版本后 compare 永远 `missing_changeset_id`；当前查看版本本身带 `changeSetId`，应作为持久来源。
- **夹具**：真实 git 绑定的项目（`bindProjectRepository` + 虚拟文件提交）+ 合成完成 job/产物/revision/变更集/血缘图；pack 是隔离数据根里的夹具包（只声明 table 结果面，图像仍走核心面以便批注）。
- **证据口径**：host DOM（`data-result-surface-source`/`data-pack-tab`/`data-fallback-reason`）+ pack iframe 截图 + REST 真相（compare 文件表、annotation kind）+ 批注 DOM。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与判据

| 面 | 用户路径 | 判据 |
| --- | --- | --- |
| UI-544 源码 | 结果 job → code 模式 | pack 命中 + iframe 渲染源码（截图）+ 源码来自 revision source 端点 |
| UI-544 降级 | history 模式 | 包声明但桥无端点 → 核心回落，`data-fallback-reason="no_endpoint"`（不装空白 iframe） |
| UI-545 比较 | 查看某一版 → compare 模式 | pack 命中 + 四列差异表渲染（截图）；REST compare 有 ≥2 文件；`changeSetId` 来自当前 revision |
| UI-546 椭圆 | 图像结果 → 批注 → 椭圆 → 拖拽 → 保存 | draft `data-kind=ellipse`；REST kind=ellipse；列表显示「椭圆」 |
| UI-546 箭头 | 同上 → 箭头 | draft `data-kind=arrow`；REST kind=arrow；列表显示「箭头」 |
| 非范围 | lineage tab 的 host 触发（当前无 mode 映射，仅 pack 页能力）、PDF 批注、任意角度箭头、真实模型产物 |

## 2. 实现清单

- 修复：`pack-contributions.js` tabs 透出 + 白名单；`packTabData.ts` source `content` + lineage `chain` 映射；`ActiveArtifact.changeSetId` 投影与 `CenterPanel` 持久回退。
- 夹具/实机：`scripts/block252-v-rem-live.mjs` + flow `ui544-546-pack-annotation-live.cjs`。
- 测试：pack contributions tabs、packTabData 两处形状、CenterPanel/pack 面邻域。
- 台账：UI-544/545/546 → verified；canonical 全套。

## 3. 阶段与状态

| 阶段 | 状态 | 产出 |
| --- | --- | --- |
| P0 立项 | ✅ | 本计划 + 注册 + 影响面 |
| P1 断点修复 + 单测 | ✅ | 八处接线修复 + pack contributions/packTabData/CenterPanel 单测 |
| P2 实机 harness | ✅ | 真实 git 绑定项目 + 合成结果链 + 夹具 pack + flow |
| P3 亮/暗轮 | ✅ | 各 **23/23**；八张亮暗截图 |
| P4 收口 | ✅ | UI-544/545/546 verified + canonical + closeout + 提交 |

## 4. 验证记录

- **亮/暗各 23/23**（`acceptance/ui-544/`、`ui-545/`、`ui-546/` 三份同报告；`acceptance/block-252/` 同份）。
  截图 8 张：`ui544-result-pack-{light,dark}.png`、`ui544-code-pack-{light,dark}.png`、
  `ui545-compare-pack-{light,dark}.png`、`ui546-annotations-{light,dark}.png`。
- **UI-544**：结果面结果 body 由 pack 渲染（`data-result-surface-source=pack`、iframe
  `petri-pack://ui252fixture/ui/result.html`）；code 模式命中 `revisions-source`，截图显示
  `UI544_SOURCE_READY len=46` 与 base 版源码（含 marker）；history 未声明 → 核心回落
  `data-fallback-reason=tab_not_claimed`（不渲染空白 iframe）。
- **UI-545**：选中历史版本后 compare 模式命中 pack compare（截图四列表格：
  `analysis/scripts/rev_candidate/artifact.R` / `parameters.json`，状态 modified；无逐行 patch 时
  新增/删除显示「—」）；REST compare 2 个 changedPaths 对账；`changeSetId` 来自当前查看版本的
  持久字段，不再依赖瞬时运行进度。
- **UI-546**：图像结果走核心面（pack 不声明 plot 的 result 模式）；历史「查看」后批注条可用；
  选椭圆/箭头时 sketch hint 分别显示「拖拽框选椭圆范围」「拖拽框选箭头范围」；保存后列表出现
  「椭圆」「箭头」两条，REST 返回 `kinds=["ellipse","arrow"]`；截图中红图上可见椭圆与箭头。
- **实机抓真并修复（八处）**：
  1. 后端 `pack-contributions` 不透出 `tabs`；
  2. `packSurfaceUrl` 只认 `pack-view`，`pack-result` 永远“没有可挂载视图”；
  3. pack 接管 result body 后 `CenterPanel` 把 contextBar 置空 → 无模式入口；
  4. `packTabData` source 读 `source/text` 而非后端 `content`；
  5. source 桥缺 `projectId`（且 `usePackTabData` 把参数丢掉）；
  6. 所有 tab 端点写成 `${base}/api/...`，与已含 `/api` 的 base 双前缀 → 404；
  7. lineage 桥读 `nodes/edges` 而后端返回 `lineage.chain`；compare 桥读 `files` 而后端返回
     `changeSet.changedPaths + textDiff`；
  8. `changeSetId` 只有瞬时来源；切模式时核心 shell 的空投影会覆盖已水化的
     revision/family/changeSet（并形成身份请求反馈环）。
- **边界**：pack iframe 为独立 origin，页面侧读不到内部 DOM → 渲染证据以截图为准（DOM 只断言
  host 路由属性）；compare 的逐文件新增/删除在无逐行 patch 时显示「—」（不补 0）；
  history 用 `tab_not_claimed` 回落（最终夹具未声明 history tab）；结果为合成夹具。

## 5. 非范围

- 不新建结果数据 API；compare/lineage 仍走既有只读端点。
- 不改批注几何/白名单；不扩到 PDF。
- 不碰 G1+ 事项。
