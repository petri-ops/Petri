# BioF3 Desktop Current Handoff

最后更新：2026-07-26

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

`v0.0.1-rc.7` 是当前 OSS 线上最新版，已完成候选代码、双架构构建、安装启动验收和公开更新链核验。

当前固定顺序：

> **Stage 1 UI 产品化 → Stage 2 模型层 → Stage 3 Harness 与标准流程 → Stage 4 首个稳定产品版本**

Stage 1、Stage 2、Stage 3 均已完成出口验收。Stage 4 macOS arm64 RC 已完成代码、首用、迁移、隐私、构建、提交/tag、OSS 上传及公开下载反向验证。

## 3. 当前立即任务

### 3.0 当前主线：G0 Living Foundation maintained

2026-07-25 `G0-START`、LF0～LF12 核心资格已关闭并进入 maintained。Result Studio RS0～RS8 的引擎基础存在，但后续产品复核确认 RS9 的第 17 类证据不能证明连续真实产品任务；`result-studio-editing` 支持声明暂停，当前状态为 `active / implemented_unverified`。

G0 资格只覆盖 Support Matrix 明示范围，不覆盖 Windows/Linux/macOS x64、任意插件或任意科学任务。永久 `g0:qualification` 与 LF11 requalification 继续优先；任何触发器缺少新证据时 fail-closed。

LF12 完成记录为 [`g0-lf12-baseline-qualification-plan.md`](./g0-lf12-baseline-qualification-plan.md)，报告位于 [`../acceptance/g0-qualification/qualification-report.md`](../acceptance/g0-qualification/qualification-report.md)。

2026-07-24 后续治理收口：新增文档生命周期治理层（[`document-governance.md`](./document-governance.md)、[`worktree-governance.md`](./worktree-governance.md)、[`DOC-REGISTRY.json`](./DOC-REGISTRY.json)、`scripts/docs-governance.mjs`、`npm run docs:status|check|reconcile`，`docs:check` 已接入根 `npm run check`）；注册表中 `G0-LF12` 已收口为 `completed / canonical:false`，释放 `g0-current-work-package` truthDomain。干净 checkpoint 为 `38d3de2`（已推送，工作区 clean）。

Result Studio 旧实现的 11 个提交已于 2026-07-25 fast-forward 合并并推送至 `main`，检查点为 `03e5826`。SDC-0 已在 `codex/g0-sdc` 的 `7284921` 完成并推送；当前单线实现分支为 `codex/g0-result-studio-product`，从该检查点创建，不使用 Git Worktree。当前唯一 active 工作包为 `G0-RS`。

`G0-RS-P0` 已完成资格纠偏：Baseline patch 为 1.1.1，LF12 核心 16/16 evidence 继续 qualified + maintained；`result-studio-editing` 为 experimental/excluded，旧 RS9 product/provider/visual/table-seed 为 non-qualifying historical evidence。Product Trace v1 要求 14 步连续来源证据并拒绝人工布尔值、提示词指定 JSON、测试摘要和常量不变量。证据位于 `acceptance/g0-result-studio/rs-p0-{truth-correction,ui-baseline}.json`。

`G0-RS-P1 Result Surface` 已于 2026-07-25 收口：中央 `ResultStudioCanvas`、紧凑 Inspector/ContextBar、六类 viewer adapter、受控 Artifact URL、无损 Agent 会话投影与 1440/1024/820px 响应式布局已进入同一 `ProjectWorkspace` 状态机。真实开发态 renderer 证据位于 `acceptance/g0-result-studio/rs-p1-result-surface.json`；该证据不升级产品资格。

`G0-RS-P2 Scientific Interaction + SelectionContext` 已于 2026-07-25 收口：完整表权威排序/过滤、18 行视口虚拟化、行列与 query 全选、scatter point/region/legend、matrix gene/sample 选择及缺 mapping 只读均进入同一 Result Studio viewer；持久 selectionId、显式 ID hash 或 query/filter+hash 贯通 Canvas、Inspector、Agent composer 和 SQLite，只有 compatible 选择进入 Agent 上下文。真实 admitted 链为 valid DESeq2 25 Artifact → 3 gene SelectionContext → 独立 R 脚本/参数/gene-list → valid GO/KEGG 36 Artifact，且选择创建早于当前 r-server 进程并成功恢复。10 万行 scroll/select/sort/filter renderer 反馈均低于 100ms；明暗 × 1440/1024/820 六格恢复 3 个勾选且无页面溢出。证据位于 `acceptance/g0-result-studio/rs-p2-{live-observation,ui-observation,scientific-interaction}.json`，为 non-qualifying P2 evidence。日常开发改用 `npm run g0:result-studio:p2:update|p2` 自动验收，Electron/真实 Provider 留给所属阶段出口。

