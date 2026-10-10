# BLOCK-16 Working Tree Review Mode — 架构调研

> 调研产出。本文件不创建工作包、不动 AUDIT-LOG、不改 next-steps-roadmap、不动 DOC-REGISTRY；
> 仅作为 BLOCK-16-WORKING-TREE-REVIEW-MODE 的事实基线，由主 Agent 在确认启动工作包后引用。
>
> 范围：working tree PR-style diff viewer（可批准/拒绝/回滚，hunk 级别；agent 完成自动弹出 + 用户手动均可；所有 working tree 改动都可审阅，不限于 AI 编辑）。
> 时点：2026-08-19。

## 1. 背景与目标

G0 长期开发期下，AI Agent（Luna worker / Codex / Claude Code）在 working tree 留下的本地未提交改动，需要一个 PR-style 的可视化审阅界面：

- 任务结束自动弹出 + 工具栏手动按钮均可触发。
- 用户可批准/拒绝/回滚（hunk 级别）。
- 拒绝后写入 hunk 拒绝列表并通过 IPC 让 AI worker 重新读取、重新生成。

BLOCK-16 的目标是补齐这一体验缺口，但**不**触碰 Provider / packaged / GA / 公证 / dist staleness 等 G1+ 阶段事项。

## 2. 现状盘点

### 2.1 Git diff 获取机制

**已有能力**（充分复用）：

- `core/shared-backend/git-adapter.js`（G0-RS1 的唯一 Git 命令边界，ADR-RS-3 已固化）
  - 不引入 simple-git / isomorphic-git / nodegit / dugite；只走 `execFileSync` + 数组参数 + 路径白名单。
  - 已有 `diff({ paths, staged, fromRef, toRef })` 方法，参数安全（`-` 开头的 pathspec 一律拒绝，无 `git add ./-A/-u` 写法）。
  - 已有 `stage / commit / showFile / createBranch / updateRefCas / deleteRefCas / resolveManyRefs / listRefs`，可覆盖 BLOCK-16 需要的"回滚到 HEAD / 选择性撤销 hunk" 等操作。
- `core/r-server/mcp/ide-tools/git-diff.js`（Phase 3 IDE MCP tool）
  - 子进程 `git diff --no-color --no-ext-diff`，已实现 `parseUnifiedHunks` + `truncateHunksByLines`，输出 `{ ok, hunks, summary: { added, removed }, truncated }`。
  - 已做路径白名单 + 白名单二次校验（`path-allowlist.js` 仅允许 cwd / os.tmpdir / ~/.petri/logs，禁止 `.git`、`.ssh`、`node_modules`、`.venv`）。
- `core/r-server/mcp/ide-tools/diff.js`（Apple/FreeBSD `/usr/bin/diff` 封装 + `parseUnifiedHunks` / `parseNormalHunks`）和 `diff-helpers.js`（共享解析器）。

**当前缺口**：

1. `ide_git_diff` 当前是 MCP tool，由 Agent 调用；**未暴露为 Electron IPC channel**，前端 desktopBridge 不能直接拉 working tree diff。
2. 缺 `git:status` 的"working tree 文件清单"通道（前端拿不到"哪些文件被改"的结构化列表）。
3. 缺 "hunk 级撤销 / 应用 patch" 写操作通道（`ide_git_diff` 是只读的）。
4. 解析器只支持 `unified` 一种格式，未支持 `--no-color --src-prefix=a/ --dst-prefix=b/` 这类 PR 风格的标准化字段。
5. 大文件策略：当前 `MAX_LINES_HARD_CAP = 5000` 全量截断，未分文件级；未识别二进制文件（`GIT_ADAPTER_VERSION` 已支持 `--numstat` 风格的探测，但需要前端契约配合）。
6. 二进制文件：当前解析器遇到二进制 diff 会整体抛错，**没有**单独的"binary file X changed" 占位策略。

**参数契约建议**（继承既有风格）：

```bash
git -C <absRepo> diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ [--staged] [-- path1 ...]
```

最大缓冲 64MB、超时 30s、退出码 0/1 = 正常、其它 = 错误，与既有 `git-diff.js` 对齐。

