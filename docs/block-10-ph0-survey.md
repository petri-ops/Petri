# BLOCK-10 PHASE 0 — Architecture Survey

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑 docs:check）
> **基线 plan**：`docs/code-audit-closeout-plan.md` v0.1（只读调研产出，0 行 git 操作）
> **关联下游 plan**：`docs/code-audit-closeout-plan.md` v0.2（active 工作包）
> **基线 audit 报告**：8 份独立审计（`docs/agent-harness-{error-handling,security,contract,architecture,observability,plugin-schema,rserver-http-contract,performance-resource}-audit-2026-08-17.md`）

---

## §1 范围与目标

### 1.1 PHASE 0 边界

本调研**不修改 plan v0.1 任何内容**，仅作为 v0.2 active 计划的前置只读调研。任务边界：

- ✅ 读取 8 份 audit 报告全部 90+ finding ID
- ✅ 读取 plan v0.1 全文 511 行 / 9 §
- ✅ **核对**当前 Git tree 的实际落地状态（v0.1 → 已 commit 的代码现状）
- ✅ 推导 25 项修复单元的依赖 DAG
- ✅ 列出 4 PHASE 划分理由与 commit 拆分建议
- ❌ **不动**任何源文件 / 测试 / 文档（除新建 4 份 PHASE 0 调研报告 + 升级 plan 到 v0.2）

### 1.2 与 v0.1 的关键差异

| 维度 | v0.1（基线） | v0.2 PHASE 0 调研产出 |
|------|-------------|---------------------|
| 状态 | 「只读调研产出，未升级为 active」 | **active 工作包**（v0.1 → v0.2 升级） |
| PHASE 1（C-001+C-002） | 待启动 | **已 commit** `1c0ebf0`（PHASE 1 收口） |
| PHASE 2（14 项 S/PR/E/OB） | 待启动 | **已 commit 4 commits** `128b3d4` / `4f9a10f` / `a09f706` / `1fedf9c`（PHASE 2 收口） |
| PHASE 3（PL-001） | 待启动 | **待启动**（registry.js + plugin-loader.js 无 `validateToolArgs`） |
| PHASE 4（closeout） | 待启动 | **待启动**（4 canonical doc 未同步 / closeout 报告未写） |
| 调研产出 | plan v0.1 单文件 | plan v0.2 + 4 份 PHASE 0 文档（survey / fix-order / test-matrix / risks） |

**关键含义**：v0.2 active 计划必须在文档中明确「PHASE 1 + PHASE 2 已落地」+「PHASE 3 + PHASE 4 剩余工作」二分结构，而不是把全部 25 项视为待执行。

### 1.3 调研方法

1. **文档读取**：`cat docs/code-audit-closeout-plan.md` / `cat docs/agent-harness-*.md` / `cat docs/AUDIT-LOG.md`
2. **Git 核对**：`git log --oneline --grep="block-10-audit-closeout"` + `git show --stat <commit>` 逐 commit 对照 v0.1 PHASE 1/2 落地清单
3. **状态核对**：`grep -E "validateToolArgs|getInputSchema" core/r-server/mcp/registry.js` 等查询 PHASE 3 是否提前落地
4. **冲突识别**：v0.1 §3.2 列 14 项 P1（PHASE 2） vs 实际 4 commits 落地的 ID 对照，识别 v0.1 规划与实际执行的偏差

---

## §2 25 项修复单元详细清单

> **格式**：每项 1 段（报告 / 行 / 标题 / 核心代码位置 / 关联 ID / 修复方案 1 段 / **当前状态**）。
> **当前状态分类**：
> - ✅ **已落地**（已 commit，PHASE 1 / PHASE 2 已收口）
> - ⏳ **待执行**（PHASE 3 / PHASE 4）
> - 🚫 **不外推**（G1+ 阶段事项 / 推迟到下一工作包）

### §2.1 Critical（11 项）

#### C-001（contract）— IPC branch/result bridge namespace 缺失 ✅ 已落地

- **报告 / 行**：contract §二 L49-174
- **标题**：branch/result IPC bridge 在 preload.js 完全未暴露 → renderer 路径全部走 stub
- **核心代码位置**：`src/preload.js:260-288`（已新增 branch + result + result.version 3 namespace）/ `frontend/src/lib/branchBridge.ts:21-65` / `frontend/src/lib/resultBridge.ts:55-81` / `src/ipc/branch-handlers.js:36-271` / `src/ipc/result-handlers.js:47-283` / `frontend/src/lib/electron.d.ts:319-505`
- **关联 ID**：AAE-03（同根）
- **修复方案**（commit `1c0ebf0` 已落地）：preload.js 顶层新增 2 个 namespace，1:1 暴露 `electron.d.ts:319-505` 已声明方法；不动现有 16 namespace 任何 key 名
- **当前状态**：✅ **已落地**（PHASE 1 / commit `1c0ebf0`）

#### C-002（contract）— result:create 拒绝 conversation_export ✅ 已落地

