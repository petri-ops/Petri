---
capability: block-344-3d-edit-governance
status: active
goal: 把 SVG 编辑器验证过的「受治理编辑操作层」四件平移到 3D SceneSpec 编辑链——逐项取舍（改动清单由语义 diff 生成+单项撤销）、洋葱皮版本对比、提案幽灵（事件协议→视口 ghost→逐项接受）、渲染回验判据附件衔接。P0 先勘察 SceneSpec 编辑链现状定范围（现为整体 SceneDiff 非 op 序列，「参数级 op 化」切法是 P0 核心产出）。
acceptance:
  - P0 勘察定版：SceneSpec 编辑链全图（Model3DEditPanel/sceneEditClient/后端 scene 路由/Revision 体系）、op 化切法裁决稿、四件平移的逐件范围与验收判据；范围定版回写本文件 §2 并经用户过目。
  - P1+ 逐件交付：每件独立实机断言进 dev-verify flow（新建 block344 flow 或扩 3D flow）+ closeout + UI 台账同提交。
  - 硬门禁：定向测试 + tsc 0 + lint 0 error + 实机 + closeout；「人在画布/面板上直接修正 + agent 提案不覆盖人」的治理语义与 SVG 侧同构（before-hash/冲突拒绝不缺位）。
reopen: SceneSpec 整体重写改 op 引擎（若 P0 判定参数级 op 化成本超限的降档方案单独裁决）；Blender/Godot 引擎桥写回守卫对账（单独小包）。非目标（范围声明）：packaged/GA 属 G1+ 不外推；SimpleChat 会话主链不重构（正文 §1 同款边界）。
---

# BLOCK-344-3D-EDIT-GOVERNANCE — 3D 编辑治理对齐计划

- 登记状态：**active（2026-11-04 立项）**。用户裁决原话：「先 push 再立项 BLOCK-344」（承接主代理借鉴映射提案：SVG 验证过的四件平移 SceneSpec 链）。
- 队列位置：BLOCK-343（completed，2026-11-04）之后；无其他 active 槽位占用（`npm run state` 核实；G0-LF 常驻不占槽）。
- 唯一真相域：本文件（block-344-3d-edit-governance）。
- 来源与借鉴依据：BLOCK-342/343 已验证四件——①改动清单由语义 diff 生成+逐项撤销（UI-663/670，撤销=磁盘重建+按序回放）；②洋葱皮版本对比（UI-679）；③提案幽灵事件协议 `petri:svg-proposal`（UI-675/677，编辑器订阅+逐项接受）；④渲染回验附件判据（UI-680）。3D 侧现状（勘察预研）：`Model3DEditPanel` 有表单编辑+`diffSceneSpecs` 整体预览+revision 恢复（RW-01 接成果面）；缺逐项取舍/对比视图/提案 ghost。
- 完成语义：P0 定版 + 各件交付收口笔录在案 → registry completed；降档项如实留 §5。

## §1 已知边界（立项即声明）

- SceneSpec 现为**整体 JSON 文档**（非 op 序列）——「参数级 op 化」是本包最重的架构裁决点，P0 产出切法稿（含成本/降档对比）后**经用户过目再动工**，不默认走重架构路线。
- 3D 视口 ghost 的技术形态（Three.js 透明叠加/高亮描边）由 P0 一并勘察现有渲染层定。
- 后端 core 触碰面仅限 scene 路由与 sceneEdit helper（若 op 化需要）；Blender/Godot 桥零触碰（对账另立小包）。

## §2 P0 勘察范围（当前执行）

1. SceneSpec 编辑链全图：前端（Model3DEditPanel/SketchSpecDialog/Model3DResultViewer）→ client（sceneEditClient.ts）→ 后端（routes/scene 或 scene3d helpers）→ 落盘与 Revision 体系。
2. diffSceneSpecs 的 SceneDiff 形态（粒度=对象级/参数级？能否充当语义 diff 源）。
3. 提案通道：agent 改 SceneSpec 的现有路径（工具？整体写盘？）与 before-hash/冲突语义现状。
4. 3D 视口渲染层（Three.js 场景构建入口）——ghost/对比的实现挂点。
5. 产出：§2 勘察记录 + 四件逐件范围/验收判据 + op 化切法裁决稿 → 用户过目。

## §3 P1+（范围待 §2 定版，占位）

证据位置：`acceptance/block-344/`；完成语义：P0 定版 + 各件交付收口笔录在案 + closeout 十三门 PASS → registry completed。

- 预排：P1 逐项取舍（SceneDiff→改动清单+单项撤销）；P2 版本对比视图；P3 提案幽灵+事件协议；P4 渲染回验衔接。顺序与合并以 §2 定版为准。

G0 开发期常态 · 不外推 packaged/Provider/GA。
