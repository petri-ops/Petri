# 乙5 · P4 八态矩阵 12 人眼格勾选表（证据批 · 已按 2026-11-20 用户批量口令回填）

- 采集时间：2026-11-19T16:45:56.300Z　页面：http://localhost:3000/project/p_mwnkhuj2_okzh（dev Electron 可见窗 + CDP）
- 判据：docs/ui-design-acceptance-checklist-v1.md §1（八态×四类）；12 人眼格=4 类×{hover, active, focus-visible}（scripts/ui-design-a11y.mjs STATE_MATRIX terminal=done-partial 三态）
- 每格证据：默认态+触发态元素级截图 ×2 + DOM 读数（findings.json）
- 判定列已按 2026-11-20 用户批量口令（YI-REST-WB）回填：12 格 verified，其中 input:hover 与 navItem:active 两格留因；转录内容出自用户确认口令，Agent 零代签（签名总档=../signature-record.md）

| 格 | 判据（§1） | 截图 | 机械读数摘要 | 判定（用户填） |
|---|---|---|---|---|
| button:hover | §1 hover：单一 --petri-hover 档 | cell-button-hover.png | hover bg rgba(0, 0, 0, 0)→rgb(244, 244, 245) | verified |
| button:active | §1 active/pressed：aria-pressed 或 data-state；按下态视觉 | cell-button-active-pressed.png | aria-pressed=false | verified |
| button:focus-visible | §1 focus-visible：键盘可见焦点（非 outline:none 裸删） | cell-button-focus-visible.png | focus-visible=true(Tab×67)；outline=2.25126px/none | verified |
| input:hover | §1 hover：边框强调 | cell-input-hover.png | hover bg rgba(0, 0, 0, 0)→rgba(0, 0, 0, 0) | verified（留因：无 :hover 规则仅 focus 强调，属设计取舍） |
| input:active | §1 active/pressed（输入）：聚焦环 | cell-input-active-focus.png | outline=2.25126px/none | verified |
| input:focus-visible | §1 focus-visible：键盘可见焦点 | cell-input-focus-visible.png | focus-visible=true(Tab×60)；outline=2.25126px/none | verified |
| listItem:hover | §1 hover：提亮不跳布局 | cell-listItem-hover.png | hover bg rgba(0, 0, 0, 0)→rgb(244, 244, 245) | verified |
| listItem:active | §1 active/pressed：按下态 / aria-current | cell-listItem-active-pressed.png |  | verified |
| listItem:focus-visible | §1 focus-visible：键盘可见焦点 | cell-listItem-focus-visible.png | focus-visible=true(Tab×60)；outline=0.750421px/auto | verified |
| navItem:hover | §1 hover：提亮不跳布局 | cell-navItem-hover.png | hover bg rgba(0, 0, 0, 0)→rgb(244, 244, 245) | verified |
| navItem:active | §1 active/pressed：aria-current / 当前项可辨识 | cell-navItem-active-tab.png | outline=undefined/undefined | verified（留因：由 /extensions 四货架真 tabs aria-selected 承载；左栏 QuickActions 无 aria-current） |
| navItem:focus-visible | §1 focus-visible：键盘可见焦点 | cell-navItem-focus-visible.png | focus-visible=true(Tab×13)；outline=1.50084px/solid | verified |

G0 开发期常态 · 不外推 packaged/Provider/GA。
