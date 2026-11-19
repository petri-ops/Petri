---
capability: block498-v2b-d2-d1-backend-contract
status: completed
phase: CLOSED
goal: P3-03 v2b 后端契约票（用户 2026-11-19 A 组 #2 发令；D2/D1 已裁决形态落地）——aFeature/bFeature additive 白名单键 + features[] 派生缓存（版本键=sourceSha256/dimensions 指纹，不一致 fail-closed）+ 基元派生接线 + 特征库 CJS 收口；第二票（CAD 导入链抽特征+前端编辑器切特征键）另案待发令。
acceptance:
  - D2：mate 白名单收 aFeature/bFeature 可选键（旧键零迁移、aFace/bFace 仍是求值主键）；禁 nodeId#featureId 字符串语法（显式报错）；节点带 features 表时引用必须可解析（constraint_feature_unresolved）+ 非平面特征显式拒绝（mate_feature_not_planar，曲面/边=v2c）
  - D1：节点 features[]/featuresVersionKey 形状校验（feat:+24hex 几何签名/kind 枚举/64hex 版本键）；版本键=sourceSha256（导入件）/dimensions 规范指纹（基元）；不一致 fail-closed（features_stale_version_mismatch，与 mesh_source_hash_required 同聚合口径）
  - 接线：scene3d 消费特征库单源（derivePrimitiveFeatures→deriveNodeFeatureTable 导出；buildImportFeatureTable=第二票接缝）；特征库 ESM→CJS（消除模块探测运行时依赖）
  - 跨语言对账：前端 scene3d.ts 镜像白名单同步（契约测试逐值一致）
  - HK-01 红绿（骨架激活红 4→绿）+ scene3d 邻域零回归 + 前端 tsc/vitest + closeout 定向 + 六件套 + commit/push
  - 零新依赖 / 观感零代签 / 不碰 G1+ / D1–D5 裁决形态不变（本票=落地非改判）
reopen: 第二票（导入链抽特征+前端编辑器）发令时另立包；用户改判引用语法时本票契约同步
supersedes: 无（执行 BLOCK-496 对齐表 v2b=authorized_pending_start 的第一票）
---

# BLOCK-498 · P3-03 v2b 后端契约票（D2/D1）

日期：2026-11-19 · 关联：[BLOCK-496 对齐表](./block496-ruling-registration-realign-plan.md) §3 · [RULING-04 v2 材料](./block-322-ruling-04-feature-reference-v2.md) §4 D1/D2/D3/D5 · [BLOCK-494 骨架](./block494-w2-implementation-tickets-readiness-plan.md)

## 0. 一句话

把已裁决的 D2（additive 特征锚键）与 D1（features[] 派生缓存 fail-closed）落到 scene3d 校验/求值层：白名单加键、版本键指纹、引用可解析、非平面显式拒绝；特征库转 CJS 单源；前端镜像同步。**第二票（导入链抽特征+前端编辑器切特征键）不随本票。**

## 1. 范围与实现面

- `core/petri-server/helpers/scene3d.js`：CONSTRAINT_FIELDS.mate 加键；FEATURE_ID/NAME 正则；featureVersionKeyOf（sha/dimensions 指纹）；validateNodeFeatures（形状+版本键 fail-closed）；mate 特征锚校验（格式/解析/平面性）；求值器 mate_feature_not_planar 显式拒绝；features_stale_version_mismatch 聚合；导出 deriveNodeFeatureTable/buildImportFeatureTable。
- `core/petri-server/helpers/model3d-features.js`：ESM→CJS（唯一消费面=scene3d+契约测试 createRequire；前端有同源 TS 移植不受影响）。
- `frontend/src/lib/scene3d.ts`：约束类型+镜像白名单同步（跨语言对账门）。
- `test/block322-p3-03-v2b-d2-contract.test.mjs`：骨架激活（去 skip 纳入常规定向集；D2④/D1③ 按本票划界更新；夹具对齐真实字段名 sourceSha256/featuresVersionKey）。

## 2. 非范围

- CAD 导入链抽特征（occt-wasm faces→deriveImportFeatures 消费）+ sidecar 文件形态=第二票。
- 前端编辑器发送面切 aFeature/bFeature=第二票（现 aFace 语义零迁移继续可用）。
- 曲面/边贴合=v2c（deferred_maintained）；occt 建模 API=D3 永禁（静态负测）。
- 求值几何不变（平面贴合走既有 v2a 路径）；零新依赖；观感零代签；不碰 G1+。

## 3. 验收判据

- 骨架激活：红 4（D2①/D2④/D1①/D1③，hk01-red.txt）→ 绿 9/9；
- 邻域：scene3d+v2a+v2b+constraints 43/43；前端 scene3d vitest 15/15 + tsc 零红；
- closeout 定向绿；证据=acceptance/block498-v2b-d2-contract/；
- G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- HK-01：骨架激活红 4（D2① 白名单缺键/D2④ 引用未解析/D1① 版本键错误码缺席/D1③ 接线缺席，hk01-red.txt）→ 实现 → 绿 9/9（常驻，无 skip）。
- 邻域：scene3d/v2a/v2b/constraints/geometry 43/43；前端 scene3d vitest 15/15 + tsc 零红；跨语言对账门（block322-p3-constraints）驱动前端镜像同步=契约变更两面同批。
- 契约联动：BLOCK-496 对齐表 v2b → partially_implemented（reopen 条款），block322-ruling-codification 重算 --check PASS（sha d428d6ce）。
- 门禁交互：scene3d 尺寸基线重打（1165→1287 有意增长留因，棘轮语义不变）；新代码 1 处 object-injection warning 经 Object.entries 解构消除（P 域回归基线 1484）；1 处 no-useless-escape error 修根因。
- 事故登记（跨包）：包2 收口批裸 `git add acceptance/` 卷入 untracked 保护资产 nso wave-0 summary（df5b30b4 已推送）→ gate:user-assets 抓真 → `git rm --cached` 处置（盘上文件原样保留；先例 548eab51 同形；历史不改写）。教训=显式 add 纪律适用任何目录级 add，逐批核对 staged 清单（AGENTS 教训 a 的具体化，guard 门在册兜底）。
- 提交：b5804d14（主批）+ 5952ee76（资产处置）+ c57d78fb/ef0baf78（尺寸基线随批）+ 203c19e0（warning 修根因）+ 本批（台账批）。
- 第二票（CAD 导入链抽特征 occt-wasm faces→deriveImportFeatures 消费 + 前端编辑器发送面切 aFeature/bFeature）在 A 组 #2 发令范围内，待续另批。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
