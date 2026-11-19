---
capability: block504-v2b-import-features
status: completed
phase: CLOSED
goal: P3-03 v2b 第二票（用户 2026-11-19 发令「开始 v2b 第二票」；接缝=buildImportFeatureTable）——CAD 导入链 occt-wasm 只读 faces 枚举→deriveImportFeatures 消费→写入 features[] + featuresVersionKey=sourceSha256（sidecar provenance 锚定）；前端约束编辑器发送面切 aFeature/bFeature 契约键（additive，aFace/bFace 求值主键保留）。
acceptance:
  - 导入链抽特征：cad-exchange 新增只读 extractImportFaces（importStep→getSubShapes('face')→surfaceType/getBoundingBox/getVolume），真 STEP 枚举 6 plane 面 + 6 元 bbox；D3 静态负测禁建模 API（零新依赖，occt-wasm=RULING-01 已批）
  - 接缝消费：model3d-assets.importCadAsset 调 scene3d.buildImportFeatureTable(faces)→features[]，写入 node.features + node.featuresVersionKey=sourceSha256（D1 派生缓存口径）
  - sidecar sha 锚定：provenance.json 记 featuresVersionKey/featureCount/featureKinds，版本键 === sha256 === node.source.sourceSha256；IGES 网格无 B-rep faces 如实不写 features（零编造）
  - 前端切键：SceneConstraintEditor 提交含 aFeature/bFeature 契约键（取特征 id），aFace/bFace 求值主键 additive 保留；sceneFeatures 优先消费 node.features 派生缓存，基元缺失回落
  - HK-01 红绿先行：契约测缺席先红→实现转绿；邻域 scene3d/v2a/v2b/constraints/cad-exchange/assets/glb-import 零回归；前端 vitest + tsc 零红
  - closeout 定向绿 + 六件套 + commit/push + snapshot 标签；证据=acceptance/block504-v2b-import-features/
  - 零新依赖 / D3 禁建模 API（只读分析）/ 观感零代签 / 求值几何不变 / 不碰 G1+ / D1–D5 裁决形态不变
reopen: 曲面/边贴合=v2c 维持 deferred；用户改判 aFeature 求值语义或 sidecar 校验口径时本契约同步
supersedes: 无（承接 BLOCK-498 第一票 reopen 条款；执行 BLOCK-496 对齐表 v2b 第二票）
---

# BLOCK-504 · P3-03 v2b 第二票（CAD 导入链抽特征 + 前端编辑器切特征键）

日期：2026-11-19 · 关联：[BLOCK-498 第一票](./block498-v2b-d2-d1-backend-contract-plan.md)（接缝 buildImportFeatureTable）· [BLOCK-496 对齐表](./block496-ruling-registration-realign-plan.md) §3 v2b=partially_implemented · [RULING-04 v2 材料](./block-322-ruling-04-feature-reference-v2.md) §5 P3-03 v2b · [BLOCK-494 骨架](./block494-w2-implementation-tickets-readiness-plan.md)

## 0. 一句话

把第一票预留的 `buildImportFeatureTable` 接缝接上 CAD 导入链：occt-wasm **只读** faces 枚举 → `deriveImportFeatures` 得到 `features[]` → 以 `sourceSha256` 为版本键写入节点并锚进 provenance sidecar；前端约束编辑器发送面从 UI 命名映射切到 `aFeature`/`bFeature` 契约键（additive，求值仍走 `aFace`/`bFace`）。

## 1. 范围与实现面

- `core/petri-server/helpers/cad-exchange.js`：新增 `extractImportFaces({bytes})` —— `OcctKernel.init()` → `importStep`（只读导入）→ `getSubShapes(shape,'face')` → 每面 `surfaceType` + `getBoundingBox` + `getVolume` → `[{type, bboxMm:[xmin,ymin,zmin,xmax,ymax,zmax], volumeMm3}]`；仅只读 API，禁 `makeBox/sew/makeSolid/...` 建模族（D3 静态负测对象）。STEP 枚举；IGES（occt-import-js 网格）无 B-rep faces → 如实返回空/不适用，不编造。
- `core/petri-server/helpers/model3d-assets.js`：`importCadAsset` 在 STEP 转换成功后调 `extractImportFaces` → `scene3d.buildImportFeatureTable(faces)` → 写入 `imported.node.features` + `imported.node.featuresVersionKey = inspected.sourceSha256`；provenance 传参加 `featuresVersionKey`/`featureCount`/`featureKinds`，扩展 `cleanProvenance` 白名单使锚进 `<sha>.provenance.json`。IGES 分支不写 features。
- `core/petri-server/helpers/scene3d.js`：`buildImportFeatureTable` 接缝已在册（透传 `deriveImportFeatures`），本票不改其契约，仅由导入链消费。
- `frontend/src/lib/workSurface/sceneFeatures.ts`：`SceneFeatureRow` 增导入件字段（index/mateAllowed/bboxMm/volumeMm3）；`deriveSceneFeatures` 优先消费 `node.features` 派生缓存，基元缓存缺席回落既有派生（同源、零漂移）。
- `frontend/src/components/work-surface/SceneConstraintEditor.tsx`：提交对象新增 `aFeature`/`bFeature` 契约键（取选中 feature row 的 id=几何签名）；`aFace`/`bFace` 求值主键 additive 保留；下拉 value 对导入件用稳定 id/索引。
- `test/block504-v2b-import-features.test.mjs`：HK-01 契约测（缺席红→实现绿）；`test/impact-map.json` 加 BLOCK-504 规则；前端 `sceneFeatures.test.ts` + `scene3d.test.ts` 邻域。
- `docs/DOC-REGISTRY.json` / `docs/README.md` / `docs/AUDIT-LOG.md`：立项与收口登记。

