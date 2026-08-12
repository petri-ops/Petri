// ============================================================
// useAiSettings — SWR-style hook for chat-model-presets + active_id.
//
// Replaces two duplicated useState caches that previously lived in
// SimpleChat (read-only) and DesktopSettingsPanel (full CRUD).
// State-decomposition §4.5 [HIGH]: both components used
// `useState<ChatModelPreset[]>` + `useState<activeId>` and
// independently called `window.biof3Desktop.aiSettings.get()`,
// which meant each one held its own view of "which model is the
// one I'd send a request with".
//
// Design:
//   - The hook exposes ChatModelPreset CRUD + activeId mutation.
//   - A module-level `presetsCache: { presets, activeId } | null`
//     + an `inflight: Promise<void> | null` is shared across
//     every consumer. The first mount fetches via electron bridge;
//     subsequent mounts read the cached snapshot and re-render
//     when the cache mutates (no extra fetches).
//   - Optimistic updates: every setter mutates the cache
//     immediately. `setActive` additionally calls
//     `aiSettings.save(active_chat_model_id, llm_provider)` so a
//     chat request fired right after the click uses the new model
//     on disk; `setPresets / updatePreset / addPreset / removePreset`
//     don't persist on their own — the settings panel's batch
//     `aiSettings.save(...)` handles durability.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import {
  isChatSelectableProfile,
  modelChoiceId,
  modelSupplierName,
  normalizeLegacyUserModelProfile,
} from '@/lib/model-provider-options';

// ChatModelPreset type — extracted here so SimpleChat and
// DesktopSettingsPanel no longer each carry their own copy.
// Plan 1.6 §4.5 [HIGH] — type dedup.
//
// Credentials are referenced by id and never enter renderer snapshots.
export interface ChatModelPreset {
  id: string;
  label: string;
  provider: string;
  model: string;
  /** Configured supplier default used when no prior selection exists. */
  defaultModel?: string;
  /** Persisted most-recent model for the backing Endpoint profile. */
  lastSelectedModel?: string;
  baseUrl?: string;
  credentialRef?: string;
  protocol?: string;
  capabilities?: string[];
  roles?: string[];
  parameters?: Record<string, unknown>;
  /** Persisted Endpoint profile backing a transient provider/model choice. */
  endpointProfileId?: string;
}

export const DEFAULT_CHAT_MODEL_PRESETS: ChatModelPreset[] = [
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', model: 'deepseek-chat' },
];

export function preferredModelPreset(
  presets: ChatModelPreset[],
  activeId: string | undefined,
  lastSelectedModel: string,
  defaultModel: string
): ChatModelPreset | undefined {
  return (activeId ? presets.find((preset) => preset.id === activeId) : undefined)
    || presets.find((preset) => preset.model === lastSelectedModel)
    || presets.find((preset) => preset.model === defaultModel)
    || presets[0];
}

interface AiSettingsSnapshot {
  presets: ChatModelPreset[];
  activeId: string;
}

let presetsCache: AiSettingsSnapshot = {
  presets: DEFAULT_CHAT_MODEL_PRESETS,
  activeId: DEFAULT_CHAT_MODEL_PRESETS[0].id,
};
let loaded = false;
let inflight: Promise<AiSettingsSnapshot> | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

