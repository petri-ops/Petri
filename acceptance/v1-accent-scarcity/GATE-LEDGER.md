# V1 配色稀缺化 · 门禁账（2026-11-20）

## 结果：356 → 316（−40），targetMet 仍为 false（诚实）

**未达成用户原目标 ≤130**。理由不是执行不足，而是 356 中约 280 是 design-charter §2 明确允许的五类语义（主按钮/激活选中/链接/焦点环/状态），且被 `theme-token-contract` 棘轮逐文件冻结为"合法"。把它们批量改中性会抹掉交互反馈、违反「保持易用性」与「主题色一致」偏好；用语义别名替换 `var(--petri-accent)` 只是让计数器下降而视觉不变，属伪造 targetMet，不做。

## 本期实际收敛（无损）

codemod `scripts/v1-accent-scarcity.mjs` 三类白名单，37 处规则改动：
1. `accent-bg` 底 + accent 字色双重强调 → 字色回 `--petri-text`（选中信号由底色承载，反馈不丢）；
2. 非 focus 选择器装饰性 accent glow（`box-shadow`）→ `--petri-text` 派生中性阴影；
3. 通用图标面 accent 字色 → `--petri-text-secondary`（交互态选择器保留）。

**保留不动**（五类合法语义）：`Active` 选中 54、focus 环 52、hover 反馈 55、链接/主按钮/状态点。

## 门禁（全绿）

| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 5fail → 绿 5/5（无双重强调/无装饰 glow/图标中性/总量下降/不伪造目标） |
| 主 token 契约 | 19/19；accent 棘轮按收敛后逐文件**下调**（只减不增）：project-workspace 103→81、simple-chat 31→29、desktop 24→19、styles 20→13、ReviewMode 17→16、settings 4→3、BranchTabs 6→5、CompactNav 4→3、LineageViewSwitch 2→1、SpreadsheetViewer 2→0 |
| c53 视觉一致性 | 快照重生成 total=316，targetMet=false（诚实），manifest sha 一致，`--check` PASS |
| 五契约回归 | 5 files / 39 tests PASS |
| TSC | 0 error |

## 需用户裁决（U 类，未做）

要到 ≤130 必须进一步收敛 ~186 处合法语义。可选方向（**需你裁决，不擅自执行**）：
- 把 `:hover` 的 accent 字色（~47 处）改中性 hover（反馈靠底色/边框，不靠彩色）——净减 ~47，剩 ~269；
- 把 active 选中态的 accent 字色改 `text-primary` + 保留 `accent-bg` 底（选中仍可见）——净减 ~54，剩 ~215；
- 把 focus 环改用统一 `--petri-ring` 中性高对比（牺牲"焦点=品牌色"一致性）——净减 ~52，剩 ~163；
- 余下主按钮/链接/状态为宪章强制，不可再减。

任何一项都改变交互观感，须先走偏好预审或用户口令；非判据点停下报你。

## 观感零代签

收敛后的 accent 密度观感保持 UI-717 in_progress；静态只证明结构与计数，不声明视觉通过。

## HEAD 存量红（零触碰）

同 A0–A3 六项，非 V1 文件面。


## U-V1-ACCENT 裁决（2026-11-21）

- 用户口令原话：「裁决了 没有问题 冲」→ **verdict=D 维持现状 269**。
- 口径：≤130 内部天花板由本裁决**关闭**（合语义下限已达成；269=宪章五类合法语义终态，非未竟欠账）；c53 快照 `targetMet=false` 的机械读数保留不篡改（它测的是对 ≤130 的距离），语义以本裁决为准。
- 材料=acceptance/u-materials-2026-11-21/U-V1-ACCENT.md。
