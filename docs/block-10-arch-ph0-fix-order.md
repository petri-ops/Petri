# BLOCK-10-ARCHITECTURE PHASE 0 — Fix Order & DAG

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研，0 代码改动 / 0 commit / 0 跑 docs:check）
> **基线**：`docs/block-10-arch-ph0-survey.md` + `docs/block-10-architecture-plan.md` v0.1
> **下游**：PHASE 1+2+3+4 active 工作包

---

## §1 依赖 DAG（19 项修复单元之间的前置依赖）

### §1.1 完整 DAG（19 项 + 1 部分）

```
                    ┌──────────────┐
                    │ PHASE 1.1    │
                    │ A-007 DB     │
                    │ singleton    │
                    │ 抽统一       │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ PHASE 1.1    │
                    │ PR-012 branch│
                    │ + result-db  │
                    │ 同根合并     │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ PHASE 1.1    │
                    │ E-019 full   │
                    │ busy_timeout │
                    │ 扩到 3 处    │
                    └──────┬───────┘
                           │ ← commit PHASE-1.1
                           ▼
                    ┌──────────────┐
                    │ PHASE 1.2    │
                    │ A-009 端口   │
                    │ fallback统一 │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ PHASE 1.2    │
                    │ A-010 jspdf  │
                    │ -1 dep + 6env│
                    └──────┬───────┘
                           │ ← commit PHASE-1.2
                           ▼
                    ┌──────────────┐
                    │ PHASE 2.1    │
                    │ A-002 routes/│
                    │ result-studio│
                    │ 拆 9 子域    │
                    └──────┬───────┘
                           │ ← commit PHASE-2.1
                           ▼
                    ┌──────────────┐
                    │ PHASE 2.2    │
                    │ A-005 routes/│
                    │ harness+     │
                    │ ai-agent 拆  │
                    └──────┬───────┘
                           │ ← commit PHASE-2.2
                           ▼
                    ┌──────────────┐
                    │ PHASE 3.1    │
                    │ A-001 agent- │
                    │ runner 拆分  │
                    │ LoopOrchestr │
                    └──────┬───────┘
                           │ ← commit PHASE-3.1
                           ▼
                    ┌──────────────┐
                    │ PHASE 3.2    │
                    │ A-003 跨层   │
                    │ configure    │
                    │ 注入         │
                    ├──────────────┤
                    │ A-008 act-   │
                    │ tools↔plan-ui│
                    │ 解环         │
                    └──────┬───────┘
                           │ ← commit PHASE-3.2
                           ▼
                    ┌──────────────┐
                    │ PHASE 3.3（可 │
                    │ A-006 部分   │
                    │ singleton 收敛│
                    │ ≥5 处迁SQLite│
                    └──────┬───────┘
                           │ ← commit PHASE-3.3 (optional)
                           ▼
                    ┌──────────────┐
                    │ PHASE 4      │
                    │ audit +      │
                    │ closeout     │
                    │ 4 canonical +│
                    │ DOC-REGISTRY │
                    │ + closeout   │
                    │ 报告         │
                    └──────┬───────┘
                           │ ← commits PHASE-4.1+4.2+4.3
                           ▼
                       COMPLETED
```

### §1.2 完整 DAG 表

| 阶段 | 节点 | 前置 | 落地状态 |
|------|------|------|----------|
| PHASE 1.1 | A-007 | — | ⏳ 待启动 |
| PHASE 1.1 | PR-012 | A-007 | ⏳ 待启动 |
| PHASE 1.1 | E-019 full | A-007 + PR-012 | ⏳ 待启动 |
| PHASE 1.2 | A-009 | A-007（同 commit 内无依赖，但 PHASE 1.1 先收口） | ⏳ 待启动 |
| PHASE 1.2 | A-010（仅 jspdf + 6 env） | A-009 | ⏳ 待启动 |
| PHASE 2.1 | A-002 routes/result-studio | PHASE 1 全部收口 | ⏳ 待启动 |
| PHASE 2.2 | A-005 routes/harness + ai-agent | PHASE 2.1 收口（routes/index.js 注册顺序） | ⏳ 待启动 |
| PHASE 3.1 | A-001 agent-runner 拆分 | PHASE 2 全部收口 | ⏳ 待启动 |
| PHASE 3.2 | A-003 跨层反向 | A-001（loop-orchestrator.js 不引用 harness-workflow-state） | ⏳ 待启动 |
| PHASE 3.2 | A-008 act-tools ↔ plan-ui-tools | A-001（act-tools.js 改为 facade） | ⏳ 待启动 |
| PHASE 3.3（可选） | A-006 部分 singleton | A-001 + A-003 + A-008（PHASE 3.1 + 3.2 收口） | ⏳ 待启动 |
| PHASE 4 | DOC-REGISTRY update | PHASE 3 全部收口 | ⏳ 待启动 |
| PHASE 4 | roadmap/handoff 同步 | PHASE 3 全部收口 | ⏳ 待启动 |
| PHASE 4 | ui-productization-audit 同步 | PHASE 3 全部收口 | ⏳ 待启动 |
| PHASE 4 | closeout 报告 | PHASE 3 全部收口 | ⏳ 待启动 |

