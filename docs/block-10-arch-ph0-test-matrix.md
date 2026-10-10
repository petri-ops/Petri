# BLOCK-10-ARCHITECTURE PHASE 0 — Test Coverage Matrix

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑测试）
> **基线**：`docs/block-10-arch-ph0-survey.md` + `docs/block-10-architecture-plan.md` v0.1
> **下游**：PHASE 1+2+3+4 active 工作包

---

## §1 现有测试覆盖（grep + test/ 目录）

### §1.1 现有测试目录（201 个 test files）

来源：`ls test/ | wc -l` = 201 个 test files（截至 2026-08-17）

按 BLOCK-10-ARCHITECTURE 修复 ID 相关度筛选：

| 测试文件 | 相关 ID | 备注 |
|----------|---------|------|
| `agent-workflow.test.mjs` | A-003 | 既有；PHASE 3.2 需扩（configure 注入） |
| `agent-tool-policy.test.mjs` | A-008 | 既有；PHASE 3.2 需扩（act-tools ↔ plan-ui-tools 解环） |
| `agent-task-cancellation.test.mjs` | A-006 部分 | 既有；PHASE 3.3 需扩（singleton 迁 SQLite） |
| `agent-runner.test.mjs` | A-001 | 既有（如果有）；PHASE 3.1 需扩（LoopOrchestrator + ConversationAdapter） |
| `g0-chf0-http.test.mjs` | A-002 + A-005 | 既有；PHASE 2 需保持 0 退化（http 契约 100% 不变） |
| `result-studio-context.test.mjs` | A-002 | 既有；PHASE 2.1 需保持 0 退化 |
| `result-handlers-valid-types.test.mjs` | A-002 | 既有；PHASE 2.1 需保持 0 退化 |
| `backend-health.test.mjs` | A-009 | 既有；PHASE 1.2 需保持 0 退化（端口 fallback） |
| `mcp-server.test.mjs` | A-010 部分 | 既有；PHASE 1.2 需保持 0 退化（env 集中） |
| `db.test.mjs` | A-007 + E-019 | 既有；PHASE 1.1 需扩（DB singleton 统一） |
| `agent-task-store.test.mjs` | A-007 + E-019 | 既有；PHASE 1.1 需扩（busy_timeout 统一） |
| `block-10-phase2-policy.test.mjs` | — | BLOCK-10-AUDIT-CLOSEOUT PHASE 2 commit 1 新增；PHASE 1.1 需保持 0 退化 |

### §1.2 BLOCK-10-AUDIT-CLOSEOUT 已落地测试（沿用）

来源：`docs/block-10-ph0-test-matrix.md` §1.1

- 4 个测试文件 / 21 tests（PHASE 1 + PHASE 2 commit 1）
- 沿用既有测试文件 8+（PHASE 2 commit 2/3/4）

---

## §2 19 项修复的测试需求

> **格式**：每项标注 **新增** / **复用** / **不需要** / **不启动**。

