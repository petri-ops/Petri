---
capability: block-342-svg-editor
status: completed
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

- 登记状态：**completed（2026-11-03 当日收口）**。用户裁决原话：①「SVG 编辑桥 可以的 不过我觉得你列举的能力不太够 我希望更丝滑的体验 路线A」；②「BLOCK-341 应该已经收口了 继续」=发令；收口发令=「可以 按照你的建议开整 逐个进行直到完成」（2026-11-03）。完成对账：W1-W4 核心交付全绿（W1 15/15 → W2-W4 24/24 → 方案A+UI-668/669 31/31 → 七 reopen 切片 UI-670~676 至 53/53 allPass），closeout 十三门 PASS；§8-§9 reopen 七项全部交付或如实降档，剩余交接项已列 §10 归宿（不在 W1-W4 验收边界内，作为后续候选不阻塞 completed）。
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

**P4 实机 COMPLETED**：dev-verify `block342-svg-editor-live` → `acceptance/block-342/` **15/15 allPass** + png（9223 离屏，跑完即终止；样本自动清理）。实机抓真一处真缺陷并修=文件加载白名单漏 `svg-editor`（`status='unsupported'` 落二进制卡、编辑器不可达）。**P5 收口：`npm run closeout` 十三门 + `skills:check` 报级全 PASS**（`ca535f18` 主体；`bf5b7e7d` 修 quality:types 抓真的 mock 泛型、`097d11bd` 修 knip 抓真的死代码保留面）。**W1 COMPLETED**（P1-P5 全绿）；母计划 registry 仍 active（W2 文字与样式、W3 形状与路径、W4 agent 协同待启动）。UI 台账 = **UI-661（verified，dev Electron 边界内）**。

**收口抓真三处（门禁逐层剥出）**：①`quality:types` → 测试 mock 返回 `Promise<void>` 不接受 `mockResolvedValue` 载荷；②`quality:knip:check` → 11 处未消费导出（4 个尺度常量 / `isEditableTarget` / 未用 `removeOp` / 5 个 client 类型）；③`test:changed` → 工具宇宙 fixture 与前端动词表两侧脱节（`tool-activity-labels` 存量 4 缺 + 新增 2 件）。

## 8. W2-W4 交付切片与 reopen（2026-11-03 一次推完）

用户裁决「能一次性推完吗」→ 三波次各交付首个可验证切片并整链实机，剩余能力按 reopen 明确留档（不假装支持）。

**W2 文字与样式 — 交付**：属性面板 8 类可编辑项（fill/stroke/stroke-width/opacity/font-size/font-family/font-weight/text-anchor，空值即删属性）；文档色板（从 markup 纯文本提取实色、按出现次数降序、点色块填入选中）；多选批量套样式（同一属性改动逐目标生成 op）；样式复制/粘贴（快照→逐属性粘贴）；行内文字编辑（覆盖输入层，**多行 tspan 逐段可选**，不碰 tspan 的 x/y 布局）。**reopen**：选区浮动工具条（当前走右侧属性面板动作行）；~~渐变编辑（线性/径向 UI）~~ → **切片4 交付（2026-11-03，UI-673 verified，实机 46/46）**：线性/径向创建与应用 + 文档渐变列表 + stop 行内编辑（全单元素 op 序列合后端 insert 口径）；style 属性的可视化编辑（现按属性族而非 CSS 简写）；字体下拉从品牌字体表取值。

**W3 形状与路径 — 交付**：绘制工具四种（矩形/椭圆/直线/文字）——画布拖拽出框 → 白名单 `insert` op（过小框不出元素、文字转义）；绘制后自动回选择工具并提示保存。**reopen**：~~拖入图片嵌入~~ → **切片3 交付（2026-11-03，UI-672 verified，实机 42/42）**：本地文件 data: 内嵌（PNG/JPEG/GIF/WebP ≤2MB，SVG 与外链如实拒绝）+ 按钮与拖放双入口；~~布尔运算/位图描摹/文字转路径/PDF-EPS 导出经 Inkscape 无头协处理器~~ → **切片5 交付（2026-11-03，UI-674 verified，实机 48/48）**：探针 + 面板诚实灰化 + 受治理动作守卫（union/difference/intersection/text-to-path/export-pdf；写回走 before-sha + 审计快照）；**位图描摹仍 reopen**；真实动作执行链待装 Inkscape 后实机（装后即用，不冒 verified）。~~路径节点编辑（节点/贝塞尔手柄/增删/角点平滑）；基础钢笔~~ → **切片2 交付（2026-11-03，UI-671 verified，实机 40/40）**：节点显示/拖拽/手柄/加点/删点/平滑（M/L/H/V/C/Z 绝对命令，其余如实不可编辑）+ 钢笔点列/闭合/开口落定。

