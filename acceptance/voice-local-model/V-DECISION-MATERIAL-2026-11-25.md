# V 类裁决材料 · 语音本地模型（2026-11-25 · pending_user_ruling，不开工）

> 拍板背景：主人实机试用反馈「语音这块你打算怎么做，harness 能否增加语音输入呢。现在支持配置本地模型吧」+ WorkBuddy 语音设置截图（本地/云端切换、Whisper 系/SenseVoice/Nemotron/Parakeet 列表、下载/使用中/语言自动检测）。
> 性质：正式裁决材料（吸收 item 17 早前选型稿 `voice-local-runtime/U-DECISION-MATERIAL.md`——其「C 系统输入法外接」最小形态保留为备选，其余被本材料细化替代）。**只出材料：不实际投放、不引入本地推理运行时、不动主人 dev 实例**。批量清除包与架构简化梳理（msg_5ee5ec0a8cbe）不受影响。

## 一、现状核码（三点真值）

1. **harness 不是语音落点**：`core/shared-backend/capability-provisioning.js` = agent 分析模块（如 r-enrichment bundle）的**运行时包下载 ledger**（按需取入可写目录、SHA-256+原子移动、从不打进 .app）——服务对象是「内置分析模块声明需要的 runtime bundle」，不是输入通道。麦克风→ASR→输入框是**渲染进程输入链**，塞进工具预配系统属错层（兴奋判断正确）。
2. **语音现状（BLOCK-454 P6）**：`speech-config.js` 默认 `enabled=false`、provider 单选 none|deepseek；ASR/TTS 唯一渠道=deepseek 云（key 与对话共用）；无本地运行时、无优先级/回退、无模型管理面。
3. **agent 侧已有窄口工具**：`transcribe_audio`（工作区音频文件→转写）与 `speak_text`（registry.js:247-248）——是文件级工具，**不是麦克风实时输入**。

## 二、harness 能否加语音输入：**不推荐（错层）**

- capability-provisioning 的定位=「分析模块声明需要的 runtime bundle 按需下载 ledger」；语音输入是 composer 输入通道（渲染进程麦克风采集→ASR→文本进输入框），两者数据流、生命周期、权限面完全不同。
- **正确落点（单一推荐）**：**设置页配置面 + ASR 链扩展**——speech-config 扩展本地 provider 与模型管理；输入框麦克风钮（若做，见 §五单列 U 点）调后端转写链。模型**下载器原语**可复用 capability-provisioning 已实现的 download+SHA256+原子移动步骤（函数级复用，非挂进 ledger——若该模块导出下载 helper 则零重写）。

## 三、本地 ASR 运行时选型（macOS arm64 · U 类裁决核心）

| 选型 | 依赖形态 | 离线 | 中文 | 体积 | Apple Silicon | 许可证 |
|---|---|---|---|---|---|---|
| **SenseVoice-small（经 sherpa-onnx）** | npm 包 `@k2-fs/sherpa-onnx-node` 或独立 CLI（预编译 macos-arm64）+ onnx 模型 ~230–500MB | ✓ | **SOTA 级**（阿里 FunASR 中文最强开源，带标点） | 模型小、推理极快（CPU 即可） | ✓（onnxruntime Metal/CPU） | Apache-2.0（sherpa-onnx）/ FunASR MIT — 许可干净 |
| **whisper.cpp（large-v3-turbo / small）** | 独立 CLI 二进制（官方 releases 含 macos-arm64，Metal 加速）+ gguf/ggml 模型：tiny ~75MB / turbo ~800MB / large-v3 ~1.5GB | ✓ | 良好（large-v3 级；tiny 中文一般） | 二进制小+模型按需 | ✓✓（Metal 原生优化） | MIT — 干净 |
| NVIDIA Nemotron 3.5 | NeMo/python 栈，目标平台=GPU/CUDA | ✓ | 中等 | ~2.5GB+ | ✗（Apple Silicon 非目标，CPU 慢） | NVIDIA 专有许可条款需审 |
| NVIDIA Parakeet | 同上（NeMo） | ✓ | 弱（主英文） | ~1–2GB | ✗ | CC-BY-4.0 |

### 单一推荐

**SenseVoice-small 经 sherpa-onnx 起步**：中文表现最强（主人主用中文）、CPU 即可实时、模型体积小（下载体验好）、npm/CLI 双形态集成容易、Apache/MIT 许可干净。
**whisper.cpp 作为并列可下载项**（模型管理面天然支持多模型共存）：英文/多语场景更优，主人可二选一下载。

## 四、配置面方案（按截图形态，最小改动路径）

| 截图能力 | 落点 | 改动 |
|---|---|---|
| 本地/云端切换 | `speech-config.js` additive：`provider_chain: ['local','deepseek']` + `local_model` 字段（模型 id/路径/language） | **复用扩展**（既有 FAMILY=speech 结构，零新建真相源） |
| 模型列表（下载/使用中/删除） | 新增模型管理模块：下载原语可复用 capability-provisioning 的 download+SHA256+原子移动 helper（函数级复用）；「使用中」=speech-config.current_local_model；删除=删模型文件 | 新增（约一半工作量） |
| 优先级/回退 | provider_chain 顺序即回退链：本地失败/超时 → deepseek 云 → 诚实报错（回执标注 provider 来源） | 复用既有 timeoutMs 机制 |
| 语言自动检测 | whisper.cpp/SenseVoice 均内置 auto-detect；speech-config 增 `language: 'auto'` 透传 | 单字段 |

**最小改动路径**：阶段一=speech-config 扩展+ SenseVoice sherpa-onnx 集成+设置页语音段（切换/下载/使用中/删除）≈ **M**；阶段二=whisper.cpp 并列下载项+composer 麦克风输入（见 §五单列）另点。

## 五、语音输入形态：两条独立线（单列 U 点，不默认并入）

| 形态 | 现状 | 技术路径 | 体量 |
|---|---|---|---|
| 工作区音频文件转写 | **已有**（agent `transcribe_audio` 工具） | 本地 ASR 落地后该工具自动获得本地 provider（provider 链透传） | 小（随本裁决自然增益） |
| 输入框麦克风实时输入（新形态） | 无 | ①Web Speech API：Chromium 内建但走 Google 云=违背本地主权，**不推荐**；②本地流式：录音 MediaRecorder → 分段送本地 ASR（whisper.cpp stream / sherpa-onnx streaming）→ 文本进 composer | M~L（录音权限/流式分片/补丁交互，独立立项） |

**建议**：本裁决先落「文件转写本地化 + 设置面」；composer 麦克风实时输入作为独立 U 点（待主人确认需要实时口述形态后再裁）。

## 六、拍板口令

- 「按推荐做 SenseVoice」= 立项本地 ASR 集成+设置面（M，阶段一）；
- 「加 whisper 并列」= 模型管理面双模型可下载（+S）；
- 「composer 麦克风」= 单列实时输入 U 点（先出细化材料）；
- 「C 系统输入法先行」= 最小形态（S 文档文案）。

红线重申：裁决前不动 speech-config、不引入本地推理运行时、本地模型未到位不冒充可用（一切「使用中/已下载」状态以真实落盘为准）。
