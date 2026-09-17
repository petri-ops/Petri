# BLOCK-97-AGENT-TODO-CARD — Agent 任务清单（todo）工具 + 摘要卡实时渲染

最后更新：2026-09-17

状态：`active（2026-09-17 启动，用户裁决原话「接下来开整 BLOCK-97 智能体待办卡」；P0 复核完成、D1-D4 按 §4 预置推荐落定，P1 后端进行中）`

计划编号：`BLOCK-97-AGENT-TODO-CARD`

来源（用户原话，2026-09-17）：用户在会话中见到编码 agent 的任务清单进度卡（编号条目、做完一条勾一条、「进程 2/8」）后裁决诉求：「能否实现这个功能呢 放到我们摘要卡片中？？？？ 我需要agent 干活时维护的任务清单（todo list）的渲染——agent 把工作拆成编号条目，做完一条勾一条」

## 0. 目标

应用内 agent 执行多步任务时维护一份结构化任务清单（编号条目 + 完成状态）；清单变更实时流入工作台摘要卡，渲染为「任务清单」进度节。用户在会话进行中即可看到 agent 拆解的步骤与勾选进度。

## 1. 事实基线（2026-09-17 只读勘察；行号写于当日 HEAD `fc0142dc`，启动时 P0 必须重定位）

> **P0 复核结论（2026-09-17，HEAD `54337ca5`）**：全锚点重定位完成，漂移极小——
> ① 任务循环节 L350-383、任务进度节 L385 起（原 L349-380/L382-405 基本不变）；
> ② tool-events.js tool_call L44 / tool_result L64（原 L42/L53）；helpers/conversations.js meta_json L39（原 L34）；其余锚点（CenterPanel:311、agent-runner `_emit` L364、registry HANDLERS L100 / CONTRACTS L178 / validateContract L273 / TOOL_REGISTRY L361、task_events L271、events.js afterSeq L28、plan-ui-tools L14）与原基线一致或 ±1 行；
> ③ **新增承重事实**：`_emit` 双通道实证（agent-runner.js:364-375 onEvent + appendAgentTaskEvent 全量持久化）→ 专用事件零管道新增且重放可回；agent-runner.js:723 `emitToolResult` 包裹点=task_todo 事件发射位（该文件 874 行有余量，loop-orchestrator 1241 行门零触碰）；systemPrompt 组装在 agent-runner.js:376-412，additive 追加块先例=L385 角色指令；
> ④ 重载恢复=subscribeAgentTaskOnce `afterSeq=0` 全量重放（resume/fallback 两路径实证），事件重放方案重载可重建清单；已完结会话普通重载不显示清单=§3 范围内语义；
> ⑤ WorkspaceSummaryCard.tsx 现约 1001 行（棘轮管辖），CenterPanel.tsx:351/378 两处渲染分支均需传 todo 投影 prop；前端 agentTaskStream.ts if-链分派在 L248-362（tool_call L332 / tool_result L342）；UI 台账下一号=UI-398。

| 环节 | 现状 | 插入点 |
| --- | --- | --- |
| 摘要卡 | `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`（约 1002 行，行数台账棘轮管辖） | 「任务循环」节（L349-380）与「任务进度」节（L382-405）之间新增「任务清单」节 |
| 摘要卡数据 | props `loop`/`loopSummary`（`useDurableConversationLoop`，CenterPanel.tsx:311 调用）+ 组件内 hook 轮询 | todo 状态与 loop 同层接入（conversationRunStore 事件投影） |
| agent 循环 | `core/biof3-server/loop-orchestrator.js`（runLoop L108）+ `agent-runner.js`（_emit L364-366 双通道=onEvent 回调 + `appendAgentTaskEvent` 持久化） | todo_write 为普通工具调用，回路零改动 |
| 工具注册 | `core/biof3-server/agent-tools/`：`tool-defs.js`（TOOL_DEFS）+ `registry.js`（HANDLERS L100-160 / TOOL_REGISTRY L361 / validateContract L273）+ `index.js` dispatchTool | 新建 `agent-tools/todo-tools.js` + tool-defs/registry 各加一支（范本=BLOCK-55 plan 工具：tool-defs.js:613 + plan-ui-tools.js:14） |
| 事件流 | `agent-tools/tool-events.js`（tool_call L42 / tool_result L53）→ `agent-task-store.js` task_events 表（L271-276，seq append-only）→ SSE `routes/ai-agent/events.js` L29（`?afterSeq=N` 断线续传）→ 前端 `copilot/copilotClient/agentTaskStream.ts`（subscribeAgentTask L73，事件分派 L332-345）→ `conversationRunStore.ts` | 事件管道零新增；若立专用事件类型，在 agent-runner `_emit` 与 agentTaskStream 分派各加一支 |
| 持久化 | 首选 task_events 事件重放（零迁移、重启可重放）；终态快照可落 `copilot_messages.meta_json`（helpers/conversations.js:34）；备选新表 `copilot_todos`（仿 copilot_plan_steps，`src/migrations/`） | P0 评审定案 |
| 相邻展示 | 既有「任务进度」节 = `HarnessWorkflowJobState` 固定分析流水线 rail（CenterPanel activeWorkflow） | 语义不同（固定流水线 vs agent 动态清单）：并存不合并 |
| 相邻工具 | BLOCK-55 PLAN_TOOL_v1 计划批准流（copilot_plans / copilot_plan_steps 表 + PlanApprovalCard） | 审批流语义不同，不复用其 UI；表结构与工具模式可参考 |
| 现状确认 | 全仓无任何 todo/checklist 类 agent 工具（grep 零命中；前端 "todo" 命中均为代码注释） | — |

