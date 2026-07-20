# BioF3 Desktop Current Handoff

最后更新：2026-07-21

## 1. 恢复顺序

新的 Agent 不应通读历史计划猜测主线。按以下顺序恢复：

1. `git status --short` 与 `git log -5 --oneline --decorate`
2. [`v1-productization-roadmap.md`](./v1-productization-roadmap.md)
3. [`next-steps-roadmap.md`](./next-steps-roadmap.md)
4. [`ui-productization-audit.md`](./ui-productization-audit.md)
5. [`development-module-map.md`](./development-module-map.md)
6. 当前任务涉及的专项规范

历史审计与阶段验收位于 [`archive/`](./archive/README.md)，只用于追溯，不决定当前顺序。

## 2. 当前产品阶段

`v0.0.1-rc.6` 是 Stage 4 macOS arm64 候选版本，也是当前 OSS 线上最新版。

当前固定顺序：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 首个稳定产品版本**

Stage 1、Stage 2、Stage 3 均已完成出口验收。Stage 4 macOS arm64 RC 已完成代码、首用、迁移、隐私、构建、提交/tag、OSS 上传及公开下载反向验证。

## 3. 当前立即任务

### Stage 4 之后的 Harness 工程主线

用户已于 2026-07-19 明确启动 Phase 7「通用基础工具与运行控制面」。这不重开已关闭的 Stage 3，也不增加分析流程；它是在 Stage 4 RC 基线之上的平台工程增量。

