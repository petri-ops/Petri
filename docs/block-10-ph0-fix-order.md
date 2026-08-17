# BLOCK-10 PHASE 0 — Fix Order & DAG

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑 docs:check）
> **基线**：`docs/block-10-ph0-survey.md` + `docs/code-audit-closeout-plan.md` v0.1
> **下游**：`docs/code-audit-closeout-plan.md` v0.2

---

## §1 依赖 DAG（25 项修复单元之间的前置依赖）

### §1.1 已落地 DAG（PHASE 1 + PHASE 2 = 5 commits）

```
                    ┌──────────────┐
                    │ C-001 IPC    │
                    │ branch/result│
                    │ bridge       │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ C-002 result │
                    │ :create      │
                    │ conversation │
                    │ _export      │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ DB migration │
                    │ 007 (CHECK   │
                    │ rebuild)     │
                    └──────┬───────┘
                           │ ← commit 1c0ebf0 PHASE 1 收口
                           ▼
                    ┌──────────────┐
                    │ S-001 cap    │
                    │ allowedDown  │
                    │ stream       │
                    ├──────────────┤
                    │ S-002 ctxTok │
                    │ 三元组校验   │
                    ├──────────────┤
                    │ S-003 exec   │
                    │ Policy 显式  │
                    └──────┬───────┘
                           │ ← commit 128b3d4 PHASE 2 commit 1
                           ▼
                    ┌──────────────┐
                    │ S-004 sender │
                    │ guard helper │
                    ├──────────────┤
                    │ S-005 ws_exec│
                    │ capability   │
                    ├──────────────┤
                    │ S-006 retry  │
                    │ stats task_id│
                    ├──────────────┤
                    │ S-007 diag   │
                    │ targetPath 0 │
                    └──────┬───────┘
                           │ ← commit 4f9a10f PHASE 2 commit 2
                           ▼
                    ┌──────────────┐
                    │ PR-001       │
                    │ retention    │
                    │ sweeper      │
                    ├──────────────┤
                    │ E-017 (r-srv)│
                    │ process exit │
                    ├──────────────┤
                    │ E-019 partial│
                    │ config-helper│
                    └──────┬───────┘
                           │ ← commit a09f706 PHASE 2 commit 3
                           ▼
                    ┌──────────────┐
                    │ OB-004 error │
                    │ log path     │
                    ├──────────────┤
                    │ OB-005 part  │
                    │ health ep    │
                    └──────┬───────┘
                           │ ← commit 1fedf9c PHASE 2 commit 4 收口
                           ▼
```

### §1.2 待启动 DAG（PHASE 3 + PHASE 4 = 3-4 commits）

```
                    ┌──────────────┐
                    │ plugin-loader│
                    │ .js 暴露     │
                    │ getInputSchema│
                    │ (toolId)     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ 新文件       │
                    │ _validate-   │
                    │ tool-args.js │
                    │ 极简 validator│
                    │ (required /  │
                    │ type / min / │
                    │ max / enum)  │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ registry.js  │
                    │ callTool     │
                    │ 入口调       │
                    │ _validateToolArgs│
                    │ before _run  │
                    │ PluginScript │
                    └──────┬───────┘
                           │ ← commit PL-001 PHASE 3 收口
                           ▼
                    ┌──────────────┐
                    │ PHASE 4      │
                    │ audit + closeout│
                    │ 4 canonical  │
                    │ + DOC-REGISTRY│
                    │ + closeout   │
                    │ 报告         │
                    └──────────────┘
                           │ ← commit 1..3 PHASE 4 收口
                           ▼
                       COMPLETED
```

### §1.3 完整 DAG（26 项）