| ID | 阶段 | 测试需求 | 落地测试文件 |
|----|------|---------|-------------|
| **A-007** | PHASE 1.1 | **新增**（DB singleton 抽 + 3 处收编） | `test/db-singleton.test.mjs`（5+ tests） |
| **PR-012** | PHASE 1.1 | **复用**（与 A-007 同根，A-007 测试覆盖） | 无新增 |
| **E-019 full** | PHASE 1.1 | **新增**（busy_timeout 全量统一验证） | `test/db-singleton.test.mjs`（含 E-019 测试） |
| **A-009** | PHASE 1.2 | **新增**（端口 fallback 统一） | `test/env-coordinator-port.test.mjs`（3+ tests） |
| **A-010（仅 jspdf）** | PHASE 1.2 | **不需要**（dead dep 移除，无外部契约） | 无 |
| **A-010（6 处 env 集中）** | PHASE 1.2 | **新增**（env 集中 helper 行为） | `test/config-helper-centralized.test.mjs`（3+ tests） |
| **A-002** | PHASE 2.1 | **新增**（端点 → domain 映射契约 + 拆分后子域文件契约） | `test/routes-result-studio-split.test.mjs`（5+ tests） |
| **A-005** | PHASE 2.2 | **新增**（harness + ai-agent 子域文件契约） | `test/routes-harness-split.test.mjs`（5+ tests） + `test/routes-ai-agent-split.test.mjs`（5+ tests） |
| **A-001** | PHASE 3.1 | **新增**（LoopOrchestrator + ConversationAdapter 独立单元测试） | `test/loop-orchestrator.test.mjs`（8+ tests） + `test/conversation-adapter.test.mjs`（5+ tests） |
| **A-003** | PHASE 3.2 | **新增**（configure 注入行为） | `test/agent-workflow-configure.test.mjs`（4+ tests） |
| **A-008** | PHASE 3.2 | **新增**（act-tools ↔ plan-ui-tools 解环后单向依赖） | `test/act-tools-decycle.test.mjs`（4+ tests） |
| **A-006 部分** | PHASE 3.3（可选） | **新增**（singleton 迁 SQLite 行为） | `test/singleton-migration.test.mjs`（5+ tests） |
| **A-004** | 不启动 | n/a | n/a |
| **E-017 main** | 不启动 | n/a | n/a |
| **E-018** | 不启动 | n/a | n/a |
| **PR-006** | 不启动 | n/a | n/a |
| **C-001-rserver** | 不启动 | n/a | n/a |
| **C-002-rserver** | 不启动 | n/a | n/a |
| **M-001** | 不启动 | n/a | n/a |
| **M-003** | 不启动 | n/a | n/a |

**测试需求统计**：
- **新增**：12 个 ID（A-007 + E-019 full + A-009 + A-010 env + A-002 + A-005 + A-001 + A-003 + A-008 + A-006 部分）= 10 个 ID（PR-012 复用 A-007；A-010 jspdf 不需要）
- **复用**：1 个 ID（PR-012 由 A-007 覆盖）
- **不需要**：1 个 ID（A-010 jspdf dead dep 移除）
- **不启动**：10 个 ID
- **总**：21 项测试 ID = 19 项原始 + 1 项 E-019 partial 拆分 + 1 项 A-006 部分 + 1 项 A-010 拆分

---

## §3 新测试文件建议（哪些 fix 需要新 .test.mjs）

### §3.1 PHASE 1 新测试（3 files / 11+ tests）

| 文件（建议） | 测试数（建议） | 覆盖 ID |
|--------------|----------------|---------|
| `test/db-singleton.test.mjs` | 5+ | A-007 + PR-012 + E-019 full |
| `test/env-coordinator-port.test.mjs` | 3+ | A-009 |
| `test/config-helper-centralized.test.mjs` | 3+ | A-010 env 集中 |

**测试覆盖维度**：

| 测试 # | 文件 | 覆盖维度 |
|--------|------|---------|
| 1 | db-singleton | 抽 `_db-singleton.js` 后 getDatabase 行为 + 同一 dbName 返回同一 instance + 不同 dbName 返回不同 instance |
| 2 | db-singleton | `_resetAllForTests` 清空 cache + test setup/teardown |
| 3 | db-singleton | branch-db + result-db 通过 `_db-singleton` 共享同一 petri.db handle |
| 4 | db-singleton | agent-task-store.js 改用 `_db-singleton` 后 busy_timeout = 10000ms |
| 5 | db-singleton | db.js 改用 `_db-singleton` 后 busy_timeout = 10000ms 一致 |
| 6 | env-coordinator-port | `backendPorts.r` 默认值统一（3003 或 3001 选一） |
| 7 | env-coordinator-port | 4 处 fallback 删除后无 R_SERVER_PORT env → 启动 warn |
| 8 | env-coordinator-port | 启动 r-server 前自检脚本 `getBackendPorts().r === process.env.R_SERVER_PORT` warn 一次 |
| 9 | config-helper-centralized | 6 处 `process.env.*` → `getConfig()` 后行为不变 |
| 10 | config-helper-centralized | `getConfig().busyTimeout` 返回 10000ms |
| 11 | config-helper-centralized | `getConfig().dbPath` 返回 `PETRI_DB_PATH` 注入路径 |

