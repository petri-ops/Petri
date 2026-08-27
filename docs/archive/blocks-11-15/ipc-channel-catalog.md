# IPC Channel Catalog (BioF3 Desktop · G0)

最后更新：2026-08-19（BLOCK-14-IPC-CHANNEL-CATALOG 工作包收口：5 表 + 1 孤儿候选清单）

本文件是 **`biof3:desktop` Electron app 静态 IPC 通道目录**，由 `BLOCK-14-IPC-CHANNEL-CATALOG` 工作包通过 ripgrep 静态扫描生成。

- **不修改任何源文件**，只读扫描产物。
- 覆盖范围：`src/main.js` + `src/main/*.js` + `src/ipc/*.js` + `src/mcp-server.js` + `src/preload.js` + `frontend/src/lib/desktopBridge.ts` + `frontend/src/lib/electron.d.ts`。
- **5 个表**（每行 1 channel）
  - 表 1：main→preload handler（含 `ipcMain.handle` / `ipcMain.on` 注册的所有 channel）
  - 表 2：preload→main invoke（含 `ipcRenderer.invoke` + `ipcRenderer.on` 双向）
  - 表 3：`contextBridge.exposeInMainWorld` 暴露的 namespace
  - 表 4：frontend typed bridge（`desktopBridge.ts` 通过 `electron.d.ts` 派生的 typed accessor）
  - 表 5：`electron.d.ts` 全部 IPC type 声明（按 namespace 分组）
- **附录 A**：未在 catalog 但 `rg` 命中的疑似孤儿 channel 清单
- **附录 B**：渲染层内部事件总线（renderer-only `CustomEvent`，非 IPC，列此仅作背景）

---

## 表 1 — main → preload handler

> 来源：`ipcMain.handle(<channel>, ...)` + `ipcMain.on(<channel>, ...)` 在 `src/main.js` + `src/main/*.js` + `src/ipc/*.js` 的注册。共 **80 项**。


