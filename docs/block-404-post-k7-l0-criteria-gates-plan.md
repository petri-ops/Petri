---
capability: block-404-post-k7-l0-criteria-gates
status: active
goal: 执行第五轮优化程序 L0（判据校准与可信起点）：先解「会保护债务的反向门禁」「会假绿的判据」「会漏报 WIP 的状态聚合器」「并存的数字双真相」四类尺子问题，零产品行为变化。承载蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L0 的 21 条发现（L-27/28/29/30/36/37/40/43/45/54/75/76/77/82/83/84/86/87/88/89/90）。
acceptance:
  - L0-1 解反向门禁：k4-architecture「入册/固定行数/全量 entry 即判红」、K6「删除 IPC env 豁免口即判红」改读数型记录；植入三类模拟改动门禁不判红，篡改负测仍必红
  - L0-2 perf 判据重立：植入 +30% 慢样本必红；packaged_start 缺样本判红不绿；热路径文件改动后基线失配要求重采；quality:perf 连续 5 次 PASS 且读数落当次证据
  - L0-3 EAR 棘轮真生效：earNow < manifest.totals.earPct 必红（植入 41% 样本验证）；当次分子分母同时报
  - L0-4 test:changed fail-closed：未登记生产文件改动 → 全量 Node/前端检查升级执行且 exit≠0；治理文档表述同步
  - L0-5 状态可信度：workspace-state 用 --no-optional-locks 兜底并标注 stat 缓存风险（构造陈旧场景必列出该 M）；AUDIT-LOG 🔵 与 registry active 机械对账（不一致 docs:check 报警）
  - L0-6 lint 台账可信：eslint -f json 机械校验 suppressions 台账（裸改 count 必红、新增违规必红）；warnings 分域基线只减
  - L0-7 尺寸门与源码扫描扩面：>700 行生产文件含 *.module.css 全量入册 + 未登记发现器（新增必红）；project-workspace.module.css 字节入册；全库 src.includes( 断言第二棘轮（新增必红、4 文件旧基线只减）
  - L0-8 数字口径单源：docs/post-k7-readings-single-source.json 由生成器当次产出（366/90、544/527、700/362/90、628=分片清单、33/34/38、用户资产对账）；backlog 头部历史快照声明；AUDIT-LOG 压回阈或如实标注；task-runs 历史残响归档
  - L0 出口：closeout 全绿（ui:audit:check 红属他方 WIP 归属，如实标注不代收口）、gate:post-h9-contracts 全绿、8 组负测「植入必红」、零产品行为变化（前后同套定向测试绿）
reopen: 蓝图 §2 对应发现锚点源码变化、门禁读数漂移或发现新增反向门禁同族断言时重开
---

# BLOCK-404 · post-K7 L0 判据校准与可信起点（第五轮优化程序第 1 阶段）

> **发令来源**：用户 2026-11-11 执行提示词授权（原话）：「依据蓝图独立完成全部优化任务，无需用户额外参与；工程判断全部下放给你并逐项留痕」「现在开始：先执行第 1 节恢复顺序与第 4 节第 1 步，然后按 L0 发令开工，逐阶段推进到 L7，全程不再向用户提问。」按 `$petri-dev-infra` 预授权连续工作模式视为有效裁决并留痕；U/E/V/W 四类边界仍不代答。
> **canonical 蓝图**：docs/post-k7-full-audit-and-blueprint-2026-11-10.md（§3 阶段归属 / §4-L0 逐项验收标准）。本 plan 不复制 90 条全文，逐项锚点以蓝图 §2 为准。
> **程序定位**：L0 是 L1–L7 的前置——尺子不准时优化会做在假问题上，且会被反向门禁判红。**本阶段零产品行为变化**（门禁/判据/治理脚本/台账属于开发设施面，不属于产品行为）。

## 1. 范围（8 个改进点 → 21 条发现）

| # | 改进点 | 覆盖发现 | 关键文件 |
| --- | --- | --- | --- |
| L0-1 | 解反向门禁（改进即判红 → 读数型记录 + 只减棘轮 + 篡改负测） | L-37, L-54(门禁面), L-44(门禁面) | scripts/lib/post-h9-k4-architecture.mjs、scripts/lib/post-h9-k6-security.mjs、相关契约测试 |
| L0-2 | perf 判据重立（冷热分离/中位最差轮/收紧容差/skipped 判红/基线绑定 host+热路径/慢样本负测） | L-27, L-28, L-30, L-87 | scripts/block350-perf-collect.mjs、scripts/block350-perf-gate.mjs、test/perf-baseline.json |
| L0-3 | EAR 棘轮真生效 | L-29, L-89 | scripts/block351-ear.mjs、scripts/lib/post-h9-k5-perf-matrix.mjs |
| L0-4 | 定向测试 fail-closed（unknown → 全量升级，exit≠0） | L-75 | scripts/test-affected.mjs、docs/document-governance.md |
| L0-5 | 状态可信度（--no-optional-locks 兜底 + 🔵/registry 对账） | L-86, L-90 | .agents/skills/petri-dev-infra/scripts/workspace-state.mjs、scripts/docs-governance.mjs、docs/AUDIT-LOG.md |
| L0-6 | lint 台账可信（-f json 机械校验 + warnings 分域只减） | L-40, L-88 | scripts/post-s7-hygiene-gates.mjs(B-31)、eslint-suppressions.json、新校验脚本 |
| L0-7 | 尺寸门与源码扫描棘轮扩面 | L-36, L-43 | scripts/code-size-ledger.mjs、acceptance/block-92/size-baseline.json、scripts/silent-catch-ratchet.mjs + 新发现器 |
| L0-8 | 数字口径单源 + 台账/噪声对账 | L-45, L-76, L-77, L-81, L-82, L-83, L-84 | docs/post-k7-readings-single-source.json（新）、生成脚本、docs/pending-work-backlog.md、.petri-dev-user-data/task-runs、test/user-asset-guard-baseline.json |

## 2. 非范围（exclusions）

- **不修 L-54 的安全行为面**（豁免口机制重设计/channel 白名单）：L0 只解「改进即判红」的门禁面，行为面若需改动归 L1 安全阶段（零行为变化红线）。
- **不动在制 WIP** `frontend/src/pages/project-workspace.module.css`（11+/9−，BLOCK-395 B-11 owner 面零触碰、不代改/不代 stage/不代提交）；`ui:audit:check` 的红如实归属，不为过门改台账或删文件。L0-7 对该文件的「入册」是**只读计量登记**（把当前行数/字节写进基线冻结），不修改文件本身。
- **不触碰 10 项 untracked 用户资产/临时目录**（清单见执行提示词 §3；对账只读）。
- **不改产品运行时行为**：core/、src/、frontend/src 的产品代码零改动（测试与脚本面除外）；零新增依赖。
- **不改既有用户裁决**（ADMISSION observe、FK OFF/ON、RS-P7 deferred、MCP 计量 retain-with-reason）。
- **不回写第四轮蓝图原件** docs/post-h9-optimization-blueprint-2026-11-10.md（未跟踪用户资产，registry 已 planned）；旧读数作废只落在单源 JSON 与本 plan。
- **不做 G1+**（Provider/公证/GA/远程发布/dist staleness/packaged 三轴）。

## 3. 依赖与顺序

- 对其他 L 阶段：L0 是 L1–L7 前置（L-36/37/43/44 不解锁则 L5 被判红）。
- 包内顺序：L0-1（解锁）先行 → L0-7（扩面）→ L0-2/3（判据重立）→ L0-4/5/6（fail-closed 与可信度）→ L0-8（单源与对账）→ 收口。
- 判「补丁 vs 重构」：本阶段全部是**判据/门禁脚本面的定点修正**，无「同处二次叠加」信号 → patch 形态，逐项在本 plan §4 留痕。

## 4. 证据位置与验收门

- 证据目录：`acceptance/post-k7-2026-11-10/l0/`（当次门禁读数、负测红→绿证据、单源 JSON 当次生成件）。
- 专项门：本包新增/修改的门禁脚本逐个前台跑；`npm run gate:post-h9-contracts`（185 项）必须保持全绿；`npm run test:changed` 定向；`docs:check` + `ui:audit:check` 必跑（后者红如实归属 W）。
- 负测纪律（8 组「植入必红」）：①k4 三类模拟改动不判红 + 篡改必红 ②perf 慢样本必红 ③packaged skipped 必红 ④EAR 41% 必红 ⑤test:changed unknown 必非零 ⑥state stat 缓存陈旧必列出 ⑦lint 裸改 count 必红 ⑧尺寸未登记超预算必红 + includes 新增必红。
- 红绿先行豁免声明：本阶段是判据/治理面批（HK-01 豁免类「纯类型面/治理文档批」+ 门禁负测本身即为红绿证据——每负测先证「旧门放行/新门必红」）。

## 5. 完成语义

- 逐项终态写回本 plan §6 与蓝图 gap 台账（L7 汇总）；`completed` 判定 = §frontmatter acceptance 逐条有当次证据 + closeout 全绿（W 归属项如实标注）+ 六件套回写。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6. 执行留痕（当次证据，收口时逐项对账）

| # | 状态 | 关键交付 | 证据 |
| --- | --- | --- | --- |
| L0-1 | done | k4 `:186-190` 反向门禁改读数型 + 只增即红棘轮（`cycles>12`/`knipKeys>330` 红；入册/收窄/环消亡不判红），conclusions 改 `debt-readings-recorded-improvement-allowed`；k6 `:151` 豁免口断言改布尔读数 fail-closed（删除豁免口不再判红）；契约测试同步（k4 34/34、k6 含解除负测） | test/post-h9-k4-architecture.test.mjs、test/post-h9-k6-security.test.mjs |
| L0-2 | done | 场景 `cold_start`→`warm_backend_spawn`（warm 口径如实标注，不冒充冷启动）+ `coldStartTrueLeg` 五段腿指针；gate 采样 min-of-2→**3 轮中位**；容差 warm 60→25%、packaged 80→30%；基线绑定 `scripts/lib/block350-hot-paths.mjs`（host+7 热路径文件组合 sha，collect 每次重算、gate 失配 exit 2）；skipped 默认判红（PETRI_ALLOW_SKIP=1 显式豁免并记 coverageGaps）；负测：+30% 慢样本必红 / skipped 必红 / host·coreSha 失配必红；基线重采（median 546ms，阈值 683ms） | scripts/block350-perf-{collect,gate}.mjs、scripts/lib/block350-hot-paths.mjs、test/perf-baseline.json、test/block350-perf-gate.test.mjs |
| L0-3 | done | `validateManifest` 补 `earNow < manifest.totals.earPct` 真棘轮（此前记录值只打印）；gate 输出分子分母同报；K-26 矩阵加 `ratchetManifest` 锚；负测：EAR 降至 41% 必红、分子真实增长不判红 | scripts/block351-ear.mjs、scripts/lib/post-h9-k5-perf-matrix.mjs、test/block351-ear.test.mjs（32/32） |
| L0-4 | done | `runPlan` unknown→`runUnknownFailClosed`：升级全量 `npm run test:all` + frontend `test:all`（≥1 项必执行）后返回 2（FAIL_CLOSED 覆盖缺口）；全量有红→1；治理文档 §4.5 exit-2 契约分域修订；负测：注入 fake exec 断言全量命令在场且 exit≠0 | scripts/test-affected.mjs、docs/document-governance.md §4.5、test/test-affected.test.mjs |
| L0-5 | done | workspace-state 改 `git --no-optional-locks status` + `git diff --name-only HEAD` 幽灵文件并集（仅 diff 检出时显式标「stat 缓存陈旧」）；task-runs 分档「历史残响」（running 但 startedAt>24h）；docs:check 新增 `AUDIT_LOG_BLUE_ACTIVE_MISMATCH`（🔵 声称 active 的 BLOCK 必须=registry active work-package 或行内带「不占串行槽位」历史标注）；AUDIT-LOG BLOCK-385 🔵 行补历史标注；实机构造同尺寸内容改写场景 → state 列出该 M | .agents/skills/petri-dev-infra/scripts/workspace-state.mjs、scripts/docs-governance.mjs、test/block404-l0-criteria-gates.test.mjs |
| L0-6 | done | `scripts/lint-ledger-verify.mjs`（挂 closeout 链 `quality:lint:ledger`）：空抑制表跑 eslint --format json，台账逐 file/rule **双向相等**校验（手改 count/未入账违规/收缩未 prune 全部必红）；warnings 分域只减基线 `test/lint-warnings-baseline.json`（--update 下调）；负测双向 | scripts/lint-ledger-verify.mjs、eslint-suppressions.json、test/lint-warnings-baseline.json |
| L0-7 | done | 尺寸门 v3：`discoverOversizedFiles` 生产树 >700 行全量发现入册（含 *.module.css；24→75 文件，51 个 L0 wave：行数/sha/CSS 字节棘轮，预算 enforcement 随 W5b 转正——不新增「只出不进」白名单路径）；未登记超预算 fail-closed 发现器；CSS 字节棘轮；第二棘轮 `scripts/post-k7-source-scan-ratchet.mjs`（全库 test 递归扫描 src/source 变量 includes，44 文件/129 处 = 蓝图口径 A 复现，新增必红、0 命中不拦） | scripts/code-size-ledger.mjs、acceptance/block-92/size-baseline.json、scripts/post-k7-source-scan-ratchet.mjs、test/source-scan-asserts-baseline.json |
| L0-8 | done | 数字口径单源 `docs/post-k7-readings-single-source.json`（生成器 `scripts/post-k7-readings-generate.mjs` 当场实测：impact-map 367/90、registry 547/530、tests node=710/fe=362+628 分母注记、evidence 34/11、staleReadings 四条作废记录）；backlog 头部历史快照声明 + canonical 降级（registry notes 同步）；AUDIT-LOG compact 修「只数 ✅ 行」缺陷（历史 🔵 启动行 47 条归档，80.7KB→21.9KB 压回 50KB 阈内=K-07 真闭环）；task-runs 29 条历史 status 归档 archive-2026-11/；用户资产基线 9→10 项（补第四轮蓝图原件，guard 语义不变） | docs/post-k7-readings-single-source.json、scripts/audit-log-compact.mjs、docs/pending-work-backlog.md、test/user-asset-guard-baseline.json、.petri-dev-user-data/task-runs/archive-2026-11/ |
