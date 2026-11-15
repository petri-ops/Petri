# BLOCK-450 交付索引 · DELIVERABLES

主控提示词 §7 交付包 · 任务 ID = BLOCK-450 · 2026-11-15T09:36 (+08:00)

## 一、成果产物（均已提交）

| 产物 | 路径 | 提交 | 复跑/验证命令 |
| --- | --- | --- | --- |
| task_events 唯一约束三层实现 | `core/petri-server/agent-task-store.js` | 58498ae7 / 93927db3 | `node --test --test-force-exit test/m2-db-task-events-unique.test.mjs` |
| 唯一约束契约测试（红绿） | `test/m2-db-task-events-unique.test.mjs` | 58498ae7 | 同上（3/3） |
| gate:long-task-resume 三连报告 | `acceptance/block-450/evidence/t3-longtask-resume-gate-run{1,2,3}.json` | 58498ae7 | `node scripts/m-blueprint-m2-resume-gate.mjs --check` |
| perf 基线重绑（B2） | `test/perf-baseline.json` | 58498ae7 | `npm run quality:perf` + block350 15/15 |
| knip 动态入口注册（449 自核脚本） | `knip.json` | 04ac52c0 | `npm run quality:knip:check` |
| code-size 台账重打 | `acceptance/block-92/size-baseline.json` | 93927db3 前 | `npm run gate:code-size` |

## 二、canonical 回写（同批）

- `docs/block-450-m2-tails-unique-constraint-plan.md`（计划 + §8 收口）
- `docs/DOC-REGISTRY.json`（BLOCK-450 → completed）
- `docs/AUDIT-LOG.md`（head + 🔵 翻态 + ✅ 处理记录行）
- `docs/next-steps-roadmap.md` / `docs/project-workspace-handoff.md`
- `docs/m-blueprint-2026-11-11-program.md`（M 台账增量行：M2-4-db→done、M2-live=BLOCK-449 闭环）
- `docs/README.md`（入口 446 翻态）

## 三、证据索引

| 阶段 | 文件 |
| --- | --- |
| S0/S1/S2 | `s0-fact-baseline.json` / `s1-requirement-matrix.json` / `s2-plan.json` |
| S3 | `s3/task-T{1,2,3,4}.json` |
| S4/S5 | `s4-verification-report.json` / `s5-decision-log.json` |
| 收口 | `CLOSEOUT.md` / `DELIVERABLES.md` |
| 证据 | `evidence/t3-longtask-resume-gate-run{1,2,3}.json`、`evidence/t3-closeout-full-run{1,2}.log` |

## 四、完整性 / 一致性 / 可交付性结论

- **完整性 PASS**：R1–R4 全 `done`；零 in_progress；未达项（P6 external）带 terminal + closureCondition。
- **一致性 PASS**：七处对账一致（docs:check 588 PASS 当次）；M2/M7 原档零改写；计数当次复算（jev×0/344、gate 三连、契约 3/3、邻域 16/16、副本 4 组/4863 行）。
- **可交付性 PASS**：closeout:full ×2 全绿在册；边界声明在册；五类证据未互冒充。

## 五、未达项补腿表

| 项 | terminal | closureCondition | 证据 |
| --- | --- | --- | --- |
| P6 pressure 腿重采 | external-blocked | r-enrichment bundle 分发恢复 → p6:update → closeout:full | s0 probeTimeline（2026-11-15T07:37:08Z 404） |

## 六、决策留痕

`npm run decision:session` 当次 = **jev×0 本轮增量 · 累计 344**（Jev 云端不可达，零调用如实登记）；`next:suggest` 同因兜底单一建议（候选首项）。全程决策 6 条见 `s5-decision-log.json`。

G0 开发期常态 · 不外推 packaged/Provider/GA。