- 提交 `cec2c58` 已加入 7 个项目级文件/短命令工具并推送；开发壳已确认加载工具。
- P7-A 真实 Provider 基线验收已完成：DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 使用同一 8 场景矩阵，均为 8/8 PASS。
- 脱敏证据位于 `acceptance/harness-phase7/provider-baseline.{json,md}`；仅使用临时 fixture workspace，不含用户文件正文、凭据、请求头或完整 Provider 响应。
- 后端安全探针确认只读模式阻断 write/replace/exec/run，敏感/绝对/逃逸路径被拒绝，sudo、删除、git push 与远程脚本管道被拒绝；普通 `rm` 缺口已最小修复。
- P7-B 工具契约与注册表已完成：18 个模型可见工具的 definition、handler 与内部 contract 已收敛到 `agent-tools/registry.js`，模块加载时校验重名、定义/handler 漂移和非法元数据；`getToolDefs()` 只输出不含内部字段的 Provider-safe schema。
- dispatcher 已从注册表解析完整 entry，4 个退役学习工具保持不可见、不可由 Agent dispatcher 调用。
- P7-C 统一 Policy/Interceptor 已完成：schema 校验、workspace preflight、纯 `allow | deny` 执行决策和原 handler 调用形成统一后端链；handler 侧权限、路径、symlink、命令、大小和并发检查继续保留。
- 覆写已有文件与精确替换必须携带匹配的 `expectedSha256`；新文件使用原子 create-only 发布，同进程修改按目标串行化并在发布前复核 SHA。`workspace_exec` 仅自动执行不启动 shell/PATH 的内建 `pwd`，其他命令返回结构化拒绝。`run_tool(op=run)` 继续复用真实 pending `tool_job + ackToken`，workflow recovery token 与 `act` 执行后 ACK 未改义。
- P7-D 结构化结果、Trace 与前端呈现已完成：task/legacy loop 共用版本化 ToolResult envelope 与兼容 SSE 投影，`traceId/callId`、真实状态、termination reason、耗时、截断和副作用摘要贯穿；旧 `dispatchTool()` 与审批/Act 扁平字段保持兼容。
- Trace 仅保留容量 200、TTL 15 分钟的进程内脱敏摘要，不持久化原始参数、文件正文、命令输出或凭据。SimpleChat 按 `callId` 幂等显示运行/等待确认/成功/失败/拒绝、耗时、截断、拒绝原因和实际副作用；task 回放不重复，停止订阅不伪装工具已取消。只读 operation 不继承静态最大能力，待审批仅报告实际创建的 pending `tool_job`。
- P7-D 自动化证据：`agent-tool-result.test.mjs` 6/6；前端 SSE parser 与活动状态 7/7；后端 P7-D + 既有审批 + diagnostic redaction 组合定向回归 18/18，0 fail。UI-034 仅完成代码和自动化验证，尚无开发壳/打包态实机证据，保持 `in_progress`。
- P7-E 受控编辑补强已完成：`workspace_write` / `workspace_replace` 支持真实 `dryRun`，仍执行授权、路径、SHA、overwrite、大小和唯一匹配检查，但不创建工作区根目录、目标父目录、临时文件或目标文件；尚不存在的工作区返回 `workspace_unavailable`。成功结果在保留旧字段的基础上追加 `dryRun` 和仅含相对路径及前后 hash/bytes/lineCount 的 `changeSummary`。
- write/replace 已共用同目录原子发布函数；保留同进程目标锁、发布前 SHA 复核与 create-only hard-link。临时文件在 `finally` 中 best-effort 清理，常规冲突回归验证无残留；极端文件系统清理失败不作绝对保证。该边界不宣称跨进程 CAS。成功 dry-run 在只读上下文可执行并由 ToolResult 报告 `none/R0`；真实编辑继续为 `workspace-write/R2`。
- P7-E 定向证据：workspace handler、policy/interceptor 与 ToolResult 三文件合计 32/32，0 fail；覆盖 absent-root 零创建、dry-run 不落盘、授权/敏感路径/symlink/overwrite/stale SHA/唯一匹配、旧字段兼容及真实写入副作用。没有实现 `workspace_patch`，因为尚无 Provider 证据证明现有精确编辑不足。
- P7-F 后台任务 decision gate 已于 2026-07-20 完成：P7-A–D 前置条件满足，集成终端的 Agent 查询/停止缺口成立，但严格合格的真实 `>30s` 非科学 Agent 任务为 0/3，因此 AND gate 不成立并标记 `deferred`；未新增 `workspace_process_start/check/stop`。
- P7-G 上下文效率与 Provider 稳定性已完成：模型侧按 list/find/search/read/write/replace/exec 类型投影，硬截断保持有效 JSON，`modelContext` 暴露原始/投影字符数与压缩/去重状态；原始 handler result、ToolResult envelope 和 SSE 不压缩。read 只在 `projectId + traceId + path` 内提交实际入模范围，Trace entry 携带 `projectId` 并支持精确过滤。
- task 与 legacy Agent loop 已统一使用共享严格 5 次 Provider 请求/12 次工具调用 controller：第 5 次请求为无工具最终整理轮，不再追加第 6 次请求；批次严格 reserve，只把已接受调用及其配对结果写入 history。malformed JSON、数组/null 参数和跨轮重复或碰撞的 Provider/protocol call ID 均结构化拒绝且不执行 handler，协议 history 始终使用请求级唯一 ID并保留原始 `providerCallId`。观察到取消后不再启动剩余 handler 或下一轮 Provider 请求；当前没有公共 `AbortSignal`，因此不声称中断已开始的 handler。
- P7-G 定向证据：`agent-tool-result.test.mjs` + `agent-provider-boundary.test.mjs` 合计 18/18，0 fail；覆盖按类型压缩、有效 JSON、原始 ToolResult 截断语义、read 去重、Trace 项目隔离、严格 5/12 上限、非法参数、跨轮 call ID 碰撞、协议配对与取消边界。
- P7-H 已于 2026-07-21 完成：单一零网络、零凭据的 `npm run harness:phase7` 已接入 CI，实测 manifests 7/7、Phase 6 tests 64/64、Phase 7 核心 tests 68/68、离线临时真实 workspace 产品检查 13/13，全部 0 fail；脱敏证据位于 `acceptance/harness-phase7/product-acceptance.{json,md}`。
- Phase 7 已关闭。P7-A live Provider 双目标继续保持 8/8 人工证据；P7-F 保持 `deferred`；UI-034 保持 `in_progress`，不得用离线后端验收冒充视觉实机证据。下一步观察发布后反馈，再独立决定新阶段，不默认继续扩展 Phase 7。
- 全面计划、出口判据和后续工具接手协议见 [`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md)。
- `DeepSeek_harness/` 与 `api-failover-proxy/` 仅可作为未跟踪参考工程，均不得纳入 Desktop 提交。

**Stage 2 出口已于 2026-07-17 验收完成**（详见 `ui-productization-audit.md` 第 9 节与 `acceptance/stage2/`）：

> 注：`acceptance/stage2/`（`live-provider-check.mjs` 等验收工具与人工清单）已于 2026-07-17（commit `498a661`）移除；下列路径引用与结论仅作历史验收记录留存，验收结论以本记录为准。

1. ✅ 真实 Provider 连通 + streaming + Agent tool calling：DeepSeek（OpenAI-compatible）、xunfei-astron 与 api.xcdw.us `claude-opus-4-8`（Anthropic 原生）三者真机全绿，覆盖两种协议、≥2 Provider（`acceptance/stage2/live-provider-check.mjs` PASS）。
2. ✅ 打包态 UI-031 实机验收通过（`dist/mac-arm64/BioF3.app` arm64/rc.5）：模型 CRUD、8 类角色绑定与能力过滤、显式 fallback、Keychain（无明文回显）、保存重开、聊天选择器同步、窄窗。
3. UI-031 台账已标 `verified`；`run_tool → tool_job → artifact truth`、fallback 默认关闭、Key 不回显等不变量保持。

Stage 3 最新验收证据：

1. ✅ GO/KEGG、GSEA、WGCNA 三条真实标准流程均为 valid artifact。
2. ✅ DeepSeek + Anthropic Harness 评测各 6/6。
3. ✅ `r-enrichment` / `r-wgcna` 已发布并回填真实 SHA-256；Electron App 首次自动下载、校验、解压、挂载成功。
4. ✅ 发布后任务 `job_1257dae3bfda4aa0`（GO/KEGG，37/37）和 `job_02bb39e189d845f9`（WGCNA，28/28）均为 `valid`、0 issues。

Stage 4 rc.6 已完成：原生 ABI 边界、真实 OSS Runtime 首装、DESeq2 报告/ZIP、GO/KEGG bundle 真链、rc.4 数据副本迁移、诊断导出隐私及 arm64/x64 构建结构。arm64 是完整候选链；x64 因没有分析 Runtime 仅为壳层预览。详见 [`stage4-stable-release-checklist.md`](./stage4-stable-release-checklist.md)。

当前没有待执行的发布动作。下一步先观察 rc.6 真实使用反馈，再单独决定签名/公证、x64 Runtime 或后续 Stage。当前无 Developer ID，本 RC 不得描述为 GA。

### 已拆分给独立 Agent 的专项

`[P-02 工具执行、Job 与 Artifact Truth]` 项目工作路径结果沙盒 Phase 0–5b 已完成实施（resolver + R/Python/MCP 收敛 + 测试），记录见 [`project-result-sandbox-plan.md`](./archive/checkpoints/project-result-sandbox-plan.md)。

当前结论：项目作用域的 R/Python/MCP/Agent Workflow 已统一透传 `projectId`，由后端解析到 `workspace_path/results/jobs/<toolJobId>`；无项目的兼容任务仍保留显式全局落点。不得建立第二套结果系统、自动移动历史结果或删除用户外部工作目录。

## 4. 发布与安装状态

主模块：`P-06 桌面集成与交付`。

- 当前代码、Git 标签与 OSS 线上版本：`v0.0.1-rc.6`（发布提交 `907b695`）。
- 默认平台：macOS-only；构建 arm64/x64。
- GitHub：只保存源码和不可变标签，不上传 DMG。
- OSS：保存双架构 DMG、SHA-256 清单和 `latest-mac.yml`。
- 更新方式：检查 OSS → 下载匹配架构 DMG → 大小/SHA-512 校验 → 打开 DMG → 成员手动拖入 Applications。
- 当前没有 Apple Developer ID 签名和公证，不承诺静默覆盖安装。
- `rc.4 → rc.6` 已完成更新选择、公开下载、大小/SHA-512 校验、DMG 只读挂载和包内版本/架构确认。
- 正式 `rc.4` 已恢复运行，R `:3001/api/health`、Python `:3004/api/health`、SPA `:3002` 验证通过。
- 发布端凭据只存在本地 `.biof3-secrets`，权限 `600`，禁止输出或提交。
- Clash Verge 使用规则模式：OpenAI/Codex/GitHub 代理，`aliyuncs.com`/`aliyun.com`/`alicdn.com` 直连。

详细操作见 [`macos-oss-auto-update.md`](./macos-oss-auto-update.md)。

## 5. 已建立的平台能力

### P-02 执行真相

唯一正式执行事实链：

> `run_tool → tool_job → artifact truth`

已有 job 状态、参数、日志、manifest、磁盘校验、valid/degraded/blocked、diagnostics、failureModes 和 lineage。不得建立第二套执行器、job 表或结果真相系统。

### P-03 Harness 与 Agent Workflow

Harness Phase 1–6 已建立：

- `inspect → infer → select → repair → confirm → run → verify → report`
- 参数 repair/readiness、工具选择、确认、恢复和二跳 artifact 绑定
- workflow 状态投影自现有 tool job/artifact truth
- Plugin SDK、built-in/installed/development 三来源与 fixture 门禁
- local/container/remote 共用 canonical execution context，差异留在 adapter

Stage 3 已完成 GO/KEGG、GSEA、WGCNA 与 capability bundle 自动 provision 真链。后续不继续批量增加分析内容；Stage 4 发布收口完成后的 Harness 增量限定为 Phase 7 通用基础工具与运行控制面。技术参考见 [`harness-engine-spec.md`](./harness-engine-spec.md)、[`harness-roadmap.md`](./harness-roadmap.md)、[`harness-phase7-completion-plan.md`](./harness-phase7-completion-plan.md) 和 [`stage3-standard-workflows-design.md`](./stage3-standard-workflows-design.md)。

### P-07 模型层现状

- ModelProfile v1 与 Model Gateway 已成为聊天、Agent、规划、摘要、记忆、报告、解释、vision 和 embedding 的统一调用边界。
- 项目记忆已按 `projectId` 形成硬隔离（主模块 `P-01 项目、会话与上下文`，影响 `W-03 Agent 会话` / `P-07 模型网关`，关注点 `C-04` / `C-05`）：
  - `copilot_conversations`、`memory_vectors`、`user_facts`、`project_chat_summaries` 使用同一项目作用域；向量召回、事实注入、长对话摘要、Agent `query/search` 和记忆管理 API 均只读写当前项目。
  - 无 `projectId` 的普通会话属于独立的全局作用域；历史无作用域事实和旧用户级摘要只保留在全局作用域，不自动注入任何具体项目。
  - 旧向量若有 `conversation_id`，启动迁移会按关联会话安全回填 `project_id`；无法可靠归属的历史数据不猜测、不跨项目复用。
  - 项目提示词的实时资源快照只包含当前项目；删除项目会同步清理该项目的向量、事实、摘要、会话和消息，删除单个会话会同步清理其向量记忆。
  - 隔离门禁：`test/project-memory-isolation.test.mjs` 覆盖 A/B/全局三作用域对撞，`test/project-memory-migration.test.mjs` 覆盖旧向量安全回填。
- 已注册 DeepSeek、OpenAI、OpenAI-compatible、Ollama、LM Studio、vLLM、Anthropic、DashScope embedding/vision；Anthropic 使用原生 Messages/stream/tool 协议适配。
- 多模型角色绑定覆盖 chat、agent、planner、vision、embedding、summary、report、explanation；能力不匹配在调用前阻断。
- fallback 默认关闭，仅在用户显式开启并逐角色配置候选时对可重试错误切换；401、缺 Key、取消和已经输出部分流内容时不切换，切换原因写入事件/日志。
- API Key 已从普通设置与读取 IPC 分离：macOS Keychain，其他平台独立 0600 凭据文件；旧字段自动迁移。一个兼容 Provider 可通过不同 credential reference 使用多套 Key。
- 模型管理中心已实现 Provider/Profile、Endpoint、能力标签、8 类角色、fallback、凭据状态和按 Profile 连通性测试。**UI-031 已于 2026-07-17 打包态实机验收通过并标 `verified`**（模型 CRUD、8 类角色与能力过滤、显式 fallback、Keychain 无明文回显、保存重开、聊天选择器同步、窄窗）。
- 真实 Provider 矩阵已真机验证（`acceptance/stage2/live-provider-check.mjs` PASS）：DeepSeek（OpenAI-compatible）、xunfei-astron 与 api.xcdw.us `claude-opus-4-8`（Anthropic 原生）三者 chat + streaming + Agent tool calling 全绿，覆盖两种协议。验收工具与人工清单沉淀在 `acceptance/stage2/`（不进单元测试套件与 CI；密钥仅经环境变量注入，从不落盘/打印）。**该 `acceptance/stage2/` 验收工具目录已于 2026-07-17（commit `498a661`）移除，此处引用仅作历史验收记录留存，验收结论以本记录为准。**
- 本地 `build:mac-arm64` 已生成约 183 MB 的 `BioF3-0.0.1-rc.5-arm64.dmg`（未上传、未签名、未公证）；包内 R/Python/SPA 健康，模型/凭据页可访问，设置 API 返回 Keychain 配置状态且无 secret 字段。**Stage 2 出口已满足**；下一 RC 版本、发布、签名公证需用户单独授权。
- 打包验收发现 `electron-builder.yml` 曾把双架构写死在 target，导致 `build:mac-arm64` 仍构建 x64 并把工作区 native module 留成 x86_64；现已改为由 `build:mac` / `build:mac-arm64` / `build:mac-x64` 的 CLI 架构参数决定，并重建回 arm64 Electron ABI。
- `api-failover-proxy/` 是未跟踪的嵌套参考仓库，绝不能加入 Desktop 提交；已融合的仅是 MIT 协议转换、usage/stream 聚合与可靠性原语。
- Provider/Gateway 自动化测试证据（仅测试新增，未改生产代码）：Anthropic 原生流 abort 传播（`test/anthropic-provider.test.mjs`）、OpenAI-compatible 非流式 `chat()` 错误分类覆盖 `http_error`/顶层 `error` 保留/`parse_error`/`no_api_key`（`test/provider-streaming.test.mjs`）、Anthropic 非流式用量与延迟记录（`recordAiUsage` 单次调用、prompt/completion tokens、`latencyMs` 有限且 `>= 0`；`test/anthropic-provider.test.mjs`）。当前门禁 `node --test test/*.test.mjs` = 309 tests / 292 pass / 6 fail（5 项 qa-smoke + 终端 Node ABI 下 migration-runner，均为已知非回归），11 skipped。

## 6. UI 已建立结构与边界

- 极简项目启动页与 `/project/:projectId` 工作台。
- 左/中/右三栏、折叠与拖拽。
- 项目级 conversation、Agent 输入和流式消息。
- 参数确认、工具调用、运行/失败/恢复状态。
- 聊天结果卡片与右侧 Artifact 联动。
- 图片、CSV/TSV、HTML、日志、JSON 和下载入口。
- 浏览器、文件、终端与设置/插件容器。

Stage 1 已完成。Stage 2 的模型管理 UI 复用现有设置分类；结果预览继续采用受控 iframe/WebView 分工，不得因为模型层改造重新发明结果系统。

### 2026-07-16 W-01/W-02 桌面壳与左栏检查点

主模块：`W-01 桌面壳层`；影响模块：`W-02 工作台布局`、`P-06 桌面集成与交付`；关注点：`C-02`、`C-05`。

当前已完成：

- macOS 顶栏改为单一几何基准：`hiddenInset` 保留系统原生交通灯，不再设置 `trafficLightPosition`，不再用局部 `translateY` 互相补偿。
- 标题栏高度统一为全局 `--biof3-titlebar-height: 38px`；TitleBar、工作区可用高度和 Desktop Dock 共用该变量。
- 关闭最后一个 BioF3 窗口会退出整个应用；开发启动器会清理 Vite/Electron 子进程树，主进程同时停止 R/Python/Plumber 和集成终端。
- 加入单实例保护；重复打开只聚焦已有窗口，不启动第二套本地后端。
- R Server/Python Server/Plumber 保留 `3001/3004/8787` 为首选端口；如被其他程序占用，自动选择系统空闲端口，并通过 preload 安全桥传给前端，不杀占用者。
- 左侧项目栏删除了与“搜索”工作台按钮重复的顶部筛选输入框，同时删除对应查询状态和废弃 CSS；快捷按钮组自然上移约 44px。
- 左栏信息层级收敛：删除了重复的全局“新对话”，上方只保留搜索和插件等工作流入口；全局“设置”固定到左下角。原左下角主题切换器已移入设置页面的“外观主题”项，不在左栏重复暴露。
- 项目行内的 `+` 改为直接创建并进入默认“新对话”，不再弹出标题确认表单。项目列表标题的 `+` 与无项目启动页统一先打开系统目录选择器；用户选定后，以目录 basename 作为项目名、以所选目录作为 workspace path 立即创建并进入，取消选择则不创建。
- 项目树中的项目名和会话名支持双击后原位重命名；单击仍用于切换/展开，Enter 或失焦保存，Escape 取消，创建流程本身仍保持零确认。
- 设置页已从单列长表单重组为“常规 / AI 模型 / 凭据 / 计算与数据 / 隐私与维护”五类导航，右侧一次只展示当前模块；模型预设改为紧凑卡片，检查更新与诊断导出移入维护区，AI 保存按钮只在模型和凭据分类出现。窄窗口下分类栏自动切换为顶部横向导航。
- 项目和会话删除改为两阶段回收站机制：左侧树的 hover 删除按钮只归档，设置 → 隐私与维护固定展示回收站，可恢复、单项永久删除或清空。项目使用 SQLite 中的 Core `status=active|archived`，会话复用既有 archived 状态；永久删除项目会清理其应用内会话和消息，但明确不删除用户选择的外部工作目录。
- 全局 `BackendStatusProvider` 的 R/Python 状态已接入会话摘要卡 Footer：仅使用 5px 状态点与 `R / Py` 短标签，在同一行保留运行中/总次数；运行中、未启动、未安装通过颜色区分，详细降级原因只在 hover title 中显示，不新增卡片分区。
- 旧 Desktop Dashboard 已彻底删除（组件与 1133 行专属样式一并移除）。`/` 启动路由只在后端就绪后读取项目，有项目直接进入最近工作台；无项目只显示极简创建入口，加载失败显示可重试状态。启动路由也始终挂载统一 TitleBar，不再出现交通灯压住无拖拽页面的情况。

验证证据：

- `npm --prefix frontend run check` 通过。
- `npm test --prefix frontend` 通过：19 files / 146 tests。
- `npm --prefix frontend run build` 通过：568 modules；仅有既有 chunk-size 提示。
- `npm run build:mac` 通过，生成 `rc.5` x64/arm64 DMG；未签名、未公证，且未执行 OSS 上传脚本。
- 打包态 `dist/mac-arm64/BioF3.app` 在本地 `:3002` 启动，项目工作台、结果与 Artifact 读取正常。
- 真实占用 `3001/3004` 后启动 BioF3，R/Python 自动切换至系统空闲端口，渲染页和 Python Worker 正常就绪；验证后已恢复默认端口启动。
- 开发实例关闭时，日志确认 Electron、R Server 与 Python Server 收到退出/停止信号。
- 临时项目与会话均完成 `创建 → 归档 → 回收站可见 → 恢复 → 再归档 → 永久删除` 实际 API 验证；另验证永久删除项目后其活动会话返回 404，测试数据已清理。

Stage 1 出口已满足。Stage 2 代码主干完成，下一步只做真实 Provider 与打包态验收；不恢复局部偏移补丁、重复搜索框、旧 Desktop Dashboard 或第二套模型调用链。

## 7. 验证门禁

按风险选择并记录：

```bash
npm --prefix frontend run check
npm test --prefix frontend
npm --prefix frontend run build
npm run check
npm test
npm run harness:phase6
npm run harness:agent-evaluate
```

UI 任务必须补实机截图/交互证据；Electron 壳、IPC、runtime、更新和打包资源改动必须补打包态验证。涉及 Core 时直接修改仓库内 `core/` 并随 Desktop 提交；没有 submodule 或 `.vendor-lock`。

## 8. 禁止误读

- 不把 `docs/archive/` 中的历史 P0、旧分支、旧 CI 或旧阶段编号当成当前任务。
- 不把旧 Windows/Linux 发布计划恢复为当前门禁；除非用户重新明确要求。
- 不在 Stage 2 批量增加分析流程。
- 不用前端回退代替后端 artifact truth。
- 不覆盖用户未提交改动，不随手 reset 子模块或工作树。

## 9. 当前关键文件

UI Stage 1：

- `frontend/src/App.tsx`
- `frontend/src/components/desktop/`
- `frontend/src/components/workspace-panels/`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/home.tsx`
- `frontend/src/themes/`
- `frontend/src/styles/global.css`

阶段与规范：

- `docs/v1-productization-roadmap.md`
- `docs/ui-productization-audit.md`
- `docs/development-module-map.md`
- `docs/codex-style-workbench-direction.md`
- `.claude/ui-refactor-plan.md`
