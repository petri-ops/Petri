---
id: BLOCK-487
title: C-55 VIDEO-P3 高级镜头（本地 SceneSpec v1 3D 镜头替换）
kind: work-package
status: completed
phase: CLOSED
truthDomain: block487-c55-video-p3
queueAnchor: C-55
registeredAt: 2026-11-18
canonical: true
entrypoint: docs/README.md
---

# BLOCK-487 · C-55 VIDEO-P3 高级镜头（本地 SceneSpec v1 3D 镜头替换）

> 最后更新：2026-11-18（P3-LAUNCH · 用户裁决整包收窄后立项；HK-01 先行，未收口）
> 发令：用户 2026-11-18「开始 C-55-P3」；经一轮「停下报用户」后用户 2026-11-18 裁决口令逐字：
> 「按建议裁决 C-55-P3：①不引新依赖/不接云生成，高级镜头用本地 SceneSpec v1 3D 镜头，文生/图生视频 deferred；②零预算零付费；③全本地不外发；④沿用 SceneSpec v1 additive 扩展，不建第二套真值；⑤不碰资格线/G1+，观感零代签。按此立项开工。」
> 蓝本：`acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md` §5 P3（non-canonical 规划材料，本包按裁决把它收窄后落为 canonical）。
> 前置：BLOCK-482（P0）、BLOCK-483（P1）、BLOCK-486（P2）已收口；U-3D-D1~D5 已 2026-11-18 批量裁决；BLOCK-459/460 SceneSpec v1 additive `joints[]` 探针已收口。

## 1. 发令与裁决（收窄边界）

P3 正文原列五组工作项。裁决把它们收窄为「本地确定性高级镜头」一档，其余 deferred：

| P3 正文工作项 | 本包处置 | 依据 |
| --- | --- | --- |
| 按镜头接入文生视频、图生视频 | **deferred**（登记不实现，云生成服务=产品级新依赖+外发） | 裁决①②③ |
| 复杂相机运动、角色动画、物理和粒子 | **deferred**（同上；本地确定性镜头只做相机/关节参数引用） | 裁决①③ |
| 三源几何资产与 Scene IR 归一 | 复用既有 `SceneSpec v1`（`scene3d/v1` + additive `joints[]`），只读消费、不建第二套真值 | 裁决④ |
| 生成结果质量门禁、失败降级与证据链 | 本包实现（source/params/verification 三要素齐全，缺即 fail-closed） | 出口③ |
| 高成本镜头缓存、重试、版本比较 | **deferred**（零预算/无高成本镜头） | 裁决② |

## 2. 范围（in scope）

1. **`video-advanced-shot.js` 纯函数能力**（`core/petri-server/helpers/`）：零新依赖，只读消费 VideoProjectSpec / SceneSpec v1：
   - `registerAdvancedShot`：本地 SceneSpec v1 3D 镜头登记（来源 specRef / 参数 / 验证证据三要素，缺一显著标记；云 producer / 付费 / 外发字段出现即 fail-closed 拒绝）；
   - `mapSceneSpecV1`：把既有 `SceneSpec v1` 归一为高级镜头 specRef 引用（joints 字段校验、rest `value=0` 校验、别名登记、不内嵌第二套 IR）；
   - `replaceSceneWithAdvancedShot`：**出口①**——把普通镜头替换为本地 3D 高级镜头，`durationSec / captions / evidenceRefs / narration` 与顶层 `timeline` 逐字段不变；
   - `checkReplaceability`：**出口②**——换 producer / 换 renderer / 加领域三类可替换判据在 3D 域内保持；
   - `buildGenerationEvidence`：**出口③**——source / params / verification 三要素齐全且 digest/verdict 非伪造；
   - `validateAdvancedShotIntegrity` + `buildAdvancedShotReview`：完整性 fail-closed + 三出口逐条 exitChecks。