`G0-RS-P3 Agent Context 与 Edit Orchestration` 已于 2026-07-25 完成实现（`implemented_unverified`）：`core/shared-backend/result-studio-context.js` 建立 `ResultStudioContextEnvelope v1` 与 `contextToken`，覆盖 artifact/family、job、revision（含 current 与 ordinal）、脚本相对路径与 sha256、参数摘要、插件可编辑参数与声明动作、selection、validation、reproducibility、workflow 及五阶段公开词表。`core/r-server/agent-tools/result-context-tools.js` 只把前端 `activeArtifact` 当线索，坐标全部从 SQLite/`tool_jobs`/插件 descriptor 重新解析；`result-context-edit-tools.js` 提供 context-bound plan/create/status/compare/adopt/revert 并复用既有 `result-changeset-service` 与 `result-compare-service`，未建立第二套执行真相。模型可见 schema 新增 7 个工具（注册表共 32 个），其中 6 个 `*_in_context` 工具参数不含 toolJobId/artifactId/revisionId/artifactFamilyId/selectionId；系统提示描述当前结果但不写入任何内部 ID，并禁止向用户索要 ID。写操作强制校验 token，陈旧返回 `context_token_stale`，intent 指向别的 Revision 返回 `context_intent_mismatch`；"归因只能到 Job"、跨项目 revision、未打开结果一律 fail-closed。`GET /api/result-studio/context-envelope` 与前端 `fetchResultStudioContext` 共用同一投影，Inspector 的 `ResultStudioContextReadiness` 如实显示 loading/blocked/ready。证据 `acceptance/g0-result-studio/rs-p3-agent-context.json`（20/20，`qualificationEligible: false`，离线契约/注册表/提示词/strict build）；门禁 `npm run g0:result-studio:p3[:update]` 已接入 `g0:result-studio:acceptance` 与根 `check`。P3 验收要求的双真实 Provider tool calling、真实候选 Revision 与重开重建复验尚未执行，UI-108 保持 `in_progress`。

`G0-RS-P4 Core Manual + AI Unified Editing` 已于 2026-07-26 形成稳定实现检查点（`implemented_unverified`）：`core/shared-backend/result-edit-controls.js` 从插件 descriptor 的 `parameters` + `parameterImpacts` 投影控件，不为任何插件手写孤立结果页；缺 impact 声明的参数不提供控件，只有 presentation 组允许标注"不改变科学结论"。`volcano-plot` 的 descriptor 与 `scripts/volcano-plot.R` 补齐配色（`color_up`/`color_down`/`color_ns`）、字体（`base_font_size`/`label_size`）、尺寸（`point_size`/`plot_width`/`plot_height`）、图例（`legend_position`）、标签（`plot_title`）与导出（`export_dpi`）共 12 个 presentation 参数——此前这些全是 R 脚本硬编码；阈值与分类逻辑仍只由 `fc_threshold`/`pval_threshold` 决定。`normalizeEditSubmission` 是手动控件与 AI 提议的唯一归一化闸门，随后共用 `ResultEditIntent → ScientificChangeSet`，validation/preview/compare/adopt/revert 只有一条路径；类型/范围/枚举 fail-closed 拒绝，未声明参数记为 rejected，与当前生效值相同的提交不产出 patch。影响分级只能由受信 descriptor 提升，保护字段只作影响下限。`currentValues` 取自 Job 的真实 `executionProvenance.params.normalized`；`ResultEditPanel` 只发出编辑请求，不写文件也不覆盖 current Revision。证据 `acceptance/g0-result-studio/rs-p4-unified-editing.json`（18/18，`qualificationEligible: false`，离线 descriptor 投影/插件接线/注册表/strict build）；真实手动/AI 候选等价链尚未执行，UI-109 保持 `in_progress`。

