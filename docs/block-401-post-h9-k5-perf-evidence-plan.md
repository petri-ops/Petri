---
capability: block-401-post-h9-k5-perf-evidence
status: completed
goal: 按第四轮蓝图 §4 K5 把「毫秒门稳定绿」升级为「长会话、长列表、大项目、冷启动、证据资产都有持续预算与可复跑读数」；可机械验证的做成门与对账，V/L/E 边界逐件出材料不代答。
acceptance:
  - 新证据元数据门（四字段 + 五类不冒充）带负测，历史证据不回填
  - 三矩阵同源性与人工改动判红有机械证据，165 通道零静默消失
  - EAR 分子分母如实报，不缩分母、不改阈值凑达标
  - perf 默认写盘的干净树冲突逐件写明，不擅自改既有裁决
  - T7 自然长任务 / DOM 真量测 / 冷启动 ×5 逐件 V/L 边界材料
  - docs:check / ui:audit:check / 定向 test:changed / closeout 全绿
reopen: 有效凭据到位 / 活 dev 栈 + 9223 离屏 CDP 可用后按 §5 补腿条件重开
---

# BLOCK-401 · post-H9 K5 性能与证据门禁化

> 状态：completed · COMPLETED
> 发令：用户 2026-11-10 预授权连续工作「K0→K7 全部推完，全程零参与」。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## §1 立项自检（产品个性 · 强制问句）

**与 ZCode/Codex 的差别形态**：①**本地可审计**——证据四字段、矩阵同源、EAR 分子分母、通道账本全部由仓内脚本复算，不依赖云端报表；②**治理透明**——perf 默认写盘与干净树纪律冲突时出 U 类材料而非擅自改，V/L 项逐件标补腿条件；③**证据自证**——新机械门自带篡改负测，机械门禁/实机/人眼/真实任务四类严格分级。形态上是「通用 agent 可靠性维度的证据资产」，不是领域内容。

## §2 运行时核实与一处目标冲突（必须诚实登记）

| 蓝图改进点 | 实码核实 | 处置 |
| --- | --- | --- |
| 「`PETRI_PERF_EVIDENCE` 由 opt-in 改默认写 `acceptance/`」 | `block350-perf-gate.mjs:93-96` 明确 **opt-in 且默认不写盘**，理由「每次 closeout 都写会在干净树上制造无意义 diff」（AUDIT-LOG 亦有裁决）。本程序每阶段跑 closeout，默认写盘会让 `quality:perf` 每次刷新 `generatedAt` → 工作树持续脏、P6 源绑定与 `closeout:full` 干净树判据失效 | **不擅自改**；出 U 类材料（候选/风险/推荐/补腿条件），保留 opt-in，用显式路径产出当次证据 |
| 「冷启动 ×5 与热栈 5 轮分别取数」 | K0 已把两者分开并用 12 条篡改负测钉死；H10 `cold-start-x5.json`（tracked）有真 ×5 且 `cdpPageReady=0` 诚实缺口 | K-03 终态升级为 done（校准链完整）；「有活栈才断言」入门禁仍属 L |
| 「DOM 节点上限门补植 2 万节点必红负测」 | `<20000` 在 `block95-a2-frame-live.cjs:84` 是独立脚本非门；8 档/270 帧是 `post-s7-dom-budget-live.cjs` 只取数不判通过证据 | 加**纯函数阈值门 + 负测**（不需要活栈的判定器），不把离屏读数冒充视觉绿；真量测入门禁属 L |
| 「三矩阵同源 / 人工改动判红」 | `functional-surface-audit.mjs` 产 matrix、`block357-capability-map.mjs` 是其下游派生、`block352-shelf-audit.mjs` 是独立隔离后端数据源（三份非同一生成器）；`quality:surface` 只接前两者 | 加同源性机械对账 + 人工改动判红负测；真同源改造属 W5b |
| 「165 通道逐件销号」 | `surface-matrix.json` 仍 165；K1 已交付 124/41 机械分诊；`post-s7-hygiene-gates.mjs:139` 明写「不删通道、不改 preload」 | 逐件裁决需产品语义 U 类；本阶段做零静默消失账本校核 |
| 「EAR 45% 分子增长 + 负测守住」 | `block351-ear.mjs:19` 阈值 40（冻结达标线），冻结 manifest 871/2013=43.3%；45% 是目标 | 如实报分子分母，不缩分母、不改阈值；达标需真实新增被引用证据 |
| 「T7 去 windowOverride 自然长任务」 | `acceptance/block-348/tasks.json:261-267` 仍 `windowOverride: 20000`；runner 依赖真实凭据、无 key 全 skip（`block348-task-runner.mjs:252-255`） | V 类 external-blocked |

