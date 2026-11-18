---
id: BLOCK-482
title: C-55 VIDEO-P0 科普视频最小成片闭环
kind: work-package
status: completed
phase: CLOSED
truthDomain: block482-c55-video-p0
queueAnchor: C-55
registeredAt: 2026-11-18
canonical: true
entrypoint: docs/README.md
---

# BLOCK-482 · C-55 VIDEO-P0 科普视频最小成片闭环

> 最后更新：2026-11-18（CLOSED · 一次会话完成；HK-01 14/14 + 真实成片 machine_pass + 门禁 ledger 如实归属）
> 发令：用户 2026-11-18「开始 C-55-VIDEO-P0」；后续裁决「都给肯定的回答 TTS 默认开 外部素材允许 尽可能的做好 而不是简单」。
> 蓝本：`acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md` §5 P0（non-canonical 规划材料，本包把它落为 canonical 工作包）。
> 队列锚：`docs/pending-work-backlog.md` C-55；审计锚：`docs/AUDIT-LOG.md` C-55 条目。

## 1. 用户裁决（逐字留痕）

| 项 | 裁决原话 | 运行时解释 |
| --- | --- | --- |
| 开工 | 「开始 C-55-VIDEO-P0」 | 显式开工令，占唯一串行槽位 |
| TTS | 「TTS 默认开」 | 视为显式 P5-a 付费授权：**仅在视频成片窄口内**为旁白启用 DeepSeek TTS（config enabled=true），不翻转全局 `speech-config.json`（那是独立产品面，不在本次授权范围）。凭据/网络不可用时诚实失败，不 mock 冒充。 |
| 外部素材 | 「外部素材允许」 | spec 的视觉源可引用工作区内已落盘的图片；**强制**来源/许可元数据，缺 provenance 即 fail-closed。直接 URL 抓取委派既有受治理 `web_fetch`，不在本包新造下载器。 |
| 质量 | 「尽可能的做好 而不是简单」 | 交付真实可解码 MP4（非静态契约首片）：多镜头、旁白、字幕、讲稿、来源、可编辑 spec、QA、manifest 全链。 |

## 2. 范围（in scope）

1. **VideoProjectSpec 数据模型**：`goal / claims / sources / scenes / audio / render / qa / lineage`，schemaVersion 钉版本；纯函数规范化 + fail-closed 校验。
2. **`compose_video` 通用合成窄口**（新增 helper + agent 工具）：
   - 复用 `findFfmpegBinary`（零新依赖）与 TTS `synthesizeSpeech`（授权开启）；
   - 每镜头：旁白合成 → ffprobe 取音频真实时长 → 以实际时长排程画面与字幕（首版不要求字级时间戳）；
   - 画面：`kind=card`（ffmpeg color + drawtext，海军蓝科普卡）或 `kind=image`（工作区图片 + provenance）；
   - 合成：逐镜头段 → concat demuxer → H.264 MP4；烧录 SRT 字幕；旁白拼接为 narration.wav；
   - 失败结构化：`capability_unavailable` / `tts_*` / `no_material` / `ffmpeg_timeout` 等，失败不产出「成功但不可用」MP4。
3. **产物集**：`video.mp4` / `narration.wav` / `subtitles.srt` / `script.md` / `sources.md` / `video-project.json` / `qa-report.json` / `manifest.json`（全部 sha256 + 血缘）。
4. **实机成片**：真实 TTS + 真实 ffmpeg 产一条 3 镜头短视频，ffprobe 验证可解码/时长/分辨率/帧率/音轨；证据落 `acceptance/block482-c55-video-p0/`。
5. **HK-01 红绿**：契约测试先行（缺席红 → 实现绿 + 篡改负测）。

## 3. 非范围（exclusions）

- 不翻转全局 `speech-config.json` 默认关（独立产品面，需单独裁决）。
- 不把 `composeTurntable` 改成全能剪辑器（新增独立窄口）。
- 不接通用文生视频 / 文生图 / 复杂转场 / 非线性编辑器（P1/P2/P3）。
- 不引任何新 npm 运行时依赖；不新造下载器（URL 抓取走既有 `web_fetch`）。
- 不改 UI 组件/样式；成片观感终审（pending_human_eye）保持 in_progress 零代签。
- 不触碰他方 WIP `docs/architecture/gateway-design.md` 与任何 untracked 用户资产。
- 不外推 packaged/Provider/GA（G0 开发期常态）。

## 4. 依赖与文件面