| # | Channel 名 | 注册位置 | Register 形式 | Notes |
|---:|:----------|:---------|:--------------|:------|
| 1 | `biof3:agent-workbench-flags` | `src/main.js:604` | `ipcMain.handle` | 由常量 `AGENT_WORKBENCH_FLAG_CHANNEL = "biof3:agent-workbench-flags"` 定义 |
| 2 | `window:minimize` | `src/main.js:619` | `ipcMain.on` | 自定义 traffic-light |
| 3 | `window:maximize` | `src/main.js:622` | `ipcMain.on` | 自定义 traffic-light |
| 4 | `window:close` | `src/main.js:631` | `ipcMain.on` | 自定义 traffic-light |
| 5 | `window:isMaximized` | `src/main.js:634` | `ipcMain.handle` | 自定义 traffic-light |
| 6 | `window:isFullScreen` | `src/main.js:640` | `ipcMain.handle` | macOS fullscreen |
| 7 | `window:toggleFullScreen` | `src/main.js:644` | `ipcMain.on` | macOS fullscreen |
| 8 | `app:relaunch` | `src/main.js:660` | `ipcMain.handle` | BIOF3_R_HOME 重启 |
| 9 | `skills:discover` | `src/main.js:829` | `ipcMain.handle` | UI-157 |
| 10 | `skills:execute` | `src/main.js:841` | `ipcMain.handle` | UI-157 |
| 11 | `skills:getExecution` | `src/main.js:906` | `ipcMain.handle` | UI-157 |
| 12 | `skills:cancel` | `src/main.js:937` | `ipcMain.handle` | UI-157 PHASE 1 A |
| 13 | `plugin:list-installed` | `src/ipc/plugin.js:26` | `ipcMain.handle` | |
| 14 | `plugin:list-remote` | `src/ipc/plugin.js:37` | `ipcMain.handle` | |
| 15 | `plugin:check-updates` | `src/ipc/plugin.js:48` | `ipcMain.handle` | |
| 16 | `plugin:install` | `src/ipc/plugin.js:59` | `ipcMain.handle` | |
| 17 | `plugin:uninstall` | `src/ipc/plugin.js:69` | `ipcMain.handle` | |
| 18 | `content-plugin:list` | `src/ipc/plugin.js:81` | `ipcMain.handle` | |
| 19 | `content-plugin:list-docs` | `src/ipc/plugin.js:92` | `ipcMain.handle` | |
| 20 | `content-plugin:read` | `src/ipc/plugin.js:103` | `ipcMain.handle` | 多行参数 |
| 21 | `updater:check` | `src/ipc/auto-update.js:21` + `:49` | `ipcMain.handle` | 双注册（dev 路径 + packaged 路径互斥早返回） |
| 22 | `updater:download` | `src/ipc/auto-update.js:25` + `:68` | `ipcMain.handle` | 双注册 |
| 23 | `updater:install` | `src/ipc/auto-update.js:29` + `:80` | `ipcMain.handle` | 双注册 |
| 24 | `py:start` | `src/ipc/backend-lifecycle.js:21` | `ipcMain.handle` | lazy，idle 5min |
| 25 | `py:stop` | `src/ipc/backend-lifecycle.js:29` | `ipcMain.handle` | |
| 26 | `plumber:start` | `src/ipc/backend-lifecycle.js:37` | `ipcMain.handle` | lazy |
| 27 | `plumber:stop` | `src/ipc/backend-lifecycle.js:45` | `ipcMain.handle` | |
| 28 | `terminal:snapshot` | `src/ipc/terminal.js:50` | `ipcMain.handle` | |
| 29 | `terminal:open-log-dir` | `src/ipc/terminal.js:111` | `ipcMain.handle` | |
| 30 | `terminal:open-shell` | `src/ipc/terminal.js:122` | `ipcMain.handle` | |
| 31 | `terminal:session-start` | `src/ipc/terminal.js:162` | `ipcMain.handle` | |
| 32 | `terminal:session-write` | `src/ipc/terminal.js:202` | `ipcMain.handle` | |
| 33 | `terminal:session-resize` | `src/ipc/terminal.js:212` | `ipcMain.handle` | |
| 34 | `terminal:session-stop` | `src/ipc/terminal.js:220` | `ipcMain.handle` | |
| 35 | `compute-settings:get` | `src/ipc/compute-settings.js:78` | `ipcMain.handle` | |
| 36 | `compute-settings:save` | `src/ipc/compute-settings.js:86` | `ipcMain.handle` | |
| 37 | `harness-capabilities:list` | `src/ipc/harness-capabilities.js:31` | `ipcMain.handle` | Stage 3 M1 |
| 38 | `diagnostic:export` | `src/ipc/diagnostic.js:28` | `ipcMain.handle` | sender 守门 |
| 39 | `telemetry:report` | `src/ipc/telemetry.js:15` | `ipcMain.handle` | M2-3 |
| 40 | `result:create` | `src/ipc/result-handlers.js:50` | `ipcMain.handle` | validTypes 含 `conversation_export` |
| 41 | `result:createWithBranch` | `src/ipc/result-handlers.js:85` | `ipcMain.handle` | **疑似孤儿**：未在 preload/electron.d.ts 见 invoke/typed |
| 42 | `result:get` | `src/ipc/result-handlers.js:128` | `ipcMain.handle` | |
| 43 | `result:list` | `src/ipc/result-handlers.js:144` | `ipcMain.handle` | |
| 44 | `result:update` | `src/ipc/result-handlers.js:157` | `ipcMain.handle` | |
| 45 | `result:delete` | `src/ipc/result-handlers.js:176` | `ipcMain.handle` | |
| 46 | `result:byProject` | `src/ipc/result-handlers.js:194` | `ipcMain.handle` | |
| 47 | `result:version:create` | `src/ipc/result-handlers.js:209` | `ipcMain.handle` | |
| 48 | `result:version:get` | `src/ipc/result-handlers.js:238` | `ipcMain.handle` | |
| 49 | `result:version:getByNumber` | `src/ipc/result-handlers.js:255` | `ipcMain.handle` | |
| 50 | `result:version:list` | `src/ipc/result-handlers.js:272` | `ipcMain.handle` | |
| 51 | `result:createFromConversation` | `src/ipc/result-handlers.js:297` | `ipcMain.handle` | Phase 4 |
| 52 | `ai-settings:get` | `src/ipc/ai-settings.js:32` | `ipcMain.handle` | |
| 53 | `ai-settings:save` | `src/ipc/ai-settings.js:44` | `ipcMain.handle` | |
| 54 | `ai-settings:get-credential` | `src/ipc/ai-settings.js:57` | `ipcMain.handle` | |
| 55 | `ai-settings:test` | `src/ipc/ai-settings.js:70` | `ipcMain.handle` | |
| 56 | `ai-settings:list-models` | `src/ipc/ai-settings.js:82` | `ipcMain.handle` | |
| 57 | `runtime:status` | `src/ipc/runtime-status.js:16` | `ipcMain.handle` | |
| 58 | `backend:status` | `src/ipc/runtime-status.js:28` | `ipcMain.handle` | M1-1 |
| 59 | `branch:project:create` | `src/ipc/branch-handlers.js:41` | `ipcMain.handle` | |
| 60 | `branch:project:get` | `src/ipc/branch-handlers.js:54` | `ipcMain.handle` | |
| 61 | `branch:project:update` | `src/ipc/branch-handlers.js:67` | `ipcMain.handle` | |
| 62 | `branch:project:list` | `src/ipc/branch-handlers.js:83` | `ipcMain.handle` | |
| 63 | `branch:create` | `src/ipc/branch-handlers.js:95` | `ipcMain.handle` | |
| 64 | `branch:get` | `src/ipc/branch-handlers.js:109` | `ipcMain.handle` | |
| 65 | `branch:list` | `src/ipc/branch-handlers.js:122` | `ipcMain.handle` | |
| 66 | `branch:switch` | `src/ipc/branch-handlers.js:135` | `ipcMain.handle` | |
| 67 | `branch:active` | `src/ipc/branch-handlers.js:151` | `ipcMain.handle` | |
| 68 | `branch:delete` | `src/ipc/branch-handlers.js:164` | `ipcMain.handle` | |
| 69 | `branch:rename` | `src/ipc/branch-handlers.js:180` | `ipcMain.handle` | |
| 70 | `branch:children` | `src/ipc/branch-handlers.js:196` | `ipcMain.handle` | |
| 71 | `message:append` | `src/ipc/branch-handlers.js:211` | `ipcMain.handle` | |
| 72 | `message:list` | `src/ipc/branch-handlers.js:228` | `ipcMain.handle` | |
| 73 | `message:get` | `src/ipc/branch-handlers.js:241` | `ipcMain.handle` | |
| 74 | `message:count` | `src/ipc/branch-handlers.js:254` | `ipcMain.handle` | |
| 75 | `message:delete` | `src/ipc/branch-handlers.js:267` | `ipcMain.handle` | |
| 76 | `message:clear` | `src/ipc/branch-handlers.js:283` | `ipcMain.handle` | |
| 77 | `data:info` | `src/ipc/data-management.js:39` | `ipcMain.handle` | |
| 78 | `data:open-dir` | `src/ipc/data-management.js:84` | `ipcMain.handle` | |
| 79 | `file:save-dialog` | `src/ipc/file-dialog.js:41` | `ipcMain.handle` | |
| 80 | `file:open-dialog` | `src/ipc/file-dialog.js:54` | `ipcMain.handle` | |
| 81 | `file:open-path` | `src/ipc/file-dialog.js:77` | `ipcMain.handle` | |
| 82 | `file:open-workspace-file` | `src/ipc/file-dialog.js:100` | `ipcMain.handle` | |


