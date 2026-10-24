# 审计广播台历史归档 · through 2026-10-23

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-23（**BLOCK-246 Q2 余项 立项 active（P0-LAUNCH）**）：用户「Q2 余项 整完」。BLOCK-245 首切片留下的七项一次做完，**全部挂在那条唯一 `ComposerContextItem` 通道上**：C13 速记板（`016_scratchpad.sql` 由 `scratchpad-schema.js` 生成并逐字节一致 + store/route/面板，片段·图片·搜索·来源会话）、C12 划词动作生产者（`WorkspaceFilePreview` 选区 → 复制/加入对话/侧聊/加入速记/批注不可用如实）、C4 消息动作注册表（+加入上下文/评价）、C11 图片预览（保存/多图/缩放预设）、B2 计划反馈（`usePlanApprovalFlow.ts:83` keep-planning 不再吞意见）、C16 形态补全（文件夹整体引用/选中代码块/应用快照）、C17 跨会话引用（有界摘要 + 拖放）。红线=零新依赖 / 不建第四注入通道 / 用户数据表只走迁移 / `SimpleChat.tsx` 只许变短（基线 2119）/ 拆前基线 12 条一字不改仍绿。非范围=C13 图片批注（并入 Q6）/C12 选择总线重构/C4 结果统计/C11 编辑面/B2 修订案自动生成/C17 跨设备/G1+。plan=`docs/block-246-q2-rem-plan.md`。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-24T05:27:10.194Z -->
最后更新：2026-10-23（**BLOCK-246 Q2 余项 completed；UI-556 verified / UI-555 in_progress；无 active 工作包**）：七项全交付——速记板（迁移 016 + store/route/面板）、划词动作生产者（`selectionQuote` 首个生产者）、消息动作注册表（+加入上下文/评价，评价落 017 独立表）、图片预览（保存/多图/预设）、计划反馈（keep-planning 带意见）、上下文形态（文件夹整体引用/选中代码块/应用快照）、跨会话摘要（三重有界）。证据=Node 12+5 + 前端定向 62 条（拆前基线 12 条一字未改仍绿）+ types 0 + 隔离 9223 **亮 19/19 · 暗 19/19**（`acceptance/ui-554/`、`acceptance/block-246/`）。**实机抓真三条**：① 首启角色揭示浮层在导航**之后**才异步出现，截图会拍成欢迎页（流程已固化 `ensureNoOverlay`）；② **速记板开态住在 React 里，宿主重渲染会把面板关掉**——流程侧已做幂等"确保打开"，行为本身登记本文件待处理项，不掩盖；③ `@` 面板先以"零分组"出现，须等分组非空再判定，否则误判"源不存在"。Q-MATRIX **B2/C11/C16 → ✅；✅43 / 🟡39 / 🔴13 / ⛔7 = 102**。plan=`docs/block-246-q2-rem-plan.md` §5/§6。G0 开发期常态 · 不外推 packaged/Provider/GA。
