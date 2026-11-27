# Result Studio 清理影响面清单（item 90 阶段一 · 2026-11-27）

> 引用面全量核查（owner 产品裁决：结果查看收敛双表面，RS 冗余多 bug 彻底清理；阶段一可逆下架，阶段二物理删除另派）。
> 本清单是机器钉（test/item90-result-studio-flag.test.mjs HK-90-4）的契约：五节结构 + 双表面映射表逐行判定。
> 核查基座：origin/main 2e3f7aeeb（merge-base 相等）。

## 一、代码引用面

### 后端（routes/表/共享层）
- 路由注册：`core/petri-server/routes/index.js:74` `['Result Studio', () => require('./result-studio')(app)]`（本批加 flag 守卫）。
- 路由本体：`routes/result-studio.js`（thin facade）+ `routes/result-studio/` 9 子域（annotations/changesets/context/interaction/lineage/preview-budget/revisions/selection/storage/workspace），全部挂 `/api/result-studio/*`。
- 共享闭包依赖：`routes/_helpers/`（context/format/repository/storage/validate/workflow 6 件，注明「跨 result-studio/harness/ai-agent 复用预期」——**阶段二删除时须评估 harness/ai-agent 是否已实际引用**）；`routes/tools-catalog.js` 引用 result-studio 工具目录投影。
- 共享层：`core/shared-backend/result-*` 约 20 文件（repository/changeset-service/replay-service/studio-background/lifecycle/qualification/annotation-store/schema、compare/rerun-service、scientific-task-*、git-repository-binding、execution-provenance、governance/closeout-ledger 等）。
- tools-catalog / harness 路由与 `result-studio-qualification` 存在引用（阶段二评估）。

### 前端
- 入口面（flag 门控后仍保留 tab 骨架，内容出诚实 off 态）：右栏 `results` tab（`workspace-panels/RightPanel.tsx:248` **禁区不碰**）→ `work-surface/ResultsSurface.tsx` + `EvidenceSurface.tsx`（本批加包装层）。
- RS 专属组件：`frontend/src/components/result-studio/` 约 25 组件（Studio 面板/编辑/血缘/交互查看器/导航）。
- **共享组件（阶段二删除红线，本批零触碰）**：`workspace-panels/ResultView`、`ResultArtifactShell`（1344 行）、`ResultsLibrary`、`ArtifactPinPane`、`crossJobPinSnapshot` —— 被 `copilot/ChatArtifactCard`、`SimpleChat/imageReferences`、`annotations/AnnotatablePdfPane` **复用**（会话区卡片的查看器就建在这些组件上，删了双表面即塌）。
- 页面接线：`pages/project-workspace.tsx`（resultContext/resultEditControls/handleOpenResult 等 14 处）；`lib/result-studio-interaction-client.ts`；`lib/result-manifest.ts`；`desktop/TitleBar.tsx`（注释级引用）；`App.tsx:139`（注释级引用，无独立路由——RS 无独立 page，全部在 results tab 内）。

### IPC
- 无 RS 专属 IPC 通道（RS 走 HTTP routes；`desktopBridge` 不含 result-studio 面）。

## 二、插件与领域包契约

