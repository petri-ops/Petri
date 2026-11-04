# 审计广播台历史归档 · through 2026-11-03

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-03（🔵 **BLOCK-335 自优化闭环启动登记（active；用户发令+首批题采纳 lint 收缩）**：撞裁决点①已由 336 关闭；插入点=决策瀑布纯函数化+验证器投票。P1 基座先行→P0→P2→P3→P4→P5。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-337 治理运行时化整包 COMPLETED（第二批 P2/P3/P4/P5/P6/P7③）**：P2 workspacePath 只认 projects 表派生值；P3 docs:check 并行契约门替代单包硬门；P4 workflow 第七原语 closeout；P5 落账草稿（全绿才渲染）；P7③ 观察桥 misfire→observe 降级；**P6 实机 35/35**（四类工作区互不泄漏/伪造路径缺席/收口落账对账）；rider 修复 /api/ai/chat 头序缺陷。门禁=契约 23/23+邻域 32/32+实机 35/35。队列=335（已收口）。详情 plan §3.1。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T01:47:32.919Z -->
最后更新：2026-11-03（✅ **BLOCK-335 首批题真跑——lint 收缩 7 条基线 311→304 closeout PASS**：worktree+锚点→清偿→verify→回灌；🔴 事故=未提交文件被未知机制回退+5 个悬空 stash（详见待处理项）。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-335 自优化闭环整包 COMPLETED（P0-P5 当日收口）**：P0 验证器投票（自报 complete 须结构化验证背书，红→retry≤2→block）；P1 verify-host（两步防假绿）+checkpoint-host+薄 REST+workflow verify/checkpoint 原语；P2 self-optimize 脚本；P3 worktree 自指生产路径；**P4 实机 17/17**（绿保留/红回滚树零 diff）；P5 observe 护航落账。门禁=契约 8/8+邻域 250/250。首批题已真跑见上。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T03:13:48.181Z -->
最后更新：2026-11-03（✅ **BLOCK-335 lint 任务线第二片——require-await 测试域 69 条清偿（基线 293→234）**：codemod 机械变换（Promise.resolve 包裹保类型）+27 处逐型手工；vitest 69/69 全绿+types 0+closeout PASS（6639f97a+8ce6ca01）。抓真三处：satisfies 谓词位置/act 同步重载 await-thenable/worktree type-aware 伪影（前端 lint 权威判定在主仓）。任务线余量=尾批 ~40 条+react-hooks ~100 条+未覆盖 ~2100。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-335 reopen P7 完成——verify kind lint + needs_restart 闭环语义 + src/core 域 16 条收缩（基线 304→293）**：verify 增第三 kind lint（--report 改动域 + scoped eslint 只跑改动文件）；needs_restart 三态（ready+restartRequired 保留不回滚留人工）；闭环实跑：worktree+锚点→16 条码点化修复→verify lint ready（5.3s，restartRequired 如实）→回灌→lint 0 error+test:changed 752 全绿+closeout PASS（66acd02d+75f688b8）。抓真三处：worktree 不认 --no-suppressions 旗标；修复后基线留未使用条目 lint exit 2 如实暴露；worktree 全仓 lint 40 个 type-aware 伪影→scoped 设计成立。task line 下一批=require-await 测试域 ~150 条（待发令）。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（🔵 **BLOCK-335 reopen（P7 lint 任务线）——用户发令**：verify 增 kind lint + needs_restart 闭环语义 + src/core 16 条真跑。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T03:47:02.194Z -->
最后更新：2026-11-03（✅ **BLOCK-335 lint 任务线第三批——require-await 尾批 50 条清偿（24 文件，基线 293→187）**：消费面分诊（await 消费去 async / .then 消费 Promise.resolve 包裹——实测去 async 即崩 fetch(...).then）；vitest 24 文件 0 fail+types 0+closeout PASS（b4227a93）。任务线累计 311→187（-40%）；余=react-hooks ~100 条独立线。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T04:04:09.932Z -->
最后更新：2026-11-03（✅ **BLOCK-335 lint 任务线收口——react-hooks 域 defer（基线保留 + 有机清偿）**：普查 235 条/97 文件（set-state-in-effect 91/exhaustive-deps 83 基线外/refs 35）——非机械可修（修复需引入新抽象=重构，vitest 覆盖不足组件风险高）；策略=基线保留作已知债注册表+组件被触碰时顺带修复。任务线最终账目=基线 311→187（-40%）：require-await 域清零 124 条+src/core 16 条+首批 7 条。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T05:09:24.034Z -->
最后更新：2026-11-03（🔵 **BLOCK-340 视频输入面启动登记（active；用户连续五回「继续按照你的建议推进」=发令）**：队列头（335 完成后、341 之前）；plan §4 P0-P3 四阶段；ffmpeg 复用 329 发现模式零新依赖；read_video 工具+聊天附件 video 门控+帧预算入 model-surface 基线。P0-P2 实施+P3 实机目标=当日收口。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T05:21:03.003Z -->
最后更新：2026-11-03（✅ **BLOCK-340 视频输入面整包 COMPLETED（P0-P3 立项当日收口）**：video-frames 抽帧 helper（ffmpeg 复用 329 零新依赖；缺席诚实降级；帧预算 8/16 双策略；幂等缓存）；read_video 工具全注册（vision 域 readOnly）；附件面 video 门控同源（无 vision 诚实阻断）；契约 9/9+实机 10/10（真 ffmpeg 抽帧+幂等缓存+路径守卫）。抓真两处：ffmpeg 7.x -vsync 退役；工具计数 108→109 四处 pin+model-surface 有意增长留痕。设计修正=前端不抽帧（避免与 read_video 双路径违红线）。队列下一包=BLOCK-341 引擎桥（planned，需发令）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T05:26:09.442Z -->
最后更新：2026-11-03（🔵 **BLOCK-341 引擎桥启动登记（active；用户「确认 一次性搞完 不用再问」=发令）**：Godot 4.7.1 已在本机（homebrew+App 双份）；P0 形态裁决按 plan 预答钉死、P5 边界按预答执行（.blend=外部资产不破 322 单真值）；执行序 P1 探针→P2 godot_run→P3 scene_apply→P4 闭环样例→P5 Blender 扩档→P6 契约+实机；截图序列走 340 帧→vision 管线。目标当日收口。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T05:30:07.286Z -->
最后更新：2026-11-03（✅ **BLOCK-341 引擎桥整包 COMPLETED（P0-P6 立项当日收口）**：godot-provider 探针（4.7.1 双安装路径发现；缺席诚实）；godot_run（--write-movie PNG 序列+--quit-after+manifest 落 .petri/godot-runs/；**探针抓真 headless 无渲染→默认带显示驱动**）；godot_scene_apply（propose/apply 白名单三操作+sha+语义 diff+stale 防覆盖）；P4 闭环样例实机 13/13（真 Godot 30 帧+30 截图+scene_apply 全链）；P5 Blender 扩档 model3d_blend_ops（inspect/transform 语义自检 loc=[2,0,0]/render 真出图；.blend=外部资产不破 322）。契约 14/14+工具计数 109→112+model-surface +2230 留痕。抓真三处：headless 无渲染/-vsync 后代 -fps_mode/--python-expr 不自动保存。队列：全部 planned 包已清。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T05:33:51.907Z -->
最后更新：2026-11-03（🔵 **BLOCK-342 SVG 编辑器启动登记（active；用户裁决「更丝滑的体验 路线A」→「BLOCK-341 应该已经收口了 继续」=发令，对标 340「继续推进」先例；341 已当日收口 completed）**：受治理 SVG 编辑器母计划 W1-W4 波次串行——人与 agent 共用同一套操作词汇表改同一份单真值文件。W1 执行范围=span 改写引擎（零操作零 diff/改动局部性/hash 冲突 `svg_hash_mismatch`/安全校验/脱敏，零新依赖，子 Agent 委派实现主 Agent 终审）+ `svg_edit`/`svg_inspect` 工具（白名单 op/propose-apply/修订快照）+ 编辑器内核（画布/选择/变换吸附/图层树/撤销/快捷键，viewerRegistry 登记）+ 隔离栈离屏实机。红线=零新依赖/不建第二真值/不复刻 Inkscape GUI/位图像素编辑另立 reopen；W2-W4 启动时在本 plan 内细化。W1 分 P 阶段多会话推进。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T05:39:47.589Z -->
最后更新：2026-11-03（✅ **BLOCK-342 W1 COMPLETED（P1-P5 全绿；实机 15/15）**：P4 隔离栈离屏实机 `block342-svg-editor-live` **15/15 allPass**（挂载/点选/拖拽 translate(48 24)/保存落盘 sha 变化+局部性/重开零改动零 diff/旧 sha 提案 409 `svg_hash_mismatch`），证据 `acceptance/block-342/`（JSON+png，跑完即终止实例、样本自动清理）；**实机抓真一处真缺陷已修**=文件加载白名单只认 text/csv/json/markdown，`svg-editor` 漏判致 `status='unsupported'` 落二进制卡、编辑器结构性不可达。UI-661 **verified**（dev Electron 边界内）。母计划仍 active（W2/W3/W4 待启动）。此前的 P1-P3 记录：：①span 引擎 `helpers/svg-ops.js` 契约 **14/14**（首轮 13 红→绿），终审根修四处真缺陷=setAttrRaw 替换区间 off-by-one（闭引号重复致改写后不可解析）/ 容器 `textOnly` 未置 false（set_text 会静默吞子结构）/ 节点缺 path·id / insert 安全校验晚于形状；另加固 script·style raw-text 跳过 + sanitize 两级剥离。②工具面 `svg_inspect`/`svg_edit` 契约 **8/8**（propose/apply、`before_sha_required`、`svg_hash_mismatch` 不覆盖人的修正、零改动不写盘、审计快照 `.petri/svg-revisions/`）+ REST `POST /api/svg/{inspect,edit}`（与 agent 同一套实现）；工具计数 112→**114**（四处 pin + fixture + model-surface 有意增长留痕）。③编辑器前端（画布/选择/拖拽/图层树/撤销/保存/Cmd+K）+ viewerRegistry `svg-editor` 分派（plot svg 仍图片）+ WorkspaceFilePreview 挂载；前端定向 57/57 + theme 17/17 + tsc 0 + lint 0 error。**顺带清存量**=model-surface `--force` 契约漂移（注释声明未实现）+ 前端动词表缺 read_video/godot×2/blend_ops 四条（HEAD 即红）。UI-661 in_progress（实机未跑不冒 verified）。**closeout 十三门 + skills:check 报级全 PASS**（`ca535f18` 主体；收口抓真三处已修：types 的 mock 泛型 / knip 的 11 处死代码保留面 / fixture 与前端动词表脱节）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T10:33:20.259Z -->
最后更新：2026-11-03（🟡 **BLOCK-342 W4 逐元素取舍：第二轮尝试仍空清单（如实收口，UI-663 保持 in_progress）**：把基线从「加载快照」改为「现读磁盘（cache:no-store）+ 重新脱敏」并对比视图序列化——实机仍空 → 定位于 `diffElements(磁盘文本, 视图序列化)` 的**输入可比性**（非基线来源）。两轮实机腿均已从 flow 回退（未验不计入通过），主链 24/24 保持绿。**下一步方向已定**=清单改由 `pendingOps` 生成（op 列表本就是语义 diff，避开反序列化），撤销=移除该组 op 后从磁盘重建视图再按序应用剩余。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（🟡 **BLOCK-342 W4 reopen 第一刀：逐元素取舍（in_progress）**：后端 propose 增 `previewMarkup`（内存返回不落盘）；前端 `svgProposal` 逐元素 diff 四类差异 + 反向白名单 op（被删元素如实拒绝）；UI「未保存改动」区块（列出/单项撤销/全部撤销）。代码面契约 6/6 + tsc 0 + lint 0；**实机链「列出改动」返回空清单未定位** → UI-663 in_progress，不冒 verified，实机腿已从 flow 回退。主链实机仍 24/24（绘制腿加重试加固：离屏首帧时序）。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 W2-W4 交付切片完成（整链实机 24/24 allPass）**：W2 属性面板 8 类/文档色板/批量套样式/样式复制粘贴/多行 tspan 行内文字；W3 绘制矩形·椭圆·直线·文字（拖拽 → 白名单 insert）；W4 选区 → 唯一 `copilotAsk` 通道（结构化引用含 path/属性，指路 svg_edit 先说方案）。**实机抓真第二处真缺陷并修**=绘制坐标用 `getScreenCTM()` 在离屏窗口返回 null → 绘制静默失效，改 `boundingRect + viewBox` 比例换算。证据 `acceptance/block-342/`（24/24 + png，实例与样本跑完即清理）。UI-662 verified。**reopen 逐项留档**=选区浮动条/渐变/路径节点·钢笔/图片嵌入/Inkscape 协处理器/提案幽灵与逐元素接受/版本对比·历史面板/渲染回验（plan §8）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T11:26:44.624Z -->
最后更新：2026-11-03（✅ **BLOCK-342 产品级视觉精修（编辑器面板；theme 17/17 + 实机 28/28）**：字号统一 body（小字号棘轮禁 xs/sm），层级靠字重 600 + 字距 + 文字色三级；间距 10/8/6 节奏 + divider；属性行定宽标签列、控件等高并强制拉伸；圆角 radius 阶梯；hover `--petri-hover` / 激活 accent 底+边；过渡统一 duration-fast + ease-standard（motion token，reduced-motion 兜底）；sha 等宽数字、path mono、画布留白 12、收起列宽 54。截图过目后补两处（控件等宽、画布留白）。UI-666 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 折叠默认态修正（用户第二轮裁决）+ 图层栏可折叠（实机 28/28）**：默认**全收起**——工具栏只剩「工具 «」、图层栏与图形属性各收成 46px 竖排标题条（writing-mode）、色板/改动 details 收起，打开文件即最大画布；点 `»` 恢复 200/240px，**选中元素时属性栏自动展开**；grid 列宽按展开态组合切换。实机 `V2d` 断言 layers/inspector/toolGroup 三处 `data-open=0` + 展开按钮在场，28/28 allPass；契约 26/26 + lint 0 error。UI-665 已更新。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 交互设计批：分区折叠 + 预览/确认状态区分（实机 28/28）**：工具栏「工具 »」可收；「图形属性」默认展开、右栏 `»` 整栏收起（画布变宽）；「文档色板」「未保存改动」默认折叠（details）。状态条三态=黄「● 未保存 N 项改动 · 实时预览中，⌘S 确认写盘」/灰「保存中…」/绿「✓ 已保存 · sha」——实时预览只改活视图，保存才提交（before-hash 冲突检测），避免未确认堆积。契约 26/26 + theme 17/17 + 实机 28/28（V2d/V9b3/V9d）；UI-665 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 用户核查反馈批：即时渲染真缺陷已修 + 能力扩容（实机 25/25）**：①**根因**=`commit()` 只 setMarkup 不落活视图，而 nextMarkup 取自未应用的 DOM ⇒ 改色/绘制要保存后才可见（拖拽即时是因为 Canvas 自己改了 DOM）；修法=commit 先 `applyOpsToDom`（op 全族）再序列化，实机 `V9b2_fill_live_rendered` PASS。②扩容=多选对齐 6 种（只改 transform）+ 字体下拉 + 适应窗口。契约 26/26 + tsc 0 + lint 0 + 实机 25/25；UI-664 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T12:23:35.220Z -->
最后更新：2026-11-03（✅ **BLOCK-342 UI-663 收口：改动清单按 pendingOps 重建（UI-670；实机 35/35）**：清单改由 pendingOps + history opsLen 快照直接切组（svgChangeList.ts 纯函数，语义 diff = op 列表本身，绕开反序列化可比性根因）；撤销一组 = 移除组 → 磁盘真值重建视图 → 按序回放剩余（快照栈如实清空）；`<details>` 默认收起 + 行级撤销/全部撤销，样式零新增。svgProposal 契约 6/6 原样保留供提案幽灵复用。测试 6/6 + 前端 40/40 + theme 17/17 + tsc 0 + lint 0；flow V9e 四断言全过。flow 修正一处误报（撤销等待改终态门轮询）。UI-663 **in_progress → verified**。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 方案 A 收口批：modal 层级（UI-668）+ 272 列宽/常挂载/flow 适配（UI-669；实机 31/31）**：①抓真 HEAD flow 未适配 modal 方案 A（直接断言挂载 2/3 红、未提交 27/27 证据系落地前产物失配）→ 补缩略卡形态/入口点击/272 量宽/重开/关闭五腿回绿；②272 列宽根因行级定位=属性栏 aside 误嵌 leftCol（grid-column:2 被两列 grid 解释成 644 同历史卡位）→ 搬出后实机量宽 272 ✓ 并删冗余补丁规则；③图层/属性 aside 恢复常挂载+data-open（条件卸载与 display:none 收起设计及 V2d 契约矛盾）；④同批 UI-668（独立 probe 13/13）：整窗预览困于 tab/keep-alive z≈1 → 去困层 z、模态走 --petri-z-modal、data-petri-layer="modal" 接缝让位、.expanded 改填满宿主；⑤V2d 契约跟随产品裁决（色板默认展开 2114afa8、未保存改动区块移除 5c172066）。契约 22/22 + theme 17/17 + tsc 0 + lint 0 error。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-03T23:48:10.708Z -->
最后更新：2026-11-03（✅ **BLOCK-342 切片3：图片嵌入（UI-672；实机 42/42）**：本地文件 data:image/(png|jpeg|gif|webp) ≤2MB 内嵌，SVG 显式拒（脱敏走私面）、外链不提供（本地主权）；前端形态守卫只生成安全值，后端零改动；工具栏按钮 + 画布拖放双入口，自然尺寸适配 [64,320]。测试 6/6 + 前端 53/53 + tsc 0 + lint 0；flow V16 两断言（画布插入/落盘含完整 base64）。flow 修正一处正则字面量不插值误报。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 切片2：路径节点编辑 + 基础钢笔（UI-671；实机 40/40）**：节点工具=单选 path 出锚点/贝塞尔手柄 overlay，拖拽 live 改 d、pointerup 落单个 set_attr op（keepSelection）；加点（L 中点/C de Casteljau 一分为二）/删点（C 并出段为单 C，退化如实拒）/平滑（出手柄镜像保原长）；钢笔=点列虚线预览、回首点闭合、Enter 开口、Esc 取消，insert op 落定回选择。后端零改动（insert 收原始 markup）。实机抓真两处：合成指针 setPointerCapture 抛 NotFoundError 挡 drag 赋值（先落状态再 try/catch）；同 tick 连击 setState 旧闭包（penPoints ref 镜像）；修 flow dragRef 泄漏（pointerup 改发 host）。测试 15/15 + 前端 47/47 + theme 17/17（accent +5 选中态把手登记）+ tsc 0 + lint 0 error（overlay 渲染期 DOM 读取豁免入库）。G0 开发期常态 · 不外推 packaged/Provider/GA。）

