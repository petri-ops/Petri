# BLOCK-519 阶段二 · 证据（2026-11-25）

> 发令：Orca bb8dddaf dispatch msg_a345c2faa02e（owner「按已批计划继续推进」），语音阶段二 whisper 并列 + composer 麦克风。
> 本包当前范围：**composer 麦克风入口已实现**；**whisper 并列待 owner 裁决依赖形态**（见 STAGE2-DEPENDENCY-FOUR-Q.md，问题 msg_c8a42ec9cbd7 已发兴奋）。阶段三不做、外部监督器/goal-verifier 行为裁决 pending、真人样本投放未获 go 不动。
> G0 开发期常态 · 不外推 packaged/Provider/GA。owner dev 实例 3000/3001/9222 不碰、前端走 vite HMR。

## §1 composer 麦克风入口（已实现）

- 后端：`core/petri-server/helpers/composer-mic-transcribe.js`（薄封装 `asr-provider.transcribeAudio`，零新识别逻辑/零新依赖）+ `POST /api/speech/transcribe`（runtime-config，express.raw audio/* 8MiB，默认关不发请求，失败 400 结构化 code）。
- 前端：`SimpleChat/useComposerMic.ts`（MediaRecorder → Blob → REST → 文本经 onTranscript）+ `ComposerMicButton.tsx`（composer-left 按钮，recording/busy/error 可见态）+ `SimpleChat.tsx` 接线（转写文本**追加**进输入框，`handleInsertComposerText(input ? input+text : text)`，**不自动发送**——动作语义：加入上下文 ≠ 立即执行）。
- 复用现有 provider 链（local→deepseek），云回退如实报来源；未落盘本地模型不冒充可用（asr-provider 既有语义）。

## §2 HK-01 红绿先行

`test/block519-stage2-composer-mic.test.mjs` 红 4/4（写实现前：helper/REST/组件/hook 全缺位）→ 绿 4/4（含：禁用态不发请求诚实报错、注入 localFn 链路成功带 provider=local、组件仅 onTranscript 无 onSend、hook 有 stop/MediaRecorder）。

## §3 验证

- 阶段一语音回归 `block519-local-asr` 7/7 + `block454-p6-speech` 10/10 = 18/18；前端 `ChannelPreferencePanel` 6/6；W5a/test-affected 24/24；types 0、lint 0 error。
- 依赖：composer 入口零新依赖。whisper 并列若批准则引入第 2 个新依赖 `@fugood/whisper.node@1.0.13`（精确钉扎，四问留痕）。
- HMR：vite :3000 服务新源待收口核对；owner 进程零触碰。

## §4 待裁决 / 后续

- whisper 并列：V 材料 §三「官方 macos-arm64 CLI 二进制」与真值不符；四问建议 npm binding，请 owner 回「行/不行」后接线（作为 local 内部模型选择，回退链零变化）。
- commit：本阶段 composer 入口本地提交，push 等放行。

## §5 门禁归属（closeout 2026-11-25）

- closeout 十三门前四门（audit:compact/hygiene/docs:check/ui:audit:check）全 PASS（UI 台账以阶段二同批引用块登记，不新增 UI-### 不翻状态）。
- `test:changed` 1081 pass / 7 fail：7 红全部为存量/他方归属（工具 defs 三红、config 族冻结、W5b useGuardAck 行数、P6 证据源、fixture 工具宇宙）——本包零触碰、`git diff --name-only` 不含 useGuardAck/工具 defs，阶段一证据已登记同族，不伪造绿。
- `quality:lint` 0 error（hook 初始两处 lint 红：render 期改 ref + json any，已修为 useEffect + 显式类型）、`quality:types` 0 红。
- `code-size` 定向重打 `SimpleChat.tsx` 1915→1921（+6 行留因：composer 麦克风接线）；WorkspaceFilePreview 他方 WIP 红如实归属零触碰。
- Jev：`test:suggest` 零建议（如实记录）；`doc:suggest` 建议 uiAudit（deterministic，台账已回写）。

## §6 whisper 并列实现（owner「行」msg_0077c4847060）

- 依赖：`@fugood/whisper.node@1.0.13` 精确钉扎（package.json + package-lock 随批），本机 `npm install` 成功（added 2 packages）、`node -e require(...)` 实测 `initWhisper=function`、darwin-arm64 平台包在位（native addon 可用，owner 条件③前半满足）。
- 实现：`whisper-model.js`（独立 catalog：whisper-small `55356645…` / whisper-large-v3-turbo-q5_0 `e050f797…`，单 .bin 下载+官方 SHA 校验，未落盘不冒充可用）；`whisper-asr.js`+`whisper-asr-worker.js`（native addon 只在 worker 内加载，spawn 隔离不污染 owner 进程）；`local-asr.js` 按 `engine` 分派（默认 sensevoice 原路径逐字保留）；`asr-provider.js` 按 `modelId=whisper-*` 或 `engine=whisper` 选 whisper catalog，**PROVIDERS/local→deepseek 链零变化**；REST `/api/speech/whisper-models` list/download/delete；设置面语音段 whisper 模型列表二选一下载。
- HK-01：`test/block519-stage2-whisper.test.mjs` 红 3/5→绿 5/5；阶段一+阶段二全量 HK-01/回归 27/27；ChannelPreference 6/6；types/lint 0 error。
- 独立 native 端到端实测：tiny 模型（75MB，仅验证 API 链非产品档）下载中——结果另行补记；若失败（网络/API 不符）按 owner 条件停下回报不硬换。

## §7 whisper native 端到端实测（owner 条件③：包可用性）

- 隔离 /tmp（不碰 owner 数据）：官方 `ggml-tiny.bin`（75MB，仅验证 API 链、非产品档）分两段 curl 下载完整（77,691,713 B）；生成 0.2s 静音 16kHz mono WAV；跑 `whisper-asr-worker.js`。
- **实测 1 → 失败抓真**：首跑 `{"ok":false,"code":"whisper_worker_failed","message":"Model path is required"}`。根因=`@fugood/whisper.node@1.0.13` 的 **README 写 `{ model }`，但 native `WhisperContext.cpp:369` 实读 `filePath`**（文档漂移，非包不可用）。另 `transcribeFile` 返回 `{ stop, promise }` 而非直接 promise（README 有写）。
- **修法**：worker 传 `{ model, filePath: model, useGpu: true }` 双键兼容 + `await call.promise`（保留未来修正版兼容）。
- **实测 2 → 成功**：`WORKER_OUT {"ok":true,"text":" [BLANK_AUDIO]","durationMs":425}`；ggml Metal compute buffers 正常分配/释放。静音正确识别为 `[BLANK_AUDIO]`，证明 native addon + 模型加载 + worker 隔离 + API 链全部真实可用。**未发现包不可用/行为不符 → 不触发 owner 条件③的停下回报**。
- 注释：tiny 模型实测 SHA 与 HF 页面 SHA 不一致（Xet CDN 分段/镜像差异 suspected），但文件头 `lmgg` 正确且真实可加载转写；**产品 catalog 的 small/turbo-q5_0 SHA 走 download 时强校验**，不以 tiny 实测替代产品档校验。

## §8 whisper 门禁归属与 Jev（2026-11-25）

- closeout 前四门 PASS；`test:changed` 615 pass / 3 fail（config 族冻结 21族117键 / P6 证据源 / fixture 工具宇宙）——均为存量/他方归属，本包 `git diff` 不含 config-schema 家族/工具 defs/P6 证据源，不伪造绿。
- `quality:types` 0、`quality:lint` 0 error、`code-size` 本包零新增违规（他方 WorkspaceFilePreview 红不碰）、W5a/test-affected 24/24、ui:audit:check PASS（whisper 设置面同批引用块登记、不新增号不翻状态）。
- Jev：`test:suggest`/`doc:suggest` 本阶段已取（阶段二 composer 段），whisper 段 `output:judge` ESCALATE（语义评分低，与前几包同族；执行真相以 HK-01/实测/门禁核码为准）。
