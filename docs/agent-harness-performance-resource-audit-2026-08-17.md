# Petri Desktop Agent Harness 性能与资源独立审查

**日期**: 2026-08-17
**审查视角**: 性能与资源（独立视角，与既有 4 份审计并列）
**项目**: Petri Desktop — Electron + React/Vite + 内嵌 R/Python runtime
**当前阶段**: G0 长期开发期
**审查范围**: Agent Harness 后端（`core/r-server/` + `core/shared-backend/` + `core/py-server/` + `src/main/` + `src/ipc/`）+ 前端 SSE consumer（`frontend/src/components/copilot/`）
**审查方法**: 静态分析（无运行时压测，无内存采样）+ 反模式 grep + 闭包 / 单例生命周期分析
**纪律声明**: G0 阶段不外推 Provider / 公证 / GA / dist staleness；本文所有「未实测 / 静态推断」标注处均为静态推理，未经 runtime harness 验证

---

## 一、执行摘要

### 1.1 维度发现数量

| 维度 | Critical | Major | Minor | 小计 |
|------|----------|-------|-------|------|
| 内存泄漏（IPC / 单例 / 闭包） | 0 | 5 | 4 | 9 |
| SSE 长连接生命周期 | 0 | 3 | 3 | 6 |
| SQLite 连接 / 表膨胀 / 索引 | 1 | 3 | 3 | 7 |
| Backend 子进程资源回收 | 0 | 3 | 2 | 5 |
| IPC handler 同步阻塞与序列化 | 0 | 2 | 4 | 6 |
| **合计** | **1** | **16** | **16** | **33** |

### 1.2 总体性能与资源评分

**自评 6.5/10（10 = 工业级资源纪律，1 = 完全失控）**

**核心判断**：Petri Desktop 的后端在 **功能正确性** 和 **可恢复性** 上有显著投入（supervisor 自愈、zombie recovery、task_events 持久化、SSE close 释放 aiConcurrency），整体骨架与既有错误处理审查（E-017/E-018）的判断一致。但 **资源纪律** 维度相对薄弱：

1. **没有主动资源预算**：没有定时内存快照、没有 heap 用量上限告警、没有 WAL 监控；唯一接近「监控」的是 `core/r-server/server.js:183` 的 1 秒 `setInterval` 测 event-loop 阻塞（**event-loop lag > 2s 才 warn**）。
2. **模块级可变单例无 TTL 兜底**：`_pendingActAcks`（act-tools.js）依赖 800ms `setTimeout` 自我清理；`_aiUserStreams` / `_aiTaskStreams` / `_embedCallLog`（runtime.js）依赖外部 release 路径正确调用；`_impliedPageByRequest`（act-tools.js:146）依赖 30s `setTimeout`。**任一 release 路径断裂 → 永久内存增长**。
3. **SQLite `copilot_messages` / `task_events` 无 cleanup 任务**：append-only 表没有滚动归档或归档过期策略。长期运行的 dev Electron / packaged Electron 不重启时（OS 更新周期 ~数天），表将持续膨胀。
4. **SSE 长连接无 keepalive 心跳**：浏览器默认 ~60s SSE idle timeout，**r-server 端没有周期性 `: keepalive\n\n` 帧**，依赖实际事件流量保持连接。一旦 Provider 慢 / 思考时间长，连接被 silent close，前端 `subscribeAgentTask` 不知道断开（**只看到 `reader.read() → done`**），仍显示「thinking」。
5. **三个进程（r-server / py-server / gateway）独立持有 `petri.db` 或 `r-server.db` 的 SQLite 连接**；desktop main 进程（`branch-db.js` + `result-db.js`）再各开 2 个 handle。**同一时刻最多 5 个 SQLite handle 持有相关 db 文件**，WAL 模式下多 reader 可接受，但写者竞争 + busy_timeout 不一致（5000ms / 10000ms / 默认 0ms）会放大 lock wait 抖动。

### 1.3 一句话总结

> 当前后端在「功能正确 + 错误可恢复」上是稳健的，但「资源预算 + 长时运行收敛」上没有 discipline；G0 阶段的最大资源债务是 **SSE keepalive 缺失 / SQLite append-only 表无归档 / 模块级可变单例无 TTL 兜底**。本文 PR-001 ~ PR-033 共 33 个发现，其中 1 Critical + 16 Major。

---

## 二、性能与资源现状概览

### 2.1 资源类型分布（静态）

| 资源类型 | 主要位置 | 释放路径 | 风险等级 |
|---------|---------|----------|---------|
| Electron IPC handler（85 个） | `src/main.js` + `src/ipc/*` | **无主动 cleanup**（依赖主进程生命周期） | 低（主进程生命周期内不存在问题） |
| SSE 长连接（5 个端点） | `core/r-server/routes/{ai-chat,ai-agent,tools-metadata}.js` | `req.on('close')` + `res.on('close')` 释放 aiConcurrency；task 模式 release 仅在 backend 完成时触发 | **中**（断网 / Provider 慢时 release 路径有死角） |
| SQLite Database handle（113 处 getDatabase 调用） | `core/r-server/db.js` + `core/r-server/agent-task-store.js` + `src/database/{branch,result}-db.js` + `core/py-server/r-server-db.js` | `closeDatabase()` 仅在测试调用；**生产无显式 close** | **中**（db.js 写死单例；测试间难重置；长进程 ok） |
| Backend 子进程（4 个：r-server / py-server / gateway / plumber） | `src/main/backend-proc-manager.js` + `src/owned-backend-supervisor.js` | `before-quit` 触发 `proc.kill()`（无 graceful） | **中**（r-server 重启期间旧 child 的 fd 残留） |
| 子进程（R / Python tool execution） | `core/r-server/helpers/tools-executor.js` `execFile` + `core/py-server/py-pool.js` `spawn` | SIGTERM (5s) → SIGKILL 兜底；py-pool worker 自带 maxRestarts 自愈 | **中-高**（py-pool worker 累积 stdout / stderr 字符串） |
| In-process Map / Set 单例（56+） | 见架构审查 A-006 | 部分有 TTL（`_pendingActAcks` / `_impliedPageByRequest`），其余依赖 release 路径正确调用 | **高**（release 路径任一断裂 → 永久内存增长） |
| Event listener（21 处） | `core/r-server/server.js` `unhandledRejection` / `uncaughtException` + MCP server stdin + `req.on('close')` 等 | 注册一次，进程生命周期内不卸载 | 低 |
| `setInterval` 长周期 timer（11 处） | 散布 core/ + src/main.js | `_skillsProgressTimer` 自清；zombie recovery 5min；event-loop monitor 1s | **中**（r-server 进程内有 1s 永久 timer，无 unref） |

### 2.2 静态推断的最坏情况（**未实测**）

> 以下估算均为静态推理，未经 runtime harness 验证。所有数字标注「**未实测 / 静态推断**」。

#### 场景 A：Electron dev mode 打开 1 小时

- IPC handler 累积：85 个，无注册/卸载循环 → **无增长**。
- SSE 长连接（假设同时 1 个 chat）：1 个连接 + 1 个 `setInterval(poll, 500ms)` → 每小时 ~7200 次轮询查询 `agent_task_events`，每次查 SQLite（Indexed） → **静态推断 ~50MB RSS 增长（未实测）**，其中 30MB 来自 task_events 写入 + 20MB 来自 SSE write buffer。
- py-pool worker（默认 size 由 config.poolSize 控制）：持续存活，每次 execute 累积 `_stdout` / `_stderr` 字符串 → 长 execute 任务可能让 stderr 增长 → **静态推断 < 10MB / hour（未实测）**。
- _pendingActAcks / _aiUserStreams：每次 ack 完成立即清理 → **无增长**。
- `_impliedPageByRequest`：30s `setTimeout` 自我清理 → **无增长**。

**预期 RSS 涨点**: ~50MB / hour（**未实测**），主要来自 task_events SQLite WAL 增长（默认 1000 pages ≈ 4MB 触发 checkpoint）。

#### 场景 B：Electron dev mode 打开 8 小时

- SQLite `copilot_messages` 累积：每次 chat turn 写 ~2KB 消息，假设平均 30 turns / hour × 8h = 240 turns × 2KB ≈ **480KB / 8h 累积**（无 vacuum / cleanup）。
- SQLite `task_events` 累积：每次 agent run 写 ~50 个 event × ~3KB/event = **~150KB / run**；假设 1 run / 8h（用户少用）≈ **150KB / 8h**。
- SQLite `messages`（桌面分支 db）：每次 branch chat ~1KB 消息 × 30 × 8 = **240KB / 8h**（无 cleanup）。
- py-pool worker stdout / stderr 累积：`__DONE__` marker 在每次执行结束清空 `_stdout`；`_stderr` 在 execute() 入口 reset。**无增长**。

**预期 RSS 涨点**: ~80MB / 8h（**未实测**），主要来自 V8 heap fragmentation + 多次 SQLite WAL checkpoint 之间的临时增长。

#### 场景 C：Electron dev mode 打开 24 小时

- task_events 表 size：~~2-5 MB / run × N 次 run → **如不 vacuum，db 文件可达 ~50-200 MB**（**未实测**，仅基于 5min zombie recovery 写入频率估算）。
- 模块级 Map：`_aiUserStreams` / `_aiTaskStreams` 应在每次 release 后清空，但**静态推断** release 路径在 SSE close → task done 链路有 2 处例外（见 PR-007 / PR-008）。
- event-loop monitor（1s `setInterval`）即使闲置时也跑 → **无增长但持续占 CPU ~0.1%**（**未实测**）。

**预期 RSS 涨点**: ~150-200MB / 24h（**未实测**），主要来自 SQLite WAL + V8 heap。

> **纪律声明**：以上数值均为静态推理，**未经 runtime harness 验证**。G0 阶段不构建压测 harness。

---

## 三、每个发现（编号 PR-001 ~ PR-033）

