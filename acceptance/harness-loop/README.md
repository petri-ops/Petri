# HLE-0: Harness Loop Engineering Baseline

## Status: `completed`（离线门禁与 `production/` 真实产品证据均已收口）

## Exit Criteria

- [x] `acceptance/harness-loop/baseline.json` established
- [x] `acceptance/harness-loop/scenarios/spt1-task-spec.json` — SPT-1 TaskSpec
- [x] `acceptance/harness-loop/scenarios/spt1-normal.json` — normal scenario
- [x] `acceptance/harness-loop/scenarios/spt1-repairable.json` — repairable scenario
- [x] `acceptance/harness-loop/scenarios/spt1-blocking.json` — blocking scenario
- [x] `acceptance/harness-loop/loop-baseline-metrics.json` — baseline metrics
- [x] `scripts/harness-loop-evaluate.mjs` — offline evaluation script
- [x] `scripts/harness-loop.mjs` — aggregate gate script
- [x] `test/loop-fixtures.test.mjs` — Node.js test suite
- [x] All files pass `node --check` and `node test/loop-fixtures.test.mjs`
- [x] `production/` — SPT-1 七节点三轨、双 Provider、应用重启、Delivery/Replay 和视觉矩阵

## Background

**HLE (Harness Loop Engineering)** is the engineering discipline that makes the Harness autonomously complete scientific tasks end-to-end — from novice natural-language goal to verified evidence report — without user hand-holding.

**SPT-1 (Scientific Pilot Task 1)** is the first science pilot: a sanitized Bulk RNA-seq differential expression workflow using demo data. It is not a product feature; it is a concrete, measurable engineering target.

## Three Scenario Classes

| Scenario | Meaning | Loop Target |
|---|---|---|
| `normal` | DAG completes cleanly, all nodes verified | 100% completion rate |
| `repairable` | Transient fault occurs, auto-repaired | 100% repair success rate |
| `blocking` | Scientific design gap cannot be auto-resolved | Correctly identify and prompt user |

## Execution Truth Invariant

```
run_tool → tool_job → artifact truth
```

The Loop Controller must consume the existing `tool_job` / `artifact` truth chain. **No second execution truth system may be created.** UI components must not manufacture a parallel state.

## Boundary Constraints

- All fixtures use `resources/built-in-plugins/deseq2/demo-data/` only (no real user data)
- All evaluations run offline (no network required)
- No credentials, API keys, or secrets in fixtures
- All paths are repo-relative (no absolute paths in fixtures)

## Historical Baseline Gaps (closed by HLE-C1 → HLE-C5)

| Gap | Owner | Closure |
|---|---|---|
| `loop_contract_not_implemented` | HLE-1 | Closed: immutable contract and SQLite ledger |
| `loop_controller_not_centralized` | HLE-2 | Closed: production Agent controller |
| `validator_registry_incomplete` | HLE-3 | Closed: real Job/Artifact validation |
| `repair_strategies_not_defined` | HLE-4 | Closed: parent/replacement repair lineage |
| `durable_recovery_ui_not_implemented` | HLE-5 | Closed: restart/history recovery and UI-101 |

## SPT-1 DAG Nodes

1. `sample-metadata-validator` — Input validation
2. `expression-qc` — Quality control
3. `deseq2` — Differential expression analysis
4. `deg-standardizer` — DEG standardization
5. `volcano-plot` — Visualization
6. `go-kegg` — GO/KEGG enrichment
7. `gsea` — Gene set enrichment analysis

## Privacy

All fixtures are marked `uses_repository_demo_data_only`. No synthetic or real user data is included.

真实产品证据使用单独的显式更新命令：

```bash
npm run harness:loop:production:update
npm run harness:loop:production
```

更新命令要求通过环境变量显式指定本地 SQLite、正常轨 Task IDs、三条验收会话、重启
LoopRun 和脱敏 Provider 报告。提交目录只保存状态、计数、hash、reason
code、相对路径和不透明 ID；不保存用户消息、文件正文、绝对路径、凭据、
endpoint、请求头或 Provider 原始响应。默认命令只读验证，绝不自动改证据。
