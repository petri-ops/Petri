# BioF3 Desktop v1 产品化路线图

最后更新：2026-07-21

## 1. 决策与文档优先级

本文件是 `rc.5` 之后、首个相对稳定产品版本的主执行路线图。Stage 4 基线为 `rc.6`，当前增量候选为 `rc.7`。后续无论使用 Codex、Claude Code、Cursor 或其他 Agent，都必须先读取本文件，再读取：

1. [`docs/project-workspace-handoff.md`](./project-workspace-handoff.md)
2. [`docs/development-module-map.md`](./development-module-map.md)
3. [`docs/codex-style-workbench-direction.md`](./codex-style-workbench-direction.md)
4. 当前阶段对应的专项文档

如果旧文档仍把 GO/KEGG、P-04 或 Harness 标成“当前下一阶段”，以本文件为准。最新产品决策明确采用以下串行顺序：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 v1 稳定发布**

不允许在 Stage 1 尚未验收时提前展开模型 Provider 实现，也不允许在 Stage 2 尚未验收时批量扩充 Harness 内容。可以做只读审计和记录，但实现必须遵守阶段边界。

## 2. 当前基线

- `v0.0.1-rc.7` 是当前 OSS 安装基线，已完成发布验收。
- macOS arm64/x64 本机构建、OSS 发布、最新版提示和 `rc.4 → rc.7` 公开更新链路已经通过。
- Harness Phase 1–6、Plugin SDK、Agent workflow runtime、恢复与 fixture 门禁已经建立；Stage 1–2 期间保持可回归，不继续扩建第二套基础设施。
- 当前聊天主链主要依赖 DeepSeek；DashScope 已用于 embedding/vision；OpenAI/Ollama 在设置页仍属于未来入口，模型调用链仍存在 DeepSeek 硬编码。
- 桌面三栏工作台、项目会话、结果/Artifact、浏览器、文件、终端、设置分类和回收站已完成 Stage 1 产品化验收。

始终保持的工程不变量：

> `run_tool → tool_job → artifact truth`

UI 不得制造第二套状态真相，模型层不得绕过确认/审计边界，Harness 不得创建第二套执行器或 workflow 数据库。

## 3. Stage 1：桌面 UI 产品化

状态：**已完成（`v0.0.1-rc.5` 检查点）**。

主模块：`W-01` 至 `W-07`；主要关注点：`C-01`、`C-02`、`C-04`、`C-06`。

### 3.1 目标

先把 BioF3 的桌面产品形态稳定下来，使导航、工作台、对话、结果和专业工具看起来属于同一个成熟产品，并让后续模型设置与 Harness 能力有稳定的承载界面。

这不是推翻现有工作台，也不是像素级复制 Codex。保留既有信息架构：

- 左侧：项目、会话与资源。
- 中间：Agent 主工作区。
- 右侧：结果、浏览器、文件、终端等工具。
- 正式执行状态继续来自现有 job/artifact truth。

### 3.2 固定推进顺序

#### UI-1 实机审计与问题台账

- 对正式安装版和开发版逐屏检查：首页、项目工作台、设置、插件、结果、浏览器、文件、终端和专业功能页。
- 每个问题必须标注主模块、截图、复现步骤、严重度和预期结果。
- 区分视觉不一致、布局责任、状态同步、交互手感和真实数据错误，不使用“这里不太好看”作为最终任务描述。
- 建立 `docs/ui-productization-audit.md`，作为 Stage 1 唯一问题清单；完成项必须附验证证据。

#### UI-2 视觉基础与桌面壳

- 收敛颜色、字体、字号、间距、边框、圆角、阴影、按钮与表单状态。
- 统一明暗主题 token，清理页面级硬编码颜色和互相冲突的容器背景。
- 收口顶栏、窗口控制区、左右栏折叠、拖拽热区、最小宽度和全高布局。
- 保持普通 `Cmd/Ctrl+R` 不触发 Electron 硬刷新。

#### UI-3 首页、项目与资源导航

- 统一 Dashboard、项目列表、最近活动、空状态和新建项目流程。
- 明确项目、会话、文件和分析历史的层级，减少重复入口。
- 校正左侧栏的信息密度、选中态、折叠态和长文本处理。

#### UI-4 Agent 主工作区

- 优化消息密度、流式状态、输入框、模型选择器和访问模式控件。
- 统一参数确认、工具调用、等待确认、运行、失败、恢复和完成状态卡。
- 保证长对话、长日志、Markdown、工具结果和错误信息不会造成跳版或主线程卡顿。
- 只消费现有 Agent/job 状态，不在前端发明新流程状态。

#### UI-5 结果与右侧工具区

- 保持“主预览 + 右侧 Artifact 导航”的结果结构。
- 统一图片、表格、HTML 报告、日志、JSON 和下载入口。
- 收口浏览器、文件树、终端与结果面板的标题栏、空状态、错误态和主题。
- 保证当前结果能稳定反向进入 Agent 上下文。

#### UI-6 设置、插件与边缘页面

