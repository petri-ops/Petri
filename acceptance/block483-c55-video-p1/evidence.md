# BLOCK-483 / C-55 VIDEO-P1 — 科学证据与质量闭环 · 实机证据

> 日期：2026-11-18
> 蓝本：`acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md` §5 P1（non-canonical）
> 输入：BLOCK-482 真实成片 `acceptance/block482-c55-video-p0/`
> 生成器：`node acceptance/block483-c55-video-p1/probe-evidence.mjs`（真实 ffprobe/ffmpeg，零新依赖）

## 1. 证据文件

| 文件 | 内容 |
| --- | --- |
| `hk01-red-green.txt` | HK-01 缺席红 → 实现绿 22/22 + 8 类篡改负测 + 判据校准留痕 |
| `probe-readings.json` | 真实 ffprobe/ffmpeg 原始 AV 读数 + 完整性 + 如实登记的 P0 存量数据缺口 |
| `evidence-report.json` | 由 `video-evidence.js` 消费真实读数生成的六组证据报告（machine_pass，观感留白） |
| `probe-evidence.mjs` | 一次性证据生成器（ffmpeg 路径解析：env > P0 live-record > PATH） |

## 2. 真实 AV 读数（ffprobe/ffmpeg 实采 P0 成片）

| 指标 | 实测 | 判定 |
| --- | --- | --- |
| 视频编码 / 分辨率 / 帧率 | h264 / 1280×720 / 24fps | 通过 |
| 视频流时长 / 音频流时长 | 22.125s / 22.147667s（skew 0.023s） | 通过（< 0.5s） |
| 黑帧（blackdetect d=0.5 pix_th=0.10） | 0 | 通过 |
| 静音段（silencedetect -45dB d=0.5） | 2 段合计 1.132s（镜头自然停顿，占 5.1%） | 通过（< 时长 50%） |
| 响度峰值 / 均值（volumedetect） | -2.2dB / -19.1dB | 通过（上界 -0.5dBTP 防削波，下界 -30dB 防静音） |
| 字幕溢出（SRT 越界比对） | 0 / 3 条 | 通过 |
| 字幕烧录 | burned=true（沿 P0 qa-report） | 通过 |

`evidence-report.json` status=`machine_pass`，`validateEvidenceIntegrity`=true，六项 AV 检查全绿；
`humanReview.status=pending_human_eye` —— 成片观感与科学专业性终审由用户签字，Agent 未代签。

## 3. 出口对账（P1 四条出口）

| 出口 | 结果 | 证据 |
| --- | --- | --- |
| ① 随机抽查 5 个关键论断均能定位来源原文 | ✅ 能力达成 | HK-01 B3：规范 fixture 5 claims / 5 sources 各带 excerptRef → traced=5/5 |
| ② 至少一个数字/单位错误样本被捕获 | ✅ | HK-01 C1：`650 nm = 65 μm` → unit_conversion_mismatch（fail-closed） |
| ③ 冲突来源样本没有被静默合并 | ✅ | HK-01 D0：双源 650nm vs 700nm → resolution=parallel_display，两值并列保留 |
| ④ 故意注入坏字幕/缺音轨被 QA 拦下 | ✅ | HK-01 G1（缺音轨→silence+av_skew 红）/ G2（字幕溢出红） |

## 4. P1 抓到的 P0 存量数据缺口（如实登记，不篡改）

- `p0_sources_missing_excerptRef`：P0 spec.sources 未采集 `excerptRef`（引用片段定位），
  按 P1 Claim–Evidence 严格口径，P0 成片 `traced=0/2`；P1 能力已由 B3 fixture 证明，
  给 P0 存量 spec 补采片段属 P0 数据增量，不在本包范围，未伪造片段冒充已溯源。
- `p0_scene_no_evidence_ref`：P0 sc1 标题镜头未绑定 evidenceRefs（P0 设计如此），
  P1 标为可见警告 `missing_evidence_ref`（非致命），未悄悄略过。

## 5. 红线守住

- 观感项（pending_human_eye）保持 in_progress 零代签：`humanReview.status=pending_human_eye` 全程未翻 verified；
  HK-01 H1 专门钉住「翻 verified 即红」。
- 零新依赖：仅复用系统 ffmpeg/ffprobe + Node 内建；无 npm 新增。
- 不碰 P0 产物：只读 `video-project.json`/`qa-report.json`/`video.mp4`，未修改 BLOCK-482 任何证据文件。
- 他方 WIP：`docs/architecture/gateway-design.md` 零触碰。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
