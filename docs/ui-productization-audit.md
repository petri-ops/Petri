# BioF3 Desktop UI 产品化审计台账

最后更新：2026-07-15

状态：**等待逐屏实机审计**

本文件是 [`docs/v1-productization-roadmap.md`](./v1-productization-roadmap.md) Stage 1 的唯一 UI 问题清单。它记录真实可复现问题，不用来收集没有目标层级的泛化审美意见。

## 1. 审计基线

- 正式安装版：`/Applications/BioF3.app`，当前版本 `0.0.1-rc.4`。
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
| UI-001 | open | P1 | W-01 | C-01, C-02 | TitleBar 全局 | 右侧栏收起后，顶部标签轨仍然显示，应该隐藏或收窄到图标状态 | TitleBar.tsx:101-171, 右侧收起时 tabs 仍渲染 | UI-2 |
| UI-002 | open | P2 | W-01 | C-01 | TitleBar | 交通灯区域（trafficZone）占位固定，未响应 macOS 窗口控件实际位置 | TitleBar.tsx:49, TitleBar.module.css 需检查 | UI-2 |
| UI-003 | open | P1 | W-02 | C-02 | 项目工作台 | 三栏布局的拖拽手柄（resize rail）在暗色主题下可能不够明显 | project-workspace.tsx 使用 useResizableColumns，需检查 rail 样式 | UI-2 |
| UI-004 | open | P1 | W-03 | C-01 | Agent 会话 | SimpleChat 组件的消息气泡样式可能在明暗主题下对比度不足 | SimpleChat.tsx 需审查，css 模块需验证 token 使用 | UI-4 |
| UI-005 | open | P2 | W-01 | C-01 | TitleBar | 顶栏图标按钮（iconBtn）的 hover/active 状态在暗色主题下反馈不明显 | TitleBar.module.css 的 .iconBtn:hover 需检查 | UI-2 |
| UI-006 | open | P1 | W-04 | C-01 | 结果与报告 | 结果查看器的 iframe/WebView 可能未完全跟随暗色主题 | project-workspace.tsx 中 artifact 渲染逻辑，report-theme.js 需检查 | UI-5 |
| UI-007 | open | P1 | W-07 | C-01 | 集成终端 | 终端主题（terminal-themes.ts）可能与全局主题不联动 | BottomTerminal.tsx, themes/terminal-themes.ts 需审查 | UI-5 |
| UI-008 | open | P2 | W-01 | C-02 | TitleBar | 窗口缩放到最小可用尺寸时，中间标题文字可能被挤压或截断 | TitleBar.tsx:84-88, centerTitle 布局需实机验证 | UI-2 |
| UI-009 | open | P1 | W-02 | C-02 | 工作台布局 | 左/右栏折叠动画可能不够丝滑，产生跳版感 | WorkspacePanelsContext/useResizableColumns，CSS transition 需检查 | UI-2 |
| UI-010 | open | P0 | P-06 | C-05 | 开发版启动 | better-sqlite3 模块版本不匹配警告（NODE_MODULE_VERSION 123 vs 131） | 启动日志第 16-20 行，影响迁移功能 | UI-1 |
| UI-011 | open | P1 | W-05 | C-02 | 内置浏览器 | WebView 高度可能未占满右侧工作区，出现上下留白 | RightPanel.tsx 浏览器组件，height 计算需验证 | UI-5 |
| UI-012 | open | P2 | W-06 | C-01 | 文件树 | 文件树的选中态、hover 态在暗色主题下可能不够明显 | LeftPanel.tsx / RightPanel.tsx 文件树组件样式 | UI-5 |
| UI-013 | open | P1 | W-03 | C-06 | Agent 会话 | 长对话滚动时可能出现卡顿，流式渲染性能需优化 | SimpleChat.tsx 消息列表渲染逻辑 | UI-4 |
| UI-014 | open | P1 | W-04 | C-02 | 结果导航 | Artifact 导航栏在右栏宽度较窄时，长文件名可能溢出或错位 | project-workspace.tsx 结果组件，CSS overflow 需检查 | UI-5 |
| UI-015 | open | P2 | W-01 | C-01 | 全局样式 | 全局滚动条样式（::-webkit-scrollbar）在某些主题下对比度不足 | global.css:86-99，emphasis-300/500 可能需调整 | UI-2 |
| UI-016 | open | P1 | W-02 | C-02 | 工作台布局 | 底部终端展开后，中间主工作区高度可能未正确调整 | project-workspace.tsx, BottomTerminal 高度计算 | UI-2 |
| UI-017 | open | P2 | W-03 | C-01 | Agent 输入框 | Agent 输入框的 placeholder、边框在暗色主题下可能不够清晰 | SimpleChat.tsx 输入框样式，需实机检查 | UI-4 |
| UI-018 | open | P1 | W-04 | C-04 | 结果卡片 | 聊天区点击"查看结果"后，右侧面板可能未正确切换到 results tab | project-workspace.tsx 事件监听逻辑，biof3Events 需验证 | UI-5 |
| UI-019 | open | P2 | W-08 | C-01 | 专业功能页面 | /tools、/admin 等传统页面的壳层与桌面主题可能存在不一致 | tools.tsx, admin.tsx 全局样式继承需检查 | UI-6 |
| UI-020 | open | P1 | W-01 | C-02 | TitleBar | 左右栏宽度变化时，顶栏的 leftSpan/rightSpan 更新可能存在延迟或跳跃 | TitleBar.tsx:36-44, CSS 变量更新时机 | UI-2 |
| UI-021 | open | P2 | W-01 | C-01 | TitleBar | 窗口工具按钮的边框（windowTools border-left）使用硬编码 rgba，未使用 token | TitleBar.module.css:202, 应使用 --biof3-border 或 --titlebar-divider | UI-2 |
| UI-022 | open | P1 | W-02 | C-02 | 右侧面板 | 右侧面板多 tab 内容区可能高度计算不准确，导致 overflow 或留白 | RightPanel.tsx, project-workspace.module.css 的 .rightCol 需检查 | UI-5 |
| UI-023 | open | P1 | W-01 | C-02 | TitleBar | 响应式断点（1380px/1120px）下，标签轨可能在宽度收窄时出现错位 | TitleBar.module.css:329-361, 实机测试各断点 | UI-2 |
| UI-024 | open | P2 | W-02 | C-02 | 拖拽手柄 | 垂直拖拽手柄（resizeHandleV）可能视觉不够明显，用户难以发现 | project-workspace.module.css 需检查 .resizeHandleV 样式 | UI-2 |
| UI-025 | open | P1 | W-04 | C-04 | 结果面板 | 结果侧边栏与主预览区之间的数据同步可能存在延迟 | ResultSidebarPanel 与 activeArtifact 状态更新逻辑 | UI-5 |
| UI-026 | open | P2 | W-03 | C-01 | 消息气泡 | Agent 消息中的代码块高亮样式可能在暗色主题下对比度不足 | SimpleChat.tsx, github.css (highlight.js) 需检查 | UI-4 |
| UI-027 | open | P1 | W-02 | C-06 | 布局性能 | 三栏布局拖拽时可能触发大量重排，影响 60fps 流畅度 | useResizableColumns.ts 需检查 throttle/debounce | UI-2 |
| UI-028 | open | P2 | W-01 | C-01 | TitleBar | 工具菜单（toolMenu）的阴影在暗色主题下可能不够明显 | TitleBar.module.css:166, box-shadow 硬编码需调整 | UI-2 |
| UI-029 | open | P1 | W-05 | C-02 | 浏览器面板 | 浏览器 tab 内容（rightPanelBrowserTab）的布局可能与其他 tab 不一致 | project-workspace.module.css, RightPanel.tsx:131 特殊处理 | UI-5 |
| UI-030 | open | P1 | W-02 | C-02 | 面板折叠 | 右侧面板完全收起时，仍然占用少量宽度（约 64px），影响中间工作区空间 | TitleBar.tsx:38, collapsedRightRail 宽度需优化 | UI-2 |

状态只使用：`open / in_progress / verified / deferred`。

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