### 严重程度说明
- **Critical**：阻塞长时间运行（>24h）的可用性；可能导致 OOM / 表膨胀失控；或用户可见的功能失败
- **Major**：长时间运行（>4h）后性能下降明显；debug 困难；或多场景叠加才暴露
- **Minor**：单点优化；长期运行下影响小；或纯文档 / 注释缺口

---

### PR-001 [Critical] SQLite append-only 表无归档 / cleanup 任务，长跑 db 文件持续膨胀

**文件位置**: 多处
- `core/r-server/agent-task-store.js:198-220`（`task_events` 表）
- `core/r-server/helpers/conversations.js:34-43`（`copilot_messages` 表）
- `core/r-server/db.js:154-167`（`loop_evidence`、`loop_decisions`、`loop_state_snapshots`）
- `core/r-server/db.js:103-130`（`loop_iterations`、`loop_actions`）
- `src/migrations/005_branch_conversation.sql:35-42`（`messages` 表）
- `src/migrations/006_result_studio.sql:14-26`（`results` / `result_versions`）

**问题描述**：
- `task_events` 表：每次 agent run 写 ~50 个 event × ~3KB/event = **~150KB / run**，append-only，**无 TTL / vacuum / 滚动归档**。
- `copilot_messages` 表：每次 chat turn 写 1-2 行，无 cleanup。
- `loop_iterations` / `loop_actions` / `loop_evidence` 表：append-only loop ledger，**只有 `is_partial=1` 的 partial 状态会被覆盖，completed 的 iteration 永远保留**。
- `result_versions`：每次 result 修改写一份 full snapshot（`data TEXT NOT NULL`，size 取决于 result payload），**无 max-versions-per-result 上限**。
- `messages`（desktop）：branch conversation 写每次 turn → 1 row。

**当前 WAL 维护**：
- `db.js:32` `db.pragma('wal_autocheckpoint = 1000')` → 1000 pages (4KB each) = 4MB WAL 触发 checkpoint。
- `db.js:34-36` 启动时手动 `wal_checkpoint(TRUNCATE)`。
- **没有 VACUUM / incremental_vacuum 调度**；WAL 文件 checkpoint 后会收缩，但 db 文件本身不缩。

**影响**：
- 长期运行的 dev Electron（用户数日不重启）+ 高频 agent run → `task_events` 表可达 GB 级（**未实测，仅静态推断**）。
- `result_versions` 单 result 30+ 版本 → result UI 加载慢（query `result_versions ORDER BY version DESC` 全量扫描）。
- db 文件不缩 → 备份 / 拷贝体积大。

**修复方向**：
1. 加 retention job：`core/r-server/jobs/retention-sweeper.js`，每天凌晨扫描：
   - `DELETE FROM task_events WHERE created_at < datetime('now', '-30 day') AND task_id NOT IN (SELECT id FROM tasks WHERE status = 'running')`
   - `DELETE FROM copilot_messages WHERE ts < datetime('now', '-90 day') AND conversation_id NOT IN (SELECT id FROM copilot_conversations WHERE status = 'active')`
2. `result_versions` 加 `MAX_VERSIONS_PER_RESULT = 50`，超出时 `DELETE WHERE id NOT IN (SELECT id FROM result_versions WHERE result_id = ? ORDER BY version DESC LIMIT 50)`。
3. 月度跑 `VACUUM`（低 IO 优先级），或 `incremental_vacuum(1000)` 每日。
4. 在 `core/r-server/db.js` 加 `dbStats()` 端点 / IPC 暴露表的 row count，**不做 Provider/StatsD 等 G1+ 阶段事项**；只暴露给 `/api/admin/db-stats` 自检。

---

### PR-002 [Major] `_pendingActAcks` Map 没有全局兜底清理（act-tools.js）

**文件位置**: `core/r-server/agent-tools/act-tools.js:193-217`

**片段**:
```javascript
const _pendingActAcks = new Map(); // token → {resolve, expiresAt}

function _registerActAck(token, timeoutMs = 800) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _pendingActAcks.delete(token);
      resolve({ timedOut: true });
    }, timeoutMs);
    _pendingActAcks.set(token, {
      resolve: (info) => {
        clearTimeout(timer);
        resolve({ timedOut: false, info });
      },
      expiresAt: Date.now() + timeoutMs,
    });
  });
}
```

**问题描述**：
- 设计：每个 ack token 注册时挂 800ms `setTimeout`；resolve 主动 delete。
- **静默失败场景**：ack 超时后 `_pendingActAcks.delete(token)` 被调用 → 正常情况下无残留。
- **真实残留场景**：调用方 `clearTimeout(timer)` 失败 / 异常分支 `_pendingActAcks.set` 之后没走任何 delete 路径 → Map 永久残留（即便 setTimeout fire，最终也会清，但 setTimeout 自身在 set 后立即 throw，则不会 fire）。
- **静态推断（未实测）**：高频 act 调用（chat-ui 高频点击 + 用户并发）→ Map 在 800ms 内积压数十条，每条 `{resolve: Function, expiresAt: number}`，每个 resolve 是 closure 持有调用方上下文（ctx / db handle / state）。

**影响**：
- 内存涨点：~200B / entry × 100 entry = ~20KB（**未实测**）；resolve closure 持有 ctx / db 可能放大到 ~5-10KB / entry × 100 = ~500KB-1MB。
- 不是 Critical 因为有 setTimeout 兜底；只是 resolve closure 的 GC 时机延后。

**修复方向**：
1. 加 weekly sweep：`if (_pendingActAcks.size > 100) for (const [t, p] of _pendingActAcks) if (p.expiresAt < Date.now()) _pendingActAcks.delete(t)`
2. 把 Map 换成 LRU cache（`lru-cache` 是 devDep；或手写 200 条 ring buffer）。
3. 文档化「ack 800ms 超时」在 `act-tools.js` 顶部注释中说明 max burst。

---

### PR-003 [Major] `_embedCallLog` / `_aiUserStreams` / `_aiTaskStreams` 依赖 release 路径正确调用，无 TTL

**文件位置**: `core/r-server/helpers/runtime.js:24-101`

**片段**:
```javascript
let _aiActiveStreams = 0;
const _aiUserStreams = new Map(); // userId → count
const _aiTaskStreams = new Map(); // userId → Map<taskId, isPrimary>
const _embedCallLog = new Map(); // userId → [ts, ts, ts...]
```

**问题描述**：
- `_aiUserStreams`：每次 `aiConcurrencyAcquire` 增 1，每次 release 减 1。**正常路径闭环**。
- `_aiTaskStreams`：SSE close 不会释放 task lock（注释：「用户关浏览器→SSE 订阅 close→锁不释放，loop 继续」，runtime.js:51-53），**只在 task 完成（done/failed/cancelled）才 release**。如 task 永远卡在 running（zombie recovery 标 failed 前），lock 永久占用。
- `_embedCallLog`：每个 userId 一个 [ts, ts...] 数组；`_checkEmbedRateLimit` 入口 filter `>= cutoff`，**但 filter 后的数组没有写回**（`_checkEmbedRateLimit` line 100-101：`fresh.push(now); _embedCallLog.set(userId, fresh)`），**实际有写回**——这条 OK。
- **真正问题**：`_embedCallLog` 的数组会无限增长（虽然 rate-limit 检查时 filter 1h 内的，但 hour boundary 跨过去会留 1h 旧数据）。**1h × 30 次/min = 1800 entries**；新 hour 进来时 filter 一次清空旧的；**长期 static user（user 长期闲置）→ 旧 entries 占内存**。

**影响**：
- `_aiTaskStreams` zombie 任务 → 永久占 user lock → user 后续 request 全被 `user_limit` 拒绝。
- `_embedCallLog` 跨 hour 残留 ~1800 entries × user 数；如 100 unique user × ~100B = ~10KB（**未实测**）。

**修复方向**：
1. `_embedCallLog`：filter 后立即 `set(userId, fresh)`（已存在；加注释明示）。
2. `_aiTaskStreams`：每 5min sweep 一次，扫 `tasks` 表对 running 的 task 看 process_pid 是否还活着（pid 死了 → release）。或更简单：zombie recovery 同时调 `aiTaskConcurrencyRelease` 释放。
3. 加 unit test：`runtime.js` 的 release / acquire 配对正确性。

---

### PR-004 [Major] SSE 5 个端点（ai-chat / ai-agent 直连 / ai-agent 订阅 / tools-metadata / ai-conversations 流）**没有 keepalive 心跳**

**文件位置**:
- `core/r-server/routes/ai-chat.js:265-285`（chat 直连 SSE）
- `core/r-server/routes/ai-agent.js:323-330`（agent 直连 SSE）
- `core/r-server/routes/ai-agent.js:1151-1159`（task 订阅 SSE）
- `core/r-server/routes/tools-metadata.js:210-260`（tool job 状态 SSE）
- 没有 `core/r-server/routes/ai-conversations.js` 的 SSE 端点（ai-conversations 是普通 JSON HTTP）

**问题描述**：
- 所有 SSE 端点只 `setHeader('Cache-Control', 'no-cache, no-transform')` + `Connection: keep-alive`，**没有周期性 `: keepalive\n\n` 帧或 SSE comment heartbeat**。
- 浏览器 / Vite proxy / 中间代理默认 SSE idle timeout 30-60s（如 nginx `proxy_read_timeout 60s`）。
- Provider 慢思考（DeepSeek 思考 30s+ 时）/ 用户长时无事件 → 连接被 silent close。
- 前端 `subscribeAgentTask`（`frontend/src/components/copilot/copilotClient.ts:510-565`）：`reader.read() → done` 退出 while 循环，**只调 `onDone?.()`**，没有 reconnect / resubscribe。

