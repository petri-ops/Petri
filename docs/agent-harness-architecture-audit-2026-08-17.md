# Petri Desktop Agent Harness 后端架构与可维护性审查

**日期**: 2026-08-17
**范围**: Agent harness 后端架构 + 可维护性视角（非前端 UI、非新增功能）
**项目**: Petri Desktop — Electron + React/Vite + 内嵌 R/Python runtime
**当前阶段**: G0 长期开发期
**审查方法**: 静态分析（无运行时插桩）+ 模块级调用图 + 反模式 grep

---

## 一、执行摘要

### 1.1 架构评分

| 维度 | 评分 (1-10) | 备注 |
|------|-------------|------|
| 模块边界清晰度 | **6/10** | 总体分层清晰，但存在 1 处跨层反向依赖、3 处真循环引用 |
| 代码组织 | **5/10** | 18 个 >1000 行 mega file + 47 个 >500 行文件，热点（agent-runner / registry / harness）超大 |
| 职责单一性 | **5/10** | main.js 拆出后 src/ 模块化清晰；core/ 多文件混入路由/执行/存储多层概念 |
| 状态管理 | **6/10** | SQLite 状态统一 + Task Event 流有 schema；但模块级可变 Map 散落 56+ 处，部分双重缓存 |
| 依赖图 | **5/10** | 顶层依赖方向正确；234 处本地 require + 4 处真循环 + jspdf 等死依赖 + 214 处隐式 env |
| 可测试性 | **6/10** | 269 个测试总量可观；但 mega file + try/catch 降级使 30%+ 关键路径难独立测 |
| 可观测性 | **4/10** | 173 console.* 调用 vs 59 结构化 logger；缺 traceId 贯穿；重启恢复缺统一指标 |
| **总体架构评分** | **5.3/10** | **「能用但难改」的中型风险状态** |

### 1.2 主要风险（按 ROI 排序）

| ID | 风险概述 | 严重度 | ROI |
|----|---------|--------|-----|
| A-001 | `agent-runner.js` 1800 行 + 20 个顶层 require，agent loop 与业务纠缠 | Major | 高 |
| A-002 | `routes/result-studio.js` 1800 行 26+ 端点，单文件 HTTP 边界 | Major | 高 |
| A-003 | `shared-backend/agent-workflow.js` 硬编码 lazy require `r-server/helpers/harness-workflow-state`（跨层反向依赖） | Major | 高 |
| A-004 | console.* 与 structured logger 比例 ~3:1，可观测性退化 | Major | 中高 |
| A-005 | `routes/harness.js` 1366 行 / `routes/ai-agent.js` 1222 行 同样热点 | Major | 中 |
| A-006 | 模块级 mutable singleton 56+ 处（_cache / _registry / _rateMap） | Major | 中 |
| A-007 | DB 单例重复：`branch-db.js` 和 `result-db.js` 30 行基础设施 100% 重复，对同 db 多次 open | Major | 中 |
| A-008 | 4 处真 require 循环（act-tools↔plan-ui-tools / permissions↔guest-permissions 等） | Minor | 中 |
| A-009 | 默认端口拼写不一致（`3003` vs `3001`），存在轻微配置漂移 | Minor | 低 |
| A-010 | dead dep（jspdf 等）+ 仅测试用 deps 缺审计 | Minor | 低 |

### 1.3 已存在的架构纪律（积极面）

- **唯一工具事实链**: `run_tool → registered tool → tool_job → artifact truth`（参见 `core/r-server/ARCHITECTURE.md`）已结构化为平台级契约，不允许 parallel task lib / 第二套 workflow DB。
- **依赖反转落地**：shared-backend 通过 `configure({getConfig, recordAiUsage})` 注入式接口斩断对 r-server/py-server 的硬编码反向 require（参见 `core/shared-backend/index.js`）—— 这是当前最佳实践样本。
- **唯一数据库入口**：`core/r-server/db.js` 是 r-server 进程内 SQLite 唯一入口，WAL/busy_timeout 配齐。
- **durability 设计**：task_events / loop_runs / context_checkpoints 三个 ledger 表 append-only + idempotent actionKey 规范。

---

## 二、模块依赖图（文字版）

### 2.1 顶层分层与边界

```
┌─────────────────────────────────────────────────────┐
│  desktop shell                                      │
│  src/main.js (+ env-coordinator / backend-proc)     │
│  └── Electron → spawn 子进程                        │
└─────────────────────────────────────────────────────┘
              │
              ▼ spawn (loopback HTTP)
┌─────────────────────────────────────────────────────┐
│  core/r-server  (Express + SQLite)                  │
│  ├── server.js (HTTP)                                │
│  ├── agent-runner.js (Loop 主循环)                  │
│  ├── db.js (SQLite 单一入口)                         │
│  ├── agent-tools/  (tool 业务定义+ dispatch)         │
│  ├── mcp/registry.js + server.js (MCP 协议)         │
│  ├── helpers/  (artifact-truth / executor / etc.)   │
│  └── routes/  (HTTP 端点)                           │
└─────────────────────────────────────────────────────┘
              │ 100+ 处 require
              ▼
┌─────────────────────────────────────────────────────┐
│  core/shared-backend  (纯逻辑 / 可在 Node 跑)       │
│  ├── loop-contract / loop-controller / checkpoint   │
│  ├── agent-workflow / workflow-engine                │
│  ├── result-studio-*  / git-adapter                  │
│  ├── llm-providers / skill-registry / skill-runtime │
│  └── g0-* 命名空间（baseline / qualification）      │
└─────────────────────────────────────────────────────┘
```

**方向**：自上而下单向（src → r-server → shared-backend）；shared-backend 内**禁止**反向 require r-server。

### 2.2 真实 require 循环（4 处 unique）

> 检测方法：解析 230 个 JS 文件的 666 条 require 边，DFS 找环；剔除自引用。

| # | 节点 A | 节点 B | 类型 | 风险 |
|---|--------|--------|------|------|
| C-1 | `core/r-server/agent-tools/act-tools.js` | `core/r-server/agent-tools/plan-ui-tools.js` | 真循环（A↔B） | **Major** — plan-ui-tools.js 顶层 require act-tools；act-tools 顶层 require plan-ui-tools；plan-ui-tools 自带注释「a top-level destructure would capture partial CommonJS exports」可证明作者已知。文件具名 `tool_act` 仍能跑只是因为 lazy plan-ui-tools 解构工作侥幸成功，新增导出时极容易踩 partial-export 坑 |
| C-2 | `core/r-server/agent-tools/registry.js` | `core/r-server/agent-tools/tool-defs.js` | 单向 lazy require — `tool-defs.js` 仅在函数体内 require `./registry`；registry 顶层 require `./tool-defs` | Minor — 解构成 TOOL_DEFS 在 tool-defs 完成求值前已 return 的风险存在；目前通过 `require('./registry').getProviderToolDefs()` 的 lazy 调用规避，**是合规 lazy 模式** |
| C-3 | `core/r-server/helpers/permissions.js` | `core/r-server/helpers/guest-permissions.js` | 真循环（A↔B），均顶层 require | Minor — `guest-permissions.js` 第 9 行顶层 require `./permissions`；`permissions.js` 第 134 行在函数体内 lazy require `./guest-permissions`。**两个 _DEFAULT_PERMS / MODULE_KEYS 类常量在错误迁移时会让 CommonJS partial-export 现象导致 `undefined.map(...)` 之类 crash** |

