# BLOCK-10-ARCHITECTURE PHASE 2 — Routes Mapping & 端点 → Domain 调研

> **报告日期**：2026-08-18
> **报告人**：主 agent（只读调研 worker 委派任务，0 代码改动 / 0 commit / 0 跑 npm 任何命令）
> **基线 plan**：`docs/block-10-architecture-plan.md` v0.1（active 工作包）§4.3 + §PHASE 2
> **基线 PHASE 0 调研 4 份**：
> - [`docs/block-10-arch-ph0-survey.md`](./block-10-arch-ph0-survey.md) §1.2 (A-002) / §1.5 (A-005)
> - [`docs/block-10-arch-ph0-fix-order.md`](./block-10-arch-ph0-fix-order.md) §3.2 + §5.4 worker 委派建议
> - [`docs/block-10-arch-ph0-risks.md`](./block-10-arch-ph0-risks.md) §5 大文件拆分特别风险
> - [`docs/block-10-arch-ph0-test-matrix.md`](./block-10-arch-ph0-test-matrix.md) §3.2 PHASE 2 新测试
> **基线 BLOCK-9.2 范式**：`commit 49652f3` plugin-manager.js 1457 → 586 + 8 lib（PHASE 3 拆分 commit）
> **基线 BLOCK-9.1 范式**：`commit aed7498` setupDesktopEnv 716 → 178 + 独立模块（PHASE 3 拆分 commit）
> **下游**：PHASE 2 active 工作包（待用户裁决启动）

---


## §1 范围与目标

### §1.1 3 个 r-server 路由大文件（4388 行总览）

| 文件 | 行数 | 端点数 | 跨域依赖 | 风险等级 |
|------|------|--------|----------|----------|
| `core/r-server/routes/result-studio.js` | **1800** | **27** | shared-backend × 11 / helpers × 5 / agent-tools × 1 / pluginLoader / db.sqlite / cache-manager | 🔴 高 |
| `core/r-server/routes/harness.js` | **1366** | **19** | shared-backend × 5 / helpers × 3 / pluginLoader / db.js / cacheManager / loopContract / mcp/registry | 🔴 高 |
| `core/r-server/routes/ai-agent.js` | **1222** | **3** | helpers × 12 / agent-tools / agent-runner / agent-task-store / dbMod / runtime / conversations | 🔴 高 |
| **合计** | **4388** | **49** | — | — |

> **数量声明**：用户 prompt 说"26+ 端点"对应 §3 plan v0.1 中"A-002 routes/result-studio.js 1800 行 **26+ 端点**"——那是仅 A-002 的端点计数。**全部 3 个文件实际共 49 个端点**（27 + 19 + 3），拆解范围比 plan §4.3 假设的更宽。PHASE 2 整体工作量比 plan 估算稍高（+4 commit 行号 review 工作量），但拆解风险等同（http 契约 100% 不变硬约束不变）。

### §1.2 拆分目标

- **A-002（routes/result-studio.js 1800 行 27 端点）**：拆 `routes/result-studio/{repository,interaction,selection,context,changesets,revisions,storage,workspace,preview-budget}.js` **9 个子域文件** + `routes/result-studio/index.js` 注册中心
- **A-005a（routes/harness.js 1366 行 19 端点）**：拆 `routes/harness/{workflow,context,repair,resources,scientific-task,file-references}.js` **6 个子域文件** + `routes/harness/index.js` 注册中心（plan v0.1 假设 3 子文件，实际更细粒度至 8 子文件更清晰：resources / workflow / repair / scientific-task / context / file-references / loop / index）
- **A-005b（routes/ai-agent.js 1222 行 3 端点）**：拆 `routes/ai-agent/{chat,context,tools,events}.js` **4 个子文件** + `routes/ai-agent/index.js` 注册中心（plan v0.1 假设 4 子文件 chat/loop/context/tools 与实际情况吻合；但 ai-agent.js 实际只有 1 个 POST + 2 个 GET/POST 子端点，子文件拆分主要面向**内部 helper + 共享 state** 而非更多端点）

### §1.3 拆分范式（参考 BLOCK-9.2 PHASE 3 plugin-manager 模式）

```
core/r-server/routes/<original>.js  → 保留为 thin facade（仅反向 require + 调 register 函数）
                                  ↓
core/r-server/routes/<original>/index.js  ← 注册中心（汇总各子模块 register）
                                  ↓
core/r-server/routes/<original>/<subdomain>.js  ← 每个子域文件 export register(app, options)
                                  ↓
core/r-server/routes/_helpers/<concern>.js  ← 共享 helper（仅被多个子文件依赖时抽取）
```

**关键原则**（来自 BLOCK-9.2 commit `49652f3` 范式）：

1. **子模块 self-contained**：每个子文件内部 import 所需 helper，不依赖其他子文件内部函数（避免循环）
2. **主文件反向 require + re-export**：原 `routes/result-studio.js` 改为 ~50 行 facade，仅 `module.exports = require('./result-studio/index').register;` 透传
3. **`register(app, options)` 签名一致**：与 `routes/index.js` 既有模式一致（每个子文件 export 一个 function(app)）
4. **共享 helper 抽 `_helpers/`**：跨 2+ 子文件依赖才抽到 `routes/_helpers/`，避免过度抽象
5. **既有测试 0 diff**：主文件保留原 require path（如 `require('../core/r-server/routes/result-studio')`），子文件路径不影响既有测试
6. **0 行为变化**：拆分前后端点 channel 名 / payload shape / status code 100% 一致

---

## §2 当前 3 文件结构图

### §2.1 `core/r-server/routes/result-studio.js` (1800 行)

| 行号区间 | 类别 | 内容 | 备注 |
|----------|------|------|------|
| 1-23 | 文档 | 模块 doc comment（G0-RS3 / 安全边界 / loopback-only） | 不动 |
| 25-93 | imports | fs / path / crypto / db / pluginLoader / mcpRegistry + **11 个 shared-backend** 模块 + **2 个 helpers** + **3 个 agent-tools** 模块 | 高耦合点 |
| 95-181 | imports (extended) | result-edit-controls + result-studio-lifecycle | 第 168-180 行扩 imports |
| 95-358 | helpers / setup | `attachExistingRepositoryWithExplicitConsent` / `persistedToolJobConversation` / `publicResultStudioErrorMessage` / `buildContextBoundPreviewBudget` / `hashFile` / `resolveInteractionBaselineRevision` / `baselineFailureDiagnostic` / `resolveWorkspaceFileForRevision` / `openVerifiedRevisionArtifact` | 顶层 helper 共 263 行 |
| 359-449 | helpers | `userId` / `isAdminOrInternal` / `canAccessProject` / `detectDelimiter` / `splitCsvLine` / `readTableSample` / `loadJobAndProject` / `artifactTruthError` / `artifactTruthAvailability` / `verifyArtifactRecordBytes` | 鉴权 + artifact 校验 helper 共 91 行 |
| 471-554 | helpers | `findArtifactRecord` / `sendArtifactResolutionError` / `resolveInteractionDescriptor` / `backingArtifactName` / `parseToolJobResult` | artifact resolution helper |
| 573-779 | helpers | `bindAuthoritativeQuerySelection` / `resolveArtifactPath` | **大块** 207 行（selection 绑定逻辑） |
| 779-787 | module.exports | `module.exports = function registerResultStudioRoutes(app)` | 函数入口 |
| 787-855 | setup | `repositoryInstance` / `replayService` / `baselineWork` / `workspaceInspectionWork` / `databasePath` / `repo()` / `projectContext()` | 共享 state + closure 函数 |
| 856-904 | 端点 1-2 | `GET /repository-binding` + `POST /repository-binding/consent` | **repository** 子域 |
| 906-911 | helper | `changeSetContext(req, changeSetId, options)` | 跨 changesets/revisions 共享 |
| 916-1119 | 端点 3 | `GET /interaction`（**205 行** 最复杂端点） | **interaction** 子域 |
| 1122-1159 | 端点 4 | `POST /table/query` | **interaction** 子域 |
| 1164-1213 | 端点 5 | `POST /selection` | **selection** 子域 |
| 1216-1234 | 端点 6 | `GET /selection/current` | **selection** 子域 |
| 1237-1247 | 端点 7 | `GET /selection/:selectionId` | **selection** 子域 |
| 1250-1258 | 端点 8 | `DELETE /selection/:selectionId` | **selection** 子域 |
| 1265-1303 | 端点 9-10 | `POST /selection/query` + `POST /selection/resolve` | **selection** 子域 |
| 1315-1354 | 端点 11 | `GET /context-envelope` | **context** 子域 |
| 1356-1383 | 端点 12 | `GET /changesets` | **changesets** 子域 |
| 1392-1420 | 端点 13 | `GET /revisions/:revisionId/source` | **revisions** 子域 |
| 1429-1546 | 端点 14 | `POST /revisions/:revisionId/replay`（**117 行** 大端点） | **revisions** 子域 |
| 1528-1545 | 端点 15 | `GET /changesets/:changeSetId/compare` | **changesets** 子域 |
| 1549-1577 | 端点 16 | `GET /workspace/status` | **workspace** 子域 |
| 1579-1603 | 端点 17 | `POST /workspace/recover` | **workspace** 子域 |
| 1605-1617 | 端点 18 | `GET /storage/gc` | **storage** 子域 |
| 1619-1628 | 端点 19 | `GET /storage/deduplicate` | **storage** 子域 |
| 1630-1643 | 端点 20 | `POST /storage/deduplicate` | **storage** 子域 |
| 1645-1658 | 端点 21 | `POST /storage/gc` | **storage** 子域 |
| 1660-1693 | 端点 22 | `GET /preview-budget` | **preview-budget** 子域 |
| 1675-1693 | 端点 23 | `GET /revisions/:revisionId/table-page` | **revisions** 子域 |
| 1694-1712 | 端点 24 | `POST /changesets/:changeSetId/adopt` | **changesets** 子域 |
| 1714-1731 | 端点 25 | `POST /changesets/:changeSetId/revert` | **changesets** 子域 |
| 1733-1764 | 端点 26 | `POST /revisions/:revisionId/restore` | **revisions** 子域 |
| 1766-1786 | 端点 27 | `GET /revisions/:revisionId/artifact` | **revisions** 子域 |
| 1789-1801 | exports | `module.exports._test = { ... }`（**7 个 helper 暴露给测试**） | 既有 `result-studio-route-baseline.test.mjs` 直接 import |

### §2.2 `core/r-server/routes/harness.js` (1366 行)