| 阶段 | 节点 | 前置 | 落地状态 |
|------|------|------|----------|
| PHASE 1 | C-001 | — | ✅ `1c0ebf0` |
| PHASE 1 | C-002 | C-001 | ✅ `1c0ebf0` |
| PHASE 1 | DB migration 007 | C-002 | ✅ `1c0ebf0` |
| PHASE 2 commit 1 | S-001 | C-001 + C-002 | ✅ `128b3d4` |
| PHASE 2 commit 1 | S-002 | S-001 | ✅ `128b3d4` |
| PHASE 2 commit 1 | S-003 | S-001 | ✅ `128b3d4` |
| PHASE 2 commit 2 | S-004 | S-001..S-003 | ✅ `4f9a10f` |
| PHASE 2 commit 2 | S-005 | S-004 | ✅ `4f9a10f` |
| PHASE 2 commit 2 | S-006 | S-004 | ✅ `4f9a10f` |
| PHASE 2 commit 2 | S-007 | S-004 | ✅ `4f9a10f` |
| PHASE 2 commit 3 | PR-001 | S-001..S-007 | ✅ `a09f706` |
| PHASE 2 commit 3 | E-017 partial (r-server) | S-001..S-007 | ✅ `a09f706` |
| PHASE 2 commit 3 | E-019 partial (config-helper) | S-001..S-007 | ✅ `a09f706` |
| PHASE 2 commit 4 | OB-004 | PR-001 | ✅ `1fedf9c` |
| PHASE 2 commit 4 | OB-005 partial | PR-001 | ✅ `1fedf9c` |
| **PHASE 3** | **PL-001** | **OB-004 + OB-005 partial** | **⏳ 待启动** |
| PHASE 4 | DOC-REGISTRY update | PL-001 | ⏳ 待启动 |
| PHASE 4 | roadmap/handoff 同步 | PL-001 | ⏳ 待启动 |
| PHASE 4 | ui-productization-audit 同步 | PL-001 | ⏳ 待启动 |
| PHASE 4 | closeout 报告 | PL-001 | ⏳ 待启动 |

---

## §2 commit 拆分建议（每个 commit 包含哪些修复）

### §2.1 已落地 commit（历史 anchor）

| commit hash | commit msg | 涉及 ID | 改动文件数 | net +/- |
|-------------|------------|---------|------------|---------|
| `1c0ebf0` | `fix(block-10-audit-closeout): PHASE 1 IPC bridge + result type` | C-001 + C-002 + DB migration 007 | 5 文件 + 1 new migration | preload.js +30, result-handlers.js +4, migration new, + 2 new test files |
| `128b3d4` | `fix(block-10-audit-closeout): capability + contextToken + execPolicy` | S-001 + S-002 + S-003 | 3 源文件 + 1 new test | agent-tool-policy.js ±39, agent-execution-policy.js ±40, registry.js ±16, test new 192 |
| `4f9a10f` | `fix(block-10-audit-closeout): sender guard + workspace_exec + retry_stats + diagnostic` | S-004 + S-005 + S-006 + S-007 | 9 源文件 + 1 new helper | _sender-guard.js new 72, agent-task-store.js ±133, workspace-tools.js ±16, branch-handlers.js ±297, result-handlers.js ±41, ai-settings.js ±12, plugin.js ±29, diagnostic.js ±25, main.js ±8 |
| `a09f706` | `fix(block-10-audit-closeout): retention + backend_exit + db_config` | PR-001 + E-017 partial + E-019 partial | 3 源文件 + 1 new job | retention-sweeper.js new 229, server.js +93, config-helper.js ±91 |
| `1fedf9c` | `fix(block-10-audit-closeout): error_log + health_endpoint` | OB-004 + OB-005 partial | 2 源文件 | routes/index.js +11, mcp-server.js ±6 |

### §2.2 待启动 commit（建议拆分）

| commit # | commit msg（建议） | 涉及 ID | 改动文件数 | 预估 net +/- |
|----------|-------------------|---------|------------|-------------|
| PL-3-1 | `fix(block-10-audit-closeout): MCP callTool inputSchema validation` | PL-001 | 3 源文件 + 1 new helper + 1 new test | plugin-loader.js +20, registry.js +40, _validate-tool-args.js new 80, test new ~150 |
| PHASE-4-1 | `docs(block-10-audit-closeout): PHASE 4 audit + DOC-REGISTRY sync` | PHASE 4 doc 同步 | 4 canonical docs | README.md / next-steps-roadmap.md / project-workspace-handoff.md / DOC-REGISTRY.json |
| PHASE-4-2 | `docs(block-10-audit-closeout): ui-productization-audit ledger entry` | PHASE 4 audit ledger | 1 audit doc | ui-productization-audit.md |
| PHASE-4-3 | `docs(block-10-audit-closeout): closeout report v1.0` | PHASE 4 closeout | 1 new doc | block-10-audit-closeout.md new |

