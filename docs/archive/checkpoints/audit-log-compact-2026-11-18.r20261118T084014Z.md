# AUDIT-LOG 自动精简归档 · 2026-11-18（audit-log-compact.mjs）

> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简
> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」表窗口外淘汰行原文（搬移不改写）。
> canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。

| ✅ **UI-707 加映一（模型行右侧独立配置小页）实施完成（UI 轨）**：用户裁决「上下文窗口这个问题，已经登记没有动手是吗？如果是现在可以开整了」（C-51 转正）。模型行下方 inline drawer 改为锚定该行的右侧 portal 小页（放不下向左回退），一次只开一个，禁行/无回调不开；复用 ModelPreferenceControls + useModelQuickConfig，零新 API/零默认值/零写面语义变化。HK-01 红 2/2→绿 11/11，block95 history 6/6 + conversationRunStore 50/50；实机 ui707-add1 4/4 allPass（placement=right、left=933.6 > row.right=925.6、宽≈320；9223 离屏跑完即 kill、未设 PETRI_TEST_ONSCREEN）。证据=acceptance/ui-707-add1/。观感 pending_human_eye 不代签，按 UI-707 加映一同段登记。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-17 | UI-707 加映一 / IMPLEMENTED |