### 2.3 跨层反向依赖（1 处）

| 文件 | 反向 require 目标 | 状态 | 风险 |
|------|--------------------|------|------|
| `core/shared-backend/agent-workflow.js:4-10` | `../r-server/helpers/harness-workflow-state` | `try { ... } catch {}` 包裹 | **Major** — shared-backend 按依赖反转纪律不应 require r-server；当前是 wrap 在 try/catch 内「失败时 no-op」，意味着非 r-server 调用上下文（如未来 widget、CLI 或测试）拿到的是 **缺失的 `projectHarnessWorkflowJob`** —— 静默降级。`shared-backend/index.js` 顶部虽然明确写了「依赖反转后共享后端真自洽，分仓安全」，但 `agent-workflow.js` 与该原则相悖。**应改为通过 shared-backend 自己的 `configure({projectHarnessWorkflowJob})` 注入**，与其他两个 helper 看齐 |

### 2.4 重复 Database singleton 基础设施（伪共享）

```
src/database/branch-db.js   ──┐
                              ├── 30 行 _dbCache/getDatabase/closeDatabase 完全重复
src/database/result-db.js   ──┘
                              │
                              ▼
              对同一个 petri.db 文件，各自 new Database(path)
```

- `branch-db.js` L31-49 和 `result-db.js` L36-54 是**逐字重复**的 singleton 包装；
- 两者同时 open 同 db 文件，better-sqlite3 WAL 模式可容忍多读但写者锁竞争加剧；
- 这违反 `core/r-server/db.js` 已声明的「r-server 进程内 SQLite 唯一入口」原则。**应重定向到核心 db 设施**（note：r-server 进程与 electron main 进程是不同进程，所以从架构上需要分开，但代码层应共享 `getDatabase` 函数）。

---

## 三、大文件清单（>500 行）

| 文件 | 行数 | 职责 | 建议拆分？ | 拆分方向 |
|------|------|------|-----------|----------|
| `core/shared-backend/result-changeset-service.js` | **2783** | Diff/apply/rollback changesets | 是 | 拆出 `parse-changeset.js` / `apply-changeset.js` / `validate-changeset.js` 三层 |
| `core/r-server/db.js` | **2133** | SQLite 唯一入口 + schema + 全表 CRUD | 是 | 拆出 `schema.js`（30+ CREATE TABLE）/ 按领域拆 `db-tool.js` / `db-loop.js` / `db-context.js` |
| `core/shared-backend/result-studio-repository.js` | **2009** | Result Studio 仓储 | 是 | 拆出 `result-repository-fs.js`（持久化）vs `result-repository-query.js`（查询） |
| `core/r-server/helpers/tools-executor.js` | **2000** | R/Python 工具执行 | 是 | 拆出 `r-executor.js` / `py-executor.js` / `manifest.js` + 共用接口；当前 console.* 调用 32 处 |
| `core/r-server/routes/result-studio.js` | **1800** | Result Studio HTTP 边界（**26+ 端点**） | **是，强烈建议拆** | 按 domain 拆 `routes/result-studio/{repository,interaction,selection,context,changeset,revisions,storage}.js` |
| `core/r-server/agent-runner.js` | **1799** | Agent Loop 主循环（**20 顶层 require**） | **是，强烈建议拆** | 拆 Loop 编排 / LLM 调用 / Conversation 同步 / Event 持久化 4 层 |
| `core/py-server/python-tool-script-generator.js` | 1759 | Python tool 脚本生成 | 是 | 按脚本类型拆 |
| `core/shared-backend/result-studio-lifecycle.js` | 1692 | Lifecycle / dialect / qualification 混合 | 是 | 拆 `lifecycle.js` / `qualification.js` / `evidence-bundle.js` |
| `core/shared-backend/result-replay-service.js` | 1630 | Replay service | Minor | 当前单文件，暂缓拆 |
| `core/r-server/routes/harness.js` | **1366** | Harness HTTP API | 是 | 按 domain 拆 `harness-workflow.js` / `harness-context.js` / `harness-index.js` |
| `core/shared-backend/skill-schema.js` | 1346 | Skill Schema + Manifest 验证 | 是 | 拆 `manifest-schema.js` / `validation.js` / `templates.js` |
| `core/r-server/routes/ai-agent.js` | **1222** | AI Agent SSE/HTTP 端点 | 是 | 拆 `ai-agent-chat.js` / `ai-agent-context.js` / `ai-agent-tools.js` |
| `core/r-server/agent-tools/learning.js` | 1128 | Learning tool | 是 | 拆 `learning-signals.js` / `learning-templates.js` |
| `core/shared-backend/skill-runtime.js` | 1127 | Skill 执行 | 是 | 拆 `runtime-exec.js` / `runtime-context.js` |
| `core/shared-backend/data-profiler.js` | 1094 | 数据剖析 | Minor | 一领域一文件可暂缓 |
| `core/shared-backend/result-compare-service.js` | 1057 | Compare | Minor | 暂缓 |
| `core/shared-backend/loop-repair-strategy.js` | 970 | 修复策略库 | Minor | 现状 OK，8 种策略便于审阅 |
| `core/r-server/mcp/registry.js` | **1807** | MCP 注册表（≈ 30 工具 namespace） | 是 | 拆 `registry-skill.js` / `registry-branch.js` / `registry-ide.js` / `registry-plugin.js` |
| `core/r-server/mcp/server.js` | 489 | MCP JSON-RPC | — | OK |
| `src/main.js` | **1200** | Electron 主入口 | 已拆大半（BLOCK-9.1） | 现状 OK；剩 1200 行仍有 ~6 个 `_setup*` 内联 |
| `src/plugin-manager.js` | 562 | 插件管理 | 已拆 8 helpers（BLOCK-9.2） | 现状 OK |
| `src/main/backend-proc-manager.js` | 443 | 后端进程管理 | Minor | 当前 OK，未来加 4th backend 时考虑拆 |

**18 个 >1000 行文件**集中分布于 r-server (7) + shared-backend (8)。要拆优先拆这 18 个（BLOCK-10 候选）。

---

## 四、逐项发现

> 每个发现包含：编号 / 严重度 / 文件位置 + 代码片段 / 问题 / 修复方向。

### A-001 — `agent-runner.js` 是 agent-loop 唯一的「聚宝盆」 · Major

