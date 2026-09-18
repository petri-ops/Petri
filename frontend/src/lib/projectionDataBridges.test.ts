/**
 * BLOCK-87 L4-2 — 投影数据桥契约测试。
 *
 * 桥必须逐字对齐桌面 IPC 形状（第一批 `plugins.listInstalled` 误包信封、
 * 缺 `listRemote`，手机插件商店整段空白——用户实测抓真）。本测试锚定：
 * - plugins.listInstalled → 裸数组（plugin:list-installed 契约）
 * - plugins.listRemote → { plugins: Record<…> }（plugin:list-remote 契约）
 * - packs.listInstalled/listAvailable → { ok, packs } 信封（pack:list-* 实际返回）
 * - runtime.status → { r, python } 各 { installed, path }
 * - aiSettings.get → 裸 settings 对象（ai-settings:get 契约；HTTP 信封须解包）
 * - aiSettings.save → { ok: true }（ai-settings:save 契约）
 * - 写操作（install/uninstall）与凭据读取/连通性测试投影下诚实禁用
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProjectionAiSettingsBridge,
  getProjectionDataBridge,
  getProjectionPacksBridge,
  getProjectionPluginsBridge,
  getProjectionRuntimeBridge,
  isProjectionEnv,
} from './projectionDataBridges';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** 按路径后缀路由的 fetch mock（URL 带完整 origin，须 endsWith 匹配）。 */
function mockFetchByPath(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([path]) => url.endsWith(path));
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    return jsonResponse(hit[1]);
  }));
}

