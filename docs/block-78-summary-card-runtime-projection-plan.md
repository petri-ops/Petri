# BLOCK-78 — 摘要卡片项目化：项目运行时投影（终端/后台任务/智能体/通知/资源随项目绑定）

> 状态：`active`（2026-09-10 用户裁决「确保没冲突的情况下 开始干活吧」启动 P1；同日立项）
> 立项日期：2026-09-10
> truthDomain: `block-78-summary-card-runtime-projection`
> 来源：用户对会话摘要卡片的三轮质询与裁决——①「摘要信息是不是没有和项目绑定？本地和远程的项目摘要信息应该不同对吧？智能体是不是应该加到摘要卡片中？」②点名「终端、后台任务、通知、资源详情，当然是随项目绑定的，毕竟本地和远程服务器不同」③「可以再优化一下」，同意按「项目运行时投影」统一抽象登记

## 1. 用户裁决

- 2026-09-10 第一轮：「摘要信息是不是没有和项目绑定？本地和远程的项目摘要信息应该不同对吧？智能体是不是应该加到摘要卡片中？」——确认三项质疑成立（详见 §4 代码事实）。
- 2026-09-10 第二轮：「终端 后台任务 通知 资源详情？当然是随项目绑定的，毕竟本地和远程服务器不同。是否要加上，你看看按照理解可以重构的」——点名四项执行侧数据必须按项目形态（local / ssh）路由真值源。
- 2026-09-10 第三轮：主 Agent 提出把四项收敛为单一概念「项目运行时投影」并给出 P1/P2 增量清单，用户裁决「我觉得你可以再优化一下，没问题就按执行 1、2 步的登记」——① 先把 background-processes 读面缺口登记进 BLOCK-76；② 本包按运行时投影抽象登记 planned 排队。

## 2. 背景与动机

- 会话摘要卡片（`WorkspaceSummaryCard`）是项目工作区里长期 pinned 的运行俯瞰位，但它的数据面只覆盖了项目真值的一半：任务/统计来自项目级 jobs 查询，而**运行环境整节来自本机全局**，智能体、终端、后台进程、通知四类信息完全缺席。
- BLOCK-67 落地后项目分两种形态（`workspaceKind: 'local' | 'ssh'`），执行真值分别在「本机」与「服务器」。卡片对 ssh 项目仍报告本机 R/Py 运行时与本机内存/磁盘，属**本机视角残留**——作业实际跑在服务器上，卡片却在讲本地机器的健康。
- 目标：把摘要卡片从「本机视角的会话摘要」重构为「**项目运行时投影**」——凡执行侧数据，一律按 `project.workspaceKind` 路由到该项目的真值源；渲染层只认「这个项目的运行时」，不出现第二套本机假设。

## 3. 目标形态

- **单一抽象：项目运行时投影**。四类执行侧数据（任务/后台进程、终端、资源环境、通知）由同一原则驱动——local 项目读本机端点，ssh 项目经 Workspace Gateway / mux 读服务器真值（或诚实标注本机来源，见 §5 P2）。
- **卡片分节**：任务（tool_jobs + 后台进程统一视图）· 终端（tab 数与运行态）· 智能体（项目内子 agent 活动）· 注意（失败/待审批/异常/终态聚合）· 环境（执行位置 + 资源）· 会话（当前会话与本项目会话数）· 数据（数据集概览）。
- **定位收敛**：卡片眉题「项目摘要」与 `aria-label="会话摘要"` 二者统一为「项目 + 当前会话的运行俯瞰」，使对话/任务/智能体/环境四类节名正言顺。
- **降噪纪律**：每节遵守既有「无内容不渲染」先例（`loop && loopDisplay &&` / `SubAgentsBar` 空态返回 null），有活动才出现、默认收起；`compact` 档需明确哪些节降级或隐藏。

## 4. 现状代码事实（2026-09-10 核实，HEAD 面）

**卡片本体与数据源**

