# Stage 4 稳定版本收口台账

最后更新：2026-08-16（GATES-4 单行修订：rc.6 收口台账 + rc.7 当前基线指针）
状态：**✅ arm64 RC 发布验收完成**
主模块：`P-06 桌面集成与交付`
关注点：`C-01 安全`、`C-03 数据一致性`、`C-05 质量`、`C-06 性能`

## 1. 阶段边界

Stage 1–3 已完成出口验收。Stage 4 进入功能冻结：只处理发布阻断、数据错误、安全问题、明确回归和验收文档，不继续批量增加分析内容。

本台账记录 `0.0.1-rc.6` 收口；当前 OSS 基线 `0.0.1-rc.7`（`ab519fa`），见 [`releases/v0.0.1-rc.7.md`](./releases/v0.0.1-rc.7.md) 与 [`next-steps-roadmap.md`](./next-steps-roadmap.md) §已完成基线。

## 2. 出口矩阵

| 门禁 | 当前状态 | 证据 / 剩余工作 |
|---|---|---|
| Stage 1–3 出口 | ✅ | UI、模型层、Harness/标准流程均已关闭 |
| 根项目全量测试 | ✅ | 2026-07-19：432 total / 421 pass / 11 skip / **0 fail** |
| 前端测试 | ✅ | 19 files / 147 tests |
| 静态与契约门禁 | ✅ | `npm run check`；Harness manifest 7/7；UI audit 通过 |
| 全新数据目录开发启动 | ✅ | 空库 migration version 0、25 张表；R `:3001`、Python `:3004` 健康 |
| macOS arm64 构建结构 | ✅ | `npm run build:mac-arm64`；App/Helper/Core native module 均为 arm64 |
| macOS arm64 打包态空目录启动 | ✅ | migration、SPA、R/Python、Python worker 全部健康 |
| 全新用户完整首用 | ✅ | 真实 OSS Runtime 首装：R 4.5.2 + Python 3.11.15；项目沙盒 DESeq2 `completed` + ZIP + 1.6 MB final report；go-kegg 首次自动 provision bundle，37/37 valid |
| 旧版数据迁移与兼容 | ✅ | 正式 rc.4 与候选版先后启动同一只读数据副本；SQLite integrity、30 表、项目/任务/对话计数及设置/插件账本哈希一致 |
| macOS x64 | ⚠️ 部分 | App/Helper/Core 均 x86_64，Rosetta 空目录启动与 SPA 通过；没有 x64 Runtime artifact，分析能力不宣称支持 |
| OSS 更新链 | ✅ | `v0.0.1-rc.6` tag 与 main 已推送；双 DMG、SHA-256 和清单上传完成；rc.4→rc.6 更新选择、194522883-byte 下载与 SHA-512 通过 |
| 安装级覆盖升级 | ✅（RC 边界） | 公开 arm64 DMG 校验并只读挂载，包内版本/架构为 rc.6/arm64；保留未签名版本的人工拖入 Applications 边界，未破坏 rc.4 回滚点 |
| 安全与隐私 | ✅ | Keychain/0600 门禁通过；诊断包改为脱敏日志+最小摘要，排除 DB、设置、对话、结果与凭据；卸载 App 不删除 Documents 数据 |
| 用户文档与发布说明 | ✅ | `docs/releases/v0.0.1-rc.6.md` + 本台账 + first-success 合同 |
| 签名与公证 | ⚠️ 已知边界 | 当前无 Developer ID；若本版不签名/公证，必须在发布说明保留人工打开/覆盖安装说明 |

## 3. 第一批：原生 ABI 与首次启动基线

### 问题

electron-builder 会把根 `better-sqlite3` 重建为 Electron ABI，并在 `afterPack` 复制给打包后的 Core。构建完成后，开发启动的 migration 仍由系统 Node 执行，却从根 `node_modules` 加载 Electron ABI，导致 `NODE_MODULE_VERSION 123` / `131` 失败。此前把它列为“环境性允许失败”，不满足 Stage 4 的全量门禁和首次启动要求。

### 修复

- 开发态 migration 子进程通过 `PETRI_BETTER_SQLITE3_ROOT` 明确加载 `core/r-server` 的系统 Node ABI 依赖。
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

## 4. 第二批实机证据

- Runtime 线上原件：R ZIP `154050101` bytes，SHA-256 `007b6c...a1d2`；Python ZIP `480914965` bytes，SHA-256 `a3ba85...1e12`；ZIP 完整性通过并回填内置清单。
- 修复远程旧版 manifest 覆盖新版 artifact 契约的问题；首装脚本走真实 `installPlugin` 入口。
- 修复打包缺少 `fix-r-paths.mjs`；隔离 R 首装实际扫描 74 个 `.so`，残留 framework 引用为 0。
- 修复 DESeq2 缺 ZIP/报告模板和 golden-path 旧报告响应契约；最终任务 `job_828eacaf0e9741ea` 为 `completed`、run.json `passed`。
- 最终打包冒烟发现并修复 archiver v8 ESM / Electron Node 20 的加载边界；重构建后任务 `job_b8e9474e421b4800` 为 `completed`，2.4 MB ZIP 和 1,636,850-byte 报告均由打包 App 产生。
- go-kegg 首次自动 provision `r-enrichment`，任务 `job_4fab81993e6e4536` 为 37/37 valid、0 issues，证明 ggplot2 4.0.3 真渲染兼容。
- 2026-07-19 Provider 重测：DeepSeek 必需项通过但结果解释探针未复述英文通路名；Anthropic 自定义 Endpoint 当时返回 `api_error`。Stage 3 既有双 Provider 6/6 证据保留，外部服务波动不冒充本地发行成功。

## 5. 发布结果

1. ✅ 最终全量回归并重建 rc.6 双架构 DMG。
2. ✅ 提交并推送 main；不可变 `v0.0.1-rc.6` 标签指向发布提交 `907b695`。
3. ✅ 上传 OSS；匿名核对清单、SHA-256、大小、SHA-512 和 arm64 更新选择。
4. ✅ 从公开地址下载并只读挂载 arm64 DMG；包内版本 `0.0.1-rc.6`、可执行文件 arm64。

Stage 4 对 macOS arm64 RC 的出口已满足。签名/公证与 x64 分析 Runtime 仍是下一发行层级的明确边界；不得将 unsigned RC 描述成 GA。