describe('projectionDataBridges', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-projection', '1');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-projection');
    vi.unstubAllGlobals();
  });

  it('isProjectionEnv tracks the data-projection attribute', () => {
    expect(isProjectionEnv()).toBe(true);
    document.documentElement.removeAttribute('data-projection');
    expect(isProjectionEnv()).toBe(false);
    expect(getProjectionDataBridge('plugins')).toBeNull();
  });

  it('plugins.listInstalled returns the bare array per plugin:list-installed contract', async () => {
    mockFetchByPath({
      '/api/plugins/installed': {
        ok: true,
        plugins: [
          { id: 'alpha', version: '1.0.0', label: 'Alpha' },
          { id: 'beta', version: '0.2.0', label: 'Beta' },
        ],
      },
    });
    const bridge = getProjectionPluginsBridge();
    const installed = await bridge.listInstalled();
    expect(Array.isArray(installed)).toBe(true);
    expect(installed).toHaveLength(2);
    expect(installed[0]).toMatchObject({ id: 'alpha' });
  });

  it('plugins.listInstalled degrades to empty array on failure payload', async () => {
    mockFetchByPath({
      '/api/plugins/installed': { ok: false, message: 'boom' },
    });
    const installed = await getProjectionPluginsBridge().listInstalled();
    expect(installed).toEqual([]);
  });

  it('plugins.listRemote returns the { plugins } manifest per plugin:list-remote contract', async () => {
    mockFetchByPath({
      '/api/plugins/catalog': {
        ok: true,
        manifest: {
          plugins: {
            'biof3-r-runtime': { title: 'R 运行时（基础环境）', type: 'runtime' },
            'biof3-py-runtime': { title: 'Python 运行时（基础环境）', type: 'runtime' },
          },
        },
      },
    });
    const remote = await getProjectionPluginsBridge().listRemote();
    expect(Object.keys(remote.plugins).sort()).toEqual(['biof3-py-runtime', 'biof3-r-runtime']);
  });

  it('plugins install/uninstall are honestly disabled in projection', async () => {
    const bridge = getProjectionPluginsBridge();
    const install = await bridge.install('alpha');
    const uninstall = await bridge.uninstall('alpha');
    expect(install.ok).toBe(false);
    expect(install.error).toContain('桌面端');
    expect(uninstall.ok).toBe(false);
  });

  it('packs bridges return the { ok, packs } envelope per pack:list-* contract', async () => {
    mockFetchByPath({
      '/api/packs/installed': {
        ok: true,
        packs: [{ packId: 'gewu-pack-bio', packRoot: '/x', version: '0.1.0', installedAt: '2026-09-14T00:00:00Z' }],
      },
      '/api/packs/available': {
        ok: true,
        packs: [
          { packId: 'gewu-pack-bio', name: '格物 · 生信分析包', version: '0.1.0', description: '', packRoot: '/x', installed: true },
        ],
      },
    });
    const bridge = getProjectionPacksBridge();
    const installed = await bridge.listInstalled();
    const available = await bridge.listAvailable();
    expect(installed.ok).toBe(true);
    expect(installed.packs[0]).toMatchObject({ packId: 'gewu-pack-bio' });
    expect(available.ok).toBe(true);
    expect(available.packs[0]).toMatchObject({ installed: true });
  });

  it('packs write operations are honestly disabled in projection', async () => {
    const bridge = getProjectionPacksBridge();
    expect((await bridge.installFromDialog()).ok).toBe(false);
    expect((await bridge.installPath('/x')).ok).toBe(false);
    expect((await bridge.uninstall('gewu-pack-bio')).ok).toBe(false);
  });

  it('runtime.status maps the { r, python } contract and degrades to all-false', async () => {
    mockFetchByPath({
      '/api/runtime/status': {
        ok: true,
        runtime: { r: { installed: true, path: '/bin/R' }, python: { installed: false, path: null } },
      },
    });
    const status = await getProjectionRuntimeBridge().status();
    expect(status.r).toEqual({ installed: true, path: '/bin/R' });
    expect(status.python).toEqual({ installed: false, path: null });

    mockFetchByPath({
      '/api/runtime/status': { ok: false },
    });
    const degraded = await getProjectionRuntimeBridge().status();
    expect(degraded.r.installed).toBe(false);
    expect(degraded.python.installed).toBe(false);
  });

  it('aiSettings.get unwraps the { status, settings } envelope per ai-settings:get contract', async () => {
    mockFetchByPath({
      '/api/ai/settings': {
        status: 'ok',
        settings: {
          model_profiles: [{ id: 'deepseek', provider: 'deepseek', model: 'deepseek-chat' }],
          model_role_bindings: { chat: 'deepseek' },
          active_chat_model_id: 'deepseek',
        },
      },
    });
    const settings = await getProjectionAiSettingsBridge().get();
    expect(settings).toMatchObject({ active_chat_model_id: 'deepseek' });
    expect((settings.model_profiles as unknown[])).toHaveLength(1);
  });

  it('aiSettings.get degrades to {} on failure payload (ai-settings:get catch shape)', async () => {
    mockFetchByPath({ '/api/ai/settings': { status: 'error', message: 'boom' } });
    expect(await getProjectionAiSettingsBridge().get()).toEqual({});
  });

  it('aiSettings.save posts to /api/ai/settings and returns { ok: true } per ai-settings:save contract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input).endsWith('/api/ai/settings')).toBe(true);
      expect(init?.method).toBe('POST');
      return jsonResponse({ status: 'ok' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getProjectionAiSettingsBridge().save({ active_chat_model_id: 'x' });
    expect(result).toEqual({ ok: true });
  });

  it('aiSettings.save maps failure payloads to { ok: false, error }', async () => {
    mockFetchByPath({ '/api/ai/settings': { status: 'error', message: 'boom' } });
    const result = await getProjectionAiSettingsBridge().save({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('boom');
  });

  it('aiSettings credential read / connectivity test / model discovery are honestly disabled in projection', async () => {
    const bridge = getProjectionAiSettingsBridge();
    const credential = await bridge.getCredential('deepseek');
    expect(credential.ok).toBe(false);
    expect(credential.apiKey).toBe('');
    expect(credential.error).toContain('桌面端');
    expect((await bridge.test('deepseek', 'k')).ok).toBe(false);
    const models = await bridge.listModels({}, '');
    expect(models.ok).toBe(false);
    expect(models.models).toEqual([]);
  });

  it('getProjectionDataBridge hands out the matching bridge per name', () => {
    expect(getProjectionDataBridge('skills')).toBeTruthy();
    expect(getProjectionDataBridge('plugins')).toBeTruthy();
    expect(getProjectionDataBridge('packs')).toBeTruthy();
    expect(getProjectionDataBridge('runtime')).toBeTruthy();
    expect(getProjectionDataBridge('aiSettings')).toBeTruthy();
  });
});
