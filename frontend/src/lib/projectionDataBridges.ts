/**
 * BLOCK-87 L4 — 投影环境数据桥（Skills / 插件商店 / 运行时 / 领域包 / AI 设置）。
 *
 * 桌面投影浏览器没有 Electron IPC：Skills（skills:discover）、插件目录
 * （plugins.listInstalled/listRemote）、运行时状态（runtime.status）、领域包
 * （packs.listInstalled/listAvailable）、AI 设置读面（aiSettings.get/save）
 * 在本模块以同形状 HTTP 实现替代，数据来自 gateway 会话门内的 core REST
 * （/api/skills/registry、/api/plugins/*、/api/runtime/status、/api/packs/*、
 * /api/ai/settings）。写操作（执行/安装/卸载/凭据读取/连通性测试）投影下
 * 诚实禁用——数据消费面与桌面同源，操作面归桌面。
 *
 * L4-2 形状勘误：桥必须逐字对齐桌面 IPC 契约——`plugins.listInstalled` 返回
 * 裸数组（electron.d.ts），第一批误包 `{ok,packs}` 信封导致 usePluginStore
 * 消费错位；packs IPC 实际返回 `{ok,packs}` 信封（src/ipc/pack.js），桥保持
 * 同形状，消费方 unpackPacks 双形态兼容。
 */
import { getToken } from '@/lib/authClient';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson(path: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(path, { headers: authHeaders() });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

const skillsBridge = {
  async discover() {
    try {
      const { data } = await getJson('/api/skills/registry');
      if (data.ok && Array.isArray(data.skills)) {
        return { ok: true as const, skills: data.skills };
      }
      return { ok: false as const, error: (data.message as string) || 'skills discover failed' };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'network' };
    }
  },
  execute() {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持执行技能，请在桌面端操作' });
  },
  getExecution() {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持执行状态查询' });
  },
  cancel: () => {},
  onProgress: () => () => {},
};

const pluginsBridge = {
  // 桌面 IPC `plugin:list-installed` 契约 = 裸数组（electron.d.ts）。
  async listInstalled() {
    try {
      const { data } = await getJson('/api/plugins/installed');
      if (data.ok && Array.isArray(data.plugins)) {
        return data.plugins as Array<Record<string, unknown>>;
      }
      return [];
    } catch {
      return [];
    }
  },
  // 桌面 IPC `plugin:list-remote` 契约 = `{ plugins: Record<string, …> }`。
  async listRemote() {
    try {
      const { data } = await getJson('/api/plugins/catalog');
      const plugins = (data.manifest as { plugins?: Record<string, unknown> } | undefined)?.plugins;
      if (data.ok && plugins && typeof plugins === 'object') {
        return { plugins };
      }
      return { plugins: {} };
    } catch {
      return { plugins: {} };
    }
  },
  install(_pluginId: string, _onProgress?: unknown) {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持安装插件，请在桌面端操作' });
  },
  uninstall(_pluginId: string) {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持卸载插件，请在桌面端操作' });
  },
};

// 领域包（BLOCK-84）：读面真数据，写面诚实禁用（安装需桌面目录选择 + 重启生效）。
const packsBridge = {
  async listInstalled() {
    try {
      const { data } = await getJson('/api/packs/installed');
      if (data.ok && Array.isArray(data.packs)) {
        return { ok: true, packs: data.packs };
      }
      return { ok: false, packs: [] };
    } catch {
      return { ok: false, packs: [] };
    }
  },
  async listAvailable() {
    try {
      const { data } = await getJson('/api/packs/available');
      if (data.ok && Array.isArray(data.packs)) {
        return { ok: true, packs: data.packs };
      }
      return { ok: false, packs: [] };
    } catch {
      return { ok: false, packs: [] };
    }
  },
  installFromDialog() {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持安装领域包，请在桌面端操作' });
  },
  installPath(_packRoot: string) {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持安装领域包，请在桌面端操作' });
  },
  uninstall(_packId: string) {
    return Promise.resolve({ ok: false as const, error: '投影环境暂不支持卸载领域包，请在桌面端操作' });
  },
};

