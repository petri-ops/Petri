# AUDIT-LOG 自动精简归档 · 2026-11-09（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ BLOCK-325-MODEL-SURFACE-BUDGET（model-surface 尺寸预算门禁，2026-11-01；用户裁决「很棒 继续」） | 2026-11-01 | **completed（当日立项当日收口）**：scripts/model-surface-baseline.mjs（measure/compare/--update 纯函数）+ 基线 test/model-surface-baselines.json（systemPromptChars/toolDefsCount/toolDefsChars/perToolChars）+ 契约测试（预算棘轮：任何增长即红 + 退役词扫描：核心系统提示与工具定义不含 单细胞/scRNA/DESeq2/Seurat/FigCode/空间转录组）；红线=只测核心面不扫 pack 注入内容、不预设阈值（基线=现状首测）、增长必须 --update+commit 说明。非范围=token 级预算（CK-04 SECTION_CHAR_BUDGETS 已有）/前端 bundle（block141 已有）。证据=契约 4/4 + closeout 十一门 PASS；基线首测 systemPrompt=940 chars / toolDefs=104 个 56614 chars。plan=docs/block-325-model-surface-budget-plan.md | BLOCK-325 / P6-CLOSED |
