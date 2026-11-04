---
capability: block-351-evidence-assetization
status: completed
goal: 把 acceptance 里的一次性验收笔录分批转成进门禁 / 可复跑探针，使证据资产化率 EAR 从 ≈10% 提升到 ≥40%，并让 EAR 本身可机械复算。
acceptance:
  - EAR 口径文档落盘且带时间戳；node scripts/block351-ear.mjs 可复算。
  - EAR ≥40%，分子分母明细可查；新增探针 100% 有真断言、100% 登记 impact-map、100% 跑过一次。
  - 「不可资产化」清单逐条带原因，不混入分子；负测（删一条 impact-map 引用 → EAR 下降且门判红）通过。
reopen: G1+ 项；追求 100% 资产化（历史环境不可复现者明确登记即止）；新增功能域；已取消四项不复活。
---

# BLOCK-351 — 证据资产化 EAR 10% → 40%（计划）

- 登记状态：**completed（2026-11-05 当日收口）**——EAR 43.3% 达标；口径=docs/block351-ear-definition.md；quality:ear 入 closeout 16 门
- 总纲：`docs/next-phase-program-2026-11-05.md`
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §3.7 / §4
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 立项依据

上轮判词「EAR ≈10%」：acceptance 验收证据文件 1179 → **1919**（+63%），但进门禁 / 可复跑探针的占比未提升。大量证据是「一次性笔录」——不进 closeout、不可复跑、无断言，等于证据越多越难自证。评估报告把「证据资产化」列为 P1，目标 40%。

## §2 范围（逐条）

- **先锁死 EAR 口径**：分子 = 被 `test/impact-map.json` 引用且带真断言、可复跑的探针/证据文件数；分母 = `acceptance/` 下证据文件总数（排除目录、README、临时产物）。写进 `docs/block-351-ear-definition.md` 并留时间戳，**禁止靠缩分母达标**。
- 清点脚本（`scripts/block351-ear.mjs`）：输出当前 EAR、分子分母明细、未资产化文件 Top 列表。
- 选高价值批次转成可复跑探针：优先近 10 个已完成包（344 / 345 / 346 等）的验收证据，其次 BLOCK-349 产出的实机探针。
- 每条转换：写真断言（不是只存 JSON）、登记 `test/impact-map.json`、跑一次留当次结果。
- 建 `quality:ear` 或并入 `quality:surface`，输出 EAR 数值与是否达标（≥40%）。

## §3 非范围（越界即停工）

- **不靠缩小分母达标**（口径先锁死，分母变更需显式裁决并留痕）
- 不重写 / 删除历史证据文件
- 不把「只是个 JSON 文件」当探针（必须有真断言且可复跑）
- 不追求 100%（历史环境不可复现的证据明确登记「不可资产化 + 原因」）
- 不新增功能域、不改产品行为

## §4 验收（可度量）

- EAR 口径文档落盘且带时间戳；`node scripts/block351-ear.mjs` 可复算
- EAR 数值 **≥40%**，分子分母明细可查（列表落 `acceptance/block-351/`）
- 新增探针 100% 有真断言、100% 登记 impact-map、100% 跑过一次
- 「不可资产化」清单逐条带原因，不混入分子
- 负测：人为删一条 impact-map 引用 → EAR 下降且门判红；恢复后判绿
- `npm run test:changed:list` 无未映射文件

## §5 门禁（机械）

- `test/block351-ear.test.mjs`：口径稳定性、假探针拦截、负测
- `test/impact-map.json` 登记所有新增脚本与证据
- `npm run test:changed:list` / `quality:surface` / `quality:knip:check` / `docs:check` / `closeout`
- 开工前总纲 §6.1、收口 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

BLOCK-349（实机探针）、BLOCK-350（性能基线证据）。口径定义不依赖前序结果，但达标需要其产出。

### 6.2 风险登记

- 1919 个文件里大量是一次性实机笔录，天然不可复跑 → 明确登记不可资产化，不硬凑
- 分子口径若含「被引用但没断言」会虚高 → 断言检查写进脚本，不是人工判断
- 批量改 `test/impact-map.json` 会触发 `test:changed` 分类冲突 → 规则先行、批量登记、每批复跑
- 口径若中途变动会使前后数值不可比 → 口径文档带时间戳，变更需显式裁决

### 6.3 touchSurface

`scripts/block351-*.mjs`、`test/block351-*.test.mjs`、`docs/block-351-*.md`、`test/impact-map.json`、`acceptance/block-351/**`

### 6.4 sharedBaselines

`test/impact-map.json`（主战场）、`test/functional-surface-baseline.json`、`test/knip-baseline.json`、`eslint-suppressions.json`

## §7 完成语义（DoD）

EAR 口径 + 清点脚本 + 探针批次 + 达标数值落盘；≥40% 可复算；负测通过；总纲 §8 填行；registry → completed；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues；`closeout` 全绿。

**本计划不是开工授权**；状态流转与范围变更按总纲 §2。