> 表 1 总结：82 处 `ipcMain.handle/on` 出现（包含 `updater:*` 三项 dev/packaged 路径双注册一行），去重后实际注册 **80 个 channel**（其中 `updater:check`/`updater:download`/`updater:install` 三项计入）。`src/main/backend-proc-manager.js` 无 `ipcMain.handle` 注册（仅作为模块 helper 提供给 `src/ipc/terminal.js` / `src/ipc/backend-lifecycle.js` / `src/ipc/diagnostic.js`）。

---

## 表 2 — preload → main invoke（含 on 订阅）

> 来源：`ipcRenderer.invoke(<channel>, ...)` + `ipcRenderer.on(<channel>, ...)` 在 `src/preload.js` 的注册。共 **77 项**（64 invoke + 13 on）。

### 2a — `ipcRenderer.invoke`（preload→main request/response，64 项）

| # | Channel 名 | preload 行号 | 暴露 namespace | Notes |
|---:|:----------|:-------------|:---------------|:------|
| 1 | `ai-settings:get` | `src/preload.js:143` | `biof3Desktop.aiSettings.get` | |
| 2 | `ai-settings:save` | `src/preload.js:144` | `biof3Desktop.aiSettings.save` | |
| 3 | `ai-settings:get-credential` | `src/preload.js:145` | `biof3Desktop.aiSettings.getCredential` | |
| 4 | `ai-settings:test` | `src/preload.js:146` | `biof3Desktop.aiSettings.test` | |
| 5 | `ai-settings:list-models` | `src/preload.js:147` | `biof3Desktop.aiSettings.listModels` | |
| 6 | `compute-settings:get` | `src/preload.js:152` | `biof3Desktop.computeSettings.get` | |
| 7 | `compute-settings:save` | `src/preload.js:153` | `biof3Desktop.computeSettings.save` | |
| 8 | `harness-capabilities:list` | `src/preload.js:158` | `biof3Desktop.harnessCapabilities.list` | |
| 9 | `plugin:list-installed` | `src/preload.js:163` | `biof3Desktop.plugins.listInstalled` | |
| 10 | `plugin:list-remote` | `src/preload.js:164` | `biof3Desktop.plugins.listRemote` | |
| 11 | `plugin:install` | `src/preload.js:169` | `biof3Desktop.plugins.install` | `install-progress` 主进程推送 |
| 12 | `plugin:uninstall` | `src/preload.js:176` | `biof3Desktop.plugins.uninstall` | |
| 13 | `plugin:check-updates` | `src/preload.js:177` | `biof3Desktop.plugins.checkUpdates` | |
| 14 | `content-plugin:list` | `src/preload.js:182` | `biof3Desktop.contentPlugins.list` | |
| 15 | `content-plugin:list-docs` | `src/preload.js:183` | `biof3Desktop.contentPlugins.listDocs` | |
| 16 | `content-plugin:read` | `src/preload.js:185` | `biof3Desktop.contentPlugins.read` | |
| 17 | `runtime:status` | `src/preload.js:190` | `biof3Desktop.runtime.status` | |
| 18 | `backend:status` | `src/preload.js:195` | `biof3Desktop.backend.status` | M1-1 |
| 19 | `py:start` | `src/preload.js:200` | `biof3Desktop.py.start` | |
| 20 | `py:stop` | `src/preload.js:201` | `biof3Desktop.py.stop` | |
| 21 | `plumber:start` | `src/preload.js:204` | `biof3Desktop.plumber.start` | |
| 22 | `plumber:stop` | `src/preload.js:205` | `biof3Desktop.plumber.stop` | |
| 23 | `file:save-dialog` | `src/preload.js:210` | `biof3Desktop.files.saveDialog` | |
| 24 | `file:open-dialog` | `src/preload.js:211` | `biof3Desktop.files.openDialog` | 同时支持单文件与目录选择（`openDirectoryDialog` 转 `{ openDirectory: true }`） |
| 25 | `file:open-path` | `src/preload.js:213` | `biof3Desktop.files.openPath` | |
| 26 | `file:open-workspace-file` | `src/preload.js:215` | `biof3Desktop.files.openWorkspaceFile` | |
| 27 | `diagnostic:export` | `src/preload.js:220` | `biof3Desktop.diagnostic.export` | |
| 28 | `telemetry:report` | `src/preload.js:225` | `biof3Desktop.telemetry.report` | |
| 29 | `data:info` | `src/preload.js:230` | `biof3Desktop.data.info` | |
| 30 | `data:open-dir` | `src/preload.js:231` | `biof3Desktop.data.openDir` | |
| 31 | `terminal:snapshot` | `src/preload.js:236` | `biof3Desktop.terminal.snapshot` | |
| 32 | `terminal:open-log-dir` | `src/preload.js:237` | `biof3Desktop.terminal.openLogDir` | |
| 33 | `terminal:open-shell` | `src/preload.js:238` | `biof3Desktop.terminal.openShell` | |
| 34 | `terminal:session-start` | `src/preload.js:239` | `biof3Desktop.terminal.startSession` | |
| 35 | `terminal:session-write` | `src/preload.js:240` | `biof3Desktop.terminal.writeSession` | |
| 36 | `terminal:session-resize` | `src/preload.js:242` | `biof3Desktop.terminal.resizeSession` | |
| 37 | `terminal:session-stop` | `src/preload.js:243` | `biof3Desktop.terminal.stopSession` | |
| 38 | `skills:discover` | `src/preload.js:261` | `biof3Desktop.skills.discover` | |
| 39 | `skills:execute` | `src/preload.js:263` | `biof3Desktop.skills.execute` | `String(skillId ?? '')` 防御 |
| 40 | `skills:getExecution` | `src/preload.js:265` | `biof3Desktop.skills.getExecution` | |
| 41 | `skills:cancel` | `src/preload.js:267` | `biof3Desktop.skills.cancel` | |
| 42 | `branch:create` | `src/preload.js:288` | `biof3Desktop.branch.create` | |
| 43 | `branch:list` | `src/preload.js:289` | `biof3Desktop.branch.list` | |
| 44 | `branch:switch` | `src/preload.js:290` | `biof3Desktop.branch.switch` | |
| 45 | `branch:delete` | `src/preload.js:291` | `biof3Desktop.branch.delete` | |
| 46 | `branch:rename` | `src/preload.js:292` | `biof3Desktop.branch.rename` | |
| 47 | `branch:active` | `src/preload.js:293` | `biof3Desktop.branch.getActive` | |
| 48 | `result:create` | `src/preload.js:299` | `biof3Desktop.result.create` | |
| 49 | `result:get` | `src/preload.js:300` | `biof3Desktop.result.get` | |
| 50 | `result:list` | `src/preload.js:301` | `biof3Desktop.result.list` | |
| 51 | `result:update` | `src/preload.js:302` | `biof3Desktop.result.update` | |
| 52 | `result:delete` | `src/preload.js:303` | `biof3Desktop.result.delete` | |
| 53 | `result:byProject` | `src/preload.js:304` | `biof3Desktop.result.byProject` | |
| 54 | `result:createFromConversation` | `src/preload.js:306` | `biof3Desktop.result.createFromConversation` | |
| 55 | `result:version:create` | `src/preload.js:308` | `biof3Desktop.result.version.create` | |
| 56 | `result:version:get` | `src/preload.js:309` | `biof3Desktop.result.version.get` | |
| 57 | `result:version:getByNumber` | `src/preload.js:310` | `biof3Desktop.result.version.getByNumber` | |
| 58 | `result:version:list` | `src/preload.js:311` | `biof3Desktop.result.version.list` | |
| 59 | `updater:check` | `src/preload.js:317` | `biof3Desktop.updater.check` | |
| 60 | `updater:download` | `src/preload.js:318` | `biof3Desktop.updater.download` | |
| 61 | `updater:install` | `src/preload.js:319` | `biof3Desktop.updater.install` | |
| 62 | `app:relaunch` | `src/preload.js:138` | `biof3Desktop.app.relaunch` | |
| 63 | `window:isMaximized` | `src/preload.js:103` | `biof3Desktop.window.isMaximized` | |
| 64 | `window:isFullScreen` | `src/preload.js:119` | `biof3Desktop.window.isFullScreen` | |

