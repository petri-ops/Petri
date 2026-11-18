---
id: BLOCK-486
title: C-55 VIDEO-P2 素材供给与分镜审阅
kind: work-package
status: completed
phase: CLOSED
truthDomain: block486-c55-video-p2
queueAnchor: C-55
registeredAt: 2026-11-18
canonical: true
entrypoint: docs/README.md
---

# BLOCK-486 · C-55 VIDEO-P2 素材供给与分镜审阅

> 最后更新：2026-11-18（CLOSED · 一次会话完成；HK-01 22/22 + 真实腿 machine_pass + P0 sources 数据形态差异如实登记 + BLOCK ID 冲突避让留痕）
> 发令：用户 2026-11-18「开始 C-55-P2」（全自动执行、commit/push；遇新裁决点/新依赖/G1+ 停下报用户）。
> 蓝本：`acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md` §5 P2（non-canonical 规划材料，本包把它落为 canonical 工作包）。
> 前置：BLOCK-482（P0 真实成片 + VideoProjectSpec + compose_video）、BLOCK-483（P1 科学证据与质量闭环）已收口。
> 队列锚：`docs/pending-work-backlog.md` C-55；审计锚：`docs/AUDIT-LOG.md` C-55 条目。
> **编号注记**：BLOCK-484 曾由他方未跟踪 WIP `docs/block484-capability-intake-review-plan.md` 预占、该稿随后改用 BLOCK-485 并注册；本包按 BLOCK ID 唯一纪律顺延为 BLOCK-486，零触碰该 WIP 及其 485 条目。

## 1. 发令与裁决

| 项 | 内容 | 解释 |
| --- | --- | --- |
| 开工 | 用户「开始 C-55-P2」 | 显式开工令，占唯一串行槽位；单工作包串行，不启动 P3 |
| 边界 | P2 正文七项工作 + 四条出口 | 逐字对齐 §5 P2，不外推 P3 高级镜头与 3D 世界 |
| 继承裁决 | 继承 P0「TTS 默认开/外部素材允许/尽可能做好」 | 仅视频窄口；本包只读消费 P0/P1 产物，不重新授权付费/外发 |
| 零新依赖出口 | §5 P2 出口④「默认不新增外部依赖；任何新增均须裁决」 | 图像生成适配器接新服务、真实外部素材搜索属**产品级新依赖/外发**，本包不擅自引入，显式登记为待用户裁决留白 |
| 预授权 | 用户执行提示词「全自动执行、commit/push」 | 遇新裁决点/新依赖/G1+ 停下报用户；观感零代签 |

## 2. 范围（in scope）

1. **`video-storyboard.js` 纯函数能力**（`core/petri-server/helpers/`）：零新依赖，消费 VideoProjectSpec（P0 产物）：
   - `ASSET_KINDS` / `LICENSE_STATUS` 常量契约：素材种类（image/video/music/chart/svg/genui/3d_still）与授权状态（authorized/unknown/unauthorized）封闭词表；
   - `registerAsset`：单个外部素材的许可、署名、来源、许可状态登记（缺一显著标记，不静默视为已授权）；
   - `normalizeVisualSources`：图表 / SVG / Gen UI / 3D 静帧统一为镜头来源（visual.kind 归一 + provenance 保留）；
   - `replaceSceneAsset`：**一个镜头替换素材而不破坏 durationSec / captions / evidenceRefs 结构**（出口①，逐字段结构对账）；
   - `auditAssetProvenance`：**每个外部素材有授权状态与来源记录**（出口②，缺 provenance 即红/显著标记）；
   - `buildStoryboardReview`：**成片前可看、可改的分镜清单**（出口③，逐镜头 narration/visual/时长/字幕/来源投影 + 可编辑性断言）；
   - `checkAudioReplacement`：音频试听与替换契约（替换不破坏旁白时长/字幕排程）；
   - `validateStoryboardIntegrity`：完整性 fail-closed（观感 pending_human_eye 翻态即红、授权状态翻态、结构被破坏即红）。
