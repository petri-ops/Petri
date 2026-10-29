# 审计广播台历史归档 · through 2026-10-29

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-29（**BLOCK-321 completed（UI-627 verified）**）：侧聊升级为 frameless 原生独立窗（BLOCK-59 弹出窗注册表新类型 side-chat，singleton+close）——OS 八方位 resize/全屏任意拖动/可拖出软件边界跨第二显示器（用户三裁决：独立窗口化/入口收编/去宽头部），位置记忆走主进程 geometry（minBounds 280×320 规格化）；入口收编=唯一保留标题栏「更多工具→侧聊」，中栏右下 FAB 退役；极简 chrome=旧 52px「会话」头退役，只留 20px 拖动条+右上 ✕。**实机抓真**：localStorage 跨窗交接竞态（主窗写与弹窗渲染进程读无 happens-before，弹窗概率读空态）→ 根治=跨窗初始状态走 URL query（POP_OUT_QUERY_KEYS 白名单 projectId/convId，值复用 KEY_PATTERN），fork 移主窗 helper（fork→写记忆→popOut），localStorage 只留本页自读自写记忆。退役面=SideChatDock 三件（UI-626 页内八方位原型同日被本路线取代）+CenterPanel 让位面+subscribeCopilotContext 连锁死代码。证据=block59 43/43+窗口页 7/7+helper 5/5+CenterPanel 19/19+theme 17/17+tsc 0+test:changed 1020 项 0 红+实机 7/7（真实菜单链开窗/新 target 带 query/极简 chrome/SimpleChat 挂载）。截图离屏 unavailable。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-29T14:12:45.650Z -->
最后更新：2026-10-29（**BLOCK-321b completed（UI-628 verified）**）：发送/停止单钮态机——composer 右下角从并存两钮（BLOCK-178 形态）改同位单钮：空闲=发送（空输入禁用）、流式无新输入=停止生成（发送钮不在场）、流式有输入=变回发送（BLOCK-316 排队/Ctrl+Enter 插话语义保留）、停止后回空闲。用户裁决「同一位置：发送后变停止，有新内容变回发送」。证据=静态契约 3/3（红绿先行：Stop 三元形态 `streaming && !input.trim()`+旧并存退场+语义锚保留）+tsc 0+门禁 lint 0 error+test:changed 413 项 0 红+实机 8/8（acceptance/block-321b/live-send-stop-morph.json：四态全验证含真实流式回合）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-29T15:16:31.873Z -->
最后更新：2026-10-29（**UI-630 verified（BLOCK-321c 追加微调）**）：侧栏拖窄自动折叠阈值 140→240——用户实测 140 太小（拖到很窄还挂着，中栏被挤到空态卡文字竖排，截图指认）；240=左栏默认宽，拖过默认宽即快速折叠，手动重开回弹逻辑同源自动跟随。证据=纯函数 17/17（红绿先行）+实机 3/3（acceptance/block-321c/live-collapse-threshold.json：拖窄 200px 即折叠）。G0 开发期常态 · 不外推 packaged/Provider/GA。
最后更新：2026-10-29（**BLOCK-321c completed（UI-629 verified）**）：中栏优先宽度模型（用户裁决「固定中间栏宽度，除非手动调整」）——①中栏保底 560→760（迟滞还原 640→840）；②centerWith 计入两侧 gap 40px（原漏减）；③让位规则：手动哨兵侧保留、收非哨兵侧让位（不再放任中栏被挤穿），两侧都哨兵则尊重；④左右把手拖宽钳制 sidebarResizeMax（中栏保底预留，越界拖动停在 max）。实机抓真两处：useResizableColumns clamp.max 对左右栏从未生效（只用于 resultRight）+ 把手绑定工厂形态误改（handler 被弃=拖宽失效），均随批根治。证据=纯函数 16/16（红绿先行）+静态契约 3/3+tsc 0+lint 0+test:changed 427 项 0 红+实机 3/3（acceptance/block-321c/live-center-priority.json：双栏共存中栏 1020≥760；合成拖拽右栏 340→441 钳在 max 562 内中栏 918；视口分档实机不冒充——OS resize 对隐藏 Electron 窗不传播如实标注，由纯函数覆盖）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-29T16:44:02.444Z -->
最后更新：2026-10-29（**W6 承接评估判销（治理批·用户「按照你的建议 推进」发令）**：竞争力纲 §4-W6 partial→**completed**——2026-10-21 P0 对账「CP-16/17/18 在 DOC-REGISTRY 无独立承接包」系检索漏检：`block-176-competitiveness-wave6-plan.md` frontmatter status=completed（十三门 PASS + w6-live 8/8，AUDIT-LOG 2026-10-12 整包行在案），CP-19 另由 BLOCK-183 交付；码上抽验三处落点（CP-16 federation-tools SSE 订阅 / CP-17 git:checkpoint 通道+workspace-checkpoint 共享层 / CP-18 loop-orchestrator costCapCny 熔断）。pending-work-backlog 2026-10-27 对账行同口径在先。**竞争力纲全波次闭环（W1~W7 无剩余）**；doc:suggest 零建议（docs-only）。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-29T17:01:44.795Z -->
最后更新：2026-10-29（**下一阶段体验与物理世界建模蓝图固化（治理批，无 active 工作包）**）：`docs/next-stage-experience-blueprint.md` 已登记为下一阶段 planned canonical，纳入 Q4b-REM 工作流闭环、UI/布局可信体验、composer 提示词增强、harness+前端 3D/参数化建模与流程化 recipe；首个候选执行包=`NEXT-01-Q4B-REM`，各包仍需用户发令。G0 开发期常态 · 不外推 packaged/Provider/GA。
