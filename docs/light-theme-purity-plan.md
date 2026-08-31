# LIGHT-THEME-PURITY — 浅色主题纯净度系统性调优（slate 蓝灰 → zinc 中性 + 纯白画布） Plan

- **Plan ID**: `LIGHT-THEME-PURITY`（用户反馈驱动，2026-08-31：「整个软件还有大量浅灰…浅灰是主题色吗…要纯净感，目前的灰有一种说不出来的脏感」）
- **状态**: `completed`（2026-08-31 收口：tsc 0 / 定向 vitest 44/44 含 theme-token 契约 / 实机工作区+审阅浅色截图，证据 `acceptance/ui-238/`；UI-238 verified）
- **truthDomain**: `light-theme-purity`
- **阶段**: P0 登记（`5cd744e`）→ P1 token 重调（UI-238，`7eb11f2`）→ P2 收口（本 commit）
- **G0 纪律**: G0 开发期常态 · 不外推 packaged/Provider/GA.

## 1. 诊断（设计审计）

「脏感」根因不在某一处灰底，而在**基底色调**：浅色主题全部表面/边线采用 Tailwind slate 系（`canvas #f8fafc` / `subtle #f1f5f9` / `border #e2e8f0` / `hover #eef2f7`，均带蓝调），大面积铺满全屏 + 多层相近蓝灰叠放 → 读作「洗不干净的灰」。高级浅色界面（Notion/Linear/Vercel）的公共做法：**纯白主导 + 无彩中性灰只做发丝线/hover + 单一品牌色点缀**。

## 2. 方案（P1，UI-238）

Token 是唯一杠杆（全应用组件均消费 `--biof3-*`，硬编码灰审计后仅 2 处且属暗色语境）。浅色块整体从 slate 切 zinc（无彩中性）：

| token | 旧（slate） | 新（zinc/白） |
| --- | --- | --- |
| bg-canvas | #f8fafc | **#ffffff**（纯白画布） |
| bg-subtle | #f1f5f9 | #f4f4f5 |
| border | #e2e8f0 | #e4e4e7 |
| border-strong | #cbd5e1 | #d4d4d8 |
| border-tertiary | #eef2f7 | #ebebee |
| hover | #eef2f7 | #f4f4f5 |
| surface-dim | #f1f5f9 | #f4f4f5 |
| text 系列 | slate 蓝灰 | zinc 中性（#18181b / #3f3f46 / #71717a / #a1a1aa） |
| overlay/shadow 基色 | rgba(15,23,42,…) | rgba(24,24,27,…) |

- **不动**：暗色主题（navy 深底为刻意品牌冷调，用户投诉对象是浅灰）；teal accent 与状态色（唯一的彩，正是纯净感来源）；对比度不降（zinc-900 on white ≈ 原 slate-900）。
- 硬编码清点：global.css `--biof3-surface-dim` 浅色值随调；desktop.css `.biof3-nav-panel` 的 #e2e8f0 属暗色导航面板语境，不动。

## 3. 门禁

theme-token 契约 + tsc + 定向 vitest；实机：浅色主题首页 / 项目工作区 / 审阅历史 / 设置四页截图对比（`acceptance/ui-238/`），暗色抽查不变；台账 UI-238 同提交同步。

G0 开发期常态 · 不外推 packaged/Provider/GA.
