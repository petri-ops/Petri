# BLOCK-350 性能基线报告（2026-11-05）

- 计划：`docs/block-350-performance-baseline-plan.md`；总纲：`docs/next-phase-program-2026-11-05.md` 包 3/7
- 采集器：`scripts/block350-perf-collect.mjs`；门：`npm run quality:perf`（`scripts/block350-perf-gate.mjs`，comparePerf 纯函数 + 负测契约 `test/block350-perf-gate.test.mjs` 6/6）
- 基线：`test/perf-baseline.json`（generatedAt / host / coreSha / 各场景 samples+medianMs+tolerancePct+noiseSources）
- 判红规则（冻结）：当次样本 > 基线中位 × (1 + 容差%) → 红；无样本 fail-closed 红；skipped 场景透传原因不参与判定
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**；本机 dev 口径，不宣称跨机/CI 可比

## 1. 四场景数值（本机 dev 口径，2026-11-05）

| 场景 | 指标 | 采样 | 中位 | 容差 | 阈值 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| ① cold_start | 隔离后端 spawn→/api/health 200（含 migrations 自举；mode=mock） | 5 | **546ms** | +60% | 874ms | 基线在案 |
| ② long_conversation | 1000 条消息会话：分页 API 首页+全量滚动 20 页（真实 DDL 直插种子） | 5 | **20ms** | +60% | 32ms | 基线在案 |
| ③ big_project_tree | 520 文件工作区：tree 分页读全 3 页（200/页，API 层） | 5 | **12ms** | +60% | 20ms | 基线在案 |
| ④ packaged_start | 打包 app 启动→自 spawn 后端 health | 3 | — | +80% | — | **skipped（环境不可得，见 §3）** |

复跑命令：

```bash
node scripts/block350-perf-collect.mjs                                   # 全量重建基线（覆盖式合并）
node scripts/block350-perf-collect.mjs --only=cold_start                 # 单场景
npm run quality:perf                                                     # 门：每场景 1 样本 vs 基线判红绿
```

## 2. 波动源与容差依据（冻结，禁事后调门）

- **cold_start**：SQLite WAL 首建 / migrations 全量执行 / 磁盘缓存冷热。实测样本极稳（542–546ms，极差 <1%）→ +60% 容差只防数量级退化（进程级首启劣化如 npm rebuild 错 ABI 会呈数倍劣化即红）。
- **long_conversation**：SQLite 页缓存 / better-sqlite3 async 桥。种子=真实 DDL 直插（每条 ~240 字负载、user/assistant 交替、rowid 游标分页 20 页）。样本 20–24ms。+60%。
- **big_project_tree**：目录 FS 缓存 / 分页重复扫描前缀。样本 11–15ms。+60%。口径注记：`workspace_search` 是 agent 工具、无独立 REST 面（采集期实机核实），检索时延以「全量分页读」承载（同走 FS 扫描路径）。
- **packaged_start**（补建时适用）：LaunchServices/Gatekeeper 评估 / userData 首建 migrations / 轮询粒度 300ms。容差 +80%（首启外部因素最多）。

## 3. ④ 打包态启动：skipped（环境不可得）与交接

- 本机构建 `npm run build:mac-arm64` 成功（`dist/mac-arm64/Petri.app`，exit 0）。
- headless 启动实测：直启二进制（spawn+env/管道 stdio）、`open`（LaunchServices）、g0 stdout 配方**三种启动全部静默挂起**——主进程存活（S 态 0% CPU）、无 stdout/无子进程/无监听端口，180s 窗口不就绪；`ELECTRON_ENABLE_LOGGING=1` 亦零输出。判读=TCC/Gatekeeper 首启许可需 GUI 会话在场，headless 建不起来（证据链见采集器注释与本次报告）。
- **处置**：④ 基线 skipped（gate 透传原因不参与判定）；**BLOCK-353（打包回归，GUI 会话在场）用同一采集器 `--only=packaged_start` 补建基线并回填本文件**。
- 顺带事实：electron-builder 构建会把 `node_modules/better-sqlite3` 重编为 Electron ABI（node 侧 `ERR_DLOPEN_FAILED`）——构建后需 `npm rebuild better-sqlite3` 恢复 node 侧（本包已执行；后续包构建后同理）。

## 4. 门接线

- `package.json`：`quality:perf` 新门；`closeout` 门序列 14 → 15（`--gate quality:perf` 插入）。P6 源绑定：package.json 变更随本包提交后 worktree==HEAD，P6 契约按既有机制复验（closeout test:changed 含之）。
- 负测契约（`test/block350-perf-gate.test.mjs` 6/6）：正常判绿 / 劣化判红 / 无样本 fail-closed 红 / skipped 透传 / 阈值公式行为 / 基线文件四场景齐备（skipped 须带原因）。
- 「抬高基线」负测说明：基线文件入 git 棘轮，改 median = 显式 diff 可审计；阈值公式以单测固化（baseline×(1+tol)），基线被抬高时同一样本相对判绿属公式正确行为，防篡改靠 diff 审查而非运行时检测（如实说明）。

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
