# Agent Harness 8 份审计报告收口工作包计划

**版本**：v0.1（只读调研产出 / 主 agent 后续修订为 active 工作包）
**起草时间**：2026-08-17 21:08（UTC+8）
**只读调研**：0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check
**关联 8 份独立审计报告**（2026-08-17 同日产出）：

| 报告 | 路径 | 行数 | 发现数 | Critical / High / Major |
|------|------|------|--------|------------------------|
| 错误处理 | `docs/agent-harness-error-handling-audit-2026-08-17.md` | 926 | E-001..E-025 | **2C** + 13M + 10m |
| 安全 | `docs/agent-harness-security-audit-2026-08-17.md` | 894 | S-001..S-018 | **1C** + **5H** + 7M + 5L |
| 契约一致性 | `docs/agent-harness-contract-audit-2026-08-17.md` | 1039 | C-001..C-013 | **2C** + 6M + 5m |
| 架构与可维护性 | `docs/agent-harness-architecture-audit-2026-08-17.md` | 805 | A-001..A-012 | 0C + 12M (含多个 minor) |
| 可观测性 | `docs/agent-harness-observability-audit-2026-08-17.md` | 774 | OB-001..OB-013 | **3C** + 6M + 4m |
| Plugin schema | `docs/agent-harness-plugin-schema-audit-2026-08-17.md` | 746 | PL-001..PL-010 | **1C** + 5M + 4m |
| r-server HTTP 契约 | `docs/agent-harness-rserver-http-contract-audit-2026-08-17.md` | 661 | C-001..Mi-005 | **2C** + 8M + 5m |
| 性能与资源 | `docs/agent-harness-performance-resource-audit-2026-08-17.md` | 1292 | PR-001..PR-033 | **1C** + 16M + 16m |

**关联已收口工作包**（不重新激活，仅作为纪律参考）：

- BLOCK-3 (`docs/block-3-ipc-bridge-hardening-plan.md`) — IPC sender 守门 + poller 9→4 状态映射
- BLOCK-4 (`docs/block-4-ipc-bridge-polish-plan.md`) — IPC 收尾
- BLOCK-5 (`docs/block-5-ipc-bridge-finalize-plan.md`) — IPC 最终收口
- BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 — 前端 _data.ts / main.js 拆分 / 5 个 mega file 拆分

---

## 1. TL;DR

本工作包要收口的发现：**全部 11 个 Critical + 5 个 High（仅安全 S-002/S-003/S-004/S-005/S-007）+ 9 个最高 ROI 的 Major**（C-001 IPC bridge / C-002 / S-001 / S-006 / PR-001 / PR-006 / E-017 / E-018 / E-019 / PL-001 / OB-004 / OB-005 / C-002-rserver / M-001 / M-003），总计约 **25 个独立修复单元**，分 4 个 PHASE 落地。

**不收口**（推到下一工作包 / 视为 G0 阶段不外推）：

- **G1+ 阶段事项**：packaged Electron / Provider 矩阵 / GA / 公证 / dist staleness / notarization / P7（按 `AGENTS.md` 当前阶段纪律）
- **架构层面 56+ singleton 拆分**（A-001..A-010 是大文件/拆分范畴，单独工作包 BLOCK-10 候选，本工作包不外推）
- **全链路可观测性体系化**（OB-001 console→logger 全量替换、OB-003 metrics 端点 / OB-007 跨进程 unhandledRejection 等）→ 推到 observability-work-package 候选
- **Agent Loop 事件类型命名规范化**（C-012 8+ 种 event 类型）：与 Result Studio 体系耦合，需独立工作包
- **三套重试策略合并**（E-009） + RetryClassifier/RetryBudget/RetryExecutor 新增：属错误处理体系化重设计
- **dist staleness / 端口漂移**（A-009）：与 packaged 强耦合
- **r-server 大文件 26+ 端点拆分**（A-002 / A-005 routes/result-studio.js 1800 行 + routes/harness.js 1366 行）：单工作包 BLOCK-10 候选
- **SSE 三处协议细节统一**（Mi-002 / Mi-003 / Mi-004）：与 SSE keepalive（PR-004）捆绑推后

**为什么不外推**：以上推迟项要么需要新增依赖（zod/Ajv）、要么需要跨多进程架构改动、要么属 G1+ 阶段纪律；当前 G0 已收口的开发态 + packaged 实机核对是当前阶段最高证据等级。

---

## 2. 唯一真理链（Code Truth Anchors）

> 表格约定：**行号**格式 `startLine:endLine`，文件路径绝对。Agent 后续修复必须 1-click 跳到具体代码位置。

### 2.1 Critical（11 项）