2. **HK-01 红绿**：`test/block487-video-advanced-shot.test.mjs`（缺席红 MODULE_NOT_FOUND → 绿 + ≥3 类篡改负测）。
3. **真实腿证据**：`acceptance/block487-c55-video-p3/probe-advanced-shot.mjs` 对 P0 真实 `video-project.json` 的 sc2 做本地 3D 高级镜头替换，产 `advanced-shot-review.json` + `audit.json`，四出口 exitChecks 全 true。
4. **六件套回写**：plan / DOC-REGISTRY / README / roadmap / handoff / AUDIT-LOG + 影响图登记。

## 3. 非范围（exclusions）

- 不接任何文生视频 / 图生视频 / 云生成服务、不引任何新依赖、不产生任何付费或外发调用（裁决①②③）；deferred 项只登记不实现。
- 不做角色动画 / 物理 / 粒子 / 高成本镜头缓存重试版本比较（裁决收窄 + 正文 deferred）。
- 不改 VideoProjectSpec 主链 schema、不新造 Job/Artifact/执行器、不改 compose_video / video-evidence / video-storyboard 行为。
- 不建第二套场景真值：SceneSpec v1 additive `joints[]` 是唯一 IR 落点；`specRef` 只引用不内嵌（裁决④ + 3D charter §3.2）。
- 不碰 Result Studio 资格线与 G1+；观感 / 成片终审 `pending_human_eye` 保持 `in_progress` 零代签（裁决⑤）。
- 不触碰他方 WIP：`docs/architecture/gateway-design.md`、`docs/pending-work-backlog.md` 的 C-56 在制行、`docs/block490-capability-intake-review-plan.md` 与任何 untracked 用户资产。

## 4. 依赖与文件面

- 复用：BLOCK-482 P0 产物 `acceptance/block482-c55-video-p0/video-project.json`；BLOCK-459/460 探针实测 `acceptance/block-459/{PROBE-REPORT.md,SHA256SUMS.txt,scene-ir-v0-draft.md}`。
- 新增生产：`core/petri-server/helpers/video-advanced-shot.js`（零新依赖）。
- 测试：`test/block487-video-advanced-shot.test.mjs`。
- 证据：`acceptance/block487-c55-video-p3/{hk01-red-green.txt,probe-advanced-shot.mjs,advanced-shot-review.json,audit.json,review.md}`。
- 注册面：`test/impact-map.json`、`docs/DOC-REGISTRY.json`、`docs/README.md`、roadmap、handoff、AUDIT-LOG。

## 5. 验收门禁（收口逐项对账）

| 门 | 判据 |
| --- | --- |
| G1 HK-01 | 缺席红 MODULE_NOT_FOUND → 绿 + ≥3 类篡改负测（观感翻态 / 云生成被接受 / 付费外发字段 / 第二套 IR / 结构被破坏）fail-closed |
| G2 契约 | P3 收窄工作项逐项被测；三出口逐条 exitChecks；deferred 清单断言在场 |
| G3 真实腿 | P0 真实工程 sc2 替换为本地 3D 高级镜头：四字段不变 + timeline 不变 + 三判据 true + 证据三要素齐全 + integrity ok |
| G4 诚实 | 文生/图生视频/角色/物理/粒子/高成本缓存登记 deferred 不伪造已接入；BLOCK-459 `mapping-verdicts.json` 机械扫描 gap 与 PROBE-REPORT 实测可行的形态差异如实登记，不伪造 direct verdict；观感零代签 |
| G5 治理 | `docs:check`（既有 post-h9 红如实归属）、`ui:audit:check`、`hygiene:check`、`test:changed`、closeout 定向链 |
| G6 六件套 | plan / registry(DOC) / roadmap / handoff / AUDIT-LOG / README 回写 + 影响图 rule 登记 |

## 6. 完成语义

- `completed` 必须有：HK-01 绿 + 真实腿 review/audit + 治理门禁 + 六件套回写 + commit/push。
- 观感 / 成片终审为 `pending_human_eye`，仅机器可验层完成，签字槽留用户。
- 交付 ≠ P3 全部高级能力完成；本包闭环「本地 3D 高级镜头登记→SceneSpec v1 引用→替换不改主干→三判据→证据链→完整性」的机器可验层。文生/图生视频等 deferred 项仍待后续裁决。

## 7. 收口对账（2026-11-18）