### 2b — `ipcRenderer.on`（main→preload push，13 项）

| # | Channel 名 | preload 行号 | main 推送位置 | Notes |
|---:|:----------|:-------------|:--------------|:------|
| 1 | `biof3:agent-workbench-flags` | `:41`, `:61`, `:62` | `src/main.js:321` (`webContents.send`) + `:604` (`ipcMain.handle` 双向) | 常量共享 |
| 2 | `app:soft-refresh` | `:67` | `src/main.js:497` (`webContents.send`) | Cmd+R |
| 3 | `window:maximize-changed` | `:113`, `:114` | main.js L561 区域（`window:maximize` 触发的状态广播） | |
| 4 | `window:fullscreen-changed` | `:130`, `:131` | `src/main.js:581/586/592/597` (`webContents.send`) | |
| 5 | `plugin:install-progress` | `:168`, `:172` | `src/ipc/plugin.js:104` 内部推送 | |
| 6 | `terminal:data` | `:246`, `:247` | `src/ipc/terminal.js:185` (`sendTerminalEvent`) | |
| 7 | `terminal:exit` | `:251`, `:252` | `src/ipc/terminal.js:188` (`sendTerminalEvent`) | |
| 8 | `skills:progress` | `:280`, `:281` | `src/main.js:774` (`webContents.send`) | 替代旧 polling |
| 9 | `updater:update-available` | `:323`, `:324` | `src/ipc/auto-update.js:54` (`webContents.send`) | |
| 10 | `updater:update-not-available` | `:328`, `:329` | `src/ipc/auto-update.js:54`（条件分支） | |
| 11 | `updater:download-progress` | `:333`, `:334` | `src/ipc/auto-update.js:44` (`webContents.send`) | |
| 12 | `updater:update-downloaded` | `:338`, `:339` | `src/ipc/auto-update.js:71` (`webContents.send`) | |
| 13 | `updater:error` | `:343`, `:344` | `src/ipc/auto-update.js:75`, `:86` (`webContents.send`) | |

> 表 2 合计：64 invoke + 13 on = **77 项**。


---

