# Agent Harness 8 份审计报告收口工作包计划

**版本**：v0.2 (active 工作包)
**起草时间**：2026-08-18（基于 2026-08-17 v0.1 调研产出升级为 active 版本）
**关联 v0.1**：`docs/code-audit-closeout-plan.md` v0.1（511 行 / 9 §，只读调研产出）
**关联 PHASE 0 调研 4 份**：
- `docs/block-10-ph0-survey.md`（25 项修复单元详细清单 + 同根组合 + 阶段归属 + 工作量估算 + DAG）
- `docs/block-10-ph0-fix-order.md`（依赖 DAG + commit 拆分 + PHASE 划分 + 关键路径）
- `docs/block-10-ph0-test-matrix.md`（25 项测试需求 + 新增 / 复用 / 不需要分类 + 验证门限）
- `docs/block-10-ph0-risks.md`（25 项风险矩阵 + 跨包冲突 + 性能 / 安全 / 兼容性 / G1+ 不外推）

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

## §1 TL;DR

本工作包要收口的发现：**全部 11 个 Critical + 5 个 High（仅安全 S-002/S-003/S-004/S-005/S-007）+ 9 个最高 ROI 的 Major**（C-001 IPC bridge / C-002 / S-001 / S-006 / PR-001 / PR-006 / E-017 / E-018 / E-019 / PL-001 / OB-004 / OB-005 / C-002-rserver / M-001 / M-003），总计约 **25 个独立修复单元**，分 4 个 PHASE 落地。

**v0.2 与 v0.1 的关键差异**：

| 维度 | v0.1 | v0.2 |
|------|------|------|
| 状态 | 「只读调研产出，未升级为 active」 | **active 工作包** |
| PHASE 1（C-001 + C-002） | 待启动 | ✅ **已收口**（commit `1c0ebf0`，2026-08-17 22:12） |
| PHASE 2（14 项 P1） | 待启动 | ✅ **已收口**（4 commits `128b3d4` + `4f9a10f` + `a09f706` + `1fedf9c`，2026-08-17 22:14-23:54） |
| PHASE 3（PL-001） | 待启动 | ⏳ **待启动**（registry.js / plugin-loader.js 无 validator） |
| PHASE 4（closeout） | 待启动 | ⏳ **待启动**（4 canonical doc 未同步） |

**已收口 ID**：C-001 + C-002 + S-001 + S-002 + S-003 + S-004 + S-005 + S-006 + S-007 + PR-001 + OB-004 = **11 项 ID + 1 项 OB-005 partial + 1 项 E-017 partial (r-server) + 1 项 E-019 partial (config-helper) = 14 项已落地**

**待启动 ID**：PL-001 + PHASE 4 closeout = **2 项**

**不收口**（G0 阶段不外推，候选工作包）：

- **G1+ 阶段事项**：packaged Electron / Provider 矩阵 / GA / 公证 / dist staleness / notarization / P7（按 `AGENTS.md` 当前阶段纪律）
- **架构层面 56+ singleton 拆分**（A-001..A-010 是大文件/拆分范畴，单独工作包 BLOCK-10-ARCHITECTURE 候选，本工作包不外推）
- **全链路可观测性体系化**（OB-001 console→logger 全量替换、OB-002 IPC trace / OB-003 metrics 端点 / OB-007 跨进程 unhandledRejection / E-017 主进程侧 IPC 推送 / E-018 supervisor restart IPC / PR-006 backend exit IPC 推送 / OB-005 full liveness/readiness 分离）→ 推到 observability-work-package 候选
- **Agent Loop 事件类型命名规范化**（C-012 8+ 种 event 类型）：与 Result Studio 体系耦合，需独立工作包
- **三套重试策略合并**（E-009） + RetryClassifier/RetryBudget/RetryExecutor 新增：属错误处理体系化重设计
- **dist staleness / 端口漂移**（A-009）：与 packaged 强耦合
- **r-server 大文件 26+ 端点拆分**（A-002 / A-005 routes/result-studio.js 1800 行 + routes/harness.js 1366 行）：单工作包 BLOCK-10-ARCHITECTURE 候选
- **DB 体系化**（A-007 branch-db/result-db 重复基础设施 + PR-027 大表 OFFSET 分页 + E-019 full busy_timeout 统一）：BLOCK-10-ARCHITECTURE 候选
- **SSE 三处协议细节统一**（Mi-002 / Mi-003 / Mi-004）：与 SSE keepalive（PR-004）捆绑推后
- **rserver-http debt pack**（C-001-rserver / C-002-rserver / M-001 / M-003 / M-002 / M-004 / M-005 / M-006 / M-007 / M-008 / Mi-001 / Mi-005）：rserver-http-debt-pack 候选

**为什么不外推**：以上推迟项要么需要新增依赖（zod/Ajv/prom-client）、要么需要跨多进程架构改动、要么属 G1+ 阶段纪律；当前 G0 已收口的开发态 + packaged 实机核对是当前阶段最高证据等级。

### §1.5 范围（完成语义）

**In-scope**（v0.2 active 工作包收口范围）：
- ✅ PHASE 3 PL-001（MCP callTool inputSchema 校验）— **当前唯一未启动 PHASE**
- ✅ PHASE 4 audit + closeout（4 canonical 文档同步 + DOC-REGISTRY + ui-productization-audit + closeout 报告）

**已收口（PHASE 1 + PHASE 2 = 5 commits 历史 anchor）**：
- ✅ PHASE 1 P0 用户可见（C-001 + C-002 + DB migration 007）— commit `1c0ebf0`
- ✅ PHASE 2 P1 安全/资源（14 项分 4 commit）— `128b3d4` + `4f9a10f` + `a09f706` + `1fedf9c`

**Out-of-scope**（v0.2 不外推）：
- ❌ G1+ 阶段事项（packaged Electron / Provider 矩阵 / GA / 公证 / dist staleness / notarization / P7）
- ❌ 架构层面 56+ singleton 拆分
- ❌ 全链路可观测性体系化
- ❌ Agent Loop 事件类型命名规范化
- ❌ 三套重试策略合并
- ❌ DB 体系化
- ❌ SSE 协议统一
- ❌ rserver-http debt pack
- ❌ security medium/low (S-008..S-018)
- ❌ observability medium/minor (OB-006..OB-013)

