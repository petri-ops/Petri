# BioF3 开发模块地图

最后更新：2026-07-14

这份文档是 BioF3 Desktop 的统一开发词典。需求、缺陷、交接、提交和测试都应使用这里的模块名，避免把“右侧栏”“结果页”“后端”“主题”等不同层级的概念混在一起。

## 1. 使用规则

每个任务至少标注一个**主模块**，必要时再标注一个**跨模块关注点**：

> `[主模块编号 模块名] 问题或目标；关注点：C-xx`

示例：

- `[W-04 结果与报告] 最终 HTML 报告未跟随暗色主题；关注点：C-01`
- `[W-05 内置浏览器] WebView 高度未占满右侧工作区；关注点：C-02`
- `[W-01 桌面壳层] 右栏收起后顶部标签仍显示；关注点：C-02`
- `[P-03 Harness 工作流] artifact degraded 后给出恢复动作；关注点：C-03`

判断主模块时，以“**需要修改的责任边界**”为准，而不是以用户看到问题的位置为准。一个问题如果跨越多个模块，指定一个主模块，其余写在“影响模块”中，不临时创造新模块名。

## 2. 产品工作台模块（W）

### W-01 桌面壳层（Desktop Shell）

负责应用最外层窗口、全局顶栏、窗口控制、一级导航以及左右/底部区域的开合入口。

- 包含：TitleBar、DesktopToolbar、窗口按钮、顶层标签轨、Electron 窗口桥接。
- 不包含：具体右栏工具内容、聊天消息内容、分析执行逻辑。
- 主要路径：`frontend/src/components/desktop/`、`src/main.js`、`src/preload.js`。

### W-02 工作台布局（Workspace Layout）

负责项目工作台的空间组织和交互手感。

- 包含：左/中/右/底部面板、拖拽调宽、折叠、宽度持久化、全高布局、紧凑窗口适配。
- 不包含：结果预览器内部布局、浏览器网页内容、终端会话协议。
- 主要路径：`frontend/src/pages/project-workspace.tsx`、`frontend/src/pages/project-workspace.module.css`、`frontend/src/components/workspace-panels/`、`frontend/src/hooks/useResizableColumns.ts`。

### W-03 Agent 会话（Agent Conversation）

负责用户与模型在项目中的连续交互。

- 包含：消息气泡、用户/模型头像、输入框、流式回复、工具确认卡、结果卡、会话切换和项目级会话绑定。
- 不包含：工具真实执行、artifact 真相判断、右侧结果的渲染实现。
- 主要路径：`frontend/src/components/copilot/`、`core/r-server/routes/ai-conversations.js`、`core/r-server/helpers/conversations*.js`。

### W-04 结果与报告（Results & Reports）

负责分析完成后的结构化结果交付。

- 包含：artifact 导航、图表/表格/图片/PDF/HTML 预览、最终报告生成/查看/导出、报告主题、结果状态条。
- 报告是后置交付物；核心 artifacts 继续作为后续分析的交互入口。
- 不包含：通用网页导航控件、工具执行本身、文件树的一般文件浏览。
- 主要路径：`frontend/src/pages/project-workspace.tsx` 中结果组件、`frontend/src/pages/project-workspace.module.css`、`core/r-server/helpers/report-theme.js`、插件报告模板。

### W-05 内置浏览器（In-app Browser）

负责右侧栏中的通用网页浏览能力。

- 包含：地址栏、前进/后退/刷新、WebView 生命周期、网页全高展示、内外部 URL 导航。
- 不包含：HTML 报告的生成与内容主题；报告只是浏览器可以打开的一类 URL。
- 主要路径：`frontend/src/components/workspace-panels/RightPanel.tsx` 中浏览器组件、`frontend/src/lib/browser-url.ts`、Electron WebView 配置。

### W-06 项目资源与文件（Project Resources & Files）

负责项目资源定位与文件查看。

- 包含：左侧项目/数据集入口、右侧文件树、文件选择、文本/图片/CSV/PDF/HTML 预览、文件下载。
- 不包含：artifact truth、分析结果语义、插件输入推断。
- 主要路径：`frontend/src/components/workspace-panels/LeftPanel.tsx`、`frontend/src/pages/project-workspace.tsx` 中 `RightFileTree` 和 `WorkspaceFilePreview`、workspace file API。

### W-07 集成终端（Integrated Terminal）

负责低频但必要的命令行观察和操作能力。

