---
capability: block-385-post-s7-h0-trusted-start
status: completed
goal: 让 post-S7 蓝图 H0 的「可信起点」成立——在制包收口后重建可复跑基线、把 active 口径与 canonical 台账对平、把全量分片残红逐件归因、把影响图去重与第一批未映射消亡落地，为 H1–H7 提供干净且可复跑的起点。
acceptance:
  - npm run state 显式区分「串行槽位（work-package）」与「常驻计划（living-plan）」两层语义，AUDIT-LOG 🔵 与 registry 不再被误读为同一层
  - test/impact-map.json 规则 id 唯一，重复 id 由 validateMap 与契约测试双向 fail-closed；规则数口径由脚本可复算
  - 未映射测试棘轮按簇消亡第一批：≥7 条挂到既有域规则并同批从 baseline 删除，定向测试绿
  - 全量三段分片有当次 summary 与逐件归因；exit≠0 的每一条有族归属，unknown 不写 PASS
  - BLOCK-370 / POST-NSO-OPTIMIZATION-BLUEPRINT-2026-11-06 / backlog 349–354 / roadmap / handoff 的滞后注记逐件复核并回写，无第二 active canonical
  - 干净跟踪树（无未知 owner 的跟踪改动）上 closeout 全绿；未跟踪用户资产按 WIP 纪律零触碰并登记
reopen: 工作区出现新的未知 owner 跟踪改动；分片归因口径变化；蓝图 §1.2 门禁读数漂移
---

# BLOCK-385 · post-S7 H0 可信起点与在制收口

> 发令：用户 2026-11-09「按 docs/post-s7-optimization-blueprint-2026-11-09.md 从头到尾执行 H0 → H1 → … → H7，全部推完为止……本条即用户显式预授权，工程判断全下放主代理并逐项留痕」。
> 上游：`docs/post-s7-optimization-blueprint-2026-11-09.md` §4 H0（B-01 / B-02 / B-03 / B-21 / B-28）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 范围

| 项 | 蓝图缺口 | 本包动作 |
| --- | --- | --- |
| 两层 active 语义 | B-01 | `workspace-state.mjs` 显式输出「串行槽位 / 常驻计划」两层，并对 work-package/living-plan 档的 truthDomain 冲突当场报警；AUDIT-LOG 🔵 与 registry 关系写成输出内的固定注释 |
| 影响图唯一性 | B-21 | `validateMap` 增加重复 id fail-closed；合并同名双条 `block337-governance-runtime`（规则 357→356）；新增两条契约测试（合成重复图判红 / 提交图零重复） |
| 未映射第一批消亡 | B-21 | C5-db-migration（4 条）挂 `electron-runtime`、C9-g0-qualification（3 条）挂 `g0-baseline`；同批从 `impact-map-coverage-baseline.json` 删除（145→138）；定向测试绿 |
| 全量分片归因 | B-03 / B-21 | 三段分片当次跑，逐件归因；C-46 家族已由 BLOCK-384 清偿，重跑后确认或逐件重归因；环境档按显式 skip / 平台门归类 |
| 在制收口核验 | B-01 / B-03 | BLOCK-384 已完成（HEAD 339dd93c，registry completed）；本包只读核验其交付指针 + 复跑 p4r/deseq2/block218 四族确认残红已消 |
| canonical 对账 | B-01 / B-28 | POST-NSO 蓝图 planned→completed；post-S7 蓝图 planned→active(living-plan)；backlog 349–354 注记；roadmap / handoff 顶部恢复链刷新；registry 根 `lastUpdated` 与 coverage 对齐 |
| 干净树基线 | B-01 | 逐个判定 3 项跟踪改动的 owner 与归属：BLOCK-370 plan 的 status 回写（canonical 对账）、两件 surface-matrix 生成产物（可重生成）→ 本包提交；10 项 untracked 用户资产零触碰 |

## 2. 非范围

- 不撤销任何既有用户裁决（`workspace_exec` 默认放行 / MCP trust 与 capability token 两轴分离 / FK=ON 维持缓 / ADMISSION 维持缓 / G0 阶段纪律）。
- 不动兄弟仓（BLOCK-384 已完成，其改动在兄弟仓自身历史；本仓只复核指针）。
- 不动 10 项 untracked 用户资产与临时目录（`assets/`、`petri-logo-concepts*`、`model3d/enclosure-*.scene3d.json`、`docs/pelican-bicycle.html`、`scripts/backfill-artifact-chain.mjs`、`tmp-block342-live/`、`tmp-review/`、`acceptance/nso-2026-11-06/wave-0/full-test-shards/summary-1793978091259.json`）。
- 不新建第二套状态源：`workspace-state.mjs` 仍是 presentation layer，真值只在 registry。
- 不改任何质量基线数值（code-size / knip / lint / EAR / perf 只许按既有棘轮语义收缩）。

## 3. 依赖与风险

- 依赖：BLOCK-384 已收口（已完成）；兄弟仓 `petri-pack-bio` 在位。
- 风险 1：全量分片在 `--test-concurrency=1` 下耗时数十分钟，且历史上出现过调度层挂起（BLOCK-368）。缓解：有界超时 5400s；超时结论记 `unknown` 不写 PASS。
- 风险 2：把测试挂错域会形成假覆盖。缓解：只挂同域既有规则（`electron-runtime` 覆盖 `src/**`，`g0-baseline` 覆盖 `core/shared-backend/g0/**` 与 `test/g0-*.test.mjs`），并逐条核过被挂测试的实际 require 路径。
- 风险 3：canonical 对账跨多文档，容易出现「改一处漏一处」。缓解：改动后统一跑 `docs:check`，并把滞后项写进收口表逐条勾。