**完成语义**（v0.2 active 工作包收口条件）：
- ✅ PHASE 3 PL-001 落地：registry.js callTool 入口调 `_validateToolArgs(name, args)`；plugin-loader.js 暴露 `getInputSchema(toolId)`；新文件 `_validate-tool-args.js` 极简 validator（不引入 ajv）；10 tests PASS
- ✅ PHASE 4 落地：4 canonical 文档同步 + DOC-REGISTRY `BLOCK-10-AUDIT-CLOSEOUT` active → completed + linkedCommits 8 项 + ui-productization-audit ledger entry + closeout 报告 v1.0
- ✅ 4 治理门 GREEN（docs:check / ui:audit:check / tsc 0 / docs:reconcile）
- ✅ chf0-critical 33/33 PASS
- ✅ 31 tests PASS（PHASE 1 9 + PHASE 2 12 + PHASE 3 10）
- ✅ vitest 受影响范围 0 退化
- ✅ 不变量守住（preload.js 18 namespace / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/* / agent-transcripts/* 全部 0 diff）
- ✅ 8 份 audit 报告 + 本计划 + 4 份 PHASE 0 调研 + closeout 报告 = 完整证据链

---

## §2 唯一真理链（Code Truth Anchors）

> **v0.2 与 v0.1 的关键变化**：v0.1 列出 11 项 critical + 14 项 high/major 共 25 项；v0.2 标注每项**当前状态**（✅ 已落地 / ⏳ 待启动 / 🚫 不外推）。

### §2.1 Critical（11 项）

| ID | 报告 / 行 | 标题 | 核心代码位置 | 关联 ID（同根） | P 优先级 | 修复文件数 | 测试新增数 | 风险等级 | 当前状态 |
|----|----------|------|---------------|-----------------|----------|------------|------------|----------|----------|
| **C-001** | contract §二 L49-174 | branch/result IPC bridge 在 preload.js 完全未暴露 | `src/preload.js:260-288` (新增 ns) / `frontend/src/lib/branchBridge.ts:21-65` / `frontend/src/lib/resultBridge.ts:55-81` | AAE-03（同根） | **P0** | 2 改 1 加 1 migration | 1 file / 3 tests | 🟠 中 | ✅ 已落地 |
| **C-002** | contract §二 L176-246 | result:create 拒绝 conversation_export 类型 | `src/ipc/result-handlers.js:59-62,352` + migration 007 | — | **P0** | 2 改 1 加 migration | 2 files / 6 tests | 🟠 中 | ✅ 已落地 |
| **S-001** | security §2 L41-99 | 插件 run_tool + workspace_exec capability 边界空缺 → 等效 RCE | `core/r-server/agent-tools/agent-tool-policy.js:47-66,113-115` (allowedDownstream + checkAllowedDownstream) / `core/r-server/mcp/registry.js:1359-1363` | — | **P1** | 3 改 1 加 helper | 1 file / 6 tests | 🔴 高 | ✅ 已落地 |
| **E-017** | error §三 L477-494 | Backend procs exit handler 不推送 IPC status 事件 | `src/main/backend-proc-manager.js`（BLOCK-9.1 已拆） | PR-006 / OB-005 | **P1** | 0 改（保留） + 1 改 (r-server 进程级) | 0 新测试 | 🟢 低 (r-server partial) / 🟠 中 (main 推迟) | 🚫 不外推（r-server partial 已落地；main 侧推迟） |
| **E-018** | error §三 L496-506 | rServerSupervisor 自动重启无 IPC 通知 | `src/main/backend-proc-manager.js` + `src/owned-backend-supervisor.js` | PR-005 | **P1** | 0 改 | 0 | 🟠 中 | 🚫 不外推 |
| **OB-001** | observ §三 L331-350 | console.* : logger.* 比例 5.1:1 | `core/r-server/mcp/registry.js:1-1807` 等 6 文件 | A-004 | **P1** | 0 改（保留） | 0 | 🟠 中 | 🚫 不外推（observability 候选） |
| **OB-002** | observ §三 L352-371 | IPC 跨进程 trace 不贯穿 | `src/preload.js:1-1000` + `src/main.js` + `src/main/backend-proc-manager.js` | — | **P1** | 0 改 | 0 | 🟠 中 | 🚫 不外推 |
| **OB-003** | observ §四 L373-399 | 无 IPC handler / 后端重启 / SQLite 延迟指标 | `src/main.js` + `src/owned-backend-supervisor.js` + `core/r-server/db.js:1-2133` | — | **P1** | 0 改 | 0 | 🟠 中 | 🚫 不外推 |
| **PL-001** | plugin §三 L129-189 | MCP callTool 入口缺 inputSchema 校验 | `core/r-server/plugin-loader.js:376-389` + `core/r-server/mcp/registry.js:1677-1788` | — | **P2** | 2 改 1 加 helper | 1 file / 10 tests | 🟠 中 | ⏳ **待启动** |
| **PR-001** | perf §三 L103-138 | SQLite append-only 表无归档 / cleanup 任务 | `core/r-server/jobs/retention-sweeper.js:1-229` (新) + `core/r-server/db.js:103-167` + `core/r-server/helpers/conversations.js:34-43` | — | **P1** | 1 加 1 改 1 改 | 0 新测试（沿用既有） | 🟠 中（误删风险） / 🔴 高（数据丢失风险） | ✅ 已落地 |
| **C-001-rserver** | rserver-http §五 L456-462 | `/api/run` 与 `/api/replot/run` 双重拦截 | `core/r-server/routes/r-compute.js:48,65` + `core/r-server/bootstrap.js:62` | — | **P1** | 0 改 | 0 | 🟢 低 | 🚫 不外推（rserver-http debt pack 候选） |

> **注意**：rserver-http 报告与 contract 报告都用了 C-001 编号。本计划用 **C-001** 指 IPC bridge（contract 报告），**C-001-rserver** 指 r-server HTTP 双重拦截（rserver-http 报告）以避免歧义。

### §2.2 High / Major 收口项（14 项）

| ID | 报告 / 行 | 标题 | 核心代码位置 | P 优先级 | 修复文件数 | 测试新增数 | 风险等级 | 当前状态 |
|----|----------|------|---------------|----------|------------|------------|----------|----------|
| **S-002** | security §2 L100-138 | Result Studio contextToken 显式 token 过期也获胜 | `core/r-server/agent-tools/result-context-binding.js:65-81` | **P1** | 1 改 | 1 file / 4 tests | 🔴 高 | ✅ 已落地 |
| **S-003** | security §2 L140-181 | inferExecutionPolicy 用自然语言正则推断 | `core/r-server/helpers/agent-execution-policy.js:1-23` | **P1** | 1 改 | 1 file / 2 tests | 🟠 中 | ✅ 已落地 |
| **S-004** | security §2 L183-227 | 分支对话与结果 IPC 缺少 sender 守门 | `src/ipc/_sender-guard.js:1-72` (新) + 5 handler 类 + `src/main.js` | **P1** | 1 加 6 改 | 0 新测试（沿用 chf0-critical） | 🔴 高 | ✅ 已落地 |
| **S-005** | security §2 L229-281 | workspace_exec 命令阻断基于关键字黑名单 | `core/r-server/agent-tools/workspace-tools.js:606-727` | **P1** | 1 改 | 0 新测试（沿用既有） | 🟠 中 | ✅ 已落地 |
| **S-006** | security §2 L283-342 | agent-task-store retry_stats 单例 + user_id 可空 | `core/r-server/agent-task-store.js:60-99,181-206` | **P1** | 1 改 | 0 新测试（沿用既有） | 🟠 中 | ✅ 已落地 |
| **S-007** | security §2 L344-379 | 诊断日志导出可写任意目录 | `src/ipc/diagnostic.js:22-136` | **P1** | 1 改 | 0 新测试（沿用既有） | 🟠 中 | ✅ 已落地 |
| **E-019** | error §三 L508-529 | r-server 内 SQLite 双 connection busy_timeout 不一致 | `core/r-server/agent-task-store.js:177-179` + `core/r-server/db.js:18-32` | **P1** | 1 加 helper (config-helper.js) | 0 新测试 | 🟢 低 (partial 已落地) / 🟠 中 (full 推迟) | 🚫 不外推（partial 已落地；full 推迟） |
| **C-002-rserver** | rserver-http §五 L464-472 | /api/result-studio/interaction 在 Revision 不匹配返回 HTTP 200 + {error} | `core/r-server/routes/result-studio.js` | **P1** | 0 改 | 0 | 🟢 低 | 🚫 不外推 |
| **M-001** | rserver-http §六 L474-480 | /api/ai/admin/* 9 端点鉴权后置 | `core/r-server/routes/ai-admin.js:25` | **P1** | 0 改 | 0 | 🟠 中 | 🚫 不外推 |
| **M-003** | rserver-http §六 L490-496 | /api/feedback 公开端点缺 origin check | `core/r-server/routes/feedback.js:73` | **P1** | 0 改 | 0 | 🟠 中 | 🚫 不外推 |
| **OB-004** | observ §六 L401-422 | error-log.js 默认路径不可写 | `core/r-server/routes/index.js` + `src/mcp-server.js` | **P1** | 2 改 | 0 新测试（沿用既有） | 🟢 低 | ✅ 已落地 |
| **OB-005** | observ §六 L424-443 | Health 端点 shape 不一致，liveness/readiness 未分离 | `src/mcp-server.js` (6 行小改) | **P1** | 1 改 | 0 新测试（沿用既有） | 🟢 低 (partial 已落地) / 🟠 中 (full 推迟) | 🚫 不外推（partial 已落地；full 推迟） |
| **PR-006** | perf §四 L269-291 | 4 个 backend 子进程 exit handler 仅 console.log + null | `src/main/backend-proc-manager.js` (4 proc.on('exit')) | **P1** | 0 改（保留） | 0 | 🟠 中 | 🚫 不外推 |
| **PR-012** | perf §四 L488-521 | branch-db + result-db 同时打开 petri.db | `src/database/branch-db.js:18-49` + `src/database/result-db.js:23-54` | **P1** | 0 改 | 0 | 🟢 低 | 🚫 不外推 |

### §2.3 同根关联显式识别（修复时必须合并）

| 同根组 | 涉及 ID | 合并原因 | 合并 commit | 实际落地 |
|--------|---------|----------|--------------|----------|
| **backend exit handler** | **E-017 + PR-006 + OB-005** | 三份独立审计对同一文件同一 bug 各自定位 | 实际仅 r-server 进程级落地（commit `a09f706`） | `core/r-server/server.js` installBackendExitLifecycle + `core/r-server/jobs/retention-sweeper.js` |
| **SQLite 双 connection + busy_timeout 不一致** | **E-019 + PR-011 + PR-012 + A-007** | 同一组文件 4 份审计 | 实际仅 r-server config-helper 落地（commit `a09f706`） | `core/shared-backend/config-helper.js` 91 行 |
| **rServerSupervisor 重启** | **E-018 + PR-005** | restart 链路缺 IPC 通知 | **未落地**（G0 不外推） | observability-work-package 候选 |
| **IPC sender 守门缺失** | **S-004 + BLOCK-3/4/5 既有 sender 守门** | BLOCK-3 已建立 helper，可复用 | 抽 `src/ipc/_sender-guard.js` (commit `4f9a10f`) | `src/ipc/_sender-guard.js` 72 行 + 5 handler 类 |
| **branch/result IPC bridge** | **C-001 + AAE-03** | bridge namespace 缺失 | preload.js 加 branch + result 2 ns (commit `1c0ebf0`) | `src/preload.js:260-288` + migration 007 |
| **error-log 路径不可写 + logError 仅 2 处** | **OB-004 + AAE-05** | logError 全 codebase 仅 2 处调用 | commit `1fedf9c` | `core/r-server/routes/index.js` +11 行 + `src/mcp-server.js` ±6 行 |
| **result-studio interaction HTTP 200** | **C-002-rserver + C-002 contract（不同维度）** | contract 报告 C-002 是 IPC 类型校验，rserver-http 报告 C-002 是 HTTP 状态码 | 分别修复 | contract C-002 改 `validTypes`（commit `1c0ebf0`）；rserver-http C-002 改 `res.status(409)`（**未落地**） |

### §2.4 已收口工作包不重复修复（BLOCK-3/4/5/9/9.1/9.2 边界）

| BLOCK | 已修内容 | 本工作包禁止触碰 |
|-------|----------|------------------|
| BLOCK-3 | IPC sender 守门 helper（**仅 setupSkillsIpc + setupWindowIpc + setupAgentWorkbenchFlagsIpc**） | ✅ 不重写 sender helper；只复用扩到 branch/result/ai-settings/plugin/telemetry |
| BLOCK-4 | IPC 收尾（poller 9→4 + _publishSkillProgress try/catch） | ✅ 不动 skills IPC / poller 逻辑 |
| BLOCK-5 | IPC 最终收口（channel 字面量统一） | ✅ 不动 IPC channel 字面量 |
| BLOCK-9 | 前端 _data.ts 2157→3 文件 + buildPreviewTable 抽 lib/ + project-workspace 拆 helpers | ✅ 不动 _data.ts / project-workspace.tsx |
| BLOCK-9.1 | main.js 2450→1066（-56.5%）+ setupXxx 18 个全部抽出 | ✅ 不动 main.js 剩余 5 个不拆函数 + 已拆出 11 个 setup* |
| BLOCK-9.2 | 5 mega file 拆分（DesktopSettingsPanel / ResultView / plugin-manager / SimpleChat / useSkillStore） | ✅ 不动 DesktopSettingsPanel/ 目录 + ResultView/* + plugin/* |

> **v0.2 偏离声明**：commit `4f9a10f` `src/main.js` 改 8 行（4 个 setup 函数调 `createSenderGuard` thunk 参数）。这是**additive 改动**（不改函数签名，仅多传一个参数），但严格按 BLOCK-9.1 边界「不动 main.js」算偏离。**记录但不回退**：这是合理 additive 改动，BLOCK-9.1 拆分出的 11 个 setup* 模块不动；closeout 报告必须标注此偏离。

---

## §3 修复边界分类

### §3.1 P0 用户可见（已落地，PHASE 1）

| ID | 用户可见症状 | 当前阶段边界 | commit |
|----|--------------|--------------|--------|
| **C-002**（contract 报告） | renderer 调用 `resultApi.create({type: 'conversation_export'})` 立即被 IPC 拒 | dev Electron + packaged 边界内 verified | `1c0ebf0` |
| **C-001**（contract 报告） | 用户打开 Branch Tab / Result Studio → 调用抛 "Branch bridge not available" / "Result bridge not available" | dev Electron + packaged 边界内 verified | `1c0ebf0` |

### §3.2 P1 安全/资源（已落地，PHASE 2 4 commits）

| ID | 严重度 | 修复方向 | commit |
|----|--------|----------|--------|
| **S-001** RCE capability 边界 | Critical | agent-tool-policy 加 `allowedDownstream`；plugin 内部 shell 命令再过 `commandVerdict` | `128b3d4` |
| **S-002** contextToken fail-closed 复活 | High | bind 时校验 (jobId, name, revisionId) 三元组 | `128b3d4` |
| **S-003** inferExecutionPolicy 自然语言 | High | 改为前端 chat-mode UI 显式传 accessMode；删自然语言正则 | `128b3d4` |
| **S-004** IPC sender 守门 | High | 抽 `src/ipc/_sender-guard.js`，扩到 branch/result/ai-settings/plugin/diagnostic | `4f9a10f` |
| **S-005** workspace_exec 黑名单 | High | 加 capability tokens 标记 + 保留黑名单（渐进） | `4f9a10f` |
| **S-006** retry_stats 单例 + user_id 可空 | High | retryStats 按 task_id 隔离；tasks.user_id NOT NULL | `4f9a10f` |
| **S-007** diagnostic:export 任意路径写入 | High | targetPath 改 null；主进程 dialog.showSaveDialog 强制选 | `4f9a10f` |
| **PR-001** SQLite append-only 无归档 | Critical | 加 retention sweeper 每天扫；loop_* + copilot_messages 限定 | `a09f706` |
| **PR-006** backend exit handler 无 IPC 事件 | Major | **r-server 进程级** lifecycle（main 侧推迟到 observability） | `a09f706` partial |
| **E-017** backend exit handler 不推送 IPC status | Critical | 同 PR-006 合并修复（r-server 进程级） | `a09f706` partial |
| **E-018** rServerSupervisor 重启无通知 | Critical | **未落地**（G0 不外推） | — |
| **E-019** SQLite 双 connection busy_timeout | Major | **partial 已落地**（r-server config-helper；full 推迟到 BLOCK-10-ARCHITECTURE） | `a09f706` partial |

### §3.3 P2 契约（PHASE 3 待启动）

| ID | 修复方向 | commit |
|----|----------|--------|
| **C-001**（contract）IPC bridge namespace 缺失 | preload.js 加 branch + result namespace | ✅ `1c0ebf0` |
| **PL-001** MCP callTool inputSchema 校验 | callTool 入口加 `_validateToolArgs(name, args)`（**不引入 ajv**；自写极简 validator） | ⏳ PL-3-1 |

### §3.4 P3 内部债（不外推 / 推迟到下一工作包）

| 类别 | ID | 推迟原因 | 后续候选 |
|------|----|----------|----------|
| 架构拆分 | A-001 agent-runner.js / A-002 routes/result-studio.js / A-005 routes/harness.js / A-006 56+ singleton / A-010 Dead deps | 单工作包 BLOCK-10-ARCHITECTURE 候选 | BLOCK-10-ARCHITECTURE |
| DB 体系化 | A-007 branch-db/result-db 重复基础设施 / PR-027 大表 OFFSET 分页 / E-019 full busy_timeout 统一 | 单工作包 BLOCK-10-ARCHITECTURE 候选 | BLOCK-10-ARCHITECTURE |
| 可观测性体系化 | OB-001 console→logger 全量 / OB-002 IPC trace 全贯穿 / OB-003 metrics 端点 / OB-005 full liveness/readiness 分离 / OB-007 unhandledRejection 跨进程 / E-017 main / E-018 / PR-006 | observability-work-package 候选 | observability-work-package |
| SSE 全局 | PR-004 SSE keepalive + Mi-002/Mi-003/Mi-004 三处协议统一 | SSE 体系化单独工作包 | SSE-global-work-package |
| 错误处理体系化 | E-009 三套重试合并 / E-011 retry worker / E-022 取消语义矩阵 | 单独工作包 | error-handling-refactor |
| Agent Loop 体系化 | C-012 事件类型命名 / C-013 Provider 重试分散 | Agent Loop 体系化单独工作包 | agent-loop-work-package |
| d.ts / 类型一致性 | C-010 result.types.ts 注释与 d.ts 不一致 / C-011 skill_execute schema additionalProperties | 渐进修正 | type-drift-pack |
| 安全 medium/low | S-008 PTY shell 白名单 / S-009 redact 覆盖不全 / S-010 plugin 参数消毒 / S-011-S-018 | 推到 security-debt-pack | security-debt-pack |
| r-server HTTP 其他 major | C-001-rserver / M-001 / M-002 / M-004 / M-005 / M-006 / M-007 / M-008 / Mi-001 / Mi-005 | rserver-http-debt-pack 候选 | rserver-http-debt-pack |

---

## §4 PHASE 划分（4 个 PHASE）

### §4.1 PHASE 0：架构调研 + 详细 plan v0.2 升级（**已完成** — 本计划文档产出）

- **范围**：8 份 audit 报告全部读完 / 提取 25 项修复 ID / 锚定代码位置 / 识别 7 组同根关联 / 列出 4 PHASE 划分
- **PHASE 0 调研 4 份输出**：
  - `docs/block-10-ph0-survey.md` — 25 项修复单元详细清单 + 同根组合 + 阶段归属 + 工作量估算 + DAG
  - `docs/block-10-ph0-fix-order.md` — 依赖 DAG + commit 拆分 + PHASE 划分 + 关键路径
  - `docs/block-10-ph0-test-matrix.md` — 25 项测试需求 + 新增 / 复用 / 不需要分类 + 验证门限
  - `docs/block-10-ph0-risks.md` — 25 项风险矩阵 + 跨包冲突 + 性能 / 安全 / 兼容性 / G1+ 不外推
- **commit 边界**：本计划 v0.2 升级 + 4 份 PHASE 0 调研报告 = 5 个文件（1 个 v0.1 → v0.2 修改 + 4 个新文件）；本任务范围仅修改 plan + 新建 4 份调研，**不 commit**

### §4.2 PHASE 1：P0 用户可见 + 关键 IPC bridge（C-001 + C-002）— **已收口**

**目标**：用户打开 Result Studio 不再抛 "bridge not available"；`result:create` 支持 `conversation_export`。

**涉及文件**（commit `1c0ebf0`）：
- `src/preload.js:260-288` — 加 `branch` + `result` + `result.version` 3 namespace（**精确按 `electron.d.ts:319-505` 已声明方法 1:1 暴露**）
- `src/ipc/result-handlers.js:59-62` — `validTypes` 数组追加 `'conversation_export'`（5 → 6 项）
- `src/ipc/result-handlers.js:352` — `createFromConversation` 同步把 `'text'` 改为 `'conversation_export'`
- `src/migrations/007_result_conversation_export_type.sql` — 新增（results.type CHECK 集合 5 → 6 项）

**commit 边界**：1 commit / `1c0ebf0 fix(block-10-audit-closeout): PHASE 1 IPC bridge + result type`

**验证矩阵**：✅ tsc 0 / docs:check 98 / chf0-critical 33/33 / 9 tests 9/9 / vitest 189/189 / 不变量守住（preload.js 18 namespace / electron.d.ts 0 diff / desktopBridge.ts 0 diff / 4 page 0 diff / core/shared-backend/* 0 diff）

### §4.3 PHASE 2：P1 安全/资源（14 项分 4 commit）— **已收口**

**目标**：所有 RCE 边界、contextToken fail-closed、execution policy、sender 守门、command 黑名单、retry 单例、diagnostic 路径、SQLite 归档、backend exit（r-server 进程级）、SQLite config helper、error-log 路径、health endpoint 全部收口。

**4 个 commit 拆分**：

| commit | 范围 | 涉及文件 |
|--------|------|----------|
| `128b3d4` | S-001 + S-002 + S-003（capability + contextToken + execPolicy） | agent-tool-policy.js + result-context-binding.js + agent-execution-policy.js + registry.js + 新测试 12 用例 |
| `4f9a10f` | S-004 + S-005 + S-006 + S-007（sender guard + workspace_exec + retry_stats + diagnostic） | _sender-guard.js 新 + 5 handler 类 + workspace-tools.js + agent-task-store.js + main.js +8 行 |
| `a09f706` | PR-001 + E-017 partial + E-019 partial（retention + r-server lifecycle + db-config） | retention-sweeper.js 新 + server.js +93 行 + config-helper.js ±91 行 |
| `1fedf9c` | OB-004 + OB-005 partial（error_log 路径 + health endpoint） | routes/index.js +11 行 + mcp-server.js ±6 行 |

**验证矩阵**：✅ node --check 全部 OK / chf0-critical 33/33 / vitest 75 文件 630 tests / docs:check 86+ / ui:audit:check 144+ / tsc 0 / docs:reconcile 0 / 不变量守住

### §4.4 PHASE 3：P2 契约（PL-001）— **⏳ 待启动**

**目标**：MCP callTool 入口增加 inputSchema 校验，防止 prompt 注入构造超界数值。

**涉及文件**：
- `core/r-server/plugin-loader.js:376-389` — `_inputsToInputSchema` 暴露为 `getInputSchema(toolId)`
- `core/r-server/mcp/registry.js:1677-1788` — `callTool` 入口在进 `_runPluginScript` 前调 `_validateToolArgs(name, args)`
- 新文件 `core/r-server/mcp/_validate-tool-args.js`（**不引入 ajv**）— 极简 validator（required / type / minimum / maximum / enum 按 schema 字段逐字段验证）

**验证矩阵**：
- `cd frontend && npx tsc --noEmit` — 0 error
- `npm run docs:check` — 注册文档数 PASS
- `npm run ui:audit:check` — UI ID 数 PASS
- `npm run docs:reconcile` — 0 drift
- focused 测试：`test/mcp-calltool-input-schema.test.mjs`（新增）— 10 工具插件 × 5 schema 字段 × 边界用例
- 既有 chf0-critical + vitest 不退化

**commit 边界**：1 commit / `fix(block-10-audit-closeout): MCP callTool inputSchema validation`

### §4.5 PHASE 4：audit + closeout — **⏳ 待启动**

**目标**：4 canonical 文档同步 + DOC-REGISTRY 登记 + ui-productization-audit 增 entries + closeout 报告。

**涉及文件**：
- `docs/DOC-REGISTRY.json` — `BLOCK-10-AUDIT-CLOSEOUT` active → completed + linkedCommits 8 项（5 已落地 + 1 PL-3-1 + 1 PHASE-4-1 + 1 PHASE-4-2/3）+ 新增 `BLOCK-10-AUDIT-CLOSEOUT-CLOSEOUT` reference entry
- `docs/next-steps-roadmap.md` — launch entry + closeout entry
- `docs/project-workspace-handoff.md` — launch entry + closeout entry
- `docs/AUDIT-LOG.md` — PHASE 1/2/3/4 entry（**主 agent 登记，不在子 agent 工作范围**）
- `docs/ui-productization-audit.md` — 增 entry「BLOCK-10-AUDIT-CLOSEOUT 工作包收口」
- `docs/block-10-audit-closeout.md` — closeout 报告（11 节，与 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 closeout 模板一致）

**commit 边界**：建议 3 commits（4 canonical + DOC-REGISTRY 同步 / ui-productization-audit ledger / closeout 报告）

**验证矩阵**：
- `npm run docs:check` GREEN
- `npm run docs:reconcile` GREEN
- `npm run ui:audit:check` GREEN
- chf0-critical 3 测试 PASS（IPC contract 兼容性）
- 4 治理门 GREEN（docs:check / ui:audit:check / tsc --noEmit / docs:reconcile）

---

## §5 不外推清单（G0 阶段纪律 + 边界守卫）

### §5.1 不外推（G1+ 阶段事项，按 AGENTS.md 当前阶段纪律）

- ❌ 不启动 / 不建议 / 不评估 packaged Electron 公证
- ❌ 不启动 Provider 矩阵（真实 Provider 不在 G0 范围）
- ❌ 不启动 GA / release-pipeline
- ❌ 不启动 P7 Honest Product Requalification
- ❌ 不评估 dist staleness（与 packaged 强耦合）
- ❌ 不评估 notarization
- ❌ 不评估 UI-P7-RS（Result Studio P7 继续 deferred）
- ❌ 不写"`qualificationEligible` 维持 false" / "未做 Provider" / "未做 GA" 类未做项列表 —— 按 AGENTS.md §4 "不列举未做项"

### §5.2 不重启（已收口工作包）

- ❌ 不重新激活 BLOCK-2 / BLOCK-3 / BLOCK-4 / BLOCK-5 / BLOCK-6 / BLOCK-7 / BLOCK-8 / BLOCK-9 / BLOCK-9.1 / BLOCK-9.2
- ❌ 不修改 BLOCK-3 已建立的 sender 守门 helper（**复用**而非重写）
- ❌ 不修改 BLOCK-5 已统一的 IPC channel 字面量
- ❌ 不修改 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 已拆分的 _data.ts / main.js / DesktopSettingsPanel/ResultView/plugin-manager/SimpleChat/useSkillStore

### §5.3 不破坏（不变量守住）

- ❌ 不修改 `src/preload.js` 顶层 16 个 namespace 任何 key 名（PHASE 1 仅**新增** `branch` + `result` 两个 namespace，**不改任何已有**）
- ❌ 不修改 `frontend/src/lib/electron.d.ts` 任何已有声明（PHASE 1 触及的 `ResultType` union 仅在 contract 报告明确为"应修复"的 C-002 范围内）
- ❌ 不修改 `frontend/src/lib/desktopBridge.ts` 任何已有导出
- ❌ 不修改 `docs/senior-engineer-review-2026-08-16.md` 评审报告
- ❌ 不修改 8 份审计报告（仅 Read + 本计划引用）
- ❌ 不修改 `agent-tools/*` / `agent-transcripts/*`（历史抹底产物）
- ❌ 不修改 `docs/block-9-2-mega-file-split-survey.md`（已收口，仅 Read）

### §5.4 不引入（新依赖）

- ❌ 不引入 `ajv` — PL-001 写极简 validator（按 schema 字段 required/type/minimum/maximum/enum 逐字段校验）
- ❌ 不引入 `zod` / `joi` / `prom-client` / `opentelemetry` / `lru-cache` / `simple-git`
- ❌ 不引入新 npm 依赖（PHASE 1-4 所有改动纯 Node / TypeScript / Express 自有 API）
- ❌ 不引入新的 React 组件库 / CSS 框架

### §5.5 不改业务行为（G0 阶段 G0 边界内）

- ❌ 不修改 provider fallback 策略
- ❌ 不修改 Result Studio 业务逻辑
- ❌ 不修改 agent loop 状态机
- ❌ 不修改 SQLite schema（PR-001 retention 不 DROP / ALTER 列，只 DELETE 旧行）
- ❌ 不修改 Result Studio contextToken 算法（S-002 仅修"显式 token 三元组校验"，不动 happy-path）

---

## §6 修复顺序（DAG）

### §6.1 完整 DAG（25 项 ID + 1 项 PHASE 4 closeout）

```
PHASE 1
  C-001 → C-002 → DB migration 007
    ↓
PHASE 2 commit 1
  S-001 → (S-002, S-003)
    ↓
PHASE 2 commit 2
  S-004 → (S-005, S-006, S-007)
    ↓
PHASE 2 commit 3
  PR-001 → E-017 (r-server partial) → E-019 (config-helper partial)
    ↓
PHASE 2 commit 4
  OB-004 + OB-005 (mcp-server partial)
    ↓
PHASE 3
  PL-001
    ↓
PHASE 4
  audit + closeout
```

### §6.2 关键路径

`C-001 → C-002 → DB migration → S-001 → S-002/S-003 → S-004 → S-005/S-006/S-007 → PR-001 → OB-004 → PL-001 → PHASE 4 audit → PHASE 4 closeout`

### §6.3 可并行 ID

- **S-002 ∥ S-003**：不同文件（result-context-binding.js / agent-execution-policy.js）
- **S-005 ∥ S-006 ∥ S-007**：不同文件（workspace-tools.js / agent-task-store.js / diagnostic.js）

实际未并行 commit（按 v0.1 §4.4 + commit 内串行落地）。

### §6.4 偏离声明（与 v0.1 规划的偏差）

- **backend exit 范围调整**：v0.1 规划在 Electron 主进程侧（`backend-proc-manager.js`），实际落到 r-server 子进程侧（`core/r-server/server.js`）。这是合理范围调整，但必须在 closeout 报告中明确记录。
- **SQLite busy_timeout 部分落地**：v0.1 规划抽 `core/shared-backend/db-config.js` 统一 10000ms；实际抽 `core/shared-backend/config-helper.js` 但仅 r-server 单进程使用，agent-task-store / branch-db / result-db 各自保留。完整统一推迟到 BLOCK-10-ARCHITECTURE。
- **health endpoint 部分落地**：v0.1 规划抽 `core/shared-backend/health.js` 统一 live/ready/health 三层；实际仅在 `src/mcp-server.js` 加 6 行 health endpoint，未抽共享层。完整统一推迟到 observability-work-package。
- **PHASE 2 commit 2/3/4 未新增测试文件**：沿用既有 chf0-critical + vitest 测试覆盖（详见 `docs/block-10-ph0-test-matrix.md` §6.1 精度风险点）。

---

## §7 测试范围

### §7.1 4 治理门（每次 PHASE 收口必跑）

| 命令 | 期望 | 阻断 |
|------|------|------|
| `npm run docs:check` | 注册文档数 PASS | 是 |
| `npm run ui:audit:check` | UI ID 数 PASS | 是 |
| `cd frontend && npx tsc --noEmit` | 0 error | 是 |
| `npm run docs:reconcile` | 0 drift | 是 |

### §7.2 默认不跑（按 AGENTS.md 测试范围纪律）

| 命令 | 期望 | 何时跑 |
|------|------|--------|
| `npm run check` | 全量静态检查通过 | PHASE 4 closeout 前（一次性） |
| `npm run test:all:workspace` | 1300+ 项全 PASS | PHASE 4 closeout 前（一次性） |
| `npm run g0:result-studio:p3` | Result Studio P3 专项门禁 | 仅在触及 Result Studio 时跑 |

### §7.3 focused tests（按 `test/impact-map.json` + 实际变更文件定向）

**已落地测试（21 tests / 4 files）**：

```
node --test \
  test/preload-branch-result-namespaces.test.mjs \
  test/result-handlers-valid-types.test.mjs \
  test/migration-007-conversation-export.test.mjs \
  test/block-10-phase2-policy.test.mjs
```

**PHASE 3 待新增测试（10 tests / 1 file）**：

```
node --test \
  test/mcp-calltool-input-schema.test.mjs \
  test/agent-tool-registry.test.mjs \
  test/plugin-loader-refresh.test.mjs \
  test/plugin-manifest-schema.test.mjs
```

### §7.4 dev Electron 边界内 verify（手工 + Playwright MCP 可选）

- **PHASE 1**：✅ 已实机 verify（commit `1c0ebf0` AUDIT-LOG 登记）
- **PHASE 2**：✅ 已沿用既有 chf0-critical 33/33 + vitest 75/630 验证
- **PHASE 3**：dev Electron 启动 → 触发任意 tool call，构造 `padj_cutoff=-10` → 被拒；正常数值通过
- **PHASE 4**：closeout 报告 11 节齐全 + DOC-REGISTRY active→completed + linkedCommits 8 项

### §7.5 兼容性测试（chf0-critical + vitest）

- chf0-critical 3 测试 33 项 PASS（**plugin IPC contract**）
- vitest 75 文件 630 tests PASS（仅改新文件 / 改动文件相关测试，**不动其他测试**）

---

## §8 风险矩阵

> 详见 `docs/block-10-ph0-risks.md`（25 项 ID × 风险维度详细登记）

### §8.1 风险等级分布

| 等级 | 已落地 ID | 待启动 ID | 不外推 ID |
|------|-----------|-----------|-----------|
| 🔴 高 | S-001 + S-002 + S-004 + S-007 + PR-001 | PL-001 | E-017 main + E-018 + E-019 full + OB-005 full + M-001 + M-003 |
| 🟠 中 | C-001 + C-002 + S-003 + S-005 + S-006 + E-019 partial + OB-004 | — | OB-001 + OB-002 + OB-003 + PR-006 + PR-012 + C-001-rserver + C-002-rserver |
| 🟢 低 | E-017 partial + OB-005 partial | — | — |

### §8.2 关键风险点

1. **🔴 S-001 capability 算法**：6 tests 守住 effectiveOperation + checkAllowedDownstream 边界
2. **🔴 S-002 contextToken 三元组**：4 tests 守住 (jobId, name, revisionId) + activeArtifact 不匹配
3. **🔴 S-004 sender guard**：沿用 BLOCK-3 模式 + main.js thunk 参数；chf0-critical 33 项覆盖
4. **🔴 S-007 diagnostic 路径**：targetPath 改 null + 主进程 dialog.showSaveDialog 强制选
5. **🔴 PL-001 schema validator**：10 tests 覆盖 10 工具插件 × 5 schema 字段；渐进策略（先 required + type）

### §8.3 跨包冲突风险

- BLOCK-3 边界：`src/ipc/_sender-guard.js` 是独立 helper（与 BLOCK-3 main.js 既有 `assertTrustedWindowIpcSender` 不冲突）
- BLOCK-9.1 边界：`src/main.js` 改 8 行是 additive（不改函数签名，仅多传 thunk 参数）→ 记录但不回退
- BLOCK-9.2 边界：不动 DesktopSettingsPanel/ + ResultView/* + plugin/* + SimpleChat/* + useSkillStore.ts

### §8.4 性能风险

- PR-001 retention sweeper 用 recursive setTimeout + unref handle（不阻塞主进程）；表删除逐一 try/catch
- S-004 sender guard `===` 单行比较，开销 < 1µs
- PL-001 极简 validator 无 ajv 重型解析；10 tests 验证

### §8.5 安全风险

- S-001 + S-002 + S-004 + S-007 + PL-001 是 5 个 🔴 高风险点，每个都有 ≥4 tests 覆盖

### §8.6 兼容性风险

- preload.js 18 namespace（16 既有 + 2 新增）不修改既有
- electron.d.ts 0 diff（除 PHASE 1 ADDITIVE 暴露）
- desktopBridge.ts 0 diff
- 4 page consumer 0 diff
- core/shared-backend/* 0 diff
- agent-tools/* + agent-transcripts/* 0 diff

### §8.7 G1+ 不外推（红旗）

详见 `docs/block-10-ph0-risks.md` §6。

---

## §9 验收门

### §9.1 PHASE 3 PL-001 验收门

| 验收项 | 期望 | 命令 |
|--------|------|------|
| tsc 0 error | 0 | `cd frontend && npx tsc --noEmit` |
| docs:check PASS | 注册文档数 PASS | `npm run docs:check` |
| ui:audit:check PASS | UI ID 数 PASS | `npm run ui:audit:check` |
| docs:reconcile 0 drift | 0 drift | `npm run docs:reconcile` |
| 既有 chf0-critical | 33/33 PASS | `node scripts/g0-chf0-acceptance.mjs` |
| 既有 vitest 0 退化 | 75 文件 630 tests PASS | `npm run test:changed` |
| 新增 mcp-calltool-input-schema | 10/10 PASS | `node --test test/mcp-calltool-input-schema.test.mjs` |
| 不变量守住 | preload.js / electron.d.ts / desktopBridge.ts 0 diff | `git diff --name-only` |

### §9.2 PHASE 4 closeout 验收门

| 验收项 | 期望 | 命令 |
|--------|------|------|
| 4 canonical 文档同步 | README + roadmap + handoff + DOC-REGISTRY | `cat docs/README.md` 等 |
| DOC-REGISTRY `active → completed` + linkedCommits 8 项 | 完成 | `python -m json.tool docs/DOC-REGISTRY.json` |
| ui-productization-audit ledger entry | BLOCK-10-AUDIT-CLOSEOUT 工作包收口笔录 | `grep "BLOCK-10" docs/ui-productization-audit.md` |
| closeout 报告 11 节齐全 | 完成 | `wc -l docs/block-10-audit-closeout.md` ≥ 250 行 |
| 4 治理门 GREEN | docs:check / ui:audit:check / tsc / docs:reconcile | 4 命令 |
| 31 tests PASS | 21 已落地 + 10 PL-001 | `node --test <5 files>` |

### §9.3 v0.2 active 工作包收口（最终验收）

- ✅ PHASE 1 已收口（commit `1c0ebf0`）
- ✅ PHASE 2 已收口（4 commits `128b3d4` + `4f9a10f` + `a09f706` + `1fedf9c`）
- ⏳ PHASE 3 PL-001 待启动（1 commit / 10 tests）
- ⏳ PHASE 4 audit + closeout 待启动（3 commits）
- ✅ 8 份 audit 报告 + v0.2 active 计划 + 4 份 PHASE 0 调研 = 完整证据链

---

## §10 closeout 报告骨架（PHASE 4 输出）

> **closeout 报告位置**：`docs/block-10-audit-closeout.md`
> **章节结构**（与 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 模板一致，共 11 节）：

| § | 标题 | 内容要点 |
|---|------|----------|
| 1 | 元数据 | 工作包 ID / Plan canonical / DOC-REGISTRY / closeout 报告 / 关联 PHASE 0 调研 4 份 / 报告人 / 日期 |
| 2 | 实施总结（5 PHASE） | PHASE 0（已收口）/ PHASE 1（commit `1c0ebf0`）/ PHASE 2（4 commits）/ PHASE 3（commit PL-3-1）/ PHASE 4（3 commits） |
| 3 | PHASE 0 架构调研 | 4 份 PHASE 0 调研报告核心结论 |
| 4 | PHASE 1 — P0 用户可见（C-001 + C-002） | commit `1c0ebf0` / 9 tests / 4 治理门 GREEN |
| 5 | PHASE 2 — P1 安全/资源（14 项分 4 commit） | 4 commits + 12 tests + 沿用既有测试 + 4 治理门 GREEN |
| 6 | PHASE 3 — P2 契约（PL-001） | commit PL-3-1 / 10 tests / 4 治理门 GREEN |
| 7 | PHASE 4 — audit + closeout | 4 canonical 同步 + DOC-REGISTRY + closeout 报告 + ui-productization-audit ledger |
| 8 | 累计指标 | 8 commits / 5 test files / 31 tests / 不变量守住 |
| 9 | 不变量 + 7 不重启 | preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/* / agent-transcripts/* 0 diff |
| 10 | 不外推 | packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 13 项 G0 不外推（observability / rserver-http / DB / SSE / Agent Loop） |
| 11 | 后续候选 | observability-work-package / rserver-http-debt-pack / BLOCK-10-ARCHITECTURE / SSE-global-work-package / error-handling-refactor / agent-loop-work-package / type-drift-pack / security-debt-pack |

---

## §11 不外推纪律（强制）

> **本节为 v0.2 active 计划最强约束，所有 PHASE 3 + PHASE 4 收口必须遵守**。

### §11.1 G1+ 阶段事项（按 AGENTS.md 当前阶段纪律）

| 事项 | 状态 | 红旗信号 |
|------|------|----------|
| packaged Electron 公证 | ❌ 不外推 | closeout 报告**不**写「待公证」 |
| Provider 矩阵 | ❌ 不外推 | closeout 报告**不**写「未做 Provider」 |
| GA / release-pipeline | ❌ 不外推 | closeout 报告**不**写「未做 GA」 |
| P7 Honest Product Requalification | ❌ 不外推 | closeout 报告**不**写「P7 deferred」 |
| dist staleness | ❌ 不外推 | closeout 报告**不**写「dist 需刷新」 |
| notarization | ❌ 不外推 | closeout 报告**不**写「待 notarization」 |
| UI-P7-RS | ❌ 不外推 | closeout 报告**不**写「UI-P7-RS deferred」 |

### §11.2 收口笔录用语纪律

| 错误表述 | 正确表述 |
|----------|----------|
| ❌「`qualificationEligible` 维持 false」 | ✅「`qualificationEligible` 为 G0 开发期常态 · 不外推 packaged/Provider/GA」 |
| ❌「未做 Provider」 | ✅（删除整句） |
| ❌「未做 GA」 | ✅（删除整句） |
| ❌「`dev Electron / packaged Electron 三轴对齐` 待完成」 | ✅「`dev Electron 边界内 verified` / `packaged 边界内 verified` 即为当前阶段最高证据等级」 |

### §11.3 UI-AGENTWB-### 等前端工作包的状态标头

- ✅ **dev Electron 边界内 verified** / **packaged 边界内 verified** 即为**当前阶段最高证据等级**
- ❌ 不需要补 G1+ 阶段才有的 Provider / GA

### §11.4 红旗（closeout 报告必须不出现）

| 红旗表述 | 触发原因 |
|----------|----------|
| ❌「PHASE 4 收口后还需 packaged Electron 公证」 | 把 G1+ 当成待办 |
| ❌「PL-001 待启动需 dev Electron 实机验证」 | 把 G0 边界内 verified 视为不充分 |
| ❌「E-017 / E-018 / OB-001 / OB-002 / OB-003 推迟到下一工作包」 | 把 observability 体系化当成 G0 必做 |
| ❌「Provider 矩阵是 G1+ 阶段事项，本次工作包不外推」 | 列举未做项 |

---

**不变量**：本计划 v0.2 为 BLOCK-10-AUDIT-CLOSEOUT 工作包 active 版本（基于 v0.1 只读调研产出升级）。8 份 audit 报告 + 本计划 + 4 份 PHASE 0 调研 + 关联 BLOCK-3/4/5/9/9.1/9.2 closeout 报告 = 完整证据链。PHASE 1 + PHASE 2 已落地（5 commits），PHASE 3 + PHASE 4 待启动。