## 表 3 — `contextBridge.exposeInMainWorld` 暴露的 namespace

> 来源：`contextBridge.exposeInMainWorld('<namespace>', <api>)` 在 `src/preload.js` 的 3 处注册。

| # | Namespace | preload 行号 | 暴露的 surface | Notes |
|---:|:----------|:-------------|:---------------|:------|
| 1 | `biof3` | `src/preload.js:46` | `{ agentWorkbenchFlags: { getExtraRenderers, set, onChange } }` | UI 与 agent harness feature flag；`set` 走 invoke + 其余订阅/读取 |
| 2 | `biof3Desktop` | `src/preload.js:86` | 顶层字段 `isDesktop: true` + `platform` / `arch` / `backendConfig` + 21 个子 namespace（`window` / `app` / `aiSettings` / `computeSettings` / `harnessCapabilities` / `plugins` / `skills` / `contentPlugins` / `runtime` / `backend` / `py` / `plumber` / `files` / `diagnostic` / `telemetry` / `data` / `terminal` / `updater` / `branch` / `result`） | 主桥，详见表 5 |
| 3 | `process` | `src/preload.js:79` | `{ env: { BIOF3_DESKTOP?, NODE_ENV? } }` | 仅暴露 2 个环境变量；防 SSR/CSP 误用 |

> 表 3 总结：**3 个 namespace** 顶层暴露。

---

## 表 4 — frontend typed bridge (`desktopBridge.ts`)

> 来源：`frontend/src/lib/desktopBridge.ts` 是 typed accessor 层 — 它**不直接调用 IPC**，而是通过 `keyof DesktopBridge` 派生 `DesktopBridgeName` 类型，再让 `getBridge` / `requireBridge` 在 `electron.d.ts` 的 `Window.biof3Desktop` 上取值。共 **3 个 public API** + **1 个 error class**。

| # | API/Type | 行为 | Notes |
|---:|:---------|:-----|:------|
| 1 | `isDesktop(): boolean` | 判断 `typeof window !== 'undefined' && !!window.biof3Desktop` | 无 IPC 调用，纯 SSR 守卫 |
| 2 | `getBridge<K>(name: K): DesktopBridgeHandle<K> \| null` | 从 `window.biof3Desktop` 取子 bridge handle，缺失返 null | K 限定 `keyof DesktopBridge`（自动由 electron.d.ts 派生，新增子 namespace 自动可用） |
| 3 | `requireBridge<K>(name: K): DesktopBridgeHandle<K>` | 同上但缺失时抛 `BridgeUnavailableError` | 适用于 hot-path |
| 4 | `class BridgeUnavailableError extends Error` | 错误类型，含 `bridgeName: string \| number \| symbol` | 抛错时 console 便于排查 |

> 表 4 总结：3 个 accessor + 1 个错误类；其类型由 electron.d.ts 的 `Window.biof3Desktop` 全自动派生，故本文件只列 typed accessor 层，IPC channel 名见 **表 5**。

---

## 表 5 — `electron.d.ts` IPC type 声明（按 namespace 分组）

> 来源：`frontend/src/lib/electron.d.ts` 的 `Window.biof3Desktop` 命名空间声明 + `Window.biof3.agentWorkbenchFlags` + `Window.process.env`。按 21 个 namespace 分组列出 typed method surface + 4 个接口类型。

### 5.1 — `biof3Desktop.isDesktop` 元标记

- `isDesktop: true`

### 5.2 — `biof3Desktop.platform / arch / backendConfig`

| # | Field | 类型 | Notes |
|---:|:------|:-----|:------|
| 1 | `platform: string` | 字符串 | e.g. `'darwin'` / `'win32'` / `'linux'` |
| 2 | `arch: string` | 字符串 | e.g. `'x64'` / `'arm64'` |
| 3 | `backendConfig.rApiBase: string` | 字符串 | R server base URL |
| 4 | `backendConfig.pythonApiBase: string` | 字符串 | Python server base URL |

### 5.3 — `biof3Desktop.window`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `minimize()` | `() => void` | `window:minimize` (`ipcMain.on`) |
| 2 | `maximize()` | `() => void` | `window:maximize` |
| 3 | `close()` | `() => void` | `window:close` |
| 4 | `isMaximized()` | `() => Promise<boolean>` | `window:isMaximized` |
| 5 | `onMaximizeChanged(cb)` | `(cb: (v: boolean) => void) => () => void` | `window:maximize-changed` (on) |
| 6 | `isFullScreen()` | `() => Promise<boolean>` | `window:isFullScreen` |
| 7 | `toggleFullScreen()` | `() => void` | `window:toggleFullScreen` |
| 8 | `onFullScreenChanged(cb)` | `(cb: (v: boolean) => void) => () => void` | `window:fullscreen-changed` (on) |

### 5.4 — `biof3Desktop.app`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `relaunch()` | `() => Promise<{ok, error?}>` | `app:relaunch` |

### 5.5 — `biof3Desktop.aiSettings`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `get()` | `() => Promise<Record<string, unknown>>` | `ai-settings:get` |
| 2 | `save(settings)` | `(s) => Promise<void>` | `ai-settings:save` |
| 3 | `getCredential(id)` | `(id) => Promise<{ok, apiKey, error?}>` | `ai-settings:get-credential` |
| 4 | `test(provider, apiKey)` | `(p, k) => Promise<{ok, message}>` | `ai-settings:test` |
| 5 | `listModels(provider, apiKey)` | `(p, k) => Promise<{ok, models: string[], message}>` | `ai-settings:list-models` |

