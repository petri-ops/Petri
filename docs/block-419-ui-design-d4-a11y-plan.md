---
capability: block-419-ui-design-d4-a11y
status: completed
goal: 交互状态与无障碍闭环——八态矩阵机械覆盖、focus-visible 守护、WCAG AA 可算部分自动化、9223 离屏实机、人眼路线集中签字槽。
acceptance:
  - 八态矩阵（default/hover/active/disabled/loading/empty/error/focus-visible）逐格有可复跑判据，零空格或显式 cancelled 留因
  - focus-visible 机械门：裸 outline:none 无焦点替代必红；植入违规必红负测
  - WCAG AA 对比度 ≥4.5:1（大字 3:1）用零依赖纯函数计算，token 阶梯逐对对账 + 负测
  - 22 条 pending_human_eye 人测路线与签字槽集中留册，Agent 不代答、不冒 verified
  - 9223 离屏实机证据落盘；不开可见窗口、不设 PETRI_TEST_ONSCREEN、跑完立即 kill
---

# UI-D4 · 交互状态与无障碍闭环（BLOCK-419）

> **裁决来源**：用户 2026-11-11 预授权连续工作（同 D0–D3，留痕于 `baseline.json.plan.ruling`）。
> **truthDomain**：`block-419-ui-design-d4-a11y`（层 1 唯一占用；D3 已 completed 转空）。
> **形态自检**：把「状态完备性」落成可复跑机械门 + 证据链（本地可审计 / 治理透明 / 证据自证），不做一次性视觉精修；机械可算项与人眼项严格分家。

## 1. 范围

1. `scripts/ui-design-a11y.mjs` + `npm run gate:ui-a11y`：
   - **八态矩阵**：按四类可交互元件 × 八态 = 32 格，逐格登记「规则选择器 / 机械判据 / 证据类型 / 终态」；空格必红（或 `cancelled` 留因）。
   - **focus-visible 守护**：扫 CSS 里的 `outline: none`（当次 39 处），要求每处同规则块或相邻规则有 `:focus-visible` 焦点替代；植入裸 `outline:none` 无替代必红负测。
   - **WCAG AA 对比度**：零依赖纯函数 `relativeLuminance` / `contrastRatio`（WCAG 2.1 相对亮度公式），对 `custom.css` 亮暗两套的「文字四级 × 表面四级」逐对计算，正文 ≥4.5:1、大字 ≥3:1；不达标项如实登记 `done-partial` + 原因，不擅自改色值（观感归 E）。
   - **状态机完整性**：`loading` / `empty` / `error` 三态在组件源码里是否有 `aria-busy` / 空态文案 / `role=alert|status` 的机械覆盖率报告。
2. `test/ui-design-a11y.test.mjs`：负测覆盖植入无焦点替代的 `outline:none`、低对比度、八态空格、亮度公式边界（黑/白/透明度）、篡改 token 对账表 5 类必红。
3. **人眼路线集中化**：`docs/ui-design-human-eye-route.md` 汇总 22 条 `pending_human_eye`（来自 `acceptance/block-332/ui-ledger-triage.json`）+ 暗色观感 / 读屏 / SUS 树测试路线，每条含步骤、输入、每步预期、证据留存点，集中签字槽全空；复用 `docs/post-s7-h7-human-eye-route.md`，不另立第二份逐条路线。
4. **9223 离屏实机**：`ui-d4-a11y-live` flow 做 DOM 级焦点/ARIA/对比度读数（只读、不导航用户窗、不触发运行时 show()），证据落 `d4/`；截图失败标 `screenshot_unavailable`。

## 2. 非范围 / 边界（硬红线）

| 项 | 归属 | 处置 |
| --- | --- | --- |
| 22 条 `pending_human_eye`、暗色观感、VoiceOver 朗读、对比度观感、SUS / 树测试真人样本 | E 类 | 路线 + 签字槽，`pending_human_eye`，**绝不写 verified** |
| 真实任务 / 外部量表平台 | V 类 | `external-blocked` + 补腿条件 |
| WIP CSS `frontend/src/pages/project-workspace.module.css`、并发写入者 `src/main/_backend-ports.js` + `test/block414-backend-port-reuse.test.mjs`、用户 untracked 资产 | W 类 | 零触碰、零 stage、零提交 |
| axe-core / Storybook / 视觉回归依赖 | U-03 | 零新增依赖，用现有 vitest + 纯函数 |
| 阈值口径变更（4.5:1 / 3:1） | 标准 | 不擅自放宽；不达标如实登记 |
| 观感分 | E 类 | 静态/机械分 ≠ 观感分，Agent 不代答 |

**判「补丁 vs 重构」**：新建判据面 + 纯函数门，无既有抽象叠加；实机 face 按 HK-01 豁免四类之「无法单测的实机面」走无人化阶梯第 1 级（CDP flow）。

## 3. 依赖与证据位置

