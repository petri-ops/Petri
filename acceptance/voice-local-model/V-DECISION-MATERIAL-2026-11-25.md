# V 类裁决材料 · 语音本地模型（2026-11-25 · 阶段一已批并开工；阶段二未做）

> 拍板背景：主人实机试用反馈「语音这块你打算怎么做，harness 能否增加语音输入呢。现在支持配置本地模型吧」+ WorkBuddy 语音设置截图（本地/云端切换、Whisper 系/SenseVoice/Nemotron/Parakeet 列表、下载/使用中/语言自动检测）。
> 执行授权：owner 经 兴奋 转达主人 2026-11-25「按你的推荐来，冲吧」——执行本材料单一推荐 SenseVoice-small 阶段一（BLOCK-519）；whisper.cpp 并列下载项、composer 麦克风实时输入、G1+/打包/签名/对外投放均不在本令。
> 性质：正式裁决材料（吸收 item 17 早前选型稿 `voice-local-runtime/U-DECISION-MATERIAL.md`——其「C 系统输入法外接」最小形态保留为备选，其余被本材料细化替代）。**阶段一只落「设置面+文件转写本地化」；不实际投放、不动主人 dev 实例**。批量清除包与架构简化梳理（msg_5ee5ec0a8cbe）不受影响。

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

## 七、BLOCK-519 阶段一实施计划（2026-11-25 · owner 已批）

### 7.1 开工前核码（C-32/C-43 教训：先核码再信台账）
- `git diff --name-only 503cf0460..HEAD | grep -iE 'voice|speech|asr|tts|transcribe'` → **zero-touch**：前一包 BLOCK-518 三提交不碰语音面。
- `speech-config.js` = DEFAULTS(enabled=false/provider=none) + 共享 schema `speech` 家族（commitGuard 白名单：enabled/provider/ttsVoice/ttsFormat/timeoutMs）；`asr-provider.js` 唯一 provider=deepseek 云；`speech-tools.js:tool_transcribe_audio` 只是把 config 透传 asrFn——**无本地 runtime、无回退链、无模型管理面**，与 §一/§四一致。
- `capability-provisioning.js` 已导出 `defaultDownload` / `streamingSha256`（函数级复用），`_provisionOnce` 的 SHA 校验+原子移动是私有实现，不导出 → 模型管理器重写原子移动一小段，不挂 ledger。
- 依赖核真：材料写的 `@k2-fs/sherpa-onnx-node` 在 npm **404**；实际官方包=`sherpa-onnx-node@2.0.3`（Apache-2.0，2026-11-22 更新；macOS arm64/x64、Linux、Windows 预编译，无需本地编译器）。

### 7.2 依赖四问（立项检查单）
1. 替代方案：npm binding（预编译、无编译器、Node≥16）vs 独立 CLI（需手工下载二进制、进程管理更重）→ 选 npm binding，模型目录独立下载。
2. 许可证/维护度：Apache-2.0（sherpa-onnx）+ 模型 FunASR MIT，许可干净；2.0.3 于 2026-11-22 更新，官方多语言示例在维护。
3. 影响面：native addon 受 Node ABI 约束（本机 Node 24 实测为准）；macOS 需 `DYLD_LIBRARY_PATH` 指向包内 lib → **子进程 worker 隔离**（spawn 时设 env，不污染 owner dev 进程）；模型 ~230–500MB 放用户数据目录，不进仓库/打包产物；G0 开发期只验证 dev 边界。
4. 退出成本：单一 wrapper `local-asr.js` 懒加载 + worker，业务面只认 wrapper 契约；移除依赖只需删 wrapper 与 manifest 项。
- 用户裁决留痕：本令「引入 sherpa-onnx 是主人已裁决的产品级依赖例外，照立项检查单走」+ 2026-11-25 阶段一开工令；版本钉扎精确 `2.0.3`（不用 ^），登记根 `package.json`。收口如实写「1 新依赖」。

### 7.3 阶段一范围/验收
- 模型管理：`core/petri-server/helpers/local-asr-model.js`（catalog=SenseVoice-small int8 2024-07-17；download 用 `defaultDownload`+`streamingSha256`+原子移动+tar 解包；list/delete/current 以真实落盘为准；sha 官方未公布→落盘后记录实测 sha 供审计，不伪造校验值）。
- ASR 透明包装：`core/petri-server/helpers/local-asr.js` + worker（spawn 设 DYLD_LIBRARY_PATH；SenseVoice 原生多语，`language:auto` 作配置字段透传并诚实标注）。
- provider 链：`speech-config` additive `provider_chain`/`local_model`；`asr-provider` 按链尝试 local→deepseek，成功回执带 provider 来源与回退轨迹；`transcribe_audio` 自动获得本地 provider（config 透传，不改工具契约）。
- 设置面：`ChannelPreferencePanel` 语音段按截图形态加 本地/云端/本地优先切换、模型列表（下载/使用中/删除）、语言自动检测；未下载模型不得显示「使用中」。
- 不做：whisper.cpp 并列项、composer 麦克风实时输入、G1+/打包/签名/对外投放；embedding/tools 不涉及。
- 门禁：HK-01 红绿先行；定向 Node/前端测试；`npm run closeout`（存量红如实归属）；隔离栈 9223 验收、owner 3000/3001 不碰、前端靠 vite HMR；证据落 `acceptance/voice-local-stage1/`；提交本地、push 待放行。

### 7.4 实施结果（2026-11-25）
- 新增 `local-asr-model.js`（catalog + 下载/校验/原子移动/删除，落盘真值）、`local-asr.js` + `local-asr-worker.js`（native 单边界、DYLD 子进程隔离）；`asr-provider.js` provider 链（local→deepseek，来源/回退轨迹）、`speech-config.js` + shared-config additive；`speech-tools.js` 注入口让 `transcribe_audio` 自动获得本地 provider；`runtime-config.js` 增模型管理 REST 三口；`ChannelPreferencePanel.tsx` 按截图形态落本地/云端/链切换、语言、模型列表。
- GitHub release 资源 302 → 先 HEAD 解析最终 URL，再复用 capability-provisioning 的 `defaultDownload` 与原 `streamingSha256`；SHA 官方未公布，落盘后记录实测值。
- 依赖：`package.json` 精确钉扎 `sherpa-onnx-node@2.0.3`（**1 新依赖**），平台包 `sherpa-onnx-darwin-arm64` 随 optional deps 安装；native addon 在 dyld env 下实测可加载。
- 真实 arm64 实测：模型下载 50s（实测 sha `7d1efa…d347e`），官方 `test_wavs/zh.wav` 本地转写文本「开饭时间早上9点至下午5点。」、598ms、0 云请求（证据=`acceptance/voice-local-stage1/EVIDENCE.md`）。
- 定向验证：HK-01 后端 7/7 + 前端 6/6 + 既有 P6 语音 10/10 全绿，types 0；阶段二（whisper 并列下载/composer 麦克风）未做。
