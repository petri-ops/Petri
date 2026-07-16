# 项目工作路径与结果沙盒专项计划

最后更新：2026-07-16 04:05 UTC

> **⚠️ 历史记录横幅（2026-07-16 补充）**：本文是已完成的历史专项记录，其后仓库经历了「去 vendor 化 + web 冗余清理」（见 [`dependency-decoupling-checkpoint.md`](../../dependency-decoupling-checkpoint.md)），阅读时请注意：
> - 文中所有 `vendor/biof3-core/X` 路径现在是 `core/X`（submodule 已内联）。
> - 文中提到的 PostgreSQL 文件（`db-core-pg.js`、`r-server-db-pg.js` 等）与 `Core vendor 同步` 均已移除；数据库现为纯 SQLite。
> - Phase 5b 收敛的「单细胞 step 引擎」已在 Phase B 整体移除（单细胞工具将重写）。
> - resolver / 沙盒 / containment 的**结论仍然有效**，只是承载文件路径与后端形态已变。本文不再逐行维护。

状态：**Phase 0-5 全部完成 + Phase 5b 单细胞 step 引擎收敛完成**（历史）。

执行进度：
- ✅ Phase 0: 基线测试（29项测试通过）
- ✅ Phase 1: Project Run Layout Resolver（已提交Core改动）
- ✅ Phase 2: R/Python工具收敛（R + Python 入口均已收敛到 resolver，含 Python 真实临时目录测试）
- ✅ Phase 3: MCP/Agent/Harness收敛（插件工具入口以 tool_job.id 收敛到项目沙盒/全局 tool-jobs；Harness 读取已兼容）
- ✅ Phase 4: Artifact路由与报告（route containment 硬化 + 报告落 output/ + 导出副本进 results/exports/）
- ✅ Phase 5: 兼容性与远端（历史不搬迁 + 换 workspace 各自可读 + system scope + 远端边界确认）
- ✅ Phase 5b: 单细胞 step 引擎收敛（harness 作用域运行物化产物到项目沙盒 output/，零回归）

## 1. 任务定义

主模块：`P-02 工具执行、Job 与 Artifact Truth（Execution Truth）`

影响模块：

- `P-01 项目、会话与上下文`：`projectId → workspace_path` 的可信解析。
- `P-03 Harness 与 Agent 工作流`：Agent/MCP、恢复和二跳 artifact 必须复用同一运行目录。
- `P-05 Runtime 与平台适配`：本地、容器、远端只在 adapter 层处理路径差异。
- `W-04 结果与报告`、`W-06 项目资源与文件`：结果可发现、可预览、可导出。
- `P-06 桌面集成与交付`：Electron 本地数据目录和 Core vendor 同步。

关注点：`C-03 安全、确认与审计`、`C-04 状态与事件同步`、`C-05 测试与质量门禁`。

目标：

> 用户为项目选择的 `workspace_path` 是该项目所有正式分析结果的物理沙盒根。R、Python、MCP、Agent Workflow 和报告生成不得继续把项目结果默认写入全局 `BioF3-Local/results`。

本任务是运行目录收敛，不是新增分析流程，不得改变唯一事实链：

> `run_tool → tool_job → artifact truth`

## 2. 当前事实与缺口

已经成立：

- project 数据模型、SQLite/PostgreSQL 和工作台已经保存 `workspace_path`。
- workspace file API 已把文件树和文件读取限制在项目根目录内。
- Harness 的 project scope 已能从 `projectId` 读取 `workspace_path`。
- Agent/MCP 创建的 `tool_job` 已可记录 `project_id`。

尚未成立：

1. Electron 仍把 `BIOF3_LOCAL_RESULTS_DIR` 固定为 `~/Documents/BioF3-Local/results`。
2. R 普通工具固定写入 `<global-results>/tool-jobs/<jobId>`。
3. Python 工具固定写入同一个全局 `tool-jobs`。
4. MCP/Agent 插件固定写入 `<global-results>/mcp-tool-jobs/<mcpJobId>`。
5. 普通 `/api/tools/run` 执行入口没有以 `projectId` 解析 `jobDir`，写 `tool_jobs` 时也未统一持久化 `project_id`。
6. MCP 的物理目录使用 `mcp_*`，数据库事实使用 `tool_job.id`，目录身份尚未收敛。
7. artifact 路由和清理逻辑主要信任全局 jobs root，尚未把“该 job 所属项目的结果根”作为授权边界。
8. Python task cache、上传缓存、runtime、插件、数据库等系统数据与正式结果混合在全局 BioF3 数据目录语义中，必须明确哪些迁、哪些不迁。