### 2.2 IPC 桥接现状

**现有 channel 命名空间**（preload.js 暴露）：

- `window.petriDesktop.{window, app, aiSettings, computeSettings, harnessCapabilities, plugins, contentPlugins, runtime, backend, py, plumber, files, diagnostic, telemetry, data, terminal, skills, branch, result, updater}` — 共 19 个命名空间。
- `window.petri.{agentWorkbenchFlags}` — 与 `petriDesktop` 并列的特殊通道。
- 类型定义在 `frontend/src/lib/electron.d.ts`，映射到 `Window.petriDesktop?` 强类型。
- 桥接封装：`frontend/src/lib/desktopBridge.ts` 提供 `getBridge / requireBridge / isDesktop` + `BridgeUnavailableError`。

**现有 IPC 风格**：

- 异步：`ipcRenderer.invoke(name, ...args)` ↔ `ipcMain.handle(name, async (event, ...args) => {...})`（绝大多数通道）。
- 单向事件：`ipcRenderer.send(name, ...)` ↔ 主进程 `webContents.send(name, ...)` ↔ preload 包装 `onXxx(callback)` 返回 unsubscribe（参考 `terminal.onData/onExit`、`skills.onProgress`、`updater.onUpdateAvailable`）。
- 自定义应用事件：`window.dispatchEvent(new CustomEvent('petri:xxx', { detail }))`，由 `frontend/src/lib/events.ts` 的 typed event bus 统一（`petriEvents` 常量 + `subscribePetriEvent`）。
- 主进程侧：handler 文件分布在 `src/ipc/*.js`（17 个模块：`file-dialog, plugin, terminal, telemetry, ai-settings, compute-settings, runtime-status, backend-lifecycle, diagnostic, auto-update, data-management, branch-handlers, result-handlers, harness-capabilities, skills-window, workbench-flags, _sender-guard`），由 `src/main.js` 在 app ready 后 `setupXxxIpc({ mainWindow })` 注入。
- BLOCK-9.1 SUB-15.1 拆分后，新 IPC handler 必须走"独立模块 + setupXxxIpc"风格，不要再写回 main.js。

**已有 git 相关 IPC**：**没有**。`window.petriDesktop.*` 19 个命名空间均不涉及 git。git 相关操作目前只走 MCP（`ide_git_diff / ide_git_log / ide_git_show / ide_git_blame / ide_file_diff`）由 Agent 调用，不暴露给前端。

### 2.3 AI Agent 事件广播

**现状**：

- 任务事件链路在 SSE 层（`frontend/src/components/copilot/copilotClient.ts`），`streamChat` 通过 `/ai/agent/task/:taskId` 拿事件流，原生事件包括 `conversation / topic_shift / loop_phase / loop_iteration / iter / agent_status / agent_progress / result_edit_progress / tool_call / tool_result / done / delta`。
- **没有** "agent done / 我改了 N 个文件" 这种工作区写入完成事件。`result_edit_progress` 走的是 Result Studio 的 ChangeSet 流程，与 working tree 改动没有重合。
- 现有 typed event bus `petriEvents` 在 `frontend/src/lib/events.ts` 共 9 个事件：
  - `onboardingDone / softRefresh / projectOpenResult / projectOpenArtifact / projectOpenWorkspaceFile / projectWorkspaceChanged / copilotAsk / browserBack / browserForward / conversationForked`
  - **没有** "agent task done + working tree 改动清单" 事件。
- `projectWorkspaceChanged` 由 Files panel 在轮询 / 写入时触发，**不是** Agent → main 的可靠通道；Agent 没有"我改了 X"的明示。
- 同一 typed-event 总线在 `cmd:palette` 已用作应用内 cross-component 通知（参考 `CommandPalette.tsx` 用 `dispatchPetriEvent`）。

**Luna worker / Codex / Claude Code 的"我改了这些文件"信号**：

