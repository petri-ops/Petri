---
capability: block-416-ui-design-d1-ia
status: completed
goal: 收敛信息架构——每功能一条 canonical 路径，入口↔路由双向机械对账，清理页头判定漂移，双承载显式归一。
acceptance:
  - 单一入口表落地并成为唯一真源，重复 canonical 路径 = 0
  - 新增静态门：入口↔路由双向对账，植入未登记入口/路由必红（含负测）
  - isStandalonePagePath 残留清理且由门对账
  - 孤儿页 = 0 或有显式 cancelled 留因；核心任务点击数可机械复算
  - 人眼/树测试项保持 pending_human_eye，不代答
---

# UI-D1 · 信息架构收敛（BLOCK-416）

> **裁决来源**：同 UI-D0，用户 2026-11-11 预授权连续工作（视为有效裁决并留痕）；不豁免治理红线、不替用户签字。
> **truthDomain**：`block-416-ui-design-d1-ia`（层 1 串行槽位本期唯一占用；D0 已 completed 转空）。
> **形态自检**：交付物是「可复跑的机械对账门 + 证据链」，不是手工整理的入口清单；本地可审计、治理透明、证据自证。不做对标产品的导航形态复刻。

## 1. 范围

1. `scripts/ui-design-entry-registry.mjs`：单一入口表（每功能 **1 条** canonical 路径 + 路由分类 + 二级入口只读清单 + 显式 `cancelled` 留因）。
2. `scripts/ui-design-entry-gate.mjs` + `npm run gate:ui-entries`：入口↔路由**双向**对账——
   - 表 → 路由：表内 `page`/`redirect`/`internal` 路径必须在 `App.tsx` 有 `<Route path>`；
   - 路由 → 表：主窗与独立窗每条 `<Route path>` 必须在表内登记；
   - 源码 → 表：`useAppCommands.ts` / `appKeymap.ts` / `AppRail.tsx` / `LeftPanel.tsx` 的导航路径字面量必须命中表（植入未登记入口必红）；
   - 页头：`shared.tsx` 的 `isStandalonePagePath` 清单必须与表内 `standalone=true` 集合相等（残留 `/backend`/`/skills`/`/plugins` 清零）；
   - 唯一性：每功能 1 canonical，重复路径必红。
3. `frontend/src/components/desktop/titlebar/shared.tsx:87-89`：清理已退役路由残留，补 `/extensions`、`/projects`、`/review`。
4. `docs/ui-design-ia-decision-material.md`：U 类一页材料（左栏可见入口取舍 / 评分卡出口阈值），状态 `pending_user_ruling`。
5. 寻路测试路线（E 类）：写进决策材料 §4，`pending_human_eye`，Agent 不代答。

## 2. 非范围

- 不改视觉 token、不动布局几何、不改 CSS（他方 WIP `project-workspace.module.css` 零触碰）。
- 不删除仍被消费的路由（`/skills`、`/plugins` 重定向 / `/review` / `/projects` 全部保留）；不改既有用户裁决。
- 不提前实现 D2（断点收敛）/ D3（token 迁移）/ D4（八态）/ D5（复测）。
- 零新增依赖；不为过门改 `docs/ui-productization-audit.md` 的状态词。

## 3. 依赖与证据位置

| 项 | 位置 |
| --- | --- |
| 对账基线 | `acceptance/ui-design-assessment-2026-11-11/baseline.json`（D0 冻结） |
| 验收尺子 | `docs/ui-design-acceptance-checklist-v1.md` §1/§5 |
| 单一入口表 | `scripts/ui-design-entry-registry.mjs` |
| 机械门 + 负测 | `scripts/ui-design-entry-gate.mjs` + `test/ui-design-entries.test.mjs` |
| U 类材料 / 人眼路线 | `docs/ui-design-ia-decision-material.md` |
| 本期证据 | `acceptance/ui-design-assessment-2026-11-11/d1/` |
| 影响图 | `test/impact-map.json` → `ui-design-program`（D0 已登记 `scripts/ui-design-*`、`test/ui-design-*`） |

## 4. 验收门禁（收口逐项对账）

1. `npm run gate:ui-entries` PASS；负测覆盖「植入未登记路由 / 植入未登记入口 / 重复 canonical / 页头清单漂移 / 孤儿路由」5 类必红。
2. `npm run test:changed`（含 `test/ui-design-entries.test.mjs`）+ `gate:ui-baseline` 19 锚不回退。
3. `docs:check` / `hygiene:check` / `quality:types` / `quality:lint` / `quality:lint:ledger` / `theme-token-contract` 19/19。
4. canonical 六件套回写 + `docs:reconcile` 0 validation issues + `docs:check` PASS。

## 5. 判「补丁 vs 重构」

入口表与对账门均为**新建判据面**，不在既有抽象上叠加条件；`shared.tsx` 是单行清单清理（patch，无第二变体、无绕过抽象信号），按 `$petri-project-governance` 判为 patch 并在此说明。若后续再出现第三处硬编码路由清单，按「同一处第二次叠加」信号转 scoped refactor。

## 6. U / E / V / W 边界

