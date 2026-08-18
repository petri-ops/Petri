# BLOCK-10-ARCHITECTURE PHASE 0 — Architecture Survey

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑 docs:check）
> **基线 plan**：`docs/block-10-architecture-plan.md` v0.1（active 工作包）
> **基线 audit 报告**：5 份 2026-08-17 Agent Harness 独立审计（`architecture` / `performance-resource` / `error-handling` / `rserver-http-contract` / `security`）
> **基线 closeout**：`docs/block-10-audit-closeout.md` §10.3 BLOCK-10-ARCHITECTURE 候选清单 + `docs/code-audit-closeout-plan.md` v0.2 active

---

## §1 19 项修复单元详细清单

> **格式**：每项 1 段（报告 / 行 / 标题 / 核心代码位置 / 修复方向 / 当前状态 / 本工作包归属）。
> **数量声明**：本工作包严格按 BLOCK-10 §10.3 BLOCK-10-ARCHITECTURE 候选清单列出 **19 项**（10 A-* + 5 lifecycle/DB + 4 rserver-http）。用户原 prompt 提到"13 项不外推"对应 BLOCK-10 §5.2 G0 不外推表（13 项 deferred），二者不矛盾：13 项是 G0 阶段**总不外推**，19 项是 BLOCK-10-ARCHITECTURE 候选清单**总范围**。
> **当前状态分类**：
> - ✅ **PHASE X**（本工作包主范围，本 PHASE 落地）
> - ⚠️ **关联不启动**（本工作包仅在 PHASE 4 closeout 报告登记为下一候选工作包，不实际修改代码）
> - 🚫 **不外推 G1+**（G1+ 阶段事项）

### §1.1 A-001 — `agent-runner.js` 1799 行 20 顶层 require 聚宝盆 · ✅ PHASE 3

- **报告 / 行**：arch §四 L154-178
- **标题**：agent-runner.js 承担 4 个正交角色（Loop 状态机 / LLM 调用编排 / Conversation 同步 / Event 持久化），20 顶层 require 跨域耦合
- **核心代码位置**：`core/r-server/agent-runner.js:1-100`（system-prompt / llm-client / plans / conversations / memory-vectors / runtime / loop-contract / loop-controller / loop-checkpoint 等 20 个 require）
- **关联 ID**：—
- **修复方向**：抽 `LoopOrchestrator`（纯状态机 + 事件总线，对应 `_loop*` 函数族）+ `ConversationAdapter`（message append / topic shift / auto title 隔离在 adapters 下）；`agent-runner.js` 保留 `runAgentLoop` 主入口，单文件 < 600 行；拆完后 `loop-controller` 独立 require 0 个 agent-runner 内部函数
- **当前状态**：✅ **PHASE 3**（主范围，agent-runner 拆分 1 commit）
- **风险**：🔴 高（BLOCK-9 同级风险；agent loop 状态机 0 变化硬约束）

### §1.2 A-002 — `routes/result-studio.js` 1800 行 26+ 端点 · ✅ PHASE 2

- **报告 / 行**：arch §四 L180-200
- **标题**：routes/result-studio.js 1800 行 26+ HTTP 端点单文件；路由注册顺序与 import 顺序耦合；新增 endpoint 习惯性 append 到末尾
- **核心代码位置**：`core/r-server/routes/result-studio.js:1-1800`（26+ app.get/app.post 端点：repository-binding / interaction / selection / context-envelope / changesets / revisions / workspace / storage / preview-budget 等）
- **关联 ID**：C-002-rserver（不同维度，不联动修）
- **修复方向**：拆 `routes/result-studio/` 目录，按 sub-domain 分文件（`repository.js` / `interaction.js` / `selection.js` / `context.js` / `changesets.js` / `revisions.js` / `storage.js` / `workspace.js` / `preview-budget.js` 共 9 个子域文件）；顶层 `result-studio/index.js` 做注册中心，只汇总子模块的 `register(app, options)` 函数；与 `routes/index.js` 的现有"4-5 个 category route file"模式保持一致
- **当前状态**：✅ **PHASE 2**（主范围，r-server 大文件拆分 1-2 commit）
- **风险**：🔴 高（http 契约 100% 不变硬约束；端点 channel 名 / payload shape 100% 一致）

### §1.3 A-003 — `shared-backend/agent-workflow.js` 跨层反向 require · ✅ PHASE 3

- **报告 / 行**：arch §四 L202-227
- **标题**：shared-backend 顶部 try/catch 软依赖 `r-server/helpers/harness-workflow-state`，违反"shared-backend 不反向依赖 r-server/py-server"分层原则；non-r-server 上下文静默 fail → 调用方拿到残缺 `enriched` 但无信号；与 G0 fail-closed 冲突
- **核心代码位置**：`core/shared-backend/agent-workflow.js:4-10`（`try { _harness = require('../r-server/helpers/harness-workflow-state'); } catch { ... }`）
- **关联 ID**：—
- **修复方向**：在 `shared-backend/index.js` 暴露 `configure({ projectHarnessWorkflowJob })` 注入点（参照 `ai-usage-helper.js` / `config-helper.js` 模式）；r-server `bootstrap.js` 启动时 `require('shared-backend').configure({ projectHarnessWorkflowJob: harnessWorkflowState.projectHarnessWorkflowJob })`；`agent-workflow.js` 内 `let _projectHarnessWorkflowJob = (job) => null;` 默认值；调用点改为 `if (_projectHarnessWorkflowJob) enriched.harnessState = _projectHarnessWorkflowJob(job);`；移除 try/catch 包裹的 require，shared-backend 自洽属性恢复
- **当前状态**：✅ **PHASE 3**（主范围，跨层反向修复 1 commit 与 A-008 合并）
- **风险**：🟠 中（破坏既有调用链；agent-workflow.js 顶部 try/catch 是已存在的"安全网"）