关键代码证据：

- `src/main.js`：`BIOF3_LOCAL_RESULTS_DIR` 初始化。
- `vendor/biof3-core/r-server/routes/tools.js`：R `JOBS_DIR`。
- `vendor/biof3-core/r-server/helpers/tools-executor.js`：普通工具创建 `jobDir`、写 params/files、执行和 artifact 路由。
- `vendor/biof3-core/py-server/tools-router.js`：Python `JOBS_DIR/jobDir/outputDir`。
- `vendor/biof3-core/r-server/mcp/registry.js`：`MCP_JOBS_DIR` 和 MCP 物理目录。
- `vendor/biof3-core/r-server/routes/harness.js`：project scope 与 artifact 解析。
- `vendor/biof3-core/r-server/routes/files.js`：workspace containment 参考实现。
- `vendor/biof3-core/shared-backend/execution-context.js`：canonical path 与 adapter 边界。

## 3. 目标目录契约

用户选择目录本身是项目根，不额外再嵌套项目名：

```text
<workspace_path>/
├── data/                         # 用户主动放入/导入的项目数据；本任务不强制搬迁已有大文件
├── results/
│   ├── jobs/
│   │   └── <toolJobId>/
│   │       ├── params.json       # 最终执行参数快照
│   │       ├── inputs/           # 本次上传/需物化的小型输入；外部大文件记录引用和校验信息
│   │       ├── work/             # 脚本和执行期工作文件
│   │       ├── output/           # 正式 artifacts、manifest、报告
│   │       └── logs/
│   │           └── run.log
│   └── exports/                  # 用户主动导出的报告/汇总
└── .biof3/
    └── workspace.json            # 可选的非敏感 workspace 版本/身份元数据
```

硬性约束：

- 物理目录主键统一使用正式 `tool_job.id`，不再用另一套 `mcp_*` 身份作为结果目录名。
- 每个 job 只能写入自己的 job root；插件脚本不能获得整个项目根的任意写权限。
- `output/` 是正式产物区；只有 artifact truth 验证过的文件才能进入结果 UI 和下游 lineage。
- `params.json`、日志、manifest 和结果必须与 `tool_job` 一一对应。
- 路径解析必须后端完成：客户端只提交 `projectId`，不得提交可信输出绝对路径。
- 所有 `realpath`/symlink/path traversal 检查以项目 `results/jobs/<toolJobId>` 为包含边界。

## 4. 明确不进入项目结果沙盒的内容

以下继续留在 `BioF3-Local` 应用数据目录：

- SQLite/PostgreSQL 连接配置和数据库文件。
- API Key、credential reference、AI 设置和隐私设置。
- R/Python runtime、插件安装包和应用更新文件。
- 可安全重建的下载缓存、Python task cache、临时文件。
- 应用日志、诊断包、崩溃记录。
- conversation/message 数据库本体。

原因：这些属于应用级状态或敏感配置，不是用户项目结果。不要为了“所有东西都在一个目录”破坏凭据隔离或多项目共享 runtime。

## 5. 实施阶段

### Phase 0：基线与测试夹具 ✅

**状态：已完成**

完成内容：

1. ✅ 保留当前 dirty worktree，Core 回收站改动未被覆盖
2. ✅ 创建基线审计测试 `test/project-result-sandbox.test.mjs`
3. ✅ 记录当前缺口清单：
   - Electron 固定设置 `BIOF3_LOCAL_RESULTS_DIR`
   - R/Python executor 固定使用全局 `JOBS_DIR`
   - MCP 使用独立的 `mcp-tool-jobs` 目录
   - `/api/tools/run` 未强制要求 `projectId`
   - artifact route 主要信任全局 jobs root
4. ✅ 建立路径安全测试夹具框架（TODO 项待 Phase 1-2 补充）

