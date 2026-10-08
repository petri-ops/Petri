---
capability: platform-reliability
goal: 通用 agent 平台工程面收敛到企业级交付水位——任务执行语义统一、状态感知实时、调度可靠、数据生命周期与性能卫生收口
acceptance:
  - 各阶段按种子立项后以对应 BLOCK/UI 验收为准（阶段表出口判据）
  - Goal 线整体收口时：执行语义单轨化（无不受可靠性装置覆盖的执行路径）+ 终态秒级可见 + 队列/重试在册
reopen: 用户裁决启动任一阶段时按立项检查单开包；Goal 级重估条件=两 Goal 交织队列整体重排
status: planned
---

# G0-PLATFORM — 通用 Agent 平台工程强化 Goal 线

> 立项：2026-09-28。用户裁决（原话）：「行！现在就是分成 通用agent平台和垂直领域的生信平台两个视角了 接下来就是具体的执行更新迭代 是否要做两个大的计划 尽可能的考虑全面 用于后面两个大部分的工作推进」——
> 与 [`g0-bio-delivery-goal-plan.md`](./g0-bio-delivery-goal-plan.md) 成对创建，源自同一次「结果与分析链路企业级交付差距评估」（通用视角部分）。
> 形态：**Goal 线**（TASK-FORM-TAXONOMY §3，先例 G0-RS P0-P7）——下辖多个工作包种子，跨数周。
> 治理定位：本计划承载**域内规划深度**（差距地图 + 阶段种子 + 验收标准）；全局推进序仍由
> [`pending-work-backlog.md`](./pending-work-backlog.md) 唯一登记；当前立即任务仍由
> [`next-steps-roadmap.md`](./next-steps-roadmap.md) 决定。**单工作包串行纪律不变**：同一时间只有一个
> active 工作包，阶段种子启动照常过 WORK-PACKAGE-LAUNCH-CHECKLIST（用户裁决留痕 + 登记三件套）。
> 阶段：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 一句话目标

把「跑分析、看进度、管结果」的**平台工程面**从「两条执行语义 + 轮询感知 + 无队列无重试 + 无生命周期」收敛到企业级交付水位：执行语义单轨化、状态感知秒级、调度可靠、数据有出口。

## 2. 背景：差距地图（2026-09-28 评估证据摘要）

评估方法：三路只读探查（结果前端全貌 / 分析任务执行链 / 数据层与 IPC）+ 垂直视角三路补查，证据均为 file:line 级。核心发现：

### 2.1 执行语义分裂（最重缺口）

同一类分析存在两条执行路径，可靠性装置覆盖不对称：

| 机制 | HTTP 异步路径（`/api/tools/run` → `handleToolRun`） | Agent/MCP 同步路径（**用户主入口**：copilot 对话 → `run_tool` → `_runPluginScript`） |
| --- | --- | --- |
| 超时预算 | 30min 硬超时可配（`helpers/process-lifecycle.js:3,185-198`） | **300s 硬编码**（`mcp/registry/run-plugin-script.js:684`） |
| 并发上限 | 每用户 2，超额 429（`helpers/tools-executor.js:1742-1753`） | **不受限**（直接建 running 作业，绕过准入检查） |
| 心跳 + 僵尸扫描 | 30s 心跳 + 5min zombie 扫描（`tools-executor.js:502-555`） | **无**（不在 `activeToolJobs`，宿主崩溃则行滞留 running） |
| 取消升级链 | SIGTERM→5s→SIGKILL→409 诚实（`process-lifecycle.js:43-114`） | 依赖 execFile 回调收尾 |

### 2.2 感知实时性靠轮询兜底

- 任务终态转换**不发 jobs 失效事件**：全仓只有 `agent-task-store.js:484,670,682,809` 调 `publishInvalidation('jobs')`，tools-executor 终态不发 → 非对话内完成的 job 前端靠 60s 兜底轮询（`frontend/src/hooks/useConversationJobs.ts:71-92`）。CK-03 已建 `/api/events` + `useInvalidationStream` 通道与两消费方，**缺的是发布点补齐**。
- 本地作业**零运行期日志流**：execFile 回调收尾才拿 stdout；日志结束时才写 `output/run.log`（`tools-executor.js:971-974`）；日志端点运行中诚实返回 `no_log_yet`（`routes/tools-metadata.js:212-264`）。
- 进度只有状态机粒度（running/completed），无阶段进度；单作业 SSE 本质是 1s 轮询 DB（`tools-metadata.js:267-321`）。
- 下游症状：`ResultArtifactShell.tsx:284-298` 专门防御「15s job 列表陈旧状态不许把已渲染产物换回 spinner」——轮询时代的可靠性债。

### 2.3 调度可靠性装置缺失

