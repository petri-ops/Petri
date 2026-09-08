# BLOCK-66 — 运行时解耦：R 硬门摘除，biof3-server 无 R 可用

> 状态：`active`（2026-09-08 P0–P3 完成：P0 摸底/设计确认（B 档用户拍板）→ P1 摘门 + 语义拆分 → P2 前端非阻塞化（UI-312）→ P3 实机（后端两态 + preflight allPass；**GUI 目视验收因 agent 会话无法启动 GUI Electron 留手动验收**，命令见 `acceptance/block-66/p3-live.json` guiPhase.manual；用户实机核对后转 completed）。G0 开发期常态 · 不外推 packaged/Provider/GA）
> 立项日期：2026-09-08（用户裁决「新开一个 BLOCK」）
> truthDomain: `block-66-runtime-decouple`
> 来源：用户反馈「软件打开需要直接安装 python 和 r 的基础包，这个有些重了」「作为一个通用的 agent 不做生物信息任务的情况下是否是必要的」→ 本会话源码评估确认 R 硬门为历史遗留 → 用户裁决立项

## 1. 问题定位（源码事实基线，2026-09-08 评估实测）

**现象**：首启被全屏「先安装分析运行时」引导页挡住，必须从商店下载 R 运行时（macOS arm64 约 531MB / Windows x64 约 627MB，R 4.5.2 + Bioconductor 70+ 包）并**重启应用**后才能使用任何功能；不做生信任务的通用用户同样被挡。

**事实链**（评估探索已逐点核实）：

1. **硬门本体**：[backend-proc-manager.js:206-210](../src/main/backend-proc-manager.js) `startRServer()` 开头 `if (!process.env.BIOF3_R_HOME || !fs.existsSync(...)) return { ok:false }` → biof3-server（唯一业务后端）拒绝启动。
2. **误设根因**：biof3-server 是**纯 Node/JS 进程**（[server.js](../core/biof3-server/server.js)），R 仅在 R 类插件执行时由 tools-executor 每任务独立 spawn Rscript 子进程（BLOCK-51 P3 已摘 plumber shell、BLOCK-30 已摘 py-server，`backend-proc-manager.js` 内注释自证「R 实际单轨 = tools-executor 每任务独立 Rscript 子进程」）。`startRServer` 是历史名，启动本身对 R 无真实依赖（隐藏依赖排查见 P0）。
3. **前端门**：[home.tsx:290-294](../frontend/src/pages/home.tsx) `runtimeMissing = loaded && rRuntime === false` → `needsSetupGate` 时整个首页被引导页替换（:382「先安装分析运行时」；:392 R「必需」约 657MB；:400 Python「推荐」约 503MB；:421-427 装完要求重启——`BIOF3_R_HOME` 仅启动时注入）。
4. **健康语义**：[backend-health.js:71-94](../src/backend-health.js) `isReady` 最低要求 = `rServerUp` → R 缺失即 `backend:status.isReady=false`，放大为全应用不可用。
5. **Python 本不是门**：无独立进程（BLOCK-30 起内嵌进 biof3-server 执行），缺失只影响 Python 类插件。
6. **安装链本身健康、本包不动**：OSS 按需下载（阿里云 `biof3-uploads` bucket）+ sha256/sizeBytes fail-closed 双校验（[plugin/io.js:94](../src/plugin/io.js) 声明门 + [plugin-manager.js:188-203](../src/plugin-manager.js) 下载后校验）+ 商店安装（[plugin-manager.js:171-258](../src/plugin-manager.js) `installRuntime`）。ec28e51b（2026-09-02）刚修复过该校验链。

## 2. 设计裁决

1. **R 从「后端硬门」降级为「分析运行时组件」**：biof3-server 无条件启动（Node 进程不依赖 R）；R 缺失时应用全功能可用，仅 R 类插件/skills 执行时诚实失败 + 内联指引（商店入口）。
2. **健康语义拆分**：`isReady` 表达「后端进程可用」，运行时就绪度为独立字段（additive 优先，不删 `rServerUp`，只解除 `isReady` 对它的硬依赖）；degraded 态在既有展示位（`BackendStatusProvider` 轮询 / `WorkspaceSummaryCard` 运行时区）表达，不新增第二套状态真相。
3. **前端门非阻塞化**：home.tsx 全屏引导页改为**可跳过**（进入应用 + 显著但非阻塞的引导入口），设置页运行时管理入口保留；文案复核（「必需」→ 精确表述「R 分析功能需要」，数字与 manifest 声明对齐）。
4. **不动安装链**：OSS 下载 / fail-closed 校验 / 商店安装逻辑零改动。
5. **「装完免重启」默认不在本包**：`BIOF3_R_HOME` 改执行时解析可消除重启，但属额外范围，P0 摸底后单独裁决是否追加。
6. 0 新 npm 依赖。