验证证据：
- `npm test -- test/project-result-sandbox.test.mjs` 通过
- 4 个预期失败测试（skip）记录当前问题
- workspace_path 数据库字段已存在确认
- 当前缺口清单全部记录

### Phase 1：建立唯一 Project Run Layout Resolver ✅

**状态：已完成**

完成内容：

1. ✅ 创建 `vendor/biof3-core/shared-backend/project-run-layout.js`
2. ✅ 实现 `resolveProjectRunLayout({ projectId, toolJobId, db, userId, skipPermissionCheck, ensureDirs })`
   - 从数据库读取 project.workspace_path
   - 校验项目存在、active、有权限、workspace 可写
   - 返回规范化目录结构：`workspaceRoot → resultsRoot → jobRoot → inputs/work/output/logs`
   - 防止路径遍历、symlink escape
3. ✅ 实现 `resolveSystemRunLayout({ toolJobId, systemScope })` — 系统任务显式 scope
4. ✅ 实现 `isPathContained(root, target)` — 路径包含检查
5. ✅ 实现 `safeJoinUnder(root, ...segments)` — 安全路径连接
6. ✅ 实现 `restoreLegacyJobLayout(job, fallbackJobsDir)` — 历史路径恢复

验证证据：
- `npm test -- test/project-run-layout.test.mjs` 全部通过（29 项测试）
- 路径遍历防护测试通过（`../`, 绝对路径注入）
- 权限检查测试通过（拒绝非拥有者、归档项目）
- 系统任务目录测试通过
- 历史 job fallback 测试通过

### Phase 2：收敛普通 R/Python 工具入口 ✅

**状态：R 工具 + Python 工具均完成**

已完成（R 工具）：
- ✅ 在 `r-server/helpers/tools-executor.js` 引入 resolver
- ✅ 修改 `handleToolRun()` 接受 `projectId`，使用 `resolveProjectRunLayout()` 创建目录
- ✅ 修改 `tool_jobs` INSERT 语句持久化 `project_id`
- ✅ 修改 `handlePrivateFileRead()` 支持项目目录读取，带三层回退
- ✅ 修改 `handleGenerateFinalReport()` 支持项目目录
- ✅ 修改 `cleanupLocalToolJobDir()` 清理项目目录
- ✅ 已提交 Core 改动

路径解析顺序：
1. 项目 workspace/results/jobs/<toolJobId>（如提供 projectId）
2. 全局 JOBS_DIR（向后兼容）
3. 历史 result_json 路径（旧 job）

已完成（Python 工具）：
- ✅ `py-server/r-server-db.js` + `r-server-db-pg.js` 新增 `getProject()`（projectId → workspace_path，只读 projects 表，不 hydrate）
- ✅ `insertToolJob()` 增加并持久化 `project_id`（SQLite + PG）
- ✅ `tools-router.js` 引入 `resolveProjectRunLayout`，新增 `resolveRunLayout()`：带 projectId 落项目沙盒、无 projectId 兜底全局
- ✅ `executeJob()` 改为消费预解析 layout（host + container 路径）
- ✅ POST `/api/tools/run` 接受 `projectId`，解析失败返回 400，不静默写全局
- ✅ 文件读取 `/api/tools/file` 三层回退（项目 → 全局 → 历史 result_json）+ 路径遍历防护
- ✅ DELETE 清理用 `resolveExistingJobDir` 定位真实目录
- ✅ 本地（desktop）模式容器路径 = 宿主路径；docker（web）模式保留全局挂载映射（与 R 侧对齐）

关键文件：
- ✅ `vendor/biof3-core/r-server/helpers/tools-executor.js`
- ✅ `vendor/biof3-core/py-server/tools-router.js`
- ✅ `vendor/biof3-core/py-server/r-server-db.js`
- ✅ `vendor/biof3-core/py-server/r-server-db-pg.js`

验证证据：
- `test/project-sandbox-py-tools.test.mjs`：7 项 Python 入口真实临时目录测试全部通过
- 全量 `node --test test/*.test.mjs`：仅剩已知基线 5 个 qa-smoke 失败，未新增失败

### Phase 3：收敛 MCP/Agent/Harness ✅