**W4 agent 协同 — 交付**：选区 → 会话（选中元素的标签/id/path/属性白名单值合成结构化引用，经**唯一** `copilotAsk` 通道进输入框，不建第二注入面；提示词指路 `svg_edit` 并声明「先说方案再 apply」）。**reopen**：提案幽灵叠加层（半透明 ghost + 逐元素接受/拒绝/手调后接受，需要 propose 返回 markup 而非仅 ops）；任意两版本画布对比（洋葱皮/高亮变更节点）；历史面板（人 + agent 同一时间线标注执行者，需读 `.petri/svg-revisions/` 快照）；渲染回验（改→渲染→vision 判据→迭代，复用 BLOCK-340 帧→vision 与 335 闭环接口）。

**实机证据（全链 24/24 allPass）**：`acceptance/block-342/block342-svg-editor-live-darwin.json` —— V2 挂载/图层/零改动禁用；V3/V4 点选 + 属性面板；V5 拖拽 `translate(48 24)`；V6 保存落盘 + 局部性；V7 重开零改动零 diff；**V9 属性面板改 fill=`#cc0000` 落盘**；**V10 文档色板提取 `#cc0000`**；**V11 矩形工具拖拽 → pending op → 保存后文件 2 个 `<rect>`**；**V12 选区 → `petri:copilot-ask` 载荷含文件路径/path/属性且指路 svg_edit**；V8 旧 sha 提案 409 `svg_hash_mismatch`。样本与实例跑完即清理。

**实机抓真（本批第二处真缺陷，已修）**：绘制坐标换算原用 `getScreenCTM()`——**离屏（show:false）窗口下 Chromium 返回 null**，绘制静默失效；改 `boundingRect + viewBox` 比例换算（与 CSS 缩放无关，比例法自动抵掉 scale）。

## 9. W4 reopen 第一项：逐元素取舍（2026-11-03 加映）

按 Jev 建议推进「提案幽灵叠加 + 逐元素接受」的第一刀，落地为**改动清单与逐元素撤销**（等价能力：接受=保留，拒绝=撤销该元素）：

- **后端**：`svg_edit` propose 返回 `previewMarkup`（内存返回、不落盘、不进第二真值；>1MB 截断并显式标注），供任何消费方做提案预览。
- **前端** `svgProposal.ts`：`diffElements(磁盘真值, 当前视图)` 逐元素识别 属性/文字/新增/删除 四类差异；`revertElementOps` 把单个差异折算成白名单 op（属性回填 before 值 / 新增属性 `remove_attr` / 新增元素 `remove` / 文字 `set_text`）；被删元素如实拒绝一键恢复（不伪造片段）；`revertAllOps` 汇总并统计跳过项；`summarizeChanges` 出列表标题摘要。
- **UI**：属性面板下方「未保存改动（逐元素取舍）」区块——列出改动 / 全部撤销 / 每行单项撤销 + kind 与前后值。
- **验证**：`svgProposal.test` **6/6**（四类差异、零改动空清单、恢复 op 形状、删除项如实拒绝、汇总跳过计数、解析失败不猜）；`tsc` 0；lint 0 error。
- **实机状态（如实·两轮尝试未通）**：①第一轮用加载快照 `baseMarkup` 作基线 → 实机「列出改动」空清单；②第二轮改为**现读磁盘**（`cache:no-store` + 重新脱敏）并对比 `serializeRoot(view)` → **仍为空**，说明问题在 `diffElements(磁盘文本, 视图序列化)` 这一对输入的可比性（DOM 序列化形态 vs 解析器期望），不在基线来源。两轮均从 flow 回退（未验行为不计入通过），UI-663 保持 `in_progress`。
- **下一步（已定方向，未实施）**：改动清单改由 `pendingOps` 直接生成（op 列表本就是语义 diff，无需反序列化视图）；撤销一项 = 从 pendingOps 移除该组 → 以磁盘文本重建视图再按序应用剩余 op。这样既避开 DOM 序列化可比性问题，也与「语义 diff = op 列表」的原始设计一致。
- **reopen（承接）**：①agent 提案进入编辑器的 **chat 派发侧接线**（事件协议 `petri:svg-proposal` 已定型，编辑器侧全链 UI-675 verified；通用工具结果渲染链接线单独切片）；②版本对比（洋葱皮）与历史面板（人+agent 同一时间线）；③渲染回验的 **vision 判据**（快照图片进会话需附件通道；结构回验已交付 UI-676 verified）。

