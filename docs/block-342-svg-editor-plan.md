---
capability: block-342-svg-editor
status: active
goal: 受治理的 SVG 编辑器（内建画布，人在画布上鼠标键盘修正细节）+ agent `svg_edit` 工具——人与 agent 共用同一套操作词汇表改同一份单真值文件；span 改写引擎保证无改动零 diff 与改动局部性；propose/apply 修订快照 + before-hash 冲突检测保证「agent 提案 → 人修正 → agent 继续」互不覆盖；渲染回验闭环（BLOCK-340 帧→vision 管线）。路线 A（内建修正面板，用户裁决「更丝滑的体验 路线A」）。
acceptance:
  - W1 内核与直接操作（当前执行范围）：①span 改写引擎 `helpers/svg-ops.js`（零操作零 diff / 改动局部性 / before-hash 冲突 `svg_hash_mismatch` / 白名单 op 安全校验 / `sanitizeSvg` 脱敏），契约测试全绿；②`svg_edit` / `svg_inspect` agent 工具（白名单 op、propose/apply、修订快照与语义 diff=op 列表、路径守卫、白名单外 require-ack 走坡道）；③编辑器内核前端（viewerRegistry 登记 svg-editor 查看器 + 安全载入 + 画布缩放平移网格标尺 + 选择系统：点选/多选/框选/进组/悬停高亮/图层树 + 变换：拖拽/手柄/旋转/吸附智能参考线/数值面板/对齐分布/键盘微调 + 结构：组解组/层序/复制删除 + 撤销重做 op 逆栈 + 快捷键集 + Cmd+K 命令面板 + 写回 revision 链）；④实机（隔离栈离屏 flow：打开→选中→拖拽→改属性→保存→hash 变化→无改动打开保存零 diff）。
  - W2 文字与样式（后续波次，启动时细化）：画布行内文字编辑（多行 tspan 正确处理）、字体面板、填充描边取色器（吸管/透明度）、文档色板（提取现有颜色+一键全局替换）、线性/径向渐变编辑、样式复制粘贴、多选批量套样式、选区浮动工具条。
  - W3 形状与路径（后续波次，启动时细化）：绘制矩形/椭圆/线/折线/多边形/文字、路径节点编辑（节点/贝塞尔手柄/增删/角点平滑）、基础钢笔、拖入图片嵌入；布尔运算/位图描摹/文字转路径/PDF-EPS 导出走 Inkscape 无头 actions 协处理器（`inkscape-provider.js` 先例，缺席诚实灰掉，不内置不下载）。
  - W4 agent 协同（后续波次，启动时细化）：选区→composer 单一 ContextItem 通道问 agent；提案幽灵叠加层（半透明 ghost、变更元素高亮、逐元素接受/拒绝/手调后接受）；任意两版本画布对比（洋葱皮/高亮变更节点）；历史面板人+agent 同一时间线标注执行者；渲染回验（改→渲染→vision 判据→迭代，对齐 335 接口）。
  - 硬验收（全系列贯穿）：**无改动打开→保存必须字节零 diff**；科研出图类 SVG（matplotlib/ggplot/Illustrator 导出，含 `inkscape:`/`sodipodi:` 命名空间、clipPath、CDATA、实体）round-trip 保真；载入脱敏（script/foreignObject/on* 属性/javascript: href）。
reopen: 位图像素编辑（PNG/JPG 像素级修改，另立包）；Inkscape GUI 自动化（`computer_*` 通用路径已可达，不专用化）；CMYK/印刷流程；多人文档协作；canvas 类位图画板。
---

# BLOCK-342-SVG-EDITOR — 受治理 SVG 编辑器计划（母计划 · W1-W4 波次串行）

- 登记状态：**active（2026-11-03 启动；W1 为当前执行范围）**。用户裁决原话：①「SVG 编辑桥 可以的 不过我觉得你列举的能力不太够 我希望更丝滑的体验 路线A」；②「BLOCK-341 应该已经收口了 继续」=发令（对标 BLOCK-340「继续推进」=发令先例）。
- 队列位置：BLOCK-341（completed，2026-11-03 当日收口）之后；启动时无其他 active 工作包（`npm run state` 核实）。
- 唯一真相域：本文件（block-342-svg-editor）。W2-W4 启动时在本文件内细化各自 P 阶段，不另立第二份母计划。
- 完成语义：**全系列 completed = W1-W4 四波次各自收口笔录在案**；单波次收口只记「W#-COMPLETED」，registry 保持 active 直至 W4 收口。

## 1. 立项裁决与形态自检

