---
capability: harness-invisible-issues
kind: evidence
status: completed
item: 37
owner: main-agent
phase: G0
createdAt: 2026-11-25
---

# A2 架构债第一波 · console 治理扩面（低风险面）证据

> 来源 `docs/harness-invisible-issues-optimization-2026-11-25.md` §3 队列 7。独立分支 `petri-ops/codex-harness-console-governance`，提交留本地、push 待口令。G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围与红绿

- 本波只做低风险面的 console→logger 定向替换；聚宝盆拆解属独立第二波，本波零触碰。
- HK-01 先红后绿：`test/a2-console-wave1.test.mjs` 改动前 3/4 红（目标文件 console 未清零、未引入 logger；绝对不动面计数校准），改动后 **4/4 绿**。
- ratchet：`scripts/console-ratchet.mjs`（沿用 `silent-catch-ratchet.mjs` 既有机制，只减不增、基线下调）+ `test/console-baseline.json`：基线 **335 → 287**（core 自有代码 197 → 149，src 138 不变），98 文件，无新增调用/新增文件。

## 2. 改动清单与每文件 console 数（`/console\./g` 口径，前 → 后）

| 文件 | 前 | 后 | 说明 |
|---|---:|---:|---|
| `core/petri-server/mcp/registry/run-plugin-script.js` | 14 | 0 | 全为真实 warn/info 日志，接入 `../../../shared-backend/logger` |
| `core/petri-server/mcp/registry.js` | 11 | 2 | 9 处真日志改 logger；残留 2 处为 `execFile -e` 子进程源码字符串，**非本进程日志**，按上下文保留 |
| `core/petri-server/routes/feedback.js` | 6 | 0 | 3 error + 3 warn → logger |
| `core/petri-server/helpers/conversations.js` | 6 | 0 | 2 info + 4 warn → logger |
| `core/petri-server/cache-manager.js` | 5 | 0 | 2 info + 1 warn + 2 error → logger |
| `core/shared-backend/skill-runtime.js` | 4 | 0 | 集中 `_log` 改 logger 单源；用内置 `util.format` 保住多参/对象日志内容 |
| `core/petri-server/routes/ai-agent/events.js` | 4 | 0 | 4 处具名降级 warn → logger，`reasonCode` 语义零改 |
| `core/petri-server/jobs/retention-sweeper.js` | 5 | 5 | **零改**：5 处全是注释与 `warn = console.warn` 默认值，按纪律保留 |

合计收敛 **48 处**（14+9+6+6+5+4+4）。零新依赖（`util` / `shared-backend/logger` 均为内置或既有单源）；零行为与 reasonCode 语义改动。

## 3. 绝对不动面（HK-01 机械守护）

- `core/petri-server/agent-runner.js` 15 处：与第二波聚宝盆拆解同文件，本波零触碰。
- `core/shared-backend/error-log.js` 12 处调用（11 行）：BLOCK-520 OB-004 的 console.error→logError 桥接与写盘兜底，盲改会断链。
- BLOCK-520 P0 已修四文件不重复造；`server-main.js` 余 2 处注释/默认值不动。

## 4. 门禁结果

| 门 | 结果 |
|---|---|
| HK-01 `node --test test/a2-console-wave1.test.mjs` | **4/4 绿**（红 3/4 先行） |
| console ratchet `--check` | **PASS**（98 文件 / 287 处，基线 287） |
| `npm run gate:silent-catch` | **PASS**（402 处，基线 402） |
| `npm run quality:secret` | **PASS**（生产面 0 命中） |
| `npm run quality:arch` | **PASS**（R1–R5 无违规） |
| `npm run docs:check` | **PASS**（674 registered documents） |
| `npm run ui:audit:check` | **PASS** |
| 定向回归（9 个相关 test 文件） | **50 pass / 1 skip / 0 fail** |
| `node --check`（7 改动文件 + 2 新文件） | 全 OK |

**如实边界（非本波引入）**：`npm run test:changed:list` 因 impact-map 既有 `closed-batch-evidence-dirs` 引用缺失测试退出 2；`quality:lint` / `quality:lint:ledger` 全局红（54819 条前端 TS `no-unsafe-*` 未入抑制台账），本波 7 改动文件与 2 新文件 **0 error**；均已核对 git 未触碰其基线/台账。owner dev 实例零触碰，验证全走隔离进程/本分支工作树。

Jev 决策建议器：本阶段 `test:suggest` / `doc:suggest` 因 cloud 供给缺失（`jev.env.bak-by-user-request` 不可读）返回零建议，`decision:session` 无台账 DB；如实记 **jev×0**，非故障。

## 5. 剩余 console 分布（留第二波 / 其他波次）

core 自有代码余 **149** 处，前排：`agent-runner.js` 15（第二波聚宝盆同文件）、`error-log.js` 12（桥接禁改）、`retention-sweeper.js` 5（注释默认值）、`agent-tools/skill-tools.js` 4、`mobile-gateway/index.js` 4、`stale-running-reconciler.js` 4、`knowledge-space.js` 4、`knowledge-ingest.js` 4、`ai-usage.js` 4、`ai-agent/chat.js` 3 等。src 余 138 处（`plugin-manager.js` 24、`ipc/file-dialog.js` 14、`main.js` 11 等），不属本波 core 口径。ratchet 已全量冻结，后续任何新增即红。