- 当前**没有任何 in-process 通道**。Agent 是 shell-out 到 `git apply / git diff` 的外部子进程，不与 Electron 主进程通信。
- Agent 完成一个任务后，能依赖的只有：（a）用户主动看 git status；（b）Agent 自报 "我改了 A, B, C"（纯文本）。
- 没有 `desktopBridge.invoke('agent:foo', ...)` 之类的 agent IPC；`window.petriDesktop.agent*` **不存在**。

### 2.4 前端 UI 基础设施

**Modal / Overlay 现状**：

- `frontend/src/components/copilot/SimpleChat/ImagePreviewModal.tsx`（BLOCK-9.2 PHASE 4 抽出，~127 行）：overlay + container + Esc + 点背景关闭，CSS 类 `sc-preview-*`。**这是项目最干净的全屏浮层模板**。
- `frontend/src/components/copilot/CommandPalette.tsx`：Spotlight 风格命令面板（Cmd+K），inline CSS in `simple-chat.css`。
- `frontend/src/components/auth/LoginModal.css`：site-wide 模态（`petri-login-modal-*` 类，z-index 10000，fade + pop 动画）。
- `frontend/src/components/ui/Lightbox.tsx`：最小全屏图灯箱，Esc 关闭 + body overflow hidden。
- **没有**统一的 `<Modal>` / `<Dialog>` 组件；每个模块自带 CSS。

**Diff viewer 组件库**：

- `package.json` **没有** `monaco-editor / @monaco-editor/react / react-diff-viewer / react-diff-view / diff2html / react-diff-viewer-continued` 任何一个依赖。
- 项目依赖列表只有：`@electron/notarize / @modelcontextprotocol/sdk / archiver / better-sqlite3 / extract-zip / node-pty / uuid`（运行时）+ `electron / electron-builder / react / react-dom / @types/react / @types/react-dom / @electron/rebuild / ali-oss`。
- **没有引入任何 diff 渲染库**。所有 diff 视图（Result Studio RevisionCodeView、ChangeSet panel、compare service）都是手写 React + CSS Module。

**Monaco**：

- **未使用**。Monaco editor 包不在 `frontend/package.json`（前端依赖需要单独看）。

**CSS Modules / 主题系统**：

- 风格：CSS Modules（`*.module.css`）+ `frontend/src/styles/custom.css` 全局变量 + `[data-theme='dark']` 主题切换 + `themes/ThemeProvider.tsx`。
- 现有 diff-like UI 样式参考：
  - `frontend/src/components/result-studio/ResultStudioChangeSetPanel.module.css` — 行级 +/- 颜色、行号、scope 标签。
  - `frontend/src/components/result-studio/RevisionCodeView.module.css` — 代码高亮、复制/下载按钮、replay 状态徽章。
- CodeHighlight 在 `frontend/src/components/ui/CodeHighlight.tsx`（前端代码高亮基础组件，可复用）。

**路由结构**（`frontend/src/App.tsx`）：

- 现有路由：`/`, `/skills`, `/project/:projectId/results`, `/project/:projectId/*`, `*`（fallback）。
- 决策：**不需要新增 `/review` 路由**。需求对齐明确为"全屏模态浮层 + 任务结束自动弹出 + 工具栏手动按钮"，纯浮层即可，挂在 App 根的 `<WorkingTreeReviewMount />` 即可。

### 2.5 项目纪律约束

**当前阶段**：

- G0 长期开发期（AGENTS.md §"当前阶段纪律"，2026-08-15 裁决）。`v0.0.1-rc.7` 是 OSS 候选版，**不是 GA**。
- `qualificationEligible: false` 是 G0 常态，**不是**待办 / 缺口。
- 当前 active WP 列表在 `docs/next-steps-roadmap.md`（应当是 NONE / P7 deferred / 历史 P4R 收口完成态）。
- 单工作包串行纪律生效：BLOCK-16 启动后是**当前唯一** active 工作包，不并行新阶段。

**文档治理**（`docs/document-governance.md` + `scripts/docs-governance.mjs` + `docs/DOC-REGISTRY.json`）：