| 门 | 结果 | 证据 |
| --- | --- | --- |
| G1 HK-01 | ✅ PASS | 缺席红 MODULE_NOT_FOUND（fail）→ 绿 26/26（pass 26/fail 0）；判据校准 2 处（specRef 用 SceneSpec.id 对齐 / free→floating 别名=信息性不阻断）不放松任何 fail-closed 阻断项；`hk01-red-green.txt` 留痕 |
| G2 契约 | ✅ PASS | A–G 七组逐项测；三出口 exitChecks 逐条对账；A2 deferred 清单六项全 `deferred_user_ruling`、A3 五条约束断言在场；负测覆盖观感翻态/deferred 提升/第二套 IR/云字段/付费外发/posed 导出/非 scene3d/v1/结构覆盖/目标不存在 |
| G3 真实腿 | ✅ PASS | `probe-advanced-shot.mjs` exit=0 `machine_pass`；对 P0 真实 `video-project.json`（sha256 0b51ded7bdb7…）sc2 替换：durationSec/captions/evidenceRefs/narration/timeline 五项 unchanged=true；三判据（producer/renderer/domain）全 true；证据三要素全 true；三出口 exitChecks 全 true；integrity ok；p0sha 与真源 GLB sha256 `2e803be355e9…` 在 audit.json 在册 |
| G4 诚实 | ✅ PASS | 文生/图生视频/角色/物理/粒子/高成本缓存登记 `deferred_user_ruling` 不伪造已接入；云/付费/外发字段 fail-closed（B2/B3 + G3 专钉）；BLOCK-459 `mapping-verdicts.json` 六行全 gap 与 `PROBE-REPORT.md` 4direct/2convert 形态差异如实登记（audit.formDiscrepancy），未伪造 direct verdict；观感顶层与镜头级 `pending_human_eye` 零代签 |
| G5 治理 | ✅ 本包门全绿 / 既有红如实归属 | 本包绿：audit:compact/hygiene（含换行/符号链接/控制字节全 PASS）/ui:audit:check（642 编号历史）/test:changed（151 项 148 pass/1 fail(既有 debt)/2 skip，本包 BLOCK-487 测试 pass）/quality:secret PASS/quality:arch PASS(R1-R5)/quality:lint 0 error(2454 warning 为存量抑制基线)/quality:types 0 红/quality:knip:check PASS(350 键冻结,+1 本包 probe 动态入口定性入册)/gate:code-size PASS/gate:arch-cycles PASS(12 存量环无新环)；closeout 聚合链 fail-fast 停 docs:check 的既有红 `DOCUMENT_MISSING docs/post-h9-optimization-blueprint-2026-11-10.md`（HEAD 已注册但未跟踪，非本包文件面，P0/P1/P2 已登记），其余门单独逐项跑实；docs:coverage 重算 documentCount=641/managedMarkdown=623 消除本包新增 plan 引起的计数漂移 |
| G6 六件套 | ✅ PASS | plan / registry(DOC BLOCK-487 completed) / roadmap / handoff / AUDIT-LOG（头部+待处理表双记）/ README（序号 495）回写 + 影响图 rule（block487-c55-video-p3，含 P2 邻域回归）+ knip 基线定性入册；观感零代签 |

**编号唯一性**：全仓递归扫描 docs+acceptance，BLOCK-487 无 docs 提及、无注册占用（486=P2、490=capability-intake 已占），择 BLOCK-487 为本包唯一 ID；README 序号 495（避开他方 490 评审稿 493、P2 494）。

**Jev 建议器**：test:suggest 零建议（docs_or_evidence_only，规划时点仅他方 WIP 文档改动）；doc:suggest 建议回写 planDoc（gate 0.5/value 0.76，已落实于本节）；decision:session 现读 jev×0（本轮增量）。output:judge / next:suggest 见交付说明。

**观感零代签**：`buildAdvancedShotReview` 顶层与镜头级 `humanReview.status=pending_human_eye` 全程未翻 verified；G1/G2 专钉此红线；成片/镜头终审归用户。

G0 开发期常态 · 不外推 packaged/Provider/GA。