### §1.4 A-004 — 173 console.* vs 59 structured logger · ⚠️ 关联不启动

- **报告 / 行**：arch §四 L229-253
- **标题**：r-server 顶层 50% 文件仍然 `console.*`，JSON 格式崩解；rid 链路无法贯穿 stdout/stderr；与 `core/shared-backend/error-log.js` 的 SQLite 错误表无法 join
- **核心代码位置**：`core/r-server/mcp/registry.js`（28 处）/ `core/r-server/helpers/tools-executor.js`（32 处）/ `core/r-server/server.js`（17 处）/ `src/main/backend-proc-manager.js`（33 处）/ `core/gateway/server.js`（14 处）/ `src/main.js`（28 处）
- **关联 ID**：—
- **修复方向**：当前 G0 阶段不建议引入跨进程日志总线；先把 `console.*` 收敛到文件顶部 `const { logger } = require('../shared-backend/logger');`；`[ToolExecutor] xxx` prefix → `logger.info('tool_done', { scriptPath })`；优先级：先做 `core/r-server/server.js` / `tools-executor.js` / `mcp/registry.js` 三处即可解大半 console
- **当前状态**：⚠️ **关联不启动**（observability-work-package 候选）
- **风险**：🟠 中（不引入 prom-client / opentelemetry；当前 G0 阶段不做跨进程日志总线）

### §1.5 A-005 — `routes/harness.js` 1366 + `routes/ai-agent.js` 1222 · ✅ PHASE 2

- **报告 / 行**：arch §四 L255-265
- **标题**：同 A-002 模式，但职责更复杂；14 个路由文件总行数 6583，3 个文件占 67%
- **核心代码位置**：`core/r-server/routes/harness.js:1-1366` + `core/r-server/routes/ai-agent.js:1-1222`（SSE + Loop + Tool Call + Conversation）
- **关联 ID**：—
- **修复方向**：`harness.js` 拆 `harness-workflow.js` + `harness-context.js` + `harness-repair.js`（3 个子文件）；`ai-agent.js` 拆 `ai-chat.js` + `ai-loop.js` + `ai-context.js` + `ai-tools.js`（4 个子文件，与现有 `routes/ai-chat.js` 实际未充分使用对齐）；顶层 `routes/harness/index.js` + `routes/ai-agent/index.js` 注册中心
- **当前状态**：✅ **PHASE 2**（主范围，r-server 大文件拆分 1 commit 与 A-002 合并）
- **风险**：🔴 高（同 A-002；ai-agent.js 集成 SSE + Loop + Tool Call + Conversation 更复杂）

### §1.6 A-006 — 56+ module-level mutable singleton · ⚠️ PHASE 3 部分

- **报告 / 行**：arch §四 L267-300
- **标题**：56+ `_xxx` mutable at module top（40 处 r-server + 16 处 shared-backend + 6 处 src）；生命周期 = Node 进程生命周期，无法被 test 隔离 / 重置；`_impliedPageByRequest` / `_pendingActAcks` 没有 TTL clear 机制
- **核心代码位置**：`core/r-server/agent-tools/act-tools.js:146` (`_impliedPageByRequest`) / `:193` (`_pendingActAcks`) / `core/r-server/mcp/registry.js:30` (`_branchDb`) / `core/r-server/helpers/runtime.js:24-95` (`_aiActiveStreams` / `_aiUserStreams` / `_aiTaskStreams` / `_embedCallLog`) 等 56+ 处
- **关联 ID**：—
- **修复方向**：把 Map/Set 收敛到 `_state.js` 模块，每个 test 在 setup/teardown 时显式 `reset()`；加 TTL：`_pendingActAcks` 等应配 `setTimeout` 主动清理；至少有 5 处应该用现有 SQLite `tool_jobs` 表替代纯内存 Map（act-ack / embed log / ai user stream 状态），让 restart 后恢复；测试规范：新增 `_xxx State` 时必须在 `test/utils/state-reset.mjs` 里登记
- **当前状态**：⚠️ **PHASE 3 部分**（主范围仅 ≥5 处迁 SQLite；剩余保留为 minor；完整收敛推迟到 observability-work-package）
- **风险**：🟠 中（56+ 整体收敛工作量大；当前仅 ≥5 处迁 SQLite 保留既有 fallback）

### §1.7 A-007 — DB singleton 重复：branch-db + result-db 30 行基础设施 100% 重复 · ✅ PHASE 1