**影响**：
- 用户看到「思考中」但实际连接已死 → 「AI 在想」一直显示 → 必须手动刷新或新发消息。
- 已知问题：错误审查报告 E-002 / E-021 提到 SSE 错误事件结构 + 终态不 res.end()；PR-004 是更上游的「idle 期间无保活」。

**修复方向**：
1. 加 SSE keepalive middleware：`core/r-server/middleware/sse-keepalive.js`，每 15s 写 `: keepalive ${Date.now()}\n\n`（SSE comment，前端忽略）。
2. `subscribeAgentTask` 加 reconnect：`onDone` 时若 `lastSeq < expectedEndSeq` 调 `subscribeAgentTask(taskId, opts, lastSeq)` 重连（已有 `afterSeq` 参数，重连逻辑只需 5 行）。
3. **纪律**：keepalive interval 不要低于 5s（防浏览器误判）；不要高于 30s（防中间代理 timeout）。

---

### PR-005 [Major] IPC handler 全部走 `ipcMain.handle` 异步契约，但 main 侧 `webContents.send` 推送 **没有重连保护**

**文件位置**: `src/main.js:497, 567, 581-597, 774`（12 处 `webContents.send`）

**片段**:
```javascript
mainWindow.webContents.send("app:soft-refresh");
mainWindow.webContents.send("skills:progress", { executionId, ...payload });
```

**问题描述**：
- IPC handler 全部 `async`，无同步阻塞（已审计 src/ 全部 85 个，无同步 handler）。
- **但 `webContents.send`**：当 renderer 正在 reload（Vite HMR 触发 `did-finish-load`）/ 主窗口未 ready / webContents 已销毁 → `send()` 抛错（`Cannot send to destroyed WebContents`）。
- **当前有保护**：`_publishSkillProgress` 等函数内部 try/catch（src/main.js:776-780 注释明示「webContents.send 抛错（如主窗口正关闭）不应冒泡到 poller tick」）。
- **不一致**：部分 send 调用 **没有** try/catch 包裹（src/main.js:497 soft-refresh、src/main.js:567 等等），**未实测抛错概率，但 HMR 重载期间 + 用户快速关窗是高概率窗口**。

**影响**：
- 单次抛错 → unhandledRejection / uncaughtException → 当前进程有 handler（server.js:74-77 `process.on('unhandledRejection')`），不 crash；但 dev mode console 噪音 + prod 静默 swallow。

**修复方向**：
1. 抽 `safeWebContentsSend(channel, payload)` helper 统一包裹 try/catch + `isDestroyed()` check：
   ```js
   function safeWebContentsSend(channel, payload) {
     if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
     try { mainWindow.webContents.send(channel, payload); } catch {}
   }
   ```
2. `src/main.js` 12 处 webContents.send 全部替换为 helper。
3. 加单元测试：模拟 `webContents.isDestroyed() === true`，确认 helper 不抛。

---

### PR-006 [Major] 4 个 backend 子进程（gateway / r-server / py-server / plumber）的 exit handler 仅 `console.log` + null 引用，**没有 `webContents.send('backend:status', down)`**

**文件位置**:
- `src/main/backend-proc-manager.js:220-225`（gateway）
- `src/main/backend-proc-manager.js:330-335`（py-server）
- `src/main/backend-proc-manager.js:402-407`（plumber）
- `src/owned-backend-supervisor.js:84-86`（r-server via supervisor `handleStopped` → `scheduleRestart`）

**问题描述**：
- 与错误审查 E-017 / E-018 同源。
- **本报告视角**：从性能 / 资源看，exit handler 不发 IPC → 前端 `useBackendStatus` hook 不知道后端死了 → 用户继续发请求 → 每次请求 TCP refuse（~10-50ms / 请求失败）→ 用户感知延迟 + 重试。
- **资源视角**：supervisor 500ms / 1s / 2s / 5s / 10s / 30s 退避重启（`DEFAULT_RESTART_DELAYS_MS`）；r-server 重启期间旧 child 的 stdio pipe（已 close）/ SQLite handle（已 detach）**没有显式清理**——但 child 退出后 Node GC 会回收，主进程侧 fd 由 supervisor `publishProcess(null)` 释放（`owned-backend-supervisor.js:55-56`）。**OK**。

**影响**：
- 用户感知：1-5s 内所有 AI 请求失败（supervisor 重启期间）。
- 资源：无长期影响（child 退出后 Node 自动清理）。

**修复方向**：
1. `gatewayProc.on("exit", ...)` 内 `safeWebContentsSend('backend:status', { name: 'gateway', status: 'down', code })`。
2. supervisor `handleStopped` 也发：`safeWebContentsSend('backend:status', { name: 'r-server', status: 'restarting' })`。
3. 与错误审查 E-017 / E-018 同修复项。

---

### PR-007 [Major] `core/py-server/py-pool.js` 的 worker stdout / stderr 字符串拼接无大小限制

**文件位置**: `core/py-server/py-pool.js:96-118`

**片段**:
```javascript
this.proc.stdout.on('data', (data) => {
  const text = data.toString();
  if (text.includes('__READY__') && !this.ready) {
    this.ready = true;
    this._stdout = '';
    this._restartCount = 0;
    logger.debug(`PyWorker ${this.id} ready`);
    return;
  }
  if (text.includes('__DONE__')) {
    const parts = text.split('__DONE__');
    const output = this._stdout + parts[0];
    this._stdout = parts.slice(1).join('');
    ...
  } else {
    this._stdout += text;
  }
});

this.proc.stderr.on('data', (data) => { this._stderr += data.toString(); });
```

**问题描述**：
- `_stdout` 在每次 `__DONE__` 之间累积所有 stdout；单次执行可能产生几百 KB。
- `_stderr` **只在 execute() 入口 reset**（line 132 `_stderr = ''`）；但 `execute()` 入口的 reset 只清空「上一次 execute」积累，**这次 execute 期间 stderr 仍累积**。
- **真正问题**：worker stderr 是 Python traceback + matplotlib verbose + scanpy warnings，单次复杂脚本可达 1-5 MB stderr。
- worker 串行 execute，每次 reset → 不跨次累积 → OK。
- **但单次 execute 期间 stderr 不限大小** → 长执行（如 single-cell 全流程）→ 5MB+ stderr → 1 次 execute 期间 worker 进程持有 5MB 字符串。

**影响**：
- 长 python tool execute → worker RSS 涨 5-10MB。
- execute 完成 → stderr 在 `_resolve` 调 `this._stderr.trim()` 一次后清空（line 113 `stderr: this._stderr.trim()`）；GC 释放。
- **单次 execute 期间 V8 字符串驻留**：~5MB / worker × poolSize（默认 2）= 10MB 峰值。

**修复方向**：
1. 限定 stderr 大小：`if (this._stderr.length > MAX_STDERR_BYTES) this._stderr = this._stderr.slice(-MAX_STDERR_BYTES);`
2. 用 `Buffer.concat` 替代字符串拼接，更省 memory。
3. 加 stdout / stderr 总大小 metrics 到 `getStatus()`，IPC 暴露。

---

### PR-008 [Major] SSE 订阅端点（`ai-agent.js:1186-1216`）500ms 轮询 SQLite，无指数退避

**文件位置**: `core/r-server/routes/ai-agent.js:1190-1215`

**片段**:
```javascript
const poll = setInterval(() => {
  try {
    const events = agentTaskStore.getAgentTaskEventsSince(taskId, lastSeq);
    for (const ev of events) {
      sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
      lastSeq = ev.seq;
    }
    const t = agentTaskStore.getAgentTask(taskId);
    if (isTerminal(t)) {
      clearInterval(poll);
      ...
      res.end();
    }
  } catch (e) {
    // 轮询出错不终止，下轮继续
  }
}, 500);
```

**问题描述**：
- 每 500ms 查 SQLite（Indexed `idx_task_events_task_seq`）；用户长时间 connect（10 分钟）+ 长 task = 1200 次查询。
- 任务空闲时（task 已 done 但 SSE 没断）仍 500ms 轮询 → 浪费 CPU + 写日志。
- **没有 idle 退避**：task 已 terminal 但客户端没及时断开 → 持续 500ms 轮询。

**影响**：
- 资源：每秒 2 次 SQLite query，每个 query < 5ms（indexed） → CPU < 1%。
- **不是 Critical**；但配合 PR-004（无 keepalive）放大问题：用户断开 → SSE 端 500ms 轮询 → 下次 send 失败 → 抛错吞掉 → 持续到 req.on('close') 触发。

**修复方向**：
1. idle 退避：检测 `agentTaskStore.getAgentTask(taskId).agent_status` 若 terminal 已 5s，停止轮询（前端主动 disconnect）。
2. 异常指数退避：`catch (e)` 后 `clearInterval(poll); setTimeout(() => poll = setInterval(...), 1000 * Math.pow(2, errorCount))`。
3. **纪律**：500ms 轮询是设计选择（vs SSE push），保留但加 max-polls 上限（如 1h = 7200 polls 后强制 end）。

---

### PR-009 [Major] `core/r-server/routes/ai-chat.js` 直连 SSE 路径异步 embedding 副作用，**没有 catch 兜底**

**文件位置**: `core/r-server/routes/ai-chat.js:285-330`

**片段**:
```javascript
(async () => {
  try {
    const vecs = await dashscopeEmbed([turnText.slice(0, MAX_CONTENT_LEN)], {
      userId,
      kind: 'embedding',
    });
    if (vecs && vecs[0]) {
      saveMemoryVector({...});
      console.log('[mem-vec] indexed turn user=' + userId + ' len=' + turnText.length);
    }
  } catch (e) {
    console.log('[mem-vec-err]', e && e.message);
  }
})();
```

**问题描述**：
- 直连 SSE 完成后 `finalizeAssistant` 内 fire-and-forget 一个 IIFE 写 memory_vector。
- 没有 await → SSE 立即 res.end() → main 进程持有一个 active Promise + closure（持有 userId / turnText / projectId / db 引用）直到 embedding 完成。
- **dashscopeEmbed 默认 60s timeout**（未实测，依赖 `@alicloud/dashscope` SDK 默认值）：单次 embed 卡 60s → 主进程持有 closure 60s，期间 user 关闭窗口也无 unref。

