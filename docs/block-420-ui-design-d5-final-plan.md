---
capability: block-420-ui-design-d5-final
status: completed
goal: 把 D1–D4 可机械判据汇总为统一门禁、出 Before/After 同套评分卡复评表、逐件终态化全部发现、完成全程序收口。
acceptance:
  - gate:ui-program 汇总门禁逐个调用 6 个专项门并做负测（篡改任一门必红）
  - 视觉/几何回归 flow 在册（复用 D2/D4 的两个离屏 flow，不新建第二份）
  - Before/After 评分卡 A/B/C/D 同套口径逐维可比，每维有当前源码锚点或当次读数；静态分不冒充观感分
  - gap-ledger 把报告 §2 的 P0/P1/P2 发现逐件终态，零 in_progress、零编造、零冒充 verified
  - 六件套 canonical 同批回写；closeout:full 连续 3 次结果如实记录（不把 W/V 红写成通过）
---

# UI-D5 · 门禁化与复测（BLOCK-420，全程序收口）

> **裁决来源**：用户 2026-11-11 预授权连续工作（同 D0–D4，留痕于 `baseline.json.plan.ruling`）。
> **truthDomain**：`block-420-ui-design-d5-final`（层 1 唯一占用；D4 已 completed 转空）。
> **形态自检**：本期只做「判据汇总 + 证据复核 + 终态化」，不新开功能、不搞一次性视觉精修；每期改进最终都以可复跑门禁与证据链收束（本地可审计 / 治理透明 / 证据自证）。

## 1. 范围

1. `scripts/ui-design-program.mjs` + `npm run gate:ui-program`：单一汇总门，串行调用 6 个专项门（`ui-baseline` / `ui-entries` / `ui-breakpoints` / `ui-layout` / `ui-visual` / `ui-a11y`），汇总 PASS/FAIL、任一门非 0 即红；`test/ui-design-program.test.mjs` 负测覆盖「植入篡改任一门必红」「门缺失必红」「汇总结论不可伪造」。
2. **视觉/几何回归 flow**：复用 `.agents/skills/petri-dev-infra/dev-verify/flows/ui-d2-geometry-live.cjs` 与 `ui-d4-a11y-live.cjs`，在 `scripts/ui-design-program.mjs --flows` 里登记清单与证据路径，不另立第二份路线。
3. **Before/After 评分卡复评**：`acceptance/ui-design-assessment-2026-11-11/d5/before-after-scorecard.json` + 本 plan §3 复评表，按 `docs/ui-design-acceptance-checklist-v1.md` §5 的**同套** A/B/C/D 归一化公式与同组命令，每维列 Before（基线 3.0/3.5/3.5/4.5）、After 机械读数、逐条归因与源码锚点；静态分不写 `verified`、观感分留人测签字。
4. **gap-ledger 逐件终态**：`acceptance/ui-design-assessment-2026-11-11/d5/gap-ledger.json`，把报告 §2 的 P0/P1/P2 发现（A 6 条 / B 4 条 / C 5 条 / D 1 缺口 + D0–D4 增量项）逐件给终态：`done` / `done-partial` / `retain-with-reason` / `pending_human_eye` / `external-blocked` / `pending_user_ruling`，每条带证据路径与补腿条件，**零 in_progress**。
5. **干净树收口复核**：`npm run closeout:full` 连续 3 次如实记录退出码与摘要；他方 WIP / 并发写入者 / 环境类红按 W/V 归属如实标注，不冒充通过。

## 2. 非范围 / 边界

- 不新开功能、不改 UI 代码、不动台账状态词（除本期必要的同段追加）。
- 不擅自裁定 U 类（U-01 左栏入口 / U-02 评分卡出口阈值 / U-03 依赖 / U-04 断点档位数 / U-05 i18n / U-06 页头 bare 形态）；不代答 E 类（22 条人眼 / 暗色 / 读屏 / SUS / 树测试）；V 类标 `external-blocked`；W 类零触碰。
- 不把 `ui:audit:check` 因他方 WIP 的红洗成通过；不为过门改台账或放宽任何基线。
- 不把 `closeout:full` 的 SKIP / FAIL / 超时写成 PASS；`exit 124/125 = unknown`。

## 3. Before/After 评分卡（同套口径，D5 复评时填当次读数）