- 用户 2026-11-03 连续三轮收敛设计：SVG 编辑能力 → 人机协同修正（「有时候 agent并不能达到预期 所以通过鼠标和键盘人为修正一些细节很重要」）→ 路线 A + 能力面扩容（「更丝滑的体验」）。
- 立项自检问句：差别形态 = ①单真值文件 + 修订快照与语义 diff（每步操作可回滚可审计）；②人与 agent 共改一份真值、before-hash 冲突检测保证人的修正天然不可被 agent 覆盖；③agent 提案可视化到逐元素接受（W4）；④渲染证据带 sha 可复核；⑤引擎/编辑器全本地不出机器。Inkscape 是手工 GUI 工具；本包是「带手工修正面的受治理 agent 作图链」——借 Inkscape 的快捷键惯例与交互范式（形），不长成第二个 GUI 编辑器（魂不变）。

## 2. 核心设计决定

1. **一套操作词汇表，两个驱动者**：人在画布上的每个动作与 agent 的 `svg_edit` 共用同一份 op schema（`set_attr` / `remove_attr` / `set_style` / `set_text` / `insert` / `remove` / `move`）。语义 diff = op 列表本身；修订快照、冲突检测、审计行全走同一条链。
2. **span 改写引擎（零新依赖）**：真值改写不解析→重序列化整份文档，而是对原始文本定位目标元素的字节区间、只改该区间（`helpers/svg-ops.js`）。硬不变量：零操作零 diff、改动局部性（目标 span 外逐字节相同）、对注释/CDATA/PI/实体/命名空间/引号风格/自闭合一概原样保留。前端编辑器 DOM 只是活视图，拖拽等手势在 DOM 上即时反馈、手势结束折算为 op 提交；保存后如 hash 与预期不符自动从真值重载对齐。
3. **定位器**：W1 支持 `{ id }` 与 `{ path: number[] }`（root 起元素子节点序号路径）——两端（浏览器 DOM / Node span 引擎）都可确定性解析，无需引入选择器引擎；CSS selector 定位留 W2+ 评估。
4. **安全模型**：SVG 可携带脚本。编辑器载入前 `sanitizeSvg`（剥 `<script>`/`<foreignObject>`/`on*` 属性/危险 href，其余字节不动）；引擎 op 层二次校验（`svg_unsafe_markup`）；预览渲染走沙箱上下文。
5. **冲突安全（人修正不可被覆盖）**：`applyOps(text, ops, { expectedSha })`；agent 的 propose 以 before-hash 为前提，人（或外部工具）改过 → `svg_hash_mismatch` → agent 必须基于新真值重新提案。人操作不需要审批（用户即权威），但同样落修订快照与 diff。
6. **Inkscape = 重几何协处理器（W3 起）**：布尔运算/描摹/文字转路径/PDF 导出不自造，走 Inkscape 无头 actions（复用 341 godot-provider 发现模式：`PETRI_INKSCAPE_BIN` + 常见路径，缺席诚实降级）；W1/W2 渲染回验基线用 Chromium（Electron 已在场）SVG→PNG，`magick` 兜底。

## 3. 红线

- 不建第二真值/第二执行器（真值=文件本身；修订快照走 322 artifact 修订链既有机制；Goal 走 335）；不引入画布框架（fabric/paper 会把真值从 SVG DOM 挪走，拒绝）；零新依赖（浏览器 DOMParser + 自研 span 引擎；W3 若确需 path 解析库，届时按 DEPENDENCY-CHANGE-CHECKLIST 用户裁决，默认不加）；不复刻 Inkscape GUI 全量（节点级深度编辑做到 W3 所列为止）；G1+ 不外推。

## 4. 文件面（W1）

- `core/petri-server/helpers/svg-ops.js`（新，span 引擎，子 Agent 委派实现）
- `core/petri-server/agent-tools/svg-tools.js` + `agent-tools/tool-defs/svg.js`（新）+ `agent-tools/registry.js` / `tool-metadata.js` / `tool-events.js` 注册与计数 pin
- 前端 `frontend/src/components/svg-editor/`（新目录）+ viewerRegistry 登记（`components/result-studio/resultSurface.ts` 唯一类型分派源）+ ChatArtifactCard「在编辑器打开」入口
- 测试 `test/block342-svg-ops.test.mjs`（新）+ 工具注册邻域 + 前端同目录组件测试；`test/impact-map.json` 登记
- 证据 `acceptance/block-342/`；UI 增量按纪律在交付提交同轮回写 `docs/ui-productization-audit.md`（UI-###）

## 5. W1 阶段与验收门禁（当前执行范围）

P0 形态/依赖/安全裁决（本文件 §2/§3 预答，用户「继续」=认可）→ P1 span 引擎 + 契约测试（子 Agent 委派，主 Agent 终审）→ P2 `svg_edit`/`svg_inspect` 工具注册全链 → P3 编辑器内核前端 → P4 实机 + UI 台账 → P5 closeout + registry/台账回写。