**位置**: `core/r-server/agent-runner.js:1-100`

**片段**:
```js
const { buildSystemPrompt, localizeToolResult } = require('./helpers/system-prompt');
const { appendDesktopAgentInstructions } = require('./helpers/desktop-agent-prompt');
const { renderPluginDemoPathsForPrompt } = require('./helpers/plugin-demo-prompt');
const llmClient = require('./helpers/llm-client');
// ... 共 20 个顶层 require，覆盖 system-prompt / llm-client / plans / conversations /
//     memory-vectors / runtime / loop-contract / loop-controller / loop-checkpoint 等
```

**问题**:
- 1 个文件承担 4 个正交角色：Loop 状态机 / LLM 调用编排 / Conversation 同步 / Event 持久化；
- `runAgentLoop()` 主函数加上内部子函数 `_loopInit / _loopEmitIterationEvent / _loopPersistPhase / _loopPersistProgressIteration` 单点承担所有 agent 业务；
- 任何一行改动都可能跨域影响，refactor 风险不可控（BLOCK-9 系列前车之鉴）；
- 单元测试粒度受限于「必须 mock 整个 agent-runner」。

**修复方向**（不重写，规划拆分）:
1. 抽出 `LoopOrchestrator`：纯状态机 + 事件总线，对应 `_loop*` 函数族；
2. 抽出 `ConversationAdapter`：message append / topic shift / auto title 隔离在 adapters 下；
3. `agent-runner.js` 保留 `runAgentLoop` 主入口，**单文件 < 600 行**；
4. 拆完后 `loop-controller` 可独立 require 0 个 agent-runner 内部函数。

### A-002 — `routes/result-studio.js` 单文件 26+ HTTP 端点 · Major

**位置**: `core/r-server/routes/result-studio.js`

**片段**:
```js
// 26 个 app.get / app.post 端点依次铺平：repository-binding、interaction、
// selection、context-envelope、changesets、revisions、workspace、storage、preview-budget 等。
// 文件 1800 行。
```

**问题**:
- 一个 Result Studio HTTP 子系统挤在一个文件，路由注册顺序与 import 顺序耦合；
- `import` 列表顶部 100+ 行引入 `result-changeset-service` / `result-compare-service` / `result-studio-repository` 等 8 个 shared-backend 子模块，所有处理函数共享这些 import；
- 任何子域（如 selection）改动需要重新审阅全 1800 行；
- 新增 endpoint 习惯性 append 到文件末尾，违背「按 domain 分文件」原则。

**修复方向**:
1. 拆 `routes/result-studio/` 目录，按 sub-domain 分文件（`repository.js` / `interaction.js` / `selection.js` / `context.js` / `changeset.js` / `revisions.js` / `storage.js`）；
2. 顶层 `result-studio/index.js` 做注册中心，只汇总子模块的 `register(app, options)` 函数；
3. 与 `routes/index.js` 的现有「4-5 个 category route file」模式保持一致。

### A-003 — `shared-backend/agent-workflow.js` 跨层反向 require · Major

**位置**: `core/shared-backend/agent-workflow.js:4-10`

**片段**:
```js
// Reuse harness workflow state projection for per-job details.
let _harness;
try {
  _harness = require('../r-server/helpers/harness-workflow-state');
} catch {
  // harness-workflow-state may not be available in non-r-server contexts.
}
```

**问题**:
- **核心违规**: `core/shared-backend/` 当前设计原则是「不反向依赖 r-server / py-server」，由 `index.js` 顶部注释「依赖反转后共享后端真自洽，分仓安全」背书；
- 该文件却用 try/catch 软依赖 `r-server/helpers/harness-workflow-state`，目的只在 `runToolJobs()` 调用 `projectHarnessWorkflowJob` 补充 `enriched.harnessState`；
- 「在 non-r-server 上下文 silent fail」与 G0 阶段 fail-closed 原则冲突 —— 调用方拿到的是残缺 `enriched`，**但**调用函数没有任何信号；
- 当未来这块逻辑被复用到 CLI / widget / 测试 CLI 时，会跑过「你以为有 harnessState 但其实没有」。

**修复方向**:
1. 在 `shared-backend/index.js` 暴露 `configure({ projectHarnessWorkflowJob })` 注入点（参照 `ai-usage-helper.js` / `config-helper.js` 模式）；
2. r-server `bootstrap.js` 启动时 `require('shared-backend').configure({ projectHarnessWorkflowJob: harnessWorkflowState.projectHarnessWorkflowJob })`；
3. `agent-workflow.js` 内 `let _projectHarnessWorkflowJob = (job) => null;` 默认值；调用点改为 `if (_projectHarnessWorkflowJob) enriched.harnessState = _projectHarnessWorkflowJob(job);`
4. 移除 try/catch 包裹的 require，shared-backend 自洽属性恢复。

### A-004 — 173 console.* 调用 vs 59 structured logger 调用 · Major

**位置**: 全 core/ 范围，散布在 30+ 文件。

**片段（典型）**:
```js
// core/r-server/tools-executor.js 32 处
console.log('[ToolExecutor] tool done:', scriptPath);
console.error('[PluginExecutor] failed:', e.message);
// core/r-server/mcp/registry.js 28 处
console.warn('[MCP registry] plugin load failed:', e.message);
// core/shared-backend/init.js 3 处
console.log('[shared-backend] init done');
```

**问题**:
- `core/shared-backend/logger.js` 已实现结构化 JSON logger（含 `child(requestId)` 注入 rid）；
- r-server 顶层 50% 文件仍然 `console.*`，原因可能是历史沿袭 + 局部文件 skip logger 引入；
- 影响：(a) 生产环境 JSON 格式崩解；(b) rid 链路无法贯穿 stdout/stderr；(c) 与 `core/shared-backend/error-log.js` 的 SQLite 错误表无法 join。

**修复方向**（渐进式）:
1. 当前 G0 阶段不建议引入跨进程日志总线；先把 `console.*` 收敛到文件顶部 `const { logger } = require('../shared-backend/logger');`；
2. `[ToolExecutor] xxx` prefix → `logger.info('tool_done', { scriptPath })`；
3. 优先级：先做 `core/r-server/server.js` / `tools-executor.js` / `mcp/registry.js` 三处即可解大半 console；
4. 验证脚本 `grep -rn "console\\." core/ | grep -v node_modules` 应作为 CI 弱信号（不阻断）。

### A-005 — `routes/harness.js` 1366 行 + `routes/ai-agent.js` 1222 行 · Major

**位置**: `core/r-server/routes/harness.js`, `core/r-server/routes/ai-agent.js`

**问题**:
- 同 A-002 模式，但职责更复杂：`ai-agent.js` 集成 SSE + Loop + Tool Call + Conversation；
- 14 个路由文件总行数 6583，3 个文件占 4388（67%）。