### §9.3 渲染回验（2026-11-03 切片7 → UI-676 verified）

「回验」按钮 → 当前视图按 viewBox 等比渲染 PNG 快照（Blob→Image→离屏 canvas，最长边 ≤1024；画布污染/解码失败如实报错）→ 浮条预览 → 「请 agent 回验」copilotAsk 注入判据 prompt（路径 + 待保存 op 摘要 + 结构回验判据，指路 svg_inspect/svg_edit）。vision 判据（看图）如实 reopen 待附件通道。flow 两断言，总 53/53 allPass。

### §9.2 提案幽灵叠加（2026-11-03 切片6 → UI-675 verified）

编辑器侧全链：订阅 `petri:svg-proposal`（path 匹配 + 形态校验）→ previewMarkup 半透明 ghost 与画布同 scale 叠加 → 提案浮条按 **op 序列即语义 diff** 逐项列出（opLabel 复用）→ 逐项「接受」（单 op commit）/「全部接受」（一次 commit）/「拒绝」（整单清除）。不做 markup 反序列化比对（两轮空清单根因，见 §9）。flow 合成事件实机三断言，总 51/51 allPass。

### §9.1 UI-663 收口（2026-11-03，pendingOps 方向落地 → UI-670 verified）

按「已定方向」实施：清单由 `pendingOps` + history opsLen 快照直接切组（新 `svgChangeList.ts`，语义 diff = op 列表本身，不再反序列化比对）；撤销一组 = 移除组 → 磁盘真值重建视图 → 按序回放剩余（快照栈如实清空）。UI `<details>` 默认收起、行级「撤销」+「全部撤销」，样式全复用旧类零新增。测试 6/6 + 前端 40/40 + theme 17/17 + tsc 0 + lint 0 + 实机 flow **35/35 allPass**（V9e 四断言：出组/标签/单项撤销回磁盘真值）。flow 修正一处误报（撤销等待改终态门轮询）。UI-663 **in_progress → verified（UI-670）**。

## 10. 用户核查反馈批（2026-11-03）：即时渲染修复 + 能力扩容

**反馈一：切换颜色不能实时渲染** → 根因确认=`commit()` 只 `setMarkup(nextMarkup)` 而**不把 op 落到活视图**；`nextMarkup` 又由 `currentMarkup()`（当前 DOM 序列化，尚未应用）产生 ⇒ 属性改动/绘制在视图上无变化，只有保存后由后端 span 引擎写入才生效（拖拽之所以即时，是因为 Canvas 自己先改了 DOM）。**修法**=commit 先 `applyOpsToDom(root, ops)`（set_attr/remove_attr/set_style/set_text/remove/insert/move 全族落地），再从 DOM 序列化作为新 markup。实机断言 `V9b2_fill_live_rendered`（**未保存时**元素 fill 已是新值）**PASS**。

**反馈二：功能偏少** → 本批扩容（均在属性面板/工具栏，零新依赖）：
- **多选对齐 6 种**（左/水平居中/右/顶/垂直居中/底）：按整体包围盒算位移，只改 `transform`（不动几何定义；已就位元素不出 op）。
- **字体下拉**：`font-family` 由自由文本改常用字体选择（Helvetica/Arial/Times New Roman/Courier New/Georgia/Verdana/sans-serif/serif），避免手打拼错。
- **适应窗口**：按 viewBox 与容器宽度定缩放（不改文档）。

**验证**：契约 26/26（新增 alignOps 三条：位移量/已就位不出 op/单元素不出 op）；`tsc` 0；`lint` 0 error；实机 **25/25 allPass**。

**仍在 reopen**（不假装支持）：路径节点编辑/钢笔、图片嵌入、渐变编辑、Inkscape 协处理器、提案幽灵叠加、版本对比/历史面板、渲染回验、改动清单（UI-663 空清单未定位）。

## 11. 交互设计批（2026-11-03 用户要求）：分区折叠 + 预览/确认状态区分