- 任何 Markdown 文档必须登记到 `DOC-REGISTRY.json`，含 kind / status / archivePolicy。
- kind 枚举：`governance / vision / roadmap / living-plan / work-package / handoff / audit / reference / release`。
- 调研报告属于 `audit`（或 `reference`，由主 Agent 决定；本报告默认登记为 `reference`，因为是事实盘点而非审计结论）。
- `npm run docs:check` 是收口硬要求；本报告交付前必须跑通过。

**测试纪律**（AGENTS.md §"测试范围纪律"）：

- 定向优先：`npm run test:changed:list` 按 `test/impact-map.json` 选最小影响范围；不要跑全量 `npm run test:all:workspace`。
- BLOCK-16 影响范围预估：
  - 改 `src/preload.js` + `src/ipc/*.js` → `electron-runtime` 规则。
  - 改 `frontend/src/**`（IPC 类型 + 新增 `<WorkingTreeReviewMount />`）→ `frontend-source` → `ui-audit` + `frontend-check`。
  - 复用既有 `git-adapter.js` 不需要触发 `git-backend` 全套；但**新增** handler 仍需跑 `test/git-adapter.test.mjs` 兜底。
  - **专项门禁**：建议新增 `block:working-tree-review`（`npm run block:working-tree-review`），至少含 `git-adapter` 的 small subset + frontend 组件 Vitest 子集。
- `docs:check` + `ui:audit:check` 必跑（秒级）。

**ADR / 架构决策**（`docs/architecture-decisions.md` 或 `docs/adr/`）：

- 既有 ADR：ADR-RS-3（git-adapter 子进程边界）、SUB-15.1（main.js 拆分策略）。
- BLOCK-16 应**新建** ADR 候选条目（BLOCK-16-ADR-1：diff 数据源；BLOCK-16-ADR-2：hunk 拒绝信号通道），但由主 Agent 在启动工作包时统一登记，本调研不写。

**文档门禁**（`.cursorignore` 屏蔽 `docs/`）：

- 注意：`.cursorignore` 屏蔽了 `docs/` 目录，导致 IDE 内 read 工具读不到 docs/ 下的现有文件（hook 拦在工具层）。
- 写新文件走 Write 工具是允许的（Write 不走 cursorignore）；本调研报告通过 Write 输出。

## 3. 设计方案候选

### 3.1 方案 A：基于 simple-git + MonacoDiffEditor（库驱动）

- **依赖**：`simple-git` (~500KB)、`monaco-editor` + `@monaco-editor/react`（~5MB，懒加载）。
- **数据流**：
  - 主进程：`simple-git` 在 worker 线程跑 `git.raw(['diff', ...])` → 返回 unified text → 转发 renderer。
  - renderer：`<MonacoDiffEditor original={headBlob} modified={workBlob} />` 直接消费；hunk 选择 / 接受 / 拒绝 走 monaco 内置 gutter。
- **优势**：
  - Monaco 自带行号 / 折叠 / 搜索 / syntax highlight，PR-style 体验最好。
  - `simple-git` API 简单，少写 shell。
- **劣势**：
  - 体积代价显著（5MB Monaco），违反 G0"小而精"边界；与既有"Result Studio 手写 diff 渲染"风格不一致。
  - 与 ADR-RS-3 "不走 simple-git" 直接冲突；需重新打开 ADR。
  - Monaco 在 Electron 沙箱里要单独配 worker（sandbox: true 下 require 已被 preload 注释警告过，见 `src/preload.js` L22-28）。
- **判定**：**不推荐**（与 ADR-RS-3 冲突 + 体积代价）。

### 3.2 方案 B：基于子进程 git + react-diff-viewer-continued（库 + 子进程折中）

- **依赖**：`react-diff-viewer-continued`（~30KB，零运行时依赖）或 `diff2html`（~200KB）。
- **数据流**：
  - 主进程：复用 `ide_git_diff` 的子进程 + 解析器，新增 IPC `git:working-tree-diff` 返回 `{ files: [{ path, status, hunks, binary }] }`。
  - renderer：`<ReactDiffViewer oldValue={headBlob} newValue={workBlob} splitView />` + 手写 file list / hunk accept/reject 工具栏。