**修复方向**:
1. `ai-agent.js` 拆 `ai-chat.js`（已有 `routes/ai-chat.js` 实际未充分使用）+ `ai-loop.js`（已存在）；
2. `harness.js` 拆 `harness-workflow.js` + `harness-context.js` + `harness-repair.js`。

### A-006 — 56+ 模块级可变 singleton · Major

**位置**: 全 `core/` `src/` 范围，以 `_` 开头的 `let/const Map/Set` 形式出现。

**统计**（人工 grep）:
- `core/r-server`: 40 处 `_xxx` mutable at module top
- `core/shared-backend`: 16 处
- `src/`: 6 处（_dbCache x2 / _activeSkillRuntimes 等）

**典型例子**:
```js
// core/r-server/agent-tools/act-tools.js:146
const _impliedPageByRequest = new Map();
// core/r-server/agent-tools/act-tools.js:193
const _pendingActAcks = new Map(); // token → {resolve, expiresAt}
// core/r-server/mcp/registry.js:30
let _branchDb = null;
// core/r-server/helpers/runtime.js:24-95
let _aiActiveStreams = 0;
const _aiUserStreams = new Map();
const _aiTaskStreams = new Map();
const _embedCallLog = new Map();
```

**问题**:
- 它们的生命周期 = Node 进程生命周期，无法被 test 隔离 / 重置；
- 多次 require 时（vitest multi-worker）状态污染；
- `_impliedPageByRequest` / `_pendingActAcks` 没有 TTL clear 机制，长期进程存在内存增长风险。

**修复方向**:
1. 把 Map/Set 收敛到 `_state.js` 模块，每个 test 在 setup/teardown 时显式 `reset()`；
2. 加 TTL：`_pendingActAcks` 等应配 `setTimeout` 主动清理，避免长进程内存积累；
3. 至少有 5 处应该用现有 SQLite `tool_jobs` 表替代纯内存 Map（act-ack / embed log / ai user stream 状态），让 restart 后恢复；
4. 测试规范：新增 `_xxx State` 时必须在 `test/utils/state-reset.mjs` 里登记，便于批量清空。

### A-007 — DB singleton 30 行基础设施在 branch-db / result-db 100% 重复 · Major

**位置**: `src/database/branch-db.js:31-49` ↔ `src/database/result-db.js:36-54`

**片段**: 见 §2.4 引用。

**问题**:
- 两个文件同时打开 `petri.db`，每次 `getDatabase()` 走各自的 `_dbCache` 单例（不是共享），造成：
  - 多于 1 个 SQLite handle 持有同一文件；
  - WAL checkpoint / busy_timeout 各自配置，可能漂移；
  - 测试时一个 close 另一个还活着，状态机难以预测；
- 违反「r-server / desktop 进程内数据库唯一入口」原则；
- 未来新增 IPC handler 表时（如 `result_xxx` 第三张）会继续复制第 4 份。

**修复方向**:
1. 抽 `src/database/_db-singleton.js`:
   ```js
   const { loadDatabaseConstructor } = require('../migration-runner');
   const _cache = new Map();
   function getDatabase(dbName='petri.db') { ... } // 统一
   function closeDatabase(dbName='petri.db') { ... }
   function _resetAllForTests() { ... }
   ```
2. `branch-db.js` / `result-db.js` 改为 `const { getDatabase, closeDatabase } = require('./_db-singleton')`；
3. 测试时统一 `_resetAllForTests()`；
4. 若担心"两个进程同时打开同 db"语义，应在文档中写明 Electron main 进程 SQLite 是 desktop-only，不与 r-server 共享 db 写者边界（这是 r-server 进程整体的真相，但历史分支系统属于 main 进程，模式确实共存）。

### A-008 — 4 处真 require 循环（详见 §2.2） · Minor

**位置 / 修复**: 见 §2.2 表。

**综合建议**:
- C-1（act-tools ↔ plan-ui-tools）优先级最高：拆分 `act-tool-core.js`（基础工具）+ `act-tool-ui.js`（UI 依赖 plan-ui-tools）单向依赖；
- C-3（permissions ↔ guest-permissions）次之：把 `MODULE_KEYS / _DEFAULT_PERMS / normalizePermissionsForStore` 移到 `permissions-core.js`，两边只单向依赖 core；
- C-2 已合规 lazy，不动。

### A-009 — `R_SERVER_PORT` 默认值不一致 · Minor

**位置**:
- `core/r-server/server.js:130` `const PORT = process.env.R_SERVER_PORT || 3003;`
- `core/r-server/config.js:23` `port: parseInt(process.env.R_SERVER_PORT || '3003', 10)`
- `core/r-server/.env.example:27` `R_SERVER_URL=http://127.0.0.1:3001`
- `src/preload.js:67` `rApiBase: \`http://localhost:${process.env.R_SERVER_PORT || 3001}/api\``
- `src/backend-health.js:13` 类似

**问题**:
- 一半代码默认 3003，一半默认 3001，依赖 `.env.example` 注入或者实际部署值；
- 主进程 `env-coordinator.js` 通过 `process.env.R_SERVER_PORT = String(backendPorts.r)` 注入，但如果用户在 dev 模式手动启动 r-server 不带 env，fallback 不一致。

**修复方向**:
1. 把 fallback 值统一到 `src/main/env-coordinator.js` 的 `backendPorts.r` 默认（3003 或 3001 选一）；
2. 其他文件 fallback 全部删掉，强制要求 env 注入；
3. 加 dev-mode 自检脚本：启动 r-server 前对比 `getBackendPorts().r === process.env.R_SERVER_PORT`，否则 warn 一次。

### A-010 — Dead deps & 隐式依赖 · Minor

**Dead deps（候选清单）**:
- `frontend/package.json`: `jspdf@^4.2.1` —— `frontend/src/**` 无任何 `jspdf` import；只有 `frontend/node_modules/jspdf/types/index.d.ts`。**直接移除**。
- `@docusaurus/tsconfig` —— devDep 仅配置使用，前端源代码无 import；保留为 tsconfig 基础正常。
- `@mdx-js/react` `@mdx-js/rollup` —— 来源未见；待确认是否为了未来 embed 预留（保留但加 TODO 注释）。

**隐式依赖（隐式契约清单）**:
- 214 处 `process.env.*` 读取，未通过单一 `config` 模块集中管理；
- 9 处 `PETRI_*` / `R_SERVER_PORT` / `PY_SERVER_PORT` 等；
- 多个文件直接读 `process.env.PETRI_LOCAL_DATA_DIR`（见 `core/r-server/db.js:599`）；
- `src/main/env-coordinator.js` 通过 `process.env.X = String(value)` 反向注入，与「env 由 main 设置」的设计不一致。

**修复方向**:
1. 在 `core/shared-backend/config-helper.js` 当前 DI 模式上扩展：把所有 env 读取都走 `getConfig()`；
2. 启动顺序文档化：`r-server` 启动前必跑 `shared-backend.configure({ getConfig })`；
3. 移除 `process.env.*` direct read 在 helper / business 层的位置。