## 3. 阶段

- **P0 摸底 / 设计确认**：① biof3-server 启动路径隐藏 R 依赖排查（启动时版本探测 / fail-closed 检查 / 环境变量消费面）；② `backend-health` isReady 消费方盘点（home.tsx / BackendStatusProvider / WorkspaceSummaryCard / desktopBridge / electron.d.ts）；③ degraded 语义与引导页去向的设计裁决（细化 §2）。产出设计评审小节，经用户确认再进 P1。
- **P1 摘门（主进程）**：`startRServer` 硬门移除（`BIOF3_R_HOME` 缺失照常 spawn biof3-server）+ `backend-health` 语义拆分 + R 类执行路径诚实失败核对（tools-executor 既有 not-ready 路径复用，核对文案与商店指引可达性）+ 定向测试（backend-proc-manager / backend-health）。
- **P2 前端门控非阻塞化**：home.tsx 引导页改可跳过 + 文案修正；degraded 展示复用既有运行时展示位；`electron.d.ts` additive 更新。
- **P3 实机收口**：dev Electron 两态实机——无 R 状态（隔离 userData / 空 runtimes 目录：对话 / 文件 / 通用功能可用，R 插件执行诚实指引，无全屏硬门）+ 装 R 后全功能恢复 + 已装 R 用户零回归；证据 `acceptance/block-66/`；台账回写；门禁。

## 4. 验收

- 无 R 干净环境启动 dev Electron：窗口可用、对话 / 文件浏览可用、`backend:status` 反映 degraded 而非 dead、无全屏硬门。
- R 类插件执行：诚实失败 + 指引（不崩溃、不静默、可直达商店入口）。
- 经现有商店链安装 R 后：R 分析功能恢复，行为与现状一致。
- 已装 R 环境零回归（有 R 路径行为不变）。
- 定向测试 + tsc 0 + `ui:audit:check` + `docs:check`；收口 `docs:reconcile`。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 启动路径存在隐藏 R 依赖，摘门后 server 起但功能崩 | P0 摸底先行；P1 无 R 冒烟前置 |
| `isReady` 语义变更破坏消费方 | P0 消费方全量盘点；additive 字段优先，不删既有字段 |
| 引导页可跳过后用户不知如何装 R | 设置页入口保留 + R 类执行失败时内联指引直达商店 |
| 已装 R 用户行为漂移 | 有 R 路径零改动；P3 显式回归验证 |
| 与 UI-305 的文档/代码冲突 | 单工作包串行：本包 planned 排队，UI-305 收口后才启动 |

## 6. 治理边界

- 排队纪律：UI-305 处理中（用户 2026-09-08 告知另一 agent 全面处理），本包 `planned` 排队，启动需 UI-305 收口后用户裁决。
- **范围外（另行候选，不在本包）**：R runtime 瘦身 / 科学包分层（base 解释器 + Bioconductor 拆分，BLOCK-58 `_dependencies.json` 治理为基础）；runtime 内嵌安装包（G1+ 候选）；「装完免重启」（P0 后单独裁决）；BLOCK-57 后续（远程交互会话 / Slurm）。
- 0 新 npm 依赖；不动 OSS 安装链与 fail-closed 校验。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 7. 进度记录

