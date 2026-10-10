import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useAiSettings,
  DEFAULT_CHAT_MODEL_PRESETS,
  preferredModelPreset,
  __resetAiSettingsCacheForTests,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';

function installBridge(opts: {
  initial?: Record<string, unknown>;
  save?: (patch: Record<string, unknown>) => Promise<void>;
  listModels?: (profile: Record<string, unknown>, apiKey: string) => Promise<{ ok: boolean; models: string[]; message: string }>;
} = {}) {
  const get = vi.fn().mockResolvedValue(opts.initial || null);
  const save = opts.save || vi.fn().mockResolvedValue(undefined);
  const listModels = opts.listModels;
  (window as unknown as { petriDesktop: unknown }).petriDesktop = {
    aiSettings: { get, save, ...(listModels ? { listModels } : {}) },
  };
  return { get, save, listModels };
}

function uninstallBridge() {
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
}

beforeEach(() => {
  __resetAiSettingsCacheForTests();
  uninstallBridge();
});

describe('useAiSettings', () => {
  it('restores a supplier last-selected model before its configured default', () => {
    const presets: ChatModelPreset[] = [
      { id: 'flash', label: 'DeepSeek', provider: 'openai-compatible', model: 'deepseek-v4-flash' },
      { id: 'pro', label: 'DeepSeek', provider: 'openai-compatible', model: 'deepseek-v4-pro' },
    ];

    expect(preferredModelPreset(presets, undefined, 'deepseek-v4-flash', 'deepseek-v4-pro')?.id)
      .toBe('flash');
    expect(preferredModelPreset(presets, 'pro', 'deepseek-v4-flash', 'deepseek-v4-pro')?.id)
      .toBe('pro');
  });

  it('exposes default presets when no bridge is installed', async () => {
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.presets).toEqual(DEFAULT_CHAT_MODEL_PRESETS);
    expect(result.current.activeId).toBe(DEFAULT_CHAT_MODEL_PRESETS[0].id);
  });

  it('loads presets and active id from the bridge on first mount', async () => {
    installBridge({
      initial: {
        chat_model_presets: [
          { id: 'gpt-4', label: 'GPT-4', provider: 'openai', model: 'gpt-4' },
          { id: 'gpt-3.5', label: 'GPT-3.5', provider: 'openai', model: 'gpt-3.5-turbo' },
        ],
        active_chat_model_id: 'gpt-3.5',
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.presets.map((p) => p.id)).toEqual(['gpt-4', 'gpt-3.5']);
    expect(result.current.activeId).toBe('gpt-3.5');
    expect(result.current.activePreset.id).toBe('gpt-3.5');
  });

  it('uses chat-capable ModelProfiles and the chat role binding as primary truth', async () => {
    installBridge({
      initial: {
        model_profiles: [
          { id: 'chat-a', label: 'Chat A', provider: 'openai-compatible', model: 'custom-chat', baseUrl: 'https://example.com/v1', capabilities: ['chat'] },
          { id: 'embed-a', label: 'Embed A', provider: 'openai-compatible', model: 'custom-embed', baseUrl: 'https://example.com/v1', capabilities: ['embedding'] },
        ],
        model_role_bindings: { chat: 'chat-a', embedding: 'embed-a' },
        chat_model_presets: [{ id: 'legacy', label: 'Legacy', provider: 'deepseek', model: 'deepseek-chat' }],
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.presets.map((profile) => profile.id)).toEqual(['chat-a']);
    expect(result.current.activeId).toBe('chat-a');
  });

  it('normalizes a legacy DeepSeek chat preset when ModelProfiles are absent', async () => {
    installBridge({
      initial: {
        chat_model_presets: [{
          id: 'legacy-deepseek',
          label: 'DeepSeek Chat',
          provider: 'deepseek',
          model: 'deepseek-chat',
          credentialRef: 'provider:deepseek',
        }],
        active_chat_model_id: 'legacy-deepseek',
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activePreset).toMatchObject({
      id: 'legacy-deepseek',
      label: 'DeepSeek',
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      credentialRef: 'provider:deepseek',
    });
  });

  it('loads and expands a native Anthropic ModelProfile for chat selection', async () => {
    const listModels = vi.fn().mockResolvedValue({
      ok: true,
      models: ['claude-sonnet-test', 'claude-opus-test'],
      message: '已获取 2 个模型',
    });
    installBridge({
      initial: {
        model_profiles: [{
          id: 'anthropic-main',
          label: 'Anthropic',
          provider: 'anthropic',
          protocol: 'anthropic-messages',
          model: 'claude-sonnet-test',
          baseUrl: 'https://api.anthropic.com/v1',
          capabilities: ['chat', 'streaming', 'tools'],
        }],
        model_role_bindings: { chat: 'anthropic-main' },
      },
      listModels,
    });

    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', protocol: 'anthropic-messages' }),
      ''
    );
    expect(result.current.presets.map((preset) => preset.model)).toEqual([
      'claude-sonnet-test',
      'claude-opus-test',
    ]);
    expect(result.current.presets.every((preset) => preset.provider === 'anthropic')).toBe(true);
    expect(result.current.activePreset.model).toBe('claude-sonnet-test');
  });

  it('expands one supplier endpoint into all discovered chat models and persists a switch', async () => {
    const listModels = vi.fn().mockResolvedValue({
      ok: true,
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      message: '已获取 2 个模型',
    });
    const { save } = installBridge({
      initial: {
        model_profiles: [
          {
            id: 'deepseek-chat',
            label: 'DeepSeek Chat',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            credentialRef: 'provider:deepseek',
            capabilities: ['chat', 'streaming', 'tools'],
          },
        ],
        model_role_bindings: { chat: 'deepseek-chat' },
        active_chat_model_id: 'deepseek-chat',
        chat_model_presets: [
          { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', model: 'deepseek-v4-flash' },
        ],
      },
      listModels,
    });

    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.presets.map((preset) => preset.model)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
    expect(result.current.presets.every((preset) => preset.label === 'DeepSeek')).toBe(true);
    expect(result.current.presets.every((preset) => preset.endpointProfileId === 'deepseek-chat')).toBe(true);
    expect(result.current.presets.every((preset) => preset.provider === 'openai-compatible')).toBe(true);
    expect(result.current.presets.every((preset) => preset.baseUrl === 'https://api.deepseek.com')).toBe(true);
    expect(result.current.presets.every((preset) => preset.credentialRef === 'provider:deepseek')).toBe(true);
    expect(result.current.presets.every((preset) => preset.lastSelectedModel === 'deepseek-v4-flash')).toBe(true);
    expect(result.current.activePreset.model).toBe('deepseek-v4-flash');

    const pro = result.current.presets.find((preset) => preset.model === 'deepseek-v4-pro');
    await act(async () => {
      await result.current.setActive(pro!.id);
    });
    expect(result.current.activePreset.model).toBe('deepseek-v4-pro');
    expect(result.current.presets.every((preset) => preset.lastSelectedModel === 'deepseek-v4-pro')).toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      active_chat_model_id: 'deepseek-chat',
      model_role_bindings: expect.objectContaining({ chat: 'deepseek-chat' }),
      model_profiles: [
        expect.objectContaining({ id: 'deepseek-chat', model: 'deepseek-v4-pro' }),
      ],
    }));
  });

  it('falls back to defaults when bridge returns invalid data', async () => {
    installBridge({ initial: { chat_model_presets: 'not-an-array' } });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.presets).toEqual(DEFAULT_CHAT_MODEL_PRESETS);
    expect(result.current.activeId).toBe(DEFAULT_CHAT_MODEL_PRESETS[0].id);
  });

  it('does not refetch on a second mount', async () => {
    const { get } = installBridge({ initial: { chat_model_presets: [] } });
    const first = renderHook(() => useAiSettings());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const second = renderHook(() => useAiSettings());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('setActive persists via the bridge and updates the cache', async () => {
    const { save } = installBridge({
      initial: {
        chat_model_presets: [
          { id: 'a', label: 'A', provider: 'p', model: 'm' },
          { id: 'b', label: 'B', provider: 'p', model: 'm' },
        ],
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setActive('b');
    });
    expect(result.current.activeId).toBe('b');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        active_chat_model_id: 'b',
        llm_provider: 'p',
        model_role_bindings: expect.objectContaining({ chat: 'b' }),
      })
    );
  });

  it('setActiveLocal updates the cache without touching the bridge', async () => {
    const { save } = installBridge({
      initial: {
        chat_model_presets: [
          { id: 'a', label: 'A', provider: 'p', model: 'm' },
          { id: 'b', label: 'B', provider: 'p', model: 'm' },
        ],
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setActiveLocal('b'));
    expect(result.current.activeId).toBe('b');
    expect(save).not.toHaveBeenCalled();
  });

  it('addPreset auto-promotes the new preset to active', async () => {
    installBridge({
      initial: { chat_model_presets: [{ id: 'a', label: 'A', provider: 'p', model: 'm' }] },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let id = '';
    act(() => {
      id = result.current.addPreset({ label: 'New' });
    });
    expect(id).toMatch(/^model-/);
    expect(result.current.presets).toHaveLength(2);
    expect(result.current.activeId).toBe(id);
  });

  it('removePreset auto-promotes the first remaining preset when active is removed', async () => {
    installBridge({
      initial: {
        chat_model_presets: [
          { id: 'a', label: 'A', provider: 'p', model: 'm' },
          { id: 'b', label: 'B', provider: 'p', model: 'm' },
        ],
        active_chat_model_id: 'b',
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.removePreset('b'));
    expect(result.current.presets.map((p) => p.id)).toEqual(['a']);
    expect(result.current.activeId).toBe('a');
  });

  it('updatePreset patches by id without changing the position', async () => {
    installBridge({
      initial: {
        chat_model_presets: [
          { id: 'a', label: 'A', provider: 'p', model: 'm' },
          { id: 'b', label: 'B', provider: 'p', model: 'm' },
        ],
      },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updatePreset('a', { label: 'A2' }));
    const a = result.current.presets.find((p) => p.id === 'a') as ChatModelPreset;
    expect(a.label).toBe('A2');
    expect(a.model).toBe('m');
  });

  it('two subscribers see the same activeId after one calls setActive', async () => {
    installBridge({
      initial: {
        chat_model_presets: [
          { id: 'a', label: 'A', provider: 'p', model: 'm' },
          { id: 'b', label: 'B', provider: 'p', model: 'm' },
        ],
      },
    });
    const chat = renderHook(() => useAiSettings());
    const panel = renderHook(() => useAiSettings());
    await waitFor(() => expect(chat.result.current.loading).toBe(false));
    await waitFor(() => expect(panel.result.current.loading).toBe(false));

    await act(async () => {
      await chat.result.current.setActive('b');
    });
    // The settings panel should re-render with the same activeId.
    expect(panel.result.current.activeId).toBe('b');
  });

  it('refresh re-fetches after a sibling write', async () => {
    const { get } = installBridge({
      initial: { chat_model_presets: [{ id: 'a', label: 'A', provider: 'p', model: 'm' }] },
    });
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get).toHaveBeenCalledTimes(1);

    // Simulate a sibling write that changed presets on disk.
    get.mockResolvedValueOnce({
      chat_model_presets: [
        { id: 'a', label: 'A', provider: 'p', model: 'm' },
        { id: 'x', label: 'X', provider: 'p', model: 'm' },
      ],
      active_chat_model_id: 'x',
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.presets).toHaveLength(2);
    expect(result.current.activeId).toBe('x');
  });
});