- 重组设置页信息层级，为 Stage 2 的模型管理中心预留稳定结构，但本阶段不实现新 Provider。
- 统一插件商店、运行时管理、诊断、更新与数据管理界面。
- 对仍保留的专业功能页面做壳层一致性处理，不在 Stage 1 重写分析业务页面。

### 3.3 Stage 1 验收出口

- `docs/ui-productization-audit.md` 中 P0/P1 问题清零；P2 必须有明确延期理由。
- 首页、项目工作台、设置、结果、浏览器、文件、终端完成明暗主题实机截图基线。
- 左右栏折叠、拖拽、长内容、流式消息、结果切换和窗口缩放没有明显跳版或状态丢失。
- `npm --prefix frontend run check`、前端测试、生产构建和打包态冒烟通过。
- 用户完成一轮主观视觉验收并确认 UI 形态稳定。
- Stage 1 结束前只允许修复 Harness/模型层的阻断性回归，不展开能力扩充。

## 4. Stage 2：模型层与多 Provider

状态：✅ 2026-07-17 已完成出口验收；后续只接受独立、可验证的模型层回归或明确授权的增量工作包。

主模块：`P-07 模型网关与 AI Provider`；影响模块：`W-03`、`P-01`、`P-03`、`P-06`；主要关注点：`C-03`、`C-04`、`C-05`。

### 4.1 目标

把当前“DeepSeek 可以用、其他入口只是预留”的状态升级为统一、可测试、可切换、可审计的模型能力层。设置 UI 使用 Stage 1 已稳定的界面结构，模型调用不再散落在各业务文件中。

### 4.2 固定推进顺序

#### MODEL-1 Provider 调用收口

- 定义版本化 `ModelProfile`：provider、model、baseUrl、credentialRef、capabilities、角色和可选参数。
- 让聊天、Agent、摘要、记忆、报告和解释统一经过 Model Gateway。
- 清理直接请求 `api.deepseek.com`、固定 `deepseek-chat` 和固定 `getApiKey('deepseek')` 的业务路径。
- 保留兼容层，但兼容层只能转发到 Gateway，不能继续形成第二套调用实现。

#### MODEL-2 第一批 Provider

1. DeepSeek：迁移为统一基线 Provider。
2. OpenAI-compatible：支持自定义 Base URL、模型名和 API Key，作为云端兼容服务的通用入口。
3. Ollama/LM Studio/vLLM：支持本地 Endpoint、无 Key 场景和本地健康检查。
4. Anthropic 原生 Provider：独立处理消息、流式与工具调用协议，不伪装成 OpenAI-compatible。
5. 保留并规范 DashScope embedding/vision；后续多模态 Provider 按 capability 接入。

#### MODEL-3 角色与能力路由

- 分别配置默认聊天、Agent 工具调用、复杂规划、视觉、Embedding 和低成本摘要模型。
- 声明 streaming、tools、vision、embedding、reasoning 等能力；不支持的功能在调用前阻断并给出可理解诊断。
- Provider 失败时禁止静默换模型；只有用户配置了 fallback 且明确允许时才切换，并记录原因。

#### MODEL-4 凭据、安全与可观察性

- API Key 从普通 `ai-settings.json` 数据结构中分离；macOS 优先使用 Keychain 或等价 credential reference。
- IPC 和设置 API 只返回掩码与配置状态，不返回明文 Key。
- 日志、诊断、usage 和错误对象不得包含 Key、Authorization header 或完整敏感请求体。
- 记录 Provider、模型、延迟、Token/用量、工具调用能力和标准化错误分类。

#### MODEL-5 模型管理中心

- Provider 卡片、Endpoint、模型、凭据状态和连通性测试。
- 角色默认模型、能力标签、最近错误和可选用量概览。
- 会话模型选择器只展示已经验证且满足当前能力要求的 Model Profile。

### 4.3 Stage 2 验收出口

- DeepSeek、一个 OpenAI-compatible 云端模型和一个本地模型完成真实聊天验证。
- 至少两个 Provider 完成流式输出和 Agent tool calling 回归。
- 摘要、报告、记忆等后台路径不再硬编码 DeepSeek。
- Provider 切换不破坏 conversation、job、artifact 或 Harness 状态。
- 凭据不出现在设置读取、日志、诊断包和测试快照中。
- 模型管理中心通过打包态实机验收。

## 5. Stage 3：Harness 规范与标准流程扩展

状态：✅ 2026-07-19 已完成并通过出口验收。实施证据见 [`stage3-standard-workflows-design.md`](./stage3-standard-workflows-design.md)。

主模块：`P-03 Harness 与 Agent 工作流`、`P-04 Plugin SDK 与分析能力`；依赖：`P-02`、`P-07`、`W-03/W-04`。

### 5.1 目标

在产品外形和模型能力稳定以后，用真实分析流程验证并扩展 Harness。该阶段允许增加内容，但必须通过现有 Plugin SDK、fixture 和 artifact truth 接入，不批量复制脚本，不为单个流程修改 Agent 核心。