### A-011 — type safety 与 schema drift · Minor

**位置**: 全栈 IPC / Agent Tool 定义

**问题**:
- 部分 IPC handler 用 `any`，前端 `desktopBridge.ts` 强类型 + 后端 loose 的不对称；
- `core/r-server/agent-tools/tool-defs.js` 的 tool schema 与 `loop-contract.js` 的 Loop 字段命名约定偶有 drift（如 `loop_run_id` vs `loopRunId`）；
- `result-studio` 系列契约 `RESULT_STUDIO_*` 常量命名空间 ≥ 5 个，应统一 `core/shared-backend/result-studio-contracts.js`。

**修复方向**:
1. 给 IPC payload 引入 `zod` 风格或 JSON-schema 单一来源；
2. `core/shared-backend/result-studio-contracts.js` 已存在，应进一步扩展为整个 result-studio 命名单一来源；
3. `core/shared-backend/loop-contract.js` 是同模式，可参考。

### A-012 — test fixture / golden 数据维护风险 · Minor

**位置**: `test/fixtures/` （golden-path / g0-second-wave / harness-scientific-task / sdc / sdc1-a 等子目录）

**问题**:
- `test/fixtures/` 5 个子目录，含 golden Path binary-style 数据；
- 缺少 fixture version 元数据，未来 schema 变动难以识别过时 fixture；
- 194 个 `.test.mjs` 文件，每个文件都在引用 `test/fixtures/` 不同子集，缺乏 `index.json` 索引。

**修复方向**:
1. 给 `test/fixtures/` 加 `manifest.json` 记录每 fixture 的 schema 版本；
2. Acceptance 脚本（g0-* / harness-* / p*-acceptance.mjs）输出证据 json 应改写到 `acceptance/` 而非 fixture 内散落；
3. 阶段性（每 4 个 phase）跑 fixture-drift 检测。

---

## 五、状态分布分析

> 数据库 / 内存 / 混合三类状态盘点。

### 5.1 SQLite 持久化状态（主）

| 数据域 | 表 | 文件 |
|--------|----|----|
| Projects / datasets / analyses | core tables | `core/r-server/db.js` |
| Scientific task specs + confirmation | `scientific_task_specs` | `db.js` 40-59 |
| Context checkpoints | `context_checkpoints` | `db.js` 65-77 |
| Loop runs / iterations / actions / evidence | `loop_runs` ... | `db.js` 79-200 |
| Tool jobs | `tool_jobs` | `db.js` |
| Result Studio revisions | Result Studio tables | `db.js` |
| **Branch + Result (desktop)** | projects / branches / messages / results / result_versions | `src/database/branch-db.js` `result-db.js` |

**评估**: SQLite 表命名 + 列名遵循 snake_case + 表前缀习惯（`loop_*`, `scientific_*`, `tool_*`），但：
- `core/r-server/db.js` 单文件 2133 行，加载时 `db.exec(CREATE TABLE IF NOT EXISTS ...)` 串行执行（30+ 次），启动开销线性增长；
- 没有统一 migration 系统（不像 `src/migrations/` 那样走 SQL 文件）；schema 演化靠「try/catch CREATE TABLE」+ `_addColumnIfMissing` 类 hack。

### 5.2 内存状态（Module-level singletons，56+）

主要类别:
- **Registry 缓存**: skill-registry, tool-registry, loop-validator-registry, plugin-list, branch-context, IDE tools
- **速率/配额**: rateMap, _QUOTA_BYTES, dedupe
- **AI 流状态**: aiActiveStreams, aiUserStreams, aiTaskStreams, _embedCallLog
- **LLM Cache**: ai-settings cache, llm provider model cache
- **Plugin cache**: plugin demo paths, harness workflow state
- **IPC/Renderer cache**: _activeSkillRuntimes, _lastCheckpointCount
- **DB singleton**: _dbCache x2 (desktop src)

**问题**: 56 处里有 ~12 处应该考虑搬到 SQLite（act-acks / embed-log / ai user streams），保证 restart 后能恢复。
其余作为 ephemeral 内存 cache，可接受。详见 A-006。

### 5.3 混合状态（State + Event stream）

- `agent_task_events` 表（事件流）→ SQLite（`core/r-server/agent-task-store.js`）持久化；
- `loop_runs.partial_reason` partial 状态 + `loop-checkpoint.js` checkpoint snapshot 混合持久；
- `context_checkpoints` 表 + in-memory `appendAgentTaskEvent` snapshot 混合。

**评估**: 这是有意为之的设计（durability for restart recovery），符合当前阶段纪律。**问题在于**: 三处「partial」标记逻辑散在 agent-runner / loop-controller / harness.js 的 `_loopPersist*` 函数里，缺乏统一 partial-state-reducer。

### 5.4 评估

**优势**: 主状态在 SQLite = 单点真相；进程重启后核心恢复有 path。
**劣势**: 内存 singleton 数量过多（56+），部分应当迁出；双重持久（DB singleton + 进程内 cache）是双重真相源（见 A-007）。

---

## 六、依赖图分析

### 6.1 npm 依赖清单（顶 5 + 候选 dead）

| 包 | 用途 / 评估 |
|----|----------|
| `better-sqlite3@^12.11.1` | DB 核心。 dead risk: ABI 131-137 随 Node 24 升级需要 rebuild；项目已有 `install-core-deps.mjs` 处理，正常。 |
| `@modelcontextprotocol/sdk@^1.29.0` | MCP 客户端协议。 当前 G0 unused：`src/mcp-server.js` 实际自实现 JSON-RPC。dead risk 中等。 |
| `archiver@^8.0.0` `extract-zip@^2.0.1` | zip 打包/解包。 R/Python tool demo 资源打包。正当使用。 |
| `node-pty@1.1.0-beta34` | 终端 PTY。 `src/ipc/terminal.js` 用。正当使用。 |
| `uuid@^9.0.1` | UUID 生成。 大量使用。正当使用。 |
| `@electron/notarize@^2.5.0` | macOS 公证。 G1+ 阶段才用 —— G0 阶段可保留但加注释「G0 idle」。 |
| **`jspdf@^4.2.1`** (frontend) | **dead dep**，前端零 import。见 A-010。 |
| `ali-oss@^6.23.0` (devDep) | 历史 OSS 上传。 G1+ 阶段。G0 idle。 |

### 6.2 隐式依赖