| 卡片节 | 数据来源 | 项目绑定现状 |
|---|---|---|
| 眉题/标题/状态 | `projectName` + `activeJob`/`workflow` | 项目级 ✅ |
| 任务（主卡 + 额外 live） | `activeJob` / `liveJobsPreview` | 项目级 ✅ |
| 分析记录 / 运行队列 指标 | `jobStats`（由 `conversationJobs` 归并） | 项目级 ✅ |
| 任务循环 | `useDurableConversationLoop(project.id, convId)` | 会话级 ✅ |
| 任务进度 | `useHarnessWorkflowStatus(activeJob?.id, …)` | 项目级 ✅ |
| 最近分析 | `recentJobs`（`listProjectJobs(projectId)`） | 项目级 ✅ |
| **运行环境** | `useBackendStatus()` + `useRuntimeResourceSnapshot()` | **本机全局 ❌** |

- `useBackendStatus()` 是挂在 App 根的全局 Context（`components/backend/BackendStatusProvider.tsx`，注释原文「全局 Context + 5s 轮询」），数据源为本机 Electron 主进程 `backend:status`。
- `useRuntimeResourceSnapshot()`（`hooks/useRuntimeResourceSnapshot.ts`）直接 `fetch('/api/harness/resource-snapshot')`，**不带任何 projectId 参数**；后端 `core/biof3-server/routes/harness/resources.js` 读的是 biof3-server 所在机器的 os 指标。
- 定位漂移既有事实：眉题写「项目摘要」，`aria-label` 写「会话摘要」（`WorkspaceSummaryCard.tsx:98`）。

**四类执行侧数据现状**

| 项 | 实现 | 与项目绑定的现状 |
|---|---|---|
| 终端 | `hooks/useTerminalTabs.ts`（BLOCK-54 多 tab xterm + node-pty，`MAX_TERMINAL_TABS=4`）；BLOCK-67 起 `startSession(cwd, id, ssh?)` 支持 `ssh: { alias, remotePath }` 直挂远程 shell | **绑定已就位 ✅**（本地项目本地 shell / ssh 项目远程 shell）；但 tab 与运行态锁在 `BottomTerminal` 组件内，**卡片零投影** |
| 后台任务 | `ToolActivityDock`（UI-268 浮窗，1s 轮询 `/api/ai/agent/background-processes`）→ `routes/ai-agent/background-processes.js`（BLOCK-34 P3）读的是 `workspace-tools.js` 的**本地内存 `backgroundProcesses` 表**（per conversation/sessionKey 隔离） | **缺口 ❌**：BLOCK-76 P1 已把 ssh 项目 exec_bg 改服务器直跑（产物/进程在服务器），本地内存表对 ssh 项目**失明**；该读面不在 BLOCK-76 原 P2 读面清单内 → 已在 BLOCK-76 补项登记（见 §11 协同） |
| 智能体 | `SubAgentsBar`（`SimpleChat.tsx:1526` 挂载）+ `listAgentTasks`（`/api/ai/agent/tasks`，用户维度跨会话，tasks 表投影；BLOCK-65 修正按 `projectId` 过滤） | 数据天然带项目归属 ✅，但**只存在于聊天侧**，卡片零呈现 |
| 通知 | `ToastProvider`（`components/common/ToastProvider.tsx`）——全局瞬时报文，数秒消失 | **无持久通知中心、无项目作用域、无 Electron 系统通知** ❌ |
| 资源详情 | 同「运行环境」行 | 本机全局 ❌；且 mux 现有动词为 list/stat/read/write/mkdir/mv/rm/find/grep/exec/exec_bg/ps_pid/kill_pid，**无资源类动词** → 远程资源真值需 mux 新增动词（P2 面） |

**已有可用而未上卡的项目级数据（零后端）**：`project.g0Baseline.compatibilityStatus` / `executionAllowed`（`lib/project-types.ts`）、`ToolJob.execution_target_id`（BLOCK-57，null=本机；BLOCK-64 已修 mapper 断链）、`ctx.datasets`、`ctx.conversations`（`ConversationSummary` 含 title/message_count/updated_at）、计划审批（`planApprovals` / `PlanApprovalCard`）、`jobStats.failed`（已算出但未强调）。
**卡片宽度预算**：`summaryOpenWidth` 按会话宽 26%（expanded）/ 32%（compact）收缩（`pages/project-workspace.tsx`）——节数增加必须配 compact 档降级定义。

