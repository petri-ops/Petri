---
capability: block-355-context-trimmer-atomicity
status: planned
goal: 修复 C-45（上下文压缩裁剪破坏 tool 消息配对），使长任务不再因 provider 400 中断，并把 T7 冻结场景纳入回归。
acceptance:
  - message-trimmer 裁剪后 assistant(tool_calls) 与其 tool 消息恒成对，契约测试覆盖「裁一半」与「全保留」两种边界。
  - 冻结场景 20k 窗口 7 次调用不再产生 provider 400；T7 复跑 completed 或如实登记环境不可得原因。
  - 8/8 任务完成率可复算；closeout 16 门绿。
reopen: G1+ 项；新增功能域；C-46 / G1 / O-1 三项排除项。
---

# BLOCK-355 — 上下文裁剪原子性（C-45）

- 批次总纲：`docs/next-batch-program-2026-11-05.md`；依据任务卡 `docs/next-tasks-2026-11-05.md` A-1
- 阶段：**G0 开发期常态 · 不外推 packaged / Provider / GA**

## §1 立项依据

348 T7 实测实锤：`core/petri-server/helpers/message-trimmer.js:159-160` 的 `pickWithinBudget/scoreMessages` 按打分贪心拾取、无 tool 链配对约束，可裁掉 `assistant(tool_calls)` 而保留下属 `tool` 消息 → 后续请求被 provider 整体 400 → 长任务中断。冻结场景 20k 窗口 7 次调用即复现（`acceptance/block-348/results-t7-rerun.json`）。这是唯一把「能做」变「做不完」的 P1 缺陷。

## §2 范围

- `message-trimmer.js`：裁剪决策以 **tool 链为原子单元**——`assistant(tool_calls)` 与其所有 `tool` 响应同留同裁；打分时按链计分或按链边界截断。
- 新增契约测试 `test/block355-trimmer-atomicity.test.mjs`：①构造含 tool_calls 的消息序列，压到小预算，断言输出中不存在孤立 `tool` ②预算充足时全保留 ③链被裁时整链消失、不残留。
- 用 348 冻结场景做静态复现（不依赖 provider）：构造 20k 窗口 7 调用消息序列，验证裁剪结果可被 `chat/completions` 结构校验接受。
- 尝试 T7 复跑（`node scripts/block348-task-runner.mjs --task t7 --tag c45-fix`）；**环境不可得时如实登记**，不伪造 completed。
- 结论写入 `docs/block-355-report.md` + 证据 `acceptance/block-355/**`。

## §3 非范围

- 不改压缩算法本身（打分策略、预算公式、模型窗口配置）
- 不修 C-46 / C-47、不做 G1、不新增工具域
- 不调整 348 判据表（判据冻结，禁止事后改口径）
- 不为通过而放宽 provider 400 的判定

## §4 验收

- 契约测试绿，且**负测**：把修复回退（或注入旧裁剪函数）应判红
- 20k 冻结场景裁剪结果结构合法（无孤立 tool 消息）
- T7 复跑 completed 或明确「环境不可得 + 具体原因」
- `npm run closeout` 16 门绿；矩阵 P1/P2 无新增

## §5 门禁

`node --test test/block355-trimmer-atomicity.test.mjs`、`npm run quality:surface`、`quality:types`、`quality:lint`、`docs:check`、`ui:audit:check`、`closeout`；新文件登记 `test/impact-map.json`。

## §6 风险

- T7 全链需 real provider（deepseek-chat）+ 隔离后端 → 环境不可得时以静态结构复现为主证据，不谎报
- 改动裁剪逻辑可能影响上下文长度 → 需核对预算仍在阈值内，避免「修好配对但爆窗口」
- 348 判据表冻结，T7 结果不得事后调整口径

## §7 DoD

修复 + 契约（含负测）+ 冻结场景复现 + 报告落盘；台账回写；registry → completed；总纲 §5 填行；显式路径提交。