- **报告 / 行**：contract §二 L176-246
- **标题**：result:create IPC 拒绝 conversation_export 类型，但 d.ts 声明合法
- **核心代码位置**：`src/ipc/result-handlers.js:59-62`（validTypes 追加 `'conversation_export'`）/ `:352`（createFromConversation 改 `'conversation_export'`）/ `frontend/src/types/result.types.ts:12` / `frontend/src/lib/electron.d.ts:356-357`
- **关联 ID**：DB migration `007_result_conversation_export_type.sql`（必要的修复伴随，扩展 CHECK 集合为 6 项）
- **修复方案**：validTypes 数组 5 → 6 项；createResult 第 3 实参 `'text' → 'conversation_export'`；迁移重建 results 表
- **当前状态**：✅ **已落地**（PHASE 1 / commit `1c0ebf0` + `src/migrations/007_result_conversation_export_type.sql` + 3 tests）

#### S-001 — 插件 run_tool + workspace_exec capability 边界空缺 ✅ 已落地

- **报告 / 行**：security §2 L41-99
- **标题**：插件 run_tool + workspace_exec capability 边界空缺 → 等效 RCE
- **核心代码位置**：`core/r-server/agent-tools/agent-tool-policy.js:47-66,113-115`（`effectiveOperation` 返回 `allowedDownstream: ['r-runner','python-runner']` 默认空数组）/ `core/r-server/agent-tools/agent-tool-policy.js` 新增 `checkAllowedDownstream` helper / `core/r-server/mcp/registry.js:1359-1363`（在 `_runPluginScript` execFile 前调 checkAllowedDownstream）/ `core/r-server/agent-tools/workspace-tools.js:606-727`
- **关联 ID**：—
- **修复方案**（commit `128b3d4` 已落地）：在 `effectiveOperation` 中加 `allowedDownstream: string[]` 字段；plugin exec 路径只允许 `r-runner` / `python-runner`；shell / workspace_exec 一律拒绝；新增 `checkAllowedDownstream(op, downstream)` 单行 gate
- **当前状态**：✅ **已落地**（PHASE 2 commit 1 / `128b3d4` / 6 tests via `block-10-phase2-policy.test.mjs`）

#### E-017 — Backend procs exit handler 不推送 IPC status 事件 🚫 不外推

- **报告 / 行**：error §三 L477-494
- **标题**：Backend procs exit handler 不推送 IPC status 事件
- **核心代码位置**：`src/main/backend-proc-manager.js`（BLOCK-9.1 已拆出 / 4 个 proc exit handler）
- **关联 ID**：PR-006 同根 / OB-005 关联
- **修复方案**（v0.1 规划）：抽 `safeProcExit(name, code)` helper，调 `webContents.send('backend:status', {name, status: 'down', code, reason})` + `logError` + `metrics.inc('backend.exit')`
- **当前状态**：🚫 **不外推**。实际落地用 r-server 进程级 `installBackendExitLifecycle`（commit `a09f706` / `core/r-server/server.js` 93 行新增）：`process.on(SIGINT/SIGTERM/SIGHUP/beforeExit/exit)` 调 `db.close()` + 防递归。`backend-proc-manager.js` 的 IPC send 推迟到 G1+ observability 工作包（与 PR-006 合并到 `observability-work-package` 候选，避免重复改动已 BLOCK-9.1 收口的 `backend-proc-manager.js`）

#### E-018 — rServerSupervisor 自动重启无 IPC 通知 🚫 不外推

- **报告 / 行**：error §三 L496-506
- **标题**：rServerSupervisor 自动重启时无 IPC 通知，且 DB/HTTP 句柄未刷新
- **核心代码位置**：`src/main/backend-proc-manager.js`（rServerSupervisor 段 `scheduleRestart`）/ `src/owned-backend-supervisor.js`
- **关联 ID**：PR-005 关联
- **修复方案**（v0.1 规划）：在 `scheduleRestart()` emit `backend:status {status: 'restarting'}` + `metrics.inc('backend.restart')`
- **当前状态**：🚫 **不外推**。r-server 进程级生命周期（commit `a09f706`）已落地 `db.close()`；IPC 通知链路 + metrics 推迟到 observability 工作包（与 E-017 同根，按 G0 阶段纪律不外推）

#### OB-001 — console.*:logger.* 比例 5.1:1，关键路径全 console-only 🚫 不外推

- **报告 / 行**：observ §三 L331-350
- **标题**：console.* : logger.* 比例 5.1:1，关键路径全 console-only
- **核心代码位置**：`core/r-server/mcp/registry.js:1-1807`（28 console / 0 logger）/ `core/r-server/helpers/tools-executor.js`（32 / 0）/ `core/r-server/server.js:1-200`（17 / 0）/ `src/main/backend-proc-manager.js:1-443`（33 / 0）/ `core/gateway/server.js`（14 / 0）/ `src/main.js:1-1200`（28 / 0）
- **关联 ID**：A-004 同根
- **修复方案**：全 codebase 319 console → 62，渐进收敛到 logger
- **当前状态**：🚫 **不外推**（observability-work-package 候选）

