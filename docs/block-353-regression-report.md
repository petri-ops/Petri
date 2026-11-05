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
| 3 | **asar 内主进程模块图 core 相对 require 断链（C-48 首次暴露）** | `files` 只把 `src`+`node_modules` 打进 asar，`core/` 走 extraResources 到 Resources/core；主进程从 asar 加载的模块图里十余处 `../../core/...` 相对 require 在打包态落在 asar 内部 → 加载即抛 Cannot find module → 弹错误框后退出（用户截图钉死 `scheme.js:17 data-paths`）；「静默挂起」实为该错误框在终端会话里无法渲染、挂着等人点 | 全图静态 require 路由 `resolveCore`（dev=repo/core、packaged=Resources/core）+ env-coordinator 双态兜底；afterPack 把 `core/shared-backend`+`core/packages` 注入 asar（198 文件）作第二层兜底；tripwire 禁静态相对 require 复发 |
| 4 | **后端 boot 崩循环 + repack / 依赖三类收尾缺口** | ①`@electron/rebuild` 的 Electron-ABI 产物实落 `node_modules/better-sqlite3/bin/darwin-arm64-149/`，353 假定的 `build/Release` 仍是 Node-ABI 137 → 后端 `ERR_DLOPEN_FAILED`、supervisor 30s 无限重启（GUI 假象=「窗口在、后端没起」）；②`createPackage` 是 async 未 await、重打包丢 `*.node` unpack 规则、`appPath` 未定义致 ad-hoc 重签静默失效；③extraResources 不复制 `core/petri-server/node_modules`，multer 等 13 包缺位 → Files/Knowledge 路由 fail-open 丢失 | afterPack 改「候选枚举 + Electron Helper 实测 dlopen」选源（fail-closed，构建期即红）；`await createPackageWithOptions(..., {unpack:'**/*.node'})` + 正确 bundle 路径重签；core 侧独有包合并进解出树（不覆盖 ABI 权威副本）；产物 tripwire 加 ABI / multer 断言 |

**运维铁律（2026-11-05 C-48 修订）**：`npx electron-builder install-app-deps` → `npm run build:mac-arm64` → 产物验收（`node --test test/block353-artifact-check.test.mjs` + `codesign -vv --deep --strict` + GUI 直启）。**末尾 `npm rebuild better-sqlite3` 已不需要**：dev 用的 `build/Release` 从未被替换，Electron-ABI 产物是 `bin/darwin-arm64-149/` 里的独立副本，afterPack 自行实测选源并拷入产物，构建链不再污染 dev 栈；ABI 不匹配由 afterPack fail-closed 在构建期拦下，不再产出坏包。

## 3. 与 dev 的一致性对照

| 维度 | dev | packaged | 判定 |
| --- | --- | --- | --- |
| 后端健康 | :3001 `{"status":"ok"}` | :3105 `{"status":"ok"}`（ready 1s） | 一致 |
| migration | 25 表级 | 21 SQL 文件 / 71 表（空库全量自举） | 一致 |
| R/Python 探针 | r.installed=true / python=true | 同 | 一致 |
| T2 数据任务 | completed（dev 基线 criteria 8/8） | completed；cleaned.csv 规范化日期 ✓ / chart SVG ✓ / summary 33 行 ✓ / real provider ✓ | 一致 |
| 事件轨迹 | SSE 事件流（tool_call/done） | terminal=done 留痕（事件端点为 SSE 流式、headless 采集器以 meta 轮询取终态——**采集口径差异**，非产品差异；产物判据为权威） | 一致（口径注记） |
| SPA | Vite :3000 / 打包窗口载 frontend/dist | headless 无窗口；frontend/dist/index.html 在产物内（结构核对 ✓） | 一致（headless 口径） |