## 2. 非范围

- 曲面/边贴合与相切约束 = v2c（deferred_maintained，重开需新发令）；`mate_feature_not_planar` 对曲面显式拒绝不静默。
- 求值几何不变：mate 求值主键仍是 `aFace`/`bFace`，`aFeature`/`bFeature` 是 additive 特征锚，不在本票改变求解器几何语义。
- occt 建模 API（`makeBox/makeCylinder/sew/makeSolid/...`）= D3 永禁；本票只用只读分析 API。
- 观感（UI 视觉/动效/字号/颜色）= 用户人眼签字，零代签；本票只动数据面提交键，不声明任何 `verified` 观感态。
- 零新依赖；不碰 G1+（Provider/公证/GA/packaged）；D1–D5 裁决形态不变（落地非改判）。
- 既有 WIP 零触碰：`acceptance/functional-audit-2026-11-04/surface-matrix.json` 等 5 项跟踪改动 + 10 项 untracked 保护资产（nso wave-0 summary、assets/、pelican-bicycle.html 等）——本包提交逐批显式 add，禁目录级 `git add`。

## 3. 验收判据（HK-01 红→绿）

- 红（缺席先跑）：`node --test test/block504-v2b-import-features.test.mjs` 因 `extractImportFaces` 未导出 / node.features 缺席 / 前端未发契约键而红，红证据落 `acceptance/block504-v2b-import-features/hk01-red.txt`。
- 绿：契约测全绿（含真 STEP 只读枚举腿 + D3 静态负测）；邻域 `block322-p4-cad-exchange` + `block322-p5-assets` + `block322-p3-03-v2b-d2-contract` + `block322-p3-constraints` + `block460-glb-import` 零回归；前端 `sceneFeatures`/`scene3d` vitest + tsc 零红。
- 契约联动：BLOCK-496 对齐表 v2b → implemented（含证据指针），`block322-ruling-codification --check` PASS（sha 重算）。
- closeout 定向绿；六件套回写；commit/push + `snapshot-YYYYMMDD` 标签（同日第二个 `-2`）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 4. 完成语义

契约测绿 + 邻域零回归 + closeout 定向绿 + 六件套回写 + 提交与标签落定即为 `completed`；曲面=v2c 维持；红绿证据、实机探针读数、事故如实登记入收口笔录。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- **编号避让**：BLOCK-503 已由并发的人眼核对清单包占用（用户裁决批自动化线移交本 agent），本包用 BLOCK-504；两包 touchSurface 不相交（人眼包仅 docs 清单），registry 已补 `sharedBaselines: []` 声明放行并行判定。
- **HK-01 红绿先行**：红 6 项（extractImportFaces 缺席 / importCadAsset node.features 缺席 / sidecar 锚缺席 / 前端 aFeature 键缺席 / sceneFeatures 缓存缺席 / D3 静态负测缺席）→ 实现 → 绿 8/8（2 基线绿=接缝透传 + IGES 零编造，6 目标红转绿）。红证据 `acceptance/block504-v2b-import-features/hk01-red.txt`，绿证据 `hk01-green.txt`。
- **真 STEP 只读腿**：`extractImportFaces` 走 `importStep`→`getSubShapes('face')`→`surfaceType/getBoundingBox/getVolume`，真 10×20×30 STEP 枚举 6 平面面 + 6 元 bbox + 数值 volume；内核 stdout 统计如实保留在证据；D3 静态负测禁 14 个建模 API 零命中。立项前的只读探针（`.petri-dev-user-data/v2b-faces-probe.mjs`）验证 API 后即删，不入产品链。
- **版本键根因修正**：初版误用原始 STEP 的 `inspected.sourceSha256` 作 featuresVersionKey，红测抓真（D1 `featureVersionKeyOf` 对 mesh-reference 读 `node.source.sourceSha256`=派生资产 sha）；改为 `derivedSha` 后 node 版本键=sidecar `sha256`=asset sha 三者一致，避免 `features_stale_version_mismatch`。IGES 网格无 B-rep faces，如实不写 features（零编造）。
- **邻域**：契约测 8/8 + 前端 vitest 21/21（sceneFeatures 6 含新增缓存守门 2 + scene3d 15）+ tsc 零红；Node 邻域 32/32（p4-cad-exchange/p5-assets/v2b-d2-contract/p3-constraints/glb-import）；契约联动 11/11（block491-ruling-codification --check PASS sha cb37813f69a5）。
- **契约联动**：BLOCK-496 对齐表 v2b `partially_implemented` → `implemented`（含两票证据指针），生成器锚点/EXPECTED_TICKET_STATUS/消费测试同步；越权负测改用 v2a 锚（v2b 已 implemented 不再适合做越权样例）。
- **观感纪律**：Jev doc:suggest uiAudit deterministic 建议命中（SceneConstraintEditor.tsx 改动）→ UI-639a 增数据面增量小节，明示 additive 特征锚键+缓存消费为代码契约级、未跑实机腿、不升级 verified 态、观感零代签。
- **Jev 建议器**：test:suggest 零建议（area_none：立项时仅新建 plan 无生产面）；doc:suggest 仅 uiAudit deterministic 命中（已处置）。
- **范围守住**：零新依赖（occt-wasm=RULING-01 已批只读）/ D3 禁建模 API（只读分析）/ 观感零代签（仅数据面）/ 求值几何不变（aFace/bFace 求值主键 additive 保留）/ 不碰 G1+ / D1–D5 形态不变。既有 5 项跟踪改动 + 10 项 untracked 保护资产零触碰，提交逐批显式 add。
- **提交与快照**：见 AUDIT-LOG 收口行（commit hash + snapshot 标签）。G0 开发期常态 · 不外推 packaged/Provider/GA。
