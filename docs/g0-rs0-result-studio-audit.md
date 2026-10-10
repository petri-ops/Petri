# G0-RS0 — Result Studio 现状审计与架构决策记录

最后更新：2026-07-24

计划编号：`G0-RS0`（隶属 [`g0-result-studio-plan.md`](./g0-result-studio-plan.md) `G0-RS`）

状态：`completed`（只读审计，未修改任何生产代码）

分支：`codex/g0-result-studio`，base commit `0f1b257`

主模块：`W-04 结果与报告`

本文件是 Result Studio 的 canonical 架构决策来源。RS1～RS9 实施时若与本文件冲突，先修改本文件再实施，不得在实现中另立架构。

## 1. 审计范围与方法

只读审计，覆盖 RS 计划要求的六个方面。所有结论均定位到具体文件与符号，未修改代码、未创建表、未执行任何 Job。

## 2. 现状审计结论

### 2.1 结果查看 UI

| 项 | 现状 |
| --- | --- |
| 主渲染组件 | `ResultArtifactShell`，位于 `frontend/src/pages/project-workspace.tsx`（单文件 4509 行） |
| 状态载体 | `ActiveArtifact = { jobId, toolId, name, type, label?, url? }` |
| 状态流向 | `project-workspace` 持有 → `centerPanelCtx` / `rightPanelCtx` 下传 → `CenterPanel` / `RightPanel` → `ResultArtifactShell` → effect 反向 `onActiveArtifactChange` 回写 |
| 分类层 | `frontend/src/lib/result-manifest.ts`：`ResultArtifactKind = report\|plot\|table\|text\|data\|file`、`classifyArtifact`、`normalizeResultManifest`、`buildResultArtifactNavigation`、`pickPreferredArtifact` |
| 预览分派 | `renderPreview()`：report → 不内嵌（引导生成最终 HTML）；plot → `<img>` + lightbox；CSV/TSV → 表格，硬上限 40 行解析 / 24 行显示；JSON → 格式化文本；text/md/log → `<pre>`；其余 → 不支持提示 |
| 数据来源 | `GET {apiPrefix}/tools/status/{jobId}` 取 `result`；文件走 `{base}/tools/file/{jobId}/{name}?token=`；manifest 优先 `result.manifest`，否则 fetch `manifest.json` |

**关键结论**：`ActiveArtifact` 是**文件级**标识，不含 `revisionId`、`semanticType`、实体 schema 或选择状态。RS3 的"activeArtifact 升级为 revision/semantic/selection-aware"是对这个类型及其全部流转路径的改造，不是新增旁路。

### 2.2 Artifact Truth

| 项 | 现状 |
| --- | --- |
| 唯一实现 | `core/r-server/helpers/artifact-truth.js`，`reconcileArtifactTruth()` |
| 三态 | `blocked`（有 error 级 issue）/ `degraded`（有 issue 无 error）/ `valid` |
| 诊断码 | `required_artifact_missing`、`artifact_missing`、`required_artifact_empty`、`artifact_empty`、`artifact_type_mismatch` |
| 落盘登记 | `core/r-server/helpers/tools-executor.js` → `executeJob()`：reconcile → `buildProvenance` → `attachProvenanceToResult` → `writeArtifactManifest` → `UPDATE tool_jobs SET status='completed', result_json=?` |
| 磁盘镜像 | `output/artifact-manifest.json`（`core/shared-backend/artifact-manifest.js`，v1） |
| lineage | `core/shared-backend/execution-provenance.js`：`provenanceHash`、`script{snapshotPath,sha256}`、`params{normalized,sha256}`、`inputs[{sha256,sourceArtifactRef}]`、`artifacts[{sha256,reproductionTarget}]` |

**关键结论**：**数据库里不存在任何 artifact 表**。全库 `CREATE TABLE .*artifact` 零命中。artifact 的唯一登记面是 `tool_jobs.result_json` 中的 JSON。因此 Result Studio 的版本图在 DB 层是完全新增的，而不是给现有表加列。

现有唯一跨 job lineage 指针是 `inputs[].sourceArtifactRef`。

### 2.3 路径解析

`core/shared-backend/project-run-layout.js` 的 `resolveProjectRunLayout()` 是唯一解析器，无第二条路径：

```text
<project.workspace_path>/
└── results/
    ├── exports/                      # 跨 job 共享导出
    └── jobs/<toolJobId>/
        ├── inputs/  work/  output/  logs/
```

