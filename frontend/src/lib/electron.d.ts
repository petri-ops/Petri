// BioF3 桌面版原生 shell — Electron preload 桥
// 桌面版前端通过 window.biof3Desktop 访问 Electron IPC
// （从 desktop-app/src/preload.js 暴露的 API）

// M1-1：后端就绪感知层返回结构
export interface BackendStatus {
  /** `true` 已安装 / `false` 确认缺失 / `null` 状态未知（backend:status 查询
   *  失败时的兜底）。消费端判断"缺失"必须用 `=== false`，用 `!rRuntime` 会把
   *  "未知"误判成"缺失"，导致偶发 IPC 异常时错弹首次配置引导页。 */
  rRuntime: boolean | null;
  pyRuntime: boolean | null;
  rServerUp: boolean;
  pyServerUp: boolean;
  plumberUp: boolean;
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

export interface ComputeSettings {
  computeMode: 'local' | 'remote';
  remoteComputeUrl: string;
  remoteComputeToken: string;
  remoteComputeName: string;
}

/** Stage 3 M1: one entry from the Harness provisioning ledger. */
export interface HarnessCapabilityEntry {
  capabilityId: string;
  kind: 'bundle' | 'runtime' | string;
  version: string;
  sha256: string | null;
  url: string;
  size: number | null;
  installDir: string;
  installedAt: number;
  attempts: number;
}

declare global {
  interface Window {
    biof3Desktop?: {
      isDesktop: true;
      platform: string;
      arch: string;
      backendConfig: {
        rApiBase: string;
        pythonApiBase: string;
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
      };
      /** 应用级控制 —— 装完运行时后需整体重启（BIOF3_R_HOME 在 main 启动时固化）。 */
      app: {
        relaunch: () => Promise<{ ok: boolean; error?: string }>;
      };
      aiSettings: {
        get: () => Promise<Record<string, unknown>>;
        save: (settings: Record<string, unknown>) => Promise<void>;
        getCredential: (credentialId: string) => Promise<{ ok: boolean; apiKey: string; error?: string }>;
        test: (providerOrProfile: string | Record<string, unknown>, apiKey: string) => Promise<{ ok: boolean; message: string }>;
        listModels: (providerOrProfile: string | Record<string, unknown>, apiKey: string) => Promise<{ ok: boolean; models: string[]; message: string }>;
      };
      computeSettings: {
        get: () => Promise<ComputeSettings>;
        save: (settings: ComputeSettings) => Promise<{ ok: boolean; error?: string; restartRequired?: boolean }>;
      };
      /** Stage 3 M1: read-only view of Harness-provisioned capabilities (runtimes/bundles). */
      harnessCapabilities: {
        list: () => Promise<{ ok: boolean; capabilities: HarnessCapabilityEntry[]; error?: string }>;
      };
      plugins: {
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
        install: (
          pluginId: string,
          onProgress?: (data: {
            pluginId: string;
            ratio: number;
            received: number;
            total: number;
          }) => void
        ) => Promise<{ ok: boolean; error?: string }>;
        uninstall: (pluginId: string) => Promise<{ ok: boolean; error?: string }>;
        checkUpdates: () => Promise<
          Array<{ id: string; currentVersion: string; latestVersion: string }>
        >;
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
            source: 'built-in' | 'installed' | 'marketplace';
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
      // M2-7：py-server / plumber 按需启停（lazy，idle 5min 自动停）
      py: {
        start: () => Promise<{
          ok: boolean;
          alreadyRunning?: boolean;
          pid?: number;
          error?: string;
        }>;
        stop: () => Promise<{ ok: boolean; wasRunning?: boolean }>;
      };
      plumber: {
        start: () => Promise<{
          ok: boolean;
          alreadyRunning?: boolean;
          pid?: number;
          error?: string;
        }>;
        stop: () => Promise<{ ok: boolean; wasRunning?: boolean }>;
      };
      files: {
        saveDialog: (defaultName?: string) => Promise<string | null>;
        openDialog: (filters?: unknown) => Promise<string | null>;
        openDirectoryDialog: () => Promise<string | null>;
        openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
        openWorkspaceFile: (
          workspacePath: string,
          relativePath: string
        ) => Promise<{ ok: boolean; error?: string }>;
      };
      diagnostic: {
        export: (targetPath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
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
        startSession: (targetPath?: string) => Promise<{
          ok: boolean;
          pid?: number;
          cwd?: string;
          shell?: string;
          reused?: boolean;
          error?: string;
        }>;
        writeSession: (input: string) => Promise<{ ok: boolean; error?: string }>;
        resizeSession: (cols: number, rows: number) => Promise<{ ok: boolean; error?: string }>;
        stopSession: () => Promise<{ ok: boolean; wasRunning?: boolean }>;
        onData: (callback: (data: string) => void) => () => void;
        onExit: (
          callback: (data: { code?: number | null; signal?: string | null }) => void
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
      // Phase 1: Branch Tab UI - conversation branch management
      branch: {
        create: (params: { projectId: string; name: string; parentBranchId?: string }) => Promise<{
          id: string;
          projectId: string;
          name: string;
          parentBranchId: string | null;
          createdAt: number;
          updatedAt: number;
          isActive: boolean;
        }>;
        list: (params: { projectId: string }) => Promise<Array<{
          id: string;
          projectId: string;
          name: string;
          parentBranchId: string | null;
          createdAt: number;
          updatedAt: number;
          isActive: boolean;
        }>>;
        switch: (params: { branchId: string }) => Promise<void>;
        delete: (params: { branchId: string }) => Promise<void>;
        rename: (params: { branchId: string; newName: string }) => Promise<void>;
        getActive: (params: { projectId: string }) => Promise<{
          id: string;
          projectId: string;
          name: string;
          parentBranchId: string | null;
          createdAt: number;
          updatedAt: number;
          isActive: boolean;
        } | null>;
      };
      // Phase 2: Result Studio - shared results across branches
      // Phase 4: Added conversation_export type and createFromConversation
      result: {
        create: (params: {
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId?: string;
        }) => Promise<{
          id: string;
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId: string | null;
          createdAt: number;
          updatedAt: number;
        }>;
        get: (params: { id: string }) => Promise<{
          id: string;
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId: string | null;
          createdAt: number;
          updatedAt: number;
        } | null>;
        list: (params: {
          projectId: string;
          options?: {
            type?: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
            limit?: number;
            offset?: number;
            sortBy?: 'updatedAt' | 'createdAt' | 'name';
            sortDir?: 'asc' | 'desc';
          };
        }) => Promise<Array<{
          id: string;
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          sourceBranchId: string | null;
          updatedAt: number;
        }>>;
        update: (params: {
          id: string;
          updates: {
            name?: string;
            data?: unknown;
            config?: Record<string, unknown>;
          };
        }) => Promise<{
          id: string;
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId: string | null;
          createdAt: number;
          updatedAt: number;
        } | null>;
        delete: (params: { id: string }) => Promise<void>;
        byProject: (params: {
          projectId: string;
          options?: {
            type?: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
            limit?: number;
            offset?: number;
          };
        }) => Promise<Array<{
          id: string;
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId: string | null;
          createdAt: number;
          updatedAt: number;
        }>>;
        // Phase 4: Export conversation to result
        createFromConversation: (params: {
          projectId: string;
          branchId: string;
          options?: {
            name?: string;
            includeMessages?: boolean;
            generateSummary?: boolean;
          };
        }) => Promise<{
          id: string;
          projectId: string;
          type: 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';
          name: string;
          data: unknown;
          config?: Record<string, unknown>;
          sourceBranchId: string | null;
          createdAt: number;
          updatedAt: number;
        }>;
        version: {
          create: (params: {
            resultId: string;
            data: unknown;
            config?: Record<string, unknown>;
            createdByBranchId?: string;
          }) => Promise<{
            id: string;
            resultId: string;
            version: number;
            data: unknown;
            config?: Record<string, unknown>;
            createdAt: number;
            createdByBranchId: string | null;
          }>;
          get: (params: { id: string }) => Promise<{
            id: string;
            resultId: string;
            version: number;
            data: unknown;
            config?: Record<string, unknown>;
            createdAt: number;
            createdByBranchId: string | null;
          } | null>;
          // Phase 4: Get version by resultId and version number
          getByNumber: (params: { resultId: string; version: number }) => Promise<{
            id: string;
            resultId: string;
            version: number;
            data: unknown;
            config?: Record<string, unknown>;
            createdAt: number;
            createdByBranchId: string | null;
          } | null>;
          list: (params: {
            resultId: string;
            limit?: number;
            offset?: number;
          }) => Promise<Array<{
            id: string;
            resultId: string;
            version: number;
            data: unknown;
            config?: Record<string, unknown>;
            createdAt: number;
            createdByBranchId: string | null;
          }>>;
        };
      };
    };
    process?: {
      env: {
        BIOF3_DESKTOP?: string;
        NODE_ENV?: string;
      };
    };
    biof3?: {
      agentWorkbenchFlags: {
        getExtraRenderers: () => boolean;
        set: (value: boolean) => Promise<{ ok: boolean; extraRenderers: boolean; error?: string }>;
        onChange: (callback: (value: boolean) => void) => () => void;
      };
    };
  }
}

export {};
