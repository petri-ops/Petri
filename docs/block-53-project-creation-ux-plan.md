# BLOCK-53 — 项目创建体验补丁：拖拽直达 + 一次性引导

> 状态：`completed`（P1/P2 全 verified，2026-09-03 收口）
> 立项日期：2026-09-03（用户裁决「做成一个独立的包」）；启动日期：2026-09-03（用户裁决方案 B：BLOCK-52 收口期间并行启动本包，验收资源错峰）
> truthDomain: `block-53-project-creation-ux`
> 来源：codex vs Petri 新项目创建体验对比调研（本会话）
> 并行边界：BLOCK-52（P2 图片引用）由另一智能体并行收口；本包**不得触碰** BLOCK-52 文件面（`project-workspace.tsx` / `project-workspace.module.css` / `SimpleChat.tsx` / `simple-chat.css` / `ResultView.tsx` / `lib/events.ts` / `agent-tools/vision-tools.js` / `agent-tools/tool-defs.js`）；实机验收与 dev Electron 资源错峰使用；提交按文件面严格分离。

## 1. 背景

对比调研结论：codex「项目 = 目录」哲学下新项目 1 步（cd + 回车），Petri 注册式 3-4 步（点+ → 选目录 → 确认面板 → 创建）。差异属终端工具 vs GUI 工作台的属性不同，**不改注册哲学，做体验补丁降低仪式感**——拖拽直达 + 一次性引导。

### 1.1 Petri 现状（调研锚点）

- 创建主流程：`frontend/src/pages/home.tsx` L120-213（openDirectoryDialog → pendingWorkspace 确认 → createProject → 跳转 `/project/{id}`）

- 后端：`core/petri-server/api-data.js` L205 `db.createProject({..., workspacePath})`——只注册路径，不建 git 不建文件

- 非 git 项目审阅为诚实空态（BLOCK-32 `project_workspace_not_git`）

- 多入口并存：目录选择 / 手动路径（UI-257）/ 应用内选择器（UI-259）/ 空白项目（UI-258）

## 2. 方案（两个补丁）

### P1 — 拖拽目录直达创建

- 首页（及项目工作台左栏「+」面板）支持**拖拽系统目录到窗口**：Electron `will-navigate`/`drop` 事件拦截 OS 文件拖入

- 拖入目录 → 直接进入既有 `pendingWorkspace` 确认面板（完整路径 + 项目名 + 在此处创建/重新选择）——**复用 UI-253 既有确认链路，不绕过确认**（拖拽降低的是「打开系统选择器」的成本，不降低确认安全性）

- 目录校验复用 `file:validate-directory` IPC（src/ipc/file-dialog.js L78-129 既有）

- 拖入非目录文件（单文件）→ 忽略或轻提示

### P2 — 非 git 目录一次性引导

- 进入项目页时若 workspace 非 git 仓库：一次性内联引导条「初始化 git 仓库以启用审阅与版本历史」（**一次性**：dismiss 后记录偏好不再弹，对齐 codex 信任屏「每目录只弹一次」哲学）

- 点击 → 复用既有 git 能力在 workspace 执行 `git init` + 初始提交（走后端既有 git 通道；确认面板明示将创建 `.git`）

- 引导条状态存储：本地偏好（localStorage 或 settings），不改 projects 表结构

- 非 git 空态（BLOCK-32 诚实空态）保持为引导后的稳态兜底——引导是可选加速，不是强制

### 非范围

- 不改注册式项目模型（projects 表 / workspace\_path 语义不动）

- 不做目录结构模板自动发现（生信目录识别——留候选）

- 不做项目列表与磁盘的同步扫描

- 0 新 npm 依赖 / 0 新 IPC（P1 用 Web 标准拖放事件 + 既有 validate-directory；P2 若 git init 需新只读通道则最小面新增）

## 3. 阶段

- **P0 立项**：本计划 + DOC-REGISTRY + roadmap/README + AUDIT-LOG 登记。

- **P1 拖拽直达**：首页 + 左栏面板 drop 处理 → pendingWorkspace 确认链复用；vitest（drop 事件→确认面板状态机）。

- **P2 git init 引导**：非 git 检测（复用 BLOCK-32 既有检测链）+ 一次性引导条 + git init 执行通道；vitest（引导出现/一次性记忆/init 调用）。

- **P3 门禁**：定向 vitest + tsc + `docs:check` + `ui:audit:check`；新 UI 编号同提交登记台账。

- **P4 dev Electron 实机**：拖拽真实目录创建项目全链路 + 非 git 项目引导 init 后审阅可用；证据 `acceptance/block-53/`。

- **P5 收口**：台账回写 + registry completed。

## 4. 验收门

- P1：拖拽目录 → 确认面板出现且路径正确 → 创建成功跳转；拖拽单文件无副作用；既有四条创建路径（UI-257/258/259 + 目录选择）零回归。