### §3.2 PHASE 2 新测试（3 files / 15+ tests）

| 文件（建议） | 测试数（建议） | 覆盖 ID |
|--------------|----------------|---------|
| `test/routes-result-studio-split.test.mjs` | 5+ | A-002 |
| `test/routes-harness-split.test.mjs` | 5+ | A-005 harness |
| `test/routes-ai-agent-split.test.mjs` | 5+ | A-005 ai-agent |

**测试覆盖维度**：

| 测试 # | 文件 | 覆盖维度 |
|--------|------|---------|
| 1 | routes-result-studio-split | 26+ 端点 → 9 子域文件 映射表正确 |
| 2 | routes-result-studio-split | 子域文件 `register(app, options)` 签名一致 |
| 3 | routes-result-studio-split | 拆分后端点 channel 名 100% 不变 |
| 4 | routes-result-studio-split | 拆分后 payload shape 100% 一致 |
| 5 | routes-result-studio-split | 既有 chf0-http + result-studio-context + result-handlers-valid-types 测试 0 退化 |
| 6 | routes-harness-split | harness 1366 → 3 子文件（workflow / context / repair）映射正确 |
| 7 | routes-harness-split | harness 子域文件 `register(app, options)` 签名一致 |
| 8 | routes-harness-split | 拆分后端点 channel 名 100% 不变 |
| 9 | routes-harness-split | 拆分后 payload shape 100% 一致 |
| 10 | routes-harness-split | 既有 harness 既有测试 0 退化 |
| 11 | routes-ai-agent-split | ai-agent 1222 → 4 子文件（chat / loop / context / tools）映射正确 |
| 12 | routes-ai-agent-split | ai-agent 子域文件 `register(app, options)` 签名一致 |
| 13 | routes-ai-agent-split | SSE endpoint 拆分后 keepalive + chunk 格式 100% 不变 |
| 14 | routes-ai-agent-split | Loop + Tool Call + Conversation 集成路径不变 |
| 15 | routes-ai-agent-split | 既有 ai-agent 既有测试 0 退化 |

### §3.3 PHASE 3 新测试（5 files / 26+ tests）

| 文件（建议） | 测试数（建议） | 覆盖 ID |
|--------------|----------------|---------|
| `test/loop-orchestrator.test.mjs` | 8+ | A-001 LoopOrchestrator |
| `test/conversation-adapter.test.mjs` | 5+ | A-001 ConversationAdapter |
| `test/agent-workflow-configure.test.mjs` | 4+ | A-003 configure 注入 |
| `test/act-tools-decycle.test.mjs` | 4+ | A-008 循环解环 |
| `test/singleton-migration.test.mjs`（可选） | 5+ | A-006 部分 singleton 迁 SQLite |

**测试覆盖维度**：

