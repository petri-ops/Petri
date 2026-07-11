# Cross-Platform Compatibility Audit

最后更新：2026-07-11

目标：确认 `biof3-desktop` 在 Windows、Linux、macOS 上的实际可用性，避免把部署脚本、运行时逻辑和本地开发捷径混在一起。

## 结论

- 桌面应用主链路已按跨平台收口。
- 当前主线已把跨平台 runtime 变更集成进 `main`，并在 macOS 开发机通过语法检查、平台兼容单测、Harness 回归和 SPA 构建。
- 不再依赖 `vendor/biof3-core/node_modules` 的本地 junction。
- `plugin-manager` 安装 R 运行时时不再调用 `bash`，改为 Node 可执行脚本。
- `plugin-manager` 解压插件 zip 也已改为纯 Node 实现，不再依赖系统 `unzip` / PowerShell。
- `vendor/biof3-core/scripts/upload-plugin.js` 也已改为纯 Node 解压与哈希，不再依赖系统 `unzip` / `mktemp` / `rm` / `shasum`。
- `vendor/biof3-core/shared-backend/executors/*` 现在会按平台选择本地 runtime 二进制名，Windows 用 `Rscript.exe` / `R.exe` / `python.exe`，macOS / Linux 继续用各自的 Unix 名称。
- `vendor/biof3-core/py-server` 的 warm pool 和冷路径都改成复用同一套本地 Python binary 选择逻辑，不再硬写 `python3`。
- `src/plugin-manager.js` 现在会在恢复 runtime 插件时检查当前平台和可执行文件，macOS 旧 runtime 目录不会再把 Windows 的 `BIOF3_PY_HOME` / `BIOF3_R_HOME` 覆盖回去。
- Windows 上已实测：Python runtime 识别为 `D:\Programs\Python\Python312`，R runtime 识别为 `C:\Program Files\R\R-4.6.1`，`npm run dev` 能把 r-server / py-server 都拉起来。
- GitHub Actions 三平台 CI 矩阵尚未在当前主线确认存在；后续如要正式保证 Windows / Linux / macOS，应单独补 CI。

## 分层

### 运行时

这些会影响桌面应用本身，必须跨平台：

- `src/main.js` 中的 `process.platform` 分支，用于选择 `Rscript`、`python`、终端入口。
- `src/platform-compat.js` 汇总了跨平台命令选择逻辑，供 `src/main.js` 和 smoke tests 复用。
- `src/plugin-manager.js` 中的运行时安装逻辑。
- `extract-zip` 负责插件 zip 解压，避免系统命令分歧。
- `vendor/biof3-core/scripts/upload-plugin.js`，用于上传插件包时读取 zip 内 manifest。
- `scripts/fix-r-paths.mjs`，Windows / Linux 下直接跳过，macOS 下才做路径修正。
- `frontend/tsconfig.json` 和 `frontend/vite.config.ts` 中对 `react` / `react-dom` 的解析，已改为仓内配置，不依赖本地链接。

### 开发工具

这些是本地开发辅助，优先跨平台，但允许保留少量系统差异：

- `scripts/sync-vendor.mjs` 已是跨平台。
- `scripts/dev-electron.js` 仍按平台选择启动命令，这是合理差异。
- `scripts/dev-desktop.sh`、`scripts/sync-vendor.sh`、`scripts/fix-r-paths.sh` 仍是 POSIX 便利脚本，可保留作辅助入口。

### 部署 / 上游工具

这些主要服务于 `vendor/biof3-core` 的部署、镜像构建或服务器运维，允许保持 shell 形态：

- `vendor/biof3-core/deploy.sh`
- `vendor/biof3-core/scripts/*.sh`
- `vendor/biof3-core/infra/*.sh`

它们不是 desktop app 的直接运行阻断点，但会影响打包、运维和上游同步流程。

## 已验证

- `npm run check`
- `node --test test/platform-compat.test.mjs`
- `node --test test/harness-file-index.test.mjs test/agent-run-tool.test.mjs`
- `npm --prefix frontend run check`
- `node --check src/plugin-manager.js`
- `node --check scripts/fix-r-paths.mjs`
- `node scripts/fix-r-paths.mjs <dummy-r-home>` 在 Windows 上正确跳过
- `npm run check` / `npm --prefix frontend run check` / `npm run build:spa` 通过后，运行时链路仍保持正常。
- `node --check vendor/biof3-core/scripts/upload-plugin.js`
- 当前验证基线还包括 `node --check vendor/biof3-core/shared-backend/executors/r-executor.js`、`node --check vendor/biof3-core/shared-backend/executors/py-executor.js`、`node --check vendor/biof3-core/py-server/py-pool.js`、`node --check vendor/biof3-core/py-server/server.js`。

## 下一步

1. 继续盘点 `vendor/biof3-core` 里和 desktop 运行时直接相关的 shell 入口，决定哪些要保留为部署脚本，哪些要继续 Node 化。
2. 把 Harness Phase 2 接到前端项目页。
3. 最后再处理 vendor 里的平台说明和打包脚本边界。
