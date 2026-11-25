# G1 首包 W3 · historical alternative compare 与 Git consent 失效证据（2026-11-25）

> 发令 msg_678d5e6b9f88 → 裁决 msg_d8df1b1e636f「行」三项 + 勘误附加。本证据**不宣称资格**。
> canonical：UI-462（2026-10-03 owner 裁决、10-30 verified）退役自有 Git 仓库接入 > G1-READINESS 旧表述。

## §1 执行三项裁决

1. **Git consent 失效挂账**：按 UI-462 canonical 判失效，**不复活退役能力、不造已删 UI**（若将来要自有 Git 接入=推翻 UI-462 的新裁决，owner 亲裁，本包不碰）。三证链：`git-repository-binding.js:10` managed-only、`result-studio-repository.js:222` consent 表不再读写、`existing_repository_not_attached_without_consent` core 零命中 + 前端 consent UI 零命中。
2. **资格矩阵残留单列子包备料**：`P7-UI462-ALIGNMENT-DECISION.md`（四问形态：清理 `REQUIRED_ENVIRONMENTS` existing_clean/dirty_git + evidence-bundle existing 分支标注退役）。**未批前 `REQUIRED_ENVIRONMENTS` 零改动**，递 owner 拍板。
3. **勘误注记**：G1-READINESS-2026-11-24 顶部补「勘误注记（W3 核真 UI-462）」，防下一读者踩旧表述（owner 附加要求）。

## §2 W3 本体：historical alternative compare（核码 + HK-01）

- 核码：historical alternative 已有真实产品实现——`result-compare-service.js` 的 `restoreArtifactRevision` 把正式 adopted cohort 恢复为**新 commit + 新 Revision cohort**（不改写目标），回执带 `restoredFromChangeSetId`/`restoredCohortRevisionIds`/`affectedScope=historical_changeset_cohort`；门零放宽（只能从 adopted/reverted 正式 cohort 恢复，`restore_cohort_family_duplicate` 防重复 family）；RS6 机械回归已在册（`result-compare-service.test.mjs` line567+）。
- 与 W1/W2 同构：既有设施齐备，按 owner 已认可的「不造第二套」原则 **W3 不新增产品代码**，只补 HK-01 把散落契约串成可观测证据。

## §3 HK-01 红绿先行

`test/g1-rs-w3-historical-alternative.test.mjs` 3/3 绿（构建前既有设施已在场，测试即核验）：
1. historical alternative = 真 restore 新 cohort（API + 三字段 + RS6 回归断言）；
2. restore 门零放宽（adopted/reverted + never_adopted + family_duplicate 在场）；
3. Git consent 按 UI-462 失效（managed-only 声明 + W3-SCOPE-NOTE + G1-READINESS 勘误注记在场）。

邻域回归：result-compare-service + result-scientific-compare + result-studio-qualification + W1 + W2 = 44/44 绿。

## §4 边界

- 零新依赖/新工具、既有门零放宽、owner 实例零触碰、观感零代签；不翻资格；heatmap 挂账（兄弟仓）与 W4/W5 外部挂账维持；不动 `REQUIRED_ENVIRONMENTS`（待 P7 对齐子包裁决）；19 WIP/frogfish 零触碰；push 等放行。