#### OB-002 — IPC 跨进程 trace 不贯穿 🚫 不外推

- **报告 / 行**：observ §三 L352-371
- **标题**：IPC 跨进程 trace 不贯穿，preload 不传 rid
- **核心代码位置**：`src/preload.js:1-1000`（IPC 透传无 rid）/ `src/main.js`（IPC handler 无 rid 注入）/ `src/main/backend-proc-manager.js`（spawn child 不传 PETRI_RID）
- **关联 ID**：—
- **修复方案**：preload 注入 rid + main handler 透传 + spawn child env 注入
- **当前状态**：🚫 **不外推**（observability-work-package 候选）

#### OB-003 — 无 metrics 端点 / IPC handler 无 inc() 🚫 不外推

- **报告 / 行**：observ §四 L373-399
- **标题**：无 IPC handler / 后端重启 / SQLite 延迟指标，metrics 端点缺失
- **核心代码位置**：`src/main.js`（85 个 ipcMain.handle 全部无 inc()）/ `src/owned-backend-supervisor.js`（重启次数不暴露）/ `core/r-server/db.js:1-2133`（SQLite query 无 timer）
- **关联 ID**：—
- **修复方案**：metrics 端点 `/api/_internal/metrics` + IPC 聚合 + SQLite timer
- **当前状态**：🚫 **不外推**（observability-work-package 候选 / 不引入 prom-client）

#### PL-001 — MCP callTool 入口缺 inputSchema 校验 ⏳ 待执行

- **报告 / 行**：plugin §三 L129-189
- **标题**：MCP callTool 入口缺 inputSchema 校验
- **核心代码位置**：`core/r-server/plugin-loader.js:376-389`（`_inputsToInputSchema` 只生成不验证）/ `core/r-server/mcp/registry.js:1677-1788`（callTool 入口无 validator）
- **关联 ID**：—
- **修复方案**：写极简 validator（required / type / minimum / maximum / enum），callTool 入口在 `_runPluginScript` 前调 `_validateToolArgs(name, args)`；**不引入 ajv**；`plugin-loader.js` 暴露 `getInputSchema(toolId)`
- **当前状态**：⏳ **PHASE 3 待启动**（registry.js / plugin-loader.js 无 `validateToolArgs` / `getInputSchema` 符号；需 v0.2 收口）

#### PR-001 — SQLite append-only 表无归档 ✅ 已落地

- **报告 / 行**：perf §三 L103-138
- **标题**：SQLite append-only 表无归档 / cleanup 任务
- **核心代码位置**：`core/r-server/agent-task-store.js:198-220`（task_events 保留不动）/ `core/r-server/helpers/conversations.js:34-43`（copilot_messages）/ `core/r-server/db.js:103-167`（loop_iterations / loop_actions / loop_evidence）/ `core/r-server/jobs/retention-sweeper.js:1-229`（新增）
- **关联 ID**：—
- **修复方案**（commit `a09f706` 已落地）：抽 `core/r-server/jobs/retention-sweeper.js` 229 行 + `scheduleRetentionSweep` 递归 setTimeout + unref handle；表删除逐一 try/catch（不静默吞）；范围限定 `loop_*` + `copilot_messages`（不动 `agent_task_events`，避免与 agent-task-store.js 写入者抢）
- **当前状态**：✅ **已落地**（PHASE 2 commit 3 / `a09f706`）

#### C-001-rserver — `/api/run` 与 `/api/replot/run` 双重拦截 🚫 不外推

- **报告 / 行**：rserver-http §五 L456-462
- **标题**：`/api/run` 与 `/api/replot/run` 双重拦截，错误体被 moduleGate 抢答
- **核心代码位置**：`core/r-server/routes/r-compute.js:48,65` / `core/r-server/bootstrap.js:62`（moduleGate 顺序错位）
- **关联 ID**：—
- **修复方案**：r-compute.js 这 2 个端点 410 在 moduleGate 前 early-return 或 bootstrap.js moduleGate 对此两路径豁免
- **当前状态**：🚫 **不外推**（rserver-http-debt-pack 候选 / 与 frontend grep 清理 M-002 同根）

### §2.2 High / Major 收口项（14 项）

#### S-002 — Result Studio contextToken fail-closed 复活 ✅ 已落地

- **报告 / 行**：security §2 L100-138
- **标题**：Result Studio contextToken 「显式 token 即过期也获胜」破坏 fail-closed
- **核心代码位置**：`core/r-server/agent-tools/result-context-binding.js:65-81`
- **关联 ID**：—
- **修复方案**（commit `128b3d4` 已落地）：`bindResultStudioContextToken` 校验 (jobId, name, revisionId) 三元组与 `ctx.activeArtifact` 是否匹配；不匹配时显式 token 失效（fail-closed）
- **当前状态**：✅ **已落地**（PHASE 2 commit 1 / `128b3d4` / 4 tests via `block-10-phase2-policy.test.mjs`）