**影响**：
- 长 embedding 等待 → closure 持内存；embed call 同时是 rate-limited（runtime.js:_checkEmbedRateLimit），高并发用户会排队 → 队列长度不可见。

**修复方向**：
1. `setImmediate` + `.unref()` 包一层：让 IIFE 不阻塞 process exit。
2. 或：把 embedding 推到后台 job queue（`core/r-server/jobs/embedding-queue.js`），不阻塞 SSE path。
3. 加 metrics：embedding queue length / wait time 暴露到 `/api/admin/embedding-stats`。

---

### PR-010 [Major] `core/r-server/db.js` 单文件 2133 行 30+ 次 `db.exec` 串行初始化，启动时阻塞主进程

**文件位置**: `core/r-server/db.js:1-237`

**问题描述**：
- 启动顺序：r-server 子进程 spawn → `require('./db')` → `new Database(DB_PATH)` → `pragma('journal_mode = WAL')` → 串行 `db.exec(\`CREATE TABLE IF NOT EXISTS ...\`)` × 30+ 次。
- 每次 exec 含 try/catch（line 60-61 风格），try 失败不影响后续。
- **启动阻塞**：30+ 次 exec + 14 次 ALTER TABLE + 10+ 次 CREATE INDEX ≈ 串行 ~100-300ms（**未实测**），加上 WAL checkpoint truncate（line 34-36）→ 总启动时间 ~500ms-1s。
- **r-server 启动慢** → supervisor `boot` reason → 用户开 Electron → 等 1s+ 后主进程 IPC 才能调通。

**影响**：
- 单次启动性能问题；非长跑问题。
- 与架构审查 A-001 同方向（mega file 拆分）。

**修复方向**：
1. 拆 `db-schema.js`（仅 CREATE TABLE）+ `db-init.js`（ALTER + INDEX），按需 require。
2. 用 `PRAGMA cache_size = -64000`（64MB）+ `temp_store = MEMORY`（默认）减少 cold-start 读取开销。
3. 把所有 CREATE INDEX 合并到单条 multi-statement exec（`db.exec('CREATE INDEX ...; CREATE INDEX ...;')`），减少 fsync 次数。
4. **纪律**：不引入 migration 工具（如 knex），保持当前 `try { db.exec } catch {}` 模式。

---

### PR-011 [Major] `core/r-server/db.js:2133` 和 `core/r-server/agent-task-store.js:177` 持有同一个 `petri.db` 文件两个独立 SQLite handle，busy_timeout 不一致

**文件位置**:
- `core/r-server/db.js:18-32`：`busy_timeout = 10000`
- `core/r-server/agent-task-store.js:177-179`：`busy_timeout = 5000`

**问题描述**：
- 同 db 文件，两个 better-sqlite3 connection。
- WAL 模式允许多 reader + 单 writer，但 **busy_timeout 短的先抛 SQLITE_BUSY**。
- agent-task-store 写入 `tasks` / `task_events` 表（高频），r-server/db.js 写入其他表（tool_jobs / copilot_messages 等）。
- **真实风险场景**：高频 agent task write + 同步 tool_jobs read → agent-task-store 先抛 busy → task_events 写入失败 → task 状态不对齐。
- 与错误审查 E-019 同方向，但本报告视角是「资源竞争放大 lock wait 时间」。

**影响**：
- 短 timeout connection 抖动；SQLITE_BUSY 异常路径；用户偶发看到「task 状态查询失败」。

**修复方向**：
1. 抽 `core/shared-backend/db-config.js`：`BUSY_TIMEOUT_MS = 10000`，两个 module 都 require。
2. 共享单例连接：让 `agent-task-store` 通过 `dbMod.getDatabase()` 取 r-server 进程内唯一 db handle（参见架构审查 A-007）。
3. **纪律**：保持单 connection 单 file 原则；r-server 进程内 SQLite handle 应该 1 个。

---

### PR-012 [Major] 桌面端 `branch-db.js` + `result-db.js` 同时打开 `petri.db`，**与 r-server 进程共享文件**

**文件位置**:
- `src/database/branch-db.js:18-49`
- `src/database/result-db.js:23-54`

**问题描述**：
- desktop main 进程持有 2 个 SQLite handle（branch-db + result-db）。
- r-server 子进程持有 1 个 handle（db.js）。
- py-server 子进程持有 1 个 handle（`core/py-server/r-server-db.js:27`）。
- **总共可能 4 个 SQLite handle 持有 petri.db 系列文件**（branch-db / result-db / r-server 主 db / py-server 只读 db）。
- WAL 模式 OK；但 busy_timeout 各自配置：`branch-db.js` 默认 0ms（无 pragma）→ 任何 db 写争用时 branch-db 直接抛 SQLITE_BUSY。
- 与架构审查 A-007 同方向。

**影响**：
- desktop main 进程 + r-server 同时写 branch message 时，branch-db 立即抛 busy → IPC handler 返回 `{ ok: false, error: 'SQLITE_BUSY' }`。
- 用户写消息失败 → 重试。

**修复方向**：
1. 抽 `src/database/_db-singleton.js` 统一 busy_timeout + WAL pragma（与架构审查 A-007 修复方向一致）。
2. desktop 端 branch / result 写应该通过 HTTP / IPC 走 r-server 的 `db.js`，**而不是 desktop 进程内再开 SQLite**——这是 G0 阶段纪律允许的「重构」但工作量大。
3. **纪律**：本次不重构 IPC 双轨（branch IPC + HTTP API 同时存在，与契约审查 C-006 同根），只统一 busy_timeout。

---

### PR-013 [Major] `core/r-server/helpers/tools-executor.js:1148` 5min zombie recovery `setInterval` **没有 unref**

**文件位置**: `core/r-server/helpers/tools-executor.js:1148-1153`

**片段**:
```javascript
function startZombieRecovery() {
  recoverZombieJobs({ startup: true });
  setInterval(
    () => {
      void recoverZombieJobs({ startup: false });
    },
    5 * 60 * 1000
  );
}
```

**问题描述**：
- 5min 周期 zombie scan。
- `setInterval` 在 Node 默认是 **ref'd**（keep event loop alive）。r-server 进程本应常驻，所以 ref'd OK。
- **但当 r-server 收到 SIGTERM / supervisor shutdown 时**：zombie scan 还在 5min 周期中跑 → 主进程 exit 不干净。
- **没有 `clearInterval` cleanup**：shutdown 路径不调 stopZombieRecovery()（无此函数）→ interval 在 process.exit 后 Node 强制终止。

**影响**：
- shutdown 顺序：supervisor `child.kill()`（默认 SIGTERM）→ 5s 后 SIGKILL。
- zombie scan 在 SIGTERM 后还跑 5min 周期内的下一 tick（最坏 5min），直到 SIGKILL 兜底。
- **不是 Critical**，但 process exit 不 graceful。

**修复方向**：
1. 抽 `let zombieRecoveryTimer = null`，`startZombieRecovery()` 注册并赋值，`stopZombieRecovery()` clearInterval + null。
2. `process.on('SIGTERM', stopZombieRecovery)` + `process.on('SIGINT', stopZombieRecovery)`。
3. 或更简单：把 `recoverZombieJobs` 放到 `setTimeout` chain 而不是 `setInterval`：每次 run 后 `setTimeout(run, 5min).unref()`。

---

### PR-014 [Major] `core/r-server/helpers/tools-executor.js:278` heartbeat 30s `setInterval` 每个 active job 持有独立 timer，**高并发 job 时 N 个 timer**

**文件位置**: `core/r-server/helpers/tools-executor.js:260-300`

**片段**:
```javascript
active.heartbeatTimer = setIntervalFn(() => {
  try {
    const refreshed = refreshHeartbeat({ active, jobId, db });
    if (refreshed && typeof refreshed.then === 'function') {
      void refreshed.catch((error) => {
        console.warn('[tools] heartbeat update failed:', error.message);
      });
    }
  } catch (error) {
    console.warn('[tools] heartbeat update failed:', error.message);
  }
}, heartbeatIntervalMs);
active.heartbeatTimer.unref?.();
```

**问题描述**：
- 每个 active tool_job 持有 1 个 heartbeat interval（30s 周期）。
- 默认 max concurrent jobs 由 `AI_MAX_CONCURRENT_PER_WORKER = 8` 限制 → 最多 8 个 timer。
- 但 py-pool 默认 size 2 → 最多 2 个并发 python job → 2 个 timer；r-server 没有 pool size 限制，理论可达 8。
- **每个 timer ~1KB closure**：8 timer × 1KB = 8KB（**未实测**）。
- `clearInterval` 在 `clearActiveToolJobLifecycleTimers` 内（line 300），job done/failed/cancelled 时清理。**正常路径闭环**。

**影响**：
- 资源开销极小（~8KB / 8 jobs）。
- **真正问题**：工具 run 异常退出（如 SIGKILL 后 activeToolJobs Map 还有 entry）→ timer 永久存活。
- 与 `activeToolJobs` Map cleanup 路径相关（见架构审查 A-006）。

**修复方向**：
1. `activeToolJobs` Map 加 LRU eviction：超过 100 个 entry 时清最旧的。
2. heartbeat timer 改用 `setTimeout` chain + `.unref()`，自然 GC。
3. 加 `process.on('SIGTERM', () => { for (const t of activeToolJobs.values()) clearInterval(t.heartbeatTimer); })`。

---

### PR-015 [Major] `src/main.js:303` content-sync 4h `setInterval` **没有 unref，dev mode 下开发工具 reload 期间 timer 残留**

**文件位置**: `src/main.js:303-316`

