# Project Workspace Handoff

最后更新：2026-07-15

## 长期开发模块口径

开发模块、职责边界和标准表述统一以 [`docs/development-module-map.md`](./development-module-map.md) 为准。新增需求、缺陷、交接和提交应标明主模块；主题、布局、安全、状态同步、测试和性能作为跨模块关注点附加说明，不再使用无法定位责任边界的“右侧栏问题”“后端问题”等说法。

## 2026-07-15 最新交接点：RC 安装版修复已完成本地验证

主模块：`P-06 桌面集成与交付`；关注点：`C-03 安全与审计`、`C-05 测试与质量门禁`。

- 远端 `origin/main` 当前到 `c647dba`；本地 `main` 另有 3 个尚未进入远端的 Release workflow 提交。工作流最终口径已恢复为 macOS 与 Windows 都成功后才能发布，不接受 Windows 失败时静默发布 macOS-only RC。
- 已修复发布版启动链：打包态 Core 路径、macOS Electron Helper Node 边界、打包后端 `better-sqlite3` ABI、migration 工作目录均已进入现有发布修复；本轮又取消不稳定的手工 `manualChunks`，避免生产包 `Cannot access ... before initialization` 白屏。
- 已重新修复 Core `chat-file-references` 的反斜杠/控制字符校验；Core `46cc143` 已推送至 `origin/main`，Desktop submodule 指针与 `.vendor-lock` 已同步到该提交。
- Windows `icon.ico` 已由现有 1024px 主图重新生成，包含 16/24/32/48/64/128/256 七种尺寸；临时 TIFF、PNG 和 `to-ico` 试验依赖均已清理。
- 2026-07-15 本地门禁：`npm run check` 通过；根项目 185 项中 178 pass、7 个显式 live skip、0 fail；前端 19 files / 147 tests 全通过；TypeScript 与生产构建通过，构建不再报告 circular chunk，仅保留主 bundle 体积警告。
- 真实 arm64 打包冒烟通过：`dist/mac-arm64/BioF3.app` 页面加载成功，migration version 0，R `:3001` 与 Python `:3004` 健康接口均返回 `ok`，无模块缺失、ABI、递归启动或 renderer ReferenceError。
- 当前唯一无法在仓库内解决的阻塞是 GitHub Actions 账户付款失败/额度上限；最新 jobs 在运行前即被 GitHub 拒绝。额度恢复后仍需 Windows NSIS、macOS x64 和三平台安装冒烟。
- 现有 `v0.0.1-rc.1` 标签与 GitHub Release 草稿经历过多次移动和失败构建，不作为可信发布基线；完成收口后建议创建不可变的 `v0.0.1-rc.2`，不要继续覆盖 rc.1。

下一步固定顺序：Desktop 发布修复提交 → 恢复 Actions 额度 → 三平台 CI/NSIS → 安装级冒烟与校验和 → 新建 `rc.2` prerelease → 再同步发布状态。

## RC 发布准备（历史口径，以上述 2026-07-15 检查点为准）

首个候选版本原定为 `v0.0.1-rc.1`。该标签已经被提前创建并多次移动，但门禁未完成；当前禁止公开发布或启用自动更新，后续以新的 `v0.0.1-rc.2` 作为可信候选基线。

## 2026-07-14 当前交接点

### 最终报告改为后置交付物

- `report.html` 不再抢占核心结果默认预览；图表、表格和数据文件继续作为后续分析的交互入口。
- 结果区新增“最终 HTML 报告”状态卡，用户点击后才基于当前 job 实时生成 `final-report.html`。
- 生成器会把当前输出目录中的图片资源内嵌为 data URI，下载后的 HTML 不依赖临时资源链接。
- 生成完成后支持右侧内置 WebView、系统默认浏览器和直接下载 HTML 三种出口。
- 复用现有 tool job 权限、结果目录与文件路由；平台模式通过既有 Dell internal-token 通道代理，不新增结果数据库。

- 当前主线仍是 `project workspace` 的结果区稳定性修复，重点不是新增功能，而是把“结果预览在拖拽时跳版/抖动”的根因收口。
- 已确认问题根因主要有两部分：
  1. 结果右栏历史脏值会被 localStorage 继续带入，拖拽热区和拖动反馈也不够跟手。
  2. 结果报告壳 `resultReportShell` 仍有窄屏切换规则，会在面板变窄时从左右布局切成单列，造成明显跳变。
- 已完成修复：
  - `frontend/src/hooks/useResizableColumns.ts` 为 `resultRightWidth` 加入归一化，安全下限为 360px；拖动通过 CSS 变量逐帧更新，松手后才持久化。
  - 拖拽实际热区扩展为 9px，拖动时报告 iframe 保持可见，只禁用指针事件，避免预览消失后再出现。
  - `frontend/src/pages/project-workspace.module.css` 移除了结果报告的窄宽度断点切版逻辑，保留同一套报告结构，只做缩放，不再在拖拽时切换成另一种排版。
- 已做验证：
  - `npm --prefix frontend run check`
  - `npm --prefix frontend run build`
  - 本机 Chrome 实测 `localhost:3000/project/p_mrcpi1zo_515l`，结果壳在宽/窄视口下保持同构布局，不再自动切成上下叠。
- 当前结论：
  - 这不是 iframe 性能不足，也不建议把结果预览改成内置浏览器 `webview` 作为默认方案。
  - `BrowserPanel` 适合网页浏览，不适合替代结果报告预览；结果预览继续保留 iframe 路线更轻，也更符合当前产品边界。
- 后续如果还看到“跳”，优先检查：
  1. 是否有新的 CSS 断点重新引入了布局切换。
  2. localStorage 里是否存在旧的 `biof3-pw-cols` 脏值。
  3. 是否是 `iframe` 内部报告自身的响应式规则，而不是外层 workspace 面板。

这份文档用于在切换工作区后恢复当前开发状态。工作台 UI 与 Harness Phase 1–6 已收口，当前进入标准流程覆盖阶段；新增分析能力必须通过既有 Plugin SDK、tool job、artifact truth、Agent workflow runtime 和 fixture 门禁接入，不再扩建第二套平台基础设施。

## 2026-07-13 当前检查点与今日计划

### Phase 6 已完成、提交并推送：Plugin SDK 与 Agent Workflow Runtime

- Phase 6 是**平台工程开发阶段**，不是批量编写生物分析插件、堆分析脚本或扩充内容库。
- 当前目标是把“以后接入一个新分析流程”的成本压缩到：提供 manifest、执行脚本和小型 fixture，其余发现、校验、执行、产物登记、Agent 调用与恢复由平台完成。
- 必须复用现有唯一执行真相：`run_tool → tool_job → artifact truth`；禁止新增第二套 executor、workflow job 表、plan 状态库或结果系统。
- 现有脚手架、manifest normalized view、artifact truth、canonical execution context、workflow status/recovery 和 Agent plan/bind 均应继续复用，先审计缺口再修改，禁止从头重写。

Phase 6 按以下顺序实施：

1. **Plugin SDK 收口**：统一脚手架、manifest/schema/failureModes 校验、插件发现与注册诊断；校验范围覆盖 built-in、已安装插件和开发目录，而不只检查少量内置样板。
2. **Agent Workflow Runtime**：让薄工作流计划根据现有 tool job 自动投影步骤状态、识别 ready/blocked/recoverable/complete、恢复断点并给出下一步；不自动盲跑全部步骤。
3. **Agent 控制闭环**：Agent 单步规划、运行、验证 valid artifact、绑定 lineage、判断失败、提出参数修复并在既有确认边界内重试。
4. **插件质量门禁**：fixture 驱动的契约测试覆盖 manifest、输入诊断、ready/recoverable/blocked、真实或隔离执行、artifact truth 与 lineage。
5. **跨平台一致性**：继续使用 canonical execution context 和 local/container/remote adapter；平台差异只允许存在于 adapter 层。