#### S-003 — inferExecutionPolicy 用自然语言正则推断 ✅ 已落地

- **报告 / 行**：security §2 L140-181
- **标题**：`inferExecutionPolicy` 用自然语言正则推断执行许可
- **核心代码位置**：`core/r-server/helpers/agent-execution-policy.js:1-23`
- **关联 ID**：—
- **修复方案**（commit `128b3d4` 已落地）：删自然语言正则推断；改用 `ctx.accessMode` 显式透传（前端 chat-mode UI 决定）
- **当前状态**：✅ **已落地**（PHASE 2 commit 1 / `128b3d4` / 2 tests via `block-10-phase2-policy.test.mjs`）

#### S-004 — 分支对话与结果 IPC 缺少 sender 守门 ✅ 已落地

- **报告 / 行**：security §2 L183-227
- **标题**：分支对话与结果 IPC 缺少 sender 守门
- **核心代码位置**：`src/ipc/_sender-guard.js:1-72`（新增）/ `src/ipc/branch-handlers.js:36-271` / `src/ipc/result-handlers.js:47-...` / `src/ipc/ai-settings.js:29-84` / `src/ipc/plugin.js:23-107` / `src/ipc/diagnostic.js:22-136`
- **关联 ID**：BLOCK-3 既有 sender 守门 helper（参考模式 `src/main.js:604` / `:1586`）
- **修复方案**（commit `4f9a10f` 已落地）：抽 `createSenderGuard` helper 到 `src/ipc/_sender-guard.js`，接受 BrowserWindow 或 `()=>BrowserWindow` thunk（窗口重建后守卫仍活）；branch/result/ai-settings/plugin/diagnostic 5 类 handler 每行首行调 `createSenderGuard`；`main.js` 传 `()=>mainWindow` thunk 给 4 个 setup 函数
- **当前状态**：✅ **已落地**（PHASE 2 commit 2 / `4f9a10f`）

#### S-005 — workspace_exec 黑名单可被绕过 ✅ 已落地

- **报告 / 行**：security §2 L229-281
- **标题**：`workspace_exec` 命令阻断基于关键字黑名单，可被绕过
- **核心代码位置**：`core/r-server/agent-tools/workspace-tools.js:606-727`
- **关联 ID**：—
- **修复方案**（commit `4f9a10f` 已落地）：在 `commandVerdict` 之外加 capability tokens 标记；保留黑名单作为兜底（**渐进**：不删黑名单，与 PHASE 2 §4.4 计划一致）
- **当前状态**：✅ **已落地**（PHASE 2 commit 2 / `4f9a10f` / 改动 16 行）

#### S-006 — retry_stats 单例 + user_id 可空 ✅ 已落地

- **报告 / 行**：security §2 L283-342
- **标题**：`agent-task-store.js` 全局 retry_stats 单例 + user_id 字段可空
- **核心代码位置**：`core/r-server/agent-task-store.js:60-99,181-206`
- **关联 ID**：—
- **修复方案**（commit `4f9a10f` 已落地）：retryStats 按 task_id 隔离（取消 module-level 单例）；`tasks.user_id` 写 NOT NULL 约束
- **当前状态**：✅ **已落地**（PHASE 2 commit 2 / `4f9a10f` / 133 行新增）

#### S-007 — 诊断日志导出可写任意目录 ✅ 已落地

- **报告 / 行**：security §2 L344-379
- **标题**：诊断日志导出对路径与 archiver 失败的回退可写入任意目录
- **核心代码位置**：`src/ipc/diagnostic.js:22-136`
- **关联 ID**：—
- **修复方案**（commit `4f9a10f` 已落地）：targetPath 改 null；主进程 `dialog.showSaveDialog` 强制选（不再接受 renderer 传来的路径）
- **当前状态**：✅ **已落地**（PHASE 2 commit 2 / `4f9a10f` / 25 行改动）

#### E-019 — SQLite 双 connection + busy_timeout 不一致 🚫 不外推（部分落地）

- **报告 / 行**：error §三 L508-529
- **标题**：r-server 内 SQLite 共享 db 但两 connection，busy_timeout 不一致
- **核心代码位置**：`core/r-server/agent-task-store.js:177-179`（5000ms） vs `core/r-server/db.js:18-32`（10000ms）
- **关联 ID**：PR-011 + PR-012 + A-007
- **修复方案**（v0.1 规划）：抽 `core/shared-backend/db-config.js` 统一 `BUSY_TIMEOUT_MS = 10000` + WAL；agent-task-store + branch-db + result-db 都 require
- **当前状态**：🚫 **不外推**（commit `a09f706` 命名上引入 `core/shared-backend/config-helper.js` 91 行，但实际承担的是 r-server 单进程 db config helper，**不统一** agent-task-store / branch-db / result-db 的 busy_timeout）。3 类 connection 各自保留，DB 体系化属于 BLOCK-10-ARCHITECTURE 候选（v0.1 §8.1）。

