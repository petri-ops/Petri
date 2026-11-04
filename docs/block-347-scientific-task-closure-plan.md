---
capability: block-347-scientific-task-closure
status: planned
goal: 把科研任务从「能生成计划」推进到「计划能变成真任务并跑出结果」——补齐 plan → confirmation-preview → confirm → 执行 → 结果回流 的后半段，使 harness 科研面成为一条用户可走完的链路，而不是五个只在 curl 里活着的端点。
acceptance:
  - P1 确认卡可用：`harness_plan_task` 结果在会话内渲染为「计划 + 缺口清单 + 确认执行」卡片，缺口为 0 时才可确认（有缺口时按钮 disabled 并给出原因）。
  - P2 确认可落库：`POST /api/harness/scientific-task/confirmation-preview` + `/confirm` 由工具或路由统一入口调用，走 346 已交付的两段式 ackToken，确认后 `scientific_task_confirmations` 落行且可回读。
  - P3 执行闭环：确认后的任务创建 tool_job（或明确不建 job 的语义），结果进结果面并可钉住；失败如实回错，不产生「已确认但没执行」的悬空态。
  - P4 实机与门禁：dev Electron 实机走通一次 plan→confirm→执行→结果；新增「确认前后状态机」契约测试；closeout 十四门绿。
reopen: taskSpec 规范（531 行）到工具 schema 的逐字段映射；多用户/多项目并发确认；计划的人工编辑（当前只支持接受/拒绝）。
---

# BLOCK-347-SCIENTIFIC-TASK-CLOSURE — 科研任务闭环

- 登记状态：**planned（2026-11-04 立项）**
- 立项动因：BLOCK-346 方向 2 已把「计划生成」接成 agent 工具（`harness_plan_task`，只读 R0），但 **`confirmation-preview` 与 `confirm` 两个端点仍零消费**——计划能出、却无法落地成任务，链路断在最后一步。

## §1 立项依据（现状证据）

| 环节 | 现状 |
| --- | --- |
| `POST /api/harness/scientific-task/plan` | 已由 `harness_plan_task` 工具消费（346 方向2 交付，只读） |
| `POST /api/harness/scientific-task/confirmation-preview` | **零消费**（`routes/harness/scientific-task.js:81`） |
| `POST /api/harness/scientific-task/confirm` | **零消费**（同文件 `:99`），落库需 `confirmation.userId` |
| `GET  /api/harness/scientific-task/confirmations/:id` | 回读面，同样零消费 |
| Loop 迭代 3 端点 | 零消费（`routes/harness/loop.js`），与本包共用「确认后推进」语义 |

## §2 阶段

### P1 确认卡（前端）
- 把 `harness_plan_task` 的 `plan` 渲染成卡片：步骤、所需插件、缺口清单、预计资源。
- 缺口非空 → 「确认执行」disabled + 原因（不让人确认一个跑不通的计划）。
- 复用 346 T1 的审批载荷（`needApproval` / `ackToken`），不新建卡片组件。

### P2 确认落库
- 新增工具 `harness_confirm_task`（或路由统一入口）：先 `confirmation-preview` 拿预览 → 两段式 ack → `confirm` 落库。
- 契约 `state-write` / R1，`needsApproval: true`（写库 + 承诺执行）。
- 幂等：同一 `planHash` 重复确认返回既有确认记录，不重复落行。

### P3 执行与结果回流
- 确认后按 taskSpec 建 tool_job（或明确「确认≠执行」的产品语义，二选一并写死）。
- 结果进结果面、可钉住（复用现有 viewerRegistry 与钉住链）。
- 失败如实回错；禁止「已确认但无执行记录」的悬空态。

### P4 实机与门禁
- dev Electron 实机走通一次完整链路。
- 新增契约测试：确认前缺 `ackToken` 必拒、缺口非空不可确认、重复确认幂等、失败不留悬空态。
- closeout 十四门绿。

## §3 非范围
- taskSpec 规范逐字段重写（只做必要映射，规范仍以 `core/shared-backend/scientific-task-spec.js` 为单一源）
- 计划的人工编辑（先只支持接受/拒绝）
- 多用户/多项目并发确认
- R 运行时安装与包管理（属 harness 环境包范畴）

## §4 依赖与纪律
- 依赖 346 已交付的审批链（`tool-events` 工具无关上抬 + 前端 `pendingApproval` 生成条件）与 `ensureControlConfirmation` 协议。
- 依赖 harness 索引（`scripts/harness-file-index.mjs`）可用；不可用时如实降级，不造假计划。
- 登记 `test/impact-map.json` 规则；`harness` 工具域已由 assembly 契约覆盖（新增工具忘记接线会红）。

## §5 完成语义
`completed` 需：P1-P4 逐项有当次证据（含一次实机链路）、确认状态机契约测试绿、closeout 十四门绿、台账回写（roadmap/backlog/registry/AUDIT-LOG）。
