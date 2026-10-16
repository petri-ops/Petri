---
capability: observability
goal: BLOCK-186 = 本地漏斗事件台账批——TTFS 产品化程序（评估报告 §5.1 阶段 1 ②）第二批。把「遥测端点化」按 G0 纪律落地为**本地漏斗事件台账**（SQLite 表，仿 decision_log 先例，本机常开零外发），让 TTFS（首次成功时间）可度量，为 ③onboarding 提供自动化验收基线。用户授权「可以自动进行的那种…我不希望人参与」（2026-10-16，自主推进 + 验收全自动化）。
acceptance:
  - P1 本地台账：新增迁移 014_funnel_events.sql（表 funnel_events：at/event/user_id）+ 共享白名单 core/packages/shared-telemetry/funnel-events.js（R3/R5 唯一合法跨进程共享层，src/telemetry-funnel.js re-export 单源）+ core 单一写入器 helpers/funnel-log.js best-effort（仿 decision-log.js：永不 throw、独立于远程 telemetry_enabled 开关、本机常开）+ 契约单测
  - P2 业务点接线：4 个 core 进程 G0 事件经单一 core 写入器落本地台账——app_started（server.listen 就绪钩子）/project_created（api-data POST /api/data/projects）/first_job_succeeded（agent-task-store markAgentTaskDone）/report_generated（final-report materializeFinalReport）；runtime_install（纯桌面进程事件、无 core 触发点、非 TTFS 所需）G0 诚实 defer，update_succeeded 属 packaged 自动更新=G1+ 面诚实标 N-A 不硬接
  - P3 TTFS 查询：只读端点/CLI 计算 first_job_succeeded.ts − app_started.ts（按 user/session 口径），供 ③onboarding 验收度量
  - 门禁：docs:check/ui:audit:check（若非纯后端则免）/tsc/test:changed 全绿 + 漏斗台账契约单测 + TTFS 计算单测 + 自动化实机（跑真实任务链断言 funnel_events 行落库 + TTFS 可算，acceptance/block-186/，无人眼）
  - 完成语义：6 事件中 G0 可触发者全部本地落账；TTFS 可从台账算出；零远程外发（端点占位维持 G1+ 不动）
reopen: 远程遥测端点（G1+）显式裁决后方可接 reportEvent 网络面
status: active
---

# BLOCK-186 — 本地漏斗事件台账批（TTFS 程序 ② 第二批）

- 状态：`active`（2026-10-16 用户授权自主推进 + 验收全自动化，「我不希望人参与」）
- 用户裁决原话：「你给个推荐 可以自动进行的那种 哪怕是真窗口验证 最好也是自动进行 我不希望人参与」
- **G0 定性变更（关键，非可选）**：评估报告 ② 字面「遥测端点化」隐含远程上报端点；但远程遥测端点属 **G1+**（AGENTS.md §当前阶段纪律明令 G0 禁止主代理主动启动 Provider/远程发布/GA）。故本包按 G0 唯一合法形态落地=**本地漏斗事件台账**（本机 SQLite，零外发），既满足「TTFS 可度量」目标，又贴 Petri「本地可审计」魂，且验收 100% 自动化。

## 1. 立项自检（产品个性纪律问句）

「本地可审计 / 证据自证体现了吗？」——本地台账是 Petri 区别于云端遥测（Codex/ZCode 遥测回厂商）的核心形态优势：漏斗事件全落用户本机 SQLite，断网可用、无厂商中继、用户可查可删；TTFS 从本地台账算出，不依赖任何接收服务。这正是「魂②本地主权 + ③证据自证」的落地。

## 2. 范围（P0 勘察定位，2026-10-16）

| 事件 | 接线点 | G0 可触发 |
| --- | --- | --- |
| app_started | `core/petri-server/server.js` app.listen 钩子旁挂 `recordFunnelEvent('app_started')` | ✅ |
| project_created | `core/petri-server/api-data.js` `POST /api/data/projects` 成功处 | ✅ |
| first_job_succeeded | `core/petri-server/agent-task-store.js` `markAgentTaskDone`（每次成功记一行，computeTTFS 取最早） | ✅（TTFS 关键） |
| report_generated | `core/petri-server/helpers/final-report.js` `materializeFinalReport` 成功处 | ✅ |
| runtime_install | 运行时/包安装在**桌面进程**（`src/pack-lifecycle.js` 等），后端无触发点 | ❌ G0 诚实 defer（见 §3.5） |
| update_succeeded | packaged 自动更新（G1+） | ❌ 诚实标 N-A |

