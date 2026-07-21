# BioF3 Desktop UI 产品化审计台账

最后更新：2026-07-21

状态：**Stage 1 验收完成（31/31 verified）；UI-031、UI-032、UI-033 与 UI-034 已实机验收；UI-035 工具活动收缩、UI-036 模型配置简化、UI-037 并行后台会话、UI-038 Endpoint 默认模型与导入导出、UI-039 聊天回复阅读与复制体验、UI-040 设置面板四项安全与可达性微调、UI-041 设置面板背景统一与 Endpoint 工具栏整理、UI-042 Endpoint 渠道卡片外框收敛、UI-044 工作台右侧栏“显示侧边栏”冗余按钮清理待实机验收**

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
| UI-035 | in_progress | P2 | W-03 | C-04, C-06 | Agent 会话 / 工具活动 | 工具调用过程默认展示过多细节，且多轮工具前的模型中间叙述累积到最终回复，干扰用户阅读 | `SimpleChat` 折叠态已进一步收敛为无背景的“已处理时长 + 箭头”，不再展示工具次数或追溯提示；展开后才显示安全工具摘要。每轮工具活动和真实处理时长写入 assistant `meta_json`，重新打开会话可逐轮恢复；成功但受大小边界影响的结果使用中性“仅显示摘要”，与真实失败状态分离。前端 TypeScript 与 164 项测试通过；待用户实机确认折叠样式、逐轮恢复和最终答复顺序 | P7-D refinement |
| UI-036 | in_progress | P2 | P-07 | C-02, C-04 | 设置 / 模型接口与聊天选择器 | 模型配置暴露接口类型和能力开关，渠道卡密度偏高；聊天模型入口未把供应商与模型拆开选择 | 设置页每个渠道压缩为一行，仅保留供应商、Base URL、Key、默认模型、连通性和删除；协议适配由 Endpoint 自动推断，能力元数据继续在 Gateway 内部保留。聊天输入区拆成供应商和对应模型两个入口。前端代码门禁已通过，待用户实机确认单行密度、保存重开、连接状态和双入口选择 | MODEL-UX refinement |
| UI-037 | in_progress | P1 | W-03 | C-02, C-04, C-06 | Agent 会话 / 会话切换 | `SimpleChat` 把消息、流式状态和工具活动绑定在单个组件实例上；切换会话或离开聊天视图后，旧流会与新会话冲突，新会话也可能被全局 `streaming` 状态阻塞 | 新增按 `conversationId` 隔离的共享运行注册表：视图卸载只取消 UI 订阅，不停止 Agent task；返回会话可继续看到流式进度并在完成后从 SQLite 对账。不同会话可并行、同一会话禁止重叠请求，侧栏以脉冲点标识后台运行。后端既有每用户最多 3 路 task 并发边界不变；前端 23 文件 169 项测试通过，待用户实机验证 A/B 会话并行、离开聊天视图继续和完成后持久化 | CONVERSATION-RUNTIME |
| UI-038 | in_progress | P1 | P-07 | C-02, C-04 | 设置 / API Endpoint 与聊天模型选择器 | 供应商切换后模型没有明确使用该渠道的配置默认值；渠道配置无法备份或批量迁移 | ModelProfile 新增独立 `defaultModel`，`model` 保留最近激活模型；聊天选择供应商时自动激活该渠道默认模型，用户手动切换后保留手动选择。API Endpoint 提供 JSON/CSV 导出与导入；Key 默认隐藏，可主动显示/复制，用户确认后导出可包含 Key 明文，导入后进入待保存凭据输入并按 ID/Base URL 合并。模型设置内容区从固定 720px 改为最大 1180px 自适应，Endpoint 列按内容伸缩，Key 操作按钮独立占位且窄窗保留横向滚动；待用户实机验证 | MODEL-UX |
| UI-039 | in_progress | P2 | W-03 | C-04, C-06 | Agent 会话 / Markdown 回复 | 回复内容虽然完整，但表格边框、代码展示和复制入口缺乏统一的 Codex 风格，长回复阅读密度偏高；影响 W-06 文件预览 | Markdown 表格已移除完整外框和高密度网格，只保留弱化表头层级与低对比度横向分隔，最末行继续保留同强度底线；TSV 复制位于表格外的独立右对齐工具行。聊天 fenced code 复用安全语法高亮，Python/R/Shell 等真实代码保留紧凑语言栏；text/plaintext/txt/tree 与无语言块不显示语言栏，进一步移除灰底、圆角和四边框，以透明背景与上下两条低对比度细线界定内容，复制图标位于预留的右上操作区且不覆盖首行。文件浏览器按扩展名高亮常见脚本，纯文本保持原样；待用户实机验证长表格、代码块、文件结构、脚本预览及明暗/窄窗主题 | MODEL-UX refinement |
| UI-040 | in_progress | P2 | W-01 | C-03, C-04 | 设置 / 安全性与可达性 | 模型渠道删除无确认可误删已配置 URL/Key；回收站语义错放于“隐私与维护”；主题当前偏好不可见；“添加自定义 API”措辞含糊 | 模型卡片删除按钮包 `window.confirm` 并按渠道命名；`TrashManagement` 移入“计算与数据”末尾，与 `ComputeExecution`/`DataManagement`/`HarnessEnvironment` 之间增加细线视觉分隔；`ThemeControl` 旁渲染 `当前：跟随系统/日间/夜间` badge 直接披露偏好；按钮文本改为“添加 API 渠道”。改动遵循 UI-036/UI-038 既定的一行卡片、窄窗横向滚动与 Endpoint 列自适应原则，未调整卡片结构。前端 197 项测试与 ui:audit:check 通过，待用户实机验证 confirm 文案、回收站路径、主题 badge 文案与分隔线密度 | SETTING-FIX |
| UI-041 | in_progress | P2 | W-01 | C-01, C-04 | 设置 / 视觉一致性与工具栏密度 | 设置页左侧 nav、Endpoint 卡片、凭据卡、维护行、回收站项与数据目录区共 6 个容器使用 `--biof3-bg-subtle` 浅灰底，与右侧主面板白底不一致；`API Endpoint` 标题区内联的导出 JSON/CSV、导入配置三个按钮挤在描述段落之间，既占首屏面积又与“添加 API 渠道”主行动混淆 | 设置页 6 个容器背景统一为 `var(--biof3-bg-surface)` 白色，仅靠 `var(--biof3-border)` 区分边界；plugin store 的徽章/chip 灰底保持不变以保留对比线索。Endpoint 工具栏从 heading 抽出为 `.biof3-endpoint-list-actions`，左侧保留“添加 API 渠道”主行动，右侧（`margin-left: auto`）放置导出 JSON/CSV、导入配置与 transfer message，仅 `userModelProfiles.length > 0` 时渲染以避免空状态噪声；功能契约保留 UI-038 的导出/导入约束。前端 197 项测试与 ui:audit:check 通过，待用户实机验证 nav/卡片底色统一、工具栏在小/中/大窗口的换行与空状态折叠 | SETTING-FIX |
| UI-042 | in_progress | P2 | W-01 | C-01, C-04 | 设置 / Endpoint 卡片密度 | 每个渠道渲染 `.biof3-model-preset` 完整外框（1px border + 10px 圆角）+ 嵌套 `.biof3-endpoint-card` 内 padding 6px + 独立 list gap 6px，5 条渠道即产生 10 条内外框线和 4 道分隔线，密度与 UI-036 一行卡片原则相悖 | 渠道卡片去掉 1px 外框与圆角，改为底部 1px 分隔线让多条渠道聚合为列表；最后一条去除底 border 避免双线；嵌套 card padding 由 6px 收敛为 0 去除双层内边距；list 行间距 6px 收紧为 2px；header 行加底 border 与弱化色（`--biof3-text-tertiary`）形成“表头—行—行”单一分组结构，保留 UI-038 的窄窗横向滚动与 UI-036 的一行卡片约束。前端 197 项测试与 ui:audit:check 通过，待用户实机验证多渠道（5 条）、单渠道、空状态与窄窗视觉 | SETTING-FIX |
| UI-044 | in_progress | P2 | W-02 | C-01, C-06 | 工作台 / RightPanel 折叠入口冗余 | `RightPanel.tsx` 当 `visible=false` 且 `workspaceMode ∈ {chat, scheduled}` 时渲染一个绝对定位“显示右侧侧边栏”按钮（绝对 0/0、width 40px、半透明 + backdrop-blur）；与 TitleBar 的 panel-right toggle 功能重复，且隐藏在右栏折叠区边缘，被设置/报告/工具面板遮挡，在打开设置等场景下被误识别为设置内按钮 | 删除 `RightPanel.tsx` 中的 `if (!visible) { return <button ... /> }` 折叠分支，保留 `return null` 早返；清理 `Icon` 未用 import 与 `project-workspace.module.css` 里 `.workspaceRightPanelToggle`/`:hover` 样式块；`useWorkspacePanels.toggleRight` 保留供 TitleBar 调用，前端测试与 ui:audit:check 通过，待用户实机验证“右侧栏折叠后无浮按钮，只用 TitleBar 右上 panel-right 按钮恢复” | RIGHTPANEL-FIX |
- UI-032 属于 `P-07 模型网关与 AI Provider` 的 Harness 能力子系统（Stage 3 M1），现已与 UI-031/UI-033/UI-034 一起完成实机验收。
- 不允许破坏：设置页窄窗布局、计算与数据分类既有 `ComputeExecution`/`DataManagement` 组件、`run_tool → tool_job → artifact truth` 执行链。
- 验收同时覆盖无 bundle 的空状态与真实 bundle 条目状态；面板保持只读，不提供绕过 Harness 编排层的 provision/remove 操作。

