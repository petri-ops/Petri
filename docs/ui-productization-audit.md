# BioF3 Desktop UI 产品化审计台账

最后更新：2026-08-01

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
| UI-035 | verified | P2 | W-03 | C-04, C-06 | Agent 会话 / 阶段进展与工具活动 | 多轮工具前的模型可展示说明会在下一 iteration 被清空；工具展开区每项占两行且暴露过多实现细节，用户难以快速判断任务推进到哪里 | 新增 `agent_progress` SSE：只固化模型面向用户的阶段说明，不读取或展示隐藏推理；运行快照与历史消息按任务顺序保留最多 50 条，既覆盖长科学任务又防止异常上游无限写入，assistant `meta_json.progressUpdates` 支持历史会话恢复。工具折叠态收敛为“已完成 N 项 · 读取/修改数量 · 总耗时”，展开后每项仍可查看动作、对象、状态、耗时、工具名、影响和失败原因，但压成紧凑单行。Agent prompt 要求新阶段用一两句可验证进展说明。run store 7/7、tool activity 7/7、前端 typecheck 通过；2026-07-23 Ark 真实长任务完成 28 轮、32 次工具调用，阶段流与历史重开均保持紧凑且可恢复 | P7-D refinement |
| UI-036 | in_progress | P2 | P-07 | C-02, C-04 | 设置 / 模型接口与聊天选择器 | 模型配置暴露接口类型和能力开关，渠道卡密度偏高；聊天模型入口未把供应商与模型拆开选择 | 设置页每个渠道压缩为一行，仅保留供应商、Base URL、Key、默认模型、连通性和删除；协议适配由 Endpoint 自动推断，能力元数据继续在 Gateway 内部保留。聊天输入区拆成供应商和对应模型两个入口。前端代码门禁已通过，待用户实机确认单行密度、保存重开、连接状态和双入口选择 | MODEL-UX refinement |
| UI-037 | in_progress | P1 | W-03 | C-02, C-04, C-06 | Agent 会话 / 会话切换 | `SimpleChat` 把消息、流式状态和工具活动绑定在单个组件实例上；切换会话或离开聊天视图后，旧流会与新会话冲突，新会话也可能被全局 `streaming` 状态阻塞 | 新增按 `conversationId` 隔离的共享运行注册表：视图卸载只取消 UI 订阅，不停止 Agent task；返回会话可继续看到流式进度并在完成后从 SQLite 对账。不同会话可并行、同一会话禁止重叠请求，侧栏以脉冲点标识后台运行。后端既有每用户最多 3 路 task 并发边界不变；前端 23 文件 169 项测试通过，待用户实机验证 A/B 会话并行、离开聊天视图继续和完成后持久化 | CONVERSATION-RUNTIME |
| UI-038 | in_progress | P1 | P-07 | C-02, C-04 | 设置 / API Endpoint 与聊天模型选择器 | 供应商切换后模型没有明确使用该渠道的配置默认值；渠道配置无法备份或批量迁移 | ModelProfile 新增独立 `defaultModel`，`model` 保留最近激活模型；聊天选择供应商时自动激活该渠道默认模型，用户手动切换后保留手动选择。API Endpoint 提供 JSON/CSV 导出与导入；Key 默认隐藏，可主动显示/复制，用户确认后导出可包含 Key 明文，导入后进入待保存凭据输入并按 ID/Base URL 合并。模型设置内容区从固定 720px 改为最大 1180px 自适应，Endpoint 列按内容伸缩，Key 操作按钮独立占位且窄窗保留横向滚动；待用户实机验证 | MODEL-UX |
| UI-039 | in_progress | P2 | W-03 | C-04, C-06 | Agent 会话 / Markdown 回复 | 回复内容虽然完整，但表格边框、代码展示和复制入口缺乏统一的 Codex 风格，长回复阅读密度偏高；影响 W-06 文件预览 | Markdown 表格已移除完整外框和高密度网格，只保留弱化表头层级与低对比度横向分隔，最末行继续保留同强度底线；TSV 复制位于表格外的独立右对齐工具行。聊天 fenced code 复用安全语法高亮，Python/R/Shell 等真实代码保留紧凑语言栏；text/plaintext/txt/tree 与无语言块不显示语言栏，进一步移除灰底、圆角和四边框，以透明背景与上下两条低对比度细线界定内容，复制图标位于预留的右上操作区且不覆盖首行。文件浏览器按扩展名高亮常见脚本，纯文本保持原样；待用户实机验证长表格、代码块、文件结构、脚本预览及明暗/窄窗主题 | MODEL-UX refinement |
| UI-040 | in_progress | P2 | W-01 | C-03, C-04 | 设置 / 安全性与可达性 | 模型渠道删除无确认可误删已配置 URL/Key；回收站语义错放于“隐私与维护”；主题当前偏好不可见；“添加自定义 API”措辞含糊 | 模型卡片删除按钮包 `window.confirm` 并按渠道命名；`TrashManagement` 移入“计算与数据”末尾，与 `ComputeExecution`/`DataManagement`/`HarnessEnvironment` 之间增加细线视觉分隔；`ThemeControl` 旁渲染 `当前：跟随系统/日间/夜间` badge 直接披露偏好；按钮文本改为“添加 API 渠道”。改动遵循 UI-036/UI-038 既定的一行卡片、窄窗横向滚动与 Endpoint 列自适应原则，未调整卡片结构。前端 197 项测试与 ui:audit:check 通过，待用户实机验证 confirm 文案、回收站路径、主题 badge 文案与分隔线密度 | SETTING-FIX |
| UI-041 | in_progress | P2 | W-01 | C-01, C-04 | 设置 / 视觉一致性与工具栏密度 | 设置页左侧 nav、Endpoint 卡片、凭据卡、维护行、回收站项与数据目录区共 6 个容器使用 `--biof3-bg-subtle` 浅灰底，与右侧主面板白底不一致；`API Endpoint` 标题区内联的导出 JSON/CSV、导入配置三个按钮挤在描述段落之间，既占首屏面积又与“添加 API 渠道”主行动混淆 | 设置页 6 个容器背景统一为 `var(--biof3-bg-surface)` 白色，仅靠 `var(--biof3-border)` 区分边界；plugin store 的徽章/chip 灰底保持不变以保留对比线索。Endpoint 工具栏从 heading 抽出为 `.biof3-endpoint-list-actions`，左侧保留“添加 API 渠道”主行动，右侧（`margin-left: auto`）放置导出 JSON/CSV、导入配置与 transfer message，仅 `userModelProfiles.length > 0` 时渲染以避免空状态噪声；功能契约保留 UI-038 的导出/导入约束。前端 197 项测试与 ui:audit:check 通过，待用户实机验证 nav/卡片底色统一、工具栏在小/中/大窗口的换行与空状态折叠 | SETTING-FIX |
| UI-042 | in_progress | P2 | W-01 | C-01, C-04 | 设置 / Endpoint 卡片密度 | 每个渠道渲染 `.biof3-model-preset` 完整外框（1px border + 10px 圆角）+ 嵌套 `.biof3-endpoint-card` 内 padding 6px + 独立 list gap 6px，5 条渠道即产生 10 条内外框线和 4 道分隔线，密度与 UI-036 一行卡片原则相悖 | 渠道卡片去掉 1px 外框与圆角，改为底部 1px 分隔线让多条渠道聚合为列表；最后一条去除底 border 避免双线；嵌套 card padding 由 6px 收敛为 0 去除双层内边距；list 行间距 6px 收紧为 2px；header 行加底 border 与弱化色（`--biof3-text-tertiary`）形成“表头—行—行”单一分组结构，保留 UI-038 的窄窗横向滚动与 UI-036 的一行卡片约束。前端 197 项测试与 ui:audit:check 通过，待用户实机验证多渠道（5 条）、单渠道、空状态与窄窗视觉 | SETTING-FIX |
| UI-044 | in_progress | P2 | W-02 | C-01, C-06 | 工作台 / RightPanel 折叠入口冗余 | `RightPanel.tsx` 当 `visible=false` 且 `workspaceMode ∈ {chat, scheduled}` 时渲染一个绝对定位“显示右侧侧边栏”按钮（绝对 0/0、width 40px、半透明 + backdrop-blur）；与 TitleBar 的 panel-right toggle 功能重复，且隐藏在右栏折叠区边缘，被设置/报告/工具面板遮挡，在打开设置等场景下被误识别为设置内按钮 | 删除 `RightPanel.tsx` 中的 `if (!visible) { return <button ... /> }` 折叠分支，保留 `return null` 早返；清理 `Icon` 未用 import 与 `project-workspace.module.css` 里 `.workspaceRightPanelToggle`/`:hover` 样式块；`useWorkspacePanels.toggleRight` 保留供 TitleBar 调用，前端测试与 ui:audit:check 通过，待用户实机验证“右侧栏折叠后无浮按钮，只用 TitleBar 右上 panel-right 按钮恢复” | RIGHTPANEL-FIX |
| UI-046 | verified | P1 | W-03, W-06 | C-02, C-04, C-06 | Agent 会话 / Chat @file 文件引用 | 聊天上下文缺少“以文件为锚”的引用方式：用户想引用某个项目文件只能粘贴内容或凭记忆描述文件名，模型也无法定位真实路径 | `core/packages/shared-copilot/chat-file-references.ts` + `core/r-server/helpers/chat-file-references.js` 提供 `parseChatFileReferences` / `resolveChatFileReferences`（解析 `@file` token、把相对路径解析为项目内真实路径并校验可读）；`core/r-server/routes/harness.js` 把解析结果注入 harness 工具上下文。`frontend/src/lib/{chat-file-references.ts,electron.d.ts,events.ts}` + `preload.js` + `main.js` 暴露 `chat:resolveFileReferences` IPC；`SimpleChat.tsx` + `simple-chat.css` 在输入区识别 `@` 触发补全面板并以 chip 形式插入引用；`simple-chat-file-open.test.ts` 覆盖点击引用 chip 打开文件浏览器并定位到该文件。前端测试与 ui:audit:check 通过，待用户实机验证输入区 @ 触发补全、chip 渲染、点 chip 跳转文件树、R 端能解析并把路径透传到 harness | CHAT-FILE-REF |
| UI-047 | verified | P2 | W-04, W-06 | C-01, C-06 | 通用 UI / 代码块高亮组件 | 当前 Markdown fenced code 缺乏统一高亮与可复用样式，长代码块在明/暗主题下排版与复制入口不一致；后续 @file 引用与 agent 工具结果都需要一个干净的高亮基元 | 新增 `frontend/src/components/ui/{CodeHighlight.tsx, code-highlight.css}` 与测试 `CodeHighlight.test.tsx`：基于安全的语法高亮提供语言栏 + 复制入口 + 明暗主题适配；作为 Markdown fenced code 与未来 plugin/artifact 代码块的复用基元，样式与 UI-039 Markdown 阅读密度规则保持一致。前端测试与 ui:audit:check 通过，待用户实机验证明/暗主题、不同语言长代码块、复制行为 | CODE-HIGHLIGHT |
| UI-048 | verified | P1 | W-06 | C-04, C-06 | 项目资源 / Office 文件预览 | 项目浏览器只能识别文本类文件，遇到 `.docx`/`.xlsx`/`.pptx` 时直接 fallback 为下载或“未知类型”，用户体验断裂，且 `@file` 引用无法在文件树上对 Office 文件给出即时摘要 | 新增 `frontend/src/lib/office-file-preview.ts`（含解析、文本/表格抽取、元信息）与测试 `office-file-preview.test.ts`；`project-workspace.tsx` 在文件预览组件里按扩展名路由到对应预览器，保留 Office 文件的可读文本视图（前 N 行 + 表格摘要）与“用默认应用打开”入口。前端测试与 ui:audit:check 通过，待用户实机验证 .docx/.xlsx/.pptx 的解析、表格摘要、窄窗与明暗主题 | OFFICE-PREVIEW |
| UI-049 | verified | P1 | W-04 | C-04, C-06 | 项目结果 / 科学交付摘要 | 结果页只有 Job/Artifact 导航和最终 HTML 报告入口，用户无法在首屏判断交付是 valid、degraded 还是 blocked，也看不到复现可用/已验证数量 | HRT-5 新增 `DeliveryManifest v1` 摘要卡：首屏分层展示“结论摘要 / 我做了什么 / 需要注意什么”，使用后端交付状态驱动左侧语义色，并显示 verified/available 复现数量与交付清单入口；产物卡提供“查看脚本”和“重放验证”，重放只向 Agent 发起需确认请求，不直接执行；不在前端重新推断科学状态。样本 metadata 校验、表达矩阵 QC、DEG 标准化 3 个仓库脱敏任务真实 R 链路均为 completed + artifact truth valid + delivery valid，证据为 `acceptance/harness-scientific-task/hrt5-delivery-acceptance.json`。2026-07-22 实机矩阵覆盖日间 valid/degraded/blocked、夜间 blocked、820px 窄窗；交付清单/脚本入口均返回 200，控制台 0 error。验收发现结果侧栏约 340px 时三列摘要受整窗 media query 误判，已改用 container query 在 520px 以下纵向排列，复验通过。**2026-07-27 更正**：该修复原挂在 `.resultSidebarRoot`，而 `5f3cd5e`（G0-RS-P1 建立中央结果界面）移除了 `ResultSidebarPanel` 挂载；两者在 `ResultArtifactShell` 中是兄弟 return 而非嵌套，故 `@container` 自那时起在用户实际渲染的中央分支上**没有容器祖先，长期失效**。已把 `container-type: inline-size` 迁到 `.resultView`（`project-workspace.module.css:4076`）恢复生效。本行 `verified` 反映的是当时侧栏变体下的复验，中央变体的实机复验属 P4R-2 未完成项 | HRT-5 |
| UI-050 | verified | P1 | W-04 | C-04, C-05, C-06 | 项目结果 / 复现包导出 | HRT-5 已能查看脚本和发起重放确认，但结果页没有把 TaskSpec、checkpoint、Job/Artifact/Delivery/Provenance 和逐产物入口导出成可跨智能体接手的任务包 | 交付摘要新增“导出复现包”，调用受控 HRT-6 API 把 `ReplayPackage v1` 写入当前项目 Job 结果目录；成功后显示“完整历史”或“历史部分可用”，不把缺失 checkpoint 冒充完整交接。2026-07-22 以真实 metadata validator Job 实机点击：生成 18 文件、6 个逐产物入口，页面反馈 `partial_history` 与后端清单一致，控制台 0 error；完整 checkpoint 的 `complete` 包由离线 R 验收覆盖。按钮不直接运行重放，真实任务仍需进入确认门并创建 replay Job | HRT-6 |
| UI-051 | verified | P1 | W-03 | P-03, P-05, P-07 | 设置 / 会话摘要资源与用量 | 资源、Token、缓存和成本只有设计口径，用户无法判断当前机器是否适合运行长任务，也无法在设置页查看缓存与成本证据 | 新增统一 RuntimeResourceSnapshot v1 和 10 秒轮询 Hook；会话摘要显示资源状态、可用内存/磁盘与 CPU，设置新增“用量与资源”页签，展示 30 天调用、输入/输出/cache 命中、估算成本和 `cost_unknown` 提示。2026-07-22 真实项目实机验收：低内存从错误“资源正常”修正为“资源不足”，磁盘 13 GB、8 核和 182 MB 可用内存均来自同一快照；820px 窄窗无横向溢出，控制台 0 error。GPU 未可靠探测时不展示，Job 峰值采样仍诚实标记 unavailable | post-HRT runtime control |
| UI-052 | in_progress | P1 | W-03 | C-03, C-04 | Agent 会话 / 完全访问 | 聊天显示“完全访问”，后端却仍无条件应用只读命令白名单，导致 `head -5`、`cat` 和多文件 `wc` 显示 `command_not_allowlisted` | `accessMode=full` 改为从项目目录启动通用 shell，不再使用命令 allowlist；`read` 在中央 policy 和 handler 两层继续拒绝。权限菜单副文案改为“允许命令行、文件修改与工具调用”；截图中的三类命令和 shell 管道/重定向已进入 25/25 后端回归。尚未对修复后的真实聊天工具活动做实机复验，故保持 in_progress | AGENT-TERMINAL |
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
| UI-103 | in_progress | P1 | W-03, W-04 | P-03, C-04, C-06 | Result Studio / ChangeSet 修改进度 | 隔离编辑会经历 materialize、Git candidate、Job、validator 和 Revision 多阶段；若前端只显示普通工具调用，用户无法判断修改停在哪一步，切到下一工具时阶段反馈也可能消失 | P4R-3 的唯一阶段投影继续保留。P6-1 新增持久 runtime lease 与逐阶段 checkpoint，重开后从 SQLite/Job/Artifact/Git 真相区分当前运行、待确认候选、中断现场和阻断现场；Result Studio 明示停止阶段、保留的候选数量、系统将如何处理及下一动作，恢复按钮只在可恢复时开放。开发态 Electron 已实际覆盖活跃编辑崩溃、owned backend 冷启动、恢复与再次重开；用户停止和执行失败会持久化诚实终态与资源摘要。受控 loopback 429/503 不等于真实 Provider，literal OS reboot 与 packaged 连续 trace 仍归 P7，因此保持 `in_progress` | G0-RS5 / G0-RS-P3 / G0-RS-P4R / G0-RS-P6 / G0-RS-P7 |
| UI-104 | verified | P1 | W-04 | P-02, P-03, C-04, C-06 | Result Studio / 结果版本比较与操作 | 候选 Revision 已生成但用户只能看到普通结果，无法理解变化、原子采用、撤销或把历史恢复成新版本；直接展示完整 Git 细节又会淹没科学结果 | 结果侧栏新增紧凑版本区：默认仅显示当前版本、候选/采用状态、来源、文件数和比较/采用/撤销；展开后按 SVG/图像、表格语义、JSON 字段、文本 Git diff 和 Revision history 分层，Git commit/ref 折叠到高级信息。采用通过 Git CAS + SQLite transaction 切换全部 current，baseline 不显示撤销，历史恢复永远生成新 commit/ChangeSet/Revision。隔离真实链完成 v1→采用 v2→撤销 v1→恢复 v3，重复恢复幂等；真实 renderer 覆盖明亮、夜间与 820×900，窄窗 `innerWidth=clientWidth=scrollWidth=820`，无页面级横向溢出 | G0-RS6 / RESULT-REVISION-REVIEW |
| UI-105 | in_progress | P1 | W-04 | P-02, P-05, C-04, C-05, C-06 | Result Studio / 耐久恢复与大表性能 | 退出或中断后修改现场只存在于运行内存；大表比较只有固定前缀摘要，无法继续读取；用户也看不到版本存储是否健康、重复内容和资源压力 | P6-1 已把 lifecycle/checkpoint、去重、exact GC protection、RFC4180 byte-cursor、Artifact Truth read binding、preview budget 与 Job 资源采样接到真实产品路径；CPU/内存/输出/并发峰值按 measured/partial/unavailable 投影，未绑定 Provider 时 Token/cache/cost 明示不可用。开发态 Electron 已实际读取 10 万行表、42.7 MB 复杂 SVG、PNG、含 6 张嵌图的长报告并翻阅 100+ 版本；SVG MIME/ORB 故障由该门捕获后修复，精确网络事件为 completed/200。多 Revision 压力中的 201 条为同一真实 Artifact 字节的 Revision alias，不冒充 201 次真实 Job；packaged 与 P7 资格仍未证明，因此保持 `in_progress` | G0-RS8 / G0-RS-P6 / G0-RS-P7 |
| UI-106 | verified | P0 | W-04 | C-01, C-04, C-06 | Result Studio / 中央主画布 | 当前结果长期缩在右侧窄栏，中央 Agent 区域在结果阅读和编辑时仍占主要面积，图、表、报告与比较无法成为清晰焦点 | G0-RS-P1 已在同一 ProjectWorkspace 落地 conversation/task/result/compare 投影、中央 ResultStudioCanvas、紧凑 Inspector/ContextBar 与六类 viewer；Agent 会话保持挂载。真实开发态 renderer 覆盖明暗主题及 1440/1024/820px，中央宽度 858/683/820px、无页面横向溢出，草稿和进入前布局可恢复；性能 3.2/0.7/2.6ms 均低于预算。脱敏证据 `acceptance/g0-result-studio/rs-p1-result-surface.json`；不外推 P7 产品资格 | G0-RS-P1 |
| UI-107 | verified | P0 | W-04 | P-03, C-04, C-06 | Result Studio / 科学选择交互 | 表格没有真实排序、过滤、行列选择；图形没有 point/region 到稳定科学实体的映射，用户说“这些基因”时系统没有权威引用 | 通用 ScientificInteractionViewer 已覆盖权威完整表排序/过滤、行列、过滤后全选、18 行虚拟视口，scatter point/region/legend 与 matrix gene/sample；Plugin SDK 要求稳定 interaction mapping，缺 mapping 显式只读。真实 DEG、火山图、热图和 130 行富集表由 admitted Job/Artifact/Revision API 捕获；10 万行 scroll/select/sort/filter 反馈均低于 100ms，精确采样保存在 acceptance JSON。证据 `rs-p2-{live-observation,ui-observation,scientific-interaction}.json` | G0-RS-P2 |
| UI-108 | in_progress | P0 | W-03, W-04 | P-01, P-03, C-04 | Result Studio / Agent 上下文编排 | 用户以为 Agent 知道当前结果和选择，实际系统提示缺 artifact/revision/family/selection/workflow/script/schema 坐标，导致重复查询或猜内部 ID | G0-RS-P3 已建立 `ResultStudioContextEnvelope v1` 与 `contextToken`，全部坐标由后端从 SQLite/`tool_jobs`/插件 descriptor 重新投影；6 个 `*_in_context` 工具不暴露工程 ID，陈旧 token fail-closed。P4R-3 已补上并由 source-bound P3/P4/P4R evidence 覆盖此前未被 P3 门抓到的生产断链：task 与 legacy toolCtx 都携带 Artifact 线索；结果 Composer 把点击时 token、Artifact 与结构化编辑请求原子绑定，schema 校验前只补缺失 token，显式 stale token 不被覆盖。绑定态仍由 Agent 自动调用 `result_studio_context` 读取可信 editable schema，再 plan；用户无需知道这一步或提供 ID。Selection token 现覆盖 fields/filter/sort/updatedAt；stale 响应不泄露新 token，create 只接受同一 Agent turn 中服务端保存的原始 intent，模型篡改分类/确认、旧 selection intent 配新 token、script patch 与模型自带 DAG 全部 fail-closed。token/内部 ID 不进入用户消息或普通 UI。双真实 Provider 与真实候选 Revision 尚未复验，故保持 `in_progress` | G0-RS-P3 / G0-RS-P4R / G0-RS-P7 |
| UI-109 | in_progress | P0 | W-04 | P-03, P-04, C-04, C-06 | Result Studio / Agent-first 统一编辑 | P4 Core 已有 Schema 参数面板，但真实使用表明参数控件成为显著入口会把分析负担重新交给用户；目标用户应先用自然语言描述结果变化，参数只在需要精调时出现 | G0-RS-P4 Core 的 descriptor/`normalizeEditSubmission → ResultEditIntent → ScientificChangeSet` 单链保留。P4R-3 已把自然语言 Composer 放到中央结果焦点底部，按 project/conversation/Artifact/Revision/Selection 保存草稿和 token 快照；loading/blocked/无会话/并发 run 均 fail-closed，拒绝时不清草稿。右栏只保留默认关闭的“高级精细调整”抽屉，手动 patch 与 Agent 继续进入同一 context-bound plan/ChangeSet 链。专项 76/76 Node、134/134 frontend、strict TypeScript 与 source-bound P4R product 10/10 已通过；真实手动/AI 候选等价链和 Provider 产品体验通过前继续 `in_progress` | G0-RS-P4 Core / G0-RS-P4R / G0-RS-P5 |
| UI-110 | verified | P0 | W-04 | P-02, P-03, P-04, C-05 | Result Studio / 科学差异与真实编辑 | 版本比较偏 Git/文件事实，用户无法快速判断显著基因、通路、阈值和下游结论如何变化 | G0-RS-P5 已在 `e7f271c` 建立 source-bound scientific truth；P6-0 又以 `acceptance/g0-result-studio/rs-p6-ui110-electron-scientific-trace.json` 完成真实 Electron 产品 trace。证据绑定 source commit `6f5271e`，且观测期间 source binding 稳定：空 disposable ledger 经 migration、HTTP project 与 admitted `run_tool → tool_job → Artifact Truth` 产生 7 个 Job、6 个 ChangeSet、26 个 Revision 和 26 个物理 Artifact；同一 BrowserWindow 实际完成 Result/Compare/History、Composer、高级抽屉、adopt/revert/restore/reopen。DEG、GO/KEGG、volcano SVG/PNG、heatmap 展示/计算边界、阈值受影响子图及历史恢复均与 SQLite/Job/Artifact/Git/validator 精确对账，默认公开 DOM 的敏感路径泄漏断言全部为 false。因此 UI-110 在 source-bound 开发态 Electron 科学差异与真实编辑边界内为 `verified`。该证据仍为 `qualificationEligible:false`，不证明 Provider、packaged、恢复/压力或 P7 产品资格 | G0-RS-P5 / G0-RS-P6 / G0-RS-P7 |
| UI-111 | in_progress | P0 | W-03, W-04 | P-02, P-03, P-05, C-04, C-05, C-06 | Result Studio / 恢复、响应式与诚实资格 | 现有截图/fixture 无法证明用户可在中断、重启、820px 和真实 Provider 下完成完整结果任务 | P6-1 已建立开发态 Electron 的真实恢复与压力 trace：同一 durable SQLite/Git/Artifact stores 上 SIGKILL 活跃 Electron/编辑 worker、冷启 owned backend、UI 恢复和再次重开，并以真实 10 万行/复杂媒体/长报告/多 Revision 操作冻结预算；公开 DOM、网络目标和后端健康由机器对账。当前只足以把本项从 `open` 推进到 `in_progress`：literal OS reboot、packaged Electron、明暗×1440/1024/820 完整操作、双真实 Provider 与 P7 资格仍未执行 | G0-RS-P6 / G0-RS-P7 |
| UI-112 | verified | P0 | W-04 | P-02, P-05, C-04, C-05 | Result Studio / Fast Result Path | 点击本地图片仍可等待数秒；结果打开同时触发 baseline/Git、完整 backing table、Context、版本和 storage 同步工作，开发态观察到本地后端事件循环多次阻塞约 2.1～8.2 秒 | P4R-6 的 source-bound performance evidence 14/14 记录 event-loop 19.661ms ≤ 250ms；首次 baseline 与 workspace/storage inspection 在复用 canonical Git/SQLite 的持久子进程中完成。真实 Electron 首反馈 16.22ms、首内容 3.9ms、模式切换峰值 20.736ms，明暗 × 1440/1024/820 无页面横溢出。仅验证本地 development renderer，不升级 Provider/packaged/GA | G0-RS-P4R |
| UI-113 | verified | P0 | W-04 | C-01, C-04, C-06 | Result Studio / 单结果聚焦与导航重构 | 版本、交付、报告、二级 Artifact rail 和常驻 Honeycomb 结果导航同时占据主画布，用户打开一个结果后注意力仍被多个结果和面板分散 | source-bound Electron 同一 BrowserWindow 覆盖明暗 × 1440/1024/820、Result↔chat 草稿保持、Result/Code/Compare/History 往返、Return 激活、Space 选择真实散点与可见焦点；每模式主操作不超过 3，内部 ID/路径/凭据不进入普通 DOM。仅验证本地 development renderer | G0-RS-P4R |
| UI-114 | verified | P0 | W-04 | P-02, P-03, C-04, C-06 | Result Studio / 版本选择与 Codex-like Change Review | UI-104 已验证底层比较/采用/撤销原语，但此前用户没有可直接查看 v1/v2/v3 的版本选择器；历史只在展开比较后出现且旧版只能恢复，技术/存储内容也淹没了“改了什么” | source-bound Electron 在同一 BrowserWindow 从 deterministic context-bound Agent 候选进入 Compare，完成采用→撤销→History 把 v2 恢复为新 v3；同 renderer 后端停启后恢复 ordinal/current、主体和 Composer。版本/storage 请求失败保留主体并可重试；不外推真实 Provider 或科学编辑 | G0-RS-P4R |
| UI-115 | verified | P0 | W-04 | P-03, P-04, C-04, C-06 | Result Studio / 每结果代码与一键复现 | 当前“查看脚本”藏在准备移除的导航中且主要返回 Job 级脚本；用户无法从每个 Artifact/Revision 直接查看、复制该版本实际执行的完整代码 | source-bound Electron 从恢复后的 v3 打开 exact Code，完成受控 replay 预检/确认，只生成非 current 候选并进入 Compare，再由 UI 放弃候选；Code 失败显示可行动错误，切回 Result 保留主体并可恢复。Provider/packaged 仍不在此声明 | G0-RS-P4R |
| UI-116 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 自动聚焦与 Artifact 可用性 | 打开结果仍同时占用左右栏；Artifact 文件接口返回 409 时主画布出现破图，但 header 仍只显示绿色“可信结果”，混淆科学 validation 与文件可用性 | 2026-08-03 开发态 Electron 真实旧 GO/KEGG Job：结果 URL 首次进入时左右栏均收起，返回对话两栏恢复；文件 HTTP 409 时 Header 同时显示“可信结果 / 文件不可用”，主画布无破图并有重试/Agent 检查，Inspector 隐藏失效文件入口。仅验证开发态，不外推 packaged/P7 | G0-RS-UX1A |
| UI-117 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 结果导航与格式清晰度 | 同一科学图的 PNG/SVG/PDF 以多个文件占据导航，数据和技术文件与主结果混在一起 | 纯函数 9/9 覆盖同 stem PNG/SVG/PDF 合并、PNG 优先与非图文件不误合并；开发态 Electron 真实旧 GO/KEGG Job 确认 PNG 默认预览、主导航保留科学结果、数据/其他 14 项进入“相关文件”折叠。该 Job 无同图 SVG/PDF，变体实机观察边界明确；不外推 packaged/P7 | G0-RS-UX1B |
| UI-118 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 结果优先的信息层级 | 主结果卡同时暴露原始文件名、导出、脚本和重放等技术信息，科学结果焦点被稀释 | 前端聚焦测试 16/16；开发态 Electron 真实旧 GO/KEGG Job 确认首屏主卡只显示“当前预览 / GO-BP 气泡图 / 图表”，原始文件名、导出、脚本、重放均不占据首屏并保留在“更多操作”；文件不可用时重试/Agent 恢复仍清晰可见。不外推 packaged/P7 | G0-RS-UX1C |
| UI-119 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 顶层标题与侧栏边界 | 进入结果模式后窗口顶层仍显示项目目录名；左右侧栏收起后仍保留灰色边界线，右侧图标组有重复分隔线，全局后退/前进按钮长期无效；底部横线被左区背景遮挡，renderer 缩放会让自定义标题栏偏离固定的原生窗口按钮 | 纯函数 3/3、相关前端 15/15、TypeScript、docs/UI 门禁通过；结果模式标题跟随 Artifact，侧栏收起时对应边界隐藏，重复分隔线和全局箭头移除；底部横线整宽置顶绘制，标题栏与正文同步缩放，macOS traffic lights 按真实 zoom factor 动态居中。开发态 Electron 在默认、连续缩小两档和放大一档下确认 chrome 同步及内容起点连续；原生按钮自身尺寸由 macOS 管理，不外推 packaged/P7 | G0-RS-UX1D |
| UI-121 | verified | P1 | W-04 | C-01, C-02, C-04 | Result Studio / 单结果聚焦导航 | 顶部 Artifact 卡片网格与右侧 Honeycomb 结果栏同时常驻，重复表达同一选择并挤压结果主体的横向和纵向空间 | 新增单一紧凑结果选择器，沿 manifest 分组并以科学结果而非 raw 文件计数；PNG/SVG/PDF 全局归组，PNG 优先预览，SVG/PDF 作为导出格式，数据与中间产物进入“更多结果操作”。`selectedName` 保持唯一选择真相。纯函数/组件及相关前端 36/36、TypeScript 通过；开发态 Electron 真实旧 GO/KEGG Job 确认 22 个结果可切换、标题与主体同步、PDF 仅作导出、相关文件仅 4 个 RDS，主画布恢复全宽。旧 Job 物理预览文件不可用，不外推 packaged/P7 | G0-RS-UX1E |
- UI-032 属于 `P-07 模型网关与 AI Provider` 的 Harness 能力子系统（Stage 3 M1），现已与 UI-031/UI-033/UI-034 一起完成实机验收。
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


## 12. 2026-07-22 UI-046 / UI-047 / UI-048 实机收口
- UI-046 Chat @file 文件引用实机确认：输入区 `@` 触发补全面板、chip 渲染、点 chip 跳转文件树、R 端解析 `@file` 并把路径透传到 harness 工具上下文；不修改 SSE / copilot_messages schema 与持久化路径；前端 typecheck / 测试 / ui:audit:check 通过。
- UI-047 CodeHighlight 通用组件实机确认：明暗主题下语言栏、复制入口与 Markdown fenced code 复用一致；不引入新的主题变量或修改现有 markdown 渲染管线；前端 typecheck / 测试 / ui:audit:check 通过。
- UI-048 Office 文件预览实机确认：`.docx` / `.xlsx` / `.pptx` 三类在项目文件树中均能给出文本 + 表格摘要预览，预览失败 fallback 到“用默认应用打开”，未引入第二套文件真相系统；前端 typecheck / 测试 / ui:audit:check 通过。

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
