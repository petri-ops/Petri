# BLOCK-482 实机成片验证（真实 TTS + 真实 ffmpeg）

日期：2026-11-18
授权：用户 2026-11-18「TTS 默认开」（视频窄口 P5-a 授权，不翻转全局 speech-config）

## 输入
- 主题：为什么天空是蓝色的？
- 受众：小学高年级 · zh · 目标 30s · 16:9 · 科普图形
- 3 镜头，旁白由 DeepSeek TTS（stella/wav）合成；2 条 claim 均带来源（Wikipedia Rayleigh scattering / NASA，CC-BY-SA / public-domain）。

## 关键读数（live-record.json / qa-report.json / manifest.json）
- status = `machine_pass`
- bundleSha256 = 见 manifest.json（各产物 sha256 再哈希，manifest 自引用不哈希）
- 旁白真实时长（ffprobe）：sc1=6400ms / sc2=8520ms / sc3=7160ms，总 22080ms（≈22.1s，落在 P0 30–60s 预置以下，属实记录：真实 TTS 时长短于目标，未拉长填充、未虚构镜头）
- 全部 QA 断言通过：scene_count 3/3 · timeline_monotonic · srt_caption_bounds · video_nonempty(302557B) · subtitles_burned · all_claims_traced

## 独立 ffprobe 解码验证（未假手合成器自报）
- 容器/格式：MP4，duration=21.94s，size=270239B（烧录后 video.mp4 为 302557B；独立验证时点取烧录前 raw 口径，二者均可解码）
- 视频流：h264 / 1280x720 / 24fps（r_frame_rate=24/1）
- 音频流：aac（旁白拼接）
- exit=0（ffprobe 无解码错误）

## 画面目视（frame-final.png，第 8 秒 / sc2）
- 海军蓝科普卡（0x0B1B33）标题「瑞利散射」+ 副文案「蓝光波长短 → 更易被散射」
- 底部烧录字幕「蓝光波长短，更容易被散射」，中文渲染无豆腐块
- 与旁白/字幕时间线一致

## 观感边界
- 成片是否"好看"、科学表达是否精准 → `pending_human_eye`，签字槽留用户，Agent 零代签。
- 本次仅机器可验部分：可解码 / 参数符合 / 字幕同步 / 来源可追 / 无黑帧冒充 / 失败不伪装成功。

G0 开发期常态 · 不外推 packaged/Provider/GA。