| 行号区间 | 类别 | 内容 | 备注 |
|----------|------|------|------|
| 1-46 | imports | path / fs / crypto / url / **express** / db / config / **harness-workflow-state** + **harness-workflow-recovery** + **chat-file-references** + **tools-metadata.reconcileToolJobArtifacts** + pluginLoader + 5 个 shared-backend + loopContract + cacheManager | 高耦合点 |
| 42-46 | module-level state | `recoveryConfirmations` Map（**TTL = 5 min**） | 进程级 singleton（A-006 部分候选） |
| 48-122 | helpers | `userId` / `isAdminOrInternal` / `canAccessProject` / `canAccessJob` / `jobsDir` / `desktopRootFromHere` / `loadHarnessModule` / `availableHarnessManifests` / `boolQuery` / `numberQuery` / `baseOptionsFromRequest` | 鉴权 + 路径 + query helper |
| 124-201 | helpers | `authorizeAndResolveOptions`（**77 行** 大 helper，跨多端点共享） | **关键共享 helper**，应抽 `_helpers/` |
| 202-289 | helpers | `selectArtifactResultDirBestEffort` / `parseJsonMaybe` / `collectArtifactNamesFromResult` / `listJobArtifactNames` | job/artifact 解析 |
| 290-330 | helpers | `buildArtifactInfo` / `buildWorkspaceInfo` / `isPathInsideWorkspace` / `noResolution` / `isAbsoluteReference` / `normalizeRelativePath` | file-references helper |
| 332-478 | helpers | `dangerousPathSegment` / `isBackupSegment` / `relativeWorkspacePathForAbsolute` / `buildWorkspaceFileNameIndex`（**49 行**）/ `findUniqueWorkspaceFileByName` / `combinedUniqueCount` / `combinedAmbiguousCount` | file-references 解析大块 |
| 480-502 | 端点 1 | `GET /harness/resource-snapshot` | **resources** 子域 |
| 503-600 | 端点 2 | `POST /harness/workflow/action/:jobId` | **workflow** 子域 |
| 602-622 | 端点 3 | `GET /harness/workflow/status/:jobId` | **workflow** 子域 |
| 624-642 | 端点 4 | `GET /harness/index` | **resources** 子域 |
| 644-688 | 端点 5 | `POST /harness/repair` | **repair** 子域 |
| 690-753 | 端点 6 | `POST /harness/workflow/plan` | **workflow** 子域 |
| 757-777 | 端点 7 | `POST /harness/scientific-task/plan` | **scientific-task** 子域 |
| 779-795 | 端点 8 | `POST /harness/scientific-task/confirmation-preview` | **scientific-task** 子域 |
| 797-816 | 端点 9 | `POST /harness/scientific-task/confirm` | **scientific-task** 子域 |
| 818-828 | 端点 10 | `GET /harness/scientific-task/:taskId` | **scientific-task** 子域 |
| 830-840 | 端点 11 | `GET /harness/scientific-task-by-job/:toolJobId` | **scientific-task** 子域 |
| 842-864 | 端点 12 | `GET /harness/scientific-task-by-job/:toolJobId/script` | **scientific-task** 子域 |
| 866-880 | 端点 13 | `POST /harness/scientific-task/:taskId/bind-job` | **scientific-task** 子域 |
| 881-902 | 端点 14 | `POST /harness/scientific-task/:taskId/delivery-manifest` | **scientific-task** 子域 |
| 903-922 | 端点 15 | `POST /harness/context-checkpoint` | **context** 子域 |
| 923-966 | 端点 16 | `POST /harness/scientific-task-by-job/:toolJobId/replay-package` | **scientific-task** 子域 |
| 968-1206 | 端点 17 | `POST /harness/file-references/resolve`（**238 行** 最复杂端点） | **file-references** 子域 |
| 1217-1319 | 端点 18 | `POST /loop/iterate`（**103 行** 大端点） | **loop** 子域（HLE-1） |
| 1321-1342 | 端点 19 | `GET /loop/:loopRunId` | **loop** 子域（HLE-1） |
| 1344-1365 | 端点 20 | `POST /loop/snapshot` | **loop** 子域（HLE-1） |

> **关键观察**：harness.js 在 routes/index.js 中注册顺序（**第 39 行**，紧跟在 AI Loop API 后）确保 `/api/loop/*` 与 `/api/harness/file-references/*` 优先于既有 server.js catch-all。**PHASE 2 拆分时必须保持子文件注册顺序**。

### §2.3 `core/r-server/routes/ai-agent.js` (1222 行)

| 行号区间 | 类别 | 内容 | 备注 |
|----------|------|------|------|
| 1-5 | 文档 | 模块 doc comment（AGENT_TOOLS_v1） | 不动 |
| 7-83 | imports | express + **12 个 helpers**（system-prompt / desktop-agent-prompt / plugin-demo-prompt / llm-client / site-snapshot / user-facts / chat-summary / plans / memory-privacy / memory-vectors / runtime）+ **agent-tools** + **result-context-binding** + **agent-execution-policy** + **methods-export** + `agent-runner.runAgentLoop` + **agent-task-store** | 极高耦合点（25+ 顶层 require） |
| 83 | module-level | `USE_AGENT_TASK_MODE` 常量 | 进程级常量 |
| 85-138 | helpers | `_buildResultCardFromRunTool` / `_pushUniqueResultCard` | result card 转换 helper |
| 140-309 | 端点 1 | `POST /api/ai/agent`（**task mode**，第 161-309 行 ~148 行） | **chat** 子域 |
| 311-1097 | 端点 1（续） | `POST /api/ai/agent`（**legacy SSE 模式**，第 311-1097 行 ~786 行超大块） | **chat** 子域（**最大单端点** 整个 r-server 最复杂 SSE 流） |
| 1100-1124 | 端点 2 | `POST /api/ai/agent/task/:taskId/cancel` | **events** 子域 |
| 1129-1219 | 端点 3 | `GET /api/ai/agent/task/:taskId`（**90 行** SSE 订阅端点） | **events** 子域 |

> **关键观察**：ai-agent.js 仅 3 个端点但单端点极复杂。PHASE 2 拆分不能简单地"按 endpoint 拆文件"——必须按**逻辑子域 + 共享 helper 抽取**拆。子文件应主要拆**task mode vs legacy SSE 的执行逻辑**和**chat context helpers**，而不是端点本身。

---

## §3 49+ 端点完整清单

### §3.1 按文件 + 子域分组

#### A-002 `routes/result-studio.js`（27 端点）

| # | HTTP | Path | handler function 名 | 行号 | 跨域依赖 | 共享 state |
|---|------|------|---------------------|------|----------|------------|
| **repository 子域（2 端点）** | | | | | | |
| 1 | GET | `/api/result-studio/repository-binding` | (inline) | 856-884 | `db.getProject` / `inspectWorkspaceGit` / `repo()` / `inspectExistingRepositoryDirty` / `canAccessProject` | `repositoryInstance` |
| 2 | POST | `/api/result-studio/repository-binding/consent` | `attachExistingRepositoryWithExplicitConsent` | 886-904 | `attachExistingRepositoryWithExplicitConsent` / `bindProjectRepository` / `repo()` / `db.getProject` | `repositoryInstance` |
| **interaction 子域（2 端点）** | | | | | | |
| 3 | GET | `/api/result-studio/interaction` | (inline 205 行) | 916-1119 | `loadJobAndProject` / `resolveArtifactPath` / `resolveInteractionDescriptor` / `queryResultTable` / `verifyArtifactRecordBytes` / `readTableSample` / `buildTableInteractionManifest` / `buildPlotInteractionManifest` / `repo()` / `backingArtifactName` / `pluginLoader.getPluginManifest` | `repositoryInstance` / `baselineWork` |
| 4 | POST | `/api/result-studio/table/query` | (inline) | 1122-1159 | 同上 + `queryResultTable` / `ResultStudioTableQueryError` | `repositoryInstance` |
| **selection 子域（6 端点）** | | | | | | |
| 5 | POST | `/api/result-studio/selection` | `bindAuthoritativeQuerySelection` | 1164-1213 | `validateSelectionContext` / `repo()` / `bindAuthoritativeQuerySelection` / `summarizeSelection` / `db.getProject` | `repositoryInstance` |
| 6 | GET | `/api/result-studio/selection/current` | (inline) | 1216-1234 | `repo().findLatestSelection` / `assessSelectionCompatibility` / `summarizeSelection` / `db.getProject` | `repositoryInstance` |
| 7 | GET | `/api/result-studio/selection/:selectionId` | (inline) | 1237-1247 | `repo().getSelection` / `db.getProject` / `summarizeSelection` / `describeSelectionForAgent` | `repositoryInstance` |
| 8 | DELETE | `/api/result-studio/selection/:selectionId` | (inline) | 1250-1258 | `repo().getSelection` / `repo().deleteSelection` / `db.getProject` | `repositoryInstance` |
| 9 | POST | `/api/result-studio/selection/query` | (inline) | 1265-1289 | `resolveSelectedEntityIds` / `db.getProject` | `repositoryInstance` |
| 10 | POST | `/api/result-studio/selection/resolve` | (inline) | 1289-1303 | `resolveSelectedEntityIds` / `repo()` / `summarizeSelection` / `db.getProject` | `repositoryInstance` |
| **context 子域（1 端点）** | | | | | | |
| 11 | GET | `/api/result-studio/context-envelope` | (inline) | 1315-1354 | `resolveResultStudioContext` / `repo()` / `summarizeContextForAgent` / `PUBLIC_EDIT_PHASES` / `buildEditControlSchema` / `db.getProject` | `repositoryInstance` |
| **changesets 子域（4 端点）** | | | | | | |
| 12 | GET | `/api/result-studio/changesets` | `changeSetContext` | 1356-1383 | `projectContext` / `repo().listChangeSets[ByArtifactFamily]` / `repo().getCurrentRevision` / `repo().listRevisions` | `repositoryInstance` |
| 15 | GET | `/api/result-studio/changesets/:changeSetId/compare` | `changeSetContext` + `compareResultChangeSet` | 1528-1545 | `changeSetContext` / `compareResultChangeSet` / `repo()` | `repositoryInstance` |
| 24 | POST | `/api/result-studio/changesets/:changeSetId/adopt` | `changeSetContext` + `adoptResultChangeSet` | 1694-1712 | `changeSetContext` / `adoptResultChangeSet` / `db.getToolJob` | `repositoryInstance` |
| 25 | POST | `/api/result-studio/changesets/:changeSetId/revert` | `changeSetContext` + `revertResultChangeSet` | 1714-1731 | `changeSetContext` / `revertResultChangeSet` | `repositoryInstance` |
| **revisions 子域（5 端点）** | | | | | | |
| 13 | GET | `/api/result-studio/revisions/:revisionId/source` | `projectContext` + `projectRevisionSource` | 1392-1420 | `projectContext` / `projectRevisionSource` / `ResultRevisionSourceError` / `db.getToolJob` | `repositoryInstance` |
| 14 | POST | `/api/result-studio/revisions/:revisionId/replay` | `projectContext` + `replayService` + `restoreArtifactRevision` | 1429-1546 | `projectContext` / `createControlledReplayService` / `restoreArtifactRevision` / `ResultReplayError` / `guardContextOperation` / `pluginLoader.getPluginManifest` / `db.getToolJob` | `repositoryInstance` / `replayService` |
| 23 | GET | `/api/result-studio/revisions/:revisionId/table-page` | (inline) | 1675-1693 | `repo().getRevision` / `projectContext` / `readTablePage` / `db.getToolJob` | `repositoryInstance` |
| 26 | POST | `/api/result-studio/revisions/:revisionId/restore` | `projectContext` + `restoreArtifactRevision` | 1733-1764 | `projectContext` / `restoreArtifactRevision` / `persistedToolJobConversation` / `pluginLoader.getPluginManifest` / `db.getToolJob` | `repositoryInstance` |
| 27 | GET | `/api/result-studio/revisions/:revisionId/artifact` | `projectContext` + `openVerifiedRevisionArtifact` | 1766-1786 | `projectContext` / `openVerifiedRevisionArtifact` / `createVerifiedSnapshotReadStream` / `pipeVerifiedSnapshotToResponse` / `artifactContentTypeHint` / `db.getToolJob` | `repositoryInstance` |
| **storage 子域（4 端点）** | | | | | | |
| 18 | GET | `/api/result-studio/storage/gc` | `projectContext` + `planResultStudioGc` | 1605-1617 | `projectContext` / `planResultStudioGc` / `repo()` | `repositoryInstance` |
| 19 | GET | `/api/result-studio/storage/deduplicate` | `projectContext` + `planArtifactDeduplication` | 1619-1628 | `projectContext` / `planArtifactDeduplication` / `repo()` | `repositoryInstance` |
| 20 | POST | `/api/result-studio/storage/deduplicate` | `projectContext` + `executeArtifactDeduplication` | 1630-1643 | `projectContext` / `executeArtifactDeduplication` / `repo()` | `repositoryInstance` |
| 21 | POST | `/api/result-studio/storage/gc` | `projectContext` + `executeResultStudioGc` | 1645-1658 | `projectContext` / `executeResultStudioGc` / `repo()` | `repositoryInstance` |
| **workspace 子域（2 端点）** | | | | | | |
| 16 | GET | `/api/result-studio/workspace/status` | `projectContext` + `runResultStudioBackground` | 1549-1577 | `projectContext` / `runResultStudioBackground` / `getResultStudioRuntimeLease` / `publicResultStudioErrorMessage` | `repositoryInstance` / `workspaceInspectionWork` / `databasePath` |
| 17 | POST | `/api/result-studio/workspace/recover` | `projectContext` + `runResultStudioBackground` | 1579-1603 | `projectContext` / `runResultStudioBackground` / `getResultStudioRuntimeLease` / `publicResultStudioErrorMessage` | `repositoryInstance` / `workspaceInspectionWork` / `databasePath` |
| **preview-budget 子域（1 端点）** | | | | | | |
| 22 | GET | `/api/result-studio/preview-budget` | `projectContext` + `buildContextBoundPreviewBudget` | 1660-1674 | `projectContext` / `buildContextBoundPreviewBudget` / `repo()` | `repositoryInstance` |


