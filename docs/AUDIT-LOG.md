最后更新：2026-11-16（✅ **用户裁决 P6 pressure 腿销号**：「生信垂直领域非当下需求，清理掉」→ 活跃待办销号、移入延期挂起；外部条件 1→0；销号依据=裁决非 bundle 恢复，404 事实与 BLOCK-448 原补腿条件原样保留不冒充通过。执行队列③ U/E 材料核对补齐、BLOCK-451 M-55 completed 详见处理记录。串行槽位空闲。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-16（🏁 **BLOCK-451 completed（M-55 SSE 真实端点行为测试腿）**：执行队列①probe 当次仍 404（NoSuchBucket）→走②；解锁=:3001 无头栈 200 + `/api/events` hello 帧；交付 lib-sse-frames 纯函数判据 + 7 契约（HK-01 红→绿，抓真修实现）+ impact-map 单一归属 + 真实回放证据 allPass（22 帧/裸 DONE/终态顺序）；邻域 37/37、types/secret/arch/ui-audit/docs 全绿；closeout 第 5 门两存量红 W 归属如实登记；换标批 WIP 零触碰。串行槽位空闲。证据=acceptance/block-451/。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-15（🏁 **BLOCK-450 completed（M2 尾巴清偿）**：M2-4-db task_events (task_id,seq) UNIQUE 约束三层落地（启动行数守恒碰撞重排——`id` 为 rowid 别名显式 `AS rowid`，首版缺陷被红测试当场抓真 + changes≠1 fail-closed + 唯一索引 + 运行时原子 max+1 重分配重试，调用方 API 零变化），红绿 3/3（58498ae7）、dev 库副本实测 4 组/4 行重排零删除 4,863 行守恒、gate:long-task-resume 三连 0 issues、closeout:full ×2 全绿（过程红四起四落按协议闭环：knip 入口 04ac52c0 / code-size 台账 / lint 分域只减 P1489 / perf B2）；M2-live 登记 BLOCK-449 31/31 闭环——M2（BLOCK-428）证据链闭合。证据=acceptance/block-450/。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **BLOCK-449 completed（M7 §8 第 3/5 条补腿收口）**：T2 9223 离屏实机腿 31/31（崩溃注入→同库重启→resume 逐字对齐+截图在册），抓真修复 2 缺陷=①evals-harness 同库二次 spawn 重放非幂等迁移（duplicate column，2a40bf7f）②**resume 路由冲突 P1**（team.js not_paused 全量遮蔽 BLOCK-38 中断续跑→非 paused 态 next() 让位，14353c78，回归锚 4/4）；T3 closeout:full 三连全绿 0 门禁级 SKIP（knip 动态入口注册 29cbf478 + perf 基线 B2 重绑阈值零改动）；T1 三历史红清账。M7-3/M7-5 上限当次达成。证据=acceptance/block-449/。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **BLOCK-448 completed（终态 `done-partial` · P6 恢复腿 driver 语法修复 + 公开投影脱敏）**：用户发令「搞定 P6 恢复腿」。**修掉两个真实缺陷**——① `lifecycleExpression` 把 `publicProjectionHits` 误插在 `return` 对象闭合之后，整段脚本成非法 label 序列，`executeJavaScript` 恒抛 SyntaxError 被调用点 `catch {}` 静默吞成 `lifecycle=null`，`waitForLifecycle('ready')` 必然跑满 120s（自 2026-09-25 起潜伏，长期被上游源绑定红掩盖）；② 两处公开投影泄漏（后端 `intentSummary` 直接 slice 原文、前端参数 diff 经 `displayValue`，把 `job_…` 回显到版本面板，P6 `publicProjectionClean` 实测命中 3 次）。**结果**：恢复腿 **PASS**（`active-crash` → SIGKILL → `recover` 两段走通、`publicProjectionClean` 转绿）；pressure 腿 **`external-blocked`**——`go-kegg` 作业 `failed`，根因 `r-enrichment` capability bundle 分发端 **HTTP 404**（`provision_failed`），本机 R + `clusterProfiler`/`org.Hs.eg.db`/`ggplot2` 齐备、同轮 `volcano-plot` `completed` ⇒ 非产品缺陷、非本包引入。**P6 证据未重采**（`p6_stored_current_source_hash_mismatch` 持续）、`closeout:full` 三连未跑，**不冒充通过**。门禁：新增语法门禁 3/3、后端脱敏 4/4、前端脱敏 4/4；`closeout` 定向 PASS（`arch-cycles`/`quality:arch` 域不相交 SKIP；`quality:perf` 首轮受同轮负载红、隔离复跑与二次 closeout 全绿）。补腿条件单条=`r-enrichment` bundle 恢复后重跑 `g0:result-studio:p6:update` → `closeout:full` 三连（同时闭合 M7 §8 第 3 条）。证据=`acceptance/block-448/p6-pressure-blocked.json` + `docs/block-448-p6-recovery-driver-syntax-plan.md` §7。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **UI 设计专项 D0–D5 = BLOCK-415~423 整批入库（代码/门禁/证据/文档本体）**：此前只有台账与 `DOC-REGISTRY` 登记在册、文档与代码本体一直未提交，`ui:audit:check` 因此长期报「当前工作区包含 UI 改动，但没有同步台账」。本批一次入库：**79 个改动文件**（BLOCK-421 工作区布局单源 `--ws-*` / BLOCK-422 消息区 860px 阅读宽 + tertiary 对比度 4.40→4.81 / BLOCK-423 设置页视觉改版 / D3 hover-selected 单源与裸 z 111→104 / 非 WIP 57 文件 `;;` 清零）+ **10 个** `scripts/ui-design-*.mjs` 机械门 + `package.json` **九条** `gate:ui-*` + `ui:scorecard` + **8 个** `test/ui-design-*.test.mjs` + **9 份**计划文档（block-415~423）+ 3 份人眼路线/验收清单/IA 决策材料 + `acceptance/ui-design-assessment-2026-11-11/`（d0–d5 证据 + 4 张实机 PNG）+ 2 个离屏 flow（`ui-d2-geometry-live` / `ui-d4-a11y-live`）。`test/block321c-center-priority.test.mjs` 的 gap 锚随 BLOCK-421 契约演进（20px 字面量 → `--ws-layout-gap` 单源，默认 20px 仍与 `CENTER_GAP_TOTAL=40` 同源、≤960 覆盖走既有 `--petri-space-4`），非放宽。当次验证：`gate:ui-program` **6/6**、ui-design 测试 **58/58**、`theme-token-contract` **19/19**、设置面板 **88/88**、`block201-settings-baseline` **4/4**、`quality:types` **0 红**、`ui:audit:check` 由红转绿（633 个 UI 编号）。**程序终态仍 `done-partial`**：22 条人眼签字槽全空、观感不代答。**P6 源绑定（如实登记，不冒充通过）**：入库前红为 `p6_current_source_tree_not_exact`（8 个源文件工作区脏），入库后转为 `p6_stored_current_source_hash_mismatch`（证据观测值仍停在 2026-09-25、`sourceCommit=cabee3a0`）；两次 `g0:result-studio:p6:update` 均在 `inspect_active_operation_before_crash` 的 `waitForLifecycle('ready')` 超时失败（`--live --keep` 取真：renderer 停在「结果修改正在运行」，canvas/resultStudio/backend 26 项检查全 ready），叠加清理期 `active_electron_group_sigterm_failed`(EPERM)。**归因为既有缺口而非本批引入**——本批对该腿只动了 6 个纯样式 CSS 与 `package.json`，`cabee3a0..HEAD` 对 result-studio 生命周期/路由源码零提交；修复需 Result Studio 证据 owner 立案（driver 等待态与产品「任务运行中不提供恢复」语义的时序错配）。`closeout` 链不挂此 CLI，`test:changed` 定向口径绿；全量脚本校验仍红，不得表述为 P6 通过。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **BLOCK-447 completed（MCP App 页面自动渲染 + 双向 RPC）**：后端保真透传 `_meta.ui.resourceUri`、前端工具活动自动挂 `McpAppCard`、沙箱页 `window.petri.mcpApp.callTool` 经 session 绑定代理到 MCP 客户端；伪造 session / 伪造 origin 均拒绝。前端 6/6、源码契约 5/5、离屏 Electron prepare+callTool 实测。未覆盖=ext-apps 原生 SDK 协议 shim、完整 agent→卡片实机腿。证据=acceptance/m-blueprint-2026-11-11/m6a/mcp-app-auto-render.json。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **BLOCK-446 凭据 file 后端加密化+错误语义分离 completed**：file 后端全写路径 encryptAll 落盘零明文（mcp-env-crypto 单源 AES-256-GCM）+ 整组急切迁移 fail-open + 损坏/不可读 fail-closed 拒覆写 + status() 三态健康面；红绿先行 9/9、邻域回归绿、test:changed 1425/1435 三红先于本包归因（UI-629 W/block414 环境/P6 W）；治理门七项 PASS；closeout 第 4 门 ui-audit 被他方 WIP 拦停如实登记；unmappedTests 90→89 棘轮改善。证据=acceptance/block-446/gate-evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA.）
最后更新：2026-11-14（🏁 **BLOCK-445 completed（通用 Agent 插件/技能兼容层）**：任意 Agent 的插件目录/技能目录统一识别（ZCode/Claude/Codex/CodeBuddy/… + `.agents/skills`），skills 原生导入、MCP 配置投影（含 `${ZCODE_PLUGIN_ROOT}` 变量替换与插件目录复制）、commands→合成技能、MCP App 页面宿主链路（后端 readResource / 主进程 prepareMcpApp / preload）；真实 ZCode 五个插件试跑通过，444 6/6 + 445 5/5，离屏 Electron 实测 prepareMcpApp 返回沙箱 URL。未覆盖=JS 扩展宿主/hooks/前端自动渲染/插件构建依赖，已在证据里精确列出。证据=acceptance/m-blueprint-2026-11-11/m6a/universal-plugin-compat.json。G0 开发期常态 · 不外推 packaged/Provider/GA.）
# 审计广播台 (AUDIT-LOG)





















