Phase 6 验收标准：

- 新插件无需修改 Agent 主 prompt、核心执行器或结果 UI 即可被发现和调用。
- 一个不完整插件会在安装/CI 阶段得到结构化诊断，而不是运行后才随机失败。
- 多步骤计划可从原 tool job 状态恢复，且只允许 truth=`valid` 的产物激活下游。
- 至少使用现有 Bulk RNA/单细胞工具各做一个样板链路验证；样板用于验证平台，不代表开始批量补内容。
- `npm test`、`npm run harness:evaluate`、Agent 专项评测、三平台 CI 和 vendor lock 检查保持通过。

明确暂缓：空间转录组、蛋白组、代谢组等批量流程内容扩充。只有 Phase 6 基座验收通过后，才进入后续“标准流程覆盖”阶段。

本次 Phase 6 已实现统一 Plugin SDK、三来源发现与结构化诊断、安装前校验、带 fixture 的 scaffold、多步骤 tool job 状态投影、`run_tool status/next`、ready step 提交门禁、valid lineage 幂等绑定，以及 Bulk RNA/单细胞 fixture 门禁。`npm test`、`npm run check`、`npm run harness:evaluate`、`npm run harness:agent-evaluate`、`npm run harness:phase6` 和 adapter 回归均通过。Core `dcd2043` 已推送至 `origin/fix/tsc-strict-pass`；Desktop `2d000d5` 已同步 `.vendor-lock` 与 submodule 指针并推送至 `origin/main`。

### Agent-led analysis foundation v1 已完成（最新检查点）

- 产品方向已明确：Agent 主导数据分析，调用规范化流程；流程基础覆盖完成后，再由 Agent 对结果做多轮调整。
- `run_tool` 现在是 Agent 的统一分析入口，支持 `list / plan / bind_artifact / run`。
- 新增三个薄流程模板：`bulk-rna-core`、`single-cell-core`、`deg-result-refinement`。模板 `autoExecute: false`，Agent 必须逐步决策。
- 原先 MCP 中 10 个单细胞步骤的“执行通道待实现”已删除；全部映射真实 R task type，并具有至少可执行的 input schema。
- step submit 会创建/复用 tool job，并在 task params 中保存 `__harness.toolJobId`；queue 的 queued/running/completed/failed 会回写同一个 job。
- step 完成后，本地产物进入共享 artifact truth；摘要动态跟踪、结果打开、retry 和 workflow state 不需要第二套适配。
- 修复 `cell-cycle / doublet` 生成器存在但未进入 task-manager switch 和路由白名单的问题。
- 所有单细胞步骤都属于重分析，首次由 Agent 执行仍走原有显式确认卡。
- `bind_artifact` 会从当前用户真实 tool job 读取 artifact 和 truth；只有 `valid` 才能写入下游输入并生成 lineage，模型不能自己声称结果已验证。
- 隔离 platform enqueue 验证通过：Agent doublet call 同时产生 pending task 和 queued tool job，两者 ID 正确关联。
- 模拟 worker completion 验证通过：task 完成后 tool job completed，artifact truth valid，2 个产物可追踪。
- 真实二跳验证通过：`tj_mrhgg5cf_ib7o` 的 valid `classified_table.csv` → Agent lineage → 新 `volcano-plot` job；下游 completed、truth valid、5 artifacts，验证任务已清理。
- 全量测试 120 项：113 pass、7 个显式 live skip；Phase 4 评测继续保持 51/51。
- Core Agent-led foundation 检查点为 `2f57ce4 feat: establish agent-led analysis workflows`，已推送到 `origin/fix/tsc-strict-pass`。
- 下一步进入 Phase 6 平台工程：Plugin SDK、Agent Workflow Runtime、Agent 单步闭环和 fixture 质量门禁；暂不批量补写分析流程。

### Harness Phase 4 已完成（最新检查点）

- Phase 1–4 已完成，下一主阶段是 Phase 5 多步骤工作流模板；结果层 UI 继续冻结。
- 新增 `scripts/harness-task-packs.mjs`，version 1 覆盖 12 类意图：差异表达、火山图、PCA、相关性、富集、聚类、注释、整合、拟时序、通讯、细胞周期、Doublet。
- task pack 是薄策略层，只保存意图规则和候选 tool id；不保存执行脚本、参数真相或 artifact schema。
- `rankHarnessToolsForRequest()` 现在组合 task pack、真实 plugin manifest 与 Harness 文件索引；未知请求不会按文件碰巧猜一个工具。
- `POST /api/harness/workflow/plan` 不再强制调用方提供 manifest：会刷新已安装/内置插件并确定性选型；没有实际可用插件时返回 `no_matching_tool`。
- workflow plan 会返回 `taskPack`，HTTP 返回 `selection.source / taskPack / rankedTools`，方便 Agent/UI 解释为什么选中该工具。
- 新增 fixture 驱动的 `npm run harness:evaluate`，覆盖 12 类选型、未知请求、repair、diagnostics、blocked/recoverable 与二跳 artifact。
- 修复规范化 manifest 的 structured runtime 被误判为 shell：现在优先采用 manifest language，真实 R 工具会检查 R runtime。
- 全量测试 115 项：108 pass、7 个显式 live skip；Phase 4 评测 51/51 pass。
- 真实 HTTP 验证：历史结果 `tj_mrhgg5cf_ib7o/output` 在不提供 manifest 时自动选中 `volcano-plot`，绑定 `classified_table.csv`，补齐列映射，将 `top_n: 999` 裁剪为 25，并进入 confirmation。
- Core Phase 4 检查点为 `3fbfe3b feat: expose deterministic harness tool selection`，已推送到 `origin/fix/tsc-strict-pass`。
- 下一步 Phase 5 必须复用 task packs、canonical execution context、tool job 和 artifact truth；不得创建第二套 workflow executor。

### Harness Phase 3 已完成（最新检查点）

- 当前主线明确为 Harness 工程，结果层 UI 暂时冻结；Phase 1、Phase 2、Phase 3 已完成，下一步进入 Phase 4 弱模型可用性。
- 新增唯一共享实现 `vendor/biof3-core/shared-backend/execution-context.js`，`executionContextVersion: 1`。
- HTTP 工具执行、MCP/Agent `run_tool`、Harness repair/plan、R task queue、Python task queue 均使用同一个 canonical execution context 工厂。
- adapter 统一为 `local / container / remote`；platform/api enqueue 记录 remote，Docker worker 记录 container，本机运行记录 local。
- 保留 `mode / workDir / canonicalWorkDir / runtimeReady` 等旧字段，避免破坏已有结果页、Agent 与插件；新增 `adapter / executionWorkDir / jobId / toolId / platform`。
- R/Python task submit 返回 execution，worker 日志与完成结果也记录 execution；result 的 artifacts/outputs/files 会补 host `path` 和 `canonicalPath`。
- `scripts/harness-file-index.mjs` 不再维护另一种上下文形状，Harness plan 与真实执行现在共享 version 1 契约。
- 已通过桌面全量测试（96 项：89 pass、7 个显式 live skip）以及 execution-context 的 local/container/remote 定向测试。
- Core Phase 3 检查点为 `c9208d5 feat: standardize canonical execution contexts`，已推送到 `origin/fix/tsc-strict-pass`。
- 下一步不要继续改 execution context 表面结构；进入 Phase 4，扩大无 LLM tool selection、弱模型评测集和常见任务模板。

### Harness Phase 2–5 新检查点（2026-07-13）