#### A-005a `routes/harness.js`（19 端点，按子域重分组）

| # | HTTP | Path | handler function 名 | 行号 | 跨域依赖 | 共享 state |
|---|------|------|---------------------|------|----------|------------|
| **resources 子域（2 端点）** | | | | | | |
| H1 | GET | `/api/harness/resource-snapshot` | (inline) | 481-502 | `cacheManager.getLocalDiskStats` / `createRuntimeResourceSnapshot` / `db.listRunningToolJobs` | — |
| H4 | GET | `/api/harness/index` | (inline) | 624-642 | `authorizeAndResolveOptions` / `loadHarnessModule` / `indexHarnessScope` / `boolQuery` | — |
| **workflow 子域（3 端点）** | | | | | | |
| H2 | POST | `/api/harness/workflow/action/:jobId` | (inline 98 行) | 503-600 | `db.getToolJob` / `validateWorkflowRecoveryAction` / `recoveryConfirmations` / `appendWorkflowRecoveryAudit` / `db.updateToolJobParams` / `reconcileToolJobArtifacts` / `projectHarnessWorkflowJob` / `mcp/registry.callTool` / `pluginLoader.getPlugin` | `recoveryConfirmations` (TTL 5min) |
| H3 | GET | `/api/harness/workflow/status/:jobId` | (inline) | 602-622 | `db.getToolJob` / `reconcileToolJobArtifacts` / `projectHarnessWorkflowJob` / `canAccessJob` | — |
| H6 | POST | `/api/harness/workflow/plan` | (inline) | 690-753 | `authorizeAndResolveOptions` / `loadHarnessModule` / `availableHarnessManifests` / `selectHarnessTaskPack` / `rankHarnessToolsForRequest` / `createHarnessExecutionContext` / `createHarnessWorkflowPlan` | — |
| **repair 子域（1 端点）** | | | | | | |
| H5 | POST | `/api/harness/repair` | (inline) | 644-688 | `authorizeAndResolveOptions` / `loadHarnessModule` / `createLocalHarnessPlatform` / `indexHarnessScope` / `createHarnessExecutionContext` / `suggestInputBindings` / `repairHarnessParams` / `diagnoseHarnessRunReadiness` | — |
| **scientific-task 子域（8 端点）** | | | | | | |
| H7 | POST | `/api/harness/scientific-task/plan` | (inline) | 757-777 | `authorizeAndResolveOptions` / `loadHarnessModule` / `indexHarnessScope` / `planScientificTaskFromIndex` / `availableHarnessManifests` | — |
| H8 | POST | `/api/harness/scientific-task/confirmation-preview` | (inline) | 779-795 | `db.getProject` / `createScientificTaskConfirmationPreview` / `canAccessProject` | — |
| H9 | POST | `/api/harness/scientific-task/confirm` | (inline) | 797-816 | `db.getProject` / `confirmScientificTask` / `db.saveScientificTaskSpec` / `canAccessProject` | — |
| H10 | GET | `/api/harness/scientific-task/:taskId` | (inline) | 818-828 | `db.getScientificTaskSpec` / `db.getProject` / `canAccessProject` | — |
| H11 | GET | `/api/harness/scientific-task-by-job/:toolJobId` | (inline) | 830-840 | `db.getScientificTaskByToolJob` / `db.getProject` / `canAccessProject` | — |
| H12 | GET | `/api/harness/scientific-task-by-job/:toolJobId/script` | (inline) | 842-864 | `db.getScientificTaskByToolJob` / `db.getToolJob` / `db.getProject` / `parseJsonMaybe` / `resolveProjectRunLayout` / `isRealPathInsideRoot` / `canAccessProject` | — |
| H13 | POST | `/api/harness/scientific-task/:taskId/bind-job` | (inline) | 866-880 | `db.getScientificTaskSpec` / `db.getToolJob` / `canAccessProject` | — |
| H14 | POST | `/api/harness/scientific-task/:taskId/delivery-manifest` | (inline) | 881-902 | `db.getScientificTaskSpec` / `canAccessProject` / `validateContextCheckpoint` / `validateCheckpointSupersession` / `selectReplayContextCheckpoint` / `createDeliveryManifest` / `writeDeliveryManifest` / `db.updateToolJob` | — |
| **context 子域（1 端点）** | | | | | | |
| H15 | POST | `/api/harness/context-checkpoint` | (inline) | 903-922 | `validateContextCheckpoint` / `db.saveContextCheckpoint` / `canAccessProject` | — |
| **scientific-task (续) / replay 子域（1 端点）** | | | | | | |
| H16 | POST | `/api/harness/scientific-task-by-job/:toolJobId/replay-package` | (inline) | 923-966 | `db.getToolJob` / `db.getProject` / `canAccessProject` / `buildScientificReplayPackage` / `relativeInside` / `selectReplayContextCheckpoint` / `parseJsonMaybe` / `db.updateToolJob` | — |
| **file-references 子域（1 端点）** | | | | | | |
| H17 | POST | `/api/harness/file-references/resolve` | (inline 238 行) | 968-1206 | `db.getProject` / `db.getToolJob` / `canAccessProject` / `canAccessJob` / `listJobArtifactNames` / `normalizeReference` / `buildWorkspaceFileNameIndex` / `findUniqueWorkspaceFileByName` / `buildArtifactInfo` / `buildWorkspaceInfo` / `isPathInsideWorkspace` / `dangerousPathSegment` / `normalizeRelativePath` / `relativeWorkspacePathForAbsolute` / `noResolution` / `isAbsoluteReference` / `combinedUniqueCount` / `combinedAmbiguousCount` | — |
| **loop（HLE-1）子域（3 端点）** | | | | | | |
| H18 | POST | `/api/loop/iterate` | (inline 103 行) | 1217-1319 | `db.getProject` / `canAccessProject` / `loopContract` / `db.persistLoopRun` / `db.updateLoopRunStatus` / `db.persistLoopIteration` / `db.persistLoopAction` / `db.getLoopActionByKey` / `db.listLoopIterations` | — |
| H19 | GET | `/api/loop/:loopRunId` | (inline) | 1321-1342 | `db.getLoopRun` / `db.getProject` / `canAccessProject` / `db.listLoopIterations` / `db.listLoopEvidence` / `db.getLatestLoopSnapshot` | — |
| H20 | POST | `/api/loop/snapshot` | (inline) | 1344-1365 | `db.getLoopRun` / `db.getProject` / `canAccessProject` / `db.persistLoopSnapshot` | — |

> **关键观察**：harness.js 的 19 端点里有 8 个是 `scientific-task/*` 端点（占 42%）。**scientific-task 子域是 harness.js 拆分的最大子域**。

#### A-005b `routes/ai-agent.js`（3 端点）

| # | HTTP | Path | handler function 名 | 行号 | 跨域依赖 | 共享 state |
|---|------|------|---------------------|------|----------|------------|
| **chat 子域（1 端点，但 2 大段）** | | | | | | |
| AG1a | POST | `/api/ai/agent`（task mode） | (inline 148 行) | 141-309 | `ai-settings` / `getChatProviderName` / `getChatModelPreset` / `getChatModelCredential` / `agentTaskStore.insertAgentTask` / `aiTaskConcurrencyAcquire` / `getOrCreateActiveConversation` / `appendMessageToConversation` / `runAgentLoop` / `uuidv4` | `_activeConv` |
| AG1b | POST | `/api/ai/agent`（legacy SSE） | (inline 786 行最复杂) | 311-1097 | `aiConcurrencyAcquire` / `callChatProvider` / `buildSystemPrompt` / `localizeToolResult` / `appendDesktopAgentInstructions` / `renderPluginDemoPathsForPrompt` / `buildSiteSnapshotAsync` / `renderSiteSnapshotForPrompt` / `buildFactsBlockAsync` / `backgroundExtractFacts` / `getActivePlanForUserAsync` / `renderActivePlanForPrompt` / `getToolDefs` / `runAgentToolCallBatch` / `inferExecutionPolicy` / `_buildResultCardFromRunTool` / `_pushUniqueResultCard` / `createResultEditProgressRecorder` / `finalizeResultEditProgress` / `projectResultStudioToolContext` / `_gatherAnalysisContextForMethods` / `_renderMethodsParagraph` / `_getChatSummary` / `getChatSummaryAsync` / `summarizeMessages` / `dashscopeEmbed` / `saveMemoryVector` / `_maybeAutoTitleConversation` / `_maybeDetectTopicShift` / `logChatAudit` / `cosineSim` / `MAX_CONTENT_LEN` / `_buildResultCardFromRunTool` / `sseSend` | `_activeConv` / `_msgCount` / `_page` / `assistantAcc` / `assistantMessagePersisted` / `convSync` / `convAsync` / `_guardUserIdEarly` / `_guardReleaseEarly` |
| **events 子域（2 端点）** | | | | | | |
| AG2 | POST | `/api/ai/agent/task/:taskId/cancel` | (inline) | 1100-1124 | `agentTaskStore.getAgentTask` / `agentTaskStore.cancelAgentTaskCascade` / `dbMod` | — |
| AG3 | GET | `/api/ai/agent/task/:taskId`（SSE 订阅） | (inline 90 行) | 1129-1219 | `agentTaskStore.getAgentTask` / `agentTaskStore.getAgentTaskEventsSince` / `sseSend` / `isTerminal` / `setInterval` | `lastSeq` / `poll` |

### §3.2 按 HTTP method 分组

| Method | result-studio | harness | ai-agent | 合计 |
|--------|---------------|---------|----------|------|
| GET | 11 | 8 | 1 | 20 |
| POST | 16 | 11 | 2 | 29 |
| DELETE | 1 | 0 | 0 | 1 |
| **合计** | **27** | **19** | **3** | **49** |

### §3.3 按子域分组（aggregated）

| 子域 | result-studio | harness | ai-agent | 跨文件合计 |
|------|---------------|---------|----------|------------|
| **repository** | 2 | — | — | 2 |
| **interaction** | 2 | — | — | 2 |
| **selection** | 6 | — | — | 6 |
| **context** | 1 | 1 | — | 2 |
| **changesets** | 4 | — | — | 4 |
| **revisions** | 5 | — | — | 5 |
| **storage** | 4 | — | — | 4 |
| **workspace** | 2 | — | — | 2 |
| **preview-budget** | 1 | — | — | 1 |
| **resources** | — | 2 | — | 2 |
| **workflow** | — | 3 | — | 3 |
| **repair** | — | 1 | — | 1 |
| **scientific-task** | — | 8 | — | 8 |
| **file-references** | — | 1 | — | 1 |
| **loop（HLE-1）** | — | 3 | — | 3 |
| **chat** | — | — | 1（双段） | 1 |
| **events** | — | — | 2 | 2 |
| **合计** | **27** | **19** | **3** | **49** |

---

## §4 端点 domain 映射（核心交付）

### §4.1 提议的子模块目录结构