**推荐 PHASE 3 单 commit / PHASE 4 三 commit**（与 v0.1 PHASE 4 §4 建议「4 canonical 文档同步可以分 2-3 个 commit」一致）。

---

## §3 PHASE 划分（按依赖关系推导 4 PHASE 各包含哪些修复）

### §3.1 PHASE 1 — P0 用户可见（C-001 + C-002 + DB migration 007）

**目标**：用户打开 Result Studio 不再抛 "bridge not available"；`result:create` 支持 `conversation_export` 类型；DB 层接受新 CHECK 约束。

**ID**：C-001, C-002

**commit**：1（`1c0ebf0`）

**状态**：✅ **已收口**（2026-08-17 22:12）

### §3.2 PHASE 2 — P1 安全/资源（14 项分 4 commit）

**目标**：所有 RCE 边界、contextToken fail-closed、execution policy、sender 守门、command 黑名单、retry 单例、diagnostic 路径、SQLite 归档、backend exit（r-server 进程级）、SQLite config helper、error-log 路径、health endpoint 全部收口。

**ID**：S-001, S-002, S-003, S-004, S-005, S-006, S-007, PR-001, E-017 partial, E-019 partial, OB-004, OB-005 partial

**commit**：4（`128b3d4` + `4f9a10f` + `a09f706` + `1fedf9c`）

**状态**：✅ **已收口**（2026-08-17 23:54）

**commit 拆分理由**：

| commit | 拆分维度 | 涉及文件 |
|--------|----------|----------|
| `128b3d4` | **同根 capability 算法**（S-001 + S-002 + S-003 都是 agent 工具策略层） | 3 源文件（agent-tool-policy / result-context-binding / agent-execution-policy） |
| `4f9a10f` | **同根 IPC + retry + diagnostic 收口**（S-004 + S-005 + S-006 + S-007 都是 fail-closed 收口） | 9 源文件（5 handler + agent-task-store + workspace-tools + main.js + new helper） |
| `a09f706` | **同根 r-server lifecycle**（PR-001 + E-017 partial + E-019 partial 都是 r-server 子进程级资源管理） | 3 源文件（retention-sweeper new + server.js + config-helper） |
| `1fedf9c` | **同根 observability 收口**（OB-004 + OB-005 partial 都是 observability 最后一公里） | 2 源文件（routes/index.js + mcp-server.js） |

### §3.3 PHASE 3 — P2 契约（PL-001）

**目标**：MCP callTool 入口增加 inputSchema 校验，防止 prompt 注入构造超界数值。

**ID**：PL-001

**commit**：1（PL-3-1，建议）

**状态**：⏳ **待启动**

### §3.4 PHASE 4 — audit + closeout

**目标**：4 canonical 文档同步 + DOC-REGISTRY 登记 + ui-productization-audit 增 entries + closeout 报告。

**ID**：PHASE 4（无新 finding；纯 audit + closeout）

**commit**：3（PHASE-4-1 + PHASE-4-2 + PHASE-4-3，建议）

**状态**：⏳ **待启动**

---

## §4 关键路径（critical path）识别

### §4.1 总关键路径

```
C-001 → C-002 → DB migration 007 → S-001 → S-002/S-003 → S-004 → S-005/S-006/S-007 → PR-001 → OB-004 → PL-001 → PHASE 4 audit → PHASE 4 closeout
```

### §4.2 关键路径时长估算