- `repairHarnessParams()` 现在返回 `proposalVersion: 1` 与 audit 信息，明确区分默认补全、Harness 推断和对用户显式值的调整。
- 用户显式提供的 `columnMappings` 不再被自动列名推断覆盖；数值裁剪会标记 `confirmationRequired`，确认卡使用“建议调整”文案。
- diagnostics 保留兼容状态 `ready / needs_review / blocked`，同时提供稳定口径 `readiness: ready / recoverable / blocked`。
- 缺少必要列、整张表数值完全不可解析会被 diagnostic gate 阻塞；部分脏数据、样本分组不匹配、阈值无结果继续作为可恢复确认项。
- repair API 已与 HTTP/MCP 执行器共享 canonical execution context，并能识别桌面注入的 `BIOF3_R_HOME / BIOF3_PY_HOME`。
- 新增 `POST /api/harness/workflow/plan` 与纯函数 `createHarnessWorkflowPlan()`，固定 `inspect → infer → select → repair → confirm → run → verify → report` 八阶段协议。
- Core workflow API 检查点为 `f491b61 feat: expose canonical harness workflow plans`，已推送到 `origin/fix/tsc-strict-pass`；Desktop vendor lock 已同步。
- 真实历史结果 `tj_mrhgg5cf_ib7o/output/classified_table.csv` 已通过 workflow API 验证：active artifact 选中正确、R runtime ready、计划 runnable，用户参数调整进入 confirm。
- 这只是 Phase 5 的最小“计划骨架”，尚未替代现有 `run_tool`。下一步应把真实 job 状态、artifact truth 和失败恢复事件接到 `run / verify / report` 阶段，不能另写第二套执行器。

### Harness workflow 真实状态检查点（2026-07-13）

- 新增纯状态投影器 `harness-workflow-state.js`，直接读取现有 `tool_jobs` 的 status、ack、error、result 和 artifact truth，不新增工作流数据库或第二套执行器。
- 新增受权只读接口 `GET /api/harness/workflow/status/:jobId`；接口先复用 tools status 的磁盘/manifest 自愈，再投影八阶段状态。
- 阶段状态可区分 `pending / in_progress / completed / needs_review / blocked / failed / cancelled`。
- completed job 在缺少 artifact truth 时只完成 run，verify 保持 pending、report 保持 blocked，防止把“进程退出成功”误判成“可信报告完成”。
- 执行失败与产物验证失败被分开：前者从 run 重试，后者从 verify 修复；API 返回 `resumeFrom` 和结构化 `nextActions`。
- queued、running、等待确认、拒绝、执行失败、artifact blocked、artifact degraded、artifact valid、cancelled 均有自动化回归。
- `manifest.json` 已加入内部文件集合，不再作为用户 artifact 或 Honeycomb 结果计数，避免 text/json 类型误判造成假 degraded。
- 真实验证：`tj_mrhgg5cf_ib7o` 与 `tj_mriio04e_ey7h` 均经共享 truth 自愈为 valid，真实 artifactCount=5，run/verify/report 全部 completed。
- Core 状态机检查点为 `4af1be2 feat: project tool jobs into recoverable workflows`，已推送到 `origin/fix/tsc-strict-pass`；Desktop vendor lock 已同步。
- 下一步：把 workflow status 接入 Agent/结果区的轻量动态跟踪，而不是新建独立大页面；再为真实 retry/repair 操作建立显式命令边界。

### Workflow UI 动态跟踪检查点（2026-07-13）

- 新增 `useHarnessWorkflowStatus()`：仅在摘要卡打开或结果工具可见时查询；live workflow 每 1.5 秒更新，terminal workflow 自动停止，错误时低频恢复。
- 摘要卡新增极简八段进度轨道，显示当前阶段和第一条恢复建议；没有增加卡片高度，也没有创建独立工作流主页。
- 为保持卡片紧凑，移除重复的 R/Python runtime 两行，只保留运行中数量和总运行次数。
- 右侧结果工具顶部新增 30px 轻量状态条：valid 结果显示 artifact 数量和 truth，recoverable/blocked 结果显示 `resumeFrom` 与下一动作。
- 恢复动作不会直接执行。按钮只向现有 Agent 会话发送带“先解释、得到确认后再执行”的请求，继续复用参数确认与审计链路。
- 本地真实结果页 `tj_mriio04e_ey7h` 已视觉核对：摘要卡 8 段均完成，结果条显示 `5 项产物 / truth valid`，中间 Agent 主舞台和 Honeycomb 导航未被遮盖。
- 浏览器 console 无新增运行错误；只保留已记录的 React Router v7 future flag 警告。
- 下一步：为 recoverable/blocked 的真实任务补 UI 回归 fixture，并把 Agent 确认后的 retry/repair 结果回写到同一个 workflow 状态投影。

### Recoverable workflow 完整闭环（2026-07-13）

- 新增 `POST /api/harness/workflow/action/:jobId` 两步动作协议：首次请求返回 5 分钟短期 confirmation token，第二次必须携带相同 job/action/user 范围的 token 与 `confirm=true`。
- token 单次消费、范围绑定、过期安全失败；取消只消费 token，不改变原任务状态。待确认 token 仅存在内存，服务重启即失效，避免恢复后误执行。
- 可直接执行的动作严格限制为 `reconcile_artifacts` 和 `retry_run`；`repair_artifacts / review_artifacts` 继续交给 Agent 解释与确认，禁止伪自动修复数据。
- `retry_run` 只允许 failed/cancelled plugin job，复用原 tool job ID、原参数和现有 MCP registry；running/completed job 会被拒绝。
- `reconcile_artifacts` 复用共享磁盘/manifest truth 自愈，不重新运行分析。
- 确认动作写入有界 `__harnessRecovery` 审计历史；普通 tools status 的 params 会隐藏内部字段，workflow status 单独返回 `recoveryHistory`。
- SQLite 与 PostgreSQL DB adapter 均新增 `updateToolJobParams()`；修复 workflow 路由错误假设高层 DB 具有 `prepare()`、导致自愈持久化静默失败的问题。
- 结果工具新增内联确认条；确认后刷新原 workflow。展示状态优先采用 workflow truth，避免 jobs 列表旧状态让成功重试仍显示失败。
- 真实 artifact reconcile：`tj_mriio04e_ey7h` 确认后保持 completed/valid/5 artifacts，审计成功写入。
- 真实 retry：历史失败 job `tj_mrhgeniu_plms` 从 `spawn ... Rscript ENOENT` 经确认后复用同一 ID 重跑，最终 run/verify/report completed、truth valid、5 artifacts。
- Core recovery 检查点为 `8cb2620 feat: close recoverable workflow actions`，已推送到 `origin/fix/tsc-strict-pass`；Desktop vendor lock 已同步。
- 下一步不再补恢复基础设施；进入多步骤 workflow template 与 Agent 状态联动，或观察真实用户任务后再扩 recovery action。

### 当前产品边界（不要再误解）

- 中间栏始终属于 Agent 工作区，承载会话、思考过程、工具确认和连续交互；结果界面不能替换或遮盖中间 Agent 主舞台。
- HTML / 图片 / 表格 / PDF 主预览与 Honeycomb artifact navigator 都属于右侧“结果”工具工作区。
- 结果工具使用独立宽度，桌面窗口下可扩宽并支持鼠标拖拽；文件、浏览器、侧边聊天继续使用普通右栏宽度，两者分别持久化。
- 紧凑窗口下右侧工具采用临时覆盖模式，关闭工具后回到 Agent；结果工具内部根据自身宽度在左右布局和上下布局之间切换。
- UI 细节优化到此暂时冻结。除阻断使用、数据错误或明显回归外，不再继续调整三栏骨架、配色和间距。

### 本轮已固定的 UI 收口

