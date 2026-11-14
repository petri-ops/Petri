---
capability: block-415-ui-design-d0-baseline
status: completed
goal: 冻结 UI 设计专项的量化尺子与验收判据，使 D1–D5 的分数与收敛量可比、可复算、可审计。
acceptance:
  - baseline.json 注册为对账基线并由机械门逐字段核对与评估报告 §1 相等（含植入篡改必红负测）
  - 产出《UI 验收清单 v1》：八态矩阵 / 几何四块 / 长内容三态 / 断点表 / 评分卡口径 / 五类证据定义
  - 门禁读数快照落 acceptance/，含他方 WIP 引起的红之归属
  - baseline.json 的 plan.started 由 false 转 true 并留痕
  - theme-token-contract 19/19、docs:check、hygiene:check PASS
---

# UI-D0 · 基线冻结与判据立标（BLOCK-415）

> **裁决来源**：用户 2026-11-11 预授权连续工作原话「依据评估基线独立完成全部六期优化，无需用户额外参与，工程判断全部下放并逐项留痕」；按 `$petri-dev-infra`「预授权连续工作模式」视为有效裁决并留痕。**该授权不豁免任何治理红线，也不等于替用户签字**（U/E/V/W 见 §6）。
> **truthDomain**：`block-415-ui-design-d0-baseline`（唯一；层 1 串行槽位本期占用，层 2 G0-LF 常驻不占槽位）。
> **形态自检**：本期把「尺子」本身做成可复跑的机械门禁 + 证据链（本地可审计 / 治理透明 / 证据自证），不做任何一次性视觉精修，不引入对标产品的形态复刻。

## 1. 范围

1. `acceptance/ui-design-assessment-2026-11-11/baseline.json` 注册为**对账基线唯一真源**：新增 `scripts/ui-design-baseline.mjs` 机械门 + `npm run gate:ui-baseline`，逐字段核对 `baseline.json` 与 `ASSESSMENT-AND-PLAN.md` §1 表格读数相等。
2. 产出 `docs/ui-design-acceptance-checklist-v1.md`（《UI 验收清单 v1》）：八态矩阵、几何四块、长内容三态、断点表、评分卡口径（每维可复算公式）、五类证据定义与互不冒充规则。
3. 当次门禁全量读数快照落 `acceptance/ui-design-assessment-2026-11-11/d0/`。
4. `baseline.json` 的 `plan.started` 由 `false` 转 `true`，附 `startedAt` / `startedBy` / `ruling` 留痕（**不改写既有 `plan.seq` 等历史事实字段**）。

## 2. 非范围（exclusions）

- **零 UI 代码改动**：不改 `frontend/src/**` 任何组件/样式；不动台账状态词、不动评分卡分数（分数仅在 D5 复测）。
- 不提前实现 D1（入口静态门）、D2（布局拆分）、D3（token 迁移）、D4（无障碍断言）、D5（评分卡复测）。
- 不新增任何依赖；不引入 axe / Storybook / 视觉回归工具（U 类，见 §6）。
- 不触碰在制 WIP 与用户资产（清单见 §5）。

## 3. 依赖与证据位置

| 项 | 位置 |
| --- | --- |
| 评估基线（advisory，不占槽位） | `acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md` |
| 对账基线（机器真源） | `acceptance/ui-design-assessment-2026-11-11/baseline.json` |
| 机械门 | `scripts/ui-design-baseline.mjs` + `test/ui-design-baseline.test.mjs`（负测） |
| 验收清单 | `docs/ui-design-acceptance-checklist-v1.md` |
| 本期证据 | `acceptance/ui-design-assessment-2026-11-11/d0/` |
| 影响图登记 | `test/impact-map.json` → `ui-design-d0-baseline` |

## 4. 验收门禁（收口逐项对账）

1. `npm run gate:ui-baseline` PASS（schema + §1 逐字段相等）；负测：篡改任一字段 / 植入未登记字段 / 删必需字段必红（契约测试 4 例）。
2. `cd frontend && npx vitest run src/styles/theme-token-contract.test.ts` → 19/19 PASS（当次）。
3. `npm run docs:check`、`npm run hygiene:check` PASS；`npm run ui:audit:check` 的红如实标注 W 归属。
4. `npm run test:changed`（影响图命中新增脚本与契约测试）+ `npm run docs:reconcile` 逐件复核 + `docs:check`。
5. 评分卡四维各有可复算口径（清单 §4）；静态分不写 `verified`。

## 5. 红线与在制 WIP 归属（W）

| 文件 | 归属 | 处置 |
| --- | --- | --- |
| `frontend/src/pages/project-workspace.module.css` | 他方 WIP（BLOCK-395 B-11，开局 M 11+/9−） | 零触碰、不代改、不 stage、不提交；其引起的 `ui:audit:check` 红归他方收口范围，**不为过门改台账** |
| `src/main/_backend-ports.js`、`test/block414-backend-port-reuse.test.mjs` | 开局后出现的并发写入者在制 | 零触碰、登记 owner 归属 |
| `assets/`、`docs/pelican-bicycle.html`、`docs/post-h9-optimization-blueprint-2026-11-10.md`、`model3d/enclosure-*.scene3d.json`、`petri-logo-concepts.miora` + `petri-logo-concepts_assets/`、`scripts/backfill-artifact-chain.mjs`、`tmp-block342-live/`、`tmp-review/`、`acceptance/nso-2026-11-06/.../summary-1793978091259.json`、`docs/archive/checkpoints/audit-log-*.md` | 用户资产 / 在制 | 零触碰、零 stage、零提交；收口显式路径枚举 |
| `acceptance/ui-design-assessment-2026-11-11/` | 本程序 canonical 基线（用户授权的可改面） | 仅本期 §1 明确的 `plan.started` 及新增 `d0/` 证据可写 |

