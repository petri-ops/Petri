# BLOCK-64 — 指挥中心使用体验全面评估（问题清单 + 优化方向）

> 状态：`completed`（2026-09-09 用户裁决启动，同日整包收口：P1-a + P1-b + P2-d 全落地，实机 9 断言全 PASS（`acceptance/block-64/`），UI-313 verified，提交 `abc19b62`。P2-c 归 BLOCK-65；P2-d ⑧「三面统一叙事」评估结论 = 不合并（§7 收口记录）。G0 开发期常态 · 不外推 packaged/Provider/GA）
> 立项日期：2026-09-08（用户裁决「立新的 BLOCK」）
> truthDomain: `block-64-command-center-ux`
> 来源：用户问题——指挥中心「是否按项目绑定 / 是否冗余 / 是否使用便捷」等，要求问题查找与优化方向

## 1. 评估对象与事实基线

**评估对象**：指挥中心 = BLOCK-59 P3 多任务俯瞰单例窗（`/window/command-center`，[CommandCenterPage.tsx](../frontend/src/pages/window/CommandCenterPage.tsx) 140 行 + [command-center.module.css](../frontend/src/pages/window/command-center.module.css)）：网格瓦片聚合最近 12 个 tool_jobs（`/api/tools/history` 5s 轮询只读投影，零第二真相），点击瓦片下钻 L1 结果窗；TitleBar 右区单入口；窗口几何持久化记忆（`_window-manager.js:63-68` 1200x820 + geometryMemory）。

**评估方法**：全量源码走读 + 全应用「作业状态展示面」冗余盘点（11 个面逐一核对其数据源/入口/能力，见 §3 引用）。

## 2. 三问评估结论

### 2.1 是否按项目绑定？——跨项目绑定是合理定位，但缺归属标注

- 数据源 `GET /api/tools/history`（[tools-metadata.js:268-277](../core/biof3-server/routes/tools-metadata.js)）按 user 过滤、**无 project 参数**、`created_at DESC LIMIT 50` 再截 12——指挥中心是全应用**唯一**跨项目作业面（其余面全部项目级或会话级）。
- 「指挥中心」作为全局部落，跨项目合理；缺陷在**瓦片无项目归属标识**（只有 `name/tool_id`/远程徽章），跨项目混排时用户无法分辨作业来自哪个项目（job 对象含 `project_id/conversation_id`，前端有数据没渲染）。
- 与项目级结果库（ResultsLibrary，项目内列表）分工在数据源层面清晰（history vs `/api/projects/:id/jobs`），**不构成冗余**。

### 2.2 是否冗余？——分工基本清晰；真空白是 agent 维度，「运行中」被切成三个互不相通的面

全应用 11 个作业/进程状态面盘点：指挥中心（跨项目俯瞰）/ 结果库（项目归档）/ WorkspaceSummaryCard（项目摘要+running 前 3）/ ResultView（单作业详情）/ RightPanel results tab（间接状态）/ SimpleChat ToolActivityList（会话内工具行，SSE 流式尾部）/ ToolActivityDock（`workspace_exec_background` 后台进程，1s 轮询+32KB 日志尾）/ 结果独立窗（只读产物）/ 首页最近完成卡 / 全局搜索命中 / RailPage（弹窗注册表投影，与 tool_jobs 无数据关系）。

- **冗余可控**：各面数据源分层（history / project jobs / 会话 SSE / 进程表），无第二真相违规。
- **真空白 ①agent 维度**：BLOCK-59 plan 承诺指挥中心聚合「所有 agent/作业实时状态」，实现只读 tool_jobs——子 agent（BLOCK-49）状态只有会话内 SubAgentsBar（内存 Map，刷新后靠迟到补账），**无任何跨会话 agent 俯瞰面**，指挥中心对 agent 完全不可见。
- **真空白 ②「运行中」三面互不相通**：tool_jobs（指挥中心/结果库）、sub-agent（SubAgentsBar）、后台 shell 进程（ToolActivityDock）各一套展示，无统一「正在运行的东西」入口。

### 2.3 是否使用便捷？——四个硬伤（详见 §3）

