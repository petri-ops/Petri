---
capability: block-343-svg-editor-tail
status: active
goal: 收完 SVG 编辑器线——BLOCK-342 §10 交接项按三阶段交付：P1 小项批（选区浮动工具条/其余模态挂 modal 层/字体品牌表/style 简写可视化）、P2 版本对比+历史面板、P3 vision 判据附件通道。位图描摹不进包（⛔ 需装 Inkscape，守卫已就位装后即用）。
acceptance:
  - P1：选区浮动工具条（画布内跟随选区：删除/复制/问 agent 等高频动作）；BLOCK-342 之外低于 10000 的既有模态按 UI-668 契约补挂 `data-petri-layer="modal"`（接缝让位契约已就位）；字体下拉接品牌字体表；元素 `style` 属性可视化逐属性编辑（set_style op）。全项实机断言进 flow。
  - P2：版本对比（当前视图 vs 任一修订的洋葱皮叠加，复用 ghost 同 scale 模式）；历史面板增强（修订时间线，执行者标注以快照元数据真实承载为限——无则如实留 reopen，不伪造）。
  - P3：渲染回验快照进会话附件通道（改→渲染→模型看图→迭代真闭环），复用既有附件承载面；通道不通处如实降档。
  - 硬门禁：每阶段定向测试 + flow 实机断言扩展 + closeout；UI 台账同提交更新。
reopen: 位图描摹（装 Inkscape 后即用）；资产路径嵌入形态（显示改写与守卫设计，随 P1 收口批单独裁决或顺延）；SVG 外其余画布类。非目标（范围声明）：packaged/公证/Provider 矩阵/GA 属 G1+ 不外推；SimpleChat 会话主链只接附件承载面不重构（正文 §P3 同款边界）。
---

# BLOCK-343-SVG-EDITOR-TAIL — SVG 编辑器收尾批计划

- 登记状态：**active（2026-11-04 启动）**。用户裁决原话：**「BLOCK-343 开整」**（2026-11-04，承接主代理计划提案「P1 小项批 → P2 版本对比+历史面板 → P3 vision 附件通道」）。
- 队列位置：BLOCK-342（completed，2026-11-03）之后；启动时无其他占用 active 槽位的工作包（`npm run state` 核实；G0-LF 常驻不占槽）。
- 唯一真相域：本文件（block-343-svg-editor-tail）。来源=BLOCK-342 §10 交接项清单（规划对账 2026-11-04）。
- 完成语义：三 P 阶段串行，每阶段独立提交+实机；全部收口后 registry → completed。
- 文件面：`frontend/src/components/svg-editor/**`、`frontend/src/pages/project-workspace/**`（模态挂层）、`frontend/src/components/settings/**`（模态挂层）、flow `block342-svg-editor-live.cjs`（断言扩展）、`acceptance/block-343/`。**零触碰**：SimpleChat 会话主链（P3 仅经既有附件 API）、后端 core（除非 P2 执行者元数据真缺口需最小补，届时先声明）。

## P1 小项批（当前执行范围）

1. **选区浮动工具条**：画布选区上方浮条（复用 nodeActions 定位模式）：删除/复制/编辑文字（单选 text 时）/问 agent。动作与属性面板动作行同源（同一回调），不建第二逻辑。
2. **模态层补挂**：全仓排查 `position: fixed` + `z-index` < 10000 的既有模态（文件树对话框/settingsOverlay/会话侧对话框等），按 UI-668 契约挂 `data-petri-layer="modal"` + 必要时 `--petri-z-modal` 阶梯；模态内 fixed 浮层穿透点逐个实机核对。
3. **字体品牌表**：`svgEditorInspector.ts` 的 font-family options 从硬编码八字改接品牌字体表 token/常量（找 styles/custom.css 或 themes 既有字体清单为真源；无现成表则建 svg-editor 域内常量表并留注释）。
4. **style 简写可视化**：元素带 `style="..."` 时属性面板出「内联样式」区，逐属性 key/value 行编辑 → `set_style` op（白名单既有）；不猜测未声明的 CSS 简写展开。
5. **资产路径嵌入形态**：设计裁决点（入口 UX/显示改写/守卫）——随 P1 收口批问用户，裁决后本期实现或顺延 P3 后。

## P2 版本对比 + 历史面板

- 洋葱皮：修订卡点「对比」→ 该版与当前视图同 scale 叠加 + 透明度滑杆；退出回正常视图。
- 历史时间线：现 revisionCard 增强；执行者标注以 `.petri/svg-revisions/` 快照真实元数据为限（查证后定，无则如实 reopen）。

## P3 vision 判据附件通道

- 渲染回验 PNG → 会话附件（既有附件 API），判据 prompt 与图同发；模型看图回验真闭环。
- 附件 API 不适用处如实降档并留 reopen。

## 验收门禁与节奏

- 证据位置：`acceptance/block-343/`；完成语义：三 P 阶段各自收口笔录在案 + closeout 十三门 PASS → registry completed。
- flow `block342-svg-editor-live` 断言扩展（P1 目标 ≥57 / P2 ≥60 / P3 ≥62，以实际设计为准）。
- 每阶段：定向测试 + theme 17/17 + tsc 0 + lint 0 error + 实机 flow + 治理三件套 + 独立提交；UI 台账每增量同提交。
- 节奏：一次会话内三阶段串行推进（用户裁决「逐个进行直到完成」同款授权语义），每阶段完成即提交，全部收口后整包 completed 登记。
