# BLOCK-10 PHASE 0 — Test Coverage Matrix

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑测试）
> **基线**：`docs/block-10-ph0-survey.md` + `docs/code-audit-closeout-plan.md` v0.1
> **下游**：`docs/code-audit-closeout-plan.md` v0.2

---

## §1 现有测试覆盖（grep + test/ 目录）

### §1.1 已落地测试（BLOCK-10 PHASE 1 + PHASE 2 commit 1）

| 测试文件 | 路径 | 测试数 | 覆盖 ID |
|----------|------|--------|---------|
| `preload-branch-result-namespaces.test.mjs` | `test/` | 3 | C-001 |
| `result-handlers-valid-types.test.mjs` | `test/` | 2 | C-002 |
| `migration-007-conversation-export.test.mjs` | `test/` | 4 | C-002 DB migration |
| `block-10-phase2-policy.test.mjs` | `test/` | 12 | S-001 + S-002 + S-003 |

**已落地测试总数**：4 个文件 / **21 tests**

### §1.2 已落地但未新增测试（PHASE 2 commit 2/3/4）

| commit | ID | 测试覆盖方式 |
|--------|----|----|
| `4f9a10f` | S-004 + S-005 + S-006 + S-007 | **沿用既有 chf0-critical / vitest**：sender guard 失败用例由 `g0-chf0-http` / `agent-tool-policy` / `result-studio-context` 已有 fixture 触发；workspace_exec capability tokens 通过既有 `workspace-tools` 测试；retry_stats 通过 `agent-task-cancellation`；diagnostic 通过 `diagnostic-redaction` |
| `a09f706` | PR-001 + E-017 partial + E-019 partial | **沿用既有 vitest + 内部 sweeper 单测**：retention-sweeper.js 内部自带 idempotency 检查；server.js installBackendExitLifecycle 通过 `core/r-server/server.js` 既有启动测试 |
| `1fedf9c` | OB-004 + OB-005 partial | **沿用既有 mcp-server 测试**：health endpoint 6 行小改通过 `mcp-server` 测试覆盖 |

**未新增测试文件**：3 个 commits（`4f9a10f` + `a09f706` + `1fedf9c`）。

### §1.3 现有测试目录（201 个 test files）

来源：`ls test/ | wc -l` = 201 个 test files（截至 2026-08-17）

按 BLOCK-10 修复 ID 相关度筛选：

| 测试文件 | 相关 ID | 备注 |
|----------|---------|------|
| `agent-tool-policy.test.mjs` | S-001 | 既有；PHASE 2 commit 1 12 tests 已覆盖 |
| `agent-task-cancellation.test.mjs` | S-006 | 既有；覆盖 retry_stats 边界 |
| `agent-workflow.test.mjs` | S-006 | 既有；覆盖 task_id 隔离 |
| `agent-tool-registry.test.mjs` | PL-001 | 既有；PHASE 3 需扩 |
| `agent-provider-boundary.test.mjs` | S-003 | 既有；覆盖 accessMode 透传 |
| `plugin-loader-refresh.test.mjs` | PL-001 | 既有；PHASE 3 需扩 |
| `plugin-manifest-schema.test.mjs` | PL-001 | 既有；PHASE 3 需扩 |
| `plugin-checksum-fail-closed.test.mjs` | — | 既有；与 BLOCK-10 无关 |
| `owned-backend-supervisor.test.mjs` | E-017 partial / E-018 | 既有；r-server 进程级 lifecycle 通过此测试 |
| `backend-health.test.mjs` | OB-005 partial | 既有；覆盖 health endpoint |
| `result-studio-context.test.mjs` | S-002 | 既有；覆盖 contextToken 三元组 |
| `result-handlers-valid-types.test.mjs` | C-002 | **新增**（PHASE 1） |
| `preload-branch-result-namespaces.test.mjs` | C-001 | **新增**（PHASE 1） |
| `migration-007-conversation-export.test.mjs` | C-002 DB | **新增**（PHASE 1） |
| `block-10-phase2-policy.test.mjs` | S-001/S-002/S-003 | **新增**（PHASE 2 commit 1） |

---

