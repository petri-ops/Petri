# A2 造型图标原子 · 门禁账（2026-11-20）

## 范围与裁决

- A0 裁决「行」+ A1 色板 token 之后，A2 落地三原子：开环（empty state）/ 错落四格一格点睛（tab active）/ 发丝线（作为 Icon 单源原子登记，分隔语义走既有 hairline 纪律，不新增描边）。
- 复用既有自绘单源 `frontend/src/components/icons/Icon.tsx`（24×24 / stroke 1.75 / currentColor / round caps），**零新图标依赖**。

## A2 自身门（全绿）

| 门 | 结果 | 证据 |
|---|---|---|
| HK-01 红→绿 | 红 5fail/1pass → 绿 6/6 | `hk01-red.txt` / `hk01-green.txt` |
| 邻域回归 | 6 files / 71 tests PASS（icon / 两契约 / extensions index / McpShelfPane / LeftPanel） | vitest 16:20:43 |
| 主 token 契约 | 19/19（accent ratchet 未放宽） | 同上 |
| TSC | 0 error | `npx tsc --noEmit -p tsconfig.json` |
| 点睛面积 | offset-grid 每视图 ≤1 实例（仅 active 分支渲染） | IdentityAtoms.test.tsx |
| 零依赖 | lucide/phosphor/react-icons/heroicons 均未引入 | IdentityAtoms.test.tsx |

## 实现要点

- `IconName` + `paths` 新增 `'open-ring'` / `'offset-grid'` / `'hairline'`（引号因连字符；同笔画族、无 fill/裸色）。
- `McpShelfPane` 空态 `zap` → `open-ring`（缺口朝下=不闭合/留余地）。
- `extensions/index.tsx` active tab 渲染 `offset-grid`（一格点睛小点），每视图仅 1 个。
- 未改 `--petri-accent` / 未加 CSS 新色（避免 ratchet 回潮）；颜色继承父级 currentColor，active 由既有 `.shelfTabActive` 提供 accent。

## 观感（零代签）

空态/active 的观感（点睛面积、开环缺口观感）保持 `UI-717 in_progress` 同族槽：无偏好预审闭环的实机截图前不翻 verified。静态测试只证明结构。

## HEAD 存量红（零触碰）

同 A0/A1 `GATE-LEDGER.md`：test:changed 裸文件名 / user-assets / silent-catch / lint / knip / code-size 六项均非 A2 文件面。