```
core/r-server/routes/
├── index.js                                # 既有注册中心（不变）
├── ai-agent.js                             # facade (~30 行)
├── ai-agent/
│   ├── index.js                            # 注册中心（~40 行）
│   ├── chat.js                            # chat 子域（POST /api/ai/agent 双段 ~900 行）
│   ├── context.js                         # context 子域（chat 上文构建 helper ~150 行）
│   ├── events.js                          # events 子域（task cancel + SSE 订阅 ~200 行）
│   └── tools.js                           # tools 子域（tool call 集成 helper ~150 行）
├── harness.js                              # facade (~30 行)
├── harness/
│   ├── index.js                            # 注册中心（~50 行）
│   ├── resources.js                        # resources 子域（2 端点 ~80 行）
│   ├── workflow.js                         # workflow 子域（3 端点 ~250 行）
│   ├── repair.js                           # repair 子域（1 端点 ~70 行）
│   ├── scientific-task.js                  # scientific-task 子域（8 端点 ~280 行）
│   ├── context.js                          # context 子域（context-checkpoint 1 端点 ~50 行）
│   ├── file-references.js                  # file-references 子域（1 端点 238 行）
│   └── loop.js                             # loop（HLE-1）子域（3 端点 ~200 行）
├── result-studio.js                        # facade (~30 行)
├── result-studio/
│   ├── index.js                            # 注册中心（~60 行）
│   ├── repository.js                       # repository 子域（2 端点 ~100 行）
│   ├── interaction.js                      # interaction 子域（2 端点 ~300 行）
│   ├── selection.js                        # selection 子域（6 端点 ~150 行）
│   ├── context.js                          # context 子域（1 端点 ~70 行）
│   ├── changesets.js                       # changesets 子域（4 端点 ~120 行）
│   ├── revisions.js                        # revisions 子域（5 端点 ~270 行）
│   ├── storage.js                          # storage 子域（4 端点 ~110 行）
│   ├── workspace.js                        # workspace 子域（2 端点 ~80 行）
│   └── preview-budget.js                   # preview-budget 子域（1 端点 ~50 行）
└── _helpers/                                # 共享 helper（仅跨 2+ 子文件依赖时抽取）
    ├── auth.js                              # canAccessProject / canAccessJob / userId / isAdminOrInternal
    ├── project-context.js                   # projectContext / loadJobAndProject / changeSetContext
    ├── result-studio-shared.js              # result-studio 特有共享（attachExistingRepository… 等）
    ├── harness-shared.js                     # harness 特有共享（authorizeAndResolveOptions）
    ├── ai-agent-shared.js                   # ai-agent 特有共享（USE_AGENT_TASK_MODE + _buildResultCard）
    └── workspace-file-index.js              # buildWorkspaceFileNameIndex（被 file-references + harness 复用）
```

### §4.2 每个子模块含哪些端点（详细）

#### result-studio/ 子域（9 子文件）

| 子文件 | 端点 | 估算行数 | 共享 helper 依赖 |
|--------|------|----------|------------------|
| `index.js` | (无；仅 register) | ~60 | — |
| `repository.js` | 1-2（repository-binding + consent） | ~100 | auth.js / project-context.js |
| `interaction.js` | 3-4（GET /interaction + POST /table/query） | ~300 | result-studio-shared.js（含 `resolveArtifactPath` / `verifyArtifactRecordBytes`） |
| `selection.js` | 5-10（POST /selection + 4 GET + DELETE） | ~150 | result-studio-shared.js |
| `context.js` | 11（GET /context-envelope） | ~70 | result-studio-shared.js |
| `changesets.js` | 12 + 15 + 24 + 25（list + compare + adopt + revert） | ~120 | result-studio-shared.js / project-context.js |
| `revisions.js` | 13 + 14 + 23 + 26 + 27（source + replay + table-page + restore + artifact） | ~270 | result-studio-shared.js |
| `storage.js` | 18-21（GC + dedup × 2 methods） | ~110 | result-studio-shared.js |
| `workspace.js` | 16-17（status + recover） | ~80 | result-studio-shared.js / workspace-file-index.js |
| `preview-budget.js` | 22（preview-budget） | ~50 | result-studio-shared.js |
| **合计** | **27 端点** | **~1310** | — |

> **行数差异**：原 `result-studio.js` 1800 行 → 子文件合计 ~1310 行 + facade ~30 行 + `_helpers/` ~150 行 + 重复 imports + 子文件间边界开销 ≈ 1800 行（行数差异在于去掉 doc comment + helper 重分布）

#### harness/ 子域（8 子文件）

| 子文件 | 端点 | 估算行数 | 共享 helper 依赖 |
|--------|------|----------|------------------|
| `index.js` | (无；仅 register) | ~50 | — |
| `resources.js` | H1 + H4（resource-snapshot + index） | ~80 | harness-shared.js（`authorizeAndResolveOptions`） |
| `workflow.js` | H2 + H3 + H6（action + status + plan） | ~250 | harness-shared.js |
| `repair.js` | H5（repair） | ~70 | harness-shared.js |
| `scientific-task.js` | H7-H14 + H16（plan + confirm-preview + confirm + 2 GET + bind-job + delivery-manifest + replay-package = 8 端点） | ~280 | harness-shared.js / auth.js |
| `context.js` | H15（context-checkpoint） | ~50 | auth.js |
| `file-references.js` | H17（resolve 238 行） | ~250 | workspace-file-index.js（**关键抽点**） |
| `loop.js` | H18-H20（iterate + GET + snapshot） | ~200 | auth.js |
| **合计** | **19 端点** | **~1230** | — |

#### ai-agent/ 子域（5 子文件）

| 子文件 | 端点 | 估算行数 | 共享 helper 依赖 |
|--------|------|----------|------------------|
| `index.js` | (无；仅 register) | ~40 | — |
| `chat.js` | AG1（POST /api/ai/agent 双段 task + legacy） | ~900 | context.js / tools.js / ai-agent-shared.js |
| `context.js` | (无端点；仅 chat context 构建 helper：system prompt / site snapshot / user facts / plans) | ~150 | — |
| `events.js` | AG2 + AG3（task cancel + SSE 订阅） | ~200 | ai-agent-shared.js |
| `tools.js` | (无端点；仅 tool call 集成 + result edit progress + methods export) | ~150 | — |
| **合计** | **3 端点** | **~1440** | — |

> **关键差异**：ai-agent.js 仅 3 个端点，**PHASE 2 拆分的主要价值是拆 helper 而非拆端点**。子文件主要是**逻辑分层**（context / tools / events），不增加更多端点。

### §4.3 子模块间依赖方向（避免循环）

#### result-studio 内部依赖图

```
result-studio/index.js
  ├─→ repository.js
  ├─→ interaction.js
  ├─→ selection.js
  ├─→ context.js
  ├─→ changesets.js
  ├─→ revisions.js
  ├─→ storage.js
  ├─→ workspace.js
  └─→ preview-budget.js

每个子文件 → _helpers/auth.js + _helpers/project-context.js（共享）
每个子文件 → _helpers/result-studio-shared.js（repository / resolveArtifactPath / verifyArtifactRecordBytes）
workspace.js → _helpers/workspace-file-index.js（构建 workspace 索引）
```

**循环依赖检测**：
- `interaction.js` ↔ `selection.js`：无（`/interaction` 不调 `/selection` 端点，共享仅 `_helpers`）
- `revisions.js` ↔ `changesets.js`：✅ **依赖**（`changeSetContext` helper 被 `revisions/replay` 使用）
  - 缓解：抽 `changeSetContext` 到 `_helpers/result-studio-shared.js`，子文件统一通过 `_helpers` 引用
- `workspace.js` ↔ `storage.js`：无

#### harness 内部依赖图

```
harness/index.js
  ├─→ resources.js
  ├─→ workflow.js
  ├─→ repair.js
  ├─→ scientific-task.js
  ├─→ context.js
  ├─→ file-references.js
  └─→ loop.js

resources.js / workflow.js / repair.js → _helpers/harness-shared.js（authorizeAndResolveOptions）
file-references.js → _helpers/workspace-file-index.js
所有子文件 → _helpers/auth.js（canAccessProject / canAccessJob）
```

**循环依赖检测**：
- `workflow.js` ↔ `scientific-task.js`：无（workflow 不调 scientific-task 端点）
- `loop.js` ↔ `workflow.js`：无（loop 不调 workflow 端点）

#### ai-agent 内部依赖图

```
ai-agent/index.js
  ├─→ chat.js
  ├─→ events.js
  ├─→ context.js（仅 helper，无端点）
  └─→ tools.js（仅 helper，无端点）

chat.js → context.js + tools.js + _helpers/ai-agent-shared.js
events.js → _helpers/ai-agent-shared.js
```

**循环依赖检测**：
- `chat.js` ↔ `events.js`：✅ **潜在依赖**（chat task mode 创建 taskId 后，events 端点按 taskId 订阅 / 取消）
  - 实际依赖方向：**chat → events**（chat 创建 task 后由 events 提供 SSE）
  - 缓解：events.js 拆为独立 SSE 订阅器，chat.js 通过 `agentTaskStore` 中介（不直接 require events.js）

#### 跨大文件依赖

```
result-studio/_helpers/result-studio-shared.js → harness/_helpers/harness-shared.js？
   → 否！两者无共享逻辑

result-studio → agent-tools/result-context-tools.js？
   → 是！result-studio.js 第 170 行 require agent-tools/result-context-tools
   → 这是**既有跨层依赖**，PHASE 2 拆分必须**保留**这条 require，不能反向 require（agent-tools 不能 require routes/）

harness → shared-backend/agent-workflow.js？
   → 否（agent-workflow.js require harness-workflow-state，但 routes/harness.js 仅 require helpers/harness-workflow-state，不直接 require shared-backend/agent-workflow）
   → A-003 修复后会改变此关系，但属于 PHASE 3 范围，PHASE 2 不动

ai-agent → shared-backend/？
   → 否（ai-agent.js 仅 require helpers/ 和 agent-tools/）
```

### §4.4 共享 helper 抽到 `_helpers.js` vs 各 domain 内部

| helper | 跨子文件数 | 抽到 `_helpers/`？ | 理由 |
|--------|------------|---------------------|------|
| `userId(req)` | 3 大文件 | ✅ **抽** | 鉴权 helper，3 大文件复用 |
| `isAdminOrInternal(req)` | 2（result-studio + harness） | ✅ **抽** | 鉴权 helper，2 文件复用 |
| `canAccessProject(req, project)` | 3 大文件 | ✅ **抽** | **最关键共享 helper** |
| `canAccessJob(req, job)` | 1（仅 harness） | ❌ 不抽 | 仅 harness 用，留 harness 内部 |
| `projectContext(req, projectId, options)` | 1（仅 result-studio） | ❌ 不抽 | 仅 result-studio 留子文件 |
| `loadJobAndProject(req, jobId)` | 1（仅 result-studio） | ❌ 不抽 | 仅 result-studio 留子文件 |
| `changeSetContext(req, changeSetId, options)` | 2（changesets + revisions） | ⚠️ **抽到 result-studio-shared** | 跨子文件但同大文件 |
| `repo()` | 1（仅 result-studio） | ❌ 不抽 | 闭包变量，子文件自包含 |
| `attachExistingRepositoryWithExplicitConsent` | 1（仅 result-studio repository） | ❌ 不抽 | 仅 repository 子域 |
| `resolveArtifactPath` | 5（interaction + selection + revisions ×3） | ⚠️ **抽到 result-studio-shared** | 跨子文件 |
| `verifyArtifactRecordBytes` | 5（interaction + revisions） | ⚠️ **抽到 result-studio-shared** | 跨子文件 |
| `readTableSample` | 1（仅 interaction） | ❌ 不抽 | 单子文件 |
| `resolveInteractionDescriptor` | 2（interaction + table/query） | ⚠️ **抽到 result-studio-shared** | interaction 内部共享 |
| `authorizeAndResolveOptions` | 4（resources + workflow + repair + scientific-task） | ⚠️ **抽到 harness-shared** | 跨子文件 |
| `buildWorkspaceFileNameIndex` | 1（仅 file-references） | ❌ 不抽 | 单子文件用，但**建议抽到 `_helpers/workspace-file-index.js`** 备未来 harness workspace tools 复用 |
| `jobsDir()` / `desktopRootFromHere()` | 1（仅 harness） | ❌ 不抽 | 仅 harness |
| `recoveryConfirmations` Map | 1（仅 workflow） | ❌ 不抽 | 闭包变量 |
| `USE_AGENT_TASK_MODE` | 1（仅 chat） | ❌ 不抽 | 仅 chat 子文件 |
| `_buildResultCardFromRunTool` / `_pushUniqueResultCard` | 1（仅 chat） | ❌ 不抽 | 仅 chat 子文件 |

**抽 `_helpers/` 的判定原则**：
- **跨 2+ 大文件**的 helper（如 `canAccessProject`）→ 抽到 `routes/_helpers/auth.js`
- **跨同大文件 2+ 子文件**的 helper → 抽到 `routes/<bigfile>/_shared.js`（按 plan v0.1 假设）
- **单子文件**使用的 helper → 留子文件内部，不抽

---

## §5 跨域调用关系

### §5.1 result-studio ↔ harness 跨域调用

**直接 require**：无（grep 结果：0 处 `routes/result-studio.js` require `routes/harness.js`，反之亦然）

