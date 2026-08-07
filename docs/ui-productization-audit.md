# BioF3 Desktop UI 产品化审计台账

最后更新：2026-08-07

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
| UI-049 | verified | P1 | W-04 | C-04, C-06 | 项目结果 / 科学交付摘要 | 结果页只有 Job/Artifact 导航和最终 HTML 报告入口，用户无法在首屏判断交付是 valid、degraded 还是 blocked，也看不到复现可用/已验证数量 | HRT-5 新增 `DeliveryManifest v1` 摘要卡：首屏分层展示“结论摘要 / 我做了什么 / 需要注意什么”，使用后端交付状态驱动左侧语义色，并显示 verified/available 复现数量与交付清单入口；产物卡提供“查看脚本”和“重放验证”，重放只向 Agent 发起需确认请求，不直接执行；不在前端重新推断科学状态。样本 metadata 校验、表达矩阵 QC、DEG 标准化 3 个仓库脱敏任务真实 R 链路均为 completed + artifact truth valid + delivery valid，证据为 `acceptance/harness-scientific-task/hrt5-delivery-acceptance.json`。2026-07-22 实机矩阵覆盖日间 valid/degraded/blocked、夜间 blocked、820px 窄窗；交付清单/脚本入口均返回 200，控制台 0 error。验收发现结果侧栏约 340px 时三列摘要受整窗 media query 误判，已改用 `.resultSidebarRoot` container query 在 520px 以下纵向排列，复验通过 | HRT-5 |
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
| UI-102 | verified | P1 | W-04 | C-04, C-06 | 结果与 Artifact 导航 / activeArtifact 语义层 | `activeArtifact` 只是文件级坐标（`jobId`/`toolId`/`name`/`type`/`label`/`url`），无法回答"这是哪个版本""用户选中的这些行是哪些基因"；Agent 拿到的上下文里选择只能退化成行号，重算或重排后指向错误实体 | `ActiveArtifact` 已具备 revision、semantic 与 selection 三个维度；稳定 ID 由后端完整文件判定，positional 永不冒充 durable。RS9 精确验证 DEG 表选择 27 个 `gene_id` 后以 filter/hash 和有界样本进入 Agent 上下文并继续 GO/KEGG；真实五万行表、应用重启和历史恢复均保持同一 Revision/Selection 语义，故晋升 verified | G0-RS3 / G0-RS5 / G0-RS9 |
| UI-103 | verified | P1 | W-03, W-04 | P-03, C-04, C-06 | Result Studio / ChangeSet 修改进度 | 隔离编辑会经历 materialize、Git candidate、Job、validator 和 Revision 多阶段；若前端只显示普通工具调用，用户无法判断修改停在哪一步，切到下一工具时阶段反馈也可能消失 | `result_edit_progress` SSE 与有界 run store 保留 change_set/materialize/commit/job/revision/preview/failed/cancelled。RS9 将失败、取消、历史 reopen 的 ChangeSet 回归与真实服务中断/重启 renderer 合并验收：重启后仍显示“修改现场已恢复”、同一候选和操作入口，阶段证据不因下一个工具或进程退出消失，故晋升 verified | G0-RS5 / G0-RS6 / G0-RS9 |
| UI-104 | verified | P1 | W-04 | P-02, P-03, C-04, C-06 | Result Studio / 结果版本比较与操作 | 候选 Revision 已生成但用户只能看到普通结果，无法理解变化、原子采用、撤销或把历史恢复成新版本；直接展示完整 Git 细节又会淹没科学结果 | 结果侧栏新增紧凑版本区：默认仅显示当前版本、候选/采用状态、来源、文件数和比较/采用/撤销；展开后按 SVG/图像、表格语义、JSON 字段、文本 Git diff 和 Revision history 分层，Git commit/ref 折叠到高级信息。采用通过 Git CAS + SQLite transaction 切换全部 current，baseline 不显示撤销，历史恢复永远生成新 commit/ChangeSet/Revision。隔离真实链完成 v1→采用 v2→撤销 v1→恢复 v3，重复恢复幂等；真实 renderer 覆盖明亮、夜间与 820×900，窄窗 `innerWidth=clientWidth=scrollWidth=820`，无页面级横向溢出 | G0-RS6 / RESULT-REVISION-REVIEW |
| UI-105 | verified | P1 | W-04 | P-02, P-05, C-04, C-05, C-06 | Result Studio / 耐久恢复与大表性能 | 退出或中断后修改现场只存在于运行内存；大表比较只有固定前缀摘要，无法继续读取；用户也看不到版本存储是否健康、重复内容和资源压力 | lifecycle/storage、checkpoint 恢复、content-addressed 去重、plan-token GC、preview 资源预算与 byte-cursor 分页已进入同一生产投影。RS9 真实五万行 DEG 表只渲染当前可见 24 行，展示 4 个版本、4421 KB 逻辑占用和 2210 KB 可去重空间；服务中断重启后同一候选恢复。明暗、1440×900、820×900 五态截图通过，820px `innerWidth=clientWidth=scrollWidth=820`，故晋升 verified | G0-RS8 / G0-RS9 / RESULT-LIFECYCLE |
| UI-106 | verified | P1 | W-01 | C-02 | TitleBar 全局 | 右侧栏收起后,摘要按钮(centerTitle 的 toggleSummary)与最小化按钮(WindowControls)重叠,Windows 自定义窗口控件下内容向左溢出压住摘要按钮 | `e6421e0` 将 TitleBar 3 列 Grid 收起态 rightSpan 从硬编码 56px 改为平台感知 `isMac ? 80 : 196`(Windows 预留 22px 余量以覆盖 windowTools + WindowControls 实际宽度);顺带把 collapsedLeftRail 改为 `isMac ? 180 : 146` 修正 macOS 收起左侧栏时红绿灯区与工具溢出。前端 tsc 0 错误;用户 Windows 实机确认重叠消失("厉害呀 我看到效果了") | UI-2 |
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
- **2026-07-25 代码完成（UI-102 → `in_progress`）**：后端 `core/shared-backend/artifact-interaction.js` + `core/r-server/routes/result-studio.js`（6 个端点）与前端 `frontend/src/lib/artifact-selection.ts` 已接线，`ActiveArtifact` 三维度升级完成。实机验证待办：在真实表格 artifact（含 10 万行量级）上确认行列选择、过滤排序、选择持久化与重启恢复，以及 positional 回退时的 caveat 显示；图形 point/region 选择的交互控件属 RS3 后续 UI 批次，当前只完成契约与管道。