- 结果模式右栏改为自适应宽工具区，同时为中间 Agent 保留最小可用宽度。
- 新增独立 `resultRightWidth`，可拖拽、持久化，不影响普通 `rightWidth`。
- 结果拖拽通过 CSS 实时宽度更新，React 只在 pointer-up 后提交；移动事件按 animation frame 合并。
- 拖拽期间暂停昂贵的 HTML iframe 渲染，并强制保持 `ew-resize` 鼠标图标。
- 结果工具使用 container query：面板较窄时，Honeycomb 导航转为下方布局。
- manifest 声明但磁盘不存在的 HTML 报告会被排除，自动回退到首个真实可用的图表或表格。
- 当前旧 DESeq2 job `tj_mrhmz764_19ax` 的 `report.html` 实际返回 404；前端已从错误的 5 组 / 23 项回退为真实可用的 4 组 / 22 项。这暴露出下一阶段必须处理的 manifest / 磁盘产物一致性问题。

### 今日多阶段计划

#### Stage 1 — UI 稳定检查点

- 状态：已完成验证、commit 与 push；UI 稳定检查点已固定在主线。
- 已更新交接文档、路线图和验证记录。
- 已运行前端类型检查、结果导航测试、列宽测试、Electron 关键脚本语法检查、SPA 构建和 diff 检查。
- 提交并推送当前 UI 收口；不提交 `.cursor/`。
- 出口条件：工作树只剩明确忽略项，下一位 agent 可从固定 commit 恢复。

2026-07-13 Stage 1 已通过：

```bash
npm --prefix frontend run check
npm --prefix frontend test -- useResizableColumns.test.ts result-manifest.test.ts
node --check src/main.js
node --check src/preload.js
node --check scripts/dev-electron.js
npm run build:spa
git diff --check
```

结果：2 个测试文件、19 项测试全部通过；SPA 构建成功。当前仅保留两个非阻断构建警告：`authClient` 动态/静态混合导入，以及主 bundle 超过 500 kB。二者进入 Stage 4 工程稳定性审计，不阻断 UI checkpoint。

#### Stage 2 — 结果产物可信化

- 状态：核心闭环、验证、commit 与 push 已完成。
- 已在执行结束与结果读取边界统一校验 manifest / artifacts / files / outputs 与磁盘真实文件。
- 不存在、空文件、不可读、类型不符的 artifact 已进入统一 diagnostics / failureModes。
- 缺失 HTML 报告不再成为默认预览；前端 fallback 只作为兼容保护，后端会记录真实问题。
- 出口条件：状态 API、DB `result_json`、manifest 和磁盘产物四者一致，具有回归测试。

2026-07-13 Stage 2 实现记录：

- 新增 `r-server/helpers/artifact-truth.js`，定义 `artifactTruthVersion: 1`。
- 统一状态：`valid / degraded / blocked`。
- 统一诊断：
  - `required_artifact_missing`
  - `required_artifact_empty`
  - `artifact_type_mismatch`
  - `artifact_missing`
  - `artifact_empty`
- HTTP/前端执行器与 MCP/Agent 执行器在写 DB 前调用同一校验器。
- required artifact 问题会将任务置为 failed；可选 artifact 问题保留 completed 并标记 degraded。
- `/api/tools/status/:id` 与 SSE 状态流会校验历史 `result_json`，从磁盘 manifest 恢复真实产物并自愈 DB。
- MCP 执行器已补齐与 HTTP 执行器相同的报告模板复制约定，并停止把 `output/` 目录误当 artifact。
- plugin-loader 会给所有 normalized manifest 注入全局 artifact failureModes；新工具 scaffold 默认携带核心 artifact failureModes。
- Core 子仓检查点：`96b6781 feat: validate tool result artifacts`，已推送到 `origin/fix/tsc-strict-pass`。
- 真实 MCP 火山图验证：6 个声明产物、6 个真实文件、0 issues，`report.html` 由已有模板机制生成。
- 历史 Honeycomb demo `tj_mrhgg5cf_ib7o` 已验证 API / DB / manifest / disk 均为 6 个真实产物、4 个 sections、truth=`valid`。
- 开发中曾发现历史 `resultDir` 指向空 job 根而真实文件位于 `output/`；已改为按 manifest 和真实文件数选择结果目录，并增加回归，受影响 demo 已从磁盘完整恢复。

Stage 2 验证：

```bash
node --test test/artifact-truth.test.mjs test/agent-run-tool.test.mjs test/mcp-tool-registry.test.mjs test/harness-manifest.test.mjs test/harness-tool-template.test.mjs test/harness-file-index.test.mjs
RUN_AGENT_LIVE=1 node --test test/agent-run-tool.test.mjs
npm run harness:check
npm --prefix frontend run check
npm --prefix frontend test -- useResizableColumns.test.ts result-manifest.test.ts
npm run build:spa
```

结果：Node 定向回归 50 项中 47 项通过、3 项默认 live skip；独立 live 火山图 8/8 通过；前端 19/19 通过；Harness manifest 检查和 SPA 构建通过。

#### Stage 3 — Harness Phase 2 后半段

- 状态：二跳核心闭环、验证、commit 与 push 已完成。
- 当前 active artifact 可作为下一工具的优先候选输入。
- 参数修复已返回可直接执行的绝对路径，并保留列名映射、输入角色判断和用户手动参数保护。
- artifact scope blocked 时前端自动回退 project scope；不兼容 active artifact 不会被强制绑定。
- 弱模型确定性回归已覆盖结果再分析与不兼容输入恢复。
- 出口条件：至少完成一条 `上游结果 → 选择 artifact → 参数修复 → 下游工具 → 结果校验` 的真实链路。

2026-07-13 Stage 3 实现记录：

- `suggestInputBindings()` 支持 `preferredPaths`，只对本身类型兼容且可评分的 active artifact 增加优先级。
- repair API 接收 `activeArtifactName`，artifact scope 修复使用绝对文件路径。
- `SimpleChat` 参数确认链路优先尝试当前 active artifact/job；若 diagnostics=`blocked`，自动回退 project scope。
- 当前 artifact 与普通候选同时存在时，当前 artifact 获得 `active_artifact_preferred` 原因；不兼容 HTML 不会覆盖有效 CSV。
- 真实二跳 API 验证：`tj_mrhgg5cf_ib7o/classified_table.csv` 被选为 volcano `deg_table`，得分 195，高于同目录 `deg_table.csv` 的 95，readiness=`ready`。
- 真实下游执行：生成 `tj_mriio04e_ey7h`，artifact truth=`valid`，6 个真实产物、0 issues。
- Core repair API 检查点：`2ee2081 feat: prioritize active artifacts in repair`，已推送远程分支。

Stage 3 验证：Node 定向回归 48 项中 45 项通过、3 项默认 live skip；前端 19/19 通过；Harness manifest 和 SPA 构建通过；真实二跳执行成功。

#### Stage 4 — 工程与跨平台稳定性

- 状态：核心稳定性工作、完整验证、commit 与 push 已完成。
- `better-sqlite3` Electron ABI 不一致已解决：migration 使用与 r-server 相同的 Node 子进程边界，Electron 主进程不再加载系统 Node ABI 的原生模块。
- macOS 启动已验证 R/Python runtime、插件加载、migration、MCP 结果文件服务与 canonical path。
- macOS / Windows / Linux 三平台 CI 最小矩阵已落地到 `.github/workflows/ci.yml`。
- vendor lock 已更新到当前已推送 Core；生产构建大 chunk 等非阻断警告已归档。

#### Stage 5 — 今日交付

- 状态：已完成。
- 已运行完整回归并记录通过项、已知风险和未完成项。
- 已同步本文件、`docs/next-steps-roadmap.md` 与 `docs/harness-roadmap.md`。
- 今日成果已形成可恢复的 Core 与 Desktop 检查点，下一位 agent 无需依赖聊天记忆即可继续。

2026-07-13 Stage 4 实现记录：