| 项 | 位置 |
| --- | --- |
| 尺子 | `docs/ui-design-acceptance-checklist-v1.md` §1 八态矩阵 / §6 五类证据 |
| U/E 材料 | `docs/ui-design-ia-decision-material.md`、`docs/ui-design-human-eye-route.md`（本期） |
| 机械门 + 纯函数 | `scripts/ui-design-a11y.mjs`、`test/ui-design-a11y.test.mjs` |
| 实机 | `acceptance/ui-design-assessment-2026-11-11/d4/` |

## 4. 验收门禁（收口逐项对账）

1. `gate:ui-a11y` PASS，5 类植入必红负测；八态矩阵 32 格零无据空格。
2. `theme-token-contract` 19/19、D0–D3 六门零回退、受影响前端测试同套绿。
3. `docs:check` / `hygiene:check` / `quality:types` / `ui:audit:check` / `quality:lint`。
4. 人眼路线签字槽全空且状态 `pending_human_eye`；`ui:audit:triage` 的 debt 35 零改动。
5. 9223 实机证据落盘或 `external-blocked` 如实标注；canonical 六件套 + `docs:reconcile` 0 issues。

## 5. 完成语义

§4 五条逐项有当次证据，未达项按 §2 终态化、不计入完成数；门禁全绿是必要非充分条件。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口笔录（2026-11-11 · COMPLETED，带 done-partial / pending_human_eye）

| §4 判据 | 当次证据 |
| --- | --- |
| 1 `gate:ui-a11y` + 5 类负测 | PASS（八态矩阵 32/32 有判据、focus 缺口 12 文件/16 声明 ≤ 冻结、对比度 32 对计算、状态机证据 3/94/56/19）；`test/ui-design-a11y.test.mjs` 7/7，含亮度公式边界（黑白 21:1）、八态空格、缺口新增、token 表篡改、阈值放宽、WIP 只读 |
| 2 六门零回退 | D0–D3 六门全绿；`theme-token-contract` 19/19；`ui-ledger-status-contract` 5/5（497 段 / debt 35 零改动） |
| 3 治理门 | `docs:check` 565 PASS、`hygiene` PASS、`ui:audit:check` PASS、`knip` 330 键零改动、`gate:code-size` PASS、`quality:types` 0 |
| 4 人眼路线 | `docs/ui-design-human-eye-route.md`：22 条 debt 索引 + H-01~H-08 增量，签字槽**全空**，状态 `pending_human_eye`；复用 `docs/post-s7-h7-human-eye-route.md` 不另立第二份逐条路线 |
| 5 实机 | `ui-d4-a11y-live` 9223 离屏 **8/9 allPass=false**（诚实判红），证据 JSON + PNG 落 `d4/`；两次实例跑完立即 kill（REMAIN=0）、未设 `PETRI_TEST_ONSCREEN`；canonical 六件套 + `docs:reconcile` 0 issues |

**实机自纠（关键）**：首跑 9/9 假绿——`focus_outline_readable` 断言用 `outlineWidth !== 0` 就把 `outlineStyle: "none"` 判成焦点可见。经复核改为 `outlineStyle !== 'none'` 并复跑，取 **8/9 诚实红**：`focus_ring_not_observable` 明确记录焦点环不可见，登记为 H-06 补腿。首跑 9/9 **作废不复用**。截图为全页 PNG 非元素级裁剪；`aria-live` 当次仅 1 处（欢迎页面，非工作区全量）。

**六维自评**：①契约一致性=八态清单与门、token 表与源码双向对账；②单一真相=人眼路线集中一处、U 材料不复制；③失败语义=focus 缺口只减棘轮 + 实机判红不掩盖；④测试有效性=7 项植入必红 + 实机假绿自纠；⑤边界=WIP/并发写入者零触碰、U/E/V 不代答、离屏纪律；⑥死代码=无；⑦最小化=零新增依赖、WCAG 纯函数自研。**自纠两处**：token 对账正则未分区导致明暗误比（改按 dark 块切分）、实机焦点断言假绿（改判红）。无 P1 遗留。

**收口门禁**：`npm run closeout -- --skip=tests,quality:perf,quality:lint,quality:lint:ledger --gate ...` → **24/24 门 PASS**。4 门显式排除且均未通过、不算 PASS（沿用 D1–D3 的 W/V 归因：`tests` = P6/W5a/keychain/并发测试、`perf` = V/环境稳定红、`lint`/`lint:ledger` = 并发写入者 W 文件 1 项 `no-unused-vars`）。证据=`acceptance/ui-design-assessment-2026-11-11/d4/gate-readout.json`。

**未闭合项（D5 终态化）**：`light tertiary on subtle` 4.40:1（<4.5，大字 3:1 可适用，人眼判定 H-05）；12 文件 / 16 声明 focus 缺口需独立切片补 `:focus-visible` + code-size 联动重打；实机焦点环不可见（H-06）；八态 hover/active/focus-visible 观感；22 条 debt 与 SUS/树测试真人样本 `pending_human_eye` / `external-blocked`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
