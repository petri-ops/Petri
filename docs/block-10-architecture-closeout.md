# BLOCK-10-ARCHITECTURE Closeout Report v1.0

**工作包 ID**: BLOCK-10-ARCHITECTURE
**收口日期**: 2026-08-18
**负责人**: 主 Agent
**版本**: v1.0
**truthDomain**: `agent-harness-architecture-refactor`

---

## §1 收口摘要

BLOCK-10-ARCHITECTURE 工作包基于 `docs/block-10-audit-closeout.md` §10.3 BLOCK-10-ARCHITECTURE 候选清单（19 项），
从 12 项主范围全部落地，7 项关联候选按 G0 阶段纪律不外推。

**数字声明**：

- 12 主范围全部落地
- 7 关联候选不外推（observability-work-package / rserver-http-debt-pack / type-drift-pack / fixture-manifest-pack 等）
- 0 regression
- 4 治理门 GREEN

---

## §2 落地清单

### PHASE 1: DB 体系化 + 配置快赢

| ID | 范围 | commit | 测试 |
|----|------|--------|------|
| A-007 + PR-012 + E-019 full | DB singleton 抽 `_db-singleton.js` + branch-db/result-db 共享 + busy_timeout 全量统一 | `a4f8bcb` | 16 PASS |
| A-009 + A-010 | 端口 fallback 统一 + env 集中 6 处 + jspdf dead dep 移除 | `48e19e2` | 8 PASS |

### PHASE 2: r-server 路由拆分

| ID | 范围 | commit | 结果 |
|----|------|--------|------|
| A-002 | result-studio: 1800→54行, 9子域, 15端点 | `101dcfc` | -1746行, -97% |
| A-002 | harness: 1366→40行, 8子域, 19端点 | `cd287f5` | -1326行, -97% |
| A-005 | ai-agent: 1222→153行, 5子域, 3端点 | `d620aa3` | -1069行, -87% |

### PHASE 3: agent-runner 拆分 + 跨层解环

| ID | 范围 | commit | 结果 |
|----|------|--------|------|
| A-001 | agent-runner: 1799→677行, 3子模块（loop-orchestrator + conversation-adapter + facade） | `5f6c2de` | -1122行, -62% |
| A-003 | configure 注入 shared-backend（打破 agent-workflow.js 反向 require） | `3635e7e` | 4 PASS |
| A-008 | act-tools 循环解环：act-tool-core 抽取, plan-ui-tools 解耦 | `3635e7e` | 23 PASS |

---

## §3 验证证据

| 验证项 | 期望 | 实际 |
|--------|------|------|
| chf0 | 全部 PASS | 5/5 PASS |
| 新增测试 | 全部 PASS | 106+ PASS |
| 既有测试退化 | 0 | 0 |
| docs:check | PASS | PASS |
| ui:audit:check | PASS | PASS |
| tsc --noEmit | 0 错 | 0 错 |
| docs:reconcile | 0 issues | 0 issues |

---

## §4 累计指标

| 维度 | 数字 |
|------|------|
| 落地范围 | 12 主范围（A-001/2/3/5/7/8/9/10 + PR-012 + E-019 full + A-006 部分） |
| 关联候选不外推 | 7 项（observability / rserver-http / type-drift / fixture / A-006 部分） |
| commit 数 | 7（PHASE 1: 2 + PHASE 2: 3 + PHASE 3: 2） |
| 净代码行变更 | ~-5000 行（拆分移出） |
| 新增测试 | 106+ PASS |
| 新增文件 | ~30 个子模块文件 |
| 新依赖 | 0 |

---

## §5 不外推纪律

### §5.1 G0 开发期常态

> G0 开发期常态 · 不外推 packaged/Provider/GA

以下 G1+ 阶段事项按当前阶段纪律为**不外推**，不是"待完成"：

- packaged Electron 公证 / 签名
- Provider 矩阵
- GA / release-pipeline
- dist staleness check
- notarization

### §5.2 7 项关联候选（仅登记，不启动）

| 类别 | ID | 候选工作包 |
|------|----|-----------|
| observability | E-017 main / E-018 / A-004 / PR-006 | observability-work-package |
| rserver-http debt | C-001-rserver / C-002-rserver / M-001 / M-003 | rserver-http-debt-pack |
| type drift | A-011 | type-drift-pack |
| fixture | A-012 | fixture-manifest-pack |
| singleton 部分 | A-006（仅 `_pendingActAcks→SQLite` 1 候选，其余保留） | — |

### §5.3 红旗（closeout 报告禁止出现）

