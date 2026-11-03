---
capability: block-340-video-input-plane
status: completed
goal: 视频输入面：让参考视频 / 试玩录像 / 屏幕录制成为 agent 可读输入——本地抽帧（ffmpeg，复用 BLOCK-329 已验证的发现与诚实降级，零新依赖）→ 关键帧选择 → 现有 vision 角色消息（model-gateway `image_url` 归一已在）。对照 Kimi「游戏开发与创意工作解决方案」推文评估（2026-11-02）确认的能力缺口之一；也是 BLOCK-341 引擎桥「截图序列→判据」管线的共用前置。
acceptance:
  - P0 边界钉死：ffmpeg 缺席 / 不可用 → 诚实 `capability_unavailable`（复用 `helpers/ffmpeg-turntable.js` 的 findFfmpegBinary / shouldFallback 模式）；帧数预算（默认 ≤8、硬顶 ≤16）与单帧尺寸上限入 model-surface 计量基线（任何增长需 `--update` 显式留痕）；无 vision 凭据时如实降级为「返回帧清单与 manifest，不解读」，不伪造观察。
  - P1 `read_video` agent 工具：工作区内 path（mp4 / mov / webm）+ maxFrames + 采样策略（均匀步长 | 场景变化阈值）→ 帧 PNG 落项目 `.petri/frames/<sha256>/` + manifest（源 sha256 / 帧清单 / 参数 / 时长）；帧以 image parts 进 vision 消息；工具元数据 readOnly（抽帧不改工作区源文件）。
  - P2 聊天附件面放开 video/*：`SimpleChat/attachments.ts` 的 imageInputAllowed 同源门控扩 videoInputAllowed（vision_configured || 渠道视觉能力）；上传走既有 `.chat-attachments/` 链，发送前抽帧复用 P1 同一 helper，不建第二条视频处理路径。
  - P3 契约 + 实机：契约测试 mock ffmpeg 二进制三路（成功 / 缺席 / 超时）+ mac 实机（真实短 mp4 → 帧 ≥3 → mock vision 回包断言 `image_url` parts 与帧数预算）；证据 `acceptance/block-340/`；impact-map 登记；closeout + 台账回写。
reopen: 音轨转写（ASR）；长视频分段摘要与时间轴标注；帧级视觉 embedding 索引；视频作为 Result Studio 产物的回放面。
---

# BLOCK-340-VIDEO-INPUT-PLANE — 视频输入面计划

- 登记状态：**active（2026-11-03 启动；用户连续五回「继续按照你的建议推进」=发令）**
- 立项裁决：用户 2026-11-02 对照 Kimi 游戏解决方案推文的能力评估后「可以的 梳理好了 这一块是否要建个 block 后续排队推进？」→ 主代理答「要」并登记排队（planned，未启动）。
- 队列位置：**335 之后、341 之前**（341 的截图序列→判据管线与本包共用「帧→vision」一条路；小体量，用户可裁决插队）
- 唯一真相域：本文件（block-340-video-input-plane）
- 文件面：`core/petri-server/helpers/video-frames.js`（新，复用 ffmpeg-turntable 的二进制发现）/ `agent-tools/tool-defs/*` + `agent-tools/registry.js`（`read_video`）/ `tool-metadata.js`（readOnly）/ `frontend/src/components/copilot/SimpleChat/attachments.ts` / `routes/ai-chat.js` 附件→帧 一处 / `test/model-surface-baselines.json`（预算入基线）/ `test/impact-map.json`

## 1. 评估结论（2026-11-02 主代理按代码实况核对，非按旧台账）

| 面 | 现状 | 结论 |
| --- | --- | --- |
| 图片输入 | 聊天附件（vision 角色门控）+ `read_image` 工具 + gateway `image_url` 归一 | ✅ 已有 |
| 视频输入 | attachments.ts 无 video 类型；无抽帧→vision 管线 | ❌ 缺位（本包） |
| 视频输出 | `model3d_render` / `model3d_export` 可产转盘 mp4（Blender 内置或外部 ffmpeg，BLOCK-329） | 只出不进 |
| ffmpeg 发现与降级 | `ffmpeg-turntable.js` 已有 findFfmpegBinary / shouldFallback，mac 实机 tier=ffmpeg | ✅ 直接复用 |

推文里「提供参考图和视频说明预期氛围与玩法」「结合渲染画面和试玩录像检查效果」两处都要求视频可读；Petri 缺的只是这一段输入面，vision 角色与 gateway 归一都已在。

## 2. 原则与形态自检

- **本地主权**：抽帧全在用户机器（本地 ffmpeg）；出站只发生在帧随 vision 调用时，与现有图片附件同一同意边界，不新增出站面。
- **不引依赖**：ffmpeg 为外部二进制（同 329 / Blender / R 先例：用户自装，缺席诚实），不进 package.json。
- **证据自证**：帧清单 + 源 sha256 + 参数落 manifest，观察结论可回溯到具体帧。
- **预算可计量**：帧数 / 尺寸入 model-surface 基线，防止「多看几帧」静默推高模型面。

## 3. 红线

- 不上传视频本体到任何外部服务；不内置 / 下载 ffmpeg；无 vision 凭据不伪造观察；不建第二条视频处理路径（聊天附件与 `read_video` 同一 helper）；G1+ 不外推。

## 4. 阶段

P0 边界与预算 → P1 `read_video` 工具 + helper → P2 聊天附件 video 门控 → P3 契约 + mac 实机 + closeout。各阶段验收即 front-matter acceptance 对应项。

## 5. 与相邻包的关系

- BLOCK-341 引擎桥：`godot_run` 产出的截图序列走本包同一「帧→vision」管线（341 不重复实现）。
- BLOCK-335 任务推进闭环：视频 / 帧观察作为闭环判据的一种输入形态，接口由 335 定义，本包只供数据。
- BLOCK-325 model-surface 预算门禁：帧预算入基线的机械守护点。


## 收口记录（2026-11-03 立项当日收口；提交 c4a88b0d）

- **P0**：`helpers/video-frames.js`——ffmpeg 复用 329 发现模式（零新依赖）；缺席诚实 `capability_unavailable`；帧预算默认 8 / 硬顶 16；uniform/scene 双策略；路径穿越拒收；同源幂等缓存（`.petri/frames/<sha256>/manifest.json`）。
- **P1**：`read_video` 工具全注册（registry handler / tool-defs schema / tool-metadata readOnly / 活动标签 fixture + verbs）；返回帧清单 + manifest；agent 用既有 `read_image` 逐帧解读。
- **P2**：附件面 video 门控（`videoInputAllowed` 与 imageInputAllowed 同源；无 vision 诚实阻断）。**设计修正**：plan 原文"发送前抽帧"改为"agent 工具自主抽帧"——前端抽帧会与 read_video 构成双路径（红线），视频走既有 `.chat-attachments/` 上传 + agent 收到引用行后自主调 read_video。
- **P3**：契约 9/9 + 实机 10/10（真 ffmpeg：3s 测试视频 → uniform 6 帧 / scene 策略 / 幂等缓存命中 / PNG 魔数 / 路径守卫；`acceptance/block-340/block340-video-live-darwin.json`）。
- **抓真两处**：①ffmpeg 7.x 已退役 `-vsync` → `-fps_mode`（实机抓到 ffmpeg_failed 后复现定位）；②工具计数 108→109 需同步四处 pin（agent-tool-registry ×2 / block157 / block116 / tool-activity-labels fixture）+ model-surface 基线有意增长留痕（read_video 685 chars，plan 验收条款"任何增长需显式留痕"兑现）。
- **门禁**：契约 9/9 + 实机 10/10 + types 0 + test:changed 929 项仅余 p6 脏树（提交自愈）+ closeout PASS。
- **reopen**（frontmatter）：音轨转写 ASR / 长视频分段摘要 / 帧级视觉 embedding / 视频回放面。

G0 开发期常态 · 不外推 packaged/Provider/GA。