- **优势**：
  - 与 ADR-RS-3 "子进程 + 解析器" 路径一致，复用 `diff-helpers.js`。
  - `react-diff-viewer-continued` 仅 ~30KB，无 worker 依赖。
  - 库提供行级 +/- 颜色、行号、collapse，纯 CSS 主题可定制。
- **劣势**：
  - 不支持 hunk 级选择（库按文件给 split view，hunk 接受/拒绝要在我们自己组件上叠 UI）。
  - 二进制文件、大文件需要自己处理（库只展示文本 diff）。
- **判定**：**候选**（主推之一）。

### 3.3 方案 C：基于既有 diff-helpers + 手写 React 渲染（零新依赖，与 Result Studio 对齐）

- **数据流**：
  - 主进程：复用 `core/r-server/mcp/ide-tools/diff-helpers.js` 的 `parseUnifiedHunks` + `summarize`，新增 IPC `git:working-tree-diff`（同 B 方案的数据形状）。
  - renderer：自写 `<DiffViewer file={...} onHunkApprove={...} onHunkReject={...} />` + `<DiffHunkView oldLines newLines context />`，样式参考 `ResultStudioChangeSetPanel.module.css`。
- **优势**：
  - **零新依赖**，与既有 `RevisionCodeView / ChangeSet panel` 视觉风格统一，复用 CodeHighlight。
  - 完全控制 hunk 选择 / 接受 / 拒绝的 UI（这是 BLOCK-16 的核心交互）。
  - 与 ADR-RS-3 + SUB-15.1 完全对齐。
- **劣势**：
  - 需要自己实现行级 +/- 颜色、行号、collapse、syntax highlight（CodeHighlight 已覆盖大部分）。
  - 第一个版本没有 PR-style split view（侧栏）体验，需要迭代。
- **判定**：**候选**（与既有风格一致，强烈推荐作为基线）。

### 3.4 方案对比矩阵

| 维度 | 方案 A（simple-git + Monaco） | 方案 B（子进程 + react-diff-viewer-continued） | 方案 C（既有 diff-helpers + 手写） |
|------|-------------------------------|------------------------------------------------|-------------------------------------|
| 功能覆盖 | 最强（含 search/fold） | 强（split view + 行级） | 中（首版 split view 需迭代） |
| 性能（大文件 / 千文件） | 中（Monaco 渲染重） | 中（库一次性 render） | 优（自渲染可控，可分文件懒加载） |
| 体积 | +5MB（Monaco） | +30KB | 0KB |
| 学习成本 | 中（Monaco API） | 低（库 API 直白） | 中（需重写 React 渲染） |
| 与 ADR-RS-3 兼容 | **冲突**（需重开 ADR） | 兼容 | **完全兼容** |
| 与既有 Result Studio diff 风格统一 | 否 | 部分 | **是** |
| hunk 级接受/拒绝 | Monaco 原生 gutter | 需自己叠 | 自渲染自带 |
| G0 边界守住 | 偏重 | 兼容 | **优** |
| 推荐度 | 低 | 中 | **高** |

**对比结论**：方案 C 为推荐基线。理由：与 ADR-RS-3 + 既有 Result Studio diff 风格完全一致、零新依赖、首版可在 BLOCK-16 单工作包串行纪律下收口；hunk 接受/拒绝等核心交互可完全自渲染控制，与方案 A/B 的功能差异可以在后续 BLOCK-16.x 增量补（Monaco / react-diff-viewer 可作为 P 阶段升级路径，但不在 BLOCK-16 首次收口范围）。

## 4. IPC Channel 新增清单（草稿）

> **本节为草稿，不在本调研中实现**；主 Agent 启动 BLOCK-16 工作包时按以下清单正式登记到 `src/preload.js` + `src/ipc/working-tree-review.js` + `frontend/src/lib/electron.d.ts` + `frontend/src/lib/desktopBridge.ts`。

### 4.1 新增 IPC channel