内建约束：项目必须 active、`assertProjectG0Compatible` 必须通过、owner 或 admin 权限、workspace 可写。另有 `isPathContained` / `safeJoinUnder` 防逃逸，以及 `restoreLegacyJobLayout`（只读历史路径，不搬迁）。

调用点：`tools-executor.js`、`py-server/tools-router.js`、`mcp/registry.js`、`routes/harness.js`。

### 2.4 ReplayPackage 与 DeliveryManifest

两者均为 v1 且已实装。`scientific-replay-package.js` 已捕获脚本快照、参数哈希、输入哈希、runtime、`provenanceHash`，并定义了 6 类漂移（`input_drift`、`environment_drift`、`plugin_drift`、`parameter_drift`、`execution_failure`、`artifact_drift`）。硬前置：`job.status==='completed'` 且 `artifactTruth.status==='valid'`，脚本快照必须存在且哈希未漂移。

`delivery-manifest.js` 的 artifact 级 `reproducibility.status` 为 `unavailable | available | verified`。

**关键结论（契约缺陷）**：RS 计划 §6.5 定义 `ArtifactRevision.validationStatus: 'valid'|'degraded'|'blocked'|'unavailable'`，把两套不同词汇混成一个枚举——前三个来自 `artifactTruth.status`，`unavailable` 来自 `reproducibility.status`。**决策：RS2 拆成两个字段**，`validationStatus`（valid/degraded/blocked，复用 artifactTruth）与 `reproducibilityStatus`（unavailable/available/verified，复用 delivery manifest）。不新造第三套状态词汇。

### 2.5 Plugin SDK 与 job_dir 协议

`core/shared-backend/plugin-sdk.js` v1：`ARTIFACT_TYPES = {plot,table,text,json,html,file,log}`，`validatePluginCandidate()` 校验 inputs/artifacts/failureModes，来源优先级 `builtin:10 < installed:20 < development:30`。

job_dir 执行协议（事实定义在 `tools-executor.js`）：脚本以 `argv[1] = jobDir` 单参调用，`cwd = jobDir`；产物写 `jobDir/output/`；`run-script.R|py` 从插件模板复制进 `jobDir` 并**永久保留**；`provenance.json` 落 `jobDir`，`artifact-manifest.json` 与 `run.log` 落 `output/`。

**关键结论**：RS 计划的"每个正式图表有独立可执行脚本"**部分已存在**——每个 job 已永久保留一份可执行脚本快照。但那是**插件 canonical 脚本的整体副本**，粒度是 job，不是单个图表；且它不接受用户/AI 的参数改写。RS5 的真实增量是"从 job 级脚本快照派生出图表级、可改写、可重跑的项目内脚本"，不是"从零建立脚本保留机制"。

### 2.6 migration 机制

`src/migration-runner.js`：`schema_migrations(version, applied_at)`，扫 `migrationsDir/*.sql`，命名 `NNN_description.sql`，每个文件包在 `db.transaction` 内。注册点在 `src/main.js`，通过 `spawnSync` 以外部 Node（`ELECTRON_RUN_AS_NODE=1`，受 `PETRI_BETTER_SQLITE3_ROOT` 控制）执行，用于规避 Electron/Node ABI 冲突。

**现状**：现有全部 schema 都写在 `core/r-server/db.js` 的命令式 `CREATE TABLE IF NOT EXISTS` + `try { ALTER TABLE } catch {}` 里。

> RS2 更正（2026-07-25）：RS0 原记为「`src/migrations/` 只有 `.gitkeep`」，实测该目录**根本不存在**。`runMigrations()` 的 `readdirSync` 会命中 `catch` 分支并直接 `return applied`，因此 migration 机制此前是**静默 no-op**，连"目录为空"的日志都不会产生。结论方向不变（runner 从未被真实使用），但失效方式比原描述更彻底。目录已由 RS2 建立并投入使用。

### 2.7 Git 可用性

| 项 | 结论 |
| --- | --- |
| 系统 git | `git version 2.50.1 (Apple Git-155)`，可用 |
| git 库依赖 | `simple-git` / `isomorphic-git` / `nodegit` / `dugite` **均无**，根与 core 的 package.json 都没有 |
| 现有 git 代码 | 零。全仓库无 `git-adapter` / `gitAdapter` 实现 |

### 2.8 已确认不存在的实现