- `src/main.js` 不再直接 require `migration-runner`；通过选定 `NODE_BIN` 子进程执行 migration，并在打包路径设置 `ELECTRON_RUN_AS_NODE=1`。
- `migration-runner.js` 增加 CLI 入口；回归测试在临时 DB 上真实应用 migration 并验证 schema version。
- 桌面重启日志已从 ABI 报错变为 `[desktop] migrations applied, version = 0`。
- Core MCP 文件交付修复已提交为 `5733244 fix: serve managed MCP result artifacts` 并推送到 `origin/fix/tsc-strict-pass`。
- `.vendor-lock` 已更新为 Core `5733244`，`scripts/sync-vendor.sh check` 重新通过。
- 新增三平台 CI：submodule、Node 20、Harness、migration、artifact truth、platform compat、前端检查和 SPA 构建。
- MCP 结果文件服务会从 truth-validated DB `resultDir` 解析 `mcp-tool-jobs`，并限制在受管目录；外部路径被拒绝。
- 真实二跳 job `tj_mriio04e_ey7h` 的 `report.html` 与 `volcano.png` 均通过 `/api/tools/file` 返回 200。
- `RIGHT_PANEL_ITEMS` 改为模块内部常量，避免 Vite Fast Refresh 因非组件导出而主动失效。

Stage 4 后续非阻断清单：

- React Router v7 future flag 警告。
- r-server 上游依赖的两个 circular dependency warning。
- `authClient` 动态/静态混合导入与 SPA 主 bundle > 500 kB。
- CI 已配置，但仍需观察首次 GitHub Actions 三平台真实运行结果。

Stage 4 / 5 最终验证：

```bash
npm run check
npm --prefix frontend run check
npm --prefix frontend test -- useResizableColumns.test.ts result-manifest.test.ts
node --test test/migration-runner.test.mjs test/platform-compat.test.mjs test/artifact-truth.test.mjs test/harness-file-index.test.mjs test/harness-manifest.test.mjs test/mcp-tool-registry.test.mjs
npm run build:spa
git diff --check
git -C vendor/biof3-core diff --check
```

结果：vendor / Harness 检查通过；前端 19/19 通过；Node 定向回归 47 项中 45 项通过、2 项 live skip；SPA 构建通过。桌面开发启动已确认 migration ABI 警告消失，真实 MCP `report.html` 与 `volcano.png` 文件路由均返回 200。

## 最新同步状态

- **结果层 UI 已进入冻结前检查点，接下来转向结果可信化与 Harness Phase 2 后半段**：
  - 重点区域仍是 `/project/:projectId?mode=scheduled&job=...` 的结果链路，但下一步优先处理数据与执行契约，不再做视觉大改。
  - 目标是保持“主预览 + Honeycomb artifact navigator”，让 HTML 报告、图表、表格、文本、PDF 等 artifact 都不丢失。
  - 这不是要重做工作台，也不是要新增一套结果系统；应优先保护已有报告模板、manifest、artifact schema 和历史结果兼容。
  - 后续继续动结果页时，必须先查现有实现、旧模板、历史 demo 产物和 git diff，再做最小修复。不要上来重写报告或导航结构。
- 当前主分支已经吸收远程跨平台 runtime 分支的核心改动，不再是“待合并”状态。
- 这次同步的重点不是 UI，而是桌面运行时、插件安装、路径映射、Harness 索引与修复链路。
- 现在的工作重点变成“合并后稳定化”：
  - 确认跨平台 runtime 选择逻辑稳定。
  - 确认 Harness 的文件索引、参数修复、诊断链路稳定。
  - 确认桌面壳、路由、构建和 vendor 同步都没有漂移。
- Harness 的定位要继续往通用交互式执行底座上抬，不要被局限成单纯的生信流程器。

## 当前结果页状态

- 当前结果层 UI 已完成 Honeycomb 结果导航的本轮收口：
  - 右侧结果工具工作区内部的主预览区负责展示当前 active artifact。
  - 右侧 Honeycomb 导航负责展示 manifest sections、fallback artifacts、类型统计和当前分组摘要。
  - 主预览上方会出现二级切换条，用来在当前分组内切换具体 artifact。
  - 结果页要兼容旧 `manifest.files`、新 `artifacts`、`outputs`、`sections` 和 `report.html`。
  - HTML 报告预览是已有能力，不应被弱化成普通文件或从结果页移除。
- scheduled 模式的中间区域现在不再嵌入 `ResultView`，只保留返回对话入口；结果内容只允许出现在右侧结果栏。
- 中间会话区里不再展示分析记录卡片，聊天只保留对话本身。
- 结果页顶部的“分析结果 / 摘要已生成”标题块已经去掉，避免重复信息。
- 结果查看器已经收敛成“主预览 + Honeycomb 结果导航”的结构：
  - 图表 / 表格 / 文本 / HTML 预览放在主区域。
  - 右侧保持一级分组导航，主区域顶部承担二级 artifact 切换。
  - manifest 显式 sections 之外的 fallback artifacts 会自动补进“其他图表 / 其他表格 / 其他文本”等分组，避免插件产物被弱化或漏显。
- 右侧 Honeycomb 导航当前状态：
  - 顶部显示组数、产物数和图表 / 表格 / 文本 / 数据等紧凑统计。
  - 每个分组只保留一级入口与描述，不再展开所有文件。
  - 底部显示当前分组的轻量详情和“打开原文件”入口。
  - 宽度已从旧的 196px 提到 224px，仍保持窄导航，但信息密度更稳定。
- 图表类分组现在优先显示专用 `svg` 图标，避免“图表结果”这类分组在 mixed section 下看起来像缺少图标。
  - 这次目标不是继续加新入口，而是把结果区维持在“简洁但内容不缺”的状态。
- 摘要卡展开时的让位逻辑已经从 `workspaceSessionContent` 挪到 `workspaceSessionFrame`：
  - 之前只是给内容层加右侧 padding，卡片又是 absolute 覆盖，所以看起来只挤出了一小块空白。
  - 现在通过 `workspaceSessionInset` 吃掉右侧预留，摘要卡本身保持在 `workspaceSessionFrame` 这一层，绘画区会整体向左缩进，而不是让卡片落进画布里。

## 当前结果层修复记录（2026-07-12）

- 已发现并纠正一个重要开发方式问题：结果报告不能临时手写一套新 HTML，应优先复用项目已有的报告模板机制。
- 旧体系中已有报告生成约定：
  - `vendor/biof3-core/r-server/tool-scripts/*-report-template.html`
  - 执行器会把插件目录下的 `<toolId>-report-template.html` 复制到 job 根目录为 `report-template.html`
  - 工具脚本读取模板并生成 `report.html`
  - `manifest.files` / `outputs` / `sections` 负责结果页导航和预览
- `resources/built-in-plugins/volcano-plot` 是新的轻量内置插件；原始版本只有 `volcano.png`、`volcano.pdf`、`classified_table.csv`、`manifest.json`，没有 `report.html`。
- 已做的正确收口：
  - 保留真实 bug 修复：`volcano-plot.R` 中 `%||%` 必须在首次使用前定义。
  - 新增 `resources/built-in-plugins/volcano-plot/volcano-plot-report-template.html`。
  - `volcano-plot.R` 改为读取 `report-template.html` 后生成 `report.html`，不再内嵌临时大段 HTML。
  - 当前 demo job `tj_mrhgg5cf_ib7o` 已按同一模板机制重新生成 `report.html` 和 `manifest.json`，并同步更新本地 DB 的 `result_json`。
- 当前 demo job 产物：
  - `report.html`
  - `volcano.png`
  - `classified_table.csv`
  - `deg_table.csv`
  - `manifest.json`
  - `volcano.pdf`
- 已验证：
  - `npm --prefix frontend run check`
  - `npm --prefix frontend test -- result-manifest.test.ts`