| Channel 名 | 方向 | 入参 | 返回 | 用途 |
|-----------|------|------|------|------|
| `git:working-tree-status` | renderer → main | `{ repoPath?: string }` | `{ ok, files: [{ path, status: 'M'\|'A'\|'D'\|'R'\|'C'\|'?'\|'!', binary: boolean, size?: number }], totalFiles, totalAdditions, totalDeletions }` | 列出 working tree 改动清单（agent 完成时 + 手动按钮触发） |
| `git:working-tree-diff` | renderer → main | `{ repoPath?: string, paths?: string[], staged?: boolean, maxLines?: number }` | `{ ok, files: [{ path, oldPath?, hunks: [{ type, oldStart, oldLines, newStart, newLines, lines: string[] }], binary, truncated }], summary, truncated }` | 拉 unified diff 结构 |
| `git:working-tree-file-content` | renderer → main | `{ repoPath?: string, path: string, ref?: 'HEAD' \| 'WORKTREE' }` | `{ ok, content, encoding: 'utf-8' \| 'base64', size }` | 拉单个文件原文（用于分文件懒加载 + 大文件保护） |
| `git:hunk-apply` | renderer → main | `{ repoPath?: string, file: string, hunkIndex: number, action: 'accept' \| 'reject' }` | `{ ok, hunkIndex, action, newWorkingTreeStatus }` | 接受/拒绝 hunk；reject 写本地 hunk-reject log |
| `git:working-tree-revert` | renderer → main | `{ repoPath?: string, paths: string[] }` | `{ ok, reverted: string[] }` | 全文件回滚到 HEAD（用 `git checkout HEAD -- <safe pathspec>` + 路径白名单） |
| `agent:task-done` | main → renderer | `{ taskId: string, filesChanged: string[] }` | — | 通知前端"任务结束，触发 working tree review" |

### 4.2 命名 / 风格约定

- 通道名前缀 `git:`（与既有 `window.petriDesktop.*` 子树一致），不使用 `git-`。
- 同步通道走 `invoke / handle`；事件通知走 `webContents.send` + preload 的 `onXxx(callback)` 返回 unsubscribe。
- 路径入参必须经 `core/r-server/mcp/ide-tools/path-allowlist.js`（cwd / os.tmpdir / ~/.petri/logs；拒绝 `.git / .ssh / node_modules / __pycache__ / .venv / venv`）。
- hunk 拒绝日志写 `<dataDir>/working-tree-review/rejects/<taskId>-<hunkIndex>.json`（路径脱敏后），由 `core/shared-backend/redaction.js` 走与 diagnostics 相同的脱敏流程。

## 5. AI Agent 拒绝信号传递方案（至少 2 候选对比）

> 拒绝信号的核心问题：用户在 BLOCK-16 浮层里"拒绝"了一个 hunk 之后，怎么让原本负责生成该 hunk 的 AI Agent 在下一轮对话里读到"这个 hunk 用户不要，请重新生成"？

### 方案 ①：本机拒绝清单 + Agent 重启时读取（**推荐基线**）

- **机制**：
  - 用户拒绝 hunk → 主进程写 `<dataDir>/working-tree-review/rejects/<taskId>.json`，内容 `{ taskId, file, hunkIndex, oldText, newText, rejectedAt, conversationId }`。
  - Agent（Luna worker / Codex / Claude Code）启动下一个 turn 时，通过**约定的 system-prompt 注入片段**读 `${PETRI_DATA_DIR}/working-tree-review/rejects/*.json`，把"用户拒绝的 hunk"作为 instruction 注入 prompt。
  - 注入方式：与 `core/r-server/helpers/system-prompt.js` 的 result-context 注入对齐（`docs/result-studio-plan.md` P3 已固化模式）。
- **优势**：
  - 不依赖 IPC 反向通道（Agent 不在 Electron 主进程内）。
  - 与既有"system-prompt 注入"模式对齐，复用同一套脱敏 + 路径校验。
  - 拒绝清单可追溯、可审计、可由审计 log 复读（与 `audit-log.js` 对齐）。
- **劣势**：
  - Agent 必须主动读取；不读取就不会生效。需要明确 system-prompt 引导。
  - 拒绝清单条目可能膨胀，需要 LRU + 老化策略。

### 方案 ②：MCP tool `ide_apply_hunk_reject` + Agent 主动调