## 3. 问题清单（分级，含证据）

| # | 级别 | 问题 | 证据 |
| --- | --- | --- | --- |
| 1 | **P0 真 bug** | `mapToolJob` 丢弃 `execution_target_id`——后端 SELECT 显式返回、前端类型声明了、mapper 没映射 → 指挥中心与结果库的「远程」徽章（BLOCK-57 交付）**生产环境永不渲染**；两处测试均手工注入字段才通过，掩盖断链 | [project-store.ts:196-211](../frontend/src/lib/project-store.ts) vs [CommandCenterPage.tsx:120-122](../frontend/src/pages/window/CommandCenterPage.tsx) / [ResultsLibrary.tsx:75-81](../frontend/src/components/workspace-panels/ResultsLibrary.tsx) |
| 2 | **P1** | running/pending 瓦片点击只提示「无产物可下钻」——**全前端不存在 tool job 日志查看器**：`/api/tools/status/:id` 的日志字段前端未消费、无日志 SSE；最需要「盯」的运行中作业反而零可动作 | [CommandCenterPage.tsx:64-89](../frontend/src/pages/window/CommandCenterPage.tsx)；后端 cancel 同理 |
| 3 | **P1** | **无取消入口**：后端 `POST /api/tools/cancel/:id` 存在（[tools-platform.js:60](../core/biof3-server/routes/tools-platform.js)），前端零调用；跑错作业只能等它自己结束或重启 | 同上 |
| 4 | **P1** | 12 瓦片取「最近 12」**无状态过滤/置顶**：done/failed 历史把 running 作业挤出俯瞰墙（连续小作业场景下长任务不可见）；失败瓦片连 `job.error` 都不显示（ResultView 有） | [CommandCenterPage.tsx:46](../frontend/src/pages/window/CommandCenterPage.tsx) `data.slice(0, MAX_TILES)` |
| 5 | **P1** | 跨项目瓦片无项目归属标注（§2.1） | job.project_id 有数据未渲染 |
| 6 | **P2** | agent 维度俯瞰空白（§2.2 真空白①）：spawn_agent 任务不进指挥中心，plan 原意未兑现 | BLOCK-49 SubAgentsBar 为会话内存态 |
| 7 | **P2** | 入口单一：仅 TitleBar 按钮，无快捷键、无菜单项；空状态文案无引导跳转；「多任务时才打开」的定位无任何自动唤起（如首作业转后台时提示） | 全仓 grep 仅 [TitleBarRightZone.tsx:106-117](../frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx) 一处入口 |
| 8 | **P2** | 「运行中」三面（tool_jobs / agent / 后台进程）无统一叙事（§2.2 真空白②），各自入口分散 | ToolActivityDock / SubAgentsBar / 指挥中心互不引用 |

## 4. 优化方向（候选实施阶段，按档排队待用户裁决勾选）

- **P1-a 修复断链与标注（小，可独立收口）**：① `mapToolJob` 补 `execution_target_id` 映射 + 两个测试改走真实 mapper（远程徽章复活）；② 瓦片加项目名标注（project_id → 项目名，复用项目缓存）；③ 失败瓦片显示 `job.error` 摘要（title 悬停全文）。
- **P1-b 指挥中心本职增强（中）**：④ 状态分层——running/pending 置顶分区或「活跃/历史」过滤开关，活跃作业不被历史挤出；⑤ 瓦片行动作——running：查日志（消费 `/api/tools/status` 日志字段或最小日志轮询）+ 取消（复用后端 cancel 端点，需确认卡）；done：下钻结果窗（现状保留）。
- **P2-c agent 俯瞰补全 → 已移交 BLOCK-65**（2026-09-08：子智能体专属界面立项后，agent 俯瞰/瓦片设计统一归 `block-65-subagent-ux` 评估，本包不再重复范围）。
- **P2-d 体验完善（小）**：⑦ 快捷键入口 + 空状态引导跳转；⑧ 「运行中」三面统一入口叙事（评估后再裁决是否合并面，避免过度工程）。

## 5. 验收门（实施阶段启用）

