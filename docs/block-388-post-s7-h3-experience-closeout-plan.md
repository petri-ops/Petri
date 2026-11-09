---
capability: block-388-post-s7-h3-experience-closeout
status: completed
goal: 体验收官阶段里，凡**不需要实机就能证伪**的项先落地（台账测量口径、ARIA 语义、债棘轮），凡**必须实机量测才能动**的项一律不猜、不顺手改，改为带量测方案的挂起项。
acceptance:
  - UI 台账状态解析不再把「按纪律不标 verified」计为 verified；否定语境有契约测试
  - 台账债棘轮同时守分桶上限与总债上限，搬桶不算清偿
  - 分屏 handle 的 ARIA 角色从 separator 纠正为 slider，并有 role/值域/valuetext/键盘断言
  - DOM 预算 / 树 roving tabindex / 布局单源 / 主题收敛 / 32 条 debt 终态化：不实机不动，逐项写量测方案与重开条件
reopen: dev 栈（9223）可用且能造 ≥400 条会话数据时，按 §3 量测方案执行 DOM/帧率/键盘/几何四腿
---

# BLOCK-388 · post-S7 H3 体验收官（可机械验证子集）

> 发令：用户 2026-11-09 预授权连续工作（蓝图 H0→H7 全推）。上游 §4 H3（B-09 / B-10 / B-11 / B-12 / B-32）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。
>
> **本包的判断（留痕）**：H3 的其余项（消息/会话/结果库 DOM 预算、树 roving tabindex、布局单源、
> 颜色 token 收敛、32 条 debt 终态化）**共同前提都是实机量测**——蓝图自己也把「先用 CDP 量测
> ≥400 条会话的节点数与滚动帧率」写成重开条件。当前会话没有可用 dev 栈（无 CDP 腿），
> 此时改 `content-visibility`、重排布局或调色，属于「拿猜测替代测量」：既无法证明改善，
> 又可能破坏自绘滚动（`useScrollGuard` + `ChatScrollbar`）与几何。故按纪律**只做可机械验证子集**，
> 其余转挂起 + 量测方案，不冒充完成。

## 1. 交付

| 项 | 缺口 | 交付 | 证据 |
| --- | --- | --- | --- |
| 台账测量口径 | B-12 | `ui-ledger-triage.mjs` 状态词匹配前剥离否定语境（`不标/未标/不冒/不设/不作/非` + 状态词）；UI-694 / UI-663 由「误计 verified」回归未闭合 | 契约测试 +1（`UI-901/902/903` 合成台账：只有真 verified 计入）5/5 绿 |
| 债棘轮口径 | B-12 | 债务从「只守分桶」改为「分桶上限 + **总债**上限」双守；修测量口径后债 33→35 是**修正少算**而非新增，天花板随事实重贴并留因 | `test/ui-ledger-status-contract.test.mjs` 4→5 条 |
| ARIA 语义 | B-10（半） | `ArtifactPinPane` 分屏 handle：`role="separator"` + aria-value* → `role="slider"` + `aria-valuetext`（separator 不带值域，此前后矛盾） | `ArtifactPinPane.ratio.test.tsx` 7/7（新增 slider 语义断言：值域/valuetext/键盘改变/无 separator） |

## 2. 挂起项与量测方案（不实机不动）

| 项 | 缺口 | 为什么不动 | 量测方案（重开即照做） |
| --- | --- | --- | --- |
| 消息/会话/结果库 DOM 预算 | B-09 | 消息列表有自绘滚动（`useScrollGuard` + `ChatScrollbar` + `contain: layout style paint`），盲加 `content-visibility` 会改变滚动高度估算与锚定 | ①造 400/800 条会话 ②CDP `document.querySelectorAll('.sc-messages *').length` 取节点数；③滚动 2 屏测 `requestAnimationFrame` 帧间隔 P50/P95；④基线落盘后再加 cv + `contain-intrinsic-size`，同条件复测；⑤节点数不降或帧率不升即回滚 |
| 树 roving tabindex + 方向键 | B-10（半） | 键盘路径必须在真焦点模型里验（`inert`/折叠态交互），组件测试无法证明读屏行为 | ①键盘 Tab 进树 ②上下键移动焦点 ③左右键展开/折叠 ④录屏 + `document.activeElement` 断言 ⑤读屏（VoiceOver）过一遍 |
| 布局单源（CenterPanel 双层同名 layout） | B-11 | CSS 重构会改几何，必须几何量测前后对比 | ①量四块（左/中/右/浮层）`getBoundingClientRect` ②拖到两倍 / 缩到一半 ③对比 DOM 几何 JSON ④人眼过目截图（DOM 绿≠视觉绿） |
| 颜色字面量 token 收敛 | B-32 | 视觉变更无实机=不可证 | 截图 diff + 暗色态逐块对比；`theme-token-contract.test.ts` 扩扫描 |
| 32 条 debt 终态化 | B-12 | 需要 32 条各自的实机态或人眼 | 按 A/B/C/D/E 分诊：CDP 可代行的补腿，人眼项集中一次路线（见 H7 待人工清单） |
| 视觉验收四件套 | B-12 | 同上 | 元素级截图过目 / 可视列边界 + 祖先链溢出量测 / 长内容三态 / flex-grid 祖先链 `min-width:0` |

## 3. 证据

| 门 | 读数 |
| --- | --- |
| `test/ui-ledger-status-contract.test.mjs` | 5/5（含否定语境 + 总债上限） |
| `test/block326-audit-debt-sweep.test.mjs`（state 契约） | 5/5 |
| `ArtifactPinPane` 三件套 | 15/15；ratio 文件 7/7（含新 slider 断言） |
| `frontend tsc --noEmit` | 0 error |
| `npm run closeout` | 17 门全绿 |

## 4. 完成语义

`completed`（可机械验证子集；五项实机项挂起并带量测方案）。**未把任何 DOM 断言写成视觉绿**。

G0 开发期常态 · 不外推 packaged/Provider/GA。