用户于 2026-07-26 真实操作确认 P4 Core 的产品投影仍不可接受：结果图片打开时本地后端事件循环多次阻塞约 2.1～8.2 秒；版本区没有可直接查看历史 Revision 的选择器；主体之前堆叠版本/交付/报告与两级导航；参数面板抢占 Agent 主入口；单结果作用域和每版本精确代码入口不清晰。因此正式插入 `G0-RS-P4R Product Reframe`，作为 P5 前唯一允许启动的下一阶段。P4R 依次实施 Truth Baseline/预算、Fast Result Path、Focused Result Surface、Agent-first Editing、Version + Codex-like Change Review、Per-result Code & Reproduce 和整体验收；复用现有 ActiveArtifact/SelectionContext/ContextEnvelope/ChangeSet/Revision/Git/Artifact Truth，不建第二套结果或版本真相。详细计划见 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) §P4R；P4R 未收口前不得启动 P5～P7。

`SDC-0 Profile Registry 与版本治理` 已于 2026-07-25 收口：`core/shared-backend/artifact-profiles.js` 从单个 DEG 种子升级为正式 Registry，落地 `biof3.counts-matrix.v1`、`biof3.sample-metadata.v1`、`biof3.expression-matrix.v1`、`biof3.deg.v1`、`biof3.gene-list.v1`、`biof3.enrichment-table.v1` 六个 canonical Profile，并区分 data / artifact / display 三类 Profile Kind。新增 profile 身份解析、registry 校验、contract digest、compatible/migration/breaking 变更分级和 fail-closed 兼容判定；`core/shared-backend/agent-workflow.js` 对未注册 Profile 返回 `unregistered_artifact_profile`，使其无法成为 typed DAG 正式边。`biof3.deg.v1` 及其 legacy alias（含 `log2FC → log2FoldChange`）保持向后兼容，未创建第二套执行真相。

SDC-0 证据与门禁：`acceptance/g0-scientific-data-contract/profile-registry.json`（10/10，锚定 `03e5826`）、`test/g0-sdc0-profile-registry.test.mjs`（7/7）、`scripts/g0-sdc0-profile-registry-acceptance.mjs`，命令 `npm run g0:sdc0`（含 `g0:sdc0:test`）已挂入 `postcheck`。实测 `npm test` 1339 pass / 0 fail / 11 skipped，`npm run check` 全绿（末尾 `[G0-SDC0] PASS — 10/10`）。SDC-0 只完成离线契约层，真实不规则数据端到端产品验收属于 SDC-7，不得由本阶段冒充。

`SDC-1 Data Profiler`～`SDC-7` 均 deferred；待 `G0-RS-P7` 重新资格完成后再评估恢复，不得与 Result Studio 并行实现。

已收口阶段：

- `G0-RS0` 只读审计与 ADR —— [`g0-rs0-result-studio-audit.md`](./g0-rs0-result-studio-audit.md)，含 6 条 ADR 与 3 项计划契约缺陷登记（`validationStatus` 词表冲突归 RS2、`sourceScriptRef` 语义归 RS5、`ActiveArtifact` 文件级归 RS3）。
- `G0-RS1` Git Adapter 与 Repository Binding —— 新增 `core/shared-backend/git-adapter.js`（系统 git CLI 单一边界，无 git 库依赖）与 `core/shared-backend/git-repository-binding.js`（managed / existing 双模式）。门禁 `npm run g0:result-studio:git` 实测 24/24，已接入根 `npm run check`。

RS1 已固化的边界：整树 pathspec（`.`/`-A`/`-u`/`*`/`:` 等）在 Adapter 层结构化拒绝；选项形参数、pathspec magic、`..` 逃逸、越界绝对路径同样拒绝；提交走 `--only` + 显式 pathspec，不携带其他已暂存内容；托管模式 git 元数据落 `<workspace>/.biof3/git`，绝不对用户目录 `git init`；既有仓库模式下受管理路径与用户未提交改动相交即 `blocked_dirty_conflict`，不 stash、不覆盖；index.lock、merge/rebase/cherry-pick 中途态、submodule、linked worktree 一律先阻断；git 缺失或低于 2.20 时诚实 `blocked_git_unavailable`；诊断输出脱敏绝对路径与疑似凭据。

RS1 实测修正的一个真实缺陷：`git status --untracked-files=normal` 会把完全未跟踪目录折叠成单条（新建 `analysis/scripts/x.R` 只报告 `analysis/`），导致受管理路径下的用户新建文件漏判。冲突检测已改为 `untracked='all'` 并使用双向前缀匹配。

- `G0-RS2` Revision Contract 与持久化 —— 新增 `core/shared-backend/result-studio-schema.js`（5 张新表 DDL 的唯一来源）、`result-studio-contracts.js`（ChangeSet / ArtifactRevision / SelectionContext / WorkspaceCheckpoint v1 校验与状态机）、`result-studio-repository.js`（CRUD、状态迁移、幂等 adopt/revert、可达性），以及项目首个正式 migration `src/migrations/001_result_studio.sql`。聚合门禁 `npm run g0:result-studio` 实测 78/78，已接入根 `npm run check`。

