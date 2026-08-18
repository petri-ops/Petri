# BLOCK-10-ARCHITECTURE 工作包计划

**版本**：v0.2（PHASE 2 调研落地 / active 工作包）
**升级时间**：2026-08-18
**v0.1 → v0.2 变更**：
- 新增 `docs/block-10-arch-ph2-routes-mapping.md`（1215 行 / 85 KB）调研报告
- §PHASE 2 拆分由 v0.1 假设 2-3 commit 细化为 **5 commit**（PHASE-2.1a + 2.1b + 2.2a + 2.2b + 2.2c），基于调研报告 §8
- 端点总数从 v0.1 假设"26+"（仅 A-002）修正为 **49 端点**（result-studio 27 + harness 19 + ai-agent 3）
- 子模块从 v0.1 假设 9 个 result-studio 子域 + 3 + 4 子域修正为 **22 子文件 + 6 `_helpers/`**（基于调研报告 §4）
- §8 风险矩阵新增 3 项红旗（LEGACY SSE 786 行单端点 / 共享闭包变量跨子文件传递 / 主文件 facade `_test` 字段延后赋值避免循环）
- §PHASE 2 验证门随 5 commit 调整新增 3 个测试（routes-result-studio-split / routes-harness-split / routes-ai-agent-split）

**PHASE 0 调研 4 份 + PHASE 2 调研 1 份**：
- [`docs/block-10-arch-ph0-survey.md`](./block-10-arch-ph0-survey.md) — 19 项修复单元详细清单 + 同根组合 + 跨包边界 + 阶段归属 + 工作量估算
- [`docs/block-10-arch-ph0-fix-order.md`](./block-10-arch-ph0-fix-order.md) — 依赖 DAG + commit 拆分 + PHASE 划分 + 关键路径 + 可并行 ID
- [`docs/block-10-arch-ph0-test-matrix.md`](./block-10-arch-ph0-test-matrix.md) — 19 项测试需求 + 新增/复用/不需要分类 + 验证门限
- [`docs/block-10-arch-ph0-risks.md`](./block-10-arch-ph0-risks.md) — 19 项风险矩阵 + 跨包冲突 + 性能/兼容性/r-server 大文件拆分特别风险 + G1+ 不外推
- [`docs/block-10-arch-ph2-routes-mapping.md`](./block-10-arch-ph2-routes-mapping.md) — PHASE 2 调研：**49 端点完整清单**（27+19+3）+ **22 子模块 + 6 `_helpers/`** 拆分范式 + **5 commit 拆分建议**（2.1a facade / 2.1b 9 子域 15 端点 / 2.2a / 2.2b / 2.2c）+ 0 循环依赖 + 3 红旗（LEGACY SSE 单端点 / 共享闭包变量 / 主文件 facade `_test` 延后赋值）

**基线 audit 报告**（已收口，只读引用）：
- [`docs/agent-harness-architecture-audit-2026-08-17.md`](./agent-harness-architecture-audit-2026-08-17.md)（805 行 / 12 项 A-001..A-012）
- [`docs/agent-harness-performance-resource-audit-2026-08-17.md`](./agent-harness-performance-resource-audit-2026-08-17.md)（PR-006 + PR-012 来源）
- [`docs/agent-harness-error-handling-audit-2026-08-17.md`](./agent-harness-error-handling-audit-2026-08-17.md)（E-017 main + E-018 + E-019 full 来源）
- [`docs/agent-harness-rserver-http-contract-audit-2026-08-17.md`](./agent-harness-rserver-http-contract-audit-2026-08-17.md)（C-001-rserver + C-002-rserver 来源）
- [`docs/agent-harness-security-audit-2026-08-17.md`](./agent-harness-security-audit-2026-08-17.md)（M-001 + M-003 来源）

**基线 closeout**：[`docs/block-10-audit-closeout.md`](./block-10-audit-closeout.md) §10.3 BLOCK-10-ARCHITECTURE 候选清单 + [`docs/code-audit-closeout-plan.md`](./code-audit-closeout-plan.md) v0.2 active

**关联已收口工作包**（不重新激活，仅作为纪律参考）：
- BLOCK-9 / BLOCK-9.1 / BLOCK-9.2（前端 _data.ts / main.js / 5 个 mega file 拆分）
- BLOCK-9.1 PHASE 3（main.js 1200 行剩余 5 个不拆函数边界）
- BLOCK-9.2 PHASE 3（plugin-manager.js 1457 → 562 已拆 8 lib）
- BLOCK-3/4/5（IPC bridge sender 守门 + poller 9→4 + channel 字面量统一）
- BLOCK-10-AUDIT-CLOSEOUT（PHASE 2 commit `a09f706` 已 partial 落地 E-017 r-server 进程级 + E-019 r-server 单进程 config-helper）

---

## §0 元数据

| 字段 | 值 |
|------|-----|
| 工作包 ID | **BLOCK-10-ARCHITECTURE** |
| 真值域 truthDomain | agent-harness-architecture-refactor |
| 起草日期 | 2026-08-18 |
| 基线状态 | v0.1（PHASE 0 调研收口 + active 计划起草）；用户裁决"开搞"前不动 |
| 涉及 audit 报告 | 5 份（architecture + performance-resource + error-handling + rserver-http + security） |
| 修复单元总数 | **19 项**（10 A-* + 5 lifecycle/DB + 4 rserver-http） |
| 范围分类 | 12 项核心（10 A-* + E-019 + PR-012）+ 7 项关联（observability-work-package / rserver-http-debt-pack 候选，必须引用但不启动） |
| commits 预估 | 4-7 commit（PHASE 1+2+3 主收口；PHASE 4 closeout 2-3 commit） |
| 新依赖 | 0（沿用既有 better-sqlite3 / express / archiver 等） |
| 4 治理门 | docs:check / ui:audit:check / tsc --noEmit / docs:reconcile |

> **数量声明**：用户原 prompt 提到"13 项不外推"——该数字对应 `docs/block-10-audit-closeout.md` §5.2 G0 不外推表（13 项 deferred），与 §10.3 BLOCK-10-ARCHITECTURE 候选清单（**19 项**，10 A-* + 5 lifecycle/DB + 4 rserver-http）不一致。本计划严格按 §10.3 显式列出 19 项 ID 全部处理；其中 12 项严格属本工作包主范围（10 A-* + E-019 full + PR-012），另 7 项在 §5.2 已映射到 observability-work-package / rserver-http-debt-pack 候选，本工作包**引用但不启动**。

---

## §1 TL;DR

本工作包要收口的发现：BLOCK-10-AUDIT-CLOSEOUT §10.3 BLOCK-10-ARCHITECTURE 候选清单共 **19 项**（10 项 A-* 架构层面 + 5 项 backend lifecycle/DB 体系化 + 4 项 rserver-http debt），分 **3-4 PHASE** 落地：

| PHASE | 范围 | 状态 | 预估 commit |
|-------|------|------|-------------|
| **PHASE 0** | 架构调研 4 份 + plan v0.1 起草 | ✅ **本任务收口**（0 代码改动） | 0（只新建 5 文件） |
| **PHASE 1** | DB 体系化（P1 快赢）：A-007 DB singleton 抽 `_db-singleton.js` + A-009 端口统一 + A-010 移除 jspdf dead dep | ⏳ 待启动 | 1-2 |
| **PHASE 2** | r-server 大文件拆分（**49 端点**：A-002 routes/result-studio.js 1800 行 / 27 端点 + A-005 routes/harness.js 1366 行 / 19 端点 + A-005b routes/ai-agent.js 1222 行 / 3 端点含 legacy SSE 786 行）→ **22 子文件 + 6 `_helpers/` + 5 commit** | ⏳ 待启动 | **5** |
| **PHASE 3** | agent-runner.js 拆分（A-001 1799 行 → LoopOrchestrator + ConversationAdapter）+ 跨层反向依赖修复（A-003）+ 56+ singleton 收敛（A-006 部分） | ⏳ 待启动 | 1-2 |
| **PHASE 4** | audit + closeout（4 canonical 文档同步 + DOC-REGISTRY active → completed + ui-productization-audit ledger + closeout 报告 v1.0） | ⏳ 待启动 | 2-3 |

**边界守卫**：
- 不重做 BLOCK-3/4/5/9/9.1/9.2 已收口工作
- 不动 `src/preload.js` / `frontend/src/lib/electron.d.ts` / `frontend/src/lib/desktopBridge.ts` / 4 page / `core/shared-backend/*` 公共接口
- 不重启 BLOCK-10-AUDIT-CLOSEOUT 已落地的 PHASE 1+2（仅在 PHASE 2 范围内"自然继承"A-007 + A-009 + A-010 这 3 项 P1 快赢的"补全"，不重写已落地 PR-001 retention / E-017 r-server partial）
- 不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+

