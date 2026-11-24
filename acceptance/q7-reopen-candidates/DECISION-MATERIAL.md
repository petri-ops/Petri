# 裁决材料 · 母纲推荐序复核 + Q7 reopen 候选池（2026-11-24）

> 状态：**pending_user_ruling**（不启动实现）。授权：owner 经 Orca 转达主人「还有没做的内容 继续启动不要停下来」第 3/4 项——评估后「能推的按序立项」，复核结论=推荐序语境已过时，无可按序立项项；长尾候选按本材料单一推荐等发令。
> 复核纪律：全部核码再下结论（Q4b 呈「代码领先台账」反向登记滞后，已同批对齐）。

## 一、推荐序三项真值（全部已收口，不可再立项）

| 波次 | 真值 | 证据 |
|---|---|---|
| Q4b 工作流脚本 | completed 且**超额交付**（reopen 前三项已被 NEXT-01 批做掉） | registry status=completed；workflow-tools.js（registry.js:218）/automation-runner.js:121 kind=workflow/WorkflowRunsPanel.tsx 在案 |
| Q9-REM | closed-as-adjudicated（BLOCK-259/260/261 定档；③档 C-35~C-40 经 BLOCK-264 全交付） | backlog C-35~C-40 ✅；①②档全部需外部/G1+ |
| P4-REM | completed（BLOCK-263）；唯一顺延=R 实机腿需装真实生信 pack（半外部） | §6.5 第 12 行「串行队列就此清零」 |

母纲 763 行滞后文本与 block-262 reopen 列已同批对齐（零代码）。

## 二、候选池（本地可推，按性价比排序；均为新工作包需发令）

1. **Q7 cron+时区+失败退避+overlap 可配置（单一推荐，S~M 成片包）**：automation-runner/store 现状=interval_minutes+next_run_at、overlap 默认 skipped_active/skipped_running 已做——增量=cron 解析器+迁移加列+时区（同包最划算）+失败退避重试+overlap 策略可选。零新依赖（自写最小 cron 五字段解析器）。跨设备同步=外部不推；agent 唤醒需先裁「无人值守自动跑 agent 的审批/身份语义」（建议另点）。
2. C-43 批注画笔前端渲染器（M，契约已交渲染器未做）。
3. DAG 可视化编辑面（M）/ Qoder 全量语法（M~L）/ worker_threads 隔离（L）——功能已 opt-in 可用，价值需场景裁决。
4. agent 唤醒（M~L，前置=审批语义裁决）。
5. C-40 浏览器连接器传输层（L，2–3 周整包）。

## 三、请主人一次口令

- 回「Q7 cron 包」即按 WORK-PACKAGE-LAUNCH-CHECKLIST 立项开工（候选 1，唯一推荐）；
- 其余候选默认维持候选池登记不动；外部/出籍项（跨设备、E7/L4/K4/D1、K2、P4-R 实机腿）不催不动。
