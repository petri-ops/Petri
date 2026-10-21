// Petri 桌面版原生 shell — Electron preload 桥
// 桌面版前端通过 window.petriDesktop 访问 Electron IPC
// （从 desktop-app/src/preload.js 暴露的 API）

// M1-1：后端就绪感知层返回结构
export interface BackendStatus {
  /** `true` 已安装 / `false` 确认缺失 / `null` 状态未知（backend:status 查询
   *  失败时的兜底）。消费端判断"缺失"必须用 `=== false`，用 `!rRuntime` 会把
   *  "未知"误判成"缺失"，导致偶发 IPC 异常时错弹首次配置引导页。 */
  rRuntime: boolean | null;
  pyRuntime: boolean | null;
  /** BLOCK-66 P1：历史名，语义 = petri-server up（与 serverUp 同值，保留兼容）。 */
  rServerUp: boolean;
  /** BLOCK-66 P1 additive：petri-server 就绪（与 R 运行时安装状态解绑——
   *  R 缺失时应用全功能可用，isReady 不再因 rRuntime=false 而为 false）。
   *  optional：历史 fixture 无需逐个补字段。 */
  serverUp?: boolean;
  isReady: boolean;
  downReason: string | null;
  /** true once the first backend status read has resolved — lets the UI
   *  avoid flashing runtime-missing banners before detection has run. */
  loaded: boolean;
}

// M2-3：可选错误遥测 payload（最小化，隐私优先）
// 仅含 category + errorSummary；appVersion/timestamp 由主进程补全
export interface TelemetryPayload {
  category?: string;
  errorSummary?: string;
}

/** Stage 3 M1: one entry from the Harness provisioning ledger. */
export interface HarnessCapabilityEntry {
  capabilityId: string;
  kind: string; // 后端值域：'bundle' | 'runtime'
  version: string;
  sha256: string | null;
  url: string;
  size: number | null;
  installDir: string;
  installedAt: number;
  attempts: number;
}

// UI-311 — result:* IPC handler 统一 fail-closed 信封（preload 1:1 镜像如实声明）。
// 拆包单点在 lib/resultBridge.ts，前端消费方仍见裸值契约。
type ResultIpcEnvelope<T> = { ok: boolean; data?: T; error?: string };

// UI-P2-001 — branch:* IPC handler 返回的落库行（snake_case SQLite 列，
// src/database/branch-db.js 原样返回）。camelCase 映射在 lib/branchBridge.ts。
type BranchRowRecord = {
  id: string;
  project_id: string;
  name: string;
  parent_branch_id: string | null;
  created_at: number;
  updated_at: number;
  is_active: number | boolean;
};