- 2026-09-08 **planned 登记**：用户反馈首启强制装 R 过重 → 本会话源码评估确认 R 硬门为历史遗留（`startRServer` 名不副实，biof3-server 为纯 Node 进程，R 仅执行期 per-task spawn）→ 用户裁决「新开一个 BLOCK」。本计划落盘 + DOC-REGISTRY 注册 + roadmap 排队条目。**编号说明（2026-09-08 撞车校正）**：本包立项时曾登记 BLOCK-63；同日另一 agent 将「Windows 电脑控制」立项为 `BLOCK-63-WINDOWS-COMPUTER-USE` 并已 push（含 P1 实现提交，先占成立）→ 本包为 docs-only planned 登记让位改号 **BLOCK-66**。远程交互会话候选编号另行分配（BLOCK-64/65 已分别被指挥中心 UX / 子智能体 UX 占用）。
- 2026-09-08 **启动登记（active）+ P0 摸底完成**：用户裁决启动（AskUserQuestion 拍板）。P0 三项摸底结论：① **启动路径隐藏 R 依赖 = 零**——硬门唯一本体 `backend-proc-manager.js:206`（R_HOME 检查）；server.js 启动链（db/cache/config/shared-backend init/路由）零 R 依赖（shared-backend init 失败仅 warn 不崩）；`BIOF3_R_HOME` 兼任运行时安装注册机制（env-coordinator:252 注入 / plugin-manager:244 安装时更新 / uninstall:119 注销 / diagnostic + mergeRuntimeStatus 消费），摘门时**保留 env 机制不动**。② **isReady 消费方盘点**——前端门真身 = `BackendStatusProvider`（App.tsx 全局挂载，**自 probe** `127.0.0.1:3001/api/health`，`rRuntime: rServerUp` 名不副实地把「server up」映射为 R installed）→ home.tsx `runtimeMissing` 全屏门；**主进程 `backend:status` IPC 渲染层零消费**（仅 diagnostic 面）→ 主进程 backend-health 的 isReady-R 绑定对 UX 无直接影响。**关键推论：摘 startRServer 门后 server 正常起 → 前端 probe 成功 → 引导页自动消失**。③ **R 执行诚实失败现状**——r-executor `binPath` Rscript 不存在 → spawn ENOENT → job 失败但文案生硬无指引（BLOCK-58 的 MISSING_R_PACKAGES fail-fast 只管包缺失，不管 R 本体缺失）→ P1 需补 preflight 诚实失败 + 商店指引。**设计分档（P0 裁决项，待用户确认）**：A 档最小摘门（只动 startRServer + downReason 文案）vs B 档完整语义拆分（A + backend-health isReady 与 R 解绑 additive + r-executor preflight 指引 + P2 引导条非阻塞化，即 §2 原设计全量落地）。**追加裁决候选**：「装完免重启」——server 子进程 env 在 spawn 时固化，运行时安装后新 env 不会到达已运行的 biof3-server，免重启需 server 重启机制，建议维持「装完需重启」并另行候选。P1 待用户确认设计档位后启动。
- 2026-09-08 **P1 收口（completed，摘门 + 语义拆分，B 档用户拍板）**：① `startRServer` 硬门移除（R_HOME 缺失照常 spawn，函数名历史遗留保留减 diff）。② `backend-health.js` 语义拆分：`isReady = serverAlive && probe`（与 R 解绑）+ additive 新字段 `serverUp`（`rServerUp` 保留同值兼容）+ downReason 去 R 化。③ `tools-executor.js` runtime preflight（`evaluateRuntimePreflight` 纯函数经 `_test` 导出）：binPath 存在性校验 → R/Python 缺失诚实失败 + 商店指引（stage=runtime 既有通道）。④ 定向测试：backend-health 9 场景（新增 7/8 BLOCK-66 语义）+ preflight 单测四分支。
- 2026-09-08 **P2 收口（completed，UI-312 in_progress）**：① home.tsx 门收窄——`needsSetupGate = backendNotReady`（runtimeMissing 不再阻塞；**P0 推论修正：摘门后 IPC 返回 rRuntime=false 而 home 判据是 rRuntime，引导页不会自动消失，P2 改判据为必要**）；R 缺失 → 首页顶部非阻塞引导条 `runtimeBanner`（通用功能不受影响 + 「前往安装」）；全屏门仅留后端故障场景，文案修正（移除「约 657MB · 必需」硬性表述）。② 插件商店改独立 overlay（`setupStoreShellOverlay`，装 R 后就地重启入口）。③ electron.d.ts `serverUp?` additive + runtime-status IPC 兜底形状 + BackendStatusProvider 补齐。④ UI-312 台账登记（in_progress）；home vitest UI-141 门测试重写到新契约 4/4；tsc 非 TS2550 0 错误（12 处 TS2550 为 HEAD 存量 lib 问题，与本包无关）。
- 2026-09-08 **P3 收口（后端两态 allPass；GUI 目视留手动验收）**：`scripts/block66-p3-live.cjs` → `acceptance/block-66/p3-live.json`：**A1** 隔离 userData（空 runtimes）无 R 环境 biof3-server 照常启动 health 200（摘门核心实证）；**B1/B2** 隔离环境 r-executor 解析（binPath=null）→ preflight 诚实拒绝 + 商店指引文案；**C1** vite 渲染层宿主启动。**GUI 目视（C2–C6）被环境阻塞**：agent 非交互会话无法启动 GUI Electron（静默退出 0 / CDP 不可达，最小 Electron 应用复现同样——非产品代码问题），已登记 `guiPhase.manual` 手动验收命令，UI-312 留 in_progress 待实机过目。**连带登记**：本机无 ripgrep → `test:changed:list`/`test-affected` 本 shell 不可跑（远端 5383181c 修复已用等价结构化校验确认生效）；vite 5 默认 bind localhost（可能 ::1），探针勿用 127.0.0.1；`ELECTRON_RUN_AS_NODE` 泄漏即 Electron 退化成 Node（既有教训复现）。impact-map 补 block66 规则 + script-block-live-drivers 补 `scripts/block66-*` + `acceptance/block-66/**`。0 新 npm 依赖。