> 本文件只保存需要主 Agent 看见的活跃广播与最近处理记录。
> 每次会话先读本文件；只有追溯问题来源时才读取[完整历史归档](./archive/checkpoints/audit-log-through-2026-10-11.md) · [through-2026-09-19](./archive/checkpoints/audit-log-through-2026-09-19.md) · [through-2026-09-17](./archive/checkpoints/audit-log-through-2026-09-17.md) · [through-2026-09-16](./archive/checkpoints/audit-log-through-2026-09-16.md) · 上一档：[through-2026-09-13](./archive/checkpoints/audit-log-through-2026-09-13.md) · [through-2026-09-12](./archive/checkpoints/audit-log-through-2026-09-12.md)（更早前史：[through-2026-07-26](./archive/checkpoints/audit-log-through-2026-07-26.md)、[2026-08-pre18](./archive/audit-log-2026-08-pre18.md)）。
> 非主 Agent 发现阻塞、可安全合并或需评估事项时追加到“当前待处理项”，不要把长篇完成历史重新堆回本文件。
> 入口直链（registry `entrypoint` 指向本台的 canonical 文档，归档轮转不得切断发现路径）：[block-14-left-panel-qa-fix-closeout](./block-14-left-panel-qa-fix-closeout.md) · [block-15-architecture-perf-plan](./block-15-architecture-perf-plan.md) · [block-22-codemirror-inline-diff-plan](./block-22-codemirror-inline-diff-plan.md)


