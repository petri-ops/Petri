# 审计广播台历史归档 · through 2026-11-11

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-11（🏁 **BLOCK-425 设置项排版重构（第一批 11 项）**：新增 `SettingsField` 统一行组件——**图标 + 名称（右侧可挂当前值）+ 控件 + 一句说明**，含 `trailing` 模式（开关/按钮贴右）。改造 3 个高频分区：外观 4 项（sun/list-details/sparkles/zap）、通知与桌面 3 项（bell/panel-bottom/moon）、隐私与维护 4 项（shield/refresh/download）；最长说明由 **56 字压到约 30 字**，全部一行可读。**剩余分区的真实障碍**（不粉饰）：设置页有 3 套字段样式体系——模型接口 298 行 DOM、联网/计算用自有 `styles.field`、用量/快捷键是统计卡与键位表（行式字段不适用）、高级 4 项（决策原语 118 下拉，建议独立开发者页）。测试 115/115、`block201` 4/4、`gate:ui-program` 6/6、`code-size`/`css-modules`/`types` PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。）