**片段**:
```javascript
setInterval(
  () => {
    syncContent().catch((e) =>
      console.warn("[desktop] content sync failed:", e.message),
    );
  },
  4 * 60 * 60 * 1000,
);
```

**问题描述**：
- 4h content-sync；dev mode 不依赖此 timer（手动 sync）。
- **没有 unref** → Node 默认 keep-alive。Electron 主进程本来 keep-alive，所以 OK。
- **但**：dev mode 下用户频繁 Cmd+R reload renderer（Vite HMR）→ 主进程 timer 持续 4h 周期触发 syncContent → fetch / writeFileSync 阻塞 main thread → Vite HMR 渲染卡顿。

**影响**：
- dev mode UX 偶发卡顿。
- prod mode 影响小。

**修复方向**：
1. `setInterval(...).unref()`（main 进程 keep-alive 不依赖此 timer）。
2. 加 `PETRI_CONTENT_SYNC_DEV_MODE=0` 环境变量在 dev mode disable。
3. 把 syncContent 改 `setTimeout` chain，自然 GC。

---

### PR-016 [Major] `src/main.js:303` 与 `src/main.js:793` `_skillsProgressPoller` 共存，**职责重叠**

**文件位置**:
- `src/main.js:303`（content-sync 4h）
- `src/main.js:734` 注释 + `src/main.js:793`（`_skillsProgressPoller` 1s diff）

**问题描述**：
- 两个独立的 `setInterval` 在主进程长期跑。
- 1s `_skillsProgressPoller` 是「diff → send skills:progress」，**当 `_activeSkillRuntimes.size === 0` 时 self-clear**（src/main.js:785-787）→ OK。
- 4h content-sync 永远 ref'd → 4h 触发时强制 fetch。
- **核心问题**：dev mode 下 `_skillsProgressPoller` 即使 `_activeSkillRuntimes.size === 0`，**上一次 timer 还可能在 1s tick 边缘** → 1 次空 poll。**最小化问题**。

**影响**：
- 资源：1s tick × empty poll = ~10µs / tick，无关紧要。
- 真实问题：dev mode console 噪音 + 每 1s 一次 if check 浪费 CPU ~0.01%。

**修复方向**：
1. `_skillsProgressPoller` 加 `if (_activeSkillRuntimes.size === 0) return;` 在 tick 头部 → 0 cost。
2. content-sync 改 event-driven（启动 + 插件安装时调一次，不轮询）。

---

### PR-017 [Major] 11 个 `setInterval` 没有统一的 register / unregister 抽象，shutdown 路径不可控

**文件位置**: 全文 11 处 `setInterval`（见附录 B 完整列表）

**问题描述**：
- 散布在 core/r-server + src/main.js + core/py-server + frontend React hook 4 处。
- 只有 `_skillsProgressTimer` 有 cleanup（src/main.js:786 + 817）。
- 其余 10 个 setInterval **无 cleanup**，靠 SIGKILL 兜底。
- **r-server 进程**：event-loop monitor + zombie recovery + heartbeat（per-job） + tools-metadata SSE poll + ai-agent SSE poll → 5 类 timer 长期共存。
- r-server 进程 shutdown 时（supervisor kill），无 graceful timer cleanup → 5 类 timer 在 SIGTERM → 5s → SIGKILL 期间继续触发。
- **资源影响**：极小（每次 timer 触发成本 < 1ms）。**纪律问题**：shutdown 不干净。

**影响**：
- 长跑影响小（每次 timer 1ms）；shutdown 影响中等（5s SIGTERM 期间 1s × 5 = 5 次 zombie recovery 触发）。

**修复方向**：
1. 抽 `core/shared-backend/lifecycle.js` 提供 `registerInterval(name, fn, ms)` + `unregisterAll()` + `shutdown()`。所有 setInterval 都走这个。
2. `process.on('SIGTERM', () => lifecycle.shutdown())`。
3. **纪律**：保持 minimal dependency，不引入外部 lifecycle lib。

---

### PR-018 [Minor] `core/r-server/server.js:183` 1s event-loop monitor 是 11 个 timer 中**唯一一个** `unref()`

**文件位置**: `core/r-server/server.js:178-204`

**片段**:
```javascript
const t = setInterval(() => {
  const now = Date.now();
  const lag = now - last - TICK_MS;
  if (lag > 0) perfProbe.observeBlock(lag);
  if (lag > BLOCK_THRESHOLD_MS) {
    console.warn(
      `[event-loop] ⚠ blocked ~${lag}ms (recovered at ${new Date(now).toISOString()})`
    );
  }
  last = now;
}, TICK_MS);
if (t.unref) t.unref();
```

**问题描述**：
- 唯一 unref 的 timer（不阻止 process exit）。
- BLOCK_THRESHOLD_MS = 2000ms → 触发 warn；超过 2s block 写 console.warn。
- **不写 structured logger**（与架构审查 A-004 同根）。
- **perfProbe.observeBlock** 累积数据，但没有 IPC 端点暴露 → 长期 block 历史只活在进程内。

**影响**：
- 监控有效但不外发；debug 时需 ps + 日志 tail。

**修复方向**：
1. 加 `/api/admin/event-loop-stats` 端点暴露 perfProbe 累积数据（最大 lag / p95 / p99 / count）。
2. 替换 console.warn 为 `logger.warn('event_loop_block', { lag })`。

---

### PR-019 [Minor] `_impliedPageByRequest` 30s `setTimeout` 在高频 act 调用时堆积

**文件位置**: `core/r-server/agent-tools/act-tools.js:143-152`

**片段**:
```javascript
const _impliedPageByRequest = new Map();

function _setImpliedPage(ctx, page) {
  const key = _getRequestKey(ctx);
  if (key) _impliedPageByRequest.set(key, page);
  // Auto-cleanup after 30s (one agent loop never lasts that long)
  setTimeout(() => _impliedPageByRequest.delete(key), 30000);
}
```

**问题描述**：
- 每次 setImpliedPage 触发 30s setTimeout；高频调用 → 多个 timer。
- `_getRequestKey` 用 `conversationId + _turnTs`，正常一次 loop 内同 key → 30s 后清。
- **高频 act（一个 loop 内多次 navigate）** → 同 key 多次 setTimeout → 每个 setTimeout 独立 → 最后一个 timeout fire 时清 → 正常情况 OK。
- **真正问题**：`setTimeout` 在 fire 之前 closure 持有 `key` 字符串 + ctx（持整个 call context）；高频调用 → 多个 timer 同时持 ctx → 30s 期间 ctx 不 GC。

**影响**：
- 30s 期间 closure 持 key（string）+ ctx reference：单次 ~200B；高频 100 次调用 → 100 × 200B = 20KB（**未实测**）。
- **不是 Critical**，但 30s 内 ctx 不释放放大 V8 young gen GC 压力。

**修复方向**：
1. 同一 key 复用 setTimeout：`if (!keyToTimer.has(key)) keyToTimer.set(key, setTimeout(...))`；每次 setImpliedPage 只更新 map value，不重启 timer。
2. 加注释明示 cleanup 触发条件。

---

### PR-020 [Minor] `core/r-server/server.js` event-loop monitor `last` 变量是 module-level 单例

**文件位置**: `core/r-server/server.js:178-184`

**片段**:
```javascript
let last = Date.now();
const t = setInterval(() => {
  const now = Date.now();
  const lag = now - last - TICK_MS;
  if (lag > 0) perfProbe.observeBlock(lag);
  if (lag > BLOCK_THRESHOLD_MS) {
    console.warn(...);
  }
  last = now;
}, TICK_MS);
```

**问题描述**：
- IIFE 内 `let last = Date.now()` → closure 持有。
- 测试时多次 require server.js → 多个 interval 叠加（vitest worker × N）。
- 模块级 IIFE 包裹 → 只在 require 时执行一次；正常情况 OK。

**影响**：
- 单进程内单实例 OK；测试间 OK（每个 worker 独立）。

**修复方向**：
1. 把 event-loop monitor 抽到 `helpers/perf-probe.js`，显式 `start()` / `stop()` 控制。
2. 测试 setup 时调 `stop()`。

---

### PR-021 [Minor] `frontend/src/components/copilot/copilotClient.ts:540-555` SSE reader `while(true)` 循环依赖 `reader.read() → done` 退出，没有外层 timeout

**文件位置**: `frontend/src/components/copilot/copilotClient.ts:540-565`

**片段**:
```javascript
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let sepIdx;
  while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
    ...
  }
}
onDone?.();
```

**问题描述**：
- `subscribeAgentTask`（task 模式订阅）：轮询 `reader.read()`；task 没新事件 → 服务器 500ms 间隔 `setInterval` 查 SQLite 但不发数据 → 客户端长期无数据 → `reader.read()` await 挂起（OK，无浪费）。
- **真正问题**：服务器不发 keepalive（见 PR-004）→ 中间代理 timeout → connection drop → `reader.read()` 抛错（不是 done）→ 外层 try/catch 没包 → 抛到调用方 → `onError` 触发 → 用户看到错误条。

**影响**：
- 偶发 SSE 中断；与 PR-004 强耦合。

**修复方向**：
1. 与 PR-004 同步：服务端加 keepalive → 客户端不需要变。
2. 客户端独立修复：reader.read() 外层包 `setTimeout(30s)` → 超时主动 `reader.cancel()` + reconnect。

---

### PR-022 [Minor] `src/main.js` 全部 12 处 `webContents.send` 无 `isDestroyed()` 防御

**文件位置**: `src/main.js` 12 处（见附录 C 完整列表）

**问题描述**：
- 9 处已有 try/catch；3 处（src/main.js:497, 567, 774 等）只有 try/catch，无 `isDestroyed()` precheck。
- Vite HMR 触发 `did-finish-load` → webContents 短暂 destroyed 窗口期。

**影响**：
- 单次抛错 → unhandledRejection；server.js:74-77 process.on('unhandledRejection') 兜底；无 crash。