**状态：MCP/Agent 插件工具入口完成；Harness 读取已兼容；单细胞 step 引擎边界见下**

已完成：
- ✅ `mcp/registry.js` `_runPluginScript()` 改为**先创建/准备正式 `tool_job`，再以 `tool_job.id` 创建物理目录**（不再先建 `mcp_*` 目录）
- ✅ 删除 `MCP_JOBS_DIR`（mcp-tool-jobs）作为项目任务默认根；新增 `GLOBAL_JOBS_DIR`（共享 `tool-jobs`）
- ✅ 抽出 `_resolveMcpJobLayout({ toolJobId, projectId, userId })`：
  - 有 projectId + toolJobId → `resolveProjectRunLayout()` 落项目沙盒 `<workspace>/results/jobs/<toolJobId>`
  - 无 projectId → 全局 `tool-jobs/<toolJobId>`（与 R/Python HTTP executor 同根、同 `tool_job.id` 身份）
  - db 不可用（无 toolJobId）→ 回退临时 `mcp_` 身份仅保证不崩
- ✅ 有 projectId 但解析失败（不存在/归档/无权限/不可写）→ 硬失败标 `tool_job` failed + 同步 plan step，不静默写全局
- ✅ Agent `run_tool`（`agent-tools/learning.js` `_executeRunTool`）已透传 `projectId` + `toolJobId`（确认续跑/恢复复用同一 `tool_job.id`）→ 物理目录随之收敛，`existingToolJobId` 二跳复用同目录
- ✅ Harness project/job/artifact scope（`routes/harness.js`）通过 `selectArtifactResultDirBestEffort()` 读 `result_json` 中的绝对 `resultDir`/`outputDir` + `jobsRoot/job.id`，已能读到项目沙盒结果（无需再建索引），继续投影既有 artifact truth
- ✅ 未创建任何新的 workflow DB、结果索引或 artifact 表

历史兼容：
- 历史 `mcp-tool-jobs/<mcp_*>` 结果不自动搬迁，按 `result_json` 绝对路径回读；`tools-executor.js` 的 `isManagedResultDir` 已识别 `mcp-tool-jobs` 根。

单细胞 step 引擎收敛（Phase 5b，见下）：
- 单细胞 10 步（`STEP_META` 分支）走独立异步 task-queue/worker 引擎，在 ephemeral `TEMP/task-<taskId>` workDir 执行，产物经 storage adapter 持久化到 `results/task-<taskId>`（其自有系统，支撑单细胞页 UI + `analyses` 表）。
- Phase 5b 已把它纳入运行目录契约：项目作用域运行（harness 上下文带 `projectId` + `toolJobId`）时，完成后把已声明产物**物化**到项目沙盒 `<workspace>/results/jobs/<toolJobId>/output/`，`tool_job.resultDir` 指向沙盒，经同一 `/api/tools/file/<toolJobId>/<name>` 身份提供。详见 Phase 5b。

验证证据：
- `test/project-sandbox-mcp-tools.test.mjs`：5 项测试全部通过
  - 项目沙盒落点、全局 tool-jobs 落点（非 mcp-tool-jobs）、归档/不存在项目硬失败、db 不可用回退
- 全量 `node --test test/*.test.mjs`：仅剩已知基线 5 个 qa-smoke 失败，未新增失败
- 既有 `test/mcp-*.test.mjs` / `test/agent-run-tool.test.mjs` 全部通过

### Phase 4：Artifact、报告与文件可发现性 ✅

**状态：完成**

