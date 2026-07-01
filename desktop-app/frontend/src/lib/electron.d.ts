// BioF3 桌面版原生 shell — Electron preload 桥
// 桌面版前端通过 window.biof3Desktop 访问 Electron IPC
// （从 desktop-app/src/preload.js 暴露的 API）

declare global {
  interface Window {
    biof3Desktop?: {
      isDesktop: true;
      platform: string;
      arch: string;
      aiSettings: {
        get: () => Promise<Record<string, unknown>>;
        save: (settings: Record<string, unknown>) => Promise<void>;
        test: (provider: string, apiKey: string) => Promise<{ ok: boolean; message: string }>;
      };
      plugins: {
        listInstalled: () => Promise<
          Array<{ id: string; version: string; type?: string; language?: string }>
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
      runtime: {
        status: () => Promise<{
          r: { installed: boolean; path: string | null };
          python: { installed: boolean; path: string | null };
        }>;
      };
      files: {
        saveDialog: (
          defaultName?: string
        ) => Promise<{ ok: boolean; path?: string; error?: string }>;
        openDialog: (
          filters?: unknown
        ) => Promise<{ ok: boolean; paths?: string[]; error?: string }>;
      };
      diagnostic: {
        export: (targetPath?: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
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
      updater: {
        check: () => Promise<{
          ok: boolean;
          hasUpdate?: boolean;
          info?: { version: string };
          version?: string;
          error?: string;
        }>;
        download: () => Promise<{ ok: boolean; error?: string }>;
        install: () => Promise<void>;
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
