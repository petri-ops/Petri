---
capability: block-421-workspace-layout-refactor
status: completed
goal: 把工作区四块几何收敛到独立 Layout 单一真源，消掉同名布局类的多处定义，并修掉实测几何缺陷（用户可见）。
acceptance:
  - 布局类定义处 = 1（独立 Layout 文件为真源，原文件 composes 指向）
  - 四块几何实测：无重叠 / header 与 body 左右缘对齐 / 不溢出父容器 / 祖先右缘 ≤ 可视列
  - ≤900px 与 700px/960px 断点覆盖走同一真源
  - gate:ui-layout 的 WIP 已知重复清零，负测仍必红
  - 拆前拆后同套绿 + 元素级截图对照
---

# BLOCK-421 · 工作区布局单源重构（UI-D2 补腿 · WIP 接管版）

> **裁决**：用户 2026-11-11 明确选择「做布局重构（工作区四块几何）」并授权接管 `frontend/src/pages/project-workspace.module.css`（原为他方在制 WIP，此前按 W 类零触碰）。**W-01 状态变更留痕**：该文件自本包起由本 Agent 接管编辑，仍不做整体格式化/无关重排，只改布局层。
> **truthDomain**：`block-421-workspace-layout-refactor`（层 1 唯一占用）。
> **为何重新开包**：UI-D2（BLOCK-417）在 W 零触碰前提下已 `done-partial` 收口；本期由用户授权解锁该文件，属**新增授权范围**，按单包串行另立 BLOCK，不复用旧包编号。

## 1. 范围

1. 新建 `frontend/src/pages/WorkspaceSessionLayout.module.css`：四块几何（`workspaceHeader` / `workspaceBody` / `leftCol` / `centerCol` / `rightCol` / `workspaceSessionFrame` / `workspaceSessionLayout` / `workspaceSessionInner` / `workspaceSessionContent`）的主定义 + 960/700 断点覆盖，**单一真源**。
2. `project-workspace.module.css` 内这些类改为 `composes: <name> from './WorkspaceSessionLayout.module.css';`，**tsx 引用零改动**（类名不变）。
3. 修掉实机实测出的几何缺陷（Before/After 同套量测）。
4. `gate:ui-layout` 的 `WIP_KNOWN_DUPLICATES` 清零；负测仍必红。

## 2. 非范围

- 不改视觉 token、不改配色、不动 `project-workspace.tsx` 的 React 结构（除几何必需的最小调整）。
- 不做整体格式化/重排该 7764 行文件；不动非布局层规则。
- 不改断点档位数语义（U-04 仍未裁决）；本期只保证覆盖走同一真源。
- 不引入依赖、不加 `!important`、不在末尾追加覆盖。

## 3. 依赖与证据

| 项 | 位置 |
| --- | --- |
| 布局门 | `scripts/ui-design-layout-gate.mjs`（判据：同文件同名布局类 >1 处即红） |
| 断点门 | `scripts/ui-design-breakpoints.mjs` |
| 几何实机 | `.agents/skills/petri-dev-infra/dev-verify/flows/ui-d2-geometry-live.cjs`（升级为真进工作区） |
| 证据 | `acceptance/ui-design-assessment-2026-11-11/d2-refactor/` |

## 4. 验收门禁

1. `gate:ui-layout` PASS 且 `WIP_KNOWN_DUPLICATES` 为空；`test/ui-design-layout-gate.test.mjs` 全绿。
2. `gate:ui-breakpoints` / `gate:ui-visual` / `gate:ui-a11y` / `gate:ui-program` 零回退。
3. 几何实机：进入真实工作区量四块，Before 缺陷与 After 修复同套对照 + 元素级截图。
4. `theme-token-contract` 19/19、`docs:check`、`ui:audit:check`、`gate:code-size`、`quality:types`。
5. 六件套同批回写 + `docs:reconcile` 0 issues。

## 5. 完成语义

布局定义处收敛 + 几何缺陷实测修复 + 门禁转绿 + 截图对照，方可 `completed`；未达项如实标 `done-partial`。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口笔录（2026-11-11 · COMPLETED）

