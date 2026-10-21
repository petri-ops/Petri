# 审计广播台历史归档 · through 2026-10-21

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-10-21（**BLOCK-223 Q9 续项垂直切片 completed**）：系统通知（回合完成/失败/等待审批；窗口聚焦抑制 + 3s 去重 + 点击聚焦）+ 托盘最小化（`closeToTray` 默认 false，关窗=隐藏）+ 退出摘要（后端 `GET /api/app/activity-summary` 五类计数 → 取消 / 最小化到托盘 / 停止并退出；守卫先于既有 `before-quit` 消费者注册）。证据=block223 9 项 + 前端 12 项 + 9223 离屏 live 16/16（亮/暗截图）+ closeout 十三门 PASS；注册表 89→91 键。reopen=模型选择器深度/电脑控制 sidecar/崩溃同意/首启揭示/通知中心/摘要逐项操作。plan=docs/block-223-q9-desktop-shell-plan.md §7。G0 开发期常态 · 不外推 packaged/Provider/GA。