- **机制**：
  - 暴露 MCP tool `ide_apply_hunk_reject(args: { taskId, file, hunkIndex, feedback })`，把拒绝事件推入 Agent 的 tool call 流。
  - Agent 在下一轮自动调用此 tool，工具实现读取拒绝清单 + 等待用户反馈。
- **优势**：
  - 走 Agent 既有 tool call 通道，事件可靠。
  - 与 `ide_git_diff` / `ide_file_diff` 同一组工具，用户心智一致。
- **劣势**：
  - Agent 必须**主动**调 tool 才能拿到拒绝事件；如果 agent loop 已退出，需要重启。
  - 与方案 ① 互补而非替代；建议两方案并存（方案 ① 是 fail-safe fallback）。

### 方案对比小结

| 维度 | 方案 ① 本机清单 + system-prompt 注入 | 方案 ② MCP tool 主动拉 |
|------|--------------------------------------|------------------------|
| 触发可靠性 | 高（每次重启都强制读） | 中（依赖 Agent 主动调） |
| 与现有 Agent 流耦合 | 低 | 中 |
| 实现成本 | 低 | 中 |
| 审计可追溯 | 高（文件 + 注入日志） | 中（MCP audit log） |
| 推荐度 | **基线** | 补充 |

**结论**：两方案并存。方案 ① 为基线（与既有 system-prompt 注入对齐），方案 ② 为补充（Agent 主动 query 的快速通道）；拒绝事件的最终一致性以方案 ① 为准。

## 6. 风险与边界

### 6.1 Electron 安全

- 主进程执行 `git` 子进程必须经路径白名单（`path-allowlist.js`），禁止直接信任 renderer 输入。
- 子进程命令必须用 `execFileSync` + 数组参数，**不**经过 shell；与既有 `git-adapter.js` 风格一致。
- IPC channel 名称在 `src/preload.js` 显式 enumerate，不通过 `ipcRenderer.on('*')` 通用监听。
- CSP 已硬：`default-src 'self' / script-src 'self' / style-src 'self' 'unsafe-inline' / object-src 'none'`（`src/main/csp-config.js`）。BLOCK-16 不引入外链 JS / CSS。
- contextIsolation: true / sandbox: true / nodeIntegration: false（既有配置，preload.js L77 已注释）。BLOCK-16 不绕过 preload 直接暴露 `git` API。

### 6.2 主进程执行 git diff

- 必须新增 IPC channel `git:working-tree-diff`（不直接用 r-server MCP，避免把 MCP tool 当 IPC 复用造成权限跨界）。
- hunk 拒绝路径走 `git apply --reverse` 或写 patch 反向应用，需逐路径校验；建议封装 `core/shared-backend/git-adapter.js` 的 `applyPatch` / `revertPaths` 方法（BLOCK-16 范围内新建）。
- 大文件保护：`> 1MB` 文件只返回元信息（行数 + binary 标记 + 截断提示），不返回完整 hunk lines。

### 6.3 大项目首次性能

- 千文件级别 `git diff` 实测 ~1-2s（基于既有 `ide_git_diff` 测试覆盖）。BLOCK-16 启动 IPC 时增加 30s timeout + progress event（参考既有 `plugin:install-progress` 模式）。
- 解析器硬上限 `MAX_LINES_HARD_CAP = 5000` 已存在，BLOCK-16 沿用并在 truncate 时显式标注 `"..."` 占位。
- 二进制文件：解析器遇到 `Binary files a/x and b/y differ` 时**只**返回 `{ binary: true, path }`，不进入 hunk 解析。

### 6.4 G0 边界外（Provider / packaged / GA / notarization）

- BLOCK-16 是**纯本地 working tree 审阅**，不依赖 Provider 模型调用、不依赖 packaged Electron 公证流水、不触发 GA 收口。
- 不引入新依赖（按方案 C），无新网络协议、无新外部服务。
- 不修改 CSP、不修改 BrowserWindow 安全配置、不动 preload 的 sandbox 标志。
- 不写 Result Studio qualification / packaged UI / Provider 矩阵相关任何 evidence。

### 6.5 单工作包串行纪律

