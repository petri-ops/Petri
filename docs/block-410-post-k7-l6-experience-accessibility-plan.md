---
capability: block-410-post-k7-l6-experience-accessibility
status: completed
goal: 执行第五轮优化程序 L6（体验可达性与人设）：键盘可达（CommandPalette focus trap/抽屉 dialog）、ThemeProvider 读侧状态、UI 台账 4 条 verified 冒认降级+机械校验、主题门扩面、RouteFallback 可见文本、禁用原因单源、人设可见化、历史证据索引。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L6 的 11 条发现。
acceptance:
  - L6-1 L-62 CommandPalette Tab 循环+焦点还原+跳 header+listbox/aria-activedescendant（组件级键盘用例）；L-70 窄屏抽屉 dialog 语义+Escape（复用 PromptEnhanceDialog 配方）
  - L6-2 L-63 ThemeProvider pull 状态入 prefsSync+role=status 失败条+抑制静默回正
  - L6-3 L-64 四条 verified 冒认降回 in_progress+状态/证据单字段机械校验；L-65 计数以 triageLedger 为真源
  - L6-4 L-66 theme 门扩 .tsx+z-index 棘轮（WCAG 观感归 E）；L-67 内联债全量扫描登记
  - L6-5 L-69 RouteFallback 可见文本+role=status；L-73 禁用原因单源常量
  - L6-6 L-72 人设可见化（证据等级 chip/审批 reasonCode 文案/本地主权说明——观感归 E 不代答）
  - L6-7 L-81 历史证据 historic-unverifiable 索引；22 人眼项保持 pending_human_eye
  - L6 出口：组件级双证（vitest+既有键盘用例形态）；ui:audit:check 的 CSS WIP 红延续 W 归属；主题门绿
reopen: 蓝图锚点漂移或 UI 台账 owner 收口后重开
---

# BLOCK-410 · post-K7 L6 体验可达性与人设（第五轮优化程序第 7 阶段）

> 发令来源：用户 2026-11-11 执行提示词预授权（连续工作）。canonical 蓝图 §4-L6。
> 观感归 E：暗色观感/读屏/对比度观感不代答（组件级语义与机械门可达）。

## 6. 执行留痕

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| L6-1 | done-partial | L-62 CommandPalette：nextSelectable 跳 header/Tab 循环/焦点还原/listbox+activedescendant（活动项桥变量消 sink）；L-70 抽屉 dialog=补腿 | block410 6/6；copilot 763/763 |
| L6-2 | done | L-63 pull 读侧失败入 prefsSync+重放期抑制回正+恢复清条 | ThemeProvider 5/5 |
| L6-3 | done-partial | L-64 四条降回 in_progress（ui:audit:check exit 1→0）；L-65 triageLedger 统一=补腿（归 L7） | ui:audit:check PASS |
| L6-4 | done-partial | L-66/67 主题门扩面+内联债全量扫描=独立切片补腿 | plan §7 |
| L6-5 | done | L-69 fallback 可见文本+role=status；错误详情折叠+复制诊断 | block410 |
| L6-6 | done-partial | L-72 本地主权说明（role=note 最小件）；chip/审批文案=观感归 E 补腿 | block410 |
| L6-7 | done | L-81 historic-unverifiable 索引；22 人眼项不动 | 索引 JSON |

## 7. 补腿条件

1. **L-70 抽屉 dialog**：App.tsx:152-169 渲染树内联面板 → dialog 语义+inert 背景，须 UI 台账条目+9223 离屏双证。
2. **L-65 triageLedger 统一**：README/gate 文案计数消费方改造——归 L7 总收口批。
3. **L-66/67 主题门扩面**：theme-token-contract 14 族断言改造 + 26 处数字 z-index 基线重打 + 内联债全量 .tsx 扫描基线——独立切片。
4. **L-72 chip/审批文案**：证据等级 chip + 审批卡 reasonCode 文案——观感归 E（测试路线随 L7 生成，不代答）。