RS2 已固化的边界：`validationStatus`（valid/degraded/blocked，来自 `reconcileArtifactTruth`）与 `reproducibilityStatus`（unavailable/available/verified，来自 delivery manifest）是两个独立字段，不合并成一套词汇；`validationStatus='valid'` 的 Revision 必须绑定 `toolJobId`，守住 `run_tool → tool_job → artifact truth`；含 `blocked` Revision 的 ChangeSet 不可采用；ChangeSet 只能以 `draft` 创建，不能凭空造出 `adopted`；`adopted → reverted` 合法（撤销已采用），`reverted`/`abandoned` 为完全关闭态；同 family 的当前版本由 partial unique index 在库层保证唯一，不存在两个"当前版本"；adopt/revert 同状态重放幂等；大于 2000 个实体的选择必须携带 `filterExpression` 才可持久化，计数如实反映真实规模。

RS2 实测修正的两个真实缺陷：其一，`canTransitionChangeSet()` 返回 `{allowed,...}` 对象，而三处守卫写成 `!canTransitionChangeSet(...)` —— 对象取反恒为 false，状态机守卫完全失效、放行所有非法迁移（含跳过预览直接采用）；已改为读 `.allowed`。其二，可达性分析无条件保护每个 family 的 ordinal 1，导致"用户新建 family 后放弃"的孤立 Revision 永久占盘；已改为仅当该 family 存在 current 或 adopted Revision 时才保护原始版本。

migration 现状更正：RS0 审计称 `src/migrations/` 只有 `.gitkeep`，实际该目录**根本不存在**，`runMigrations()` 因 `readdirSync` 抛错走 catch 分支静默返回，从未真正执行过。RS2 已建立该目录与首个 migration，并用 `test/result-studio-migration.test.mjs` 覆盖空库首装、重复执行幂等、已有库升级不动现有表、坏 SQL 事务回滚且不记版本、缺目录静默 no-op、`BIOF3_BETTER_SQLITE3_ROOT` ABI 路径，以及 `.sql` 与 schema 模块逐字节一致。

- `G0-RS3` Artifact Interaction 与 Selection Context —— 新增 `core/shared-backend/artifact-interaction.js`（稳定实体 ID 判定、表格/图形交互清单、选择解析与有界 Agent 摘要）、`core/r-server/routes/result-studio.js` 与 `frontend/src/lib/artifact-selection.ts`；`ActiveArtifact` 从文件级升级为 revision / semantic / selection-aware。该阶段建立的契约基础已由 `G0-RS-P2` 完成真实表/图交互、耐久恢复、下游链和视觉/性能复验，UI-102/UI-107 现按 P2 窄范围 `verified`，不外推 P3～P7。

RS3 已固化的边界：交互清单只能由**后端基于完整文件**产出，浏览器侧 40 行预览样本（`buildPreviewTable`）无权判定稳定 ID 列，前端只消费不自建第二套判定；`idStrategy='positional'` 时 `selectionDurable` 必须为 false，绝不把行号伪装成实体身份，且交互能力里不含 `row_select`；声明的 ID 列若在抽样中实测不唯一则拒绝采用并回退 positional，不产出错误的实体映射；超过阈值的选择以 `filterExpression` + hash 为权威表达，`entityIds` 只作抽样证据，计数如实反映真实规模；给 Agent 的摘要恒定有界且不可持久时必须带 caveat。

RS3 实测修正的三个真实缺陷：其一，我在路由里使用了 `app.locals.requireAuth` 与 `require('../db')` 直接当句柄 —— 前者在 `core/` 中**根本不存在**（桌面版 loopback 单用户，鉴权由全局 `localIdentityMiddleware` 注入 `req.user`），后者是模块对象而非 better-sqlite3 实例；两者都会让整个模块被 `routes/index.js` 的 try/catch 静默吞掉、6 个端点变成死代码，已改为裸注册 + 内联 `canAccessProject` + `require('../db').db` + 惰性仓库。其二，`ActiveArtifact` 的身份比较原本只比 `jobId + name`，导致"同一文件换了版本"或"用户改了选择"无法向上传播，已扩展为覆盖 revision / entityType / idField / selection。其三，前端 hash 不能冒充 sha256（浏览器无同步 sha256，`crypto.subtle` 是异步的），已改为 FNV-1a 双种子并在命名上不声称加密强度。