| 维 | Before（baseline.json） | After（当次机械读数） | 归因 | 证据锚点 |
| --- | --- | --- | --- | --- |
| A 布局与信息架构 | 3.0 | **3.8**（+0.8） | D1 入口单源 / D2 断点单源与布局唯一性门 / W 归属残留 | `gate:ui-entries` / `gate:ui-breakpoints` / `gate:ui-layout` |
| B 用户体验与交互 | 3.5 | **3.5**（0，不虚高） | D4 八态矩阵 / focus 只减棘轮 / 人眼未签 | `gate:ui-a11y` / `d4/ui-d4-a11y-live-darwin.json` |
| C 视觉一致性与设计感 | 3.5 | **4.0**（+0.5） | D3 hover/selected 单源 / 裸 z 111→104 / `;;` 非 WIP 清零 / 棘轮下调 | `theme-token-contract.test.ts` / `gate:ui-visual` |
| D 工程化标准与验收能力 | 4.5 | **4.7**（+0.2） | D0 尺子 + D1–D4 六门 + D5 汇总门 + 负测齐备 | `gate:ui-program` / `d0`–`d4/gate-readout.json` |

**综合**：3.6 → **4.0**（+0.4）。

**口径规则**：静态分 ≠ 实机观感分；人眼签字槽全空 ⇒ 所有观感维度不得写成 `verified`；Before/After 用同一公式与同一组命令，不回溯改历史分。

## 4. 验收门禁（收口逐项对账）

1. `gate:ui-program` PASS（6 门全绿）；负测覆盖篡改/缺门/结论伪造 3 类必红。
2. Before/After 复评表逐维有当前源码锚点或当次读数；`baseline.json` 的 `plan.started=true` 与 `gate:ui-baseline` 24 锚 38 字段不回退。
3. gap-ledger 逐件终态零 `in_progress`、零编造计数、零冒充 `verified`；U/E/V/W 四类各有补腿条件与重开判据。
4. `docs:reconcile` 0 issues + `docs:check` PASS + `theme-token-contract` 19/19 + `ui:audit:check` 绿或如实标注 W 归属。
5. canonical 六件套同批回写 + `npm run closeout:full` 连续 3 次结果如实记录。

## 5. 完成定义核对（§8 逐条）

D0–D5 六期单包串行收口、各有 closeout 证据与 canonical 回写；报告 §2 发现逐件终态；零新增依赖、零触碰用户资产与 WIP、零放宽基线、零撤销既有裁决；`Before/After` 同套可比；六件套同批；每次交付附 NEXT-STEP-BRIEF 与 skills 标签。**未达证据上限的项如实标未完成并给补腿条件**（尤其 W/V 红导致的 `closeout:full` 全门 PASS 不可达、人眼签字缺席、观感评分不可外推）。

G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 收口笔录（2026-11-11 · COMPLETED，程序终态 = `done-partial`）

### 6.1 §4 五条逐项对账

| 判据 | 当次证据 |
| --- | --- |
| 1 `gate:ui-program` + 3 类负测 | PASS 6/6 门（D0 baseline / D1 entries / D2 breakpoints+layout / D3 visual / D4 a11y）；`test/ui-design-program.test.mjs` 5/5（六门逐个植入失败必红、缺门、脚本不存在、结论伪造、证据在册、flow 复用） |
| 2 Before/After 同套评分卡 | `d5/before-after-scorecard.json`：Before 3.0/3.5/3.5/4.5（综合 3.6）→ After 3.8/3.5/4.0/4.7（综合 4.0），delta +0.8/0/+0.5/+0.2、综合 +0.4；每维有源码锚点与机械读数表。**自纠**：初版把清单 §5 公式分与专家静态分相减得出 B 维 −0.9 假下降，已改同套口径、机械表单列不折算 |
| 3 gap-ledger | `d5/gap-ledger.json` **32 条逐件终态，零 in_progress**：done 6 / done-partial 8 / retain-with-reason 5 / pending_human_eye 2 / external-blocked 4 / pending_user_ruling 7；`gate:ui-gaps` + 负测 4/4，计数由脚本复算不手写 |
| 4 治理门 | `docs:check` 566 PASS、`docs:reconcile` 0 issues、`hygiene` PASS、`ui:audit:check` PASS、`theme-token-contract` 19/19、`knip` 330 键零改动、`gate:code-size` PASS、`quality:types` 0 |
| 5 六件套 + 三连 | 本 plan / roadmap / handoff / AUDIT-LOG / UI-702 同段追加 / DOC-REGISTRY 同批；`closeout:full` 连续 3 次结果落 `d5/closeout-runs.json` |