已完成：
- ✅ artifact file route 授权链：route 层 `canAccessToolJob`（owner/admin，跨用户/跨项目拒绝）→ `handlePrivateFileRead` 按 `tool_job.project_id → workspace_path → jobRoot` 三层解析
- ✅ **containment 硬化**：项目分支改用 `safeJoinUnder(layout.outputDir, filename)`，拒绝 `../`/绝对路径注入逃逸（此前项目分支用裸 `path.join`，全局分支才有守卫）
- ✅ `handlePrivateFileWrite` 改为项目感知（load job → 解析项目 `output/` → `safeJoinUnder` 守卫 → 回退全局），并包 try/catch 不产生未处理 rejection；`regenerateReportForImage` 接受解析出的 `outputDir`
- ✅ 最终报告在当前 job 的 `output/` 生成（`materializeFinalReport` 写 `output/final-report.html`，内嵌图片自包含）
- ✅ **用户主动导出的副本进入 `results/exports/`**：`handleGenerateFinalReport` 在项目 job 上把自包含报告复制到 `<workspace>/results/exports/<jobId>-final-report.html`，响应返回 `exportPath`（相对项目根，文件树可发现）
- ✅ resolver 目录契约新增 `exportsDir = resultsRoot/exports`（结果根级共享目录，跨 job）
- ✅ 项目文件树（`routes/files.js` `/api/workspaces/:projectId/tree`）为通用递归 prefix 遍历，自然显示真实存在的 `data/`、`results/jobs/`、`results/exports/`；隐藏 `.` 开头项
- ✅ 结果 UI 继续走 `/api/tools/file/<jobId>/<name>` job/artifact identity，不把裸绝对路径传前端
- ✅ 未新建 workflow DB / 结果索引 / artifact 表

关键文件：
- ✅ `vendor/biof3-core/shared-backend/project-run-layout.js`（新增 exportsDir）
- ✅ `vendor/biof3-core/r-server/helpers/tools-executor.js`（containment + 项目感知写 + 导出副本）

验证证据：
- `test/project-sandbox-artifacts.test.mjs`：4 项通过
  - resolver exportsDir 契约、报告在 output/ 自包含内嵌、导出副本落 results/exports/ 且路径可发现、safeJoin containment 拒绝 `../`
- `test/project-run-layout.test.mjs`：30 pass（新增 exportsDir 未破坏既有断言）
- 全量 `node --test test/*.test.mjs`：仅剩已知基线 5 个 qa-smoke 失败，未新增失败

### Phase 5：兼容、迁移与远端 ✅

**状态：完成**

已完成/已确认：
- ✅ **历史 job 不自动搬迁**：`restoreLegacyJobLayout(job, fallbackJobsDir)` 优先读 `result_json` 中的 `jobDir`/`outputDir`/`resultDir`，存在即回读；否则兜底全局 `JOBS_DIR/<job.id>`；都没有则返回 null（不臆造路径）。R/Python executor 的 3 层回退（项目 → 全局 → result_json）与之一致，新 job 只写新路径。
- ✅ **更换 workspace 不移动历史结果**：resolver 运行时读 `project.workspace_path` 当前值 → 新 job 落新 workspace；旧 job 按其 `result_json` 持久化路径继续可读，不搬迁。测试覆盖新旧 job 各自路径。
- ✅ **系统任务显式 system scope**：`resolveSystemRunLayout({ toolJobId, systemScope })` 落 `<appData>/system-tasks/<scope>/results/jobs/<toolJobId>`，缺 `toolJobId` 抛错，不静默回退项目/全局。当前无 tool_jobs 型系统任务；该入口为更新/诊断/缓存清理等应用级任务预留。
- ✅ **远端执行**：桌面版 `execMode=local`（无远端），工具直接在本地项目 sandbox 执行。Web/平台部署下 `runMode=platform` 通过 `tools-dell-proxy` 把请求（含 `projectId`）转发到 Dell，Dell 侧用同一 resolver 在**其**项目 sandbox 解析并落地；平台为无状态代理，`proxyDellPrivateFile`/`proxyDellGenerateReport` 按需回源 Dell artifacts，无需也不应在代理侧另建本地物化目录（符合"唯一执行事实链 / 不建第二套"）。桌面版无远端物化需求。
- ✅ **回收站**：Core 现有回收站改动（`016_projects_status.sql`、`api-data.js`、`db.js` 等 dirty worktree）完整保留、未 reset；归档项目不删 workspace；本任务未新增"删目录"高风险操作。
- ✅ 移除 executor 中未使用的 `restoreLegacyJobLayout` import（resolver 仍导出供库/测试使用）。

验证证据：
- `test/project-sandbox-compat.test.mjs`：6 项通过
  - 历史 job 从 result_json 回读 / 兜底全局 / 无路径返回 null；换 workspace 后新旧 job 各自路径可读；system scope 落 system-tasks、缺 toolJobId 抛错