- 修复类（P1-a）：远程徽章在真实 history 数据下渲染（测试禁手工注入）；定向 vitest + tsc 0。
- 增强类（P1-b/P2）：dev Electron 实机——多作业并发场景瓦片分层正确、日志/取消动作全链可用、取消经确认卡；证据 `acceptance/block-64/`。
- 台账：涉 UI 增量同提交回写 `ui-productization-audit.md`（UI-### 开工时占号）；`ui:audit:check` + `docs:check` 必跑；收口 `docs:reconcile`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 治理边界

- 本包现状 = **评估已交付（本文档），实施未启动**；P1-a/P1-b/P2-c/P2-d 由用户裁决勾选后按单工作包串行推进（UI-305 优先）。
- 零第二真相红线继续有效：指挥中心任何增强只读既有真相（tool_jobs / task_events / 进程表投影），不建本地状态缓存。
- 范围外：RailPage 改造（BLOCK-59 已收口范围）、ToolActivityDock 合并（P2-d 仅评估）、结果窗/终端窗行为。
- 0 新 npm 依赖倾向。

## 7. 进度记录

- 2026-09-08 **planned 立项 + 评估交付**：用户裁决「立新的 BLOCK 全面评估」→ 全量源码走读 + 11 作业面冗余盘点完成（§2–§3），P0 真 bug 1 项（mapToolJob 断链）+ P1 四项 + P2 三项入清单，优化方向四档（§4）。排队待用户裁决勾选实施范围（UI-305 已收口）。
- 2026-09-09 **整包收口 completed（P1-a + P1-b + P2-d，提交 `abc19b62`）**：
  - **P1-a**：① mapToolJob 补 `execution_target_id` 映射 + mapper 级回归（真实 listAllJobs 路径，禁手工注入）——远程徽章复活；② 瓦片项目名标注（listProjects 缓存，降级裸 id）；③ 失败瓦片 error 单行摘要（title 全文）。
  - **P1-b**：④ 活跃置顶（commandCenterModel.orderJobsForWall：running/pending 分区置顶、区内降序；副标题活跃 X · 历史 Y）；⑤ 瓦片行动作——查日志（新端点 `GET /api/tools/log/:id`：remote-runner.log 实时镜像优先 / run.log finalize 兜底 / 32KB 尾部 / 无文件诚实 no_log_yet；前端 1s 轮询）+ 取消（两步确认 3s 自动解除 → POST /api/tools/cancel）；连带把 `cancelled` 提为一等 ToolJob 状态（此前 mapper 塌缩成 pending，取消后作业会永远以「排队中」挂墙——双端标签 + 灰点样式修正）。
  - **P2-d**：⑦ Ctrl/Cmd+Shift+C 快捷键（App 根注入，单例 popOut=已开即聚焦）+ 空态引导文案；⑧ 「运行中」三面统一叙事**评估结论：不合并**——tool_jobs（指挥中心/结果库，作业真相）/ task_events（SubAgentsBar，会话内 agent）/ 进程表（ToolActivityDock，pty 进程）三者真相域不同、生命周期不同，强合并需造跨域投影层（第二真相风险），指挥中心已提供作业维度的全局俯瞰入口，维持三分散入口 + 各自语义。
  - **门禁**：定向 vitest 9/9 + 受影响面（window/project-store/workspace-panels）38/38 + tsc 0 + ui:audit:check PASS；实机 `acceptance/block-64/`（7 fixture 作业：快捷键开窗 / 活跃置顶 / 项目标注 / 远程徽章 / 失败摘要 / run.log 中文 marker / 取消两步确认 → cancelled，9 断言全 PASS + 截图）。
  - **实机教训**：CBP 输入管线保留 Ctrl+Shift+C（Chromium devtools inspect 同款组合），CDP Input.dispatchKeyEvent 注入被吞——验收改用页面级真实 KeyboardEvent 注入（与 BLOCK-63 宿主拦截同类证据等级）；真实用户键序不受影响。
  - **遗留登记**：cancel 对无进程归属的 running 作业诚实 409（execution_owner_unavailable，防止误标取消）；agent 维度俯瞰空白按计划移交 BLOCK-65。
