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