- `GET /api/tools/file/tj_mrhgg5cf_ib7o/report.html` 返回 200
- `GET /api/tools/status/tj_mrhgg5cf_ib7o` 返回 completed 且包含 6 个 artifacts
- `ScheduledWorkspacePanel` 已去掉中心结果预览，只剩返回对话；结果只保留在右侧 Honeycomb 导航中，避免重启后中心区再次出现分析记录/结果卡。

后续继续做结果层 UI 时，先遵守这条顺序：

1. 读 `docs/project-workspace-handoff.md` 与 `docs/next-steps-roadmap.md`。
2. 查 `frontend/src/lib/result-manifest.ts`、`frontend/src/pages/project-workspace.tsx`、`frontend/src/lib/result-manifest.test.ts`。
3. 查旧报告模板和 demo 产物：`vendor/biof3-core/r-server/tool-scripts/*-report-template.html`、`vendor/biof3-core/r-server/tool-demo-results/`。
4. 只做兼容和最小修复；不要先重写报告模板、导航结构或结果渲染器。

## 给下一位 Codex Agent 的交接提示

你是接手这个任务的下一位 Codex 时，请直接沿着下面的方向继续，不要重做已经完成的 UI 收口。

### 当前目标

先把最近这批桌面端大改动稳定住，再推进 BioF3 的 **Harness Engine v1** 落地。当前项目经历了大量 UI、路由、状态和 Electron dev-mode 改动，下一位 agent 不应直接跳到新功能，而应先确认当前壳子稳定。

补充一句：当前 UI 的结果工作台已经从“聊天里挂结果卡”切到“右侧结果目录 + 主预览”的模式，后续不要再把分析记录、标题摘要、解释按钮加回聊天流里。

### 当前已完成

- 项目工作台 UI 已基本收口到 Codex-like 三栏结构。
- 结果卡片、摘要卡、右侧工具区的视觉层级已经显著简化。
- 聊天区里的分析记录卡、结果解释按钮、打开完整结果按钮已移除。
- 结果查看器已改为右侧 Honeycomb artifact navigator + 主预览的紧凑布局。
- 桌面端已大幅瘦身：移除 skills / algorithms / prompt playground 等旧入口，`/single-cell` 和 `/spatial` 不再挂到桌面 SPA 路由。
- 已清理桌面导航中仍指向已移除路由的入口。
- 已清理摘要卡 resize 残留状态；摘要卡按固定窄高卡片处理。
- 已新增 `docs/harness-engine-spec.md`，作为 Harness 规范主文档。
- 已新增 `docs/harness-roadmap.md`，作为 Harness 的阶段路线图。
- 已在 `docs/next-steps-roadmap.md` 里挂上 Harness 落地入口。
- Harness Phase 1 基础已落地：
  - `plugin-loader.normalizePluginManifest()` 统一读取 `plugin.json + tool-definition.json`。
  - MCP `tools/list` 透传 `_manifest`、`outputSchema.artifacts` 和 `failureModes`。
  - 内置可运行插件已补 `pluginManifestVersion`、`supportedPlatforms`、`failureModes`。
  - 新增 `npm run harness:check` 和 `test/harness-manifest.test.mjs`。
- Harness Phase 2 初始能力已落地：
  - `scripts/harness-file-index.mjs` 提供可复用文件探测、目录索引和缓存读写。
  - `npm run harness:index -- <path>` 可输出 `harnessIndexVersion: 1` 结构化索引。
  - 支持 CSV / TSV 表头、列类型、缺失值、矩阵方向、DEG 表、样本分组表、表达矩阵等识别。
  - 支持基于缓存的增量索引重建，未变化文件会复用旧索引。
  - 支持 `--for-manifest <tool-definition.json>`，可根据插件输入定义推荐候选文件。
  - 支持 `--scope project|job|artifact|dataset`，可以解析真实 BioF3 工作范围。
  - 支持 `--prompt-summary`，输出给模型使用的轻量摘要。
  - 支持 `--repair-params`，输出参数修复建议。
  - `repairHarnessParams()` 已能做文件输入预填、DEG 列名别名映射、数值参数裁剪。
  - `diagnoseHarnessRunReadiness()` 已能识别 `code` / `detect` 双通道失败模式，并补充 PCA 的 sample-group mismatch 诊断。
  - 后端已新增 Harness API：
    - `GET /api/harness/index`
    - `POST /api/harness/repair`
    - 默认返回 prompt summary，`full=1` 才返回完整索引。
    - project / job / artifact / dataset 均做权限检查；任意 path 只允许 internal/admin。
  - 前端项目工作台已接入 `/api/harness/index`：
    - 右侧文件面板展示 project 工作区识别摘要。
    - 右侧结果面板展示 active job 的 artifact 识别摘要。
    - 新增 `frontend/src/lib/harness-client.ts`。
  - 前端参数确认卡已接入 `/api/harness/repair`：
    - 确认卡会根据 `toolId` 拉取 `/api/tools/manifest`，找不到时 fallback 到静态工具定义。
    - 使用 project scope 扫描当前项目文件，展示 Harness 参数建议。
    - repair 返回后只会填充/修正仍保持原值的参数；如果用户已经手动改了某个参数，不覆盖用户输入。
    - 用户点击“确认开始”后，会把可见且可编辑的修复后参数传回 `run_tool`。
  - Agent prompt 已能读取当前项目的 Harness prompt summary：
    - `ProjectWorkspace` 会获取 project scope 的 `/api/harness/index` prompt summary。
    - `CopilotContext.projectHarnessSummary` 只保留文件数、kind/role 统计和前若干候选文件，避免把完整索引塞进 prompt。
    - `vendor/biof3-core/r-server/helpers/system-prompt.js` 会渲染 `【Harness 项目文件摘要】`，task/legacy agent 路径都会生效。
  - Agent prompt 已进一步接入 active job/artifact 的 Harness summary：
    - `ProjectWorkspace` 会对当前 active done job 获取 artifact scope 的 `/api/harness/index` prompt summary。
    - `CopilotContext.activeJobHarnessSummary` 会进入 prompt 的 `【Harness 当前结果产物摘要】`。
    - 若当前选中了 active artifact，prompt 会优先标出匹配文件，方便 Agent 解释当前结果和选择后续输入。
  - 弱模型回归测试第一版已落地：
    - `scripts/harness-file-index.mjs` 新增 `rankHarnessToolsForRequest()`。
    - 不调用 LLM，仅根据用户意图、工具 manifest 和 Harness index summary 做确定性工具排序。
    - `test/harness-file-index.test.mjs` 已覆盖“差异结果画火山图”和“表达矩阵做 PCA”两条场景，验证选工具、绑定文件和参数修复。
  - 平台抽象层第一版已落地：
    - `scripts/harness-file-index.mjs` 新增 `createLocalHarnessPlatform()`。
    - `resolveHarnessScope()` 对外兼容不变，但底层通过 `platform.resolveScope()` 解析 project / job / artifact / dataset。
    - `indexHarnessScope()` 已支持注入 custom platform adapter，后续可接远程 worker / 云端挂载路径。
  - 平台抽象层第二步已落地：
    - Local platform 支持 `pathMappings: [{ localRoot, canonicalRoot }]`。
    - scope 和 index entries 会带 `canonicalTarget` / `canonicalPath`，prompt summary 也保留 canonical path。
    - 新增 `createHarnessExecutionContext()`，返回 workDir、canonicalWorkDir 和 runtimeReady。
    - runtime ready 支持注入式 `runtimeChecks`，默认 shell ready，R/Python 只做非阻塞环境/路径探测。
  - `run_tool` 执行链路已接入 canonical execution context：
    - MCP/Agent 工具执行入口 `vendor/biof3-core/r-server/mcp/registry.js` 会在结果 summary 中写入 `execution`、`canonicalJobDir`、`canonicalOutputDir`、`canonicalResultDir`。
    - MCP 产物 `artifacts` / `outputs` / `files` 会带 `canonicalPath`，便于后续 Agent、云端 worker、结果解释和参数修复稳定引用。
    - HTTP/前端工具执行入口 `vendor/biof3-core/r-server/helpers/tools-executor.js` 也会把同样的 execution/canonical 元信息写入 `tool_jobs.result_json`。
    - 本地运行时缺失时会更早失败，并把 `runtimeReady` 写入可审计结果上下文。
  - Harness 诊断层第一版已落地：
    - `scripts/harness-file-index.mjs` 新增 `diagnoseHarnessRunReadiness()`。
    - 弱模型工具排序已覆盖 `gene-correlation`，可以识别“相关/共表达/热图”意图。
    - 诊断层会把缺必需文件、矩阵方向不匹配、样本/特征不足、runtime 不可用等转换成统一 `issues`。
    - `/api/harness/repair` 保持原 `repair` 返回值不变，并额外返回 `diagnostics`。
    - 参数确认卡会展示 `ready / needs_review / blocked` 诊断状态；blocked 时禁用“确认开始”，避免明显不可执行任务继续下发。
  - `codex/cross-platform-runtime` 分支已完成专业审计并吸收到当前主线：
    - 没有直接 merge 旧分支；采用 cherry-pick / 选择性吸收，避免回退 Harness 主线。
    - vendor 子仓吸收了 Python runtime 跨平台路径解析：`shared-backend/runtime-paths.js`、Python executor、py-server warm pool / cold path。
    - 主仓吸收了 `src/platform-compat.js`、R/Python runtime 二进制选择、终端 shell plan、插件 zip 纯 Node 解压、runtime 平台匹配。
    - 修正了旧分支遗留风险：补 `scripts/fix-r-paths.mjs`，把 `extract-zip` 提升为直接依赖，并统一三处插件解压调用为 `extractZipFile()`。
    - 新增 `test/platform-compat.test.mjs` 做跨平台命令选择回归。
  - 新增 `test/harness-file-index.test.mjs`。