## 4. touchSurface / sharedBaselines

- touchSurface：`.agents/skills/petri-dev-infra/scripts/workspace-state.mjs`、`scripts/test-affected.mjs`、`test/impact-map.json`、`test/impact-map-coverage-baseline.json`、`test/test-affected.test.mjs`、`docs/{DOC-REGISTRY.json,README.md,next-steps-roadmap.md,project-workspace-handoff.md,pending-work-backlog.md,AUDIT-LOG.md,block-370-nso-w3b-plan.md}`、`acceptance/functional-audit-2026-11-04/surface-matrix.json`、`docs/functional-surface-matrix-2026-11-04.md`、`docs/block-385-post-s7-h0-trusted-start-plan.md`、`acceptance/post-s7-2026-11-09/h0/**`。
- sharedBaselines：`test/impact-map-coverage-baseline.json`（只减）、`test/impact-map.json`（规则 id 唯一；规则数 357→356）。

## 5. 验收与证据

- `npm run state` 输出含两层语义行与 AUDIT-LOG 分层注记。
- `node --test test/test-affected.test.mjs test/nso-w5-impact-coverage.test.mjs` 全绿；7 条迁入测试定向绿。
- `npm run test:all:sharded` 当次 summary 落 `acceptance/post-s7-2026-11-09/h0/shard-summary.json` + 逐件归因 `h0-shard-attribution.json`。
- `npm run docs:check` / `npm run ui:audit:check` / `npm run closeout` 全绿；残红逐项登记。
- 证据目录：`acceptance/post-s7-2026-11-09/h0/`。

## 6. 完成语义

`completed` 需同时满足：跟踪树干净（本包改动全部提交、用户资产按 WIP 纪律保留）、分片归因逐件终态（passed / failed-with-owner / unknown-with-reason）、canonical 无第二 active truth。未达证据的项写 `retain-with-reason` 或 `pending_*`，不得写 verified。

---

## 7. 收口（2026-11-09）

| 项 | 终态 | 证据 |
| --- | --- | --- |
| B-01 两层 active 语义 | ✅ | `workspace-state.mjs` 输出「层 1 串行槽位 / 层 2 常驻计划」两行 + AUDIT-LOG 🔵 不同层注记 + work-package/living-plan 档 truthDomain 冲突当场报警；`test/block326-audit-debt-sweep` 5/5 绿（既有 state 契约未破） |
| B-01/B-03 在制收口核验 | ✅ | BLOCK-384 已 completed（HEAD 339dd93c，registry completed）；p4r 四族复跑 21/21 绿（C-46 家族残红已消）；本包零触碰其交付面 |
| B-21 影响图唯一性 | ✅ | 同名双条 `block337-governance-runtime` 合并（规则 357→356，unique pattern `acceptance/block-337/**` 保留）；`validateMap` 重复 id fail-closed；两条契约测试（合成重复图判红 + 提交图零重复） |
| B-21 未映射第一批消亡 | ✅ | C5-db-migration×4 → `electron-runtime`、C9-g0-qualification×3 → `g0-baseline`；baseline 145→138；7 条定向复跑 32/32 绿 |
| B-03/B-21 分片归因 | ✅（带 2 条外部归属） | 基线 9 红 → 终局 3 红：7 条根修（脚本 main 守卫 / 假 sha 夹具×3 / 行数锚口径 / 矩阵产物链 / 前端负载脆弱）；2 条归属外部（FK=OFF→H1、spawn persona 专项）；1 条自伤（新 acceptance 树缺规则）当场修。证据 `acceptance/post-s7-2026-11-09/h0/` |
| B-28 canonical 对账 | ✅ | POST-NSO 蓝图 planned→completed；post-S7 蓝图 planned→active(living-plan, truthDomain=post-s7-optimization-program)；backlog 349–354 注记追平；BLOCK-370 plan status 回写；registry 根 `lastUpdated` 与 coverage 对齐；README 最新两行补反引号（ENTRY_RE 命中）+ 折叠被取代的 duplicate active 行 |
| B-01 干净树基线 | ✅（带 WIP 保留） | 3 项跟踪改动全部有 owner 并提交；9 项 untracked 用户资产/临时目录零触碰（清单=`h0/wip-inventory.json`） |
| 门禁 | ✅ | `npm run closeout` 16 门全绿（2026-11-09，干净跟踪树）；十五门逐门读数=`h0/gate-baseline.json` |
| 三段分片 | ⏸ 带归属未归零 | node-core 3 红均有 owner（2 外部 + 0 未归属）；frontend/node-long 全绿。**不写 0 未归因 fail**，如实登记为 H0 未闭合项 |

### 未闭合项与补腿条件

| 项 | 状态 | 补腿 |
| --- | --- | --- |
| knowledge-space G3（删空间→掉绑） | open → H1/B-05 | 在删除路径显式清理 `session_workspace_bindings`，不依赖 FK 开关；FK 全量切换维持缓（用户裁决） |
| spawn persona（子链 system 缺角色指令） | open → block93 专项 | 先抓真模型解析链；不属本蓝图 34 条缺口，按既有专项承接 |
| closeout:full ×3 连续 | 部分（本包 1 次 clean closeout） | 全量转义连跑 3 次归 H6 治理批（单次已绿；3 次连跑对同一提交的边际信息量低，按证据上限原则不在 H0 重复烧机） |

G0 开发期常态 · 不外推 packaged/Provider/GA。