- 全量 `node --test test/*.test.mjs`：仅剩已知基线 5 个 qa-smoke 失败，未新增失败
- `npm run check`：通过（sync-vendor OK + node --check + harness 4/4 manifest 有效）

### Phase 5b：单细胞 step 引擎收敛 ✅

**状态：完成（应用户要求，把此前标为边界外的单细胞 step 引擎纳入运行目录契约）**

背景：
- 单细胞 10 步走独立、更早期的异步 task-queue/worker 引擎，用 `analyses` 表 + storage adapter（OSS key `results/task-<taskId>`）作为自有结果系统，支撑 `/single-cell` 页 UI。
- 它在 ephemeral `TEMP/task-<taskId>` workDir 执行；此前 harness 桥接的 `tool_job.resultDir` 指向一个并不在项目沙盒、甚至本地不存在的 `results/task-<taskId>`，未遵循运行目录契约。

已完成（`helpers/step-tool-job.js`）：
- ✅ 新增 `materializeStepArtifactsToProject({ task, results })`：仅在 harness 上下文带 `projectId` + `toolJobId` 时，把 workDir 里**已声明产物**（plots + files + summary.json）物化到 `resolveProjectRunLayout()` 解析出的项目沙盒 `output/`，`safeJoinUnder` 守卫 containment
- ✅ `syncStepToolCompleted` 在项目作用域运行时把 `tool_job.resultDir` 指向沙盒 `output/`（`reconcileArtifactTruth` 随之对沙盒校验）；非项目运行回退旧 `persistentResultDir`，语义不变
- ✅ 沿用 Phase 5「远端执行完成后物化到本地项目 output/」模式：workDir 是临时执行区（等价 ephemeral executor），沙盒是唯一持久结果家 —— 不是"运行后复制冒充收敛"
- ✅ 只物化已声明产物，不搬运 `result.rds` 等未声明中间态/脚本
- ✅ 保留原 storage upload（单细胞页 UI 不受影响，零回归）；harness/tool_job 视图改由沙盒 + `/api/tools/file/<toolJobId>` 统一身份提供

权衡（已知）：
- 项目作用域单细胞 step 的已声明产物会同时存在于 storage（单细胞页）与项目沙盒（harness/tool_job）。这是为零回归保留双消费方的有意取舍；若后续要单一化，可让单细胞页也改读沙盒身份后移除 storage 上传（独立跟进项）。

验证证据：
- `test/project-sandbox-singlecell.test.mjs`：3 项通过（项目作用域物化到沙盒 output/、非项目返回 null、workDir 缺失返回 null、未声明产物不物化）
- `test/step-tool-bridge.test.mjs` + `test/harness-workflow-*.test.mjs`：12 pass，零回归
- 全量 `node --test test/*.test.mjs`：仅剩已知基线 5 个 qa-smoke 失败

## 6. 关键不变量与禁止事项

- 不建立第二套 executor、job 表、workflow 状态库或结果真相系统。
- 不用“运行结束后复制一份结果”冒充收敛；正式执行根必须从开始就在项目 sandbox 中。
- 不按项目名拼路径；项目名可重命名，身份必须使用 `projectId/toolJobId`。
- 不信任客户端传入的 workspace/output 绝对路径。
- 不让插件直接写 workspace 根、其他 job 或其他项目。
- 不自动移动用户历史结果或大数据文件。
- 不删除用户选择的外部工作目录。
- 不把数据库、密钥、runtime、插件和缓存迁进项目目录。
- 不因本任务改写分析脚本内容；只适配统一的 work/output 契约。

## 7. 验收矩阵

### 功能验收

- R 普通工具结果位于当前项目 `results/jobs/<toolJobId>/output`。
- Python 普通工具结果位于同一契约。
- Agent/MCP 工具使用正式 `toolJobId` 目录，不产生独立全局 mcp 结果根。
- Harness workflow、确认续跑、失败恢复仍绑定同一个 job/artifact truth。
- 日志、params、manifest、报告均能从项目目录找到。
- 切换项目后并发任务不会串目录。
- 重启应用后历史新路径结果仍能打开。
- 更换 workspace 后新旧 job 均按各自持久化路径可读。
- 项目归档/恢复不影响目录；永久删除项目记录不删除外部 workspace。

