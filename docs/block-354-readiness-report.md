# G0 → G1 出籍就绪度报告（BLOCK-354 · 2026-11-05）

- 计划：`docs/block-354-g0-exit-criteria-plan.md`；总纲：`docs/next-phase-program-2026-11-05.md` 包 7/7
- 机械复算：`node scripts/block354-readiness.mjs` → `acceptance/block-354/readiness.json`
- 契约：`test/block354-readiness.test.mjs` 6/6（全达标 / 负测移证据 / EAR 跌破 / 恢复回升 / 红线在场 / 计划要素）

## 结论（就绪度）

**出籍就绪度 6/6 达标**（脚本零人工干预复算，2026-11-05）：

| # | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| ① | 通用任务基准达标 | ✔ | acceptance/block-348/results.json（8 任务终态+度量） |
| ② | 实机证据清偿 | ✔ | docs/block-349-clearance-report.md（A 类 13 条全终态 10V+3C） |
| ③ | 性能基线建立并入门 | ✔ | test/perf-baseline.json（四场景含 packaged 469ms）+ quality:perf ∈ closeout |
| ④ | 证据资产化 ≥40% | ✔ | EAR = 43.3%（assetized-manifest.json） |
| ⑤ | 扩展货架无未处置空壳 | ✔ | shelf-matrix.json（21 项全判定 17A/4D/0S） |
| ⑥ | packaged 回归无阻断 | ✔ | packaged-regression.json（结构+健康+T2 completed+consistent=true） |

## 宣称红线（本报告最重要的条款）

1. **出籍就绪 ≠ 已出籍**：6/6 是「G0 的出口条件已全部满足」的事实记录，不是「已进入 G1」。
2. **未达 6/6 期间**（如未来判据回归红）：不得表述 GA / Provider 矩阵 / 对外发布能力。
3. **6/6 达标后 G1 启动仍需用户显式发令**——本计划与总纲均不是 G1 授权。
4. 本报告只由 `scripts/block354-readiness.mjs` 生成，禁止手改；判据变更需显式裁决并回写计划。

## 与成熟度蓝图的关系

引用不改写：`docs/g0-agent-maturity-blueprint.md` 五层满级画像仍是 G1+ 能力画像（真实 Provider 矩阵、生态市场、i18n、hooks 等在 G1+）；本判据表只覆盖「G0 出口」= 上轮评估点名的四个价值兑现短板全部消灭 + packaged 态可复验。

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