function refreshFromBridge(): Promise<AiSettingsSnapshot> {
  const bridge = getBridge('aiSettings');
  if (!bridge) {
    return Promise.resolve(presetsCache);
  }
  if (inflight) return inflight;
  inflight = bridge
    .get()
    .then(async (raw) => {
      const profilePresets = Array.isArray(raw?.model_profiles)
        ? (raw.model_profiles as ChatModelPreset[])
            .map(normalizeLegacyUserModelProfile)
            .filter(isChatSelectableProfile)
        : [];
      const presetsRaw = profilePresets.length > 0
        ? profilePresets
        : Array.isArray(raw?.chat_model_presets)
        ? (raw.chat_model_presets as ChatModelPreset[])
            .filter((p) => p?.id && p?.model)
            .map(normalizeLegacyUserModelProfile)
        : [];
      let presets = presetsRaw.length > 0 ? presetsRaw : DEFAULT_CHAT_MODEL_PRESETS;
      const activeEndpointId = String(
        (raw?.model_role_bindings as Record<string, unknown> | undefined)?.chat ||
          raw?.active_chat_model_id || presets[0]?.id || DEFAULT_CHAT_MODEL_PRESETS[0].id
      );
      if (profilePresets.length > 0 && typeof bridge.listModels === 'function') {
        const discovered = await Promise.all(profilePresets.map(async (profile) => {
          try {
            const result = await bridge.listModels(
              profile as unknown as Record<string, unknown>,
              ''
            );
            const models = result.ok && Array.isArray(result.models) && result.models.length > 0
              ? result.models
              : [profile.model];
            return models.map((model) => ({
              ...profile,
              id: modelChoiceId(profile.id, model),
              endpointProfileId: profile.id,
              label: modelSupplierName(profile),
              model,
              defaultModel: profile.defaultModel || profile.model,
              lastSelectedModel: profile.model,
            }));
          } catch {
            return [{
              ...profile,
              id: modelChoiceId(profile.id, profile.model),
              endpointProfileId: profile.id,
              label: modelSupplierName(profile),
              defaultModel: profile.defaultModel || profile.model,
              lastSelectedModel: profile.model,
            }];
          }
        }));
        const choices = discovered.flat();
        if (choices.length > 0) presets = choices;
      }
      const activeEndpoint = profilePresets.find((profile) => profile.id === activeEndpointId);
      const activeChoice = presets.find((preset) =>
        (preset.endpointProfileId || preset.id) === activeEndpointId &&
        (!activeEndpoint || preset.model === activeEndpoint.model)
      ) || presets.find((preset) => (preset.endpointProfileId || preset.id) === activeEndpointId);
      const activeId = activeChoice?.id || activeEndpointId;
      presetsCache = {
        presets,
        activeId: presets.some((p) => p.id === activeId) ? activeId : presets[0].id,
      };
      loaded = true;
      inflight = null;
      notify();
      return presetsCache;
    })
    .catch(() => {
      inflight = null;
      return presetsCache;
    });
  return inflight;
}

function applyMutation(
  next: { presets?: ChatModelPreset[]; activeId?: string },
  defaultActive?: (presets: ChatModelPreset[]) => string
): AiSettingsSnapshot {
  const presets = next.presets ?? presetsCache.presets;
  const candidate =
    next.activeId !== undefined ? next.activeId : presetsCache.activeId;
  const activeId = presets.some((p) => p.id === candidate)
    ? candidate
    : defaultActive
    ? defaultActive(presets)
    : presets[0].id;
  presetsCache = { presets, activeId };
  loaded = true;
  notify();
  return presetsCache;
}

export interface UseAiSettingsResult {
  presets: ChatModelPreset[];
  activeId: string;
  activePreset: ChatModelPreset;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Update the active model. Persists via the electron bridge
   *  optimistically so a chat request fired immediately after
   *  click uses the new model. Returns the new activeId. */
  setActive: (id: string) => Promise<string>;
  /** Same as setActive but does NOT persist via the electron
   *  bridge. Useful for settings panels that batch-save after
   *  the user clicks a Save button — every radio click would
   *  otherwise trigger an IPC roundtrip, racing the batch save. */
  setActiveLocal: (id: string) => void;
  /** Bulk-update presets. Does NOT persist by itself — the
   *  caller's batch `aiSettings.save(...)` handles durability. */
  setPresets: (next: ChatModelPreset[]) => void;
  /** Patch a single preset by id. */
  updatePreset: (id: string, patch: Partial<ChatModelPreset>) => void;
  /** Append a new preset; returns its id. Auto-promotes the
   *  new preset to active. */
  addPreset: (init?: Partial<ChatModelPreset>) => string;
  /** Drop a preset by id; auto-promotes the first remaining
   *  preset to active if the removed preset was active. */
  removePreset: (id: string) => void;
}