**空间策略（用户裁决 2026-11-03：「默认应该就收起来，而不是窗口不动占空间」+「图层栏也要能折叠」）**：
- **默认全收起**：工具栏（只留「工具 «」）、**图层栏**（46px 竖排标题「图层（N）」+ `»`）、**图形属性**（46px 竖排标题 + `»`）、文档色板、未保存改动（details）—— 打开文件即最大画布。
- **按需占用**：点 `»` 展开对应栏（图层 200px / 属性 240px）；**选中元素时属性栏自动展开**（用户已明确要改它），点空白不反复收缩。
- **文档色板 / 未保存改动**：`<details>` 默认收起，点摘要展开。
- 布局：grid 三列按展开态切换（`46px | 1fr | 46px` ↔ `200px | 1fr | 240px` 的组合），收起态标题竖排（writing-mode）保证 46px 可读；折叠不改变画布缩放与选中态。

**颜色等改动的生效机制（实时预览 ≠ 已确认）**：
1. **实时预览**：任何属性/形状/文字改动立即落到活视图（`commit` 内 `applyOpsToDom`），元素视觉即刻变化，但**磁盘文件不变**、`pendingOps` 累加。
2. **状态区分**：头部状态条按 `data-state` 三态——
   - `dirty`（黄）`● 未保存 N 项改动 · 实时预览中，⌘S 确认写盘`
   - `saving`（灰）`保存中…`
   - `saved`（绿）`✓ 已保存 · <sha 前 8 位>`
3. **确认提交**：点「保存」/⌘S 才把 `pendingOps` 交后端 span 引擎写盘（带 before-hash 冲突检测）；成功后重新载入、`pendingOps` 清零、状态条转 `saved`，notice 显示「已保存：N 个操作（after …）」。
4. **不产生未确认堆积**：保存失败（如外部改动 `svg_hash_mismatch`）保留改动并显式报错，不静默丢弃；关闭/切换文件前用户可据状态条判断是否有未确认改动。

**实机证据**：`acceptance/block-342/` **28/28 allPass**，含 `V2d_panels_default_collapsed`（色板/改动默认收起、工具组展开、收起按钮在场）、`V9b3_status_dirty_preview`（改色后 dirty + 文案含「未保存/确认」）、`V9d_status_saved_after_commit`（保存后 saved + sha）。


## 12. 产品级视觉精修批（2026-11-03 用户要求）

按 `petri-css-theme` 规则做**编辑器面板**的视觉统一（不越包改全站）：
- **字号层级**：全部走 `--petri-font-size-body`（小字号棘轮冻结，禁用 xs/sm；层级靠**字重 600 + 字距 0.02em + 文字色三级**区分——面板标题 / 正文 / 元信息）。
- **间距节奏**：面板 padding 10、块间 gap 8、标题底 6 + `--petri-divider` 分隔线；属性行 `68px | 1fr` 定宽标签列，控件同高（min-height 28）并**强制拉伸**（下拉曾偏窄，截图过目后修）。
- **圆角与配色**：统一 `--petri-radius-sm/md`；hover 用 `--petri-hover`（不再「只描边」），激活/选中用 `--petri-accent-bg` + `--petri-accent-border`；色块悬停 scale(1.12)。
- **过渡**：按钮/输入/下拉/图层行/色块/命令项统一 `var(--petri-duration-fast) var(--petri-ease-standard)`；全局 reduced-motion 兜底生效（不新增字面量时长——motion 棘轮会咬）。
- **细节**：sha 用 `tabular-nums` 不跳格；path/属性差异用 `--petri-font-mono`；画布留白 12px；收起列宽 46→54px 让竖排标题整行可读。
- **门禁**：`theme-token-contract` **17/17**（含小字号棘轮、motion 棘轮、1px 语义边、按钮清单四条均绿）；实机 28/28 无功能回归；截图过目（`acceptance/block-342/*.png`）后补了两处（控件等宽、画布留白）。


## 13. 抽屉式面板与按需展示（2026-11-03 截图反馈批）

用户截图指出：竖排窄条（图层/图形属性）占位且难读、工具条常驻一行、`<title>` 弹原生 tooltip 干扰。改为**零占位 + 按需覆盖**：

- **左右面板零占位**：`.body` 单列，画布独占整宽；面板改为 `position:absolute` **覆盖式抽屉**（236px + 阴影 + 圆角），展开不挤压画布、收起 `display:none` 完全退场。
- **触发靠画布角落小胶囊**：左下「图层」、右上「属性」，点开即抽屉，抽屉头部 `»` 收起——**无需学习**：看得见名字、点一下就有、再点就收。
- **工具条改浮条**：默认只露「工具」胶囊（左上），点开就地展开一排工具（不再常驻一行高度）；`white-space:nowrap` 防竖排堆叠。
- **脱敏提示移出可折叠区**：安全信息常驻画布顶部（`视图已脱敏 N 处`），不再被图层折叠藏起来。
- **抑制原生 tooltip**：视图渲染时清空 `<title>` 文本（真值不动、op 不涉及 title），hover 不再弹出盖住画布的文件标题。
- **实机**：28/28 allPass（截图过目两轮：修工具条换行与胶囊定位；另抓真一处 flow 竞态——样本目录在 finally 自删导致连续两跑互删 ENOENT，改为留盘 + impact-map 忽略规则）。