**共享 helper 跨文件调用**（通过 shared-backend / helpers）：

| 跨域 helper | result-studio 引用 | harness 引用 | 共享模式 |
|-------------|---------------------|--------------|----------|
| `db.getProject` | ✅ 9 处 | ✅ 8 处 | `core/r-server/db.js` 共享 |
| `db.getToolJob` | ✅ 4 处 | ✅ 5 处 | `core/r-server/db.js` 共享 |
| `canAccessProject` | ✅ 11 处 | ✅ 10 处 | 抽 `_helpers/auth.js` 后共享 |
| `canAccessJob` | ❌ | ✅ 3 处 | 仅 harness |
| `pluginLoader.getPluginManifest` | ✅ 2 处 | ❌ | 仅 result-studio |
| `pluginLoader.getPlugin` | ❌ | ✅ 1 处 | 仅 harness |
| `cacheManager.getLocalDiskStats` | ❌ | ✅ 1 处 | 仅 harness |
| `loopContract.buildLoopRun` | ❌ | ✅ 1 处 | 仅 harness（loop 子域） |
| `mcp/registry.callTool` | ❌ | ✅ 1 处 | 仅 harness（workflow 子域） |
| `agent-task-store` | ❌ | ❌ | result-studio 不直接用 |
| `agent-runner.runAgentLoop` | ❌ | ❌ | 仅 ai-agent 用 |

**结论**：result-studio 与 harness **无直接路由间调用**，但共享 `db.getProject` / `canAccessProject` / `pluginLoader` 等 helper。**PHASE 2 拆分后 `_helpers/auth.js` 是 result-studio 与 harness 唯一共享锚点**。

### §5.2 result-studio ↔ ai-agent 跨域调用

**直接 require**：无（grep 结果：0 处 `routes/result-studio.js` require `routes/ai-agent.js`，反之亦然）

**共享 helper 跨文件调用**：

| 跨域 helper | result-studio 引用 | ai-agent 引用 | 共享模式 |
|-------------|---------------------|----------------|----------|
| `db.getProject` | ✅ | ❌（仅用 dbMod 不直接 getProject） | 不共享 |
| `pluginLoader.getPluginManifest` | ✅ | ❌ | 不共享 |
| `agent-tools/result-context-tools.js` | ✅ 第 170 行 | ✅ 间接通过 agent-runner | 间接共享（PHASE 3 A-008 修复范围） |
| `agent-runner.runAgentLoop` | ❌ | ✅ 1 处 | 仅 ai-agent |

**结论**：result-studio 与 ai-agent **无直接路由间调用**，**完全独立**。PHASE 2 拆分无需考虑它们之间通信。

### §5.3 harness ↔ ai-agent 跨域调用

**直接 require**：无

**共享 helper 跨文件调用**：

| 跨域 helper | harness 引用 | ai-agent 引用 | 共享模式 |
|-------------|---------------|----------------|----------|
| `harness-workflow-state.projectHarnessWorkflowJob` | ✅ 2 处 | ❌ | 仅 harness |
| `agent-runner.runAgentLoop` | ❌ | ✅ 1 处 | 仅 ai-agent |
| `agent-task-store.getAgentTask` | ❌ | ✅ 3 处 | 仅 ai-agent |
| `agent-tools`（getToolDefs / runAgentToolCallBatch / 等） | ❌ | ✅ 18 处 | 仅 ai-agent |
| `db.transaction` / `db.persistLoopRun` / `db.persistLoopIteration` | ✅ loop 子域用 | ❌ | 仅 harness loop |

**结论**：harness 与 ai-agent **无直接路由间调用**。harness 的 `/loop/iterate` 端点是 **HLE-1 Loop ledger**（durable record），ai-agent 的 `/api/ai/agent` 是 **multi-turn tool-calling**——两者在概念上是分离的，PHASE 2 拆分独立进行。

### §5.4 提议：保留 require 还是反向重构为 events

**保留 require**（PHASE 2 不动事件总线）：

| 决策点 | 保留 require | 反向重构为 events | 理由 |
|--------|---------------|---------------------|------|
| result-studio ↔ harness | ✅ | ❌ | 无跨文件调用 |
| result-studio ↔ ai-agent | ✅ | ❌ | 无跨文件调用 |
| harness ↔ ai-agent | ✅ | ❌ | 无跨文件调用 |
| 子文件 ↔ 子文件（同大文件） | ✅ | ❌ | 通过 `_helpers/` 共享 helper；不引入 events（避免引入新架构模式） |
| 子文件 ↔ `core/r-server/agent-tools/*` | ✅（既有） | ❌ | 既有跨层依赖保留 |

**PHASE 2 不引入 event bus**：保持既有 require + helper 共享模式。event 总线是 G1+ 候选（observability-work-package），不属于 PHASE 2 范围。

---

## §6 端点边界判定（高风险）

### §6.1 P0 — 边界清晰可拆（28 端点）

| 端点 | 子域 | 边界 | 备注 |
|------|------|------|------|
| RS #1 / #2（repository-binding × 2） | repository | ✅ 清晰 | 仅 require bindProjectRepository + repo() + db.getProject，无跨子域调用 |
| RS #4（POST /table/query） | interaction | ✅ 清晰 | 与 #3 共享 helper 但独立端点 |
| RS #5-#10（selection × 6） | selection | ✅ 清晰 | 6 端点纯 selection CRUD，无跨子域 |
| RS #11（context-envelope） | context | ✅ 清晰 | 单端点 |
| RS #15 / #24 / #25（changesets compare + adopt + revert） | changesets | ✅ 清晰 | 通过 `changeSetContext` 共享，3 端点纯 changesets CRUD |
| RS #18-#21（storage × 4） | storage | ✅ 清晰 | 4 端点纯 storage lifecycle（plan + execute × 2 methods） |
| RS #22（preview-budget） | preview-budget | ✅ 清晰 | 单端点 |
| RS #23（revisions/table-page） | revisions | ✅ 清晰 | 单端点 |
| RS #26 / #27（revisions/restore + artifact） | revisions | ✅ 清晰 | 端点语义独立 |
| H #1 / #4（resources × 2） | resources | ✅ 清晰 | 共享 `authorizeAndResolveOptions` |
| H #3（workflow/status） | workflow | ✅ 清晰 | 与 #2 共享但独立端点 |
| H #5（repair） | repair | ✅ 清晰 | 单端点 |
| H #6（workflow/plan） | workflow | ✅ 清晰 | 与 #2 + #3 共享 helper |
| H #7-#14 + #16（scientific-task × 8） | scientific-task | ✅ 清晰 | 8 端点同子域 |
| H #15（context-checkpoint） | context | ✅ 清晰 | 单端点 |
| H #19 / #20（loop × 2） | loop | ✅ 清晰 | 共享 `db.getLoopRun` |
| AG #2 / #3（task cancel + SSE 订阅） | events | ✅ 清晰 | 共享 `agentTaskStore` |

### §6.2 P1 — 跨域耦合难拆（10 端点）

| 端点 | 跨域 | 难度 | 缓解 |
|------|------|------|------|
| RS #3（GET /interaction, 205 行） | 跨 5 子域 helper（resolveArtifactPath / verifyArtifactRecordBytes / resolveInteractionDescriptor / repo() / queryResultTable） | 🟠 中 | 抽到 `interaction.js` 内部 + 共享 helper 抽 `_helpers/result-studio-shared.js` |
| RS #12 / RS #15（changesets list + compare） | 跨 `projectContext`（仅 result-studio 内部） | 🟢 低 | 抽 `_helpers/project-context.js` |
| RS #13 / #14（revisions/source + replay） | 跨 `projectContext` + `restoreArtifactRevision` + `replayService` | 🟠 中 | 抽 `_helpers/project-context.js` + `revisions.js` 内部 helper |
| RS #16 / #17（workspace × 2） | 跨 `workspaceInspectionWork`（闭包）+ `databasePath`（闭包）+ `runResultStudioBackground` | 🟠 中 | 抽 `_helpers/workspace-state.js` 保留闭包变量 |
| H #2（workflow/action, 98 行） | 跨 `recoveryConfirmations` Map（闭包，TTL 5min） + `mcp/registry.callTool` + `projectHarnessWorkflowJob` | 🟠 中 | `recoveryConfirmations` 抽 `workflow.js` 内部闭包 |
| H #17（file-references/resolve, 238 行） | 跨 13 helper（normalizeReference / buildWorkspaceFileNameIndex 等）+ 多种引用类型 | 🟠 中 | 抽到 `file-references.js`，内部 helper 抽 `_helpers/workspace-file-index.js` |
| H #18（POST /loop/iterate, 103 行） | 跨 `loopContract.buildLoopRun` + `db.persistLoopRun` + `db.persistLoopIteration` + `db.persistLoopAction` + `db.getLoopActionByKey` | 🟢 低 | 抽到 `loop.js` 内部 |
| AG #1（POST /api/ai/agent task mode, 148 行） | 跨 `agentTaskStore` + `runAgentLoop` + `getOrCreateActiveConversation` + 5 个 helper | 🟠 中 | 抽到 `chat.js` task-mode handler |
| AG #1（POST /api/ai/agent legacy SSE, 786 行） | 跨 30+ helper + SSE 流式输出 + 多阶段编排 | 🔴 高 | **PHASE 2 最大风险点**；抽到 `chat.js` legacy handler（保留 786 行单文件） |
| AG #3（GET /api/ai/agent/task/:taskId, 90 行 SSE） | 跨 `agentTaskStore.getAgentTaskEventsSince` 轮询 + SSE 协议 | 🟢 低 | 抽到 `events.js` |

### §6.3 P2 — 保留在主文件作为 facade（0 端点）

**所有 49 端点均可拆**——主文件保留为 thin facade（**不保留任何端点**），仅反向 require 子模块。

| 主文件 | facade 内容 | 端点数 |
|--------|-------------|--------|
| `routes/result-studio.js` | `module.exports = require('./result-studio/index').register;` (~5 行) | 0 |
| `routes/harness.js` | `module.exports = require('./harness/index').register;` (~5 行) | 0 |
| `routes/ai-agent.js` | `module.exports = require('./ai-agent/index').register;` (~5 行) | 0 |

**注**：`result-studio.js` 的 `module.exports._test = { ... }`（第 1789-1801 行）必须保留——`test/result-studio-route-baseline.test.mjs:13` 直接 require `_test` 字段。**拆分子文件后 `_test` 字段统一 re-export 各子文件暴露的 helper**（详见 §7）。

---

## §7 测试覆盖矩阵

### §7.1 现有测试覆盖

来源：`ls test/ | grep -E "result-studio|harness|ai-agent|route|chf0"`（截至 2026-08-18）

#### 直接 import `routes/result-studio.js` 的测试（**仅 1 个**）

```javascript
// test/result-studio-route-baseline.test.mjs:13
const route = require('../core/r-server/routes/result-studio');
// 第 17-26 行：解构 route._test 中的 9 个 helper
const {
  attachExistingRepositoryWithExplicitConsent,
  baselineFailureDiagnostic,
  bindAuthoritativeQuerySelection,
  buildContextBoundPreviewBudget,
  findArtifactRecord,
  openVerifiedRevisionArtifact,
  publicResultStudioErrorMessage,
  resolveArtifactPath,
  resolveInteractionBaselineRevision,
} = route._test;
```

#### 通过 HTTP 间接覆盖的测试（chf0-http 系列）

- `test/g0-chf0-http.test.mjs`：覆盖 `/api/run` + `/api/replot/run`（routes/r-compute.js，与 result-studio/harness/ai-agent 无重叠）
- `test/g0-chf0-lifecycle.test.mjs`、`test/g0-chf0-science.test.mjs`：chf0-critical 系列，**与 routes 拆分无直接关系**

#### 通过 shared-backend unit test 覆盖

