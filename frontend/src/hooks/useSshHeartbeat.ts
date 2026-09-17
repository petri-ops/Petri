// ============================================================
// useSshHeartbeat — UI-397 远程连接红绿灯状态源（模块级单例轮询）。
//
// 用户裁决「给远程连接一个呼吸灯：红=断联 绿=连接 黄=连接中」：
// - 每个 SSH 项目一条 30s 探活循环（GET /api/workspaces/:id/ssh-ping），
//   多个 UI 挂载点（右栏文件树头/左栏项目行）共享同一状态，不重复轮询；
// - 黄 = 探活请求进行中（首连/重连中）；绿 = ok；红 = 失败（下次轮询
//   自动恢复——与 mux 懒重建/透明重试闭环，断线自愈对用户可见）；
// - document.hidden 时跳过网络请求（保持上次状态），可见即恢复。
// ============================================================

import { useEffect, useState } from 'react';
import { getPlatformApiPrefix } from '@/lib/authClient';

export type SshLinkStatus = 'connecting' | 'alive' | 'dead';

interface SshHeartbeatState {
  status: SshLinkStatus;
  /** 最近一次成功探活的往返耗时（ms）。 */
  ms: number | null;
  checkedAt: number | null;
}

const POLL_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 9_000;

const states = new Map<string, SshHeartbeatState>();
const listeners = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();

function notify(projectId: string): void {
  const set = listeners.get(projectId);
  if (set) for (const fn of set) fn();
}

function setState(projectId: string, patch: Partial<SshHeartbeatState>): void {
  const prev = states.get(projectId) ?? { status: 'connecting' as SshLinkStatus, ms: null, checkedAt: null };
  states.set(projectId, { ...prev, ...patch });
  notify(projectId);
}

async function pingOnce(projectId: string): Promise<void> {
  if (inflight.has(projectId)) return;
  inflight.add(projectId);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    inflight.delete(projectId);
    return; // 后台不耗网络，保持上次状态
  }
  setState(projectId, { status: 'connecting' });
  try {
    const token = localStorage.getItem('gewu_token') ?? localStorage.getItem('biof3_token');
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    const resp = await fetch(`${getPlatformApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/ssh-ping`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    clearTimeout(abortTimer);
    const data = (await resp.json()) as { ok?: boolean; ms?: number };
    if (data && data.ok) {
      setState(projectId, { status: 'alive', ms: typeof data.ms === 'number' ? data.ms : null, checkedAt: Date.now() });
    } else {
      setState(projectId, { status: 'dead', checkedAt: Date.now() });
    }
  } catch {
    setState(projectId, { status: 'dead', checkedAt: Date.now() });
  } finally {
    inflight.delete(projectId);
  }
}

function scheduleLoop(projectId: string): void {
  if (timers.has(projectId)) return;
  const tick = () => {
    void pingOnce(projectId);
    timers.set(projectId, setTimeout(tick, POLL_INTERVAL_MS));
  };
  tick();
}

function stopLoop(projectId: string): void {
  const t = timers.get(projectId);
  if (t) {
    clearTimeout(t);
    timers.delete(projectId);
  }
  states.delete(projectId);
}

/**
 * 订阅某 SSH 项目的连接状态（轮询由本模块单例管理）。
 * @param projectId 项目 id；enabled=false 时零开销（非 SSH 项目传 false）。
 */
export function useSshHeartbeat(projectId: string | null | undefined, enabled: boolean): SshHeartbeatState {
  const key = enabled ? projectId || '' : '';
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!key) return;
    const listener = () => forceRender((n) => n + 1);
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);
    scheduleLoop(key);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        listeners.delete(key);
        stopLoop(key); // 最后一个消费者卸载才停轮询
      }
    };
  }, [key]);

  return (
    states.get(key) ?? { status: 'connecting', ms: null, checkedAt: null }
  );
}

/** 手动立即重试（灯点击）。 */
export function sshHeartbeatRetry(projectId: string): void {
  void pingOnce(projectId);
}