## 14. 方案 A 收口批：modal 层级 + 272 列宽 + flow 适配（2026-11-03，UI-668/669）

83e004a1（右栏缩略卡 + 整窗编辑器 modal）落地时遗留三处未跟水面，本轮收口：

- **flow 未适配（抓真）**：flow 仍直接断言编辑器挂载，实机 2/3 V2 红；工作区未提交的 27/27 证据系 modal 落地前产物（时间线：证据 14:29 < flow 提交 14:30 < 方案 A 15:40），与 HEAD 失配。补五腿后实机 **31/31 allPass**（V1b 缩略卡形态/入口点击/V4b 272 列宽/V7 重开/V13 关闭退场）。
- **272 列宽根因（行级定位，不再"下轮专项"）**：属性栏 aside 嵌在 leftCol 内而非 body 直接子层，`grid-column:2` 被 leftCol 两列 grid 解释 → 落历史卡同位（644）。搬出后实机量宽 272 ✓；删 layout css 末尾补丁规则（冗余）。→ **UI-669**
- **面板常挂载恢复**：方案 A 把图层/属性 aside 改条件渲染（收起即卸载），与 layout css display:none 收起设计、V2d dataset.open 契约矛盾（83e004a1 还弄丢了 data-open 属性）。恢复常挂载 + data-open，收起形态不变。→ **UI-669**
- **同批并行修复（UI-668，独立 probe 13/13）**：整窗预览被困在右栏 tab/keep-alive 容器 z-index≈1 下（会话输入框/导轨/滚动条/列接缝穿透、编辑器头部被盖）——去两处困层 z-index、模态改 `--petri-z-modal` 全局阶梯、modal 根挂 `data-petri-layer="modal"` 时列接缝让位、`.expanded` 在 layout 单一真源内改「填满宿主」去第二层 fixed。台账见 ui-productization-audit UI-668（`scripts/ui668-modal-layer-live.cjs` + `acceptance/ui-668/`）。
- **V2d 默认态契约演进**：色板默认展开（2114afa8）、未保存改动区块移除（5c172066；svgProposal 契约保留，UI-663 pendingOps 方向重建时再更新断言）。
- **门禁**：契约 22/22 + svg-editor 前端 34/34 + WorkspaceFilePreview 8/8 + theme 17/17 + tsc 0 + lint 0 error。

reopen 不变：路径节点编辑/钢笔、图片嵌入、渐变编辑、Inkscape 协处理器、提案幽灵叠加、渲染回验、改动清单（UI-663，pendingOps 方向）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 10. 收口归宿（2026-11-03 completed；交接项去向）

**已交付**：W1 受治理编辑内核 + W2 属性/色板/样式 + W3 绘制 + W4 选区进会话 + 方案 A（modal）+ 七 reopen 切片（UI-670 改动清单 / 671 路径节点+钢笔 / 672 图片嵌入 / 673 渐变 / 674 Inkscape 探针+守卫 / 675 提案幽灵 / 676 渲染回验）；UI-661~676 全 verified；flow `block342-svg-editor-live` 53/53。

**交接项（不在本包验收边界内，按需另行立项）**：
1. chat 派发侧接线——`petri:svg-proposal` 协议已定型、编辑器侧全链 verified；剩「svg_edit 结果面 → 派发事件」需动通用工具结果渲染链（SimpleChat 邻域，单独切片）。
2. vision 判据附件通道——渲染回验的看图判据需附件进会话（涉 BLOCK-225 D4 附件面）。
3. 位图描摹——Inkscape 动作之一，本机未装（装后即用，探针/守卫已就位）。
4. 版本对比（洋葱皮）+ 历史面板（人+agent 同一时间线，读 .petri/svg-revisions/）。
5. 小项：选区浮动工具条 / style CSS 简写可视化编辑 / 字体下拉品牌字体表 / 图片嵌入资产路径形态 / 其余模态挂 data-petri-layer。

G0 开发期常态 · 不外推 packaged/Provider/GA。
