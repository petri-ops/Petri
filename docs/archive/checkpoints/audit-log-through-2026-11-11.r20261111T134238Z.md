# 审计广播台历史归档 · through 2026-11-11

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（BLOCK-170 自稳设计；
> 活跃台只留「最后更新」链最近 8 条，本档=被淘汰链行原文追加，搬移不改写）。
> 状态与完成语义以 canonical 文档（roadmap/plan/DOC-REGISTRY）为准，本档仅作广播历史追溯。

最后更新：2026-11-11（🔁 **BLOCK-423 第八版（分区标题与「设置」齐平）**：顶栏原为全宽占位块，把右侧内容整块压下 60px。改为 `position:absolute; top:0; left:0; 264×60` 收进左栏上方（与 ZCode `SettingsPage.tsx:1514` 把返回按钮放 `aside` 顶部同构），左栏 `padding-top:60` 让位、内容卡片从面板顶起（`margin-top:8px`/`padding-top:16px`）；264px 内放不下的图标章与副标题用 CSS 隐藏（副标题由分区说明承担，不丢信息）。实测「设置」y=59 / 「常规」y=62，差 **3px**，contentTop=46。纯 CSS 零 DOM 改动；设置面板+token 契约 **107/107**、`gate:ui-program` 6/6、`css-modules`/`code-size` PASS。G0 开发期常态 · 不外推 packaged/Provider/GA。）