| 节点 | 工作量 | 累计 |
|------|--------|------|
| C-001 + C-002 + DB migration 007 | 0.5 commit（PHASE 1） | 0.5 |
| S-001 + S-002 + S-003 | 0.5 commit（PHASE 2.1） | 1.0 |
| S-004 + S-005 + S-006 + S-007 | 1 commit（PHASE 2.2） | 2.0 |
| PR-001 + E-017 + E-019 + OB-004 + OB-005 | 1 commit（PHASE 2.3+2.4） | 3.0 |
| PL-001 | 1 commit（PHASE 3） | 4.0 |
| PHASE 4 audit + closeout | 3 commit（PHASE 4） | 7.0 |

**累计**：7 commit 完整工作量（已落地 5 + 待启动 2-4）。

### §4.3 关键路径风险点

| 节点 | 风险 |
|------|------|
| S-001 capability 算法 | **最高风险**：错误算法导致 plugin shell 执行仍可绕过（已用 12 tests 验证） |
| S-004 sender guard | 中风险：未覆盖 5 类 handler 时，webview 注入仍可调用 IPC（已 additive 扩到 5 类） |
| PL-001 MCP inputSchema | **关键路径最后节点**：10 工具插件 × 5 schema 字段，必须确保 0 误拒（未启动） |

---

## §5 可并行 ID（如果存在）

### §5.1 严格并行 ID（无相互依赖）

| ID | 备注 |
|----|------|
| **S-002** ∥ **S-003** | S-002 改 `result-context-binding.js`，S-003 改 `agent-execution-policy.js`，文件不交叉 |
| **S-005** ∥ **S-006** ∥ **S-007** | 各自改不同文件（workspace-tools / agent-task-store / diagnostic） |

### §5.2 实际未并行（commit 内串行）

实际执行时，**所有上述可并行 ID 都在同一 commit 内串行落地**（commit `128b3d4` 内 S-001/S-002/S-003 串行 + commit `4f9a10f` 内 S-004/S-005/S-006/S-007 串行）。

**为什么不并行 commit**：
- 单 commit 粒度更便于审阅（4 PHASE 2 commits 平均 1 个 commit = 3-4 finding ID）
- 主 agent + worker 委派工作模式并行度有限（worker 数量受 luna_worker 注册量限制）
- 治理门（4 治理门 + chf0-critical + vitest）每次 commit 后必跑；并行 commit 容易触发 fail-closed 重叠

### §5.3 未来可探索的真并行（PHASE 3 之后）

- **PL-001** 与 **PHASE 4 audit** 可并行（一个是 plugin 校验代码改动，一个是 docs 同步）
- 但 PHASE 4 audit 必须在 PL-001 测试通过后才跑（PL-001 收口后才能写 closeout 报告）—— **逻辑依赖，不是文件依赖**

---

## §6 偏离声明（与 v0.1 规划的偏差）

### §6.1 范围偏差

| 偏差项 | v0.1 规划 | 实际落地 | 偏差原因 |
|--------|-----------|---------|---------|
| **backend exit** | Electron 主进程侧 `backend-proc-manager.js` 加 `safeProcExit` helper + IPC send | r-server 子进程侧 `core/r-server/server.js` 加 `installBackendExitLifecycle` + `db.close()` | 主进程侧已 BLOCK-9.1 收口；r-server 子进程级更可控（不需要 IPC 跨进程） |
| **SQLite busy_timeout 统一** | 抽 `core/shared-backend/db-config.js` 统一 `BUSY_TIMEOUT_MS = 10000` | 命名上引入 `core/shared-backend/config-helper.js`，但**仅 r-server 单进程 db config helper**，不动 agent-task-store / branch-db / result-db | DB 体系化超出当前 PHASE 范围；按 BLOCK-10-ARCHITECTURE 候选推迟 |
| **health 三层分离** | 抽 `core/shared-backend/health.js` 统一 `/api/live` + `/api/ready` + `/api/health` | 仅在 `src/mcp-server.js` 加 6 行 health endpoint | observability 体系化超出当前 PHASE 范围 |

### §6.2 commit 粒度偏差

- v0.1 §4 PHASE 2 建议 4 commit，实际落地 4 commit（一致）
- v0.1 §4 PHASE 4 建议 2-3 commit，建议 3 commit（一致）
- v0.1 §4 PHASE 3 建议 1 commit，建议 1 commit（一致）

