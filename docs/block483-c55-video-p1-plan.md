---
id: BLOCK-483
title: C-55 VIDEO-P1 科学证据与质量闭环
kind: work-package
status: completed
phase: CLOSED
truthDomain: block483-c55-video-p1
queueAnchor: C-55
registeredAt: 2026-11-18
canonical: true
entrypoint: docs/README.md
---

# BLOCK-483 · C-55 VIDEO-P1 科学证据与质量闭环

> 最后更新：2026-11-18（CLOSED · 一次会话完成；HK-01 22/22 + 真实 ffprobe/ffmpeg AV 质检 machine_pass + P0 存量数据缺口如实登记）
> 发令：用户 2026-11-18「开始 VIDEO-P1」。
> 蓝本：`acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md` §5 P1（non-canonical 规划材料，本包把它落为 canonical 工作包）。
> 前置：BLOCK-482 / C-55 VIDEO-P0（真实成片 + VideoProjectSpec + compose_video）已收口。
> 队列锚：`docs/pending-work-backlog.md` C-55；审计锚：`docs/AUDIT-LOG.md` C-55 条目。

## 1. 发令与裁决

| 项 | 内容 | 解释 |
| --- | --- | --- |
| 开工 | 用户「开始 VIDEO-P1」 | 显式开工令，占唯一串行槽位；单工作包串行 |
| 边界 | P1 正文八项工作 + 四条出口 | 逐字对齐 §5 P1，不外推 P2/P3 |
| 继承裁决 | 继承 P0「TTS 默认开/外部素材允许/尽可能做好」 | P1 不重新授权付费/外发；只读消费 P0 产物 |
| 预授权 | 用户执行提示词「全自动执行、commit/push」 | 遇新裁决点/新依赖/G1+ 停下报用户 |

## 2. 范围（in scope）

1. **`video-evidence.js` 纯函数能力**（`core/petri-server/helpers/`）：零新依赖，消费 VideoProjectSpec + AV 探针结构化读数：
   - `classifySource`：来源五档分级（官方文档/论文/权威机构/普通网页/用户材料）+ DOI/域名启发式；
   - `buildClaimEvidenceTable`：Claim–Evidence 表，逐论断定位来源原文（urlOrDoi/accessedAt/publishedAt/excerptRef），缺项显著标记；
   - `checkNumericClaims`：数字/单位/数量级换算确定性检查（相对误差 > 1e-6 即 mismatch）；
   - `detectConflicts`：同一论断多源分歧并列展示（resolution=parallel_display），不静默择一；
   - `markLowConfidence`：低置信/无来源论断显著标记；
   - `checkScienceAlignment`：画面/讲稿与论断科学语义对照，evidenceRefs 悬空即红；
   - `auditAV`：黑帧/静音/响度/音画时长/字幕溢出/编码错误六项机械质检；
   - `buildEvidenceReport` + `validateEvidenceIntegrity`：六组汇总 + 观感留白 + fail-closed 完整性。
2. **HK-01 红绿**：`test/block483-video-evidence.test.mjs` 22 项契约测试（缺席红 → 绿 + 8 类篡改负测）。
3. **真实腿证据**：`acceptance/block483-c55-video-p1/probe-evidence.mjs` 对 P0 真实成片跑 ffprobe/ffmpeg（复用系统二进制，零新依赖），产 `probe-readings.json` + `evidence-report.json`。
4. **六件套回写**：plan / DOC-REGISTRY / README / roadmap / handoff / AUDIT-LOG + 影响图登记。

## 3. 非范围（exclusions）

- 不改 VideoProjectSpec 主链、不新造 Job/Artifact/执行器、不改 compose_video 合成行为。
- 不新增引用片段采集到 P0 存量 spec（P0 数据增量属另案；本包只如实登记缺口，不伪造片段）。
- 不接通用文生视频/文生图/复杂生成镜头（P2/P3）。
- 不引任何新 npm 运行时依赖；不新造下载器。
- 不改 UI 组件/样式；观感与科学专业性终审（pending_human_eye）保持 in_progress 零代签。
- 不触碰他方 WIP `docs/architecture/gateway-design.md` 与任何 untracked 用户资产。
- 不外推 packaged/Provider/GA（G0 开发期常态）。

## 4. 依赖与文件面

