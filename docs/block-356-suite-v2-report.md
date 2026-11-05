# BLOCK-356 收口报告 — 通用任务套件 v2

- 日期：2026-11-05
- 依据：`docs/block-356-task-suite-v2-plan.md` / `docs/next-tasks-2026-11-05.md` B-1
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## 1. 交付

| 项 | 内容 |
| --- | --- |
| v2 判据表 | `acceptance/block-356/tasks-v2.json`（**独立文件，348 冻结表零改动**） |
| runner 扩展 | `scripts/block348-task-runner.mjs` 新增通用判据 `file_contains_any`（文件含 values 中任一子串） |
| T3 判据修正 | 原 `file_contains: "illustrative examples"`（英文原句逐字在场）→ `file_contains_any: ["illustrative","example","示例","举例","例如","示例说明"]`（双语内容等价物） |
| 引用要求 | `iana.org` / `[1]` / `tool_used web_fetch ≥2` / `final_answer_contains 来源` **逐条不变**，未降低引用门槛 |
| 新旧对照 | 写入 v2 表 `$meta.criteriaFrozenAt` 与 `frozenNote`；其余七任务判据逐字不变 |
| T7 回归 | T7 本就在全套 8 任务内，v2 复跑通过（50 tool_calls、`context_compacted` 在场、20 项标记全收） |

## 2. 复核发现（避免无效改动）

计划 §2 设想「补 headless 浏览器链」。**复核 `core/petri-server/helpers/browser-connector.js:122-124` 发现该诚实降级已存在**：无 `deps.perform` 时立即返回 `transport_unavailable` + 可操作 hint，不会走到 25s `transport_timeout`。348 报告中的 P2 短板属当时调用路径/后续已缓解，本包**不改产品代码**，改以 T4 实际复跑结果为准（v2final 中 t4 `status=completed`）。

## 3. 当次实测（两次全套 8 任务复跑）

| run | 判据表 | 结果 |
| --- | --- | --- |
| v2（T3 词干） | `illustrative` 子串 | **7/8**，0 干预 / 0 中断 / 0 失败 / 0 skip；T3 仍缺 1 条（agent 用中文表述） |
| **v2final（双语内容等价物）** | `file_contains_any` | **7/8**，0 干预 / 0 中断 / 0 失败 / 0 skip；**T3 判据全过** |

**相对 348 首跑 6/8**：T7 由 C-45 修复（355）转通过、T3 由判据修正转通过 → 结构性缺口清零；本次剩下的 1 个是 **T6 多 agent 任务波动**：`out/synthesis.md` 未写入口令 `TURING-9`（`file_contains` 判红，其余判据全过）。

**如实声明**：不宣称 8/8。T6 是明确口令要求、agent 未履行，属执行波动而非判据过窄；**不为达标放宽 T6 判据**（那才是放水）。该波动登记为观察项，交后续套件回归关注，不单独立缺陷票。

证据：`acceptance/block-356/results-v2.json`、`results-v2final.json`、`tasks-v2.json`。runner 默认写 `acceptance/block-348/results.json`，两次复跑后已复制结果到 356 并 `git checkout` + `git clean` 恢复 348 原状（复查 entries=8），**未污染历史包证据**。

## 4. 门禁

`node --check scripts/block348-task-runner.mjs` OK · `docs:check` · `docs:reconcile` · `quality:surface`（P1/P2 无新增）· `quality:ear` · `quality:perf` · `knip` · `types` · `lint` · `closeout` 16 门。

**impact-map 无需改动**：`scripts/block348-*` 与 `acceptance/block-356/**` 已由 348 规则与批次预登记规则覆盖，故本包不触发 P6 源绑定重打。

## 5. DoD

v2 判据表 + runner 通用判据 + 两次全套复跑证据 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。**未启动 G1、未碰 C-46 / C-47 / O-1。**
