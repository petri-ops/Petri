---
capability: block-354-g0-exit-criteria
status: completed
goal: 把「G0 什么时候算收尾」从模糊状态写成客观、可机械判定的条件表，并输出当前出籍就绪度；未达标前明确宣称红线。
acceptance:
  - 判据表 6 项各有：达标条件、证据路径、判定命令、不可达标时的替代判据。
  - node scripts/block354-readiness.mjs 可复算并输出 N/6 达标 + 未达原因，零人工干预。
  - 负测（人为移除一项证据 → 该项判未达且就绪度下降）通过；就绪度如实写入 AUDIT-LOG 与 roadmap。
  - 宣称红线条款写进计划与广播：未达前不得表述 GA / Provider / 对外发布能力，G1 启动需用户显式发令。
reopen: G1 启动本身；真实 Provider 矩阵 / 生态市场 / i18n / hooks 等 G1+ 能力；成熟度蓝图五层定义的改写；新增功能域；已取消四项不复活。
---

# BLOCK-354 — G0 → G1 出籍判据（计划）

- 登记状态：**completed（2026-11-05 当日收口）**——就绪度 6/6 达标（脚本复算）；报告=docs/block-354-readiness-report.md；**G1 启动仍需用户显式发令**
- 总纲：`docs/next-phase-program-2026-11-05.md`
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md` §2 / §5 P2；`docs/g0-agent-maturity-blueprint.md`
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**

---

## §1 立项依据

项目长期停留在 G0：每条收口笔录都写「G0 开发期常态 · 不外推 packaged/Provider/GA」，但**没有客观出籍判据**，导致「做完一个包又开一个包」没有终点感。`docs/g0-agent-maturity-blueprint.md` 定义了五层满级画像与「G0 天花板」语义，却未绑定可复算证据。本包不启动 G1，只把「何时算收尾」变成机械可判的事实。

## §2 范围（逐条）

- 定义判据表（6 项，逐项绑定前序包证据文件）：
  - ① 通用任务基准达标（BLOCK-348 实测报告 + 短板清单）
  - ② 实机证据清零（BLOCK-349，`in_progress ≤15`）
  - ③ 性能基线建立并入门（BLOCK-350，`quality:perf` 在 closeout 内）
  - ④ EAR ≥40%（BLOCK-351 EAR 脚本输出）
  - ⑤ 扩展货架无未处置空壳（BLOCK-352 可用性矩阵）
  - ⑥ packaged 回归无阻断项（BLOCK-353 差异清单）
- 每项写清：**达标条件 / 证据路径 / 判定命令 / 不可达标时的替代判据**。
- 建 `scripts/block354-readiness.mjs`：逐项自动判定，输出「N/6 达标」+ 未达项原因，**零人工干预**。
- 写明**未达标前的宣称红线**：不得表述 GA / Provider / 对外发布能力；G1 启动需用户显式发令。
- 与 `docs/g0-agent-maturity-blueprint.md` 五层画像对齐（引用而不改写其定义）。

## §3 非范围（越界即停工）

- **不启动 G1**（本包只产出判据与就绪度）
- 不建设真实 Provider 矩阵 / 生态市场 / i18n 等 G1+ 能力
- 不改写成熟度蓝图的五层定义
- 不为凑达标而调整前序包的结论（就绪度如实显示未达）
- 不把「出籍就绪」表述成「已经出籍」

## §4 验收（可度量）

- 判据表 6 项各有：条件、证据路径、判定命令、替代判据
- `node scripts/block354-readiness.mjs` 可复算，输出 `N/6` + 未达原因
- 负测：人为移除一项证据 → 该项判未达且就绪度下降；恢复后回升
- 就绪度报告**如实**写入 AUDIT-LOG 与 roadmap（未达就写未达）
- 宣称红线条款写进计划与广播
- 总纲 §8 进度台账七行填满

## §5 门禁（机械）

- `test/block354-readiness.test.mjs`：判据完整性、负测、证据路径存在性
- 脚本登记 `test/impact-map.json`
- `npm run docs:check` / `docs:reconcile` / `quality:surface` / `quality:knip:check` / `closeout`
- 与 `npm run state` 不冲突（不新增 active 槽位）
- 开工前总纲 §6.1、收口 §6.2 检查单

## §6 依赖 · 风险 · 边界

### 6.1 依赖

前 6 包全部收口（依赖其证据文件存在）。若有包未开工，判据表仍可写，但就绪度如实显示未达。

### 6.2 风险登记

- 前序包有未达标项时，就绪度会显示未达 → **这是预期结果，不是失败**；不得为好看调判据
- 判据绑定具体文件路径，后续证据迁移会失效 → 用稳定路径（`archivePolicy: retain_stable_path`）
- 「出籍」易被误读为「启动 G1」→ 计划与广播都写明本包不启动 G1
- 就绪度若被人手工编辑会失去可信度 → 只由脚本生成，禁止手改

### 6.3 touchSurface

`scripts/block354-*.mjs`、`test/block354-*.test.mjs`、`docs/block-354-*.md`、`acceptance/block-354/**`、`test/impact-map.json`

### 6.4 sharedBaselines

`test/impact-map.json`、`test/functional-surface-baseline.json`、`eslint-suppressions.json`

## §7 完成语义（DoD）

判据表 + readiness 脚本 + 就绪度报告 + 负测落盘；`N/6` 如实输出；宣称红线登记；总纲 §8 七行填满；registry → completed；README / roadmap / backlog / AUDIT-LOG 回写；`docs:reconcile` 0 issues；`closeout` 全绿。

**本计划不是开工授权，更不是 G1 启动授权**；状态流转与范围变更按总纲 §2。