---

## §2 commit 拆分建议（每个 commit 包含哪些修复）

### §2.1 推荐 commit 拆分（7 commit 主收口 + 2-3 commit closeout）

| commit # | commit msg（建议） | 涉及 ID | 改动文件数 | 预估 net +/- |
|----------|-------------------|---------|------------|-------------|
| **PHASE-1.1** | `refactor(block-10-architecture): DB singleton + busy_timeout 统一` | A-007 + PR-012 + E-019 full | 5 改 + 1 新 helper + 1 新 test | _db-singleton.js +80, branch-db +9/-19, result-db +9/-23, agent-task-store +30/-10, db.js +10/-5, db-reset.mjs 新 +20, db-singleton.test.mjs 新 +150 |
| **PHASE-1.2** | `chore(block-10-architecture): 端口 fallback 统一 + 移除 jspdf dead dep` | A-009 + A-010（仅 jspdf + 6 env） | 5 改 + 1 dep 移除 + 2 新 test | env-coordinator.js ±10, 4 处 fallback -10, frontend/package.json -1 dep, 6 处 env read +15/-15, env-coordinator-port.test.mjs 新 +80, config-helper-centralized.test.mjs 新 +80 |
| **PHASE-2.1a**（可选） | `refactor(block-10-architecture): routes/result-studio 拆分 prep` | A-002 拆分前准备 | 1 改 | routes/result-studio.js +50/-1800（仅留 facade） |
| **PHASE-2.1b** | `refactor(block-10-architecture): routes/result-studio 子域落地` | A-002 9 子域文件 | 9 新 + 1 改 + 1 新 test | 9 子文件 +1400, routes/result-studio/index.js 新 +50, routes-result-studio-split.test.mjs 新 +200 |
| **PHASE-2.2** | `refactor(block-10-architecture): routes/harness + ai-agent 拆分` | A-005 | 7 新 + 2 改 + 2 新 test | harness 3 子文件 +1000, ai-agent 4 子文件 +900, 2 index.js 注册中心 +100, 2 split test +300 |
| **PHASE-3.1** | `refactor(block-10-architecture): agent-runner 拆分 LoopOrchestrator + ConversationAdapter` | A-001 | 1 改 + 2 新 + 2 新 test | agent-runner.js -1200, loop-orchestrator.js +500, conversation-adapter.js +300, 2 test +400 |
| **PHASE-3.2** | `refactor(block-10-architecture): 跨层反向 + act-tools 循环解环` | A-003 + A-008 | 5 改 + 2 新 + 2 新 test | agent-workflow.js ±20, index.js +10, bootstrap.js ±10, act-tool-core.js +200, act-tool-ui.js +150, act-tools.js facade ±20, 2 test +250 |
| **PHASE-3.3**（可选） | `refactor(block-10-architecture): singleton 部分收敛（≥5 处迁 SQLite）` | A-006 部分 | 3 改 + 2 新 SQL + 1 新 test | agent-task-store.js ±50, 2 新 SQL +30, 5 处 _xxx 删除 +0/-50, singleton-migration.test.mjs 新 +150 |
| **PHASE-4.1** | `docs(block-10-architecture): 4 canonical + DOC-REGISTRY 同步` | PHASE 4 doc 同步 | 4 canonical docs | README.md / next-steps-roadmap.md / project-workspace-handoff.md / DOC-REGISTRY.json |
| **PHASE-4.2** | `docs(block-10-architecture): ui-productization-audit ledger entry` | PHASE 4 audit ledger | 1 audit doc | ui-productization-audit.md |
| **PHASE-4.3** | `docs(block-10-architecture): closeout report v1.0` | PHASE 4 closeout | 1 new doc | block-10-architecture-closeout.md 新 +300 |

**推荐 PHASE 1.1 + 1.2 各 1 commit / PHASE 2.1 拆 2 commit（prep + 子域落地）/ PHASE 2.2 + 3.1 + 3.2 各 1 commit / PHASE 3.3 可选 1 commit / PHASE 4 三 commit** = **7 commit 主收口 + 2-3 commit closeout** = **9-10 commit**。