W1 收口门禁清单（收口时逐项对账）：
1. `node --test test/block342-svg-ops.test.mjs` 全绿（零操作零 diff / 局部性 / 冲突 / 安全校验 / 脱敏全覆盖）；
2. 工具注册邻域定向测试全绿（tool 计数 pin + prerouting + 决策平台 + skill visibility 同步）；
3. 编辑器组件定向测试全绿 + `theme-token-contract` 全绿 + tsc 0 + lint 0 error；
4. 隔离栈离屏实机 flow（9223 先例）：真实 SVG 打开→点选→拖拽→改属性→保存→文件 sha 变化→**无改动打开保存字节零 diff** 断言，证据落 `acceptance/block-342/`；
5. `npm run closeout` 十一门 PASS + `npm run docs:reconcile` + registry/roadmap/handoff/AUDIT-LOG 回写。

预期节奏：**分 P 阶段、多会话推进**（W1 体量 ≈ 341 的 1.5 倍）；W2-W4 各自启动登记后同模式推进。

## 6. 风险与前置

- 科研出图 SVG 结构极端（数千元素/深层嵌套/clipPath/span 引擎性能）：解析器线性一遍 + op 应用后重解析（正确性优先），>5MB 文件性能在 P4 实机如实登记，必要时加偏移修补优化（同包内）。
- 前端 contenteditable 在 SVG text 上不可靠：行内文字编辑用覆盖 HTML input 定位到元素bbox（W2），W1 不做文字编辑。
- 编辑器与 span 引擎两端视图漂移：保存后 hash 校验 + 不符即从真值重载；契约测试锁 op schema 双端可解析。
- 前置：无硬前置；W4 依赖 BLOCK-340 帧→vision（completed）与 335 闭环接口（completed）；viewerRegistry 依赖 BLOCK-334（completed）。

## 7. W1 执行进度（2026-11-03 会话）

**P1 span 引擎 COMPLETED**（`helpers/svg-ops.js`，682→约 800 行）：span 改写（零操作零 diff / 局部性 / `svg_hash_mismatch`）、`sanitizeSvg` 两级脱敏、`inspectSvg`、工具层不抛包装 `applyOpsSafe`。契约 `test/block342-svg-ops.test.mjs` **14/14**（首轮 13 红 → 终态全绿）。终审抓到并根修四处真缺陷：①`setAttrRaw` 替换区间 off-by-one（闭引号被重复，改写后文档不可解析）；②有子元素的容器 `textOnly` 从未置 false（`set_text` 会静默吞掉子结构）；③节点缺 `id`/`path` 便捷字段；④`insert` 的安全校验晚于形状校验（危险 markup 被报成形状错）。另加固：`script/style` 按 raw-text 元素跳过内部解析（CSS/JS 里的 `<` 不打断）；`sanitizeSvg` 改「原始文本层剥元素 → 解析层剥属性」，解析失败 fail-closed（不把未脱敏文本当已脱敏）。

**P2 工具面 COMPLETED**：`agent-tools/svg-tools.js`（propose/apply、`before_sha_required`、`svg_hash_mismatch` 带重新 propose 指引、零改动不写盘、审计快照 `.petri/svg-revisions/`）+ registry/metadata/events/tool-defs 注册 + `routes/svg.js` REST 面。契约 `test/block342-svg-tools.test.mjs` **8/8**；工具计数 112→**114**（四处 pin + `test/fixtures/tool-activity-labels.json` + `model-surface-baselines.json` 有意增长留痕）。**顺带清存量**：`scripts/model-surface-baseline.mjs` 注释声明 `--force` 但实现缺分支（契约漂移）已补；前端 `toolActivity` 动词/图标表缺 `read_video`/`godot_run`/`godot_scene_apply`/`model3d_blend_ops` 四条存量（BLOCK-340/341 遗留，该双端契约测试在 HEAD 即红）一并补齐。

**P3 编辑器内核 COMPLETED（代码面）**：`components/svg-editor/`（viewer/canvas/model/css）+ `lib/svgEditClient.ts` + `viewerRegistry` svg-editor 分派 + `WorkspaceFilePreview` 挂载。测试 `svgEditorModel.test.ts` 7 + `SvgEditorViewer.test.tsx` 3 + viewerRegistry 家族 47；`theme-token-contract` 17/17；tsc 0 / lint 0 error。

**P4 实机：未跑**（隔离栈离屏 flow 待下一步执行）；**P5 收口：`npm run closeout` 十三门 + `skills:check` 报级全 PASS**（`ca535f18` 主体；`bf5b7e7d` 修 quality:types 抓真的 mock 泛型、`097d11bd` 修 knip 抓真的死代码保留面）。registry 保持 active（W1 未含实机，不标 completed）。UI 台账 = **UI-661（in_progress）**，不冒 verified。

**收口抓真三处（门禁逐层剥出）**：①`quality:types` → 测试 mock 返回 `Promise<void>` 不接受 `mockResolvedValue` 载荷；②`quality:knip:check` → 11 处未消费导出（4 个尺度常量 / `isEditableTarget` / 未用 `removeOp` / 5 个 client 类型）；③`test:changed` → 工具宇宙 fixture 与前端动词表两侧脱节（`tool-activity-labels` 存量 4 缺 + 新增 2 件）。
