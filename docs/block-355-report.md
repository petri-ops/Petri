# BLOCK-355 收口报告 — 上下文裁剪 tool 链原子性（C-45）

- 日期：2026-11-05
- 依据：`docs/next-tasks-2026-11-05.md` A-1 / `docs/block-355-context-trimmer-atomicity-plan.md`
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## 1. 根因（比 C-45 原报告更细）

`core/petri-server/helpers/message-trimmer.js` 有两处叠加缺陷：

1. **三档独立贪心拆链**：`pickWithinBudget` 先把 `role: 'tool'` 结果按 `TIER_TOOL_RESULT`（tier 1）挑走并占用预算，之后 `assistant(tool_calls)` 在 tier 2 因预算不足被丢弃 → 输出出现悬空 `tool` 消息。
2. **输出顺序倒置**：`kept.sort((a, b) => a.age - b.age)` 中 `age = total - idx`（越小越新），升序会把**新消息排到前面** → 即便链完整，`tool` 也可能排在 `assistant(tool_calls)` 之前。

两者任一都会让 provider 收到非法 tool 消息序列并整体 400，长任务中断。BLOCK-348 的 T7（20k 窗口、7 次调用即触发压缩）是实锤场景。

## 2. 修复（三层，同一文件）

| 层 | 实现 | 作用 |
| --- | --- | --- |
| 原子单元 | `groupToolChains(scored)`：`assistant(tool_calls)` 与其后匹配 `tool_call_id` 的 `tool` 消息合并为不可拆 unit；`pickWithinBudget` 以 unit 为最小粒度做三档贪心 | 同留同裁，杜绝拆链 |
| 顺序还原 | `scoreMessages` 增加 `idx`；结果按 `idx` 升序构建，不再按 `age` | 精确还原原始消息顺序 |
| 防御层 | `dropOrphanToolMessages`：丢弃没有前置 `tool_calls` 声明的 `tool` 消息 | 输入本身带孤立 tool（历史/上游裁剪）也不会进 provider |

`stats`（`messagesKept` / `messagesDropped` / `messagesTokensUsed`）与摘要注入判定同步改用**实际输出**集合，避免账实不符。

## 3. 当次证据

| 证据 | 结果 |
| --- | --- |
| `test/block355-trimmer-atomicity.test.mjs` | **6/6 绿**：极小预算不拆链 / 顺序不倒置 / 预算充足零裁剪 / 孤立 tool 被丢 / 20k 窗口 7 调用结构合法 / **负测**（复刻旧三档贪心+age 升序，被完整性断言判红） |
| 回归 `agent-runner-loop-orchestrator` + 三个 compaction 契约 | **19/19 绿** |
| **T7 冻结场景复跑**（`--tasks=acceptance/block-355/t7-only.json --tag c45-fix`，窗口覆盖 20000） | **`status=completed`**：49 次 tool_call（≥35）、`context_compacted` 事件在场（compaction=1）、`out/final-report.md` 含全部 20 项 FACT 标记、**干预 0**、产物 41 件 |
| 证据文件 | `acceptance/block-355/t7-rerun-c45-fix.json`、`t7-only.json` |

**证据隔离说明**：runner 默认写 `acceptance/block-348/results.json`，本次单任务复跑会覆盖原八任务结果。已把本次结果复制到 `acceptance/block-355/` 后 `git checkout -- acceptance/block-348/` 恢复原状（复查 `results.json` entries=8），未污染 348 证据。

## 4. 口径如实修正

计划 §4 写「8/8 任务完成率可复算」——**本包未做全套 8 任务重跑**（全套复跑属于 BLOCK-356 套件 v2，含 T3 判据修订）。因此本报告**只宣称 T7 单任务 completed**，不提前宣称 8/8。按 348 机械口径：T7 缺陷已清，T3 的「判据过窄」仍待 356 处理。

## 5. 门禁

`node --check` OK · 契约 6/6 · 回归 19/19 · `docs:check` · `docs:reconcile` · `quality:surface`（P1/P2 无新增）· `quality:ear` · `quality:perf` · `knip` · `types` · `lint` · `closeout` 16 门。

## 6. DoD

修复 + 契约（含负测）+ 冻结场景复跑 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。**未启动 G1、未碰 C-46 / C-47 / O-1。**