`G0-RS4` 已收口：`result_edit_plan` 能基于真实 Job/Artifact/provenance 和显式 DAG 生成 `ResultEditIntent v1`；插件无受信影响声明时未知参数保守进入科学重算，来源/脚本/输入/Revision/DAG 任一缺失即阻断。

`G0-RS5` 已收口：真实 valid Job Artifact 首次进入 Result Studio 时建立确定性 baseline v1 并把 `revisionId/artifactFamilyId` 投影回 `ActiveArtifact`；AI 与手动编辑共用 ChangeSet 服务，在 `.biof3/revision/<changeSetId>` 私有 staging 中派生独立脚本/参数，通过临时 Git index 生成不触碰工作树的 candidate commit，再复用正式 `run_tool → tool_job → artifact truth` 执行并登记 v2。候选仅为 `preview_ready/adopted:false`；失败、取消、并发冲突和恢复扫描均不改变 current。`result_edit_progress` 已接入 SSE 与前端有界 run store（UI-103 仍为 `in_progress`，待真实长修改失败/取消/历史恢复矩阵）。

`G0-RS6` 已收口：同一 Revision/ChangeSet 真相提供有界文本、JSON、表格与图像比较；Git current ref CAS 与 SQLite current 指针在一个 fail-closed 操作中切换，baseline 不可撤销，历史恢复生成新 commit/ChangeSet/Revision 而不改写旧版本。结果侧栏默认紧凑，展开后提供前后图、语义/字段/文本 diff、history 与折叠 Git 信息；真实隔离链已完成 v1 → 采用 v2 → 撤销 v1 → 恢复 v3，明亮/夜间/820×900 通过，UI-104 `verified`。

`G0-RS7` 已收口：Result Studio Plugin SDK v1 对 descriptor 与 golden Revision 执行 fail-closed lint；DESeq2、volcano、gene-correlation heatmap、GO/KEGG 的 12 个正式 table/plot 全部映射，每个 required file input 都有 Artifact binding。RS5 的 canonical `analysis/scripts/<family>/<revision>/<artifact>.R` 继续保证每个正式结果独立脚本，不拆分插件执行器、不建立插件内版本系统。相同 major/contract 的历史可读，漂移要求迁移，缺迁移时显式 `read_only_legacy`。下一阶段：`G0-RS8` 耐久恢复、性能与存储治理；不得提前实现 RS9 基线晋升。

`G0-RS8` 已收口：每个 ChangeSet 阶段持久化 WorkspaceCheckpoint；重启后只在 candidate ref、Revision、completed Job 与 valid Artifact Truth 全部一致时自动恢复 preview。Git/SQLite/Artifact 漂移分类为自愈或阻断；存储摘要、content-addressed hardlink 去重和 plan-token GC 均不删除正式 Artifact/Revision 历史。大表通过 1 MiB 有界 byte cursor 渐进加载，preview Job 受真实资源快照和并发预算约束且不修改科学参数。UI-105 功能完成但待 RS9 真实重启/大表/视觉矩阵，保持 `in_progress`。下一阶段：`G0-RS9` 真实产品验收与基线晋升。

`G0-RS9` 历史实现保留，但资格结论已撤销：复核确认 5 条任务由独立单测/fixture/截图拼装，Provider 探针没有执行真实 Result Studio tool calling，大表由 seed 直接构造数据库记录，视觉脚本主要消费人工 inspection 布尔值。证据继续位于 `acceptance/g0-result-studio/rs9-{product,provider,visual}-acceptance.json` 与 `rs9-ui/`，但只按 unit/synthetic/renderer historical evidence 使用。UI-102/UI-103/UI-105 回退 `in_progress`；UI-104 仅保留窄范围版本操作验证。

Result Studio 新顺序为 `RS-P0 Truth Correction → P1 Result Surface → P2 Scientific Interaction → P3 Agent Context → P4 Core Unified Editing → P4R Product Reframe → P5 Real Scientific Editing → P6 Durability & UX → P7 Requalification`。完整范围和阶段验收见 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) §22～§26。

### 3.1 已完成基线：真实科学任务驱动的 Harness 升级

用户已确认 Harness 应承担“把模糊科学需求转化为数据语言、可执行计划、验证证据和交付结果”的工程职责，而不是收集每一个分析需求点。当前采用增量升级，不重建 P-02 执行真相，不新增第二套 executor、job、artifact 或 workflow truth。