- **报告 / 行**：arch §四 L302-327
- **标题**：branch-db.js 与 result-db.js L31-49 / L36-54 逐字重复 singleton 包装；同时打开同 db 文件；better-sqlite3 WAL 模式可容忍多读但写者锁竞争加剧；违反"r-server 进程内 SQLite 唯一入口"原则
- **核心代码位置**：`src/database/branch-db.js:31-49` ↔ `src/database/result-db.js:36-54`
- **关联 ID**：PR-012（desktop main 同时打开 biof3.db 同根）+ E-019 full（busy_timeout 跨 connection 不一致同根）
- **修复方向**：抽 `src/database/_db-singleton.js`：`const _cache = new Map(); function getDatabase(dbName='biof3.db') { ... } function closeDatabase(dbName='biof3.db') { ... } function _resetAllForTests() { ... }`；`branch-db.js` / `result-db.js` 改为 `const { getDatabase, closeDatabase } = require('./_db-singleton')`；测试时统一 `_resetAllForTests()`；r-server 进程与 electron main 进程是不同进程，从架构上需要分开（不重写 core/r-server/db.js），但代码层应共享 `getDatabase` 函数
- **当前状态**：✅ **PHASE 1**（主范围，DB 体系化 1 commit 与 PR-012 + E-019 full 同根）
- **风险**：🟠 中（进程边界不破坏；仅代码层共享；既有 chf0-critical IPC contract 不退化）

### §1.8 A-008 — 4 处真 require 循环 · ✅ PHASE 3（仅 act-tools ↔ plan-ui-tools）

- **报告 / 行**：arch §四 L329-336
- **标题**：C-1 `act-tools.js` ↔ `plan-ui-tools.js` 真循环（顶层 require）；plan-ui-tools.js 顶层 require act-tools；plan-ui-tools.js 注释"a top-level destructure would capture partial CommonJS exports"作者已知；C-3 `permissions.js` ↔ `guest-permissions.js` 真循环（顶层 require）；C-2 `tool-defs.js → registry.js` 单向 lazy require 已合规
- **核心代码位置**：`core/r-server/agent-tools/{act-tools.js,plan-ui-tools.js}` / `core/r-server/helpers/{permissions.js,guest-permissions.js}`
- **关联 ID**：—
- **修复方向**：C-1 优先级最高：拆分 `act-tool-core.js`（基础工具）+ `act-tool-ui.js`（UI 依赖 plan-ui-tools）单向依赖；C-3 次之：把 `MODULE_KEYS / _DEFAULT_PERMS / normalizePermissionsForStore` 移到 `permissions-core.js`，两边只单向依赖 core；C-2 已合规 lazy 不动
- **当前状态**：✅ **PHASE 3**（主范围仅拆 act-tools ↔ plan-ui-tools 循环；permissions 循环保留为 minor）
- **风险**：🟠 中（plan-ui-tools.js 顶层 require act-tools 是作者已知 partial-export 雷区；拆解要保留既有 lazy plan-ui-tools 解构工作模式）

### §1.9 A-009 — `R_SERVER_PORT` 默认值不一致 · ✅ PHASE 1

- **报告 / 行**：arch §四 L338-354
- **标题**：`server.js` 默认 3003 / `config.js` 默认 3003 / `preload.js` 默认 3001 / `backend-health.js` 默认 3001 / `.env.example` 3001；dev 模式手动启动 r-server 不带 env 时 fallback 在 3003 / 3001 之间漂移
- **核心代码位置**：`core/r-server/server.js:130` + `core/r-server/config.js:23` + `core/r-server/.env.example:27` + `src/preload.js:67` + `src/backend-health.js:13` + `src/main/env-coordinator.js`（主进程注入）
- **关联 ID**：—
- **修复方向**：把 fallback 值统一到 `src/main/env-coordinator.js` 的 `backendPorts.r` 默认（3003 或 3001 选一）；其他文件 fallback 全部删掉，强制要求 env 注入；加 dev-mode 自检脚本：启动 r-server 前对比 `getBackendPorts().r === process.env.R_SERVER_PORT`，否则 warn 一次
- **当前状态**：✅ **PHASE 1**（主范围，端口 + Dead dep 快赢 1 commit 与 A-010 合并）
- **风险**：🟢 低（additive；不影响运行时；既有 chf0-critical IPC contract 不退化）

### §1.10 A-010 — Dead deps（jspdf）+ 214 处隐式 env · ✅ PHASE 1（仅 jspdf + 6 处 env）

- **报告 / 行**：arch §四 L356-372
- **标题**：`frontend/package.json` `jspdf@^4.2.1` dead dep（前端零 import）；214 处 `process.env.*` 读取未通过单一 `config` 模块集中管理；9 处 `BIOF3_*` / `R_SERVER_PORT` / `PY_SERVER_PORT` 等
- **核心代码位置**：`frontend/package.json` + `core/r-server/cache-manager.js`（8 处 env 读）/ `core/r-server/server.js`（6 处）/ `core/r-server/db.js`（2 处 `BIOF3_DB_PATH` / `BIOF3_LOCAL_DATA_DIR`）/ `core/r-server/helpers/system-prompt.js`（1 处）/ `src/main/env-coordinator.js`（14+ 处 env 写）
- **关联 ID**：—
- **修复方向**：移除 `frontend/jspdf`（dead dep）；在 `core/shared-backend/config-helper.js` 当前 DI 模式上扩展：把所有 env 读取都走 `getConfig()`；启动顺序文档化：`r-server` 启动前必跑 `shared-backend.configure({ getConfig })`；移除 `process.env.*` direct read 在 helper / business 层的位置
- **当前状态**：✅ **PHASE 1**（主范围，端口 + Dead dep 快赢 1 commit 与 A-009 合并；仅移除 jspdf + 6 处 process.env.* 集中）
- **风险**：🟢 低（214 处全部集中工作量超出本工作包；当前仅 6 处核心路径 env 集中）