- P2：非 git 项目首次进入见引导条 → init 后消失且审阅可用；dismiss 后不再出现；既有 git 项目不出现引导。

- 治理：`docs:check` + `docs:reconcile` 收口必跑。

- G0 开发期常态 · 不外推 packaged/Provider/GA。

## 5. 风险与对策

| 风险                         | 对策                                            |
| -------------------------- | --------------------------------------------- |
| Electron 窗口拖放默认行为（导航到文件路径） | P1 实施时在窗口级阻止默认 will-navigate/drop，仅白名单首页与左栏面板 |
| git init 于含敏感内容目录的用户顾虑     | 确认面板明示动作内容；一次性引导不自动执行                         |
| 拖拽与既有粘贴/拖放附件（composer）事件冲突 | P1 限定 drop 监听挂载区域（首页/左栏），不进 composer          |

## 6. 进度记录

- 2026-09-03 P0（planned 登记）：用户裁决独立立项；方案源自 codex（1 步创建 / 信任屏一次性 / agents\_md 自动发现）vs Petri（注册式 3-4 步）对比调研——取「降低仪式感」两补丁（拖拽直达 + 一次性引导），不改注册哲学；本计划落盘并注册 DOC-REGISTRY；排队 BLOCK-51 之后。
- 2026-09-03 P0 启动（**并行纪律变更，用户裁决方案 B**）：BLOCK-52 P2 由另一智能体并行收口，本包并行启动；硬边界=不触碰 BLOCK-52 文件面（project-workspace / SimpleChat / ResultView / events.ts / agent-tools vision+tool-defs）、实机错峰、提交严格分离。
- 2026-09-03 P1 实现：preload `files.pathForFile`（webUtils 优先 + file.path 兜底）；home.tsx 挂载期窗口级 dragover/drop 接管（preventDefault 防 Chromium 导航）→ validateDirectory → UI-253 确认面板；LeftPanel.tsx 左栏 drop → validateDirectory → 打开 UI-257 内联创建面板回填路径（零碰 project-workspace.tsx）。
- 2026-09-03 P2 实现：后端 `git:init-repository` + `initRepositoryAt`（幂等 / commit 失败保留 .git + 可行动 warning / git_not_found 结构化）导出可测；ReviewMode 非 git 空态内嵌一次性引导条（内联二次确认 + localStorage dismiss 记忆 + init 成功 refresh 切回审阅）；落地位置说明：plan 原文「进入项目页时」收敛为**审阅 dock 空态内**（语义=启用审阅的前置引导，天然一次性、不打扰不用审阅的用户）。
- 2026-09-03 P3 门禁：后端 node --test 3/3、home vitest 4/4、LeftPanel 9/9、ReviewMode 21/21、tsc 0、docs:check 199、ui:audit:check PASS；台账 UI-282/UI-283 同提交登记。
- 2026-09-03 P4 实机（dev Electron CDP，8 断言全 PASS，证据 `acceptance/block-53/`）：S3 左栏 drop→内联面板+路径回填（validateDirectory 真实 realpath /tmp→/private/tmp）；S1a workbench 窗口 drop→UI-253 确认面板；S1b 确认创建→真实项目创建+跳转；S2 drop 单文件→「该路径不是文件夹」可见错误；S4a 非 git 项目审阅空态+引导条渲染；S4b 内联二次确认展开；S4c 桥缺失降级可见错误（半新半旧栈：preload 新而主进程旧，invoke no handler 被如实展示不静默）；S4d dismiss→消失+localStorage 记忆；S4e 重挂不再出现+空态兜底正常。**遗留 S5（init 全链）**：`git:init-repository` 桥→handler→init→refresh 切视图全链需 dev Electron 重启后补验（错峰约定，不与 BLOCK-52 抢栈；后端 initRepositoryAt 已由 node --test 真实 git 执行覆盖）；临时项目 p_mtlmidcb_q46h（/tmp/b53-accept-dir）保留至 S5 补验完成后清理。
- 2026-09-03 P5 收口：UI-282 转 verified（P1 全链实机证据充分）；UI-283 维持 in_progress（S5 待补）；提交仅含本包文件面。G0 开发期常态 · 不外推 packaged/Provider/GA。
- 2026-09-03 **S5 补验完成 → 全包收口（P1/P2 全 verified）**：BLOCK-52 收口提交后重启 dev Electron（新 preload + 主进程 handler 全载入），CDP 实机 4 断言全 PASS（`acceptance/block-53/s5-live-check.json` + `s5-init-full-chain.png`）：新栈桥就绪 → 引导条出现（清 dismiss 记忆）→ 确认初始化 → **真实 git init 全链**（.git 创建 + `5835ff7 Initial commit (Petri)` 磁盘核对）→ 空态消失自动切回审阅视图。临时项目 p_mtlmidcb_q46h 归档回收站、/tmp fixture 清理。UI-283 转 verified。G0 开发期常态 · 不外推 packaged/Provider/GA。

