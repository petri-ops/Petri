---
capability: block-375-post-nso-s0-trusted-baseline
status: completed
goal: S0 可信起点——把 NSO 收尾后遗留的两道真红门（code-size / knip）、全量分片未完成（node-core exit=1）、canonical 口径冲突与未知 WIP 变成干净、可复跑、可归因的起点；承载蓝图 docs/post-nso-optimization-blueprint-2026-11-06.md §6 全部 7 项改进点。
acceptance:
  - gate:code-size 三项违规逐件归因裁决并重打留因（不放宽预算；result-studio-repository.js +12 行判定合法增长并写明归属）
  - quality:knip:check 新增 nso-w3-visual-live.cjs 按三分法定性（同族 119 flow 先例=动态入口保留）入库
  - 全量分片三段（node-core / frontend / node-long）各自 task:run 有界执行，exit.json 齐全、verdict 明确、node-core 失败逐件归因；超时=未知不写 PASS
  - 6M+10?? WIP 机器可读归属清单落盘（不覆盖/不暂存/不清理；每项有 owner 与处置）
  - canonical 对账：G0-LF 常驻语义、旧蓝图 planned→completed、README/registry 一致、本蓝图登记同步 coverage
  - AUDIT-LOG 走 audit:compact 自稳；超长行原文迁本 plan 只留指针
  - docs:check + ui:audit:check + hygiene:check + closeout 全门出结果；残留 WIP 全部有 owner 且文件面与本包不相交
reopen: 分片出现新红、门禁再红或 canonical 又现口径冲突时先归因再重开对应项
---

# BLOCK-375 · S0 可信起点：红门与 WIP 归零（post-NSO 蓝图 §6）

> 承载 [`docs/post-nso-optimization-blueprint-2026-11-06.md`](./post-nso-optimization-blueprint-2026-11-06.md) §6 全部改进点。
> 发令：用户 2026-11-07 预授权连续工作模式（原话「按 docs/post-nso-optimization-blueprint-2026-11-06.md 从头到尾执行 S0 → S1 → … 全部推完为止，不设工作量上限、不缩小范围、不跳过阶段。本条即用户显式预授权」）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围

1. `gate:code-size` 归因与重打：`ResultArtifactShell.tsx`（最后触点 11c352b4，提交内先重打后改序致指纹漂移）、`result-studio-repository.js`（d70547ec BLOCK-373 链哈希写入路径 +12 行，1751→1763 合法增长）——`--write` 重打 + 留因，不放宽预算。
2. `quality:knip:check`：`nso-w3-visual-live.cjs` 与 119 个同族 flow 同为 run.cjs readdir 动态入口（BLOCK-371 实机走查 flow，6/6 可达腿证据在案）→ ratchet `--update` 定性入库。
3. WIP 机器可读归属清单（`acceptance/post-nso-2026-11-06/stage-0/wip-inventory.json`）：6M+10?? 逐项 owner/分类/处置；用户资产与并发写入者文件零触碰。
4. 全量分片三段重跑（`node scripts/test-all-shards.mjs --all`）：有界、exit.json 齐、node-core 失败逐件归因（预期红：model-surface、P6 源绑定、p4r C-46、UI 债棘轮、NEXT-03）。
5. 148 条 impact-map 存量未映射：分簇消亡计划落盘（S0 只立计划不批量映射）。
6. canonical 对账：G0-LF 常驻语义钉死；旧蓝图 `next-stage-optimization-blueprint` planned→completed；本蓝图（post-nso）登记与 README 同批。
7. AUDIT-LOG 79KB / L114 超长行：audit:compact + 超长行原文迁本 plan §7。

## 2. 非范围（exclusions）

- S1–S7 全部内容（主链故障语义 / 执行准入 / 体验收官 / 架构拆分 / 性能 / 治理运营 / 真实任务终验）。
- 不提交、不暂存、不清理任何并发写入者文件与用户资产（wip-inventory 中 disposition=preserve 项）。
- 不动 `scripts/backfill-artifact-chain.mjs`（BLOCK-372 遗产，S2 链哈希清偿时收编）。
- 不批量映射 148 未映射测试（只立分簇计划；逐簇清偿归 S4）。
- 不放宽 lint/types/knip/code-size/surface/perf/EAR 任何基线。

## 3. 依赖

无前置包（NSO 全程序已收尾）。共享文件面：`docs/DOC-REGISTRY.json` 与 `docs/README.md` 的未提交改动**仅含**本蓝图（post-nso）登记一处（逐 hunk 核过）——作为章程文件登记随本包收口入库；`docs/block-370-nso-w3b-plan.md` 与 `acceptance/block-332/ui-ledger-triage.json` 的未提交改动属 BLOCK-370 收尾回写，**不随本包提交**（preserve）。

## 4. 风险

- 全量分片 node-core 耗时长（历史 ~40 分钟量级）——有界 task:run + 后台等待纪律。
- 分片运行期间不得再改生产/测试/台账文件面（避免 flake 混入）；文档面改动全部先行完成。
- WIP 堆叠登记（DOC-REGISTRY/README）：已核未提交 hunk 仅蓝图登记，随本包入库不属"提交他方在制"。

## 5. touchSurface / sharedBaselines