- UI-033 只收敛用户可配置层，不删除 Gateway 已支持的底层适配器，也不改写历史 profile。
- UI-036 延续该边界：只隐藏实现型选项，不删除持久化的协议、能力或角色信息；窄窗口保持一条渠道一行并允许横向查看，不把字段重新折成多行卡片。
- UI-040 不破坏：UI-036/UI-038 既定的渠道一行卡片与窄窗横向滚动，只在调用点增加 confirm、跨子模块加视觉分隔，并在 ThemeControl 旁加可读 badge；不重构 `TrashManagement`、`ComputeExecution`、`DataManagement` 的 props 或 IPC 契约。
- UI-041 不破坏：UI-036/UI-038 既定的一行卡片与窄窗横向滚动；只把 `--biof3-bg-subtle` 在设置页 6 个容器替换为 `--biof3-bg-surface`，并把转移按钮从 heading 移出到列表底部；保留导入/导出函数、`endpointImportRef`、`endpointTransferMessage` 全部状态、Key 是否写入导出的确认弹窗。
- UI-042 不破坏 UI-036/UI-038：保留一行网格、窄窗横向滚动与 Endpoint 列自适应；只把卡片外框改为底部分隔线、移除嵌套 padding 并收紧 list 行间距，未改动 DOM 结构与 React props。
- UI-044 不破坏 hook/折叠语义：只清理 `RightPanel.tsx` 里“visible=false 浮按钮”分支，保留 collapsed panel `return null`；右侧栏折叠后无恢复入口复用，与 TitleBar panel-right toggle 形成“单入口恢复”约定，避免与底部终端/左栏 toggle 视觉冗余。
- UI-037 不创建第二套后台任务系统：仍使用既有 Agent task、`task_events` SSE 回放和 `copilot_messages` 持久化；本次只修复 renderer 按会话隔离、订阅存续和完成对账。

## 11. 2026-07-21 UI-033 / UI-034 实机收口

- UI-034 使用脱敏视觉 fixture 覆盖明暗主题、窄窗、右侧栏折叠和 task SSE 回放；真实 Provider 仅用于安装候选的只读调用抽查，不把用户科学任务当 fixture。
- UI-033 由同一明暗/窄窗矩阵中的供应商模型选择器，加上安装候选的真实 DeepSeek 身份与调用结果共同关闭。
- UI-032 已单独取得设置页“计算与数据”中真实 capability bundle 的可见证据并关闭。
- UI-035 属于 UI-034 的阅读密度优化，不改变 ToolResult、Trace、审批或 `run_tool → tool_job → artifact truth` 契约；实现后需单独完成实机视觉确认。
- 预期：只出现 DeepSeek 与“自定义 API”；每个 URL 在同一张 Endpoint 卡中配置 Base URL、模型名、Key、功能和连接测试，自定义 API 使用 OpenAI-compatible 协议。
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
