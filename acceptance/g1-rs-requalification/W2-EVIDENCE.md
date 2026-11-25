# G1 首包 W2 · affected-subgraph lifecycle 证据（2026-11-25）

> 发令：Orca msg_d454636afdef 按序开 W2 → 范围裁决 msg_77f1c1fe2cbe「行」：affected-subgraph 本机做、heatmap 挂账。
> 红线：既有门零放宽、不造第二套 planning、heatmap 不伪造本仓契约。本证据**不宣称资格**。

## §1 核码结论（与 W1 同构：既有设施齐备）

- 规划真实：`core/shared-backend/result-edit-intent.js` 的 `computeResultAffectedSubgraph` 基于**权威 workflow DAG**（`isAuthoritativeWorkflowPlan`：graphId `wfg_*` + sourceDigest 64hex）BFS 算 `affectedNodeIds`/`affectedScope`，缺 DAG 或非权威图 fail-closed（`workflow_dag_missing`/`workflow_dag_not_authoritative`）。
- 多端消费（非 harness 拼装）：`result-context-edit-tools.js`（回执 affectedScope）→ `result-edit-controls.js:explainEditImpact`（影响解释）→ `result-replay-service.js:createReplayIntent`（replay 传播）→ `result-changeset-service.js`（落 changeset validationSummary）→ 前端 `ResultStudioChangeSetPanel.tsx:404`（产品 UI 展示）。
- 白名单零放宽：`validateResultEditIntent` 只允许 `none|current_result_only|workflow_subgraph`；scientific/data/workflow edits 强制 authoritative workflowGraph ref。

## §2 实现决策

核码确认 affected-subgraph lifecycle **已是真实产品契约**（规划+回执+门控+replay+落库+UI 全链在场），与 W1 情况同构。按 owner 已认可的「既有设施能提供就不造第二套」原则，**W2 不新增产品代码**，只补 HK-01 契约把散落链条串成可观测证据（避免无意义改动/门放宽）。

## §3 HK-01 红绿先行

`test/g1-rs-w2-affected-subgraph.test.mjs` 红 2/3（测试构造未满足权威图/契约字段）→ 绿 3/3：
1. 规划真实：缺 DAG fail-closed + 权威 DAG BFS 得 `['deg','enrich','report']`、`scope=workflow_subgraph`。
2. 多端消费：规划→回执→explainEditImpact→replay→changeset→前端 UI 六处源码断言在场。
3. 白名单零放宽：合法 scope 通过、越界 scope `affected_scope_invalid` 拒绝。

回归：`result-edit-intent` + `result-edit-controls` + W1 契约 30/30 绿。

## §4 heatmap 挂账（按裁决）

- manual→Agent heatmap 子项**挂账**：本仓无 heatmap 工具，插件在兄弟仓 `../petri-pack-bio/plugins.dormant/gene-correlation`（休眠态）；历史 P5 证据引用的本仓路径已随 BLOCK-83 迁包删除（正是「历史证据不冒充资格」实证）。依赖兄弟仓激活，到位后另立子包，本包不伪造本仓 heatmap 契约。兄弟仓激活裁决由 owner 另向兴奋提示（不在本包范围）。

## §5 边界

- 零新依赖/新工具、既有门零放宽、owner dev 实例零触碰、观感零代签；不翻资格；W4/W5 外部挂账维持；push 等放行。