`ResultStudio`、`ArtifactRevision`、`ChangeSet`、`SelectionContext`、`git-adapter` 在 `.js/.ts/.tsx` 源码中**零命中**，仅出现在计划文档。RS 是全新建设，无历史实现需要兼容或替换。

## 3. ADR-RS-1：Git-backed + Artifact Store 双层版本架构

### 3.1 决策

采纳双层分工，与 RS 计划 §5.1 一致，并按本次审计补齐落点：

| 层 | 负责 | 物理位置 | 不负责 |
| --- | --- | --- | --- |
| Git | 脚本、参数、流程定义、结果清单的文本版本与 diff、commit、ref、恢复 | `<workspace>/.petri/git`（Petri 托管）或用户既有仓库的显式路径子集 | 科学有效性、大型数据 |
| Artifact Store | 科学产物本体、hash、三态、lineage、验证 | `<workspace>/results/`，沿用 `resolveProjectRunLayout` | 文本编辑体验 |
| SQLite | 索引、查询、UI 投影、选择状态、映射 | `petri.db` 新表 | 替代 Git 或文件本体 |
| Harness | 意图、分类、规划、执行、恢复 | 现有 Loop/Task 链 | 自造执行真相 |

### 3.2 复用 vs 新增

**复用，禁止替代**：

- `resolveProjectRunLayout()` — 所有 RS 路径必须由它派生，`.petri/` 与 revision 目录都锚定 `workspaceRoot`，并继续走 `isPathContained` 校验。
- `reconcileArtifactTruth()` — 每个新 Revision 的 `validationStatus` 必须由它产出，RS 不得自行判定 valid/degraded/blocked。
- `run_tool → tool_job → artifact truth` — 任何 `presentation_rerender` 及以上分类都必须创建真实 `tool_job`。
- `execution-provenance.js` / `artifact-manifest.js` / `delivery-manifest.js` / `scientific-replay-package.js` — Revision 的 provenance 直接复用，不新建并行 provenance。
- 现有表：`tool_jobs`、`projects`、`scientific_task_specs`、`context_checkpoints`、`loop_*`。

**新增（5 张表，全部为新，不改现有表结构）**：

`scientific_change_sets`、`artifact_revisions`、`result_selection_contexts`、`workspace_revision_checkpoints`、`git_repository_bindings`。

### 3.3 ADR-RS-2：新表用正式 migration 文件

**决策**：RS 的 5 张新表使用 `src/migrations/001_result_studio.sql`（及后续编号），不沿用 `db.js` 的内联 `CREATE/ALTER` 惯例。

理由：RS 表承载版本与恢复语义，需要可审计的版本号、事务边界和失败回滚；`try { ALTER TABLE } catch {}` 无法表达"这次升级是否成功"。

**风险与缓解**：migration runner 已接线但**从未被真实使用过**（目录为空）。因此 RS2 必须包含 runner 首次使用验证：空库首装、已有库升级、事务回滚、以及 `PETRI_BETTER_SQLITE3_ROOT` 下的 ABI 路径。不能假设它开箱可用。

### 3.4 ADR-RS-3：Git 通过 CLI Adapter，不引入 git 库

**决策**：以子进程调用系统 `git`，全部命令由单一 Git Adapter 生成；不引入 `simple-git` / `isomorphic-git` / `nodegit` / `dugite`。

理由：系统 git 2.50.1 已可用；新增原生依赖会再次引入 Electron ABI 与打包体积问题（项目已有一次 native 架构错配事故）；纯 JS 实现（isomorphic-git）在大仓库和既有用户仓库上语义偏差风险更高。Adapter 集中化同时满足计划"UI 和 Harness 不直接拼 shell"的要求。

**边界**：git 不可用时必须诚实阻断正式采用，不静默降级为不可恢复编辑。随应用分发受控 git runtime 属于产品阶段，RS1 只做 readiness 检测。

### 3.5 ADR-RS-4：UI 从巨型页面切分

**决策**：RS UI 落在 `frontend/src/components/result-studio/`，`ResultArtifactShell` 从 `project-workspace.tsx` 抽出。抽出作为 RS6 的前置动作，不与功能开发混在同一提交。

**已知冲突**：本地分支 `codex/fix-collapsed-right-titlebar`（`23705a3`，AUDIT-LOG 标"待人工评估"）修改右侧标题栏折叠，与 RS6 的右侧结果区改造直接冲突。**必须在 RS6 动 UI 之前合掉或明确丢弃**，否则该分支永久烂掉。

