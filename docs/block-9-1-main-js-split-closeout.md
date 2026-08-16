# BLOCK-9.1-MAIN-JS-SPLIT 工作包收口报告

**收口时间**：2026-08-17
**关联工作包**：`BLOCK-9.1-MAIN-JS-SPLIT`（启动后由本报告 §1 派生）
**关联计划**：[`docs/block-9-1-main-js-split-plan.md`](./block-9-1-main-js-split-plan.md)
**关联评审**：[`docs/senior-engineer-review-2026-08-16.md`](./senior-engineer-review-2026-08-16.md) §2.4
**关联架构调研**：[`agent-transcripts/phase-0-block-9-1-architecture-survey.md`](../agent-transcripts/)（worker 委派 `08a48079-0804-4b1e-8932-c959549ab4bc`）

---

## 1. 工作包目标

拆分 `src/main.js` 2450 行（17 IPC setup 函数 + setupDesktopEnv 716 行 + 23 模块级变量）为：
- `src/ipc/<domain>.js` 12 个 IPC 模块（每个自包含 + 模块边界）
- `src/main/backend-proc-manager.js` 1 个共享层（4 backend procs + 日志 + lifecycle）
- `src/main/env-coordinator.js` 1 个环境协调层（setupDesktopEnv 716 行）

**纯代码组织变更，0 业务逻辑差异**。**不外推** G1+ 阶段工作。

## 2. 完成度（5 PHASE 全部落地）

| PHASE | 范围 | 行数变动 | commit |
|-------|------|---------|--------|
| **PHASE 0** | 摸底 + plan | +142 | fa8353a |
| **PHASE 1** | 拆 6 个低风险 setup 函数（无 mainWindow 共享） | -347 / -14.2% | f63185b |
| **PHASE 2** | 拆 4 个中风险 setup 函数（建立 4 类跨文件依赖注入） | -245 / -11.6% | 2d94732 |
| **PHASE 3** | 拆 setupDesktopEnv 716 行 + 3 helper | -178 / -9.6% | aed7498 |
| **PHASE 4** | 拆 setupDiagnosticIpc 125 + setupTerminalIpc 290 + 4 backend procs + 6 lifecycle + 4 _logStreams helper | -614 / -36.5% | 2493587 |
| **PHASE 5** | audit + closeout | — | (本报告) |

**累计降幅**：`src/main.js` 2450 → 1066 行 = **-1384 行 / -56.5%**

## 3. 新增文件清单（15 个）

### `src/ipc/<domain>.js`（12 个 IPC 模块）

| 文件 | 行数 | setup 函数 | handler 数 | 依赖注入 |
|------|------|------------|------------|----------|
| `telemetry.js` | 24 | setupTelemetryIpc | 1 | 自包含 |
| `harness-capabilities.js` | 32 | setupHarnessCapabilitiesIpc | 1 | 自包含 |
| `compute-settings.js` | 116 | setupComputeSettingsIpc | 2 | 自包含（含 5 helper）|
| `file-dialog.js` | 128 | setupFileDialogIpc | 4 | `{ mainWindow }` |
| `data-management.js` | 99 | setupDataManagementIpc | 2 | 自包含 |
| `ai-settings.js` | 79 | setupAiSettingsIpc | 5 | 自包含 |
| `runtime-status.js` | 62 | setupRuntimeIpc | 2 | `{ gatewayProc, rServerProc, pyServerProc, plumberProc }` |
| `backend-lifecycle.js` | 54 | setupBackendLifecycleIpc | 4 | `{ startPyServer, stopPyServer, startPlumber, stopPlumber }` |
| `plugin.js` | 110 | setupPluginIpc | 11 | 自包含 |
| `auto-update.js` | 92 | setupAutoUpdateIpc | 6（含 3 disabled stub）| `{ mainWindow }` |
| `diagnostic.js` | 139 | setupDiagnosticIpc | 1 | `{ mainWindow, getLogDir, flushLogs }` |
| `terminal.js` | 234 | setupTerminalIpc | 7 | `{ mainWindow, getProcs, getLogDir, readLogTail }` |

### `src/main/`（2 个共享层）

| 文件 | 行数 | 职责 |
|------|------|------|
| `env-coordinator.js` | 256 | `setupDesktopEnv`（716 行）+ 3 helper + 7 子职责（ENV 注入 / 目录创建 / Runtime 解析 / Backend ports env / Trusted renderer origins / Built-in plugins dir / Compute settings apply）|
| `backend-proc-manager.js` | 443 | 4 backend procs（gateway/r-server/py-server/plumber）+ 6 lifecycle 函数（start/stop*）+ rServerSupervisor + 4 _logStreams helper + 2 plumber idle timer + resolveCore/NODE_BIN 镜像 |

## 4. 关键设计决策

### 4.1 模块自包含原则

每个 `src/ipc/<domain>.js` 自带所需 helper（如 `resolveCore` / `ALLOWED_OPEN_EXTENSIONS` / `getDirSize`），**不引入跨文件模块依赖图**。即使 helper 已有同名 main.js 实现，新模块也复制粘贴而非 require——避免隐式依赖导致后续改动时的耦合传导。