### 5.6 — `biof3Desktop.computeSettings`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `get()` | `() => Promise<ComputeSettings>` | `compute-settings:get` |
| 2 | `save(settings)` | `(s) => Promise<{ok, error?, restartRequired?}>` | `compute-settings:save` |

### 5.7 — `biof3Desktop.harnessCapabilities`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `list()` | `() => Promise<{ok, capabilities: HarnessCapabilityEntry[], error?}>` | `harness-capabilities:list` |

### 5.8 — `biof3Desktop.plugins`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `listInstalled()` | `() => Promise<Array<{id, version, type?, language?, ..., manifestDrift?}>>` | `plugin:list-installed` |
| 2 | `listRemote()` | `() => Promise<{plugins: Record<string, RemotePlugin>}>` | `plugin:list-remote` |
| 3 | `install(pluginId, onProgress?)` | `(id, cb) => Promise<{ok, error?}>` | `plugin:install` invoke + `plugin:install-progress` on |
| 4 | `uninstall(pluginId)` | `(id) => Promise<{ok, error?}>` | `plugin:uninstall` |
| 5 | `checkUpdates()` | `() => Promise<Array<{id, currentVersion, latestVersion}>>` | `plugin:check-updates` |


### 5.9 — `biof3Desktop.skills`（G0-RS / UI-157 / BLOCK-2）

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `discover()` | `() => Promise<{ok, skills?: Array<...>, error?}>` | `skills:discover` |
| 2 | `execute(skillId, params)` | `(id, p) => Promise<{ok, executionId?, error?}>` | `skills:execute` |
| 3 | `getExecution(executionId)` | `(id) => Promise<{ok, execution?: {...}, error?}>` | `skills:getExecution` |
| 4 | `cancel(executionId)` | `(id) => Promise<{ok, cancelled?, error?}>` | `skills:cancel`（PHASE 1 A） |
| 5 | `onProgress(cb)` | `(cb) => () => void` | `skills:progress`（`webContents.send`） |

### 5.10 — `biof3Desktop.contentPlugins`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `list()` | `() => Promise<Array<{id, contentType, omics, version, title}>>` | `content-plugin:list` |
| 2 | `listDocs(pluginId)` | `(id) => Promise<Array<{id, title, position, relativePath, pluginId}>>` | `content-plugin:list-docs` |
| 3 | `read(pluginId, relativePath)` | `(id, path) => Promise<{ok, content?, error?}>` | `content-plugin:read` |

### 5.11 — `biof3Desktop.runtime`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `status()` | `() => Promise<{r, python}>` | `runtime:status` |

### 5.12 — `biof3Desktop.backend`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `status()` | `() => Promise<BackendStatus>` | `backend:status` |

### 5.13 — `biof3Desktop.py`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `start()` | `() => Promise<{ok, alreadyRunning?, pid?, error?}>` | `py:start` |
| 2 | `stop()` | `() => Promise<{ok, wasRunning?}>` | `py:stop` |

### 5.14 — `biof3Desktop.plumber`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `start()` | `() => Promise<{ok, alreadyRunning?, pid?, error?}>` | `plumber:start` |
| 2 | `stop()` | `() => Promise<{ok, wasRunning?}>` | `plumber:stop` |

### 5.15 — `biof3Desktop.files`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `saveDialog(defaultName?)` | `(n?) => Promise<string \| null>` | `file:save-dialog` |
| 2 | `openDialog(filters?)` | `(f?) => Promise<string \| null>` | `file:open-dialog` |
| 3 | `openDirectoryDialog()` | `() => Promise<string \| null>` | `file:open-dialog`（带 `{ openDirectory: true }`） |
| 4 | `openPath(targetPath)` | `(p) => Promise<{ok, error?}>` | `file:open-path` |
| 5 | `openWorkspaceFile(workspacePath, relativePath)` | `(ws, rel) => Promise<{ok, error?}>` | `file:open-workspace-file` |

### 5.16 — `biof3Desktop.diagnostic`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `export(targetPath?)` | `(p?) => Promise<{ok, path?, error?}>` | `diagnostic:export` |

### 5.17 — `biof3Desktop.telemetry`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `report(payload)` | `(p: TelemetryPayload) => Promise<{ok, reason?}>` | `telemetry:report` |

### 5.18 — `biof3Desktop.data`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `info()` | `() => Promise<{ok, dataDir?, total?, breakdown?}>` | `data:info` |
| 2 | `openDir()` | `() => Promise<{ok, error?}>` | `data:open-dir` |

### 5.19 — `biof3Desktop.terminal`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `snapshot()` | `() => Promise<{ok, logDir?, dataDir?, processes?: Array<...>}>` | `terminal:snapshot` |
| 2 | `openLogDir()` | `() => Promise<{ok, path?, error?}>` | `terminal:open-log-dir` |
| 3 | `openShell(targetPath?)` | `(p?) => Promise<{ok, path?, error?}>` | `terminal:open-shell` |
| 4 | `startSession(targetPath?)` | `(p?) => Promise<{ok, pid?, cwd?, shell?, reused?, error?}>` | `terminal:session-start` |
| 5 | `writeSession(input)` | `(in) => Promise<{ok, error?}>` | `terminal:session-write` |
| 6 | `resizeSession(cols, rows)` | `(c, r) => Promise<{ok, error?}>` | `terminal:session-resize` |
| 7 | `stopSession()` | `() => Promise<{ok, wasRunning?}>` | `terminal:session-stop` |
| 8 | `onData(cb)` | `(cb: (s: string) => void) => () => void` | `terminal:data` |
| 9 | `onExit(cb)` | `(cb: (d: {code?, signal?}) => void) => () => void` | `terminal:exit` |

