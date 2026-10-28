# 审计广播台历史归档 · through 2026-10-27

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-27（**BLOCK-268 UI-585 实机腿补验 completed（批次 1/5）**）：隔离 9223 亮/暗各 **7/7**（acceptance/block-268/scratchpad-live{,-dark}.json）：开→SPA 跨路由重挂保留→Esc 关闭→刷新归零四链全通。**实机抓真**=首版用 CDP Page.navigate 作重挂触发是整页刷新（新 JS realm 归零模块级 store）误杀开态，修正为 SPA 内部切换（sidebar-settings+history.back）即绿——实现无缺陷，是实机路径选错。knip 棘轮 +1（新 flow 动态入口 --update 留痕，288 键）；impact-map 登记 block268 规则（patterns 用目录 glob——首版列具体文件名触发 test-affected acceptance 目录断言红，18/18 复绿）。台账 UI-585 verified。closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-26（**BLOCK-267 flaky 根治+backlog 小项清偿批 completed**）：①ReviewMode.block147 并发 flaky 根治（act 微任务冲刷 + 刷新断言 timeout 5s；隔离 6/6 恒绿）——🟡 行销号；②ScratchpadDock 开态提升模块级外置 store（重挂不再吃掉开态；AUDIT-LOG 🟡 清偿）+ 新增重挂/双向 toggle/引用关闭 3 测试；③/api/auth/me standalone 恒 500 清偿（auth.js 直 require 助手模块，红绿对账 500→200，回归 2/2）——🟡 行销号；④dev-verify env 陷阱固化为静态门（flow 顶层 const=process.env 即红，函数化调用时读取不拦；首批清偿 8 flow：block107×3/block214/pack-lifecycle/ui554/ui557）——🟡 建议固化成门。回归=触及面 17+17 全绿+block246 12/12+block219 24/24。types 0/lint 0。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-27T10:27:05.768Z -->
最后更新：2026-10-27（**BLOCK-269 浏览器连接器前端桥 completed（C-40 尾项·批次 2/5）**）：transport 桥接线=BLOCK-264 预留注入点落地：event-bus SSE 下发 browser-action → BrowserPanel webview 执行（navigate/read_text/click/fill/screenshot，executeJavaScript 零拼接注入）→ action-result 回传 resolve（25s 超时兜底）；REST 四面（connect/act/status/disconnect）与 agent 工具同源执行面（helpers 单一真相）。证据=Node 5/5+执行器 6/6+实机亮/暗各 **12/12**（acceptance/block-269/）——链 A 后端桥全链+链 B 真面板 webview 真执行（read_text 读到真实页面文本+navigate 外网真实导航）。**实机抓真两处**：①event-bus payload 展开在事件顶层（flow 首版嵌套取法错过帧）；②SSE abort 重置 keep-alive 连接波及复用连接 fetch（ECONNRESET unhandled rejection 崩进程）——rest 重试+兜底。lint 首跑 15 error 全为本批新文件形态按真缺陷修零豁免；knip +1 留痕。UI-586 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-27T10:47:35.584Z -->
最后更新：2026-10-27（**BLOCK-271 1b 实机生效腿 completed（BIO-2/UI-454·批次 4/5）**：①日志端点项目布局兜底隔离栈直证 **4/4**（acceptance/block-271/）——隔离后端+真实 DB 行+项目布局 run.log 直打 /api/tools/log/:id 得 source=run.log（workspace_path 兜底链实机生效）+对照无 workspace_path 回全局链不回退；②**backlog 滞后注记对账抓真**：W3 已由 BLOCK-163 整波收口（12 单元全 ✅）、竞争力纲 W6 已由 BLOCK-176-WAVE6 收口（CP-16/17/18 交付，仅 CP-19 移动栈 deferred）——批次规划时的「W3 首切片/W6 对账」是 backlog 旧注记误导，真实剩余见 backlog 修正行。UI-454 verified（②③热图/分页实机走查随 UI-452 六面用户过目）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-27T14:58:20.392Z -->
最后更新：2026-10-27（**BLOCK-270 批注画笔前端渲染器 completed（C-43 尾项·批次 3/5）**）：freehand 前端镜像全链——KINDS/LABELS/ArtifactAnnotation.path/decimatePath 抽稀镜像（≤512 等距保留首尾）、client locator 三态互斥（freehand 发 path 不发 rect）、session beginPath（undo 重建保持互斥）、Overlay SVG polyline 渲染+画笔采点（down 采点/move 预览/up 相邻去重提交 ≥2 点）、两 pane 接线、任务 prompt 画笔报点数不报假矩形。组件级 **59/59**（Overlay 11/契约/client/Bar）；tsc 0。实机抓真=采点 up 终点与末次 move 重合产生重复点（去重修复）。UI-587 in_progress（实机需结果面真实 job+artifact seed，随结果面实机批）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T00:53:52.668Z -->
最后更新：2026-10-27（**BLOCK-271 批次 5/5 backlog 滞后注记对账批 completed（治理无代码）**）：pending-work-backlog 队列表滞后注记修正——序 0（W3=BLOCK-163 整波/W6=BLOCK-176-WAVE6 已收口，**两大纲无剩余波次**）；2b 评测 v2 七包（BLOCK-188~194）闭合→completed；2a/2d/2e 补对应交付注记（BLOCK-200/202/206/207/209/210），剩余面标待核；2c/1z 未确凿不冒进只标待核。**教训入册**：queue 表注记不随包收口自动回写是本次误导源头——后续每包收口的 canonical 回写应含 backlog 行（已在 handoff 批间纪律提示）。治理门=docs:check（本批无代码，test:changed 沿用上一轮 PASS）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T09:52:48.079Z -->
最后更新：2026-10-27（**BLOCK-272 closeout 收口定向化 启动登记（active·P0-LAUNCH）**）：用户裁决「每次优化升级只是部分代码，收口只需要校验有改动的部分即可」。范围=eslint --cache + tsc --incremental + arch 两门/knip 域跳过 + cruise 同轮去重 + closeout:full 转义；非范围=test:changed 内部语义、knip/arch 判定规则与基线、npm run check 发布链。基线实测=重量静态门 98.4s/轮（eslint 79s 占 80%）。fail-open 全护栏（状态缺失/损坏/锚点不可达即全量）。plan=docs/block-272-closeout-targeted-plan.md。无 UI 台账增量（纯治理门禁）。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T10:16:56.840Z -->
最后更新：2026-10-27（**BLOCK-272 closeout 收口定向化 completed（P4-CLOSED）**）：三层机制落地——eslint --cache + tsc --incremental + arch 两门/knip 域跳过（decideSkip 状态锚定，fail-open）+ cruise 同轮共享 + closeout:full --force-full 转义。证据=红绿 13/13 + 回归 31/31 + closeout 十三门 PASS exit 0（域自纠实证：arch 两门因实现脚本改动域内命中→全量）+ closeout:full PASS 零跳过行；**静态门热态 98.4s→10.4s**（lint 79→1.5s/tsc 12.1→1.6s，timing 三件落 acceptance/block-272/）。抓真三处：test-affected 18 红=新脚本未登记 impact-map（复绿）；platform-freeze 抓探针平台分支（含注释字面量，Jev 追加建议命中，shell:true 收敛）；域设计自纠=门禁实现脚本纳入自身域。Jev=doc:suggest planDoc 0.89 采纳/uiAudit 0.06 零建议（无 UI 增量）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T10:31:51.531Z -->
最后更新：2026-10-27（**BLOCK-273 拖拽边界统一渐变暗示规范 启动登记（active·P0-LAUNCH）**）：用户裁决「qoder……鼠标放到拖拽的地方有渐变的渲染效果……任何可以变化的窗口不应该被固定宽度的条带干扰影响美观」+「项目摘要和侧边聊天的窗口左侧也不要默认有这么宽 换成 一致的统一规范」（附截图）。范围=五处可调宽边界统一「细线+渐变高光」悬停规范（workspaceFileTreeResize 4px 实心带重构 / FloatCardResizer 常驻线 3px 收窄 / 清 desktop.css 死把手样式 / 主列 resizeHandleV 参照核对）；红线=可发现性不回退（v25 隐形热区抓真在案）、纯视觉层不动拖拽逻辑；非范围=指针跟随渐晕（reopen）。归属 QODER-ESSENCE-ABSORPTION 切片（用户实测反馈）。plan=docs/block-273-resize-affordance-gradient-plan.md。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T10:50:58.172Z -->
最后更新：2026-10-27（**BLOCK-273 拖拽边界统一渐变暗示规范 completed（P5-CLOSED；UI-588 in_progress）**）：五处可调宽边界统一「细线+渐变高光」悬停规范（Qoder 式，用户实测反馈+截图裁决）——文件树 4px 全高实心带重构（6px 热区+渐隐 glow+`:has` 分隔线转 accent）/ FloatCardResizer 常驻线 3px→2px 变淡+hover 整块 tint 换渐变 / desktop.css 死把手样式删除 / 主列参照+两处 pill 标注归属。证据=theme 17/17（accent 棘轮 93→95 留痕）+组件 35/35+routing unknown=[]+亮/暗默认态实机断言（acceptance/block-273/）。**环境边界如实入册**：隐藏页 used 值缓存+离屏截图合成不可用（-32000）+`CSS.forcePseudoState` 本实例静默不生效——悬停激活态读数不可靠，UI-588 in_progress（30 秒人测路线随交付，确认后翻 verified）。顺手清偿 AnnotationOverlay 4 处死字面量 fallback。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-28T11:00:49.409Z -->
最后更新：2026-10-27（**BLOCK-274 test-changed 内部优化 登记并同会话收口（轻量包·plan=本条目，对标 TEST-INFRA-DEBT 轻量模式）**）：用户裁决「行！ 按照建议来」。根修落地=scripts/test-affected.mjs validateMap 进程内 memoization（WeakMap 按影响图对象身份缓存成功校验，失败照常抛出不缓存）——消除 resolveImpact 每次调用重复全量校验（实测 ~2.1s/次，无缓存时第二次同样 2.0s；缓存后 11ms）。证据=「vitest 通道防复发」用例 solo 505-864s→**5.7s**（百倍）、31 用例路由套件 1058s→**12.8s**（82 倍，改前改后同套绿=纯重构行为基线）、closeout tests 门 704s→**14.6s**、整体 closeout ~14min→**~3min**（ui-audit 144s 成为新最大单项，普惠优化候选另案）。来源=两会话 Jev 建议收敛同一方案（本会话 block272-reopen conf 0.48 + 273 会话 conf 0.77）+ BLOCK-273 实撞 120s 超时结构性红（600s 兜底留痕「根修=本包」）。Jev=doc:suggest 全零建议（轻量包无 plan 文档，台账按下限照写）。G0 开发期常态 · 不外推 packaged/Provider/GA。
