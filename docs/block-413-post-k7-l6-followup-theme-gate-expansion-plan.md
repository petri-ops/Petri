---
capability: block-413-post-k7-l6-followup-theme-gate-expansion
status: completed
goal: 补腿批第二刀（L6-4/L-66/L-67 续）：主题门扩面——theme-token-contract 扫描 .tsx 全量、数字 z-index 棘轮、内联债全量 .tsx 扫描基线（只减棘轮）。零新增依赖。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L6 L-66/L-67。
acceptance:
  - 红→绿①：theme-token-contract 的 CSS-only 族断言扩到全 .tsx 扫描（植入 .tsx 内联 token 违规必红）
  - 红→绿②：数字 z-index 全 .tsx 棘轮（基线冻结存量；新增即红）
  - 红→绿③：内联债 INLINE_DEBT_FILES 5 文件硬编码 → 全量 .tsx 扫描基线（新增文件/新增字面量必红；只减）
  - 同套绿：现有 theme-token-contract + k3 experience + B-16/尺寸门零回归
reopen: 主题 token 阶梯变化或基线漂移时重开
---

# BLOCK-413 · 补腿批第二刀：主题门扩面（L-66/L-67 续）

> 发令来源：预授权连续工作延续（用户 2026-11-11 确认「按照建议做好规划 搞定下一个阶段」）。
> 蓝图=docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L6（L-66/L-67）。
> 观感归 E 不变（WCAG 对比度观感不代答；机械可算部分=token 对、字面量计数）。

## 执行留痕

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| 棘轮① | done | 数字 z-index 全源棘轮（.tsx/.ts/.css 计 38 文件/111 处冻结，新增即红；var(--petri-z-*) token 形态不计入=正确激励） | theme-token-contract 新用例；基线=权威 node 重扫（与 vitest walk 同逻辑） |
| 棘轮② | done | 内联颜色字面量全量 .tsx 只减棘轮（16 文件/62 处冻结；.ts 定义域文件（terminal-themes/accents/scene3d）按内联债口径排除=诚实 scoping） | theme-token-contract 新用例 |
| 红证据 | done | 首跑两红（ToastProvider 5>0 / banner 1>0）= 既有 font-size 棘轮对新增 CSS 文件「基线缺条目即红」机制实战自证 | vitest 首跑输出 |
| 修复 | done | banner font-size 12px → var(--petri-font-size-sm)（token 化清零）+ ToastProvider 5 处 sm 域登记（含定性注释对标 UI-593/523 先例） | 复跑 19/19 |
| 豁免纪律 | done | 新棘轮 object-injection 按既有先例（306-309 行三行形态）豁免留因——零 unused directive | eslint 文件级 0 |
| 同套绿 | done | 主题域 54/54 + k3 28/28 + 契约 186 + tsc 净 + ledger PASS | 五套单批 |

## 观感归 E 不代答

- WCAG 4.5:1 对比度观感、暗色形态、读屏——测试路线随 L7 证据包生成（机械可算部分=token 对已在既有 k1 校准链）。