#### C-002-rserver — `/api/result-studio/interaction` HTTP 200 + {error} 🚫 不外推

- **报告 / 行**：rserver-http §五 L464-472
- **标题**：`/api/result-studio/interaction` 在 Revision 不匹配时返回 HTTP 200 + `{error}`
- **核心代码位置**：`core/r-server/routes/result-studio.js`（`/api/result-studio/interaction` 路由）
- **关联 ID**：contract C-002（不同维度）
- **修复方案**：`res.json({error})` 改 `res.status(409).json({error, details: {revisionId, artifactId}})`
- **当前状态**：🚫 **不外推**（rserver-http-debt-pack 候选）

#### M-001 — `/api/ai/admin/*` 9 端点鉴权后置 🚫 不外推

- **报告 / 行**：rserver-http §六 L474-480
- **标题**：`/api/ai/admin/*` 9 个端点鉴权后置
- **核心代码位置**：`core/r-server/routes/ai-admin.js:25` + 9 个 handler 第一行 `if (!_requireAdmin(req,res)) return;`
- **关联 ID**：—
- **修复方案**：抽 `requireAdmin` middleware，`router.use(requireAdmin)`
- **当前状态**：🚫 **不外推**（rserver-http-debt-pack 候选）

#### M-003 — `/api/feedback` 公开端点缺 origin check 🚫 不外推

- **报告 / 行**：rserver-http §六 L490-496
- **标题**：`/api/feedback` 公开端点缺 origin check，仅依赖 IP rate limit（5/min）
- **核心代码位置**：`core/r-server/routes/feedback.js:73`
- **关联 ID**：—
- **修复方案**：加 `req.headers.origin` 白名单校验
- **当前状态**：🚫 **不外推**（rserver-http-debt-pack 候选）

#### OB-004 — error-log 路径不可写 + logError 仅 2 处 ✅ 已落地

- **报告 / 行**：observ §六 L401-422
- **标题**：`error-log.js` 默认路径不可写，调用点 2 处，dedupe 缺失
- **核心代码位置**：`core/shared-backend/error-log.js:10` / `core/r-server/server.js:75,78`
- **关联 ID**：AAE-05
- **修复方案**（commit `1fedf9c` 已落地）：r-server `routes/index.js` +11 行 + `src/mcp-server.js` +6 行；默认路径改 local-data；dedupe 已就位
- **当前状态**：✅ **已落地**（PHASE 2 commit 4 / `1fedf9c`）

#### OB-005 — Health 端点 shape 不一致 + liveness/readiness 未分离 🚫 部分落地

- **报告 / 行**：observ §六 L424-443
- **标题**：Health 端点 shape 不一致，liveness/readiness 未分离
- **核心代码位置**：`core/r-server/server.js:152` / `core/r-server/routes/ai-misc.js:14` / `core/py-server/server.js:163` / `core/gateway/server.js:96,120`
- **关联 ID**：—
- **修复方案**（v0.1 规划）：抽 `core/shared-backend/health.js` 统一 `/api/live` + `/api/ready` + `/api/health` 三层
- **当前状态**：🚫 **不外推**（commit `1fedf9c` 仅在 `src/mcp-server.js` 加 6 行 health endpoint，未抽 `core/shared-backend/health.js` 共享层）。完整 liveness/readiness 分离推迟到 observability-work-package 候选。

#### PR-006 — 4 个 backend 子进程 exit handler 仅 console.log 🚫 不外推（部分落地）

- **报告 / 行**：perf §四 L269-291
- **标题**：4 个 backend 子进程（gateway/r-server/py-server/plumber）的 exit handler 仅 `console.log` + null 引用
- **核心代码位置**：`src/main/backend-proc-manager.js`（4 个 `proc.on('exit', ...)`）
- **关联 ID**：E-017 同根 / OB-005 关联
- **修复方案**（v0.1 规划）：抽 `safeProcExit(name, code)` helper 调 `webContents.send('backend:status', down)`
- **当前状态**：🚫 **不外推**（commit `a09f706` r-server 进程级 `installBackendExitLifecycle` 已落地；Electron 主进程的 `backend-proc-manager.js` IPC 推送 / `metrics.inc` 推迟）。**与 v0.1 规划偏差**：v0.1 把 backend exit 视为 Electron 主进程侧问题（`backend-proc-manager.js`），实际执行落到 r-server 子进程侧（`core/r-server/server.js`）。这是合理的范围调整，但必须在 closeout 报告中明确记录。

#### PR-012 — branch-db + result-db 同时打开 petri.db 🚫 不外推

- **报告 / 行**：perf §四 L488-521
- **标题**：desktop main 进程 branch-db + result-db 同时打开 petri.db（与 r-server 进程共享文件）
- **核心代码位置**：`src/database/branch-db.js:18-49` / `src/database/result-db.js:23-54`
- **关联 ID**：A-007 + PR-011
- **修复方案**：v0.1 规划统一 busy_timeout；**实际不动**
- **当前状态**：🚫 **不外推**（DB 体系化属于 BLOCK-10-ARCHITECTURE 候选 / 与 E-019 同根）

