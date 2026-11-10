---
capability: post-h9-k5-decision-material
status: reference
goal: 汇总 K5 的 U（perf 默认写盘 / 165 通道逐件裁决）与 V/L/E 边界，给一页决策材料与补腿条件，Agent 不代答、不伪造。
acceptance:
  - perf 默认写盘与干净树纪律的冲突逐项写明
  - T7 自然长任务 / DOM 真量测 / 冷启动 ×5 / 请求体占比的凭据与实机条件写明
  - EAR 45% 不缩分母、不改阈值凑达标
reopen: 用户裁决版本/证据写盘策略，或有效凭据与活 dev 栈到位后按补腿条件重开
---

# post-H9 K5 决策材料：证据写盘策略 / V·L 边界

> 状态：U 类 `pending_user_ruling` + V/L `external-blocked`/`deferred`。本材料是决策输入，不是验收证据；
> `evidenceClass: decision-material`，`verdict` 禁用 PASS/verified/completed。
> 生成：BLOCK-401（2026-11-10）。阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 一、现状（实证）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| perf 证据写盘 | `block350-perf-gate.mjs:93-96` `PETRI_PERF_EVIDENCE` 是 **opt-in**；注释「默认不写盘：每次 closeout 都写会在干净树上制造无意义 diff」；AUDIT-LOG 有同族裁决 | file:line |
| 连续 5 次采样 | `:58-60,83-88` 默认 `PETRI_PERF_SAMPLES=5`、最差轮为准、缺样本 fail-closed；`:38-49` 双判据；**已交付** | file:line |
| 四字段模板 | `:101-113` 显式写证据时带 `sourceCommit/platform/command/generatedAt`；`acceptance/post-s7-2026-11-09/h5/perf-evidence.json` 是 5/5 样本 | 证据 JSON |
| DOM/帧率 | `<20000` 在 `block95-a2-frame-live.cjs:84`（独立脚本非门）；8 档/270 帧读数在 `h8/dom-budget-live.json`（`verdict=measured`、`humanEyeEquivalent=false`），只取数不判通过 | file:line |
| 三矩阵 | matrix（functional-surface-audit）→ capability-map 下游派生；shelf-matrix 独立隔离后端数据源；`quality:surface` 接前两者，未接 shelf | `package.json:256` |
| 165 通道 | `surface-matrix.json` 仍 165；triage 124 needsWiring / 41 retain / 0 deletable；`post-s7-hygiene-gates.mjs:139` 明写「不删通道、不改 preload」 | file:line |
| EAR | 冻结 871/2013=43.3%，阈值 40（冻结达标线），45% 是目标；公式 `entries/totalFiles` | `block351-ear.mjs:19,37`、`assetized-manifest.json` |
| T7 | `acceptance/block-348/tasks.json:261-267` 仍 `windowOverride: 20000`；runner 无 key 全 skip（`block348-task-runner.mjs:252-255`）；`h8/closeout.json:47` 记 `ai-settings presets=0 / env 0 key` | file:line |
| roll-index | `--check` 预览支持存在（`docs-roll-index.mjs:242-253`），未挂进 closeout 14 门 | `package.json:177` |

## 二、候选（perf 默认写盘）

| 候选 | 做法 | 后果 |
| --- | --- | --- |
| **E1（推荐）** | 保持 opt-in；本程序用显式 `PETRI_PERF_EVIDENCE=<path>` 产出当次证据；把「四字段」做成严格证据元数据门覆盖本程序全部 JSON | 干净树与 P6 源绑定不破，零放宽基线；证据仍可复跑 |
| E2 | 按蓝图改成默认写 `acceptance/` | 每阶段 closeout 的 `quality:perf` 都会刷新 `generatedAt` → 工作树持续脏；`closeout:full` 干净树前提与 P6 `sourceCommitMatchesSourceHashes` 判据失效，等于用优化破坏证据纪律 |
| E3 | 默认写但「内容哈希稳定才写」 | 需定义内容等价判定并排除 `generatedAt`，改动 perf 门核心；可作为裁决后的折中方案，但需独立负测与干净树 ×3 验证 |

## 三、风险

- E2 会让本程序 K0 已取的 `closeout:full ×3` 干净树证据链失去可复现性；这与用户「任何没有当前证据的通过都不准写」直接冲突。
- 把离屏 CDP 帧时/节点读数写成「视觉绿」或「真实任务成功」→ 五类证据互相冒充。
- 为 EAR 45% 缩分母或把阈值 40 调低 → 放宽基线，红线禁止。
- 165 通道逐件「删通道」未经产品裁决会破坏 IPC 契约（`channels.js` 双向集合门）。

## 四、推荐

**E1**：保持 opt-in，交付严格证据元数据门（本程序 33 份 JSON 全合规、含 8 字段负测）、DOM 阈值纯函数门（植 2 万节点必红）、三矩阵/通道/EAR 机械对账；V/L 项逐件写补腿条件。

## 五、证据（当前）

`acceptance/post-h9-2026-11-10/k5/k5-evidence-metadata-gate.json`、`k5-perf-matrix-truth.json`、`k5-v-l-boundaries.json`、`k5-perf-evidence-explicit.json`；`test/post-h9-k5-perf-evidence.test.mjs` 22/22。

## 六、补腿条件

| 项 | 补腿条件 | 归属 |
| --- | --- | --- |
| perf 默认写盘 | 用户裁决 E1/E3 与「内容哈希稳定」定义；裁决后改实现 + 负测 + 干净树 `closeout:full` 验证 | U |
| DOM 节点上限/帧率入门禁 | 活 dev 栈 + 9223 离屏 CDP：植 2 万节点必红、P50/P95 同批落盘、「有栈才断言」显式条件；离屏读数不冒充视觉绿 | L + E |
| 冷启动真 ×5 与五段 | 独立重起矩阵 + 五段权威读数；不得用 H8 热栈 5 轮的 `cdpPageReady` 缺口冒充冷启动 | L |
| T7 自然长任务 | 有效凭据 + 去 `windowOverride` 的真实默认窗口触发压缩 + 20 FACT 全收 + 0 干预 + attempt 级 token/cache/duration/模型归因 | V |
| 请求体五类占比 | 真实 provider 逐轮与 `token_budget`/`ai_usage`/`ContextBudgetBar` 对账 | V |
| EAR 45% | 分子真实增长（新增被 test 引用的 acceptance 证据）+ 负测守住；不缩分母、不改阈值 | A + L |
| 165 通道逐件销号 | 用户裁决「接线/删/retain-with-reason」；接线项补用户入口、错误态、负测 | U |
| 三矩阵真同源 | 单一生成器重建三份产物 + 人工改动判红，属 W5b 结构性切片 | W5b |
| `docs:roll-index --check` 入门禁 | 评估预览语义与月度滚动冲突后接线 + 负测 | A |

## 边界声明

本材料覆盖 K5 的 U/V/L 边界，**未裁决/凭据未到位/实机栈未起前不生效**，不写 verified/completed，不冒充行为测试、机械门禁、CDP 实机、人眼观感或真实任务成功。按蓝图 §5.3，K5 不停线空等，队列推进到 K6。