---

## §3 PHASE 划分（按依赖关系推导 N PHASE 各包含哪些修复）

### §3.1 PHASE 1 — DB 体系化 + 配置快赢（A-007 + PR-012 + E-019 full + A-009 + A-010）— 2 commit

**目标**：抽 `_db-singleton.js` 统一 3 处 DB singleton；`busy_timeout = 10000ms` 全量统一；端口 fallback 统一到 `env-coordinator.js`；移除 jspdf dead dep；6 处 `process.env.*` 集中。

**ID**：A-007 + PR-012 + E-019 full + A-009 + A-010（5 项；E-019 full 是 BLOCK-10 partial 扩展；A-010 仅 jspdf + 6 env）

**commit**：2（PHASE-1.1 + PHASE-1.2）

**状态**：⏳ **待启动**

### §3.2 PHASE 2 — r-server 大文件拆分（A-002 + A-005）— 2-3 commit

**目标**：拆 `routes/result-studio.js` 1800 行 26+ 端点到 9 个 sub-domain 文件；拆 `routes/harness.js` 1366 + `routes/ai-agent.js` 1222 到各自子域文件；http 契约 100% 不变。

**ID**：A-002 + A-005（2 项；http 契约 100% 不变硬约束）

**commit**：2-3（PHASE-2.1a + 2.1b + 2.2）

**状态**：⏳ **待启动**

### §3.3 PHASE 3 — agent-runner + 跨层反向 + 循环解环（A-001 + A-003 + A-008 + A-006 部分）— 1-2 commit

**目标**：抽 `LoopOrchestrator` + `ConversationAdapter` 让 `agent-runner.js` 1799 → < 600；`shared-backend/agent-workflow.js` configure 注入修复跨层反向依赖；`act-tools ↔ plan-ui-tools` 解环；≥5 处 module-level singleton 迁 SQLite。

**ID**：A-001 + A-003 + A-008 + A-006 部分（4 项；A-006 部分仅 ≥5 处）

**commit**：1-2（PHASE-3.1 + PHASE-3.2 + PHASE-3.3 可选）

**状态**：⏳ **待启动**

### §3.4 PHASE 4 — audit + closeout — 2-3 commit

**目标**：4 canonical 文档同步 + DOC-REGISTRY 登记 + ui-productization-audit 增 entries + closeout 报告。

**ID**：PHASE 4（无新 finding；纯 audit + closeout）

**commit**：3（PHASE-4.1 + PHASE-4.2 + PHASE-4.3）

**状态**：⏳ **待启动**

---

## §4 关键路径（critical path）识别

### §4.1 总关键路径

```
A-007 → PR-012 → E-019 full → A-009 → A-010 → A-002 → A-005 → A-001 → A-003 → A-008 → PHASE 4 audit → PHASE 4 closeout
```

### §4.2 关键路径时长估算

| 节点 | 工作量 | 累计 |
|------|--------|------|
| A-007 + PR-012 + E-019 full | 1 commit（PHASE 1.1） | 1.0 |
| A-009 + A-010 | 1 commit（PHASE 1.2） | 2.0 |
| A-002 routes/result-studio 拆分 | 1-2 commit（PHASE 2.1） | 3.5 |
| A-005 routes/harness + ai-agent 拆分 | 1 commit（PHASE 2.2） | 4.5 |
| A-001 agent-runner 拆分 | 1 commit（PHASE 3.1） | 5.5 |
| A-003 + A-008 | 1 commit（PHASE 3.2） | 6.5 |
| A-006 部分（可选） | 1 commit（PHASE 3.3） | 7.5 |
| PHASE 4 audit + closeout | 3 commit（PHASE 4） | 10.5 |

**累计**：7-8 commit 主收口 + 3 commit closeout = **10-11 commit** 完整工作量。

### §4.3 关键路径风险点

| 节点 | 风险 |
|------|------|
| A-007 + PR-012 + E-019 full | 🟠 中：DB 进程边界不破坏；既有 chf0-critical IPC contract 不退化 |
| A-002 routes/result-studio 拆分 | 🔴 高：26+ 端点 http 契约 100% 不变；端点 channel 名 / payload shape 100% 一致 |
| A-005 routes/harness + ai-agent 拆分 | 🔴 高：同 A-002；ai-agent.js 集成 SSE + Loop + Tool Call + Conversation 更复杂 |
| A-001 agent-runner 拆分 | 🔴 高：agent loop 状态机 0 变化；4 大类 require 跨域耦合 |
| A-003 跨层反向 | 🟠 中：破坏既有调用链；agent-workflow.js 顶部 try/catch 是已存在的"安全网" |
| A-008 循环解环 | 🟠 中：partial-export 雷区；plan-ui-tools.js 顶层 require act-tools |
| PHASE 4 closeout | 🟢 低：docs only |