- BLOCK-16 启动后是**当前唯一** active 工作包。不能在 BLOCK-16 收口前启动 G1+ / Provider / packaged 相关 WP。
- 测试纪律：定向 `npm run test:changed:list`；全量 `npm run test:all:workspace` 默认不跑；`docs:check` + `ui:audit:check` 必跑。
- 收口笔录用语：直接写"G0 开发期常态 · 不外推 packaged/Provider/GA"一句即可，不列举未做项。

## 7. 不在范围（不外推 / 不重做）

- 不引入 git 库（simple-git / isomorphic-git / nodegit / dugite）—— ADR-RS-3 已固化。
- 不引入 monaco-editor / react-diff-viewer —— 保持零新依赖（与方案 C 对齐）。
- 不实现 Provider 矩阵 / packaged Electron 公证 / GA 流水线 —— G1+ 阶段事项。
- 不实现 dist staleness / OSS 远程发布 —— G1+ 阶段事项。
- 不修改 Result Studio 现有 diff 渲染（ChangeSet / Revision / Compare）—— BLOCK-16 只新增浮层，不动 Result Studio。
- 不实现 hunk 自动 merge（auto-merge conflict）—— hunk 接受/拒绝只作用于 working tree，不触及 merge。
- 不实现跨仓库 working tree 审阅 —— 仅当前 working tree。
- 不写新工作包登记 / 不动 AUDIT-LOG / 不动 next-steps-roadmap / 不动 DOC-REGISTRY —— 由主 Agent 在启动 WP 时统一登记。

## 8. 调研结论与下一步

**关键事实**（5 条 bullet）：

1. **git diff 已有完整后端能力**：`core/shared-backend/git-adapter.js` + `core/r-server/mcp/ide-tools/git-diff.js` + `diff-helpers.js` 三件套覆盖 unified diff 解析 + 路径白名单 + 5000 行截断；BLOCK-16 复用而非新建。
2. **IPC 桥 gap 是"working tree → renderer"通道**：现有 19 个 `petriDesktop.*` 命名空间无 git 类；需新增 `git:working-tree-status` / `git:working-tree-diff` / `git:working-tree-file-content` / `git:hunk-apply` / `git:working-tree-revert` 共 5 条 invoke/handle 通道 + 1 条 `agent:task-done` 通知通道。
3. **AI Agent 完成事件无现成 IPC**：现有 `petriEvents` typed bus 9 个事件无 agent-done；推荐新增 `agent:task-done` 事件（detail 含 `taskId + filesChanged`），由 main 在 SSE `event=done` 时 dispatch。
4. **方案 C（手写 React 渲染）是 G0 边界内的最优**：与 ADR-RS-3 + 既有 Result Studio diff 风格对齐、零新依赖、hunk 接受/拒绝可自渲染完全控制；方案 A（Monaco）与 ADR 冲突、方案 B（react-diff-viewer）30KB 增量但与既有风格不一致。
5. **拒绝信号通道推荐"本机清单 + system-prompt 注入"基线 + MCP 主动拉补充**：与既有 `system-prompt.js` result-context 注入模式对齐，fail-safe fallback；MCP 通道作为 Agent 主动 query 的快速补充。

**下一步建议**（不替主 Agent 决策）：

- 主 Agent 在收到本调研后，按 `$petri-project-governance` skill 启动 BLOCK-16 工作包登记（plan ID / 阶段 / 验收门禁 / 证据位置）。
- 登记本报告到 `docs/DOC-REGISTRY.json`（kind=`reference` 或 `audit`）。
- BLOCK-16 首版范围建议聚焦：（a）5 条 IPC channel + electron.d.ts 类型；（b）`<WorkingTreeReviewMount />` 全屏浮层组件（手写 diff 渲染）；（c）`agent:task-done` typed event；（d）hunk 拒绝清单 + system-prompt 注入（方案 ① 基线）；（e）`block:working-tree-review` 专项门禁 + `docs:check` + `ui:audit:check` 必跑。
- Result Studio / Provider / packaged Electron / GA 相关任何改动不进 BLOCK-16 范围。