## §2 25 项修复的测试需求

> **格式**：每项标注 **新增** / **复用** / **不需要**。

| ID | 阶段 | 测试需求 | 落地测试文件 |
|----|------|---------|-------------|
| **C-001** | PHASE 1 | **新增**（vm harness 验证 preload 1:1 镜像 d.ts） | `preload-branch-result-namespaces.test.mjs`（3 tests） |
| **C-002** | PHASE 1 | **新增**（validTypes 含 conversation_export + createResult 实参） | `result-handlers-valid-types.test.mjs`（2 tests） |
| **C-002 DB migration** | PHASE 1 | **新增**（migration 007 CHECK + 12-step rebuild + 依赖 006） | `migration-007-conversation-export.test.mjs`（4 tests） |
| **S-001** | PHASE 2.1 | **新增**（capability + checkAllowedDownstream 边界） | `block-10-phase2-policy.test.mjs`（6 tests） |
| **S-002** | PHASE 2.1 | **新增**（三元组校验） | `block-10-phase2-policy.test.mjs`（4 tests） |
| **S-003** | PHASE 2.1 | **新增**（accessMode 透传 / 自然语言不推断） | `block-10-phase2-policy.test.mjs`（2 tests） |
| **S-004** | PHASE 2.2 | **复用**（既有 `g0-chf0-http` + `agent-tool-policy`） | 无新增 |
| **S-005** | PHASE 2.2 | **复用**（既有 `workspace-tools.test.mjs`） | 无新增 |
| **S-006** | PHASE 2.2 | **复用**（既有 `agent-task-cancellation.test.mjs` + `agent-workflow.test.mjs`） | 无新增 |
| **S-007** | PHASE 2.2 | **复用**（既有 `diagnostic-redaction.test.mjs`） | 无新增 |
| **PR-001** | PHASE 2.3 | **复用**（既有 `db.js` + `mcp-server` 测试） | 无新增 |
| **E-017 partial (r-server)** | PHASE 2.3 | **复用**（既有 `owned-backend-supervisor.test.mjs`） | 无新增 |
| **E-019 partial (config-helper)** | PHASE 2.3 | **不需要**（r-server 单进程 db config helper，无外部契约） | 无 |
| **OB-004** | PHASE 2.4 | **复用**（既有 `mcp-server.test.mjs`） | 无新增 |
| **OB-005 partial (health)** | PHASE 2.4 | **复用**（既有 `backend-health.test.mjs`） | 无新增 |
| **PL-001** | **PHASE 3** | **新增**（10 工具插件 × 5 schema 字段 × 边界用例） | **待新增** `_validate-tool-args.test.mjs`（10 tests） |
| **E-017 main** | 不外推 | n/a | n/a |
| **E-018** | 不外推 | n/a | n/a |
| **E-019 full** | 不外推 | n/a | n/a |
| **OB-001** | 不外推 | n/a | n/a |
| **OB-002** | 不外推 | n/a | n/a |
| **OB-003** | 不外推 | n/a | n/a |
| **OB-005 full** | 不外推 | n/a | n/a |
| **PR-006** | 不外推 | n/a | n/a |
| **PR-012** | 不外推 | n/a | n/a |
| **C-001-rserver** | 不外推 | n/a | n/a |
| **C-002-rserver** | 不外推 | n/a | n/a |
| **M-001** | 不外推 | n/a | n/a |
| **M-003** | 不外推 | n/a | n/a |

**测试需求统计**：
- 新增：5 个 ID（C-001 + C-002 + C-002 DB + S-001 + S-002 + S-003 + PL-001）= **7 个 ID**
- 复用：8 个 ID（S-004..S-007 + PR-001 + E-017 partial + OB-004 + OB-005 partial）
- 不需要：1 个 ID（E-019 partial config-helper 无外部契约）
- 不外推：13 个 ID
- 总：29 项测试 ID = 25 项 + 1 项 DB migration + 1 项 E-019 partial + 2 项 OB-005 拆分

---

## §3 新测试文件建议（哪些 fix 需要新 .test.mjs / .test.ts）

### §3.1 已新增（4 个文件 / 21 tests）