- 复用：BLOCK-482 `video-compose.js`（VideoProjectSpec 产物）、系统 ffmpeg 6.x + ffprobe（P0 live-record 记录的真实路径）。
- 新增生产文件：`core/petri-server/helpers/video-evidence.js`。
- 测试：`test/block483-video-evidence.test.mjs`。
- 证据：`acceptance/block483-c55-video-p1/{hk01-red-green.txt,probe-evidence.mjs,probe-readings.json,evidence-report.json,evidence.md}`。
- 注册面：`test/impact-map.json`（新 rule）、`docs/DOC-REGISTRY.json`、`docs/README.md`、roadmap、handoff、AUDIT-LOG。

## 5. 验收门禁（收口逐项对账）

| 门 | 判据 |
| --- | --- |
| G1 HK-01 | 缺席红（MODULE_NOT_FOUND）+ 实现绿 22/22 + ≥3 类篡改负测 fail-closed（实 8 类） |
| G2 契约 | 八组工作项逐项被测；四条出口逐条对账；判据校准留痕 |
| G3 实机 | 真实 ffprobe/ffmpeg 采 P0 成片 AV 读数；evidence-report machine_pass；integrity=true；观感留白 |
| G4 诚实 | P0 存量数据缺口（无 excerptRef / sc1 无 evidenceRef）如实登记，不伪造不篡改 |
| G5 治理 | `docs:check`（既有 post-h9 红如实归属）、`ui:audit:check`、`hygiene:check`、`test:changed`、closeout 定向链 |
| G6 六件套 | plan / registry(DOC) / roadmap / handoff / AUDIT-LOG / README 回写；观感零代签 |

## 6. 完成语义

- `completed` 必须有：HK-01 绿 + 真实腿 evidence-report + 治理门禁 + 六件套回写 + commit/push。
- 观感/科学专业性终审为 `pending_human_eye`，仅完成机器可验部分，签字槽留用户。
- 出口①②能力由规范 fixture 证明；P0 存量成片因未采集 excerptRef 而 traced=0/2，如实登记为 P0 数据缺口，不冒充能力缺失、不伪造片段。
- 交付 ≠ P1 全部科学真实性保证；仅闭环「论断→来源→数值→冲突→画面→AV」的机器可验层。P2/P3 保持候选未启动。

## 7. 收口对账（2026-11-18）

| 门 | 结果 | 证据 |
| --- | --- | --- |
| G1 HK-01 | ✅ PASS | 缺席红 MODULE_NOT_FOUND → 绿 22/22；8 类篡改负测（缺 excerptRef/错误换算/冲突静默/悬空 ref/缺音轨/字幕溢出/humanReview 翻 verified/检查项矛盾）+ 黑帧·削波·编码错误样本 |
| G2 契约 | ✅ PASS | A–H 八组工作项逐项测试；四条出口逐条对账（B3/C1/D0/G1+G2）；loudness 判据校准留痕 |
| G3 实机 | ✅ PASS | 真实 ffprobe/ffmpeg 采 P0 成片：h264/1280×720/24fps、视频 22.125s/音流 22.147667s（skew 0.023s）、黑帧 0、静音 1.132s、peak -2.2dB/mean -19.1dB、字幕溢出 0、burned=true；evidence-report `machine_pass`、integrity=true |
| G4 诚实 | ✅ PASS | `probe-readings.json` 登记 2 项 P0 存量数据缺口（sources 无 excerptRef → traced=0/2；sc1 无 evidenceRef → 可见警告），未篡改 P0 产物、未伪造片段 |
| G5 治理 | ✅ 本包门全绿 / 既有红如实归属 | 本包绿：audit:compact/hygiene/ui:audit/quality:secret/arch/lint(0 errors)/types/knip(348 键定性入册)/code-size/arch-cycles/user-assets/version-parity/silent-catch；属性既有红（P0 已登记、非本包文件面）：docs:check(post-h9 未跟踪蓝图)/test:changed(block464/470/477 evidence.json)/lint:ledger test 域 419>418(本包贡献 0，production 域 1485→1484 已修回)/post-h9-contracts 6 红；closeout 定向链 fail-fast 停 docs:check，余门单独逐项跑实 |
| G6 六件套 | ✅ PASS | plan/registry(DOC)/roadmap/handoff/AUDIT-LOG/README 回写 + 影响图登记；观感 `pending_human_eye` 零代签 |

**观感零代签**：`evidence-report.json` 与 `auditAV` 的 `humanReview.status=pending_human_eye` 全程未翻 verified；HK-01 H1 专钉此红线。
**既有红归属**：post-h9 未跟踪蓝图 / test:changed 历史缺口等均为既有面，非本包文件面，如实归属不冒充通过。

G0 开发期常态 · 不外推 packaged/Provider/GA。