正式计划：[`harness-scientific-task-contract-plan.md`](./harness-scientific-task-contract-plan.md)。HRT-0 至 HRT-7 已完成。HRT-7 新增统一 `npm run harness:scientific-task` 离线聚合门禁，证据为 `acceptance/harness-scientific-task/hrt7-scientific-task-gate.json`；HRT-6 的持久化 ContextCheckpoint、ReplayPackage v1、逐 artifact 入口、五类漂移分类、真实离线 R 重放和数据库外接手仍由 `hrt6-replay-acceptance.json` 证明。UI-050 已实机点击导出 6 个逐产物入口/18 文件任务包，旧任务缺 checkpoint 时显示“历史部分可用”，控制台 0 error。后续运行控制面继续保持 `run_tool → tool_job → artifact truth` 唯一执行真相。

用户已确认 [`harness-loop-engineering-plan.md`](./harness-loop-engineering-plan.md) 是 P-03 Harness 的增量升级而非并行系统；HLE-0～HLE-6 当前已完成并成为长期基线。Loop 负责观察、决策、验证、修复、重规划、恢复和终止，继续复用现有 TaskSpec/DAG/Plugin/Job/Artifact/Delivery/Replay。任何 Agent 不得把它扩展为第二套 executor、job 表、artifact 仓库或 workflow truth，也不得让模型口头“完成”替代确定性和科学验证器。

2026-07-24 HLE-C0～HLE-C5 已完成：生产 Agent loop、真实 Job/Artifact Validator/Diagnoser/Repair、耐久恢复、UI-101、SPT-1 七节点三轨、双 Provider、应用重启、Delivery/Replay 和明暗/820px/停止恢复视觉矩阵均已验收。证据位于 `acceptance/harness-loop/production/`。G0-START / G0-LF0 已在此基础上关闭；HLE 作为长期不变量继续存在，不重开第二套 executor、Job、Artifact 或 workflow truth。

Post-HRT 运行控制面已于 2026-07-22 增加通用 `workspace_exec`、RuntimeResourceSnapshot v1、AI usage cache/cost 字段、设置页“用量与资源”、会话资源摘要和重启中断 Job 的 `recovery_required_after_restart` 投影。用户随后明确完全访问模式不应再受固定命令白名单限制：`accessMode=full` 现在从项目目录启动真实 shell，支持系统现有命令、脚本、管道和重定向；`read` 仍在 policy 与 handler 两层禁止执行。UI-051 真实项目/820px 窄窗验收通过，低内存能正确显示“资源不足”，控制台 0 error。Job 只记录开始/结束主机快照，真实进程峰值仍标记 `unavailable_without_process_sampler`，不得冒充已完成峰值采样。

UI-053 已补齐右侧文件面板实时一致性：Agent workspace 写入/替换/命令成功后广播项目刷新，文件页可见时以 2 秒轻量轮询覆盖终端与外部编辑器；展开目录自动收敛，活动预览只在 size/modifiedAt 改变时使用版本 URL 重读，Harness 文件摘要以 10 秒周期更新。真实临时项目验证了“已打开内容变化 + 新文件出现”均无需点击，控制台 0 error，验收数据已清理。

UI-054 已补齐并完成真实 Provider 验收：模型自然返回无工具最终答复时，若正文为空、响应非法或仍意外请求工具，会额外进行至多 1 次无工具整理请求；可重试的暂时性 Provider 错误则重试当前阶段。前端显示自动重试状态，且任何重试都不会重复执行已经完成的工具。两次仍无正文时保留工具结果，并明确提示用户可基于当前会话继续，不再要求重新描述需求。持久化消息 meta 记录 finalization attempts/recovered/failureReason；2026-07-23 真实 Provider 已覆盖连续空答复失败与第 2 次整理恢复，状态为 verified。

UI-035 已完成多轮工具体验收敛与实机验收：模型在工具批次前输出的用户可见阶段说明通过 `agent_progress` 固化，下一 iteration 不再令其消失，并随 assistant `meta_json.progressUpdates` 永久恢复；这只保存公开正文，不采集隐藏推理链。工具活动默认仅显示动作分类、数量和总耗时，点击后才展开紧凑单行明细。2026-07-23 Ark 真实长任务已覆盖 28 轮、32 次工具调用及历史重开，状态为 verified。

### Stage 4 之后的 Harness 工程主线

用户已于 2026-07-19 明确启动 Phase 7「通用基础工具与运行控制面」。这不重开已关闭的 Stage 3，也不增加分析流程；它是在 Stage 4 RC 基线之上的平台工程增量。