## 4. Git 项目状态风险矩阵

| 场景 | 检测 | 行为 | 禁止 |
| --- | --- | --- | --- |
| 非 Git 项目 | `<workspace>` 无 `.git` 且无托管绑定 | 创建 `<workspace>/.petri/git` 托管仓库，只追踪受管理路径 | 对用户目录执行 `git init` |
| 已有 clean Git | 有 `.git`，`status` 干净 | 绑定既有仓库，只操作显式声明路径，AI 修改走专用 branch/隔离区 | `git add .` / `git add -A` |
| 已有 dirty Git | `status` 有未提交或 untracked 改动 | 目标路径与用户 WIP 无交集 → 继续；有交集 → ChangeSet 置 `blocked` 并解释 | 自动 stage、stash、覆盖用户改动 |
| 存在 submodule / worktree / index.lock | Adapter 预检 | 明确阻断并说明 | 强行操作或删锁 |
| git 不可用 | readiness 检测失败 | 阻断正式采用，给出诊断 | 静默降级为不可恢复编辑 |
| 用户拒绝接入既有仓库 | 用户显式选择 | 改用 `.petri/git` 托管历史 | 强制绑定 |

全场景禁止：自动 `push`、`force push`、`rebase`、删除用户分支；托管仓库默认不执行外部 hooks。

## 5. UI 流程（低保真）

```text
结果默认态
  标题 + 可信状态(来自 artifactTruth) + 一句话结论
  主预览区
  版本导航: 原始 | 当前 | 历史 | 新方案
  选择摘要 chip: "已选择 27 个基因 · padj<0.05"
  输入: "告诉 AI 怎么调整"
        │
        ▼
  意图分类 (view_only / presentation_rerender / data_transform
            / scientific_recompute / workflow_replan)
        │
        ├─ view_only ──────────► 本地即时响应，不建 Job，不建 Revision
        │
        └─ 其余 ──► 建 ChangeSet(draft)
                      → 隔离区改脚本/参数
                      → 真实 tool_job
                      → reconcileArtifactTruth
                      → Revision(preview_ready)
                      → 变更摘要 + diff + 前后对比
                      → [撤销] | [采用] → adopted(candidate commit)
```

脚本、参数、commit、Job ID、artifact hash 默认折叠。

## 6. 与 maintained G0 的合并顺序

G0 已是永久 `qualified + maintained`，根 `npm run check` 的 `postcheck` 挂着 `g0:qualification`。因此：

1. RS 每个提交都必须保持 `g0:qualification` 通过，不得因 RS 改动降级 G0 门禁。
2. RS 表与 Git 目录不进入 G0 已资格范围；G0 资格仍只覆盖既有 Support Matrix。
3. **`test/g0-baseline-qualification.test.mjs` 断言 `excludedClaims` 含 `'result-studio-editing'`**。这意味着 RS 能力目前被 G0 显式声明为"未资格化"。RS9 晋升时必须同时修改该 `excludedClaims` 与对应资格证据，并触发 LF11 requalification。**RS1～RS8 不得改动这条断言**——在证据齐备前移除它等于伪造资格。

## 7. RS0 验收对照

| 计划要求 | 结论 |
| --- | --- |
| 现状审计（6 项） | §2，全部定位到文件与符号 |
| ADR：双层版本架构 | §3，含 4 条子决策 |
| Git 项目风险矩阵 | §4，6 场景 |
| UI 原型流程 | §5，低保真文本流程 |
| 明确复用/新增表与路径 | §3.2，复用 4 类模块 + 5 现有表；新增 5 张表 |
| 明确不建第二套 executor/artifact truth | §3.2，`run_tool → tool_job → artifact truth` 与 `reconcileArtifactTruth` 强制复用 |
| 明确与 G0-LF 合并顺序 | §6，含 `excludedClaims` 约束 |

## 8. 遗留与下一步

RS0 未展开、留给 RS1 的项：

- `src/plugin-manager.js`（55KB）与 `src/plugin-schema.js` 中内置插件 `plugin.json` 的真实清单位置与输出声明格式（`core/` 下无 `plugin.json`）。
- `core/shared-backend/g0-truth-projection.js` 的 `buildTruthProjection` 字段细节。
- `.petri/` 目录是否需要加入 `.gitignore` 与打包排除规则。

下一阶段：`G0-RS1` Git Adapter 与 Repository Binding。按单线串行纪律，RS1 收口后才启动 RS2。
