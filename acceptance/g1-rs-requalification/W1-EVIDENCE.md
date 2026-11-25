# G1 首包 W1 · selection→enrichment candidate cohort 证据（2026-11-25）

> 发令：Orca bb8dddaf msg_a345c2faa02e + 阶段二收口确认 msg_a3a9e840d4c1；owner W1 语义裁决 msg_ac7093fe2a26「行」。
> 红线：单一 ChangeSet/Revision Truth、不新增第二套 enrichment 工具、不放宽 cohort 安全门、legacyAutoAdopt 默认关。
> **本证据不宣称任何资格**——`qualificationEligible:false` 是 G0 常态；RS9/P4R/P6 历史证据不冒充资格（G0 开发期常态 · 不外推 packaged/Provider/GA）。

## §1 核码真源与 patch 判定

- 核码：`result-selection-tools.js:303-408` 的 `tool_result_enrichment_from_revision` 真跑 GO/KEGG + lineage/workflowGraph，但**不接 candidate cohort**（selection_run 路径 line518 已有 `ensureChainRevisions` 样板，enrichment 路径缺）。
- 既有 Truth 能力：`core/shared-backend/result-studio-repository.js` 已有 draft→running→preview_ready→adopted 状态机、`replay_proof_source_not_adopted`、`exact complete adopted Revision cohort` 安全门（HK-01 断言在场，零放宽）。
- 治理判定：**patch（复用既有抽象），非 refactor 重写**——candidate cohort 概念已由 `ensureChainRevisions`/repository 承载，W1 只把 enrichment 路径接进既有链，不新增第二套工具、不重写状态机。

## §2 实现

- 新建 `core/shared-backend/result-enrichment-cohort.js`：纯函数 `planEnrichmentCohort({executed, legacyAutoAdopt})`，默认 `pending_candidate`（autoAdopt=false），`legacyAutoAdopt=true` 才 `legacy_auto_current`；执行失败/artifact truth 无效 fail-closed 拒绝登记候选。`requiredStages=['candidate','compare','adopt_or_revert','replay']`。
- enrichment 路径接线：回执新增 `candidateCohort`（mode/autoAdopt/legacy/requiredStages/chainPreview）；`chainPreview` 来自既有 `ensureChainRevisions`（失败不阻断，与 selection 路径同语义）。既有 runTool/current 写路径**零改动**。

## §3 HK-01 红绿先行

- `test/g1-rs-w1-candidate-cohort.test.mjs` 红 2/4（helper 缺位）→ 绿 4/4（默认 candidate/legacy 显式/fail-closed/工具数≤2/安全门在场）。
- 端到端（复用既有 fixture）：`test/result-selection-tools.test.mjs` 追加两条——默认回执 `candidateCohort.mode=pending_candidate`+chainPreview 在场；`legacyAutoAdopt=true` 回执 `legacy_auto_current`+legacy=true。全文件 17/17 绿。
- 邻域回归：`result-selection-tools` + `result-studio-context` 49/49 绿。

## §4 新旧行为差异（按 owner 要求单列提示）

1. **默认行为变化**：enrichment 回执现在带 `candidateCohort`（默认 `pending_candidate`），表达「产物应经 candidate→compare→adopt/revert→replay 才成正式当前版本」的产品语义；旧消费者忽略新字段，零破坏。
2. **实际写路径不变**：runTool 仍按既有链落 current（这是既有 dev 行为，不是新引入的自动 adopt）；W1 未改 repository 写语义，`autoAdopt` 是回执语义标记而非额外写操作。要真正让 candidate 需显式 adopt 才能 current，属 W1 后续「candidate 落库与 adopt 门接线」的子步——**本步先建立语义与可观测契约，不假装已完成产品行为切换**。
3. `legacyAutoAdopt=true` 显式开关保留旧 dev 行为标记（默认关）。

## §5 边界与后续

- 零新依赖、零新 enrichment 工具、cohort 安全门零放宽、owner dev 实例零触碰、观感零代签（无 UI 呈现改动）。
- W1 后续子步（candidate 实际落库 + compare/adopt/revert 产品 UI + task-bound replay trace）与 W2（heatmap/affected-subgraph）按串行后续发令；W4/W5 外部真值挂账维持。
- push 等放行；本包不翻任何资格状态。

## §6 门禁（2026-11-25）

- HK-01 W1 4/4、selection 邻域 17/17、RS 回归 49/49（含 result-studio-context）；types 0 红、lint 0 error。
- `code-size` 定向重打 `result-selection-tools.js` 706→742（+36 行留因，owner 裁决 msg_ac7093fe2a26）；WorkspaceFilePreview 他方 WIP 红如实归属零触碰。
- 零新依赖、零新工具、cohort 安全门零放宽（HK-01 断言 repository 既有门在场）。