- `test/result-studio-context.test.mjs`：覆盖 `shared-backend/result-studio-context.js`
- `test/result-studio-contracts.test.mjs`：覆盖 `shared-backend/result-studio-contracts.js`
- `test/result-studio-lifecycle.test.mjs`：覆盖 `shared-backend/result-studio-lifecycle.js`
- `test/result-studio-repository.test.mjs`：覆盖 `shared-backend/result-studio-repository.js`
- `test/result-studio-table-query.test.mjs`：覆盖 `shared-backend/result-studio-table-query.js`
- `test/result-studio-agent-binding.test.mjs`：覆盖 `shared-backend/result-context-binding.js`
- `test/result-studio-background.test.mjs`：覆盖 `shared-backend/result-studio-background.js`
- `test/result-studio-evidence-bundle.test.mjs`：覆盖 `shared-backend/result-studio-evidence-bundle.js`
- `test/result-studio-qualification.test.mjs`：覆盖 `shared-backend/result-studio-qualification.js`
- `test/result-studio-plugin-sdk.test.mjs`：覆盖 `shared-backend/result-studio-plugin-sdk.js`
- `test/result-studio-migration.test.mjs`：覆盖 `shared-backend/result-studio-migration.js`
- `test/result-studio-resource-summary.test.mjs`：覆盖 `shared-backend/result-studio-resource-summary.js`

#### harness 测试覆盖

- `test/chat-file-references-route.cjs`：覆盖 `routes/harness.js` 的 `/api/harness/file-references/resolve` 端点
- `test/harness-file-index.test.mjs`：覆盖 `scripts/harness-file-index.mjs`
- `test/harness-loop-production-acceptance.test.mjs`：覆盖 harness loop 生产验收
- `test/harness-manifest.test.mjs`：覆盖 harness manifest
- `test/harness-provider-eval.test.mjs`：覆盖 harness provider eval
- `test/harness-tool-template.test.mjs`：覆盖 harness tool template
- `test/harness-weak-model.test.mjs`：覆盖 harness weak model
- `test/harness-workflow-fixtures.test.mjs`：覆盖 harness workflow fixtures
- `test/harness-workflow-recovery.test.mjs`：覆盖 harness workflow recovery（含 `/api/harness/workflow/action/:jobId` 端点）
- `test/harness-workflow-state.test.mjs`：覆盖 `helpers/harness-workflow-state.js`
- `test/harness-workspace-tools.test.mjs`：覆盖 harness workspace tools

#### loop API 测试覆盖

- `test/loop-api-route.test.mjs`：覆盖 `/api/loop/*` 端点
- `test/loop-iterate-route.test.mjs`：覆盖 `/api/loop/iterate` 端点

### §7.2 拆分后哪些测试需要按 domain 重命名 / 哪些可保持不动

#### **保持不动的测试（0 diff）**

| 测试文件 | 原因 |
|----------|------|
| `test/g0-chf0-http.test.mjs` | 不覆盖 routes/result-studio/harness/ai-agent 端点 |
| `test/g0-chf0-lifecycle.test.mjs` | 不覆盖 |
| `test/g0-chf0-science.test.mjs` | 不覆盖 |
| `test/result-studio-*-test.mjs`（11 个 shared-backend 测试） | 测试 `core/shared-backend/*` 不动 routes 拆分 |
| `test/loop-api-route.test.mjs` | 测 `/api/loop/*` HTTP 端点不变 |
| `test/loop-iterate-route.test.mjs` | 同上 |
| `test/harness-*-test.mjs`（除 harness-workflow-recovery） | 大多测试 helper 或 fixtures，不直接 require routes/harness.js |

#### **需要按 domain 重命名的测试（0 测试新增，仅改 import 路径）**

`test/result-studio-route-baseline.test.mjs` 第 13 行：
```javascript
// 旧
const route = require('../core/r-server/routes/result-studio');
const { ..., openVerifiedRevisionArtifact, ... } = route._test;

// 拆分后（PHASE 2 兼容性方案）
const route = require('../core/r-server/routes/result-studio');  // 主文件保留 facade
const { ..., openVerifiedRevisionArtifact, ... } = route._test;  // 主文件 _test 字段保留且 re-export
```

**关键设计**：`routes/result-studio.js` facade 的 `_test` 字段必须 re-export 所有子文件暴露的 helper：

```javascript
// 拆分后 routes/result-studio.js (facade)
const { register } = require('./result-studio/index');
module.exports = register;

// 兼容既有测试：test/result-studio-route-baseline.test.mjs:13-26
const _testHelpers = [
  ...require('./result-studio/_helpers/result-studio-shared')._test || {},
  ...require('./result-studio/repository')._test || {},
  ...require('./result-studio/interaction')._test || {},
  ...require('./result-studio/selection')._test || {},
  ...require('./result-studio/context')._test || {},
  ...require('./result-studio/changesets')._test || {},
  ...require('./result-studio/revisions')._test || {},
  ...require('./result-studio/storage')._test || {},
  ...require('./result-studio/workspace')._test || {},
  ...require('./result-studio/preview-budget')._test || {},
];
module.exports._test = _testHelpers;
```

**这样保证 `test/result-studio-route-baseline.test.mjs` 0 diff**。

#### **需要新增的测试**

来源：plan v0.1 §7.3 + PHASE 0 test-matrix §3.2

| 新测试文件 | 测试数 | 覆盖 ID | 备注 |
|------------|--------|---------|------|
| `test/routes-result-studio-split.test.mjs` | 5+ | A-002 拆分后子域文件契约 | 验证 27 端点 → 9 子文件映射正确 + register 签名一致 |
| `test/routes-harness-split.test.mjs` | 5+ | A-005 harness 拆分 | 验证 19 端点 → 8 子文件映射正确 |
| `test/routes-ai-agent-split.test.mjs` | 5+ | A-005 ai-agent 拆分 | 验证 3 端点 → 5 子文件映射正确 |
| **合计** | **15+** | — | **不破坏既有 11 个 result-studio-* + 6 个 harness-* + 2 个 loop-* 测试 0 退化** |

---

## §8 commit 拆分建议（PHASE 2 → 5 commit）

### §8.1 推荐 commit 拆分（5 commit 主收口）

来源：plan v0.1 §4.3 假设 2-3 commit，本调研建议 **5 commit 主收口 + 0 closeout commit**（closeout 在 PHASE 4）

| commit # | commit msg（建议） | 涉及 ID | 改动文件数 | 预估 net +/- |
|----------|-------------------|---------|------------|-------------|
| **PHASE-2.1a** | `refactor(block-10-architecture): routes/result-studio 拆 facade + _helpers prep` | A-002 prep | 1 改 + 1 新（_helpers/auth.js）+ 1 新（_helpers/project-context.js）+ 1 新（_helpers/result-studio-shared.js） | result-studio.js +50/-1800（仅留 facade），_helpers/* 共 +400 |
| **PHASE-2.1b** | `refactor(block-10-architecture): routes/result-studio 9 子域文件落地` | A-002 | 9 新 + 1 改（index.js）+ 1 新 test | 9 子文件合计 +1100, routes/result-studio/index.js +60, routes-result-studio-split.test.mjs 新 +200 |
| **PHASE-2.2a** | `refactor(block-10-architecture): routes/harness 拆 facade + _helpers prep` | A-005 harness prep | 1 改 + 1 新（_helpers/harness-shared.js）+ 1 新（_helpers/workspace-file-index.js） | harness.js +50/-1366, _helpers/* 共 +300 |
| **PHASE-2.2b** | `refactor(block-10-architecture): routes/harness 8 子域文件落地` | A-005 harness | 8 新 + 1 改（index.js）+ 1 新 test | 8 子文件合计 +1230, routes/harness/index.js +50, routes-harness-split.test.mjs 新 +200 |
| **PHASE-2.2c** | `refactor(block-10-architecture): routes/ai-agent 拆 facade + 子域文件落地` | A-005 ai-agent | 5 新（chat/context/events/tools/index）+ 1 改 + 1 新 test | ai-agent.js +20/-1222, 5 子文件 +1440, routes-ai-agent-split.test.mjs 新 +150 |

### §8.2 commit 拆分理由

| commit | 理由 | 风险 |
|--------|------|------|
| **PHASE-2.1a** | 拆 facade + 抽 _helpers 不涉及端点拆分；先行确保 `canAccessProject` / `projectContext` / `resolveArtifactPath` 等 helper 在 `_helpers/` 内自洽 | 🟢 低（pure refactor） |
| **PHASE-2.1b** | 9 子域文件落地；既有 chf0-http + result-studio 测试 0 退化是契约边界证据 | 🟠 中（端点拆分） |
| **PHASE-2.2a** | 同 2.1a 模式 | 🟢 低 |
| **PHASE-2.2b** | 8 子域文件落地；既有 harness + loop 测试 0 退化 | 🟠 中 |
| **PHASE-2.2c** | ai-agent 拆 5 子文件；既有 ai-agent 测试 0 退化 | 🟠 中（**legacy SSE 单端点 786 行最复杂**） |

### §8.3 commit 拆分备选方案（更细粒度，6 commit）

如果 PHASE-2.1 / 2.2 端点拆分遇到 partial-export 雷区（与 A-008 act-tools 循环同源），可拆更细：

| commit | 范围 | 端点数 |
|--------|------|--------|
| PHASE-2.1b-i | result-studio repository + interaction（**最高 P0 端点群**） | 4 |
| PHASE-2.1b-ii | result-studio selection + context | 7 |
| PHASE-2.1b-iii | result-studio changesets + revisions | 9 |
| PHASE-2.1b-iv | result-studio storage + workspace + preview-budget | 7 |
| PHASE-2.2b | harness 全部 8 子文件 | 19 |
| PHASE-2.2c | ai-agent 全部 5 子文件 | 3 |

**采用更细粒度的判定**：PHASE-2.1a 后跑 `test/routes-result-studio-split.test.mjs`（用 plan v0.1 新测试桩），如果 partial-export 雷区出现，立即降级为 6 commit 拆法。

---

## §9 拆分范式（统一）

### §9.1 子模块目录结构

```
core/r-server/routes/<domain>/<subdomain>.js
```

例如：
- `core/r-server/routes/result-studio/repository.js`
- `core/r-server/routes/result-studio/interaction.js`
- `core/r-server/routes/harness/workflow.js`
- `core/r-server/routes/ai-agent/chat.js`

### §9.2 主文件 `core/r-server/routes/<original>.js`（facade）

```javascript
/**
 * routes/result-studio.js — facade
 *
 * PHASE 2 拆分后保留 thin facade 以兼容既有 require 路径（test/result-studio-route-baseline.test.mjs）。
 * 真实实现见 ./result-studio/index.js。
 */

'use strict';

const { register } = require('./result-studio/index');

module.exports = register;

// 兼容既有测试：test/result-studio-route-baseline.test.mjs:13-26
const _testHelpers = [
  ...require('./result-studio/_helpers/result-studio-shared')._test || {},
  ...require('./result-studio/repository')._test || {},
  ...require('./result-studio/interaction')._test || {},
  ...require('./result-studio/selection')._test || {},
  ...require('./result-studio/context')._test || {},
  ...require('./result-studio/changesets')._test || {},
  ...require('./result-studio/revisions')._test || {},
  ...require('./result-studio/storage')._test || {},
  ...require('./result-studio/workspace')._test || {},
  ...require('./result-studio/preview-budget')._test || {},
];
module.exports._test = _testHelpers;
```

### §9.3 子文件 `core/r-server/routes/<domain>/<subdomain>.js`

```javascript
/**
 * routes/result-studio/repository.js — repository 子域
 *
 * 端点：
 *   GET  /api/result-studio/repository-binding
 *   POST /api/result-studio/repository-binding/consent
 */

'use strict';

const { canAccessProject } = require('../_helpers/auth');
const { projectContext } = require('../_helpers/project-context');
const { attachExistingRepositoryWithExplicitConsent } = require('../_helpers/result-studio-shared');
const { inspectWorkspaceGit, inspectExistingRepositoryDirty } = require('../../../shared-backend/git-repository-binding');
const { bindProjectRepository } = require('../../../shared-backend/git-repository-binding');
const db = require('../../db');

module.exports = function registerRepositoryRoutes(app, { repo, databasePath }) {
  app.get('/api/result-studio/repository-binding', (req, res) => {
    const projectId = String(req.query.projectId || '').trim();
    const project = db.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'project_not_found' });
    if (!canAccessProject(req, project)) return res.status(403).json({ error: 'forbidden' });
    try {
      const inspection = inspectWorkspaceGit({ workspaceRoot: project.workspace_path });
      const repository = repo();
      // ...（与原端点同代码）
    } catch (error) {
      return res.status(409).json({ error: error.code || 'repository_inspection_failed' });
    }
  });

  app.post('/api/result-studio/repository-binding/consent', (req, res) => {
    // ...
  });
};

