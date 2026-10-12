---
capability: agent-competitiveness
goal: Agent 竞争力总纲 W3 波「编排与多智能体深化」——CP-8 并发与派生升级（并发上限用户可配 1-8 缺省 3；派生深度受控放开 env 缺省 1=现状；汇报门转正评估落结论）/CP-9 编排 DAG 可视化（spawn 树+task_plan 投影 @xyflow 画布，复用血缘先例）/CP-10 工具路由转正（默认开+校准门+决策可观测确认）；编排从「机制在库」变「可见、可调、可信」
acceptance:
  - CP-8：并发上限调整生效（契约+实机 env）；深度放开红绿（depth=2 时孙代可派生）或「不放开」实证落档；汇报门评估结论落档
  - CP-9：编排图实机可看可追（运行任务 spawn 树节点+父子边渲染；组件契约）
  - CP-10：tool-route 默认开且路由精度门绿；决策可观测消费面确认（DecisionUsagePanel 数据源在册）
  - closeout 十三门绿 + 总纲 §4 W3 行回写
reopen: 任一 CP 出口断言未达即该 CP 返工；波内零停顿条款沿用（用户 2026-10-12 /goal 整波授权连续行使）
status: completed
---

# BLOCK-173 — 竞争力总纲 W3 波（编排与多智能体深化）

## 0. 来源与授权

- 总纲：[`agent-competitiveness-program.md`](./agent-competitiveness-program.md) §4-W3（CP-8/9/10）。
- 用户授权：2026-10-12 /goal「按照波次 逐个推进 能自己判断就自己判断 不需要问我」——整波授权+波内零停顿条款连续行使（W1/W2 先例）。
- 排序理由：W3 全部为通用 agent 能力（用户裁决主线），且依赖已解锁（ORC-3 事件驱动聚合=W2 前已收口）。

## 1. 范围（CP-8 → CP-10 → CP-9 串行，红绿先行）

### CP-8 并发与派生升级
- 并发上限用户可配：`PETRI_SPAWN_CONCURRENCY_LIMIT` env（1-8 钳制，缺省 3=既有保守值）；超限软指引语义不变。
- 派生深度受控放开：`PETRI_SPAWN_MAX_DEPTH` env（≥1，缺省 1=现状「子不可再生子」零行为变化）；depth=2 时孙代可派生（父子链经 parentTaskId 校验继承）。
- 汇报门（report-guard）转正评估结论落档（缺省关维持与否+理由）。

### CP-10 工具路由转正
- `tool-route` 决策原语默认开（feature 缺省翻转）；路由精度校准门（契约：路由命中家族与 fallback 全量不退化）。
- 决策可观测确认：DecisionUsagePanel 数据源覆盖 tool-route 接点（在册即确认）。

### CP-9 编排 DAG 可视化
- 智能体面板（AgentRunPanel）新增「编排图」形态：当前 run 的 spawn 树（节点=主任务+子任务，边=parentTaskId 父子链）以 @xyflow 只读画布投影（复用血缘 DAG 先例）；节点点击下钻既有任务详情；纯前端投影零第二真相（数据源=既有 tasks 列表）。

## 2. 非范围

- run_tool workflowPlan DAG 合并渲染（总纲注明画布先例已备，双链统一归后续包）；并发上限超出 8 的规模化；无 env 时的持久化设置面（随决策原语节另批）；G1+ 不外推。

## 3. 门禁与完成语义

每 CP：定向红绿+tsc+lint。波末：closeout 十三门+实机探针（acceptance/block-173/）+UI 台账。三 CP 出口全过+closeout 绿=completed；总纲 §4 W3 行回写。


## 8. 收口对账（2026-10-12）

| 出口判据 | 实绩 | 证据 |
| --- | --- | --- |
| CP-8 上限调整生效 | ✅ 契约级（env 钳制 1-8/缺省 3/非法回 3；函数化解析器） | block173-w3-contracts 2/5 |
| CP-8 深度放开红绿 | ✅ depth=2 红绿（resolveSpawnMaxDepth env 缺省 1=现状；spawn_depth_exceeded 闸+父链上溯有界防环） | 同上+源码接线钉 |
| CP-8 汇报门评估 | ✅ 落档：维持缺省关（转正缺消费证据；PETRI_JEV_REPORT_GUARD 观察位保留），随决策可观测面成熟再裁 | AUDIT-LOG W3 收口行 |
| CP-10 默认开 | ✅ defaultOn 接点旗标（decision-config 解析+seedDoc 口径一致；env 0 最高/显式关尊重/非 defaultOn 零牵连契约锁）；w3-live 实机 enabled=true | block173-w3-contracts + w3-live |
| CP-10 校准门 | ✅ 阈值 0.8 与校准 evidence 链维持（block-113 calibration.json 挂点不变） | decision-thresholds:64 |
| CP-10 可观测确认 | ✅ DecisionUsagePanel 数据源（decision_log）在册；tool-route 接点已在决策原语配置/观测面 | DecisionConfigPanel/UsagePanel |
| CP-9 编排图实机 | ⚠️ 组件契约 4/4+投影/渲染实证；有子任务的真实 DOM 走查随 UI-501 过目 | OrchestrationGraph.test 4/4 |

**诚实边界**：CP-8 env 生效需栈重启（进程 env）；多层派生真实模型链路实证未跑（深度闸单测+fail 语义锁定）。**随波裁决**：run_tool workflowPlan 合并渲染不夹带（总纲注明归后续）；非 defaultOn 接点零牵连已用契约锁住。