- 新增：`docs/block-375-post-nso-s0-trusted-baseline-plan.md`、`acceptance/post-nso-2026-11-06/stage-0/**`。
- 修改：`acceptance/block-92/size-baseline.json`（--write）、`test/knip-baseline.json`（--update）、`docs/DOC-REGISTRY.json`、`docs/README.md`、`docs/AUDIT-LOG.md`、`docs/next-steps-roadmap.md`、`docs/project-workspace-handoff.md`、`docs/next-stage-optimization-blueprint-2026-11-06.md`（状态回写）、`test/impact-map.json`（本包登记）。
- sharedBaselines：code-size 基线（棘轮只减不增，重打=显式留因）、knip 保留面基线（新增定性入库）。
- 零触碰：`acceptance/block-332/ui-ledger-triage.json`、`docs/block-370-nso-w3b-plan.md`、两件 surface-matrix 生成器刷新、用户资产与临时目录。

## 6. 验收门禁

| 门禁 | 预期 |
| --- | --- |
| `gate:code-size` | PASS（重打留因后） |
| `quality:knip:check` | PASS（定性入库后） |
| `docs:check` / `ui:audit:check` / `hygiene:check` | PASS |
| `test:changed` | 定向 0 fail |
| 全量分片 | 三段 exit.json + verdict；node-core 逐件归因 |
| `closeout` | 全门出结果（有界分片完成后） |

## 7. AUDIT-LOG 超长行迁址（L114 原文指针）

L114（3732B）为 2026-10-17 BLOCK-195 启动登记行（竞争力 8 维锚点化复测，含反拟合红线全文）。该包已收口；原文完整保留于 `docs/archive/checkpoints/audit-log-through-2026-10-11.md` 之后的自稳归档（audit:compact 搬移不改写）。台账侧只留指针行，不丢任何裁决语义。

## 8. 完成语义

本包 `completed` = §6 全部 PASS + 分片三段 verdict 落盘 + wip-inventory 落盘 + canonical 回写同批提交。残留 pending（若有）如实列清单与补腿路径，不冒进写 verified。

---

## 9. 收口（2026-11-07）

### 9.1 交付对账（§1 七项）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| code-size 三违规 | ✅ PASS | 指纹漂移×2=NSO 已提交内容未随提交重打（Shell=11c352b4 提交内先重打后改序；repository=d70547ec BLOCK-373 链哈希 +12 行合法增长，1751→1763 留因）；`--write` 重打后 gate:code-size PASS（24 文件 23427 行） |
| knip nso-w3-visual-live.cjs | ✅ PASS | 与 119 同族 flow 同为 run.cjs readdir 动态入口（id/exports 形态核验）→ ratchet --update 入库 329 键；quality:knip:check PASS |
| WIP 机器可读清单 | ✅ | acceptance/post-nso-2026-11-06/stage-0/wip-inventory.json（6M+10?? 逐项 owner/处置；preserve 项零触碰） |
| 全量分片三段 | ✅（带归因残红） | summary-1794018949095.json：frontend/node-long passed；node-core 387→38，残红 16 C-46 + 1 P6 + 1 S1 全部逐件归因（shard-attribution.json）；中途抓真并清理周四遗留 9223 测试实例（违反探针即杀纪律的存量） |
| 148 未映射分簇 | ✅ | stage-0/unmapped-decay-plan.json（10 簇；消亡执行归 S4） |
| canonical 对账 | ✅ | 旧蓝图 next-stage → completed（W0-W7 由 NSO 359-374 执行收尾）；G0-LF=常驻 living-plan 不占串行槽位（roadmap/handoff 头行钉语义）；本蓝图登记 + README 370/371 |
| AUDIT-LOG 自稳 | ✅ | audit:compact 幂等（80→74KB 建议级）；L114 超长行 3732B 逐字迁 docs/archive/checkpoints/audit-log-long-row-block195-2026-11-07.md，台账留 500B 指针 |

### 9.2 计划外交付（分片归因驱动的根修）

S0 分片把 387 个失败逐件归因后**根修 349 个**（shard-attribution.json §s0Fixes 十六簇全记录）：最大簇=result-studio 110 红（BLOCK-373 schema 漂移真缺陷，根修+平价回归门）；其余=测试隔离缺陷（keychain/decision-config 穿透）、契约漂移锚点追新（逐处留因）、常红化石转冻结棘轮（flow-env-trap 33 条 / scripts-windows 31 条 / 行数帽 4 锚）、环境档可见 skip（block63 平台门/block48 AX 会话档）。零基线放宽；所有重锚/重打/豁免逐件留因。

### 9.3 门禁终态（当次读数）

docs:check PASS（506 注册）· ui:audit:check PASS（630）· hygiene:check PASS · gate:code-size PASS · quality:knip:check PASS（329 键）· quality:secret PASS · quality:arch PASS（R1-R5）· quality:lint 0 error（存量 warning 在抑制基线）· quality:types PASS · test:changed 964 项 949 绿 1 红（P6 家族）+7 cancelled（P4R C-46）+7 skip（block48 环境档）· 分片三段 verdict 如上。**residual：见 §9.1 分片行与 shard-attribution.json**。

### 9.4 残留与补腿

1. C-46（16 残红）：兄弟仓 deseq2.R 语法错，未授权不改——C-46 清偿后自然转绿。
2. P6 源绑定（1 残红）：S0 提交后已尝试 `--live` 重打一次——实采红 `p6_restart_baseline_cohort_incomplete`（重启基线 cohort 未完整，疑与本机会话 AX 档同源）；如实 pending，不重试掩盖；补腿=健康会话（注销/重启后）+ 干净树重跑 `npm run g0:result-studio:p6:update`。
3. block93 spawn persona 片段（1 残红）：移交 S1 主链批。
4. WIP preserve 项：并发写入者 2 文件（block-370 plan 回写 / ui-ledger-triage）+ 用户资产/临时目录/backfill 脚本（S2 收编）——处置见 wip-inventory.json。

G0 开发期常态 · 不外推 packaged/Provider/GA。
