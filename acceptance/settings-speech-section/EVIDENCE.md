# item 40 · 设置页语音独立成区证据（2026-11-25）

> 发令：Orca 5d7d49cd msg_4a53c55da784（主人过 v2 视觉稿「过，开工」）。以本令为准，旧 channels 一页式方案（`docs/settings-ia-channels-section-plan.md`）仅作影响面参考。
> 红线：观感零代签、owner 3000/3001/9222 零触碰、REST 面零改动、不翻 qualificationEligible。

## §1 实现

- 新增 core 分区 `speech`（左栏「能力」组第二项，label「语音」，description「本地模型 / 转写与朗读」，新增 `mic` 语义图标）；core 5→6。
- `ChannelPreferencePanel` 从 models 折叠块迁出为 `?section=speech` 独立页常驻（**无外层折叠**）；页内只留四块：语音渠道 / ASR 语言 / 本地模型（SenseVoice + Whisper 下载/使用中/删除）/ TTS 声音。删除联网检索后端与 OCR 渠道两块 UI（主人明确「删 1、2」，无新落点、不迁移到联网与代理）；REST 面 `/api/web-access`/`/api/ocr-access` 与后端默认值原样保留、功能零删除。
- 关键抓真：迁出后组件原 `toggleOpen` 内才 `void load()`，独立页无开关 → 进页不加载（四块只显示第一块）。已改为 mount 时 `useEffect` 异步 load，HK-01/面板测试恢复绿。
- `VisionRoleBinding`/`EmbeddingRoleBinding` 留 models（BLOCK-518 后向量绑定是知识库/记忆硬依赖）；`showAiSave` 天然隔离零改动。
- 深链新增 `speech` 合法值、旧值不变；搜索 `SettingsSectionId` 第二真相源同步，关键词收敛到语音/本地模型/ASR/TTS/SenseVoice/Whisper，双向逐项相等门保持绿。

## §2 HK-01 红绿先行

`frontend/src/components/desktop/DesktopSettingsPanel/SettingsSpeechSection.hk01.test.tsx` 红 4/5（①core 6 组/②深链/③两块删与折叠/④搜索索引，⑤REST 原样本就绿）→ 绿 5/5；①-⑤逐项在案。

## §3 门禁账

- 邻域前端 7 文件 36/36（HK-01/SettingsNav 6/6/ChannelPreferencePanel 4/4/settingsSearch/SettingsToolbar/Vision/Embedding）；theme-token-contract 19/19。
- `block201-settings-baseline.test.mjs`：分区冻结 11→12（加 speech，显式重打留因）绿；**配置注册表冻结红=存量他方归属**（本包零碰 config-schema，历次 closeout 已登记同族）。
- `quality:types` 0 红；`quality:lint` 0 error（修 3 处自引入：HK-01 两处 async 无 await、useEffect 内同步 setState→microtask 异步化）；`docs:check` PASS(675)；`ui:audit:check` PASS（台账同批登记 in_progress、观感 pending_human_eye 零代签）；`gate:code-size` 本包清（DesktopSettingsPanel 指纹重打、Icon +10 mic 图标留因；他方 WorkspaceFilePreview 红不碰）。
- 存量红如实归属：`ModelSelectorControls.test.tsx` 7 红（`ModelSelectorControls.tsx:6` 注明 BLOCK-518 思考合并 UI 已退役，测试仍为旧断言；本包零触碰该模块）。

## §4 实机（9223 隔离栈）

- `bash scripts/start-test-instance.sh` 离屏起栈（首启 network service 崩一次，重启后稳定），跑完即 kill 9223 监听者；**owner 3000/3001/9222 PID 未变（37503/37533/37670）**。
- `npm run verify -- settings-speech-section` **7/7 allPass**：S1 `?section=speech` 直达、S2 左栏「语音」active 且 core 6 组、S3 四块在、S4 检索/OCR 两块不在、S5 无外层折叠、S6 models 页可达、S7 models 页不含语音面板。证据=`acceptance/settings-speech-section/settings-speech-section-live-darwin.json` + `speech-section.png`（截图仅取证，观感待主人过目）。
- HMR 只读核对：Vite :3000 已服务新源（types.ts 命中 speech×2 / SettingsNav×1 / Panel×40），owner 窗口未重启。

## §5 边界

零新依赖、REST 面零改动、零默认值变更、功能零删除；观感零代签（in_progress、pending_human_eye）；提交留本地，push 等主人口令（全绿按代拍授权可推并 fetch 核实）。