### 安全验收

- 拒绝缺少 `projectId` 的项目工具请求，不静默写全局目录。
- 拒绝不存在、已归档或无权访问的 project。
- 拒绝 `../`、绝对路径注入和 symlink escape。
- job A 不能读取/覆盖 job B；project A 不能读取 project B。
- artifact route 只能返回 truth 中登记且磁盘校验通过的文件。

### 回归门禁

```bash
npm --prefix frontend run check
npm --prefix frontend run build
npm test --prefix frontend
npm test
npm run harness:phase6
npm run harness:agent-evaluate
```

另外必须增加专项自动化测试（已全部落地）：

- ✅ resolver 单元测试（路径、权限、归档、不可写、symlink）：`test/project-run-layout.test.mjs`（30 pass）
- ✅ R/Python/MCP 三入口真实临时目录测试：
  - Python：`test/project-sandbox-py-tools.test.mjs`（7 pass）
  - MCP/Agent：`test/project-sandbox-mcp-tools.test.mjs`（5 pass）
  - R：结果契约由 resolver 单测 + `test/project-sandbox-artifacts.test.mjs` 覆盖（executor 复用同一 resolver）
- ✅ 旧 job fallback 测试：`test/project-sandbox-compat.test.mjs`
- ✅ workspace 变更测试：`test/project-sandbox-compat.test.mjs`
- ✅ artifact route containment 和跨项目拒绝测试：`test/project-sandbox-artifacts.test.mjs`（safeJoin containment）+ route 层 `canAccessToolJob` owner-only 授权

当前已知、不要误归因给本任务的基线失败：

- `frontend/src/hooks/useResizableColumns.test.ts` 当前有 3 个既有失败。
- root `qa-smoke` 当前有 5 个既有失败。

新 Agent 开始前应重新跑一次确认基线，专项改动不得增加失败数。

## 8. 建议首批修改文件

Core 主体：

- `vendor/biof3-core/r-server/db.js`
- `vendor/biof3-core/r-server/db-core-pg.js`
- `vendor/biof3-core/r-server/routes/tools.js`
- `vendor/biof3-core/r-server/helpers/tools-executor.js`
- `vendor/biof3-core/py-server/tools-router.js`
- `vendor/biof3-core/r-server/mcp/registry.js`
- `vendor/biof3-core/r-server/routes/harness.js`
- `vendor/biof3-core/r-server/routes/files.js`
- `vendor/biof3-core/shared-backend/execution-context.js`

Desktop/前端契约：

- `src/main.js`
- `frontend/src/lib/project-store.ts`
- `frontend/src/components/copilot/copilotClient.ts`
- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/components/workspace-panels/RightPanel.tsx`

测试：

- `test/agent-run-tool.test.mjs`
- `test/artifact-truth.test.mjs`
- `test/harness-file-index.test.mjs`
- 新增 `test/project-result-sandbox.test.mjs`

## 9. 新 Agent 启动指令

建议把下面内容直接交给独立 Agent：

```text
请先阅读 docs/project-result-sandbox-plan.md、docs/development-module-map.md 和 docs/project-workspace-handoff.md。
本任务主模块是 P-02，目标是让项目 workspace_path 成为 R/Python/MCP/Agent Workflow 的正式结果沙盒。
先执行 Phase 0 的只读审计和失败测试，不要直接批量改路径；保持 run_tool → tool_job → artifact truth，不建立第二套结果系统，不移动历史数据，不删除用户工作目录。
完成每个 Phase 后更新专项文档中的状态和验证证据，并同步 Core 子模块提交与主仓库 submodule 指针。
```

## 10. 完成定义

只有同时满足以下条件才能标记完成：

1. 新建项目选择 workspace 后，R、Python、MCP、Agent Workflow 的新结果都物理落在该 workspace。
2. job、日志、manifest、artifact、报告使用同一目录身份和授权边界。
3. 历史结果可读、workspace 变更语义明确、外部目录不会被误删。
4. 三入口真实测试、路径安全测试、Harness 回归和构建门禁有可复现证据。
5. Core 已独立提交，主仓库同步 submodule 指针和 `.vendor-lock`（如项目同步流程要求），交接文档更新。
