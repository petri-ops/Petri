// ============================================================
// appKeymapContext — 键位注册表的运行时面（BLOCK-200 P1）。
//
// 与 `appKeymap.ts`（纯函数/语法）的分工：这里只有状态与副作用。
// 刻意提供**无 Provider 也能工作**的降级（返回命令源默认值），理由不是"方便测试"，
// 而是弹出窗口（`/window/*` 路由）不挂主窗 Provider 树（BLOCK-59 治理红线），
// 那些面读键位时必须拿到默认组合而不是崩溃或"没有快捷键"。
//
// 写失败可见化沿用 BLOCK-199 UI-513 的同族纪律：本地先生效（肌肉记忆不断），
// 服务端没存上必须显式可见，绝不 `void fetch().catch(()=>{})` 静默。
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import {
  KEYMAP_COMMANDS,
  findConflicts,
  matchesCombo,
  resolveKeymap,
  type KeymapConflict,
} from './appKeymap';

export type KeymapOverrides = Record<string, string | null>;

export interface KeymapSyncState {
  state: 'ok' | 'pending' | 'failed';
  error: string | null;
  at: number;
}

export interface KeymapContextValue {
  /** 盘上的用户覆盖（未覆盖的命令不出现）。 */
  overrides: KeymapOverrides;
  /** 生效键位：覆盖优先，其余取命令源默认（徽章与派发都读这个）。 */
  bindings: Record<string, string | null>;
  conflicts: KeymapConflict[];
  sync: KeymapSyncState;
  /** 写一批补丁；`null`=解绑。本地立即生效，失败进 sync 并回滚到服务端真相。 */
  save: (patch: KeymapOverrides) => Promise<void>;
  reload: () => Promise<void>;
}

interface StoredResponse {
  status?: string;
  bindings?: KeymapOverrides;
  diagnostics?: Array<{ path?: string; code?: string; message?: string }>;
  error?: string;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const endpoint = (): string => `${getPlatformApiPrefix()}/keymap`;

const KeymapContext = createContext<KeymapContextValue | null>(null);

export function KeymapProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [overrides, setOverrides] = useState<KeymapOverrides>({});
  const [sync, setSync] = useState<KeymapSyncState>({ state: 'ok', error: null, at: 0 });

  /**
   * 拉服务端真相。`announce=false` 只回数据不动 `sync`——写失败后回滚覆盖时用它，
   * 否则"读到了默认值"会把刚产生的写失败横幅洗成 ok（本仓第一条纪律就是写失败必须可见）。
   */
  const load = useCallback(async (announce = true): Promise<void> => {
    try {
      const response = await fetch(endpoint(), { headers: authHeaders() });
      const data = (await response.json().catch(() => ({}))) as StoredResponse;
      if (response.ok && data.status === 'ok') {
        setOverrides(data.bindings || {});
        if (announce) setSync({ state: 'ok', error: null, at: Date.now() });
        return;
      }
      if (announce) setSync({ state: 'failed', error: data.error || `HTTP ${response.status}`, at: Date.now() });
    } catch (e) {
      if (announce) setSync({ state: 'failed', error: e instanceof Error ? e.message : String(e), at: Date.now() });
    }
  }, []);

  useEffect(() => {
    // load 是 async（先 await fetch 才 setState），但 react-hooks/set-state-in-effect 无法穿透
    // 回调判定、会报"effect 内同步 setState"。放进微任务：时序不变（同一帧内发起），规则不再误判。
    queueMicrotask(() => { void load(true); });
  }, [load]);

  const save = useCallback(async (patch: KeymapOverrides): Promise<void> => {
    setSync({ state: 'pending', error: null, at: Date.now() });
    // 本地先落（键位是肌肉记忆，不能等网络往返才生效）；失败再回滚到服务端真相并显式可见
    setOverrides((prev) => {
      const next = { ...prev };
      for (const [id, value] of Object.entries(patch)) {
        if (value === null) delete next[id];
        else next[id] = value;
      }
      return next;
    });
    try {
      const response = await fetch(endpoint(), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ bindings: patch }),
      });
      const data = (await response.json().catch(() => ({}))) as StoredResponse;
      if (response.ok && data.status === 'ok') {
        if (data.bindings) setOverrides(data.bindings);
        setSync({ state: 'ok', error: null, at: Date.now() });
        return;
      }
      const detail = (data.diagnostics || []).map((d) => `${d.path || ''} ${d.message || ''}`.trim()).join('；') || data.error || `HTTP ${response.status}`;
      setSync({ state: 'failed', error: detail, at: Date.now() });
      await load(false); // 拒写=盘上没变，把本地那份"以为生效"的覆盖收回，但保留失败横幅
    } catch (e) {
      setSync({ state: 'failed', error: e instanceof Error ? e.message : String(e), at: Date.now() });
      await load(false);
    }
  }, [load]);

  const value = useMemo<KeymapContextValue>(() => {
    const bindings = resolveKeymap(overrides);
    return { overrides, bindings, conflicts: findConflicts(bindings), sync, save, reload: () => load(true) };
  }, [overrides, sync, save, load]);

  return <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>;
}

/** 无 Provider 时返回命令源默认（弹出窗口面走这条；不是错误状态）。 */
export function useKeymapSafe(): KeymapContextValue {
  const ctx = useContext(KeymapContext);
  const fallback = useMemo<KeymapContextValue>(() => {
    const bindings = resolveKeymap({});
    return {
      overrides: {},
      bindings,
      conflicts: findConflicts(bindings),
      sync: { state: 'ok', error: null, at: 0 },
      save: () => Promise.reject(new Error('keymap_provider_missing')),
      reload: () => Promise.resolve(),
    };
  }, []);
  return ctx || fallback;
}

/**
 * App 级键位派发器：装**一个** window keydown 监听，按生效键位执行 `actions[id]`。
 * 只处理 `scope==='app'` 的命令（其余由组件就近处理，见 plan §1「刻意不做的重构」）。
 * `e.repeat` 一律忽略：长按连发不该反复触发"开/关"类动作（旧 Cmd+K 无此守卫）。
 */
export function useAppKeymapDispatcher(actions: Record<string, () => void>): void {
  const { bindings } = useKeymapSafe();
  const handler = useCallback((event: KeyboardEvent): void => {
    if (event.repeat || event.defaultPrevented) return;
    for (const command of KEYMAP_COMMANDS) {
      if (command.scope !== 'app') continue;
      const combo = bindings[command.id];
      if (!combo) continue; // 解绑
      const action = actions[command.id];
      if (!action) continue;
      if (matchesCombo(combo, event)) {
        event.preventDefault();
        action();
        return;
      }
    }
  }, [actions, bindings]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