// 测试 helper re-export（既有测试需要）
module.exports._test = {
  // 此子文件无 _test helper（attachExistingRepositoryWithExplicitConsent 在 _helpers/result-studio-shared.js）
};
```

### §9.4 子域注册中心 `core/r-server/routes/<domain>/index.js`

```javascript
/**
 * routes/result-studio/index.js — 注册中心
 *
 * 汇总 9 个子模块的 register(app, options) 函数，组合为单一 register 函数供主文件 facade 调用。
 */

'use strict';

const { createResultStudioRepository } = require('../../../shared-backend/result-studio-repository');
const { createControlledReplayService } = require('../../../shared-backend/result-replay-service');
const { createDeduplicatedBackgroundRunner, runResultStudioBackground } = require('../../../shared-backend/result-studio-background');
const { getResultStudioRuntimeLease } = require('../../../shared-backend/result-studio-runtime-lease');
const db = require('../../db');

const sqlite = db.db;

module.exports = {
  register(app) {
    // 共享 state 初始化（与原 routes/result-studio.js 第 787-794 行同）
    let repositoryInstance = null;
    const replayService = createControlledReplayService();
    const baselineWork = createDeduplicatedBackgroundRunner(runResultStudioBackground);
    const workspaceInspectionWork = createDeduplicatedBackgroundRunner(runResultStudioBackground);
    const configuredDatabasePath = sqlite.name || process.env.PETRI_DB_PATH || null;
    const databasePath = configuredDatabasePath && configuredDatabasePath !== ':memory:'
      ? require('path').resolve(configuredDatabasePath)
      : null;

    function repo() {
      if (!repositoryInstance) repositoryInstance = createResultStudioRepository(sqlite, { ensureSchema: false });
      return repositoryInstance;
    }

    const options = { app, repo, databasePath, replayService, baselineWork, workspaceInspectionWork };

    // 子模块注册（顺序与原 routes/result-studio.js 端点声明顺序一致）
    require('./repository')(app, options);
    require('./interaction')(app, options);
    require('./selection')(app, options);
    require('./context')(app, options);
    require('./changesets')(app, options);
    require('./revisions')(app, options);
    require('./storage')(app, options);
    require('./workspace')(app, options);
    require('./preview-budget')(app, options);
  },
};
```

### §9.5 共享 helper `core/r-server/routes/_helpers/<concern>.js`

```javascript
/**
 * routes/_helpers/auth.js — 鉴权共享 helper
 *
 * 跨 result-studio / harness / ai-agent 三大文件复用。
 */

'use strict';

function userId(req) {
  return req.user && (req.user.id || req.user.userId) || null;
}

function isAdminOrInternal(req) {
  return req.isInternal || (req.user && req.user.role === 'admin');
}

function canAccessProject(req, project) {
  if (!project) return false;
  if (isAdminOrInternal(req)) return true;
  const uid = userId(req);
  return !!(project.is_public || !project.user_id || project.user_id === uid);
}

function canAccessJob(req, job) {
  if (!job) return false;
  if (isAdminOrInternal(req)) return true;
  return job.user_id === userId(req);
}

