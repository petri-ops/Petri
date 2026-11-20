# 国风简约背景水印 · 门禁账（2026-11-20）

## 用户诉求与理解
「建筑月洞门/雕塑卵石/绘画落印/开环取形这些很有美感，有没有对应造型图案做国风简约朴素美的页面背景水印？」
理解：不是前景图标，是**背景层底纹**——计白当黑，淡到几乎看不见但气韵立起来；零依赖、主题自适应、不干扰内容。

## 实现（零依赖 · 主题自适应 · 零交互干扰）
- `frontend/src/styles/watermark.css`（全局导入于 `main.tsx`）：四原型 mask 纹样——
  - 月洞门：两道开放圆拱（建筑·门洞见天光）
  - 卵石：三枚错落柔椭（雕塑·水边静物）
  - 落印：一枚近方小印带缺口（绘画·朱砂落印，方有郑重语义）
  - 开环：格物缺口环（不圆满、留余地）
- 色值 `color-mix(in srgb, var(--petri-ink-base) 3%, var(--petri-bg-canvas))`：亮暗 × 四档和声自动适配；SVG URI 内**零字面色**（mask 只提供形，色由 CSS 派生）。
- `pointer-events:none`、`aria-hidden="true"`、不写裸 z-index（不触冻结棘轮）；DOM 仅两个水印 div 在 welcome / workspaceRoot 根容器。
- 极淡实测：computed bg `color(srgb 0.893…)` 即对白底约 3% 墨色——淡到不抢正文。

## 实机观感（welcome 截图已人工过目）
`live/welcome.png`：右下两道月洞弧、右上一枚淡方印，主区大片留白，标题/composer 完全不被干扰——**正是"计白当黑"的效果**：若无若有，但页面气韵明显不同。这是本次诉求的核心达成证据。

## 自身门（全绿）
| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 5fail → 绿 6/6（四原型/URI 零字面色/3%派生/非交互/根容器接线/零依赖零代签） |
| 邻域回归 | 4 files / 42 tests（契约 19/19、welcome 13、home） |
| TSC | 0 error |
| ui-a11y | 32/32、0 对 <4.5:1（水印 aria-hidden 不入树） |
| 实机 flow | 6/6：welcome 四纹样在场、pointer-events:none、mask 为 svg data-URI、截图在场 |

## 诚实边界
- **工作区实机面不可达**：测试 userData 无项目（无 `/project/` 链接），flow 如实标 `workspace_live_unavailable`，未伪造截图；工作区水印的静态接线由 HK-01「workspaceRoot 含 pebble + aria-hidden」覆盖。你主窗有项目，可直接切到工作区看卵石/开环水印。
- 审美"是否够国风/够高级"保持 in_progress，不因静态+截图判据全过就代签；按 11-20 裁决可走 ≤3 轮偏好预审或用户口令。
- UI-717 四档 verified 仅覆盖色板/骨架，不覆盖本次水印，不外推。G0 开发期常态 · 不外推 packaged/Provider/GA。
