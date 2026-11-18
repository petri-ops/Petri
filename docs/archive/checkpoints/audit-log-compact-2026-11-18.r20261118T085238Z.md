# AUDIT-LOG 自动精简归档 · 2026-11-18（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ **UI-538 加映一（模型按钮显示当前模型名）实施完成（UI 轨）**：用户实机反馈「这个为啥没变呢……需求是显示已选择模型的名字」；澄清=此前只判断未实施，C-51 是模型行右侧小页、不是模型钮。`ModelChip` 改为图标 + 当前模型短名 + 箭头，自动档显示“自动 · 解析预览”，长名省略、窄容器仍图标化，title/aria-label 保留完整信息，菜单行为零改。HK-01 红 2/2→绿 3/3，block95 6/6 + conversationRunStore 50/50；实机 ui538-add1 4/4 allPass（label=glm-4.7、width=93.4、点击仍开菜单；9223 离屏跑完即 kill）。证据=acceptance/ui-538-add1/。开发版 HMR 生效、安装版需重新构建；观感 pending_human_eye 不代签，按 UI-538 加映同段登记。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-17 | UI-538 加映一 / IMPLEMENTED |