2. **HK-01 红绿**：`test/block486-video-storyboard.test.mjs`（缺席红 MODULE_NOT_FOUND → 绿 + ≥3 类篡改负测）。
3. **真实腿证据**：`acceptance/block486-c55-video-p2/probe-storyboard.mjs` 用 P0 真实 `video-project.json` 做 sc2 素材替换 + 分镜审阅，产 `storyboard-review.json` + `audit.json`，逐字段证明时长/字幕/证据结构不变。
4. **六件套回写**：plan / DOC-REGISTRY / README / roadmap / handoff / AUDIT-LOG + 影响图登记。

## 3. 非范围（exclusions）

- **不接任何通用图像生成服务、不做真实外部素材搜索**（属产品级新依赖 + 外发，须用户裁决后另立包；本包仅做本地 provenance 登记与统一来源契约）。
- 不改 VideoProjectSpec 主链 schema、不新造 Job/Artifact/执行器、不改 compose_video 合成行为、不改 P1 video-evidence 判据。
- 不新增 npm 运行时依赖；不新造下载器；不做音频真实编码替换（只做结构层替换契约，真实音频编码属 P0 compose_video 窄口）。
- 不改 UI 组件/样式；不改 W11 Gen UI spec 引擎（其若落地仅可作分镜卡渲染面，非本包前置）。
- 观感/成片终审（`pending_human_eye`）保持 `in_progress` 零代签；科学专业性终审归人。
- 不触碰他方 WIP `docs/architecture/gateway-design.md`、`docs/pending-work-backlog.md` 的 C-56 在制行、`docs/block484-capability-intake-review-plan.md` 及任何 untracked 用户资产。
- 不外推 packaged/Provider/GA（G0 开发期常态）；不启动 P3。

## 4. 依赖与文件面

- 复用：BLOCK-482 `video-compose.js`（VideoProjectSpec 产物 `acceptance/block482-c55-video-p0/video-project.json`）、BLOCK-483 `video-evidence.js`（完整性/观感留白范式）。
- 新增生产文件：`core/petri-server/helpers/video-storyboard.js`。
- 测试：`test/block486-video-storyboard.test.mjs`。
- 证据：`acceptance/block486-c55-video-p2/{hk01-red-green.txt,probe-storyboard.mjs,storyboard-review.json,audit.json,review.md}`。
- 注册面：`test/impact-map.json`（新 rule）、`docs/DOC-REGISTRY.json`、`docs/README.md`、roadmap、handoff、AUDIT-LOG。

## 5. 验收门禁（收口逐项对账）

| 门 | 判据 |
| --- | --- |
| G1 HK-01 | 缺席红（MODULE_NOT_FOUND）+ 实现绿 + ≥3 类篡改负测 fail-closed（观感翻态 / 授权状态翻态 / 替换破坏时长字幕 / 外部素材无 provenance） |
| G2 契约 | P2 七组工作项逐项被测；四条出口逐条对账；统一来源五类 kind 归一；观感留白断言在场 |
| G3 真实腿 | 对 P0 真实 video-project.json 做 sc2 素材替换 + 分镜审阅：durationSec/captions/evidenceRefs 逐字段不变；外部素材授权状态与来源齐全；storyboard-review.json 结构合法 |
| G4 诚实 | 图像生成适配器/真实外部搜索登记为待裁决留白，不伪造已接入；观感 pending_human_eye 零代签 |
| G5 治理 | `docs:check`（既有 post-h9 红如实归属）、`ui:audit:check`、`hygiene:check`、`test:changed`、closeout 定向链 |
| G6 六件套 | plan / registry(DOC) / roadmap / handoff / AUDIT-LOG / README 回写；观感零代签 |

## 6. 完成语义

- `completed` 必须有：HK-01 绿 + 真实腿 storyboard-review/audit + 治理门禁 + 六件套回写 + commit/push。
- 观感/成片终审为 `pending_human_eye`，仅完成机器可验部分，签字槽留用户。
- 出口①②能力由规范 fixture + P0 真实工程证明；出口③以可看可改分镜清单结构证明；出口④以零新依赖 + 待裁决留白证明。
- 交付 ≠ P2 全部素材供给能力完成；本包闭环「素材登记→统一来源→镜头替换→分镜审阅→完整性」的机器可验层。P3 保持候选未启动。

