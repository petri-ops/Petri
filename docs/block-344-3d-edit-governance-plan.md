---
capability: block-344-3d-edit-governance
status: completed
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

- ~~SceneSpec「参数级 op 化」~~ **P0 消解（2026-11-04 勘察）**：op 白名单引擎/两段式 propose-apply/CAS 均已在 3D 侧（scene3d.js 7 op + model3d_propose/apply + expectedHash），无重架构；真实工作=diff↔op 对齐 + 四件 UI 平移（§2.2/§2.3）。
- 3D 视口 ghost 的技术形态（Three.js 透明叠加/高亮描边）由 P0 一并勘察现有渲染层定。
- 后端 core 触碰面仅限 scene 路由与 sceneEdit helper（若 op 化需要）；Blender/Godot 桥零触碰（对账另立小包）。

## §2 P0 勘察定版（2026-11-04 勘察完成 → 四件范围定版）

### 2.1 关键发现（op 化裁决消解）

**op 白名单引擎已在 3D 侧**：`scene3d.js:975-1028` 已有 7 个白名单 op（set_parameter / update_node（字段级白名单）/ add_node / remove_node / add_constraint / remove_constraint / set_metadata），schema 全白名单（6 节点类型/6 材质字段/4 约束/3 modifier）；`model3d_propose` / `model3d_apply` 两段式已在且与用户面板走**同一** `sceneStore.applyOperations`；`expectedHash → scene_conflict 409` CAS 已在实现层（store:189-191）。**「整体重写改 op 引擎」的降档预案不需要**——本包是「diff↔op 对齐 + 四件 UI 平移」，无重架构。

### 2.2 现状缺口（四件的真实工作量，均中小）

| 缺口 | 证据 | 平移工作量 |
|---|---|---|
| SceneDiff 三处与 op 引擎不对齐 | `nodes.changed` 只给字段名不给字段内 before/after（sceneEditClient.ts:26-31）；`constraints` 无 id 对齐（改一条=added+removed 对）；diff 列得出 `source` 变化但 `update_node` 白名单改不了 | 补纯函数 `diffToOps(diff): Op[]`（diffScenes 输出与 op 白名单几乎一一对应）+ diff 三处补齐 → 中（偏小） |
| agent apply 未启用 CAS | `model3d_apply` schema（tool-defs/model3d.js:78-90）只暴露 scene/operations/path，不传 expectedHash；base 优先请求 scene 非磁盘 | schema 暴露 expectedHash + 默认带 → 小（治理对齐点） |
| 无「读单个修订内容」端点 | `.history/` 修订只有 list/restore；SVG 有 `readSvgRevision` 先例（svgEditClient.ts:158-172） | 新增只读端点 → 小 |
| 执行者仅 reason 弱约定 | `.history` revision 元数据无结构化 actor（reason='user_parameter_edit'/'agent_apply' 等可伪造字符串）；成果面（RW-01）元数据丰富但 createdBy 硬编码 | recordRevision 加 `{actor}` 参数 → 小 |

### 2.3 四件定版范围与挂点

1. **P1 逐项取舍**：`diffToOps` 纯函数 + diff 三处补齐 + Model3DEditPanel 改动清单 UI（op 逐项+单项撤销=op 子集+expectedHash 重 apply，SVG UI-670 同构）+ model3d_apply CAS 对齐。
2. **P2 洋葱皮对比**：`Model3DScene` 增 `ghostView` prop（候选版建进 **overlayRef 独立 overlay Group——挂点已存在**（:158,244-245,496-513 现用于测量线），材质 transparent+opacity + 滑杆对标 SVG compare）+ 修订内容只读端点；执行者 actor 字段随本阶段落。
3. **P3 提案幽灵**：`petriEvents.model3dProposal` 事件 + toolActivity 派发钩子（`tool==='model3d_propose' && resultData.proposal`，callId 去重对标 UI-677）+ Model3DScene ghost 高亮（mesh.name=node.id 可直接定位；节点按 diff id 遍历 contentRef 改 emissive/线框，不上 OutlinePass）+ 接受状态机照抄 SvgEditorViewer:388-396。
4. **P4 渲染回验衔接**：Model3DScene 快照 → 复用 `petri:composer-attach-image`（UI-680 既有通道）+ 判据 prompt；mesh.name 定位使「模型按 id 修复」闭环。

### 2.4 勘察记录出处

只读勘察子代理报告（2026-11-04）：编辑链全图/SceneDiff 形态/agent 工具权限合同（model3d_propose=analysis,R1；model3d_apply=result-studio,workspace-write,R2）/Three.js 挂点/Revision 元数据，逐条带文件:行号（见 §2.2/§2.3 引用）。

1. SceneSpec 编辑链全图：前端（Model3DEditPanel/SketchSpecDialog/Model3DResultViewer）→ client（sceneEditClient.ts）→ 后端（routes/scene 或 scene3d helpers）→ 落盘与 Revision 体系。
2. diffSceneSpecs 的 SceneDiff 形态（粒度=对象级/参数级？能否充当语义 diff 源）。
3. 提案通道：agent 改 SceneSpec 的现有路径（工具？整体写盘？）与 before-hash/冲突语义现状。
4. 3D 视口渲染层（Three.js 场景构建入口）——ghost/对比的实现挂点。
5. 产出：§2 勘察记录 + 四件逐件范围/验收判据 + op 化切法裁决稿 → 用户过目。

## §3 P1+（四件全 completed 2026-11-04；registry completed）

证据位置：`acceptance/block-344/`；完成语义：P0 定版 + 各件交付收口笔录在案 + closeout 十三门 PASS → registry completed。

- **P1 逐项取舍（completed，UI-687）**：diff 三补齐 + `update_constraint` 新 op + `diffToOperations` 纯函数 + 面板 ops 勾选 UI + model3d_apply CAS schema；契约 6/6 + 面板 5/5 + REST 实机 ✓。**3D 特有语义留档**：约束是活求解器（add/update_constraint 求值自动落位），回放一致性=「声明+求解后」非字节一致。
- **P2 洋葱皮对比（completed，UI-688）**：readRevision 端点 + actor 字段 + 修订行「对比」+ Model3DScene 独立 ghost Group（透明度滑杆只改材质）。
- **P3 提案幽灵（completed，UI-689）**：propose 回显 path/operations + petri:model3d-proposal 事件 + toolActivity 派发钩子 + EditPanel 浮条（接受=CAS 守卫落盘）。
- 预排：P4 渲染回验衔接（复用 composer-attach-image）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## §5.1 整包收口（2026-11-04 当日；四件全交付）

P0 勘察定版（op 引擎已在，裁决消解）→ P1 逐项取舍（UI-687，契约 6/6+REST 实机）→ P2 洋葱皮（UI-688，契约 8/8+REST 实机）→ P3 提案幽灵（UI-689，契约 26/26）→ P4 回验衔接（UI-690，前端 144/144）。closeout 十三门 PASS。**顺延/ reopen**：①Blender/Godot 桥写回守卫对账（独立小包）；②SceneSpec op 引擎与 SVG span 引擎的统一抽象（跨包远期）。G0 开发期常态 · 不外推 packaged/Provider/GA。