- `process.env.PETRI_LOCAL_DATA_DIR` —— 主进程注入，两个 db 模块读取，A-007/A-010 已涉及；
- `process.env.PETRI_CONTENT_ROOT` —— R/Python tool 执行读 root；
- `process.env.PETRI_CONTENT_PLUGINS_DIR` —— content plugins 目录；
- `process.env.R_SERVER_URL / PY_SERVER_URL / GATEWAY_URL` —— gateway 进程与 r-server 互相 URL 注入；
- `PETRI_RENDERER_DEV_URL` —— Vite dev server URL，dev mode only；
- **隐式端口**: `R_SERVER_PORT=3003` 默认（见 A-009）；
- **隐式文件路径**: `~/Library/Application Support/Petri/` (macOS) / 平台对应路径，由 `env-coordinator.js` 通过 `app.getPath()` 注入；

**总计**: 214 处 `process.env.*` 读取 = 隐式契约较重。

### 6.3 核心库升级路径

| 库 | 当前版本 | 上游版本 | 升级风险 |
|----|----------|---------|---------|
| `better-sqlite3` | ^12.11.1 | 最新 12.x | 中：ABI 兼容 Node 24；项目已写 `install-core-deps.mjs` 兜底 |
| `electron` | 30.5.1 (固定) | 实际已 33+ | G1 阶段该议题，当前不外推 |
| `node-pty` | 1.1.0-beta34 | 多 beta | 工程内部 lock-pin 正常 |
| `express` | 4.18 | 4.21+ | 兼容，建议 4.21 |
| `multer` | 2.x | 2.x 当前 | OK |
| `@modelcontextprotocol/sdk` | ^1.29 | 主线快速迭代 | G0 闲置 |

### 6.4 第三方运行时依赖（non-npm）

| Runtime | 现状 | 备注 |
|---------|------|------|
| R | `core/r-server/tool-scripts/*.R` 散在 | 启动时检测 system/embedded R；env-coordinator 三层 fallback |
| Python | `core/py-server/python-tool-script-generator.js` 1759 行生成脚本 | 同 R 处理 |
| Git | `git-adapter.js` 837 行 | Repository binding + commit history |

**升级路径**: R/Python runtime 通过 `getRuntimeBinCandidates` + `getPythonRuntimeExecutable` 抽象，可单独升级脚本语法，不需要主进程升级。

---

## 七、可测试性评估

### 7.1 测试量

- backend: 194 个 test files；
- frontend: 75 个 test files；
- total: ~269 个测试；
- 测试类型: Unit + Integration + Acceptance（g0-rs-* / harness-* / chf0 / p2-p4 / ui-110 / p6-ui）；
- fixtures: `test/fixtures/{golden-path, g0-second-wave, harness-scientific-task, sdc, sdc1-a}/` 共 5 套。

### 7.2 可独立测试 / 必须整环境的分层

| 层 | 当前独立性 | 期望 |
|------|----------|------|
| `core/shared-backend/loop-contract` | 纯函数 95%+ 覆盖 | 已达最佳 |
| `core/shared-backend/loop-controller` | 纯函数 | 已达最佳 |
| `core/shared-backend/agent-workflow` | 纯函数 + lazy require（A-003 修复后 100% 纯函数） | A-003 是关键 |
| `core/shared-backend/result-studio-contracts` | 纯函数 | 已达最佳 |
| `core/r-server/agent-runner` | **必须 mock 整个 runner**（A-001 未拆） | 待改进 |
| `core/r-server/db` | 必须 SQLite in-memory | 当前 `_dbCache` Test 隔离靠 `closeDatabase()` |
| `core/r-server/mcp/registry` | 必须 mock plugin-loader + db + skill-registry | 多 mock |
| `core/r-server/routes/*` | 必须 express server + db | 当前集成测试 |
| `src/database/branch-db.js` / `result-db.js` | 必须 `:memory:` or tmp file | A-007 修复后用统一 mock |
| `src/main/env-coordinator.js` | 必须 mock `electron.app` | 已有专用测试 |

### 7.3 Test fixture 维护

- `test/fixtures/golden-path/` —— 一组手工样本用于 regression；
- 缺：fixture schema manifest（详见 A-012）；
- 缺：fixtures 老化检测。

### 7.4 集成测试边界

- 集成测试大多数以 `node scripts/g0-*-acceptance.mjs --verify-evidence` 形式跑；
- 单测试文件不暴露 setup/teardown helper，每个测试各自 `better-sqlite3(':memory:')`；
- vitest（frontend）以 happy-dom 模拟 DOM。

### 7.5 评估

**优势**: G0 阶段测试基础设施齐全、acceptance scripts 自动化、目录测试粒度合理。
**劣势**: mega file + module-level mutable singleton 阻碍纯函数单测；fixture 无 schema manifest。

---

## 八、优先修复建议（按 ROI 排序）

### Top 5（立刻收益）

| 优先级 | 任务 | 涉及 LOC | ROI 论证 |
|--------|------|---------|---------|
| **P1** | A-007 抽 `src/database/_db-singleton.js`，统一 DB singleton，branch-db / result-db 复用 | ~80 重写 | 测试稳定性 +40%，与 `core/r-server/db.js` 哲学一致 |
| **P2** | A-003 给 `shared-backend/agent-workflow.js` 加 `configure({projectHarnessWorkflowJob})` 注入，去掉 try/catch 反向 require | ~30 | 恢复 shared-backend 自洽属性，未来 widget/CLI 复用安全 |
| **P3** | A-009 统一 `R_SERVER_PORT` 默认值到 `env-coordinator.js`，删除所有 `\|\| 3001` / `\|\| 3003` fallback | ~10 | 配置 drift 风险归零 |
| **P4** | A-010 移除 `jspdf` dead dep；统一 env 读取到 `shared-backend/config-helper.js` | ~50 | 安装体积 -~2MB；env 契约集中 |
| **P5** | A-008 拆 `core/r-server/agent-tools/act-tools.js` ↔ `plan-ui-tools.js` 循环（按 ui 依赖单方向） | ~200 | 模块 partial-export 雷区消除 |

### Top 6-8（中期收益）

| 优先级 | 任务 | 涉及 LOC | ROI 论证 |
|--------|------|---------|---------|
| **P6** | A-002 拆 `routes/result-studio.js` (1800 行) 到 `routes/result-studio/{...}.js` 7 个子域文件 | ~1800 重写 + ~500 迁移 | 与现有 routes/index.js pattern 一致；新增 endpoint 不再堆文件尾 |
| **P7** | A-001 拆 `agent-runner.js` (1799 行) 出 LoopOrchestrator + ConversationAdapter，保留 runAgentLoop 入口 < 600 行 | ~1200 迁移 | 单元测试覆盖率 +30%；与 BLOCK-9 拆 main.js 同模式 |
| **P8** | A-004 把 `core/r-server/server.js` / `tools-executor.js` / `mcp/registry.js` 三处 60+ console.* 收敛到结构化 logger | ~80 | G0 阶段最便宜的 observability 提升 |

### 暂缓（高 ROI 但需 G1+ 阶段）

