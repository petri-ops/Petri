# Stage 4 稳定版本收口台账

最后更新：2026-07-19
状态：**进行中**
主模块：`P-06 桌面集成与交付`
关注点：`C-01 安全`、`C-03 数据一致性`、`C-05 质量`、`C-06 性能`

## 1. 阶段边界

Stage 1–3 已完成出口验收。Stage 4 进入功能冻结：只处理发布阻断、数据错误、安全问题、明确回归和验收文档，不继续批量增加分析内容。

当前源码版本仍为 `0.0.1-rc.5`，线上最新版仍为 `rc.4`。本阶段尚未决定下一 RC 版本号，尚未上传新的桌面 DMG，也未创建发布标签。

## 2. 出口矩阵

| 门禁 | 当前状态 | 证据 / 剩余工作 |
|---|---|---|
| Stage 1–3 出口 | ✅ | UI、模型层、Harness/标准流程均已关闭 |
| 根项目全量测试 | ✅ | 2026-07-19：428 total / 417 pass / 11 skip / **0 fail** |
| 前端测试 | ✅ | 19 files / 147 tests |
| 静态与契约门禁 | ✅ | `npm run check`；Harness manifest 7/7；UI audit 通过 |
| 全新数据目录开发启动 | ✅ | 空库 migration version 0、25 张表；R `:3001`、Python `:3004` 健康 |
| macOS arm64 构建结构 | ✅ | `npm run build:mac-arm64`；App/Helper/Core native module 均为 arm64 |
| macOS arm64 打包态空目录启动 | ✅（结构级） | 临时空数据目录 + 已验证 runtime 软链接；migration、SPA `:3002`、R/Python、Python worker 全部健康 |
| 全新用户完整首用 | ⏳ | 仍需真实 runtime 获取、模型配置、项目创建、真实分析、结果解释；不得用已有 runtime 软链接替代最终结论 |
| 旧版数据迁移与兼容 | ⏳ | 从正式 `rc.4` 用户数据副本升级到候选版，核对数据库、设置、凭据引用、项目与历史结果 |
| macOS x64 | ⏳ | 需完成构建结构与必要实机验证 |
| OSS 更新链 | ⏳ | 下一候选版确定后，人工授权上传；验证 `latest-mac.yml`、SHA-512、DMG 下载与打开 |
| 安装级覆盖升级 | ⏳ | 从 `/Applications/BioF3.app` 旧 RC 按现有 DMG 流程人工覆盖，确认数据保留 |
| 安全与隐私 | ⏳ | 日志脱敏、诊断包、Keychain/0600 凭据、卸载后数据保留逐项复核 |
| 用户文档与发布说明 | ⏳ | 模型配置、标准流程、已知限制、安装/升级说明及候选版 release notes |
| 签名与公证 | ⚠️ 已知边界 | 当前无 Developer ID；若本版不签名/公证，必须在发布说明保留人工打开/覆盖安装说明 |

## 3. 第一批：原生 ABI 与首次启动基线

### 问题

electron-builder 会把根 `better-sqlite3` 重建为 Electron ABI，并在 `afterPack` 复制给打包后的 Core。构建完成后，开发启动的 migration 仍由系统 Node 执行，却从根 `node_modules` 加载 Electron ABI，导致 `NODE_MODULE_VERSION 123` / `131` 失败。此前把它列为“环境性允许失败”，不满足 Stage 4 的全量门禁和首次启动要求。

### 修复

- 开发态 migration 子进程通过 `BIOF3_BETTER_SQLITE3_ROOT` 明确加载 `core/r-server` 的系统 Node ABI 依赖。
- 打包态不设置该覆盖，继续使用 Electron Helper 与 electron-builder 重建的根 ABI。
- migration 单测使用同一 Core 依赖边界，不再取决于最后一次执行的是 build 还是 test。

### 验证

- `node --test test/migration-runner.test.mjs`：1/1。
- `npm test`：428 total / 417 pass / 11 skip / 0 fail。
- `npm test --prefix frontend`：147/147。
- `npm run check`：通过。
- 临时全新数据目录开发启动：migration version 0，SQLite 25 张表，R/Python 健康。
- `npm run build:mac-arm64`：成功生成本地 `rc.5` arm64 DMG（未上传）。
- 打包态临时空目录启动：migration、SPA、R/Python、Python worker 均健康；退出后端口与临时目录已清理。

## 4. 下一批顺序

1. 固定“全新用户完整首用”验收脚本/人工清单，验证 runtime 获取而不是复用现有安装。
2. 用只读副本执行 `rc.4 → 候选版` 数据与设置迁移审计。
3. 决定下一 RC 版本号；完成 arm64/x64 构建、校验和已知限制。
4. 经用户人工授权后发布 OSS，再做真实更新检查、下载、DMG 打开和覆盖安装。
5. 完成安全/隐私复核、用户文档、release notes 和最终发布决策。

任何 OSS 上传、正式 `/Applications` 覆盖、签名、公证和版本标签都需要单独确认；本台账中的本地验证不等同于发布完成。
