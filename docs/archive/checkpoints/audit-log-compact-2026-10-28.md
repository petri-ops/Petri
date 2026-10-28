# AUDIT-LOG 自动精简归档 · 2026-10-28（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ 处理完成（BLOCK-292/298；用户裁决原话「假如我使用了箭头批注，这个批注就不显示…批注不要隐藏起来呀」） | 2026-10-28 | **批注 pending 预览常驻（UI-599 verified）**：hook 暴露 pendingRect/pendingPath 几何，overlay 新增 pending 渲染块，图像/PDF 双宿主接线——画完松手批注立即可见直到保存；修复 begin* 残留旧语义 `setDrawing(false)`（画完即退绘制模式、第二笔拒识，实机 D6 揭示）。annotations 31/31 + 定向 121/121 + 9223 实机 10/10（acceptance/block-298/）；closeout 十三门 PASS。G0 开发期常态 · 不外推 packaged/Provider/GA | UI-599 / BLOCK-292~298 |