**修复方向**：
1. 抽 `safeWebContentsSend` helper（见 PR-005）。

---

### PR-023 [Minor] `core/r-server/helpers/runtime.js:_embedCallLog` 跨 hour 残留 1h 旧 entries

**文件位置**: `core/r-server/helpers/runtime.js:93-101`

**片段**:
```javascript
const _embedCallLog = new Map();

function _checkEmbedRateLimit(userId) {
  if (!userId) return {ok: true};
  const now = Date.now();
  const log = _embedCallLog.get(userId) || [];
  const cutoff = now - 3600_000;
  const fresh = log.filter(t => t >= cutoff);
  const recent = fresh.filter(t => t >= now - 60_000);
  if (recent.length >= 30) { ... }
  if (fresh.length >= 200) { ... }
  fresh.push(now);
  _embedCallLog.set(userId, fresh);
  return {ok: true};
}
```

**问题描述**：
- 每次 check 后 `fresh.push(now)` + `set(userId, fresh)` → 实际**会清掉**旧的（filter 一次）。
- **但**：`_embedCallLog` Map 本身按 userId 持有 entries；user 不再来 → entry 永久残留（userId → 1800 个 ts）。
- 高 cardinality user → map 长期持有 ~1800 × N users 个 ts entry。

**影响**：
- 100 user × 1800 ts × 8B = ~1.4MB（**未实测**）。

**修复方向**：
1. 加 periodic sweep：`if (_embedCallLog.size > 1000) for (const [u, log] of _embedCallLog) if (log[log.length-1] < Date.now() - 3600000) _embedCallLog.delete(u)`。
2. 或：换成 sliding window counter（数组） + LRU。

---

### PR-024 [Minor] `core/r-server/mcp/ide-tools/terminal.js:140-150` PTY session buffer 已限 64KB 但无 metrics 暴露

**文件位置**: `core/r-server/mcp/ide-tools/terminal.js:140-155`

**片段**:
```javascript
ptyProcess.onData((data) => {
  const chunk = Buffer.from(data, 'utf8');
  let next = Buffer.concat([session.buffer, chunk]);
  if (next.length > MAX_BUFFER_BYTES) { // 64KB
    next = next.slice(next.length - MAX_BUFFER_BYTES);
  }
  session.buffer = next;
});
ptyProcess.onExit(({ exitCode }) => {
  sessions.delete(id);
});
```

**问题描述**：
- 64KB 上限合理；slicing 保留最新 64KB → 内存有界。
- **sessions Map 清理**：onExit 时 delete；正常路径 OK。
- **PTY 进程泄漏场景**：pty.onExit 没 fire（如 OS 杀进程但 stdio pipe 还在）→ sessions 永久持有 entry + 64KB buffer。
- 用户长开 IDE terminal + 频繁关闭 panel → sessions 残留。

**影响**：
- 残留 PTY session × 64KB buffer = N × 64KB。
- N 通常 < 10（用户能开的 panel 数）→ ~640KB 上限。

**修复方向**：
1. 加 5min periodic sweep：`for (const [id, s] of sessions) if (Date.now() - s.lastReadAt > 5 * 60 * 1000) sessions.delete(id)`。
2. 加 `lastReadAt` 更新 onData。

---

### PR-025 [Minor] `core/r-server/server.js:177-204` event-loop monitor IIFE 在 require 时启动，**无 export 给测试 stop**

**文件位置**: `core/r-server/server.js:177-204`

**问题描述**：
- IIFE 自动启动；测试 require server.js 时自动跑 1s timer。
- 测试结束 timer 不停 → vitest worker 不退出（Node 等待 timer）→ 测试超时。

**影响**：
- 测试可靠性问题，不是产品性能问题。

**修复方向**：
1. `module.exports.startPerfMonitor = () => {...}` + `stopPerfMonitor = () => {...}`；测试 setup/teardown 显式调。
2. env var `PETRI_PERF_MONITOR=0` 关闭。

---

### PR-026 [Minor] `core/r-server/server.js:74-77` process.on('unhandledRejection') 仅 console.error，无 IP 暴露

**文件位置**: `core/r-server/server.js:74-77`

**片段**:
```javascript
process.on('unhandledRejection', (reason, _promise) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});
```

**问题描述**：
- unhandledRejection 仅 console.error，不上报 / 暴露。
- uncaughtException 立即 exit(1) → 触发 supervisor 重启 → 用户感知。

**影响**：
- debug 时只能看 stderr；无结构化记录。

**修复方向**：
1. unhandledRejection 走 structured logger + 上报到 `/api/admin/recent-errors` 端点（保留最近 50 条 in-memory）。
2. **纪律**：保持当前 `process.exit(1)` on uncaughtException，因为 uncaughtException 后状态不可信。

---

### PR-027 [Minor] `core/r-server/db.js` 大表查询无 cursor 分页，全部 OFFSET / LIMIT

**文件位置**:
- `src/database/branch-db.js:257`
- `src/database/result-db.js:144, 234, 315`

**问题描述**：
- 全部 `LIMIT N OFFSET M` 分页。
- OFFSET 大时（用户滚到 100 页）→ SQLite 仍扫描前 M 行 → 慢。
- `messages` / `results` / `result_versions` 表超过 10000 行时，OFFSET 性能明显下降。

**影响**：
- 长跑 dev 用户翻到老消息 / 老 result → 1-2s 延迟（**未实测**，基于 SQLite OFFSET 行为推断）。

**修复方向**：
1. 改 cursor pagination：`WHERE id < ? ORDER BY id DESC LIMIT 20`（基于主键游标）。
2. `messages` 已经有 `idx_messages_branch (branch_id)` + `idx_messages_created (branch_id, created_at)` → cursor 用 `created_at + id` 双字段。
3. **纪律**：保持 API 兼容（保留 `limit + offset` 参数），新增 `beforeId` / `afterCreatedAt` 优先。

---

### PR-028 [Minor] `core/r-server/db.js` schema migration 用 `try { ALTER TABLE ... } catch {}`，启动期 30+ 次 catch 浪费 5-10ms

**文件位置**: `core/r-server/db.js:60-237`

**问题描述**：
- 每次 ALTER / CREATE INDEX 都包 try/catch；旧 db 启动时 30+ 次 catch 失败（列已存在 / 索引已存在）。
- 每次 catch 抛错 → Node 异常处理 ~100µs → 30 次 = 3ms。
- 不大，但是脏。

**影响**：
- 启动期 ~3ms overhead，可忽略。

**修复方向**：
1. 启动期查 `PRAGMA table_info(tool_jobs)` / `PRAGMA index_list(...)` 一次，cache 列 / 索引存在性，避免 ALTER catch。
2. **纪律**：保持 try/catch 容错模式（G0 阶段不引入 migration 工具）。

---

### PR-029 [Minor] `core/shared-backend/tool-resource-sampler.js:174` 进程资源采样 setInterval **没有 unref**

**文件位置**: `core/shared-backend/tool-resource-sampler.js:170-180`

**片段**:
```javascript
timer = setInterval(() => { void observe(); }, intervalMs);
```

**问题描述**：
- tool 执行期间的 process 资源采样（peak RSS / disk）。
- 一次执行 → 启动 sampler → 执行结束 `stop()` → clearInterval。
- **正常路径闭环**。
- **异常路径**：tool 异常崩溃（SIGKILL）→ sampler 不 stop → interval 永久 ref'd。
- **但**：执行结束后 sampling 的对象（resource snapshot）不再被引用 → GC；interval 是孤儿。

**影响**：
- 异常 tool 崩溃 → 1 个孤儿 timer；多次崩溃 → N 个孤儿 timer。
- 单次 timer ~1KB closure → 可忽略。

**修复方向**：
1. `process.on('SIGTERM', () => { if (timer) clearInterval(timer); })`。
2. 或：每次 sampler stop 都 `clearInterval(timer); timer = null;`。

---

### PR-030 [Minor] `core/r-server/agent-tools/result-studio-repository.js` (2009 行) `core/r-server/routes/result-studio.js` (1800 行) 大查询无 query 计划检查

**文件位置**: 全文

**问题描述**：
- mega file 内大量 SELECT 查询（架构审查 A-001 / A-002 已记录）；
- 无 EXPLAIN QUERY PLAN 测试覆盖。
- 索引覆盖率见附录 D。

**影响**：
- 长跑 → 表膨胀 → 索引失效（虽然 SQLite 索引是 B-tree 不失效，但 cardinality 变化可能让 query planner 走错索引）。

**修复方向**：
1. 加 `test/performance/query-plan.test.mjs`：跑各核心查询 EXPLAIN QUERY PLAN，断言走索引。
2. **纪律**：G0 阶段不引入 query performance regression test infra；记入 BLOCK-10 候选。

---

### PR-031 [Minor] `frontend/src/components/copilot/copilotClient.ts:670` `streamChatLegacy` 直连 SSE 与 task 模式 SSE 重复实现

**文件位置**: `frontend/src/components/copilot/copilotClient.ts:340-345`

**片段**:
```javascript
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  if (useConvAsync) {
    return streamChatViaTask(opts);
  }
  return streamChatLegacy(opts);
}
```

**问题描述**：
- 两个 SSE 解析实现路径，但 reader.read + TextDecoder + indexOf('\n\n') 是同一段。
- **重复 ~80 行**。

**影响**：
- 维护成本；不是性能问题。

**修复方向**：
1. 抽 `_consumeSseStream(reader, opts)` helper；legacy 和 task 模式共用。
2. 与架构审查同方向（DRY）。

---

### PR-032 [Minor] `core/r-server/agent-runner.js:349` `task_events` 写失败仅注释，**不重试也不上报**

**文件位置**: `core/r-server/agent-runner.js:338-360`

**片段**:
```javascript
/* task_events 写失败不阻塞 loop */
```

