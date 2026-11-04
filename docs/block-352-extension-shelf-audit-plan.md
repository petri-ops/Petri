---
capability: block-352-extension-shelf-audit
status: completed
goal: 对插件 / 技能 / MCP 服务三货架逐件点验，解决上轮判词「货架可见不可用」，把可用性变成可复跑矩阵并接入门禁防复发。
acceptance:
  - 三货架 100% 条目有判定（可用 / 需绕路 / 空壳）+ 判定依据。
  - 所有空壳件有处置（接线 / 下架 / 显式保留）且留痕；「需绕路」项有具体绕路步骤。
  - 矩阵可复跑；负测（造无判定条目 → 判红）通过；不出现为清零而下架有用能力的情形。
reopen: G1+ 项（第三方生态市场 / 远程技能市场）；i18n / hooks；新增插件或技能；已取消四项不复活。
---

# BLOCK-352 — 扩展生态可用性核对（计划）

- 登记状态：**completed（2026-11-05 当日收口）**——报告 docs/block-352-shelf-report.md；21+2 全判定 17A/4D/0S
- 总纲：`docs/next-phase-program-2026-11-05.md`
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §3.1 / §3.5；2026-10-15 评估「垂直-通用杠杆：拉动 4/5 vs 拖累 2.5/5」
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 立项依据

上轮评估点名「休眠插件 + demo 错位 = 货架可见不可用」，本月未触碰。通用 agent 的护城河正是「用户能自己扩展」——货架上东西看得见却点不动，生态就起不来。这也是四个价值兑现短板里唯一直接指向**扩展能力**的一条。BLOCK-346 已证明「声明 × 消费」机械化核对可行，本包把同一范式应用到扩展生态。

## §2 范围（逐条）

- 建三货架清单（内置插件 / 领域包 / 通用技能 / MCP 服务），逐件记录：入口路径、声明能力、实际可触发方式、依赖环境。
- 逐件点验判定三态：**可用**（能完成一次真实动作）/ **需绕路**（能达但需手工步骤）/ **空壳**（登记在架但无实现或不可触发）。
- 产出可复跑可用性矩阵（`scripts/block352-shelf-audit.mjs` + `acceptance/block-352/shelf-matrix.json`），判定逻辑与 346 矩阵同范式。
- 空壳件逐件处置：接线（小改）/ 下架（需显式裁决，**不批量删**）/ 显式保留并注明原因，三选一留痕。
- 把「新增货架条目必须有可用性判定」做成机械断言，接 `quality:surface` 或独立门。

## §3 非范围（越界即停工）

- 不新建第三方生态市场 / 远程技能市场（G1+）
- 不做 i18n、hooks（长期未裁决项）
- 不新增插件或技能（本包是核对，不是扩充）
- 不批量删除既有条目（下架逐件裁决 + 迁移说明）
- 不为清零而下架有用能力

## §4 验收（可度量）

- 三货架 100% 条目有判定 + 判定依据（路径 / 触发方式 / 实测记录）
- 所有空壳件有处置且留痕
- 矩阵可复跑；新增条目漏判定能判红（负测）
- 「需绕路」项有具体绕路步骤文档，不写成「暂不支持」了事
- 「可用」判定须有一次真实动作证据（非静态推断）

## §5 门禁（机械）

- `test/block352-shelf-audit.test.mjs`：清单完整性、负测（造无判定条目 → 判红）
- 脚本登记 `test/impact-map.json`
- `npm run quality:surface` / `docs:check` / `quality:knip:check` / `quality:lint` / `closeout`
- 若下架条目影响 `docs/README.md` 或 registry，同步回写并 `docs:reconcile`
- 开工前总纲 §6.1、收口 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

BLOCK-351（复用其矩阵脚本与门禁范式）。无强数据依赖，可提前但按总纲固定顺序排第 5。

### 6.2 风险登记

- 「可用」判定依赖环境（MCP 需外部 server）→ 环境不可得记「需绕路 / 环境受限」，**不记空壳**
- 下架可能破坏既有用户配置 → 逐件裁决 + 迁移说明
- 静态扫描误判动态注册 → 复用 346 教训：先解析真实 `require` / 注册点，再做负测
- 空壳件「接线」若演变成大改 → 按总纲 §7.1 停工裁决，另立票

### 6.3 touchSurface

`scripts/block352-*.mjs`、`test/block352-*.test.mjs`、`acceptance/block-352/**`、`docs/block-352-*.md`、`test/impact-map.json`

### 6.4 sharedBaselines

`test/impact-map.json`、`test/functional-surface-baseline.json`、`test/knip-baseline.json`、`eslint-suppressions.json`；若下架条目涉及 registry 则 `docs/DOC-REGISTRY.json` + `docs:reconcile`

## §7 完成语义（DoD）

三货架清单 + 可用性矩阵 + 空壳处置台账 + 报告落盘；负测通过；门禁接入；总纲 §8 填行；registry → completed；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues；`closeout` 全绿。

**本计划不是开工授权**；状态流转与范围变更按总纲 §2。