## 3.5 架构裁决（P1 实施期定稿，非可选）

dependency-cruiser R3（core 禁 import src）+ R5（src 禁 import core/petri-server）与本包两条硬约束，逼出以下裁决（偏离原 §2 字面接线点，理由留痕）：

1. **共享白名单落 `core/packages/shared-telemetry/funnel-events.js`**：漏斗事件清单被 Electron 主进程与后端进程共用，两侧互 import 被 R3/R5 禁；`core/packages/**` 是 R4 注释确认的「前后端共享层」，是唯一合法落点。`src/telemetry-funnel.js` 改为对该模块的**转发 re-export**（保持 `src/telemetry.js` 的 `require('./telemetry-funnel')` 入口不变），杜绝第二份清单。单测实证：两路径 `FUNNEL_EVENTS` 为同一数组引用。
2. **`app_started` 由后端 `server.listen` 钩子记录，而非原 `src/main.js:498`**：R5 禁 src 直接调用 core 写入器；而 `src/main.js:498` 早于 `setupDesktopEnv`（PETRI_DB_PATH 尚未设）与 migration（funnel_events 表尚未建），在旁挂本地写会 best-effort 静默丢行。后端 `app.listen` 是「本机就绪即 app_started」的合法单进程锚点——**全台账收敛为 core 一个写入器**（零 src 写入器、无第二份 INSERT、无启动时序 bug），且使 P4 实机可纯后端跑（无人眼、无需 Electron）。
3. **G0 实接事件 4 个（app_started/project_created/first_job_succeeded/report_generated），非原拟 5 个**：`runtime_install` 是纯桌面进程事件、无 core 触发点，且非 TTFS 所需；为它加 src 写入器=引入第二写入路径（违背裁决 2 的单写入器收敛）。诚实 defer 至「桌面进程漏斗台账写路径」这一独立小决策日后显式立项，不硬接、不造假。

## 3. 非范围（红线）

- **不建远程遥测端点**（G1+）：`TELEMETRY_ENDPOINT` 占位维持不动，reportEvent 网络面不接；本包只做本地台账。
- **不动隐私门控语义**：远程错误遥测（reportError，默认关）零改动；本地台账是「本机记录」非「外发」，无隐私外泄面。
- **不引第二度量真相**：TTFS 从 funnel_events 算，不另建计数系统；app_started/first_job_succeeded 时间戳即真值。
- **update_succeeded 不硬接**：G0 dev 无自动更新触发点，强接=造假数据，诚实 N-A。
- **G1+ 不外推**：不碰 packaged/Provider/GA/签名。

## 4. 执行方案

- **P0 勘察**：已完成（遥测现状 + markDone 接线点 + 迁移序列 013→014）。
- **P1 本地台账**：`src/migrations/014_funnel_events.sql` + `core/petri-server/helpers/funnel-log.js`（best-effort 永不 throw，仿 decision-log.js）+ 契约单测（写入/白名单/失败静默/独立于 telemetry_enabled）。
- **P2 接线**：4 个 core 进程 G0 事件经单一 core 写入器 `recordFunnelEvent(name)` 在业务成功点旁挂（裁决 §3.5.2）；红绿先行由 P4 实机承载（未接线则 funnel_events 无行→探针红）。`runtime_install` G0 defer、`update_succeeded` G1+ N-A。
- **P3 TTFS 查询**：`computeTTFS()`（exported 于 funnel-log）为查询原语，另交付只读 CLI `scripts/block186-ttfs.mjs`（`--db=<petri.db>` 读本机台账打印 TTFS + 最近事件，复用原语不重实现 SQL，服务「本地可审计」）。单测覆盖正常/无首成功→null/无 app_started→全 null。
- **P4 自动化实机**：脚本跑真实链（建项目→跑 job 至成功）→ 断言 funnel_events 落 `project_created`+`first_job_succeeded` 行 + TTFS 可算，acceptance/block-186/。**无人眼**。
- **P5 收口**：closeout 全链 + 五件套回写。

## 5. 回退路径与并行隔离

- 回退：本地台账写入失败=静默不阻塞业务（best-effort）；TTFS 算不出=诚实返回 null 不编造。
- 并行隔离：触碰面=`src/migrations/014_*` + `helpers/funnel-log.js` + `agent-task-store.js`（markDone 旁挂）+ data/projects 路由 + 运行时/报告成功点 + `src/main.js:498` 旁 + 新测试；当前无其他 active 包。
- 环境纪律：迁移 + 后端改动 → 实机走隔离后端（PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 临时目录，仿 block179/180 探针姿势），不污染 dev 库。
