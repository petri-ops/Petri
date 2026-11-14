# 审计广播台历史归档 · through 2026-11-11

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-11（🔁 **BLOCK-423 第九版（去掉冗余「齿轮+设置」标题）**：已在设置页内 + 左侧分区名即当前位置 + 右侧卡片已有分区标题 → 顶部身份块重复。参照 ZCode `SettingsPage.tsx:1514`（aside 顶部只放返回）隐藏 icon 与 titles，dialog 自带 `aria-label="设置"` 语义不丢；顶栏 60→56、`padding 14→12`、返回改 flex-start。**自纠**：首改未生效——同文件后段残留 `.petri-desktop-panel__icon{display:inline-flex}` 同特异性后出现，覆盖了 `display:none`；删死规则后实测 `backBtn=flex / icon=none / titles=none`。设置面板+token 契约 **107/107**、`gate:ui-program` 6/6、`css-modules`/`code-size`/`types` PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。）