- **无任务队列**：并发满即 429 拒绝，无排队等待与队列位置可见。
- **无分析级自动重试**：重试只存在于 LLM 层（`agent-task-store.js:57-147` 指数退避，仅网络/限流类）；tool_job 失败需人/agent 重新发起。
- **失败可读性是亮点保留项**：R 错误 15 条模式表翻译中文可操作提示（`tools-executor/preflight.js:13-70`）、失败落项目通知 + 飞书。

### 2.4 数据生命周期「有入口没出口」

- `tool_jobs` 无保留策略（retention sweeper 明确不管，`jobs/retention-sweeper.js` 只清 copilot_messages/loop_* 表；表无界增长）。
- 桌面 `results` 表无批量删除/回收站/归档/导出通道；`result_tags` 死表（建表无 API）；`updateResult` 覆盖写不留版本（`src/database/result-db.js`）。
- 与服务侧产物 GC（`result-studio-lifecycle/gc.js` 两段式）不对称。

### 2.5 性能与内存卫生

- `useResultStore` 模块级缓存**无逐出**：并行拉 `byProject`（全量 data ×100）+ `list` 双形态冗余，项目切换不清（`frontend/src/hooks/useResultStore.ts:31,51-69`）。
- 桌面 `results.data` 单列 JSON 无载荷上限（`src/ipc/result-handlers.js:60-77`）；对话导出 1000 条消息整包一列。
- `version:getByNumber` 拉全表再内存 find（`result-handlers.js:261-262`）。
- 性能打点只写 DOM `data-*` 无采集闭环；`data-debug-*` 泄入生产 DOM（`ResultArtifactShell.tsx:1169-1174`）。

### 2.6 安全与静默失败

- **Bearer token 拼 URL query**（`frontend/src/lib/result-studio/resultStudioClient.ts:375-378`、`ResultArtifactShell.tsx:198`）——日志/引用泄露面。
- 执行器 14 处 `catch {}` 风格；**作业完成但 DB 持久化失败仅 console.warn**（`run-plugin-script.js:592`）→ 永久滞留 running 的行。
- 双轨结果 UI：独立页 `/project/:id/results` 是 JSON dump 原型（`ResultStudioPage.tsx:246-251`），与工作区完整能力并存，用户分不清去哪。

### 2.7 强项（本 Goal 不重做，只依赖）

Artifact Truth 读取时自愈、provenance 全链留痕、取消升级链、无主僵尸诚实失败、Revision/ChangeSet 血统、跨机复现（BLOCK-57）。这些是企业级 hardest part，已做实。

## 3. 阶段划分（工作包种子）

> 每阶段 = 未来一个独立工作包（预估形态标注；实际立项时按 TASK-FORM-TAXONOMY 复核）。
> 启动顺序不预设——由用户在 backlog 推进序中逐个裁决（交织原则见 §4）。

| 阶段 | 名称 | 一句话范围 | 预估形态 | 依赖 |
| --- | --- | --- | --- | --- |
| PL-1 | 执行语义统一 | agent/MCP 同步路径并入 tool_jobs 异步装置，消除 300s/无上限/无心跳三缺口 | BLOCK | 无（**G0-BIO BIO-4 的硬前提**） |
| PL-2 | 感知实时性 | 终态发 jobs 失效事件消 60s 盲窗 + 运行期日志行流 + 进度粒度 | BLOCK（可拆两包） | CK-03 通道（已在） |
| PL-3 | 调度可靠性 | 准入→排队→运行三层队列 + 分析级重试（瞬态/确定性分类） | BLOCK | PL-1（队列语义统一后才有意义） |
| PL-4 | 数据生命周期 | tool_jobs retention + 桌面 results 治理（批量/导出/归档）+ 双轨结果 UI 收敛 | BLOCK（可拆） | 无 |
| PL-5 | 性能与内存卫生 | 缓存逐出 + 载荷上限 + SQL 下推 + debug 属性泄出清理 | 轻量包~UI 批 | 无 |
| PL-6 | 安全与静默失败 | token 出 URL + 持久化失败处置 + 吞异常审计 | 轻量包 | 无 |
| PL-7 | 任务中心叙事统一 | 「运行中」三面互通（BLOCK-64 已评估的 11 作业面分层） | 候选池性质 | PL-2 |

### 阶段出口判据（摘要）