---

## §3 同根组合（v0.1 §2.3 深化）

v0.1 §2.3 识别 7 组同根关联。**PHASE 0 调研发现：实际 commit `a09f706` 落地时把「backend exit」重定位到 r-server 进程级 lifecycle**（而不是 v0.1 规划的 Electron 主进程侧）。这是与 v0.1 规划的偏差，必须在 v0.2 中显式承认。

### §3.1 已合并组（实际 commit 落地）

| 同根组 | 涉及 ID | 合并 commit | 落地位置 |
|--------|---------|-------------|----------|
| **capability + contextToken + execPolicy** | S-001 + S-002 + S-003 | `128b3d4` | `core/r-server/agent-tools/agent-tool-policy.js` + `result-context-binding.js` + `helpers/agent-execution-policy.js` |
| **sender guard + workspace_exec + retry_stats + diagnostic** | S-004 + S-005 + S-006 + S-007 | `4f9a10f` | `src/ipc/_sender-guard.js` + `core/r-server/agent-tools/workspace-tools.js` + `core/r-server/agent-task-store.js` + `src/ipc/{branch,result,ai-settings,plugin,diagnostic}.js` |
| **retention + backend_exit (r-server 进程级)** | PR-001 + E-017 (子进程侧) | `a09f706` | `core/r-server/jobs/retention-sweeper.js` + `core/r-server/server.js` installBackendExitLifecycle + `core/shared-backend/config-helper.js` |
| **error_log + health_endpoint** | OB-004 + (部分 OB-005) | `1fedf9c` | `core/r-server/routes/index.js` + `src/mcp-server.js` |
| **C-001 + C-002 + DB migration** | contract C-001 + C-002 | `1c0ebf0` | `src/preload.js` + `src/ipc/result-handlers.js` + `src/migrations/007_result_conversation_export_type.sql` |

### §3.2 不合并组（v0.1 建议合并但实际未合并）

| 同根组 | 涉及 ID | 未合并原因 | 后续处理 |
|--------|---------|------------|----------|
| **backend exit（Electron 主进程侧）** | E-017 + PR-006 + (部分 OB-005) | r-server 进程级 lifecycle 已落地；主进程侧 IPC 推送需 observability-work-package | 🚫 不外推 / 推迟到 observability 候选 |
| **SQLite 双 connection busy_timeout** | E-019 + PR-011 + PR-012 + A-007 | 仅 r-server db-config helper 落地；agent-task-store / branch-db / result-db 各自保留 | 🚫 不外推 / BLOCK-10-ARCHITECTURE 候选 |
| **rServerSupervisor 重启** | E-018 + PR-005 | 未合并修复 | 🚫 不外推 / observability-work-package |

---

## §4 跨工作包边界（BLOCK-3/4/5/9/9.1/9.2 哪些禁止触碰）

### §4.1 BLOCK-3（IPC bridge hardening）边界

- ✅ 不重写 sender 守门 helper（v0.1 §2.4 已明确）
- ✅ 复用 BLOCK-3 的 `src/main.js:604` / `:1586` sender 守门模式（已实际执行）
- ✅ `src/ipc/_sender-guard.js`（BLOCK-10 新增）是**独立 helper**，与 BLOCK-3 `assertTrustedWindowIpcSender` 不冲突；BLOCK-3 helper 仍在 `src/main.js` 保留

### §4.2 BLOCK-4（IPC bridge polish）边界

- ✅ 不动 skills IPC / poller 逻辑
- ✅ 不动 `_mapSkillRuntimeStatus`（BLOCK-4 抽出的 `src/_mapSkillRuntimeStatus.js`）

### §4.3 BLOCK-5（IPC bridge finalize）边界

- ✅ 不动 IPC channel 字面量（PHASE 1 C-001 新增 `branch` + `result` 是 namespace-level，channel 名 `branch:create` 等是新增不动既有）
- ✅ PHASE 1 `petriDesktop.branch` / `petriDesktop.result` / `petriDesktop.result.version` 3 namespace 全部**新增**，不动既有 16 namespace

### §4.4 BLOCK-9（mega file refactor 前端）边界

- ✅ 不动 `frontend/src/pages/_data.ts` / `project-workspace.tsx`
- ✅ 不动 `frontend/src/lib/file-preview/`（buildPreviewTable 已抽）
- ✅ 不动 `frontend/src/styles/custom.css`（BLOCK-8 已补 4 token）

### §4.5 BLOCK-9.1（main.js split）边界

- ✅ 不动 `src/main.js` 剩余 5 个不拆函数（setupWindowIpc / createWindow / setupAgentWorkbenchFlagsIpc / setupSkillsIpc / setupCsp）
- ✅ 不动已拆出 11 个 setup* 模块（PHASE 1 6 个 + PHASE 2 4 个 + PHASE 3 1 个）
- ✅ **实际偏差**：commit `4f9a10f` `src/main.js` 改 8 行（加 4 个 `setupXxx` 调 `createSenderGuard` thunk 参数）。**这是 additive 改动**（不改函数签名，仅多传一个参数），但严格按 BLOCK-9.1 边界，**应记录在 v0.2 偏离声明中**。