- 复用：`core/petri-server/helpers/ffmpeg-turntable.js`（findFfmpegBinary）、`tts-provider.js`（synthesizeSpeech）、`video-frames.js`（ffprobe 时长模式）。
- 新增生产文件：`core/petri-server/helpers/video-compose.js`、`core/petri-server/agent-tools/video-tools.js`。
- 注册面：`tool-defs/browser.js`（+compose_video schema）、`registry.js`（handler + contract）、`tool-metadata.js`、`tool-events.js`、`test/fixtures/tool-activity-labels.json`、`test/model-surface-baselines.json`（有意增长，commit message 留因）。
- 测试：`test/block482-video-compose.test.mjs`。
- 证据：`acceptance/block482-c55-video-p0/`。

## 5. 验收门禁（收口逐项对账）

| 门 | 判据 |
| --- | --- |
| G1 HK-01 | 缺席红（ERR_MODULE_NOT_FOUND）+ 实现绿 + ≥3 类篡改负测 fail-closed |
| G2 契约 | spec 校验/timeline 单调/SRT 边界/manifest sha 一致/失败结构化，Node 测试全绿 |
| G3 实机 | 真实 TTS + ffmpeg 产 MP4，ffprobe 解码成功，时长/分辨率/帧率/音轨符合预设；云不可用则 external-blocked 诚实标注 |
| G4 注册 | TOOL_DEFS 汇编完备 + 双真源活动动词一致 + model-surface 基线有意增长留痕 |
| G5 治理 | `docs:check`（既有 post-h9 红如实归属）、`ui:audit:check`、`hygiene:check`、`test:changed`、closeout 定向链 |
| G6 六件套 | plan / registry(DOC) / roadmap / handoff / AUDIT-LOG / README 回写；观感零代签 |

## 6. 完成语义

- `completed` 必须有：契约测试绿 + 实机 MP4 证据（或 external-blocked 归因）+ closeout 门禁 + 六件套回写 + commit/push。
- 观感（成片是否"好看"）属 `pending_human_eye`，仅完成机器可验部分，签字槽留用户。
- 云 TTS 若失败：标 `external-blocked`，不写 verified，不伪造音频。
- 交付 ≠ 视频能力全部完成；仅 P0 最小闭环，P1–P3 保持候选未启动。

## 7. 收口对账（2026-11-18）

| 门 | 结果 | 证据 |
| --- | --- | --- |
| G1 HK-01 | ✅ PASS | 缺席红 ERR_MODULE_NOT_FOUND → 绿 14/14 + 6 类篡改负测（画幅/unknown_source/provenance/空旁白/时长/失败诚实） |
| G2 契约 | ✅ PASS | block482-video-compose 14/14；agent registry 39/39（含 5 项注册契约） |
| G3 实机 | ✅ PASS | 真实 DeepSeek TTS + ffmpeg 6.1.1 产 3 镜头 MP4；ffprobe 独立解码 h264/1280x720/24fps/aac/21.9s exit=0；QA machine_pass；subtitles_burned=true；CJK 无豆腐块（frame-final.png）；云/工具不可用路径由 D0-D2 契约覆盖 |
| G4 注册 | ✅ PASS | TOOL_DEFS 118 汇编完备、活动动词双真源一致、model-surface 基线有意增长留痕、surface audit P1=0/P2=0、knip 定性 probe-live.mjs 为动态入口、code-size 随批重打 |
| G5 治理 | ⚠️ 部分 PASS | audit-compact/hygiene/ui:audit/quality:secret/arch/lint/types/knip/surface/user-assets/version-parity/silent-catch/code-size/arch-cycles/css-modules PASS；**docs:check / test:changed(block464/470/477) / quality:lint:ledger(test 域既有 419>418 漂移，本包贡献 0) / quality:ear(block-105 证据+manifest 漂移) / quality:perf(平台基线 darwin≠win32) / gate:post-h9-contracts(6 红既有项) 均为既有红，非本包文件面，如实归属**；K-24 tools 117→118 已按 BLOCK-454 先例同步对账；perf 跳过（G0 边界噪声） |
| G6 六件套 | ✅ PASS | plan/registry(DOC)/roadmap/handoff/AUDIT-LOG/README 回写；成片观感 `pending_human_eye` 零代签 |

**有意增长留痕**：新增工具 `compose_video`（TOOL_DEFS 117→118、model-surface 基线上调、tool-events +1 行 code-size 重打、surface-matrix 工具数 118、K-24 truth 同步对账）；`probe-live.mjs` 定性为动态入口（手动执行的证据生成器，非产品死代码）入 knip 保留面。
**观感零代签**：成片是否"好看"/科学专业性终审为 `pending_human_eye`，QA `humanReview.status=pending_human_eye`，签字槽留用户。
**既有红归属**：均为 post-h9 冻结面/历史工具数快照/平台基线漂移，非本包引入，未改基线掩盖。

G0 开发期常态 · 不外推 packaged/Provider/GA。
