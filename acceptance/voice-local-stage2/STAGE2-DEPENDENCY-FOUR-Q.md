# BLOCK-519 阶段二 · whisper 并列依赖四问（2026-11-25）

> 发令：Orca bb8dddaf dispatch msg_a345c2faa02e（owner「按已批计划继续推进」，阶段二 whisper 并列 + composer 麦克风）。
> 本件=依赖四问留痕 + **V 裁决材料事实偏差纠偏**，供 owner 裁决具体包选型。零产品代码改动。

## §1 核真纠偏（C-32/C-43：先核外部真源）

V 裁决材料 §三写「whisper.cpp 独立 CLI 二进制（官方 releases 含 macos-arm64，Metal 加速）」。**该假设与官方 releases 不符**（WebSearch 2026-11-25 核真 + npm view 本机复核）：

- `ggml-org/whisper.cpp` 官方 release 资产：只有 `whisper-<tag>-xcframework.zip`（Apple 框架，非 CLI）+ Ubuntu/Win 预编译；**没有 macos-arm64 CLI zip**。
- stable 标签自 v1.9.4 起「Assets 2」（仅源码）；预编译二进制只在 `b*`  nightly（如 b5907）。
- `whisper-cli` 在 Apple Silicon 需 CMake 源码构建（Metal 默认开）或 Homebrew/Conda 外部安装——均为**新增构建工具链/外部依赖**，不符合 G0 开发期「不引入编译器依赖」的既定取舍。
- 模型文件真名 `ggml-*.bin`（非 `.gguf`）：`ggml-small.bin` 466 MiB / sha `55356645…`；`ggml-large-v3-turbo-q5_0.bin` 547 MiB / sha `e050f797…`；HF 仓库 MIT。

## §2 依赖四问（最合理路径 = npm binding）

1. **替代方案**：① npm binding `@fugood/whisper.node`（BRICKS 维护，MIT，darwin-arm64 Metal 预编译 optional dep，与阶段一 `sherpa-onnx-node` 同形态：native addon + worker 隔离 + 模型独立落盘）✅；② 源码构建 CLI（需 CMake/Xcode，违反既有零编译器取舍）❌；③ Homebrew/Conda（外部包管理依赖，不可随仓库分发）❌。→ 选 ①。
2. **许可证/维护度**：whisper.cpp + ggml + 模型权重均 MIT（核真）；`@fugood/whisper.node` README 标 MIT，`1.2.0-rc.2` 发布于 2026-11-09、稳定 `1.0.13`（2026-01-07），活跃维护。本机 `npm view` 确认包与 `@fugood/node-whisper-darwin-arm64@1.0.13` 均真实存在（无阶段一 `@k2-fs` 404 类风险）。
3. **影响面**：与阶段一同构——native addon 受 Node ABI 约束；worker 子进程隔离（模型加载在独立进程，不污染 owner dev）；模型放用户数据目录 `local-asr-models/` 不进仓库/打包产物；**这是第 2 个新依赖**。
4. **退出成本**：单一 wrapper（仿 `local-asr.js`）+ catalog 项；业务面只认 wrapper 契约，移除只需删 wrapper/manifest/依赖三处。

## §3 待 owner 裁决的偏差点

- 形态偏差：材料写「官方 CLI 二进制」，真值不可得 → 建议改走 npm binding（同阶段一形态）。
- 依赖计数：阶段一 1 新依赖 → 阶段二将成 2 新依赖（精确钉扎 `@fugood/whisper.node@1.0.13` 稳定版，不用 rc；平台包随 optional dep）。
- 这是产品级新依赖 + 材料事实偏差 —— 按裁决2「非判据决策点给一个最合理建议+理由，用户只回行/不行」，**请 owner 确认「行」后落依赖**，不擅自引入。

## §4 不依赖裁决、可先行部分

composer 麦克风入口（MediaRecorder → 分段 → 现有 `transcribe_audio` 链 → 文本进 composer）走**现有 local/deepseek provider 链**，不依赖 whisper 选型；可先 HK-01 红绿实现。whisper 落点待裁决后接线（作为 local 内部模型选择，回退链零变化）。

## §5 owner 裁决（2026-11-25 · msg_0077c4847060，回复 msg_c8a42ec9cbd7）

**裁决：行——采用 `@fugood/whisper.node@1.0.13` 作为 whisper 并列运行时（第 2 个新依赖）。** owner 依据：①V 材料前提（官方 macos-arm64 CLI）经核真不成立，属**材料事实偏差非方向偏差**——「本地 ASR、零编译器工具链、worker 隔离」的已批意图不变；②备选与阶段一 sherpa-onnx 同形态（npm binding/预编译/MIT），本机 `npm view` 确认存在无 404 风险；③owner 代拍授权覆盖「材料已齐的方案拍板」。

**条件（逐条执行）**：
1. 版本精确钉扎 `1.0.13`（不用 `^`/rc），package-lock 随批。
2. 本四问 + 本裁决（含核真证据链：WebSearch `ggml-org/whisper.cpp` releases 无 macos-arm64 CLI + HF `ggerganov/whisper.cpp` ggml-*.bin SHA + 本机 `npm view @fugood/whisper.node` / `@fugood/node-whisper-darwin-arm64@1.0.13` 存在）一并入 acceptance 留痕 ✓（本文件即留痕）。
3. 实测若发现包不可用/行为不符 → 停下回报，不硬换。
4. 回退链零变化（whisper 作为 local 内部模型选择，不改 `asr-provider` 的 local→deepseek 链）。

核真证据链：§1 WebSearch 来源 [1][2][3][6] + §2 本机 npm view 输出（version/dist-tags/platform dep）；裁决后实测腿结果另记入 EVIDENCE.md。