## 2. 方案骨架（三件套）

1. **后端 `todo_write` 内部工具**：整单幂等写入（全量替换清单：编号、内容、状态 pending/in_progress/completed）；纯状态写入，不触发 LLM 推理；参数契约入 registry.js CONTRACTS（fail-closed 校验）。
2. **agent 系统提示词注入使用纪律**：多步任务先拆编号清单；开工一条置 in_progress；完成即置 completed；随任务演进增删条目。注入点沿用 BLOCK-93 system prompt 注入先例。
3. **摘要卡「任务清单」节**：从会话事件投影取最新清单快照，渲染编号条目 + 勾选态 + 进行中高亮；会话无清单时整节不渲染（与既有各节同一模式）。

## 3. 非范围（exclusions，写死）

- 不做会话流内嵌 todo 卡片渲染（仅摘要卡承载；如需另立 UI-### 另行裁决）
- 不改 BLOCK-55 PLAN_TOOL_v1 计划批准流
- 不动 Electron IPC 与 dev-verify 基础设施
- 0 新依赖
- 不做跨会话全局 todo（清单生命周期 = 单次 agent 任务运行）

## 4. 设计决策预置（启动后 P0 评审确认）

- D1 持久化：**✅ P0 定案（2026-09-17）=task_events 事件重放**（零迁移；重载经 afterSeq=0 重放重建）。原选项对比：独立表 `copilot_todos`（跨重启直查）落选——新迁移+双真相同步成本，且升级属纯增量可后补。
- D2 事件形态：**✅ P0 定案（2026-09-17）=专用 `task_todo` 事件类型**（发射位=agent-runner.js emitToolResult 包裹点检测 todo_write 成功回执后 `_emit`；前端 agentTaskStream 分派加一支）。原选项对比：直接消费 tool_call/tool_result 落选——前端耦合工具出入参 schema、受工具 UI 显隐策略影响。
- D3 todo 状态是否随迭代快照落 loop_iterations 观测面——**✅ P0 定案：不做**（默认维持）。
- D4 UI-### 号分配：**✅ P0 定案=UI-398**（前端增量实施提交同台账行登记）。
- 裁决留痕：D1/D2 呈问（AskUserQuestion）未应答，按本文件 §4 预置推荐先行（用户放权惯例）；两项均低耦合可逆，用户事后否决的改造成本=前端消费端局部/D1 增量表，如实登记于此备查。

## 5. 阶段草案（启动后串行）

| 阶段 | 内容 | 验收门禁 |
| --- | --- | --- |
| P0 | 立项复核：§1 行号重定位（BLOCK-95 收口会改动相邻文件）+ §4 决策裁决 | 结论回写本文件 + 用户确认 |
| P1 | 后端 todo_write 工具 + 提示词注入 + 契约测试 | `test/agent-tool-registry.test.mjs` + `tools-input-validation` + `agent-tool-policy` 扩展全绿 |
| P2 | 摘要卡「任务清单」节渲染 + 组件测试 | WorkspaceSummaryCard.test.tsx 扩展 + tsc 0；涉样式则 theme-token-contract 必跑 |
| P3 | 实机验收 + 整包收口 | dev-verify 实机真轮次（agent 真实调用 todo_write、摘要卡实时勾选可见）+ `npm run closeout` + 证据落 `acceptance/block-97/`（新目录必配 impact-map） |

## 6. 风险与红线

- 行号漂移：§1 行号写于 2026-09-17 HEAD，BLOCK-95 后续阶段必然改动相邻文件，P0 必须重定位。
- 摘要卡行数：WorkspaceSummaryCard.tsx 已约 1002 行且受行数棘轮管辖（BLOCK-92 M1/M2），渲染逻辑优先下沉独立子组件，不得推高棘轮基线。
- loop-orchestrator 行数门 <1250（现状约 1241）：本包原则上不改该文件；若必须改，新增逻辑下沉 tool-events 族（BLOCK-92 先例）。
- 工具语义：todo_write 整单幂等替换，避免增量 diff 带来的并发序问题（P0 可复核）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 完成语义

整包 `completed` = P0-P3 全收口 + 实机证据落 `acceptance/block-97/` + UI-### 台账行实机边界内 verified + roadmap/registry 回写；未启动工作面必须经用户显式裁决 `deferred` 并回写状态头，不允许「半拆无主」状态跨包存续。