### §6.3 测试覆盖偏差

- v0.1 §6.3 列出 15 个测试文件（5 core/r-server + 3 core/shared-backend + 4 src/ipc + 1 src/main + 2 frontend）
- 实际落地 4 个测试文件（3 PHASE 1 + 1 PHASE 2 commit 1）：`preload-branch-result-namespaces.test.mjs` / `result-handlers-valid-types.test.mjs` / `migration-007-conversation-export.test.mjs` / `block-10-phase2-policy.test.mjs`
- **偏差**：PHASE 2 commit 2/3/4 未新增测试文件（沿用既有 chf0-critical + vitest 测试覆盖）
- **PHASE 3 待启动时需新增 1 个测试文件**（与 v0.1 一致）

---

## §7 推荐 PHASE 1 启动顺序（仅供 PL-001 + PHASE 4 用）

> **PHASE 1 已收口**，本节仅面向「PHASE 3 PL-001 + PHASE 4 closeout」的剩余工作。

### §7.1 4 个 commit 启动顺序

```
1. PL-3-1（fix）：MCP callTool inputSchema validation
2. PHASE-4-1（docs）：4 canonical 同步 + DOC-REGISTRY
3. PHASE-4-2（docs）：ui-productization-audit ledger entry
4. PHASE-4-3（docs）：closeout 报告 v1.0
```

### §7.2 每个 commit 包含的 ID

| commit | ID / 内容 |
|--------|-----------|
| **PL-3-1** | PL-001 单一 finding；plugin-loader.js 暴露 `getInputSchema(toolId)` + 新文件 `_validate-tool-args.js` 极简 validator + registry.js callTool 入口调用 |
| **PHASE-4-1** | DOC-REGISTRY `BLOCK-10-AUDIT-CLOSEOUT` active → completed + linkedCommits 7 项（PHASE 1 + PHASE 2 4 commits + PHASE 3 1 commit + closeout 1 commit）+ roadmap launch/closeout entry + handoff launch/closeout entry + AUDIT-LOG PHASE 1/2/3/4 entry（5 entries） |
| **PHASE-4-2** | ui-productization-audit.md 加 entry「BLOCK-10-AUDIT-CLOSEOUT 工作包收口」（含 UI-### 占位与状态同步）；按 BLOCK-9.2 closeout 报告格式 |
| **PHASE-4-3** | block-10-audit-closeout.md v1.0（11 节：元数据 + 实施总结 + PHASE 0 + PHASE 1 + PHASE 2 + PHASE 3 + PHASE 4 + 累计指标 + 不变量 + 不外推 + 后续候选） |

### §7.3 验证矩阵（每个 commit 必跑）

| 验证项 | 命令 |
|--------|------|
| 4 治理门 | `npm run docs:check` + `npm run ui:audit:check` + `cd frontend && npx tsc --noEmit` + `npm run docs:reconcile` |
| chf0-critical | `node scripts/g0-chf0-acceptance.mjs`（IPC contract 兼容性） |
| vitest 受影响范围 | `npm run test:changed:list` + `npm run test:changed` |
| node --test 定向 | `node --test test/block-10-phase2-policy.test.mjs test/preload-branch-result-namespaces.test.mjs test/result-handlers-valid-types.test.mjs test/migration-007-conversation-export.test.mjs`（21 tests 已落地） |

### §7.4 启动前关键检查

- ✅ `git log --oneline --grep="block-10-audit-closeout"` 列出 5 commits 全部存在
- ✅ `git log -1 --format='%an %ae'` HEAD commit author = Diandian（用户裁决驱动）
- ✅ `git status` 工作树 clean
- ⏳ `npm run docs:check` / `ui:audit:check` 当前状态未跑（PHASE 0 调研不跑）
- ⏳ PHASE 3 PL-001 实现细节需用户在 PHASE 3 启动前显式裁决「是否渐进（required+type only）vs 严格化（+minimum/maximum/enum）」

---

**不变量**：本 fix-order 报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check。下游 v0.2 active 计划基于本报告。
