---
capability: block499-p405-full-chain
status: completed
phase: CLOSED
goal: P4-05 完整尺寸链（用户 2026-11-19 A 组 #3 发令）——在第一刀（dimensions 键解析+公差带+SVG 标注+端点投影）之上，把引用升级到 v2b 特征级（BLOCK-498 落地的 feat: id/特征名+派生缓存），补尺寸链代数（D5 数值一致性：Σlinks vs total，|偏差|≤1e-6）与 SVG 链层，manifest capabilities.dimensions/dimensionChains 诚实翻转（链齐且全一致才 true，gdt 恒 false=形位符号不在本票）。
acceptance:
  - 特征引用解析：节点 features[] 缓存优先 / 基元无缓存派生回落（D1 同源）；值=行内代数量；kind=other 非代数量如实 unresolved（feature_value_not_algebraic）
  - 交叉对账：特征路径与 dimensions 键路径同值（D5）
  - 尺寸链：links 支持同节点 'ref' 与跨节点 {nodeId, ref}（装配链的工程本义）；缺省 total=沿轴 dimension 总量（box/cylinder；无映射→total_unavailable 如实拒绝）；SVG data-gdt-chains 数字进文本
  - 实机腿：真实 STEP（occt-wasm makeBox 10×20×30）→ createCadDrawing 带 chains → manifest 翻转+SVG 层；无链对照维持 false（既有 pin 不破）
  - HK-01 红 9→绿 9 + 邻域零回归（p4-cad-exchange/rw06×2 17/17）+ BLOCK-496 契约 reopen 同步 + closeout 定向 + 六件套 + commit/push
  - 零新依赖（occt-wasm=RULING-01 已批只读消费）/观感零代签/不碰 G1+
reopen: 形位符号（GD&T symbols）另案（gdt 恒 false 待真实需求）；导入件特征链（依赖 v2b 第二票导入链抽特征）另案
supersedes: 无（执行 BLOCK-496 对齐表 P4-05 完整链=authorized_pending_start 的落地）
---

# BLOCK-499 · P4-05 完整尺寸链（特征引用 + 链代数）

日期：2026-11-19 · 关联：[BLOCK-496 对齐表](./block496-ruling-registration-realign-plan.md) §3 · [RULING-04](./block-322-ruling-04-feature-reference-v2.md) §4 D5 · [BLOCK-498 v2b 后端契约](./block498-v2b-d2-d1-backend-contract-plan.md)（特征引用语法的前置）

## 0. 一句话

尺寸引用从「dimensions 键」升级到「特征级引用」并补链代数：tolerances/chains 直接吃 feat: id 与特征名（缓存优先/派生回落），Σlinks 与 total 的 D5 数值一致性进 SVG 文本层与 manifest，真实 STEP 实机腿全链验证。**gdt（形位符号）恒 false 待真实需求；导入件特征链依赖 v2b 第二票。**

## 1. 实现面

- `core/petri-server/helpers/model3d-dimensions.js`：resolveFeatureRow（缓存优先/派生回落）+ featureScalarFromRow（行内数值键解析）+ resolveToleranceFeatures 特征引用路径（source='feature'）+ buildDimensionChain（Σlinks/total/偏差/consistent，跨节点 link）+ buildChainAnnotationLayer（data-gdt-chains 文本层）。
- `core/petri-server/helpers/model3d-cad-drawing.js`：chains 参数 + chain_scene_required fail-closed + manifest.capabilities.dimensions/dimensionChains 诚实翻转 + dimensionChainSummary。
- `test/block499-p405-full-chain.test.mjs`：九测（解析/交叉对账/诚实拒绝/链一致/不一致/缺省 total/层共存/实机腿）。

## 2. 非范围

- 形位符号（GD&T symbols）另案（capabilities.gdt 恒 false）。
- 导入件特征链（CAD 抽特征→链）依赖 v2b 第二票（A 组 #2 范围内待续）。
- 零新依赖（occt-wasm=RULING-01 已批只读）/观感零代签/不碰 G1+/他方 WIP 零触碰。

## 3. 验收判据

- HK-01 红 9（函数缺席全红）→ 绿 9/9（含真实 occt-wasm STEP 实机腿）；
- 邻域 p4-cad-exchange + rw06×2 = 17/17 零回归；
- BLOCK-496 契约 reopen 同步（P4-05 完整链=implemented，--check PASS）；
- closeout 定向绿；证据=acceptance/block499-p405-full-chain/；
- G0 开发期常态 · 不外推 packaged/Provider/GA。

---

## 收口笔录（2026-11-19 · 一次会话完成）

- HK-01：红 9（函数缺席全红，hk01-red.txt）→ 实现 → 绿 9/9（hk01-green.txt，⑨=真实 occt-wasm STEP 实机腿：链齐 manifest dimensions=true+SVG 链层在盘；无链对照 false 既有 pin 不破）。
- 执行修正（如实登记）：①链 link 扩跨节点 {nodeId,ref}（测试夹具初版代数错：同节点 +z/-z/height=90≠80——链的工程本义=跨零件装配链，API 与夹具同步修正）；②total_unavailable 夹具改 cone（plane 不在第一刀维度白名单）；③model3d-dimensions 文件级误报豁免（内部派生行标记键，沿 video-compose 家族先例，P 回归基线 1484）。
- 契约联动：BLOCK-496 对齐表 P4-05 完整链 → implemented（reopen 条款），block322-ruling-codification 重算 --check PASS（sha 3abe9fd5）。
- 提交：cfff3c6e（主批）+ 82dacf83（误报豁免随批）+ 本批（台账批）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