## 5. 阶段划分（P0–P3 串行，每阶段独立提交 + 定向测试）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 定位收敛 + 取舍确认** | 定位文案统一（眉题/aria-label）；每节的「消除哪个用户必看盲区」论证；§6 清单逐项勾选进/出范围；compact 三档降级表落定 | 卡片定位与节清单获用户确认 |
| **P1 纯前端运行时投影（零后端）** | ① 治理：定位收敛 + 无内容不渲染纪律 + compact 三档降级；② **失败强调**（`jobStats.failed > 0` 红色行、点击直达）；③ **基线预警**（`g0Baseline` blocked/migration_required/executionAllowed=false 高于「空闲」呈现）；④ **执行位置标注**（`execution_target_id` + `workspaceKind`/`sshHost`，任务行标「本机 / 远程@别名」）；⑤ **智能体节**（`listAgentTasks` + projectId 过滤，无活动不渲染）；⑥ **终端投影**（`useTerminalTabs` 状态上提或事件投影，卡片显示 tab 数与运行态，点击展开底部面板）；⑦ **注意节**（失败 job / 待审批计划 / 后台进程异常 / agent 终态聚合，前端聚合 store，Toaster 保留瞬时层）；⑧ **会话维度**（当前会话 title/message_count + 本项目会话数）；⑨ **数据集概览**（`ctx.datasets` 数量/总量/最近上传）；⑩ 项目元信息（modality 徽章 + 最近活动）+ 空态分状态指引 | 卡片在 local/ssh 项目均呈现上述节，门禁绿 |
| **P2 后端/远程真值面** | ① ssh 项目**运行环境真值**——mux 新增资源类动词（或 Gateway 资源投影），本次一并裁决「先诚实标注本机来源（`workspaceKind='ssh'` + host 别名 + 明示本机资源仅供参考）」是否作为 P1.5 过渡落地；② 项目级成本/Token 汇总（后端聚合落账）；③ 结果库占用（**依赖 BLOCK-76 P2 完成**，远程项目产物在服务器，读面走 Gateway）；④ background-processes 按 `workspaceKind` 路由（消费 BLOCK-76 补项成果）；⑤ 若需跨会话持久通知，补项目作用域存储 | ssh 项目卡片显示服务器真值或诚实标注，无本机假设残留 |
| **P3 实机验收 + 收口** | dev Electron 实机：local/ssh 项目对照 + 三档折叠 + 各节空态/有内容态断言；UI 台账回写；整包收口 | 验收证据 `acceptance/block-78/` + 整包 completed |

## 6. 非范围（exclusions）

- 不做通用仪表盘化（CPU 曲线图、图表挂件）——卡片是 pinned 常驻列，宽度预算 26%~32%，不是 mini dashboard 的位置。
- 不上 R 包环境 / provenance 摘要（属结果详情层，低频且重）。
- 不改 `ToastProvider` 瞬时语义（瞬时 Toast 与项目作用域「注意」聚合并存，不合并）。
- 不动摘要卡 `composerWidth` / 会话宽弹性契约（BLOCK-60）。
- 不改窗口系统（BLOCK-59/65）与聊天主体结构（`SimpleChat` 既有节顺带复用，不做重排）。
- 不外推 packaged/Provider/GA（G0 纪律）。

## 7. 依赖与协同

- **BLOCK-76-SSH-NATIVE-EXECUTION（active）**：P2 依赖其产物/进程读面 Gateway 化成果；background-processes 读面缺口已作为补项登记进 BLOCK-76（见 §11），本包消费其结果，不重复立项。
- **BLOCK-68-UI-DECLUTTER（completed）**：降噪方向同源，本包每增一节须先证明其消除了用户必看盲区（失败预警/基线阻塞/审批待办属此列；数据集/会话维度属锦上添花，排在最后）。
- **BLOCK-79-TOKEN-SPEED-OBSERVABILITY（planned）**：本包 P2 若在摘要卡「任务循环」节显示会话级输出速率（`tokens/s`），**复用其按供应商聚合函数与 provider 归因**，不建第二套速率聚合；两包启动顺序后到者复用前者。
- **BLOCK-77-RESIDENT-TASKS（planned）**：其「完成通知/回访提醒」与本节「注意」聚合为同一应用内通知面，启动顺序后到者复用前者接口，不建第二套通知真相。
- **BLOCK-65-SUBAGENT-UX（completed）**：智能体节复用其 `listAgentTasks` 项目过滤语义，不新建 agent 查询面。

## 8. 验收门

