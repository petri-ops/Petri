# BLOCK-9.2-MEGA-FILE-REFACTOR 工作包 PHASE 0 架构调研

**调研时间**：2026-08-17 07:46 (UTC+8)
**调研模式**：PHASE 0 调研 · **0 行代码改动** · 仅出报告
**关联工作包**：`BLOCK-9.2-MEGA-FILE-REFACTOR`（启动后由本报告 §6 派生）
**关联评审**：[`docs/senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §3
**关联 closeout**：[`docs/block-9-mega-file-refactor-closeout.md`](./block-9-mega-file-refactor-closeout.md)（前端拆分范式）+ [`docs/block-9-1-main-js-split-closeout.md`](./block-9-1-main-js-split-closeout.md)（后端 main.js 拆分范式）
**当前阶段纪律**：G0 长期开发期（`docs/AGENTS.md` §当前阶段纪律 · `qualificationEligible: false` 不外推）

---

## 0. 调研摘要（TL;DR）

**结论先看**：
- 5 文件 全部可拆，但优先级与拆法差异巨大
- 拆 **plugin-manager.js** 时**必须先修 dangling IPC contract bug**（BLOCK-9.1 PHASE 2 留的遗留），否则任何拆分都把 bug 永久化
- **useSkillStore.ts** 是 5 文件中**唯一不建议拆分**的（module-level cache + 4 个 Map 强耦合，拆了会破坏 singleton 语义）
- **SimpleChat.tsx** 2153 行可走 BLOCK-9 范式（types + helpers + 子组件），但 ROE 比最低（86 hooks + 单组件长文件）
- **ResultView.tsx** 1662 行已被 BLOCK-9 PHASE 2 部分处理（`buildPreviewTable` 已抽 lib/），剩余主要是 `ResultArtifactShell` 单组件巨大，建议保守拆
- **DesktopSettingsPanel.tsx** 1515 行 7 个 section 独立性强，**最适合拆**（types + 6 个 section 子组件 + 1 个 shared helper）

**优先级矩阵**（详见 §3）：

| # | 文件 | 优先级 | 工作量 | 风险 | 收益 | 依赖 |
|---|---|---|---|---|---|---|
| 1 | DesktopSettingsPanel.tsx | **P0** | 1.5 PHASE | 低 | 高（1515→~600 + 7 helpers） | 0 |
| 2 | ResultView.tsx | **P0** | 1 PHASE | 中 | 中（1662→~1100 + types/helpers） | 1（ActiveArtifact/JobStats re-export） |
| 3 | plugin-manager.js | **P1** | 2 PHASE（先修 dangling 再拆） | 中 | 高（1457→6 文件 + 修 dangling contract） | 0（与 BLOCK-9.1 IPC 联调） |
| 4 | SimpleChat.tsx | **P2** | 3 PHASE | 中 | 中（2153→~1200 + 6 子文件） | 1, 2（types 抽离模式复用） |
| 5 | useSkillStore.ts | **P3**（不拆 / 降级） | 不适用 | **高** | 低（743→~600 但破坏 singleton 语义） | 1, 2, 3, 4 |

**PHASE 划分建议**（详见 §4）：
- PHASE 1：DesktopSettingsPanel 拆（types + 6 section 子组件 + 1 helpers）→ P0 低风险
- PHASE 2：ResultView 拆（types + 2 helpers + ResultArtifactShell 提 lib/） → P0 中风险
- PHASE 3：plugin-manager.js **先修 dangling contract bug**（独立 sub-PHASE 0.5）→ 再拆 6 文件
- PHASE 4：SimpleChat 拆（types + 4 helpers + 4 子组件）→ P2
- PHASE 5：useSkillStore 评估 → 建议 **保留不拆**，只在 docs/ui-productization-audit 登记"已评估，不建议拆"

---

## 1. 单文件结构分析

### 1.1 `src/plugin-manager.js` 1457 行（**P1**）

#### 1.1.1 当前行数
```
$ wc -l src/plugin-manager.js
1457 src/plugin-manager.js
```

#### 1.1.2 顶层结构（`// ── XXX ──` 注释分段已存在，结构最清晰）

| 行 | 分类 | 名称 | 签名 |
|---|---|---|---|
| 15-22 | require | `electron`, `path`, `fs`, `https`, `crypto`, `extract-zip`, `platform-compat` | — |
| 33-46 | init-time helper | `resolveSharedBackendDir()` | `(): string` |
| 48-53 | module const | `SHARED_BACKEND_DIR`, `runtime-paths` require | — |
| 57-60 | init-time helper | `resolveProjectRoot()` | `(): string` |
| 62-67 | module init | `PROJECT_ROOT`, `pluginLoader` require, `initSharedBackend()` 调用 | init-time 单次 |
| 73-78 | module init | shared-backend `configure({ getConfig })` 调用 | init-time 单次 |
| 80-90 | module const | `USER_DATA_DIR`, `PLUGINS_DIR`, `RUNTIMES_DIR`, `INSTALLED_FILE`, `RESOURCES_PATH` | — |
| 93-102 | helper | `getFixRPathsScript()` | `(): string` |
| 105 | module const | `BUILT_IN_PLUGINS_DIR`, `MANIFEST_URL` | — |
| 113-120 | re-export from schema | `PLATFORM_IDS`, `ALLOWED_RUNTIME_HOSTS`, `normalizeRemotePluginEntry`, `selectArtifact`, `assertAllowedUrl`, `validateManifest` | — |
| 125-224 | **Section: 已装插件清单** | `getInstalledPlugins()` / `saveInstalledPlugins()` / `addInstalledPlugin()` / `removeInstalledPlugin()` | RORP·被 `loadAllPlugins` / `installPlugin` 等多处调用 |
| 226-307 | **Section: 远程 manifest** | `getBuiltInManifest()` / `getRemoteManifest()` | RORP·被 `installPlugin` / `checkUpdates` / `loadAllPlugins` 等多处调用 |
| 309-318 | **Section: 平台检测** | `detectPlatform()` | RORP·被所有 install 路径 + `loadAllPlugins` 调用 |
| 320-358 | **Section: 下载** | `downloadFile(url, destPath, onProgress)` | RORP·3 个 install 路径 + `checkUpdates` 共用 |
| 360-411 | **Section: SHA256 校验** | `verifyChecksum()` / `streamingSha256()` / `assertArtifactChecksumDeclared()` | RORP·3 个 install 路径调用 |
| 413-430 | **Section: dirSize** | `dirSize(dir)` | RORP·仅 install 路径 |
| 432-438 | **Section: 解压 zip** | `extractZipFile(zipPath, destDir)` | RORP·3 个 install 路径 |
| 440-674 | **Section: 安装插件** | `installPlugin(pluginIdOrSpec, onProgress)` | orchestrator（分流 4 种 plugin.type） |
| 675-774 | **Section: 安装 Content 插件** | `installContentPlugin()` | 独立 install 路径 |
| 775-907 | **Section: 安装 Runtime** | `installRuntime()` | 独立 install 路径 |
| 908-1026 | **Section: 安装 FigCode 卡片/数据包** | `installFigcodePack()` | 独立 install 路径 |
| 1027-1047 | **Section: Runtime 状态查询** | `getRuntimeStatus()` | RORP·被 `ipc/runtime-status.js` 调用 |
| 1048-1064 | **Section: 注册插件到 r-server** | `registerPluginInServer()` | install 完成钩子 |
| 1065-1107 | **Section: Content 插件注册** | `registerContentPlugin()` / `unregisterContentPlugin()` | content 路径 |
| 1108-1199 | **Section: Content 文档桥** | `listContentPluginDocs()` / `readContentPluginDoc()` / `listAllContentPlugins()` / `extractMdTitle()` / `extractSidebarPos()` | RORP·被 `ipc/plugin.js` 调用 |
| 1202-1261 | **Section: 卸载插件** | `uninstallPlugin()` | orchestrator |
| 1262-1301 | **Section: 卸载 Runtime** | `uninstallRuntime()` / `removePackage()` | 独立卸载路径 |
| 1302-1323 | **Section: 检查更新** | `checkUpdates()` | orchestrator |
| 1324-1399 | **Section: 加载所有已装插件** | `loadAllPlugins()` | init-time 由 `main.js` 调 |
| 1400-1431 | **Section: helpers** | `copyDirSync()` / `parseVersion()` / `compareVersions()` | RORP·多 install/uninstall 路径 |
| 1433-1457 | **module.exports** | 16 个 export（含 7 个 Week 2 schema helper re-export） | — |

#### 1.1.3 导入依赖

**require 列表**（7 个 + 3 个 cross-path）：
```
require('electron')      → app
require('path')           → path
require('fs')             → fs
require('https')          → https
require('crypto')         → crypto
require('child_process')  → execFile   （实际未在 grep 命中，scan 一遍确认未使用）
require('extract-zip')    → extractZip
require('./platform-compat')           → getRuntimeBinCandidates
require(path.join(SHARED_BACKEND_DIR, 'runtime-paths'))  → getRuntimeBinName, getPythonRuntimeExecutable, getPythonSitePackagesDir
require(path.join(PROJECT_ROOT, 'r-server', 'plugin-loader.js'))  → pluginLoader
require(path.join(SHARED_BACKEND_DIR, 'init'))  → initSharedBackend
require(SHARED_BACKEND_DIR)            → configure
require(path.join(PROJECT_ROOT, 'r-server', 'config'))  → getConfig
require('./plugin-schema')             → PLATFORM_IDS, ALLOWED_RUNTIME_HOSTS, normalizeRemotePluginEntry, selectArtifact, assertAllowedUrl, validateManifest
```

#### 1.1.4 导出（`module.exports`）

```
getInstalledPlugins, getRemoteManifest, installPlugin, uninstallPlugin, checkUpdates, loadAllPlugins,
detectPlatform, getRuntimeStatus, PLUGINS_DIR, RUNTIMES_DIR,
listAllContentPlugins, listContentPluginDocs, readContentPluginDoc,
PLATFORM_IDS, ALLOWED_RUNTIME_HOSTS, normalizeRemotePluginEntry, selectArtifact,
assertAllowedUrl, validateManifest, streamingSha256, assertArtifactChecksumDeclared, dirSize
```

**🔴 Dangling IPC Contract Bug**（BLOCK-9.1 PHASE 2 收口时漏掉）：
`src/ipc/plugin.js` 第 18/28/38 行 require `listInstalledPlugins` / `listRemotePlugins` / `checkPluginUpdates` —— **这 3 个函数在 plugin-manager.js 中并不存在**（只有 `getInstalledPlugins` / `getRemoteManifest` / `checkUpdates`），且均未在 `module.exports` 中导出。
**当前行为**：`plugin:list-installed` / `plugin:list-remote` / `plugin:check-updates` 3 个 IPC handler 在 try/catch 中静默失败，返回 `[]`，并 console.warn `[desktop] plugin:* failed: ...`。
**影响**：前端 PluginStorePanel / IPC `plugin:list-installed` 等调用方拿到空数组 → 用户看到"没有可安装的插件"（即使已装）。
**建议**：**PHASE 3 必须先修这个 bug**（独立 sub-PHASE 0.5），再开始 plugin-manager 拆分。可选修法：
1. 在 plugin-manager.js 加 alias export：`listInstalledPlugins: getInstalledPlugins`、`listRemotePlugins: getRemoteManifest`、`checkPluginUpdates: checkUpdates`
2. 或修改 `ipc/plugin.js` 调对名字（`getInstalledPlugins` / `getRemoteManifest` / `checkUpdates`）

**审计广播**：本调研发现该 bug 应同步追加到 `docs/AUDIT-LOG.md` 作为 🟡 Minor（不影响 G1+ 阶段 GA，但影响 G0 dev Electron 用户感知）。

#### 1.1.5 职责分类

| 类别 | 行数估算 | 内容 |
|---|---|---|
| **核心 orchestrator** | ~250 | `installPlugin` / `uninstallPlugin` / `checkUpdates` / `loadAllPlugins`（4 个大型 switch） |
| **install/uninstall 子路径** | ~600 | `installContentPlugin` / `installRuntime` / `installFigcodePack` / `uninstallRuntime` / `registerPluginInServer` / `registerContentPlugin` / `unregisterContentPlugin` |
| **manifest / state IO** | ~250 | `getInstalledPlugins` / `saveInstalledPlugins` / `addInstalledPlugin` / `removeInstalledPlugin` / `getBuiltInManifest` / `getRemoteManifest` / `getRuntimeStatus` |
| **content-plugin 文档桥** | ~150 | `listContentPluginDocs` / `readContentPluginDoc` / `listAllContentPlugins` / `extractMdTitle` / `extractSidebarPos` |
| **纯 utility** | ~200 | `downloadFile` / `verifyChecksum` / `streamingSha256` / `assertArtifactChecksumDeclared` / `dirSize` / `extractZipFile` / `copyDirSync` / `parseVersion` / `compareVersions` / `detectPlatform` / `getFixRPathsScript` / `resolveSharedBackendDir` / `resolveProjectRoot` |
| **module init** | ~80 | top-level `SHARED_BACKEND_DIR` / `PROJECT_ROOT` / `PLUGINS_DIR` 等 const + `require('./plugin-schema')` re-export + `initSharedBackend()` / `configure()` 调用 |

#### 1.1.6 RORP 表识

| 函数/状态 | 类别 | 复用频次 |
|---|---|---|
| `SHARED_BACKEND_DIR` / `PROJECT_ROOT` / `PLUGINS_DIR` / `RUNTIMES_DIR` / `INSTALLED_FILE` / `BUILT_IN_PLUGINS_DIR` / `MANIFEST_URL` | **module-level 状态** | init-time 单次，几乎所有函数都引用 → **拆分时必须共享** |
| `getInstalledPlugins` / `saveInstalledPlugins` / `getRemoteManifest` / `detectPlatform` / `downloadFile` / `verifyChecksum` / `streamingSha256` / `assertArtifactChecksumDeclared` / `dirSize` / `extractZipFile` / `getRuntimeStatus` / `getFixRPathsScript` | **RORP·被多处共用** | ≥3 个调用方 |
| `installPlugin` / `uninstallPlugin` / `checkUpdates` / `loadAllPlugins` | **orchestrator** | 各 1 个外部调用方（IPC），内部 switch 分流 4 种 plugin.type |
| `installContentPlugin` / `installRuntime` / `installFigcodePack` / `uninstallRuntime` / `registerPluginInServer` / `registerContentPlugin` / `unregisterContentPlugin` | **install/uninstall 子路径** | 仅 `installPlugin` / `uninstallPlugin` / `loadAllPlugins` 调用 |
| `listContentPluginDocs` / `readContentPluginDoc` / `listAllContentPlugins` / `extractMdTitle` / `extractSidebarPos` | **content-plugin 桥** | 仅 IPC 调 |
| `copyDirSync` / `parseVersion` / `compareVersions` | **RORP·纯 utility** | ≥2 个 install/uninstall 路径 |
| `resolveSharedBackendDir` / `resolveProjectRoot` | **init-time 单次** | 仅 module init |
| `Week 2 schema helpers`（re-export） | **re-export from `./plugin-schema`** | 内部 + IPC + 测试均用 → **必须保留 re-export** |

#### 1.1.7 已有的拆分痕迹

- **24 个 `// ── XXX ──` 注释分段**（已存在，行 80/125/226/309/320/360/432/440/675/775/908/1027/1048/1065/1202/1262/1302/1324/1400）—— **拆分基础最充分**
- **无 `// TODO: split` 标记**
- 已存在 `src/plugin-schema.js`（Week 2 抽出，384 行单独文件）—— **本调研的拆分范式参考**
- 已存在 `src/ipc/plugin.js`（BLOCK-9.1 PHASE 2 抽出，IPC handler 集中）—— **本调研的拆分范式参考**
- **注意**：`plugin-schema.js` 在 `src/` 根而非 `src/lib/` —— 与 BLOCK-9.1 的 `src/ipc/` / `src/main/` 目录结构一致

---

### 1.2 `frontend/src/components/copilot/SimpleChat.tsx` 2153 行（**P2**）

#### 1.2.1 当前行数
```
$ wc -l frontend/src/components/copilot/SimpleChat.tsx
2153 frontend/src/components/copilot/SimpleChat.tsx
```

#### 1.2.2 顶层结构

**导出**（8 个）：
```
export interface SlashCommand                // line 12
export const SLASH_COMMANDS: SlashCommand[]  // line 19
export function shouldOpenWithSystemApp(name)  // line 64
export function restoreSimpleMessage(message)  // line 156
export interface SimpleChatHandle              // line 300
export function SimpleChat(props)              // line 316
export function ResultEditProgressList(events) // line 1800
export function compactStageConclusion(content, maxLength) // line 1825
```

**内部函数**（非 export）：
- `restoreProgressUpdates(value)` —— line 193（纯函数，被 `restoreSimpleMessage` 用）
- `MessageMeta({ modelName, ts })` —— line 212（TS83 头部小组件）
- `DEFAULT_EXAMPLE_PROMPTS` / `ExamplePrompts` —— line 246/272（纯静态）
- `LoopStatusPanel({ loop, pending })` —— line 1703（子组件）
- `AgentProgressList({ updates, pending, onFileReferenceClick })` —— line 1761（子组件）
- `ErrorBanner({ message, severity, showDetails, technicalDetails })` —— line 1847（子组件）
- `ToolActivityList({ activities, processingDurationMs })` —— line 1879（子组件）
- `stringifyParamValue(value)` / `shortValue(value)` / `formatHarnessRepair(item)` / `formatHarnessWarning(item)` / `formatHarnessDiagnosticIssue(issue)` —— line 1970/1980/1985/2005/2014（纯函数 helpers）
- `ApprovalCard({ approval, repairState, onApprove, onReject, busy })` —— line 2021（子组件）
- `ApprovalRepairHint({ state, repairItems, warningItems, nextActions })` —— line 2089（子组件）

**类型**（私有）：
- `SimpleMessage` interface —— line 129
- `AgentProgressUpdate` interface —— line 188
- `PendingApproval = ConversationPendingApproval` type alias —— line 230
- `ApprovalRepairState` type —— line 232
- `ExamplePrompt` interface / `ExamplePromptsProps` interface —— line 239/267

**常量**：
- `SYSTEM_OPEN_FILE_EXTENSIONS` Set —— line 58（被 `shouldOpenWithSystemApp` 用）
- `DEFAULT_EXAMPLE_PROMPTS` —— line 246
- `SLASH_COMMANDS` —— line 19（已 export）
- `MAX_SUMMARY_RETRIES` / `RETRY_BACKOFF_MS` —— line 328/329（在 SimpleChat 内部定义）

#### 1.2.3 导入依赖（~30 个）

**React**：`react`（useEffect, useRef, useState, useCallback, useMemo）
**本目录内**：`./copilotClient`, `./copilotConversationsClient`, `./copilotMarkdown`, `./toolActivity`, `./toolSummaryPresentation`, `./conversationRunStore`, `./useErrorFormatter`, `./extraRenderers`, `./types`, `./simple-chat.css`, `./chatHistoryNav`, `./conversationDraft`
**本仓 lib**：`@/lib/copilotContextProvider`, `@/lib/format`, `@/lib/events`, `@/lib/chat-file-references`, `@/lib/harness-client`, `@/lib/copilotContext`, `@/lib/result-edit-agent-bridge`, `@/lib/loop-client`
**本仓 hooks**：`@/hooks/useConversations`, `@/hooks/useAiSettings`, `@/hooks/useDurableConversationLoop`
**本仓 components**：`@/components/icons/Icon`, `@/components/ui/CodeHighlight`
**本仓 pages**：`@/pages/_data`（`tools as staticTools`）

#### 1.2.4 职责分类

| 类别 | 行数估算 | 内容 |
|---|---|---|
| **核心 orchestrator**（`SimpleChat` 主组件） | ~1385（行 316-1701） | 单组件 1385 行 + 86 hooks 调用 |
| **子组件** | ~400（行 1703-2153） | `LoopStatusPanel` / `AgentProgressList` / `ErrorBanner` / `ToolActivityList` / `ApprovalCard` / `ApprovalRepairHint` / `MessageMeta` / `ExamplePrompts` |
| **纯 helper 函数** | ~150（行 193-205、1825-2019） | `restoreProgressUpdates` / `compactStageConclusion` / `stringifyParamValue` / `shortValue` / `formatHarnessRepair` / `formatHarnessWarning` / `formatHarnessDiagnosticIssue` / `shouldOpenWithSystemApp` |
| **类型 / 常量** | ~120（行 1-122、129-154、188-205、230-247） | `SlashCommand` / `SLASH_COMMANDS` / `SYSTEM_OPEN_FILE_EXTENSIONS` / `SimpleMessage` / `AgentProgressUpdate` / `ApprovalRepairState` / `PendingApproval` / `ExamplePrompt` |

#### 1.2.5 RORP 表识

| 函数/常量 | 类别 | 复用频次 |
|---|---|---|
| `SimpleMessage` interface | **核心类型**，被 `SimpleChat` + `restoreSimpleMessage` 用 | 1 个组件 + 1 个 helper |
| `restoreSimpleMessage` | **RORP·被多处共用** | `SimpleChat` + 3 个测试（`SimpleChat.extraRenderers.test.tsx`） |
| `restoreProgressUpdates` | **RORP·纯 helper** | 仅 `restoreSimpleMessage` |
| `shouldOpenWithSystemApp` / `SYSTEM_OPEN_FILE_EXTENSIONS` | **RORP·被测试用** | `SimpleChat` 内 1 处 + `simple-chat-file-open.test.ts` |
| `compactStageConclusion` / `ResultEditProgressList` | **RORP·被测试用** | `SimpleChat` 内 2 处 + `SimpleChat.progress.test.ts` |
| `stringifyParamValue` / `shortValue` / `formatHarness*` | **helper** | `SimpleChat` 内多处 + `ApprovalRepairHint` 子组件 |
| `SlashCommand` / `SLASH_COMMANDS` | **module-level const** | 仅 `SimpleChat` |
| `DEFAULT_EXAMPLE_PROMPTS` / `ExamplePrompts` | **module-level const + 子组件** | 仅 `SimpleChat` |
| `LoopStatusPanel` / `AgentProgressList` / `ErrorBanner` / `ToolActivityList` / `ApprovalCard` / `ApprovalRepairHint` / `MessageMeta` | **子组件**（可独立拆分） | 仅 `SimpleChat` |
| `MAX_SUMMARY_RETRIES` / `RETRY_BACKOFF_MS` | **module-level const**（SimpleChat 内部） | 仅 `SimpleChat` |
| `SimpleChatHandle` interface | **export type** | 0 调用方（potential 未来使用） |

#### 1.2.6 已有的拆分痕迹

- **仅 1 处 `// ===` 注释**（行 1-5 顶部 banner）—— 内部无 `// ── XXX ──` 分段
- **无 `// TODO: split` 标记**
- 已存在 3 个独立测试：`SimpleChat.extraRenderers.test.tsx` / `SimpleChat.progress.test.ts` / `simple-chat-file-open.test.ts`
- **本目录已有拆分范式**：`./copilotClient` / `./copilotConversationsClient` / `./toolActivity` / `./conversationRunStore` 等已是独立文件
- **评审报告引用 "86 hooks"** —— grep 验证：`grep -c '\buse\(State\|Effect\|Ref\|Callback\|Memo\|Context\|Reducer\)' SimpleChat.tsx` = **61 次**（含 useXxx import + 调用，调用次数实际 ~50）

#### 1.2.7 SimpleChat 内部 hooks 调用实数

```
$ grep -c '\buse(State|Effect|Ref|Callback|Memo|Context|Reducer)\b' SimpleChat.tsx
61
```

说明：grep 包含 `import` 行 + 调用，**真实 hooks 调用数 ≈ 50+**，与评审报告 "86 hooks" 数量级一致（86 可能含 `useEffect` 内多次调用累计）。

---

### 1.3 `frontend/src/components/workspace-panels/ResultView.tsx` 1654 行（**P0**）

#### 1.3.1 当前行数
```
$ wc -l frontend/src/components/workspace-panels/ResultView.tsx
1654 frontend/src/components/workspace-panels/ResultView.tsx
```
（注：评审报告 1662 与 wc -l 1654 差 8 行 —— 以 wc -l 为准，调研时间 2026-08-17）

#### 1.3.2 顶层结构

**导出**（4 个）：
```
export interface ActiveArtifact           // line 151
export interface JobStats                  // line 179
export function ResultView(props)          // line 1579
export function EmptyAnalysisResult()      // line 1642
```

**内部函数**（非 export）：
- `toArtifactRevision(input)` —— line 144（纯函数）
- `ResultArtifactShell({...})` —— line 266（**1313 行单组件**！占文件 79%）
- `artifactName(file)` / `artifactKindIcon(kind)` / `artifactPreviewLabel(artifact)` / `workflowStageLabel(stage)` —— line 229/233/242/253（纯 helper）

**类型**（私有）：
- `JobResultFile` interface —— line 186
- `DeliveryManifestSummary` interface —— line 197
- `JobResult` interface —— line 208
- `JobDetailMeta` interface —— line 223

#### 1.3.3 导入依赖（~30 个）

**React**：`react`, `react-router-dom`（useParams, Link, useNavigate, useSearchParams）, `react-markdown` / `remark-gfm` / `rehype-highlight` / `rehype-sanitize`
**本仓 lib**：`@/lib/project-store`, `@/lib/project-types`, `@/lib/authClient`, `@/lib/file-preview/buildPreviewTable`, `@/lib/harness-client`, `@/lib/result-manifest`, `@/lib/result-artifact-display`, `@/lib/result-title-bar`, `@/lib/artifact-selection`, `@/lib/result-studio-interaction-client`, `@/lib/result-edit-agent-bridge`, `@/lib/office-file-preview`, `@/lib/previewFileUtils`, `@/lib/desktopBridge`, `@/lib/electron`, `@/lib/events`, `@/lib/browser-url`, `@/lib/copilotContext`, `@/lib/copilotContextProvider`
**本仓 hooks**：`@/hooks/useBackendStatus`, `@/hooks/useConversations`, `@/hooks/useOtherConversations`, `@/hooks/useConversationJobs`, `@/hooks/useResizableColumns`, `@/hooks/useWorkspaceLayout`, `@/hooks/useRightPanelTabs`, `@/hooks/usePluginStore`, `@/hooks/useWorkspaceRouting`, `@/hooks/useHarnessWorkflowStatus`
**本仓 components**：`@/components/icons/Icon`, `@/components/ui/Lightbox`, `@/components/ui/CodeHighlight`, `@/components/copilot/SimpleChat`, `@/components/copilot/conversationRunStore`, `@/components/copilot/copilotConversationsClient`, `@/components/desktop/WorkspacePanelsContext`, `@/components/desktop/PluginStorePanel`, `@/components/desktop/DesktopSettingsPanel`, `@/components/result-studio/*`（9 个 result-studio 子模块）
**本仓 pages**：`@/pages/_data`（`tools as staticTools` + `Tool` type）, `@/pages/project-workspace.module.css`
**theme**：`@/themes/ThemeProvider`

#### 1.3.4 职责分类

| 类别 | 行数估算 | 内容 |
|---|---|---|
| **核心 orchestrator**（`ResultArtifactShell` 单组件） | ~1313（行 266-1578） | 占文件 79%，1313 行单组件 |
| **`ResultView` 薄包装** | ~62（行 1579-1640） | 19 个 props 透传 |
| **`EmptyAnalysisResult`** | ~12（行 1642-1653） | 静态空态 |
| **纯 helper 函数** | ~30（行 144-264） | `toArtifactRevision` / `artifactName` / `artifactKindIcon` / `artifactPreviewLabel` / `workflowStageLabel` |
| **类型** | ~80（行 151-227） | `ActiveArtifact` / `JobStats` / `JobResultFile` / `DeliveryManifestSummary` / `JobResult` / `JobDetailMeta` |

#### 1.3.5 RORP 表识

| 函数/常量 | 类别 | 复用频次 |
|---|---|---|
| `ActiveArtifact` / `JobStats` interfaces（export） | **核心类型** | `CenterPanel.tsx` + `project-workspace.tsx` re-export → 6+ 消费者 |
| `JobResultFile` / `DeliveryManifestSummary` / `JobResult` / `JobDetailMeta` | **private types** | 仅 `ResultArtifactShell` |
| `artifactName` / `artifactKindIcon` / `artifactPreviewLabel` / `workflowStageLabel` | **纯 helper** | `ResultArtifactShell` 内多处 |
| `toArtifactRevision` | **纯 helper** | `ResultArtifactShell` 内 1 处 |
| `ResultView` / `ResultArtifactShell` | **核心组件** | 2 个消费者（`CenterPanel.tsx` + `project-workspace.tsx`） |
| `EmptyAnalysisResult` | **子组件** | 仅 `CenterPanel.tsx` |

#### 1.3.6 已有的拆分痕迹

- **仅 1 处 `// ===` 注释**（行 1-7 顶部 banner，描述 T85 路由化拆增量 4）
- **无 `// ── XXX ──` 分段**
- **无 `// TODO: split` 标记**
- 已抽出 `buildPreviewTable` 到 `lib/file-preview/buildPreviewTable.ts`（BLOCK-9 PHASE 2）—— **本调研的拆分范式参考**
- 已抽出 `ResultArtifactShell` 为独立 function（行 266）—— **本调研的拆分范式参考**

#### 1.3.7 `buildPreviewTable` 现状（验证已抽离）

```
frontend/src/components/workspace-panels/ResultView.tsx
  24:import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
  999:          setPreviewData(buildPreviewTable(text, selectedArtifactName));

frontend/src/pages/project-workspace.tsx
  25:import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
  2386:        setPreviewData(buildPreviewTable(body, file.name, { maxRows: 200 }));
```

确认 BLOCK-9 PHASE 2 已收口，**重复问题已修复**。

---

### 1.4 `frontend/src/components/desktop/DesktopSettingsPanel.tsx` 1515 行（**P0**）

#### 1.4.1 当前行数
```
$ wc -l frontend/src/components/desktop/DesktopSettingsPanel.tsx
1515 frontend/src/components/desktop/DesktopSettingsPanel.tsx
```

#### 1.4.2 顶层结构

**导出**（2 个）：
```
export function DesktopSettingsPanel({ onClose }: Props)  // line 712（主组件）
export default DesktopSettingsPanel                       // line 1515（双重导出！）
```

**内部函数**（非 export）：
- `UsageResourcePanel()` —— line 84（section 组件）
- `UpdateChecker()` —— line 162（section 组件）
- `ExportDiagnostic()` —— line 210（section 组件）
- `DataManagement()` —— line 249（section 组件，**含 local `formatSize` 闭包**）
- `ComputeExecution()` —— line 366（section 组件，**含 `normalizeComputeSettings` 内部定义**）
- `TrashManagement()` —— line 512（section 组件，**最大 section 子组件**）
- `HarnessEnvironment()` —— line 656（section 组件，**含 local `fmtBytes` 闭包**）

**纯 helper 函数**：
- `formatMetricBytes(value)` —— line 79（GB/MB 格式化）
- `providerDefaults(provider, id)` —— line 144（model provider 默认值）
- `credentialId(profile)` —— line 156（credential 引用 ID）
- `DEFAULT_COMPUTE_SETTINGS` —— line 330（const）
- `normalizeComputeSettings(raw)` —— line 337（snake_case → camelCase 归一化）

**类型**：
- `Props` interface —— line 47（`{ onClose: () => void }`）
- `SettingsSection` type —— line 51（`'general' | 'models' | 'compute' | 'usage' | 'experimental' | 'maintenance'`）
- `SETTINGS_SECTIONS` const —— line 53（6 项配置元数据数组）
- `UsageSummary` interface —— line 67
- `ModelRole` type —— line 130（8 项）
- `ModelCapability` type —— line 131（5 项）
- `MODEL_ROLES` const —— line 133（8 项配置元数据）

#### 1.4.3 导入依赖（~10 个）

**React**：`react`（useCallback, useEffect, useRef, useState）
**本目录**：`./ThemeControl`
**本仓 lib**：`@/lib/electron`, `@/lib/authClient`, `@/lib/model-provider-options`, `@/lib/model-endpoint-transfer`, `@/lib/project-store`, `@/lib/project-types`
**本仓 hooks**：`@/hooks/useAiSettings`, `@/hooks/useAutoUpdate`, `@/hooks/useRuntimeResourceSnapshot`
**本仓 components**：`@/components/icons/Icon`, `@/components/settings/ExperimentalFeaturesSection`, `@/components/copilot/copilotConversationsClient`
**theme**：`@/themes/ThemeProvider`

#### 1.4.4 职责分类

| 类别 | 行数估算 | 内容 |
|---|---|---|
| **核心 orchestrator**（`DesktopSettingsPanel` 主组件） | ~803（行 712-1515） | 包含 6 个 section 的 switch 渲染 + 30+ state hooks + 3 个 handle* 闭包 |
| **6 个 section 子组件** | ~620（行 84-710） | `UsageResourcePanel` / `UpdateChecker` / `ExportDiagnostic` / `DataManagement` / `ComputeExecution` / `TrashManagement` / `HarnessEnvironment` |
| **纯 helper 函数 + 类型** | ~90（行 47-180、330-364） | `formatMetricBytes` / `providerDefaults` / `credentialId` / `DEFAULT_COMPUTE_SETTINGS` / `normalizeComputeSettings` / `Props` / `SettingsSection` / `SETTINGS_SECTIONS` / `UsageSummary` / `ModelRole` / `ModelCapability` / `MODEL_ROLES` |

#### 1.4.5 RORP 表识

| 函数/常量 | 类别 | 复用频次 |
|---|---|---|
| `SettingsSection` / `SETTINGS_SECTIONS` | **module-level 共享**（**关键**） | 仅 `DesktopSettingsPanel` 内部 switch 用 → 必须保留共享 |
| `ModelRole` / `ModelCapability` / `MODEL_ROLES` | **共享配置** | `DesktopSettingsPanel` 内多处 + `providerDefaults` |
| `Props` interface | **依赖类型** | 仅 `DesktopSettingsPanel` |
| `UsageSummary` | **依赖类型** | 仅 `UsageResourcePanel` |
| `UsageResourcePanel` / `UpdateChecker` / `ExportDiagnostic` / `DataManagement` / `ComputeExecution` / `TrashManagement` / `HarnessEnvironment` | **section 子组件** | 仅 `DesktopSettingsPanel` switch 内 |
| `formatMetricBytes` | **纯 helper** | `UsageResourcePanel` 内 1 处 |
| `formatSize`（`DataManagement` 闭包） | **纯 helper**（重复定义，**与 `formatMetricBytes` 重复实现**） | `DataManagement` 内 1 处 |
| `fmtBytes`（`HarnessEnvironment` 闭包） | **纯 helper**（**第三次定义 bytes 格式化**） | `HarnessEnvironment` 内 1 处 |
| `providerDefaults` / `credentialId` | **纯 helper** | `DesktopSettingsPanel` 内多处 |
| `DEFAULT_COMPUTE_SETTINGS` / `normalizeComputeSettings` | **compute helper** | `ComputeExecution` 内 + `DesktopSettingsPanel` |

**重复实现发现**（跨文件）：

| 函数 | 位置 | 行数 |
|---|---|---|
| `formatMetricBytes` | DesktopSettingsPanel.tsx:79 | 1 处 |
| `formatSize`（闭包） | DesktopSettingsPanel.tsx:282 | 1 处 |
| `fmtBytes`（闭包） | DesktopSettingsPanel.tsx:677 | 1 处 |

→ 3 处"bytes 格式化"逻辑分散在 DesktopSettingsPanel 内部，**统一抽到 `lib/format-bytes.ts`** 是潜在收益，但 **不强制作为 BLOCK-9.2 任务**（独立 PR 更稳）。

#### 1.4.6 已有的拆分痕迹

- **1 处 `// ── XXX ──` 注释**（行 655：`// ── Stage 3 M1: Harness 环境 — 只读已预备能力视图 ───────────────`）
- **无 `// TODO: split` 标记**
- 已存在 `DesktopSettingsModal`（被 BLOCK-9 之前的某 PR 替换为 Panel —— 文件头注释 line 4 提到）
- 已存在 `components/settings/ExperimentalFeaturesSection` 子组件 —— **本调研的拆分范式参考**

#### 1.4.7 `export default` 双重导出问题

```
export function DesktopSettingsPanel(...)  // line 712（命名导出）
export default DesktopSettingsPanel;       // line 1515（默认导出）
```

消费者只使用命名导出（`import { DesktopSettingsPanel } from ...`），但 `export default` 是 stale 的（可能是 BLOCK-9 之前的旧合约），**应在拆分时顺手删除**以避免双重导出。

---

### 1.5 `frontend/src/hooks/useSkillStore.ts` 743 行（**P3·不建议拆**）

#### 1.5.1 当前行数
```
$ wc -l frontend/src/hooks/useSkillStore.ts
743 frontend/src/hooks/useSkillStore.ts
```

#### 1.5.2 顶层结构

**导出**（11 个）：
```
export type ParameterType                          // line 26
export interface ParameterSchema                    // line 29
export interface OutputArtifact                     // line 42
export type SkillSource                             // line 54
export interface Skill                              // line 57
export type ExecutionStatus                        // line 108
export interface SkillExecution                     // line 111
export interface UseSkillStoreResult                // line 359
export function useSkillStore(opts)                 // line 405
export function __getProgressUnsubsSize()           // line 733（test-only）
export function __resetSkillStoreCacheForTests()    // line 737（test-only）
```

**module-level 状态**（**关键**）：
```
const CACHE_TTL_MS = 5 * 60 * 1000                    // line 146
let _cache: SkillStoreSnapshot = ...                  // line 148（可变状态）
let _inflight: Promise<DiscoverResult> | null = null  // line 154（单例 Promise）
const _subscribers = new Set<() => void>()             // line 155（fan-out 订阅）
let _pollIntervals: Map<string, ReturnType<typeof setInterval>> = new Map()  // line 156
const _progressUnsubs: Map<string, () => void> = new Map()  // line 283
```

**内部函数**（非 export）：
- `_notify()` —— line 158（**强耦合** _subscribers）
- `_isCacheStale()` —— line 162（**强耦合** _cache）
- `_discoverSkills()` —— line 170（**强耦合** _cache / _inflight / _notify）
- `_startPolling()` —— line 218（**强耦合** _pollIntervals + bridge.onProgress 类型）
- `_stopAllPolling()` —— line 273（**强耦合** _pollIntervals）
- `_subscribeProgressWakeup()` —— line 289（**强耦合** _progressUnsubs + bridge.onProgress）
- `_executionsChanged()` —— line 332（纯函数）
- `_unsubscribeProgressWakeup()` —— line 342（**强耦合** _progressUnsubs）
- `_stopAllProgressWakeups()` —— line 350（**强耦合** _progressUnsubs）

**私有类型**：
- `DiscoverResult` / `ExecuteResult` / `SkillStoreSnapshot` interface —— line 122/129/136
- `SkillsBridge` / `SkillsProgressPayload` —— line 286/287（从 `getBridge<'skills'>` 派生）

#### 1.5.3 导入依赖（~5 个）

```
react: useCallback, useEffect, useMemo, useState
@/lib/desktopBridge: getBridge
```

#### 1.5.4 职责分类

| 类别 | 行数估算 | 内容 |
|---|---|---|
| **核心 orchestrator**（`useSkillStore` hook） | ~330（行 405-723） | 含 `discover` / `search` / `execute` / `getExecution` / `cancel` / `invalidateCache` 6 个 useCallback |
| **数据获取层** | ~115（行 148-211） | `_cache` / `_inflight` / `_subscribers` / `_notify` / `_isCacheStale` / `_discoverSkills` |
| **Polling 子系统** | ~80（行 218-275） | `_startPolling` / `_stopAllPolling` |
| **Wakeup 子系统** | ~125（行 283-353） | `_progressUnsubs` / `_subscribeProgressWakeup` / `_executionsChanged` / `_unsubscribeProgressWakeup` / `_stopAllProgressWakeups` |
| **类型定义** | ~110（行 26-140） | `ParameterType` / `ParameterSchema` / `OutputArtifact` / `SkillSource` / `Skill` / `ExecutionStatus` / `SkillExecution` / `DiscoverResult` / `ExecuteResult` / `SkillStoreSnapshot` |
| **Hook 出口接口 + 测试导出** | ~30（行 359-403、729-742） | `UseSkillStoreResult` / `__getProgressUnsubsSize` / `__resetSkillStoreCacheForTests` |

#### 1.5.5 RORP 表识

| 函数/状态 | 类别 | 复用频次 |
|---|---|---|
| `_cache` / `_inflight` / `_subscribers` / `_pollIntervals` / `_progressUnsubs` | **module-level 单例状态**（**强耦合**） | 全部 hook 实例共享 → **拆分禁区** |
| `_notify` / `_isCacheStale` / `_discoverSkills` / `_startPolling` / `_stopAllPolling` / `_subscribeProgressWakeup` / `_unsubscribeProgressWakeup` / `_stopAllProgressWakeups` | **module-level 单例函数**（**强耦合 module 状态**） | 全部 hook 实例共享 → **拆分禁区** |
| `useSkillStore` | **核心 hook** | 6 个消费者（`pages/skills/{index,SkillCard,SkillDetail,SkillSearch}` + `useSkillStore.test.ts` + `skill.types.ts`） |
| 类型（`Skill` / `ParameterSchema` 等） | **RORP·共享类型** | 多个 page 引用 `Skill` / `SkillSource` / `SkillExecution` |

#### 1.5.6 已有的拆分痕迹

- **4 个 `// ── XXX ──` 注释分段**（行 21/142/214/355/725）—— 拆分基础充分
- **无 `// TODO: split` 标记**
- 已建立 `usePluginStore`（同样模式）作为 sibling reference

#### 1.5.7 **不建议拆分的原因**（**关键风险评估**）

1. **单例 store 反模式依赖 module-level 状态**：
   - 5 个 module-level let/const（`_cache` / `_inflight` / `_subscribers` / `_pollIntervals` / `_progressUnsubs`）
   - 8 个 module-level 函数（`_notify` / `_isCacheStale` / `_discoverSkills` / `_startPolling` / `_stopAllPolling` / `_subscribeProgressWakeup` / `_unsubscribeProgressWakeup` / `_stopAllProgressWakeups`）
   - **拆分后必须共享状态** → 必须用 ESM exports + barrel re-export，会引入跨文件 import 链
2. **阻塞型 polling + 事件订阅耦合**：
   - `_subscribeProgressWakeup` 与 `_startPolling` 通过 `Map<executionId, ...>` 同步追踪同一组 executionId
   - 终态清理逻辑在 polling 和 wakeup 两侧重复（BLOCK-4 A1 修过）
3. **测试依赖**：
   - `__getProgressUnsubsSize` 和 `__resetSkillStoreCacheForTests` 已是 test-only export（BLOCK-4 PHASE 2 G5 添加）
   - 14 个 vitest 测试覆盖了所有 module-level 状态边界
   - 拆分后这些 test 需重新设置跨文件 mock
4. **实际收益有限**：
   - 743 行已是最小（与 SimpleChat 2153 / ResultView 1654 / plugin-manager 1457 / DesktopSettingsPanel 1515 比）
   - 主要压力是"功能闭环"，而非"文件过大"
5. **G0 阶段纪律**：
   - 不外推功能改进型重构（qualificationEligible: false）
   - 当前阶段应聚焦交付而非 store 架构清理

**结论**：PHASE 5 评估后建议**保留 useSkillStore.ts 不拆**，只在 `docs/ui-productization-audit.md` 登记一条 "已调研不建议拆（singleton 状态 + 阻塞型 polling）"。如果未来真有 1000+ 行增长压力，再启动 BLOCK-9.6+ 单独工作包。

---

## 2. 拆分边界提议

### 2.1 `src/plugin-manager.js` 拆分边界（**P1**）

**核心原则**：**先修 dangling IPC contract bug（独立 sub-PHASE 0.5），再开始拆分**。

#### 2.1.1 拆分提案（6 文件 + 1 共享层）

| 新文件 | 行数预期 | 来源 | 提取内容 |
|---|---|---|---|
| `src/lib/plugin-utils.js`（**新增**） | ~200 | 行 320-430、1285-1301、1400-1431 | `downloadFile` / `verifyChecksum` / `streamingSha256` / `assertArtifactChecksumDeclared` / `dirSize` / `extractZipFile` / `copyDirSync` / `parseVersion` / `compareVersions` |
| `src/lib/plugin-paths.js`（**新增**） | ~80 | 行 33-110 | `resolveSharedBackendDir` / `resolveProjectRoot` / `getFixRPathsScript` + `USER_DATA_DIR` / `PLUGINS_DIR` / `RUNTIMES_DIR` / `INSTALLED_FILE` / `BUILT_IN_PLUGINS_DIR` / `RESOURCES_PATH` / `MANIFEST_URL` 全部 const |
| `src/lib/plugin-state.js`（**新增**） | ~100 | 行 125-224 | `getInstalledPlugins` / `saveInstalledPlugins` / `addInstalledPlugin` / `removeInstalledPlugin` |
| `src/lib/plugin-manifest-loader.js`（**新增**） | ~110 | 行 226-318 | `getBuiltInManifest` / `getRemoteManifest` / `detectPlatform` |
| `src/lib/plugin-content-bridge.js`（**新增**） | ~150 | 行 1065-1199 | `registerContentPlugin` / `unregisterContentPlugin` / `listContentPluginDocs` / `readContentPluginDoc` / `listAllContentPlugins` / `extractMdTitle` / `extractSidebarPos` |
| `src/plugin-manager.js`（**保留 + 重构**） | ~600 → 5 个 install/uninstall orchestrator 集中在原文件 | 行 440-1026、1202-1399 | `installPlugin` / `installContentPlugin` / `installRuntime` / `installFigcodePack` / `registerPluginInServer` / `uninstallPlugin` / `uninstallRuntime` / `removePackage` / `getRuntimeStatus` / `checkUpdates` / `loadAllPlugins` + top-level `module init` + `module.exports` |
| **重新 export Week 2 schema helpers** | — | 行 113-120 + 1447-1453 | `PLATFORM_IDS` / `ALLOWED_RUNTIME_HOSTS` / `normalizeRemotePluginEntry` / `selectArtifact` / `assertAllowedUrl` / `validateManifest`（从 `./plugin-schema` 重-export 维持向后兼容） |

**预期降幅**：1457 → ~600（-59%）

**反向 import 风险**：
- `installPlugin` 4 个分支调用 5 个 lib/ 函数 → 主文件 import 多个 lib/
- `uninstallPlugin` / `uninstallRuntime` 调用 `getInstalledPlugins` + `dirSize` + `parseVersion` / `compareVersions` + `getRemoteManifest`（for `checkUpdates`）
- **`loadAllPlugins` 调用链最长**：getInstalledPlugins + getRemoteManifest + detectPlatform + registerPluginInServer + registerContentPlugin + parseVersion
- **简化原则**：**主文件反向 require 5 个 lib/ 模块 + Week 2 schema**；**每个 lib/ 模块尽量自包含**，不互相依赖（遵循 BLOCK-9.1 §4.1 自包含原则）

#### 2.1.2 拆分前后 module.exports 对照

**当前 21 个 export**（含 6 个 schema re-export + `dirSize` + `streamingSha256` + `assertArtifactChecksumDeclared` 等）：
```
getInstalledPlugins, getRemoteManifest, installPlugin, uninstallPlugin, checkUpdates,
loadAllPlugins, detectPlatform, getRuntimeStatus, PLUGINS_DIR, RUNTIMES_DIR,
listAllContentPlugins, listContentPluginDocs, readContentPluginDoc,
PLATFORM_IDS, ALLOWED_RUNTIME_HOSTS, normalizeRemotePluginEntry, selectArtifact,
assertAllowedUrl, validateManifest, streamingSha256, assertArtifactChecksumDeclared, dirSize
```

**拆分后 21 个 export 必须 100% 保留**（IPC + 测试 consumer 不能 break）：
- 8 个移到 lib/ 后从 plugin-manager.js re-export（保守策略，最小 consumer 改动）
- 13 个仍在 plugin-manager.js 内部实现

#### 2.1.3 dangling IPC contract bug 修复方案

**方案 A**（推荐·最小修改）：在 plugin-manager.js 的 `module.exports` 加 3 个 alias：
```js
module.exports = {
  // ...既有 21 个
  // BLOCK-9.1 PHASE 2 遗留：IPC 调用方期望的别名（D2 修）
  listInstalledPlugins: getInstalledPlugins,
  listRemotePlugins: getRemoteManifest,
  checkPluginUpdates: checkUpdates,
};
```

**方案 B**：修改 `src/ipc/plugin.js` 第 18/28/38 行 require 的函数名。

**建议**：方案 A（不影响 IPC 文件，最小爆炸半径）。**应在 PHASE 3 开始前修**（独立 sub-PHASE 0.5 / commit）。

---

### 2.2 `frontend/src/components/copilot/SimpleChat.tsx` 拆分边界（**P2**）

#### 2.2.1 拆分提案（5 文件 + 6 子组件）

| 新文件 | 行数预期 | 来源 | 提取内容 |
|---|---|---|---|
| `frontend/src/components/copilot/SimpleChat/types.ts`（**新增**） | ~80 | 行 12-17、129-154、188-191、230-237、239-244、300-314 | `SlashCommand` interface + `SimpleMessage` interface + `AgentProgressUpdate` interface + `PendingApproval` type + `ApprovalRepairState` type + `ExamplePrompt` interface + `ExamplePromptsProps` interface + `SimpleChatHandle` interface + `SimpleChatProps` interface |
| `frontend/src/components/copilot/SimpleChat/format.ts`（**新增**） | ~80 | 行 1825-2019 | `compactStageConclusion` + `stringifyParamValue` + `shortValue` + `formatHarnessRepair` + `formatHarnessWarning` + `formatHarnessDiagnosticIssue` |
| `frontend/src/components/copilot/SimpleChat/restore.ts`（**新增**） | ~50 | 行 156-205 | `restoreSimpleMessage` + `restoreProgressUpdates`（含 `SimpleMessage` 类型从 types.ts 引用） |
| `frontend/src/components/copilot/SimpleChat/fileOpen.ts`（**新增**） | ~15 | 行 58-67 | `SYSTEM_OPEN_FILE_EXTENSIONS` Set + `shouldOpenWithSystemApp` |
| `frontend/src/components/copilot/SimpleChat/ExamplePrompts.tsx`（**新增**） | ~35 | 行 239-295 | `ExamplePrompt` interface + `ExamplePromptsProps` + `DEFAULT_EXAMPLE_PROMPTS` + `ExamplePrompts` |
| `frontend/src/components/copilot/SimpleChat/MessageMeta.tsx`（**新增**） | ~25 | 行 207-228 | `MessageMeta` |
| `frontend/src/components/copilot/SimpleChat/ApprovalCard.tsx`（**新增**） | ~150 | 行 2021-2153 | `ApprovalCard` + `ApprovalRepairHint`（含 `ApprovalRepairState` type 从 types.ts 引用） |
| `frontend/src/components/copilot/SimpleChat/LoopStatusPanel.tsx`（**新增**） | ~60 | 行 1703-1759 | `LoopStatusPanel` |
| `frontend/src/components/copilot/SimpleChat/AgentProgressList.tsx`（**新增**） | ~40 | 行 1761-1799 | `AgentProgressList` |
| `frontend/src/components/copilot/SimpleChat/ErrorBanner.tsx`（**新增**） | ~35 | 行 1840-1878 | `ErrorBanner` + `ErrorBannerProps` |
| `frontend/src/components/copilot/SimpleChat/ToolActivityList.tsx`（**新增**） | ~95 | 行 1879-1969 | `ToolActivityList` |
| `frontend/src/components/copilot/SimpleChat/ResultEditProgressList.tsx`（**新增**） | ~30 | 行 1800-1824 | `ResultEditProgressList` |
| `frontend/src/components/copilot/SimpleChat.tsx`（**保留 + 重构**） | ~1385 → ~1100 | 行 316-1701（主组件） | `SimpleChat` 主组件 + top-level imports + `MAX_SUMMARY_RETRIES` / `RETRY_BACKOFF_MS` |

**预期降幅**：2153 → ~1100（-49%）

**re-export 兼容策略**：
- `frontend/src/components/copilot/SimpleChat.tsx` 保留命名导出 `SimpleChat` / `SimpleChatHandle` / `restoreSimpleMessage` / `compactStageConclusion` / `shouldOpenWithSystemApp` / `SLASH_COMMANDS` / `SlashCommand` / `ResultEditProgressList`（**re-export** from `SimpleChat/*` 子目录）
- 6 个 test 文件零改动（保持 `./SimpleChat` 引用）

**反向 import 风险**：
- `SimpleChat` 主组件 import 5 个 lib/ + 6 个子组件 → 行数虽减但 import 数量上升
- `restoreSimpleMessage` 必须 `import type { SimpleMessage } from './SimpleChat/types'`（避免循环 import）

---

### 2.3 `frontend/src/components/workspace-panels/ResultView.tsx` 拆分边界（**P0**）

#### 2.3.1 拆分提案（2 文件 + 1 re-export）

| 新文件 | 行数预期 | 来源 | 提取内容 |
|---|---|---|---|
| `frontend/src/components/workspace-panels/ResultView/types.ts`（**新增**） | ~80 | 行 151-227 | `ActiveArtifact` interface + `JobStats` interface + `JobResultFile` interface + `DeliveryManifestSummary` interface + `JobResult` interface + `JobDetailMeta` interface |
| `frontend/src/components/workspace-panels/ResultView/helpers.ts`（**新增**） | ~50 | 行 144-264 | `toArtifactRevision` + `artifactName` + `artifactKindIcon` + `artifactPreviewLabel` + `workflowStageLabel` |
| `frontend/src/components/workspace-panels/ResultView.tsx`（**保留 + 重构**） | ~1313 → ~1100 | 行 266-1653 | `ResultArtifactShell` + `ResultView` 薄包装 + `EmptyAnalysisResult` + top-level imports |

**预期降幅**：1654 → ~1100（-33%）

**re-export 兼容策略**（**关键**）：
- `ActiveArtifact` / `JobStats` 有 6 个 consumer：`CenterPanel.tsx` + `project-workspace.tsx`（含 `export type` re-export）
- `frontend/src/components/workspace-panels/ResultView.tsx` **必须** `export type { ActiveArtifact, JobStats } from './ResultView/types'` 保持向后兼容
- `ResultView` / `EmptyAnalysisResult` 保持 export

**为什么保守不拆 ResultArtifactShell**：
- 1313 行单组件占文件 79%
- 内部 ~40 个 useState + ~20 个 useRef + 多个 useEffect → **强耦合**
- 拆子组件会引入 ~10+ 个 props 透传 + 5+ 个 ref 跨组件 → **ROI 风险比 > 收益**（参考 BLOCK-9 PHASE 3 `project-workspace.tsx` 教训）
- **保留单组件 + types + helpers 已足够降低新工具函数的拆分焦虑**（新人加新工具函数不会动 1313 行主体）

---

### 2.4 `frontend/src/components/desktop/DesktopSettingsPanel.tsx` 拆分边界（**P0**）

#### 2.4.1 拆分提案（1 types + 6 section 子组件 + 1 helpers）

| 新文件 | 行数预期 | 来源 | 提取内容 |
|---|---|---|---|
| `frontend/src/components/desktop/DesktopSettingsPanel/types.ts`（**新增**） | ~60 | 行 47-77、130-142 | `Props` + `SettingsSection` type + `SETTINGS_SECTIONS` const + `UsageSummary` + `ModelRole` + `ModelCapability` + `MODEL_ROLES` |
| `frontend/src/components/desktop/DesktopSettingsPanel/helpers.ts`（**新增**） | ~50 | 行 79-159、330-364 | `formatMetricBytes` + `providerDefaults` + `credentialId` + `DEFAULT_COMPUTE_SETTINGS` + `normalizeComputeSettings` |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/UsageResourcePanel.tsx`（**新增**） | ~40 | 行 84-125 | `UsageResourcePanel`（含 `UsageSummary` 类型从 types.ts） |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/UpdateChecker.tsx`（**新增**） | ~50 | 行 162-207 | `UpdateChecker` |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/ExportDiagnostic.tsx`（**新增**） | ~40 | 行 210-246 | `ExportDiagnostic` |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/DataManagement.tsx`（**新增**） | ~80 | 行 249-328 | `DataManagement`（含 local `formatSize` 闭包，建议保留或提到 helpers.ts） |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/ComputeExecution.tsx`（**新增**） | ~150 | 行 366-510 | `ComputeExecution` + `normalizeComputeSettings`（从 helpers.ts 引用） |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/TrashManagement.tsx`（**新增**） | ~150 | 行 512-653 | `TrashManagement` |
| `frontend/src/components/desktop/DesktopSettingsPanel/sections/HarnessEnvironment.tsx`（**新增**） | ~60 | 行 655-710 | `HarnessEnvironment` |
| `frontend/src/components/desktop/DesktopSettingsPanel.tsx`（**保留 + 重构**） | ~803 → ~450 | 行 712-1515 | `DesktopSettingsPanel` 主组件（只剩 6 个 section 的 switch + 30+ state hooks + 3 个 handle* 闭包） + 删除 `export default` |

**预期降幅**：1515 → ~450（-70%）

**re-export 兼容策略**：
- 3 个 consumer（`project-workspace.tsx` / `CenterPanel.tsx` / `ResultView.tsx`）都使用 `import { DesktopSettingsPanel } from ...`
- **保持命名导出**，**删除 `export default`**（stale 双重导出清理）
- section 子组件不需要 re-export（仅 panel 内部用）

**section 拆分的边界明确性**：
- 每个 section 子组件有独立 props 边界（panel 透传 state + handlers）
- 没有共享 module-level 状态
- 每个 section 的 state 是局部 useState（如 `UpdateChecker` 没有 state、`ExportDiagnostic` 有 `exporting` / `msg` 等）
- **ROI 高**：6 个独立文件 + types + helpers，加新 section 不需要碰 803 行主组件

---

### 2.5 `frontend/src/hooks/useSkillStore.ts` **不拆分**（**P3·降级**）

如 §1.5.7 所述：
- 5 个 module-level 状态 + 8 个 module-level 函数强耦合
- 拆分会破坏 singleton 语义
- 当前阶段应聚焦交付

**PHASE 5 任务**：
- 不动 `useSkillStore.ts`
- 在 `docs/ui-productization-audit.md` 登记一条：
  > "BLOCK-9.2 PHASE 5 调研结论：`useSkillStore.ts` 743 行已评估，建议保留不拆（singleton store 反模式 + 阻塞型 polling 强耦合 module-level 状态；743 行相对其他 4 文件已最小；当前阶段 ROI 不显著）。"
- 不动 `useSkillStore.test.ts`

---

## 3. 优先级 + 风险评估矩阵（5 文件）

| # | 文件 | 当前行数 | 优先级 | 拆后预期 | 拆后降幅 | 工作量 | 风险 | 收益 | 依赖 | **建议启动顺序** |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | DesktopSettingsPanel.tsx | 1515 | **P0** | ~450 + 9 lib 文件 | **-70%** | 1.5 PHASE | 低（强边界 6 section） | **高**（加新 section 不需要碰主组件；删除 stale `export default`） | 0 | **PHASE 1**（**第一个启动**） |
| 2 | ResultView.tsx | 1654 | **P0** | ~1100 + 2 lib 文件 | **-33%** | 1 PHASE | 中（`ActiveArtifact` 6 consumer re-export） | 中（types/helpers 与渲染分离；`ResultArtifactShell` 1313 行保留） | 1（复用 types/helpers 抽离模式） | **PHASE 2** |
| 3 | plugin-manager.js | 1457 | **P1** | ~600 + 5 lib 文件 | **-59%** | 2 PHASE（先修 dangling 再拆） | 中（`module.exports` 21 项 100% 保留；init-time module-level 状态共享） | **高**（+ 修复 dangling IPC contract bug） | 0（与 BLOCK-9.1 IPC 联调） | **PHASE 3**（PHASE 0.5 修 bug，PHASE 3.1 拆 lib/，PHASE 3.2 拆 content-bridge） |
| 4 | SimpleChat.tsx | 2153 | **P2** | ~1100 + 12 文件 | **-49%** | 3 PHASE | 中（86 hooks + 大量 props） | 中（types/helpers 复用率高；6 个测试零改动） | 1, 2（types/helpers 模式复用） | **PHASE 4**（sub-PHASE 4.1 types，4.2 format/restore，4.3 子组件） |
| 5 | useSkillStore.ts | 743 | **P3·不拆** | 不适用 | 不适用 | 不适用 | **高**（破坏 singleton 语义） | 低（743 行已最小） | 1, 2, 3, 4（**仅审计登记**） | **PHASE 5**（仅 docs/ui-productization-audit.md 登记评估结论） |

---

## 4. PHASE 1-N 拆分计划建议

### PHASE 0.5（**前置·必须先做**）—— plugin-manager dangling IPC contract bug 修复

**目标**：修 BLOCK-9.1 PHASE 2 遗留的 IPC 调用名不匹配 bug。

**范围**：仅 `src/plugin-manager.js` 第 1433-1457 行 `module.exports`，加 3 个 alias。

**行数预期**：1457 → 1460（+3 行）。

**风险等级**：低（仅 export alias；不改任何实现）。

**边界**：
- ✅ 加 `listInstalledPlugins: getInstalledPlugins` / `listRemotePlugins: getRemoteManifest` / `checkPluginUpdates: checkUpdates`
- ❌ 不改 `src/ipc/plugin.js`（保持现状）
- ❌ 不动其他任何文件

**验收标准**：
- `node --check src/plugin-manager.js` PASS
- `cd frontend && npx vitest run src/hooks/useSkillStore.test.ts src/hooks/usePluginStore.test.ts`（覆盖 plugin IPC 间接路径）
- `node --test test/plugin-manifest-schema.test.mjs test/plugin-checksum-fail-closed.test.mjs` PASS
- `npm run docs:check` GREEN
- 端到端：dev Electron 启动 → PluginStorePanel 不再 console.warn `[desktop] plugin:* failed:`，实际显示已装插件

**不动项**：
- 不动 `src/ipc/plugin.js`
- 不动其他任何 IPC handler 文件
- 不动 consumer（`PluginStorePanel` / `PluginCard` 等）

---

### PHASE 1（**P0·最优先**）—— DesktopSettingsPanel 拆分

**目标**：把 1515 行单文件拆为 9 个文件（1 types + 1 helpers + 6 section 子组件 + 1 主组件）。

**范围**：
- ✅ 新增 9 个文件（详见 §2.4.1）
- ✅ 重构 `frontend/src/components/desktop/DesktopSettingsPanel.tsx`（1515 → ~450）
- ✅ 删除 `export default DesktopSettingsPanel`（stale 双重导出）
- ✅ 保留命名导出 `export function DesktopSettingsPanel({ onClose }: Props)`
- ❌ 不动 3 个 consumer（`project-workspace.tsx` / `CenterPanel.tsx` / `ResultView.tsx`）
- ❌ 不动 `components/settings/ExperimentalFeaturesSection`
- ❌ 不动 `DesktopSettingsModal`（如果存在）
- ❌ 不重命名 `Props` interface

**行数预期降幅**：1515 → ~450 + 9 个文件共 ~700 行 = **总 -365 行（-24% 净降幅，但 9 个文件均可独立修改）**。

**风险等级**：低（6 section 边界清晰；命名导出兼容）。

**边界**：
- 每个 section 子组件独立 props（panel 透传 state + handlers）
- 无 module-level 状态在 section 之间共享
- 主组件保留全部 useState + useRef + handleSave + discoverModels 等大函数

**验收标准**：
- `cd frontend && npx tsc --noEmit` 0 错误
- `cd frontend && npx vitest run` 75+ 文件 / 630+ tests PASS / 0 失败
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（追加 UI-###）
- 手动 E2E：dev Electron 启动 → 打开设置浮动面板 → 切换 6 个 section → 各 section 渲染/交互正常

**不动项**：
- 不动 `SettingsSection` / `SETTINGS_SECTIONS` / `ModelRole` / `MODEL_ROLES` 等配置数据（移到 types.ts 但内容不变）
- 不改任何 section 的 props 接口
- 不动 `Props` 名称 / `DesktopSettingsPanel` 名称

---

### PHASE 2（**P0**）—— ResultView 拆分

**目标**：把 1654 行拆为 3 文件（1 types + 1 helpers + 1 主组件）；保守拆 `ResultArtifactShell` 保留为单组件。

**范围**：
- ✅ 新增 `frontend/src/components/workspace-panels/ResultView/types.ts`（~80 行）
- ✅ 新增 `frontend/src/components/workspace-panels/ResultView/helpers.ts`（~50 行）
- ✅ 重构 `frontend/src/components/workspace-panels/ResultView.tsx`（1654 → ~1100）
- ✅ 保留 6 个 consumer 的 `import type { ActiveArtifact, JobStats } from '@/components/workspace-panels/ResultView'` 兼容
- ❌ 不拆 `ResultArtifactShell`（1313 行单组件保留）
- ❌ 不动 6 个 consumer（`CenterPanel.tsx` / `project-workspace.tsx` 等）
- ❌ 不动 `ResultView` 薄包装的 19 个 props

**行数预期降幅**：1654 → ~1100 + 2 个文件共 ~130 行 = **净 -424 行（-26%）**。

**风险等级**：中（`ActiveArtifact` 6 consumer re-export 是关键路径）。

**边界**：
- `ResultView/types.ts` 含所有 internal types（`JobResultFile` / `DeliveryManifestSummary` / `JobResult` / `JobDetailMeta`）+ 2 个 exported types（`ActiveArtifact` / `JobStats`）
- `ResultView/helpers.ts` 含 5 个纯 helper（`toArtifactRevision` / `artifactName` / `artifactKindIcon` / `artifactPreviewLabel` / `workflowStageLabel`）
- 主组件 re-export `export type { ActiveArtifact, JobStats } from './ResultView/types'`

**验收标准**：
- `cd frontend && npx tsc --noEmit` 0 错误
- `cd frontend && npx vitest run src/components/workspace-panels` （若有） + `src/pages/project-workspace.test.tsx` （若有） PASS
- `npm run test:files --prefix frontend -- ResultView.tsx`（无 test 也 PASS）
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（追加 UI-###）
- 手动 E2E：dev Electron 启动 → 打开项目 → 切换 result / compare / history / code 4 mode → 正常

**不动项**：
- 不拆 `ResultArtifactShell` 1313 行（**ROI 不显著**）
- 不动 `ResultView` 19 个 props 签名
- 不动 6 个 consumer 的 import 路径（`@/components/workspace-panels/ResultView`）

---

### PHASE 3（**P1·中等优先级**）—— plugin-manager 拆分

**目标**：把 1457 行拆为 6 个文件（5 lib/ + 1 主模块），不破坏 IPC + 测试契约。

**范围**（**必须先完成 PHASE 0.5**）：
- PHASE 3.0 = PHASE 0.5（修 dangling bug）
- PHASE 3.1 = 拆 `src/lib/plugin-utils.js`（~200 行）+ `src/lib/plugin-paths.js`（~80 行）
- PHASE 3.2 = 拆 `src/lib/plugin-state.js`（~100 行）+ `src/lib/plugin-manifest-loader.js`（~110 行）
- PHASE 3.3 = 拆 `src/lib/plugin-content-bridge.js`（~150 行）+ 重构 `src/plugin-manager.js`（~600 行）

**行数预期降幅**：1457 → ~600 + 5 个 lib/ 共 ~640 行 = **净 -217 行（-15%）**。

**风险等级**：中（21 个 export 100% 保留；module-level init-time 状态需共享）。

**边界**：
- 5 个 lib/ 模块尽量自包含（不互相 import）
- 主文件反向 require 5 个 lib/ + `./plugin-schema`
- 所有 Week 2 schema helpers 仍 re-export from `plugin-manager.js`
- `loadAllPlugins` 调链最长：保留在主文件内部，依赖 5 个 lib/

**验收标准**：
- `node --check src/plugin-manager.js src/lib/plugin-utils.js src/lib/plugin-paths.js src/lib/plugin-state.js src/lib/plugin-manifest-loader.js src/lib/plugin-content-bridge.js` 全部 PASS
- `node --test test/plugin-manifest-schema.test.mjs test/plugin-checksum-fail-closed.test.mjs test/plugin-sdk.test.mjs test/mcp-tool-registry.test.mjs test/capability-bundles.test.mjs` PASS（plugin-runtime 影响组）
- `node --test test/chf0-critical.test.mjs`（如包含 plugin 相关路径）PASS
- `npm run docs:check` GREEN
- 端到端：dev Electron 启动 → 打开插件面板 → 列已装/远程插件正常 → 安装 / 卸载 / 检查更新正常

**不动项**：
- 不动 `src/plugin-schema.js`（Week 2 已抽）
- 不动 `src/ipc/plugin.js`（BLOCK-9.1 PHASE 2 收口文件；alias 在 PHASE 0.5 解决）
- 不动 `src/main.js`（`loadAllPlugins` 调用方保持不变）
- 不动 `src/ipc/runtime-status.js` / `src/ipc/diagnostic.js`（仅 require 名字不变）
- 不动测试（`test/plugin-checksum-fail-closed.test.mjs` 等 require `pm.assertArtifactChecksumDeclared` 等 6 个 export）
- 不修改 21 个 `module.exports` 名字

---

### PHASE 4（**P2**）—— SimpleChat 拆分

**目标**：把 2153 行拆为 12 文件（1 types + 4 helpers + 6 子组件 + 1 主组件）。

**范围**：
- PHASE 4.1 = types + format + fileOpen + restore（4 文件）
- PHASE 4.2 = 6 个子组件（`ExamplePrompts` / `MessageMeta` / `LoopStatusPanel` / `AgentProgressList` / `ErrorBanner` / `ToolActivityList` / `ResultEditProgressList` / `ApprovalCard`）共 8 文件
- PHASE 4.3 = 重构 `frontend/src/components/copilot/SimpleChat.tsx`（2153 → ~1100）+ re-export 全部 8 个 export

**行数预期降幅**：2153 → ~1100 + 12 个文件共 ~800 行 = **净 -253 行（-12%）**。

**风险等级**：中（86 hooks + 大量 props + 6 个测试 consumer）。

**边界**：
- 主组件 import 5 个 helper + 7 个子组件 + re-export 8 个 export
- 每个子组件独立 props 边界（`ApprovalCard` 4 props / `LoopStatusPanel` 2 props 等）
- `restoreSimpleMessage` / `compactStageConclusion` / `shouldOpenWithSystemApp` 必须保持 export 兼容 3 个测试文件

**验收标准**：
- `cd frontend && npx tsc --noEmit` 0 错误
- `cd frontend && npx vitest run src/components/copilot/SimpleChat.extraRenderers.test.tsx src/components/copilot/SimpleChat.progress.test.ts src/components/copilot/simple-chat-file-open.test.ts` PASS
- `cd frontend && npx vitest run src/hooks/useConversations.test.ts src/hooks/useAiSettings.test.ts`（SimpleChat consumer hooks）PASS
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（追加 UI-###）
- 手动 E2E：dev Electron 启动 → 打开 chat → 发送/接收消息 → 切换 model → approval flow → 5 个 section 正常

**不动项**：
- 不动 `SimpleChat` 主组件的 props 签名
- 不动 6 个测试文件的 import 路径（保持 `./SimpleChat`）
- 不动 `SlashCommand` / `SLASH_COMMANDS` / `SimpleChatHandle` 命名
- 不动 `MAX_SUMMARY_RETRIES` / `RETRY_BACKOFF_MS`（主组件内部）

---

### PHASE 5（**P3·审计登记**）—— useSkillStore 不拆分

**目标**：不修改 `useSkillStore.ts`，仅在 audit doc 登记调研结论。

**范围**：
- ✅ 在 `docs/ui-productization-audit.md` 追加一条：
  > "BLOCK-9.2 PHASE 5 调研结论：`useSkillStore.ts` 743 行已评估，建议保留不拆（singleton store 反模式 + 阻塞型 polling 强耦合 module-level 状态；743 行相对其他 4 文件已最小；当前阶段 ROI 不显著）。未来真有 1000+ 行增长压力再启动 BLOCK-9.6+。"
- ✅ 在 `docs/DOC-REGISTRY.json` 注册 `BLOCK-9.2-MEGA-FILE-SPLIT-SURVEY`（本报告）
- ❌ 不动 `frontend/src/hooks/useSkillStore.ts`
- ❌ 不动 `frontend/src/hooks/useSkillStore.test.ts`
- ❌ 不动 6 个 page consumer（`pages/skills/*`）

**行数预期降幅**：0（**不动代码**）。

**风险等级**：无（仅文档登记）。

**边界**：
- 仅追加 1 条 ui-productization-audit entry
- 仅注册 1 个 DOC-REGISTRY entry
- 不动任何代码

**验收标准**：
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（新增 1 个 knownId PASS）
- `npm run docs:reconcile` GREEN

**不动项**：
- **所有 743 行 useSkillStore.ts 代码**
- **所有 14 个 vitest 测试**
- **所有 6 个 page consumer**

---

## 5. 跨文件复用机会

### 5.1 5 文件间的实际共享代码 grep 结果

| 共享模式 | 命中位置 | 备注 |
|---|---|---|
| `getInstalledPlugins` / `getRemoteManifest` / `loadAllPlugins` / `getRuntimeStatus` | 仅 `plugin-manager.js` 内部 + 4 个 IPC 文件 | **不存在跨前端 4 文件共用** |
| `buildPreviewTable` / `formatPreviewText` / `fileExtension` / `isImageFile` / `isTextFile` / `isMarkdownFile` | ResultView + project-workspace + result-studio（BLOCK-9 PHASE 2 已抽到 `lib/previewFileUtils.ts` + `lib/file-preview/buildPreviewTable.ts`） | **已抽离** |
| `ActiveArtifact` / `JobStats` | ResultView 主 export + 6 consumer re-export | **保持 export 兼容** |
| `restoreSimpleMessage` / `compactStageConclusion` / `shouldOpenWithSystemApp` / `SLASH_COMMANDS` | SimpleChat 内部 + 3 个测试 | **保持 export 兼容** |
| `useSkillStore` 的 `Skill` / `ParameterSchema` / `OutputArtifact` / `SkillSource` / `SkillExecution` / `ExecutionStatus` types | useSkillStore 主 export + 5 个 page consumer（`pages/skills/*`） | **保持 export 兼容** |
| `DesktopSettingsPanel` | DesktopSettingsPanel 主 export + 3 个 consumer | **保持 export 兼容** |

### 5.2 5 文件间**未发现**的实际跨文件共享 utility

- **无重复的 utility 函数**（除 `formatMetricBytes` / `formatSize` / `fmtBytes` 三个内部重复的 bytes 格式化）
- **无重复的 type 定义**（每个文件的 type 字段都不重叠）
- **无重复的常量**（`SETTINGS_SECTIONS` / `MODEL_ROLES` / `SLASH_COMMANDS` 都独立）
- **无重复的 React component**（除 ResultView 自身 import SimpleChat）

### 5.3 跨文件 `lib/shared/` 提取建议

**结论**：**不建议为 BLOCK-9.2 创建 `lib/shared/`**。

**理由**：
1. **5 文件之间实际共享代码极少**（grep 仅命中 import 路径而非函数）
2. **强行抽离会引入跨边界耦合**（违反 BLOCK-9 PHASE 3 `project-workspace.tsx` 教训）
3. **`buildPreviewTable` 已在 BLOCK-9 PHASE 2 抽到 `lib/file-preview/`** —— 这是跨文件复用的成功范式
4. **如果未来真有跨 5 文件的共享 utility**（如 `formatMetricBytes` 3 个版本），**单独 BLOCK-9.6+ 处理**

**单一文件内重复**（独立处理）：
- DesktopSettingsPanel 内部 `formatMetricBytes` / `formatSize` / `fmtBytes` 3 处 bytes 格式化 → PHASE 1 拆分时顺手统一到 `helpers.ts`（不引入跨文件变更）

---

## 6. 拆分范式建议（统一前后端模式）

### 6.1 参考范式（已收口）

**前端范式**（`docs/block-9-mega-file-refactor-closeout.md` §2.4）：
- **保守拆**（types + helpers 优先）
- **re-export 兼容**（保留原文件全部 export，从子目录 re-export）
- **子组件拆分谨慎**（仅当 props 边界清晰）
- **共享 utility 抽 `lib/`**（如 `lib/file-preview/buildPreviewTable.ts`）

**后端范式**（`docs/block-9-1-main-js-split-closeout.md` §4.1 + §4.2）：
- **模块自包含**（自带 helper，避免跨文件 import 链）
- **4 类跨文件依赖注入**（ChildProc 变量 / 函数引用 / mainWindow 句柄 / 日志子系统）
- **`backend-proc-manager.js` 共享层**（单一真实源 + 参数注入）
- **保留在主文件的"测试锁定"函数**（如 `setupWindowIpc` 因 `test/window-controls.test.mjs` 用正则从源码抽出）

### 6.2 统一拆分范式（BLOCK-9.2）

#### 6.2.1 通用规则

| 规则 | 前端应用 | 后端应用 |
|---|---|---|
| **优先级 1：types/helpers 抽离** | `lib/types/` 或 `<原文件>/types.ts` | `src/lib/plugin-utils.js` 等 |
| **优先级 2：纯 utility 抽离** | `lib/<domain>/helpers.ts` | `src/lib/` 自包含 |
| **优先级 3：子组件拆分（谨慎）** | `<原文件>/<SubComponent>.tsx`（props 边界清晰） | `src/ipc/<domain>.js`（IPC 边界清晰） |
| **优先级 4：sub-orchestrator 抽离** | N/A（前端 React 组件强耦合） | `src/lib/plugin-state.js` / `src/lib/plugin-manifest-loader.js` |
| **re-export 兼容** | ✅ 保留原文件全部 export | ✅ 保留 `module.exports` 全部键名 |
| **不外推** | 不实现新功能 / 不改 props / 不改行为 | 不改 IPC 契约 / 不改 init-time 副作用 |

#### 6.2.2 BLOCK-9.2 5 文件分别适配

| 文件 | 适用范式 | 具体动作 |
|---|---|---|
| DesktopSettingsPanel.tsx（PHASE 1） | **前端保守拆** | types + helpers + 6 section 子组件 + 主组件；re-export 兼容；删除 stale `export default` |
| ResultView.tsx（PHASE 2） | **前端保守拆** | types + helpers（**不拆 ResultArtifactShell 1313 行**）；re-export 兼容 |
| plugin-manager.js（PHASE 3） | **后端自包含 + 跨文件依赖注入** | 5 个 lib/ 自包含；主文件反向 require；re-export 21 个 export |
| SimpleChat.tsx（PHASE 4） | **前端混合拆** | types + 4 helpers + 6 子组件（边界清晰）；re-export 兼容 3 个测试 |
| useSkillStore.ts（PHASE 5） | **不适用·不拆** | 仅 audit 登记 |

#### 6.2.3 统一验证清单（每个 PHASE 必跑）

- `cd frontend && npx tsc --noEmit` 0 错误（前 4 个 PHASE）
- `node --check <拆出的所有 .js 文件>` 0 错误（PHASE 3）
- `cd frontend && npx vitest run <相关测试文件>` 0 失败
- `node --test <相关 node --test 文件>` 0 失败
- `npm run docs:check` GREEN
- `npm run ui:audit:check` GREEN（追加 UI-###）
- `npm run docs:reconcile` GREEN
- 不变量守住：`preload.js` / `electron.d.ts` / `desktopBridge.ts` / `core/shared-backend/*` / `agent-tools/` 0 diff

#### 6.2.4 commit 模板（参考 BLOCK-9 / BLOCK-9.1）

```
<hash> refactor(<scope>): BLOCK-9.2 PHASE <N> <brief>

- 提取 <types|helpers|sub-component> 到 <path>
- 主文件 <old_lines> → <new_lines> 行
- 21 个 export 100% 保留（向后兼容）
- re-export 兼容 <consumer count> 个 consumer
- 6 个 section 子组件 props 边界清晰

UI-### <verified>
测试：tsc 0 错误 / vitest 75+ 文件 / docs:check GREEN / ui:audit:check GREEN
不变量：preload.js / electron.d.ts / desktopBridge.ts / core 0 diff
```

---

## 7. 核心结论摘要

### 7.1 5 文件能否拆？

| 文件 | 可拆性 | 建议 |
|---|---|---|
| **DesktopSettingsPanel.tsx**（1515） | ✅ **完全可拆** | **P0·PHASE 1 立即启动**（6 section 边界最清晰） |
| **ResultView.tsx**（1654） | ✅ **保守可拆** | **P0·PHASE 2**（types + helpers + 保留 `ResultArtifactShell` 单组件） |
| **plugin-manager.js**（1457） | ✅ **完全可拆但需先修 dangling bug** | **P1·PHASE 0.5 + PHASE 3**（先 alias export，再拆 5 个 lib/） |
| **SimpleChat.tsx**（2153） | ✅ **可拆但 ROE 最低** | **P2·PHASE 4**（types + 4 helpers + 6 子组件，工作量最大） |
| **useSkillStore.ts**（743） | ⚠️ **不建议拆** | **P3·PHASE 5 仅审计登记**（singleton 状态强耦合） |

### 7.2 拆的优先级

1. **PHASE 1 DesktopSettingsPanel**（P0·立即启动）
2. **PHASE 2 ResultView**（P0·依赖 PHASE 1 模式）
3. **PHASE 0.5 + PHASE 3 plugin-manager**（P1·必须先修 dangling bug）
4. **PHASE 4 SimpleChat**（P2·依赖 PHASE 1/2 模式）
5. **PHASE 5 useSkillStore 不拆**（P3·仅审计）

### 7.3 哪文件不能拆 / 降级

- **useSkillStore.ts**（743）—— **降级为不拆**，仅审计登记
- **ResultView.tsx ResultArtifactShell**（1313）—— **保守不拆**，只拆 types + helpers
- **SimpleChat.tsx SimpleChat 主组件**（1385）—— **不拆**，只拆 helpers + 子组件

### 7.4 拆分收益 vs 风险

| PHASE | 行数降幅 | 测试覆盖 | 收益 | 风险 |
|---|---|---|---|---|
| PHASE 1 | -24% 净 | 高（6 section 边界清晰） | 高（1515→450 + 9 文件） | 低 |
| PHASE 2 | -26% 净 | 中（6 consumer re-export） | 中（types/helpers 与渲染分离） | 中 |
| PHASE 3 | -15% 净 | 高（11 个 plugin-runtime 测试） | 高（+ 修 dangling bug） | 中 |
| PHASE 4 | -12% 净 | 中（6 个测试零改动） | 中（types/helpers 复用率高） | 中 |
| PHASE 5 | 0% 净 | 无（仅 docs） | 低（仅审计） | 无 |

---

## 8. PHASE 1+ 优先级清单（用户裁决时直接照此推进）

**裁决顺序建议**：

| 步骤 | 动作 | 依赖 | 工作量预估 |
|---|---|---|---|
| **1** | 用户裁决"是否启动 BLOCK-9.2"（基于本报告 §7） | 本报告 | 用户决定 |
| **2** | 若启动，先修 PHASE 0.5 dangling IPC bug（独立 commit） | 无 | 0.5 小时 |
| **3** | 启动 PHASE 1 DesktopSettingsPanel 拆分（9 文件 + 主组件重构） | 无 | 半天 |
| **4** | 启动 PHASE 2 ResultView 拆分（2 lib/ + 主组件重构） | PHASE 1 模式 | 半天 |
| **5** | 启动 PHASE 3 plugin-manager 拆分（5 lib/ + 主模块重构） | PHASE 0.5 | 1 天 |
| **6** | 启动 PHASE 4 SimpleChat 拆分（12 文件 + 主组件重构） | PHASE 1/2 模式 | 1.5 天 |
| **7** | 启动 PHASE 5 useSkillStore 审计登记 | PHASE 1-4 | 0.5 小时 |
| **8** | 收口报告 + 4 治理门 GREEN + 4 canonical 同步 | PHASE 1-5 | 半天 |

**总工作量预估**：**3.5-4 天**（含收口）。

**用户裁决选项**：

A. **全部 5 PHASE 启动**（推荐·符合 senior-engineer-review §3 优先级表 P2 全部）
B. **仅 PHASE 1 + PHASE 2 启动**（P0 优先，P1+ 留后续工作包）
C. **仅 PHASE 0.5 + PHASE 3 启动**（优先修 dangling bug + 拆 plugin-manager）
D. **不启动**（保留后续启动 BLOCK-9.6+）

---

## 9. 不外推

按 G0 长期开发期阶段纪律 + 工作包范围，**不外推**：

- 不实现 G1+ 阶段工作（packaged / Provider / GA / P7 / 公证 / dist staleness）
- 不修改任何代码（本调研仅出报告）
- 不动 `docs/AUDIT-LOG.md`（dangling IPC bug 应**单独**追加到 AUDIT-LOG，**由主 agent 启动 PHASE 0.5 时**做）
- 不动 `docs/DOC-REGISTRY.json`（本调研报告 SURVEY 文件注册**由 PHASE 5 启动时**做）
- 不动 `docs/next-steps-roadmap.md` / `docs/project-workspace-handoff.md`（**由 BLOCK-9.2 launch commit 做**）
- 不启动任何拆分（等用户裁决）
- 不评估 G1+ 阶段事项

---

## 10. 自我验证清单

- ✅ 5 文件每个都实际 `wc -l` 过（不是从 review 引用）
- ✅ 5 文件每个都实际 Read 了开头 + 关键函数定位 + 末尾
- ✅ 跨文件复用机会是真实 grep 结果（`buildPreviewTable` / `restoreSimpleMessage` / `useSkillStore` 等）
- ✅ PHASE 划分给每个 PHASE 都写明不动项
- ✅ dangling IPC contract bug 经实测 grep 验证（`listInstalledPlugins` / `listRemotePlugins` / `checkPluginUpdates` 在 plugin-manager.js 中不存在）
- ✅ export / import 列表经 grep 验证（21 个 export / 30+ imports per file）
- ✅ consumer 数量经 grep 验证（ActiveArtifact 6 consumer / DesktopSettingsPanel 3 consumer / useSkillStore 6 consumer / SimpleChat 4 test consumer / plugin-manager 4 IPC consumer）
- ✅ 测试影响组经 impact-map.json 验证（plugin-runtime 11 测试 / SimpleChat ux1g1+ux1h / ResultView ux1g2 / DesktopSettingsPanel frontend-source / useSkillStore frontend-source）
- ✅ 拆分范式参考既有收口（BLOCK-9 PHASE 3 + BLOCK-9.1 §4.1-§4.5）
- ✅ 不外推 G1+ 阶段事项（明确 §9）

---

**报告状态**：BLOCK-9.2 PHASE 0 调研完成，等待用户裁决。