- **PL-1**：`_runPluginScript` 路径产物 job 与 HTTP 路径同装置覆盖（并发上限/心跳/僵尸扫描/取消链四项逐一对账）；300s 上限消除且对话发起的长任务可后台跑完不阻塞模型回合；既有 agent 分析链路回归零断（BLOCK-121 flow 复跑）。
- **PL-2**：tools-executor 终态转换发布 jobs 失效事件（对账：非对话内 job 完成到前端感知 ≤ 秒级）；运行中作业日志端点返回增量（`no_log_yet` 语义退役）；Jobs Wall 实时滚动实机验证。
- **PL-3**：并发满时作业入队且队列位置可见；瞬态失败按策略自动重试且重试留痕；确定性失败不重试直接进失败诊断。
- **PL-4**：tool_jobs 有 retention 策略在册；桌面结果可批量管理/导出；独立结果页退役或与工作区同一组件（消除 JSON dump 原型面）。
- **PL-5**：`useResultStore` 缓存有逐出 + 项目切换清空；`result:create` 载荷上限 fail-closed；`getByNumber` SQL 下推；生产 DOM 无 debug 属性。
- **PL-6**：产物/revision 文件 URL 不含 token（header 或短期签名）；job 终态持久化失败有补偿机制（重试或恢复标记），不再可能静默滞留 running。
- **PL-7**：候选池性质，出口判据随立项定。

## 4. 与 G0-BIO 的依赖与交织原则

1. **PL-1 → BIO-4 硬依赖**：WGCNA/Seurat/scVI 类长任务（30min+）在 300s 同步路径上必死。解冻垂直分析前必须先统一执行语义。
2. **PL-2 独立高价值**：不依赖任何 BIO 阶段，且对垂直用户体感（「跑完没？」）同样直接。
3. **交织建议 v1**（供裁决，非预设）：BIO-1（信息密度，纯前端）→ PL-2 → BIO-2 → BIO-3 → PL-1 → BIO-4 → PL-3 → PL-4/5/6 穿插 → PL-7。
4. 两 Goal 阶段互不阻塞时按用户裁决的 backlog 推进序执行；冲突时先回写本计划 §4 再执行。

## 5. 待裁决项登记

| # | 事项 | 裁决点 |
| --- | --- | --- |
| PL-D1 | 独立结果页 `/project/:id/results` 处置 | 退役（深链跳工作区）vs 升级为工作区组件宿主 |
| PL-D2 | retention 默认策略数值 | tool_jobs/桌面 results 保留多久、超限动作（归档 vs 删除）。2026-10-08 已裁决 30 天删除（主代理按推荐代裁，用户批量推进授权；先例=task_events 30 天）——BLOCK-149 落地：BIOF3_TOOL_JOBS_RETENTION_DAYS 缺省 30（显式 env 覆盖语义不变，0/负数=显式关闭，非法值 fail-closed 关闭）；桌面 results 域与归档 vs 删除细分仍留后续裁决 |
| PL-D3 | token 替代方案 | 请求头（需改下载链路）vs 短期签名 URL |
| PL-D4 | 队列深度上限与排队超时行为 | 超限拒绝 or 降级提示 |

## 6. 非范围（红线）

- 不启动 G1+ 事项（Provider/公证/签名/GA/dist staleness）——G0 开发期常态。
- 不重做 §2.7 强项（artifact truth/provenance/revision 血统）——只在其上补装置。
- 不绕过单工作包串行纪律并行开包；本 Goal 不授权任何阶段自动启动。
- 不新增运行时 npm 依赖（DEPENDENCY-CHANGE-CHECKLIST 默认 no；PL-2 日志流优先用现有 spawn/fstream 能力）。

## 7. 台账关系

- 全局推进序：`pending-work-backlog.md`（阶段种子入队时逐行登记，指向本计划）。
- 当前立即任务：`next-steps-roadmap.md`。
- UI 面阶段（PL-5 部分）同提交更新 `ui-productization-audit.md`。
- 收口语义：单阶段收口回写本计划阶段表 + backlog 已完成区；Goal 整体收口时 registry status 翻 completed 并跑 docs:reconcile。

## 8. 实施记录

### PL-6a stale-running 兜底对账器（2026-09-29 completed·首刀）

- **范围**：新增 `helpers/stale-running-reconciler.js` 挂载 server.js（retention-sweep 同装配区）——周期 60s 扫描 status='running' 行，**进程内无 owner**（tool-job-lifecycle-registry 的 activeToolJobs 不含该 id）且心跳超时（10min=30s 心跳间隔 20 倍余量）或无心跳超启动宽限（5min）的，行级幂等 UPDATE → failed（error='terminal_persistence_lost: reconciled by stale-running check'）+ publishJobTerminalState + notifyScheduler——**一次性兜死勘察 PL-6 第 6 节全部六条滞留路径**（终态写失败仅 warn 后放弃的各场景）。
- **防误杀设计**（勘察风险项落实）：判定主据=activeToolJobs 有无 owner（进程活着在跑绝不动——心跳写失败静默属已知路径，owner 在场而心跳停更不是滞留）；pending 不扫（调度泵自治域）；对账器自身故障 warn 可观测不重蹈「泵静默吞」。
- **边界与后续**：tools-executor.js 内四处点状修补（ssh-direct 926/adopt 990/settleSpawn 1598/泵日志 610）**因并行会话 WIP 占用文件，登记为 WIP 合入后加映**——其后果（滞留 running）已由本对账器兜底，风险清零非延期裸奔。
- **验证**：契约测试 4/4（无主收口+幂等/有 owner 绝不动含心跳停更十倍超时场景/无心跳宽限/不扫 pending）+ eslint 0 + test:changed 分类无冲突。G0 开发期常态 · 不外推 packaged/Provider/GA。

