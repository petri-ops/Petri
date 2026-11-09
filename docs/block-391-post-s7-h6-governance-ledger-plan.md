---
capability: block-391-post-s7-h6-governance-ledger
status: completed
goal: 让下一个 Agent 只读「state + AUDIT-LOG + roadmap + handoff + active plan」就能恢复同一份真相——账本不再靠人肉精简，两份「最后更新」不再互相打脸，超长行按纪律迁档而不改写。
acceptance:
  - AUDIT-LOG 全行 ≤ 3072B（超长行原文迁 docs/archive/checkpoints/ 并留指针，搬移不改写）
  - 根级 lastUpdated 与 coverage.lastUpdated 由 docs:coverage 单写入者同批写；分叉由 docs:check 报警并有负测
  - backlog / registry / roadmap / handoff 的滞后注记在 H0 已逐件复核；本包复核无回弹
  - 每阶段 acceptance 目录与复跑命令在册；未跑/跳过证据如实标注
reopen: AUDIT-LOG 再出现 >3072B 行；coverage 计数或日期再次分叉
---

# BLOCK-391 · post-S7 H6 治理台账与证据运营

> 发令：用户 2026-11-09 预授权连续工作。上游 §4 H6（B-27 / B-28 / B-29 / B-30 / B-01）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 交付

| 项 | 缺口 | 交付 |
| --- | --- | --- |
| 超长行迁档 | B-27 | 全台账最长行（BLOCK-384 收口行 **10933B**）按「搬移不改写」原文迁 `docs/archive/checkpoints/audit-log-long-row-block384-2026-11-09.md`，台账原位留指针；迁后全台账最长行 **2695B**（<3072 阈值），`docs:check` 的超长行告警消失 |
| 两份「最后更新」单源 | B-28 | `docs:coverage` 同批写根级与 `coverage.lastUpdated`（单一写入者）；`docs:check` 新增 `COVERAGE_LASTUPDATED_DRIFT`（分叉即报）；契约测试 +1（分叉报错 / 对齐零 issue） |
| 账本自稳 | B-27 | `audit:compact` 仍是 closeout 首步（幂等）；本程序期间累计迁档 3 份（11-06 / 11-07 / compact-2026-11-09） |
| canonical 对账 | B-28 / B-01 | H0 已复核：POST-NSO 蓝图 → completed、backlog 349–354、BLOCK-370 plan status、README 反引号、registry 根 lastUpdated。本包复核无回弹（`docs:check` + `docs:reconcile` 0 issues） |
| 交接协议 | B-01 | 每阶段收口同批回写 plan / registry / README / roadmap / handoff / AUDIT-LOG（H0–H6 六批全部执行） |

## 2. 挂起项

| 项 | 缺口 | 状态 | 补腿 |
| --- | --- | --- | --- |
| acceptance 证据元数据（platform / command 字段） | B-29 | 部分 | 新证据已带（H0 gate-baseline / shard-summary，H5 perf-evidence 带 sourceCommit/platform/command）；历史 acceptance 不回填（改写历史证据=伪造），只在新产出强制 |
| skills manifest `sha256:null` | B-29 | 未做 | 需确认 manifest 生成器是否可算（`skills:check` 之外单批） |
| EAR 45% 目标 | B-30 | 未达（41.6%） | 只能靠分子增长（新证据入册）+ 负测守住；分母由 acceptance 文件数决定，**不缩分母**。当前 881/2117 |
| `docs:roll-index --check` 接入 closeout | B-29 | 未做 | 需先确认跨月滚动在 CI 无网络依赖；单批接入 |

## 3. 证据

| 门 | 读数 |
| --- | --- |
| `npm run docs:check` | PASS（522 registered；无超长行告警；无 lastUpdated 分叉） |
| `npm run docs:reconcile` | candidates 已逐件复核（H0 + 本包），0 validation issues |
| `test/docs-governance.test.mjs` | 19/19（含 lastUpdated 分叉负测） |
| `npm run closeout` | 17 门全绿 |

## 4. 完成语义

`completed`（四项中三项已交付、一项部分；挂起项各带补腿）。不写「EAR 达标」、不写「历史证据已回填」。

G0 开发期常态 · 不外推 packaged/Provider/GA。