| ID | 报告 / 行 | 标题 | 核心代码位置 | 关联发现（同根） |
|----|----------|------|---------------|-----------------|
| **C-001** | contract §二 L49-174 | branch/result IPC bridge 在 preload.js 完全未暴露 → renderer 路径全部走 stub | `src/preload.js:61-293`（**缺失 branch + result namespace**） / `frontend/src/lib/branchBridge.ts:21-65` / `frontend/src/lib/resultBridge.ts:55-81` / `src/ipc/branch-handlers.js:36-180`（11 个 handler） / `src/ipc/result-handlers.js:47-283`（9 个 handler） / `frontend/src/lib/electron.d.ts:319-505` | AAE-03（同根） |
| **C-002** | contract §二 L176-246 | result:create 拒绝 conversation_export 类型，但 d.ts 声明合法 | `frontend/src/lib/electron.d.ts:356-357` / `frontend/src/types/result.types.ts:12` / `src/ipc/result-handlers.js:59-62` (validTypes 缺 conversation_export) / `src/ipc/result-handlers.js:283-352` (createFromConversation 实际用 'text') | — |
| **S-001** | security §2 L41-99 | 插件 run_tool + workspace_exec capability 边界空缺 → 等效 RCE | `core/r-server/agent-tools/agent-tool-policy.js:47-66,113-115` / `core/r-server/mcp/registry.js:1359-1363` / `core/r-server/agent-tools/workspace-tools.js:606-727` | — |
| **E-017** | error §三 L477-494 | Backend procs exit handler 不推送 IPC status 事件 | `src/main/backend-proc-manager.js`（**4 个 proc exit handler 只 console.log + null**，无 `webContents.send('backend:status', down)`） | **PR-006** 同根 / OB-005 关联 |
| **E-018** | error §三 L496-506 | rServerSupervisor 自动重启无 IPC 通知 + DB/HTTP 句柄未刷新 | `src/main/backend-proc-manager.js`（rServerSupervisor 段 `scheduleRestart`） / `src/owned-backend-supervisor.js` | **PR-005** 关联 |
| **OB-001** | observ §三 L331-350 | console.* : logger.* 比例 5.1:1，关键路径全 console-only | `core/r-server/mcp/registry.js:1-1807`（28 console / 0 logger）/ `core/r-server/helpers/tools-executor.js`（32 / 0）/ `core/r-server/server.js:1-200`（17 / 0）/ `src/main/backend-proc-manager.js:1-443`（33 / 0）/ `core/gateway/server.js`（14 / 0）/ `src/main.js:1-1200`（28 / 0） | A-004 同根 |
| **OB-002** | observ §三 L352-371 | IPC 跨进程 trace 不贯穿，preload 不传 rid | `src/preload.js:1-1000`（IPC 透传无 rid）/ `src/main.js`（IPC handler 无 rid 注入）/ `src/main/backend-proc-manager.js`（spawn child 不传 BIOF3_RID） | — |
| **OB-003** | observ §四 L373-399 | 无 IPC handler / 后端重启 / SQLite 延迟指标，metrics 端点缺失 | `src/main.js`（85 个 ipcMain.handle 全部无 inc()） / `src/owned-backend-supervisor.js`（重启次数不暴露） / `core/r-server/db.js:1-2133`（SQLite query 无 timer） | — |
| **PL-001** | plugin §三 L129-189 | MCP callTool 入口缺 inputSchema 校验 | `core/r-server/plugin-loader.js:376-389`（`_inputsToInputSchema` 只生成不验证） / `core/r-server/mcp/registry.js:1677-1788`（callTool 入口无 validator） / `core/r-server/mcp/registry.js:1052-1165`（`_runPluginScript` 直接 JSON.stringify 进 params.json） | — |
| **PR-001** | perf §三 L103-138 | SQLite append-only 表无归档 / cleanup 任务 | `core/r-server/agent-task-store.js:198-220`（task_events）/ `core/r-server/helpers/conversations.js:34-43`（copilot_messages）/ `core/r-server/db.js:103-167`（loop_iterations/loop_actions/loop_evidence）/ `src/migrations/005_branch_conversation.sql:35-42`（messages）/ `src/migrations/006_result_studio.sql:14-26`（result_versions） | — |
| **C-001-rserver** | rserver-http §五 L456-462 | `/api/run` 与 `/api/replot/run` 双重拦截，错误体被 moduleGate 抢答 | `core/r-server/routes/r-compute.js:48,65` / `core/r-server/bootstrap.js:62`（moduleGate 顺序错位） | — |

> **注意**：rserver-http 报告与 contract 报告都用了 C-001 编号。本计划用 **C-001** 指 IPC bridge（contract 报告），**C-001-rserver** 指 r-server HTTP 双重拦截（rserver-http 报告）以避免歧义。

### 2.2 High / Major 收口项（14 项）