### 5.20 — `biof3Desktop.updater`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `check()` | `() => Promise<{ok, hasUpdate?, info?, version?, error?}>` | `updater:check` |
| 2 | `download()` | `() => Promise<{ok, error?} \| void>` | `updater:download` |
| 3 | `install()` | `() => Promise<{ok, error?} \| void>` | `updater:install` |
| 4 | `onUpdateAvailable(cb)` | `(cb: (info: {version}) => void) => () => void` | `updater:update-available` |
| 5 | `onUpdateNotAvailable(cb)` | `(cb: () => void) => () => void` | `updater:update-not-available` |
| 6 | `onDownloadProgress(cb)` | `(cb: (p: {ratio, transferred, total}) => void) => () => void` | `updater:download-progress` |
| 7 | `onUpdateDownloaded(cb)` | `(cb: () => void) => () => void` | `updater:update-downloaded` |
| 8 | `onError(cb)` | `(cb: (msg: string) => void) => () => void` | `updater:error` |

### 5.21 — `biof3Desktop.branch`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `create(params)` | `({projectId, name, parentBranchId?}) => Promise<{...}>` | `branch:create` |
| 2 | `list(params)` | `({projectId}) => Promise<Array<...>>` | `branch:list` |
| 3 | `switch(params)` | `({branchId}) => Promise<void>` | `branch:switch` |
| 4 | `delete(params)` | `({branchId}) => Promise<void>` | `branch:delete` |
| 5 | `rename(params)` | `({branchId, newName}) => Promise<void>` | `branch:rename` |
| 6 | `getActive(params)` | `({projectId}) => Promise<{...} \| null>` | `branch:active` |

> ⚠️ 注意：electron.d.ts 公开的 `biof3Desktop.branch` 仅 6 个方法；**它没有透出** `branch:project:create/get/update/list` / `branch:get/children` / `message:append/list/get/count/delete/clear` 共 13 项。这些 channel 在 main 有 handler 但**未在 electron.d.ts 暴露 typed method**（preload 也没 invoke 它们）。详见 **附录 A**。

### 5.22 — `biof3Desktop.result`

| # | Method | 签名 | 底层 IPC |
|---:|:-------|:-----|:---------|
| 1 | `create(params)` | `({projectId, type, name, data, config?, sourceBranchId?}) => Promise<{...}>` | `result:create` |
| 2 | `get(params)` | `({id}) => Promise<{...} \| null>` | `result:get` |
| 3 | `list(params)` | `({projectId, options?}) => Promise<Array<...>>` | `result:list` |
| 4 | `update(params)` | `({id, updates}) => Promise<{...} \| null>` | `result:update` |
| 5 | `delete(params)` | `({id}) => Promise<void>` | `result:delete` |
| 6 | `byProject(params)` | `({projectId, options?}) => Promise<Array<...>>` | `result:byProject` |
| 7 | `createFromConversation(params)` | `({projectId, branchId, options?}) => Promise<{...}>` | `result:createFromConversation` |
| 8 | `version.create(params)` | `({resultId, data, config?, createdByBranchId?}) => Promise<{...}>` | `result:version:create` |
| 9 | `version.get(params)` | `({id}) => Promise<{...} \| null>` | `result:version:get` |
| 10 | `version.getByNumber(params)` | `({resultId, version}) => Promise<{...} \| null>` | `result:version:getByNumber` |
| 11 | `version.list(params)` | `({resultId, limit?, offset?}) => Promise<Array<...>>` | `result:version:list` |

> 表 5 总结：`biof3Desktop` 共 21 个 namespace（含元标记 + 4 配置字段），其中 17 个是方法 namespace（`window` / `app` / `aiSettings` / `computeSettings` / `harnessCapabilities` / `plugins` / `skills` / `contentPlugins` / `runtime` / `backend` / `py` / `plumber` / `files` / `diagnostic` / `telemetry` / `data` / `terminal` / `updater` / `branch` / `result`）；加 `biof3.agentWorkbenchFlags` + `process.env` 两个顶层 namespace + 4 个 interface（`BackendStatus` / `TelemetryPayload` / `ComputeSettings` / `HarnessCapabilityEntry`）。


---

## 附录 A — 疑似孤儿 channel 清单

> 来源：表 1 vs 表 2 vs 表 5 全集比对后，存在 main 注册但 preload/d.ts 都没透出的 channel：

| # | Channel | Main handler | Preload invoke | electron.d.ts typed | 状态 | Notes |
|---:|:--------|:-------------|:---------------|:--------------------|:-----|:------|
| 1 | `result:createWithBranch` | ✅ `src/ipc/result-handlers.js:85` | ❌ | ❌ | **疑似孤儿 main-only** | test 断言存在（`test/result-handlers-valid-types.test.mjs:53-60`），但前端没有 typed accessor 也没有 `ipcRenderer.invoke` 调用；可能是为未来 UI 预留或已下线但 handler 未删 |
| 2 | `branch:project:create` | ✅ `src/ipc/branch-handlers.js:41` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 3 | `branch:project:get` | ✅ `src/ipc/branch-handlers.js:54` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 4 | `branch:project:update` | ✅ `src/ipc/branch-handlers.js:67` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 5 | `branch:project:list` | ✅ `src/ipc/branch-handlers.js:83` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 6 | `branch:get` | ✅ `src/ipc/branch-handlers.js:109` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 7 | `branch:children` | ✅ `src/ipc/branch-handlers.js:196` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 8 | `message:append` | ✅ `src/ipc/branch-handlers.js:211` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 9 | `message:list` | ✅ `src/ipc/branch-handlers.js:228` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 10 | `message:get` | ✅ `src/ipc/branch-handlers.js:241` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 11 | `message:count` | ✅ `src/ipc/branch-handlers.js:254` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 12 | `message:delete` | ✅ `src/ipc/branch-handlers.js:267` | ❌ | ❌ | **疑似孤儿 main-only** | |
| 13 | `message:clear` | ✅ `src/ipc/branch-handlers.js:283` | ❌ | ❌ | **疑似孤儿 main-only** | |