module.exports = {
  userId,
  isAdminOrInternal,
  canAccessProject,
  canAccessJob,
};
```

### §9.6 命名规范 / export 模式 / 测试目录

| 类别 | 规范 | 备注 |
|------|------|------|
| **目录命名** | `<domain>/<subdomain>.js`（kebab-case 不用） | 与 routes/index.js 现有模式一致 |
| **子文件 export** | `module.exports = function register(app, options)` | 与现有 routes/* 单文件模式一致 |
| **子文件 `_test` 字段** | `module.exports._test = { ... }` | 用于既有测试 `route._test.xxx` 模式 |
| **`_helpers/` 文件** | `module.exports = { func1, func2, ... }`（直接 export 函数） | 与 shared-backend helper 模式一致 |
| **测试目录** | `test/routes-<domain>-split.test.mjs` | 与既有 `test/result-studio-*.test.mjs` 命名一致 |
| **既有测试 0 diff** | 主文件 facade 兼容既有 require 路径；既有测试不动 | 关键兼容点 |

---

## §10 风险登记

### §10.1 拆分破坏既有测试的可能性

| 风险 | 等级 | 缓解 |
|------|------|------|
| `result-studio-route-baseline.test.mjs` 既有 9 helper 通过 `route._test` 引用 | 🟠 中 | 主文件 facade 的 `_test` 字段 re-export 所有子文件 `_test` 字段 |
| `chat-file-references-route.cjs` 直接覆盖 `/api/harness/file-references/resolve` | 🟢 低 | 子文件 `file-references.js` 端点 100% 一致 |
| `loop-api-route.test.mjs` + `loop-iterate-route.test.mjs` 覆盖 `/api/loop/*` 端点 | 🟢 低 | 子文件 `loop.js` 端点 100% 一致 |
| shared-backend 单元测试（11 个 result-studio-* + 6 个 harness-*） | 🟢 低 | 这些测 `shared-backend/*` 模块，不动 routes 拆分 |

### §10.2 路由顺序敏感性（Express middleware / router order）

| 风险 | 等级 | 缓解 |
|------|------|------|
| `routes/index.js` 中 Harness 注册位置（第 39 行）必须在 Tools 前、Feedback 后 | 🔴 高 | 子文件注册顺序在 `routes/<domain>/index.js` 内严格保持原文件端点声明顺序；`routes/index.js` 不动 |
| `routes/result-studio.js` 中 `/api/result-studio/revisions/:revisionId/...` 的多个端点（13/14/23/26/27）按声明顺序匹配 | 🟠 中 | `routes/result-studio/revisions.js` 内端点声明顺序与原文件 1392-1786 范围一致 |
| `routes/harness.js` 中 `/api/harness/scientific-task/*` 的多个端点（7/8/9/10/13/14）按声明顺序 | 🟠 中 | `routes/harness/scientific-task.js` 内端点声明顺序与原文件 757-902 范围一致 |
| `/api/loop/iterate` 在 `routes/index.js` 第 38 行的 `ai-loop.js` 注册顺序后于 harness.js catch-all | 🟢 低 | `routes/harness/loop.js` 注册顺序在 `routes/index.js` 第 39 行的 harness 子树内，行为不变 |

### §10.3 跨域调用 require 顺序（避免循环依赖）

| 风险 | 等级 | 缓解 |
|------|------|------|
| 子文件 ↔ 子文件（同大文件）循环 | 🟠 中 | 子文件不直接 require 同大文件其他子文件；所有跨子文件共享通过 `_helpers/` |
| 子文件 ↔ `core/r-server/agent-tools/*` 反向 require | 🟠 中 | 保持既有 require 方向（routes → agent-tools），**绝不**反向 require |
| `core/shared-backend/*` 反向 require `routes/*` | 🟢 低 | 既有 require 方向正确（shared-backend 不依赖 routes），PHASE 2 不动 |
| 子文件 `_test` 字段 require 主文件 | 🟢 低 | 子文件 `_test` 字段直接 export 本文件函数，不反向 require 主文件 |
| 主文件 facade `_test` 字段 require 子文件导致子文件 require 主文件 | 🟠 中 | 主文件 facade `_test` 字段**延后赋值**（在子文件 require 后才填充），避免初始化时循环 |

**循环依赖测试**：`node --check` 全部 OK + `test/routes-*-split.test.mjs` 验证无 partial-export 现象。

### §10.4 共享 state（数据库句柄 / workflow-state cache / ai-context）

| 共享 state | 位置 | 拆分后归属 | 风险 |
|-----------|------|-----------|------|
| `repositoryInstance` | result-studio 闭包 | `routes/result-studio/index.js` 闭包变量（**不导出**），通过 `options.repo` 传给子文件 | 🟢 低 |
| `replayService` | result-studio 闭包 | 同上 | 🟢 低 |
| `baselineWork` / `workspaceInspectionWork` | result-studio 闭包 | 同上 | 🟢 低 |
| `databasePath` | result-studio 闭包 | 同上 | 🟢 低 |
| `recoveryConfirmations` Map（TTL 5min） | harness 闭包 | `routes/harness/workflow.js` 闭包变量（**不导出**），仅 workflow 子文件用 | 🟢 低 |
| `USE_AGENT_TASK_MODE` 常量 | ai-agent 顶层 | `routes/ai-agent/chat.js` 顶层常量 | 🟢 低 |
| `db.getProject` / `db.getToolJob` 等 | `core/r-server/db.js` 全局 | 既已全局可访问，不变 | 🟢 低 |
| `cacheManager.getLocalDiskStats` | `core/r-server/cache-manager.js` 全局 | 既已全局可访问，不变 | 🟢 低 |
| `loopContract` | shared-backend | 既已全局可访问，不变 | 🟢 低 |
| `agentTaskStore` | `core/r-server/agent-task-store.js` 全局 | 既已全局可访问，不变 | 🟢 低 |
| `_activeConv` / `_msgCount` / `_page` / `assistantAcc` / `assistantMessagePersisted` / `convSync` / `convAsync` / `_guardUserIdEarly` / `_guardReleaseEarly` / `lastSeq` / `poll` | ai-agent.js handler 局部闭包 | 保留在 `routes/ai-agent/chat.js` + `routes/ai-agent/events.js` 闭包内 | 🟢 低 |

### §10.5 LEGACY SSE 单端点 786 行复杂度（最大风险）

| 风险 | 等级 | 缓解 |
|------|------|------|
| `POST /api/ai/agent` legacy SSE 单端点 786 行（端点 1 第 311-1097 行）几乎不可拆 | 🔴 高 | 保留在 `routes/ai-agent/chat.js` 单文件内（**这是 PHASE 2 最大风险点**）；仅将 helper 函数（`_buildResultCardFromRunTool` 等）抽到子文件 |
| LEGACY SSE 内部有 30+ helper 调用 + SSE 流式输出 + 多阶段编排 | 🟠 中 | `_helpers/ai-agent-shared.js` 仅抽 `_buildResultCardFromRunTool` + `_pushUniqueResultCard`；其他 helper 留 `chat.js` 闭包 |
| AGENTS.md G0 阶段不外推；拆分必须保持 SSE 协议 100% 一致 | 🔴 高 | 既有 `g0-chf0-*` + loop-api-route 测试 0 退化是契约边界证据 |

### §10.6 PHASE 2 → PHASE 3 跨阶段依赖

| 依赖 | 风险 | 缓解 |
|------|------|------|
| A-003（shared-backend 跨层反向 require 修复）修改 `shared-backend/agent-workflow.js` | 🟢 低 | PHASE 3 范围；PHASE 2 不动 shared-backend/agent-workflow.js |
| A-008（act-tools ↔ plan-ui-tools 解环）修改 `core/r-server/agent-tools/*` | 🟢 低 | PHASE 3 范围；PHASE 2 routes/* 不依赖 agent-tools/* 内部结构 |
| A-007（DB singleton）修改 `src/database/*` | 🟢 低 | PHASE 1 范围；PHASE 2 routes 仍 `require('../db')` |
| A-001（agent-runner 拆分）修改 `core/r-server/agent-runner.js` | 🟢 低 | ai-agent.js 的 `routes/ai-agent/chat.js` 仅 `require('../agent-runner')` 不依赖内部结构 |

### §10.7 与既有 chf0-http + result-studio + harness 测试的兼容性

| 既有测试 | 拆分后行为 | 验证 |
|----------|-----------|------|
| `test/g0-chf0-http.test.mjs` | 不覆盖 routes/result-studio/harness/ai-agent 端点 | 0 退化 |
| `test/g0-chf0-lifecycle.test.mjs` | 同上 | 0 退化 |
| `test/g0-chf0-science.test.mjs` | 同上 | 0 退化 |
| `test/result-studio-route-baseline.test.mjs` | 既有 9 helper 通过 `route._test` 引用；主文件 facade re-export | 0 diff |
| `test/result-studio-*.test.mjs`（11 个 shared-backend） | 不动 | 0 退化 |
| `test/chat-file-references-route.cjs` | HTTP 覆盖 `/api/harness/file-references/resolve`；子文件端点 100% 一致 | 0 退化 |
| `test/loop-api-route.test.mjs` | HTTP 覆盖 `/api/loop/*`；子文件端点 100% 一致 | 0 退化 |
| `test/loop-iterate-route.test.mjs` | 同上 | 0 退化 |
| `test/harness-workflow-recovery.test.mjs` | HTTP 覆盖 `/api/harness/workflow/action/:jobId`；子文件端点 100% 一致 | 0 退化 |

---

## §11 不外推纪律

### §11.1 G1+ 不外推（按 AGENTS.md 当前阶段纪律）

- ❌ **不启动** packaged Electron 公证 / Provider 矩阵 / GA / release-pipeline / P7 / notarization / dist staleness / UI-P7-RS
- ❌ **不写** "qualificationEligible 维持 false" / "未做 Provider" / "未做 GA" / "P7 deferred" / "待公证" 等未做项列表
- ✅ **PHASE 2 收口笔录用语**：直接写 "G0 开发期常态 · 不外推 packaged/Provider/GA" 一句即可

### §11.2 不重启已收口工作包

- ❌ **不重新激活** BLOCK-2 / BLOCK-3 / BLOCK-4 / BLOCK-5 / BLOCK-6 / BLOCK-7 / BLOCK-8 / BLOCK-9 / BLOCK-9.1 / BLOCK-9.2 / BLOCK-10-AUDIT-CLOSEOUT
- ❌ **不修改** BLOCK-3 sender helper / BLOCK-5 IPC channel 字面量 / BLOCK-9 已拆分 _data.ts / main.js / DesktopSettingsPanel/ / ResultView/ / plugin/ / SimpleChat/ / useSkillStore.ts
- ❌ **不重写** BLOCK-10-AUDIT-CLOSEOUT 已落地的 11 commits

### §11.3 不破坏不变量

- ❌ **不修改** `src/preload.js` 顶层 18 namespace 任何 key 名
- ❌ **不修改** `frontend/src/lib/electron.d.ts` 任何已有声明
- ❌ **不修改** `frontend/src/lib/desktopBridge.ts` 任何已有导出
- ❌ **不修改** 4 page（BranchTabs / ResultStudio / 等）
- ❌ **不修改** `core/shared-backend/*` 公共接口
- ❌ **不修改** 5 audit 报告（仅 Read + 本调研引用）
- ❌ **不修改** `agent-tools/*` / `agent-transcripts/*`（历史抹底产物）
- ❌ **不修改** BLOCK-10-AUDIT-CLOSEOUT 已落地的 11 commits

### §11.4 不引入新依赖

- ❌ **不引入** `ajv / zod / joi / prom-client / opentelemetry / lru-cache / simple-git`
- ❌ **不引入** 新 npm 依赖（PHASE 2 所有改动纯 Node / Express 自有 API）
- ❌ **不引入** 新 React 组件库 / CSS 框架

### §11.5 不改业务行为

- ❌ **不修改** provider fallback 策略
- ❌ **不修改** Result Studio 业务逻辑
- ❌ **不修改** agent loop 状态机
- ❌ **不修改** SQLite schema
- ❌ **不修改** http 契约（PHASE 2 拆分后端点 channel 名 / payload shape 100% 一致）

### §11.6 不启动下一候选工作包

| ID | 不启动原因 | 候选工作包 |
|----|-----------|-----------|
| A-004 | observability 体系化超出 PHASE 范围 | observability-work-package |
| E-017 main | observability 体系化 | observability-work-package |
| E-018 | observability 体系化 | observability-work-package |
| PR-006 | observability 体系化 | observability-work-package |
| C-001-rserver | rserver-http debt | rserver-http-debt-pack |
| C-002-rserver | rserver-http debt（**与 A-002 同文件不联动修**） | rserver-http-debt-pack |
| M-001 | rserver-http debt | rserver-http-debt-pack |
| M-003 | rserver-http debt | rserver-http-debt-pack |
| A-011 | type drift | type-drift-pack |
| A-012 | fixture manifest | fixture-manifest-pack |

### §11.7 不修改 canonical doc

- ❌ **不修改** `docs/next-steps-roadmap.md`
- ❌ **不修改** `docs/project-workspace-handoff.md`
- ❌ **不修改** `docs/AUDIT-LOG.md`
- ❌ **不修改** `docs/ui-productization-audit.md`
- ❌ **不修改** `docs/DOC-REGISTRY.json`（PHASE 4 才登记）
- ❌ **不修改** plan v0.1（除非需要修正——先报告）

---

## §12 关键发现汇总

### §12.1 关键发现数

| # | 发现 | 重要度 |
|---|------|--------|
| 1 | **3 文件实际共 49 端点**（27 + 19 + 3），不是 plan v0.1 假设的 "26+"（仅 A-002）；总 4388 行 | 🟠 中 |
| 2 | **ai-agent.js 仅 3 端点但单端点 786 行**（legacy SSE）——PHASE 2 拆分价值是拆 helper 而非拆端点 | 🔴 高 |
| 3 | **harness.js 8 个 scientific-task 端点占 42%**，scientific-task 子域是 harness.js 拆分的最大子域 | 🟠 中 |
| 4 | **3 文件无直接路由间调用**（grep 0 匹配 `routes/result-studio.js ↔ routes/harness.js` 等），共享仅通过 `core/r-server/db.js` / `plugin-loader.js` / `cache-manager.js` 全局模块 | 🟢 低（**好消息**） |
| 5 | **既有测试仅 1 个** (`result-studio-route-baseline.test.mjs`) 直接 require `routes/result-studio.js`，且仅通过 `_test` 字段引用 8 helper；主文件 facade re-export 可保证 0 diff | 🟢 低（**好消息**） |
| 6 | **路由顺序敏感**：`routes/index.js` 中 Harness 在 Tools 前、Feedback 后注册，必须保持 | 🔴 高 |
| 7 | **共享闭包变量** 跨子文件传递：`repositoryInstance` / `replayService` / `baselineWork` / `workspaceInspectionWork` / `databasePath` 必须通过 `options` 传递 | 🟠 中 |
| 8 | **`recoveryConfirmations` Map**（harness.js 闭包，TTL 5min）跨 workflow/action 与 workflow/status 两端点共享；拆分到 `workflow.js` 子文件内部闭包可保持 | 🟢 低 |
| 9 | **既有 audit 红线 C-002-rserver**（`/api/result-studio/interaction` Revision 不匹配返 HTTP 200）与 A-002 同文件，但 plan v0.1 §3.4 明示 **不联动修** | 🟢 低 |
| 10 | **`_helpers/auth.js` 抽 `canAccessProject`** 跨 3 大文件复用，是 PHASE 2 唯一真正"跨文件共享 helper" | 🟢 低 |
| 11 | **`workspaceFileNameIndex` 构建**（harness.js 第 372-419 行 49 行）虽仅 file-references 端点用，但**未来**可能给 harness workspace tools 复用，建议提前抽 `_helpers/workspace-file-index.js` | 🟢 低 |
| 12 | **`block-10-audit-closeout.md` §10.3 候选清单 19 项** 中 PHASE 2 仅 2 项（A-002 + A-005），**实际拆 3 文件（A-002 + A-005a + A-005b）**——数量声明一致（2 项 ID） | 🟢 低 |

### §12.2 循环依赖风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| result-studio 内部 `revisions.js` ↔ `changesets.js` 通过 `changeSetContext` 共享 | 🟢 低 | 抽 `_helpers/result-studio-shared.js` |
| ai-agent 内部 `chat.js` ↔ `events.js` 通过 `agentTaskStore` 中介 | 🟢 低 | 既有 require 方向，不引入反向依赖 |
| 主文件 facade `_test` 字段 require 子文件 | 🟢 低 | 延后赋值（避免初始化时循环） |
| **未发现** 实际循环依赖 | — | — |

### §12.3 红旗（候选不该启动）

| 红旗 | 触发原因 | 处理 |
|------|----------|------|
| ❌ 拆分 3 大文件改动 `core/shared-backend/*` | 违反 PHASE 3.2 范围 | 拆分不引入 shared-backend 改动 |
| ❌ 拆分引入 `event bus` 架构 | G1+ 候选范围 | 保持既有 require 模式 |
| ❌ 拆分修改 provider fallback | 违反 G0 阶段纪律 | 0 行为变化 |
| ❌ 拆分修 C-002-rserver 红线 | plan v0.1 §3.4 明示不联动修 | 仅完成 A-002 + A-005 拆分 |

### §12.4 推荐 PHASE 2 commit 1 第一个端点群（P0）

**推荐**：**PHASE-2.1a**（result-studio facade + `_helpers/` prep）作为 PHASE 2 commit 1。

**端点群（P0）**：

| 端点 | 子域 | 行号 | 优先级 |
|------|------|------|--------|
| RS #1 / #2（repository-binding × 2） | repository | 856-904 | P0（边界最清晰） |
| RS #3（GET /interaction, 205 行） | interaction | 916-1119 | P0（**最复杂端点**，先拆便于后续 review） |
| RS #4（POST /table/query） | interaction | 1122-1159 | P0（与 #3 共享 helper） |

**理由**：
1. **PHASE-2.1a 不涉及端点拆分**——仅拆 facade + 抽 `_helpers/`，pure refactor，**风险最低**（🟢）
2. 既有 `result-studio-route-baseline.test.mjs` 0 diff（主文件 facade `_test` re-export）
3. 既有 chf0-http / result-studio / harness / loop / ai-agent 测试 0 退化
4. `npm run docs:check` / `npm run ui:audit:check` / `cd frontend && npx tsc --noEmit` / `npm run docs:reconcile` 4 治理门 GREEN
5. **PHASE-2.1b（9 子域落地）** 拆 commit 2，依赖 PHASE-2.1a 的 `_helpers/` 落地

**PHASE-2.1b 拆 commit 2 候选**：

| 端点 | 子域 | 行号 |
|------|------|------|
| RS #5-#10（selection × 6） | selection | 1164-1303 |
| RS #11（context-envelope） | context | 1315-1354 |
| RS #12 + #15 + #24 + #25（changesets × 4） | changesets | 1356-1383 + 1528-1545 + 1694-1731 |

**PHASE-2.1c 拆 commit 3 候选**（如需更细粒度）：

| 端点 | 子域 | 行号 |
|------|------|------|
| RS #13-#14 + #23 + #26-#27（revisions × 5） | revisions | 1392-1546 + 1675-1693 + 1733-1786 |
| RS #16-#17（workspace × 2） | workspace | 1549-1603 |
| RS #18-#21（storage × 4） | storage | 1605-1658 |
| RS #22（preview-budget） | preview-budget | 1660-1674 |

---

## §13 报告交付状态

- ✅ §1 范围与目标（3 文件 4388 行 / 49 端点 / 拆分范式）
- ✅ §2 当前 3 文件结构图（每个文件按行号区间）
- ✅ §3 49+ 端点完整清单（27 + 19 + 3 = 49 端点）
- ✅ §4 端点 domain 映射（核心交付：22 子文件 + 6 _helpers + 依赖方向）
- ✅ §5 跨域调用关系（**0 路由间直接调用**）
- ✅ §6 端点边界判定（28 P0 + 10 P1 + 0 P2）
- ✅ §7 测试覆盖矩阵（既有 0 diff / 新增 15+ tests）
- ✅ §8 commit 拆分建议（**5 commit 主收口** PHASE-2.1a/b + PHASE-2.2a/b/c）
- ✅ §9 拆分范式（统一：facade + register + _helpers + register 签名）
- ✅ §10 风险登记（既有测试 / 路由顺序 / 循环依赖 / 共享 state / LEGACY SSE / 跨阶段）
- ✅ §11 不外推纪律（G1+ 不外推 / 7 不重启 / 不变量 / 0 新依赖 / 0 业务行为变化 / 10 不启动 / 0 canonical doc 修改）

---

**不变量**：本调研报告为 PHASE 2 active 工作包唯一调研产物（基于 4 份 PHASE 0 调研 + plan v0.1 + 5 份 audit 报告综合起草）。PHASE 2.1a/b/c 待用户显式裁决启动。**0 代码改动 / 0 commit / 0 跑 npm 任何命令**。