### 最近一次稳定化验证

2026-07-11 已通过：

```bash
npm --prefix frontend run check
node --check src/main.js
node --check src/preload.js
node --check scripts/dev-electron.js
npm run build:spa
npm run harness:check
node --test test/harness-manifest.test.mjs test/mcp-tool-registry.test.mjs
node --check scripts/harness-file-index.mjs
node --test test/harness-file-index.test.mjs
npm run harness:index -- resources/built-in-plugins/volcano-plot/demo-data --for-manifest resources/built-in-plugins/volcano-plot/tool-definition.json --repair-params '{"top_n":999}' --prompt-summary --no-hash
node --check vendor/biof3-core/r-server/routes/harness.js
node --check vendor/biof3-core/r-server/routes/index.js
npm --prefix frontend run check
npm run build:spa
node --test test/platform-compat.test.mjs
```

2026-07-12 继续通过：

```bash
npm --prefix frontend run check
npm run build:spa
npm run check
node --check vendor/biof3-core/r-server/mcp/registry.js
node --check vendor/biof3-core/r-server/helpers/tools-executor.js
node --test test/agent-run-tool.test.mjs test/harness-file-index.test.mjs
npm --prefix frontend run check
npm run build:spa
```

### 现在最该做的事

1. 先读 `docs/harness-engine-spec.md`。
2. 再读 `docs/next-steps-roadmap.md`。
3. 进入 **标准生物分析流程扩充阶段**，不要再回头改旧的结果卡片交互：
   - 优先盘点并补齐 Bulk RNA 和单细胞高频流程。
   - 每个流程必须有 manifest、参数 schema、failureModes、artifact schema 和真实 fixture。
   - 新流程只注册到现有 task pack/模板，禁止修改 Agent 主协议。
   - 每批流程都跑 ready/recoverable/blocked 和真实产物回归。
   - 基础流程覆盖达到可用规模后，再做结果多轮调整与局部重跑体验。

### 当前原则

- 不要把 Harness 做成更长的 prompt。
- 要把它做成可编排、可验证、可迁移的执行系统。
- Skills 负责策略，插件负责计算，Harness 负责编排。
- 跨平台和大文件索引是核心能力，不是附加项。

### 暂时不要做的事

- 不要再优先做 UI 大改。
- 不要回头重构已经稳定的三栏布局。
- 不要把真实执行逻辑继续散落在 prompt 文案里。
- 不要另建 execution context 或第二套执行器；扩展现有 version 1 工厂和 `run_tool → tool_job → artifact truth` 主链。

## 当前产品判断

BioF3 的 `/project/:projectId` 应继续走 Codex 式项目工作台方向：

- 左侧：项目/资源/搜索/项目切换。
- 中间：Agent 会话与结果输出主舞台。
- 右侧：结果、文件、浏览器、后端/终端、侧边聊天等工具面板。
- 顶层：不是普通网页导航，而是桌面应用级 titlebar，按下面三栏宽度同步分区。

当前视觉原则：

- 全局顶栏高度控制在 `28px`。
- 主背景尽量统一白色或接近白色，不再使用大面积浅绿/浅灰分块。
- 分隔线只保留极细 hairline，避免厚 rail 影响布局观感。
- 主题浅绿色只用于 active / hover / selected，不作为大面积区域背景。
- 内容不要铺满，中间输出区需要左右留白并集中在视觉中部。

## 顶层布局现状

顶层已经从旧的混合式 toolbar 重构为 Codex-like 三段式 titlebar。

目标结构：

```text
┌────────────── left span ──────────────┬──────────── center span ────────────┬──────────── right span ────────────┐
│ mac 窗口点 | 左侧栏 | ← →             │ 文件夹 | 当前项目标题       摘要按钮 │ Tabs | + | 底部终端 | 右侧栏按钮     │
└───────────────────────────────────────┴────────────────────────────────────┴───────────────────────────────────┘
```

已实现要点：

- `App.tsx` 中接入新的 `TitleBar`。
- `/` 封面页不显示这条 workspace titlebar，项目工作台显示。
- 全局内容区 `padding-top` 与 titlebar 高度对齐为 `28px`。
- 顶层左/中/右宽度跟下面主体布局同步：
  - 左段宽度跟左侧栏一致；左侧栏收起时进入 collapsed 宽度。
  - 中段使用 `minmax(0, 1fr)`。
  - 右段跟右侧栏宽度一致；右侧栏收起时进入 collapsed 宽度。
- titlebar 可拖动窗口；按钮区域使用 no-drag。
- 已清除不需要的 `打开位置`、最小化、最大化等按钮。
- 顶层 `+` 是“展开更多工具”，不是摘要按钮。
- 摘要按钮放在中间栏顶层最右侧。

相关文件：

- `frontend/src/components/desktop/TitleBar.tsx`
- `frontend/src/components/desktop/TitleBar.module.css`
- `frontend/src/components/desktop/WorkspacePanelsContext.tsx`
- `frontend/src/hooks/useWorkspaceLayout.ts`
- `frontend/src/hooks/useWorkspacePanels.ts`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/App.tsx`

## 中间会话区现状

中间区域已经从“大卡片包裹聊天”的形态改成更接近 Codex 的开放式会话区。

已完成：

- 移除了中间大卡片边框和阴影。
- 输入框固定在整个中间消息区底部，不再跟着消息输出区漂浮。
- 删除了用于调整聊天框宽度的横向拖拽控件。
- 中间背景、结果区背景、左右区域背景已尽量统一为白色。
- 消息展示做了左右分流：
  - 用户消息在右侧。
  - 模型消息在左侧。
  - 模型消息有轻量卡片感，便于 Markdown 阅读。
- Markdown 基础样式已优化：标题、列表、代码、表格等比之前更清晰。
- 输入框支持随文字长度自适应：
  - 高度自动增长，最大高度受控。
  - 宽度会在一定范围内增长，但不会破坏页面布局。
- 结果输出区已加左右留白，并用 `max-width` 居中，避免内容铺满。

相关文件：

- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/components/copilot/simple-chat.css`
- `frontend/src/components/workspace-panels/CenterPanel.tsx`
- `frontend/src/pages/project-workspace.module.css`

