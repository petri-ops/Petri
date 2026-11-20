# A3 排版留白 · 门禁账（2026-11-20）

## 范围与裁决

- A0→A1→A2 之后，A3 落三条东方排版纪律到欢迎页与设置页：标题宽字距承载竖排重量、英/技术标签横排小字注脚、落印位 + 留白。
- 用户授权「开干 按照你的建议下一步」。

## 实现

- `welcome.module.css`：`.greeting` 加 `letter-spacing: 0.04em`（原 700 字重保留）；`.welcomeSub` 加 `0.02em`。
- `settings-redesign.module.css`：标题 `letter-spacing 0.01em→0.03em`；新增 `:global(.petri-settings-seal)::after` 3×3px 中性方点（`--petri-text-tertiary`，非 accent）。
- `DesktopSettingsPanel.tsx:187`：h2 增挂 `petri-settings-seal` class（唯一 TSX 改动，无结构变化）。
- 零新 token / 零依赖 / 未改 ratchet / 未增 accent 引用（棘轮只减不增守住）。

## A3 自身门（全绿）

| 门 | 结果 |
|---|---|
| HK-01 红→绿 | 红 4fail/1pass → 绿 5/5 |
| 邻域回归 | 4 files / 39 tests（A3 契约 + 主契约 19/19 + welcome 13 + settings exemption 2） |
| TSC | 0 error |
| accent ratchet | 19/19（未回潮） |

## 观感（零代签）

宽字距/落印位的真实观感保持 `UI-717 in_progress` 同族槽；静态测试只证明结构与 token 纪律，不声明视觉通过。偏好预审（用户既有「简单文字少、布局和谐」）需实机截图才触发，本包不伪造。

## HEAD 存量红（零触碰）

同 A0/A1/A2 `GATE-LEDGER.md` 六项，非 A3 文件面。