## 当前待处理项

| 状态 | 日期 | 事项 | 处置边界 |
| ✅ | 2026-11-11 | **M1=BLOCK-427 收口登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位）**：长任务内核三件套纯新增、Infinity 契约与主循环零改动；closeout exit 1 两红 W 归属如实登记；主循环接线 done-partial 归 M6-A | plan=docs/block-427-m1-long-task-kernel-plan.md | BLOCK-427 / COMPLETED |
| ✅ | 2026-11-11 | **M0=BLOCK-426 收口登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位）**：六项改进点全数交付，closeout exit 1 两红 W 归属如实登记；串行槽位转空，M1 按预授权继续 | plan=docs/block-426-m0-criteria-calibration-plan.md | BLOCK-426 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-421-WORKSPACE-LAYOUT-REFACTOR 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户显式裁决+授权接管 WIP）**：范围=布局定义单源 / 断点变量化 / 四块几何量测；红线=不撤销既有中栏裁决 / 不改视觉 token / 不放宽基线 | plan=docs/block-421-workspace-layout-refactor-plan.md | BLOCK-421 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-420-UI-DESIGN-D5-FINAL 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=汇总门 / 评分卡复评 / gap-ledger / 三连；红线=U·E·V·W 不代答 / 不放宽基线 / 红如实标注 | plan=docs/block-420-ui-design-d5-final-plan.md | BLOCK-420 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-419-UI-DESIGN-D4-A11Y 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=八态矩阵 / focus-visible 只减 / WCAG AA 纯函数 / 9223 离屏 / 人眼签字槽；红线=E 不代答 / 零新增依赖 / WIP 零触碰 | plan=docs/block-419-ui-design-d4-a11y-plan.md | BLOCK-419 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-418-UI-DESIGN-D3-VISUAL 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=token 语义单源 / 裸 z 只减 / `;;` 清零 / 双棘轮下调；红线=WIP CSS 零触碰 / 不放宽基线 / U·E 不代答 | plan=docs/block-418-ui-design-d3-visual-plan.md | BLOCK-418 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-417-UI-DESIGN-D2-LAYOUT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=断点单源与对齐 / 布局定义唯一性门 / 9223 离屏几何腿；红线=WIP CSS 零触碰 / U-04 不代答 / 零新增依赖 / 不放宽基线 | plan=docs/block-417-ui-design-d2-layout-plan.md | BLOCK-417 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-416-UI-DESIGN-D1-IA 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=单一入口表 + 入口↔路由双向对账门 + 页头残留清理 + U/E 材料；红线=零 UI 结构改动 / 零新增依赖 / U·E 不代答 / 零触碰他方 WIP 与并发写入者在制 | plan=docs/block-416-ui-design-d1-ia-plan.md | BLOCK-416 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-415-UI-DESIGN-D0-BASELINE 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=对账基线机械门 + UI 验收清单 v1 + 门禁读数快照 + plan.started 留痕；红线=零 UI 代码改动 / 零新增依赖 / U·E·V·W 不代答 / 不为过门改台账 | plan=docs/block-415-ui-design-d0-baseline-plan.md | BLOCK-415 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-414-POST-K7-W5B-SLICE-1-SIMPLECHAT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=SimpleChat.tsx 第一刀内聚抽取；红线=零行为变化/拆前拆后同套绿/零新增依赖 | plan=docs/block-414-post-k7-w5b-slice-1-simplechat-plan.md | BLOCK-414 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-413-POST-K7-L6-FOLLOWUP-THEME-GATE-EXPANSION 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=L-66/67 续（theme 门 .tsx 扩面+z-index 棘轮+内联债全量基线）；红线=观感归 E 不代答/零新增依赖 | plan=docs/block-413-post-k7-l6-followup-theme-gate-expansion-plan.md | BLOCK-413 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-412-POST-K7-L4-FOLLOWUP-MESSAGES-CONTRACT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；预授权连续工作延续）**：范围=L-31 续（COUNT 索引化+export 流式）；红线=分页行为逐字对齐 K2 基线/零新增依赖 | plan=docs/block-412-post-k7-l4-followup-messages-contract-plan.md | BLOCK-412 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-411-POST-K7-L7-FINAL-CLOSEOUT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L7 五项终态化 | plan=docs/block-411-post-k7-l7-final-closeout-plan.md | BLOCK-411 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-410-POST-K7-L6-EXPERIENCE-ACCESSIBILITY 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L6 十一条（L-62/70 焦点 → L-63 → L-64/65 台账 → L-66/67 主题门 → L-69/73 → L-72 人设 → L-81 索引）；观感归 E 不代答；ui:audit:check 的 CSS WIP 红延续 W 归属 | plan=docs/block-410-post-k7-l6-experience-accessibility-plan.md | BLOCK-410 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-409-POST-K7-L5-STRUCTURE-SINGLE-SOURCE 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L5 十三条（L-38 → L-39/41/42 → L-44/49 → L-46 W5b → L-78/85/80）；红线=typescript 统一 U 类不擅自升/依赖升级走 checklist/拆前拆后同套绿 | plan=docs/block-409-post-k7-l5-structure-single-source-plan.md | BLOCK-409 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-408-POST-K7-L4-PERFORMANCE-DATAPLANE 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L4 八条（L-24 fork 红绿先行 → L-25/26 → L-31/32/33/34/35）；红线=零新增依赖/worker_threads 若超 scoped 判据出补腿不擅自扩 | 拆前拆后同套绿=BLOCK-92 先例。plan=docs/block-408-post-k7-l4-performance-dataplane-plan.md | BLOCK-408 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-407-POST-K7-L3-ERROR-SEMANTICS 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L3 十一条（L-12/13/14 SSE → L-17 桥 → L-18 扩面 → L-22/16 → L-15/23 → L-68/74）；红线=零新增依赖/词表类别封闭不破 | 红绿先行=HK-01 全适用。plan=docs/block-407-post-k7-l3-error-semantics-plan.md | BLOCK-407 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-406-POST-K7-L2-FUNCTION-INTEGRITY 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L2 十四条（L-01 假成功 fail-closed 最高优先 → L-02 双 server → L-19/20/21 失败形状 → L-03/05 → L-04~L-11 销号）；红线=零新增依赖/不改 skill_execute 产品语义裁决（BLOCK-157 计量 retain-with-reason 不动） | 红绿先行=HK-01 全适用。plan=docs/block-406-post-k7-l2-function-integrity-plan.md | BLOCK-406 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-405-POST-K7-L1-SECURITY-HARDENING 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权连续工作）**：范围=蓝图 §4-L1 十二条（L-50/51/52/53 四 P1 红绿先行 → L-55/57/58/59/60/61 P2 清偿 → L-56/79 U 类材料）；红线=零新增依赖/不改既有用户裁决/不碰用户资产与在制 WIP；U/E/V/W 边界不代答 | 红绿先行=HK-01 全适用（安全行为修复）。plan=docs/block-405-post-k7-l1-security-hardening-plan.md | BLOCK-405 / COMPLETED |
| 🔵 | 2026-11-11 | **BLOCK-404-POST-K7-L0-CRITERIA-GATES 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户 2026-11-11 执行提示词预授权「依据蓝图独立完成全部优化任务，无需用户额外参与…按 L0 发令开工，逐阶段推进到 L7」＝零参与、工程判断下放并逐项留痕）**：范围=蓝图 §4-L0 八改进点（L0-1 解反向门禁 L-37/54/44 读数型+负测 → L0-2 perf 判据重立 L-27/28/30/87 → L0-3 EAR 棘轮 L-29/89 → L0-4 fail-closed L-75 → L0-5 state 兜底+🔵对账 L-86/90 → L0-6 lint 台账机械校验 L-40/88 → L0-7 尺寸门扩面 L-36/43 → L0-8 数字口径单源 L-45/76/77/81/82/83/84）；红线=零产品行为变化/零新增依赖/不放宽基线/不碰在制 CSS WIP 与 10 项用户资产；非范围=L-54 安全行为面归 L1 | 红绿豁免=治理/判据面批（负测即红绿证据）。plan=docs/block-404-post-k7-l0-criteria-gates-plan.md | BLOCK-404 / COMPLETED |
| 🔵 | 2026-11-09 | **BLOCK-385-post-S7-H0-TRUSTED-START 启动登记（历史阶段广播·不占串行槽位；BLOCK-385 已 completed，见处理记录——原「active」表述系 L-90 登记的两层语义冲突源，2026-11-11 L0-5 修正）**：范围=H0 可信起点——①state 两层语义显式化（串行槽位 work-package vs 常驻 living-plan + AUDIT-LOG 🔵 不同层注记 + truthDomain 冲突当场报警）②影响图重复 id fail-closed（block337 同名双条合并，规则 357→356）+ 未映射第一批消亡（C5-db-migration×4→electron-runtime、C9-g0-qualification×3→g0-baseline；145→138）③三段分片当次跑 + 逐件归因 ④canonical 对账（POST-NSO 蓝图→completed、post-S7 蓝图→active/living-plan、backlog 349–354、roadmap/handoff 恢复链、README 入口行补反引号） | 红线=零新增依赖/不动 10 项 untracked 用户资产/不放宽任何基线/不撤销既有用户裁决/未达证据不写 verified。plan=docs/block-385-post-s7-h0-trusted-start-plan.md | BLOCK-385 / COMPLETED |
| 🟡 | 2026-11-06 | **BLOCK-365 W1 接收在制批的处置注记**：用户授权接收会话起始在制批（22M+3 新测试；用户资产与临时目录、并发写入者 UI-696 批不在授权内）。首切片流程=逐文件审读→在制批自带测试+影响面测试→lint/types→model-surface 基线重打留因（993→1083，归因 system-prompt 用户优先级条款）→显式路径提交→P6 源绑定重算（观测数据原样保留）。授权范围为「提交这批既有工作」，不改变其中任何行为 | W1 主项随后：F-01/F-02/F-03/F-14/F-15/F-16 + SSE 收尾 |
| 🟡待环境 | 2026-10-20 | **本机 `bash` 解析到 WSL launcher（`C:\Users\Admin\AppData\Local\Microsoft\WindowsApps\bash.exe`）⇒ block67/block89 fs 测试整类误红**：`bash C:\...\x.sh` 被 WSL bash 读成 `C:UsersAdmin...`（反斜杠被吃），报 `No such file or directory`；与本批改动无关，**在 HEAD 同样复现**。规避=跑 `test:changed` / `closeout` 前把 Git Bash 前置：`$env:PATH="D:\Program Files\Git\bin;"+$env:PATH`（BLOCK-219 收口即用此法，Node 744 项 0 红）。根治=修正系统 PATH 顺序或测试改为显式 Git Bash 路径 ；**同一台机器的第二个坑**：`tar` 解析到 Windows bsdtar（不支持 `--force-local`），`capability-bundles` 等 5 项因此红——收口时 PATH 须同时前置 `D:\Program Files\Git\usr\bin`（GNU tar）与 `D:\Program Files\Git\bin`（bash，两处都要，缺一仍红） | 环境；不阻塞产品判据，但**会误伤任何一次 closeout**——修复前每次收口须前置 PATH 并在笔录里写明 |
| 🟡 | 2026-10-18 | **C-34（BLOCK-212 reopen）**：Claude 缓存断点方案成文——会话级固定工具集 + tools 末项断点 + ≥1024 才打点；验收需真实调用、风险=路由精度，**先决=G1+ 预算** | BLOCK-212 / reopen |
| --- | --- | --- | --- |
| 🔵 | 2026-11-16 | **BLOCK-451-M55-SSE-REAL-ENDPOINT 启动登记（已完成→见最近处理记录；唯一串行槽位；主控提示词 2026-11-16 一次性发令+预授权裁决「从恢复到交付全程自主推进」；Jev next:suggest --supply=cloud QODER 0.60 为规划大纲非可执行，按交接提示词执行队列②收敛到 M-55）**：范围=新增真实 :3001 SSE 端点行为契约测试（`test/m4-sse-real-endpoint.test.mjs`，覆盖 `data:` 帧切分/裸 `[DONE]`/`: ping` 心跳/`afterSeq` 续传/终态语义）+ 挂 impact-map rule（归入 `m-blueprint-program`）+ 当次无窗栈实机读数；解锁前提已实测=后端无头启动 HTTP 200、`/api/events` 返 hello 帧；红线=零新增依赖 / 零放宽基线 / 换标批 WIP（19 图标 + `desktop-shell.js` + `icon-tray.png`）零触碰 / 文件面与 WIP 零重叠；非范围=P6 pressure 腿（r-enrichment bundle 11-16T08:12Z 复探仍 404 NoSuchBucket）、U 类 7 项、E 类人眼、G1+；形态=轻量包（plan=docs/block-451-m55-sse-real-endpoint-plan.md）；HK-01 红绿先行 | plan=docs/block-451-m55-sse-real-endpoint-plan.md / BLOCK-451 / COMPLETED |
| 🔵 | 2026-11-15 | **BLOCK-450-M2-TAILS-UNIQUE-CONSTRAINT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户「继续 不要停」+ 主控提示词 v1.0 预授权 + Jev 不可用确定性兜底）**：范围=T2 约束落地（原子重分配/行数守恒重排/UNIQUE 索引，红绿先行）/ T3 gate:long-task-resume 三连 + perf B2 重绑 + closeout:full / T4 M2-4-db 翻态与 M2-live 闭环登记；红线=零新增依赖/零放宽基线/数据零删除（行数守恒+事务回滚）/WIP 零触碰；非范围=P6 补腿（external 404 原册）与一切 G1+ | plan=docs/block-450-m2-tails-unique-constraint-plan.md | BLOCK-450 / ACTIVE |
| 🔵 | 2026-11-14 | **BLOCK-449-M7-TAILS-CLEAN-CLOSEOUT 启动登记（已完成→见最近处理记录；历史阶段广播·不占串行槽位；用户主控提示词 v1.0 预授权连续工作 + Jev 不可用确定性兜底）**：范围=T1 干净树 test:changed 三历史红重归因 / T2 9223 离屏 dev-verify flow（崩溃注入→重启→resume 逐字对齐）/ T3 closeout:full 三连 / T4 canonical 回写；红线=零新增依赖 / 零放宽基线 / WIP 零触碰 / 无窗实机禁 PETRI_TEST_ONSCREEN；非范围=P6 pressure 腿（external 404 原册）与 M2-4-db 约束（perf 重采另案） | plan=docs/block-449-m7-tails-clean-closeout-plan.md | BLOCK-449 / ACTIVE |
| 🟡建议 | 2026-10-01 | **BLOCK-128 实机验收抓真三条——①③已清偿（2026-10-05 BLOCK-141：①取消终态竞窗分类修复+③process_pid 核实 HTTP 链正常随①收敛），余②**：②**墙面板取消跨后端可达性未定**——Jobs Wall 取消钮 POST rApiBase（:53542 Electron 自spawn 后端），对 owner=:3001 的 job 15s 无效果；双后端脑裂家族（dev-infra §76 长期条款），durable flag 30s 慢路径被探针 fallback 掩蔽未能排除 | ②归属 dev 双后端结构性修复方向（dev-infra §76③ attach 机制），非产品缺陷；非阻塞（取消链本体 SIGTERM 击杀已实证） |
| 🟡延期 | 2026-08-03 | **G0-RS-P7 Honest Product Requalification。** 用户裁决发布级资格工作后移；Result Studio 保持 `implemented_unverified / experimental`，没有 canonical P7 PASS evidence | 重开前必须先解决 selection→enrichment 无 candidate/compare/lifecycle、existing Git consent UI、五条独立 task trace、双 Provider、packaged 六格与 literal OS reboot；历史 RS9、P4R/P6 开发态证据不得冒充资格 |
| 🟡待评估 | 2026-07-26 | **G0 `macos-arm64: qualified` 的视觉证据不成立。** `acceptance/g0-qualification/packaged-ui/` 5 张 PNG 只有 4 个唯一 sha256：`chat-summary-light-wide.png` 与 `restart-restored-light-wide.png` 逐字节相同（均为 `bb54acff…`），即「重启后恢复」证据是重启前截图的副本。`scripts/g0-qualification-visual.mjs:59-62` 只校验哈希格式/宽高/字节数，无唯一性断言；配套 `inspection.json` 为 811 字节九个人工布尔值，仓库内无任何写入者。该形态与 `core/shared-backend/result-studio-qualification.js:113-121` 判 RS9 non-qualifying 的理由（`inspection_booleans_are_human_assertions`）完全一致，但该理由未推及 G0 自身 | 仅登记事实。**不得**由 Agent 擅自变更 `core/shared-backend/g0/support-matrix.json` 的 `qualified` 状态或 `evidence-ledger.json` 的 `visual_state_convergence`——资格状态变更属用户决定。修补检查脚本（加 `distinctStates` 唯一性断言）会使当前 G0 门变红，需先获批。**2026-07-27 用户裁决：暂不发布，故本项降级为待评估、不阻塞开发。** 重开条件：任何对外发布、资格声明或 G0 重新资格之前必须先处理——发布时若仍以此证据支撑 `qualified`，即为不诚实声明 |
| 🟡建议 | 2026-07-17 | `capability-provisioning.js` 的下载实现与 plugin-manager 各自维护 | host 白名单已经修复；共享下载 helper 只在改动该能力时评估，不阻塞 RH0 |
| 🟡延期 | 2026-08-10 | **Windows 代码签名缺失（任务 #55）**：`electron-builder.yml` 仅 macOS 配置 afterSign，Windows 段无证书/签名配置；当前 Windows 安装包为未签名 NSIS（`dist/Petri Setup 0.0.1-rc.7.exe`）。未签名包在 Windows SmartScreen/Defender 下会触发未知发布者警告，属发布门禁缺口，非功能缺陷 | 阻塞于**代码签名证书**：需发布负责人提供 EV/标准代码签名证书并配置 `electron-builder.yml` win 段 afterSign/证书路径。证书到位前不得伪造 `release-contract.json` 的 windows-x64.supported 翻转——当前 `supported` 仍诚实保持 false（reason 已写明"制品存在且通过验证，仅缺签名/公证"）。用户裁决：标记 deferred，待证书到位再闭环 |
| 🟡延期 | 2026-08-10 | **i18n 资源抽离未做（任务 #91）**：全仓无 react-i18next/i18n 框架，用户可见字符串散落于组件（grep 命中多为 `Intl.`/locale 巧合，非 i18n 体系）。抽离需引入 i18n 框架、建立语言资源文件、改造所有文案调用点，属较大前端架构决策 | 阻塞于**产品/架构决策**：是否国际化、支持哪些语言、采用 react-i18next 还是自研轻量方案。决策前不强行抽离（避免半吊子框架增加维护成本）。用户裁决：标记 deferred，待产品明确国际化范围后再立项 |