| 文件 | 测试数 | commit |
|------|--------|--------|
| `test/preload-branch-result-namespaces.test.mjs` | 3 | `1c0ebf0` |
| `test/result-handlers-valid-types.test.mjs` | 2 | `1c0ebf0` |
| `test/migration-007-conversation-export.test.mjs` | 4 | `1c0ebf0` |
| `test/block-10-phase2-policy.test.mjs` | 12 | `128b3d4` |

### §3.2 待新增（PHASE 3 / 1 个文件 / 10 tests）

| 文件（建议） | 测试数（建议） | 覆盖 ID |
|--------------|----------------|---------|
| `test/mcp-calltool-input-schema.test.mjs` | 10 | PL-001 |

**测试覆盖维度**：

| 测试 # | 工具插件 | schema 字段 | 用例 |
|--------|----------|-------------|------|
| 1 | deseq2 | `padj_cutoff` (number, min:0, max:1) | `padj_cutoff=-10` 拒绝；`padj_cutoff=0.05` 通过；`padj_cutoff=1.5` 拒绝 |
| 2 | deseq2 | `lfc_cutoff` (number, min:0) | `lfc_cutoff=1e9` 拒绝（> safe upper bound）；`lfc_cutoff=0.5` 通过 |
| 3 | go-kegg | `soft_power` (integer, min:1, max:30) | `soft_power=-1` 拒绝；`soft_power=6` 通过；`soft_power=100` 拒绝 |
| 4 | volcano | `fc_threshold` (number, min:0) | `fc_threshold=NaN` 拒绝；`fc_threshold=1.5` 通过 |
| 5 | heatmap | `top_genes` (integer, min:1, max:10000) | `top_genes=0` 拒绝；`top_genes=50` 通过；`top_genes=99999` 拒绝 |
| 6 | PCA | `n_components` (integer, min:2, max:50) | 边界值 + required 检查 |
| 7 | correlation | `method` (enum: 'pearson' / 'spearman') | `method='invalid'` 拒绝；`method='pearson'` 通过 |
| 8 | generic | required check | 缺 required 字段 → 拒绝 |
| 9 | generic | type check | 字符串传 number 字段 → 拒绝 |
| 10 | generic | happy-path | 正常调用 schema 通过 |

### §3.3 不新增（复用既有）

PHASE 2 commit 2/3/4 不新增测试文件，沿用既有：
- `g0-chf0-http.test.mjs`（IPC contract 兼容性）
- `g0-chf0-lifecycle.test.mjs`（backend lifecycle）
- `agent-tool-policy.test.mjs`（capability 边界）
- `agent-task-cancellation.test.mjs`（retry 边界）
- `owned-backend-supervisor.test.mjs`（supervisor restart）
- `backend-health.test.mjs`（health endpoint）
- `result-studio-context.test.mjs`（contextToken）
- `migration-runner.test.mjs`（migration runner）

**既有测试覆盖 BLOCK-10 修复点**的精度有限，PHASE 4 closeout 时可在 closeout 报告中标注「精度边界」。

---

## §4 验证门限（每个 PHASE 跑哪些测试）

### §4.1 PHASE 1 验证门（已落地）

```
node --test \
  test/preload-branch-result-namespaces.test.mjs \
  test/result-handlers-valid-types.test.mjs \
  test/migration-007-conversation-export.test.mjs

# 期望：9/9 PASS
```

### §4.2 PHASE 2 验证门（已落地）

```
node --test \
  test/block-10-phase2-policy.test.mjs

# 期望：12/12 PASS

# 沿用既有（不新增文件）：
node --test \
  test/agent-tool-policy.test.mjs \
  test/agent-task-cancellation.test.mjs \
  test/owned-backend-supervisor.test.mjs \
  test/backend-health.test.mjs \
  test/result-studio-context.test.mjs

# 期望：既有 PASS 数量不变（0 退化）
```

### §4.3 PHASE 3 验证门（待启动）

```
node --test \
  test/mcp-calltool-input-schema.test.mjs \
  test/agent-tool-registry.test.mjs \
  test/plugin-loader-refresh.test.mjs \
  test/plugin-manifest-schema.test.mjs

# 期望：10 新增 tests PASS + 既有 0 退化
```

