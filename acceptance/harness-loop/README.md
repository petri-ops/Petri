# HLE-0: Harness Loop Engineering Baseline

## Status: `in_progress`

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

## Known Baseline Gaps (HLE-1 → HLE-5)

| Gap | Owner | Description |
|---|---|---|
| `loop_contract_not_implemented` | HLE-1 | Loop contract (decision, repair strategy) not codified |
| `loop_controller_not_centralized` | HLE-2 | Loop controller logic scattered across components |
| `validator_registry_incomplete` | HLE-3 | Fault classification validators incomplete |
| `repair_strategies_not_defined` | HLE-4 | Repair strategies not defined for failure classes |
| `durable_recovery_ui_not_implemented` | HLE-5 | Recovery UI for blocking scenarios not implemented |

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