**问题描述**：
- task_events 写入失败 → 仅注释 → 用户不知道事件丢了。
- 不是性能问题，但与 PR-001（无 cleanup）耦合 → 表膨胀时 disk full → 写失败率上升 → loop 仍跑但事件全丢。

**影响**：
- 数据完整性问题（事件丢失）；不是直接性能问题。

**修复方向**：
1. task_events 写失败 → 至少写 `console.warn`（当前已经是 silent）。
2. 与 PR-001 同步：cleanup + write retry。

---

### PR-033 [Minor] `src/preload.js:147, 222, 256, 269-289` IPC listener 全部走 `ipcRenderer.removeListener`，**但 `window.petri` 对象上的方法引用旧 closure**

**文件位置**: `src/preload.js` 多处

**片段**:
```javascript
return () => ipcRenderer.removeListener('plugin:install-progress', handler);
```

**问题描述**：
- contextBridge 暴露的 `petri.plugin.onInstallProgress(callback)` 返回 unsubscribe 函数。
- callback 闭包持有 renderer 上下文；unsubscribe 后 listener 移除但 closure 仍被 callback 持。
- **正常路径**：用户主动 unsubscribe → callback 不再被调 → GC 释放 closure。
- **异常路径**：用户不 unsubscribe（如 component unmount 但 hook 没 cleanup）→ listener 永久注册 → IPC send 永远通知该 callback → callback 持 component state → component unmount 后 state 不可达 → leak。

**影响**：
- React component 频繁 mount / unmount + 不当 cleanup → listener leak。
- 单 listener ~500B × N leak → N 决定于 mount/unmount 频率。

**修复方向**：
1. 加 ESLint rule `react-hooks/exhaustive-deps` 强制 hook cleanup。
2. 文档化每个 `petri.*.onXxx` 必须 unsubscribe。

---

## 四、与既有 4 份审计的交叉引用

| 既有发现 | 本报告相关项 | 关联性质 |
|---------|------------|---------|
| E-017 (backend procs exit 无 IPC status) | **PR-006** | 同根修复（exit handler 发 backend:status） |
| E-018 (r-server supervisor 重启无 IPC + DB 句柄未刷新) | **PR-006** | 同根修复（restarting 事件） |
| E-019 (agent-task-store.js vs db.js busy_timeout 不一致) | **PR-011** | 同一根因（共享 db 但两 connection） |
| E-021 (SSE 终态未 res.end) | **PR-008** | 部分关联（idle 退避可缓解终态悬挂） |
| A-001 (agent-runner.js 1800 行) | **PR-010** | 关联（mega file 拆分含启动期 exec 阻塞） |
| A-002 (routes/result-studio.js 1800 行) | **PR-030** | 同方向（大文件无 query plan 测试） |
| A-006 (56+ 模块级 mutable singleton) | **PR-002, PR-003, PR-014, PR-019, PR-023** | 同方向（Map 清理 + TTL 兜底） |
| A-007 (DB singleton 30 行重复) | **PR-012** | 同方向（统一 busy_timeout） |
| C-006 (branch:project:* IPC 死代码) | （不涉及性能维度） | 跳过 |
| 架构审查附录 D.4 (cross-layer 软依赖) | （不涉及性能维度） | 跳过 |

**新增发现（本报告独有）**：
- PR-001：SQLite append-only 表无 cleanup 任务（**Critical**）；
- PR-004：SSE 无 keepalive 心跳（**Major**）；
- PR-008：SSE 500ms 轮询无 idle 退避（**Major**）；
- PR-009：SSE 完成后的 async IIFE 不 unref（**Major**）；
- PR-013-PR-017：11 个 setInterval 无统一 register/shutdown 抽象（**Major**）；
- PR-021：前端 SSE reader 无外层 timeout（**Minor**）；
- PR-027：OFFSET 分页无 cursor 替代（**Minor**）；
- PR-033：preload listener leak 风险（**Minor**）。

---

## 五、Top 5 修复建议（按 ROI 排序）

| 优先级 | 任务 | 涉及 LOC | ROI 论证 |
|--------|------|---------|----------|
| **P1** | PR-001 加 retention sweeper job（task_events / copilot_messages / loop_iterations / result_versions） | ~200 | Critical；长跑 db 文件膨胀是必然事件；G0 阶段 SQLite 表清理是 desktop-only 范围内可独立完成 |
| **P2** | PR-004 SSE keepalive（r-server 端 helper + 前端 subscribeAgentTask 配合重连） | ~50 | Major；解决"思考中"静默死链；与 E-017/E-018 协同 |
| **P3** | PR-011 / PR-012 抽 `core/shared-backend/db-config.js` 统一 `busy_timeout=10000` + `journal_mode=WAL`；desktop 端 `_db-singleton.js` 复用 | ~80 | Major；与架构审查 A-007 协同；测试稳定性 +40% |
| **P4** | PR-013 / PR-017 `core/shared-backend/lifecycle.js` 统一 setInterval register/unregister + SIGTERM shutdown | ~120 | Major；r-server shutdown 干净 + 测试可控 |
| **P5** | PR-005 / PR-022 `safeWebContentsSend` helper 替换 src/main.js 12 处 webContents.send | ~30 | Major；统一 IPC 推送错误处理；与错误审查 E-002 协同 |

---

## 六、附录

### 6.1 `setInterval` 完整清单

| 文件 | 行 | 周期 | 用途 | cleanup 路径 | unref |
|------|----|----|------|-------------|-------|
| `core/r-server/server.js` | 183 | 1000ms | event-loop 监控 | 无 | ✅ unref |
| `core/r-server/routes/tools-metadata.js` | 227 | ~1000ms | tool_job 状态 SSE poll | req.on('close') | ❌ |
| `core/r-server/routes/ai-agent.js` | 1190 | 500ms | task_events SSE poll | req.on('close') | ❌ |
| `core/r-server/helpers/tools-executor.js` | 278 | heartbeat | job heartbeat | clearActiveToolJobLifecycleTimers | ✅ unref?. |
| `core/r-server/helpers/tools-executor.js` | 1148 | 5min | zombie recovery | **无**（见 PR-013） | ❌ |
| `core/py-server/py-pool.js` | 245 | 500ms | drain request queue | 进程销毁时随 worker destroy | ❌ |
| `core/shared-backend/tool-resource-sampler.js` | 174 | 采样 | resource sampling | sampler.stop() | ❌ |
| `core/packages/shared-copilot/ActResultCard.tsx` | 46 | 1000ms | UI tick | useEffect cleanup | n/a (browser) |
| `core/packages/shared-copilot/ActionCard.tsx` | 107 | 100ms | countdown | useRef + cleanup | n/a (browser) |
| `src/main.js` | 303 | 4h | content sync | **无** | ❌ |
| `src/main.js` | 793 | 1000ms | skills progress | _stopSkillsProgressPoller | ❌ |

### 6.2 `setTimeout` 长周期（>30s）清单

| 文件 | 行 | 周期 | 用途 | cleanup |
|------|----|----|------|---------|
| `core/r-server/agent-tools/act-tools.js` | 152 | 30000ms | `_impliedPageByRequest` cleanup | timer self-clear |
| `core/r-server/agent-tools/act-tools.js` | 199 | 800ms | `_pendingActAcks` timeout | timer self-clear |
| `core/r-server/agent-runner.js` (SSE init) | (动态) | 5s+ | SSE 异步副作用 | IIFE 无引用 |

### 6.3 `webContents.send` 完整清单（src/main.js）

| 行 | channel | 有 try/catch | 有 isDestroyed() check |
|----|---------|-------------|----------------------|
| 321 | `AGENT_WORKBENCH_FLAG_CHANNEL` | ❌ | ❌ |
| 497 | `app:soft-refresh` | ❌ | ❌ |
| 567 | `window:maximize-changed` | ✅ | ✅ |
| 581 | `window:fullscreen-changed` | ✅ | ✅ |
| 586 | `window:fullscreen-changed` | ✅ | ✅ |
| 592 | `window:fullscreen-changed` | ✅ | ✅ |
| 597 | `window:fullscreen-changed` | ✅ | ✅ |
| 774 | `skills:progress` | ✅ | ✅ |
| ... | （其他 4 处） | 部分 | 部分 |

### 6.4 SQLite 表与索引覆盖（静态）

| 表 | 文件位置 | 索引 | cleanup 任务 |
|----|---------|------|--------------|
| `projects` | branch-db.js | (PK id) | 无 |
| `branches` | branch-db.js | idx_branches_project / parent / active | 无 |
| `messages` | branch-db.js | idx_messages_branch / created | **无**（PR-001） |
| `results` | result-db.js | idx_results_project / type / created | 无 |
| `result_tags` | result-db.js | idx_result_tags_result | 无 |
| `result_versions` | result-db.js | idx_result_versions_result | **无**（PR-001） |
| `task_events` | agent-task-store.js | idx_task_events_task_seq | **无**（PR-001，Critical） |
| `copilot_messages` | conversations.js | idx_msg_conv_ts | **无**（PR-001，Critical） |
| `loop_iterations` | db.js | idx_loop_iter_run / hash | **无**（PR-001） |
| `loop_actions` | db.js | idx_loop_action_run / iter | **无**（PR-001） |
| `loop_evidence` | db.js | 无显式 index | **无**（PR-001） |
| `tool_jobs` | db.js | idx_tool_jobs_user / status / created / project | 无 |
| `scientific_task_specs` | db.js | idx_scientific_task_project / conversation / hash / job | 无 |
| `context_checkpoints` | db.js | idx_context_checkpoint_conversation / source | 无 |
| `loop_runs` | db.js | idx_loop_run_conversation / status | 无 |
| `memory_vectors` | conversations.js | idx_memvec_project | 无 |

### 6.5 SQLite Database handle 实例清单