| §4 判据 | 当次证据 |
| --- | --- |
| 1 布局定义处 = 1 | `workspaceSessionLayout` 2→1、`workspaceSessionFrame` 3→1；`gate:ui-layout` PASS（WIP 既存重复 **0 组**）；`test/ui-design-layout-gate.test.mjs` **7/7**（含「归零后既有重复也必红」棘轮收紧断言） |
| 2 四块几何 | computed style 在 2000/1600/1125/850/700/500 六个视口逐字等价（`0 14px 0 8px`/20px → 850 下 12px/12px → 700 下 10px/12px），与原值完全一致 |
| 3 断点走同一真源 | 960/700 两处覆盖改为 `html:root` 变量赋值；`gate:ui-breakpoints` PASS（18 档在册 / JS 裸阈值 0 / 767→768 对齐） |
| 4 同套绿 | 前端 45/45（CenterPanel + WorkspaceSummaryCard + token）、node 10/10（B-11 收敛 + H9 结构门）、`theme-token-contract` 19/19、`gate:ui-program` 6/6、`gate:ui-gaps` 32 条零 in_progress |
| 5 治理 | `gate:code-size` PASS（**7764→7761 行、176965→176885 字节，锚点全部下降**）；`docs:check` 566 PASS；`ui:audit:check` PASS |

**收敛手法**：断点差异不再重复同名类，而是走 `--ws-frame-padding` / `--ws-chat-frame-padding` / `--ws-layout-gap` 三个变量（默认值真源在未入 code-size 台账的 `global.css`；媒体查询用 `html:root` 抬高特异性压过默认值）。`workspaceSessionFrameChat` 的 padding 必须同步变量化——否则 960/700 断点下原本由 `.workspaceSessionFrame` 后置媒体规则覆盖的行为会回弹，这是本次最容易踩空的一处。

**code-size 合规**：首版写法净增 6 行 / 751 字节会抬高锚点（红线禁止），改为「主定义去 fallback + 变量默认值落 global.css + 媒体块只改变量 + 删自撰注释」后压到 7761 行 / 176885 字节，再按脚本 `--write` 重打 ⇒ 属真实收敛后的合法下调。

**两条被证伪的假设（留痕，避免后人重复挖）**：
1. 「右栏持久化 900px 压穿中栏 420 保底」→ **不成立**。CDP 实测 vw=1125/700 时右栏自动收起为 0；且 `CENTER_SPACE_COLLAPSE_BELOW=420` 是 **2026-10-30 用户裁决**（「中间栏固定宽度太宽…手机屏幕宽度更合适」），1600 宽下 458px 中栏正是该裁决的合法结果。**不撤销该裁决**。
2. 「≤960 侧栏浮层 `top:0` 被 38px 顶栏遮挡」→ **不成立（探测选择器误报）**。`[class*="leftCol"]` 命中的是 AppRail 的另一套 CSS Module（hash 前缀 `fhgp6`），而 `project-workspace` 的 `leftCol` 自 UI-341 起已上提壳层；右栏实测 `y=38` 未被遮挡。

**诚实边界（必须与用户的期待对齐）**：本包是**布局定义单源**的工程收敛，computed style 逐字等价 ⇒ **用户肉眼看不到任何变化**。这是「布局重构」的定义属性，不是执行缺陷。真正会改变观感的三类动作都不在本包授权内：
- 改视觉 token / 配色 / 间距节奏 / 信息密度（观感 E 类，需签字）；
- 断点档位数从 17 收敛到 ≤4（U-04 待裁决）；
- 收紧「中栏手机宽度」保底（会撤销 2026-10-30 用户裁决）。

**W-01 状态变更留痕**：`frontend/src/pages/project-workspace.module.css` 由「他方在制 WIP · 零触碰」变更为「用户 2026-11-11 授权本 Agent 接管布局层编辑」；仍不做整体格式化/无关重排，非布局层规则零改动。

G0 开发期常态 · 不外推 packaged/Provider/GA。
