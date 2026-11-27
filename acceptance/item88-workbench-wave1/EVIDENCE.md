# item88 工作台第一波（地基）证据

权威设计：`petri-workbench-design-v1.md` v1.0（14 章）+ v1.1 增量（15–19 章，第一波范围不变）。设计=活文档，实施发现回流修订。

## §1 范围与不变量

- 第一波：四表数据模型、任务状态机、子任务隔离、计量卡、任务书+验收单最小集。
- 不引入第二执行器/第二 Artifact 真相：复用 `task_events`、`ai_usage`、`agent-task-store`、`approval-request-store`；工作台是组织壳。
- `workbench.enabled` 默认 off（PETRI_WORKBENCH，项目粒度灰度）；关 flag 零残留（wb_* 独立、不双写既有表）。

## §2 落地

- `src/migrations/026_workbench.sql`（025 已由 item87 占用，避让）：wb_goals / wb_tasks / wb_documents（append-only，prev_chain_hash/chain_hash）/ wb_changes；`core/petri-server/db/schema.js::initSchema` 同步内联 DDL（后端独立进程只跑它）。`ai_usage` 加可空 `task_id`。
- `decision-config.js RUNTIME_POINTS` 加 `workbench`（enabledDefault:false，envKey PETRI_WORKBENCH），config-schema 同步注册。
- `core/petri-server/helpers/workbench-state-machine.js`：设计稿 §4.4 原词全轮转 draft→confirm→queued→running→{blocked|needs-user|approval}→reviewing→{rework}→delivered→accepted；任意运行态→cancelled/failed（带重试）；`appendWorkbenchEvent` 机械落 task_events，零 LLM 成本。
- `core/petri-server/helpers/workbench-isolation.js`：按 taskId 派生 worktree root/branch，重复 root/branch fail-closed；选型=git worktree（治理 active），目录副本不采用；合并只出 diff 走既有 `working-tree-review`/`ReviewMode`，不自动 merge。
- `scientific-task-spec.js::validateScientificTaskSpec` 加 `requireAcceptanceCriteria` 可选参数（默认关兼容既有），开启时缺 `acceptanceCriteria` 出 `acceptance_criteria_required`。
- `core/petri-server/helpers/workbench-docs.js`：wb_documents 只 INSERT + chain_hash 串接，篡改任一环 verifier 红。
- `ai-usage.js`：`recordAiUsage({taskId,...})` + `summarizeTaskUsage({taskId,userId})`；route `GET /api/ai/usage-task?taskId=` 返回 tok/费用/时长/轮数；`frontend/src/components/work-surface/WorkbenchMetricsCard.tsx` 独立组件（不碰 83/84/85 已验卡区），token/无裸色、无数字 z-index。

## §3 HK-01 与回归

- `test/item88-workbench-wave1.test.mjs` 5/5：迁移026幂等+四表+flag默认off；状态机全轮转/任意态取消/非法跳转拒绝；两任务 worktree 路径分支不同+写 A 不见 B+重复拒绝；缺验收标准红；文档链篡改红+wb_documents 无 UPDATE/DELETE+taskId 聚合。
- `WorkbenchMetricsCard.test.tsx` 1/1：tok/费用/时长/轮数渲染，刷新后更新。
- 回归 37/37（migration-runner / schema-parity / block336-worktree / scientific-task-spec / agent-concurrency）；11 静态门绿；config-schema 行数增长 `--write --allow-grow` 留因。

## §4 第二波不做（边界）

三档交互、双通道、变更单完整流、2D 总览皮肤、调度队列、多副本并发合并队列、目录副本隔离；不做外部真值（Provider/GA/公证/afterPack，item66 已收）；不引 ajv、不造新执行器。

## §5 待 owner 终审

需按 flag 灰度开启后实机验证：两并行子任务隔离互踩与合并评审、状态机全轮转、任务书缺验收标准被拒、计量卡刷新。观感 `in_progress` 零代签。
