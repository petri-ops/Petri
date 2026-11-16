# BLOCK-454 P6 · ASR/TTS 语音窄口 + agent 消费面 · 记录（2026-11-17）

> 波次：W6（e2e-execution-plan §3 W6 任务卡）。**用户裁决 2026-11-17「剩下没做的一次性搞完」= P6 需求场景裁决到位，正式启动**（覆盖原 D7 暂缓——需求场景 = plan P6 原文「语音输入/朗读回复」，用户显式发令）。

## 1. 交付物

### 窄口 + adapter（工具语义，不进 registerProvider capabilities）
- `core/petri-server/helpers/asr-provider.js`：`transcribeAudio`——POST `/v1/tools/asr` + Bearer + multipart(file)；**格式守卫按魔数判定**（16bit PCM WAV `RIFF/WAVE` / Ogg `OggS`，其他诚实拒并给 ffmpeg 转码指路）；≤8MiB（findings 契约）；响应 `{text, duration_ms}` 归一 + cost.requests/bytes 计量。WS 流式契约留接口不实现（findings 在册，不冒充）。
- `core/petri-server/helpers/tts-provider.js`：`synthesizeSpeech`——POST `/v1/tools/tts` + Bearer + JSON `{text, voice_id, format, filter_markdown}`；voice 白名单（stella/tide）/format 白名单（wav/pcm；opus 仅流式 WS）外诚实拒；text ≤10000 计费字符（超出指路分段）；响应音频二进制归一 Buffer + cost.requests/chars/bytes。
- 诚实失败全链：`asr/speech_access_disabled`（默认关）/ `*_not_configured`（无渠道无 key 指引）/ `*_http_error`（401 不可重试配置面）/ `*_timeout` / `*_bad_response`；key 走凭据族（'deepseek' 与对话共用）。

### config 族 'speech'（治理面，与 ocr 同构）
- `speech-config.js`（`file:speech-config.json`；**默认关** enabled=false）；schema family 'speech' + 5 键（enabled/provider/ttsVoice/ttsFormat/timeoutMs，ui=none）；冻结基线 20 族/112 键 → **21 族/117 键**（上调理由留痕）；drift 门 NO_UI_FAMILIES + WRITE_ROUTES 登记；config-transfer 族登记；REST `GET/PUT /api/speech-access`（runtime-config.js 同构写面）。

### agent 工具消费面（plan P6 需求场景落地）
- `agent-tools/speech-tools.js`：
  - `tool_transcribe_audio({filePath})`：工作区音频（路径穿越拒绝）→ ASR → text（语音输入场景）。
  - `tool_speak_text({text, voiceId?, format?})`：TTS → 音频落 `<workspace>/.petri/audio/<sha256(text+voice+format)>.<format>`（朗读场景；**同文本同声音幂等复用同一文件**，X3；只写 .petri 影子目录不改工作区源文件）。
  - registry.js：HANDLERS + CONTRACTS（transcribe=external-request R1 / speak=workspace-write R2）+ tool-metadata（readOnly 位）+ tool-defs（browser 域两条 Schema，消费描述与上限指路俱全）。

### UI 能力渠道槽位（R1 机制显化）
- ChannelPreferencePanel 第三槽位：语音渠道开关（enabled）+ TTS 声音选择（stella/tide，开启时显现），REST 直连 `/api/speech-access`；诚实提示「开启后 agent 可用 transcribe_audio/speak_text」。

## 2. HK-01 红→绿

- 红：`test/block454-p6-speech.test.mjs` 先行（模块缺失红）→ 实现后 **11/11**（A 窄口 5 + B 窄口 2 + C config 1 + D 工具 3，含魔数格式守卫/路径穿越拒绝/幂等同路径）。
- 邻域回归：tool 装配/策略 + config 治理四件套 **56/56**；types/secret/arch PASS；eslint 0 error（2 死指令 --fix 清除）。

## 3. 门禁与范围

- 零新依赖（multipart/binary 用 Node 24 内建 FormData/Blob/ArrayBuffer）。
- external-blocked：真机 ASR/TTS 云调用腿（同 W2-W5 D2 诚实原则——无独立验证授权 + 付费副作用 P5-a），契约级证据覆盖。

## 4. R1 机制显化对照

- ASR/TTS 此前「零实现零消费」（findings 登记）→ 现在三层在场：窄口可调（agent 工具）+ 授权面可配（能力渠道槽位 + REST）+ 产物可审计（音频落 .petri/audio 幂等留痕 + cost 计量）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