---

## §5 可并行 ID（如果存在）

### §5.1 严格并行 ID（无相互依赖）

| ID | 备注 |
|----|------|
| **PHASE 2.1 A-002** ∥ **PHASE 2.2 A-005** | 不同文件（routes/result-studio.js vs routes/harness.js + routes/ai-agent.js），可独立 commit |
| **PHASE 3.2 A-003** ∥ **PHASE 3.2 A-008** | 不同文件（shared-backend/agent-workflow.js vs agent-tools/act-tools.js + plan-ui-tools.js），但合并 commit 便于审阅 |
| **PHASE 3.3 A-006 部分** | 与 PHASE 3.2 同 commit 也可（不同文件） |

### §5.2 实际未并行（commit 内串行）

实际执行时，**所有上述可并行 ID 都在同一 commit 内串行落地**（参考 BLOCK-10-AUDIT-CLOSEOUT PHASE 2 commit 拆法 + BLOCK-9.2 PHASE 3 plugin-manager 拆法）。

**为什么不并行 commit**：
- 单 commit 粒度更便于审阅（每个 commit 平均 2-4 finding ID）
- 主 agent + worker 委派工作模式并行度有限（worker 数量受 luna_worker 注册量限制）
- 治理门（4 治理门 + chf0-critical + vitest）每次 commit 后必跑；并行 commit 容易触发 fail-closed 重叠
- 参考 BLOCK-10-AUDIT-CLOSEOUT PHASE 2 commit 拆法（`a09f706` PR-001 + E-017 + E-019 partial 合并 1 commit）

### §5.3 未来可探索的真并行（PHASE 2 之后）

- **PHASE 2.1** 与 **PHASE 2.2** 可并行（commit 独立），但落地按顺序便于审阅
- **PHASE 3.1** 与 **PHASE 3.2** 逻辑依赖（PHASE 3.2 修复后 agent-workflow.js 不再反向 require harness-workflow-state），但文件独立可并行

### §5.4 PHASE 2 worker 委派建议（参考 BLOCK-9.2 PHASE 0 worker v2 模式）

PHASE 2 r-server 大文件拆分（A-002 26+ 端点 + A-005 7 子域）是工作量最大、边界判定需 review 的 PHASE。建议 PHASE 2 启动前：

1. **委派 worker 架构调研**：输出 `docs/block-10-arch-ph2-routes-mapping.md`（端点 → domain 映射表 + 拆分边界判定 + http 契约边界清单）
2. **主 agent 修订 plan**：基于 worker 调研更新 plan v0.1 → v0.2 启动 PHASE 2
3. **执行**：主 agent 直做（参考 BLOCK-9.2 PHASE 3 plugin-manager 1457 → 586 -871 commit `49652f3` 范式）

---

## §6 偏离声明（与 BLOCK-10 §10.3 候选工作包的偏差）

### §6.1 范围偏差

| 偏差项 | BLOCK-10 §10.3 假设 | 实际调研结论 | 偏差处理 |
|--------|---------------------|-------------|----------|
| **r-server 大文件拆分风险** | 候选工作包假设 26+ 端点可平滑拆分 | 实际 http 契约 100% 不变是硬约束；既有 chf0-http + result-studio 测试是契约边界证据 | PHASE 2 拆分过程中遇 partial-export 现象优先用提取独立模块策略（参考 BLOCK-3 `_mapSkillRuntimeStatus.js`） |
| **A-007 DB singleton 重复** | 候选工作包假设可统一到 `core/r-server/db.js` | 实际 desktop 进程与 r-server 进程是不同进程，从架构上需分开；代码层共享 `getDatabase` 函数 | PHASE 1.1 抽 `src/database/_db-singleton.js` 仅代码层共享，进程边界由 ELECTRON main 进程事实承担 |
| **A-001 agent-runner 拆分** | 候选工作包假设抽 LoopOrchestrator + ConversationAdapter 即可 | 实际 agent-runner 还有 20 顶层 require 覆盖 system-prompt / llm-client / plans / conversations / memory-vectors / runtime 等；拆完后 `loop-controller` 应独立 require 0 个 agent-runner 内部函数 | PHASE 3.1 拆完后额外验证 `loop-controller.js` 仍可独立运行 |
| **A-006 56+ singleton 整体收敛** | 候选工作包假设全部收敛 | 实际 56+ 处里 ~12 处可迁 SQLite；其余 ephemeral 内存 cache 现状 OK | PHASE 3.3 仅 ≥5 处迁 SQLite，剩余保留 |
| **A-010 隐式 env 集中** | 候选工作包假设 214 处全部集中 | 实际进程启动时一次性读 env + helper 内读 env，集中在 `shared-backend/config-helper.js` 后行为不变 | PHASE 1.2 仅 6 处 `process.env.*` 集中（核心 DB 路径 / R_SERVER_URL / PY_SERVER_URL / GATEWAY_URL / BIOF3_CONTENT_ROOT / BIOF3_CONTENT_PLUGINS_DIR），其余保留 |