<!-- audit-log-compact.mjs 追加 @ 2026-11-04T00:17:03.728Z -->
最后更新：2026-11-03（✅ **BLOCK-342 切片5：Inkscape 协处理器（UI-674；实机 48/48）**：探针（env PETRI_INKSCAPE_BIN 优先+常见路径，只查 X_OK）+ 面板诚实灰化（缺席提示+动作按钮不渲染）+ 受治理动作守卫（union/difference/intersection/text-to-path/export-pdf；临时产物 before-sha 守卫 + 审计快照写回，不绕过治理；缺席 503 inkscape_unavailable，工具层探针前置零 DB）。位图描摹仍 reopen；真实执行链装 Inkscape 后即用（本机未装=常态，不冒 verified）。契约 28/28 + tsc 0 + lint 0；实机抓真：后端路由更新须重启 Electron 子进程，重启竞态曾致 fallback 端口（63577）——dev 栈整体重启干净绑定 3001。G0 开发期常态 · 不外推 packaged/Provider/GA。）
最后更新：2026-11-03（✅ **BLOCK-342 切片4：渐变编辑（UI-673；实机 46/46）**：线性/径向新建+应用（横/竖/斜预设、起止色）、文档渐变列表+预览条、选中引用渐变的 stop 行内编辑（自建 stop 带 id 走 id 编辑）。抓真后端 insert markup=「恰好一个元素」口径（parseSvg.elements 全量后代计数）→ 渐变拆全单元素 op 序列：缺 defs 先插根 end（不扰动 path）→ 空壳渐变 → stop 逐个按 id 插；后端零改动。测试 9/9 + 前端 62/62 + tsc 0 + lint 0；flow V17 四断言全过。G0 开发期常态 · 不外推 packaged/Provider/GA。）