> **本区段纪律（2026-09-13 清理确立）**：只保留**尚未处置**的条目：🔴 阻塞 / 🟢 建议 / 🟡 延期或待评估。
> 已收口条目（✅）**一律移入「最近处理记录」**，不得在本区段堆积——本次清理将 23 条已收口项迁出，
> 待处理项由 28 行降为 8 行（活跃项占比 100%）。新增 ✅ 项请直接追加到「最近处理记录」。
## 最近处理记录
| ✅ **用户裁决 P6 pressure 腿销号（2026-11-16）**：用户显式裁决「生信层面的垂直领域不是当下的需求，清理掉」→ P6 pressure 腿从活跃待办销号，移入 handoff §五已裁决延期/挂起；外部条件 1→0。**销号依据=用户裁决，不是 bundle 恢复、不是证据通过**：`r-enrichment` bundle 404 历史事实（probe 11-15T07:37Z / 11-16T08:12Z 均 NoSuchBucket）与 `docs/block-448-p6-recovery-driver-syntax-plan.md` §7.3 原补腿条件原样保留，不冒充 P6 通过、不写全绿；P6 恢复腿（BLOCK-448/449）与 RS 状态不变。重开条件=用户重新裁决需求 + bundle 恢复。零产品代码。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-16 | P6-PRESSURE / 用户裁决销号 |
| ✅ **执行队列③ U/E 材料核对补齐（治理批·非工作包）completed**：交接队列③逐项核对——U 类 7 项中 2 项已有合格材料（U-04→`post-h9-k1` 决策 B、TS 双版本→`post-h9-k4`，指针引用不重造），5 项补六段一页决策材料（npm workspaces / test:changed 拆片 / evals closeout / MCP 白名单默认 / CP-16~18 注记冲突对账），E 类 canonical 路线核对（签字槽全空、无材料缺口）。全批终态不变（U `pending_user_ruling` / E `pending_human_eye`），不代答、不改默认语义、零产品代码。证据=`docs/u-e-decision-materials-reconciliation-2026-11-16.md`（registry `U-E-RECON-2026-11-16`）；docs:check 590 PASS。至此交接执行队列①~④全部走完。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-16 | U-E-RECON / COMPLETED（治理批） |
| ✅ **BLOCK-451（M-55 SSE 真实端点行为测试腿）completed**：解锁前提当次实测=:3001 无窗栈 HTTP 200 + `/api/events` hello 帧；交付 lib-sse-frames.mjs 纯函数判据 + 7 项契约测试（HK-01 红 ERR_MODULE_NOT_FOUND→绿 7/7；M55-5 抓真修实现不放宽断言）+ impact-map 单一归属 + 真实 done task 回放证据（22 帧/seq 1→20/裸 DONE/终态顺序/zero issues，allPass）。M4/SSE 邻域 37/37、lint 0 warning、types/secret/arch/ui-audit/docs 全 PASS。closeout 前四门 PASS，第 5 门 test:changed 两存量红（build-packaged-isolated.sh 缺 platform 标注 / block-450 evidence 未映射）如实登记 W 归属、非本包；本包 block-451 unknown=[] 已修。换标批 WIP 零触碰。证据=acceptance/block-451/。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-16 | BLOCK-451 / COMPLETED |
| ✅ **BLOCK-450（M2 尾巴清偿）completed**：M2-4-db task_events (task_id,seq) UNIQUE 三层落地（启动行数守恒重排——rowid 别名显式化首版缺陷红测试抓真 + 原子重分配重试 + 唯一索引，调用方 API 零变化），红绿 3/3、dev 库副本 4 组/4 行重排零删除 4,863 行守恒、gate 三连、closeout:full ×2 全绿；M2-live=BLOCK-449 31/31 闭环，M2 证据链闭合。证据=acceptance/block-450/。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-15 | BLOCK-450 / COMPLETED |
| ✅ **BLOCK-449（M7 §8 第 3/5 条补腿）completed**：T1 三历史红清账（UI-629 17/17 / P6 13/13 / block414 4/4 活栈）→ T2 9223 实机腿 31/31（崩溃→重启→resume 逐字对齐+截图）抓真修 2 缺陷（harness 同库 spawn 重放迁移 / resume 路由冲突 P1 next() 让位+4/4 回归锚）→ T3 closeout:full 三连全绿 0 门禁级 SKIP（knip 动态入口+perf B2 重绑）→ T4 回写。M7-3/M7-5 上限当次达成，M7 原档零触碰。证据=acceptance/block-449/。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-14 | BLOCK-449 / COMPLETED |
| ✅ **BLOCK-447（MCP App 页面自动渲染 + 双向 RPC）completed**：工具结果自动渲染交互页面，页面内工具调用经 session 归属校验；前端 6/6、契约 5/5、离屏实测；未覆盖项精确列明。证据=`acceptance/m-blueprint-2026-11-11/m6a/mcp-app-auto-render.json`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-14 | BLOCK-447 / COMPLETED |
| ✅ **BLOCK-446（凭据 file 后端加密化 + 错误语义分离）completed（用户裁决「好的 按照你的建议来」＝ Jev 单一建议发令；ZCode v3.18.2 systemCredentialCipher 借鉴落地）**：file 后端全写路径 encryptAll 落盘零明文（复用 mcp-env-crypto 单源 AES-256-GCM，密钥与 SETTINGS_DIR 同根）；读取明文透传 + 整组急切迁移（fail-open 不丢值）；损坏/不可读文件 fail-closed 拒覆写（防毁他 provider 密文）、remove 零触碰；值不可解诚实空串密文保留；status() 三态健康面。红绿先行 9/9（红跑 8/9 存档）；邻域回归绿（block414 环境条件红经 HEAD 换置复现=先于本包）；test:changed 1425/1435 三红均先于本包归因；docs 584/secret/arch/code-size/arch-cycles/types/knip 全 PASS；lint 改动文件 0 error 警告净收缩 4→3；closeout exit 1（第 4 门 ui-audit 被他方 172 文件 UI WIP 拦停，如实登记）；coverage 棘轮 90→89。keychain 后端零改动；原生 OS 凭据库/IPC 明文回传最小化=非范围。证据=acceptance/block-446/gate-evidence.json。G0 开发期常态 · 不外推 packaged/Provider/GA. | BLOCK-446 / COMPLETED |
| ✅ **BLOCK-445（通用 Agent 插件/技能兼容层）completed**：任意 Agent 插件与技能目录统一发现/投影，MCP App 页面宿主链路实测可用；真实 ZCode 插件试跑 + 离屏 Electron 验证；未覆盖项精确列明。证据=`acceptance/m-blueprint-2026-11-11/m6a/universal-plugin-compat.json`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-14 | BLOCK-445 / COMPLETED |
| ✅ **BLOCK-439 端到端核对补漏 + 台账补登记**：BLOCK-436 补建册注册；4 次后续提交头部补登记；B2 perf 内容指纹重打 / B3 测试凭据隔离 / B4 impact-map 补挂 4 文件 / B6 M0 owner 脚本入库；全量门禁与测试复跑后提交。证据见 `acceptance/m-blueprint-2026-11-11/m6a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-12 | BLOCK-439 / COMPLETED |
| ✅ **BLOCK-437（拖入源范围门 + 真实栈实测）completed**：`fs/import-from` 源范围判定接线（越界/设备/相对/NUL/缺失全拒，realpath 防逃逸）；实测修正自己第一版的 realpath 归一 bug；体积棘轮下抽两个 helper（files.js 764→682，不改基线）；无窗后端冒烟 10 项全绿、`ddl FAILED=0`。HK-01 15/15。证据=`acceptance/m-blueprint-2026-11-11/m6a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-437 / COMPLETED |
| ✅ **BLOCK-435（M6-A 结构单源第一刀）completed（S1/S2 done；S3 尝试后回退）**：三面共用 schema 门（566 条 + 漂移/缺陷棘轮，抓到 2 个真实缺陷并冻结）、静默 catch 基线 412→406、环消亡实现后被 D7 域中立棘轮拦下→原样回退（不改基线洗白）。HK-01 7/7、lint 0。证据=`acceptance/m-blueprint-2026-11-11/m6a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-435 / COMPLETED |
| ✅ **BLOCK-434（M5-A · 判据层→生产路径接线收尾）completed（4 项 done / 3 项 done-partial）**：secret-scan 故障 fail-closed、全局 Origin 门、DDL 单一入口、zip 失败清理；HK-01 8/8、lint 0、arch/secret PASS、block67 拖出语义 9/9 回归；drag/MCP/帧导航补腿条件在册。证据=`acceptance/m-blueprint-2026-11-11/m5a/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | BLOCK-434 / COMPLETED |
| ✅ **第六轮 M0–M7 优化程序收口（BLOCK-426～433，程序终态 done-partial）**：八阶段单包串行各有 closeout 读数与六件套回写；82 件逐件终态零 in_progress；十一维第八列复评；长任务自证包；post-h9 契约 186/186、reconcile 0 issues。closeout:full 三连 exit 1 两红 W 归属如实登记，§8 第 3/5 条未达证据上限，不冒充全绿/verified。证据=`acceptance/m-blueprint-2026-11-11/m7/`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-11 | M-PROGRAM / DONE-PARTIAL |
## 广播规则