### §1.11 A-011 — type safety 与 schema drift · ⚠️ 关联不启动

- **报告 / 行**：arch §四 L374-386
- **标题**：部分 IPC handler 用 `any`，前端 `desktopBridge.ts` 强类型 + 后端 loose 的不对称；`core/r-server/agent-tools/tool-defs.js` 的 tool schema 与 `loop-contract.js` 的 Loop 字段命名约定偶有 drift；`result-studio` 系列契约 `RESULT_STUDIO_*` 常量命名空间 ≥ 5 个
- **核心代码位置**：全栈 IPC / Agent Tool 定义
- **关联 ID**：—
- **修复方向**：给 IPC payload 引入 `zod` 风格或 JSON-schema 单一来源；`core/shared-backend/result-studio-contracts.js` 已存在，应进一步扩展为整个 result-studio 命名单一来源；`core/shared-backend/loop-contract.js` 是同模式可参考
- **当前状态**：⚠️ **关联不启动**（type-drift-pack 候选；G0 阶段渐进修正）
- **风险**：🟢 低（不引入 zod / ajv；当前 G0 阶段不引入新依赖）

### §1.12 A-012 — test fixture / golden 数据维护风险 · ⚠️ 关联不启动

- **报告 / 行**：arch §四 L388-400
- **标题**：`test/fixtures/` 5 个子目录（golden-path / g0-second-wave / harness-scientific-task / sdc / sdc1-a）含 golden Path binary-style 数据；缺 fixture version 元数据；194 个 `.test.mjs` 文件，每个文件都在引用 `test/fixtures/` 不同子集，缺乏 ` `index.json` 索引
- **核心代码位置**：`test/fixtures/{golden-path,g0-second-wave,harness-scientific-task,sdc,sdc1-a}/`
- **关联 ID**：—
- **修复方向**：给 `test/fixtures/` 加 `manifest.json` 记录每 fixture 的 schema 版本；Acceptance 脚本（g0-* / harness-* / p*-acceptance.mjs）输出证据 json 应改写到 `acceptance/` 而非 fixture 内散落；阶段性（每 4 个 phase）跑 fixture-drift 检测
- **当前状态**：⚠️ **关联不启动**（fixture-manifest-pack 候选）
- **风险**：🟢 低（低优先级；当前 G0 阶段 fixture 数据未老化）

### §1.13 E-017 main — Backend procs exit handler 不推送 IPC status 事件 · ⚠️ 关联不启动

- **报告 / 行**：error §三 L477-494
- **标题**：Backend procs exit handler 不推送 IPC status 事件；BLOCK-9.1 已拆出 4 个 proc exit handler 但未推送 IPC 事件
- **核心代码位置**：`src/main/backend-proc-manager.js`（BLOCK-9.1 已拆出 / 4 个 proc exit handler）
- **关联 ID**：PR-006 同根 / OB-005 关联
- **修复方向**：抽 `safeProcExit(name, code)` helper，调 `webContents.send('backend:status', {name, status: 'down', code, reason})` + `logError` + `metrics.inc('backend.exit')`
- **当前状态**：⚠️ **关联不启动**（observability-work-package 候选；BLOCK-10 PHASE 2 commit `a09f706` 已 partial 落地 r-server 进程级 `installBackendExitLifecycle`；主进程侧 IPC 推送推迟到 observability 候选）
- **风险**：🟠 中（BLOCK-9.1 已收口 backend-proc-manager.js，本工作包不动）

### §1.14 E-018 — rServerSupervisor 自动重启无 IPC 通知 · ⚠️ 关联不启动

- **报告 / 行**：error §三 L496-506
- **标题**：rServerSupervisor 自动重启时无 IPC 通知，且 DB/HTTP 句柄未刷新
- **核心代码位置**：`src/main/backend-proc-manager.js`（rServerSupervisor 段 `scheduleRestart`）/ `src/owned-backend-supervisor.js`
- **关联 ID**：PR-005 关联
- **修复方向**：在 `scheduleRestart()` emit `backend:status {status: 'restarting'}` + `metrics.inc('backend.restart')`
- **当前状态**：⚠️ **关联不启动**（observability-work-package 候选）
- **风险**：🟠 中（BLOCK-9.1 已收口；r-server 进程级 lifecycle 已落地 `db.close()`；IPC 通知链路 + metrics 推迟到 observability 候选）

### §1.15 E-019 full — SQLite 双 connection busy_timeout 全量不一致 · ✅ PHASE 1

- **报告 / 行**：error §三 L508-529
- **标题**：r-server 内 SQLite 双 connection busy_timeout 不一致（agent-task-store.js 177-179 vs db.js 18-32）；BLOCK-10 PHASE 2 commit `a09f706` 已 partial 落地 r-server 单进程 `core/shared-backend/config-helper.js`，但 agent-task-store / branch-db / result-db 各自保留
- **核心代码位置**：`core/r-server/agent-task-store.js:177-179` + `core/r-server/db.js:18-32` + `core/shared-backend/config-helper.js`（已有 partial）+ `src/database/{branch,result}-db.js`（未统一）
- **关联 ID**：PR-011 关联 / A-007 同根（DB singleton 重复）
- **修复方向**：扩 `core/shared-backend/config-helper.js` 暴露 `BUSY_TIMEOUT_MS = 10000` 常量；agent-task-store / branch-db / result-db 三处改用 `getConfig().busyTimeout`；既有 r-server `db.js` 沿用
- **当前状态**：✅ **PHASE 1**（主范围，DB 体系化 1 commit 与 A-007 + PR-012 同根）
- **风险**：🟠 中（写入者竞争 + restart 恢复时间；既有 `agent_task_events` 表写入者不与新表冲突）

### §1.16 PR-006 — 4 个 backend 子进程 exit handler 仅 console.log · ⚠️ 关联不启动

- **报告 / 行**：perf §四 L269-291
- **标题**：4 个 backend 子进程 exit handler 仅 console.log + null；IPC 推送缺 → restart 不可观测
- **核心代码位置**：`src/main/backend-proc-manager.js`（4 proc.on('exit')）
- **关联 ID**：E-017 同根 / OB-005 关联
- **修复方向**：与 E-017 main 合并修复
- **当前状态**：⚠️ **关联不启动**（observability-work-package 候选）
- **风险**：🟠 中（observability 缺口）

### §1.17 PR-012 — branch-db + result-db 同时打开 biof3.db · ✅ PHASE 1

- **报告 / 行**：perf §四 L488-521
- **标题**：desktop main 进程 branch-db + result-db 同时打开 biof3.db（与 r-server 进程共享文件）；WAL 锁竞争
- **核心代码位置**：`src/database/branch-db.js:18-49` / `src/database/result-db.js:23-54`
- **关联 ID**：A-007 同根 / PR-011 关联
- **修复方向**：与 A-007 合并修复（抽 `_db-singleton.js` 统一 DB 访问入口）
- **当前状态**：✅ **PHASE 1**（主范围，DB 体系化 1 commit 与 A-007 + E-019 full 同根）
- **风险**：🟢 低（进程边界不破坏；仅代码层共享）

### §1.18 C-001-rserver — `/api/run` 与 `/api/replot/run` 双重拦截 · ⚠️ 关联不启动

- **报告 / 行**：rserver-http §五 L456-462
- **标题**：`/api/run` 与 `/api/replot/run` 双重拦截，错误体被 moduleGate 抢答
- **核心代码位置**：`core/r-server/routes/r-compute.js:48,65` + `core/r-server/bootstrap.js:62`（moduleGate 顺序错位）
- **关联 ID**：—
- **修复方向**：r-compute.js 这 2 个端点 410 在 moduleGate 前 early-return 或 bootstrap.js moduleGate 对此两路径豁免
- **当前状态**：⚠️ **关联不启动**（rserver-http-debt-pack 候选；与 frontend grep 清理 M-002 同根）
- **风险**：🟢 低（与 A-002 拆 routes/result-studio.js 不联动；本工作包 PHASE 2 仅修 A-002 + A-005）

### §1.19 C-002-rserver — /api/result-studio/interaction 在 Revision 不匹配返回 HTTP 200 + {error} · ⚠️ 关联不启动

- **报告 / 行**：rserver-http §五 L464-472
- **标题**：interaction 端点 Revision 不匹配时返回 HTTP 200 + {error}，应改为 4xx 错误码
- **核心代码位置**：`core/r-server/routes/result-studio.js`
- **关联 ID**：—（注意：与 BLOCK-10-AUDIT-CLOSEOUT §2.1 C-002 不同维度，contract C-002 是 IPC 类型校验，已落地）
- **修复方向**：改 `res.status(409)` 而非 HTTP 200
- **当前状态**：⚠️ **关联不启动**（rserver-http-debt-pack 候选；与 A-002 同文件但不联动修）
- **风险**：🟢 低（与 A-002 拆 routes/result-studio.js 不联动）

### §1.20 M-001 — /api/ai/admin/* 9 端点鉴权后置 · ⚠️ 关联不启动

- **报告 / 行**：rserver-http §六 L474-480
- **标题**：9 端点鉴权后置，越权访问风险
- **核心代码位置**：`core/r-server/routes/ai-admin.js:25`
- **关联 ID**：—
- **修复方向**：在 admin endpoint 入口加 sender 守门 + role check
- **当前状态**：⚠️ **关联不启动**（rserver-http-debt-pack 候选）
- **风险**：🟠 中（rserver-http 鉴权缺口）

### §1.21 M-003 — /api/feedback 公开端点缺 origin check · ⚠️ 关联不启动

- **报告 / 行**：rserver-http §六 L490-496
- **标题**：feedback 公开端点缺 origin check，CSRF 风险
- **核心代码位置**：`core/r-server/routes/feedback.js:73`
- **关联 ID**：—
- **修复方向**：加 origin / referer check + CSRF token
- **当前状态**：⚠️ **关联不启动**（rserver-http-debt-pack 候选）
- **风险**：🟠 中（rserver-http 鉴权缺口）

---

## §2 同根组合（与 BLOCK-10 partial fix 重叠）

### §2.1 已合并组（与 BLOCK-10 PHASE 1+2 partial 落地重叠）

| 同根组 | 涉及 ID | BLOCK-10 已有 partial 落地 | 本工作包扩展 |
|--------|---------|--------------------------|-------------|
| **DB singleton 统一 + busy_timeout 全量** | A-007 + PR-012 + E-019 full | BLOCK-10 PHASE 2 commit `a09f706` 落地 r-server 单进程 `core/shared-backend/config-helper.js` 91 行（仅 r-server db.js 使用） | ✅ PHASE 1.1 扩到 agent-task-store / branch-db / result-db 三处 |
| **backend exit handler** | E-017 main + PR-006 + OB-005 partial | BLOCK-10 PHASE 2 commit `a09f706` 落地 r-server 进程级 `installBackendExitLifecycle` + `db.close()`（`core/r-server/server.js`） | ⚠️ 主进程侧 IPC 推送缺 → observability-work-package 候选，本工作包**不启动** |
| **health endpoint** | OB-005 partial + OB-004 | BLOCK-10 PHASE 2 commit `1fedf9c` 落地 `src/mcp-server.js` 6 行 health endpoint + error_log 路径 | ⚠️ full liveness/readiness/health 三层分离推迟到 observability 候选 |

### §2.2 不合并组（本工作包独立处理）

| 同根组 | 涉及 ID | 不合并原因 | 后续处理 |
|--------|---------|------------|----------|
| **r-server 大文件拆分** | A-002 + A-005 | 与 BLOCK-10-AUDIT-CLOSEOUT 已落地的 route 文件无重叠（BLOCK-10 收口 P1 安全不涉及大文件拆分） | ✅ 本工作包 PHASE 2 独立处理 |
| **agent-runner 拆分** | A-001 | BLOCK-10-AUDIT-CLOSEOUT 未涉及 agent-runner.js | ✅ 本工作包 PHASE 3 独立处理 |
| **跨层反向 require** | A-003 | BLOCK-10-AUDIT-CLOSEOUT 未涉及 shared-backend 跨层 | ✅ 本工作包 PHASE 3 独立处理 |
| **require 循环** | A-008 | BLOCK-10-AUDIT-CLOSEOUT 未涉及循环解环 | ✅ 本工作包 PHASE 3 独立处理 |
| **端口 + Dead dep 快赢** | A-009 + A-010 | BLOCK-10-AUDIT-CLOSEOUT 未涉及 env-coordinator.js / jspdf | ✅ 本工作包 PHASE 1 独立处理 |
| **singleton 收敛** | A-006 部分 | BLOCK-10-AUDIT-CLOSEOUT 仅涉及 r-server 子进程 lifecycle | ✅ 本工作包 PHASE 3 部分处理（≥5 处迁 SQLite） |
| **rserver-http 端点** | C-001-rserver + C-002-rserver + M-001 + M-003 | BLOCK-10-AUDIT-CLOSEOUT 仅 C-002 contract（IPC 类型校验）；rserver-http 端点不在 BLOCK-10 范围 | ⚠️ rserver-http-debt-pack 候选 |

### §2.3 BLOCK-10 partial 落地 vs 本工作包扩展明细

| BLOCK-10 commit | 涉及 ID | 已落地内容 | 本工作包 PHASE X 扩展 |
|-----------------|---------|------------|---------------------|
| `a09f706` | E-017 partial (r-server) + E-019 partial (config-helper) + PR-001 | retention-sweeper.js 新 + server.js +93 行 + config-helper.js ±91 行 | ✅ PHASE 1.1：扩 E-019 full 到 agent-task-store / branch-db / result-db 三处；⚠️ E-017 main 主进程侧 IPC 推迟到 observability |
| `1fedf9c` | OB-004 + OB-005 partial (mcp-server) | routes/index.js +11 + mcp-server.js ±6 | ⚠️ OB-005 full 推迟到 observability |

---

## §3 跨工作包边界（BLOCK-3/4/5/9/9.1/9.2/10 禁止触碰）

### §3.1 BLOCK-3/4/5（IPC bridge）边界

- ✅ 不重写 sender 守门 helper（BLOCK-3 已建立）
- ✅ 不动 skills IPC / poller 逻辑（BLOCK-3/4）
- ✅ 不动 IPC channel 字面量（BLOCK-5 已统一）

### §3.2 BLOCK-9（前端 mega file refactor）边界

- ✅ 不动 `frontend/src/pages/_data.ts` / `project-workspace.tsx`
- ✅ 不动 `frontend/src/lib/file-preview/`（buildPreviewTable 已抽）
- ✅ 不动 `frontend/src/styles/custom.css`

### §3.3 BLOCK-9.1（main.js split）边界

- ✅ 不动 `src/main.js` 剩余 5 个不拆函数（setupWindowIpc / createWindow / setupAgentWorkbenchFlagsIpc / setupSkillsIpc / setupCsp）
- ✅ 不动已拆出 11 个 setup* 模块
- ⚠️ **例外**：A-009 端口统一必读 `env-coordinator.js` 但**不重写**仅对齐 fallback（PHASE 1.2 additive）

### §3.4 BLOCK-9.2（mega file refactor 5 文件）边界

- ✅ 不动 `frontend/src/components/desktop/DesktopSettingsPanel/`
- ✅ 不动 `frontend/src/components/workspace-panels/ResultView/`
- ✅ 不动 `src/plugin/`（8 lib 已拆）
- ✅ 不动 `frontend/src/components/copilot/SimpleChat/`（6 模块 + 1 hook 已抽）
- ✅ 不动 `frontend/src/hooks/useSkillStore.ts`（PHASE 5 决议保留不拆）

### §3.5 BLOCK-10-AUDIT-CLOSEOUT（已收口）边界

- ✅ 不重写 PHASE 1+2 已落地 commit（11 commits）
- ⚠️ **例外**：A-007 + A-009 + A-010 + E-019 full 是 PHASE 1+2 已"partial 落地"的扩展，PHASE 1 范围内"自然补全"即可（不重写既有 r-server `core/shared-backend/config-helper.js`，仅扩使用范围）

---

## §4 阶段归属（19 项中哪些 G0 必做 / 哪些 G1+ 外推）

### §4.1 G0 必做（本工作包主范围 12 项）

| ID | 阶段 | 风险 | 本工作包范围 |
|----|------|------|------------|
| **A-007** | **PHASE 1.1** | 🟠 中 | ✅ DB singleton 抽 `_db-singleton.js` |
| **PR-012** | **PHASE 1.1** | 🟢 低 | ✅ 与 A-007 同 commit |
| **E-019 full** | **PHASE 1.1** | 🟠 中 | ✅ 扩 config-helper 到 agent-task-store / branch-db / result-db |
| **A-009** | **PHASE 1.2** | 🟢 低 | ✅ 端口 fallback 统一到 env-coordinator.js |
| **A-010**（仅 jspdf + 6 处 env） | **PHASE 1.2** | 🟢 低 | ✅ 移除 jspdf + 6 处 process.env.* 集中 |
| **A-002** | **PHASE 2.1** | 🔴 高 | ✅ routes/result-studio.js 1800 → 9 子域文件 |
| **A-005** | **PHASE 2.2** | 🔴 高 | ✅ routes/harness.js 1366 + routes/ai-agent.js 1222 → 子域文件 |
| **A-001** | **PHASE 3.1** | 🔴 高 | ✅ agent-runner.js 1799 → LoopOrchestrator + ConversationAdapter |
| **A-003** | **PHASE 3.2** | 🟠 中 | ✅ shared-backend configure 注入 |
| **A-008** | **PHASE 3.2** | 🟠 中 | ✅ act-tools ↔ plan-ui-tools 解环（permissions 循环保留 minor） |
| **A-006 部分** | **PHASE 3.3** | 🟠 中 | ⚠️ ≥5 处迁 SQLite（剩余保留） |

**G0 必做计数**：12 项（11 主范围 + 1 部分）

### §4.2 G0 不外推（7 项 — 仅登记）

| ID | 类别 | 候选工作包 |
|----|------|-----------|
| **A-004** | observability 体系化（console→logger 全量） | observability-work-package |
| **E-017 main** | observability 体系化（backend exit IPC 推送主进程侧） | observability-work-package |
| **E-018** | observability 体系化（supervisor restart IPC） | observability-work-package |
| **PR-006** | observability 体系化（IPC 推送 + metrics） | observability-work-package |
| **C-001-rserver** | rserver-http debt pack | rserver-http-debt-pack |
| **C-002-rserver** | rserver-http debt pack | rserver-http-debt-pack |
| **M-001** | rserver-http debt pack | rserver-http-debt-pack |
| **M-003** | rserver-http debt pack | rserver-http-debt-pack |
| **A-011** | type drift | type-drift-pack |
| **A-012** | fixture manifest | fixture-manifest-pack |

**G0 不外推计数**：10 项（按 BLOCK-10 §5.2 已明确候选工作包映射）

### §4.3 阶段归属总结

- **G0 必做**：12 项（PHASE 1: 5 项 / PHASE 2: 2 项 / PHASE 3: 5 项部分）
- **G0 不外推**：10 项（4 observability + 4 rserver-http + 1 type drift + 1 fixture manifest）
- **总**：22 项分类位 = 19 项原始 + 1 部分 A-006 + 1 部分 A-010 + 1 项 OB-005 full（已在 BLOCK-10 处理）

---

## §5 工作量估算

### §5.1 主范围 12 项工作量（按 PHASE 分布）

| PHASE | 范围 | 改动行数预估 | 新测试文件 | 测试数 | commit |
|-------|------|--------------|-----------|--------|--------|
| **PHASE 1.1** | A-007 + PR-012 + E-019 full | _db-singleton.js 80 行新 + branch-db 19→9 + result-db 23→9 + agent-task-store ±30 + db.js ±10 + db-reset.mjs 新 | 1 file | 5+ tests | 1 commit |
| **PHASE 1.2** | A-009 + A-010（仅 jspdf + 6 env） | env-coordinator.js ±10 + 4 处 fallback 删 + frontend/package.json -1 dep + 6 处 env read ±15 | 2 files | 3+ + 3+ tests | 1 commit |
| **PHASE 2.1** | A-002 routes/result-studio 拆分 | 1800 → ~400 + 9 子文件 ±1400 行 + index.js 注册中心 50 行 | 1 file | 5+ tests | 1-2 commit |
| **PHASE 2.2** | A-005 routes/harness + ai-agent 拆分 | harness 1366 → ~400 + 3 子文件 ±1000 + ai-agent 1222 → ~400 + 4 子文件 ±900 + 2 index.js 注册中心 | 2 files | 5+ + 5+ tests | 1 commit |
| **PHASE 3.1** | A-001 agent-runner 拆分 | 1799 → ~550 + loop-orchestrator.js 500 + conversation-adapter.js 300 | 2 files | 8+ + 5+ tests | 1 commit |
| **PHASE 3.2** | A-003 + A-008 | agent-workflow.js ±20 + index.js +10 + bootstrap.js ±10 + act-tool-core.js 新 + act-tool-ui.js 新 + act-tools.js facade ±20 | 2 files | 4+ + 4+ tests | 1 commit |
| **PHASE 3.3**（可选） | A-006 部分 singleton 收敛 | agent-task-store.js ±50 + 新表 ai_user_streams.sql + 新表 embed_log.sql + 5 处 _xxx 删除 | 1 file | 5+ tests | 1 commit |
| **PHASE 4** | audit + closeout | docs-only（4 canonical + DOC-REGISTRY + ui-productization-audit + closeout 报告） | 0 | 0 | 2-3 commits |

### §5.2 主范围累计

- **commit 数**：4-7 commit（PHASE 1.1 + 1.2 + 2.1 + 2.2 + 3.1 + 3.2 + 3.3 可选 = 7 commit 主收口；PHASE 4 closeout 2-3 commit）
- **新增测试文件**：6-9 files
- **新增测试**：~30-50 tests
- **行数净变化**：~3000-4000 行 net +（含大量新模块文件）
- **新依赖**：0

### §5.3 不外推 10 项估算（仅登记）

- 不外推项均推迟到下一候选工作包；当前 G0 阶段不外推；估算工作量超出本工作包范围
- observability-work-package 候选预估 ~3000-5000 行 + ~15-20 tests
- rserver-http-debt-pack 候选预估 ~1000-1500 行 + ~10 tests
- type-drift-pack 候选预估 ~500-800 行 + ~5 tests
- fixture-manifest-pack 候选预估 ~200-300 行 + ~3 tests

### §5.4 风险等级

| PHASE | 风险等级 | 主要风险 |
|-------|----------|----------|
| PHASE 1.1 | 🟠 中 | DB 进程边界不破坏；既有 chf0-critical IPC contract 不退化 |
| PHASE 1.2 | 🟢 低 | additive；jspdf 移除不影响功能；6 处 env 集中不引入新依赖 |
| PHASE 2.1 | 🔴 高 | http 契约 100% 不变；端点 channel 名 / payload shape 100% 一致；既有 chf0-http + result-studio 测试 0 退化 |
| PHASE 2.2 | 🔴 高 | 同 PHASE 2.1；ai-agent.js 集成 SSE + Loop + Tool Call + Conversation 更复杂 |
| PHASE 3.1 | 🔴 高 | agent loop 状态机 0 变化；4 大类 require 跨域耦合；既有 chf0-critical + agent-runner 测试 0 退化 |
| PHASE 3.2 | 🟠 中 | 破坏既有调用链；agent-workflow.js 顶部 try/catch 是已存在的"安全网"；partial-export 雷区 |
| PHASE 3.3（可选） | 🟠 中 | 写入者竞争 + restart 恢复时间；既有 `agent_task_events` 表写入者不与新表冲突 |
| PHASE 4 | 🟢 低 | docs only；4 canonical + DOC-REGISTRY + ui-productization-audit + closeout 报告 |

---

## §6 修复顺序建议（依赖 DAG 推导）

> **详细 DAG 见** `docs/block-10-arch-ph0-fix-order.md`

### §6.1 关键修复顺序

```
PHASE 1（DB 体系化 + 配置快赢）
  A-007 + PR-012 + E-019 full     (3 项同根，1 commit)
  A-009 + A-010 (jspdf + 6 env)   (2 项同 commit)
         ↓