## 左侧栏现状

左侧栏的方向是：背景统一、线条轻、控制按钮靠近 mac 窗口点。

已完成：

- 左侧大面积浅绿背景已移除。
- 左侧栏顶部和下面控制区背景改为与整体一致。
- active / hover 状态保留主题浅绿色。
- 搜索框离全局顶栏更近，顶部空隙已压缩。
- 左侧栏收起/展开按钮位置已向 mac 窗口点靠近。
- 左侧栏收起时按钮应靠到最左侧，仍需继续实机观察细节是否完全和谐。

相关文件：

- `frontend/src/components/workspace-panels/LeftPanel.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/components/desktop/TitleBar.module.css`

## 右侧工具区现状

右侧工具区现在以 tab + more tools 的模式运作。

已完成：

- 删除了最右侧额外图标竖栏。
- 顶层 `+` 用于添加/切换更多工具。
- 右侧空态不再作为“结果主页”的长期设计方向，只作为没有具体工具内容时的轻量入口。
- 文件树保持在右侧，文件内容在左侧展示，打开文件不应自动收起文件树。
- 右侧文件树宽度已加宽过，体验比最初稳定。
- 浏览器已作为右侧工具之一接入；默认站点方向是 `https://biof3.com/`。
- 后端/终端方向拆分过：顶部工具中的“后端”用于服务状态与日志，真正终端走底部面板。

仍需继续确认：

- `+` 菜单在所有状态下是否都稳定打开工具，而不是回到工作台主页。
- 浏览器区域在不同网页下是否仍有高度/滚动/遮挡问题。
- 终端体验还没有完全达到 Codex 手感，后面要继续精修。

相关文件：

- `frontend/src/components/workspace-panels/RightPanel.tsx`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`

## 摘要信息卡现状

摘要信息现在定位为后续“分析任务动态跟踪”的基础，不再做宽大的横向信息面板。

已完成：

- 摘要默认关闭。
- 摘要开关按钮在中间栏顶层最右侧。
- 删除了摘要卡 resize 手柄。
- 摘要卡固定为较窄、较高的竖向卡片。
- 摘要卡阴影已尽量移除，避免顶部或边缘出现悬浮脏影。
- 摘要卡内容已压缩：
  - 保留当前活动/状态。
  - 删除早期过松散的上下文、正在查看等内容。
  - 不再展示不必要的长路径与宽卡片信息。

需要继续观察：

- 摘要卡与摘要按钮的视觉连接还可以更精准。当前是靠近按钮下方的固定悬浮卡，后续如果要完全 Codex-like，可以用按钮位置计算真实 anchor。

相关文件：

- `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/hooks/useWorkspacePanels.ts`

## 云平台/封面页现状

已处理：

- 软件打开首页/封面页顶部不再展示项目工作台 titlebar。
- 云平台工作台里旧的“快速开始”区域已清理。

产品判断：

- “快速开始”是早期遗留分析入口，当前插件体系还没有稳定呈现时，保留它会误导用户。
- 后续更适合替换为：
  - 最近使用插件；
  - 当前项目推荐工具；
  - 插件市场/固定 workflow 入口；
  - 最近任务与可复现记录。

相关文件：

- `frontend/src/pages/_desktop-dashboard.tsx`

## 开发体验现状

已支持开发热更新：

- `npm run dev` 现在会启动 Vite dev server，再启动 Electron。
- Electron dev 模式优先加载 `http://localhost:3000`，而不是每次使用 `frontend/dist`。
- 修复过 `@vitejs/plugin-react can't detect preamble`，dev CSP 已允许 React refresh 所需脚本。

常用命令：

```bash
npm run dev
npm --prefix frontend run check
npm run build:spa
```

注意：

- `npm run check` 会先跑 `scripts/sync-vendor.sh check`，因此子模块变更必须同步更新 `.vendor-lock`。
- 当前 Harness Phase 1 已接受 `vendor/biof3-core` 的新 HEAD，并更新 `.vendor-lock`。

相关文件：

- `package.json`
- `scripts/dev-electron.js`
- `src/main.js`

## 当前最重要的下一步

换工作区后建议按这个顺序继续：

1. 先运行 `git status`，确认 Core 位于 `dcd2043`、Desktop 基线为 `2d000d5` 且 `.vendor-lock` 一致；保留未跟踪的 `.cursor/`，不要覆盖用户文件。
2. 以现有 GO/KEGG 富集能力作为标准流程覆盖的首个 Plugin SDK 试点，先盘点 `go-kegg.R`、enrichment task pack、插件 manifest 和真实 DEG artifact，避免复制已有实现。
3. 通过 scaffold/SDK 补齐 manifest、input/output schema、failureModes 与最小 fixture，并验证 built-in/development 发现和结构化诊断。
4. 从真实 valid DEG artifact 跑通 Agent `plan → run → verify → bind → decide`，核对 tool job、artifact truth、lineage 和恢复状态；不得为该插件修改 Agent 核心、执行器或结果 UI。
5. 运行 `npm run check`、`npm run harness:phase6`、全量 Harness/Agent 评测和相关 adapter 回归。试点通过后再提交 Core、同步 `.vendor-lock` 和 Desktop 指针。

UI 目前冻结。只有阻断 Agent 工作区、结果数据错误或明确回归时才修改前端，不再继续进行纯视觉精修。

## 当前重点文件索引

标准流程覆盖首要文件：

- `scripts/scaffold-harness-tool.mjs`
- `scripts/check-harness-manifests.mjs`
- `scripts/harness-file-index.mjs`
- `scripts/harness-task-packs.mjs`
- `vendor/biof3-core/r-server/plugin-loader.js`
- `vendor/biof3-core/shared-backend/agent-workflow.js`
- `vendor/biof3-core/r-server/agent-tools/learning.js`
- `vendor/biof3-core/r-server/helpers/harness-workflow-state.js`
- `vendor/biof3-core/r-server/helpers/harness-workflow-recovery.js`
- `test/harness-manifest.test.mjs`
- `test/harness-tool-template.test.mjs`
- `test/agent-approval.test.mjs`
- `vendor/biof3-core/test/agent-workflow.mjs`

冻结但仍需兼容的 UI 文件：

- `frontend/src/App.tsx`
- `frontend/src/components/desktop/TitleBar.tsx`
- `frontend/src/components/desktop/TitleBar.module.css`
- `frontend/src/components/desktop/WorkspacePanelsContext.tsx`
- `frontend/src/hooks/useWorkspacePanels.ts`
- `frontend/src/hooks/useWorkspaceLayout.ts`
- `frontend/src/hooks/useRightPanelTabs.ts`
- `frontend/src/components/workspace-panels/CenterPanel.tsx`
- `frontend/src/components/workspace-panels/LeftPanel.tsx`
- `frontend/src/components/workspace-panels/RightPanel.tsx`
- `frontend/src/components/workspace-panels/WorkspaceSummaryCard.tsx`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/components/copilot/simple-chat.css`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/pages/_desktop-dashboard.tsx`
- `frontend/src/styles/global.css`
- `src/main.js`
- `package.json`
- `scripts/dev-electron.js`

## 当前工作树提示

当前工作树有大量 UI 改动和新增文件，这是预期状态。切换工作区前，如果需要真正做 git 层面的快照，建议单独提交一次，例如：

```bash
git add docs/project-workspace-handoff.md frontend src package.json scripts
git commit -m "Refine Codex-style project workspace layout"
```

不要随手 reset；这些改动大多是连续 UI 打磨的结果。