// 运行时状态（runtime:status IPC 契约 = { r, python } 各 { installed, path }）。
const runtimeBridge = {
  async status() {
    try {
      const { data } = await getJson('/api/runtime/status');
      const runtime = data.runtime as
        | { r: { installed: boolean; path: string | null }; python: { installed: boolean; path: string | null } }
        | undefined;
      if (data.ok && runtime?.r && runtime?.python) {
        return runtime;
      }
      return { r: { installed: false, path: null }, python: { installed: false, path: null } };
    } catch {
      return { r: { installed: false, path: null }, python: { installed: false, path: null } };
    }
  },
};

// AI 设置（BLOCK-87 L4-2 收尾）：读面走 GET /api/ai/settings（HTTP 信封
// { status, settings } 须解包成 IPC ai-settings:get 的裸 settings 对象），
// 保存走 POST /api/ai/settings（路由内部与现值合并，同 IPC saveAiSettings
// 语义）。凭据读取/连通性测试/模型列表拉取投影下诚实禁用——凭据明文绝不
// 过投影 HTTP，模型发现与 key 测试是设置面板的桌面 CRUD 面。
const aiSettingsBridge = {
  // 桌面 IPC `ai-settings:get` 契约 = 裸 settings 对象（失败返回 {}）。
  async get() {
    try {
      const { data } = await getJson('/api/ai/settings');
      const settings = data.settings as Record<string, unknown> | undefined;
      if (data.status === 'ok' && settings && typeof settings === 'object') {
        return settings;
      }
      return {};
    } catch {
      return {};
    }
  },
  // 桌面 IPC `ai-settings:save` 契约 = { ok: true } / { ok: false, error }。
  async save(settings: Record<string, unknown>) {
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(settings ?? {}),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok && data.status === 'ok') {
        return { ok: true as const };
      }
      return { ok: false as const, error: (data as { message?: string }).message || 'save failed' };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'network' };
    }
  },
  // 桌面 IPC `ai-settings:list-models` 失败形状 = { ok:false, models:[], message }。
  listModels(_providerOrProfile: unknown, _apiKey?: string) {
    return Promise.resolve({ ok: false as const, models: [] as Array<Record<string, unknown>>, message: '投影环境暂不支持拉取模型列表，请在桌面端操作' });
  },
  // 桌面 IPC `ai-settings:get-credential` 失败形状 = { ok:false, apiKey:'', error }。
  // 凭据明文不过投影 HTTP：投影下恒走失败分支，消费方已有优雅降级。
  getCredential(_credentialId: string) {
    return Promise.resolve({ ok: false as const, apiKey: '', error: '投影环境暂不支持读取凭据，请在桌面端操作' });
  },
  test(_providerOrProfile: unknown, _apiKey?: string) {
    return Promise.resolve({ ok: false as const, message: '投影环境暂不支持连通性测试，请在桌面端操作' });
  },
};

export function getProjectionSkillsBridge() {
  return skillsBridge;
}

export function getProjectionPluginsBridge() {
  return pluginsBridge;
}

export function getProjectionPacksBridge() {
  return packsBridge;
}

export function getProjectionRuntimeBridge() {
  return runtimeBridge;
}

export function getProjectionAiSettingsBridge() {
  return aiSettingsBridge;
}

export type ProjectionDataBridgeName = 'skills' | 'plugins' | 'packs' | 'runtime' | 'aiSettings';

export function getProjectionDataBridge(name: ProjectionDataBridgeName): unknown {
  if (!isProjectionEnv()) return null;
  if (name === 'skills') return skillsBridge;
  if (name === 'plugins') return pluginsBridge;
  if (name === 'packs') return packsBridge;
  if (name === 'aiSettings') return aiSettingsBridge;
  return runtimeBridge;
}

export function isProjectionEnv(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-projection') === '1';
}
