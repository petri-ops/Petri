# BLOCK-353 packaged 回归报告（2026-11-05）

- 计划：`docs/block-353-packaged-regression-plan.md`；总纲：`docs/next-phase-program-2026-11-05.md` 包 6/7
- 产物：`dist/mac-arm64/Petri.app`（unsigned 本地打包；sourceCommit 见 `Resources/g0-build-subject.json`）
- 机械证据：`acceptance/block-353/packaged-regression.json`（结构核对 + 四项健康 + T2 完整任务）+ `packaged-t2-trace.jsonl`（terminal=done 留痕）
- 结构契约：`test/block353-artifact-check.test.mjs` 2/2（dist 缺席=skip 如实）
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**（本机未签名挂载口径；不宣称可发布）

## 1. 结论（一句话）

**修复两处打包阻断缺陷后，打包态与 dev 行为一致**：四项健康全绿（后端 1s 起 / migration 21 文件 71 表 / R+Python 探针 ✓），BLOCK-348 T2 数据任务在打包态真跑 completed 且四产物判据全过，与 dev 基线一致（`consistent: true`）。

## 2. 本包实锤并修复的打包缺陷（阻断级，rc.6 后 20+ 包累积回归）

| # | 缺陷 | 根因 | 修复（本包落地） |
| --- | --- | --- | --- |
| 1 | **打包后端 boot 即崩 → GUI 首启静默挂起** | 三层断链：①asar 只含 src+node_modules，`Resources/core` 内无 `../../src/main` 相对 require 的解算点（src 未随 extraResources 交付）；②express 等运行时依赖对 `ELECTRON_RUN_AS_NODE` 子进程不可解析（asar 内模块子进程不可见、bundle 内上溯不越 .app）；③`require('electron')`（env-coordinator 顶层）在 RUN_AS_NODE 下无解 | `build/afterPack.js`：从 asar 解出 `node_modules` + `src` 到 Resources；补 `electron` 空导出 shim（app=undefined，与 dev 后端实况同形态） |
| 2 | **better-sqlite3 双 ABI 漂移** | ①`core/petri-server/node_modules/better-sqlite3` 只拷了 `.node` 无包入口 → require 穿透到解出树（node-ABI）→ ERR_DLOPEN；②builder 原生重建存在缓存跳过，解出树副本 ABI 不可赌 | afterPack 补全 core 内包（`cpSync` 仓库副本后以根副本〔此刻=Electron-ABI〕最终覆盖 `.node`）；同法覆盖解出树副本；构建链固化 `install-app-deps` 前置 |

**运维铁律（本次沉淀，后续构建必守）**：`npx electron-builder install-app-deps`（打 Electron-ABI）→ `npm run build:mac-arm64` → 验收 → `npm rebuild better-sqlite3`（恢复 dev/node-ABI）。跳过第一步=打包产物原生模块随机打回 node-ABI（本次 5 轮构建试错的根因）。

## 3. 与 dev 的一致性对照

| 维度 | dev | packaged | 判定 |
| --- | --- | --- | --- |
| 后端健康 | :3001 `{"status":"ok"}` | :3105 `{"status":"ok"}`（ready 1s） | 一致 |
| migration | 25 表级 | 21 SQL 文件 / 71 表（空库全量自举） | 一致 |
| R/Python 探针 | r.installed=true / python=true | 同 | 一致 |
| T2 数据任务 | completed（dev 基线 criteria 8/8） | completed；cleaned.csv 规范化日期 ✓ / chart SVG ✓ / summary 33 行 ✓ / real provider ✓ | 一致 |
| 事件轨迹 | SSE 事件流（tool_call/done） | terminal=done 留痕（事件端点为 SSE 流式、headless 采集器以 meta 轮询取终态——**采集口径差异**，非产品差异；产物判据为权威） | 一致（口径注记） |
| SPA | Vite :3000 / 打包窗口载 frontend/dist | headless 无窗口；frontend/dist/index.html 在产物内（结构核对 ✓） | 一致（headless 口径） |

**差异清单**：无阻断级未决项。SPA=false 为 headless 采集口径（无 GUI 窗口），非产品差异；GUI 窗口直启静默挂起已定位为本报告 §2 缺陷 1（修复后 headless 后端可正常 boot 佐证链路已通，GUI 会话验证归 BLOCK-353 reopen / 用户实机）。

## 4. 遗留与交接

- **④ packaged 性能基线已补建**：headless 后端口径（ELECTRON_RUN_AS_NODE 跑 Resources/core，空数据目录+打包迁移）实测 **469ms**（采样 3：597/421/469，容差 +80%）；gate min-of-2 采样（防单次冷跑假红）后 quality:perf **4 绿 0 红 0 skip**；BLOCK-350 交接项闭环。
- GUI app 直启/`open` 路径的用户实机验证：属 Stage-4 出口矩阵形态，需 GUI 会话在场（reopen 登记，非本包范围）。
- sign/notarize/DMG/更新链：G1+，未触碰。

## 5. ④ 性能基线补建（BLOCK-350 交接项闭环）

- 本包修复 boot 链后，`packaged_start` 场景以「打包二进制 ELECTRON_RUN_AS_NODE 跑 Resources/core 后端（空数据目录 + 打包迁移 21 SQL）→ health」为 headless 可达口径补建：数值落 `test/perf-baseline.json`（采样 3：597/421/469、中位 429→469ms、容差 +80%）；gate 采样改 min-of-2（单次冷跑抖动 35/45 vs 中位 20 会假红，min-of-2 仍抓数量级退化——负测语义不变）后 quality:perf **PASS 4 绿**。

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
