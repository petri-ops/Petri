# 审计广播台历史归档 · through 2026-11-11

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-11（🔁 **BLOCK-423 第十版（取消标题悬浮 + 返回按钮统一）**：用户指「标题好像都是悬浮的 不合理」——根因是上一版为「标题吸顶」给 `.petri-settings-section__heading` 加了 `position: sticky`，sticky 是浮层，滚动即压住下方字段（「外观主题」label 被盖住的实拍）。改回 `position: static` 回文档流；返回按钮统一为 `min-width:104 / height:36 / gap:10 / 图标 18×18` 并与导航项同列起点、补 hover。实测 `headingBottom=100 < labelTop=120` 无重叠、`backBtnWidth=104`、`backIconWidth=18`。代价：标题不再吸顶（需常驻应在卡片内做非滚动头，而非 sticky）。设置面板+token 契约 **107/107**、`gate:ui-program` 6/6、`css-modules`/`code-size`/`types` PASS、`docs:check` 569。G0 开发期常态 · 不外推 packaged/Provider/GA。）