## 6. U / E / V / W 边界（不代答）

- **U**：是否引入 axe / Storybook / 视觉回归依赖、断点档位数（D2）、评分卡出口阈值、i18n 范围 → 一页决策材料，`pending_user_ruling`，不改默认语义。
- **E**：22 条 `pending_human_eye`、暗色观感、读屏、SUS / 树测试真人样本 → 测试路线 + 签字槽，`pending_human_eye`，绝不写 verified。
- **V**：真实任务、外部量表平台、联网 CVE → `external-blocked` + 补腿条件。
- **W**：见 §5。

## 7. 收口笔录（2026-11-11 · COMPLETED）

| §4 判据 | 当次证据 |
| --- | --- |
| 1 机械门 + 4 类负测 | `gate:ui-baseline` PASS（24 锚 / 38 字段相等）；`test/ui-design-baseline.test.mjs` 9/9；负测覆盖篡改 / 删字段 / 未登记字段 / 报告锚点缺失 / schema 与 W 归属漂移 / 留痕回退 |
| 2 token 契约 | `theme-token-contract` 19/19 PASS（308ms） |
| 3 docs / hygiene | `docs:check` PASS 559；`hygiene:check` PASS；`ui:audit:check` **FAIL**（W 归属，见下） |
| 4 定向测试 + 治理 | `test:changed:list` unknown=0（新增脚本已挂 `ui-design-program` 规则）；`quality:lint` 0 error / 2445 warnings；`quality:lint:ledger` PASS（191 违规逐条相等、warnings 分域未上涨）；`quality:types` exit 0；`docs:reconcile` + `docs:check` 见收口命令输出 |
| 5 评分卡可复算 | `docs/ui-design-acceptance-checklist-v1.md` §5 定义 A/B/C/D 四维归一化公式与输入源；Before=3.0/3.5/3.5/4.5 锁在 `baseline.json.staticScores` |

**HK-01 红→绿**：红 = 门 FAIL 4 problems（`plan.started` 未转 + 2 留痕缺失 + 门自身把 `3.0` 折叠成 `3` 的口径 bug）、契约测试 2 failed → 修门为数值语义比对 + 补留痕 + 新脚本动态下标改自有属性描述符（消除 lint warning，基线未放宽）→ 绿 = 24/38 相等 + 9/9。

**六维自评（小包，单会话自评）**：①契约一致性=基线↔报告 §0/§1 由机械门锁定；②单一真相=`baseline.json` 唯一对账源，未建第二份；③失败语义=fail-closed 红而非静默；④测试有效性=负测 4 类植入必红且真实跑过；⑤边界=顶层键白名单；⑥死代码=无；⑦最小化=复用既有 vitest/node:test，零新增依赖。无 P1。

**红旗归属（W）**：`ui:audit:check` 报「工作区含 UI 改动但未同步台账」= 他方 `frontend/src/pages/project-workspace.module.css`（11+/9−）引起，D0 零 UI 代码改动，**按红线不为过门改台账**；开局后另新增 `src/main/_backend-ports.js` M 与 `test/block414-backend-port-reuse.test.mjs` untracked（并发写入者在制），零触碰。用户 10 项 untracked 资产零触碰、零 stage、零提交。

**收口门禁逐门读数（当次）**：`npm run closeout -- --skip=ui-audit,tests,quality:perf --gate gate:ui-baseline` → **19/19 门 PASS**（audit:compact / hygiene / docs / user-assets / version-parity / silent-catch / code-size / arch-cycles / css-modules / secret / arch / lint / lint:ledger / types / knip / post-h9-contracts / ear / surface / gate:ui-baseline）。**3 门被 `--skip` 排除且均未通过，不算 PASS、不表述为全绿**：
- `ui-audit` = W（他方 CSS WIP 引起）；
- `tests`（`test:changed`）= 2 红，均 W/V 归属：`p6_current_source_tree_not_exact`（detail = 他方 CSS WIP + 本包 `package.json` / `test/impact-map.json`，属 P6 源绑定需在干净树重算）、`W5a` 新测试 `test/block414-backend-port-reuse.test.mjs` 未挂规则（开局后并发写入者在制）。`block114-failure-triage` 归类 2 条 `needs_human`，经源码复核定性如上；其余 50 项 node 测试 + 14 项前端测试在该轮无本包引入红；
- `quality:perf` = V/环境：`packaged_start` 连续 5 轮稳定 495–587ms > 阈值 493ms（基线中位 379ms，2026-11-11T04:01Z 采样），隔离单跑更慢（564ms）故排除并发负载；本包零产品代码改动、热路径 sha 未变，**按红线不重采、不放宽阈值**。

**门禁自稳产物登记**：`audit:compact` 因既有 `docs/archive/checkpoints/audit-log-*.md` 为未提交用户资产，按既定纪律写带时间戳新文件（原件零触碰，mtime 09:37 未变）；`quality:surface` 生成器刷新 3 个矩阵文件。两者均本包零手动编辑、零 stage、零提交。

**未闭合项**：干净树 `closeout:full` 三连、`ui:audit:check` 转绿、`test:changed` 全绿、`quality:perf` 转绿留 D5（需他方 WIP 收口 + P6 源绑定重算 + perf 基线在干净树重采后复跑），本包如实标注、不计入完成数。证据=`acceptance/ui-design-assessment-2026-11-11/d0/`（gate-readout.json / gate-readout.txt / failure-triage.json）。

## 8. 完成语义

本期 `completed` 当且仅当 §4 五条均有当次证据且 canonical 六件套同批回写完毕；门禁全绿是必要条件不是充分条件。任何未达项按 §6 终态化，不计入完成数。

G0 开发期常态 · 不外推 packaged/Provider/GA。
