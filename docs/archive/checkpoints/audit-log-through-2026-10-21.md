# 审计广播台历史归档 · through 2026-10-21

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-21（**BLOCK-223 Q9 续项垂直切片 completed**）：系统通知（回合完成/失败/等待审批；窗口聚焦抑制 + 3s 去重 + 点击聚焦）+ 托盘最小化（`closeToTray` 默认 false，关窗=隐藏）+ 退出摘要（后端 `GET /api/app/activity-summary` 五类计数 → 取消 / 最小化到托盘 / 停止并退出；守卫先于既有 `before-quit` 消费者注册）。证据=block223 9 项 + 前端 12 项 + 9223 离屏 live 16/16（亮/暗截图）+ closeout 十三门 PASS；注册表 89→91 键。reopen=模型选择器深度/电脑控制 sidecar/崩溃同意/首启揭示/通知中心/摘要逐项操作。plan=docs/block-223-q9-desktop-shell-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T05:36:14.529Z -->
最后更新：2026-10-21（**BLOCK-224 Q9 续项（D1+D2）completed**）：模型选择器深度——目录状态诚实（加载中/发现失败/缺密钥/已隐藏逐行可见）+ 每模型可见性/上下文/默认思考档；`useAiSettings` 消费 `credential_status` 并记录逐 profile 发现失败；菜单抽 `ModelMenu`、设置控件抽 `ModelSelectorControls`（SimpleChat 2136 / DesktopSettingsPanel 670，棘轮不增）。证据=前端 31/31 + 后端 3/3 + 9223 离屏 live 9/9 + lint 0 error/types 0。D4 Auto 留下一刀。plan=docs/block-224-q9-model-selector-depth-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T06:31:51.247Z -->
最后更新：2026-10-21（**BLOCK-225 Q9 D4 Auto completed**）：按任务/附件每轮解析模型（有图→vision 绑定/能力；否则 agent 绑定/tools；回落当前），`userPrefs.autoModel` 默认 false；菜单开关+解析预览、composer「自动」；`ModelChip` 抽出，SimpleChat 保持 2142 行。证据=前端 33/33 + 配置基线 4/4 + 9223 离屏 live 8/8 + types/theme/code-size PASS。reopen=复杂度分级/成本权重/审计落盘/覆盖确认。plan=docs/block-225-q9-auto-model-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。

<!-- audit-log-compact.mjs 追加 @ 2026-10-21T07:19:14.760Z -->
最后更新：2026-10-21（**BLOCK-226 Q9 通知中心/免打扰 completed**）：标题栏铃铛+未读徽章+通知列表（回合终态/待审批留痕）；`userPrefs.quietHours`（空=关，跨午夜）只抑制系统 toast、应用内仍记录；面板向左展开避免右缘裁切。证据=前端 62/62 + Node 13/13 + 9223 离屏 live 11/11 + theme/types/code-size PASS。reopen=点击跳转/系统历史/审批穿透/声音/类型开关。plan=docs/block-226-q9-notification-center-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。