**差异清单（2026-11-05 C-48 收口后修订）**：后端链一致=true；原「GUI 主进程 init 挂起=未解决」**判断作废**——用户错误框截图证明框架 init 已完成，真因是 require 断链弹框 + 后端 ABI 崩循环（§2 缺陷 3/4），与 TCC / AMFI / entitlements 无关，「lldb/AMFI 深挖」候选整体作废。本轮修复后打包 GUI 直启全链路可用（证据 §6）；SPA=false 仅为 353 当时的 headless 采集口径，非当前实机结论。

## 4. 遗留与交接

- **④ packaged 性能基线已补建**：headless 后端口径（ELECTRON_RUN_AS_NODE 跑 Resources/core，空数据目录+打包迁移）实测 **469ms**（采样 3：597/421/469，容差 +80%）；gate min-of-2 采样（防单次冷跑假红）后 quality:perf **4 绿 0 红 0 skip**；BLOCK-350 交接项闭环。
- GUI app 直启：~~reopen 待用户实机~~ → **2026-11-05 C-48 已实机验证通过**（§6）；屏幕观感与 Agent 点击体感仍待人工确认（Agent 不代答）。
- `content-sync` 死 require 为 fail-open 警告（模块已退役），非阻断；原生依赖补齐后最终会话日志仅剩此一条。
- sign/notarize/更新链：G1+，未触碰；本机 ad-hoc 重签仅为让无证书产物可启动，非签名/公证结论。

## 5. ④ 性能基线补建（BLOCK-350 交接项闭环）

- 本包修复 boot 链后，`packaged_start` 场景以「打包二进制 ELECTRON_RUN_AS_NODE 跑 Resources/core 后端（空数据目录 + 打包迁移 21 SQL）→ health」为 headless 可达口径补建：数值落 `test/perf-baseline.json`（采样 3：597/421/469、中位 429→469ms、容差 +80%）；gate 采样改 min-of-2（单次冷跑抖动 35/45 vs 中位 20 会假红，min-of-2 仍抓数量级退化——负测语义不变）后 quality:perf **PASS 4 绿**。

## 6. C-48 补记：打包 GUI 直启闭环（2026-11-05）

- **起因**：用户实机错误框 `app.asar/src/main/pack-ui/scheme.js:17 Cannot find module '../../../core/shared-backend/data-paths'`。能弹框即框架 init 已完成，点「好」退出被误读为「静默挂起」；此前的 TCC/Gatekeeper/AMFI 判断整体推翻。
- **修复**：§2 缺陷 3/4；主图 require 全量路由 `resolveCore`（`src/**` 十余文件），`build/afterPack.js` 负责 ABI 选源、asar 重打包、核心依赖补齐与 ad-hoc 重签；机械防复发在 `test/block353-artifact-check.test.mjs`。
- **构建链**：`install-app-deps` → `build:mac-arm64` → 产物验收；`dist/Petri-0.0.1-rc.7-arm64.dmg` 15:40 重打（208 MB），**不再是补丁前的坏 DMG**。
- **实机证据（目录版直启）**：主进程 + GPU/network/renderer helper + 后端子进程（`Petri Helper .../core/petri-server/server.js`，:53575）；`/api/health`=`{"status":"ok","db_ok":true}`；SPA :3002=200；`[renderer] page loaded` 且窗口有焦点；executors r/python、storage、全部 llm-providers、plugins loaded 注册成功；最终会话日志除 `content-sync` 死 require 外无 `Cannot find module`。
- **产物证据**：目录版与 DMG 内 app `codesign -vv --deep --strict` = valid on disk / satisfies DR；asar `core/` 198 文件 + 5 个 unpack 原生文件；4 份 `better_sqlite3.node` 经 Helper 实测 dlopen 全 OK（ABI 149）；`multer`/`busboy`/`pdfjs-dist` 在场。
- **回归**：tripwire 4/4；ABI 项先以坏包跑出红（`NODE_MODULE_VERSION 137`），修复构建后转绿，红→绿证据完整。
- **边界**：屏幕观感与 Agent 功能点击体感需用户确认，Agent 不代答；dev 栈未受构建链影响（`build/Release` 未替换）。

*G0 开发期常态 · 不外推 packaged / Provider / GA。*