| 测试 # | 文件 | 覆盖维度 |
|--------|------|---------|
| 1 | loop-orchestrator | 抽 LoopOrchestrator 后 runAgentLoop 主入口 < 600 行 |
| 2 | loop-orchestrator | loop-orchestrator.js 独立运行（不依赖 agent-runner） |
| 3 | loop-orchestrator | `_loopInit / _loopEmitIterationEvent / _loopPersistPhase / _loopPersistProgressIteration` 函数族迁移完整 |
| 4 | loop-orchestrator | 既有 chf0-critical 33 项 0 退化 |
| 5 | loop-orchestrator | agent-runner 既有测试 0 退化 |
| 6 | loop-orchestrator | loop-controller.js 独立 require 0 个 agent-runner 内部函数 |
| 7 | loop-orchestrator | 系统 prompt 拼接 + LLM 调用编排不变 |
| 8 | loop-orchestrator | Event 持久化（task_events / loop_iterations）不变 |
| 9 | conversation-adapter | message append / topic shift / auto title 行为不变 |
| 10 | conversation-adapter | Conversation 同步策略不变 |
| 11 | conversation-adapter | 既有 conversation 相关测试 0 退化 |
| 12 | conversation-adapter | adapter 独立运行（不依赖 agent-runner） |
| 13 | conversation-adapter | SQLite 写入路径不变 |
| 14 | agent-workflow-configure | shared-backend/index.js 暴露 `configure({ projectHarnessWorkflowJob })` 注入点 |
| 15 | agent-workflow-configure | r-server bootstrap.js 启动时 configure 调真实 `projectHarnessWorkflowJob` |
| 16 | agent-workflow-configure | shared-backend 在 non-r-server 上下文（如测试 / widget / CLI）拿到 enriched 不再残缺 |
| 17 | agent-workflow-configure | 既有 agent-workflow 测试 0 退化 |
| 18 | act-tools-decycle | 抽 `act-tool-core.js`（基础工具）+ `act-tool-ui.js`（UI 依赖 plan-ui-tools） |
| 19 | act-tools-decycle | act-tools.js 改为 facade 反向 require core + ui |
| 20 | act-tools-decycle | 解环后 plan-ui-tools.js 不再顶层 require act-tools |
| 21 | act-tools-decycle | 既有 agent-tool-policy 测试 0 退化 |
| 22 | singleton-migration | `_pendingActAcks` 迁 SQLite 后 restart 恢复 |
| 23 | singleton-migration | `_embedCallLog` 迁 SQLite 后 restart 恢复 |
| 24 | singleton-migration | `_aiUserStreams` 迁 SQLite 后 restart 恢复 |
| 25 | singleton-migration | 既有 56+ singleton 中剩余部分保留 ephemeral 内存 cache 行为 |
| 26 | singleton-migration | 既有 agent-task-cancellation 测试 0 退化 |

### §3.4 不新增（复用既有）

- BLOCK-10-AUDIT-CLOSEOUT 已落地的 4 测试文件 0 改动（PHASE 1+2.1 边界守住）
- 既有 chf0-critical + vitest 0 改动

---

## §4 验证门限（每个 PHASE 跑哪些测试）

### §4.1 PHASE 1 验证门

```
node --test \
  test/db-singleton.test.mjs \
  test/env-coordinator-port.test.mjs \
  test/config-helper-centralized.test.mjs

# 期望：11+ tests PASS（5+ + 3+ + 3+）

# 既有 0 退化：
node --test \
  test/block-10-phase2-policy.test.mjs \
  test/backend-health.test.mjs \
  test/db.test.mjs \
  test/agent-task-store.test.mjs

# 期望：既有 PASS 数量不变（0 退化）
```

### §4.2 PHASE 2 验证门

```
node --test \
  test/routes-result-studio-split.test.mjs \
  test/routes-harness-split.test.mjs \
  test/routes-ai-agent-split.test.mjs

# 期望：15+ tests PASS（5+ + 5+ + 5+）

# 既有 0 退化：
node --test \
  test/g0-chf0-acceptance.mjs \                  # IPC contract 33 项
  test/g0-chf0-http.test.mjs \                   # http contract
  test/result-studio-context.test.mjs \          # result-studio context
  test/result-handlers-valid-types.test.mjs \    # result:create validTypes
  test/harness.test.mjs \                        # harness 既有
  test/ai-agent.test.mjs \                       # ai-agent 既有

# 期望：既有 PASS 数量不变（0 退化）
```

### §4.3 PHASE 3 验证门

```
node --test \
  test/loop-orchestrator.test.mjs \
  test/conversation-adapter.test.mjs \
  test/agent-workflow-configure.test.mjs \
  test/act-tools-decycle.test.mjs \
  test/singleton-migration.test.mjs               # 可选

# 期望：26+ tests PASS（8+ + 5+ + 4+ + 4+ + 5+）

# 既有 0 退化：
node --test \
  test/agent-workflow.test.mjs \                  # agent-workflow 既有
  test/agent-tool-policy.test.mjs \               # act-tools / plan-ui-tools 既有
  test/agent-task-cancellation.test.mjs \         # retry 边界
  test/agent-runner.test.mjs \                   # agent-runner 既有（如果有）

# 期望：既有 PASS 数量不变（0 退化）
```