**完成语义**：
- ✅ 3-4 PHASE 全部收口 + 4 治理门 GREEN
- ✅ chf0-critical 33/33 PASS（plugin IPC contract 不退化）
- ✅ vitest 75 文件 630 tests 0 退化（仅触新文件）
- ✅ 不变量守住（preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/* / agent-transcripts/* 0 diff）
- ✅ 19 项 ID 全部处理（12 项主范围落地 + 7 项关联登记到下一候选工作包）
- ✅ DOC-REGISTRY active → completed + linkedCommits 完整 + closeout 报告 v1.0

---

## §2 唯一真理链（Code Truth Anchors）

### §2.1 19 项修复单元（按 BLOCK-10 §10.3 BLOCK-10-ARCHITECTURE 候选清单）

> **格式**：每项 1 行（ID / 报告 / 核心代码位置 / 优先级 / 风险 / 现状）。

| ID | 报告 / 行 | 标题 | 核心代码位置 | P 优先级 | 风险 | 当前状态 | 本工作包范围 |
|----|----------|------|---------------|----------|------|----------|------------|
| **A-001** | arch §四 L154-178 | `agent-runner.js` 1799 行 20 顶层 require 聚宝盆 | `core/r-server/agent-runner.js:1-100` | P2 | 🔴 高 | 不外推（BLOCK-10 §10.3 候选） | ✅ **PHASE 3**（主范围） |
| **A-002** | arch §四 L180-200 | `routes/result-studio.js` 1800 行 26+ 端点 | `core/r-server/routes/result-studio.js` | P1 | 🔴 高 | 不外推 | ✅ **PHASE 2**（主范围） |
| **A-003** | arch §四 L202-227 | `shared-backend/agent-workflow.js` 跨层反向 require（try/catch 软依赖） | `core/shared-backend/agent-workflow.js:4-10` | P0 | 🟠 中 | 不外推 | ✅ **PHASE 3**（主范围） |
| **A-004** | arch §四 L229-253 | 173 console.* vs 59 logger | `core/r-server/{tools-executor,mcp/registry,server}.js` | P2 | 🟠 中 | 不外推（observability-work-package 候选） | ⚠️ **引用不启动**（仅 §5.2 标记） |
| **A-005** | arch §四 L255-265 | `routes/harness.js` 1366 + `routes/ai-agent.js` 1222 | `core/r-server/routes/{harness,ai-agent}.js` | P1 | 🔴 高 | 不外推 | ✅ **PHASE 2**（主范围） |
| **A-006** | arch §四 L267-300 | 56+ module-level mutable singleton | 全 core + src 范围 | P2 | 🟠 中 | 不外推 | ⚠️ **PHASE 3 部分**（仅 ≥5 处可迁 SQLite；其余保留） |
| **A-007** | arch §四 L302-327 | DB singleton 重复：branch-db + result-db 30 行基础设施 100% 重复 | `src/database/branch-db.js:31-49` / `src/database/result-db.js:36-54` | P0 | 🟠 中 | 不外推 | ✅ **PHASE 1**（主范围） |
| **A-008** | arch §四 L329-336 | 4 处真 require 循环（act-tools↔plan-ui-tools / permissions↔guest-permissions） | `core/r-server/agent-tools/{act-tools,plan-ui-tools}.js` / `core/r-server/helpers/{permissions,guest-permissions}.js` | P2 | 🟠 中 | 不外推 | ✅ **PHASE 3**（主范围；仅拆 act-tools↔plan-ui-tools 循环，permissions 循环保留为 minor） |
| **A-009** | arch §四 L338-354 | `R_SERVER_PORT` 默认值不一致（3003 vs 3001） | `core/r-server/{server,config}.js` + `src/{preload,backend-health}.js` + `src/main/env-coordinator.js` | P0 | 🟢 低 | 不外推 | ✅ **PHASE 1**（主范围） |
| **A-010** | arch §四 L356-372 | Dead deps（jspdf）+ 214 处隐式 env | `frontend/package.json` + 全 `process.env.*` 读取 | P0 | 🟢 低 | 不外推 | ✅ **PHASE 1**（主范围；仅移除 jspdf + 集中 env；env 集中改造范围限于 §PHASE 1.4） |
| **A-011** | arch §四 L374-386 | type safety 与 schema drift | 全栈 IPC / Agent Tool | P3 | 🟢 低 | 不外推 | ⚠️ **引用不启动**（type-drift-pack 候选） |
| **A-012** | arch §四 L388-400 | test fixture / golden 维护风险（5 子目录无 manifest.json） | `test/fixtures/` | P3 | 🟢 低 | 不外推 | ⚠️ **引用不启动**（fixture-manifest-pack 候选） |
| **E-017 main** | error §三 L477-494 | Backend procs exit handler **主进程侧** 不推送 IPC status 事件 | `src/main/backend-proc-manager.js` | P1 | 🟠 中 | 不外推（observability-work-package 候选） | ⚠️ **引用不启动**（observability 候选） |
| **E-018** | error §三 L496-506 | rServerSupervisor 自动重启无 IPC 通知 | `src/main/backend-proc-manager.js` + `src/owned-backend-supervisor.js` | P1 | 🟠 中 | 不外推 | ⚠️ **引用不启动**（observability 候选） |
| **E-019 full** | error §三 L508-529 | r-server 内 SQLite 双 connection busy_timeout **全量** 不一致 | `core/r-server/agent-task-store.js:177-179` + `core/r-server/db.js:18-32` + `src/database/{branch,result}-db.js` | P1 | 🟠 中 | BLOCK-10 PHASE 2 partial 落地 r-server 单进程 config-helper | ✅ **PHASE 1**（主范围；扩到 agent-task-store + branch-db + result-db） |
| **PR-006** | perf §四 L269-291 | 4 个 backend 子进程 exit handler 仅 console.log | `src/main/backend-proc-manager.js` | P1 | 🟠 中 | 不外推 | ⚠️ **引用不启动**（observability 候选） |
| **PR-012** | perf §四 L488-521 | branch-db + result-db 同时打开 biof3.db（与 E-019 / A-007 同根） | `src/database/{branch,result}-db.js` | P1 | 🟢 低 | 不外推 | ✅ **PHASE 1**（与 A-007 同 commit） |
| **C-001-rserver** | rserver-http §五 L456-462 | `/api/run` 与 `/api/replot/run` 双重拦截 | `core/r-server/routes/r-compute.js:48,65` + `core/r-server/bootstrap.js:62` | P1 | 🟢 低 | 不外推 | ⚠️ **引用不启动**（rserver-http-debt-pack 候选） |
| **C-002-rserver** | rserver-http §五 L464-472 | /api/result-studio/interaction 在 Revision 不匹配返回 HTTP 200 + {error} | `core/r-server/routes/result-studio.js` | P1 | 🟢 低 | 不外推 | ⚠️ **引用不启动**（rserver-http-debt-pack 候选；与 A-002 同文件，PHASE 2 落地 A-002 时不联动修） |
| **M-001** | rserver-http §六 L474-480 | /api/ai/admin/* 9 端点鉴权后置 | `core/r-server/routes/ai-admin.js:25` | P1 | 🟠 中 | 不外推 | ⚠️ **引用不启动**（rserver-http-debt-pack 候选） |
| **M-003** | rserver-http §六 L490-496 | /api/feedback 公开端点缺 origin check | `core/r-server/routes/feedback.js:73` | P1 | 🟠 中 | 不外推 | ⚠️ **引用不启动**（rserver-http-debt-pack 候选） |

### §2.2 范围归类（19 → 12 主范围 + 7 关联）

> **关键决策**：本工作包**严格只启动**以下 12 项；其余 7 项按 BLOCK-10 §5.2 已明确的候选工作包映射，**仅在 PHASE 4 closeout 报告中登记为"下一候选"，不实际修改任何代码**。

#### 2.2.1 本工作包主范围（12 项）

| 类别 | ID | 落地 PHASE |
|------|----|-----------|
| **DB 体系化** | A-007 + PR-012 + E-019 full | **PHASE 1**（同根 3 项 1-2 commit） |
| **配置 / Dead dep 快赢** | A-009 + A-010（仅移除 jspdf + env 集中 P1 子集） | **PHASE 1**（同 commit 顺带） |
| **r-server 大文件拆分** | A-002（routes/result-studio.js 1800 行）+ A-005（routes/harness.js 1366 行 + routes/ai-agent.js 1222 行） | **PHASE 2**（2-3 commit） |
| **agent-runner 拆分 + 跨层反向** | A-001（1799 行 → LoopOrchestrator + ConversationAdapter）+ A-003（configure 注入）+ A-008（act-tools ↔ plan-ui-tools 解环） | **PHASE 3**（1-2 commit） |
| **singleton 收敛** | A-006 部分（5+ 处迁 SQLite，剩余保留） | **PHASE 3**（同 commit 顺带） |

#### 2.2.2 关联但不启动（7 项 — 仅登记）

| 类别 | ID | 候选工作包 | 本工作包处理 |
|------|----|-----------|-------------|
| **observability 体系化** | A-004 + E-017 main + E-018 + PR-006 | observability-work-package | ⚠️ PHASE 4 closeout 报告 §10.3 登记；不动代码 |
| **rserver-http debt** | C-001-rserver + C-002-rserver + M-001 + M-003 | rserver-http-debt-pack | ⚠️ PHASE 4 closeout 报告 §10.3 登记；不动代码 |

### §2.3 同根组合（修复时合并 commit）

| 同根组 | 涉及 ID | 合并 commit | 实际落地 |
|--------|---------|-------------|----------|
| **DB singleton 统一 + busy_timeout 全量** | A-007 + PR-012 + E-019 full | 1 commit（PHASE 1.1） | `src/database/_db-singleton.js`（80 行新）+ branch-db / result-db / agent-task-store 三处收编 |
| **端口 + Dead dep 快赢** | A-009 + A-010（仅 jspdf 移除 + 6 处 env read 集中） | 1 commit（PHASE 1.2） | `src/main/env-coordinator.js` 改 + `frontend/package.json` -1 dep + 6 处 `process.env.*` → `getConfig()` |
| **r-server routes 拆 — result-studio 子域** | A-002 | 1-2 commit（PHASE 2.1） | `core/r-server/routes/result-studio/{repository,interaction,selection,context,changesets,revisions,storage,workspace,preview-budget}.js` 9 个子域文件 |
| **r-server routes 拆 — harness + ai-agent 子域** | A-005 | 1 commit（PHASE 2.2） | `core/r-server/routes/harness/{workflow,context,repair}.js` + `routes/ai-agent/{chat,loop,context,tools}.js` |
| **agent-runner 拆分 + 跨层反向 + 循环解环** | A-001 + A-003 + A-008 | 1-2 commit（PHASE 3.1+3.2） | `core/r-server/{loop-orchestrator,conversation-adapter}.js`（新）+ `shared-backend/agent-workflow.js` configure 注入 + `agent-tools/{act-tool-core,act-tool-ui}.js` 拆 |
| **singleton 收敛（部分）** | A-006 部分（≥5 处迁 SQLite） | 1 commit（PHASE 3.3） | `_pendingActAcks` / `_embedCallLog` / `_aiUserStreams` 等迁 SQLite |

### §2.4 BLOCK-3/4/5/9/9.1/9.2 边界（禁止触碰）

| 已收口 | 已修内容 | 本工作包禁止动作 |
|-------|----------|------------------|
| BLOCK-3 | IPC sender 守门 helper + poller 9→4 + _publishSkillProgress try/catch | ✅ 不重写 sender helper；不重写 _mapSkillRuntimeStatus |
| BLOCK-4 | IPC 收尾（cancel action + 5 method 签名） | ✅ 不动 skills IPC / poller 逻辑 |
| BLOCK-5 | IPC channel 字面量统一 + E1-b execute 立即 publish pending | ✅ 不动 IPC channel 字面量 |
| BLOCK-9 | 前端 _data.ts 2157→3 文件 + buildPreviewTable 抽 lib/ + project-workspace 拆 helpers | ✅ 不动 _data.ts / project-workspace.tsx |
| BLOCK-9.1 | main.js 2450→1066（-56.5%）+ 18 setup* 全部抽出 | ✅ 不动 main.js 剩余 5 个不拆函数 + 已拆出 11 个 setup*；**例外**：A-009 端口统一必读 `env-coordinator.js` 但**不重写**仅对齐 fallback |
| BLOCK-9.2 | 5 mega file 拆分（DesktopSettingsPanel/ResultView/plugin-manager/SimpleChat/useSkillStore） | ✅ 不动 DesktopSettingsPanel/ + ResultView/* + plugin/* + SimpleChat/* + useSkillStore.ts |
| BLOCK-10-AUDIT-CLOSEOUT | PHASE 1+2 全部落地（11 项 ID） | ✅ 不重写 PHASE 1+2 已落地 commit；**例外**：A-007 / A-009 / A-010 / E-019 full 是 PHASE 1+2 已"partial 落地"的扩展，PHASE 1 范围内"自然补全"即可 |

---

## §3 修复边界分类

### §3.1 P0 DB 体系化 + 配置快赢（PHASE 1 — 2 commit）

| ID | 用户可见症状 | 当前阶段边界 | commit |
|----|--------------|--------------|--------|
| **A-007** | 测试时 branch-db close → result-db 还活着，状态机难以预测；branch/result IPC handler 多开 SQLite handle | dev Electron + packaged 边界内 verified | PHASE 1.1 |
| **PR-012** | branch-db + result-db 与 r-server 共享 biof3.db；WAL 锁竞争 | dev Electron + packaged 边界内 verified | PHASE 1.1（与 A-007 同 commit） |
| **E-019 full** | SQLite busy_timeout 不一致（r-server 10000ms / agent-task-store / branch-db / result-db 各自保留） | dev Electron + packaged 边界内 verified | PHASE 1.1（与 A-007 同 commit） |
| **A-009** | dev 模式手动启动 r-server 不带 env，端口 fallback 在 3003 / 3001 之间漂移 | dev Electron 边界内 verified | PHASE 1.2 |
| **A-010（仅 jspdf）** | frontend/package.json 装 jspdf 但 0 import；214 处 process.env.* 散落 | dev Electron + packaged 边界内 verified | PHASE 1.2（仅移除 jspdf + 6 处 process.env.* 集中） |

### §3.2 P1 r-server 大文件拆分（PHASE 2 — 5 commit，基于 `docs/block-10-arch-ph2-routes-mapping.md` 调研）

| ID | 用户可见症状 | 当前阶段边界 | commit |
|----|--------------|--------------|--------|
| **A-002** | routes/result-studio.js 1800 行 26+ 端点，新增 endpoint 习惯性 append 到末尾，违背"按 domain 分文件"原则 | dev Electron 边界内 verified（http 契约不变） | PHASE 2.1（1-2 commit） |
| **A-005** | routes/harness.js 1366 + routes/ai-agent.js 1222；14 个路由文件总行数 6583，3 个文件占 67% | dev Electron 边界内 verified（http 契约不变） | PHASE 2.2（1 commit） |

### §3.3 P2 agent-runner + 跨层反向 + singleton 收敛（PHASE 3 — 1-2 commit）

| ID | 用户可见症状 | 当前阶段边界 | commit |
|----|--------------|--------------|--------|
| **A-001** | 单元测试粒度受限于"必须 mock 整个 agent-runner"；任何一行改动跨域影响 | dev Electron 边界内 verified（agent loop 状态不变） | PHASE 3.1 |
| **A-003** | shared-backend 在 non-r-server 上下文静默 fail → 调用方拿到残缺 enriched 但无信号；与 G0 fail-closed 冲突 | dev Electron 边界内 verified（行为不变） | PHASE 3.2 |
| **A-008** | act-tools ↔ plan-ui-tools 真循环；plan-ui-tools.js 顶层 require act-tools；新增导出时易踩 partial-export 坑 | dev Electron 边界内 verified（解环后 0 行为变化） | PHASE 3.2 |
| **A-006 部分** | 56+ module-level singleton 至少 5 处应迁 SQLite（act-acks / embed log / ai user streams），让 restart 后恢复 | dev Electron 边界内 verified（行为不变） | PHASE 3.3 |

### §3.4 P3 内部债（不外推 / 仅登记）

| 类别 | ID | 推迟原因 | 后续候选 |
|------|----|----------|----------|
| 可观测性体系化 | A-004 + E-017 main + E-018 + PR-006 | observability 体系化超出当前 PHASE 范围 | observability-work-package |
| rserver-http debt | C-001-rserver + C-002-rserver + M-001 + M-003 | rserver-http 端点债务 | rserver-http-debt-pack |
| type drift | A-011 | 类型漂移全栈需渐进修正 | type-drift-pack |
| fixture manifest | A-012 | 5 子目录无 manifest.json | fixture-manifest-pack |

---

## §4 PHASE 划分（基于依赖 DAG）

### §4.1 PHASE 0 — 架构调研 + plan v0.1 → v0.2 起草（**当前**）

- **范围**：5 audit 报告全部读完 / 提取 19 项 BLOCK-10 §10.3 BLOCK-10-ARCHITECTURE 候选 ID / 锚定代码位置 / 识别 6 组同根关联 / 列出 3-4 PHASE 划分
- **PHASE 0 调研 4 份 + PHASE 2 调研 1 份 + 1 份 active plan 输出**：
  - `docs/block-10-arch-ph0-survey.md` — 19 项修复单元详细清单 + 同根组合 + 跨包边界 + 阶段归属 + 工作量估算 + 修复顺序
  - `docs/block-10-arch-ph0-fix-order.md` — 依赖 DAG + commit 拆分 + PHASE 划分 + 关键路径 + 可并行 ID
  - `docs/block-10-arch-ph0-test-matrix.md` — 19 项测试需求 + 新增/复用/不需要分类 + 验证门限
  - `docs/block-10-arch-ph0-risks.md` — 19 项风险矩阵 + 跨包冲突 + 性能 + r-server 大文件拆分特别风险 + G1+ 不外推
  - `docs/block-10-arch-ph2-routes-mapping.md` — **PHASE 2 调研**（v0.2 升级新增）：49 端点完整清单 + 22 子模块 + 6 `_helpers/` 拆分范式 + 5 commit 拆分建议 + 0 循环依赖 + 3 红旗
  - **`docs/block-10-architecture-plan.md`**（本文件）— active 工作包计划 **v0.2**（v0.1 → v0.2 升级：PHASE 2 5 commit 细化 + 3 项红旗新增）
- **commit 边界**：本任务范围仅新建 1 调研文件 + 修改 1 plan，**不修改任何现有源文件 / 测试 / canonical doc**，不 commit / push

### §4.2 PHASE 1 — DB 体系化 + 配置快赢（A-007 + PR-012 + E-019 full + A-009 + A-010）— 2 commit

**目标**：抽 `_db-singleton.js` 统一 3 处 DB singleton；`busy_timeout = 10000ms` 全量统一；端口 fallback 统一到 `env-coordinator.js`；移除 jspdf dead dep；6 处 `process.env.*` 集中到 `shared-backend/config-helper.js`。

**涉及文件**：

| commit | 范围 | 涉及文件 |
|--------|------|----------|
| **PHASE-1.1** | A-007 + PR-012 + E-019 full | `src/database/_db-singleton.js`（80 行新）+ `src/database/branch-db.js`（重写 19 → 9 行）+ `src/database/result-db.js`（重写 23 → 9 行）+ `core/r-server/agent-task-store.js`（改用 `_db-singleton`）+ `core/r-server/db.js`（迁移到 `_db-singleton`）+ `test/utils/db-reset.mjs`（新） |
| **PHASE-1.2** | A-009 + A-010（仅 jspdf + 6 处 env） | `src/main/env-coordinator.js`（删 4 处 fallback）+ `core/r-server/server.js` + `core/r-server/config.js` + `src/preload.js` + `src/backend-health.js`（删 fallback 仅用 env）+ `frontend/package.json`（-jspdf）+ 6 处 `process.env.*` → `getConfig()` |

**commit 边界**：2 commit（PHASE-1.1 / PHASE-1.2）

**验证矩阵**：
- `node --check` 全部 OK
- chf0-critical 33/33 PASS
- vitest 75/630 0 退化
- 4 治理门 GREEN
- 不变量守住（preload.js 18 namespace / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* 0 diff）

### §4.3 PHASE 2 — r-server 大文件拆分（A-002 + A-005）— 5 commit（基于调研报告细化）

**目标**：拆 `routes/result-studio.js` 1800 行 27 端点到 9 个 sub-domain 文件；拆 `routes/harness.js` 1366 行 19 端点到 8 个 sub-domain 文件；拆 `routes/ai-agent.js` 1222 行 3 端点（其中 legacy SSE 单端点 786 行）到 5 个 sub-domain 文件。**49 端点（27 + 19 + 3）全部拆分 / 22 子文件 + 6 `_helpers/` 共享 helper**。http 契约 100% 不变。

**调研依据**：[`docs/block-10-arch-ph2-routes-mapping.md`](./block-10-arch-ph2-routes-mapping.md) §3（49 端点清单）+ §4（22 子模块 + 6 `_helpers/`）+ §8（5 commit 拆分）+ §9（拆分范式 facade + `_helpers/` + register 签名）。

**涉及文件**：

| commit | 范围 | 涉及文件 | 端点数 | 预估 net +/- |
|--------|------|----------|--------|-------------|
| **PHASE-2.1a** | A-002 prep — facade + `_helpers/` prep | `routes/result-studio.js` 1800 → ~50（仅 facade）+ `_helpers/auth.js`（新 ~80）+ `_helpers/project-context.js`（新 ~60）+ `_helpers/result-studio-shared.js`（新 ~260） | 0（pure refactor / 不涉及端点拆分） | result-studio.js +50/-1800；_helpers/* 共 +400 |
| **PHASE-2.1b** | A-002 落地 — 9 个子域文件 | `routes/result-studio/repository.js`（2 端点）+ `interaction.js`（2 端点）+ `selection.js`（6 端点）+ `context.js`（1 端点）+ `changesets.js`（4 端点）+ `revisions.js`（5 端点）+ `storage.js`（4 端点）+ `workspace.js`（2 端点）+ `preview-budget.js`（1 端点）+ `routes/result-studio/index.js`（注册中心）+ `test/routes-result-studio-split.test.mjs`（新 ~200） | 27 | 9 子文件合计 +1100；index.js +60；test 新 +200 |
| **PHASE-2.2a** | A-005 harness prep — facade + `_helpers/` prep | `routes/harness.js` 1366 → ~50（仅 facade）+ `_helpers/harness-shared.js`（新 ~200）+ `_helpers/workspace-file-index.js`（新 ~100） | 0（pure refactor） | harness.js +50/-1366；_helpers/* 共 +300 |
| **PHASE-2.2b** | A-005 harness 落地 — 8 个子域文件 | `routes/harness/scientific-task.js`（8 端点）+ `workflow.js`（2 端点）+ `recovery.js`（1 端点）+ `file-references.js`（2 端点）+ `tools.js`（2 端点）+ `feedback.js`（1 端点）+ `health.js`（1 端点）+ `events.js`（2 端点）+ `routes/harness/index.js`（注册中心）+ `test/routes-harness-split.test.mjs`（新 ~200） | 19 | 8 子文件合计 +1230；index.js +50；test 新 +200 |
| **PHASE-2.2c** | A-005 ai-agent 落地 — 5 个子域文件 | `routes/ai-agent/chat.js`（1 端点含 legacy SSE 786 行）+ `context.js`（1 端点）+ `events.js`（1 端点）+ `tools.js`（1 端点）+ `routes/ai-agent/index.js`（注册中心）+ `test/routes-ai-agent-split.test.mjs`（新 ~150） | 3 | ai-agent.js +20/-1222；5 子文件合计 +1440；test 新 +150 |

**commit 边界**：**5 commit**（PHASE-2.1a / PHASE-2.1b / PHASE-2.2a / PHASE-2.2b / PHASE-2.2c）。如 PHASE-2.1b 端点拆分遇 partial-export 雷区（与 A-008 act-tools 循环同源），降级为 6 commit 拆法（调研 §8.3）：2.1b-i repository + interaction（4 端点 P0）/ 2.1b-ii selection + context（7）/ 2.1b-iii changesets + revisions（9）/ 2.1b-iv storage + workspace + preview-budget（7）/ 2.2b harness 19 / 2.2c ai-agent 3。

**共享 helper 落地**：`routes/_helpers/` 下 6 个文件 — `auth.js`（canAccessProject / canAccessJob，跨 3 大文件复用，唯一真正"跨文件共享 helper"）/ `project-context.js`（projectContext）/ `result-studio-shared.js`（attachExistingRepositoryWithExplicitConsent 等）/ `harness-shared.js`（workspaceFileNameIndex 构建等）/ `workspace-file-index.js`（为 harness 预留未来扩展）/ `ai-agent-shared.js`（_buildResultCardFromRunTool / _pushUniqueResultCard）。主文件 facade + 子文件 `register(app, options)` 签名 + 子文件 `_test` 字段全部统一。

**验证矩阵**：
- `node --check` 全部 OK
- 既有 chf0-http / chf0-critical / route-level 测试 0 退化
- vitest 75/630 0 退化
- 4 治理门 GREEN（docs:check / ui:audit:check / tsc --noEmit / docs:reconcile）
- 不变量守住（http 契约 100% 不变；端点 channel 名 / payload shape 100% 一致；preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* 0 diff）

**PHASE-2.1a 专项验证**（commit 1 最小验证）：
- `result-studio-route-baseline.test.mjs` 既有 9 helper 通过 `route._test` 引用 0 diff（主文件 facade re-export）
- 既有 chf0-http / result-studio / harness / loop / ai-agent 测试 0 退化
- 0 行为变化（pure refactor）

**r-server 大文件拆分特别风险**（基于调研 §10）：
- routes/result-studio.js 是 27 端点 HTTP 边界，http 契约 100% 不变是硬约束
- 既有 route-level 测试是契约边界证据；PHASE 2 拆分后必须确保所有 chf0-http + result-studio 测试 0 退化
- 拆分过程中如遇 partial-export 现象（与 A-008 act-tools 循环同源），优先用提取独立模块策略（参考 BLOCK-3 `_mapSkillRuntimeStatus.js` 范式）
- **🔴 LEGACY SSE 786 行单端点**（ai-agent.js 第 311-1097 行）几乎不可拆，**保留在 routes/ai-agent/chat.js 单文件内**（PHASE 2 最大风险点）
- **🟠 共享闭包变量跨子文件传递**：`repositoryInstance` / `replayService` / `baselineWork` / `workspaceInspectionWork` / `databasePath`（result-studio 闭包）必须通过 `options` 传给子文件；`recoveryConfirmations` Map（harness.js TTL 5min）保留在 workflow 子文件内部闭包
- **🟠 主文件 facade `_test` 字段延后赋值**避免子文件 require 主文件导致初始化循环
- **🟠 路由顺序敏感**：`routes/index.js` 中 Harness 注册位置（第 39 行）必须在 Tools 前、Feedback 后；`/api/result-studio/revisions/:revisionId/...` 13/14/23/26/27 端点按声明顺序匹配；`/api/harness/scientific-task/*` 7/8/9/10/13/14 按声明顺序
- **🟢 0 循环依赖**：调研 §12.2 验证 result-studio 内部 / ai-agent 内部 / 主文件 ↔ 子文件均无循环依赖
- **🟢 3 文件无直接路由间调用**（grep 0 匹配 routes/result-studio.js ↔ routes/harness.js 等），共享仅通过 `core/r-server/db.js` / `plugin-loader.js` / `cache-manager.js` 全局模块（调研 §12.1 #4）

### §4.4 PHASE 3 — agent-runner 拆分 + 跨层反向 + 循环解环（A-001 + A-003 + A-008 + A-006 部分）— 1-2 commit

**目标**：抽 `LoopOrchestrator` + `ConversationAdapter` 让 `agent-runner.js` 1799 → < 600；`shared-backend/agent-workflow.js` configure 注入修复跨层反向依赖；`act-tools ↔ plan-ui-tools` 解环；≥5 处 module-level singleton 迁 SQLite。

**涉及文件**：

| commit | 范围 | 涉及文件 |
|--------|------|----------|
| **PHASE-3.1** | A-001 agent-runner 拆分 | `core/r-server/agent-runner.js` 1799 → ~550 + `core/r-server/loop-orchestrator.js`（新 ~500 行）+ `core/r-server/conversation-adapter.js`（新 ~300 行） |
| **PHASE-3.2** | A-003 + A-008 跨层反向 + 循环解环 | `core/shared-backend/agent-workflow.js`（去掉 try/catch require + 改 configure 注入）+ `core/shared-backend/index.js`（暴露 configure）+ `core/r-server/bootstrap.js`（启动时 configure）+ `core/r-server/agent-tools/act-tool-core.js`（新）+ `core/r-server/agent-tools/act-tool-ui.js`（新，依赖 plan-ui-tools）+ `agent-tools/act-tools.js`（改为 facade 反向 require core + ui） |
| **PHASE-3.3**（可选） | A-006 部分 singleton 收敛 | `_pendingActAcks` / `_embedCallLog` / `_aiUserStreams` 等 ≥5 处迁 SQLite（agent_task_events + 新表 `ai_user_streams` / `embed_log`）|

**commit 边界**：1-2 commit（PHASE-3.1+3.2 合并 1 commit 或拆 2 commit；PHASE-3.3 可选独立 1 commit）

**验证矩阵**：
- `node --check` 全部 OK
- chf0-critical 33/33 + agent-runner 既有测试 0 退化
- vitest 75/630 0 退化
- 4 治理门 GREEN
- 不变量守住（agent loop 状态机 0 变化 / shared-backend 自洽属性恢复 / partial-export 雷区消除）

### §4.5 PHASE 4 — audit + closeout — 2-3 commit

**目标**：4 canonical 文档同步 + DOC-REGISTRY 登记 + ui-productization-audit ledger + closeout 报告。

**涉及文件**：
- `docs/DOC-REGISTRY.json` — `BLOCK-10-ARCHITECTURE` active → completed + linkedCommits 4-7 项 + 新增 `BLOCK-10-ARCHITECTURE-CLOSEOUT` reference entry
- `docs/next-steps-roadmap.md` — launch entry + closeout entry
- `docs/project-workspace-handoff.md` — launch entry + closeout entry
- `docs/AUDIT-LOG.md` — PHASE 1+2+3+4 entry（**主 agent 登记，不在子 agent 工作范围**）
- `docs/ui-productization-audit.md` — 增 entry「BLOCK-10-ARCHITECTURE 工作包收口」（无 UI-### 占位，纯架构 ledger）
- `docs/block-10-architecture-closeout.md` — closeout 报告 v1.0（11 节）

**commit 边界**：2-3 commit（PHASE-4.1: 4 canonical + DOC-REGISTRY / PHASE-4.2: ui-productization-audit ledger / PHASE-4.3: closeout 报告）

**验证矩阵**：
- `npm run docs:check` GREEN
- `npm run docs:reconcile` GREEN
- `npm run ui:audit:check` GREEN
- chf0-critical 33/33 PASS
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

- ❌ 不重新激活 BLOCK-2 / BLOCK-3 / BLOCK-4 / BLOCK-5 / BLOCK-6 / BLOCK-7 / BLOCK-8 / BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 / BLOCK-10-AUDIT-CLOSEOUT
- ❌ 不修改 BLOCK-3 已建立的 sender 守门 helper（**复用**而非重写）
- ❌ 不修改 BLOCK-5 已统一的 IPC channel 字面量
- ❌ 不修改 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 已拆分的 _data.ts / main.js / DesktopSettingsPanel/ResultView/plugin-manager/SimpleChat/useSkillStore
- ❌ 不修改 BLOCK-10-AUDIT-CLOSEOUT 已落地的 PHASE 1+2 commits（仅在 PHASE 1 范围内"自然补全" A-007 / A-009 / A-010 / E-019 full 这 4 项 P1 快赢的"补全"，不重写已落地 PR-001 retention / E-017 r-server partial）

### §5.3 不破坏（不变量守住）

- ❌ 不修改 `src/preload.js` 顶层 18 namespace 任何 key 名
- ❌ 不修改 `frontend/src/lib/electron.d.ts` 任何已有声明
- ❌ 不修改 `frontend/src/lib/desktopBridge.ts` 任何已有导出
- ❌ 不修改 4 page（BranchTabs / ResultStudio / 等）
- ❌ 不修改 `core/shared-backend/*` 公共接口（仅在 PHASE 3.2 范围内 expose `configure({projectHarnessWorkflowJob})` 是 ADDITIVE 不破坏既有）
- ❌ 不修改 5 audit 报告（仅 Read + 本计划引用）
- ❌ 不修改 `agent-tools/*` / `agent-transcripts/*`（历史抹底产物）
- ❌ 不修改 BLOCK-10-AUDIT-CLOSEOUT 已落地的 11 commits

### §5.4 不引入（新依赖）

- ❌ 不引入 `ajv` / `zod` / `joi` / `prom-client` / `opentelemetry` / `lru-cache` / `simple-git`
- ❌ 不引入新 npm 依赖（PHASE 1+2+3 所有改动纯 Node / TypeScript / Express 自有 API）
- ❌ 不引入新的 React 组件库 / CSS 框架
- ❌ PHASE 1.2 主动**移除** `frontend/jspdf`（dead dep），不是新增

### §5.5 不改业务行为（G0 阶段 G0 边界内）

- ❌ 不修改 provider fallback 策略
- ❌ 不修改 Result Studio 业务逻辑
- ❌ 不修改 agent loop 状态机（PHASE 3.1 拆分后行为不变）
- ❌ 不修改 SQLite schema（PHASE 1.1 仅抽 _db-singleton 复用既有表，不 DROP / ALTER）
- ❌ 不修改 http 契约（PHASE 2 拆分后端点 channel 名 / payload shape 100% 一致）

### §5.6 不启动下一候选工作包（仅登记）

按 BLOCK-10 §5.2 已明确的候选工作包映射，本工作包**不实际启动**以下 7 项，仅在 PHASE 4 closeout 报告 §10.3 登记为"下一候选"：

| ID | 不启动原因 | 候选工作包 |
|----|------------|-----------|
| A-004 | observability 体系化超出 PHASE 范围 | observability-work-package |
| E-017 main | observability 体系化 | observability-work-package |
| E-018 | observability 体系化 | observability-work-package |
| PR-006 | observability 体系化 | observability-work-package |
| C-001-rserver | rserver-http debt | rserver-http-debt-pack |
| C-002-rserver | rserver-http debt | rserver-http-debt-pack |
| M-001 | rserver-http debt | rserver-http-debt-pack |
| M-003 | rserver-http debt | rserver-http-debt-pack |
| A-011 | type drift | type-drift-pack |
| A-012 | fixture manifest | fixture-manifest-pack |

---

## §6 修复顺序（DAG）

### §6.1 完整 DAG（19 项 ID）

```
PHASE 1（DB 体系化 + 配置快赢）
  A-007 → PR-012 → E-019 full     (3 项同根，1 commit)
  A-009 → A-010 (jspdf + 6 env)   (2 项同 commit，依赖 env-coordinator.js)
         ↓
PHASE 2（r-server 大文件拆分）
  A-002 routes/result-studio 拆分    (1-2 commit)
  A-005 routes/harness + ai-agent 拆分 (1 commit；与 A-002 文件不交叉，可与 A-002 第二 commit 并行)
         ↓
PHASE 3（agent-runner + 跨层反向 + 循环解环）
  A-001 agent-runner 拆分              (1 commit)
  A-003 + A-008 跨层反向 + 循环解环   (1 commit；依赖 PHASE 3.1 的 loop-orchestrator.js 不引用 harness-workflow-state)
  A-006 部分 singleton 收敛           (可选 1 commit；与 PHASE 3.2 同 commit 也可)
         ↓
PHASE 4（audit + closeout）
  4 canonical + DOC-REGISTRY           (PHASE-4.1)
  ui-productization-audit ledger       (PHASE-4.2)
  closeout 报告 v1.0                   (PHASE-4.3)
```

### §6.2 关键路径

`A-007 → PR-012 → E-019 full → A-002 → A-005 → A-001 → A-003 → A-008 → PHASE 4 audit → PHASE 4 closeout`

### §6.3 可并行 ID

- **PHASE 1.1（A-007 + PR-012 + E-019 full）** 与 **PHASE 1.2（A-009 + A-010）**：不同文件，但 A-009 必读 `env-coordinator.js`；A-007 也涉及 desktop 进程 SQLite。**实际串行**（commit 内串行落地）。
- **PHASE 2.1（A-002 routes/result-studio）** 与 **PHASE 2.2（A-005 routes/harness + ai-agent）**：不同文件，可独立 commit。**实际可并行 commit**，但 commit 落地按顺序便于审阅。
- **PHASE 3.1（A-001 agent-runner）** 与 **PHASE 3.2（A-003 + A-008）**：A-003 修复后 agent-workflow.js 不再反向 require harness-workflow-state；A-001 loop-orchestrator.js 也不引入反向 require。**实际串行**（PHASE 3.1 先于 PHASE 3.2）。

### §6.4 偏离声明

| 偏差项 | 候选计划假设 | 实际调研结论 | 偏差处理 |
|--------|------------|------------|----------|
| **r-server 大文件拆分风险** | 候选工作包假设 26+ 端点可平滑拆分 | 实际 http 契约 100% 不变是硬约束；既有 chf0-http + result-studio 测试是契约边界证据 | PHASE 2 拆分过程中遇 partial-export 现象优先用提取独立模块策略（参考 BLOCK-3 `_mapSkillRuntimeStatus.js`） |
| **A-007 DB singleton 重复** | 候选工作包假设可统一到 `core/r-server/db.js` | 实际 desktop 进程与 r-server 进程是不同进程，从架构上需分开；代码层共享 `getDatabase` 函数 | PHASE 1.1 抽 `src/database/_db-singleton.js` 仅代码层共享，进程边界由 ELECTRON main 进程事实承担 |
| **A-001 agent-runner 拆分** | 候选工作包假设抽 LoopOrchestrator + ConversationAdapter 即可 | 实际 agent-runner 还有 20 顶层 require 覆盖 system-prompt / llm-client / plans / conversations / memory-vectors / runtime 等；拆完后 `loop-controller` 应独立 require 0 个 agent-runner 内部函数 | PHASE 3.1 拆完后额外验证 `loop-controller.js` 仍可独立运行 |
| **A-006 56+ singleton 整体收敛** | 候选工作包假设全部收敛 | 实际 56+ 处里 ~12 处可迁 SQLite；其余 ephemeral 内存 cache 现状 OK | PHASE 3.3 仅 ≥5 处迁 SQLite，剩余保留 |
| **A-010 隐式 env 集中** | 候选工作包假设 214 处全部集中 | 实际进程启动时一次性读 env + helper 内读 env，集中在 `shared-backend/config-helper.js` 后行为不变 | PHASE 1.2 仅 6 处 `process.env.*` 集中（核心 DB 路径 / R_SERVER_URL / PY_SERVER_URL / GATEWAY_URL / BIOF3_CONTENT_ROOT / BIOF3_CONTENT_PLUGINS_DIR），其余保留 |

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
| `npm run g0:result-studio:p3` | Result Studio P3 专项门禁 | 仅在 PHASE 2 触 result-studio 时跑 |

### §7.3 focused tests（按 `test/impact-map.json` + 实际变更文件定向）

**PHASE 1 focused tests**：

```
node --test \
  test/db-singleton.test.mjs \                       # 新增（A-007 + PR-012 + E-019 full）
  test/env-coordinator-port.test.mjs \              # 新增（A-009）
  test/config-helper-centralized.test.mjs \         # 新增（A-010 env 集中）

# 既有 0 退化：
node --test \
  test/g0-chf0-acceptance.mjs \                     # chf0-critical 33/33
  test/backend-health.test.mjs \                    # 端口 health
```

**PHASE 2 focused tests**：

```
node --test \
  test/routes-result-studio-split.test.mjs \        # 新增（A-002 拆分后子域文件契约）
  test/routes-harness-split.test.mjs \              # 新增（A-005 harness 拆分）
  test/routes-ai-agent-split.test.mjs \             # 新增（A-005 ai-agent 拆分）

# 既有 0 退化：
node --test \
  test/g0-chf0-http.test.mjs \                      # IPC contract
  test/result-studio-context.test.mjs \             # result-studio context
  test/result-handlers-valid-types.test.mjs \       # result:create validTypes
```

**PHASE 3 focused tests**：

```
node --test \
  test/loop-orchestrator.test.mjs \                 # 新增（A-001 LoopOrchestrator 拆出）
  test/conversation-adapter.test.mjs \              # 新增（A-001 ConversationAdapter 拆出）
  test/agent-workflow-configure.test.mjs \          # 新增（A-003 configure 注入）
  test/act-tools-decycle.test.mjs \                 # 新增（A-008 解环后 act-tools / plan-ui-tools 单向依赖）

# 既有 0 退化：
node --test \
  test/agent-workflow.test.mjs \                    # agent-workflow 既有测试
  test/agent-tool-policy.test.mjs \                 # act-tools / plan-ui-tools 既有测试
  test/agent-task-cancellation.test.mjs \           # retry 边界
```

### §7.4 dev Electron 边界内 verify（手工 + Playwright MCP 可选）

- **PHASE 1**：dev Electron 启动 → SQLite 路径不变 → backend health endpoint 仍 ok
- **PHASE 2**：dev Electron 启动 → 调用 result:create / interaction / changesets 各子域端点 → 全部响应一致
- **PHASE 3**：dev Electron 启动 → 触发 agent loop → 状态机行为与拆分前完全一致

### §7.5 兼容性测试（chf0-critical + vitest）

- chf0-critical 3 测试 33 项 PASS（**plugin IPC contract**）
- vitest 75 文件 630 tests PASS（仅改新文件 / 改动文件相关测试，**不动其他测试**）

---

## §8 风险矩阵

> **详见** `docs/block-10-arch-ph0-risks.md`（19 项 ID × 风险维度详细登记）

### §8.1 风险等级分布

| 等级 | 本工作包主范围 ID | 不启动 ID |
|------|------------------|----------|
| 🔴 高 | A-001 + A-002 + A-005 | E-017 main + E-018 + M-001 + M-003 |
| 🟠 中 | A-003 + A-006 部分 + A-007 + A-008 + A-010 部分 + E-019 full | A-004 + PR-006 + C-001-rserver + C-002-rserver |
| 🟢 低 | A-009 + A-010（jspdf）+ PR-012 | A-011 + A-012 |

### §8.2 关键风险点

1. **🔴 A-001 agent-runner.js 拆分**：4 大类 require（system-prompt / llm-client / plans / conversations / memory-vectors / runtime / loop-contract / loop-controller / loop-checkpoint）跨域耦合；行为不变硬约束
2. **🔴 A-002 routes/result-studio.js 26+ 端点拆分**：http 契约 100% 不变；端点 channel 名 / payload shape 100% 一致；既有 chf0-http + result-studio 测试是契约边界证据
3. **🔴 A-005 routes/harness.js + routes/ai-agent.js 拆分**：同 A-002 模式但职责更复杂；ai-agent.js 集成 SSE + Loop + Tool Call + Conversation
4. **🟠 A-003 shared-backend 跨层反向 require 修复**：configure 注入破坏既有调用链（agent-workflow.js 顶部 try/catch 是已存在的"安全网"）
5. **🟠 A-008 act-tools ↔ plan-ui-tools 解环**：plan-ui-tools.js 顶层 require act-tools；作者已知 partial-export 风险（注释为证）；拆解要保留既有 lazy plan-ui-tools 解构工作模式

### §8.3 r-server 大文件拆分特别风险（A-002 / A-005）

| 风险 | 等级 | 描述 | 缓解 |
|------|------|------|------|
| http 契约漂移 | 🔴 高 | 拆分后端点 channel 名 / payload shape 必须 100% 一致 | 既有 chf0-http + result-studio + harness 测试 0 退化是契约边界证据 |
| 路由注册顺序错位 | 🟠 中 | routes/index.js 注册顺序与 import 顺序耦合 | 抽 routes/result-studio/index.js 注册中心 + harness + ai-agent 同模式 |
| partial-export 雷区 | 🟠 中 | 与 A-008 act-tools 循环同源；CommonJS partial-export 现象 | 优先用提取独立模块策略（参考 BLOCK-3 `_mapSkillRuntimeStatus.js` 范式） |
| 既有 8+ 测试文件 0 改动 | 🟠 中 | 拆分后 import 路径保持原状（re-export 兼容） | 主文件 + 子文件双向 re-export；既有 test 0 diff |
| 端点合并 / 拆分误判 | 🟠 中 | 26+ 端点按 domain 拆 9 个子域文件，边界判定需 review | PHASE 2.1 拆分前先列端点 → domain 映射表，PHASE 0.5 落地验证 |

### §8.4 跨包冲突风险

- BLOCK-3/4/5/9/9.1/9.2 边界严格守住（§5.2 + §2.4）
- BLOCK-10-AUDIT-CLOSEOUT 边界严格守住（仅在 PHASE 1.1 范围内"自然补全"A-007 / PR-012 / E-019 full，不重写 PR-001 retention / E-017 r-server partial）
- A-007 + A-009 + A-010 PHASE 1.1 + 1.2 必读 `env-coordinator.js`，但仅对齐 fallback，不重写函数体

### §8.5 性能风险

- A-002 / A-005 拆分不引入性能回退（仅 module 拆分，运行时路径不变）
- A-001 拆分不引入性能回退（仅 module 拆分，agent loop 状态机不变）
- A-006 部分 singleton 迁 SQLite 需谨慎：写入者竞争 + restart 恢复时间（必须确保既有 `agent_task_events` 表写入者不与新表冲突）

### §8.6 兼容性风险

- preload.js 18 namespace 0 diff
- electron.d.ts 0 diff
- desktopBridge.ts 0 diff
- 4 page consumer 0 diff
- core/shared-backend/* 公共接口 0 diff（仅 PHASE 3.2 ADDITIVE expose `configure({projectHarnessWorkflowJob})`）
- agent-tools/* + agent-transcripts/* 0 diff

### §8.7 G1+ 不外推（红旗）

详见 `docs/block-10-arch-ph0-risks.md` §6。

### §8.8 PHASE 2 调研新增 3 项红旗（基于 `docs/block-10-arch-ph2-routes-mapping.md` §10 / §12.3）

| # | 红旗 | 等级 | 触发原因 | 缓解 |
|---|------|------|----------|------|
| **🚩-1** | LEGACY SSE 单端点 786 行（`POST /api/ai/agent`，`routes/ai-agent.js` 第 311-1097 行）几乎不可拆 | 🔴 高 | ai-agent.js 仅 3 端点但单端点 786 行 + 30+ helper 调用 + SSE 流式输出 + 多阶段编排 | **不拆端点**，保留在 `routes/ai-agent/chat.js` 单文件内；仅将 `_buildResultCardFromRunTool` + `_pushUniqueResultCard` 抽到 `_helpers/ai-agent-shared.js`；其余 helper 留 `chat.js` 闭包。既有 `g0-chf0-*` + loop-api-route 测试 0 退化是契约边界证据。 |
| **🚩-2** | 共享闭包变量跨子文件传递 | 🟠 中 | `repositoryInstance` / `replayService` / `baselineWork` / `workspaceInspectionWork` / `databasePath`（result-studio 闭包）跨 9 个子文件共享；`recoveryConfirmations` Map（harness.js TTL 5min）跨 workflow/action + workflow/status 两端点 | 通过 `options` 闭包变量传递（`routes/<domain>/index.js` 注册中心闭包持有 + 子文件 `register(app, options)` 接收）；`recoveryConfirmations` 保留在 `routes/harness/workflow.js` 闭包内部 |
| **🚩-3** | 主文件 facade `_test` 字段延后赋值避免初始化循环 | 🟠 中 | `routes/<domain>.js` 主文件 facade `_test` 字段 require 所有子文件 → 子文件 `_test` 字段 require 主文件 → 初始化时循环 | 主文件 facade `_test` 字段**延后赋值**（在所有子文件 require 完成后再填充）；子文件 `_test` 字段直接 export 本文件函数，**不反向 require 主文件**；既有 `result-studio-route-baseline.test.mjs` 9 helper 0 diff |

---

## §9 验收门

### §9.1 PHASE 1 验收门（A-007 + PR-012 + E-019 full + A-009 + A-010）

| 验收项 | 期望 | 命令 |
|--------|------|------|
| tsc 0 error | 0 | `cd frontend && npx tsc --noEmit` |
| docs:check PASS | 注册文档数 PASS | `npm run docs:check` |
| ui:audit:check PASS | UI ID 数 PASS | `npm run ui:audit:check` |
| docs:reconcile 0 drift | 0 drift | `npm run docs:reconcile` |
| 既有 chf0-critical | 33/33 PASS | `node scripts/g0-chf0-acceptance.mjs` |
| 新增 db-singleton.test | 5+/5+ PASS | `node --test test/db-singleton.test.mjs` |
| 新增 env-coordinator-port.test | 3+/3+ PASS | `node --test test/env-coordinator-port.test.mjs` |
| 新增 config-helper-centralized.test | 3+/3+ PASS | `node --test test/config-helper-centralized.test.mjs` |
| 既有 vitest 0 退化 | 75 文件 630 tests PASS | `npm run test:changed` |
| 不变量守住 | preload.js / electron.d.ts / desktopBridge.ts 0 diff | `git diff --name-only` |

### §9.2 PHASE 2 验收门（A-002 + A-005 — 5 commit）

**总目标**：49 端点（27 + 19 + 3）拆分落地；22 子文件 + 6 `_helpers/`；http 契约 100% 不变；既有 chf0-http + route-level 测试 0 退化。

| 验收项 | 期望 | 命令 |
|--------|------|------|
| tsc 0 error | 0 | `cd frontend && npx tsc --noEmit` |
| docs:check PASS | 注册文档数 PASS | `npm run docs:check` |
| ui:audit:check PASS | UI ID 数 PASS | `npm run ui:audit:check` |
| docs:reconcile 0 drift | 0 drift | `npm run docs:reconcile` |
| 既有 chf0-critical / chf0-http 33/33 | 0 退化 | `node scripts/g0-chf0-acceptance.mjs` |
| 既有 result-studio + harness + loop + ai-agent 测试 0 退化 | 全部 PASS | `npm run test:changed` |
| 新增 routes-result-studio-split.test | 5+/5+ PASS | `node --test test/routes-result-studio-split.test.mjs` |
| 新增 routes-harness-split.test | 5+/5+ PASS | `node --test test/routes-harness-split.test.mjs` |
| 新增 routes-ai-agent-split.test | 5+/5+ PASS | `node --test test/routes-ai-agent-split.test.mjs` |
| http 契约 100% 不变 | 端点 channel 名 + payload shape 完全一致 | `git diff --stat` + manual grep |
| 49 端点全部落地 | 27 + 19 + 3 | `grep -c "app\." core/r-server/routes/{result-studio,harness,ai-agent}/{*/}*.js` |
| 22 子文件 + 6 `_helpers/` 落地 | 文件数一致 | `ls core/r-server/routes/{result-studio,harness,ai-agent,_helpers}` |
| 0 循环依赖 | require 方向无环 | `node --check` + `test/routes-*-split.test.mjs` |
| 不变量守住 | preload.js / electron.d.ts / desktopBridge.ts 0 diff | `git diff --name-only` |

**PHASE-2.1a 专项验证**（commit 1 / facade + `_helpers/` prep）：
- `result-studio-route-baseline.test.mjs` 既有 9 helper 通过 `route._test` 引用 0 diff（主文件 facade re-export）
- `node --check` 全部 OK
- 既有 chf0-http + result-studio + harness + loop + ai-agent 测试 0 退化
- 0 行为变化（pure refactor）

**PHASE-2.1b 专项验证**（commit 2 / 9 子域文件落地）：
- 27 端点全部落地（repository 2 / interaction 2 / selection 6 / context 1 / changesets 4 / revisions 5 / storage 4 / workspace 2 / preview-budget 1）
- 端点声明顺序与原文件 856-1786 范围一致
- `node --check` + `test/routes-result-studio-split.test.mjs` 全 PASS
- 既有测试 0 退化

**PHASE-2.2a 专项验证**（commit 3 / harness facade + `_helpers/` prep）：
- 同 PHASE-2.1a 模式 + 既有 `chat-file-references-route.cjs` / `loop-api-route.test.mjs` / `loop-iterate-route.test.mjs` 0 退化

**PHASE-2.2b 专项验证**（commit 4 / 8 子域文件落地）：
- 19 端点全部落地（scientific-task 8 / workflow 2 / recovery 1 / file-references 2 / tools 2 / feedback 1 / health 1 / events 2）
- `recoveryConfirmations` Map 保留在 `routes/harness/workflow.js` 闭包内部
- `test/routes-harness-split.test.mjs` 全 PASS

**PHASE-2.2c 专项验证**（commit 5 / ai-agent 子域文件落地）：
- 3 端点全部落地（chat 1 含 legacy SSE 786 行 / context 1 / events 1 / tools 1 — ai-agent index 注册 4 个子文件）
- LEGACY SSE 786 行完整保留在 `routes/ai-agent/chat.js` 单文件内（PHASE 2 最大风险点）
- 仅 `_buildResultCardFromRunTool` + `_pushUniqueResultCard` 抽到 `_helpers/ai-agent-shared.js`
- `test/routes-ai-agent-split.test.mjs` 全 PASS
- 既有 `g0-chf0-*` + loop-api-route 测试 0 退化是契约边界证据

### §9.3 PHASE 3 验收门（A-001 + A-003 + A-008 + A-006 部分）

| 验收项 | 期望 | 命令 |
|--------|------|------|
| tsc 0 error | 0 | `cd frontend && npx tsc --noEmit` |
| docs:check PASS | 注册文档数 PASS | `npm run docs:check` |
| ui:audit:check PASS | UI ID 数 PASS | `npm run ui:audit:check` |
| docs:reconcile 0 drift | 0 drift | `npm run docs:reconcile` |
| 既有 chf0-critical 33/33 | 0 退化 | `node scripts/g0-chf0-acceptance.mjs` |
| 新增 loop-orchestrator.test | 8+/8+ PASS | `node --test test/loop-orchestrator.test.mjs` |
| 新增 conversation-adapter.test | 5+/5+ PASS | `node --test test/conversation-adapter.test.mjs` |
| 新增 agent-workflow-configure.test | 4+/4+ PASS | `node --test test/agent-workflow-configure.test.mjs` |
| 新增 act-tools-decycle.test | 4+/4+ PASS | `node --test test/act-tools-decycle.test.mjs` |
| agent loop 状态机 0 变化 | 行为完全一致 | `npm run test:changed` |
| shared-backend 自洽属性恢复 | 不再 require r-server | `grep "require.*r-server" core/shared-backend/agent-workflow.js` 0 输出 |
| 不变量守住 | preload.js / electron.d.ts / desktopBridge.ts 0 diff | `git diff --name-only` |

### §9.4 PHASE 4 closeout 验收门

| 验收项 | 期望 | 命令 |
|--------|------|------|
| 4 canonical 文档同步 | README + roadmap + handoff + DOC-REGISTRY | `cat docs/README.md` 等 |
| DOC-REGISTRY `active → completed` + linkedCommits 4-7 项 | 完成 | `python -m json.tool docs/DOC-REGISTRY.json` |
| ui-productization-audit ledger entry | BLOCK-10-ARCHITECTURE 工作包收口笔录 | `grep "BLOCK-10-ARCHITECTURE" docs/ui-productization-audit.md` |
| closeout 报告 11 节齐全 | 完成 | `wc -l docs/block-10-architecture-closeout.md` ≥ 250 行 |
| 4 治理门 GREEN | docs:check / ui:audit:check / tsc / docs:reconcile | 4 命令 |
| chf0-critical 33/33 | 0 退化 | `node scripts/g0-chf0-acceptance.mjs` |
| vitest 75/630 | 0 退化 | `npm run test:changed` |
| 19 项 ID 处理完整 | 12 项主范围落地 + 7 项关联登记 | `cat docs/block-10-architecture-closeout.md` |

### §9.5 v0.2 active 工作包收口（最终验收）

- ✅ PHASE 0 架构调研 4 文件 + PHASE 2 调研 1 文件产出（v0.1 → v0.2 升级）
- ⏳ PHASE 1 DB 体系化 + 配置快赢（2 commit）
- ⏳ PHASE 2 r-server 大文件拆分（**5 commit**：2.1a / 2.1b / 2.2a / 2.2b / 2.2c）
- ⏳ PHASE 3 agent-runner + 跨层反向 + 循环解环（1-2 commit）
- ⏳ PHASE 4 audit + closeout（2-3 commit）
- ✅ 5 audit 报告 + 本计划 v0.2 + 4 份 PHASE 0 调研 + 1 份 PHASE 2 调研 = 完整证据链

---

## §10 closeout 报告骨架（PHASE 4 输出）

> **closeout 报告位置**：`docs/block-10-architecture-closeout.md`
> **章节结构**（与 BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 / BLOCK-10-AUDIT-CLOSEOUT 模板一致，共 11 节）：

| § | 标题 | 内容要点 |
|---|------|----------|
| 1 | 元数据 | 工作包 ID / Plan canonical / DOC-REGISTRY / closeout 报告 / 关联 PHASE 0 调研 4 份 / 报告人 / 日期 / 数量声明（19 vs 13） |
| 2 | 实施总结（5 PHASE） | PHASE 0（已收口）+ PHASE 1（2 commit）+ PHASE 2（2-3 commit）+ PHASE 3（1-2 commit）+ PHASE 4（2-3 commit） |
| 3 | PHASE 0 架构调研 | 4 份 PHASE 0 调研报告核心结论 + 19 项 ID 数量声明 + 12 主范围 + 7 关联归类 |
| 4 | PHASE 1 — DB 体系化 + 配置快赢 | A-007 + PR-012 + E-019 full + A-009 + A-010 落地；既有 PR-001 retention / E-017 r-server partial 不重写 |
| 5 | PHASE 2 — r-server 大文件拆分 | A-002 + A-005 落地；http 契约 100% 不变；既有 chf0-http + result-studio + harness 测试 0 退化 |
| 6 | PHASE 3 — agent-runner + 跨层反向 + 循环解环 | A-001 + A-003 + A-008 + A-006 部分落地；agent loop 状态机 0 变化；shared-backend 自洽属性恢复 |
| 7 | PHASE 4 — audit + closeout | 4 canonical 同步 + DOC-REGISTRY + closeout 报告 + ui-productization-audit ledger |
| 8 | 累计指标 | 4-7 commits / N test files / N tests / 不变量守住 |
| 9 | 不变量 + 7 不重启 | preload.js / electron.d.ts / desktopBridge.ts / 4 page / core/shared-backend/* / agent-tools/* / agent-transcripts/* 0 diff |
| 10 | 不外推（10 项登记为下一候选） | observability-work-package（4 项） + rserver-http-debt-pack（4 项） + type-drift-pack（1 项） + fixture-manifest-pack（1 项）；G1+ 阶段事项（7 项红旗） |
| 11 | 后续候选 | observability-work-package / rserver-http-debt-pack / type-drift-pack / fixture-manifest-pack / BLOCK-11 候选 / 待用户显式裁决 |

---

## §11 不外推纪律（强制）

> **本节为本计划最强约束，所有 PHASE 1+2+3+4 收口必须遵守**。

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

### §11.3 7 项关联项登记纪律（下一候选工作包）

PHASE 4 closeout 报告 §10.3 必须按以下映射登记 7 项关联项（仅登记，不实际修改代码）：

| 类别 | ID | 候选工作包 |
|------|----|-----------|
| observability | A-004 + E-017 main + E-018 + PR-006 | observability-work-package |
| rserver-http | C-001-rserver + C-002-rserver + M-001 + M-003 | rserver-http-debt-pack |
| type drift | A-011 | type-drift-pack |
| fixture | A-012 | fixture-manifest-pack |

### §11.4 红旗（closeout 报告必须不出现）

| 红旗表述 | 触发原因 |
|----------|----------|
| ❌「PHASE 4 收口后还需 packaged Electron 公证」 | 把 G1+ 当成待办 |
| ❌「A-001 / A-002 / A-005 待启动需 dev Electron 实机验证」 | 把 G0 边界内 verified 视为不充分 |
| ❌「E-017 / E-018 / OB-001 / OB-002 / OB-003 推迟到下一工作包」 | 把 observability 体系化当成 G0 必做 |
| ❌「Provider 矩阵是 G1+ 阶段事项，本次工作包不外推」 | 列举未做项 |

---

## §12 关联收口文档（PHASE 4 落地后追加）

- `docs/block-10-architecture-closeout.md` — BLOCK-10-ARCHITECTURE 工作包完整 closeout（11 节 / TL;DR + 5 PHASE + 累计指标 + 不变量 + 不外推 + 后续候选）
- `docs/block-10-architecture-PHASE-N-record.md` — 各 PHASE 落地笔录（如有）

---

**不变量**：本计划 v0.1 为 BLOCK-10-ARCHITECTURE 工作包唯一 active canonical 计划（基于 4 份 PHASE 0 调研报告 + BLOCK-10-AUDIT-CLOSEOUT §10.3 候选清单 + 5 份 audit 报告综合起草）。PHASE 0 调研收口（0 代码改动），PHASE 1+2+3+4 待用户显式裁决启动。