### §4.6 BLOCK-9.2（mega file refactor 5 文件）边界

- ✅ 不动 `frontend/src/components/desktop/DesktopSettingsPanel/`（BLOCK-9.2 PHASE 1 已拆）
- ✅ 不动 `frontend/src/components/workspace-panels/ResultView/`（PHASE 2 已拆）
- ✅ 不动 `src/plugin/`（PHASE 3 已拆 8 lib）
- ✅ 不动 `frontend/src/components/copilot/SimpleChat/`（PHASE 4 已拆 6 模块 + 1 hook）
- ✅ 不动 `frontend/src/hooks/useSkillStore.ts`（PHASE 5 决议保留不拆）

---

## §5 阶段归属（25 项中哪些 G0 必做 / 哪些 G1+ 外推）

### §5.1 G0 必做（PHASE 1 + PHASE 2 + PHASE 3 已落地 / 待启动）

| ID | 阶段 | 状态 | commit |
|----|------|------|--------|
| C-001 | PHASE 1 | ✅ | `1c0ebf0` |
| C-002 | PHASE 1 | ✅ | `1c0ebf0` |
| S-001 | PHASE 2 commit 1 | ✅ | `128b3d4` |
| S-002 | PHASE 2 commit 1 | ✅ | `128b3d4` |
| S-003 | PHASE 2 commit 1 | ✅ | `128b3d4` |
| S-004 | PHASE 2 commit 2 | ✅ | `4f9a10f` |
| S-005 | PHASE 2 commit 2 | ✅ | `4f9a10f` |
| S-006 | PHASE 2 commit 2 | ✅ | `4f9a10f` |
| S-007 | PHASE 2 commit 2 | ✅ | `4f9a10f` |
| PR-001 | PHASE 2 commit 3 | ✅ | `a09f706` |
| OB-004 | PHASE 2 commit 4 | ✅ | `1fedf9c` |
| **PL-001** | **PHASE 3** | **⏳** | **待启动** |

**G0 必做计数**：12 项已落地 + 1 项待启动（PL-001）= **13 项**

### §5.2 G0 不外推（G1+ / 体系化工作 / 推迟到下一工作包）

| ID | 推迟类别 | 后续候选工作包 |
|----|----------|---------------|
| E-017 | observability 体系化（backend exit IPC 推送） | observability-work-package |
| E-018 | observability 体系化（supervisor restart IPC） | observability-work-package |
| E-019 | DB 体系化（busy_timeout 统一到 10000ms） | BLOCK-10-ARCHITECTURE |
| OB-001 | observability 体系化（console→logger 全量） | observability-work-package |
| OB-002 | observability 体系化（IPC trace 全贯穿） | observability-work-package |
| OB-003 | observability 体系化（metrics 端点） | observability-work-package |
| OB-005 | observability 体系化（health 三层分离） | observability-work-package |
| PR-006 | observability 体系化（IPC 推送 + metrics） | observability-work-package |
| PR-012 | DB 体系化（branch-db / result-db 共享） | BLOCK-10-ARCHITECTURE |
| C-001-rserver | rserver-http debt pack | rserver-http-debt-pack |
| C-002-rserver | rserver-http debt pack | rserver-http-debt-pack |
| M-001 | rserver-http debt pack | rserver-http-debt-pack |
| M-003 | rserver-http debt pack | rserver-http-debt-pack |

**G0 不外推计数**：13 项

### §5.3 阶段归属总结

- **G0 必做**：13 项（11 项已落地 + 1 项 PL-001 待启动 + 1 项 PHASE 4 closeout 待启动）
- **G0 不外推**：13 项（按 G0 阶段纪律，必须用户显式裁决启动后续工作包才进入）
- **总**：25 项 + 1 项 PHASE 4 closeout = **26 项**

---

## §6 工作量估算

### §6.1 已落地（PHASE 1 + PHASE 2 = 5 commits）

| commit | 范围 | 改动行数 | 测试文件 / 测试数 |
|--------|------|---------|-----------------|
| `1c0ebf0` PHASE 1 | C-001 + C-002 + DB migration | preload.js +30 + result-handlers.js 4 + migration.sql 新文件 | 3 test files / 9 tests |
| `128b3d4` PHASE 2 commit 1 | S-001 + S-002 + S-003 | agent-tool-policy.js ±39 + agent-execution-policy.js ±40 + registry.js ±16 | 1 test file / 12 tests |
| `4f9a10f` PHASE 2 commit 2 | S-004 + S-005 + S-006 + S-007 | _sender-guard.js 新文件 72 + agent-task-store.js ±133 + workspace-tools.js ±16 + 5 handler 文件 | 0 新测试（沿用既有） |
| `a09f706` PHASE 2 commit 3 | PR-001 + E-017 (r-server) + E-019 (partial) | retention-sweeper.js 新文件 229 + server.js +93 + config-helper.js ±91 | 0 新测试 |
| `1fedf9c` PHASE 2 commit 4 | OB-004 + (OB-005 partial) | routes/index.js +11 + mcp-server.js ±6 | 0 新测试 |