declare global {
  interface Window {
    /** BLOCK-61 品牌桥主全局名。 */
    petri?: {
      isDesktop: true;
      platform: string;
      arch: string;
      backendConfig: {
        rApiBase: string;
      };
      window: {
        minimize: () => void;
        maximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void;
        /** Mac fullscreen support */
        isFullScreen: () => Promise<boolean>;
        toggleFullScreen: () => void;
        onFullScreenChanged: (callback: (isFullScreen: boolean) => void) => () => void;
        /** BLOCK-100/UI-411 — 测试实例窗口管理（handler 仅测试实例放行） */
        setAlwaysOnTop: (flag: boolean, level?: 'floating' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver') => Promise<{ ok: boolean; alwaysOnTop?: boolean }>;
        setIgnoreMouseEvents: (flag: boolean) => Promise<{ ok: boolean }>;
        /** UI-413 — 管理模式（Ctrl+Alt+M）切换事件；manageMode=true=已解锁 */
        onTestManageModeChanged: (callback: (manageMode: boolean) => void) => () => void;
      };
      /** BLOCK-59 窗口系统 — 窗口状态机（docked/popped/railed/closed）IPC 面。 */
      windowManager: {
        /** 把内容弹出为独立窗口；同内容已弹出 = 聚焦既有窗（禁双开）。 */
        popOut: (type: string, key?: string) => Promise<{
          ok: boolean;
          id?: string;
          action?: 'created' | 'focused' | 'restored' | 'singleton';
          autoDemoted?: string | null;
          code?: string;
          error?: string;
        }>;
        /** popped → docked：弹出窗收回主窗（BrowserWindow 销毁，状态零丢失）。 */
        returnToDock: (id: string) => Promise<{ ok: boolean; state?: string; code?: string; error?: string }>;
        /** popped → railed：× = 降格进边缘轨道（永不销毁，plan §3 不可变契约）。 */
        minimizeToRail: (id: string) => Promise<{ ok: boolean; state?: string; code?: string; error?: string }>;
        /** railed → popped：从轨道恢复（回记忆位置）。 */
        restore: (id: string) => Promise<{ ok: boolean; state?: string; autoDemoted?: string | null; code?: string; error?: string }>;
        /** railed → closed：唯一的销毁路径（仅轨道内显式移除）。 */
        remove: (id: string) => Promise<{ ok: boolean; state?: string; code?: string; error?: string }>;
        /** UI-385 — 独立窗下钻通道：把载荷转发到主窗（右栏打开结果/智能体）。 */
        openResultInMainWindow: (payload: { type: string; detail?: unknown }) => Promise<{
          ok: boolean;
          code?: string;
          error?: string;
        }>;
        /** UI-385 — 主窗接收 relay（仅白名单类型会被主进程转发）。 */
        onRelayToMain: (callback: (payload: { type: string; detail?: unknown }) => void) => () => void;
        snapshot: () => Promise<{
          ok: boolean;
          snapshot?: {
            maxPopped: number;
            entries: Array<{
              id: string;
              type: string;
              key: string;
              state: 'docked' | 'popped' | 'railed';
              railClass: 'static' | 'persistent';
              fadeAfter: number | null;
              createdAt: number;
              poppedAt: number | null;
              railedAt: number | null;
            }>;
            singletons: Record<string, { type: string; route: string }>;
          };
          code?: string;
        }>;
        /** 当前窗口的内容身份：主窗为 null，弹出窗为 'type:key'。 */
        self: () => Promise<{ ok: boolean; contentId: string | null; code?: string }>;
        /** 轨道 hover 卡内容预览：降格瞬间快照 dataURL（无快照 ok:false）。 */
        thumbnail: (id: string) => Promise<{ ok: boolean; dataUrl?: string | null; code?: string }>;
        /** 轨道容器窗专用：hover 条带/卡时切换点击穿透（仅轨道窗 sender 生效）。 */
        setRailMouseIgnore: (ignore: boolean) => void;
        /** 注册表增量多播（所有存活窗）：{ kind: 'upsert', entry } / { kind: 'remove', id }。 */
        onStateChanged: (
          callback: (
            payload:
              | { kind: 'upsert'; entry: { id: string; type: string; key: string; state: 'docked' | 'popped' | 'railed'; railClass: 'static' | 'persistent'; fadeAfter: number | null; createdAt: number; poppedAt: number | null; railedAt: number | null } }
              | { kind: 'remove'; id: string }
          ) => void
        ) => () => void;
      };
      /** 应用级控制 —— 装完运行时后需整体重启（PETRI_R_HOME 在 main 启动时固化）。 */
      app: {
        relaunch: () => Promise<{ ok: boolean; error?: string }>;
        /** BLOCK-223 — 退出摘要只读计数（主进程把终端会话数合并进来）。 */
        getActivitySummary: () => Promise<{
          ok: boolean;
          counts: Record<string, number>;
          total: number;
          fetchedAt: string | null;
          degraded: boolean;
        }>;
        getShellStatus: () => Promise<{
          ok: boolean;
          closeToTray: boolean;
          notifyOnTurnEnd: boolean;
          trayActive: boolean;
          notificationsSupported: boolean;
          testInstance: boolean;
        }>;
        setShellPrefs: (prefs: {
          closeToTray?: boolean;
          notifyOnTurnEnd?: boolean;
        }) => Promise<{
          ok: boolean;
          changed?: boolean;
          prefs?: { closeToTray: boolean; notifyOnTurnEnd: boolean };
        }>;
        notify: (payload: {
          kind: 'turn_completed' | 'turn_failed' | 'approval_required';
          conversationId?: string;
          label?: string;
          toolName?: string;
          dedupeKey?: string;
        }) => Promise<{ shown: boolean; reason?: string; wouldShow?: boolean }>;
        respondQuitDecision: (
          action: 'cancel' | 'tray' | 'quit'
        ) => Promise<{ ok: boolean; action?: string; reason?: string; preview?: boolean }>;
        onQuitRequested: (
          callback: (payload: {
            counts: Record<string, number>;
            total: number;
            rows: Array<{ key: string; label: string; value: number }>;
            reason?: string;
            preview?: boolean;
            trayAvailable?: boolean;
          }) => void
        ) => () => void;
        onNotificationClicked: (
          callback: (payload: { kind?: string; conversationId?: string | null }) => void
        ) => () => void;
        previewQuitSummary: () => Promise<{ ok: boolean; reason?: string }>;
        hideToTray: () => Promise<{ ok: boolean; reason?: string }>;
        showMain: () => Promise<{ ok: boolean; reason?: string }>;
      };
      aiSettings: {
        get: () => Promise<Record<string, unknown>>;
        save: (settings: Record<string, unknown>) => Promise<void>;
        getCredential: (credentialId: string) => Promise<{ ok: boolean; apiKey: string; error?: string }>;
        test: (providerOrProfile: string | Record<string, unknown>, apiKey: string) => Promise<{ ok: boolean; message: string }>;
        listModels: (providerOrProfile: string | Record<string, unknown>, apiKey: string) => Promise<{ ok: boolean; models: string[]; message: string }>;
      };
      /** Stage 3 M1: read-only view of Harness-provisioned capabilities (runtimes/bundles). */
      harnessCapabilities: {
        list: () => Promise<{ ok: boolean; capabilities: HarnessCapabilityEntry[]; error?: string }>;
      };
      plugins: {
        // BLOCK-158 商店面退役 — 仅存目录读面（listRemote=运行时目录投影，
        // 供包卡片运行时标题/体积）；安装/卸载/更新 = 领域包通道 packs.*。
        listInstalled: () => Promise<
          Array<{
            id: string;
            version: string;
            type?: string;
            language?: string;
            scriptFingerprint?: string | null;
            installedFingerprint?: string | null;
            currentFingerprint?: string | null;
            manifestDrift?: boolean;
            driftReason?: string | null;
          }>
        >;
        listRemote: () => Promise<{ plugins: Record<string, RemotePlugin> }>;
      };
      // BLOCK-84：领域包一键装/卸桥
      // BLOCK-86 P1/P2：requires.runtimes 契约 + contents 内容概要 +
      // uninstallPlan 卸载影响预览 + uninstall 三档显式勾选 + 安装进度订阅
      packs: {
        listInstalled: () => Promise<Array<{
          packId: string; packRoot: string; version: string; installedAt: string;
          name?: string;
          /** BLOCK-157 加映（UI-481）— 整包启停（缺省 true=启用） */
          enabled?: boolean;
          requiresRuntimes?: Array<{ pluginId: string; version?: string }>;
          contents?: { pluginCount: number; plugins: Array<{ id: string; language: string | null; version: string | null }>; pluginIds: string[]; scriptCount: number; demoDataCount: number };
        }>>;
        listAvailable: () => Promise<Array<{
          packId: string; name: string; nameEn?: string | null; version: string; description: string; packRoot: string; installed: boolean;
          requiresRuntimes?: Array<{ pluginId: string; version?: string }>;
          contents?: { pluginCount: number; plugins: Array<{ id: string; language: string | null; version: string | null }>; pluginIds: string[]; scriptCount: number; demoDataCount: number };
        }>>;
        installFromDialog: () => Promise<{ ok: boolean; canceled?: boolean; pack?: { packId: string }; runtimes?: Array<{ pluginId: string; ok: boolean; skipped?: string; error?: string }>; requiresRestart?: boolean; error?: string }>;
        installPath: (packRoot: string) => Promise<{ ok: boolean; pack?: { packId: string }; runtimes?: Array<{ pluginId: string; ok: boolean; skipped?: string; error?: string }>; requiresRestart?: boolean; error?: string }>;
        /** BLOCK-157 加映（UI-481）— 整包启停（停用即不接线/启用免重装；重启后生效） */
        setEnabled: (packId: string, enabled: boolean) => Promise<{ ok: boolean; packId?: string; enabled?: boolean; restartRequired?: boolean; error?: string }>;
        /** BLOCK-158 — 运行时补装（包卡片「必需 · 缺失」补装；进度走 onInstallProgress） */
        installRuntime: (pluginId: string) => Promise<{ ok: boolean; pluginId?: string; restartRequired?: boolean; error?: string }>;
        uninstallPlan: (packId: string) => Promise<{
          ok: boolean;
          packId?: string;
          requiresRuntimes?: Array<{ pluginId: string; version?: string }>;
          runtimes?: {
            removable: Array<{ pluginId: string; installed: boolean; sizeBytes: number | null }>;
            retained: Array<{ pluginId: string; requiredBy: string[] }>;
          };
          packSource?: { dir: string | null; exists: boolean; sizeBytes: number | null };
          userDataPolicy?: string;
          error?: string;
        }>;
        uninstall: (packId: string, options?: { deleteRuntimes?: boolean; deletePackSource?: boolean }) => Promise<{
          ok: boolean;
          packId?: string;
          removed?: { record: boolean; runtimes: Array<{ pluginId: string; ok: boolean; skipped?: string; error?: string }>; packSourceDir?: string };
          kept?: { packSourceDir?: string | null; userDataPolicy: string; packSourceError?: string };
          requiresRestart?: boolean;
          error?: string;
        }>;
        onInstallProgress: (callback: (payload: { pluginId: string; progress: { ratio: number; received: number; total: number } }) => void) => () => void;
      };
      // G0-RS: Skills discovery & execution bridge
      skills: {
        discover: () => Promise<{
          ok: boolean;
          skills?: Array<{
            id: string;
            name: string;
            version: string;
            description: string;
            category: string;
            source: 'built-in' | 'pack' | 'installed';
            tags: string[];
            capabilities?: string[];
            parameters: {
              required: string[];
              optional: Record<string, {
                type: 'select' | 'number' | 'string' | 'boolean' | 'file';
                description: string;
                options?: string[];
                default?: unknown;
                min?: number;
                max?: number;
                step?: number;
                accept?: string;
                pattern?: string;
              }>;
            };
            plugins: { required: string[]; optional: string[] };
            outputs?: { primary: Array<{
              id: string; type: string; label: string;
              description?: string; format?: string; columns?: string[];
            }>; secondary: Array<{
              id: string; type: string; label: string;
              description?: string; format?: string; columns?: string[];
            }> };
          }>;
          error?: string;
        }>;
        execute: (
          skillId: string,
          params: Record<string, unknown>
        ) => Promise<{ ok: boolean; executionId?: string; error?: string }>;
        getExecution: (executionId: string) => Promise<{
          ok: boolean;
          execution?: {
            executionId: string;
            skillId: string;
            status: 'pending' | 'running' | 'completed' | 'failed';
            startedAt?: string;
            completedAt?: string;
            result?: unknown;
            error?: string;
          };
          error?: string;
        }>;
        // PHASE 1 A：cancel + onProgress 桥接（G0 UI-157 IPC 桥接通；2026-08-16）
        cancel: (executionId: string) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
        /** BLOCK-156 D7 — 导入本地技能目录（主进程文件对话框一条龙；canceled=用户取消）。 */
        importDirectory: () => Promise<{ ok: boolean; skillId?: string; canceled?: boolean; error?: string; message?: string; errors?: string[] }>;
        /** BLOCK-177 — 技能治理（动作落 skill-prefs 审计）。 */
        setDisabled: (skillId: string, disabled: boolean, reason?: string) => Promise<{ ok: boolean; disabled?: boolean; error?: string; message?: string }>;
        uninstall: (skillId: string) => Promise<{ ok: boolean; removed?: string; error?: string; message?: string }>;
        getInstallInfo: (skillId: string) => Promise<{
          ok: boolean;
          skillId?: string;
          sourceDir?: string | null;
          sourceExists?: boolean;
          importedAt?: string | null;
          error?: string;
          message?: string;
        }>;
        reinstall: (skillId: string) => Promise<{ ok: boolean; skillId?: string; version?: string; error?: string; message?: string }>;
        /** BLOCK-156 D7 — 按路径导入（测试/探针通道，与对话框共用安装函数）。 */
        importPath: (dir: string) => Promise<{ ok: boolean; skillId?: string; error?: string; message?: string; errors?: string[] }>;
        /** 订阅 SkillsSDK 进度推送。Callback 收到 main.js 通过 webContents.send('skills:progress') 推送的 payload；返回 unsubscribe 函数。 */
        onProgress: (callback: (payload: {
          executionId: string;
          status?: 'pending' | 'running' | 'completed' | 'failed';
          checkpoints?: unknown[];
          result?: unknown;
          error?: string;
          startedAt?: string;
          completedAt?: string;
        }) => void) => () => void;
      };
      // M2-9：content-plugin 文档桥（docs.tsx 运行时拉取已装教程插件）
      contentPlugins: {
        list: () => Promise<
          Array<{
            id: string;
            contentType: string;
            omics: string;
            version: string;
            title: string;
          }>
        >;
        listDocs: (pluginId: string) => Promise<
          Array<{
            id: string;
            title: string;
            position: number;
            relativePath: string;
            pluginId: string;
          }>
        >;
        read: (
          pluginId: string,
          relativePath: string
        ) => Promise<{ ok: boolean; content?: string; error?: string }>;
      };
      runtime: {
        status: () => Promise<{
          r: { installed: boolean; path: string | null };
          python: { installed: boolean; path: string | null };
        }>;
      };
      // M1-1：后端就绪感知层
      backend: {
        status: () => Promise<BackendStatus>;
      };
      // BLOCK-51 P3：py / plumber 按需启停通道已随 py-server（BLOCK-30 P1）
      // 与 plumber 空壳（BLOCK-51 P3）摘除。
      files: {
        saveDialog: (defaultName?: string) => Promise<string | null>;
        openDialog: (filters?: unknown) => Promise<string | null>;
        openDirectoryDialog: () => Promise<string | null>;
        validateDirectory: (
          targetPath: string
        ) => Promise<{ ok: boolean; data?: { path: string }; error?: string }>;
        listDirectory: (dirPath?: string) => Promise<{
          ok: boolean;
          data?: { path: string; parent: string | null; home: string; dirs: Array<{ name: string; path: string }> };
          error?: string;
        }>;
        openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
        openWorkspaceFile: (
          workspacePath: string,
          relativePath: string
        ) => Promise<{ ok: boolean; error?: string }>;
        /** BLOCK-216 Q5 — 在系统文件管理器中显示（同一 workspace 边界）。 */
        showInFolder: (
          workspacePath: string,
          relativePath: string
        ) => Promise<{ ok: boolean; error?: string }>;
        /** UI-400-2 — 导出/下载：主进程保存对话框 + 受限本机来源流式写盘。 */
        downloadFromUrl: (
          url: string,
          name: string
        ) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
        // UI-453 加映二 — OS 拖出（webContents.startDrag 接管为真文件拖拽）
        startFileDrag: (payload: { localPath?: string; url?: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
        /** UI-444 加映 — 文本另存为：原生保存对话框（用户确认位置）+ 主进程写所选路径。 */
        saveTextFile: (
          defaultName: string,
          content: string
        ) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
        /** BLOCK-53 P1 — 拖拽目录直达：把拖入窗口的 File 对象解析为磁盘绝对路径（拿不到返回 null）。 */
        pathForFile: (file: File) => string | null;
      };
      // BLOCK-19 — workspace 边界内文本覆盖
      workspace: {
        writeTextFile: (
          workspacePath: string,
          relativePath: string,
          content: string
        ) => Promise<{ ok: boolean; data?: { savedAt: string }; error?: string }>;
      };
      diagnostic: {
        export: (targetPath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
        crashStatus: () => Promise<{
          ok: boolean;
          uncleanExit?: boolean;
          previousStartedAt?: string | null;
          lastCleanExitAt?: string | null;
          dumps?: Array<{ name: string; size: number; mtime: string }>;
          crashDumpsDir?: string | null;
          simulated?: boolean;
          error?: string;
        }>;
        crashOpenDumps: () => Promise<{ ok: boolean; error?: string }>;
        crashSimulate: (payload: {
          uncleanExit?: boolean;
          previousStartedAt?: string;
          dumps?: Array<{ name: string; size: number; mtime: string }>;
        }) => Promise<{ ok: boolean; reason?: string; status?: unknown }>;
      };
      // M2-3：可选错误遥测（默认关闭，用户主动开启后才会上报）
      // payload 仅含 category + errorSummary，不含用户数据/路径/文件名
      telemetry: {
        report: (payload: TelemetryPayload) => Promise<{ ok: boolean; reason?: string }>;
      };
      data: {
        info: () => Promise<{
          ok: boolean;
          dataDir?: string;
          total?: number;
          breakdown?: Record<string, number>;
          // BLOCK-150 ⑨：明细键的中文名（源侧 data-management.js 提供，键=breakdown 键）
          labels?: Record<string, string>;
        }>;
        openDir: () => Promise<{ ok: boolean; error?: string }>;
      };
      terminal: {
        snapshot: () => Promise<{
          ok: boolean;
          logDir?: string;
          dataDir?: string;
          processes?: Array<{
            id: string;
            label: string;
            command: string;
            status: 'running' | 'stopped';
            pid?: number | null;
            logPath?: string;
            output: string;
          }>;
        }>;
        openLogDir: () => Promise<{ ok: boolean; path?: string; error?: string }>;
        openShell: (targetPath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
        /** BLOCK-54 P2 多 Tab：sessionId 可选（不传 = 旧单会话 default tab）。 */
        startSession: (
          targetPath?: string,
          sessionId?: string,
          ssh?: { alias: string; remotePath: string }
        ) => Promise<{
          ok: boolean;
          pid?: number;
          cwd?: string;
          shell?: string;
          reused?: boolean;
          sessionId?: string;
          limitReached?: boolean;
          error?: string;
        }>;
        writeSession: (input: string, sessionId?: string) => Promise<{ ok: boolean; error?: string }>;
        resizeSession: (
          cols: number,
          rows: number,
          sessionId?: string
        ) => Promise<{ ok: boolean; error?: string }>;
        stopSession: (sessionId?: string) => Promise<{ ok: boolean; wasRunning?: boolean }>;
        listSessions: () => Promise<{
          ok: boolean;
          sessions?: Array<{ sessionId: string; pid: number; cwd: string; running: boolean }>;
          maxTabs?: number;
          error?: string;
        }>;
        onData: (callback: (payload: { sessionId: string; data: string }) => void) => () => void;
        onExit: (
          callback: (payload: {
            sessionId: string;
            code?: number | null;
            signal?: string | null;
          }) => void
        ) => () => void;
      };
      updater: {
        check: () => Promise<{
          ok: boolean;
          hasUpdate?: boolean;
          info?: { version: string };
          version?: string;
          error?: string;
        }>;
        download: () => Promise<{ ok: boolean; error?: string } | void>;
        install: () => Promise<{ ok: boolean; error?: string } | void>;
        onUpdateAvailable: (cb: (info: { version: string }) => void) => () => void;
        onUpdateNotAvailable: (cb: () => void) => () => void;
        onDownloadProgress: (
          cb: (p: { ratio: number; transferred: number; total: number }) => void
        ) => () => void;
        onUpdateDownloaded: (cb: () => void) => () => void;
        onError: (cb: (msg: string) => void) => () => void;
      };
      /** BLOCK-67 加映（UI-326）— IP+密码 引导连接（一次性装公钥，密码不存储） */
  ssh: {
    registerHost: (params: {
      ip: string;
      port: number | string;
      username: string;
      password: string;
      alias?: string;
    }) => Promise<{ ok: boolean; alias?: string; alreadyRegistered?: boolean; error?: string }>;

  };

  // BLOCK-16 — Working Tree Review Mode (PR-style diff viewer)
      // BLOCK-32 — 全方法 params 可携带 projectId（项目级审阅隔离，additive）
      workingTreeReview: {
        status: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: {
            files: Array<{
              path: string;
              oldPath: string | null;
              status: string;
              untracked: boolean;
              conflicted: boolean;
              // BLOCK-41 — 暂存区两栏分组所需 additive 字段（porcelain X/Y）
              staged: boolean;
              indexStatus: string;
              worktreeStatus: string;
            }>;
            totalFiles: number;
            hasUntracked: boolean;
            hasConflict: boolean;
          };
          error?: string;
          message?: string;
        }>;
        diff: (params?: { paths?: string[]; staged?: boolean; projectId?: string }) => Promise<{
          ok: boolean;
          data?: {
            files: Array<{
              path: string;
              oldPath: string | null;
              binary: boolean;
              hunks: Array<{ oldStart: number; newStart: number; lines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>; truncated?: boolean }>;
            }>;
            truncated: boolean;
            summary: { added: number; removed: number };
          };
          error?: string;
          message?: string;
        }>;
        fileContent: (params: { path: string; ref?: 'HEAD' | 'WORKTREE'; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { content: string; encoding: 'utf-8' | 'base64'; size: number; truncated?: boolean; message?: string; deleted?: boolean; missing?: boolean };
          error?: string;
          message?: string;
        }>;
        applyHunk: (params: {
          file: string;
          hunkIndex: number;
          action: 'accept' | 'reject';
          hunk?: { oldStart: number; newStart: number; lines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> };
          feedback?: string;
          taskId?: string;
          projectId?: string;
        }) => Promise<{
          ok: boolean;
          data?: { action: 'accept' | 'reject'; file: string; hunkIndex: number };
          error?: string;
          message?: string;
        }>;
        // BLOCK-20 — per-hunk reject via applyInverseHunk.
        // `patch` 是正向 unified diff（带 ---/+++ 与 @@ header），由主进程内部 invert + apply。
        // `hunk` 可选，传了则写入 reject 清单时填充 oldText/newText。
        rejectHunkByInverseHunk: (params: {
          file: string;
          hunkIndex: number;
          patch: string;
          hunk?: { oldStart: number; newStart: number; lines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> };
          feedback?: string;
          taskId?: string;
          projectId?: string;
        }) => Promise<{
          ok: boolean;
          data?: { ok: true; action: 'reject'; file: string; hunkIndex: number };
          error?: string;
          message?: string;
        }>;
        revert: (params?: { paths?: string[]; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { reverted: string[] };
          error?: string;
          message?: string;
        }>;
        onTaskDone: (cb: (info: { taskId: string | null; filesChanged: string[]; notifiedAt: string }) => void) => () => void;
        // BLOCK-20 — Code Review Panel 新增 5 方法
        listModified: (params?: { includeUntracked?: boolean; projectId?: string }) => Promise<{
          ok: boolean;
          data?: {
            files: Array<{ path: string; status: string; indexStatus: string; workTreeStatus: string }>;
            count: number;
          };
          error?: string;
          message?: string;
        }>;
        fileHeadContent: (params: { path: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { content: string | null; mtime: string | null };
          error?: string;
          message?: string;
        }>;
        splitSideDiff: (params: { path: string; context?: number; projectId?: string }) => Promise<{
          ok: boolean;
          data?: {
            diff: string;
            headContent: string | null;
            workTreeContent: string;
            hunks: Array<{ oldStart: number; newStart: number; lines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> }>;
            summary: { added: number; removed: number };
            truncated: boolean;
          };
          error?: string;
          message?: string;
        }>;
        revertFile: (params: { path: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { reverted: string[] };
          error?: string;
          message?: string;
        }>;
        applyInverseHunk: (params: { patch: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { ok: true };
          error?: string;
          message?: string;
        }>;
        // UI-449（C-16）— 审阅徽章 ±行数权威源（git shortstat，tracked/untracked 分开）
        workingTreeShortstat: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: {
            tracked: { files: number; added: number; removed: number };
            untrackedFiles: number;
            empty: boolean;
          };
          error?: string;
          message?: string;
        }>;
        // BLOCK-20 — Commit Review
        commitReview: (params: {
          decisions: Record<string, 'accept' | 'reject' | 'pending'>;
          message: string;
          projectId?: string;
        }) => Promise<{
          ok: boolean;
          data?: {
            commit: string | null;
            files: string[];
            message: string;
            rejectedFiles: string[];
            stats: { acceptedFiles: number; rejectedFiles: number; totalWorkingTree: number };
          };
          error?: string;
          message?: string;
        }>;
        // BLOCK-29 — 提交历史（审阅面板「历史」分区，只读）；BLOCK-29.3 载荷 additive 增加 message；
        // BLOCK-29.5 参数 additive 增加 ref（分支选择器）并修复 skip/file IPC 透传；
        // UI-234 载荷 additive 增加 stats（--shortstat，列表行默认可见）
        commitLog: (params: { limit?: number; skip?: number; file?: string | null; ref?: string | null; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { commits: Array<{ sha: string; shortSha: string; author: string; isoDate: string; subject: string; message: string; stats?: { files: number; added: number; removed: number } | null }>; count: number };
          error?: string;
          message?: string;
        }>;
        // BLOCK-29.5 — 本地分支列表（历史分区选择器，只读）
        branchList: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { branches: Array<{ name: string; shortSha: string; isoDate: string; current: boolean }>; count: number };
          error?: string;
          message?: string;
        }>;
        // BLOCK-29.5 — 逐行归属（文件视图第四态，只读；ref 可为提交 sha）
        blame: (params: { path: string; ref?: string | null; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { path: string; lines: Array<{ line: number; sha: string }>; commits: Record<string, { sha: string; shortSha: string; author: string; isoDate: string; subject: string }>; truncated: boolean };
          error?: string;
          message?: string;
        }>;
        // BLOCK-29.5 — stash/标签列表（只读）
        stashList: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { stashes: Array<{ ref: string; shortSha: string; isoDate: string; subject: string }>; count: number };
          error?: string;
          message?: string;
        }>;
        tagList: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { tags: Array<{ name: string; shortSha: string; isoDate: string }>; count: number };
          error?: string;
          message?: string;
        }>;
        // BLOCK-29.5 — commitDiff/commitFileContent 参数 additive：区间对比模式
        //（commitDiff 传 {fromRef,toRef}；commitFileContent 传 {path,fromRef,toRef}，hash 可省）
        commitDiff: (params: { hash?: string; fromRef?: string; toRef?: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { files: Array<{ path: string; oldPath: string | null; binary: boolean; hunks: Array<{ oldStart: number; newStart: number; lines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }> }> }>; truncated: boolean; summary: { added: number; removed: number } };
          error?: string;
          message?: string;
        }>;
        commitFileContent: (params: { hash?: string; path: string; fromRef?: string; toRef?: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { original: string; modified: string };
          error?: string;
          message?: string;
        }>;
        // BLOCK-29.2 — git 工具二期（前端确认后调用）
        discardFile: (params: { path: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { discarded: string[]; deleted: boolean };
          error?: string;
          message?: string;
        }>;
        undoLastCommit: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { undoneCommit: string };
          error?: string;
          message?: string;
        }>;
        // BLOCK-41 — git 写操作三期（暂存两栏 / 分支切换 / push-pull）
        stagePaths: (params: { paths: string[]; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { staged: string[] };
          error?: string;
          message?: string;
        }>;
        unstagePaths: (params: { paths: string[]; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { unstaged: string[] };
          error?: string;
          message?: string;
        }>;
        commitIndex: (params: { message: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { commit: string | null; message: string; remaining: number };
          error?: string;
          message?: string;
        }>;
        checkoutBranch: (params: { name: string; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { branch: string; switched: boolean; reason?: string };
          error?: string;
          message?: string;
          detail?: { conflicts?: string[]; dirtyCount?: number } | null;
        }>;
        // BLOCK-176 CP-17 — 工作树 checkpoint 安全网
        checkpointCreate: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { ok: boolean; created: boolean; ref: string | null; code?: string; message?: string };
          error?: string;
          message?: string;
        }>;
        checkpointRollback: (params?: { projectId?: string; ref?: string }) => Promise<{
          ok: boolean;
          data?: { ok: boolean; ref: string; code?: string; message?: string };
          error?: string;
          message?: string;
        }>;
        remoteList: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>; count: number };
          error?: string;
          message?: string;
        }>;
        remoteStatus: (params?: { projectId?: string }) => Promise<{
          ok: boolean;
          data?: { upstream: string | null; ahead: number | null; behind: number | null };
          error?: string;
          message?: string;
        }>;
        push: (params: { remote?: string | null; branch?: string | null; setUpstream?: boolean; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { remote: string; branch: string; pushed: boolean };
          error?: string;
          message?: string;
        }>;
        pull: (params: { remote?: string | null; branch?: string | null; projectId?: string }) => Promise<{
          ok: boolean;
          data?: { remote: string; branch: string; pulled: boolean; output: string };
          error?: string;
          message?: string;
        }>;
        /** BLOCK-53 P2 — 非 git 工作区一次性引导：git init + 初始提交（幂等）。 */
        initRepository: (params: { projectId: string }) => Promise<{
          ok: boolean;
          data?: {
            alreadyGit?: boolean;
            initialized?: boolean;
            committed?: boolean;
            path: string;
            warning?: string;
          };
          error?: string;
          message?: string;
        }>;
      };
      // Phase 1: Branch Tab UI - conversation branch management
      // UI-P2-001 — branch:* IPC handler 如实声明：统一 fail-closed 信封 +
      // snake_case 落库行（src/database/branch-db.js 原样返回，不做 camel 映射）。
      // 拆包 + snake→camel 映射单点在 lib/branchBridge.ts，前端消费方仍见裸
      // camelCase Branch 契约。参数键以 src/ipc/branch-handlers.js 为准：
      // switch 需 { branchId, projectId }；delete/rename 用 { id }（非 branchId）。
      branch: {
        create: (params: { projectId: string; name: string; parentBranchId?: string }) => Promise<ResultIpcEnvelope<BranchRowRecord>>;
        list: (params: { projectId: string }) => Promise<ResultIpcEnvelope<BranchRowRecord[]>>;
        switch: (params: { branchId: string; projectId: string }) => Promise<ResultIpcEnvelope<BranchRowRecord>>;
        delete: (params: { id: string }) => Promise<ResultIpcEnvelope<undefined>>;
        rename: (params: { id: string; newName: string }) => Promise<ResultIpcEnvelope<BranchRowRecord>>;
        getActive: (params: { projectId: string }) => Promise<ResultIpcEnvelope<BranchRowRecord | null>>;
      };
      // BLOCK-166 — Gen UI 沙箱卡片（prepare 结果为判别联合：ok 携带沙箱页 URL，
      // 否则 code ∈ no-workspace/project-not-found/outside-scope/file-not-found/
      // too-large/read-failed/failed。真值源：src/ipc/gen-ui.js）。
      genUi: {
        prepare: (payload: { projectId: string; conversationId: string; path: string; title?: string }) => Promise<
          | { ok: true; url: string }
          | { ok: false; code: string; message: string }
        >;
        // BLOCK-166 P1 — guest 桥 RPC 中继：widgetState 内存落主进程（≤16KiB，
        // 宿主 ack 后 guest promise 才 resolve）+ 绝对 http(s) 外链白名单。
        setState: (payload: { sessionId: string; state: unknown }) => Promise<
          | { ok: true }
          | { ok: false; code: string; message: string }
        >;
        openExternal: (payload: { sessionId: string; href: string }) => Promise<
          | { ok: true }
          | { ok: false; code: string; message: string }
        >;
        // BLOCK-166 P2 — 复制图片：sender/会话/几何三重校验后 capturePage→剪贴板。
        copyImage: (payload: { sessionId: string; rect: { x: number; y: number; width: number; height: number } }) => Promise<
          | { ok: true }
          | { ok: false; code: string; message: string }
        >;
        // BLOCK-174 CP-13b — fragment 导出（读会话原文；渲染层经 files.saveTextFile 另存）。
        exportFragment: (payload: { sessionId: string }) => Promise<
          | { ok: true; content: string; title: string; name: string }
          | { ok: false; code: string; message: string }
        >;
        // BLOCK-174 CP-11 — artifact/job 数据面只读绑定（guest getData 中继落点）。
        getData: (payload: { sessionId: string; jobId: string }) => Promise<
          | { ok: true; data: Record<string, unknown> }
          | { ok: false; code: string; message: string }
        >;
        // BLOCK-166-NAV-GUARD — 沙箱帧劫持侦测推送（main→renderer）：返回取消订阅函数。
        onSandboxHijacked?: (callback: (payload: { frameUrl?: string; targetUrl?: string; at?: string }) => void) => void | (() => void);
      };
    };
    /** BLOCK-61 兼容别名：与 petri 同一 surface（preload 双暴露）。 */
    petriDesktop?: Window['petri'];
    process?: {
      env: {
        PETRI_DESKTOP?: string;
        NODE_ENV?: string;
      };
    };
    /** BLOCK-165：mini 旗标桥独立键（原与全量 surface 同名 petri 撞名，解耦）。 */
    petriAgentFlags?: {
      agentWorkbenchFlags: {
        getExtraRenderers: () => boolean;
        set: (value: boolean) => Promise<{ ok: boolean; extraRenderers: boolean; error?: string }>;
        onChange: (callback: (value: boolean) => void) => () => void;
      };
    };
  }
}

export {};