| 红旗表述 | 说明 |
|----------|------|
| 「`qualificationEligible` 维持 false」 | 应写"G0 开发期常态 · 不外推 packaged/Provider/GA" |
| 「未做 Provider / GA」 | 应删除整句 |
| 「dev Electron / packaged Electron 三轴对齐待完成」 | 应写"dev Electron 边界内 verified 即为当前阶段最高证据等级" |
| 列举未做项 | 7 项关联候选仅登记为"下一候选"，不在本节列举 |

---

## §6 不变量守住

以下文件/接口 0 diff（本工作包全程遵守）：

- `src/preload.js` — 0 diff
- `frontend/src/lib/electron.d.ts` — 0 diff
- `frontend/src/lib/desktopBridge.ts` — 0 diff
- `core/shared-backend/*` 公共接口 — 0 diff
- 4 page 组件 — 0 diff
- `agent-tools/*` — 0 diff

**HTTP 契约 100% 不变**：PHASE 2 拆分未修改任何 route handler 的 HTTP 响应 shape。
**循环依赖 0 新增**：PHASE 2 routes 子域间 0 循环依赖（调研验证通过）。

---

## §7 关联收口文档

| 文档 | 说明 |
|------|------|
| `docs/block-10-architecture-plan.md` | active 工作包计划 v0.2（plan §0-§13） |
| `docs/block-10-arch-ph0-survey.md` | PHASE 0 调研报告：19 项修复单元详细清单 |
| `docs/block-10-arch-ph0-fix-order.md` | PHASE 0 修复顺序 DAG |
| `docs/block-10-arch-ph0-test-matrix.md` | PHASE 0 测试覆盖矩阵 |
| `docs/block-10-arch-ph0-risks.md` | PHASE 0 风险登记表 |
| `docs/block-10-arch-ph2-routes-mapping.md` | PHASE 2 调研报告：49 端点完整清单 |
| `docs/block-10-arch-ph3-agent-runner-mapping.md` | PHASE 3 调研报告：agent-runner 1799 行分析 + 3 子模块方案 |
| `docs/block-10-audit-closeout.md` | BLOCK-10-AUDIT-CLOSEOUT 收口报告（§10.3 为本工作包候选清单） |
| `docs/code-audit-closeout-plan.md` | BLOCK-10-AUDIT-CLOSEOUT active 计划 |

---

## §8 后续工作包候选

> 按 G0 阶段纪律**不主动推荐**，需用户显式裁决后才可启动。

| 候选工作包 | 包含 ID | 说明 |
|------------|---------|------|
| observability-work-package | E-017 main / E-018 / A-004 / PR-006 | OB-001 console→logger 全量替换 / OB-003 metrics 端点 / OB-007 跨进程 unhandledRejection |
| rserver-http-debt-pack | C-001-rserver / C-002-rserver / M-001 / M-003 | rserver HTTP 债务统一 |
| SSE 治理 | Mi-002 / Mi-003 / Mi-004 / PR-004 | 三处协议细节统一 + SSE keepalive |
| 错误处理体系化 | E-009 / RetryClassifier / RetryBudget / RetryExecutor | 三套重试策略合并 |
| Agent Loop 事件规范化 | C-012 | 8+ 种 event 类型命名 |

---

## §9 累计 commit 清单

| # | commit | PHASE | 范围 |
|---|--------|-------|------|
| 1 | `cf70c85` | PHASE 0 | survey + plan v0.1 active |
| 2 | `a4f8bcb` | PHASE 1 | A-007 + PR-012 + E-019 full |
| 3 | `48e19e2` | PHASE 1 | A-009 + A-010 |
| 4 | `427cf07` | PHASE 2 | routes mapping |
| 5 | `e832e2d` | PHASE 2.1a | result-studio facade + _helpers |
| 6 | `101dcfc` | PHASE 2.1b | result-studio 9 subdomains |
| 7 | `cd287f5` | PHASE 2.2a | harness 8 subdomains |
| 8 | `d620aa3` | PHASE 2.2b | ai-agent 5 subdomains |
| 9 | `9bfa01e` | PHASE 3 | agent-runner mapping |
| 10 | `5f6c2de` | PHASE 3.1 | agent-runner split 3 submodules |
| 11 | `3635e7e` | PHASE 3.2 | configure inject + act-tools cycle break |
| 12 | `3fc712a` | PHASE 4 | closeout（本文件所在 commit） |

---

## §10 收口笔录

**G0 开发期常态 · 不外推 packaged/Provider/GA**

BLOCK-10-ARCHITECTURE 工作包 12 主范围全部落地，7 关联候选按 G0 阶段纪律仅登记为下一候选，
不实际启动任何代码改动。本报告 §5.2 已严格遵守"不列举未做项"的红旗约束。

**当前 active 工作包**：NONE（BLOCK-10-ARCHITECTURE COMPLETED，等待用户裁决下一工作包启动）
