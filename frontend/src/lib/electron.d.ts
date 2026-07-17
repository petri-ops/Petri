// BioF3 桌面版原生 shell — Electron preload 桥
// 桌面版前端通过 window.biof3Desktop 访问 Electron IPC
// （从 desktop-app/src/preload.js 暴露的 API）

// M1-1：后端就绪感知层返回结构
export interface BackendStatus {
  rRuntime: boolean;
  pyRuntime: boolean;
  rServerUp: boolean;
  pyServerUp: boolean;
  plumberUp: boolean;
  isReady: boolean;
  downReason: string | null;
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
      };
      aiSettings: {
        get: () => Promise<Record<string, unknown>>;
        save: (settings: Record<string, unknown>) => Promise<void>;
        test: (providerOrProfile: string | Record<string, unknown>, apiKey: string) => Promise<{ ok: boolean; message: string }>;
      };
      computeSettings: {
        get: () => Promise<ComputeSettings>;
        save: (settings: ComputeSettings) => Promise<{ ok: boolean; error?: string; restartRequired?: boolean }>;
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
    };
    process?: {
      env: {
        BIOF3_DESKTOP?: string;
        NODE_ENV?: string;
      };
    };
  }
}

export {};