PHASE 2（r-server 大文件拆分）
  A-002 routes/result-studio 拆分
  A-005 routes/harness + ai-agent 拆分
         ↓
PHASE 3（agent-runner + 跨层反向 + 循环解环）
  A-001 agent-runner 拆分
  A-003 + A-008 跨层反向 + 循环解环
  A-006 部分 singleton 收敛（可选）
         ↓
PHASE 4（audit + closeout）
  4 canonical + DOC-REGISTRY
  ui-productization-audit ledger
  closeout 报告 v1.0
```

### §6.2 关键路径

`A-007 → PR-012 → E-019 full → A-002 → A-005 → A-001 → A-003 → A-008 → PHASE 4 audit → PHASE 4 closeout`

### §6.3 可并行 ID

- PHASE 1.1 + PHASE 1.2 串行（commit 边界清晰）
- PHASE 2.1 + PHASE 2.2 可并行 commit（不同文件）
- PHASE 3.1 + PHASE 3.2 串行（PHASE 3.2 依赖 PHASE 3.1 的 loop-orchestrator.js 不引用 harness-workflow-state）
- PHASE 3.3 可与 PHASE 3.2 合并 commit

### §6.4 启动建议

- 用户裁决启动 PHASE 1 后，建议主 agent 直做（PHASE 1 范围狭窄、低风险、不依赖 worker 委派）
- PHASE 2 启动时建议委派 worker 做架构调研（参考 BLOCK-9.2 PHASE 0 worker v2 模式）输出 `routes-endpoint-domain-mapping.md` 后主 agent 修订 plan v0.2 启动 PHASE 2 拆分
- PHASE 3 启动时建议主 agent 直做 agent-runner 拆分 + 跨层反向修复（核心模块、范围可控）

---

**不变量**：本调研报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check。下游 v0.1 active 计划基于本报告。
