# BLOCK-487 · C-55 VIDEO-P3 高级镜头 — 收口对账（2026-11-18）

> 本文件是 acceptance 证据的对账说明，不是第二 canonical 计划。
> canonical plan=`docs/block487-c55-video-p3-advanced-shot-plan.md`。

## 1. 发令与裁决

- 发令：用户「开始 C-55-P3」（全自动、定向测试+closeout+证据+六件套+commit/push）。
- 停下报用户 → 用户裁决口令逐字收窄为「本地 SceneSpec v1 3D 镜头替换」一档，五条约束见 plan §1。
- 本包按裁决把 P3 正文五组工作项收窄：只做本地确定性高级镜头替换闭环；文生/图生视频、角色/物理/粒子、高成本缓存重试版本比较一律 `deferred_user_ruling` 只登记不实现。

## 2. 门禁对账

| 门 | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| G1 HK-01 | 缺席红→绿+≥3 类篡改负测 fail-closed | ✅ PASS | `hk01-red-green.txt`：MODULE_NOT_FOUND 红 → 26/26 绿；负测覆盖观感翻态/deferred 提升/第二套 IR/云字段/付费外发/posed 导出/非 scene3d/v1/结构覆盖/目标不存在 |
| G2 契约 | 收窄工作项逐项测 + 三出口 exitChecks + deferred 断言 | ✅ PASS | `block487-video-advanced-shot.test.mjs` A–G 七组；A2 deferred 清单 + A3 约束 + E0 三判据 + F0 三要素 |
| G3 真实腿 | P0 真实工程 sc2 替换，四字段+timeline 不变、三判据 true、证据三要素 true | ✅ PASS | `probe-advanced-shot.mjs` exit=0 `machine_pass`；p0sha=0b51ded7bdb7…；`advanced-shot-review.json` + `audit.json` |
| G4 诚实 | deferred 不伪造已接入；BLOCK-459 形态差异如实登记；观感零代签 | ✅ PASS | audit.formDiscrepancy（gapCount=6 vs 报告 4direct/2convert）；顶层与镜头级 humanReview 均 pending_human_eye；constraints.deferredState 未提升 |
| G5 治理 | docs:check / ui:audit / hygiene / test:changed / closeout | ✅ 本包门全绿 / 既有红如实归属 | hygiene/ui:audit/secret/arch/lint(0 error)/types/knip(350 键)/code-size/arch-cycles 全 PASS；test:changed 151 项 148 pass/1 fail(既有 block464/470/477 evidence.json debt)/2 skip，本包 pass；closeout fail-fast 停 docs:check 既有 post-h9 红（HEAD 已注册未跟踪，非本包面）；docs:coverage 重算消除本包计数漂移。详见 plan §7 |
| G6 六件套 | plan/registry/roadmap/handoff/AUDIT-LOG/README + 影响图 | ✅ PASS | plan completed/CLOSED；registry BLOCK-487 completed；README 495；roadmap/handoff/AUDIT-LOG 头部+表行；影响图 block487-c55-video-p3 含 P2 邻域；knip 基线定性入册；观感零代签 |

## 3. 诚实边界

1. **BLOCK-459 形态差异**：`mapping-verdicts.json` 机械扫描 `jointExtrasNodes=0`、六行 verdict 全 gap；`PROBE-REPORT.md` §3 记 4 direct / 2 convert 可行。两者形态不同，本包如实登记，**未伪造任何 direct verdict**；本包的 SceneSpec v1 引用只取真源 GLB digest（`probe-rest.glb` sha256 `2e803be355e9…`，双进程一致），不作映射结论背书。
2. **deferred 只登记不实现**：`text_to_video` / `image_to_video` / `character_animation` / `physics` / `particles` / `high_cost_cache_retry_version_compare` 全为 `deferred_user_ruling`，未接任何服务、未产生付费或外发调用。
3. **观感零代签**：成片/镜头终审 `pending_human_eye`，顶层与镜头级签字槽留用户。
4. **不建第二真值**：仅以 `specRef` 引用 SceneSpec v1，joints 映射只在内存；`ir`/`sceneIr` 内嵌字段出现即 fail-closed。
5. **G0 开发期常态 · 不外推 packaged/Provider/GA**。