- 提交 `cec2c58` 已加入 7 个项目级文件/短命令工具并推送；开发壳已确认加载工具。
- P7-A 真实 Provider 基线验收已完成：DeepSeek `deepseek-chat` 与自定义 OpenAI-compatible `gpt-5.6-sol` 使用同一 8 场景矩阵，均为 8/8 PASS。
- 脱敏证据位于 `acceptance/harness-phase7/provider-baseline.{json,md}`；仅使用临时 fixture workspace，不含用户文件正文、凭据、请求头或完整 Provider 响应。
- 后端安全探针确认只读模式阻断 write/replace/exec/run，敏感/绝对/逃逸路径被拒绝，sudo、删除、git push 与远程脚本管道被拒绝；普通 `rm` 缺口已最小修复。
- P7-B 工具契约与注册表已完成：18 个模型可见工具的 definition、handler 与内部 contract 已收敛到 `agent-tools/registry.js`，模块加载时校验重名、定义/handler 漂移和非法元数据；`getToolDefs()` 只输出不含内部字段的 Provider-safe schema。
- dispatcher 已从注册表解析完整 entry，4 个退役学习工具保持不可见、不可由 Agent dispatcher 调用。
- P7-C 统一 Policy/Interceptor 已完成：schema 校验、workspace preflight、纯 `allow | deny` 执行决策和原 handler 调用形成统一后端链；handler 侧权限、路径、symlink、命令、大小和并发检查继续保留。
- 覆写已有文件与精确替换必须携带匹配的 `expectedSha256`；新文件使用原子 create-only 发布，同进程修改按目标串行化并在发布前复核 SHA。Phase 7 关闭时 `workspace_exec` 曾仅允许 `pwd`，该历史边界已被 2026-07-22 的完全访问产品决策替代；`run_tool(op=run)` 仍复用真实 pending `tool_job + ackToken`，workflow recovery token 与 `act` 执行后 ACK 未改义。
- P7-D 结构化结果、Trace 与前端呈现已完成：task/legacy loop 共用版本化 ToolResult envelope 与兼容 SSE 投影，`traceId/callId`、真实状态、termination reason、耗时、截断和副作用摘要贯穿；旧 `dispatchTool()` 与审批/Act 扁平字段保持兼容。
- Trace 仅保留容量 200、TTL 15 分钟的进程内脱敏摘要，不持久化原始参数、文件正文、命令输出或凭据。SimpleChat 按 `callId` 幂等显示运行/等待确认/成功/失败/拒绝、耗时、截断、拒绝原因和实际副作用；task 回放不重复，停止订阅不伪装工具已取消。只读 operation 不继承静态最大能力，待审批仅报告实际创建的 pending `tool_job`。
- P7-D 自动化证据：`agent-tool-result.test.mjs` 6/6；前端 SSE parser 与活动状态 7/7；后端 P7-D + 既有审批 + diagnostic redaction 回归保持通过。UI-034 已于 2026-07-21 完成开发壳明暗/窄窗/折叠/回放实机矩阵并标记 `verified`。
- P7-E 受控编辑补强已完成：`workspace_write` / `workspace_replace` 支持真实 `dryRun`，仍执行授权、路径、SHA、overwrite、大小和唯一匹配检查，但不创建工作区根目录、目标父目录、临时文件或目标文件；尚不存在的工作区返回 `workspace_unavailable`。成功结果在保留旧字段的基础上追加 `dryRun` 和仅含相对路径及前后 hash/bytes/lineCount 的 `changeSummary`。
- write/replace 已共用同目录原子发布函数；保留同进程目标锁、发布前 SHA 复核与 create-only hard-link。临时文件在 `finally` 中 best-effort 清理，常规冲突回归验证无残留；极端文件系统清理失败不作绝对保证。该边界不宣称跨进程 CAS。成功 dry-run 在只读上下文可执行并由 ToolResult 报告 `none/R0`；真实编辑继续为 `workspace-write/R2`。
- P7-E 定向证据：workspace handler、policy/interceptor 与 ToolResult 三文件合计 32/32，0 fail；覆盖 absent-root 零创建、dry-run 不落盘、授权/敏感路径/symlink/overwrite/stale SHA/唯一匹配、旧字段兼容及真实写入副作用。没有实现 `workspace_patch`，因为尚无 Provider 证据证明现有精确编辑不足。
- P7-F 后台任务 decision gate 已于 2026-07-20 完成：P7-A–D 前置条件满足，集成终端的 Agent 查询/停止缺口成立，但严格合格的真实 `>30s` 非科学 Agent 任务为 0/3，因此 AND gate 不成立并标记 `deferred`；未新增 `workspace_process_start/check/stop`。
- P7-G 上下文效率与 Provider 稳定性已完成：模型侧按 list/find/search/read/write/replace/exec 类型投影，硬截断保持有效 JSON，`modelContext` 暴露原始/投影字符数与压缩/去重状态；原始 handler result、ToolResult envelope 和 SSE 不压缩。read 只在 `projectId + traceId + path` 内提交实际入模范围，Trace entry 携带 `projectId` 并支持精确过滤。
- task 与 legacy Agent loop 已统一为目标驱动：正常路径不设置 iteration 或工具调用总量上限，模型在用户目标和真实产物完成后自然返回最终答复。用户取消、确认门、工具/Provider 问题会暂停或停止；相同工具与相同参数连续出现第 3 次时判定为异常循环，该次不执行并强制生成诚实的阻塞说明。批次仍严格 reserve，只把已接受调用及其配对结果写入 history。malformed JSON、数组/null 参数和跨轮重复或碰撞的 Provider/protocol call ID 均结构化拒绝且不执行 handler，协议 history 始终使用请求级唯一 ID并保留原始 `providerCallId`。观察到取消后不再启动剩余 handler 或下一轮 Provider 请求；当前没有公共 `AbortSignal`，因此不声称中断已开始的 handler。
- P7-G 定向证据：`agent-tool-result.test.mjs` + `agent-provider-boundary.test.mjs` 覆盖按类型压缩、有效 JSON、原始 ToolResult 截断语义、read 去重、Trace 项目隔离、无正常轮数/调用数上限、连续相同调用异常熔断、可注入测试保护上限、非法参数、跨轮 call ID 碰撞、协议配对与取消边界。
- P7-H 已于 2026-07-21 完成：单一零网络、零凭据的 `npm run harness:phase7` 已接入 CI，实测 manifests 7/7、Phase 6 tests 64/64、Phase 7 核心 tests 68/68、离线临时真实 workspace 产品检查 13/13，全部 0 fail；脱敏证据位于 `acceptance/harness-phase7/product-acceptance.{json,md}`。
- Phase 7 已关闭。P7-A live Provider 双目标继续保持 8/8 人工证据；P7-F 保持 `deferred`；UI-032/UI-033/UI-034 已实机关闭。下一步观察 rc.7 发布反馈，不默认扩展 Phase 7。
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