- 包含：终端会话、xterm 渲染、shell 选择、尺寸适配、清空/关闭、退出状态。
- 终端是辅助工具，视觉优先级低于 Agent 主工作区。
- 不包含：R/Python 分析任务执行器、Harness runtime 检测。
- 主要路径：`frontend/src/components/workspace-panels/BottomTerminal.tsx`、`frontend/src/hooks/useTerminalSession.ts`、`frontend/src/themes/terminal-themes.ts`、终端 IPC。

### W-08 专业功能页面（Domain Workbenches）

负责保留的传统专业入口和管理页面。

- 包含：`/tools`、`/single-cell`、`/spatial`、`/figcode`、`/admin` 等独立页面。
- 不包含：项目三栏工作台的通用能力；可复用能力应下沉到共享模块或插件。
- 主要路径：`frontend/src/pages/tools*`、`frontend/src/pages/single-cell/`、`frontend/src/pages/spatial/`、`frontend/src/pages/figcode*`。

## 3. 平台与分析模块（P）

### P-01 项目、会话与上下文（Project Context）

负责 project、conversation、dataset、workspace file 和当前活动资源之间的身份与权限关系，是 Agent 和界面共享的项目上下文。

- 不负责执行分析，也不判定产物是否可信。
- 核心对象：`projectId`、`conversationId`、dataset、workspace scope、active artifact/file/job。

### P-02 工具执行、Job 与 Artifact Truth（Execution Truth）

负责唯一的正式执行事实链：

> `run_tool → tool_job → artifact truth`

- 包含：任务提交、状态、参数、日志、结果清单、磁盘校验、artifact 的 valid/degraded/blocked 真相和 lineage。
- 禁止建立第二套 executor、job 状态表或结果真相系统。
- 主要路径：Core 的 tools/task routes、`helpers/step-tool-job.js`、`helpers/artifact-truth.js`。

### P-03 Harness 与 Agent 工作流（Harness Workflow）

负责让 Agent 在既有执行事实之上完成识别、选型、参数修复、确认、运行、验证和恢复。

- 固定阶段：`inspect → infer → select → repair → confirm → run → verify → report`。
- 包含：文件索引、readiness、tool selection、workflow state、恢复动作、二跳 artifact 绑定。
- 不拥有执行真相；状态必须投影自 P-02。
- 主要路径：`scripts/harness-*`、`core/shared-backend/agent-workflow.js`、Core Harness routes/helpers。

### P-04 Plugin SDK 与分析能力（Plugin System）

负责可安装、可校验、可发现的真实分析能力。

- 包含：`plugin.json`、`tool-definition.json`、输入/参数/output schema、failureModes、执行脚本、fixture、内置/安装/开发来源。
- 新增分析流程原则上通过插件接入，不修改 Agent 主 prompt、核心执行器或结果 UI。
- 主要路径：`resources/built-in-plugins/`、`src/plugin-manager.js`、Core `plugin-loader.js`、`shared-backend/plugin-sdk.js`、`scripts/scaffold-harness-tool.mjs`。

### P-05 Runtime 与平台适配（Runtime & Adapters）

负责分析在本地、容器和远端平台上的一致运行环境。

- 包含：canonical execution context、R/Python/Node runtime、路径映射、local/container/remote adapter、跨平台 shell 与 ABI 兼容。
- 平台差异只能停留在 adapter 层，不能渗入业务 UI 或工作流定义。
- 主要路径：`core/shared-backend/execution-context.js`、runtime helpers、`src/platform-compat.js`。

### P-06 桌面集成与交付（Desktop Integration & Delivery）

负责 Electron 主进程、IPC、安全边界、服务启动、资源打包、安装更新和 vendor 同步。

- 包含：main/preload、WebView 权限、后端进程管理、构建产物、macOS/Windows/Linux 打包。
- 不包含：页面视觉样式和分析业务逻辑。
- 主要路径：`src/`、`build/`、`package.json`、`.github/workflows/`、`core/`。

### P-07 模型网关与 AI Provider（Model Gateway）

负责 Agent、聊天、摘要、记忆、报告和多模态能力使用的统一模型接入层。

- 包含：Model Profile、Provider 注册、Base URL、credential reference、流式响应、tool calling、vision、embedding、能力声明、角色路由、健康检查、usage 与标准化错误。
- 业务模块不得直接硬编码 Provider Endpoint、模型名或 API Key；兼容层只能转发到统一 Gateway。
- Provider 失败时不得静默换模型；fallback 必须由用户配置、明确允许并可审计。
- 主要路径：`core/shared-backend/llm-providers/`、Core `helpers/llm-client.js` / `helpers/ai-settings.js` / AI routes、Desktop AI settings IPC 和模型管理 UI。