**已落地累计**：5 commits / ~600 行 net + / 4 test files / 21 tests

### §6.2 待启动（PHASE 3 + PHASE 4）

| 阶段 | 范围 | 改动预估 | 测试新增 | commit 数 |
|------|------|---------|---------|----------|
| PHASE 3 | PL-001（mcp callTool inputSchema 校验） | registry.js +40 / plugin-loader.js +20 / 新文件 _validate-tool-args.js 80 | 1 test file / 10 tests | 1 commit |
| PHASE 4 | audit + closeout | docs-only（4 canonical + DOC-REGISTRY + ui-productization-audit + closeout 报告） | 0（仅验证） | 2-3 commits |

**待启动累计**：3-4 commits / ~140 行 net + / 1 test file / 10 tests

### §6.3 工作量总结

- **已落地**：5 commits / 4 test files / 21 tests / ~600 行 net +
- **待启动**：3-4 commits / 1 test file / 10 tests / ~140 行 net +
- **总工作量（BLOCK-10-AUDIT-CLOSEOUT 整体）**：8-9 commits / 5 test files / 31 tests / ~740 行 net +

### §6.4 风险等级

| 阶段 | 风险等级 | 主要风险 |
|------|----------|----------|
| PHASE 1（已落地） | 中（IPC 契约） | 1:1 镜像 d.ts；测试覆盖 |
| PHASE 2 commit 1（已落地） | 高（capability 算法） | 单测覆盖 12 用例 |
| PHASE 2 commit 2（已落地） | 中（sender guard 已有 BLOCK-3 范式） | additive 扩到 5 handler 类；测试沿用既有 |
| PHASE 2 commit 3（已落地） | 中（retention + lifecycle） | 单进程 r-server lifecycle；不动 agent-task-store |
| PHASE 2 commit 4（已落地） | 低（health + error_log 路径） | 6 + 11 行小改 |
| **PHASE 3（待启动）** | **中（plugin 工具面广）** | **极简 validator 覆盖 10 工具插件 × 5 schema 字段** |
| PHASE 4（待启动） | 低（docs only） | 4 canonical doc 同步 + DOC-REGISTRY 9+10 登记 |

---

## §7 修复顺序建议（依赖 DAG 推导）

### §7.1 依赖 DAG（已落地 + 待启动）

```
[PHASE 1]
  C-001 (preload.js namespace)
    └─ C-002 (result:create conversation_export)
         └─ DB migration 007 (results CHECK rebuild)
              ↓
[PHASE 2 commit 1]
  S-001 (capability allowedDownstream)
    ├─ S-002 (contextToken 三元组)
    └─ S-003 (inferExecutionPolicy 删自然语言)
              ↓
[PHASE 2 commit 2]
  S-004 (sender guard helper)
    ├─ S-005 (workspace_exec capability tokens)
    ├─ S-006 (retry_stats task_id 隔离)
    └─ S-007 (diagnostic targetPath null)
              ↓
[PHASE 2 commit 3]
  PR-001 (retention sweeper)
    └─ E-017 r-server 进程级 lifecycle (commit a09f706 已落地)
              ↓
[PHASE 2 commit 4]
  OB-004 (error_log 路径) + OB-005 partial (mcp-server.js health endpoint)
              ↓
[PHASE 3]
  PL-001 (mcp callTool inputSchema 校验)
              ↓
[PHASE 4]
  audit + closeout (4 canonical docs + DOC-REGISTRY + closeout 报告)
```

### §7.2 关键路径

- **C-001 → C-002 → DB migration → PHASE 2 commit 1 → commit 2 → commit 3 → commit 4 → PHASE 3 → PHASE 4**（顺序依赖）

### §7.3 可并行 ID（PHASE 2 commit 2 内部）

- S-004 / S-005 / S-006 / S-007 4 项**互不依赖**（都基于 BLOCK-3 sender 守门 helper / workspace-tools.js / agent-task-store.js / diagnostic.js 4 个不同文件）
- 但 commit 边界 1 个统一提交，便于审阅

### §7.4 不可并行约束

- PHASE 1 必须先于 PHASE 2（DB migration 007 是 PHASE 1 C-002 的伴随）
- PHASE 2 commit 1 必须先于 commit 2（S-002 / S-003 改变 agent-tool-policy.js / agent-execution-policy.js 的 export 形状，commit 2 的 `agent-task-store.js` 不引用这些 export，但 workspace-tools.js 引用）
- PHASE 3 必须先于 PHASE 4（PL-001 测试覆盖必须跑过）

---

**不变量**：本调研报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check。下游 v0.2 active 计划基于本报告。