### §4.4 PHASE 4 验证门（docs only）

```
npm run docs:check
npm run ui:audit:check
cd frontend && npx tsc --noEmit
npm run docs:reconcile

# 期望：4 治理门 GREEN

node scripts/g0-chf0-acceptance.mjs
# 期望：3 测试 33 项 PASS

npm run test:changed:list
npm run test:changed
# 期望：既有 21 tests PASS（PHASE 1+2 已落地 BLOCK-10）
```

### §4.5 收口验证门（PHASE 4 完成后）

```
# 默认不跑（按 AGENTS.md 测试范围纪律）：
# npm run test:all:workspace（1300+ 项，耗时数分钟）

# 收口前一次性跑：
node --test \
  test/db-singleton.test.mjs \
  test/env-coordinator-port.test.mjs \
  test/config-helper-centralized.test.mjs \
  test/routes-result-studio-split.test.mjs \
  test/routes-harness-split.test.mjs \
  test/routes-ai-agent-split.test.mjs \
  test/loop-orchestrator.test.mjs \
  test/conversation-adapter.test.mjs \
  test/agent-workflow-configure.test.mjs \
  test/act-tools-decycle.test.mjs \
  test/singleton-migration.test.mjs

# 期望：50+ tests PASS（PHASE 1 11+ + PHASE 2 15+ + PHASE 3 26+）
```

---

## §5 不变量测试（4 治理门 + vitest 受影响范围）

### §5.1 4 治理门（每次 PHASE 收口必跑）

| 命令 | 期望 | 落地 |
|------|------|------|
| `npm run docs:check` | 注册文档数 PASS | ✅ |
| `npm run ui:audit:check` | UI ID 数 PASS | ✅ |
| `cd frontend && npx tsc --noEmit` | 0 error | ✅ |
| `npm run docs:reconcile` | 0 drift | ✅ |

### §5.2 vitest 受影响范围（按 `test/impact-map.json`）

**PHASE 1 涉及**：`src/database/{_db-singleton,branch-db,result-db}.js` + `core/r-server/agent-task-store.js` + `core/r-server/db.js` + `core/shared-backend/config-helper.js` + `src/main/env-coordinator.js` + `core/r-server/{server,config}.js` + `src/{preload,backend-health}.js` + `frontend/package.json`

**PHASE 2 涉及**：`core/r-server/routes/{result-studio,harness,ai-agent}.js` + 13 个新子域文件 + `core/r-server/routes/index.js`

**PHASE 3 涉及**：`core/r-server/agent-runner.js` + `core/r-server/{loop-orchestrator,conversation-adapter}.js`（新）+ `core/shared-backend/{agent-workflow,index}.js` + `core/r-server/bootstrap.js` + `core/r-server/agent-tools/{act-tool-core,act-tool-ui,act-tools}.js` + `core/r-server/agent-task-store.js`

**PHASE 4 涉及**：仅 docs（4 canonical + DOC-REGISTRY + ui-productization-audit + closeout 报告）

### §5.3 受影响范围测试套件

**PHASE 1**：
- `test/db.test.mjs`（r-server db）
- `test/agent-task-store.test.mjs`（agent task store）
- `test/backend-health.test.mjs`（端口）
- `test/mcp-server.test.mjs`（env 注入）

**PHASE 2**：
- `test/g0-chf0-http.test.mjs`（http contract）
- `test/result-studio-context.test.mjs`
- `test/result-handlers-valid-types.test.mjs`
- `test/harness.test.mjs`
- `test/ai-agent.test.mjs`

**PHASE 3**：
- `test/agent-workflow.test.mjs`
- `test/agent-tool-policy.test.mjs`
- `test/agent-task-cancellation.test.mjs`
- `test/agent-runner.test.mjs`（如果有）

**既有 0 退化纪律**：每个 PHASE 收口前必跑 `test:changed:list` + `test:changed`，确保受影响测试 0 失败。

---

