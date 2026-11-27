# item88 第二波（体验层）证据

## §1 范围

按设计稿 v1.0 §4.3/4.6/4.7/§5/§4.2③ + v1.1：三档交互、双通道、双层同步、变更单、2D 总览三视图、调度队列；第一波计量卡接到任务卡 UI。前置已核：本地 main 与 origin/main 同为 5493dfda0，CI 近三笔全绿。

## §2 落地

- 三档交互：`workbench-interaction.js::resolveInteractionMode/routeInteraction`，纯路由；审批仍走 `approval-request-store`（taskId Map + guard_ack/permission.resolved），咨询走 `user-question-store` + `loop-orchestrator` 既有 promise。**零新 IPC**。独立 `WorkbenchApprovalCard.tsx`（once/task/always），只在任务卡内。
- 双通道/双层同步：`workbench-writeback.js::writebackOutcome` 单一幂等入口，按 `taskId+eventKey` 去重，只写 task_events 事实；机械层经 `taskEventBus`+SSE，方案级修正由状态机 needs-user/approval/rework 事件转变更单。
- 变更单：`workbench-change-order.js::validateChangeOrder/createChangeOrder`，缺 taskRef/impact/decision/effectiveVersion 出 diagnostic；结构化字段进 wb_changes，文档本体进 wb_documents chain_hash 链。
- 2D 总览：`WorkbenchOverviewSurface.tsx` 组合目标树计数、`OrchestrationGraph`（ReactFlow 只读三 props）、`TraceSurface` 审计流水；workSurface registry 加 `overview` tab，RightPanel 最小接线；零新数据/零写 IPC。
- 队列：`workbench-queue.js::rankQueueTasks`（priority DESC → created_at ASC）+ `computeRetryDecision`（复用 RETRY_POLICY，rng 可注入）；并发仍走 runtime.js acquire。
- flag：`workbench.enabled` 默认 off；`WorkbenchFlagGate` flag-off 渲染与 v1.0 逐字节等价基线；开发态用既有 `PUT /api/ai/decisions/config/workbench` 开启。

## §3 HK-01 与回归

- `test/item88-workbench-wave2.test.mjs` 5/5：三档路由、双通道回写幂等（同一 outcome 两条通道只一条事件）、变更单 schema 缺字段红+链通过、总览静态只读（无 bridge/IPC/dispatch）、队列 priority 稳定序+固定 rng 退避+超限 failed。
- 前端 `WorkbenchApprovalCard.test.tsx` 2/2、`AgentRunPanel.flag-off.test.tsx` 2/2（flag-off 逐字节基线 + gate 接线）；邻域 30/30；节点回归 13/13；11 静态门绿。

## §4 边界与待裁决

- 快照测试口径按最接近候选 `docs/agent-workbench-enhancement-plan.md:692`「flag 关闭时聊天消息渲染与 v1.0 逐字节等价」落地；仓库无 block-86 目录/无 .snap 先例，口径未落 canonical 文档，若 owner 指别的快照对象收到纠正即改。
- 不做：新表/迁移、第二账本、真正并发调度器、跨会话审批持久化、总览拖拽编辑、外部真值（item66 边界）。

## §5 待 owner 终验

开发态开启 flag 后验证：三档交互只在任务卡、双通道结论只回写一次、变更单缺字段被拒、总览只读三视图、队列优先级与重试上限。观感 in_progress 零代签。