### PL-4a tool_jobs retention 策略（2026-09-29 completed·出口判据「retention 在册」达成）

- **范围**：tool_jobs 纳入 retention-sweeper 在册（终态 completed/failed + completed_at 超 90 天窗口，对齐 copilotMessages 保守值）——每次分析 1 行（result_json manifest 数十 KB）+ 一个 job 目录（inputs 副本 + all_results.zip 双份）的无界增长止血。**保护面**：is_public=1 与 PUBLIC_DEMO_JOB_IDS 双保险；pending/running（含对账器管辖域）绝不删。**目录级联**：删除前行 SELECT (id, project_id) → 项目内布局 resolveProjectRunLayout 解析 jobRoot（与 tools-executor 的 cleanupLocalToolJobDir 同语义，该函数为工厂闭包不可直接复用故内联等价实现）+ 全局 jobsDir 回退；目录清理失败不阻塞行删除（warn 留痕）。
- **实机抓真两课**（测试先红暴露）：①completed_at 是 INTEGER 毫秒——不能复用 isoDaysAgo 的 datetime() 字符串（SQLite 类型序 INTEGER < TEXT 恒真，会把所有终态行当超窗；既有表是 TEXT 时间才适用）；②DELETE 误写 NOT IN victims（自己排除自己，目录清了行不删）。
- **软引用风险**：scientific_task_specs.tool_job_id / lineage / truth-projection 对已删行按 .get() 容错（lineage 实证 null→「无血缘可投影」诚实回退）；与既有单条删除端点 DELETE /api/tools/job/:id 同后果同风险等级。
- **验证**：pl4a 契约测试 3/3（超窗终态删+活跃/终态外永不删+目录级联 / is_public+demo 双保护 / 目录缺失不炸）+ block106 存量 retention 测试 6/6 零回归 + eslint 0 + 分类无冲突。PL-4b（治理 UI）另刀。G0 开发期常态 · 不外推 packaged/Provider/GA。

### PL-4b 结果治理 UI+API（2026-09-29 completed·出口判据「桌面结果可批量管理/导出」达成，PL-4 三判据齐）

- **范围**：①后端三端点（tools-platform，装配不变）：`POST /api/tools/jobs/batch-delete`（终态门 done/completed/failed/cancelled + is_public 与 PUBLIC_DEMO_JOB_IDS 双保护 + 目录级联复用 cleanupLocalToolJobDir + 逐条结果部分失败不毒化，单批上限 200）/ `GET /api/tools/storage-summary`（jobsDir 一次 walk 有界 500 目录 + 行数分组）/ `POST /api/tools/jobs/export`（所选 job 目录聚合 zip 流式下载，archiver 仓内既有依赖，单批上限 50，空集诚实空 zip）；jobsDir 可注入（工厂参数，测试用）。②前端 JobsWall 治理条：存储概览文本 + 全选/清空 + 导出所选 + 删除所选（confirm 两步）+ 终态瓦片多选框（外层 div 包裹防 button 嵌套交互冲突，选中态 accent 描边）；选择集随轮询刷新做渲染期派生收敛。
- **history 分页延期**：端点在 tools-metadata.js（并行会话 WIP 占用），登记 WIP 合入后加映；MAX_TILES=12 截断下分页非本面阻塞。
- **实机抓真**：config-helper 是 Proxy 导出（无 {config} 具名解构——storage-summary 500 复现修正）；批量删首版漏 PUBLIC_DEMO 名单检查（契约测试 3!==2 抓真补双保险）；后端残留在动态口 60720（启动瞬间 3001 被占自动改口，前端 preload 注入同口功能不受影响）。
- **验证**：pl4b 契约测试 3/3（batch 六分类逐条/export PK 魔数+空 ids 400/summary 形状）+ 前端 window 定向 6/6 + tsc 0 + eslint 净（set-state-in-effect 两处重构：取数函数返回文本回调 setState、选择集渲染期派生）+ **实机三端点全通**（概览 7 目录/261KB/138 行实测；导出 200 PK 魔数 22 字节 zip；batch 空_ids 400）+ 分类无冲突。G0 开发期常态 · 不外推 packaged/Provider/GA。