export function useAiSettings(): UseAiSettingsResult {
  // Seed from cache so the first render shows the last-known
  // state synchronously (no flash of "deepseek-chat" before
  // the bridge answers).
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot>(() => presetsCache);
  const [loading, setLoading] = useState(!loaded);

  useEffect(() => {
    let cancelled = false;
    const onChange = () => {
      if (!cancelled) setSnapshot(presetsCache);
    };
    subscribers.add(onChange);
    if (!loaded) {
      setLoading(true);
      refreshFromBridge().then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
      subscribers.delete(onChange);
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    inflight = null;
    const next = await refreshFromBridge();
    setSnapshot(next);
    setLoading(false);
  }, []);

  const setActive = useCallback(async (id: string): Promise<string> => {
    const target = presetsCache.presets.find((p) => p.id === id);
    if (!target) return presetsCache.activeId;
    const endpointProfileId = target.endpointProfileId || target.id;
    // Keep each supplier's most-recent model in the expanded renderer snapshot,
    // so switching away and back restores the user's explicit choice.
    const nextPresets = presetsCache.presets.map((preset) =>
      (preset.endpointProfileId || preset.id) === endpointProfileId
        ? { ...preset, lastSelectedModel: target.model }
        : preset
    );
    applyMutation({ presets: nextPresets, activeId: target.id });
    // Persist so the next chat request after this click uses the new
    // model on disk. We don't fail the call when save fails — the
    // cache is the immediate source of truth and the next refresh()
    // will reconcile.
    const bridge = getBridge('aiSettings');
    try {
      const current = (await bridge?.get?.()) || {};
      const modelProfiles = Array.isArray(current.model_profiles)
        ? (current.model_profiles as ChatModelPreset[]).map((profile) =>
            profile.id === endpointProfileId ? { ...profile, model: target.model } : profile
          )
        : current.model_profiles;
      const chatModelPresets = Array.isArray(current.chat_model_presets)
        ? (current.chat_model_presets as ChatModelPreset[]).map((profile) =>
            profile.id === endpointProfileId ? { ...profile, model: target.model } : profile
          )
        : current.chat_model_presets;
      await bridge?.save?.({
        ...current,
        model_profiles: modelProfiles,
        chat_model_presets: chatModelPresets,
        active_chat_model_id: endpointProfileId,
        llm_provider: target.provider,
        model_role_bindings: {
          ...((current.model_role_bindings as Record<string, unknown> | undefined) || {}),
          chat: endpointProfileId,
        },
      });
    } catch {
      /* see comment above */
    }
    return target.id;
  }, []);

  // Cache-only active update — no IPC. Settings panels use this
  // when they batch-save via handleSave; otherwise every radio
  // click would roundtrip the bridge.
  const setActiveLocal = useCallback((id: string) => {
    if (!presetsCache.presets.some((p) => p.id === id)) return;
    applyMutation({ activeId: id });
  }, []);

  const setPresets = useCallback((next: ChatModelPreset[]) => {
    const safe = next.length > 0 ? next : DEFAULT_CHAT_MODEL_PRESETS;
    applyMutation({ presets: safe });
  }, []);

  const updatePreset = useCallback((id: string, patch: Partial<ChatModelPreset>) => {
    const next = presetsCache.presets.map((p) =>
      p.id === id ? { ...p, ...patch, id: p.id } : p
    );
    applyMutation({ presets: next });
  }, []);

  const addPreset = useCallback((init: Partial<ChatModelPreset> = {}): string => {
    const id = init.id || `model-${Date.now()}`;
    const preset: ChatModelPreset = {
      id,
      label: init.label || '自定义模型',
      provider: init.provider || presetsCache.presets[0]?.provider || 'deepseek',
      model: init.model || presetsCache.presets[0]?.model || 'deepseek-chat',
      defaultModel: init.defaultModel || init.model || presetsCache.presets[0]?.defaultModel || presetsCache.presets[0]?.model || 'deepseek-chat',
      baseUrl: init.baseUrl,
      credentialRef: init.credentialRef,
      protocol: init.protocol,
      capabilities: init.capabilities || ['chat', 'streaming', 'tools'],
      roles: init.roles || [],
      parameters: init.parameters || {},
    };
    const next = [...presetsCache.presets, preset];
    applyMutation({ presets: next, activeId: id });
    return id;
  }, []);

  const removePreset = useCallback((id: string) => {
    const next = presetsCache.presets.filter((p) => p.id !== id);
    const safe = next.length > 0 ? next : DEFAULT_CHAT_MODEL_PRESETS;
    applyMutation({
      presets: safe,
      activeId: presetsCache.activeId === id ? safe[0].id : undefined,
    });
  }, []);

  const activePreset =
    snapshot.presets.find((p) => p.id === snapshot.activeId) || snapshot.presets[0];

  return {
    presets: snapshot.presets,
    activeId: snapshot.activeId,
    activePreset,
    loading,
    refresh,
    setActive,
    setActiveLocal,
    setPresets,
    updatePreset,
    addPreset,
    removePreset,
  };
}

/** Test-only helper. Clears the module-scope cache so vitest
 *  doesn't carry state between test runs. */
export function __resetAiSettingsCacheForTests(): void {
  presetsCache = {
    presets: DEFAULT_CHAT_MODEL_PRESETS,
    activeId: DEFAULT_CHAT_MODEL_PRESETS[0].id,
  };
  loaded = false;
  inflight = null;
  subscribers.clear();
}