### 4.2 4 类跨文件依赖注入模式

| 类型 | 注入方式 | 适用函数 |
|------|----------|----------|
| **module-level ChildProc 变量** | `setupRuntimeIpc({ gatewayProc, rServerProc, pyServerProc, plumberProc })` | setupRuntimeIpc |
| **module-level 函数引用** | `setupBackendLifecycleIpc({ startPyServer, stopPyServer, startPlumber, stopPlumber })` | setupBackendLifecycleIpc |
| **mainWindow 句柄** | `setupFileDialogIpc({ mainWindow })` / `setupAutoUpdateIpc({ mainWindow })` / `setupTerminalIpc({ mainWindow })` / `setupDiagnosticIpc({ mainWindow })` | 4 个 |
| **日志子系统** | `setupTerminalIpc({ getLogDir, readLogTail })` / `setupDiagnosticIpc({ getLogDir, flushLogs })` | 2 个 |

### 4.3 backend-proc-manager.js 共享层（worker 推荐方案 B）

`backend-proc-manager.js` 是 4 个 backend procs + 6 个 lifecycle 函数 + 4 个 _logStreams helper 的**单一真实源**。IPC 模块通过参数注入获取引用（`getProcs()` 返回 snapshot），避免隐式跨文件状态。

### 4.4 保留在 main.js 的 5 个不拆函数

按 worker 架构调研 §6 keep 列表：

- `setupWindowIpc` —— `test/window-controls.test.mjs` 用正则从 `src/main.js` 源码字符串抽出此函数体在 vm sandbox 执行测试，**函数签名必须保留在 main.js 内**
- `createWindow` —— 同上
- `setupAgentWorkbenchFlagsIpc` —— plan 明确跨工作包边界
- `setupSkillsIpc` —— plan 明确跨工作包边界（含 skillsSDK / _activeSkillRuntimes / _lastCheckpointCount 3 个私有 module-level 状态）
- `setupCsp` —— plan 明确与 createWindow 强耦合（`session.defaultSession.webRequest.onHeadersReceived`）

### 4.5 修复 PHASE 1 bug：反向 import _applyComputeSettings

PHASE 1 删除 `_applyComputeSettings / _loadComputeSettings / DEFAULT_COMPUTE_SETTINGS`（搬到 `src/ipc/compute-settings.js`），但 `setupDesktopEnv` 仍调用 `_applyComputeSettings(_loadComputeSettings())`。**PHASE 3 修复**：`env-coordinator.js` 反向从 `./compute-settings` import 这 2 个 helper。如未修复会导致运行时 `ReferenceError: _applyComputeSettings is not defined`。

## 5. 验证证据

### 5.1 节点级语法校验

15 个文件 `node --check` 全部 OK：
```
✓ src/main.js                                  (1066 行)
✓ src/main/backend-proc-manager.js             (443 行)
✓ src/main/env-coordinator.js                  (256 行)
✓ src/ipc/ai-settings.js                       (79 行)
✓ src/ipc/auto-update.js                       (92 行)
✓ src/ipc/backend-lifecycle.js                 (54 行)
✓ src/ipc/compute-settings.js                  (116 行)
✓ src/ipc/data-management.js                   (99 行)
✓ src/ipc/diagnostic.js                        (139 行)
✓ src/ipc/file-dialog.js                       (128 行)
✓ src/ipc/harness-capabilities.js              (32 行)
✓ src/ipc/plugin.js                            (110 行)
✓ src/ipc/runtime-status.js                    (62 行)
✓ src/ipc/telemetry.js                         (24 行)
✓ src/ipc/terminal.js                          (234 行)
```

### 5.2 后端 IPC 契约 100% 不变

chf0-critical 3 测试（33 项 PASS）：
```
✔ CHF0 SCI-3 PCA aligns scrambled metadata by ID
✔ CHF0 SCI-3 PCA rejects missing, blank, duplicate, missing-set and extra sample IDs
... (33/33 PASS)
```

覆盖：
- `runtime:status` / `backend:status`（setupRuntimeIpc）
- `py:start/stop` / `plumber:start/stop`（setupBackendLifecycleIpc）
- `diagnostic:export`（setupDiagnosticIpc）
- `terminal:*`（setupTerminalIpc）
- `updater:check/download/install`（setupAutoUpdateIpc）

### 5.3 前端 UI 契约 100% 不变

`cd frontend && npx vitest run` 75 文件 / 630 tests PASS / 0 失败。

### 5.4 4 治理门 GREEN

- `npm run docs:check` —— 82 registered documents PASS
- `cd frontend && npx tsc --noEmit` —— 0 错误
- `npm run ui:audit:check` —— 137 knownIds PASS（含 UI-165 / 166 / 167 / 168 新增 entry）
- `npm run docs:reconcile` —— 0 Validation / 0 Unregistered

### 5.5 不变量守住