- 🔴：阻塞当前验收，主 Agent 必须优先处理。
- 🟢：已有独立提交且可安全合并，主 Agent 必须先核对。
- 🟡：建议或待评估，不阻塞当前工作。
- 🔵：当前唯一进行中阶段。
- ✅ 完成事项只在“最近处理记录”保留一个紧凑条目；详细证据进入 canonical 计划、Acceptance 或归档。
- 不在本文件保存凭据、用户数据、绝对结果路径或隐藏推理过程。

- **滚动精简（自动化 v2 · BLOCK-170 用户裁决「需要有个更稳定且优秀的设计 靠手动来优化 AUDIT-LOG 是不合理的」；v1 基座 2026-09-20「仅保留必要的内容」）**：`npm run audit:compact` 幂等全量自稳——「最后更新」链只留最近 8 条（淘汰行原文入 `archive/checkpoints/audit-log-through-<日期>.md`）+ 处理记录表只留最新 10 条（淘汰行入 `audit-log-compact-<运行日>.md`）+「当前待处理项」与广播规则全量保留；**搬移不改写**（台账原文永不被工具截断/改写，超长行的收敛责任在写入方，docs:check 出建议级提示）。接线=`closeout` 首步自动执行，无需记得手动跑；`docs:check` 对本台 >50KB 出建议级提示、>120KB（单读工具安全阈）硬红（AUDIT_LOG_OVERSIZE）。归档剪行后必须跑 `npm run docs:check`：凡 registry `entrypoint` 指向本台的 canonical 文档，其直链必须常驻头部「入口直链」行，不得只随旧记录进归档。
- **行写入纪律**：处理记录每行 ≤ 3 行（约 600 字符）：一句话结论 + 用户裁决原话/关键数字 + canonical 文档指针；阶段切片与长篇证据进工作包 plan/closeout 文档；「最后更新」行只描述最近一次更新，旧累积随归档走，不在行尾追加历史条目。