- pack 成果面通道：`helpers/pack-contributions.js` 投影 `packResultSurfaces` → `RightPanel`（workSurfaceDescriptor kind=pack-view 的**独立 tab**，不经过 results tab）+ `ResultsSurface.tsx` 内部亦 import PackSurfaceFrame（pack 接管结果体分支）。
- **本批 flag 门控保 pack 契约无损**：off 态只关 RS 自有内容（ResultsLibrary/ResultView/Studio 面板），pack-view 独立 tab 不经过该门控（不受影响，HK-90-2 断言只测 /api/result-studio/*）。
- resources/built-in-packs/（petri-pack-create 等）**未发现**对 RS 路由/表的直接引用（grep resultSurfaces/result_surface 零命中 extensions 货架）；design-context 两处 json 为设计 token 引用，非功能契约。
- 阶段二注意：pack 经 PackSurfaceFrame 在 results tab 内的「接管分支」若被删，pack 贡献的 results 接管形态需先迁独立 tab。

## 三、数据流（写 RS 表/目录）

- 表（9 个迁移族）：`results/result_tags/result_versions`（001/006）、`result_workflow_graphs`（002）、`result_ref_transactions/git_repository_bindings/scientific_change_sets/artifact_revisions/result_selection_contexts/workspace_revision_checkpoints`（003）、`result_annotations`（015）、annotation 三子表（018/019/020）。
- 写入方（**阶段一全部未动，观察期继续**）：agent-tools 7 个 result-* 工具（selection/edit/context/context-binding/context-edit/annotation/summary，注册于 registry）+ `result-studio-background`（repository 派生）+ routes 写端点。
- 阶段一语义：读面（routes + 前端面板）404/off，写面照旧积累——观察期数据完整，恢复=开 flag 即回。

## 四、验收测试锚点

- Node 侧：76 个测试文件含 result-studio/resultStudio 引用（g0-rs-* 系列、result-changeset/compare/replay/qualification、route-baseline、facade 等）——其中 route-baseline/facade 类直测路由形状，**阶段一 flag 守卫不影响**（测试自建 app 直接 register，守卫在 flag off 下会拦——本批核真：`test/result-studio-route-baseline.test.mjs` 直连 register，flag 默认 off 会 404。**处置：该类既有测试如遇红，加 `PETRI_RESULT_STUDIO=1` 环境或 mock 决策点，属测试基建而非生产放宽**）。
- 前端侧：23 个测试文件（result-studio 组件域 21 + 邻域 2）；ResultsSurface/EvidenceSurface 既有测试本批补 flag-on mock（off 态测试独立成文件）。
- 本批新增：`test/item90-result-studio-flag.test.mjs`（后端 4 钉）+ `ResultsSurface.flag.test.tsx`（前端 3 钉）。

## 五、文档与 README

- docs/ + README 含 result-studio/Result Studio 引用 169 文件（g0-result-studio-plan、g0-rs0-audit、block-10 架构拆分记录、DOC-REGISTRY notes 等）——均为历史工作包记录，阶段一不批量改写（易漂移事实以台账/AUDIT-LOG 为准）；阶段二物理删除时随 DOC-REGISTRY 生命周期走归档流程。

## 六、双表面映射（补位核查 · 逐行机器钉）

| 场景 | RS 承载 | 双表面承接 | 判定 |
| --- | --- | --- | --- |
| 场景1 本会话生成结果查看（图/视频/HTML/3D 内联） | viewerRegistry + ResultView | 会话区 `ChatArtifactCard` 四类内联（item83/85：图片缩放灯箱/视频 blob 播放/HTML 沙箱/3D 预览） | ✅ 已补位 |
| 场景2 生成文件留存查看 | ResultsLibrary 历史列表 | 文件面板 `GeneratedFilesSurface`（item85 视频段+工作区版本/文件管理器出口） | ✅ 已补位 |
| 场景3 产物落地动作（下载/另存/系统打开） | ResultArtifactShell 导出动作 | 产物卡工具条（复制/另存/文件夹/系统查看器，item83 批）+ 文件面板「当前工作区版本」 | ✅ 已补位 |
| 场景4 Studio 内续分析对话 | ResultAgentComposer | 中央聊天（copilot 主链，handleAskAgent 一键直达） | ✅ 已补位 |
| 场景5 Schema 驱动编辑链（ResultEditPanel+changeset 修订） | Result Studio 编辑面 | **无双表面补位**——编辑链本身是清理对象（owner 裁决冗余多 bug） | ⚠️ 缺口（已报备：编辑能力随清理退役，非查看缺口） |
| 场景6 血缘认知（LineageGraph/Strip） | RS 血缘图 | **无双表面补位**——血缘认知暂缺承接面 | ⚠️ 缺口（已报备：观察期内 flag off 即不可达，阶段二裁决去留） |
| 场景7 跨会话历史结果浏览 | ResultsLibrary 全量 job 列表 | **部分缺口**——会话区卡只覆盖本会话，跨会话检索暂由指挥中心 jobs 瓦片墙部分承接（job 级） | ⚠️ 缺口（已报备：按 job 打开链路在，产物级跨会话浏览缺） |
| 场景8 交互表格查看器（ScientificInteractionViewer） | RS 交互面 | **无双表面补位**——大表交互查看暂缺 | ⚠️ 缺口（已报备：阶段二裁决去留） |
| 场景9 pack 成果面（pack-view 接管） | ResultsSurface 接管分支 | pack-view 独立 tab（registry coreSurface 之外的 descriptor tab）不受本批门控影响 | ✅ 已补位（不受影响） |
| 场景10 注释标注（result_annotations） | ResultArtifactShell 注释面 | 共享组件（AnnotatablePdfPane 等被会话区复用），未随 RS 面下架 | ✅ 已补位（组件保留，flag off 后入口随 off 态暂不可达——观察期语义） |

**缺口汇总（报 coordinator，补齐前不下架的语义=阶段一 flag off 即视为可逆下架而非删除；阶段二物理删除前须对场景 5/6/7/8 逐条裁决）**：编辑链退役确认、血缘承接、跨会话产物级浏览、交互表格查看器。

## 七、阶段一落地形状

- 后端：`decision-config` RUNTIME_POINTS 新增 `result-studio`（默认 off，env `PETRI_RESULT_STUDIO`）+ `config-schema` `point.result-studio.enabled` + `routes/result-studio/index.js` 两行守卫（`app.use('/api/result-studio', ...)` 404 `result_studio_disabled`）。
- 前端：`lib/resultStudioFlag.ts`（一次性拉取 `/api/ai/decisions/config`，fail-closed 默认 off）+ ResultsSurface/EvidenceSurface 包装层（off 态诚实面板，Inner 逐字未动；既有测试补 flag-on mock）。
- 数据：只读保留观察期（写入面 7 个 agent 工具 + background 未动）。