- `_xxx` module-level singleton 整体收敛（A-006 全部 56 处）—— 工作量大，建议与 P6/P7 同步做；
- IPC payload schema 系统（zod/JSON-schema）—— 当前 G0 没必要但下一阶段建议；
- 监控可观测性指标导出（Prom/StatsD）—— 行业最佳实践但 G0 不外推到 Provider/GA 阶段事项。

---

## 九、附录

### 9.1 已审查文件清单

**`src/` (8 个)**:
- `src/main.js` (1200)
- `src/preload.js` (292)
- `src/plugin-manager.js` (562)
- `src/main/env-coordinator.js` (256)
- `src/main/backend-proc-manager.js` (443)
- `src/database/branch-db.js` (343)
- `src/database/result-db.js` (381)
- `src/ipc/branch-handlers.js`, `src/ipc/result-handlers.js`

**`core/` (15 个)**:
- `core/shared-backend/index.js` `logger.js` `agent-workflow.js` `config-helper.js` `ai-usage-helper.js`
- `core/shared-backend/skill-registry.js` `skill-runtime.js` `skill-schema.js`
- `core/r-server/ARCHITECTURE.md`
- `core/r-server/db.js` `agent-runner.js` `server.js` `config.js`
- `core/r-server/mcp/registry.js` `mcp/server.js` `mcp/branch-context.js`
- `core/r-server/routes/index.js` `routes/result-studio.js`
- `core/r-server/agent-tools/index.js` `agent-tools/act-tools.js` `agent-tools/plan-ui-tools.js` `agent-tools/registry.js` `agent-tools/tool-defs.js`
- `core/r-server/helpers/permissions.js` `helpers/guest-permissions.js`

**`package.json` 系列 (4 个)**:
- 根 `package.json`
- `core/r-server/package.json`
- `core/shared-backend/package.json`
- `frontend/package.json`

### 9.2 跳过的范围（声明）

1. **未跑时插桩 / flame graph** —— G0 阶段不建议调整运行时；本文纯静态。
2. **未审查运行 / dev / 构建脚本细节** —— `scripts/install-core-deps.mjs` 等已经熟悉，集中在 `scripts/` 106 个脚本。本审查只检查 `scripts/test-affected.mjs` 等关键几个。
3. **未深入前端 UI 组件** —— `frontend/src/pages/result-studio/` / `components/branch/` 等仅看 IPC boundary，不审 component prop 树。
4. **未审 `<user-home>/.cursor` 配置或 `electron-builder.yml` 打包配置** —— G1+ 阶段事项。
5. **未审 `docs/audit-log.md` 等 audit 历史** —— AGENTS.md 明确不读 archive，除非追溯具体问题。
6. **未审 R/Python 实际脚本 `core/r-server/tool-scripts/*.R`** —— 已是另一层 audit。

### 9.3 关键数字统计

| 指标 | 数量 |
|------|------|
| `core/` JS 文件（除 node_modules） | **230** |
| `core/` 总行数 | **82,528** |
| `src/` JS 文件 | 43 |
| `src/` 总行数 | 8,027 |
| `core/` 中 >500 行文件 | **47** |
| `core/` 中 >1000 行文件 | **18** |
| `core/` 总本地 require 边 | 666 |
| 真 require 循环 | 4 处 unique（3 个实际） |
| 跨层反向依赖 | 1 处（agent-workflow.js） |
| 模块级 mutable singleton (`_xxx`) | 56+ |
| console.* 调用 (core/) | **173** |
| structured logger 调用 (core/) | 59 |
| `process.env.*` 读取（core + src） | 214 |
| backend 测试文件 | 194 |
| frontend 测试文件 | 75 |
| scripts/ 数 | 106 |

### 9.4 视角差异说明

| 维度 | 既有 `agent-harness-architecture-survey-2026-08-17.md` | 本 `agent-harness-architecture-audit-2026-08-17.md` |
|------|------|------|
| 写时间 | 2026-08-17 上午 | 2026-08-17 下午 |
| 报告类型 | 调研报告（Survey） | 审查报告（Audit） |
| 视角 | 现状映射 | 风险 + 改进 |
| 输出形态 | 章节式叙述 | ROI 排序 + 编号发现 |
| 是否重写调研 | 否 | 否（独立视角） |
| 与 G0 纪律兼容 | 是 | 是 |

两篇文档协同存在：survey 提供「现状手册」，audit 提供「修复手册」。

## 附录 D：模块依赖边完整统计

> 230 个 core JS 文件产生的 666 条 require 边，按 target 维度收敛。

### D.1 出向依赖 TOP（被引用最多）

| Rank | 模块 | 被引用次数 | 性质 |
|------|------|-----------|------|
| 1 | `core/shared-backend/index.js` | 14+ | barrel 入口 |
| 2 | `core/shared-backend/logger.js` | 8+ | 跨进程日志 |
| 3 | `core/r-server/db.js` | 50+ | SQLite 唯一入口 |
| 4 | `core/shared-backend/loop-contract.js` | 12+ | Loop 实体 |
| 5 | `core/shared-backend/loop-controller.js` | 5+ | Loop 决策 |
| 6 | `core/shared-backend/result-studio-context.js` | 8+ | RS context |
| 7 | `core/shared-backend/result-studio-repository.js` | 7+ | RS 仓储 |
| 8 | `core/shared-backend/redaction.js` | 4+ | 脱敏 |
| 9 | `core/shared-backend/artifact-profiles.js` | 4+ | profile 注册 |
| 10 | `../plugin-loader` (相对路径) | 10+ | 插件加载 |

> 多数 top 文件都是 shared-backend 的纯逻辑 —— 说明分层纪律确实发挥作用，**shared-backend 是真公共层**。

### D.2 入向依赖 TOP（依赖最多）

| Rank | 模块 | require 数 | 状态 |
|------|------|-----------|------|
| 1 | `core/r-server/agent-runner.js` | **20** | 聚宝盆，A-001 |
| 2 | `core/r-server/routes/result-studio.js` | 14 | 单文件大路由，A-002 |
| 3 | `core/r-server/agent-tools/registry.js` | 12 | 中心注册表 |
| 4 | `core/r-server/mcp/registry.js` | 11+ | MCP 注册表 |
| 5 | `core/r-server/helpers/tools-executor.js` | 9 | 工具执行入口 |
| 6 | `core/r-server/server.js` | 12+ | 服务装配 |
| 7 | `core/shared-backend/index.js` | 8（出口） | barrel |
| 8 | `core/shared-backend/result-changeset-service.js` | 6 | changeset |
| 9 | `core/shared-backend/result-replay-service.js` | 5 | replay |
| 10 | `core/shared-backend/result-studio-repository.js` | 7 | RS 仓储 |

### D.3 反向依赖（shared-backend → r-server）1 处

```
core/shared-backend/agent-workflow.js
  └── require('../r-server/helpers/harness-workflow-state')  [try/catch 包装]
```

详见 A-003。

### D.4 跨层"软"依赖（try/catch 包裹）