## §6 测试覆盖度评估

### §6.1 主范围 12 项测试覆盖矩阵

| ID | 新增 tests | 复用 tests | 总覆盖 |
|----|------------|-----------|--------|
| A-007 | 5+（db-singleton.test） | 既有 db.test | 5+ + 既有 |
| PR-012 | 0（同 A-007） | 同 A-007 | 同 A-007 |
| E-019 full | 0（同 A-007） | 同 A-007 | 同 A-007 |
| A-009 | 3+（env-coordinator-port.test） | 既有 backend-health.test | 3+ + 既有 |
| A-010（jspdf） | 0（不需要） | n/a | n/a |
| A-010（6 env） | 3+（config-helper-centralized.test） | 既有 mcp-server.test | 3+ + 既有 |
| A-002 | 5+（routes-result-studio-split.test） | 既有 chf0-http + result-studio | 5+ + 既有 |
| A-005 | 5+ + 5+（routes-harness-split + routes-ai-agent-split） | 既有 harness + ai-agent | 10+ + 既有 |
| A-001 | 8+ + 5+（loop-orchestrator + conversation-adapter） | 既有 agent-runner.test | 13+ + 既有 |
| A-003 | 4+（agent-workflow-configure.test） | 既有 agent-workflow.test | 4+ + 既有 |
| A-008 | 4+（act-tools-decycle.test） | 既有 agent-tool-policy.test | 4+ + 既有 |
| A-006 部分 | 5+（singleton-migration.test） | 既有 agent-task-cancellation.test | 5+ + 既有 |

### §6.2 测试覆盖度风险点

| 风险点 | 描述 | 缓解 |
|--------|------|------|
| A-002 + A-005 http 契约 100% 不变 | 拆分后必须确保所有 26+ + 7 端点响应一致 | 既有 chf0-http + result-studio + harness + ai-agent 测试是契约边界证据；PHASE 2 拆分后必须 0 退化 |
| A-001 agent loop 状态机 0 变化 | 拆分后必须确保所有 4 大类 require 行为完全一致 | 既有 chf0-critical + agent-runner 测试是契约边界证据；PHASE 3.1 拆分后必须 0 退化 |
| A-006 部分 singleton 迁 SQLite 写入者竞争 | 5 处迁 SQLite 后必须确保既有 agent_task_events 表写入者不冲突 | 既有 agent-task-cancellation 测试是边界证据；PHASE 3.3 拆完后必须 0 退化 |
| A-007 + PR-012 + E-019 full 进程边界不破坏 | desktop main 进程 + r-server 进程同时打开 petri.db | 既有 chf0-critical IPC contract 33 项是契约边界证据；PHASE 1.1 拆完后必须 0 退化 |

### §6.3 BLOCK-10-AUDIT-CLOSEOUT 测试沿用

- 既有 4 测试文件 21 tests 0 改动（沿用）
- 既有 chf0-critical 33 项 0 退化（沿用）
- 既有 vitest 75/630 0 退化（沿用）

---

## §7 已知遗留风险点

### §7.1 既有测试精度边界

- BLOCK-10-AUDIT-CLOSEOUT PHASE 2 commit 2/3/4 未新增测试文件（沿用既有 chf0-critical + vitest 测试覆盖），PHASE 4 closeout 报告标注"精度有限"
- 既有 `test/window-controls.test.mjs:201` 断言缺 `window:toggleFullScreen`（git stash 验证 pre-existing），不影响本 PHASE 范围

### §7.2 新测试精度边界

- `test/db-singleton.test.mjs` 5+ tests 覆盖抽 `_db-singleton.js` 行为；但不覆盖既有 agent-task-store / branch-db / result-db 既有测试精度
- `test/routes-*-split.test.mjs` 5+ tests 覆盖拆分后端点 → domain 映射；但不覆盖既有 route handler 内部逻辑（既有 chf0-http 覆盖）

---

**不变量**：本 test-matrix 报告 0 行代码改动 / 0 行 git 操作 / 0 跑测试。下游 v0.1 active 计划基于本报告。