### §4.4 PHASE 4 验证门（待启动，docs only）

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
# 期望：21 tests PASS（PHASE 1 + PHASE 2 已落地）
```

### §4.5 收口验证门（PHASE 4 完成后）

```
# 默认不跑（按 AGENTS.md 测试范围纪律）：
# npm run test:all:workspace（1300+ 项，耗时数分钟）

# 收口前一次性跑：
node --test \
  test/preload-branch-result-namespaces.test.mjs \
  test/result-handlers-valid-types.test.mjs \
  test/migration-007-conversation-export.test.mjs \
  test/block-10-phase2-policy.test.mjs \
  test/mcp-calltool-input-schema.test.mjs

# 期望：31 tests PASS（PHASE 1 9 + PHASE 2 12 + PHASE 3 10）
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

PHASE 1 涉及：`frontend/src/lib/branchBridge.ts` + `frontend/src/lib/resultBridge.ts` + `frontend/src/pages/BranchTabsWrapper.tsx` + `frontend/src/pages/ResultStudioPage.tsx`

PHASE 2 涉及：`src/ipc/branch-handlers.js` + `src/ipc/result-handlers.js` + `src/ipc/ai-settings.js` + `src/ipc/plugin.js` + `src/ipc/diagnostic.js` + `core/r-server/agent-tools/agent-tool-policy.js` + `core/r-server/agent-tools/result-context-binding.js` + `core/r-server/helpers/agent-execution-policy.js` + `core/r-server/agent-task-store.js` + `core/r-server/agent-tools/workspace-tools.js` + `core/r-server/jobs/retention-sweeper.js` + `core/r-server/server.js` + `src/main.js`

PHASE 3 涉及：`core/r-server/mcp/registry.js` + `core/r-server/plugin-loader.js` + 新文件 `_validate-tool-args.js`

### §5.3 chf0-critical（plugin IPC contract 兼容性）

```
node scripts/g0-chf0-acceptance.mjs
```

**期望**：3 tests / 33 项 PASS（已落地收口状态：33/33 PASS）

---

## §6 测试未覆盖风险点（必须在 closeout 标注）

### §6.1 PHASE 2 commit 2/3/4 测试精度有限

| ID | 落地测试 | 精度问题 |
|----|----------|----------|
| S-004 sender guard | 沿用既有 chf0-http | 仅覆盖 happy-path；非法 sender 需手工注入测试 |
| S-005 workspace_exec capability | 沿用 workspace-tools | capability tokens 白名单 vs 黑名单并发覆盖需手工 |
| S-006 retry_stats task_id | 沿用 agent-task-cancellation | 仅覆盖 retry 边界，task_id 隔离需 fixture 注入 |
| S-007 diagnostic targetPath null | 沿用 diagnostic-redaction | 仅 redaction 覆盖，targetPath null 行为需手工 |
| PR-001 retention | 沿用 db.js + mcp-server | retention 频率 + table 列表完整覆盖需手工 |
| E-017 partial r-server lifecycle | 沿用 owned-backend-supervisor | supervisor 与 r-server lifecycle 互锁需手工 |
| E-019 partial config-helper | 无测试 | 单进程 db config helper 无外部契约 |
| OB-004 error_log 路径 | 沿用 mcp-server | 路径写权限 + dedupe 行为需手工 |
| OB-005 partial health | 沿用 backend-health | health endpoint 6 行小改已覆盖；liveness/readiness 分离未做 |

### §6.2 PHASE 3 PL-001 测试覆盖要点

- 必须覆盖 10 个工具插件的 schema
- 必须覆盖 5 个 schema 字段类型（required / type / minimum / maximum / enum）
- 必须覆盖 happy-path + 3 个边界用例（min、max、enum 错值）
- **不覆盖** schema 之外的自定义校验（plugin 内部 handler 不在 PL-001 范围）

---

**不变量**：本测试矩阵报告 0 行代码改动 / 0 行 git 操作 / 0 跑测试。下游 v0.2 active 计划基于本报告。
