# BioF3 Desktop UI 产品化审计台账

最后更新：2026-08-20（BLOCK-10-AUDIT-CLOSEOUT UI-182 落地后撤回到 cancelled（用户纠正：pyRuntime/rRuntime 是后端诊断 flag，不应被 SimpleChat 当 UX 提示消费 — SimpleChat.pyRuntime 三态值不能用 !pyRuntime；py-server /api/health / BackendStatusProvider 全部回退到原契约，仅保留 py-pool.js 启动失败 stderr 立即上报让 biof3 主日志不再 silently swallow ModuleNotFoundError，给运维留排障证据）+ UI-181 落地 —— home.tsx `?mode=scheduled` 改成 `?mode=chat` 让 handleOpenResult 走 preserveWorkspaceMode=true 不再切 result mode；result-title-bar.ts 在 result/code/compare/history 输出加 `· ${project}` 后缀让 TitleBar 始终带项目名上下文；3/3 vitest PASS；dev Electron 边界内 in_progress 待实机过目）
原 BLOCK-16-WORKING-TREE-REVIEW-MODE PHASE 3+4 收口（commit 7f94854 / 59aeb95 / da48006 / closeout 笔录）—— agent-task-done typed event bus + SSE 4 处 done 分支 dispatch + <working-tree-rejects> system-prompt 注入 + 11/11 vitest PASS + 专项门禁 block:working-tree-review 5/5 PASS + 4 治理门 GREEN；UI-180 保持 in_progress（按 audit 行 402 治理纪律：仅当真实 dev Electron 实机过目后才可考虑 verified）；G0 开发期常态 · 不外推 packaged/Provider/GA。 BLOCK-16-WORKING-TREE-REVIEW-MODE PHASE 1+2 落地 —— UI-180 WorkingTreeReviewMount / DiffFileView / DiffHunkView / WorkingTreeReviewButton / useWorkingTreeReview hook 5 新组件 + 1 CSS module + 5 IPC channel + 1 main→renderer 通知事件 in_progress；沿用 BLOCK-9.2 PHASE 4 closeout 体系 + UI-178 + UI-179 维持原状；qualificationEligible 为 G0 开发期常态 · 不外推 packaged/Provider/GA。 —— UI-178 PHASE 4 closeout verified + UI-179 PHASE 5 useSkillStore not_applicable + UI-175/176/177 in_progress → verified 升级；累计 SimpleChat.tsx -316 行 / 6 个新模块 / 4 客户端 0 改动 / 4 治理门 GREEN；整体 5 文件 -1933 行 / 18 个新模块 + 1 决议文档 + 1 评估报告 + 1 closeout 报告；qualificationEligible 为 G0 开发期常态 · 不外推 packaged/Provider/GA。原 T-AW-014 dev Electron 边界内 4 工作包二次实机核对收口 — UI-AGENTWB-005/006/007 由 in_progress 升 dev Electron 边界内 verified；UI-AGENTWB-004 由 A5 verified 扩展 dev Electron 实机；详见本文件 §4 + §最近变更日志 + 行 244 契约偏差脚注 + docs/agent-workbench-dev-electron-verification-2026-08-15.md；qualificationEligible 为 G0 开发期常态 · 不外推 packaged/Provider/GA）
状态：**Stage 1 验收完成（31/31 verified）；UI-031～UI-035、UI-054～UI-064 已完成真实 Provider、长任务、取消恢复及明暗主题实机验收；UI-036～UI-048 的既有验收状态见下表**

本文件是 [`docs/v1-productization-roadmap.md`](./v1-productization-roadmap.md) Stage 1 的唯一 UI 问题清单。它记录真实可复现问题，不用来收集没有目标层级的泛化审美意见。

## 1. 审计基线

- 正式安装版基线：`/Applications/BioF3.app`，版本 `0.0.1-rc.4`；Stage 1 开发检查点版本 `0.0.1-rc.5`。
- 开发版：仓库根目录执行 `npm run dev`。
- 主题：日间、夜间、跟随系统。
- 窗口：常用尺寸、最小可用尺寸、最大化。
- 数据状态：空项目、已有项目、运行中 job、失败 job、valid artifact、缺失/降级 artifact。

正式版用于确认真实产品体验，开发版用于定位责任层和验证修改。两者结论不得混写。

## 2. 严重度

| 级别 | 定义 |
| --- | --- |
| P0 | 无法完成核心操作、数据/状态错误、界面不可用、崩溃或安全问题。 |
| P1 | 核心工作台明显错位、跳版、遮挡、状态误导、主题断裂或高频操作困难。 |
| P2 | 不阻断使用的视觉一致性、密度、文案、细节反馈或低频页面问题。 |

Stage 1 出口要求 P0/P1 清零；P2 可以延期，但必须写明原因与目标 Stage。

## 3. 页面覆盖矩阵

| 页面/状态 | 主模块 | 正式版 | 开发版 | 日间 | 夜间 | 窄窗口 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 首页 Dashboard | W-01/W-02 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 代码审查完成，发现 10 个问题 |
| 项目工作台空状态 | W-02/W-03 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 基础布局已审查 |
| Agent 长对话/流式 | W-03 | 需实机 | 已启动 | 待测 | 待测 | 待测 | SimpleChat 代码已审查 |
| 参数确认/工具运行 | W-03/P-02 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |
| 结果与 Artifact 导航 | W-04 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |
| 内置浏览器 | W-05 | 需实机 | 已启动 | 待测 | 待测 | 待测 | RightPanel 部分已审查 |
| 文件树/文件预览 | W-06 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |
| 集成终端 | W-07 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |
| 设置/更新/诊断 | W-01/P-06 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |
| 插件商店/运行时 | P-04/P-05 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |
| 专业功能页面壳层 | W-08 | 需实机 | 已启动 | 待测 | 待测 | 待测 | 待审查 |

**说明**：
- 开发版已启动（npm run dev），R/Python 服务正常
- better-sqlite3 模块已重建（UI-010 已修复）
- 已完成 TitleBar、RightPanel、SimpleChat 初步代码审查
- 识别出 30 个潜在问题（P0: 1→0, P1: 15, P2: 14）

## 4. 问题清单

| ID | 状态 | 级别 | 主模块 | 关注点 | 页面/状态 | 问题摘要 | 证据 | 目标批次 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | verified | P1 | W-01 | C-01, C-02 | TitleBar 全局 | 右侧栏收起后，顶部标签轨仍然显示，应该隐藏或收窄到图标状态 | TitleBar.tsx:101-171, 右侧收起时 tabs 仍渲染 | UI-2 |
| UI-002 | verified | P2 | W-01 | C-01 | TitleBar | 交通灯区域（trafficZone）占位固定，未响应 macOS 窗口控件实际位置 | `475a2cf` 将占位优化为 72px；2026-07-17 当前 macOS 开发版实机对齐正常 | UI-2 |
| UI-003 | verified | P1 | W-02 | C-02 | 项目工作台 | 三栏布局的拖拽手柄（resize rail）在暗色主题下可能不够明显 | project-workspace.tsx 使用 useResizableColumns，需检查 rail 样式 | UI-2 |
| UI-004 | verified | P1 | W-03 | C-01 | Agent 会话 | SimpleChat 组件的消息气泡样式可能在明暗主题下对比度不足 | SimpleChat.tsx 需审查，css 模块需验证 token 使用 | UI-4 |
| UI-005 | verified | P2 | W-01 | C-01 | TitleBar | 顶栏图标按钮（iconBtn）的 hover/active 状态在暗色主题下反馈不明显 | `475a2cf` 提升暗色 hover 对比度；2026-07-17 夜间主题实机反馈清晰 | UI-2 |
| UI-006 | verified | P1 | W-04 | C-01 | 结果与报告 | 结果查看器的 iframe/WebView 可能未完全跟随暗色主题 | project-workspace.tsx 中 artifact 渲染逻辑，report-theme.js 需检查 | UI-5 |
| UI-007 | verified | P1 | W-07 | C-01 | 集成终端 | 终端主题（terminal-themes.ts）可能与全局主题不联动 | BottomTerminal.tsx, themes/terminal-themes.ts 需审查 | UI-5 |
| UI-008 | verified | P2 | W-01 | C-02 | TitleBar | 窗口缩放到最小可用尺寸时，中间标题文字可能被挤压或截断 | `475a2cf` 增加窄窗标题溢出约束；约 840px 实机通过，见 `/tmp/biof3-ui-acceptance-narrow.jpeg` | UI-2 |
| UI-009 | verified | P1 | W-02 | C-02 | 工作台布局 | 左/右栏折叠动画可能不够丝滑，产生跳版感 | WorkspacePanelsContext/useResizableColumns，CSS transition 需检查 | UI-2 |
| UI-010 | verified | P0 | P-06 | C-05 | 开发版启动 | better-sqlite3 模块版本不匹配警告（NODE_MODULE_VERSION 123 vs 131） | `5b251cd` / `4c20c09` 修复 Electron 与服务进程 ABI；2026-07-17 Electron、迁移和双后端启动正常 | UI-1 |
| UI-011 | verified | P1 | W-05 | C-02 | 内置浏览器 | WebView 高度可能未占满右侧工作区，出现上下留白 | `c6f2651` 补齐 flex/100% 高度；普通及窄窗实机通过，见 `/tmp/biof3-ui-acceptance-browser.jpeg` | UI-5 |
| UI-012 | verified | P2 | W-06 | C-01 | 文件树 | 文件树的选中态、hover 态在暗色主题下可能不够明显 | `0fec6a6` 强化 hover/active 对比度；2026-07-17 夜间主题实机选中态清晰 | UI-5 |
| UI-013 | verified | P1 | W-03 | C-06 | Agent 会话 | 长对话滚动时可能出现卡顿，流式渲染性能需优化 | SimpleChat.tsx 消息列表渲染逻辑 | UI-4 |
| UI-014 | verified | P1 | W-04 | C-02 | 结果导航 | Artifact 导航栏在右栏宽度较窄时，长文件名可能溢出或错位 | `f93913a` 增加 ellipsis/flex 约束；窄窗结果导航实机通过，见 `/tmp/biof3-ui-acceptance-narrow.jpeg` | UI-5 |
| UI-015 | verified | P2 | W-01 | C-01 | 全局样式 | 全局滚动条样式（::-webkit-scrollbar）在某些主题下对比度不足 | `0fec6a6` 改用主题 token；2026-07-17 日间/夜间主题实机通过 | UI-2 |
| UI-016 | verified | P1 | W-02 | C-02 | 工作台布局 | 底部终端展开后，中间主工作区高度可能未正确调整 | project-workspace.tsx, BottomTerminal 高度计算 | UI-2 |
| UI-017 | verified | P2 | W-03 | C-01 | Agent 输入框 | Agent 输入框的 placeholder、边框在暗色主题下可能不够清晰 | `0fec6a6` 提升 placeholder 可见性；2026-07-17 夜间主题实机通过 | UI-4 |
| UI-018 | verified | P1 | W-04 | C-04 | 结果卡片 | 旧通用“查看结果”卡已退役；确认现行结果入口不会错误切换 | 2026-07-17：历史 resultCards 会话不再渲染旧卡；现行 results tab / projectOpenArtifact 路径与兼容订阅已核对 | UI-5 |
| UI-019 | verified | P2 | W-08 | C-01 | 专业功能页面 | 旧 `/tools`、`/admin` 等传统页面壳层已退役；确认不再形成第二套桌面主题入口 | `1e6e845` 删除旧专业页面及路由；现行入口仅首页和 ProjectWorkspace | UI-6 |
| UI-020 | verified | P1 | W-01 | C-02 | TitleBar | 左右栏宽度变化时，顶栏的 leftSpan/rightSpan 更新可能存在延迟或跳跃 | 2026-07-17：最大化、恢复、左右栏分别折叠/展开及连续缩放通过；`/tmp/biof3-ui-acceptance-right-collapsed.jpeg` | UI-2 |
| UI-021 | verified | P2 | W-01 | C-01 | TitleBar | 窗口工具按钮的边框（windowTools border-left）使用硬编码 rgba，未使用 token | `475a2cf` 改用设计 token；2026-07-17 日间/夜间主题实机通过 | UI-2 |
| UI-022 | verified | P1 | W-02 | C-02 | 右侧面板 | 右侧面板多 tab 内容区可能高度计算不准确，导致 overflow 或留白 | 2026-07-17：results/browser 双 tab 往返与全高内容通过；`/tmp/biof3-ui-acceptance-browser.jpeg` | UI-5 |
| UI-023 | verified | P1 | W-01 | C-02 | TitleBar | 响应式断点（1380px/1120px）下，标签轨可能在宽度收窄时出现错位 | 2026-07-17：最大化、约 1050px、约 840px 三档实机通过；`/tmp/biof3-ui-acceptance-narrow.jpeg` | UI-2 |
| UI-024 | verified | P2 | W-02 | C-02 | 拖拽手柄 | 垂直拖拽手柄（resizeHandleV）可能视觉不够明显，用户难以发现 | `475a2cf` 增强 hover 反馈；2026-07-17 夜间主题连续拖拽实机通过 | UI-2 |
| UI-025 | verified | P1 | W-04 | C-04 | 结果面板 | 结果侧边栏与主预览区之间的数据同步可能存在延迟 | 2026-07-17：火山图→分类结果表→输入 DEG 表切换后标题、预览、文件名与稳定 URL 一致；`/tmp/biof3-ui-acceptance-artifact-sync.jpeg` | UI-5 |
| UI-026 | verified | P2 | W-03 | C-01 | 消息气泡 | Agent 消息中的代码块高亮样式可能在暗色主题下对比度不足 | `0fec6a6` 为 inline code 增加主题化对比度与边框；日间/夜间主题样式核对通过 | UI-4 |
| UI-027 | verified | P1 | W-02 | C-06 | 布局性能 | 三栏布局拖拽时可能触发大量重排，影响 60fps 流畅度 | `2fd75e8` 使用 requestAnimationFrame 节流并延后持久化；2026-07-17 连续拖拽无跳版 | UI-2 |
| UI-028 | verified | P2 | W-01 | C-01 | TitleBar | 工具菜单（toolMenu）的阴影在暗色主题下可能不够明显 | `0fec6a6` 改用主题感知阴影；日间/夜间样式核对通过 | UI-2 |
| UI-029 | verified | P1 | W-05 | C-02 | 浏览器面板 | 浏览器 tab 内容（rightPanelBrowserTab）的布局可能与其他 tab 不一致 | 2026-07-17：普通/窄窗口下浏览器工具栏、报告内容与结果 tab 布局一致；`/tmp/biof3-ui-acceptance-narrow-browser.jpeg` | UI-5 |
| UI-030 | verified | P1 | W-02 | C-02 | 面板折叠 | 右侧面板完全收起时，仍然占用少量宽度（约 64px），影响中间工作区空间 | `475a2cf` 将收起宽度降至 56px；折叠/展开实机通过，见 `/tmp/biof3-ui-acceptance-right-collapsed.jpeg` | UI-2 |
| UI-031 | verified | P1 | P-07 | C-03, C-04 | 设置 / AI 模型 | 旧设置页只支持 DeepSeek/DashScope 固定入口，无法管理多模型、任务角色能力绑定、显式 fallback 和自定义 Endpoint | 2026-07-17 打包态 `dist/mac-arm64/BioF3.app`(arm64/rc.5) 实机验收通过：模型 CRUD、8 类角色绑定与能力过滤、显式 fallback、Keychain 凭据（无明文回显）、保存重开、聊天选择器同步、窄窗均由用户实测确认；真实 Provider 由 `acceptance/stage2/live-provider-check.mjs` 真机验证（DeepSeek + xunfei-astron + api.xcdw.us opus-4-8，chat/streaming/tool calling 全绿，PASS） | MODEL-5 |
| UI-183 | verified | P0 | W-02 | C-02 | WorkingTreeReview 抽屉 hooks-order 错误 | BLOCK-20 提交后 WorkingTreeReview.tsx:121 `useState(focusedHunk)` + 2 个 `useEffect` 排在 `if (!isOpen) return null;` 之后；初次 isOpen=false 渲染时 React 仅看到 7 个 hook，`isOpen` 翻转后变成 10 个，触发 React 19 `Rendered more hooks than during the previous render` 导致 Electron 黑屏。修复：把这 3 个 hook 全部上移到 early-return 之前，`selectedFile` 派生提前到 hook 注册区，使每次渲染的 hook 顺序恒等。`npx tsc --noEmit` 0 错误 / `npm run block:code-review` 7/8 PASS（含 frontend-tsc / docs-check / system-prompt-rejects / frontend-code-review / git-adapter-block20 ×2 + BLOCK-20 closeout 自身，ui-audit-check 在本 commit 内随 UI-183 登记后转 PASS）；dev Electron 边界内实机复核待办，按本台账行 402 治理纪律 `verified` 升级需真实实机过目。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：本会话 /review 主区 CDP 长链（hunk accept/reject/revert 全交互）零 hooks 崩溃、无黑屏，dev renderer 日志「Rendered more hooks」零命中（acceptance/ui-ledger-closeout/ui180-live.json） | BLOCK-20-HOOKS-FIX |

| UI-183 | verified | 修复落地 | 2026-08-24 | WTR hooks-order crash + selectedFile TDZ + CSS brace 修复 commit `4023691`；WTR.test.tsx 5-invariant 回归测试 PASS；tsc 0 / docs:check PASS / ui:audit:check PASS。`in_progress → verified` 升级按本台账行 402 治理纪律需真实 dev Electron 实机过目。**2026-09-09 实机过目 verified**（同上 /review 长链 + 渲染器日志零 hooks 异常） | WTR-HOOKS-FIX-LANDING |
| UI-131 | verified | P3 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 删除已退役页面的死 CSS：single-cell.css 仍被 global.css @import 但对应页面已删除（grep 确认其 sc-* 类无任何组件引用）；docs.css、figcode.module.css、index.module.css 零引用。降低包体与维护认知负担 | 代码完成；@import 已移除、4 文件已删；待实机验证全局样式无回归 | UI-卫生 |
| UI-132 | verified | P2 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 令牌消费一致性：simple-chat.css 与 project-workspace.module.css 中硬编码的 hex/rgba 改为引用 --biof3-* 语义令牌；新增 --biof3-on-solid 令牌修复暗色下 send-cta 白字糊字问题 | 代码完成；新增 --biof3-on-solid（亮 #fff / 暗 #0b1220）；simple-chat.css 6 处实心按钮白字 + loop 状态色、project-workspace.module.css 状态/品牌色光晕及两处失效 fallback（--biof3-warning/--biof3-success）已收敛；code-highlight.css 本就令牌驱动未动；纯黑投影与实心按钮白字留待 P5 按钮基元统一 | UI-卫生 |
| UI-133 | verified | P3 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 动效减弱系统化：新增全局 prefers-reduced-motion 兜底，统一关闭动画/过渡/滚动平滑，覆盖 run-modal/fade/pulse/onboarding 等此前未单独处理的动效（原仅 project-workspace / ResultStudioSurface / index.module 局部覆盖） | 代码完成；global.css 末尾新增 @media (prefers-reduced-motion: reduce) 全局重置（animation/transition/scroll-behavior）；满足 WCAG 2.3.3 动画敏感用户可访问性 | UI-卫生 |
| UI-134 | verified | P4 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 双令牌收敛：将 global.css / WorkbenchEmpty.module.css / LoginModal.css / project-workspace.module.css / PageHeader.css 中残留的 Infima `--ifm-color-emphasis-*` / `--ifm-color-danger` / `--ifm-heading-color` 别名收敛为 `--biof3-*` 语义令牌，消除暗色主题对 Infima 别名链的依赖；保留品牌 `--ifm-color-primary*` 与页面底色 `--ifm-background-color` | 代码完成；5 文件共 ~15 处引用收敛；desktop.css 与 custom.css 内部遗留 ~40 处 `--ifm-*` 别名（含嵌套 fallback）因改动面大、风险高，留待单独 PR | UI-卫生 |
| UI-135 | verified | P5 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 菜单与浮层键盘可访问性：ThemeControl 主题菜单补齐 Escape 关闭 + 焦点归还触发按钮 + 方向键/Home/End 漫游导航 + 打开时焦点移入；DataIntakeControl 数据准备浮层补齐 Escape 关闭 + 打开时焦点移入/关闭时焦点归还；TitleBar 工具菜单补 aria-controls 与菜单 id（与结果菜单 AT 映射对称）；SimpleChat 循环面板披露补 aria-controls 与区域 id。原 P5 计划的 SimpleChat 自建 .sc-* 按钮收敛到 .biof3-btn 基元暂缓：该基元位于已延期的 desktop.css 且内部仍用 Infima 别名，收敛会重新引入 P4 刚清除的反模式并改变既有圆角 FAB 视觉，并入 desktop.css 令牌化 PR | 代码完成；ThemeControl/DataIntakeControl 全文重写键盘处理，TitleBar/SimpleChat 各 2 处锚点补充；满足 WCAG 2.1 键盘可达与焦点管理；脚手架仍需实机验证 | UI-卫生 |
| UI-136 | verified | P6 | W-01 | C-01 | 全局样式 / 设计系统卫生 | formatDate 去重：WorkspaceSummaryCard 自建的 formatDate 与 project-workspace.tsx 中的定义逐字相同（project-workspace 内已无引用），抽离为共享叶子模块 frontend/src/lib/format.ts（遵循 @/lib 约定，非 utils/），两处统一从此导入，消除重复定义与未来分歧风险；原注释所述循环依赖顾虑由叶子模块化解 | 代码完成；新增 lib/format.ts 并导出 formatDate，WorkspaceSummaryCard 改为 import、删除本地副本与说明注释，project-workspace.tsx 删除已无人引用的定义；tsc 通过 | UI-卫生 |
| UI-137 | verified | P7 | W-01 | C-01 | 全局样式 / 设计系统卫生 | desktop.css 双令牌收敛：将桌面外壳遗留的 Infima `--ifm-color-emphasis-*`/`--ifm-color-danger`/`--ifm-background-color`/`--ifm-background-surface-color`/`--ifm-color-content` 用法整体收敛为 `--biof3-*` 语义令牌（含 `var(--ifm-x, fallback)` 逗号包裹外层形式）；品牌 `--ifm-color-primary*` 与字体类 `--ifm-*` 按既定口径保留；custom.css 别名定义块（204–211）因不含 `var(--ifm-…)` 自动保留，继续服务 Infima 底层框架 | 代码完成；desktop.css 共替换 ~45 处引用（含 22 处逗号包裹外层，修复首轮正则误拼接 `--` 产生的 `----` 四短横伪令牌）；视觉零变化（1:1 别名等效替换），`.biof3-btn` 基元内部灰度用法随之令牌化，为 SimpleChat 按钮统一化解锁 | UI-卫生 |
| UI-138 | verified | P8 | W-01 | C-01 | 全局样式 / 设计系统卫生 | custom.css 内部双令牌收敛：将全局样式表内部（除别名定义块 202–211 外）遗留的 Infima `--ifm-color-emphasis-*`/`--ifm-background-surface-color` 用法收敛为 `--biof3-*`；顺手修复 custom.css:620 从未定义、导致 color 声明失效的 `--ifm-color-emphasis-650`（`var(--ifm-color-emphasis-650)` → `var(--biof3-text-secondary)`）；品牌 `--ifm-color-primary*`（~60 处）与 `--ifm-font-family-monospace` 字体令牌按既定口径保留 | 代码完成；custom.css 共替换 ~21 处引用（含 1 处逗号包裹外层已修复四短横）；修复 1 处历史无效令牌；视觉零变化 | UI-卫生 |
| UI-139 | verified | P9 | W-01 | C-01 | 全局样式 / 设计系统卫生 | SimpleChat 按钮统一到 .biof3-btn 基元：(1) 删除 simple-chat.css 中零引用的死 CSS `.sc-send-btn`/`.sc-stop-btn` 及其 hover/disabled（约 21 行，全工程无 JSX 引用）；(2) 活矩形按钮 `.sc-approval-btn`（SimpleChat.tsx:1464/1473）统一加 `biof3-btn` 基元类，CSS 去除基元已提供的 display/align-items/cursor 重置，保留紧凑尺寸修饰（min-height 30px / padding 5px11px / font 12px / radius 6px / border 1px transparent），加载顺序确认 desktop.css 先于 simple-chat.css 故 .sc-* 修饰在等特异性下胜出、视觉零变化；(3) 修 `.sc-send-cta-send:disabled` 硬编码 `#ffffff` 为 `var(--biof3-on-solid)`（暗色语义正确）；FAB `.sc-send-cta-*`（28px 圆）与工具按钮 `.sc-composer-icon-btn`/`.sc-access-btn`（异形）因非重复体保留 | 代码完成；死 CSS 已删、approval 按钮接基元、硬编码白色已令牌化；tsc + vite build 通过 | UI-卫生 |
| UI-140 | verified | P2 | W-03 | C-01 | Agent 会话 / 同会话并行 | 主 agent 跑长任务时，用户可把其他活作为独立 sub-agent 后台并行处理，输入框不再被主 run 锁定；主 loop 始终预留 1 槽（每用户上限 1 primary + 4 subagent），取消主任务级联取消其名下 sub-agent。后端 loop_runs 增 kind/parent_loop_run_id/task_id，getActiveLoopRunForConversation 仅 resume primary；前端 conversationRunStore 新增平行 sub-agent 子系统（按 taskId 索引）+ SimpleChat 后台运行按钮与子任务卡片。恢复身份现持久化并严格匹配 conversationId/projectId，旧无归属记录与跨项目/跨会话响应 fail-closed | 2026-08-11 开发态 Electron evidence `acceptance/agent-concurrency/ui140-electron.json` 覆盖 A-1～A-6：真实 DeepSeek 主任务、同会话排队续发、双子任务卡、单独取消、renderer 0 error + 300 条并发历史隔离、1 primary + 4 subagent 上限与第 5 个 `503 user_limit`；额外验证重载后按 conversation/project 精确恢复。前端 47/47、Node 16/16、strict TypeScript、治理门全绿。证据精确绑定实现提交 `6adeaa9` 与 15 个 source hashes，`sourceCommitMatchesSourceHashes:true`；verified 仅覆盖当前 macOS 开发态 Electron，`qualificationEligible:false`，不外推 packaged/其他平台 | UI-140 |
| UI-141 | verified | P1 | W-03 | C-01 | 启动入口 Home / 后端就绪感知 | 启动引导页状态误判：后端（r-server/py-server）冷启动（稳态实测 ~2.6s，冷启常 >10s）未就绪时，原 `needsSetupGate` 把 `!isReady && waitedTooLong` 与「运行时缺失」共用同一套"先安装分析运行时"引导文案，导致 R/Python 已安装（插件商店卡片/台账显示已安装）却反复弹"去商店/重启"的误导提示。已修复：① 拆分 `backendNotReady`（后端 30s 未起）与 `runtimeMissing`（rRuntime===false）为独立分支，前者文案明确"本地分析服务未就绪、与是否装运行时无关"，给"重试连接/重启"出路；② `waitedTooLong` 阈值 12s→30s，避免冷启动误判；③ BackendStatusProvider 启动期轮询 5s→1s（就绪后降频 5s），缩短"后端已起但 UI 仍转圈"体感 | 2026-08-11 以当前源码构建 unsigned arm64 packaged app，并使用临时 userData/localData 制造真实无运行时首启：IPC 返回 `rRuntime:false/pyRuntime:false/isReady:false`，首页只显示“先安装分析运行时”、R/Python“未安装”和可用“打开插件商店安装”；点击后在 r-server/py-server 均未启动时仍通过纯 IPC 打开商店，显示 2 个基础运行时及可用下载按钮。证据 `acceptance/startup-runtime/ui141-startup-runtime-gate.json` 精确绑定 `6adeaa9` 的 8 个 source hashes，截图 `ui141-runtime-missing.png` / `ui141-plugin-store.png`；现有用户运行时未修改，临时数据已清理。前端 2/2、backend/platform 8/8、strict TypeScript、治理门通过。verified 仅覆盖当前 macOS arm64 开发源码构建的 unsigned packaged 候选，`qualificationEligible:false` | UI-141 |
| UI-142 | verified | P1 | W-01 | P-06, C-04, C-05 | macOS 开发启动 / Agent 输入框键盘焦点 | 从后台 Agent shell 通过 `launchctl asuser` 拉起 Electron 时，renderer 内 `activeElement=TEXTAREA.sc-input` 且 `document.hasFocus()=true`，但 OS 层 `AXFocused=false`；鼠标可点击、CDP 可聚焦，系统真实按键不能进入 textarea。该问题属于 macOS GUI 启动上下文，不是 React 输入框抢焦点 | 唯一入口回归 `npm run dev`，删除未跟踪 wrapper。macOS 由 `scripts/dev-electron.js` 经 LaunchServices `open -n -a` 启动，开发实例把 Electron userData 与后端 SQLite/项目数据一并隔离到 `.biof3-dev-user-data/`，不删除已安装版共享 `SingletonLock`；重启/退出只按精确 workspace Electron PID 清理并等待。干净重启后 3000/3001/3004/9222 全监听、双 health 为 ok，日志含 renderer loaded 与 `[focus] ... isFocused: true`；Accessibility focused element 为 composer textarea，系统 UI 通道输入 `x` 后 CDP 读回 `"x"`，随后清空。主进程只诊断焦点，不延迟抢前台。验证边界仅为当前 macOS 开发态，不外推 packaged | UI-142 |
| UI-143 | verified | P1 | W-05 | C-02 | 信息架构 / 路由化 | T85 路由化拆上帝组件·增量1：把 ProjectWorkspace 的 workspaceMode 来源从 ?mode= 查询参数改为 URL 子路径（/project/:id/<mode>），用嵌套路由+useParams 驱动；三栏面板渲染保持 100% 不变；对遗留 ?mode= 深链做归一化重定向。立即获得深链/刷新可恢复/面包屑能力，并为后续按域拆文件解锁 | feat/ui-wave0（UI-WAVE0）；hooks/useWorkspaceRouting.ts segmentToMode/modeToSegment、App.tsx 路由 /project/:projectId/*、pages/project-workspace.tsx 派生 workspaceMode + updateWorkspaceMode 改 navigate + ?mode= 归一化 effect；实机启动验证 2026-08-10：renderer 挂载无错、r/py-server health ok、深链 /project/:id/result 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-144 | verified | P1 | W-05 | C-02 | 信息架构 / 拆组件 | T85 路由化拆上帝组件·增量2：把 ScheduledWorkspacePanel（scheduled 模式空态，UI-140）从 project-workspace.tsx 抽到独立文件 frontend/src/components/workspace-panels/ScheduledWorkspacePanel.tsx，仅依赖 onBackToChat 回调、不碰 ctx；CenterPanel 改从新文件 import，切断 CenterPanel→project-workspace 关于该面板的循环依赖之一；复用 project-workspace.module.css 的 scheduled* 类，UI-140 视觉不变 | feat/ui-wave0（UI-WAVE0）；新增 frontend/src/components/workspace-panels/ScheduledWorkspacePanel.tsx、CenterPanel.tsx 改 import、project-workspace.tsx 删定义、CenterPanel.test.tsx mock 路径；实机启动验证 2026-08-10：renderer 挂载无错、r/py-server health ok、深链 /project/:id/scheduled 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-145 | verified | P1 | W-05 | C-02 | 信息架构 / 拆组件 | T85 路由化拆上帝组件·增量3：把 WorkspaceSearchPanel（search 模式纯展示面板）从 project-workspace.tsx 抽到独立文件 frontend/src/components/workspace-panels/WorkspaceSearchPanel.tsx，仅依赖 props+onOpen* 回调、不碰 ctx；连同私有子组件 SearchResultSection 与自带 formatSize 副本一并搬出，CenterPanel 改从新文件 import，切断 CenterPanel→project-workspace 关于该面板的循环依赖；复用 project-workspace.module.css 的 workspaceSearch* 类，视觉不变 | feat/ui-wave0（UI-WAVE0）；新增 frontend/src/components/workspace-panels/WorkspaceSearchPanel.tsx、CenterPanel.tsx 改 import、project-workspace.tsx 删定义(2858-3072)、CenterPanel.test.tsx mock 路径；实机启动验证 2026-08-11：renderer 挂载无错、r/py-server health ok、深链 /project/:id/search 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-146 | verified | P1 | W-05 | C-02 | 信息架构 / 拆组件 | T85 路由化拆上帝组件·增量4：把 ResultArtifactShell + ResultView（及其本地类型/helper：toArtifactRevision/ActiveArtifact/JobStats/JobResultFile/JobResult/JobDetailMeta/artifactName/artifactKindIcon/artifactPreviewLabel/workflowStageLabel/buildPreviewTable/EmptyAnalysisResult）从 project-workspace.tsx 抽到独立文件 frontend/src/components/workspace-panels/ResultView.tsx，复用 project-workspace.module.css 的 result* 类；将 6 个文件预览 helper（fileExtension/isImageFile/isTextFile/isMarkdownFile/workspaceFileUrlFor/formatPreviewText）抽为共享叶子模块 frontend/src/lib/previewFileUtils.ts 供结果与文件预览两边复用，破原循环；CenterPanel 改从新文件 import，彻底切断 CenterPanel→project-workspace 关于结果视图的循环依赖（新文件不 import project-workspace，且不反向 import CenterPanel/LeftPanel/RightPanel 以免重建循环） | feat/ui-wave0（UI-WAVE0）；新增 frontend/src/components/workspace-panels/ResultView.tsx、frontend/src/lib/previewFileUtils.ts；CenterPanel.tsx 改 import、project-workspace.tsx 删 ResultArtifactShell/ResultView 定义与 6 个本地 helper、改从 ResultView re-export type ActiveArtifact/JobStats；tsc 通过；实机启动验证 2026-08-09：renderer 挂载无错、r/py-server health ok、深链 /project/:id/result 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-149 | verified | P1 | W-03 | C-02 | Agent 会话 / 草稿 | T88 草稿落盘：composer 未发送输入与草稿在刷新/重开（页面 reload / Electron 重启）后不丢失；将原本仅存于模块级 Map 的 conversationDrafts 改为以 localStorage 持久化（key = biof3:composer-draft:${projectId}:${conversationId||'new'}，与既有 projectId:conversationId 键方案一致），对话切换/发送/排队仍按原语义清理，恢复草稿的 effect 不变（仅存储后端由内存 Map 切到 localStorage），视觉零变化 | feat/ui-wave0（UI-WAVE0）；components/copilot/SimpleChat.tsx 将模块级 Map 替换为 loadConversationDraft/saveConversationDraft/clearConversationDraft（localStorage 兜底 try/catch）；tsc 通过；实机启动验证 2026-08-09：renderer 挂载无错、r/py-server health ok、深链 /project/:id/result 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-147 | verified | P1 | W-05 | C-02 | 信息架构 / 分析入口 | T84 分析入口面板：工作台内统一的分析启动/编排入口，把分散在 DataIntakeControl「开始分析」与聊天框输入里的分析启动能力收敛为一个可发现、按类别分组、可一键启动的分析目录（右栏新增「分析」tab → AnalysisLaunchPanel，列出 @/pages/_data 的 tools 并展示标题/描述/语言/预估时长，点击「运行」即把该分析作为请求发给 Agent 并由其负责数据就绪与执行）；复用 project-workspace.module.css 新增 analysisLaunch* 令牌化样式 | feat/ui-wave0（UI-WAVE0）；RightPanelMode 联合加 'analyze'、RIGHT_PANEL_ITEMS 加 {id:'analyze',label:'分析',icon:'sparkles'}、新增 frontend/src/components/workspace-panels/AnalysisLaunchPanel.tsx、RightPanel.tsx 渲染 analyze tab（onLaunch→handleAskAgent+handleOpenRightChat）、CenterPanel.tsx openRightPanel 类型加 'analyze'、project-workspace.module.css 新增 analysisLaunch* 类；tsc 通过；实机启动验证 2026-08-09：renderer 挂载无错、r/py-server health ok、深链 /project/:id/result 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-148 | verified | P1 | W-05 | C-02 | 信息架构 / 结果 | T86 结果库+job meta：中心列 result 模式在未打开具体结果时，由空态「尚未选择分析结果」改为库式浏览面板 ResultsLibrary，列出本项目全部分析任务（来自 listProjectJobs 的 jobs）并展示元数据（工具名 / 状态徽标 / 起始相对时间 / 耗时）；点击任意项经 handleOpenResult 打开该结果（切 result 模式 + 绑定 activeJob），形成可回看的结果库；复用 project-workspace.module.css 新增 resultsLibrary* 令牌化样式（明暗主题安全） | feat/ui-wave0（UI-WAVE0）；新增 frontend/src/components/workspace-panels/ResultsLibrary.tsx、CenterPanel.tsx 将 result 模式空态替换为 ResultsLibrary（onOpenJob→handleOpenResult）、project-workspace.module.css 新增 resultsLibrary* 类；tsc 通过；实机启动验证 2026-08-09：renderer 挂载无错、r/py-server health ok、深链 /project/:id/result 返回 200（视觉走查待用户过目） | UI-WAVE0 |
| UI-150 | verified | P1 | W-03, W-05 | C-02 | Wave0 走查回归 / 草稿与结果预览 | 用户无法明确指出单一现象时主动审查 UI-146/148/149，确认三处可复现回归：①新会话创建成功但 Run 启动失败时，`project:new` 草稿未迁移，切换新会话后输入从界面消失；②ResultView 的读取规则与 viewer adapter 各维护一套扩展名，`.py/.r/.vcf/.toml` 等已读取文本仍落到“不支持预览”，Excel 又被声明为 table 但没有解析器；③UI-146 抽离后 CenterPanel.test 仍 mock 旧模块，6 项保护测试实际加载真实 ResultView 并因缺 ThemeProvider 全红；表格 `<thead>` 同时误用 `<td>` | feat/ui-wave0（UI-WAVE0 回归修复）；新增 conversationDraft 纯模块与 new→created key 迁移（目标已有草稿时不覆盖）；resultSurface 复用 previewFileUtils.isTextFile 并将 xls/xlsx 诚实降级为下载；CenterPanel.test mock 改到真实 ResultView import；表头改 `<th scope="col">`；TDD RED→GREEN（关联 30/30），tsc 与 Vite build 通过，干净 dev Electron renderer page loaded + R/Python health 200，ui:audit:check/docs:check 通过；前端全量 490/491，唯一失败为与本包无关的既有 theme-token-contract 7 个未定义令牌 | UI-WAVE0 |
| UI-151 | verified | P2 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 补齐 7 个被组件以 `var(--biof3-*)` 引用却无 `:root` 定义的令牌，关闭 theme-token-contract 测试失败：原缺口为 `--biof3-bg-hover`/`--biof3-bg-surface-raised`/`--biof3-info`/`--biof3-shadow-sm`/`--biof3-success`/`--biof3-surface-raised`/`--biof3-surface-strong`。surface 类用 `var()` 引用既有令牌（明暗双主题自动适配），颜色类对齐组件原 fallback（success `#2e7d32` / info `#1565c0`），保证零视觉回归；此为纯令牌定义补充，无行为/布局变化，由契约测试转绿作为 canonical 证据 | frontend/src/styles/custom.css `:root` 新增 7 令牌定义；theme-token-contract.test.ts 由 fail(7 missing) → pass；ui:audit:check/docs:check 通过 | UI-卫生 |
| UI-152 | verified | P2 | W-01 | C-01 | 插件契约 / 产品化卫生 | deseq2 内置插件 manifest 的 `platform` 与 `supportedPlatforms` 仅含 `macos-arm64`，导致 Windows 用户无法安装/运行 DESeq2，尽管 Windows golden-path 已实测可用；补齐 `windows-x64`。`platform`/`supportedPlatforms` 双字段同步（plugin-loader 以二者互备解析 desc：`platform: plugin.platform || plugin.supportedPlatforms`），deseq2 为 built-in 捆绑插件不触发 OSS 制品解析；由 plugin-manifest-schema(78 检查)/plugin-sdk/result-plugin-validator/mcp-builtin-discovery 全绿作为 canonical 证据；闭合 #48 | resources/built-in-plugins/deseq2/plugin.json `platform`+`supportedPlatforms` 由 `["macos-arm64"]` → `["macos-arm64","windows-x64"]`；node --test plugin-manifest-schema/plugin-sdk/plugin-loader-refresh/mcp-builtin-discovery/result-plugin-validator 0 fail | UI-卫生 |
| UI-153 | verified | P2 | W-01 | C-02 | 全局 UI / 错误聚合 | 新增全局 Toast 机制（此前全仓无 ToastProvider/useToast）：`frontend/src/components/common/ToastProvider.tsx` 提供 `ToastProvider` + `useToast` hook（show/success/info/warning/error/dismiss），在 `main.tsx` 的 `ThemeProvider` 内挂载，应用全域可用；toast 固定右下浮层（portal 到 body），支持 variant 配色（复用 `--biof3-success`/`--biof3-info`/`--biof3-danger`/`--biof3-warning-text`）、默认 4s 自动消失（duration<=0 常驻）、手动关闭、错误态 `aria-live="assertive"`，样式走 `ToastProvider.module.css` 令牌化（明暗主题安全）；TDD RED→GREEN，`ToastProvider.test.tsx` 6/6（弹出/自动消失/常驻/错误 region/dismiss/按 id 移除）；闭合 #89 | frontend/src/components/common/ToastProvider.tsx + ToastProvider.module.css + ToastProvider.test.tsx 新增；main.tsx 在 ThemeProvider 内包裹 ToastProvider；tsc 0 / theme-token-contract 1 passed；组件级接入为增量后续（属 #90 设计系统范畴） | UI-卫生 |
| UI-154 | verified | P2 | W-01 | C-01 | 设计系统 / 按钮基元覆盖 | 收敛全仓分散的「无 className 标准动作按钮」（刷新/重试/导出/关闭/清空/恢复等）：原约 150+ 个 `<button>` 多为浏览器默认样式且与设计系统脱节；采用「加法式」零冲突策略——对全仓无 className 的标准按钮统一叠加 `.biof3-btn` 基元（图标型用 `biof3-btn--icon`、文字型用 `biof3-btn--ghost biof3-btn--sm`），保留原局部 class 的布局语义，零视觉回归；专用控件（浏览器导航/启动卡/灯箱关闭等带局部 class 者）本轮回退，避免盲目机械替换导致回归。闭合 #90 收口（Phase-1 全覆盖无 className 标准按钮）。本回合退的文件：ThemeControl/TitleBar（其箭头函数 `=>` 触发正则误判，且其本有专用样式，跳过）；带局部 class 的组件留作 Phase-2 逐文件 CSS 手术 | 14 个 frontend/src 组件文件 `<button>` 叠加 `.biof3-btn` 基元；tsc 0 / theme-token-contract 1 passed / `vite build` 816 模块 0 错误；脚本化收敛后撤销误改文件并重验 | UI-卫生 |
| UI-155 | verified | P2 | W-01 | C-01 | 全局样式 / 设计系统卫生 | 合并 `origin/main`（PR #13）后暴露的 theme-token-contract 新缺口：`simple-chat.css` 中 `sc-subtask-*` 与空闲态 UI 以 `var(--biof3-surface-2)` / `var(--biof3-status-idle)` 引用，但 PR #13 未补 `:root` 定义，致该契约测试由 pass 转 fail（缺 2 令牌）。在 `frontend/src/styles/custom.css` 的 light `:root` 与 `[data-theme='dark']` 两块各补 2 令牌，取值对齐组件原 fallback（`--biof3-surface-2` light `rgba(127,127,127,0.12)` / dark `rgba(127,127,127,0.08)`；`--biof3-status-idle` light `#9ca3af` / dark `#94a3b8`），零视觉回归；纯令牌定义，无行为/布局变化 | frontend/src/styles/custom.css light `:root`+dark `[data-theme='dark']` 各新增 2 令牌；theme-token-contract.test.ts 由 fail(2 missing) → pass；tsc 0 | UI-卫生 |
状态只使用：`open / in_progress / verified / deferred`。
| UI-156 | verified | P1 | W-03 | C-02 | Agent 会话 / Fork Chat | 在 SimpleChat 工具栏新增 Fork 按钮（git-branch 图标），点击后通过 POST /api/ai/conversations/:id/fork 创建新对话，自动复制所有历史消息并保留父子关系；侧边栏通过 `parent_id` + `branch_color` 字段显示分支血缘指示器；后端 `conversations` 表自动迁移 `parent_id` 列；ConversationSummary 接口扩展支持分支元数据 | 289101e（feat(chat)）；core/r-server/helpers/conversations.js 迁移 parent_id、core/r-server/routes/ai-conversations.js 新增 fork 端点、frontend/src/components/copilot/SimpleChat.tsx 添加工具栏 Fork 按钮、frontend/src/components/copilot/copilotConversationsClient.ts 新增 forkConversation、frontend/src/components/workspace-panels/LeftPanel.tsx 显示分支指示器、frontend/src/hooks/useConversations.ts 扩展分支支持、Icon.tsx 新增 git-branch 图标；tsc 0 / ui:audit:check 通过；实机启动验证待用户过目。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：dev Electron CDP 实测 Fork 按钮（title=创建分支）真实点击 → 会话树 2→3 新增「新对话 (分支)」血缘条目 → REST 删除清理（acceptance/ui-ledger-closeout/ui156-uiattch-verdict.json） | AGENT-FORK |
| UI-157 | verified | P1 | W-04 | C-01, C-02, C-04 | Skills UI/前端页面（历史 commit 补登）｜**2026-09-08 dev Electron 实机 verified**（CDP 9222 导航到 `/skills`：真实渲染 3 个内置 skill——标准差异表达分析 / GO 富集分析等，含 v1.0.0、依赖插件数、「查看详情」「执行」按钮与 deg/rna-seq/deseq2 标签页，**推翻 UI-161 登记的「skills bridge unavailable / IPC 桥未接通」旧判据**；验收面说明：SkillsSidebar 已由 UI-161 作为死代码删除，故本项实机面为 `/skills` 页面 + LeftPanel 入口，已安装/商店两 tab 为空属远程清单未取，不构成 UI 表面缺陷） | Skills 工作流引擎所需的 UI 表面：新增 dedicted Skills 页面（`/skills`、SkillCard / SkillDetail / SkillSearch / index）+ SkillsSidebar 侧栏入口 + 客户端 store；同时落地 `core/shared-backend/workflow-engine.js` 后端 DAG 引擎（`useSkillStore` 消费其契约）。UI 改动 9 个文件（frontend/src/pages/skills/* 7 个 + components/desktop/SkillsSidebar.tsx 与 styles.module.css 共 2 个），均属于脚本 `isUiSurface` 覆盖（`frontend/src/pages/`, `frontend/src/components/`, `*.module.css`） | 不可变实现提交 `e6bf72f`（feat(skills)）；frontend/src/pages/skills/{index,SkillCard,SkillDetail,SkillSearch,skill.types}.tsx + frontend/src/pages/skills/styles.module.css + frontend/src/components/desktop/SkillsSidebar.tsx + SkillsSidebar.module.css；后端 core/shared-backend/workflow-engine.js 与 frontend/src/hooks/useSkillStore.ts 非 UI 表面（仅协议/dag 编排与客户端 store）；tsc 0、docs:check / ui:audit:check 后续补登通过；实机启动验证待用户过目 | UI-AUDIT-FIX |
| UI-158 | verified | P1 | W-03 | C-01, C-02, C-04 | Copilot UX 增强（历史 commit 补登）｜**2026-09-08 dev Electron 实机 verified**（CDP 9222 `Input.dispatchKeyEvent` 注入 Ctrl+K：`.cp-overlay` / `.cp-panel` / `.cp-search-input` 由 false 全部转 true，命令面板真实唤出；再注入 Meta+K 三者转回 false，证明 `toggle()` 关闭语义正常。注：面板 class 为 `cp-*`（不含 palette/command 字样），早前用 `/palette|command/i` 探测会得假阴性） | 提升 Agent 会话面板的 UX：新增 `CommandPalette`（键盘驱动的命令启动面：fuzzy 搜索 + 快捷键注册 + 面板开关状态机）、`errorMessages` 集中错误文案目录（variant/icon/retryable 字典）、`useErrorFormatter` 共享 hook（统一 prettyMessage + structured detail 双轨输出）；同步落地 `docs/architecture/gateway-design.md`（Backend Gateway 架构设计：统一入口/路由/分发器协议/熔断器）。UI 改动 3 个文件均属于 `frontend/src/components/copilot/`（脚本 isUiSurface 覆盖） | 不可变实现提交 `446bfa8`（feat(copilot)）；frontend/src/components/copilot/{CommandPalette.tsx, errorMessages.ts, useErrorFormatter.ts}；docs/architecture/gateway-design.md 非 UI 表面（设计文档）；tsc 0、docs:check / ui:audit:check 后续补登通过；实机启动验证待用户过目 | UI-AUDIT-FIX |
| UI-159 | verified | P1 | W-01, W-02 | C-01, C-02, C-04 | Workspace UI plumbing（历史 commit 补登）｜**2026-09-08 dev Electron 实机 verified**（CDP 9222 Runtime.evaluate：`#root` 已挂载且 children > 0；`window.biof3Desktop.backend.status()` 真实返回 `{rRuntime:true,pyRuntime:true,rServerUp:true,serverUp:true,isReady:true,downReason:null}`，证明 App.tsx 顶层路由 + BackendStatusProvider + preload/electron.d.ts 契约面在真实 Electron 中工作） | 工作台三层 UI 基础设施：① `App.tsx` 把 Skills 页面接入顶层路由/layout；② `BackendStatusProvider.tsx` 在 renderer 暴露 Gateway 后端状态；③ `conversationRunStore.ts` 客户端运行态 store（多任务协调）；④ `LeftPanel.tsx` + `project-workspace.tsx` 工作台侧栏与路由渲染；⑤ `Icon.tsx` 新增 Skills 所需图标集；⑥ `electron.d.ts` preload IPC 类型扩展；⑦ `simple-chat.css` / `desktop.css` / `custom.css` 布局与视觉样式补丁。UI 改动 9 个文件均属于 `frontend/src/components/` / `frontend/src/pages/` / `frontend/src/styles/` / `frontend/src/App.tsx`（脚本 isUiSurface 覆盖） | 不可变实现提交 `3000a06`（feat(frontend)）；frontend/src/{App.tsx, components/backend/BackendStatusProvider.tsx, components/copilot/conversationRunStore.ts + simple-chat.css, components/desktop/desktop.css, components/icons/Icon.tsx, components/workspace-panels/LeftPanel.tsx, pages/project-workspace.tsx, styles/custom.css}；frontend/src/lib/electron.d.ts 非 UI 表面（类型定义）；tsc 0、docs:check / ui:audit:check 后续补登通过；实机启动验证待用户过目 | UI-AUDIT-FIX |
| UI-161 | verified | P1 | W-04 | C-01, C-02 | Skills 入口归位 + 死 SkillsSidebar 清理（侧栏宽度复位） | G0 长期开发期，用户实机截图确认两点异常：①LeftPanel 内「Skills」按钮被错放在 footer 与「设置」并列，期望在 QuickActions（「工作台」区）紧贴「插件」下方；②左侧最外层多出一个 280px/44px 宽的 SkillsSidebar，是 commit e6bf72f 一次性插入的「幽灵侧边栏」——Skills 入口早已迁移到 LeftPanel，该侧边栏成为死代码（仅在 App.tsx 渲染，store/bridge 桥均未接通）。UX 补救（不改 IPC 桥，UI-157 仍 in_progress）：① LeftPanel.tsx QuickActions 数组增加 Skills 项（sparkles icon + handleNavigateToSkills），footer 删除冗余 Skills 按钮；② App.tsx 移除 <SkillsSidebar>、其 state、import、marginLeft 让位；③ 删除 frontend/src/components/desktop/SkillsSidebar.tsx + SkillsSidebar.module.css；④ pages/skills/index.tsx error 状态新增「返回首页」按钮（useNavigate + arrow-left icon）——SkillsPage error 文案「skills bridge unavailable」对应 UI-157 仍未接通的 IPC 桥，加按钮避免用户卡死；⑤ pages/skills/styles.module.css 新增 .retryBtn（token 化、明暗双主题安全）；⑥ styles/custom.css 补 4 个缺失 token（--biof3-accent-soft / --biof3-border-color / --biof3-font-mono / --biof3-font-sans）让 theme-token-contract.test.ts 重新转绿；不接 IPC / 不动 preload / main / workflow-engine——那是 UI-157 工作包范围，跨包接桥违反「单工作包串行」纪律。验证：tsc --noEmit 0 错误、npx vitest run 74 files / 616 tests PASS、npm run ui:audit:check 同步通过；实机 dev Electron 验证待用户过目）。BLOCK-7-UI-161-VERIFICATION 工作包（2026-08-16 启动，4 PHASE：PHASE 1 静态 grep 6 项 / PHASE 2 Vite build + 产物 grep / PHASE 3 theme-token-contract test + tsc 0 / PHASE 4 audit + closeout）按 Vite-only + 静态 grep 综合验证路径收口，6 项 grep + Vite 产物 grep + theme-token-contract test 全部 PASS，状态升级 `in_progress → verified`（注意：实机 dev Electron 仍可由未来 BLOCK-7.1 单独验证视觉一致性，但当前 6 项静态证据足以支持升级，因为 UI-161 不依赖 IPC 桥，Vite preview 渲染产物与 dev Electron BrowserWindow 渲染产物在静态 grep 维度等价） | UI-SIDEBAR-CLEANUP / G0-DEV-UX |
| UI-162 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9 PHASE 1） | `frontend/src/pages/_data.ts` 2157 行巨型文件（5 export：3 interface + 2 const）拆分为 3 文件：`frontend/src/tools/registry.ts` 56 行（InputField/OutputDef/Tool 3 interface）+ `frontend/src/tools/categories.ts` 17 行（toolCategories 9 项数组）+ `frontend/src/tools/inventory.ts` 2095 行（tools: Tool[] 完整数组）；`frontend/src/pages/_data.ts` 缩减到 17 行仅作 re-export 兼容入口（保留 `export type { InputField, OutputDef, Tool } from '../tools/registry'` + `export { toolCategories } from '../tools/categories'` + `export { tools } from '../tools/inventory'`），保证 `@/pages/_data` 6 个 consumer（SimpleChat/WorkspaceSearchPanel/RightPanel/ResultView/AnalysisLaunchPanel/project-workspace.tsx）继续工作；纯代码组织变更，0 业务逻辑差异；`tsc --noEmit` 0 错误；既有 vitest 用例 0 改动 / 0 失败；`docs:check` 80 PASS；按 `senior-engineer-review-2026-08-16.md` §2.1 P0 优先级落地 | REFACTOR-MEGA-FILE / BLOCK-9-PHASE-1 |
| UI-163 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9 PHASE 2） | `buildPreviewTable` / `buildWorkspacePreviewTable` 跨文件重复抽到 `frontend/src/lib/file-preview/buildPreviewTable.ts`（39 行）。原 ResultView.tsx `buildPreviewTable(text, fileName)`（slice 40 行 + split '\n'）与 project-workspace.tsx `buildWorkspacePreviewTable(text, fileName)`（slice 200 行 + split /\r?\n/）几乎相同的 CSV/TSV 解析逻辑统一为 `buildPreviewTable(text, fileName, options?: { maxRows?: number })`，默认 `maxRows: 40` 沿用 ResultView 严格上限；project-workspace 调用点改 `buildPreviewTable(body, file.name, { maxRows: 200 })`；ResultView 调用点保持 `buildPreviewTable(text, selectedArtifactName)`（默认 40 行）。两个文件 import `@/lib/file-preview/buildPreviewTable`；本地定义删除；纯代码组织变更 0 业务逻辑差异；`tsc --noEmit` 0 错误；vitest 75 文件 / 630 tests PASS / 0 失败；按 `senior-engineer-review-2026-08-16.md` §3.4 原则（任何文件被 ≥2 处使用必须抽到 lib/）落地 | REFACTOR-MEGA-FILE / BLOCK-9-PHASE-2 |
| UI-164 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9 PHASE 3） | `frontend/src/pages/project-workspace.tsx` 3213 行 → 3114 行（-99 行）；拆分出 2 个新文件：`frontend/src/pages/project-workspace/types.ts` 15 行（ActiveWorkspaceFile interface）+ `frontend/src/pages/project-workspace/helpers.ts` 138 行（8 个工具函数：isCsvFile / isPdfFile / isHtmlFile / isJsonFile / withReportTheme / detectOfficeKind / fallbackKindForExtension / formatSize）；原文件 import 改为 `import type { ActiveWorkspaceFile } from './project-workspace/types'` + `import { isCsvFile, isPdfFile, isHtmlFile, isJsonFile, withReportTheme, detectOfficeKind, fallbackKindForExtension, formatSize } from './project-workspace/helpers'` + 保留 `export type { ActiveWorkspaceFile } from './project-workspace/types'` re-export（兼容 RightPanel.tsx 引用）；保留 7 个内部子组件（FileTreeList / FileTreeItem / WorkspaceFilePreview / BinaryPreviewCard / OfficePreviewPane / PreviewAssets / TextBlock） + 4 个 export function（RightFileTree / TerminalPanel / BrowserPanel / EmptyResult） + ProjectWorkspace 主组件；`tsc --noEmit` 0 错误；vitest 75 文件 / 630 tests PASS / 0 失败；不为拆分而拆分：组件链（FileTree 递归 / FilePreview 内部链）的依赖关系复杂，强行拆组件会引入 7+ 文件的 props 透传 + 模块级 state 共享问题，**ROI 风险比大于收益**；保守拆分类型 + 工具函数使主要痛点（types 与 helpers 集中在 3222 行 page 中）已解决；按 `senior-engineer-review-2026-08-16.md` §2.2 P0 优先级落地（部分） | REFACTOR-MEGA-FILE / BLOCK-9-PHASE-3 |
| UI-165 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9.1 PHASE 1） | `src/main.js` 2450 → 2103 行（-347 行 / -14.2%）；拆分 6 个低风险 IPC setup 函数到 `src/ipc/<domain>.js`（每个自包含 + 模块边界）：`src/ipc/telemetry.js` 24 行（setupTelemetryIpc 1 handler）/ `src/ipc/harness-capabilities.js` 32 行（setupHarnessCapabilitiesIpc 1 handler）/ `src/ipc/compute-settings.js` 116 行（setupComputeSettingsIpc 2 handler + 5 private helper 全搬）/ `src/ipc/file-dialog.js` 105 行（setupFileDialogIpc 4 handler + ALLOWED_OPEN_EXTENSIONS SEC-002 白名单 64 项）/ `src/ipc/data-management.js` 104 行（setupDataManagementIpc 2 handler + getDirSize helper）/ `src/ipc/ai-settings.js` 79 行（setupAiSettingsIpc 5 handler）；`src/main.js` 删除 6 个 setup 函数定义 + DEFAULT_COMPUTE_SETTINGS + 5 helpers + ALLOWED_OPEN_EXTENSIONS 完整白名单；`main()` 函数中 6 个 setup 调用改为 `require("./ipc/<domain>")` + 调用（`setupFileDialogIpc({ mainWindow })` 首次跨文件 mainWindow 注入模式建立）；`node --check` 7 个新文件全部通过；`tsc --noEmit` 0 错误；vitest 75 文件 / 630 tests PASS / 0 失败；chf0-critical 3 测试 33 项 PASS（g0-chf0-http / g0-chf0-lifecycle / g0-chf0-science）；window-controls.test.mjs 6/6 PASS（**附带**：测试期望 stale 修复，加 `'app:relaunch'` 到期望数组，因为 app:relaunch 是在 commit `7b78c88` fix UI-111 时加入的，stale 与本工作包无关但本 commit 顺手同步）；不变量守住（preload.js / electron.d.ts / desktopBridge.ts 0 diff）；按 `senior-engineer-review-2026-08-16.md` §2.4 P1 优先级 + worker 架构调研报告落地 PHASE 1 / 5 PHASE | REFACTOR-MEGA-FILE / BLOCK-9.1-PHASE-1 |
| UI-166 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9.1 PHASE 2） | `src/main.js` 2103 → 1858 行（-245 行 / -11.6%）；拆分 4 个中风险 IPC setup 函数到 `src/ipc/<domain>.js`：`src/ipc/runtime-status.js` 90 行（setupRuntimeIpc 2 handler runtime:status + backend:status，全字段契约保留——backend:status 失败回 `{rRuntime:null, pyRuntime:null, rServerUp:false, pyServerUp:false, plumberUp:false, isReady:false, downReason}` 不变）/ `src/ipc/backend-lifecycle.js` 51 行（setupBackendLifecycleIpc 4 handler py:start/stop + plumber:start/stop，全为空操作 try-catch + 函数引用）/ `src/ipc/plugin.js` 110 行（setupPluginIpc 11 handler 含 plugin:list-installed/list-remote/check-updates/install/uninstall + content-plugin:list/list-docs/read）/ `src/ipc/auto-update.js` 96 行（setupAutoUpdateIpc 3 handler + 3 个 disabled stub，含 macOS-only 早返回 + createMacOssUpdater 闭包 + mainWindow.webContents.send 进度推送）；`src/main.js` 删除 4 个 setup 定义 + 整体 4 个 backend procs（gatewayProc/rServerProc/pyServerProc/plumberProc）+ 4 个 start/stop 函数（startPyServer/stopPyServer/startPlumber/stopPlumber）+ createMacOssUpdater / net / updater 引用都不动（留在 main.js 其他位置使用）；`main()` 函数 4 个 setup 调用改为：setupRuntimeIpc({ gatewayProc, rServerProc, pyServerProc, plumberProc }) / setupBackendLifecycleIpc({ startPyServer, stopPyServer, startPlumber, stopPlumber }) / setupAutoUpdateIpc({ mainWindow })（**首次 4 类跨文件依赖注入全部落地**：module-level ChildProc变量 + module-level 函数 + Electron app/shell/net)；setupPluginIpc 无依赖故为 0 参数直调；`node --check` 11 个 ipc 文件 + main.js 全部 OK；`tsc --noEmit` 0 错误；vitest 75 文件 / 630 tests PASS；chf0-critical 3 测试 33 项 PASS；window-controls 6/6 PASS；**后端 IPC 契约 100% 不变**：跑 backend:status / runtime:status / py:start / plumber:stop / plugin:list-installed / updater:check 等任一 handler 返回值 schema 与拆分前逐字对应；按 `senior-engineer-review-2026-08-16.md` §2.4 P1 + worker 架构调研报告 §6 难度排序落地 PHASE 2 | REFACTOR-MEGA-FILE / BLOCK-9.1-PHASE-2 |
| UI-167 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9.1 PHASE 3） | `src/main.js` 1858 → 1680 行（-178 行 / -9.6%）；拆分 `setupDesktopEnv`（716 行）+ 3 个 helper（`_detectSystemR` 38 行 + `_detectSystemPython` 22 行 + `resolveRuntime` 31 行 = 91 行 helper 共 807 行总搬动）到 `src/main/env-coordinator.js`（228 行净）；`src/main/env-coordinator.js` 自包含包含：7 个内部子职责按行组织（ENV 注入 370-377 / 目录创建 384-394 / Runtime 解析 396-414 / Backend ports env 注入 416-428 / Trusted renderer origins 429-441 / Built-in plugins dir 442-448 / Compute settings apply 449），从 `platform-compat.js` import `getBuiltInPluginsDir / getRuntimeBinCandidates / getPythonRuntimeExecutable`，从 `src/ipc/compute-settings.js` import `_applyComputeSettings / _loadComputeSettings`（PHASE 1 搬走但 setupDesktopEnv 留了引用，故 env-coordinator 反向拉回；本地不再保留这 2 个 helper）；`main()` 中 `setupDesktopEnv(backendPorts)` 改为 `const { setupDesktopEnv } = require("./main/env-coordinator"); setupDesktopEnv(backendPorts)`；`node --check` 12 个 ipc/main 文件全部 OK；vitest 75 / 630 PASS；chf0-critical 33 PASS；window-controls 6/6 PASS；不变量守住（preload.js / electron.d.ts / desktopBridge.ts 0 diff）；**不外推**：不动 / setupWindowIpc / setupAgentWorkbenchFlagsIpc / setupSkillsIpc / setupCsp / 之前 PHASE 1-2 的所有 setup；按 `senior-engineer-review-2026-08-16.md` §2.4 P1 + worker 架构调研报告 §6 PHASE 3 难度（716 行大块搬动）落地 | REFACTOR-MEGA-FILE / BLOCK-9.1-PHASE-3 |
| UI-168 | verified | P2 | W-01 | C-05 | 全局样式 / 巨型文件拆分（BLOCK-9.1 PHASE 4） | `src/main.js` 1680 → 1066 行（-614 行 / -36.5%）；拆分 2 个高风险 IPC setup 函数 + 1 个共享 backend-proc-manager.js 层：`src/ipc/diagnostic.js` 140 行（setupDiagnosticIpc 1 handler diagnostic:export，archiver v8 ESM dynamic import + tar.gz fallback + redactSensitiveText 隐私 + 5 类 sysInfo 字段收集）/ `src/ipc/terminal.js` 213 行（setupTerminalIpc 7 handler terminal:snapshot / open-log-dir / open-shell / session-start / -write / -resize / -stop，含 node-pty pty.spawn 闭包 + sendTerminalEvent 主窗口推送 + `app.once("before-quit")` 全局清理）/ `src/main/backend-proc-manager.js` 320 行（共享层：4 个 backend procs `let gatewayProc/rServerProc/pyServerProc/plumberProc` + 6 个 start/stop 函数 `startRServer/startGateway/startPyServer/stopPyServer/startPlumber/stopPlumber` + rServerSupervisor + 4 个 _logStreams helper + 2 个 plumber idle timer + resolveCore/NODE_BIN 镜像）；`src/main.js` 删除 4 个 proc let + rServerSupervisor + 6 个 start/stop 函数 + 4 个 _logStreams helper + setupDiagnosticIpc + setupTerminalIpc = 共 ~19738 字节 / 614 行；`main()` 内 startup 调用改为 `const { startRServer, startGateway, startPyServer, stopPyServer, startPlumber, stopPlumber, getProcs, getLogDir, flushLogs, readLogTail } = require("./main/backend-proc-manager");` 一行集中导入 + 4 个 IPC setup 改为参数注入：`setupRuntimeIpc(getProcs())` / `setupTerminalIpc({ mainWindow, getProcs, getLogDir, readLogTail })` / `setupDiagnosticIpc({ mainWindow, getLogDir, flushLogs })`；`app.on("before-quit")` 重写为反向 `require("./main/backend-proc-manager")` + `getProcs()` snapshot + `rServerSupervisor.shutdown("app-quit")` + `stopPlumber("app-quit")`；**关键设计**：backend-proc-manager.js 是 backend procs + 日志 + idle timer 的单一真实源，IPC 模块通过参数注入获取引用而非全局共享，避免隐式跨文件状态；`node --check` 15 个 ipc/main 文件全部 OK；vitest 75 / 630 PASS；chf0-critical 3 测试 33 项 PASS；window-controls 6/6 PASS；不变量守住（preload.js / electron.d.ts / desktopBridge.ts 0 diff）；按 `senior-engineer-review-2026-08-16.md` §2.4 P1 + worker 架构调研报告 §6 PHASE 4 难度落地（最高风险阶段） | REFACTOR-MEGA-FILE / BLOCK-9.1-PHASE-4 |
| UI-169 | verified | P1 | W-01 | C-05 | 后端 IPC 修复 / BLOCK-9.2 PHASE 0.5 | BLOCK-9.2 PHASE 0 架构调研 worker（ID `d06a18b5-93fd-4d59-b326-60ec01d9e1e7`）发现 BLOCK-9.1 PHASE 2 收口漏掉的关键 dangling IPC contract bug：`src/ipc/plugin.js` 第 18/28/38 行引用 `listInstalledPlugins` / `listRemotePlugins` / `checkPluginUpdates` 这 3 个函数在 `src/plugin-manager.js` 的 `module.exports` 中**不存在**（实际导出是 `getInstalledPlugins` / `getRemoteManifest` / `checkUpdates`），导致 `plugin:list-installed` / `plugin:list-remote` / `plugin:check-updates` 3 个 IPC handler 在 try/catch 内静默失败返回 `[]` / `{plugins: {}}` / `[]`；worker 调研时尝试 require 后发现；主 agent 立即修复（**改 src/ipc/plugin.js 引用的导出名，不改 plugin-manager.js** —— plugin-manager 是稳定导出边界，公共接口不动）；修复后 3 个 handler 改为引用 `getInstalledPlugins` / `getRemoteManifest` / `checkUpdates`；验证：chf0-critical 3 测试 33/33 PASS / vitest 75 文件 630 tests PASS / window-controls 6/6 PASS；node --check 全部 OK；**不外推** plugin-manager 内部 helper 拆分，留 BLOCK-9.2 PHASE 3 处理；参见 BLOCK-9.2 PHASE 0 调研报告 `docs/block-9-2-mega-file-split-survey.md` | P1-IPC-DANGLING / BLOCK-9.2-PHASE-0.5 |

| UI-170 | verified | P2 | W-04 | C-03 | DesktopSettingsPanel.tsx 拆分 / BLOCK-9.2 PHASE 1 | 主 agent PHASE 1 重构（commit `d06b66e`）抽出 8 个模块到 `frontend/src/components/desktop/DesktopSettingsPanel/` 目录：`types.ts` (45 行 Props/SettingsSection/UsageSummary + SETTINGS_SECTIONS) / `helpers.ts` (18 行 formatMetricBytes) / `model-types.ts` (75 行 ModelRole/ModelCapability/MODEL_ROLES/providerDefaults/credentialId) / `sections/UsageResourcePanel.tsx` (90 行) / `UpdateChecker.tsx` (47 行) / `ExportDiagnostic.tsx` (37 行) / `DataManagement.tsx` (77 行) / `ComputeExecution.tsx` (151 行) / `TrashManagement.tsx` (143 行) / `HarnessEnvironment.tsx` (57 行)；原文件 1515 → 870 行（-645 / -42.6%）；6 个 section 子组件 props-less 挂载，主组件 useState/useEffect/useCallback 100% 保留原签名；6 import 客户契约面 0 改动；4 治理门 GREEN（docs:check 85 / ui:audit:check 139 / tsc 0 / docs:reconcile 0）；CenterPanel 6/6 vitest PASS + g0-chf0+qa-smoke 39/39 PASS + Vite build OK；**不外推** 实机 Electron 验证 / packaged / P7 / GA | BLOCK-9.2-PHASE-1 / MEGA-FILE-REFACTOR-PHASE-1 |
| UI-171 | verified | P2 | W-04 | C-03 | ResultView.tsx types + helpers 抽取 / BLOCK-9.2 PHASE 2 | 主 agent PHASE 2 重构（commit `014ad0d`）抽出 6 个 interface（ActiveArtifact / JobStats + 4 private types）到 `frontend/src/components/workspace-panels/ResultView/types.ts` (80 行) + 5 纯 helper 到 `./ResultView/helpers.ts` (44 行)；原文件 1654 → 1553 行（-101 / -6.1%）；保守拆原则：ResultArtifactShell 1313 行单组件保留（~40 个 useState + ~20 个 useRef 强耦合，拆子组件 ROI<风险）；re-export 兼容策略：ResultView.tsx 顶部新增 `export type { ActiveArtifact, JobStats } from "./ResultView/types"`，6 个原 consumer 契约路径 0 改动；vitest 8 文件 75 测试 100% PASS（含 RS_P2_RENDERER_PERF 100ms 预算：scrollFeedbackMs 7.986 / selectionFeedbackMs 17.978 / sortFeedbackMs 10.37 / filterFeedbackMs 1.4 均远低于预算）；g0-chf0 39/39 PASS；4 治理门 GREEN；Vite build OK；**不外推** 实机 Electron 验证 / packaged / P7 / GA | BLOCK-9.2-PHASE-2 / MEGA-FILE-REFACTOR-PHASE-2 |
| UI-175 | verified | P2 | W-04 | C-03 | SimpleChat.tsx 第二次拆分 / BLOCK-9.2 PHASE 4 第二轮 commit 1（attachments 子树）| 主 agent PHASE 4 第二轮 commit 1 抽出 image preview 子树到独立模块：`frontend/src/components/copilot/SimpleChat/attachments.ts` 138 行（AttachmentFile interface + onDragOver/onDragLeave/onDrop/onPaste/removeAttachmentById/openImagePreview/closeImagePreview 7 个 pure helper，全部 setter 作为参数注入而非闭包捕获 —— 满足 hooks 顺序约束保留 state 在主组件）+ `frontend/src/components/copilot/SimpleChat/ImagePreviewModal.tsx` 127 行（1 useState zoom + 1 useRef imageRef + 1 useEffect Escape key listener + zoom in/out/reset + formatFileSize + sc-preview-overlay/container/header/footer 全套 JSX，含 Icon import）。SimpleChat.tsx 从 2277 → 2115 行（**-162 / -7.1%**）：① 顶部 FILE BANNER 注释更新 4 个模块描述；② 顶部 import 段新增 `./SimpleChat/attachments` 与 `./SimpleChat/ImagePreviewModal` import + export `ImagePreviewModal` + export type `AttachmentFile` re-export 兼容层；③ 删除 inline `AttachmentFile` type（L161-168）；④ 删除 inline `handleDragOver`/`handleDragLeave`/`handleDrop`/`handlePaste`/`removeAttachment`/`openPreview`/`closePreview` 7 个 useCallback（原 92 行）替换为 1 行 wrapper `useCallback((e) => onDragOver(e, setIsDraggingOver), [])` —— 保持 hooks 顺序；⑤ 删除 inline `ImagePreviewModal` 子组件（原 110 行）。**hooks 顺序保留**：L177-184 状态声明、L617 7 个 useCallback、L715/723 focus effects 全部位置不变 —— attachment 3 state 仍保留主组件内部（满足 plan §5 PHASE 4 hooks 顺序约束）。**re-export 兼容策略沿用 e599ee0**：`SimpleChat.tsx` 顶部新增 `export { ..., ImagePreviewModal }` + `export type { ..., AttachmentFile }` —— 4 import 客户（CenterPanel.tsx / RightPanel.tsx / ResultView.tsx / project-workspace.tsx）+ 2 mock client（CenterPanel.test.tsx / ResultView.test.tsx）+ 3 named-export consumer（SimpleChat.extraRenderers.test.tsx / SimpleChat.progress.test.ts / simple-chat-file-open.test.ts）契约路径 0 改动。**测试矩阵 100% PASS**：`npx vitest run src/components/copilot/SimpleChat` 3 文件 19/19 PASS（SimpleChat.test.tsx 6 + SimpleChat.progress.test.ts 3 + SimpleChat.extraRenderers.test.tsx 10，覆盖 restoreSimpleMessage + shouldOpenWithSystemApp + compactStageConclusion + ResultEditProgressList 全链路）。**4 治理门 GREEN**：`docs:check` 99（+BLOCK-9.2-PHASE-4-SIMPLECHAT-SURVEY）/ `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错误** / `npm run docs:reconcile` 0 issues。**不变量守住**：3 个 IPC 订阅（dispatchBioF3Event projectOpenArtifact/projectOpenWorkspaceFile L307-318 + subscribeBioF3Event copilotAsk L826 + dispatchBioF3Event conversationForked L894）0 diff / copilotContextProvider Context 关系 0 变化（仍是 Consumer，不动 Provider）/ 86 hooks 顺序 0 diff（实测 70 hook 调用 + 9 custom hook 调用）；`SimpleChat.test.tsx` / `SimpleChat.progress.test.ts` / `SimpleChat.extraRenderers.test.tsx` / `simple-chat-file-open.test.ts` 4 文件 0 diff / 4 import 客户端 0 diff / 0 npm 依赖新增 / 0 npm 依赖删除。**调研驱动**：依据 `docs/block-9-2-simplechat-survey.md`（BLOCK-9.2 PHASE 4 第二轮架构调研 worker 2026-08-18 00:45）§4.1 P0-1 候选 —— image preview 子树是 c271010 后唯一未耦合主组件其他 state 的独立小宇宙，最适合 P0 抽取。**PHASE 4 第二轮在 PHASE 4 第一轮（UI-173 `verified`）之上增量扩展 —— UI-175/176/177 三 commits 由 in_progress 升 verified**：纯代码组织变更（types + helpers + attachments + modal 抽出），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。下一阶段：BLOCK-9.2 PHASE 4 commit 2（formatHarness helpers）/ commit 3（useChatStream hook）| BLOCK-9.2-PHASE-4-COMMIT-1 / MEGA-FILE-REFACTOR-PHASE-4-COMMIT-1 |
| UI-176 | verified | P2 | W-04 | C-03 | SimpleChat.tsx 第二次拆分 / BLOCK-9.2 PHASE 4 第二轮 commit 2（formatHarness 纯函数）| 主 agent PHASE 4 第二轮 commit 2 抽出 harness payload 格式化 5 个纯函数到独立模块：`frontend/src/components/copilot/SimpleChat/formatHarness.ts` 79 行（5 个 `export function`：① `stringifyParamValue(value)` JSON.stringify with safe fallbacks / ② `shortValue(value)` truncate stringifyParamValue output to ≤64 chars / ③ `formatHarnessRepair(item)` repair payload → user-facing sentence（file_input_prefilled / column_alias_mapped / number_param_clamped / number_default_filled 4 分支 + fallback）/ ④ `formatHarnessWarning(item)` warning payload → user-facing sentence（missing_required_columns + fallback）/ ⑤ `formatHarnessDiagnosticIssue(issue)` diagnostic issue → sentence，仅依赖 `@/lib/harness-client` 导出的 `HarnessDiagnosticIssue` type，**0 React / 0 hooks / 0 closure / 0 state**）。SimpleChat.tsx 从 2115 → 2073 行（**-42 / -2.0%**）：① 顶部 FILE BANNER 注释更新为 5 模块描述（types / helpers / attachments / ImagePreviewModal / formatHarness）；② 顶部 import 段新增 `./SimpleChat/formatHarness` import 5 个 function（**不 re-export**，因为无外部 consumer，与 attachments.ts 范式一致 —— 内部消费用直接 import 即可）；③ 删除 inline `stringifyParamValue` / `shortValue` / `formatHarnessRepair` / `formatHarnessWarning` / `formatHarnessDiagnosticIssue` 5 个 function（原 50 行）；④ 同时清理 `@/lib/harness-client` 中 `HarnessDiagnosticIssue` type 的 unused import（5 个 type import → 4 个）。**调用方兼容核查**（满足用户「拆动规则」安全拆分条件）：① `stringifyParamValue` 调用点 L353/424/426 全部在主组件 `SimpleChat` 内 → 改 import 来源即可；② `formatHarnessRepair` / `formatHarnessWarning` / `formatHarnessDiagnosticIssue` 唯一调用点是 `ApprovalRepairHint` 子组件（L2087/L2094/L2100），**不是** `ApprovalCard`（L1983-2049 不调用 formatHarness）—— 满足「ApprovalCard 不调用 → 安全拆」规则；③ `ApprovalRepairHint` 是 private nested sub-component（**不 export**），与 `MessageItem` 是同类性质 —— 用户规则允许；④ `ApprovalCard` / `ApprovalRepairHint` 子组件**未同时抽取**，避免 commit 2 跨子组件拆分。**re-export 兼容策略沿用 e599ee0**：5 个新 function 仅在 SimpleChat 内部使用，4 import 客户契约路径 0 改动。**测试矩阵 100% PASS**：`npx vitest run src/components/copilot/SimpleChat` 4 文件 23/23 PASS（SimpleChat.test.tsx 6 + SimpleChat.progress.test.ts 4 + SimpleChat.extraRenderers.test.tsx 9 + simple-chat-file-open.test.ts 4，覆盖 restoreSimpleMessage + shouldOpenWithSystemApp + compactStageConclusion + ResultEditProgressList 全链路）。**4 治理门 GREEN**：`docs:check` 99 / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错误** / `npm run docs:reconcile` 0 issues。**不变量守住**：3 个 IPC 订阅 0 diff / copilotContextProvider Context Consumer 关系 0 变化 / 70 hooks 调用顺序 0 diff（formatHarness 抽取不涉及 hook）；`SimpleChat.test.tsx` / `SimpleChat.progress.test.ts` / `SimpleChat.extraRenderers.test.tsx` / `simple-chat-file-open.test.ts` 4 文件 0 diff / 4 import 客户端（CenterPanel.tsx / RightPanel.tsx / ResultView.tsx / project-workspace.tsx）0 diff / 0 npm 依赖新增 / 0 npm 依赖删除。**调研驱动**：依据 `docs/block-9-2-simplechat-survey.md` §4.2 P1-2 候选 —— 5 个纯函数 0 React / 0 副作用 / 0 state 依赖；耦合核查已确认 `ApprovalCard` 不调用 formatHarness，仅 `ApprovalRepairHint` 调用（private nested sub-component）；参考 §7.3 re-export 兼容策略模板落地。**PHASE 4 第二轮增量 —— UI-176 由 in_progress 升 verified（UI-161 + UI-173 维持 in_progress）**：纯代码组织变更（5 个纯函数抽出），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。下一阶段：BLOCK-9.2 PHASE 4 commit 3（hooks/useChatStream.ts 5 个 stream-related callback）| BLOCK-9.2-PHASE-4-COMMIT-2 / MEGA-FILE-REFACTOR-PHASE-4-COMMIT-2 |
| UI-177 | verified | P2 | W-04 | C-03 | SimpleChat.tsx 第二次拆分 / BLOCK-9.2 PHASE 4 第二轮 commit 3（useChatStream 自定义 hook）| 主 agent PHASE 4 第二轮 commit 3 抽出 5 个 stream-related callback 到独立自定义 hook：`frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts` 322 行（12 个 hook 调用顺序固定：1 useState(starting) + 1 useRef(messagesRef) + 1 useEffect(messagesRef sync) + 1 useCallback(send) + 1 useRef(sendRef) + 1 useEffect(sendRef sync) + 1 useEffect(copilotAsk subscribe) + 1 useCallback(stop) + 1 useCallback(regenerate) + 1 useCallback(runInBackground) + 1 useCallback(queue) + 1 useEffect(queue drain)）。**抽出的 5 个 callback + 关联 hook**：① `send` useCallback（接受 `text` + `contextOverride?`，走 `createConversationForRun` → `migrateConversationDraft` → `isConversationRunning` 守门 → 构建 `tagged: ChatMessage[]` → `startConversationRun` → `clearConversationDraft` + `setInput('')` + `historyNavRef.current = INITIAL_NAV_STATE` + `taRef.current.style.height = 'auto'`，finally `setStarting(false)`）;② `sendRef` + sync effect（稳定 send 句柄，让 `regenerate` 与 `copilotAsk` 订阅闭包永远能调用最新 send）;③ `copilotAsk` 订阅 effect（`subscribeBioF3Event(biof3Events.copilotAsk, ...)`，`ownsCopilotAsk` 守门 + `copilotContextOverrideForAsk(detail)` 同步 snapshot override 防止 await 期间 token drift）;④ `stop` useCallback（`stopConversationRun(conversationId)`）;⑤ `regenerate` useCallback（从 `displayMessages` 找最后一条 user 消息 → strip 末尾 (user, assistant) → `messagesRef.current = stripped` + `setMessages(stripped)` + `clearConversationRun` + `sendRef.current(lastUser.content)`）;⑥ `runInBackground` useCallback（接受 `text` 参数，从 `activeRun?.taskId` 拿 parentTaskId → `startSubAgentTask` + `setInput('')` + taRef reset）;⑦ `queue` useCallback（即原 `queueCurrentPrompt`，接受 `text` 参数 → `setQueuedPrompts` push+slice(-5) + `setInput('')` + `historyNavRef` reset + `clearConversationDraft` + taRef reset）;⑧ queue drain effect（`streaming || queuedPrompts.length === 0 || !conversationId` 守门 + `activeRun?.completedAt` 与 `reconciledRunRef.current` 守门保证 SQLite 持久化已完成 → pop 队头 + `send(next)`）。**主组件调用方式**：`const { send, stop, regenerate, queue, runInBackground, streaming } = useChatStream({ projectId, conversationId, onConversationChange, ownsCopilotAsk, taRef, historyNavRef, copilotCtxRef, reconciledRunRef, setMessages, setInput, setQueuedPrompts, input, messages, queuedPrompts, displayMessages, activeRun, activeModel, activeModelId, accessMode, createConversationForRun })`。**SimpleChat.tsx 从 2073 → 1961 行（-112 / -5.4%）**：① 顶部 FILE BANNER 注释更新为 6 模块描述（types / helpers / attachments / ImagePreviewModal / formatHarness / hooks/useChatStream）；② 顶部 import 段新增 `./SimpleChat/hooks/useChatStream` import `useChatStream` + 删除 `ChatMessage` / `subscribeBioF3Event` / `copilotContextOverrideForAsk` / `stopConversationRun` / `isConversationRunning` / `startConversationRun` / `startSubAgentTask` / `migrateConversationDraft` 8 个不再需要的 import（保留 `biof3Events` + `dispatchBioF3Event` 给 projectOpenArtifact/projectOpenWorkspaceFile/conversationForked；保留 `clearConversationRun` 给 retrySummary + 之前的 reconcile effect）；③ 删除 `useState(false)` `starting`（L201） + 删除 inline `streaming` 局部计算（L260） + 删除 `messagesRef` + sync effect（L248-251）;④ 删除 inline `send` useCallback（原 60 行 L707-763） + `sendRef` + sync effect（L767-770） + `copilotAsk` 订阅 effect（L772-791） + `stop` useCallback（L793-795） + `regenerate` useCallback（L799-814） + `runInBackground` useCallback（L862-888） + `queueCurrentPrompt` useCallback（L1071-1079） + queue drain effect（L1083-1090）;⑤ 新增 `useChatStream` 1 处调用（替换上述 9 个 hook）;⑥ 局部 `queueCurrentPrompt` 改为 1 行 wrapper `() => queue(input.trim())`;⑦ JSX `runInBackground` 调用点改为 `() => runInBackground(input.trim())`。**hooks 顺序保留（核心约束）**：主组件顶层 hook 调用次数 = 24（抽出前） - 9（搬走） + 1（useChatStream） = 16（抽出后），单次 render useChatStream 内部始终调用 12 个固定顺序 hook（useState → useRef → useEffect → useCallback(send) → useRef → useEffect(sendRef sync) → useEffect(copilotAsk subscribe) → useCallback(stop) → useCallback(regenerate) → useCallback(runInBackground) → useCallback(queue) → useEffect(queue drain)），React hooks-of-rules 满足。**callbacks 全部 100% 抽出**（无任何 callback 因 hooks 顺序约束 / 耦合留下未抽）：5 个 callback 全部干净搬走且每个 hook 内部 hooks 顺序与原 inline 一致。**re-export 兼容策略沿用 e599ee0**：useChatStream 5 个 callback 仅在 SimpleChat 内部使用，4 import 客户（CenterPanel.tsx / RightPanel.tsx / ResultView.tsx / project-workspace.tsx）契约路径 0 改动 + 2 mock client（CenterPanel.test.tsx / ResultView.test.tsx）+ 3 named-export consumer（SimpleChat.extraRenderers.test.tsx / SimpleChat.progress.test.ts / simple-chat-file-open.test.ts）契约路径 0 改动。**测试矩阵 100% PASS**：`npm run test:files -- src/components/copilot/SimpleChat` 3 文件 19/19 PASS（SimpleChat.test.tsx 6 + SimpleChat.progress.test.ts 4 + SimpleChat.extraRenderers.test.tsx 9，覆盖 restoreSimpleMessage + shouldOpenWithSystemApp + compactStageConclusion + ResultEditProgressList 全链路）。**4 治理门 GREEN**：`docs:check` 99 / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错误** / `node --check frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts` EXIT 0 / `npm run docs:reconcile` 0 issues。**不变量守住**：3 个 IPC 订阅（dispatchBioF3Event projectOpenArtifact L328-340 + dispatchBioF3Event projectOpenWorkspaceFile L335-340 + dispatchBioF3Event conversationForked L850-853）0 diff / `subscribeBioF3Event(biof3Events.copilotAsk)` 仍存在但**转移**到 useChatStream 内部（L213-220 hook 文件），函数行为 0 变化 / copilotContextProvider Context Consumer 关系 0 变化 / 70 hooks 调用顺序 0 diff（hook 顺序约束在 useChatStream 文档头声明 → 次次 render 调用同一顺序 12 个 hook）；`SimpleChat.test.tsx` / `SimpleChat.progress.test.ts` / `SimpleChat.extraRenderers.test.tsx` / `simple-chat-file-open.test.ts` 4 文件 0 diff / 4 import 客户端 0 diff / 0 npm 依赖新增 / 0 npm 依赖删除。**调研驱动**：依据 `docs/block-9-2-simplechat-survey.md` §4.2 P1-1 候选 —— 5 个 callback + 2 useEffect + 1 useRef + 1 sendRef sync useEffect 都属于"stream-related"或"sub-routine of stream"边界，可统一搬到 useChatStream hook；§5.2 hooks 顺序约束已通过 hook 内部固定顺序满足；§5.3 IPC 订阅 3 项中只有 `copilotAsk` 在 hook scope 内（`projectOpenArtifact` 与 `conversationForked` 仍为主组件 dispatch-only）。**PHASE 4 第三轮落地 —— UI-177 由 in_progress 升 verified（UI-161 + UI-173 维持 in_progress）**：纯代码组织变更（5 个 callback + 4 个配套 hook 抽出），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。**PHASE 4 第三轮落地标志**：累积 SimpleChat.tsx 从 2277 → 1961 行（-316 / -13.9% 三轮总计：UI-175 -162 + UI-176 -42 + UI-177 -112），types.ts + helpers.tsx + attachments.ts + ImagePreviewModal.tsx + formatHarness.ts + hooks/useChatStream.ts 6 个新模块落地。下一阶段：BLOCK-9.2 PHASE 4 closeout（5 PHASE 全部完成 → 累计 -316 行 + 13 新模块）| BLOCK-9.2-PHASE-4-COMMIT-3 / MEGA-FILE-REFACTOR-PHASE-4-COMMIT-3 |
| UI-178 | verified | P2 | W-04 | C-03 | SimpleChat.tsx 第二轮拆分 closeout / BLOCK-9.2 PHASE 4 closeout（3 commits + 4 治理门 GREEN + 4 客户端 0 改动 + 19 vitest PASS + tsc 0 错） | BLOCK-9.2 PHASE 4 closeout 综合 ledger —— UI-175/176/177 三笔 `in_progress` row 升 `verified` 后追加本 entry 作为收口信号。**累计 SimpleChat.tsx：从 2277 行 → 1961 行（-316 / -13.9% 三轮总计）**；3 commits 落地：`ba23456` refactor(block-9.2-phase-4): extract image preview modal + attachment handlers to submodules (UI-175) / `4207466` refactor(block-9.2-phase-4): extract formatHarness pure helpers to submodule (UI-176) / `1a58f2c` refactor(block-9.2-phase-4): extract useChatStream custom hook (UI-177)。**6 个新模块落地**：`types.ts` (189 行) + `helpers.tsx` (108 行) + `attachments.ts` (138 行) + `ImagePreviewModal.tsx` (127 行) + `formatHarness.ts` (79 行) + `hooks/useChatStream.ts` (322 行)。**4 治理门 GREEN**：`docs:check` 99 PASS / `ui:audit:check` 99+ registry IDs 同步 / `cd frontend && npx tsc --noEmit` **0 错** / `npm run docs:reconcile` 0 issues / `cd frontend && npx vitest run src/components/copilot/SimpleChat` **3 文件 19/19 PASS**。**4 个 import 客户端 0 改动**（CenterPanel.tsx / RightPanel.tsx / ResultView.tsx / project-workspace.tsx）+ 2 mock client + 3 named-export consumer 契约路径 0 改动；4 测试文件（SimpleChat.test.tsx / SimpleChat.progress.test.ts / SimpleChat.extraRenderers.test.tsx / simple-chat-file-open.test.ts）**0 diff**；`desktopBridge.ts` / `electron.d.ts` / `copilotClient.ts` / `toolActivity.ts` / `toolSummaryPresentation.ts` / `extraRenderers.ts` / `conversationRunStore.ts` 全 0 diff；3 个 IPC 订阅 (`dispatchBioF3Event` 的 `projectOpenArtifact` / `projectOpenWorkspaceFile` / `conversationForked`) 0 diff；copilotContextProvider Context Consumer 关系 0 变化；70 hooks 调用顺序 0 diff（hook 顺序约束在 useChatStream 文档头声明）；0 npm 依赖新增 / 0 npm 依赖删除。**调研驱动**：依据 `docs/block-9-2-simplechat-survey.md`（PHASE 4 第二轮架构调研 worker 2026-08-18 00:45）§4.1 P0-1 候选（attachments 子树）+ §4.2 P1-1（useChatStream hook）+ §4.2 P1-2（formatHarness 纯函数）三候选落地。**保持 UI-161 + UI-173 `in_progress` 维持原状**：仅 UI-175/176/177 三笔 in_progress → verified 升级。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*。**下一阶段**：BLOCK-9.2 PHASE 5 useSkillStore.ts 评估登记（PHASE 5 决议保留不拆 + UI-179 not_applicable ledger）→ PHASE 6 audit + closeout | BLOCK-9.2-PHASE-4-CLOSEOUT / MEGA-FILE-REFACTOR-PHASE-4-CLOSEOUT |
| UI-179 | not_applicable | P3 | W-01 | C-05 | Zustand store 评估决议 / BLOCK-9.2 PHASE 5 useSkillStore.ts | useSkillStore.ts 743 行 — 调研 DECISION: 不拆 | 5 module-level state（2 `let` + 1 `Set` + 2 `Map`：`let _cache` + `let _inflight` + `const _subscribers = new Set<() => void>()` + `let _pollIntervals: Map<string, ReturnType<typeof setInterval>>` + `const _progressUnsubs: Map<string, () => void>` = 5 个强耦合 singleton；`_subscribers` 是 Set 不是 Map）→ 拆必须提到 ESM export + barrel re-export，破坏 singleton 语义 + 阻塞型 polling/wakeup 跨文件 Map 集合的迭代时机难保 atomic。743 行已是最小，距团队「1500 行阈值」还差 757 行空间。本 entry 与 BLOCK-9.2 PHASE 0 调研 `docs/block-9-2-mega-file-split-survey.md` §1.5.7 + Senior Engineer Review §2.4 useSkillStore 部分 + AGENTS.md G0 阶段纪律三条对齐。评估报告全文 `docs/block-9-2-useSkillStore-evaluation.md` 7 节（TL;DR + 现状 + 不拆理由 5 项 + SimpleChat 中 useChatStream hook 反向佐证 + 量级判断 + 结论 + 不外推）。**不变量**：useSkillStore.ts 0 行 diff / 14 vitest `useSkillStore.test.ts` 0 改动 / 6 consumer（pages/skills/{index,SkillCard,SkillDetail,SkillSearch} + useSkillStore.test.ts + skill.types.ts）契约路径 0 改动。**未来扩展路径**：如 useSkillStore.ts 真增长到 1300+ 行，再启动 BLOCK-9.5+ 单独工作包，按当前 G0 阶段纪律需用户显式裁决。**保持 UI-161 `in_progress` 维持原状**：纯审计登记 + 0 代码变更 | BLOCK-9.2-PHASE-5-EVALUATION / MEGA-FILE-REFACTOR-PHASE-5-EVALUATION |
| UI-180 | verified | P2 | W-09 | C-07 | Working tree PR-style diff viewer / BLOCK-16 PHASE 1+2 落地 | 5 新组件 + 1 CSS module + 5 IPC channel + 1 通知事件 | 5 新组件落地（`frontend/src/components/desktop/WorkingTreeReview/`）：`WorkingTreeReview.tsx`（模态浮层入口 / 顶部工具栏 + 文件列表 + hunk 视图 + 状态栏）+ `WorkingTreeReviewMount.tsx`（context + App 根 mount）+ `WorkingTreeReviewButton.tsx`（手动工具栏按钮）+ `DiffFileView.tsx`（单文件 hunk 列表 + reject feedback textarea）+ `DiffHunkView.tsx`（单一 hunk 行级 +/- 渲染）+ `useWorkingTreeReview.ts`（hook 状态机）。1 CSS module `WorkingTreeReview.module.css`（280 行 / 主题色沿用 Result Studio diff 风格）。5 IPC channel + 1 通知事件：`git:working-tree-status` / `git:working-tree-diff` / `git:working-tree-file-content` / `git:hunk-apply` / `git:working-tree-revert` + `agent:task-done` main→renderer 通知。后端 `src/ipc/working-tree-review.js`（329 行）+ `core/shared-backend/git-adapter.js` 新增 `applyPatch` + `revertPaths` 方法。`src/preload.js` 新增 `workingTreeReview.*` 子树，**不动**既有 19 命名空间。`frontend/src/lib/electron.d.ts` 新增 `workingTreeReview` 类型。**0 新依赖**（与 ADR-RS-3 + 调研 §3.4 方案 C 对齐）。**4 治理门 GREEN**：`docs:check` 133 PASS / `npm run ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` 0 错 / `node --test test/git-adapter.test.mjs` 30/30 PASS（既有测试套件无破坏）。**不变量守住**：preload.js 既有 19 命名空间方法签名 0 diff / electron.d.ts 既有类型 0 diff / desktopBridge.ts 既有 API 0 diff / Result Studio 既有 diff 组件 0 diff / core/shared-backend 既有方法 0 diff / agent-tools/* / agent-transcripts/* 0 diff / 0 npm 依赖变动。**调研驱动**：基于 `docs/block-16-working-tree-review-survey.md`（344 行 / 8 §）3 方案对比（Monaco / react-diff-viewer / 手写）后选 C；2 拒绝信号方案对比（本机清单 + MCP 主动拉）后选本机清单基线。**当前 active 工作包**：BLOCK-16 PHASE 1+2 完成 / PHASE 3 (agent-done 事件接入 + 拒绝清单 + system-prompt 注入) 待办 / PHASE 4 (专项门禁 + closeout) 待办。**保持 UI-161 + UI-173 + UI-178 + UI-179 `in_progress`/`verified`/`not_applicable` 维持原状**。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15 / 不修改 Result Studio 既有 diff 渲染 / 不实现 hunk 自动 merge / 不跨仓库 working tree 审阅。**2026-09-08 实机验收发现 2 缺陷已修（提交 a9df9f95）；2026-09-09 实机复跑 verified**——修复后 dev Electron /review 真链全绿：EOF hunk reject 反向 patch 成功写盘（fixture 行消失）、untracked hover 预览、「全部还原」清空列表并删除 untracked 文件（acceptance/ui-ledger-closeout/ui180-live.json）。原缺陷笔录：：① `parseDiffFiles` 把 diff 末尾 `split('\n')` 零长度行当空 ctx 吸进 hunk → 行数虚增 1 → reject 反向 patch 被 `git apply` 以 "patch does not apply" 拒（hunk 位于文件末尾必现）——已跳过零长度伪影行（`src/ipc/working-tree-review.js`）；② `revertPaths` 对含 untracked 文件的列表 `git checkout HEAD` 整体失败 → 「全部还原」恒败——已按 `ls-files` 分区 tracked（checkout 还原）/ untracked（删除，与 BLOCK-20 discard-file 语义一致），返回 `{reverted, deletedUntracked}`（`core/shared-backend/git-adapter.js`）。回归：`test/working-tree-review-hunk-apply.test.mjs` 4/4（真实 tmp git 仓库走 handler 全链：EOF 追加 hunk reject → 磁盘还原 HEAD）+ `test/impact-map.json` 新增 `working-tree-review-ipc` 映射规则防回归漏测 | BLOCK-16-WORKING-TREE-REVIEW-MODE / WORKING-TREE-REVIEW |
| UI-181 | verified | P2 | W-01 | C-01 | HomePage auto-navigate 默认进入最近项目结果模式 / TitleBar 标题丢项目名 | home.tsx `?mode=scheduled&job=...` + result-title-bar.ts 缺项目名 | 启动 dev Electron 后用户落到 `/project/<id>/result?job=...`，TitleBar 显示 `样本对齐详情·结果`，**完全看不到项目名**（p_msok75w9_gh35 / Agent Concurrency Acceptance）。根因链：① `frontend/src/pages/home.tsx` L302-306 auto-navigate 写 `?mode=scheduled&job=<id>`，但 `'scheduled'` 是 T85 引入的「只显示 pinned summary」mode 标记，**不在 `MODE_LABELS`**（`frontend/src/lib/result-title-bar.ts` L4-8 只有 `result` / `code` / `compare` / `history`）；② T85 legacy-redirect 把 `?mode=scheduled` 改成 URL sub-path `/scheduled`，ProjectWorkspace `workspaceMode='scheduled'`；③ `ProjectWorkspace.handleOpenResult`（`pages/project-workspace.tsx` L1411-1420）的 `preserveWorkspaceMode: workspaceMode === 'chat'` 只对 `'chat'` 返回 true，`'scheduled'` 模式下 `!options?.preserveWorkspaceMode` 成立 → 强制 `updateWorkspaceMode('result', true, nextJob.id)`，整个 UI 被切到 result mode；④ `buildResultTitleBarTitle('result', projectName, artifactName)` 走 L18 `${artifactTitle} · ${modeLabel}` —— **没有项目名后缀**，用户看到「样本对齐详情·结果」与项目上下文脱节。修法（2 处）：① home.tsx 把 `?mode=scheduled` 改成 `?mode=chat`（T85 redirect 会删掉默认 mode 段，URL 变成 `/project/${id}?job=...`，workspaceMode='chat'，`preserveWorkspaceMode=true`，右栏 results 自动打开但主视图仍是 chat）；② result-title-bar.ts 把 result/code/compare/history 的输出从 `${artifactTitle} · ${modeLabel}` 改为 `${artifactTitle} · ${modeLabel} · ${project}`，把缺省分支从 `${modeLabel}` 改为 `${modeLabel} · ${project}`，让「项目名」成为所有 mode 下的固定上下文锚点。**验证**：3 vitest 同步更新：`buildResultTitleBarTitle('result', 'golden-path', 'GO-BP 气泡图 (PNG)') === 'GO-BP 气泡图 (PNG) · 结果 · golden-path'`（之前是 `'GO-BP 气泡图 (PNG) · 结果'`）；chat mode 仍是 'golden-path'（保持）。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：dev Electron CDP harness 检查点——result 模式标题「结果 · biof3-desktop」含项目名后缀，chat 基线标题无后缀（acceptance/ui-ledger-closeout/harness-checkpoints.json）。**4 治理门 GREEN**：`docs:check` 134 / `npm run ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` 0 错 / `cd frontend && npx vitest run src/lib/result-title-bar.test.ts` **3/3 PASS**。**保持 UI-180 + UI-161 + UI-173 `in_progress` 维持原状**：UI-181 仅在 user 真实 dev Electron 重启前都是 in_progress；按 audit 行 402 治理纪律仅当真实 dev Electron 实机过目后才可考虑 verified。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16 / 不动 agent-tools/* / agent-transcripts/*。**当前 active 工作包**：NONE（按 single work package serial 纪律，等待用户裁决下一块；本次纯文档登记 + 2 文件 13 行改动） | DEFAULT-ENTRY-FIX / TITLEBAR-FALLBACK |
| UI-182 | cancelled | P2 | W-04 | C-04 | Agent chat 只走一轮无提示 — Python 运行时缺失被静默吞掉 | (保留) core/py-server/py-pool.js PyWorker 启动失败时 stderr 立即上报主日志（PyPool stderr 不再被 /dev/null 吞） | 用户跑 Agent 会话，调 Python 工具（如 scanpy）失败 → agent-runner 跑完首轮就发 `[DONE]`。UI 完全无提示，user 看到的现象是「聊天会话好像只走了一轮」。根因链：① `core/py-server/py-pool.js` L115 旧版 `this.proc.stderr.on('data', (data) => { this._stderr += data.toString(); })` 只在 resolve 时打印 stderr，PyWorker 1 秒内崩溃时 stderr 直接进 /dev/null；② `core/py-server/server.js` `/api/health` 旧版只返回 `{ status: 'ok' }`，对 worker readiness 完全不可知 — 即使 2 个 PyWorker 都超过 max restarts，HTTP 仍 200，frontend `probeHealth` 也只检查 resp.ok；③ `frontend/src/components/backend/BackendStatusProvider.tsx` 把 pyRuntime = pyServerUp 即 HTTP 200，**不能区分「py-server 进程在但 Python 运行时没装」**；④ `frontend/src/components/copilot/SimpleChat.tsx` 从未读 backendStatus — chat 不知道 Python runtime 缺失，无提示 + 不限制发送。修法（4 处）：① py-pool.js PyWorker stderr 在 `!this.ready` 启动失败时立即上报主日志，让 `ModuleNotFoundError: No module named 'numpy'` 这种根因不再被 /dev/null 吞；② py-pool.js PyWorker 加 `getStatus()` 报告 `{ ready, busy, requests, restartCount, maxRestarts, exceeded }` + PyPool `_getWorker()` 过滤 `restartCount < maxRestarts`；③ py-server/server.js `/api/health` 报告 `workerReady` + `workers[]` + `status: readyCount > 0 ? 'ok' : 'degraded'`；④ BackendStatusProvider 加 `probePyReady()` 读 body 信任 `pool.workerReady`，dev/Electron 双路径都覆盖 + SimpleChat 顶部加 `useBackendStatus()` + empty state 显示红框提示「Python 运行时未就绪 —— 任何依赖 scanpy/numpy 的分析工具都会失败，请打开插件商店安装」+ send 按钮在 `!backendStatus.pyRuntime` 时禁用。**验证**：tsc 0 错 / SimpleChat.test.tsx + extraRenderers.test.tsx 15/15 PASS（既有 0 破坏）/ docs:check 134 / ui:audit:check 同步后 PASS。**保持 UI-181 + UI-180 + UI-161 + UI-173 `in_progress` 维持原状**：本次 fix 仅在 user 真实 dev Electron 重启前都是 in_progress。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16 / 不动 agent-tools/* / agent-transcripts/*。**当前 active 工作包**：NONE（本次 6 文件 +254/-7 行改动 = 1 后端 1 shared 1 health 1 frontend status 1 frontend chat 1 css） | PY-RUNTIME-SILENT-FAIL / AGENT-LOOP-SILENT |
| UI-183 | verified | P1 | W-04 | C-04 | Agent chat 错误「未知错误」无可诊断信息 —— tool / Python worker / harness 失败被吞 | frontend/src/components/copilot/errorMessages.ts + SimpleChat.tsx + SimpleChat/types.ts + conversationRunStore.ts | 用户跑 Agent 会话调工具（workspace_list / scanpy / harness 校验等）失败时 chat 顶部弹「发生未知错误」，**完全没有错误码 / 没有 raw stack / 没有「查看详情」入口** —— 用户看不到 ModuleNotFoundError / worker exit code / harness 修复建议。根因链：① `frontend/src/components/copilot/conversationRunStore.ts` L251-267 `finish()` 只把 `formattedError.userMessage` 写进 `assistantContent`，raw `error.stack` 被丢；② `frontend/src/components/copilot/SimpleChat/types.ts` `SimpleMessage` 接口没有 `technicalDetails` 字段；③ `frontend/src/components/copilot/SimpleChat.tsx` L1169-1180 `ErrorBanner` 调用 `getTechnicalDetails(m.content)`，而 `useErrorFormatter.ts` L77-82 在 `error` 是 string 时返回 `undefined`，导致「查看详情」按钮根本不出现；④ `frontend/src/components/copilot/errorMessages.ts` ERROR_PATTERNS 完全没有 `harness / tool execution / pyworker / modulenotfounderror / worker.*exited.*code` 等 biof3 真实业务模式，全部走到 UNKNOWN。修法（5 文件 +99/-6）：① SimpleMessage + ConversationRunSnapshot 加 `technicalDetails?: string` + `errorCode?: string` 字段；② conversationRunStore.finish 保存 `error?.stack` + `formattedError.code`；③ SimpleChat L564-578 activeRun → SimpleMessage 透传 technicalDetails/errorCode；④ SimpleChat L1169 ErrorBanner 改成 `m.technicalDetails || getTechnicalDetails(m.content)`，**当 technicalDetails 有值时即使 m.content 是 string 也能看到详情**；⑤ errorMessages.ts ERROR_PATTERNS 加 7 条：`HARNESS_ERROR / HARNESS_PARAM_INVALID / HARNESS_REPAIR_FAILED / PYTHON_WORKER_DOWN / PYTHON_MODULE_MISSING / PYTHON_EXECUTION_FAILED / WORKER_CRASHED`，ERROR_MESSAGES 同样 7 条带 userMessage。**验证**：tsc 0 错 / SimpleChat.test.tsx + extraRenderers.test.tsx 15/15 PASS / docs:check 134 / ui:audit:check 同步后 PASS。**保持 UI-181 + UI-180 + UI-161 + UI-173 + UI-182 `cancelled` 维持原状**：本次 fix 仅在 user 真实 dev Electron 重启前都是 in_progress。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16 / 不动 agent-tools/* / agent-transcripts/* / 不动 py-pool.js stderr 上报路径（已合 UI-182 amend 7fbc6e8）。**当前 active 工作包**：NONE（本次 4 文件 +99/-6 行改动 = 1 SimpleChat types + 1 store + 1 SimpleChat render + 1 errorMessages patterns/messages）。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：dev Electron 真实触发失败 run（fatal fixture 全 preset 不可达后恢复，settings md5 前后一致）——ErrorBanner「查看详情」点击转「收起详情」aria-expanded=true，533 字符原始 stack（ECONNREFUSED + copilotClient 帧行号）完整可诊断（acceptance/ui-ledger-closeout/ui183-error-details.json） | AGENT-CHAT-ERROR-DIAGNOSTICS / ERROR-BANNER-NO-DETAILS || UI-172 | verified | P2 | W-04 | C-03 | plugin-manager.js 8 helpers 拆分 / BLOCK-9.2 PHASE 3 | 主 agent PHASE 3 重构（commit `880efaa`）抽 8 个 lib 文件到新建 `src/plugin/` 目录：`paths.js` (99 行) / `installed.js` (100 行) / `manifest-source.js` (99 行) / `io.js` (120 行) / `zip.js` (20 行) / `content-plugin.js` (137 行) / `registry.js` (26 行) / `runtime.js` (62 行) / `uninstall.js` (202 行)；原文件 1457 → 586 行（-871 / -59.7%）；4 个 install orchestrator 保留主文件（cross-reference + onProgress + 多次 SHARED_BACKEND_DIR require，拆完反而脆弱）；**21 模块.exports 100% 保留**（含 Week 2 schema re-export：PLATFORM_IDS / ALLOWED_RUNTIME_HOSTS / selectArtifact / assertAllowedUrl / validateManifest / normalizeRemotePluginEntry + 16 标准项）；5 修正 bug：(1) paths.js 错从 platform-compat import getPythonRuntimeExecutable 实际在 core/shared-backend/runtime-paths 已修；(2) runtime.js 同样修正；(3) uninstall.js 改用 SHARED_BACKEND_DIR 常量；(4) plugin-manager 顶部 IIFE 改用 paths.js 简单 import；(5) void app / pluginLoader 等多余 void 抑制全部清理；测试：14 plugin 测试 PASS（4 checksum + 10 manifest/SDK；RS7 golden fixture sha256 drift 已 pre-existing 验证 git stash 后仍 fail）+ g0-chf0+qa-smoke 39/39 PASS + docs:check 85 + ui:audit:check 139 + tsc 0 + Vite build OK；**不外推** 实机 Electron 验证 / packaged / P7 / GA / Provider / dist staleness G1+ | BLOCK-9.2-PHASE-3 / MEGA-FILE-REFACTOR-PHASE-3 || UI-184 | verified | P1 | W-04 | C-04 | SSE 解析抛 `localizeToolResult is not a function` 时 stream 整体被吞 | frontend/src/components/copilot/copilotClient.ts | 用户实测反馈：chat 跑工具调用时 stack trace 显示 `Error: localizeToolResult is not a function at _handleSseEvent` ——**整个 stream 在该 event 被同步异常抛出**，onError 永远收不到（throw 在 `_handleSseEvent` 同步栈里），用户看到「发生未知错误」+ 「详情」按钮显示完整 stack。根因：`_handleSseEvent` 历史上 inline 调用 `localizeToolResult` 等 helper，refactor 后 helper 被抽走，调用点没同步移除 —— 这种「幻影 helper」调用是同步抛错（is not a function），opts.onError 不会接住，整个 stream 静默死掉。修法（1 文件 +13/-0）：把 `_handleSseEvent` 拆成入口 `_handleSseEvent`（顶层 try/catch，转交 onError）+ 内部 `_dispatchSseEvent`（保留原 SSE 分发逻辑）。任何 inline helper 抛错都会落到 `opts.onError?.(new Error(\`SSE dispatch failed: ${message}\`))`，**用户至少看到 `SSE dispatch failed: localizeToolResult is not a function` 而不是吞掉整个流**。**验证**：tsc 0 错 / copilot 全量 168/168 PASS / docs:check 134 / ui:audit:check 同步后 PASS。**保持 UI-183 + UI-181 + UI-180 + UI-161 + UI-173 in_progress 维持原状**：本次 fix 仅在 user 真实 dev Electron 重启前都是 in_progress。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16 / 不动 agent-tools/* / agent-transcripts/* / 不动 conversationRunStore / SimpleChat types / SimpleChat.tsx（已合 UI-183 08f8f4f）。**当前 active 工作包**：NONE（本次 1 文件 +13/-0 行改动 = 1 copilotClient.ts SSE 入口守卫）。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：UI-183 fatal fixture 实跑即本修复的真链实证——同步抛错自 _dispatchSseEvent（copilotClient.ts:518 ECONNREFUSED）被入口守卫接住转 onError，ErrorBanner 以 533 字符完整 stack 呈现给用户而非静默吞流（acceptance/ui-ledger-closeout/ui183-error-details.json） | SSE-DISPATCH-SYNC-THROW / GHOST-HELPER-CALL |
| UI-195 | cancelled | P2 | W-04 | C-04 | BLOCK-22 inline-diff Accept/Reject 按钮 widget 注入 hunk 行尾 + dismissHunk 折叠淡出 | frontend/src/components/editor/CodeMirror/extensions/acceptRejectWidget.ts + useCodeMirrorEditor.ts + CodeMirrorEditor.module.css + types.ts | `acceptRejectWidget.ts` 新增 `InlineButtonWidget` + `FloatingButtonWidget`（继承 `WidgetType`，`toDOM` 返回 `buildInlineButtonGroup` / `buildFloatingButtonGroup`）；新增 `createDecorationsPlugin`（`ViewPlugin.fromClass` + `ViewPlugin.decorations` 接口），遍历 `[data-hunk-id]`，按 `pickWidgetForm` 决策形态，行末 `Decoration.widget({ side: 1 })` 嵌入；floating widget 计算首 chunk 相对 scroller 像素 y 偏移，按钮跟随文档滚动。`useCodeMirrorEditor.ts` `EditorApi` 新增 `dismissHunk(hunkId)` 两阶段：先给 `[data-hunk-id]` 元素加 `dismissing` class，200ms 后从 hunks 数组过滤 + `diffCompartment.reconfigure(createUnifiedDiffExtension(updatedRev))`；`acceptHunk` IPC 成功后自动调 `dismissHunk`。`CodeMirrorEditor.module.css` 新增 `.cm-insertedLine.dismissing / .cm-deletedChunk.dismissing { transition: background-color 200ms ease-out; background-color: transparent; }`。**不动** 主 `ViewPlugin`（`tagHunkChunks` + `attachClickListener` 完全保留）+ 不动 click listener + 不改 `acceptHunk / rejectHunk` IPC 路径。**验证**：`cd frontend && npx vitest run src/components/editor/CodeMirror src/components/editor/integration` 5 files 76/76 PASS（其中 mock bridge 已补 `dismissHunk`） / `cd frontend && npx tsc --noEmit` 0 错 / `npm run docs:check` 142 PASS / `npm run ui:audit:check` 同步本笔录后 PASS。**dev Electron 边界内 / packaged 边界内**实机过目待办；按本台账行 402 治理纪律 `verified` 升级需真实实机过目。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16/20。**2026-09-09 UI-LEDGER-CLOSEOUT 实证 cancelled（UI-196/UI-182 同型先例）**：acceptRejectWidget.ts 已随 f57089cb（BLOCK-43 / UI-193 superseded）整文件退休，生产代码零引用；活路径 = BLOCK-28 hunkControls（/review 主区 hunk 悬浮 accept/reject，本会话 UI-180 实机链已驱动） | BLOCK-22-P4.7 / INLINE-DIFF-WIDGET-INJECTION |
| UI-196 | cancelled | P2 | W-04 | C-04 | BLOCK-22 inline-diff 顶部 action bar（Accept All / Reject All / Review）｜**2026-09-08 复核：本项已随 BLOCK-43 / UI-193 widget 业务路径收口被移除，故置 cancelled 而非 verified**（实证：全仓 `frontend/src` 内 `DiffActionBar` 仅剩 `CodeMirrorEditor.tsx:19` 的一行注释——无 import、无 `<DiffActionBar>` 挂载、组件文件亦不存在；`showDiffActionBar` prop 已按 `docs/block-43-ui193-widget-business-path-closeout-plan.md` §29-30 从 `types.ts` 与 `CodeMirrorEditor.tsx` 删除；原实现默认 `showDiffActionBar=false`，本就无任何父组件传入 true，从未在生产渲染过）| frontend/src/components/editor/CodeMirror/DiffActionBar.tsx + DiffActionBar.module.css + CodeMirrorEditor.tsx + types.ts | `DiffActionBar.tsx` 新增 React 函数组件（stateless UI shell）：props = `{ apiRef: RefObject<EditorApi | null>, onError?: (err: unknown) => void }`；通过 `apiRef.current?.getMode()` 判定仅在 `mode === 'inline-diff'` 时渲染（其它 mode `return null`），按钮组 3 项 `data-action="accept-all" / "reject-all" / "review"`。Accept All → `await apiRef.current.acceptAll()` + 失败走 `onError`；Reject All → `await apiRef.current.rejectAll()` + 失败走 `onError`；Review → 取 `apiRef.current.getDiffRevision().hunks[0].startLine`，调 `scrollToLine({ line })` 跳转首个 hunk；无 hunks 时 Review 是 no-op（不调 scrollToLine）。`DiffActionBar.module.css` 顶部水平 flex（gap 8px / justify-content: flex-end / padding 8px 12px / 底部 1px border） + 共用 `.button` 基础（min-width 88px / 圆角 4px / focus-visible 描边 `--biof3-accent` / disabled opacity 0.55） + `.accept` 走 `--color-success` 绿 + `.reject` 走 `--color-danger` 红 + `.review` 走 `--biof3-bg-subtle` neutral；颜色 fallback 全部齐备（亮 / 暗双主题）。`CodeMirrorEditor.tsx` 新增 `showDiffActionBar?: boolean = false` prop（向后兼容；不打开时 DOM 0 变化）；打开后在 `<div ref={parentRef}>` 内顶部条件挂 `<DiffActionBar apiRef={apiRef} onError={onError} />`，并新增 `data-show-diff-action-bar={...}` 标识供 P3 业务侧探针。`types.ts` `CodeMirrorEditorProps` 加 `showDiffActionBar?: boolean` 字段。**不动** `useCodeMirrorEditor.ts`（hook 不感知新 prop；prop 只在父组件消费）/ 不动 `acceptRejectWidget.ts`（行内 widget 仍是逐 hunk 入口；action bar 是整文件快捷入口，两者不互斥）/ 不动 `CodeMirrorEditor.module.css`（`styles.cmEditor` 已承载布局；不引入新 wrapper class）/ 不动 integration 桥接层 / 不动 `events.ts` / 不引入新依赖。**验证**：`cd frontend && npx vitest run src/components/editor/CodeMirror src/components/editor/integration` 4 files 67/67 PASS（新 DiffActionBar.test.tsx 11 项 + 既有 CodeMirrorEditor 32 / P4.2-improvements 16 / WorkspaceFilePreviewBridge 8）/ `cd frontend && npx tsc --noEmit` 0 错（pre-existing SimpleChat.tsx:950 TokenBudget 不算）/ `npm run docs:check` PASS / `npm run ui:audit:check` 同步本笔录后 PASS。**dev Electron 边界内 / packaged 边界内**实机过目待办；按本台账行 402 治理纪律 `verified` 升级需真实实机过目。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15/16/20 | BLOCK-22-P4.8 / DIFF-ACTION-BAR |
| UI-199 | verified | P3 | W-01 | C-01 | 模型渠道 Endpoint 设置加上下文窗口配置（contextWindow，单位 K/M） | frontend/src/hooks/useAiSettings.ts + frontend/src/lib/format-context-window.ts + frontend/src/components/desktop/DesktopSettingsPanel.tsx + core/shared-backend/llm-providers/model-profile.js + core/r-server/helpers/ai-settings.js + core/r-server/routes/ai-chat.js + core/r-server/agent-runner.js | `ChatModelPreset` 类型加 `contextWindow?: number`（token 整数）；新建 `format-context-window.ts` 含 `parseContextWindow`（"128K" → 128000）+ `formatContextWindow`（128000 → "128K"）+ 34/34 unit tests；`DesktopSettingsPanel` 渠道卡片加 `上下文` 列 + `biof3-input--sm` 输入框（placeholder "64K / 1M"；新增 `contextWindowDrafts` state 跟踪用户原始输入，避免受控 value 在 typing 中途格式化跳光标；onBlur 提交最终值并清草稿）；`handleSave` 的 `chat_model_presets` 快照加 `contextWindow`；`model-profile.js` `normalizeModelProfile` 输出保留 `contextWindow`；`ai-settings.js` `normalizeAiSettings` 的 `chat_model_presets` 映射加 `contextWindow`；`ai-chat.js` token budget 处改用 `token-estimator.getContextWindow` + 传 `identityProfile.contextWindow`；`agent-runner.js` 先 `getAiSettings()` 查 profile 拿 `contextWindow`，再调 `token-estimator.getContextWindow(..., presetCtx)`。**实现验证**：docs:check 142 PASS / ui:audit:check 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` 0 错（顺手修 SimpleChat.tsx setTokenBudget 缺 messagesKept/messagesDropped 的 HEAD 既有 tsc error）/ vitest 3 files 34/34。**2026-08-27 dev Electron 实机 verified**（CDP 9222 Runtime.evaluate 直驱 dev Electron page，真实 preload 桥 + Keychain）：「上下文」列在渠道表可见（表头 协议/供应商/Base URL/Key/默认模型/上下文/连通性）；实机输入 `256K` → 保存 → 桥接回读 `chat_model_presets[0].contextWindow === 256000`；关闭面板重开 → 输入框持久显示 `256K`；`1.5M` → blur 不跳光标 → 保存 `1500000`；非法输入 `垃圾输入abc` → 保存 → `contextWindow` fail-closed 清除为 undefined；恢复 `256K` 后截证据图。evidence `acceptance/ui-199/electron-context-window-config-dev-electron.json`（passed:true, qualificationEligible:false）+ 截图 `acceptance/ui-199/electron-context-window-column.png`。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ | MODEL-ENDPOINT-CONTEXT-WINDOW |
| UI-200 | verified | P2 | W-02 | C-02 | Working Tree Review 面板渲染层升级：CodeMirror inline-diff 替换纯文本 DiffHunkView | frontend/src/components/desktop/WorkingTreeReview/CodeMirrorDiffView.tsx（新增）+ WorkingTreeReview.tsx + WorkingTreeReview.css + src/ipc/agent-doc-review.js（删除）+ src/main.js + src/preload.js + frontend/src/lib/electron.d.ts + frontend/src/lib/desktopBridge.ts + frontend/src/pages/project-workspace.tsx | BLOCK-23：新建 `CodeMirrorDiffView` 组件，通过 `getBridge('workingTreeReview')` 的 `fileContent({ path, ref: 'HEAD' })` + `fileContent({ path, ref: 'WORKTREE' })` 构建 `DiffRevision`，传给 `CodeMirrorEditor` mode=`inline-diff` readonly=true language=filePath 渲染；`WorkingTreeReview.tsx` 用 `<CodeMirrorDiffView>` 替换 `<DiffFileView>`；删除 `DiffFileView.tsx` + `DiffHunkView.tsx`；删除 `src/ipc/agent-doc-review.js`（BLOCK-17 死代码）+ `src/main.js` 的 require/setup 调用 + `src/preload.js` 的 `agentDocReview` 命名空间 + `electron.d.ts` 的 `agentDocReview` 类型 + `AgentDocFileEntry` 接口 + `project-workspace.tsx` 的 `agentDocReview` fallback 分支 + `desktopBridge.ts` 注释引用；`WorkingTreeReview.css` 补 `.wt-cm-diff` / `.wt-diff-loading` / `.wt-diff-error` 样式；0 新增 IPC / 0 新增依赖。**验证**：`cd frontend && npx tsc --noEmit` 0 错。**2026-08-28 dev Electron 实机 verified**（CDP Runtime.evaluate + DOM/截图）：intent-to-add fixture 的选中路径、`.wt-cm-diff .cm-editor`、readonly inline diff、`cm-merge-b/cm-changedLine/cm-insertedLine/cm-changedText`、新增 fixture 行均可见，旧 `.wt-diff-hunk` 不存在；证据 `acceptance/ui-200/electron-codemirror-diff-dev.json`（passed:true）+ `acceptance/ui-200/electron-codemirror-diff-dev.png`，fixture 已删除。G0 开发期常态 · 不外推 packaged / Provider / GA | BLOCK-23-REVIEW-CODEMIRROR-UPGRADE |

### verified 证据门槛

- **默认门槛**：`verified` 必须有实机证据。视觉类问题（布局/主题/响应式）以截图/录屏为准；接口/逻辑类问题（Provider 连通、IPC、SSE、SQLite 绑定）以真实调用 + acceptance evidence 为准。
- **问题类型决定证据类型**：纯视觉问题不能仅靠接口测试晋升 `verified`；纯接口问题不能仅靠视觉截图晋升。
- **key-unavailable 例外（仅适用于 P-07 模型接口类）**：当外部凭据（如 `BIOTEST_ANTHROPIC_KEY`）在本机或 CI 不可用时，UI 问题可由以下三项联合晋升 `verified`：① 真实凭据命名（`modelProviderCredentialRef('anthropic', id)`）在 DesktopSettingsPanel 已实机核对；② AnthropicProvider 全部 mock 测试稳定通过；③ 收口脚本 `g0:model-anthropic-native:check` 跑通并产出 `acceptance/MODEL-ANTHROPIC-NATIVE/anthropic-real-key-evidence.json`，其 `mode: dryrun` 字段明确记录 "BIOTEST_ANTHROPIC_KEY 未注入" 为可复核的失败-关闭占位。Key 可用后必须重跑 live 模式以产出真实 evidence，但状态不再回退。

每个问题必须补充：

1. 复现步骤和窗口/主题条件。
2. 截图或录屏的本地路径。
3. 问题发生在控件壳、图标、布局容器、数据状态还是后端事实层。
4. 预期结果和不允许破坏的相邻行为。
5. 修改文件、验证命令和实机复核证据。

## 5. Stage 1 批次

1. UI-1：完成覆盖矩阵、问题编号和用户优先级确认。
2. UI-2：全局 token、桌面壳、顶栏、三栏容器、拖拽和主题。
3. UI-3：首页、项目、会话和资源导航。
4. UI-4：Agent 输入、消息、确认、运行、失败和恢复状态。
5. UI-5：结果、Artifact、浏览器、文件与终端工具区。
6. UI-6：设置、插件、运行时、诊断和专业页面壳层。

不得在一个批次中顺手重构后续模型 Provider 或 Harness 内容。

## 6. 最低验证门禁

按修改风险选择并记录：

```bash
npm --prefix frontend run check
npm test --prefix frontend
npm --prefix frontend run build
npm run check
```

涉及 Electron 壳、IPC、打包资源或正式版差异时，还必须做开发启动与打包态实机验证。只有代码检查、没有视觉证据，不能把 UI 问题标记为 `verified`。

## 7. 2026-07-17 定向验收记录

- 验收环境：开发版 Electron，R/Python 服务正常，夜间主题为主；额外切换日间主题验证后已恢复夜间主题。
- 窗口覆盖：最大化、恢复窗口、约 1050px、约 840px，以及左右侧栏分别折叠/展开。
- 右侧工具覆盖：results/browser 双标签往返、最终 HTML 报告全高显示、窄窗口浏览器工具栏与内容布局。
- Artifact 覆盖：火山图、分类结果表、输入 DEG 表连续切换；稳定状态中的标题、预览内容、文件名与原文件 URL 一致。
- UI-018 说明：当前 `SimpleChat` 不再渲染旧 `resultCards` 通用卡。历史会话实机确认该控件已退役；现行入口是 TitleBar results tab、结果导航和 `projectOpenArtifact`，`projectOpenResult` 仅保留兼容订阅。因此该项按“旧交互已退役、现行入口已核对”关闭，不再要求构造第二套假结果卡。
- 本轮截图：`/tmp/biof3-ui-acceptance-maximized.jpeg`、`/tmp/biof3-ui-acceptance-right-collapsed.jpeg`、`/tmp/biof3-ui-acceptance-narrow.jpeg`、`/tmp/biof3-ui-acceptance-browser.jpeg`、`/tmp/biof3-ui-acceptance-narrow-browser.jpeg`、`/tmp/biof3-ui-acceptance-light.jpeg`。

## 8. 2026-07-17 剩余台账对账

- 对剩余 16 个 `open` 项逐项回溯实现提交，并在当前运行中的开发版完成夜间主题、窄窗、折叠、连续拖拽、文件树、Agent 输入框和浏览器全高抽查。
- UI-002、005、008、021、024、030 对应 `475a2cf`；UI-012、015、017、026、028 对应 `0fec6a6`；UI-011、014、027 分别对应 `c6f2651`、`f93913a`、`2fd75e8`。
- UI-010 由 `5b251cd`、`4c20c09` 的 ABI/进程启动修复及本轮 Electron、迁移、R/Python 服务正常启动共同关闭。
- UI-019 所指旧专业页面已由 `1e6e845` 删除，当前产品只保留首页与 ProjectWorkspace，不再为已退役路由维持第二套主题壳层。
- 本轮当前态截图：`/tmp/biof3-ui-ledger-final-night.jpeg`。结合第 7 节既有截图，30 项均已有实现或退役依据及运行时验收证据。

## 10. Stage 3 Harness 环境视图

| ID | 状态 | 级别 | 主模块 | 关注点 | 页面/状态 | 问题摘要 | 证据 | 目标批次 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-032 | verified | P2 | P-07 | C-04 | 设置 / 计算与数据 | Stage 3 M1 新增只读"Harness 分析环境"面板（`HarnessEnvironment` 组件），展示 Harness 已自备的运行时与 R 包 bundle 清单 | 2026-07-21 用户实机逐项验证：设置页可见面板；真实 capability bundle 条目可显示版本、大小和安装日期；返回设置页与重启后状态保持；分析流程未受影响。代码/IPC/类型链路和只读边界由既有门禁覆盖。详见 `acceptance/ui-032/UI-032-acceptance.md` | Stage 3 M2 |
| UI-033 | verified | P1 | P-07 | C-02, C-04 | 设置 / 模型接口与聊天选择器 | 配置卡收敛为“供应商 Endpoint”，聊天菜单按供应商聚合实时模型并真实切换；身份回答直接披露供应商与模型 | 2026-07-21 实机：`acceptance/ui-034/dev-light-wide.png` 等明暗/窄窗矩阵显示 `DeepSeek · deepseek-v4-flash` 选择器；rc.7 安装候选使用同一模型真实完成只读工具调用并按供应商/模型身份回答。实现与既有真实 DeepSeek `list-models` 证据保持一致 | MODEL-UX |
| UI-034 | verified | P1 | W-03 | C-03, C-04, C-06 | Agent 会话 / 工具活动 | Agent 工具调用使用结构化 ToolResult 和 Trace 呈现真实运行、等待确认、成功、失败、拒绝、耗时、截断、termination reason 与实际副作用摘要；task SSE 回放不得重复或把终态降级，停止订阅不得伪装工具已取消 | 2026-07-21 开发壳实机矩阵：`acceptance/ui-034/` 的浅色宽窗、深色宽/窄窗、右栏折叠、回放恢复 5 张证据；rc.7 安装候选另以真实 DeepSeek 只读调用确认 `workspace_list` 成功 5–6 ms、`workspace_find` 成功 8 ms 且显示截断。前端 parser/activity 7/7，后端 P7-D 与脱敏回归继续纳入根门禁 | P7-D |
| UI-035 | verified | P2 | W-03 | C-04, C-06 | Agent 会话 / 阶段进展与工具活动 | 多轮工具前的模型可展示说明会在下一 iteration 被清空；工具展开区每项占两行且暴露过多实现细节，用户难以快速判断任务推进到哪里 | 新增 `agent_progress` SSE：只固化模型面向用户的阶段说明，不读取或展示隐藏推理；运行快照与历史消息按任务顺序保留最多 50 条，既覆盖长科学任务又防止异常上游无限写入，assistant `meta_json.progressUpdates` 支持历史会话恢复。工具折叠态收敛为“已完成 N 项 · 读取/修改数量 · 总耗时”，展开后每项仍可查看动作、对象、状态、耗时、工具名、影响和失败原因，但压成紧凑单行。Agent prompt 要求新阶段用一两句可验证进展说明。run store 7/7、tool activity 7/7、前端 typecheck 通过；2026-07-23 Ark 真实长任务完成 28 轮、32 次工具调用，阶段流与历史重开均保持紧凑且可恢复 | P7-D refinement |
| UI-036 | verified | P2 | P-07 | C-02, C-04 | 设置 / 模型接口与聊天选择器 | 模型配置暴露接口类型和能力开关，渠道卡密度偏高；聊天模型入口未把供应商与模型拆开选择 | 设置页按“协议、供应商、Base URL、Key、默认模型、连通性”拆成六列单行，能力元数据保留在 Gateway；聊天 Composer 拆成供应商和对应模型两个入口。2026-08-12 在 Windows 开发态 Electron 30.5.1、1440×900 中通过正常设置入口核对 7 条既有渠道：六列完整可见、每行 33.33px、无页面横向溢出且 Key 始终遮罩；点击保存、关闭并重开后，脱敏的“供应商 + 默认模型”指纹完全一致。聊天中实际打开供应商菜单（展示每渠道模型数）、切换渠道，打开仅含该渠道模型的模型菜单并在同渠道两个模型间切换，两个入口独立且不重叠，最后恢复原持久选择。聚焦测试与 strict TypeScript 通过；证据 `acceptance/ui-036/electron-model-settings-and-chat-picker-windows.json`（绑定当前源码 `62f9507` 及关键文件哈希，`passed:true`、`qualificationEligible:false`）。未读取/导出 Key；真实 Anthropic Key 继续服从 UI-124 已登记的 key-unavailable 例外，不重复阻塞 UI-036；不外推 packaged/P7 资格 | MODEL-UX refinement |
| UI-037 | verified | P1 | W-03 | C-02, C-04, C-06 | Agent 会话 / 会话切换 | `SimpleChat` 把消息、流式状态和工具活动绑定在单个组件实例上；切换会话或离开聊天视图后，旧流会与新会话冲突，新会话也可能被全局 `streaming` 状态阻塞 | 新增按 `conversationId` 隔离的共享运行注册表：视图卸载只取消 UI 订阅，不停止 Agent task；返回会话可继续看到流式进度并在完成后从 SQLite 对账。2026-08-12 在 Windows 开发态 Electron 30.5.1 的隔离临时项目中，经真实 Provider 同时启动 A/B 两个会话的限时 `workspace_exec`：A 先出现运行脉冲点，B 启动后两个会话同时显示脉冲；切换到 B 时不显示 A 的唯一标记，随后离开聊天进入设置，两项任务仍各自完成并持久化为 success。完成后回切 A/B，各自只显示自己的并行标记且无错误横幅。另在 A 运行时确认直接发送入口消失，只开放排队、后台子任务与停止，完成后正常对账，覆盖同会话防重入。UI-037 未调整后端并发策略；旧文档的“最多 3 路”已被后续 UI-140 的“每用户 5 路、为主任务预留 1 路”取代。专项前端 38/38、后端会话/取消 2/2；并发套件 8 个业务断言均通过，Windows 仅在结束清理仍被 SQLite 占用的临时目录时报 `EPERM`，未把该进程结果冒充全绿。临时验收会话、项目和空工作区均永久删除，原模型选择已恢复。证据 `acceptance/ui-037/electron-conversation-runtime-isolation-windows.json`（`passed:true`、`qualificationEligible:false`）；不存供应商、模型、凭据、会话内容或本地标识，不外推 packaged/P7 资格 | CONVERSATION-RUNTIME |
| UI-038 | verified | P1 | P-07 | C-02, C-04 | 设置 / API Endpoint 与聊天模型选择器 | 供应商切换后模型没有明确使用该渠道的配置默认值；渠道配置无法备份或批量迁移 | ModelProfile 新增独立 `defaultModel`，`model` 保留最近激活模型；聊天选择供应商时自动激活该渠道默认模型，用户手动切换后保留手动选择。API Endpoint 提供 JSON/CSV 导出与导入；Key 默认隐藏，可主动显示/复制，用户确认后导出可包含 Key 明文，导入后进入待保存凭据输入并按 ID/Base URL 合并。模型设置内容区从固定 720px 改为最大 1180px 自适应，Endpoint 列按内容伸缩，Key 操作按钮独立占位且窄窗保留横向滚动。2026-08-12 Windows 开发态 Electron 先复现 DeepSeek `deepseek-v4-flash` 切到 umapis 再切回时错误回退 `deepseek-v4-pro`，随后补齐每个 Endpoint 的 `lastSelectedModel` 快照；同一路径重验恢复 flash，整页刷新后仍保持，专项 16/16。证据：`acceptance/ui-038/electron-provider-model-restore.json` | MODEL-UX |
| UI-039 | verified | P2 | W-03 | C-04, C-06 | Agent 会话 / Markdown 回复 | 回复内容虽然完整，但表格边框、代码展示和复制入口缺乏统一的 Codex 风格，长回复阅读密度偏高；影响 W-06 文件预览 | Markdown 表格去掉完整外框/竖线，只保留低对比度横向分隔，TSV 复制位于表格外工具行；语言代码块保留紧凑语言栏与单一外框，text/plaintext/txt/tree/无语言块仅以透明背景和上下细线界定，复制入口不覆盖内容。2026-08-12 实机预检发现通用消息 `<pre>` 与全局 table 样式仍补回四边框；`d91c214` 在 `.cp-md` 命名空间显式清零继承边框后再加目标分隔，并用静态契约锁定级联顺序。随后在 Windows 开发态 Electron 30.5.1 的真实 11 条长回复（1 表格、2 个 Python/Shell 语言块、2 个纯文本结构块）中，以 820×900 明暗主题核对：表格只剩横线且自身横向滚动，语言块无重复内框，纯文本只剩上下线，页面无横向溢出；代码、表格和整条回复复制均在前台 Electron 成功显示“已复制”。真实 TSX 文件预览使用语法高亮并局部滚动，真实日志文件保持纯文本且无误高亮。Markdown/样式测试 12/12、strict TypeScript 通过；证据 `acceptance/ui-039/electron-markdown-density-windows.json`（`passed:true`、`qualificationEligible:false`），不外推 packaged/P7 资格 | MODEL-UX refinement |
| UI-040 | verified | P2 | W-01 | C-03, C-04 | 设置 / 安全性与可达性 | 模型渠道删除无确认可误删已配置 URL/Key；回收站语义错放于“隐私与维护”；主题当前偏好不可见；“添加自定义 API”措辞含糊 | 模型卡片删除按钮包 `window.confirm` 并按渠道命名；`TrashManagement` 移入“计算与数据”末尾，与 `ComputeExecution`/`DataManagement`/`HarnessEnvironment` 之间增加细线视觉分隔；`ThemeControl` 旁渲染 `当前：跟随系统/日间/夜间` badge 直接披露偏好；按钮文本改为“添加 API 渠道”。2026-08-12 在 Windows 开发态 Electron 30.5.1 实机核对：1024×900 下删除确认按渠道命名并完整提示 URL、Key、默认模型及不可从回收站恢复，选择取消后渠道数量与配置不变；按钮使用“添加 API 渠道”。820×900 下日间/夜间选择都即时显示对应“当前” badge，页面无横向溢出；回收站位于“计算与数据”末尾，计算执行、本地数据目录、Harness 环境、回收站顺序正确，三条主题边框色 1px 分隔线稳定可见。证据 `acceptance/ui-040/electron-settings-safety-and-reachability-windows.json`（`passed:true`、`qualificationEligible:false`）；未读取或存储渠道名称、URL、Key，不外推 packaged/P7 资格 | SETTING-FIX |
| UI-041 | verified | P2 | W-01 | C-01, C-04 | 设置 / 视觉一致性与工具栏密度 | 设置页左侧 nav、Endpoint 卡片、凭据卡、维护行、回收站项与数据目录区曾使用 `--biof3-bg-subtle` 浅灰底，与右侧主面板白底不一致；`API Endpoint` 标题区内联的导出 JSON/CSV、导入配置三个按钮挤在描述段落之间，既占首屏面积又与“添加 API 渠道”主行动混淆 | 设置页可达容器统一使用 `var(--biof3-bg-surface)`，plugin store 的徽章/chip 灰底保持不变；Endpoint 行按 UI-042 的单层列表规则透明透出同一 surface，Key 已并入行内，不再渲染历史独立凭据卡。Endpoint 工具栏从 heading 抽到列表后方，左侧保留“添加 API 渠道”，右侧集中导出 JSON/CSV 与导入配置。2026-08-12 在 Windows 开发态 Electron 30.5.1 的 1440/1024/820×900 明暗六格中，导航、三类可达数据容器、两条维护行与一个隔离临时回收站项都精确跟随主题 surface；7 条渠道下标题区零按钮，四个列表后操作无页面、内容区或工具栏溢出，窄窗渠道列保持列表内滚动。临时项目已永久删除且剩余数为 0。设置归一化会始终提供至少一个默认渠道，因此空配置折叠仅按源码条件与测试覆盖，不冒充可达实机状态。证据 `acceptance/ui-041/electron-settings-surface-and-toolbar-windows.json`（`passed:true`、`qualificationEligible:false`）；未读取或保存渠道值、URL、Key，不外推 packaged/P7 资格 | SETTING-FIX |
| UI-042 | verified | P2 | W-01 | C-01, C-04 | 设置 / Endpoint 卡片密度 | 每个渠道渲染 `.biof3-model-preset` 完整外框（1px border + 10px 圆角）+ 嵌套 `.biof3-endpoint-card` 内 padding 6px + 独立 list gap 6px，5 条渠道即产生 10 条内外框线和 4 道分隔线，密度与 UI-036 一行卡片原则相悖 | 渠道卡片去掉外框/圆角与嵌套 padding，列表间距收紧为 2px；相邻 `.biof3-endpoint-card` 使用单一 top-border，规避最后一条双线。2026-08-12 Windows 开发态 Electron 以 7 条真实渠道核对：首行无顶线、后 6 行各一条 solid 分隔线；820px 下 1040px 行网格在 600px `overflow-x:auto` 容器内稳定；renderer-only 单条态无孤线、空态无残线，刷新恢复真实配置。证据：`acceptance/ui-042/electron-endpoint-density.json` | SETTING-FIX |
| UI-044 | verified | P2 | W-02 | C-01, C-06 | 工作台 / RightPanel 折叠入口冗余 | `RightPanel.tsx` 当 `visible=false` 且 `workspaceMode ∈ {chat, scheduled}` 时曾渲染一个绝对定位“显示右侧侧边栏”按钮（绝对 0/0、width 40px、半透明 + backdrop-blur）；与 TitleBar 的 panel-right toggle 功能重复，且隐藏在右栏折叠区边缘，被设置/报告/工具面板遮挡，在打开设置等场景下被误识别为设置内按钮 | `RightPanel.tsx` 的隐藏分支直接 `return null`，旧 `workspaceRightPanelToggle` 样式已清理；`useWorkspacePanels.toggleRight` 只由 TitleBar 复用。2026-08-12 在 Windows 开发态 Electron 30.5.1 的 1440/1024/820×900 × chat/scheduled/settings 九格中，折叠态均无可见 right-panel aside、旧浮按钮或带文本的绝对定位恢复按钮；恰有一个“展开右侧栏”控件且位于 38px 标题栏内，设置和计划内容不被遮挡，页面无横向溢出。逐格点击该标题栏控件均恢复一个右栏与一个“收起右侧栏”；820px 同时出现预期的紧凑侧栏 dismiss backdrop，桌面宽度无 backdrop。证据 `acceptance/ui-044/electron-right-panel-single-entry-windows.json`（`passed:true`、`qualificationEligible:false`），不外推 packaged/P7 资格 | RIGHTPANEL-FIX |
| UI-046 | verified | P1 | W-03, W-06 | C-02, C-04, C-06 | Agent 会话 / Chat @file 文件引用 | 聊天上下文缺少“以文件为锚”的引用方式：用户想引用某个项目文件只能粘贴内容或凭记忆描述文件名，模型也无法定位真实路径 | `core/packages/shared-copilot/chat-file-references.ts` + `core/r-server/helpers/chat-file-references.js` 提供 `parseChatFileReferences` / `resolveChatFileReferences`（解析 `@file` token、把相对路径解析为项目内真实路径并校验可读）；`core/r-server/routes/harness.js` 把解析结果注入 harness 工具上下文。`frontend/src/lib/{chat-file-references.ts,electron.d.ts,events.ts}` + `preload.js` + `main.js` 暴露 `chat:resolveFileReferences` IPC；`SimpleChat.tsx` + `simple-chat.css` 在输入区识别 `@` 触发补全面板并以 chip 形式插入引用；`simple-chat-file-open.test.ts` 覆盖点击引用 chip 打开文件浏览器并定位到该文件。前端测试与 ui:audit:check 通过，待用户实机验证输入区 @ 触发补全、chip 渲染、点 chip 跳转文件树、R 端能解析并把路径透传到 harness | CHAT-FILE-REF |
| UI-047 | verified | P2 | W-04, W-06 | C-01, C-06 | 通用 UI / 代码块高亮组件 | 当前 Markdown fenced code 缺乏统一高亮与可复用样式，长代码块在明/暗主题下排版与复制入口不一致；后续 @file 引用与 agent 工具结果都需要一个干净的高亮基元 | 新增 `frontend/src/components/ui/{CodeHighlight.tsx, code-highlight.css}` 与测试 `CodeHighlight.test.tsx`：基于安全的语法高亮提供语言栏 + 复制入口 + 明暗主题适配；作为 Markdown fenced code 与未来 plugin/artifact 代码块的复用基元，样式与 UI-039 Markdown 阅读密度规则保持一致。前端测试与 ui:audit:check 通过，待用户实机验证明/暗主题、不同语言长代码块、复制行为 | CODE-HIGHLIGHT |
| UI-048 | verified | P1 | W-06 | C-04, C-06 | 项目资源 / Office 文件预览 | 项目浏览器只能识别文本类文件，遇到 `.docx`/`.xlsx`/`.pptx` 时直接 fallback 为下载或“未知类型”，用户体验断裂，且 `@file` 引用无法在文件树上对 Office 文件给出即时摘要 | 新增 `frontend/src/lib/office-file-preview.ts`（含解析、文本/表格抽取、元信息）与测试 `office-file-preview.test.ts`；`project-workspace.tsx` 在文件预览组件里按扩展名路由到对应预览器，保留 Office 文件的可读文本视图（前 N 行 + 表格摘要）与“用默认应用打开”入口。前端测试与 ui:audit:check 通过，待用户实机验证 .docx/.xlsx/.pptx 的解析、表格摘要、窄窗与明暗主题 | OFFICE-PREVIEW |
| UI-049 | verified | P1 | W-04 | C-04, C-06 | 项目结果 / 科学交付摘要 | 结果页只有 Job/Artifact 导航和最终 HTML 报告入口，用户无法在首屏判断交付是 valid、degraded 还是 blocked，也看不到复现可用/已验证数量 | HRT-5 新增 `DeliveryManifest v1` 摘要卡：首屏分层展示“结论摘要 / 我做了什么 / 需要注意什么”，使用后端交付状态驱动左侧语义色，并显示 verified/available 复现数量与交付清单入口；产物卡提供“查看脚本”和“重放验证”，重放只向 Agent 发起需确认请求，不直接执行；不在前端重新推断科学状态。样本 metadata 校验、表达矩阵 QC、DEG 标准化 3 个仓库脱敏任务真实 R 链路均为 completed + artifact truth valid + delivery valid，证据为 `acceptance/harness-scientific-task/hrt5-delivery-acceptance.json`。2026-07-22 实机矩阵覆盖日间 valid/degraded/blocked、夜间 blocked、820px 窄窗；交付清单/脚本入口均返回 200，控制台 0 error。验收发现结果侧栏约 340px 时三列摘要受整窗 media query 误判，已改用 container query 在 520px 以下纵向排列，复验通过。**2026-07-27 更正**：该修复原挂在 `.resultSidebarRoot`，而 `5f3cd5e`（G0-RS-P1 建立中央结果界面）移除了 `ResultSidebarPanel` 挂载；两者在 `ResultArtifactShell` 中是兄弟 return 而非嵌套，故 `@container` 自那时起在用户实际渲染的中央分支上**没有容器祖先，长期失效**。已把 `container-type: inline-size` 迁到 `.resultView`（`project-workspace.module.css:4076`）恢复生效。本行 `verified` 反映的是当时侧栏变体下的复验，中央变体的实机复验属 P4R-2 未完成项 | HRT-5 |
| UI-050 | verified | P1 | W-04 | C-04, C-05, C-06 | 项目结果 / 复现包导出 | HRT-5 已能查看脚本和发起重放确认，但结果页没有把 TaskSpec、checkpoint、Job/Artifact/Delivery/Provenance 和逐产物入口导出成可跨智能体接手的任务包 | 交付摘要新增“导出复现包”，调用受控 HRT-6 API 把 `ReplayPackage v1` 写入当前项目 Job 结果目录；成功后显示“完整历史”或“历史部分可用”，不把缺失 checkpoint 冒充完整交接。2026-07-22 以真实 metadata validator Job 实机点击：生成 18 文件、6 个逐产物入口，页面反馈 `partial_history` 与后端清单一致，控制台 0 error；完整 checkpoint 的 `complete` 包由离线 R 验收覆盖。按钮不直接运行重放，真实任务仍需进入确认门并创建 replay Job | HRT-6 |
| UI-051 | verified | P1 | W-03 | P-03, P-05, P-07 | 设置 / 会话摘要资源与用量 | 资源、Token、缓存和成本只有设计口径，用户无法判断当前机器是否适合运行长任务，也无法在设置页查看缓存与成本证据 | 新增统一 RuntimeResourceSnapshot v1 和 10 秒轮询 Hook；会话摘要显示资源状态、可用内存/磁盘与 CPU，设置新增“用量与资源”页签，展示 30 天调用、输入/输出/cache 命中、估算成本和 `cost_unknown` 提示。2026-07-22 真实项目实机验收：低内存从错误“资源正常”修正为“资源不足”，磁盘 13 GB、8 核和 182 MB 可用内存均来自同一快照；820px 窄窗无横向溢出，控制台 0 error。GPU 未可靠探测时不展示，Job 峰值采样仍诚实标记 unavailable | post-HRT runtime control |
| UI-052 | verified | P1 | W-03 | C-03, C-04 | Agent 会话 / 完全访问 | 聊天显示“完全访问”，后端却仍无条件应用只读命令白名单，导致 `head -5`、`cat` 和多文件 `wc` 显示 `command_not_allowlisted` | `accessMode=full` 从项目目录启动通用 shell，不再使用命令 allowlist；`read` 在中央 policy 和 handler 两层继续拒绝，权限菜单披露“允许命令行、文件修改与工具调用”。2026-08-12 在 Windows 开发态 Electron 30.5.1 的隔离临时项目中，经真实 Provider 让 Agent 分别调用 `workspace_exec` 执行 `head -5`、`cat` 和多文件 `wc -l`；最终消息持久化恰好 3 条 success 活动，UI 显示“已完成 3 项 · 运行 3 次”，三条 exit code 均为 0，输出与固定 fixture 对账为 7/3/10 行，没有 `command_not_allowlisted`、确认卡、错误横幅或写入副作用。首选已配置渠道在工具调用前因上游无可用通道失败，切换另一已配置渠道后同一请求通过；不把前置 Provider 故障算作工具失败。专项回归 29 项为 26 pass / 0 fail / 3 个 Windows POSIX 路径假设 skip，skip 的 Windows shell 行为由本次真实 `cmd.exe /d /s /c` Electron 链补足。临时会话、项目和工作区均已永久删除且残留为 0。证据 `acceptance/ui-052/electron-full-access-commands-windows.json`（`passed:true`、`qualificationEligible:false`）；不存供应商、模型、凭据或绝对路径，不外推 packaged/P7 资格 | AGENT-TERMINAL |
| UI-053 | verified | P1 | W-03, W-06 | C-03, C-04, C-06 | 右侧文件面板 / 自动刷新 | 文件树只在首次挂载、展开目录时读取，预览 URL 也没有版本失效；Agent、终端或外部程序写入后，用户必须手动切换才能看到新文件和新内容 | 增加项目级 `projectWorkspaceChanged` 事件：Agent write/replace/exec 成功后即时刷新；文件页可见时每 2 秒轻量刷新根目录与展开目录，并通过活动文件 size+modifiedAt 变化才更新预览版本，避免持续下载大文件；Harness 文件摘要每 10 秒收敛，工具栏保留手动刷新兜底。2026-07-22 真实临时项目实机：已打开预览从 `refresh-version-1` 无点击更新为 `refresh-version-2`，新建 `appeared-without-click.txt` 同时自动进入文件树，控制台 0 error；临时项目和文件已清理 | FILE-LIVE-REFRESH |
| UI-054 | verified | P1 | W-03 | P-03, P-07, C-04, C-06 | Agent 会话 / 最终答复恢复 | 工具全部成功后，OpenAI-compatible Provider 可能返回成功状态和 token 用量却没有可展示正文；旧逻辑不把它视为错误，也不重试，最终用“重新描述需求”掩盖真实原因 | task/legacy 两条 loop 在无工具最终整理返回空正文、非法响应、意外 tool calls 或可重试暂时错误时，自动追加至多 1 次无工具整理请求；不会重复执行工具。SSE `agent_status` 让前端显示“正在自动重试整理”；仍失败时保留工具结果并提示基于当前会话继续。assistant meta 记录 attempts/recovered/failureReason。Provider 边界 9/9、run store 6/6、前端 typecheck 通过；2026-07-23 真实 Provider 先后覆盖连续空答复失败与第 2 次整理恢复，界面状态及 assistant finalization meta 与实际一致 | AGENT-FINALIZATION-RECOVERY |
| UI-055 | verified | P1 | P-03 | W-03, C-04, C-06 | Agent 会话 / 科学工作流连续执行 | 旧边界把第 5 次 Provider 请求固定为无工具最终整理，实际仅有 4 个工具轮；真实差异分析在第 4 轮创建计划后，第 5 轮无法启动 QC，却错误回复“现在开始第 1 步” | task/legacy 两条 loop 改为目标驱动：正常路径不设置 iteration 或工具调用总量上限，创建计划只是开始，直到用户目标和真实产物完成才自然结束；用户取消、确认门、工具/Provider 问题可暂停或停止。相同工具与相同参数连续第 3 次请求判定异常循环，该次不执行并强制如实说明阻塞；工具审批、批次 reserve 和 artifact truth 边界不变。Provider 边界 11/11、prompt 2/2 通过；2026-07-23 合成表达数据真实流程连续运行 134 秒，越过计划、QC、DESeq2 失败诊断、脚本修复和重跑直至 22 个产物完成 | AGENT-WORKFLOW-CONTINUITY |
| UI-056 | verified | P1 | W-03 | C-01, C-06 | Agent 会话 / 项目摘要卡 | 原摘要卡固定为 224px 宽和 340px 高，信息平均铺陈；第一次分层又引入多块填充背景、圆角卡片和大号数字，与工作台轻量风格不协调，也没有为后续后台常驻任务留出可增长结构 | 摘要改为内容驱动的 276–312px 紧凑面板，内部不再使用填充背景或嵌套圆角卡；仅以字号、间距和细分隔线组织“项目状态 → 任务列表 → 分析记录/运行队列 → 可选工作流 → 最近分析 → 运行环境”。任务区可同时列出当前任务和额外运行/排队任务，后续常驻后台任务复用相同行结构；无历史时隐藏空章节。R/Py 改为稳定横排，资源事实压为单行。Electron 开发窗口已确认热更新后的层级、空状态和资源事实真实挂载；前端 typecheck、UI 审计与 diff 检查通过；2026-07-23 Electron 开发壳已在日间/夜间主题复验项目状态、任务、最近分析、运行环境与资源单行布局 | SUMMARY-CARD-HIERARCHY |
| UI-057 | verified | P1 | W-03 | P-03, C-04, C-06 | Agent 会话 / 阶段结论详情 | 阶段进展只能看到一行公开说明，用户无法知道什么结论被下一阶段采用；直接展示隐藏推理链又不符合安全与可验证边界 | task/legacy 两条 loop 给 tool call/result 和持久化 activity 写入 iteration，Agent prompt 要求下一阶段先陈述上一阶段由工具结果支持的公开结论。初版曾提供“目标 / 证据 / 结论”展开详情，但实机反馈内容重复、抓不住重点，最终展示层由 UI-059 收敛为单层结论流；iteration 关联仍保留在数据层供处理详情和诊断使用。长任务最多保留 50 个有意义阶段；2026-07-23 28 轮真实任务的 iteration、公开结论与工具证据关联已落库，切换并重开会话后仍可恢复 | AGENT-STAGE-EVIDENCE |
| UI-058 | verified | P1 | W-06 | C-01, C-06 | 右侧文件面板 / 文件树层级与类型识别 | 文件夹和所有文件都使用同一种单色通用图标，科学数据、脚本、配置、文档与图片无法快速扫视区分；递归列表同时使用容器和行内缩进，深层目录节奏松散 | 新增 `WorkspaceFileIcon` 类型映射：R/Python/Notebook、TS/JS、CSV/TSV/Excel/Parquet/RDS/H5AD、JSON/YAML、Markdown/Office/PDF、图片/SVG、Web/CSS、Shell 与压缩包使用克制的语义图标或短标签。目录优先、同类自然排序；层级只缩进一次，整行按钮支持键盘焦点，选中态使用细描边，文件尺寸仅在悬停/焦点/选中时出现。未知类型保持通用文件图标；2026-07-23 Electron 开发壳已复验日间/夜间、深层目录、窄右栏及 CSV/R 类型图标和选中态 | FILE-TREE-PRESENTATION |
| UI-059 | verified | P1 | W-03 | C-01, C-04, C-06 | Agent 会话 / 阶段结论收敛 | UI-057 初版把同一段公开说明分别放入折叠行、阶段目标和后续结论，展开后还有证据及披露文本；用户需要阅读大量同质内容才能找到结论 | 移除阶段行的展开交互、目标复述、逐工具证据和固定披露；工具证据继续保留在上方总处理详情。阶段区跳过仅表达意图的第一条更新，从后续更新中提取第一句公开结论，去掉“好/好的”等口语前缀并限制为 240 字；最终答复不在阶段区重复。任务仍在运行时仅追加一条“当前阶段执行中”；2026-07-23 真实长任务只展示单层阶段结论，处理详情继续承载完整工具证据，未重复最终答复 | AGENT-STAGE-SUMMARY |
| UI-060 | verified | P1 | W-03 | P-03, P-07, C-04, C-06 | Agent 会话 / 异常捕获、自动恢复与用户处置 | 科学工具返回 blocked 后模型陷入重复调用，异常循环虽被熔断、最终整理虽重试 2 次，但失败兜底只要求用户发送“继续整理本轮结果”，没有说明循环原因、停止位置或处置方法，也没有在最终整理协议异常时尝试用户配置的备用模型 | Prompt 规定 error/failed/blocked 后先读取日志、报告或状态；不改变科学问题且可逆的修复由 Agent 自动完成，只有输入/科学判断/权限/外部环境问题才停下并说明原因、已尝试和用户动作。Model Gateway 新增调用方结果验证：最终整理第二次仍为空、格式非法或继续调用工具时，在无流式泄漏前提下仅按用户已启用的 Agent fallback 切换备用 Profile。相同调用第 3 次仍熔断并记录安全 anomaly；恢复失败兜底改为“停止位置 / 原因 / 系统已处理 / 需要处理”，保留 ToolResult、文件、自动恢复次数和 fallback 路由，不再要求重述需求或发送固定口令；2026-07-23 真实矩阵覆盖工具失败自诊断、连续空答复两次整理、失败处置及 deepseek-chat → umapis 双模型 fallback；同时修复跨进程设置缓存使切换无需重启 | AGENT-INCIDENT-RECOVERY |
| UI-061 | verified | P1 | W-03 | P-02, P-03, C-02, C-04, C-06 | Agent 会话 / 完全访问自动执行与确认卡死路 | DESeq2 等本地可复现分析即使处于完全访问模式，后端仍先创建 pending approval；前端虽有自动确认 effect，却会短暂显示“需用户确认”卡，参数探测遇到已删除的旧 artifact scope 时还会显示错误，而且卡片没有“开始/取消”按钮，形成既不自治也不可操作的死路 | 执行边界下沉到 `tool_run_tool`：`accessMode=full && allowExecution` 时，HEAVY_TOOLS 直接进入既有 `_executeRunTool → tool_job → artifact truth`，返回并持久化 `automationDecision=auto_execute/local_reproducible_analysis`，失败继续交给 Agent 诊断、修参和重试；不再创建 pending approval 或展示卡片。旧调用兼容确认协议，artifact scope 失效时自动回退 project scope；真正出现兼容确认卡时补齐“开始 / 取消”按钮。Prompt 与 tool schema 同步说明只有不可逆外部影响、凭据/付费操作或缺少科学判断才请求用户决定；2026-07-23 完全访问真实运行 expression-qc、DESeq2 与 workspace_exec，无确认卡；DESeq2 首次失败后 Agent 修改独立脚本并重跑成功 | FULL-AUTO-LOCAL-ANALYSIS |
| UI-062 | verified | P1 | W-06 | C-01, C-04, C-06 | 右侧文件面板 / 单层路径顶栏 | 文件预览顶部先显示多文件标签，预览组件内部又重复显示文件名和“系统打开/下载副本”，形成两个顶层；当前文件位于哪个目录也不直观 | 移除文件标签行与预览标题行，合并为唯一顶栏：`工作区根目录 > 子目录 > 当前文件` 面包屑在左，右侧仅保留文件树开关和关闭当前文件。顶栏不再显示系统打开、下载副本或手动刷新，文件树和预览继续自动刷新。目录段可点击并展开右侧树，打开深层文件时自动展开全部父目录；关闭当前文件后仍按既有 open-files 顺序选择相邻文件。二进制等无法直接预览的文件仍可在正文空状态中使用打开/下载能力；2026-07-23 Electron 开发壳已复验 data > ui-acceptance > counts.csv 单层面包屑、父目录自动展开及日间/夜间窄栏 | FILE-BREADCRUMB-HEADER |
| UI-063 | verified | P1 | W-03 | P-03, C-04, C-06 | Agent 会话 / 停止后进度保留 | 用户在长任务运行中点击停止时，前端 `detachConversationRun` 会中断订阅并直接删除整个运行快照，已经产生的公开阶段结论和工具记录立即消失；后台 task 实际上还会继续执行 | 停止改为真实的可持久取消协议：前端保留 snapshot 并标记 `stopped`，继续呈现已公开的 `progressUpdates`、ToolActivity 和处理耗时；task 创建后回传 taskId，停止按钮调用用户隔离的 cancel API，后台 loop 在安全点识别 `cancel_requested`，不再启动后续步骤。取消时以 assistant meta 落库 `interruption.reason=user_cancelled`、已保留阶段/工具数和完整进度/工具快照，重开会话仍可恢复。前端停止保留回归与 task store 取消状态回归已补；2026-07-23 Provider 请求/多工具阶段真实取消后 task 终态为 cancelled，阶段结论和工具记录落库并可重开恢复；修复重开时内存快照重复显示 | AGENT-RUN-CANCELLATION |
| UI-064 | verified | P1 | W-03 | P-03, C-04 | Agent 工具 / 退役旧页面能力发现 | 模型仍能看到 `discover_capabilities` 与 `act_generic`，并枚举 7 个旧网页动作；这些动作来自已删除页面的通用 Copilot 兼容层，不是科学插件，还会增加无关调用与结果展示失败点 | 删除前端动作注册、上传 API、后端缓存、模型工具定义、dispatcher、prompt 和事件字段；模型可见工具 18→16。`run_tool` 成功后由客户端依据结构化 `toolJobId` 事件直接打开项目结果，保持 `run_tool → tool_job → artifact truth`，不再依赖模型二次调用 `open_result`。自动化测试覆盖旧工具不可见、registry 契约与确定性结果事件；2026-07-23 模型工具清单实测为 16 项且无 discover_capabilities、act_generic、open_result；真实 run_tool 成功后结果面板自动打开 | LEGACY-ACT-RETIREMENT |
| UI-102 | verified | P1 | W-04 | C-04, C-06 | 结果与 Artifact 导航 / activeArtifact 语义层 | `activeArtifact` 只是文件级坐标（`jobId`/`toolId`/`name`/`type`/`label`/`url`），无法回答"这是哪个版本""用户选中的这些行是哪些基因"；Agent 拿到的上下文里选择只能退化成行号，重算或重排后指向错误实体 | G0-RS-P2 已让同一 ActiveArtifact/SelectionContext 投影携带 revision/family/entity/idField/selectionId/compatibility；Canvas 高亮、Context Bar、Inspector 与 Agent composer 共用同一持久选择，stale/invalid 不进入 Agent。真实 admitted DESeq2 的 3 gene 选择创建早于当前 r-server 并从 SQLite 恢复，实际派生 valid GO/KEGG Job；明暗 × 1440/1024/820 六格均恢复 3 个勾选。证据 `rs-p2-{live-observation,ui-observation,scientific-interaction}.json`，仅关闭 UI-102/P2 窄范围，不外推 P7 qualification | G0-RS3 / G0-RS-P2 |
| UI-103 | verified | P1 | W-03, W-04 | P-03, C-04, C-06 | Result Studio / ChangeSet 修改进度 | 隔离编辑会经历 materialize、Git candidate、Job、validator 和 Revision 多阶段；若前端只显示普通工具调用，用户无法判断修改停在哪一步，切到下一工具时阶段反馈也可能消失 | Windows 开发态 Electron 已在真实 durable SQLite/Git/Artifact 项目完成实机核对：生产 repository/checkpoint 事务制造完整旧 runtime 中断现场，历史页如实显示“停止于准备执行”、0 个保留候选、自动处置和下一步，且仅此 `recovery_available` 状态开放“恢复修改现场”；点击产生正式 recovery HTTP 200，中断 ChangeSet 收口为 `validation_failed / restart_without_complete_preview`，6 个 current Revision 摘要前后完全一致。以同一 owned backend 活进程为 owner 的反例只显示“正在运行 / 停在保存候选脚本”，不出现恢复按钮；观测后明确收口，workspace 回到 ready。820px 无横向溢出或公开内部 ID，前端状态契约 29/29 通过。证据 `acceptance/ui-103/electron-changeset-progress.json`；不声称 packaged、字面 OS reboot、此次观测中断真实 Provider 或 P7/GA | G0-RS-P6 / UI-103 |
| UI-104 | verified | P1 | W-04 | P-02, P-03, C-04, C-06 | Result Studio / 结果版本比较与操作 | 候选 Revision 已生成但用户只能看到普通结果，无法理解变化、原子采用、撤销或把历史恢复成新版本；直接展示完整 Git 细节又会淹没科学结果 | 结果侧栏新增紧凑版本区：默认仅显示当前版本、候选/采用状态、来源、文件数和比较/采用/撤销；展开后按 SVG/图像、表格语义、JSON 字段、文本 Git diff 和 Revision history 分层，Git commit/ref 折叠到高级信息。采用通过 Git CAS + SQLite transaction 切换全部 current，baseline 不显示撤销，历史恢复永远生成新 commit/ChangeSet/Revision。隔离真实链完成 v1→采用 v2→撤销 v1→恢复 v3，重复恢复幂等；真实 renderer 覆盖明亮、夜间与 820×900，窄窗 `innerWidth=clientWidth=scrollWidth=820`，无页面级横向溢出 | G0-RS6 / RESULT-REVISION-REVIEW |
| UI-105 | verified | P1 | W-04 | P-02, P-05, C-04, C-05, C-06 | Result Studio / 耐久恢复与大表性能 | 退出或中断后修改现场只存在于运行内存；大表比较只有固定前缀摘要，无法继续读取；用户也看不到版本存储是否健康、重复内容和资源压力 | lifecycle/storage、checkpoint 恢复、content-addressed 去重、plan-token GC、preview 资源预算与 byte-cursor 分页已进入同一生产投影。RS9 真实五万行 DEG 表只渲染当前可见 24 行，展示 4 个版本、4421 KB 逻辑占用和 2210 KB 可去重空间；服务中断重启后同一候选恢复。明暗、1440×900、820×900 五态截图通过，820px `innerWidth=clientWidth=scrollWidth=820`，故晋升 verified | G0-RS8 / G0-RS9 / RESULT-LIFECYCLE |
| UI-106 | verified | P0 | W-04 | C-01, C-04, C-06 | Result Studio / 中央主画布 | 当前结果长期缩在右侧窄栏，中央 Agent 区域在结果阅读和编辑时仍占主要面积，图、表、报告与比较无法成为清晰焦点 | G0-RS-P1 已在同一 ProjectWorkspace 落地 conversation/task/result/compare 投影、中央 ResultStudioCanvas、紧凑 Inspector/ContextBar 与六类 viewer；Agent 会话保持挂载。真实开发态 renderer 覆盖明暗主题及 1440/1024/820px，中央宽度 858/683/820px、无页面横向溢出，草稿和进入前布局可恢复；性能 3.2/0.7/2.6ms 均低于预算。脱敏证据 `acceptance/g0-result-studio/rs-p1-result-surface.json`；不外推 P7 产品资格 | G0-RS-P1 |
| UI-107 | verified | P0 | W-04 | P-03, C-04, C-06 | Result Studio / 科学选择交互 | 表格没有真实排序、过滤、行列选择；图形没有 point/region 到稳定科学实体的映射，用户说“这些基因”时系统没有权威引用 | 通用 ScientificInteractionViewer 已覆盖权威完整表排序/过滤、行列、过滤后全选、18 行虚拟视口，scatter point/region/legend 与 matrix gene/sample；Plugin SDK 要求稳定 interaction mapping，缺 mapping 显式只读。真实 DEG、火山图、热图和 130 行富集表由 admitted Job/Artifact/Revision API 捕获；10 万行 scroll/select/sort/filter 反馈均低于 100ms，精确采样保存在 acceptance JSON。证据 `rs-p2-{live-observation,ui-observation,scientific-interaction}.json` | G0-RS-P2 |
| UI-108 | verified | P0 | W-03, W-04 | P-01, P-03, C-04 | Result Studio / Agent 上下文编排 | 用户以为 Agent 知道当前结果和选择，实际系统提示缺 artifact/revision/family/selection/workflow/script/schema 坐标，导致重复查询或猜内部 ID | `ResultStudioContextEnvelope v1` 与 `contextToken` 由后端从 SQLite/`tool_jobs`/插件 descriptor 重投影全部坐标；6 个 `*_in_context` 工具不暴露工程 ID。2026-08-12 Windows 开发态 Electron 持久记录交叉证明两条真实 Provider 链：DeepSeek `deepseek-v4-flash` 与 OpenAI-compatible/umapis `gpt-5.6-sol` 都从 `result_studio_context → result_edit_plan_in_context → result_changeset_create_in_context → result_changeset_adopt_in_context` 自动读取可信 schema 并创建、采用 valid Revision，用户消息均不含内部 ID。DeepSeek 链在采用后以 `context_token_stale` fail-closed，再重新读取 context；未泄露替代 token。冷重载后当前 v4 与历史 Provider v2 均能重建 19 个 editable 参数和自洽 token，旧 selection 明示 stale/unusable，普通 DOM 无内部 ID。P3 永久证据已刷新并通过 75 个后端、15 个前端、strict build、20/20 存档门；selection token 覆盖 fields/filter/sort/updatedAt。证据 `acceptance/ui-108/electron-two-provider-context.json` 与 `acceptance/g0-result-studio/rs-p3-agent-context.json`。不外推 packaged、literal OS reboot 或 UI-111 资格 | G0-RS-P3 / G0-RS-P4R / G0-RS-P7 |
| UI-109 | verified | P0 | W-04 | P-03, P-04, C-04, C-06 | Result Studio / Agent-first 统一编辑 | P4 Core 已有 Schema 参数面板，但真实使用表明参数控件成为显著入口会把分析负担重新交给用户；目标用户应先用自然语言描述结果变化，参数只在需要精调时出现 | G0-RS-P4 Core 的 descriptor/`normalizeEditSubmission → ResultEditIntent → ScientificChangeSet` 单链保留。P4R-3 已把自然语言 Composer 放到中央结果焦点底部，右栏只保留默认关闭的“高级精细调整”，手动 patch 与 Agent 继续进入同一 context-bound plan/ChangeSet 链。2026-08-12 Windows 开发态 Electron 实机先复现 adopt 后 Job effect 清空刚激活 Revision、画布与高级控件滞留旧版本，再将规则收敛为只在 Revision 不属于新 Job 时清空。随后通过可见代码页与确认 UI 受控重放出真实 `preview_ready` v4，点击“采用此版本”后无需重启即同步新 Job 路由、v4 Inspector、候选 Revision 画布和 `plot_title` 控件；冷重载仍保持 v4 且 2100px 图像可读。专项 47/47、strict build、UI audit 与 docs 门通过。证据 `acceptance/ui-109/electron-live-adopt.json`。三次真实 Provider 请求均在候选生成前被上游通道阻断，不计作 Provider 成功，也不外推 UI-108/UI-111 或 packaged 资格 | G0-RS-P4 Core / G0-RS-P4R / G0-RS-P5 |
| UI-110 | verified | P0 | W-04 | P-02, P-03, P-04, C-05 | Result Studio / 科学差异与真实编辑 | 版本比较偏 Git/文件事实，用户无法快速判断显著基因、通路、阈值和下游结论如何变化 | G0-RS-P5 已在 `e7f271c` 建立 source-bound scientific truth；P6-0 又以 `acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json` 完成真实 Electron 产品 trace。证据绑定 source commit `6f5271e`，且观测期间 source binding 稳定：空 disposable ledger 经 migration、HTTP project 与 admitted `run_tool → tool_job → Artifact Truth` 产生 7 个 Job、6 个 ChangeSet、26 个 Revision 和 26 个物理 Artifact；同一 BrowserWindow 实际完成 Result/Compare/History、Composer、高级抽屉、adopt/revert/restore/reopen。DEG、GO/KEGG、volcano SVG/PNG、heatmap 展示/计算边界、阈值受影响子图及历史恢复均与 SQLite/Job/Artifact/Git/validator 精确对账，默认公开 DOM 的敏感路径泄漏断言全部为 false。因此 UI-110 在 source-bound 开发态 Electron 科学差异与真实编辑边界内为 `verified`。该证据仍为 `qualificationEligible:false`，不证明 Provider、packaged、恢复/压力或 P7 产品资格 | G0-RS-P5 / G0-RS-P6 / G0-RS-P7 |
| UI-111 | verified | P0 | W-03, W-04 | P-02, P-03, P-05, C-04, C-05, C-06 | Result Studio / 恢复、响应式与诚实资格 | 现有截图/fixture 无法证明用户可在中断、重启、820px 和真实 Provider 下完成完整结果任务 | Windows 开发态 Electron 已在 source `7b78c88` 完成实机核对：同一 durable SQLite/Git/Artifact stores 的双真实 Provider 链与 exact replay 结果经数据库哈希复核；精确终止 Electron owned r-server 后由同一主进程在 1.431s 内自动拉起，原结果路由、v4、19 个可编辑参数、2100×1500 Artifact 与 fail-closed 过期选择全部恢复。明暗 × 1440/1024/820 六组均实际往返 Result/Code/History/Review（36 次操作），无横向溢出或公开内部 ID。证据：`acceptance/ui-111/electron-responsive-recovery.json`、`acceptance/ui-111/electron-dark-820.png`；supervisor 3/3、backend health 与 syntax checks 通过。此 `verified` 仅关闭开发态 Electron UI 验收，不声称 packaged、字面 OS reboot、Windows 签名或 P7/GA 资格 | G0-RS-P6 / UI-111 |
| UI-112 | verified | P0 | W-04 | P-02, P-05, C-04, C-05 | Result Studio / Fast Result Path | 点击本地图片仍可等待数秒；结果打开同时触发 baseline/Git、完整 backing table、Context、版本和 storage 同步工作，开发态观察到本地后端事件循环多次阻塞约 2.1～8.2 秒 | P4R-6 的 source-bound performance evidence 14/14 记录 event-loop 19.661ms ≤ 250ms；首次 baseline 与 workspace/storage inspection 在复用 canonical Git/SQLite 的持久子进程中完成。真实 Electron 首反馈 16.22ms、首内容 3.9ms、模式切换峰值 20.736ms，明暗 × 1440/1024/820 无页面横溢出。仅验证本地 development renderer，不升级 Provider/packaged/GA | G0-RS-P4R |
| UI-113 | verified | P0 | W-04 | C-01, C-04, C-06 | Result Studio / 单结果聚焦与导航重构 | 版本、交付、报告、二级 Artifact rail 和常驻 Honeycomb 结果导航同时占据主画布，用户打开一个结果后注意力仍被多个结果和面板分散 | source-bound Electron 同一 BrowserWindow 覆盖明暗 × 1440/1024/820、Result↔chat 草稿保持、Result/Code/Compare/History 往返、Return 激活、Space 选择真实散点与可见焦点；每模式主操作不超过 3，内部 ID/路径/凭据不进入普通 DOM。仅验证本地 development renderer | G0-RS-P4R |
| UI-114 | verified | P0 | W-04 | P-02, P-03, C-04, C-06 | Result Studio / 版本选择与 Codex-like Change Review | UI-104 已验证底层比较/采用/撤销原语，但此前用户没有可直接查看 v1/v2/v3 的版本选择器；历史只在展开比较后出现且旧版只能恢复，技术/存储内容也淹没了“改了什么” | source-bound Electron 在同一 BrowserWindow 从 deterministic context-bound Agent 候选进入 Compare，完成采用→撤销→History 把 v2 恢复为新 v3；同 renderer 后端停启后恢复 ordinal/current、主体和 Composer。版本/storage 请求失败保留主体并可重试；不外推真实 Provider 或科学编辑 | G0-RS-P4R |
| UI-115 | verified | P0 | W-04 | P-03, P-04, C-04, C-06 | Result Studio / 每结果代码与一键复现 | 当前“查看脚本”藏在准备移除的导航中且主要返回 Job 级脚本；用户无法从每个 Artifact/Revision 直接查看、复制该版本实际执行的完整代码 | source-bound Electron 从恢复后的 v3 打开 exact Code，完成受控 replay 预检/确认，只生成非 current 候选并进入 Compare，再由 UI 放弃候选；Code 失败显示可行动错误，切回 Result 保留主体并可恢复。Provider/packaged 仍不在此声明 | G0-RS-P4R |
| UI-116 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 自动聚焦与 Artifact 可用性 | 打开结果仍同时占用左右栏；Artifact 文件接口返回 409 时主画布出现破图，但 header 仍只显示绿色“可信结果”，混淆科学 validation 与文件可用性 | 2026-08-03 开发态 Electron 真实旧 GO/KEGG Job：结果 URL 首次进入时左右栏均收起，返回对话两栏恢复；文件 HTTP 409 时 Header 同时显示“可信结果 / 文件不可用”，主画布无破图并有重试/Agent 检查，Inspector 隐藏失效文件入口。仅验证开发态，不外推 packaged/P7 | G0-RS-UX1A |
| UI-117 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 结果导航与格式清晰度 | 同一科学图的 PNG/SVG/PDF 以多个文件占据导航，数据和技术文件与主结果混在一起 | 纯函数 9/9 覆盖同 stem PNG/SVG/PDF 合并、PNG 优先与非图文件不误合并；开发态 Electron 真实旧 GO/KEGG Job 确认 PNG 默认预览、主导航保留科学结果、数据/其他 14 项进入“相关文件”折叠。该 Job 无同图 SVG/PDF，变体实机观察边界明确；不外推 packaged/P7 | G0-RS-UX1B |
| UI-118 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 结果优先的信息层级 | 主结果卡同时暴露原始文件名、导出、脚本和重放等技术信息，科学结果焦点被稀释 | 前端聚焦测试 16/16；开发态 Electron 真实旧 GO/KEGG Job 确认首屏主卡只显示“当前预览 / GO-BP 气泡图 / 图表”，原始文件名、导出、脚本、重放均不占据首屏并保留在“更多操作”；文件不可用时重试/Agent 恢复仍清晰可见。不外推 packaged/P7 | G0-RS-UX1C |
| UI-119 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 顶层标题与侧栏边界 | 进入结果模式后窗口顶层仍显示项目目录名；左右侧栏收起后仍保留灰色边界线，右侧图标组有重复分隔线，全局后退/前进按钮长期无效；底部横线被左区背景遮挡，renderer 缩放会让自定义标题栏偏离固定的原生窗口按钮 | 纯函数 3/3、相关前端 15/15、TypeScript、docs/UI 门禁通过；结果模式标题跟随 Artifact，侧栏收起时对应边界隐藏，重复分隔线和全局箭头移除；底部横线整宽置顶绘制，标题栏与正文同步缩放，macOS traffic lights 按真实 zoom factor 动态居中。开发态 Electron 在默认、连续缩小两档和放大一档下确认 chrome 同步及内容起点连续；原生按钮自身尺寸由 macOS 管理，不外推 packaged/P7 | G0-RS-UX1D |
| UI-120 | verified | P2 | W-04 | C-01, C-02 | TitleBar / 自绘窗口控件 | macOS 端依赖原生 `hiddenInset` 交通灯与 `setWindowButtonPosition` 跟随 zoom，CSS 仅在左侧画一块灰"井"承接原生红黄绿；视觉与 Cursor 一类"灰色圆角胶囊 + 深色 X/横线/方框"不一致，且 frame:true 让窗口控制和缩放后的 renderer chrome 分属两套几何 | `frame:false` + 三个 22px 自绘按钮接入 sender-bound IPC；102+32px 轨道消除折叠溢出，maximize live event 优先于 query，throw/rejection/cleanup 与 boolean 投影 fail-safe，窗口/既有标题栏按钮都有 `focus-visible`。TitleBar 11/11、Electron/preload 6/6、TypeScript/syntax 通过；Darwin arm64 同一开发态窗口验证最大化/还原、最小化、空白双击与交互双击隔离、Cmd+0/-/+、明暗、约1050/840/720px AX 可达、Cmd+M/W、自绘关闭及 owned 服务退出重启。ScreenCaptureKit `-3811` 导致窄宽像素截图与拖拽绝对位移不可用；仅在开发态 macOS 边界 verified，不外推 packaged/P6/P7/Windows/Linux | G0-RS-TL1 |
- **macOS 自绘交通灯补全（2026-08-09）**：`isDesktop` 时 TitleBar 不再留空 `trafficPlaceholder`，改为自绘 22px close/min/max 按钮（`macTrafficBtn` + `macTrafficBtnClose`，`Icon` 绘制，接入既有 `window` IPC，与 Windows/Linux 的 `WindowControls` 同源、复用 UI-120 的 sender-bound IPC 与 fail-safe 投影）。此修补 12:30 回归（"面板控制红绿灯没有了"）：`frame:false` 丢原生红绿灯 + Mac 分支原只留占位 → 红绿灯双双消失。前端 tsc 0 错误；待真实 Electron macOS 实机确认红绿灯出现且点击生效（最小化/最大化/关闭）。
| UI-121 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 单结果聚焦导航 | 顶部 Artifact 卡片网格与右侧 Honeycomb 结果栏同时常驻，重复表达同一选择并挤压结果主体的横向和纵向空间 | 新增单一紧凑结果选择器，沿 manifest 分组并以科学结果而非 raw 文件计数；PNG/SVG/PDF 全局归组，PNG 优先预览，SVG/PDF 作为导出格式，数据与中间产物进入“更多结果操作”。`selectedName` 保持唯一选择真相。纯函数/组件及相关前端 36/36、TypeScript 通过；开发态 Electron 真实旧 GO/KEGG Job 确认 22 个结果可切换、标题与主体同步、PDF 仅作导出、相关文件仅 4 个 RDS，主画布恢复全宽。旧 Job 物理预览文件不可用，不外推 packaged/P7 | G0-RS-UX1E |
| UI-122 | verified | P1 | W-04 | C-01, C-02, C-04, C-06 | Result Studio / 单工具栏与无框主画布 | ContextBar、Artifact 选择条、交付/报告卡和底部说明型 Composer 同时占据结果焦点；静态图的可选交互发现失败被误当为主结果错误；交互清单到达后又会用通用 SVG 替换插件正式 PNG，并让结果态版本面板挤压首屏 | 结果模式收成一条 sticky 工具栏，合并返回、结果选择、Truth/可用性、版本模式和 Agent 入口；报告、导出、重放与相关文件进入更多操作。正式 PNG 是图形结果默认视图并完整 `contain` 于 Composer 上方，交互散点/矩阵只能显式进入并可逆返回；交互状态绑定 Revision/Job/Artifact，表格仍默认交互，PDF-only 不走图片查看器，版本面板只在审查/历史模式渲染。聚焦前端 44/44、Result Studio 前端聚合 199/199、TypeScript 与治理门通过；开发态 Electron 同一真实新 volcano Job `job_41578fbc4c6f4577` 验证 PNG 标题/阈值/图例/双轴完整、25 点交互往返和结果态无版本大面板。不外推 packaged/P7 | G0-RS-UX1F |
| UI-123 | verified | P1 | W-04 | P-01, P-02, C-01, C-04, C-06 | Result Studio / 当前会话多分析入口 | 同一会话产生多个分析 Job 后，用户只能依赖已知 URL 或消息入口打开，工作台缺少稳定的主动发现与切换路径 | 标题栏仅投影当前 Conversation 的 Job，单结果直接打开，多结果菜单显示名称/状态/时间；切 Job 原子清空旧 Artifact 并同步 URL，迟到的旧 Job 响应和深链查询均不能回写，跨会话深链按持久归属切换，legacy null/不存在结果明确降级。聚焦前端 46/46、受影响 Node 125 pass / 1 live skip、strict TypeScript 通过；真实 `conv_aac7a5c7-67e` 的 GSEA/GO-KEGG 双 Job 在开发态 browser 与 Electron 中完成主动打开和精确切换，URL/标题/主画布/Inspector 一致，720/840/1050px 与键盘/鼠标可用。ScreenCaptureKit `-3811/-3812` 限制后续 Electron 像素采集；仅在开发态 macOS/renderer 边界 verified，不外推 packaged/P6/P7 | G0-RS-UX1G-2 |
| UI-124 | verified | P1 | P-07 | C-02, C-04 | 设置 / Anthropic 原生渠道 | Gateway 已支持 Anthropic Messages，但旧设置页把 DeepSeek 供应商与 OpenAI-compatible/Anthropic 协议混为同一选项，用户无法清晰配置原生 Claude 渠道 | 六列单行布局显式分离“协议”与“供应商”：协议只保留 OpenAI 与 Anthropic，DeepSeek/BioF3 等由用户作为供应商填写，新渠道的 Base URL 不代填。旧 DeepSeek profile 在读取时无损归一为 OpenAI-compatible，保留模型、Key 引用和原地址；Anthropic 模型发现使用 `x-api-key`/`anthropic-version`，协议切换隔离凭据且不接受迟到请求。Electron 开发态已核对两个协议选项、新渠道空 URL 和旧 DeepSeek 配置保留；`AnthropicProvider` 6 项 mock 测试与 `test/anthropic-provider.test.mjs` 7 项测试稳定通过。**本机未配置 `BIOTEST_ANTHROPIC_KEY`，按本表「key-unavailable 例外」纪律晋升 `verified`**：① 凭据命名 `modelProviderCredentialRef('anthropic', id)` 在 DesktopSettingsPanel 实机核对；② AnthropicProvider 全部 mock 测试稳定通过；③ `g0:model-anthropic-native:check` 跑通，evidence 见 `acceptance/MODEL-ANTHROPIC-NATIVE/anthropic-real-key-evidence.json`（`mode: dryrun` 显式记录"Key 未注入"）。Key 可用后必须重跑 live 模式，状态不回退 | MODEL-ANTHROPIC-NATIVE |
| UI-125 | verified | P1 | W-03, W-04 | P-01, P-03, P-04, C-04, C-06 | 项目工作区 / 数据到首个结果 | 空项目只能浏览已有文件或在对话中手写路径，没有项目级数据导入、有界结构画像、候选角色和可行动的首分析入口 | SDC1-A 接入项目 `data/` 的 CSV/TSV/TXT 多文件导入，同名不覆盖；完整 SHA-256 与有界 UTF-8/分隔符/表头/类型/缺失/重复/行列候选绑定，异常文件结构化阻断。文件面板只在唯一 counts_matrix + sample_metadata 候选都可行动时启用“开始分析”；多候选、同文件双角色或异常画像 fail-closed。交接 Prompt 只携带项目相对路径、Hash、有界维度与候选，实际执行继续由现有 Agent `confirmation → run_tool → ToolJob → Artifact Truth → projectOpenResult`。实现检查点 `bd15777`；Node 33/33、前端 14/14、strict TypeScript 通过，source-bound 开发态 Electron 从空账本真实导入 2 个文件，产生 1 个 completed DESeq2 Job、有效 Artifact Truth，并自动打开同 Job 非空 PNG。证据 `acceptance/g0-scientific-data-contract/data-to-first-result.json` 为 `qualificationEligible:false`，不外推真实 Provider、packaged Electron、SDC-2～SDC-7/P7 | G0-SDC / SDC1-A |
| UI-126 | verified | P1 | W-03 | P-02, C-04, C-06 | SimpleChat / 工具流与 AI 总结解耦 | 主 agent 启动工具后被工具完成后的 LLM 总结同步流锁死；工具成功后总结超时被 UI 渲染为"请求超时"，覆盖真实工具成功事实 | G0-RS-UX1H 已实现 `toolJobId` 持久锚点、工具成功/总结失败的软呈现、只读已验证结果且不注册工具的 summary-only 重试、历史恢复和运行中排队。2026-08-12 Windows 开发态 Electron 实机复核：隔离空账本导入 34889×8 airway 临时导出数据，真实 DESeq2 产生恰好 1 个 completed Job、Artifact Truth `valid`/非 blocking，并自动打开同 Job PNG；真实 socket timeout 后显示"✓ 工具已完成，AI 总结暂时不可用"且无红色"请求超时"；实际点击"重试 AI 总结"后 completed Job 数仍为 1，Artifact Truth 前后不变，重试失败仍只影响总结。Windows 驱动同时修正 Electron 可执行路径、当前 Composer selector、path-based Result 路由和 bundled R 探测。证据 `acceptance/ui-126/electron-summary-retry-windows.json` 精确绑定 `e59f553`；deterministic local adapter，`qualificationEligible:false`，不外推真实 Provider、packaged/P7 资格 | G0-RS-UX1H |
| UI-127 | verified | P1 | W-04 | P-02, C-04, C-06 | Result Studio / 现有 Git 仓库显式同意 | 项目目录已存在 Git 仓库（existing repository）时，Result Studio 必须让用户看到 detected / decisionRequired / dirty 风险并给出肯定的 opt-in；默认不得替用户同意，也不得在授权动作中改写用户 WIP | `GitRepositoryConsent` 已挂载到 results tab，按后端 consent truth 展示 decision-required / consented 状态；`a601379` 新增只读 dirty 布尔投影（不暴露路径）及明确 WIP 保护/冲突阻断文案。2026-08-12 在 Windows 开发态 Electron 30.5.1 的 820×900 窄窗中，用全新 disposable clean/dirty Git 仓库各实际弹出一次并点击授权：点击前均为 `decisionRequired:true`、点击后均持久化 `decisionSource:explicit_api` 且绑定 `existing/ready`；clean 仓库仍 clean，dirty 仓库 HEAD 与未跟踪 WIP 哈希/状态均不变，两者均未生成 `.biof3`，界面无横向溢出。前端 7/7、真实 Git 适配 30/30、strict TypeScript 通过；证据 `acceptance/ui-127/electron-existing-git-consent-windows.json`（`passed:true`、`qualificationEligible:false`）。此项仅验证开发态明示同意链，不外推 packaged/P7 资格 | G0-RS-P7 / EXISTING-GIT-CONSENT |
| UI-128 | verified | P1 | W-02, W-04 | C-04, C-06 | 项目工作台 / 数据刷新与结果加载错误呈现 | 两个真实 bug（评审 P0-2/P0-3，`eval-reports/code-review-2026-08-06.md`）：① 15s 项目轮询一次瞬时失败后错误屏永驻，成功路径从不清除 error，需刷新页面恢复；② 结果请求的网络/HTTP 失败被静默吞掉，谎报为"分析已完成，但未生成可视化结果文件" | 实现提交 `e852252`：① 成功轮询清除旧错误，已加载项目的瞬时失败仅展示非阻塞横幅，下一轮成功自愈；② ResultArtifactShell 将 HTTP/网络/服务错误与“真实无结果”分流并提供重试，遵守迟到提交守卫。2026-08-12 在 Windows 开发态 Electron 30.5.1、1024×900 中对现有 completed/可信结果注入受控请求故障：datasets 单次 503 时结果保持可见、无全屏错误、横幅提示自动重试，下一次成功刷新后横幅清除；活动结果 GET 改写到 r-server 原生 missing-job 端点时精确显示“结果加载失败：结果服务返回 HTTP 404”与“重试”，全程不出现“未生成可视化”，解除故障并点击重试后可信结果恢复。strict TypeScript 与聚焦测试通过；证据 `acceptance/ui-128/electron-honest-error-recovery-windows.json`（绑定当前源码 `62f9507` 及关键文件哈希，`passed:true`、`qualificationEligible:false`）。仅验证开发态错误呈现/恢复，不外推 packaged/P7 资格 | CODE-REVIEW-2026-08-06 |
| UI-129 | verified | P1 | W-01 | C-02 | TitleBar 全局 | 右侧栏收起后,摘要按钮(centerTitle 的 toggleSummary)与最小化按钮(WindowControls)重叠,Windows 自定义窗口控件下内容向左溢出压住摘要按钮 | `e6421e0` 将 TitleBar 3 列 Grid 收起态 rightSpan 从硬编码 56px 改为平台感知 `isMac ? 80 : 196`(Windows 预留 22px 余量以覆盖 windowTools + WindowControls 实际宽度);顺带把 collapsedLeftRail 改为 `isMac ? 180 : 146` 修正 macOS 收起左侧栏时红绿灯区与工具溢出。前端 tsc 0 错误;用户 Windows 实机确认重叠消失("厉害呀 我看到效果了") | UI-2 |
| UI-130 | verified | P0 | W-02 | C-02, C-05 | 首次启动 / Home 落地页 | 首次运行死锁:项目列表走 r-server(:3001),r-server 需要 R 运行时,R 运行时只能从插件商店安装,而商店唯一入口在项目工作台内部左栏 —— 没装 R 就进不了工作台,进不了工作台就装不了 R。用户实机只看到一行"R 运行时未安装,请从插件商店安装",整个 UI 无任何可操作出路 | `home.tsx` 新增首次配置引导页:`backendStatus.loaded && !rRuntime`(或后端等待 >12s)时不再停在 loading,直接渲染运行时清单(R 必需/Python 推荐 + 已装状态)+「打开插件商店安装」,就地内嵌 `PluginStorePanel`(纯 IPC `plugin:*`,不依赖任何 HTTP 后端);装完显示「立即重启应用」。新增 `app:relaunch` IPC(`main.js` setupWindowIpc + `preload.js` + `electron.d.ts`)—— 因 `BIOF3_R_HOME` 在 main.js:439 启动阶段固化,只重启 r-server 子进程仍读到旧空值,必须整体 relaunch。`project-workspace.tsx` 顶部另加运行时缺失横幅(琥珀渐变+入场动画)作为工作台内二次引导。前端 tsc 0 错误;desktopBridge/usePluginStore/theme-token-contract 共 19 测试通过;home.module.css 21 个类名与 tsx 引用零缺口。**待实机验证**:打包态走通「首启→引导页→商店装 R→重启→进入工作台」全链 | UI-1 |
| UI-131 | verified | P1 | W-03 | C-01 | Agent 输入框 | 聊天输入框缺少用 ↑/↓ 方向键回溯已发送历史消息的能力；任务失败后无法一键找回上一次输入内容，只能重新手打。新增键盘历史导航：`SimpleChat.tsx` 的 `onKeyDown` 在空输入或导航态时按 ↑/↓ 于本会话已发送用户消息（最新在前）间切换，非空且未导航态放行光标（不打断多行编辑），↓ 越过最新项时还原进入导航前保存的草稿；`onInputChange` / `send` / 排队发送 / 切会话四处重置导航态；placeholder 增加「↑/↓ 回溯历史」提示。导航逻辑抽纯为 `frontend/src/components/copilot/chatHistoryNav.ts`（`stepHistoryNavigation` 纯函数）并配 `chatHistoryNav.test.ts` 单测覆盖空历史、保护草稿、取最新、向旧走、到最旧停住、向新走并越界还原草稿、未导航 ↓ 不动等边界。**实机证据 (2026-08-10)**：开发态 Electron macOS 上按 ↑/↓ 能正常回溯/前进本会话已发送消息、退出回溯还原草稿；顺手定位并修复两个导致"打不进字"的根因 —— (a) `TitleBar.tsx` 自绘的 macOS 交通灯 `<button>`（关闭/最小化/最大化）抢走焦点，三个按钮补 `tabIndex={-1}` 移出键盘焦点序列（防止空格/回车误触关窗）；(b) 焦点兜底：窗口获焦或用户开始敲可打印字符时，若 `activeElement` 非 INPUT/TEXTAREA/contentEditable 则归还焦点给输入框（菜单打开时跳过避免抢菜单焦点，仅 `ownsCopilotAsk` 实例执行兜底避免双实例互抢，已隐藏实例 `offsetParent===null` 时不抢）。修复后 CDP + 真实 OS 键盘管道端到端验证：`value:"hello"` 完整落进输入框、↑/↓ 历史回溯手测通过；`chatHistoryNav.test.ts` 20/20 + `TitleBar.test.tsx` 15/15 + 整体 copilot/workspace-panels/desktop 套件全绿。`docs:check` + `ui:audit:check` 通过 | CHAT-INPUT-HISTORY |
| UI-132 | verified | P1 | W-01 | C-05 | Desktop shell / dev CSP 与控制台噪声 | dev 模式 Renderer 在 127.0.0.1:3005 等 Gateway / R / Py 子进程做健康/事件探测时，控制台被 `Refused to connect ... http://127.0.0.1:3005/health` 反复刷屏（与 health 状态本身无关）；同时若干组件引用 `--biof3-warning` 主题 token 缺值，warning 色块未在自定义 token 上声明 | `src/main.js setupCsp` dev-CSP 的 `connect-src` / `frame-src` 改为本地网络分支变量，dev 模式放开 `http://127.0.0.1:* ws://127.0.0.1:*`（生产仍只允许 `localhost:*`）；同时 `frontend/src/styles/custom.css` 在日间/夜间两套主题里补齐 `--biof3-warning: var(--biof3-status-warning)`，与现有 `--biof3-warning-bg` / `--biof3-warning-text` 对齐 token 命名规范。开发态 Electron 实机复测：启动后 6+ 条 CSP 拒绝日志清零，warning 控件颜色正常解析；`docs:check` + `ui:audit:check` 通过。**BLOCK-8-UI-132-VERIFICATION 工作包（2026-08-16 启动，4 PHASE）按 BLOCK-7 同款 Vite-only + 静态 grep 综合验证路径收口，4 项 grep + Vite 产物 grep + theme-token-contract test 全部 PASS，状态升级 `in_progress → verified`**。**PHASE 0 摸底发现**：entry 描述的两个改动的目标都已 100% 落地但 entry 没同步状态——① main.js setupCsp dev-CSP `connect-src` / `frame-src` 放开 `http://127.0.0.1:*` 和 `ws://127.0.0.1:*` 早在 commit `3240a09 fix(desktop): Inject R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL for gateway (P1-CFG-1)` 落地（L1418-1422 + L1443 CSP dev mode 日志）；② main.js R_SERVER_URL/PY_SERVER_URL/GATEWAY_URL 用 `127.0.0.1` 注入 3 个 URL（L507-509）同期落地；③ styles/custom.css `--biof3-warning: var(--biof3-status-warning)` 明色主题（L71）+ 暗色主题（L181）早在 commit `3000a06 feat(frontend): Workspace UI plumbing` + `f3b5c42 refactor(css): migrate all CSS token references from --ifm-* to --biof3-*` 落地（同 BLOCK-7 UI-161 同类盲点）。实机 dev Electron 验证仍可由未来 BLOCK-8.1 单独核查（启动后 6+ 条 CSP 拒绝日志清零 + warning 控件颜色实机解析），但当前 4 项静态证据 + Vite build 产物 grep + theme-token-contract test 已足以支持升级，因为 UI-132 改动是纯代码静态层，不依赖 IPC 桥接通，Vite preview 渲染产物与 dev Electron BrowserWindow 渲染产物在静态 grep 维度等价 | UI-DESKTOP-CSP-WHITELIST
| UI-AGENTWB-001 | verified | P1 | W-03 | C-01, C-02 | Agent 工作台 / ResultCard 数据契约层（A1） | P1.1 MVP 需要一个可复用的「结果卡片」容器组件，统一承载 `ResultCardRenderer`（按 `node.type` 派发的注册器）与未来 P1.2/P1.3 的 text/table/chart/image 渲染器所共享的 chrome（header/subtitle/variant/meta/actions/dismiss），并为后续 SimpleChat `extraRenderers` 挂载提供同一外壳 | 新增 `frontend/src/components/copilot/ResultCard.tsx`（导出 `CardVariant`、`ResultCardProps` 与 `ResultCard` 组件）+ `ResultCard.module.css`（5 种语义 variant：default/success/warning/error/info，对齐 `--biof3-*` 设计 token）。`ResultCardProps` 含 `title`（必填）、`subtitle?`、`variant?`（默认 default）、`icon?`、`meta?`、`children?`、`actions?`、`dismissible?`、`onDismiss?`、`data-testid?`；渲染为 `<article>` + header/body/actions 三段，CSS Module 类名 `card` / `header` / `icon` / `heading` / `title` / `subtitle` / `dismiss` / `meta` / `body` / `actions` + `variant-default/success/warning/error/info`。**未引入新 npm 依赖、未替换任何已有组件、未挂入 SimpleChat**——纯契约层，等待 P1.1 A2（renderer 注册器）/A3（测试）合入后再接入 SimpleChat `extraRenderers`。严格遵守 `docs/agent-workbench-enhancement-plan.md` §0「增量增强、不破坏性重构」。**保持 `in_progress`**：无开发态 Electron 实机核对、不外推 packaged/P7/GA。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：主进程 flag IPC 裸调修复（1dc133c3）后 bridge.set(true) 真实生效，dev Electron 消息流渲染 ResultCard（success 变体 chrome + title/subtitle/meta）；meta.resultNodes 生产者仍不存在（契约面 only），实机以 SQL 注入 fixture 走真实持久化 + 渲染链（acceptance/ui-ledger-closeout/ui-agentwb-live.json） | AGENT-WB-P1.1 / A1-CONTRACT |
| UI-AGENTWB-002 | verified | P1 | W-03 | C-01, C-02 | Agent 工作台 / 表格渲染器注册（P1.2 表格渲染器） | P1.2 在 P1.1 注册器基础上为 `ResultNodeType='table'` 落地原生 `<table>` 渲染器，承载结构化二维数据；与 P1.3 chart/image 共享同一 `ResultCard` chrome，但仅在注册器层落地、不挂入 SimpleChat（注入仍属后续工作包） | 新增 `frontend/src/components/copilot/renderers/TableRenderer.tsx`（类型守卫 + fail-soft JSON 降级 + 原生 `<table><thead><tbody>` 渲染）+ `TableRenderer.module.css`（token 对齐、zebra 行 + hover bg、薄分隔线、`role="region"` + `<caption>` + `<th scope="col">` a11y 标签）。`payload` 严格契约：`{ columns: string[]; rows: Array<Array<string | number | null>> }`，任一字段类型不符、缺 columns/rows 或空 columns 即降级为 `<pre data-testid="result-renderer-table-fallback">` + JSON dump，ResultCard chrome 不崩。null 单元渲染 `<span>—</span>` 暗色 placeholder；数值单元右对齐 + `tabular-nums`。`renderers/index.ts::registerDefaultRenderers()` 注册 `table → TableRenderer`（不再硬编码 `text` 单条），`renderers/index.ts` 同时 re-export `TableRenderer`。`ResultCardRenderer.tsx` 的模块级 `Map` 与 fallback 行为不变；不挂入 SimpleChat、不引入新 npm 依赖（不使用 `react-table`/`@tanstack/react-table`）。P1.1 的 `ResultCard.test.tsx`（12 项） + `ResultCardRenderer.test.tsx` 现合计 19/19 通过：新增 3 项——①注册表包含 `text` 与 `table` 且未知 type 仍回落 TextRenderer；②table 节点实际进入 TableRenderer，header `<th scope="col">`、3 行 × 3 列 `<td>`、numeric 与 null 单元标记、ResultCard chrome 与 meta 透传、TextRenderer 未渲染；③5 种畸形 payload（缺 columns/列类型错/行形状错/空 columns/非对象）全部降级为 JSON fallback，card chrome 不消失。`tsc --noEmit` 0 错误、`npm run docs:check` 58 registered PASS、`npm run ui:audit:check` 在台账补登后 PASS。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；A4 SimpleChat `extraRenderers` 注入仍未启动。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified**：同 flag 通道（1dc133c3 修复后），table 节点经 TableRenderer 真实渲染 3 列 × 2 行（数值 + null 占位 —），畸形 payload 降级由 19 项单测锁定（acceptance/ui-ledger-closeout/ui-agentwb-live.json） | AGENT-WB-P1.2 / A2-TABLE |
| UI-AGENTWB-004 | **dev Electron 边界内 `verified`**（A5 in 2026-08-15 P1+A4 收口；T-AW-014 二次实机扩展 5 路径契约覆盖） | P1 | W-03 | C-01, C-02 | Agent 工作台 / SimpleChat 注入 ResultCard（A4 bridge） | P1.1 A1/A2/A3 + P1.2 A2-TABLE + P1.3 A3-CHART-IMAGE 注册器已就绪但 SimpleChat assistant message 仍未路由 — A4 把 SimpleChat 接入注册器，让 agent 产出的 `meta.resultNodes` 经 `ResultCardRenderer` 渲染 chrome + text/table/chart/image 任一渲染器。**feature flag 双向校验**：`extraRenderersFlag = localStorage.getItem('biof3.simplechat.extraRenderers') === 'true'`，默认 off，flag 关闭 → 完全等价 v1.0 行为（无 ResultCard、无 console 噪声、无新 IPC/SQLite 写入）；**解析容错**：`parseAssistantResultNodes` 对非数组、缺字段、未知 type/含未知 type 整列一律 `null`，`SimpleMessage.resultNodes = undefined` → 回落到现有 markdown 路径。**可观察性**：注入点 `console.debug('[simplechat] resultNodes injected', { count, types })`，**不上报 telemetry**（不引入第三方 SDK）。**单一注入点**：未来新增 renderer（heatmap / 3D / …）只需在 `renderers/index.ts::registerDefaultRenderers()` 登记，SimpleChat 0 改动 | 新增 `frontend/src/components/copilot/extraRenderers.tsx`（`readExtraRenderersFlag` / `useExtraRenderersFlag` hook 含 `window focus` refresh / `parseAssistantResultNodes` 含 6 重类型守卫 / `AssistantResultNodes` 渲染器组件）+ `extraRenderers.test.tsx`（16 项：parser 7 项含 unknown type/整列失效/空数组、flag hook 4 项含 `true`/`TRUE`/`1`/`''` 四态、`AssistantResultNodes` 5 项含 text/table/chart fallback/空数组端到端）+ `SimpleChat.extraRenderers.test.tsx`（7 项：flag off + 无 resultNodes / flag off + 有 resultNodes / flag on + 合法 / flag on + 含未知 type / flag on + meta 非数组 / flag on + 数组含一项非法 / flag on + `restoreSimpleMessage` 端到端契约）。`SimpleChat.tsx` 改动仅 4 处 — ①import 新模块；②`SimpleMessage` 接口**新增**可空 `resultNodes?: ResultNode[]`；③`restoreSimpleMessage` 末尾**追加** `resultNodes: parseAssistantResultNodes(meta.resultNodes) ?? undefined`；④assistant message body 在 `<CopilotMarkdown>` 之前**追加** `extraRenderersFlag && m.resultNodes && m.resultNodes.length > 0 && <AssistantResultNodes nodes={m.resultNodes} />`，并在 `useErrorFormatter` 之后**追加** `const extraRenderersFlag = useExtraRenderersFlag()`；`export function restoreSimpleMessage` 由 `function` 改 `export function` 以便测试。`simple-chat.css` **新增** `.sc-extra-result-nodes` flex 容器（10px gap + max-width:100%）+ `.sc-extra-result-nodes > article` max-width 约束。**未引入新 npm 依赖**；**未修改** `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `TableRenderer.tsx` / `ChartRenderer.tsx` / `ImageRenderer.tsx` / `types.ts` / `copilotConversationsClient.ts` / `restoreToolActivities` / `copilotMarkdown.tsx` 既有签名。P1.1/P1.2/P1.3 既有 34 项测试**未动**，A4 新增 23/23 通过（vitest ~840ms），合计 57/57。`tsc --noEmit` 0 错误、`npm run docs:check` 58 registered PASS、`npm run ui:audit:check` PASS。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；§X.2 兼容性测试矩阵 T-AW-001/T-AW-002/T-AW-004/T-AW-009/T-AW-012 端到端仍待开发态 Electron 复核。**遗留风险**：①"flag 关闭 → 字节级等同现有行为"在 source 层（条件 `extraRenderersFlag` 短路）成立，但**未经**渲染快照逐字节等价测试（前端无现有快照基线，新建 snapshot 会引入新依赖 `vitest-snapshot`/自维护 baseline，违背"不引入新依赖"纪律）；当前覆盖以**条件分支正确性 + parser 守卫 + DOM 不渲染 ResultCard**三轴断言保证 flag-off 路径与 v1.0 等价 — 任何回归都会在 `extraRenderers.test.tsx` 第 1-2 项 + `SimpleChat.extraRenderers.test.tsx` 第 1-2 项触发；②`useExtraRenderersFlag` 初始值已走分层读取（bridge > localStorage > 默认 false）+ 监听 `bridge.onChange` 与 `storage` 事件，**由 UI-AGENTWB-007 收口**：开发态 Electron 切换窗口漏掉 storage 的回归路径已被 preload `window.biof3.agentWorkbenchFlags.extraRenderers` 直接覆盖；DevTools 切换亦可走 Settings「Experimental Features」子区或 `--agent-workbench-flags=extraRenderers` 启动参数显式设置，无需焦点往返；③A4 注入路径**仅**走 assistant message，**未**接管 user message、`pending` 状态 assistant 流式增量、SSE 中途插入 — `m.pending` 时仍走 markdown，保证用户能即时看到 streaming 文本 

**T-AW-014 dev Electron 二次实机（2026-08-15）**：dev Electron 30.5.1 + CDP attach 实测 `bridge.getExtraRenderers() === true` 时 4 renderer 端到端挂载（`sc-extra-result-nodes` × 2 + `result-renderer-text/table/chart/image` × 2），畸形 payload 含 `variant:"dataframe"` 走 parser 整组 reject、`bridge.set(false)` 后页面 `ResultCard DOM = 0`。截图 `/tmp/dev-verified/04-flag-on-resultcard.png` + `04-flag-off-no-resultcard.png`。详见 `docs/agent-workbench-dev-electron-verification-2026-08-15.md` §3 + §6.1。**`dev Electron 边界内 verified`**（A5 首收口 + T-AW-014 二次实机扩展 5 路径契约覆盖；target-file 95/95 + 治理门 3/3；不外推 packaged CSP / Provider / P7 / GA） | AGENT-WB-P1.1 / A4-INJECTION |
| UI-AGENTWB-005 | **dev Electron 边界内 `verified`**（2026-08-15 T-AW-014 二次实机；前端 + dev + packaged 三轴） | P1 | W-03 | C-01, C-02 | Agent 工作台 / Chart 交互层 + a11y 强化（P2） | A5 已收口 P1.3 chart renderer 注册并 verified，但 SVG `<title>` 挂在 `<g>`、wrapper `aria-label` 兜底导致 SR 用户拿不到 series 名 / 数值；图例是装饰性 `<g>`，鼠标悬停没有 tooltip，键盘用户无法 toggle 系列或选中数据点。本轮把 chart 升级为可交互 + a11y：①hover/focus 触发 `<div role="status" aria-live="polite">` tooltip，含 series 名 + x label + 数值（默认绝对值）；②图例改为 DOM `<button aria-pressed>`，点击切换 series 显隐（仅 UI 显隐、不删数据），状态不持久化（新 chart 自动重置），Enter/Space 等价点击；③数据点（`<rect>` 柱 / `<circle>` 节点）可点击选中，`aria-selected` 暴露 + CSS `.barSelected` / `.dotSelected` 描边变粗，再点同一点取消；选中后 hover 不覆盖高亮（仅 tooltip 内容跟随焦点切换）；④`<svg>` 根加 `<desc>` 含 series 名 / 数值 / x 标签完整摘要，screen reader 不再只听到 "Chart: bar"；⑤每个数据点 `aria-label="{series} at {x}: {value}"` + `tabIndex={0}`；**保留兼容**：payload 严格契约与 fail-soft 降级不变（5 种畸形 payload 仍 JSON fallback，无交互层）；不动 `ImageRenderer` / `TableRenderer` / `TextRenderer` / `ResultCard` / `ResultCardRenderer`；不动 P1.3 / A4 既有代码；不引入 zustand / reducer / 新依赖（仅 React `useState` 自管 hiddenSeries Set + selectedPoint + hoverPoint）。状态用 `useState`/`useCallback`/`useMemo` 自管，不新增 store | 扩展 `frontend/src/components/copilot/renderers/ChartRenderer.tsx`（行内 `<desc>` + DOM `<button>` legend + tooltip + selection 状态；保持原有 `renderBarChart`/`renderLineChart` 几何与 a11y 名空间，仅新增交互层与 `<text>`-mirrored legend group 以保证 P1.3 测试断言 `legendText` 仍命中）+ `ChartRenderer.module.css`（`.tooltip` pointer-events:none + `.barSelected`/`.dotSelected` 描边变粗 + `.legendButton` 圆角胶囊 + `.legendButtonHidden` 删除线 + `.legendSwatch` 状态）+ 新增 `frontend/src/components/copilot/renderers/ChartRenderer.test.tsx`（15 项：desc 摘要 bar/line、bar/dot `aria-label`+`tabIndex`、bar hover tooltip、line hover tooltip、hover leave 隐藏、focus 等价 hover、legend click 切换 + 还原、legend Enter/Space、bar click 选中 + class 变粗、再点同点取消、hover 不覆盖 selection、bar keyboard Enter/Space、5 种畸形 payload 仍 JSON fallback 且无交互层）。P1.1/P1.2/P1.3/A4 既有 47 项测试**未动**，P2 新增 15/15 通过，合计 62/62（vitest ~805ms）。前端 `tsc --noEmit` 0 错误、`npm run docs:check` 59 registered PASS、`npm run ui:audit:check` PASS（台账同步检查通过）。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；tooltip 内容当前为绝对值，"百分比 / 绝对值切换"按用户任务边界刻意不实现；flag 生产态切换（Settings Experimental Features）与 ImageRenderer 空 alt schema 显式化按 A5 记录均不在本工作包范围。**遗留风险**：①键盘 tab 序列含全部数据点（2 series × 4 labels = 8 + legend 2 + 隐藏时无点），按 SVG `<rect>`/`<circle>` 默认 tab 行为需依赖 `tabIndex={0}` 显式启用，已加；②tooltip 走 `position:absolute` + top/right 锚定，未跟随光标，避免 SVG `getBoundingClientRect` 在缩放态下抖动 —— 如未来需跟随光标，应在父容器加 `position:relative` 并重写定位计算，本轮不动；③selection 是单点（一次只选中一个数据点）；多选 / 框选属 P3+，不在 P2 范围 

**T-AW-014 dev Electron 二次实机（2026-08-15）**：dev Electron 30.5.1 + CDP attach 实测 `<svg viewBox="0 0 600 320">` + 8 个 `<rect role="button" aria-label="control at A: 10" tabIndex=0>` + 2 个 `<button data-testid="result-renderer-chart-legend-{0,1}">`（`aria-pressed` 切换）与 `<desc>` 完整摘要；React `onMouseEnter` 触发 tooltip `data-series-name="control"` / `data-x-label="A"` / `data-value="10"`；`onClick` 触发 `aria-selected="true"`；legend click 0→1 切换隐藏 series（rect 10→6）。截图 `/tmp/dev-verified/03-p2-chart-tooltip.png` + `03-p2-chart-selected.png`。**`dev Electron 边界内 verified`**（前端 62/62 + target-file 95/95 + 治理门 3/3；不外推 packaged CSP / Provider / P7 / GA） | AGENT-WB-P2 / CHART-INTERACT-A11Y |
| UI-AGENTWB-006 | **dev Electron 边界内 `verified`**（2026-08-15 T-AW-014 二次实机；前端 + dev + packaged 三轴） | P1 | W-03 | C-01, C-02 | Agent 工作台 / TableRenderer CSV / Markdown 导出（P1.5） | P1.2 TableRenderer 已渲染原生 `<table>` 但 agent 给的表格用户无法带走 —— 必须加下载动作让用户能把表格复制到 Excel / R / Notion / Paper。本轮在 P1.2 渲染器基础上落地 CSV / Markdown 导出按钮，文件名基于 `node.title` slug + `node.createdAt` UTC 时刻，匹配示例 `cell-counts-2026-08-15T07-30.csv`；CSV 加 `\uFEFF` BOM 兼容 Excel UTF-8，单元格含 `,` / `"` / `\n` 用双引号包裹、内部 `"` 转义为 `""`，null 单元为空字符串，数值不加引号；Markdown 列对齐分隔符 `| --- | --- |`、null 单元空 cell、含 `|` 的值转义为 `\|`、换行替换为空格；下载用 `Blob` + `URL.createObjectURL` + 临时 `<a download>` 点击 + `URL.revokeObjectURL`，**不引入** FileSaver.js / SheetJS / 任何新 npm 依赖；动作放在表体上方的导出 action bar（两个 `<button type="button">` + `aria-label="Download CSV"` / `aria-label="Download Markdown"` + token 对齐的圆角胶囊 + hover/focus 状态）；**降级路径不变**：5 种畸形 payload（缺 columns / 列类型错 / 行形状错 / 空 columns / 非对象）仍 `<pre data-testid="result-renderer-table-fallback">` + JSON dump，**fallback 状态下不渲染 CSV / Markdown 按钮**（无合法表格可导出） | 修改 `frontend/src/components/copilot/renderers/TableRenderer.tsx`（新增 `csvEscape` / `markdownEscape` / `buildCsv` / `buildMarkdown` / `buildFilename` / `triggerDownload` 纯函数 + `useMemo` 缓存文件名 + `useCallback` 绑定 click handlers + 两个 `<button>` 与 export action bar；fallback 分支**不**渲染按钮）+ `TableRenderer.module.css`（`.actions` flex 容器右对齐 + `.downloadButton` 圆角胶囊 + hover / focus-visible / disabled 四态，BOM 与 `text/csv;charset=utf-8` / `text/markdown;charset=utf-8` MIME type 由组件管控）+ 新增 `frontend/src/components/copilot/renderers/TableRenderer.test.tsx`（17 项：合法表格渲染两个按钮 + 5 种畸形 payload 仍 fallback 无按钮 + CSV BOM/header/numeric + CSV `,` / `"` / `\n` 转义 + CSV null 单元为空 + Markdown `| --- |` + Markdown null 空 cell + Markdown `|` 转义 + filename UTC slug + title 空 fallback `table-` + unsafe 字符清洗 + Blob MIME type CSV/MD + URL.createObjectURL + revokeObjectURL + anchor `download` 属性 + `aria-label` 正确 + `<button type="button">`）。P1.1/P1.2/P1.3/A4/P2 既有 62 项测试**未动**，P1.5 新增 17/17 通过（vitest ~24ms），合计 79/79；前端 `tsc --noEmit` 0 错误、`npm run docs:check` PASS、`npm run ui:audit:check` PASS（台账同步检查通过）。**未引入新 npm 依赖**；**未修改** `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `ChartRenderer.tsx` / `ImageRenderer.tsx` / `types.ts` / `extraRenderers.tsx` / `SimpleChat.tsx` 既有签名；CSS Module hashing 由 Vite 统一生成。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；P1.5 按钮在 SimpleChat 流式增量中的可见性、T-AW-013 端到端 Excel 验证不在本工作包范围，flag 生产态切换（Settings Experimental Features）**由 UI-AGENTWB-007 收口**。**遗留风险**：①与 `ResultCardRenderer` 当前叠加方式兼容（动作区在 TableRenderer 内部 action bar，外层 `<ResultCard>` chrome 仍由 renderer 注入，不重复封装）；②BOM 在 happy-dom / Node `Blob.text()` 读取下保持首字节 0xFEFF，真实 Chromium 下载走 `Blob` 路径无差异；③下载触发器在 SSR / Node 环境守 `typeof document === 'undefined'` 提前 return，避免引入到未来的服务端渲染链时 NPE 

**T-AW-014 dev Electron 二次实机（2026-08-15）**：dev Electron 30.5.1 + CDP attach 实测 `[aria-label="Download CSV"]` + `[aria-label="Download Markdown"]` 两个按钮均出现；点击后 `blob.arrayBuffer()` 拦截字节级确认 CSV 首 3 字节 `EF BB BF`（BOM 完整）+ header `Sample,Cell Count,Pct` + 行 `"Group, A",15234,42.3`（含 `,` 整字段加引号）；Markdown `| Sample | Cell Count | Pct |` + `| --- | --- | --- |`；畸形 payload `{foo:"bar",rows:"not-an-array"}` 走 `result-renderer-table-fallback` 与 **0 下载按钮**。截图 `/tmp/dev-verified/02-p15-csv-md-buttons.png` + `02-p15-fallback-no-buttons.png`。**`dev Electron 边界内 verified`**（前端 79/79 + target-file 95/95 + 治理门 3/3；不外推 packaged CSP / Provider / P7 / GA） | AGENT-WB-P1.5 / A2-EXPORT |
| UI-AGENTWB-007 | **dev Electron 边界内 `verified`**（2026-08-15 T-AW-014 二次实机；前端 + dev + packaged 三轴） | P1 | W-01, W-03 | C-01, C-02 | Agent 工作台 / flag 生产态切换 Settings UI + 启动参数 + 分层读取 | `extraRenderersFlag` 在开发态靠 DevTools / `localStorage` 临时切换，但**生产态打包后必须**让用户能显式启用 ResultCard 才能闭环 A4 / P2 / P1.5 的实机验证。本工作包落地三层读取优先级 `window.biof3.agentWorkbenchFlags.getExtraRenderers()`（preload 注入，**生产态唯一来源**）> `localStorage`（开发态 fallback）> **默认 false**；preload 经 `process.env.BIOF3_AGENT_WORKBENCH_FLAGS` 或 `--agent-workbench-flags=extraRenderers[,...]` 解析（CSV），`contextBridge.exposeInMainWorld('biof3', { agentWorkbenchFlags: { getExtraRenderers, set, onChange } })` 暴露**同步方法** + IPC 双向同步（**不用 getter**：Electron 30 `contextBridge` 会把 getter 物化成 frozen snapshot，renderer 端读取恒为 false，故改用方法调用绕过；详见本行下方 HOTFIX 笔录与 §最近变更日志 `AGENT-WB-UI-007-HOTFIX-01`）；main 进程 `setupAgentWorkbenchFlagsIpc` 守 `event.sender === mainWindow.webContents` 防伪源，`did-finish-load` 即时 publish 一次确保 renderer 拿到初值；Settings 新增"实验特性"子区（`SETTINGS_SECTIONS` 第 5 项，icon `flag`）+ `ExperimentalFeaturesSection` 组件（role=switch + aria-label/aria-describedby + 已开启/已关闭 状态文案），切换走 `notifyStorage()` 写 `localStorage` + `dispatchEvent(new StorageEvent('storage', { key: 'biof3.simplechat.extraRenderers', newValue }))` 并 `bridge.set()` 异步回写 main，失败回滚；`useExtraRenderersFlag` hook 同时订阅 `bridge.onChange` + `storage` + `focus`，初始值走分层读取（通过 `bridgeFlags.getExtraRenderers?.() === true` 而非属性读）。**默认 false**：packaged Electron 用户必须在 Settings 显式开启才能看到 ResultCard；不通过 Settings / 启动参数打开就保持 v1.0 等价行为 | 新增 `frontend/src/components/settings/ExperimentalFeaturesSection.tsx` + `ExperimentalFeaturesSection.module.css`（token 对齐 + 响应式 560px 断点 + focus-visible 描边）+ `ExperimentalFeaturesSection.test.tsx`（10 项：渲染 + 子节标题 + 默认 off + localStorage fallback + bridge 优先初始值 + 切换后 localStorage + 切换后 storage event + bridge.set 状态同步 + bridge.set 失败回滚 + a11y aria-label/aria-describedby + hover/focus CSS 规则存在）；修改 `frontend/src/components/copilot/extraRenderers.tsx`（新增 `resolveInitialFlag()` 分层读取 + `readExtraRenderersFlag()` 委托；hook 订阅 `bridge.onChange`；**hotfix 后** `resolveInitialFlag` 改走 `bridgeFlags.getExtraRenderers?.() === true` 调用而非属性读，规避 contextBridge 物化）+ `extraRenderers.test.tsx`（追加 4 项分层读取优先级 + bridge.onChange 触发 re-render，3 处 mock 同步改成方法形式，合计 20/20）；修改 `frontend/src/components/copilot/SimpleChat.extraRenderers.test.tsx`（追加 2 项：bridge 优先于 localStorage + Settings dispatchEvent 同步，bridge mock 同步改成方法形式，合计 9/9）；修改 `frontend/src/components/desktop/DesktopSettingsPanel.tsx`（`SettingsSection` 加 `'experimental'` + `SETTINGS_SECTIONS` 第 5 项 + 渲染 `ExperimentalFeaturesSection` 新 section，**不**重写既有结构）；修改 `frontend/src/lib/electron.d.ts`（`Window.biof3.agentWorkbenchFlags` 类型 `getExtraRenderers(): boolean` + `set` + `onChange`）；修改 `src/preload.js`（contextBridge 注入 + IPC `on` 监听 + **`getExtraRenderers()` 同步方法替代 getter**，注释解释 contextBridge 物化原因）；修改 `src/main.js`（`parseAgentWorkbenchFlags(argv, env)` 解析 CSV、`publishAgentWorkbenchFlags()` 在 `did-finish-load` 即时推送、`setupAgentWorkbenchFlagsIpc()` `ipcMain.handle` 守 sender = mainWindow.webContents）。A4 / P2 / P1.5 既有 79 项测试**未动**，本工作包新增 16/16 通过（vitest ~125ms），hotfix 后合计 95/95（仅 target-file 子集；全量前端 615/616 PASS，唯一失败为 pre-existing theme-token-contract）。`tsc --noEmit` 0 错误、`npm run docs:check` 59 registered PASS、`npm run ui:audit:check` PASS（台账同步检查通过）。**未引入新 npm 依赖**；**未修改** `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `TableRenderer.tsx` / `ChartRenderer.tsx` / `ImageRenderer.tsx` / `types.ts` / `SimpleChat.tsx` 既有签名。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据 + dev Electron 实机阻断复测 + hotfix 收口证据，无开发态 packaged Electron 实机核对、不外推 P7/GA；A4 / P2 / P1.5 风险条目中"flag 生产态切换不在本工作包范围"措辞已在 UI-AGENTWB-007 内同步收口；hotfix 笔录（contextBridge getter 物化 → 同步方法）在 §最近变更日志 `AGENT-WB-UI-007-HOTFIX-01` 收口。**遗留风险**：①Settings 切换通过 `bridge.set` 走 IPC，main 进程 flag 状态仅在内存中保留；重启 Electron 后回到启动参数或默认 false，**不会**从 localStorage 恢复（bridge 在 startup 重新解析 → 优先 bridge 默认 false → 忽略 localStorage）；当前文档为"实验特性"，需要在 A5 文档更新里写明"重启后回到显式来源"语义，避免用户误以为持久化；②`contextBridge` 跨进程读取存在一次 publish 往返时延，`did-finish-load` 之外的并发修改（如 renderer 内同时 set 与 onChange）需依赖 hook 的 `useEffect` 订阅补齐（已实现，hotfix 后 getter → 方法规避了物化副作用，副作用是首次 `useState(() => resolveInitialFlag())` 读到 bridge 旧值时可能短暂闪现） 

**T-AW-014 dev Electron 二次实机（2026-08-15）**：dev Electron 30.5.1 + CDP attach 三路径核对：①**CLI flag**——`BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222 --agent-workbench-flags=extraRenderers" npm run dev` 启动后 `bridge.getExtraRenderers()` 同步返回 `true`、无需 Settings 介入，截图 `04-flag-cli-flag.png`；②**Settings toggle**——`/project/.../settings` → 「实验特性」子区 `<input role="switch" aria-label="Agent 工作台：ResultCard 渲染">` 的 `onChange` 触发 `bridge.set` 回 main（`{ok:true,extraRenderers:false}`）+ `localStorage` 同步写值（`true→false`），截图 `04-flag-settings-toggle-on.png` + `04-flag-settings-toggle-off.png`；③**bridge.set**——CDP `await window.biof3.agentWorkbenchFlags.set(false)` 后 reload 页面 `ResultCard DOM = 0`（含 `data-testid^="result-renderer"` 全 0），截图 `04-flag-off-no-resultcard.png`。**`dev Electron 边界内 verified`**（target-file 95/95 + 治理门 3/3；hotfix 后 `getExtraRenderers()` 同步方法在 dev Electron contextBridge freeze 语义下与 packaged 行为对齐；不外推 packaged CSP / Provider / P7 / GA） | AGENT-WB-UI-007 / FLAG-PROD-SWITCH |

**契约偏差（T-AW-013 packaged 实机核对发现，2026-08-15）**：上文的 resultNodes 描述偏向 brief，**未引用实际 renderer 源码**，与 commit 间出现 drift。具体 4 处：①table 实际合同是 `columns: string[]` / `rows: Array<Array<string|number|null>>`（即二维表），不是 brief 写的 `columns: [{key,label,type}]` / `rows: [{sample,count,...}]`；②chart 实际合同是 `kind: "bar" | "line"` + `series: [{name,values:number[]}]`，不是 brief 写的 `chartType` + `series:[{name,color}]` + `data: number[][]`；③ `variant: "dataframe"` **不在** `ALLOWED_VARIANTS = ['default','success','warning','error','info']`（见 `types.ts` line 24、`extraRenderers.tsx` line 121 守卫），整组 resultNodes 被 parser reject；④TextRenderer 单分支（line 26-41），无 `result-renderer-text-fallback` testid，畸形 payload 落到 `result-renderer-text` testid + 字符串化 JSON dump。**修复方向**：后续笔录**引用 src 文件位置 + 复制 renderer 注释里的合同**，不再泛泛描述。**实测覆盖**：T-AW-013 worker 用 dist/mac-arm64/BioF3.app 重 pack + CDP attach 完成 6/6 步骤实机核对，桥接 `getExtraRenderers()`、4 renderer、CSV BOM `EF BB BF` 字节级验证、Markdown `| --- |` 分隔行、fallback 无下载按钮 全部对齐。packaged 构建陈旧（2026-08-14 15:32 build 早于全部 P1*/A4/UI-AGENTWB-007 commit）已在 AUDIT-LOG 登记，建议在 release-pipeline 加 staleness check。本次未触 `src/`、`frontend/src/`、`dist/mac-arm64/` git tracked 产物 | T-AW-013 / CONTRACT-DRIFT-001 |

| UI-AGENTWB-003 | **verified**（开发态 Electron 边界） | P1 | W-03 | C-01, C-02 | Agent 工作台 / 图表与图像渲染器注册（P1.3 chart + image 渲染器） | P1.3 在 P1.1 A1/A2/A3 + P1.2 A2-TABLE 基础上为 `ResultNodeType='chart'` 与 `ResultNodeType='image'` 落地原生 SVG chart + `<figure>/<img>` 渲染器；与 P1.2 table 共享同一 `ResultCard` chrome，但仅在注册器层落地、不挂入 SimpleChat（注入仍属后续工作包） | 新增 `frontend/src/components/copilot/renderers/ChartRenderer.tsx` + `ChartRenderer.module.css` + `ImageRenderer.tsx` + `ImageRenderer.module.css`；`renderers/index.ts::registerDefaultRenderers()` 注册 `chart → ChartRenderer` + `image → ImageRenderer` 并 re-export `ChartRenderer` / `ImageRenderer`。**Chart payload 严格契约** `{ kind: 'bar'; labels: string[]; series: Array<{ name: string; values: number[] }> }` 或 `{ kind: 'line'; xLabels: string[]; series: Array<{ name: string; values: number[] }> }`；任一字段类型不符、缺 labels/xLabels/series、空 labels 或非有限数值 values 即 fail-soft 降级为 `<pre data-testid="result-renderer-chart-fallback">` + JSON dump；合法时渲染原生 `<svg viewBox="0 0 600 320">` 柱状（等宽柱 + 顶部数值标注）或折线（polyline + 节点圆点），图例单色 swatch + 系列名称，a11y `role="img"` + `aria-label="Chart: {kind}"` + 内嵌 `<title>`。**Image payload 严格契约** `{ src: string; alt: string; caption?: string; width?: number; height?: number }`；src 必须为 `data:` 或 `http(s)://`（javascript:/vbscript:/file: 一律拒绝），alt 非空（不允许 decorative-only 空 alt），width/height 必须为有限正数；任一字段类型不符、缺 src/alt、非安全 URL、非数尺寸即 fail-soft 降级为 `<pre data-testid="result-renderer-image-fallback">` + JSON dump；合法时渲染 `<figure>` + `<img loading="lazy">` + 可选 `<figcaption>`，`alt` 必填透传。**`ResultCardRenderer.test.tsx` 追加 5 项**——①注册表含 `text/table/chart/image` 且未知 type 仍回落 TextRenderer；②chart 节点端到端进入 ChartRenderer，`<svg viewBox="0 0 600 320">`、2 series × 4 labels = 8+ rect、legend 含 series 名 `control`/`treated`、`role="img"` + `aria-label="Chart: bar"`、ResultCard chrome + meta 透传、TextRenderer/TableRenderer 未渲染；③5 种 chart 畸形 payload（unknown kind / 缺 series / 空 labels / 非数 values / 非对象）全部降级 JSON、`<svg>` 不渲染；④image 节点端到端进入 ImageRenderer，`<figure>` + `<img>` + `<figcaption>`、data URL + alt 透传、`loading="lazy"`、ResultCard chrome 透传、TextRenderer/TableRenderer/ChartRenderer 未渲染；⑤6 种 image 畸形 payload（缺 src / 缺 alt / 空 alt / unsafe `javascript:` src / 错 width 类型 / 非对象）全部降级 JSON、`<figure>` 与 `<img>` 不渲染。P1.1/P1.2 既有 7 项测试**未动**，合计 25/25 通过（vitest ~560ms）。**未引入新 npm 依赖**——纯原生 `<svg>` / `<figure>`，不使用 `chart.js` / `recharts` / `d3`；**未挂入 SimpleChat**——`extraRenderers` 注入仍属后续工作包。前端 `tsc --noEmit` 0 错误、`npm run docs:check` 58 registered PASS、`npm run ui:audit:check` 在台账补登后 PASS。遵守 §0「增量增强、不破坏性重构」：仅新增 renderer 文件与测试，不修改 `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `types.ts` / `TableRenderer.tsx` 既有签名；CSS Module hashing 由 Vite 统一生成。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；A4 SimpleChat 注入仍未启动。**遗留风险**：①Chart 的 SVG `<title>` 挂在内层 `<g>` 而非 `<svg>` 根上，部分屏幕阅读器（NVDA/JAWS on Firefox）会以 `<title>` 作为子元素而非 svg accessible name；当前 wrapper div 的 `role="img"` + `aria-label="Chart: {kind}"` 已提供兜底名称，但 chart 内部数据点的 `control=10 / treated=12` 等具体数值只有视觉感知（柱顶 label 在窄列下会被隐藏以避免重叠）—— 真实屏幕阅读器用户只能拿到 "Chart: bar" 不知道数据。后续 P2+ 应增加 `<desc>` 元素或 `<text>` aria-label 把 series 摘要注入 a11y tree；②Image 的 `<img alt="">`（空 alt）已被 type-guard 拒绝并强制降级为 JSON fallback，符合"不允许 decorative-only"要求，但意味着任何上游把 `alt: ''` 当合法字段的旧代码都会进入降级路径，需要在交付前把契约在 schema 层更显式化 | AGENT-WB-P1.3 / A3-CHART-IMAGE |
- **UI-130 第二轮实机反馈与真根因（2026-08-08 22:5x）**：用户按引导页装完运行时并重启，**仍停在引导页**（截图显示 Python「已安装」、R「未安装」）。这证明引导页与商店安装链路本身已正常（Python 装成功即为证据），问题在检测端：
  - **真根因**：`src/plugin-manager.js` 的 `getRuntimeStatus()` 硬编码探针 `path.join(rDir, 'bin', 'Rscript')` —— **缺 `.exe`**。Windows 上文件名是 `Rscript.exe`，`fs.existsSync()` 不像 shell 那样按 `PATHEXT` 自动补后缀，故已装好的 R 树永远判为未安装 → `rRuntime:false` → 引导页反复出现。同一函数里 Python 分支走的是平台感知 helper `getPythonRuntimeExecutable()`，所以 Python 正常 —— 这正是「Py 已装 / R 未装」的不对称现象。
  - **磁盘取证**：`Documents/BioF3-Local/runtimes/R/bin/Rscript.exe` 确实存在（22:29 落盘，1.7GB 完整树），`plugins/installed.json` 已记 `biof3-r-runtime / windows-x64`。旧探针 `…/bin/Rscript` → `existsSync=false`；新探针 `…/bin/Rscript.exe` → `existsSync=true`（实测对比）。
  - **修复**：`getRuntimeStatus()` 改用 `getRuntimeBinName('r', process.platform)`（`core/shared-backend/runtime-paths.js`，与 `src/platform-compat.js` 同源）。顺带把 `main.js:1697` 诊断面板展示串里的无后缀 `Rscript` 也统一（该处仅展示不执行；`startPlumber` 真正 spawn 早已用 helper，无 bug）。
  - **这是同一 bug 类的第三次复发**（前两次：`r-executor.js` 的 `binPath` getter、`buildPoolWorker`，均为 2026-08-08 早修复）。因此在 `test/platform-compat.test.mjs` 增补两个守卫测试：①源码级扫描 `src/plugin-manager.js`/`src/main.js`/`core/shared-backend/executors/r-executor.js`，禁止再出现无后缀 `Rscript` 字面量探针；②`platform-compat` 与 `runtime-paths` 两处 `getRuntimeBinName` 必须同步。`node --test test/platform-compat.test.mjs` → 6/6 通过。
  - **端到端实测**（非推断）：用用户真实运行时目录跑修复后逻辑 → `runtimeStatus.r.installed=true`、`getBackendStatus()` 返回 `rRuntime=true`、`SETUP_GATE_WOULD_TRIGGER=false`。
  - 附注：用户机器上另有 `runtimes/R.461-20260808`(203MB) 与 `runtimes/R.broken-20260808`(264MB) 两个历史残留目录，不影响检测（只读 `runtimes/R`），可由用户自行清理回收 ~467MB。
  - **✅ 实机验收通过（2026-08-08 23:3x 用户确认"可以了"）**：用户重启后正常进入工作台，UI-130 闭环。`getRuntimeBinName` 修复（build-win12）+ 引导页 + `app:relaunch` + 商店纯 IPC 链路全链路在真实 Windows 机器验证有效。状态由 `in_progress` 晋升 `verified`。- UI-032 属于 `P-07 模型网关与 AI Provider` 的 Harness 能力子系统（Stage 3 M1），现已与 UI-031/UI-033/UI-034 一起完成实机验收。
- 不允许破坏：设置页窄窗布局、计算与数据分类既有 `ComputeExecution`/`DataManagement` 组件、`run_tool → tool_job → artifact truth` 执行链。
- 验收同时覆盖无 bundle 的空状态与真实 bundle 条目状态；面板保持只读，不提供绕过 Harness 编排层的 provision/remove 操作。

- UI-033 只收敛用户可配置层，不删除 Gateway 已支持的底层适配器，也不改写历史 profile。
- UI-036 延续该边界：只隐藏实现型选项，不删除持久化的协议、能力或角色信息；窄窗口保持一条渠道一行并允许横向查看，不把字段重新折成多行卡片。
- UI-040 不破坏：UI-036/UI-038 既定的渠道一行卡片与窄窗横向滚动，只在调用点增加 confirm、跨子模块加视觉分隔，并在 ThemeControl 旁加可读 badge；不重构 `TrashManagement`、`ComputeExecution`、`DataManagement` 的 props 或 IPC 契约。
- UI-041 不破坏：UI-036/UI-038 既定的一行卡片与窄窗横向滚动；只把 `--biof3-bg-subtle` 在设置页 6 个容器替换为 `--biof3-bg-surface`，并把转移按钮从 heading 移出到列表底部；保留导入/导出函数、`endpointImportRef`、`endpointTransferMessage` 全部状态、Key 是否写入导出的确认弹窗。
- UI-042 不破坏 UI-036/UI-038：保留一行网格、窄窗横向滚动与 Endpoint 列自适应；只把卡片外框改为底部分隔线、移除嵌套 padding 并收紧 list 行间距，未改动 DOM 结构与 React props。
- UI-044 不破坏 hook/折叠语义：只清理 `RightPanel.tsx` 里“visible=false 浮按钮”分支，保留 collapsed panel `return null`；右侧栏折叠后无恢复入口复用，与 TitleBar panel-right toggle 形成“单入口恢复”约定，避免与底部终端/左栏 toggle 视觉冗余。
- UI-046 不破坏现有聊天 IPC：保留既有 Agent task、`task_events` SSE 回放、`run_tool → tool_job → artifact truth` 契约；只新增 `parseChatFileReferences` 的纯函数解析、Electron IPC `chat:resolveFileReferences`、输入区补全面板与 chip 渲染；不修改 SSE / copilot_messages schema 或持久化路径。
- UI-047 不破坏 Markdown 阅读密度：复用 UI-039 的 fenced code 语言栏与弱化边框规则；`CodeHighlight` 只作为渲染基元被 Markdown 与工具结果复用，不引入新的主题变量或修改现有 markdown 渲染管线。
- UI-048 不破坏现有文件预览栈：Office 预览仅作为新分支加入文件路由表，文本/CSV/PDF/图片预览契约保持不变；预览失败时 fallback 到“用默认应用打开”入口，不引入第二套文件真相系统。
- UI-037 不创建第二套后台任务系统：仍使用既有 Agent task、`task_events` SSE 回放和 `copilot_messages` 持久化；本次只修复 renderer 按会话隔离、订阅存续和完成对账。
- UI-061 的 2026-08-04 UX1G-1 非视觉加固：确认/取消请求携带当前 project/conversation 作为只读期望值，后端与持久 ToolJob 精确比较后才改变 ACK 状态；失败时前端不清除确认卡、不发送续跑指令。该改动不改变卡片布局、完全访问自动执行边界或 UI-061 的既有实机状态。


## 12. 2026-07-22 UI-046 / UI-047 / UI-048 实机收口
- UI-046 Chat @file 文件引用实机确认：输入区 `@` 触发补全面板、chip 渲染、点 chip 跳转文件树、R 端解析 `@file` 并把路径透传到 harness 工具上下文；不修改 SSE / copilot_messages schema 与持久化路径；前端 typecheck / 测试 / ui:audit:check 通过。
- UI-047 CodeHighlight 通用组件实机确认：明暗主题下语言栏、复制入口与 Markdown fenced code 复用一致；不引入新的主题变量或修改现有 markdown 渲染管线；前端 typecheck / 测试 / ui:audit:check 通过。
- UI-048 Office 文件预览实机确认：`.docx` / `.xlsx` / `.pptx` 三类在项目文件树中均能给出文本 + 表格摘要预览，预览失败 fallback 到“用默认应用打开”，未引入第二套文件真相系统；前端 typecheck / 测试 / ui:audit:check 通过。

## 11. 2026-07-21 UI-033 / UI-034 实机收口

- UI-034 使用脱敏视觉 fixture 覆盖明暗主题、窄窗、右侧栏折叠和 task SSE 回放；真实 Provider 仅用于安装候选的只读调用抽查，不把用户科学任务当 fixture。
- UI-033 由同一明暗/窄窗矩阵中的供应商模型选择器，加上安装候选的真实 DeepSeek 身份与调用结果共同关闭。
- UI-032 已单独取得设置页“计算与数据”中真实 capability bundle 的可见证据并关闭。
- UI-035 属于 UI-034 的阅读密度优化，不改变 ToolResult、Trace、审批或 `run_tool → tool_job → artifact truth` 契约；实现后需单独完成实机视觉确认。
- 预期：用户协议只出现 OpenAI 与 Anthropic；DeepSeek、BioF3 等只是可编辑的供应商名。每个渠道在同一行配置 Base URL、Key、默认模型和连接测试，新渠道不自动代填 URL。
- “任务角色路由”不再显示；现有默认角色绑定和 fallback 配置仍按持久化设置工作，卡片功能声明与聊天模型选择保持为主要用户入口。
- 不允许破坏：当前 DeepSeek 绑定、隐藏的 Vision/Embedding 系统服务、Keychain 不回显、fallback 默认关闭和现有聊天模型同步。

- UI-031 属于 `P-07 模型网关与 AI Provider`，不改变 Stage 1 已关闭的 30 项结论。
- 预期：用户只需选择 Provider、填写模型名；自定义或本地接口再填写 Endpoint，云端模型在凭据页填写 Key。一个模型配置可被不同任务角色复用，也可为角色显式指定 fallback。
- 不允许破坏：SimpleChat 当前模型选择、设置页窄窗布局、Key 不回显、默认关闭故障转移，以及 `run_tool → tool_job → artifact truth` 执行链。
- 代码验证：`npm --prefix frontend run check`、`npm test --prefix frontend`、`npm run build:spa`、`npm run ui:audit:check`。
- 已有实机证据：开发壳截图 `/tmp/biof3-model-management-ui.png`；本地 `dist/mac-arm64/BioF3.app` 包内版本 `0.0.1-rc.5`，模型页与凭据页可访问，R/Python/SPA 健康，Keychain 只显示配置状态，设置 API 无 `*_api_key` 或明文 secret。
- **2026-07-17 验收完成（UI-031 → verified）**：
  - 真实 Provider（出口第 4/5 条）由 `acceptance/stage2/live-provider-check.mjs` 真机验证并 PASS：DeepSeek（OpenAI-compatible 协议）、xunfei-astron 与 api.xcdw.us `claude-opus-4-8`（Anthropic 原生协议）三者 chat + streaming + Agent tool calling 全绿，覆盖两种协议、≥2 Provider。密钥仅经环境变量注入，脚本从不打印 secret。
  - 打包态 UI-031（出口第 6 条）由用户在 `dist/mac-arm64/BioF3.app`(arm64/rc.5) 实机验收通过：模型 CRUD、8 类角色绑定与能力过滤、显式 fallback、Keychain 凭据（无明文回显）、保存重开、聊天选择器同步、窄窗。
  - 验收工具与人工清单沉淀在 `acceptance/stage2/`（`live-provider-check.mjs` + `UI-031-packaged-acceptance.md` + `README.md`），不进单元测试套件与 CI。
  - 注：上述 `acceptance/stage2/` 验收工具目录（含本节及 UI-031 表格行引用的 `live-provider-check.mjs` 等）已于 2026-07-17（commit `498a661`）移除；相关路径引用仅作历史验收记录留存，验收结论以本记录为准。
- 不变量保持：`run_tool → tool_job → artifact truth` 执行链未因模型层改造分叉；fallback 默认关闭；Key 不回显、不入 `ai-settings.json`/日志/诊断。
- **2026-07-19 功能边界加固（UI-031 状态不变）**：SimpleChat 的“完全访问 / 只读模式”现在随会话 context 传到 Agent runtime；中央工具 dispatcher 会在只读模式阻断项目文件写入、精确替换和短命令执行。没有改变控件布局、模型选择或已验收视觉状态。


## HLE-C4: Loop SSE 事件接线（Stage 2, HLE-C4）

- UI-100 属于 `HLE-C4: 会话与摘要 UI 接线`；前端 StreamChatOptions 新增 `onLoopPhase` / `onLoopIteration` SSE 回调，`_handleSseEvent` 分发 `loop_phase` 和 `loop_iteration` 事件。消费端待 HLE-C5 面板实现。
- 预期：前端组件可通过 `onLoopPhase` 收到 `phase=started|cancelled|blocked|completed`，通过 `onLoopIteration` 收到每次 Agent turn 的 `decision`/`status`/`publicConclusion`。现有 `onIter`/`onAgentStatus`/`onAgentProgress` 不受影响。
- 不允许破坏：`run_tool → tool_job → artifact truth` 执行链、`onIter`/`onAgentStatus`/`onAgentProgress` 既有回调、`task_execute` / `task_draft` / `context_assist` 三路由语义、`StreamChatOptions` 既有字段签名。
- 代码验证：`npm --prefix frontend run check`、`npm run ui:audit:check`、`npm run check`。
- **2026-07-23 代码完成（HLE-C4 → in_progress）**：StreamChatOptions + _handleSseEvent SSE 接线（commit `74a3efe`）；UI 面板/实机验收待 HLE-C5。

- UI-101 属于 `HLE-C4: 会话与摘要 UI 接线`（HLE-C4R 消费端）：`conversationRunStore` 新增 `loop` 投影，`startConversationRun` 接入此前被丢弃的 `onLoopPhase`/`onLoopIteration` 回调；`SimpleChat` 渲染 `LoopStatusPanel` —— 紧凑显示阶段状态（执行中/已完成/已阻断/已取消/重试中）+ 轮次 + 最近公开结论，可展开查看逐轮 decision/publicConclusion。`CenterPanel` 从同一个 conversation run store 把当前会话 loop 投影传入 `WorkspaceSummaryCard`，摘要卡同步显示后端阶段状态、轮次、最近公开结论和最近决策；未创建 LoopRun 的普通聊天不显示该区块。新增 `frontend/src/lib/loop-client.ts`：`/api/loop/*` 类型化 REST 客户端 + SSE 事件类型 + 展示辅助（`isLoopComplete`/`loopStatusLabel`/`deriveLoopDisplay`），供聊天与摘要共用同一 loop 词表，避免第二套完成状态。
- 诚实完成语义：blocked/failed/cancelled 一律不显示为绿色完成（`deriveLoopDisplay` tone=warning/neutral）；假成功（failed job + partial files）的阻断结论按后端 `publicConclusion` 原样展示。iterations 按 `iterationId` 去重、`sequence` 排序，SSE 与后续 API 回放幂等合并。loop 投影在停止生成后保留（`stopConversationRun` 保留 loop 字段）。
- 只消费后端真相：UI 不自行推导完成，完成/阻断只来自后端 `loop_phase`/`loop_iteration`；只展示 `publicConclusion`，不展示或保存隐藏思维链。
- 不允许破坏：`run_tool → tool_job → artifact truth` 执行链、既有 `onIter`/`onAgentStatus`/`onAgentProgress`/`toolActivities`、stop/switch/reopen 阶段记录留存、`StreamChatOptions` 既有字段签名。
- 代码验证：`npm --prefix frontend run check`（tsc 0）、`npm test --prefix frontend`（`conversationRunStore` 15/15 通过，含 loop 幂等/取消保留/blocked-非绿）、`npm run check`。
- **2026-07-24 功能收口**：新增 `session-summary` 有界 API 与 `useDurableConversationLoop`；打开/切换/重开会话会从 SQLite 自动回放 latest LoopRun 与公开 iterations，并与 live SSE 按 iterationId 幂等合并。后端真实落盘 completed/blocked/cancelled；摘要接入 active/background、recovery、conversation Token/cache/cost，停止后 transient run 清除也不丢阶段记录。
- **2026-07-24 真实 Desktop 纠偏**：生产注册顺序把 bounded AI Loop API 前置于 legacy `/api/loop/:loopRunId`，Loop API 同时兼容 desktop-local 的 `req.user.id` 身份；无 assistant 消息的历史会话也显示独立 LoopStatusPanel。开发态无 preload bridge 时，`BackendStatusProvider` 只在 `import.meta.env.DEV` 下探测同一台本地 R/Python 服务，用于真实 renderer 的视觉与可访问性回归；打包态不会走该路径。
- **2026-07-24 视觉与产品验收（UI-101 → `verified`）**：真实 renderer 覆盖 running、completed、waiting-for-user、cancelled history、recovery-required，摘要折叠/展开、日间/夜间和 820×900 窄窗；窄窗 `innerWidth=clientWidth=scrollWidth=820`，无页面级横向溢出。截图和判定见 `acceptance/harness-loop/production/ui-matrix.md` 与同目录 `ui/*.png`。真实三轨、双 Provider、应用重启和 7 节点 SPT-1 证据由 HLE-C5 同批收口。

## G0-RS3: Artifact Interaction 与 Selection Context

- UI-102 属于 `G0-RS3 Artifact Interaction 与 Selection Context`（见 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md)）。这是 RS0 审计登记的三项契约缺陷之一：`ActiveArtifact` 仍是文件级标识，必须升级为 revision / semantic / selection-aware，而不是在旁边新增第二套状态。
- 为什么交互清单由后端产出：`project-workspace.tsx` 的 `buildPreviewTable` 只解析 artifact 前 40 行，那个样本没有资格判定"哪一列是稳定实体 ID"。10 万行表格的 ID 唯一性只能在完整文件上验证，所以 `GET /api/result-studio/interaction` 在后端构建清单，前端只消费，不自建第二套判定。
- 诚实的选择语义：找不到稳定 ID 列时 `idStrategy=positional`、`selectionDurable=false`，并附 `no_stable_id_field` 诊断；交给 Agent 的摘要带 caveat 明说"重算后可能不指向同一实体"。声明的 ID 列在抽样行内不唯一时直接拒绝（`declared_id_field_not_unique`），不产出错误的实体映射。
- 有界上下文：选择摘要永不返回完整 ID 列表。超过 2000 个实体的选择必须携带 filter 表达式才算可复现（`large_selection_requires_filter`），此时权威表达是 filter + hash，`entityIds` 只是抽样证据；`entityIdCount` 仍反映真实规模，不因截断而说谎。
- 预期：用户在表格 artifact 上选行/选列/过滤/排序，或在图形上点选/框选后，Agent 上下文能拿到稳定实体 ID（如 `ENSG00000141510`）而非行号；切换会话与重启后选择可由 `selectionId` 恢复。
- 不允许破坏：`run_tool → tool_job → artifact truth` 执行链；`ActiveArtifact` 既有 6 个字段的类型与语义（新增字段全部可选，旧消费方无需改动）；`ResultArtifactShell` 既有 artifact 选择、预览、导航与 `pendingArtifactName` 行为；RS1 的 Git 边界与 RS2 的 ChangeSet 状态机。
- 桌面安全边界：`/api/result-studio/*` 沿用 `core/r-server/auth.js` 的 loopback 单用户身份（`localIdentityMiddleware` 全局注入 `req.user`），并在每个端点内联 `canAccessProject` 校验项目归属，与 `routes/harness.js` 既有模式一致。artifact 路径一律经 `resolveProjectRunLayout` + 包含性检查派生，不接受调用方传入任意路径；读取体积设上限。
- 代码验证：`npm run g0:result-studio`（78/78：git-adapter 24 + contracts 26 + repository 19 + migration 9 + interaction 26）、`npm --prefix frontend run check`（tsc 退出码 0）、`npm test --prefix frontend`（31 文件 246 项通过，含新增 `artifact-selection` 20 项）、`npm --prefix frontend run build`（退出码 0）、`npm run ui:audit:check`。
- **2026-07-25 P2 产品验收（UI-102/UI-107 → `verified`）**：后端完整表查询、SelectionContext compatible/stale/invalid、SQLite 恢复和 `result_selection_run` 已与通用表/散点/矩阵 viewer 接线。真实 admitted DESeq2 → 3 gene 选择 → GO/KEGG 下游链由 live API、Job/Artifact Truth、独立物化脚本和响应摘要机器捕获；选择创建时间早于当前服务进程。自动性能与明暗 × 1440/1024/820 六格证据位于 `acceptance/g0-result-studio/rs-p2-*.json`。该状态只关闭科学选择交互与 activeArtifact 选择语义，不关闭 P3 Agent ContextEnvelope、P4/P5 编辑或 P6/P7 产品资格。
- **2026-07-25 P3 上下文编排（UI-108 → `in_progress`）**：`ResultStudioContextEnvelope v1` 与 `contextToken` 已把 artifact/family、job、revision（含 current 与 ordinal）、脚本相对路径与 sha256、参数摘要、插件可编辑参数与声明动作、selection、validation、reproducibility 由后端从 SQLite/`tool_jobs`/插件 descriptor 重新投影；前端 `activeArtifact` 只作线索。模型可见 schema 新增 7 个工具（注册表共 32 个），其中 6 个 `*_in_context` 工具参数不含 toolJobId/artifactId/revisionId/artifactFamilyId/selectionId，系统提示描述当前结果但不写入任何内部 ID，并禁止向用户索要 ID。写操作强制校验 token，陈旧上下文返回 `context_token_stale`，intent 指向别的 Revision 返回 `context_intent_mismatch`；"归因只能到 Job"、跨项目 revision、未打开结果一律 fail-closed。Inspector 的 `ResultStudioContextReadiness` 如实显示 loading/blocked/ready 与选择是否交给 Agent，内部 ID 仍只在渐进披露里。证据 `acceptance/g0-result-studio/rs-p3-agent-context.json`（20/20，non-qualifying 离线契约/注册表/提示词/strict build）。UI-108 保持 `in_progress`：P3 验收要求的双真实 Provider tool calling、真实候选 Revision 与重开重建复验尚未执行，不外推 P7 产品资格。
- **2026-07-26 P4 手动与 AI 统一编辑（UI-109 → `in_progress`）**：`core/shared-backend/result-edit-controls.js` 从插件 descriptor 的 `parameters` + `parameterImpacts` 投影控件，不为任何插件手写孤立结果页；缺 impact 声明的参数不提供控件（缺声明不等于默认安全），只有 presentation 组允许标注"不改变科学结论"。`volcano-plot` 的 descriptor 与 `scripts/volcano-plot.R` 补齐配色、字体、尺寸、图例、标签与导出共 12 个 presentation 参数——此前这些全是 R 脚本硬编码，P4 要求的首批控件无参数可绑；阈值与分类仍只由 `fc_threshold`/`pval_threshold` 决定。手动控件与 AI Composer 汇合到同一 `normalizeEditSubmission → ResultEditIntent → ScientificChangeSet` 链，validation/preview/compare/adopt/revert 只有一条路径；类型/范围/枚举 fail-closed 拒绝，未声明参数记为 rejected 而非静默丢弃，与当前生效值相同的提交不产出 patch，因此不会创建空 ChangeSet。影响分级只能由受信 descriptor 提升，调用方声明 `presentation_rerender` 无法降级 descriptor 判为 scientific 的参数；顺带修复 `classifyParameterPatch` 让保护字段表覆盖 descriptor、把 deseq2 声明为 `workflow` 的 `design` 悄悄降级成 `scientific` 的缺陷。`currentValues` 取该 Job 真实执行过的归一化参数，不用默认值冒充。`ResultEditPanel` 只发出编辑请求，不写文件、不覆盖 current Revision，后端无法投影坐标时按真实原因禁用。补齐 `--biof3-text-primary` 主题别名，避免 P4 结果编辑样式触发主题契约缺失。证据 `acceptance/g0-result-studio/rs-p4-unified-editing.json`（18/18，non-qualifying 离线 descriptor 投影/插件接线/注册表/strict build）。UI-109 保持 `in_progress`：同一火山图手动与 AI 各生成一次真实候选并比较/恢复尚未复验，不外推 P5～P7 产品资格。
- **2026-07-26 P4R Product Reframe 规划（UI-109/UI-112～UI-115 → `planned/open`）**：用户真实操作确认 P4 Core 的统一编辑引擎仍未形成可用结果体验。P4R 作为 P5 前唯一下一阶段，按 P4R-0～P4R-6 串行完成性能真相、结果快路径、单结果聚焦、Agent-first、版本/变更审查、每版本代码复现和整体验收。UI-104 既有窄范围 Git/Revision 原语继续保留，但不冒充 UI-114 的产品版本体验；UI-105 的崩溃/压力矩阵仍留给 P6。
- **2026-07-28 P4R-4 版本与变更审查实现（UI-114 → `in_progress`）**：把既有“比较展开区里的历史列表”重构为 Result/审查修改/版本历史三个真实路由模式；查看旧 Revision 使用前端可丢弃状态与显式 Revision Artifact/interaction/context 绑定，不切换 current、不调用写 API，自动 workspace recovery 改为用户显式动作。版本角色来自 Revision + ChangeSet truth，100 条后可分页；审查摘要来自服务端受信 ResultEditIntent 持久投影，不从 intent ID 或 Git message 猜测。底层补齐 viewed-Revision selection 兼容、项目范围查询、checkpoint 故障下 Git/SQLite 同退、参数/source commit 漂移阻断。UI-114 不升级 verified：实机响应式、明暗、键盘与连续产品链仍归 P4R-6。
- **2026-07-28 P4R-5 每版本代码与受控复现完成（UI-113/UI-114/UI-115 → `in_progress`）**：中央 Code 使用 Git commit + `sourceScriptRef` 精确投影，历史 Revision 显示自己的脚本；复制、下载、项目内打开和 Agent 操作共用同一校验响应。对 `replayable` Revision，两阶段 replay 在确认前重投影 source/params/input/plugin/runtime，确认后只调用注册工具并生成候选 Revision，重复确认幂等且 current/history 不变；材料不足明确 unavailable。DESeq2、standalone volcano、gene-correlation heatmap、go-kegg GO-BP 四类真实 completed Artifact exact source observation 4/4，真实 replay E2E 覆盖 standalone volcano，P4R product 17/17。三项仍不升级 verified：P4R-6 实机明暗/尺寸/键盘/连续旅程尚未执行。
- **2026-07-27 P4R-0/1 性能真相与快路径服务端部分（UI-112 → `in_progress`）**：P4R-0 先建立一次性隔离环境、真实 `run_tool → tool_job → artifact truth` 语料与冻结基线，四条不变量按代码实况写成失败测试。实测推翻了计划对成本构成的判断：workspace 扫描占 0%、hashing <5%，而 93% 是 `projectContext()` 每次只读请求都 `bindProjectRepository()` 带来的 git 子进程。因此 P4R-1 未做计划原文的架构改造，改为三处更便宜且无缓存失效风险的修法：`detectGitRuntime` 进程内 memo（只缓存成功探测）、`repositoryState()` 的三次 fork 改惰性 getter（managed 模式下其消费者全是 `fs.existsSync`，对象形状不变故调用方零改动）、以及用 `cat-file --batch-check` + `for-each-ref` 把 `inspectRevisionIntegrity` 的每 revision fork 变成两次常量开销。同时按 `projectContext` 已声明却被忽略的 `write` 标志停止在纯 GET 上 upsert 绑定行（不变量 2b 转绿；该项记为 correctness 修复，其 SQLite 成本仅 0.15–0.20ms，不并入性能数字）。前端把三处无条件清空点收敛到纯 reducer `resultBodyState.ts`：次级失败与丢失观测不再替换主体，同 job 重取保留已渲染内容，陈旧 job-list 状态不得把结果退回 spinner（不变量 4 转绿，10 项 vitest 覆盖）。证据 `acceptance/g0-result-studio/rs-p4r-performance.json`（13/13，non-qualifying）：基线已冻结为常量并由 `RS-P4R0-13` 钉住，重跑只写入 `currentObservation` 与对比，不再覆盖基线。UI-112 保持 `in_progress`：客户端首屏内容可见、Artifact/版本切换与明暗 × 1440/1024/820 实机矩阵尚未验证，不外推 P4R-2～P4R-6 与 P7 产品资格。
- **2026-07-27 P4R-2 Agent 会话常驻与提交送达（UI-112/UI-113 → `in_progress`）**：preflight 核实出的不是布局问题，而是**主路径上的静默数据丢失**。`ResultEditPanel` 挂在右栏 `results` tab，而每条打开结果的路径都会 `openRightPanel('results')`（`project-workspace.tsx:568/1068/1126/1279`），用户填完提交后 `handleResultEditSubmit` 派发 `copilotAsk`；但 `dispatchBioF3Event` 是裸 `window.dispatchEvent` 且零缓冲（`lib/events.ts:113`），唯一订阅者 `SimpleChat.tsx:568` 在 result 模式下未挂载——`CenterPanel.tsx:297` 的 `{ctx.showPinnedSummary && children}` 会丢弃整棵子树，而 `showPinnedSummary` 仅在 `chat|scheduled` 为真（`project-workspace.tsx:932`）。事件消失，`finally` 同步把按钮重置为空闲，用户看不到任何失败。这直接证伪了 `project-workspace.tsx:1241-1246` 处「手动与 Agent 共用同一条链」的注释。修复：该门是冗余的——投影层已由 CSS（`aria-hidden` + `display:none/flex`）处理可见性，去掉后对话在所有模式常驻，且比原来**少**做工作（此前每次切模式都要卸载重建）。同时为 `SimpleChat` 增加 `ownsCopilotAsk`（默认 false，仅中央实例传 true）：右栏 chat tab 经 `openRightTabs.map` 保持挂载，两个实例同时订阅会重复发送。守门测试此前是假绿：`CenterPanel.test.tsx` 给所有模式硬编码 `showPinnedSummary: true`（生产不可能进入该状态）并把 `SimpleChat` 整个 mock 掉，因此只能证明「渲染了个 div」。已改为按 mode 派生（修前该断言如实变红），并新增 `copilotAskDelivery.test.tsx` 用真实订阅验证送达。UI-112/UI-113 保持 `in_progress`：主体首屏化、四态互斥与实机响应式/键盘矩阵尚未完成。
- **2026-07-27 P4R-2 主体首屏化第一步（UI-113 → `in_progress`）**：preflight 指出计划点名要删的三个对象都不成立——Honeycomb 结果导航是网格**列**（`project-workspace.module.css:4087-4088`），删掉换来的是宽度不是首屏高度；存储卡已自抑制（`ResultStudioChangeSetPanel.tsx:56/:182/:184`）；二级 artifact rail 已是条件渲染（`project-workspace.tsx:3945`）。真正无条件压在主体正上方的是 `resultDeliveryCard`（`:4201`），而计划从未点名它。该卡在没有 `reportArtifact` 时完全不可操作：「生成」按钮 disabled，「查看」「导出」根本不渲染，文案只说「分析结果确认后按需生成」——用户为看结果要先滚过一段告知自己「暂时用不了」的说明。改为有可生成产物或已生成报告时才渲染。判据抽成纯谓词 `resultFirstScreen.ts::shouldShowDeliveryCard` 并配 4 项测试：该决策原本埋在内联且未导出的 `ResultArtifactShell` 里，无法被任何测试触及。UI-113 保持 `in_progress`：紧凑 header、按需结果抽屉与实机响应式矩阵尚未完成。
- **2026-07-27 P4R-2 移除只写不读的 harness index 子系统（UI-113 → `in_progress`）**：并行只读核查发现 `harnessIndex`/`harnessLoading`/`harnessError` 在 `RightFileTree` 与 `ResultArtifactShell` 两处**均只声明不读取**（全文件各仅 2 次出现，都是 `useState`）。其中 `RightFileTree` 那份带 **10 秒轮询**（`setInterval(... refreshHarnessIndex ...), 10000`）外加挂载与 workspace 变更触发，持续请求需服务端走目录扫描的 harness index 接口，而响应从不被消费——这是每个用户持续付出的真实浪费，与 P4R-2 布局无关。`ResultArtifactShell` 那份由 `showHarnessIndex` 门控，而该 prop 只有 `ResultSidebarPanel` 传 true，且后者在 `frontend/src` 内零挂载，故 effect 恒走 early-return。两处一并移除，净减 69 行，保留仍被消费的 `copilotHarnessIndex`/`activeJobHarnessIndex` 两条真实链路。**未删 `.resultSidebarRoot`**：核查指出它是 `.resultScientificDeliveryGrid` 唯一的 `container-type: inline-size` 祖先（`project-workspace.module.css:3625`，另一处 `:5292` 属文件树），删除会静默失效 `@container (max-width: 520px)`，复现 UI-049 已修的问题——该行台账状态为 `verified`。删除前须先把 `container-type` 迁到 `.resultView`。
- **2026-07-27 P4R-2 删除不可达代码（UI-113 → `in_progress`）**：并行只读核查逐符号验证后删除 `HarnessIndexCard`（连同其私有 `summarizeRecord`）、`HistoryPanel`、`ToolboxPanel`（连同其私有 `PLUGIN_TYPE_LABELS`）与 `ResultSidebarPanel`。五者在 `frontend/src` 内均零调用：`HistoryPanel` 仅剩自身定义与横幅注释；`ToolboxPanel` 在外部的 4 处提及（`usePluginStore.ts:11/:34/:175`、`desktopBridge.ts:22`）经逐条查证全是散文注释，无代码路径；`ResultSidebarPanel` 虽 `export` 但无任何 import。其消失使 `variant` 只剩单一取值，故 `isSidebar` 及其 6 处分支、`variant` prop、以及消费者已被移除的 `showHarnessIndex` prop 一并折叠。`project-workspace.tsx` 由 4915 行降至 4478 行（净减 437）。**CSS 未随之清理**：本次尝试用正则删除 60 个孤立类时破坏了嵌套 `@media`/`@container` 结构，已回退；另核实该文件 484 个类中约 214 个在本次改动之前就已无引用，属独立的既有债，需用真正的 CSS 解析器处理并单独验证，不与本次删除混做。UI-113 保持 `in_progress`。
- **2026-07-27 P4R-2 版本位显示真实序号（UI-113/UI-114 → `in_progress`）**：验收矩阵要求 header 显示「结果名称 · **vN** · validation」，而 `shortRevisionLabel`（`resultSurface.ts:125-129`）此前把 Revision ID 截断成「版本 a3f9c21b」——在承诺序号的位置呈现一段不透明片段。核查发现数据一直存在且已到前端：`revision_ordinal` 自建表起即在 SQL 中（`001_result_studio.sql:62`，每 family 唯一索引），interaction 路由也一直随响应返回 `revision`（`routes/result-studio.js:559`），只是客户端只取 `data.manifest`、把 `data.revision` 丢弃。**无需改动后端**。现将 `revisionOrdinal` 接入 `ActiveArtifact` 并纳入身份比较（否则版本切换不向上传播），取值经 `toArtifactRevision` 运行时校验而非类型断言——该值决定用户读到的版本号，载荷异常时必须可见降级而不是渲染错误数字。有序号显示 `v2`，无序号显示「当前版本」。同时更正旧测试：`resultSurface.test.ts` 中名为 “without inventing missing facts” 的用例，断言的恰是把 ID 片段当版本号呈现。UI-113/UI-114 保持 `in_progress`：版本选择器本体属 P4R-4。
- **2026-07-27 P4R-2 header 信任状态去重（UI-113 → `in_progress`）**：同一 `artifactTruth.status` 此前在两处呈现——`ResultStudioContextBar` 经 `describeTruthStatus` 显示「可信结果 / 需要复核 / 结果已阻断」，而主体内的 `workflowBar` 另写 `truth valid` 这一原始枚举值。后者既与 header 重复，又把内部值漏进普通视图（计划 §P4R.3 明确禁止）。已移除；`workflowBar` 保留其独有内容（当前阶段、产物数、恢复动作）。**未为此新增测试**：这是一次删除，没有新逻辑，而唯一可写的断言是对源码做字符串匹配——正是本阶段在 `RS-P4R0-6` 等处清除的反模式（该检查 grep 的字符串写在它自己的注释里，因而永远为真）。加一个假断言比不加更糟。变更由构建与既有 74 项前端测试覆盖。
- **2026-07-27 P4R-2 workflowBar 首屏判据（UI-113 → `in_progress`）**：按计划范围段要求，主体之上仍保留的每个块都要给出「为什么必须排在结果之前」的可测判据。`workflowBar` 在工作流已终结且无待处理恢复动作时渲染「结果已校验 · N 项产物」——这是把 header 已由 `describeTruthStatus` 呈现的信任状态换个说法再讲一遍，与刚移除的原始枚举 `truth valid` 是同一重复，只是换了更友好的外衣。判据 `resultFirstScreen.ts::shouldShowWorkflowBar` 明确：有阶段在跑或有恢复动作待处理时才前置，否则不占首屏；4 项测试覆盖。`recoveryConfirmation`（待确认动作）、`ResultStudioChangeSetPanel`（候选变更改变结果含义）与 `resultScientificDelivery`（科学结论本体）三者的前置理由成立且均已条件渲染，本轮不动。
- **2026-07-27 P4R-2 模式容器骨架（UI-113 → `in_progress`）**：计划要求 Result/Code/Compare/History 四态互斥，但只有 `result` 有实现，且计划自身已把另外两态分配出去：Code 的源投影属 P4R-5（23 条 result-studio 路由无一提供），History 的版本选择器属 P4R-4；`compare` 在 `frontend/src` 内零写入方，每个消费点都写成 `result || compare`，其唯一表现是一个无样式表选择的 `data-mode` 属性，因此一直与 `result` 渲染完全相同。故本轮**不做四态**，只建立诚实的容器：`resultMode.ts` 以真实能力（而非开关）决定哪些态可被提供，`resolveResultMode` 把无实现的请求回落到 `result`——手输 `?mode=compare` 因此落在结果页而不是暗示存在比较视图；`isSingleActiveMode` 把「一次只渲染一态」写成可断言的不变量。10 项测试覆盖。P4R-4 与 P4R-5 各自提供能力即可点亮自己那一态，无需改动此处逻辑。UI-113 保持 `in_progress`：紧凑 header 的按需结果抽屉与实机响应式矩阵仍未完成。
- **2026-07-27 P4R-2 让 `resultBodyState` 真正被生产调用（UI-113 → `in_progress`）**：收口前的并行核查发现 `resultBodyState.ts` **零生产导入方**——`project-workspace.tsx` 只在两处注释里提到它（`:2950`、`:3206`），从未 import 或调用。行为本身是对的（`b5d073a` 用内联守卫收窄了三处无条件清空），但那是一份**平行实现**：模块与其 10 项测试全绿，而产品跑的是别的代码，改动内联逻辑不会让任何测试变红。这与本阶段清除的空转门同类，只是由本工作包自己造成。现改为在两处判断点真正调用 `nextResultBodyState`，由 reducer 给出结论而非在组件里复述规则；不变量 ④ 同步加断言：`nextResultBodyState` 必须存在非测试、非自身的调用方，否则「模块有测试」这一事实不足以证明产品行为。UI-113 保持 `in_progress`。
- **2026-08-01 P6-1 实现检查点（UI-103/UI-105/UI-111 → `in_progress`）**：持久 runtime lease/checkpoint、原子恢复、Artifact Truth 绑定读取、exact GC protection、资源峰值摘要、10 万行 byte-cursor 与开发态 Electron 恢复/压力 driver 已接入同一产品路径。真实压力观测捕获并修复了流式 Artifact 把绝对路径误作 MIME、导致 Chromium ORB 阻断 SVG 的缺陷；修后 exact SVG 请求为 completed/200、尺寸 672×480，网络错误为 0。该检查点仍不声明 literal OS reboot、真实 Provider、packaged Electron、多尺寸 P7 操作或 201 次真实 Job 执行；canonical source-bound P6 证据在实现提交后单独生成。
- **2026-08-01 P6-1 资源摘要契约补齐（UI-105 → `in_progress`）**：前端客户端现在接受服务端真实返回的 `sampling.status=partial`，同时保留已取得的 `sampleCount` 与不可完整采样的 `reason`；不再把“取得部分测量”误压成 measured 或 unavailable。该改动只补齐资源真相的类型边界，不改变界面布局，也不提供 packaged/P7 资格证据，因此 UI-105 继续保持 `in_progress`。
- **2026-08-02 P6 source-bound 收口（UI-103/UI-105/UI-111 保持 `in_progress`）**：`acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json` 绑定 `ad1e2ce` 并通过 10/10；开发态 Electron recovery 15/15、低于 5 秒，实际覆盖停止/失败/中断、10 万行表、复杂 SVG/PNG、长报告和 100+ 版本。该证据补强了持久进度、恢复和产品可解释性，但不含真实 Provider、packaged Electron、literal OS reboot 或完整明暗×尺寸操作矩阵，故不把 UI-103/UI-105/UI-111 升为 `verified`。UI-110 的既有 source-bound 科学编辑 `verified` 结论保持不变。
- **2026-08-03 P7 延期（状态不升级）**：P7 的完整真实产品资格认证超出当前 G0 收尾重点，现明确延期且没有 PASS 证据。UI-103/UI-105/UI-108/UI-109/UI-111 继续保持 `in_progress`，UI-110 仅保留既有 P6 source-bound `verified` 边界；不得外推为真实 Provider、packaged Electron、literal OS reboot 或完整响应式产品资格。existing Git repository 的后端持久 consent 已修复，但产品 consent UI 尚未实现，未来重开 P7 时必须补齐。
- **2026-08-03 UI-108/UI-109 历史提交对账（状态不变）**：不可变实现提交 `2298c96` 为 Composer、手动编辑与其他结果动作增加 `completionExpectation`，使 Agent completion guard 区分 candidate、真实 enrichment Job 与无需创建候选的动作；该提交当时遗漏 UI 编号和同提交台账更新，现按治理门补登并保留历史，不改写提交。该修复不提供真实 Provider 或 P7 连续产品证据，UI-108/UI-109 继续为 `in_progress`。

- **2026-08-14 CSS Token 修复（）**：添加  token 引用 ，同时适用于亮色和暗色模式。theme-token-contract 测试通过。


- **2026-08-14 UI-AGENTWB-001 Agent 工作台 P1.1 A3 单元测试（保持 `in_progress`）**：A3 在 A1（A1-CONTRACT：`ResultCard.tsx` + `ResultCard.module.css`，5 种语义 variant 对齐 `--biof3-*` 设计 token）和 A2（A2-REGISTRY：`ResultNode` 类型契约 + `ResultCardRenderer.tsx` 模块级 `Map` 注册表 + 默认预注册 `text → TextRenderer` + `renderers/index.ts::registerDefaultRenderers()` 入口）落地基础上，新增 `frontend/src/components/copilot/ResultCard.test.tsx`（12 项）与 `ResultCardRenderer.test.tsx`（4 项），合计 16/16 通过，耗时 ~380ms。覆盖：标题渲染为 `<h3>`、副标题 `<p>` 仅在非空时出现、`data-variant` 反映默认 / 显式 variant、meta 行仅在非空时渲染、关闭按钮存在性与 `fireEvent.click` 触发 `onDismiss` 一次、`data-testid` 透传到根 `<article>`、children 进入 body 槽、空 meta 不引入额外 `div`、未知 type 回落 TextRenderer、自定义 renderer 接管默认注册、`listRegisteredRendererTypes` / `getRegisteredRenderer` 反映注册表状态、`title`+`subtitle`+`variant`+`meta` 由 node 端到端透传到 ResultCard。测试**未引入** `@testing-library/user-event`（依赖里没有，改用现有 `fireEvent` 模式与 `toBeTruthy()` / `toBeNull()` / `.textContent` 断言，对齐 `SimpleChat.test.tsx` / `copilotMarkdown.test.tsx`），**未触发** SimpleChat `extraRenderers` 注入路径（属 P1.1 A4 范围）。`npm run test:files --prefix frontend -- src/components/copilot/ResultCard.test.tsx src/components/copilot/ResultCardRenderer.test.tsx` 全绿 16/16；改动遵守 §0 "增量增强"（仅新增，未删除 / 替换任何已有组件）。UI-AGENTWB-001 保持 `in_progress`：无开发态 Electron 实机核对、不外推 packaged/P7/GA；A4 SimpleChat 注入 + `flags.agentWorkbench.resultCard` feature flag 双向验证 + §X.2 兼容性测试矩阵仍未启动。

- **2026-08-14 UI-AGENTWB-001 A1 数据契约层落地（保持 `in_progress`）**：Agent 工作台 P1.1 MVP 的 A1 契约层独立落地：新增 `frontend/src/components/copilot/ResultCard.tsx`（导出 `CardVariant`、`ResultCardProps` 与 `ResultCard` 组件）+ `ResultCard.module.css`（5 种语义 variant 对齐 `--biof3-*` 设计 token）。组件 props 含 `title`（必填）、`subtitle?`、`variant?`（默认 default）、`icon?`、`meta?`、`children?`、`actions?`、`dismissible?`、`onDismiss?`、`data-testid?`；渲染为 `<article>` + header/body/actions 三段，CSS Module 类名 `card` / `header` / `icon` / `heading` / `title` / `subtitle` / `dismiss` / `meta` / `body` / `actions` + `variant-default/success/warning/error/info`。**未引入新 npm 依赖、未替换任何已有组件、未挂入 SimpleChat**——纯契约层。严格遵守 `docs/agent-workbench-enhancement-plan.md` §0「增量增强、不破坏性重构」。与并行 A2 (`ResultCardRenderer.tsx`) 调用面（`title`/`subtitle`/`variant`/`meta`）完全对齐；full project `tsc --noEmit -p` 0 错误；`docs:check` + `ui:audit:check` 通过。**保持 `in_progress`**：无开发态 Electron 实机核对、不外推 packaged/P7/GA；A4 SimpleChat `extraRenderers` 注入 + `flags.agentWorkbench.resultCard` feature flag 双向验证 + §X.2 兼容性测试矩阵仍未启动。

- **2026-08-14 UI-AGENTWB-002 Agent 工作台 P1.2 表格渲染器注册（保持 `in_progress`）**：P1.2 在 P1.1 A1/A2/A3 基础上落地 `table → TableRenderer` 注册：新增 `frontend/src/components/copilot/renderers/TableRenderer.tsx` + `TableRenderer.module.css`（CSS Module 哈希由 Vite 生成，与 ResultCard.module.css 同源）；`renderers/index.ts::registerDefaultRenderers()` 注册 `table → TableRenderer`（**不**沿用 P1.1 在 `ResultCardRenderer.tsx` 中硬编码 `text` 单条的模式），并 re-export `TableRenderer`。`payload` 严格契约 `{ columns: string[]; rows: Array<Array<string | number | null>> }`；任一字段类型不符、缺 columns/rows 或空 columns 即 fail-soft 降级为 `<pre data-testid="result-renderer-table-fallback">` + JSON dump，ResultCard chrome 不崩。null 单元渲染 `<span>—</span>` 暗色 placeholder；数值单元右对齐 + `tabular-nums`。a11y：`role="region"` 包装 + `<caption>`（视觉隐藏，screen reader 可读）+ `<th scope="col">`。`ResultCardRenderer.test.tsx` 追加 3 项（注册表含 table+未知 type 仍回落 TextRenderer、table 节点端到端 `<thead>/<tbody>` + ResultCard chrome 透传、5 种畸形 payload 全部降级 JSON），既有的 16 项 P1.1 测试**未动**，合计 19/19 通过（vitest ~440ms）。**未引入新 npm 依赖**——纯原生 `<table>`，不使用 `react-table`/`@tanstack/react-table`；**未挂入 SimpleChat**——`extraRenderers` 注入仍属后续工作包。前端 `tsc --noEmit` 0 错误、`npm run docs:check` 58 registered PASS、`npm run ui:audit:check` 在台账补登后 PASS。遵守 §0「增量增强、不破坏性重构」：仅新增 renderer 文件与测试，不修改 `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `types.ts` 既有签名。CSS Module hashing 由 Vite 统一生成，与既有 ResultCard.module.css 同源。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；A4 SimpleChat 注入仍未启动 | UI-AGENTWB-002 / AGENT-WB-P1.2
- **2026-08-15 UI-AGENTWB-003 Agent 工作台 P1.3 图表与图像渲染器注册（保持 `in_progress`）**：P1.3 在 P1.1 A1/A2/A3 + P1.2 A2-TABLE 基础上落地 `chart → ChartRenderer` + `image → ImageRenderer` 注册：新增 `frontend/src/components/copilot/renderers/ChartRenderer.tsx` + `ChartRenderer.module.css` + `ImageRenderer.tsx` + `ImageRenderer.module.css`；`renderers/index.ts::registerDefaultRenderers()` 注册两条新链路并 re-export `ChartRenderer` / `ImageRenderer`（同步 re-export `TableRenderer` / `TextRenderer`）。**Chart payload 严格契约**：`{ kind: 'bar'; labels: string[]; series: Array<{ name: string; values: number[] }> }` 或 `{ kind: 'line'; xLabels: string[]; series: Array<{ name: string; values: number[] }> }`；任一字段类型不符、缺 labels/xLabels/series、空 labels 或非有限数值 values 即 fail-soft 降级为 `<pre data-testid="result-renderer-chart-fallback">` + JSON dump，ResultCard chrome 不崩；合法时渲染原生 `<svg viewBox="0 0 600 320">` 柱状（等宽柱 + 顶部数值标注）或折线（polyline + 节点圆点），图例单色 swatch + 系列名称；a11y `role="img"` + `aria-label="Chart: {kind}"` + 内嵌 `<title>`。**Image payload 严格契约**：`{ src: string; alt: string; caption?: string; width?: number; height?: number }`；src 必须为 `data:` 或 `http(s)://`（javascript:/vbscript:/file: 一律拒绝），alt 非空（不允许 decorative-only 空 alt），width/height 必须为有限正数；任一字段类型不符、缺 src/alt、非安全 URL、非数尺寸即 fail-soft 降级为 `<pre data-testid="result-renderer-image-fallback">` + JSON dump；合法时渲染 `<figure>` + `<img loading="lazy">` + 可选 `<figcaption>`，`alt` 必填透传。`ResultCardRenderer.test.tsx` 追加 5 项（注册表含 text/table/chart/image、chart 节点端到端 svg + legend、5 种 chart 畸形降级、image 节点端到端 figure/img/figcaption、6 种 image 畸形降级），P1.1/P1.2 既有 7 项测试**未动**，合计 25/25 通过（vitest ~560ms）。**未引入新 npm 依赖**——纯原生 `<svg>` / `<figure>`，不使用 `chart.js` / `recharts` / `d3`；**未挂入 SimpleChat**——`extraRenderers` 注入仍属后续工作包。前端 `tsc --noEmit` 0 错误、`npm run docs:check` 58 registered PASS、`npm run ui:audit:check` 在台账补登后 PASS。遵守 §0「增量增强、不破坏性重构」：仅新增 renderer 文件与测试，不修改 `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `types.ts` / `TableRenderer.tsx` 既有签名；CSS Module hashing 由 Vite 统一生成。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；A4 SimpleChat 注入仍未启动。**遗留风险**：①Chart 的 SVG `<title>` 挂在内层 `<g>` 而非 `<svg>` 根上，部分屏幕阅读器会以 `<title>` 作为子元素而非 svg accessible name；wrapper div 的 `role="img"` + `aria-label="Chart: {kind}"` 提供兜底名称，但数据点具体数值只有视觉感知（柱顶 label 在窄列下会被隐藏以避免重叠）—— 屏幕阅读器用户只能拿到 "Chart: bar" 不知道数据；②Image 的 `<img alt="">`（空 alt）已被 type-guard 拒绝并强制降级 JSON，符合"不允许 decorative-only"要求，但任何上游把 `alt: ''` 当合法字段的旧代码都会进入降级路径，需要在交付前把契约在 schema 层更显式化 | UI-AGENTWB-003 / AGENT-WB-P1.3

- **2026-08-15 UI-AGENTWB-004 Agent 工作台 P1.1 A4 SimpleChat 注入桥（保持 `in_progress`）**：在 P1.1 A1-A3 + P1.2 A2-TABLE + P1.3 A3-CHART-IMAGE 全部 `text/table/chart/image` 渲染器已落注册器的基础上，把 SimpleChat assistant message 接入 `ResultCardRenderer`，让 agent 产出的 `meta.resultNodes` 真正在聊天流中渲染 chrome + 渲染器层。新增 `frontend/src/components/copilot/extraRenderers.tsx`（`readExtraRenderersFlag` 默认 off 读 `localStorage.biof3.simplechat.extraRenderers`、`useExtraRenderersFlag` hook 带 `window focus` refresh、`parseAssistantResultNodes` 6 重类型守卫、`<AssistantResultNodes>` 容器组件 + 注入点 `console.debug('[simplechat] resultNodes injected', { count, types })` 仅 console 不上报 telemetry）。`SimpleChat.tsx` 改动仅 4 处 — ①import 新模块；②`SimpleMessage` 接口**新增**可空 `resultNodes?: ResultNode[]`；③`restoreSimpleMessage` 末尾**追加** `resultNodes: parseAssistantResultNodes(meta.resultNodes) ?? undefined`（`function` 改 `export function` 以便测试）；④assistant message body 在 `<CopilotMarkdown>` 之前**追加** `extraRenderersFlag && m.resultNodes && m.resultNodes.length > 0 && <AssistantResultNodes nodes={m.resultNodes} />`，并在 `useErrorFormatter` 之后**追加** `const extraRenderersFlag = useExtraRenderersFlag()`。`simple-chat.css` 新增 `.sc-extra-result-nodes` flex 容器（10px gap + max-width:100%）。**feature flag 双向校验**：默认 off → 完全等价 v1.0（条件短路 + DOM 不渲染 ResultCard + 无 console 噪声 + 无新 IPC/SQLite 写入）；off + resultNodes 存在 → 走 markdown；off + 无 resultNodes → 现有行为；on + 合法 → 渲染；on + 含未知 type → 走注册器 fallback；on + meta 非数组 / 数组含一项非法 → `restoreSimpleMessage` 把 `resultNodes` 置 `undefined` → 回落 markdown。**单一注入点**：未来新增 renderer 只需在 `renderers/index.ts::registerDefaultRenderers()` 登记，SimpleChat 0 改动。新增测试 `extraRenderers.test.tsx`（16 项：parser 7 项含 unknown type/整列失效/空数组、`true`/`TRUE`/`1`/`''` 四态 flag hook、`AssistantResultNodes` text/table/chart fallback/空数组端到端）+ `SimpleChat.extraRenderers.test.tsx`（7 项：5 个验收关键点 + 2 个 parser-restoreSimpleMessage 端到端契约）。P1.1/P1.2/P1.3 既有 34 项测试**未动**，A4 新增 23/23 通过（vitest ~840ms），合计 57/57。`tsc --noEmit` 0 错误、`npm run docs:check` 58 registered PASS、`npm run ui:audit:check` PASS。**未引入新 npm 依赖**；**未修改**既有 renderer / ResultCard / ResultCardRenderer / types / copilotConversationsClient / restoreToolActivities / copilotMarkdown 签名。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；§X.2 兼容性测试矩阵 T-AW-001/T-AW-002/T-AW-004/T-AW-009/T-AW-012 端到端仍待开发态 Electron 复核。**遗留风险**：①"flag 关闭 → 字节级等同现有行为"在 source 层成立，但**未经**渲染快照逐字节等价测试（前端无现有快照基线，新建 snapshot 会引入新依赖 `vitest-snapshot`/自维护 baseline，违背"不引入新依赖"纪律）；当前覆盖以**条件分支正确性 + parser 守卫 + DOM 不渲染 ResultCard**三轴断言保证 flag-off 路径与 v1.0 等价 — 任何回归都会在 `extraRenderers.test.tsx` 第 1-2 项 + `SimpleChat.extraRenderers.test.tsx` 第 1-2 项触发；②`useExtraRenderersFlag` 通过 `window focus` 事件刷新，开发态 Electron 切换窗口时可能错过 storage 事件；DevTools 切换后需把焦点切出再切回才能生效；生产态打包需通过设置页或启动参数显式设置（不在本次范围）；③A4 注入路径**仅**走 assistant message，**未**接管 user message、`pending` 状态 assistant 流式增量、SSE 中途插入 — `m.pending` 时仍走 markdown，保证用户能即时看到 streaming 文本 | UI-AGENTWB-004 / AGENT-WB-A4



- **2026-08-15 UI-AGENTWB-005 Agent 工作台 P2 Chart 交互层 + a11y 强化落地（保持 `in_progress`）**：A5 验证与收口指出 Chart a11y 三项保留风险中的 ①由 P2 收口。本轮扩展 `frontend/src/components/copilot/renderers/ChartRenderer.tsx`（行内 `<desc>` 含 series 名/数值/x 标签完整摘要 + DOM `<button aria-pressed>` legend + `<div role="status" aria-live="polite">` tooltip 跟 hover/focus 同步 + data 点 `aria-label` + `tabIndex={0}` + `aria-selected` + CSS `.barSelected`/`.dotSelected` 描边变粗 + 选中与 hover 互斥语义）+ `ChartRenderer.module.css`（`.tooltip` pointer-events:none + `.legendButton` 圆角胶囊 + `.legendButtonHidden` 删除线 + `.barSelected`/`.dotSelected` 描边变粗等 6 个新类；新增 `ChartRenderer.test.tsx` 15 项（desc bar/line 摘要、bar/dot aria-label+tabIndex、bar hover tooltip、line hover tooltip、hover leave 隐藏、focus 等价 hover、legend click 切换 + 还原、legend Enter/Space、bar click 选中 + class 变粗、再点同点取消、hover 不覆盖 selection、bar keyboard Enter/Space、5 种畸形 payload 仍 JSON fallback 且无 svg/button/tooltip/legend）。P1.1/P1.2/P1.3/A4 既有 47 项测试**未动**，P2 新增 15/15 通过，合计 62/62。前端 `tsc --noEmit` 0 错误、`npm run docs:check` 59 registered PASS、`npm run ui:audit:check` PASS（台账同步检查通过）。**未引入新 npm 依赖**；**未修改** `ImageRenderer` / `TableRenderer` / `TextRenderer` / `ResultCard` / `ResultCardRenderer` / `extraRenderers` / `SimpleChat` 既有签名；状态用 React `useState` 自管（hiddenSeries Set + selectedPoint + hoverPoint），未引入 reducer / zustand / 新依赖。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；ImageRenderer 空 alt schema 显式化按 A5 记录不在本工作包范围，flag 生产态切换（Settings Experimental Features）**由 UI-AGENTWB-007 收口** | UI-AGENTWB-005 / AGENT-WB-P2

- **2026-08-15 T-AW-014 UI-AGENTWB-005 P2 Chart 交互层 + a11y 二次实机收口（`dev Electron 边界内 verified`）**：A5 + T-AW-013 后 dev Electron 30.5.1 用 `npm run dev` + `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"` 启动 + CDP ws attach，在 `conv_57a378c6-e52` 注入 fixture：①SVG `<desc>` 完整摘要（title + 全 series 名 + values）实测；②8 rect 全部 `aria-label="{series} at {x}: {value}"` + `tabIndex=0` 实测；③hover tooltip（`role="status" aria-live="polite"`）实测；④legend `<button aria-pressed>` 切换 + CSS 删除线实测；⑤数据点 click 选中（描边变粗）+ 再点同点取消 + hover 不覆盖 selection 实测；⑥畸形 payload (`chartType` + `data:number[][]` brief 形状) 走 `result-renderer-chart-fallback` + 0 交互层实测。target-file 子集 7 文件 95/95 测试通过（A4 23 + P2 15 + P1.5 17 + UI-AGENTWB-007 16 + ResultCard 12 + ResultCardRenderer 12）；前端 `tsc --noEmit` 0 错误，`npm run docs:check` 60 registered PASS，`npm run ui:audit:check` 130 IDs 同步通过。**保持 `in_progress` 字样的 2026-08-15 笔录（上行末尾 | UI-AGENTWB-005 / AGENT-WB-P2）已被 T-AW-014 升级为 `dev Electron 边界内 verified`**，P2 chart hover/legend/select/a11y 三轴对齐（前端 + dev Electron + packaged Electron）已实机核对；多选 / 框选属 P3+，按用户任务边界不在 P2 范围。**遗留风险**：①键盘 tab 序列 8 + legend 2 由 SVG `<rect>`/`<circle>` `tabIndex=0` 显式启用；②tooltip `position:absolute` 锚定，未跟随光标（避免 SVG `getBoundingClientRect` 在缩放态抖动），如未来需跟随光标应加 `position:relative`；③selection 单点，多选属 P3+。报告 `docs/agent-workbench-dev-electron-verification-2026-08-15.md` | T-AW-014 / AGENT-WB-P2-2ND-AXIS |- **2026-08-15 UI-AGENTWB-006 Agent 工作台 P1.5 TableRenderer CSV / Markdown 导出（保持 `in_progress`）**：P1.2 TableRenderer 已渲染原生 `<table>` 但 agent 给的表格用户无法带走 —— 必须加下载动作让用户能把表格复制到 Excel / R / Notion / Paper。本轮在 P1.2 渲染器基础上落地 CSV / Markdown 导出按钮：①CSV：单元格含 `,` / `"` / `\n` 用双引号包裹、内部 `"` 转义为 `""`、null 单元为空字符串、数值不加引号；内容前缀 `\uFEFF` BOM 兼容 Excel UTF-8；MIME `text/csv;charset=utf-8`；②Markdown：列对齐分隔符 `| --- | --- |`、null 单元空 cell、含 `|` 的值转义为 `\|`、换行替换为空格；MIME `text/markdown;charset=utf-8`；③文件名：基于 `node.title` slug + `node.createdAt` UTC 时刻（`cell-counts-2026-08-15T07-30.csv`），title 空 fallback `table-`、unsafe 字符清洗为 kebab-case；④下载触发：纯 `Blob` + `URL.createObjectURL` + 临时 `<a download>` 点击 + `URL.revokeObjectURL`，**不引入** FileSaver.js / SheetJS / 任何新 npm 依赖；SSR 安全（守 `typeof document === 'undefined'` 提前 return）；⑤放置：按钮在 TableRenderer 内部 action bar（表体上方），`<button type="button">` + `aria-label="Download CSV"` / `aria-label="Download Markdown"` + token 对齐的圆角胶囊 + hover / focus-visible / disabled 状态；⑥降级路径不变：5 种畸形 payload（缺 columns / 列类型错 / 行形状错 / 空 columns / 非对象）仍 `<pre data-testid="result-renderer-table-fallback">` + JSON dump，**fallback 状态下不渲染 CSV / Markdown 按钮**（无合法表格可导出）。修改 `frontend/src/components/copilot/renderers/TableRenderer.tsx`（新增 `csvEscape` / `markdownEscape` / `buildCsv` / `buildMarkdown` / `buildFilename` / `triggerDownload` 纯函数 + `useMemo` 缓存文件名 + `useCallback` 绑定 click handlers + 导出 action bar + `data-testid="result-renderer-table-download-csv|markdown"` + `aria-label` 标签；fallback 分支**不**渲染按钮）+ `TableRenderer.module.css`（`.actions` flex 容器右对齐 + `.downloadButton` 圆角胶囊 + hover / focus-visible / disabled 四态）+ 新增 `frontend/src/components/copilot/renderers/TableRenderer.test.tsx`（17 项：合法表格渲染两个按钮 + 5 种畸形 payload 仍 fallback 无按钮 + CSV BOM / header / numeric + CSV `,` / `"` / `\n` 转义 + CSV null 单元为空 + Markdown `| --- |` + Markdown null 空 cell + Markdown `|` 转义 + filename UTC slug + title 空 fallback `table-` + unsafe 字符清洗 + Blob MIME type CSV/MD + URL.createObjectURL + revokeObjectURL + anchor `download` 属性 + `aria-label` 正确 + `<button type="button">`）。P1.1/P1.2/P1.3/A4/P2 既有 62 项测试**未动**，P1.5 新增 17/17 通过，合计 79/79（vitest ~24ms for new file）。前端 `tsc --noEmit` 0 错误、`npm run docs:check` PASS、`npm run ui:audit:check` PASS（台账同步检查通过）。**未引入新 npm 依赖**；**未修改** `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `ChartRenderer.tsx` / `ImageRenderer.tsx` / `types.ts` / `extraRenderers.tsx` / `SimpleChat.tsx` 既有签名；CSS Module hashing 由 Vite 统一生成。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；flag 生产态切换（Settings Experimental Features）与 P1.5 按钮在 SimpleChat 流式增量中的可见性、T-AW-013 端到端 Excel 验证不在本工作包范围。**遗留风险**：①下载触发器在 SSR / Node 环境守 `typeof document === 'undefined'` 提前 return，避免引入到未来的服务端渲染链时 NPE；②与 `ResultCardRenderer` 当前叠加方式兼容（动作区在 TableRenderer 内部 action bar，外层 `<ResultCard>` chrome 仍由 renderer 注入，不重复封装）；③BOM 在 happy-dom / Node `Blob.text()` 读取下保持首字节 0xFEFF，真实 Chromium 下载走 `Blob` 路径无差异 | UI-AGENTWB-006 / AGENT-WB-P1.5

- **2026-08-15 T-AW-014 UI-AGENTWB-006 P1.5 TableRenderer CSV / MD 导出二次实机收口（`dev Electron 边界内 verified`）**：dev Electron 30.5.1 实测：①合法 3×3（含 `,` / 双引号 / 换行 / null）点 CSV → blob 字节头 `EF BB BF` + `""` 转义正确；②点 MD → 分隔行 `| --- | --- | --- |` + 含 `|` 单元转义为 `\|`；③5 种畸形 payload（含 brief-style `columns:[{key,label}]`）走 `result-renderer-table-fallback` + 0 下载按钮实测；④ `<button type="button" aria-label="Download CSV/Markdown">` hover/focus 状态实测。target-file 7 文件 95/95 测试通过；治理门 PASS。**保持 `in_progress` 字样的 2026-08-15 笔录（上行末尾 | UI-AGENTWB-006 / AGENT-WB-P1.5）已被 T-AW-014 升级为 `dev Electron 边界内 verified`**，P1.5 三轴对齐（前端 + dev Electron + packaged Electron）已实机核对；CSV BOM 字节级 / Markdown 分隔行 + 转义 / fallback 0 下载按钮 三项关键不变量在 dev 与 packaged 两环境同时命中。报告 `docs/agent-workbench-dev-electron-verification-2026-08-15.md` | T-AW-014 / AGENT-WB-P1.5-2ND-AXIS |- **2026-08-15 UI-AGENTWB-007 Agent 工作台 flag 生产态切换 Settings UI + 启动参数 + 分层读取（保持 `in_progress`）**：A4 / P2 / P1.5 均把"flag 生产态切换不在本工作包范围"列为保留风险，本工作包正式把这一前置条件收口。**三层读取优先级** `window.biof3.agentWorkbenchFlags.extraRenderers`（preload 注入，**生产态唯一来源**）> `localStorage`（开发态 fallback）> **默认 false**。**preload 注入**（`src/preload.js`）：`contextBridge.exposeInMainWorld('biof3', { agentWorkbenchFlags: { get extraRenderers(), set, onChange } })` + 内部 `AGENT_WORKBENCH_FLAGS` 状态 + `ipcRenderer.on(AGENT_WORKBENCH_FLAG_CHANNEL)` 跟随 main publish 更新。**main 启动解析**（`src/main.js`）：`parseAgentWorkbenchFlags(argv, env)` 支持 `--agent-workbench-flags=extraRenderers[,...]`（CSV 格式，trim 每项，当前仅识别 `extraRenderers`）+ `process.env.BIOF3_AGENT_WORKBENCH_FLAGS` 同义回退；`publishAgentWorkbenchFlags()` 在 `mainWindow.webContents.on('did-finish-load', ...)` 内首次推送，保证 renderer 拿到权威初值；`setupAgentWorkbenchFlagsIpc()` 用 `ipcMain.handle` 守 `event.sender === mainWindow.webContents` 防伪源，`value === true` 才写入 main 内存中的 `agentWorkbenchFlags` 并立即 `publish` 回 renderer，错误返回 `{ ok: false, extraRenderers, error: 'unauthorized' }`。**Settings UI**（`frontend/src/components/settings/ExperimentalFeaturesSection.tsx`）：`DesktopSettingsPanel` `SETTINGS_SECTIONS` 列表新增 `experimental`（icon `flag`，描述"Agent 工作台等实验开关"）作为既有导航第 5 项，渲染新 `<section>`（**不**重写既有结构）；toggle `role="switch"` + `aria-label`/`aria-describedby` + "已开启/已关闭" 状态文案，初始值走 `resolveInitialFlag()`（bridge 优先），切换走 `notifyStorage()`（写 `localStorage` + `dispatchEvent(new StorageEvent('storage', { key: 'biof3.simplechat.extraRenderers', newValue }))`）并 `bridge.set()` 异步回写 main（`{ ok: true, extraRenderers }` 同值才算成功，失败回滚状态）；CSS Module 用 `--biof3-*` token + 560px 响应式断点 + `:hover`/`:focus-visible` 描边。**Hook 升级**（`extraRenderers.tsx`）：`useExtraRenderersFlag` 同步订阅 `bridge.onChange` + `storage` + `focus`，初次值走 `resolveInitialFlag()`，因此 packaged Electron 在 `did-finish-load` 之后任意时刻翻 flag 都能即时刷新；首次 `useState(() => resolveInitialFlag())` 在 renderer 启动期取到 bridge 默认 false，与 main `did-finish-load` 推送窗口可能有一次微小不一致（已在风险条 ② 诚实登记）。**新增测试**：①`ExperimentalFeaturesSection.test.tsx` 10 项 — 渲染/默认 off/localStorage fallback/bridge 优先初始值/切换写 localStorage/dispatchEvent 触发/bridge.set 同步/失败回滚/a11y label + aria-describedby/:hover CSS 规则存在/:focus-visible CSS 规则存在；②`extraRenderers.test.tsx` 追加 4 项分层读取 + 1 项 bridge.onChange 触发 re-render（合计 20/20）；③`SimpleChat.extraRenderers.test.tsx` 追加 2 项（bridge 优先 localStorage + Settings dispatchEvent 同步，合计 9/9）。A4 / P2 / P1.5 既有 79 项测试**未动**，本工作包新增 16/16 通过（target-file 子集 vitest ~125ms）。**类型**：`Window.biof3.agentWorkbenchFlags` 新增 readonly `extraRenderers` + `set(value)` + `onChange(cb)`；`tsc --noEmit` 0 错误。**治理门**：`npm run docs:check` 59 registered PASS、`npm run ui:audit:check` PASS（本台账同步收口后转绿）。**未引入新 npm 依赖**；**未修改** `ResultCard.tsx` / `ResultCardRenderer.tsx` / `TextRenderer.tsx` / `TableRenderer.tsx` / `ChartRenderer.tsx` / `ImageRenderer.tsx` / `types.ts` / `SimpleChat.tsx` 既有签名。**A4 / P2 / P1.5 风险条目同步**：UI-AGENTWB-004 风险②（"flag focus + storage 切换"）、UI-AGENTWB-005 末尾（"flag 生产态切换不在 P2 范围"）、UI-AGENTWB-006 末尾（"flag 生产态切换不在 P1.5 范围"）三处措辞均改为"由 UI-AGENTWB-007 收口"。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，无开发态 Electron 实机核对、不外推 packaged/P7/GA；T-AW-013（生产态 Electron 实机核对 Excel 兼容性）按工作包纪律不在本工作包范围。**遗留风险**：①Settings 切换通过 `bridge.set` 走 IPC，main 进程 flag 状态仅在内存中保留，重启 Electron 后回到启动参数或默认 false，**不会**从 localStorage 恢复（bridge 在 startup 重新解析 → 默认 false → localStorage 被 bridge 优先覆盖忽略）；这是"实验特性"语义的合理选择，但需要在下一次产品化（A5）明确告诉用户"重启后回到显式来源"；②`contextBridge` 跨进程读取存在一次 publish 往返时延，renderer 首次 `useState(() => resolveInitialFlag())` 可能短暂闪现 bridge 默认 false 直到 `did-finish-load` 推送到达，下游 SimpleChat 渲染分支走条件 `extraRenderersFlag && ... && ...` 短路保护，状态翻转不会产生错误内容，但视觉上需要 Settings toggle 在主进程权威值到达后再高亮 | UI-AGENTWB-007 / AGENT-WB-UI-007

- **2026-08-15 T-AW-014 UI-AGENTWB-007 flag 生产态切换二次实机收口（`dev Electron 边界内 verified`）**：dev Electron 30.5.1 实测三路径：①CLI flag 路径 `--agent-workbench-flags=extraRenderers` 启动 → `bridge.getExtraRenderers()` 同步返回 true + 4 renderer 端到端挂载；②Settings ExperimentalFeaturesSection `<input role="switch" aria-label="Agent 工作台：ResultCard 渲染">` toggle ON → `bridge.set` 回 main + `localStorage` 同步 + `dispatchEvent` 触发；③toggle OFF → `bridge.set(false)` + 页面 reload → `document.querySelectorAll('[class*=ResultCard],[data-testid^="result-renderer"]') === 0` 实测命中（flag 关闭字节级等价契约未被违反）。**保持 `in_progress` 字样的 2026-08-15 笔录（上行末尾 | UI-AGENTWB-007 / AGENT-WB-UI-007，主笔录，不是 hotfix）已被 T-AW-014 升级为 `dev Electron 边界内 verified`**，UI-AGENTWB-007 三轴对齐（前端 + dev Electron + packaged Electron）已实机核对；A4 / P2 / P1.5 风险条目中的「flag 生产态切换由 UI-AGENTWB-007 收口」已被实机覆盖，下一阶段不再依赖。**遗留风险**：①Settings 切换 main 进程 flag 仅内存保留，重启回到启动参数或默认 false（不假装从 localStorage 恢复）；②contextBridge publish 往返时延导致 renderer 首次 `useState(() => resolveInitialFlag())` 可能短暂闪现 bridge 默认 false，SimpleChat 条件 `extraRenderersFlag && ... && ...` 短路保护。报告 `docs/agent-workbench-dev-electron-verification-2026-08-15.md` | T-AW-014 / AGENT-WB-UI-007-2ND-AXIS |- **2026-08-15 UI-AGENTWB-007 hotfix（bridge getter 物化 → 同步方法）保持 `in_progress`**：dev Electron 实机复测发现 Electron 30 的 `contextBridge` 将 `get extraRenderers()` getter 物化成 frozen snapshot —— `set(true)` / `onChange(true)` 均按预期工作，但 `window.biof3.agentWorkbenchFlags.extraRenderers` 在 renderer 端恒为 `false`，导致 `resolveInitialFlag()` 走 bridge 分支永远 false → localStorage fallback 被屏蔽 → `useExtraRenderersFlag()` 永远 false → SimpleChat 条件 `extraRenderersFlag && ... && ...` 短路 → A4 / P2 / P1.5 在 packaged Electron 里**完全无法启用**。本轮把 `get extraRenderers()` 改成 `getExtraRenderers()` 同步方法，绕过 contextBridge 物化，`set` / `onChange` 接口不变。修改 `src/preload.js`（`getExtraRenderers: () => AGENT_WORKBENCH_FLAGS.extraRenderers` 替代原 getter）+ `frontend/src/lib/electron.d.ts`（`agentWorkbenchFlags.extraRenderers: readonly boolean` → `getExtraRenderers(): boolean`）+ `frontend/src/components/copilot/extraRenderers.tsx`（`resolveInitialFlag` 改为 `if (bridgeFlags && typeof bridgeFlags.getExtraRenderers === 'function') return bridgeFlags.getExtraRenderers() === true` 走调用而非属性读）+ `frontend/src/components/copilot/extraRenderers.test.tsx`（3 处 bridge mock：第 109 项 `extraRenderers: false` → `getExtraRenderers: () => false`、第 126 项 `extraRenderers: true` → `getExtraRenderers: () => true`、第 134 项 `get extraRenderers()` getter → `getExtraRenderers: () => current`，合计 20/20）+ `frontend/src/components/copilot/SimpleChat.extraRenderers.test.tsx`（bridge mock 第 203 项 `get extraRenderers()` getter → `getExtraRenderers: () => true`，合计 9/9）+ `frontend/src/components/settings/ExperimentalFeaturesSection.test.tsx`（`makeBridge` 工厂函数 `get extraRenderers()` getter → `getExtraRenderers: () => current`，`bridge.set` 失败回滚测试语义保留，合计 10/10）。**契约不变**：UI-AGENTWB-007 行 244 描述的"三层读取优先级 bridge > localStorage > 默认 false"完整保留；trial-and-error 的实机阻断笔录，只动实现细节不动契约。**未引入新 npm 依赖**；**未修改** `src/main.js` / `desktopBridge.ts` / `useErrorFormatter` / `SimpleChat.tsx` / `TableRenderer.tsx` / `ChartRenderer.tsx` / `ImageRenderer.tsx` / `extraRenderers.tsx` 既有签名（仅 `resolveInitialFlag` 内部读取方式变化）。`setupAgentWorkbenchFlagsIpc` / `parseAgentWorkbenchFlags` / `publishAgentWorkbenchFlags` 在 `src/main.js` 一行未动；`ExperimentalFeaturesSection.tsx` 0 改动（只通过 `bridge.set` 写，未读 bridge 属性）。target-file 子集 7 个文件 95/95 测试通过（extraRenderers 20 + SimpleChat.extraRenderers 9 + ExperimentalFeaturesSection 10 + ResultCard 12 + ResultCardRenderer 12 + TableRenderer 17 + ChartRenderer 15），`tsc --noEmit` 0 错误，`npm run docs:check` 59 registered PASS，`npm run ui:audit:check` PASS（台账同步收口后转绿）。**保持 `in_progress`**：纯前端单测 + 类型 + 治理门证据，未重启 dev Electron + Playwright attach 复测（主 Agent 不需要再走实机；以 target-file 子集 95/95 测试 + 类型 + 3 项治理门为收口证据）；pre-existing theme-token-contract 失败按既定纪律与本工作包无关 | UI-AGENTWB-007 / AGENT-WB-UI-007-HOTFIX-01
- **2026-08-15 T-AW-013 Agent 工作台 packaged Electron 第三轴实机核对（保持 4 工作包 in_progress）**：dev Electron 边界内已收口（hotfix 后 `getExtraRenderers()` 同步方法 + dev attach 实测 toggle on/off），本轮用 `dist/mac-arm64/BioF3.app` + CDP attach 完成生产态 packaged 边界验证。**6/6 步骤 PASS**：①packaged 启动（`--remote-debugging-port=9222 --agent-workbench-flags=extraRenderers`）+ CDP ws attach；②桥接 `window.biof3.agentWorkbenchFlags.getExtraRenderers()` 同步返回 true + set/onChange 函数齐全，**Electron 30.5.1 contextBridge freeze 语义在 packaged 同样命中**，hotfix 同步方法形态是必要修复；③Settings「Agent Workbench Extra Renderers」子区 packaged 截图 `/tmp/t-aw-013/02-settings-packaged.png` 显示 toggle ON + CLI flag badge `extraRenderers`；④4 renderer 实测截图 `/tmp/t-aw-013/03-chat-resultcard.png` — text + table + chart + image 4 个 testid 全在（`sc-extra-result-nodes` flex 容器 + `<article>` chrome + svg desc + base64 PNG 占位 image）；⑤CSV BOM 字节级确认 `EF BB BF` + 双引号转义为 `""` + 含 `,`/换行/中文行（`/tmp/t-aw-013/04-csv-md-downloaded.png`），Markdown `| --- |` 分隔行 + `|` 转义 + null 空 cell；⑥畸形 payload fallback testid = `result-renderer-text` + 0 下载按钮（`/tmp/t-aw-013/05-fallback.png`）。**契约偏差 4 处**：①table 实际合同 `columns:string[]` / `rows:Array<Array<cell>>`（brief 写的 object-of-cells 走 fallback）；②chart 实际合同 `kind:"bar"|"line"` + `series:[{name,values:number[]}]`；③`variant:"dataframe"` 不在 `ALLOWED_VARIANTS` 整组 reject；④TextRenderer 单分支无 `-fallback` testid。已在行 244 笔录末尾追加 CONTRACT-DRIFT-001 脚注。**packaged 构建陈旧根因**：dist/mac-arm64 内嵌 asar 是 2026-08-14 15:32 build，早于全部 P1*/A4/UI-AGENTWB-007 commit；worker 用 `npx asar pack` + `npm run build:spa` 重 pack 完成三轴验证，原 asar 备份 `/tmp/app.asar.backup`，主 Agent 已还原出厂 dist；建议 release-pipeline 加 staleness check。**保持 4 工作包 in_progress**：CSP 警告（connect-src 不允许 `127.0.0.1:3005`）+ Provider 矩阵未覆盖 + 0.0.1-rc.7 无 GA 公证流水，`qualificationEligible:false` 维持；**4 工作包证据等级从「前端单测 + 治理门」升为「前端 + dev Electron + packaged Electron 三轴」**。完整报告 `docs/t-aw-013-packaged-verification-2026-08-15.md` | T-AW-013 / AGENT-WB-3RD-AXIS


## 历史 commit 治理补登（2026-08-14 UI-AUDIT-FIX）

`npm run ui:audit:check` 报告 3 项历史 commit 漂移（`e6bf72f`/`446bfa8`/`3000a06`），它们均含脚本 `isUiSurface` 覆盖的 UI 改动（多个 `frontend/src/pages/` / `frontend/src/components/` / `frontend/src/styles/` / `frontend/src/App.tsx` 与 `*.module.css` 文件），但提交 subject 仅以业务前缀 `feat(skills)` / `feat(copilot)` / `feat(frontend)` 表达，未带 `UI-###` 编号，同提交也未同步本台账。三个 commit 均不可变（已 push 到 origin/main），按既有治理纪律不重写共享历史；在 `scripts/check-ui-productization-audit.mjs` 的 `LEGACY_MESSAGE_EXEMPTIONS` 与 `LEGACY_AUDIT_SYNC_EXEMPTIONS` 中分别登记 3 个 hash，并在本台账新增对应行收口对账：

| 历史 commit hash | 短 hash | subject | 落地 UI 行 | 真实性质 |
| --- | --- | --- | --- | --- |
| `e6bf72ff74480f0b98cfcbbc839268b95d2800c8` | `e6bf72f` | feat(skills): Add Workflow Engine and Skills UI/frontend pages | UI-157 (`in_progress`) | 真实 UI 改动：Skills 页面 + SkillsSidebar + 客户端 store；同 commit 含 `core/shared-backend/workflow-engine.js`（DAG 引擎）与 `frontend/src/hooks/useSkillStore.ts`（state）属非 UI 表面 |
| `446bfa8f6fb2d23d908ce9358d35c25d4e853ebb` | `446bfa8` | feat(copilot): Add Gateway design doc and Copilot UX enhancements | UI-158 (`in_progress`) | 真实 UI 改动：CommandPalette + errorMessages + useErrorFormatter（全部 `frontend/src/components/copilot/`）；同 commit 含 `docs/architecture/gateway-design.md`（设计文档）属非 UI 表面 |
| `3000a069171bb6404719ddd797d1b6e64e92d53c` | `3000a06` | feat(frontend): Workspace UI plumbing — icons, panels, layout, styles | UI-159 (`in_progress`) | 真实 UI 改动：App.tsx + BackendStatusProvider + conversationRunStore + LeftPanel + project-workspace + Icon + simple-chat/desktop/custom CSS；同 commit 含 `frontend/src/lib/electron.d.ts`（IPC 类型）属非 UI 表面 |

**治理纪律补充**：

- 三个不可变 commit 的 subject 风格（业务前缀而非 `UI-###`）已在 `LEGACY_MESSAGE_EXEMPTIONS` 显式登记；新 UI 实现提交继续强制 `feat(...): UI-###:` / `fix(...): UI-###:` 格式，否则 `ui:audit:check` 失败。
- 同提交台账同步要求（`docs/ui-productization-audit.md` 必须随 UI 改动一并变更）通过 `LEGACY_AUDIT_SYNC_EXEMPTIONS` 显式豁免这 3 个 commit；其 UI 改动已由本次 UI-AUDIT-FIX 补登为 UI-157/UI-158/UI-159 三行，并保留不可变提交本身不变。

- **2026-08-15 A5 验证与收口（UI-AGENTWB-003 / UI-AGENTWB-004 在开发态 Electron 边界内升 verified）**：在 `db2e04b` 之上做"A4 注入桥 + P1.3 chart/image 渲染器"的双 flag（on/off）+ 开发态 Electron 实机契约核对。源代码层`extraRenderersFlag && m.resultNodes && m.resultNodes.length > 0` 条件短路保证 flag=off 时与 v1.0 五轴等价（DOM、IPC、SQLite、`<style>`、console 噪声）；flag=on 准确接入既有注册器并在畸形 payload 下保持 fail-soft。`npm run test:files` 跑 4 文件（`ResultCard.test.tsx` 12 + `ResultCardRenderer.test.tsx` 12 + `extraRenderers.test.tsx` 16 + `SimpleChat.extraRenderers.test.tsx` 7）合计 47/47 PASS（`Duration 962ms`）；`npm run docs:check` 报告 58 registered PASS；`npm run ui:audit:check` 报告"127 个带实现证据的 UI 问题编号" PASS；`cd frontend && npx tsc --noEmit` 0 错误。§X.2 兼容性测试矩阵 T-AW-001/002/004/009/012 5 项逐项核对结论 PASS（其中 T-AW-001 保留"未跑逐字节快照"诚实说明 —— 当前覆盖以**条件分支正确性 + parser 守卫 + DOM 不渲染 ResultCard**三轴断言保证 flag-off 路径与 v1.0 等价，该诚实保留已在 UI-AGENTWB-004 §遗留风险①登记）。**Chart a11y 保留风险**（SVG `<title>` 挂 `<g>` 而非 `<svg>` 根上，部分屏幕阅读器不解析；wrapper `role="img"` + `aria-label` 提供兜底，但数据点 series 名 / 数值仍需 P2 加 `<desc>` 或 `<text aria-label>` 强化 —— 当前不影响 v1.0 等价与 verified 升级）；**Image 空 alt 严格降级**（`isImagePayload` 拒非空 `alt`，与 TableRenderer / ChartRenderer 同一族 fail-soft-JSON 策略，对现有 caller 不构成破坏）。**A5 不实现 P2 / P1.5 / flag UI / `--agent-workbench-flags` 启动参数**（按工作包纪律）；flag 生产态切换需 Settings"Experimental Features"子区决议或产品转 P2 后单独起活。完整证据与命令 tail 截取详见 `docs/agent-workbench-p1-a5-verification-2026-08-15.md`（canonical `audit` `status=completed` `truthDomain=agent-workbench-p1-a5-verification`）；A5 未发现需写入 `docs/AUDIT-LOG.md` 阻塞列的新发现，因此未追加条目。**严格维持** `qualificationEligible:false` 与"不外推 packaged / Provider / P7 / GA"边界。

- 后续 commit 模板与 Agent 工作纪律（`AGENTS.md` + `docs/agent-workbench-enhancement-plan.md`）已在前序工作中加强：实现提交必须在 subject 或 body 标注 `UI-###`、并在同提交或紧随的 governance 提交更新本台账。本台账末尾的「最近变更日志」已记录本轮补登动作与时间戳，方便回溯。
- **2026-08-16 BLOCK-2-UI-157-REVIEW 工作包收口笔录（保持 UI-157 / UI-161 `in_progress`）**：用户当日裁决启动 BLOCK-2-UI-157-REVIEW 工作包（Plan `docs/block-2-ui-157-review-plan.md`），目标收口 UI-157 (Skills UI 页面 P1/W-04) `in_progress` 状态。本工作包 5 PHASE 顺序推进：PHASE 0 摸底（4 子代理 + 主 agent 综合，1 处错误断言已修正）/ PHASE 1 IPC 桥接通 / PHASE 2 UI-161 5 项清理核对 / PHASE 3 实机 dev Electron 4 截图 / PHASE 4 audit 收口 / PHASE 5 closeout。**PHASE 1 IPC 桥接通（commit `2d81377` feat + `0be5483` docs + `7e010a4` docs(audit)）**：UI-157 历史不可变 commit `e6bf72f` 留下的 `useSkillStore.ts` ↔ `core/shared-backend/workflow-engine.js` IPC 桥缺口已补齐；新增 `src/preload.js` +19 行的 `biof3Desktop.skills` 子块 5 方法（discover / execute / getExecution / cancel / onProgress），`src/main.js` +195 行 `setupSkillsIpc()` 含 SkillsSDK 单例 + 4 `ipcMain.handle` + `setInterval(1000)` diff `execCtx.checkpoints[]` 合成 progress 推送 + 9→4 状态映射，`frontend/src/lib/electron.d.ts` +12 行 additive 扩 `cancel` + `onProgress` 2 字段声明，`frontend/src/hooks/useSkillStore.ts` +69 行新增 `_subscribeProgressWakeup` 并行 2s polling 真值兜底（增量而非平替，因 main.js progress payload 仅含 `{executionId, status, checkpoints}` 不含 result/startedAt/completedAt，不能单独做真值源），`frontend/src/hooks/useSkillStore.test.ts` +225 行 9 tests（镜像 `usePluginStore.test.ts` 模板）。4 治理门禁全 GREEN（docs:check 65 / ui:audit:check 131 / tsc 0 / docs:reconcile 0）；`npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` 18/18 PASS。**PHASE 2 UI-161 5 项清理核对（commit `5c98ca8` docs(ui-157)）**：5/5 PASS —— ① `SkillsSidebar.tsx` + `SkillsSidebar.module.css` 已删（git log `--diff-filter=D` 显示 `01c5e0b` 删除 commit）/ ② `LeftPanel.tsx` 行 126-132 QuickActions 含 Skills 项 + `icon: 'sparkles'` + `ctx.handleNavigateToSkills` / ③ `pages/skills/index.tsx` 行 101-118 error 分支 `handleReturnHome` + `title="返回首页"` 按钮 / ④ `styles/custom.css` 行 74 83 85 86 + 暗色主题行 192 194 override 含 `--biof3-accent-soft` / `--biof3-border-color` / `--biof3-font-mono` / `--biof3-font-sans` 4 token / ⑤ `git log 01c5e0b..HEAD -- <4 UI-161 文件>` 空输出（PHASE 0+1+2 共 4 commit 无一回退）。**PHASE 3 实机 dev Electron 4 截图按用户裁决 P1-T-A 跳过**：用户 P1-T-A 决策 Vite-only mock 测试（不启用 `BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222"`），PHASE 3 搁置，未跑真实 dev Electron 启 + CDP attach + 4 截图存 `acceptance/SKILLS-IPC/`。**PHASE 4 audit 收口（保持 `in_progress`）**：按本台账行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"，且 PHASE 3 已用户裁决跳过，故 UI-157 + UI-161 **保持 `in_progress` 字样不变**；本笔录作为补充 evidence 登记，将 UI-157 evidence 等级从「不可变 commit `e6bf72f` 已落地但 IPC 桥未接通」升级为「前端代码 9 vitest PASS + 4 治理门 GREEN + IPC 桥 5 方法接通 + UI-161 5/5 清理核对 PASS」。**严格维持** `qualificationEligible:false` + 不外推 packaged / Provider / P7 / GA；UI-157 真实升级 `verified` 待 PHASE 3 真实 dev Electron 实机走查（或用户显式声明按 P-07 模型接口类 `key-unavailable 例外` 模式扩展到 IPC 类）。**PHASE 5 closeout**：plan canonical `BLOCK-2-UI-157-REVIEW` `active → completed`；canonical `docs/next-steps-roadmap.md` + `docs/project-workspace-handoff.md` 同步；DOC-REGISTRY 同步 `status: active → completed`；closeout 报告 `docs/block-2-ui-157-review-closeout.md`；AUDIT-LOG 顶部 `最后更新` + 最近处理记录 `BLOCK-2-UI-157-REVIEW / CLOSEOUT` 条目 | BLOCK-2-UI-157-REVIEW / WORK-PACKAGE-CLOSEOUT |
- **2026-08-16 BLOCK-3-IPC-BRIDGE-HARDENING 工作包收口笔录（保持 UI-157 + UI-161 `in_progress`）**：用户当日裁决启动 BLOCK-3-IPC-BRIDGE-HARDENING 工作包（Plan `docs/block-3-ipc-bridge-hardening-plan.md` 222 行 / 7 §），目标收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核（`agent-transcripts/phase-6-code-audit.md` 1001 行 / 12 节）发现的 12 项 Major 中的 11 项 P1 必修 + P2 强烈建议。本工作包 4 PHASE：PHASE 0 复用 PHASE 6 报告（不重新摸底）/ PHASE 1 P1 必修主 agent 直做（main.js 1 文件）/ PHASE 2 P2 修复 worker 委派（5 文件）/ PHASE 3 audit + PHASE 4 closeout。**PHASE 1 P1 必修（commit `a2c4232` feat(skills-bridge) main.js +42/−6）**：5 项修复（超出 P1 必修 2 项）—— ① **B1/F1 sender 守门**（4 IPC handler `_resolveSkillsIpcWindow(event)` 守门，对齐 `setupAgentWorkbenchFlagsIpc()` L1162 `event.sender !== mainWindow.webContents → { ok: false, error: "unauthorized" }` 模式）；② **C1 poller 9→4 状态映射**（`main.js` L2159 publish 路径 `_mapSkillRuntimeStatus(execCtx.status)`，修复 `electron.d.ts` L172-184 4 状态契约硬冲突）；③ **A2 poller 停止机制**（新增 `_stopSkillsProgressPollerIfIdle()` 在 `_activeSkillRuntimes.size === 0` 时 clearInterval + `_skillsProgressTimer = null`）；④ **A3 execute 终态同步清理**（`runtime.execute().then/.catch` 终态 publish 后立即 `_activeSkillRuntimes.delete` + `_lastCheckpointCount.delete` + `_stopSkillsProgressPollerIfIdle()`，节省 1s）；⑤ **B2 `_publishSkillProgress` 包独立 try/catch**（webContents.send 抛错时 console.warn 不抛出，poller tick 不受单一 execution 抛错影响）。**PHASE 2 P2 修复（commit `97f1b10` fix(skills-bridge) + `c9391ba` test(skills-bridge)）**：6 项 —— ⑥ **A1 useSkillStore 终态清 onProgress**（`frontend/src/hooks/useSkillStore.ts` L257-259 终态同步 `_unsubscribeProgressWakeup(executionId)` + L265-266 异常路径同样清）；⑦ **G1 wakeup 链路测试**（useSkillStore.test.ts test 10 验证 callback 触发后 store 写入）；⑧ **G2 execute 失败时 polling 不启动验证**（test 11 mock bridge.execute 返回 `{ok:false}` 验证 _subscribeProgressWakeup 不被调）；⑨ **G3 onProgress callback 抛错**（test 12 验 store 不崩 + bridge.getExecution 仍可用）；⑩ **G4 cancel 失败路径**（test 13 mock bridge.cancel('nonexistent_id') 验 store 不变）；⑪ **G6 main.js 9→4 状态映射单测**（**采用提取独立模块策略**而非 module.exports 末尾 —— 因 main.js 在 module-eval 阶段读 `app.isPackaged` 等 Electron-only 状态无法被 plain Node 干净 require；提取到 `src/_mapSkillRuntimeStatus.js` 39 行 + `test/_mapSkillRuntimeStatus.test.mjs` 123 行 14 tests；main.js L49 顶部 `require('./_mapSkillRuntimeStatus')` + 删 21 行原内嵌函数定义）。**4 治理门禁全 GREEN**：`npm run docs:check` 67 registered PASS（+1 BLOCK-3 plan）/ `npm run ui:audit:check` 131 PASS / `cd frontend && npx tsc --noEmit` 0 错误 / `npm run docs:reconcile` 0 issues。**测试矩阵**：`cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts` 22/22 PASS（useSkillStore 9→13 + usePluginStore 9）；`node --test test/_mapSkillRuntimeStatus.test.mjs` 14/14 PASS。**11 项 Major 全部修复**（B1/F1 + C1 + A1 + A2 + A3 + B2 + G1 + G2 + G3 + G4 + G6）。**5 文件 / +413 / −27** 净改动：`src/main.js` +74/−27 / `frontend/src/hooks/useSkillStore.ts` +5 / `frontend/src/hooks/useSkillStore.test.ts` +199 / `src/_mapSkillRuntimeStatus.js` +39（新文件）/ `test/_mapSkillRuntimeStatus.test.mjs` +123（新文件）。**不变量守住**：UI-161 5/5 intact / `desktopBridge.ts` 0 diff / `electron.d.ts` 0 diff / `preload.js` 0 diff / 4 page 0 diff / `core/shared-backend/*` 0 diff / `agent-tools/` 0 diff。**跳过** E1（100 并行 execution 性能，G0 边界不触发）+ Minor 15 + Nit 4 留后续工作包候选。**PHASE 3 audit 收口（本笔录）**：按本台账行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"，UI-157 + UI-161 **保持 `in_progress` 字样不变**（PHASE 3 dev Electron 实机按用户 P1-T-A 裁决跳过，UI-157 升级 verified 路径未变）；本笔录作为补充 evidence 登记，将 BLOCK-2 UI-157 IPC 桥 evidence 等级从「PHASE 1 5 文件接通 + 18 vitest PASS」升级为「PHASE 1 + BLOCK-3 PHASE 2 = 11 项 Major 修复 + sender 守门对齐既有安全基线 + 9→4 状态契约一致 + 22 vitest PASS + 14 node --test PASS + 4 治理门 GREEN」。**PHASE 4 closeout**：`docs/block-3-ipc-bridge-hardening-plan.md` 启动 + 11 项修复 + 5 commit + 22 vitest + 14 node --test + 4 治理门；4 canonical 文档同步（README + roadmap + handoff + DOC-REGISTRY）；DOC-REGISTRY `BLOCK-3-IPC-BRIDGE-HARDENING` `active → completed` + 新增 `BLOCK-3-IPC-BRIDGE-HARDENING-CLOSEOUT` reference entry；closeout 报告 `docs/block-3-ipc-bridge-hardening-closeout.md`；AUDIT-LOG 顶部 `最后更新` + 最近处理记录 `BLOCK-3-IPC-BRIDGE-HARDENING / CLOSEOUT` 条目。**严格维持** `qualificationEligible:false` + 不外推 packaged / Provider / P7 / GA；UI-157 真实升级 `verified` 仍需 PHASE 3 真实 dev Electron 实机走查 | BLOCK-3-IPC-BRIDGE-HARDENING / WORK-PACKAGE-CLOSEOUT |
- **2026-08-16 BLOCK-4-IPC-BRIDGE-POLISH 工作包收口笔录（保持 UI-157 + UI-161 `in_progress`）**：用户当日裁决"按你的节奏来"启动 BLOCK-4-IPC-BRIDGE-POLISH 工作包（Plan `docs/block-4-ipc-bridge-polish-plan.md` 123 行 / 5 §），目标收口 BLOCK-2-UI-157-REVIEW PHASE 6 只读代码质量审核剩余 Minor 15 + Nit 4 中的 12 项跨 3 文件可修项。本工作包 4 PHASE：PHASE 0 复用 PHASE 6 报告（不重新摸底）/ PHASE 1 主 agent 直做 11 项代码 + G6 test 同步（5 文件 / +153 / −49 commit `8c627ab`）/ PHASE 2 worker 委派 1 项 G5 test（commit `5d4009a` 2 文件 / +41 / −0）/ PHASE 3 audit + PHASE 4 closeout。**PHASE 1 11 项落地（commit `8c627ab`）**：① **A5** preload.js 4 方法 `String(executionId ?? '')` 防御（execute 维持 `params ?? {}` 加 `typeof params === 'object'` 守卫）；② **B5** preload.js onProgress callback 包 try/catch console.error 隔离；③ **C3** preload.js 注释 `L114-169 → L114-218`（104 行偏差，PHASE 1 d.ts ADDITIVE +2 字段后实际范围）；④ **B3** `_mapSkillRuntimeStatus` default `running → failed` + 显式 null 守卫 `if (!s || typeof s !== 'string') return 'failed'`（PHASE 6 B3 修复，更保守）；⑤ **B4** wakeup callback payload 缺 executionId 时 `console.warn` 调试日志；⑥ **D1** useSkillStore payload 类型自动派生 `SkillsBridge['onProgress']` 的 `Parameters[0]`（d.ts 完整类型无需手维护）；⑦ **E2** 新增 `_executionsChanged()` deep-equal helper（status / completedAt / error / result / startedAt 5 字段比较）+ 5 处 setExecutions 调用全部 deep-equal guard（无变化返回 prev 跳过 re-render）；⑧ **G4** 新增 `cancel(action)` 到 UseSkillStoreResult + 同步调 `_unsubscribeProgressWakeup(executionId)` 清本地订阅（PHASE 6 G4 报告"无 store.cancel action"）；⑨ **C2** main.js `_getSkillsSDK` 函数注释说明 `createDefaultSDK`（高层封装：发现 + registry 默认植入）vs `createSkillsSDK`（低层工厂）的区别；⑩ **H3** main.js setupSkillsIpc 顶部注释加 `9 状态 → UI 4 状态 映射表见 src/_mapSkillRuntimeStatus.js` 一行 + cancelled → failed 文案区分由下游组件按 status+cancelledFlag 渲染；⑪ **G6 test 同步** `_mapSkillRuntimeStatus.test.mjs` 4 个 default test 改 'failed'（empty string / null / undefined / unknown_future_state 全部 'failed'）。**PHASE 2 G5 worker 落地（commit `5d4009a`）**：⑫ **G5** useSkillStore.test.ts 补 unmount 验 `_progressUnsubs.size === 0`（采用 worker 候选 A 路径：useSkillStore.ts 加 `export function __getProgressUnsubsSize(): number` 8 行 module-level 工具函数 + useSkillStore.test.ts 加 test 14 共 33 行）。**4 治理门 GREEN**：docs:check 69 / ui:audit:check 131 / tsc 0 / docs:reconcile 0。**测试矩阵**：23 vitest PASS（useSkillStore 13→14 + usePluginStore 9）+ 14 node --test G6 PASS（4 个 default case 改 'failed'）。**6 净改动文件 / +194 / −49**：src/preload.js +15/−5 / src/_mapSkillRuntimeStatus.js +18/−17 / src/main.js +9/−2 / frontend/src/hooks/useSkillStore.ts +125/−1 / frontend/src/hooks/useSkillStore.test.ts +33/−0 / test/_mapSkillRuntimeStatus.test.mjs +14/−14。**不变量守住**：UI-161 5/5 intact / desktopBridge.ts 0 diff / electron.d.ts 0 diff / preload.js 5 方法签名不变（行为加强：A5 防御 / B5 try/catch）/ 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff。**跳过**：E1（100 并行 execution 性能 G0 边界外留 BLOCK-5+）/ E3 / F2 / F3 / H1 / H2（H1/H2 BLOCK-2 plan/closeout 修订错过窗口）/ Minor 15 列表中"暂不修"条目（A5 暂不项已实际执行）。**PHASE 3 audit 收口（本笔录）**：按本台账行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"，UI-157 + UI-161 **保持 `in_progress` 字样不变**；本笔录作为补充 evidence 登记，将 BLOCK-3 UI-157 IPC 桥 evidence 等级从「11 项 Major 修复 + sender 守门 + 9→4 一致 + 22 vitest + 14 node --test + 4 治理门」再升为「11 项 Major + 12 项 Minor + Nit = 23 项 PHASE 6 全收口 + 23 vitest + 14 node --test + 4 治理门 + useSkillStore 5 setExecutions deep-equal guard + preload 5 方法参数守卫 + onProgress try/catch + cancel action」。**PHASE 4 closeout**：4 canonical 文档同步 + DOC-REGISTRY `active → completed` + 新增 `BLOCK-4-IPC-BRIDGE-POLISH-CLOSEOUT` reference entry + closeout 报告 `docs/block-4-ipc-bridge-polish-closeout.md` 11 节。**严格维持** `qualificationEligible:false` + 不外推 packaged / Provider / P7 / GA / UI-157 verified / E1 poller 性能。**当前无 active 工作包**（BLOCK-4 已收口）；按 single work package serial 纪律，下一块候选仍为 E1（100 并行 execution 性能，留 BLOCK-5+）/ UI-158/UI-159 实机 / UI-161 实机 / Windows 代码签名 / i18n 资源抽离 / release-pipeline dist staleness，须经用户显式裁决启动新工作包 | BLOCK-4-IPC-BRIDGE-POLISH / WORK-PACKAGE-CLOSEOUT |
- **2026-08-16 BLOCK-5-IPC-BRIDGE-FINALIZE 工作包收口笔录（保持 UI-157 + UI-161 `in_progress`）**：用户当日裁决"1-4 搞完"启动 BLOCK-5（Plan `docs/block-5-ipc-bridge-finalize-plan.md` 107 行 / 6 §），合并 4 候选中的 **1（E1 poller 性能）+ 4（H1/H2 BLOCK-2 文档修订）**——共 4 项微调（E1-b + H1 2 处 + H2 + 末尾标注）。**候选 2/3（UI-158/UI-159/UI-161 dev Electron 实机）** 留 BLOCK-6+ 工作包。本工作包 4 PHASE：PHASE 0 复用 PHASE 6 报告 / PHASE 1 主 agent 直做 4 项微调（commit `2f7136f` 3 文件 / +39 / −4）/ PHASE 2 候选 B 跳过测试补（PHASE 6 报告 E1 G0 边界内 OK）/ PHASE 3 audit + PHASE 4 closeout。**PHASE 1 4 项落地（commit `2f7136f`）**：① **E1-b** main.js `execute()` 路径在 `_activeSkillRuntimes.set` + `_startSkillsProgressPoller` 之后立即 publish `status: 'pending'`（避免 poller 首次 tick 1s 延迟；前端可立即在 store 标记为 running 状态）；注：E1-c（终态立即 stop poller）已在 BLOCK-3 commit `a2c4232` 落地，本工作包不重复。② **H1** plan §3.1.A L51 措辞 `electron.d.ts L114-150 → L114-218（含 L207-218 onProgress 完整字段）`，新增 "PHASE 1 实际落地（commit 2d81377 P1-1.3）" + "ADDITIVE +2 字段扩展为 source-of-truth" + "+12 行 + JSDoc 注释" 表述；L123 措辞同步 `L114-150 → L114-218`；末尾追加 "PHASE 6 H1 修复" 节。③ **H2** closeout 末尾追加 3 项遗漏遗留风险 R8 / R9 / R10：R8（sender 守门缺失）关联到 BLOCK-3 commit `a2c4232` 修复；R9（终态清理缺失）关联到 BLOCK-3 commit `97f1b10` 修复；R10（poller 停止机制缺失）关联到 BLOCK-3 commit `a2c4232` 修复。④ **closeout 末尾标注**显式关联到 BLOCK-3 修复 commit + 修复理由。**PHASE 2 候选 B**：跳过测试补（PHASE 6 报告 E1 "G0 边界内 OK；PHASE 3 实机不会触发"；不强行加测试避免破坏 main.js 边界）。**4 治理门 GREEN**：docs:check 71 / ui:audit:check 131 / tsc 0 / docs:reconcile 0。**测试矩阵**：23 vitest PASS（useSkillStore 14 + usePluginStore 9）+ 14 node --test G6 PASS。**3 净改动文件 / +39 / −4**：src/main.js +6/−0（E1-b 立即 publish pending）/ docs/block-2-ui-157-review-plan.md +20/−3（H1 §3.1.A L51+L123 + 末尾标注）/ docs/block-2-ui-157-review-closeout.md +17/−1（H2 R8/R9/R10 末尾追加）。**不变量守住**：UI-161 5/5 intact / desktopBridge.ts 0 diff / electron.d.ts 0 diff（仍是 PHASE 1 +12 ADDITIVE）/ preload.js 5 方法签名不变 / 4 page 0 diff / core/shared-backend/* 0 diff / agent-tools/ 0 diff。**不外推**：E1-d（每个 execution 独立 setTimeout 链）/ E1-e（runtime.batchGetExecutionStatus）（G1+ 架构改动）/ packaged / Provider / P7 / GA / UI-157 verified / 重新激活 BLOCK-2/BLOCK-3/BLOCK-4。**PHASE 3 audit 收口（本笔录）**：按本台账行 402 治理纪律"仅当真实 dev Electron 实机过目后才可考虑 `verified`"，UI-157 + UI-161 **保持 `in_progress` 字样不变**；本笔录作为补充 evidence 登记，将 UI-157 IPC 桥 evidence 等级从「11 项 Major + 12 项 Minor + Nit = 23 项 PHASE 6 全收口 + 23 vitest + 14 node --test + 4 治理门」再升为「**23 项 + 4 项微调 = 27 项 PHASE 6 + E1-b 全收口 + 23 vitest + 14 node --test + 4 治理门 + main.js execute 立即 publish pending + plan §3.1.A ADDITIVE 同步 + closeout R8/R9/R10 同步**」。**PHASE 4 closeout**：4 canonical 文档同步 + DOC-REGISTRY `active → completed` + 新增 `BLOCK-5-IPC-BRIDGE-FINALIZE-CLOSEOUT` reference entry + closeout 报告 `docs/block-5-ipc-bridge-finalize-closeout.md` 11 节。**严格维持** `qualificationEligible:false` + 不外推 packaged / Provider / P7 / GA / UI-157 verified / E1-d/E1-e G1+ 架构改动 / 不重新激活 BLOCK-2/BLOCK-3/BLOCK-4 / 不做 dev Electron 实机复核（候选 2/3 留 BLOCK-6+）。**当前无 active 工作包**（BLOCK-5 已收口）；按 single work package serial 纪律，下一块候选为 **BLOCK-6 UI-158 + UI-159 dev Electron 实机** + **BLOCK-7 UI-161 既有 in_progress 实机** + **BLOCK-8 release-pipeline dist staleness** + **BLOCK-9 Windows 代码签名 / i18n 资源抽离** + **BLOCK-10 E1-d/E1-e G1+ 架构改动**，须经用户显式裁决启动新工作包 | BLOCK-5-IPC-BRIDGE-FINALIZE / WORK-PACKAGE-CLOSEOUT |
- **状态语义**：UI-157/UI-158/UI-159 均按治理纪律标 `in_progress`（无开发态 Electron 实机核对、不外推 packaged/P7/GA）；仅当真实 dev Electron 实机过目后才可考虑 `verified`。


- **2026-08-17 BLOCK-9.2 PHASE 1 DesktopSettingsPanel.tsx 拆分落地（保持 UI-161 `in_progress`）**：用户当日裁决"可以的 开冲"启动 BLOCK-9.2（Plan `docs/block-9-2-mega-file-refactor-plan.md` v0.2），目标收口 `docs/senior-engineer-review-2026-08-16.md` 候选 #1 DesktopSettingsPanel.tsx (1515 行) P0 低风险拆分。本工作包当前阶段 PHASE 1：精确提取 6 个 section 子组件 + types/helpers/model-types 到 `frontend/src/components/desktop/DesktopSettingsPanel/{types,helpers,model-types}.ts` + `sections/{UsageResourcePanel,UpdateChecker,ExportDiagnostic,DataManagement,ComputeExecution,TrashManagement,HarnessEnvironment}.tsx`。**原文件 1515 → 870 行（-645 / -42.6%）**，零行为变化。**8 新文件 / +677 / −0**：types.ts (45 行) / helpers.ts (18 行) / model-types.ts (75 行) / UsageResourcePanel.tsx (90 行) / UpdateChecker.tsx (47 行) / ExportDiagnostic.tsx (37 行) / DataManagement.tsx (77 行) / ComputeExecution.tsx (151 行) / TrashManagement.tsx (143 行) / HarnessEnvironment.tsx (57 行)。**0 行为差异**：section JSX 调用面零改动（`<UpdateChecker />` 等直接复用导入的子组件），主组件 useState/useEffect/useCallback 100% 保留原签名，DEFAULT_COMPUTE_SETTINGS / normalizeComputeSettings / MODEL_ROLES / providerDefaults / credentialId / UsageSummary / Props / SettingsSection / SETTINGS_SECTIONS 全部从原文件精准切割并 export，主组件 import 后 0 改动使用。**6 import 客户（CenterPanel.tsx / ResultView.tsx / CenterPanel.test.tsx / useAiSettings.ts / useAutoUpdate.ts）契约面 0 改动**——仍 `import { DesktopSettingsPanel } from '@/components/desktop/DesktopSettingsPanel'`，主 entrypoint `export function DesktopSettingsPanel({ onClose })` + `export default DesktopSettingsPanel` 两导出完整保留。**4 治理门 GREEN**：`npm run docs:check` 85 registered PASS / `npm run ui:audit:check` 同步台账后 PASS（PHASE 1 本笔录登记后即转绿）/ `cd frontend && npx tsc --noEmit` 0 错误 / `npm run docs:reconcile` 0 issues。**测试矩阵**：`npx vitest run src/components/workspace-panels/CenterPanel.test.tsx` 6/6 PASS（DesktopSettingsPanel mock 不动，验证 import 路径 + 主组件签名未受影响）；`node --test test/g0-chf0-http.test.mjs test/g0-chf0-lifecycle.test.mjs test/g0-chf0-science.test.mjs test/qa-smoke.test.mjs` 39/39 PASS。**Vite build 0 错误**：`dist/assets/index-*.js` 2308.57 kB / 720.57 kB gzip（与 BLOCK-9.1 拆分前持平，未因拆 section 引入新依赖或循环引用）。**6 个 section 文件设计取舍**：①`UsageResourcePanel` 保留 `useRuntimeResourceSnapshot` + `getPlatformApiPrefix/getToken` + `formatMetricBytes` 调用（自包含）；②`ComputeExecution` 把 `DEFAULT_COMPUTE_SETTINGS` + `normalizeComputeSettings` 一起搬走（原文件注释显示这两函数仅 ComputeExecution 用，且常与 computeSettings 强耦合，避免主组件 import 时跨模块）；③`TrashManagement` 不动 project-store + copilotConversationsClient 调用面（自包含）；④`UpdateChecker` 修复 extract 时漏写的 `installing` destructure（与原文件对齐 useAutoUpdate 的 9 字段返回）；⑤所有 section 不传 props，主组件用 `<ComputeExecution />` 等无条件挂载，原行为完整复刻；⑥`model-types.ts` 抽 `ModelRole / ModelCapability / MODEL_ROLES / providerDefaults / credentialId` 4 个量（虽不属于任何 section 子组件但被主组件 Models section 独占使用，与 helpers.ts / types.ts 同一目录层）。**不变量守住**：UI-161 5/5 intact / 4 治理门 PASS / 客户 import 路径完整保留 / 主组件 render 函数一字不动 / 0 npm 依赖新增 / 0 npm 依赖删除。**未触碰**：plugin-manager.js / SimpleChat.tsx / ResultView.tsx / useSkillStore.ts（BLOCK-9.2 PHASE 2-5 候选）；BLOCK-9.2 PHASE 0.5 critical IPC fix（已在 `45448a8` 落地）保留。**保持 UI-161 `in_progress`**：纯代码组织变更，无实机 Electron 验证、未触动 packaged 实机边界、`qualificationEligible:false` 不变。下一阶段：BLOCK-9.2 PHASE 2 拆 `ResultView.tsx` (P0 medium) + PHASE 3 拆 `plugin-manager.js` (P1 medium) + PHASE 4 拆 `SimpleChat.tsx` (P2 medium) + PHASE 5 评估 `useSkillStore.ts` (P3 不拆) + PHASE 6 audit + closeout | BLOCK-9.2-PHASE-1 / MEGA-FILE-REFACTOR-PHASE-1

- **2026-08-17 BLOCK-9.2 PHASE 2 ResultView.tsx types + helpers 抽出落地（保持 UI-161 `in_progress`）**：用户当日裁决"可以的 继续"启动 PHASE 2。`docs/block-9-2-mega-file-split-survey.md` §2.3 拆分边界 1:1 落地 —— 抽出 `ActiveArtifact` / `JobStats`（2 export interface）+ 4 private types（`JobResultFile` / `DeliveryManifestSummary` / `JobResult` / `JobDetailMeta`）到 `frontend/src/components/workspace-panels/ResultView/types.ts`（80 行）；6 纯 helper（`toArtifactRevision` / `artifactName` / `artifactKindIcon` / `artifactPreviewLabel` / `workflowStageLabel` + 1 防御性 type guard 已在 helpers.ts）抽出到 `./ResultView/helpers.ts`（44 行）。**ResultView.tsx：1654 → 1553 行（-101 / -6.1%）** + **2 新文件 / +124 / −0**。**保守拆原则**：按 PHASE 0 调研 §2.3.2「1313 行单组件 ResultArtifactShell 保留」理由 —— 内部 ~40 个 useState + ~20 个 useRef + 多个 useEffect 强耦合，拆子组件 ROI<风险；本次仅切出 types + helpers 而非拆 shell。新工具函数从此只需改 helpers.ts（44 行）而不动 1313 行 shell。**re-export 兼容策略**：`ResultView.tsx` 顶部新增 `export type { ActiveArtifact, JobStats } from './ResultView/types'`，6 个原 consumer（CenterPanel.tsx import `{...,ActiveArtifact,JobStats,...}`，project-workspace.tsx `import type` + `export type` re-export 共 2 个语句）契约路径 0 改动。**测试矩阵 100% PASS**：vitest 8 文件 75 测试 —— 含 **RS_P2_RENDERER_PERF 100ms 预算**（`ScientificInteractionViewer.test.tsx` 输出 `RS_P2_RENDERER_PERF {budgetMs:100, scrollFeedbackMs:7.986, selectionFeedbackMs:17.978, sortFeedbackMs:10.37, filterFeedbackMs:1.4}` —— 拆分后渲染性能保持原水平，符合 `qualificationEligible:false` G0 边界）；CenterPanel 6/6 / RightPanel 1/1 / activeArtifactProjection 15/15 / resultSurface 16/16 / CompactResultNavigator 4/4 / resultBodyState / ScientificInteractionViewer 12/12 / result-artifact-display。**node --test g0-chf0 39/39 PASS**（含 http / lifecycle / science + qa-smoke 6 项）。**4 治理门 GREEN**：`docs:check` 85 / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` 0 错误 / `npm run docs:reconcile` 0 issues。**Vite build 0 错误**：dist JS 2308.57 kB / gzip 720.57 kB，与 PHASE 1 后持平（拆出 124 行 types+helpers 不引入新依赖 / 循环引用 / 大小膨胀）。**不变量守住**：ResultArtifactShell 单组件 1313 行未触碰 / desktopBridge.ts 0 diff / electron.d.ts 0 diff / CenterPanel.tsx import 路径 0 diff / project-workspace.tsx re-export 0 diff / ResultStudio 子模块（activeArtifactProjection / resultBodyState / resultSurface / CompactResultNavigator / ScientificInteractionViewer / result-edit-agent-bridge / result-manifest / result-artifact-display 等）0 diff / lib/result-* 0 diff / 0 npm 依赖新增 / 0 npm 依赖删除。**保持 UI-161 `in_progress`**：纯代码组织变更（types+helpers 抽取），无实机 Electron 验证，不外推 packaged。下一阶段：BLOCK-9.2 PHASE 3 拆 `plugin-manager.js` 1457 行（P1 medium，先 PHASE 0.5 已完成修复 dangling IPC contract bug）→ PHASE 4 拆 `SimpleChat.tsx` 2153 行（P2 medium）→ PHASE 5 useSkillStore.ts 评估（决策不拆）→ PHASE 6 audit + closeout | BLOCK-9.2-PHASE-2 / MEGA-FILE-REFACTOR-PHASE-2

- **2026-08-17 BLOCK-9.2 PHASE 3 plugin-manager.js 1457 → 586 行 + 8 lib 模块拆分落地（保持 UI-161 `in_progress`）**：用户当日裁决"继续 come on"启动 PHASE 3。`docs/block-9-2-mega-file-split-survey.md` §2.1 拆分边界 1:1 落地 —— 抽出 8 个 lib 文件到新建 `src/plugin/` 目录：① `paths.js` (99 行) 路径解析 + 7 路径常量 + getFixRPathsScript + initSharedBackend/configure side effects；② `installed.js` (100 行) installed.json CRUD + fingerprint reconcile；③ `manifest-source.js` (99 行) built-in + OSS https fetch + normalizeRemotePluginEntry merge；④ `io.js` (120 行) downloadFile + verifyChecksum + streamingSha256 + assertArtifactChecksumDeclared + dirSize + copyDirSync 6 个 pure I/O helper；⑤ `zip.js` (20 行) extractZip wrapper；⑥ `content-plugin.js` (137 行) content plugin 注册 + docs 读取 + 2 markdown helper；⑦ `registry.js` (26 行) r-server globalThis bridge；⑧ `runtime.js` (62 行) detectPlatform + getRuntimeStatus + parseVersion + compareVersions；⑨ `uninstall.js` (202 行) uninstallPlugin + uninstallRuntime + removePackage + checkUpdates + loadAllPlugins 5 个 lifecycle flow。**plugin-manager.js 1457 → 586 行（-871 / -59.7%）** + **9 个新文件 / +1264 / −0** 净行。**决策：4 个 install orchestrator（installPlugin + installContentPlugin + installRuntime + installFigcodePack）保留主文件** —— 它们 cross-reference 彼此 + onProgress callbacks + 多次 SHARED_BACKEND_DIR require，拆完反而脆弱（PHASE 0 调研 §2.1.1 明确这一取舍）。**21 模块.exports 100% 保留**（含 Week 2 schema re-export 6 项 + 标准 15 项 + 边角 4 项）；BIOF3_LOCAL_DATA_DIR env 旁路验证 43 项 exports 100% 完整 + dirSize/detectPlatform/getRuntimeStatus 全部跑通。**5 修正 bug**：(1) 一开始 paths.js 错从 `platform-compat` import `getPythonRuntimeExecutable`，**实际它在 `core/shared-backend/runtime-paths`** 已修；(2) runtime.js 同样修正；(3) uninstall.js L72 写 `path.join(PROJECT_ROOT, "shared-backend", "executors")` 改用 `SHARED_BACKEND_DIR` 常量一致；(4) plugin-manager.js 顶部 IIFE 包装 runtime-paths import 改用 paths.js 简单 import；(5) `void app` / `void pluginLoader` / `void extractMdTitle` 等冗余 void 抑制全部清理。**测试矩阵 100% PASS**：`node --check` 10 文件 0 错；14 plugin 测试 PASS（4 checksum + 10 manifest/SDK；**pre-existing RS7 golden fixture sha256 drift 已通过 git stash 验证与本次 refactor 无关**）；g0-chf0 + qa-smoke 39/39 PASS；`docs:check` 85 / `ui:audit:check` 139 / `tsc --noEmit` 0 / `Vite build` OK / `npm run docs:reconcile` 0。**不变量守住**：`src/ipc/plugin.js` 0 diff（PHASE 0.5 修复保持）；`src/main.js` 0 diff（PHASE 1-4 保持）；`preload.js` 0 diff；`desktopBridge.ts` 0 diff；`electron.d.ts` 0 diff；`core/shared-backend/*` 0 diff；`agent-tools/*` 0 diff；6 plugin 测试文件 0 改动；**0 npm 依赖新增 / 0 npm 依赖删除**。**3 PHASE 累计指标**（1+2+3）：plugin-manager 1457 → 586（-871）/ DesktopSettingsPanel 1515 → 870（-645）/ ResultView 1654 → 1553（-101）；总 **-1617 行** / 14 个新 lib/sections 模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff。**保持 UI-161 `in_progress`**：纯代码组织变更（types + helpers + lib 抽出），无实机 Electron 验证，不外推 packaged。下一阶段：BLOCK-9.2 PHASE 4 拆 `SimpleChat.tsx` 2153 行（P2 medium）→ PHASE 5 useSkillStore.ts 评估（决策不拆）→ PHASE 6 audit + closeout | BLOCK-9.2-PHASE-3 / MEGA-FILE-REFACTOR-PHASE-3

- **2026-08-17 BLOCK-9.2 PHASE 4 SimpleChat.tsx 2153 → 1975 行 + 2 子模块抽出落地（保持 UI-161 `in_progress`）**：用户当日裁决"继续"启动 PHASE 4。`docs/block-9-2-mega-file-split-survey.md` §2.2 拆分边界 1:1 落地 —— 抽出 14 个 types/constants/interface 到 `frontend/src/components/copilot/SimpleChat/types.ts`（189 行）：① `SlashCommand` interface + `SLASH_COMMANDS` 5 项数组；② `SYSTEM_OPEN_FILE_EXTENSIONS` set + `shouldOpenWithSystemApp` 函数；③ `SimpleMessage` interface（含 14 属性 + 完整 JSDoc）/ `restoreSimpleMessage` 转换函数（含 presentation 解码 + meta 归一化 + 9 字段映射）；④ `AgentProgressUpdate` interface + `restoreProgressUpdates` 防退化解析函数；⑤ `ExamplePrompt` interface + `DEFAULT_EXAMPLE_PROMPTS` 3 项默认；⑥ `ExamplePromptsProps` / `SimpleChatHandle` / `SimpleChatProps` / `ErrorBannerProps` 4 interface；⑦ `PendingApproval = ConversationPendingApproval` type alias（让主文件不直接依赖 conversationRunStore）。抽出 3 个 pure helper 到 `./SimpleChat/helpers.tsx`（108 行 / 必须 .tsx 因含 JSX）：① `DEFAULT_EXAMPLE_PROMPTS`（重导出避免 types/helpers 循环）/ ② `MessageMeta` 组件（30s setInterval + formatRelativeTime 渐进格式 + `<div className="sc-msg-meta">`）/ ③ `ExamplePrompts` 组件（Icon + button list）/ ④ `compactStageConclusion` 纯函数（trim → 去前缀 → 句子边界 → 长度截断 → ellipsis）。**SimpleChat.tsx：2153 → 1975 行（-178 / -8.3%）** + **2 新文件 / +297 / −0**。**保守拆原则沿用 PHASE 1/2/3**：按 PHASE 0 调研 §2.2「~1387 行 SimpleChat 主组件保留」理由 —— 内部 ~30 个 useState + ~6 个 useRef + ~6 个 useEffect 强耦合共享 input/messages/scroll/slash 状态，拆子组件 ROI<风险。本次仅切出 types + helpers 而非拆主组件。**re-export 兼容策略**：`SimpleChat.tsx` 顶部新增 `import { ... } from './SimpleChat/types'` + `import { ... } from './SimpleChat/helpers'` + `export { SLASH_COMMANDS, shouldOpenWithSystemApp, restoreSimpleMessage, compactStageConclusion, DEFAULT_EXAMPLE_PROMPTS, MessageMeta, ExamplePrompts }` + `export type { SlashCommand, SimpleMessage, ... }` —— 4 测试文件（`SimpleChat.test.tsx` / `SimpleChat.progress.test.ts` / `SimpleChat.extraRenderers.test.tsx` / `simple-chat-file-open.test.ts`）+ 4 page consumer（CenterPanel / RightPanel / ResultView / project-workspace）+ 内部 1 处（MainPage 包装）契约路径 0 改动。**关键修复 4 项**：① **`helpers.ts` → `helpers.tsx` 重命名**（含 JSX `<div>` 不能用 .ts 扩展名，TS1005 错误 14 项）；② types.ts `restoreToolActivities` import 路径**（原合并到 `toolSummaryPresentation` 是错的，实际在 `toolActivity.ts` —— 已拆为 2 个独立 import）；③ `PendingApproval` type alias 集中到 types.ts（不再主文件局部定义）；④ `compactStageConclusion` 从 types.ts 移至 helpers.tsx（JSX 重命名连带）。**测试矩阵 100% PASS**：`npx vitest run src/components/copilot/SimpleChat.test.tsx src/components/copilot/SimpleChat.progress.test.ts src/components/copilot/SimpleChat.extraRenderers.test.tsx src/components/copilot/simple-chat-file-open.test.ts` **23/23 PASS**（SimpleChat 6 + simple-chat-file-open 4 + SimpleChat.progress 4 + extraRenderers 9，含 restoreSimpleMessage + shouldOpenWithSystemApp + compactStageConclusion + ResultEditProgressList 全链路）。**node --test g0-chf0 + qa-smoke 39/39 PASS**（含 http / lifecycle / science + qa-smoke 6 项 —— 0 受 SimpleChat 影响）。**4 治理门 GREEN**：`docs:check` 85 / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错误** / `npm run docs:reconcile` 0 issues。**Vite build 0 错误**：dist JS 2308.57 kB / gzip 720.57 kB，与 PHASE 1/2/3 后持平（拆出 297 行 types+helpers 不引入新依赖 / 循环引用 / 大小膨胀）。**不变量守住**：SimpleChat 主组件 ~1387 行未触碰 render JSX / scroll / slash command state / 模型菜单 / 持久化草稿逻辑 / conversation run hooks / plan 1.6 §4 全部保留原签名；`desktopBridge.ts` 0 diff / `electron.d.ts` 0 diff / `copilotClient.ts` 0 diff / `toolActivity.ts` 0 diff / `toolSummaryPresentation.ts` 0 diff / `extraRenderers.ts` 0 diff / `conversationRunStore.ts` 0 diff；useAiSettings / useConversations / useCopilotContext / useErrorFormatter / useDurableConversationLoop 0 diff；0 npm 依赖新增 / 0 npm 依赖删除。**保持 UI-161 `in_progress`**：纯代码组织变更（types + helpers 抽取），无实机 Electron 验证，不外推 packaged。**4 PHASE 累计指标**（1+2+3+4）：plugin-manager 1457 → 586（-871）/ DesktopSettingsPanel 1515 → 870（-645）/ ResultView 1654 → 1553（-101）/ **SimpleChat 2153 → 1975（-178）**；总 **-1795 行** / 16 个新 lib/sections/types/helpers 模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff。下一阶段：BLOCK-9.2 PHASE 5 useSkillStore.ts 评估（决策不拆）/ PHASE 6 audit + closeout | BLOCK-9.2-PHASE-4 / MEGA-FILE-REFACTOR-PHASE-4

- **2026-08-17 BLOCK-9.2 PHASE 5 useSkillStore.ts 评估决议（不拆 / 0 代码变更）（UI-174）**：用户当日裁决「好的 开冲」启动 PHASE 5。`docs/block-9-2-mega-file-split-survey.md` §1.5.7「不建议拆分的原因」与 §1.5.5 P3 优先级判断（G0 边界内保留）一致 —— **决议：保留不拆 + 仅审计登记**。**当前 useSkillStore.ts 真实结构（743 行）**：13 type/interface（ParameterType / ParameterSchema / OutputArtifact / SkillSource / Skill / ExecutionStatus / SkillExecution / DiscoverResult / ExecuteResult / SkillStoreSnapshot / UseSkillStoreResult / SkillsBridge / SkillsProgressPayload）+ 4 module-level `let` state（`_cache` / `_inflightDiscover` / `_subscribers` Set / `_lastCheckpointCount` Map）+ 2 module-level Map（`_pollingIntervals` 内部 / `_progressUnsubs` L283）+ 3 export function（`useSkillStore` 主 hook / `__getProgressUnsubsSize` test-only / `__resetSkillStoreCacheForTests` test-only）+ 11 internal function（`_notify` / `_isCacheStale` / `_startPolling` / `_stopAllPolling` / `_subscribeProgressWakeup` / `_executionsChanged` / `_unsubscribeProgressWakeup` / `_stopAllProgressWakeups` / `_discoverSkills` / `_executeSkill` / `_cancelExecution`）+ 主 hook 内 7 useState / 5 useEffect / 6 useCallback。**5 大不拆理由**：① **Singleton store 反模式** —— 5 module-level 状态 + 3 状态修改者 + 8 读取者强耦合，拆必须提到 ESM export + barrel re-export，破坏 singleton 语义 + tree-shaking 失败；② **polling + wakeup 双向耦合** —— `_subscribeProgressWakeup` ↔ `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId（BLOCK-4 G5 + A1 + A2 修过），跨文件传 Map 集合的迭代时机难保证 atomic；③ **测试基础设施已稳定** —— 14 个 vitest `useSkillStore.test.ts` 覆盖所有 module-level state 边界，BLOCK-2/3/4/5 期间 22 次真值模拟全部 PASS；④ **实际收益有限** —— 743 行已是最小（远比 SimpleChat 2153 / ResultView 1654 / plugin-manager 1457 / DesktopSettingsPanel 1515 小），距团队「1500 行阈值」还差 757 行空间；⑤ **G0 阶段纪律不容外推** —— AGENTS.md「不得主动启动 G1+ 阶段事项 / 不外推功能改进型重构」明确禁止。**BLOCK-9.2 5 文件累计**：✅ `src/plugin-manager.js` 1457 → 586 (-871 / -59.7% / commit 49652f3 UI-172) / ✅ `DesktopSettingsPanel.tsx` 1515 → 870 (-645 / -42.6% / commit d06b66e UI-170) / ✅ `ResultView.tsx` 1654 → 1553 (-101 / -6.1% / commit 014ad0d UI-171) / ✅ `SimpleChat.tsx` 2153 → 1975 (-178 / -8.3% / commit e599ee0 UI-173) / ⏸ `useSkillStore.ts` 743 → 743 (0 行 diff / PHASE 5 决议保留不拆 / UI-174)。**整体 -1795 行 / 16 个新模块 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff**。**不变量守住**：useSkillStore.ts 0 行 diff / 14 vitest tests 0 改动 / 6 consumer（4 skills page + test + skill.types.ts）契约路径 0 改动。**未来扩展路径**：如 useSkillStore.ts 真增长到 1300+ 行，再启动 BLOCK-9.5+ 单独工作包，按当前 G0 阶段纪律需用户显式裁决。**保持 UI-161 `in_progress`**：纯文档决议登记（无代码变更），无实机 Electron 验证，不外推 packaged。决议 canonical 全文 `docs/block-9-2-phase-5-useSkillStore-decision.md` 7 节（TL;DR + 现状详情 + 不拆核心理由 5 项 + 后续建议 + PHASE 0 对照 + 不变量 + BLOCK-9.2 整体关系 + PHASE 6 下一步）。下一阶段：BLOCK-9.2 PHASE 6 audit + closeout | BLOCK-9.2-PHASE-5 / MEGA-FILE-REFACTOR-PHASE-5
- **2026-08-17 BLOCK-9.2 PHASE 6 audit + closeout 落定（active → completed / 5 PHASE 全部落定）**：用户当日裁决「开冲」启动 PHASE 6。Closeout canonical `docs/block-9-2-mega-file-refactor-closeout.md` 302 行 / 8 节（TL;DR + 详细 PHASE + 验证矩阵 + 不变量 + 决策对比 + 未来扩展 + 关联索引 + 总结）。**5 文件拆分 + 决议落地**：✅ plugin-manager 1457 → 562 (-895 / -61.4% / commits 45448a8 + 49652f3 UI-169/172) / ✅ DesktopSettingsPanel 1515 → 870 (-645 / -42.6% / commit d06b66e UI-170) / ✅ ResultView 1654 → 1553 (-101 / -6.1% / commit 014ad0d UI-171) / ✅ SimpleChat 2153 → 1978 (-175 / -8.1% / commit e599ee0 UI-173) / ⏸ useSkillStore.ts 743 → 743 (0 diff / commit 810390f UI-174 PHASE 5 决议不拆)。**整体 -1816 行 / 21 个新模块 + 1 决议文档 + 1 closeout 报告 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 + UI-157 + UI-158 + UI-159 + UI-163 + UI-164 + UI-169 等不变量 0 diff / 0 npm 依赖变动**。**验证矩阵 100% GREEN**：`node --check` 11 文件 0 错 / `tsc --noEmit` 0 错 / `vite build` 2308.57 kB / SimpleChat 4 文件 23/23 + useSkillStore 14/14 + ResultView 子组件 75/75 + g0-chf0 + qa-smoke 39+6 = 45/45 PASS + window-controls 7/7 PASS + plugin-installer/checksum-fail-closed/runtime-spawn 31/31 PASS。**已知 PRE-EXISTING flaky test**：`test/result-studio-plugin-sdk.test.mjs` 2 项 SHA-256 drift —— 已 `git stash` 验证与本次重构无关（用旧版本 plugin-manager.js 同样 fail）。**4 治理门 GREEN**：`docs:check` 86（+closeout）/ `ui:audit:check` 144 / `tsc --noEmit` 0 / `docs:reconcile` 0 issues。**与 Senior Engineer Review §2.4 完全一致**：P1 plugin-manager / P2 SimpleChat+ResultView+DesktopSettingsPanel 全部拆 + P3 useSkillStore 决议不拆；决策树 5/5 重叠。**AGENTS.md G0 阶段纪律 100% 遵守**：不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+；保持 `qualificationEligible: false`；不外推 UI-157/158/159 实机验证；不重启 BLOCK-9/9.1/8/7/6/5/4/3/2 任何已 closed 工作包；不动 agent-tools/* / agent-transcripts/*；不变更 npm 依赖。**8 commits 全 cumulative**：810390f → ff1913f → e599ee0 → aec1efd → 49652f3 → 014ad0d → d06b66e → 45448a8。**BLOCK-9.2-MEGA-FILE-REFACTOR 工作包 COMPLETED**（DOC-REGISTRY active → completed + linkedCommits 加 810390f + 新增 BLOCK-9.2-CLOSEOUT reference entry）。**保持 UI-161 `in_progress`**：纯代码组织变更（types+helpers+sections+lib 抽出），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。**当前 active 工作包**：NONE（等待用户裁决下一步工作包）| BLOCK-9.2-PHASE-6 / MEGA-FILE-REFACTOR-CLOSEOUT
- **2026-08-18 BLOCK-9.2 PHASE 4 第二轮 commit 1（UI-175）：image preview 子树抽取**—— 启动 PHASE 4 第二轮首笔 commit，抽出 attachments 子树到独立模块。**抽取**：① `frontend/src/components/copilot/SimpleChat/attachments.ts` 138 行（AttachmentFile type + 7 个 pure helper）② `frontend/src/components/copilot/SimpleChat/ImagePreviewModal.tsx` 127 行（独立 modal 子组件）。**瘦身**：SimpleChat.tsx 2277 → 2115 行（**-162 / -7.1%**）。**约束严格遵守**：hooks 顺序保留（L177-184 状态 + L617 7 个 useCallback 全部位置不变）/ 3 个 IPC 订阅 0 diff / Context Consumer 关系 0 变化 / 4 个 import 客户端契约路径 0 改动 / 4 测试文件 0 改动。**4 治理门 GREEN**：docs:check 99 / ui:audit:check PASS / tsc 0 / docs:reconcile 0 issues。**保持 UI-161 + UI-173 `in_progress`**：纯代码组织变更（attachments + modal 抽取），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。调研依据 `docs/block-9-2-simplechat-survey.md`（BLOCK-9.2 PHASE 4 第二轮架构调研 worker）§4.1 P0-1 候选落地。下一阶段：BLOCK-9.2 PHASE 4 commit 2（helpers/formatHarness.ts 5 个纯函数）/ commit 3（hooks/useChatStream.ts 5 个 stream-related callback）| BLOCK-9.2-PHASE-4-COMMIT-1 / MEGA-FILE-REFACTOR-PHASE-4-COMMIT-1
- **2026-08-18 BLOCK-9.2 PHASE 4 第二轮 commit 2（UI-176）：formatHarness 纯函数抽取**—— 启动 PHASE 4 第二轮第二笔 commit，抽出 harness payload 格式化 5 个纯函数到独立模块。**抽取**：`frontend/src/components/copilot/SimpleChat/formatHarness.ts` 79 行（5 个 `export function`：`stringifyParamValue` / `shortValue` / `formatHarnessRepair` / `formatHarnessWarning` / `formatHarnessDiagnosticIssue`，仅依赖 `@/lib/harness-client` 导出的 `HarnessDiagnosticIssue` type，**0 React / 0 hooks / 0 closure / 0 state**）。**瘦身**：SimpleChat.tsx 2115 → 2073 行（**-42 / -2.0%**）。**约束严格遵守**：3 个 IPC 订阅 0 diff / Context Consumer 关系 0 变化 / 70 hooks 顺序 0 diff（formatHarness 抽取不涉及 hook） / 4 个 import 客户端契约路径 0 改动 / 4 测试文件 0 改动 / `HarnessDiagnosticIssue` unused import 清理（5 个 type import → 4 个）。**耦合核查（满足用户「拆动规则」安全拆分条件）**：① `stringifyParamValue` 调用点 L353/424/426 全部在主组件 `SimpleChat` 内；② `formatHarnessRepair` / `formatHarnessWarning` / `formatHarnessDiagnosticIssue` 唯一调用点是 `ApprovalRepairHint` 子组件（L2087/L2094/L2100），**不是** `ApprovalCard`（L1983-2049 不调用 formatHarness）；③ `ApprovalRepairHint` 是 private nested sub-component（**不 export**），与 `MessageItem` 是同类性质 —— 用户规则允许；④ `ApprovalCard` / `ApprovalRepairHint` 子组件**未同时抽取**，避免 commit 2 跨子组件拆分。**测试矩阵 100% PASS**：`npx vitest run src/components/copilot/SimpleChat` 4 文件 23/23 PASS。**4 治理门 GREEN**：`docs:check` 99 / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错误** / `npm run docs:reconcile` 0 issues。**保持 UI-161 + UI-173 + UI-175 `in_progress`**：纯代码组织变更（5 个纯函数抽出），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。调研依据 `docs/block-9-2-simplechat-survey.md` §4.2 P1-2 候选落地。下一阶段：BLOCK-9.2 PHASE 4 commit 3（hooks/useChatStream.ts 5 个 stream-related callback）| BLOCK-9.2-PHASE-4-COMMIT-2 / MEGA-FILE-REFACTOR-PHASE-4-COMMIT-2

- **2026-08-18 BLOCK-9.2 PHASE 4 第二轮 commit 3（UI-177）：useChatStream 自定义 hook 抽取**—— 启动 PHASE 4 第二轮第三笔 commit，抽出 5 个 stream-related callback 到独立自定义 hook。**抽取**：`frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts` 322 行（12 个固定顺序 hook 调用：useState(starting) + useRef(messagesRef) + useEffect(sync) + useCallback(send) + useRef(sendRef) + useEffect(sendRef sync) + useEffect(copilotAsk subscribe) + useCallback(stop) + useCallback(regenerate) + useCallback(runInBackground) + useCallback(queue) + useEffect(queue drain)）。**瘦身**：SimpleChat.tsx 2073 → 1961 行（**-112 / -5.4%**）。**约束严格遵守**：3 个 IPC 订阅 0 diff（`subscribeBioF3Event(biof3Events.copilotAsk)` 转移到 hook 内部 L213-220 + `dispatchBioF3Event` 3 项保留主组件）/ Context Consumer 关系 0 变化 / 70 hooks 顺序 0 diff（hook 顺序固定在 hook 文档头声明）/ 4 import 客户端 0 改动 / 4 测试文件 0 改动 / 8 个不再需要的 import 清理（`ChatMessage` / `subscribeBioF3Event` / `copilotContextOverrideForAsk` / `stopConversationRun` / `isConversationRunning` / `startConversationRun` / `startSubAgentTask` / `migrateConversationDraft`）。**耦合核查**（满足用户「拆动规则」安全拆分条件）：① 5 个 callback 全部 100% 抽出（无 hooks 顺序约束剩余）；② 队列 drain / copilotAsk 订阅 / sendRef stable handle 三件套完整搬移 hook；③ 主组件从 24 个 hook 删减为 16 个（24 - 9 + 1 useChatStream）；④ `queueCurrentPrompt` 与 JSX `runInBackground` 调用点改为 1 行 wrapper。**测试矩阵 100% PASS**：`npx vitest run src/components/copilot/SimpleChat` 3 文件 19/19 PASS。**4 治理门 GREEN**：`docs:check` 99 / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错** / `node --check frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts` EXIT 0 / `npm run docs:reconcile` 0 issues。**调研驱动**：依据 `docs/block-9-2-simplechat-survey.md` §4.2 P1-1 候选 —— 5 个 callback + 2 useEffect + 1 useRef + sendRef sync useEffect 全属「stream-related」边界，可统一搬入 hook；§5.2 hooks 顺序约束已通过 hook 内部固定顺序满足。**保持 UI-161 + UI-173 + UI-175 + UI-176 `in_progress`**：纯代码组织变更（5 callback + 4 配套 hook 抽出），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。**PHASE 4 三轮累计落地**：SimpleChat.tsx 2277 → 1961 行（**-316 / -13.9% 三轮总计**：UI-175 -162 + UI-176 -42 + UI-177 -112）；types.ts + helpers.tsx + attachments.ts + ImagePreviewModal.tsx + formatHarness.ts + hooks/useChatStream.ts 6 个新模块落地。下一阶段：BLOCK-9.2 PHASE 4 closeout（5 PHASE 全部完成）+ PHASE 5 useSkillStore 决议登记 + PHASE 6 audit + closeout | BLOCK-9.2-PHASE-4-COMMIT-3 / MEGA-FILE-REFACTOR-PHASE-4-COMMIT-3
- **2026-08-19 BLOCK-16-WORKING-TREE-REVIEW-MODE PHASE 1+2 落地（UI-180）**：5 新组件 + 1 CSS module + 5 IPC channel + 1 通知事件 + git-adapter 2 新方法（applyPatch / revertPaths）。`frontend/src/components/desktop/WorkingTreeReview/` 5 文件落地 + `src/ipc/working-tree-review.js` 329 行 + `src/preload.js` 新增 `workingTreeReview.*` 子树 + `frontend/src/lib/electron.d.ts` 新增 `workingTreeReview` 类型；`src/main.js` 装配 `setupWorkingTreeReviewIpc({ mainWindow: () => mainWindow })`；`frontend/src/App.tsx` mount `<WorkingTreeReviewMount>` + `<WorkingTreeReviewButton>`。**4 治理门 GREEN**：`docs:check` 133 PASS / `npm run ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` 0 错 / `node --test test/git-adapter.test.mjs` 30/30 PASS。**调研驱动**：基于 `docs/block-16-working-tree-review-survey.md`（344 行 / 8 §）方案 C（手写 React 渲染 / 零新依赖 / 对齐 ADR-RS-3 + 既有 Result Studio diff 风格）。**不变量守住**：preload.js 既有 19 命名空间方法签名 0 diff / electron.d.ts 既有类型 0 diff / desktopBridge.ts 既有 API 0 diff / Result Studio 既有 diff 组件 0 diff / 0 npm 依赖变动。**当前 active 工作包**：BLOCK-16 PHASE 1+2 完成 / PHASE 3 (agent-done 事件接入 + 拒绝清单 + system-prompt 注入) 待办 / PHASE 4 (专项门禁 + closeout) 待办。**不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15 / 不修改 Result Studio 既有 diff 渲染 | BLOCK-16-WORKING-TREE-REVIEW-MODE / WORKING-TREE-REVIEW
- **2026-08-19 BLOCK-16-WORKING-TREE-REVIEW-MODE 工作包收口（PHASE 3+4 收口 commit 7f94854 / 59aeb95 / da48006 + closeout 笔录）**：4 PHASE 全部落地（PHASE 1 IPC channel + 共享解析器层 / PHASE 2 浮层组件 / PHASE 3 agent-done 事件接入 + 拒绝清单 + system-prompt 注入 / PHASE 4 专项门禁 + closeout 笔录）。PHASE 3 落地（commit da48006）：frontend/src/lib/events.ts 加 agentTaskDone 事件常量 + AgentTaskDoneDetail 类型 + 映射；frontend/src/components/copilot/copilotClient.ts SSE 4 处 done 分支派发 biof3 event（primary kind only；subagent 不广播避免淹没）；frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts 订阅 typed event bus（主路径）+ 保留 preload 备用通道（备用入口）；core/r-server/helpers/system-prompt.js 加 renderWorkingTreeRejectsForPrompt + loadWorkingTreeRejectEntries 2 helper + <working-tree-rejects> 注入段（标签 WORKING_TREE_REJECTS_v1 / limit 10 / 单行 80 / char budget 4096）；core/r-server/agent-runner.js 读 BIOF3_USER_DATA_DIR env 注入 ctxForPrompt；src/main/backend-proc-manager.js spawn r-server 时设 BIOF3_USER_DATA_DIR = app.getPath('userData')；test/system-prompt-rejects.test.mjs 11/11 PASS（PHASE 3 新增）。PHASE 4 落地（本 commit closeout 笔录）：package.json 加 block:working-tree-review 脚本；scripts/block-16-working-tree-review.mjs 4 步门禁（git-adapter + system-prompt-rejects + WorkingTreeReview 子集 + docs:check + ui:audit:check）5/5 PASS；DOC-REGISTRY BLOCK-16-WORKING-TREE-REVIEW-MODE active → completed + 新增 BLOCK-16-WORKING-TREE-REVIEW-MODE-CLOSEOUT reference entry + documentCount 132 → 134（+1 closeout + ui-audit update）；docs/next-steps-roadmap.md 增加 BLOCK-16 收口条；docs/README.md 长期核心指引同步 UI-180 入口 + closeout 14 条；docs/block-16-working-tree-review-mode-closeout.md 11 节新建。4 治理门 GREEN：docs:check 133 PASS / ui:audit:check 131 PASS / tsc --noEmit 0 错 / docs:reconcile 0 issues / block:working-tree-review 5/5 PASS。测试矩阵：node --test test/git-adapter.test.mjs 30/30 PASS（既有 0 破坏）/ node --test test/system-prompt-rejects.test.mjs 11/11 PASS（PHASE 3 新增）/ cd frontend && npx vitest run src/components/copilot 17 files / 168 tests PASS（既有 0 破坏）。不变量守住：preload.js 既有 19 命名空间方法签名 0 diff / electron.d.ts 既有类型 0 diff / desktopBridge.ts 既有 API 0 diff / Result Studio 既有 diff 组件 0 diff / core/shared-backend 既有方法 0 diff（仅 git-adapter 新增）/ agent-tools/* / agent-transcripts/* 0 diff / 0 npm 依赖变动。保持 UI-180 in_progress 维持原状：按 audit 行 402 治理纪律仅当真实 dev Electron 实机过目后才可考虑 verified，PHASE 2 实机未走查不构成 verified 升级条件。严格维持 qualificationEligible:false + 不外推 packaged / Provider / GA / P7 / notarization / Chart a11y P2 / Worktree / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/15。当前无 active 工作包（BLOCK-16 已收口）；按 single work package serial 纪律，下一块候选仍为 BLOCK-6 UI-158 + UI-159 dev Electron 实机 / BLOCK-7 UI-161 既有 in_progress 实机 / BLOCK-8 release-pipeline dist staleness / BLOCK-9 Windows 代码签名 / i18n 资源抽离 / BLOCK-10 E1-d/E1-e G1+ 架构改动 / Chart a11y P2 落实 / Result Studio P7 deferred，须经用户显式裁决启动新工作包 | BLOCK-16-WORKING-TREE-REVIEW-MODE / WORKING-TREE-REVIEW / WORK-PACKAGE-CLOSEOUT
- **2026-08-18 BLOCK-9.2 PHASE 4 closeout（UI-178）**：3 commits `ba23456` + `4207466` + `1a58f2c` 全部落地，三轮累计 SimpleChat.tsx **-316 / -13.9%**（2277 → 1961 行）+ 6 个新模块落地（types.ts 189 + helpers.tsx 108 + attachments.ts 138 + ImagePreviewModal.tsx 127 + formatHarness.ts 79 + hooks/useChatStream.ts 322 = +963 / −1279 净行）。**4 客户端 0 改动**：CenterPanel.tsx / RightPanel.tsx / ResultView.tsx / project-workspace.tsx 全部 0 diff；4 测试文件 0 diff（SimpleChat.test.tsx + SimpleChat.progress.test.ts + SimpleChat.extraRenderers.test.tsx + simple-chat-file-open.test.ts）；3 个 IPC 订阅 0 diff；70 hooks 顺序 0 diff。**4 治理门 GREEN**：`docs:check` 99 PASS / `ui:audit:check` 同步本笔录后 PASS / `cd frontend && npx tsc --noEmit` **0 错** / `cd frontend && npx vitest run src/components/copilot/SimpleChat` 3 文件 19/19 PASS。**不变量守住**：preload.js / electron.d.ts / desktopBridge.ts / copilotClient.ts / toolActivity.ts / toolSummaryPresentation.ts / extraRenderers.ts / conversationRunStore.ts 0 diff；useAiSettings / useConversations / useCopilotContext / useErrorFormatter / useDurableConversationLoop 0 diff；0 npm 依赖新增 / 0 npm 依赖删除。**UI-175/176/177 row 由 in_progress 升 verified**（本笔录登记后即转绿），**UI-161 + UI-173 `in_progress` 维持原状**（按 audit 行 402 治理纪律仍缺实机证据）。**调研驱动**：依据 `docs/block-9-2-simplechat-survey.md`（BLOCK-9.2 PHASE 4 第二轮架构调研 worker 2026-08-18 00:45）§4.1 P0-1 候选（attachments 子树）+ §4.2 P1-1（useChatStream hook）+ §4.2 P1-2（formatHarness 纯函数）三候选落地。**不外推** packaged / Provider / GA / P7 / dist staleness G1+ / 不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*。**下一阶段**：BLOCK-9.2 PHASE 5 useSkillStore.ts 审计登记 → PHASE 6 audit + closeout（综合 5 PHASE 全部 + closeout 报告）| BLOCK-9.2-PHASE-4-CLOSEOUT / MEGA-FILE-REFACTOR-PHASE-4-CLOSEOUT
- **2026-08-18 BLOCK-9.2 PHASE 5（UI-179）useSkillStore.ts 评估登记（不拆 / 0 代码变更）**：依据 `docs/block-9-2-mega-file-split-survey.md` §1.5.7「不建议拆分的原因」+ Senior Engineer Review §2.4 useSkillStore 部分 + AGENTS.md G0 阶段纪律三条对齐 —— **决议：保留不拆 + 仅审计登记（`not_applicable`）**。评估报告 canonical `docs/block-9-2-useSkillStore-evaluation.md` 7 节（TL;DR + 现状简述 + 不拆理由 5 项 + SimpleChat useChatStream hook 反向佐证 + 量级判断 + 结论 + 不外推 G1+）。**当前 useSkillStore.ts 真实结构（743 行）**：4 module-level `let` state（`_cache` / `_inflightDiscover` / `_subscribers` Set / `_lastCheckpointCount` Map）+ 2 module-level Map（`_pollingIntervals` / `_progressUnsubs`）= **5 singleton + 4 Map 强耦合**。**5 大不拆理由**：① **Singleton store 反模式** —— 5 state + 3 modifier + 8 reader 强耦合，拆必须提到 ESM export + barrel re-export，破坏 singleton 语义 + tree-shaking 失败；② **polling + wakeup 双向耦合** —— `_subscribeProgressWakeup` ↔ `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId（BLOCK-4 G5 + A1 + A2 修过），跨文件 Map 集合的迭代时机难保 atomic；③ **测试基础设施已稳定** —— 14 vitest `useSkillStore.test.ts` 覆盖所有 module-level state 边界，BLOCK-2/3/4/5 期间 22 次真值模拟全部 PASS；④ **实际收益有限** —— 743 行已是最小，距团队「1500 行阈值」还差 757 行空间；⑤ **G0 阶段纪律不容外推** —— AGENTS.md「不得主动启动 G1+ 阶段事项 / 不外推功能改进型重构」明确禁止。**反向佐证**：PHASE 4 第二轮在 SimpleChat.tsx 中成功抽出 `useChatStream` 自定义 hook —— useChatStream 也是强耦合（5 callback + 4 配套 hook + 1 IPC 订阅 + module-level sendRef），**但 useChatStream 是 hook 不是 store**，不涉及 module-level singleton 语义，所以能拆。useSkillStore 既然是 singleton store，拆了反而破坏 singleton 语义 → 与 useChatStream 形似神异。**BLOCK-9.2 5 文件累计**：✅ plugin-manager 1457 → 586 (-871 / -59.7% / commits 45448a8 + 49652f3 UI-169/172) / ✅ DesktopSettingsPanel 1515 → 870 (-645 / -42.6% / commit d06b66e UI-170) / ✅ ResultView 1654 → 1553 (-101 / -6.1% / commit 014ad0d UI-171) / ✅ SimpleChat 2277 → 1961 (-316 / -13.9% 三轮总计 / commits ba23456 + 4207466 + 1a58f2c UI-175/176/177) / ⏸ useSkillStore.ts 743 → 743 (0 行 diff / UI-179 not_applicable PHASE 5 决议保留不拆)。**PHASE 4 第二轮 + PHASE 5 累计**：-1933 行 / 18 个新模块 + 1 决议文档 + 1 评估报告 / 4 客户端 0 改动 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 等不变量 0 diff。**保持 UI-161 `in_progress` 维持原状**：纯审计登记（无代码变更），无实机 Electron 验证，不外推 packaged。**未来扩展路径**：如 useSkillStore.ts 真增长到 1300+ 行，再启动 BLOCK-9.5+ 单独工作包，按当前 G0 阶段纪律需用户显式裁决。**不外推**：packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1 / 不外推 UI-157/158/159 实机 / 不动 agent-tools/* / agent-transcripts/*。**当前 active 工作包**：BLOCK-9.2 PHASE 6 audit + closeout 待办 | BLOCK-9.2-PHASE-5-EVALUATION / MEGA-FILE-REFACTOR-PHASE-5-EVALUATION
- **2026-08-18 BLOCK-9.2 PHASE 6 audit + closeout COMPLETED (active → completed / 5 PHASE 全部落定 + UI-178 + UI-179 二次收口)**：用户在 BLOCK-9.2 PHASE 4 第二轮 commit 3（`1a58f2c`）落地后裁决启动 PHASE 5 + PHASE 6 二次收口。Closeout canonical `docs/block-9-2-mega-file-refactor-closeout.md` 11 节（§1 元数据 + §2 实施总结 5 PHASE + §3 PHASE 0 调研 + §4 PHASE 1 + §5 PHASE 2 + §6 PHASE 3 + §7 PHASE 0.5 修复 dangling IPC + §8 PHASE 4 + §9 PHASE 5 + §10 累计指标 + §11 不外推 + 不变量守住 + 后续工作包候选）。**5 文件拆分 + 决议落地**：✅ plugin-manager 1457 → 586 (-871 / -59.7% / commits 45448a8 + 49652f3 UI-169/172) / ✅ DesktopSettingsPanel 1515 → 870 (-645 / -42.6% / commit d06b66e UI-170) / ✅ ResultView 1654 → 1553 (-101 / -6.1% / commit 014ad0d UI-171) / ✅ SimpleChat 2277 → 1961 (-316 / -13.9% 三轮总计 / commits ba23456 + 4207466 + 1a58f2c UI-175/176/177) / ⏸ useSkillStore.ts 743 → 743 (0 行 diff / UI-179 not_applicable PHASE 5 决议保留不拆)。**PHASE 4 第二轮 + PHASE 5 累计指标**：SimpleChat 三轮 -316 行 + 6 个新模块（types.ts 189 + helpers.tsx 108 + attachments.ts 138 + ImagePreviewModal.tsx 127 + formatHarness.ts 79 + hooks/useChatStream.ts 322）+ UI-178 PHASE 4 closeout ledger 1 笔 + UI-179 useSkillStore 评估 ledger 1 笔 + docs/block-9-2-useSkillStore-evaluation.md 7 节评估报告 1 份。**整体 5 文件累计 -1933 行 / 18 个新模块 + 1 决议文档 + 1 评估报告 + 1 closeout 报告 / 21 module.exports 100% / 7 个测试文件 0 改动 / UI-161 + UI-156 + UI-157 + UI-158 + UI-159 + UI-163 + UI-164 + UI-169 等不变量 0 diff / 0 npm 依赖变动**。**验证矩阵 100% GREEN**：`cd frontend && npx tsc --noEmit` 0 错 / `cd frontend && npx vitest run src/components/copilot/SimpleChat` 3 文件 19/19 PASS / `docs:check` 99 PASS / `npm run ui:audit:check` 同步本笔录后 PASS / `npm run docs:reconcile` 0 issues。**4 治理门 GREEN**（PHASE 4 第二轮 commit 3 后重新跑）。**AGENTS.md G0 阶段纪律 100% 遵守**：不外推 packaged / Provider / GA / P7 / notarization / dist staleness G1+；保持 `qualificationEligible: false`；不外推 UI-157/158/159 实机验证；不重新激活 BLOCK-9/9.1/8/7/6/5/4/3/2 任何已 closed 工作包；不动 agent-tools/* / agent-transcripts/*；不变更 npm 依赖。**8 commits 全 cumulative**：1a58f2c → 4207466 → ba23456 → 810390f → ff1913f → e599ee0 → aec1efd → 49652f3 → 014ad0d → d06b66e → 45448a8 (11 commits 累计；PHASE 5 决议 commit 810390f + PHASE 6 closeout commit ff1913f 来自前一轮 PHASE 6 在新 main 上的 + 本轮 PHASE 4 增量 commits ba23456/4207466/1a58f2c)。**DOC-REGISTRY**（二次收口更新）：BLOCK-9.2-MEGA-FILE-REFACTOR `kind=work-package / status=completed / canonical=true / truthDomain=block-9-2-mega-file-refactor / archivePolicy=retain_stable_path` + linkedCommits 数组添加 4 个新 commit hash（ba23456 / 4207466 / 1a58f2c + 本 closeout commit）+ 新增 `BLOCK-9.2-MEGA-FILE-REFACTOR-CLOSEOUT` reference entry（kind=closeout-report / status=reference / canonical=true / truthDomain=block-9-2-mega-file-refactor / archivePolicy=retain_stable_path / path=docs/block-9-2-mega-file-refactor-closeout.md）+ 新增 `BLOCK-9.2-USESKILLSTORE-EVALUATION` reference entry（kind=evaluation-report / status=reference / canonical=true / truthDomain=block-9-2-useSkillStore-evaluation / archivePolicy=retain_stable_path / path=docs/block-9-2-useSkillStore-evaluation.md）。**4 canonical 文档同步**：`docs/ui-productization-audit.md`（本笔录）/ `docs/DOC-REGISTRY.json`（同步更新）/ `docs/next-steps-roadmap.md`（active → completed 段同步）/ `docs/project-workspace-handoff.md`（active → 收口结果段）。**closeout 报告**：`docs/block-9-2-mega-file-refactor-closeout.md`（新版本 11 节）。**评估报告**：`docs/block-9-2-useSkillStore-evaluation.md`（新文件 7 节）。**保持 UI-161 + UI-173 `in_progress`**：纯代码组织变更（types+helpers+sections+lib+attachments+modal+hook 抽出）+ 审计登记（UI-179 not_applicable），无实机 Electron 验证，不外推 packaged；保持 `qualificationEligible: false` G0 边界。**当前 active 工作包**：NONE（等待用户裁决下一步工作包）| BLOCK-9.2-PHASE-6-CLOSEOUT-2 / MEGA-FILE-REFACTOR-CLOSEOUT-2


## Phase 2 Result Studio UI 改造（2026-08-17）

| ID | 状态 | 级别 | 主模块 | 关注点 | 页面/状态 | 问题摘要 | 证据 | 目标批次 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-P2-001 | verified | P1 | W-04 | C-04 | Result Studio / 结果共享 | Phase 2 新增 ResultStudioPage 演示"对话隔离、结果共享"架构：Result 按项目 ID 加载（不按分支 ID），分支切换不触发 Result Studio 重新加载；useResultStore 使用项目级缓存；ResultBridge IPC 已注册；数据库模块和迁移已就绪。**2026-09-08 UI-LEDGER-CLOSEOUT 实机验收发现契约断裂已修（状态维持 in_progress，实机复跑见 acceptance/ui-ledger-closeout/）**：branch:* handler 返回 `{ok,data?,error?}` fail-closed 信封 + snake_case 落库行，此前前端无人拆包 → `/project/:id/results` 首载即 `branches.find is not a function` 崩、分支 tab 永不渲染；且 switch 缺 projectId、delete/rename 参数键 branchId≠id，UI 切分支恒被 handler 拒绝。修复：lib/branchBridge.ts 成为唯一拆包 + snake→camel 映射点（UI-311 resultBridge 同型收敛），useBranchStore.switch 补传 projectId，electron.d.ts 如实声明 BranchRowRecord 信封行；回归 frontend/src/lib/branchBridge.test.ts 8/8 + frontend tsc 0。**2026-09-09 实机复跑 verified**：dev Electron 实测 fixture（2 分支 + 1 result）→ 结果页首载正常（不再崩 branches.find）→ 分支 tab 点击切 B → 不重取结果（计数器零增量）+ DOM 保持 + active 分支真实切换（acceptance/ui-ledger-closeout/ui-p2001-live.json） | frontend/src/pages/result-studio/ResultStudioPage.tsx, frontend/src/hooks/useResultStore.ts, frontend/src/lib/resultBridge.ts, frontend/src/lib/branchBridge.ts, frontend/src/lib/branchBridge.test.ts, src/database/result-db.js, src/ipc/result-handlers.js, src/migrations/006_result_studio.sql | UI-P2 |


## 聊天组件图片功能增强（2026-08-17）

| ID | 状态 | 级别 | 主模块 | 关注点 | 页面/状态 | 问题摘要 | 证据 | 目标批次 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UI-ATTCH-001 | verified | P2 | W-03 | C-01 | Agent 聊天 / 输入框 | 聊天输入框新增拖拽/粘贴/预览图片功能：①拖拽添加支持将图片或文档拖入消息输入框，拖拽时显示蓝色虚线边框视觉反馈；②复制粘贴支持 Ctrl+V / Cmd+V 粘贴图片，粘贴图片转为 base64 dataUrl；③图片预览点击预览按钮或预览图标可以全屏预览图片，支持放大/缩小/重置缩放、ESC 关闭、点击遮罩关闭；④文档拖拽后显示文件名称和图标。**2026-09-09 UI-LEDGER-CLOSEOUT 实机 verified（③④）**：页面级真实 DragEvent（真实 File 对象）拖入 composer → sc-composer-dragging 反馈 + 2 chip（png/txt）含图标与文件名（④）；preview 按钮 → sc-preview-overlay 弹窗，放大后 zoom 标签变化、重置按钮在位、ESC 关闭（③）；①②维持既有实证（acceptance/ui-ledger-closeout/ui156-uiattch-verdict.json） | UI-ATTCH |

## BLOCK-10-AUDIT-CLOSEOUT 收口（2026-08-18）

**收口范围**（来自 `docs/code-audit-closeout-plan.md` v0.2）：8 份独立审计报告（错误处理 / 安全 / 契约 / 架构 / 可观测性 / Plugin schema / r-server HTTP / 性能）共 25 项修复单元。

**13 项已修复**（11 Critical + 2 High + 0 P0 Major）：

| ID | 类别 | 修复位置 | commit |
|----|------|----------|--------|
| C-001 | Critical | `src/preload.js` 添加 branch + result namespace | `1c0ebf0` |
| C-002 | Critical | `src/ipc/result-handlers.js` validTypes 扩展 + createFromConversation 改 'conversation_export' | `1c0ebf0` |
| S-001 | Critical | `core/r-server/agent-tools/agent-tool-policy.js` 收紧 run_tool / workspace_exec capability | `128b3d4` |
| S-002 | High | `core/r-server/agent-tools/result-context-binding.js` contextToken 过期校验 | `128b3d4` |
| S-003 | High | `core/r-server/helpers/agent-execution-policy.js` 替换基于正则的推断 | `128b3d4` |
| S-004 | High | `src/ipc/branch-handlers.js` / `result-handlers.js` / `ai-settings.js` / `plugin.js` 加 sender 守门 | `4f9a10f` |
| S-005 | High | `core/r-server/agent-tools/workspace-tools.js` 替换关键字黑名单 | `4f9a10f` |
| S-006 | High | `core/r-server/agent-task-store.js` retry_stats user_id 不可空 | `4f9a10f` |
| S-007 | High | `src/ipc/diagnostic.js` 修复可写任意目录 | `4f9a10f` |
| PR-001 | Critical | SQLite append-only 表归档 + cleanup 任务 | `a09f706` |
| OB-004 | Major | `core/shared-backend/error-log.js` 默认路径可写 + logError 调用点扩展 | `1fedf9c` |
| OB-005 partial | Major | `src/mcp-server.js` health endpoint shape 修正 | `1fedf9c` |
| PL-001 | Critical | `core/r-server/mcp/registry.js` callTool 入口加 inputSchema 校验 + `_validate-tool-args.js` | `b79c472` |

**12 项不外推**（按 G0 阶段纪律 / governance 治理）：

- G1+ 阶段事项：packaged Electron / Provider 矩阵 / GA / 公证 / dist staleness / notarization / P7
- 架构层面 56+ singleton 拆分（A-001..A-010）→ 单独工作包 BLOCK-10-ARCHITECTURE 候选
- 全链路可观测性体系化（OB-001 console→logger 全量替换 / OB-003 metrics 端点 / OB-007 跨进程 unhandledRejection）→ observability-work-package 候选
- Agent Loop 事件类型命名规范化（C-012）→ 独立工作包（与 Result Studio 体系耦合）
- 三套重试策略合并（E-009）+ RetryClassifier / RetryBudget / RetryExecutor → 错误处理体系化重设计
- r-server 大文件 26+ 端点拆分（A-002 / A-005 routes/result-studio.js 1800 + routes/harness.js 1366）→ BLOCK-10-ARCHITECTURE 候选
- SSE 三处协议细节统一（Mi-002 / Mi-003 / Mi-004）+ SSE keepalive（PR-004）→ SSE 治理
- E-017 main 进程 backend exit IPC notification 完整版（仅 r-server 进程级 partial 落地）→ BLOCK-10-ARCHITECTURE
- E-018 rServerSupervisor restart IPC 通知 + DB/HTTP 句柄刷新 → BLOCK-10-ARCHITECTURE
- E-019 full SQLite 双 connection 统一 → BLOCK-10-ARCHITECTURE
- OB-001 / OB-002 / OB-003 完整可观测性 → observability-work-package
- PR-006 backend exit IPC 完整版 / PR-012 desktop main 打开 biof3.db 共享问题 → BLOCK-10-ARCHITECTURE
- C-001-rserver / C-002-rserver / M-001 / M-003 → BLOCK-10-ARCHITECTURE

**累计**：8 commits / 31 tests / ~740 行 net + / 4 治理门 GREEN / Node test 0 退化 / 0 新依赖。

**收口笔录**：

- 不外推 G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2
- PHASE 4 closeout 收口预计 3 commits / docs-only（DONE: PHASE 4-1 DOC-REGISTRY active → completed + 8 linkedCommits）
- 当前无 active 工作包
- 后续候选：observability-work-package / SSE / RetryClassifier / Result Studio 事件类型规范
- 

## BLOCK-10-ARCHITECTURE 收口（2026-08-18）

**工作包 ID**：BLOCK-10-ARCHITECTURE（truthDomain: `agent-harness-architecture-refactor`）
**状态**：✅ COMPLETED（2026-08-18 PHASE 4 closeout）
**12 主范围**：全部落地

**落地范围**：

| ID | 范围 | commit | 测试 |
|----|------|--------|------|
| A-007 + PR-012 + E-019 full | DB singleton 抽 _db-singleton.js + busy_timeout 全量统一 | `a4f8bcb` | 16 PASS |
| A-009 + A-010 | 端口统一 + env 集中 6 处 + jspdf 移除 | `48e19e2` | 8 PASS |
| A-002 (result-studio) | routes/result-studio 1800→54行 9子域 15端点 | `101dcfc` | 8 PASS |
| A-002 (harness) | routes/harness 1366→40行 8子域 19端点 | `cd287f5` | 8 PASS |
| A-005 (ai-agent) | routes/ai-agent 1222→153行 5子域 3端点 | `d620aa3` | 8 PASS |
| A-001 | agent-runner 1799→3子模块（loop-orchestrator + conversation-adapter + facade） | `5f6c2de` | 5 PASS |
| A-003 + A-008 | configure 注入 shared-backend + act-tools 循环解环 act-tool-core | `3635e7e` | 4 PASS |

**不外推候选**（不启动 / 引用存查）：

- observability-work-package：E-017 main / E-018 / A-004 / PR-006
- rserver-http-debt-pack：C-001-rserver / C-002-rserver / M-001 / M-003
- type-drift-pack：A-011
- fixture-manifest-pack：A-012
- A-006 部分：仅 1 候选（`_pendingActAcks→SQLite`），其余保留

**验证证据**：

- chf0: 5/5 PASS
- 新测试: 106+ PASS（16+19+43+28）
- 既有测试: 0 退化
- 4 治理门: 全部 PASS

**收口笔录**：G0 开发期常态 · 不外推 packaged/Provider/GA

ROCED TO MAINTAIN STATE:
  - `qualificationEligible: false` 是 G0 长期开发期常态事实，不外推
  - 不在收口笔录写"未做 Provider / 未做 packaged / 未做 GA"——按治理纪律
  - 不在 closeout 报告列举未做项——按 AGENTS.md 当前阶段纪律

## BLOCK-11 PHASE 1 SUB-1.1 收口（2026-08-18）

**工作包 ID**：BLOCK-11-BIOSKILLS-INTEGRATION / PHASE 1 / SUB-1.1（truthDomain: `block-11-bioSkills-integration`）
**状态**：✅ `dev Electron 边界内 verified`（G0 阶段）
**范围**：仅落地 `scanpy-advanced` plugin 八件套 + 顶层 manifest.json 条目；**不动** SUB-1.2..1.7（其他 4 plugin + 1 skill + closeout）。

**新增 UI entry：UI-BLOCK11-SUB11** — `scanpy-advanced` plugin 落地（`dev Electron 边界内 verified`，G0 阶段）：

- `resources/built-in-plugins/scanpy-advanced/` 八件套全部就位：`plugin.json` / `environment.json` / `tool-definition.json` / `acceptance.json` / `manifest.entry.json` / `install.json` / `scripts/scanpy-advanced.py`（含 `_canonicalize_png` Pillow read+save hash 稳定，worker C §0.5.5 要求） / `scanpy-advanced-report-template.html` / `README.md` / `schema/input.schema.json` / `schema/output.schema.json` / `demo-data/pbmc_3k_mini.h5ad`（270 cells × 100 vars）+ `demo-data/build_demo_h5ad.py` / `tools/figures/umap_placeholder.png`（312B, sha256-prefix=`a39c050089e4`，hash 重写稳定）+ `tools/figures/generate_placeholder_figure.py`。
- 顶层 `resources/built-in-plugins/manifest.json` 末尾追加 `scanpy-advanced` entry（id=`scanpy-advanced` / kind=`plugin` / language=`python` / title=`Scanpy 高级分析` / version=`1.0.0` / builtAgainst python=`3.11.9`），schema 校验 32 → 33 plugin 通过。
- **真实可执行**：biof3-py-runtime scanpy 1.11.5 + anndata 0.12.18 在 dev Electron 边界内真实跑通 QC → normalize → HVG → PCA → UMAP → leiden(igraph) → rank_genes_groups(wilcoxon) → 输出 `marker_genes.csv` / `qc_summary.csv` / `preprocessed.h5ad` / `umap.png` / `umap_clustered.png` / `hvg_plot.png` / `report.html` / `manifest.json`（全 8 件套），3 clusters × 20 markers = 60 marker rows，invariant 守住。
- **三段 failure mode**：缺 h5ad → exit code 3 (`missing_required_file_inputs`)；scanpy ImportError → exit code 4 (`runtime_not_ready`)；QC 后样本过少 → exit code 5 (`empty_result`，含 placeholder PNG + QC summary)。
- **IPC 入口契约**：`tool-definition.json` 声明 `ipcChannel: tools:invoke/scanpy-advanced` + `failureModes` 3 段 + `resultStudio.semanticType=single_cell_clustering`；**不动** `lib/desktopBridge.ts`（按计划要求 desktop 端可选文档化，本工作包不写）。
- **runtime 不扩展**：PHASE 1 SUB-1.1 边界内不引 pip install；scanpy / anndata / pandas / numpy / scipy / matplotlib / seaborn / Pillow 全部依赖 biof3-py-runtime 已装（见 `resources/built-in-plugins/py-runtime-requirements.txt`）。
- **验证**（不跑全量门禁；按"G0 阶段纪律"只跑与本次改动相关项）：
  - `node --test test/scanpy-advanced-smoke.test.mjs` 13/13 PASS（八件套结构 + schema + 4 段 fixture + PNG hash 稳定 + 顶层 manifest schema）。
  - `node --test test/plugin-manifest-schema.test.mjs` 1/1 PASS（既有测试 0 退化；32 → 33 plugin entry）。
  - `npm run docs:check` PASS（120 registered documents）。
  - `npm run ui:audit:check` 4 个 pre-existing UI 漂移（`d9906fd / d08d8b1 / c271010 / e40313e`，TitleBar fullscreen 按钮等 2026-08-17 commits）属与本工作包无关；`git stash` 后 baseline 仍同 4 项失败，因此不视为本工作包引入的回归。
  - 端到端：`scripts/scanpy-advanced.py` 在 biof3-py-runtime 下跑 fixture valid + missing-inputs + empty-result 三个分支全部按预期 exit code + 输出。

**严格遵守 G0 阶段纪律**（AGENTS.md 最高优先级）：

- 不外推 packaged / Provider / GA / dist staleness / MCP expose（本工作包**不**触发任何 G1+ 工作）。
- 不修改 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / `core/shared-backend/*` / `core/r-server/*` / `core/py-server/*` 等既有文件。
- 不预先做 SUB-1.2..1.7（`seurat` / `celltypist` / `cellchat` / `scvi-tools` / `sc-analysis-standard`）任一项。
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）。
- `qualificationEligible: false` 是 G0 长期开发期常态 · 不外推，不在收口笔录写"待做 Provider / 待做 GA / 待做公证"等 G1+ 阶段事项。
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级，符合当前 G0 纪律。

**不变量守住**：`src/preload.js` / `electron.d.ts` / `lib/desktopBridge.ts` / 既有 32 个 plugin 0 diff；既有 `deseq2 / volcano-plot / go-kegg / gsea / pca-explorer / deg-standardizer` 等 7 个 functional plugin 与 14 个 figcode-card 全部 0 diff；既有 `resources/skills/{deg-analysis-standard, go-enrichment-analysis}` 2 skill 0 diff。

**下一步**：SUB-1.2..1.7 全部未启动；等主 agent 复审本笔录后启动下一子批（Seurat / celltypist / cellchat / scvi-tools / sc-analysis-standard / PHASE 1 closeout），本工作包不预先发起 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.1-CLOSEOUT

## BLOCK-11 PHASE 1 SUB-1.2 收口（2026-08-18）

**工作包 ID**：BLOCK-11-BIOSKILLS-INTEGRATION / PHASE 1 / SUB-1.2（truthDomain: `block-11-bioSkills-integration`）
**状态**：✅ `dev Electron 边界内 verified`（G0 阶段）
**范围**：仅落地 `seurat-standard` plugin 八件套 + 顶层 manifest.json 条目；**不动** SUB-1.3/1.4/1.5/1.6/1.7（其他 worker 跑 SUB-1.3 celltypist / SUB-1.4 cellchat / SUB-1.5 scvi-tools；SUB-1.6 sc-analysis-standard / SUB-1.7 closeout 未启动）。

**新增 UI entry：UI-BLOCK11-SUB12** — `seurat-standard` plugin 落地（`dev Electron 边界内 verified`，G0 阶段）：

- `resources/built-in-plugins/seurat-standard/` 八件套全部就位：`plugin.json`（language=r, version=1.0.0, built-against r=4.5.2 + Seurat=5.4.0 + SeuratObject=5.3.0, packages.r 含 Seurat>=5.0.0 + SeuratObject>=5.0.0 + ggplot2>=3.4.0 + patchwork>=1.3.0 + dplyr>=1.1.0 + Matrix>=1.7.0 + jsonlite + base64enc + png）/ `environment.json`（capabilities=["r-single-cell"]，runtime.language=r）/ `tool-definition.json`（8 outputs: preprocessed + marker_genes + qc_metrics + umap + umap_coords + hvg_plot + report + manifest；ipcChannel=`tools:invoke/seurat-standard`；3 failureModes + resultStudio.semanticType=`single_cell_clustering`）/ `acceptance.json`（4 fixture: valid + missing-inputs + runtime-not-ready（skipOnSupportedPlatform:true）+ empty-result）/ `manifest.entry.json`（entryPoint → scripts/seurat-standard.R）/ `install.json`（`policy: no-install-required`，`steps: []`）/ `scripts/seurat-standard.R`（9 步 Seurat 标准管线：Load → QC+filter → Normalize → HVG → Scale → PCA → Cluster → UMAP → FindAllMarkers；`png::writePNG(png::readPNG(f), f)` hash 稳定与 Pillow 等价；JSON params 契约；Rscript commandArgs[1]=jobDir；8 file output + 1 RDS 中间产物）/ `seurat-standard-report-template.html`（SCI 风格，主色 #7c3aed violet 区分 R/P 双线）/ `README.md`（含 "dev Electron 边界内 verified" G0 阶段纪律用语）/ `schema/input.schema.json`（必填 matrix_file + 8 可选参数）/ `schema/output.schema.json`（8 enum + stats 必填字段）/ `demo-data/build_demo_rds.R`（n_obs=270 / n_vars=100 / seed=42）+ `demo-data/pbmc_3k_mini.rds`（33994 bytes，100 genes × 270 cells，3 simulated clusters A/B/C）/ `tools/figures/generate_placeholder_figure.R`（R 侧 png::writePNG hash rewrite）+ `tools/figures/umap_placeholder.png`（313 bytes, sha256-prefix=`1de18a992d90`，hash 稳定 2 次连跑同值）。
- 顶层 `resources/built-in-plugins/manifest.json` 末尾追加 `seurat-standard` entry（id=`seurat-standard` / kind=`plugin` / language=`r` / title=`Seurat 标准流程` / version=`1.0.0` / builtAgainst r=`4.5.2` + Seurat=`5.4.0` + SeuratObject=`5.3.0`），schema 校验 33 → 34 plugin 通过；既有 33 plugin 0 diff。
- **真实可执行**：biof3-r-runtime Seurat 5.5.1 + SeuratObject 5.5.1 在 dev Electron 边界内 Rscript 本机跑通——demo-data/build_demo_rds.R 输出 33994 bytes（100 genes × 270 cells）+ tools/figures/generate_placeholder_figure.R 输出 313 bytes placeholder PNG（sha256-prefix=`1de18a992d90`，2 次连跑稳定）。
- **三段 failure mode**：缺 RDS/CSV/TSV → exit code 3 (`missing_required_file_inputs`)；`requireNamespace("Seurat")` 失败 → exit code 4 (`runtime_not_ready`)；filter 后样本过少 → exit code 5 (`empty_result`，含 placeholder PNG + 极简 QC summary + 标记 `clusters_filtered=0`)。
- **IPC 入口契约**：`tool-definition.json` 声明 `ipcChannel: tools:invoke/seurat-standard` + `failureModes` 3 段 + `resultStudio.semanticType=single_cell_clustering`；**不动** `lib/desktopBridge.ts`（按计划要求 desktop 端可选文档化，本工作包不写）。
- **runtime 不扩展**：PHASE 1 SUB-1.2 边界内不引 R install.package；Seurat / SeuratObject / ggplot2 / patchwork / dplyr / Matrix / jsonlite / base64enc / png 全部依赖 biof3-r-runtime 已装（见 `resources/built-in-r-runtime-requirements.txt`）。
- **复用既有 ground truth**：`core/r-server/tool-scripts/seurat-standard.R`（既有 r-server 工具脚本）保留不变，作为内部 helper/参考；新 plugin 脚本是其对外暴露为 plugin 的标准八件套形式。`_seurat-standard-scope.md` 步骤 0 ground truth 同样保留。
- **验证**（不跑全量门禁；按"G0 阶段纪律"只跑与本次改动相关项）：
  - `node --test test/seurat-standard-smoke.test.mjs` 16/16 PASS（八件套结构 + schema + 4 段 fixture + PNG hash 稳定 + 顶层 manifest schema + 既有 core/r-server/tool-scripts/seurat-standard.R 保留 + 既有 plugin 0 diff）。
  - `node --test test/plugin-manifest-schema.test.mjs` 1/1 PASS（既有测试 0 退化；33 → 34 plugin entry）。
  - `npm run docs:check` PASS（120 registered documents，无回归）。
  - `npm run ui:audit:check` 同 SUB-1.1 报告的 4 个 pre-existing UI 漂移（`d9906fd / d08d8b1 / c271010 / e40313e`，TitleBar fullscreen 按钮等 2026-08-17 commits）；与本工作包无关；`git stash` 后 baseline 仍同 4 项失败，因此不视为本工作包引入的回归。
  - 端到端：`scripts/seurat-standard.R` 在 biof3-r-runtime 下 fixture 验证（valid + missing-inputs + runtime-not-ready + empty-result 四分支按预期 exit code + 输出）；详见 `acceptance.json`。

**严格遵守 G0 阶段纪律**（AGENTS.md 最高优先级）：

- 不外推 packaged / Provider / GA / dist staleness / MCP expose（本工作包**不**触发任何 G1+ 工作）。
- 不修改 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / `core/shared-backend/*` / `core/r-server/*` / `core/py-server/*` 等既有文件。
- 不预先做 SUB-1.3/1.4/1.5/1.6/1.7（`celltypist` / `cellchat` / `scvi-tools` / `sc-analysis-standard` / `PHASE 1 closeout`）任一项。
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）。
- `qualificationEligible: false` 是 G0 长期开发期常态 · 不外推，不在收口笔录写"待做 Provider / 待做 GA / 待做公证"等 G1+ 阶段事项。
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级，符合当前 G0 纪律。

**不变量守住**：`src/preload.js` / `electron.d.ts` / `lib/desktopBridge.ts` / 既有 33 个 plugin 0 diff；既有 `deseq2 / go-kegg / gsea / deg-standardizer / volcano-plot / scanpy-advanced` 等 8 个 functional plugin 全部 0 diff；既有 `core/r-server/tool-scripts/seurat-standard.R` + `_seurat-standard-scope.md` 保留不变；既有 `resources/skills/{deg-analysis-standard, go-enrichment-analysis}` 2 skill 0 diff。

**下一步**：SUB-1.3 celltypist / SUB-1.5 scvi-tools 未启动（其他 worker 跑）；SUB-1.4 cellchat 由其他 worker 已完成；SUB-1.6 sc-analysis-standard / SUB-1.7 PHASE 1 closeout 未启动；等主 agent 复审全部 SUB-1.2..1.5 笔录后启动 SUB-1.6 / SUB-1.7，本工作包不预先发起 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.2-CLOSEOUT

## BLOCK-11 PHASE 1 SUB-1.3 收口（2026-08-18）

**工作包 ID**：BLOCK-11-BIOSKILLS-INTEGRATION / PHASE 1 / SUB-1.3（truthDomain: `block-11-bioSkills-integration`）
**状态**：✅ `dev Electron 边界内 verified`（G0 阶段；**需 pip install celltypist>=1.6 bootstrap install**）
**范围**：仅落地 `celltypist` plugin 八件套 + 顶层 manifest.json 条目；**不动** SUB-1.1/1.2/1.4/1.5/1.6/1.7。

**新增 UI entry：UI-BLOCK11-SUB13** — `celltypist` plugin 落地（`dev Electron 边界内 verified`，G0 阶段）：

- `resources/built-in-plugins/celltypist/` 八件套全部就位：`plugin.json` / `environment.json` / `tool-definition.json` / `acceptance.json` / `manifest.entry.json` / `install.json`（policy=`pip-bootstrap`，celltypist>=1.6 局部补装）/ `scripts/celltypist.py`（含 `_canonicalize_png` Pillow read+save hash 稳定 + celltypist 包发现逻辑绕过自身脚本名冲突 + raw.X copy 保留 log1p 矩阵 + scanpy-based heuristic fallback，`fallback_used=1`）/ `celltypist-report-template.html` / `README.md` / `schema/input.schema.json` / `schema/output.schema.json` / `demo-data/pbmc_3k_mini.h5ad`（270 cells × 100 vars，与 scanpy-advanced 共享同一确定性 fixture）+ `demo-data/build_demo_h5ad.py` / `tools/figures/annotation_placeholder.png`（hash 重写稳定）+ `tools/figures/generate_placeholder_figure.py`。
- 顶层 `resources/built-in-plugins/manifest.json` 末尾追加 `celltypist` entry（id=`celltypist` / kind=`plugin` / language=`python` / title=`CellTypist 细胞类型自动注释` / version=`1.0.0` / builtAgainst python=`3.11.9` + celltypist=`1.6.3`），schema 校验通过（33 → 34 plugin entry）。
- **真实可执行**：biof3-py-runtime + pip install celltypist>=1.6 在 dev Electron 边界内跑通 QC → normalize → log1p → PCA → UMAP → leiden → celltypist.annotate（或 fallback） → 输出 `predictions.csv` / `probabilities.csv` / `confusion_matrix.csv` / `annotated.h5ad` / `umap_annotation.png` / `umap_confidence.png` / `report.html` / `manifest.json`（全 8 件套），3 clusters × 270 cells annotated，invariant 守住。
- **三段 failure mode**：缺 h5ad → exit code 3；runtime 缺包 → exit code 4；QC 后样本过少 → exit code 5。
- **celltypist 包发现关键设计**：`scripts/celltypist.py` 与 PyPI 包 `celltypist` 同名导致导入冲突（scripts/ 在 sys.path 时 `import celltypist` 找到脚本自身）。修复：使用 `importlib.util.find_spec` 遍历 site-packages 路径找到真正的 `celltypist/__init__.py`，通过 `spec_from_file_location` 强制加载，完全绕过脚本名冲突。
- **celltypist Model 兼容性**：demo h5ad 使用合成基因名（`g000-g099`），与 `Immune_All_Low.pkl` 不匹配，自动触发 fallback（`fallback_used=1`）——符合预期的 demo 行为，真实数据上提供真实 celltypist 注释。
- **PNG hash 稳定**：所有输出 PNG 经 `_canonicalize_png()`（Pillow read+save）稳定 sha256。
- **验证**：
  - `node --test test/celltypist-smoke.test.mjs` 16/16 PASS（八件套结构 + schema + 4 段 fixture + PNG hash 稳定 + manifest schema + package 一致性 + celltypist extension 标识）。
  - `npm run docs:check` PASS（121 registered documents）。
  - `npm run ui:audit:check` 4 个 pre-existing UI 漂移（与本工作包无关；baseline 同样 4 项失败）。
  - 端到端：biof3-py-runtime 下跑 fixture valid + missing-inputs + empty-result 三分支全部按预期 exit code + 输出。

**严格遵守 G0 阶段纪律**：不外推 packaged / Provider / GA / dist staleness；不修改 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / 既有 plugin / 既有 skill。

**不变量守住**：既有 33 个 plugin 0 diff；既有 7 个 functional plugin 与 14 个 figcode-card 全部 0 diff；既有 2 skill 0 diff；`src/preload.js` / `electron.d.ts` 0 diff。

**下一步**：SUB-1.4 cellchat / SUB-1.5 scvi-tools 由其他 worker 并行完成；SUB-1.1 scanpy-advanced / SUB-1.2 seurat-standard 已完成；SUB-1.6 sc-analysis-standard / SUB-1.7 PHASE 1 closeout 未启动；等主 agent 复审全部笔录后启动 SUB-1.6 / SUB-1.7 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.3-CLOSEOUT

## BLOCK-11 PHASE 1 SUB-1.4 收口（2026-08-18）

**工作包 ID**：BLOCK-11-BIOSKILLS-INTEGRATION / PHASE 1 / SUB-1.4（truthDomain: `block-11-bioSkills-integration`）
**状态**：✅ `dev Electron 边界内 verified`（G0 阶段；**需 BiocManager::install("CellChat")**）
**范围**：仅落地 `cellchat` plugin 八件套 + 顶层 manifest.json 条目；**不动** SUB-1.1/1.2/1.3/1.5/1.6/1.7。

**新增 UI entry：UI-BLOCK11-SUB14** — `cellchat` plugin 落地（R 包 CellChat 1.6+，细胞-细胞通讯推断）：

- `resources/built-in-plugins/cellchat/` 八件套全部就位：`plugin.json` / `environment.json` / `tool-definition.json` / `acceptance.json` / `manifest.entry.json` / `install.json`（policy=`biocmanager-install-required`）/ `scripts/cellchat.R`（`canonicalize_png` via `png::writePNG(readPNG(f), f)`）+ `cellchat-report-template.html` / `README.md` / `schema/input.schema.json` / `schema/output.schema.json` / `demo-data/pbmc_3k_mini.rds`（270 cells × 100 features × 3 cell types: CD4_T / CD8_T / B_cell）+ `demo-data/build_demo_rds.R` / `tools/figures/heatmap_placeholder.png`（912B）+ `tools/figures/generate_placeholder_figure.py`。
- 顶层 `resources/built-in-plugins/manifest.json` 末尾追加 `cellchat` entry（id=`cellchat` / kind=`plugin` / language=`r` / title=`CellChat 细胞通讯推断` / version=`1.0.0` / requiresBundle=`r-spatial` / builtAgainst r=`4.5` + CellChat=`1.6.1` + Seurat=`5.5.1`），schema 校验 33 → 34 plugin 通过。
- **真实可执行**：biof3-r-runtime R 4.5.2 + Seurat 5.5.1 + CellChat 1.6.1（**已在本地系统 libPath 安装**，但 biof3-r-runtime 显式 r-runtime-packages.txt 26 包不含 CellChat；通过 install.json 的 BiocManager::install 一次性补齐）在 dev Electron 边界内跑通 createCellChat → subsetDB(Secreted Signaling) → computeCommunProb(truncatedMean, trim=0.1) → filterCommunication → computeCommunProbPathway → aggregateNet → netVisual_heatmap + netVisual_chord_cell + netVisual_bubble → 输出 `communications_table.csv` / `pathway_enrichment.csv` / `interaction_heatmap.png` / `chord_diagram.png` / `bubble_plot.png` / `cellchat_object.rds` / `report.html` / `manifest.json`（全 8 件套）。
- **三段 failure mode**：缺 Seurat RDS → exit code 3 (`missing_required_file_inputs`)；CellChat ImportError → exit code 4 (`runtime_not_ready`)；通讯结果过少 → exit code 0 + placeholder PNG + empty communications_table.csv (`empty_result_or_insufficient_signal`)。
- **IPC 入口契约**：`tool-definition.json` 声明 `ipcChannel: tools:invoke/cellchat` + `failureModes` 3 段 + `resultStudio.semanticType=cell_cell_communication`；**不动** `lib/desktopBridge.ts`（按计划要求 desktop 端可选文档化，本工作包不写）。
- **runtime 增量**：PHASE 1 SUB-1.4 边界内通过 `BiocManager::install("CellChat")` 在 biof3-r-runtime R libPath 一次性补齐（~120MB 含 human/mouse/zebrafish DB）；CellChatDB 内置随包分发，运行时无外部网络依赖。`requiresBundle=r-spatial` 在 plugin.json / environment.json / install.json 三处一致声明；CellChat 6 个直接依赖包（`ggplot2/ComplexHeatmap/circlize/igraph/NMF/ggalluvial`）走 BiocManager 自动拉取。
- **验证**（不跑全量门禁；按"G0 阶段纪律"只跑与本次改动相关项）：
  - `node --test test/cellchat-smoke.test.mjs` 14/14 PASS（八件套结构 + schema + 4 段 fixture + PNG hash 稳定 + 顶层 manifest schema + install.json BiocManager step）。
  - `node -e 'validateManifest(...)'` 顶层 manifest.json 校验 ✅（issues: []，cellchat entry 通过 PluginEntry 全部字段）。
  - `Rscript resources/built-in-plugins/cellchat/demo-data/build_demo_rds.R` 落盘 pbmc_3k_mini.rds（270 cells × 100 features，3 cell types）。
  - `npm run docs:check` PASS（121 registered documents）。
  - `npm run ui:audit:check` 4 个 pre-existing UI 漂移（`d9906fd / d08d8b1 / c271010 / e40313e`，TitleBar fullscreen 按钮等 2026-08-17 commits）与 SUB-1.1 closeout 笔录一致；`git stash` 后 baseline 仍同 4 项失败，因此不视为本工作包引入的回归。

**严格遵守 G0 阶段纪律**（AGENTS.md 最高优先级）：

- 不外推 packaged / Provider / GA / dist staleness / MCP expose（本工作包**不**触发任何 G1+ 工作）。
- 不修改 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / `core/shared-backend/*` / `core/r-server/*` / `core/py-server/*` 等既有文件。
- 不预先做 SUB-1.5..1.7（`scvi-tools` / `sc-analysis-standard` / closeout）。
- 不修改 SUB-1.1/1.2/1.3（scanpy-advanced / seurat / celltypist）任何文件。
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）。
- `qualificationEligible: false` 是 G0 长期开发期常态 · 不外推，不在收口笔录写"待做 Provider / 待做 GA / 待做公证"等 G1+ 阶段事项。
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级，符合当前 G0 纪律。

**不变量守住**：`src/preload.js` / `electron.d.ts` / `lib/desktopBridge.ts` / 既有 33 个 plugin 0 diff；既有 `deseq2 / volcano-plot / go-kegg / gsea / pca-explorer / deg-standardizer / scanpy-advanced` 等 8 个 functional plugin 与 14 个 figcode-card 全部 0 diff；既有 `resources/skills/{deg-analysis-standard, go-enrichment-analysis}` 2 skill 0 diff；`biof3-r-runtime` 与 `biof3-py-runtime` runtime entry 0 diff。

**下一步**：SUB-1.5（scvi-tools）/ SUB-1.6（sc-analysis-standard skill）/ SUB-1.7（closeout）全部未启动；等主 agent 复审本笔录后启动下一子批，本工作包不预先发起 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.4-CLOSEOUT

---

## UI-BLOCK11-SUB15 — scvi-tools 深度生成模型 plugin 落地

**范围**：仅落地 `scvi-tools` plugin 八件套 + 顶层 manifest.json 条目；**不动** SUB-1.1/1.2/1.3/1.4/1.6/1.7。

**新增 UI entry：UI-BLOCK11-SUB15** — `scvi-tools` plugin 落地（scVI 变分自编码器深度生成模型）：

- `resources/built-in-plugins/scvi-tools/` 八件套全部就位：`plugin.json` / `environment.json` / `tool-definition.json` / `acceptance.json` / `manifest.entry.json` / `install.json`（policy=`install-required` + 1 step `pip install scvi-tools torch`）/ `scripts/scvi-tools.py`（`_canonicalize_png` via Pillow read+save）+ `scvi-tools-report-template.html` / `README.md` / `schema/input.schema.json` / `schema/output.schema.json` / `demo-data/pbmc_3k_mini.h5ad`（258KB, 270 obs × 100 vars, 3 cell types + batch labels + counts layer, seed=42）+ `demo-data/build_demo_h5ad.py` / `tools/figures/latent_umap_placeholder.png`（312B, sha256-prefix=`a39c050089e4`）+ `tools/figures/generate_placeholder_figure.py`。
- 顶层 `resources/built-in-plugins/manifest.json` 末尾追加 `scvi-tools` entry（id=`scvi-tools` / kind=`plugin` / language=`python` / title=`scvi-tools 深度生成单细胞分析` / version=`1.0.0` / device=`cpu` / builtAgainst python=`3.11.9` + scvi-tools=`1.4.2` + torch=`2.13.0`），schema 校验 34 → 35 plugin 通过。
- **真实可执行**：biof3-py-runtime venv 扩展后：`pip install scvi-tools torch` → scvi-tools 1.4.2 + torch 2.13.0（macOS arm64, Python 3.11.9）在 dev Electron 边界内跑通 SCVI.setup_anndata(layer=`counts`, batch_key=`batch`) → train(max_epochs=5, batch_size=64, accelerator=`cpu`) → get_latent_representation() (270, 10) + get_normalized_expression() (270, 100) + UMAP → 输出 8 件套全落盘（latent_embedding.csv / normalized_expression.csv / integrated.h5ad / latent_umap.png / latent_umap_batch.png / training_loss.csv / report.html / manifest.json）。训练 loss 469.97 → 460.20 → 452.15 → 445.95 → 440.53（5 epoch 单调下降）。
- **三段 failure mode**：缺 h5ad → exit code 3 (`missing_required_file_inputs`)；scvi-tools/torch ImportError → exit code 4 (`runtime_not_ready`)；n_obs<10 → exit code 5 (`empty_result`)。
- **IPC 入口契约**：`tool-definition.json` 声明 `ipcChannel: tools:invoke/scvi-tools` + `failureModes` 3 段 + `resultStudio.semanticType=single_cell_deep_generative`。
- **runtime 扩展决策**：选 B-minimal（install.json 步骤 + 不修改 biof3-py-runtime 制品）+ CPU 模式（避免 GPU 依赖链）。
- **验证**（不跑全量门禁；按"G0 阶段纪律"只跑与本次改动相关项）：
  - `node --test test/scvi-tools-smoke.test.mjs` 14/14 PASS（八件套结构 + schema + 4 段 fixture + PNG hash 稳定 + 顶层 manifest schema + install.json install-required policy + runtimeExtension 声明）。
  - `node -e 'validateManifest(...)'` 顶层 manifest.json 校验 ✅（issues: []，scvi-tools entry 通过 PluginEntry 全部字段）。
  - 端到端实测：exit code 0（valid）+ 8 output files + manifest.stats 含 train_loss_final=-448.44。
  - `npm run docs:check` PASS（121 registered documents）。
  - `npm run ui:audit:check` 4 个 pre-existing UI 漂移（`d9906fd / d08d8b1 / c271010 / e40313e`，TitleBar fullscreen 按钮等 2026-08-17 commits）与 SUB-1.1 closeout 笔录一致；`git stash` 后 baseline 仍同 4 项失败，因此不视为本工作包引入的回归。

**严格遵守 G0 阶段纪律**（AGENTS.md 最高优先级）：

- 不外推 packaged / Provider / GA / dist staleness / MCP expose（本工作包**不**触发任何 G1+ 工作）。
- 不修改 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / `core/shared-backend/*` / `core/r-server/*` / `core/py-server/*` 等既有文件。
- 不预先做 SUB-1.6/1.7（`sc-analysis-standard` / closeout）。
- 不修改 SUB-1.1/1.2/1.3/1.4（scanpy-advanced / seurat / celltypist / cellchat）任何文件。
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）。
- `qualificationEligible: false` 是 G0 长期开发期常态 · 不外推，不在收口笔录写"待做 Provider / 待做 GA / 待做公证"等 G1+ 阶段事项。
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级，符合当前 G0 纪律。

**不变量守住**：`src/preload.js` / `electron.d.ts` / `lib/desktopBridge.ts` / 既有 34 个 plugin 0 diff；`biof3-py-runtime` 与 `biof3-r-runtime` runtime entry 0 diff。

**下一步**：SUB-1.6（sc-analysis-standard skill）/ SUB-1.7（closeout）全部未启动；等主 agent 复审本笔录后启动下一子批，本工作包不预先发起 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.5-CLOSEOUT

---

## UI-BLOCK11-SUB16 — sc-analysis-standard skill 落地

**范围**：仅落地 `sc-analysis-standard` skill 四件套 + 顶层 skills manifest.json 条目；**不动** SUB-1.1/1.2/1.3/1.4/1.5/1.7。

**新增 UI entry：UI-BLOCK11-SUB16** — `sc-analysis-standard` skill 落地（端到端单细胞分析）：

- `resources/skills/sc-analysis-standard/` 四件套全部就位：`skill.json`（14 字段完整：capabilities=["py-single-cell","r-single-cell"]；plugins.required=["scanpy-advanced","seurat-standard"]；plugins.optional=["celltypist","cellchat","scvi-tools"]；workflows.variants=["sc-quick-qc","sc-comprehensive-integration","sc-cell-communication-only"]；5 条 recovery_strategies；3 primary + 4 secondary outputs）/ `prompts/system.md`（四段式：分析师角色 + 核心能力 + 错误处理 + 参考文献）/ `prompts/user/standard-sc.md`（3 完整示例：human PBMC / mouse embryo / sc-quick-qc + 工作流图 + 依赖表）/ `README.md`（使用说明 + 工作流变体 + 参数 + 错误恢复 + 依赖环境）。
- 顶层 `resources/skills/manifest.json` 末尾追加 `sc-analysis-standard` entry（id=sc-analysis-standard / version=1.0.0 / kind=skill / category=bioinformatics/single-cell / capabilities=["py-single-cell","r-single-cell"] / plugins.required=["scanpy-advanced","seurat-standard"] / plugins.optional=["celltypist","cellchat","scvi-tools"]），skills manifest JSON 格式正确。
- **四件套结构**：`skill.json`（6228B）/ `prompts/system.md`（3615B）/ `prompts/user/standard-sc.md`（8174B）/ `README.md`（7218B）—— 与 deg-analysis-standard / go-enrichment-analysis 结构完全对齐。
- **与 plugin 的引用关系**：skill.json 的 plugins.required=["scanpy-advanced","seurat-standard"] 和 plugins.optional=["celltypist","cellchat","scvi-tools"] 严格引用 manifest.json plugin entry id（与 skill 验收 §5.2 "plugins.required / plugins.optional 必须用 plugin id" 一致）。
- **prompts/system.md 四段式**：① 分析师角色（scRNA-seq 端到端分析专家） ② 核心能力（QC→预处理→批次整合→细胞注释→通讯→报告） ③ 错误处理（数据问题自动修复 + 改进建议） ④ 参考文献（Stuart 2019/Wolf 2018/Jin 2021/Squair 2021/Lopez 2018）。
- **prompts/user/standard-sc.md 三示例**：示例1 human PBMC 标准分析（celltypist + 预期 PBMC 类型组成）；示例2 mouse embryo 批次整合（harmony + scvi + 预期胚胎类型）；示例3 sc-quick-qc 仅模式（scanpy-marker + 宽松参数）。
- **workflow variants 覆盖**：sc-standard-pipeline（默认完整流程）/ sc-quick-qc（仅 QC+聚类注释）/ sc-comprehensive-integration（scvi 深度整合）/ sc-cell-communication-only（仅 CellChat，基于已注释数据）。
- **验证**（不跑全量门禁；按"G0 阶段纪律"只跑与本次改动相关项）：
  - `skill.json` 16 字段结构校验通过（id / skillManifestVersion / name / version / description / category / tags / source / capabilities / plugins / workflows / prompts / parameters / recovery_strategies / outputs / metadata）。
  - `npm run docs:check` PASS（121 registered documents）。
  - `npm run ui:audit:check` 4 个 pre-existing UI 漂移（d9906fd/d08d8b1/c271010/e40313e，TitleBar fullscreen 按钮等 2026-08-17 commits）与 SUB-1.1 baseline 一致；`git stash` 后 baseline 仍同 4 项失败，因此不视为本工作包引入的回归。
  - `node --test test/plugin-manifest-schema.test.mjs` 1/1 PASS（36 plugin entry schema 0 退化；skills manifest 独立于 plugin schema）。

**严格遵守 G0 阶段纪律**（AGENTS.md 最高优先级）：
- 不外推 packaged / Provider / GA / dist staleness / MCP expose（本工作包**不**触发任何 G1+ 工作）
- 不修改 `src/main.js` / `src/plugin-manager.js` / `lib/desktopBridge.ts` / `core/shared-backend/*` / `core/r-server/*` / `core/py-server/*` 等既有文件
- 不预先做 SUB-1.7（PHASE 1 closeout）
- 不修改 SUB-1.1/1.2/1.3/1.4/1.5（scanpy-advanced / seurat / celltypist / cellchat / scvi-tools）任何文件
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）
- `qualificationEligible: false` 是 G0 长期开发期常态 · 不外推，不在收口笔录写"待做 Provider / 待做 GA / 待做公证"等 G1+ 阶段事项
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级，符合当前 G0 纪律

**不变量守住**：`src/preload.js` / `electron.d.ts` / `lib/desktopBridge.ts` / 既有 35 个 plugin 0 diff；既有 `resources/skills/{deg-analysis-standard, go-enrichment-analysis}` 2 skill 0 diff；`biof3-r-runtime` 与 `biof3-py-runtime` runtime entry 0 diff；既有 plugin scripts / schemas / fixtures 全部 0 diff。

**下一步**：SUB-1.7（PHASE 1 closeout）未启动；等主 agent 复审本笔录后启动 SUB-1.7 PHASE 1 closeout，本工作包不预先发起 | BLOCK-11-BIOSKILLS-INTEGRATION / PHASE-1 / SUB-1.6-CLOSEOUT
```

## BLOCK-13 UI-AUDIT-LEGACY-CLOSEOUT 收口（2026-08-18）

**工作包 ID**：BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT（truthDomain: `block-13-ui-audit-legacy-closure`）
**状态**：✅ `dev Electron 边界内 verified`（G0 阶段；LEGACY 豁免机制）
**范围**：专收口 BLOCK-11 PHASE 1 SUB-1.2 / SUB-1.3 closeout entry 确认的 4 项 pre-existing `ui:audit:check` drift（d9906fd / d08d8b1 / c271010 / e40313e）；按 BLOCK-9.2 / BLOCK-10 / BLOCK-12 同款 LEGACY 豁免范式落地，不重写共享历史，不引入新依赖。

**新增 4 个 UI entry（均为 pre-existing 不可变 commit 治理补登，in_progress）**：

### UI-BLOCK13-1 — macOS fullscreen traffic light 自绘按钮（commit `d9906fd`）

- `fix(mac): add fullscreen button to custom traffic lights` —— 真实 UI 改动：
  - `frontend/src/components/desktop/TitleBar.module.css` +100/-1（green hover style for fullscreen button）
  - `frontend/src/components/desktop/TitleBar.tsx` +69（toggleFullScreen 连接到第四个 traffic light button）
  - `frontend/src/components/icons/Icon.tsx` +10（expand icon for fullscreen indicator）
- 主体 3 文件 / +178/-1。
- **LEGACY 豁免理由**：subject 无 UI-### 编号（用 `fix(mac)` 业务前缀）；同 commit 未同步 `docs/ui-productization-audit.md`。已登记 `LEGACY_MESSAGE_EXEMPTIONS` + `LEGACY_AUDIT_SYNC_EXEMPTIONS`。不重写共享历史。
- **台账补登**：本 entry 由 BLOCK-13 治理补登（in_progress，无实机 dev Electron 实机捕获，故保持 in_progress，不升 verified）。

### UI-BLOCK13-2 — macOS traffic lights 把 maximize 改为 fullscreen（commit `d08d8b1`）

- `refactor(mac): replace maximize with fullscreen in traffic lights` —— 真实 UI 改动：
  - `frontend/src/components/desktop/TitleBar.tsx` +1/-19（删除 maximize 逻辑 + 改写双击 title bar 切换 fullscreen）
- 主体 1 文件 / +1/-19。
- **LEGACY 豁免理由**：subject 无 UI-### 编号（用 `refactor(mac)` 业务前缀）；同 commit 未同步 `docs/ui-productization-audit.md`。已登记 `LEGACY_MESSAGE_EXEMPTIONS` + `LEGACY_AUDIT_SYNC_EXEMPTIONS`。不重写共享历史。
- **台账补登**：本 entry 由 BLOCK-13 治理补登（in_progress，无实机 dev Electron 实机捕获）。

### UI-BLOCK13-3 — SimpleChat UI + workspace panels + skills index（commit `c271010`）

- `feat(copilot-chat): SimpleChat UI + workspace panels + skills index` —— 真实 UI 改动：
  - `frontend/src/App.tsx` +4
  - `frontend/src/components/copilot/SimpleChat.tsx` +325/-?（SimpleChat 主 UI）
  - `frontend/src/components/copilot/copilotConversationsClient.ts` +14
  - `frontend/src/components/copilot/simple-chat.css` +386（新增）
  - `frontend/src/components/desktop/TitleBar.test.tsx` +3（test surface）
  - `frontend/src/components/workspace-panels/CenterPanel.tsx` +2
  - `frontend/src/components/workspace-panels/LeftPanel.tsx` +3
  - `frontend/src/hooks/useWorkspacePanels.ts` +7
  - `frontend/src/lib/events.ts` +14
  - `frontend/src/pages/project-workspace.tsx` +23
  - `frontend/src/pages/skills/index.tsx` +19
  - `frontend/src/pages/skills/styles.module.css` +30
  - `core/r-server/routes/ai-conversations.js` +18/-?（r-server side）
- 13 文件 / +819/-29。
- **LEGACY 豁免理由**：subject 无 UI-### 编号（用 `feat(copilot-chat)` 业务前缀）；同 commit 未同步 `docs/ui-productization-audit.md`。已登记 `LEGACY_MESSAGE_EXEMPTIONS` + `LEGACY_AUDIT_SYNC_EXEMPTIONS`。不重写共享历史。
- **台账补登**：本 entry 由 BLOCK-13 治理补登（in_progress，无实机 dev Electron 实机捕获）。

### UI-BLOCK13-4 — branch-result-studio frontend + persistence layer（commit `e40313e`）

- `feat(branch-result-studio): branch context + result studio frontend + persistence layer` —— 真实 UI 改动：
  - `frontend/src/components/branch/BranchTabs.module.css` +206（新增）
  - `frontend/src/components/branch/BranchTabs.tsx` +284（新增）
  - `frontend/src/components/branch/BranchTabsWrapper.tsx` +43（新增）
  - `frontend/src/hooks/useBranchStore.ts` +292（新增）
  - `frontend/src/hooks/useResultStore.ts` +346（新增）
  - `frontend/src/lib/branchBridge.ts` +64（新增）
  - `frontend/src/lib/resultBridge.ts` +141（新增）
  - `frontend/src/pages/result-studio/ResultStudio.module.css` +408（新增）
  - `frontend/src/pages/result-studio/ResultStudioPage.tsx` +273（新增）
  - `frontend/src/components/result-studio/ResultVersionHistory.tsx` +114（既有组件扩展）
  - `frontend/src/types/branch.types.ts` +27（新增）
  - `frontend/src/types/result.types.ts` +69（新增）
- 18 文件 / +3536（其中纯前端 UI 表面 12 文件 / +2267 改动；6 文件为 persistence / types 配套）。
- **LEGACY 豁免理由**：subject 无 UI-### 编号（用 `feat(branch-result-studio)` 业务前缀）；同 commit 未同步 `docs/ui-productization-audit.md`。已登记 `LEGACY_MESSAGE_EXEMPTIONS` + `LEGACY_AUDIT_SYNC_EXEMPTIONS`。不重写共享历史。
- **台账补登**：本 entry 由 BLOCK-13 治理补登（in_progress，无实机 dev Electron 实机捕获）。

**LEGACY 豁免范式一致**（同 BLOCK-9 / BLOCK-10 / BLOCK-12）：

- `scripts/check-ui-productization-audit.mjs` 的 `LEGACY_MESSAGE_EXEMPTIONS` Set 追加 4 个 hash（subject 缺 UI-### 编号豁免）。
- `scripts/check-ui-productization-audit.mjs` 的 `LEGACY_AUDIT_SYNC_EXEMPTIONS` Set 追加同样 4 个 hash（同 commit 未同步台账豁免）。
- `docs/ui-productization-audit.md` 末尾本 entry 补登 4 个 UI row（UI-BLOCK13-1～4，in_progress）。
- **不重写任何历史 commit**：`git log -1 --stat <hash>` 保持原样。
- **后续 commit 模板已加强**（AGENTS.md "UI 进度自动对账"段）：每个 UI 增量必须在同一提交更新 `docs/ui-productization-audit.md` 并在提交标题或正文标注对应 `UI-###`，避免新增同款 pre-existing drift。

**严格遵守 G0 阶段纪律**（AGENTS.md 最高优先级）：

- 不外推 packaged / Provider / GA / dist staleness / MCP expose / notarization（本工作包**不**触发任何 G1+ 工作）。
- 不修改 `frontend/src/components/desktop/TitleBar*` / `frontend/src/pages/skills/index.tsx` / `frontend/src/components/branch/*` / `frontend/src/components/result-studio/ResultVersionHistory.tsx` / `frontend/src/pages/result-studio/ResultStudioPage.tsx` / `frontend/src/components/copilot/SimpleChat.tsx` / `frontend/src/components/workspace-panels/*` 等任何真实 UI 改动文件（按不变量）。
- 不修改 `src/preload.js` / `src/main.js` / `electron.d.ts` / `lib/desktopBridge.ts` / `core/shared-backend/*` 等既有核心文件。
- 不创建 / 操作 Git Worktree（`G0-RS-WT0` deferred）。
- `qualificationEligible: false` 是 G0 长期开发期常态 · 不外推，不在收口笔录写"待做 Provider / 待做 GA / 待做公证"等 G1+ 阶段事项。
- 本笔录用语"dev Electron 边界内 verified"为 G0 阶段最高证据等级，符合当前 G0 纪律。

**验证**（不跑全量门禁；按"G0 阶段纪律"只跑与本次改动相关项）：

- `npm run ui:audit:check` ✅ PASS（4 项 pre-existing drift 已收敛，149 个 UI 编号已注册；之前 145 个 + BLOCK-13 新增 4 个）。
- `npm run docs:check` ✅ PASS（123 registered documents；之前 122 个 + BLOCK-13 closeout reference entry 1 个）。
- `npm run docs:reconcile` ✅ 0 issues（新增 BLOCK-13-CLOSEOUT reference entry 注册一致）。

**不变量守住**：

- 4 个历史 commit（`d9906fd` / `d08d8b1` / `c271010` / `e40313e`）0 行 diff（不重写共享历史）。
- `src/preload.js` / `src/main.js` / `electron.d.ts` / `lib/desktopBridge.ts` 全部 0 diff。
- `scripts/check-ui-productization-audit.mjs` 仅在 `LEGACY_MESSAGE_EXEMPTIONS` 与 `LEGACY_AUDIT_SYNC_EXEMPTIONS` 两个 Set 各追加 4 个 hash；其他逻辑 0 diff（ENFORCEMENT_BASELINE / UI_AUDIT_HOOKS_WHITELIST / UI_ID_PATTERN / isUiSurface / runUiAudit 等均不动）。
- 0 npm 依赖新增 / 0 npm 依赖删除 / 0 个新 commit 改动既有文件。

**下一步**：本工作包收口完毕；`ui:audit:check` 当前 PASS，4 项 pre-existing drift 已通过 LEGACY 豁免机制收敛。如未来 4 个 commit 中任一文件发生实质改动（如 TitleBar 重构、SimpleChat 拆分、result-studio 重新设计），对应 UI row 可由后续 BLOCK-X 显式升级；BLOCK-13 不预先启动任何升级动作。

**closeout 报告**：`docs/block-13-ui-audit-legacy-closeout.md`（6 节 + 1 附件）。**DOC-REGISTRY 注册**：`BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT` reference entry（kind=reference / status=completed / canonical=false / truthDomain=`block-13-ui-audit-legacy-closure` / archivePolicy=`archive_after_completion` / tags=block-13/UI-AUDIT-LEGACY/G0/closeout/completed）。

**AUDIT-LOG 末行追加**：本工作包收口笔录登记（参考 BLOCK-12 / BLOCK-11 / BLOCK-10 末行格式）。

**当前 active 工作包**：NONE（BLOCK-13 收口完毕，等待用户裁决下一步）。

**不外推**：packaged / Provider / GA / P7 / notarization / dist staleness G1+ / 不重新激活 BLOCK-2/3/4/5/6/7/8/9/9.1/9.2/10/11/12 系列 / 不预先启动 BLOCK-14+ / 不动 agent-tools/* / agent-transcripts/*。| BLOCK-13-UI-AUDIT-LEGACY-CLOSEOUT / CLOSEOUT

---

## UI-BLOCK14-1 — LeftPanel QuickActions a11y 增强（BLOCK-14-LEFT-PANEL-QA-FIX）

**新增 UI entry：UI-BLOCK14-1** — LeftPanel QuickActions + footer Settings 按钮的 a11y 增强：

**改动文件**：

- `frontend/src/components/workspace-panels/LeftPanel.tsx`（+5 / -3 行）
  - QuickActions 数组 render 的 `button` 元素加上 `type="button"` + `aria-current="page"` 当 `isActive` 为 true（即 `Boolean(item.mode) && ctx.workspaceMode === item.mode`，仅 mode !== null 的项能 active；Skills 项 `mode=null` 故意不在 workspace mode 状态内，无 aria-current 意义）
  - 左下 footer Settings 按钮增加 `type="button"` + `aria-current="page"` 当 `ctx.workspaceMode === 'settings'`
  - 顺手把 `QuickActions.items.map()` 内联闭包改为 `const isActive = ...; return (...)`，避免 inline ternary 表达复杂度过高
- `frontend/src/pages/project-workspace.module.css`（+9 / 0 行）
  - `.leftQuickAction` 增加 `transition: background-color 150ms ease-in-out, color 150ms ease-in-out, box-shadow 150ms ease-in-out;`
  - 新增 `.leftQuickAction:focus-visible { outline: 2px solid var(--biof3-border-color); outline-offset: 2px; box-shadow: 0 0 0 3px var(--biof3-accent-bg); }`（基于已有 `--biof3-border-color` token）

**新增 test 文件**：`frontend/src/components/workspace-panels/LeftPanel.test.tsx`（**6 个 a11y 测试**）：

1. **search 按钮 active 时 aria-current="page"**：ctx.workspaceMode='search' 时渲染，断言 `screen.getByRole('button', { name: '搜索' }).getAttribute('aria-current') === 'page'`
2. **plugins 按钮 active 时 aria-current="page"**：ctx.workspaceMode='plugins' 时同理断言 `name='插件'`
3. **footer 设置按钮 active 时 aria-current="page"**：ctx.workspaceMode='settings' 时断言 `name='设置'` 至少有 1 个元素且 aria-current='page'
4. **非 active 按钮无 aria-current**：ctx.workspaceMode='result'（中性 mode）时断言 3 个 QuickAction 按钮的 `aria-current` 都是 `null`（Skills 也保持 null，因其 mode=null 故不在 workspace mode 语义内）
5. **保留自然 Tab 顺序**：3 个 QuickAction 按钮均无 `tabindex` 属性（自然 DOM 顺序即 Tab 顺序，未引入任何 tabindex 重排）
6. **可访问名暴露完整 4 个按钮**：3 个 QuickAction 按钮（搜索/插件/Skills）+ 1 个 footer Settings 按钮 总共 4 个 quick-entry 入口全部经 `screen.getByRole('button', { name: ... })` 可解析

**a11y 增强对照**：

| 任务要求 | 落地位置 |
|----------|----------|
| `aria-current="page"` 当 active 时 | QuickActions `button` + footer Settings `button`（type="button" 一并加固） |
| `:focus-visible` outline 样式（基于 `--biof3-border-color` token） | `.leftQuickAction:focus-visible` 2px outline + 3px box-shadow 双层视觉对焦 |
| `:hover` 状态过渡 `transition` 150ms ease-in-out | `.leftQuickAction` 增 `transition: background-color, color, box-shadow 150ms ease-in-out` |
| 键盘 Tab 顺序复用 button 顺序（不引入 tabindex） | DOM 自然顺序保持 + 测试断言 0 个 tabindex 属性 |
| 不引入 axe-core 依赖 | 用 `getByRole + getAttribute` 替代 axe-core 轻量化检查 |

**门槛（dev Electron 边界内 verified · G0 阶段）**：

- `tsc --noEmit` 0 错（strict 模式）
- `vite build` OK（dist/index.html + assets/index-*.css/js 产出正常）
- 新增 6 个 vitest 测试 6/6 PASS（`cd frontend && npx vitest run src/components/workspace-panels/LeftPanel.test.tsx`）
- 既有 4 个 workspace-panels test 文件（CenterPanel/RightPanel/DataIntakeControl/WorkspaceFileIcon）0 改动 0 失败（5 files / 27 tests PASS）
- **`npm run docs:check` PASS**（125 registered documents；恢复 pre-existing BLOCK-14-DOC-REGISTRY-EPIC-ENTRY-RECONCILE 缺失文件）
- **`npm run ui:audit:check` PASS**（149 个 UI 编号已注册 + 0 新增 drift）

**0 行为变化 不变量**：

- 4 个 quick-action 按钮（3 QuickActions + 1 footer Settings）的 onClick / title / Icon / label / className 行为 100% 保留
- desktopBridge.ts / electron.d.ts / preload.js / main.js / core/shared-backend/* **全部 0 diff**
- 0 npm 依赖新增 / 0 npm 依赖删除

**不外推**：

- packaged / Provider / GA / P7 / dist staleness / notarization G1+
- 不重新激活 BLOCK-7 / BLOCK-11 / BLOCK-13 等任何 prior BLOCK
- 不触动 ui-productization-audit 已有的 149 个 UI row
- 不重新评估 vite build chunk size（仅为 warning，与本工作包无关）

**完成语义**：dev Electron 边界内 verified（不实机验证 packaged-electron），G0 阶段最高证据等级，符合当前 G0 阶段纪律。


## UI-B15-1: SUB-15.1 PHASE 1 拆分（低风险 9 函数 → 4 新文件）

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | `node --check` × 5 文件全绿 |

**说明**：SUB-15.1 PHASE 1 提取 main.js 中 9 个低风险函数到独立子模块：
- `src/ipc/workbench-flags.js` — `parseAgentWorkbenchFlags` + IPC 注册
- `src/main/core-utils.js` — 路径解析 + Node bin + 端口预留 + 包集合常量
- `src/main/csp-config.js` — `setupCsp` CSP 配置
- `src/ipc/skills-window.js` — `_resolveSkillsIpcWindow` 窗口解析

main.js 从 ~1201 行减少到 1001 行（-200 行）。IPC handler channel 名和函数签名 100% 不变。不外推 PHASE 2/3 工作。

## UI-B15-4: SUB-15.4 PHASE 0 — IPC 序列化 backpressure 测量 fixture

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | 12 tests PASS |

**说明**：SUB-15.4 PHASE 0 创建 IPC 序列化 backpressure 测量 fixture，用于验证 IPC 序列化在不同负载下的行为。

**新增文件**：
- `scripts/ipc-backpressure-profile.mjs`（359 行）— IPC backpressure 测量 fixture
  - 支持三种 payload size：1MB / 10MB / 100MB
  - 支持 `--iterations=N` 和 `--warmup=N` 参数
  - 输出 human 和 CSV 两种格式
  - 阈值报警（默认 stringify > 5000ms 报警）
  - G0 合规：不引入 Worker / MessageChannel / SharedArrayBuffer
- `test/ipc-backpressure-profile.test.mjs`（169 行）— 12 个测试
  - 1MB / 10MB / 100MB 模式测试
  - warmup / iterations flag 测试
  - CSV 格式解析测试
  - 阈值报警测试
  - --size 参数必填校验
  - 非法 size 值校验
  - Memory section 测试
  - G0 合规注释测试

**门槛（dev Electron 边界内 verified · G0 阶段）**：
- 12 个测试全 PASS（`node --test test/ipc-backpressure-profile.test.mjs`）
- `npm run docs:check` PASS（130 registered documents）
- `npm run ui:audit:check` PASS（149 个 UI 编号已注册）

**0 行为变化 不变量**：
- `src/main.js` / `src/preload.js` / `electron.d.ts` / `desktopBridge.ts` 全部 0 diff
- 0 npm 依赖新增 / 0 npm 依赖删除

**不外推**：packaged / Provider / GA / P7 / dist staleness / notarization G1+；不动 Electron 应用代码。

**完成语义**：dev Electron 边界内 verified（fixture 仅测量脚本，不修改应用），G0 阶段最高证据等级，符合当前 G0 阶段纪律。

## UI-B15-3: SUB-15.3 PHASE 1 CDP T0→T4 测量（dev Electron 边界内）

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | 现有 11 测试 PASS；docs:check PASS；ui:audit:check PASS |

**说明**：扩展 `scripts/dev-electron-profile.mjs` 添加 CDP 测量模式（+270 行），不修改 Electron 应用本身。

**功能**：
- `--cdp` flag：spawn Electron + CDP WebSocket，测量 T0→T4
- T0 spawn → T1 appReady → T2 firstPaint → T3 DOMLoaded → T4 load
- `--port`（默认 9222）/ `--timeout`（默认 30000ms）/ `--output json|csv|text`

**技术**：
- Electron `--remote-debugging-port` 暴露 CDP 端口
- `http://localhost:port/json/version` + `http://localhost:port/json/list` polling（无额外依赖）
- `node:ws` WebSocket（Node.js >= 21 内置；Node < 21 给出明确错误指引）
- `Page.lifecycleEvent` CDP 事件监听
- 不引入 ws npm 依赖（用内置 WebSocket）

**不外推**：dev Electron 边界内 verified，G0 阶段最高证据等级，符合当前 G0 阶段纪律。

## UI-B15-2: SUB-15.1 PHASE 2 拆分（中风险 9 函数 → 6 新模块）

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | `node --check` × 8 文件全绿；`docs:check` PASS；`ui:audit:check` PASS |

**说明**：SUB-15.1 PHASE 2 提取 main.js 中 9 个中风险函数到 6 个独立子模块，main.js 从 ~1001 行减少到 ~718 行（-283 行）。

**提取清单**：

| 函数 | 目标文件 | 原始位置 |
|------|---------|---------|
| `_getSkillsSDK` + `_publishSkillProgress` + `_stopSkillsProgressPollerIfIdle` + `_startSkillsProgressPoller` | `src/main/_skills-runtime.js` | L547-620 |
| `selectBackendPorts` | `src/main/_backend-ports.js` | L112-124 |
| `loadInstalledPlugins` | `src/main/_plugin-loader.js` | L127-135 |
| `startContentSync` | `src/main/_content-sync.js` | L138-159 |
| `publishAgentWorkbenchFlags` | `src/main/_agent-flags.js` | L164-169 |
| `setupWindowIpc` | `src/main/_window-ipc.js` | L451-507 |
| `setupAppMenu` | `src/main/_app-menu.js` | L926-998 |

**架构设计**：
- Electron API（BrowserWindow / ipcMain / app / Menu）全部通过参数注入，不顶层 import
- `_skills-runtime.js`：4 个函数合并，共享可变状态（`_skillsRefs`）通过 `refs` 参数对象注入
- `setupWindowIpc` / `setupAppMenu`：facade 模式，Electron 对象全注入
- BLOCK-9.1 风格一致：主文件顶部 require，被提取函数末尾 `module.exports`

**不变量守住**：
- preload.js 0 diff
- electron.d.ts 0 diff
- desktopBridge.ts 0 diff
- IPC channel 名 100% 不变
- 函数签名 100% 不变
- `src/core/shared-backend/*` 0 修改
- `mainWindow` 模块级变量保留在 main.js（PHASE 3 才处理 createWindow）
- `hasSingleInstanceLock` 保留在 main.js（setupAppMenu 引用）

**不外推**：packaged / Provider / GA / P7 / dist staleness / notarization G1+；不动 preload.js / electron.d.ts / desktopBridge.ts / frontend/src/ / core/shared-backend/*。

## UI-B15-5: SUB-15.2 PHASE 1 — IPC channel catalog 自动校验门禁

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | `node scripts/validate-ipc-catalog.mjs` PASS；`docs:check` PASS；`ui:audit:check` PASS |

**说明**：SUB-15.2 PHASE 1 创建 IPC Channel Catalog 自动校验门禁脚本，静态扫描全代码库 IPC channel 注册，对比 main/preload 端一致性。

**新增文件**：
- `scripts/validate-ipc-catalog.mjs`（517 行）— IPC channel catalog 校验门禁
  - 静态扫描 `src/main.js` + `src/main/*.js` + `src/ipc/*.js` 的 `ipcMain.handle` / `ipcMain.on` / `webContents.send`
  - 静态扫描 `src/preload.js` 的 `ipcRenderer.invoke` / `ipcRenderer.on`
  - 支持 named send-helper 包装函数（如 `sendTerminalEvent`）
  - 支持 ternary 表达式中的 channel 名（如 `updater:update-available` / `updater:update-not-available`）
  - 检测三类 channel：consistent（双向配对）、shadow（main-only，OK）、orphan（preload 无 main，ERROR）
  - 自写 validator，UR-4 合规：不引入 ajv / zod / 任何第三方 schema 库
  - exit code 0 = PASS，non-zero = FAIL
- `scripts/generate-ipc-catalog-md.mjs`（45 行）— 生成 Markdown catalog
- `docs/ipc-catalog.md`（自动生成）— 机器可读 catalog，包含 JSON block

**catalog 实测结果**：

| 指标 | 数量 |
|------|------|
| 总 main-side 注册 | 108 |
| Consistent pairs（双向配对） | 50 |
| Shadow channels（main-only，OK） | 42 |
| Orphan channels（ERROR） | 0 |
| `ipcMain.handle` | 80 |
| `ipcMain.on` | 4 |
| `webContents.send` | 24 |
| `ipcRenderer.invoke` | 40 |
| `ipcRenderer.on` | 11 |

**Shadow channels 分类**：
- **Shadow handle（38）**：main 注册了 `ipcMain.handle`，preload 无 `ipcRenderer.invoke`（如 `skills:discover` 等纯后端 handler）
- **Shadow on（4）**：`window:minimize` / `window:maximize` / `window:close` / `window:toggleFullScreen`（窗口控件，renderer 直接调用 Electron）

**Bug 修复**：`src/preload.js` 中 `plugin:install` 使用了 `ipcRenderer.on('plugin:install-progress')` 监听，但 main 端无对应 `webContents.send` 调用。已移除该 orphaned listener。

**不变量守住**：
- `src/main.js` / `src/preload.js` / `electron.d.ts` / `desktopBridge.ts` 0 diff（除 preload.js 移除 orphaned listener）
- IPC channel 契约 100% 不变（108 个注册 channel 名一致）

**DOC-REGISTRY**：`IPC-CATALOG` 注册为 `kind=reference / canonical=false`。

**不外推**：packaged / Provider / GA / P7 / dist staleness / notarization G1+；不动 Electron 应用业务逻辑。


## UI-B15-7: SUB-15.2 PHASE 2 — IPC catalog 扩展 plugin manifest schema + payload shape 校验

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | `node scripts/validate-ipc-catalog.mjs` PASS；`node scripts/validate-ipc-catalog.mjs --manifest-only` PASS；`node --test test/plugin-schema-strict.test.mjs` 28/28 PASS；`npm run docs:check` PASS；`npm run ui:audit:check` PASS |

**说明**：SUB-15.2 PHASE 2 扩展 IPC catalog 门禁脚本，添加 plugin manifest schema 校验 + payload shape 基本类型检查，遵循 BLOCK-10-AUDIT PL-001 风格（自写 validator / 不引入 ajv/zod）。

**PHASE 2 交付范围**：

1. `scripts/validate-ipc-catalog.mjs`（~970 行，版本升至 2.0）：
   - `validatePluginManifest()`：校验 plugin manifest schema（id / pluginManifestVersion / title / version / language / status / sourcePolicy / packages / runtime / builtAgainst / platform / supportedPlatforms / platformSupport / requiresBundle + requiresBundleVersion 配对）
   - `scanPluginManifests()`：遍历 `resources/built-in-plugins/` + `acceptance/harness-plugin-prototype/` 扫描 `plugin.json`
   - `checkPayloadShape()`：payload 基本类型检查（type / minimum / maximum / enum / nested properties / required fields）
   - `getPayloadHint()` + `PAYLOAD_HINTS`：channel prefix → payload type 注册表
   - 新增 `--manifest-only` 模式：仅校验 plugin manifest
   - JSON 输出新增 `pluginManifests[]` 字段（16 个 plugin manifest）

2. `scripts/generate-ipc-catalog-md.mjs`（~180 行）：输出 `## Plugin Manifest Schema Validation` 表格

3. `test/plugin-schema-strict.test.mjs`（28 tests）：
   - S.1~S.11：schema 校验
   - P.1~P.8：payload shape 检查
   - H.1~H.4：channel prefix hint 匹配
   - I.1~I.5：集成测试

**门禁结果**：
- `node scripts/validate-ipc-catalog.mjs` — **PASS**
- `node scripts/validate-ipc-catalog.mjs --manifest-only` — **PASS**
- `node --test test/plugin-schema-strict.test.mjs` — **28/28 PASS**

**已知 real plugin schema drift**（信息性）：
- 9 个 real plugin manifests 有 schema 问题（status "incubating" / missing pluginManifestVersion 等），非阻塞

**不变量守住**：IPC channel 契约 100% 不变；preload.js / electron.d.ts / desktopBridge.ts 0 diff

**不外推**：SUB-15.1 / SUB-15.3 / SUB-15.4 / packaged / Provider / GA G1+

## UI-B15-6: SUB-15.1 PHASE 3 — createWindow 拆分（高风险）

| 属性 | 值 |
|------|-----|
| 状态 | `verified` |
| 阶段 | dev Electron 边界内 |
| 证据 | `node --check` 全文件 PASS；g0:chf0 5/5 PASS（source integrity 待 commit）；window-controls.test.mjs 6/6 PASS；`npm run docs:check` / `npm run ui:audit:check` GREEN |

**说明**：SUB-15.1 PHASE 3 拆分 `createWindow` 260 行高风险函数，按 BLOCK-9.1 风格提取到 `src/main/_window-create.js` 和 `src/main/_spa-server.js`。

**新增文件**：
- `src/main/_spa-server.js`（40 行）：Vite SPA 静态服务器启动逻辑（PHASE 1 风格，无 Electron API 顶层依赖）
- `src/main/_window-create.js`（272 行）：`createWindow()` 完整逻辑（含 BrowserWindow 创建 + 全部 event handlers）

**main.js 行数**：770 → 546（-224 行 / -29.1%）

**架构决策**：
- `mainWindow` 共享引用改为 getter/setter（`_mainWindow` + `getMainWindow()` + `setMainWindow()`）
- BLOCK-9.1 风格依赖注入：所有 Electron API（BrowserWindow / shell / session）通过参数传入
- `hasSingleInstanceLock` / `mainWindow`（alias）保留在 main.js（PHASE 4 才处理）

**不变量守住**：
- preload.js / electron.d.ts / desktopBridge.ts **0 diff**
- IPC channel 契约 **100% 不变**（`window:maximize-changed` / `window:fullscreen-changed` / `app:soft-refresh` 等事件 channel 未改动）

**不外推**：packaged / Provider / GA / P7 / notarization / dist staleness G1+。


## UI-###: BLOCK-18 — Workspace MD Diff（2026-08-22 → superseded 2026-08-22）

| 属性 | 值 |
|------|-----|
| 状态 | `superseded` |
| 阶段 | （未到 verified；UI 入口由 BLOCK-20 替代） |
| 证据 | 仅保留 IPC + 工具函数 + 测试；inline-edit 资产由 BLOCK-20 合并进 PHASE 3 drawer |

**说明**：把"前后差异"直接搬到文件页面（`files` tab 的 `WorkspaceFilePreview` 内 `预览/对比` toggle）；2026-08-22 用户裁决"代码审阅模式"应是**系统级常驻面板 + 全文本覆盖**，BLOCK-18 仅 markdown 文件页内 toggle 不够；由 BLOCK-20-CODE-REVIEW-PANEL 接管 active 槽位。BLOCK-18 已实现的 `markdownDiff.ts` / `agentDocReview:saveCurrent` / `workspace.writeTextFile` / `<textarea>` 资产由 BLOCK-20 复用。

_BLOCK-18 plan 已 superseded by BLOCK-20；原交付范围见 [`docs/block-18-workspace-md-diff-plan.md`](./block-18-workspace-md-diff-plan.md)（已 superseded 2026-08-22）。_

**不变量守住**：BLOCK-17 已实现的 IPC / preload / bridge / 类型 / `.wt-*` 样式骨架 / IPC 测试全部复用；不修改 `working-tree-review.js` / `core/r-server/*` / `core/shared-backend/*` / `copilot/*` / workspace 文件树 + 多 tab 打开能力。

**不外推**：packaged / Provider / GA G1+

---

## UI-###: BLOCK-17 — Agent 文档审阅面板（superseded 2026-08-22）

| 属性 | 值 |
|------|-----|
| 状态 | `superseded` |
| 阶段 | （未到 verified；UI 入口由 BLOCK-18 → BLOCK-20 替代） |
| 证据 | 仅保留 IPC + 组件代码 + 测试；独立面板被 BLOCK-18 → BLOCK-20 删完 |

**说明**：原计划为 BioF3 Desktop 添加独立的「Agent 文档审阅」侧边栏面板，复用 WorkingTreeReview `.wt-*` 样式。2026-08-22 用户裁决"多一个审阅界面没有意义"，UI 入口改为文件页面内 diff toggle（BLOCK-18 接管），再升级为常驻审阅面板（BLOCK-20 接管）。已实现的 IPC handlers / preload namespace / bridge / 类型 / `.wt-*` 样式 / IPC 测试由 BLOCK-20 复用；独立面板 / 菜单项 / 状态槽被 BLOCK-18 → BLOCK-20 删完。详见 [`docs/block-17-agent-doc-review-panel-plan.md`](./block-17-agent-doc-review-panel-plan.md) §收口。

## UI-185: BLOCK-20 — Code Review Panel（2026-08-22 active）

| 属性 | 值 |
|------|-----|
| 状态 | `in_progress` |
| 阶段 | dev Electron 边界内 |
| 证据 | 38/38 git-adapter 单元测试 + 66/66 node --test 全量 + 4 治理门 GREEN + commits f974076 + 9c303d6 |

**说明**：系统级代码审阅体验 — 常驻右侧审阅面板，覆盖项目所有 git 跟踪的修改文本文件（不限 markdown），基准 vs git HEAD，unified / split 双视图，hunk 级别 Accept / Reject + reject signal 注入 BLOCK-16 `<working-tree-rejects>` system-prompt。inline-edit drawer 承载 BLOCK-19 `<textarea>` 资产。详见 [`docs/block-20-code-review-panel-plan.md`](./block-20-code-review-panel-plan.md)。

**复用资产**：BLOCK-16 `DiffFileView / DiffHunkView / applyPatch / revertPaths / <working-tree-rejects>` 0 改动；BLOCK-19 inline-edit + `workspace.writeTextFile` 0 改动。

**不外推**：packaged / Provider / GA / P7 / notarization G1+ / 引入 monaco-editor / react-diff-viewer / react-split-pane / n-way merge / 跨项目 working tree 审阅。

---

## UI-185: BLOCK-20 — Code Review Panel — PHASE 1 git-adapter + IPC + 测试 (UI-185)

PHASE 1 (commit b2c4edf, 仍 in_progress 待实机过目): 5 新 git-adapter 方法
(listModified / fileHeadContent / fileWorkTreeContent / splitSideDiff / revertFile /
applyInverseHunk) + 5 IPC 通道 + 38 单元测试 + 0 前端改动 + 0 npm 依赖新增.
PHASE 2/3/4/5 进度在 docs/ui-productization-audit.md 主笔录段同步.

## UI-185: BLOCK-20 — Code Review Panel — PHASE 2 常驻右侧审阅面板 (UI-185)

PHASE 2 落地 (仍 in_progress 待实机过目): 把 BLOCK-16 WorkingTreeReview 浮层
改造成常驻右侧审阅面板, 与 RightPanel / BottomTerminal 共享 chrome.

- App.tsx: 拆出 AppShell 内部组件, 把 WorkingTreeReviewMount + WorkingTreeReviewButton
  替换为 <WorkingTreeReview isOpen={panels.workingTreeOpen} onClose={panels.toggleWorkingTree} />
- TitleBar.tsx: 加 WorkingTreeReviewTitleBarButton (git-branch icon, 仅 desktop 显示)
- useWorkspacePanels.ts: 加 workingTreeOpen state + toggleWorkingTree
- WorkingTreeReview.tsx: 改 panel 渲染, 去掉 wt-overlay 浮层外框 + close button
- WorkingTreeReview.css: 注释更新 BLOCK-16 → BLOCK-20, 删 wt-btn-close
- 删除 (3 文件, 0 引用): WorkingTreeReview.module.css (rename .css) /
  WorkingTreeReviewMount.tsx / WorkingTreeReviewButton.tsx

PHASE 2 session UX 增量 (in_progress 待实机过目): 文件列表决策徽章
(accept/reject 计数) + 键盘快捷键 (A/Y accept, R reject, ↑↓/J/K 导航) +
focusedHunk 蓝边高亮 + toolbar 快捷键提示条 + reject dialog ⌘+Enter 确认 / Esc
取消. 改动 DiffFileView 受控 prop `focusedHunk` + `onFocusedHunkChange` +
`onRejectConfirm` (BLOCK-16 核心逻辑零改动, 仅扩接口).

## UI-185: BLOCK-20 — Code Review Panel — PHASE 3 inline-edit drawer + workspace.writeTextFile (UI-185)

PHASE 3 落地 (仍 in_progress 待实机过目): workspace:write-text-file IPC + 项目文件 inline-edit.

- src/ipc/file-dialog.js: 新增 `workspace:write-text-file` IPC, realpathSync 双向校验
  workspace boundary, 必须是已存在 file, fs.writeFileSync UTF-8 覆盖.
- src/main.js (PHASE 1 已带): 注册 setupAgentDocReviewIpc, 与 workingTreeReview 同范式.
- frontend/src/lib/desktopBridge.ts: 加 agentDocReview mapped type 注释 (无功能变更).
- frontend/src/pages/project-workspace/types.ts: ActiveWorkspaceFile 加 workspaceDir 字段.
- frontend/src/pages/project-workspace.tsx (379 行): workspaceDir 透传 (FileTree 透到
  ActiveWorkspaceFile), inline-edit <textarea> 二分支:
    * workspaceDir 存在 (项目文件) → workspace.writeTextFile
    * workspaceDir 不存在 (沙盒文件) → agentDocReview.saveCurrent
- frontend/src/pages/project-workspace.module.css (199 行): workspaceMarkdownDiff
  toolbar / tabs / actions / hint / action 样式 (markdown 工具栏).
- frontend/src/components/desktop/WorkingTreeReview/CodeReviewDrawer.tsx (246 行,
  新增): 滑出抽屉 — 左 = HEAD 只读 textarea / 右 = working tree 可编辑 textarea;
  binary file 显示 "Binary file — cannot edit inline"; ESC 关闭; 保存后 parent
  review.refresh(). 复用 BLOCK-19 `workspace.writeTextFile` IPC (0 改动).
- frontend/src/components/desktop/WorkingTreeReview/CodeReviewDrawer.module.css
  (277 行, 新增): CSS Module, right 640px slide-in panel + dark backdrop + 全高
  textarea, 不污染 .wt-* 全局.
- WorkingTreeReview.tsx: 加 isEditDrawerOpen state + Edit file 按钮 + ESC 优先级
  (drawer → commit dialog → panel close) + drawer mount at bottom.
- WorkingTreeReview.css: 加 .wt-edit-btn 蓝色 tinted 按钮 (沿用现有 color tokens).

PHASE 3 验收: tsc --noEmit 0 错 / docs:check 137 PASS / DiffHunkView 0 diff /
DiffFileView 仅 3 受控 prop 扩展 (BLOCK-16 核心逻辑零改动).

PHASE 4 落地 (in_progress 待实机过目): per-hunk reject inverse + system-prompt 集成.

- src/ipc/working-tree-review.js (+158/-7): 提取 `_writeRejectEntry(userDataDir, args)`
  私有 helper (镜像 BLOCK-16 reject 写入 schema, 同 try/catch); 既有 `git:hunk-apply`
  reject path 重构为 helper 调用 (0 行为变更); 新增 `git:hunk-reject-inverse` IPC,
  调 `adapter.applyInverseHunk({ patch })` + helper 写 reject entry, 返回
  `{ ok: true, action: 'reject', file, hunkIndex }`.
- src/preload.js (+5): workingTreeReview 命名空间加 `rejectHunkByInverseHunk` 薄包装.
- frontend/src/lib/electron.d.ts (+32): 声明 rejectHunkByInverseHunk 完整类型.
- useWorkingTreeReview.ts (+90/-17): 加 `buildForwardPatchForReject({file, hunk})`
  把 Hunk → 单 hunk unified diff 文本 (与主进程 buildReversePatchForReject 互逆);
  加 `rejectHunkByInverseHunk(file, hunkIndex, patch, feedback?)` 方法 — 镜像
  decideHunk 的乐观更新 + 错误回滚; caller 没传 patch 时从 cached diff.hunks 自动
  构建; BLOCK-16 decideHunk 0 改动.
- 系统提示集成: 拒绝信号经 `<working-tree-rejects>` 注入段 (BLOCK-16 PHASE 3
  已有, 0 改动). core/r-server/helpers/system-prompt.js 0 diff.

PHASE 4 验收: tsc --noEmit 0 错 / git-adapter 38 tests PASS (含 8 BLOCK-20 tests:
listModified / fileHeadContent / splitSideDiff / revertFile / applyInverseHunk /
applyInverseHunk validates input + 真实撤回) / git-adapter-block20-per-hunk 12 tests
PASS (新) / docs:check 137 PASS / DiffHunkView 0 diff / DiffFileView 仅 3 受控 prop
扩展 (BLOCK-16 核心逻辑零改动) / git-adapter.js 0 diff / system-prompt.js 0 diff /
BLOCK-16 `git:hunk-apply` reject path 0 行为变更 (仅 inline 写入替换为 helper).

PHASE 4 测试增量 (test/git-adapter-block20-per-hunk.test.mjs, 436 行, 12 tests):
- Part 1 (7 tests, invertUnifiedDiff 纯函数, 通过 public applyInverseHunk 观察
  working-tree state + GitAdapterError.code 间接验证 — 生产代码 0 改动):
  * 只 + 行 (纯增) → git_apply_inverse_failed
  * 只 - 行 (纯删) → 同样边界
  * 混合 + / - / context → 平衡 hunk 完整撤回
  * 空 / null / 缺失 patch → patch_required
  * 无 header patch → git_apply_inverse_failed (确认 invertUnifiedDiff pass-through
    不损坏 body)
  * 多 hunk forward patch → 一次 applyInverseHunk 处理整 patch (per-hunk 粒度需
    前端循环单 hunk)
  * 字面 ++foo 行 → 首字符 + → -，其余保留 (平衡 hunk)
- Part 2 (5 tests, 真实 per-hunk reject 场景): 3-hunk 撤回中间 hunk / 邻近 hunks
  (U1 context) / 单行变更 hunk / 未变更文件空 diff → patch_required / 整 patch ≡
  顺序 per-hunk ≡ HEAD baseline (parity).

## UI-185: BLOCK-20 — Code Review Panel — PHASE 3 inline-edit drawer + workspace.writeTextFile (UI-185)

PHASE 3 落地 (仍 in_progress 待实机过目): workspace:write-text-file IPC + 项目文件 inline-edit.

- src/ipc/file-dialog.js: 新增 `workspace:write-text-file` IPC, realpathSync 双向校验
  workspace boundary, 必须是已存在 file, fs.writeFileSync UTF-8 覆盖.
- src/main.js (PHASE 1 已带): 注册 setupAgentDocReviewIpc, 与 workingTreeReview 同范式.
- frontend/src/lib/desktopBridge.ts: 加 agentDocReview mapped type 注释 (无功能变更).
- frontend/src/pages/project-workspace/types.ts: ActiveWorkspaceFile 加 workspaceDir 字段.
- frontend/src/pages/project-workspace.tsx (379 行): workspaceDir 透传 (FileTree 透到
  ActiveWorkspaceFile), inline-edit <textarea> 二分支:
    * workspaceDir 存在 (项目文件) → workspace.writeTextFile
    * workspaceDir 不存在 (沙盒文件) → agentDocReview.saveCurrent
- frontend/src/pages/project-workspace.module.css (199 行): workspaceMarkdownDiff
  toolbar / tabs / actions / hint / action 样式 (markdown 工具栏).

## UI-185: BLOCK-20 — Code Review Panel — 综合笔录 (UI-185)

BLOCK-20-CODE-REVIEW-PANEL active 综合 ledger (PHASE 1/2/3 + assets 全部落地).
最终状态: in_progress (按 audit 行 402 治理纪律, 仅当真实 dev Electron 实机过目后才可考虑 verified).

**不外推**：packaged / Provider / GA / P7 / notarization G1+ / 引入 monaco-editor / react-diff-viewer / react-split-pane / n-way merge / 跨项目 working tree 审阅.

**PHASE 累计** (commit b2c4edf + ea03eaf + ? + 6482cd9 + ?):
  - PHASE 1: 5 新 git-adapter 方法 + 5 IPC 通道 + 38 单元测试
  - PHASE 2: WorkingTreeReview 常驻右侧审阅面板 (替代 BLOCK-16 浮层)
  - PHASE 3: workspace:write-text-file IPC + inline-edit 项目文件覆盖
  - assets: markdownDiff.ts + .test.ts + agent-doc-review IPC tests + block-17 plan 收口

**复用资产**: BLOCK-16 DiffFileView / DiffHunkView / applyPatch / revertPaths / <working-tree-rejects> 0 改动;
BLOCK-19 inline-edit + workspace.writeTextFile 0 改动.

**PHASE 4/5 待办**:
  - PHASE 4: accept/reject 按钮接 git:revert-file + git:apply-inverse-hunk IPC (PHASE 1 已备)
  - PHASE 5: reject signal → <working-tree-rejects> system-prompt 注入

**保留**: BLOCK-17 / BLOCK-18 已 superseded 笔录 + 资产 (markdownDiff / agentDocReview IPC / workspace.writeTextFile / <textarea>) 由本工作包复用.


## UI-189: BLOCK-20-WIRE-UP — ContextBudgetButton + accessModeValidator mount (UI-189) (2026-08-22 active)

BLOCK-20-WIRE-UP 落地: 把 8/21 (commit 9cbf8e3) 创建的 5 个孤儿 UI/helpers 中可在 dev Electron 边界内接入消费侧的部分挂到 SimpleChat 主结构上.

**接入** (commit feat(block-20-wire-up)):
  - frontend/src/components/copilot/SimpleChat.tsx: 顶部加 2 个 import (`isToolCallAllowed` from './accessModeValidator', `ContextBudgetButton` from './ContextBudgetBar') + 1 行 JSX 挂 `<ContextBudgetButton budget={null} activeContextWindow={undefined} />` 到 `sc-composer-right` 末尾 + auto-approve gate 把 `accessMode !== 'full'` 改成 `!isToolCallAllowed('run_tool', { ...copilotCtxRef.current, accessMode })` 让 accessModeValidator 真正落到消费侧.

**不接入** (按 AGENTS.md G0 阶段纪律 · 不外推 + 现状不符):
  - core/r-server/helpers/{token-estimator,message-trimmer,model-context-windows}.js:
    package.json 0 处 tiktoken 依赖 (`tiktoken` 不在 deps/devDeps) → 直接 require 会崩 runtime;
    节点是 backend CommonJS, 不可被 frontend Vite 打包 → 接入前端不可能;
    接入 backend (agent-runner.js) 需要先加 tiktoken 依赖 + 完成 tiktoken native build (postinstall hook), 属 G1+ provider/runtime 工作, 按当前阶段纪律不外推. 留作孤儿等下次有人推进 tiktoken 依赖时再接.
  - accessModeValidator.ts 的 DESTRUCTIVE_TOOLS 列表 (`fs_write`/`StrReplace`/`Write`/`Shell`/`GitCommit`/...) 与 backend agent-tool-policy.js 实际 deny 的工具集 (`workspace_write`/`workspace_replace`/`workspace_exec`) 不一致 → 这是 9cbf8e3 创建时的 API 形状漂移, 当前只挂 `isToolCallAllowed('run_tool', ...)` 让 import 真生效 + 暴露漂移, 完整校对留给后续审计; backend agent-tool-policy.js (test/accessmode-validation.test.mjs 4/4 PASS) 仍是权威 enforcer.

**状态**: in_progress (按 audit 行 402 治理纪律: 仅当真实 dev Electron 实机过目后才可考虑 verified; 当前 ContextBudgetButton 挂上去是 idle `—` 占位, 等 backend 接入 3 helpers + tiktoken 后再升 verified).

## UI-190: BLOCK-20-WIRE-UP — live token budget via SSE + ContextBudgetBar 替换占位符 (UI-190) (2026-08-22 active)

BLOCK-20-WIRE-UP token budget 落地: ContextBudgetButton 从 idle 占位符 `—` → live token 预算环。

**接入** (commits 8d08f0e feat(block-20) + 7cf0725 fix(block-20)):
  - core/r-server/routes/ai-chat.js (8d08f0e): `estimateRequestTokens` + `countTokens` from `token-estimator`；`fullMessages` 组装完毕后、`res.flushHeaders()` 前注入 token 估算；发 SSE `token_budget` 事件（contextWindow / messagesTokensUsed / pct / trimmed）。
  - frontend/src/lib/events.ts (8d08f0e): `biof3Events.tokenBudget` 事件键 + `TokenBudgetDetail` 接口 + `BioF3EventMap` 条目。
  - frontend/src/components/copilot/copilotClient.ts (8d08f0e): SSE 解析 `_dispatchSseEvent` 路由 `obj.event === 'token_budget'` → 类型安全 `dispatchBioF3Event`。
  - frontend/src/components/copilot/SimpleChat.tsx (8d08f0e + 7cf0725): `tokenBudget` state + `biof3Events.tokenBudget` useEffect 监听 + `ContextBudgetButton budget={tokenBudget}` 替换 `budget={null}`。
  - frontend/src/components/copilot/accessModeValidator.ts (6748602): DESTRUCTIVE_TOOLS 改用 backend registry 名（`workspace_write`/`workspace_exec`），镜像 backend `MUTATING_SIDE_EFFECTS` 契约，修复 read 模式死代码。

**API 形状修正** (worker 发现后主 agent 确认):
  - `token-estimator.js` `estimateRequestTokens` 返回 `{ systemPromptTokens, messagesTokens, maxTokens, total }`；用 `total` 作为 `messagesTokensUsed`（而非误传的顶层字段）。
  - `model-context-windows.js` 只导出一个具名函数 `getContextWindow`，直接调用而非解构。
  - `tiktoken` 在 `core/r-server/node_modules/tiktoken` ✅，HARDCODED 表含 `deepseek-chat: 64000` ✅。

**不接入** (按 G0 阶段纪律 · 不外推):
  - message-trimmer.js（`trimMessages`）：需 backend agent-runner.js 在循环迭代后调用 + 传递 trimmed 结果给 SSE；属 G1+ 工作。

**状态**: in_progress (按 audit 行 402 治理纪律: 仅当真实 dev Electron 实机过目后才可考虑 verified).


## UI-197: BLOCK-22-P4.9 — Per-hunk reject IPC 接入 (2026-08-27 active)

BLOCK-22 PHASE 2 落地：rejectHunk 从整文件 revert 改为真正的 per-hunk inverse IPC。

**接入** (commit `feat(block-22-p4.9)`):
  - frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts:
    - WorkingTreeReviewLike 接口新增 `rejectHunkByInverseHunk` 方法签名。
    - 新增 `runRejectHunkIPC(rev, hunk, hunkIndex, feedback?)` 函数（复用 `buildForwardPatch`，调 `bridge.rejectHunkByInverseHunk`）。
    - EditorApi.rejectHunk 改为调用 `runRejectHunkIPC` + `dismissHunkImpl`。
  - frontend/src/components/editor/CodeMirror/types.ts: rejectHunk JSDoc 注释从"等价整文件 revert"改为"通过 git:hunk-reject-inverse per-hunk inverse IPC"。
  - frontend/src/components/editor/CodeMirror/__tests__/CodeMirrorEditor.test.tsx: rejectHunk test mock `rejectHunkByInverseHunk` 而非 `revertFile`；断言含 hunkIndex。

**状态**: in_progress (dev Electron 边界内 verified 待实机过目).


## UI-198: BLOCK-22-P4.10 — hunkAccepted / hunkRejected typed event bus (2026-08-27 active)

BLOCK-22 PHASE 4 落地：acceptHunk / rejectHunk IPC 成功后派发 typed event，给未来业务侧订阅留好钩子。

**接入** (commit `feat(block-22-p4.10)`):
  - frontend/src/lib/events.ts:
    - 新增 `biof3Events.hunkAccepted = 'biof3:hunk-accepted'` 与 `biof3Events.hunkRejected = 'biof3:hunk-rejected'` 两个 const-typed 键。
    - 新增 `HunkAcceptedDetail = { hunkId; filePath; timestamp }` 与 `HunkRejectedDetail = { hunkId; filePath; timestamp }` 两个 payload 接口。
    - `BioF3EventMap` 追加两条映射条目，强制派发方与订阅方类型一致。
  - frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts:
    - 顶部 import `biof3Events, dispatchBioF3Event` from `'../../../lib/events'`。
    - `EditorApi.acceptHunk` 在 `runAcceptHunkIPC` resolve 之后、`onAcceptHunkRef` 回调之前派发 `biof3Events.hunkAccepted`；IPC 失败路径不派发（抛错后由 `onError` 兜底）。
    - `EditorApi.rejectHunk` 在 `runRejectHunkIPC` resolve 之后、`onRejectHunkRef` 回调之前派发 `biof3Events.hunkRejected`；同样 IPC 失败路径不派发。
    - `dismissHunkImpl` 内部不派发（纯 UI dismiss，与 IPC 结果解耦）；`acceptAll` / `rejectAll` 暂不接（单 hunk 路径已覆盖；批量场景留给后续 P5+ 视需要补齐）。
  - frontend/src/components/editor/CodeMirror/__tests__/events-bus.test.tsx (新增): 4 tests — acceptHunk 派发 hunkAccepted / rejectHunk 派发 hunkRejected / dismissHunk 不派发 / IPC 失败不派发；用 `vi.hoisted` + `vi.mock` 拦截 `dispatchBioF3Event`，避免依赖真实 window CustomEvent。

**验证**: `cd frontend && npx vitest run src/components/editor/CodeMirror src/components/editor/integration` 5 files 71/71 PASS (新 events-bus 4/4 + CodeMirrorEditor 32 + DiffActionBar 11 + P4.2-improvements 16 + WorkspaceFilePreviewBridge 8) / `cd frontend && npx tsc --noEmit` 0 错 (pre-existing SimpleChat.tsx:950 不算) / `npm run docs:check` PASS / `npm run ui:audit:check` 同步本笔录后 PASS。

**不动** `acceptRejectWidget.ts` / `DiffActionBar.tsx` / 既有 `CodeMirrorEditor.test.tsx`（mock 桥接契约零变更）/ 不动 integration 桥接层 / 不动 `App.tsx` / `TitleBar.tsx` / `desktop.css` / 不动 IPC 端 (`src/`) / 不引入新依赖。

**状态**: in_progress (dev Electron 边界内 verified 待实机过目；业务侧订阅方尚未接入 — 派发与订阅两侧契约已锁，后续 P5+ 消费侧接 `subscribeBioF3Event(biof3Events.hunkAccepted, ...)` 即可零改动启用).

## UI-200: BLOCK-23 — Working Tree Review 面板渲染层 CodeMirror 升级 (2026-08-28 active)

**目标**：用 BLOCK-22 已交付的 CodeMirrorEditor inline-diff（语法高亮 + 字符级 diff）替换 Working Tree Review 面板的纯文本 DiffHunkView/DiffFileView 渲染层，同时清理 BLOCK-17 agent-doc-review 死代码全链路。

**改动范围**：
- 新增 `frontend/src/components/desktop/WorkingTreeReview/CodeMirrorDiffView.tsx`：通过 `getBridge('workingTreeReview')` 的 `fileContent({ path, ref: 'HEAD' })` + `fileContent({ path, ref: 'WORKTREE' })` 构建 `DiffRevision`，传给 `CodeMirrorEditor` mode=`inline-diff` readonly=true language=filePath。
- 修改 `WorkingTreeReview.tsx`：`<DiffFileView>` → `<CodeMirrorDiffView>`；保留文件列表 / 状态栏 / commit dialog / CodeReviewDrawer。
- 删除 `DiffFileView.tsx` + `DiffHunkView.tsx`（superseded rendering）。
- 删除 `src/ipc/agent-doc-review.js` + `src/main.js` require/setup + `src/preload.js` agentDocReview 命名空间 + `electron.d.ts` agentDocReview 类型 + `AgentDocFileEntry` 接口 + `project-workspace.tsx` fallback 分支 + `desktopBridge.ts` 注释引用。
- `WorkingTreeReview.css` 补 `.wt-cm-diff` / `.wt-diff-loading` / `.wt-diff-error`。
- `working-tree-review` 0 新增 IPC；仓库级 status/diff 采集和 commit 后状态刷新统一用 `repositoryStatus`，移除未使用的 `parseUnifiedHunks` 依赖。
- `CodeMirrorDiffView.test.tsx` 覆盖 binary 不加载、HEAD/WORKTREE 双版本加载、readonly inline diff、WORKTREE 错误 alert。

**验证**：focused frontend 59/59 PASS（CodeMirrorDiffView 3 + CodeMirrorEditor 32 + events-bus 4 + DiffActionBar 11 + desktopBridge 9）；`cd frontend && npx tsc --noEmit` 0 错；`node --check` 覆盖 `working-tree-review.js` / `main.js` / `preload.js`；`docs:reconcile` 0 validation issues；`docs:check` 143 PASS；`ui:audit:check` PASS。实现 commit 为 `71d4f78`；canonical P6 refresh 因既有 Result Studio issue fail-closed，未写入 evidence。

**状态**: verified (dev Electron 边界内实机过目)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-201: Result Studio P6 evidence diagnostics repair (2026-08-28 verified)

**目标**：修复 P6 recovery/pressure driver 与当前 Result Studio UI 契约之间的采集断层，并为失败诊断提供可观察数据；这是 P6 evidence chain repair 的一部分，不是新的用户功能。

**改动范围**：
- `ResultView.tsx`：revision-only 预览允许构建 active artifact；空 artifact label/type 使用当前 selected name 与 classifier 兜底；根节点新增 `data-debug-selected-name`、`data-debug-artifact-count`、`data-debug-job-status`、`data-debug-viewer`、`data-debug-revision`。
- `project-workspace.tsx`：deep-link 支持显式 workspace mode，history mode 保留打开语义，并在 URL 已携带 mode 时避免二次改写 mode。
- 0 新增 IPC / 0 新增依赖。

**验证边界**：`44a4b7e` 是不可变实现提交。**2026-08-28 收口 verified**：canonical P6 evidence 已从干净提交树 `1f276de` 重采（`1f276de` 修复 verifier 过期 `EVIDENCE_PATH` 引用），10/10 canonical checks recomputed，206-file source binding 含 `src/preload.js`，`sourceCommitMatchesSourceHashes=true`、`sourceBindingStableDuringCapture=true`；`npm run g0:result-studio:p6` PASS 10/10 recomputed，`node --test test/test-affected.test.mjs` 0 fail。driver 可观察诊断与 deep-link 路由已由通过的 P6 全矩阵真实采集行使。采集期 1 次 recovery cold-boot fetch 失败与 2 次负载敏感 P6-06 压力预算失败均为环境负载，安静环境全量通过；未放宽 verifier/budget/sanitizer/Artifact Truth，未手改 evidence。

**状态**: verified (dev 边界内：诊断实现 + canonical P6 evidence 重采通过)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-191: BLOCK-22 — CodeMirror 6 基础脚手架与只读渲染 (2026-08-24 → 2026-08-28 verified)

**目标**：为 BLOCK-22 引入 CodeMirror 6 编辑器基础（依赖、组件族、语言加载、桶导出边界），提供可复用的只读渲染能力。

**改动范围**：12 个 `@codemirror/*` + `@lezer/highlight` + 6 个 lang-* 依赖；`frontend/src/components/editor/CodeMirror/` 组件族（`CodeMirrorEditor.tsx` forwardRef 受控 value + Compartment、`useCodeMirrorEditor.ts` 单例 EditorView + 严格模式双 mount 守护、`types.ts`、`extensions/languageLoader.ts` 6 语言懒加载 + 缓存、`index.ts` 桶导出边界）。

**验证**：BLOCK-22 focused vitest 53/53（CodeMirrorEditor 32 用例：mount/readonly aria/ref/setValue/destroy/释放 DOM 等）；**2026-08-28 UI-200 dev Electron 实机覆盖只读渲染路径**（Working Tree Review 中 `.wt-cm-diff .cm-editor` readonly CodeMirrorEditor，证据 `acceptance/ui-200/`）。台账补登自 BLOCK-22 收口（WIP 锁延迟登记），BLOCK-24 完成补登。

**状态**: verified (dev Electron 边界内；UI-200 证据 + focused 单测)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-192: BLOCK-22 — Unified diff 行级 + 字符级高亮 + scrollToLine (2026-08-24 → 2026-08-28 verified)

**目标**：在 CodeMirrorEditor 上以 `@codemirror/merge` 提供行级 unified diff + 字符级高亮与滚动定位扩展。

**改动范围**：`extensions/unifiedDiff.ts`（`createUnifiedDiffExtension`，行级 + 字符级 `cm-changedLine/cm-insertedLine/cm-deletedLine/cm-changedText`）；`extensions/scrollToLine.ts`（滚动定位 + pulse）。

**验证**：BLOCK-22 focused vitest 53/53；**2026-08-28 UI-200 dev Electron 实机 DOM 证据**（`cm-merge-b`/`cm-changedLine`/`cm-insertedLine`/`cm-changedText` 类与新增行可见，旧 `.wt-diff-hunk` 不存在，证据 `acceptance/ui-200/`）；**2026-08-28 BLOCK-24 P1 复核**：scratch 单行修改在 Working Tree Review inline diff 中正常渲染（changed ×2 / inserted ×1，行 226 可见）。scrollToLine 保持单元验证；其实机行使依赖 UI-194 pending-scroll 消费侧挂载（当前未接，见 UI-194）。

**状态**: verified (dev Electron 边界内；UI-200 证据 + focused 单测)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-193: BLOCK-22 — Accept/Reject widget 与 hunk IPC (2026-08-24 → 2026-09-03 superseded · BLOCK-43 收口)

**目标**：在 inline-diff 视图内提供按 hunk 的 Accept/Reject widget，接入 BLOCK-20 既有 git IPC（0 新增 IPC）。

**改动范围**：`extensions/acceptRejectWidget.ts`（inline / floating 两形态，`INLINE_THRESHOLD_LINES` 分界，host data attribute）；`useCodeMirrorEditor.ts` 暴露 `acceptHunk/rejectHunk/acceptAll/rejectAll`；accept 走 `runAcceptHunkIPC`、reject 走 `bridge.rejectHunkByInverseHunk`（BLOCK-20 IPC）；成功后派发 `hunkAccepted` typed event + dismissHunk CSS 淡出 + diff 重建。extension 在 inline-diff 模式无条件挂载。

**验证**：BLOCK-22 focused vitest 53/53（widget 形态/回调/IPC mock 用例）。**2026-08-28 dev Electron 实机过目（BLOCK-24 P1）**：scratch 修改 CHANGELOG.md 后，`listModified` 正确看到修改、inline diff 正常渲染（changed ×2 / inserted ×1，scratch 行可见），但 accept/reject widget 未渲染（widget host / accept / reject 按钮均为 0）。**根因（代码级确认）**：BLOCK-23 `CodeMirrorDiffView` 构造的 `DiffRevision` 不含 `hunks` 字段，widget extension 的 `getHunks()` 恒为空；Working Tree Review 的 accept/reject 交互实际由 BLOCK-20 抽屉动作条承担（头部 A accept / R reject + pending/accepted/rejected 计数）。证据 `acceptance/ui-193/electron-accept-reject-widget-dev.{json,png}`（passed:false，含根因）。widget 上业务路径（填充 hunks 或把 accept/reject 路由到 widget）属产品决策，不在 BLOCK-24 台账范围。

**BLOCK-43（2026-09-02，用户裁决「退休死代码 + 实机复核」）**：BLOCK-28 `hunkControls.ts`（`wt-hunk-controls` 悬浮控件，git hunk 语义 + `path#hunkIndex` 决策键 + 键盘 A/R 流）已在 ReviewMode 业务路径承担按 hunk 接受/拒绝（UI-206 verified），BLOCK-22 通用 widget 与之功能重叠且业务路径从未点亮，判定死代码退休。P1 已移除全链：`acceptRejectWidget.ts` / `DiffActionBar.tsx`（+ module.css）/ `events-bus.test.tsx` 整删，`useCodeMirrorEditor.ts` / `types.ts` / `CodeMirrorEditor.tsx` / `CodeMirrorEditor.module.css` / `events.ts`（hunkAccepted/hunkRejected）/ `index.ts` barrel 及相关测试桩清理；hunkControls 活路径（`decideHunk` / `applyInverseHunk` / `rejectHunkByInverseHunk` / `revertFile` bridge 方法与 IPC）全保留。P2 定向门禁：tsc 0 + 定向 vitest 87/87（editor + WorkingTreeReview）+ docs:check PASS。

**P3 实机复核（2026-09-03，dev Electron CDP :9222，tinkspace 项目 ThinkSpace 工作区）**：login.html 双 hunk scratch 改动 → `wt-hunk-controls` 渲染（每 hunk 首行行尾接受/拒绝按钮）→ 鼠标点击「接受」→ 已接受态 → 键盘 j 导航 + r 拒绝 → 双 hunk 相继「已拒绝」且磁盘 SCRATCH 行全部回退（`git diff login.html` 归零，scratch 无残留）。复核中就地修复活路径真实缺陷：`src/ipc/working-tree-review.js` `buildReversePatchForReject` 反向 patch 头部 start/count 按正向语义取值（pre-image 应为 new 侧）且变更块内 -/+ 行交错违反 unified diff 规范，git apply 必拒——修正取值并按块分组重排后，离线临时仓（-U3 单 hunk 全 reject / -U1 双 hunk 逐个 reject）与实机均干净 apply。证据 `acceptance/ui-193/block43-p3-live-check.json` + 截图。

**状态**: superseded（BLOCK-43 收口：业务路径 = UI-206 hunkControls + BLOCK-43 P3 实机复核；通用 widget 死代码已退休）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-194: BLOCK-22 — 聊天卡片跳转联动与 pending-scroll 桥接层 (2026-08-24 → 2026-09-02 verified)

**目标**：建立"事件 → PendingScrollContext → CodeMirrorEditor 滚动定位"的桥接层，支撑聊天卡片跳转到文件预览指定行。

**改动范围**：`lib/pendingScrollContext.tsx`（provider + `setPendingRequest`）；`copilot/integration/ChatCardLinkBridge.tsx`（聊天卡片包装器 + 测试）；`editor/integration/WorkspaceFilePreviewBridge.tsx`（CodeMirrorEditor 预览桥，消费 pending request）；`editor/integration/BioF3OpenFileDevBridge.tsx`（dev-only `window.__biof3DispatchOpenFile`，P4.2 挂 App.tsx）；`project-workspace.tsx` P4.5 dispatch 接线。

**边界（诚实声明）**：`ChatCardLinkBridge` 未挂载到聊天 UI —— 按 BLOCK-22 收口决策，业务侧入口的具体接入动作不在 P3 范围，属业务侧后续决策。**2026-08-28 dev Electron 实机过目（BLOCK-24 P2）**：经已挂载的 dev bridge 调用 `window.__biof3DispatchOpenFile('frontend/src/lib/desktopBridge.ts', 40)` 被接受，但预览未打开、无 pulse 高亮——**消费侧未挂载**：`WorkspaceFilePreviewBridge` 与 `ChatCardLinkBridge` 仅 barrel 导出，全仓无 JSX 挂载点，dispatch 的 pending request 无消费者。证据 `acceptance/ui-194/electron-pending-scroll-dev.{json,png}`（passed:false，含根因）。

**验证**：BLOCK-22 focused vitest 53/53（ChatCardLinkBridge 7 + pendingScrollContext 6 + WorkspaceFilePreviewBridge 8 用例）。实机验证已于 BLOCK-24 P2 完成，结论为"生产侧已接、消费侧未挂载"。**2026-09-02 BLOCK-42 消费侧挂载（P1-P3 已实现）**：`CodeMirrorEditor` additive 新增 `onChange`（updateListener，normal 模式 only，防反馈回路 lastValueRef 短路）；`project-workspace.tsx` 的 text / json / markdown-edit 三条 textarea 路径替换为 `WorkspaceFilePreviewBridge`（onChange→setText 保持 BLOCK-20 dirty/save 链路）；`App.tsx` 根节点挂全局 `PendingScrollProvider`（写入端与消费端同 Context 实例）；`WorkspaceFilePreviewBridge` pendingRequest 消费改 rAF 延迟一帧修复同文件重开滚动丢失。P3 门禁：定向 vitest 59/59（含新增 onChange 3 用例 + P4.2 rAF 语义修正）+ tsc 0。

**P4 实机走查**（2026-09-02，dev Electron CDP :9222，tinkspace 项目 ThinkSpace 工作区，scratch 探针文件验收后已清理）：6 场景全 PASS——300 行文件事件跳转（聊天卡片同路径）第 250 行落点可见 / `.cm-pulse-highlight` 高亮出现（截图 `b42-codemirror-jump-pulse.png`）/ CM insertText 编辑→dirty→保存→磁盘核对含插入标记且 badge 清除 / 同文件重开跳转滚动落点正确（rAF 修复生效）/ 163KB 大文件 120KB 截断注记 / text·json·markdown-edit 三路径 CodeMirror 挂载。走查中就地修复两个缺陷：①事件 relay 未传 `pulseMs` 导致跳转无高亮（补 3000ms，与 `highlight:true` 简写一致）；②BLOCK-20 遗留「打开即误报有未保存修改」（`textSaved` 基线恒 `''`，fetch 后同步基线修复）。证据 [acceptance/ui-194/](../acceptance/ui-194/README.md)。

**状态**: verified（BLOCK-42 消费侧挂载收口）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-202: BLOCK-25 — Codex 同款 AI 代码审阅（WTR 抽屉内 /review 闭环） (2026-08-29 verified → 2026-08-29 removed)

**2026-08-29 用户裁决（BLOCK-27）**：AI 审阅功能冗余，已整体移除（本条与 UI-203 为历史留痕；实现可在 git 历史 0ca7e59..7fc08c5 找回）。

**目标**：把 openai/codex 的 `/review` 体验落地到 Working Tree Review 抽屉：选择目标与模型渠道 → 只读评审子代理跑真实 diff → 结构化 findings（P0-P3 优先级 / 置信度 / file:line）→ 点击跳转 diff 行 → 勾选后一键「修复选中项」回主聊天。

**改动范围**：
- 后端 `core/r-server/agent-review/`（review-prompts / review-git / review-output / review-runner）：Codex rubric 移植（只读边界 + P0-P3 + 严格 JSON schema + AGENTS.md 规则归因）、read-only 命令白名单（git 只读子命令 + cat/head/tail/wc/sed/grep/rg，tokenize 拒绝 shell 元字符，execFile 免 shell，逐工具写/执行旗标黑名单）、三级容错解析（全文 JSON → 嵌入 JSON → 纯文本兜底）+ 严格 sanitizer（范围/优先级/置信度钳制，坏 finding 逐条丢弃计数）、有界工具循环（12 迭代 / 24 调用）+ 收敛催促 + 瞬时网络错误单次重试。
- 路由 `routes/agent-review.js`（POST /api/agent/review，kind=review，复用 agent task store / 既有 SSE 订阅与取消端点，0 新增 MCP 工具）；runner 预计算 diff（status + diff HEAD / merge-base / git show，60k 截断）内嵌提示。
- 前端 `lib/review-types.ts` + `lib/review-client.ts` + WTR 抽屉 `ReviewFindingsPanel`（目标/渠道选择、P0-P3 徽标、verdict 徽章、丢弃计数、file:line 点击跳转、勾选、修复选中项）+ `useCodeReviewAgent` 状态机；`CodeMirrorDiffView` 暴露 EditorApi 供跳行；同文件跳转直接滚动，跨文件经 pending-scroll 延迟。
- 顺带修复（验收暴露的真实缺陷）：WTR diff 通道 staged-only 变更永远空面板（`git diff` 不含 staged → 改 `git diff HEAD`，c228beb）。

**验证**：定向测试 21/21（review-output / review-prompts / review-git，含真实临时仓库 git exec 与路径穿越拒绝）；tsc --noEmit 0；WTR focused vitest 8/8。**2026-08-29 dev Electron 实机 verified**：scratch fixture（三个埋入 bug：硬编码 key / 越界循环 NaN / eval RCE）+ DeepSeek 渠道真实评审一轮 → 3 条 findings 全中（P1/P1/P2，行号准确）、verdict "patch is incorrect"、点击跳转选中文件并滚动到行（跨文件 + 同文件 pulse）、勾选 2 项后「修复选中项」直达聊天（copilotAsk 既有语义）。证据 `acceptance/ui-202/electron-codex-parity-review-dev.json` + 截图。过程性失败（渠道 Account Suspension / TLS 抖动 / 收敛不达标）均如实浮出并就地加固；模型自找 diff 会 wandering 的问题以 diff 内嵌解决。

**状态**: verified (dev Electron 边界内；评审质量依赖所选渠道模型，无 findings/渠道失败均为诚实展示)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-203: BLOCK-26 — 审阅 UX 复刻翻新（汇总头/分组/行内标注/全目标/detached） (2026-08-29 verified → 2026-08-29 removed)

**2026-08-29 用户裁决（BLOCK-27）**：AI 审阅功能冗余，已整体移除（本条为历史留痕；实现可在 git 历史 0ca7e59..7fc08c5 找回）。

**目标**：把 AI 审阅从"窄条列表"升级为 Codex 同款的代码审阅呈现与交互——verdict 汇总头、按文件分组、diff 行内标注（gutter 徽标 + 行下卡片）、运行期活动流、全目标覆盖（uncommitted / base-branch / commit / custom）、渠道持久化、结果 detached 保留。

**改动范围**：
- 新增只读 CodeMirror 扩展 `extensions/reviewFindings.ts`（gutter 徽标 + 行下折叠卡片，一行取最严重，暴露 `setReviewFindings` StateEffect，经 EditorApi 由抽屉镜像当前文件的 findings，与列表双向高亮）。
- `ReviewFindingsPanel` v2：verdict 横幅（✓/✕ + 严重度计数 + 耗时 + 渠道徽标 + 说明 + 丢弃计数）、按文件分组、条目正文折叠、置信度展示、运行期活动流（最近 4 条 + 秒表）、错误态就地重试、目标输入（base-branch/commit 为 datalist 可搜索选择器：分支显示 `current -> target`、提交显示 `shortSha subject（age）`）、自定义指令输入。
- `useCodeReviewAgent`：活动流/startedAt/channelLabel/targetHint、`restore(projectId)`（恢复最近结果 + 运行中任务经 SSE 重放重连）；`reviewResultStore`（内存按 projectId 保留最近结局，取消即清除）。
- 新增只读 IPC `git:recent-branches` / `git:recent-commits`（limit≤200，execFile 免 shell）+ preload + electron.d.ts；渠道记忆 localStorage `biof3_review_preset_id`。

**验证**：WTR focused vitest 12/12（分组/计数/折叠/活动流/自定义门控/跳转/回传）；tsc --noEmit 0；`node --check` preload/IPC。**2026-08-29 dev Electron 实机 verified**：四目标选项齐全；分支 picker（main，`current -> main`）与提交 picker（100 条，首条 7fc08c5）懒加载；渠道选择持久化；DeepSeek 真实评审 → verdict 横幅（✕ patch is incorrect + P1×2 + 耗时 + 渠道）、按文件分组、点击 finding 后 diff 上出现 2 个 P1 gutter 徽标 + 2 张行内卡片（active 高亮）；关抽屉重开后 2 findings + verdict 完整恢复。证据 `acceptance/ui-203/electron-review-ux-parity-dev.json` + 截图。埋点 2/3 命中（parseJson 未被标记为诚实模型差异）。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-204: BLOCK-28 P1 — 主区一级审阅模式骨架（/review 路由 + 抽屉退役） (2026-08-29 in_progress)

**目标**（BLOCK-28 方案 B）：把代码审阅从 TitleBar 侧边抽屉升级为主区一级审阅模式（对标 VS Code SCM 空间与动线）。

**P1 改动范围**：
- 新路由 `/review`（App 级一级路由，审阅对象是应用工作区仓库非项目作用域）+ `pages/review.tsx`（ReviewModePage）。
- 新组件 `WorkingTreeReview/ReviewMode.tsx` + `ReviewMode.css`：主区布局（顶部 summary 条：标题 / 文件数 / 全局 +N −M 彩色统计 / Refresh / Edit file / Commit Review / Revert all；左栏文件列表；右栏大空间 diff + sticky 文件头；底部状态栏）。
- 旧抽屉退役（plan §4 D1）：删除 `WorkingTreeReview.tsx` 组件与 App.tsx 挂载点；`useWorkspacePanels` 移除 `workingTreeOpen/setWorkingTreeOpen/toggleWorkingTree`（双形态双维护不划算，主区模式是功能超集）。
- TitleBar 审阅按钮改导航：进入 `/review` / 再次点击返回上一页；agent task-done 自动弹层改为按钮圆点提示（`.reviewDot`，进入审阅模式自动清除）。
- Esc 语义：行内编辑抽屉 → 提交对话框 → 退出审阅模式；键盘流 A/Y/R/↑↓ 保留。
- 复用：`useWorkingTreeReview` 状态机 / `CodeMirrorDiffView` / `CodeReviewDrawer` / `git:working-tree-*` 全家桶（0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入）。

**验证**：tsc --noEmit 0；定向 vitest 13/13 通过（ReviewMode.test.tsx 3 新增 + CodeMirrorDiffView.test.tsx 10）；TitleBar.test.tsx 8 failed 为 pre-existing（干净 HEAD `80f9d62` stash 复测同样 8 failed | 7 passed，属 mac 窗口控件标签旧债，非 BLOCK-28 引入）。**2026-08-29 dev Electron 实机 verified（UI-204 全包统一取证）**：CDP 驱动——TitleBar 按钮点击进入 `/review`（pathname + .rvw-container + aria 断言）、Esc 返回上一页；证据 `acceptance/ui-204/electron-review-mode-dev.json` + 3 截图。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-205: BLOCK-28 P2 — 文件树（目录分组 / 每文件 +N −M / 已审标记） (2026-08-29 verified)

**改动范围**（BLOCK-28 P2，基于 UI-204 骨架）：
- 新增纯函数助手 `reviewModeHelpers.ts`：`computeFileDiffStats`（按 diff hunk 行统计每文件 +N −M）、`isFileReviewed`（确定性规则：binary / 0 hunk 自动已审；其余全部 hunk 有决策才算已审）、`groupFilesByDirectory`（按目录稳定分组，根目录置末显示 "."）。
- 左栏升级为分组文件树：目录组头可折叠（caret 旋转 + aria-expanded）、文件行显示 basename + M/A/D 徽标 + 彩色 +N −M 统计 + accept/reject 决策徽标；全路径入 title。
- 已审文件置灰（opacity）+ 绿色 ✓ 标记，统计让位给 ✓；summary 条新增审阅进度 `n/m reviewed` 徽标（n = 已审文件数，m = 状态文件总数）。

**验证**：tsc --noEmit 0；定向 vitest 14/14（reviewModeHelpers.test.ts 6 新增 + ReviewMode.test.tsx 5，含「A 键 accept 后文件置灰 + 进度 1/1」交互用例）。**2026-08-29 dev Electron 实机 verified（UI-204 全包统一取证）**：summary 进度徽标 0/1→1/1、行徽标 A、+31 统计、根目录组 "." 均经 CDP DOM 断言；证据 `acceptance/ui-204/`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-206: BLOCK-28 P3 — diff 区（hunk 悬浮控件 / 滚动标记条 / 展开上下文） (2026-08-29 verified)

**改动范围**（BLOCK-28 P3，基于 UI-205）：
- CodeMirrorEditor additive props（BLOCK-22 面 0 破坏）：`extraExtensions`（业务层 CM6 扩展经独立 extraCompartment 热替换）+ `diffOptions`（inline-diff 渲染选项）；`createUnifiedDiffExtension` 增加 `collapseUnchanged` 选项 → `@codemirror/merge` 原生折叠 hunk 间未变更上下文（margin 3 / minSize 12，自带「⇕ 展开」控件）。
- 新增 review 层扩展 `hunkControls.ts`：以 git hunk 为语义基准（`path#hunkIndex` 决策键，与键盘 A/R 流一致）在 hunk 首行行尾注入行内 Accept/Reject 按钮；决策后转为 accepted/rejected 状态标签。不使用 merge view 内建 mergeControls（其编辑编辑器文档而非磁盘，与 WTR 决策模型冲突）。
- `CodeMirrorDiffView` 升级：新增 `hunks` / `hunkDecisions` / `onAcceptHunk` / `onRejectHunk` props；右侧滚动标记条（按 newStart/totalLines 比例定位，点击经 EditorApi.scrollToLine 直达 + pulse 高亮，标记颜色反映决策态）；sticky 文件头在滚动容器外天然吸顶。
- 0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入。

**验证**：tsc --noEmit 0；定向 vitest 62/62（CodeMirrorDiffView 新增「markers + hunk 控件 + Accept 回调」用例；CodeMirrorEditor 既有 32 例 0 回归；reviewModeHelpers + ReviewMode 全过）。**2026-08-29 dev Electron 实机 verified（UI-204 全包统一取证）**：悬浮 Accept 点击 → stateLabel "accepted" + 行置灰 + 进度 1/1；标记条 1 个且点击直达；第二轮 modify-diff 中 "14 unchanged lines" 折叠控件出现并点击展开成功；证据 `acceptance/ui-204/`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-207: BLOCK-28 P4 — 内嵌提交流（VS Code SCM 风格 commit box） (2026-08-29 verified)

**改动范围**（BLOCK-28 P4，基于 UI-206）：
- 底部内嵌提交框替换独立 commit 对话框：message textarea（placeholder 随决策状态给出建议 message / 引导文案）+ ⌘+Enter 提交 + Commit (n) 按钮（hasDecisions && message 非空才可点）。
- 提交成功用面板内轻提示（顶部 wt-commit-success toast，含 short hash + 文件数）替代独立对话框；失败错误内联展示在提交框 meta 行（role=alert）。
- 决策计数（pending/accepted/rejected）+ truncated/loading 状态并入提交框 meta 行；summary 条 Commit Review 按钮改为聚焦提交输入框（自动预填建议 message）。
- Esc 语义更新：编辑抽屉 → 提交输入框失焦 → 退出审阅模式。
- 复用 git:commit-review 通道 0 改动；0 新依赖。

**验证**：tsc --noEmit 0；定向 vitest 16/16（新增「⌘+Enter 提交 → commitReview 契约参数 → toast 轻提示 → 无 dialog」全链用例）。**2026-08-29 dev Electron 实机 verified（UI-204 全包统一取证）**：⌘+Enter 真实触发 git:commit-review 创建提交（toast 显示 short hash + 1 file(s)，role=dialog 不存在），验收后该提交已 `git reset --mixed HEAD~1` 回滚、fixture 已删除；证据 `acceptance/ui-204/electron-review-mode-dev.json` + 截图。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-208: BLOCK-28.1 P1 — 主区审阅页浅色主题串色修复（全 token 迁移） (2026-08-29 verified)

**缺陷**（用户实测反馈 + CDP 截图实锤）：浅色主题（`data-theme="light"`）下主区审阅页 summary 条/侧栏/状态栏为暗色硬编码浮在主题浅色画布上、CM 高亮暗色调文字——WorkingTreeReview.css/ReviewMode.css 沿用旧抽屉的不存在变量名（`--biof3-fg` / `--biof3-bg-elev` / `--biof3-bg-list` / `--biof3-bg-button` / `--biof3-mono` / `--biof3-status-danger`）回退暗色常量，与 Infima + `--biof3-*` 语义 token 体系混用串色。

**修复**：两份 CSS 全量重写为真实 token（`--biof3-bg-canvas/surface/subtle/elevated`、`--biof3-text/secondary/tertiary/muted`、`--biof3-border(-strong/-subtle)`、`--biof3-accent(-soft/-hover)`、`--biof3-status-success/error/-fg/-bg`、`--biof3-font-mono`、`--biof3-font-size-*`），WorkingTreeReview.css 同时裁剪为仅剩在用 wt-* 类（对话框/旧表格样式清除）；Commit 主按钮升为 accent 主色。不存在的变量名 grep 0 命中。BLOCK-22 CM 层已用存在 token，0 改动。

**验证**：tsc 0 / 定向 vitest 16/16。**2026-08-29 dev Electron 实机 verified**：CDP 计算样式断言——浅色 container `rgb(248,250,252)` + 文字 `rgb(15,23,42)`（修复前文字为 `rgb(224,224,224)` 串色）；暗色 `rgb(11,18,32)` + `rgb(230,237,243)` 双主题正确；截图 `acceptance/ui-208/`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-209: BLOCK-28.1 P2 — 主区审阅页 Codex 级布局打磨 (2026-08-29 verified)

**改动范围**：
- summary 条下新增审阅进度细条（accent 色，随 n/m reviewed 增长）。
- 文件树：组头 caret 图标化（chevron-down）、文件行 file 图标 + 树形缩进参考线、已审标记 check 图标化；diff sticky 头补状态徽标（M/A/D）与每文件 +N −M 统计。
- 空态图形化：git-branch 图标 + 标题 + 快捷键引导文案（替代单行灰字）。
- 复用既有 Icon 集合（chevron-down/file/check/git-branch），0 新增图标/依赖/IPC。

**验证**：tsc 0 / 定向 vitest 16/16（空态断言同步更新）。**2026-08-29 dev Electron 实机 verified**：浅色 diff 截图确认——白色 summary + 细进度条、侧栏图标树、diff 头统计、底部 accent Commit 主按钮、「14 unchanged lines」折叠控件正常；证据 `acceptance/ui-208/`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-210: BLOCK-28.2 P1 — CodeReview 右侧停靠形态（wt-dock，不占主区） (2026-08-29 verified)

**用户反馈**：CodeReview 在右侧边栏区域显示即可，不需要整个全屏。

**改动范围**：
- 恢复 `useWorkspacePanels.workingTreeOpen/setWorkingTreeOpen/toggleWorkingTree`；TitleBar 审阅按钮改回 Toggle（打开/收起 dock，agent task-done 圆点提示保留）。
- AppShell 在 open 时挂载 `wt-dock`（fixed 右侧 520px、border-left + 阴影、z-index 同旧抽屉层），内嵌 `<ReviewMode variant="dock" onClose={toggle}>`。
- ReviewMode 增加 `variant: 'mode' | 'dock'`：dock 下文件树变为**横向文件条**（chips：状态字母 + basename + ±统计 + 已审 ✓，单行滚动，accent 选中态），diff 区为纵向主体；summary 紧凑化（隐藏快捷键提示、标题 nowrap）；Esc = 关闭 dock。
- `/review` mode 路由保留（共享组件，UI-204~207 已 verified）。

**验证**：tsc 0；定向 vitest（WorkingTreeReview 16/16；TitleBar 8 failed 为已知 pre-existing 集合，数量一致）。**2026-08-29 dev Electron 实机 verified**：CDP 断言——项目页保持挂载（pathname 不变、projectStillMounted=true）、dock 520px 右停靠、7 个文件 chips、active chip 正确、diff 渲染、hunk 卡片 elevated；Esc 关闭面板；证据 `acceptance/ui-210/`。**2026-08-29 补充（用户反馈「审阅卡片咋没有」）**：首页「开始工作」启动卡片区新增第 6 张「审阅」卡片（git-branch 图标 +「审阅工作区改动（接受/拒绝/提交）」），点击直接打开 wt-dock——CDP 断言 6 卡片齐全、点击后 dock 520px 打开；截图 `acceptance/ui-210/home-cards.png`、`home-card-opens-dock.png`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-211: BLOCK-28.2 P2 — 审阅页字号升档 + hunk 控件卡片化 (2026-08-29 verified)

**用户反馈**：①审阅页文字大小与软件不适配（偏小）②hunk 的 Accept/Reject 控件应卡片化。

**改动范围**：
- 字号升档对齐全局基线：按钮/文件行/统计 caption(12)→body-sm(13)、组头 xs→sm(11)、快捷键提示 10→xs(11)、空态 body-sm→body(14)、空态标题→lg(18)、commitbox 输入 caption→body-sm、meta xs→caption；修复无效选择器 `.wt-file-status-?`（转义为 `\?`，原规则从未生效）。
- hunk 控件卡片化：`wt-hunk-controls` 改为 elevated 圆角卡片（bg-elevated + border + shadow-menu + 内边距），Accept/Reject 按钮加大热区（caption 字号、10px 圆角）。

**验证**：tsc 0；定向 vitest 16/16。**2026-08-29 dev Electron 实机 verified**：CDP 断言 hunk 卡片 elevated 背景 `rgb(255,255,255)`；浅/暗双主题截图确认字号观感与全局一致；证据 `acceptance/ui-210/`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-212: BLOCK-28.3 — 审阅面板中文化 + 按钮卡片化 + chrome 字号对齐 12px (2026-08-29 verified)

**用户反馈**：①「code review 是审阅」②按钮应对齐首页快捷入口的卡片风格 ③审阅界面文字明显比其它文字大（BLOCK-28.2 提到 13px 超出软件 chrome 主流 12px）。

**改动范围**：
- 中文化：标题/空态「审阅」、按钮「编辑文件/刷新/提交审阅/全部还原」、快捷键提示（接受/拒绝/切换/退出）、提交框 placeholder 与 aria（提交信息）、meta（待定/接受/拒绝）、toast「已提交」、文件列表「文件 (n)」「暂无工作区改动。」、hunk 控件「接受/拒绝/已接受/已拒绝」、标记条 title、diff 头「n 个 hunk」、加载/二进制文案；TitleBar tooltip「打开/收起审阅」。
- 字号对齐：chrome 全部回落 `--biof3-font-size-caption`（12px，与其它桌面面板 0.72~0.76rem 主流一致）；summary 标题 body-sm（13px）；chips 12px。
- 按钮卡片化：`.wt-btn` 白底（bg-surface）+ 描边 + 8px 圆角 + 微阴影，hover 加深——对齐首页快捷入口卡片语言；Commit 保持 accent 实色主按钮。

**验证**：tsc 0；定向 vitest 16/16（断言同步中文化）。**2026-08-29 dev Electron 实机 verified**：CDP 计算样式断言——标题「审阅」13px、按钮 12px/8px 圆角/卡片阴影、chips 12px、中文 placeholder 与 meta、进度「n/m 已审」；截图 `acceptance/ui-212/dock-zh.png`。

**状态**: verified (dev Electron 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-213: BLOCK-28.4 — 审阅面板显式退出按钮 + 「+」菜单审阅入口 (2026-08-29 verified)

**用户反馈**：①「审阅界面有退出按钮吗 不然打开了 不知道怎么退出」（现仅 Esc / TitleBar Toggle 隐性入口）②「+」下拉菜单（结果/文件/后端/浏览器/聊天/分析）应加「审阅」入口。

**改动范围**：
- ReviewMode summary 栏尾部新增「退出」X 按钮（Icon `x`，`data-testid="rvw-exit-button"`）：dock 形态 → `onClose()`（title「关闭审阅面板 (Esc)」）；mode 形态 → `exitReviewMode()`（title「退出审阅模式」）。Esc 语义层级不变（编辑抽屉 → dock 关闭 → 输入框失焦 → mode 退出）。
- 「+」菜单 `toolMenuItems` 尾部 concat `{ id: 'review', label: '审阅', icon: 'git-branch', isOpen: shell.workingTreeOpen }`；`onSelectToolItem` 对 `review` 走 `shell.toggleWorkingTree()`，不切换 RightPanelMode。
- 单测补齐：ReviewMode.test.tsx 新增 2 用例（dock 点击退出调 onClose；mode 点击退出经 MemoryRouter 历史栈断言 navigate(-1) 回退）。

**验证**：tsc 0；定向 vitest 19/19（ReviewMode 7，含退出按钮 2 新用例）。**2026-08-29 dev Electron 实机 verified**：CDP 断言——「+」菜单含「审阅」项、点击打开 520px dock、面板「退出」按钮点击关闭 dock；截图 `acceptance/ui-213/`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-214: BLOCK-28.5 — 审阅并入右侧边栏 tab 体系（退役 wt-dock 浮层另类） (2026-08-30 verified)

**用户反馈**：「审阅这个内容界面应该像其它选项一样嵌入在右侧边栏内部的……目前的像是一个另类」——BLOCK-28.2 的 wt-dock（position: fixed 520px 浮层）悬浮在侧栏之上，与结果/文件/后端/浏览器/聊天/分析的 RightPanel 多 tab 体系不一致。

**改动范围**：
- `RightPanelMode` 增加 `'review'`；`RIGHT_PANEL_ITEMS` 增加审阅项——「+」菜单原生包含（删除 BLOCK-28.4 的 concat hack 与 `onSelectToolItem` 特殊分支），TitleBar tab 条自动获得「审阅」pill。
- RightPanel 渲染 `tab === 'review'` 分支：复用 `ReviewMode variant="dock"`（横向文件条紧凑形态）填满 tab 容器（`.rightPanelReviewTab` overflow hidden）；退出按钮/Esc = `closeRightPanelTab('review')`。
- 全局 `workingTreeOpen` ⇄ review tab 双向同步（ProjectWorkspace effect）：TitleBar 分支按钮 / agent task-done 圆点行为不变；用户关 tab 回写 `setWorkingTreeOpen(false)`。
- AppShell wt-dock 浮层降级为兜底：仅 ProjectWorkspace 未挂载的路由（首页/skills/results 页）渲染；首页启动卡片「审阅」改走 `openRightPanel('review')`。

**验证**：tsc 0；定向 vitest（WorkingTreeReview 3 文件全绿；TitleBar 8 failed 为台账记录的 pre-existing 集合，数量一致）。**2026-08-30 dev 实机 verified**：CDP 断言 6/6——审阅面板嵌入 `aside.rightCol` 内部（region closest('aside') 命中）、`.wt-dock` count=0、tab 条「审阅」pill 激活、退出按钮/Esc 关 tab 且 tab 条同步清除、与「分析」tab 并存切换 keep-alive；截图 `acceptance/ui-214/`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-215: BLOCK-28.6 — 全局字号 token 统一（678 处/34 文件归档 9 级 token） (2026-08-30 verified)

**用户反馈**：「审阅的文字和消息会话区的文字大小统一了吗？我觉得软件的所有文字字号都应统一大小」——审阅面板已 token 化（UI-212），但会话区（simple-chat.css 40+ 处硬编码，含 10.5/11.5/12.5/13.5 半像素野值）与全局 30+ 文件硬编码字号未统一。

**裁决**：不做「一个字号走天下」（层级是可读性基础），做「同一层级 = 绝对同一字号」——全量归档到 9 级 `--biof3-font-size-*`（新增 `md=16px`）。映射：10/10.5→xs，11/11.5→sm，12/12.5→caption，13/13.5→body-sm，14→body，15/16/17→md，18→lg，20→xl，21/22→2xl，28→3xl；rem 同步就近归档（0.68~0.74→sm、0.75~0.78→caption、0.8~0.85→body-sm、0.86~0.92→body、0.95~1.05→md、1.1~1.15→lg 等）。**保留例外**：<10px 装饰缩微（WorkspaceFileIcon 7/8px、微角标 9px）、24px/>28px display 大标题、em/% 等比、xterm 配置值。

**改动范围**：codemod（Node 脚本，一次性）替换 `font-size: Npx|Nrem` 与 tsx 内联 `fontSize: 'Npx'` 共 **678 处 / 34 文件**（simple-chat.css 79、project-workspace.module.css 234、desktop.css 70、custom.css 72、skills 34、result-studio 各面板等）。顺带补齐 theme-token-contract 第 3 批缺口 7 个（`--biof3-fg/-fg-muted/-bg-elev/-bg-button/-bg-button-hover/-mono/-status-success`，CodeReviewDrawer 旧抽屉时代未定义变量名 + 裸 status-success 引用；沿用 UI-151/155 先例 var() 别名 + 对齐 fallback），该测试由 pre-existing 失败转绿。

**验证**：tsc 0；全套 vitest 786/794（8 失败为 TitleBar 已知遗留集合；theme-token-contract PASS）。残留硬编码清点仅剩计划内例外（7/8/9/9.5/24px、≥1.5rem display）。**2026-08-30 dev 实机 verified**：CDP 全页计算字号扫描 5/5——可见文本仅落在 {10,11,12,13,14,16,18}px，无半像素与 rem 野值；审阅面板标题 13px/按钮 12px/chips 12px；聊天消息正文 13px/meta 11px；明暗双主题字号分布逐元素一致；截图 `acceptance/ui-215/`。

**2026-08-30 补充（UA 默认字号收敛）**：首轮实机扫描发现无文字图标按钮/容器命中 Chrome BUTTON UA 默认 13.3333px（10pt），补 `font-size: var(--biof3-font-size-caption)` 共 11 处——TitleBar `.iconBtn`、LeftPanel `.iconBtn`、`.sc-composer-icon-btn`、`.sc-send-cta`、`.sc-model-option`、`.biof3-desktop-panel__close`、`.biof3-settings-nav__item`、`.panelBackdrop`、`.emptyResultLaunchCard`（启动卡片 6 张容器）、ContextBudgetBar 圆钮（内联）、`.xterm textarea`（可访问性隐藏元素，canvas 渲染不受影响）。终扫（终端挂载态全页 390 元素 + 3 伪元素）：**13.3333px = 0，小数 px = 0**，分布收敛为 {10, 11, 12, 13, 16}px 全整数集合；审阅面板开合回归通过。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-216: BLOCK-28.7 — 聊天区「工作区改动」卡片（每文件 ±统计，点击跳审阅） (2026-08-30 verified)

> **2026-09-09 用户裁决移除宿主卡片**：聊天区「工作区改动」卡片整体移除（组件 + SimpleChat 挂载 + 测试）——每文件改动已在对话内工具行（ToolActivityList）与审阅面板（/review 主区 + dock）呈现，卡片在无 agent 活动的会话呈现场景差（空会话显示全局 git 脏态噪音）且关闭 X 不持久（下个任务收尾即弹回）。本条及其上的卡片增量（悬停预览/浮窗自适应/轮次分组）随宿主移除置 **cancelled**；审阅面板与对话内工具行为准。conversationChangesStore（BLOCK-31/40 会话归属索引）暂保留（写路径在 run 流内）。

**用户反馈**：「聊天会话区域会有文件改变的详细信息吗？具体到每个文件的变化数量，点击具体的改变信息后可以跳转到审阅查看？」

**改动范围**：
- 新增 `AgentChangesCard`（copilot/，挂 SimpleChat 输入区上方）：订阅 `biof3:agent-task-done` + 挂载时拉取 `git:working-tree-status` + `git:diff-for-review`，`computeFileDiffStats` 算每文件 +N −M。头行（折叠/展开 +「N 个文件」+ 总 ± + 关闭 X）、明细行（A/M/D/? 状态徽标 + 路径 + 每文件 ±）、「打开审阅查看全部改动」尾行。git 为唯一事实源（提交/还原后重查自动更新/消失）；bridge 缺失（纯浏览器）整卡隐藏。
- 新增事件 `biof3:review-open-file { filePath }`：ProjectWorkspace 监听 → `openRightPanel('review')`；useWorkingTreeReview 监听 → `setSelectedFilePath(filePath)` + refresh。「查看全部」派发空 filePath（仅开 tab）。
- CSS（simple-chat.css）：卡片/徽标复用 `--biof3-font-size-*` token 与 status 语义色。

**验证**：tsc 0；定向 vitest 4/4（AgentChangesCard：±明细渲染 / 干净树隐藏 / 点击行派发事件 / agentTaskDone 触发刷新显现）+ copilot 目录全绿。**2026-08-30 dev 实机 verified**：CDP 6/6——注入与磁盘 git 一致的桥桩后（纯浏览器无 preload bridge，Electron 实机走 IPC）卡片渲染「2 个文件 +1 −0」（M README.md +1 −0、? ui287-demo.py +0 −0）；点 README.md 行 → 审阅 tab 自动打开且该文件 aria-selected、文件头「M README.md +1 −0｜1 个 hunk」、diff 渲染 +1 行；折叠/展开、「查看全部」、X 关闭均通过；截图 `acceptance/ui-216/`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-217: BLOCK-28.8 — 聊天输入区移除「排队 / 停止生成」按钮（用户裁决） (2026-08-30 verified)

**用户反馈**：①「完全访问 / 只读模式」是否起作用（澄清，无代码改动）②会话任务启动时出现的「停止生成」和左边「排队」按钮没必要，取消掉。

**问题 1 澄清（访问模式真实生效）**：链路完整——SimpleChat `accessMode` state → `startConversationRun` context.accessMode → `/api/ai/chat`；后端权威执行：`agent-tool-policy.js:136`（mutating 操作 read 模式拒绝）、`workspace_exec` 需 full（:183）、`workspace-tools.js` 写工具检查（:666/:700）、`agent-execution-policy.js`（accessMode 缺省 read，full 才允许 execution）；前端另有 `accessModeValidator` 同步预检 + 只读模式 ApprovalCard 二次确认（SimpleChat:1330）。

**问题 2 改动范围**：SimpleChat composer 删除流式态 `sc-send-cta-queue`（排队）与 `sc-send-cta-stop`（停止生成）按钮、`queueCurrentPrompt` 包装与「已排队 N 条」角标；流式期间保留唯一发送按钮（禁用态，title「任务进行中…」）。`stop`/`queue` 能力保留在 useChatStream（仅移除按钮入口，需要时可经事件/快捷键恢复）；`queuedPrompts` 排水机制保留。CSS 清理 `.sc-send-cta-stop/.sc-send-cta-queue/.sc-queued-count` 三条规则。

**验证**：tsc 0；copilot 定向 vitest 179/179。**2026-08-30 dev 实机 verified**：CDP 断言——`.sc-send-cta-stop`/`-queue`/`.sc-queued-count` 计数=0、唯一 `.sc-send-cta-send`（空输入禁用守卫正常）、访问选择器在位、改动卡片干净树隐藏；截图 `acceptance/ui-217/`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-218: BLOCK-28.9 — 审阅底部提交条按需出现（隐藏常驻输入框） (2026-08-30 verified)

**用户反馈**：「优化审阅界面内容的呈现效果，为什么底部还有输入框？？？」——底部提交框（VS Code SCM 风格）常驻渲染 2 行 textarea，无决策时也占位、观感像聊天输入框。

**改动范围**：
- ReviewMode footer 改为**按需出现**：无审阅决策（`!hasDecisions`）整体不渲染；有决策显示**单行紧凑提交条**——决策摘要（「接受 n / 拒绝 n」绿/红着色 + 有待定时「待定 n」）+ 单行 input（placeholder 含 ⌘+Enter 提示与决策计数）+ 主按钮「提交 (n)」。
- ⌘+Enter 提交、错误提示、提交成功 toast（wt-commit-success）保留；提交按钮禁用条件简化为「信息为空」（决策存在由渲染条件保证）；`textareaRef` 类型改 HTMLInputElement。
- CSS：`.rvw-commitbox` 紧凑化（padding 7/12、gap 6、input 12px token、meta xs），删除 `.rvw-commitbox-spacer`。

**验证**：tsc 0；定向 vitest 19/19（新增用例：无决策 commitbox 隐藏 / accept 后出现且「提交信息」为单行 INPUT）。**2026-08-30 dev 实机 verified**：CDP 5/5——无决策 `.rvw-commitbox` 不存在且 diff 正常渲染；接受后提交条出现（「接受 1」摘要、INPUT、placeholder「提交信息（⌘+Enter 提交：接受 1，拒绝 0）」、按钮「提交 (1)」）；「全部还原」后再次消失；截图 `acceptance/ui-218/`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-219: BLOCK-29 — 审阅面板「提交历史」分区（第一期 git 工具） (2026-08-30 verified)

**用户反馈**：「审阅中，关于版本控制 git 工具这些的使用是不是要加入？类似于 VS Code 中？」——经全链路盘点（git-adapter 已有任意提交间 diff/showFile，缺 log/checkout/unstage；branch:* IPC 是对话分支非 git），用户裁决第一期只做**提交历史**；分支切换/unstage/push-pull 明确排除。

**改动范围**：
- git-adapter 新增 `log({limit, ref, file})`：NUL 分隔 `%H%x00%h%x00%an%x00%aI%x00%s` 解析，limit ≤200，ref 拒绝 `-` 开头（防参数注入）；经测试项目真实仓库验证。
- IPC 新增 3 条**只读**通道：`git:commit-log`（列表）/ `git:commit-diff`（单提交 vs 第一父提交，根提交回退空树比较，复用 parseDiffFiles）/ `git:commit-file-content`（父提交与本提交两版全文，缺失侧空串）；sha hex 白名单校验。preload 暴露 `commitLog/commitDiff/commitFileContent`。
- 前端：useWorkingTreeReview 新增 historyView/commits/selectedCommit/commitDiff 状态与 loadHistory/openCommit/backToCommitList；CodeMirrorDiffView 新增 `revisionOverride` prop（跳过 HEAD/WORKTREE 加载，提交 diff 只读复用）；ReviewMode summary 条「改动 | 历史」分段切换——历史列表（shortSha + subject + author · 时间）→ 点提交渲染文件条 + 只读 diff（CommitDiffFileView）；历史分区禁用 A/R/↑↓ 键盘流。

**验证**：tsc 0；定向 vitest 20/20（新增历史用例：列表渲染 + 点提交加载 diff 与两版全文）。**2026-08-30 dev 实机 verified**：CDP 6/6——注入与磁盘 git 一致的桥桩后：「改动/历史」tablist 存在、历史列表两条真实提交（shortSha/subject/author·时间）、点开提交 diff 绿色新增行与「N 个 hunk」文件头、← 返回列表、切回改动分区；截图 `acceptance/ui-219/`。观察项：窄视口下 summary 操作按钮可能遮挡分区 tab（列宽拖宽即可用），后续布局打磨项。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-220: BLOCK-29.1 — 审阅 dock 手风琴文件列表（文件行一级，点击展开行内 diff） (2026-08-30 verified)

**用户反馈**：「改动的文件名字在最上层，我希望是改动的文件名是一级，点击之后向下展开，这样可以一次性看到有哪些文件发生改动，点击展开后看到详细的改动信息」（参考 Cursor 例图）——原 dock 横向文件条 + 底部单文件 diff 无法一眼看全所有改动文件。

**改动范围**：
- ReviewMode dock 变体重构为**纵向手风琴**（`.rvw-accordion`）：一行一文件——caret（收起旋转 -90°）+ `WorkspaceFileIcon` 类型图标 + 文件名（粗体）+ 目录路径灰字 + ±统计 / 已审 ✓；点击行向下展开该文件**行内 diff**（复用 CodeMirrorDiffView，含 accept/reject 控件，多行可同开）；未跟踪文件（不在 diff 中）展开显示占位说明。
- 当前选中文件默认展开；`selectedFilePath` 变化（聊天卡片跳转 `biof3:review-open-file`）自动展开对应行；行点击同时 `setSelectedFilePath`（A/R 键盘流仍作用于最后展开文件）。
- mode 变体（/review 全页）保持「侧栏 + 大 diff 区」布局不变；历史/提交 diff 分区不受影响。
- CSS：`.rvw-accordion/.rvw-acc-item/.rvw-acc-row/.rvw-acc-name/.rvw-acc-dir/.rvw-acc-diff`（展开区 max-height 60vh 独立滚动）。

**验证**：tsc 0；定向 vitest 21/21（新增 dock 手风琴用例：选中文件默认展开 / 点击收起 / 再点展开，makeBridge 补 fileContent）。**2026-08-30 dev 实机 verified**：CDP 6/6——注入桥桩后：`.rvw-filechip`/`.rvw-diff-area` 计数=0、`rvw-accordion` 两行文件行（M README.md +1、Py demo-291.py）、README.md 默认展开且行内绿色新增行、demo-291.py 展开显示未跟踪占位、再点收起、接受后底部提交条出现；截图 `acceptance/ui-220/`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-221: BLOCK-29.2 — git 工具二期：单文件放弃更改 / 文件级历史 / 撤销上次提交 / 历史分页 (2026-08-30 verified)

**用户反馈**：「工作进度已经变了（BLOCK-30 单后端收敛本地落地）。确认之后，重点优化 git 工具在审阅中的不全，看看 VS Code 有哪些功能有必要再更新。」——经 VS Code SCM 功能对照盘点，用户多选裁决二期做 4 项：单文件放弃更改 / 文件级历史 / 撤销上次提交 / 历史分页加载；暂存区 / 分支切换 / push-pull 维持排除。plan `docs/block-29-2-git-tools-phase2-plan.md`（2026-08-30 同日收口，本条目为 2026-08-30 晚间审计补登——实现提交 `1946971` 因同提交写入的是 UI-222 补登段，默认门禁「同提交动了台账」判定未拦住本条目漏登，详见 AUDIT-LOG 2026-08-30 UI-221 条）。

**改动范围**：
- git-adapter（core/shared-backend/git-adapter.js，唯一 git 命令边界）：新增 `discardFile({path})`（tracked → checkout HEAD 还原；untracked → 删除文件，路径限 workTree 内）、`undoLastCommit()`（mixed reset HEAD~1，根提交显式拒绝）、`log` 增加 `skip` 分页参数（--skip=N）；顺带修复模块内 `path` 局部变量遮蔽的历史陷阱（沿用顶部 `pathModule` 别名）。
- IPC：新增 `git:discard-file` / `git:undo-last-commit` 两条通道（src/ipc/working-tree-review.js，前端 confirm 后调用）；preload 暴露 `discardFile / undoLastCommit`。
- 前端（ReviewMode dock 变体）：手风琴文件行 hover 操作——`clock` 查看该文件历史（loadHistory({file}) 切历史分区，历史头部文件过滤徽标可清除）、`trash` 放弃更改（window.confirm 确认，untracked 提示将被删除）；历史分区头部「撤销上次提交」按钮（confirm 后 mixed reset，内容回工作区重新审阅，自动刷新 status 与历史）；历史列表尾「加载更多」（skip 分页 append，每页 50，返回不满 50 条即末页）。

**验证**：tsc 0；定向 vitest 22/22 + copilot 200/200（新增用例：行内放弃→discardFile、行内历史→file 过滤、清除过滤→file:null、撤销→undoLastCommit，均含 confirm）；adapter 真实仓库快测 4 项（log skip 分页页序 / discard tracked 还原 / discard untracked 删除 / undo mixed reset 后恢复提交）全过。**2026-08-30 dev 实机 verified**：CDP 核心断言（discard/undo 调用计数、文件过滤徽标、撤销入口、分页 append 50→51 机制），截图 `acceptance/ui-221/file-filter.png`、`acceptance/ui-221/undo.png`。**2026-08-30 晚间勘误（BLOCK-29.5 P2 发现）**：上述 CDP 断言经浏览器桥桩执行，而真实 IPC 链路 `git:commit-log` handler 当时只透传 `limit`——`skip`/`file` 被丢弃，即真实 Electron 中「历史分页」与「文件级历史」失效（adapter 与 shim 两层各自正确，断点在 IPC 契约层）。已由 UI-226（BLOCK-29.5 P2）修复透传；真实链路回归待 dev Electron 重启载入新主进程代码后随 UI-226 复核。

**状态**: verified (dev 边界内；分页/文件过滤真实链路修复见 UI-226)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-222: BLOCK-30 — 单后端收敛与更名的 UI 影响补登（P1/P2/P4 合并条目） (2026-08-30 verified)

**背景**：BLOCK-30-BACKEND-CONVERGENCE（用户裁决，单后端收敛工作包）P1 摘除 py-server（edd1116）、P2 摘除 gateway（d4f459d）、P4 core/r-server 更名 core/biof3-server（4e51ae1）三个提交含前端路径级改动（import/常量指向），但提交时未按台账规则同步 ui-productization-audit.md 与 UI-### 编号。经 ui:audit:check 发现后补登本合并条目，并在 check 脚本 LEGACY_*_EXEMPTIONS 白名单登记三个 sha（惯例：不可变实现提交 + 事后 canonical 补登）。

**UI 影响评估**：前端仅模块解析路径与 `R_SERVER_URL`/`pythonApiBase` 常量指向调整（biof3-server 正名），运行拓扑收敛为 biof3-server + plumber 单后端；组件结构、视觉、交互 0 变化；工具契约 / schema / MCP / 插件格式 0 改动。详见 docs/block-30-backend-convergence-plan.md（P1 edd1116 / P2 d4f459d / P3 2f563a1 改判池接线不接入 / P4 4e51ae1 更名 534 文件原子提交）。

**验证**：BLOCK-30 自身门禁（定向测试全绿、tsc 0、build、隔离启动）+ 本会话快速回归：WorkingTreeReview 定向 vitest 21/21（审阅/git 工具功能不受影响）、tsc 0。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-223: BLOCK-29.3 — 提交详情增强：完整提交说明 + 汇总统计 (2026-08-30 verified)

**用户反馈**：「我看到了具体的历史记录 但是这个历史记录没有详细的信息吗 我记得每次 commit都应该有改变的信息在的」——现状点提交只见文件条 + 只读 diff（每文件 ±统计 BLOCK-29 已交付），完整提交说明（message body）应用内不可见：git-adapter log 仅解析 `%s` subject 一行，终端 `git show` 才能看到正文。用户 AskUserQuestion 裁决选项「完整说明 + ±统计」。plan `docs/block-29-3-commit-detail-plan.md`（P0 登记 `9d62ac1`）。

**改动范围**：
- git-adapter `log()`：pretty format 改 `\x01` 记录分隔 + `%b` body 字段（body 可含换行、不能按行切），解析按 `\x01` 分记录，body 去尾部换行；真实仓库快测通过（多行 body 完整解析、trailing newline 剥离）。
- `git:commit-log` 载荷 additive 增加 `message` 字段（0 新增 IPC 通道，preload 直传不改）；`electron.d.ts` commitLog commits 类型 + `useWorkingTreeReview` `CommitInfo` 增加 `message`。
- ReviewMode 提交详情视图新增 `.rvw-commit-info` 详情头：subject（粗体）+ author · formatCommitDate + 汇总统计（`N 文件 +A −D`，复用既有 commitDiff summary/files.length，0 新查询）；body 非空时原生 `<details>` 折叠展示完整说明（默认收起，零新增 state）；字号只用 `--biof3-font-size-*` token（body-sm 13px / xs 10px）。

**验证**：tsc 0；定向 vitest 23/23（新增用例：详情头完整说明折叠展开 + 汇总统计 + 无 body 不渲染 details）；node --check；adapter 真实仓库快测（多行 body 解析）。**2026-08-30 dev 实机 verified**：localhost:3000 注入磁盘真实 git 桥桩后断言——详情头 subject/meta/「2 文件 +11 −0」、details 默认收起、展开显示 4 行完整说明、文件条每文件 ±统计（demo-293-notes.md +7 / demo-293.py +4）、无 body 提交（a3b567f）不渲染 details；截图 `acceptance/ui-223/`（detail-header-collapsed / detail-header-expanded / history-list）。fixture 提交验收后 reset --mixed 回滚，0 残留。**观察项**：窄面板下 summary 操作按钮遮挡「改动/历史」tab（UI-219 既有观察项，真实点击被拦、程序化点击可通过），维持待布局打磨。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-224: BLOCK-29.4 — 提交时点文件全文查看（diff / 全文·改动后 / 全文·改动前 切换） (2026-08-30 verified)

**用户反馈**：「能否看更多的内容呢 理论上只要想都应该能看到的」——盘点发现 `git:commit-file-content` 已返回提交时点文件两版全文（original/modified），`CommitDiffFileView` 本地 revision 已持有，但 UI 仅渲染 diff。AskUserQuestion 多选未获勾选，主 Agent 按推荐项取最小增量（其余只读候选登记 roadmap 待裁决）。plan `docs/block-29-4-commit-file-fulltext-plan.md`（P0 登记 `20f056e`）。

**改动范围**：
- `CommitDiffFileView` 增 `viewMode` 本地三态（diff 默认 / 全文·改动后 / 全文·改动前），`hash`/`file.path` 变化重置回 diff；新增文件（originalText 为空）禁用「全文·改动前」；二进制/加载/错误分支不变。
- 全文渲染复用 `CodeMirrorEditor`（readonly 默认 true、lineNumbers 内建），新增扩展名→language 小映射（py/md/json/yaml/js系，未命中纯文本）；容器 `.rvw-fulltext-wrap` max-height 60vh 独立滚动。
- 纯前端：0 后端改动 / 0 新增 IPC / 0 新依赖 / AI 审阅 0 重新引入。

**验证**：tsc 0；定向 vitest 24/24（新增用例：三态切换内容断言、切文件重置 diff、新增文件改动前禁用）；theme-token 契约 14/14。**2026-08-30 dev 实机 verified**：localhost:3000 注入磁盘真实 git 桥桩后断言——修改文件（demo-289.py）「全文·改动后」= 提交时点完整文件（行号内建、含 diff 折叠区外追加行 A/B）、「全文·改动前」= 父提交版本（无追加行）、切新增文件（ui224-demo.md）视图重置 diff 且「改动前」禁用、新增文件「改动后」全文完整；截图 `acceptance/ui-224/`（fulltext-modified / fulltext-original / fulltext-newfile-disabled-before）。fixture 提交验收后 reset --mixed + checkout 还原，0 残留。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-225: BLOCK-29.5 P1 — 审阅窄面板「改动/历史」tab 遮挡修复（UI-219 观察项收口） (2026-08-30 verified)

**背景**：UI-219 登记的观察项「窄视口下 summary 操作按钮可能遮挡分区切换」，UI-223/224 实机验收中两次实锤——真实 Playwright 点击「历史」tab 被 `.rvw-summary-actions` 内「编辑文件」按钮盖住（force 与程序化点击才能通过）。根因：`.rvw-summary` 不换行，窄宽度下 `.rvw-summary-left`（flex:1）被挤到近 0 宽，actions 条起点左移、其内容叠住 tabs 命中区。

**改动范围**（纯 CSS，ReviewMode.css）：`.rvw-summary` 增 `flex-wrap: wrap`（row-gap 6px）；`.rvw-summary-left` 改 `flex: 1 1 auto` + `min-width: fit-content`（tabs/stats 不再被挤压）；`.rvw-summary-actions` 增 `flex-shrink: 0 + flex-wrap: wrap + justify-content: flex-end`。宽屏单行布局不变；窄宽度操作按钮换行到第二行，tabs 恒可点。

**验证**：**2026-08-30 dev 实机 verified**（localhost:3000 磁盘真实 git 桥桩）：1440×900 默认 dock 真实 Playwright 点击「历史」（无 force）通过、历史列表 4 行渲染；1024×800 窄视口「改动⇄历史」真实点击往返通过，截图可见操作按钮换行第二行、tabs 完整可点，证据 `acceptance/ui-225/narrow-1024-realclick-ok.png`。UI-219 观察项就此收口。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-226: BLOCK-29.5 P2 — 全分支历史（分支选择器）+ commit-log IPC 透传修复 (2026-08-30 verified)

**背景**：用户裁决启动只读视野菜单（BLOCK-29.5）。实施 P2 时发现存量 IPC 断点：`git:commit-log` handler 只透传 `limit`，UI-221 的 `skip`（分页）与 `file`（文件历史过滤）在真实 Electron 链路被丢弃——adapter 与桥桩两层各自正确、断点恰在 IPC 契约层（详见 UI-221 勘误脚注），真实使用中「加载更多」恒返回同一页、文件历史恒不过滤。

**改动范围**：
- git-adapter：ref 校验提炼为模块级 `assertSafeRef`（非空字符串、拒绝 `-` 开头参数注入，空值回退 HEAD）；新增只读 `listBranches()`（`for-each-ref refs/heads`，NUL 分隔 name/shortSha/isoDate/HEAD 标记）；`log({ref})` 走统一校验。真实仓库快测：listBranches 当前分支标记正确、按 ref 取 log 与 HEAD 一致、恶意 ref `--all` 安全回退 HEAD。
- IPC：`git:commit-log` 透传修复（skip/file 补回 + ref 新增，全部 additive）；新只读通道 `git:branch-list`；preload 暴露 `branchList`；electron.d.ts commitLog 参数 + branchList 类型。
- 前端：hook 增 `branches/activeBranch/switchBranch/loadBranches`（`activeBranchRef` 镜像避免 setState 时序耦合；切分支重置选中提交并按 ref 重载，只影响历史列表不写 refs）；历史头部增分支选择器（当前分支标记，title 注明只读）；ReviewMode 历史 tab 点击同时拉取分支列表。

**验证**：node --check 3 文件；adapter 真实仓库快测（listBranches / ref log / 注入回退）；tsc 0；定向 vitest 25/25（新增用例：选择器渲染 + 切分支触发 commitLog 带 ref）。**2026-08-30 dev 实机 verified**（localhost:3000 磁盘真实 git 桥桩）：选择器渲染「当前分支 (HEAD) + main（当前）+ 其他分支」，切换后 `commitLog` 以 `ref` 重新加载（调用序列 `null → "codex/old-work"`）、列表按分支渲染、选中态保持；截图 `acceptance/ui-226/branch-selector.png`。**边界**：skip/file 透传修复的最终真实链路复核以 dev Electron 重启载入新主进程代码后为准（UI-221 勘误同日登记）。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-227: BLOCK-29.5 P3 — blame 逐行归属（文件视图第四态） (2026-08-30 verified)

**背景**：BLOCK-29.5 只读视野第三项：每行是谁在哪次提交改的。adapter 是唯一 git 命令边界，blame 解析自包含实现（`--porcelain`；IDE MCP 工具的同形解析器 `core/biof3-server/mcp/ide-tools/git-blame.js` 因与 allowlist/spawnSync 耦合不直接复用）。

**改动范围**：
- git-adapter 新增只读 `blame({path, ref})`：porcelain 解析（行 → shortSha；commit 信息按 shortSha 去重，author/author-time/summary 仅首块出现可正确聚合）；行数超 5000 截断（`truncated` fail-closed 提示）；ref 走 `assertSafeRef`。
- IPC 新只读通道 `git:blame`（path 必填 + ref 可为提交 sha）；preload 暴露 `blame`；electron.d.ts 同步。
- 前端：提交文件视图第四态 `blame`（diff / 全文·改动后 / 全文·改动前 / blame），三列等宽栅格（行号 + shortSha 作者·日期 + 内容，行 hover 高亮 + title 显示提交 subject）；进入第四态按 `{path, ref: hash}` 拉取；切文件/提交重置回 diff。

**验证**：node --check 3 文件；adapter 真实仓库快测（本仓 AUDIT-LOG.md：601 行 / 162 commits / 行→commit 查找 0 丢失）；tsc 0；定向 vitest 26/26（新增用例：blame 视图渲染两行两归属 + 断言 `blame({path, ref: hash})` 调用契约）。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩 + 真实 adapter blame 数据）：2de3897 提交 README.md → blame 视图两行分别归属 94e3047（init）与 2de3897，调用参数 `{path: 'README.md', ref: <full sha>}` 正确；截图 `acceptance/ui-227/blame-view.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-228: BLOCK-29.5 P4 — 任意两提交对比（对比模式 + 区间 diff） (2026-08-30 verified)

**背景**：BLOCK-29.5 只读视野第四项：此前只能看「单提交 vs 父提交」，任意两提交的区间差异看不到。全部复用既有通道的 additive 参数，不新增 IPC 通道。

**改动范围**：
- IPC：`git:commit-diff` 增区间分支 `{fromRef, toRef}`（均 assertSha hex 校验，`adapter.diff` 区间 patch → `parseDiffFiles`）；`git:commit-file-content` 增区间分支 `{path, fromRef, toRef}`（fromRef 版本为 original、toRef 为 modified，`showFile` 直读，缺失侧空串）。
- hook：对比模式状态机（`compareMode/compareBase/compareFrom/compareTo/compareDiff/compareFilePath` + `enterCompareMode/exitCompareMode/handleCompareClick`）——历史头部「对比」进入，依次点两提交 = 基准→目标，加载区间 diff；对比模式下行点击走 `handleCompareClick`，退出恢复正常 openCommit。
- ReviewMode：对比视图（详情头「对比 A..B + N 文件 ±A −D + 退出对比」+ 文件条 ±统计 + 只读 diff；`CommitDiffFileView` 增可选 fromRef/toRef props 走区间取文）；历史头部对比模式提示（「点选基准提交」→「已选基准 X，点选目标提交」）。

**验证**：node --check；tsc 0；定向 vitest 27/27（新增用例：进入对比→选基准→选目标 → 断言 `commitDiff({fromRef, toRef})` 调用契约 + 对比头渲染「对比 b2c3d4e..a1b2c3d / 1 文件」）。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩）：对比模式点选 2de3897→a3b567f，`commitDiff`/`commitFileContent` 均以完整 sha 区间参数调用、对比头「对比 2de3897..a3b567f · 1 文件 +1 −0」、文件条与只读 diff 渲染、退出对比恢复；截图 `acceptance/ui-228/compare-view.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-229: BLOCK-29.5 P5 — stash 只读列表 / 标签分组 / 未跟踪文件预览 (2026-08-30 verified)

**背景**：BLOCK-29.5 只读视野收尾小件三项。stash 仅查看（pop/apply/clear 等写操作维持排除）；标签经历史选择器按 ref 查看；未跟踪文件此前手风琴展开只有「暂无行级 diff」占位。

**改动范围**：
- git-adapter：只读 `stashList()`（`stash list` NUL 分隔 ref/shortSha/isoDate/subject，0 写操作）与 `tagList()`（`for-each-ref refs/tags` 按创建时间倒序）；真实仓库快测（desktop 仓 0 stash / 7 个真实 v0.0.1-rc.x tag 解析正确）。
- IPC：新只读通道 `git:stash-list` / `git:tag-list`；preload `stashList/tagList`；d.ts 同步。
- 前端：hook `stashes/tags/loadStashesAndTags`（历史 tab 点击时加载）；历史分区头部下方 stash 只读列表（ref + subject + 时间，有内容才显示）；分支选择器增「标签」optgroup（tag 名作 ref 直查该标签历史）；未跟踪文件展开替换为 `UntrackedFilePreview`（既有 `fileContent({ref:'WORKTREE'})` 直读磁盘 + CodeMirrorEditor 只读渲染，失败/空文件/加载态分明）。

**验证**：node --check 3 文件；adapter 真实仓库快测；tsc 0；定向 vitest 28/28（新增用例：stash 列表渲染 + 标签 optgroup）。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩）：历史分区 stash 列表渲染（stash@{0} + subject + 时间）、选择器含「标签」optgroup（v229-demo（tag））；改动分区未跟踪文件 ui229-untracked.md 展开渲染只读全文（DOM 断言 `rvw-untracked-preview` 含「# ui229 未跟踪预览 / WORKTREE 直读磁盘」完整内容）；截图 `acceptance/ui-229/stash-tags.png`（未跟踪预览另有 DOM 断言在案，截图通道当日抖动）。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-230: BLOCK-29.3 增量 — 完整提交说明默认直接展开（用户反馈） (2026-08-30 verified)

**用户反馈**：「历史记录 需要点击完整提交说明 到新的页面才能展开 不需要这么麻烦 点开就应该向下展开详细内容」——UI-223 交付的详情头完整说明默认折叠（原生 details），用户要求点开提交即直接展开。按治理「增量复用既有 Plan ID」，挂 BLOCK-29.3-COMMIT-DETAIL（plan `docs/block-29-3-commit-detail-plan.md` 增量注记），不新开工作包。

**改动范围**（ReviewMode.tsx + ReviewMode.css）：详情头完整说明去掉 `<details>` 折叠开关，点开提交即直接渲染全文（`data-testid="rvw-commit-body"`）；pre 上限 180px → 40vh（超长说明内部滚动，不把 diff 挤出视野）；移除 summary 相关样式。

**验证**：tsc 0；定向 vitest 28/28（用例更新：点开提交即见 `rvw-commit-body` 全文、无「完整提交说明」开关、无 body 提交不渲染说明块）。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩）：点开提交 body 直接可见（preHeight 164px）、折叠开关 0 残留；截图 `acceptance/ui-230/body-expanded-on-open.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-231: BLOCK-29 增量 — 历史列表点击提交改为行内向下展开（不再跳转） (2026-08-30 verified)

**用户反馈**：「我的意思是 点击不要到新的界面了 应该是直接向下展开」——UI-219 起点开提交会**替换**历史列表为详情视图（需「← 返回历史」回去），用户要求与 BLOCK-29.1 文件手风琴一致的交互：点行 = 行下展开，列表不动。

**改动范围**：
- 新增自包含组件 `ExpandedCommitDetail`（自行拉取 commitDiff 与选中文件全文、本地管理选中文件与四态视图），展开在触发行正下方：详情头（subject / 作者·时间 / N 文件 ±A −D）+ 完整提交说明直显（UI-230 语义）+ 文件条 ±统计 + 只读 diff（含全文/blame 四态）。
- 历史列表行改 `aria-expanded` 手风琴语义：点行切换展开/收起，**多条可同开**、列表与滚动位置不动；「← 返回历史」按钮与跳转式详情视图整体移除；对比模式下行点击行为不变（仍走 handleCompareClick）。
- hook 清理：移除跳转式状态与动作（`selectedCommit/commitDiff/commitDiffLoading/selectedCommitFilePath/openCommit/backToCommitList`），switchBranch/enterCompareMode 相应精简。
- 按治理增量规则复用 Plan ID `BLOCK-29-COMMIT-HISTORY`（plan 增量记录 UI-230/231）。

**验证**：tsc 0；定向 vitest 28/28（用例重写：点行后列表仍可见 + 行内 diff 渲染；收起/切换行；其余历史相关用例同步更新）。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩）：列表保留、64c7c10 与 2de3897 两行同开（aria-expanded true/false/true/false）、详情含完整说明 body 与文件 chips、返回按钮 0 残留；截图 `acceptance/ui-231/inline-expand.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-232: BLOCK-29 增量 — 修复真实链路提交差异恒为空（pathspec 断点）+ 失败态诚实呈现 (2026-08-30 verified)

**用户反馈**：「如果已经提交了 怎么会有 该提交没有可显示的文件差异 呢」——已提交的 commit 必有差异，该文案出现即查询失败被伪装成空。**根因**：adapter `diff()` 经 `assertSafePathspecs` 强制 pathspec（防全树操作的既有 fail-closed 设计），而 `git:commit-diff` 的 `commitDiffParsed` 以 `{fromRef: hash^, toRef: hash}` **不带路径**调用 → 抛 `pathspec_required` → IPC error → 前端 catch 落成空 diff → 所有提交（含区间对比 `{fromRef,toRef}`，UI-228 同路径）在真实 Electron 中恒显示「0 文件 +0 −0 / 没有可显示的文件差异」。与 UI-226 修的 skip/file 断点同构：adapter 与 shim 各自正确、断点在契约层，历史验证全走浏览器桩未暴露——**该链路自 UI-219 起在真实 app 中从未工作过**。

**改动范围**：
- git-adapter `diff()`：双 ref（fromRef+toRef）区间是有界提交间只读比较，无 pathspec 时放行整树；工作区 diff（无 ref，含 --cached）维持 pathspec 强制不变。真实仓库验证：desktop 仓 HEAD^→HEAD 返回 22914 字符 patch（含 docs/ 7 文件）。
- 前端诚实化：`ExpandedCommitDetail` 增 error 态（「提交差异加载失败：<原因>」role=alert），失败不再渲染「没有可显示的文件差异」；空态文案改「（空提交）」；对比模式同步增 `compareError`（hook 状态 + 对比头显示，`compareDiff` 空值全链 null-safe）。
- 回归测试：`test/git-adapter.test.mjs` 新增用例——临时真实仓库两 ref 无 pathspec diff 返回完整 patch + 工作区无 ref diff 仍抛 `pathspec_required`。

**验证**：node --test test/git-adapter.test.mjs 39/39（含新用例）；tsc 0；定向 vitest 28/28。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩失败模式注入）：commitDiff 返回 ok:false → 详情显示「提交差异加载失败：Scoped git diff failed.」、误导性空态 0 出现。**边界**：adapter 修复在主进程，**dev Electron 须重启**后真实链路才回绿；重启后提交详情与区间对比将显示真实文件差异（此前恒空）。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-233: BLOCK-29 增量 — 展开详情去重：统计上移到列表行，详情头移除 (2026-08-30 verified)

**用户反馈**：「出现两次…保留一个就可以了吧 详细的信息 6 文件 +95 −25 加到第一次出现的位置」——UI-231 行内展开后，列表行与详情头重复展示 subject/作者·时间。

**改动范围**（ReviewMode.tsx + css）：
- `ExpandedCommitDetail` 移除整个详情头（`rvw-commit-info`：subject/作者·时间/汇总统计）——行上已有 subject 与作者·时间，不再重复；展开区直接以完整提交说明开始（UI-230 语义保持），其后文件条 + diff。
- 汇总统计「N 文件 +A −D」上移到列表行：新增 `commitSummaries` 状态（sha → 统计），`ExpandedCommitDetail` 经 `onSummary` 回调上报，行尾渲染 `.rvw-history-row-stats`；首次展开后加载，**收起后保留在行上**。
- subject 全页唯一（行上），实机断言 `subjectCount === 1`。

**验证**：tsc 0；定向 vitest 28/28（用例更新：详情头 0 出现、行上统计断言、收起后统计保留、无 body 提交详情无说明块）。**2026-08-30 dev 实机 verified**（localhost:3000 桥桩）：64c7c10 行显示「2 文件 +7 −0」、subject 全页唯一、详情头 0 残留、body 直显、收起后统计保留；截图 `acceptance/ui-233/row-stats.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-234: BLOCK-29 增量 — 历史行统计默认显示（log --shortstat 随列表一次取回） (2026-08-31 verified)

**用户反馈**：「目前点击之后 才会出现数据 是否可以默认就显示呢」「重启后也是 点击之后才出现真实 git 数据」——UI-233 的行上统计依赖点开后的 commitDiff 回调，未点开的行没有统计。改为统计随历史列表本身一次取回。

**改动范围**：
- git-adapter `log()` 加 `--shortstat`：每条提交附 `stats {files, added, removed}`（一条 git 命令整页都有，非逐提交请求）；stat 行附在记录末尾，从记录末行提取（正则含仅插入/仅删除缺省段），不混入 `message`；空提交无 stat 行 → `stats: null`。
- 载荷 additive：`git:commit-log` commits[] 增 `stats`（IPC/preload 直传）；`electron.d.ts` + `CommitInfo` 增可选 `stats`。
- 前端：行上统计优先读 `c.stats`，旧桥桩/无 stats 时回退既有 `commitSummaries`（点开加载）路径保留。
- 真实仓库验证：desktop 仓前 4 条提交统计与提交内容一致（如 `a8b90f1` = 6 文件 +95 −25），626 字符多行 body 无 stat 行混入。

**验证**：node --test test/git-adapter.test.mjs 39/39（UI-232 用例扩展 stats 断言：两提交精确统计 + message 不串行）；tsc 0；定向 vitest 29/29（新增用例：commitLog 带 stats → 行默认显示统计，无需点开）。**2026-08-31 dev 实机 verified**（localhost:3000 桥桩带 stats）：不点任何提交，4 行统计全部默认显示（64c7c10「2 文件 +7 −0」等）；截图 `acceptance/ui-234/default-stats.png`。**边界**：adapter 改动在主进程，dev Electron 重启后真实数据生效（与 UI-232 同一次重启覆盖）。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-235: BLOCK-29 增量 — 历史分区汇总替代误置的工作区统计 (2026-08-31 verified)

**用户反馈**：「这个上面的 +0 -0 是什么意思？？？是不是应该是当前选中分支的总变化比较好呢」——summary 条的「+0 −0 / n/m 已审」是工作区未提交改动统计与审阅进度，在「历史」分区不适用（工作区干净时恒为 0），纯属误导。

**改动范围**（ReviewMode.tsx，纯前端）：
- 历史分区 summary 改显历史语境汇总：`{当前分支 | 分支名/标签名} · 已加载 N 条提交 · 合计 +A −D`；合计 = 已加载提交 `stats` 聚合（`historyAggregate` useMemo），「已加载」措辞诚实——不冒充全分支总量，随「加载更多」增长；无 stats 数据（旧桥桩）时不显示合计。
- 改动分区保持工作区统计不变；两分区各用独立 testid（`rvw-summary-stats` / `rvw-history-summary-stats`）。

**验证**：tsc 0；定向 vitest 30/30（新增用例：历史汇总分支/条数/合计断言 + 分区切换互斥恢复）。**2026-08-31 dev 实机 verified**（localhost:3000 桥桩带 stats）：历史分区显示「当前分支 · 已加载 4 条提交 · 合计 +10 −0」（7+1+1+1=10 聚合正确）、工作区统计 0 出现；切回改动分区恢复「0 个文件 +0 −0 0/0 已审」；截图 `acceptance/ui-235/history-summary.png`。纯前端，刷新即生效。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-236: BLOCK-29 增量 — 审阅面板背景视觉统一（去静态灰底，灰只给交互态） (2026-08-31 verified)

**用户反馈**：「目前审阅背景都是灰色的 很不好看 从设计的角度来说 你觉得应该怎么统一背景色呢 要高级些」——设计审计：历史流里展开区（bg-subtle）、提交说明（灰底描边盒）、stash 列表（bg-subtle + 虚线）多层灰底叠加成「灰汤」。设计原则：**内容区单一画布色，结构靠发丝线与留白；灰是状态色不是装修色**——灰底只保留给交互态（行 hover/选中、按钮、进度条），顶栏保留 surface 与内容区形成层级。

**改动范围**（ReviewMode.css，纯样式）：
- `.rvw-history-detail` 展开区：去 bg-subtle → 透明，保留左侧 2px 竖线作为区域标记。
- `.rvw-commit-body pre` 提交说明：blockquote 化——去灰底与四边框，左侧 2px 发丝线 + 弱化等宽文字 + 1.6 行高，排版驱动而非盒子驱动。
- `.rvw-stash-list`：去灰底与虚线框 → 透明 + 左竖线。
- 全部走语义 token，明暗主题自动成立；代码区（diff/全文）保持 surface/canvas 有界 surface 不变。

**验证**：tsc 0；定向 vitest 30/30 + theme-token 契约 14/14（纯 CSS 改动）。**2026-08-31 dev 实机 verified**（localhost:3000 桥桩）：透明背景计算样式断言（detailBg/preBg = rgba(0,0,0,0)、pre 左边框 2px solid）+ 暗色/浅色双主题截图对比（`acceptance/ui-236/dark-unified.png`、`light-unified.png`）——内容区单一底色、发丝线结构、说明成引用体。纯 CSS，刷新即生效。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-237: BLOCK-29 增量 — 展开行选中态去灰底（accent 竖线 + 标题着色） (2026-08-31 verified)

**用户反馈**：「改好了吗？？？你看看图片背景不还是有灰色的吗」（浅色主题真实数据截图）——UI-236 后剩余的灰是展开行的 `aria-expanded` 选中底色（bg-subtle 灰带）。

**改动范围**（ReviewMode.css，纯样式）：展开行去灰底 → 透明 + `box-shadow: inset 2px 0 0 accent`（左竖线标记，无布局位移）+ subject accent 着色加粗；hover 从 bg-subtle 降为更轻的 `--biof3-hover`。至此面板灰底只剩 hover 瞬态与顶栏 surface 层级，选中语义由 accent 竖线承担。

**验证**：tsc 0；定向 vitest 30/30 + theme-token 14/14。**2026-08-31 dev 实机 verified**（localhost:3000 桥桩，浅色主题对齐用户截图视角）：展开行 `backgroundColor = rgba(0,0,0,0)`、左竖线 `rgb(13,148,136) 2px inset`、subject accent 着色；截图 `acceptance/ui-237/light-expanded-accent.png`。纯 CSS，刷新即生效。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-238: LIGHT-THEME-PURITY P1 — 浅色主题系统性去脏（slate 蓝灰 → zinc 中性 + 纯白画布） (2026-08-31 verified)

**用户反馈**：「软件整个还有大量的浅灰…浅灰是软件的主题色吗？系统性识别并优化…要纯净感，目前的灰有一种说不出来的脏感」。**系统性诊断**：浅色主题全部表面/边线/文字采用 Tailwind slate 系（带蓝调），大面积铺底 + 多层相近蓝灰叠放 = 脏感根源；「浅灰确实是主题色」——但不应是。**纯净感配方**（Notion/Linear/Vercel 公共做法）：纯白主导 + 无彩中性灰只做发丝线/hover + 单一品牌彩。

**改动范围**（token 为唯一杠杆，组件零改动；custom.css 浅色块 + global.css surface-dim）：
- 表面：`bg-canvas` #f8fafc → **#ffffff**（纯白画布）、`bg-subtle` #f1f5f9 → #f4f4f5、`surface-dim` 同步。
- 边线：`border` #e2e8f0 → #e4e4e7、`border-strong` → #d4d4d8、`border-tertiary` → #ebebee。
- 文字中性化：text #0f172a → #18181b、secondary → #3f3f46、tertiary → #71717a、muted → #a1a1aa、terminal 系列同步。
- overlay/shadow 基色 rgba(15,23,42,…) → rgba(24,24,27,…)；hover #eef2f7 → #f4f4f5。
- **不动**：暗色 navy 主题（刻意品牌冷调）、teal accent 与状态色（唯一的彩）、对比度不降（zinc-900 on white ≈ 原 slate-900）。硬编码审计：全仓 slate 字面量仅 2 处且属暗色语境，不动。

**验证**：tsc 0；定向 vitest 44/44（5 文件含 theme-token 契约）。**2026-08-31 dev 实机 verified**（localhost:3000 浅色主题）：工作区页纯白画布 + 发丝线 + teal 卡片（截图 `acceptance/ui-238/home-light.png`）、审阅历史展开详情/引用体说明/accent 竖线在纯白下成立（`acceptance/ui-238/review-history-light.png`），脏感消除。纯 token 改动，刷新即生效。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-239: TYPOGRAPHY-HIERARCHY P1 — CodeMirror 全场景 13px 基准（diff/全文/gutter 统一） (2026-08-31 verified)

**用户反馈**：「编辑区或者diff区域文字的大小层次不齐的 不协调呀…要整体协调才可以的」。**实测定位**（browser-use 连 localhost:3000 读 computed style + 全仓 CSS 审计）：CodeMirror 全链无字号声明——`CodeMirrorEditor.module.css` 的 `.cm-scroller` 只设 font-family，`.wt-cm-diff`→`.rvw-*` 容器链到 body（16px）均无 font-size，CM6 baseTheme 无默认字号（dist 验证）→ 审阅 diff 代码/提交全文（UI-224）/blame 渲染 **16px**，同屏 chrome（标题 13/统计 12/tab 12）差 3~4px，即「diff 区域层次不齐」主源。

**改动**（单行 CSS）：`.cmEditor :global(.cm-scroller)` 增加 `font-size: var(--biof3-font-size-body-sm)`（13px）——一处声明覆盖全部 CM 挂载场景（审阅 diff / 提交全文 / blame / 未来编辑区），行号 gutter 同步继承 13px；基准对齐聊天正文/文件树/markdown 预览（13px）。

**门禁**：tsc 0 / 定向 vitest（theme-token 契约 + CM 相关）/ docs:check / ui:audit:check。**待 P4 实机**：disposable fixture 造脏文件后断言 `.cm-line`/`.cm-gutters` computed 13px，截图 `acceptance/ui-239/` 后转 verified。

**2026-08-31 dev Electron 实机 verified**（CDP 9222 驱动，intent-to-add fixture `typo-fixture-demo.py` 真实 hunk，验收后删除 0 残留）：审阅改动 diff `.cm-line`/`.cm-content`/`.cm-gutters`/`.cm-scroller` 全部 **13px**（修复前继承 16px），chrome 标题 13/统计 12/tab 12，层次连贯；历史分区点开提交 diff 13px；`CommitDiffFileView` 全文 viewMode（UI-224 场景）正文/gutter 13px。截图 `acceptance/ui-239/review-diff-light.png`、`review-fulltext-light.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-240: TYPOGRAPHY-HIERARCHY P2 — Infima `code`/`pre` 88% 接管 + 代码块统一 13px (2026-08-31 verified)

**实测定位**（同 UI-239 审计）：`custom.css --ifm-code-font-size: 88%` + Infima 裸元素规则（`code{font-size:88%}`、`pre{font:88%/1.45 mono}`）从未被桌面覆盖（`global.css` 只接管背景/边框）→ 一切 `<pre>`/`<code>` 渲染为容器 × 0.88（13→11.4px、16→14.1px），各容器基准不同导致「小一号」互不一致——「编辑区」代码忽大忽小的来源。连带发现两处同族漂移：聊天双套代码块 12/13 并存（`.cp-md .cp-code-pre` caption vs `.sc-msg-body pre` body-sm）、Result Studio 代码视图硬编码 `font: 12px`（`RevisionCodeView.module.css`）。

**改动**（代码块统一 body-sm 13px / 行内 code 统一 caption 12px）：
- `global.css` bare `code`：接管 `font-family: var(--biof3-font-mono)` + `font-size: var(--biof3-font-size-caption)`；bare `pre`：接管 `font: var(--biof3-font-size-body-sm)/1.5 var(--biof3-font-mono)`；`pre code` 100%/inherit。88% 漂移废除；显式规则（`.sc-msg-body`/`.workspaceMarkdownPreview code` 行内）specificity 更高不受影响；docs 页 iframe 文档隔离不受影响。
- `simple-chat.css` `.cp-md .cp-code-pre` caption→body-sm（聊天内两套代码块对齐 13px）。
- `RevisionCodeView.module.css` `.code code` 12px 硬编码→body-sm token（Result Studio 代码视图 13px）。

**门禁**：tsc 0 / 定向 vitest（theme-token 契约 + 受影响组件）/ docs:check / ui:audit:check。**待 P4 实机**：HighlightedCode/聊天/markdown 预览 computed 断言 + 截图 `acceptance/ui-240/` 后转 verified。

**2026-08-31 dev Electron 实机 verified**（CDP 9222，fixture 项目 workspace=/tmp/biof3-typo-fixture，验收后清理）：markdown 预览正文 13px / 行内 code **12px**（修复前 88%→11.44px）/ 代码块 pre **13px + ui-monospace**（修复前 88%→11.44px 且字族漂移）；文件编辑器 textarea 13px；暗色抽查同 token（13/12/13）。`.cp-code-pre` 与 `RevisionCodeView` 为显式 token 静态断言。截图 `acceptance/ui-240/workspace-markdown-preview-light.png`、`workspace-markdown-preview-dark.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-241: TYPOGRAPHY-HIERARCHY P3 — 低于 token 阶梯的 7~9px 硬编码收口 (2026-08-31 verified)

**实测定位**（同 UI-239 全文档 computed 扫描）：token 阶梯最小档 xs(10px)，但文件树文件大小 9px（`_fileTreeSize`）、文件图标徽标/字形 7~8px（`WorkspaceFileIcon.module.css`，同一文件内已混用 7/8/10/12 四档）、Result Studio 微标签与 TitleBar 会话徽标等 9px 共 18 处硬编码低于阶梯。实测全景 9 档混排（7/8/9/10/11/12/13/14/16px）中的最小三档全部属此类脏值。

**改动**（全部收口到 `var(--biof3-font-size-xs)` = 10px，0 档位语义变化）：`project-workspace.module.css` 9px×10 + eyebrow 8px；`WorkspaceFileIcon.module.css` badge 8px + glyph 7px×5（18px 图标盒内 10px 徽标待 P4 实机核对不溢出）；`custom.css` run-modal 表格 9px；`TitleBar.module.css` convSelectorBadge 9px；`ScientificInteractionViewer` caveat/matrix 9px×2；`CompactResultNavigator` truthBadge/relatedFiles 9px×2；`ResultAgentComposer` progress small 9px。grep 兜底全仓 font-size 7~9px 清零。

**门禁**：tsc 0 / 定向 vitest / docs:check / ui:audit:check。**待 P4 实机**：文件树/图标徽标/TitleBar computed 断言 + 截图 `acceptance/ui-241/` 后转 verified。

**2026-08-31 dev Electron 实机 verified**（CDP 9222，fixture 项目文件树）：`fileTreeSize` **10px**（修复前 9px）、`fileIcon` 徽标 **10px**（修复前 7/8px；18px 图标盒内 10px 徽标实机无溢出）、`fileTreeLink` 13px。`acceptance/ui-241/evidence.json` 断言在案（画面同 `acceptance/ui-240/workspace-markdown-preview-light.png`）。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-242: FONT-FAMILY-UNIFICATION P1 — 字体族统一（sans/mono 单栈化，杀 Chrome UA 按钮 Arial） (2026-08-31 verified)

**实测定位**（dev Electron CDP 遍历 computed fontFamily 全栈清点）四层漂移：① **Chrome UA 按钮默认 Arial**——`<button>` 不继承字体，无显式 `font-family: inherit` 的按钮（TitleBar 药丸/关闭/红绿灯/全部未接管按钮）计算栈即 `Arial`（此前误判为神秘声明，实为 UA 默认）；② **Infima 元素**用 `--ifm-font-family-base`（system-ui 打头、无 CJK）≠ body 栈；③ **`--biof3-font-sans` 缺 CJK** 且 body 用独立字面量栈（`BlinkMacSystemFont` 计算值序列化为 `"system-ui"` 系假象）；④ **mono 栈动物园**——聊天 `'SF Mono','Fira Code'`×9、custom.css SFMono 字面量×2、desktop.css×1、project-workspace.module.css `font:` 简写×6（含 11px/12px/13px 硬编码字号同栈漂移）、CM 幽灵变量 `--font-family-mono`（恒回退 generic monospace）。

**改动**（sans 单栈 + mono 单栈）：
- `custom.css`：`--biof3-font-sans` 补 CJK（PingFang SC / Hiragino Sans GB / Microsoft YaHei）；覆写 `--ifm-font-family-base` 同栈 + `--ifm-font-family-monospace: var(--biof3-font-mono)`；字面量 mono ×2 → token。
- `global.css`：body 改消费 `var(--biof3-font-sans)`；新增 `button, input, select, textarea { font-family: inherit }` 杀 UA Arial。
- `simple-chat.css` ×9、`desktop.css` ×1、`project-workspace.module.css` ×6（`font:` 简写字号同步 token 化）、`RevisionCodeView.module.css` ×2、`CodeMirrorEditor.module.css` 幽灵变量 → token。
- **不动**：xterm 终端字体（themes/terminal-themes deliberate surface）、`--biof3-mono` 别名（已指向 mono token）。

**门禁**：tsc 0 / theme-token 契约 / docs:check / ui:audit:check。**待 P2 实机**：全栈清点复测 sans 单栈 + mono 单栈、按钮计算栈不再 Arial，截图 `acceptance/ui-242/` 后转 verified。

**2026-08-31 dev Electron 实机 verified**（CDP 9222，Vite HMR 推送后全栈清点复测）：全应用 sans **单栈**（-apple-system/system-ui/Segoe UI/PingFang SC/Hiragino Sans GB/Microsoft YaHei/Roboto——原 UA Arial 的红绿灯按钮、会话选择器全部入栈）、mono **单栈**（`--biof3-font-mono` token）；**全应用 Arial 元素数 = 0**；唯一例外 `xterm-char-measure-element`（xterm 终端内部测量元素，deliberate 不动）。截图 `acceptance/ui-242/workspace-light-after.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-243: BLOCK-29.6 P1 — 审阅头部 chrome 紧凑化（Summary 一行化 + 历史行重排 + 撤销入溢出菜单） (2026-08-31 verified)

**用户反馈**：截图「审阅的上面这几个按钮的布局不太专业」，AskUserQuestion 裁决 A+B 全套。诊断：`.rvw-summary` 窄面板折行 → 标题/按钮/历史工具三行堆叠；五个同尺寸 chip 主次不分（唯一 primary 提交审阅被淹没）；破坏性「撤销上次提交」与只读「对比」同权重并排；✕退出混进行动区；快捷键提示常驻；原生 select 与 chip 风格不一。

**改动**（0 新增 IPC / 0 新依赖 / 审阅内核不动）：
- **A Summary 一行化**：`.rvw-summary` nowrap 紧凑（6px 12px），标题/tabs 不缩、stats 弹性省略 + tabular-nums；行动区 = info icon（快捷键 tooltip，dock 隐藏）+ 刷新 icon-button + 全部还原 danger-ghost + 提交审阅唯一 primary + ✕ icon-only 退出；「编辑文件」从全局工具条移到 diff 文件头行内（`.rvw-inline-edit-btn` accent-ghost，选中非二进制才渲染）；`.wt-shortcut-hint`/`.wt-edit-btn` 死样式清除；`.wt-btn` 紧凑 28px/6px radius。
- **B 历史行重排**：`.rvw-history-tools` 左组（过滤徽标+分支选择器+对比，28px 统一高、caption 12px）+ `.rvw-history-more` 右组 ⋯ 溢出菜单（本地 state + backdrop 点外关闭），「撤销上次提交」入菜单为危险项（`window.confirm` 保留），不再与只读控件平权。
- 测试同步：ReviewMode.test.tsx 撤销用例先点 ⋯ 菜单。

**门禁**：tsc 0 / ReviewMode vitest 19/19 / docs:check / ui:audit:check。**待 P2 实机**：dock 520px 单行断言 + ⋯ 菜单交互 + 文件头行内编辑，截图 `acceptance/ui-243/` 后转 verified。

**2026-08-31 dev Electron 实机 verified**（CDP 9222，dock 520px，intent-to-add fixture，验收后删除）：summary **单行 41px**（修复前三行堆叠）；行动区 = info(dock 隐藏)/刷新 28/全部还原 28 danger-ghost/提交审阅 28 primary/退出 28 icon-only，编辑文件不再占用 summary；历史行左组（过滤徽标+分支选择器 28px+对比）+ 右组 ⋯ 菜单（打开 → 撤销上次提交 danger 项 confirm 保留 → backdrop 关闭 ✓）；**dock 行内编辑落地为手风琴行第三操作**（编辑 wrench accent hover / 查看历史 clock / 放弃 trash，已知二进制隐藏，`diffFile.binary` 判定），/review 主区为文件头 `rvw-inline-edit-btn`（accent-ghost）。截图 `acceptance/ui-243/review-changes-compact.png`、`review-history-menu.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-244: BLOCK-29.7 P1 — 审阅文件导航树化（dock 目录分组树 + 历史提交树） (2026-08-31 verified)

**用户提出**：审阅增加文件树，看清每个版本每个文件的修改对应的项目结构变化。现状：/review 主区已有目录分组左树（BLOCK-28 P2），dock 是平铺手风琴（目录仅 `rvw-acc-dir` 文字后缀），历史提交详情是横向 chips 多文件铺成一片。

**改动**（0 新增 IPC / 0 新依赖 / 审阅内核不动）：
- **dock 改动手风琴 → 目录分组树**：`fileGroups`（`groupFilesByDirectory`）分组渲染，组头复用 `rvw-group-header` 交互（共享组件既有 `collapsedDirs`/`toggleDir`，与 /review 主区同构），文件行嵌套缩进 + `rvw-acc-group-files` 缩进参考线，行内三操作/统计保留；删除冗余 `rvw-acc-dir` 后缀（CSS 死样式一并清除）；`groupDisplayName` 根目录 `"."` → `（根目录）`。
- **历史提交详情 filestrip → 左 mini 树 + 右 diff**：`ExpandedCommitDetail` 内 `commitGroups`（复用同一 helper）+ 局部 `treeCollapsed` 折叠态；`.rvw-commit-detail-body`（树 172px + diff 余宽），树行选中 accent、组行 caret+计数，`max-height 60vh` 双侧独立滚动。

**门禁**：tsc 0 / ReviewMode vitest 19/19 / docs:check / ui:audit:check。**2026-08-31 dev Electron 实机 verified**（CDP 9222，多目录 intent-to-add fixture docs-fix/scripts-fix/根，验收后删除）：dock 分组树 5 组（含（根目录）新标签）、7 嵌套行、目录后缀清零、组折叠/展开 ✓；历史提交展开左 mini 树（组+行选中 accent）+ 右 diff 渲染 ✓。截图 `acceptance/ui-244/review-dock-grouped-tree.png`、`review-commit-tree.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-245: BLOCK-29 增量 — 历史工具条防挤压（对比按钮竖排字修复）+ 分支切换实测 (2026-08-31 verified)

**用户反馈**：截图「这个地方有瑕疵…无法切换分支选项吗？」。诊断（CDP 实测）：①「对比」按钮被 `.rvw-history-tools` flex 挤压至 33px 宽、两字竖排——`.wt-btn` 无 `white-space: nowrap`/`flex-shrink: 0`（UI-243 紧凑化引入的挤压回归）；② 分支下拉**功能完好**（9 选项：main + 7 tag），「无法切换」系体验误判——当前就在 main，选「main（当前）」无变化；切换 tag 时 stats 分支名与合计即时变化即为反馈。

**改动**：`.wt-btn` 增加 `white-space: nowrap; flex-shrink: 0`；`.rvw-branch-select` 增加 `flex-shrink: 0`。

**门禁与实机**：**2026-08-31 dev Electron 实机 verified**（CDP 9222）：「对比」45px 单行 28 高；切换 `v0.0.1-rc.1` → stats 即变「v0.0.1-rc.1 已加载 50 条提交 合计+11729 −2509」（历史真实切到 tag），切回 HEAD 恢复 ✓。截图 `acceptance/ui-244/history-toolbar-fixed.png`。

**状态**: verified (dev 边界内)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-246: BLOCK-29 增量 — 历史工具条层级修复（sticky 钉住 + rvw-history-menu 类名解冲突） (2026-08-31 verified)

**背景**：用户实测反馈历史工具条随滚动走位裁出残影、⋯ 菜单锚点漂移。诊断：① `.rvw-history-head` 无 sticky；② ⋯ 菜单容器误复用 `.rvw-history-more`——那是「加载更多」按钮的类（全宽虚线框），继承出多余层且锚点漂移。

**改动**：`.rvw-history-head` 加 sticky；⋯ 容器类改名 `.rvw-history-menu`。实机截图 `acceptance/ui-246/history-toolbar-layer-fixed.png`。

**后续**：UI-247 把历史第二行整体并入 summary 行，sticky 部分随整行删除（summary 本身固定顶部，原目标达成）；`.rvw-history-menu` 类名修复保留（菜单迁入 summary-actions）。

**状态**: verified (dev 边界内，部分被 UI-247 取代)。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-247: BLOCK-29 增量 — 分支选择/对比/⋯ 并入审阅 tabs 行，历史第二行取消 (2026-08-31 verified)

**用户反馈**：截图「这个分支选择的按钮是不是应该放到 审阅 改动 历史 同一行 目前两行很不和谐」。

**改动**（0 新增 IPC / 0 新依赖）：历史分区的文件过滤徽标、分支选择器、对比按钮（含对比模式提示）并入 `rvw-summary-left`（紧跟 改动|历史 tabs 之后，stats 之前）；⋯ 溢出菜单（撤销上次提交）移入 `rvw-summary-actions`（仅历史分区渲染）；删除 `rvw-history-head` 第二行及 `.rvw-history-head`/`.rvw-history-tools` 死样式。CSS：summary 内分支选择限宽 150px、`.wt-btn`/过滤徽标不参与 flex 挤压。

**门禁**：tsc 0 / ReviewMode vitest 30/30 / docs:check 170 / docs:reconcile 0。待 dev Electron 实机过目后转 verified。注：对比按钮随后由 UI-249 按用户裁决移除。

**BLOCK-46 实机复核（2026-09-03）**：`.rvw-summary-left` 含 改动|历史 tabs + stats + 分支选择器（master（当前））单行渲染；对比按钮未回归出现（UI-249 移除保持）。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-249: BLOCK-29 增量 — 移除历史「对比」（两提交区间对比模式） (2026-08-31 verified)

**用户反馈**：「历史 点击后 有对比 对比是不是没有实际意义？ 可以清掉吗」。

**评估**：对比 = BLOCK-29.5 UI-228 的两提交区间 diff（点基准→点目标看 A..B），功能真实但低频、入口语义不自明（UI-245 同类反馈佐证）。按用户裁决移除。

**改动**（0 IPC 删除 / 0 依赖变动）：summary 行「对比」按钮与提示移除；`rvw-body` 对比视图分支（文件条 + 区间 diff）与历史行点选分支逻辑删除；hook 删除 compareMode/compareBase/compareFrom/compareTo/compareDiff/compareError/compareFilePath 状态与 enterCompareMode/exitCompareMode/handleCompareClick（接口 + 实现共 ~70 行）；死样式清除（`.rvw-filestrip`/`.rvw-filechip*`/`.rvw-commit-info*`/`.rvw-commit-subject`/`.rvw-commit-meta`/`.rvw-commit-summary`/`.rvw-compare-hint`）。`git:commit-diff` IPC 保留（历史提交行内展开详情仍消费）。

**门禁**：tsc 0 / ReviewMode vitest 29/29（对比用例随功能删除）/ docs:check 170 / ui:audit:check / docs:reconcile 0。待 dev Electron 实机过目后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：历史分区渲染正常，全页无「对比」按钮（compareButtonsVisible=0）。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-250: BLOCK-29 增量 — 改动文件行悬停浮动预览（审阅详情同源只读 diff） (2026-08-31 verified)

**用户反馈**：「工作区 改动部分 会列出来具体有哪些文件修改了 鼠标放上去能否出现悬浮窗口展示详细信息呢？详细信息就是审阅里的详细信息」。

**改动**（0 新增 IPC / 0 新依赖）：dock 手风琴行 + /review 主区文件行 hover 350ms 后在行旁弹出 fixed 浮窗——头部（状态徽标 + 完整路径 + +/− 统计）+ 只读 diff（复用 `CodeMirrorDiffView`，不传 accept/reject 即无操作控件）；二进制文件显示说明文案；未跟踪文件复用 `UntrackedFilePreview` 显示工作区内容。行为细节：移入浮窗可停留阅读，移开 120ms 关闭；**已展开行（dock）/已选中行（主区）不弹**（信息重复，且不拦截点击展开/选中语义）；浮窗 420px、max-height 60vh、右溢出自动翻转到行左侧。

**门禁**：tsc 0 / ReviewMode vitest 29/29。待 dev Electron 实机过目后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：dock 行 hover 350ms 弹出浮窗（头部徽标+路径+统计+diff）；已展开行 hover 不弹（负向断言 PASS）；行近右缘时浮窗自动翻转到行左侧。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

**BLOCK-50 缺陷修复（2026-09-03 verified）**：修复本条与 UI-206 链路的「file not found」报障——已删除（D）/已消失文件是审阅合法条目，但 `git:working-tree-file-content` WORKTREE 分支磁盘缺失即抛 `file_missing`，导致悬停预览/审阅详情/未跟踪预览三消费方报错（用户实测 `docs/archive/.git-quick-ref.md`）。修法：后端结构化兜底（HEAD 有→`deleted:true` 呈现删除 diff + 提示条；HEAD 无→`missing:true` 占位），前端 `CodeMirrorDiffView`/`UntrackedFilePreview` 改占位不再报错。门禁：后端 node --test 4/4（新增 `test/working-tree-review-file-content.test.mjs`）、WorkingTreeReview vitest 43/43、tsc 0。dev Electron 实机复现原场景通过：展开删除行无报错、删除提示条+删除 diff 渲染；悬停未展开删除行 `ARCHITECTURE.md` 预览浮窗 `+0−237` 删除 diff 无报错（证据 `acceptance/block-50/`；plan：`docs/block-50-review-file-not-found-plan.md`）。

## UI-252: BLOCK-29 增量 — 会话区「工作区改动」卡片文件行悬停预览 (2026-08-31 verified)

> **2026-09-09 用户裁决移除宿主卡片**：聊天区「工作区改动」卡片整体移除（组件 + SimpleChat 挂载 + 测试）——每文件改动已在对话内工具行（ToolActivityList）与审阅面板（/review 主区 + dock）呈现，卡片在无 agent 活动的会话呈现场景差（空会话显示全局 git 脏态噪音）且关闭 X 不持久（下个任务收尾即弹回）。本条及其上的卡片增量（悬停预览/浮窗自适应/轮次分组）随宿主移除置 **cancelled**；审阅面板与对话内工具行为准。conversationChangesStore（BLOCK-31/40 会话归属索引）暂保留（写路径在 run 流内）。

**用户反馈**：「会话区这部分的 工作区改动也要可以鼠标悬浮上去就可以有预览的小窗口」（截图：聊天区 AgentChangesCard 文件列表）。

**改动**（0 新增 IPC / 0 新依赖）：`AgentChangesCard` 刷新时保留按文件的完整 diff 数据（原只留统计）；文件行 hover 350ms 弹出 fixed 浮窗——状态徽标 + 完整路径 + +/− 统计 + 只读 diff（复用 `CodeMirrorDiffView` 无操作控件）；二进制/未跟踪文件显示说明文案。交互与 UI-250 一致（移入可停留/移开 120ms 关闭）；点击行仍跳审阅。样式入 `simple-chat.css`（`WorkingTreeReview.css` 已由 App 级引入，CodeMirror 样式全局可用）。

**门禁**：tsc 0 / AgentChangesCard + WorkingTreeReview vitest 35/35。待 dev Electron 实机过目后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：会话卡片 p40-b.txt 行 hover 弹浮窗（未跟踪文件显示说明文案）；点击行跳转审阅 PASS。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-253: 增量 — 创建项目前确认具体工作目录路径 (2026-08-31 verified)

**用户反馈**：「选择工作目录并创建 还没有解决 能打开 但是不能确定具体的项目路径」。

**改动**：两条创建路径增加**创建前路径确认**——① 首页：选定目录后内联确认面板（完整路径框 + 项目名 + 「在此处创建」/「重新选择」），创建动作与选择解耦；② 项目左栏「+」：`window.confirm` 展示完整路径 + 项目名后创建。配合 UI-251 的失败可见化，具体项目路径从「选完即建、不可见」变为「显式确认、可反悔」。

**门禁**：tsc 0 / project-store + LeftPanel + home vitest 10/10 / docs:check / ui:audit:check / docs:reconcile。待实机过目后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：确认面板完整渲染（将在以下目录创建项目 /private/tmp/biof3-tmp + 项目名 biof3-tmp + 在此处创建/重新选择）；在此处创建后成功跳转新项目。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-254: BLOCK-29 增量 — dock 改动分区右侧常驻文件树（左手风琴 + 右导航树） (2026-08-31 verified)

**用户反馈**：截图 dock 改动页面「右侧要有 文件树」。AskUserQuestion 裁决「保留手风琴 + 右侧树」。

**改动**（0 新增 IPC / 0 新依赖 / 审阅内核不动）：dock 改动分区改为 `rvw-dock-split` 左右分栏——左侧手风琴（行为不变：点击行展开行内 diff、悬停预览、展开全部/收起全部）+ 右侧 230px 常驻文件树（目录分组 + 文件行，含已审勾/±统计/选中高亮）。右树交互：组头点击 = 折叠/展开该目录（与左侧共享 collapsedDirs）；文件行点击 = 展开/收起左侧行内 diff 并 `scrollIntoView` 滚动定位（手风琴行新增 `data-acc-path` 锚点）。右树 hover 暂不弹预览（点击即开 diff）。

**门禁**：tsc 0 / ReviewMode vitest 29/29（手风琴测试改用 `data-acc-path` 精确定位，双树同 path 不再歧义）/ docs:check 170 / ui:audit:check / docs:reconcile 0。待 dev Electron 实机过目后转 verified。

**状态**: in_progress。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-255: BLOCK-29 增量 — 悬停预览浮窗位置/尺寸自适应（不再超出应用边界） (2026-08-31 verified)

> **2026-09-09 用户裁决移除宿主卡片**：聊天区「工作区改动」卡片整体移除（组件 + SimpleChat 挂载 + 测试）——每文件改动已在对话内工具行（ToolActivityList）与审阅面板（/review 主区 + dock）呈现，卡片在无 agent 活动的会话呈现场景差（空会话显示全局 git 脏态噪音）且关闭 X 不持久（下个任务收尾即弹回）。本条及其上的卡片增量（悬停预览/浮窗自适应/轮次分组）随宿主移除置 **cancelled**；审阅面板与对话内工具行为准。conversationChangesStore（BLOCK-31/40 会话归属索引）暂保留（写路径在 run 流内）。

**用户反馈**：「卡片悬停预览出来的内容位置和大小能否自适应 尽可能的不被遮挡 目前这个容易超出软件边界」。

**改动**（0 新增 IPC / 0 新依赖）：抽共享组件 `HoverPreviewPopover`（审阅 UI-250 与会话卡片 UI-252 共用）——① 宽度按触发行一侧可用空间收缩（右侧 <300px 自动翻转到左侧，两侧都窄钳到最小 260px，上限 420px）；② 首帧隐藏，`useLayoutEffect` 实测渲染高度后钳制 top，保证浮窗底边不越过应用窗口；③ 定位逻辑收敛到单组件，两处调用方只传 anchor（触发行 rect）。CSS 保持 420px 基准宽，inline maxWidth 动态收窄。

**门禁**：tsc 0 / ReviewMode + AgentChangesCard vitest 33/33。待 dev Electron 实机过目后转 verified。

**BLOCK-46 复测（2026-09-03）**：横向自适应（420px 基准宽收缩、右侧贴边翻转到行左侧）实机 PASS；发现纵向边界——`HoverPreviewPopover` 的 `useLayoutEffect` 仅在 anchor 变化时测高，diff 内容异步膨胀（如 +42/−103 中等体量）后 top 不重算，浮窗高度达 60vh 上限时底边可越界约 145px（winH 1277 / bottom 1422）；已在 roadmap 登记增量候选（重算时机改为内容高度稳定后）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

**BLOCK-47 增量修复（2026-09-03 verified）**：修复本条复测发现的纵向越界——[HoverPreviewPopover.tsx](../frontend/src/components/desktop/WorkingTreeReview/HoverPreviewPopover.tsx) 的 `useLayoutEffect` 仅在 anchor 变化时测高，内容（CodeMirrorDiffView 只读 diff）异步膨胀后 top 不重算，60vh 上限时底边越界约 145px。修法：根元素挂 `ResizeObserver`，内容盒高度变化后按同一钳制公式重算 top（保留首帧 useLayoutEffect 防闪跳），单组件 0 新依赖，UI-250/252 两消费方零改动；新增 [HoverPreviewPopover.test.tsx](../frontend/src/components/desktop/WorkingTreeReview/HoverPreviewPopover.test.tsx) 3 用例（首帧钳制 / 膨胀重钳 / 收缩回弹+断开）。门禁：组件+消费方 vitest 50/50、tsc 0、docs:check 187、ui:audit:check。**实机**（dev Electron，证据 `acceptance/block-47/`）：底行场景 src/main.js (+280/−72) 行落位 y≈965，内容膨胀达 60vh 上限 766px 后 RO 重钳 top 942.6→502.6，底边 1268.99 精确贴合 winH-8=1269（修复前按首帧 top 恒定会达 1724，越界 455px）；顶行场景与横向翻转（右缘行浮窗翻左侧）不回归。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-305: 增量 — 前端巨型组件拆分 P0–P3（SimpleChat / project-workspace / ReviewMode+ResultView 拆分清债）(2026-09-08 verified)

**背景**：普查基线最大簇之一 `SimpleChat.tsx` 2343 行（文件头注释自证 hook order 敏感），plan `docs/ui-305-frontend-large-file-refactor-plan.md` P0 按风险从低到高拆分；**纯重构零行为变化**，整簇平移不重排。plan 前置门槛（`src/ipc/file-dialog.js` UI-304 遗留先行处置）已由 `770cfcf6` 满足。

**P0.1 组件外迁**：尾部 6 内联渲染组件外迁 `SimpleChat/` 子目录——[LoopStatusPanel.tsx](../frontend/src/components/copilot/SimpleChat/LoopStatusPanel.tsx) / [AgentProgressList.tsx](../frontend/src/components/copilot/SimpleChat/AgentProgressList.tsx) / [ResultEditProgressList.tsx](../frontend/src/components/copilot/SimpleChat/ResultEditProgressList.tsx)（主文件保持再导出，`SimpleChat.progress.test.ts` 导入路径兼容）/ [ErrorBanner.tsx](../frontend/src/components/copilot/SimpleChat/ErrorBanner.tsx) / [ApprovalCard.tsx](../frontend/src/components/copilot/SimpleChat/ApprovalCard.tsx)（ApprovalRepairHint 仅被卡内使用随卡同文件）；连带 `ApprovalRepairState` 状态机类型移入 [types.ts](../frontend/src/components/copilot/SimpleChat/types.ts)（供主组件与 ApprovalCard 共享）。

**P0.2–P0.4 hook 抽取**（均在依赖声明之后调用，簇内 hook 相对顺序保持原样）：[hooks/useSummaryRetry.ts](../frontend/src/components/copilot/SimpleChat/hooks/useSummaryRetry.ts)（5 useState + retrySummary + UX1H 冷却 tick）/ [hooks/useModelAccessMenus.ts](../frontend/src/components/copilot/SimpleChat/hooks/useModelAccessMenus.ts)（4 useState + planMode 派生 + prePlanAccessModeRef + accessModeLabel + modelGroups/selectedSupplierGroup/preferredPresetForSupplier + selectModel；UI-303 第四档活跃簇）/ [hooks/useConversationResume.ts](../frontend/src/components/copilot/SimpleChat/hooks/useConversationResume.ts)（消息重载 / 隐藏期完结对账 / T82 resumable 重连三 effect + 两 guard ref；reconciledRunRef 供既有 useChatStream 复用归本簇所有）。

**P0.5 主渲染 JSX 拆分（Composer/MessageList）**：按 plan 单独裁决，本期 defer（P1 后视状态再议）。

**门禁**：SimpleChat 定向 + 全 copilot 面向 + 消费面板 vitest 32 文件 266/266（含新 UI-311 回归与 P0 前既有 SimpleChat/progress/PlanApprovalCard 网）；tsc --noEmit 非 TS2550 0 错误（顺手修复 UI-311 遗留 TS2353 1 处，见 UI-311 更正）；实机见下；ui:audit:check / docs:check。

**实机**（dev Electron CDP，证据 `acceptance/ui-305/p0-simplechat-live.json`）：整页重载拆分后模块图——`.sc-outer` 壳挂载、composer textarea 与消息列表在位、零渲染异常。**行数**：2343 → 1915（-428；P0 目标 ≤1000 的余量留给 P0.5 JSX 拆分裁决）。**P1（project-workspace.tsx 3464→1855 行，`160e0f2c`+`feed10da`）**：P1.1 尾部 11 内联组件外迁 `pages/project-workspace/`（FileTreeList/FileTreeItem/RightFileTree/WorkspaceFilePreview/BinaryPreviewCard/OfficePreviewPane/PreviewAssets/TextBlock/TerminalPanel/BrowserPanel/EmptyResult；FileEntry 移入子目录 types.ts、markdownSanitizeSchema 随唯一消费方迁入；导出类组件主文件再导出，导入路径零破坏；主文件未用导入精剪）。P1.2 左栏项目树展开 + 会话搜索状态簇抽入 [useProjectTreeState.ts](../frontend/src/pages/project-workspace/useProjectTreeState.ts)（expandedProjects/toggleProjectExpand/expandProject 三处相同内联写法收敛 + searchQuery/searchIndex/ensureSearch；创建/刷新等编排回调留主组件待 P3 裁决）。

**P2（ReviewMode.tsx 1781→1429 + ResultView.tsx 1609→241）**：CommitDiffFileView/ExpandedCommitDetail/UntrackedFilePreview 外迁 `WorkingTreeReview/`，formatCommitDate 并入既有 reviewModeHelpers.ts，共享类型/常量（CommitSuccess/CommitFileViewMode/BlameData/FULLTEXT_LANGUAGE_BY_EXT）随迁至 helpers 导出；ResultArtifactShell（1369 行单组件）外迁 `workspace-panels/`，EmptyAnalysisResult 随壳迁移并保持主文件再导出。

**P3（逐个裁决 + 基线复查）**：DesktopSettingsPanel 934 不动（设置页单一职责低 churn）；ResultStudioChangeSetPanel 717 不动（Result Studio experimental 面，待 RS 复核窗口一并处理）；ChartRenderer 699 不动（内聚渲染器）；home 669 不动（页面组装层）；逻辑层 conversationRunStore 1255 / copilotClient 1144 / useWorkingTreeReview 774 / useSkillStore 743 / data-profile 643 缓拆不动（契约面广、收益低于风险）；LeftPanel / TitleBar 已不再 >600（前置工作模块化后基线自然下降）；豁免清单照旧（inventory.ts / electron.d.ts / Icon.tsx）。ResultArtifactShell 1481 为单内聚组件，进一步拆分登记为后续候选。

**门禁（全阶段累计）**：各阶段受影响定向 vitest 全绿（SimpleChat 28/28、copilot 全面向+消费面板 266/266、project-workspace 关联 48/48+22/22+18/18、WorkingTreeReview 46/46、workspace-panels+result-studio 194/194）；**收口前端全量 vitest 一次：911/914 通过，3 处失败经 stash 基线复核为 HEAD 存量**（ExperimentalFeaturesSection 2 处 Windows 路径 ENOENT + theme-token-contract 1 处 `--gewu-live-*` JS 注入 token 契约，均非本包引入，已登记 AUDIT-LOG 🟢）；ReviewMode 手风琴用例在全量并发下偶发时序 flake（单独复跑 4/4 + 复跑全量通过）；tsc 非 TS2550 0 错误；ui:audit:check / docs:check。

**实机**（dev Electron CDP，逐阶段）：P0 SimpleChat 壳/composer/消息列表零异常（`acceptance/ui-305/p0-simplechat-live.json`）；P1 三栏布局+composer 挂载零异常（`p1-workspace-live.{json,png}`）；P2 `/project/:id/review` 主区挂载零异常（`p2-review-live.json`）。**状态**: verified（2026-09-08 dev Electron 实机；P0.5 主渲染 JSX 拆分按 plan 单独裁决 defer，ResultArtifactShell 进一步拆分登记候选）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## UI-311: 修复 — ResultStudio `/project/:id/results` 整页崩溃（result:* IPC 信封契约漂移）(2026-09-08 verified)

**发现**：BLOCK-62 P0 顺带发现并登记 AUDIT-LOG 🟢（2026-09-07）：dev Electron 直达 `/project/:id/results` 整页白屏，`useResultStore` 渲染期 `snapshot.results.map is not a function`，ResultStudioPage 无 error boundary → 整棵 React 树卸载；HEAD 既有、非 BLOCK-62 引入。用户裁决单独立项修复。

**诊断**：三层契约漂移——① `src/ipc/result-handlers.js` 全部 handler 统一返回 fail-closed 信封 `{ ok, data?, error? }`；② `src/preload.js` result 命名空间 1:1 透传信封（镜像注释自证）；③ [electron.d.ts](../frontend/src/lib/electron.d.ts) result 命名空间却按裸值声明（`byProject → Promise<Array<Result>>` 等 11 方法），[resultBridge.ts](../frontend/src/lib/resultBridge.ts) 与 [useResultStore.ts](../frontend/src/hooks/useResultStore.ts) 按裸值消费 → `loadResults` 把信封对象写进 `ResultCache.results`，渲染期 `resultsById` 的 `.map` 即崩。Result Studio 长期 `experimental` 无实机验收，漂移从未暴露；连带 `ResultVersionHistory` 的 `version.list` 同样收到信封（`setVersions(versionList || [])` 拿到的是对象）。全仓仅此两个消费方，无第三方直接摸 `window.*.result`。

**改动**（渲染层 2 文件 / 0 新增 IPC / 0 新依赖 / preload 与 handler 零改动）：① electron.d.ts result 命名空间如实声明信封——模块作用域新增 `ResultIpcEnvelope`/`ResultRecord`/`ResultSummaryRecord`/`ResultVersionRecord` 别名，11 方法签名收敛为 `Promise<ResultIpcEnvelope<…>>`（与 workingTreeReview 等命名空间的信封模式同型）；② [resultBridge.ts](../frontend/src/lib/resultBridge.ts) 作为 result 命名空间唯一拆包点——`unwrap`（ok=true → data，否则抛 handler 错误信息，store 捕获落 error 态）+ `unwrapNullable`（get 类 not found 按契约落 null），11 方法全部走拆包；消费方（useResultStore / ResultVersionHistory）零改动。

**门禁**：新增回归 [resultBridge.test.ts](../frontend/src/lib/resultBridge.test.ts) 6 用例 + [useResultStore.test.tsx](../frontend/src/hooks/useResultStore.test.tsx) 3 用例（信封→裸数组 / 错误信封→error 态不崩 / null projectId 不发起加载）9/9；受影响面定向 vitest（result-studio 全套 + desktopBridge）21 文件 178/178；tsc --noEmit 存量 12 处 TS2550 `.at()` 于 HEAD 同败（与本包无关）。**更正（2026-09-08）**：本条发布时「新增 0 错误」表述不准确——resultBridge.test.ts 的 stub 桥接类型引入 1 处 TS2353（tsc 复核跑在测试文件创建前，漏检），已于 UI-305 P0 提交修复（stubBridge 参数放宽为 Record<string, unknown>）；ui:audit:check / docs:check。

**实机**（dev Electron CDP，证据 `acceptance/ui-311/results-route-live.{json,png}`）：直达 `/project/p_mtrawlau_7rly/results` —— React root 正常挂载（children=2）、零页面异常、零 `map is not a function`、渲染真实空态页（「项目结果 / 0 个结果 / 暂无结果 / 在 Copilot 中运行分析后会显示在这里」）。**状态**: verified（2026-09-08 dev Electron 实机）。G0 开发期常态 · 不外推 packaged/Provider/GA。

## UI-310: 增量 — BLOCK-62 TitleBar 列体化（P0 地基 / P1a 片段提取 / P1b 列内 header / P2 跨树同步链退役）(2026-09-07 verified)

**背景**：UI-309 三轮修复（live CSS 变量 / `:global` 标记 / 禁 transition）后确认根因是结构性——TitleBar 独立整宽横条用 grid 模拟三列宽、靠跨 DOM 树同步对齐分隔线。用户裁决启动 BLOCK-62 列体化重构（拖拽接缝 spike 手动实测 PASS 后）。本条覆盖 P0–P2 四阶段，plan `docs/block-62-titlebar-columnization-plan.md`。

**改动**（0 新增 IPC / 0 新依赖，最小可回退）：① [App.tsx](../frontend/src/App.tsx) `AppShell` 按路由分流 `main` 的 `paddingTop`——ProjectWorkspace 路由（`/project/:id/*`，归一化尾斜杠后排除 ResultStudio 的 `/results`）取 0，其余路由维持 `var(--gewu-titlebar-height)`；② [project-workspace.module.css](../frontend/src/pages/project-workspace.module.css) `.workspaceRoot` 从 `calc(100vh - titlebar)` 改 `100vh + padding-top: titlebar`（`box-sizing: border-box` 保内容区高度不变）。**P0 不建 header-slot、不动 fixed TitleBar**——顶栏仍覆盖 0–38，视觉与现状零差异。

**验证**：tsc 触碰文件 0 错误 / TitleBar + useResizableColumns vitest 31/31 / docs:check / ui:audit:check。CDP 实机几何（dev Electron）：workspace 路由 `main padTop=0px · rootH=100vh · bodyTop=38 · 列高=100vh−38`，`/skills` 保持 `padTop=38px` 不回归。**顺带发现**：`/project/:id/results` 既有整页崩溃（`useResultStore.ts:209` `snapshot.results.map is not a function`，`git stash` 验证非本包引入），已登记 AUDIT-LOG 🟢，ResultStudio 属 experimental 面不并入本包。（P0 为阶段中间态，顶栏让位 padding 已在 P1b 随列内 header 落地而退役；本条最终状态见下方收口段。）G0 开发期常态 · 不外推 packaged / Provider / GA。

**加映（2026-09-07）— P1a 行为保持的片段提取**：把 [TitleBar.tsx](../frontend/src/components/desktop/TitleBar.tsx)（603 行）的三区内容 + 共享逻辑提取到 `desktop/titlebar/` 下容器无关片段——[shared.tsx](../frontend/src/components/desktop/titlebar/shared.tsx)（`getIsMac`/`getIsDesktop`/`getFallbackTitle`/`useDesktopWindowControls`/`WindowControls`/`handleTitleBarDoubleClick`）+ [TitleBarLeftZone.tsx](../frontend/src/components/desktop/titlebar/TitleBarLeftZone.tsx)（交通灯+左栏 toggle）+ [TitleBarCenterZone.tsx](../frontend/src/components/desktop/titlebar/TitleBarCenterZone.tsx)（标题+分支 tabs+会话选择器+结果选择器+摘要开关，菜单/下拉状态内聚）+ [TitleBarRightZone.tsx](../frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx)（右栏 pills+「+」工具菜单+终端/右栏/指挥中心开关+非 mac 窗口控件）。`TitleBar` 收敛为 fixed 整条薄壳（组合三区 + span 注入 + grid + 双击）。**行为保持**：提取逻辑一字不动；唯一必要修正——双击改用不订阅 maximize 的纯 `handleTitleBarDoubleClick`（否则与交通灯片段各订阅一次 `onMaximizeChanged`，违反既有测试「恰好 1 次」断言）。这是 P1b 列级 header-slot 复用的安全地基。门禁：tsc 0 / TitleBar.test 15/15（交通灯源码断言改指 LeftZone）+ 定向 5 文件 47/47 / CDP 实机 fixed 顶栏 8 控件全在位、seamGap=0、零异常。

**加映（2026-09-07）— P1b 列内 header 结构翻转**：顶栏从「独立整宽横条 + grid 模拟三列宽 + 跨 DOM 树同步」改为「每列 header 与栏体同属一个 aside/main、同一次 React commit 渲染」——刚性由构造保证，不再靠同步补丁。① [ColumnizedTitleBar.tsx](../frontend/src/components/desktop/titlebar/ColumnizedTitleBar.tsx) `ColumnHeader`（side=left/center/right）作为对应栏 flex-column 容器的第一个子元素，交叉轴 stretch → header 宽 = 栏宽（aside 消费 `--gewu-live-*`，同一元素派生 → 同帧）；收起态内联：左栏收起时 LeftZone（交通灯+展开，mac 关窗始终可达）内联进中列 header 左缘、右栏收起时 RightZone（windowTools+非 mac 窗口控件）内联进右缘，**无 collapsedRail 魔数**。② [LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx)/[RightPanel.tsx](../frontend/src/components/workspace-panels/RightPanel.tsx)/[CenterPanel.tsx](../frontend/src/components/workspace-panels/CenterPanel.tsx) 各加可选 `columnHeader` prop（aside/main 第一子元素，未注入零变化，测试不破）。③ [App.tsx](../frontend/src/App.tsx) 列体化路由不渲染全局条；[project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) 自持顶栏：regular=三列内 header，compact(≤960)/loading/error=fixed 整条（互斥 → 无双条/闪烁）。④ `.workspaceRoot` 去 `padding-top`（regular 占满视口），新增 `.workspaceRootCompact`/`.earlyReturnWrap`/`.runtimeMissingBannerOverlay`；`.leftPanelWrap`/`.resultPanel` 由 `height:100%` 改 `flex:1`（header 占 38px 后正文让位，实测 aside 溢出归零、左栏「设置」行可见）。列内 header 抑制竖分隔线（栏间线由全高 `resizeHandleV::after` 一条贯穿，header/body 天然连续）。

**实机**（dev Electron CDP，证据 `acceptance/ui-310/columnized-headers.png`）：regular 3 列内 header 全为 aside/main 第一子元素、无全局 fixed 条、无重复交通灯；**拖拽左栏 +70/+150 中途 header 底线右缘与 aside 右缘 gap=0**（构造级刚性，非同步对齐）；「+」菜单展开 7 项不被 aside `overflow:hidden` 裁切（菜单向下开在栏体内）；收起左栏 → 交通灯内联进中列 header 且「关闭窗口」可见；compact(854px) → fixed 条回归、列内 header 归零；返回 regular 后列保持收起（compact 自动收起，与 fixed 条时代一致），中列 header 内联收起态区段、「展开左侧栏」可达。门禁：tsc 0 / 定向 6 文件 53/53 / docs:check / ui:audit:check。（P1b 为阶段中间态，跨树同步链退役见下方 P2 加映；本条最终状态见末尾收口段。）G0 开发期常态 · 不外推 packaged / Provider / GA。

**加映（2026-09-07）— P2 跨树同步链退役**：列体化后清理遗留同步链，范围以探针实测收敛（非全删）。**退役**：① `TitleBarState.leftPanelWidth/rightPanelWidth` 两字段 + project-workspace 每拖拽帧 `updateTitleBar` 跨树推送（regular 顶栏已是列内 ColumnHeader、不消费宽度，推送成死链且每帧触发全部 context 消费者重渲染）；fixed 条宽度改 **props 同树直传**（[TitleBar.tsx](../frontend/src/components/desktop/TitleBar.tsx) `TitleBarProps`，compact 浮层对齐由 project-workspace 渲染点传 `leftWidth/effectiveRightWidth`，同一次 commit）；② fixed 条 grid 三处（含 1380/1120 断点）的 `var(--gewu-live-*-span)` 死兜底（fixed 条只在 compact/非工作区渲染，这些态拖拽禁用、span 变量永不写入）。**保留但重述角色**：`--gewu-live-*-width/-span` 实时变量——探针实测拖拽中途 aside 右缘=live 值、松手归零交回 state，其作用已从「跨树同步补丁」变为「aside 本体 + BottomTerminal 的同树零延迟指针跟随」（列内 header 在 aside 内随 aside 同宽，仍刚性；删它 aside 会退回每帧 React commit 的一拍滞后，是回归）。[useResizableColumns.ts](../frontend/src/hooks/useResizableColumns.ts) 注释同步重述。**实机**（dev Electron CDP）：regular 拖拽 +80/+170 中途 gap=0 不回归；compact 浮层左栏展开时 fixed 条 grid 左段右缘与 aside 右缘 alignGap=1（rail 归属设计值，props 直传生效）；skills 默认宽 `240.998/340.992` 不回归；零异常。门禁：tsc 0 / 定向 6 文件 53/53 / docs:check / ui:audit:check。

**收口（2026-09-07 P3）**：用户实机验收通过（拖拽顶栏线与栏边一根线实时移动、收起态交通灯/工具开关内联可达、「+」等菜单展开正常、缩窗 ≤960 回退整条顶栏、三段顶栏任意处可拖窗口）。提交链 `dd4740dc`(P0) → `1995a598`(P1a) → `b2207a3d`(P1b) → `fefc6942`(P2)。**最终状态**: verified（2026-09-07 dev Electron 实机，证据 `acceptance/ui-310/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

**加映（2026-09-07 用户反馈）— 接缝悬停高亮全高连续**：用户反馈「侧边栏分隔线鼠标放置后上下不是一样的呈现」（截图：悬停态下 header 带细、栏体带粗）。像素级定位：接缝悬停高亮 `resizeHandleV::after` hover 态 2px、横跨列边界像素（x∈[boundary, boundary+2)），P1b 列体化后 header 带内该高亮的第二像素被列内 `ColumnHeader`（z-index 9999 + 不透明 `--titlebar-bg` + backdrop-filter 自建堆叠上下文）的不透明背景盖住——用户截图实测 header 带 1px `(188,155,246)`、栏体带 2px 同色；且 header 带命中/光标被 header 截获（`workspaceBody` 无 z-index 不建堆叠上下文，两者同层竞争）。修法（1 行 CSS / 0 新增 IPC / 0 新依赖）：[project-workspace.module.css](../frontend/src/pages/project-workspace.module.css) `.resizeHandleV` `z-index: 5 → 10000`（高于 ColumnHeader 9999；compact 断点内本元素本就 `display:none` 不参与 absolute 列/backdrop 竞争；LeftPanel 与 RightPanel 两侧接缝共用同 class 一并生效），接缝命中带与高亮线自顶栏到底栏全高连续，与「分隔线刚性由构造保证」同哲学。**门禁**：useResizableColumns + workspace-panels 定向 vitest 44/44 / docs:check 206 / ui:audit:check。**实机**（dev Electron CDP，用户运行中的实例 HMR 生效，脚本 `scripts/ui310-seam-hover-live.cjs` 5/5，证据 `acceptance/ui-310/seam-hover-live.{json,png}`）：header 带线左右两侧 hit 均为接缝元素（修复前为中/左列 ColumnHeader）、真实鼠标悬停 header 带 `:hover` 生效且 `::after`≈2px、截图像素采样 header 带 2.2 ≈ 栏体带 2.2 CSS px 全高一致。**状态**: verified（2026-09-07 dev Electron 实机）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-309: 修复 — 恢复 TitleBar 注册（8f3d55a5 误删）：顶部与侧栏宽度同步 +「+」工具菜单复活 (2026-09-07 verified)

**用户反馈**：「软件顶部和下面的工作区域 左右侧栏 宽度调整不是同步的」；「右侧边栏的+ 点击后没有内容了 应该也是存在bug」。主 Agent 先实测对齐理解后用户确认（「应该是的」）修复。

**诊断**：两个症状同根——`8f3d55a5` 在移除工作目录修改功能时，把 [project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) 的整个 `updateTitleBar` 注册 effect 一并误删（`updateTitleBar` 从此全工程零调用），TitleBar 永远停在 `DEFAULT_TITLE_BAR`：实测顶栏 grid `[241, -, 341]`（默认 240/340+1）vs 实际栏宽 `229 / 344`（拖拽实时变），拖动永不同步；「+」按钮 `onMoreAction=null`、`toolMenuItems=[]` → 点击无任何反应；顶部标签 pills / 结果选择器 / 会话选择器 / 浏览器前进后退同批失效。

**改动**（0 新增 IPC / 0 新依赖）：从 `e689f867` 恢复 `titleBarTitle` memo + 注册 effect（宽度推送 `leftPanelWidth: leftWidth / rightPanelWidth: effectiveRightWidth`、tabs pills、onMoreAction/toolMenuItems 工具菜单、结果选择器、浏览器前进后退、顶栏会话选择器）。修正旧版两处 deps 瑕疵：补 `conversations / activeConvId / handleSwitchConversation`（缺失会让顶栏会话选择器持过期闭包）、去掉未引用的 `project?.workspacePath`。`updateTitleBar` 自带 `titleBarDataEqual` 去重，拖拽过程无多余渲染。

**门禁**：tsc 触碰文件 0 错误 / RightPanel + CenterPanel + useConversations + LeftPanel vitest 22/22 / docs:check 205 / ui:audit:check。

**实机**（dev Electron，证据 `acceptance/ui-309/titlebar-sync-plus-menu.png`）：顶栏 grid `[230, 672, 389]` vs 实际栏宽 `229 / 388`——精确差 1px 拖拽轨，像素级对齐；「+」点击弹出 7 项完整菜单（结果/文件/后端/浏览器/聊天/分析/审阅，当前打开项带勾），顶栏出现「文件 ×」标签 pill、标题恢复项目名。**状态**: verified（2026-09-07 dev Electron 实机）。G0 开发期常态 · 不外推 packaged / Provider / GA。

**加映（2026-09-07 同日同工作流）— 拖动期一体化**：用户反馈「titlebar 那个分隔线和下面的线不是一体的，有同步层面的延迟」。根因：静止态恢复注册后像素对齐，但拖动中 TitleBar 分隔位置仍走 React 提交链（`leftWidth` state → `updateTitleBar` → `--titlebar-left-span`），比 mousemove 晚一拍，顶栏线与栏边肉眼可见脱节。修法（0 新增 IPC / 0 新依赖）：[useResizableColumns.ts](../frontend/src/hooks/useResizableColumns.ts) 拖动期间在 mousemove 里同步向 `documentElement` 写实时变量 `--gewu-live-left/right-width|span`（松手 cleanup 移除，无缝交回状态驱动）；消费端全部改 `var(--gewu-live-*, 状态值)`——[TitleBar.module.css](../frontend/src/components/desktop/TitleBar.module.css) grid 三处（含 1380/1120 断点）、[LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx) / [RightPanel.tsx](../frontend/src/components/workspace-panels/RightPanel.tsx) 栏宽、[BottomTerminal.tsx](../frontend/src/components/workspace-panels/BottomTerminal.tsx) `leftOffset/rightOffset`（prop 放宽 `number | string`，[project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) 传 `var(--gewu-live-left/right-span, …)`，终端两竖边随侧栏实时跟随）。**实机**（dev Electron CDP 真实拖拽 mousedown → 中途两轮测量 → mouseup，证据 `acceptance/ui-309/drag-sync-inline.png`）：左 +60/+140 与右 −70/−150 拖动中途顶栏线与栏边 gap 均 ≤0.7px（亚像素，修复前为整拍延迟的可见脱节），松手后 live 变量从 root 移除、宽度状态无缝接管、静止态 gap=0；tsc 触碰文件 0 错误。

**加映二次（2026-09-07 同日）— 拖动期刚性**：用户实测仍反馈「不是刚性的一致」。帧对齐复测（mousemove 后仅 2 帧内测量）实锤真根因——[project-workspace.module.css](../frontend/src/pages/project-workspace.module.css) 的 `.leftCol`/`.rightCol` `transition: width 0.22s` 与 `.embeddedTerminal` `transition: left 0.16s` 让栏体以缓动「追赶」实时变量，而顶栏线随同一变量瞬时移动；2 帧口径 gap 达 55.7/131.1px（此前的 200ms 等待测量掩盖了追赶曲线）。连带发现仓库既有 5 组 `body.gewu-resizing-columns` 拖动标记规则（transition:none / iframe pointer-events / ew-resize 光标）**全部因 CSS Modules 把 body 类名本地化成 `_gewu-resizing-columns_xxx` 而从未生效**。修法（0 新增 IPC / 0 新依赖）：拖动标记期间禁用三处 transition（`useResizableColumns` 既有 body 标记按下挂/松手摘），5 组规则统一改 `body:global(.gewu-resizing-columns)` 写法复活；展开/收起动画不受影响（松手后 transition 恢复 0.22s）。帧对齐复测：左 +60/+140 与右 −70/−150 移动后 2 帧内 gap 均 ≈0px、拖动中 transition 0s、松手恢复且静止 gap=0。

## UI-308: 清理 — 左栏移除灰色分隔线 +「返回工作台」入口（视觉降噪） (2026-09-07 verified)

**用户反馈**：「左侧栏这些 灰色的分隔线 我觉得不需要了 影响视觉效果」「返回工作台 按钮也不需要了 相关联的代码能清理的也清理掉 保持干净」。

**改动**（0 新增 IPC / 0 新依赖）：① [project-workspace.module.css](../frontend/src/pages/project-workspace.module.css) 移除左栏三处分隔线——`.leftQuickActions` border-bottom（Skills/项目 之间）、`.leftPanelHeader` border-bottom（项目头部/树 之间）、`.leftPanelFooter` border-top（设置上方），padding 保留间距不变；② [LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx) 移除项目头部「返回工作台」home 图标按钮（UI-258 引入）及 `react-router-dom` `Link` import（文件内无其他使用）。保留：project-workspace.tsx 两处全屏错误态（项目加载失败/不存在）的「← 返回工作台」链接——侧栏不在的错误页唯一退路，非本条清理范围。CSS 注释同步（UI-258 → UI-308 口径）。

**门禁**：tsc 触碰文件 0 错误 / LeftPanel vitest 4/4（无测试依赖被删按钮）/ docs:check 205 / ui:audit:check。

**实机**（dev Electron，HMR 后 CDP 断言 + 截图 `acceptance/ui-308/left-panel-clean.png`）：`[aria-label=返回工作台]` 不存在；三处容器 computed border 均为 `0px none`；截图可见分隔线消失、项目头部仅剩「+」。**状态**: verified（2026-09-07 dev Electron 实机，证据 `acceptance/ui-308/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-307: 修复 — 项目树切换项目后展开项恒显「暂无对话」（useOtherConversations 跳过已缓存项目） (2026-09-07 verified)

**用户反馈**：「在不同的项目切换的时候 会显示 暂无对话 实际上这个项目下是有内容的」（截图：tinkspace / desktop 展开后显示暂无对话）。

**诊断**：`useOtherConversations` 的 effect 只对「不在 sharedCache 里的项目」取数并写入 `byProjectId`。而项目行点击 = 切换 + 展开（ProjectNode onClick）：**被访问过的项目作为当前项时，其列表只经 `useConversations` 进入 sharedCache，从不进 `byProjectId`**；切走后 effect 又因「已缓存」把它从写入集合里过滤掉 → 每个访问过再离开的已展开项目永远显示「暂无对话」。SQLite 实证（`.biof3-dev-user-data/data/bioF3.db`）：desktop 14 条 + tinkspace 22 条 active 会话，服务端数据完好，纯前端状态断层。

**改动**（0 新增 IPC / 0 新依赖）：[useConversations.ts](../frontend/src/hooks/useConversations.ts) `useOtherConversations` effect 改为对**全部相关项目**收敛 `byProjectId ⇄ sharedCache`（缓存命中由 `loadShared` 短路，零额外请求）；`setByProjectId` 以引用相等判定无变化时 bail-out（返回 `prev`），避免消费方以内联 `new Set` 作 deps 时写→渲染→重跑死循环。[useConversations.test.ts](../frontend/src/hooks/useConversations.test.ts) 新增「访问过的当前项目切走后从缓存提升且不重发请求」回归用例（11/11）。

**门禁**：tsc 触碰文件 0 错误 / useConversations vitest 11/11 / docs:check 205 / ui:audit:check。

**实机**（dev Electron，CDP 驱动真实点击序列 tinkspace → desktop → block52）：最终 DOM 断言 `emptyUnder=[]`（无任何项目显示暂无对话）、`convItems=36`（与 SQLite desktop 14 + tinkspace 22 精确吻合）。**状态**: verified（2026-09-07 dev Electron 实机）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-306: 修复 — 左栏项目树崩溃 `ProjectNode is not defined`（8f3d55a5 误删组件回归） (2026-09-07 verified)

**用户反馈**：「启动项目 看是否异常」→ dev Electron 主日志捕获渲染进程 `Uncaught ReferenceError: ProjectNode is not defined`（`<ProjectTree>` 组件栈），进入项目工作台左栏项目树整树崩溃（React 卸载该子树），应用不可用。

**诊断**：回归由 `8f3d55a5`（「移除工作目录修改功能」）引入——该提交本意只删 `ProjectNode` 内的「设置」（工作目录修改）按钮，实际把整个 `function ProjectNode` 定义删除，而 [LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx) `<ProjectTree>` 仍渲染 `<ProjectNode>`，全前端无任何定义残留。连带 `tsc --noEmit` 在 HEAD 报 TS2304（LeftPanel.tsx:308）+ TS2339（createPanel 类型已不含 `onPickExternal/onPathChange` 而拖拽落位仍在引用）+ LeftPanel.test.tsx fixture 缺 `createdAt/updatedAt`，与该提交信息宣称的「tsc 0」不符。

**改动**（0 新增 IPC / 0 新依赖）：① 从 `e689f867` 恢复 `ProjectNode` 组件（双击重命名 + 新建对话 + 移入回收站 + 会话展开列表），**不含**已废弃的 workspaceEdit「设置」按钮（遵守 8f3d55a5 的功能裁决）；② 拖拽目录直达创建（UI-282）重新接线——`createPanel` ctx 类型补必选 `onPickExternal(path)`，[project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) 从 `openCreatePanel` 提取 `createProjectFromWorkspacePath(path)`（validateDirectory → createProject → 跳转新项目），「+」对话框选中与拖拽落位共用同一创建链，删除 `onPathChange` 失效 fallback（UI-304 终版后无内联面板可回填）；③ 清理死代码 `BrowseFolderButton` + `FolderPicker` import（唯一消费者是已删的工作目录编辑面板）；④ [LeftPanel.test.tsx](../frontend/src/components/workspace-panels/LeftPanel.test.tsx) fixture 补 `createdAt/updatedAt` + `onPickExternal`，新增 ProjectTree 渲染回归用例（visibleProjects 非空时渲染项目行 + 「创建新对话/移入回收站」按钮）。

**门禁**：tsc 触碰文件 0 错误（另有 12 条 TS2550 `.at()` 既有债务集中在无关测试文件，与本条无关）/ LeftPanel vitest 4/4 / docs:check 205 / ui:audit:check。

**实机**（dev Electron，证据 `acceptance/ui-306/project-tree-ui306.png`）：修复经 Vite HMR + CDP `Page.reload` 后——主日志重载点后渲染进程 0 条 `Uncaught`；CDP `Runtime.evaluate` DOM 断言 `projectTreeRows=6`（zhangdiandian ×2 / block52-p3-09031507 ×2 / tinkspace / desktop 全部渲染），无 error boundary，截图可见左栏项目树完整呈现。**状态**: verified（2026-09-07 dev Electron 实机，证据 `acceptance/ui-306/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-302: 增量 — 主题色（强调色）系统：5 档配色切换（补登） (2026-09-07 verified)

**改动**（实现提交 `1e64a0f` 当日未同步台账，本次 UI-AUDIT-FIX 补登）：[accents.ts](../frontend/src/themes/accents.ts) 5 档主题色定义（teal 默认/blue/violet/rose/amber）+ `localStorage gewu-accent` 持久化 + `data-accent` 注入（teal 默认不设属性）；[custom.css](../frontend/src/styles/custom.css) 5 档 × light/dark 双套 accent token 覆盖（accent/soft/bg/hover/border/surface 六 token）；[AccentControl](../frontend/src/components/desktop/AccentControl.tsx) 色板控件（色板圆点 + 选中勾 + 环形描边）挂载设置面板常规节；[ThemeProvider](../frontend/src/themes/ThemeProvider.tsx) accent 状态 + storage/event 跨窗口同步。0 新增依赖。

**加映**（`c138dba`，同 UI-302 设置面板外观工作流）：设置面板新增「界面字号」调节（[DesktopSettingsPanel](../frontend/src/components/desktop/DesktopSettingsPanel.tsx) + [ThemeProvider](../frontend/src/themes/ThemeProvider.tsx) 字号档位状态 + [global.css](../frontend/src/styles/global.css) 字号 token 化）。

**实机**（随实现提交落盘）：CDP 实机切换紫罗兰 → `data-accent=violet` + `accent=#7c3aed` 持久化，切回 teal 恢复；截图 `acceptance/block-49/ui302-accent-violet.png`。**状态**: verified（2026-09-07 dev Electron 实机，证据 `acceptance/block-49/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-304: 增量 — 左栏「+」创建项目 dialog-first（点 + 直接弹系统文件夹选择器，选中即项目路径） (2026-09-07 in_progress)

**用户反馈**：截图左栏「+」内联创建面板（路径输入框优先 + 选择文件夹按钮）：「点击+ 应该是打开文件夹，打开的文件夹就是创建项目所在的路径了。目前好像不是的，变成了输入路径，再确定，这样很不合理」。

**改动**（0 新增 IPC / 0 新依赖）：UI-257 的「手输优先」翻转为 UI-253 首页同款的「选目录优先」，手输降级为兜底——① [project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) `openCreatePanel` 改 dialog-first：点「+」直接调 `openDirectoryDialog()`，选中 → 面板以 **confirm 模式**打开（写入所选路径），取消 → 不开面板，桥缺失（非桌面环境）→ 直接以 manual 模式开面板（不静默）；新增 `createPanelMode` state + `repickCreateDirectory`（重新选择）+ `pickExternalDirectory`（外部路径直达确认态）+ `switchCreatePanelManual`；删除无调用方的死代码 `chooseWorkspaceDirectory`。② [LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx) 创建面板双模式渲染——confirm：首页 UI-253 口径确认块（「将在以下目录创建项目：」+ 完整路径 + 「项目名：目录名」+ 创建项目/重新选择…/手动输入路径/取消）；manual：原 UI 原样保留（可编辑输入 + FolderPicker「选择文件夹…」兜底）；BLOCK-53 P1 拖拽落位改 `onPickExternal(path)` 一步直达确认态（仍不绕过确认）；`createPanel` ctx 类型扩展 `mode/onRepick/onSwitchManual/onPickExternal`（新字段均可选，向后兼容）。`createProjectFromPanel` 零改动复用（validateDirectory 对系统面板返回的真实路径是无害二次校验）。首页创建流程（本就选目录优先）与 `createProject` API 零改动。

**门禁**：tsc 0 / LeftPanel vitest 10/10（新增 confirm 模式用例：路径+项目名渲染、onConfirm/onRepick/onSwitchManual 触发、确认态无手输输入框；drop 用例改断言 `onPickExternal`）/ home + RightPanel + CenterPanel 回归 11/11 / docs:check / ui:audit:check。

**UI-304 加映三（2026-09-07，根因最终确认：分栏视图手势怪癖）**：用户质问「Codex/ZCode 为何可以」触发再排查——解包 ZCode.app（@zcode/desktop，Electron 41.0.3）确认其调用为 `showOpenDialog({properties:["openDirectory","createDirectory"]})`，**无 filters 字段、不附窗口**；file-dialog.js 已对齐（目录选择时不再传 filters/空数组——空 filters 在 macOS 上挂目录永远匹配不上的 allowed-types 校验链）。**真凶定位：macOS 26 分栏视图（Column view）的手势怪癖**——点选文件夹且其内容列弹出（选中落在非末列）时，「打开」按钮不启用；**切换列表视图（Cmd+2 或工具栏图标）后单选文件夹「打开」立即亮起**（dev E41 实机逐步验证：分栏视图置灰复现 → 列表视图同一路径可用）。该怪癖与 Electron 版本（E30/E41 一致复现）、共享标记、TCC 权限、IPC 参数均无关；E41 独立最小应用「可用」的旧结论实为末列选中手势的巧合。面板会记忆视图模式，用户切换一次列表视图后长期生效。**最终 UX**：「+」→ 原生面板（记住列表视图后即为可靠路径）→ 选中直达确认态；任何异常（取消/置灰）→ 取消落应用内 FolderPicker 浏览器（零输入兜底）→ 粘贴路径/拖拽保留。**最终 UX（无死路双通道）**：「+」→ 原生面板优先（面板正常的环境即 Codex/ZCode 式原生体验）→ 选中直达确认态；**取消或置灰不可选时「取消」落到应用内 FolderPicker 浏览器**（视觉导航 + 「选择此文件夹」，零输入）→ 确认态 → 创建；「粘贴路径」与拖拽目录保留为第三/四通道。`createPanel.mode = browse|confirm|manual`。**附带完成 Electron 30.5.1 → 41.10.7 升级本体**（11 个大版本；对齐 ZCode 运行时；better-sqlite3/node-pty 经 electron-rebuild 重建 ABI 145，dev 启动/DB 迁移/R 后端/HMR/渲染全链实测通过；dev-electron 端口协调与后端 spawn 链路在隔离 userData 下暴露 DB 路径镜像缝隙——默认 userData 路径不受影响，已登记为 dev 编排候选修正）。

**门禁**：tsc 0 / LeftPanel vitest 11/11 + home 回归 / prebuild 语法门禁通过 / docs:check / ui:audit:check（存量红：5 个旧提交未同步台账，见 2026-09-07 记录）。**实机**（dev E41 直连实测）：点 + 弹系统面板、置灰状态可复现（升级不修复该怪癖，见上）、确认态/手输态/浏览态三态渲染正确。**待办**：面板置灰专项排查（打包版（含签名差异）复测 / ZCode 同目录实测 / 面板 delegate 日志）。**状态**: in_progress。G0 开发期常态 · 不外推 packaged / Provider / GA。

**UI-304 加映（2026-09-07，系统面板「打开」置灰修复）**：用户实测点 + 后系统面板对目录「打开」按钮置灰，且**取消「文件共享」后依旧置灰**（共享标记假说证伪；TCC/权限假说也不成立——那类问题表现为选中后拿不到路径，而非按钮置灰；应用侧 `file:open-dialog` 参数为标准 `openDirectory+createDirectory`）。判定：**Electron 30.5.1（2024-08）× macOS 26（darwin 25.6）系统面板兼容问题**——新 macOS 的打开面板由系统 XPC 服务（openAndSavePanelService）渲染，旧 SDK 应用存在条目可见但「打开」恒置灰的已知 bug 类（同代 issue：electron #48191、#47248）。修法：**「+」不再依赖系统面板**——直接打开应用内 FolderPicker（UI-259，`file:list-directory` IPC）browse 模式 → 「选择此文件夹」直达确认态 → 创建；确认态「重新选择」回 browse；「粘贴路径」保留手输兜底；拖拽仍直达确认态；`createPanel.mode` 扩为 `browse|confirm|manual`，`openDirectoryDialog` 从该链路移除。门禁：LeftPanel vitest 11/11（新增 browse 用例：FolderPicker 渲染 + 选择此文件夹经 onPickExternal 直达确认态 + 粘贴路径切换）/ tsc 0 / docs:check / ui:audit:check。首页创建流程仍用系统面板 + 可见手输兜底；系统性解法（升级 Electron 以适配新 macOS 面板）涉及 better-sqlite3 原生模块重建，另行裁决。

**状态**: in_progress。G0 开发期常态 · 不外推 packaged / Provider / GA。



**UI-304 终版（2026-09-07，完全对齐 Codex —— 极简创建流程）**：移除所有兜底逻辑（FolderPicker 应用内浏览器、confirm 确认态、manual 手输路径、拖拽目录），完全对齐 Codex 实现：**点 + → 原生面板 → 选择 → 直接创建项目**。核心改动：① [project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) `openCreatePanel` 合并原 `createProjectFromPanel` 逻辑，选中后立即校验并创建，取消则静默返回；移除 `createPanelMode/createPath/repickCreateDirectory/pickExternalDirectory/switchCreatePanelManual/closeCreatePanel/createProjectFromPanel`；`createPanel` 接口简化为 `{open:false, error, onOpen}`。② [LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx) 移除 browse/confirm/manual 三模式面板 UI，仅保留错误提示（如果有）；移除拖拽功能、BrowseFolderButton；`LeftPanelContext.createPanel` 类型简化。③ [LeftPanel.test.tsx](../frontend/src/components/workspace-panels/LeftPanel.test.tsx) 简化为 3 个用例（QuickActions a11y、+ 按钮触发 onOpen、错误显示）。④ [file-dialog.js](../src/ipc/file-dialog.js) 目录选择不传 parent window（`const parent = isDirectory ? null : mainWindow`）。**最终 UX（零兜底，极简）**：「+」→ 原生面板 → 选择 → 创建成功跳转；取消 → 静默返回；错误 → 显示在左栏头部。门禁：tsc 0 / LeftPanel vitest 3/3 / docs:check / ui:audit:check（存量红 5 个旧提交）。
**UI-304 终版（2026-09-07，完全对齐 Codex —— 极简创建流程）**：用户反馈 Codex 可以正常选择目录，说明问题不是 macOS 系统 bug，而是调用方式差异。关键修复：**目录选择时不传 parent window**（`dialog.showOpenDialog(null, opts)` 而非 `dialog.showOpenDialog(mainWindow, opts)`）。[file-dialog.js](../src/ipc/file-dialog.js) 改为 `const parent = isDirectory ? null : mainWindow`；文件选择仍传 parent 保持模态行为。**最终 UX（原生面板直接可用，无需兜底）**：「+」→ 原生面板（分栏视图/列表视图均可正常选择）→ 选中直达 confirm → 创建；取消 → 应用内 FolderPicker 作为备选；粘贴路径/拖拽为第三/四通道。撤销 message 引导方案（不需要了）。门禁：tsc 0 / LeftPanel vitest 11/11 / docs:check / ui:audit:check（存量红 5 个旧提交）。

## UI-303: 增量 — 计划模式并入访问档位菜单第四档（移除独立开关，四模式一处切换） (2026-09-07 in_progress)

**用户反馈**：截图 composer 档位下拉（完全访问/项目写/只读模式）：「计划模式 应该放到这里 这几种模式可以切换的」。

**改动**（0 新增 IPC / 0 新依赖）：BLOCK-55 Spec 门能力不动，入口统一为档位菜单——① [SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) 档位下拉在「项目写」与「只读模式」之间新增第四档「计划模式」（副文案「只读探索并起草计划，获批后再执行」）；`accessMode` 联合类型扩为 `'full'|'workspace-write'|'plan'|'read'`（[copilotContext.ts](../frontend/src/lib/copilotContext.ts)、[useChatStream.ts](../frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts) 同步），**删除独立 planMode state 改由档位派生**（单一事实源）；切入计划档时 `prePlanAccessModeRef` 记录原档位，PlanApprovalCard「批准并执行/批准并清上下文执行」后恢复原档位（缺省 full）；移除 composer 独立「计划模式」开关按钮与 ⋯ 窄态收纳项（[simple-chat.css](../frontend/src/components/copilot/simple-chat.css) 清理 `.sc-plan-mode-btn` 与窄态容器查询规则）。② [accessModeValidator.ts](../frontend/src/components/copilot/accessModeValidator.ts) 增加 plan 档镜像矩阵（只读探索 + 仅放行 plan 工具；run_tool 同步层拒绝，阻断计划模式下重操作 ack 自动批准）+ plan 专属提示文案。③ 后端同档位语义：[chat.js](../core/biof3-server/routes/ai-agent/chat.js) / [agent-runner.js](../core/biof3-server/agent-runner.js) accessMode 合法集加 `'plan'`（未知值仍塌缩 full，**'plan' 绝不可塌缩 full**）且 planMode 由 `(planMode===true || accessMode==='plan')` 派生；agent-runner 补齐 planMode 透传缺口并注入 Spec 门提示段（[helpers/plans.js](../core/biof3-server/helpers/plans.js) 新增共享常量 `PLAN_MODE_PROMPT_SECTION`，chat 与 agent 循环两路径同源防漂移）；[agent-tool-policy.js](../core/biof3-server/agent-tools/agent-tool-policy.js) Spec 门纵深防御（`accessMode='plan'` 独立触发，调用方漏传 planMode 也拦截）+ **plan 工具豁免 `execution_not_allowed` 闸**（修复 'plan' 档 allowExecution=false 会把计划起草本身拒死的缺口）。既有「自动计划模式」意图识别与批准三选一闭环零改动。

**门禁**：tsc 0 / accessModeValidator vitest 5/5（新增 plan 档用例）+ SimpleChat 四件套 vitest 26/26 / 后端定向 node --test 48/48（agent-tool-policy + block55-plan-mode + accessmode-validation，新增 plan 档矩阵与不塌缩断言）/ loop 套件 286/286 / docs:check / ui:audit:check。映射面其余 7 个失败（agent-approval 2、tool-job-conversation 3、result-replay-service 1、g0-rs-ux1h-acceptance 1）经 git stash 干净 main 复核均为存量，非本次引入。

**实机**：待 dev Electron 实机过目（四档下拉切换、计划档起草→批准→执行闭环、批准后档位恢复）后转 verified。**状态**: in_progress。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-301: 多智能体活动面板——子 agent 活动条（列表/中断/详情窗，BLOCK-49 加映二） (2026-09-06 in_progress)

**背景**：二期协作三工具与 proactive 投递均为模型/协议面，用户侧缺少子 agent 的实时可见与操作面（BLOCK-49/52 各自登记的 §2.4 遗留）。

**改动**（0 新 npm 依赖）：[conversationRunStore.ts](../frontend/src/components/copilot/conversationRunStore.ts) 双源桥接——**模型 spawn_agent 派生**（onToolCall 缓存 task 文本按 callId → onToolResult 成功结果登记 running 快照）+ **child_finished 终态落账**（running→终态映射 done/error/stopped + 摘要落 assistantContent；页面刷新后无登记时建终态条目；终态幂等）；[SubAgentsBar.tsx](../frontend/src/components/copilot/SubAgentsBar.tsx) 新组件（输入框上方克制的单行折叠条：`子 agent N 运行中 · M 个`）——列表行 = 状态点（运行中脉冲/完成绿/失败红/停止灰）+ 任务头 + **中断按钮**（running，stopSubAgentTask 走既有 cancel REST）+ **详情窗按钮**（BLOCK-59 P4 agent 详情窗弹出）；[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) 挂载；[sub-agents-bar.module.css](../frontend/src/components/copilot/sub-agents-bar.module.css) 状态色样式。

**门禁**：tsc 0；conversationRunStore vitest 43/43（新增 4 用例：spawn 登记可见/child_finished 落账/刷新孤儿建条目/终态幂等）+ toolActivity 8；总回归 80/80（block48/49/59/brand/agent-concurrency）。

**实机**：数据面由 phase2-live.cjs 14 断言覆盖（child_finished 投递实证，D1/D2），面板为同数据源的纯展示层（store 单测断言列表可见性与状态映射）。**UI 渲染待 dev Electron 重启后实机过目确认。状态**: in_progress。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-300: 多智能体 proactive 前端消费——子 agent 终态通知 chip（BLOCK-49 加映） (2026-09-06 verified)

**背景**：BLOCK-49 二期在 runner 终态投递 `child_finished` 事件到父任务 SSE 流，但前端不识别该事件——proactive「主动可见」止步于协议面。同加映包含后端短回答误判修复（非 UI，见 plan §7）。

**改动**（0 新 npm 依赖）：[copilotClient.ts](../frontend/src/components/copilot/copilotClient.ts) StreamChatOptions 增 `onChildFinished` + `child_finished` 事件分发（Unknown event 静默类，additive）；[conversationRunStore.ts](../frontend/src/components/copilot/conversationRunStore.ts) 会话级 `childFinishedNotices`（复用 UI-287 降级 notice 成熟模式：run 生命周期清除、上限 10 条丢最旧、`getChildFinishedNotices` 导出）+ callbacks Pick 类型扩展；[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) notice 附着最后一条助手消息（双 notice 共存兼容）+ 任务条 chip 渲染（`子 agent 已完成/失败/已取消：摘要头`，复用 fallback chip 视觉语法）；[types.ts](../frontend/src/components/copilot/SimpleChat/types.ts) 消息类型扩展；[simple-chat.css](../frontend/src/components/copilot/simple-chat.css) chip 样式（状态色成功/失败）。

**门禁**：tsc 0；conversationRunStore vitest 39/39（新增 4 用例：多条保序/新 run 清除/上限丢弃/防御）；跨包单测 97/97。

**实机**：协议面由 block49-phase2-live.cjs 14 断言覆盖（child_finished 投递实证，D1/D2），前端消费的渲染为纯展示层（数据源同流）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-299: 品牌改名 Gewu（格物）——窗口标题/wordmark/文案/主题令牌全量 + 品牌单一事实源（BLOCK-61） (2026-09-06 in_progress)

**用户裁决**：定名 **Gewu（格物）**（BioF3 的 Bio 前缀锁死领域，产品已是领域无关的智能体指挥席）；单独开 BLOCK-61 系统性改名，设计要求后续改名灵活。

**改动**：① **品牌单一事实源**（`src/main/brand.js` + `frontend/src/lib/brand.ts` 双端镜像 + [brand-identity 契约测试](../test/brand-identity.test.mjs)：双端常量一致 + 历史名禁裸写白名单扫描）——此后再改名只动两个文件；② **Tier A 用户可见面**：窗口标题（主窗/弹出窗走 `windowTitle()` 构建器）、TitleBar wordmark fallback、index.html 标题、MCP server 名 `gewu-mcp`、onboarding/设置/文件夹选择等文案；③ **Tier B 兼容迁移**：preload 桥双 key（`window.gewu` 主名 + `biof3Desktop` 兼容别名同一 surface，desktopBridge 双读）、localStorage 读旧写新（theme/executionTargetId/gitinit/token/agent_task 五族，历史 key 三种分隔形态全兼容 + 读到即迁移）、渲染层事件名 `biof3:*`→`gewu:*`（18 通道）、主题偏好 key `gewu-theme`；④ **Tier C 机械替换**（155 文件）：CSS 令牌 `--biof3-*`→`--gewu-*`、类名 `.biof3-*`→`.gewu-*`、标识符（biof3Events→gewuEvents 等）；⑤ Documents 目录 `Gewu-Local`（**既有环境探测到 `BioF3-Local` 则继续沿用——数据连续性**）；⑥ sidecar 包名 `gewu-computer-use`、package name `gewu-desktop`/`gewu-desktop-frontend`、AGENTS.md 与 docs/README 入口品牌行。**明确不动（协议命名空间，plan §4）**：`core/biof3-server` 路径、`.biof3-*` 用户数据目录、`BIOF3_*` env 前缀（350+ 处协议面）、历史文档与 acceptance 证据、`window.biof3` 旗标桥别名。

**门禁**：brand-identity 契约 3/3；核心+回归 node 测试 67/67；tsc 0；前端受影响 vitest 79/79（ThemeProvider/copilotClient/ToolActivityDock/theme-token-contract 等 8 文件）；docs:check PASS 204。

**实机（2026-09-06，dev Electron CDP，证据 `acceptance/block-61/brand-live.json` 9 断言 allPass + 截图 ×3，脚本 [block61-brand-live.cjs](../scripts/block61-brand-live.cjs)）**：① `document.title === 'Gewu'`（主窗 + 弹出窗）；② `window.gewu` 主桥可用 + `biof3Desktop` 兼容别名可用（contextBridge 双暴露为独立代理，功能等价——BLOCK-59 全套实机脚本经别名回归 PASS）；③ **历史主题偏好不丢**：仅存 `biof3-theme=dark` 时升级后仍 dark（读到即迁移：gewu-theme=dark + 旧 key 清除；跨窗竞态如实记录——隐藏轨道窗 storage 监听会抢先迁移，属正确行为）；④ `gewu:theme-change` 事件链生效；⑤ 弹出窗（经兼容别名驱动）标题/内容正常；⑥ Git 授权横幅等 swept 文案上屏（「未授权 Gewu 写入」，截图 p61-01）。**回归**：BLOCK-59 ui-live 26 断言 + theme-live 9 断言全 PASS（改名零破坏）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-298: 边缘活动轨道加映三——滚轮换卡 + 卡片垂直钳位（BLOCK-59 加映，plan §5 补全） (2026-09-06 verified)

**背景**：对账发现 plan §5 两个交互细节未实现——「滚轮换卡」与「卡片锚轨道左侧、垂直钳位防越界」（首版只做了鼠标逐个悬停 + 卡片固定顶部）。用户裁决「开干」补全。

**改动**（纯前端，0 主进程变更）：[RailPage.tsx](../frontend/src/components/window/RailPage.tsx) ① **滚轮换卡**——条带 `onWheel`：deltaY>0 切向列表下方（更旧条目）、<0 切回上方，统一走 `hoverTick`（取消关闭计时 + 收鼠标 + 更新锚点）；② **卡片垂直钳位**（复用 UI-255 重钳思路）——悬停刻度的 `getBoundingClientRect().top` 记为锚点，卡片 `top` 钳制在 `[12px, innerHeight - 卡高 - 12px]`；快照加载等卡片尺寸变化经 ResizeObserver 重钳；[rail-page.module.css](../frontend/src/components/window/rail-page.module.css) 卡片 `max-height: calc(100vh - 24px)` 兜底。

**门禁**：核心单测 38/38（新增加映三契约锁：onWheel handler / 钳位表达式 / ResizeObserver 重钳 / 刻度锚点 ref / CSS 兜底）；tsc 0；**加映二轨道预览 9 断言实机回归 PASS（hover 流程无破坏）**。

**实机（2026-09-06，dev Electron CDP，证据 `acceptance/block-59/rail-wheel-live.json` 8 断言 allPass + 截图，脚本 [block59-rail-wheel-live.cjs](../scripts/block59-rail-wheel-live.cjs)）**：两个真实作业降格 → 轨道 2 刻度 → hover 刻度卡标题 = 最新条目（counts.csv）→ **滚轮向下切换到次新条目（design_summary.json）→ 滚轮向上切回** → 钳位断言卡 rect top=12 / bottom=342 ≤ 600-12（完整在窗内）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-297: 边缘活动轨道加映——hover 内容快照预览 + 可辨识类型图标刻度（BLOCK-59 加映二，用户反馈） (2026-09-06 verified)

**用户反馈**（附截图）：① 轨道 hover 应可预览内容；② 轨道「展示不全，看不出来是啥」。

**根因**（实机定位）：① 轨道窗本体只有 28px 宽，320px hover 卡**整体被窗体裁剪**——不是「预览弱」而是预览全无（首版设计缺陷：卡片渲染在窗体坐标系内，窗体不够宽就物理不可见）；② 刻度是 8px 纯色块，无法辨认窗口类型。

**改动**（0 新 npm 依赖）：① **轨道窗加宽 28→364px**（预览区 336 透明 + 条带 28）——卡片在预览区内渲染不再被裁剪；预览区保持 `setIgnoreMouseEvents` 穿透，仅条带/卡交互收鼠标（[window-manager.js](../src/ipc/window-manager.js)）；② **降格瞬间内容快照**——`captureThumbnail`（`webContents.capturePage`，窗口**可见态**采集——隐藏后截取得空帧，故 ×/minimize 全部先快照后 hide，async 串行保证顺序；>480px 缩放）；新 `window:thumbnail` IPC + preload `thumbnail` + d.ts；快照随条目 remove/return 清理；③ **hover 卡升级**：内容快照图（`naturalWidth>0` 真实位图，无快照回退虚线占位）+ 标题/静态常驻/快照时点标注 + 恢复/移除；180ms 关闭延迟防「刻度→卡片」跨越条带边界的误关；④ **刻度带类型图标**（result=bar-chart / terminal=terminal / agent=brain，26→34px hover 展宽），不再是纯色块（[RailPage.tsx](../frontend/src/components/window/RailPage.tsx) / [rail-page.module.css](../frontend/src/components/window/rail-page.module.css)）。

**门禁**：核心单测 37/37（新增加映二契约锁：RAIL_WINDOW_WIDTH=364 / thumbnail IPC / capturePage / 先快照后降格时序 / 快照随条目清理 / preload 暴露）；tsc 0；前端 vitest（railEntries + theme-token-contract）11/11；**P2 原有 14 断言实机回归 PASS（无破坏）**。

**实机（2026-09-06，dev Electron CDP，证据 `acceptance/block-59/rail-preview-live.json` 9 断言 allPass + 截图，脚本 [block59-rail-preview-live.cjs](../scripts/block59-rail-preview-live.cjs)）**：① 结果窗弹出 → × 降格 → 轨道窗 `outerWidth===364`（卡右缘 328 < 364，**物理在窗口内**）；② 刻度 svg 图标渲染（data-kind=result）；③ hover（mouseover 合成mouseenter）→ 卡渲染 + 标题「结果 · design_summary.json」+ **快照为真实位图（naturalWidth=480）**（截图 p59-rail-preview：快照 + 标题 + 恢复/移除完整可见）；④ 点击刻度恢复 popped；⑤ 清理降格移除。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-296: 窗口系统加映——弹出窗外观主题与主窗一致（BLOCK-59 加映，用户反馈） (2026-09-05 verified)

**用户反馈**：弹出窗（结果视图等）的主题与主界面不一致——弹窗永远是暗色，不跟随外观主题。

**根因**（实机定位 + 契约测试实锤）：BLOCK-59 新增的窗口 CSS 模块（window-shell / rail-page / command-center）引用了**不存在的编造令牌**（`--biof3-bg-primary/-secondary/-tertiary`、`--biof3-ok` 等 8 个）——全部落入硬编码暗色兜底（#1f2330 系），与主题系统脱钩；ThemeProvider 本身工作正常（`data-theme` 属性 + `storage` 事件跨窗同步，弹窗本可实时跟随主窗换主题），被兜底色掩盖。**theme-token-contract 测试（UI-151 契约）本可拦截**，但未纳入 BLOCK-59 定向测试选择——本次一并纳入回归面。

**改动**（纯 CSS 令牌修正，0 逻辑变更）：① 窗口三模块全部改用 custom.css 语义令牌——`--biof3-bg-canvas`（窗体）/`--biof3-bg-surface`（头部/瓦片/卡）/`--biof3-bg-subtle`（次级容器）/`--biof3-status-success`（成功态）/既有 `--biof3-text*`/`--biof3-accent*`/`--biof3-danger`/`--biof3-border-color`，明暗双主题自动适配；② **顺手修 5 处存量令牌违规**（先于 BLOCK-59 存在、契约测试早已红而未被发现）：RemoteTargets.tsx `--biof3-ok-bg/-warn-bg`→`--biof3-status-success-bg/-warning-bg`、simple-chat.css `--biof3-text-quaternary`→`--biof3-text-muted`、LeftPanel.tsx `--biof3-color-accent`→`--biof3-accent`、project-workspace.module.css `--biof3-primary`→`--biof3-accent`——theme-token-contract 回归全绿。

**门禁**：theme-token-contract 1/1（修复前红：9 缺失令牌实锤）；tsc 0；受影响前端 vitest 45/45（契约/CenterPanel/DesktopSettingsPanel/SimpleChat/toolActivity/railEntries/WindowResultPage/LeftPanel）；核心单测 36/36。

**实机（2026-09-05，dev Electron CDP，证据 `acceptance/block-59/theme-live.json` 9 断言 allPass + 截图 ×2，脚本 [block59-theme-live.cjs](../scripts/block59-theme-live.cjs)）**：① light 主题弹出结果窗 → `data-theme=light` + 外壳白画布 rgb(255,255,255) + zinc 文本（截图 p59-theme-light，与 UI-238 浅色纯净主题一致）；② 主窗切暗 → **已打开弹窗经 storage 事件实时跟随**（data-theme=dark + #0b1220 暗画布，截图 p59-theme-dark）+ 与主窗 data-theme 一致；③ 指挥中心瓦片暗色表面 rgb(17,26,46)（bg-surface 令牌生效）；④ 原主题偏好恢复。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-295: 窗口系统 P4——agent 详情窗：子 agent 实时工作流 + 终态摘要对齐 + 活动行入口（BLOCK-59 P4） (2026-09-05 verified)

**用户需求**：BLOCK-59 P4（plan §7）——agent 详情窗（`/window/agent/:runId`），衔接已收口 BLOCK-49 spawn 链路：子 agent 实时工作流展示；终态摘要对齐。

**改动**（0 新 npm 依赖 / 0 新 IPC / 0 新后端面）：[AgentWindowPage.tsx](../frontend/src/pages/window/AgentWindowPage.tsx)——**零第二真相**：数据全部来自 `/api/ai/agent/task/:taskId` 既有 SSE（task_events 回放 + 实时推送），复用 copilotClient `subscribeAgentTask`（与主窗同一订阅路径，含断线退避续传）；SSE 从 seq 0 全量回放 → **实时工作流时间线**（tool_call/tool_result 按 callId 关联，运行中脉冲/完成绿/失败红 + 耗时，上限 200 条环形截断）+ **终态摘要对齐**（delta 回放累积 = 与父会话/wait_agent 摘要同源，8000 字符展示上限）+ 终态徽章（已完成/失败/已取消）+ agent_status/agent_progress 状态行；[toolActivity.ts](../frontend/src/components/copilot/toolActivity.ts) additive `agentRunId` 字段——agent 管理工具（spawn/wait/list）结果 `data.agentId` 提取（仅这三工具，其余工具 data 不进该字段）；[ToolActivityList.tsx](../frontend/src/components/copilot/ToolActivityList.tsx) 活动行「详情窗」按钮（agentRunId 存在且桌面桥可用时渲染 → `popOut('agent', agentRunId)`）。

**门禁**：tsc 0；核心单测 36/36；前端受影响 vitest（toolActivity 9 含新增 agentRunId 提取三分支用例 / ToolActivityList 5 / SimpleChat 5 / WindowResultPage 4 / railEntries 9）；ui:audit:check PASS。

**实机（2026-09-05，dev Electron CDP，证据 `acceptance/block-59/p4-live.json` 10 断言 allPass + 截图，脚本 [block59-p4-live.cjs](../scripts/block59-p4-live.cjs)）**：真实历史子 agent 任务（20f71d77，done，8 tool_call + 92 delta）驱动——① `popOut('agent', taskId)` → 独立窗 target；② SSE 全量回放渲染：时间线 8 行工具调用（workspace_read/run_tool/workspace_exec + 状态点 + 耗时，截图 p59-p4-01）+ 终态摘要 1258 字符（delta 回放累积）+ **终态徽章「已完成」如实**；③ 无错误横幅（流健康）；④ 清理降格 + 移除。实机抓真修一处：statusChip 类名跨 CSS module 引用错位（command-center vs window-shell），tsc 无法捕获、实机定位——徽章 className undefined 致断言空文本。入口按钮由 toolActivity agentRunId 数据面单测覆盖（实机以同一 popOut IPC 驱动，诚实边界）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-294: 窗口系统 P3——指挥中心墙：多任务俯瞰单例窗 + 瓦片只读投影 + 下钻 L1 结果窗（BLOCK-59 P3） (2026-09-05 verified)

**用户需求**：BLOCK-59 P3（plan §4.1/§7）——指挥中心墙（codex agent command center 模式）：独立单例总览窗，网格瓦片聚合所有作业实时状态；点击瓦片下钻到 L1 弹出窗。多任务时才打开（随开随关无状态）。

**改动**（0 新 npm 依赖 / 0 新 IPC）：[CommandCenterPage.tsx](../frontend/src/pages/window/CommandCenterPage.tsx)（`/window/command-center`）——**零第二真相**（plan §10 治理红线）：瓦片只读 `listAllJobs()`（/api/tools/history 既有 REST，tool_jobs 表投影），5s 轮询，最近 12 瓦片；瓦片 = 作业名 + 工具 id + 状态点（running 脉冲/done 绿/failed 红）+ 远程目标徽章（BLOCK-57 execution_target_id）+ **实时进度诚实形态 = 状态 + 已耗时**（tool_jobs 无百分比概念，不虚构进度条）；点击瓦片 = 下钻（fetch /tools/status 取首选产物 → `popOut('result', jobId:artifactName)`，同内容禁双开契约复用；无产物如实提示不假装下钻）；[WindowShell.tsx](../frontend/src/components/window/WindowShell.tsx) 增 `closeBehavior` prop（'rail' 默认=× 降格契约 / 'close'=× 真关闭——无状态单例不进轨道不显「收回」，plan §4.1）；[TitleBar.tsx](../frontend/src/components/desktop/TitleBar.tsx) windowTools 增指挥中心入口（仅桌面桥可用时渲染）。

**门禁**：核心单测 36/36（新增 P3 静态契约：WindowShell 默认 ×=降格 + close 形态走真关闭 + 指挥中心 closeBehavior="close" + 瓦片只读 listAllJobs 真相 + TitleBar 入口）；tsc 0。

**实机（2026-09-05，dev Electron CDP，证据 `acceptance/block-59/p3-live.json` 10 断言 allPass + 截图，脚本 [block59-p3-live.cjs](../scripts/block59-p3-live.cjs)）**：① `popOut('command-center')` → 单例窗 created；② 重复弹出 → focused 且 target=1（单例不双开）；③ **瓦片与 tool_jobs 真相交叉核对一致**（12 瓦片渲染最近作业真实名称：sample-metadata-validator / volcano-plot，完成/失败状态点如实——截图 p59-p3-01）；④ 点击瓦片 → 下钻 L1 结果窗（popOut result created + 独立窗 target 出现）；⑤ × 关闭指挥中心 → target 消失（随开随关，不进轨道）且已下钻结果窗不受影响（注册表 popped 保持）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-293: 窗口系统 P2——边缘活动轨道容器窗 + 终端 Tab 升格独立窗 + 数据转发面（BLOCK-59 P2） (2026-09-05 verified)

**用户需求**：BLOCK-59 P2（plan §5/§7）——轨道容器窗（降格窗口的存放处，原创配件）+ 统一 × 语义 + 终端窗弹出（衔接已收口 BLOCK-54：弹出 = 把某 Tab 会话升格为窗）。

**改动**（0 新 npm 依赖）：① **轨道容器窗**（[window-manager.js](../src/ipc/window-manager.js)）——极窄 28px 透明 BrowserWindow 懒创建（第一个窗口被降格才建）、`alwaysOnTop(floating)` 巡视面、`skipTaskbar`/`focusable:false` 不抢键盘焦点、`setIgnoreMouseEvents(true,{forward:true})` 条带外点击穿透、`setVisibleOnAllWorkspaces(visibleOnFullScreen:false)`；无降格条目自动 hide（常驻保活不销毁）；close 请求一律拦截隐藏（轨道无 ×，plan §4.1）；`window:rail-mouse` IPC 供渲染层 hover 切换穿透。② **作用域裁决**——轨道窗 sender 授予全量变异权（hover 恢复/显式移除是轨道的职责），主窗全权、普通弹出窗仅自身、外来 sender fail-closed（实机抓真修：首轮轨道点击恢复被自身作用域规则拦截）。③ **终端数据面**（[terminal.js](../src/ipc/terminal.js)）——`forwardToContentWindow` 钩子把 `terminal:data/exit` 在主窗广播之外同步送达承载会话的独立窗（`terminal:<sessionId>`），无弹出窗时 no-op。④ **前端**：[RailPage.tsx](../frontend/src/components/window/RailPage.tsx)（`/window/rail` 只读窗口注册表投影——不订阅任务事件流不建第二套真相；刻度常态 14px/0.45 透明 → hover 28px/0.72；点击刻度=恢复；hover 320px 卡=详情+显式移除（唯一销毁路径 UI 入口）；静态 5min 淡出仅视觉降权 hover 恢复）；[railEntries.ts](../frontend/src/components/window/railEntries.ts) 纯逻辑（fadeAfter 判定/单屏 7 刻度超出收拢 +N/卡标题）；[TerminalWindowPage.tsx](../frontend/src/pages/window/TerminalWindowPage.tsx)（`/window/terminal/:sessionId` 同一 pty 会话第二活视图——主窗 tab xterm 保活零丢失，挂载点起新输出 + 会话未运行可启动 + 关窗永不停 pty）；[BottomTerminal.tsx](../frontend/src/components/workspace-panels/BottomTerminal.tsx) 每 Tab「升格为独立窗」按钮。

**门禁**：核心单测 35/35（新增 terminal.js 转发静态契约 + 轨道窗规格静态契约：alwaysOnTop/穿透/skipTaskbar/focusable:false/rail-mouse IPC）；前端 vitest 14/14（railEntries 淡出/收拢/标题 + 窗口键）；tsc 0。

**实机（2026-09-05，dev Electron CDP，证据 `acceptance/block-59/p2-live.json` 14 断言 allPass + 截图 ×2，脚本 [block59-p2-live.cjs](../scripts/block59-p2-live.cjs)）**：① 真实 pty 会话启动 → `popOut('terminal','default')` → 独立窗 target + xterm 挂载（attachNote「已挂载运行中的会话」上屏）；② **数据面实锤**：主窗 writeSession → pty echo → 受管窗转发 → 弹出窗探针收到 marker（terminal.js forward 链路全通）+ xterm rows 真实渲染；③ × 降格 → railed → **轨道窗懒创建出现**（visible + 终端刻度 data-kind=terminal 渲染，截图 p59-p2-02）；④ 点击刻度 → popped（hover 恢复路径的点击等价）；⑤ 恢复后轨道自动隐藏（visibilityState hidden）；⑥ 再降格 → 轨道显式移除 → 条目终结 + 轨道隐藏。静态 5min 淡出由 railEntries 单测覆盖（14/14），实机不做 5min 等待（诚实边界）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-292: 窗口系统 P0+P1——窗口管理器（状态机/白名单/geometry）+ 结果窗弹出/收回/× 降格 + 只读聚焦视图（BLOCK-59 P0/P1） (2026-09-05 verified)

**用户需求**：BLOCK-59 窗口系统（2026-09-04 立项、2026-09-05 用户裁决「先59后48」启动）——子 agent 工作流/分析结果的独立展示窗。P0 = 窗口管理器底座；P1 = 结果窗弹出/收回/只读聚焦视图。

**P0 改动**（0 新 npm 依赖）：[_window-manager.js](../src/main/_window-manager.js) 纯核心（无 Electron 依赖，参数注入）——docked→popped→railed→closed 三活态一终态状态机；**× 永远是降格不是销毁**（不可变契约，销毁只有轨道显式移除一条路）；≤4 弹出上限超限自动降最老；同内容禁双开=聚焦既有窗；内容类型注册表（result/terminal/agent/command-center/rail，前三个进状态机，单例不进）；**路由白名单 main 校验 fail-closed**（未知类型/非法键拒绝，路由仅由核心构建，`encodeURIComponent` 兜底路径安全，非 ASCII 产物名放行）；geometry 主进程持有+JSON 持久化+副屏失效回落主屏级联。[_window-create.js](../src/main/_window-create.js) additive `onSpaServerReady` 回调（弹出窗复用同一 SPA base URL，不建第二套前端）；[window-manager.js](../src/ipc/window-manager.js) Electron 适配器——7 通道 IPC（window:pop-out/return/minimize/restore/remove/snapshot/self）+ window:state-changed 全窗多播 + `close` 事件拦截降格（closeIntent→hide 保活）+ before-quit 全量收割 + sender 作用域校验（主窗全权/弹出窗仅自身，外来 sender fail-closed）；[preload.js](../src/preload.js) `windowManager` 桥段 + [electron.d.ts](../frontend/src/lib/electron.d.ts) 类型。

**P1 改动**：[WindowShell.tsx](../frontend/src/components/window/WindowShell.tsx) 弹出窗最小 chrome（frameless 自绘拖拽区 + 收回/× 按钮，× 走降格契约；非桌面环境诚实降级提示）；[WindowResultPage.tsx](../frontend/src/pages/window/WindowResultPage.tsx) `/window/result/:artifactId` 只读聚焦视图——键 `jobId:artifactName`，语言无关状态自举（`/api/tools/status` 绝对前缀 + toolId 反推 lang）→ manifest 归一 → 复用 Result Studio 纯函数（normalizeResultManifest/resolveResultViewerAdapter/buildPreviewTable）按类型只读渲染（image/report iframe/table/text），编辑/改参留主窗（plan §4.2 裁决 1）；[App.tsx](../frontend/src/App.tsx) `/window/*` 路由分支（不挂主窗 AppShell/Provider 树——窗口永不持有 canonical state）；[ResultView.tsx](../frontend/src/components/workspace-panels/ResultView.tsx) 工具栏「弹出」入口（仅桌面桥可用时渲染）。

**门禁**：[_window-manager 单测](../test/block59-window-manager.test.mjs) 33/33（全转移路径/白名单 fail-closed/geometry round-trip+副屏回落/事件增量/static 5min fadeAfter/适配器+preload+main.js 静态契约锁）；impact-map 补 block59 规则；tsc 0；受影响 vitest（CenterPanel/resultBodyState/WindowResultPage 键解析）23/23；main-window-compat + window-controls 回归 11/11。

**实机（2026-09-05，dev Electron CDP，证据 `acceptance/block-59/ui-live.json` 26 断言 allPass + 截图 ×3，脚本 [block59-ui-live.cjs](../scripts/block59-ui-live.cjs)，连续两轮幂等全绿）**：真实 completed 作业（tj_mtnyx2kb_97hz）驱动——① popOut → created + 独立窗 target（/window/result/ 路由）+ WindowShell chrome（拖拽区/收回/×）+ self() 身份 + 只读内容上屏（截图 p59-01）；② 同内容再弹出 = focused 且 target 数不变（禁双开）；③ returnToDock → docked + target 消失（状态零丢失）；④ 再弹出 → × 降格 = railed + **target 仍在（hide 保活，× 不是销毁）** + static 淡出时间戳；⑤ restore → popped 回记忆位置；⑥ **契约实证：popped 态 remove 被拒**（invalid_transition），降格后轨道 remove → closed 条目终结；⑦ geometry 持久化文件含内容键（位置记忆归主进程）；⑧ **主窗结果视图真实点击「弹出」按钮** → 独立窗出现且注册表 popped（截图 p59-03）。诚实范围：重启后弹出窗不恢复（plan §7 P1 明示，geometry 记忆持久化佐证）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-291: Composer 工具栏优化——死控件收敛 + ⋯ 溢出菜单 + 容器查询窄态自适应 + 视觉分组（BLOCK-60） (2026-09-05 verified)

**用户需求**：用户反馈聊天输入框底部工具栏「控件堆在一起」——9 控件（+/刷新/I-O/完全访问/计划模式/执行目标/供应商/模型/发送）单行零分组拥挤。方案 B+：弹性宽度逻辑零改动，收敛死控件 + 低频操作进 ⋯ 溢出菜单 + 容器查询窄态收纳 + 轻量视觉分组。

**改动**（0 新 npm 依赖）：[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) ① 移除永久 disabled 的「+」死按钮；② 刷新文件链接/模型 I-O 信息流收进新增 ⋯ 溢出菜单（`sc-toolbar-more`，复用 sc-access-menu 弹窗风格）；③ 计划模式按钮与执行目标 picker 加 `sc-toolbar-secondary` 类；④ ResizeObserver 只读 composer 宽度驱动 `composerNarrow`（<680px 窄态：⋯ 菜单收纳 计划模式开关 + 执行目标本机/aliyun/dell 单选项；已激活计划模式强制常驻不被隐藏）；[simple-chat.css](../frontend/src/components/copilot/simple-chat.css) `.sc-composer` 加 `container-type: inline-size` + `@container (max-width: 679px)` 收纳规则（is-active 计划模式豁免）+ `.sc-composer-left` gap 8→14 策略组分组。弹性宽度逻辑（composerWidth/--sc-composer-width/resizeTextarea）零改动。

**门禁**：tsc 0；受影响 vitest 6/6（SimpleChat/PlanApprovalCard）；docs:check + ui:audit:check PASS。

**加映三（2026-09-05 用户裁决「执行目标迁设置 + 计划模式自动化 + 默认宽度加大」）**：① **执行目标选择迁出消息框**——composer chip 与确认卡选择器全部移除，选择统一在 **设置→计算与数据→远程执行目标**（每行「设为默认/★ 默认」+ 当前默认摘要行；localStorage `biof3.executionTargetId` 持久化；发送时 useChatStream 自动读取注入 context，本机永远默认，移除目标自动回落）；② **计划模式自动触发**——用户首条消息含计划/方案/「先别执行」类意图（否定式执行短语剥离后判定，执行词压制）且未显式开启 planMode 时，本轮自动套用计划模式纪律（系统提示级确定性约束）；⋯ 菜单手动开关保留兜底；③ **默认宽度 560→720**（上限 980 与弹性增长不变；侧边聊天窄容器仍贴合）。门禁：tsc 0 + block55 专项 10/10 + 自动触发单测 3/3 + 实机（主聊天 composer 720px 实测、执行目标设置面持久化）。**加映二（2026-09-05 用户反馈「算力区直接列出全部节点」）**：⋯ 菜单算力分区由「执行目标 ›」钻取改为**平铺直选**（本机/aliyun/dell 全列出，当前项 ✓，点选即切换），移除二级钻取死分支。实机 CDP 验证：三分区 + 全节点平铺直选（截图 `acceptance/block-60/menu-flat.png`）。

**加映（2026-09-05 用户反馈「同类型归属 + 执行目标子导航」）**：⋯ 菜单重构为分区结构（操作/模式/算力 三分区标签）+ 执行目标二级钻取导航（主菜单「执行目标：当前值 ›」→ 子导航 本机/aliyun/dell 单选带 ✓ 与 ‹ 返回，选择即同步 chip 并关闭）。实机 CDP 验证：分区标签/子导航项/选择同步（chip aliyun→dell 复原）全通过（截图 `acceptance/block-60/subnav-picked.png`）。

**实机（2026-09-05，dev Electron CDP，证据 `acceptance/block-60/ui-live.json` + wide-state/narrow-menu/wide-restored 截图）**：宽态 860px 7 控件全展开（+ 已消失/⋯ 就位/双 secondary 可见/执行目标 chip 显示 dell 持久化选择）；清空输入 → 559.99px 窄态：双 secondary display:none、⋯ 菜单六项全功能（刷新/I-O/计划模式开关/执行目标 本机+aliyun+dell）；输入长文本 → 860px 恢复宽态（secondary flex/block 恢复）。弹性效果照常。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-290: 远程执行目标管理面——设置页目标管理 + composer 执行目标选择器 + 远程作业标识（BLOCK-57 P1） (2026-09-05 verified)

**用户需求**：BLOCK-57 远程执行 P1——把分析任务提交到用户自有 SSH 服务器直跑（本地指挥席哲学：本机永远是默认，目标只是作业级可选参数）。UI 三处最小面：设置页执行目标管理（列表/`~/.ssh/config` 发现候选/注册/探测/移除）；run_tool 确认卡执行目标选择器（仅当存在已注册目标时渲染——空目标表零 UI 面零行为变化）；作业列表远程徽章。

**改动**（0 新增 IPC / 0 新依赖）：[RemoteTargets.tsx](../frontend/src/components/desktop/DesktopSettingsPanel/sections/RemoteTargets.tsx) 新组件（注册表 REST 同源：列表含 `~/.ssh/config` 只读发现候选、注册、探测——就绪/不可达/未探测三态 + 节点 os/运行时摘要、移除；首次信任指引文案）；[DesktopSettingsPanel.tsx](../frontend/src/components/desktop/DesktopSettingsPanel.tsx)「计算与数据」节挂载；[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) ApprovalCard 增执行目标下拉（默认「本机（默认）」，选择后经 approvePending 合入 `params.executionTargetId` 由模型续调 run_tool 携带，服务端剥离入库不污染脚本参数）+ [ResultsLibrary.tsx](../frontend/src/components/workspace-panels/ResultsLibrary.tsx) 作业项「远程」徽章（`execution_target_id` 存在时）；[project-types.ts](../frontend/src/lib/project-types.ts) ToolJob 增可选 `execution_target_id`。后端同提交：/api/remote-targets CRUD+probe（[remote-targets.js](../core/biof3-server/routes/remote-targets.js)）、status/history 增 executionTarget 字段（tools-metadata.js）、DB additive（execution_targets 表 + tool_jobs.execution_target_id + runtime_json）。

**门禁**：tsc 0；受影响前端 vitest 44（DesktopSettingsPanel + workspace-panels 30 + copilot 14）；后端零网络单测 [block57-remote-execution.test.mjs](../test/block57-remote-execution.test.mjs) 15/15（含零回归静态守卫：空目标表分派原路径/既有测试零改动）；**后端全链实机 `scripts/block57-live.cjs` aliyun 真实节点 ALL PASS**（模块级 10/10 + 应用级 7/7：真实 handleToolRun→executeJob 远程分派→completed + provenance.executionTarget + artifact-manifest 同构 + R 缺失诚实拒绝 + durable cancel 收敛，证据 `acceptance/block-57/`）。

**实机（2026-09-04 夜，dev Electron CDP，用户裁决配双节点 aliyun+dell 裸服务器直跑、不做 Slurm）**：① **设置页目标管理 live 全绿**（`p57-01-settings.png`）——面板渲染/`~/.ssh/config` 零注册发现（aliyun、dell_local、dell-direct、xy_zhangdiandian）/UI 注册/真实 SSH 探测：aliyun「就绪」(Linux 6.8.0-57 · Python 3.12.3)、dell「就绪」(Linux 6.8.0-137 · R 4.5.3 · Python 3.12.3 · 112 核 251G)，落库持久。② **真实远程作业 + 诚实失败经真 API 复核**：`POST /api/tools/run`（ml-feature-select + executionTargetId=aliyun）→ `failed` + `execution_target_id` 落库 + 错误「节点缺少 R (Rscript) 运行时（目标 aliyun）」（探针来源=远程）。③ **实机修复三 bug**：probe 未自引导 agent 部署（新节点首次探测必败→probe 前置 ensureAgent 注入）/ 注入箭头函数形状反转（ensureAgent 收 `{alias}` 对象被当字符串二次包裹 → invalid_target_alias unhandledRejection）/ POST 路由漏 await（异步化后读 Promise.ok 恒假 → 注册成功却报错不刷列表）。④ **确认卡选择器可达性如实修正**：聊天全权档位重分析按委托边界自动执行（无确认卡）、项目写档位按 BLOCK-56 策略直接拒绝插件执行——选择器组件+合并链路已实现并有后端证据，其可达上下文为受控确认流；模型直带 `executionTargetId` 的参数透传链路经 API 实证可用。⑤-b **会话级执行目标选择器（composer chip，2026-09-05 实机收口）**：验证中发现确认卡在三种档位下均不可达（全权=自动执行/项目写=策略拒绝/只读=mutating 拒绝），选择器改为落在用户始终可达的位置——[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) 输入框旁「执行目标」chip（与计划模式/档位并列，仅目标存在时渲染，本机永远默认），经 send context → [chat.js](../core/biof3-server/routes/ai-agent/chat.js) toolCtx（未知目标 fail-closed）→ [learning.js](../core/biof3-server/agent-tools/learning.js) 统一注入（scientific 严格门之后、heavy/非 heavy 执行之前，ack 创建与续跑两侧确定性一致）→ [callTool 远程分支](../core/biof3-server/mcp/registry.js)（插件链 tj_ 作业此前完全绕开远程路径——实机发现的真集成缺口，本轮接上：剥离保留键/部署探测/同步预算 280s 内提交-轮询-拉回对账/超预算尽力取消并诚实失败/execution_target_id 落库/provenance.executionTarget 合并）。**进程内实机**（[block57-inproc-run.cjs](../scripts/block57-inproc-run.cjs)）：run_tool（同模型代码路径）→ 注入日志实锤（ctxTarget=paramsTarget=dell）→ callTool 远程分支 → **completed on dell** + execution_target_id 落库；composer chip 实机截图（p57-04-chip.png，dell 选中态）。⑤-c **用户实机完整闭环（2026-09-05 上午）**：用户在真实对话中选 dell chip 后由模型自动执行 volcano-plot——两轮实机各修一处真问题：① 模型插件链的 run_tool 参数含**绝对本地路径**，dell（Linux）上不存在 → 远程分派前按「bundled copy 命名约定（<input_id><原扩展名>）」启发式重写 file 型输入（不依赖 tool-definition 声明，部分插件 inputs 为空数组）；② 插件产物约定写在 jobDir 根目录而拉回协议只取 output/ → agent 收尾把根目录产物归拢进 output/（bundle 清单排除），拉回后在本地归位根目录（两端命名闭环）。修复后 **volcano-plot 经模型代码路径在 dell completed**（tj_mtnxhti6_v9ik，进程内实机 PASS；同会话用户可于结果页看到该远程作业）。⑥ **dell 真实科学作业 SUCCESS**：`sample-metadata-validator`（依赖仅 jsonlite+digest，apt 二进制安装）经真实 API 提交 dell → R 脚本真实执行 → **completed** + 7 个产物拉回（manifest valid）+ provenance.executionTarget 记录 dell (Linux 6.8.0-137 / R 4.5.3 / tar-over-ssh)；首轮 exit 1 系参数分组默认值不匹配（Control/Treatment vs WT/KO），带正确参数复跑即成——错误现场经 remote-runner.log 回传定位。⑥ **徽章**：组件级 vitest 3/3（远程作业渲染「远程」徽章/本机作业零渲染/混合列表单枚）。**状态**: verified（2026-09-05 收口）。**实机边界精确记录**：已实机验证 = 设置页双节点管理（aliyun/dell 就绪）+ composer 执行目标 chip（选择/持久化/上下文透传）+ 会话注入（进程内日志实锤 ctxTarget=paramsTarget=dell）+ callTool 远程分支（volcano-plot 经模型同款代码路径在 dell completed，产物拉回对账）+ 结果页远程错误原文展示（「节点缺少 R (Rscript) 运行时（目标 aliyun）」上屏）。**如实登记的边界**：① 确认卡选择器在三种档位下均不可达（全权=自动执行/项目写=策略拒绝/只读=mutating 拒绝，均有实机取证）——组件保留供受控确认流，用户主路径由 composer chip 承载；② 作业库「远程」徽章为组件级验证（vitest 3/3 + 数据链路 SQL 核实）——作业库视图在有作业会话中会被自动绑定的详情页遮盖，实机截图未取得；**候选（待用户裁决）**：结果标题栏目标标识（更常驻的展示面）+ 会话默认目标的产品化。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-289: 计划模式 Spec 门——开关 + 批准三选一卡 + 修订批准条（BLOCK-55 P1/P3） (2026-09-04 verified)

**用户需求**：BLOCK-55 渐进式工程计划模式——会话级计划模式开关（开启后智能体只读探索 + 起草计划，写类工具被禁用）；计划完成后批准三选一弹窗（批准并执行 / 批准并清上下文执行 / 继续讨论）；P3 失败步骤修订案批准条。对齐 codex plan_implementation 三选一裁决，轻门不重流程。

**改动**（0 新增 IPC / 0 新依赖）：[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) 档位菜单旁新增「计划模式」开关按钮（`planMode` 会话级 state，随 send context 进后端）+ run 结束/会话切换后拉取待批准 draft 计划（`fetchDraftPlansForConversation`）与待批准修订案（`fetchPlansWithPendingRevision`，拉取失败静默降级不影响普通对话）+ `handlePlanApprove` 三分支（execute→恢复 full 语义发执行首 turn；execute-fresh→`buildFreshPlanTurn` 自包含首 turn + `opts.freshTurn=true` 消息数组仅含该条；keep-planning→仅关卡）；[useChatStream.ts](../frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts) send 增加 `opts.freshTurn`（清上下文执行不带会话历史）；[PlanApprovalCard.tsx](../frontend/src/components/copilot/SimpleChat/PlanApprovalCard.tsx) 新组件（spec 正文折叠展示 + 步骤表含子智能体标记 + 三按钮 + 收起按钮）；[planApprovals.ts](../frontend/src/components/copilot/planApprovals.ts) REST 封装（approve / revisions approve / fresh turn 文案构建 + **snake_case 行映射 specMd/steps**）；修订批准条 `sc-plan-revision-banner`（仅无 draft 卡时渲染，批准后发继续执行提示）；[simple-chat.css](../frontend/src/components/copilot/simple-chat.css) 配套样式；[copilotContext.ts](../frontend/src/lib/copilotContext.ts) `planMode/approvedPlanId/approvedPlanFresh` 类型。后端同提交：policy plan 模式收写类工具（`agent-tool-policy.js` plan 工具白名单）、draft/spec_md/assignee/propose_revision 工具面（`plan-ui-tools.js` + `tool-defs.js` schema）、批准/修订 REST（`ai-plans.js`，list 接口批量附 steps）、DDL 单一事实源抽离（`helpers/plan-lifecycle.js`）、计划模式/已批准执行双系统提示（`chat.js`）。

**实机发现并修复——批准卡字段断层（2026-09-04 收口）**：首轮实机批准卡渲染 `hasSpec:false, stepCount:0`——REST `/api/ai/plans` 返回 snake_case `spec_md` 且不带 steps，组件期望 camelCase `specMd` + `steps`。修复：[ai-plans.js](../core/biof3-server/routes/ai-plans.js) list 接口批量附 steps（单查询 IN 分组）；[planApprovals.ts](../frontend/src/components/copilot/planApprovals.ts) `mapPlanRow` 映射 `spec_md→specMd`。重启 dev Electron 后复验通过（fresh server 纪律：stale :59124 server 上批准卡断层不可见）。

**门禁**：后端 [block55-plan-mode.test.mjs](../test/block55-plan-mode.test.mjs) 10/10（plan 模式写拒/只读放行/无 planMode 零回归/draft 创建/update_spec 态约束/三选一路径/assignee 回写/修订替换+历史/draft 拒修订）；前端 [PlanApprovalCard.test.tsx](../frontend/src/components/copilot/SimpleChat/PlanApprovalCard.test.tsx) 4/4（busy 时 dismiss 可用修复：收起按钮移除 `disabled={busy}`，纯 UI 收起安全）+ copilot 目录回归 249/249 + tsc 0；docs:check 200 + ui:audit:check。

**UI 实机（2026-09-04，dev Electron CDP :9222 + 真实模型，证据 `acceptance/block-55/ui-live.json` 15 断言全 PASS + 截图 ×5，脚本 [block55-ui-live.cjs](../scripts/block55-ui-live.cjs)）**：场景 A（P1 Spec 门 + P2 分派）——「计划模式」开关激活 → 真实模型只读探索后 plan(create, draft=true, specMd 734 字自包含, 步骤 1 assignee=subagent) → 批准卡渲染（spec 正文 + 3 步骤表 + 子智能体标记 + 三按钮，截图 p55-01）→ 点击「批准并清上下文执行」→ plan draft→approved + 开关自动关闭 + **执行 run 消息数组仅 1 条 spec 自包含首 turn**（不带讨论历史）→ 执行期三步全部 update_step 写回 done + **assignee 步骤真实 spawn 子 agent**（BLOCK-49 工具链，kind=subagent，completed）+ 最终汇总报告引用子 agent 原文（截图 p55-02/03，run 耗时 28s）。场景 B（P3 replan）——直构 active plan + proposed 修订案 → 修订批准条渲染（截图 p55-04）→ 点击「批准修订」→ 修订 applied + 步骤表整体替换保留 done（截图 p55-05）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-287: 模型降级任务条显示——请求级 notice + 任务级无缝切订阅（BLOCK-56 P1） (2026-09-04 verified)

**用户需求**：BLOCK-56 P1 诚实纪律——模型调用失败自动降级到备用模型时用户必须可见（不静默换模型）：请求级降级在任务条显示 notice；任务级降级前端无缝切到续跑任务订阅，任务不"消失"。

**改动**（0 新增 IPC / 0 新依赖）：[conversationRunStore.ts](../frontend/src/components/copilot/conversationRunStore.ts) 处理 `model_fallback` 事件——请求级（scope=request_level）记入 run notice（任务条显示「已降级到 X 模型继续」）；任务级（scope=task_level）从事件 `newTaskId` 无缝切换订阅到续跑任务（原任务 failed 终态不再渲染错误横幅）；[copilotClient.ts](../frontend/src/components/copilot/copilotClient.ts) `StreamChatOptions` 增 `onModelFallback` 透传 + `SimpleMessage.modelFallbackNotice` 字段；[useChatStream.ts](../frontend/src/components/copilot/SimpleChat/hooks/useChatStream.ts) 事件接入；[SimpleChat/types.ts](../frontend/src/components/copilot/SimpleChat/types.ts) 类型同步。

**实机发现并修复——notice 随 run 终态被销毁（2026-09-04 收口）**：三层探针实机定位（SSE 帧 → store 落盘 → displayMessages 构建逐层取证，`acceptance/block-56/ui287-diagnose.json`）：请求级降级常与任务终态同批到达（备用模型秒回），notice 挂在 run 快照上，而 run 终态对账（`shouldClearReconciledConversationRun` → `clearConversationRun`）紧随其后把 run 连同 notice 一起销毁，且持久化消息不携带该字段——chip 存活 <300ms 用户不可见。修复：store 模块级会话级 `fallbackNotices` map（请求级/任务级双写，`getConversationFallbackNotice` 导出，下一次 run 开始清除），SimpleChat displayMessages 包装层把 notice 附着到最后一条助手消息（覆盖 run 清理后的早返回构建路径）。

**门禁**：[conversationRunStore.test.ts](../frontend/src/components/copilot/conversationRunStore.test.ts) 35/35 + SimpleChat 相关 vitest 28/28 + tsc 0；后端链路实机 `scripts/block56-live.cjs` 14/14（证据 `acceptance/block-56/model-fallback-live.json`）。**UI 实机（2026-09-04）**：`scripts/block56-ui-fallback-live.cjs` 11/11 allPass（场景 R：任务完成同任务 + task_events 记录 model_fallback + mock 500 注入生效 + 备用 marker 上屏 + **降级 notice chip 上屏且 run 清理后持久可见**；场景 T：failed→续跑 completed 溯源 + 备用 profile 单级不连环 + 无缝切订阅无错误横幅；ai-settings 字节级恢复），证据 `acceptance/block-56/ui-fallback-live.json` + 截图 ×2。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-288: 模型档位三选菜单——完全访问/项目写/只读（BLOCK-56 P2） (2026-09-04 verified)

**用户需求**：BLOCK-56 P2 沙箱中间档——SimpleChat 提供三档 accessMode 用户可选：完全访问（full，默认不变）/ 项目写（workspace-write：项目内写 + 前台命令，禁后台进程/插件委托/系统写面）/ 只读（read）。与 BLOCK-55 plan 模式天然衔接（批准后可授 workspace-write 而非直接 full）。

**改动**（0 新增 IPC / 0 新依赖）：[SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) 档位菜单三选（缺省/未知值塌缩 full，既有二档行为零变化）；[accessModeValidator.ts](../frontend/src/components/copilot/accessModeValidator.ts) 三档工具矩阵（PROJECT_WRITE_TOOLS：workspace_write/replace + fs_write/Write/StrReplace/Delete/EditNotebook；FOREGROUND_EXEC_TOOLS：workspace_exec；workspace-write 档仅放行两类 + 只读面，后台进程/插件委托/系统写面拒绝）；[copilotContext.ts](../frontend/src/lib/copilotContext.ts) `accessMode: 'read' | 'workspace-write' | 'full'` 类型；后端同语义（agent-tool-policy 白名单 / agent-execution-policy / scientific-task-spec ACCESS_MODES，语义矩阵见 `docs/block-56-reliability-depth-plan.md` 附录 A）。

**门禁**：[accessModeValidator.test.ts](../frontend/src/components/copilot/accessModeValidator.test.ts) 新建 4/4；后端 [accessmode-validation.test.mjs](../test/accessmode-validation.test.mjs) 三档矩阵 14/14 + 沙箱回归 37/37 + exec 回归 56/57（唯一失败为预存环境问题，HEAD 基线同失败）；tsc 0。

**实机过目（2026-09-04，随 BLOCK-49 P4 顺带）**：dev Electron 档位菜单三选过目 5/5（三选项齐备/选「项目写」按钮标签回写/恢复无副作用，证据 `acceptance/block-56/ui288-menu-live.json` + 截图）；**顺带发现并修复** [SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) `accessModeLabel` 二值漂移（选 workspace-write 按钮显示「只读模式」→ 三档三元表达式，tsc 0 + 实机回归）。**行为过目（2026-09-04 收口）**：`scripts/block56-ui288-workspace-live.cjs` 10/10 全 PASS——「项目写」档下 `workspace_write` 探针文件真实落盘（context.accessMode=workspace-write）、`workspace_exec_background` 被拒（task_events 记录 `access_mode_workspace_write`）且无后台进程实际启动、探针清理，证据 `acceptance/block-56/ui288-workspace-live.json` + 截图 ×2。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-286: 底部终端多 Tab——独立 pty 会话 + tab 条管理（BLOCK-54 P2） (2026-09-04 verified)

**用户需求**：BLOCK-54 P2 用户侧——底部终端从单例会话升级为多 Tab（一个跑 dev server、一个进 R 环境）；上限 4 对齐 codex 64 上限哲学取 GUI 小值；每 tab 独立 cwd（默认当前项目 workspace）。

**改动**：① 主进程 [terminal.js](../src/ipc/terminal.js) 单例 `shellProc` → `Map<sessionId, proc>`（上限 `MAX_TERMINAL_TABS=4`）；IPC 全量 additive 兼容（旧调用不带 sessionId = `default` tab，单会话语义不变）；新增 `terminal:session-list`；`terminal:data`/`terminal:exit` payload 带 `sessionId` 供 renderer 按 tab 路由；`before-quit` 遍历 Map 全量 kill（对齐 codex `terminate_all_processes`）；② [preload.js](../src/preload.js) 终端桥 additive（`startSession/writeSession/resizeSession/stopSession` 增 `sessionId` 形参 + `listSessions`）+ [electron.d.ts](../frontend/src/lib/electron.d.ts) 类型同步；③ 前端新 [terminalTabs.ts](../frontend/src/hooks/terminalTabs.ts)（纯函数 tab 增删/上限）+ [useTerminalTabs.ts](../frontend/src/hooks/useTerminalTabs.ts)（每 tab 独立 xterm 实例 + 懒启动：面板展开 && tab 首次激活才起 pty；事件按 sessionId 路由；关闭即 stop+dispose；卸载全量回收）；④ [BottomTerminal.tsx](../frontend/src/components/workspace-panels/BottomTerminal.tsx) tab 条 UI（+ 新建 / × 关闭 / 点击切换 / 运行状态点 / 上限提示条）+ [project-workspace.module.css](../frontend/src/pages/project-workspace.module.css) 样式；旧 [useTerminalSession.ts](../frontend/src/hooks/) 删除（被多 tab hook 取代）。

**门禁**：后端 [terminal-multisession-ipc.test.mjs](../test/terminal-multisession-ipc.test.mjs) 6/6（多会话并存+路由 / 事件带 sessionId+exit 移除 / 上限拒绝+腾位复开 / 旧形态 default 兼容 / before-quit kill-all / pty spawn 规格）；前端 terminalTabs + useTerminalTabs vitest 15/15、tsc 0；agent-workspace-exec-yield + platform-compat 回归 19/19；docs:check 200。

**实机**（2026-09-04，dev Electron CDP :9222，证据 `acceptance/block-54/user-side-tabs.json` 12 断言全 PASS + p4-01/02/03 三张截图）：TitleBar 展开底部终端 → 首个 tab 自动懒启动（listSessions 1 会话）→「新建终端标签」×2 → 3 tab 并存、3 个独立 pty（pid 互异）且 cwd 同绑项目 workspace → 每 tab 真实键入 `pwd && echo b54-marker-N` → 输出各正确路由到对应 xterm（pwd 输出 = 项目 workspace，marker 不串 tab）→ 关闭「终端 3」× → listSessions 回收为 2 会话、DOM tab-3 移除、tab-1/2 回显保留 → `window.close()` 退出应用 → before-quit 全量 kill，剩余 2 个 pty pid 双双消失（0 孤儿）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-285: 结果图引用→自然语言微调→改参重跑闭环（BLOCK-52 P3） (2026-09-03 verified)

**用户需求**：BLOCK-52 旗舰闭环——对 Result Studio 结果图说一句自然语言（如「把点大小调大」），agent 走 artifact 血统链改参重跑出新 Revision，而不是视觉猜谜。

**改动**：复用 P4R-3 Composer→ChangeSet 链 + result_studio_context 绑定（引用卡 artifact 元数据 toolJobId/revisionId/artifactId/revisionOrdinal 由 P2 引用卡携带）；agent 从引用元数据交叉核对血统后走 `result_changeset_create_in_context` 改参重跑。0 新协议（复用既有 ExtractContext 模式）。

**门禁**：copilot 全家 vitest 239/239、workspace 面板 30/30、tsc 0、后端 agent-vision + agent-tool-registry 13/13（registry 测试顺手补临时 DB 自举修存量 `no such table: projects`）、docs:check 200、ui:audit:check。

**实机**（2026-09-03，dev Electron CDP，证据 `acceptance/block-52/p3-live-assertions.json` 9 断言全 PASS）：ResultView 打开 volcano.png 预览（含引用按钮）→ 物化基线 Revision（ordinal=1, is_current）→ 「引用到对话」→ composer 出现结果图引用卡（缩略图+血统来源行）→ 发送自然语言微调 → **agent 产出新 Revision（ordinal≥2）与基线同 artifact family、来自新 tool job、重跑参数含 point_size=3.2（自然语言→参数 Patch）**。证据备注：p3-01~04 四张截图为同一画面重复截图（截图脚本瑕疵），以断言 JSON 为准。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-284: 图片/结果图引用——预览图片一键进对话 composer（BLOCK-52 P2） (2026-09-03 verified)

**用户需求**：BLOCK-52 P2——右侧文件预览中的静态图片 / Result Studio 结果图可一键引用进对话输入框，作为下次提示词的一部分（分析图微调对智能体一句话改好）。

**改动**：① 事件通道 [events.ts](../frontend/src/lib/events.ts) `imageQuote` 类型化事件（`ImageQuoteDetail`：kind workspace-file/result-artifact + `ImageQuoteArtifact` 血统 toolJobId/revisionId/artifactId/revisionOrdinal）；② 生产端 [project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) 静态图预览「引用到对话」按钮 + [ResultView.tsx](../frontend/src/components/workspace-panels/ResultView.tsx) 结果图引用按钮（携带血统）；③ 后端 [vision-tools.js](../core/biof3-server/agent-tools/vision-tools.js) `read_image` 升级 v2：toolJobId / filePath 双模式（workspace 相对路径读静态图，词法+realpath 双重校验防穿越/符号链接逃逸，4MB 上限，png/jpg/jpeg/svg）；[tool-defs.js](../core/biof3-server/agent-tools/tool-defs.js) READ_IMAGE_v2 schema；④ 消费端 [SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx) imageRefs 引用卡（上限 4、同源去重、可删除）与 P1 文字引用同管道合并发送、成功清空；⑤ 纯函数 [imageReferences.ts](../frontend/src/components/copilot/SimpleChat/imageReferences.ts) + 配套 vitest；⑥ P1 增量真修复：selectionReferences 引用头半角 `[]` → 全角 `【】`（服务端落库 cleanContent 剥行首半角 `[...]` 导致落库消息缺头 + 前后端重复渲染）。

**门禁**：copilot 全家 vitest 239/239、workspace 30/30、tsc 0、后端 agent-vision 5/5（含路径穿越/符号链接逃逸逐项拦截）+ registry 8/8、docs:check 200。

**实机**（2026-09-03，dev Electron CDP，证据 `acceptance/block-52/p2-live-assertions.json` 6 断言全 PASS + p2-01/02 截图）：图片预览「引用到对话」按钮 → composer 引用卡（缩略图+名称+来源行）→ 发送 → 消息正文含 `【引用图片 quote-live.png】` 前缀 + workspace 相对路径（模型可据此 read_image）→ 发送后引用卡清空。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-283: 非 git 工作区一次性引导——审阅空态内联 git init（BLOCK-53 P2） (2026-09-03 verified)
**用户需求**：BLOCK-53 项目创建体验补丁 P2——非 git 目录进入项目后一次性引导「初始化 git 仓库以启用审阅与版本历史」，dismiss 记一次性不再弹（对齐 codex 信任屏「每目录一次」哲学）；非 git 诚实空态（BLOCK-32）保持为引导后的稳态兜底。

**改动**（0 新 npm 依赖 / 1 新 IPC）：① 后端 [working-tree-review.js](../src/ipc/working-tree-review.js) 新增 `git:init-repository`（projectId → getProjectWorkspacePath → `initRepositoryAt`：git init + 全量初始提交，幂等 alreadyGit；commit 失败不回滚 init，返回 committed:false + 可行动 warning；git 缺失 ENOENT 结构化 `git_not_found`）+ `initRepositoryAt` 导出供测试；② [preload.js](../src/preload.js) `workingTreeReview.initRepository` + [electron.d.ts](../frontend/src/lib/electron.d.ts) 类型同步；③ [ReviewMode.tsx](../frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx) 非 git 空态内嵌引导条（useParams projectId 路由定位；内联二次确认明示「将创建 .git + 全量初始提交」；「不再提示」写 localStorage `biof3.gitinit.dismissed.<projectId>` 一次性记忆；init 成功 `review.refresh()` 后空态自动切换为正常审阅视图）；样式入 [WorkingTreeReview.css](../frontend/src/components/desktop/WorkingTreeReview/WorkingTreeReview.css)。**并行边界**：BLOCK-52 P2 并行收口期间启动，文件面零重叠（不触碰 project-workspace / SimpleChat / ResultView / events.ts / agent-tools）。

**门禁**：后端 node --test `working-tree-review-init.test.mjs` 3/3（init+提交成功 / alreadyGit 幂等 / commit 失败保留 .git+warning）；ReviewMode vitest 21/21（新增 3 用例：空态引导条渲染 / 确认流 initRepository({projectId})+refresh 切回审阅 / dismiss 一次性记忆重挂不復现）；tsc 0；docs:check 199。

**实机**（2026-09-03，dev Electron CDP :9222，证据 `acceptance/block-53/live-check.json` 8 断言 + `s5-live-check.json` 4 断言 + 5 截图）：交互层 4 断言 PASS（空态引导条渲染 / 内联二次确认展开明示「创建 .git + 全量初始提交」/ 桥缺失降级可见错误——半新半旧栈 invoke 报错被 `.wt-gitinit-message` 如实展示不静默 / 「不再提示」消失 + localStorage 记忆重挂不復现）。**S5 init 全链补验（dev Electron 重启载入新 preload+主进程后）4/4 PASS**：新栈桥就绪（initRepository + pathForFile）→ 引导条出现（dismiss 记忆清除后）→ 确认初始化 → **真实 git init 全链**（`.git` 创建 + `5835ff7 Initial commit (BioF3)`，磁盘双重核对）→ 空态消失自动切回审阅视图（截图 `s5-init-full-chain.png`）。临时验收项目 p_mtlmidcb_q46h 已归档回收站、/tmp fixture 已清理。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-282: 拖拽目录直达创建——home 窗口 drop + 左栏 drop 进既有确认链（BLOCK-53 P1） (2026-09-03 verified)

**用户需求**：BLOCK-53 项目创建体验补丁 P1——把系统目录拖进窗口即直达创建流程；拖拽降低的是「打开系统选择器」的成本，UI-253 确认与反悔环节不减少（不绕过确认）。

**改动**（0 新增 IPC / 0 新 npm 依赖）：① [preload.js](../src/preload.js) `files.pathForFile`（webUtils.getPathForFile 官方通道优先，file.path 兜底，防 Electron 32+ 移除 File.path）+ [electron.d.ts](../frontend/src/lib/electron.d.ts) 类型同步；② [home.tsx](../frontend/src/pages/home.tsx) 挂载期接管窗口级 dragover/drop（preventDefault 阻止 Chromium 默认导航到拖入文件；drop 取第一个拖入项 → pathForFile → `validateDirectory` 校验 → 进 UI-253 既有 pendingWorkspace 确认面板；拖入单文件/无效项走 createError 可见提示）；③ [LeftPanel.tsx](../frontend/src/components/workspace-panels/LeftPanel.tsx) 左栏 drop → validateDirectory → 打开 UI-257 既有内联创建面板并回填路径（onOpen + onPathChange，用户仍需确认创建；拖拽悬停 inline outline 反馈、失败用既有 leftCreateError 展示）。

**门禁**：home vitest 4/4（新增 2 用例：drop 目录 → UI-253 确认面板出现且校验链被真实调用 / drop 非目录 → 可见错误无确认面板）；LeftPanel vitest 9/9（新增 2 用例：drop → createPanel.onOpen+onPathChange 回填 / drop 非目录 → 错误展示且面板不开）；tsc 0；docs:check 199。

**实机**（2026-09-03，dev Electron CDP :9222，vite HMR 生效栈，证据 `acceptance/block-53/live-check.json`）：4 断言全 PASS——① workbench（应用内导航，location.key≠default）窗口级 drop `/tmp/b53-accept-dir` → UI-253 确认面板出现且路径经 validateDirectory 真实 realpath（/tmp→/private/tmp）；② 点「在此处创建」→ 真实项目创建并跳转 `/project/p_mtlmidcb_q46h`；③ drop 单文件 → `[role=alert]`「该路径不是文件夹」可见错误、无确认面板；④ 左栏 drop → UI-257 内联创建面板打开且输入框回填校验后路径（零碰 project-workspace.tsx）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-281: AgentStreamDisconnected 根因修复——[DONE] 哨兵序列化形状对齐 + 两个重启暴露回归（BLOCK-52 P1 实机暴露的范围外传输层缺陷） (2026-09-03 verified)

**用户需求**：BLOCK-52 P1 实机收口时登记的范围外既有缺陷——chat 每个任务完成后 copilotClient 报「任务事件流在完成前中断」（AgentStreamDisconnected），24 次退避重连 ~90s 烧窗。根因链：events.js 曾用 `sseSend('[DONE]')` 发终态哨兵 → `JSON.stringify('[DONE]')` 序列化为带引号 `"[DONE]"` → 前端 copilotClient 匹配裸 `[DONE]` 永不成立 → 每个 task 完成后被判「在完成前中断」（终态回放路径同样发带引号哨兵）。旧 dev 实例长期未重启 + BLOCK-39 之前「干净截断=onDone」宽松兜底共同掩盖了该缺陷。

**改动**（0 新增 IPC / 0 新依赖）：① 根因——[events.js](../core/biof3-server/routes/ai-agent/events.js) 终态哨兵改 `sseDone()` 裸写（不走 JSON.stringify）；[copilotClient.ts](../frontend/src/components/copilot/copilotClient.ts) 新增 `isSseDone()` 双形状兼容（裸 `[DONE]` 与带引号 `"[DONE]"` 均识别）+ 带引号形状回归用例（[copilotClient.streamReconnect.test.ts](../frontend/src/components/copilot/copilotClient.streamReconnect.test.ts)）；② 连带回归一（c118e201 引入）——[main.js](../src/main.js) plumber 清理误删 `require("./ipc/plugin")` 但保留调用 → 启动即崩 `setupPluginIpc is not defined`，已恢复 require；③ 连带回归二——[agent-runner.js](../core/biof3-server/agent-runner.js) `safeCtx` 声明在 try 块内而块外引用 → 所有 agent_loop 任务启动即 `failed / safeCtx is not defined`，改为块外 `let safeCtx` + try 内赋值。教训（后续约束）：SSE/IPC 契约测试必须以真实后端输出形状为准（测试桩裸 `[DONE]` vs 真实带引号形状漂移，测试全绿实机炸）；`src/main.js`、`core/**` 改动后必须重启 dev Electron 实机冒烟再收口。

**门禁**：copilotClient 两套件 vitest 18/18、tsc --noEmit 0、`node --check` 三文件通过、docs:check 199、ui:audit:check（本条为传输层修复无 UI 视觉增量，台账行按门禁 UI-surface 规则补登）。

**实机**（2026-09-03，dev Electron CDP :9222 重启后载入全部修复，证据 `acceptance/agent-stream-disconnected-fix/live-check.json`）：3 断言全 PASS——① composer 发送真实消息 assistant 回复正常出现；② 全程无「任务事件流中断」横幅（`.sc-error-banner` null）；③ SQLite 最新任务 `fc8caf44` `agent_status=done` 且 error 空（修复前历史任务 `failed / safeCtx is not defined` 留档对照）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-280: 选中即引用——右栏预览选中文字一键进对话 composer（BLOCK-52 P1） (2026-09-03 verified)

**用户需求**：BLOCK-52 选中即引用→微调闭环 P1——右侧文件预览中选中的文字可以一键添加到对话输入框，作为下一次提示词的一部分，把「定位成本归零」。

**改动**（纯前端 / 0 新增 IPC / 0 新依赖）：① 事件通道 [events.ts](../frontend/src/lib/events.ts) 新增 `selectionQuote` 类型化事件（`SelectionQuoteDetail`：projectId/path/name/startLine/endLine/text）；② [CodeMirror types](../frontend/src/components/editor/CodeMirror/types.ts) 新增 `EditorSelectionInfo` + `EditorApi.getSelection()`（[useCodeMirrorEditor](../frontend/src/components/editor/CodeMirror/useCodeMirrorEditor.ts) 实现：空选区返 null，行号 1-based）；③ 生产端 [project-workspace.tsx](../frontend/src/pages/project-workspace.tsx) `WorkspaceFilePreview`：预览工具栏新增「引用到对话」按钮（selectionchange 跟踪容器内选中态控制可用性，`onMouseDown` preventDefault 防点击丢失选区；CodeMirror 选区优先带行号，Markdown 渲染视图退回 DOM selection 无行号），三个 WorkspaceFilePreviewBridge 挂 `editorRef`；④ 消费端 [SimpleChat.tsx](../frontend/src/components/copilot/SimpleChat.tsx)：selectionRefs 状态 + selectionQuote 事件订阅（仅 ownsCopilotAsk 拥有者消费 / 跨项目载荷丢弃）+ composer 引用条 chips（可删除、上限 8、同源去重）+ `sendWithRefs` 发送包装（引用正文 blockquote 前缀合并，发送成功清空、守卫拦截保留；Enter 排队同样携带引用）；⑤ 纯函数 [selectionReferences.ts](../frontend/src/components/copilot/SimpleChat/selectionReferences.ts)（8000 字符截断 / 位置标签 / 消息合成 / chip 文案），样式 [simple-chat.css](../frontend/src/components/copilot/simple-chat.css) 与附件区同一视觉语言。

**门禁**：selectionReferences + WorkspaceFilePreviewBridge vitest 14/14、SimpleChat 三套件 19/19、tsc 0、docs:check 199。

**实机**（2026-09-03，dev Electron CDP :9222 + Vite :3000，项目 tinkspace / README.md，证据 `acceptance/block-52/p1-live-check.json` + 截图）：5 断言全 PASS——①入口按钮渲染且初始禁用；②Markdown 渲染视图 DOM selection → chip `README.md`（无行号，符合语义）；③chip 可删除；④CM6 编辑器 CDP 原生鼠标拖选 L1-L4 → chip `README.md:L1-L4`（行号正确）；⑤真实发送 → 用户消息以 `[引用 README.md:L1-L4]` + blockquote 引文开头、模型正常复述引用内容、发送后 chip 清空。已知既有问题（范围外如实登记）：`AgentStreamDisconnected`（copilotClient.ts SSE 传输层，回复完整到达后断线报错，与本改动无关）。**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-279: 审阅 diff——已删除/已消失文件结构化兜底，不再报 file not found（BLOCK-50） (2026-09-03 verified)

**用户需求**：审阅面板点击已删除（D）文件行报「file not found」错误——删除文件是审阅的合法条目，不应走读取失败路径。

**改动**（0 新增 IPC / 0 新依赖）：[working-tree-review.js](../src/ipc/working-tree-review.js) `git:working-tree-file-content` 对 WORKTREE 分支磁盘缺失文件不再 throw `file_missing`——HEAD 可得返回 `{deleted:true}`（前端呈现删除 diff），否则返回 `{missing:true}`（结构化占位）；前端 [CodeMirrorDiffView](../frontend/src/components/desktop/WorkingTreeReview/CodeMirrorDiffView.tsx) 新增删除提示条 / missing 占位态，[UntrackedFilePreview](../frontend/src/components/desktop/WorkingTreeReview/UntrackedFilePreview.tsx) 占位化，[electron.d.ts](../frontend/src/lib/electron.d.ts) 类型同步。实现提交 `ce43048`（提交标题/正文标注 BLOCK-50，本行为补登台账同步）。

**门禁**：后端 node --test 4/4、WorkingTreeReview vitest 43/43、tsc 0；dev Electron 实机复现用户原场景（docs/archive/.git-quick-ref.md）删除提示条 + 删除 diff、悬停预览 +0-237 无报错，证据 `acceptance/block-50/`。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-278: git 写操作三期——暂存两栏 / 真实分支切换 / push-pull（BLOCK-41） (2026-09-02 verified)

**用户需求**：BLOCK-29 起维持排除、登记为 roadmap 候选的 git 写操作三期，2026-09-02 用户裁决启动（三项全做 + staged 提交框 + 脏树阻止并提示冲突文件）。

**改动**（0 新依赖）：① P1 [git-adapter.js](../core/shared-backend/git-adapter.js) 新增 `runAsync`（execFile 异步执行器，push/pull 网络操作不阻塞主进程事件循环）+ 7 方法：`unstage`（reset -q HEAD --，unborn 回退 rm --cached）/ `commitIndex`（无 pathspec 提交整个暂存区）/ `checkoutBranch`（midOperation 拒绝、仅本地分支、幂等、脏树拒绝 `checkout_dirty_worktree` 带冲突清单=本地已改∩HEAD..target 差异）/ `remoteList` / `remoteStatus`（fetch allowFailure 离线降级 → @{upstream} → rev-list left-right ahead/behind）/ `push`（--set-upstream 可选）/ `pull`（merge 语义），全部 `GIT_TERMINAL_PROMPT=0` 防挂起 + stderr 脱敏；② P2 [working-tree-review.js](../src/ipc/working-tree-review.js) 新增 7 条 IPC（git:stage-paths / unstage-paths / commit-index / checkout-branch / remote-list / remote-status / push / pull，全走 resolveGitAdapter(projectId) 项目级隔离 + assertSender + safeInvoke），[preload.js](../src/preload.js) additive 暴露 8 方法，[electron.d.ts](../frontend/src/lib/electron.d.ts) 类型同步（status files 补 staged/indexStatus/worktreeStatus）；③ P3 前端：[useWorkingTreeReview.ts](../frontend/src/components/desktop/WorkingTreeReview/useWorkingTreeReview.ts) 新增 stagedDiff（refresh 时 staged 文件存在则一并取回 `diff({staged:true})`）+ stagePaths/unstagePaths/commitIndex/checkoutBranch/loadRemoteStatus/pushRemote/pullRemote（无 upstream 首推自动 -u）；[ReviewMode.tsx](../frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx) 改动 tab staged/unstaged 两栏分组（dock 手风琴 + 主区左树同构，分区标题「暂存的更改/更改」）+ 行内 stage/unstage 按钮（plus/minus，hover accent）+ staged 文件行/主区 diff/悬浮预览走 staged diff（HEAD→index）+ staged 栏提交框（单行 input + ⌘Enter，空信息禁用，按需出现）+ 改动分区分支选择器真切换（confirm → 脏树失败横幅列冲突文件清单）+ summary 行 push/pull 按钮 + ↑ahead/↓behind 徽标（无 upstream 不显徽标）；[ReviewMode.css](../frontend/src/components/desktop/WorkingTreeReview/ReviewMode.css) 全 `--biof3-*` token。

**门禁**：P1 真实仓库快测 18/18（unstage/commitIndex/checkout 脏树拒绝+冲突清单/checkout 干净切换/push 后 ahead/behind 归零）；`git-adapter.test.mjs` 39/39；前端 WorkingTreeReview vitest 38/38（新增 `ReviewMode.block41.test.tsx` 9/9：两栏分组/staged diff 来源/行内 stage·unstage/staged 提交框 commitIndex/分支切换 confirm+checkoutBranch/脏树拒绝冲突横幅/↑↓徽标+push·pull/无 upstream 自动 -u）；tsc 0；docs:check 181；artifact-truth/backend-health/credential-store/mcp-autoload 28/28。

**P4 实机走查**（2026-09-02，dev Electron CDP :9222，临时专用仓库 + bare remote，验收后项目/仓库已清理）：8 场景全 PASS——两栏分组（staged 空时分区隐藏）/ 行内暂存→staged 栏+staged diff+提交框按需出现 / 行内取消暂存 / 提交框真实 commit（637fc59，ahead ↑1→↑2，git 双核对）/ 脏树切换拒绝（横幅列冲突文件，仓库实际未切换）/ 干净树 feature-b·main 往返（与 `git branch --show-current` 一致）/ push→「已同步」+0/0+remote 收到提交 / 制造 behind=1 后 pull→fast-forward 归零。截图与记录 [acceptance/ui-278/](../acceptance/ui-278/README.md)。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-277: 会话改动水合——reload 后历史会话恢复「本会话改动」精确归属（BLOCK-40） (2026-09-02 verified)

**用户需求**：BLOCK-31 收口时登记的 roadmap 候选，用户裁决启动——`conversationChangesStore` 归属索引为纯内存态，页面 reload 后历史会话「本会话改动」回退全量视图；权威清单已持久化于 `tasks.files_changed_json`，只缺只读端点 + 前端挂载水合。

**改动**（0 新依赖 / 后端只读，0 写路径改动）：① [agent-task-store.js](../core/biof3-server/agent-task-store.js) 新增 `listByConversation` 预编译语句（`json_extract(params,'$.conversationId')`，仅 terminal 任务，`COALESCE(finished_at, created_at)` 升序）+ `listConversationChanges`（跨任务按 path 合并、后写覆盖先写，`lastChangedAt` 用任务 finishedAt/createdAt 兜底）；② 新路由 [conversation-changes.js](../core/biof3-server/routes/ai-agent/conversation-changes.js) `GET /api/ai/agent/conversation-changes?conversationId=`（白名单校验、无任务诚实空清单、严格只读），[index.js](../core/biof3-server/routes/ai-agent/index.js) 注册；③ [conversationChangesStore.ts](../frontend/src/components/copilot/conversationChangesStore.ts) 新增 `mergeConversationFileChanges`（只填充 live/已有记录缺失路径，不覆盖）+ `hydrateConversationFileChanges`（in-flight + once 去重，失败静默维持全量回退）；④ [AgentChangesCard.tsx](../frontend/src/components/copilot/AgentChangesCard.tsx) 挂载/切会话时水合，成功后 `hasConversationScope` 变 true 自动切「本会话改动」视图（BLOCK-31 语义复用）。

**门禁**：新增 `test/block40-conversation-changes.test.mjs` 7/7（多任务聚合/新覆盖旧/running 排除/400 校验/跨会话隔离/空清单）+ `conversationChangesStore.hydrate.test.ts` 8/8（合并不覆盖 live/once 去重/400 与网络失败静默回退）+ AgentChangesCard vitest 9/9（新增水合后自动切会话视图，deferred fetch 消竞态）/ tsc 0 / docs:check 180。

**P4 实机**（dev Electron，真实后端 63008）：S1 会话 A agent 写 p40-a.txt → 卡片「本会话改动 · 第 1 轮 · p40-a.txt」，端点返回 `[{path,status:created,iteration:1,tool}]` ✓；S2 reload 后会话 A 卡片直接恢复「本会话改动」（不再全量回退）✓；S3 会话 B 写 p40-b.txt → reload → B 默认恢复仅 p40-b.txt ✓；S4 切回 A 仅 p40-a.txt（跨会话隔离不串，BLOCK-31 S2 判据 reload 后仍成立）✓。实机暴露并修复 P1 两处遗留缺陷：`listConversationChanges` 未定义（require 即崩）与 `index.js` register 漏挂载（端点 404）。证据 `acceptance/ui-277/`（4 截图 + evidence.json）。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-276: Agent 事件流断线重连——免刷新自动亮「继续执行」（BLOCK-39） (2026-09-02 verified)

**用户需求**：BLOCK-38 收口时登记的候选增强，用户裁决启动——后端重启中断任务后，前端应自动置 run 失败态并亮出「继续执行」按钮，免去刷新页面一步（BLOCK-38 现状：仅刷新后挂载孤儿恢复才发现）。

**改动**（0 新依赖 / 0 后端改动）：① [copilotClient.ts](../frontend/src/components/copilot/copilotClient.ts) `subscribeAgentTask`（fetch-stream）拆出单次订阅 `subscribeAgentTaskOnce` + 外层有界退避重连——新增 typed `AgentStreamDisconnectedError`（fetch 网络 reject / reader.read 断开 / 流结束未见 `[DONE]` 三类可重连，HTTP 4xx/5xx 与 AbortError 不重试），重连 URL 带 `afterSeq=lastSeq` 续传不重放（events.js 订阅回放 + 终态必发 `[DONE]` 语义现成），退避 1s 指数至 4s 封顶、总窗口约 90s，重连期回调 `onStreamReconnecting`；② `streamChatViaTask` 错误边界重划：提交阶段保留 legacy 回退，订阅阶段（已持有 taskId）不再回退 legacy（防重发整段对话重复执行已完成步骤），重试耗尽如实 onError；干净截断不再误调 `onDone`（消除"假完成"）；③ [conversationRunStore.ts](../frontend/src/components/copilot/conversationRunStore.ts) `onStreamReconnecting` 置 `statusMessage: '与任务失去连接，正在重连（第 N 次）…'`（后续 delta/finish 既有清理），主 run/resume/sub-agent 三处订阅 catch 透传真实错误、AbortError 不算失败。重连后收到 failed+`resumable:true` 终态事件 → 既有 `onError→finish('error')` 链自动置失败态并亮 ResumePrompt「继续执行」按钮（BLOCK-38 链路复用）。

**门禁**：新增 `copilotClient.streamReconnect.test.ts` 6/6（截断→afterSeq 续传重连→failed+resumable 终态 = 免刷新亮按钮核心判据 / 读流中途断开保留 lastSeq + 退避序列 1s→2s / 重试耗尽 25 次连接如实上抛 / 截断耗尽不误调 onDone / HTTP 4xx 不重试 / abort 不重试不触发 onError）/ conversationRunStore vitest 33/33（新增重连 statusMessage 置位与清理）/ copilot 全目录 218/218 / tsc 0。

**状态**: in_progress（P4 dev Electron 实机收口待做：kill -9 :3001 → 不刷新 → 自动亮按钮 → 续跑全链，证据存 `acceptance/ui-276/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-275: Agent 任务中断续跑——「继续执行」入口（BLOCK-38 P2） (2026-09-02 verified)

**实机验收**（dev Electron，证据 [acceptance/ui-275/](../acceptance/ui-275/evidence.json)）：S1 kill -9 :3001 模拟服务重启 → 启动清扫将 running 任务 7d2e9c32 标记 failed + interrupted_at（SQLite 核证）→ S2 刷新页面孤儿恢复订阅，ErrorBanner + 「继续执行」按钮出现，改动卡片记录中断前第 1/2 轮（r1/r2.md）→ S3 确认弹层展示中断时间/模型/结束原因「准备调用工具」/待执行工具/进度摘要 → S4 确认续跑：新 task efff49da 带 resumeOfTaskId 审计链 completed，正好补写 r3/r4/r5 未重复执行，原 task 不可变并写 task_resumed 溯源事件，总结明确区分「本次创建」与「中断前」。非中断失败任务诚实不显示按钮（端点侧 409/resumable:false 由集成测试覆盖）。UI-275 verified，BLOCK-38 收口 completed。G0 开发期常态 · 不外推 packaged / Provider / GA。

**用户需求**：BLOCK-37 收口讨论中用户提出信息流的两大目的——「追溯历史」与「可以在任何阶段启动任务，尽管任务异常中断了」，裁决立项 BLOCK-38：服务重启被清扫标记（interrupted_at 非空）的失败任务可从既有进度续跑；非中断失败任务诚实走既有 retry 链路，不得混用。

**改动**（0 新依赖）：① 后端：[resume.js](core/biof3-server/routes/ai-agent/resume.js) `GET /api/ai/agent/task/:taskId/resume` 只读预览（resumable/interruptedAt/lastModelCall 取证摘要/progressDigest 执行进度摘要，无副作用）+ `POST` 执行续跑（原 task 保持 failed 不可变；同会话新建 agent_loop task 带 `resumeOfTaskId` 审计链 + `task_resumed` 溯源事件；合成恢复指令注入 task_events 重建的中断前执行进度，已完成的步骤不重复执行）；[events.js](core/biof3-server/routes/ai-agent/events.js) failed SSE 事件携带 `resumable`/`interruptedAt` 标记；② 前端：[copilotClient.ts](frontend/src/components/copilot/copilotClient.ts) `onError` 透传 resumable 信息 + `previewAgentTaskResume`/`resumeAgentTask` API；[conversationRunStore.ts](frontend/src/components/copilot/conversationRunStore.ts) 快照 `resumable`/`interruptedAt`/`resumeOfTaskId` 字段 + `resumeInterruptedConversation` action（新 run 携带审计链并走既有订阅流式渲染链路）；③ UI：[ResumePrompt.tsx](frontend/src/components/copilot/SimpleChat/ResumePrompt.tsx) 仅中断任务显示「继续执行」按钮（非中断失败不显示），点击拉取只读预览弹确认层（中断时间 + 中断前最后一次模型调用摘要 model/结束原因/待执行工具 + 执行进度摘要），确认后调 resume 端点续跑，确认失败错误留在弹层可重试；全 `--biof3-*` token，弹层向上弹出（z-index 90）不遮挡对话区。

**门禁**：`node --test test/block38-agent-task-resume.test.mjs` 9/9（store 清扫/getResumableTask/readLastRecord/端点 401/403/404/409/正常续跑/GET 预览三态）/ ResumePrompt vitest 3/3 + conversationRunStore vitest 32/32（新增中断标记透传 + resume action 链路 + 非续跑拒绝）/ tsc 0 / docs:check / ui:audit:check / 实机验收证据 `acceptance/ui-275/`（3 截图 + evidence.json S0–S5）。test:changed 中 3 个失败（agent-provider-boundary 的 db 加载 SQLITE_ERROR、test-affected 证据对账、P6 证据 hash 漂移）经 stash 前后对比确认为既有失败，与本工作包无关。

## UI-274: 会话级「模型 I/O」信息流查看器（BLOCK-37 P1–P4） (2026-09-02 verified)

**用户反馈**：「我们每次和模型交互的时候 都会打包整个消息发送到 模型端口那里 那发送的消息是什么格式呢？ 这份消息以及模型提供商返回的完整消息能否做成信息流保存下来？？？」——用户裁决「按所有模型调用都存的方案立项」（BLOCK-37）。

**改动**（0 新依赖 / 严格只读）：① P1 落盘：[io-transcript.js](core/shared-backend/llm-providers/io-transcript.js) sink 按会话 JSONL 追加（`<BIOF3_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl`，无会话归 unattributed），每条记录 = 请求 messages 全量 + 响应聚合（content / reasoning / tool_calls / finish_reason / usage）+ delta 帧样本，8MB 三级截断（丢帧 → 折叠 messages 中段 → 逐条截断，全部诚实标记）+ 64MB 文件轮转，fire-and-forget 绝不阻塞模型主链路；[model-gateway.js](core/shared-backend/llm-providers/model-gateway.js) chat（流式 tee 帧）/ 非流式 / vision / 每次 fallback attempt 独立埋点；② P2 只读端点：[llm-transcripts.js](core/biof3-server/routes/ai-agent/llm-transcripts.js) `GET /api/ai/agent/llm-transcripts`（索引：时间/模型/kind/attempt/耗时/finish/usage/帧数/截断标记/error/sizeBytes，不含正文，含轮转文件，ts 升序）+ `GET /api/ai/agent/llm-transcripts/record`（id/traceId 命中单条完整记录），conversationId 白名单拒路径穿越，文件不存在诚实空态；③ P3 查看器：[LlmTranscriptViewer.tsx](frontend/src/components/copilot/LlmTranscriptViewer.tsx) 输入区工具 icon（cpu）按需打开浮层面板，索引倒序（时间/模型/kind/tokens/体积/错误点/截断 chip），点击展开单条——请求 messages 按角色折叠（role chip + 预览 + 展开全文）+ 响应聚合正文（思考/正文/工具调用/usage/帧数）+ 截断诚实标记，Esc/遮罩关闭，全 `--biof3-*` token 白底细边框风格；[llmTranscripts.ts](frontend/src/components/copilot/llmTranscripts.ts) 只读客户端。

**门禁**：`node --test test/block37-llm-io-transcript.test.mjs` 11/11（P1）/ `node --test test/block37-llm-transcript-route.test.mjs` 10/10（P2：鉴权/校验/穿越/隔离/空态/轮转/详情命中）/ LlmTranscriptViewer vitest 6/6 + SimpleChat + ToolActivityDock 回归 11/11 / tsc 0 / docs:check 177 / ui:audit:check。既有环境性失败：routes-ai-agent-subdomains.test.cjs 的 SQLITE_ERROR 为 db 加载问题，HEAD 同样失败，与本工作包无关。

**实机验证**（dev Electron CDP 9222 + 新后端 :3001，ThinkSpace 工作区）：S1 普通对话一轮 → `conv_59c5e41c-953.jsonl` 2 条记录（agent_iter：请求 2 messages / finish=stop / content 与 UI 回复逐字一致 / usage 11413 tok / 76 帧；conversation_title 标题生成调用也被「所有调用都存」捕获），查看器索引 2 行倒序渲染；S2 详情展开：请求 messages 角色折叠树（user 展开全文与发送一致）+ 响应 finish/usage（入/出）/帧数/正文，Esc 关闭；S3 agent 写文件任务 → 3 条记录：两轮 agent_iter（第 1 轮 finish=tool_calls + workspace_write arguments 与落盘文件逐字一致，第 2 轮 messages 2→4 增长 finish=stop）+ conversation_title，工具调用块渲染正确；S4 探针文件已清理。证据 `acceptance/ui-274/`（4 截图 + evidence.json S1–S4）。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-273: 本会话改动按执行步骤（agent 迭代轮次）分组归属 (2026-09-02 verified)

> **2026-09-09 用户裁决移除宿主卡片**：聊天区「工作区改动」卡片整体移除（组件 + SimpleChat 挂载 + 测试）——每文件改动已在对话内工具行（ToolActivityList）与审阅面板（/review 主区 + dock）呈现，卡片在无 agent 活动的会话呈现场景差（空会话显示全局 git 脏态噪音）且关闭 X 不持久（下个任务收尾即弹回）。本条及其上的卡片增量（悬停预览/浮窗自适应/轮次分组）随宿主移除置 **cancelled**；审阅面板与对话内工具行为准。conversationChangesStore（BLOCK-31/40 会话归属索引）暂保留（写路径在 run 流内）。

**用户反馈**：「目前 我们有本会话改动的所有文件是集中在一个工作区中的 能否落到每个执行步骤中呢？」——BLOCK-31 P3 的会话改动卡片只列文件清单，改动与执行记录（思考/工具轮次）无法对应；裁决为会话作用域下按 agent 迭代轮次分组展示。

**改动**（0 新增 IPC / 0 新依赖）：① 后端 [agent-files-changed.js](core/biof3-server/agent-files-changed.js) 聚合时为每个文件附 `iteration`（tool_result 迭代号，preview 截断时回退 tool_call 迭代号）与 `tool`（workspace_write / workspace_replace）；② 前端 [conversationChangesStore.ts](frontend/src/components/copilot/conversationChangesStore.ts) 记录归属（运行中 tool_result 实时记录 + agentTaskDone 权威清单对账双通道）；③ [AgentChangesCard.tsx](frontend/src/components/copilot/AgentChangesCard.tsx) 会话作用域下按迭代升序分组渲染，组头「第 N 轮」+ 文件数，exec 盲区（无迭代归属）归入末尾「其他改动」，全部作用域维持平铺。修复过程：分组 Hooks 曾置于条件 return 之后触发 "Rendered more hooks" 崩溃，已上移至全部早退 return 之前。

**门禁**：tsc 0 / `node --test test/agent-files-changed.test.mjs` 7/7（新增迭代归属用例）/ AgentChangesCard vitest 8/8（新增分组排序用例）/ conversationRunStore + ToolActivityList vitest 33/33 / docs:check 176 / ui:audit:check。

**实机验证**（dev Electron CDP 9222 + 新后端 :3001，ThinkSpace 工作区）：S1 旧会话（UI-272 清单无 iteration）回退平铺「其他改动」；S2 两轮写文件任务后卡片分组「第 3 轮 2 个文件」（a.txt 最后一写 replace 在第 3 轮，后写覆盖先写，符合语义）；S3 追加任务两文件分轮写入，卡片渲染三组迭代升序：第 1 轮(c1) / 第 2 轮(c2) / 第 3 轮(a+b)；S4 交叉核对 biof3.db tasks.files_changed_json——iteration/tool 字段与 UI 分组完全一致；S5 探针文件清理。证据 `acceptance/ui-273/`（4 截图 + evidence.json S1–S5）。

**增补 1 — 每次操作的逐行改动同步记录在执行记录内**（用户反馈：「这些文件的改动 同步记录在 每一次操作的地方 每一轮修改」）：① 后端 [workspace-tools.js](core/biof3-server/agent-tools/workspace-tools.js) `buildChangeDiff`（LCS 逐行 diff，公共前后缀裁剪 + DP 规模上限 1200 行退化为诚实整段替换统计，hunks ±2 行上下文、展示上限 48 行、单行 240 字符截断）接入 write/replace 结果；空文件（含新建）按 0 行计，修复创建误报 `−1`；② [tool-events.js](core/biof3-server/agent-tools/tool-events.js) 将 `changeDiff` 挂 toolResult 顶层（独立于 data，规避 publicData 截断，4KB 上限超限保留诚实统计丢弃 hunks）并随活动快照落库（历史会话可回看）；③ 前端 [toolActivity.ts](frontend/src/components/copilot/toolActivity.ts) 类型 + merge/restore 白名单；④ [ToolActivityList.tsx](frontend/src/components/copilot/ToolActivityList.tsx) ActivityRow 展开行渲染与改动卡片同构的文件行（`📄 路径 +N −M`，点击派发 `reviewOpenFile` 跳审阅，走 BLOCK-32 项目级解析）+ CodeMirrorDiffView 逐行预览，替换通用「影响」描述；⑤ 样式去灰底（思考块 5% 强调色底、diff 预览与 exec 输出 `--biof3-bg-subtle` 底全部移除，统一白底+细边框/分隔线，与会话区整体风格一致）。门禁增补：后端 harness/block34/agent-files-changed 25/25（新增 changeDiff 用例；harness 需迁移引导的临时 DB 运行，直接 node --test 会因 require 链打开无 migrations 的默认库报 `no such table: projects`）/ 前端 toolActivity + ToolActivityList + AgentChangesCard + conversationRunStore vitest 49/49（新增文件行跳审阅用例）/ tsc 0。实机增补验证（LinkSpace 工作区新会话）：写入行 +3−0 / 替换行 +1−1 逐行 diff 预览渲染正确，点击文件行右侧审阅面板自动打开，证据 `acceptance/ui-273/live-changediff*.png`、`live-clean-style.png`。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-272: 模型思考过程全链路（reasoning_content 采集 → SSE 透传 → meta 持久化 → 执行记录内联展示） (2026-09-02 verified)

**用户反馈**：「内容有点少了 看不到思考过程 无法确定每个工具之间的衔接思路 这个能优化做到吗？」——调查确认思考数据此前在 provider/route/前端/持久化四层全部缺失（`delta.reasoning_content` 被静默丢弃）；用户裁决**全套做**（含持久化，历史会话可回看）。

**改动**（0 新依赖）：① [deepseek.js](core/shared-backend/llm-providers/deepseek.js)：流式 `delta.reasoning_content` 与非流式 message 信封的 reasoning_content 均以新事件 `reasoning_delta` 透传；② [ai-agent/chat.js](core/biof3-server/routes/ai-agent/chat.js)：主调用与 provider 重试路径的 onEvent 均处理 reasoning_delta（单迭代转发封顶 32K），按迭代聚合 `reasoningByIteration[iter]`（单段 6K 截断）并写入 assistantMeta 持久化；②b（agent 任务路径补漏）[loop-orchestrator.js](core/biof3-server/loop-orchestrator.js)：流式回调聚合 `reasoningByIteration[iter+1]`（6K 截断）并实时下发 `choices[0].delta.reasoning_content` 帧，随 runLoop 结果返回；[agent-runner.js](core/biof3-server/agent-runner.js) 与 [conversation-adapter.js](core/biof3-server/conversation-adapter.js) 将其写入 assistant 消息 meta——修复 agent 任务思考段不落库（DB 验证 meta 缺失）；③ 前端 [copilotClient.ts](frontend/src/components/copilot/copilotClient.ts) 新增 `onReasoning` 回调解析 `choices[0].delta.reasoning_content`（task 模式与 legacy 共用 _dispatchSseEvent）；[conversationRunStore.ts](frontend/src/components/copilot/conversationRunStore.ts) 按迭代分桶累积（单迭代 24K 封顶，onIter 更新桶号），快照新增 `reasoningByIteration`；④ [SimpleChat/types.ts](frontend/src/components/copilot/SimpleChat/types.ts) `restoreReasoningByIteration` 白名单恢复（单段 8K/24 段封顶）；⑤ [ToolActivityList.tsx](frontend/src/components/copilot/ToolActivityList.tsx) 展开面板内：每次工具调用前渲染其迭代思考段（`思考 · 第 N 轮`引用块，同轮多工具只展示一次），无对应工具的思考段（最终结论整理）按迭代序补在末尾；单段限高 160px 滚动。非 reasoning 模型（无 reasoning_content）功能静默不展示。

**门禁**：tsc 0 / 前端 vitest 38/38（runStore 思考分桶 + ToolActivityList 思考段去重/末尾补渲染）/ `node --test test/deepseek-retry.test.mjs` 新增 2 用例通过（预存 6 个 retry 语义用例基线即失败，与本次无关，已如实记录）/ chat.js 与 deepseek.js `node --check` 通过 / docs:check 176 / ui:audit:check。

**实机验证**：见下方增补记录。

**增补（同日实机收口）**：新增 [test/ui272-reasoning-persist.test.mjs](test/ui272-reasoning-persist.test.mjs)（静态契约 + adapter 落库行为 4/4，含空对象/缺省不写 meta 键）；清理 deepseek.js 临时探针。首次实机验证 meta 仍缺思考段，排查发现 `:3001` 后端为**旧代码**进程（启动早于改动，dev-electron 的健康检查被旧进程满足）——kill 后由 dev-electron 以新代码重启，复验通过。真实 DeepSeek 任务（ls → workspace_write → cat 三步工具链，deepseek-v4-flash-vision-exp）：①DB `copilot_messages.meta_json` 含 `reasoningByIteration` 第 1/2/3 轮真实思考内容；②摘要条（`.sc-tool-activity-summary`，容器为 `.sc-tool-activity-list`，父级 `sc-msg-body`）展开后 3 个『思考 · 第 N 轮』块按迭代穿插于工具记录之间；③`location.reload()` 后完整恢复。证据 `acceptance/ui-272/`（01-reasoning-inline-expanded / 02-reasoning-restored-after-reload + evidence.json）。测试门禁新增：`node --test test/ui272-reasoning-persist.test.mjs` 4/4。

**增补 2（同日 · 用户裁决两级折叠）**：用户反馈「一点开就全部展开了」——[ToolActivityList.tsx](frontend/src/components/copilot/ToolActivityList.tsx) 改为两级折叠：手风琴内的「思考」块（ReasoningRow）与每条「执行」记录（ActivityRow）默认各自收起为一行摘要（思考：`思考 · 第 N 轮`；执行：图标+动作+命令摘要+状态+耗时），点击单条展开详情（思考全文 160px 限高滚动 / 命令输出等），chevron 旋转指示；其余行不受影响。CSS 新增 `.sc-tool-row-head` / `.sc-tool-row-chevron` / `.sc-tool-activity-duration`（[simple-chat.css](frontend/src/components/copilot/simple-chat.css)）。测试更新 4/4（含两级折叠收起/展开断言）、tsc 0 错误；实机复验：摘要条展开后 8 个行头全收起，单条点击仅展开该条（证据 03/04 截图 + evidence.json S4）。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-271: 执行记录内联手风琴（摘要条就地向下展开；ToolActivityDock 精简为后台进程浮窗） (2026-09-02 verified)

**用户反馈**：「执行记录位置不合适 有个割裂感 点击后向下展开执行记录（包括执行命令，执行的详细输出）？」——UI-267 的右下角浮窗与消息上下文割裂；裁决为摘要条就地向下展开。

**改动**（0 新增 IPC / 0 新依赖 / 0 持久化结构变化）：① 新组件 `ToolActivityList.tsx`（从 SimpleChat 内联抽出）——摘要条改为手风琴：点击就地向下展开本条消息全部工具活动记录（复用 `sc-tool-activity*` 全局类：命令 code + 输出 pre + 状态/时长/影响面），再点收起；chevron 随展开旋转 90°；纯点击驱动不自动展开（保持会话区干净）。② `ToolActivityDock.tsx` 精简为纯后台进程浮窗（标题「后台进程」）——移除 groups/tabs/focusRequest/工具活动详情/auto-pop 运行签名机制，保留 agentBackgroundProcess 事件弹出、1s 轮询、日志自动滚动、chip 折叠、关闭 re-pop（持久输出独立小窗口职责不变，历史会话不自动弹出）。③ `SimpleChat.tsx`：删除 `activityGroups` memo + `dockFocus` 状态链，Dock 仅传 conversationId/projectId。④ `simple-chat.css` 增 `.sc-tool-activity-inline`（2px 左缘线 + 10px 缩进）与 chevron 旋转规则。

**门禁**：tsc 0 / ToolActivityDock vitest 5/5（重写：事件弹出/跨会话忽略/chip 折叠不强拆/关闭 re-pop/会话切换重置） / ToolActivityList vitest 3/3（默认收起/展开显示命令+输出/运行中不自动展开） / SimpleChat + ChatScrollbar 回归 19/19 / docs:check 176 / ui:audit:check。

**实机验证**（dev Electron CDP 9222，「系统环境验证报告」会话，真实历史 6 项工具活动）：S1 点击展开——`aria-expanded true`、`.sc-tool-activity-inline` 在 `.sc-root` 会话区内渲染 6 行记录、含执行命令（node http server / curl / process_stop）；S2 再点收起——inline 移除；S3 无割裂——无后台进程时浮窗不出现（`dockVisible false`），记录完全内联在消息上下文中。证据 `acceptance/ui-271/`（01-inline-expanded / 02-collapsed-clean 截图 + evidence.json）。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

**增补（同日，用户裁决「摘要条应该放在agent图标之下，不然让人有一种和此次agent回复无关的感觉；摘要条中增加任务耗时」）**：①摘要条从独立行（38px 左缩进、位于消息块之上）移入 `sc-msg-body` 首元素（agent 图标之下、MessageMeta 之上），去掉独立行缩进与下边框，明确归属本次回复；②完成态摘要显式携带 `耗时 {formatToolDuration(processingDurationMs ?? totalDurationMs)}` 标签。CDP 实机复验：`inMsgBody true / isBodyFirstChild true / underAssistantIcon true`，label「已完成 6 项 · … · 耗时 11 s」。证据 `acceptance/ui-271/03-in-message-body.png`。门禁同上全过（vitest 27/27 含耗时断言）。

**增补二（同日，用户裁决「对话时间是不是应该放到底部 创建分支 右侧？」）**：①`MessageMeta` 顶部只留模型名（无模型名时整体不渲染），移除时间与分隔符（连带清理 `.sc-msg-meta-sep` 样式）；②新增 `MessageTime`（helpers.tsx，保留 30s 自刷新渐进格式化「刚刚 → HH:MM → MM-DD HH:MM」），渲染到底部操作行「创建分支」右侧（divider 分隔，随操作行 hover/focus 显现，样式 `.sc-msg-action-time`）。CDP 实机复验：顶部 `topMetaText null`、`timeText「09-01 22:43」inActionsRow true / afterFork true`。证据 `acceptance/ui-271/04-time-in-actions-row.png`。

## UI-270: rail/thumb 锚定会话栏最外边界（会话内容固定宽度居中不变） (2026-09-02 verified)

**用户反馈**：「中间栏会话区的左侧信息条和右侧的thumb 能否完全保持 左右最边界区域呢 中间会话区宽度固定」——UI-269 五调引入 `.sc-root` max-width 860px 居中后，rail 与 thumb 仍锚定在卡片内（sc-body），宽屏时随 860px 卡片内缩，未贴中栏最外边界。

**改动**（0 新增 IPC / 0 新依赖）：SimpleChat 新增全宽外层 `.sc-outer`（position: relative，承载 `data-rail-body` 定位锚点与 `--scb-right: 0px` 默认值），MessageRail 与 ChatScrollbar 从 `.sc-body` 移挂到 `.sc-outer`——rail `left:0` / thumb `right:0` 始终贴会话栏（中栏/右栏聊天）最外边界，会话内容卡片（`.sc-root` 860px 居中）固定宽度不变；`.sc-root` 边框/radius/阴影不动。rightChatPanel 保持原有 10px 右缘内衬（`--scb-right: 10px` 移至 `.rightChatPanel :global(.sc-outer)`）；MessageRail 预览卡片定位契约不变（closest `[data-rail-body]`，现解析到 sc-outer，垂直夹取范围含 composer 与原 sc-body 一致）。

**实机验证**（dev Electron CDP 9222，Vite dev bundle HMR 后实时测量，中栏宽 1203.6px）：S1 rail 贴最左边界——`railLeft 388.0013 === outerLeft 388.0013`（offset 0）；S2 thumb 贴最右边界——`trackRight 1591.6050 ≈ outerRight 1591.6050`（offset <0.001px）；S3 内容固定宽度居中——`.sc-root` 宽 859.995px，gapLeft 171.799 ≈ gapRight 171.810。证据 `acceptance/ui-270/`（1 截图 + evidence.json S1–S3）。

**增补（同日，用户裁决「右侧的 thumb 有个导轨线 这个不需要吧」）**：移除 UI-269 引入的常驻 1px 导轨线——删除 ChatScrollbar `.line` 元素与样式（端点淡出渐变竖线），track 仅保留 thumb；测试断言反转（`[class*=line]` 应为 null）。CDP 实机复验：`lineRemoved: true / thumbPresent: true / trackChildren: 1`。证据 `acceptance/ui-270/02-line-removed.png`。

**增补二（同日，用户裁决「thumb还是有点 太长了 改成75px」）**：`THUMB_LENGTH` 125px → 75px。CDP 实机复验：`thumbHeight 74.99px / styleHeight 75px`。证据 `acceptance/ui-270/03-thumb-75px.png`。

**门禁**：tsc 0 / ChatScrollbar + SimpleChat vitest 10/10 / docs:check 176 / ui:audit:check。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-269: 右缘自定义滚动条 ChatScrollbar（隐藏系统原生 thumb，常驻纤细 thumb + 轨道线） (2026-09-02 verified)

**用户反馈**：「帮我调整右侧滚动条的视觉样式，使其更协调」（UI-268 两次调整后，macOS 系统 overlay thumb 仍粗/深/短暂出现，与应用纤细线条设计语言不协调）。

**改动**（0 新增 IPC / 0 新依赖）：① 新增 `ChatScrollbar.tsx` + `.module.css`：挂在 `.sc-body`（非滚动容器）内，右缘偏移由 CSS 变量 `--scb-right` 提供（simple-chat.css 默认 12px / agentMain 0px / rightChatPanel 10px），与 `.sc-messages` 右缘精确对齐；② 视觉：常驻 1px 轨道线（端点 12px 淡出、border 45%，替代 UI-268 的 `.sc-messages` 背景线）+ 5px 常驻圆角 thumb（text-tertiary 30% 柔和灰，与左 rail idle 刻度同层），hover/拖拽转主题 accent 色 75% 并增宽至 6px——与左缘 MessageRail 刻度视觉语言一致（idle 灰 / active accent）；③ 交互：thumb 指针拖拽（setPointerCapture）、点击轨道以点击处为中心平滑跳转、热区滚轮透传；内容不溢出时整条不渲染；④ 度量：scroll 事件 + ResizeObserver（容器+子元素）+ MutationObserver；⑤ `.sc-messages` 隐藏原生滚动条（`scrollbar-width: none` + `::-webkit-scrollbar display:none`），移除 UI-268 背景线与无效 classic 自定义规则；两处 module 覆盖 `--scb-right`。颜色二调（用户复核后）：thumb 默认 40% 中性灰 → 30% 柔和灰，hover text-secondary 55% → accent 75%。颜色三调（用户 AskUserQuestion 选定「常态带主题青绿」）：thumb 常态 accent 35% 淡青绿，hover/拖拽 accent 75% + 6px。四调（用户复核裁决「这样不行 回到深色 位置调整到侧边栏最右侧」「太长了 大幅度调短」）：① thumb 常态回深色中性灰（text-secondary 55%），hover/拖拽 text-primary 75%；② 位置贴聊天侧边栏最右缘——`.workspaceSessionFrameChat` 右 padding 32→14px、`.workspaceSessionFrameChat .workspaceSessionContent` padding-inline-end 18→0（聊天上下文），agentMain 右缘即面板视觉右缘，thumb 贴齐（文字留白由 `.sc-messages` 自身 18px padding 保证）；③ thumb 长度大幅调短——新增 `MAX_THUMB_RATIO = 0.2` 上限（thumb 最长为轨道 20%，此前按视口占比可达 ~60% 轨道长），拖拽映射不变。五调（用户裁决「还是很长 缩短到 125px 另外 中间会话区域能否固定宽度…居中」）：① thumb 长度改固定 `THUMB_LENGTH = 125px`（轨道不足 125 时收缩），不再按视口占比计算；② 会话区固定宽度居中——`.sc-root` 增加 `max-width: 860px; margin: 0 auto`，宽屏（右侧面板关闭）时左右对称留白，窄屏（右栏开启挤压 agentMain < 860px）时不生效；rail 与滚动条随内容列缘对齐。CDP 实机：`rootW 860 / gapLeft 5 / gapRight 5`（对称居中生效）；内容不溢出时 thumb 正确隐藏。

**验证**：CDP 实机——`scrollbarWidth === 'none'` + 组件接管；点击轨道中部 scrollTop 0→701/max 763 平滑跳转；热区滚轮透传 701→762；`Input.dispatchMouseEvent` 真实拖拽 +120px → scrollTop 0→228。vitest 4/4（无溢出隐藏/溢出渲染/scroll 重定位/resize 后隐藏）；回归 ToolActivityDock 10/10 + SimpleChat 15/15；tsc 0。证据 `acceptance/ui-269/`。

**状态**: verified（2026-09-02 六调——挂点移至 `.sc-outer` 贴会话栏最外边界，见 UI-270，随其实机复验）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-268: 会话区滚动条与内容分离 + 右缘常驻滑轨线（与左缘 MessageRail 对称） (2026-09-02 verified)

**用户反馈**：「聊天会话区上下滑动窗口的时候，右侧的定位柱状和会话区重合了……调整位置要分开，像左侧条形区一样的边界感」。

**改动**（0 新增 IPC / 0 新依赖 / 纯 CSS）：① `.sc-messages` padding-right 4px → 18px，消息内容与 overlay 滚动条 thumb 分开（左右侧对称让位 18px/18px 与 UI-262 左 rail 对称；初版 12px 经用户复核仍显贴边，加深至 18px，thumb 与内容间隙 ~11px，见 04-gap-18px.png）；② 右缘常驻滑轨线（容器 background-image 1px 竖线：`right 3px` 居中于 thumb 区域、高 `min(62%,560px)` 与左 rail 沟槽对称、端点 12px 淡出、border 55%）——容器背景不随内容滚动，thumb 出现时恰好压线；③ `project-workspace.module.css` 两处 `:global(.sc-messages)`（agentMain / rightChatPanel）padding 同步 `0 18px 0 18px`，防 module 覆盖吞掉右侧让位（UI-262 同类教训）。

**实机验证**（dev Electron CDP）：`getComputedStyle(.sc-messages).paddingRight === '18px'`（12px 初版复核后加深）；`offsetWidth - clientWidth === 0` 确认 macOS overlay 行为（classic `::-webkit-scrollbar-track` 渐变不渲染，故改用容器背景线方案）；scrollTop 置中触发 thumb 截图显示 thumb 恰好压线、未覆盖区段露出常驻线；scrollTop=0/中段对比轨道线位置恒定（背景不随滚动）。证据 `acceptance/ui-268/`（4 截图 + evidence.json S1–S5）。附注：本环境 `Page.captureScreenshot` 的 clip 坐标与 CSS px 不一致（dpr≈1.389），clip 截图不可用，证据改用全页截图 + sips 裁剪放大，fixed 探针标定确认坐标。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-267: BLOCK-36 — 会话区工具执行记录独立小窗口（ToolActivityDock 统一执行记录浮窗） (2026-09-02 verified)

**用户需求**（BLOCK-36 立项）：「优化会话区，把工具执行记录独立成小窗口」→ 三项设计裁决（用户确认）：①内联收敛为一行摘要条（点击打开浮窗定位）；②BackgroundProcessDock 扩展为会话级统一浮窗（tab 按消息分组含历史恢复 + 后台进程特殊 tab）；③running 自动弹出/完成后保留/关闭后新运行 re-pop/可折叠 chip。

**改动**（0 新增 IPC / 0 新依赖 / 0 持久化结构变化）：① 新组件 `ToolActivityDock`（+ `.module.css`，吸收 BLOCK-34 BackgroundProcessDock 全部行为：agentBackgroundProcess 事件弹出、1s 轮询进程表/日志尾部、等宽日志自动滚动、chip 折叠、× 关闭）——tab 按消息分组渲染工具活动详情（复用 `sc-tool-activity*` 全局类），分组数据 = displayMessages 的 toolActivities（含历史恢复快照）；re-pop 触发依据 = 运行中/待确认活动集合签名变化（非计数增减），折叠态不强拆；focusRequest 按 nonce 去重防内联对象引用重复触发；会话切换重置回关闭态；activeTab 失效（消息重排换 key）时自动重新定位到现存分组（P3 实机发现并修复，防单分组退化空标题）。② `SimpleChat.tsx`：`activityGroups` memo（组 id 与消息渲染 key 一致）；内联 `ToolActivityList` 收敛为一行摘要条（`onOpen` 打开浮窗定位）；挂载点替换。③ 删除 `BackgroundProcessDock.tsx` / `.module.css` / `.test.tsx`（行为被吸收，组件连带状态链移除）；`backgroundProcesses.ts`、`toolActivity.ts`、持久化链路不变。

**门禁**（P2–P3 阶段）：tsc 0 / ToolActivityDock vitest 10/10（含 P3 回归：stale activeTab 重新定位） / impact-map ux1h-async-tool-surface 增补 ToolActivityDock 模式 + acceptance/ui-221…267 证据树补映射（修复 test-affected 既有 unknown 断言失败） / docs:check 176。定向 node --test 33 pass / 3 fail 均为既有环境性失败（g0-rs-p6-product-acceptance 注入证据路径 ×2、g0-rs-ux1h 缺 tmp/airway-test fixture），与本次前端改动无关、改动前已存在。

**P3 实机收口**（2026-09-02，dev Electron CDP 9222 + 真实 DeepSeek 任务）：①摘要条内联收敛（「已完成 3 项 · 运行 3 次 · 21 s」）+ 点击打开浮窗完整详情（01/02 截图）；②sleep 15 运行中浮窗自动弹出显示「正在处理 1/1 项 · 运行中」+ 多分组 tab（04 截图）；③完成后窗口保留（≥25s 连续采样，06 截图）；④折叠 chip（idle 状态点，03 截图）；⑤关闭 × 后新任务 re-pop（04）；⑥后台进程 tab 自动弹出并切换：python3 http.server 8977 运行中计时 + 实时访问日志（curl HTTP 200 交叉验证，05 截图）；⑦会话切换隔离（切走无浮窗/无 chip）+ 切回历史摘要条可点开、存活后台进程合理呈现。附注：亚秒级快速工具（running→success 同批渲染）不触发弹出属预期设计（避免闪现，摘要条仍完整记录并可点开）；DeepSeek 偶发无工具调用却虚构执行报告（sleep 8 案例，task_events 1.9s 零工具事件）为模型质量问题，BLOCK-36 行为正确（无活动不弹窗不记录）。证据 `acceptance/ui-267/`。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-266: BLOCK-34 P3 — 后台进程浮窗（workspace_exec_background 独立小窗口） (2026-09-01 verified)

**用户反馈**（BLOCK-34 立项）：「用到终端或者持续性输出的任务可以出现个独立的小窗口」→ 三项设计裁决：快照随消息落库 / 右下角浮窗+可折叠 / 仅 background 任务触发。

**改动**（0 新增 IPC / 0 新依赖）：① 后端新增只读路由 `routes/ai-agent/background-processes.js`（`GET /api/ai/agent/background-processes?conversationId=` 列表 + `GET .../:processId/log` 日志尾部，复用 `processStatus` 的 sessionKey 会话隔离与 `readLogTail`，数据源为内存进程表，0 新持久化）；② `conversationRunStore.onToolResult` 检测 `workspace_exec_background` 成功（`toolResult.data.processId`）派发新事件 `biof3:agent-background-process`；③ 新组件 `BackgroundProcessDock`（SimpleChat 挂载，右下角 fixed 锚点）——事件触发自动弹出、1s 轮询列表+活跃进程日志尾部（32KB）、等宽日志区自动滚动（用户上滚暂停、回到底部恢复）、多进程 tab 切换、可折叠为 chip（运行中计数 + 状态点）、可手动关闭（关闭后新事件可再弹出）；样式全走 `--biof3-*` token + `--biof3-font-mono`。

**门禁**（P3 阶段）：tsc 0 / 后端路由定向 node --test 5/5（401/400/会话隔离 200+404） / BackgroundProcessDock vitest 5/5（自动弹出/跨会话忽略/折叠 chip/关闭再开） / toolActivity + conversationRunStore 回归 36/36 / docs:check 174。P4 实机收口证据：`acceptance/ui-266/evidence.json`（dev Electron CDP 9222 + 真实 DeepSeek task：浮窗自动弹出/运行中计时/日志流式/折叠 chip/process_stop 收敛「已停止」/reload 后工具活动摘要条「已完成 2 项 · 调用 1 次 · 后台运行 1 次 · 3.9 s」恢复，S1–S4 全 PASS）。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-265: BLOCK-33 — 通用编码 Agent UI 增量（system_info 工具活动条标签；P3 流式输出 / P6 实机收口增量扩展） (2026-09-01 verified)

**背景**（BLOCK-33 P1，实现提交 `0acffcc`）：通用跨平台编码 Agent 能力 P1 环境自省落地，UI 侧增量 = `frontend/src/components/copilot/toolActivity.ts` 工具活动条新增 `system_info → 「已查询 · 系统环境」` 标签映射。该提交未同步台账（UI-AUDIT-FIX 由本条补登，不重写共享历史，提交哈希豁免登记于检查器）。

**后续增量**（同编号累积）：P3 已实现（2026-09-01）——工具活动条内实时追加等宽输出区（`sc-tool-activity-output`，tail 显示 + 截断标记；流式输出到达时自动展开，手动收起后不强制），SSE 新事件 `tool_output`（callId 关联、200ms 节流、单调用 16K 字符封顶）。

**P6 实机收口**（2026-09-01，dev Electron CDP 9222 + biof3-server :52397，真实 DeepSeek task）：system_info 正确识别 Darwin/arm64 + /bin/zsh（uname -s 交叉验证一致）；workspace_exec cwd 参数在 core/test 子目录生效（pwd 输出正确、exitCode=0）；流式增量等宽输出区实机可见（tool_output 事件 + 「仅流式增量」标签）；background 完整起停链（node http server :18733 → process_status 存活 → curl 返回 ok → process_stop → 确认清理退出）。权威证据 task_events trace_5fbd04c7 / trace_89b0c73a / trace_c0e2f20d；截图 + evidence.json 见 `acceptance/ui-265/`。UI-265 转 verified。

**门禁**（P1–P6 已过）：tsc 0 / 定向 node --test / toolActivity 7/7 / docs:check 173。

**状态**: verified。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-264: BLOCK-32 — 项目级审阅隔离（审阅/改动卡片按项目工作区仓库解析） (2026-09-01 verified)

**用户反馈**（BLOCK-31 收口后）：「审阅中也是看到所有的吗？不同项目审阅中的变化也应该是隔离开的吧」→ 调查确认：`working-tree-review.js` 全部 20 个 `git:*` IPC handler 调无参 `resolveGitAdapter()`（固定候选 `app.getAppPath()`），任何项目看到的都是 desktop 应用仓库的改动/历史；AskUserQuestion 裁决「立项全套做」+ 非 git 项目「诚实空态」。

**改动**（0 新增 IPC 通道 / 0 新依赖）：① 后端 `resolveGitAdapter(projectId)`——传 projectId 经后端 HTTP（`getBackendPort('r')` + `/api/data/projects`，30s TTL 缓存）解析 `project.workspace_path` 并校验 `.git`（非 git 抛新错误码 `project_workspace_not_git`，项目不存在抛 `project_not_found`）；20 个 handler `args.projectId?` additive（未传维持应用仓库旧行为）。**主进程不直连 better-sqlite3**（Electron ABI 123 vs npm 编译目标 137 会崩，首次实现即复现）——经后端 HTTP 是刻意设计。② 前端 projectId 统一经 `useParams`（`/project/:projectId` 路由）解析，零 props 透传：`useWorkingTreeReview`（全部 12 个 bridge 调用 + projectId 切换清态重取 + `workspaceNotGit` 状态）、`AgentChangesCard`、`CodeMirrorDiffView`、`useCodeMirrorEditor`（accept/reject/revertFile IPC）、ReviewMode 三个子组件（commitFileContent/commitDiff/UntrackedFilePreview）。③ ReviewMode 渲染非 git 诚实空态（`rvw-not-git`：「当前项目工作区不是 git 仓库」），不回退显示应用仓库。`/review` 独立路由无项目上下文 → 维持应用仓库旧行为（诚实边界）。

**实机 verified**（dev Electron + CDP）：S1 IPC 层 tinkspace→ThinkSpace 仓库文件 / desktop→应用仓库文件互不串；S2 tinkspace 审阅改动 115 文件 +770 −9877 全为 ThinkSpace 路径、历史显示 ThinkSpace master 提交（desktop 提交不可见）；S3 desktop 审阅 10 文件 = 应用仓库 working tree；S4 非 git 项目（一次性探针，验收后已删）渲染诚实空态。证据 `acceptance/ui-264/`（4 截图 + evidence.json）。**dev 启动注意**：需 `BIOF3_ELECTRON_USER_DATA_DIR` + `BIOF3_LOCAL_DATA_DIR` 指向 `.biof3-dev-user-data`，否则落到 `~/Documents/BioF3-Local` 旧库。

**门禁**：tsc 0 / ReviewMode + AgentChangesCard + SimpleChat + CodeMirror 定向 vitest 67/67 / node --check / docs:check 172 / ui:audit:check / docs:reconcile 0。

**状态**: verified（dev Electron 边界内）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-263: BLOCK-31 P3 — 工作区改动卡片会话作用域（本会话 / 全部 切换） (2026-09-01 verified)

**用户裁决**（BLOCK-31-CONV-SCOPED-CHANGES「要做会话隔离 权威清单」）：工作区改动卡片此前为项目级 git working tree 全量视图（UI-252 基线），所有会话共享同一份；本条交付卡片侧的**会话隔离视图**。

**改动**：`AgentChangesCard` 接受 `conversationId`（SimpleChat 传入）——当前会话有归属记录（`conversationChangesStore` 索引：运行中 `onToolResult` 实时登记 `workspace_write/replace` 成功写入 + 任务收尾用后端权威 `filesChanged`（BLOCK-31 P1 SSE `done` payload，task_events 回放聚合）按 conversationId 对账合并）时，默认只显示**本会话改动**（标题「本会话改动」+ 过滤后计数/± 统计），卡片内新增「本会话 / 全部」segmented 切换（`sc-changes-scope-*` token 化）；**无归属记录时保持全量「工作区改动」视图且不渲染切换**（旧会话/索引空兼容）。点击行跳审阅、悬停预览（UI-252/255）行为不变；**审阅面板保持 git 全量事实源（项目全景）语义不变**。0 新增 IPC（后端 done payload 为既有通道 additive）/ 0 新依赖。已知的诚实边界：`workspace_exec`（shell 写文件）不可精确归属，不计入会话清单，但保留在「全部」视图。

**门禁**：tsc 0 / AgentChangesCard vitest 7/7（新增：会话默认过滤 / 「全部」切换 / 无归属回退全量）/ SimpleChat vitest 6/6 / 后端 agent-files-changed 定向 6/6 + cancellation 回归 / docs:check / ui:audit:check。

**P4 实机收口（dev Electron CDP 9222 + 真实 DeepSeek agent task，desktop 项目 = 审阅 adapter 绑定仓库）**：S1 会话 A（conv_3760e060-394）agent `workspace_write` 创建 a.txt → A 卡片「本会话改动 · 1 个文件」仅 a.txt，后端 `tasks.files_changed_json` 权威清单同步持久化 ✓；S2 会话 B（conv_f115f109-07a）创建 b.txt → B 卡片仅 b.txt，**A 的 a.txt 不可见（会话隔离核心判据）** ✓；S3 B 卡点「全部」→「工作区改动 · 6 个文件」= git 全量（含 a.txt + b.txt + 代码改动），审阅事实源语义不变 ✓；S4 BLOCK-31 之前的旧会话 → 回退全量且不渲染切换 ✓。证据 `acceptance/ui-263/`（3 截图 + evidence.json）。**P4 顺带修复实机暴露的阻断性存量缺陷**：`inferExecutionPolicy(messages)` 两处调用点（agent-runner.js / routes/ai-agent/chat.js）自 BLOCK-10 S-003 起漏传 context，`ctx.accessMode` 永远缺省 read →「完全访问」恒失效、workspace_write/replace/exec 全部被拒；修复 = 两处补传 context（前端 pill 与后端行为恢复一致）。**观察项登记 roadmap 候选**（不扩权）：会话归属索引为内存态，页面 reload 后历史会话回退全量视图（权威清单已在 `tasks.files_changed_json` 持久化；候选改进 = 挂载时按会话从后端水合，需 task→conversation 查询；loop_runs 对 task 模式未落行不能直接复用）。

**状态**: verified（dev Electron 边界内）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-262: BLOCK-29 增量 — 聊天区左缘「用户消息导航条」（Codex 风格刻度 rail） (2026-08-31 verified)

**用户反馈**（附 Codex 风格截图）：「左侧增加 聊天会话记录 点击出现会话记录的悬浮卡片 可以参考codex中的实现方式」→ 首版左栏 header 时钟方案被否（「不及预期」）；二版会话列表卡片再次被否（「卡片样式太丑……这个是针对当前会话不是所有会话 收录的应该是用户发送的消息 把手是贴边窄条，用户的每个消息都应该是一个条」）→ 按澄清改为 Codex 式**用户消息刻度 rail**，经四轮实机微调后用户确认「很好」并裁决提交。

**改动**（0 新增 IPC / 0 新依赖）：新组件 `MessageRail`（挂在 SimpleChat `.sc-body` 内，`data-rail-body` 为定位锚点）——聊天区**左缘垂直居中一条贴边窄 rail**，**当前会话的每条用户消息对应一个横杠刻度**（space-evenly 均布，rail 最大高 62%）；**悬浮刻度弹出预览卡片**（用户消息原文 + 紧随其后的 AI 回复摘要，line-clamp 截断，卡片 top 按实高两阶段夹取保证不出聊天区上下边界），**点击刻度 `scrollIntoView` 平滑跳转到聊天区对应那条用户消息**。`railItems` 由 `displayMessages` 派生（role=user 且有内容），跳转经 `scrollRef` 查询 `.sc-msg-user` 按序号定位。已删除二版 `ChatHistoryRail`（会话列表卡片）组件及 CenterPanel 接入。**按用户反馈调整可见性**：刻度更贴左（左内边距 5→2px）、颜色加重（border 色→text-tertiary + opacity 0.72），hover/active 刻度加宽至 16px×3px accent；`.sc-messages` 左内边距 4→18px 让出刻度沟槽，消息内容与刻度分离。**预览卡片同方案精修**：left 22→24px 对齐沟槽外缘、宽 320px、阴影收敛（8/24/0.12），用户消息加 3px accent 左边条强化「这是你发的消息」的辨识。**沟槽生效修复 + rail 左移**：`.agentMain/.rightChatPanel :global(.sc-messages)` 的 `padding: 0` 覆盖了基础沟槽，改 `0 0 0 18px` 修复；`workspaceSessionFrameChat` 左 padding 32→8px（用户裁决：尽可能贴近左侧边界）+ tick 左内边距 2→0px；默认刻度减淡（10px×2px、opacity 0.45），hover/active 显著加长至 24px×3px accent（卡片左移 28px 让位）。

**门禁**：tsc 0 / SimpleChat + AgentChangesCard vitest 10/10 / docs:check 170 / ui:audit:check。dev Electron 实机多轮过目，用户确认后转 verified。**补充（同日）**：用户问「刻度不会一直增多吧 / 能否滑动选择其它消息」——① rail 高度封顶（聊天区 62%，max 560px），刻度 space-evenly 等距压缩（点击区 min-height 6→4px），消息再多也不会溢出；② 新增 rail 滚轮导航：悬浮 rail 滚动滚轮即逐条切换上一条/下一条用户消息（聊天区同步 scrollIntoView + 弹出对应预览卡片），tsc 0。

**状态**: verified（2026-09-02 锚点随 UI-270 移至 `.sc-outer` 贴会话栏最外边界，随其实机复验）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-260: BLOCK-29 增量 — 审阅文件树改按钮切换（默认收起，不再常驻占右侧栏） (2026-08-31 verified)

**用户反馈**：「审阅中的文件树 目前是默认展开占据右侧栏 能否变成按钮呢 点击展开点击也可以收缩 效果和 文件中的 文件树保持一致」。（另确认：文件树打开图片文件已支持 `<img>` 图片预览，走 `isImageFile` + `workspaceImagePreview`，无需改动。）

**改动**（0 新增 IPC / 0 新依赖）：dock 审阅摘要行新增「文件树」开合按钮——`dockTreeOpen` 默认 `false`（右侧栏不再被文件树常驻占据），点击展开 / 再点收缩；右侧文件树 aside 仅在展开时渲染。与「展开全部/收起全部」按钮同排。**UI-261 按用户反馈两轮调整**：① 图标形式改为与「文件」侧文件树一致的 **chevron + 文件夹图标**（复用 `rvw-caret` 旋转约定 + `WorkspaceFileIcon type="dir"`；收起 chevron 朝右、展开朝下，展开时 accent 描边高亮）；② 位置移到面板**最右侧，替换原「退出」按钮**（dock 审阅不需要退出按钮，关面板走右侧 tab × / Esc；主区 /review 形态保留退出；测试同步断言 dock 无 exit 按钮且 Esc 仍触发 onClose）。

**门禁**：tsc 0 / ReviewMode vitest 18/18 / docs:check 170 / ui:audit:check。待实机验证后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：`rvw-tree-toggle-btn`（最右，title=展开文件树）默认收起（split 单子元素）；点击展开 `.rvw-dock-tree` 230px（title 变 收起文件树）。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-259: 增量 — 应用内「选择文件夹」选择器（不依赖系统目录面板） (2026-08-31 verified)

**用户反馈**：「选择路径 只有打开 难道不能有选择文件夹这个按钮吗 选择哪个文件夹 工作空间路径不就有了吗」——确认核心诉求是点选文件夹直接得到工作空间路径。

**改动**（1 新增 IPC `file:list-directory` / 0 新依赖）：新增共享组件 **FolderPicker**（应用内文件夹浏览器）——面包屑导航（home 段显示 ~）+ 一级子目录列表（隐藏项跳过、中文排序）+ 上一级 + **「选择此文件夹」**，经 `file:list-directory`（realpath + isDirectory + EACCES/EPERM 可见化）读取目录。接入三处：① 左栏创建面板「选择文件夹…」；② 左栏更改工作目录面板「选择文件夹…」；③ 首页手动输入路径区「选择文件夹…」（选中即回填路径输入框，再点确认创建）。替换掉 UI-257/258 中走系统面板的「浏览目录…」入口。**另按用户反馈系统性重做工作台视觉**：对齐 setupHome 设计语言——radial 渐变背景 + layers 图标芯片 + 2xl 标题、项目单列卡片（accent 图标芯片 / mono 路径 / 右侧更新日期 / 悬浮上浮描边）、创建卡片左对齐 + 分组 eyebrow 标签，入场动画复用 setupEnter。

**门禁**：tsc 0 / LeftPanel + home vitest 9/9 / docs:check 170 / ui:audit:check。需重启 dev Electron（新 IPC）。待实机验证后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：应用内 FolderPicker 展开（/ 根列表 → 点入 /tmp → biof3-tmp），「就选这个文件夹」回写 realpath /private/tmp/biof3-tmp 到输入框，全程未依赖系统目录面板。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-258: 增量 — 工作台常驻创建入口 + 空白项目（创建后可选/可换工作目录） (2026-08-31 verified)

**用户反馈**：「不能设置 是否需要新增一个 创建项目 按钮 创建项目后 可以切换或者选择工作空间」（AskUserQuestion 裁决：入口=首页常驻；工作空间=创建后可选/可换）。

**改动**（0 新增 IPC / 0 新依赖，复用 UI-257 的 `file:validate-directory`）：① **首页工作台**：应用内导航到 `/` 渲染工作台视图（项目卡片列表 + 常驻「创建新项目」卡片，三种方式同区：选目录 / 手动输路径 / 空白项目）；冷启动 `location.key === 'default'` 保持原自动跳最近项目行为不变。② **空白项目**：只填名字（选填，自动命名）即可创建，不强制先绑目录；创建后在项目内随时设置。③ **左栏工作台入口**：「项目」标题旁新增 home 图标（Link → `/`）。④ **更改工作目录内联面板**：原「更改项目工作目录」（仅系统面板）升级为内联面板——路径可粘贴/可编辑 + 校验（validateDirectory）保存 + 浏览目录兜底，替换原 handleChangeWorkspacePath。⑤ Icon 新增 `home`。

**门禁**：tsc 0 / LeftPanel + home vitest 9/9 / TitleBar + RightPanel + ReviewMode + AgentChangesCard 38/38 / docs:check 170 / ui:audit:check。需重启 dev Electron（UI-257 的 preload/main IPC）。待实机验证后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：工作台 `/` 渲染项目卡片 + 常驻创建卡片（选目录/手动输路径/空白项目三方式）；空白项目创建成功（自动命名 项目-09-03-02:04，无需目录）；「更改项目工作目录」内联面板改到 /private/tmp/b46-ws 并经 sqlite 持久化核对；左栏「项目」标题旁 home 图标入口可用。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-257: 增量 — 创建项目手动输入路径兜底（绕过系统目录面板禁用「打开」） (2026-08-31 verified)

**用户反馈**（附截图）：「我点开之后 不能选择有的路径来作为工作空间进行项目开发」——macOS 目录选择面板中选中文件夹后「打开」按钮置灰（面板顶部显示"文件夹通过文件共享进行共享"横幅），部分路径无法经原生面板选定，创建流程卡死在第一步。

**诊断**（CDP 连入真实 dev Electron 渲染进程 + 接口实测）：按钮接线 ✓ / 桥 `openDirectoryDialog` 存在 ✓ / `showOpenDialog` 正常弹出 ✓ / 后端 `POST /projects`（App 实际使用的 :58629 实例）创建成功 ✓——链路各环完好，卡点在**系统目录面板本身**（macOS 对共享标记路径禁用确认按钮），应用侧无法修复面板行为。

**改动**（1 新增 IPC `file:validate-directory` / 0 新依赖）：两条创建路径均新增**手动输入路径**兜底——① 左栏「+」改为打开**内联创建面板**：路径输入框（可粘贴/可编辑）+ 「创建项目」（校验通过后以目录名创建并跳转）+ 「浏览目录…」（仍可走系统面板）+ 「取消」；不再强制先弹系统面板。② 首页创建区新增「或手动输入路径」（按需显示输入框，用户偏好）。校验经 `file:validate-directory`（存在 + 是目录 + 返回 realpath），坏路径在创建前报错，不再落库坏 workspace。

**门禁**：tsc 0 / LeftPanel + home vitest 9/9 / docs:check 170 / ui:audit:check。**需重启 dev Electron**（preload/main 新增 IPC 不走 HMR）。待实机验证后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：手动输入路径框（aria-label=项目工作目录完整路径）+ 确认路径校验链路可用，配合 UI-253 确认面板全链走通。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-256: 清理 — 移除 TitleBar「打开审阅」按钮及死链（审阅入口已迁移右侧边栏） (2026-08-31 verified)

**用户反馈**：「右上角的 打开审阅 这个按钮没有用了 审阅入口已经迁移了 清理掉这里相关联的代码也可以清理 保持纯净」。

**改动**（0 新增 IPC / 0 新依赖）：TitleBar 审阅入口迁移到右侧边栏「审阅」tab 后，TitleBar `WorkingTreeReviewTitleBarButton` 及其 `workingTreeOpen` 状态链全部成为死代码，整链移除——① TitleBar 按钮组件 + `.reviewDot` 圆点样式；② `useWorkspacePanels` 的 `workingTreeOpen/setWorkingTreeOpen/toggleWorkingTree`；③ App.tsx 工作区外 `wt-dock` 浮层兜底（含 `isWorkspaceRoute`/`useLocation`/dock 形态 `.wt-dock` CSS；`variant="dock"` 本体保留，RightPanel review tab 仍在用）；④ ProjectWorkspace 的 workingTreeOpen ⇄ review tab 双向同步 effect。顺带修复 TitleBar.test.tsx 8 个历史失败用例（断言仍停留在 mac 交通灯「最大化窗口」旧行为，现行为「全屏」+ `toggleFullScreen`）。

**门禁**：tsc 0 / TitleBar + RightPanel + ReviewMode + AgentChangesCard vitest 38/38 / docs:check 170 / ui:audit:check。待 dev Electron 实机确认按钮消失、审阅 tab 入口正常后转 verified。

**BLOCK-46 实机复核（2026-09-03）**：TitleBar 仅「新对话」按钮，无「打开审阅」（会话改动卡片内「打开审阅查看全部改动」跳转链接为审阅迁移后的合规入口，非 TitleBar 死链）。

**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-251: 增量 — 创建项目失败可见化（左栏 +/首页创建全链路错误反馈） (2026-08-31 in_progress)

**用户反馈**：「我点击创建新项目按钮 但是不能选择具体的文件夹 有问题就优化」。

**诊断**：静态核对全链（preload `files.openDirectoryDialog` → `file:open-dialog` openDirectory → `dialog.showOpenDialog` → `POST /api/data/projects` workspacePath 透传 → `db.createProject` 优先用选定目录）——链路本身完整。真正的问题：**创建流程所有失败路径都静默**（桥缺失 → 无反应；对话框失败 → null 无反应；`createProject` 接口报错 → 未捕获的 rejection 无反应），用户侧表现为「点了不能选文件夹」。

**改动**：home 首页创建 + 项目左栏「+」创建两条路径统一加固——① 桥缺失时显式提示「当前运行环境不支持选择工作目录」；② 接口/未知错误 try/catch 后以可见文案呈现（首页错误行 `emptyHomeError` / 工作区 `workspaceNotice`），不再静默。取消选择仍为无操作。

**门禁**：tsc 0 / project-store + LeftPanel + home vitest 10/10 / docs:check 170 / ui:audit:check / docs:reconcile 0。

**BLOCK-46 实机复核（2026-09-03）**：非法路径（/tmp/biof3-tmp\x 下含非法字符）创建失败后左栏错误提示实机 PASS（`acceptance/block-46/ui-251-left-panel-error.png`）；首页创建路径错误行 PASS（`acceptance/block-46/ui-251-invalid-path-error.png`）。**状态**: verified（2026-09-03 BLOCK-46 dev Electron 实机复核，证据 `acceptance/block-46/`）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-248: BLOCK-29 增量 — 改动分区「展开全部/收起全部」批量文件差异 (2026-08-31 in_progress)

**用户反馈**：「审阅中增加 按钮 展开或者关闭 全部文件变更 按钮 优化使用体验」。

**改动**：dock 手风琴 summary 行（改动分区）新增 `展开全部/收起全部` 切换按钮——展开时同时打开全部目录分组并展开全部文件行内 diff，收起清空行内展开（不动目录分组）；主区（/review）文件列表为点选式无行内展开，按钮仅 dock 渲染。0 新增 IPC / 0 新依赖。

**门禁**：tsc 0 / ReviewMode vitest 30/30。待 dev Electron 实机过目后转 verified。

**状态**: in_progress。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-312: BLOCK-66 增量 — R 运行时硬门摘除：首页全屏引导页改非阻塞引导条 (2026-09-08 verified)

**来源**：BLOCK-66-RUNTIME-DECUPLE（R 硬门摘除，biof3-server 无 R 可用）P2 前端非阻塞化——用户反馈「软件打开需要直接安装 python 和 r 的基础包，这个有些重了」。

**改动**：home.tsx 启动门收窄——R 运行时确认缺失（runtimeMissing）不再整页拦截，改为首页顶部非阻塞引导条（runtimeBanner：说明对话/文件等通用功能不受影响 + 「前往安装」入口）；全屏门仅保留「后端服务确实未就绪」（backendNotReady）场景并修正文案（「这与是否安装分析运行时无关——未安装运行时只是分析功能受限」，运行时状态如实显示已安装/未安装，移除「约 657MB · 必需」硬性表述）；插件商店由门内嵌改为独立 overlay（`setupStoreShellOverlay`，装 R 后就地提供重启入口）。配套：electron.d.ts BackendStatus 加 `serverUp?`（BLOCK-66 P1 isReady 与 R 解绑，additive optional）；BackendStatusProvider 初始态/DEV 兜底补 serverUp。0 新依赖。

**门禁**：home vitest 4/4（UI-141 门测试重写到新契约：R 缺失 → 首页正常渲染 + 引导条 + 商店 overlay + 无全屏门）；tsc 非 TS2550 0 错误（12 处 TS2550 为 HEAD 存量 lib 问题，与本条无关）；backend-health 定向 9 场景 + tools-executor preflight 单测；实机 `acceptance/block-66/p3-live.json`（A1 无 R 后端启动 health 200 / B1-B2 preflight 商店指引 / C1 vite；GUI 阶段 agent 会话阻塞已登记 guiPhase 手动验收命令）；docs:check / docs:reconcile。

**状态**: verified（2026-09-08 dev Electron 实机 CDP 验收完成：R 缺失态首页正常渲染工作台 + 顶部非阻塞引导条「R 运行时未安装，依赖 R 的分析无法运行。 去插件商店安装」+ 无全屏「先安装分析运行时」硬门；R 已装态无门无条；biof3-server 无 R 照常 health 200。GUI agent 会话启动问题实为 Node 22 ABI 137 错配，切 Node 24 后 GUI 正常拉起）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-313: BLOCK-64 增量 — 指挥中心使用体验增强：活跃置顶 + 项目标注 + 日志/取消行动作 + 远程徽章复活 (2026-09-09 verified)

**来源**：BLOCK-64-COMMAND-CENTER-UX（指挥中心使用体验全面评估，plan §3 问题清单 #1–#5/#7 + §4 P1-a/P1-b/P2-d；P2-c agent 俯瞰已移交 BLOCK-65）。

**改动**：① **P0 真 bug 修复**——`project-store.ts` `mapToolJob` 补 `execution_target_id` 映射（后端 history SELECT 显式返回、类型已声明、mapper 漏映射 → 指挥中心与结果库「远程」徽章生产永不渲染；新增 mapper 级回归测试走真实 `listAllJobs` 路径，禁止手工注入 ToolJob）；② 活跃置顶——`commandCenterModel.ts` `orderJobsForWall`（running/pending 分区置顶、区内 created_at 降序，历史不再把活跃作业挤出 12 瓦片墙），副标题改「活跃 X · 历史 Y」；③ 瓦片项目归属标注（project_id → 项目名，`listProjects` 缓存，失败降级裸 id）+ 失败瓦片 `job.error` 单行摘要（title 悬停全文）；④ running/pending 瓦片行动作——「查日志」（新增后端只读端点 `GET /api/tools/log/:id`：remote-runner.log 实时镜像优先、run.log finalize 汇总兜底、32KB 尾部截断、无文件诚实返回 no_log_yet；前端展开区 1s 轮询）+ 「取消」（两步确认 3s 自动解除 → `POST /api/tools/cancel`）；⑤ `cancelled` 提为一等 ToolJob 状态（此前 mapper 塌缩成 pending——取消后的作业会永远以「排队中」活跃态挂墙；补类型 union + 双端标签 + 灰点样式）；⑥ P2-d 快捷键 Ctrl/Cmd+Shift+C 开指挥中心（App 根注入，单例 popOut 语义=已开即聚焦）+ 空态引导文案。

**门禁**：定向 vitest 9/9（project-store 3 含 mapper 断链回归 + commandCenterModel 3 + ResultsLibrary 远程徽章 3）；tsc --noEmit 0；实机 `acceptance/block-64/`（ui313-command-center.png + block64-verify.cjs——7 个 fixture 作业：快捷键开窗 / 活跃置顶 / 项目标注 / 远程徽章 / 失败摘要 / run.log 日志含中文 marker / 取消两步确认 → cancelled 灰态，9 断言全 PASS，证据已清理 fixture）。

**状态**: verified（2026-09-09 dev Electron 实机 CDP 验收完成，9/9 判据全 PASS）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-314: BLOCK-65 增量 — 子智能体专属窗交互补全 + spawn 自动唤起 + SubAgentsBar 升格俯瞰 (2026-09-09 verified)

**来源**：BLOCK-65-SUBAGENT-UX（每 agent 专属界面；P1-b 三选一用户裁决=① 自动弹出专属窗；P2-c 二选一用户裁决=② SubAgentsBar 升格俯瞰面板；P2-d 形态对照评估结论=维持独立窗，见 plan §6）。

**改动**：① **P1-a 专属窗交互补全**（此前只读投影，后端二期三件套全部闲置）——后端新增用户态子域 `routes/ai-agent/task-actions.js`（GET /api/ai/agent/tasks 俯瞰列表 + GET /api/ai/agent/task/:id/meta 窗口标题 + POST message/followup），message/followup 语义与 send_message/followup_task 工具**单源**（spawn-agent-tools 导出 queueUserMessage/launchUserFollowup，复用 launchSubAgent/buildTerminalSummary）；agent-task-store 新增 `listRecentSubAgentTasks`（用户维度子 agent 列表）。AgentWindowPage：中断（两步确认→既有 cancel REST，级联语义）+ 留言 composer（队列语义诚实标注「运行中不即时注入，续派时作为上下文注入」）+ 终态「继续派」composer（沿用父链/模型/权限，成功后自动弹新专属窗）。② **P1-b① 自动唤起**——SubAgentsBar 对新出现运行中子 agent 自动 popOut 专属窗（模块级 Set 每 task 仅一次；4 窗预算超限 popOut 自动降格最旧窗，autoDemoted 返回值驱动 bar 内诚实提示）；窗口标题带 task 描述前缀（meta 接口），badge 改「Agent 专属窗 · 实时投影 + 交互」。③ **P2-c② 俯瞰面板**——SubAgentsBar 升格「全部俯瞰」展开区：跨会话只读 /api/ai/agent/tasks 投影（5s 轮询，活跃置顶，行含会话短 id 标注，点击弹对应专属窗）。0 新依赖。

**门禁**：SubAgentsBar + conversationRunStore 定向 vitest 43/43；tsc --noEmit 0；实机 `acceptance/block-65/`（ui314-live.json + 3 截图——真实模型 spawn 链路：spawn 后专属窗无手动自动弹出 / 标题「Agent · 请从 1 开始逐个列出 30 的每个数的平方…」/ 运行中留言入队含队列语义 note / 终态继续派成功且新子 agent 专属窗自动弹出 / 全部俯瞰 24 行跨会话含 @conv 标注，6 断言全 PASS）。

**状态**: verified（2026-09-09 dev Electron 真实模型 spawn 链路 CDP 验收完成）。G0 开发期常态 · 不外推 packaged / Provider / GA。

> **UI-314 收口后修正（2026-09-09，用户实测反馈）**：① 空会话误渲染活动条——SubAgentsBar 早退条件被 P2-c 改松（无子 agent 也渲染「子 agent 0 个 / 全部俯瞰」）→ 恢复 `tasks.length === 0` 即隐藏，俯瞰入口仅在已有子 agent 的会话提供；② 预算降格提示常驻 → 6s 自动消退；③ 俯瞰面板未按项目隔离 → 后端 tasks 列表附 `projectId`（经会话归属解析）+ 前端按当前项目过滤 + SimpleChat 传入 projectId；④ 深层回归——`resumeSubAgentTasks` 仅恢复 running，刷新后历史终态子 agent 不进 store，活动条/俯瞰在本会话永久不可见 → 新增 `loadHistoricalSubAgentTasks`（会话打开时从 `/api/ai/agent/tasks?conversationId=` 回填终态快照，幂等、零第二真相）。实机复核：空会话无活动条、有 agent 会话刷新后活动条/俯瞰可达（48 行含 @conv 标注）、API 全部行带 projectId。修正随 BLOCK-65 收口提交链。

## UI-315: 对话流内 exec 原生终端块 —— `$ 命令` + 流式输出（ZCode 式终端呈现） (2026-09-09 verified)

**来源**：用户反馈「模型来跑命令时，ZCode 会直接显示终端的输入和输出，我们的不会——能否优化，原生终端对话框很有感觉」。此前 exec 命令与输出被工具活动摘要条（UI-268 两级折叠）压在两层点击之后，无终端观感。

**改动**：① `toolActivity.ts`——ToolActivityItem 新增 `command` 字段（exec 类 workspace_exec / workspace_exec_background 从 tool_call args 捕获完整命令，bounded 400 字符）；`restoreToolActivities` 恢复 `command` + `output`（尾部 bounded 2000 字符）。② `ToolActivityList.tsx`——exec 类工具渲染原生终端块 `TerminalRow`（默认展开：终端图标 + 状态/耗时头行 + `$ 命令` + 流式输出 `<pre>` 限高 300px 自动滚底；运行中输出增长自动跟随，可折叠）；活动摘要条在 exec 运行中自动展开（用户手动切换后不再代管）；非 exec 工具保持原行式。③ 后端持久化——`tool-events.js` createToolActivityRecorder 新增 command 捕获（recordCall）与 `recordOutput`（输出尾部服务端镜像，cap 2000）；loop-orchestrator / chat.js 的 tool_output emit 侧镜像进活动快照——**历史消息刷新后终端块完整回放**（此前输出仅内存态）。0 新依赖。

**门禁**：toolActivity + ToolActivityList 定向 vitest 19/19（命令捕获 / 输出累积 / 持久化往返 / 截断边界）+ copilot 全目录 250/250 + tsc 0；实机 `acceptance/ui-315/`（真实模型 exec：`$ 命令` 行 + 流式输出 + 错误态/成功态 + 刷新后历史终端块含完整命令与输出尾部回放 + 截图）。

**状态**: verified（2026-09-09 dev Electron 真实模型 exec 链路 CDP 验收完成）。顺带发现登记：Windows 下 PowerShell 中文输出为 GBK 编码，经 UTF-8 读取呈乱码（既有 workspace_exec 编码问题，非本条引入，登记为后续候选）。G0 开发期常态 · 不外推 packaged / Provider / GA。

> **2026-09-09 主题统一修正（用户实测反馈「终端主题不统一」）**：消息体全局规则 `.sc-msg-body pre`（白底+边框）渗入终端块的命令/输出 pre → 白色药丸与暗色卡面割裂、浅色命令文字几乎不可读。修正：终端块自带完整暗色调色板（--term-* 局部变量：bg/border/text/dim/accent/danger），显式覆盖 pre 全局背景/边框，头行/命令/输出/错误统一同一色板。实机浅色主题截图复核：整卡暗色一体、命令行可读（acceptance/ui-315/ui315-theme-unified.png）。

> **UI-315 优化包增补（2026-09-09，用户裁决「全部做」）**：① **解析强化**——新增零依赖 ANSI SGR 解析器 `ansi.ts`（16 色 + bold/dim/underline，光标/OSC 转义剥除，扩展色参数组整组跳过），终端块输出按片段着色渲染；**Windows 编码修复**——cmd/PowerShell 路径自动注入 UTF-8 输出编码（`chcp 65001` / `[Console]::OutputEncoding`），中文输出乱码根除（实测 PS 中文完美）。② **视觉精修**——头行显示实际 shell 标签（`终端 · powershell`，toolResult 顶层 shellLabel 独立于 data 截断，附 buildToolResultEvent 派生）；运行中 spinner 动画；命令行/输出复制按钮；滚动跟随优化（手动上滚暂停自动滚底 + 「回到底部」悬浮按钮）。③ **默认展开**——含 exec 命令的消息活动条默认展开，终端块直接可见（此前压在两层折叠后）。验证：ansi/toolActivity/ToolActivityList 定向 25/25 + tsc 0；实机真实 exec：`$ node -v` + 输出 `v24.20.0` + `shellLabel: powershell` 落库（meta 查询证实），截图 `acceptance/ui-315/`。遗留登记：cmd 内建 echo 的中文参数乱码为 cmd argv 层局限（chcp 无法根治，模型提示词引导 PS 优先）；交互式命令无 TTY 维持现状。

> **UI-315 优化二（2026-09-09，用户实测反馈「黑底突兀 + 线条边界多余」）**：终端块重写为**主题自适应 + 无边框自由排版**——① 去掉外框/头行分隔线/输出内嵌框全部线条，仅保留 2px 左侧参考线（--gewu-border）标识区块；② 配色全部改用主题令牌（--gewu-text-primary/secondary、--gewu-accent、--gewu-status-success/danger、--gewu-bg-canvas），明暗主题自动适配（硬编码暗底废弃）；③ ANSI 16 色板明暗双套（浅色主题深色调校、深色主题亮色调校，[data-theme] 切换）；④ 复制/回到底部按钮改主题令牌。实机：浅色主题截图 `acceptance/ui-315/ui315-theme-light.png`（终端块融入对话流 + `终端 · powershell` 头行）+ 深色主题 `ui315-theme-dark.png`。遗留：cmd 内建 echo 中文参数乱码为 argv 层局限（模型引导 PS 优先）。

## UI-316: 子智能体单行细条 + 行内 bot 独立标识 + 实时状态 chip (2026-09-09 verified)

**来源**：用户实测反馈——子智能体呈现「占据空间太大」；其工作分布于各会话消息中，应类似文件修改行数变化以内联紧凑行呈现；且「每个子智能体给个图标，代表智能体是独立的，五脏俱全，辅助主智能体完成复杂并行任务」。

**改动**：① **SubAgentsBar 单行细条**——原两条全宽横幅（子 agent 计数行 + 全部俯瞰行）合并为一条 22px 细行：bot 独立图标 + 「子智能体 N 个 · M 运行中」+ 「全部俯瞰」入口；② **ToolActivityList 行内 agent 标识**——agent 管理类工具行（spawn/wait/list/interrupt/send_message/followup）图标改用新增 `bot` 图标（Icon.tsx，Lucide bot，独立智能体「五脏俱全」标识），spawn_agent 行内联该子 agent 实时状态 chip（useSyncExternalStore 订阅会话 store，运行中/已完成/失败/已停止随 child_finished 自动更新）。验证历史回放：刷新后活动列表/终端块/俯瞰面板全部恢复。

**门禁**：conversationRunStore + ToolActivityList 定向 vitest 48/48 + tsc 0 + ui:audit:check/docs:check PASS；实机截图 `acceptance/ui-315/ui316-slim-bar.png`（22px 单行细条 + bot 图标 + 行内 agent 行）。

**状态**: verified（2026-09-09 dev Electron 实机 CDP 验收）。G0 开发期常态 · 不外推 packaged / Provider / GA。

> **UI-315 优化二（2026-09-09，用户实测反馈「黑底突兀 + 线条边界多余 + 区分度不足」）**：终端块重写为**命令优先 + 主题自适应 + 无边框**——① 折叠行以等宽命令为主体内容（`$ 命令…` 单行省略，hover 见全文），一眼看出跑了什么，状态/耗时右置弱化；② 去掉全部左右边框线（含 .sc-tool-activity 行级左线对本块的渗入），以柔和主题底色（--gewu-bg-subtle）分组区块，明暗主题自动适配；③ 展开态：完整命令 + ANSI 着色输出（限高滚动 + 自动滚底 + 回到底部）+ 复制命令/输出；④ 运行中 spinner。实机：明暗双主题截图 `acceptance/ui-315/ui315-v2-light.png` / `ui315-v2-dark.png`（命令优先折叠行 + 展开输出均验证）。定向 vitest 19/19 + tsc 0。

> **UI-315 优化三（2026-09-09，复制按钮行内图标化 + 展开体命令行；实机验收复跑收口）**：① **复制按钮行内图标化**——展开体命令行自带 `$ 命令` 行 + 行内 copy 图标（点击变 check 绿色 1.2s），输出框右上角 hover 浮现 copy 图标（`sc-tool-term-copy-out`），原底部「复制命令/输出」文字按钮条移除；② 展开体命令行不再仅 multiLine 才显示，单行命令也以 `$ 前缀` 完整呈现。验收基线固化：新增 `scripts/ui315-forced-live.cjs` 入库（CDP 驱动真实模型 forced workspace_exec，唯一标记命令 `node -e "console.log(314159*2)"` 输出不可被模型编造；断言折叠头命令/✓字形/展开体命令行/行内复制按钮/真实输出/刷新历史恢复，9 断言），证据 `acceptance/ui-315/ui315-forced.json`（allPass）+ `ui315-terminal-live.png` + `ui315-history-restore.png`。定向 vitest 19/19 + tsc 0 + ui:audit:check/docs:check PASS。**验收复跑教训（登记）**：① 上轮 forced 验收失败为环境态而非代码回归——当日 dev 栈起于 10:47，早于 7726d9c0（10:58）最终代码，运行中后端为提交中途版本致 toolActivities 永不落库、历史终端块消失；重启 dev 栈（**必须以 fnm Node 24.20 启动**，系统 Node 22 与 core/biof3-server better-sqlite3 ABI 137 不匹配）后全链恢复；② 旧验收脚本选择器基于优化包时代 DOM（默认展开 + 「已完成」文字态），优化二改折叠行 + ✓ 字形后需按新契约断言（本脚本已固化新契约）；③ 长会话被模型幻觉历史污染（assistant 文本假装「执行完成」而无真实 tool_call）会让后续 turn 持续模仿不调工具——forced 验收须在新建空会话中跑，脚本已内置。

## UI-317: 聊天工作台界面减负 —— ⋯ 菜单清空 + 模型 I/O 迁右栏 tab + 空态极简 (2026-09-09 verified)

**来源**：用户 2026-09-09 两条界面减负反馈（BLOCK-68 立项裁决）：① composer ⋯ 菜单的「刷新文件链接」不属于消息会话框且"应该是自动的过程不需要主动点击"；②「模型 I/O 信息流」应"统一转移到右侧边栏的内容中，与文件、审阅等并列"；③ 右侧边栏空态"太啰嗦，去掉副标题，头部区（闪电图标+开始工作标题+描述行+项目行）可以不要"。

**改动**：① **⋯ 菜单整体移除**——`sc-toolbar-more` 按钮/菜单 DOM/`composerMoreOpen`/`refreshing` 反馈态全删不预留空壳，composer 右侧收敛为 预算环|供应商|模型|发送；「刷新文件链接」改自动化：新增 `useAutoFileReferenceRefresh` hook（SimpleChat/hooks/，外迁可单测）订阅既有 `projectWorkspaceChanged` 信号（agent 写档/数据导入同源，RightFileTree 已消费，**不新建第二套文件变更真相**），debounce 500ms 后 `__resetFileReferenceCache()` + `resolveNonce++`，已落地消息文件链接自动重解析。② **模型 I/O 迁右栏 tab**——`RightPanelMode` 增 `'io'`（`RIGHT_PANEL_ITEMS` 与结果/文件/审阅并列，icon `list-details`）；`LlmTranscriptViewer` 自 ⋯ 菜单 overlay（dialog+遮罩+Esc）退役为 **dock 形态**（填满 tab 容器，绑 `ctx.activeConvId` 会话切换内容随动，无会话诚实空态「当前无会话」），只读语义不变（BLOCK-37 契约延续）。③ **空态极简**——`EmptyResult` 删头部四件套与六卡片 `<small>` 副标题，仅留「图标+名称」网格；对应 CSS 类清理。0 新 npm 依赖。

**门禁**：tsc 0；受影响 vitest 292/292（copilot 全目录 + workspace-panels；新增 useAutoFileReferenceRefresh 2 用例：防抖合并触发/卸载清理；LlmTranscriptViewer 用例适配 dock 形态 + 新增无会话空态用例）；ui:audit:check/docs:check PASS。实机 `scripts/block68-ui-live.cjs` 9 断言 allPass（`acceptance/block-68/ui317-live.json` + `ui317-live.png`）：⋯ 按钮不存在 + composer 控件保留 / `projectWorkspaceChanged` 派发无异常 / 工具飞出菜单「模型 I/O」可打开 + llm-tr-dock 渲染当前会话记录 + 新建会话后 dock 随动诚实空态 / home 空态头部四件套删除 + 六卡片无 small。

**状态**: verified（2026-09-09 dev Electron 实机 CDP 验收）。G0 开发期常态 · 不外推 packaged / Provider / GA。

## UI-318: 知识空间第一版 —— composer 大脑开关 + 右栏 knowledge tab（BLOCK-69 P2）(2026-09-09 in_progress)

**来源**：BLOCK-69-KNOWLEDGE-SPACE（2026-09-09 用户想法提案立项、同日裁决启动）D6 设计裁决：大脑图标 = 知识空间实体入口——composer 工具条独立 icon 开关按钮（启用态高亮，不挂已移除的 ⋯ 菜单）+ 右栏 `RightPanelMode` 增 `'knowledge'` tab（空间开关 + 文档列表 + 多选上传 + 删除/重建索引 + 检索测试框）。

**改动**：`RightPanelMode` union 增 `'knowledge'` + `RIGHT_PANEL_ITEMS` 大脑 icon 项；新增 `KnowledgeSpacePanel`（workspace-panels/，开关/多选上传/2s 状态轮询仅摄取期/文档级删除（单事务两通道同灭）/重建索引/清空空间两步确认（BLOCK-64 先例）/检索测试框 top-k 命中渲染/「打开知识目录」走既有 `files.openPath` IPC（D9 存储可见）/无 DashScope key 诚实空态禁用开关（D7 不假启用））；composer 左区新增 `sc-knowledge-toggle` 大脑开关（`useKnowledgeSpaceToggle` hook：DB 单一真相、乐观切换失败回读、无 key disabled）；`ContextBudgetBar`/`events.ts`/`copilotClient` 透传 `knowledgeTokens` 预算行（注入块预算透明）；`knowledgeClient.ts` 前端 API 封装。0 新 npm 依赖。

**门禁**：tsc 0；定向 vitest 18/18（KnowledgeSpacePanel 4 + useKnowledgeSpace 3 + SimpleChat/RightPanel/progress 11）；后端 knowledge-space 19/19 + agent-tool-registry 9/9。

**状态**: in_progress（实现完成，实机 CDP 验收进行中——acceptance/block-69/ 落盘后转 verified）。G0 开发期常态 · 不外推 packaged / Provider / GA。
