# NSO Wave-0 证据目录（BLOCK-359 · 2026-11-06）

> 蓝图：`docs/next-stage-optimization-blueprint-2026-11-06.md` §3（W0）。plan：`docs/block-359-nso-w0-plan.md`。
> 命令环境：darwin-arm64 / Node v24.16.0 / main@fe44fceb 工作树（含 WIP，三面清单见 `wip-inventory.json`）。

| 文件 | 内容 | 生成命令 |
| --- | --- | --- |
| `wip-inventory.json` | HEAD↔WIP 三面清单（27 M + 13 ??，归属 + 零触碰纪律 + attributedReds） | W0-2 逐文件 diff 审读落盘 |
| `baseline-adjudications.json` | ADJ-1~5 五项显式裁决 + DEF-1 parseCsv 缺陷修复 + attributedUnresolved | W0-5/7/8 落盘 |
| `perf-run-1..5.log` | quality:perf 连续 5 次 PASS（4 绿 / 0 红 / 0 skip，exit=0 ×5） | `npm run quality:perf` ×5 |
| `full-test-shards/summary-*.json` | 三段分片有界执行汇总 | `npm run test:all:sharded` |
| `full-test-shards/triage-node-core.json` | 全量分片四类归因台账（WIP 绑定/C-46/环境缺失/存量红）+ 并行挂起发现 | 本批落盘 |

## 全量分片结果（有界 · 串行 · exit.json 在 task-runs/<id>.status.json）

| 分片 | 结果 | 明细 |
| --- | --- | --- |
| node-core（628 文件，5081 测试） | exit=1 | 4979 绿 / 44 红 / 24 取消 / 34 跳过——四类归因见 triage（HEAD 平面新增真红=0；红=4 WIP 绑定 + 14 C-46 + 25 环境缺失 + 存量红，逐件见台账） |
| frontend（356 文件，2539 测试） | exit=1 | 2538 绿 / 1 红 = computer_close 前端镜像缺词——本批补齐后 26/26 复测绿 |
| node-long（6 文件 live/e2e/soak/perf） | **exit=0 全绿** | — |

**过程发现**（已入 triage）：①node --test 默认并行在 627 文件规模三次确定性挂起（父进程 100% CPU 零子进程零句柄）→ 分片默认串行绕过，登记 W6；②评估会话 `eval-full-tests` SIGTERM 遗留孤儿 node --test 空转 16 小时，本批清理——W6 teardown 级联回归实证。

## 定向契约红绿记录（HK-01）

| 契约 | 红（修复前） | 绿（修复后） |
| --- | --- | --- |
| block350-perf-gate 双判据 | 新增 4 条中 1 红（噪声地板用例 36ms 判红） | 10/10 |
| block131 引号 CSV | 新增 2 条全红（sample_column_missing 误报） | 9/9 |
| block359 分片契约 | 首版 plan 含 generatedAt + 顶层 main() 误执行（红） | 3/3 |
| tool-activity-labels computer_close | fixture 缺键红（单源化抓真 BLOCK-345 遗漏） | 5/5 |
| block116 / block157 | 硬编码 114 红 | 23/23 |
| domain-neutrality deseq2 | FederationJobs ×2 红 | 3/3 |
| script-entry-guard | 3 个脚本 `file://${argv[1]}` 形态（1 新 + 2 存量） | 1/1 |
| modelConfigAndCollapse | lint 2 errors（no-unnecessary-type-assertion 与 tsc 互斥） | lint 0 + tsc 0 + vitest 6/6（双断言先例 RuntimePolicyPanel.test.tsx:33 同型） |

## test:changed 当前树读数（W0 修复后）

1839 测试 / 1826 绿 / **2 红 + 7 取消（全部已归因，HEAD 平面真红=0）**：
- `block325 model-surface` → WIP 绑定（ADJ-1，W1 落地重打）
- `g0-rs-p6` → 脏树证据绑定（by-design，W1 落地后复绿）
- `p4r-invariants` ×1+7 → C-46 兄弟仓 deseq2.R 语法错（未授权不改；本仓侧 parseCsv 缺陷已修，corpus 现推进到 R 执行层实证）