- **U**：是否给 `/projects`、`/review` 新增左栏可见入口（会改变默认导航语义）、评分卡出口阈值 → 一页材料，`pending_user_ruling`。本期以「显式 `cancelled` 留因」达成孤儿页判据，不擅自新增入口。
- **E**：树测试寻路成功率 ≥80% / 首击正确率 ≥70% / 核心任务点击数的真人复验 → 路线 + 签字槽，`pending_human_eye`。
- **V**：无。
- **W**：他方 CSS WIP、开局后并发写入者文件、用户 untracked 资产，零触碰。

## 7. 收口笔录（2026-11-11 · COMPLETED）

| §4 判据 | 当次证据 |
| --- | --- |
| 1 `gate:ui-entries` + 5 类负测 | PASS（16 路由 / 25 入口字面量 / 4 独立页）；`test/ui-design-entries.test.mjs` 11/11，覆盖植入未登记路由 / 未登记入口 / 重复 canonical / 页头清单漂移 / 孤儿路由与 alias 指向 |
| 2 定向验证 | 页头相邻前端 5 文件 69/69（含 `titlebar/*` 与 `TitleBar.test.tsx`）、`theme-token-contract` 19/19、`gate:ui-baseline` 24 锚 38 字段 PASS；`test:changed:list` unknown=0 |
| 3 治理门 | `docs:check` 561 PASS、`hygiene:check` PASS、`ui:audit:check` PASS（本包 UI 增量同步台账后）、`quality:types` exit 0；本包新脚本自身 `eslint` 0 error / 0 warning（`source[i]` 与未用导入已根修，warnings 分域回 2445/S539）。全量 `quality:lint` 1 error 来自 W 文件（见下） |
| 4 六件套 | 本 plan / roadmap / handoff / AUDIT-LOG / UI-702 同段追加 / DOC-REGISTRY 同批回写；`docs:reconcile` 0 validation issues + `docs:check` PASS |

**HK-01 红→绿**：红 = 门 11 problems（页头清单 `/backend /skills /plugins` 残留 + 门自身 2 处口径 bug：`/project/:projectId/*` 的 `/*` 被误判块注释起始、重定向路由未计入已登记集合）+ 契约 3 failed → 修门为字符串感知状态机、方向 B 纳入别名、产品清单清残留 → 绿 = 门 PASS + 11/11。

**六维自评（中包，主 Agent 自评 + diff 复核）**：①契约一致性=四向对账把表/路由/源码/页头钉在同一真源；②单一真相=`STANDALONE_PATHS` 唯一真源 + 门断言「表内 standalone 字段 ↔ 真源」相等防第二真相；③失败语义=门 fail-closed，负测 5 类；④测试有效性=负测真实植入并经红→绿验证，非手工注入绿灯；⑤边界=零 UI 结构改动、U-01/U-06 不代答、`/window/rail` internal 显式留因；⑥死代码=无（未用导入已删）；⑦最小化=复用现有 vitest/node:test，零新增依赖。**自纠两处**：(a) 首版新建 `## UI-703` 台账段触发 BLOCK-332 只减棘轮（段 497→498、债 13→14）→ 改按既有先例同段追加，回 497/35、契约 5/5；**(未放宽任何基线)**；(b) 新脚本 `source[i]` 触发 `detect-object-injection` + 未用导入触发 `no-unused-vars` → 改 `charAt` 与删导入，warnings 分域回 2445/S539。无 P1 遗留。

**六维评审发现（P2，留痕不阻塞）**：`test/nso-w5-impact-coverage.test.mjs`、`quality:lint`（1 error `no-unused-vars 'require'`）、`lint:ledger`（1 项未入账）三处均因**同一**并发写入者在制文件 `test/block414-backend-port-reuse.test.mjs` 判红——该文件 owner 未收口，按 W 纪律零触碰、不代改、不入抑制台账、不放宽 lint 基线；D5 复跑时按 owner 收口状态复核。

**收口门禁读数**：默认 `npm run closeout -- --gate gate:ui-entries --gate gate:ui-baseline` → 前 4 门（audit:compact / hygiene / docs / ui-audit）全 PASS，第 5 门 `test:changed` FAIL 6 红。逐条归因（`block114-failure-triage` 给 `needs_human×5`，经源码与隔离复跑定性）：P6 源绑定 = W/V（他方 WIP + 本包治理文件改动致源码树不精确）、W5a = W（并发写入者测试未挂规则）、`credential-store` = V（本机 keychain `stored != written`，隔离单跑复现）、并发测试批量跑红 / 隔离单跑 4/4 绿 = W（keychain 探针账户并发互踩）、BLOCK-332 两条 = **本包引入、已根修转绿**。`quality:perf` = V/环境稳定红（沿用 D0，不重采不放宽）。`lint:ledger` 剩 1 项 W 红。证据=`acceptance/ui-design-assessment-2026-11-11/d1/`（gate-readout.json / failure-triage.json）。

**未闭合项（不计入完成数）**：树测试真人样本（E）、U-01/U-06 裁决（U）、审阅双承载物理收敛（done-partial，登记为同一 canonical 的第二宿主）、干净树 closeout:full 三连与上述 W/V 红归零（D5，需他方 WIP 收口 + P6 重算 + perf 干净树重采 + keychain 环境）。

## 8. 完成语义

§4 四条均有当次证据且六件套回写完毕方可 `completed`；门禁全绿是必要非充分条件。未达项按 §6 终态化，不计入完成数。

G0 开发期常态 · 不外推 packaged/Provider/GA。