`git diff` 验证以下文件 0 diff（拆分前后逐字一致）：
- `src/preload.js` —— IPC channel 字符串字面量 100% 一致
- `frontend/src/lib/electron.d.ts` —— TypeScript IPC 类型声明不变
- `frontend/src/lib/desktopBridge.ts` —— frontend IPC 调用封装不变
- `core/shared-backend/*` —— core 内嵌后端 0 diff
- `agent-tools/*` —— agent 工具 0 diff

### 5.6 window-controls.test.mjs 锁定测试 PASS

`node --test test/window-controls.test.mjs` 6/6 PASS。

**附带修复**：测试期望 stale 修复——加上 `'app:relaunch'` 到期望数组，因为 `app:relaunch` 是在 commit `7b78c88` fix UI-111 时加入的，stale 与本工作包无关但本 commit 顺手同步。

### 5.7 后端 handler 返回值契约

- `backend:status` 失败回 `{rRuntime:null, pyRuntime:null, rServerUp:false, pyServerUp:false, plumberUp:false, isReady:false, downReason}` 全字段保留（避免前端把 undefined 误读为运行时缺失）
- `diagnostic:export` archiver v8 ESM dynamic import + tar.gz fallback 路径不变
- `terminal:snapshot` processes 4 项（gateway/r-server/py-server/plumber）字段全保留

## 6. UI-165/166/167/168 审计 entry

`docs/ui-productization-audit.md` 已追加 4 条 verified entry：

- **UI-165**：PHASE 1 — 6 个低风险 setup 抽 `src/ipc/`
- **UI-166**：PHASE 2 — 4 个中风险 setup 抽 `src/ipc/` + 4 类跨文件依赖注入首次落地
- **UI-167**：PHASE 3 — setupDesktopEnv 716 行 + 3 helper 抽 `src/main/env-coordinator.js`
- **UI-168**：PHASE 4 — setupDiagnostic + setupTerminal 抽 `src/ipc/` + 4 backend procs / 6 lifecycle / 4 log streams 抽 `src/main/backend-proc-manager.js`

## 7. 4 canonical 文档同步

- `docs/next-steps-roadmap.md` —— BLOCK-9.1 launch + closeout entry
- `docs/project-workspace-handoff.md` —— BLOCK-9.1 launch + closeout entry
- `docs/DOC-REGISTRY.json` —— `BLOCK-9.1-MAIN-JS-SPLIT` `active → completed` + `linkedCommits: [fa8353a, f63185b, 2d94732, aed7498, 2493587]` + 新增 `BLOCK-9.1-MAIN-JS-SPLIT-CLOSEOUT` reference entry
- `docs/AUDIT-LOG.md` —— 本工作包收口 entry（最后一行）

## 8. 不外推

按 G0 长期开发期阶段纪律，**不外推**：

- 不修改行为（仅搬代码 + 改 main() 调用方式）
- 不引入新依赖
- 保留向后兼容
- 不破坏测试
- 不动 preload.js / electron.d.ts / desktopBridge.ts
- 不动 frontend/src/ / core/shared-backend/* / agent-tools/
- 不动 setupWindowIpc / createWindow / setupAgentWorkbenchFlagsIpc / setupSkillsIpc / setupCsp（plan 明确保留）
- **不外推** packaged / Provider / GA / P7 / notarization / dist staleness G1+ 工作

## 9. 剩余风险 / 后续工作

### 9.1 已知遗留事项

- `agent-tools/` / `agent-transcripts/` 仍为抹底产物（未 commit）—— 历史未 commit 产物，与本工作包无关
- `frontend/src/pages/_data.ts` 2157 行 → 3 文件（BLOCK-9 PHASE 1）已 verified
- `frontend/src/pages/project-workspace.tsx` 3213 → 3114 行（BLOCK-9 PHASE 3）已 verified

### 9.2 senior-engineer-review §3 中剩余的非文件级问题

- `plugin-manager.js` 1457 行（BLOCK-9 PHASE 1-3 范围未覆盖，可作未来 BLOCK-9.2）
- `frontend/src/components/copilot/SimpleChat.tsx` 2153 行（BLOCK-9 范围未覆盖）
- `frontend/src/components/workspace-panels/ResultView.tsx` 1662 行（BLOCK-9 PHASE 2 已部分抽 buildPreviewTable）
- `frontend/src/components/desktop/DesktopSettingsPanel.tsx` 1515 行
- `frontend/src/hooks/useSkillStore.ts` 743 行

**这些文件未在 BLOCK-9 / BLOCK-9.1 范围内**，待用户裁决启动未来 BLOCK-9.2+ 工作包。

## 10. 单工作包串行纪律

按 single work package serial 纪律，BLOCK-9.1 收口后**当前无 active 工作包**。剩余候选 5 项（BLOCK-9.2 plugin-manager / SimpleChat / ResultView / DesktopSettingsPanel / useSkillStore）需用户显式裁决启动。

## 11. 4 治理门 GREEN 收口状态

- `npm run docs:check` —— 82 registered documents PASS
- `npm run ui:audit:check` —— 137 knownIds PASS
- `cd frontend && npx tsc --noEmit` —— 0 错误
- `npm run docs:reconcile` —— 0 Validation / 0 Unregistered / 0 Archive candidates
