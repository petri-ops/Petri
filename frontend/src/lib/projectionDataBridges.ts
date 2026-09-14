/**
 * BLOCK-87 L4 — 投影环境数据桥（Skills / 已装插件）。
 *
 * 桌面投影浏览器没有 Electron IPC：Skills（skills:discover）与插件包
 * （plugins.packs.listInstalled/Available）在本模块以同形状 HTTP 实现替代，
 * 数据来自 gateway 会话门内的 core REST（/api/skills/registry、
 * /api/plugins/installed）。写操作（执行/安装/卸载）投影下诚实禁用。
 */
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getJson(path: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(path, { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data as Record<string, unknown> };
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
  async execute() {
    return { ok: false as const, error: '投影环境暂不支持执行技能，请在桌面端操作' };
  },
  async getExecution() {
    return { ok: false as const, error: '投影环境暂不支持执行状态查询' };
  },
  cancel: () => {},
  onProgress: () => () => {},
};

const pluginsBridge = {
  packs: {
    async listInstalled() {
      try {
        const { data } = await getJson('/api/plugins/installed');
        if (data.ok && Array.isArray(data.plugins)) {
          return { ok: true, packs: data.plugins };
        }
        return { ok: false, packs: [], error: (data.message as string) || 'list failed' };
      } catch (error) {
        return { ok: false, packs: [], error: error instanceof Error ? error.message : 'network' };
      }
    },
    async listAvailable() {
      // 可安装远程清单投影下暂不开放（安装走桌面端）
      return { ok: true, packs: [] };
    },
  },
  listInstalled: () => pluginsBridge.packs.listInstalled(),
  listAvailable: () => pluginsBridge.packs.listAvailable(),
};

export function getProjectionSkillsBridge() {
  return skillsBridge;
}

export function getProjectionPluginsBridge() {
  return pluginsBridge;
}

export function getProjectionDataBridge(name: 'skills' | 'plugins'): unknown | null {
  if (!isProjectionEnv()) return null;
  return name === 'skills' ? skillsBridge : pluginsBridge;
}

export function isProjectionEnv(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-projection') === '1';
}