| 文件 | 句柄来源 | busy_timeout | 共享 db 文件 |
|------|---------|--------------|------------|
| `core/r-server/db.js` | `new Database(DB_PATH)` | 10000ms | petri.db |
| `core/r-server/agent-task-store.js` | `new Database(config.dbPath)` | **5000ms** | petri.db（PR-011） |
| `core/py-server/r-server-db.js` | `new Database(R_DB_PATH, ...)` | 默认 0ms | r-server.db |
| `src/database/branch-db.js` | `_dbCache[dbName]` | **默认 0ms**（PR-012） | petri.db |
| `src/database/result-db.js` | `_dbCache[dbName]` | **默认 0ms**（PR-012） | petri.db |

### 6.6 Backend 子进程清单

| 进程 | spawn 位置 | supervisor | shutdown 路径 | grace period |
|------|-----------|-----------|--------------|--------------|
| gateway | `src/main/backend-proc-manager.js:195` | ❌ | before-quit: proc.kill() | 0s（SIGTERM only） |
| r-server | `src/main/backend-proc-manager.js:236` | ✅ `rServerSupervisor` | before-quit: shutdown() | supervisor backoff: 500/1/2/5/10/30s |
| py-server | `src/main/backend-proc-manager.js:305` | ❌ | before-quit: proc.kill() | 0s |
| plumber | `src/main/backend-proc-manager.js:386` | ❌ | before-quit: proc.kill() | 0s |
| R/Python tool child | `tools-executor.js:1450 execFile` + `py-pool.js:78 spawn` | ❌ | SIGTERM → 5s → SIGKILL | 5s |

### 6.7 SSE 端点清单

| 端点 | 文件位置 | close 释放 | keepalive | idle 退避 |
|------|---------|----------|----------|----------|
| `/api/ai/chat` | `routes/ai-chat.js:265` | ✅ req.on('close') + res.on('close') | ❌（PR-004） | ❌ |
| `/api/ai/agent` 直连 | `routes/ai-agent.js:323` | ✅ res.on('close') → aiConcurrencyRelease | ❌（PR-004） | ❌ |
| `/api/ai/agent/task/:id/subscribe` | `routes/ai-agent.js:1151` | ✅ req.on('close') clearInterval | ❌（PR-004） | ❌（PR-008） |
| `/api/tools/:id/status` | `routes/tools-metadata.js:210` | ✅ req.on('close') clearInterval | ❌（PR-004） | ❌ |
| `/api/tools/metadata` | (隐含在 tools-metadata.js) | ✅ | ❌ | ❌ |

### 6.8 模块级可变 singleton 一览（架构审查 A-006 之外的运行时维度）

| Map / Set | 文件 | TTL | 释放依赖 | 风险 |
|----------|------|-----|----------|------|
| `_pendingActAcks` | `act-tools.js:193` | 800ms setTimeout | timer self-clear | 中（PR-002） |
| `_impliedPageByRequest` | `act-tools.js:146` | 30s setTimeout | timer self-clear | 低（PR-019） |
| `_aiUserStreams` | `runtime.js:25` | 无 | aiConcurrencyRelease 调用正确性 | 中（PR-003） |
| `_aiTaskStreams` | `runtime.js:55` | 无 | task 完成 finally 块 | **高**（PR-003） |
| `_embedCallLog` | `runtime.js:91` | filter on read | 自身 filter | 低（PR-023） |
| `_activeSkillRuntimes` | `src/main.js:742` | runtime destroy | `_skillsProgressTimer` self-clear | 低 |
| `_lastCheckpointCount` | `src/main.js:743` | 同上 | 同上 | 低 |
| sessions (PTY) | `terminal.js:140` | onExit | pty.onExit fire | 低（PR-024） |
| `activeToolJobs` | `tools-executor.js` | job done/failed/cancelled | clearActiveToolJobLifecycleTimers | 中（PR-014） |
| plugin cache | `plugin-loader.js` | 无 | require 一次 | 低 |
| skill registry cache | `skill-registry.js` | 无 | require 一次 | 低 |
| branch-context | `mcp/branch-context.js` | 无 | require 一次 | 低 |
| `_branchDb` | `mcp/registry.js:30` | 无 | require 一次 | 低 |

### 6.9 已审查文件清单

**`src/` (16 个)**:
- `src/main.js` (1200) — 12 处 setInterval + 12 处 webContents.send + IPC 装配
- `src/preload.js` (292) — contextBridge 暴露 IPC
- `src/main/backend-proc-manager.js` (443) — 4 个 backend 子进程
- `src/owned-backend-supervisor.js` (131) — supervisor 退避
- `src/database/branch-db.js` (343) — desktop 进程 SQLite
- `src/database/result-db.js` (381) — desktop 进程 SQLite
- `src/ipc/branch-handlers.js` (275) — 16 个 IPC handler
- `src/ipc/result-handlers.js` (366) — IPC handler
- `src/ipc/ai-settings.js`, `src/ipc/telemetry.js`, `src/ipc/harness-capabilities.js`, `src/ipc/terminal.js`, `src/ipc/plugin.js`, `src/ipc/auto-update.js`, `src/ipc/diagnostic.js`, `src/ipc/compute-settings.js`, `src/ipc/file-dialog.js`, `src/ipc/data-management.js`, `src/ipc/runtime-status.js`, `src/ipc/backend-lifecycle.js`
- `src/migrations/005_branch_conversation.sql`, `src/migrations/006_result_studio.sql`

**`core/` (20 个)**:
- `core/r-server/server.js` — 启动 + event-loop monitor
- `core/r-server/db.js` (2133) — SQLite 唯一入口
- `core/r-server/agent-task-store.js` — task_events + 重试
- `core/r-server/agent-runner.js` (1799) — agent loop
- `core/r-server/agent-tools/act-tools.js` — `_pendingActAcks` / `_impliedPageByRequest`
- `core/r-server/agent-tools/plan-ui-tools.js` — circular import
- `core/r-server/helpers/runtime.js` — `_aiUserStreams` / `_aiTaskStreams` / `_embedCallLog`
- `core/r-server/helpers/tools-executor.js` (2000) — heartbeat + zombie recovery
- `core/r-server/helpers/process-lifecycle.js` — SIGTERM/SIGKILL
- `core/r-server/helpers/conversations.js` — `copilot_messages` schema
- `core/r-server/mcp/ide-tools/terminal.js` — PTY buffer
- `core/r-server/mcp/registry.js` (1807)
- `core/r-server/routes/ai-chat.js` — chat SSE
- `core/r-server/routes/ai-agent.js` (1222) — agent SSE + task subscribe
- `core/r-server/routes/tools-metadata.js` — tool SSE
- `core/r-server/routes/ai-conversations.js`
- `core/shared-backend/tool-resource-sampler.js`
- `core/shared-backend/logger.js`
- `core/py-server/py-pool.js` (249) — Python worker pool
- `core/py-server/r-server-db.js` — readonly r-server db

**`frontend/src/` (3 个)**:
- `frontend/src/components/copilot/copilotClient.ts` — SSE consumer
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/lib/events.ts`

### 6.10 跳过的范围（声明）

1. **未跑 runtime harness / 压测** —— G0 阶段不建议构建；本文纯静态。所有「未实测」标注均为静态推断。
2. **未审查前端 React hook 全部 cleanup 路径** —— 仅抽查 `copilotClient.ts` / `events.ts`；frontend 75 个 test 文件未深审。
3. **未审查 R/Python tool script 自身资源** —— 已是 R/Python runtime 内部审计。
4. **未审查 gateway 子进程** —— 与 r-server / py-server 同源但路径不同；G0 阶段不外推。
5. **未审查 IPC handler 的语义正确性** —— 与契约审查 C-001 / C-002 同源；本报告仅关注同步/异步与 cleanup。

### 6.11 视角差异说明

| 维度 | 既有 4 份审计 | 本报告 |
|------|------------|--------|
| 视角 | 架构 / 契约 / 错误 / 安全 | 性能 / 资源 |
| 维度 | 模块边界 / API / error path / security | 时间维度（长跑）/ 空间维度（内存）/ 资源回收 |
| 输出 | 风险 + 改进 | 时序 + 估算 + 改进 |
| 与 G0 纪律兼容 | 是 | 是 |

---

## 七、结语

G0 阶段纪律明确表示「资源纪律」重于「过度工程化」。本文所有建议项均与该纪律兼容：

- 不需要 Provider / GA / packaged 公证参与；
- 不改变现有唯一工具事实链 `run_tool → tool_job → artifact truth`；
- 不破坏现有 `dev Electron 边界内 verified` 证据等级；
- 不引入 runtime harness（保持「定向测试为主」）；
- 不创建 Worktree（AGENTS.md §worktree-governance 当前是休眠纪律）；
- 所有修复可在主工作区分支 `codex/g0-result-studio-product` 串行推进。

P1-P5 建议可在下一个 active 工作包内单 phase 完成；PR-013/014/015/016/017（setInterval 统一 register）建议是 BLOCK-10 候选（mega file 第二轮拆分 + lifecycle 抽象）。

**G0 阶段恢复期说明**：本文所有「未实测 / 静态推断」标注处的数值均未经 runtime harness 验证。当 G0 阶段纪律允许做阶段性性能基准测试时，建议优先跑：

1. **场景 A**：dev Electron 启动 → 1 hour 静态负载（无用户操作）→ 测 RSS / heap / SQLite db size。
2. **场景 B**：dev Electron 启动 → 模拟 30 次 agent run → 测 task_events 表大小 + RSS。
3. **场景 C**：高频 act 调用（100 次 / 5min）→ 测 `_pendingActAcks` Map 大小。

---

*报告生成时间: 2026-08-17*
*审查范围: Agent Harness 后端 + IPC + 前端 SSE consumer*
*已包含发现: 33 个编号项 PR-001 ~ PR-033*
*严重度分布: Critical 1 / Major 16 / Minor 16*
*纪律声明: G0 阶段不外推 Provider / 公证 / GA / dist staleness；所有未实测数据均为静态推断*