### 5.2 固定推进顺序

1. GO/KEGG：首个标准流程样板，完成 manifest、schema、failureModes、fixture、真实 DEG 输入和 valid artifact 输出。
2. Provider 矩阵：使用 Stage 2 的不同模型重复 intent、选型、修参、tool calling、恢复和结果解释评测。
3. GSEA：复用样板验证排名输入、数据库选择和结果消费。
4. WGCNA：验证更长运行、资源提示、分阶段产物与失败恢复。
5. 按用户价值和依赖成熟度逐个扩展其他 Bulk RNA、单细胞和多组学流程。

每个新增流程必须证明：

- 可被 built-in/installed/development 来源发现。
- 缺陷在安装或 CI 阶段给出结构化诊断。
- Agent 按 `plan → run → verify → bind → decide/recover` 单步推进。
- 只有真实 valid artifact 能激活下游。
- 本地内嵌运行时执行（无执行模式开关）；canonical execution context 抽象保留，未来若需远端/容器执行只扩 adapter，不改业务。

### 5.3 Stage 3 验收出口

- GO/KEGG、GSEA、WGCNA 至少形成三条真实标准流程闭环。
- 不同 Provider 下的 Harness 评测具有可比较报告和明确失败分类。
- 新流程接入不修改第二套执行器、job 数据库或结果查看器。
- 全量 Harness/Agent fixture、真实 artifact、恢复与 adapter 回归通过。
- 文档形成可复制的第三方插件接入指南。

## 6. Stage 4：首个稳定产品版本

状态：✅ macOS arm64 RC 工程出口完成；`rc.7` 已完成公开分发链路，但仍属于工程候选版，不等于正式产品上线。签名/公证不作为本项目必需条件；x64 分析 Runtime 是否建设另行决策。执行台账见 [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)。

主模块：`P-06 桌面集成与交付`；覆盖全部质量关注点。

### 6.1 发布前收口

- 功能冻结，只修复阻断、数据错误、安全问题和明确回归。
- 使用全新用户目录完成首次启动、运行时、模型配置、项目创建、真实分析、结果解释和升级测试。
- 使用旧 RC 完成自动更新到候选版本，核对下载、SHA-512、DMG 打开和覆盖安装说明。
- 检查数据迁移、配置兼容、凭据迁移、日志脱敏和卸载后数据保留。
- 完成用户文档、模型配置说明、标准流程说明、已知限制和发布说明。

### 6.2 v1 发布出口

- UI Stage 1、模型 Stage 2、Harness Stage 3 的出口全部满足。
- 根项目、前端、Harness/Agent、Provider contract 和真实流程测试全部通过。
- macOS arm64 完成真实安装级冒烟；x64 完成构建结构与必要实机验证。
- OSS 发布与旧版升级链路通过；GitHub 只保存源码和不可变标签。
- 没有未说明的 P0/P1 缺陷；已知限制写入发布说明。
- 用户确认该候选版本达到“第一个相对稳定产品版本”的标准后，才决定最终版本号和发布标签。

## 7. 跨 Agent 执行规则

每个 Agent 开始工作前必须：

1. 读取本文件并确认当前 Stage。
2. 读取 `git status`、最近提交和对应专项文档。
3. 为任务指定一个主 W/P 模块和必要的 C 关注点。
4. 先写可验证的小步计划，再修改产品主线代码。
5. 不得把后续 Stage 的功能顺手混入当前提交。

每个任务交接至少记录：

- 当前 Stage、主模块和任务目标。
- 修改文件与关键设计决定。
- 验证命令、实机证据和未覆盖项。
- 涉及核心后端的改动直接改仓库内 `core/`，随 Desktop 一起提交（已去 vendor 化，无 submodule / `.vendor-lock`）。
- 下一步和禁止破坏的不变量。

## 8. 当前立即执行项

Stage 1–4 的 macOS arm64 RC 出口均已关闭。当前不扩展分析内容；经用户确认，新增的工程主线是 [`harness-scientific-task-contract-plan.md`](./harness-scientific-task-contract-plan.md) 中的 P-03 Harness Scientific Task Contract v1：

1. 功能冻结，只修复发布阻断、数据错误、安全问题和明确回归。
2. ✅ 全新用户目录完成 Runtime、项目、DESeq2 与 GO/KEGG 真实分析。
3. ✅ 用正式 `rc.4` 数据副本验证迁移与设置/插件兼容。
4. ✅ 完成 arm64 完整链和 x64 壳层构建/启动门禁；x64 Runtime 缺失已列为限制。
5. ✅ 发布 `v0.0.1-rc.6`，验证 OSS 更新、公开下载、SHA-512 和 DMG 打开链。
6. 观察 rc.7 真实使用反馈；后续产品阶段需单独立项。
7. ✅ HRT-0 已建立成功、多步骤 lineage、歧义/失败恢复等六类脱敏任务和七组指标，离线门禁 24/24；当前进入 HRT-1 冻结 TaskSpec/Context schema，HRT-0 已知缺口不冒充产品验收。