## 7. 收口对账（2026-11-18）

| 门 | 结果 | 证据 |
| --- | --- | --- |
| G1 HK-01 | ✅ PASS | 缺席红 MODULE_NOT_FOUND（pass 0/fail 1）→ 绿 22/22（pass 22/fail 0）；11 类篡改负测（缺 provenance/非法授权值/未知来源 kind/替换夹带结构覆盖/目标镜头不存在/授权审计缺 provenance/license_unknown/夹带 narration 覆盖/顶层观感翻态/镜头级观感翻态/授权抬级但 provenance 缺）一律 fail-closed；`hk01-red-green.txt` 留痕 |
| G2 契约 | ✅ PASS | A–H 八组工作项逐项测试；四出口逐条对账（C0 替换不破坏结构 / D0-D2 授权来源 / E0-E1 可看可改 / H0-H1 零新依赖+待裁决留白）；统一来源五类 kind 归一 |
| G3 真实腿 | ✅ PASS | 对 P0 真实 `video-project.json`（sha256 0b51ded7…）做 sc2 素材替换 + 3 镜头分镜审阅：durationSec/captions/evidenceRefs/narration 四项 unchanged=true；storyboard-review.json + audit.json `machine_pass`、integrity=true；四出口 exitChecks 全 true |
| G4 诚实 | ✅ PASS | 图像生成新服务/真实外部搜索登记为 `pending_user_ruling` 留白，未擅自接入；P0 `sources` 字段（无 attribution/licenseStatus）数据形态差异如实登记（p0SourcesFieldCount=2），未把 title 伪装成署名；观感 `pending_human_eye` 零代签（G1/G2 专钉） |
| G5 治理 | ✅ 本包门全绿 / 既有红如实归属 | 本包绿：audit:compact/hygiene（P1 6 文件 CRLF 归一 6/6 残留 0）/ui:audit/code-size/arch-cycles/css-modules/secret/arch/lint(0 error,本包 6 warning 为 object-injection 静态告警)/types/knip(349 键,+1 本包 probe 动态入口定性入册)/user-assets/version-parity/silent-catch；定向测试 44/44（本包 22 + P1 邻域 22）；test:changed 147 项 144 pass/1 fail（既有 block464/470/477 evidence.json 未映射债务，本包用 storyboard-review/audit 非 evidence.json，贡献 0）；既有红归属非本包文件面：docs:check(post-h9 未跟踪蓝图)、post-h9-contracts 6 红(K4/K6/K-27/K-32/L0-1，P1 已登记)、test:changed evidence.json 债务；closeout 定向链 fail-fast 停 docs:check，余门单独逐项跑实 |
| G6 六件套 | ✅ PASS | plan / registry(DOC) / roadmap / handoff / AUDIT-LOG / README 回写 + 影响图 rule 登记（含 P1 邻域回归）；观感零代签 |

**编号冲突避让留痕**：BLOCK-484 被他方未跟踪 WIP 预占、该稿随后改用 BLOCK-485 并注册；本包按 BLOCK ID 唯一纪律顺延 BLOCK-486，全程零触碰他方 WIP 与其 485/490 条目。README 序号让位他方 493，本包用 494。

**Jev 建议器**：test:suggest 零建议（area_none, confidence 0.49）；doc:suggest 建议回写 planDoc（已落实于本节）；decision:session 现读 jev×0（本轮增量）。output:judge 需 --request/--output  parlance，本包收口声明为简洁对账式，不构造额外评判请求（如实标注未跑）。

**观感零代签**：`buildStoryboardReview` 顶层与镜头级 `humanReview.status=pending_human_eye` 全程未翻 verified；G1/G2 专钉此红线；成片终审归用户。

G0 开发期常态 · 不外推 packaged/Provider/GA。