> **共 13 个疑似孤儿 channel**，全部位于 `src/ipc/branch-handlers.js`，可能用途：
> - 为未来 Branch Tab UI 预留（Phase 1 Phase 2 阶段产物）；
> - 或者被 result-studio 阶段局部使用但没接到 typed bridge layer；
> - 或者为内部 IPC 间通信用，但 `src/` 内未见 `ipcMain` 调用方亦未见 `ipcRenderer` 调用方。
>
> **不外推**：本工作包只列清单，**不**主动建议删除或重写，需由 BLOCK-15+ 工作包显式裁决是否激活（按 BLOCK-12 verification-only 收口模式治理）。

---

## 附录 B — 渲染层内部事件总线（renderer-only CustomEvent，非 IPC）

> 本附录**仅作背景**，**不属于 IPC catalog**。`frontend/src/lib/events.ts` 定义 10 个 `biof3:*` 字符串事件名（同 namespace 但走 `window.dispatchEvent(CustomEvent)`，不经过 Electron IPC）。它们的发送与订阅都在渲染进程内：

| # | 事件名 | 来源 | 订阅 |
|---:|:-------|:-----|:----|
| 1 | `biof3:onboarding-done` | DesktopOnboarding 完成 | App 的 DesktopOnboardingMount |
| 2 | `biof3:soft-refresh` | main.js preload on `Cmd+R` | project-workspace refetch |
| 3 | `biof3:project-open-result` | project-workspace right-panel | project-workspace 自身 |
| 4 | `biof3:project-open-artifact` | SimpleChat 内部 artifact 链接 | project-workspace |
| 5 | `biof3:project-open-workspace-file` | SimpleChat 内部 file 链接 | project-workspace |
| 6 | `biof3:project-workspace-changed` | Agent workspace 写盘 | Files panel |
| 7 | `biof3:copilot-ask` | App/Copilot 主流程 | SimpleChat |
| 8 | `biof3:browser-back` | App router | BrowserPane |
| 9 | `biof3:browser-forward` | App router | BrowserPane |
| 10 | `biof3:conversation-forked` | copilotContext / ConversationRunStore | project-workspace / SimpleChat |

> 注意区别：`biof3:agent-workbench-flags` 是 **真正的 IPC channel**（`ipcMain.handle` + `ipcRenderer.invoke/on` 双向），不要与上面这些 renderer-only `biof3:` 事件名混淆。

---

## 总结

| 维度 | 数量 |
|:------|-----:|
| 表 1 — main handler (`ipcMain.handle/on`) | **80** 项（82 处注册，3 项 `updater:*` 双注册计 1） |
| 表 2 — preload invoke + on (`ipcRenderer.invoke/on`) | **77** 项（64 invoke + 13 on） |
| 表 3 — `contextBridge.exposeInMainWorld` namespace | **3** 个顶层 namespace |
| 表 4 — frontend typed bridge API | **4** 个（3 accessor + 1 error class） |
| 表 5 — `electron.d.ts` typed IPC method surface | **~80** 项（按 namespace 21 个分组，方法分布在表 5.3–5.22） |
| 附录 A — 疑似孤儿 channel | **13** 项（全部位于 `src/ipc/branch-handlers.js` + 1 项 `result:createWithBranch`） |
| 附录 B — renderer-only CustomEvent 事件 | **10** 项（非 IPC 列此仅作背景） |
| **5 表合计 channel/typed surface** | **~244** 项 |
| **5 表合计**（不含附录） | **~244** 项 |

---

## 维护说明

- 本 catalog 是**纯只读静态扫描产物**，工作包 `BLOCK-14-IPC-CHANNEL-CATALOG` 收口后由后续 commit 保持——新加 channel 时请同步更新本表。
- 「orphan」状态可能在未来工作包中被激活（federated typed accessor + preload invoke），届时其行从附录 A 升入表 1/2/5。
- 不重新激活 BLOCK-9.6 "IPC channel 常量集中" deferred 项（按 G0 阶段纪律，不外推）。

---

## G0 阶段纪律收口

- `qualificationEligible: false` 维持 G0 长期开发期常态 · 不外推 packaged / Provider / GA / P7。
- 本工作包仅产出只读 catalog + 一份 orphan list，**未**对任何源文件做出修改。
- 不依赖 packaged / dev Electron / Provider / CDP / SSE 任何边界 — 静态 grep 即可生成。
- 4 治理门 GREEN：`docs:check` / `docs:reconcile` / `tsc --noEmit` / `ui:audit:check`（其中 `docs:check` 必须通过新加 reference entry 验证）。
- AUDIT-LOG 末行追加本工作包收口记录（详见 `docs/AUDIT-LOG.md` 末行）。
- DOC-REGISTRY 末尾追加 `BLOCK-14-IPC-CHANNEL-CATALOG` reference entry（详见 `docs/DOC-REGISTRY.json`）。