### §6.2 commit 粒度偏差

- BLOCK-10 §10.3 假设 4-7 commit；本调研建议 7 commit 主收口 + 2-3 commit closeout = **9-10 commit**
- 与 BLOCK-10 §10.3 假设一致

### §6.3 测试覆盖偏差

- BLOCK-10 §10.3 假设 ~10 tests / 5 files；本调研建议 ~30-50 tests / 6-9 files
- 偏差原因：PHASE 2 r-server 大文件拆分需要新增端点 → domain 映射的契约测试；PHASE 3 agent-runner 拆分需要新增 LoopOrchestrator + ConversationAdapter 独立单元测试

---

## §7 推荐 PHASE 1 启动顺序（仅供 PHASE 1 用）

### §7.1 2 个 commit 启动顺序

```
1. PHASE-1.1（refactor）：DB singleton + busy_timeout 统一
2. PHASE-1.2（chore）：端口 fallback 统一 + 移除 jspdf dead dep
```

### §7.2 每个 commit 包含的 ID

| commit | ID / 内容 |
|--------|-----------|
| **PHASE-1.1** | A-007 + PR-012 + E-019 full 3 项同根；抽 `src/database/_db-singleton.js` 80 行新 + branch-db 19→9 + result-db 23→9 + agent-task-store ±30 + db.js ±10 + db-reset.mjs 新 +20 + db-singleton.test.mjs 新 +150（5+ tests）|
| **PHASE-1.2** | A-009 + A-010（仅 jspdf + 6 env）2 项；env-coordinator.js ±10 + 4 处 fallback -10 + frontend/package.json -jspdf + 6 处 env read ±15 + env-coordinator-port.test.mjs 新 +80（3+ tests） + config-helper-centralized.test.mjs 新 +80（3+ tests）|

### §7.3 验证矩阵（每个 commit 必跑）

| 验证项 | 命令 |
|--------|------|
| 4 治理门 | `npm run docs:check` + `npm run ui:audit:check` + `cd frontend && npx tsc --noEmit` + `npm run docs:reconcile` |
| chf0-critical | `node scripts/g0-chf0-acceptance.mjs`（IPC contract 兼容性，33 项） |
| vitest 受影响范围 | `npm run test:changed:list` + `npm run test:changed` |
| node --test 定向 | `node --test test/db-singleton.test.mjs test/env-coordinator-port.test.mjs test/config-helper-centralized.test.mjs` |
| 不变量守住 | `git diff --name-only` 确认 preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/* / agent-transcripts/* 0 diff |

### §7.4 启动前关键检查

- ✅ `git log --oneline --grep="block-10-audit-closeout"` 列出 11 commits 全部存在且未 revert
- ✅ `git log -1 --format='%an %ae'` HEAD commit author = Diandian（用户裁决驱动）
- ✅ `git status` 工作树 clean
- ⏳ `npm run docs:check` / `ui:audit:check` 当前状态未跑（PHASE 0 调研不跑）
- ⏳ PHASE 1.2 启动前用户需显式裁决「jspdf 移除范围」（仅 `frontend/package.json` -1 dep vs 全仓 npm scripts grep + remove）

### §7.5 PHASE 2+ 启动建议

- **PHASE 2 启动前**：建议委派 worker 做架构调研（参考 BLOCK-9.2 PHASE 0 worker v2 模式），输出 `routes-endpoint-domain-mapping.md`；主 agent 修订 plan v0.1 → v0.2 启动 PHASE 2
- **PHASE 3 启动前**：建议主 agent 直做（PHASE 3 范围可控、文件集中、不依赖 worker 委派）
- **PHASE 4 启动前**：主 agent 直做（docs only）

---

**不变量**：本 fix-order 报告 0 行代码改动 / 0 行 git 操作 / 0 跑 docs:check 或 ui:audit:check。下游 v0.1 active 计划基于本报告。
