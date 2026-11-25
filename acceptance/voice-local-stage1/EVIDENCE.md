# BLOCK-519 语音本地模型 SenseVoice 阶段一 · 证据（2026-11-25）

## HK-01 红绿先行

- 红：`node --test test/block519-local-asr.test.mjs` → 模块缺失 + 前端 3 条设置面契约红（写实现前）。
- 绿：后端 `test/block519-local-asr.test.mjs` **7/7** + 既有 `test/block454-p6-speech.test.mjs` **10/10**（旧错误码/成本/工具注册零回归）；前端 `ChannelPreferencePanel.test.tsx` **6/6**（三态切换、语言、模型列表下载/使用中/删除）。
- 测试覆盖：真实落盘才算安装（manifest 删模型文件即回落未安装）、download/SHA/原子移动幂等、schema additive 收窄、local→deepseek 回退轨迹与诚实全失败、transcribe_audio config 透传、REST 三口错误 400、worker 配置单源与 DYLD 子进程隔离。

## 真实 macOS arm64 实测（隔离 /tmp，不碰 owner 数据）

```
download: {"ok":true,"downloaded":true,"installed":true,"model":"sensevoice-small-int8-2024-07-17","path":"/tmp/petri-b519-real-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17","sha256":"7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e","elapsedMs":49755}
transcribe: {"ok":true,"provider":"local","text":"开饭时间早上9点至下午5点。","durationMs":598,"language":"auto","cost":{"requests":0,"bytes":178988}}
```

- 命令：`node /tmp/petri-b519-real-asr.cjs`（模型目录 `/tmp/petri-b519-real-models`，样例 wav 取自官方模型包 `test_wavs/zh.wav`）。
- native 前置：`DYLD_LIBRARY_PATH=<repo>/node_modules/sherpa-onnx-darwin-arm64 node -e "require('sherpa-onnx-node')"` → `OfflineRecognizer=function readWave=function`。
- 诚实边界：官方模型发布页未公布 SHA256 → 落盘后记录实测 sha 供审计，不伪造校验基线；chain 模式 local 不可用时回退 deepseek 并在回执标注来源。

## 依赖四问（立项检查单）

- 包名核真：裁决材料的 `@k2-fs/sherpa-onnx-node` npm 404 → 实际 `sherpa-onnx-node@2.0.3`（Apache-2.0，2026-11-22 维护；darwin-arm64 预编译 optional dep）；根 `package.json` 精确钉扎、package-lock 随批。
- 四问结论、用户裁决留痕、退出成本见 `acceptance/voice-local-model/V-DECISION-MATERIAL-2026-11-25.md` §7.2。**本包 1 新依赖**（不再适用「0 新依赖」表述）。

## HMR / owner 实例

- vite `56574`(:3000) · Electron `56602`(CDP :9222) · 后端 `56743`(:3001) 前后同 PID，未 kill/restart。
- `curl :3000/.../ChannelPreferencePanel.tsx` → 服务新源（含本地 SenseVoice 选项与模型列表控件）；CDP 只读检查 owner 页面 readyState=complete、无旧 UI 残留。前端改动靠 vite HMR 落 owner 窗口。

## 门禁（2026-11-25 收口）

- `test:changed` 终值 **6630 pass / 38 fail**。本包可归因红已逐条清掉（W5a 新测试挂规则、acceptance 目录映射、platform 分支冻结、silent-catch 注释留痕、code-size 带理由重打、lint/types 0）；余下 38 红均为存量/他方归属：工具基线 118/120 族（block113/block116/block157/tool-activity-labels/block325）、BLOCK-462 three-live 环境漂移族、P6 证据源绑定、K3/K-15、W5b、BLOCK-477 G2、C-52/C-53 设计基线快照、capability-bundles registry sha、分片契约旧口径（递归计划 vs 顶层计数）、`acceptance/visual-refresh-2026-11-25/` 未跟踪 WIP——本包对以上源码/证据零触碰，不伪造绿。
- 前四门：audit:compact / hygiene / docs:check（672 注册文档）/ ui:audit:check 全 PASS；ui:audit:triage 已同步。
- 静态门单跑 PASS：user-assets / version-parity / silent-catch / code-size（config-schema 增长带显式理由重打）/ css-modules / secret / arch / lint（0 error）/ types（0）/ knip:check。
- arch-cycles 的 goal-tools→automation-store→registry 环与 post-h9 K-15 debt 计数漂移均为 HEAD 存量（相关源码零触碰）；tracked-consistency 在新增文件入提交后自清。
- 依赖：1 新依赖 `sherpa-onnx-node@2.0.3`（精确钉扎，package-lock 随批），不再适用「0 新依赖」表述。G0 开发期常态 · 不外推 packaged/Provider/GA。