## §3 交付（机械可验证子集）

1. `scripts/lib/post-h9-k5-evidence-gate.mjs`：新证据元数据门（本程序 `acceptance/post-h9-2026-11-10/**` 全部四字段齐备 + 五类不冒充 + 决策材料不写 PASS），历史证据（`post-s7-*`）明确排除、不回填。
2. `scripts/lib/post-h9-k5-perf-matrix.mjs`：DOM 阈值纯判定器（植 2 万节点必红）、三矩阵同源对账、165 通道账本、EAR 分子分母复算（纯函数 + 只读）。
3. `test/post-h9-k5-perf-evidence.test.mjs`：逐条负测（缺字段/冒充人眼/决策材料写 PASS/节点超限/矩阵漂移/通道消失/EAR 缩分母）。
4. `docs/post-h9-k5-decision-material.md`：U 类（perf 默认写盘冲突 / 165 通道裁决）+ V/L 边界（T7、DOM 真量测、冷启动 ×5、请求体占比、attempt 级证据）。
5. K-03/04/23/24/25/26/32 逐件终态 + 当次 perf 显式证据。

## §4 范围 / 非范围 / 风险

- **范围**：见 §3 五项 + 门禁取证。
- **非范围**：不改 `block350-perf-gate.mjs` 默认写盘语义、不改 `block351-ear.mjs` 阈值、不缩 EAR 分母、不改 `block348/tasks.json` 的 T7 override、不删 165 个通道、不建第二矩阵生成器、不把离屏读数写成视觉绿、不动 10 项用户资产与蓝图原件、零新增依赖、不撤销既有用户裁决、不放宽任何基线。
- **依赖**：K0（判据与元数据模板）、K1（通道分诊）、K2（数据面）。
- **风险**：元数据门若把历史证据判红 → 显式只管本程序新产出并写进 schema；DOM 阈值门若被误读为实机量测 → 证据类标 `mechanical-gate` 且 note 写明「纯函数判定器，不是 CDP 实机」。

## §5 补腿条件（U / V / L / E）

| 项 | 补腿条件 | 归属 |
| --- | --- | --- |
| perf 默认写盘 | 用户裁决如何兼顾「每次 closeout 不产生 diff」：候选=内容哈希稳定才写 / 只在显式 gate 写 / 写仓库外目录；裁决后改实现 + 负测 + 干净树 closeout:full 验证 | U |
| DOM 节点上限/帧率入门禁 | 活 dev 栈 + 9223 离屏 CDP，植入 2 万节点必红 + P50/P95 同批落盘 + 「有栈才断言」显式条件；离屏读数不冒充视觉绿 | L + E |
| 冷启动真 ×5 与五段 | 独立重起矩阵 + 五段权威读数（H8 热栈 5 轮的 `cdpPageReady` 缺口不得冒充冷启动） | L |
| T7 自然长任务 | 有效凭据 + 真实默认窗口触发压缩 + 20 FACT 全收 + 0 干预 + attempt 级 token/cache/duration/模型归因 | V |
| 请求体五类占比 | 真实 provider 逐轮与 `token_budget`/`ai_usage`/`ContextBudgetBar` 对账 | V |
| EAR 45% | 分子真实增长（新增被 test 引用的 acceptance 证据）+ 负测守住，不缩分母、不改阈值 | A + L |
| 165 通道逐件销号 | 用户裁决「接线 / 删 / retain-with-reason」，接线项补用户入口、错误态、负测 | U |
| 三矩阵真同源 | 单一生成器重建三份产物 + 人工改动判红，属结构性 W5b 切片 | W5b |

## §6 touchSurface / sharedBaselines

- `touchSurface`: `docs/block-401-*.md`、`docs/post-h9-k5-decision-material.md`、`scripts/lib/post-h9-k5-*`、`test/post-h9-k5-*`、`acceptance/post-h9-2026-11-10/k5/**`、canonical 六件套。
- `sharedBaselines`: `acceptance/block-351/assetized-manifest.json` / `ear-snapshot.json` / `test/perf-baseline.json` / `block351-ear.mjs` / `block350-perf-gate.mjs` / 四份棘轮基线全部零改动。

## §7 验收门禁与证据

`npm run docs:check` / `npm run ui:audit:check` / `npm run test:changed` / `npm run closeout` / `PETRI_PERF_EVIDENCE=<path> npm run quality:perf`（当次显式证据）；证据 `acceptance/post-h9-2026-11-10/k5/` 四字段齐备。