### 6.2 `closeout:full` 三连的诚实结论（未达完成定义）

三次 `npm run closeout:full` 均 **exit 1**，前 4 门 PASS，第 5 门 `test:changed` fail-fast，红为 `p6_current_source_tree_not_exact`。detail 含本包 D3 收敛波及的 6 个 result-studio CSS + WIP CSS + `package.json` + `test/impact-map.json`。**归因**：本包真实改动引起 P6 证据源绑定不精确，叠加他方 WIP；不是产品缺陷，但**不得推给 W 类了事**。按 `dev-infra` 纪律，P6 重打要求仓库完全静默（实采到写盘之间 HEAD 不得前进、树不得有在制改动），当前树含他方 WIP / 并发写入者 / 用户资产，红线禁止触碰、暂存、提交，本程序也不得擅自重打 Result Studio 产品验收证据。

⇒ **§8 第 3 条「干净树 `closeout:full` 连续 3 次全门 PASS 0 SKIP」未达成**。补腿条件：他方 WIP 与并发写入者收口形成干净树 → 由 Result Studio 证据 owner 按既有流程重采 P6 → 复跑三连。定向收口链 `npm run closeout -- --skip=tests,quality:perf,quality:lint,quality:lint:ledger --gate ...` **25/25 门 PASS**；被排除的 4 门均未通过、不算 PASS。

### 6.3 §8 完成定义逐条核对

| # | 条目 | 结论 |
| --- | --- | --- |
| 1 | D0–D5 六期单包串行收口、各有 closeout 证据与 canonical 回写 | **达成**（19/19、19/19、21/21、23/23、24/24、25/25 定向门 + 六期 d0–d5 证据 + 六件套） |
| 2 | 报告 §2 发现逐件终态，零 in_progress / 零编造 / 零冒充 verified | **达成**（32 条，计数脚本复算） |
| 3 | 干净树 `closeout:full` 连续 3 次全门 PASS 0 SKIP；`theme-token-contract` 19/19；`docs:reconcile` 0 issues；`docs:check` PASS；`ui:audit:check` 绿或如实标注 | **未达成（三连 exit 1）**；其余子项达成，`ui:audit:check` 绿（本包 UI 增量已同步台账） |
| 4 | Before/After 同套评分卡、每维有源码锚点或当次读数；静态分 ≠ 观感分 | **达成**（主表同套专家静态口径 + 机械读数表；观感分待人测签字） |
| 5 | 六件套同批回写；AUDIT-LOG 登记启动/收口；DOC-REGISTRY 与 README 一致 | **达成** |
| 6 | 零新增依赖 / 零触碰用户资产与 WIP / 零放宽基线 / 零撤销既有裁决 | **达成**（各期 plan §W 表 + `gate:user-assets` PASS；`code-size --write` 判定为合法下调） |
| 7 | 每次交付附 NEXT-STEP-BRIEF 与 skills 标签；收口笔录只写一句 G0 常态 | **达成**（六期交付块在案） |

⇒ 依 §8「全部满足才可宣布 `completed`」与末句「未达证据上限的任何一项，如实标未完成并给补腿条件」，**本 UI 程序终态标 `done-partial`，不宣布 `completed`**。

### 6.4 六维自评与自纠

①契约一致性=汇总门逐门真实调用不伪造结论；②单一真相=评分卡/gap-ledger/flow 清单各一处；③失败语义=三连红不掩盖、补腿条件在册；④测试有效性=5+5+4 项植入必红 + 三连真实复跑；⑤边界=U/E/V/W 四类不代答、签字槽全空；⑥死代码=无；⑦最小化=零新增依赖、复用既有 flow 与台账段。**自纠三处**：评分卡口径混用（假下降）、gap-ledger 否定语境误判与补腿条件缺口、D4 实机焦点断言假绿（已在该期自纠）。无 P1 遗留。

G0 开发期常态 · 不外推 packaged/Provider/GA。