| ID | 报告 / 行 | 标题 | 核心代码位置 |
|----|----------|------|---------------|
| **S-002** | security §2 L100-138 | Result Studio contextToken 显式 token 过期也获胜 | `core/r-server/agent-tools/result-context-binding.js:65-81` |
| **S-003** | security §2 L140-181 | inferExecutionPolicy 用自然语言正则推断执行许可 | `core/r-server/helpers/agent-execution-policy.js:1-23` |
| **S-004** | security §2 L183-227 | 分支对话与结果 IPC 缺少 sender 守门 | `src/ipc/branch-handlers.js:36-271` / `src/ipc/result-handlers.js:47-...` / `src/ipc/ai-settings.js:29-84` / `src/ipc/plugin.js:23-107`（全部无 `event.sender === mainWindow.webContents` 校验） |
| **S-005** | security §2 L229-281 | workspace_exec 命令阻断基于关键字黑名单 | `core/r-server/agent-tools/workspace-tools.js:606-727` |
| **S-006** | security §2 L283-342 | agent-task-store retry_stats 单例 + user_id 可空 | `core/r-server/agent-task-store.js:60-99,181-206` |
| **S-007** | security §2 L344-379 | 诊断日志导出可写任意目录 | `src/ipc/diagnostic.js:22-136` |
| **E-019** | error §三 L508-529 | r-server 内 SQLite 共享 db 但两 connection，busy_timeout 不一致 | `core/r-server/agent-task-store.js:177-179`（5000ms） vs `core/r-server/db.js:18-32`（10000ms） |
| **C-002-rserver** | rserver-http §五 L464-472 | /api/result-studio/interaction 在 Revision 不匹配返回 HTTP 200 + {error} | `core/r-server/routes/result-studio.js`（`/api/result-studio/interaction` 路由） |
| **M-001** | rserver-http §六 L474-480 | /api/ai/admin/* 9 端点鉴权后置（_requireAdmin 非 middleware） | `core/r-server/routes/ai-admin.js:25` + 9 个 handler 第一行 `if (!_requireAdmin(req,res)) return;` |
| **M-003** | rserver-http §六 L490-496 | /api/feedback 公开端点缺 origin check | `core/r-server/routes/feedback.js:73` |
| **OB-004** | observ §六 L401-422 | error-log.js 默认路径不可写，调用点 2 处，dedupe 缺失 | `core/shared-backend/error-log.js:10` + 仅 `core/r-server/server.js:75,78` 调用 |
| **OB-005** | observ §六 L424-443 | Health 端点 shape 不一致，liveness/readiness 未分离 | `core/r-server/server.js:152` / `core/r-server/routes/ai-misc.js:14` / `core/py-server/server.js:163` / `core/gateway/server.js:96,120` |
| **PR-006** | perf §四 L269-291 | 4 个 backend 子进程 exit handler 仅 console.log + null 引用 | `src/main/backend-proc-manager.js`（4 个 proc.on('exit', ...)） |
| **PR-012** | perf §四 L488-521 | desktop main 进程 branch-db + result-db 同时打开 biof3.db（与 r-server 进程共享文件） | `src/database/branch-db.js:18-49` / `src/database/result-db.js:23-54` |

### 2.3 同根关联显式识别（修复时必须合并）

| 同根组 | 涉及 ID | 合并原因 | 合并修复位置 |
|--------|---------|----------|--------------|
| **backend exit handler** | **E-017 + PR-006 + OB-005** | 三份独立审计对同一文件同一 bug 各自定位 | 统一在 `src/main/backend-proc-manager.js` 抽 `safeProcExit(name, code)` helper，调 `webContents.send('backend:status', {name, status: 'down', code, reason})` + `logError` + `metrics.inc('backend.exit')` |
| **SQLite 双 connection + busy_timeout 不一致** | **E-019 + PR-011 + PR-012 + A-007** | 同一组文件 4 份审计 | 抽 `core/shared-backend/db-config.js` 统一 `BUSY_TIMEOUT_MS = 10000` + WAL；agent-task-store + branch-db + result-db 都 require |
| **rServerSupervisor 重启** | **E-018 + PR-005** | restart 链路缺 IPC 通知 | 在 `src/owned-backend-supervisor.js` `scheduleRestart()` 内 emit `backend:status {status: 'restarting'}` + 记录 `metrics.inc('backend.restart')` |
| **IPC sender 守门缺失** | **S-004 + BLOCK-3/4/5 既有 sender 守门** | BLOCK-3 已建立 helper，可复用 | 抽 `assertTrustedSender(event)` 到 `src/ipc/_sender-guard.js`，branch/result/ai-settings/plugin/telemetry/feedback/terminal 等 handler 内首行调用（参考 `src/main.js:604` 的 AGENT_WORKBENCH_FLAG_CHANNEL 模式） |
| **branch/result IPC bridge** | **C-001 + AAE-03** | bridge namespace 缺失 | `src/preload.js` 添加 `branch` + `result` 两个 namespace，1:1 映射 `electron.d.ts` 的 20+ 方法到 `ipcRenderer.invoke('branch:create', ...)` |
| **error-log 路径不可写 + logError 仅 2 处** | **OB-004 + AAE-05** | logError 全 codebase 仅 2 处调用 | 改默认路径为 `path.join(BIOF3_LOCAL_DATA_DIR, 'logs', 'errors.log')` + 渐进式把 r-server/routes/ + r-server/agent-tools/ 的 `console.error` 桥接到 `logError` |
| **result-studio interaction HTTP 200** | **C-002-rserver + C-002 contract（不同维度）** | contract 报告 C-002 是 IPC 类型校验，rserver-http 报告 C-002 是 HTTP 状态码，两份独立 | 分别修复：contract C-002 改 `validTypes`；rserver-http C-002 改 `res.status(409).json({...})` |

### 2.4 已收口工作包不重复修复（BLOCK-3/4/5/9/9.1/9.2 边界）

| BLOCK | 已修内容 | 本工作包禁止触碰 |
|-------|----------|------------------|
| BLOCK-3 | IPC sender 守门 helper（**仅 setupSkillsIpc + setupWindowIpc + setupAgentWorkbenchFlagsIpc**） | ✅ 不重写 sender helper；只复用扩到 branch/result/ai-settings/plugin/telemetry |
| BLOCK-4 | IPC 收尾（poller 9→4 + _publishSkillProgress try/catch） | ✅ 不动 skills IPC / poller 逻辑 |
| BLOCK-5 | IPC 最终收口（channel 字面量统一） | ✅ 不动 IPC channel 字面量 |
| BLOCK-9 | 前端 _data.ts 2157→3 文件 + buildPreviewTable 抽 lib/ + project-workspace 拆 helpers | ✅ 不动 _data.ts / project-workspace.tsx |
| BLOCK-9.1 | main.js 2450→1066（-56.5%）+ setupXxx 18 个全部抽出 | ✅ 不动 main.js 剩余 5 个不拆函数 + 已拆出 11 个 setup* |
| BLOCK-9.2 | 5 mega file 拆分（DesktopSettingsPanel / ResultView / plugin-manager / SimpleChat / useSkillStore） | ✅ 不动 DesktopSettingsPanel/ 目录 + ResultView/* + plugin/* |

---

## 3. 修复边界分类

### 3.1 P0 用户可见（必须本工作包收口）

| ID | 用户可见症状 | 当前阶段边界 |
|----|--------------|--------------|
| **C-002**（contract 报告） | renderer 调用 `resultApi.create({type: 'conversation_export'})` 立即被 IPC 拒；与 d.ts union 声明冲突 | dev Electron + packaged 边界内 verified |
| **C-001**（contract 报告） | 用户打开 Branch Tab / Result Studio → 调用抛 "Branch bridge not available" / "Result bridge not available" | dev Electron + packaged 边界内 verified |

### 3.2 P1 安全/资源（建议本工作包收口）

| ID | 严重度 | 修复方向 |
|----|--------|----------|
| **S-001** RCE capability 边界 | Critical | agent-tool-policy 加 `allowedDownstream` 概念；plugin 内部 shell 命令再过 `commandVerdict` |
| **S-002** contextToken fail-closed 复活 | High | bind 时校验 (jobId, name, revisionId) 三元组 |
| **S-003** inferExecutionPolicy 自然语言 | High | 改为前端 chat-mode UI 显式传 accessMode；删自然语言正则 |
| **S-004** IPC sender 守门 | High | 复用 BLOCK-3 helper 扩到 branch/result/ai-settings/plugin/telemetry |
| **S-005** workspace_exec 黑名单 | High | 改白名单 + capability tokens；或迁 firejail/bwrap 沙箱 |
| **S-006** retry_stats 单例 + user_id 可空 | High | retryStats 按 task_id 隔离；tasks.user_id NOT NULL |
| **S-007** diagnostic:export 任意路径写入 | High | targetPath 改 null；主进程 dialog.showSaveDialog 强制选 |
| **PR-001** SQLite append-only 无归档 | Critical | 加 retention sweeper 每天扫；result_versions max 50 |
| **PR-006** backend exit handler 无 IPC 事件 | Major | 抽 safeProcExit helper，调 webContents.send + logError + metrics |
| **E-017** backend exit handler 不推送 IPC status | Critical | 同 PR-006 合并修复 |
| **E-018** rServerSupervisor 重启无通知 | Critical | 在 scheduleRestart emit `backend:status {status: 'restarting'}` |
| **E-019** SQLite 双 connection busy_timeout | Major | 抽 db-config 共享常量 |

### 3.3 P2 契约/桥（可独立 BLOCK）

| ID | 修复方向 |
|----|----------|
| **C-001**（contract）IPC bridge namespace 缺失 | preload.js 加 branch + result namespace |
| **PL-001** MCP callTool inputSchema 校验 | callTool 入口加 Ajv 校验（**不引入 ajv**；用项目内已有或自写极简 validator） |

### 3.4 P3 内部债（推到下一工作包）

| 类别 | ID | 推迟原因 |
|------|----|---------|
| 架构拆分 | A-001 agent-runner.js / A-002 routes/result-studio.js / A-005 routes/harness.js / A-006 56+ singleton | 单工作包 BLOCK-10 候选；本工作包不动 |
| 可观测性体系化 | OB-001 console→logger 全量 / OB-002 IPC trace 全贯穿 / OB-003 metrics 端点 / OB-007 unhandledRejection 跨进程 | observability-work-package 候选 |
| SSE 全局 | PR-004 SSE keepalive + Mi-002/Mi-003/Mi-004 三处协议统一 | SSE 体系化单独工作包 |
| 错误处理体系化 | E-009 三套重试合并 / E-011 retry worker / E-022 取消语义矩阵 | 单独工作包 |
| 数据库体系化 | A-007 branch-db/result-db 重复基础设施 / PR-027 大表 OFFSET 分页 | DB 单独工作包 |
| Agent Loop 体系化 | C-012 事件类型命名 / C-013 Provider 重试分散 | Agent Loop 体系化单独工作包 |
| d.ts / 类型一致性 | C-010 result.types.ts 注释与 d.ts 不一致 / C-011 skill_execute schema additionalProperties | 渐进修正 |
| 安全 medium/low | S-008 PTY shell 白名单 / S-009 redact 覆盖不全 / S-010 plugin 参数消毒 / S-011-S-018 | 推到 security-debt-pack |
| r-server HTTP 其他 major | C-001-rserver moduleGate 顺序 / M-004 loop/iterate schema 误导 / M-005 settings/test 错误体 / M-006 harness 内部错误体 / M-007 quota Infinity / M-008 auth/me success 缺 ok | rserver-http-debt-pack 候选 |

---

## 4. PHASE 划分（4 个 PHASE）

### PHASE 0：唯一真理链核对（**已收口**，本计划文档产出）

- **范围**：8 份审计报告全部读完 / 提取 90+ finding ID / 锚定代码位置 / 识别 7 组同根关联 / 列出 11 组不重复边界
- **涉及文件**：8 份审计 + 本计划 + `docs/branch-data-model.md`（仅引用）
- **验证**：0 行代码改动 / 主 agent 后续按本计划 §2 锚点直接修复
- **commit 边界**：本计划文件单独 commit `docs/code-audit-closeout-plan.md`（v0.1）

### PHASE 1：P0 用户可见 + 关键 IPC bridge（C-001 + C-002 + C-001-rserver）

**目标**：用户打开 Result Studio 不再抛 "bridge not available"；`result:create` 支持 `conversation_export`；`/api/result-studio/interaction` 错误码语义对齐。

**涉及文件**：
- `src/preload.js:61-293` — 加 `branch` + `result` namespace（**精确按 `electron.d.ts:319-505` 的 20+ 方法 1:1 暴露**）
- `src/ipc/result-handlers.js:47-62` — `validTypes` 数组追加 `'conversation_export'`
- `src/ipc/result-handlers.js:283-352` — `createFromConversation` 同步把 `'text'` 改为 `'conversation_export'`（与 d.ts union 对齐）
- `frontend/src/types/result.types.ts:12` — 保留 union（含 conversation_export）
- `frontend/src/lib/electron.d.ts:356-357` — union 不变
- `core/r-server/routes/result-studio.js` `/api/result-studio/interaction` — `res.json({error})` 改为 `res.status(409).json({error, details: {revisionId, artifactId}})`
- `core/r-server/routes/r-compute.js:48,65` — `/api/run` 与 `/api/replot/run` 410 在 moduleGate 前 early-return（或 bootstrap.js moduleGate 对此两路径豁免）

**验证矩阵**：
- `cd frontend && npx tsc --noEmit` — 0 error
- `npm run docs:check` — 注册文档数 PASS
- `npm run ui:audit:check` — UI ID 数 PASS
- focused 测试：`frontend/src/lib/branchBridge.ts` + `frontend/src/lib/resultBridge.ts` 单测（无现有测则新增）
- focused 测试：`src/ipc/result-handlers.js` 单测（validTypes 含 conversation_export）
- focused 测试：`core/r-server/routes/result-studio.js` 单测（interaction 409）
- dev Electron 边界内 verify：`BranchTabsWrapper.tsx` 真实发 list 调用能拿到 branches；`ResultStudioPage.tsx` 真实 create result conversation_export 类型成功

**commit 边界**：1 个 commit / `chore(block-10-audit-closeout): PHASE 1 IPC bridge + result type + rserver 410`（不拆 commit）

### PHASE 2：P1 安全/资源（S-001..S-007 + PR-001 + PR-006 + E-017 + E-018 + E-019 + OB-004 + OB-005）

**目标**：所有 RCE 边界、contextToken fail-closed、execution policy、sender 守门、command 黑名单、retry 单例、diagnostic 路径、SQLite 归档、backend exit、SQLite busy_timeout、error-log 路径全部收口。

**涉及文件**：
- `core/r-server/agent-tools/agent-tool-policy.js:47-66,113-115` — 加 allowedDownstream 概念
- `core/r-server/agent-tools/result-context-binding.js:65-81` — bind 时校验三元组
- `core/r-server/helpers/agent-execution-policy.js:1-23` — 删自然语言正则，改前端 accessMode 透传
- `src/ipc/_sender-guard.js`（**新文件**）— 抽 `assertTrustedSender(event)` helper（参考 BLOCK-3 模式）
- `src/ipc/branch-handlers.js:36-271` + `src/ipc/result-handlers.js:47-...` + `src/ipc/ai-settings.js:29-84` + `src/ipc/plugin.js:23-107` — 每个 handler 首行调 `assertTrustedSender(event)`
- `core/r-server/agent-tools/workspace-tools.js:606-727` — commandVerdict 改 capability tokens 白名单
- `core/r-server/agent-task-store.js:60-99,181-206` — retryStats 按 task_id 隔离；tasks.user_id NOT NULL
- `src/ipc/diagnostic.js:22-136` — targetPath 改 null，dialog.showSaveDialog
- `core/r-server/jobs/retention-sweeper.js`（**新文件**）— 每天扫 task_events / copilot_messages / loop_iterations / messages；result_versions max 50
- `src/main/backend-proc-manager.js` — 抽 `safeProcExit(name, code)` helper；4 个 proc.on('exit') 全部走 helper
- `src/owned-backend-supervisor.js` — `scheduleRestart()` emit `backend:status {status: 'restarting'}` + metrics
- `core/shared-backend/db-config.js`（**新文件**）— 统一 `BUSY_TIMEOUT_MS = 10000` + WAL
- `core/r-server/agent-task-store.js:177-179` — 改为 `require('../shared-backend/db-config').BUSY_TIMEOUT_MS`
- `src/database/branch-db.js:18-49` + `src/database/result-db.js:23-54` — 同样 require db-config
- `core/shared-backend/error-log.js:10` — 默认路径改 `path.join(BIOF3_LOCAL_DATA_DIR, 'logs', 'errors.log')`
- `core/r-server/server.js:75,78` — 扩 `logError` 调用到 unhandledRejection / uncaughtException 之外的关键路径（r-server/routes + r-server/agent-tools 渐进）
- `core/shared-backend/health.js`（**新文件**）— 抽 `/api/live` + `/api/ready` + `/api/health` 三层
- 4 个 health 端点（r-server / py-server / gateway / ai-misc）— 改用 shared-backend/health.js 统一

**验证矩阵**：
- `cd frontend && npx tsc --noEmit` — 0 error
- `npm run docs:check` — 注册文档数 PASS
- `npm run ui:audit:check` — UI ID 数 PASS
- focused 测试：
  - `core/r-server/agent-tools/agent-tool-policy.test.js`（新增）— capability 边界
  - `core/r-server/agent-tools/result-context-binding.test.js`（新增）— 三元组校验
  - `core/r-server/helpers/agent-execution-policy.test.js`（新增）— 不依赖消息文本
  - `src/ipc/_sender-guard.test.js`（新增）— sender 守门 helper
  - `core/r-server/agent-tools/workspace-tools.test.js` — commandVerdict 白名单
  - `core/r-server/agent-task-store.test.js`（新增）— retryStats 隔离 + user_id NOT NULL
  - `src/ipc/diagnostic.test.js`（新增）— targetPath null
  - `core/r-server/jobs/retention-sweeper.test.js`（新增）— retention 逻辑
  - `src/main/backend-proc-manager.test.js`（新增）— safeProcExit + IPC send
  - `src/owned-backend-supervisor.test.js`（新增）— restart IPC 通知
  - `core/shared-backend/db-config.test.js`（新增）— busy_timeout 统一
  - `core/shared-backend/error-log.test.js`（扩）— 默认路径 + dedupe
  - `core/shared-backend/health.test.js`（新增）— live/ready/health 三层
- dev Electron 边界内 verify：所有 IPC handler 在合法 sender 路径正常工作；非法 sender（mock ipcRenderer from devtools）被拒
- 不变量守住：`src/preload.js` 顶层 namespace 不动（仅新增 branch + result）；`frontend/src/lib/electron.d.ts` 不动（仅 PHASE 1 触及）；`frontend/src/lib/desktopBridge.ts` 不动

**commit 边界**：建议 4 个 commit：
1. `fix(block-10-audit-closeout): capability + contextToken + execPolicy`（S-001 + S-002 + S-003）
2. `fix(block-10-audit-closeout): sender guard + workspace_exec + retry_stats + diagnostic`（S-004 + S-005 + S-006 + S-007）
3. `chore(block-10-audit-closeout): SQLite retention + backend exit + supervisor restart + db-config`（PR-001 + PR-006 + E-017 + E-018 + E-019）
4. `fix(block-10-audit-closeout): error-log path + health shape`（OB-004 + OB-005）

### PHASE 3：P2 契约（PL-001）

**目标**：MCP callTool 入口增加 inputSchema 校验，防止 prompt 注入构造超界数值。

**涉及文件**：
- `core/r-server/plugin-loader.js:376-389` — `_inputsToInputSchema` 暴露为 `getInputSchema(toolId)`
- `core/r-server/mcp/registry.js:1677-1788` — `callTool` 入口在进 `_runPluginScript` 前调 `_validateToolArgs(name, args)`
- `core/r-server/mcp/registry.js` 新增 `_validateToolArgs` — **不引入 ajv**；写极简 validator（检查 required / type / minimum / maximum / enum，按 plugin-loader.js 已生成 schema 逐字段验证）

**验证矩阵**：
- `cd frontend && npx tsc --noEmit` — 0 error
- `npm run docs:check` — 注册文档数 PASS
- focused 测试：
  - `core/r-server/mcp/registry.test.js`（扩）— 10 个工具插件各 1 个 schema violation 用例（`padj_cutoff=-10` / `lfc_cutoff=1e9` / `soft_power=-1` 等）
  - `core/r-server/plugin-loader.test.js`（扩）— getInputSchema 暴露
- dev Electron 边界内 verify：通过 copilot chat 触发任意 1 个 tool call，超界数值被拒；正常数值通过

**commit 边界**：1 个 commit / `fix(block-10-audit-closeout): MCP callTool inputSchema validation`

### PHASE 4：audit + closeout

**目标**：4 canonical 文档同步 + DOC-REGISTRY 登记 + ui-productization-audit 增 entries + closeout 报告。

**涉及文件**：
- `docs/DOC-REGISTRY.json` — 新增 active 工作包 `BLOCK-10-AUDIT-CLOSEOUT`（PHASE 1 启动时）+ 收口后 `status: active → completed` + 5 linkedCommits
- `docs/next-steps-roadmap.md` — launch entry + closeout entry
- `docs/project-workspace-handoff.md` — launch entry + closeout entry
- `docs/AUDIT-LOG.md` — PHASE 1..4 收口 entry + closeout entry（**主 agent 登记，不在子 agent 工作范围**）
- `docs/ui-productization-audit.md` — 增 UI-176..UI-180 5 个 entry
- `docs/block-10-audit-closeout.md` — closeout 报告（11 节，与 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 模板一致）

**验证矩阵**：
- `npm run docs:check` GREEN
- `npm run docs:reconcile` GREEN
- `npm run ui:audit:check` GREEN（新增 UI ID 后）
- chf0-critical 3 测试 PASS（IPC contract 兼容性）
- 4 治理门 GREEN（docs:check / ui:audit:check / tsc --noEmit / docs:reconcile）

**commit 边界**：4 canonical 文档同步可以分 2-3 个 commit；closeout 报告单独 commit

---

## 5. 不外推清单（G0 阶段纪律 + 边界守卫）

### 5.1 不外推（G1+ 阶段事项，按 AGENTS.md 当前阶段纪律）

- ❌ 不启动 / 不建议 / 不评估 packaged Electron 公证
- ❌ 不启动 Provider 矩阵（真实 Provider 不在 G0 范围）
- ❌ 不启动 GA / release-pipeline
- ❌ 不启动 P7 Honest Product Requalification
- ❌ 不评估 dist staleness（与 packaged 强耦合）
- ❌ 不评估 notarization
- ❌ 不评估 UI-P7-RS（Result Studio P7 继续 deferred）
- ❌ 不写"`qualificationEligible` 维持 false" / "未做 Provider" / "未做 GA" 类未做项列表 —— 按 AGENTS.md §4 "不列举未做项"

### 5.2 不重启（已收口工作包）

- ❌ 不重新激活 BLOCK-2 / BLOCK-3 / BLOCK-4 / BLOCK-5 / BLOCK-6 / BLOCK-7 / BLOCK-8 / BLOCK-9 / BLOCK-9.1 / BLOCK-9.2
- ❌ 不修改 BLOCK-3 已建立的 sender 守门 helper（**复用**而非重写）
- ❌ 不修改 BLOCK-5 已统一的 IPC channel 字面量
- ❌ 不修改 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 已拆分的 _data.ts / main.js / DesktopSettingsPanel/ResultView/plugin-manager/SimpleChat/useSkillStore

### 5.3 不破坏（不变量守住）

- ❌ 不修改 `src/preload.js` 顶层 16 个 namespace 任何 key 名（PHASE 1 仅**新增** `branch` + `result` 两个 namespace，**不改任何已有**）
- ❌ 不修改 `frontend/src/lib/electron.d.ts` 任何已有声明（PHASE 1 触及的 `ResultType` union 仅在 contract 报告明确为"应修复"的 C-002 范围内）
- ❌ 不修改 `frontend/src/lib/desktopBridge.ts` 任何已有导出
- ❌ 不修改 `docs/senior-engineer-review-2026-08-16.md` 评审报告
- ❌ 不修改 8 份审计报告（仅 Read + 本计划引用）
- ❌ 不修改 `agent-tools/*` / `agent-transcripts/*`（历史抹底产物）
- ❌ 不修改 `docs/block-9-2-mega-file-split-survey.md`（已收口，仅 Read）

### 5.4 不引入（新依赖）

- ❌ 不引入 `ajv` — PL-001 写极简 validator（按 schema 字段 required/type/minimum/maximum/enum 逐字段校验）
- ❌ 不引入 `zod` / `joi` / `prom-client` / `opentelemetry` / `lru-cache` / `simple-git`
- ❌ 不引入新 npm 依赖（PHASE 1-3 所有改动纯 Node / TypeScript / Express 自有 API）
- ❌ 不引入新的 React 组件库 / CSS 框架

### 5.5 不改业务行为（G0 阶段 G0 边界内）

- ❌ 不修改 provider fallback 策略
- ❌ 不修改 Result Studio 业务逻辑
- ❌ 不修改 agent loop 状态机
- ❌ 不修改 SQLite schema（PR-001 retention 不 DROP / ALTER 列，只 DELETE 旧行）
- ❌ 不修改 Result Studio contextToken 算法（S-002 仅修"显式 token 三元组校验"，不动 happy-path）

---

## 6. 验证矩阵（4 治理门 + focused tests + dev Electron 边界内 verify）

### 6.1 4 治理门（每次 PHASE 收口必跑）

| 命令 | 期望 | 阻断 |
|------|------|------|
| `npm run docs:check` | 注册文档数 PASS | 是 |
| `npm run ui:audit:check` | UI ID 数 PASS | 是 |
| `cd frontend && npx tsc --noEmit` | 0 error | 是 |
| `npm run docs:reconcile` | 0 drift | 是 |

### 6.2 默认不跑（按 AGENTS.md 测试范围纪律）

| 命令 | 期望 | 何时跑 |
|------|------|--------|
| `npm run check` | 全量静态检查通过 | PHASE 4 closeout 前（一次性） |
| `npm run test:all:workspace` | 1300+ 项全 PASS | PHASE 4 closeout 前（一次性） |
| `npm run g0:result-studio:p3` | Result Studio P3 专项门禁 | 仅在触及 Result Studio 时跑 |

### 6.3 focused tests（按 `test/impact-map.json` + 实际变更文件定向）

```
node --test \
  core/r-server/agent-tools/agent-tool-policy.test.js \
  core/r-server/agent-tools/result-context-binding.test.js \
  core/r-server/helpers/agent-execution-policy.test.js \
  core/r-server/agent-tools/workspace-tools.test.js \
  core/r-server/agent-task-store.test.js \
  core/r-server/jobs/retention-sweeper.test.js \
  core/shared-backend/db-config.test.js \
  core/shared-backend/error-log.test.js \
  core/shared-backend/health.test.js \
  core/r-server/mcp/registry.test.js \
  core/r-server/plugin-loader.test.js \
  src/ipc/_sender-guard.test.js \
  src/ipc/diagnostic.test.js \
  src/main/backend-proc-manager.test.js \
  src/owned-backend-supervisor.test.js

cd frontend && npm run test:files -- \
  src/lib/branchBridge.test.ts \
  src/lib/resultBridge.test.ts \
  src/hooks/useAiSettings.test.ts
```

### 6.4 dev Electron 边界内 verify（手工 + Playwright MCP 可选）

- **PHASE 1**：dev Electron 启动 → 打开 Result Studio → 真实发 create conversation_export → 成功；打开 Branch Tab → 真实 list branches → 拿到 branches 数组
- **PHASE 2**：dev Electron 启动 → 模拟非法 sender（DevTools 注入 `window.biof3Desktop.branch.create`）→ 被拒；触发 workspace_exec 黑名单命令 → 被拒
- **PHASE 3**：dev Electron 启动 → 触发任意 tool call，构造 `padj_cutoff=-10` → 被拒
- **PHASE 4**：closeout 报告 11 节齐全 + DOC-REGISTRY active→completed + linkedCommits

### 6.5 兼容性测试（chf0-critical + vitest）

- chf0-critical 3 测试 33 项 PASS（**plugin IPC contract**）
- vitest 75 文件 630 tests PASS（仅改新文件 / 改动文件相关测试，**不动其他测试**）

---

## 7. 风险登记

| # | 修复点 | 风险类型 | 风险描述 | 缓解策略 |
|---|--------|----------|----------|----------|
| 1 | **C-001 preload.js 加 branch/result namespace** | 破 IPC 契约 | 加 namespace 后 ipcRenderer.invoke channel 名错误 → renderer 调用全失败 | 1:1 复用 `electron.d.ts` 已声明的 20+ 方法名；PHASE 1 验证 dev Electron 真机 list branches/create result |
| 2 | **S-004 sender 守门扩到 branch/result/ai-settings/plugin/telemetry** | 性能回退 | 每个 IPC handler 首行多一次 `event.sender ===` 比较 | sender helper 内单行 `===`，开销 < 1µs；chf0-critical 不退化 |
| 3 | **S-005 workspace_exec 白名单** | 兼容性 | 现有 chat 走 `workspace_exec` 的 R 脚本若用 bash 内置特性会被新白名单拒 | **渐进**：先保留黑名单 + 加 capability tokens 标记；下个工作包再删黑名单 |
| 4 | **PR-001 retention sweeper** | 数据丢失 | 误删用户早期 chat / agent run | 仅删 `>30 day` + 非 active 的；保留 `tasks.status='running'` 不删；CHANGELOG 文档化 |
| 5 | **E-017/PR-006 backend exit handler 改 IPC 推送** | 测试 flaky | IPC 推送时 webContents 可能 destroyed | helper 内 `isDestroyed()` precheck + try/catch（参考 PR-022 既有模式） |
| 6 | **E-019/PR-011 SQLite busy_timeout 统一到 10000ms** | 性能回退 | 长 lock wait 时全部 connection 等 10s | 短 timeout 调用的查询先重试 1 次；保留现有 `try/catch (e) { if (e.code === 'SQLITE_BUSY') retry }` 路径 |
| 7 | **OB-002 IPC trace 贯穿** | 性能回退 | preload 注入 rid + main handler 透传 + spawn child env 注入 → 每条 IPC 多 3 次 UUID 生成 | rid 用 `crypto.randomUUID().slice(0,12)`（与现有 `bootstrap.js:15-20` 一致），开销 < 5µs |
| 8 | **OB-004 error-log 默认路径改 local-data** | 路径兼容 | 既有 `/var/log/biof3-errors.log` 用户设置失效 | env 优先级 `BIOF3_ERROR_LOG_FILE` > 默认 local-data；保留 env 文档化 |
| 9 | **PL-001 MCP callTool schema 校验** | 兼容性 | 现有 chat 调用若传了 schema 不允许但实现宽容的字段（如 message_append 的 metadata）会被拒 | **渐进**：先 required + type 校验；minimum/maximum/enum 加 warning log 而非 reject；下个工作包严格化 |
| 10 | **S-001 capability allowedDownstream 概念** | 架构复杂度 | 新增概念 + agent-tool-policy 重写 | **最小修改**：在 `effectiveOperation` 加 `allowedDownstream` 默认空数组；plugin → shell 的链路加单行 `if (!allowedDownstream.includes('shell')) return deny(...)` |
| 11 | **S-002 contextToken 三元组校验** | 数据流断 | 客户端不传 (jobId, name, revisionId) → 大量原本成功的 result_changeset_adopt_in_context 被拒 | 仅校验"过期 + 不匹配"组合；token 过期单独已返回 `context_token_stale`；不增加新错误码 |
| 12 | **PHASE 2 4 个 commit 合并风险** | commit 粒度 | 25 个修复单元拆 4 commit，单 commit 失败 → 大粒度回滚 | 每个 commit 内部独立测试；PHASE 2 收口后跑全量治理门 |

---

## 8. 下一块候选（本工作包收口后还剩什么）

### 8.1 架构层面（BLOCK-10-ARCHITECTURE 候选）

| 类别 | 涉及 ID | 工作量估计 |
|------|---------|------------|
| 18 个 >1000 行 mega file 拆分 | A-001 / A-002 / A-005 / A-007 / A-010 / A-011 | 4-5 天 |
| 56+ 模块级可变 singleton 收敛 | A-006 | 2-3 天 |
| DB singleton 统一 | A-007 + PR-011 + PR-012 + E-019（本工作包已收口大半，剩余 80%） | 1 天 |
| 跨层反向 require 修复 | A-003 | 0.5 天 |
| 4 处真 require 循环 | A-008 | 1 天 |
| test fixture / golden 数据维护 | A-012 | 0.5 天 |

### 8.2 安全 P2（SECURITY-DEBT-PACK 候选）

| ID | 严重度 |
|----|--------|
| S-008 PTY 终端 session 无可执行文件白名单 | Medium |
| S-009 redactSensitiveText 凭据格式覆盖不全 | Medium |
| S-010 MCP registry _runPluginScript 缺命令级参数消毒 | Medium |
| S-011 workspace_replace oldText/newText 不限替换范围大小 | Medium |
| S-012 act-tool undo 30 秒窗口跨用户撤销 | Medium |
| S-013 branch-handlers.js 缺 input 字段类型校验 | Medium |
| S-014 Migration runner 不隔离运行 | Medium |
| S-015 _localRootFromEnv / _canonicalRootFromEnv 信任环境变量路径 | Medium |
| S-016 IPC handlers 错误信息回传泄露堆栈 / DB 内容 | Low |
| S-017 terminal:snapshot 暴露 PID / log 文件绝对路径 | Low |
| S-018 redactSensitiveValue WeakSet 防原型链 | Low |

### 8.3 可观测性全局（OBSERVABILITY-WORK-PACKAGE 候选）

| ID | 范围 |
|----|------|
| OB-001 console→logger 全量替换（319→62 收敛到 < 10） | 跨 core/r-server + src/ + core/gateway/ |
| OB-002 IPC trace 全贯穿（preload → main → backend） | 跨 src/preload + src/main + src/main/backend-proc + r-server bootstrap |
| OB-003 metrics 端点（/api/_internal/metrics + IPC 聚合） | 跨 r-server + main + frontend |
| OB-007 unhandledRejection 跨进程注册（py-server / gateway / main） | 跨 4 个进程 |
| OB-008 [mem-vec-err] 分类 + logger.error 替换 | core/shared-backend/errors.js 新增 |
| OB-009 main.log / gateway.log / plumber.log 文件化 | src/main + core/gateway |
| OB-010 perf-probe 默认开 + baseline 抓取 | core/r-server |
| OB-011 recovery_required metric | core/r-server |
| OB-012 _aiActiveStreams + circuit-breaker.getHealth 挂 health 端点 | core/r-server |
| OB-013 telemetry 决策链 + 隐私白名单 | 全 stack |

### 8.4 SSE 全局（SSE-GLOBAL-WORK-PACKAGE 候选）

| ID | 范围 |
|----|------|
| PR-004 SSE 5 端点 keepalive 心跳 | ai-chat / ai-agent 直连 / ai-agent 订阅 / tools-metadata / ai-conversations |
| Mi-002 /api/tools/stream/:id 缺事件命名/心跳/续传 | 协议对齐 |
| Mi-003 /api/ai/chat 心跳 event:ping vs SSE 注释行 | 协议对齐 |
| Mi-004 /api/ai/agent/task/:taskId 错误事件结构化 | 协议对齐 |
| C-012 8+ 种 event 类型命名规范化 | agent-runner |
| PR-008 SSE 订阅端点 500ms 轮询无指数退避 | ai-agent.js:1186-1216 |

### 8.5 错误处理体系化（ERROR-HANDLING-REFACTOR 候选）

| ID | 范围 |
|----|------|
| E-009 三套重试策略合并（model-gateway / agent-runner / agent-task-store） | retry-classifier / retry-budget / retry-executor 三件套 |
| E-010 agent-task-store RETRY_POLICY 字符串匹配 error.message | 改结构化 error_class |
| E-011 scheduleAgentTaskRetry 写库后无 worker | 加 worker consumer |
| E-013 SSE 错误事件后不触发 IPC 通知 | IPC 通知 + polling fallback |
| E-022 取消语义矩阵（user_cancelled vs controller_aborted vs hard_timeout） | tasks.error 写入 reason |

### 8.6 rserver-http debt pack

| ID | 范围 |
|----|------|
| C-001-rserver /api/run 双重拦截 | moduleGate 顺序修复 |
| C-002-rserver interaction HTTP 200 | 本工作包收口；不在此处 |
| M-002 /api/run 前端 caller 检查 | frontend grep 清理 |
| M-004 /api/loop/iterate schema 误导 | 缩窄入参 schema |
| M-005 /api/ai/settings/test 错误体双轨 | 统一错误体 |
| M-006 /api/harness/* + /api/loop/* 内部错误体不一致 | 文件级统一 |
| M-007 /api/data/quota Infinity → null | 语义明确化 |
| M-008 /api/auth/me success 缺 ok 字段 | 风格统一 |
| Mi-001 /api/data/projects/:id/g0-baseline vs /api/data/g0-baseline shape 差异 | shape 对齐 |
| Mi-005 getAuthHeader 接受 token 但不校验 | 文档化"无鉴权需求" |

### 8.7 G1+ 阶段事项（按 AGENTS.md 阶段纪律不外推）

- Provider 矩阵 / 公证 / GA / dist staleness / notarization / P7 / UI-P7-RS — 用户显式裁决启动才进入

---

## 9. 计划文档自我约束

- 本文件 v0.1 是只读调研产出（0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check / 0 跑 ui:audit:check）
- 主 agent 启动 active 工作包时，需：
  1. 把 v0.1 改为 v1.0（active 版本）
  2. 在 `docs/DOC-REGISTRY.json` 注册 `BLOCK-10-AUDIT-CLOSEOUT`
  3. 在 `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md` 加 launch entry
  4. 在 `docs/AUDIT-LOG.md` 加 launch entry
  5. 按 PHASE 1 → 2 → 3 → 4 顺序执行

---

**不变量**：本计划文件为 BLOCK-10-AUDIT-CLOSEOUT 工作包唯一调研阶段 plan，PHASE 1 启动后调整为 v1.0 active。8 份审计报告 + 本计划 + 关联 BLOCK-3/4/5/9/9.1/9.2 closeout 报告 = 完整证据链。