## 4. 跨模块关注点（C）

跨模块关注点不是独立功能区，不能替代主模块。

| 编号 | 名称 | 统一要求 |
| --- | --- | --- |
| C-01 | 主题与视觉系统 | 明/暗主题、颜色、边框、圆角、层级统一使用共享 token；报告、终端、浏览器壳和文件树均须联动。 |
| C-02 | 布局与响应式 | 全高、宽度、拖拽、折叠、overflow 和最小尺寸必须明确由外层还是内容容器负责。 |
| C-03 | 安全、确认与审计 | 重计算、覆盖、删除、恢复动作必须经过既有确认和审计边界。 |
| C-04 | 状态与事件同步 | 聊天、结果、浏览器、文件和当前 job 的跨面板联动使用稳定事件/状态契约。 |
| C-05 | 测试与质量门禁 | 类型检查、构建、单元测试、Harness fixture、跨平台 CI 和视觉核对按风险执行。 |
| C-06 | 性能与交互手感 | 拖拽“丝滑”、流式渲染、轮询、iframe/WebView 和大文件预览避免阻塞主线程或引发跳版。 |

## 5. 容易漂移的表述

| 模糊说法 | 应改为 |
| --- | --- |
| “右侧栏有问题” | 指明 W-02 布局、W-04 结果、W-05 浏览器或 W-06 文件中的哪一个。 |
| “报告浏览器” | 报告内容/生成属于 W-04；通用地址栏/WebView 容器属于 W-05。 |
| “结果页宽度” | 外层拖拽与持久化属于 W-02；结果内部排版属于 W-04。 |
| “终端执行失败” | xterm/终端会话属于 W-07；正式分析任务失败属于 P-02；运行时缺失属于 P-05。 |
| “Agent 没跑对” | 消息交互属于 W-03；选型/修参属于 P-03；插件计算属于 P-04；job/artifact 状态属于 P-02。 |
| “模型不够用” | 会话选择器属于 W-03；Provider、Endpoint、能力和凭据属于 P-07；模型导致的选型/修参效果属于 P-03。 |
| “主题没统一” | 仍需指定主模块，并附加关注点 C-01。 |
| “后端问题” | 明确为 P-01 上下文、P-02 执行真相、P-03 工作流、P-04 插件或 P-05 runtime。 |

## 6. 当前开发状态

### 当前活跃

- v1 Stage 1 只实现 UI 产品化：W-01/W-02 桌面壳、布局、面板与拖拽；W-03 Agent 会话；W-04/W-05/W-06/W-07 结果、浏览器、文件与终端容器。
- C-01/C-02/C-04/C-06：主题联动、布局责任、跨面板状态和交互性能。

### 基础能力已建立，后续以稳定化为主

- P-02：`tool_job + artifact truth` 唯一执行事实链。
- P-03：Harness Phase 1–6、Agent workflow runtime、恢复与 fixture 门禁。
- P-04：Plugin SDK、三来源发现、manifest 校验和内置样板插件。
- P-05/P-06：canonical execution context、跨平台 adapter、Electron 集成与 CI。
- P-07：已有 DeepSeek/DashScope 局部实现和 Provider 接口，但统一 Gateway、多 Provider、凭据分离和能力路由尚未完成；等待 v1 Stage 2。

### 后续主线

- 固定顺序以 `docs/v1-productization-roadmap.md` 为准：Stage 1 UI → Stage 2 P-07 模型层 → Stage 3 P-03/P-04 Harness 与标准流程 → Stage 4 P-06 稳定发布。
- Stage 1 期间不展开模型 Provider 或 Harness 内容扩充；Stage 2 期间保持 Harness 可回归但不批量增加流程。
- Stage 3 由 P-03 编排插件、P-02 记录真实 job/artifact、P-07 提供模型能力、W-03/W-04 交付和继续分析。

## 7. 任务与提交模板

需求或缺陷：

```text
[W-05 内置浏览器] WebView 在右栏只能显示上半段
关注点：C-02 布局与响应式、C-01 主题与视觉系统
影响模块：W-02 工作台布局
验收：展开/收起、明/暗主题、不同右栏宽度下均全高显示
```

提交信息建议：

```text
fix(browser): fill the right workspace height
feat(plugin-sdk): validate development plugin fixtures
docs(modules): define stable BioF3 development boundaries
```

交接记录至少包含：主模块、影响模块、当前状态、验证证据、下一步和禁止破坏的不变量。