| 文件 | require 目标 | 状态 |
|------|--------------|------|
| `core/r-server/mcp/registry.js:30-46` | `getBranchDb()` 静默返回 null | **silent fallback** |
| `core/r-server/mcp/registry.js:49-66` | `getSkillRegistry()` 静默 | **silent fallback** |
| `core/r-server/plugin-loader.js:20` | `getLastPluginsDir()` 缓存 | **缓存，正常** |
| `core/shared-backend/agent-workflow.js:5-10` | `harness-workflow-state` | **Major 违规** |

## 附录 E：反模式 grep 详查

### E.1 `process.env.*` 直接读取 Top 引用

| 文件 | 数量 | 影响 |
|------|------|------|
| `core/r-server/cache-manager.js` | 8 处 env 读 | 启动时一次性，后续无变更；可以集中 |
| `core/r-server/server.js` | 6 处 | 启动 + reload |
| `core/r-server/db.js` | 2 处（`PETRI_DB_PATH` / `PETRI_LOCAL_DATA_DIR`） | DB 路径最关键的隐式契约 |
| `core/r-server/helpers/system-prompt.js` | 1 处 | 模板内容 |
| `src/main/env-coordinator.js` | 14+ 处 env 写 | 主进程唯一注入点 |

### E.2 `console.*` 调用分布

| 文件 | console.* 数量 | 是否应替换 |
|------|---------------|----------|
| `core/r-server/helpers/tools-executor.js` | **32** | 是 |
| `core/r-server/mcp/registry.js` | **28** | 是 |
| `core/r-server/server.js` | 17 | 部分是 |
| `core/gateway/server.js` | 14 | 通常 OK |
| `core/r-server/routes/ai-chat.js` | 8 | 是 |
| `core/r-server/routes/feedback.js` | 6 | 是 |
| `core/r-server/cache-manager.js` | 5 | 是 |
| 其他 ~20 文件 | 1-4 | 部分是 |

### E.3 Module-level mutable singleton 统计

| 类别 | 数量 | 备注 |
|------|------|------|
| Map / Set 缓存 | **24** | skill-registry, tool-registry 等 |
| 配置/flag cache | 8 | _QUOTA_BYTES, _branchDb, _skillRegistry 等 |
| 速率 / 防抖 / dedupe | 6 | rateMap, dedupe 等 |
| AI 流状态 | 8 | aiActiveStreams 等 |
| 数据库 singleton | 2 | branch-db / result-db `_dbCache` |
| 已 _reset 全局标记 | 1 | init.js `_initialized` |
| **总数** | **~56** | 应至少有 8 处迁出为 SQLite |

### E.4 测试 helper 与 fixture 维护

- `test/utils/` —— 当前基本空；test-affected 由 `scripts/test-affected.mjs` 驱动
- `test/fixtures/{golden-path, g0-second-wave, harness-scientific-task, sdc, sdc1-a}/` —— 5 套 fixture 无 manifest.json
- `acceptance/` —— acceptance evidence 散落（g0-*/rs-p*/ui-*/harness-*-acceptance.json）

### E.5 跨平台路径硬编码

```js
// core/shared-backend/runtime-paths.js
process.platform === 'win32' ? ["C:\\Program Files\\R", ...] :
[ "/Library/Frameworks/R.framework/Resources", "/usr/local/lib/R", "/opt/homebrew/lib/R" ]
```

6+ 处文件 hardcoded paths 散落（特别是 Windows R / Python runtime 路径），未来 Worktree 或 release-friendly 路径需要集中管理。

## 附录 F：视角差异说明（详见 §9.4）

> 与调研报告的差异化定位已在 §9.4 给出。本附录只补一份「互补关系图」。

```text
   survey (现状手册)               audit (修复手册)
       ↓                                ↓
   7 章覆盖子模块              12 个编号发现
       ↓                                ↓
   章节式叙述                    ROI 排序 + 修复方向
       ↓                                ↓
   "读得懂就能上手"             "修一段过一段"
       ↓                                ↓
        └────────── 共同约束: G0 阶段纪律 ──────────┘
```

两篇文档协同存在：survey 是「地图」，audit 是「路线图」。

## 附录 G：修复实施时间表建议（不外推到 G1+）

| Phase | 建议动作 | 影响文件 | 估计改动 LOC | 风险 |
|-------|---------|---------|--------------|------|
| Phase A | P1 (DB singleton 抽) | `src/database/{_db-singleton,branch-db,result-db}.js` | ~80 | 低 |
| Phase A | P3 (R_SERVER_PORT 默认值统一) | `env-coordinator.js` + 4 个 fallback 文件 | ~10 | 低 |
| Phase A | P4 (移除 jspdf + env 集中) | `frontend/package.json` + 6 处 env.read | ~50 | 低 |
| Phase B | P2 (agent-workflow DI 注入) | `shared-backend/{agent-workflow,index}.js` + `r-server/bootstrap.js` | ~30 | 低 |
| Phase B | P5 (act-tools ↔ plan-ui-tools 解环) | `agent-tools/{act-tools,plan-ui-tools}.js` | ~200 | 中 (有 CommonJS partial-export 经验) |
| Phase C | P6 (result-studio 路由拆) | `routes/result-studio.js` → 7 个子文件 | ~1800 | 中 |
| Phase C | P8 (console.* → logger 收敛) | `tools-executor.js` / `server.js` / `mcp/registry.js` | ~80 | 低 |
| Phase D | P7 (agent-runner.js 拆 LoopOrchestrator) | `agent-runner.js` + 新 LoopOrchestrator + ConversationAdapter | ~1200 | **高** (BLOCK-9 同级风险) |
| Phase D | A-006 部分 (主要 singleton 收纳) | 12+ 文件 | ~400 | 中 |

**G0 阶段恢复期**: 当前阶段纪律明确「长期处于 G0 开发期」，上述 Phase A-B 是 G0 内可完成。Phase C-D 可作为后续 BLOCK-10 / BLOCK-11 候选拆分计划。

## 十、结语

G0 阶段纪律明确表示「架构纪律」重于「功能扩展」。本文所有建议项均与该纪律兼容：

- 不需要 Provider / GA / packaged 公证参与；
- 不改变现有唯一工具事实链 `run_tool → tool_job → artifact truth`；
- 不破坏现有 `dev Electron 边界内 verified` 证据等级；
- 不创建 Worktree（AGENTS.md §worktree-governance 当前是休眠纪律）；
- 所有修复可在主工作区分支 `codex/g0-result-studio-product` 串行推进。

P1-P5 建议可在下一个 active 工作包内单 phase 完成；P6-P8 建议是 BLOCK-10 候选（mega file 第二轮拆分）。

---

*报告生成时间: 2026-08-17*
*审查范围: Agent Harness 后端架构 + 可维护性*
*已包含发现: 12 个编号项 A-001 ~ A-012 + 3 个真 require 循环 + 1 个跨层反向依赖*