- 定向：受影响 vitest（`WorkspaceSummaryCard` 及新增节组件）+ `tsc` 0。
- 治理门禁：`npm run docs:check` + `npm run docs:reconcile` + `npm run ui:audit:check`。
- 实机：dev Electron 断言链——local 项目与 ssh 项目对照（执行位置/环境来源不串味）+ 折叠三档 + 各节「无内容不渲染」。
- UI 台账：实现同提交登记对应 `UI-###`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 节数膨胀致卡片爆高、compact 档失控 | P0 先落 compact 三档降级表；无内容不渲染为硬纪律；新增节须过「消除盲区」论证 |
| ssh 项目资源真值需 mux 新增动词，牵动 BLOCK-76 边界 | 分两步：先诚实标注本机来源（纯前端），远程真值作 P2 独立裁决；不改 mux 既有动词语义 |
| 与本包并行的 BLOCK-76 文件面重叠（读面/后台进程） | 本包不触碰 BLOCK-76 在制面（`core/biof3-server/helpers/remote-execution/*`、`tools-executor.js`）；只消费其结果与已登记契约 |
| 通知聚合造第二套真相 | 「注意」节只读既有真值（job 状态/审批 store/进程表/agent task 投影），零新增业务表 |
| 执行位置标注与 BLOCK-64 已修断链重复 | 复用 `ToolJob.execution_target_id` 既有字段与 mapper 修复成果，不新建字段 |

## 10. 治理边界

- 单一真相红线：本包是**读面投影**，不新建项目状态、作业状态、agent 状态或通知存储（P2 若需跨会话持久通知须单独裁决存储归属）。
- 执行位置/环境来源一律由 `project.workspaceKind` 派生，不引入第二套「是否远程」判断。
- 启动前置：无硬前置；按单工作包串行纪律排队（BLOCK-76 为当前 active）。

## 11. 进度记录

- 2026-09-10 **启动 active + P1 主体落地（UI-330 in_progress，`ec451b6e`）**：P0 以本 plan §5 节清单 + 会话裁决视为确认（用户对十项内容逐一过目并裁决「再优化一下」后立项）。**并行裁决**：用户「确保没冲突的情况下 开始干活吧」——与在制 BLOCK-76（另一会话）并行，文件面隔离边界：本包只动 `frontend/src/components/workspace-panels/{WorkspaceSummaryCard,CenterPanel}.tsx` + 新增同目录测试 + 台账/治理文档；`core/**`、`scripts/block76-*`、`acceptance/**`、BLOCK-76 plan 及其 dev 栈零触碰。落地 P1 十项之九（§5 P1①-⑥⑧⑨⑩）：定位收敛（aria-label 项目运行摘要）/失败强调（点击直达最近失败 job）/基线预警（blocked·migration_required·executionAllowed=false → role=alert）/执行位置标注（ssh→远程@host·execution_target_id→远程执行·否则本机）/智能体节（listAgentTasks+projectId 过滤·无内容不渲染·弹专属窗）/终端投影（terminal:listSessions 只读计数·零状态上提）/expanded 项目信息节（位置·形态·会话·数据集·更新；compact 整节降级）/空态指引。**P1 剩余（切片 2）**：注意节的「待审批计划」「后台进程异常退出」两个信号源（需 planApprovals store 与 background-processes 查询接线）。门禁：定向 vitest 9/9 + CenterPanel 6/6 + tsc 0 + ui:audit:check PASS；台账 UI-330 in_progress（实机验收待与 BLOCK-76 收口窗口合做）。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-09-10 **立项登记（planned）**：用户三轮质询后裁决按「项目运行时投影」抽象立项排队。同轮完成 BLOCK-76 补项登记——`background-processes` 读面缺口（BLOCK-76 P1 直跑后 ssh 项目后台进程不进本地内存表，而该读面不在原 P2 清单内），写入 BLOCK-76 plan §6 P2 读面清单与 §10 进度。本包 P1 十项纯前端条目已按代码事实核实（§4），P2 四项后端/远程真值面依赖 BLOCK-76。**同轮另立 BLOCK-79-TOKEN-SPEED-OBSERVABILITY**（按供应商的 token 输出速率）：本包 P2 若要显示会话级速率，复用其聚合函数与 provider 归因（§7 协同行）。G0 开发期常态 · 不外推 packaged/Provider/GA。