当前没有待执行的发布动作。UI-032 已完成真实 capability bundle 设置页验收；下一步观察 rc.7 真实使用反馈。签名/公证不属于本项目必需条件；当前 OSS 分发仅表示技术链路可用，本 RC 距离正式产品上线仍有较大距离。

### 已拆分给独立 Agent 的专项

`[P-02 工具执行、Job 与 Artifact Truth]` 项目工作路径结果沙盒 Phase 0–5b 已完成实施（resolver + R/Python/MCP 收敛 + 测试），记录见 [`project-result-sandbox-plan.md`](./archive/checkpoints/project-result-sandbox-plan.md)。

当前结论：项目作用域的 R/Python/MCP/Agent Workflow 已统一透传 `projectId`，由后端解析到 `workspace_path/results/jobs/<toolJobId>`；无项目的兼容任务仍保留显式全局落点。不得建立第二套结果系统、自动移动历史结果或删除用户外部工作目录。

## 4. 发布与安装状态

主模块：`P-06 桌面集成与交付`。

- 当前代码、Git 标签与 OSS 线上版本：`v0.0.1-rc.7`（发布提交 `ab519fa`）。
- 默认平台：macOS-only；构建 arm64/x64。
- GitHub：只保存源码和不可变标签，不上传 DMG。
- OSS：保存双架构 DMG、SHA-256 清单和 `latest-mac.yml`。
- 更新方式：检查 OSS → 下载匹配架构 DMG → 大小/SHA-512 校验 → 打开 DMG → 成员手动拖入 Applications。
- 本项目当前不以 Apple Developer ID 签名/公证作为上线条件；安装仍保留人工打开与拖入 Applications 的边界。
- `rc.4 → rc.7` 已完成更新选择、公开下载、大小/SHA-512 校验、DMG 只读挂载和包内版本/架构确认；rc.7 的公开 `latest-mac.yml` 与 SHA-256 清单已反向核验。
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
